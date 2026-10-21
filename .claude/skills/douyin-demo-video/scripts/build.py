"""
抖音视频组装：按 <douyin 目录>/video.json 把分镜片段拼成无字幕成片，按口播出 .srt 字幕，再出两张检查图
----------------------------------------------------------
通用版，提炼自 docs/design/hospital|waiting/douyin/build.py：片段顺序、口播、语速都写在 video.json 里，这里不放任何页面相关的东西。
产出（都在 douyin 目录下）：
  <name>-<label>-无字幕.mp4   成片：分镜按 segments 顺序硬切拼接，只有画面（不带字幕、配音、配乐），末尾定格 tail 秒
  字幕-<label>.srt            字幕：每段口播从「该段起点 + offset」开始，按 rate 字 / 秒排，短句之间空 gap 秒；剪映「本地字幕」导入
  口播-<label>.txt            口播纯文本（每段一行），剪映「文本朗读」或自己照着念
  hook-sheet.png              开头 0–3.5 秒每 0.5 秒一帧 + 当时的字幕：检查开头 3 秒画面和口播
  storyboard.png              每段分镜一帧 + 那段的口播：检查画面和口播是不是在说同一件事
用法：
  python3 build.py <douyin目录> --plan          只排时间轴、做开头检查（写口播阶段就用，不需要录好的片段）
  python3 build.py <douyin目录> --srt-only      排时间轴 + 出字幕和口播文本（片段还没录时按计划时长）
  python3 build.py <douyin目录>                 完整组装：静帧推镜片段、成片、字幕、检查图
  python3 build.py <douyin目录> --grab <分镜名> <秒> <out.png>   从某段片段截一帧（封面的步骤缩略图用）
需要 ffmpeg / ffprobe（默认 /opt/homebrew/bin，可用环境变量 FFMPEG / FFPROBE 指定）和 Pillow。
"""

import glob
import io
import json
import os
import re
import shutil
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont


def _bin(name):
    """ffmpeg / ffprobe 路径：环境变量 > Homebrew > PATH"""
    env = os.environ.get(name.upper())
    if env:
        return env
    brew = f"/opt/homebrew/bin/{name}"
    return brew if os.path.exists(brew) else (shutil.which(name) or name)


FF = _bin("ffmpeg")
FP = _bin("ffprobe")

# 字幕断句：硬标点一定断开；软标点前后两截合起来不超过 MAX_SUB 个字就并成一条（保留中间的标点）
HARD = "。！？!?；;：:"
SOFT = "，,、"
KEEP = "？?！!"  # 这几个标点留在字幕末尾，句号逗号不留
MAX_SUB = 12
PUNCT = re.compile(r"[\s，,。．.：:？?！!、；;（）()“”\"'‘’《》…—~～]")

HOOK_END = 3.5  # 开头那句最晚几秒念完（含开录前 0.3 秒左右的留白）
HOOK_CHARS = 16  # 开头那句建议不超过多少字


def chars(s):
    """念出来的字数：去掉空格和标点；字母、数字也按一个字算"""
    return len(PUNCT.sub("", s))


def split_subs(text):
    """把一句口播切成字幕短句（规则见 HARD / SOFT / MAX_SUB）"""
    tokens = re.findall(r"([^，,、。！？!?；;：:]+)([，,、。！？!?；;：:]?)", text.strip())
    subs, cur, joint = [], "", ""
    for clause, p in tokens:
        clause = clause.strip()
        if not clause:
            continue
        if cur and joint and chars(cur) + chars(clause) <= MAX_SUB:
            cur += joint + clause
        else:
            if cur:
                subs.append(cur)
            cur = clause
        if p in KEEP:
            cur += p
        if p in HARD or not p:
            subs.append(cur)
            cur, joint = "", ""
        else:
            joint = p  # 软标点：下一截可以并进来
    if cur:
        subs.append(cur)
    return subs


def ts(t):
    ms = round(t * 1000)
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def run(*args):
    r = subprocess.run([FF, "-y", "-loglevel", "error", *args], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr)


def duration(f):
    out = subprocess.run([FP, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], capture_output=True, text=True)
    return float(out.stdout)


def grab(video, t):
    """从视频第 t 秒截一帧，返回 PIL 图"""
    r = subprocess.run([FF, "-loglevel", "error", "-ss", f"{max(0, t):.3f}", "-i", video, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True)
    if r.returncode or not r.stdout:
        raise RuntimeError(f"截帧失败 {video} @ {t:.2f}s：{r.stderr.decode()[:300]}")
    return Image.open(io.BytesIO(r.stdout)).convert("RGB")


def find_font(start):
    """找项目里的思源黑体：从 douyin 目录和本脚本所在位置往上找 src/assets/fonts，都没有就用系统苹方"""
    for d in (os.path.abspath(start), os.path.dirname(os.path.abspath(__file__))):
        while True:
            f = os.path.join(d, "src", "assets", "fonts", "SourceHanSansCN-Regular.otf")
            if os.path.exists(f):
                return f
            up = os.path.dirname(d)
            if up == d:
                break
            d = up
    for f in ("/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc"):
        if os.path.exists(f):
            return f
    return None


class Job:
    def __init__(self, root):
        self.root = os.path.abspath(root)
        cfg_path = os.path.join(self.root, "video.json")
        if not os.path.exists(cfg_path):
            raise SystemExit(f"没有 {cfg_path}（模板在 skill 的 templates/video.json）")
        c = json.load(open(cfg_path, encoding="utf-8"))
        self.c = c
        self.name = c["name"]
        self.label = c.get("label", "")
        suffix = f"-{self.label}" if self.label else ""
        self.out = os.path.join(self.root, f"{self.name}{suffix}-无字幕.mp4")
        self.srt = os.path.join(self.root, f"字幕{suffix}.srt")
        self.txt = os.path.join(self.root, f"口播{suffix}.txt")
        self.rate = float(c.get("rate", 5.0))
        self.gap = float(c.get("gap", 0.2))
        self.tail = float(c.get("tail", 1.0))
        self.target = c.get("target")
        self.W, self.H = c.get("size", [1920, 1080])
        self.fps = int(c.get("fps", 30))
        self.clips = os.path.join(self.root, c.get("clips", "clips"))
        self.enc = ["-c:v", "libx264", "-crf", "17", "-preset", "slow", "-pix_fmt", "yuv420p", "-r", str(self.fps), "-movflags", "+faststart"]
        self.segs = c["segments"]
        for i, s in enumerate(self.segs):
            s["_id"] = s.get("shot") or s.get("name") or f"seg{i + 1}"
            text = s.get("text", "").strip()
            s["text"] = text
            if text and not s.get("subs"):
                s["subs"] = split_subs(text)
            s.setdefault("subs", [])
            if text and PUNCT.sub("", text) != PUNCT.sub("", "".join(s["subs"])):
                raise SystemExit(f"第 {i + 1} 段的 subs 和 text 对不上（去掉标点后应完全相同）：{text}")
            for sub in s["subs"]:
                if chars(sub) > MAX_SUB * 1.5:
                    print(f"注意：字幕「{sub}」{chars(sub)} 个字，一屏放不下，口播里加个逗号断开")

    # ------------------------------------------------------------ 片段
    def clip_path(self, s):
        """这段对应的片段文件：录屏分镜是 rec.mjs 写的 NN-<shot>.mp4；静帧推镜是 build.py 写的 still-<name>.mp4"""
        if "still" in s:
            return os.path.join(self.clips, f"still-{s['_id']}.mp4")
        hits = sorted(glob.glob(os.path.join(self.clips, f"[0-9][0-9]-{s['shot']}.mp4")))
        if len(hits) > 1:
            raise SystemExit(f"{s['shot']} 有多个片段：{hits}，删掉旧的")
        return hits[0] if hits else os.path.join(self.clips, f"??-{s['shot']}.mp4")

    def durations(self, actual):
        """每段时长：actual=True 且片段存在时用片段实际时长，否则用计划时长 plan"""
        out = []
        for s in self.segs:
            f = self.clip_path(s)
            out.append(duration(f) if actual and os.path.exists(f) else float(s["plan"]))
        return out

    def render_still(self, s):
        """静帧推镜（设计稿、卫星图、规划图这类 2D 画面）：PIL 亚像素裁切，按缓入缓出从 from 推到 to，管道喂给 ffmpeg"""
        img = Image.open(os.path.join(self.root, s["still"])).convert("RGB")
        iw, ih = img.size
        W, H = self.W, self.H
        # 底框：图里能放下的最大 W:H 矩形（cover 裁切）
        if iw / ih > W / H:
            bw, bh = ih * W / H, ih
        else:
            bw, bh = iw, iw * H / W
        z0, z1 = s.get("zoom", [1.0, 1.08])
        f0 = s.get("from", [0.5, 0.5])
        f1 = s.get("to", f0)
        n = max(1, round(float(s["plan"]) * self.fps))
        os.makedirs(self.clips, exist_ok=True)
        out = self.clip_path(s)
        p = subprocess.Popen(
            [FF, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(self.fps), "-i", "-", *self.enc, out],
            stdin=subprocess.PIPE,
        )
        ease = lambda t: t * t * (3 - 2 * t)  # noqa: E731 平滑步进，推镜起止都不突兀
        for i in range(n):
            k = ease(i / (n - 1)) if n > 1 else 1.0
            z = z0 + (z1 - z0) * k
            cw, ch = bw / z, bh / z
            cx = min(max((f0[0] + (f1[0] - f0[0]) * k) * iw, cw / 2), iw - cw / 2)
            cy = min(max((f0[1] + (f1[1] - f0[1]) * k) * ih, ch / 2), ih - ch / 2)
            frame = img.transform((W, H), Image.AFFINE, (cw / W, 0, cx - cw / 2, 0, ch / H, cy - ch / 2), resample=Image.BICUBIC)
            p.stdin.write(frame.tobytes())
        p.stdin.close()
        if p.wait():
            raise RuntimeError(f"静帧推镜 {s['_id']} 编码失败")
        print("写出", os.path.relpath(out, self.root), f"{n / self.fps:.1f} 秒")

    def build_video(self):
        for s in self.segs:
            f = self.clip_path(s)
            if "still" in s:
                self.render_still(s)
            elif not os.path.exists(f):
                raise SystemExit(f"缺少分镜片段 {os.path.relpath(f, self.root)}：先用 rec.mjs 录 {s['shot']}")
        tmp = os.path.join(self.clips, "_norm")
        os.makedirs(tmp, exist_ok=True)
        parts = []
        for i, s in enumerate(self.segs):
            dst = os.path.join(tmp, f"{i:02d}.mp4")
            vf = f"scale={self.W}:{self.H},fps={self.fps},format=yuv420p"
            if i == len(self.segs) - 1 and self.tail > 0:
                vf += f",tpad=stop_mode=clone:stop_duration={self.tail}"
            run("-i", self.clip_path(s), "-vf", vf, "-an", *self.enc, dst)
            parts.append(dst)
        lst = os.path.join(tmp, "list.txt")
        with open(lst, "w", encoding="utf-8") as fh:
            fh.write("".join(f"file '{p}'\n" for p in parts))
        run("-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", "-movflags", "+faststart", self.out)
        shutil.rmtree(tmp)
        print("写出", os.path.relpath(self.out, self.root), f"{duration(self.out):.1f} 秒")

    # ------------------------------------------------------------ 时间轴、字幕
    def timeline(self, durs):
        """排字幕：返回 [(起, 止, 字幕, 段序号)]，并打印逐段时间表和检查结果"""
        starts = [0.0]
        for d in durs[:-1]:
            starts.append(starts[-1] + d)
        total = sum(durs) + self.tail
        voiced = [i for i, s in enumerate(self.segs) if s["subs"]]
        items, warn = [], []
        print(f"\n{'#':>2} {'分镜':<12}{'起':>6}{'时长':>6}{'字数':>5}{'念完':>7}{'余量':>6}  口播")
        for i, s in enumerate(self.segs):
            t = starts[i] + float(s.get("offset", 0.3))
            for sub in s["subs"]:
                d = chars(sub) / self.rate
                items.append((t, t + d, sub, i))
                t += d + self.gap
            end = t - self.gap if s["subs"] else None
            later = [j for j in voiced if j > i]
            nxt = starts[later[0]] + float(self.segs[later[0]].get("offset", 0.3)) if later else total
            slack = nxt - end if end is not None else None
            print(
                f"{i + 1:>2} {s['_id']:<12}{starts[i]:>6.1f}{durs[i]:>6.1f}{chars(s['text']):>5}"
                f"{(f'{end:.1f}' if end is not None else '—'):>7}{(f'{slack:+.1f}' if slack is not None else ''):>6}  {s['text'] or '（无口播）'}"
            )
            if slack is not None and slack < -0.05:
                warn.append(f"第 {i + 1} 段（{s['_id']}）口播比画面长 {-slack:.1f} 秒：加长这段画面（plan），或请用户同意删字")
        # 开头检查：第一段必须有口播、马上开口；开头那句（到第一个句末标点）要在 HOOK_END 秒内念完
        if not self.segs[0]["subs"]:
            warn.append("第 1 段没有口播：开头 3 秒必须开口说结果")
        else:
            first = self.segs[0]
            if float(first.get("offset", 0.3)) > 0.5:
                warn.append(f"第 1 段 offset = {first.get('offset')} 秒，开口太晚（≤ 0.5）")
            hook = re.split(r"[。！？!?]", first["text"])[0]
            n, done = 0, None
            for a, b, sub, i in items:
                if i != 0:
                    break
                n += chars(sub)
                done = b
                if n >= chars(hook):
                    break
            print(f"\n开头那句「{hook}」{chars(hook)} 字，{done:.1f} 秒念完")
            if chars(hook) > HOOK_CHARS:
                warn.append(f"开头那句 {chars(hook)} 字，建议 ≤ {HOOK_CHARS} 字（或把最抓人的词挪到最前面）")
            if done is not None and done > HOOK_END:
                warn.append(f"开头那句 {done:.1f} 秒才念完，要在 {HOOK_END} 秒内")
            if durs[0] < 2.5:
                warn.append(f"第 1 段画面只有 {durs[0]:.1f} 秒，招牌效果来不及演完（≥ 2.5 秒）")
        print(f"全片 {total:.1f} 秒（含末尾定格 {self.tail} 秒），口播 {sum(chars(s['text']) for s in self.segs)} 字，语速 {self.rate} 字/秒")
        if self.target and abs(total - float(self.target)) > 3:
            warn.append(f"全片 {total:.1f} 秒，和目标 {self.target} 秒差得多")
        for w in warn:
            print("注意：" + w)
        if not warn:
            print("检查通过")
        return items

    def write_text(self):
        with open(self.txt, "w", encoding="utf-8") as fh:
            fh.write("".join(s["text"] + "\n" for s in self.segs if s["text"]))
        print("写出", os.path.relpath(self.txt, self.root))

    def write_srt(self, items):
        with open(self.srt, "w", encoding="utf-8") as fh:
            for k, (a, b, s, _) in enumerate(items, 1):
                fh.write(f"{k}\n{ts(a)} --> {ts(b)}\n{s}\n\n")
        print("写出", os.path.relpath(self.srt, self.root), f"{len(items)} 条，最后一条结束于 {items[-1][1]:.1f} 秒")

    # ------------------------------------------------------------ 检查图
    def _font(self, size):
        f = find_font(self.root)
        return ImageFont.truetype(f, size) if f else ImageFont.load_default()

    def _sheet(self, cells, cols, path, tw=480):
        """cells = [(图, [文字行])]：缩略图网格，每张下面一到两行字"""
        th = tw * self.H // self.W
        f = self._font(20)
        rows = (len(cells) + cols - 1) // cols
        cap = 64
        sheet = Image.new("RGB", (cols * (tw + 16) + 16, rows * (th + cap + 16) + 16), (28, 28, 32))
        d = ImageDraw.Draw(sheet)
        for k, (img, lines) in enumerate(cells):
            x = 16 + (k % cols) * (tw + 16)
            y = 16 + (k // cols) * (th + cap + 16)
            sheet.paste(img.resize((tw, th), Image.Resampling.LANCZOS), (x, y))
            for j, line in enumerate(lines[:2]):
                # 太长的截断，检查图上看个大概就够
                while d.textlength(line, font=f) > tw and len(line) > 4:
                    line = line[:-2] + "…"
                d.text((x, y + th + 6 + j * 28), line, font=f, fill=(235, 235, 240) if j == 0 else (170, 200, 255))
        sheet.save(path)
        print("写出", os.path.relpath(path, self.root))

    def sheets(self, items, durs):
        # 开头 0–3.5 秒：每 0.5 秒一帧，下面写当时正在念的字幕
        cells = []
        for k in range(8):
            t = k * 0.5
            now = next((s for a, b, s, _ in items if a <= t + 0.25 <= b + self.gap), "")
            cells.append((grab(self.out, t), [f"{t:.1f} 秒", now]))
        self._sheet(cells, 4, os.path.join(self.root, "hook-sheet.png"))
        # 逐段：每段在口播开头后 1 秒（或段中间）取一帧，下面写分镜名和口播
        starts = [0.0]
        for d in durs[:-1]:
            starts.append(starts[-1] + d)
        cells = []
        for i, s in enumerate(self.segs):
            t = starts[i] + min(float(s.get("offset", 0.3)) + 1.0, durs[i] * 0.6)
            cells.append((grab(self.out, t), [f"{i + 1:02d} {s['_id']} · {starts[i]:.1f}s", s["text"] or s.get("picture", "（无口播）")]))
        self._sheet(cells, 3, os.path.join(self.root, "storyboard.png"))


def main():
    args = sys.argv[1:]
    if not args or args[0].startswith("-"):
        raise SystemExit(__doc__)
    job = Job(args[0])
    flags = args[1:]
    if "--grab" in flags:
        i = flags.index("--grab")
        shot, sec, out = flags[i + 1], float(flags[i + 2]), flags[i + 3]
        seg = next((s for s in job.segs if s["_id"] == shot), None)
        if not seg:
            raise SystemExit(f"video.json 里没有分镜 {shot}")
        grab(job.clip_path(seg), sec).save(out)
        print("写出", out)
        return
    if "--plan" in flags:
        job.timeline(job.durations(actual=True))
        job.write_text()
        return
    if "--srt-only" in flags:
        items = job.timeline(job.durations(actual=True))
        job.write_text()
        job.write_srt(items)
        return
    job.build_video()
    durs = job.durations(actual=True)
    items = job.timeline(durs)
    job.write_text()
    job.write_srt(items)
    job.sheets(items, durs)


if __name__ == "__main__":
    main()

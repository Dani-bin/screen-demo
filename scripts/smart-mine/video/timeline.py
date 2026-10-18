"""
智能矿山解说视频：时间轴与字幕
----------------------------------------------------------
口播文案按段落排时间：每段时长 = 字数 / 语速 + 段尾停顿。配音由用户在剪映里自己做，
这里按每秒约 6 个字（剪映文本朗读 1.2 倍速左右）排，用户可以在剪映里微调语速对齐。

输出（git 忽略的 models/smart-mine/video/）：
  - timeline.json：各段起止时间，录制脚本 record.mjs 与合成脚本 compose.py 都按它来
  - out/字幕.srt：按标点切成短句的字幕，时长按字数在段内分配（去掉句末逗号句号，保留问号）

用法：python scripts/smart-mine/video/timeline.py
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
VIDEO = ROOT / "models" / "smart-mine" / "video"

CHARS_PER_SEC = 6.0  # 语速
GAP = 0.5  # 段尾停顿（秒）
MAX_LINE = 17  # 每条字幕最多字数

# 口播文案（与用户确认的版本一致；| 为字幕手动断句点），key 供镜头脚本引用
SEGMENTS = [
    ("ask", "前几天有人问我：煤矿三维可视化，到底能做到多真实？"),
    ("mine", "光说没用。我直接找了一座真矿，美国科罗拉多州的 West Elk 煤矿，一座还在生产的井工煤矿，做给你看。"),
    (
        "terrain",
        "这块沙盘，没有一座山是手捏的：地形用的是美国政府公开的激光雷达数据，精度一米；表面贴的是零点三米的航拍照片。十二公里乘十公里，落差将近一千米，全是真实地形。",
    ),
    ("strata", "侧面也不是随便画的。我按这里真实的地层顺序上了色，这几条黑线，就是可以开采的煤层。"),
    (
        "pads",
        "再看山上这些小白点。它们是瓦斯抽采钻场，从地面往下打孔，把地下采空区的瓦斯抽出来。我让程序在航拍图里|把它们一个个找出来，发现它们是一排一排排列的。这就暴露了地下四百米的秘密：工作面是东西走向，一条挨着一条。",
    ),
    (
        "xray",
        "点一下透视，地表变成半透明：已经采空的区域、正在回采的工作面、进风和回风的巷道，亮条就是风流的方向。再点剖切，沿着工作面整个切开，地下四百多米的煤层|和采空区一目了然。",
    ),
    (
        "live",
        "数据也会动：它跟着科罗拉多当地时间跑。我录视频的时候那边是凌晨一点，夜班检修，采煤机就停着；天一亮开始割煤，瓦斯浓度慢慢往上走，接近预警线还会自动报警。",
    ),
    (
        "honest",
        "当然要说实话：地形和航拍是真的，井下的布置|是我根据钻场推断的示意，运行数据是模拟的；拉近看，厂房还是贴在地上的平面，下一步单独建模。",
    ),
    ("end", "国内能不能做？能，只是要用矿方的无人机航测数据。你觉得这个效果，能直接拿去给甲方演示吗？评论区告诉我。"),
]


def spoken_len(s):
    """朗读长度：汉字 1，英文单词按 1.5 个字，标点和断句符不计"""
    han = len(re.findall(r"[一-鿿]", s))
    words = len(re.findall(r"[A-Za-z]+", s))
    return han + words * 1.5


def best_cut(p):
    """过长短句的切分点：从中间往两边找，优先空格处，不切在英文单词中间"""
    mid = len(p) // 2
    for off in range(len(p)):
        for c in (mid - off, mid + off):
            if 1 <= c < len(p) and p[c] == " ":
                return c
            if 1 <= c < len(p) and not (p[c - 1].isascii() and p[c - 1].isalpha() and p[c].isascii() and p[c].isalpha()):
                if off > 3:  # 附近没有空格才退而求其次
                    return c
    return mid


def split_lines(text):
    """按标点切短句，过长的再按字数对半切"""
    # 文案里的 | 是手动断句点（避免「四百多 / 米」这种切法），只影响字幕，不念出来
    parts = [p.strip() for p in re.split(r"(?<=[，。；：？！、])|\|", text) if p.strip()]
    lines = []
    for p in parts:
        while len(p) > MAX_LINE:
            lines.append(p[: best_cut(p)].strip())
            p = p[best_cut(p) :].strip()
        lines.append(p)
    # 太短的句子并到前一句（如「能，」）
    merged = []
    for ln in lines:
        if merged and spoken_len(ln) <= 2 and len(merged[-1]) + len(ln) <= MAX_LINE + 3:
            merged[-1] += ln
        else:
            merged.append(ln)
    return merged


def clean(line):
    """字幕去掉句末的逗号、句号、分号、冒号、顿号，保留问号"""
    return re.sub(r"[，。；：、]+$", "", line)


def srt_time(t):
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def main():
    (VIDEO / "out").mkdir(parents=True, exist_ok=True)
    t = 0.0
    segs = []
    subs = []
    for key, text in SEGMENTS:
        speak = spoken_len(text) / CHARS_PER_SEC
        start = t
        lines = split_lines(text)
        total = sum(spoken_len(x) for x in lines)
        lt = start
        for ln in lines:
            d = speak * spoken_len(ln) / total
            subs.append((lt, lt + d, clean(ln)))
            lt += d
        t = start + speak + GAP
        segs.append({"key": key, "start": round(start, 3), "end": round(t, 3), "text": text.replace("|", "")})
    timeline = {"fps": 30, "duration": round(t + 0.8, 3), "segments": segs}
    (VIDEO / "timeline.json").write_text(json.dumps(timeline, ensure_ascii=False, indent=1), "utf8")
    srt = "\n".join(f"{i + 1}\n{srt_time(a)} --> {srt_time(b)}\n{s}\n" for i, (a, b, s) in enumerate(subs))
    (VIDEO / "out" / "字幕.srt").write_text(srt, "utf-8-sig")
    for s in segs:
        print(f'{s["key"]:8s} {s["start"]:6.2f} – {s["end"]:6.2f}  ({s["end"] - s["start"]:.1f} s)')
    print(f"总长 {timeline['duration']:.1f} s，字幕 {len(subs)} 条")


if __name__ == "__main__":
    main()

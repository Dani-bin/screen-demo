"""
无人机巡检监控平台解说视频：合成成片
----------------------------------------------------------
读 timeline.json / shots.json 与 record.mjs 录好的镜头帧，相邻镜头在交界处叠化（fade 秒），
片尾淡出（片头不淡入），右上角加"演示项目"说明，逐帧送进 ffmpeg 编码成 1920 × 1080 / 30 fps 的 H.264 视频。
视频无声、不烧字幕：字幕是单独的 out/字幕.srt，配音在剪映里做（README.md）。

输出：models/drone/video/out/无人机巡检解说.mp4

用法：python scripts/drone/video/compose.py [--preview 秒]（--preview 只导出该时刻一帧 PNG，检查用）
需要 numpy、Pillow、imageio-ffmpeg。
"""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
VIDEO = ROOT / "models" / "drone" / "video"
FONTS = ROOT / "src" / "assets" / "fonts"
W, H, FPS = 1920, 1080, 30

TL = json.loads((VIDEO / "timeline.json").read_text("utf-8"))
SH = json.loads((HERE / "shots.json").read_text("utf-8"))
SEG = {s["key"]: s["start"] for s in TL["segments"]}
FADE = SH["fade"]
NOTE_FONT = ImageFont.truetype(str(FONTS / "SourceHanSansCN-Regular.otf"), 22)


def at(ref):
    """[口播段 key, 段内偏移] → 视频时间（秒）"""
    key, off = ref
    return TL["duration"] if key == "END" else SEG[key] + off


# 每个镜头覆盖的时间段（含两端各 fade/2 的叠化余量）与帧目录
SHOTS = []
for s in SH["shots"]:
    d = VIDEO / "frames" / s["id"]
    meta = json.loads((d / "meta.json").read_text("utf-8"))
    SHOTS.append({"id": s["id"], "t0": at(s["from"]) - FADE / 2, "t1": at(s["to"]) + FADE / 2, "dir": d, "meta": meta})

_cache = {}


def shot_frame(s, t):
    """镜头 s 在视频时间 t 的那一帧（RGB 数组；超出范围取首尾帧）"""
    m = s["meta"]
    k = int(round((t - m["start"]) * m["fps"]))
    k = max(0, min(m["frames"] - 1, k))
    key = (s["id"], k)
    if key not in _cache:
        if len(_cache) > 8:
            _cache.clear()
        _cache[key] = np.asarray(Image.open(s["dir"] / f"{k:05d}.jpg").convert("RGB"), np.float32)
    return _cache[key]


def note_layer():
    """右上角的说明文字（半透明底），只画一次"""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    text = "演示项目 · 园区与数据均为虚构"
    x0, y0, x1, y1 = dr.textbbox((0, 0), text, font=NOTE_FONT)
    tw, th = x1 - x0, y1 - y0
    x, y = W - tw - 40, 26
    dr.rounded_rectangle((x - 14, y - 8, x + tw + 14, y + th + 14), 6, fill=(6, 11, 22, 150))
    dr.text((x - x0, y - y0 + 2), text, font=NOTE_FONT, fill=(200, 214, 235, 230))
    a = np.asarray(img, np.float32)
    return a[..., :3], a[..., 3:] / 255.0


NOTE_RGB, NOTE_A = note_layer()


def frame_at(t):
    # 正在画面里的镜头；两个重叠时在重叠段里线性叠化
    live = [s for s in SHOTS if s["t0"] <= t < s["t1"]] or [min(SHOTS, key=lambda s: abs(s["t0"] - t))]
    if len(live) == 1:
        img = shot_frame(live[0], t)
    else:
        a, b = sorted(live, key=lambda s: s["t0"])[:2]
        w = (t - b["t0"]) / max(1e-6, a["t1"] - b["t0"])
        w = w * w * (3 - 2 * w)
        img = shot_frame(a, t) * (1 - w) + shot_frame(b, t) * w
    # 片尾 1 s 淡出；片头不淡入（抖音第 0 帧就要是成品画面）
    k = min(1.0, max(0.0, (TL["duration"] - t) / 1.0))
    img = img * k
    # 说明文字（第 1 秒后出现，片尾淡出前一直在）
    na = NOTE_A * min(1.0, max(0.0, t - 1.0) / 0.5) * k
    img = img * (1 - na) + NOTE_RGB * na
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


def main():
    if "--preview" in sys.argv:
        t = float(sys.argv[sys.argv.index("--preview") + 1])
        out = VIDEO / f"preview_{t:05.1f}.png"
        frame_at(t).save(out)
        print("saved", out)
        return
    import imageio_ffmpeg

    out = VIDEO / "out" / "无人机巡检解说.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)
    n = int(round(TL["duration"] * FPS))
    cmd = [
        imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        str(out),
    ]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for k in range(n):
        p.stdin.write(frame_at(k / FPS).tobytes())
        if k % 300 == 0:
            print(f"{k}/{n}", flush=True)
    p.stdin.close()
    p.wait()
    print("saved", out, f"{n / FPS:.1f} s")


if __name__ == "__main__":
    main()

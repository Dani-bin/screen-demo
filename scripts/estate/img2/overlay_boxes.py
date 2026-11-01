#!/usr/bin/env python3
"""
把 footprints.json 里的体积（周边白模、商业体、医院、学校、底商街…）按评审机位投到设计稿上画成线框，
肉眼看位置 / 大小 / 高度和设计稿对不对。
用法：python3 scripts/estate/img2/overlay_boxes.py <输出.png> [前缀,前缀…] [x0 y0 x1 y1] [--scale 2] [--image <底图>]
前缀默认 ctx_,ML01,HP01,SC01,SH01,KG01,PM01,E01
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts/estate/img2"))
import refcam as rc  # noqa: E402


def proj(x, y, z):
    d = np.array([x, y, z]) - rc.C
    return (rc.W / 2 + rc.FOC * (d @ rc.R) / (d @ rc.F), rc.H / 2 - rc.FOC * (d @ rc.U) / (d @ rc.F))


def main():
    out = sys.argv[1]
    prefixes = (sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].isdigit() else "ctx_,ML01,HP01,SC01,SH01,KG01,PM01,E01").split(",")
    nums = [int(a) for a in sys.argv[2:] if a.lstrip("-").isdigit()]
    box = tuple(nums[:4]) if len(nums) >= 4 else (0, 0, 1536, 864)
    scale = int(sys.argv[sys.argv.index("--scale") + 1]) if "--scale" in sys.argv else 2
    base = sys.argv[sys.argv.index("--image") + 1] if "--image" in sys.argv else str(ROOT / "docs/design/estate/design/src/scene-a1.png")
    im = Image.open(base).convert("RGB").resize((rc.W, rc.H), Image.Resampling.LANCZOS)
    im = im.crop(box).resize(((box[2] - box[0]) * scale, (box[3] - box[1]) * scale), Image.Resampling.LANCZOS)
    dr = ImageDraw.Draw(im)
    fps = json.load(open(ROOT / "src/views/estate/scene/img2/footprints.json"))["footprints"]
    for f in fps:
        if not any(f["id"].startswith(p) for p in prefixes) or f["id"].startswith("ML01_esc"):
            continue
        a = f.get("ry", 0) or 0
        ca, sa = math.cos(a), math.sin(a)
        z1 = f["top"]
        z0 = f["top"] - f["h"]
        pts = {}
        for i, (sx, sy) in enumerate([(-1, -1), (1, -1), (1, 1), (-1, 1)]):
            lx, ly = sx * f["w"] / 2, sy * f["d"] / 2
            wx = f["cx"] + lx * ca - ly * sa
            wy = f["cy"] + lx * sa + ly * ca
            for k, z in ((0, z0), (1, z1)):
                p = proj(wx, wy, z)
                pts[(i, k)] = ((p[0] - box[0]) * scale, (p[1] - box[1]) * scale)
        col = (255, 60, 60) if f["id"].startswith("ctx_") else (0, 255, 255)
        for i in range(4):
            j = (i + 1) % 4
            dr.line([pts[(i, 1)], pts[(j, 1)]], fill=col, width=2)
            dr.line([pts[(i, 0)], pts[(j, 0)]], fill=col, width=1)
            dr.line([pts[(i, 0)], pts[(i, 1)]], fill=col, width=1)
        c = pts[(0, 1)]
        dr.text((c[0] + 2, c[1] - 11), f["id"], fill=(255, 255, 0))
    im.save(out)
    print("saved", out, im.size)


main()

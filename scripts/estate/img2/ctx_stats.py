#!/usr/bin/env python3
"""周边白模 / 医院：设计稿和渲染在顶面、正面、侧面几处的中位 RGB 对照（评审机位 1536×864）。
用法：python3 scripts/estate/img2/ctx_stats.py <渲染.png>"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
REGIONS = {
    "ctx07 顶": (100, 392, 190, 414), "ctx07 正面": (75, 440, 185, 480), "ctx07 右侧面": (203, 430, 214, 455),
    "ctx05 顶(中)": (245, 224, 282, 236), "ctx05 正面": (245, 250, 280, 268),
    "ctx04 顶": (85, 222, 140, 236), "ctx04 正面": (75, 246, 140, 262),
    "ctx15 前体顶": (1380, 248, 1435, 260), "ctx15 前体正面": (1380, 266, 1435, 288),
    "ctx12a 顶": (1200, 184, 1250, 200), "ctx12a 正面": (1200, 208, 1250, 226),
    "ctx14 顶": (1262, 238, 1310, 250), "ctx14 正面": (1262, 262, 1310, 285),
    "HP01 顶": (1400, 485, 1470, 510), "HP01 正面": (1420, 530, 1490, 550),
}
d = np.asarray(Image.open(ROOT / "docs/design/estate/design/src/scene-a1.png").convert("RGB")).astype(float)
r = np.asarray(Image.open(sys.argv[1]).convert("RGB").resize((1536, 864), Image.Resampling.LANCZOS)).astype(float)
print("%-14s %-18s %-18s %s" % ("区域", "设计稿 RGB", "现在 RGB", "差(R,G,B)"))
tot = []
for k, (x0, y0, x1, y1) in REGIONS.items():
    a = np.median(d[y0:y1, x0:x1].reshape(-1, 3), axis=0)
    b = np.median(r[y0:y1, x0:x1].reshape(-1, 3), axis=0)
    tot.append(np.abs(a - b).mean())
    print("%-14s %-18s %-18s %s" % (k, tuple(int(v) for v in a), tuple(int(v) for v in b), tuple(int(v) for v in (b - a))))
print("平均绝对色差 %.1f" % np.mean(tot))

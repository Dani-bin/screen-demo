#!/usr/bin/env python3
"""设计稿放大 + 每 10 px 一条横线 / 竖线（评审机位 1536×864 坐标），用来读体块边在图里的坐标。
用法：python3 scripts/estate/img2/grid_crop.py <输出.png> x0 y0 x1 y1 [--scale 4] [--image <底图>]"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
out = sys.argv[1]
x0, y0, x1, y1 = (int(v) for v in sys.argv[2:6])
scale = int(sys.argv[sys.argv.index("--scale") + 1]) if "--scale" in sys.argv else 4
base = sys.argv[sys.argv.index("--image") + 1] if "--image" in sys.argv else str(ROOT / "docs/design/estate/design/src/scene-a1.png")
im = Image.open(base).convert("RGB").resize((1536, 864), Image.Resampling.LANCZOS)
c = im.crop((x0, y0, x1, y1)).resize(((x1 - x0) * scale, (y1 - y0) * scale), Image.Resampling.LANCZOS)
dr = ImageDraw.Draw(c)
for y in range((y0 // 10 + 1) * 10, y1, 10):
    yy = (y - y0) * scale
    dr.line([(0, yy), (c.width, yy)], fill=(255, 70, 70) if y % 50 == 0 else (255, 255, 255), width=1)
    dr.text((2, yy + 1), str(y), fill=(255, 255, 0))
for x in range((x0 // 10 + 1) * 10, x1, 10):
    xx = (x - x0) * scale
    dr.line([(xx, 0), (xx, c.height)], fill=(70, 160, 255) if x % 50 == 0 else (200, 200, 255), width=1)
    dr.text((xx + 2, 2), str(x), fill=(0, 255, 255))
c.save(out)
print("saved", out, c.size)

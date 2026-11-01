#!/usr/bin/env python3
"""
设计稿 | 渲染 并排放大 + 每 10 px 一条横线（评审机位 1536×864 坐标），用来量屋顶 / 立面边在图里的 y。
用法：python3 scripts/estate/img2/grid_compare.py <渲染.png> <输出.png> x0 y0 x1 y1 [--scale 4]
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
DESIGN = ROOT / "docs/design/estate/design/src/scene-a1.png"


def main():
    render, out = sys.argv[1], sys.argv[2]
    x0, y0, x1, y1 = (int(v) for v in sys.argv[3:7])
    scale = int(sys.argv[sys.argv.index("--scale") + 1]) if "--scale" in sys.argv else 4
    d = Image.open(DESIGN).convert("RGB")
    r = Image.open(render).convert("RGB").resize(d.size, Image.Resampling.LANCZOS)
    sheet = Image.new("RGB", (((x1 - x0) * scale) * 2 + 10, (y1 - y0) * scale), (255, 255, 255))
    for i, im in enumerate((d, r)):
        c = im.crop((x0, y0, x1, y1)).resize(((x1 - x0) * scale, (y1 - y0) * scale), Image.Resampling.LANCZOS)
        dr = ImageDraw.Draw(c)
        for y in range((y0 // 10 + 1) * 10, y1, 10):
            yy = (y - y0) * scale
            dr.line([(0, yy), (c.width, yy)], fill=(255, 80, 80) if y % 50 == 0 else (255, 255, 255), width=1)
            dr.text((3, yy + 1), str(y), fill=(255, 255, 0))
        sheet.paste(c, (i * ((x1 - x0) * scale + 10), 0))
    sheet.save(out)
    print("saved", out, sheet.size)


main()

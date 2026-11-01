#!/usr/bin/env python3
"""
把设计稿和我的渲染在同一批区域上放大并排（左 = 设计稿，右 = 渲染），用来肉眼看建筑细节（窗洞、梁墩、屋顶）。
用法：python3 scripts/estate/img2/crops.py <渲染.png> <输出前缀> [--scale 5]
区域（1536×864 坐标）：tower = B01 楼顶一段、terrace = B05/B06 洋房、villa = B13/B14 联排
"""
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
DESIGN = ROOT / "docs/design/estate/design/src/scene-a1.png"
BOXES = {
    "tower": (490, 100, 620, 200),
    "terrace": (460, 296, 620, 380),
    "villa": (480, 515, 660, 600),
}

def main():
    render = Path(sys.argv[1])
    prefix = sys.argv[2]
    scale = int(sys.argv[sys.argv.index("--scale") + 1]) if "--scale" in sys.argv else 5
    d = Image.open(DESIGN).convert("RGB")
    r = Image.open(render).convert("RGB").resize(d.size, Image.Resampling.LANCZOS)
    for name, box in BOXES.items():
        a = d.crop(box)
        b = r.crop(box)
        size = (a.width * scale, a.height * scale)
        a = a.resize(size, Image.Resampling.LANCZOS)
        b = b.resize(size, Image.Resampling.LANCZOS)
        sheet = Image.new("RGB", (size[0] * 2 + 12, size[1]), (255, 255, 255))
        sheet.paste(a, (0, 0))
        sheet.paste(b, (size[0] + 12, 0))
        out = f"{prefix}-{name}.png"
        sheet.save(out)
        print("saved", out, sheet.size)

main()

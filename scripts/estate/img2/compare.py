#!/usr/bin/env python3
"""
/estate 还原评审：整幅并排 + 50 % 叠图（skill 自带的 make_comparison_sheet.py 会把两边裁成正方形，不适合 16:9 的场景）
----------------------------------------------------------
输出一张图：上面 = 设计稿（左）| 渲染（右），下面 = 50 % 叠图；可选 --crop 取局部放大对比（原图坐标 x0,y0,x1,y1）。
用法：python3 scripts/estate/img2/compare.py <渲染.png> <输出.png> [--crop x0,y0,x1,y1] [--ref <参考图>]
"""
import argparse
import os

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("render")
    ap.add_argument("out")
    ap.add_argument("--crop", default="")
    ap.add_argument("--ref", default=os.path.join(ROOT, "docs/design/estate/design/src/scene-a1.png"))
    args = ap.parse_args()
    ref = Image.open(args.ref).convert("RGB")
    ren = Image.open(args.render).convert("RGB").resize(ref.size, Image.Resampling.LANCZOS)
    if args.crop:
        x0, y0, x1, y1 = [int(v) for v in args.crop.split(",")]
        ref, ren = ref.crop((x0, y0, x1, y1)), ren.crop((x0, y0, x1, y1))
    w, h = ref.size
    # 目标宽度 1600：并排两张各 800，下面叠图 800 居中
    s = 800 / w
    ref_s = ref.resize((800, int(h * s)), Image.Resampling.LANCZOS)
    ren_s = ren.resize((800, int(h * s)), Image.Resampling.LANCZOS)
    blend = Image.blend(ref_s, ren_s, 0.5)
    sheet = Image.new("RGB", (1600, ref_s.height * 2 + 12), (245, 242, 235))
    sheet.paste(ref_s, (0, 0))
    sheet.paste(ren_s, (800, 0))
    sheet.paste(blend, (400, ref_s.height + 12))
    sheet.save(args.out)
    print("已保存", args.out, sheet.size)


if __name__ == "__main__":
    main()

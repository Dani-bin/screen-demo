#!/usr/bin/env python3
"""
立面数字对比：设计稿 vs 渲染，几类楼的"墙面亮度 / 窗光亮度 / 亮像素占比 / 暖色比 / 纹理起伏"
----------------------------------------------------------
调立面参数不凭肉眼：每类楼取设计稿里一块没有被树挡的立面（原图坐标），在渲染图同一位置取同样的块，打印统计。
用法：python3 scripts/estate/img2/facade_stats.py <渲染.png>
"""
import sys
import numpy as np
from PIL import Image

REF = "docs/design/estate/design/src/scene-a1.png"
# 立面块（原图 1536×864 坐标），都是没被树挡住的立面中段
BLOCKS = {
    "塔楼 B01 立面": (496, 72, 556, 150),
    "塔楼 B04 立面": (1000, 72, 1046, 150),
    "塔楼 B02 立面": (634, 116, 668, 160),
    "洋房 B05 立面": (448, 288, 596, 306),
    "联排 B13 立面": (500, 534, 640, 552),
    "会所 立面": (700, 505, 830, 540),
    "会所 屋顶": (700, 480, 830, 500),
    "周边白模": (172, 152, 258, 188),
    "底商街": (556, 175, 600, 235),
}


def stats(a, box):
    x0, y0, x1, y1 = box
    c = a[y0:y1, x0:x1].reshape(-1, 3)
    lum = c @ [0.2126, 0.7152, 0.0722]
    sat = (c.max(1) - c.min(1)) / np.maximum(c.max(1), 1)
    warm = (c[:, 0] - c[:, 2])
    win = lum > np.percentile(lum, 70)
    wall = lum < np.percentile(lum, 40)
    mid = (lum >= np.percentile(lum, 40)) & (lum <= np.percentile(lum, 70))
    return dict(
        均值=lum.mean(), 窗光=lum[win].mean(), 墙=lum[wall].mean(), 亮占比=(lum > 190).mean() * 100,
        起伏=lum.std(), 暖度=warm.mean(), 饱和=sat.mean(),
        # 墙中 = 40–70 百分位亮度（窗间的墩 / 楼板，最能看出"墙是亮还是暗"）；窗暖 = 最亮 30 % 像素的 R−B（奶白 vs 橙黄）
        墙中=lum[mid].mean(), 窗暖=warm[win].mean())


def main():
    ref = np.asarray(Image.open(REF).convert("RGB"), float)
    cur = np.asarray(Image.open(sys.argv[1]).convert("RGB").resize((1536, 864)), float)
    print(f"{'':16s} {'':4s} {'均值':>6s} {'窗光':>6s} {'墙':>6s} {'亮占比%':>7s} {'起伏':>6s} {'暖度':>6s} {'饱和':>6s} {'墙中':>6s} {'窗暖':>6s}")
    for name, box in BLOCKS.items():
        for tag, a in (("设计稿", ref), ("现在", cur)):
            s = stats(a, box)
            print(f"{name:14s} {tag:5s} {s['均值']:6.1f} {s['窗光']:6.1f} {s['墙']:6.1f} {s['亮占比']:7.1f} {s['起伏']:6.1f} {s['暖度']:6.1f} {s['饱和']:6.2f} {s['墙中']:6.1f} {s['窗暖']:6.1f}")


if __name__ == "__main__":
    main()

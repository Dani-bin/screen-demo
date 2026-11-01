#!/usr/bin/env python3
"""
住宅楼栋整页尺度的亮度分布：设计稿 vs 渲染（评审机位 1536×864），各栋立面的 5 / 25 / 50 / 75 / 95 分位和均值。
块统计会被"深墙 + 亮窗"和"浅墙 + 暗框 + 亮芯"骗过，分位分布不会——整栋楼一起量，才能看出墙是亮还是暗、窗是不是黑的。
用法：python3 scripts/estate/img2/bl_stats.py <渲染.png>
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
BOXES = {
    "B01": (478, 70, 560, 222), "B02": (606, 112, 690, 262), "B03": (836, 112, 920, 262), "B04": (950, 70, 1040, 222),
    "B05/6": (430, 258, 600, 328), "B07/8": (405, 330, 600, 400), "B09/10": (915, 258, 1090, 328), "B11/12": (915, 330, 1110, 400),
    "B13/14": (448, 500, 640, 560), "B15/16": (872, 500, 1068, 560),
}


def main():
    d = np.asarray(Image.open(ROOT / "docs/design/estate/design/src/scene-a1.png").convert("RGB"), float)
    r = np.asarray(Image.open(sys.argv[1]).convert("RGB").resize((1536, 864), Image.Resampling.LANCZOS), float)

    def pc(im, box):
        x0, y0, x1, y1 = box
        c = im[y0:y1, x0:x1].reshape(-1, 3)
        L = c @ [0.2126, 0.7152, 0.0722]
        return np.percentile(L, [5, 25, 50, 75, 95]).astype(int), L.mean(), (c[:, 0] - c[:, 2]).mean()

    print("区域    分位 5/25/50/75/95（设计稿）          （现在）               均值 设|现   暖度 设|现")
    tot = []
    for k, b in BOXES.items():
        a, am, aw = pc(d, b)
        c, cm, cw = pc(r, b)
        tot.append(np.abs(a - c).mean())
        print("%-7s %-30s %-30s %4.0f|%4.0f  %4.0f|%4.0f" % (k, list(a), list(c), am, cm, aw, cw))
    print("分位平均绝对差 %.1f" % np.mean(tot))


main()

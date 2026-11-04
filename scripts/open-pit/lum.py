"""量页面截图中央三维区（x 450–1470、y 190–930）的亮度分布，和设计稿对比。

用法：python3 scripts/open-pit/lum.py <截图.png> [<截图2.png> ...]
设计稿（design/final.png）的参考值：RGB 均值 19 / 43 / 58，亮度均值 37、中位 26、90 分位 80、亮度 > 120 的像素占 3.8 %。
第 5 轮起页面越调越亮，评审分数同步下降（见 docs/design/open-pit/11-review-report.md），所以改 3D 之后先跑这个再送评审。
"""
import sys

import numpy as np
from PIL import Image

DESIGN = "docs/design/open-pit/design/final.png"


def stats(path):
    im = np.asarray(Image.open(path).convert("RGB")).astype(float)
    c = im[190:930, 450:1470]  # 中央三维区，避开两侧栏和上下面板
    lum = 0.299 * c[..., 0] + 0.587 * c[..., 1] + 0.114 * c[..., 2]
    p50, p90, p99 = np.percentile(lum, [50, 90, 99])
    return c.reshape(-1, 3).mean(0), lum.mean(), (lum > 120).mean() * 100, p50, p90, p99


def show(name, path):
    rgb, mean, bright, p50, p90, p99 = stats(path)
    print(f"{name:<22} RGB {rgb[0]:5.1f} {rgb[1]:5.1f} {rgb[2]:5.1f}  亮度均值 {mean:5.1f}  >120 {bright:4.1f}%  p50/p90/p99 {p50:3.0f}/{p90:3.0f}/{p99:3.0f}")


if __name__ == "__main__":
    show("设计稿", DESIGN)
    for p in sys.argv[1:]:
        show(p.split("/")[-1], p)

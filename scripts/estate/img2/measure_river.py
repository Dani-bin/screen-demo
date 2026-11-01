#!/usr/bin/env python3
"""
/estate 还原：从参考图量河的北岸线和南缘线
----------------------------------------------------------
参考图（scene-a1.png）里河是画面下部最大的一块蓝色水体：按"蓝通道明显高于红"抠出，取最大连通块，
每隔 48 个像素列取这一列蓝像素的最上点（北岸）和最下点（南缘），用评审机位反投影到 z = 0.7 的水面，
得到世界坐标下的 (x, y北岸, y南缘)。两端超出画面的部分由 build_spec.py 沿端点外推并被金边内缘裁掉。
输出：src/views/estate/scene/img2/river.json（生成物，不要手改）
用法：python3 scripts/estate/img2/measure_river.py
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(__file__))
import refcam as rc  # noqa: E402

ROOT = rc.ROOT


def main():
    ref = np.asarray(Image.open(os.path.join(ROOT, "docs/design/estate/design/src/scene-a1.png")).convert("RGB"), float)
    m = (ref[..., 2] > ref[..., 0] + 25) & (ref[..., 2] > 60) & (ref[..., 2] >= ref[..., 1] * 0.88)
    m[:600] = False
    m = ndi.binary_opening(ndi.binary_closing(m, iterations=3), iterations=1)
    lab, n = ndi.label(m)
    sizes = ndi.sum(m, lab, range(1, n + 1))
    river = lab == (1 + int(np.argmax(sizes)))
    rows = []
    for x in range(0, rc.W, 48):
        ys = np.nonzero(river[:, x])[0]
        if len(ys) < 12:
            continue
        gn = rc.ground_point(x, int(ys.min()), 0.7)
        gs = rc.ground_point(x, int(ys.max()), 0.7)
        rows.append([round((gn[0] + gs[0]) / 2, 1), round(gn[1], 1), round(gs[1], 1)])
    rows.sort()
    arr = np.array(rows)
    # 三点滑动平均，去掉树冠遮挡和高光造成的单列抖动
    for c in (1, 2):
        arr[1:-1, c] = np.convolve(arr[:, c], np.ones(3) / 3, mode="valid")
    out = {"columns": arr.round(1).tolist(), "note": "每行 [x, 北岸 y, 南缘 y]，世界坐标（米），水面 z = 0.7；见 measure_river.py"}
    dst = os.path.join(ROOT, "src", "views", "estate", "scene", "img2", "river.json")
    json.dump(out, open(dst, "w"), ensure_ascii=False, indent=1)
    print(f"{len(rows)} 列，x ∈ [{arr[0, 0]:.0f}, {arr[-1, 0]:.0f}]，中线宽 {np.median(arr[:, 1] - arr[:, 2]):.0f} m")


if __name__ == "__main__":
    main()

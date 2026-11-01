#!/usr/bin/env python3
"""
草丛和花的撒点（给 Blender 的 Cycles 渲染用）
----------------------------------------------------------
读 models/estate/render/ground_albedo.png（页面导出的地面底图，草地是三种草色），在草地上撒：
  tufts   草丛：每 ~0.45 m² 一丛，约 12 万丛，颜色在黄绿 / 深绿之间随机
  flowers 花：在步道和楼脚边的草地上成簇（一簇 25–40 朵，半径 2–3 m），粉 / 黄 / 白 / 紫 / 红
输出 models/estate/render/grass_points.json（世界坐标，米；x 向东、y 向北）。
画布和世界坐标的对应同 src/views/estate/scene/ground.js：x0 = cx - rx，yN = cy + ry，px = (x - x0) * SC。
用法：python3 scripts/estate/make_grass.py
"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RENDER = os.path.join(ROOT, "models", "estate", "render")
BASE = {"cx": 10.0, "cy": -6.0, "rx": 285.0, "ry": 208.0}
LAWN = [(0x88, 0x91, 0x53), (0x93, 0xA2, 0x59), (0x86, 0x9B, 0x54)]

img = np.asarray(Image.open(os.path.join(RENDER, "ground_albedo.png")).convert("RGB"), dtype=np.int32)
H, W, _ = img.shape
SC = W / (BASE["rx"] * 2)
X0, YN = BASE["cx"] - BASE["rx"], BASE["cy"] + BASE["ry"]

# 草地遮罩：偏黄绿（g 明显大于 b，且不低于 r）——底图上草地有深浅斑块，不能只比三种草色；
# 路面（灰，r≈g≈b）、步道和楼底座（米色，r>g）、水（深蓝）都不满足
r_, g_, b_ = img[..., 0], img[..., 1], img[..., 2]
lawn = (g_ - b_ > 28) & (g_ >= r_ - 3) & (g_ > 90)
lawn = ndimage.binary_erosion(lawn, iterations=3)  # 离边界留一点，草不长到路上
# 椭圆之内
yy, xx = np.mgrid[0:H, 0:W]
wx, wy = X0 + xx / SC, YN - yy / SC
inside = ((wx - BASE["cx"]) / (BASE["rx"] - 6)) ** 2 + ((wy - BASE["cy"]) / (BASE["ry"] - 6)) ** 2 < 1
lawn &= inside
print("草地占比", round(lawn.mean() * 100, 1), "%")

rng = np.random.default_rng(20261031)
ys, xs = np.nonzero(lawn)

def world(px, py):
    return [round(float(X0 + px / SC), 2), round(float(YN - py / SC), 2)]

# 草丛
n = 120000
pick = rng.integers(0, len(xs), n)
tufts = []
for i in pick:
    jx, jy = rng.random(2) - 0.5
    x, y = world(xs[i] + jx * 3, ys[i] + jy * 3)
    tufts.append([x, y, round(float(rng.random()), 3)])  # 第三个数：颜色 / 高度随机因子

# 花簇：中心选在"草地里靠近硬地（路、步道、楼脚）"的地方
hard = ~lawn & inside
near_hard = ndimage.binary_dilation(hard, iterations=int(4 * SC)) & lawn & ~ndimage.binary_dilation(hard, iterations=int(1.0 * SC))
ys2, xs2 = np.nonzero(near_hard)
flowers = []
palette = 5
for _ in range(220):
    k = rng.integers(0, len(xs2))
    cx, cy = world(xs2[k], ys2[k])
    kind = int(rng.integers(0, palette))
    for _ in range(int(rng.integers(25, 41))):
        r = 2.2 * np.sqrt(rng.random())
        a = rng.random() * 6.2832
        x, y = cx + r * np.cos(a), cy + r * np.sin(a)
        px, py = int((x - X0) * SC), int((YN - y) * SC)
        if 0 <= px < W and 0 <= py < H and lawn[py, px]:
            flowers.append([round(float(x), 2), round(float(y), 2), kind if rng.random() < 0.8 else int(rng.integers(0, palette))])
json.dump({"tufts": tufts, "flowers": flowers}, open(os.path.join(RENDER, "grass_points.json"), "w"))
print("草丛", len(tufts), "花", len(flowers))

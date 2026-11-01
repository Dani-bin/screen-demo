#!/usr/bin/env python3
"""
/estate 还原：把设计稿的场景图按评审机位反投影到地面平面（projection-first 的地面贴图）
----------------------------------------------------------
对地面网格上的每个点 (x, y, 0)，用 fit_ref_camera.py 拟合的机位投到 scene-a1.png 上取色，得到一张俯视的地面底图：
道路、草坪、步道、水面、操场、驳岸都是设计稿自己的像素。楼体和树在图里是立体的，投到地面上会被"拉长"，
所以另外输出一张遮罩（楼体立面 + 屋顶投影范围），后面用邻域填补；树冠留着，当作地面上的绿色底色，实例树盖在上面。

输出（.img2threejs/ground/）：
  ground_raw.png      反投影结果（无去光照）
  ground_valid.png    有效像素遮罩（落在原图内且不是被遮挡的背面）
  meta.json           网格范围（世界坐标，米）、分辨率

用法：python3 scripts/estate/img2/rectify_ground.py [--res 0.3]
"""
import argparse
import json
import math
import os

import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


def basis(az, pit):
    th, ph = math.radians(az), math.radians(pit)
    f = np.array([math.cos(ph) * math.cos(th), math.cos(ph) * math.sin(th), -math.sin(ph)])
    r = np.array([math.sin(th), -math.cos(th), 0.0])
    u = np.cross(r, f)
    return f, r, u


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--res", type=float, default=0.3, help="地面网格分辨率（米 / 像素）")
    ap.add_argument("--pad", type=float, default=1.06, help="网格比底座包围盒放大的倍数")
    args = ap.parse_args()

    cam = json.load(open(os.path.join(ROOT, ".img2threejs", "camera-ref.json")))
    layout = json.load(open(os.path.join(ROOT, "src/views/estate/data/layout.json")))
    base = layout["base"]
    W, H = cam["image"]
    fov = cam["fovDeg"]
    az, pit = cam["azimuthDeg"], cam["pitchDeg"]
    px, py, pz = cam["three"]["position"]
    C = np.array([px, -pz, py])  # three → 世界（x 东，y 北，z 上）
    f, r, u = basis(az, pit)
    foc = (H / 2) / math.tan(math.radians(fov) / 2)

    x0, x1 = base["cx"] - base["rx"] * args.pad, base["cx"] + base["rx"] * args.pad
    y0, y1 = base["cy"] - base["ry"] * args.pad, base["cy"] + base["ry"] * args.pad
    nx, ny = int((x1 - x0) / args.res), int((y1 - y0) / args.res)
    xs = x0 + (np.arange(nx) + 0.5) * args.res
    ys = y1 - (np.arange(ny) + 0.5) * args.res  # 行 0 = 最北
    X, Y = np.meshgrid(xs, ys)
    d = np.stack([X - C[0], Y - C[1], np.zeros_like(X) - C[2]], -1)
    z = d @ f
    sx = W / 2 + foc * (d @ r) / z
    sy = H / 2 - foc * (d @ u) / z
    valid = (z > 1) & (sx >= 0) & (sx <= W - 1) & (sy >= 0) & (sy <= H - 1)

    im = np.asarray(Image.open(os.path.join(ROOT, "docs/design/estate/design/src/scene-a1.png")).convert("RGB"), float)
    out = np.zeros((ny, nx, 3), float)
    for c in range(3):
        out[..., c] = map_coordinates(im[..., c], [sy, sx], order=1, mode="nearest")
    out[~valid] = 0
    gd = os.path.join(ROOT, ".img2threejs", "ground")
    os.makedirs(gd, exist_ok=True)
    Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(os.path.join(gd, "ground_raw.png"))
    Image.fromarray((valid * 255).astype(np.uint8)).save(os.path.join(gd, "ground_valid.png"))
    json.dump({"x0": x0, "x1": x1, "y0": y0, "y1": y1, "nx": nx, "ny": ny, "res": args.res},
              open(os.path.join(gd, "meta.json"), "w"), indent=1)
    print(f"地面网格 {nx}×{ny}（{args.res} m/px），有效 {valid.mean() * 100:.1f} %")


if __name__ == "__main__":
    main()

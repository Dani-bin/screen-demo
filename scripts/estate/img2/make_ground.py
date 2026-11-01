#!/usr/bin/env python3
"""
/estate 还原：地面贴图、树和路灯的位置，全部从设计稿（scene-a1.png）反投影得到
----------------------------------------------------------
img2threejs 的 projection-first：地面上的道路、草坪、步道、水面、操场、驳岸，用设计稿自己的像素；
树的位置、大小、颜色从反投影后的地面图里采样；路灯取自图里孤立的亮暖色光点。

步骤：
 1. 对底座内的椭圆范围（金边内缘）每个地面点 (x, y, 0.45) 用评审机位投回原图取色 → 俯视地面图；
 2. 楼体是立体的，投到地面上会被"拉长"：用 footprints.json（build_spec.py 导出）里每个体积的 8 个角点，
    经评审机位投到像素、再落回地面，取凸包，扩 1.2 m 作遮罩；遮罩内用最近邻颜色填补并模糊（楼本身由 3D 模型盖住）；
 3. 树：在"有颜色且纹理起伏大"的区域取局部极大点（最小间距 2.8 m），颜色取图里该处的中值色，半径由局部块大小估计；
 4. 路灯：反投影图里孤立的小亮暖点；
 5. 椭圆外 alpha = 0，输出 public/estate/img2/ground.webp、ground_info.json、trees.json、lamps.json。

用法：python3 scripts/estate/img2/make_ground.py [--res 0.35]
"""
import argparse
import json
import math
import os
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage.feature import peak_local_max

sys.path.insert(0, os.path.dirname(__file__))
import refcam as rc  # noqa: E402

ROOT = rc.ROOT
IMG2 = os.path.join(ROOT, "src", "views", "estate", "scene", "img2")
OUT = os.path.join(ROOT, "public", "estate", "img2")


def project_px(x, y, z):
    """世界点 → 评审图像素"""
    d = np.array([x, y, z]) - rc.C
    zc = d @ rc.F
    return rc.W / 2 + rc.FOC * (d @ rc.R) / zc, rc.H / 2 - rc.FOC * (d @ rc.U) / zc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--res", type=float, default=0.35)
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    fp = json.load(open(os.path.join(IMG2, "footprints.json")))
    b = fp["base"]
    cx0, cy0 = b["cx"], b["cy"]
    ax, ay = b["rx"] - 6, b["ry"] - 6  # 地面盘半轴（金边内缘）
    x0, x1, y0, y1 = cx0 - ax, cx0 + ax, cy0 - ay, cy0 + ay
    nx, ny = int((x1 - x0) / args.res), int((y1 - y0) / args.res)
    gz = 0.45

    # ---- 1. 反投影取色
    xs = x0 + (np.arange(nx) + 0.5) * args.res
    ys = y1 - (np.arange(ny) + 0.5) * args.res  # 行 0 = 最北
    X, Y = np.meshgrid(xs, ys)
    d = np.stack([X - rc.C[0], Y - rc.C[1], np.full_like(X, gz) - rc.C[2]], -1)
    zc = d @ rc.F
    sx = rc.W / 2 + rc.FOC * (d @ rc.R) / zc
    sy = rc.H / 2 - rc.FOC * (d @ rc.U) / zc
    src = np.asarray(Image.open(os.path.join(ROOT, "docs/design/estate/design/src/scene-a1.png")).convert("RGB"), np.float32)
    raw = np.zeros((ny, nx, 3), np.float32)
    for c in range(3):
        raw[..., c] = ndi.map_coordinates(src[..., c], [sy, sx], order=1, mode="nearest")
    in_img = (sx >= 0) & (sx <= rc.W - 1) & (sy >= 0) & (sy <= rc.H - 1)
    ell = ((X - cx0) / ax) ** 2 + ((Y - cy0) / ay) ** 2 <= 1.0

    # ---- 2. 楼体遮罩：8 个角点经相机落回地面，取凸包，扩 1.2 m
    def to_grid(px_, py_):
        gx, gy = rc.ground_point(px_, py_, gz)
        return (gx - x0) / args.res, (y1 - gy) / args.res

    bmask = np.zeros((ny, nx), np.uint8)
    for f in fp["footprints"]:
        al = f["ry"]
        pts = []
        for u in (-f["w"] / 2, f["w"] / 2):
            for v in (-f["d"] / 2, f["d"] / 2):
                ex = f["cx"] + u * math.cos(al) + v * math.sin(al)
                ny_ = f["cy"] + u * math.sin(al) - v * math.cos(al)
                for z in (gz, f["top"]):
                    pxl, pyl = project_px(ex, ny_, z)
                    pts.append(to_grid(pxl, pyl))
        hull = cv2.convexHull(np.array(pts, np.float32)).astype(np.int32)
        cv2.fillConvexPoly(bmask, hull, 255)
    bmask = cv2.dilate(bmask, np.ones((int(2 * 1.2 / args.res) | 1,) * 2, np.uint8)) > 0
    print(f"地面网格 {nx}×{ny}（{args.res} m/px），楼体遮罩 {bmask.mean() * 100:.1f} %")

    # ---- 3. 树 / 4. 路灯（在遮罩外、椭圆内、图内的有效区域）
    valid = ell & in_img & ~bmask
    hsv = cv2.cvtColor(raw.astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
    H_, S_, V_ = hsv[..., 0] * 2, hsv[..., 1] / 255, hsv[..., 2] / 255
    lum = V_
    mean = cv2.blur(lum, (7, 7))
    std = np.sqrt(np.maximum(cv2.blur(lum * lum, (7, 7)) - mean * mean, 0))
    # 树冠：偏绿 / 黄 / 橙 / 红，有一定饱和度，不是蓝色水面，纹理起伏大
    hue_ok = ((H_ >= 10) & (H_ <= 170)) | (H_ <= 8) | (H_ >= 345)
    water = (H_ > 175) & (H_ < 250) & (S_ > 0.25)
    # 水面（蓝色，含高光）、跌水（白蓝水帘）、湖、泳池都不长树：水体膨胀 6 px，再加上按位置圈出的跌水 / 湖 / 泳池
    water_big = cv2.dilate(water.astype(np.uint8), np.ones((13, 13), np.uint8)) > 0
    zone = np.zeros_like(water_big)
    def mark(cx_, cy_, rx_, ry_):  # 椭圆区域（世界坐标）
        zone[((X - cx_) / rx_) ** 2 + ((Y - cy_) / ry_) ** 2 <= 1] = True
    mark(0, 68, 9, 46)          # 跌水（含两侧水帘）
    mark(0, -8, 44, 38)         # 中央湖 + 环湖路内侧
    mark(0, -86, 17, 8)         # 会所前泳池
    score = np.clip(std / 0.10, 0, 1) * (S_ > 0.22) * hue_ok * ~water_big * ~zone * (V_ > 0.10) * (V_ < 0.85)
    score = cv2.GaussianBlur(score.astype(np.float32), (0, 0), 2.2)
    pk = peak_local_max(score, min_distance=int(2.3 / args.res), threshold_abs=0.16, labels=valid.astype(int), exclude_border=False)
    print("树候选", len(pk))
    # 按分数留前 2400
    pk = pk[np.argsort(-score[pk[:, 0], pk[:, 1]])][:2800]
    trees = []
    rng = np.random.default_rng(2026)
    blob = ndi.distance_transform_edt(score > 0.2)
    for r_, c_ in pk:
        patch = raw[max(0, r_ - 3): r_ + 4, max(0, c_ - 3): c_ + 4].reshape(-1, 3)
        col = np.median(patch, 0)
        # 树冠色：抬一档亮度（图里树冠在冠下阴影里偏暗，3D 树自己有阴影）
        # 颜色直接用图里的中值色；3D 树自己的明暗由灯光 + 一点自发光给出
        rad = float(np.clip(blob[r_, c_] * args.res * 0.55 + 1.0, 1.5, 3.0)) * (0.9 + 0.2 * rng.random())
        trees.append({"x": round(x0 + (c_ + 0.5) * args.res, 2), "y": round(y1 - (r_ + 0.5) * args.res, 2), "r": round(rad, 2),
                      "h": round(rad * (1.5 + 0.5 * rng.random()), 2), "c": "#%02x%02x%02x" % tuple(int(v) for v in col)})
    json.dump(trees, open(os.path.join(OUT, "trees.json"), "w"), separators=(",", ":"))
    print("树", len(trees))

    # 路灯：孤立的亮暖点（V 很高、偏黄橙、面积很小），不在楼体遮罩里
    warm = (V_ > 0.93) & (S_ > 0.18) & ((H_ <= 60) | (H_ >= 340)) & valid & ~water_big & ~zone
    lab, n = ndi.label(warm)
    cm = ndi.center_of_mass(warm, lab, range(1, n + 1))
    sz = ndi.sum(warm, lab, range(1, n + 1))
    lamps = [{"x": round(x0 + (c + 0.5) * args.res, 2), "y": round(y1 - (r + 0.5) * args.res, 2)}
             for (r, c), s_ in zip(cm, sz) if 1 <= s_ <= 40][:400]
    json.dump(lamps, open(os.path.join(OUT, "lamps.json"), "w"), separators=(",", ":"))
    print("路灯", len(lamps))

    # ---- 2'. 遮罩内填补：模糊的最近邻底色 + 从别处植被区"借"来的高频细节（不然是一条条拉丝）
    fill_src = ~bmask & in_img
    idx = ndi.distance_transform_edt(~fill_src, return_distances=False, return_indices=True)
    base = cv2.GaussianBlur(raw[idx[0], idx[1]], (0, 0), 6)
    detail = raw - cv2.GaussianBlur(raw, (0, 0), 5)  # 高频细节层
    donor = valid & (S_ > 0.20) & (std > 0.04)  # 供体：植被且有起伏
    hole = bmask | ~in_img
    add = np.zeros_like(raw)
    todo = hole.copy()
    rows, cols = np.mgrid[0:ny, 0:nx]
    for dy, dx in ((-260, 0), (260, 0), (0, -420), (0, 420), (-180, 300), (180, -300), (-120, -260), (120, 260), (-340, 150), (340, -150)):
        sr, sc = rows + dy, cols + dx
        ok = (sr >= 0) & (sr < ny) & (sc >= 0) & (sc < nx)
        srr, scc = np.clip(sr, 0, ny - 1), np.clip(sc, 0, nx - 1)
        take = todo & ok & donor[srr, scc]
        add[take] = detail[srr[take], scc[take]]
        todo &= ~take
    out = np.where(hole[..., None], np.clip(base + add * 1.1, 0, 255), raw)
    # 填补区边缘 4 px 羽化，免得和真实像素之间有硬接缝
    soft = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 2.0)[..., None]
    out = raw * (1 - soft) + out * soft
    rgba = np.dstack([np.clip(out, 0, 255).astype(np.uint8), (ell * 255).astype(np.uint8)])
    Image.fromarray(rgba, "RGBA").save(os.path.join(OUT, "ground.webp"), quality=90, method=4)
    Image.fromarray(np.clip(raw, 0, 255).astype(np.uint8)).save(os.path.join(ROOT, ".img2threejs", "ground", "ground_masked_src.png"))
    # 调试叠图：树点（青）和灯（品红）
    dbg = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).convert("RGB")
    from PIL import ImageDraw
    dd = ImageDraw.Draw(dbg)
    for t in trees:
        cx_, cy_ = (t["x"] - x0) / args.res, (y1 - t["y"]) / args.res
        dd.ellipse([cx_ - 2, cy_ - 2, cx_ + 2, cy_ + 2], outline=(0, 255, 255))
    for l in lamps:
        cx_, cy_ = (l["x"] - x0) / args.res, (y1 - l["y"]) / args.res
        dd.rectangle([cx_ - 2, cy_ - 2, cx_ + 2, cy_ + 2], outline=(255, 0, 220))
    dbg.save(os.path.join(ROOT, ".img2threejs", "ground", "ground_debug.png"))
    json.dump({"x0": x0, "x1": x1, "y0": y0, "y1": y1, "nx": nx, "ny": ny, "res": args.res, "z": gz},
              open(os.path.join(OUT, "ground_info.json"), "w"), indent=1)
    print("写入", os.path.relpath(OUT, ROOT))


if __name__ == "__main__":
    main()

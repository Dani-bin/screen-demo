#!/usr/bin/env python3
"""
/estate 还原评审机位：在 AI 场景原图（scene-a1.png，1536×864）坐标下拟合
----------------------------------------------------------
页面主机位（camera.json）是按构图另解的（40° 俯角、拉近、底座左右出画），不等于设计稿里的取景。
img2threejs 还原的评审要把渲染图和 scene-a1.png 逐区对比，所以这里单独拟合一个"和原图同取景"的机位，
不改页面的 camera.json。

做法和 fit_camera.py 相同（固定竖直视场角 28°、滚转 0），但像素直接取概念图原图坐标（ANCHOR 表本来就是原图坐标），
不做 1.125 倍 + (96, 96) 的整屏换算。可以固定俯角（--pitch），也可以自由拟合（默认），并把几个底座轮廓点投影出来，
叠在原图上检查底座椭圆是否对得上。

输出：.img2threejs/camera-ref.json（three.js 坐标：位置、目标、视场角）和 .img2threejs/evidence/camera-ref-check.png
用法：python3 scripts/estate/img2/fit_ref_camera.py [--pitch 46]
"""
import argparse
import importlib.util
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw
from scipy.optimize import least_squares

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
W, H = 1536, 864

# 复用 fit_camera.py 的投影和锚点表，不重复写一份
spec = importlib.util.spec_from_file_location("fit_camera", os.path.join(ROOT, "scripts", "estate", "fit_camera.py"))
fc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fc)
fc.W, fc.H = W, H  # 投影里用到的画面尺寸换成原图尺寸


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pitch", type=float, default=None, help="固定俯角（度）；不给则自由拟合")
    args = ap.parse_args()

    layout = json.load(open(os.path.join(ROOT, "src/views/estate/data/layout.json")))
    pts = []
    for b in layout["buildings"]:
        pts.append((b["id"], fc.ANCHOR[b["id"]], [b["cx"], b["cy"], b["height"]]))
    by_id = {a["id"]: a for a in layout["amenities"]}
    for pid, img in fc.EXTRA.items():
        a = by_id[pid]
        pts.append((pid, img, [a["cx"], a["cy"], a["height"]]))
    world = np.array([p[2] for p in pts], float)
    px = np.array([p[1] for p in pts], float)

    fc.FIXED_PITCH = args.pitch
    x = fc.fit(world, px)
    if args.pitch is not None:
        x[1] = args.pitch
    az, pit, cx, cy, cz = x
    res = fc.project(x, world) - px
    err = np.linalg.norm(res, axis=1)
    rms = float(math.sqrt((err**2).mean()))
    print(f"方位 {az:.2f}°，俯角 {pit:.2f}°，相机 ({cx:.1f}, {cy:.1f}, {cz:.1f}) m，RMS {rms:.1f} px，最大 {err.max():.1f} px")

    f, _, _ = fc.basis(az, pit)
    t = -cz / f[2]
    tgt = np.array([cx, cy, cz]) + f * t
    three = {
        "type": "PerspectiveCamera",
        "position": [round(cx, 3), round(cz, 3), round(-cy, 3)],
        "target": [round(float(tgt[0]), 3), 0.0, round(float(-tgt[1]), 3)],
        "up": [0, 1, 0],
        "fov": fc.FOV,
        "aspect": W / H,
    }
    out = {"image": [W, H], "fovDeg": fc.FOV, "azimuthDeg": round(az, 3), "pitchDeg": round(pit, 3),
           "residualRms": round(rms, 2), "three": three}
    os.makedirs(os.path.join(ROOT, ".img2threejs", "evidence"), exist_ok=True)
    json.dump(out, open(os.path.join(ROOT, ".img2threejs", "camera-ref.json"), "w"), ensure_ascii=False, indent=1)
    # 实验页（estate-lab.html）直接 import 的副本
    page_copy = os.path.join(ROOT, "src", "views", "estate", "scene", "img2", "camera-ref.json")
    os.makedirs(os.path.dirname(page_copy), exist_ok=True)
    json.dump(out, open(page_copy, "w"), ensure_ascii=False, indent=1)

    # 叠图：品红 = 锚点，青 = 拟合；黄色椭圆 = 把底座椭圆投影回去
    im = Image.open(os.path.join(ROOT, "docs/design/estate/design/src/scene-a1.png")).convert("RGB")
    d = ImageDraw.Draw(im)
    for p, q in zip(px, fc.project(x, world)):
        d.ellipse([p[0] - 4, p[1] - 4, p[0] + 4, p[1] + 4], outline=(255, 0, 200), width=2)
        d.ellipse([q[0] - 4, q[1] - 4, q[0] + 4, q[1] + 4], outline=(0, 230, 230), width=2)
    b = layout["base"]
    ring = np.array([[b["cx"] + b["rx"] * math.cos(a), b["cy"] + b["ry"] * math.sin(a), 0.0]
                     for a in np.linspace(0, 2 * math.pi, 181)])
    pr = fc.project(x, ring)
    d.line([tuple(p) for p in pr], fill=(255, 220, 0), width=2)
    im.save(os.path.join(ROOT, ".img2threejs", "evidence", "camera-ref-check.png"))
    print("写入 .img2threejs/camera-ref.json 与 evidence/camera-ref-check.png")


if __name__ == "__main__":
    main()

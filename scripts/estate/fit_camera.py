#!/usr/bin/env python3
"""
/estate 相机标定：从定稿反求页面主机位
----------------------------------------------------------
定稿 docs/design/estate/design/final.png（1920×1080）里，AI 概念图在整屏中是 1728×972、左上角 (96, 96)，
原图 1536×864。用「已知世界坐标的点」标定：
  - 16 栋楼的屋顶中心：像素取定稿里插牌的锚点（drafts.html 里 ANCHOR 表），世界坐标取 layout.json
    （x 向东、y 向北、z 向上，原点在地块中心，屋顶高 = 楼高）；
  - 景观湖中心、会所屋顶、泳池中心三处地面 / 低矮点。

为什么不用 calibrate.py 的透视模型：这张 AI 图的透视信息很弱，calibrate.py 的透视拟合把视场角推到
下限 2°、相机退到 9 km 外（近乎正交，残差 28.7 px），深度精度、阴影和移轴景深都没法用。
实测视场角从 2° 到 40° 残差只差 3 px，所以这里**固定竖直视场角 28°**（实体沙盘实拍常见的中焦），
其余自由度（方位、俯角、相机位置）做最小二乘；滚转固定为 0，让沙盘保持水平。

输出：
  docs/design/estate/07-camera.json                 完整标定结果和逐点残差
  src/views/estate/data/camera.json                 页面用（three.js 坐标：位置、目标、视场角）
  docs/design/estate/design/annotation-check.png    重投影叠图（品红 = 定稿标注，青色 = 拟合）

用法：python3 scripts/estate/fit_camera.py
"""
import json
import math
import os

import numpy as np
from scipy.optimize import least_squares

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DESIGN = os.path.join(ROOT, "docs", "design", "estate")
W, H = 1920, 1080
FOV = 28.0  # 竖直视场角（度），固定
FIXED_PITCH = 46.0  # 固定俯角（度）；None = 自由拟合。拟合出的 53° 是楼栋位置决定的，但概念图的底座和透视更像 35–40°，评审多轮指出页面太陡，折中取 46°

# 概念图原图坐标 → 定稿整屏坐标
K, OX, OY = 1728 / 1536, 96, 96


def to_px(x, y):
    return [round(OX + x * K, 1), round(OY + y * K, 1)]


# 楼栋屋顶锚点（概念图原图坐标），和 drafts.html 的 ANCHOR 同源
ANCHOR = {
    "B01": (525, 66), "B02": (648, 118), "B03": (878, 118), "B04": (1005, 64),
    "B05": (468, 270), "B06": (560, 270), "B07": (440, 360), "B08": (545, 360),
    "B09": (960, 272), "B10": (1045, 272), "B11": (975, 350), "B12": (1070, 350),
    "B13": (510, 515), "B14": (597, 515), "B15": (915, 520), "B16": (1005, 520),
}
# 其它点：编号 → 概念图坐标（世界坐标取自布局：中心 + 高度）
EXTRA = {"LK01": (757, 388), "CL01": (757, 508), "SW01": (755, 577)}


def basis(az, pit):
    """相机前向 f、右向 r、上向 u（世界坐标）；方位从 +x 往 +y 量，俯角向下为正，滚转 0"""
    th, ph = math.radians(az), math.radians(pit)
    f = np.array([math.cos(ph) * math.cos(th), math.cos(ph) * math.sin(th), -math.sin(ph)])
    r = np.array([math.sin(th), -math.cos(th), 0.0])
    u = np.cross(r, f)
    return f, r, u


def project(params, world):
    az, pit, cx, cy, cz = params
    f, r, u = basis(az, pit)
    foc = (H / 2) / math.tan(math.radians(FOV) / 2)
    d = world - np.array([cx, cy, cz])
    z = d @ f
    return np.stack([W / 2 + foc * (d @ r) / z, H / 2 - foc * (d @ u) / z], 1)


def fit(world, px):
    best = None
    for pit0 in (35, 45, 55):
        dist = 0.5 * 480 / math.tan(math.radians(FOV) / 2)
        f, _, _ = basis(90, pit0)
        c0 = np.array([0, -40, 20]) - f * dist
        def resid(x):
            p = np.array(x, float)
            if FIXED_PITCH is not None:
                p[1] = FIXED_PITCH
            return (project(p, world) - px).ravel()
        r = least_squares(resid, [90, pit0, *c0], x_scale=[1, 1, 50, 50, 50])
        if best is None or r.cost < best.cost:
            best = r
    return best.x


def main():
    layout = json.load(open(os.path.join(ROOT, "src/views/estate/data/layout.json")))
    pts = []
    for b in layout["buildings"]:
        pts.append({"id": b["id"], "px": to_px(*ANCHOR[b["id"]]),
                    "world": [b["cx"], b["cy"], b["height"]]})
    by_id = {a["id"]: a for a in layout["amenities"]}
    for pid, img in EXTRA.items():
        a = by_id[pid]
        pts.append({"id": pid, "px": to_px(*img), "world": [a["cx"], a["cy"], a["height"]]})

    ann = {"image": [W, H], "rects": [], "points": pts}
    json.dump(ann, open(os.path.join(DESIGN, "design", "annotations.json"), "w"),
              ensure_ascii=False, indent=1)

    world = np.array([p["world"] for p in pts], float)
    px = np.array([p["px"] for p in pts], float)
    x = fit(world, px)
    if FIXED_PITCH is not None:
        x[1] = FIXED_PITCH
    az, pit, cx, cy, cz = x
    res = project(x, world) - px
    err = np.linalg.norm(res, axis=1)
    rms = float(math.sqrt((err ** 2).mean()))
    print(f"固定视场角 {FOV}°：方位 {az:.2f}°，俯角 {pit:.2f}°，相机 ({cx:.1f}, {cy:.1f}, {cz:.1f}) m，"
          f"RMS {rms:.1f} px，最大 {err.max():.1f} px")

    # 光轴和地面（z = 0）的交点，作为 three.js 的目标点
    f, r, u = basis(az, pit)
    t = -cz / f[2]
    tgt = np.array([cx, cy, cz]) + f * t
    # three.js 坐标 (X, Y, Z) = (x, z, -y)
    three = {
        "type": "PerspectiveCamera",
        "position": [round(cx, 3), round(cz, 3), round(-cy, 3)],
        "target": [round(float(tgt[0]), 3), 0.0, round(float(-tgt[1]), 3)],
        "up": [0, 1, 0],
        "fov": FOV,
        "aspect": W / H,
    }
    full = {
        "model": "persp-fixed-fov", "image": [W, H], "fovDeg": FOV,
        "azimuthDeg": round(az, 3), "pitchDeg": round(pit, 3), "rollDeg": 0.0,
        "distance": round(float(t), 1),
        "residualPx": {"rms": round(rms, 2), "max": round(float(err.max()), 2)},
        "perPoint": {p["id"]: [round(float(a), 1), round(float(b), 1)] for p, (a, b) in zip(pts, res)},
        "three": three,
        "note": "固定视场角 28° 的最小二乘拟合；calibrate.py 的透视拟合会退化成近正交（视场角触底 2°），见本脚本头注释",
    }
    json.dump(full, open(os.path.join(DESIGN, "07-camera.json"), "w"), ensure_ascii=False, indent=1)
    page = {"image": [W, H], "fovDeg": FOV, "residualRms": round(rms, 2), "three": three}
    dst = os.path.join(ROOT, "src/views/estate/data/camera.json")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    json.dump(page, open(dst, "w"), ensure_ascii=False, indent=1)
    print("写入 07-camera.json、", os.path.relpath(dst, ROOT))

    # 重投影叠图
    try:
        from PIL import Image, ImageDraw
        im = Image.open(os.path.join(DESIGN, "design", "final.png")).convert("RGB")
        d = ImageDraw.Draw(im)
        for p, q in zip(px, project(x, world)):
            d.ellipse([p[0] - 5, p[1] - 5, p[0] + 5, p[1] + 5], outline=(255, 0, 200), width=2)
            d.ellipse([q[0] - 5, q[1] - 5, q[0] + 5, q[1] + 5], outline=(0, 230, 230), width=2)
            d.line([tuple(p), tuple(q)], fill=(255, 255, 255), width=1)
        im.save(os.path.join(DESIGN, "design", "annotation-check.png"))
    except ImportError:
        pass


if __name__ == "__main__":
    main()

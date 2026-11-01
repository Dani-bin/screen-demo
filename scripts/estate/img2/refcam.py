"""
评审机位的像素 ↔ 世界换算（供 build_spec.py 等脚本用）
----------------------------------------------------------
用 .img2threejs/camera-ref.json（scene-a1.png 1536×864 坐标下拟合的机位）：
  ground_point(px, py)            像素 → 地面（z = 0）上的世界坐标 (x 东, y 北)
  block_from_bbox(bbox, ...)      一个"白模块"的像素包围盒（含前立面 + 屋顶）→ 世界坐标的盒子 (cx, cy, w, d, h)
世界坐标：x 东、y 北、z 上，单位米。
"""
import json
import math
import os

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_cam = json.load(open(os.path.join(ROOT, ".img2threejs", "camera-ref.json")))
W, H = _cam["image"]
FOV = _cam["fovDeg"]
AZ, PIT = _cam["azimuthDeg"], _cam["pitchDeg"]
_px, _py, _pz = _cam["three"]["position"]
C = np.array([_px, -_pz, _py])  # three → 世界
FOC = (H / 2) / math.tan(math.radians(FOV) / 2)


def _basis():
    th, ph = math.radians(AZ), math.radians(PIT)
    f = np.array([math.cos(ph) * math.cos(th), math.cos(ph) * math.sin(th), -math.sin(ph)])
    r = np.array([math.sin(th), -math.cos(th), 0.0])
    return f, r, np.cross(r, f)


F, R, U = _basis()


def ray(px, py):
    """像素 → 世界射线方向"""
    d = F + R * ((px - W / 2) / FOC) + U * (-(py - H / 2) / FOC)
    return d / np.linalg.norm(d)


def ground_point(px, py, z=0.0):
    d = ray(px, py)
    t = (z - C[2]) / d[2]
    p = C + d * t
    return float(p[0]), float(p[1])


def dist_to(px, py):
    d = ray(px, py)
    t = -C[2] / d[2]
    return float(t)


def block_from_bbox(bbox, depth_ratio=0.65, hmin=8.0, hmax=40.0):
    """bbox = (x0, y0, x1, y1)：白模块的整个可见 blob（前立面 + 屋顶）。
    - 底边中点投到地面 → 前立面底边中心
    - 宽 = 像素宽 × 距离 / 焦距；进深按宽的 depth_ratio 估计（看不见后面）
    - 高：竖直像素跨度 = FOC/距离 × (h·cos(俯角) + d·sin(俯角)) → 解 h，夹在 [hmin, hmax]
    返回 (cx, cy, w, d, h)，cx/cy 是盒子底面中心（前缘往后退 d/2）。"""
    x0, y0, x1, y1 = bbox
    bx, by = (x0 + x1) / 2, y1
    gx, gy = ground_point(bx, by)
    dist = dist_to(bx, by)
    w = (x1 - x0) * dist / FOC
    d = w * depth_ratio
    ext = (y1 - y0) * dist / FOC
    h = (ext - d * math.sin(math.radians(PIT))) / math.cos(math.radians(PIT))
    h = max(hmin, min(hmax, h))
    # 前缘在地面点 (gx, gy)，相机朝北看，盒子向北（y 增大）延伸 d
    return round(gx, 1), round(gy + d / 2, 1), round(w, 1), round(d, 1), round(h, 1)

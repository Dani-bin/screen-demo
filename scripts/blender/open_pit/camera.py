"""设计稿相机：把设计稿场景图（1536 × 864）的像素反投影到地面，得到 Blender 世界坐标（米，x 东、y 北、z 上）。

设计稿的透视不自洽（AI 图），所以不去「标定」，而是选一个合理的相机，再把手读的坑沿环 / 坑底环用这个相机反投影：
这样从这个相机看过去，建出来的模型和设计稿的轮廓天然对得上；换个角度看，几何仍是合理的。
参数是 2026-11-03 对几组（俯角 30–48°、视场 24–32°）试算后选的：坑沿长轴约 2.3 km、坑深 150 m（10 级 15 m 台阶；显示时竖向放大 2 倍，见 DEPTH），
每级平台约 40 m 宽，和设计稿里宽平台、窄陡坎的样子一致。
"""
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))

W, H = 1536, 864  # 设计稿场景图像素
PITCH = 36.0  # 俯角（度，从水平往下）
VFOV = 24.0  # 垂直视场角（度）
DIST = 3500.0  # 相机到目标（世界原点）的距离 m
# 坑深按 2 倍竖向夸张显示（2026-11-03 第 17 轮）：设计稿的坑沿 / 坑底轮廓反投影后水平跨度 600–800 m，
# 真实的 150 m 深摊在上面，北帮总坡度只有 11°、每级陡坎 28°，从 36° 俯角看过去平台和陡坎一样宽，读成等高线；
# 300 m 时北帮总坡 28°、陡坎 53°，屏幕上陡坎约是平台的两倍高，才像设计稿里的岩壁。台阶仍是 10 级（每级显示 30 m）
DEPTH = 300.0  # 坑深 m（显示值，真实约 150 m）
BENCH = DEPTH / 10  # 台阶高 m
NB = 10  # 台阶数


def outline():
    return json.load(open(os.path.join(HERE, "outline.json"), encoding="utf-8"))


def pose():
    """相机位置、前 / 右 / 上单位向量（相机在目标正南偏上，看向正北）"""
    p = np.radians(PITCH)
    C = np.array([0.0, -DIST * np.cos(p), DIST * np.sin(p)])
    fwd = -C / np.linalg.norm(C)
    right = np.cross(fwd, [0, 0, 1.0])
    right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    return C, fwd, right, up


def focal_px():
    return (H / 2) / np.tan(np.radians(VFOV) / 2)


def backproject(pts, z=0.0):
    """图像像素 (x, y)（y 向下）→ 世界平面 z 上的点 (x, y)"""
    C, fwd, right, up = pose()
    f = focal_px()
    out = []
    for x, y in pts:
        d = fwd * f + right * (x - W / 2) + up * (-(y - H / 2))
        t = (z - C[2]) / d[2]
        out.append((C + t * d)[:2])
    return np.array(out)


def project(pts3):
    """世界点 (n, 3) → 图像像素 (n, 2)，用来核对模型和设计稿是否对齐"""
    C, fwd, right, up = pose()
    f = focal_px()
    out = []
    for p in np.asarray(pts3, float):
        v = p - C
        z = v @ fwd
        out.append((W / 2 + f * (v @ right) / z, H / 2 - f * (v @ up) / z))
    return np.array(out)

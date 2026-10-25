"""
带式输送机孪生：从定稿概念图反求相机与剖面沙盘尺寸
----------------------------------------------------------
定稿中央的概念图（docs/design/smart-conveyor/design/src/concept.png，1536 × 864）是一个切开的长方体地层块：
从右前上方看，能看到正面（长边）、右侧面和顶面。AI 图不是严格的长方体，按透视相机 + 长方体做最小二乘拟合：
  - 长方体：x 沿长边（左 → 右，0 … W），y 向上（0 … H），z 朝镜头（正面 z = 0，背面 z = −D）
  - 未知量：相机位置、朝向（偏航 / 俯仰 / 滚转）、焦距，以及 H / W、D / W（W 固定为 SIZE_W 米）
  - 观测：7 个角点的像素坐标（6 个轮廓角 + 顶面 / 正面 / 右侧面的交点），由 silhouette 阈值轮廓和网格放大图读出
然后把巷道折点、煤仓、地面建筑的像素位置反投影到"剖面平面"（z = −DEPTH × D 的竖直面）上，得到场景坐标。

输出 src/views/smart-conveyor/data/camera.json（页面主机位、定稿里概念图的位置）和 section.json（剖面示意布局）。
用法：python3 scripts/smart-conveyor/fit_camera.py
"""
import json
import math
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src" / "views" / "smart-conveyor" / "data"
IMG_W, IMG_H = 1536, 864
# 定稿里概念图的位置：左上角 (420, 150)，宽 1080（v1.no-convert.css 的 .scene）
PLACE = {"x": 420, "y": 150, "w": 1080}
SIZE_W = 6000.0  # 长方体长边（m，示意）

# 角点（概念图像素）。TFL 顶前左、BFL 底前左、BFR 底前右、TFR 顶前右（内角）、TBR 顶后右、BBR 底后右、TBL 顶后左
PX = {
    "TFL": (37, 238),
    "BFL": (40, 482),
    "BFR": (1388, 790),
    "TFR": (1396, 200),
    "TBR": (1517, 163),
    "BBR": (1501, 700),
    "TBL": (150, 205),
}


def corners(W, H, D):
    return {
        "TFL": (0, H, 0),
        "BFL": (0, 0, 0),
        "BFR": (W, 0, 0),
        "TFR": (W, H, 0),
        "TBR": (W, H, -D),
        "BBR": (W, 0, -D),
        "TBL": (0, H, -D),
    }


def rot(yaw, pitch, roll):
    """相机姿态：先偏航（绕 y）、再俯仰（绕 x）、再滚转（绕 z）；相机看 −z"""
    cy, sy = math.cos(yaw), math.sin(yaw)
    cp, sp = math.cos(pitch), math.sin(pitch)
    cr, sr = math.cos(roll), math.sin(roll)
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    Rz = np.array([[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]])
    return Ry @ Rx @ Rz  # 相机坐标 → 世界坐标


def project(params, P):
    cx, cy, cz, yaw, pitch, roll, f = params[:7]
    R = rot(yaw, pitch, roll)
    pc = (np.asarray(P, float) - [cx, cy, cz]) @ R  # 世界 → 相机
    u = IMG_W / 2 + f * pc[..., 0] / -pc[..., 2]
    v = IMG_H / 2 - f * pc[..., 1] / -pc[..., 2]
    return np.stack([u, v], -1)


def residual(x):
    H, D = x[7] * SIZE_W, x[8] * SIZE_W
    C = corners(SIZE_W, H, D)
    keys = list(PX)
    pred = project(x, [C[k] for k in keys])
    obs = np.array([PX[k] for k in keys], float)
    return (pred - obs).ravel()


def main():
    # 初值：镜头在右前上方，朝左后看
    x0 = [SIZE_W * 0.95, 3200, 5200, math.radians(25), math.radians(-28), 0.0, 1400, 0.22, 0.2]
    res = least_squares(residual, x0, x_scale="jac", max_nfev=20000)
    x = res.x
    r = residual(x).reshape(-1, 2)
    rms = float(np.sqrt((r**2).sum(1).mean()))
    W, H, D = SIZE_W, x[7] * SIZE_W, x[8] * SIZE_W
    fov = math.degrees(2 * math.atan(IMG_H / 2 / x[6]))
    print(f"残差 RMS {rms:.1f} px（各点：{', '.join(f'{k} {math.hypot(*e):.0f}' for k, e in zip(PX, r))}）")
    print(f"长方体 W {W:.0f} × H {H:.0f} × D {D:.0f} m，竖直视场 {fov:.1f}°")
    R = rot(*x[3:6])
    pos = np.array(x[:3])
    fwd = -R[:, 2]
    up = R[:, 1]
    target = pos + fwd * np.linalg.norm(pos - [W / 2, H / 2, -D / 2])
    return dict(x=x, W=W, H=H, D=D, fov=fov, pos=pos, target=target, up=up, rms=rms, R=R)


def ray(cam, u, v):
    x = cam["x"]
    f = x[6]
    d_cam = np.array([(u - IMG_W / 2) / f, -(v - IMG_H / 2) / f, -1.0])
    return cam["pos"], cam["R"] @ d_cam


def on_vertical(cam, u, v, z_plane):
    """概念图像素 → 与竖直面 z = z_plane 的交点 [x, y, z]"""
    o, d = ray(cam, u, v)
    t = (z_plane - o[2]) / d[2]
    p = o + d * t
    return [round(float(p[0]), 1), round(float(p[1]), 1), round(float(z_plane), 1)]


def on_horizontal(cam, u, v, y_plane):
    """概念图像素 → 与水平面 y = y_plane 的交点 [x, y, z]"""
    o, d = ray(cam, u, v)
    t = (y_plane - o[1]) / d[1]
    p = o + d * t
    return [round(float(p[0]), 1), round(float(y_plane), 1), round(float(p[2]), 1)]


# 概念图里的要素（像素，按 grid.png 网格读出）。井下要素在剖面平面上，地面要素在顶面上
DEPTH = 0.32  # 剖面平面在块内的深度（占 D 的比例）
UNDER = {
    # 综采工作面：支架一排（左端、右端）与工作面中线
    "face": [(100, 340), (392, 340)],
    # BC05：上一条顺槽皮带，从工作面右端到下运上山顶（与 BC04 衔接）
    "BC05": [(395, 333), (540, 333)],
    # BC04：下运上山，沿斜坡下到采区煤仓顶
    "BC04": [(540, 333), (600, 352), (660, 383), (682, 398), (682, 418)],
    # BC06：下一条顺槽皮带（掘进），在上山起点附近与 BC04 搭接
    "BC06": [(395, 376), (528, 376)],
    # 煤仓：中心线顶 / 底
    "MC01": [(680, 418), (680, 585)],
    "MC02": [(1338, 462), (1338, 648)],
    # BC03：主运输大巷，从采区煤仓底到井底煤仓（剖面里画成一条略下倾的直线）
    "BC03": [(700, 588), (900, 614), (1120, 640), (1318, 662)],
    # BC02：主斜井，从井底煤仓顶部一侧斜上到地面驱动机房（全链视图照定稿；煤仓特写里按上进下出画）
    "BC02": [(1356, 446), (1290, 332), (1180, 150)],
}
# 煤仓的左右边缘（像素），用来定半径
BUNKER_EDGE = {"MC01": (641, 719), "MC02": (1293, 1384)}
SURFACE = {
    # 地面：驱动机房、转载点、栈桥终点（原煤仓顶）、原煤仓、集控中心（低矮建筑之一）
    "driveHouse": (1170, 142),
    "BC01": [(1195, 140), (1398, 160)],
    "MC03": (1408, 170),
    "controlRoom": (1060, 178),
    "lowBuildings": [(1030, 175), (1090, 165), (1395, 185), (1450, 175)],
}


if __name__ == "__main__":
    cam = main()
    W, H, D = cam["W"], cam["H"], cam["D"]
    OUT.mkdir(parents=True, exist_ok=True)
    # 页面主机位：概念图在定稿里占 x 420–1500、y 150–757.5；整屏 1920 × 1080 的透视相机要让概念图那块区域对上，
    # 所以整屏的竖直视场按概念图高度在整屏中的比例放大，并把投影中心挪到概念图中心（setViewOffset）
    s = PLACE["w"] / IMG_W
    camera = {
        "source": "scripts/smart-conveyor/fit_camera.py（拟合 docs/design/smart-conveyor/design/src/concept.png 的长方体角点）",
        "rmsPx": round(cam["rms"], 2),
        "image": [IMG_W, IMG_H],
        "place": PLACE,
        "block": {"W": round(W, 1), "H": round(H, 1), "D": round(D, 1)},
        "fovImage": round(cam["fov"], 3),
        "position": [round(float(v), 2) for v in cam["pos"]],
        "target": [round(float(v), 2) for v in cam["target"]],
        "up": [round(float(v), 5) for v in cam["up"]],
        "focalPx": round(float(cam["x"][6]), 3),
        "scale": s,
    }
    (OUT / "camera.json").write_text(json.dumps(camera, ensure_ascii=False, indent=1))
    print("写出", OUT / "camera.json")

    # 剖面示意布局
    zp = -DEPTH * D
    section = {
        "source": "scripts/smart-conveyor/fit_camera.py（概念图像素反投影）",
        "block": camera["block"],
        "plane": round(zp, 1),
        "belts": {},
        "bunkers": {},
        "surface": {},
    }
    for k, pts in UNDER.items():
        poly = [on_vertical(cam, u, v, zp) for u, v in pts]
        if k.startswith("BC"):
            # BC06 在 BC05 前面一点（两条顺槽并排），避免重叠
            if k == "BC06":
                poly = [[p[0], p[1], round(zp + 60, 1)] for p in poly]
            section["belts"][k] = poly
        elif k == "face":
            section["face"] = poly
        else:
            top, bottom = poly
            l, r = BUNKER_EDGE[k]
            xl = on_vertical(cam, l, (pts[0][1] + pts[1][1]) / 2, zp)[0]
            xr = on_vertical(cam, r, (pts[0][1] + pts[1][1]) / 2, zp)[0]
            section["bunkers"][k] = {"x": top[0], "z": zp, "top": top[1], "bottom": bottom[1], "r": round((xr - xl) / 2, 1)}
    # 地面要素：顶面在画面里是一条很窄的带，视线几乎贴着它，和水平面求交不稳；
    # 改为投到块内深度 0.5 D 的竖直面上取 x，高度贴到顶面
    zs = -0.5 * D

    def surf(u, v):
        p = on_vertical(cam, u, v, zs)
        return [p[0], round(H, 1), round(zs, 1)]

    for k, v in SURFACE.items():
        section["surface"][k] = surf(*v) if isinstance(v, tuple) else [surf(u, w) for u, w in v]
    # BC01 栈桥：从驱动机房旁的转载点爬到原煤仓顶（示意高度）
    b1 = section["surface"]["BC01"]
    section["belts"]["BC01"] = [[b1[0][0], round(H + 40, 1), zs], [b1[1][0], round(H + 130, 1), zs]]
    # BC02 最后一点接到驱动机房（地面，深度从剖面平面过渡到地面要素所在的竖直面）
    bc2 = section["belts"]["BC02"]
    bc2[-1] = [section["surface"]["driveHouse"][0], round(H + 10, 1), round(zs, 1)]
    (OUT / "section.json").write_text(json.dumps(section, ensure_ascii=False, indent=1))
    print("写出", OUT / "section.json")
    for k, p in section["belts"].items():
        print(f"  {k}: {p[0]} → {p[-1]}")
    for k, b in section["bunkers"].items():
        print(f"  {k}: {b}")

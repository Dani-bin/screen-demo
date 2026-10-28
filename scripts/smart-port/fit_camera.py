"""
智慧港口：按定稿概念图拟合页面镜头（PortScene.setView 的参数）
----------------------------------------------------------
概念图里码头的比例和真实码头不同（见 docs/design/smart-port/README.md 冲突清单），
skill 的 calibrate.py 用单个矩形拟合不收敛，所以直接拟合页面自己的镜头参数：
把真实码头上几个参照点的投影对准概念图里的对应像素，
求 注视点 [u, v]、距离、方位 yaw、俯角 pitch、竖直视场角 fov，以及竖向夸张系数 vScale。投影公式和 PortScene.setView 一致。

参照点（第 8 轮比对起）：
  - 泊位刻度 B02–B06：页面锚点是泊位中点、v = 2、码头面高度，概念图里是标签中心；
  - 岸桥编号牌 QC14–QC18：页面锚点是岸桥顶上方 92 m（标签底边中点），概念图里标签底边；
    概念图标签的水平间距和仿真里岸桥位置对不上，这里按泊位刻度的比例把标签 x 换回岸线 u，只用它定高度（即竖向夸张）；
  - 陆侧北边界两端（被指标条挡住，位置是估的）：权重 0.3。
第 1–7 轮用的是岸线两端 + 北边界（没有竖向信息），拟合出的俯角 54° 让岸桥只有概念图的约 0.65 倍高。

用法：python3 scripts/smart-port/fit_camera.py   → 写 docs/design/smart-port/07-camera.json（view 块给页面用）
"""
import json
import math
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares

ROOT = Path(__file__).resolve().parents[2]
TOP = 6.9  # 码头面高度（ground.js 的 TOP）
W, H = 1920, 1080

# 参照点：真实 (u, v, 离码头面高度) ↔ 概念图像素（1920 × 1080）、是否随竖向夸张、权重
QC_H = 92 - TOP  # 岸桥牌锚点离码头面的高度（PortScene.anchors：y = 92）
PAIRS = [
    ((495.9, 2, 0), (515, 732), False, 1.0, "泊位刻度 B02"),
    ((826.4, 2, 0), (748, 654), False, 1.0, "泊位刻度 B03"),
    ((1157.0, 2, 0), (978, 575), False, 1.0, "泊位刻度 B04"),
    ((1487.6, 2, 0), (1210, 496), False, 1.0, "泊位刻度 B05"),
    ((1818.2, 2, 0), (1440, 418), False, 1.0, "泊位刻度 B06"),
    ((1205, 21, QC_H), (1012, 470), True, 1.0, "QC14 牌（底边）"),
    ((1305, 21, QC_H), (1081, 447), True, 1.0, "QC15 牌"),
    ((1405, 21, QC_H), (1151, 427), True, 1.0, "QC16 牌"),
    ((1505, 21, QC_H), (1222, 407), True, 1.0, "QC17 牌"),
    ((1605, 21, QC_H), (1295, 388), True, 1.0, "QC18 牌"),
    ((100, 560, 0), (40, 490), False, 0.3, "陆侧北边界西段（估）"),
    ((2000, 480, 0), (1450, 155), False, 0.3, "陆侧北边界东段（估）"),
]


def project(params, u, v, h, scaled=False):
    tu, tv, dist, yaw, pitch, fov, k = params
    y, p = math.radians(yaw), math.radians(pitch)
    target = np.array([tu, TOP, -tv])
    d = np.array([math.sin(y), 0, math.cos(y)])
    cam = target + d * dist * math.cos(p) + np.array([0, dist * math.sin(p), 0])
    f = target - cam
    f /= np.linalg.norm(f)
    r = np.cross(f, [0, 1, 0])
    r /= np.linalg.norm(r)
    up = np.cross(r, f)
    q = np.array([u, TOP + h * (k if scaled else 1), -v]) - cam
    zc = q @ f
    fy = (H / 2) / math.tan(math.radians(fov) / 2)
    return np.array([W / 2 + fy * (q @ r) / zc, H / 2 - fy * (q @ up) / zc])


def resid(params):
    return np.concatenate(
        [(project(params, *w, sc) - np.array(px)) * wt for w, px, sc, wt, _ in PAIRS]
    )


# 俯角、视场角固定：上面这些点几乎都在岸线上，定不住俯角（30°–52° 的残差都在 4–5 px，夸张系数跟着变 1.3–2.0），
# 视场角放开会一路降到下限（近乎正交）。按概念图地面告警圆环的扁度（短长比约 0.5 → 俯角约 30°）和评审意见压低到 40°，
# 视场角取 12°（保留一点透视，近景切换时不突兀）
FIX = {"pitch": 40.0, "fov": 12.0}


def main():
    def r_fixed(x):
        tu, tv, dist, yaw, k = x
        return resid([tu, tv, dist, yaw, FIX["pitch"], FIX["fov"], k])

    s = least_squares(
        r_fixed,
        [1150, 100, 5000, -20, 1.5],
        bounds=([0, -500, 500, -89, 1.0], [2500, 800, 20000, 89, 3.0]),
    )
    tu, tv, dist, yaw, k = s.x

    class sol:  # 和放开俯角时的接口一致
        x = [tu, tv, dist, yaw, FIX["pitch"], FIX["fov"], k]

    r = np.array([project(sol.x, *w, sc) - np.array(px) for w, px, sc, wt, _ in PAIRS])
    main_r = r[[i for i, p in enumerate(PAIRS) if p[3] >= 1]]
    rms = float(np.sqrt((main_r**2).sum(1).mean()))
    tu, tv, dist, yaw, pitch, fov, k = [float(x) for x in sol.x]
    out = {
        "note": "由 scripts/smart-port/fit_camera.py 按定稿概念图拟合（页面 PortScene.setView 参数 + 主题 vScale 竖向夸张）。概念图比例与真实码头不同，残差记进状态文件 rulings",
        "view": {"target": [round(tu, 1), round(tv, 1)], "dist": round(dist, 1), "yaw": round(yaw, 2), "pitch": round(pitch, 2), "fov": round(fov, 2)},
        "vScale": round(k, 2),
        "residualPx": {"rms": round(rms, 1), "max": round(float(np.abs(main_r).max()), 1), "note": "只算权重 1 的点"},
        "pairs": [
            {"id": n, "world": w, "scaled": sc, "weight": wt, "px": px, "fit": [round(float(a), 1) for a in project(sol.x, *w, sc)]}
            for w, px, sc, wt, n in PAIRS
        ],
    }
    (ROOT / "docs/design/smart-port/07-camera.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(json.dumps(out["view"], ensure_ascii=False), "vScale", out["vScale"], "RMS", round(rms, 1), "px")
    for p in out["pairs"]:
        print(f"  {p['id']}: 目标 {p['px']} → 拟合 {p['fit']}")


if __name__ == "__main__":
    main()

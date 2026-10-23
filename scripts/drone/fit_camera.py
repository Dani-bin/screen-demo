"""/drone 定稿相机标定（两段式透视拟合）

用法：python scripts/drone/fit_camera.py [--skill <build-3d-visual-dashboard 目录>]
输入：docs/design/drone/design/annotations.json（角点已换算到定稿 1920×1080 坐标）
输出：docs/design/drone/07-camera.json、design/annotation-check.png（品红 = 标注，青 = 重投影）

为什么要两段：skill 的 calibrate.py 拟透视时总是从正交解出发。定稿（AI 概念图）透视很强，
园区前沿宽、后沿窄，加上园区地面轮廓这个大矩形后，正交解本身就退化了（俯角 ≈ 1°），
从那里出发的透视拟合会掉进坏的局部解（控制楼被算成 0.04 m 之类）。
所以这里：
  1. 只用建筑 / 罐区这些小矩形（id 不以 park_ 开头）按 calibrate.fit(..., "persp") 拟一次；
  2. 用它的解当初值，加上园区地面轮廓一起再拟一次（同一套 Problem / _solve / _report，
     不改 skill 的代码），让相机在"建筑尺寸自洽"和"园区轮廓贴合"之间取最小二乘折中。
AI 图本身透视不自洽（地面平行线的灭点和远山地平线对不上），残差超过 5 px 时按 skill 规则
接受最优解并记进状态文件。
"""

import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DESIGN = os.path.join(ROOT, "docs", "design", "drone", "design")

ap = argparse.ArgumentParser()
ap.add_argument("--skill", default=os.path.expanduser("~/src/build-3d-visual-dashboard"))
args = ap.parse_args()
sys.path.insert(0, os.path.join(args.skill, "scripts"))
import calibrate as cal  # noqa: E402

ann = json.load(open(os.path.join(DESIGN, "annotations.json"), encoding="utf-8"))
small = dict(ann, rects=[r for r in ann["rects"] if not r["id"].startswith("park_")])

# ---- 第 1 段：只用小矩形拟透视
p1 = cal.Problem(small, "persp")
cam1 = cal.fit(small, "persp")
print(f"第 1 段（{len(small['rects'])} 个矩形）：方位 {cam1['azimuthDeg']:.2f}°，俯角 {cam1['pitchDeg']:.2f}°，"
      f"视场角 {cam1['fovDeg']:.2f}°，残差 RMS {cam1['residualPx']['rms']} px")

# 把第 1 段的结果打包回参数向量：θ, φ, ψ, ln F, ln D, tx, ty, tz + 各矩形自由量
F = (p1.H / 2) / math.tan(math.radians(cam1["fovDeg"] / 2))
g = [math.radians(cam1["azimuthDeg"]), math.radians(cam1["pitchDeg"]), math.radians(cam1["rollDeg"]),
     math.log(F), math.log(cam1["distance"]), *cam1["targetWorld"]]

# ---- 第 2 段：加上园区地面轮廓，从第 1 段的解出发
p2 = cal.Problem(ann, "persp")
x_g = list(g)
rects1 = {r["id"]: r for r in cam1["rects"]}
seed = p2.camera(x_g)
rx_all, hsign = p2.init_rects(seed)
# 小矩形沿用第 1 段解出的位置 / 朝向 / 尺寸；园区轮廓用第 1 段相机反投影的估计
x_r, k = [], 0
for i, r in enumerate(ann["rects"]):
    slots = p2.rect_slots(i)
    if r["id"] in rects1:
        s = rects1[r["id"]]
        v = {"cx": s["x"], "cy": s["y"], "ang": math.radians(s["angleDeg"]), "w": s["w"], "h": hsign[i] * s["h"]}
        x_r.extend(v[n] for n in slots)
    else:
        x_r.extend(rx_all[k:k + len(slots)])
    k += len(slots)
x, rms = cal._solve(p2, x_g + x_r, hsign)
cam = cal._report(p2, x, hsign)
cam["fit"] = {
    "method": "两段式透视拟合（scripts/drone/fit_camera.py）",
    "stage1": {"rects": [r["id"] for r in small["rects"]], "rms": cam1["residualPx"]["rms"]},
    "stage2": {"rects": [r["id"] for r in ann["rects"]], "rms": cam["residualPx"]["rms"]},
    "sceneBox": {"x": 410, "y": 116, "w": 1120, "h": 747,
                 "note": "定稿里中央场景图的位置；AI 图坐标 × 1120/1536 + (410,116) = 定稿坐标"}
}
out = os.path.join(ROOT, "docs", "design", "drone", "07-camera.json")
json.dump(cam, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
cal.overlay(cam, ann, os.path.join(DESIGN, "final.png"), os.path.join(DESIGN, "annotation-check.png"))
print(f"第 2 段（{len(ann['rects'])} 个矩形）：方位 {cam['azimuthDeg']:.2f}°，俯角 {cam['pitchDeg']:.2f}°，"
      f"视场角 {cam['fovDeg']:.2f}°，残差 RMS {cam['residualPx']['rms']} px（最大 {cam['residualPx']['max']} px）→ {out}")
for r in cam["rects"]:
    print(f"  {r['id']:12s} 中心 ({r['x']:8.1f}, {r['y']:8.1f})  {r['w']:7.1f} × {r['h']:7.1f} m  角 {r['angleDeg']:6.1f}°  残差 {r['residualPx']} px")

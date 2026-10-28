"""/coal-prep 主机位（按定稿构图摆，不再是纯标定解）

用法：python3 scripts/coal-prep/compose_camera.py [--skill <目录>] [--elev 仰角°] [--dist 距离m] [--out <json>]
输出：src/views/coal-prep/data/camera.json（页面主机位）、scripts/blender/coal_prep 的预览也读它

为什么不用标定解（docs/design/coal-prep/calib/camera-fit.json）：
  定稿概念图是 AI 图，透视不自洽——托辊、滚筒、护栏的点位反求出的相机贴着皮带高度（≈ 2.5 m），
  画面里煤面只剩一条边、滚筒偏大；而定稿给人的是"从上方俯看一长段满载皮带"的构图。
  两轮评审都把构图排在扣分第一，用户 2026-10-28 决定放开"相机不手调"，按定稿构图重摆主机位。

怎么摆：相机沿原标定机位相对 1# 滚筒的水平方位不动，仰角抬到 14°、离滚筒 8.5 m（相机高约 3.5 m；第 6 轮评审嫌驱动组偏大，从 6.6 m 拉远），
朝向和视场角按三个构图点最小二乘求出：
  1# 滚筒中心 → 定稿 (930, 540)、滚筒顶 → (928, 472)：滚筒在画面中偏右、偏下，比标定机位小一圈；
  机尾方向 12 m 处的带面 → (70, 275)：长段满载皮带从左上方伸进画面。
天空会比定稿少：定稿既要俯看皮带、又要地平线在画面 1/3 处，一台透视相机做不到两全。
滚转按标定解固定 1.5°。像素坐标都是概念图 1536 × 864（页面裁掉顶部 70 px）。
"""

import argparse
import json
import math
import os
import sys

import numpy as np
from scipy.optimize import least_squares

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
ap = argparse.ArgumentParser()
ap.add_argument("--skill", default=os.path.expanduser("~/src/build-3d-visual-dashboard"))
ap.add_argument("--elev", type=float, help="覆盖 ELEV（试机位用）")
ap.add_argument("--dist", type=float, help="覆盖 DIST（试机位用）")
ap.add_argument("--out", help="写到别的文件（试机位用），缺省写页面的 data/camera.json")
args = ap.parse_args()
sys.path.insert(0, os.path.join(args.skill, "scripts"))
import calibrate as cal  # noqa: E402

W, H = 1536, 864
ELEV, DIST, ROLL = 14.0, 8.5, 1.5  # 相机相对滚筒中心的仰角（°）、距离（m）、滚转（°）
ELEV, DIST = args.elev or ELEV, args.dist or DIST
DRUM = (0.0, 0.0, 1.4)  # 1# 滚筒轴线中点（Blender 坐标）
TARGETS = [((0, 0, 1.4), (930, 540)), ((0, 0, 1.86), (928, 472)), ((-12.0, 0, 1.62), (70, 275))]

calib = json.load(open(os.path.join(ROOT, "docs", "design", "coal-prep", "calib", "camera-fit.json"), encoding="utf-8"))
c0 = cal.cam_position(calib)
hz = math.atan2(c0[1] - DRUM[1], c0[0] - DRUM[0])  # 标定机位相对滚筒的水平方位
e = math.radians(ELEV)
C = np.array([DRUM[0] + DIST * math.cos(e) * math.cos(hz), DRUM[1] + DIST * math.cos(e) * math.sin(hz), DRUM[2] + DIST * math.sin(e)])


def camera(x):
    th, ph, fov = x
    f = np.array([math.cos(ph) * math.cos(th), math.cos(ph) * math.sin(th), -math.sin(ph)])
    return cal.make_camera("persp", [W, H], math.degrees(th), math.degrees(ph), ROLL, fovDeg=fov, distance=10, targetWorld=list(C + 10 * f))


def residual(x):
    cam = camera(x)
    return np.concatenate([cal.project(cam, [p])[0] - np.array(q) for p, q in TARGETS])


sol = least_squares(residual, [math.radians(calib["azimuthDeg"]), math.radians(calib["pitchDeg"]), calib["fovDeg"]], method="lm")
cam = camera(sol.x)
cam["residualPx"] = {"rms": round(float(np.sqrt((sol.fun**2).mean())), 2)}
cam["rects"] = []
cam["three"] = cal.three_block(cam)
cam["note"] = "按定稿构图摆的主机位（scripts/coal-prep/compose_camera.py），标定解见 docs/design/coal-prep/calib/camera-fit.json"
out = args.out or os.path.join(ROOT, "src", "views", "coal-prep", "data", "camera.json")
json.dump(cam, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"相机 ({C[0]:.2f}, {C[1]:.2f}, {C[2]:.2f})，方位 {cam['azimuthDeg']:.1f}°，俯角 {cam['pitchDeg']:.1f}°，视场角 {cam['fovDeg']:.1f}°，构图点残差 {cam['residualPx']['rms']} px")
print("写入", os.path.relpath(out, ROOT))

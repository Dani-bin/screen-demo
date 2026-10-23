"""/drone 场地布局：从定稿反投影（阶段 7）

用法：python scripts/drone/plan_site.py [--skill <build-3d-visual-dashboard 目录>]
输入：docs/design/drone/07-camera.json（scripts/drone/fit_camera.py 标定的透视相机）
     + 本文件里对着 AI 图 docs/design/drone/design/ai/scene-a-dusk.png 人工读出的像素点
输出（都是生成文件，不要手改）：
  scripts/blender/drone/site.json      Blender 建模用的完整布局
  src/views/drone/data/site.js         页面 / 仿真用的布局（同上，包成 ES 模块）
  docs/design/drone/design/layout-check.png  把布局重新投影回定稿上核对（青 = 布局）

坐标系 = 标定坐标系：原点在原料罐区 6 座浮顶罐罐顶中心网格的中心，x 向东、y 向北、z 向上，
单位 m；three.js 里 (X, Y, Z) = (x, z, -y)。
像素点一律按 AI 图（1536×1024）坐标写，脚本里换算到定稿（AI 图 × 1120/1536 + (410, 116)）。

读数方法：
  - 平面上的点（地面、屋面、罐顶）：给出高度，沿视线和 z = 高度的平面求交；
  - 竖向构件（罐、塔、冷却塔、火炬、冷箱）：给"顶部中心"和"最低点"两个像素，
    同时解出平面位置和高度（最低点是底圆上离相机最近的那一点，用半径修正）；
  - 圆形构件的直径：按所在位置的水平像素 / 米换算图上宽度。
AI 图本身透视不完全自洽，反投影结果允许有几米误差；数量和左右顺序以图为准。
"""

import argparse
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DOCS = os.path.join(ROOT, "docs", "design", "drone")

ap = argparse.ArgumentParser()
ap.add_argument("--skill", default=os.path.expanduser("~/src/build-3d-visual-dashboard"))
args = ap.parse_args()
sys.path.insert(0, os.path.join(args.skill, "scripts"))
import calibrate as cal  # noqa: E402
from scipy.optimize import least_squares  # noqa: E402

CAM = json.load(open(os.path.join(DOCS, "07-camera.json"), encoding="utf-8"))
K, X0, Y0 = 1120 / 1536, 410, 116


def fin(p):
    """AI 图像素 → 定稿像素"""
    return [X0 + p[0] * K, Y0 + p[1] * K]


def ai(p):
    """定稿像素 → AI 图像素"""
    return [(p[0] - X0) / K, (p[1] - Y0) / K]


def bp(p, z=0.0):
    """AI 图像素 + 高度 → 世界 (x, y)"""
    w = cal.backproject(CAM, [fin(p)], [z])[0]
    return [float(w[0]), float(w[1])]


def proj(pts):
    """世界点 → AI 图像素"""
    return [ai(q) for q in cal.project(CAM, pts)]


def ppm(x, y, z=0.0):
    """该位置在 AI 图上的水平像素 / 米"""
    a, b = proj([[x - 0.5, y, z], [x + 0.5, y, z]])
    return math.hypot(b[0] - a[0], b[1] - a[1])


_f, _r, _u = cal.basis(CAM)
VIEW = np.array([_f[0], _f[1], 0.0]) / math.hypot(_f[0], _f[1])  # 水平视线方向（指向远处）


def vertical(top, bottom, r=0.0, z0=0.0):
    """竖向构件：顶部中心像素 + 最低点像素 → (x, y, 高度)。最低点在底圆离相机最近处（中心 − r·视线）"""

    def res(v):
        x, y, h = v
        t = proj([[x, y, z0 + h]])[0]
        b = proj([[x - r * VIEW[0], y - r * VIEW[1], z0]])[0]
        return [t[0] - top[0], t[1] - top[1], b[1] - bottom[1]]

    x, y = bp(top, z0 + 20)
    s = least_squares(res, [x, y, 20.0])
    x, y, h = s.x
    return round(float(x), 2), round(float(y), 2), round(float(h), 2)


def diam(x, y, z, px_w):
    return round(px_w / ppm(x, y, z), 2)


def quad(pts, z=0.0):
    """地面四边形（前左、前右、后右、后左）→ (cx, cy, w, d)。
    AI 图透视不自洽，反投影出的四边形是梯形：取质心，宽 = 前后边长的平均，深 = 左右边长的平均。
    不用轴对齐外接框，否则相邻的块（U-1 / U-3）会互相重叠。"""
    q = np.array([bp(p, z) for p in pts])
    c = q.mean(axis=0)
    w = (np.linalg.norm(q[1] - q[0]) + np.linalg.norm(q[2] - q[3])) / 2
    d = (np.linalg.norm(q[3] - q[0]) + np.linalg.norm(q[2] - q[1])) / 2
    return [round(float(c[0]), 2), round(float(c[1]), 2), round(float(w), 2), round(float(d), 2)]


rects = {r["id"]: r for r in CAM["rects"]}
site = {"frame": "标定坐标系：原点在原料罐区罐顶中心网格中心，x 东、y 北、z 上，单位 m；three.js (X,Y,Z)=(x,z,-y)"}

# ---------------------------------------------------------------- 园区范围（标定里的 park_ground 矩形）
pg = rects["park_ground"]
site["park"] = {"cx": pg["x"], "cy": pg["y"], "w": pg["w"], "d": pg["h"], "angleDeg": pg["angleDeg"],
                "x0": round(pg["x"] - pg["w"] / 2, 1), "x1": round(pg["x"] + pg["w"] / 2, 1),
                "y0": round(pg["y"] - pg["h"] / 2, 1), "y1": round(pg["y"] + pg["h"] / 2, 1)}

# ---------------------------------------------------------------- 储罐（罐顶中心 + 一座罐的最低点定罐高）
TF1_TOP = {"TK-101": (328.5, 290.5), "TK-102": (420.5, 290), "TK-103": (513, 290.5),
           "TK-104": (298, 327), "TK-105": (397, 327), "TK-106": (497, 327)}
TF2_TOP = {"TK-201": (265, 404), "TK-202": (321, 404), "TK-203": (376.5, 404), "TK-204": (432.5, 404),
           "TK-205": (249, 427.5), "TK-206": (306, 427.5), "TK-207": (364.5, 427.5), "TK-208": (421.5, 427.5)}
# 罐高：TK-104 罐顶中心 (298, 327)，前沿最低点 y = 368；TK-205 罐顶 (249, 427.5)，最低点 y = 459
_, _, H1 = vertical((298, 327), (298, 368), r=20)
x5, y5, _ = vertical((249, 427.5), (249, 459), r=10)
D2 = diam(x5, y5, 15, 40)
_, _, H2 = vertical((249, 427.5), (249, 459), r=D2 / 2)
tanks = []
for tid, p in TF1_TOP.items():
    x, y = bp(p, H1)
    tanks.append({"id": tid, "group": "TF-1", "roof": "floating", "x": round(x, 2), "y": round(y, 2), "d": 40.0, "h": H1})
for tid, p in TF2_TOP.items():
    x, y = bp(p, H2)
    tanks.append({"id": tid, "group": "TF-2", "roof": "fixed", "x": round(x, 2), "y": round(y, 2), "d": D2, "h": H2})
site["tanks"] = tanks

# 球罐：图上球心 + 支腿着地点定球心高度；直径按图上宽度 48 px
SP_C = {"SP-101": (169, 511), "SP-102": (236, 511), "SP-103": (305, 511),
        "SP-104": (146, 547.5), "SP-105": (215, 547.5), "SP-106": (285, 547.5)}
xs, ys, zc = vertical((146, 547.5), (146, 577), r=0)
DS = diam(xs, ys, zc, 48)
site["spheres"] = []
for sid, p in SP_C.items():
    x, y = bp(p, zc)
    site["spheres"].append({"id": sid, "group": "SP-1", "x": round(x, 2), "y": round(y, 2), "d": DS, "zc": zc})

# 防火堤：罐组外扩（罐壁到堤脚 ≥ 罐高的一半）
def dike(items, d, h):
    xs = [t["x"] for t in items]
    ys = [t["y"] for t in items]
    m = d / 2 + max(9.0, h / 2)
    return [round((min(xs) + max(xs)) / 2, 2), round((min(ys) + max(ys)) / 2, 2),
            round(max(xs) - min(xs) + 2 * m, 2), round(max(ys) - min(ys) + 2 * m, 2)]


site["dikes"] = {"TF-1": dike(tanks[:6], 40, H1), "TF-2": dike(tanks[6:], D2, H2),
                 "SP-1": dike(site["spheres"], DS, 6)}

# ---------------------------------------------------------------- 装置（地面块 + 主要塔器）
UNITS = {
    "U-1": {"block": [(530, 575), (705, 575), (705, 362), (560, 362)],
            "cols": [((570, 407), (570, 556), 3.5), ((616, 347), (616, 470), 3.0), ((645, 305), (645, 470), 3.5)]},
    "U-3": {"block": [(712, 527), (872, 527), (872, 365), (712, 365)],
            "cols": [((785, 337), (785, 470), 3.0), ((817, 305), (817, 470), 3.5)]},
    "U-2": {"block": [(885, 580), (1062, 580), (1060, 360), (888, 360)],
            "cols": [((945, 337), (945, 510), 3.0), ((982, 305), (982, 525), 3.5), ((1010, 380), (1010, 470), 2.5)]},
}
site["units"] = []
for uid, u in UNITS.items():
    cols = []
    for top, bot, r in u["cols"]:
        x, y, h = vertical(top, bot, r=r)
        cols.append({"x": x, "y": y, "r": r, "h": h})
    site["units"].append({"id": uid, "block": quad(u["block"]), "columns": cols})

# ---------------------------------------------------------------- 建筑
B = []
lr = rects["LD-1_roof"]
B.append({"id": "LD-1", "kind": "canopy", "cx": lr["x"], "cy": lr["y"], "w": lr["w"], "d": lr["h"], "h": 7.0, "angleDeg": lr["angleDeg"]})
cr = rects["ctrl_roof"]
B.append({"id": "CTRL-2", "kind": "control", "cx": cr["x"], "cy": cr["y"], "w": cr["w"], "d": cr["h"], "h": 12.0, "angleDeg": cr["angleDeg"],
          "note": "装置区控制楼，屋顶放 DK-02"})
cc = rects["CC-1_roof"]
B.append({"id": "CC-1", "kind": "office", "cx": cc["x"], "cy": cc["y"], "w": cc["w"], "d": cc["h"], "h": 18.0, "angleDeg": cc["angleDeg"],
          "note": "指挥中心，屋顶放 DK-04"})


def front_building(bid, kind, fl, fr, roof_y, depth, note=""):
    """只看得到正立面的建筑：立面底边两端（地面）+ 屋檐前沿 y 定高度，进深按估计"""
    a = bp(fl)
    b = bp(fr)
    cx, w = (a[0] + b[0]) / 2, abs(b[0] - a[0])
    y_front = (a[1] + b[1]) / 2
    _, _, h = vertical(((fl[0] + fr[0]) / 2, roof_y), ((fl[0] + fr[0]) / 2, fl[1]), r=0)
    B.append({"id": bid, "kind": kind, "cx": round(cx, 2), "cy": round(y_front + depth / 2, 2), "w": round(w, 2), "d": depth, "h": h, "angleDeg": 0.0, "note": note})


front_building("FS-1", "firestation", (842.5, 292.5), (915, 292.5), 270, 26, "特勤消防站 + 气防站，红色车库门")
front_building("WH-1", "warehouse", (1097, 300), (1230, 300), 262, 40, "危化品仓库")
site["buildings"] = B
x, y, h = vertical((937, 235), (937, 292.5), r=3)
site["fireTower"] = {"x": x, "y": y, "w": 7, "h": h}
site["lots"] = {
    "PK-1": quad([(1005, 322), (1090, 322), (1085, 270), (1010, 270)]),
    "DK-01_pad": quad([(345, 595), (455, 595), (450, 545), (350, 545)]),
    "SS-1": quad([(1060, 425), (1300, 420), (1250, 330), (1050, 330)]),
    "LD-1_apron": quad([(30, 645), (340, 645), (330, 580), (60, 580)])
}

# ---------------------------------------------------------------- 公用工程
site["coolingTowers"] = []
for i, p in enumerate([(1182.5, 437.5), (1230, 437.5), (1280, 437.5), (1329, 437.5)]):
    x, y, h = vertical(p, (p[0], 485), r=11)
    site["coolingTowers"].append({"id": f"CW-1_{i + 1}", "x": x, "y": y, "h": h,
                                  "dTop": diam(x, y, h, 37.5), "dBase": diam(x, y, 0, 45)})
site["coldBoxes"] = []
for p0, p1, top, bot in [(1240, 1265, 480, 592.5), (1169, 1192.5, 505, 597.5)]:
    cx = (p0 + p1) / 2
    x, y, h = vertical((cx, top), (cx, bot), r=4)
    site["coldBoxes"].append({"x": x, "y": y, "h": h, "w": diam(x, y, 0, p1 - p0)})
site["basins"] = []
for p, wpx in [((1245, 645), 95), ((1330, 645), 85), ((1375, 547.5), 80)]:
    x, y = bp(p, 1.5)
    site["basins"].append({"x": round(x, 2), "y": round(y, 2), "d": diam(x, y, 1.5, wpx)})
x, y, h = vertical((1452.5, 370), (1437.5, 665), r=2)
site["flare"] = {"id": "FL-1", "x": x, "y": y, "h": h}
site["hazWaste"] = {"id": "HW-1", "cx": bp((1312, 588))[0], "cy": bp((1312, 588))[1], "w": 26, "d": 16, "h": 7}

# ---------------------------------------------------------------- 管廊（顶面高约 8 m）
def line(pts, z):
    return [[round(v, 2) for v in bp(p, z)] for p in pts]


site["pipeRacks"] = [
    {"id": "PR-1", "z": 8, "w": 8, "pts": line([(110, 492), (360, 478), (560, 476), (1140, 478), (1400, 485)], 8)},
    {"id": "PR-1_south", "z": 6, "w": 6, "pts": line([(500, 621), (1090, 626)], 6)},
    {"id": "PR-1_jetty", "z": 6, "w": 5, "pts": line([(495, 621), (495, 690)], 6) + line([(495, 755)], 4)},
]

# ---------------------------------------------------------------- 江岸、码头、船
site["river"] = {"bankTop": line([(0, 682), (100, 684), (1150, 713), (1536, 727)], 3),
                 "waterLine": line([(0, 709), (100, 713), (1150, 752), (1536, 766)], 0)}
site["jetty"] = {"berth": line([(399, 757), (609, 757)], 3), "w": 10}
site["ships"] = []
for sid, a, b in [("SHIP-1", (158, 783), (389, 783)), ("SHIP-2", (439, 797), (638, 797))]:
    pa, pb = bp(a, 0), bp(b, 0)
    site["ships"].append({"id": sid, "x": round((pa[0] + pb[0]) / 2, 2), "y": round((pa[1] + pb[1]) / 2, 2),
                          "len": round(abs(pb[0] - pa[0]), 2), "beam": 16})

# ---------------------------------------------------------------- 机场（DK-02 / DK-04 在屋顶）
ctrl = next(b for b in B if b["id"] == "CTRL-2")
cc1 = next(b for b in B if b["id"] == "CC-1")
pad = site["lots"]["DK-01_pad"]
d3 = bp((1098, 448))
site["docks"] = {
    "DK-01": {"x": pad[0], "y": pad[1], "z": 0.0},
    "DK-02": {"x": ctrl["cx"], "y": ctrl["cy"], "z": ctrl["h"]},
    "DK-03": {"x": round(d3[0], 2), "y": round(d3[1], 2), "z": 0.0},
    "DK-04": {"x": cc1["cx"] + 20, "y": cc1["cy"], "z": cc1["h"]},
}

# ---------------------------------------------------------------- 卡口、片区
site["gates"] = {g: [round(v, 2) for v in bp(p)] for g, p in {"G-1": (700, 252), "G-2": (1000, 252), "G-3": (1445, 520), "G-4": (125, 470)}.items()}
P = site["park"]
uxs = [u["block"][0] for u in site["units"]]
split_w = round((max(t["x"] for t in tanks) + 20 + min(uxs) - site["units"][0]["block"][2] / 2) / 2, 1)
split_e = round((site["units"][2]["block"][0] + site["units"][2]["block"][2] / 2 + min(c["x"] for c in site["coolingTowers"]) - 15) / 2, 1)
split_n = round((max(t["y"] for t in tanks) + 25 + cc1["cy"] - cc1["d"] / 2) / 2, 1)
site["zones"] = {
    "Z1": {"name": "储运片区", "rect": [P["x0"], P["y0"], split_w, split_n]},
    "Z2": {"name": "生产片区", "rect": [split_w, P["y0"], split_e, split_n]},
    "Z3": {"name": "公用工程片区", "rect": [split_e, P["y0"], P["x1"], split_n]},
    "Z4": {"name": "物流与管理片区", "rect": [P["x0"], split_n, P["x1"], P["y1"]]},
}

# ---------------------------------------------------------------- 远景
# 标定相机的真地平线在画面顶边之外，而 AI 图在 y≈75 画了远山、上面是天空：远景被"压扁"了。
# 为了在标定机位下和图一致：远处的河、远山都按图上位置反投影到地面（只在园区北边几百米），
# 山高按图上轮廓反算；地面在山后截断，山顶以上的视线看到的就是天空（页面里再用雾淡出边缘）。
site["backdrop"] = {
    "farRiver": {"north": line([(260, 118), (400, 128), (600, 145), (800, 160), (1000, 178), (1200, 195), (1400, 212), (1536, 220)], 0),
                 "south": line([(260, 138), (400, 140), (600, 162), (800, 178), (1000, 195), (1200, 212), (1400, 228), (1536, 236)], 0)},
    "hills": [],
}
for sx, sy in [(0, 84), (150, 78), (300, 72), (450, 78), (600, 76), (750, 72), (900, 70), (1000, 66), (1100, 68), (1250, 72), (1400, 74), (1536, 78)]:
    hx, hy, hh = vertical((sx, sy), (sx, 90), r=0)
    site["backdrop"]["hills"].append([hx, hy, hh])
# 地面截到山脊处：定稿里地平线在 y≈170 px，按标定相机反算对应地面北边约 890 m（比对第 7 轮）；
# 山后再多留一点地面，视线就会落到更远处、地平线比定稿高
site["backdrop"]["groundNorth"] = round(max(h[1] for h in site["backdrop"]["hills"]) + 5, 1)

# 剧情事件（2# 芳烃装置气体泄漏）的位置：AI 图上 U-2 管束处 (950, 500)，离地约 10 m
site["storyLeak"] = [round(v, 2) for v in bp((950, 500), 10)] + [10.0]
# 卡口贴到园区边界上
for g, (gx, gy) in site["gates"].items():
    site["gates"][g] = [round(min(max(gx, site["park"]["x0"]), site["park"]["x1"]), 2), round(min(max(gy, site["park"]["y0"]), site["park"]["y1"]), 2)]

out_b = os.path.join(ROOT, "scripts", "blender", "drone", "site.json")
os.makedirs(os.path.dirname(out_b), exist_ok=True)
json.dump(site, open(out_b, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
# 页面 / 仿真用 JS 模块（Node 和 Vite 都能直接 import，不用 JSON 导入属性）
out_p = os.path.join(ROOT, "src", "views", "drone", "data", "site.js")
with open(out_p, "w", encoding="utf-8") as fp:
    fp.write("// 由 scripts/drone/plan_site.py 生成（定稿反投影的场地布局），不要手改\n")
    fp.write("// 坐标：原点在原料罐区罐顶中心网格中心，x 东、y 北、z 上，单位 m\n")
    fp.write("export default " + json.dumps(site, ensure_ascii=False, indent=1) + "\n")
# 按项目的 Prettier 规则格式化（eslint 的 prettier 规则会检查 src 下所有 .js；不格式化会报几百条）
import shutil  # noqa: E402
import subprocess  # noqa: E402

npx = shutil.which("npx")
if npx:
    subprocess.run([npx, "prettier", "--write", out_p], cwd=ROOT, check=False, capture_output=True)
else:
    print("没找到 npx：site.js 未格式化，请手动运行 npx prettier --write " + out_p)

# ---------------------------------------------------------------- 投回定稿核对
from PIL import Image, ImageDraw  # noqa: E402

img = Image.open(os.path.join(DOCS, "design", "final.png")).convert("RGB")
dr = ImageDraw.Draw(img)
C = (0, 255, 230)


def poly3(pts, col=C, w=1):
    q = [tuple(fin(p)) for p in proj(pts)]
    dr.line(q + [q[0]], fill=col, width=w)


def circle(x, y, z, r, col=C, n=36):
    poly3([[x + r * math.cos(a), y + r * math.sin(a), z] for a in np.linspace(0, 2 * math.pi, n, endpoint=False)], col)


def box(cx, cy, w, d, z0, z1, col=C):
    c = [[cx - w / 2, cy - d / 2], [cx + w / 2, cy - d / 2], [cx + w / 2, cy + d / 2], [cx - w / 2, cy + d / 2]]
    poly3([p + [z0] for p in c], col)
    poly3([p + [z1] for p in c], col)
    for p in c:
        a, b = proj([p + [z0], p + [z1]])
        dr.line([tuple(fin(a)), tuple(fin(b))], fill=col)


for t in tanks:
    circle(t["x"], t["y"], 0, t["d"] / 2)
    circle(t["x"], t["y"], t["h"], t["d"] / 2)
for s in site["spheres"]:
    circle(s["x"], s["y"], s["zc"], s["d"] / 2)
for u in site["units"]:
    b = u["block"]
    box(b[0], b[1], b[2], b[3], 0, 0.1, (255, 200, 0))
    for c in u["columns"]:
        circle(c["x"], c["y"], 0, c["r"])
        circle(c["x"], c["y"], c["h"], c["r"])
        a, bb = proj([[c["x"], c["y"], 0], [c["x"], c["y"], c["h"]]])
        dr.line([tuple(fin(a)), tuple(fin(bb))], fill=C, width=2)
for b in B:
    box(b["cx"], b["cy"], b["w"], b["d"], 0, b["h"])
for c in site["coolingTowers"]:
    circle(c["x"], c["y"], 0, c["dBase"] / 2)
    circle(c["x"], c["y"], c["h"], c["dTop"] / 2)
for c in site["coldBoxes"]:
    box(c["x"], c["y"], c["w"], c["w"], 0, c["h"])
for c in site["basins"]:
    circle(c["x"], c["y"], 1.5, c["d"] / 2)
f = site["flare"]
a, bb = proj([[f["x"], f["y"], 0], [f["x"], f["y"], f["h"]]])
dr.line([tuple(fin(a)), tuple(fin(bb))], fill=(255, 80, 80), width=3)
for r in site["pipeRacks"]:
    q = [tuple(fin(p)) for p in proj([p + [r["z"]] for p in r["pts"]])]
    dr.line(q, fill=(255, 0, 255), width=2)
for s in site["ships"]:
    box(s["x"], s["y"], s["len"], s["beam"], 0, 10, (120, 160, 255))
for k, v in site["docks"].items():
    q = fin(proj([[v["x"], v["y"], v["z"]]])[0])
    dr.ellipse([q[0] - 5, q[1] - 5, q[0] + 5, q[1] + 5], outline=(255, 255, 0), width=2)
box(P["cx"], P["cy"], P["w"], P["d"], 0, 0.1, (255, 255, 255))
for z in site["zones"].values():
    x0, y0, x1, y1 = z["rect"]
    poly3([[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]], (255, 140, 0))
img.save(os.path.join(DOCS, "design", "layout-check.png"))

print(f"罐高 TF-1 {H1} m、TF-2 {H2} m（罐径 {D2} m）；球罐直径 {DS} m、球心高 {zc} m")
print("装置塔器：", {u["id"]: [c["h"] for c in u["columns"]] for u in site["units"]})
print("冷却塔：", [(c["h"], c["dTop"], c["dBase"]) for c in site["coolingTowers"]])
print("火炬：", site["flare"], "冷箱：", site["coldBoxes"], "污水池：", site["basins"])
print("建筑：", [(b["id"], b["w"], b["d"], b["h"]) for b in B])
print("船：", site["ships"], "园区：", P)
print("片区：", site["zones"])
print(f"→ {out_b}\n→ {out_p}")

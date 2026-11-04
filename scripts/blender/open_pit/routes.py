"""运输路线和设备锚点（纯 numpy，不依赖 bpy）：写 src/views/open-pit/data/pit3d.json，页面里卡车按它走。

路线 = 一台电铲到它的卸载点（排土场边缘 / 破碎站），顺着台阶上的路绕坑盘旋爬升：
在第 k 级平台中线（环参数 s_mid(k)）上绕一段角度，再用一段斜坡（环参数和高度线性过渡）上到第 k-1 级，直到坑沿，
出坑后直线接到卸载点。每个点带类型（loop 平台上 / ramp 斜坡 / approach 起点接入 / exit 出坑），
build.py 只给 ramp / approach / exit 画发光带（平台上的环路已经有 pit_roads）。
世界坐标同 Blender：x 东、y 北、z 上（米）；页面里转成 three 的 (x, z, -y)。
"""
import json
import os

import numpy as np

from . import camera as cam
from .pit import DUMPS, PLAT, Pit, dump_ground

NB = cam.NB
STEP = 24.0  # 路线点的间距 m
RAMP = 0.28  # 斜坡占的角度（弧度），约 150–300 m 长、爬一级（坑深放大到 300 m 后每级 30 m，原来的 0.16 坡度到 30 % 以上）
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "..", "src", "views", "open-pit", "data", "pit3d.json")

# 每台电铲的卸载点和盘旋方向（+1 逆时针，-1 顺时针）、额外绕圈数
# 第 17 轮：平台上不再铺整圈的路，只画路线走过的段；不再多绕整圈（多绕的圈数必须是整数，否则出坑点在卸载点对面，
# 出坑直线会横穿整个坑），方向选盘旋角度够大的那边（每级 19°–51°，斜坡 160–170 m 爬一级 30 m），平台路总长约 14 km
PLAN = {
    "ES-01": ("DP-W", +1, 0),
    "ES-02": ("DP-W", +1, 0),
    "ES-03": ("DP-W", -1, 0),
    "ES-04": ("DP-I", -1, 0),
    "ES-05": ("DP-I", +1, 0),
    "ES-06": ("CR-01", -1, 0),
    "ES-07": ("CR-02", 0, 0),
}


def s_mid(k):
    return (k + PLAT / 2) / NB


def level_z(k):
    return -cam.BENCH * k + 0.8


def _arc(p, th_a, th_b, s_a, s_b, z_a, z_b, kind):
    """从 (th_a, s_a, z_a) 到 (th_b, s_b, z_b) 的一段弧（角度、s、z 都线性变化），按 STEP 取点"""
    x0, y0 = p.point(th_a, s_a)
    x1, y1 = p.point(th_b, s_b)
    r = float(np.hypot(x0 - p.center[0], y0 - p.center[1]))
    n = max(2, int(abs(th_b - th_a) * r / STEP))
    out = []
    for i in range(n + 1):
        t = i / n
        th = th_a + (th_b - th_a) * t
        s_t = s_a + (s_b - s_a) * t
        x, y = p.point(th, s_t)
        z = z_a + (z_b - z_a) * t  # 斜坡是直线坡：第 20 轮起地形按坡道切 / 填（carve.py），不再把路抬到地表以上
        out.append((float(x), float(y), float(z), kind))
    return out


def dump_edge(p, name):
    """排土场底面轮廓上离坑中心最近的点（卸载点）；轮廓已推出坑沿（pit.dump_ground），所以卸载点在坑外的地面上"""
    g = dump_ground(name)
    d = np.hypot(*(g - p.center).T)
    q = g[int(np.argmin(d))]
    return float(q[0]), float(q[1]), 0.8


def build_route(p, start, sink, direction, extra):
    x0, y0, z0 = start
    th0, s0 = p.locate(x0, y0)
    k0 = NB - 1 if s0 >= 1 else int(max(s0, 0.0) * NB)
    th_exit = float(np.arctan2(sink[1] - p.center[1], sink[0] - p.center[0]))
    if direction == 0:  # 坑底短路线：直接连
        n = max(2, int(np.hypot(sink[0] - x0, sink[1] - y0) / STEP))
        return [(x0 + (sink[0] - x0) * i / n, y0 + (sink[1] - y0) * i / n, z0 + (sink[2] - z0) * i / n, "loop") for i in range(n + 1)]
    sweep = ((th_exit - th0) * direction) % (2 * np.pi) + 2 * np.pi * extra
    L = sweep / (k0 + 1)
    ramp = min(RAMP, L * 0.7)  # 斜坡最多占每级盘旋角度的 70 %（坑深放大后每级爬 30 m，斜坡要长一些）
    pts = [(x0, y0, z0, "approach")]
    if s0 >= 1:
        # 电铲在坑底：先在坑底径向开到坑底边缘，再沿坑壁走一段斜坡爬上最下一级平台（第 20 轮：原来是一条 2 个点的短直线，
        # 几十米里抬高 30 m，装车 / 刚出发的车悬在坑底上空 11–20 m）
        fr = min(RAMP, L * 0.25)
        xf, yf = p.point(th0, 1.0)
        pts.append((float(xf), float(yf), -cam.DEPTH + 0.8, "approach"))
        pts += _arc(p, th0, th0 + direction * fr, 1.0, s_mid(k0), -cam.DEPTH + 0.8, level_z(k0), "ramp")[1:]
        th = th0 + direction * fr
    else:
        # 接入：从电铲所在位置走到第 k0 级平台中线（径向）
        xa, ya = p.point(th0, s_mid(k0))
        pts.append((float(xa), float(ya), level_z(k0), "approach"))
        th = th0
    for i, k in enumerate(range(k0, -1, -1)):
        a1 = th0 + direction * L * (i + 1)
        a_ramp = a1 - direction * ramp
        pts += _arc(p, th, a_ramp, s_mid(k), s_mid(k), level_z(k), level_z(k), "loop")[1:]
        nxt_s, nxt_z = (s_mid(k - 1), level_z(k - 1)) if k > 0 else (-0.03, 0.8)
        pts += _arc(p, a_ramp, a1, s_mid(k), nxt_s, level_z(k), nxt_z, "ramp" if k > 0 else "exit")[1:]
        th = a1
    # 出坑后直线到卸载点
    xe, ye, ze, _ = pts[-1]
    n = max(2, int(np.hypot(sink[0] - xe, sink[1] - ye) / STEP))
    for i in range(1, n + 1):
        t = i / n
        pts.append((xe + (sink[0] - xe) * t, ye + (sink[1] - ye) * t, ze + (sink[2] - ze) * t, "exit"))
    return pts


def _ground(ix, iy, z=0.0):
    x, y = cam.backproject([(ix, iy)], z)[0]
    return (float(x), float(y), float(z))


def _on_vertical(base, pin, hmax=600.0):
    """设备正上方（base 那条竖线上）投影离设计稿标签点 pin 最近的那个点：高出地面的设备（雷达塔、电厂、煤场）的标签挂在它头顶"""
    hs = np.linspace(0, hmax, 601)
    pts = np.array([(base[0], base[1], base[2] + h) for h in hs])
    d = np.hypot(*(cam.project(pts) - np.array(pin)).T)
    i = int(np.argmin(d))
    return tuple(float(v) for v in pts[i])


# 设备底座（世界坐标，选中光环 / 雷达扫描环放在这里）：设计稿里设备脚下的像素，和 build.py 摆设备用的同一套
BASES_IMG = {
    "BW-01": (950, 122),
    "SR-01": (497, 248),
    "SR-02": (712, 143),
    "SR-03": (1297, 243),
    "PP-01": (1340, 685),  # 1 号冷却塔底座（x 取标签点的 x，标签正好在塔身上）
    "CY-01": (1290, 718),  # 煤场轴线上，x 取标签点的 x（第 18 轮拱棚轴线上移）
    "BC-02": (1110, 650),
}


def anchors_world(p, a):
    """所有设备编号 → (标签锚点, 底座)，都是世界坐标 (x, y, z)。
    标签锚点按设计稿 drafts.html 里的标签点（outline.json 的 anchors）取：贴地 / 贴台阶的设备直接反投影到所在台阶高度，
    高出地面的设备在底座正上方找投影落在标签点上的高度，所以从设计稿相机看过去，标签和设计稿逐像素对上（第 13 轮评审：之前标签整体高 33 px）。"""
    anchors, bases = {}, {}
    for k in ("ES-01", "ES-02", "ES-03", "ES-04", "ES-05", "ES-06", "ES-07", "CR-01", "CR-02"):
        anchors[k] = bases[k] = p.place(a[k])
    for k in ("SW-01", "SW-02"):
        anchors[k] = bases[k] = _ground(*a[k])
    for k, img in BASES_IMG.items():
        bases[k] = _ground(*img)
        anchors[k] = _on_vertical(bases[k], a[k])
    for k in ("PP-01-T1", "PP-01-T2"):
        anchors[k] = bases[k] = _ground(*{"PP-01-T1": (1343, 690), "PP-01-T2": (1421, 677)}[k])
    for name in DUMPS:
        c = dump_ground(name).mean(0)
        bases[name] = (float(c[0]), float(c[1]), 0.0)
        anchors[name] = _on_vertical(bases[name], a[name], hmax=300.0)
    anchors["PV-01"] = bases["PV-01"] = (*[float(v) for v in cam.backproject([(40, 345)], 40.0)[0]], 40.0)
    return anchors, bases


def heat_zone(p):
    """北帮预警热区：设计稿 .heat 是以 (790, 165) 为中心、宽 340 × 高 112 舞台像素（场景图像素 ÷ 1.12）的椭圆，反投影到所在台阶高度"""
    cx, cy = cam.outline()["heat"]
    c = p.place((cx, cy))
    hw, hh = 340 / 1.12 / 2, 112 / 1.12 / 2
    xl, _ = cam.backproject([(cx - hw, cy)], c[2])[0]
    xr, _ = cam.backproject([(cx + hw, cy)], c[2])[0]
    _, yt = cam.backproject([(cx, cy - hh)], c[2])[0]
    _, yb = cam.backproject([(cx, cy + hh)], c[2])[0]
    return {"center": [round(v, 1) for v in c], "w": round(float(xr - xl), 1), "d": round(float(yt - yb), 1)}


def _rim_arc(p, th_a, th_b, s_ring=-0.02, step=30.0):
    """沿坑沿外侧（环参数 s_ring）从角度 th_a 走到 th_b（走短的那边），地面高度 0"""
    d = (th_b - th_a + np.pi) % (2 * np.pi) - np.pi
    x0, y0 = p.point(th_a, s_ring)
    r = float(np.hypot(x0 - p.center[0], y0 - p.center[1]))
    n = max(2, int(abs(d) * r / step))
    return [(*[float(v) for v in p.point(th_a + d * i / n, s_ring)], 0.8) for i in range(n + 1)]


def swap_paths(p, anchors, sinks, routes):
    """每台电铲的卸载点 → 两座换电站的行驶路线（第 20 轮）：原来页面里直接按直线插值，卸在坑底破碎站 CR-02 的车
    会从 300 m 深的坑底斜穿半空飞到地面的换电站。现在：坑底的卸载点先沿 ES-06 的运输路线爬出坑（到 CR-01 的坑沿），
    在地面的卸载点直接上坑沿；然后沿坑沿外侧绕到换电站的方位，再径向开进换电站。返回 {电铲: [到 SW-01, 到 SW-02]}"""
    out = {}
    for es, (sink, _, _) in PLAN.items():
        sx, sy, sz = sinks[sink]
        pts = []
        if sz < -5:  # 卸载点在坑里（CR-02）：先到 ES-06 路线的起点，再沿它出坑
            r6 = routes["ES-06"]
            pts.append((sx, sy, sz))
            pts += [tuple(q[:3]) for q in r6]
        else:
            pts.append((sx, sy, sz))
        ex, ey, _ = pts[-1]
        th0, _ = p.locate(ex, ey)
        paths = []
        for st in ("SW-01", "SW-02"):
            tx, ty, tz = anchors[st]
            th1, _ = p.locate(tx, ty)
            arc = _rim_arc(p, th0, th1)
            paths.append([[round(float(v), 1) for v in q] for q in pts + arc + [(tx, ty - 60, tz + 0.8)]])
        out[es] = paths
    return out


def park_origin(p):
    """待命区：换电站 SW-01 西南的平地（坑外、不压排土场），5 列 × 4 排，每格 70 × 60 m（页面 glbTrucks 的 IDLE）"""
    x, y = cam.backproject([(300, 720)], 0.0)[0]
    th, s_ = p.locate(float(x), float(y))
    assert s_ < -0.1, "待命区落进坑里了"
    return [round(float(x), 1), round(float(y), 1), 0.0]


def generate(path=OUT):
    p = Pit()
    a = cam.outline()["anchors"]
    anchors, bases = anchors_world(p, a)
    sinks = {"DP-W": dump_edge(p, "DP-W"), "DP-I": dump_edge(p, "DP-I"), "CR-01": anchors["CR-01"], "CR-02": anchors["CR-02"]}
    routes = {}
    for es, (sink, d, extra) in PLAN.items():
        pts = build_route(p, anchors[es], sinks[sink], d, extra)
        routes[es] = [[round(x, 1), round(y, 1), round(z, 2), k] for x, y, z, k in pts]
    # 设计稿里没画的其余设备（sites.py 摆的，Blender 里 equip.py 建模）：底座 = 摆放点，标签挂在设备顶上；皮带取折线中点
    from .sites import Sites, label_anchor

    st = Sites()
    for k, d in st.devices().items():
        bases[k] = d["loc"]
        anchors[k] = label_anchor(d["kind"], d["loc"])
    for k, pts in st.belts().items():
        q = pts[len(pts) // 2]
        bases[k] = q
        anchors[k] = (q[0], q[1], q[2] + 22.0)
    belt_img = [(850, 585), (1010, 622), (1110, 650), (1205, 693)]
    belt = [[round(float(v), 1) for v in (*cam.backproject([q], 0.0)[0], 0.0)] for q in belt_img]
    data = {
        "camera": {"pitch": cam.PITCH, "vfov": cam.VFOV, "dist": cam.DIST},
        "depth": cam.DEPTH,
        "bench": cam.BENCH,
        "center": [round(float(v), 1) for v in p.center],
        "anchors": {k: [round(float(v), 1) for v in xyz] for k, xyz in anchors.items()},
        "bases": {k: [round(float(v), 1) for v in xyz] for k, xyz in bases.items()},
        "heat": heat_zone(p),
        "sinks": {k: [round(float(v), 1) for v in xyz] for k, xyz in sinks.items()},
        # 故障车的停靠点（设计稿里 TK-037 在东北坑沿的路上，TK-081 放在西南侧台阶）
        "faultSpots": {k: [round(float(v), 1) for v in p.place(img)] for k, img in {"TK-037": (1130, 160), "TK-081": (330, 560)}.items()},
        "routes": routes,
        "swapPaths": swap_paths(p, anchors, sinks, {k: [q[:3] for q in v] for k, v in routes.items()}),
        "park": park_origin(p),
        "belt": belt,
    }
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    return {k: len(v) for k, v in routes.items()}


def ribbon_polylines(all_kinds=False):
    """给 Blender 画发光带用：每条路线里 ramp / exit / approach 连续段的折线 [[(x, y, z), …], …]；
    all_kinds 时整条路线（含平台上的环路段）各是一条折线（平台不再铺整圈的路，只画卡车走的段）"""
    p = Pit()
    a = cam.outline()["anchors"]
    anchors, _ = anchors_world(p, a)
    sinks = {"DP-W": dump_edge(p, "DP-W"), "DP-I": dump_edge(p, "DP-I"), "CR-01": anchors["CR-01"], "CR-02": anchors["CR-02"]}
    lines = []
    for es, (sink, d, extra) in PLAN.items():
        pts = build_route(p, anchors[es], sinks[sink], d, extra)
        if all_kinds:
            lines.append([(x, y, z) for x, y, z, _ in pts])
            continue
        cur = []
        for x, y, z, k in pts:
            if k == "loop":
                if len(cur) > 1:
                    lines.append(cur)
                cur = []
            else:
                cur.append((x, y, z))
        if len(cur) > 1:
            lines.append(cur)
    return lines

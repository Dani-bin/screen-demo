"""
智慧充电站建模 · 场站布局与摆放
----------------------------------------------------------
大型光储充超充站（依据概念图 docs/design/charging/08-ai-station-large.png）：
- 场地 78 × 64 m 悬浮沙盘（x -48..30，y -28..36），西南角朝向观众
- 快充区：3 排 T 形光伏雨棚，每排 10 根双枪直流桩（B01–B30），桩岛两侧对停共 60 个车位
- 超充区：4 根液冷超充终端（A01–A04）+ 功率柜，场地中部偏东
- 能源区（东北）：6 台储能柜、2 台箱变、6 台配电 / 逆变柜，带发光围栏
- 服务楼（东侧）：两层剖切，见 building.py
- 南侧：入口 / 出口道闸、价格立柱、斑马线；四周人行道、行道树、路灯

坐标：x 向东、y 向北（米），场地中心为原点。
对象命名即与 three.js 的接口约定：
  pile_B01（空对象）/ pile_B01_body / pile_B01_screen / pile_B01_status
  bay_B01_N、bay_B01_S（车位描边，状态色）；bay_A01
  ess_01…、transformer_01…、gate_in / gate_in_arm、gate_out / gate_out_arm、totem
"""

import math
import random

import bmesh
import numpy as np
from mathutils import Vector

from . import assets, building, lib, palette, vendor

# ---------------------------------------------------------------- 布局常量

SITE = (-48.0, 30.0, -28.0, 36.0)  # 场地范围 x0, x1, y0, y1（收紧东侧，场地更饱满）
CX, CY = (SITE[0] + SITE[1]) / 2, (SITE[2] + SITE[3]) / 2  # 场地中心
SITE_X, SITE_Y = (SITE[1] - SITE[0]) / 2, (SITE[3] - SITE[2]) / 2  # 半宽 / 半深
CORNER_R = 6.0  # 沙盘圆角
BASE_H = 3.2  # 沙盘厚度
WALK = 2.4  # 人行道宽

# 快充：三排雨棚中心 y；车位 2.8 m 宽、5.5 m 深；桩岛 1.2 m
FAST_ROWS = [24.0, 6.0, -12.0]
FAST_X0, FAST_N, BAY_W, BAY_D, ISLAND = -44.0, 10, 2.8, 5.5, 1.2
# 雨棚宽度：罩住桩岛和两侧车位的大部分（设计稿里车基本都在棚下），排间留约 7 m 行车道
CANOPY_W = 11.2

# 超充：4 个 5 m 宽车位，终端在北侧桩岛上（场地中部、服务楼西南）
SUPER_X0, SUPER_N, SUPER_W, SUPER_Y, SUPER_D = -5.0, 4, 5.0, -5.0, 6.0

# 能源区围栏范围
ENERGY = (-7.0, 26.5, 20.5, 33.2)  # x0, y0, x1, y1

# 服务楼中心
BUILDING_C = (13.0, 13.0)

# 出入口车道中心 x（南侧），价格立柱位置
ENTRY_X, EXIT_X = -38.0, -22.0
TOTEM_C = (-30.0, -24.4)

# 设计稿里的运行状态（预览用；实际状态由 three.js 仿真驱动）
FAST_STATUS = {3: "idle", 8: "idle", 12: "idle", 17: "fault", 19: "idle", 24: "idle", 26: "offline", 29: "idle"}
SUPER_STATUS = {3: "idle"}


def fast_status(i):
    return FAST_STATUS.get(i, "charging")


def super_status(i):
    return SUPER_STATUS.get(i, "charging")


# ---------------------------------------------------------------- 工具


def _rounded_rect(hx, hy, r, n=10, ox=0.0, oy=0.0):
    """圆角矩形轮廓点（逆时针），中心 (ox, oy)"""
    pts = []
    for cx, cy, a0 in ((hx - r, -hy + r, -90), (hx - r, hy - r, 0), (-hx + r, hy - r, 90), (-hx + r, -hy + r, 180)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((ox + cx + r * math.cos(a), oy + cy + r * math.sin(a)))
    return pts


def _outline_box(bm, x0, y0, x1, y1, w=0.2, z=0.03, mat=0):
    """矩形描边（四条细长条），用于车位"""
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    lx, ly = x1 - x0, y1 - y0
    lib.add_box(bm, (lx, w, 0.02), (cx, y0 + w / 2, z), mat=mat)
    lib.add_box(bm, (lx, w, 0.02), (cx, y1 - w / 2, z), mat=mat)
    lib.add_box(bm, (w, ly - 2 * w, 0.02), (x0 + w / 2, cy, z), mat=mat)
    lib.add_box(bm, (w, ly - 2 * w, 0.02), (x1 - w / 2, cy, z), mat=mat)


def _bay(M, col, name, x0, y0, x1, y1, status):
    """单个车位描边对象（材质按状态，three.js 会替换颜色）"""
    bm = bmesh.new()
    _outline_box(bm, x0 + 0.06, y0 + 0.06, x1 - 0.06, y1 - 0.06)
    me = lib.make_mesh(name, bm, [M["status_" + status]])
    return lib.place(me, name, col)


def _arrow(bm, x, y, rot, s=1.0, mat=0):
    """地面行车箭头（朝 rot 方向，rot=0 指向 +x）"""
    pts = [(1.4, 0), (0.2, 0.75), (0.2, 0.28), (-1.2, 0.28), (-1.2, -0.28), (0.2, -0.28), (0.2, -0.75)]
    c, sn = math.cos(rot), math.sin(rot)
    pts = [(x + s * (px * c - py * sn), y + s * (px * sn + py * c)) for px, py in pts]
    lib.add_prism(bm, pts, 0.02, 0.04, mat=mat)


def _dash_line(bm, p0, p1, dash=2.0, gap=2.0, w=0.14, mat=0):
    """虚线（行车道中心线）"""
    p0, p1 = Vector((*p0, 0)), Vector((*p1, 0))
    d = p1 - p0
    L = d.length
    u = d.normalized()
    rot = math.atan2(u.y, u.x)
    t = 0.0
    while t < L:
        a = p0 + u * t
        b = p0 + u * min(t + dash, L)
        c = (a + b) / 2
        lib.add_box(bm, ((b - a).length, w, 0.02), (c.x, c.y, 0.03), mat=mat, rot_z=rot)
        t += dash + gap


# ---------------------------------------------------------------- 主流程


def build(M, col_station, col_cars, col_preview):
    rng = random.Random(42)
    P = {}  # 预制件缓存

    # ---------------- 沙盘底座 + 地面
    pts = _rounded_rect(SITE_X, SITE_Y, CORNER_R, ox=CX, oy=CY)
    bm = bmesh.new()
    lib.add_prism(bm, pts, -BASE_H, 0.0, mat=0, top_mat=1)
    lib.uv_box(bm, 6.0)
    # 第二套 UV「Lightmap」：顶面按场地范围铺满 0..1，供 Cycles 烘焙地面光照（bake.py）；
    # 侧面压到角落一个像素，不占贴图
    lm = bm.loops.layers.uv.new("Lightmap")
    for f in bm.faces:
        # 按顶点高度判断顶面（此时 bmesh 法线尚未更新，不能用 f.normal）
        top = all(abs(v.co.z) < 1e-4 for v in f.verts)
        for l in f.loops:
            co = l.vert.co
            l[lm].uv = ((co.x - SITE[0]) / (SITE[1] - SITE[0]), (co.y - SITE[2]) / (SITE[3] - SITE[2])) if top else (0.001, 0.001)
    lib.place(lib.make_mesh("ground", bm, [M["base"], M["asphalt"]]), "ground", col_station)

    # 沙盘边缘发光：顶边、底边各一条偏蓝的细灯带（设计稿是清晰的细线，不是粗光管）；
    # 侧壁底部向上泛开的蓝光与地面光晕在 three.js 里做（ChargingScene._buildDecor）
    ring = [Vector((x, y, 0)) for x, y in pts] + [Vector((pts[0][0], pts[0][1], 0))]
    bm = bmesh.new()
    top = [v * 1.0 + Vector((0, 0, -0.12)) for v in ring]
    top = [Vector((CX + (v.x - CX) * (SITE_X + 0.05) / SITE_X, CY + (v.y - CY) * (SITE_Y + 0.05) / SITE_Y, v.z)) for v in top]
    lib.add_tube(bm, top, 0.045, seg=6)
    lib.place(lib.make_mesh("base_led_top", bm, [M["led_edge"]]), "base_led_top", col_station)
    bm = bmesh.new()
    bot = [Vector((CX + (v.x - CX) * (SITE_X + 0.06) / SITE_X, CY + (v.y - CY) * (SITE_Y + 0.06) / SITE_Y, -BASE_H + 0.1)) for v in ring]
    lib.add_tube(bm, bot, 0.05, seg=6)
    lib.place(lib.make_mesh("base_led_bottom", bm, [M["led_edge"]]), "base_led_bottom", col_station)

    # ---------------- 人行道（四周，南侧在出入口处断开）+ 路缘
    bm = bmesh.new()
    hx, hy, w = SITE_X, SITE_Y, WALK
    r = CORNER_R
    # 东、西、北三边直线段
    lib.add_box(bm, (2 * hx - 2 * r, w, 0.16), (CX, CY + hy - w / 2, 0.08))
    lib.add_box(bm, (w, 2 * hy - 2 * r, 0.16), (CX - hx + w / 2, CY, 0.08))
    lib.add_box(bm, (w, 2 * hy - 2 * r, 0.16), (CX + hx - w / 2, CY, 0.08))
    # 南边：避开入口、出口两段车道
    gaps = sorted([(ENTRY_X - 4, ENTRY_X + 4), (EXIT_X - 4, EXIT_X + 4)])
    xs = [CX - hx + r] + [g for gap in gaps for g in gap] + [CX + hx - r]
    for a, b in zip(xs[0::2], xs[1::2]):
        lib.add_box(bm, (b - a, w, 0.16), ((a + b) / 2, SITE[2] + w / 2, 0.08))
    # 四个圆角处的扇环
    for cx, cy, a0 in ((CX + hx - r, CY - hy + r, -90), (CX + hx - r, CY + hy - r, 0), (CX - hx + r, CY + hy - r, 90), (CX - hx + r, CY - hy + r, 180)):
        arc_o = [(cx + r * math.cos(math.radians(a0 + 90 * k / 8)), cy + r * math.sin(math.radians(a0 + 90 * k / 8))) for k in range(9)]
        arc_i = [(cx + (r - w) * math.cos(math.radians(a0 + 90 * k / 8)), cy + (r - w) * math.sin(math.radians(a0 + 90 * k / 8))) for k in range(9)]
        lib.add_prism(bm, arc_o + list(reversed(arc_i)), 0.0, 0.16)
    lib.uv_box(bm, 2.4)
    lib.place(lib.make_mesh("sidewalk", bm, [M["sidewalk"]]), "sidewalk", col_station)

    # ---------------- 地面标线：车道虚线、箭头、斑马线
    bm = bmesh.new()
    for y in (31.9, 15.0, -3.0):
        _dash_line(bm, (-45, y), (-14, y))
    _dash_line(bm, (-45, -21.6), (26, -21.6))
    _dash_line(bm, (-11, -21.6), (-11, 31.9))
    _dash_line(bm, (-11, 1.5), (19.4, 1.5))
    _dash_line(bm, (19.4, -21.6), (19.4, 1.5))
    for (x, y, a) in ((-30, 15, math.pi), (-30, -3, 0), (-30, 31.9, 0), (-11, 8, math.pi / 2), (-11, -12, -math.pi / 2), (8, -21.6, 0), (6, 1.5, 0), (-30, -21.6, math.pi), (ENTRY_X, -21.8, math.pi / 2), (EXIT_X, -21.8, -math.pi / 2)):
        _arrow(bm, x, y, a, 1.1)
    lane = lib.make_mesh("lane_marks", bm, [M["lane"]])
    lib.place(lane, "lane_marks", col_station)
    bm = bmesh.new()
    for gx in (ENTRY_X, EXIT_X):
        for i in range(7):
            lib.add_box(bm, (0.55, 2.6, 0.02), (gx - 3 + i * 1.0, SITE[2] + w / 2, 0.03))  # 斑马线
        lib.add_box(bm, (7.0, 0.3, 0.02), (gx, SITE[2] + w + 1.2, 0.03))  # 停止线
    lib.place(lib.make_mesh("zebra", bm, [M["paint"]]), "zebra", col_station)

    # ---------------- 快充区
    # 快充桩：机身用外部 CC-BY 模型（vendor.py），状态灯与屏幕仍为自建部件
    fp = {"body": vendor.load("pile", "VP"), **assets.vendor_pile_overlays(M)}
    length = FAST_N * BAY_W + 2.0
    cx_can = FAST_X0 + FAST_N * BAY_W / 2
    col_x = [FAST_X0 + BAY_W * k - cx_can for k in (1, 3, 5, 7, 9)]
    cars = _car_prefabs(M, col_cars)
    pile_idx = 0
    for r_i, cy in enumerate(FAST_ROWS):
        # 桩岛（抬高 + 路缘）
        bm = bmesh.new()
        lib.add_box(bm, (FAST_N * BAY_W + 1.2, ISLAND, 0.18), (cx_can, cy, 0.09), bevel=0.05, mat=0)
        lib.place(lib.make_mesh(f"island_F{r_i + 1}", bm, [M["curb"]], smooth_angle=40), f"island_F{r_i + 1}", col_station)
        # 雨棚只罩桩岛和车头（宽约 8.6 m），俯视时车位里的车仍能看到大半
        can = assets.canopy(M, length, CANOPY_W, 5.6, f"canopy_F{r_i + 1}", col_x)
        _canopy_light(col_preview, f"pv_canopy_light_F{r_i + 1}", (cx_can, cy, 5.0), (length - 2, CANOPY_W - 0.6))
        for k, me in can.items():
            lib.place(me, f"canopy_F{r_i + 1}_{k}", col_station, (cx_can, cy, 0))
        for i in range(FAST_N):
            pile_idx += 1
            pid = f"B{pile_idx:02d}"
            st = fast_status(pile_idx)
            x = FAST_X0 + BAY_W * (i + 0.5)
            root = lib.empty("pile_" + pid, col_station, (x, cy, 0.18))
            for k in ("body", "screen", "status"):
                ob = lib.place(fp[k], f"pile_{pid}_{k}", col_station, parent=root)
                if k == "status":
                    ob.material_slots[0].link = "OBJECT"
                    ob.material_slots[0].material = M["status_" + st]
            # 南北两个车位：双枪桩两侧各一个，充电中的桩偶尔只用一把枪
            for side, s in (("N", 1), ("S", -1)):
                y0 = cy + s * ISLAND / 2
                y1 = y0 + s * BAY_D
                bst = st
                if st == "charging" and rng.random() < 0.18:
                    bst = "idle"
                if st == "fault" and side == "N":
                    bst = "idle"
                _bay(M, col_station, f"bay_{pid}_{side}", x - BAY_W / 2, min(y0, y1), x + BAY_W / 2, max(y0, y1), bst)
                # 预览用车辆：车位非空闲即有车（离线桩上停着车但不充电）
                if bst != "idle":
                    kind, paint = _pick_car(rng)
                    car = lib.place(cars[(kind, paint)], f"pv_car_{pid}_{side}", col_preview, (x + rng.uniform(-0.08, 0.08), cy + s * (ISLAND / 2 + 2.7), 0), rot_z=-s * math.pi / 2)
                    if bst == "charging":
                        _cable(M, col_preview, f"pv_cable_{pid}_{side}", (x + 0.53 * (1 if s > 0 else -1), cy + s * 0.12, 1.15), (x - 0.55, cy + s * (ISLAND / 2 + 0.55), 0.85))
                    if bst == "fault":
                        _alarm_rings(M, col_preview, f"pv_alarm_{pid}", (x, cy + s * (ISLAND / 2 + 2.7)))

    # ---------------- 超充区
    sp = assets.super_pile(M)
    bm = bmesh.new()
    lib.add_box(bm, (SUPER_N * SUPER_W + 3, 2.2, 0.25), (SUPER_X0 + SUPER_N * SUPER_W / 2 + 1, SUPER_Y + 0.6, 0.125), bevel=0.06, mat=0)
    lib.add_box(bm, (SUPER_N * SUPER_W + 2.6, 1.8, 0.04), (SUPER_X0 + SUPER_N * SUPER_W / 2 + 1, SUPER_Y + 0.6, 0.26), mat=1)
    lib.place(lib.make_mesh("island_super", bm, [M["curb"], M["grass"]], smooth_angle=40), "island_super", col_station)
    for i in range(SUPER_N):
        aid = f"A{i + 1:02d}"
        st = super_status(i + 1)
        x = SUPER_X0 + SUPER_W * (i + 0.5)
        root = lib.empty("pile_" + aid, col_station, (x, SUPER_Y, 0.25))
        for k in ("body", "screen", "status"):
            ob = lib.place(sp[k], f"pile_{aid}_{k}", col_station, parent=root)
            if k == "status":
                ob.material_slots[0].link = "OBJECT"
                ob.material_slots[0].material = M["status_" + st]
        _bay(M, col_station, f"bay_{aid}", x - SUPER_W / 2, SUPER_Y - 0.5 - SUPER_D, x + SUPER_W / 2, SUPER_Y - 0.5, st)
        if st == "charging":
            kind, paint = _pick_car(rng)
            lib.place(cars[(kind, paint)], f"pv_car_{aid}", col_preview, (x, SUPER_Y - 0.5 - 2.9, 0), rot_z=math.pi / 2)
            _cable(M, col_preview, f"pv_cable_{aid}", (x + 0.34, SUPER_Y - 0.5, 1.15), (x - 0.6, SUPER_Y - 1.1, 0.85), r=0.055)
    lib.place(assets.power_cabinet(M), "power_cabinet_A", col_station, (SUPER_X0 + SUPER_N * SUPER_W + 2.2, SUPER_Y + 0.6, 0.25))
    # 超充区两端绿化
    P["tree0"] = assets.tree(M, 0)
    P["tree1"] = assets.tree(M, 1)
    P["tree2"] = assets.tree(M, 2)
    P["bush"] = assets.bush(M)
    for x in (SUPER_X0 - 0.8,):
        lib.place(P["bush"], "bush_super_w", col_station, (x, SUPER_Y + 0.6, 0.25))

    # ---------------- 能源区
    ex0, ey0, ex1, ey1 = ENERGY
    bm = bmesh.new()
    lib.add_box(bm, (ex1 - ex0, ey1 - ey0, 0.12), ((ex0 + ex1) / 2, (ey0 + ey1) / 2, 0.06), mat=0)
    lib.place(lib.make_mesh("energy_pad", bm, [M["base_top"]]), "energy_pad", col_station)
    ess = assets.ess_cabinet(M)
    for k in range(6):
        lib.place(ess, f"ess_{k + 1:02d}", col_station, (-4.6 + 2.9 * k, 30.8, 0.12))
    tf = assets.transformer(M)
    for k, x in enumerate((13.0, 17.6)):
        lib.place(tf, f"transformer_{k + 1:02d}", col_station, (x, 31.0, 0.12))
    sg = assets.switchgear(M)
    for k in range(6):
        lib.place(sg, f"switchgear_{k + 1:02d}", col_station, (12.2 + 1.1 * k, 27.5, 0.12))
    # 围栏：钢立柱 + 顶部扶手 + 钢丝网（南侧留门）。设计稿里围栏是深色金属网、不发光
    bm = bmesh.new()
    segs = [((ex0, ey0), (ex0, ey1)), ((ex0, ey1), (ex1, ey1)), ((ex1, ey1), (ex1, ey0)), ((ex0, ey0), (ex1 - 6, ey0))]
    for (x0, y0), (x1, y1) in segs:
        L = math.hypot(x1 - x0, y1 - y0)
        n = max(1, int(L / 2.0))
        for i in range(n + 1):
            t = i / n
            lib.add_box(bm, (0.08, 0.08, 1.8), (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.9))
        lib.add_box(bm, (abs(x1 - x0) + 0.08, abs(y1 - y0) + 0.08, 0.05), ((x0 + x1) / 2, (y0 + y1) / 2, 1.8))  # 扶手
        # 钢丝网：竖直面，UV 按米铺（贴图 1 格 ≈ 0.12 m）
        horiz = abs(x1 - x0) > abs(y1 - y0)
        rot = lib.FACE_S if horiz else lib.FACE_E
        lib.add_plane(bm, (L, 1.6), ((x0 + x1) / 2, (y0 + y1) / 2, 0.92), rot=rot, mat=1, uv=(0, 0, L / 1.0, 1.6))
    lib.place(lib.make_mesh("energy_fence", bm, [M["steel"], M["fence_mesh"]]), "energy_fence", col_station)

    # ---------------- 服务楼
    b = building.build(M)
    bx, by = BUILDING_C
    lib.place(b["shell"], "service_building", col_station, (bx, by, 0))
    lib.place(b["led"], "service_building_led", col_station, (bx, by, 0))

    # ---------------- 出入口、价格立柱
    g = assets.gate(M)
    for name, gx, d in (("gate_in", ENTRY_X, 1), ("gate_out", EXIT_X, -1)):
        px = gx + d * 3.6  # 闸机柱在车道一侧，闸杆横跨车道
        y = SITE[2] + WALK + 2.6
        # 岗亭在闸机柱外侧（局部 -x），所以入口（柱在车道东侧）要转 180°
        base = lib.place(g["base"], name, col_station, (px, y, 0), rot_z=math.pi if d > 0 else 0)
        # 闸杆默认落下，抬杆动画由 three.js 在车辆进 / 出站时驱动
        lib.place(g["arm"], name + "_arm", col_station, (px, y, 1.0), rot_z=math.pi if d > 0 else 0)
    lib.place(assets.totem(M), "totem", col_station, (TOTEM_C[0], TOTEM_C[1], 0.25))
    bm = bmesh.new()
    lib.add_box(bm, (6.0, 3.2, 0.25), (TOTEM_C[0], TOTEM_C[1], 0.125), bevel=0.08, mat=0)
    lib.add_box(bm, (5.6, 2.8, 0.04), (TOTEM_C[0], TOTEM_C[1], 0.26), mat=1)
    lib.place(lib.make_mesh("totem_planter", bm, [M["planter"], M["grass"]], smooth_angle=40), "totem_planter", col_station)

    # ---------------- 东南景观区（花坛 + 树）
    bm = bmesh.new()
    for (x0, y0, x1, y1) in ((21.0, -19.4, 27.4, -3.5), (-8, -25.4, 15, -23.6), (18.5, -25.4, 27.4, -23.6), (23.5, 3.5, 27.4, 22.0)):
        lib.add_box(bm, (x1 - x0, y1 - y0, 0.35), ((x0 + x1) / 2, (y0 + y1) / 2, 0.175), bevel=0.1, mat=0)
        lib.add_box(bm, (x1 - x0 - 0.4, y1 - y0 - 0.4, 0.04), ((x0 + x1) / 2, (y0 + y1) / 2, 0.37), mat=1)
    lib.place(lib.make_mesh("planters", bm, [M["planter"], M["grass"]], smooth_angle=40), "planters", col_station)

    # ---------------- 树、灌木、路灯、隔离桩
    trees = []
    for x in range(-44, 29, 7):
        if ENERGY[0] - 2 < x < ENERGY[2] + 2:
            continue  # 能源区围栏一段不种树
        trees.append((x + rng.uniform(-0.6, 0.6), SITE[3] - 1.2, 0.16))  # 北侧行道树
    for y in range(-20, 33, 7):
        trees.append((SITE[0] + 1.2, y + rng.uniform(-0.6, 0.6), 0.16))  # 西侧
    for y in range(-20, 32, 7):
        trees.append((SITE[1] - 1.2, y, 0.16))  # 东侧行道树
    for (x, y) in ((22.5, -16), (25.5, -12.5), (22.5, -9), (25.5, -5.8), (25.4, 6.5), (25.4, 11.5), (25.4, 16.5), (25.4, 21)):
        trees.append((x, y, 0.37))  # 楼东、楼南花坛
    for x in (-5, 1, 7, 13, 20.5, 25.5):
        trees.append((x, -24.5, 0.37))  # 南侧花坛带
    for i, (x, y, z) in enumerate(trees):
        lib.place(P[f"tree{i % 3}"], f"tree_{i:03d}", col_station, (x, y, z), rot_z=rng.uniform(0, 6.28))
    for i, (x, y) in enumerate(((24, -14.5), (22.2, -11), (24.2, -7.5), (26.2, -17.5), (24.2, 9), (24.2, 14), (24.2, 19), (-2, -24.5), (10, -24.5), (-27.5, -23.6), (-32.4, -25.2), (23, -24.5))):
        lib.place(P["bush"], f"bush_{i:03d}", col_station, (x, y, 0.37), rot_z=rng.uniform(0, 6.28))
    sl = assets.street_light(M)
    lights = [(x, SITE[3] - WALK + 0.4, -math.pi / 2) for x in (-40, -24, -8, 24)]
    lights += [(SITE[0] + WALK - 0.4, y, 0) for y in (-14, 6, 24)]
    lights += [(SITE[1] - WALK + 0.4, y, math.pi) for y in (-16, 26)]
    lights += [(x, SITE[2] + WALK - 0.4, math.pi / 2) for x in (-46, -14, 6, 26)]
    for i, (x, y, a) in enumerate(lights):
        lib.place(sl, f"street_light_{i:02d}", col_station, (x, y, 0.16), rot_z=a)
        # 路灯下的暖色光斑（预览 / 烘焙用的聚光灯，不导出）
        _spot(col_preview, f"pv_spot_{i:02d}", (x + 1.2 * math.cos(a), y + 1.2 * math.sin(a), 6.7), 900)
    bo = assets.bollard(M)
    bols = [(ENTRY_X + d * 4.4, SITE[2] + WALK + 0.4) for d in (-1, 1)] + [(EXIT_X + d * 4.4, SITE[2] + WALK + 0.4) for d in (-1, 1)]
    for cy in FAST_ROWS:
        bols += [(FAST_X0 - 1.2, cy), (FAST_X0 + FAST_N * BAY_W + 1.2, cy)]
    bols += [(SUPER_X0 - 1.6, SUPER_Y - 1), (SUPER_X0 + SUPER_N * SUPER_W + 1.0, SUPER_Y - 1)]
    for i, (x, y) in enumerate(bols):
        lib.place(bo, f"bollard_{i:02d}", col_station, (x, y, 0.0))
    # 人行道外侧的灌木带（西、北两边，避开路灯与树）
    k = 0
    for x in range(-43, 40, 3):
        if ENERGY[0] - 1 < x < ENERGY[2] + 1 or x % 7 == 0:
            continue
        lib.place(P["bush"], f"bush_edge_{k:03d}", col_station, (x + 0.5, SITE[3] - 1.0, 0.16), rot_z=rng.uniform(0, 6.28))
        k += 1
    for y in range(-19, 33, 3):
        if y % 7 == 0:
            continue
        lib.place(P["bush"], f"bush_edge_{k:03d}", col_station, (SITE[0] + 1.0, y + 0.5, 0.16), rot_z=rng.uniform(0, 6.28))
        k += 1
    # 服务楼室内补光（预览）
    for z in (2.5, 6.8):
        _area(col_preview, f"pv_bld_light_{z}", (BUILDING_C[0], BUILDING_C[1], z), (16, 14), 900 if z < 5 else 600, (0.75, 0.88, 1.0))

    _underglow(M, col_preview)


# ---------------------------------------------------------------- 预览专用（不导出）


# 车漆分布：白、银、黑占多数，更接近真实停车场
_PAINT_W = [("white", 26), ("silver", 20), ("black", 18), ("graphite", 16), ("blue", 12), ("red", 8)]


# 车型分布（与 sim/simulator.js 的 CAR_KINDS 一致）
_KIND_W = [("sedan", 30), ("lavida", 25), ("sylphy", 20), ("suv", 25)]


def _pick_car(rng):
    r = rng.uniform(0, sum(w for _, w in _KIND_W))
    kind = _KIND_W[-1][0]
    for k, w in _KIND_W:
        r -= w
        if r <= 0:
            kind = k
            break
    r = rng.uniform(0, sum(w for _, w in _PAINT_W))
    for p, w in _PAINT_W:
        r -= w
        if r <= 0:
            return kind, p
    return kind, "white"


def _area(col, name, loc, size, power, color=(0.85, 0.93, 1.0)):
    """矩形面光（朝下），模拟棚底 / 室内灯光照亮地面"""
    import bpy

    li = bpy.data.lights.new(name, "AREA")
    li.shape = "RECTANGLE"
    li.size, li.size_y = size
    li.energy = power
    li.color = color
    ob = bpy.data.objects.new(name, li)
    ob.location = loc
    col.objects.link(ob)
    return ob


def _canopy_light(col, name, loc, size):
    return _area(col, name, loc, size, 5200)


def _spot(col, name, loc, power):
    """朝下的暖色聚光灯（路灯光斑）"""
    import bpy

    li = bpy.data.lights.new(name, "SPOT")
    li.energy = power
    li.color = (1.0, 0.82, 0.6)
    li.spot_size = math.radians(110)
    li.spot_blend = 0.6
    li.shadow_soft_size = 0.3
    ob = bpy.data.objects.new(name, li)
    ob.location = loc
    col.objects.link(ob)
    return ob


def _car_prefabs(M, col_cars):
    """
    车辆预制：4 款外部模型（特斯拉 Model 3、宝马 X6M、大众朗逸、日产轩逸，署名见 vendor.py）。
    导出到 CARS 集合（cars.glb）的每款只有一份 car_<sedan|suv|lavida|sylphy>，车漆为通用的 M_car_paint，
    由 three.js 按仿真结果换色——6 种漆色各存一份几何会让 cars.glb 膨胀到 12 MB。
    返回 {(车型, 漆色): 网格}，只给 Blender 预览摆车用（不导出）
    """
    out = {}
    paints = ["black", "graphite", "silver", "white", "blue", "red"]
    kinds = (("sedan", "VT"), ("suv", "VB"), ("lavida", "VL"), ("sylphy", "VN"))
    for i, (kind, prefix) in enumerate(kinds):
        base = vendor.load(kind, prefix, M)
        me = vendor.car_variant(base, kind, prefix, M["car_paint"], f"car_{kind}")
        lib.place(me, f"car_{kind}", col_cars, (i * 6.0, 60, 0))
        for p in paints:
            out[(kind, p)] = vendor.car_variant(base, kind, prefix, M["paint_" + p], f"pv_{kind}_{p}")
    return out


def _cable(M, col, name, p0, p1, r=0.035):
    bm = bmesh.new()
    lib.add_tube(bm, lib.sag(p0, p1, 0.55), r, seg=8)
    lib.place(lib.make_mesh(name, bm, [M["status_charging"]]), name, col)


def _alarm_rings(M, col, name, c):
    """故障车位的红色同心圆波纹（three.js 里会做扩散动画）"""
    bm = bmesh.new()
    for k, rr in enumerate((2.2, 3.1, 4.0)):
        pts = [(c[0] + rr * math.cos(a), c[1] + rr * math.sin(a)) for a in (2 * math.pi * i / 64 for i in range(64))]
        inner = [(c[0] + (rr - 0.14) * math.cos(a), c[1] + (rr - 0.14) * math.sin(a)) for a in (2 * math.pi * i / 64 for i in range(64))]
        for i in range(64):
            j = (i + 1) % 64
            lib.add_prism(bm, [pts[i], pts[j], inner[j], inner[i]], 0.03, 0.05)
    lib.place(lib.make_mesh(name, bm, [M["alarm"]]), name, col)


def _underglow(M, col):
    """沙盘下方的蓝色光晕（预览氛围用，three.js 里用贴片实现）"""
    def paint(a):
        h, w = a.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        d = np.hypot((xx - w / 2) / (w / 2), (yy - h / 2) / (h / 2))
        k = np.clip(1 - d, 0, 1) ** 2
        a[..., 0] = 0.05 * k
        a[..., 1] = 0.35 * k
        a[..., 2] = 1.0 * k
        a[..., 3] = k

    img = lib.image("T_underglow", 256, 256, paint)
    m = lib.material("M_underglow", "#000000", emit="#ffffff", tex=img, emit_tex=True, strength=0.9, alpha=0.99)
    nt = m.node_tree
    tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    bm = bmesh.new()
    lib.add_plane(bm, (SITE_X * 2.7, SITE_Y * 3.0), (CX, CY, -BASE_H - 0.6))
    lib.place(lib.make_mesh("pv_underglow", bm, [m]), "pv_underglow", col)

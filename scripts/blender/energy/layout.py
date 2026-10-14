"""
综合能源补给站建模 · 场站布局与摆放
----------------------------------------------------------
读取 site.json（scripts/energy/draw_plan.py 生成，与规划图 plan-v2.png 同源），把规划米坐标 (u, v)
换算成 Blender 坐标并摆放全部要素：

    x = 110 - u   （沿门前道路，u 小的一端为 +x）
    y = v - 40    （指向场内，门前国道在 -y 侧）

这样 (u, v) 这套「左手」规划坐标换到右手系时不会镜像，车辆仍是靠场地一侧向 +u（-x）行驶。

v2 布局按设计稿 docs/design/energy/01-ai-overview.png 反求（见 draw_plan.py 与 README），沙盘组成：
- 底座：超椭圆外轮廓（含门前国道），侧壁深色金属，前半圈顶边蓝色灯带（后半圈藏在远山后面）
- 门前国道：双向六车道 + 中央隔离带（隔离墩、双臂路灯）+ 两侧绿化带（灌木、路灯）
- 场地内：草地底 → 站内道路 / 站坪 / 停车场铺装 → 标线 → 各功能区设施 → 树林
- 远山：沙盘后方起伏的山林与村庄灯火（不参与地面烘焙）

代码驱动的对象名（three.js 按名字查找，改名要同步改 src/views/energy/scene）：
    bay_C01..C10            重卡超充位地面描边（状态色）
    pile_C01..C10(_body/_screen/_status)  超充终端
    canopy_fuel_* / canopy_lng_* / carport_*  罩棚 / 车棚（_led 灯带、_light 棚底灯、_pv 光伏）
    swap_station_* / office_* / lng_tank / transformer_01..02
    anchor_<key>            悬浮标签锚点（空对象）：fuel swap office lng charge power tank cng
"""

import json
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import assets, lib

SITE_JSON = os.path.join(os.path.dirname(__file__), "site.json")

BASE_DEPTH = 4.0  # 沙盘底座厚度（顶面 z=0 以下）
LED_V_MAX = 46.0  # 底座顶边灯带只沿 v < 46 的一段（后半圈被远山挡住，灯带露在树林里不自然）

# 门前国道：南行（靠场地，向 +u）三车道 v -14.5 ~ -4，北行三车道 v -28 ~ -17.5，中间隔离带
LANES_V = {"sNear": -5.75, "sMid": -9.25, "sFar": -12.75, "nNear": -19.25, "nMid": -22.75, "nFar": -26.25}
# 场地侧绿化带被出入口打断的 u 区间（重卡入口、中部出入口、西端小车出口）
GATES_U = ((18.0, 34.0), (128.0, 162.0), (206.0, 232.0))

# 烘焙用光源位置（lights.py 读取）：路灯灯头 [(x, y, z), …]、树下投光 [(x, y)]
LAMPS = []
UPLIGHTS = []

# 超充终端编号
PILE_IDS = [f"C{i + 1:02d}" for i in range(10)]


# ---------------------------------------------------------------- 坐标与多边形工具


def W(u, v):
    """规划米坐标 → Blender xy"""
    return (110.0 - u, v - 40.0)


def xy(pts):
    """(u, v) 点列 → Blender xy 点列，并保证逆时针（add_prism 的顶面朝上）"""
    out = [W(u, v) for u, v in pts]
    return out if _area(out) > 0 else out[::-1]


def _area(pts):
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return a / 2


def bounds(uv):
    """轴对齐矩形（u, v 点列）→ Blender 中心 (x, y) 与尺寸 (沿 x, 沿 y)"""
    us = [p[0] for p in uv]
    vs = [p[1] for p in uv]
    cx, cy = W((min(us) + max(us)) / 2, (min(vs) + max(vs)) / 2)
    return (cx, cy), (max(us) - min(us), max(vs) - min(vs))


def rect(u0, u1, v0, v1):
    return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]


def clip(poly, a, b, c):
    """Sutherland–Hodgman：保留 a*u + b*v + c >= 0 的部分（凹多边形也适用于单个半平面）"""
    out = []
    n = len(poly)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        fp, fq = a * p[0] + b * p[1] + c, a * q[0] + b * q[1] + c
        if fp >= 0:
            out.append(p)
        if (fp >= 0) != (fq >= 0):
            t = fp / (fp - fq)
            out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
    return out


def band(poly, v0, v1, u0=None, u1=None):
    """多边形里 v0 <= v <= v1（可选再限定 u0 <= u <= u1）的部分"""
    out = clip(clip(poly, 0, 1, -v0), 0, -1, v1)
    if u0 is not None:
        out = clip(out, 1, 0, -u0)
    if u1 is not None:
        out = clip(out, -1, 0, u1)
    return out


def inside(pt, poly):
    """射线法判断点是否在多边形内"""
    x, y = pt
    res = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            res = not res
    return res


def _resample(pts, step):
    """闭合点列按弧长等距重采样"""
    seq = pts + [pts[0]]
    segs = [math.dist(seq[i], seq[i + 1]) for i in range(len(pts))]
    total = sum(segs)
    n = max(8, int(total / step))
    out, i, acc = [], 0, 0.0
    for k in range(n):
        d = k * total / n
        while acc + segs[i] < d:
            acc += segs[i]
            i += 1
        t = (d - acc) / segs[i] if segs[i] else 0
        p, q = seq[i], seq[i + 1]
        out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
    return out


def platform_outline(data):
    """沙盘外轮廓（超椭圆，含门前国道）：按 2 m 等距重采样，(u, v) 平面上逆时针"""
    pts = _resample([tuple(p) for p in data["platform"]], 2.0)
    return pts if _area(pts) > 0 else pts[::-1]


def span_at(poly, v):
    """多边形与 v = 常数直线的交点 u 范围（国道两端被沙盘轮廓裁过，每条车道的长度不同）"""
    us = []
    n = len(poly)
    for i in range(n):
        (u0, v0), (u1, v1) = poly[i], poly[(i + 1) % n]
        if (v0 - v) * (v1 - v) <= 0 and v0 != v1:
            us.append(u0 + (v - v0) / (v1 - v0) * (u1 - u0))
    return (min(us), max(us)) if us else (0.0, 0.0)


def back_v(poly, u):
    """沙盘外轮廓在 u 处的最大 v（后沿）；u 超出轮廓时返回 None"""
    vs = []
    n = len(poly)
    for i in range(n):
        (u0, v0), (u1, v1) = poly[i], poly[(i + 1) % n]
        if (u0 - u) * (u1 - u) <= 0 and u0 != u1:
            vs.append(v0 + (u - u0) / (u1 - u0) * (v1 - v0))
    return max(vs) if vs else None


# ---------------------------------------------------------------- 地面与沙盘


def _flat(bm, uv_poly, z0, z1, mat, top_mat=None):
    if len(uv_poly) >= 3:
        lib.add_prism(bm, xy(uv_poly), z0, z1, mat=mat, top_mat=top_mat)


def verge_segments(plat, v0, v1):
    """场地侧绿化带（v0..v1）按出入口打断后的各段多边形"""
    out = []
    cuts = [(-1e3, -1e3)] + list(GATES_U) + [(1e3, 1e3)]
    for (_, a), (b, _) in zip(cuts[:-1], cuts[1:]):
        p = band(plat, v0, v1, a, b)
        if len(p) >= 3:
            out.append(p)
    return out


def build_ground(M, col, plat, hwy):
    """沙盘底座、顶边灯带、门前国道与两侧绿化带、场地草地"""
    pxy = xy(plat)
    n = len(pxy)

    # 底座侧壁：外轮廓（z=0）到 z = -BASE_DEPTH
    bm = bmesh.new()
    top = [bm.verts.new((x, y, 0.0)) for x, y in pxy]
    bot = [bm.verts.new((x, y, -BASE_DEPTH)) for x, y in pxy]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
    bm.faces.new(bot[::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    lib.new_object("base_wall", bm, [M["base"]], col)

    # 顶边灯带：沿外轮廓外侧 4 cm 的竖向细带，只做前半圈（v < LED_V_MAX）
    bm = bmesh.new()
    for i in range(n):
        j = (i + 1) % n
        a, b = Vector((*pxy[i], 0)), Vector((*pxy[j], 0))
        if max(a.y, b.y) + 40.0 > LED_V_MAX:
            continue
        nrm = Vector((b.y - a.y, -(b.x - a.x), 0)).normalized() * 0.04  # 逆时针多边形的外法线
        vs = [bm.verts.new(p) for p in (a + nrm + Vector((0, 0, -0.14)), b + nrm + Vector((0, 0, -0.14)), b + nrm, a + nrm)]
        bm.faces.new(vs)
    lib.new_object("base_led", bm, [M["led_edge"]], col)

    # 门前国道：两幅沥青路面 + 中央隔离带 + 两侧绿化带（绿化带高出路面，侧面是路缘石）
    m0, m1 = hwy["median"]
    bm = bmesh.new()
    _flat(bm, band(plat, hwy["front"], m0), -0.1, 0.02, 0)
    _flat(bm, band(plat, m1, hwy["edge"]), -0.1, 0.02, 0)
    _flat(bm, band(plat, m0, m1), -0.1, 0.15, 1, top_mat=2)
    _flat(bm, band(plat, -1e3, hwy["front"]), -0.1, 0.12, 1, top_mat=2)
    for p in verge_segments(plat, hwy["edge"], 0.0):
        _flat(bm, p, -0.1, 0.12, 1, top_mat=2)
    lib.uv_box(bm, 6.0)
    lib.new_object("road", bm, [M["asphalt_road"], M["curb"], M["grass"]], col)
    road_markings(M, col, plat, hwy)

    # 场地草地（v >= 0）
    bm = bmesh.new()
    _flat(bm, band(plat, 0.0, 1e3), -0.1, 0.0, 0)
    lib.uv_box(bm, 6.0)
    lib.new_object("site_grass", bm, [M["grass"]], col)


def road_markings(M, col, plat, hwy):
    """
    门前国道标线：两幅路面各两条白色车道虚线、外侧白色边线、靠隔离带一侧黄线；
    中央隔离墩、前侧绿化带外沿的钢护栏、隔离带上每 32 m 一盏双臂路灯。每条线按自己所在 v 处的路面范围截断
    """
    m0, m1 = hwy["median"]
    near = band(plat, hwy["front"], m0)
    far = band(plat, m1, hwy["edge"])
    bm = bmesh.new()

    def strip(poly, v, w, mat):
        a, b = span_at(poly, v)
        a, b = a + 3, b - 3
        if b - a < 4:
            return
        cx, cy = W((a + b) / 2, v)
        lib.add_plane(bm, (b - a, w), (cx, cy, 0.035), mat=mat)

    strip(far, hwy["edge"] - 0.4, 0.18, 0)
    strip(far, m1 + 0.4, 0.15, 1)
    strip(near, m0 - 0.4, 0.15, 1)
    strip(near, hwy["front"] + 0.4, 0.18, 0)
    lib.new_object("road_lines", bm, [M["paint"], M["paint_yellow"]], col)

    # 车道虚线：3 m 线 + 4.5 m 空（每幅 3 车道，两条分隔线）
    bm = bmesh.new()
    for poly, vs in ((far, (-7.5, -11.0)), (near, (-21.0, -24.5))):
        for v in vs:
            a, b = span_at(poly, v)
            u = a + 3
            while u < b - 6:
                cx, cy = W(u + 1.5, v)
                lib.add_plane(bm, (3.0, 0.15), (cx, cy, 0.035))
                u += 7.5
    lib.new_object("road_dashes", bm, [M["paint"]], col)

    # 中央隔离墩（新泽西式：下宽上窄）+ 前侧路肩钢护栏（波形梁 + 立柱）
    vmid = (m0 + m1) / 2
    a, b = span_at(band(plat, m0, m1), vmid)
    a, b = a + 2, b - 2
    bm = bmesh.new()
    prof = [(-0.3, 0.0), (0.3, 0.0), (0.12, 0.3), (0.08, 0.82), (-0.08, 0.82), (-0.12, 0.3)]
    tmp = bmesh.new()
    vs0 = [tmp.verts.new((a, y, z)) for y, z in prof]
    vs1 = [tmp.verts.new((b, y, z)) for y, z in prof]
    k = len(prof)
    for i in range(k):
        tmp.faces.new((vs0[i], vs0[(i + 1) % k], vs1[(i + 1) % k], vs1[i]))
    tmp.faces.new(vs0[::-1])
    tmp.faces.new(vs1)
    bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)
    # 规划坐标 (u, v) → Blender：x = 110 - u，y = v - 40；隔离带顶面高 0.15
    bmesh.ops.transform(tmp, matrix=Matrix(((-1, 0, 0, 110), (0, 1, 0, vmid - 40), (0, 0, 1, 0.15), (0, 0, 0, 1))), verts=tmp.verts)
    lib._merge(bm, tmp)
    gv = hwy["front"] - 0.5
    ga, gb = span_at(plat, gv)
    ga, gb = ga + 4, gb - 4
    cx, cy = W((ga + gb) / 2, gv)
    lib.add_box(bm, (gb - ga, 0.06, 0.32), (cx, cy, 0.74), mat=1)
    u = ga
    while u < gb:
        x, y = W(u, gv)
        lib.add_box(bm, (0.12, 0.12, 0.8), (x, y - 0.1, 0.52), mat=1)
        u += 4.0
    lib.new_object("road_barrier", bm, [M["concrete"], M["steel"]], col)

    # 隔离带双臂路灯
    lamp2 = assets.street_light_double(M)
    k = 0
    u = a + 8
    while u < b - 4:
        x, y = W(u, vmid)
        lib.place(lamp2, f"lamp_mid_{k:02d}", col, (x, y, 0.15))
        LAMPS.append(((x, y - 2.2, 9.93), (x, y + 2.2, 9.93)))
        k += 1
        u += 32.0


def build_site_roads(M, col, data):
    """站内道路（沥青）、罩棚站坪（浅色混凝土）、超充车位整片铺装"""
    bm = bmesh.new()
    # 各块沥青互有重叠：顶面高度逐块错开 1.5 mm，避免共面——共面重叠时 Cycles 烘焙的光线从一块面出发
    # 立刻打到另一块，整片烘成黑色；错开后后建的（更高的）面在 Lightmap 里覆盖先建的
    roads = data["roads"] + [rect(68, 136.5, 39, 60.5)]  # 末尾：重卡超充车位整片沥青，覆盖到车位后沿
    for i, r in enumerate(roads):
        _flat(bm, r, -0.05, 0.02 + 0.0015 * i, 0)
    # 站坪：加油加气罩棚一带、LNG 罩棚下铺浅灰混凝土（略高 1 cm），设计稿里罩棚下是被灯照亮的浅色地坪
    for r in data["forecourt"]:
        _flat(bm, r, -0.05, 0.045, 1)
    _flat(bm, rect(82, 130, 4, 24), -0.05, 0.0465, 1)
    lib.uv_box(bm, 6.0)
    lib.new_object("site_roads", bm, [M["asphalt"], M["forecourt"]], col)

    # 停车场、设备基础、绿岛（顶面草地、侧面路缘石）
    Z = data["zones"]
    bm = bmesh.new()
    for r in data["paving"]:
        _flat(bm, r, -0.05, 0.05, 0)
    for key in ("CNG储气", "LNG储罐区", "换电站"):
        _flat(bm, Z[key], -0.05, 0.08, 1)
    _flat(bm, Z["箱变"], -0.05, 0.15, 2, top_mat=3)
    u, v = data["signs"][0]
    _flat(bm, [(u + 3.6 * math.cos(a), v + 3.6 * math.sin(a)) for a in (i * math.pi / 12 for i in range(24))], -0.05, 0.15, 2, top_mat=3)
    lib.uv_box(bm, 6.0)
    lib.new_object("site_paving", bm, [M["asphalt"], M["concrete"], M["curb"], M["grass"]], col)


# ---------------------------------------------------------------- 标线


def _seg_strip(bm, a, b, w, z=0.045, mat=0):
    """两点（Blender xy）间的细长矩形标线"""
    a, b = Vector((*a, z)), Vector((*b, z))
    d = b - a
    L = d.length
    if L < 1e-3:
        return
    ang = math.atan2(d.y, d.x)
    c = (a + b) / 2
    lib.add_box(bm, (L, w, 0.01), (c.x, c.y, z), mat=mat, rot_z=ang)


def _outline(bm, uv_poly, w, mat=0, open_side=None, z=0.045):
    """多边形描边；open_side 为不画的边下标（车位入口一侧）"""
    pts = [W(u, v) for u, v in uv_poly]
    for i in range(len(pts)):
        if i == open_side:
            continue
        _seg_strip(bm, pts[i], pts[(i + 1) % len(pts)], w, mat=mat, z=z)


def _arrow(bm, pos, ang, size=1.0, mat=0):
    """地面导向箭头（扁平箭头形，沿 ang 方向），pos 为 Blender xy"""
    s = size
    shape = [(-1.4, -0.28), (0.3, -0.28), (0.3, -0.7), (1.4, 0.0), (0.3, 0.7), (0.3, 0.28), (-1.4, 0.28)]
    ca, sa = math.cos(ang), math.sin(ang)
    pts = [(pos[0] + (x * ca - y * sa) * s, pos[1] + (x * sa + y * ca) * s) for x, y in shape]
    lib.add_prism(bm, pts, 0.05, 0.068, mat=mat)


# 导向箭头：(u, v, 行驶方向 du, dv)
ARROWS = (
    (30, 3, 1, 1.2), (52, 31.5, 1, 0), (90, 31.5, 1, 0), (78, 13, 1, 0), (78, 20.8, 1, 0),
    (136, 16, 0, -1), (150, 2, 1, 1.4), (162, 12.5, 1, 0), (162, 20, 1, 0), (162, 27.5, 1, 0),
    (209, 20, 0, -1), (214, 0.5, 1, -0.4), (160, 41.5, 1, 0),
)


def build_markings(M, col, data):
    """车位线、超充位描边（每位一个对象）、导向箭头"""
    bm = bmesh.new()
    for r in data["staff_bays"]:
        _outline(bm, r, 0.12, open_side=0, z=0.065)  # 入口在 v 小的一侧（通道）
    for r in data["car_bays"]:
        _outline(bm, r, 0.12, open_side=2, z=0.065)  # 入口在 v 大的一侧（通道）
    lib.new_object("parking_lines", bm, [M["paint"]], col)

    # 超充位：每位内缩 0.25 m 描边，相邻车位不共线（各自变色时不会 z 冲突）
    for i, r in enumerate(data["truck_bays"]):
        (u0, v0), (u1, v1) = r[0], r[2]
        bm = bmesh.new()
        _outline(bm, rect(u0 + 0.25, u1 - 0.25, v0 + 0.25, v1 - 0.25), 0.2, z=0.05)
        lib.new_object(f"bay_{PILE_IDS[i]}", bm, [M["status_charging"]], col)

    bm = bmesh.new()
    for u, v, du, dv in ARROWS:
        _arrow(bm, W(u, v), math.atan2(dv, -du), 0.9)
    lib.new_object("lane_arrows", bm, [M["lane"]], col)


# ---------------------------------------------------------------- 功能区设施


def build_facilities(M, col, data):
    Z = data["zones"]
    anchors = {}
    disp = {k: assets.dispenser(M, k) for k in ("fuel", "cng", "lng")}

    # 加油加气站：罩棚 38 × 20（净高 5.4）、两排各 3 岛（每岛 2 台机），后排东侧两岛为 CNG；檐口青色灯带（设计稿）
    (cx, cy), (L, Wd) = bounds(Z["加油加气站"])
    isl = [bounds(r)[0] for r in data["fuel_islands"]]
    can = assets.flat_canopy(M, "canopy_fuel", L, Wd, 5.4, [(x - cx, y - cy) for x, y in isl], M["led_canopy"])
    for k, me in can.items():
        lib.place(me, f"canopy_fuel_{k}", col, (cx, cy, 0))
    isl_me = assets.island(M, 8.0, 1.6, "island_fuel")
    back_y = max(y for _, y in isl)
    n = 0
    for x, y in isl:
        lib.place(isl_me, f"island_F{n // 2 + 1:02d}", col, (x, y, 0.04))
        kind = "cng" if (y == back_y and 110 - x < 190) else "fuel"
        for dx in (-2.4, 2.4):
            n += 1
            lib.place(disp[kind], f"dispenser_F{n:02d}", col, (x + dx, y, 0.26))
    anchors["fuel"] = (cx, cy, 9.0)

    # CNG：压缩机撬 + 白色卧式储气罐，围栏隔离
    (cx, cy), (L, Wd) = bounds(Z["CNG储气"])
    lib.place(assets.cng_skid(M), "cng_skid", col, (cx + 3.5, cy + 1.5, 0.08))
    lib.place(assets.h_tank(M, 1.5, 8.0), "cng_tank", col, (cx - 4.5, cy - 1.8, 0.08))
    hx, hy = L / 2 - 0.2, Wd / 2 - 0.2
    lib.place(assets.fence(M, [(-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)], "fence_cng", h=2.0), "fence_cng", col, (cx, cy, 0.08))
    anchors["cng"] = (cx, cy, 5.0)

    # 换电站：14 × 8 白色箱体，沿路方向贯通（车从东口驶入、西口驶出）
    (cx, cy), (L, Wd) = bounds(Z["换电站"])
    for k, me in assets.swap_station(M, 14.0, 8.0, 5.5).items():
        lib.place(me, f"swap_station_{k}", col, (cx, cy, 0.08))
    anchors["swap"] = (cx, cy, 8.0)

    # 办公楼：3F 玻璃幕墙，16 × 10
    (cx, cy), (L, Wd) = bounds(Z["办公楼"])
    for k, me in assets.office(M, L, Wd).items():
        lib.place(me, f"office_{k}", col, (cx, cy, 0.0))
    anchors["office"] = (cx, cy, 11.0)

    # LNG 加气站：罩棚 40 × 14（净高 6），一排 2 岛各 2 台 LNG 加气机，岛两侧各一条重卡车道；檐口紫色灯带
    (cx, cy), (L, Wd) = bounds(Z["加气站"])
    isl = [bounds(r)[0] for r in data["lng_islands"]]
    cols = [(x - cx + dx, y - cy) for x, y in isl for dx in (-4.5, 4.5)]
    for k, me in assets.flat_canopy(M, "canopy_lng", L, Wd, 6.0, cols, M["led_lng"], pv=False).items():
        lib.place(me, f"canopy_lng_{k}", col, (cx, cy, 0))
    isl_me = assets.island(M, 11.0, 1.6, "island_lng")
    n = 0
    for i, (x, y) in enumerate(isl):
        lib.place(isl_me, f"island_L{i + 1:02d}", col, (x, y, 0.04))
        for dx in (-1.8, 1.8):
            n += 1
            lib.place(disp["lng"], f"dispenser_L{n:02d}", col, (x + dx, y, 0.26))
    anchors["lng"] = (cx, cy, 9.5)

    # LNG 储罐区：卧罐 + 泵撬 + 气化器，钢丝网围栏，四角紫色灯柱（设计稿里罐区泛紫光）
    (cx, cy), (L, Wd) = bounds(Z["LNG储罐区"])
    lib.place(assets.lng_tank(M), "lng_tank", col, (cx, cy, 0.08))
    hx, hy = L / 2 - 0.3, Wd / 2 - 0.3
    ring = [(-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)]
    lib.place(assets.fence(M, ring, "fence_lng", h=2.4), "fence_lng", col, (cx, cy, 0.08))
    post = assets.light_post(M, M["led_lng"])
    for i, (x, y) in enumerate(ring):
        lib.place(post, f"tank_light_{i}", col, (cx + x * 0.97, cy + y * 0.94, 0.08))
    anchors["tank"] = (cx, cy, 7.5)

    # 箱变 ×2：深灰箱体立在绿岛上（设计稿）
    (cx, cy), _ = bounds(Z["箱变"])
    tr = assets.transformer(M)
    for i, dx in enumerate((3.5, -3.5)):
        ob = lib.place(tr, f"transformer_{i + 1:02d}", col, (cx + dx, cy - 0.5, 0.15))
        ob.scale = (1.35, 1.5, 1.4)
    anchors["power"] = (cx, cy, 6.0)

    # 重卡超充：光伏车棚（只盖车位后半段 v 45 ~ 60，重卡倒车入位、车头朝通道露在棚外）+ 10 台液冷超充终端（立在车位前沿）
    u0, u1, v0, v1 = 69.0, 135.0, 45.0, 60.0
    (cx, cy) = W((u0 + u1) / 2, (v0 + v1) / 2)
    cols_u = [70.0 + 12.8 * k for k in range(6)]
    cp = assets.truck_carport(M, "carport", u1 - u0, v1 - v0, 6.4, [W(u, 0)[0] - cx for u in cols_u])
    for k, me in cp.items():
        lib.place(me, f"carport_{k}", col, (cx, cy, 0))
    pile = assets.super_pile(M)
    for i, r in enumerate(data["chargers"]):
        (pu, pv), _ = bounds(r)
        pid = PILE_IDS[i]
        root = lib.empty(f"pile_{pid}", col, (pu, pv, 0.03), 0.0)  # 屏幕（局部 -y）朝通道
        for k, me in pile.items():
            lib.place(me, f"pile_{pid}_{k}", col, parent=root)
    anchors["charge"] = (cx, cy, 9.0)

    # 价格立柱（西端绿岛上）
    u, v = data["signs"][0]
    x, y = W(u, v)
    lib.place(assets.pylon(M), "totem_01", col, (x, y, 0.15), 0.0)

    for key, loc in anchors.items():
        lib.empty(f"anchor_{key}", col, loc)
    return anchors


# ---------------------------------------------------------------- 绿化与配套


def _occupied(data):
    """不能种树的区域（Blender xy 多边形）：道路、铺装、设施、车位、车棚"""
    polys = data["roads"] + data["forecourt"] + data["paving"] + list(data["zones"].values())
    polys += [rect(68, 136.5, 39, 61), rect(82, 130, 4, 24)]
    u, v = data["signs"][0]
    polys.append(rect(u - 4, u + 4, v - 4, v + 4))
    return [xy(p) for p in polys]


def forest_prefabs(M):
    """山林低模：针叶为主、阔叶为辅。只建一次——make_mesh 重名时会删掉旧网格，连带删掉已经摆好的树"""
    return [assets.conifer(M, k, lo=True) for k in range(3)] * 2 + [assets.tree(M, k, lo=True) for k in range(2)]


def build_green(M, col, data, plat, hwy, forest):
    """场内树林（后排针叶林为主、前排行道树）、两侧绿化带灌木与路灯、站内路灯"""
    rng = random.Random(42)
    trees = [assets.tree(M, k) for k in range(3)]
    trees_lit = [assets.tree(M, k, lit=True) for k in range(3)]
    bush = assets.bush(M)

    occupied = _occupied(data)
    green = xy(band(plat, 1.5, 1e3))
    xs = [p[0] for p in green]
    ys = [p[1] for p in green]
    placed = []
    k = 0
    for _ in range(20000):
        p = (rng.uniform(min(xs), max(xs)), rng.uniform(min(ys), max(ys)))
        if not inside(p, green):
            continue
        near = [(p[0] + dx, p[1] + dy) for dx in (-2.2, 0, 2.2) for dy in (-2.2, 0, 2.2)]
        if any(inside(q, r) for r in occupied for q in near):
            continue
        v = p[1] + 40.0
        gap = 2.9 if v > 46 else 4.4  # 后排树林密、前排稀
        if any((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 < gap * gap for q in placed):
            continue
        placed.append(p)
        if v > 46:
            ob = lib.place(forest[rng.randrange(len(forest))], f"forest_{k:03d}", col, (p[0], p[1], 0.0), rng.random() * 6.28)
            sc = 0.95 + rng.random() * 0.6
            ob.scale = (sc, sc, sc * (0.9 + rng.random() * 0.4))
        else:
            # 前排每三棵里一棵带树下投光（叶子用暖黄自发光材质，烘焙时在树下放点光源）
            lit = k % 3 == 0
            ob = lib.place((trees_lit if lit else trees)[rng.randrange(3)], f"tree_{k:03d}", col, (p[0], p[1], 0.0), rng.random() * 6.28)
            sc = 0.85 + rng.random() * 0.5
            ob.scale = (sc, sc, sc)
            if lit:
                UPLIGHTS.append((p[0] + 0.9, p[1] - 0.6))
        k += 1
        if k >= 900:
            break

    # 两侧绿化带：一排灌木；场地侧绿化带每 30 m 一盏路灯（灯臂伸向国道），前侧绿化带同样
    lamp = assets.street_light(M)

    # 灯头在立杆 +x 方向 1.2 m、高 6.81 m（随摆放角度旋转），记进 LAMPS 供烘焙放光源
    def lamp_at(name, x, y, z, rz):
        lib.place(lamp, name, col, (x, y, z), rz)
        LAMPS.append(((x + 1.2 * math.cos(rz), y + 1.2 * math.sin(rz), z + 6.78),))

    k = 0
    for seg in verge_segments(plat, hwy["edge"], 0.0):
        a, b = span_at(seg, -2.0)
        u = a + 1.5
        while u < b - 1.0:
            x, y = W(u, -2.0)
            lib.place(bush, f"hedge_{k:03d}", col, (x, y, 0.12), rng.random() * 6.28)
            k += 1
            u += 2.8
        u = a + 6
        while u < b - 4:
            x, y = W(u, -1.4)
            lamp_at(f"lamp_verge_{k:03d}", x, y, 0.12, -math.pi / 2)
            k += 1
            u += 30.0
    fv = hwy["front"] - 2.0
    a, b = span_at(plat, fv)
    u = a + 4
    while u < b - 4:
        x, y = W(u, fv)
        lib.place(bush, f"hedge_{k:03d}", col, (x, y, 0.12), rng.random() * 6.28)
        k += 1
        u += 3.4
    u = a + 10
    while u < b - 8:
        x, y = W(u, hwy["front"] - 1.4)
        lamp_at(f"lamp_front_{k:03d}", x, y, 0.12, math.pi / 2)
        k += 1
        u += 32.0

    # 站内路灯：(u, v, 灯臂朝向 rz)
    site_lamps = (
        (46, 38.5, -math.pi / 2), (140, 38.5, -math.pi / 2), (75, 2.0, math.pi / 2), (128, 2.0, math.pi / 2),
        (160, 1.2, math.pi / 2), (204, 1.2, math.pi / 2), (237, 22, 0.0), (206, 36.5, -math.pi / 2),
        (154, 47.5, -math.pi / 2), (45, 12, math.pi), (70, 22.5, math.pi / 2),
        # 设计稿里 LNG 罩棚东北角、车位前通道都有成片的暖色光斑（对照实测补的几盏）
        (80, 24.6, math.pi / 2), (96, 24.6, math.pi / 2), (114, 24.6, math.pi / 2), (132, 38.4, -math.pi / 2),
        # 停车场通道两盏（设计稿里停车场被路灯照成暖灰色）
        (218, 23.2, math.pi / 2), (230, 23.2, -math.pi / 2),
    )
    for u, v, rz in site_lamps:
        x, y = W(u, v)
        lamp_at(f"lamp_site_{k:03d}", x, y, 0.03, rz)
        k += 1


def build_backdrop(M, col, plat, forest):
    """
    远山：沙盘后方起伏的山坡（网格地形，离沙盘后沿越远越高）、山林、几块岩石和山坡上的村庄灯火。
    沙盘轮廓以内的部分压到地面以下（被场地草地盖住）；不参与地面烘焙，three.js 里靠月光和雾隐入夜色
    """
    rng = random.Random(7)
    u_min, u_max = min(p[0] for p in plat), max(p[0] for p in plat)
    U0, U1, V0, V1 = u_min - 110, u_max + 70, 20.0, 210.0
    nu, nv = 96, 48

    def edge_v(u):
        """山脚线：沙盘范围内取后沿，范围外向后退（两端外侧露得少）"""
        b = back_v(plat, min(max(u, u_min + 0.5), u_max - 0.5))
        out = max(u_min - u, u - u_max, 0.0)
        return b + out * 0.9

    def height(u, v):
        d = v - edge_v(u)
        if d < 0:
            return -4.0
        k = min(1.0, d / 110.0)
        s = k * k * (3 - 2 * k)
        ripple = math.sin(u * 0.045 + 1.3) * math.cos(v * 0.06) * 3.5 + math.sin(u * 0.11) * 1.2
        return -4.0 + 26.0 * s + ripple * s

    bm = bmesh.new()
    grid = []
    for j in range(nv + 1):
        row = []
        for i in range(nu + 1):
            u = U0 + (U1 - U0) * i / nu
            v = V0 + (V1 - V0) * j / nv
            row.append(bm.verts.new((*W(u, v), height(u, v))))
        grid.append(row)
    for j in range(nv):
        for i in range(nu):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    lib.new_object("backdrop", bm, [M["grass_dark"]], col)

    # 山林：只种在露出地面（z > -1）的坡上
    k = 0
    for _ in range(4000):
        u, v = rng.uniform(U0 + 10, U1 - 10), rng.uniform(V0, V1 - 20)
        z = height(u, v)
        if z < -1.0:
            continue
        x, y = W(u, v)
        ob = lib.place(forest[rng.randrange(len(forest))], f"forest_bg_{k:03d}", col, (x, y, z - 0.2), rng.random() * 6.28)
        sc = 1.0 + rng.random() * 0.7
        ob.scale = (sc, sc, sc)
        k += 1
        if k >= 700:
            break

    # 车棚后方的岩石（设计稿里树林间露出一片山石）
    rock = assets.rock(M)
    for i in range(7):
        u, v = 92 + i * 6 + rng.uniform(-2, 2), 63 + rng.uniform(0, 6)
        x, y = W(u, v)
        ob = lib.place(rock, f"rock_{i:02d}", col, (x, y, -0.4), rng.random() * 6.28)
        s = 1.6 + rng.random() * 1.6
        ob.scale = (s, s * 0.8, s * (0.7 + rng.random() * 0.5))

    # 村庄：设计稿右上方山坡上的一片民居，窗户透暖光
    houses = [assets.house(M, kk) for kk in range(3)]
    k = 0
    for _ in range(400):
        u, v = rng.uniform(-95, 40), rng.uniform(105, 175)
        z = height(u, v)
        if z < 4:
            continue
        x, y = W(u, v)
        lib.place(houses[rng.randrange(3)], f"house_{k:02d}", col, (x, y, z - 0.3), rng.choice((0.0, math.pi / 2)) + rng.uniform(-0.2, 0.2))
        k += 1
        if k >= 30:
            break


# ---------------------------------------------------------------- 入口


# 合并顺序 = 由下到上：Lightmap 是从正上方的平面投影，上下重叠的面共用同一块像素，Cycles 按面的顺序写入，
# 后烘焙的覆盖先烘焙的，所以被压在下面的图层必须排在前面
GROUND_PARTS = ("site_grass", "road", "road_lines", "road_dashes", "site_roads", "site_paving", "parking_lines")
OUTLINE_JSON = os.path.join(os.path.dirname(__file__), "..", "..", "..", "src", "views", "energy", "data", "outline.json")


def join_ground(col, plat):
    """
    把所有贴地图层合并成一个 ground 对象，加第二套 UV「Lightmap」：按沙盘外轮廓的包围盒从正上方平铺 0..1，
    供 Cycles 把光照烘进一张地面贴图（bake.py）；three.js 里地面用这张图做自发光材质（UV channel 1）。
    返回 Lightmap 覆盖的范围 (x0, y0, x1, y1)
    """
    pxy = xy(plat)
    xs = [p[0] for p in pxy]
    ys = [p[1] for p in pxy]
    x0, x1, y0, y1 = min(xs) - 1, max(xs) + 1, min(ys) - 1, max(ys) + 1
    bm = bmesh.new()
    mats = []
    for name in GROUND_PARTS:
        ob = bpy.data.objects[name]
        tmp = bmesh.new()
        tmp.from_mesh(ob.data)
        bmesh.ops.transform(tmp, matrix=ob.matrix_world, verts=tmp.verts)
        remap = []
        for m in ob.data.materials:
            if m not in mats:
                mats.append(m)
            remap.append(mats.index(m))
        for f in tmp.faces:
            f.material_index = remap[f.material_index]
        # 只留朝上的面：棱柱的底面、侧面在平面投影的 Lightmap 里会和顶面抢同一块像素（被遮挡而烘成黑色）
        drop = [f for f in tmp.faces if f.normal.z < 0.3]
        bmesh.ops.delete(tmp, geom=drop, context="FACES")
        lib._merge(bm, tmp)
        bpy.data.objects.remove(ob, do_unlink=True)
    lm = bm.loops.layers.uv.new("Lightmap")
    for f in bm.faces:
        for l in f.loops:
            l[lm].uv = ((l.vert.co.x - x0) / (x1 - x0), (l.vert.co.y - y0) / (y1 - y0))
    ob = lib.new_object("ground", bm, mats, col)
    ob.data.uv_layers[0].active_render = True
    return (x0, y0, x1, y1)


def export_outline(plat, bake_box):
    """
    写 src/views/energy/data/outline.json（生成文件，勿手改；用 JSON 是为了不进 ESLint / prettier 的检查）：
    outline 沙盘外轮廓（three 坐标 [x, 顶面高, z]）、ledVMax 顶边灯带范围、lanes 门前国道各车道被沙盘截断后的 u 范围、
    bakeBox 地面烘焙贴图覆盖的 Blender xy 范围
    """
    pts = [[round(W(u, v)[0], 2), 0, round(-W(u, v)[1], 2)] for u, v in plat[::2]]
    lanes = {}
    for k, v in LANES_V.items():
        a, b = span_at(plat, v)
        lanes[k] = [round(a + 2, 1), round(b - 2, 1)]
    data = {
        "_note": "由 scripts/blender/energy/layout.py 生成，不要手改。outline: 沙盘外轮廓 [x, 顶面高, z]（three 坐标）；lanes: 门前国道各车道的 [v, u 起, u 止]（规划坐标，车辆在两端出现 / 消失）；bakeBox: 地面烘焙覆盖的 Blender xy 范围 [x0, y0, x1, y1]",
        "outline": pts,
        "ledVMax": LED_V_MAX,
        "lanes": {k: [LANES_V[k], *lanes[k]] for k in LANES_V},
        "bakeBox": [round(c, 2) for c in bake_box],
    }
    with open(OUTLINE_JSON, "w") as f:
        json.dump(data, f, ensure_ascii=False)


def build(M):
    """完整搭建场站，返回锚点等信息"""
    with open(SITE_JSON) as f:
        data = json.load(f)
    LAMPS.clear()
    UPLIGHTS.clear()
    col = lib.collection("STATION")
    plat = platform_outline(data)
    hwy = data["highway"]
    build_ground(M, col, plat, hwy)
    build_site_roads(M, col, data)
    build_markings(M, col, data)
    anchors = build_facilities(M, col, data)
    forest = forest_prefabs(M)
    build_green(M, col, data, plat, hwy, forest)
    build_backdrop(M, col, plat, forest)
    bake_box = join_ground(col, plat)
    export_outline(plat, bake_box)
    us = [p[0] for p in plat]
    return {"anchors": anchors, "u_range": (min(us), max(us)), "objects": len(col.objects)}

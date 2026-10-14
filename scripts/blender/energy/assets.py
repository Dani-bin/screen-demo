"""
综合能源补给站建模 · 设备预制件
----------------------------------------------------------
每个函数生成一份（或几份）网格数据，场景里用 lib.place() 共享引用摆放，导出 glTF 时只存一份几何。
预制件的局部坐标：底面中心在原点，z 向上；朝向在各函数注释里说明。

超充桩、箱变、配电柜、路灯、隔离桩、树、灌木、价格立柱沿用 charging/assets.py 的造型（复制在文件末尾）；
其余为本站新建：加油 / 加气机、加油岛、平顶罩棚、换电站、办公楼、油罐区、CNG 储气、LNG 储罐、
重卡光伏车棚、配电房、围栏。
会被代码驱动的部件拆成独立网格（*_status 状态灯、*_led 灯带），three.js 按对象名 / 材质名调色。
"""

import math
import random

import bmesh
from mathutils import Matrix, Vector

from . import lib


def _side_band(bm, L, W, z0, z1, mat, repeat=20.0, front_mat=None):
    """
    长方体的四个侧面（不含顶底），带沿周长展开的 UV：u = 周长距离 / repeat，v 为 0..1。
    用于办公楼窗带这类横向重复的贴图。front_mat 不为 None 时 -y 立面单独用该材质（便利店橱窗）
    """
    tmp = bmesh.new()
    uv = tmp.loops.layers.uv.verify()
    hx, hy = L / 2, W / 2
    corners = [(-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)]
    dist = 0.0
    for i in range(4):
        (x0, y0), (x1, y1) = corners[i], corners[(i + 1) % 4]
        seg = math.hypot(x1 - x0, y1 - y0)
        vs = [tmp.verts.new(p) for p in ((x0, y0, z0), (x1, y1, z0), (x1, y1, z1), (x0, y0, z1))]
        f = tmp.faces.new(vs)
        f.material_index = front_mat if (front_mat is not None and i == 0) else mat
        u0, u1 = dist / repeat, (dist + seg) / repeat
        if front_mat is not None and i == 0:
            u0, u1 = 0.0, 1.0  # 橱窗贴图整面铺一次
        for l, (u, v) in zip(f.loops, ((u0, 0), (u1, 0), (u1, 1), (u0, 1))):
            l[uv].uv = (u, v)
        dist += seg
    return lib._merge(bm, tmp)


def _verts(faces):
    return list({v for f in faces for v in f.verts})


# ---------------------------------------------------------------- 加油加气


def dispenser(M, kind="fuel"):
    """
    加油 / 加气机：立在加油岛上，机身长边沿 x（与岛同向），两面（±y）各一块屏幕，两端挂枪。
    kind：fuel 汽柴油（橙色灯带）/ cng（蓝色）/ lng（紫色，机身更大，带粗的低温软管）
    """
    big = kind == "lng"
    L, D, H = (1.1, 0.8, 2.6) if big else (1.3, 0.55, 2.35)
    led = {"fuel": M["led_fuel"], "cng": M["led_blue"], "lng": M["led_lng"]}[kind]
    scr = M["screen_lng"] if big else M["screen_fuel"]
    bm = bmesh.new()
    lib.add_box(bm, (L + 0.1, D + 0.1, 0.12), (0, 0, 0.06), mat=1)  # 底座
    lib.add_box(bm, (L, D, H - 0.5), (0, 0, 0.12 + (H - 0.5) / 2), bevel=0.04, segments=3, mat=0)  # 机身
    lib.add_box(bm, (L + 0.06, D + 0.06, 0.36), (0, 0, H - 0.2), bevel=0.03, mat=1)  # 顶部广告位
    lib.add_box(bm, (L + 0.08, D + 0.08, 0.05), (0, 0, H - 0.4), mat=3)  # 顶部灯带
    for s in (-1, 1):
        lib.add_plane(bm, (L * 0.56, 0.5), (0, s * (D / 2 + 0.004), 1.55), rot=lib.FACE_N if s > 0 else lib.FACE_S, mat=2)
        lib.add_box(bm, (0.12, D * 0.7, 0.42), (s * (L / 2 + 0.06), 0, 1.15), bevel=0.02, mat=1)  # 枪座
        r = 0.05 if big else 0.025
        pts = [(s * (L / 2 + 0.08), 0.05, 1.05), (s * (L / 2 + 0.3), 0.12, 0.6), (s * (L / 2 + 0.24), 0.05, 0.25), (s * (L / 2 + 0.06), -0.04, 0.55)]
        lib.add_tube(bm, pts, r, mat=4 if big else 1)
    mats = [M["white"], M["graphite"], scr, led, M["stainless"]]
    return lib.make_mesh(f"dispenser_{kind}", bm, mats, smooth_angle=35)


def island(M, length, width, name):
    """加油岛：混凝土岛台 + 不锈钢包边 + 两端黄黑防撞墩与隔离桩，长边沿 x"""
    bm = bmesh.new()
    lib.add_box(bm, (length, width, 0.22), (0, 0, 0.11), bevel=0.06, mat=0)
    lib.add_box(bm, (length + 0.04, width + 0.04, 0.05), (0, 0, 0.2), mat=1)
    for s in (-1, 1):
        lib.add_box(bm, (0.5, width, 0.5), (s * (length / 2 - 0.25), 0, 0.36), bevel=0.08, mat=2)  # 端头防撞墩
        for y in (-width / 2 + 0.15, width / 2 - 0.15):
            lib.add_cyl(bm, 0.08, 0.9, (s * (length / 2 + 0.25), y, 0.45), seg=10, mat=2)
    return lib.make_mesh(name, bm, [M["concrete"], M["stainless"], M["hazard"]], smooth_angle=35)


def flat_canopy(M, name, L, W, H, cols, led, pv=True):
    """
    平顶罩棚（加油站 / LNG 站）：沿 x 长 L、沿 y 宽 W，净高 H，中心在原点。
    厚檐口（1.3 m）+ 银色铝板封边 + 檐口上下两道彩色灯带 + 吊顶冷白灯盘，顶面铺光伏。
    cols：立柱位置 [(x, y)]（立在加油岛上）。
    返回 {"frame", "led", "light", "pv"}
    """
    T = 1.3
    bm = bmesh.new()
    for x, y in cols:
        lib.add_box(bm, (0.7, 0.7, H), (x, y, H / 2), bevel=0.05, mat=0)  # 立柱（银色包覆）
        lib.add_box(bm, (0.9, 0.9, 0.3), (x, y, 0.15), mat=2)
    lib.add_box(bm, (L, W, T), (0, 0, H + T / 2), bevel=0.08, segments=3, mat=0)  # 屋盖（侧面即檐口）
    lib.add_box(bm, (L - 0.6, W - 0.6, 0.05), (0, 0, H - 0.02), mat=1)  # 吊顶
    lib.add_box(bm, (L - 0.4, W - 0.4, 0.06), (0, 0, H + T + 0.02), mat=3)  # 屋面（浅灰，设计稿里罩棚顶是浅色）
    frame = lib.make_mesh(name + "_frame", bm, [M["fascia"], M["canopy_under"], M["concrete"], M["canopy_roof"]], smooth_angle=30)

    # 檐口灯带：下沿一道宽 0.32 m 的主灯带（设计稿里最醒目的彩色光边）+ 上沿一道细线，均略凸出檐口
    bm = bmesh.new()
    for z, t in ((H + 0.24, 0.32), (H + T - 0.08, 0.06)):
        for s in (-1, 1):
            lib.add_box(bm, (L + 0.08, 0.06, t), (0, s * (W / 2 + 0.02), z))
            lib.add_box(bm, (0.06, W + 0.08, t), (s * (L / 2 + 0.02), 0, z))
    led_me = lib.make_mesh(name + "_led", bm, [led])

    # 棚底：整片发光灯面（四周留 0.8 m 吊顶边），加一圈网格分隔，远看是一整块亮白的棚底
    bm = bmesh.new()
    lib.add_box(bm, (L - 1.6, W - 1.6, 0.03), (0, 0, H - 0.05))
    light = lib.make_mesh(name + "_light", bm, [M["light_cool"]])

    out = {"frame": frame, "led": led_me, "light": light}
    if pv:
        # 光伏：1.13 × 2.27 m 横排，向南（-y）倾 8°，几乎铺满屋面（设计稿里只在四周留一圈约 1.2 m 的白边）
        bm = bmesh.new()
        pw, ph, gap = 2.27, 1.13, 0.03
        margin = 1.2
        rows = int((W - 2 * margin) // (ph + 0.12))
        n = int((L - 2 * margin) // (pw + gap))
        x0 = -(n * (pw + gap)) / 2 + pw / 2
        y_start = -(rows * (ph + 0.12) - 0.12) / 2 + ph / 2
        for j in range(rows):
            y = y_start + j * (ph + 0.12)
            for i in range(n):
                c = (x0 + i * (pw + gap), y, H + T + 0.28)
                faces = lib.add_plane(bm, (pw, ph), c)
                faces += lib.add_box(bm, (pw, ph, 0.04), (c[0], c[1], c[2] - 0.03), mat=1)
                bmesh.ops.rotate(bm, cent=c, matrix=Matrix.Rotation(math.radians(-8), 3, "X"), verts=_verts(faces))
        pv_me = lib.make_mesh(name + "_pv", bm, [M["pv"], M["steel_dark"]])
        _panel_shade(pv_me, name)
        out["pv"] = pv_me
    return out


def tank_pad(M, L, W):
    """埋地油罐区地面：混凝土罐池顶板 + 4 个人孔盖 + 卸油口 + 一组通气管（黄色）"""
    bm = bmesh.new()
    lib.add_box(bm, (L, W, 0.15), (0, 0, 0.075), mat=0)
    for i in range(4):
        x = -L / 2 + (i + 0.5) * L / 4
        lib.add_cyl(bm, 0.55, 0.06, (x, 0.6, 0.18), seg=20, mat=1)
        lib.add_cyl(bm, 0.25, 0.12, (x, -1.6, 0.2), seg=12, mat=2)  # 卸油口
    for i in range(4):  # 通气管
        x = L / 2 - 1.0 - i * 0.5
        lib.add_cyl(bm, 0.06, 4.5, (x, W / 2 - 0.5, 2.3), seg=8, mat=2)
        lib.add_cyl(bm, 0.12, 0.25, (x, W / 2 - 0.5, 4.6), seg=8, mat=1)
    for sx in (-1, 1):
        for sy in (-1, 1):
            lib.add_cyl(bm, 0.1, 0.9, (sx * (L / 2 - 0.2), sy * (W / 2 - 0.2), 0.6), seg=10, mat=2)
    return lib.make_mesh("tank_pad", bm, [M["concrete"], M["steel_dark"], M["pipe_yellow"]], smooth_angle=35)


def cng_skid(M):
    """CNG 子站设备：压缩机撬（集装箱式，百叶 + 运行灯）+ 3×4 卧式储气瓶组（钢架），长边沿 x，占地约 11 × 6"""
    bm = bmesh.new()
    lib.add_box(bm, (11.5, 6.5, 0.2), (0, 0, 0.1), mat=3)
    lib.add_box(bm, (5.5, 2.5, 2.6), (-2.6, -1.4, 1.5), bevel=0.04, mat=0)  # 压缩机撬
    for i in range(10):
        lib.add_box(bm, (0.05, 0.02, 1.4), (-4.8 + i * 0.45, -2.66, 1.5), mat=1)
    lib.add_box(bm, (5.0, 0.03, 0.06), (-2.6, -2.67, 2.6), mat=4)
    # 储气瓶组：钢架 + 卧式气瓶
    lib.add_box(bm, (5.4, 2.4, 0.15), (2.8, 1.2, 0.3), mat=1)
    for k in (-1, 1):
        for x in (0.6, 5.0):
            lib.add_box(bm, (0.15, 2.4, 2.4), (x, 1.2 + 0 * k, 1.5), mat=1)
    for r in range(3):
        for c in range(4):
            lib.add_cyl(bm, 0.24, 5.0, (2.8, 0.3 + c * 0.6, 0.75 + r * 0.6), seg=14, mat=2, axis="X")
    lib.add_tube(bm, [(0.2, -1.4, 2.2), (0.6, -0.4, 2.7), (2.0, 0.2, 2.7)], 0.06, mat=5)
    return lib.make_mesh("cng_skid", bm, [M["white"], M["graphite"], M["steel"], M["concrete"], M["led_blue"], M["pipe_yellow"]], smooth_angle=35)


def lng_tank(M):
    """
    LNG 储罐区设备：60 m³ 卧式真空储罐（直径 3.6 m、长 14 m，沿 x）+ 两个混凝土鞍座 + 罐顶检修平台与爬梯，
    东侧潜液泵撬、两台空温式气化器（翅片立柱）与黄色工艺管线。占地约 16 × 10，底面中心在原点。
    """
    r, L, zc = 1.8, 12.0, 2.75
    bm = bmesh.new()
    lib.add_box(bm, (17, 11, 0.2), (0, 0, 0.1), mat=3)  # 设备基础
    lib.add_cyl(bm, r, L, (-1.5, 1.5, zc), seg=40, mat=0, axis="X")  # 罐体
    for s in (-1, 1):  # 椭圆封头
        lib.add_ico(bm, r, (-1.5 + s * L / 2, 1.5, zc), sub=3, mat=0, scale=(0.45, 1, 1))
    for x in (-5.5, 2.5):  # 鞍座
        lib.add_box(bm, (0.8, 3.0, 1.2), (x, 1.5, 0.8), mat=3)
    lib.add_box(bm, (3.0, 1.2, 0.1), (-1.5, 1.5, zc + r + 0.05), mat=1)  # 罐顶平台
    for x in (-3.0, 0.0):
        lib.add_box(bm, (0.05, 1.2, 1.0), (x, 1.5, zc + r + 0.55), mat=1)  # 栏杆
    for z in range(9):  # 爬梯
        lib.add_box(bm, (0.5, 0.04, 0.04), (-1.5, 1.5 - r - 0.3, 0.6 + z * 0.55), mat=1)
    for x in (-1.75, -1.25):
        lib.add_box(bm, (0.05, 0.05, 5.0), (x, 1.5 - r - 0.3, 2.6), mat=1)
    # 潜液泵撬
    lib.add_box(bm, (3.0, 2.4, 2.2), (5.6, -2.8, 1.3), bevel=0.04, mat=2)
    lib.add_box(bm, (2.6, 0.03, 0.06), (5.6, -4.02, 2.2), mat=4)
    # 空温式气化器：每台 4 根翅片立柱
    for k in range(2):
        for i in range(4):
            cx, cy = 4.4 + k * 2.4 + (i % 2) * 0.7, 2.2 + (i // 2) * 0.7
            lib.add_box(bm, (0.5, 0.5, 5.2), (cx, cy, 2.8), mat=0)
            for a in range(4):
                fin = lib.add_box(bm, (0.04, 0.7, 5.0), (cx, cy, 2.8), mat=0)
                bmesh.ops.rotate(bm, cent=(cx, cy, 2.8), matrix=Matrix.Rotation(a * math.pi / 4, 3, "Z"), verts=_verts(fin))
    # 工艺管线
    lib.add_tube(bm, [(-1.5, 1.5 - r + 0.2, 1.2), (-1.5, -2.8, 0.6), (4.0, -2.8, 0.6), (4.2, -2.8, 1.4)], 0.09, mat=5)
    lib.add_tube(bm, [(7.1, -2.8, 1.6), (7.6, -1.0, 1.6), (7.6, 2.0, 1.0)], 0.07, mat=5)
    return lib.make_mesh("lng_tank", bm, [M["stainless"], M["steel"], M["graphite"], M["concrete"], M["led_lng"], M["pipe_yellow"]], smooth_angle=35)


def dike(M, L, W, name):
    """LNG 储罐防火堤：0.3 厚、1.0 高的矮墙围合（沿 x 长 L、沿 y 宽 W），顶面黄黑警示"""
    bm = bmesh.new()
    t, h = 0.3, 1.0
    for s in (-1, 1):
        lib.add_box(bm, (L, t, h), (0, s * (W / 2 - t / 2), h / 2), mat=0)
        lib.add_box(bm, (t, W - 2 * t, h), (s * (L / 2 - t / 2), 0, h / 2), mat=0)
        lib.add_box(bm, (L, t + 0.02, 0.06), (0, s * (W / 2 - t / 2), h), mat=1)
        lib.add_box(bm, (t + 0.02, W, 0.06), (s * (L / 2 - t / 2), 0, h), mat=1)
    return lib.make_mesh(name, bm, [M["concrete"], M["hazard"]])


def fence(M, pts, name, h=2.0, closed=True, post=3.0):
    """钢丝网围栏：沿折线 pts（xy）每 post 米一根立柱，网片用半透明网格贴图（UV 按长度平铺）"""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.verify()
    seq = list(pts) + ([pts[0]] if closed else [])
    dist = 0.0
    for (x0, y0), (x1, y1) in zip(seq[:-1], seq[1:]):
        seg = math.hypot(x1 - x0, y1 - y0)
        if seg < 1e-3:
            continue
        vs = [bm.verts.new(p) for p in ((x0, y0, 0.1), (x1, y1, 0.1), (x1, y1, h), (x0, y0, h))]
        f = bm.faces.new(vs)
        f.material_index = 1
        for l, (u, v) in zip(f.loops, ((dist / 2, 0), ((dist + seg) / 2, 0), ((dist + seg) / 2, h / 2), (dist / 2, h / 2))):
            l[uv].uv = (u, v)
        n = max(1, int(seg // post))
        for k in range(n + 1):
            t = k / n
            lib.add_box(bm, (0.08, 0.08, h + 0.1), (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, (h + 0.1) / 2), mat=0)
        dist += seg
    return lib.make_mesh(name, bm, [M["steel_dark"], M["fence_mesh"]])


# ---------------------------------------------------------------- 建筑


def swap_station(M, L=16.0, W=11.0, H=6.2):
    """
    乘用车换电站：沿 x 长 L、宽 W、高 H，中间一条贯通的换电通道（沿 x 方向驶过）。
    通道内壁是发光灯条贴图，北侧机房开一排玻璃窗露出电池仓（发光贴图），檐口与通道口青色灯带。
    设计稿（v2）里是 14 × 8 的白色箱体，通道口朝路一侧亮青蓝色光。返回 {"body", "led"}
    """
    pw, ph = min(4.6, W * 0.52), min(4.4, H - 1.2)
    bm = bmesh.new()
    side = (W - pw) / 2
    for s in (-1, 1):
        cy = s * (pw / 2 + side / 2)
        lib.add_box(bm, (L, side, H), (0, cy, H / 2), bevel=0.06, mat=0)  # 两侧机房
    lib.add_box(bm, (L, pw, H - ph), (0, 0, ph + (H - ph) / 2), mat=0)  # 通道顶
    lib.add_box(bm, (L - 0.2, pw - 0.02, 0.05), (0, 0, ph - 0.02), mat=2)  # 通道吊顶（发光）
    for s in (-1, 1):
        lib.add_plane(bm, (L - 0.4, ph - 0.4), (0, s * (pw / 2 - 0.01), ph / 2), rot=lib.FACE_S if s > 0 else lib.FACE_N, mat=2)  # 通道内壁
    lib.add_box(bm, (L - 0.4, pw - 0.4, 0.04), (0, 0, 0.02), mat=1)  # 通道地面
    lib.add_box(bm, (3.0, 2.6, 0.06), (0, 0, 0.06), mat=4)  # 举升平台
    # 北侧（+y）机房玻璃窗 → 电池仓
    lib.add_plane(bm, (L - 3.0, min(2.6, H * 0.45)), (0.5, W / 2 + 0.01, H * 0.45), rot=lib.FACE_N, mat=3)
    # 屋顶空调机组
    for x in (-L / 4, L / 4):
        lib.add_box(bm, (2.0, 1.4, 0.8), (x, W / 4, H + 0.4), bevel=0.05, mat=1)
    body = lib.make_mesh("swap_station_body", bm, [M["white"], M["graphite"], M["swap_bay"], M["battery"], M["led_swap"]], smooth_angle=30)

    bm = bmesh.new()
    for s in (-1, 1):  # 通道口门框灯带
        x = s * (L / 2 + 0.02)
        lib.add_box(bm, (0.08, pw + 0.3, 0.12), (x, 0, ph + 0.06))
        for y in (-pw / 2 - 0.1, pw / 2 + 0.1):
            lib.add_box(bm, (0.08, 0.12, ph), (x, y, ph / 2))
    for s in (-1, 1):  # 檐口
        lib.add_box(bm, (L + 0.04, 0.05, 0.08), (0, s * (W / 2 + 0.02), H - 0.25))
    led = lib.make_mesh("swap_station_led", bm, [M["led_swap"]])
    return {"body": body, "led": led}


def office(M, L=40.0, W=16.0):
    """
    办公楼（3F，沿 x 长 L、宽 W，层高 3.2）：设计稿（v2）是通透的玻璃盒子——白色楼板外挑成水平线条，
    四角细柱，层间整片玻璃幕墙透出室内暖光（窗带贴图发光）；一层南立面（-y，朝停车场）为便利店橱窗；
    屋顶女儿墙、空调机组，女儿墙顶白色压边。返回 {"body", "window", "led"}
    """
    fh, n = 3.2, 3
    bm = bmesh.new()
    lib.add_box(bm, (L + 1.6, W + 1.6, 0.3), (0, 0, 0.15), mat=0)  # 室外台阶平台
    for i in range(n + 1):
        z = i * fh
        lib.add_box(bm, (L + 0.8, W + 0.8, 0.4), (0, 0, z + 0.3), mat=0)  # 楼板外挑
    lib.add_box(bm, (L + 0.8, W + 0.8, 0.9), (0, 0, n * fh + 0.9), mat=0)  # 女儿墙
    for sx in (-1, 1):  # 四角细柱
        for sy in (-1, 1):
            lib.add_box(bm, (0.5, 0.5, n * fh), (sx * (L / 2 - 0.25), sy * (W / 2 - 0.25), n * fh / 2 + 0.3), mat=0)
    for x in (-L / 4, L / 4):  # 屋顶空调机组
        lib.add_box(bm, (2.4, 1.6, 1.0), (x, W / 5, n * fh + 1.85), bevel=0.05, mat=1)
    lib.add_box(bm, (min(10.0, L * 0.6), 1.8, 0.22), (0, -W / 2 - 1.3, fh * 0.92), mat=0)  # 一层入口雨棚
    body = lib.make_mesh("office_body", bm, [M["wall"], M["graphite"]], smooth_angle=30)

    bm = bmesh.new()
    for i in range(n):
        z0, z1 = i * fh + 0.5, (i + 1) * fh + 0.1
        _side_band(bm, L - 0.6, W - 0.6, z0, z1, mat=0, repeat=12.0, front_mat=1 if i == 0 else None)
    win = lib.make_mesh("office_window", bm, [M["window"], M["store"]])

    bm = bmesh.new()
    hz = n * fh + 1.36
    for s in (-1, 1):
        lib.add_box(bm, (L + 0.9, 0.05, 0.06), (0, s * (W / 2 + 0.43), hz))
        lib.add_box(bm, (0.05, W + 0.9, 0.06), (s * (L / 2 + 0.43), 0, hz))
    led = lib.make_mesh("office_led", bm, [M["paint"]])  # 女儿墙顶白色压边（设计稿里没有彩色灯带）
    return {"body": body, "window": win, "led": led}


def power_room(M):
    """配电房：8 × 5 × 3.8 深灰小房，正面（-y）百叶 + 门 + 蓝色运行灯带，长边沿 x"""
    bm = bmesh.new()
    lib.add_box(bm, (8.4, 5.4, 0.3), (0, 0, 0.15), mat=2)
    lib.add_box(bm, (8.0, 5.0, 3.5), (0, 0, 0.3 + 1.75), bevel=0.04, mat=0)
    lib.add_box(bm, (8.4, 5.4, 0.2), (0, 0, 3.9), mat=1)
    lib.add_box(bm, (1.4, 0.04, 2.3), (-2.4, -2.52, 1.45), mat=1)  # 门
    for i in range(6):
        lib.add_box(bm, (2.4, 0.03, 0.06), (1.6, -2.52, 1.2 + i * 0.25), mat=1)  # 百叶
    lib.add_box(bm, (7.6, 0.04, 0.06), (0, -2.53, 3.6), mat=3)
    lib.add_plane(bm, (0.5, 0.5), (-0.6, -2.53, 2.0), rot=lib.FACE_S, mat=4)
    return lib.make_mesh("power_room", bm, [M["wall_dark"], M["graphite"], M["concrete"], M["led_blue"], M["warn"]], smooth_angle=30)


def truck_carport(M, name, L, W, H, cols_x, tilt_deg=5.0):
    """
    重卡超充位光伏车棚：悬挑式，立柱一排立在后沿（+y，车头 / 充电终端一侧），屋面向前（-y，通道侧）悬挑并略下倾，
    沿 x 长 L、沿 y 宽 W，后沿高 H（重卡净高要求 ≥ 5 m）。中心在原点。
    返回 {"frame", "pv", "led", "light"}
    """
    yb = W / 2 - 0.8  # 立柱所在的 y
    tilt = Matrix.Rotation(math.radians(tilt_deg), 3, "X")  # 绕 x 轴：-y 前沿下倾
    pivot = (0, yb, H)
    bm = bmesh.new()
    for x in cols_x:
        lib.add_box(bm, (1.0, 1.0, 0.35), (x, yb, 0.175), mat=2)
        lib.add_box(bm, (0.5, 0.5, H), (x, yb, H / 2), bevel=0.04, mat=0)
    roof = bmesh.new()
    for x in cols_x:
        lib.add_box(roof, (0.3, W, 0.5), (x, 0, H - 0.1), mat=0)  # 悬挑梁
    lib.add_box(roof, (L, 0.4, 0.5), (0, yb, H + 0.05), mat=0)  # 后沿主梁
    lib.add_box(roof, (L, W, 0.12), (0, 0, H + 0.25), mat=1)  # 屋面板
    for s in (-1, 1):
        lib.add_box(roof, (L + 0.1, 0.12, 0.4), (0, s * W / 2, H + 0.2), mat=1)
    bmesh.ops.rotate(roof, cent=pivot, matrix=tilt, verts=roof.verts)
    lib._merge(bm, roof)
    frame = lib.make_mesh(name + "_frame", bm, [M["steel"], M["roof"], M["concrete"]], smooth_angle=30)

    bm = bmesh.new()
    pw, ph, gap = 1.13, 2.27, 0.02
    nx, ny = int((L - 0.3) // (pw + gap)), int((W - 0.2) // (ph + gap))
    x0 = -(nx * (pw + gap)) / 2 + pw / 2
    y0 = -(ny * (ph + gap)) / 2 + ph / 2
    for i in range(nx):
        for j in range(ny):
            c = (x0 + i * (pw + gap), y0 + j * (ph + gap), H + 0.38)
            lib.add_plane(bm, (pw, ph), c)
            lib.add_box(bm, (pw, ph, 0.05), (c[0], c[1], c[2] - 0.04), mat=1)
    bmesh.ops.rotate(bm, cent=pivot, matrix=tilt, verts=bm.verts)
    pv = lib.make_mesh(name + "_pv", bm, [M["pv"], M["steel_dark"]])
    _panel_shade(pv, name)

    bm = bmesh.new()
    lib.add_box(bm, (L + 0.1, 0.05, 0.06), (0, -W / 2 - 0.07, H + 0.05))  # 前沿灯带
    bmesh.ops.rotate(bm, cent=pivot, matrix=tilt, verts=bm.verts)
    led = lib.make_mesh(name + "_led", bm, [M["led_green"]])

    bm = bmesh.new()
    for y in (-W * 0.3, W * 0.1):
        lib.add_box(bm, (L - 1.0, 0.18, 0.04), (0, y, H - 0.38))
    bmesh.ops.rotate(bm, cent=pivot, matrix=tilt, verts=bm.verts)
    light = lib.make_mesh(name + "_light", bm, [M["light_cool"]])
    return {"frame": frame, "pv": pv, "led": led, "light": light}


# ---------------------------------------------------------------- 沿用 charging 的预制件

def super_pile(M):
    """
    液冷超充终端（600 kW）：白色圆柱塔身 + 深色正面凹槽 + 顶部发光光环，屏幕朝 -y（南）。
    返回 {"body", "screen", "status"}。
    """
    bm = bmesh.new()
    lib.add_cyl(bm, 0.72, 0.14, (0, 0, 0.07), seg=32, mat=1)  # 底座
    lib.add_cyl(bm, 0.55, 3.1, (0, 0, 0.14 + 1.55), seg=32, mat=0)  # 塔身
    lib.add_cyl(bm, 0.6, 0.12, (0, 0, 3.3), seg=32, mat=1)  # 顶盖
    lib.add_box(bm, (0.56, 0.2, 2.2), (0, -0.47, 1.55), bevel=0.05, mat=1)  # 正面深色凹槽
    lib.add_box(bm, (0.16, 0.2, 0.34), (0.4, -0.5, 1.0), bevel=0.03, mat=2)  # 枪座
    pts = [(0.42, -0.58, 0.9), (0.62, -0.7, 0.45), (0.56, -0.78, 0.18), (0.36, -0.7, 0.35), (0.34, -0.6, 0.8)]
    lib.add_tube(bm, pts, 0.055, mat=3)  # 液冷粗线
    body = lib.make_mesh("pile_super_body", bm, [M["white"], M["graphite"], M["dark"], M["cable"]], smooth_angle=40)

    bm = bmesh.new()
    lib.add_plane(bm, (0.44, 0.62), (0, -0.576, 1.9), rot=lib.FACE_S)
    screen = lib.make_mesh("pile_super_screen", bm, [M["screen_super"]])

    bm = bmesh.new()
    lib.add_torus(bm, 0.66, 0.06, (0, 0, 3.6), seg=48, seg2=8)  # 悬浮光环
    lib.add_torus(bm, 0.565, 0.03, (0, 0, 3.0), seg=48, seg2=6)  # 塔身上部灯环
    lib.add_box(bm, (0.04, 0.04, 1.9), (-0.3, -0.58, 1.55))
    lib.add_box(bm, (0.04, 0.04, 1.9), (0.3, -0.58, 1.55))
    status = lib.make_mesh("pile_super_status", bm, [M["status_charging"]])
    return {"body": body, "screen": screen, "status": status}



def _panel_shade(me, seed):
    """
    每块光伏板一个随机明暗（顶点色 Col，0.6~1.0）：真实阵列里每块板的反光角度、批次色差都不同，
    设计稿上也是深浅不一的「拼块感」。顶点色在材质里与贴图相乘，导出为 glTF COLOR_0，
    three.js 的光伏反光着色器（scene/pvSheen.js）也用它调制反光强度。边框 / 背板保持 1.0
    """
    rng = random.Random(seed)
    attr = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    me.color_attributes.active_color = attr
    for poly in me.polygons:
        v = 1.0 if poly.material_index else 0.6 + 0.4 * rng.random()
        for li in poly.loop_indices:
            attr.data[li].color = (v, v, v, 1.0)



def transformer(M):
    """箱式变压器：3.6 × 2.4 × 2.6，散热片在东西两侧，正面朝 -y 贴高压警示牌"""
    bm = bmesh.new()
    lib.add_box(bm, (3.8, 2.6, 0.2), (0, 0, 0.1), mat=1)
    lib.add_box(bm, (3.6, 2.4, 2.4), (0, 0, 0.2 + 1.2), bevel=0.03, mat=0)
    lib.add_box(bm, (3.9, 2.7, 0.14), (0, 0, 2.67), mat=1)  # 顶盖
    for s in (-1, 1):
        for i in range(10):
            lib.add_box(bm, (0.32, 0.05, 1.7), (s * 1.95, -0.9 + i * 0.2, 1.2), mat=0)  # 散热片
    for i in range(12):
        lib.add_box(bm, (0.05, 0.02, 0.9), (-1.4 + i * 0.12, -1.21, 1.9), mat=1)  # 百叶
    lib.add_plane(bm, (0.5, 0.5), (1.1, -1.215, 1.7), rot=lib.FACE_S, mat=2)
    return lib.make_mesh("transformer", bm, [M["transformer"], M["steel_dark"], M["warn"]], smooth_angle=30)



def switchgear(M):
    """配电 / 逆变柜：1.0 × 0.8 × 2.2，正面朝 -y，带蓝色指示灯"""
    bm = bmesh.new()
    lib.add_box(bm, (1.0, 0.8, 2.2), (0, 0, 1.1), bevel=0.02, mat=0)
    lib.add_box(bm, (0.02, 0.02, 2.0), (0, -0.405, 1.1), mat=1)
    for i in range(3):
        lib.add_box(bm, (0.08, 0.02, 0.04), (-0.3 + i * 0.12, -0.41, 1.85), mat=2)
    return lib.make_mesh("switchgear", bm, [M["graphite"], M["dark"], M["led_blue"]], smooth_angle=30)



def street_light(M):
    """路灯：7 m 立杆 + 单臂灯头（灯头朝 +x）"""
    bm = bmesh.new()
    lib.add_cyl(bm, 0.18, 0.3, (0, 0, 0.15), seg=12, mat=0)
    lib.add_cyl(bm, 0.07, 7.0, (0, 0, 3.5), seg=10, mat=0, r2=0.05)
    lib.add_box(bm, (1.4, 0.1, 0.1), (0.65, 0, 6.95), mat=0)
    lib.add_box(bm, (0.7, 0.3, 0.12), (1.2, 0, 6.88), bevel=0.03, mat=0)
    lib.add_box(bm, (0.6, 0.22, 0.03), (1.2, 0, 6.81), mat=1)
    return lib.make_mesh("street_light", bm, [M["steel"], M["light_warm"]], smooth_angle=40)



def street_light_double(M):
    """中央隔离带双臂路灯：10 m 立杆，灯臂沿 ±y 伸向两侧车道"""
    bm = bmesh.new()
    lib.add_cyl(bm, 0.22, 0.4, (0, 0, 0.2), seg=12, mat=0)
    lib.add_cyl(bm, 0.09, 10.0, (0, 0, 5.0), seg=10, mat=0, r2=0.06)
    for s in (-1, 1):
        lib.add_box(bm, (0.1, 2.4, 0.1), (0, s * 1.15, 9.95), mat=0)
        lib.add_box(bm, (0.32, 0.8, 0.14), (0, s * 2.2, 9.88), bevel=0.03, mat=0)
        lib.add_box(bm, (0.24, 0.66, 0.03), (0, s * 2.2, 9.8), mat=1)
    return lib.make_mesh("street_light_double", bm, [M["steel"], M["light_warm"]], smooth_angle=40)


def bollard(M):
    """隔离桩：深色立柱 + 两道青色发光环"""
    bm = bmesh.new()
    lib.add_cyl(bm, 0.11, 0.95, (0, 0, 0.475), seg=14, mat=0)
    lib.add_cyl(bm, 0.115, 0.06, (0, 0, 0.7), seg=14, mat=1)
    lib.add_cyl(bm, 0.115, 0.04, (0, 0, 0.88), seg=14, mat=1)
    return lib.make_mesh("bollard", bm, [M["graphite"], M["led_cyan"]], smooth_angle=40)



def conifer(M, kind=0, lo=False):
    """
    针叶树（山林里与阔叶树混种，设计稿的山林以塔形针叶为主）：细树干 + 4~6 层逐层收小的扰动圆锥。
    kind 控制高度与层数；lo 为山林远景低模
    """
    rng = random.Random(300 + kind)
    bm = bmesh.new()
    h = (7.5, 9.0, 6.0)[kind % 3]
    tiers = 3 if lo else (5, 6, 4)[kind % 3]
    lib.add_cyl(bm, 0.12, h * 0.35, (0, 0, h * 0.175), seg=6, mat=0, r2=0.08)
    base_r = h * 0.28
    for t in range(tiers):
        k = t / tiers
        r = base_r * (1 - k * 0.8)
        z0 = h * (0.22 + k * 0.62)
        th = h * 0.32
        faces = lib.add_cyl(bm, r, th, (0, 0, z0 + th / 2), seg=7 if lo else 10, mat=1, r2=0.05)
        for v in {v for f in faces for v in f.verts}:
            if v.co.z < z0 + 0.01:
                v.co.x *= 1 + (rng.random() - 0.5) * 0.25
                v.co.y *= 1 + (rng.random() - 0.5) * 0.25
                v.co.z -= rng.random() * 0.35
    return lib.make_mesh(f"conifer_{kind}" + ("_lo" if lo else ""), bm, [M["trunk"], M["needle"]], smooth_angle=50)


def tree(M, kind=0, lo=False, lit=False):
    """
    行道树：树干 + 主枝 + 7~9 团带扰动的树冠，两种绿色交错，三种形态（kind 0 圆冠、1 塔形、2 散冠）。
    树冠顶点随机外扰，打破几何球的「塑料感」。
    """
    import random

    rng = random.Random(100 + kind)
    bm = bmesh.new()
    h = (2.4, 2.8, 2.1)[kind % 3]
    lib.add_cyl(bm, 0.14, h, (0, 0, h / 2), seg=8, mat=0, r2=0.09)
    for k in range(3):
        a = k * 2.1 + rng.random()
        lib.add_tube(bm, [(0, 0, h * 0.7), (math.cos(a) * 0.6, math.sin(a) * 0.6, h + 0.3)], 0.05, seg=5, mat=0)
    # 树冠：在椭球体积内撒 16~22 个小叶团（半径 0.38~0.62），比几个大球更像真实树冠的层次
    if kind % 3 == 1:
        ry, rz, n = 1.0, 2.0, 18  # 塔形
    elif kind % 3 == 2:
        ry, rz, n = 1.7, 1.1, 22  # 散冠
    else:
        ry, rz, n = 1.35, 1.3, 20  # 圆冠
    if lo:
        n = 7  # 山林远景用的低模：叶团少、细分低，几百棵也不卡
    cz = h + rz * 0.75
    blobs = []
    for i in range(n):
        while True:
            x, y, z = (rng.uniform(-1, 1) for _ in range(3))
            if x * x + y * y + z * z <= 1:
                break
        r = 0.38 + rng.random() * 0.24
        blobs.append(((x * ry, y * ry, cz + z * rz), r))
    for i, (c, r) in enumerate(blobs):
        if lo:
            r *= 1.5
        faces = lib.add_ico(bm, r, c, sub=1 if lo else 2, mat=1 + (i % 3 == 0), scale=(1, 1, 0.9))
        for v in {v for f in faces for v in f.verts}:
            v.co += (v.co - Vector(c)).normalized() * (rng.random() - 0.5) * r * 0.18
    # lit：树下有投光的版本，叶子换成带暖黄自发光的材质（实时渲染里的「被照亮」效果）
    leaves = [M["leaf_lit"], M["leaf_lit"]] if lit else [M["leaf"], M["leaf2"]]
    name = f"tree_{kind}" + ("_lo" if lo else "") + ("_lit" if lit else "")
    return lib.make_mesh(name, bm, [M["trunk"], *leaves], smooth_angle=60)



def bush(M):
    """矮灌木团：5 团带扰动的小球，深浅两色"""
    import random

    rng = random.Random(7)
    bm = bmesh.new()
    for i, (c, r) in enumerate((((0, 0, 0.42), 0.55), ((0.5, 0.15, 0.32), 0.42), ((-0.45, -0.1, 0.3), 0.4), ((0.15, -0.45, 0.28), 0.36), ((-0.2, 0.45, 0.3), 0.38))):
        faces = lib.add_ico(bm, r, c, sub=2, mat=i % 2, scale=(1, 1, 0.8))
        for v in {v for f in faces for v in f.verts}:
            v.co += (v.co - Vector(c)).normalized() * (rng.random() - 0.5) * r * 0.25
    return lib.make_mesh("bush", bm, [M["leaf2"], M["leaf"]], smooth_angle=60)



def totem(M):
    """价格立柱：1.8 × 0.7 × 7.2，两面屏幕（±y），顶部青色灯带"""
    bm = bmesh.new()
    lib.add_box(bm, (2.2, 1.1, 0.3), (0, 0, 0.15), mat=1)
    lib.add_box(bm, (1.8, 0.7, 7.0), (0, 0, 0.3 + 3.5), bevel=0.06, mat=0)
    lib.add_box(bm, (1.9, 0.8, 0.12), (0, 0, 7.36), mat=2)
    lib.add_plane(bm, (1.4, 4.6), (0, -0.356, 4.2), rot=lib.FACE_S, mat=3)
    lib.add_plane(bm, (1.4, 4.6), (0, 0.356, 4.2), rot=lib.FACE_N, mat=3)
    return lib.make_mesh("totem", bm, [M["graphite"], M["steel_dark"], M["led_cyan"], M["totem_screen"]], smooth_angle=35)



# ---------------------------------------------------------------- v2 新增（按设计稿）


def h_tank(M, r, L):
    """白色卧式储气罐（CNG）：圆柱罐体 + 椭圆封头 + 两个鞍座，长边沿 x，底面中心在原点"""
    bm = bmesh.new()
    zc = r + 0.7
    lib.add_cyl(bm, r, L, (0, 0, zc), seg=32, mat=0, axis="X")
    for s in (-1, 1):
        lib.add_ico(bm, r, (s * L / 2, 0, zc), sub=3, mat=0, scale=(0.45, 1, 1))
        lib.add_box(bm, (0.6, r * 1.6, 0.9), (s * L * 0.3, 0, 0.45), mat=1)
    lib.add_tube(bm, [(L / 2 - 0.5, 0, zc + r), (L / 2 + 0.6, 0, zc + r + 0.6), (L / 2 + 1.4, 0, 0.6)], 0.07, mat=2)
    return lib.make_mesh("h_tank", bm, [M["white"], M["concrete"], M["pipe_yellow"]], smooth_angle=35)


def light_post(M, led):
    """围栏角上的灯柱：深色立柱 + 顶部一段发光灯管（颜色随 led 材质）"""
    bm = bmesh.new()
    lib.add_cyl(bm, 0.09, 3.2, (0, 0, 1.6), seg=10, mat=0)
    lib.add_cyl(bm, 0.12, 0.7, (0, 0, 3.4), seg=12, mat=1)
    return lib.make_mesh("light_post_" + led.name, bm, [M["graphite"], led], smooth_angle=40)


def pylon(M):
    """
    站名价格立柱（设计稿里西端最显眼的白色高柱）：2.4 × 0.9 × 10.5，白色柱身，两面（±y）各 4 块发光价格屏，
    顶部站标灯箱与青色顶边
    """
    bm = bmesh.new()
    lib.add_box(bm, (3.0, 1.4, 0.35), (0, 0, 0.175), mat=1)
    lib.add_box(bm, (2.4, 0.9, 10.2), (0, 0, 0.35 + 5.1), bevel=0.08, segments=3, mat=0)
    lib.add_box(bm, (2.5, 1.0, 0.14), (0, 0, 10.6), mat=2)
    for s in (-1, 1):
        y = s * 0.456
        rot = lib.FACE_N if s > 0 else lib.FACE_S
        lib.add_plane(bm, (1.7, 1.5), (0, y, 8.9), rot=rot, mat=3)  # 站标
        for i in range(4):
            lib.add_plane(bm, (1.8, 0.95), (0, y, 6.9 - i * 1.25), rot=rot, mat=4)  # 价格屏
    return lib.make_mesh("pylon", bm, [M["white"], M["steel_dark"], M["led_cyan"], M["totem_logo"], M["totem_screen"]], smooth_angle=35)


def rock(M):
    """山石：扰动过的二十面体，深灰"""
    rng = random.Random(11)
    bm = bmesh.new()
    faces = lib.add_ico(bm, 1.0, (0, 0, 0.5), sub=2, mat=0, scale=(1.3, 1.0, 0.8))
    for v in {v for f in faces for v in f.verts}:
        v.co += v.co.normalized() * (rng.random() - 0.5) * 0.35
    return lib.make_mesh("rock", bm, [M["rock"]], smooth_angle=20)


def house(M, kind=0):
    """远山村庄的民居：两层小楼 + 坡屋顶，窗户发暖光（kind 控制尺寸）"""
    L, W, H = ((9.0, 7.0, 6.2), (11.0, 8.0, 6.8), (7.5, 6.5, 3.4))[kind % 3]
    bm = bmesh.new()
    lib.add_box(bm, (L, W, H), (0, 0, H / 2), mat=0)
    roof = bmesh.new()
    pts = [(-W / 2 - 0.5, H), (W / 2 + 0.5, H), (0, H + W * 0.42)]
    vs0 = [roof.verts.new((-L / 2 - 0.4, y, z)) for y, z in pts]
    vs1 = [roof.verts.new((L / 2 + 0.4, y, z)) for y, z in pts]
    for i in range(3):
        roof.faces.new((vs0[i], vs0[(i + 1) % 3], vs1[(i + 1) % 3], vs1[i]))
    roof.faces.new(vs0[::-1])
    roof.faces.new(vs1)
    bmesh.ops.recalc_face_normals(roof, faces=roof.faces)
    for f in roof.faces:
        f.material_index = 1
    lib._merge(bm, roof)
    rng = random.Random(50 + kind)
    floors = 2 if H > 5 else 1
    for fl in range(floors):
        z = 1.6 + fl * 3.0
        for i in range(3):
            if rng.random() < 0.65:
                lib.add_plane(bm, (1.5, 1.3), (-L / 3 + i * L / 3, -W / 2 - 0.02, z), rot=lib.FACE_S, mat=2)
            if rng.random() < 0.4:
                lib.add_plane(bm, (1.5, 1.3), (-L / 3 + i * L / 3, W / 2 + 0.02, z), rot=lib.FACE_N, mat=2)
    return lib.make_mesh(f"house_{kind}", bm, [M["wall_dark"], M["roof"], M["house_light"]], smooth_angle=30)

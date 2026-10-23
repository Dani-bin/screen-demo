"""
十堰东环路综合能源站效果图 · 预制件
----------------------------------------------------------
每个函数返回一份网格数据（局部坐标：底面中心在原点、z 向上；车辆车头朝 +x），场景里用 lib.place 共享引用摆放。
"""

import math
import random

import bmesh
from mathutils import Vector

from . import lib

# ---------------------------------------------------------------- 植物


def tree(M, kind=0, lo=False):
    """
    阔叶乔木：树干 + 主枝 + 一团团带扰动的叶团。kind：0 圆冠（香樟）、1 高冠（杨树）、2 散冠、3 暖色（香椿 / 栾树）。
    lo：远山用低模（叶团少、细分低）
    """
    rng = random.Random(100 + kind * 7 + (50 if lo else 0))
    bm = bmesh.new()
    h = (3.2, 4.2, 2.8, 3.0)[kind % 4]
    lib.add_cyl(bm, 0.28, h, (0, 0, h / 2), seg=8, mat=0, r2=0.18)
    if not lo:
        for k in range(4):
            a = k * 1.7 + rng.random()
            lib.add_tube(bm, [(0, 0, h * 0.75), (math.cos(a) * 1.3, math.sin(a) * 1.3, h + 1.2)], 0.1, seg=5, mat=0)
    ry, rz, n = ((3.4, 2.8, 22), (2.4, 4.6, 20), (4.0, 2.4, 24), (3.2, 2.9, 20))[kind % 4]
    if lo:
        n = 6
    cz = h + rz * 0.8
    for i in range(n):
        while True:
            x, y, z = (rng.uniform(-1, 1) for _ in range(3))
            if x * x + y * y + z * z <= 1:
                break
        r = (0.9 + rng.random() * 0.55) * (1.7 if lo else 1.0)
        c = (x * ry, y * ry, cz + z * rz)
        faces = lib.add_ico(bm, r, c, sub=1 if lo else 2, mat=1 + (i % 3 == 0), scale=(1, 1, 0.85))
        for v in {v for f in faces for v in f.verts}:
            v.co += (v.co - Vector(c)).normalized() * (rng.random() - 0.5) * r * 0.25
    leaves = {0: ("leaf1", "leaf2"), 1: ("leaf2", "leaf1"), 2: ("leaf3", "leaf1"), 3: ("leaf_warm", "leaf2")}[kind % 4]
    return lib.make_mesh(f"tree_{kind}" + ("_lo" if lo else ""), bm, [M["trunk"], M[leaves[0]], M[leaves[1]]],
                         smooth_angle=60)


def shrub(M, kind=0):
    """灌木球 / 绿篱团"""
    rng = random.Random(9 + kind)
    bm = bmesh.new()
    for i in range(5):
        c = (rng.uniform(-0.7, 0.7), rng.uniform(-0.7, 0.7), 0.55 + rng.uniform(0, 0.25))
        r = rng.uniform(0.55, 0.8)
        faces = lib.add_ico(bm, r, c, sub=2, mat=i % 2, scale=(1, 1, 0.8))
        for v in {v for f in faces for v in f.verts}:
            v.co += (v.co - Vector(c)).normalized() * (rng.random() - 0.5) * r * 0.25
    return lib.make_mesh(f"shrub_{kind}", bm, [M["leaf2"], M["leaf1"]], smooth_angle=60)


# ---------------------------------------------------------------- 车辆（车头朝 +x，原点在车身中心地面）


def _wheels(bm, xs, half_track, r, w, mat_t=1, mat_r=2):
    for x in xs:
        for s in (-1, 1):
            lib.add_cyl(bm, r, w, (x, s * half_track, r), seg=14, mat=mat_t, axis="Y")
            lib.add_cyl(bm, r * 0.55, w + 0.02, (x, s * half_track, r), seg=10, mat=mat_r, axis="Y")


def car(M, paint, kind=0):
    """小客车：kind 0 轿车（4.7 m）、1 SUV（4.8 m，车顶更高）"""
    L, W = (4.7, 1.85) if kind == 0 else (4.8, 1.95)
    bm = bmesh.new()
    body_h = 0.72 if kind == 0 else 0.85
    lib.add_box(bm, (L, W, body_h), (0, 0, 0.32 + body_h / 2), bevel=0.22, segments=3, mat=0)
    ch = 0.52 if kind == 0 else 0.68
    cl = 2.5 if kind == 0 else 2.9
    faces = lib.add_box(bm, (cl, W - 0.16, ch), (-0.25, 0, 0.32 + body_h + ch / 2 - 0.04), bevel=0.16, segments=3, mat=3)
    top = 0.32 + body_h + ch - 0.04
    for v in {v for f in faces for v in f.verts}:
        if v.co.z > top - 0.25:  # 车顶收窄、前挡后挡斜一点
            v.co.y *= 0.9
            v.co.x = -0.25 + (v.co.x + 0.25) * 0.78
    lib.add_box(bm, (cl * 0.74, W - 0.3, 0.06), (-0.3, 0, top + 0.01), bevel=0.02, mat=0)  # 车顶钣金
    _wheels(bm, (L / 2 - 0.85, -L / 2 + 0.9), W / 2 - 0.12, 0.34, 0.24)
    return lib.make_mesh(f"car_{kind}_{paint}", bm, [M[paint], M["tyre"], M["rim"], M["car_glass"]], smooth_angle=40)


def truck(M, cab, trailer="trailer", length=16.5):
    """牵引车 + 厢式半挂（总长约 16.5 m，高 4 m）；车头朝 +x"""
    bm = bmesh.new()
    L = length
    xc = L / 2 - 1.3  # 驾驶室中心
    lib.add_box(bm, (2.3, 2.5, 2.9), (xc, 0, 1.0 + 1.45), bevel=0.18, segments=3, mat=0)  # 驾驶室
    lib.add_box(bm, (0.08, 2.2, 1.0), (xc + 1.16, 0, 2.95), mat=3)  # 前挡风
    lib.add_box(bm, (1.6, 2.4, 0.5), (xc - 0.2, 0, 4.2), bevel=0.15, mat=0)  # 导流罩
    lib.add_box(bm, (3.6, 2.2, 0.35), (xc - 1.6, 0, 0.95), mat=4)  # 底盘
    lib.add_box(bm, (L - 3.4, 2.55, 2.9), (-L / 2 + (L - 3.4) / 2, 0, 1.25 + 1.45), bevel=0.05, mat=5)  # 货厢
    lib.add_box(bm, (L - 3.6, 2.3, 0.3), (-L / 2 + (L - 3.4) / 2, 0, 1.05), mat=4)
    _wheels(bm, (xc + 0.3, xc - 3.0, xc - 4.4), 0.95, 0.52, 0.5, 1, 2)
    _wheels(bm, (-L / 2 + 1.5, -L / 2 + 2.8, -L / 2 + 4.1), 0.95, 0.52, 0.5, 1, 2)
    return lib.make_mesh(f"truck_{cab}_{trailer}", bm,
                         [M[cab], M["tyre"], M["rim"], M["car_glass"], M["steel_dark"], M[trailer]], smooth_angle=35)


def tube_trailer(M):
    """氢气长管拖车（无牵引车停在卸气位）：底盘 + 框架 + 8 根长管"""
    bm = bmesh.new()
    L = 12.5
    lib.add_box(bm, (L, 2.4, 0.35), (0, 0, 1.15), mat=1)
    for x in (-L / 2 + 0.3, L / 2 - 0.3):
        lib.add_box(bm, (0.4, 2.5, 2.6), (x, 0, 1.3 + 1.3), mat=2)
    for i in range(4):
        for j in range(2):
            lib.add_cyl(bm, 0.28, L - 1.0, (0, -0.9 + i * 0.6, 1.75 + j * 0.62), seg=14, mat=0, axis="X")
    _wheels(bm, (-L / 2 + 1.2, -L / 2 + 2.5, -L / 2 + 3.8), 0.95, 0.5, 0.5, 3, 4)
    lib.add_box(bm, (0.3, 0.3, 1.0), (L / 2 - 1.0, 0, 0.6), mat=1)  # 支腿
    return lib.make_mesh("tube_trailer", bm, [M["tank"], M["steel_dark"], M["tank_blue"], M["tyre"], M["rim"]],
                         smooth_angle=35)


# ---------------------------------------------------------------- 设备


def charger_truck(M):
    """重卡超充终端：白色立柜 + 蓝色屏 + 线缆挂架"""
    bm = bmesh.new()
    lib.add_box(bm, (0.5, 0.75, 0.15), (0, 0, 0.075), mat=2)
    lib.add_box(bm, (0.45, 0.65, 2.0), (0, 0, 1.15), bevel=0.05, mat=0)
    lib.add_box(bm, (0.02, 0.45, 0.4), (0.235, 0, 1.6), mat=1)
    lib.add_box(bm, (0.47, 0.67, 0.12), (0, 0, 2.2), mat=3)
    return lib.make_mesh("charger_truck", bm, [M["steel_white"], M["screen"], M["concrete"], M["blue"]], smooth_angle=30)


def charger_car(M):
    """小车充电桩：落地式白色桩体 + 绿色灯带"""
    bm = bmesh.new()
    lib.add_box(bm, (0.32, 0.22, 1.35), (0, 0, 0.675), bevel=0.04, mat=0)
    lib.add_box(bm, (0.33, 0.02, 0.5), (0, 0.11, 1.0), mat=1)
    return lib.make_mesh("charger_car", bm, [M["steel_white"], M["green_brand"]], smooth_angle=30)


def dispenser_h2(M):
    """加氢机：白色机身 + 青色顶带 + 两侧屏"""
    bm = bmesh.new()
    lib.add_box(bm, (1.1, 0.7, 2.3), (0, 0, 1.15 + 0.25), bevel=0.06, mat=0)
    lib.add_box(bm, (1.12, 0.72, 0.3), (0, 0, 2.55), mat=1)
    for s in (-1, 1):
        lib.add_box(bm, (0.6, 0.02, 0.45), (0, s * 0.36, 1.9), mat=2)
    return lib.make_mesh("dispenser_h2", bm, [M["steel_white"], M["teal"], M["screen"]], smooth_angle=30)


def h2_rack(M):
    """储氢瓶组：钢框架 + 3×2 根立式储氢罐（直径 1.0 m、高 7.5 m），中心在原点"""
    bm = bmesh.new()
    lib.add_box(bm, (6.4, 4.6, 0.4), (0, 0, 0.2), mat=2)
    for i in range(3):
        for j in range(2):
            x, y = -2.1 + i * 2.1, -1.1 + j * 2.2
            lib.add_cyl(bm, 0.5, 7.0, (x, y, 0.4 + 3.5), seg=18, mat=0)
            lib.add_ico(bm, 0.5, (x, y, 7.4), sub=2, mat=0, scale=(1, 1, 0.45))
    for z in (2.5, 5.5):
        lib.add_box(bm, (6.6, 4.8, 0.12), (0, 0, z), mat=1)
    for x in (-3.2, 3.2):
        for y in (-2.3, 2.3):
            lib.add_box(bm, (0.15, 0.15, 7.0), (x, y, 3.9), mat=1)
    return lib.make_mesh("h2_rack", bm, [M["tank"], M["steel_grey"], M["concrete"]], smooth_angle=40)


def container(M, L=12.2, W=2.5, H=2.9, accent="green_brand", name="ess"):
    """预制舱（储能舱 / 压缩机舱）：白色箱体 + 竖向波纹分格 + 顶部空调外机 + 一道品牌色带；长边沿 x"""
    bm = bmesh.new()
    lib.add_box(bm, (L, W, 0.3), (0, 0, 0.15), mat=3)
    lib.add_box(bm, (L, W, H), (0, 0, 0.3 + H / 2), bevel=0.03, mat=0)
    n = int(L / 1.2)
    for i in range(1, n):
        x = -L / 2 + i * L / n
        for s in (-1, 1):
            lib.add_box(bm, (0.05, 0.03, H - 0.3), (x, s * (W / 2 + 0.01), 0.3 + H / 2), mat=1)
    for s in (-1, 1):
        lib.add_box(bm, (L + 0.02, 0.03, 0.22), (0, s * (W / 2 + 0.015), 0.3 + H - 0.35), mat=2)
    for i in range(int(L // 4)):
        lib.add_box(bm, (1.2, 1.4, 0.7), (-L / 2 + 2 + i * 4, 0, 0.3 + H + 0.35), bevel=0.05, mat=1)
    return lib.make_mesh(name, bm, [M["container"], M["steel_grey"], M[accent], M["concrete"]], smooth_angle=30)


def box_transformer(M):
    """箱变：灰绿色箱体 + 门格"""
    bm = bmesh.new()
    lib.add_box(bm, (6.2, 3.2, 0.4), (0, 0, 0.2), mat=2)
    lib.add_box(bm, (5.8, 2.8, 2.6), (0, 0, 0.4 + 1.3), bevel=0.04, mat=0)
    lib.add_box(bm, (6.1, 3.1, 0.15), (0, 0, 3.05), mat=1)
    for i in range(4):
        for s in (-1, 1):
            lib.add_box(bm, (1.2, 0.02, 2.0), (-2.1 + i * 1.4, s * 1.41, 1.5), mat=1)
    return lib.make_mesh("box_transformer", bm, [M["cabinet"], M["steel_grey"], M["concrete"]], smooth_angle=30)


def lamp(M, h=10.0):
    """路灯：灰白灯杆 + 单臂灯头 + 太阳能板（照片里现状路灯就是这种）"""
    bm = bmesh.new()
    lib.add_cyl(bm, 0.12, h, (0, 0, h / 2), seg=10, mat=0, r2=0.07)
    lib.add_tube(bm, [(0, 0, h - 0.6), (0.9, 0, h - 0.1), (1.7, 0, h - 0.2)], 0.05, seg=6, mat=0)
    lib.add_box(bm, (0.8, 0.35, 0.12), (1.8, 0, h - 0.25), bevel=0.03, mat=1)
    lib.add_box(bm, (0.02, 0.3, 0.04), (1.8, 0, h - 0.33), mat=2)
    lib.add_box(bm, (0.9, 0.6, 0.04), (0, 0, h + 0.3), mat=3)
    return lib.make_mesh("lamp", bm, [M["steel_white"], M["steel_grey"], M["lamp_glow"], M["pv"]], smooth_angle=40)


def fence_post(M):
    bm = bmesh.new()
    lib.add_box(bm, (0.08, 0.08, 1.9), (0, 0, 0.95), mat=0)
    return lib.make_mesh("fence_post", bm, [M["fence"]])


# ---------------------------------------------------------------- 建筑


def swap_hall(M, L=30.0, W=12.0, H=7.5):
    """
    换电站：沿 x 长 L（车辆沿 x 穿过）、宽 W，高 H；白色墙面 + 顶部蓝色檐带 + 两端大门洞（深色）+ 屋顶光伏。
    返回 (主体网格, 屋顶光伏网格)
    """
    bm = bmesh.new()
    lib.add_box(bm, (L, W, H), (0, 0, H / 2), mat=0)
    lib.add_box(bm, (L + 0.4, W + 0.4, 1.2), (0, 0, H + 0.3), mat=1)  # 檐口（蓝）
    lib.add_box(bm, (L + 0.42, W + 0.42, 0.25), (0, 0, H + 0.95), mat=2)  # 檐口顶白边
    for s in (-1, 1):
        lib.add_box(bm, (0.1, 5.0, 5.2), (s * (L / 2 + 0.02), 0, 2.6), mat=3)  # 门洞
        lib.add_box(bm, (0.14, 5.6, 0.35), (s * (L / 2 + 0.03), 0, 5.35), mat=1)
        lib.add_box(bm, (L - 6.0, 0.06, 1.4), (0, s * (W / 2 + 0.02), H - 2.3), mat=4)  # 侧面通长窗带
    body = lib.make_mesh("swap_hall", bm, [M["wall_white"], M["blue"], M["canopy_white"], M["glass_dark"],
                                           M["glass_band"]], smooth_angle=20)
    pv_bm = bmesh.new()
    _pv_field(pv_bm, L - 1.6, W - 1.6, H + 1.1, tilt=6)
    return body, lib.make_mesh("swap_hall_pv", pv_bm, [M["pv"]])


def office(M, L=30.0, W=28.0, floors=4):
    """
    综合楼（站房 / 司机之家 / 监控中心）：照参考图的白色框架 + 横向玻璃带；
    首层通高玻璃大堂，屋顶东半边光伏、西半边木平台露台。沿 x 长 L、沿 y 宽 W。返回 (主体, 光伏)
    """
    fh = 4.2
    H = fh * floors
    bm = bmesh.new()
    lib.add_box(bm, (L - 0.6, W - 0.6, H), (0, 0, H / 2), mat=1)  # 玻璃芯
    # 每层白色楼板挑檐 + 角柱
    for k in range(floors + 1):
        z = k * fh
        lib.add_box(bm, (L, W, 0.6 if k else 0.4), (0, 0, z + (0.3 if k else 0.2)), mat=0)
    for x in (-L / 2 + 0.6, L / 2 - 0.6):
        for y in (-W / 2 + 0.6, W / 2 - 0.6):
            lib.add_box(bm, (1.2, 1.2, H), (x, y, H / 2), mat=0)
    # 竖向白色遮阳格栅（南立面 -y、东立面 +x）
    for i in range(1, 10):
        x = -L / 2 + i * L / 10
        lib.add_box(bm, (0.25, 0.5, H - 4.2), (x, -W / 2 - 0.1, 4.2 + (H - 4.2) / 2), mat=0)
    lib.add_box(bm, (L + 0.6, W + 0.6, 1.0), (0, 0, H + 0.5), mat=0)  # 女儿墙
    lib.add_box(bm, (L * 0.45, W - 2.0, 0.15), (-L * 0.25, 0, H + 0.4), mat=2)  # 木平台
    lib.add_box(bm, (6.0, 4.5, 3.4), (L / 2 - 5.0, W / 2 - 4.0, H + 1.7), mat=0)  # 楼梯间
    lib.add_box(bm, (8.0, 0.25, 0.2), (0, -W / 2 - 3.2, 4.2), mat=3)  # 入口雨棚前沿（蓝）
    lib.add_box(bm, (8.0, 3.4, 0.35), (0, -W / 2 - 1.6, 4.25), mat=0)  # 入口雨棚
    lib.uv_world(bm, 1.0)
    body = lib.make_mesh("office", bm, [M["wall_white"], M["glass"], M["wood"], M["blue"]], smooth_angle=20)
    pv_bm = bmesh.new()
    _pv_field(pv_bm, L * 0.42, W - 3.0, H + 1.3, tilt=8, cx=L * 0.24)
    return body, lib.make_mesh("office_pv", pv_bm, [M["pv"]])


def _pv_field(bm, L, W, z, tilt=5.0, cx=0.0, cy=0.0, mat=0, row=None):
    """屋面光伏阵列：一行行向南（-y）倾斜的组件带，UV 以米计（材质里画组件分格）"""
    row = row or 2.4
    gap = 0.5
    n = max(1, int((W + gap) // (row + gap)))
    y0 = cy - (n * (row + gap) - gap) / 2
    t = math.radians(tilt)
    for j in range(n):
        ya = y0 + j * (row + gap)
        yb = ya + row * math.cos(t)
        za, zb = z, z + row * math.sin(t)
        pts = [(cx - L / 2, ya, za), (cx + L / 2, ya, za), (cx + L / 2, yb, zb), (cx - L / 2, yb, zb)]
        lib.add_quad(bm, pts, mat=mat, uv=[(0, 0), (L, 0), (L, row), (0, row)])


def ancestral_hall(M):
    """
    徐氏祠：清代小型宗祠，坐北朝南。前后两进（门厅 + 正堂）+ 院墙，白粉墙、小青瓦硬山顶、两端马头墙，
    门口一对红柱。沿 x 面阔约 16 m。原点在院落中心
    """
    bm = bmesh.new()
    W, D = 18.0, 24.0  # 院墙
    t = 0.4
    for s in (-1, 1):
        lib.add_box(bm, (t, D, 2.6), (s * W / 2, 0, 1.3), mat=0)
        lib.add_box(bm, (t + 0.5, D + 0.5, 0.3), (s * W / 2, 0, 2.7), mat=1)
    lib.add_box(bm, (W, t, 2.6), (0, D / 2, 1.3), mat=0)

    def hall(cy, w, d, h, ridge):
        lib.add_box(bm, (w, d, 0.5), (0, cy, 0.25), mat=3)  # 台基
        lib.add_box(bm, (w - 0.6, d - 0.6, h), (0, cy, 0.5 + h / 2), mat=0)
        # 硬山双坡顶：沿 x 的屋脊，两坡瓦面出檐 0.9 m
        z0 = 0.5 + h
        e = 0.9
        for s in (-1, 1):
            pts = [(-w / 2 - 0.2, cy + s * (d / 2 + e), z0 - 0.3), (w / 2 + 0.2, cy + s * (d / 2 + e), z0 - 0.3),
                   (w / 2 + 0.2, cy, z0 + ridge), (-w / 2 - 0.2, cy, z0 + ridge)]
            if s < 0:
                pts = pts[::-1]
            slope = math.hypot(d / 2 + e, ridge + 0.3)
            lib.add_quad(bm, pts, mat=1, uv=[(0, 0), (w, 0), (w, slope), (0, slope)][:: (1 if s > 0 else -1)])
        lib.add_box(bm, (w + 0.6, 0.5, 0.45), (0, cy, z0 + ridge + 0.1), mat=4)  # 正脊
        # 两端马头墙（山墙高出屋面，阶梯状）
        for sx in (-1, 1):
            x = sx * (w / 2 - 0.1)
            lib.add_box(bm, (0.5, d + 0.4, h + ridge * 0.7), (x, cy, 0.5 + (h + ridge * 0.7) / 2), mat=0)
            lib.add_box(bm, (0.7, d * 0.55, 0.25), (x, cy, 0.5 + h + ridge * 0.7 + 0.1), mat=4)
        return z0

    hall(-D / 2 + 4.0, 12.0, 6.0, 4.0, 1.8)  # 门厅
    hall(D / 2 - 7.0, 16.0, 9.0, 5.0, 2.6)  # 正堂
    for sx in (-1, 1):
        lib.add_cyl(bm, 0.22, 4.0, (sx * 1.6, -D / 2 + 0.6, 2.5), seg=10, mat=2)
    lib.add_box(bm, (2.4, 0.15, 3.0), (0, -D / 2 + 0.95, 2.0), mat=5)  # 大门
    lib.add_box(bm, (W - 1.0, D - 1.0, 0.08), (0, 0, 0.04), mat=6)  # 院内铺地
    return lib.make_mesh("ancestral_hall", bm, [M["wall_ancient"], M["roof_tile"], M["pillar_red"], M["brick_grey"],
                                                M["steel_dark"], M["wood"], M["pavers"]], smooth_angle=20)


def sign_pylon(M):
    """入口标识立柱：白色立板 + 顶部蓝绿两道色带（站名在效果图里看不清，不做文字）"""
    bm = bmesh.new()
    lib.add_box(bm, (3.2, 1.2, 0.4), (0, 0, 0.2), mat=2)
    lib.add_box(bm, (2.6, 0.8, 11.0), (0, 0, 0.4 + 5.5), bevel=0.08, mat=0)
    lib.add_box(bm, (2.64, 0.84, 1.6), (0, 0, 9.4), mat=1)
    lib.add_box(bm, (2.64, 0.84, 0.5), (0, 0, 8.2), mat=3)
    return lib.make_mesh("sign_pylon", bm, [M["canopy_white"], M["blue"], M["concrete"], M["green_brand"]],
                         smooth_angle=30)


def house(M, kind=0):
    """周边民房：2~3 层白墙平顶 / 坡顶小楼"""
    rng = random.Random(kind)
    bm = bmesh.new()
    w, d = rng.uniform(9, 14), rng.uniform(8, 11)
    h = 3.3 * rng.choice((2, 3, 3))
    lib.add_box(bm, (w, d, h), (0, 0, h / 2), mat=0)
    for k in range(int(h // 3.3)):
        lib.add_box(bm, (w * 0.7, 0.05, 1.2), (0, -d / 2 - 0.02, 1.6 + k * 3.3), mat=2)
    if kind % 2:
        lib.add_box(bm, (w + 0.4, d + 0.4, 0.4), (0, 0, h + 0.2), mat=0)
    else:
        for s in (-1, 1):
            pts = [(-w / 2 - 0.4, s * (d / 2 + 0.6), h), (w / 2 + 0.4, s * (d / 2 + 0.6), h), (w / 2 + 0.4, 0, h + 2.2),
                   (-w / 2 - 0.4, 0, h + 2.2)]
            lib.add_quad(bm, pts if s > 0 else pts[::-1], mat=1)
    return lib.make_mesh(f"house_{kind}", bm, [M["wall_white"], M["roof_orange"] if kind % 3 else M["roof_grey"],
                                               M["glass_dark"]], smooth_angle=20)

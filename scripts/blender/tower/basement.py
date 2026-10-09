"""
地下机房（B1～B3）建模：底座正面方形剖口里露出的三层机房，烘焙方式同楼层（大面烘贴图、设备烘顶点色）
----------------------------------------------------------
尺寸规则必须与 BuildingScene.js 一致：
  底座半径 R = 塔楼平面最大半径 × BASE_SCALE 2.25；剖口半宽 half = 0.68 R；剖口正面在 f = 0.26 R；机房进深 ROOM_D 20 m；
  地下层高 BASE_FLOOR 13 m（示意比例）。
坐标：剖切坐标系建模——Blender x = l（画面横向，右为正），Blender y = -f（f 朝相机），z = 高度（地面 0，向下为负）。
three.js 里把对象绕竖轴转 camAng（相机方位角），l、f 轴就对上了画面横向和相机方向。
对象：<塔>_basement（楼板、后墙、隔墙、剖面墙，烘贴图）与 <塔>_basement_v（设备、灯具、管道，烘顶点色）。
"""

import math
import random

import bmesh

from . import lib
from .floors import MI

BASE_SCALE = 2.25
NOTCH_HALF = 0.68
NOTCH_FRONT = 0.26
ROOM_D = 20.0
BASE_FLOOR = 13.0
K = BASE_FLOOR / 10  # 设备按 10 m 层高设计的尺寸，同比放大


def _box(bm, size, l, f, z, mat, rot=0.0, bottom=False):
    """剖切坐标下的盒子：size = (沿 l, 沿 f, 高)，(l, f, z) 为中心"""
    lib.add_box(bm, size, (l, -f, z), rot, mat, bottom)


def _cyl_l(bm, r, length, l, f, z, mat, seg=14):
    """沿 l 方向（横向）的圆柱：卧式水泵、横管"""
    import mathutils

    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=length,
                                matrix=mathutils.Matrix.Translation((l, -f, z)) @ mathutils.Matrix.Rotation(math.pi / 2, 4, "Y"))
    for v in res["verts"]:
        for fc in v.link_faces:
            fc.material_index = mat


def build(name, radius, M, col, loc):
    R = radius * BASE_SCALE
    half = NOTCH_HALF * R
    c = NOTCH_FRONT * R
    back = c - ROOM_D
    depth = 3 * BASE_FLOOR
    rnd = random.Random(5)
    bm = bmesh.new()  # 大面：烘贴图
    bv = bmesh.new()  # 设备：烘顶点色

    def quad(target, pts, mat, n):
        """四边形；n 为期望的法线方向（剖切坐标 l, f, z），绕向不对就翻过来"""
        from mathutils import Vector

        p = [Vector((l, -f, z)) for l, f, z in pts]
        want = Vector((n[0], -n[1], n[2]))
        if (p[1] - p[0]).cross(p[2] - p[1]).dot(want) < 0:
            p.reverse()
        target.faces.new([target.verts.new(v) for v in p]).material_index = mat

    # ---- 每层地面（顶面 + 剖口上露出的楼板厚边）、天花（上一层楼板底面）
    for b in range(1, 4):
        z = -b * BASE_FLOOR
        quad(bm, [(-half, back, z), (half, back, z), (half, c, z), (-half, c, z)], MI["stone"], (0, 0, 1))
        quad(bv, [(-half, c, z), (half, c, z), (half, c, z - 0.8), (-half, c, z - 0.8)], MI["slab_edge"], (0, 1, 0))
        zc = z + BASE_FLOOR - 0.02
        quad(bm, [(-half, back, zc), (-half, c, zc), (half, c, zc), (half, back, zc)], MI["ceiling"], (0, 0, -1))
    # ---- 后墙、两道隔墙（每层分左中右三间）、剖口两侧的剖面墙（混凝土）
    quad(bm, [(-half, back, -depth), (half, back, -depth), (half, back, 0), (-half, back, 0)], MI["concrete"], (0, 1, 0))
    for k in (-0.36, 0.3):
        lx = k * half
        for s in (1, -1):  # 隔墙两面
            quad(bm, [(lx, back, -depth), (lx, c, -depth), (lx, c, 0), (lx, back, 0)], MI["concrete"], (s, 0, 0))
    # 剖面墙：底座实体被切开的断面，朝向剖口内侧
    f_out = math.sqrt(R * R - half * half)
    for s in (-1, 1):
        lx = s * half
        quad(bm, [(lx, back, -depth), (lx, f_out, -depth), (lx, f_out, 0), (lx, back, 0)], MI["concrete"], (-s, 0, 0))

    # ---- 吊顶灯：每间两排冷白灯管
    for b in range(1, 4):
        zt = -b * BASE_FLOOR + BASE_FLOOR - 0.6
        for l0, l1 in ((-0.96, -0.4), (-0.32, 0.26), (0.34, 0.96)):
            for ff in (0.3, 0.7):
                _box(bv, ((l1 - l0) * half * 0.85, 0.7, 0.15), (l0 + l1) / 2 * half, back + (c - back) * ff, zt, MI["light_base"], bottom=True)

    mid = (c + back) / 2
    # ---- B1：左、中两间车库（两排车），右间两台冷水机组 + 顶部风管
    z1 = -BASE_FLOOR
    car_cols = ["sofa", "chair", "alu", "panel", "monitor", "pot"]
    for i in range(12):
        l = -half * 0.92 + (i / 11) * half * 1.12
        for f, k in ((mid + 4, 0), (mid - 4.5, 1)):
            if (i + k * 2) % 5 == 4:
                continue
            m = MI[car_cols[(i * 5 + k * 3) % len(car_cols)]]
            _box(bv, (2.0 * K, 4.4 * K, 0.9 * K), l, f, z1 + 0.45 * K, m, bottom=True)  # 车身
            _box(bv, (1.7 * K, 2.4 * K, 0.6 * K), l, f, z1 + 1.15 * K, MI["monitor"])  # 车顶 / 车窗
    for lx in (0.55, 0.82):
        _chiller(bv, lx * half, mid - 2, z1)
    _cyl_l(bv, 0.4, half * 0.6, 0.68 * half, mid + 4, z1 + BASE_FLOOR - 1.6, MI["duct"])
    # ---- B2：左间三台冷水机组 + 管道；中、右间一排配电柜（第 6 台告警，红色自发光）
    z2 = -2 * BASE_FLOOR
    for lx in (-0.88, -0.66, -0.44):
        _chiller(bv, lx * half, mid, z2)
    _cyl_l(bv, 0.45, half * 0.6, -0.68 * half, mid - 4.5, z2 + BASE_FLOOR - 1.8, MI["duct"])
    _cyl_l(bv, 0.3, half * 0.6, -0.68 * half, mid + 4.5, z2 + BASE_FLOOR - 1.4, MI["leaf"])
    for i in range(14):
        lx = (-0.26 + i * 0.085) * half
        if abs(lx - 0.3 * half) < 1.6:
            continue
        alarm = i == 5
        _cabinet(bv, lx, back + 2.2, z2, alarm)
        if i % 3 == 0 and i > 6:
            _cabinet(bv, lx, mid + 3, z2, False)
    # 桥架：配电柜上方一条长线槽
    _box(bv, (half * 1.2, 0.6, 0.2), 0.35 * half, back + 2.2, z2 + BASE_FLOOR - 1.2, MI["alu"], bottom=True)
    # ---- B3：一排卧式水泵 + 立管 + 横管，两个水箱
    z3 = -3 * BASE_FLOOR
    for i in range(8):
        lx = (-0.9 + i * 0.13) * half
        _cyl_l(bv, 0.8 * K, 2.6 * K, lx, mid, z3 + 1.0 * K, MI["ahu"])
        _box(bv, (1.0 * K, 1.4 * K, 0.4 * K), lx, mid, z3 + 0.2 * K, MI["concrete"])  # 基础
        lib.add_cyl(bv, 0.25, BASE_FLOOR - 2.5, (lx, -(mid - 1.2), z3 + 1.0), seg=8, mat=MI["duct"])
    _cyl_l(bv, 0.45, half * 1.05, -0.42 * half, mid - 1.2, z3 + BASE_FLOOR - 1.4, MI["duct"])
    for lx in (0.5, 0.8):
        _box(bv, (6 * K, 6 * K, 4.6 * K), lx * half, mid - 1, z3 + 2.3 * K, MI["alu"])

    ob = lib.new_object(name, bm, M, col)
    ov = lib.new_object(name + "_v", bv, M, col)
    for o in (ob, ov):
        o.location = loc
        o["variant"] = "basement"
    return ob, ov


def _chiller(bv, l, f, z):
    """冷水机组：蓝色机身 + 两个卧式筒体"""
    _box(bv, (6.2 * K, 3.4 * K, 2.6 * K), l, f, z + 1.3 * K, MI["ahu"])
    for df in (-0.9, 0.9):
        _cyl_l(bv, 0.75 * K, 6.4 * K, l, f + df * K, z + 3.1 * K, MI["ahu"])


def _cabinet(bv, l, f, z, alarm):
    """配电柜：浅灰柜体 + 柜门上两条指示灯（告警柜整体红色自发光，照亮周围）"""
    _box(bv, (1.6 * K, 1.2 * K, 3.6 * K), l, f, z + 1.8 * K, MI["alarm" if alarm else "pot"])
    for zz in (2.9, 2.4):
        _box(bv, (0.9 * K, 0.06, 0.14 * K), l, f + 0.63 * K, z + zz * K, MI["alarm_led" if alarm else "led"])

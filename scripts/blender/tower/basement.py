"""
地下机房（B1～B3）建模：底座正面方形剖口里露出的三层机房，烘焙方式同楼层（大面烘贴图、设备烘顶点色）
----------------------------------------------------------
尺寸规则必须与 BuildingScene.js 一致：
  底座半径 R = 塔楼平面最大半径 × BASE_SCALE 2.25；剖口半宽 half = 0.68 R；剖口正面在 f = 0.26 R；机房进深 ROOM_D 20 m；
  地下层高 BASE_FLOOR 13 m（示意比例）。
坐标：剖切坐标系建模——Blender x = l（画面横向，右为正），Blender y = -f（f 朝相机），z = 高度（地面 0，向下为负）。
three.js 里把对象绕竖轴转 camAng（相机方位角），l、f 轴就对上了画面横向和相机方向。
对象：<塔>_basement（楼板、后墙、隔墙、剖面墙，烘贴图）与 <塔>_basement_v（设备、管网、灯具、标线，烘顶点色）。
每层左中右三间（隔墙在 l = -0.36 / 0.3 × half）：
  B1  左、中两间车库；右间两台冷水机组 + 风管
  B2  左间两台冷水机组 + 冷冻 / 冷却水总管；中间一列低压配电柜（第 6 台告警，位置与 BuildingScene._buildBasement 的波纹一致）
      ；右间两台干式变压器 + 一列 UPS 电池柜
  B3  左、中两间一排卧式水泵 + 出水总管；右间两座不锈钢拼装水箱
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
K = 1.7  # 设备尺寸放大系数：13 m 示意层高里按真实尺寸摆设备显得太小，设计稿里设备约占层高四成
KC = 1.3  # 车辆单独一档（车位排两排还要留车道，放不到 K 那么大）
WALLS = (-0.36, 0.3)  # 两道隔墙的位置（× half）
WALL_T = 0.5  # 隔墙厚度：两面贴在一起的单片墙在烘焙里互相遮挡，会烘成全黑


# ---------------------------------------------------------------- 剖切坐标下的基本体


def _p(l, f, z):
    return (l, -f, z)


def _box(bm, size, l, f, z, mat, rot=0.0, bottom=False):
    """盒子：size = (沿 l, 沿 f, 高)，(l, f, z) 为中心"""
    lib.add_box(bm, size, (l, -f, z), rot, mat, bottom)


def _seg(bm, a, b, r, mat, seg=10):
    """两点之间的管子，端点为剖切坐标 (l, f, z)"""
    lib.add_seg(bm, _p(*a), _p(*b), r, mat, seg)


def _pipe(bm, pts, r, mat):
    """折线管道：每段一根圆柱，拐角处一个弯头（略粗的方块）"""
    for a, b in zip(pts, pts[1:]):
        _seg(bm, a, b, r, mat)
    for p in pts[1:-1]:
        _box(bm, (r * 2.3, r * 2.3, r * 2.3), *p, mat, bottom=True)


def _flange(bm, p, axis, r, mat=None):
    """法兰：管道上一圈略粗的短圆柱；axis 为 'l' / 'f' / 'z'"""
    l, f, z = p
    d = {"l": (0.08, 0, 0), "f": (0, 0.08, 0), "z": (0, 0, 0.08)}[axis]
    _seg(bm, (l - d[0], f - d[1], z - d[2]), (l + d[0], f + d[1], z + d[2]), r * 1.45, MI["steel"] if mat is None else mat, 12)


def _valve(bm, p, r):
    """竖管上的闸阀：阀体（略粗方块）+ 阀杆 + 红色手轮（水平圆盘，朝外伸出）"""
    l, f, z = p
    _box(bm, (r * 2.6, r * 2.6, r * 2.2), l, f, z, MI["steel"], bottom=True)
    _seg(bm, (l, f, z), (l, f + r * 2.8, z), 0.05, MI["alu"], 6)
    _seg(bm, (l, f + r * 2.8, z), (l, f + r * 2.8 + 0.06, z), 0.42, MI["red"], 14)


def _gauge(bm, p):
    """压力表：短接管 + 朝相机的白色表盘（黑边）"""
    l, f, z = p
    _seg(bm, (l, f, z), (l, f, z + 0.35), 0.04, MI["alu"], 6)
    _seg(bm, (l, f - 0.05, z + 0.5), (l, f + 0.07, z + 0.5), 0.2, MI["monitor"], 12)
    _seg(bm, (l, f + 0.07, z + 0.5), (l, f + 0.09, z + 0.5), 0.16, MI["pot"], 12)


def _hangers(bm, l0, l1, f, z, z_ceil, step=4.0):
    """吊杆：沿 l 方向的管道 / 桥架每隔 step 米一根细杆吊到天花"""
    n = max(1, int(abs(l1 - l0) / step))
    for i in range(n + 1):
        l = l0 + (l1 - l0) * i / n
        _box(bm, (0.06, 0.06, z_ceil - z), l, f, (z + z_ceil) / 2, MI["alu"], bottom=True)


def _floor_rect(bm, l0, l1, f0, f1, z, mat="yellow", w=0.16):
    """地面安全线：一个矩形框（贴地细条）"""
    for f in (f0, f1):
        _box(bm, (l1 - l0 + w, w, 0.03), (l0 + l1) / 2, f, z + 0.015, MI[mat])
    for l in (l0, l1):
        _box(bm, (w, f1 - f0, 0.03), l, (f0 + f1) / 2, z + 0.015, MI[mat])


# ---------------------------------------------------------------- 主体


def build(name, radius, M, col, loc):
    R = radius * BASE_SCALE
    half = NOTCH_HALF * R
    c = NOTCH_FRONT * R
    back = c - ROOM_D
    depth = 3 * BASE_FLOOR
    mid = (c + back) / 2
    rnd = random.Random(5)
    bm = bmesh.new()  # 大面：烘贴图
    bv = bmesh.new()  # 设备：烘顶点色
    walls = [k * half for k in WALLS]
    # 三间的横向范围（扣掉隔墙厚度）
    rooms = [(-half, walls[0] - WALL_T / 2), (walls[0] + WALL_T / 2, walls[1] - WALL_T / 2), (walls[1] + WALL_T / 2, half)]

    def quad(target, pts, mat, n):
        """四边形；n 为期望的法线方向（剖切坐标 l, f, z），绕向不对就翻过来"""
        from mathutils import Vector

        p = [Vector((l, -f, z)) for l, f, z in pts]
        want = Vector((n[0], -n[1], n[2]))
        if (p[1] - p[0]).cross(p[2] - p[1]).dot(want) < 0:
            p.reverse()
        target.faces.new([target.verts.new(v) for v in p]).material_index = mat

    # ---- 每层地面（B1 车库地坪、B2 / B3 环氧地坪）、剖口上露出的楼板厚边、天花（上一层楼板底面）
    for b in range(1, 4):
        z = -b * BASE_FLOOR
        fl = MI["garage" if b == 1 else "epoxy"]
        quad(bm, [(-half, back, z), (half, back, z), (half, c, z), (-half, c, z)], fl, (0, 0, 1))
        quad(bv, [(-half, c, z), (half, c, z), (half, c, z - 0.8), (-half, c, z - 0.8)], MI["slab_edge"], (0, 1, 0))
        zc = z + BASE_FLOOR - 0.02
        quad(bm, [(-half, back, zc), (-half, c, zc), (half, c, zc), (half, back, zc)], MI["ceiling"], (0, 0, -1))
        # 后墙：下部 1.8 m 深色墙裙 + 上部混凝土
        zl = z + 1.8 * K
        quad(bm, [(-half, back, z), (half, back, z), (half, back, zl), (-half, back, zl)], MI["wall_low"], (0, 1, 0))
        quad(bm, [(-half, back, zl), (half, back, zl), (half, back, z + BASE_FLOOR), (-half, back, z + BASE_FLOOR)], MI["concrete"], (0, 1, 0))
    # ---- 两道隔墙：有厚度的实墙（剖口正面露出混凝土断面）
    for lx in walls:
        _box(bm, (WALL_T, ROOM_D, depth), lx, mid, -depth / 2, MI["concrete"], bottom=False)
    # 剖面墙：底座实体被切开的断面，朝向剖口内侧
    f_out = math.sqrt(R * R - half * half)
    for s in (-1, 1):
        lx = s * half
        quad(bm, [(lx, back, -depth), (lx, f_out, -depth), (lx, f_out, 0), (lx, back, 0)], MI["concrete"], (-s, 0, 0))

    for b in range(1, 4):
        z = -b * BASE_FLOOR
        zc = z + BASE_FLOOR
        # ---- 天花：沿 l 的三道结构梁（灯管在梁之间）+ 红色消防喷淋主管
        for ff in (0.12, 0.5, 0.88):
            _box(bv, (2 * half, 0.6, 0.9), 0, back + (c - back) * ff, zc - 0.45, MI["concrete"], bottom=True)
        for l0, l1 in rooms:
            _seg(bv, (l0 + 0.3, back + (c - back) * 0.62, zc - 1.2), (l1 - 0.3, back + (c - back) * 0.62, zc - 1.2), 0.1, MI["pipe_r"], 8)
            # ---- 灯具：每间两排灯管（铝壳 + 发光管 + 吊杆）
            for ff in (0.3, 0.7):
                fl = back + (c - back) * ff
                w = (l1 - l0) * 0.85
                lm = (l0 + l1) / 2
                _box(bv, (w, 0.75, 0.16), lm, fl, zc - 0.62, MI["alu"])
                _box(bv, (w * 0.98, 0.5, 0.06), lm, fl, zc - 0.72, MI["light_base"], bottom=True)
                for t in (-0.4, 0.0, 0.4):
                    _box(bv, (0.05, 0.05, 0.55), lm + t * w, fl, zc - 0.27, MI["alu"], bottom=True)
            # ---- 后墙：每间一樘双开钢门 + 安全出口灯 + 红色消火栓箱
            dm = l0 + (l1 - l0) * 0.25
            _box(bv, (2.4 * K, 0.12, 2.4 * K), dm, back + 0.06, z + 1.2 * K, MI["steel"])
            _box(bv, (0.05, 0.14, 2.3 * K), dm, back + 0.08, z + 1.15 * K, MI["monitor"])
            _box(bv, (0.9, 0.1, 0.35), dm, back + 0.08, z + 2.6 * K, MI["exit"])
            hm = l0 + (l1 - l0) * 0.08
            _box(bv, (1.0 * K, 0.3, 1.4 * K), hm, back + 0.15, z + 1.3 * K, MI["red"])
            _box(bv, (0.8 * K, 0.04, 0.9 * K), hm, back + 0.31, z + 1.3 * K, MI["car_glass"])

    # ---- B1：左、中两间车库，右间两台冷水机组 + 顶部风管
    z1 = -BASE_FLOOR
    car_cols = ["sofa", "chair", "alu", "panel", "monitor", "pot", "pipe_b", "bmu"]
    k = 0
    for l0, l1 in rooms[:2]:
        n = int((l1 - l0 - 2) / (2.6 * KC))
        for i in range(n):
            l = l0 + 1 + (i + 0.5) * (l1 - l0 - 2) / n
            for f, face in ((mid + 5.6, 1), (mid - 5.8, -1)):
                # 车位线（白）
                _box(bv, (0.12, 5.6, 0.03), l - 1.3 * KC, f, z1 + 0.015, MI["white_line"])
                k += 1
                if rnd.random() < 0.18:
                    continue
                _car(bv, l, f, z1, MI[car_cols[(k * 5) % len(car_cols)]], face)
        # 行车道中线（黄色虚线）
        for t in range(int((l1 - l0) / 3)):
            _box(bv, (1.6, 0.16, 0.03), l0 + 1.5 + t * 3, mid, z1 + 0.015, MI["yellow"])
    l0, l1 = rooms[2]
    ck = min(K, (l1 - l0 - 3.0) / (2 * 7.42))
    xs = [l0 + 1.0 + 3.35 * ck + i * ((l1 - l0) - 2.0 - 7.42 * ck) for i in range(2)]
    for lx in xs:
        _chiller(bv, lx, mid - 2, z1, ck)
    _floor_rect(bv, l0 + 0.6, l1 - 0.6, mid - 2 - 3.2 * ck, mid - 2 + 3.2 * ck, z1)
    _headers(bv, l0, l1, mid - 2, z1, xs, ck)
    # 风管：方形送风管 + 吊杆
    _box(bv, (l1 - l0 - 1.0, 1.4, 1.0), (l0 + l1) / 2, mid + 5.5, z1 + BASE_FLOOR - 2.4, MI["duct"], bottom=True)
    _hangers(bv, l0 + 1, l1 - 1, mid + 5.5, z1 + BASE_FLOOR - 1.9, z1 + BASE_FLOOR - 0.9)

    # ---- B2：左间两台冷水机组；中间一列配电柜（第 6 台告警）；右间两台变压器 + UPS 电池柜
    z2 = -2 * BASE_FLOOR
    l0, l1 = rooms[0]
    # 机组从左端 -3.35 s 到竖管 +4.07 s：28 m 宽的左间排两台
    ck = min(K, (l1 - l0 - 3.0) / (2 * 7.42))
    xs = [l0 + 1.0 + 3.35 * ck + i * ((l1 - l0) - 2.0 - 7.42 * ck) for i in range(2)]
    for lx in xs:
        _chiller(bv, lx, mid, z2, ck)
    _floor_rect(bv, l0 + 0.6, l1 - 0.6, mid - 3.2 * ck, mid + 3.2 * ck, z2)
    _headers(bv, l0, l1, mid, z2, xs, ck)
    # 低压配电柜：告警柜在 l = (-0.26 + 5 × 0.085) × half、f = back + 2.2（与 BuildingScene 的告警波纹位置一致）
    la = (-0.26 + 5 * 0.085) * half
    cw = 1.55 * K
    l0, l1 = rooms[1]
    lineup = [la + j * cw for j in range(-7, 3) if l0 + 1.5 < la + j * cw < l1 - 1.5]
    for j, lx in enumerate(lineup):
        _cabinet(bv, lx, back + 2.2, z2, abs(lx - la) < 0.01, rnd)
    _tray(bv, lineup[0] - cw / 2, lineup[-1] + cw / 2, back + 2.2, z2, lineup)
    _floor_rect(bv, lineup[0] - cw / 2 - 0.6, lineup[-1] + cw / 2 + 0.6, back + 1.2, back + 4.6, z2)
    l0, l1 = rooms[2]
    for lx in (l0 + 4.5, l0 + 11.0):
        _transformer(bv, lx, mid + 1, z2)
    _floor_rect(bv, l0 + 1.4, l0 + 14.4, mid + 1 - 2.2 * K, mid + 1 + 2.2 * K, z2)
    # 靠后墙一列 UPS 电池柜（深色，绿色运行灯）
    lineup2 = [l0 + 17 + j * 1.3 * K for j in range(int((l1 - l0 - 19) / (1.3 * K)))]
    for lx in lineup2:
        _box(bv, (1.25 * K, 1.0 * K, 3.0 * K), lx, back + 2.2, z2 + 1.5 * K, MI["monitor"])
        for zz in (2.6, 2.1, 1.6, 1.1):
            _box(bv, (0.8 * K, 0.04, 0.05 * K), lx, back + 2.2 + 0.51 * K, z2 + zz * K, MI["led"])
    _tray(bv, lineup2[0] - 0.65 * K, lineup2[-1] + 0.65 * K, back + 2.2, z2, lineup2, 3.0 * K)
    _floor_rect(bv, lineup2[0] - 1.4, lineup2[-1] + 1.4, back + 1.0, back + 4.2, z2)
    # 变压器到配电柜的母线槽
    zb = z2 + BASE_FLOOR - 2.0
    lb = lineup2[0] - 0.65 * K - 1.0
    _box(bv, (lb - l0 - 4.2, 0.7, 0.5), (l0 + 4.5 + lb) / 2, mid + 1, zb, MI["steel"], bottom=True)
    _box(bv, (0.7, mid + 1.35 - back - 2.2, 0.5), lb, (mid + 1 + back + 2.2) / 2, zb, MI["steel"], bottom=True)

    # ---- B3：左、中两间一排卧式水泵 + 出水总管；右间两座拼装水箱
    z3 = -3 * BASE_FLOOR
    for l0, l1 in rooms[:2]:
        usable = l1 - l0 - 4 - 4.2 * K  # 两端各留 2 m，扣掉一台基础长度
        n = int(usable / (5.0 * K)) + 1
        xs = [l0 + 2 + 2.1 * K + i * usable / max(1, n - 1) for i in range(n)]
        zh = z3 + BASE_FLOOR - 1.8
        for lx in xs:
            _pump(bv, lx, mid, z3, zh)
        _seg(bv, (l0 + 0.6, mid - 1.2, zh), (l1 - 0.6, mid - 1.2, zh), 0.5, MI["pipe_b"], 14)
        _seg(bv, (l0 + 0.6, mid - 2.4, z3 + 0.6 * K), (l1 - 0.6, mid - 2.4, z3 + 0.6 * K), 0.45, MI["pipe_g"], 14)
        for lx in xs:
            _flange(bv, (lx, mid - 1.2, zh), "l", 0.5)
        _hangers(bv, l0 + 1, l1 - 1, mid - 1.2, zh + 0.5, z3 + BASE_FLOOR - 0.9)
        _floor_rect(bv, l0 + 1.0, l1 - 1.0, mid - 3.2, mid + 1.6, z3)
    l0, l1 = rooms[2]
    for lx in (0.5, 0.8):
        _tank(bv, lx * half, mid - 1, z3)

    ob = lib.new_object(name, bm, M, col)
    ov = lib.new_object(name + "_v", bv, M, col)
    for o in (ob, ov):
        o.location = loc
        o["variant"] = "basement"
    return ob, ov


# ---------------------------------------------------------------- 设备


def _car(bv, l, f, z, body, face, K=KC):
    """轿车（车头朝 face 方向）：底盘车身 + 收窄的玻璃车厢 + 车顶 + 四个轮子 + 车灯"""
    _box(bv, (1.9 * K, 4.5 * K, 0.7 * K), l, f, z + 0.55 * K, body)
    _box(bv, (1.7 * K, 2.4 * K, 0.55 * K), l, f - face * 0.25 * K, z + 1.18 * K, MI["car_glass"])
    _box(bv, (1.6 * K, 2.0 * K, 0.08 * K), l, f - face * 0.25 * K, z + 1.48 * K, body)
    for s in (-1, 1):
        for t in (-1.45, 1.45):
            ll, ff = l + s * 0.85 * K, f + t * K
            _seg(bv, (ll - 0.13 * K, ff, z + 0.33 * K), (ll + 0.13 * K, ff, z + 0.33 * K), 0.33 * K, MI["tire"], 10)
        # 车灯：车头白、车尾红
        _box(bv, (0.35 * K, 0.06, 0.12 * K), l + s * 0.6 * K, f + face * 2.26 * K, z + 0.72 * K, MI["pot"])
        _box(bv, (0.35 * K, 0.06, 0.12 * K), l + s * 0.6 * K, f - face * 2.26 * K, z + 0.72 * K, MI["red"])


def _chiller(bv, l, f, z, K=K):
    """
    离心式冷水机组（轴线沿 l）：混凝土基础 + 钢底座、前后两个卧式筒体（蒸发器 / 冷凝器）+ 两端水室、
    筒体上方蓝色压缩机机壳 + 电机、一端控制柜（带屏幕）；水室端头接出两根竖管（阀门、压力表）上到天花总管
    """
    _box(bv, (7.0 * K, 3.8 * K, 0.3 * K), l, f, z + 0.15 * K, MI["concrete"])
    for df in (-0.85, 0.85):
        ff = f + df * K
        for t in (-2.2, 0, 2.2):
            _box(bv, (0.3 * K, 1.1 * K, 0.6 * K), l + t * K, ff, z + 0.6 * K, MI["steel"])
        _seg(bv, (l - 3.0 * K, ff, z + 1.25 * K), (l + 3.0 * K, ff, z + 1.25 * K), 0.72 * K, MI["ahu"], 18)
        for s in (-1, 1):  # 水室
            _seg(bv, (l + s * 3.0 * K, ff, z + 1.25 * K), (l + s * 3.35 * K, ff, z + 1.25 * K), 0.8 * K, MI["pipe_b"], 18)
            _flange(bv, (l + s * 3.0 * K, ff, z + 1.25 * K), "l", 0.72 * K)
    # 压缩机机壳（设计稿里方正的蓝色机身）+ 电机
    _box(bv, (5.2 * K, 2.6 * K, 1.3 * K), l - 0.3 * K, f, z + 2.6 * K, MI["ahu"])
    _box(bv, (5.24 * K, 2.64 * K, 0.08 * K), l - 0.3 * K, f, z + 3.2 * K, MI["steel"])
    _seg(bv, (l - 1.6 * K, f, z + 3.6 * K), (l + 0.6 * K, f, z + 3.6 * K), 0.5 * K, MI["ahu"], 16)
    _seg(bv, (l + 0.6 * K, f, z + 3.6 * K), (l + 1.8 * K, f, z + 3.6 * K), 0.42 * K, MI["steel"], 14)
    # 控制柜（朝相机一面有屏幕）
    cl = l - 3.0 * K
    _box(bv, (0.9 * K, 0.6 * K, 1.7 * K), cl, f + 1.9 * K, z + 1.15 * K, MI["pot"])
    _box(bv, (0.45 * K, 0.04, 0.3 * K), cl, f + 2.21 * K, z + 1.55 * K, MI["screen"])
    _box(bv, (0.12 * K, 0.04, 0.05 * K), cl - 0.2 * K, f + 2.21 * K, z + 1.25 * K, MI["led"])
    # 水室接出的竖管：冷冻水（蓝）在前、冷却水（绿）在后
    top = z + BASE_FLOOR - 1.6
    for df, mat in ((0.85, "pipe_b"), (-0.85, "pipe_g")):
        ff = f + df * K
        lx = l + 3.75 * K
        _pipe(bv, [(l + 3.35 * K, ff, z + 1.25 * K), (lx, ff, z + 1.25 * K), (lx, ff, top)], 0.32 * K, MI[mat])
        _valve(bv, (lx, ff, z + 2.9 * K), 0.32 * K)
        _flange(bv, (lx, ff, z + 2.4 * K), "z", 0.32 * K)
        _flange(bv, (lx, ff, z + 3.4 * K), "z", 0.32 * K)
        _gauge(bv, (lx + 0.45 * K, ff, z + 3.8 * K))


def _headers(bv, l0, l1, f, z, xs, K=K):
    """冷水机组上方的两根总管（沿 l，冷冻水蓝 / 冷却水绿），竖管在 xs 处接入；带吊杆"""
    top = z + BASE_FLOOR - 1.6
    for df, mat in ((0.85, "pipe_b"), (-0.85, "pipe_g")):
        ff = f + df * K
        _seg(bv, (l0 + 0.6, ff, top), (l1 - 0.6, ff, top), 0.4 * K, MI[mat], 14)
        for lx in xs:
            _flange(bv, (lx + 3.75 * K, ff, top), "l", 0.4 * K)
        _hangers(bv, l0 + 1, l1 - 1, ff, top + 0.5 * K, z + BASE_FLOOR - 0.9)


def _cabinet(bv, l, f, z, alarm, rnd):
    """
    低压配电柜（正面朝相机）：柜体 + 深色底座 + 顶盖，正面两扇门（中缝、把手）、仪表窗、
    三个指示灯、底部百叶；告警柜整体红色自发光，照亮周围
    """
    w, d, h = 1.5 * K, 1.1 * K, 3.4 * K
    ff = f + d / 2 + 0.02
    _box(bv, (w, d, 0.15 * K), l, f, z + 0.075 * K, MI["monitor"])
    _box(bv, (w, d, h - 0.25 * K), l, f, z + 0.15 * K + (h - 0.25 * K) / 2, MI["alarm" if alarm else "pot"])
    _box(bv, (w + 0.04, d + 0.04, 0.1 * K), l, f, z + h - 0.05 * K, MI["alu"])
    _box(bv, (0.04, 0.04, h - 0.6 * K), l, ff, z + h / 2, MI["monitor"])  # 门中缝
    for s in (-1, 1):
        _box(bv, (0.05, 0.06, 0.35 * K), l + s * 0.12 * K, ff + 0.02, z + 1.7 * K, MI["alu"])  # 把手
    if not alarm:
        _box(bv, (0.5 * K, 0.04, 0.3 * K), l - 0.35 * K, ff, z + 2.7 * K, MI["screen" if rnd.random() < 0.5 else "monitor"])
    for t in (-0.4, 0, 0.4):
        _box(bv, (0.1 * K, 0.04, 0.1 * K), l + 0.25 * K + t * 0.4 * K, ff, z + 2.75 * K, MI["alarm_led" if alarm else "led"])
    for zz in (0.35, 0.5, 0.65):
        _box(bv, (w * 0.7, 0.04, 0.04 * K), l, ff, z + zz * K, MI["monitor"])


def _tray(bv, l0, l1, f, z, xs, top=3.4 * K):
    """电缆桥架（梯架：两侧边梁 + 横档 + 黑色电缆束），每隔一台柜子一束电缆垂到柜顶"""
    zt = z + BASE_FLOOR - 2.2
    for s in (-1, 1):
        _box(bv, (l1 - l0, 0.06, 0.25), (l0 + l1) / 2, f + s * 0.5, zt, MI["alu"], bottom=True)
    n = int((l1 - l0) / 0.6)
    for i in range(n + 1):
        _box(bv, (0.05, 1.0, 0.05), l0 + (l1 - l0) * i / n, f, zt - 0.1, MI["alu"], bottom=True)
    _box(bv, (l1 - l0, 0.7, 0.18), (l0 + l1) / 2, f, zt, MI["tire"], bottom=True)
    for i, lx in enumerate(xs):
        if i % 2 == 0:
            _box(bv, (0.35, 0.35, zt - (z + top)), lx, f, (zt + z + top) / 2, MI["tire"], bottom=True)
    _hangers(bv, l0 + 0.5, l1 - 0.5, f, zt + 0.12, z + BASE_FLOOR - 0.9, 3.0)


def _transformer(bv, l, f, z):
    """干式变压器（金属网罩外壳）：灰色箱体 + 正面竖向百叶 + 黄色警示带 + 顶部母线出线"""
    w, d, h = 3.2 * K, 2.2 * K, 3.0 * K
    _box(bv, (w + 0.3, d + 0.3, 0.2 * K), l, f, z + 0.1 * K, MI["steel"])
    _box(bv, (w, d, h), l, f, z + 0.2 * K + h / 2, MI["alu"])
    for i in range(9):
        _box(bv, (0.08, 0.04, h * 0.7), l - w * 0.4 + i * w * 0.1, f + d / 2 + 0.02, z + 0.2 * K + h * 0.5, MI["steel"])
    _box(bv, (w * 0.9, 0.04, 0.12 * K), l, f + d / 2 + 0.03, z + 0.2 * K + h * 0.9, MI["yellow"])
    _box(bv, (0.6, 0.6, BASE_FLOOR - 2.3 - h), l, f, z + 0.2 * K + h + (BASE_FLOOR - 2.3 - h) / 2 - 0.1, MI["steel"], bottom=True)


def _pump(bv, l, f, z, zh):
    """
    卧式离心泵（轴线沿 l）：混凝土基础 + 钢底座、电机（带散热筋和尾罩）、黄色联轴器护罩、泵壳；
    泵出口竖管（闸阀、止回阀、压力表）接到上方出水总管，进口接后方地面进水管
    """
    _box(bv, (4.2 * K, 1.8 * K, 0.3 * K), l, f, z + 0.15 * K, MI["concrete"])
    _box(bv, (3.8 * K, 1.2 * K, 0.18 * K), l, f, z + 0.39 * K, MI["steel"])
    zc = z + 1.0 * K
    _seg(bv, (l - 1.9 * K, f, zc), (l - 0.2 * K, f, zc), 0.5 * K, MI["ahu"], 18)
    for t in range(5):  # 电机散热筋
        lx = l - 1.75 * K + t * 0.35 * K
        _seg(bv, (lx - 0.04, f, zc), (lx + 0.04, f, zc), 0.55 * K, MI["ahu"], 18)
    _seg(bv, (l - 2.15 * K, f, zc), (l - 1.9 * K, f, zc), 0.42 * K, MI["steel"], 14)
    _box(bv, (0.6 * K, 0.7 * K, 0.6 * K), l + 0.1 * K, f, zc, MI["yellow"])
    _seg(bv, (l + 0.5 * K, f - 0.25 * K, zc), (l + 0.5 * K, f + 0.25 * K, zc), 0.6 * K, MI["pipe_b"], 18)
    _seg(bv, (l + 0.5 * K, f, zc), (l + 1.4 * K, f, zc), 0.28 * K, MI["pipe_b"], 12)
    # 出口：竖管上到总管（总管在 f - 1.2）
    lx = l + 1.4 * K
    _pipe(bv, [(lx, f, zc), (lx, f, zh - 0.9), (lx, f - 1.2, zh - 0.9), (lx, f - 1.2, zh)], 0.25 * K, MI["pipe_b"])
    _valve(bv, (lx, f, zc + 1.4 * K), 0.25 * K)
    _box(bv, (0.7 * K, 0.7 * K, 0.5 * K), lx, f, zc + 2.4 * K, MI["steel"], bottom=True)  # 止回阀
    _flange(bv, (lx, f, zc + 0.8 * K), "z", 0.25 * K)
    _flange(bv, (lx, f, zc + 3.0 * K), "z", 0.25 * K)
    _gauge(bv, (lx + 0.35 * K, f, zc + 3.4 * K))
    # 进口：泵壳朝后接地面进水管（总管在 f - 2.4，贴地）
    _pipe(bv, [(l + 0.5 * K, f - 0.25 * K, zc), (l + 0.5 * K, f - 2.4, zc), (l + 0.5 * K, f - 2.4, z + 0.6 * K)], 0.3 * K, MI["pipe_g"])
    _flange(bv, (l + 0.5 * K, f - 1.3, zc), "f", 0.3 * K)


def _tank(bv, l, f, z):
    """不锈钢拼装水箱：箱体 + 1 m 一格的拼缝筋 + 钢底座 + 侧面爬梯 + 顶部人孔与进水管"""
    w, d, h = 6 * K, 6 * K, 4.6 * K
    zb = z + 0.5
    _box(bv, (w + 0.4, d + 0.4, 0.5), l, f, z + 0.25, MI["steel"])
    _box(bv, (w, d, h), l, f, zb + h / 2, MI["alu"])
    n = int(w / 1.3)
    for i in range(1, n):  # 竖向拼缝
        t = -w / 2 + i * w / n
        _box(bv, (0.08, d + 0.08, h), l + t, f, zb + h / 2, MI["duct"])
        _box(bv, (w + 0.08, 0.08, h), l, f + t, zb + h / 2, MI["duct"])
    for j in range(1, int(h / 1.3) + 1):  # 横向拼缝
        _box(bv, (w + 0.1, d + 0.1, 0.08), l, f, zb + j * h / (int(h / 1.3) + 1), MI["duct"])
    # 爬梯（正面右侧）
    for s in (-0.3, 0.3):
        _box(bv, (0.06, 0.06, h + 1.0), l + w / 2 - 1.0 + s, f + d / 2 + 0.3, zb + (h + 1.0) / 2, MI["yellow"])
    for j in range(int(h / 0.4)):
        _box(bv, (0.6, 0.05, 0.05), l + w / 2 - 1.0, f + d / 2 + 0.3, zb + 0.3 + j * 0.4, MI["yellow"])
    # 人孔 + 进水管
    lib.add_cyl(bv, 0.45, 0.25, (l - 1.0, -f, zb + h), seg=12, mat=MI["steel"])
    _pipe(bv, [(l + 1.2, f - 1.0, zb + h), (l + 1.2, f - 1.0, z + BASE_FLOOR - 1.4)], 0.25 * K, MI["pipe_g"])
    _valve(bv, (l + 1.2, f - 1.0, zb + h + 1.2), 0.25 * K)

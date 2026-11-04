"""青原露天矿 · 设备模型（bmesh 拼的低面数模型，局部坐标：+Y 朝前 / 吊臂方向，+Z 向上，原点在地面中心）。

尺寸比真实的大（电铲 ×2.6、卡车 ×3.2、塔架 ×1.6…）：设计稿里设备是放大到看得见的，总览镜头离坑 3.5 km，真实尺寸只有几个像素。
每台设备一个物体、一个材质列表，物体名就是设备编号（ES-04、CR-01…），three.js 按名字找。
发光件（窗、灯、边线）用单独的自发光材质，烘焙后保留。
"""
import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

from . import materials as M

# 放大倍数
SC = {"shovel": 4.2, "truck": 4.6, "crusher": 3.2, "bw": 3.0, "tower": 2.0, "swap": 3.0, "plant": 1.25}


class Builder:
    """把若干部件拼进同一个 bmesh，最后生成一个物体"""

    def __init__(self):
        self.bm = bmesh.new()
        self.mats = []

    def _mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def _tag(self, verts, mat):
        mi = self._mi(mat)
        faces = {f for v in verts for f in v.link_faces}
        for f in faces:
            f.material_index = mi

    def box(self, size, center, mat, rot=(0, 0, 0)):
        r = bmesh.ops.create_cube(self.bm, size=1.0)
        v = r["verts"]
        m = Matrix.Translation(center) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((*size, 1.0))
        bmesh.ops.transform(self.bm, matrix=m, verts=v)
        self._tag(v, mat)
        return v

    def cyl(self, r, h, center, mat, axis="Z", seg=20, r2=None, rot=None):
        r_ = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
        v = r_["verts"]
        R = {"Z": Euler((0, 0, 0)), "X": Euler((0, np.pi / 2, 0)), "Y": Euler((np.pi / 2, 0, 0))}[axis].to_matrix().to_4x4()
        if rot is not None:
            R = Euler(rot).to_matrix().to_4x4() @ R
        bmesh.ops.transform(self.bm, matrix=Matrix.Translation(center) @ R, verts=v)
        self._tag(v, mat)
        return v

    def beam(self, p0, p1, thick, mat):
        """两点之间的一根方梁"""
        a, b = Vector(p0), Vector(p1)
        d = b - a
        q = d.to_track_quat("Y", "Z")
        r = bmesh.ops.create_cube(self.bm, size=1.0)
        v = r["verts"]
        m = Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4() @ Matrix.Diagonal((thick, d.length, thick, 1.0))
        bmesh.ops.transform(self.bm, matrix=m, verts=v)
        self._tag(v, mat)
        return v

    def lathe(self, profile, mat, seg=40, center=(0, 0, 0)):
        """绕 Z 轴旋转 (r, z) 轮廓得到的壳（冷却塔等）"""
        rings = []
        for r, z in profile:
            rings.append([self.bm.verts.new((center[0] + r * np.cos(t), center[1] + r * np.sin(t), center[2] + z)) for t in np.linspace(0, 2 * np.pi, seg, endpoint=False)])
        faces = []
        for i in range(len(rings) - 1):
            for j in range(seg):
                f = self.bm.faces.new((rings[i][j], rings[i][(j + 1) % seg], rings[i + 1][(j + 1) % seg], rings[i + 1][j]))
                f.material_index = self._mi(mat)
                faces.append(f)
        return faces

    def finish(self, name, col, loc=(0, 0, 0), yaw=0.0, scale=1.0):
        me = bpy.data.meshes.new(name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces[:])
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        o = bpy.data.objects.new(name, me)
        col.objects.link(o)
        o.location = loc
        o.rotation_euler = (0, 0, yaw)
        o.scale = (scale, scale, scale)
        return o


def palette():
    """设备用的材质（一次建好，各模型共用）"""
    return {
        "steel": M.plain("op_steel", (0.2, 0.33, 0.46), 0.55, 0.2, emit=(0.05, 0.25, 0.35), emit_strength=0.5),
        "dark": M.plain("op_dark", (0.06, 0.1, 0.14), 0.7, 0.2),
        "white": M.plain("op_white", (0.62, 0.7, 0.76), 0.5, 0.2),
        "cyan": M.emissive("op_cyan", (0.1, 0.8, 1.0), 2.2),
        "amber": M.emissive("op_amber", (1.0, 0.55, 0.12), 4.0),
        "red": M.emissive("op_red", (1.0, 0.18, 0.2), 0.9),
        "coal": M.plain("op_coalpile", (0.02, 0.02, 0.025), 0.9),
        "concrete": M.plain("op_concrete", (0.2, 0.26, 0.31), 0.8),
        "glass": M.emissive("op_glass", (0.45, 0.8, 0.95), 0.7, base=(0.1, 0.2, 0.25)),
        "pv": M.plain("op_pv", (0.02, 0.07, 0.3), 0.25, 0.4, emit=(0.05, 0.2, 0.9), emit_strength=0.5),
        # equip.py 的设备：工程机械的黄（压暗，夜里不刺眼）、基站信标（页面按在线 / 离线改色）、水面、土埂
        "ochre": M.plain("op_ochre", (0.42, 0.3, 0.07), 0.6, 0.1, emit=(0.5, 0.32, 0.06), emit_strength=0.12),
        "signal": M.emissive("op_signal", (0.1, 0.8, 1.0), 2.5),
        "water": M.emissive("op_water", (0.05, 0.32, 0.45), 0.7, base=(0.02, 0.06, 0.1)),
        "dump": M.plain("op_berm", (0.12, 0.13, 0.15), 0.95),
    }


# ----------------------------------------------------------------------------- 各设备


def shovel(P, name, col, loc, yaw):
    """电铲：履带底盘 + 机房 + 驾驶室 + 吊臂（斜指向 +Y）+ 铲斗 + 工作灯"""
    b = Builder()
    b.box((18, 12, 3), (0, 0, 1.5), P["dark"])  # 履带
    b.box((7, 14, 3), (-9, 0, 1.5), P["steel"])
    b.box((7, 14, 3), (9, 0, 1.5), P["steel"])
    b.box((13, 12, 7), (0, -1, 6.5), P["steel"])  # 机房
    b.box((5, 5, 4), (3.5, 4.5, 11), P["steel"])  # 驾驶室
    b.box((4.2, 0.4, 2.2), (3.5, 7.1, 11.2), P["cyan"])  # 驾驶室窗
    b.beam((0, -3, 10), (0, -3, 21), 1.4, P["steel"])  # A 形架
    b.beam((0, 2, 8), (0, 30, 18), 1.6, P["steel"])  # 吊臂
    b.beam((-1.4, 2, 8), (-1.4, 30, 18), 0.4, P["cyan"])
    b.beam((0, -3, 21), (0, 30, 18), 0.3, P["white"])  # 拉索
    b.box((5, 4, 3.5), (0, 31, 12), P["steel"])  # 铲斗
    b.box((5.4, 0.5, 1.2), (0, 33, 11.5), P["amber"])  # 斗齿处的暖光
    b.box((3, 3, 1), (-4, 6, 11), P["amber"])  # 工作灯
    return b.finish(name, col, loc, yaw, SC["shovel"])


def truck(P, name, col, loc=(0, 0, 0), yaw=0.0):
    """无人矿卡（无驾驶室）：车架 + 车斗 + 四个轮 + 车灯；实例化用，页面里复制 100 份"""
    b = Builder()
    b.box((3.4, 7.4, 1.0), (0, 0, 1.7), P["steel"])  # 车架
    b.box((3.6, 5.2, 1.4), (0, -0.6, 3.3), P["white"], rot=(0.14, 0, 0))  # 车斗
    b.box((3.6, 0.5, 1.2), (0, 3.4, 3.0), P["white"])  # 车斗前挡板
    for sx in (-1.55, 1.55):
        for y in (-2.4, 2.4):
            b.cyl(1.15, 0.8, (sx, y, 1.15), P["dark"], axis="X", seg=14)
    b.box((2.4, 0.3, 0.3), (0, 3.9, 2.0), P["cyan"])  # 前灯带
    b.box((2.0, 0.2, 0.2), (0, -3.8, 2.0), P["red"])  # 尾灯
    return b.finish(name, col, loc, yaw, SC["truck"])


def crusher(P, name, col, loc, yaw):
    """半移动破碎站：钢架 + 破碎机体 + 受料斗 + 出料皮带"""
    b = Builder()
    b.box((16, 22, 3), (0, 0, 1.5), P["dark"])
    b.box((12, 12, 14), (0, -2, 10), P["steel"])  # 机体
    b.box((14, 8, 6), (0, 11, 9), P["steel"], rot=(-0.35, 0, 0))  # 受料斗
    b.beam((0, -6, 12), (0, -34, 20), 3.2, P["steel"])  # 出料皮带架
    b.beam((0, -6, 13.8), (0, -34, 21.8), 1.0, P["cyan"])
    b.box((3, 0.4, 3), (6.1, -2, 12), P["glass"])
    b.box((2, 2, 1), (-4, 3, 17.5), P["amber"])
    return b.finish(name, col, loc, yaw, SC["crusher"])


def bucket_wheel(P, name, col, loc, yaw):
    """轮斗挖掘机：履带 + 机房 + 长悬臂 + 斗轮 + 配重臂"""
    b = Builder()
    b.box((26, 12, 4), (0, 0, 2), P["dark"])
    b.box((12, 12, 10), (0, 0, 9), P["steel"])
    b.beam((0, 0, 12), (0, 52, 20), 3.0, P["steel"])  # 悬臂
    b.beam((0, 0, 14), (0, 52, 22), 0.8, P["cyan"])
    b.cyl(9.0, 1.6, (0, 53, 18), P["steel"], axis="X", seg=24)  # 斗轮
    b.cyl(9.6, 0.5, (0, 53, 18), P["amber"], axis="X", seg=24)
    b.beam((0, 0, 12), (0, -30, 22), 3.0, P["steel"])  # 配重臂
    b.box((8, 8, 6), (0, -32, 20), P["dark"])
    b.beam((0, 0, 20), (0, 52, 20), 0.4, P["white"])
    return b.finish(name, col, loc, yaw, SC["bw"])


def radar_tower(P, name, col, loc):
    """边坡雷达塔：四脚格构塔 + 顶部天线 + 青色信标灯"""
    b = Builder()
    H = 70.0
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.beam((sx * 7, sy * 7, 0), (sx * 1.2, sy * 1.2, H), 0.9, P["steel"])
    for z, w in ((14, 5.6), (28, 4.4), (42, 3.3), (56, 2.2)):
        for a, c in (((-w, -w), (w, -w)), ((w, -w), (w, w)), ((w, w), (-w, w)), ((-w, w), (-w, -w))):
            b.beam((a[0], a[1], z), (c[0], c[1], z), 0.5, P["steel"])
    b.box((4, 4, 3), (0, 0, H + 1.5), P["white"])
    b.cyl(1.4, 4, (0, 0, H + 5), P["cyan"], seg=10)
    return b.finish(name, col, loc, 0.0, SC["tower"])


def swap_station(P, name, col, loc, yaw):
    """换电站：长条厂房 + 屋顶 + 三个亮着的工位门"""
    b = Builder()
    b.box((44, 18, 9), (0, 0, 4.5), P["concrete"])
    b.box((46, 20, 1.2), (0, 0, 9.6), P["white"])  # 屋顶
    for x in (-14, 0, 14):
        b.box((9, 0.5, 6), (x, -9.2, 3.8), P["glass"])  # 工位门（朝 -Y，面向路）
        b.box((9.8, 0.4, 0.6), (x, -9.3, 7.2), P["cyan"])
    b.box((46, 0.4, 0.8), (0, -10.1, 9.2), P["cyan"])
    return b.finish(name, col, loc, yaw, SC["swap"])


def cooling_tower(P, name, col, loc):
    """双曲线冷却塔：旋转壳 + 底部一圈青蓝灯带"""
    b = Builder()
    prof = [(52, 0), (50, 8), (46, 22), (41, 44), (36, 70), (33, 92), (33, 104), (35, 112)]
    b.lathe(prof, P["concrete"], seg=48)
    b.lathe([(52.5, 0.5), (52.5, 3.5)], P["cyan"], seg=48)
    return b.finish(name, col, loc, 0.0, SC["plant"])


def chimney(P, name, col, loc):
    """烟囱：红白相间的筒身"""
    b = Builder()
    n = 8
    for i in range(n):
        h = 150 / n
        r0 = 7 - 3 * i / n
        b.cyl(r0 - 0.4, h, (0, 0, h * i + h / 2), P["white"] if i % 2 else P["red"], seg=14, r2=r0 - 0.4 - 0.4)
    return b.finish(name, col, loc, 0.0, SC["plant"])


def barn(P, name, col, loc, yaw, length=360.0, width=120.0):
    """封闭煤场：拱顶大棚 + 一圈圈拱肋（发光）"""
    b = Builder()
    n = 24
    r = width / 2
    prof = []
    for k in range(n + 1):
        a = np.pi * k / n
        prof.append((r * np.cos(a), r * np.sin(a) * 0.55))
    # 沿长度拉伸成壳
    seg_l = 28
    rings = []
    for i in range(seg_l + 1):
        y = -length / 2 + length * i / seg_l
        rings.append([b.bm.verts.new((x, y, z)) for x, z in prof])
    mi = b._mi(P["white"])
    for i in range(seg_l):
        for j in range(n):
            f = b.bm.faces.new((rings[i][j], rings[i][j + 1], rings[i + 1][j + 1], rings[i + 1][j]))
            f.material_index = mi
    for i in range(0, seg_l + 1, 2):  # 拱肋
        for j in range(n):
            b.beam((rings[i][j].co.x, rings[i][j].co.y, rings[i][j].co.z + 0.4), (rings[i][j + 1].co.x, rings[i][j + 1].co.y, rings[i][j + 1].co.z + 0.4), 0.7, P["cyan"])
    b.box((width, length, 1.0), (0, 0, 0.5), P["dark"])
    return b.finish(name, col, loc, yaw, 1.0)


def plant_blocks(P, name, col, loc, yaw):
    """电厂厂房群：几栋方盒 + 亮窗带"""
    b = Builder()
    for (w, d, h, x, y) in [(70, 40, 24, 0, 0), (40, 30, 34, -60, 20), (50, 26, 18, 56, 10), (36, 26, 14, 10, -40), (30, 20, 20, -30, -46)]:
        b.box((w, d, h), (x, y, h / 2), P["concrete"])
        b.box((w * 0.92, 0.4, h * 0.22), (x, y - d / 2 - 0.2, h * 0.6), P["glass"])
    return b.finish(name, col, loc, yaw, SC["plant"])


def pv_field(P, name, col, loc, yaw, nx=8, ny=14):
    """光伏板阵列：小方板成排，微倾"""
    b = Builder()
    for i in range(nx):
        for j in range(ny):
            b.box((14, 8, 0.5), (i * 18, j * 11, 3), P["pv"], rot=(-0.4, 0, 0))
    return b.finish(name, col, loc, yaw, 1.0)


def belt_corridor(P, name, col, pts, height=14.0):
    """输煤走廊：沿折线的高架廊道（发光管）+ 间隔支架。pts 是世界 (x, y, z) 列表"""
    b = Builder()
    for a, c in zip(pts[:-1], pts[1:]):
        a, c = Vector(a) + Vector((0, 0, height)), Vector(c) + Vector((0, 0, height))
        b.beam(a, c, 8.0, P["white"])
        b.beam(a + Vector((0, 0, 4.2)), c + Vector((0, 0, 4.2)), 1.6, P["cyan"])
        n = max(2, int((c - a).length / 40))
        for k in range(n + 1):
            p = a + (c - a) * (k / n)
            b.beam((p.x, p.y, p.z - 4), (p.x, p.y, p.z - height), 1.2, P["steel"])
    return b.finish(name, col, (0, 0, 0), 0.0, 1.0)

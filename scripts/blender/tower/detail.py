"""
楼层级 · 精细标准办公层（每塔一个：<塔>_floor / <塔>_floor_v / <塔>_floor_lights）
----------------------------------------------------------
平面布局来自 plan.build_plan（房间、隔墙、工位、柱、机柜都在那里算好），这里只负责按布局建模：
  <塔>_floor        楼板（按房间类型分材质）+ 核心筒墙 + 实墙隔断 → 烘焙贴图（4096²）
  <塔>_floor_v      家具、设备、玻璃隔断的铝框、电梯门、楼梯、柱 → 烘焙面角顶点色
  <塔>_floor_lights 吊顶 + 灯盘（自发光）→ 只在烘焙时照亮室内，不导出（三维里楼层去顶俯视）
按真实层高（plan.STOREY 3.8 m、吊顶 plan.WALL_H 2.8 m）建模，与楼宇级的示意层高无关。
玻璃幕墙、玻璃隔断的玻璃、房间着色、设备图标都在 three.js（scene/floor/）里做。
Blender（MCP）：import tower.detail as d; d.run()（建模）→ d.bake()（两塔约 10 分钟）→ d.export()（public/building/floor_S|N.glb）
"""

import importlib
import math
import os
import random
import time

import bmesh
import bpy

from . import floors, lib, plan
from .build import MODEL_DIR, ROOT
from .floors import MI

OUT_DIR = os.path.join(ROOT, "public", "building")
H = plan.WALL_H
CEIL = 3.4  # 吊顶高度（只参与烘焙）：高于隔墙，墙顶能受光
EXPOSURE = 1.2  # 烘焙结果的色调映射曝光（tonemap() 可单独重算，不用重烘）
# 房间类型 → 地面材质
FLOOR_MAT = {
    "office": "carpet_o",
    "machine": "raised",
    "meeting": "carpet_o",
    "conference": "wood_f",
    "manager": "wood_f",
    "pantry": "tile",
    "lobby": "corridor",
    "stair": "concrete",
    "wc": "tile",
    "power": "concrete",
    "service": "concrete",
}


# 地面程序纹理（烘焙时连同光照一起写进贴图）：颜色 1 / 2（砖块间随机）、缝色、块宽 / 块高（米）、缝宽、错缝、噪声起伏
FLOOR_TEX = {
    "MT_carpet_o": ("#525d70", "#48526a", "#384152", 0.5, 0.5, 0.012, 0.0, 0.22),  # 50 cm 方块地毯
    "MT_corridor": ("#aeb1b6", "#a0a3a8", "#74777c", 1.2, 0.6, 0.006, 0.5, 0.06),  # 石材 120 × 60 错缝
    "MT_wood_f": ("#80603f", "#6a4d33", "#4a3624", 1.8, 0.18, 0.004, 0.37, 0.12),  # 木地板长条
    "MT_raised": ("#8c939b", "#838a92", "#545a61", 0.6, 0.6, 0.012, 0.0, 0.05),  # 机房架空地板
    "MT_tile": ("#bcc0c4", "#b2b6ba", "#8a8e92", 0.3, 0.3, 0.005, 0.0, 0.04),  # 卫生间 / 茶水间地砖
}


def _texture_materials():
    """
    给楼层级地面材质接上砖块纹理：物体坐标 → 绕 z 转到平面主轴（对象属性 ang，南北塔共用材质、朝向不同）→ Brick → 叠一层噪声明暗起伏 → Base Color
    """
    for name, (c1, c2, cm, w, h, mort, off, nz) in FLOOR_TEX.items():
        m = bpy.data.materials[name]
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        for n in [n for n in nt.nodes if n.name.startswith("FT_")]:
            nt.nodes.remove(n)

        def node(t, nm):
            n = nt.nodes.new(t)
            n.name = "FT_" + nm
            return n

        tc = node("ShaderNodeTexCoord", "tc")
        at = node("ShaderNodeAttribute", "ang")
        at.attribute_type = "OBJECT"
        at.attribute_name = "ang"
        rot = node("ShaderNodeVectorRotate", "rot")
        rot.rotation_type = "Z_AXIS"
        nt.links.new(tc.outputs["Object"], rot.inputs["Vector"])
        nt.links.new(at.outputs["Fac"], rot.inputs["Angle"])
        br = node("ShaderNodeTexBrick", "brick")
        br.offset = off
        br.inputs["Scale"].default_value = 1.0
        br.inputs["Brick Width"].default_value = w
        br.inputs["Row Height"].default_value = h
        br.inputs["Mortar Size"].default_value = mort
        br.inputs["Mortar Smooth"].default_value = 0.2
        br.inputs["Color1"].default_value = lib._lin(c1)
        br.inputs["Color2"].default_value = lib._lin(c2)
        br.inputs["Mortar"].default_value = lib._lin(cm)
        nt.links.new(rot.outputs["Vector"], br.inputs["Vector"])
        # 噪声明暗：地毯纤维 / 石材纹理的起伏
        no = node("ShaderNodeTexNoise", "noise")
        no.inputs["Scale"].default_value = 3.0
        no.inputs["Detail"].default_value = 6.0
        nt.links.new(rot.outputs["Vector"], no.inputs["Vector"])
        mr = node("ShaderNodeMapRange", "range")
        mr.inputs["To Min"].default_value = 1 - nz
        mr.inputs["To Max"].default_value = 1 + nz * 0.6
        nt.links.new(no.outputs["Fac"], mr.inputs["Value"])
        mx = node("ShaderNodeMix", "mix")
        mx.data_type = "RGBA"
        mx.blend_type = "MULTIPLY"
        mx.inputs["Factor"].default_value = 1.0
        nt.links.new(br.outputs["Color"], mx.inputs["A"])
        nt.links.new(mr.outputs["Result"], mx.inputs["B"])
        nt.links.new(mx.outputs["Result"], bsdf.inputs["Base Color"])


class Frame:
    """局部坐标 (a 沿长轴, b 沿短轴) → Blender xy；rot 为局部角（相对 +a）"""

    def __init__(self, P):
        self.ang = P["ang"]
        self.to_xy = P["to_xy"]

    def box(self, bm, size, a, b, z, mat, rot=0.0, bottom=False):
        x, y = self.to_xy(a, b)
        lib.add_box(bm, size, (x, y, z), self.ang + rot, MI[mat], bottom)

    def cyl(self, bm, r, h, a, b, z, mat, seg=12, cap=True):
        x, y = self.to_xy(a, b)
        lib.add_cyl(bm, r, h, (x, y, z), seg=seg, mat=MI[mat], cap=cap)

    def poly(self, bm, pts, z, mat, down=False):
        lib.add_poly(bm, [self.to_xy(a, b) for a, b in pts], z, MI[mat], down)

    def wall(self, bm, p, q, t, h, mat, z0=0.0):
        """两点之间的墙（厚 t、高 h），p / q 为局部坐标"""
        L = math.dist(p, q)
        if L < 0.05:
            return
        rot = math.atan2(q[1] - p[1], q[0] - p[0])
        self.box(bm, (L + t, t, h), (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, z0 + h / 2, mat, rot)


def _local(c, rot):
    """以 c 为原点、rot 为 u 轴方向的局部 (u, v) → (a, b)"""
    cu, su = math.cos(rot), math.sin(rot)
    return lambda u, v: (c[0] + u * cu - v * su, c[1] + u * su + v * cu)


# ---------------------------------------------------------------- 家具


def _chair(F, bv, at, u, v, face_rot, mat="chair_b"):
    """办公椅：五星脚 + 气杆 + 座面 + 椅背（椅背在 face_rot 方向的反侧）"""
    a, b = at(u, v)
    F.cyl(bv, 0.3, 0.05, a, b, 0.04, "metal_d", seg=10)
    F.cyl(bv, 0.03, 0.38, a, b, 0.08, "metal_d", seg=6, cap=False)
    F.box(bv, (0.5, 0.5, 0.08), a, b, 0.48, mat, face_rot)
    ba, bb = a - 0.24 * math.cos(face_rot), b - 0.24 * math.sin(face_rot)
    F.box(bv, (0.06, 0.48, 0.55), ba, bb, 0.82, mat, face_rot)


def _island(F, bv, desks, rnd):
    """一组 6 人工位岛：桌面、桌腿挡板、中间隔屏、显示器（屏幕朝人）、椅子、桌下矮柜"""
    for d in desks:
        rot, side = d["rot"], d["face"]
        nx, ny = -math.sin(rot), math.cos(rot)
        # 桌子中心 → 局部：u 沿切线，v 指向坐人一侧
        at = _local((d["a"], d["b"]), rot)
        s = side
        F.box(bv, (1.36, 0.7, 0.04), *at(0, 0), 0.74, "desk_w", rot)
        F.box(bv, (1.3, 0.03, 0.66), *at(0, -s * 0.33), 0.38, "metal_d", rot)  # 桌下挡板
        for du in (-0.66, 0.66):
            F.box(bv, (0.04, 0.66, 0.72), *at(du, 0), 0.36, "metal_d", rot)  # 桌腿
        F.box(bv, (1.36, 0.04, 0.42), *at(0, -s * 0.37), 0.95, "panel", rot)  # 中间隔屏
        # 显示器：屏背朝隔屏，屏面朝坐人一侧
        F.box(bv, (0.04, 0.04, 0.3), *at(0.12, -s * 0.2), 0.9, "metal_d", rot)
        F.box(bv, (0.62, 0.035, 0.37), *at(0.12, -s * 0.18), 1.12, "monitor", rot)
        on = rnd.random() < 0.85
        F.box(bv, (0.58, 0.01, 0.33), *at(0.12, -s * 0.16), 1.12, ("screen" if rnd.random() < 0.7 else "screen_w") if on else "monitor", rot)
        F.box(bv, (0.45, 0.15, 0.02), *at(0.12, s * 0.05), 0.77, "chair_b", rot)  # 键盘
        F.box(bv, (0.4, 0.5, 0.6), *at(-0.42, s * 0.05), 0.3, "alu", rot)  # 矮柜
        if rnd.random() < 0.88:
            face = math.atan2(-s * ny, -s * nx)  # 椅子面朝桌子
            _chair(F, bv, at, rnd.uniform(-0.12, 0.2), s * 0.82, face)


def _conference(F, bv, room, P, rnd, big):
    """会议室：长桌（沿房间切线方向）+ 两侧椅子 + 端头显示屏 + 边柜 + 绿植"""
    c = room["center"]
    rot = math.atan2(c[1], c[0]) + math.pi / 2  # 切线方向（径向转 90°）
    at = _local(c, rot)
    L = 7.2 if big else 3.6
    W = 1.6 if big else 1.2
    F.box(bv, (L, W, 0.06), *at(0, 0), 0.74, "wood", rot)
    F.box(bv, (L - 0.8, 0.5, 0.7), *at(0, 0), 0.36, "metal_d", rot)
    n = 7 if big else 3
    for k in range(n):
        u = -L / 2 + (k + 0.5) * L / n
        for s in (-1, 1):
            _chair(F, bv, at, u, s * (W / 2 + 0.55), rot - s * math.pi / 2, "chair_b")
    # 端头大屏（支架 + 屏幕，屏面朝桌）
    F.box(bv, (0.1, 2.6 if big else 1.8, 1.5 if big else 1.1), *at(L / 2 + 1.4, 0), 1.45, "monitor", rot)
    F.box(bv, (0.02, 2.5 if big else 1.7, 1.4 if big else 1.0), *at(L / 2 + 1.34, 0), 1.45, "screen", rot)
    F.box(bv, (0.5, 2.0, 0.75), *at(-L / 2 - 1.2, 0), 0.38, "wood", rot)  # 边柜
    for s in (-1, 1):
        _plant(F, bv, *at(-L / 2 - 1.3, s * 1.6))
        _plant(F, bv, *at(L / 2 + 1.2, s * (1.9 if big else 1.4)))


def _manager(F, bv, room, rnd):
    """总经理室：大班台 + 班椅 + 两把客椅 + 沙发组 + 书柜"""
    c = room["center"]
    rot = math.atan2(c[1], c[0]) + math.pi / 2
    at = _local(c, rot)
    F.box(bv, (2.2, 0.95, 0.06), *at(-1.0, 0.6), 0.76, "wood", rot)
    F.box(bv, (2.1, 0.85, 0.72), *at(-1.0, 0.6), 0.37, "wood", rot)
    F.box(bv, (0.6, 0.03, 0.38), *at(-1.0, 0.85), 1.1, "monitor", rot)
    _chair(F, bv, at, -1.0, 1.5, rot - math.pi / 2)
    for du in (-1.6, -0.4):
        _chair(F, bv, at, du, -0.35, rot + math.pi / 2, "sofa")
    # 沙发组：三人沙发 + 茶几 + 单人位
    F.box(bv, (2.2, 0.85, 0.42), *at(2.0, 1.4), 0.21, "sofa_g", rot)
    F.box(bv, (2.2, 0.2, 0.8), *at(2.0, 1.8), 0.4, "sofa_g", rot)
    F.box(bv, (1.2, 0.6, 0.4), *at(2.0, 0.4), 0.2, "stone", rot)
    F.box(bv, (0.85, 0.85, 0.42), *at(3.5, 0.4), 0.21, "sofa_g", rot)
    F.box(bv, (2.6, 0.4, 2.0), *at(-1.0, 2.6), 1.0, "wood", rot)  # 书柜
    _plant(F, bv, *at(3.6, 1.9))


def _pantry(F, bv, room, rnd):
    """茶水间：L 形操作台 + 冰箱 + 咖啡机 + 中岛吧台 + 吧凳 + 两张小圆桌"""
    c = room["center"]
    rot = math.atan2(c[1], c[0]) + math.pi / 2
    at = _local(c, rot)
    F.box(bv, (3.6, 0.65, 0.92), *at(0, -2.2), 0.46, "counter", rot)
    F.box(bv, (0.8, 0.7, 1.9), *at(2.3, -2.2), 0.95, "alu", rot)  # 冰箱
    F.box(bv, (0.35, 0.4, 0.45), *at(-0.8, -2.2), 1.15, "metal_d", rot)  # 咖啡机
    F.box(bv, (2.4, 0.9, 0.95), *at(0, -0.3), 0.48, "counter", rot)
    for k in range(4):
        F.cyl(bv, 0.2, 0.7, *at(-0.9 + k * 0.6, 0.45), 0.0, "chair_b", seg=10)
    for du in (-1.3, 1.3):
        a, b = at(du, 1.6)
        F.cyl(bv, 0.45, 0.74, a, b, 0.0, "desk_w", seg=14)
        for k in range(3):
            t = k * 2 * math.pi / 3 + 0.3
            F.cyl(bv, 0.2, 0.45, a + 0.75 * math.cos(t), b + 0.75 * math.sin(t), 0.0, "sofa", seg=10)
    _plant(F, bv, *at(1.9, 0.9))


def _machine(F, bv, room, P):
    """弱电机房：两排机柜（正面指示灯，R03 告警红灯）+ 机柜上方走线槽 + 两台精密空调 + 气体灭火钢瓶"""
    for r in P["racks"]:
        rot = 0.0
        alarm = r["id"] == "R03"
        F.box(bv, (1.1, 0.6, 2.1), r["a"], r["b"], 1.05, "rack", rot)
        face = 1 if r["row"] == 1 else -1  # 两排面对面（冷通道在中间）
        for k in range(6):
            F.box(bv, (0.02, 0.45, 0.04), r["a"] - face * 0.56, r["b"], 0.5 + k * 0.25, "alarm_led" if alarm and k % 2 == 0 else "led_b", rot)
    # 走线槽
    a0 = min(r["a"] for r in P["racks"])
    b0 = min(r["b"] for r in P["racks"])
    b1 = max(r["b"] for r in P["racks"])
    for row_a in sorted({r["a"] for r in P["racks"]}):
        F.box(bv, (0.4, b1 - b0 + 0.6, 0.12), row_a, (b0 + b1) / 2, 2.45, "alu", bottom=True)
    c = room["center"]
    F.box(bv, (0.9, 1.8, 2.0), c[0] + 3.4, c[1] + 1.2, 1.0, "pot")  # 精密空调
    F.box(bv, (0.9, 1.8, 2.0), c[0] + 3.4, c[1] - 1.8, 1.0, "pot")
    for k in range(3):
        F.cyl(bv, 0.18, 1.5, a0 - 1.6, c[1] - 1.0 + k * 0.45, 0.0, "red", seg=10)


_prnd = random.Random(7)


def _plant(F, bv, a, b, big=False):
    """盆栽：白色花盆 + 几团大小不一、高低错落的叶团（远看是一丛，不是一个球）"""
    from mathutils import Matrix

    F.cyl(bv, 0.28 if big else 0.22, 0.5, a, b, 0.0, "pot", seg=12)
    x, y = F.to_xy(a, b)
    k = 1.25 if big else 1.0
    for i in range(5):
        t = i * 2.4 + _prnd.random()
        rr = (0.0 if i == 0 else 0.22) * k
        z = (0.95 if i == 0 else 0.7 + _prnd.random() * 0.45) * k
        res = bmesh.ops.create_icosphere(
            bv, subdivisions=2, radius=(0.36 if i == 0 else 0.26) * k * (0.85 + _prnd.random() * 0.3),
            matrix=Matrix.Translation((x + rr * math.cos(t), y + rr * math.sin(t), z)),
        )
        for f in {f for v in res["verts"] for f in v.link_faces}:
            f.material_index = MI["leaf"]


# ---------------------------------------------------------------- 主体


def build(tag, M, col, loc):
    P = plan.build_plan(plan.TOWERS[tag])
    F = Frame(P)
    rnd = random.Random(320)
    bm = bmesh.new()  # 楼板 + 墙：烘贴图
    bv = bmesh.new()  # 家具设备：烘顶点色
    bl = bmesh.new()  # 吊顶 + 灯盘：只参与烘焙
    cx, cy = P["core"]
    cor = P["cor"]

    # ---- 楼板：各块地面互不重叠地拼满整层（外圈房间 + 核心筒外一圈走道 + 核心筒内各房间 + 电梯井底）。
    # 不能先铺整片底板再叠房间地面：共面叠放的面在 Smart UV 打包时会被塞进同一块区域，烘焙结果互相覆盖
    for r in P["rooms"]:
        F.poly(bm, r["poly"], 0.0, "corridor" if r["type"] == "lobby" else FLOOR_MAT[r["type"]])
    ox, oy = cor
    for q in (
        [(-ox, cy), (ox, cy), (ox, oy), (-ox, oy)],
        [(-ox, -oy), (ox, -oy), (ox, -cy), (-ox, -cy)],
        [(-ox, -cy), (-cx, -cy), (-cx, cy), (-ox, cy)],
        [(cx, -cy), (ox, -cy), (ox, cy), (cx, cy)],
    ):
        F.poly(bm, q, 0.0, "corridor")
    lib.add_band(bv, [F.to_xy(a, b) for a, b in P["slab"]], -0.35, 0.0, MI["slab_edge"])

    # ---- 核心筒：外墙（深色，厚 0.3）留门洞 + 内隔墙 + 电梯井实体
    T = 0.3
    # 前墙：电梯厅整段敞开，两端楼梯间各留一个门
    fr = cy
    F.wall(bm, (-cx, fr), (-0.82 * cx, fr), T, H, "wall_c")
    F.wall(bm, (-0.62 * cx, fr), (-0.46 * cx, fr), T, H, "wall_c")
    F.wall(bm, (0.46 * cx, fr), (0.62 * cx, fr), T, H, "wall_c")
    F.wall(bm, (0.82 * cx, fr), (cx, fr), T, H, "wall_c")
    # 后墙：男 / 女卫生间各一个门洞
    F.wall(bm, (-cx, -cy), (-0.32 * cx, -cy), T, H, "wall_c")
    F.wall(bm, (-0.14 * cx, -cy), (0.14 * cx, -cy), T, H, "wall_c")
    F.wall(bm, (0.32 * cx, -cy), (cx, -cy), T, H, "wall_c")
    # 两端：强电间 / 保洁间门洞
    for s in (-1, 1):
        F.wall(bm, (s * cx, -cy), (s * cx, -0.78 * cy), T, H, "wall_c")
        F.wall(bm, (s * cx, -0.42 * cy), (s * cx, cy), T, H, "wall_c")
    # 内隔墙
    for s in (-1, 1):
        F.wall(bm, (s * 0.46 * cx, -cy), (s * 0.46 * cx, cy), 0.15, H, "wall_c")
        F.wall(bm, (s * 0.46 * cx, -0.22 * cy), (s * cx, -0.22 * cy), 0.15, H, "wall_c")
    F.wall(bm, (-0.46 * cx, -0.48 * cy), (0.46 * cx, -0.48 * cy), 0.15, H, "wall_c")
    F.wall(bm, (0, -cy), (0, -0.48 * cy), 0.12, H, "wall_c")
    # 电梯井：实心深色块，正面 6 樘不锈钢门 + 门框 + 楼层指示灯
    sh = P["shafts"]
    a0, a1 = sh[0][0], sh[1][0]
    b0, b1 = sh[0][1], sh[2][1]
    F.box(bm, (a1 - a0, b1 - b0, H), (a0 + a1) / 2, (b0 + b1) / 2, H / 2, "wall_c")
    for k in range(6):
        a = a0 + (k + 0.5) * (a1 - a0) / 6
        F.box(bv, (1.3, 0.08, 2.35), a, b1 + 0.04, 1.18, "metal_d")
        F.box(bv, (1.1, 0.06, 2.2), a, b1 + 0.08, 1.1, "door_s")
        F.box(bv, (0.02, 0.07, 2.2), a, b1 + 0.09, 1.1, "metal_d")  # 门缝
        F.box(bv, (0.35, 0.05, 0.1), a, b1 + 0.09, 2.5, "led_b")
    # 电梯厅：两侧长椅、绿植
    for s in (-1, 1):
        _plant(F, bv, s * 0.36 * cx, 0.85 * cy, big=True)

    # ---- 楼梯：两跑楼梯 + 中间平台 + 扶手（沿 b 方向）
    for s in (-1, 1):
        ac = s * 0.73 * cx
        w = 0.24 * cx
        bb0, bb1 = -0.15 * cy, 0.6 * cy
        n = 12
        # 第一跑：从走道一侧往里逐级升到平台（1.9 m）
        for k in range(n):
            bk = bb0 + (bb1 - bb0) * k / n
            F.box(bv, (w - 0.1, (bb1 - bb0) / n, 0.16 * (k + 1)), ac - w / 2 - 0.05, bk + (bb1 - bb0) / n / 2, 0.08 * (k + 1), "slab_edge")
        # 第二跑：从平台往回逐级下行（往下一层），台阶表面同样露在俯视里
        for k in range(n):
            bk = bb1 - (bb1 - bb0) * (k + 1) / n
            F.box(bv, (w - 0.1, (bb1 - bb0) / n, max(0.05, 1.9 - 0.16 * k)), ac + w / 2 + 0.05, bk + (bb1 - bb0) / n / 2, max(0.05, 1.9 - 0.16 * k) / 2, "concrete")
        F.box(bv, (2 * w, 0.95 * cy - bb1, 1.9), ac, (bb1 + 0.95 * cy) / 2, 0.95, "concrete")  # 平台
        F.box(bv, (0.06, bb1 - bb0, 0.06), ac, (bb0 + bb1) / 2, 2.0, "metal_d")  # 中间扶手

    # ---- 卫生间：隔间 + 洗手台；强电间：配电柜；保洁间：货架
    for s in (-1, 1):
        for k in range(3):
            a = s * (0.06 + 0.12 * (k + 0.5)) * cx
            F.box(bv, (0.04, 1.4, 2.0), a + s * 0.06 * cx, -0.78 * cy, 1.0, "panel")
            F.box(bv, (0.4, 0.6, 0.42), a, -0.88 * cy, 0.21, "pot")  # 坐便
        F.box(bv, (0.36 * cx, 0.55, 0.85), s * 0.24 * cx, -0.56 * cy, 0.42, "counter")
        F.box(bv, (0.36 * cx, 0.04, 0.9), s * 0.24 * cx, -0.5 * cy + 0.05, 1.5, "alu")  # 镜子
    for k in range(4):
        F.box(bv, (0.8, 0.6, 2.0), (0.56 + k * 0.1) * cx, -0.92 * cy, 1.0, "pot")
        F.box(bv, (0.6, 0.02, 0.1), (0.56 + k * 0.1) * cx, -0.92 * cy + 0.31, 1.6, "led")
    for k in range(3):
        F.box(bv, (0.9, 0.45, 1.8), (-0.6 - k * 0.12) * cx, -0.9 * cy, 0.9, "alu")

    # ---- 外圈房间的墙：实墙（烘贴图）/ 玻璃隔断（只建铝框，玻璃在三维里）
    for a0_, b0_, a1_, b1_, kind in P["walls"]:
        p, q = (a0_, b0_), (a1_, b1_)
        if kind == "solid":
            F.wall(bm, p, q, 0.15, H, "wall_w")
            continue
        F.wall(bv, p, q, 0.06, 0.08, "metal_d")  # 地槽
        F.wall(bv, p, q, 0.06, 0.1, "metal_d", z0=H - 0.1)  # 顶槽
        L = math.dist(p, q)
        n = max(1, round(L / 1.2))
        for k in range(n + 1):
            t = k / n
            a, b = p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t
            F.box(bv, (0.05, 0.05, H), a, b, H / 2, "alu")
        F.wall(bv, p, q, 0.03, 0.06, "alu", z0=1.05)  # 腰线（磨砂贴膜分隔）

    # ---- 结构柱
    for a, b in P["columns"]:
        F.cyl(bv, 0.45, H, a, b, 0.0, "stone", seg=16, cap=True)

    # ---- 开放办公：工位岛（同一岛 6 张桌一起）
    _island(F, bv, P["desks"], rnd)
    # 办公区绿植、文件柜：沿走道外沿
    for r in P["rooms"]:
        if r["type"] != "office":
            continue
        n = 0
        for t in range(int(r["t"][0]) + 6, int(r["t"][1]) - 4, 9):
            rr = math.radians(t)
            d = (P["A"] * math.cos(rr), P["B"] * math.sin(rr))
            # 走道外沿再往外 6%：贴着走道边摆
            k = min(cor[0] / max(abs(d[0]), 1e-6), cor[1] / max(abs(d[1]), 1e-6)) * 1.06
            a, b = d[0] * k, d[1] * k
            if n % 2 == 0:
                _plant(F, bv, a, b, big=True)
            else:
                rot = math.atan2(d[1], d[0]) + math.pi / 2
                F.box(bv, (1.8, 0.45, 1.1), a, b, 0.55, "alu", rot)
            n += 1

    # ---- 其它房间家具
    for r in P["rooms"]:
        t = r["type"]
        if t == "conference":
            _conference(F, bv, r, P, rnd, True)
        elif t == "meeting":
            _conference(F, bv, r, P, rnd, False)
        elif t == "manager":
            _manager(F, bv, r, rnd)
        elif t == "pantry":
            _pantry(F, bv, r, rnd)
        elif t == "machine":
            _machine(F, bv, r, P)

    # ---- 吊顶 + 灯具（只参与烘焙）：吊顶抬到 3.4 m（比 2.8 m 的隔墙高，墙顶不会被吊顶压成黑色），吊顶反照率低，
    # 灯光的落差、阴影才出得来（设计稿是夜景室内：灯下亮、角落暗）。
    #   开放办公：每个工位岛正上方一条吊线灯（沿岛长向），岛与岛之间再稀疏补几盏筒灯；
    #   走道 / 电梯厅：一圈筒灯，地面留出一个个光斑；会议室：长桌上方吊线灯 + 四周筒灯；
    #   机房：暖橙色灯盘（设计稿机房是橙色光）；卫生间、强电间等：冷白灯盘
    from .plan import in_poly

    F.poly(bl, P["slab"], CEIL, "ceiling_b", down=True)

    def room_at(a, b):
        return next((r for r in P["rooms"] if in_poly(a, b, r["poly"])), None)

    def downlight(a, b, mat="light_dn"):
        """筒灯：朝下的发光圆片（直径 0.24 m）"""
        ring = [(a + 0.12 * math.cos(k * math.pi / 6), b + 0.12 * math.sin(k * math.pi / 6)) for k in range(12)]
        F.poly(bl, ring, CEIL - 0.02, mat, down=True)

    # 工位岛吊线灯：同一岛 6 张桌连续存放，取中心与切线方向
    ds = P["desks"]
    for k in range(0, len(ds), 6):
        isl = ds[k : k + 6]
        ca = sum(d["a"] for d in isl) / len(isl)
        cb = sum(d["b"] for d in isl) / len(isl)
        F.box(bl, (3.8, 0.12, 0.05), ca, cb, 2.95, "light_ln", isl[0]["rot"], bottom=True)
        F.box(bl, (0.02, 0.02, CEIL - 2.95), ca, cb, (CEIL + 2.95) / 2, "metal_d", isl[0]["rot"], bottom=True)
    # 网格补灯：按房间类型选灯具
    for i in range(-14, 15):
        for j in range(-9, 10):
            a, b = i * 2.4, j * 2.4 + 1.2
            if not in_poly(a, b, plan.inset(P["slab"], 0.8)):
                continue
            room = room_at(a, b)
            t = room["type"] if room else "corridor"
            if room is None and abs(a) < cx and abs(b) < cy:
                continue  # 核心筒墙体、电梯井里不放灯
            if t == "office":
                # 离工位岛远的地方才补筒灯（岛上方已有吊线灯）
                if all(math.dist((a, b), (d["a"], d["b"])) > 2.2 for d in ds):
                    downlight(a, b)
            elif t in ("corridor", "lobby", "pantry", "manager", "meeting"):
                downlight(a, b)
            elif t == "conference":
                if (i + j) % 2 == 0:
                    downlight(a, b)
            elif t == "machine":
                F.box(bl, (1.2, 0.3, 0.03), a, b, CEIL - 0.03, "light_or", bottom=True)
            else:
                F.box(bl, (0.6, 0.6, 0.03), a, b, CEIL - 0.03, "light_pc", bottom=True)
    # 会议室长桌上方的吊线灯（与桌同向）
    for r in P["rooms"]:
        if r["type"] in ("conference", "meeting"):
            c = r["center"]
            rot = math.atan2(c[1], c[0]) + math.pi / 2
            F.box(bl, (6.4 if r["type"] == "conference" else 3.0, 0.14, 0.05), c[0], c[1], 2.85, "light_ln", rot, bottom=True)

    ob = lib.new_object(f"{tag}_floor", bm, M, col)
    ov = lib.new_object(f"{tag}_floor_v", bv, M, col)
    ol = lib.new_object(f"{tag}_floor_lights", bl, M, col)
    for o in (ob, ov, ol):
        o.location = loc
        o["ang"] = -P["ang"]  # 地面纹理转到平面主轴（见 _texture_materials）
    return ob, ov, ol


def run(tags=("S", "N")):
    """建模（不清空场景，只替换楼层级对象）：集合 FLOOR，摆在楼宇级变体之外（y = 3000 m 起），烘焙时互不照亮"""
    from . import build as B

    importlib.reload(lib)
    importlib.reload(floors)
    importlib.reload(plan)
    M = floors.materials()
    _texture_materials()
    col = lib.collection("FLOOR")
    stats = {}
    for i, tag in enumerate(tags):
        for nm in (f"{tag}_floor", f"{tag}_floor_v", f"{tag}_floor_lights"):
            old = bpy.data.objects.get(nm)
            if old:
                me = old.data
                bpy.data.objects.remove(old, do_unlink=True)
                bpy.data.meshes.remove(me)
        ob, ov, ol = build(tag, M, col, (i * 200.0, 3000.0, 0.0))
        B.unwrap(ob)
        ov.data.color_attributes.new("Bake", "FLOAT_COLOR", "CORNER")
        ov.data.color_attributes.active_color = ov.data.color_attributes["Bake"]
        stats[tag] = [len(ob.data.polygons), len(ov.data.polygons), len(ol.data.polygons)]
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(MODEL_DIR, "tower.blend"))
    return stats


def bake(tags=("S", "N"), size=4096, samples=256, vertex_samples=1024):
    """
    烘焙：楼板贴图（浮点 → <名>_raw.exr → OIDN 降噪 → <名>_dn.exr → tonemap() 压成 PNG）+ 家具顶点色（采样更高，顶点色没法降噪）。
    只渲染该塔楼层级的三个对象（吊顶灯具提供室内光）。贴图保留超过 1 的高光，色调映射时按曝光压缩（灯下的光斑不会糊成一片白）
    """
    from . import bake as K

    K._setup(samples)
    log = {}
    for tag in tags:
        ob, ov, ol = (bpy.data.objects[f"{tag}_floor{s}"] for s in ("", "_v", "_lights"))
        t = time.time()
        for o in bpy.data.objects:
            o.hide_render = o not in (ob, ov, ol)
        bpy.context.scene.cycles.samples = samples
        _bake_raw(ob, size)
        raw = os.path.join(K.BAKE_DIR, ob.name + "_raw.exr")
        K.denoise(raw, os.path.join(K.BAKE_DIR, ob.name + "_dn.exr"), "OPEN_EXR")
        bpy.context.scene.cycles.samples = vertex_samples
        K._bake_vertex(ov)
        log[tag] = round(time.time() - t, 1)
    for o in bpy.data.objects:
        o.hide_render = False
    tonemap(tags)
    bpy.ops.wm.save_mainfile()
    return log


def _bake_raw(ob, size):
    """楼板烘到浮点图（不截断超过 1 的部分），存 <名>_raw.exr"""
    from . import bake as K

    nm = "BKF_" + ob.name
    if bpy.data.images.get(nm):
        bpy.data.images.remove(bpy.data.images[nm])
    img = bpy.data.images.new(nm, size, size, alpha=False, float_buffer=True)
    nodes = []
    for slot in ob.material_slots:
        nt = slot.material.node_tree
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img
        nt.nodes.active = n
        nodes.append((nt, n))
    try:
        K._select(ob)
        bpy.ops.object.bake(type="COMBINED", pass_filter=K.PASSES, margin=8, use_clear=True)
        img.filepath_raw = os.path.join(K.BAKE_DIR, ob.name + "_raw.exr")
        img.file_format = "OPEN_EXR"
        img.save()
    finally:
        for nt, n in nodes:
            nt.nodes.remove(n)
        bpy.data.images.remove(img)


def _tone(x, k=EXPOSURE):
    """色调曲线：1 - e^(-k·x)，暗部近似线性、高光平滑压到 1 以内"""
    import numpy as np

    return 1.0 - np.exp(-k * np.maximum(x, 0.0))


def tonemap(tags=("S", "N"), k=None):
    """降噪后的浮点烘焙图 → 色调映射 → sRGB 编码 → <名>.png（export 用这张）。改曝光只需重跑这一步"""
    import numpy as np

    from . import bake as K

    k = EXPOSURE if k is None else k
    for tag in tags:
        name = f"{tag}_floor"
        src = bpy.data.images.load(os.path.join(K.BAKE_DIR, name + "_dn.exr"), check_existing=False)
        w, h = src.size
        px = np.empty(w * h * 4, dtype=np.float32)
        src.pixels.foreach_get(px)
        bpy.data.images.remove(src)
        px = px.reshape(-1, 4)
        c = _tone(px[:, :3], k)
        # 线性 → sRGB（字节图的 pixels 按显示空间存，要自己编码）
        c = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)
        px[:, :3] = c
        px[:, 3] = 1.0
        out = bpy.data.images.new("TM_" + name, w, h, alpha=False)
        out.pixels.foreach_set(px.ravel())
        out.filepath_raw = os.path.join(K.BAKE_DIR, name + ".png")
        out.file_format = "PNG"
        out.save()
        bpy.data.images.remove(out)


def _tone_colors(me, k=None):
    """顶点色（线性、HDR）按同一条色调曲线压缩（楼宇级用的是等比截断，楼层级近看要保留明暗层次）"""
    import numpy as np

    attr = me.color_attributes["Bake"]
    n = len(attr.data)
    buf = np.empty(n * 4, dtype=np.float32)
    attr.data.foreach_get("color", buf)
    c = buf.reshape(n, 4)
    c[:, :3] = _tone(c[:, :3], EXPOSURE if k is None else k)
    attr.data.foreach_set("color", c.ravel())


def export(tags=("S", "N")):
    """public/building/floor_S.glb / floor_N.glb：对象 floor（烘焙贴图）与 floor_v（顶点色），不含吊顶灯盘"""
    from . import export as E

    res = {}
    col = bpy.data.collections["FLOOR"]
    for tag in tags:
        copies = []
        for suffix in ("", "_v"):
            ob = bpy.data.objects[f"{tag}_floor{suffix}"]
            me = ob.data.copy()
            for p in me.polygons:
                p.material_index = 0
            me.materials.clear()
            me.materials.append(E._vertex_material() if suffix else E._baked_material(ob))
            if suffix:
                _tone_colors(me)
            cp = bpy.data.objects.new("floor" + suffix, me)
            col.objects.link(cp)
            copies.append(cp)
        for o in bpy.context.scene.objects:
            o.select_set(False)
        for cp in copies:
            cp.select_set(True)
        path = os.path.join(OUT_DIR, f"floor_{tag}.glb")
        bpy.ops.export_scene.gltf(
            filepath=path,
            export_format="GLB",
            use_selection=True,
            export_yup=True,
            export_apply=False,
            export_normals=False,
            export_lights=False,
            export_cameras=False,
            export_extras=False,
            export_image_format="WEBP",
            export_image_quality=90,
            export_materials="EXPORT",
            export_meshopt_compression_enable=True,
            export_draco_mesh_compression_enable=False,
        )
        for cp in copies:
            me = cp.data
            bpy.data.objects.remove(cp, do_unlink=True)
            bpy.data.meshes.remove(me)
        res[os.path.basename(path)] = round(os.path.getsize(path) / 1024 / 1024, 2)
    return res

"""
澜岸云境沙盘 · Blender 建模 · 通用工具
----------------------------------------------------------
坐标约定（Blender，Z 轴向上）= layout.json 的平面坐标：x 向东、y 向北、z 向上，单位米，
原点在地块中心。导出 glTF 时 Blender 自动换成 Y 轴向上，three.js 里 (X, Y, Z) = (x, z, -y)，
和页面里 `group.position.set(b.cx, 0, -b.cy)` 一致。

材质只用 Principled BSDF 的常量参数（glTF 能原样导出）；窗玻璃按"几点亮灯"分成几档材质，
页面里 setLit(v) 按档调自发光强度，不用自定义着色器。
"""

import math
import os

import bmesh
import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
MODEL_DIR = os.path.join(ROOT, "models", "estate")
OUT_DIR = os.path.join(ROOT, "public", "estate")


# ---------------------------------------------------------------- 材质


def _hex(c):
    """'#rrggbb' → 线性空间 RGBA（Principled 的颜色输入是线性的）"""
    c = c.lstrip("#")
    srgb = [int(c[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in srgb]
    return (*lin, 1.0)


def material(name, color="#808080", rough=0.8, metal=0.0, emit=None, strength=0.0):
    """取得或创建同名 Principled 材质；emit 是自发光颜色，strength 是自发光强度"""
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = _hex(color)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = _hex(emit)
        bsdf.inputs["Emission Strength"].default_value = strength
    else:
        bsdf.inputs["Emission Strength"].default_value = 0.0
    return m


# 窗玻璃的亮灯档：(材质名, 占比, 开始亮的"夜色深度" 0–1)。页面 setLit(v) 里按同名档位调自发光
GLASS_TIERS = [
    ("glass_off", 0.07, 9.0),  # 一直不亮
    ("glass_a", 0.10, 0.0),  # 白天也亮着（沙盘里常亮的 LED）
    ("glass_b", 0.26, 0.25),
    ("glass_c", 0.29, 0.5),
    ("glass_d", 0.28, 0.75),
]


def make_materials():
    """全部材质：墙、楼板、屋面、玻璃、金色灯带、配套色。返回 {名字: 材质}"""
    M = {}
    M["wall"] = material("wall", "#c4b595", rough=0.88)
    M["wall2"] = material("wall2", "#e8dec6", rough=0.82)  # 壁柱、门廊，比墙更亮
    M["wall_warm"] = material("wall_warm", "#bba27a", rough=0.86)  # 联排、底商的暖色墙
    M["slab"] = material("slab", "#d8ccb2", rough=0.8)
    M["roof_flat"] = material("roof_flat", "#cfc9b8", rough=0.9)
    M["roof_tile"] = material("roof_tile", "#b0a38c", rough=0.82)
    M["rail"] = material("rail", "#a9bbbf", rough=0.25, metal=0.25)
    M["dark"] = material("dark", "#3b3732", rough=0.85)
    M["frame"] = material("frame", "#5a554c", rough=0.6, metal=0.4)
    M["green_roof"] = material("green_roof", "#7d9a52", rough=0.95)
    M["stone"] = material("stone", "#cfc6b0", rough=0.85)
    M["awn_a"] = material("awn_a", "#d9694a", rough=0.7)
    M["awn_b"] = material("awn_b", "#e0b04a", rough=0.7)
    M["awn_c"] = material("awn_c", "#5a9aa6", rough=0.7)
    M["school"] = material("school", "#f0d9a0", rough=0.85)
    M["school2"] = material("school2", "#d9a05a", rough=0.8)
    M["clinic"] = material("clinic", "#f2f0ea", rough=0.8)
    M["cross"] = material("cross", "#e04a3c", rough=0.5, emit="#ff5a46", strength=1.5)
    M["gold"] = material("gold", "#c9a86a", rough=0.4, metal=0.6, emit="#ffc866", strength=0.8)
    M["hull"] = material("hull", "#ffffff", rough=1.0)
    for name, _, _ in GLASS_TIERS:
        if name == "glass_off":
            M[name] = material(name, "#5f7f8f", rough=0.14, metal=0.7)
        else:
            M[name] = material(name, "#5e7a84", rough=0.14, metal=0.6, emit="#ffc77d", strength=1.0)
    M["shop_glass"] = material("shop_glass", "#9fc0c4", rough=0.12, metal=0.5, emit="#ffd08a", strength=1.0)
    M["glass_blue"] = material("glass_blue", "#6f9aa8", rough=0.1, metal=0.7, emit="#9fd2e6", strength=0.4)
    return M


# ---------------------------------------------------------------- 网格累积


# 盒子 6 个面的角点（局部坐标 0/1 → x0/x1…），逆时针看过去法线朝外
_BOX_FACES = {
    "+x": ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)),
    "-x": ((0, 1, 0), (0, 0, 0), (0, 0, 1), (0, 1, 1)),
    "+y": ((1, 1, 0), (0, 1, 0), (0, 1, 1), (1, 1, 1)),
    "-y": ((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)),
    "+z": ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)),
    "-z": ((0, 1, 0), (1, 1, 0), (1, 0, 0), (0, 0, 0)),
}


class MB:
    """
    网格累积器：按面记下材质，最后一次生成带多材质槽的网格。
    每个面单独一组顶点（硬边，导出后法线朝外）；角点颜色层 "Col" 初始为白，AO 烘焙时覆盖。
    box() 的坐标是局部框 (u, d, z)，经 tf 变换到楼栋坐标（tf 必须是只含旋转 / 平移的刚体变换，保证法线朝外）。
    """

    def __init__(self):
        self.verts = []
        self.faces = []
        self.fmat = []

    def quad(self, m, a, b, c, d):
        i = len(self.verts)
        self.verts += [a, b, c, d]
        self.faces.append((i, i + 1, i + 2, i + 3))
        self.fmat.append(m)

    def tri(self, m, a, b, c):
        i = len(self.verts)
        self.verts += [a, b, c]
        self.faces.append((i, i + 1, i + 2))
        self.fmat.append(m)

    def box(self, m, x0, x1, y0, y1, z0, z1, skip=(), tf=None):
        """轴对齐盒子（局部坐标），skip 里写不要的面（如贴墙的背面 "+y"）"""
        if x1 <= x0 or y1 <= y0 or z1 <= z0:
            return
        for face, corners in _BOX_FACES.items():
            if face in skip:
                continue
            pts = []
            for cx, cy, cz in corners:
                p = (x1 if cx else x0, y1 if cy else y0, z1 if cz else z0)
                pts.append(tf(*p) if tf else p)
            self.quad(m, *pts)

    def prism_x(self, m, x0, x1, y0, y1, zb, zr, ridge_y=None, gable=True, wall_m=None):
        """沿 x 的双坡屋顶：檐口在 y0 / y1、高 zb，屋脊在 ridge_y、高 zr；两端山墙用 wall_m"""
        ry = (y0 + y1) / 2 if ridge_y is None else ridge_y
        # 南坡（y0 一侧）法线朝 -y 和上
        self.quad(m, (x0, y0, zb), (x1, y0, zb), (x1, ry, zr), (x0, ry, zr))
        # 北坡
        self.quad(m, (x1, y1, zb), (x0, y1, zb), (x0, ry, zr), (x1, ry, zr))
        if gable:
            wm = wall_m or m
            self.tri(wm, (x1, y0, zb), (x1, y1, zb), (x1, ry, zr))
            self.tri(wm, (x0, y1, zb), (x0, y0, zb), (x0, ry, zr))

    def build(self, name, mats, collection):
        """生成网格对象。mats：{名字: 材质}；只给用到的材质开槽"""
        me = bpy.data.meshes.new(name)
        used = []
        for m in self.fmat:
            if m not in used:
                used.append(m)
        me.from_pydata(self.verts, [], self.faces)
        for m in used:
            me.materials.append(mats[m])
        idx = {m: i for i, m in enumerate(used)}
        me.polygons.foreach_set("material_index", [idx[m] for m in self.fmat])
        me.update()
        for p in me.polygons:
            p.use_smooth = False
        # 角点颜色：白（AO 烘焙会覆盖）
        attr = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
        attr.data.foreach_set("color", [1.0] * (4 * len(me.loops)))
        me.color_attributes.active_color = attr
        ob = bpy.data.objects.new(name, me)
        collection.objects.link(ob)
        return ob


# ---------------------------------------------------------------- 场景


def collection(name, parent=None):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
    parent = parent or bpy.context.scene.collection
    if col.name not in [c.name for c in parent.children]:
        parent.children.link(col)
    return col


def clear_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for item in list(coll):
            coll.remove(item)
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)


def rng(seed):
    """小型线性同余随机数，和 JS 里的 rng 一样可复现"""
    s = [seed & 0xFFFFFFFF or 1]

    def r():
        s[0] = (s[0] * 1664525 + 1013904223) & 0xFFFFFFFF
        return s[0] / 4294967296

    return r

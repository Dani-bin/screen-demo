"""
澜岸云境沙盘 · Cycles 离线渲染场景
----------------------------------------------------------
目标：渲出"实体沙盘实拍"质感的主视图。页面里的随机内容（地面底图、树、路灯、车、周边楼）由
scripts/estate/export_for_blender.mjs 从页面导出，这里按同样的位置摆进 Blender，所以渲染图和页面能对上；
Blender 里自己建的楼栋（buildings.py）直接用，换成带噪声凹凸和自发光窗的渲染材质（只在这个场景里，
不动导出 GLB 用的 estate.blend）。

坐标：Blender x 东、y 北、z 上；three.js (X, Y, Z) = (x, z, -y)。页面矩阵要换轴：M_b = C · M_t · C⁻¹。

场景比例：把它当成 1:250 的微缩模型来拍——相机的光圈按这个比例折算（真实比例下 570 m 的沙盘离相机 700 m，
景深几乎为零），所以 aperture_fstop 取一个很小的数。
"""

import json
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import buildings, trees
from .lib import MB, MODEL_DIR, ROOT, clear_scene, collection, make_materials, material, rng

RENDER_DIR = os.path.join(MODEL_DIR, "render")
# 三维轴换算：three (x, y, z) → Blender (x, -z, y)
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
CINV = C.inverted()
BASE = {"cx": 10.0, "cy": -6.0, "rx": 285.0, "ry": 208.0, "depth": 30.0}


def _lin(c):
    c = c.lstrip("#")
    s = [int(c[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in s]


# ---------------------------------------------------------------- 材质节点小工具


def _fresh(name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    return m, nt, bsdf


def _noise(nt, scale, detail=4.0, rough=0.55, coord=None):
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    if coord is not None:
        nt.links.new(coord, n.inputs["Vector"])
    return n


def _mul_color(nt, a, b, fac=1.0):
    """颜色相乘：a、b 可以是插座（连线）或 RGBA 元组"""
    mx = nt.nodes.new("ShaderNodeMix")
    mx.data_type = "RGBA"
    mx.blend_type = "MULTIPLY"
    mx.inputs[0].default_value = fac
    for idx, v in ((6, a), (7, b)):
        if isinstance(v, (tuple, list)):
            mx.inputs[idx].default_value = v
        else:
            nt.links.new(v, mx.inputs[idx])
    return mx.outputs[2]


def _bump(nt, bsdf, height, strength, dist=0.1):
    b = nt.nodes.new("ShaderNodeBump")
    b.inputs["Strength"].default_value = strength
    b.inputs["Distance"].default_value = dist
    nt.links.new(height, b.inputs["Height"])
    nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])


def _stucco(name, color, rough=0.85, grain=40.0, tone=0.07):
    """抹灰 / 涂料墙面：颜色和粗糙度带一点噪声，表面有极细的颗粒凹凸"""
    m, nt, b = _fresh(name)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    n = _noise(nt, grain, 6.0, 0.6, tc.outputs["Object"])
    base = _lin(color)
    # 噪声映射到 1 ± tone
    ramp = nt.nodes.new("ShaderNodeMapRange")
    ramp.inputs["From Min"].default_value = 0.35
    ramp.inputs["From Max"].default_value = 0.65
    ramp.inputs["To Min"].default_value = 1 - tone
    ramp.inputs["To Max"].default_value = 1 + tone
    nt.links.new(n.outputs["Fac"], ramp.inputs["Value"])
    col = nt.nodes.new("ShaderNodeVectorMath")
    col.operation = "SCALE"
    col.inputs[0].default_value = base[:3]
    nt.links.new(ramp.outputs["Result"], col.inputs["Scale"])
    nt.links.new(col.outputs[0], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    _bump(nt, b, n.outputs["Fac"], 0.25, 0.05)
    return m


def apply_render_materials(M, lit):
    """把 lib.make_materials 里的同名材质换成渲染用的节点材质；lit 是夜色深度（0 白天 – 1 夜晚）"""
    # ---- 墙体、楼板、屋面
    for name, col, rough in (
        ("wall", "#a8996f", 0.88),
        ("wall2", "#cfc3a4", 0.82),
        ("wall_warm", "#a58c64", 0.86),
        ("slab", "#c2b698", 0.8),
        ("roof_flat", "#b8b2a0", 0.9),
        ("school", "#f0d9a0", 0.85),
        ("school2", "#d9a05a", 0.8),
        ("clinic", "#f2f0ea", 0.8),
        ("stone", "#cfc6b0", 0.85),
    ):
        _stucco(name, col, rough)
    # 瓦屋面：沿坡的细条纹凹凸
    m, nt, b = _fresh("roof_tile")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    n = _noise(nt, 6.0, 3.0, 0.5, tc.outputs["Object"])
    n.inputs["Distortion"].default_value = 0.0
    ramp = nt.nodes.new("ShaderNodeMapRange")
    ramp.inputs["To Min"].default_value = 0.85
    ramp.inputs["To Max"].default_value = 1.1
    nt.links.new(n.outputs["Fac"], ramp.inputs["Value"])
    sc = nt.nodes.new("ShaderNodeVectorMath")
    sc.operation = "SCALE"
    sc.inputs[0].default_value = _lin("#b0a38c")[:3]
    nt.links.new(ramp.outputs["Result"], sc.inputs["Scale"])
    nt.links.new(sc.outputs[0], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.75
    _bump(nt, b, n.outputs["Fac"], 0.5, 0.2)
    _stucco("green_roof", "#7d9a52", 0.95, 12.0, 0.12)
    # ---- 玻璃：深色玻璃 + 暖色自发光（亮窗），按档位决定亮不亮
    on = 6.0 + 30.0 * lit
    thr = {"glass_a": -1.0, "glass_b": 0.0, "glass_c": 0.08, "glass_d": 0.16}

    def smooth(a, b_, x):
        t = min(1.0, max(0.0, (x - a) / (b_ - a)))
        return t * t * (3 - 2 * t)

    for name in ("glass_off", "glass_a", "glass_b", "glass_c", "glass_d"):
        m, nt, b = _fresh(name)
        b.inputs["Base Color"].default_value = (*_lin("#31464f"), 1)
        b.inputs["Roughness"].default_value = 0.04
        b.inputs["Metallic"].default_value = 0.0
        b.inputs["IOR"].default_value = 1.5
        if name != "glass_off":
            k = on * smooth(thr[name], thr[name] + 0.12, lit) if name != "glass_a" else on * 0.5
            b.inputs["Emission Color"].default_value = (*_lin("#ffc27a"), 1)
            b.inputs["Emission Strength"].default_value = k
    for name, col, st in (("shop_glass", "#ffd08a", 6.0 + 10 * lit), ("glass_blue", "#9fd2e6", 1.5)):
        m, nt, b = _fresh(name)
        b.inputs["Base Color"].default_value = (*_lin("#2a3c44"), 1)
        b.inputs["Roughness"].default_value = 0.05
        b.inputs["Emission Color"].default_value = (*_lin(col), 1)
        b.inputs["Emission Strength"].default_value = st
    # ---- 其它
    for name, col, rough, metal, emit, st in (
        ("rail", "#a9bbbf", 0.25, 0.25, None, 0),
        ("dark", "#2b2824", 0.8, 0.0, None, 0),
        ("frame", "#5a554c", 0.5, 0.5, None, 0),
        ("awn_a", "#d9694a", 0.7, 0.0, None, 0),
        ("awn_b", "#e0b04a", 0.7, 0.0, None, 0),
        ("awn_c", "#5a9aa6", 0.7, 0.0, None, 0),
        ("hull", "#ffffff", 1.0, 0.0, None, 0),
        ("cross", "#e04a3c", 0.5, 0.0, "#ff5a46", 4.0),
        ("gold", "#c9a86a", 0.3, 0.9, "#ffc866", 2.0 + 6.0 * lit),
    ):
        m, nt, b = _fresh(name)
        b.inputs["Base Color"].default_value = (*_lin(col), 1)
        b.inputs["Roughness"].default_value = rough
        b.inputs["Metallic"].default_value = metal
        if emit:
            b.inputs["Emission Color"].default_value = (*_lin(emit), 1)
            b.inputs["Emission Strength"].default_value = st


def tree_material():
    """树冠：顶点色（顶亮底暗 + 团间遮挡）× 实例颜色 × 叶丛噪声；叶面有一点漫透射的感觉"""
    m, nt, b = _fresh("tree_render")
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    oi = nt.nodes.new("ShaderNodeObjectInfo")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    n = _noise(nt, 9.0, 8.0, 0.65, tc.outputs["Object"])
    ramp = nt.nodes.new("ShaderNodeMapRange")
    ramp.inputs["From Min"].default_value = 0.3
    ramp.inputs["From Max"].default_value = 0.7
    ramp.inputs["To Min"].default_value = 0.5
    ramp.inputs["To Max"].default_value = 0.95
    nt.links.new(n.outputs["Fac"], ramp.inputs["Value"])
    c1 = _mul_color(nt, vc.outputs["Color"], oi.outputs["Color"])
    sc = nt.nodes.new("ShaderNodeVectorMath")
    sc.operation = "SCALE"
    nt.links.new(c1, sc.inputs[0])
    nt.links.new(ramp.outputs["Result"], sc.inputs["Scale"])
    nt.links.new(sc.outputs[0], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.8
    b.inputs["Sheen Weight"].default_value = 0.3
    b.inputs["Subsurface Weight"].default_value = 0.2
    _bump(nt, b, n.outputs["Fac"], 0.6, 0.3)
    return m


def shrub_material():
    """灌木：实例颜色 × 叶丛噪声（模板网格没有顶点色，所以不能用 tree_render）"""
    m, nt, b = _fresh("shrub_render")
    oi = nt.nodes.new("ShaderNodeObjectInfo")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    n = _noise(nt, 7.0, 8.0, 0.65, tc.outputs["Object"])
    ramp = nt.nodes.new("ShaderNodeMapRange")
    ramp.inputs["From Min"].default_value = 0.3
    ramp.inputs["From Max"].default_value = 0.7
    ramp.inputs["To Min"].default_value = 0.45
    ramp.inputs["To Max"].default_value = 0.9
    nt.links.new(n.outputs["Fac"], ramp.inputs["Value"])
    sc = nt.nodes.new("ShaderNodeVectorMath")
    sc.operation = "SCALE"
    nt.links.new(oi.outputs["Color"], sc.inputs[0])
    nt.links.new(ramp.outputs["Result"], sc.inputs["Scale"])
    nt.links.new(sc.outputs[0], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.85
    _bump(nt, b, n.outputs["Fac"], 0.5, 0.2)
    return m


def _plain(name, color, rough=0.8, emit=None, st=0.0, metal=0.0):
    m, nt, b = _fresh(name)
    b.inputs["Base Color"].default_value = (*_lin(color), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*_lin(emit), 1)
        b.inputs["Emission Strength"].default_value = st
    return m


# ---------------------------------------------------------------- 几何模板和实例


def _mesh_from_bmesh(name, bm, mat, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = smooth
    return me


def _template(kind, mat):
    bm = bmesh.new()
    if kind == "trunk":
        bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.24, radius2=0.15, depth=1.0)
    elif kind == "shrub":
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    elif kind == "pole":
        bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.2, radius2=0.14, depth=4.4)
    elif kind == "head":
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.62)
    elif kind == "gl":
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.3)
    elif kind == "car_body":
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(4.6, 1.9, 1.25), verts=bm.verts)
    elif kind == "car_cabin":
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(2.4, 1.7, 0.9), verts=bm.verts)
    elif kind == "car_light":
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(0.3, 1.5, 0.35), verts=bm.verts)
    return _mesh_from_bmesh(kind, bm, mat, smooth=kind in ("shrub", "head", "gl", "trunk", "pole"))


def _to_blender(e):
    """three.js 的列主序 16 个数 → Blender 世界矩阵"""
    m = Matrix((e[0:4], e[4:8], e[8:12], e[12:16])).transposed()
    return C @ m @ CINV


def _place(col, name, mesh, data, tint=True):
    """按导出的矩阵（和颜色）摆一批共享网格的物体"""
    n = data["count"]
    mats, colors = data["matrix"], data["color"]
    for i in range(n):
        ob = bpy.data.objects.new(f"{name}_{i}", mesh)
        ob.matrix_world = _to_blender(mats[i * 16 : i * 16 + 16])
        if colors is not None and tint:
            ob.color = (colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2], 1.0)
        else:
            ob.color = (1, 1, 1, 1)
        col.objects.link(ob)


def build_context(col, inst, M):
    """周边楼：按导出的盒子矩阵（缩放 = 宽 / 高 / 深）建带窗的体块"""
    r = rng(5151)
    mb = MB()
    for key in ("context", "context_tier"):
        d = inst.get(key)
        if not d:
            continue
        for i in range(d["count"]):
            m = _to_blender(d["matrix"][i * 16 : i * 16 + 16])
            t, sc = m.to_translation(), m.to_scale()
            w, dd, h = sc.x, sc.y, sc.z
            cx, cy, z0 = t.x, t.y, t.z - h / 2
            floors = max(1, round(h / 3.2))
            fh = h / floors
            for side in "SNEW":
                L = w if side in "SN" else dd
                bays = max(2, round(L / 3.4))
                buildings.facade(
                    mb, side, w, dd, z0 + 0.0, floors, fh, bays, r,
                    off=(cx, cy), sill=min(1.0, fh * 0.3), win_h=min(1.5, fh * 0.5), pier=1.3,
                    wall="wall_warm", fin_mat="wall2",
                )
            buildings.roof_slab(mb, w, dd, z0 + h, "roof_flat", over=0.3, th=0.3, off=(cx, cy))
    ob = mb.build("context_blocks", M, col)
    return ob


def build_table(M, albedo_path):
    """沙盘桌面：椭圆地面（底图贴上去）+ 金边 + 深色平台 + 底座侧面"""
    col = collection("TABLE")
    cx, cy, rx, ry, depth = BASE["cx"], BASE["cy"], BASE["rx"], BASE["ry"], BASE["depth"]
    kz = (ry + 7) / (rx + 7)

    def ring(name, r0, r1, z, mat, n=192):
        bm = bmesh.new()
        for i in range(n):
            a0, a1 = i / n * math.tau, (i + 1) / n * math.tau
            pts = [
                (cx + math.cos(a0) * r0, cy + math.sin(a0) * r0 * kz, z),
                (cx + math.cos(a1) * r0, cy + math.sin(a1) * r0 * kz, z),
                (cx + math.cos(a1) * r1, cy + math.sin(a1) * r1 * kz, z),
                (cx + math.cos(a0) * r1, cy + math.sin(a0) * r1 * kz, z),
            ]
            bm.faces.new([bm.verts.new(p) for p in reversed(pts)])
        me = _mesh_from_bmesh(name, bm, mat, smooth=True)
        ob = bpy.data.objects.new(name, me)
        col.objects.link(ob)
        return ob

    gold = _plain("table_gold", "#d8b672", 0.2, emit="#c9953a", st=0.6, metal=1.0)
    deck = _plain("table_deck", "#1b1510", 0.45, metal=0.3)
    side = _plain("table_side", "#14100c", 0.4, metal=0.5)
    ring("gold_lip", rx, rx + 4.0, -0.05, gold)
    ring("deck", rx + 4.0, rx + 7, -0.06, deck)
    # 侧面：圆台
    bm = bmesh.new()
    n = 192
    for i in range(n):
        a0, a1 = i / n * math.tau, (i + 1) / n * math.tau
        top = lambda a: (cx + math.cos(a) * (rx + 7), cy + math.sin(a) * (rx + 7) * kz, -0.06)  # noqa: E731
        bot = lambda a: (cx + math.cos(a) * (rx + 10), cy + math.sin(a) * (rx + 10) * kz, -depth)  # noqa: E731
        bm.faces.new([bm.verts.new(p) for p in (top(a0), bot(a0), bot(a1), top(a1))])
    ob = bpy.data.objects.new("side", _mesh_from_bmesh("side", bm, side, smooth=True))
    col.objects.link(ob)
    # 地面：椭圆盘，UV = 平面坐标映射到画布范围
    x0, y0, dx, dy = cx - rx, cy - ry, rx * 2, ry * 2
    bm = bmesh.new()
    center = bm.verts.new((cx, cy, 0))
    ring_v = [bm.verts.new((cx + math.cos(i / n * math.tau) * rx, cy + math.sin(i / n * math.tau) * ry, 0)) for i in range(n)]
    for i in range(n):
        bm.faces.new([center, ring_v[i], ring_v[(i + 1) % n]])
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for lp in f.loops:
            v = lp.vert.co
            lp[uv].uv = ((v.x - x0) / dx, (v.y - y0) / dy)
    gmat, nt, b = _fresh("ground_render")
    img = nt.nodes.new("ShaderNodeTexImage")
    img.image = bpy.data.images.load(albedo_path)
    img.image.colorspace_settings.name = "sRGB"
    img.interpolation = "Cubic"
    tc = nt.nodes.new("ShaderNodeTexCoord")
    n1 = _noise(nt, 0.8, 5.0, 0.6, tc.outputs["Object"])  # 草地的大块明暗
    n2 = _noise(nt, 6.0, 6.0, 0.65, tc.outputs["Object"])  # 草粉颗粒
    ramp = nt.nodes.new("ShaderNodeMapRange")
    ramp.inputs["From Min"].default_value = 0.35
    ramp.inputs["From Max"].default_value = 0.65
    ramp.inputs["To Min"].default_value = 0.72
    ramp.inputs["To Max"].default_value = 0.95
    nt.links.new(n1.outputs["Fac"], ramp.inputs["Value"])
    c1 = _mul_color(nt, img.outputs["Color"], (1, 1, 1, 1))
    sc = nt.nodes.new("ShaderNodeVectorMath")
    sc.operation = "SCALE"
    nt.links.new(c1, sc.inputs[0])
    nt.links.new(ramp.outputs["Result"], sc.inputs["Scale"])
    nt.links.new(sc.outputs[0], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.92
    _bump(nt, b, n2.outputs["Fac"], 0.5, 0.05)
    me = _mesh_from_bmesh("ground", bm, gmat, smooth=False)
    gob = bpy.data.objects.new("ground", me)
    col.objects.link(gob)
    return col


def build_water(M):
    """水面：景观湖、河、泳池。深色透亮的亚克力感：低粗糙度 + 中心深边缘浅的渐变（顶点色）"""
    col = collection("WATER")
    layout = json.load(open(os.path.join(ROOT, "src", "views", "estate", "data", "layout.json")))
    lake = next(a for a in layout["amenities"] if a["id"] == "LK01")
    river = next(a for a in layout["amenities"] if a["id"] == "RV01")
    pool = next(a for a in layout["amenities"] if a["id"] == "SW01")

    def lake_k(t):
        return 1 + 0.018 * math.sin(3 * t + 0.6) + 0.012 * math.sin(5 * t + 2.1)

    def river_y(x):
        return river["cy"] + 9 * math.sin(x / 70 + 0.4) + 4 * math.sin(x / 31 + 1.3)

    def mat_for(name, edge, deep):
        m, nt, b = _fresh(name)
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "depth"
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (*_lin(edge), 1)
        ramp.color_ramp.elements[1].color = (*_lin(deep), 1)
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(vc.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Red"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
        b.inputs["Roughness"].default_value = 0.05
        b.inputs["IOR"].default_value = 1.33
        b.inputs["Coat Weight"].default_value = 0.25
        b.inputs["Coat Roughness"].default_value = 0.02
        tc = nt.nodes.new("ShaderNodeTexCoord")
        n = _noise(nt, 0.6, 5.0, 0.55, tc.outputs["Object"])
        _bump(nt, b, n.outputs["Fac"], 0.22, 0.5)
        return m

    def poly_mesh(name, loops_depth, mat):
        """loops_depth: [(x, y, depth0-1)] 的多边形（凸或近凸），扇形三角化"""
        bm = bmesh.new()
        cxp = sum(p[0] for p in loops_depth) / len(loops_depth)
        cyp = sum(p[1] for p in loops_depth) / len(loops_depth)
        c = bm.verts.new((cxp, cyp, 0.4))
        vs = [bm.verts.new((p[0], p[1], 0.4)) for p in loops_depth]
        for i in range(len(vs)):
            bm.faces.new([c, vs[i], vs[(i + 1) % len(vs)]])
        attr = bm.loops.layers.float_color.new("depth")
        for f in bm.faces:
            for lp in f.loops:
                d = 1.0 if lp.vert is c else loops_depth[vs.index(lp.vert)][2]
                lp[attr] = (d, d, d, 1.0)
        return bpy.data.objects.new(name, _mesh_from_bmesh(name, bm, mat, smooth=False))

    lm = mat_for("lake_render", "#2a8fb8", "#09437a")
    pts = []
    for i in range(128):
        t = i / 128 * math.tau
        k = lake_k(t)
        pts.append((lake["cx"] + math.cos(t) * lake["w"] / 2 * k, lake["cy"] + math.sin(t) * lake["d"] / 2 * k, 0.0))
    col.objects.link(poly_mesh("lake", pts, lm))
    # 河：沿 x 的条带，两岸 0、河心 1
    rm = mat_for("river_render", "#2c6f8c", "#072742")
    bm = bmesh.new()
    attr = bm.loops.layers.float_color.new("depth")
    xs = [river["cx"] - river["w"] / 2 + i * 6 for i in range(int(river["w"] / 6) + 1)]
    rows = []
    for x in xs:
        u = (x - BASE["cx"]) / BASE["rx"]
        if abs(u) > 0.985:  # 桌面椭圆之外不画
            continue
        ymax = BASE["ry"] * math.sqrt(1 - u * u) * 0.99
        lo, hi = BASE["cy"] - ymax, BASE["cy"] + ymax
        y = river_y(x)
        half = river["d"] / 2 + 2.2 * math.sin(x / 55 + 2)
        yt, yb = min(y + half, hi), max(y - half, lo)
        if yt - yb < 4.0:  # 这一列河被桌面边缘切得只剩一条缝，不画
            continue
        ym = (yt + yb) / 2
        rows.append([bm.verts.new((x, yt, 0.4)), bm.verts.new((x, ym, 0.4)), bm.verts.new((x, yb, 0.4))])
    for a, b2 in zip(rows[:-1], rows[1:]):
        for j, dv in ((0, (0.0, 1.0)), (1, (1.0, 0.0))):
            f = bm.faces.new([a[j], b2[j], b2[j + 1], a[j + 1]])
            d0, d1 = dv
            for lp in f.loops:
                v = lp.vert
                depth = 0.0 if v in (a[0], b2[0], a[2], b2[2]) else 1.0
                lp[attr] = (depth, depth, depth, 1.0)
    col.objects.link(bpy.data.objects.new("river", _mesh_from_bmesh("river", bm, rm, smooth=False)))
    # 泳池
    pm = mat_for("pool_render", "#7fd0e6", "#2a86b8")
    bm = bmesh.new()
    attr = bm.loops.layers.float_color.new("depth")
    x0, x1 = pool["cx"] - pool["w"] / 2, pool["cx"] + pool["w"] / 2
    y0, y1 = pool["cy"] - pool["d"] / 2, pool["cy"] + pool["d"] / 2
    f = bm.faces.new([bm.verts.new(p) for p in ((x0, y0, 0.4), (x1, y0, 0.4), (x1, y1, 0.4), (x0, y1, 0.4))])
    for lp in f.loops:
        lp[attr] = (0.5, 0.5, 0.5, 1.0)
    col.objects.link(bpy.data.objects.new("pool", _mesh_from_bmesh("pool", bm, pm, smooth=False)))
    return col


_PHI = (1 + 5 ** 0.5) / 2
_ICO_V = [(-1, _PHI, 0), (1, _PHI, 0), (-1, -_PHI, 0), (1, -_PHI, 0), (0, -1, _PHI), (0, 1, _PHI), (0, -1, -_PHI), (0, 1, -_PHI), (_PHI, 0, -1), (_PHI, 0, 1), (-_PHI, 0, -1), (-_PHI, 0, 1)]
_ICO_F = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]


def build_grass(col):
    """草丛（每丛三片细叶）和花（小球）。位置来自 scripts/estate/make_grass.py 在页面地面底图的草地上撒的点"""
    path = os.path.join(RENDER_DIR, "grass_points.json")
    if not os.path.exists(path):
        return None
    d = json.load(open(path))
    r = rng(31337)
    # ---- 草丛：一个合并网格，顶点色 R = 颜色随机因子
    verts, faces, cols = [], [], []
    for x, y, k in d["tufts"]:
        h = 0.55 + 0.75 * k * (0.6 + 0.8 * r())
        for _ in range(3):
            a = r() * math.tau
            ca, sa = math.cos(a), math.sin(a)
            w = 0.14 + 0.08 * r()
            lean = 0.25 + 0.3 * r()
            la = r() * math.tau
            i = len(verts)
            verts += [(x + ca * w, y + sa * w, 0.0), (x - ca * w, y - sa * w, 0.0), (x + math.cos(la) * lean, y + math.sin(la) * lean, h)]
            faces.append((i, i + 1, i + 2))
            cols += [k, k, min(1.0, k + 0.25)]
    me = bpy.data.meshes.new("grass")
    me.from_pydata(verts, [], faces)
    gm, nt, b = _fresh("grass_render")
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(vc.outputs["Color"], sep.inputs["Color"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*_lin("#4d7a2c"), 1)
    ramp.color_ramp.elements[1].color = (*_lin("#a2ad4a"), 1)
    nt.links.new(sep.outputs["Red"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.8
    b.inputs["Subsurface Weight"].default_value = 0.25
    me.materials.append(gm)
    attr = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    flat = []
    for c in cols:
        flat += [c, c, c, 1.0]
    attr.data.foreach_set("color", flat)
    col.objects.link(bpy.data.objects.new("grass", me))
    # ---- 花：小球
    pal = [(0.95, 0.45, 0.6), (0.98, 0.8, 0.2), (0.95, 0.95, 0.9), (0.6, 0.4, 0.85), (0.9, 0.2, 0.2)]
    lin = lambda c: [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]  # noqa: E731
    pal = [lin(c) for c in pal]
    verts, faces, cols = [], [], []
    for x, y, kind in d["flowers"]:
        rad = 0.34 + 0.18 * r()
        z = 0.45 + 0.2 * r()
        i = len(verts)
        for vx, vy, vz in _ICO_V:
            n = (vx * vx + vy * vy + vz * vz) ** 0.5
            verts.append((x + vx / n * rad, y + vy / n * rad, z + vz / n * rad * 0.8))
            cols.append(pal[kind % len(pal)])
        faces += [(i + a, i + b2, i + c2) for a, b2, c2 in _ICO_F]
    me = bpy.data.meshes.new("flowers")
    me.from_pydata(verts, [], faces)
    fm, nt, b = _fresh("flower_render")
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(vc.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 0.35
    b.inputs["Roughness"].default_value = 0.55
    me.materials.append(fm)
    attr = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    flat = []
    for c in cols:
        flat += [c[0], c[1], c[2], 1.0]
    attr.data.foreach_set("color", flat)
    col.objects.link(bpy.data.objects.new("flowers", me))
    return {"tufts": len(d["tufts"]), "flowers": len(d["flowers"])}


def build_room(M):
    """展厅：深色光滑地面 + 围着桌子一圈的墙（带竖向灯条，景深里虚成光斑，环绕拍摄时四面都有）+ 三盏灯。
    灯光和灯条亮度由 apply_lighting 按光照档设置"""
    col = collection("ROOM")
    cx, cy = BASE["cx"], BASE["cy"]
    floor = _plain("room_floor", "#17110c", 0.22, metal=0.2)
    bm = bmesh.new()
    s = 7000
    bm.faces.new([bm.verts.new(p) for p in ((cx - s, cy - s, -BASE["depth"]), (cx + s, cy - s, -BASE["depth"]), (cx + s, cy + s, -BASE["depth"]), (cx - s, cy + s, -BASE["depth"]))])
    col.objects.link(bpy.data.objects.new("room_floor", _mesh_from_bmesh("room_floor", bm, floor, smooth=False)))
    # 一圈墙：64 段，半径 2300 m
    R, N = 2300.0, 64
    wall = _plain("room_wall", "#1d140e", 0.5)
    strip = _plain("room_strip", "#ffb866", 0.5, emit="#ffb25a", st=4.0)
    z0, z1 = -BASE["depth"], 1800.0
    bm = bmesh.new()
    for k in range(N):
        a0, a1 = k / N * math.tau, (k + 1) / N * math.tau
        p0 = (cx + math.sin(a0) * R, cy + math.cos(a0) * R)
        p1 = (cx + math.sin(a1) * R, cy + math.cos(a1) * R)
        bm.faces.new([bm.verts.new(v) for v in ((p1[0], p1[1], z0), (p0[0], p0[1], z0), (p0[0], p0[1], z1), (p1[0], p1[1], z1))])
    col.objects.link(bpy.data.objects.new("room_wall", _mesh_from_bmesh("room_wall", bm, wall, smooth=False)))

    def put_strip(bm, ang, width, h0, h1):
        """在墙上放一条竖向灯条：ang 从正北起顺时针（弧度），width 是弧长（米）"""
        da = width / R
        pts = []
        for a, h in ((ang + da, h0), (ang, h0), (ang, h1), (ang + da, h1)):
            pts.append((cx + math.sin(a) * (R - 3), cy + math.cos(a) * (R - 3), h))
        bm.faces.new([bm.verts.new(v) for v in pts])

    r = rng(99)
    bm = bmesh.new()
    for _ in range(46):
        put_strip(bm, r() * math.tau, 25 + r() * 70, 40 + r() * 100, 500 + r() * 900)
    # 正北方向左侧补几条（主视图背景左边别太空）
    for x, w, h0, h1 in ((-1050, 70, 60, 800), (-760, 40, 120, 1000), (-540, 90, 40, 620), (-330, 35, 200, 900), (-180, 55, 80, 520)):
        put_strip(bm, math.atan2(x, R), w, h0, h1)
    col.objects.link(bpy.data.objects.new("room_strips", _mesh_from_bmesh("room_strips", bm, strip, smooth=False)))

    def area(name, loc, target, size):
        ld = bpy.data.lights.new(name, "AREA")
        ld.shape = "RECTANGLE"
        ld.size, ld.size_y = size
        ob = bpy.data.objects.new(name, ld)
        ob.location = loc
        ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        col.objects.link(ob)

    area("key", (cx - 250, cy - 520, 700), (cx, cy, 0), (900, 500))
    area("fill", (cx + 300, cy + 600, 500), (cx, cy, 0), (900, 500))
    sun = bpy.data.lights.new("sun", "SUN")
    sun.angle = math.radians(2.5)
    sob = bpy.data.objects.new("sun", sun)
    sob.rotation_euler = (math.radians(70), 0, math.radians(-38))
    col.objects.link(sob)
    return col


# 光照档：lit = 夜色深度（窗灯、路灯、灯条的亮度），exp = 曝光；key / fill / sun 为 None 时按黄昏公式从 lit 推出
PRESETS = {
    "day": {"lit": 0.1, "exp": -0.45},
    "golden": {"lit": 0.4, "exp": -0.5},
    "dusk": {"lit": 0.85, "exp": -0.55},
    "night": {"lit": 1.0, "exp": -0.15, "key": 0.45e7, "key_col": (0.72, 0.82, 1.0), "fill": 0.9e7, "sun": 0.0},
}


def apply_lighting(M, preset):
    """把一个光照档用到场景上：材质（窗、金、灯）、路灯、灯条、三盏灯、曝光、世界色。可反复调用"""
    P = PRESETS[preset] if isinstance(preset, str) else preset
    lit = P["lit"]
    apply_render_materials(M, lit)
    _plain("lamp_head", "#ffd9a0", 0.5, emit="#ffd08a", st=20 + 50 * lit)
    _plain("ground_lamp", "#ffd9a0", 0.5, emit="#ffc98a", st=4 + 12 * lit)
    _plain("room_strip", "#ffb866", 0.5, emit="#ffb25a", st=2.5 + 4 * (1 - lit))
    objs = bpy.data.objects
    k = 1.0 - 0.55 * lit
    key, fill, sun = objs["key"].data, objs["fill"].data, objs["sun"].data
    key.energy = P.get("key", 3.2e7 * k)
    key.color = P.get("key_col", (1.0, 0.82, 0.62))
    fill.energy = P.get("fill", 0.9e7)
    sun.energy = P.get("sun", 3.2 * (1 - lit * 0.3))
    sun.color = (1.0, 0.62, 0.36)
    s = bpy.context.scene
    s.view_settings.exposure = P["exp"]
    bg = s.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.02, 0.025, 0.04, 1) if lit >= 0.99 else (0.03, 0.02, 0.014, 1)


def home_camera():
    """页面主机位（three.js 坐标 → Blender 坐标）：(位置, 目标, 竖直视场角)"""
    c = json.load(open(os.path.join(ROOT, "src", "views", "estate", "data", "camera.json")))["three"]
    p, t = c["position"], c["target"]
    return (Vector((p[0], -p[2], p[1])), Vector((t[0], -t[2], t[1])), c["fov"])


def set_camera(pos, tgt, fov, fstop=0.012):
    """建（或复用）场景相机并对准目标。景深用的是 1:250 微缩模型的等效光圈：距离越近 f 值按比例变小，让虚化观感一致"""
    ob = bpy.data.objects.get("CAM")
    if ob is None:
        cd = bpy.data.cameras.new("CAM")
        cd.sensor_fit = "VERTICAL"
        cd.clip_end = 20000
        cd.dof.use_dof = True
        ob = bpy.data.objects.new("CAM", cd)
        bpy.context.scene.collection.objects.link(ob)
    cd = ob.data
    cd.angle_y = math.radians(fov)
    d = (tgt - pos).length
    cd.dof.focus_distance = d
    cd.dof.aperture_fstop = fstop * (711.0 / d)
    ob.location = pos
    ob.rotation_euler = (tgt - pos).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = ob
    return ob


def configure_render(width, height, samples):
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        ok = False
        for d in prefs.devices:
            d.use = True
            ok = ok or d.type != "CPU"
        s.cycles.device = "GPU" if ok else "CPU"
    except Exception as e:  # noqa: BLE001
        print("GPU 设置失败，用 CPU：", e)
    s.cycles.samples = samples
    s.cycles.use_denoising = True
    s.cycles.denoiser = "OPENIMAGEDENOISE"
    s.cycles.max_bounces = 6
    s.cycles.diffuse_bounces = 3
    s.cycles.glossy_bounces = 3
    s.cycles.sample_clamp_indirect = 4.0
    s.render.resolution_x, s.render.resolution_y = width, height
    s.render.resolution_percentage = 100
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_depth = "8"
    vs = s.view_settings
    vs.view_transform = "AgX"
    vs.look = "None"
    for item in vs.bl_rna.properties["look"].enum_items:
        if "Punchy" in item.name or "Punchy" in item.identifier:
            vs.look = item.identifier
            break
    vs.exposure = 0.0
    w = bpy.data.worlds.new("WORLD")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.03, 0.02, 0.014, 1)
    bg.inputs[1].default_value = 0.6
    s.world = w


def add_glow(threshold=1.2, strength=0.35, size=0.45):
    """合成器里加一道泛光：亮窗和路灯往外晕开一圈。Blender 5 的 Glare 参数都是输入插槽，类型是菜单插槽
    （默认是星芒，会出十字光，所以要显式改成 Bloom / Fog Glow）；失败就跳过"""
    s = bpy.context.scene
    try:
        ng = bpy.data.node_groups.new("GLOW", "CompositorNodeTree")
        ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        rl = ng.nodes.new("CompositorNodeRLayers")
        gl = ng.nodes.new("CompositorNodeGlare")
        go = ng.nodes.new("NodeGroupOutput")

        def put(name, value):
            try:
                gl.inputs[name].default_value = value
                return True
            except Exception:  # noqa: BLE001
                return False

        if not put("Type", "Bloom"):
            put("Type", "Fog Glow")
        put("Quality", "High")
        put("Threshold", threshold)
        put("Strength", strength)
        put("Size", size)
        ng.links.new(rl.outputs["Image"], gl.inputs["Image"])
        ng.links.new(gl.outputs["Image"], go.inputs[0])
        s.compositing_node_group = ng
        return True
    except Exception as e:  # noqa: BLE001
        print("辉光合成器设置失败，跳过：", e)
        return False


def build_scene(lit=0.85):
    os.makedirs(RENDER_DIR, exist_ok=True)
    clear_scene()
    layout = json.load(open(os.path.join(ROOT, "src", "views", "estate", "data", "layout.json")))
    inst = json.load(open(os.path.join(RENDER_DIR, "scene_instances.json")))["instances"]
    M = make_materials()
    M["tree"] = material("tree", "#ffffff")
    buildings.build_all(layout, M)
    # 建筑里的外框盒不渲染
    for ob in bpy.data.objects:
        if ob.name.endswith("_hull"):
            ob.hide_render = True
            ob.hide_viewport = True
    apply_render_materials(M, lit)  # 先建出材质，之后 apply_lighting 会按光照档重设
    tmat = tree_material()
    tcol = collection("TREE_TEMPLATES")
    trees.build_trees(M)  # 产出 TREES 集合里 tree_a/b/c/cone
    for o in bpy.data.collections["TREES"].objects:
        o.data.materials.clear()
        o.data.materials.append(tmat)
        o.hide_render = True
    templates = {o.name: o.data for o in bpy.data.collections["TREES"].objects}
    # 树和小品
    veg = collection("VEG")
    trunk_mat = _plain("trunk", "#8a6a4c", 0.9)
    shrub_mat = shrub_material()
    from . import ez_trees

    tpl = ez_trees.load_templates(RENDER_DIR, _fresh, _mul_color)
    if tpl:
        tree_counts = ez_trees.place_all(veg, inst, tpl)
    else:  # 没有 ez-tree 的导出文件：退回自建的蓬松树冠
        tree_counts = {"fallback": True}
        for key, mesh in (("crown0", templates["tree_a"]), ("crown1", templates["tree_b"]), ("crown2", templates["tree_c"])):
            if key in inst:
                _place(veg, key, mesh, inst[key])
        for i, mesh in enumerate((templates["tree_a"], templates["tree_b"], templates["tree_c"])):
            key = f"crown2_{i}"
            if key in inst:
                _place(veg, key, mesh, inst[key])
        if "conifers" in inst:
            _place(veg, "cone", templates["cone"], inst["conifers"])
        if "trunks" in inst:
            _place(veg, "trunk", _template("trunk", trunk_mat), inst["trunks"], tint=False)
        if "shrubs" in inst:
            _place(veg, "shrub", _template("shrub", shrub_mat), inst["shrubs"])
    grass_counts = build_grass(collection("GRASS"))
    # 路灯、地灯、车
    props = collection("PROPS")
    lamp_dark = _plain("lamp_dark", "#2a2623", 0.6)
    lamp_head = _plain("lamp_head", "#ffd9a0", 0.5, emit="#ffd08a", st=20 + 50 * lit)
    ground_lamp = _plain("ground_lamp", "#ffd9a0", 0.5, emit="#ffc98a", st=4 + 12 * lit)
    _place(props, "pole", _template("pole", lamp_dark), inst["lamp_poles"], tint=False)
    _place(props, "head", _template("head", lamp_head), inst["lamp_heads"], tint=False)
    _place(props, "gl", _template("gl", ground_lamp), inst["ground_lamps"], tint=False)
    carm = _plain("car", "#ffffff", 0.35, metal=0.3)
    _place(props, "carb", _template("car_body", carm), inst["car_body"])
    _place(props, "carc", _template("car_cabin", carm), inst["car_cabin"])
    _place(props, "carh", _template("car_light", _plain("car_head", "#fff2cf", 0.4, emit="#fff2cf", st=20)), inst["car_heads"], tint=False)
    _place(props, "cart", _template("car_light", _plain("car_tail", "#ff3a2a", 0.4, emit="#ff3a2a", st=12)), inst["car_tails"], tint=False)
    build_context(collection("CONTEXT"), inst, M)
    build_table(M, os.path.join(RENDER_DIR, "ground_albedo.png"))
    build_water(M)
    build_room(M)
    configure_render(960, 540, 64)
    glow = add_glow()
    apply_lighting(M, {"lit": lit, "exp": 0.0})
    return {"M": M, "layout": layout, "glow": glow, "trees": tree_counts, "grass": grass_counts}


def build_and_render(out_png, lit=0.55, samples=64, width=960, height=540, fstop=0.012, exposure=0.0):
    """单张渲染（run_cli 的 cycles 命令）：建场景、设光照、从页面主机位拍一张"""
    info = build_scene(lit)
    configure_render(width, height, samples)
    apply_lighting(info["M"], {"lit": lit, "exp": exposure})
    set_camera(*home_camera(), fstop=fstop)
    bpy.context.scene.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    return {"png": out_png, "objects": len(bpy.data.objects), "glow": info["glow"], "trees": info["trees"], "grass": info["grass"]}

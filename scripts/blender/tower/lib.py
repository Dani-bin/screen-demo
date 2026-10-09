"""
楼层建模 · 通用工具（与 park / charging 的 lib 同风格，各脚本包互不依赖）
----------------------------------------------------------
坐标约定（Blender，Z 轴向上）：x 向东，y 向北，单位米；每个楼层模型以塔楼形心为原点、楼板顶面 z = 0。
导出 glTF 时 Y 轴向上：three.js 里 (x, y, z) = blender (x, z, -y)。
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector


def collection(name):
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if col.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(col)
    return col


def clear_scene():
    """清空对象、网格、材质、贴图、灯光与集合，保证每次重建一致"""
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.lights, bpy.data.cameras):
        for item in list(coll):
            coll.remove(item)
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)


def _lin(c):
    """'#rrggbb' 或 (r, g, b) sRGB 0..1 → 线性 RGBA"""
    if isinstance(c, str):
        c = c.lstrip("#")
        c = [int(c[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return (*[x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c], 1.0)


def material(name, color, rough=0.6, metal=0.0, emit=None, strength=0.0):
    """Principled 材质（同名复用）；emit 为自发光颜色（sRGB），strength 为强度（Cycles 里真实照亮周围）"""
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (300, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = _lin(color)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = _lin(emit)
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


def add_box(bm, size, center, rot=0.0, mat=0, bottom=False):
    """
    盒子（尺寸 sx, sy, sz；中心；绕 z 旋转 rot 弧度）。默认不要底面：家具底面贴地永远看不见，
    省三角形，也省烘焙贴图面积
    """
    sx, sy, sz = (s / 2 for s in size)
    m = Matrix.Translation(Vector(center)) @ Matrix.Rotation(rot, 4, "Z")
    corners = [m @ Vector((x * sx, y * sy, z * sz)) for z in (-1, 1) for y in (-1, 1) for x in (-1, 1)]
    v = [bm.verts.new(c) for c in corners]
    # 顶点序号：z-1 层 0..3（x,y = --,+-,-+,++），z+1 层 4..7；每个面按外法线逆时针
    faces = [
        (4, 5, 7, 6),  # 顶
        (0, 1, 5, 4),  # -y
        (1, 3, 7, 5),  # +x
        (3, 2, 6, 7),  # +y
        (2, 0, 4, 6),  # -x
    ]
    if bottom:
        faces.append((0, 2, 3, 1))
    for f in faces:
        face = bm.faces.new([v[i] for i in f])
        face.material_index = mat
    return v


def add_cyl(bm, r, h, center, seg=12, mat=0, cap=True):
    """竖直圆柱（无底面）"""
    cx, cy, cz = center
    bot = [bm.verts.new((cx + r * math.cos(2 * math.pi * i / seg), cy + r * math.sin(2 * math.pi * i / seg), cz)) for i in range(seg)]
    top = [bm.verts.new((v.co.x, v.co.y, cz + h)) for v in bot]
    for i in range(seg):
        j = (i + 1) % seg
        bm.faces.new((bot[i], bot[j], top[j], top[i])).material_index = mat
    if cap:
        bm.faces.new(top).material_index = mat


def add_poly(bm, ring, z, mat=0, down=False):
    """水平多边形（凸 / 凹都可，三角化）；down=True 法线朝下（天花）"""
    vs = [bm.verts.new((x, y, z)) for x, y in ring]
    f = bm.faces.new(list(reversed(vs)) if down else vs)
    f.material_index = mat
    bmesh.ops.triangulate(bm, faces=[f], quad_method="BEAUTY", ngon_method="EAR_CLIP")


def add_band(bm, ring, z0, z1, mat=0, outward=True):
    """沿闭合轮廓竖起一圈墙（楼板侧边 / 核心筒墙）"""
    n = len(ring)
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        vs = [bm.verts.new((a[0], a[1], z0)), bm.verts.new((b[0], b[1], z0)), bm.verts.new((b[0], b[1], z1)), bm.verts.new((a[0], a[1], z1))]
        bm.faces.new(vs if outward else list(reversed(vs))).material_index = mat


def new_object(name, bm, mats, col):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob

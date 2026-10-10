"""
园区建模 · 通用工具（复制自 charging/lib.py，两个脚本包互不依赖）
----------------------------------------------------------
在 Blender 里通过 MCP 执行（见 build.py）。只用 bpy / bmesh 数据 API，不依赖 bpy.ops 的上下文。

坐标约定（Blender，Z 轴向上）：x 向东，y 向北，单位米；场地中心为原点，沙盘顶面 z = 0。
导出 glTF 时 Blender 会自动换成 Y 轴向上：three.js 里 x 向东、y 向上、z 向南。

材质只用 Principled BSDF 的常量参数 + 图片贴图，保证 glTF 能原样导出
（程序化纹理节点导不出去）。自发光部件统一用 emissive 材质，强度在 three.js 里再按状态调。
"""

import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

# 贴图输出目录：models/park/textures（由 build.py 设置）
TEX_DIR = ""


# ---------------------------------------------------------------- 集合 / 场景


def collection(name, parent=None):
    """取得或创建集合，挂到父集合（默认场景根集合）下"""
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
    parent = parent or bpy.context.scene.collection
    if col.name not in [c.name for c in parent.children]:
        parent.children.link(col)
    return col


def clear_scene():
    """清空场景里的全部对象、网格、材质、贴图与集合，保证每次重建结果一致"""
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for item in list(coll):
            coll.remove(item)
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)


# ---------------------------------------------------------------- 材质


def _hex(c):
    """'#rrggbb' → 线性空间 RGBA（Principled 的颜色输入是线性的）"""
    c = c.lstrip("#")
    srgb = [int(c[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in srgb]
    return (*lin, 1.0)


def material(name, color="#808080", metal=0.0, rough=0.5, emit=None, strength=0.0, alpha=1.0, tex=None, emit_tex=False):
    """
    创建（或复用同名）Principled 材质。
    emit：自发光颜色；strength：自发光强度（glTF 导出为 KHR_materials_emissive_strength）
    tex：图片贴图（bpy Image），接到 Base Color；emit_tex=True 时同时接到 Emission Color
    """
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF") if nt else None
    if bsdf is None:
        # Blender 5 新建材质不再自带节点，手动补上 Principled + 输出
        if nt is None:
            m.use_nodes = True
            nt = m.node_tree
        nt.nodes.clear()
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        out.location = (300, 0)
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = _hex(color)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if emit:
        bsdf.inputs["Emission Color"].default_value = _hex(emit)
        bsdf.inputs["Emission Strength"].default_value = strength
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    if tex is not None:
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = tex
        node.location = (-400, 200)
        nt.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
        if emit_tex:
            nt.links.new(node.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = strength or 1.0
    return m


def image(name, w, h, painter, colorspace="sRGB"):
    """
    用 numpy 画一张贴图并存成 PNG（TEX_DIR/<name>.png），导出 glTF 时会打包进 GLB。
    painter(arr)：arr 为 (h, w, 4) 的 float32，原点在左下角，取值 0..1
    """
    img = bpy.data.images.get(name)
    if img is not None:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, w, h, alpha=True)
    arr = np.zeros((h, w, 4), dtype=np.float32)
    arr[..., 3] = 1.0
    painter(arr)
    img.pixels.foreach_set(arr.ravel())
    path = os.path.join(TEX_DIR, name + ".png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    img.colorspace_settings.name = colorspace
    return img


# ---------------------------------------------------------------- 网格构造


def new_object(name, bm, mat_list, col, smooth_angle=None):
    """bmesh → 网格对象；mat_list 为材质列表（面 material_index 对应其下标）"""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mat_list:
        me.materials.append(m)
    if smooth_angle is not None:
        # 圆角件：整体平滑，超过角度的边保持锐利
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
        me.set_sharp_from_angle(angle=math.radians(smooth_angle))
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


def link_copy(src, name, col, loc=(0, 0, 0), rot_z=0.0, parent=None):
    """共享网格数据的副本（glTF 导出时复用同一份网格，体积小）"""
    ob = bpy.data.objects.new(name, src.data)
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    col.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def empty(name, col, loc=(0, 0, 0), rot_z=0.0, parent=None):
    """空对象：作为桩、车位等逻辑单元的父节点，便于 three.js 按名字整体查找"""
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = 0.5
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    col.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def _uv_box(bm, scale=1.0):
    """按面法线做盒式投影 UV（世界尺度，scale 米对应 1 个 UV 单位），用于可平铺贴图"""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            co = l.vert.co
            if ax == 2:
                l[uv].uv = (co.x / scale, co.y / scale)
            elif ax == 1:
                l[uv].uv = (co.x / scale, co.z / scale)
            else:
                l[uv].uv = (co.y / scale, co.z / scale)


def add_box(bm, size, center=(0, 0, 0), bevel=0.0, segments=2, mat=0, rot_z=0.0):
    """
    往 bmesh 里加一个长方体：size=(宽x, 深y, 高z)，center 为几何中心。
    bevel>0 时倒圆角（segments 段）。返回新增的面列表。
    """
    tmp = bmesh.new()
    bmesh.ops.create_cube(tmp, size=1.0)
    bmesh.ops.scale(tmp, vec=Vector(size), verts=tmp.verts)
    if bevel > 0:
        bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=bevel, offset_type="OFFSET", segments=segments, profile=0.5, affect="EDGES", clamp_overlap=True)
    m = Matrix.Translation(Vector(center)) @ Matrix.Rotation(rot_z, 4, "Z")
    bmesh.ops.transform(tmp, matrix=m, verts=tmp.verts)
    for f in tmp.faces:
        f.material_index = mat
    return _merge(bm, tmp)


def add_cyl(bm, r, h, center=(0, 0, 0), seg=16, mat=0, axis="Z", r2=None):
    """圆柱（或圆台，r2 为顶部半径），center 为几何中心；axis 为轴向"""
    tmp = bmesh.new()
    bmesh.ops.create_cone(tmp, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    if axis == "X":
        bmesh.ops.rotate(tmp, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "Y"), verts=tmp.verts)
    elif axis == "Y":
        bmesh.ops.rotate(tmp, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "X"), verts=tmp.verts)
    bmesh.ops.translate(tmp, vec=Vector(center), verts=tmp.verts)
    for f in tmp.faces:
        f.material_index = mat
    return _merge(bm, tmp)


def add_torus(bm, R, r, center=(0, 0, 0), seg=32, seg2=8, mat=0):
    """水平圆环（绕 Z 轴）"""
    tmp = bmesh.new()
    rings = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        ring = []
        for j in range(seg2):
            b = 2 * math.pi * j / seg2
            rr = R + r * math.cos(b)
            ring.append(tmp.verts.new((rr * math.cos(a), rr * math.sin(a), r * math.sin(b))))
        rings.append(ring)
    for i in range(seg):
        for j in range(seg2):
            a, b = rings[i], rings[(i + 1) % seg]
            tmp.faces.new((a[j], b[j], b[(j + 1) % seg2], a[(j + 1) % seg2]))
    bmesh.ops.translate(tmp, vec=Vector(center), verts=tmp.verts)
    for f in tmp.faces:
        f.material_index = mat
    return _merge(bm, tmp)


def add_ico(bm, r, center=(0, 0, 0), sub=1, mat=0, scale=(1, 1, 1)):
    """二十面体球（树冠等），可非等比缩放"""
    tmp = bmesh.new()
    bmesh.ops.create_icosphere(tmp, subdivisions=sub, radius=r)
    bmesh.ops.scale(tmp, vec=Vector(scale), verts=tmp.verts)
    bmesh.ops.translate(tmp, vec=Vector(center), verts=tmp.verts)
    for f in tmp.faces:
        f.material_index = mat
    return _merge(bm, tmp)


def add_prism(bm, pts, z0, z1, mat=0, top_mat=None, bevel=0.0):
    """
    任意多边形（xy 平面，逆时针）挤出成柱体：底 z0，顶 z1。
    top_mat：顶面单独的材质下标（如地面涂装）
    """
    tmp = bmesh.new()
    vb = [tmp.verts.new((x, y, z0)) for x, y in pts]
    vt = [tmp.verts.new((x, y, z1)) for x, y in pts]
    n = len(pts)
    tmp.faces.new(list(reversed(vb)))
    top = tmp.faces.new(vt)
    for i in range(n):
        tmp.faces.new((vb[i], vb[(i + 1) % n], vt[(i + 1) % n], vt[i]))
    bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)
    for f in tmp.faces:
        f.material_index = mat
    if top_mat is not None:
        top.material_index = top_mat
    if bevel > 0:
        edges = [e for e in tmp.edges if abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-6 and e.verts[0].co.z == z1]
        bmesh.ops.bevel(tmp, geom=edges, offset=bevel, offset_type="OFFSET", segments=2, profile=0.5, affect="EDGES", clamp_overlap=True)
    return _merge(bm, tmp)


def add_profile(bm, pts, width, mat=0, bevel=0.0, axis="X"):
    """
    侧面轮廓（xz 平面上的点列，x 沿长度、z 向上）沿 y 方向挤出 width，居中于 y=0。
    用于车身、雨棚侧梁等。bevel>0 时对挤出后的轮廓边倒角。
    """
    tmp = bmesh.new()
    vs = [tmp.verts.new((x, -width / 2, z)) for x, z in pts]
    face = tmp.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(tmp, geom=[face])
    nv = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(tmp, vec=(0, width, 0), verts=nv)
    bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)
    if bevel > 0:
        edges = [e for e in tmp.edges if abs(e.verts[0].co.y - e.verts[1].co.y) < 1e-6]
        bmesh.ops.bevel(tmp, geom=edges, offset=bevel, offset_type="OFFSET", segments=3, profile=0.5, affect="EDGES", clamp_overlap=True)
    for f in tmp.faces:
        f.material_index = mat
    return _merge(bm, tmp)


def add_plane(bm, size, center=(0, 0, 0), mat=0, uv=None, rot=None):
    """
    水平矩形面（朝上）：size=(x, y)。uv 为 (u0, v0, u1, v1) 时写入 UV（整张贴图默认 0..1）。
    rot 为 3x3 旋转矩阵时可做竖直面板（屏幕、招牌）。
    """
    tmp = bmesh.new()
    sx, sy = size[0] / 2, size[1] / 2
    vs = [tmp.verts.new(p) for p in ((-sx, -sy, 0), (sx, -sy, 0), (sx, sy, 0), (-sx, sy, 0))]
    f = tmp.faces.new(vs)
    f.material_index = mat
    layer = tmp.loops.layers.uv.verify()
    u0, v0, u1, v1 = uv or (0, 0, 1, 1)
    for l, (u, v) in zip(f.loops, ((u0, v0), (u1, v0), (u1, v1), (u0, v1))):
        l[layer].uv = (u, v)
    if rot is not None:
        bmesh.ops.rotate(tmp, cent=(0, 0, 0), matrix=rot, verts=tmp.verts)
    bmesh.ops.translate(tmp, vec=Vector(center), verts=tmp.verts)
    return _merge(bm, tmp)


# 竖直面板的常用朝向：面朝 -y（南）、+y（北）、+x（东）、-x（西）
FACE_S = Matrix.Rotation(math.pi / 2, 3, "X")
FACE_N = Matrix.Rotation(math.pi, 3, "Z") @ Matrix.Rotation(math.pi / 2, 3, "X")
FACE_E = Matrix.Rotation(math.pi / 2, 3, "Z") @ Matrix.Rotation(math.pi / 2, 3, "X")
FACE_W = Matrix.Rotation(-math.pi / 2, 3, "Z") @ Matrix.Rotation(math.pi / 2, 3, "X")


def _merge(dst, src):
    """把临时 bmesh 的几何追加进目标 bmesh（保留材质下标与 UV），返回新增的面"""
    uv_src = src.loops.layers.uv.active
    uv_dst = dst.loops.layers.uv.verify()
    vmap = {}
    for v in src.verts:
        vmap[v] = dst.verts.new(v.co)
    faces = []
    for f in src.faces:
        try:
            nf = dst.faces.new([vmap[v] for v in f.verts])
        except ValueError:
            continue
        nf.material_index = f.material_index
        nf.smooth = f.smooth
        if uv_src is not None:
            for l_new, l_old in zip(nf.loops, f.loops):
                l_new[uv_dst].uv = l_old[uv_src].uv
        faces.append(nf)
    src.free()
    return faces


def uv_box(bm, scale=1.0):
    """对外暴露的盒式投影（只想要平铺贴图时整网格调用一次）"""
    _uv_box(bm, scale)


def add_tube(bm, pts, r, seg=8, mat=0):
    """沿折线 / 曲线点列扫出圆管（充电线、扶手），端口不封口"""
    tmp = bmesh.new()
    pts = [Vector(p) for p in pts]
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        a = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        u = t.cross(a).normalized()
        v = t.cross(u).normalized()
        rings.append([tmp.verts.new(p + (u * math.cos(2 * math.pi * k / seg) + v * math.sin(2 * math.pi * k / seg)) * r) for k in range(seg)])
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(seg):
            tmp.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
    for f in tmp.faces:
        f.material_index = mat
        f.smooth = True
    return _merge(bm, tmp)


def sag(p0, p1, drop, n=12):
    """两点间下垂的曲线点列（二次贝塞尔），用于充电线"""
    p0, p1 = Vector(p0), Vector(p1)
    mid = (p0 + p1) / 2
    mid.z = min(p0.z, p1.z) - drop
    return [(1 - t) ** 2 * p0 + 2 * (1 - t) * t * mid + t * t * p1 for t in (i / n for i in range(n + 1))]


def make_mesh(name, bm, mats, smooth_angle=None):
    """bmesh → 网格数据（不建对象），供多处共享引用"""
    me = bpy.data.meshes.get(name)
    if me is not None:
        bpy.data.meshes.remove(me)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    if smooth_angle is not None:
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
        me.set_sharp_from_angle(angle=math.radians(smooth_angle))
    return me


def place(me, name, col, loc=(0, 0, 0), rot_z=0.0, parent=None):
    """用共享网格数据摆放一个对象"""
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    col.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob

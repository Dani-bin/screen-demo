"""
十堰东环路综合能源站效果图 · 通用工具（网格构造部分复制自 energy/lib.py，各包独立维护）
----------------------------------------------------------
只用 bpy / bmesh 数据 API，可在无界面的 blender -b 里运行。

坐标：Blender x = 规划局部坐标 u（沿现状台地边线向东偏北），y = v（向北），z 向上，单位米。
本包只出效果图（不导出 glTF），材质可以随意用程序化节点。
"""

import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

# ---------------------------------------------------------------- 场景


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
    """清空场景（对象、网格、材质、贴图、集合、相机、灯光、曲线、字体），保证每次重建结果一致"""
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.curves,
                 bpy.data.cameras, bpy.data.lights, bpy.data.node_groups):
        for item in list(coll):
            coll.remove(item)
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)


# ---------------------------------------------------------------- 颜色 / 节点


def hex_lin(c, a=1.0):
    """'#rrggbb' → 线性空间 RGBA（节点颜色输入是线性的）"""
    c = c.lstrip("#")
    srgb = [int(c[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in srgb]
    return (*lin, a)


def sock(node, ident, out=False):
    """按 identifier 取节点插口（Mix 节点同名插口有多组，只能按 identifier 区分）"""
    for s in (node.outputs if out else node.inputs):
        if s.identifier == ident:
            return s
    for s in (node.outputs if out else node.inputs):
        if s.name == ident:
            return s
    raise KeyError(ident)


def new_material(name):
    """新建空材质，返回 (材质, 节点树, Principled, 输出)；Blender 5 新建材质不带节点，手动补"""
    m = bpy.data.materials.get(name)
    if m is not None:
        bpy.data.materials.remove(m)
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (400, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m, nt, bsdf, out


def mix_color(nt, fac, a, b):
    """RGBA 混合节点：fac 可为数值或输出插口，a / b 可为颜色元组或输出插口；返回结果插口"""
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    for key, val in (("Factor_Float", fac), ("A_Color", a), ("B_Color", b)):
        s = sock(n, key)
        if isinstance(val, bpy.types.NodeSocket):
            nt.links.new(val, s)
        else:
            s.default_value = val
    return sock(n, "Result_Color", out=True)


def noise(nt, scale, detail=4.0, coord="Object", rough=0.55):
    """噪声纹理（Fac 输出），默认用物体坐标（物体都在原点，等于世界米坐标）"""
    tc = nt.nodes.new("ShaderNodeTexCoord")
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    nt.links.new(tc.outputs[coord], n.inputs["Vector"])
    return n.outputs["Fac"]


def ramp(nt, fac, lo, hi):
    """把 fac 的 lo..hi 段拉伸到 0..1（ColorRamp 线性）"""
    r = nt.nodes.new("ShaderNodeValToRGB")
    r.color_ramp.elements[0].position = lo
    r.color_ramp.elements[1].position = hi
    nt.links.new(fac, r.inputs["Fac"])
    return r.outputs["Color"]


def math_node(nt, op, a, b=None):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    for i, val in enumerate((a, b)):
        if val is None:
            continue
        if isinstance(val, bpy.types.NodeSocket):
            nt.links.new(val, n.inputs[i])
        else:
            n.inputs[i].default_value = val
    return n.outputs[0]


def haze(nt, color_sock, bsdf, start=450.0, span=2600.0, amount=0.75, tint="#c4cfd9"):
    """远景空气透视：按相机距离把颜色推向灰蓝，并补一点同色自发光（远山不至于发黑）"""
    cam = nt.nodes.new("ShaderNodeCameraData")
    d = math_node(nt, "SUBTRACT", cam.outputs["View Distance"], start)
    d = math_node(nt, "DIVIDE", d, span)
    d = math_node(nt, "MINIMUM", math_node(nt, "MAXIMUM", d, 0.0), 1.0)
    d = math_node(nt, "POWER", d, 0.7)
    f = math_node(nt, "MULTIPLY", d, amount)
    nt.links.new(mix_color(nt, f, color_sock, hex_lin(tint)), bsdf.inputs["Base Color"])
    bsdf.inputs["Emission Color"].default_value = hex_lin(tint)
    nt.links.new(math_node(nt, "MULTIPLY", f, 0.55), bsdf.inputs["Emission Strength"])


# ---------------------------------------------------------------- 网格构造


def _merge(dst, src):
    """把临时 bmesh 的几何追加进目标 bmesh（保留材质下标与 UV），返回新增的面"""
    uv_src = src.loops.layers.uv.active
    uv_dst = dst.loops.layers.uv.verify()
    vmap = {v: dst.verts.new(v.co) for v in src.verts}
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


def add_box(bm, size, center=(0, 0, 0), bevel=0.0, segments=2, mat=0, rot_z=0.0):
    """长方体：size=(x, y, z)，center 为几何中心；bevel>0 倒圆角。返回新增的面"""
    tmp = bmesh.new()
    bmesh.ops.create_cube(tmp, size=1.0)
    bmesh.ops.scale(tmp, vec=Vector(size), verts=tmp.verts)
    if bevel > 0:
        bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=bevel, offset_type="OFFSET",
                        segments=segments, profile=0.5, affect="EDGES", clamp_overlap=True)
    m = Matrix.Translation(Vector(center)) @ Matrix.Rotation(rot_z, 4, "Z")
    bmesh.ops.transform(tmp, matrix=m, verts=tmp.verts)
    for f in tmp.faces:
        f.material_index = mat
    return _merge(bm, tmp)


def add_cyl(bm, r, h, center=(0, 0, 0), seg=16, mat=0, axis="Z", r2=None):
    """圆柱（或圆台，r2 为顶部半径），center 为几何中心；axis 为轴向"""
    tmp = bmesh.new()
    bmesh.ops.create_cone(tmp, cap_ends=True, cap_tris=False, segments=seg, radius1=r,
                          radius2=r if r2 is None else r2, depth=h)
    if axis == "X":
        bmesh.ops.rotate(tmp, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "Y"), verts=tmp.verts)
    elif axis == "Y":
        bmesh.ops.rotate(tmp, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "X"), verts=tmp.verts)
    bmesh.ops.translate(tmp, vec=Vector(center), verts=tmp.verts)
    for f in tmp.faces:
        f.material_index = mat
        f.smooth = True
    return _merge(bm, tmp)


def add_ico(bm, r, center=(0, 0, 0), sub=1, mat=0, scale=(1, 1, 1)):
    """二十面体球（树冠等），可非等比缩放"""
    tmp = bmesh.new()
    bmesh.ops.create_icosphere(tmp, subdivisions=sub, radius=r)
    bmesh.ops.scale(tmp, vec=Vector(scale), verts=tmp.verts)
    bmesh.ops.translate(tmp, vec=Vector(center), verts=tmp.verts)
    for f in tmp.faces:
        f.material_index = mat
        f.smooth = True
    return _merge(bm, tmp)


def add_prism(bm, pts, z0, z1, mat=0, top_mat=None, side_mat=None):
    """任意多边形（xy 平面）挤出成柱体：底 z0，顶 z1；z0 / z1 可为逐点列表（贴地）"""
    tmp = bmesh.new()
    n = len(pts)
    z0s = z0 if isinstance(z0, (list, tuple)) else [z0] * n
    z1s = z1 if isinstance(z1, (list, tuple)) else [z1] * n
    vb = [tmp.verts.new((x, y, z)) for (x, y), z in zip(pts, z0s)]
    vt = [tmp.verts.new((x, y, z)) for (x, y), z in zip(pts, z1s)]
    tmp.faces.new(list(reversed(vb)))
    top = tmp.faces.new(vt)
    sides = [tmp.faces.new((vb[i], vb[(i + 1) % n], vt[(i + 1) % n], vt[i])) for i in range(n)]
    for f in tmp.faces:
        f.material_index = mat
    if top_mat is not None:
        top.material_index = top_mat
    if side_mat is not None:
        for f in sides:
            f.material_index = side_mat
    # 凹多边形顶面三角化，避免渲染时 n 边形自动三角化出错
    bmesh.ops.triangulate(tmp, faces=[top] + [tmp.faces[0]])
    bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)
    return _merge(bm, tmp)


def add_quad(bm, pts3, mat=0, uv=None):
    """任意四边形（三维点），uv 为 4 个 UV 坐标"""
    tmp = bmesh.new()
    vs = [tmp.verts.new(p) for p in pts3]
    f = tmp.faces.new(vs)
    f.material_index = mat
    if uv:
        layer = tmp.loops.layers.uv.verify()
        for l, c in zip(f.loops, uv):
            l[layer].uv = c
    return _merge(bm, tmp)


def add_tube(bm, pts, r, seg=8, mat=0):
    """沿折线扫出圆管（栏杆、管线），端口不封口"""
    tmp = bmesh.new()
    pts = [Vector(p) for p in pts]
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        a = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        u = t.cross(a).normalized()
        v = t.cross(u).normalized()
        rings.append([tmp.verts.new(p + (u * math.cos(2 * math.pi * k / seg) + v * math.sin(2 * math.pi * k / seg)) * r)
                      for k in range(seg)])
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(seg):
            tmp.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
    for f in tmp.faces:
        f.material_index = mat
        f.smooth = True
    return _merge(bm, tmp)


def uv_world(bm, scale=1.0):
    """按面法线做盒式投影 UV（世界尺度，scale 米对应 1 个 UV 单位）"""
    uv = bm.loops.layers.uv.verify()
    bm.normal_update()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for lp in f.loops:
            co = lp.vert.co
            if ax == 2:
                lp[uv].uv = (co.x / scale, co.y / scale)
            elif ax == 1:
                lp[uv].uv = (co.x / scale, co.z / scale)
            else:
                lp[uv].uv = (co.y / scale, co.z / scale)


def make_mesh(name, bm, mats, smooth_angle=None):
    """bmesh → 网格数据（不建对象），供多处共享引用"""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    if smooth_angle is not None:
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
        me.set_sharp_from_angle(angle=math.radians(smooth_angle))
    return me


def place(me, name, col, loc=(0, 0, 0), rot_z=0.0, scale=1.0):
    """用共享网格数据摆放一个对象"""
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    if scale != 1.0:
        ob.scale = (scale, scale, scale) if not isinstance(scale, tuple) else scale
    col.objects.link(ob)
    return ob


def obj(name, bm, mats, col, smooth_angle=None):
    """bmesh → 新对象（放在原点）"""
    return place(make_mesh(name, bm, mats, smooth_angle), name, col)


# ---------------------------------------------------------------- 二维几何（规划坐标）


def chaikin(pts, n=3):
    """Chaikin 细分（保留首尾点）"""
    for _ in range(n):
        out = [pts[0]]
        for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
            out += [(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1), (0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1)]
        out.append(pts[-1])
        pts = out
    return pts


def offset(pts, d):
    """折线向右（前进方向右手侧）偏移 d；d < 0 向左"""
    out = []
    for i, (x, y) in enumerate(pts):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, len(pts) - 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        n = math.hypot(tx, ty) or 1.0
        out.append((x + ty / n * d, y - tx / n * d))
    return out


def walk(pts, step, start=0.0):
    """沿折线按弧长等距取点，返回 [(点, 单位切向, 弧长)]"""
    seg = [math.dist(a, b) for a, b in zip(pts[:-1], pts[1:])]
    total, out, s, i, acc = sum(seg), [], start, 0, 0.0
    while s <= total and seg:
        while i < len(seg) - 1 and acc + seg[i] < s:
            acc += seg[i]
            i += 1
        k = (s - acc) / seg[i] if seg[i] else 0.0
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        out.append(((x0 + (x1 - x0) * k, y0 + (y1 - y0) * k), ((x1 - x0) / seg[i], (y1 - y0) / seg[i]), s))
        s += step
    return out


def length(pts):
    return sum(math.dist(a, b) for a, b in zip(pts[:-1], pts[1:]))


def inside(poly, p):
    """点是否在多边形内（射线法）"""
    x, y = p
    hit = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            hit = not hit
    return hit


def inside_np(poly, xs, ys):
    """向量化的点在多边形内判断"""
    hit = np.zeros(xs.shape, dtype=bool)
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        cond = (y1 > ys) != (y2 > ys)
        with np.errstate(divide="ignore", invalid="ignore"):
            xc = x1 + (ys - y1) * (x2 - x1) / (y2 - y1)
        hit ^= cond & (xs < xc)
    return hit


def dist_polyline_np(pts, xs, ys):
    """向量化的点到折线距离"""
    d = np.full(xs.shape, np.inf)
    for (x1, y1), (x2, y2) in zip(pts[:-1], pts[1:]):
        ex, ey = x2 - x1, y2 - y1
        L2 = ex * ex + ey * ey or 1e-9
        t = np.clip(((xs - x1) * ex + (ys - y1) * ey) / L2, 0, 1)
        d = np.minimum(d, np.hypot(xs - (x1 + t * ex), ys - (y1 + t * ey)))
    return d


def poly_area(p):
    p = np.asarray(p, float)
    return 0.5 * abs(np.dot(p[:, 0], np.roll(p[:, 1], -1)) - np.dot(p[:, 1], np.roll(p[:, 0], -1)))


def scatter(poly, spacing, rng, avoid=(), margin=0.0, jitter=0.45):
    """在多边形内按近似间距撒点（抖动网格），avoid 为要避开的多边形列表"""
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    out = []
    y = min(ys) + spacing / 2
    while y < max(ys):
        x = min(xs) + spacing / 2
        while x < max(xs):
            p = (x + rng.uniform(-jitter, jitter) * spacing, y + rng.uniform(-jitter, jitter) * spacing)
            if inside(poly, p) and not any(inside(a, p) for a in avoid):
                if margin <= 0 or min(_dist_seg(p, a, b) for a, b in zip(poly, poly[1:] + poly[:1])) >= margin:
                    out.append(p)
            x += spacing
        y += spacing
    return out


def _dist_seg(p, a, b):
    ex, ey = b[0] - a[0], b[1] - a[1]
    L2 = ex * ex + ey * ey or 1e-9
    t = max(0.0, min(1.0, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / L2))
    return math.hypot(p[0] - a[0] - t * ex, p[1] - a[1] - t * ey)

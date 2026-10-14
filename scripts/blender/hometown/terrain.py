"""
老家沙盘建模 · 地面与沙盘
----------------------------------------------------------
site_grid.npz（build_site.py 生成）：
  vz   (ny+1, nx+1) 顶点高度
  cls  (ny, nx)     每个 0.5 m 格子的地块分类（见 site.json 的 classes）
  slab (ny, nx)     是否在沙盘范围内

ground()  所有在沙盘内的格子 → 一个网格对象 ground，每格的材质按地块分类；
          同材质的共面格子合并（梯田、院坝、厂区都是平的，面数能降一个数量级）；
          边界顶点沿边界平滑一下去掉锯齿，再向下挤出成沙盘侧面（紫红土切面）。
water()   池塘水面
"""

import math

import bmesh
import bpy
import numpy as np

from . import lib

# 地块分类值 → 材质键（下标 = 分类值 - 1）
ORDER = ["paddy", "dry", "veg", "wood", "pond_bed", "yard", "factory",
         "rubble", "road", "path", "bund", "house"]
BASE_Z = -7.0  # 沙盘底面高度（最低地面约 z=0）


def ortho_frame(meta, margin=2.0):
    """正交俯视贴图覆盖的范围（米）：沙盘外接框外扩 margin。"""
    xs = [p[0] for p in meta["slab"]]
    ys = [p[1] for p in meta["slab"]]
    return (min(xs) - margin, min(ys) - margin, max(xs) + margin,
            max(ys) + margin)


def load(npz_path):
    d = np.load(npz_path)
    return d["vz"], d["cls"], d["slab"].astype(bool), d["bank"].astype(np.float32)


def _grid_mesh(name, meta, vz, cls_mask, mat_idx, z_const=None, bank=None):
    """把 mask 内的格子做成网格：顶点只保留用到的那些。"""
    g = meta["grid"]
    G, x0, y1 = g["g"], g["x0"], g["y1"]
    ny, nx = cls_mask.shape
    rr, cc = np.nonzero(cls_mask)
    # 每格四个角的顶点编号（顶点网格是 (ny+1)×(nx+1)）
    W = nx + 1
    quad = np.stack([rr * W + cc, (rr + 1) * W + cc, (rr + 1) * W + cc + 1,
                     rr * W + cc + 1], axis=1)
    used, inv = np.unique(quad.ravel(), return_inverse=True)
    vr, vc = used // W, used % W
    vx = x0 + vc * G
    vy = y1 - vr * G
    vzz = np.full(len(used), z_const) if z_const is not None else \
        vz.ravel()[used]
    verts = np.stack([vx, vy, vzz], axis=1)
    faces = inv.reshape(-1, 4)
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.tolist(), [], faces.tolist())
    if mat_idx is not None:
        me.polygons.foreach_set("material_index", mat_idx.astype(np.int32))
    if bank is not None:
        # 田坎权重（顶点属性），材质里用它把稻田 / 菜地贴图平滑过渡成草坎
        at = me.attributes.new("bank", "FLOAT", "POINT")
        at.data.foreach_set("value", bank.ravel()[used].astype(np.float32))
    me.update()
    return me


def _planar_uv(bm, scale=4.0):
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for l in f.loops:
            co = l.vert.co
            l[uv].uv = (co.x / scale, co.y / scale)


def ground(meta, vz, cls, slab, M, col, bank=None):
    mask = slab & (cls > 0)
    idx = cls[mask].astype(np.int32) - 1
    me = _grid_mesh("ground", meta, vz, mask, idx, bank=bank)
    bm = bmesh.new()
    bm.from_mesh(me)

    # 边界去锯齿：沿边界环把每个边界顶点往两个边界邻点的中点挪，迭代几次
    bverts = [v for v in bm.verts if v.is_boundary]
    for _ in range(4):
        new = {}
        for v in bverts:
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(nb) == 2:
                new[v] = ((nb[0].co.x + nb[1].co.x) / 2 * 0.5 + v.co.x * 0.5,
                          (nb[0].co.y + nb[1].co.y) / 2 * 0.5 + v.co.y * 0.5)
        for v, (x, y) in new.items():
            v.co.x, v.co.y = x, y

    # 同材质共面合并：梯田、院坝、厂区等平面大幅减面；坡地（林地）基本不动
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.25),
                             verts=bm.verts, edges=bm.edges,
                             delimit={"MATERIAL"})
    _planar_uv(bm, 4.0)
    # 第二套 UV（Lightmap）：正交俯视渲染贴图的坐标，0..1 覆盖 ortho_frame(meta)
    x0, y0, x1, y1 = ortho_frame(meta)
    lm = bm.loops.layers.uv.new("Lightmap")
    for f in bm.faces:
        for l in f.loops:
            co = l.vert.co
            l[lm].uv = ((co.x - x0) / (x1 - x0), (co.y - y0) / (y1 - y0))

    # 沙盘侧面：边界边向下挤出到 BASE_Z
    bedges = [e for e in bm.edges if e.is_boundary]
    ext = bmesh.ops.extrude_edge_only(bm, edges=bedges)
    nverts = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)]
    for v in nverts:
        v.co.z = BASE_Z
    soil = len(ORDER)
    side_faces = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMFace)]
    uv = bm.loops.layers.uv.verify()
    for f in side_faces:
        f.material_index = soil
        for l in f.loops:
            co = l.vert.co
            l[uv].uv = ((co.x + co.y) / 8.0, (co.z - BASE_Z) / 9.0)
    # 底面封口
    bottom = [e for e in bm.edges if e.is_boundary]
    bmesh.ops.triangle_fill(bm, edges=bottom, use_beauty=False)
    for f in bm.faces:
        if all(abs(v.co.z - BASE_Z) < 1e-4 for v in f.verts):
            f.material_index = soil
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    for key in ORDER:
        me.materials.append(M[key])
    me.materials.append(M["soil"])
    ob = bpy.data.objects.new("ground", me)
    col.objects.link(ob)
    return ob


def water(meta, vz, cls, M, col):
    pond = cls == meta["classes"]["pond"]
    if not pond.any():
        return None
    me = _grid_mesh("pond_water", meta, vz, pond, None,
                    z_const=meta["pond_water"])
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1), verts=bm.verts,
                             edges=bm.edges)
    _planar_uv(bm, 8.0)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M["water"])
    ob = bpy.data.objects.new("pond_water", me)
    col.objects.link(ob)
    return ob

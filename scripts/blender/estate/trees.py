"""
澜岸云境沙盘 · 树冠模型
----------------------------------------------------------
页面里的树是实例化的（一万棵上下），所以每种树冠只做几十到两百面，靠"几团叠起来的蓬松球 + 径向法线 + 顶点色"
读成一棵树：
  tree_a  4 团阔叶树（最轻）
  tree_b  3 团细分过一次的阔叶树（最圆润）
  tree_c  5 团阔叶树（最松散）
  cone    三层塔形的针叶树
树冠以原点为中心、半径约 1 m；页面按 (r, r·0.9, r) 缩放后放在树干上。
顶点色 = 顶亮底暗的高度渐变 × 团与团之间的遮挡（算出来的，不用 Cycles）× 一点随机叶丛明暗，和页面的实例颜色相乘。
法线：把每个顶点的法线朝"离树冠中心的方向"拉 75 %，面再多也只读成一个软软的毛球，不出现小平面。
"""

import math

import bmesh
import bpy
from mathutils import Vector

from .lib import collection, rng


def _norm(v):
    l = math.sqrt(sum(x * x for x in v)) or 1.0
    return tuple(x / l for x in v)


def _crown(name, M, col, blobs, detail, seed, noise=0.12):
    """blobs: [(cx, cy, cz, 半径, 纵向压扁)]；返回对象"""
    r = rng(seed)
    bm = bmesh.new()
    own = {}  # 顶点序号 → 属于哪一团
    for bi, (cx, cy, cz, rad, sq) in enumerate(blobs):
        start = len(bm.verts)  # 细分会删掉中间顶点，所以按"新增的这一段"取，不用 ops 返回的引用
        bmesh.ops.create_icosphere(bm, subdivisions=detail, radius=1.0)
        bm.verts.ensure_lookup_table()
        for v in bm.verts[start:]:
            k = 1.0 + noise * (r() * 2 - 1)
            v.co = Vector((cx + v.co.x * rad * k, cy + v.co.y * rad * k, cz + v.co.z * rad * sq * k))
            own[v.index] = bi
    bm.verts.ensure_lookup_table()
    pos = [v.co.copy() for v in bm.verts]
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M["tree"])
    for p in me.polygons:
        p.use_smooth = True
    zs = [p.z for p in pos]
    z0, z1 = min(zs), max(zs)
    center = Vector((0, 0, (z0 + z1) / 2))
    cols = []
    normals = []
    for i, p in enumerate(pos):
        t = (p.z - z0) / ((z1 - z0) or 1.0)
        k = 0.62 + 0.5 * (t * t * (3 - 2 * t))
        # 团间遮挡：靠近别的团中心的点更暗
        occ = 0.0
        for bj, (cx, cy, cz, rad, sq) in enumerate(blobs):
            if bj == own.get(i):
                continue
            d = (p - Vector((cx, cy, cz))).length
            occ += max(0.0, 1.0 - d / (rad * 1.25))
        k *= 1.0 - min(0.35, 0.3 * occ)
        k *= 0.9 + 0.2 * r()
        cols.append((k * 1.03, k, k * 0.92, 1.0))
        n = (p - center).normalized()
        normals.append(n)
    attr = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    for li, loop in enumerate(me.loops):
        attr.data[li].color = cols[loop.vertex_index]
    me.color_attributes.active_color = attr
    # 法线朝径向拉 75 %
    mixed = []
    me.calc_normals() if hasattr(me, "calc_normals") else None
    for v in me.vertices:
        base = v.normal
        n = Vector((base.x * 0.25 + normals[v.index].x * 0.75, base.y * 0.25 + normals[v.index].y * 0.75, base.z * 0.25 + normals[v.index].z * 0.75)).normalized()
        mixed.append(n)
    try:
        me.normals_split_custom_set_from_vertices(mixed)
    except Exception as e:  # noqa: BLE001
        print("custom normals failed:", e)
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


def _broad(M, col, name, n, detail, seed):
    r = rng(seed)
    blobs = [(0.0, 0.0, 0.18, 0.62, 0.88)]
    for i in range(n):
        a = (i / n) * math.tau + r() * 0.8
        off = 0.36 + r() * 0.16
        blobs.append((math.cos(a) * off, math.sin(a) * off, -0.08 + r() * 0.28, 0.46 + r() * 0.12, 0.85))
    return _crown(name, M, col, blobs, detail, seed + 7)


def _cone(M, col, name, seed):
    """三层塔形：自下而上半径 1.0 / 0.74 / 0.46，总高 2.4（中心在原点）"""
    r = rng(seed)
    tiers = [(1.0, -1.2, -0.1), (0.76, -0.55, 0.55), (0.48, 0.1, 1.2)]
    bm = bmesh.new()
    for rad, zb, zt in tiers:
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=rad, radius2=0.02, depth=zt - zb)
        for v in res["verts"]:
            v.co.z += (zb + zt) / 2
            v.co.x += (r() - 0.5) * 0.06
            v.co.y += (r() - 0.5) * 0.06
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M["tree"])
    for p in me.polygons:
        p.use_smooth = True
    attr = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    for li, loop in enumerate(me.loops):
        z = me.vertices[loop.vertex_index].co.z
        t = (z + 1.2) / 2.4
        # 每层下沿暗、上沿亮；整体底暗顶亮
        tier_t = [(z - zb) / (zt - zb) for _, zb, zt in tiers if zb - 1e-4 <= z <= zt + 1e-4]
        tt = tier_t[-1] if tier_t else t
        k = (0.58 + 0.5 * t) * (0.8 + 0.2 * tt)
        attr.data[li].color = (k * 1.03, k, k * 0.92, 1.0)
    me.color_attributes.active_color = attr
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


def build_trees(M):
    col = collection("TREES")
    _broad(M, col, "tree_a", 4, 1, 11)
    _broad(M, col, "tree_b", 3, 2, 23)
    _broad(M, col, "tree_c", 5, 1, 37)
    _cone(M, col, "cone", 5)
    # 摆成一排方便预览（导出时位置无所谓，页面只取几何）
    for i, ob in enumerate(col.objects):
        ob.location = (i * 3.0 - 4.5, 0, 0)
    return [o.name for o in col.objects]

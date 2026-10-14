"""
老家沙盘建模 · 树木
----------------------------------------------------------
四种原型网格（只建一份），site.json 里每个树点用共享网格的副本摆放，
导出时成为 GPU 实例（three.js 里是 InstancedMesh）：
  cypress  柏木：川北丘陵最常见的细高常绿树。树干 + 沿干螺旋排布、越往上越小的叶簇，约 10 m
  broad    阔叶杂树（香樟 / 构树一类）：几根分枝 + 半球形分布的大小叶簇，约 8 m
  bamboo   慈竹丛：十几根从根部散开、向外弯垂的竹竿，竿梢挂细长竹叶簇，约 8 m
  loquat   枇杷：我家门前左侧那棵，矮、冠圆而密、叶色深，约 5 m
每个原型 2–4 千个三角面：沙盘全景下看得出树冠层次，近景也不显得是"几何球"。
"""

import math
import random

import bmesh
from mathutils import Matrix, Vector

from . import lib


def _clump(bm, center, r, mat, rnd, squash=0.8, sub=1):
    """一团叶簇：略压扁、随机缩放的二十面体。"""
    s = rnd.uniform(0.8, 1.15)
    lib.add_ico(bm, r * s, center, sub=sub, mat=mat,
                scale=(1, rnd.uniform(0.85, 1.15), squash))


def _branch(bm, p0, p1, r0, r1, mat):
    """从 p0 到 p1 的一段枝干（圆台）。"""
    a, b = Vector(p0), Vector(p1)
    lib.add_tube(bm, [a, (a + b) / 2, b], (r0 + r1) / 2, seg=5, mat=mat)


def _cypress(M, seed=1):
    rnd = random.Random(seed)
    bm = bmesh.new()
    H = 10.0
    lib.add_cyl(bm, 0.16, 3.0, (0, 0, 1.5), seg=6, mat=1, r2=0.1)
    n = 46
    for i in range(n):
        t = i / (n - 1)
        z = 2.2 + t * (H - 2.6)
        rad = 1.35 * (1 - t) ** 0.9 + 0.12        # 树冠半径：下宽上尖
        a = i * 2.4 + rnd.uniform(-0.3, 0.3)       # 黄金角螺旋，避免成排
        off = rad * rnd.uniform(0.35, 0.75)
        _clump(bm, (math.cos(a) * off, math.sin(a) * off, z),
               0.42 + 0.55 * (1 - t), 0, rnd, squash=0.9)
    lib.add_cyl(bm, 0.25, 1.2, (0, 0, H - 0.2), seg=6, mat=0, r2=0.02)
    return lib.make_mesh("tree_cypress", bm, [M["leaf_cypress"], M["trunk"]])


def _broad(M, seed=2):
    rnd = random.Random(seed)
    bm = bmesh.new()
    lib.add_cyl(bm, 0.22, 3.2, (0, 0, 1.6), seg=6, mat=1, r2=0.16)
    tips = []
    for k in range(5):                              # 五根主枝
        a = k * 1.256 + rnd.uniform(-0.3, 0.3)
        tip = (math.cos(a) * 2.0, math.sin(a) * 2.0, 5.0 + rnd.uniform(-0.4, 0.8))
        _branch(bm, (0, 0, 3.0), tip, 0.14, 0.06, 1)
        tips.append(tip)
    for k in range(34):                             # 半球形冠层上的叶簇
        u = rnd.uniform(0, 2 * math.pi)
        v = rnd.uniform(0.05, 1.0)
        rr = 2.9 * math.sqrt(1 - v * v) * rnd.uniform(0.75, 1.0)
        z = 4.6 + 2.6 * v
        _clump(bm, (math.cos(u) * rr, math.sin(u) * rr, z),
               rnd.uniform(0.75, 1.15), 0, rnd, squash=0.75)
    return lib.make_mesh("tree_broad", bm, [M["leaf_broad"], M["trunk"]])


def _bamboo(M, seed=3):
    rnd = random.Random(seed)
    bm = bmesh.new()
    for k in range(16):                             # 竹竿：从根部散开、向外弯
        a = rnd.uniform(0, 2 * math.pi)
        lean = rnd.uniform(0.15, 0.5)
        h = rnd.uniform(6.5, 9.0)
        ca, sa = math.cos(a), math.sin(a)
        base = (ca * rnd.uniform(0, 0.5), sa * rnd.uniform(0, 0.5), 0)
        pts = []
        for j in range(7):
            t = j / 6
            out = lean * h * t * t
            pts.append(Vector((base[0] + ca * out, base[1] + sa * out,
                               h * (t - 0.12 * t * t))))
        lib.add_tube(bm, pts, 0.045, seg=5, mat=1)
        for j in range(3, 7):                       # 竿上半段挂一串小竹叶簇
            for _ in range(2):
                p = pts[j]
                c = Vector((p.x + ca * rnd.uniform(0.1, 0.6) + rnd.uniform(-0.3, 0.3),
                            p.y + sa * rnd.uniform(0.1, 0.6) + rnd.uniform(-0.3, 0.3),
                            p.z - rnd.uniform(0.2, 0.7)))
                faces = lib.add_ico(bm, 0.42, c, sub=1, mat=0,
                                    scale=(1.6, 0.45, 0.3))
                vs = list({v for f in faces for v in f.verts})
                # 叶簇随机朝向、向下垂，避免一片片"盘子"
                rot = Matrix.Rotation(rnd.uniform(0, 6.283), 3, "Z") @ \
                    Matrix.Rotation(rnd.uniform(0.3, 0.9), 3, "Y")
                bmesh.ops.rotate(bm, verts=vs, cent=c, matrix=rot)
    return lib.make_mesh("tree_bamboo", bm, [M["leaf_bamboo"], M["culm"]])


def _loquat(M, seed=4):
    rnd = random.Random(seed)
    bm = bmesh.new()
    lib.add_cyl(bm, 0.2, 2.0, (0, 0, 1.0), seg=6, mat=1, r2=0.15)
    for k in range(4):
        a = k * 1.57 + 0.4
        _branch(bm, (0, 0, 1.6), (math.cos(a) * 1.2, math.sin(a) * 1.2, 2.9),
                0.1, 0.05, 1)
    for k in range(30):
        u = rnd.uniform(0, 2 * math.pi)
        v = rnd.uniform(-0.2, 1.0)
        rr = 2.3 * math.sqrt(max(0.0, 1 - v * v)) * rnd.uniform(0.8, 1.0)
        _clump(bm, (math.cos(u) * rr, math.sin(u) * rr, 3.3 + 1.7 * v),
               rnd.uniform(0.6, 0.9), 0, rnd, squash=0.8)
    return lib.make_mesh("tree_loquat", bm, [M["leaf_loquat"], M["trunk"]])


def build(meta, M, col):
    protos = {"cypress": _cypress(M), "broad": _broad(M),
              "bamboo": _bamboo(M), "loquat": _loquat(M)}
    n = 0
    for sp, x, y, z, s, rot in meta["trees"]:
        ob = lib.place(protos[sp], f"tree_{sp}_{n:04d}", col, loc=(x, y, z),
                       rot_z=rot)
        ob.scale = (s, s, s)
        n += 1
    return n

"""
候诊大厅人物 · 几何工具
----------------------------------------------------------
一个人物 = 一个网格 + 一个顶点色层 "Col"：所有零件都追加进同一个 bmesh，追加完马上给新顶点刷颜色。
这样导出 GLB 后每个人物只有一个网格、一个材质（three.js 里可以按变体做实例化，几十个人也只要几次绘制）。

软胶质感的部分（衣服、四肢、头发）用元球：同一次 metaball() 调用里的元素会融成一块，
负元素可以"挖掉"一块（比如把头发前面挖出脸）。元球的可见半径 ≈ 元素半径 × 0.575
（stiffness 2、threshold 0.6 时实测），所以接口里给的都是"看得见的半径"，内部再换算。

坐标：Blender Z 轴向上，人物面朝 -Y（导出 glTF 后在 three.js 里面朝 +Z），单位米。
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

K = 1 / 0.575  # 元球：可见半径 → 元素半径
_mb_count = [0]


def linear(hexcolor):
    """'#rrggbb' → 线性空间 RGBA（顶点色存线性值）"""
    c = hexcolor.lstrip("#")
    srgb = [int(c[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in srgb) + (1.0,)


def face_rot(normal):
    """把局部 -Y（零件的"正面"）转到 normal 方向的旋转（贴在头上的五官、口罩用）"""
    return Vector((0, -1, 0)).rotation_difference(Vector(normal).normalized())


def trs(c, rot=None, scale=(1, 1, 1)):
    q = rot if isinstance(rot, Quaternion) else (Quaternion() if rot is None else rot.to_quaternion())
    return Matrix.Translation(Vector(c)) @ q.to_matrix().to_4x4() @ Matrix.Diagonal((*scale, 1))


# ---------------------------------------------------------------- 元球元素（给的是可见半径）


def B(co, r, neg=False):
    """球"""
    return dict(t="BALL", co=co, r=r, neg=neg)


def E(co, r, size, rot=None, neg=False):
    """椭球：size = 三个轴向的倍数；rot = Quaternion / Euler"""
    return dict(t="ELLIPSOID", co=co, r=r, size=size, rot=rot, neg=neg)


def C(p0, p1, r):
    """胶囊：从 p0 到 p1、半径 r（四肢、发束）"""
    return dict(t="CAPSULE", p0=Vector(p0), p1=Vector(p1), r=r)


class Toy:
    """往一个 bmesh 里追加零件；finish() 输出网格"""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.col = self.bm.verts.layers.float_color.new("Col")
        self.n = 0

    def _paint(self, color):
        c = linear(color)
        self.bm.verts.ensure_lookup_table()
        for i in range(self.n, len(self.bm.verts)):
            self.bm.verts[i][self.col] = c
        self.n = len(self.bm.verts)

    # ---------- 元球：一组元素融成一块
    def metaball(self, elems, color, res=0.016):
        _mb_count[0] += 1
        name = f"MBtoy{_mb_count[0]}"  # 名字不带 "."：不同调用是不同"族"，不会互相融合
        mb = bpy.data.metaballs.new(name)
        mb.resolution = res
        mb.render_resolution = res
        mb.threshold = 0.6
        ob = bpy.data.objects.new(name, mb)
        bpy.context.scene.collection.objects.link(ob)
        for e in elems:
            if e["t"] == "CAPSULE":
                el = mb.elements.new(type="CAPSULE")
                d = e["p1"] - e["p0"]
                el.co = (e["p0"] + e["p1"]) / 2
                el.size_x = d.length / 2
                el.rotation = Vector((1, 0, 0)).rotation_difference(d.normalized()) if d.length > 1e-6 else Quaternion()
            else:
                el = mb.elements.new(type=e["t"])
                el.co = e["co"]
                if e["t"] == "ELLIPSOID":
                    el.size_x, el.size_y, el.size_z = e["size"]
                    if e.get("rot") is not None:
                        r = e["rot"]
                        el.rotation = r if isinstance(r, Quaternion) else r.to_quaternion()
                el.use_negative = e.get("neg", False)
            el.radius = e["r"] * K
            el.stiffness = 2.0
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        self.bm.from_mesh(me)
        bpy.data.objects.remove(ob)
        bpy.data.metaballs.remove(mb)
        bpy.data.meshes.remove(me)
        self._paint(color)

    # ---------- 规则体
    def sphere(self, c, r, color, scale=(1, 1, 1), rot=None, seg=(24, 14)):
        bmesh.ops.create_uvsphere(self.bm, u_segments=seg[0], v_segments=seg[1], radius=r, matrix=trs(c, rot, scale))
        self._paint(color)

    def cyl(self, p0, p1, r, color, seg=16, r2=None):
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        bmesh.ops.create_cone(
            self.bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=d.length,
            matrix=trs((p0 + p1) / 2, q),
        )
        self._paint(color)

    def box(self, c, size, color, rot=None, bevel=0.0):
        """方块（size = 长宽高），bevel > 0 时倒圆角"""
        ret = bmesh.ops.create_cube(self.bm, size=1.0, matrix=trs(c, rot, size))
        if bevel > 0:
            edges = list({e for v in ret["verts"] for e in v.link_edges})
            bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, segments=3, profile=0.5, affect="EDGES", clamp_overlap=True)
        self._paint(color)

    def torus(self, c, R, r, color, rot=None, arc=(0.0, 2 * math.pi), seg=(36, 10)):
        """圆环（局部 XY 平面，轴向 Z）；arc 给出起止角，可做半环（耳机头梁、拐杖把手）"""
        m = trs(c, rot)
        a0, a1 = arc
        closed = abs(a1 - a0 - 2 * math.pi) < 1e-6
        nu = seg[0] if closed else seg[0] + 1
        rings = []
        for i in range(nu):
            a = a0 + (a1 - a0) * i / seg[0]
            ca, sa = math.cos(a), math.sin(a)
            ring = []
            for j in range(seg[1]):
                b = 2 * math.pi * j / seg[1]
                p = Vector(((R + r * math.cos(b)) * ca, (R + r * math.cos(b)) * sa, r * math.sin(b)))
                ring.append(self.bm.verts.new(m @ p))
            rings.append(ring)
        for i in range(len(rings) - (0 if closed else 1)):
            ra, rb = rings[i], rings[(i + 1) % len(rings)]
            for j in range(seg[1]):
                self.bm.faces.new((ra[j], rb[j], rb[(j + 1) % seg[1]], ra[(j + 1) % seg[1]]))
        self._paint(color)

    def tube(self, pts, r, color, seg=8):
        """沿折线的细管（嘴巴、眼镜腿、听诊器管、挂绳）"""
        pts = [Vector(p) for p in pts]
        rings = []
        for i, p in enumerate(pts):
            d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            q = Vector((0, 0, 1)).rotation_difference(d)
            ring = []
            for j in range(seg):
                b = 2 * math.pi * j / seg
                ring.append(self.bm.verts.new(p + q @ Vector((r * math.cos(b), r * math.sin(b), 0))))
            rings.append(ring)
        for ra, rb in zip(rings, rings[1:]):
            for j in range(seg):
                self.bm.faces.new((ra[j], rb[j], rb[(j + 1) % seg], ra[(j + 1) % seg]))
        # 两端封口
        for ring, rev in ((rings[0], True), (rings[-1], False)):
            self.bm.faces.new(list(reversed(ring)) if rev else ring)
        self._paint(color)

    # ---------- 输出
    def finish(self, collection, seat=None):
        """seat=(原座面高, 新座面高)：座面以下按比例压扁、以上整体下移——
        人物按真实座椅（0.45 m）的坐姿搭好后，改成 Q 版小椅子的短腿比例；页面里再整体放大回 0.45 m 座面"""
        if seat:
            s0, s1 = seat
            for v in self.bm.verts:
                z = v.co.z
                v.co.z = z * s1 / s0 if z < s0 else z - (s0 - s1)
        me = bpy.data.meshes.new(self.name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self.bm.to_mesh(me)
        self.bm.free()
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(55))  # 圆角方块保持棱角，元球和球体保持光滑
        me.color_attributes.active_color = me.color_attributes["Col"]
        me.color_attributes.render_color_index = 0
        ob = bpy.data.objects.new(self.name, me)
        collection.objects.link(ob)
        return ob

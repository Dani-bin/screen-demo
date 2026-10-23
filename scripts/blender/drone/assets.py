"""
无人机巡检 · 化工园区建模 · 预制件
----------------------------------------------------------
每个函数用 bmesh 拼一个构件，返回网格数据（make_mesh），由 layout.py 摆放。
尺寸参数来自 site.json（定稿反投影），细节尺寸按常见做法取（注释里写明）。
参考图：docs/design/drone/design/ref/*.png（从 AI 场景图裁出的局部）。

局部坐标：z 向上，构件底部在 z = 0；长条构件（槽车、船）沿 +x。
"""

import math
import random

import bmesh
from mathutils import Matrix, Vector

from . import lib


class MB:
    """网格构建器：自动维护材质列表，调用 lib 的 add_* 时只传材质对象"""

    def __init__(self):
        self.bm = bmesh.new()
        self.mats = []

    def i(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def box(self, size, center, m, **kw):
        return lib.add_box(self.bm, size, center, mat=self.i(m), **kw)

    def cyl(self, r, h, center, m, **kw):
        return lib.add_cyl(self.bm, r, h, center, mat=self.i(m), **kw)

    def torus(self, R, r, center, m, **kw):
        return lib.add_torus(self.bm, R, r, center, mat=self.i(m), **kw)

    def ico(self, r, center, m, **kw):
        return lib.add_ico(self.bm, r, center, mat=self.i(m), **kw)

    def prism(self, pts, z0, z1, m, **kw):
        return lib.add_prism(self.bm, pts, z0, z1, mat=self.i(m), **kw)

    def tube(self, pts, r, m, seg=8):
        return lib.add_tube(self.bm, pts, r, seg=seg, mat=self.i(m))

    def plane(self, size, center, m, **kw):
        return lib.add_plane(self.bm, size, center, mat=self.i(m), **kw)

    def ring(self, r_out, r_in, z0, z1, m, seg=48):
        """竖直环形墙（防火堤、池壁）：外壁 + 内壁 + 顶面"""
        bm = self.bm
        k = self.i(m)
        vo0 = [bm.verts.new((r_out * math.cos(a), r_out * math.sin(a), z0)) for a in _angles(seg)]
        vo1 = [bm.verts.new((r_out * math.cos(a), r_out * math.sin(a), z1)) for a in _angles(seg)]
        vi0 = [bm.verts.new((r_in * math.cos(a), r_in * math.sin(a), z0)) for a in _angles(seg)]
        vi1 = [bm.verts.new((r_in * math.cos(a), r_in * math.sin(a), z1)) for a in _angles(seg)]
        for j in range(seg):
            n = (j + 1) % seg
            for f in (
                (vo0[j], vo0[n], vo1[n], vo1[j]),
                (vi0[n], vi0[j], vi1[j], vi1[n]),
                (vo1[j], vo1[n], vi1[n], vi1[j]),
            ):
                bm.faces.new(f).material_index = k

    def open_cyl(self, r, z0, z1, m, seg=48, inside=True):
        """无顶无底的圆筒壁（浮顶罐罐壁）；inside=True 时再加一层朝内的面，俯视能看到内壁"""
        bm = self.bm
        k = self.i(m)
        a = [bm.verts.new((r * math.cos(t), r * math.sin(t), z0)) for t in _angles(seg)]
        b = [bm.verts.new((r * math.cos(t), r * math.sin(t), z1)) for t in _angles(seg)]
        for j in range(seg):
            n = (j + 1) % seg
            bm.faces.new((a[j], a[n], b[n], b[j])).material_index = k
        if inside:
            ri = r - 0.12
            c = [bm.verts.new((ri * math.cos(t), ri * math.sin(t), z0)) for t in _angles(seg)]
            d = [bm.verts.new((ri * math.cos(t), ri * math.sin(t), z1)) for t in _angles(seg)]
            for j in range(seg):
                n = (j + 1) % seg
                bm.faces.new((c[n], c[j], d[j], d[n])).material_index = k
            for j in range(seg):
                n = (j + 1) % seg
                bm.faces.new((b[j], b[n], d[n], d[j])).material_index = k

    def disk(self, r, z, m, seg=48):
        bm = self.bm
        vs = [bm.verts.new((r * math.cos(t), r * math.sin(t), z)) for t in _angles(seg)]
        bm.faces.new(vs).material_index = self.i(m)

    def beam(self, a, b, t, m):
        """两点之间的方钢（截面 t×t），用于钢结构、桁架"""
        a, b = Vector(a), Vector(b)
        L = (b - a).length
        if L < 1e-3:
            return
        faces = self.box((L, t, t), (0, 0, 0), m)
        d = (b - a).normalized()
        rot = Vector((1, 0, 0)).rotation_difference(d).to_matrix().to_4x4()
        mat = Matrix.Translation((a + b) / 2) @ rot
        vs = {v for f in faces for v in f.verts}
        bmesh.ops.transform(self.bm, matrix=mat, verts=list(vs))

    def band(self, r, z0, z1, m, seg=20):
        """只有侧面的圆筒带（塔器保温接缝箍、罐壁加强圈），不封顶底，省面"""
        bm = self.bm
        k = self.i(m)
        a = [bm.verts.new((r * math.cos(t), r * math.sin(t), z0)) for t in _angles(seg)]
        b = [bm.verts.new((r * math.cos(t), r * math.sin(t), z1)) for t in _angles(seg)]
        for j in range(seg):
            n = (j + 1) % seg
            f = bm.faces.new((a[j], a[n], b[n], b[j]))
            f.material_index = k
            f.smooth = True

    def arc_deck(self, r0, r1, z, t, a0, a1, m, seg=12):
        """扇形环板（塔器、球罐的环形平台）：内径 r0、外径 r1、从角度 a0 到 a1，板厚 t，顶面在 z"""
        bm = self.bm
        k = self.i(m)
        angs = [a0 + (a1 - a0) * j / seg for j in range(seg + 1)]
        ring = lambda r, zz: [bm.verts.new((r * math.cos(a), r * math.sin(a), zz)) for a in angs]  # noqa: E731
        it, ot, ib, ob = ring(r0, z), ring(r1, z), ring(r0, z - t), ring(r1, z - t)
        for j in range(seg):
            for f in ((it[j], ot[j], ot[j + 1], it[j + 1]), (ob[j], ib[j], ib[j + 1], ob[j + 1]), (ot[j], ob[j], ob[j + 1], ot[j + 1]), (ib[j], it[j], it[j + 1], ib[j + 1])):
                bm.faces.new(f).material_index = k

    def arc_rail(self, r, z, a0, a1, m, seg=12, rr=0.06):
        """沿圆弧的护栏扶手（细管）"""
        pts = [(r * math.cos(a0 + (a1 - a0) * j / seg), r * math.sin(a0 + (a1 - a0) * j / seg), z) for j in range(seg + 1)]
        self.tube(pts, rr, m, seg=4)

    def rail_rect(self, x0, y0, x1, y1, z, m, t=0.08):
        """矩形平台四周的护栏扶手（只做顶部扶手一道，远看就是一圈细线）"""
        for a, b in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
            self.beam((a[0], a[1], z), (b[0], b[1], z), t, m)

    def lamp(self, p, m, s=0.9):
        """平台 / 管廊上的灯具：做得比真实灯具大（约 0.9 m），全景下才能亮成一个暖色光点"""
        self.box((s, s, s * 0.55), p, m)

    def mesh(self, name, smooth=None):
        return lib.make_mesh(name, self.bm, self.mats, smooth)


def _angles(seg):
    return [2 * math.pi * j / seg for j in range(seg)]


def _helix(r, z0, z1, turns, a0=0.0, n=40):
    return [(r * math.cos(a0 + 2 * math.pi * turns * k / n), r * math.sin(a0 + 2 * math.pi * turns * k / n), z0 + (z1 - z0) * k / n) for k in range(n + 1)]


# ---------------------------------------------------------------- 储罐


def _uv_cyl(mb, m, z0, z1):
    """给材质 m 的面写柱面展开 UV：u = 方位角（一周 0..1），v = (z - z0) / (z1 - z0)；跨 0° 接缝的面把 u 补齐"""
    k = mb.i(m)
    uv = mb.bm.loops.layers.uv.verify()
    for f in mb.bm.faces:
        if f.material_index != k:
            continue
        us = [math.atan2(l.vert.co.y, l.vert.co.x) / (2 * math.pi) + 0.5 for l in f.loops]
        if max(us) - min(us) > 0.5:
            us = [u + 1.0 if u < 0.5 else u for u in us]
        for l, u in zip(f.loops, us):
            l[uv].uv = (u, (l.vert.co.z - z0) / (z1 - z0))


def _uv_plan(mb, m, r):
    """给材质 m 的面写俯视平面 UV（罐心在贴图中心，直径 2r 对应整张贴图）"""
    k = mb.i(m)
    uv = mb.bm.loops.layers.uv.verify()
    for f in mb.bm.faces:
        if f.material_index == k:
            for l in f.loops:
                l[uv].uv = (l.vert.co.x / (2 * r) + 0.5, l.vert.co.y / (2 * r) + 0.5)


def _dome(mb, r, f, z0, m, seg=48, rings=5):
    """球冠形罐顶：底圆半径 r、矢高 f、底面在 z0（铝网壳顶 / 拱顶），平滑着色"""
    bm = mb.bm
    k = mb.i(m)
    R = (r * r + f * f) / (2 * f)
    zc = z0 + f - R
    rows = []
    for i in range(rings):
        rr = r * (1 - i / rings)
        zz = zc + math.sqrt(max(0.0, R * R - rr * rr))
        rows.append([bm.verts.new((rr * math.cos(a), rr * math.sin(a), zz)) for a in _angles(seg)])
    top = bm.verts.new((0, 0, z0 + f))
    for i in range(rings - 1):
        a, b = rows[i], rows[i + 1]
        for j in range(seg):
            n = (j + 1) % seg
            fc = bm.faces.new((a[j], a[n], b[n], b[j]))
            fc.material_index = k
            fc.smooth = True
    last = rows[-1]
    for j in range(seg):
        fc = bm.faces.new((last[j], last[(j + 1) % seg], top))
        fc.material_index = k
        fc.smooth = True


def tank_floating(M, name, d, h):
    """
    原料罐区大罐（定稿里是带浅灰铝网壳拱顶的白罐，按定稿做成"内浮顶 + 铝顶"的外观）：
    哑光罐壁（壁板接缝 / 下部污渍贴图）+ 铝网壳顶（径向接缝贴图）+ 罐沿包边 + 抗风圈 + 两道加强圈
    + 盘梯（踏步带 + 外侧扶手）+ 罐顶平台和通气口。
    """
    mb = MB()
    r = d / 2
    mb.open_cyl(r, 0, h, M["tank"], seg=56, inside=False)
    _uv_cyl(mb, M["tank"], 0, h)
    _dome(mb, r + 0.05, d * 0.11, h, M["tank_roof"], seg=56, rings=6)
    _uv_plan(mb, M["tank_roof"], r)
    mb.torus(r, 0.25, (0, 0, h), M["tank_ring"], seg=56, seg2=6)  # 罐沿包边角钢
    mb.torus(r + 0.6, 0.3, (0, 0, h - 1.4), M["tank_ring"], seg=56, seg2=6)  # 抗风圈
    for zz in (h * 0.35, h * 0.68):
        mb.band(r + 0.08, zz, zz + 0.35, M["tank_ring"], seg=56)  # 加强圈
    # 盘梯：贴着罐壁绕约 120°，外侧扶手
    mb.tube(_helix(r + 0.9, 0.5, h - 0.2, 0.33, a0=-1.9), 0.32, M["steel_dark"])
    mb.tube(_helix(r + 1.6, 1.4, h + 0.8, 0.33, a0=-1.9), 0.06, M["steel"])
    a1 = -1.9 + 2 * math.pi * 0.33
    mb.box((3, 3, 0.3), ((r + 1.4) * math.cos(a1), (r + 1.4) * math.sin(a1), h), M["steel_dark"])
    # 罐顶中心通气口 + 顶部检修平台
    mb.cyl(1.0, 1.0, (0, 0, h + d * 0.11 + 0.3), M["tank_ring"], seg=12)
    mb.box((4.0, 1.2, 0.25), (r * 0.6 * math.cos(a1), r * 0.6 * math.sin(a1), h + d * 0.06), M["steel_dark"])
    return mb.mesh(name, smooth=35)


def tank_fixed(M, name, d, h):
    """拱顶罐：哑光罐壁（贴图）+ 浅拱顶（径向接缝贴图）+ 罐沿 + 顶部护栏 + 盘梯 + 一道加强圈"""
    mb = MB()
    r = d / 2
    rise = 0.1 * d
    mb.open_cyl(r, 0, h, M["tank"], seg=40, inside=False)
    _uv_cyl(mb, M["tank"], 0, h)
    _dome(mb, r + 0.03, rise, h, M["tank_roof"], seg=40, rings=4)
    _uv_plan(mb, M["tank_roof"], r)
    mb.torus(r, 0.16, (0, 0, h), M["tank_ring"], seg=40, seg2=5)
    mb.torus(r * 0.55, 0.05, (0, 0, h + rise * 0.7 + 1.0), M["steel"], seg=24, seg2=4)
    mb.tube(_helix(r + 0.7, 0.4, h, 0.3, a0=-2.2), 0.25, M["steel_dark"])
    mb.band(r + 0.06, h * 0.5, h * 0.5 + 0.25, M["tank_ring"], seg=40)
    mb.cyl(0.6, 0.8, (0, 0, h + rise + 0.2), M["tank_ring"], seg=10)
    return mb.mesh(name, smooth=35)


def sphere_tank(M, name, d, zc):
    """球罐：哑光球壳（贴图）+ 赤道带 + 上下两道环缝带 + 10 根支柱 + 交叉拉杆 + 顶部平台 + 盘梯"""
    mb = MB()
    r = d / 2
    mb.ico(r, (0, 0, zc), M["tank"], sub=3)
    mb.torus(r + 0.05, 0.18, (0, 0, zc), M["tank_ring"], seg=48, seg2=5)
    for s in (-1, 1):
        lat = math.radians(38)
        mb.band(r * math.cos(lat) + 0.08, zc + s * r * math.sin(lat) - 0.12, zc + s * r * math.sin(lat) + 0.12, M["tank_ring"], seg=40)
    legs = []
    for k in range(10):
        a = 2 * math.pi * k / 10
        p = (r * 0.98 * math.cos(a), r * 0.98 * math.sin(a))
        legs.append(p)
        mb.cyl(0.45, zc, (p[0], p[1], zc / 2), M["tank"], seg=10)
    _uv_cyl(mb, M["tank"], 0, zc + r)
    for k in range(10):
        p, q = legs[k], legs[(k + 1) % 10]
        mb.beam((p[0], p[1], 0.8), (q[0], q[1], zc - 2.5), 0.12, M["steel_dark"])
        mb.beam((q[0], q[1], 0.8), (p[0], p[1], zc - 2.5), 0.12, M["steel_dark"])
    mb.cyl(2.2, 0.3, (0, 0, zc + r + 0.1), M["steel_dark"], seg=16)
    mb.torus(2.2, 0.05, (0, 0, zc + r + 1.1), M["steel"], seg=16, seg2=4)
    mb.tube(_helix(r + 1.0, 0.3, zc + r * 0.3, 0.25, a0=-1.6), 0.25, M["steel_dark"])
    return mb.mesh(name, smooth=40)


# ---------------------------------------------------------------- 装置


def column(M, name, r, h, seed=0):
    """
    塔器（定稿里装置区最醒目的银白色细高塔）：
    混凝土基础 + 裙座 + 塔体（每 ~5 m 一道保温接缝箍）+ 椭圆封头 + 塔顶吊柱；
    每 8–11 m 一层扇形格栅平台（左右交替、带护栏和两盏平台灯）；带护笼的爬梯；
    塔顶气相管沿塔身下到地面（定稿里塔顶都有一根弯下来的粗管），另有两根侧线管。
    """
    rnd = random.Random(seed)
    mb = MB()
    seg = 20
    mb.cyl(r + 1.4, 1.0, (0, 0, 0.5), M["concrete"], seg=seg)
    mb.cyl(r + 0.12, 4.0, (0, 0, 3.0), M["steel_dark"], seg=seg)
    mb.cyl(r, h - 5.0, (0, 0, 5.0 + (h - 5.0) / 2), M["column"], seg=seg)
    mb.cyl(r, r * 0.55, (0, 0, h + r * 0.275), M["column"], seg=seg, r2=r * 0.45)
    z = 9.0
    while z < h - 2:
        mb.band(r + 0.06, z, z + 0.3, M["steel"], seg=seg)
        z += 5.0
    # 塔顶吊柱（检修用）
    mb.beam((0, 0, h + r * 0.5), (0, 0, h + r * 0.5 + 4.0), 0.3, M["steel_dark"])
    mb.beam((0, 0, h + r * 0.5 + 4.0), (r + 1.5, 0, h + r * 0.5 + 4.0), 0.25, M["steel_dark"])
    # 平台：扇形，左右交替；最高一层是塔顶整圈平台
    z = rnd.uniform(9, 11)
    side = 0
    while z < h - 3:
        a0 = -math.pi / 2 - 1.2 + side * math.pi
        mb.arc_deck(r + 0.1, r + 1.6, z, 0.2, a0, a0 + 2.4, M["grating"], seg=8)
        mb.arc_rail(r + 1.55, z + 1.1, a0, a0 + 2.4, M["steel"], seg=8)
        for a in (a0 + 0.35, a0 + 2.05):
            mb.lamp(((r + 1.3) * math.cos(a), (r + 1.3) * math.sin(a), z + 2.2), M["lamp_unit"], 0.8)
        side = 1 - side
        z += rnd.uniform(8, 11)
    mb.arc_deck(r * 0.5, r + 1.4, h + 0.4, 0.25, 0, 2 * math.pi, M["grating"], seg=16)
    mb.arc_rail(r + 1.35, h + 1.5, 0, 2 * math.pi, M["steel"], seg=16)
    mb.lamp((r + 1.0, 0, h + 2.4), M["lamp_unit"], 0.9)
    # 护笼爬梯（南侧，正对相机）
    mb.box((1.0, 0.9, h - 2), (0.3 * r, -(r + 0.7), (h - 2) / 2 + 1.5), M["steel_dark"])
    # 塔顶气相管：从封头上冒出、翻过平台、沿塔身外侧一直下到地面
    top = h + r * 0.55
    vx = -(r + 2.2)
    mb.tube([(0, 0, top - 0.2), (0, 0, top + 1.6), (vx * 0.6, 0, top + 2.2), (vx, 0, top + 0.8), (vx, 0, 1.5)], 0.6 if r > 2.8 else 0.45, M["insulation"], seg=8)
    mb.tube([(-(r + 0.8), 1.2, 0.5), (-(r + 0.8), 1.2, h * rnd.uniform(0.6, 0.9))], 0.35, M["steel"], seg=6)
    mb.tube([(r * 0.6, r + 0.8, 0.5), (r * 0.6, r + 0.8, h * rnd.uniform(0.3, 0.6))], 0.3, M["insulation"], seg=6)
    return mb.mesh(name, smooth=40)


def frame(M, name, w, d, h, seed=0, top="auto"):
    """
    多层钢结构框架（定稿里装置区成片的"设备楼"）：每 ~6 m 一跨立柱、每 ~6 m 一层梁；
    各层部分开间铺格栅（连续开间合成一块，约四成是被灯照亮的暖色格栅）+ 护栏；
    层上放立式 / 卧式容器和换热器；每层梁下挂 2–5 盏灯；两端面 X 撑；南面一排立管、层间水平管；
    东端外挂之字形楼梯；顶层放空冷器（风机）或高容器。
    """
    rnd = random.Random(seed)
    mb = MB()
    nx = max(2, round(w / 6))
    ny = max(2, round(d / 6))
    floors = max(2, round(h / 6))
    xs = [-w / 2 + w * i / nx for i in range(nx + 1)]
    ys = [-d / 2 + d * j / ny for j in range(ny + 1)]
    zs = [h * k / floors for k in range(1, floors + 1)]
    bx, by = w / nx, d / ny
    sd = M["steel_dark"]
    for x in xs:
        for y in ys:
            mb.beam((x, y, 0), (x, y, h), 0.45, sd)
    for k, z in enumerate(zs):
        last = k == len(zs) - 1
        for x in xs:
            mb.beam((x, ys[0], z), (x, ys[-1], z), 0.32, sd)
        for y in ys:
            mb.beam((xs[0], y, z), (xs[-1], y, z), 0.32, sd)
        # 格栅：连续开间合成一块板（面数少，远看就是一层层铺板）
        fill = 0.92 if last else rnd.uniform(0.5, 0.85)
        for j in range(ny):
            i = 0
            while i < nx:
                if rnd.random() < fill:
                    i1 = i
                    while i1 + 1 < nx and rnd.random() < fill:
                        i1 += 1
                    m = M["grating_lit"] if (not last and rnd.random() < 0.3) else M["grating"]
                    x0, x1 = xs[i] + 0.15, xs[i1 + 1] - 0.15
                    mb.box((x1 - x0, by - 0.3, 0.12), ((x0 + x1) / 2, (ys[j] + ys[j + 1]) / 2, z + 0.06), m)
                    i = i1 + 2
                else:
                    i += 1
        for yy in (ys[0], ys[-1]):
            mb.beam((xs[0], yy, z + 1.1), (xs[-1], yy, z + 1.1), 0.08, M["pipe_yellow"])
        # 层上设备（顶层另做）
        if not last:
            room = zs[k + 1] - z - 0.8
            for _ in range(rnd.randint(1, 3)):
                i, j = rnd.randrange(nx), rnd.randrange(ny)
                cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
                kind = rnd.random()
                if kind < 0.4:
                    rr = min(bx, by) * rnd.uniform(0.16, 0.3)
                    hh = room * rnd.uniform(0.55, 0.95)
                    mb.cyl(rr, hh, (cx, cy, z + 0.12 + hh / 2), M["insulation"], seg=10)
                elif kind < 0.75:
                    rr = rnd.uniform(0.5, 1.0)
                    L = min(bx * rnd.uniform(0.9, 1.7), w - 1.0)
                    cx = max(xs[0] + L / 2 + 0.3, min(xs[-1] - L / 2 - 0.3, cx))
                    mb.cyl(rr, L, (cx, cy, z + 0.5 + rr), M["insulation"], seg=10, axis="X")
                else:
                    for q in (-0.6, 0.6):
                        mb.cyl(0.45, by * 0.85, (cx + q, cy, z + 0.7), M["steel"], seg=8, axis="Y")
        # 梁下挂灯
        for _ in range(rnd.randint(2, 5)):
            if rnd.random() < 0.6:
                p = (rnd.uniform(xs[0], xs[-1]), rnd.choice((ys[0], ys[-1])), z - 0.45)
            else:
                p = (rnd.choice((xs[0], xs[-1])), rnd.uniform(ys[0], ys[-1]), z - 0.45)
            mb.lamp(p, M["lamp_unit"])
    # 底层地面上的设备（卧式容器）和一盏灯
    for _ in range(rnd.randint(1, 3)):
        cx, cy = rnd.uniform(xs[0] + 1.5, xs[-1] - 1.5), rnd.uniform(ys[0] + 1.5, ys[-1] - 1.5)
        L = min(bx * 1.4, w - 2)
        cx = max(xs[0] + L / 2 + 0.3, min(xs[-1] - L / 2 - 0.3, cx))
        mb.cyl(rnd.uniform(0.6, 1.1), L, (cx, cy, 1.4), M["insulation"], seg=10, axis="X")
    mb.lamp((rnd.uniform(xs[0], xs[-1]), ys[0], zs[0] * 0.55), M["lamp_unit"])
    # 两端面 X 撑（隔层）
    for x in (xs[0], xs[-1]):
        for k in range(0, floors, 2):
            z0, z1 = (0.0 if k == 0 else zs[k - 1]), zs[k]
            mb.beam((x, ys[0], z0), (x, ys[1], z1), 0.22, sd)
            mb.beam((x, ys[1], z0), (x, ys[0], z1), 0.22, sd)
    # 南面立管：从地面升到某层后拐进框架
    for _ in range(rnd.randint(3, 6)):
        x = rnd.uniform(xs[0] + 0.8, xs[-1] - 0.8)
        rr = rnd.choice((0.25, 0.3, 0.4, 0.5))
        zt = rnd.choice(zs[: max(1, len(zs) - 1)]) + 1.2
        m = M["insulation"] if rnd.random() < 0.5 else M["steel"]
        mb.tube([(x, ys[0] - 1.0, 0.4), (x, ys[0] - 1.0, zt), (x, ys[0] + 1.6, zt)], rr, m, seg=6)
    # 层间水平管：贯穿框架、两端各伸出 1.5 m（去往管廊）
    for _ in range(rnd.randint(1, 2)):
        z = rnd.choice(zs[: max(1, len(zs) - 1)]) + rnd.uniform(1.6, 3.0)
        y0 = rnd.uniform(ys[0] + 1, max(ys[0] + 1, ys[-1] - 4))
        for q in range(rnd.randint(3, 5)):
            rr = rnd.choice((0.2, 0.3, 0.4))
            mb.tube([(xs[0] - 1.5, y0 + q * 0.95, z), (xs[-1] + 1.5, y0 + q * 0.95, z)], rr, M["steel"], seg=6)
    # 东端楼梯塔（之字形梯段 + 休息平台，黄色）
    sx = xs[-1] + 1.6
    ya, yb = ys[0] + 0.6, ys[0] + min(5.0, d - 1.0)
    zp = 0.0
    for z in zs:
        zm = (zp + z) / 2
        mb.beam((sx, ya, zp), (sx, yb, zm), 0.3, M["pipe_yellow"])
        mb.beam((sx, yb, zm), (sx, ya, z), 0.3, M["pipe_yellow"])
        mb.box((2.2, 1.4, 0.12), (sx, yb + 0.5, zm), M["grating"])
        zp = z
    for yy in (ya - 0.6, yb + 1.2):
        mb.beam((sx + 1.1, yy, 0), (sx + 1.1, yy, h + 1.1), 0.22, sd)
    # 顶层：空冷器（风机箱 + 风筒）或高容器
    if top == "cooler" or (top == "auto" and rnd.random() < 0.55):
        cw_, cd_ = w * 0.92, min(d * 0.8, 12.0)
        mb.box((cw_, cd_, 1.4), (0, 0, h + 2.4), M["steel"])
        for sx_ in (-cw_ / 2 + 0.4, cw_ / 2 - 0.4):
            for sy_ in (-cd_ / 2 + 0.4, cd_ / 2 - 0.4):
                mb.beam((sx_, sy_, h), (sx_, sy_, h + 1.7), 0.3, sd)
        nf = max(2, round(cw_ / 5.5))
        rows = (-cd_ / 4, cd_ / 4) if cd_ > 8 else (0.0,)
        for q in range(nf):
            for yy in rows:
                mb.cyl(min(2.1, cd_ / 4.6), 0.6, (-cw_ / 2 + cw_ * (q + 0.5) / nf, yy, h + 3.4), sd, seg=8)
        mb.lamp((0, -cd_ / 2, h + 1.2), M["lamp_unit"])
    else:
        for _ in range(rnd.randint(1, 2)):
            rr = rnd.uniform(1.0, 1.6)
            hh = rnd.uniform(4, 9)
            cx = rnd.uniform(xs[0] + rr + 0.5, xs[-1] - rr - 0.5)
            cy = rnd.uniform(ys[0] + rr + 0.5, max(ys[0] + rr + 0.5, ys[-1] - rr - 0.5))
            mb.cyl(rr, hh, (cx, cy, h + hh / 2), M["insulation"], seg=12)
            mb.lamp((cx, cy - rr - 0.4, h + 1.6), M["lamp_unit"])
    return mb.mesh(name)


def drum(M, name, r, h, seed=0):
    """地面立式容器（回流罐、分离罐、反应器）：裙座 + 保温筒体 + 锥形封头 + 顶部小平台 + 爬梯 + 一盏灯"""
    rnd = random.Random(seed)
    mb = MB()
    mb.cyl(r + 0.8, 0.8, (0, 0, 0.4), M["concrete"], seg=12)
    mb.cyl(r + 0.08, 2.4, (0, 0, 2.0), M["steel_dark"], seg=12)
    mb.cyl(r, h - 3.2, (0, 0, 3.2 + (h - 3.2) / 2), M["insulation"], seg=14)
    mb.cyl(r, r * 0.5, (0, 0, h + r * 0.25), M["insulation"], seg=14, r2=r * 0.35)
    mb.band(r + 0.05, h * 0.55, h * 0.55 + 0.3, M["steel"], seg=14)
    a0 = rnd.uniform(0, 2 * math.pi)
    mb.arc_deck(r * 0.4, r + 1.2, h + r * 0.5 + 0.2, 0.2, a0, a0 + 2 * math.pi, M["grating"], seg=10)
    mb.arc_rail(r + 1.15, h + r * 0.5 + 1.3, a0, a0 + 2 * math.pi, M["pipe_yellow"], seg=10)
    mb.box((0.8, 0.8, h), (0, -(r + 0.6), h / 2 + 0.5), M["steel_dark"])
    mb.lamp((r + 0.9, 0, h + r * 0.5 + 2.2), M["lamp_unit"], 0.8)
    mb.tube([(r * 0.7, r * 0.7, h * 0.9), (r + 1.5, r + 1.5, h * 0.9), (r + 1.5, r + 1.5, 0.6)], 0.3, M["steel"], seg=6)
    return mb.mesh(name, smooth=40)


def furnace(M, name, w, d, h, seed=0):
    """
    裂解炉（U-1 南端一排）：架空炉底 + 辐射段炉膛（外露钢立柱）+ 两层环形平台（护栏、灯）
    + 炉底一排看火孔暖光 + 对流段 + 烟囱 + 两根急冷输送管。
    原先炉身上三条整宽灯带在全景里是三道刺眼的橙色横条，改成点状灯。
    """
    mb = MB()
    mb.box((w, d, 2.2), (0, 0, 1.1), M["steel_dark"])
    mb.box((w, d, h - 2.2), (0, 0, 2.2 + (h - 2.2) / 2), M["wall_dark"])
    n = max(2, round(w / 2.6))
    for sy in (-1, 1):
        for i in range(n + 1):
            x = -w / 2 + w * i / n
            mb.box((0.35, 0.4, h), (x, sy * (d / 2 + 0.2), h / 2), M["steel_dark"])
    for zf in (h * 0.38, h * 0.74):
        x0, y0, x1, y1 = -w / 2 - 1.5, -d / 2 - 1.5, w / 2 + 1.5, d / 2 + 1.5
        for sy in (-1, 1):
            mb.box((w + 3, 1.4, 0.15), (0, sy * (d / 2 + 0.8), zf), M["grating"])
        for sx in (-1, 1):
            mb.box((1.4, d + 3, 0.15), (sx * (w / 2 + 0.8), 0, zf), M["grating"])
        mb.rail_rect(x0, y0, x1, y1, zf + 1.1, M["pipe_yellow"])
        for p in ((x0, y0), (x1, y0), (0, y0), (x0, y1), (x1, y1)):
            mb.lamp((p[0], p[1], zf + 2.4), M["lamp_unit"], 0.8)
    # 看火孔：炉底南北两侧一排小暖光点
    for i in range(n):
        x = -w / 2 + w * (i + 0.5) / n
        for sy in (-1, 1):
            mb.box((0.5, 0.15, 0.4), (x, sy * (d / 2 + 0.05), 3.4), M["lamp_unit"])
    mb.box((w * 0.55, d * 0.6, h * 0.32), (0, 0, h + h * 0.16), M["steel_rust"])
    mb.rail_rect(-w * 0.3, -d * 0.32, w * 0.3, d * 0.32, h + h * 0.32 + 1.1, M["pipe_yellow"])
    mb.cyl(0.9, h * 0.75, (0, 0, h * 1.32 + h * 0.375), M["steel_dark"], seg=10)
    for sx in (-w * 0.25, w * 0.25):
        mb.tube([(sx, -d * 0.3, h + h * 0.2), (sx, -d / 2 - 2.0, h + h * 0.2), (sx, -d / 2 - 2.0, 1.0)], 0.55, M["insulation"], seg=8)
    return mb.mesh(name)


def exchanger(M, name, L, r):
    """卧式换热器 / 容器：筒体 + 管箱法兰 + 两个鞍座"""
    mb = MB()
    mb.cyl(r, L, (0, 0, r + 1.0), M["steel"], seg=14, axis="X")
    mb.cyl(r * 1.12, 0.4, (L / 2 - 0.6, 0, r + 1.0), M["steel_dark"], seg=14, axis="X")
    for x in (-L * 0.3, L * 0.3):
        mb.box((0.6, r * 1.6, r + 1.0), (x, 0, (r + 1.0) / 2), M["concrete"])
    return mb.mesh(name, smooth=40)


def small_building(M, name, w, d, h, seed=0):
    """装置区机柜间 / 分析小屋：浅灰实墙 + 南立面一排分开的小亮窗（不是整圈灯带）+ 屋面设备"""
    rnd = random.Random(seed)
    mb = MB()
    mb.box((w, d, h), (0, 0, h / 2), M["wall"])
    mb.box((w + 0.4, d + 0.4, 0.5), (0, 0, h + 0.25), M["roof"])
    n = max(2, int(w / 4))
    for i in range(n):
        if rnd.random() < 0.7:
            mb.box((1.6, 0.12, 1.2), (-w / 2 + w * (i + 0.5) / n, -d / 2 - 0.04, h * 0.6), M["window"])
    for _ in range(rnd.randint(1, 3)):
        mb.box((rnd.uniform(1.5, 3), rnd.uniform(1.5, 3), 1.2), (rnd.uniform(-w / 3, w / 3), rnd.uniform(-d / 3, d / 3), h + 1.1), M["steel"])
    return mb.mesh(name)


def hall(M, name, w, d, h, seed=0):
    """装置区大厂房（U-3 北侧的聚烯烃包装 / 仓储厂房）：实墙 + 平屋面 + 屋面采光带 / 风机 + 南立面一排窗、卷帘门"""
    rnd = random.Random(seed)
    mb = MB()
    mb.box((w, d, h), (0, 0, h / 2), M["wall"])
    mb.box((w + 0.6, d + 0.6, 0.6), (0, 0, h + 0.3), M["roof"])
    for i in range(3):
        mb.box((w * 0.8, 1.6, 0.25), (0, -d / 2 + d * (i + 1) / 4, h + 0.7), M["canopy"])
    for i in range(max(2, int(w / 8))):
        mb.cyl(0.8, 1.0, (-w / 2 + 4 + i * 8, d * 0.4, h + 1.1), M["steel"], seg=8)
    n = max(3, int(w / 5))
    for i in range(n):
        x = -w / 2 + w * (i + 0.5) / n
        if i % 4 == 1:
            mb.box((4.0, 0.2, 4.5), (x, -d / 2 - 0.08, 2.25), M["wall_dark"])
        elif rnd.random() < 0.75:
            mb.box((2.2, 0.15, 1.4), (x, -d / 2 - 0.06, h * 0.7), M["window"])
    for x in (-w / 2 + 2, w / 2 - 2):
        mb.lamp((x, -d / 2 - 0.8, h * 0.85), M["lamp_unit"], 0.8)
    return mb.mesh(name)


def pipe_rack_segment(M, name, L, w, z, seed=0, lamps=True):
    """
    一段管廊（沿 +x 长 L）：每 ~7 m 一榀门架（两柱、上下两道横梁、柱顶斜撑）+ 两侧纵梁；
    上层 6–9 根、下层 4–6 根管（银色裸管为主，约三成保温管、少量黄色管）；
    较长的段上隔 ~50 m 做一组向上拱起的 Π 形补偿器（俯视管廊最典型的特征）；每 ~16 m 一盏灯。
    """
    rnd = random.Random(seed)
    mb = MB()
    n = max(1, round(L / 7))
    sd = M["steel_dark"]
    z2 = z - 2.4
    for k in range(n + 1):
        x = -L / 2 + L * k / n
        for y in (-w / 2, w / 2):
            mb.beam((x, y, 0), (x, y, z), 0.45, sd)
        mb.beam((x, -w / 2, z), (x, w / 2, z), 0.4, sd)
        mb.beam((x, -w / 2, z2), (x, w / 2, z2), 0.35, sd)
        if w >= 6:
            mb.beam((x, -w / 2, z - 1.4), (x, -w / 2 + 1.4, z), 0.2, sd)
            mb.beam((x, w / 2, z - 1.4), (x, w / 2 - 1.4, z), 0.2, sd)
    for y in (-w / 2, w / 2):
        for zz in (z, z2):
            mb.beam((-L / 2, y, zz), (L / 2, y, zz), 0.25, sd)
    top = []
    for lv, cnt in ((z + 0.2, rnd.randint(6, 9) if w >= 6 else 5), (z2 + 0.2, rnd.randint(4, 6) if w >= 6 else 3)):
        for j in range(cnt):
            y = -w / 2 + 0.5 + (w - 1.0) * j / max(1, cnt - 1)
            rr = rnd.choice((0.2, 0.25, 0.3, 0.4, 0.5)) * (1.0 if w >= 6 else 0.8)
            q = rnd.random()
            m = M["pipe_yellow"] if q < 0.08 else (M["insulation"] if q < 0.38 else M["steel"])
            mb.tube([(-L / 2, y, lv + rr), (L / 2, y, lv + rr)], rr, m, seg=6)
            if lv > z:
                top.append((y, rr, m))
    # Π 形补偿器：取上层最粗的两三根管，在段中间隔 ~50 m 拱起 3–4 m
    if L > 40 and top:
        big = sorted(top, key=lambda t: -t[1])[: min(3, len(top))]
        nloops = max(1, int(L / 50))
        for li in range(nloops):
            xc = -L / 2 + L * (li + 0.5) / nloops + rnd.uniform(-4, 4)
            for bi, (y, rr, m) in enumerate(big):
                hh = 3.0 + bi * 0.7
                s = 2.5 + bi * 0.7
                lv = z + 0.2 + rr
                mb.tube([(xc - s, y, lv), (xc - s, y, lv + hh), (xc + s, y, lv + hh), (xc + s, y, lv)], rr, m, seg=6)
    if lamps:
        for k in range(int(L / 16) + 1):
            x = -L / 2 + 8 + k * 16
            if x < L / 2:
                mb.lamp((x, (w / 2 + 0.3) * (1 if k % 2 else -1), z - 0.6), M["lamp_unit"], 0.8)
    return mb.mesh(name)


# ---------------------------------------------------------------- 公用工程


def cooling_tower(M, name, d_base, d_top, h):
    """
    机械通风冷却塔：混凝土集水池 + 底部一圈进风百叶（竖向深色百叶条）+ 下宽上窄的塔筒（每 ~4 m 一道环缝）
    + 顶部风机平台（护栏、灯）+ 外挂之字形检修楼梯 + 风筒口（白汽由页面做）
    """
    mb = MB()
    rb, rt = d_base / 2, d_top / 2
    mb.cyl(rb + 1.2, 0.8, (0, 0, 0.4), M["concrete"], seg=36)
    mb.cyl(rb + 0.05, 3.6, (0, 0, 0.8 + 1.8), M["steel_dark"], seg=36)
    for k in range(24):  # 进风百叶之间的立柱（浅色），和深色百叶形成竖条
        a = 2 * math.pi * k / 24
        mb.box((0.5, 0.5, 3.6), ((rb + 0.15) * math.cos(a), (rb + 0.15) * math.sin(a), 2.6), M["wall"], rot_z=a)
    mb.cyl(rb, h - 4.4, (0, 0, 4.4 + (h - 4.4) / 2), M["wall"], seg=36, r2=rt)
    z = 8.0
    while z < h - 1.5:
        rr = rb + (rt - rb) * (z - 4.4) / (h - 4.4)
        mb.band(rr + 0.05, z, z + 0.25, M["wall_dark"], seg=36)
        z += 4.0
    mb.torus(rt, 0.35, (0, 0, h), M["wall"], seg=36, seg2=6)
    mb.disk(rt - 0.4, h + 0.02, M["steel_dark"], seg=36)
    mb.arc_rail(rt + 0.2, h + 1.1, 0, 2 * math.pi, M["pipe_yellow"], seg=24)
    mb.lamp((rt + 0.3, 0, h + 1.6), M["lamp_unit"], 0.8)
    # 外挂楼梯（南侧，之字形）
    sx, sy = 0.0, -(rb + 2.0)
    zp = 0.8
    while zp < h - 0.5:
        zn = min(h, zp + 4.0)
        a, b = (sx - 2.0, sy), (sx + 2.0, sy)
        if int(zp / 4) % 2:
            a, b = b, a
        mb.beam((a[0], a[1], zp), (b[0], b[1], zn), 0.35, M["pipe_yellow"])
        zp = zn
    for xx in (-2.4, 2.4):
        mb.beam((sx + xx, sy - 0.5, 0.8), (sx + xx, sy - 0.5, h + 1.0), 0.2, M["steel_dark"])
    return mb.mesh(name, smooth=40)


def cold_box(M, name, w, h, seed=0):
    """
    空分冷箱：高箱体（外壁铺板缝贴图 T_panel）+ 三层检修平台（格栅、护栏、灯）+ 护笼爬梯
    + 侧面几根竖管（顶上弯出去、底部拐到地面管廊）+ 顶部小平台和放空管
    """
    rnd = random.Random(seed)
    mb = MB()
    faces = mb.box((w, w, h), (0, 0, h / 2), M["panel"])
    uv = mb.bm.loops.layers.uv.verify()
    mb.bm.normal_update()
    for f in faces:
        n = f.normal
        for l in f.loops:
            co = l.vert.co
            s = co.y if abs(n.x) > 0.5 else co.x
            l[uv].uv = ((s if abs(n.z) < 0.5 else co.x) / 10.0, (co.z if abs(n.z) < 0.5 else co.y) / 10.0)
    for k in range(3):
        y = -w / 3 + k * w / 3
        mb.tube([(w / 2 + 0.8, y, 0.6), (w / 2 + 0.8, y, h * 0.92), (w / 2 - 1.0, y, h + 1.2)], 0.4 if k == 1 else 0.3, M["insulation"], seg=6)
        mb.tube([(w / 2 + 0.8, y, 0.6), (w / 2 + 4.5, y, 0.6)], 0.3, M["steel"], seg=6)
    for zf in (h * 0.3, h * 0.6, h * 0.88):
        mb.box((w + 3.0, 1.4, 0.15), (0, -w / 2 - 0.7, zf), M["grating"])
        mb.box((1.4, w + 3.0, 0.15), (-w / 2 - 0.7, 0, zf), M["grating"])
        mb.beam((-w / 2 - 1.4, -w / 2 - 1.4, zf + 1.1), (w / 2 + 1.5, -w / 2 - 1.4, zf + 1.1), 0.08, M["pipe_yellow"])
        mb.beam((-w / 2 - 1.4, -w / 2 - 1.4, zf + 1.1), (-w / 2 - 1.4, w / 2 + 1.5, zf + 1.1), 0.08, M["pipe_yellow"])
        mb.lamp((rnd.uniform(-w / 3, w / 3), -w / 2 - 1.2, zf + 2.3), M["lamp_unit"], 0.8)
    mb.box((1.0, 1.0, h), (-w / 2 - 0.9, w / 3, h / 2), M["steel_dark"])
    mb.rail_rect(-w / 2 + 0.3, -w / 2 + 0.3, w / 2 - 0.3, w / 2 - 0.3, h + 1.1, M["pipe_yellow"])
    mb.cyl(0.35, 4.0, (w * 0.25, w * 0.25, h + 2.0), M["steel"], seg=6)
    mb.lamp((0, -w / 2 + 0.8, h + 1.6), M["lamp_unit"], 0.8)
    return mb.mesh(name)


def basin(M, name, d):
    """
    污水处理圆池（辐流式沉淀池）：池壁 + 池顶环形走道（护栏）+ 水面 + 中心驱动平台
    + 横跨整个直径的刮泥桥（两道桁架弦杆 + 斜腹杆 + 桥面走道）+ 出水堰槽 + 桥上两盏灯
    """
    mb = MB()
    r = d / 2
    mb.ring(r, r - 0.8, 0, 2.0, M["concrete"], seg=48)
    mb.arc_rail(r - 0.1, 3.1, 0, 2 * math.pi, M["steel"], seg=32)
    mb.ring(r - 1.6, r - 2.2, 0.8, 1.55, M["concrete"], seg=40)  # 出水堰槽
    mb.disk(r - 0.8, 1.3, M["basin_water"], seg=48)
    mb.cyl(2.0, 3.2, (0, 0, 1.6), M["concrete"], seg=12)
    mb.box((4.4, 4.4, 0.3), (0, 0, 3.3), M["grating"])
    mb.rail_rect(-2.2, -2.2, 2.2, 2.2, 4.4, M["pipe_yellow"])
    mb.box((2.0, 1.6, 1.2), (0, 0, 4.0), M["steel_dark"])
    # 刮泥桥：沿 x 横跨直径（两道弦杆在 y = ±0.9，上下两层，斜腹杆每 3 m）
    L = 2 * r - 1.0
    for y in (-0.9, 0.9):
        for zz in (2.4, 3.6):
            mb.beam((-L / 2, y, zz), (L / 2, y, zz), 0.2, M["steel"])
        n = int(L / 3)
        for k in range(n):
            xa = -L / 2 + L * k / n
            xb = -L / 2 + L * (k + 1) / n
            mb.beam((xa, y, 2.4 if k % 2 else 3.6), (xb, y, 3.6 if k % 2 else 2.4), 0.12, M["steel"])
    mb.box((L, 1.6, 0.12), (0, 0, 2.45), M["grating"])
    for x in (-L / 2 + 1.0, L / 2 - 1.0):
        mb.box((1.6, 2.4, 1.6), (x, 0, 2.6), M["pipe_yellow"])  # 两端的行走驱动
    for x in (-L * 0.3, L * 0.3):
        mb.beam((x, 0.9, 3.6), (x, 0.9, 5.2), 0.12, M["steel_dark"])
        mb.lamp((x, 0.9, 5.4), M["lamp_unit"], 0.7)
    return mb.mesh(name)


def flare_base(M, name, seed=0):
    """火炬底部（定稿里火炬脚下是一圈带灯的设备）：卧式分液罐 + 水封罐 + 两层钢平台 + 管道 + 灯"""
    rnd = random.Random(seed)
    mb = MB()
    mb.cyl(2.4, 14.0, (-14.0, -4.0, 3.2), M["insulation"], seg=12, axis="X")
    for x in (-19.0, -9.0):
        mb.box((0.8, 4.0, 2.0), (x, -4.0, 1.0), M["concrete"])
    mb.cyl(2.0, 9.0, (-14.0, 6.0, 4.5), M["insulation"], seg=12)
    mb.arc_deck(1.0, 3.2, 9.2, 0.2, 0, 2 * math.pi, M["grating"], seg=10)
    mb.arc_rail(3.1, 10.3, 0, 2 * math.pi, M["pipe_yellow"], seg=10)
    # 两层钢平台（4 × 3 跨）
    for zf in (5.0, 10.0):
        mb.box((12.0, 9.0, 0.15), (-6.0, -12.0, zf), M["grating"])
        mb.rail_rect(-12.0, -16.5, 0.0, -7.5, zf + 1.1, M["pipe_yellow"])
        for p in ((-12.0, -16.5), (0.0, -16.5), (-6.0, -16.5)):
            mb.lamp((p[0], p[1], zf - 0.5), M["lamp_unit"], 0.8)
    for x in (-12.0, -6.0, 0.0):
        for y in (-16.5, -7.5):
            mb.beam((x, y, 0), (x, y, 10.0), 0.4, M["steel_dark"])
    mb.tube([(-6.0, -4.0, 5.6), (-2.5, -4.0, 5.6), (-2.5, -1.2, 5.6), (-1.0, 0.0, 8.0)], 0.7, M["steel"], seg=8)
    mb.tube([(-14.0, 6.0, 9.0), (-14.0, 2.0, 9.0), (-14.0, -4.0, 5.6)], 0.5, M["steel"], seg=6)
    for _ in range(3):
        mb.cyl(rnd.uniform(0.6, 1.0), rnd.uniform(2.0, 3.5), (rnd.uniform(-10, -2), rnd.uniform(-15, -9), 5.15 + 1.4), M["steel"], seg=8)
    return mb.mesh(name, smooth=40)


def pylon(M, name, h=38.0):
    """输电铁塔（定稿里变电站以东沿路有一排）：四根主材向上收分 + 每 6 m 一道横隔 + 交叉斜材 + 三层横担"""
    mb = MB()
    b0, b1 = 4.5, 1.2
    zs = [0.0]
    while zs[-1] < h * 0.78:
        zs.append(zs[-1] + 6.0)
    zs[-1] = h * 0.8
    half = lambda z: b0 + (b1 - b0) * z / (h * 0.8)  # noqa: E731
    corners = [(1, 1), (-1, 1), (-1, -1), (1, -1)]
    for sx, sy in corners:
        mb.beam((sx * b0, sy * b0, 0), (sx * b1, sy * b1, h * 0.8), 0.35, M["steel"])
    for za, zb in zip(zs, zs[1:]):
        ha, hb = half(za), half(zb)
        for (ax, ay), (bx, by) in zip(corners, corners[1:] + corners[:1]):
            mb.beam((ax * hb, ay * hb, zb), (bx * hb, by * hb, zb), 0.15, M["steel"])
            mb.beam((ax * ha, ay * ha, za), (bx * hb, by * hb, zb), 0.12, M["steel"])
    mb.beam((0, 0, h * 0.8), (0, 0, h), 0.3, M["steel"])
    for zz, wd in ((h * 0.62, 9.0), (h * 0.74, 11.0), (h * 0.86, 8.0)):
        mb.beam((-wd, 0, zz), (wd, 0, zz), 0.3, M["steel"])
        mb.beam((-wd, 0, zz), (0, 0, zz + 2.0), 0.15, M["steel"])
        mb.beam((wd, 0, zz), (0, 0, zz + 2.0), 0.15, M["steel"])
    return mb.mesh(name)


def flare(M, name, h):
    """高架火炬：细长火炬筒 + 三腿塔架（每 15 m 一圈横梁）+ 顶部平台 + 火焰 + 航空障碍灯"""
    mb = MB()
    mb.cyl(1.4, h, (0, 0, h / 2), M["steel"], seg=16, r2=0.9)
    legs = [(9 * math.cos(a), 9 * math.sin(a)) for a in (math.pi / 2, math.pi * 7 / 6, math.pi * 11 / 6)]
    top = [(1.8 * math.cos(a), 1.8 * math.sin(a)) for a in (math.pi / 2, math.pi * 7 / 6, math.pi * 11 / 6)]
    for (x0, y0), (x1, y1) in zip(legs, top):
        mb.beam((x0, y0, 0), (x1, y1, h * 0.92), 0.5, M["steel_dark"])
    z = 15.0
    while z < h * 0.9:
        k = z / (h * 0.92)
        pts = [(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k) for (x0, y0), (x1, y1) in zip(legs, top)]
        for a, b in zip(pts, pts[1:] + pts[:1]):
            mb.beam((a[0], a[1], z), (b[0], b[1], z), 0.3, M["steel_dark"])
        z += 15
    mb.cyl(3.2, 0.4, (0, 0, h * 0.93), M["steel_dark"], seg=16)
    mb.cyl(1.6, 7.0, (0, 0, h + 3.5), M["flame"], seg=12, r2=0.2)
    mb.ico(0.6, (0, 0, h * 0.93 + 0.8), M["red_light"], sub=1)
    mb.ico(0.6, (0, 0, h * 0.5), M["red_light"], sub=1)
    return mb.mesh(name)


def substation(M, name, w, d, seed=0):
    """户外变电站：成排构架（门型）+ 主变（带散热片）+ 母线"""
    rnd = random.Random(seed)
    mb = MB()
    for y in (-d * 0.35, 0, d * 0.35):
        for x in [-w / 2 + 8 + i * 14 for i in range(max(1, int((w - 16) / 14) + 1))]:
            mb.beam((x - 3, y, 0), (x - 3, y, 16), 0.5, M["steel"])
            mb.beam((x + 3, y, 0), (x + 3, y, 16), 0.5, M["steel"])
            mb.beam((x - 3, y, 16), (x + 3, y, 16), 0.4, M["steel"])
            mb.beam((x - 3, y, 0), (x + 3, y, 16), 0.15, M["steel"])
        mb.tube([(-w / 2 + 4, y, 15), (w / 2 - 4, y, 15)], 0.12, M["steel"], seg=6)
    for k in range(3):
        x = -w / 3 + k * w / 3
        y = -d * 0.18 + rnd.uniform(-2, 2)
        mb.box((7, 5, 5), (x, y, 2.5), M["transformer"])
        mb.box((8.2, 0.6, 3.6), (x, y - 2.8, 2.8), M["transformer"])
        mb.box((8.2, 0.6, 3.6), (x, y + 2.8, 2.8), M["transformer"])
        mb.cyl(0.5, 3.0, (x - 2, y, 6.5), M["wall"], seg=8)
        mb.cyl(0.5, 3.0, (x + 2, y, 6.5), M["wall"], seg=8)
        mb.box((7.4, 5.4, 0.3), (x, y, 0.15), M["concrete"])  # 主变基础 + 防火墙
        mb.box((0.5, 7.0, 7.0), (x + 4.6, y, 3.5), M["concrete"])
    # 构架之间成排的隔离开关 / 互感器支柱（白色瓷柱，远看是一排排小白点）
    for y in (-d * 0.35 + 5, d * 0.35 - 5, 5.0):
        for x in [-w / 2 + 6 + i * 4.5 for i in range(int((w - 12) / 4.5) + 1)]:
            mb.box((0.5, 0.5, 2.2), (x, y, 2.4), M["steel"])
            mb.cyl(0.25, 1.8, (x, y, 4.4), M["wall"], seg=6)
    # 主控楼（北端）+ 场地围栏
    mb.box((w * 0.35, 9.0, 6.0), (-w * 0.25, d / 2 - 6.0, 3.0), M["wall"])
    mb.box((w * 0.35 + 0.4, 9.4, 0.4), (-w * 0.25, d / 2 - 6.0, 6.2), M["roof"])
    for i in range(5):
        mb.box((1.6, 0.12, 1.1), (-w * 0.25 - w * 0.14 + i * w * 0.07, d / 2 - 10.55, 4.0), M["window"])
    for a, b in (((-w / 2, -d / 2), (w / 2, -d / 2)), ((w / 2, -d / 2), (w / 2, d / 2)), ((w / 2, d / 2), (-w / 2, d / 2)), ((-w / 2, d / 2), (-w / 2, -d / 2))):
        mb.beam((a[0], a[1], 2.2), (b[0], b[1], 2.2), 0.1, M["fence"])
        mb.beam((a[0], a[1], 0.3), (b[0], b[1], 0.3), 0.3, M["concrete"])
    for x, y in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)):
        mb.beam((x, y, 0), (x, y, 14), 0.3, M["steel_dark"])
        mb.lamp((x, y, 14.3), M["lamp_unit"], 0.8)
    return mb.mesh(name)


# ---------------------------------------------------------------- 建筑


def _facade_uv(mb, faces, w, d, h, rep_m=40, u0=0.0):
    """把幕墙贴图按立面铺：横向每 rep_m 米重复一次（u0 为起点偏移），竖向整栋楼对应整张贴图"""
    uv = mb.bm.loops.layers.uv.verify()
    mb.bm.normal_update()
    for f in faces:
        n = f.normal
        if abs(n.z) > 0.5:
            continue
        for l in f.loops:
            co = l.vert.co
            s = co.x if abs(n.y) > abs(n.x) else co.y
            l[uv].uv = (s / rep_m + u0, co.z / h)


def office(M, name, w, d, h):
    """
    指挥中心：玻璃幕墙（T_windows：4 层规整的楼层窗带，中段一整块亮着、两端零散亮灯）+ 女儿墙 + 屋面设备 + 底层入口雨棚。
    幕墙贴图横向铺满整栋楼一次（贴图中心对着楼的中心），不再 40 m 一重复。
    """
    mb = MB()
    faces = mb.box((w, d, h), (0, 0, h / 2), M["glass"])
    _facade_uv(mb, faces, w, d, h, rep_m=w, u0=0.5)
    for f in faces:
        if f.normal.z > 0.5:
            f.material_index = mb.i(M["roof"])
    for sx in (-1, 1):
        mb.box((0.5, d + 0.5, 1.2), (sx * w / 2, 0, h + 0.6), M["wall"])
    for sy in (-1, 1):
        mb.box((w + 0.5, 0.5, 1.2), (0, sy * d / 2, h + 0.6), M["wall"])
    mb.box((w * 0.5, 6, 0.4), (0, -d / 2 - 3, 4.5), M["canopy"])
    mb.box((6, 4, 2.5), (-w * 0.3, d * 0.2, h + 1.25), M["steel"])
    return mb.mesh(name)


def control_building(M, name, w, d, h):
    """
    装置区控制楼：浅色实墙 + 平屋面 + 女儿墙；两层分开的方窗（南、东、西三面，约七成亮着）。
    原先两圈整条的自发光窗带在全景里是两道刺眼的光条（定稿里是一排排小亮窗）。
    """
    mb = MB()
    mb.box((w, d, h), (0, 0, h / 2), M["wall"])
    mb.box((w + 0.4, d + 0.4, 0.8), (0, 0, h + 0.4), M["roof"])
    k = 0
    for z in (h * 0.3, h * 0.72):
        n = int(w / 3.2)
        for i in range(n):
            k += 1
            if k % 10 in (3, 7, 8):
                continue
            mb.box((1.6, 0.12, 1.3), (-w / 2 + w * (i + 0.5) / n, -d / 2 - 0.04, z), M["window"])
        for sx in (-1, 1):
            for i in range(int(d / 4.5)):
                if (i + k) % 3:
                    mb.box((0.12, 1.6, 1.3), (sx * (w / 2 + 0.04), -d / 2 + 3 + i * 4.5, z), M["window"])
    return mb.mesh(name)


def fire_station(M, name, w, d, h):
    """消防站：主楼 + 南立面一排红色车库门 + 窗带"""
    mb = MB()
    mb.box((w, d, h), (0, 0, h / 2), M["wall"])
    n = 5
    for k in range(n):
        x = -w / 2 + w * (k + 0.5) / n
        mb.box((w / n * 0.7, 0.3, 4.5), (x, -d / 2 - 0.1, 2.25), M["red"])
    for i in range(int(w / 3.5)):
        if i % 4 != 2:
            mb.box((1.8, 0.2, 1.2), (-w / 2 + 2 + i * 3.5, -d / 2 - 0.1, h * 0.72), M["window"])
    mb.box((w + 0.4, d + 0.4, 0.6), (0, 0, h + 0.3), M["roof"])
    return mb.mesh(name)


def fire_tower(M, name, w, h):
    """消防训练塔：细高塔楼 + 每层小窗 + 顶部红灯"""
    mb = MB()
    mb.box((w, w, h), (0, 0, h / 2), M["wall"])
    for z in range(4, int(h) - 2, 4):
        mb.box((w * 0.5, 0.2, 1.2), (0, -w / 2 - 0.05, z), M["window"])
    mb.box((w + 0.6, w + 0.6, 0.6), (0, 0, h + 0.3), M["red"])
    return mb.mesh(name)


def warehouse(M, name, w, d, h):
    """仓库：檐口以下实墙 + 双坡屋面（屋脊沿 x）+ 卷帘门"""
    mb = MB()
    he = h * 0.78
    mb.box((w, d, he), (0, 0, he / 2), M["wall"])
    pts = [(-d / 2 - 0.5, he), (d / 2 + 0.5, he), (0, h)]
    # 山墙轮廓沿 x 挤出：profile 在 xz 平面，这里换成 yz 再转 90°
    faces = lib.add_profile(mb.bm, [(p[0], p[1]) for p in pts], w + 1.0, mat=mb.i(M["roof"]))
    vs = list({v for f in faces for v in f.verts})
    bmesh.ops.rotate(mb.bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "Z"), verts=vs)
    for k in range(4):
        mb.box((5, 0.3, 5), (-w / 2 + w * (k + 0.5) / 4, -d / 2 - 0.1, 2.5), M["wall_dark"])
    return mb.mesh(name)


def canopy(M, name, w, d, h, bays=8):
    """
    装卸站长罩棚（定稿里是一块浅灰压型钢板屋面、棚下一排槽车）：
    薄屋面（顶面铺压型钢板条纹贴图）+ 前后浅色封檐板 + 每 10 m 一对立柱；
    棚下每个鹤位之间一条装车岛（混凝土台 + 鹤管立柱和摇臂）；屋面下两排钠灯（页面在灯下地面铺暖色光池）。
    """
    mb = MB()
    faces = mb.box((w, d, 0.35), (0, 0, h), M["canopy"])
    uv = mb.bm.loops.layers.uv.verify()
    for f in faces:
        for l in f.loops:
            l[uv].uv = (l.vert.co.x / 8.0, l.vert.co.y / 8.0)
    for sy in (-1, 1):
        mb.box((w + 0.3, 0.25, 0.9), (0, sy * (d / 2 + 0.1), h - 0.2), M["wall"])
    n = max(2, round(w / 10))
    for k in range(n + 1):
        x = -w / 2 + w * k / n
        for y in (-d / 2 + 2.5, d / 2 - 2.5):
            mb.box((0.5, 0.5, h), (x, y, h / 2), M["steel_dark"])
        mb.beam((x, -d / 2 + 2.5, h - 0.4), (x, d / 2 - 2.5, h - 0.4), 0.4, M["steel_dark"])
    for i in range(bays + 1):
        x = -w / 2 + w * i / bays
        mb.box((1.4, d * 0.55, 0.3), (x, d * 0.05, 0.15), M["concrete"])
        mb.beam((x, d * 0.1, 0.3), (x, d * 0.1, 4.8), 0.3, M["steel"])
        mb.beam((x, d * 0.1, 4.6), (x + 2.2, d * 0.1 - 1.0, 4.0), 0.22, M["pipe_yellow"])
    nl = max(2, int(w / 8))
    for k in range(nl):
        x = -w / 2 + w * (k + 0.5) / nl
        for y in (-d / 4, d / 4):
            mb.box((0.8, 0.5, 0.2), (x, y, h - 0.35), M["lamp"])
    return mb.mesh(name)


def hazwaste(M, name, w, d, h):
    """危废仓库：小型实墙库房 + 坡屋面"""
    mb = MB()
    mb.box((w, d, h), (0, 0, h / 2), M["wall_dark"])
    mb.box((w + 0.6, d + 0.6, 0.5), (0, 0, h + 0.25), M["roof"])
    mb.box((4, 0.3, 4), (0, -d / 2 - 0.1, 2), M["pipe_yellow"])
    return mb.mesh(name)


# ---------------------------------------------------------------- 车辆 / 船


def tanker_truck(M, name):
    """危化品槽车（沿 +x，长约 12 m）：车头 + 罐体 + 车轮"""
    mb = MB()
    mb.box((2.6, 2.5, 3.0), (4.6, 0, 1.9), M["truck_cab"])
    mb.box((1.0, 2.3, 1.0), (5.6, 0, 2.6), M["glass"])
    mb.cyl(1.25, 8.6, (-1.2, 0, 2.3), M["tanker"], seg=14, axis="X")
    mb.box((10.5, 1.0, 0.4), (-0.2, 0, 0.9), M["steel_dark"])
    for x in (4.6, -2.0, -3.4, -4.8):
        for y in (-1.1, 1.1):
            mb.cyl(0.5, 0.4, (x, y, 0.5), M["tyre"], seg=10, axis="Y")
    return mb.mesh(name, smooth=40)


def _hull_plan(L, hw, n_bow=6):
    """船体平面轮廓（沿 +x，船首朝 +x）：圆角方艉 + 平行中体 + 椭圆形收窄的船首"""
    x_bow = L * 0.2
    pts = [(-L / 2, -hw * 0.82), (-L / 2 + 2.0, -hw), (x_bow, -hw)]
    for k in range(1, n_bow):
        t = k / n_bow
        pts.append((x_bow + (L / 2 - x_bow) * t, -hw * math.sqrt(max(0.0, 1 - t * t))))
    pts.append((L / 2, 0.0))
    right = [(x, -y) for x, y in reversed(pts[:-1])]
    return pts + right


def ship(M, name, L, B):
    """
    化学品船（沿 +x，船首朝 +x；原点在水线）：
    船体（红色水线带 + 深蓝干舷）+ 艏楼；艉部四层白色上层建筑（分开的窗、亮着一部分、驾驶台两翼、烟囱、雷达桅）；
    艏部小甲板室 + 前桅；甲板：中央架空步道和纵向货油管、两排舱口、三个白色甲板罐、舯部集管和吊机、甲板灯。
    """
    mb = MB()
    hw = B / 2
    fb = 4.5  # 干舷
    plan = _hull_plan(L, hw)
    mb.prism(plan, -1.0, 0.9, M["hull_red"])
    mb.prism(plan, 0.9, fb, M["hull"])
    # 艏楼：船首 12 % 抬高一层
    fc = [p for p in plan if p[0] > L * 0.38]
    yb = hw * math.sqrt(max(0.0, 1 - ((L * 0.38 - L * 0.2) / (L * 0.3)) ** 2))
    mb.prism([(L * 0.38, -yb)] + fc + [(L * 0.38, yb)], fb, fb + 2.2, M["hull"])
    deck = [(x * 0.97, y * 0.92) for x, y in plan]
    mb.prism(deck, fb, fb + 0.2, M["deck"])
    zd = fb + 0.2
    # 艉部上层建筑：四层逐层收小
    xa = -L / 2 + 1.0
    sw = L * 0.15
    z = zd
    for k, (kx, ky, hh) in enumerate(((1.0, 0.86, 3.0), (0.88, 0.8, 2.8), (0.78, 0.74, 2.8), (0.7, 0.68, 2.6))):
        w_, d_ = sw * kx, B * ky
        cx = xa + w_ / 2
        mb.box((w_, d_, hh), (cx, 0, z + hh / 2), M["super"])
        # 前壁和两舷的窗：分开的小窗，约一半亮着；驾驶台是一整排
        nwin = max(3, int(d_ / 2.2))
        for i in range(nwin):
            if k == 3 or (i + k) % 2 == 0:
                mb.box((0.12, 1.3, 0.9), (cx + w_ / 2 + 0.04, -d_ / 2 + d_ * (i + 0.5) / nwin, z + hh * 0.55), M["window"])
        for sy in (-1, 1):
            for i in range(max(2, int(w_ / 2.5))):
                if (i + k) % 3 != 1:
                    mb.box((1.2, 0.12, 0.9), (xa + 1.2 + i * 2.5, sy * (d_ / 2 + 0.04), z + hh * 0.55), M["window"])
        z += hh
    # 驾驶台两翼 + 顶上雷达桅、烟囱
    mb.box((sw * 0.3, B * 1.0, 0.3), (xa + sw * 0.55, 0, z - 2.6), M["super"])
    mb.box((3.2, 3.6, 5.5), (xa + 1.8, 0, z + 2.0), M["steel_dark"])
    mb.box((3.3, 3.7, 0.8), (xa + 1.8, 0, z + 3.8), M["hull_red"])
    mb.beam((xa + sw * 0.5, 0, z), (xa + sw * 0.5, 0, z + 6.5), 0.3, M["steel"])
    mb.beam((xa + sw * 0.5, -2.5, z + 4.5), (xa + sw * 0.5, 2.5, z + 4.5), 0.2, M["steel"])
    mb.lamp((xa + sw * 0.5, 0, z + 6.8), M["lamp_unit"], 0.7)
    mb.lamp((xa + sw + 0.4, -B * 0.4, zd + 3.2), M["lamp_unit"], 0.7)
    # 艏部小甲板室 + 前桅
    xf = L * 0.36
    mb.box((L * 0.05, B * 0.45, 2.6), (xf, 0, zd + 1.3), M["super"])
    mb.beam((L * 0.42, 0, zd + 2.2), (L * 0.42, 0, zd + 10), 0.35, M["steel"])
    mb.lamp((L * 0.42, 0, zd + 10.3), M["lamp_unit"], 0.7)
    # 货舱区（上层建筑前端到艏部甲板室）
    x0, x1 = xa + sw + 2.0, L * 0.36 - 3.0
    zc = zd + 2.4
    mb.box((x1 - x0, 1.3, 0.15), ((x0 + x1) / 2, 0, zc), M["grating"])  # 中央架空步道
    nposts = max(2, int((x1 - x0) / 6))
    for i in range(nposts + 1):
        x = x0 + (x1 - x0) * i / nposts
        mb.beam((x, 0, zd), (x, 0, zc), 0.25, M["steel"])
    for j, y in enumerate((-1.9, -1.2, 1.2, 1.9, 2.6)):
        zz = zd + 0.9 + 0.2 * (j % 2)
        mb.tube([(x0, y, zz), (x1, y, zz)], 0.28, M["steel"], seg=6)
    nh = max(3, int((x1 - x0) / 7))
    for i in range(nh):
        x = x0 + 2 + (x1 - x0 - 4) * (i + 0.5) / nh
        for sy in (-1, 1):
            mb.box((1.6, 1.6, 0.9), (x, sy * hw * 0.55, zd + 0.45), M["steel"])
    xm = (x0 + x1) / 2
    for i in range(3):
        x = x0 + (x1 - x0) * (0.18 + 0.32 * i)
        if abs(x - xm) < 5:
            x += 7  # 舯部留给集管
        mb.box((6.0, B * 0.42, 2.4), (x, -hw * 0.18, zd + 1.2), M["super"])
    # 舯部集管（横向几根管通到两舷）+ 吊机
    for k in range(4):
        mb.tube([(xm - 1.5 + k, -hw + 0.6, zd + 1.4), (xm - 1.5 + k, hw - 0.6, zd + 1.4)], 0.25, M["steel"], seg=6)
    mb.cyl(0.45, 7.0, (xm + 4, hw * 0.55, zd + 3.5), M["pipe_yellow"], seg=8)
    mb.beam((xm + 4, hw * 0.55, zd + 6.5), (xm - 6, hw * 0.3, zd + 9.5), 0.35, M["pipe_yellow"])
    # 甲板灯：沿步道立几根灯杆
    for i in range(2):
        x = x0 + (x1 - x0) * (i + 0.5) / 2
        mb.beam((x, -1.0, zc), (x, -1.0, zc + 3.0), 0.15, M["steel"])
        mb.lamp((x, -1.0, zc + 3.2), M["lamp_unit"], 0.7)
    return mb.mesh(name)


def jetty(M, name, L, w, ships, approach):
    """
    液体化工码头 JT-1（局部坐标，原点在泊位中点，地面 / 岸顶 z = 0，水面 z = -2.5）：
    码头平台（双排桩、护舷）+ 平台上的高杆灯；每艘船北侧一列靠船墩，墩上钢塔架起一道沿船长方向的架空管桥
    （定稿里码头伸出、架在两艘船上方的管架），管桥上两台白色装卸臂下到船舯集管；
    船上、码头上的灯都用 M_lamp_unit：页面给 M_lamp_sodium（路灯）在 z≈0.35 的地面上铺光池，放在水上会浮在江面上。
    引桥：沿管廊支线从岸顶到平台的桥面（桩、护栏、低位管束、路灯）。
    ships：[(局部 x, 局部 y, 船长, 船宽)]；approach：引桥起止点 [(x0, y0), (x1, y1)]（局部）。
    """
    mb = MB()
    zt = 3.0  # 平台面标高
    mb.box((L, w, 1.0), (0, 0, zt - 0.5), M["concrete"])
    for k in range(int(L / 8) + 1):
        for y in (-w / 2 + 1, w / 2 - 1):
            mb.cyl(0.5, 6.0, (-L / 2 + k * 8, y, -0.5), M["concrete"], seg=6)
    for k in range(int(L / 10)):
        mb.box((1.2, 0.8, 2.0), (-L / 2 + 5 + k * 10, -w / 2 - 0.4, zt - 1.2), M["tyre"])
    for x in (-L * 0.42, -L * 0.14, L * 0.14, L * 0.42):
        mb.beam((x, w / 2 - 1.0, zt), (x, w / 2 - 1.0, zt + 16), 0.45, M["steel_dark"])
        mb.beam((x - 1.2, w / 2 - 1.0, zt + 16), (x + 1.2, w / 2 - 1.0, zt + 16), 0.25, M["steel_dark"])
        mb.lamp((x + 1.2, w / 2 - 1.3, zt + 15.6), M["lamp_unit"], 0.9)
    # 靠船墩 + 架空管桥 + 装卸臂
    for sx, sy, sl, sb in ships:
        yn = sy + sb / 2  # 船北舷
        yg = (yn + (-w / 2)) / 2  # 管桥中线：平台南沿和船北舷之间
        xa, xb = sx - sl * 0.4, sx + sl * 0.4
        zg = zt + 8.0
        n = max(2, round((xb - xa) / 16))
        for i in range(n + 1):
            x = xa + (xb - xa) * i / n
            mb.box((4.0, 4.0, 2.0), (x, yg, zt - 1.0), M["concrete"])
            for px in (-1.2, 1.2):
                mb.cyl(0.45, 5.0, (x + px, yg, -1.0), M["concrete"], seg=6)
            for px in (-1.0, 1.0):
                mb.beam((x + px, yg, zt), (x + px, yg, zg), 0.4, M["steel_dark"])
            mb.beam((x - 1.0, yg, zg), (x + 1.0, yg, zg), 0.35, M["steel_dark"])
            mb.box((1.0, 0.8, 1.6), (x, yn + 0.5, 0.6), M["tyre"])
        mb.box((xb - xa, 1.2, 0.15), ((xa + xb) / 2, yg - 1.6, zg + 0.1), M["grating"])
        for j, yy in enumerate((-0.8, -0.2, 0.4, 1.0, 1.6)):
            mb.tube([(xa, yg + yy, zg + 0.5), (xb, yg + yy, zg + 0.5)], 0.3 if j % 2 else 0.4, M["insulation"] if j == 2 else M["steel"], seg=6)
        mb.beam((xa, yg - 2.2, zg + 1.2), (xb, yg - 2.2, zg + 1.2), 0.08, M["pipe_yellow"])
        # 管桥接到平台的短桥（取管桥上离平台最近的一点）
        xc = max(-L / 2 + 2, min(L / 2 - 2, max(xa, min(xb, 0.0))))
        mb.box((2.0, abs(yg + w / 2) + 1.0, 0.3), (xc, (yg - w / 2) / 2, zg), M["grating"])
        for x in (xa, xb):
            mb.lamp((x, yg - 2.2, zg + 2.4), M["lamp_unit"], 0.9)
        # 装卸臂：从管桥上的立柱升起、折下到船舯集管
        for dx in (-3.0, 3.0):
            x = sx + dx
            base = (x, yg, zg + 0.6)
            apex = (x, yg - 3.0, zg + 7.0)
            end = (x, yn - 2.5, 2.2 + 1.6)
            mb.cyl(0.45, 2.5, (x, yg, zg + 1.6), M["insulation"], seg=8)
            mb.tube([base, (x, yg, zg + 3.0), apex], 0.32, M["insulation"], seg=6)
            mb.tube([apex, end], 0.3, M["insulation"], seg=6)
            mb.box((1.0, 1.4, 1.2), (x, yg + 1.6, zg + 6.0), M["steel_dark"])
    # 引桥（沿管廊支线；管廊本身属于 PR-1）
    (ax, ay), (bx, by) = approach
    ang = math.atan2(by - ay, bx - ax)
    Lb = math.hypot(bx - ax, by - ay)
    ux, uy = math.cos(ang), math.sin(ang)
    nx_, ny_ = -uy, ux  # 左法线
    off = -1.5  # 桥面中线相对管廊偏一点（多出的一侧是检修车道）
    cxb, cyb = (ax + bx) / 2 + nx_ * off, (ay + by) / 2 + ny_ * off
    mb.box((Lb, 9.0, 0.8), (cxb, cyb, 0.0), M["concrete"], rot_z=ang)
    nk = max(1, int(Lb / 8))
    for k in range(nk + 1):
        t = k / nk
        px, py = ax + (bx - ax) * t + nx_ * off, ay + (by - ay) * t + ny_ * off
        for side in (-3.8, 3.8):
            mb.cyl(0.45, 4.0, (px + nx_ * side, py + ny_ * side, -2.2), M["concrete"], seg=6)
    for side in (-4.4, 4.4):
        p0 = (ax + nx_ * (off + side), ay + ny_ * (off + side), 1.4)
        p1 = (bx + nx_ * (off + side), by + ny_ * (off + side), 1.4)
        mb.beam(p0, p1, 0.1, M["pipe_yellow"])
    for j in range(4):
        side = off - 3.4 + j * 0.8
        mb.tube([(ax + nx_ * side, ay + ny_ * side, 0.9), (bx + nx_ * side, by + ny_ * side, 0.9)], 0.3, M["steel"], seg=6)
    for k in range(int(Lb / 20) + 1):
        t = min(1.0, (k + 0.3) * 20 / Lb)
        px, py = ax + (bx - ax) * t + nx_ * (off - 4.2), ay + (by - ay) * t + ny_ * (off - 4.2)
        mb.beam((px, py, 0.4), (px, py, 7.0), 0.18, M["steel_dark"])
        mb.lamp((px, py, 7.2), M["lamp_unit"], 0.8)
    return mb.mesh(name)


# ---------------------------------------------------------------- 绿化 / 设施


def trees(M):
    """
    行道树 / 园林树预制件（每种一个网格，全场关联复制、导出成 GPU 实例，摆放时再随机缩放 0.75–1.3 倍）：
    返回 {种类: 网格}。树干是不封口的细筒（看不到端面），树冠是一两个低面数二十面体或圆锥，每棵 30–60 面。
    """
    out = {}

    def trunk(mb, h, r=0.25):
        mb.band(r, 0, h, M["trunk"], seg=5)

    # 圆冠阔叶（最常见）
    mb = MB()
    trunk(mb, 3.4)
    mb.ico(2.9, (0, 0, 5.2), M["tree"], sub=1, scale=(1, 1, 0.9))
    out["round"] = mb.mesh("tree_round")
    # 双冠大树（树冠不对称）
    mb = MB()
    trunk(mb, 4.0, 0.32)
    mb.ico(3.6, (0, 0, 7.0), M["tree"], sub=1, scale=(1, 1, 0.85))
    mb.ico(2.6, (1.6, 0.8, 9.0), M["tree"], sub=1)
    out["big"] = mb.mesh("tree_big")
    # 黄绿色的小乔木
    mb = MB()
    trunk(mb, 2.6, 0.2)
    mb.ico(2.3, (0, 0, 4.2), M["tree_light"], sub=1)
    mb.ico(1.6, (-1.0, 0.6, 5.4), M["tree_light"], sub=1)
    out["light"] = mb.mesh("tree_light")
    # 深绿圆冠
    mb = MB()
    trunk(mb, 3.0)
    mb.ico(3.1, (0, 0, 5.6), M["tree_dark"], sub=1, scale=(1, 1, 1.05))
    out["dark"] = mb.mesh("tree_dark")
    # 针叶树（两节圆锥）
    mb = MB()
    trunk(mb, 3.0, 0.22)
    mb.cyl(2.5, 6.5, (0, 0, 2.5 + 3.25), M["tree_dark"], seg=7, r2=0.4)
    mb.cyl(1.8, 4.5, (0, 0, 7.5 + 2.25), M["tree_dark"], seg=7, r2=0.05)
    out["conifer"] = mb.mesh("tree_conifer")
    # 钻天杨（细高柱形，乡间道路两旁）
    mb = MB()
    trunk(mb, 3.0, 0.22)
    mb.ico(1.9, (0, 0, 8.8), M["tree_light"], sub=1, scale=(1, 1, 3.0))
    out["poplar"] = mb.mesh("tree_poplar")
    # 灌木丛（矮、两三团）
    mb = MB()
    mb.ico(1.8, (0, 0, 1.2), M["tree_light"], sub=1, scale=(1, 1, 0.7))
    mb.ico(1.4, (1.8, 0.5, 1.0), M["tree"], sub=1, scale=(1, 1, 0.7))
    out["shrub"] = mb.mesh("tree_shrub")
    return out


def houses(M):
    """村落民房预制件：两层坡顶房（南面两扇亮窗）、一层坡顶房、平顶附房；返回 {种类: 网格}"""
    out = {}
    for key, (w, d, h, win) in {"two": (11, 8, 6.2, True), "one": (9, 7, 3.6, False), "flat": (6, 5, 3.0, False)}.items():
        mb = MB()
        mb.box((w, d, h), (0, 0, h / 2), M["wall"])
        if key == "flat":
            mb.box((w + 0.3, d + 0.3, 0.3), (0, 0, h + 0.15), M["roof"])
        else:
            # 双坡屋面：山墙轮廓（y-z 平面）沿 x 挤出
            rise = d * 0.32
            faces = lib.add_profile(mb.bm, [(-d / 2 - 0.5, h), (d / 2 + 0.5, h), (0, h + rise)], w + 0.8, mat=mb.i(M["house_roof"]))
            vs = list({v for f in faces for v in f.verts})
            bmesh.ops.rotate(mb.bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "Z"), verts=vs)
        if win:
            for x in (-w * 0.25, w * 0.25):
                mb.box((1.4, 0.12, 1.1), (x, -d / 2 - 0.04, h * 0.7), M["window"])
        out[key] = mb.mesh("house_" + key)
    return out


def _vnoise(x, y, seed=0):
    """二维值噪声（格点哈希 + smoothstep 插值），取值 0..1；林冠高度、地块选择用"""

    def h(i, j):
        n = (i * 374761393 + j * 668265263 + seed * 2147483647) & 0xFFFFFFFF
        n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
        return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0

    i, j = math.floor(x), math.floor(y)
    fx, fy = x - i, y - j
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b, c, d = h(i, j), h(i + 1, j), h(i, j + 1), h(i + 1, j + 1)
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy


def canopy_height(x, y, hmin, hmax, seed=0):
    """林冠高度：两层值噪声叠加（~20 m 的树冠团 + ~7 m 的起伏），再加一点逐点抖动"""
    n = 0.65 * _vnoise(x / 20.0, y / 20.0, seed) + 0.35 * _vnoise(x / 7.0, y / 7.0, seed + 7)
    return hmin + (hmax - hmin) * n


def canopy_mesh(mb, m, cells, cell, hmin, hmax, seed=0):
    """
    成片林冠的高度场网格：cells 是要种树的格子集合 {(i, j)}（格子边长 cell 米，格子 (i, j) 的左下角在 (i·cell, j·cell)）。
    内部顶点按 canopy_height 抬高；挨着空格子的边缘顶点降到 1.5 m，形成林缘的斜坡。不规则的林缘靠 cells 本身的形状。
    UV 按世界坐标平铺 T_canopy（50 m 一铺）。
    """
    bm = mb.bm
    k = mb.i(m)
    uv = bm.loops.layers.uv.verify()
    verts = {}

    def vert(i, j):
        if (i, j) not in verts:
            inner = all(c in cells for c in ((i - 1, j - 1), (i, j - 1), (i - 1, j), (i, j)))
            x, y = i * cell, j * cell
            z = canopy_height(x, y, hmin, hmax, seed) if inner else 1.5
            verts[(i, j)] = bm.verts.new((x, y, z))
        return verts[(i, j)]

    for i, j in cells:
        a, b, c, d = vert(i, j), vert(i + 1, j), vert(i + 1, j + 1), vert(i, j + 1)
        # 沿对角线高低交替切三角，冠面起伏更自然
        tris = ((a, b, c), (a, c, d)) if (i + j) % 2 else ((a, b, d), (b, c, d))
        for t in tris:
            f = bm.faces.new(t)
            f.material_index = k
            for l in f.loops:
                l[uv].uv = (l.vert.co.x / 50.0, l.vert.co.y / 50.0)


def lamp(M, name, h=10.0):
    """路灯：灯杆 + 挑臂 + 钠灯头（自发光）"""
    mb = MB()
    mb.cyl(0.12, h, (0, 0, h / 2), M["steel_dark"], seg=6)
    mb.beam((0, 0, h), (1.6, 0, h + 0.2), 0.1, M["steel_dark"])
    mb.box((0.7, 0.35, 0.18), (1.7, 0, h + 0.1), M["lamp"])
    return mb.mesh(name)


def fence_segment(M, name, L):
    """周界围网（沿 +x 长 L）：矮墙 + 每 4 m 一根立柱 + 两道横杆"""
    mb = MB()
    mb.box((L, 0.25, 0.4), (0, 0, 0.2), M["concrete"])
    n = max(1, round(L / 4))
    for k in range(n + 1):
        mb.box((0.1, 0.1, 2.4), (-L / 2 + L * k / n, 0, 1.6), M["fence"])
    for z in (1.2, 2.6):
        mb.box((L, 0.06, 0.06), (0, 0, z), M["fence"])
    return mb.mesh(name)


# ---------------------------------------------------------------- 机场 / 无人机


def dock_parts(M, name):
    """
    一舱一机机场（参照主流机场：合盖约 0.75 × 0.64 × 0.77 m，两扇舱盖向两侧翻开）。
    返回 {部件名: 网格}：body（舱体 + 停机坪 + 气象杆 + 状态灯带）、lid_L / lid_R（舱盖，
    原点在外侧铰链处，页面绕 y 轴转动打开）。
    """
    out = {}
    mb = MB()
    mb.box((0.78, 0.66, 0.55), (0, 0, 0.275), M["dock_body"], bevel=0.03)
    mb.box((0.7, 0.58, 0.02), (0, 0, 0.56), M["dock_pad"])
    mb.box((0.8, 0.02, 0.04), (0, -0.335, 0.45), M["dock_led"])
    mb.box((0.06, 0.06, 1.2), (0.5, 0.25, 0.6), M["steel_dark"])  # 气象杆
    mb.cyl(0.05, 0.08, (0.5, 0.25, 1.24), M["dock_dark"], seg=8)
    for a in (0, 2.1, 4.2):
        mb.ico(0.025, (0.5 + 0.07 * math.cos(a), 0.25 + 0.07 * math.sin(a), 1.28), M["dock_dark"], sub=1)
    mb.box((0.84, 0.72, 0.06), (0, 0, 0.03), M["dock_dark"])
    out["body"] = mb.mesh(name + "_body")
    for side, sx in (("L", -1), ("R", 1)):
        mb = MB()
        # 原点在铰链（外侧边缘），舱盖向内延伸
        mb.box((0.39, 0.66, 0.2), (-sx * 0.195, 0, 0.1), M["dock_body"], bevel=0.02)
        out["lid_" + side] = mb.mesh(f"{name}_lid_{side}")
    return out


def drone_parts(M, name):
    """
    四旋翼（机场配套机型，展开约 0.6 m 轴距）：机身、机臂、电机、云台相机、脚架、航灯；
    螺旋桨单独返回（prop），页面里克隆 4 个并按 prop_1..4 的位置转动。
    """
    mb = MB()
    mb.box((0.34, 0.2, 0.11), (0, 0, 0.22), M["drone_body"], bevel=0.02)
    mb.box((0.18, 0.16, 0.05), (0.02, 0, 0.3), M["drone_body"], bevel=0.015)
    arms = []
    for a in (math.pi / 4, 3 * math.pi / 4, 5 * math.pi / 4, 7 * math.pi / 4):
        p = (0.3 * math.cos(a), 0.3 * math.sin(a))
        arms.append(p)
        mb.beam((0, 0, 0.22), (p[0], p[1], 0.24), 0.035, M["drone_arm"])
        mb.cyl(0.03, 0.05, (p[0], p[1], 0.26), M["drone_arm"], seg=10)
        mb.ico(0.012, (p[0], p[1], 0.2), M["drone_led"] if p[0] > 0 else M["drone_led_g"], sub=1)
    mb.box((0.08, 0.1, 0.07), (0.17, 0, 0.13), M["dock_dark"])  # 云台
    mb.ico(0.03, (0.21, 0, 0.13), M["lens"], sub=1)
    for y in (-0.08, 0.08):
        mb.beam((0.06, y, 0.17), (0.08, y * 1.4, 0.0), 0.012, M["drone_arm"])
        mb.beam((-0.08, y, 0.17), (-0.1, y * 1.4, 0.0), 0.012, M["drone_arm"])
    body = mb.mesh(name + "_body")
    mb = MB()
    mb.box((0.36, 0.035, 0.006), (0, 0, 0), M["prop"])
    mb.box((0.035, 0.035, 0.012), (0, 0, 0), M["prop"])
    prop = mb.mesh(name + "_prop")
    return {"body": body, "prop": prop, "arms": arms}

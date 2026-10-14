"""
老家沙盘建模 · 房屋
----------------------------------------------------------
site.json 的 houses：每栋房子 = 拟合矩形（cx, cy, 面宽 w, 进深 d）、正立面朝向 face（弧度，
正立面外法线的方向角）、台地高度 z、类型 kind 与层数。

建模在房屋局部坐标里做：原点 = 平面中心、台地面；x 沿面宽，正立面朝 -y。
放到场地时绕 z 转 face + π/2（局部 -y 转到 face 方向）。

类型（对应用户给的参考照片 ref/01–08）：
  flat     白 / 米黄 / 粉色条形瓷砖平顶房，楼层腰线、女儿墙，部分有楼梯间、楼顶蓝色彩钢棚、琉璃瓦檐口
  tile     红瓦坡顶砖房（1–2 层）
  oldtile  穿斗木结构青瓦老屋（1 层，出檐深）
  shed     厂棚 / 猪舍：浅坡彩钢屋面
  home     我家：按照片还原（三开间三层、中间开间退进做阳台、宝瓶栏杆、灯笼对联、楼顶退后的红瓦坡顶），
           没有偏房（用户确认）
立面贴图一张 = 一开间 × 一层（palette.BAY / STOREY），墙面按整开间平铺，窗户落在开间中间。
"""

import math

import bmesh
import bpy
from mathutils import Vector

from . import lib
from .palette import BAY

H_FLAT = 3.1   # 平顶房层高
H_TILE = 3.0   # 坡顶房层高
H_HOME = 3.2   # 我家层高（照片里层高偏高）


class Parts:
    """一栋房子的 bmesh + 材质表（材质按首次使用顺序登记）。"""

    def __init__(self, M):
        self.M = M
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.verify()
        self.mats = []

    def mi(self, key):
        m = self.M[key]
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def face(self, pts, key, uvs=None):
        vs = [self.bm.verts.new(p) for p in pts]
        f = self.bm.faces.new(vs)
        f.material_index = self.mi(key)
        if uvs is None:  # 默认按世界尺度盒式投影（1 m = 1 UV）
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            uvs = [(p[0], p[1]) if ax == 2 else
                   ((p[0], p[2]) if ax == 1 else (p[1], p[2])) for p in pts]
        for l, uv in zip(f.loops, uvs):
            l[self.uv].uv = uv
        return f

    def wall(self, p0, p1, z0, z1, key, tiled=True):
        """竖直墙面 p0→p1（俯视逆时针走时外侧在右手边）。tiled=True 时按开间 / 层平铺。"""
        L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        if L < 1e-3:
            return
        nb = max(1, round(L / BAY)) if tiled else L / BAY
        self.face([(p0[0], p0[1], z0), (p1[0], p1[1], z0),
                   (p1[0], p1[1], z1), (p0[0], p0[1], z1)], key,
                  [(0, 0), (nb, 0), (nb, 1), (0, 1)])

    def box(self, size, center, key, uv_scale=1.0):
        faces = lib.add_box(self.bm, size, center, mat=self.mi(key))
        self._box_uv(faces, uv_scale)
        return faces

    def prism(self, pts, z0, z1, key, uv_scale=1.0):
        faces = lib.add_prism(self.bm, pts, z0, z1, mat=self.mi(key))
        self._box_uv(faces, uv_scale)

    def cyl(self, r, h, center, key, seg=10, r2=None):
        lib.add_cyl(self.bm, r, h, center, seg=seg, mat=self.mi(key), r2=r2)

    def ico(self, r, center, key, scale=(1, 1, 1)):
        lib.add_ico(self.bm, r, center, sub=1, mat=self.mi(key), scale=scale)

    def _box_uv(self, faces, s):
        for f in faces:
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for l in f.loops:
                c = l.vert.co
                l[self.uv].uv = ((c.x, c.y) if ax == 2 else
                                 ((c.x, c.z) if ax == 1 else (c.y, c.z)))
                l[self.uv].uv = (l[self.uv].uv[0] / s, l[self.uv].uv[1] / s)

    def gable_roof(self, w, d, z_eave, pitch, over, key, thick=0.16,
                   gable_key=None, z_wall=None):
        """双坡屋面：屋脊沿 x，出檐 over；gable_key 给山墙三角（墙面材质）。"""
        t = math.tan(math.radians(pitch))
        Y = d / 2 + over
        X = w / 2 + over * 0.6
        zr = z_eave + (d / 2) * t          # 屋脊高（墙线处起坡）
        ze = z_eave - over * t             # 檐口高
        for sgn in (-1, 1):                # 前坡 / 后坡（上表面 + 下表面）
            top = [(-X, sgn * Y, ze), (X, sgn * Y, ze), (X, 0, zr),
                   (-X, 0, zr)]
            if sgn < 0:
                top = [top[1], top[0], top[3], top[2]]
            s = math.hypot(Y, zr - ze)
            self.face(top, key, [(p[0] / 3.2, (Y - abs(p[1])) / Y * s / 3.2)
                                 for p in top])
            bot = [(x, y, z - thick) for x, y, z in reversed(top)]
            self.face(bot, key)
        for sx in (-1, 1):                 # 屋面端头封边
            pts = [(sx * X, -Y, ze), (sx * X, 0, zr), (sx * X, Y, ze),
                   (sx * X, Y, ze - thick), (sx * X, 0, zr - thick),
                   (sx * X, -Y, ze - thick)]
            if sx < 0:
                pts.reverse()
            self.face(pts, "band_grey")
        if gable_key:                      # 山墙三角
            zw = z_eave if z_wall is None else z_wall
            for sx in (-1, 1):
                tri = [(sx * w / 2, -d / 2, zw), (sx * w / 2, d / 2, zw),
                       (sx * w / 2, 0, zr - thick)]
                if sx < 0:
                    tri = [tri[1], tri[0], tri[2]]
                self.face(tri, gable_key, [(0, 0), (d / BAY, 0),
                                           (d / BAY / 2, (zr - zw) / 3.1)])
        return zr

    def done(self, name, col):
        me = lib.make_mesh(name, self.bm, self.mats)
        ob = bpy.data.objects.new(name, me)
        col.objects.link(ob)
        return ob


def _body(P, w, d, storeys, h, wall, z0=0.0, side_windows=None):
    """方盒子墙体：正 / 背立面有窗（一楼带防盗窗和裙砖），侧面短的不开窗。"""
    c = [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]
    if side_windows is None:
        side_windows = d >= 7.5
    for k in range(storeys):
        za, zb = z0 + k * h, z0 + (k + 1) * h
        for i in range(4):
            p0, p1 = c[i], c[(i + 1) % 4]
            front_back = i in (0, 2)
            if front_back or side_windows:
                key = f"wall_{wall}_gf" if k == 0 else f"wall_{wall}"
            else:
                key = f"wall_{wall}_plain"
            P.wall(p0, p1, za, zb, key)


def _bands(P, w, d, storeys, h, key="band_grey", z0=0.0):
    """楼层腰线 / 楼板外露边。"""
    for k in range(1, storeys):
        P.box((w + 0.12, d + 0.12, 0.14), (0, 0, z0 + k * h), key)


def _door(P, x, y, z, wdt=1.6, hgt=2.4, key="door"):
    """贴在正立面（-y 面）外侧的门。"""
    y -= 0.03
    P.face([(x - wdt / 2, y, z), (x + wdt / 2, y, z), (x + wdt / 2, y, z + hgt),
            (x - wdt / 2, y, z + hgt)], key)


def build_flat(P, h_, rng):
    w, d, n = h_["w"], h_["d"], h_["storeys"]
    wall = h_["wall"]
    top = n * H_FLAT
    _body(P, w, d, n, H_FLAT, wall)
    _bands(P, w, d, n, H_FLAT, "band_red" if rng() < 0.35 else "band_grey")
    P.face([(-w / 2, -d / 2, top), (w / 2, -d / 2, top), (w / 2, d / 2, top),
            (-w / 2, d / 2, top)], "roof_flat")
    # 挑檐 + 女儿墙
    P.box((w + 0.5, d + 0.5, 0.16), (0, 0, top + 0.02), "band_grey")
    for (sx, sy, cx, cy) in ((w, 0.18, 0, -d / 2 + 0.09),
                             (w, 0.18, 0, d / 2 - 0.09),
                             (0.18, d, -w / 2 + 0.09, 0),
                             (0.18, d, w / 2 - 0.09, 0)):
        P.box((sx, sy, 0.9), (cx, cy, top + 0.45), "rail")
    _door(P, 0, -d / 2, 0, 1.8, 2.5, "door")
    if rng() < 0.4:  # 琉璃瓦檐口（参考图 02 / 05）
        z = top - 0.25
        P.face([(-w / 2 - 0.3, -d / 2 - 0.7, z - 0.3),
                (w / 2 + 0.3, -d / 2 - 0.7, z - 0.3),
                (w / 2 + 0.3, -d / 2, z + 0.1),
                (-w / 2 - 0.3, -d / 2, z + 0.1)], "glazed")
    if h_["stair"]:  # 楼梯间（参考图 01 / 06）
        sw, sd, sh = 3.0, 3.4, 2.8
        cx, cy = -w / 2 + sw / 2 + 0.3, d / 2 - sd / 2 - 0.3
        c = [(cx - sw / 2, cy - sd / 2), (cx + sw / 2, cy - sd / 2),
             (cx + sw / 2, cy + sd / 2), (cx - sw / 2, cy + sd / 2)]
        for i in range(4):
            P.wall(c[i], c[(i + 1) % 4], top, top + sh,
                   f"wall_{wall}" if i == 0 else f"wall_{wall}_plain")
        P.box((sw + 0.4, sd + 0.4, 0.15), (cx, cy, top + sh), "band_grey")
    if h_["canopy"]:  # 楼顶蓝色彩钢棚（参考图 02）
        zc = top + 2.9
        for sx in (-1, 1):
            for sy in (-1, 1):
                P.cyl(0.06, 2.9, (sx * (w / 2 - 0.2), sy * (d / 2 - 0.2),
                                  top + 1.45), "steel", seg=6)
        P.gable_roof(w + 0.2, d + 0.2, zc, 8, 0.4, "roof_blue", thick=0.05)


def build_tile(P, h_, rng):
    w, d, n = h_["w"], h_["d"], h_["storeys"]
    top = n * H_TILE
    _body(P, w, d, n, H_TILE, "white" if rng() < 0.6 else "cream")
    _bands(P, w, d, n, H_TILE)
    # 屋面颜色按卫星图：红瓦 / 棕瓦 / 青瓦
    roof = {"brown": "roof_brown", "grey": "roof_grey"}.get(h_["roof"], "roof_red")
    P.gable_roof(w, d, top, 24, 0.55, roof, gable_key="wall_white_plain")
    _door(P, 0, -d / 2, 0, 1.6, 2.4)


def build_oldtile(P, h_, rng):
    w, d = h_["w"], h_["d"]
    hh = 3.3
    c = [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]
    for i in range(4):
        P.wall(c[i], c[(i + 1) % 4], 0, hh, "wall_old")
    P.gable_roof(w, d, hh, 27, 1.1, "roof_grey", gable_key="wall_old")
    _door(P, 0, -d / 2, 0, 1.2, 2.2, "door_dark")
    # 檐下木柱
    for x in (-w / 2 + 0.2, w / 2 - 0.2):
        P.cyl(0.09, hh - 0.2, (x, -d / 2 - 0.8, (hh - 0.2) / 2), "trunk", seg=6)


def build_shed(P, h_, rng):
    w, d = h_["w"], h_["d"]
    long_thin = w / max(d, 0.1) > 2.6
    hh = 3.2 if long_thin else (6.0 if h_["area"] > 260 else 4.4)
    c = [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]
    for i in range(4):
        P.wall(c[i], c[(i + 1) % 4], 0, hh, "wall_shed", tiled=False)
    roof = {"blue": "roof_blue", "white": "roof_white", "red": "roof_red",
            "brown": "roof_brown"}.get(h_["roof"], "roof_grey")
    P.gable_roof(w, d, hh, 9, 0.4, roof, thick=0.06, gable_key="wall_shed")
    _door(P, 0, -d / 2, 0, min(4.0, w * 0.4), min(3.6, hh - 0.6), "door_dark")


def _window(P, x, y, z, w, h, bars=False, curtain=0.0, face=-1, panes=3):
    """贴在墙面外侧的铝合金推拉窗（白框 + 深色玻璃 + 半拉窗帘），face=-1 朝 -y、+1 朝 +y。
    panes：竖向分几扇（照片里二、三楼都是三扇推拉 + 上亮子，用户确认）。
    bars=True 时外面加一层白色防盗栏（一楼）。"""
    s = face
    yy = y + s * 0.04
    # 玻璃（略凹进框内）
    P.box((w - 0.08, 0.02, h - 0.08), (x, y + s * 0.015, z + h / 2), "glass")
    if curtain > 0:   # 窗帘：从两侧往中间拉一部分
        cw = (w - 0.1) * curtain / 2
        for sx in (-1, 1):
            cx = x + sx * ((w - 0.1) / 2 - cw / 2)
            P.box((cw, 0.02, h - 0.12), (cx, y + s * 0.025, z + h / 2),
                  "curtain")
    # 外框 + 中梃：panes 扇推拉 + 上亮子
    t = 0.06
    P.box((w, 0.06, t), (x, yy, z + t / 2), "win_frame")
    P.box((w, 0.06, t), (x, yy, z + h - t / 2), "win_frame")
    for k in [i / panes for i in range(panes + 1)]:
        P.box((t, 0.06, h), (x - w / 2 + w * k + (t / 2 if k == 0 else
                                                -t / 2 if k == 1 else 0),
                             yy, z + h / 2), "win_frame")
    P.box((w, 0.06, t), (x, yy, z + h * 0.78), "win_frame")
    if bars:
        n = 11
        for k in range(n):
            bx = x - w / 2 + 0.08 + (w - 0.16) * k / (n - 1)
            P.box((0.03, 0.03, h + 0.1), (bx, y + s * 0.12, z + h / 2), "bars")
        for zz in (z - 0.02, z + h / 3, z + 2 * h / 3, z + h + 0.02):
            P.box((w + 0.12, 0.04, 0.04), (x, y + s * 0.12, zz), "bars")


def _baluster_rail(P, x0, x1, y, z):
    """宝瓶栏杆：底座 + 扶手 + 一排宝瓶柱（两节圆台拼出瓶身），压在外挑的阳台板上。"""
    L = x1 - x0
    P.box((L + 0.3, 0.42, 0.12), ((x0 + x1) / 2, y - 0.12, z - 0.06), "rail")
    P.box((L, 0.2, 0.1), ((x0 + x1) / 2, y - 0.1, z + 0.06), "rail")
    P.box((L + 0.1, 0.24, 0.09), ((x0 + x1) / 2, y - 0.1, z + 0.97), "rail")
    n = max(6, int(L / 0.28))
    for k in range(n):
        bx = x0 + 0.14 + (L - 0.28) * k / (n - 1)
        P.cyl(0.035, 0.3, (bx, y - 0.1, z + 0.26), "rail", seg=8, r2=0.075)
        P.cyl(0.075, 0.42, (bx, y - 0.1, z + 0.62), "rail", seg=8, r2=0.035)
    for bx in (x0 + 0.05, x1 - 0.05):   # 两端方柱
        P.box((0.16, 0.2, 0.9), (bx, y - 0.1, z + 0.5), "rail")


# 我家（户型 docs/design/hometown/my-house-plan.png + 正面照片 my-house-photo.webp）
# 局部坐标：x 向右（面对房子），正立面在 y = -5，三层主楼 y -5 → 3.4（前排三开间 + 中排），
# 后排猪圈 / 厕所、柴房、厨房是一层红瓦偏屋 y 3.4 → 6.8（户型图后排，照片看不到，按川北常见做法推断）
HOME_W = 12.0
HOME_FRONT, HOME_MID, HOME_BACK = -5.0, 3.4, 6.8
HOME_Z0, HOME_H = 0.45, 3.1          # 室内地坪（台基高）、层高
HOME_OPEN = 1.65                     # 中间开间洞口半宽（一楼门廊 / 二三楼凹阳台）
HOME_REC = 1.3                       # 门廊 / 凹阳台进深


def _tile_rows(P, x0, x1, top, bot, r, gap, key, lip, under):
    """一面坡上的瓦垄：沿 x 每隔 gap 一条从屋脊（top）铺到檐口（bot）的半埋圆管，
    每隔约 0.38 m 一圈略粗的短管表示上下两片瓦的搭接（瓦唇）。top / bot 为 (y, z)。
    under：瓦垄下面那层底瓦的材质（垄与垄之间的沟）。"""
    (ya, za), (yb, zb) = top, bot
    L = math.hypot(yb - ya, zb - za)
    ty, tz = (yb - ya) / L, (zb - za) / L          # 顺坡向下的方向
    ny, nz = -tz, ty                               # 坡面法线（朝上）
    if nz < 0:
        ny, nz = -ny, -nz
    # 底瓦：整面坡一层深色面
    P.face([(x0, ya, za), (x1, ya, za), (x1, yb, zb), (x0, yb, zb)], under)
    n = int((x1 - x0) / gap)
    off = (x1 - x0 - n * gap) / 2
    for i in range(n + 1):
        x = x0 + off + i * gap
        lift = r * 0.35
        a = Vector((x, ya + ny * lift, za + nz * lift))
        b = Vector((x, yb + ny * lift, zb + nz * lift))
        lib.add_tube(P.bm, [a, b], r, seg=8, mat=P.mi(key))
        k = 0.38
        while k < L - 0.05:
            c = a + Vector((0, ty * k, tz * k))
            lib.add_tube(P.bm, [c, c + Vector((0, ty * 0.06, tz * 0.06))],
                         r * 1.12, seg=8, mat=P.mi(lip))
            k += 0.38


def _barrel_gable(P, W, y0, y1, zb, x0=None, gables=("wall_home_plain",) * 2,
                  ends=(True, True)):
    """红色筒瓦双坡顶：屋脊平行于正面，前后各挑出 0.35 m。默认铺满 x -W/2 → W/2；
    给 x0 时铺 x0 → x0 + W。gables：左右山墙的材质；ends：左右两端瓦面是否挑出 0.25 m
    （与另一栋屋顶相接的一端不挑出）。"""
    xa = -W / 2 if x0 is None else x0
    xb = xa + W
    pitch = math.radians(24)
    d = y1 - y0
    ym_ = (y0 + y1) / 2
    zr = zb + 0.3 + d / 2 * math.tan(pitch)        # 屋脊高（墙头 0.3 m 起坡）
    over = 0.35
    ze = zb + 0.3 - over * math.tan(pitch)
    # 山墙与前后矮墙
    for i, x in enumerate((xa, xb)):
        tri = [(x, y0, zb), (x, y1, zb), (x, y1, zb + 0.3), (x, ym_, zr - 0.05),
               (x, y0, zb + 0.3)]
        if i:
            tri = list(reversed(tri))
        P.face(tri, gables[i])
    P.wall((xa, y0), (xb, y0), zb, zb + 0.3, "wall_home_plain")
    P.wall((xb, y1), (xa, y1), zb, zb + 0.3, "wall_home_plain")
    X0 = xa - (0.25 if ends[0] else 0.0)
    X1 = xb + (0.25 if ends[1] else 0.0)
    for (ya, yb_) in ((ym_, y0 - over), (ym_, y1 + over)):
        _tile_rows(P, X0, X1, (ya, zr), (yb_, ze), 0.11, 0.27, "barrel",
                   "barrel_lip", "barrel_under")
    # 屋脊：一排压脊的筒瓦
    lib.add_tube(P.bm, [Vector((X0, ym_, zr + 0.06)), Vector((X1, ym_, zr + 0.06))],
                 0.14, seg=10, mat=P.mi("barrel_lip"))


def _grey_lean_to(P, W, y0, y1, zb):
    """后排偏屋的小青瓦单坡：靠主楼一侧高、往房后低，挑檐 0.4 m。"""
    hi, lo = zb + 1.1, zb
    over = 0.4
    k = (hi - lo) / (y1 - y0)
    for sx in (-1, 1):                             # 两端山墙（梯形）
        x = sx * W / 2
        q = [(x, y0, 0), (x, y1, 0), (x, y1, lo), (x, y0, hi)]
        if sx > 0:
            q = list(reversed(q))
        P.face(q, "wall_home_plain")
    _tile_rows(P, -W / 2 - 0.3, W / 2 + 0.3, (y0, hi + 0.05),
               (y1 + over, lo - over * k), 0.075, 0.2, "greytile",
               "greytile_lip", "greytile_under")


def build_home(P, h_, rng):
    """我家：正面逐项对照片还原——整面白色条形瓷砖平墙、中间开间一楼门廊 + 二三楼凹阳台（宝瓶栏杆）、
    两侧推拉窗（一楼带防盗栏）、平屋面挑檐；门前两侧高石块台基、中间步梯（户型图）。"""
    W, yf, ym, yb = HOME_W, HOME_FRONT, HOME_MID, HOME_BACK
    z0, H = HOME_Z0, HOME_H
    o, rec = HOME_OPEN, HOME_REC
    top = z0 + 3 * H
    yr = yf + rec                                 # 凹进去的后墙线
    wp = "wall_home_plain"

    # ---------- 台基与步梯（户型：侧屋前高石块、堂屋前步梯）
    P.box((W + 0.2, ym - yf + 0.2, z0 + 1.0), (0, (yf + ym) / 2, (z0 - 1.0) / 2),
          "stone")
    for sx in (-1, 1):
        xc = sx * (o + (W / 2 - o) / 2)
        P.box((W / 2 - o + 0.1, 1.3, z0 + 1.0), (xc, yf - 0.65, (z0 - 1.0) / 2),
              "stone")
    for k in range(3):                            # 三级步梯
        zt = z0 * (3 - k) / 3
        P.box((2 * o, 0.43, zt + 1.0), (0, yf - 0.215 - 0.43 * k,
                                         (zt - 1.0) / 2), "stone")

    # ---------- 主楼墙体
    for k in range(3):
        za, zb = z0 + k * H, z0 + (k + 1) * H
        zl = zb - 0.25                            # 洞口上沿（下面是过梁）
        # 正立面：两侧实墙 + 洞口上方过梁
        P.wall((-W / 2, yf), (-o, yf), za, zb, wp)
        P.wall((o, yf), (W / 2, yf), za, zb, wp)
        P.wall((-o, yf), (o, yf), zl, zb, wp)
        # 凹进部分：两侧墙 + 后墙
        P.wall((-o, yr), (-o, yf), za, zl, wp)
        P.wall((o, yf), (o, yr), za, zl, wp)
        P.wall((-o, yr), (o, yr), za, zl, wp)
        P.face([(-o, yf, zl), (o, yf, zl), (o, yr, zl), (-o, yr, zl)],
               "band_grey")                       # 洞口顶（楼板底）
        # 侧墙 / 后墙
        P.wall((W / 2, yf), (W / 2, ym), za, zb, wp)
        P.wall((W / 2, ym), (-W / 2, ym), za, zb, wp)
        P.wall((-W / 2, ym), (-W / 2, yf), za, zb, wp)
        # 正面两侧窗：一楼带防盗栏，二、三楼推拉窗（照片左上那扇有浅绿窗帘）
        for sx in (-1, 1):
            xc = sx * (o + (W / 2 - o) / 2)
            if k == 0:
                _window(P, xc, yf, za + 1.05, 1.75, 1.55, bars=True)
            else:
                _window(P, xc, yf, za + 1.0, 1.95, 1.55,
                        curtain=0.55 if (sx < 0 and k == 1) else 0.0)
        for xc in (-3.2, 3.2):
            _window(P, xc, ym, za + 1.1, 1.4, 1.3, face=1)
        # 凹进后墙：二、三楼推拉窗
        if k > 0:
            _window(P, 0, yr, za + 1.0, 2.5, 1.45)
    # 楼板外露的地面（门廊 / 阳台地面）
    for k in range(3):
        z = z0 + k * H
        P.face([(-o, yf, z + 0.01), (o, yf, z + 0.01), (o, yr, z + 0.01),
                (-o, yr, z + 0.01)], "stone" if k == 0 else "band_grey")
    # 二、三楼阳台：外挑阳台板 + 宝瓶栏杆（与墙面齐平、略外挑）
    for k in (1, 2):
        _baluster_rail(P, -o - 0.15, o + 0.15, yf, z0 + k * H)
    # 屋面：三楼屋面板四周挑檐 0.5 m（照片里正面那道薄檐），上面整个盖红色筒瓦双坡顶，
    # 屋脊平行于正面（用户确认三楼没有平顶楼坝，直接是红瓦）
    P.box((W + 1.0, ym - yf + 1.0, 0.22), (0, (yf + ym) / 2, top + 0.11),
          "band_grey")
    _barrel_gable(P, W, yf, ym, top + 0.22, ends=(True, False))

    # ---------- 堂屋门：门洞（深色）+ 门框 + 上方亮子格栅、牌匾、对联、红灯笼、扫帚
    dw, dh = 1.4, 2.35
    P.face([(-dw / 2, yr - 0.02, z0), (dw / 2, yr - 0.02, z0),
            (dw / 2, yr - 0.02, z0 + dh), (-dw / 2, yr - 0.02, z0 + dh)],
           "door_dark")
    for sx in (-1, 1):
        P.box((0.1, 0.08, dh + 0.1), (sx * (dw / 2 + 0.05), yr - 0.04,
                                       z0 + dh / 2), "door")
    P.box((dw + 0.2, 0.08, 0.08), (0, yr - 0.04, z0 + dh + 0.04), "door")
    P.face([(-dw / 2, yr - 0.02, z0 + dh + 0.1), (dw / 2, yr - 0.02, z0 + dh + 0.1),
            (dw / 2, yr - 0.02, z0 + dh + 0.42), (-dw / 2, yr - 0.02,
                                                  z0 + dh + 0.42)],
           "door_dark")
    for k in range(7):                             # 亮子竖格栅
        x = -dw / 2 + 0.1 + (dw - 0.2) * k / 6
        P.box((0.025, 0.03, 0.3), (x, yr - 0.05, z0 + dh + 0.26), "bars")
    P.box((0.75, 0.05, 0.22), (0, yr - 0.04, z0 + dh + 0.62), "plaque")
    for sx in (-1, 1):
        x = sx * (dw / 2 + 0.32)
        P.box((0.3, 0.02, 2.0), (x, yr - 0.03, z0 + 0.35 + 1.0), "couplet")
        # 红灯笼挂在门廊顶下
        lib.add_ico(P.bm, 0.3, (sx * 1.05, yf + 0.55, z0 + H - 0.75), sub=2,
                    mat=P.mi("lantern"), scale=(1, 1, 0.85))
        P.cyl(0.06, 0.28, (sx * 1.05, yf + 0.55, z0 + H - 1.18), "glazed",
              seg=6)
        P.cyl(0.015, 0.4, (sx * 1.05, yf + 0.55, z0 + H - 0.3), "wire", seg=4)
    P.cyl(0.02, 1.4, (-dw / 2 - 0.75, yr - 0.2, z0 + 0.7), "door", seg=4)  # 扫帚把
    # 二楼阳台上的卫星锅（照片里在阳台左侧）
    P.cyl(0.32, 0.05, (-1.15, yf + 0.25, z0 + H + 1.25), "dish", seg=14)
    P.cyl(0.03, 0.9, (-1.15, yf + 0.4, z0 + H + 0.6), "steel", seg=4)

    # ---------- 后排一层偏屋（猪圈 / 厕所、柴房、厨房）：深灰色小青瓦单坡顶（用户草图 + 照片）
    ab = 3.0
    for (p0, p1) in (((W / 2, ym), (W / 2, yb)), ((W / 2, yb), (-W / 2, yb)),
                     ((-W / 2, yb), (-W / 2, ym))):
        P.wall(p0, p1, 0, z0 + ab, wp)
    _grey_lean_to(P, W, ym, yb, z0 + ab)
    # 左侧排水沟（用户确认：与左边邻居之间隔一条沟）：水泥 U 形槽，
    # 沿房子左侧从房后一直通到地坝前墙外，槽底一层浅浅的积水
    dx, dw = -W / 2 - 1.0, 0.5
    y0, y1 = yf - 9.0 - 0.8, yb + 0.8
    L = y1 - y0
    for sx in (-1, 1):
        P.box((0.12, L, 0.32), (dx + sx * (dw / 2 + 0.06), (y0 + y1) / 2, -0.06),
              "stone")
    P.box((dw, L, 0.04), (dx, (y0 + y1) / 2, -0.2), "ditch_water")
    # 厨房烟囱（傍晚炊烟从这里冒出来）
    P.box((0.5, 0.5, 2.2), (W / 2 - 1.4, yb - 1.2, z0 + ab + 1.0), "stone")
    _yard_walls(P, yf)
    _extension(P)


# 老房子右侧后来贴墙新修的一栋（用户俯视草图 my-house-extension-sketch-v2.webp）：
#   后段（草图黑色）：贴老房子右侧外墙，前墙与老房子正面齐平，宽 EXT_W、进深 EXT_D，三层，
#                    红色筒瓦双坡顶，与老房子屋顶连成一片；
#   前段（草图红色）：从正面往地坝一侧凸出 EXT_F，宽度相同，两层，平顶小楼顶（在三楼地面高度），
#                    四周宝瓶栏杆（参考 ref/baluster-rail.webp）；朝地坝的一侧一楼开防盗门。
# 外墙：正面和朝地坝那侧白色条形瓷砖，右侧和背面普通水泥粉刷。宽度、进深按草图比例估计。
EXT_W, EXT_D, EXT_F = 5.8, 7.8, 2.6


def _rail_run(P, a, b, z, axis):
    """一段宝瓶栏杆（沿 x 或 y 方向）：底座、带帽的宝瓶柱、宽压顶，两端方墩。z 为楼面高度。"""
    if axis == "x":
        (x0, y), (x1, _) = a, b
        L, c = abs(x1 - x0), ((x0 + x1) / 2, y)
        size = lambda w, h: (L, w, h)                   # noqa: E731
        at = lambda t: (min(x0, x1) + t, y)             # noqa: E731
    else:
        (x, y0), (_, y1) = a, b
        L, c = abs(y1 - y0), (x, (y0 + y1) / 2)
        size = lambda w, h: (w, L, h)                   # noqa: E731
        at = lambda t: (x, min(y0, y1) + t)             # noqa: E731
    P.box(size(0.34, 0.16), (c[0], c[1], z + 0.08), "rail")      # 底座
    P.box(size(0.36, 0.1), (c[0], c[1], z + 1.0), "rail")        # 压顶
    P.box(size(0.28, 0.06), (c[0], c[1], z + 0.92), "rail")
    n = max(4, int(L / 0.3))
    for k in range(n):
        u, v = at(0.25 + (L - 0.5) * k / (n - 1))
        P.box((0.14, 0.14, 0.06), (u, v, z + 0.19), "rail")      # 柱础
        P.cyl(0.045, 0.22, (u, v, z + 0.33), "rail", seg=8, r2=0.08)
        P.cyl(0.08, 0.28, (u, v, z + 0.58), "rail", seg=8, r2=0.04)
        P.cyl(0.04, 0.1, (u, v, z + 0.77), "rail", seg=8, r2=0.06)
        P.box((0.15, 0.15, 0.06), (u, v, z + 0.86), "rail")      # 柱帽
    for t in (0.0, L):                                           # 端墩
        u, v = at(t)
        P.box((0.3, 0.3, 1.05), (u, v, z + 0.52), "rail")


def _extension(P):
    W, yf = HOME_W, HOME_FRONT
    z0, H = HOME_Z0, HOME_H
    x0, x1 = W / 2, W / 2 + EXT_W
    yb, yfr = yf + EXT_D, yf - EXT_F            # 后段的后墙、前段的前墙
    top = z0 + 3 * H
    xc = (x0 + x1) / 2
    wp, wc = "wall_home_plain", "wall_cement"
    # 墙基 + 一楼地坪
    P.box((EXT_W, yb - yfr, z0 + 1.0), (xc, (yfr + yb) / 2, (z0 - 1.0) / 2), "stone")
    # ---- 后段（红瓦坡顶）：右侧、背面水泥；前墙被前段挡住
    P.wall((x1, yf), (x1, yb), z0, top, wc)
    P.wall((x1, yb), (x0, yb), z0, top, wc)
    P.box((EXT_W + 0.5, EXT_D + 0.5, 0.22), (xc, (yf + yb) / 2, top + 0.11), "band_grey")
    _barrel_gable(P, EXT_W, yf, yb, top + 0.22, x0=x0,
                  gables=(wp, wc), ends=(False, True))
    for k in range(3):
        _window(P, xc, yb, z0 + k * H + 1.1, 1.2, 1.2, face=1, panes=2)
    # ---- 前段：两层（用户在三维图上标出栏杆只到三楼地面这一高度），平顶小楼顶 + 宝瓶栏杆，
    # 从后段三楼开门走出去
    tf = z0 + 2 * H
    P.wall((x0, yfr), (x1, yfr), z0, tf, wp)             # 正面：白瓷砖
    P.wall((x1, yfr), (x1, yf), z0, tf, wc)              # 右侧：水泥
    P.wall((x0, yf), (x0, yfr), z0, tf, wp)              # 朝地坝一侧：白瓷砖
    P.box((EXT_W + 0.3, EXT_F + 0.3, 0.22), (xc, yfr + EXT_F / 2 - 0.15, tf + 0.11),
          "band_grey")
    P.face([(x0, yfr, tf + 0.225), (x1, yfr, tf + 0.225), (x1, yf, tf + 0.225),
            (x0, yf, tf + 0.225)], "roof_flat")
    zt = tf + 0.22
    _rail_run(P, (x0 + 0.15, yfr + 0.15), (x1 - 0.15, yfr + 0.15), zt, "x")
    _rail_run(P, (x0 + 0.15, yfr + 0.15), (x0 + 0.15, yf), zt, "y")
    _rail_run(P, (x1 - 0.15, yfr + 0.15), (x1 - 0.15, yf), zt, "y")
    # 正面每层一扇三扇推拉窗（一楼带防盗栏）
    for k in range(2):
        _window(P, xc, yfr, z0 + k * H + 1.0, 1.95, 1.5, bars=(k == 0))
    # 后段三楼正墙（露在小楼顶后面）：白瓷砖，一扇通往楼顶的门 + 一扇三扇推拉窗
    P.wall((x0, yf), (x1, yf), tf, top, wp)
    P.face([(x0 + 0.9, yf - 0.02, tf + 0.22), (x0 + 1.9, yf - 0.02, tf + 0.22),
            (x0 + 1.9, yf - 0.02, tf + 2.42), (x0 + 0.9, yf - 0.02, tf + 2.42)], "door")
    _window(P, xc + 1.0, yf, tf + 1.0, 1.95, 1.5)
    # 朝地坝一侧：一楼防盗门（深灰钢门 + 门框 + 小台阶），二楼一扇小窗
    dy = yfr + EXT_F / 2
    xd = x0 - 0.02
    P.box((0.06, 1.0, 2.15), (xd, dy, z0 + 1.075), "gate")
    P.box((0.08, 1.2, 0.08), (xd - 0.01, dy, z0 + 2.19), "steel")
    for sy in (-1, 1):
        P.box((0.08, 0.08, 2.2), (xd - 0.01, dy + sy * 0.56, z0 + 1.1), "steel")
    for k in range(4):                                   # 门板横向压纹
        P.box((0.02, 0.86, 0.03), (xd - 0.04, dy, z0 + 0.4 + k * 0.45), "steel")
    P.box((0.5, 1.4, z0), (x0 - 0.25, dy, z0 / 2), "stone")
    _side_window(P, x0, dy, z0 + H + 1.1)


def _side_window(P, x, y, z, w=1.2, h=1.2):
    """朝 -x 的侧墙小窗（两扇推拉）。"""
    P.box((0.02, w - 0.08, h - 0.08), (x - 0.015, y, z + h / 2), "glass")
    t = 0.06
    for zz in (z + t / 2, z + h - t / 2):
        P.box((0.06, w, t), (x - 0.04, y, zz), "win_frame")
    for yy in (y - w / 2 + t / 2, y, y + w / 2 - t / 2):
        P.box((0.06, t, h), (x - 0.04, yy, z + h / 2), "win_frame")


def _yard_walls(P, yf):
    y_front = yf - YARD_D
    xl, xr = -YARD_W / 2, YARD_W / 2
    g0, g1 = GATE_X - GATE_W / 2, GATE_X + GATE_W / 2
    yg = y_front + GATE_IN                       # 铁门所在的线（往里凹）
    segs = [
        (xl, yf, xl, y_front, SIDE_H),           # 左侧墙
        (xr, yf - EXT_F, xr, y_front, SIDE_H),   # 右侧墙（前段之后由新修那栋的侧墙围合）
        (xl, y_front, g0 - 0.2, y_front, FRONT_H),   # 前墙左段
        (g1 + 0.2, y_front, xr, y_front, FRONT_H),   # 前墙右段
        (g0 - 0.2, y_front, g0 - 0.2, yg, FRONT_H),  # 门洞两侧往里折的短墙
        (g1 + 0.2, y_front, g1 + 0.2, yg, FRONT_H),
    ]
    for x0, y0, x1, y1, h in segs:
        if abs(x1 - x0) < 1e-6:                  # 沿 y 方向
            L = abs(y1 - y0) + WALL_T
            size = (WALL_T, L, h + 1.5)
            cap = (WALL_T + 0.08, L + 0.04, 0.08)
        else:
            L = abs(x1 - x0) + WALL_T
            size = (L, WALL_T, h + 1.5)
            cap = (L + 0.04, WALL_T + 0.08, 0.08)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        P.box(size, (cx, cy, (h - 1.5) / 2), "wall_brick")
        P.box(cap, (cx, cy, h + 0.04), "band_grey")
    # 门柱：两根方砖柱，比前墙高
    for x in (g0 - 0.2, g1 + 0.2):
        P.box((0.44, 0.44, 1.6 + 1.5), (x, yg, (1.6 - 1.5) / 2), "wall_brick")
        P.box((0.52, 0.52, 0.1), (x, yg, 1.65), "band_grey")
    # 铁门：双开，外框 + 竖栏杆 + 中间横档，深灰色
    gx0, gx1 = g0, g1
    P.box((gx1 - gx0, 0.05, 0.06), ((gx0 + gx1) / 2, yg, 1.42), "gate")
    P.box((gx1 - gx0, 0.05, 0.06), ((gx0 + gx1) / 2, yg, 0.08), "gate")
    P.box((gx1 - gx0, 0.05, 0.05), ((gx0 + gx1) / 2, yg, 0.75), "gate")
    n = 16
    for i in range(n + 1):
        x = gx0 + (gx1 - gx0) * i / n
        P.box((0.035, 0.035, 1.38), (x, yg, 0.75), "gate")
    P.box((0.05, 0.06, 1.4), ((gx0 + gx1) / 2, yg, 0.75), "gate")


BUILDERS = {"flat": build_flat, "tile": build_tile, "oldtile": build_oldtile,
            "shed": build_shed, "home": build_home}


def build(meta, M, col):
    import random
    rnd = random.Random(7)
    n = 0
    for h_ in meta["houses"]:
        P = Parts(M)
        BUILDERS[h_["kind"]](P, h_, rnd.random)
        # 基础：往地下埋 2 m，台地边缘地面略低时房子不会"浮"起来
        fw, fd = (12.3, 10.3) if h_["kind"] == "home" else (h_["w"], h_["d"])
        P.box((fw, fd, 2.0), (0, 0, -0.98), "band_grey")
        name = "home" if h_["kind"] == "home" else f"house_{h_['id']}"
        ob = P.done(name, col)
        ob.location = Vector((h_["cx"], h_["cy"], h_["z"]))
        ob.rotation_euler = (0, 0, h_["face"] + math.pi / 2)
        n += 1
    return n

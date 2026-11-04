"""采坑几何（纯 numpy，不依赖 bpy，可在 Blender 外测试）。

坑沿环和坑底环来自设计稿（camera.py 反投影到地面），中间十级台阶环沿绕中心的射线线性内插。
每级台阶 = 一条平台（路在这上面）+ 一条陡坎：平台占该级水平宽度的 PLAT 比例，陡坎占其余，
所以是真正的阶梯几何（有立面），不是平滑的碗。
网格按「环线」组织：每条环线有 NA 个顶点，相邻环线之间一圈四边形，UV 的 u = 角度、v = 累计弧宽。
"""
import numpy as np

from . import camera as cam

NA = 1080  # 每圈的角度采样数（第 20 轮 720 → 1080：坡道要切进地形，顶点间距从约 8 m 加密到约 5 m）
PLAT = 0.6  # 平台占每级水平宽度的比例（坑深放大到 300 m 后，北帮屏幕上陡坎约是平台的两倍高，见 camera.DEPTH）


def _radial(poly, center, na=NA):
    """多边形绕 center 按角度重采样：每个角度上最外面交点的半径"""
    P = np.asarray(poly, float)
    Q = np.vstack([P, P[:1]])
    ang = np.linspace(-np.pi, np.pi, na, endpoint=False)
    out = np.zeros(na)
    for i, t in enumerate(ang):
        d = np.array([np.cos(t), np.sin(t)])
        best = 0.0
        for a, b in zip(Q[:-1], Q[1:]):
            e = b - a
            M = np.array([[d[0], -e[0]], [d[1], -e[1]]])
            if abs(np.linalg.det(M)) < 1e-9:
                continue
            r, k = np.linalg.solve(M, a - center)
            if r > 0 and 0 <= k <= 1:
                best = max(best, r)
        out[i] = best
    return ang, out


def ray_hit(img_xy, surface, z_top=0.0, step=0.5):
    """设计稿像素 → 视线和地表 surface(x, y) → z 的第一个交点 (x, y, z)：沿视线从 z_top 往下每 step 米取一点，
    找到第一次落到地表以下的位置再线性内插。原来用「反投影 → 取该处台阶高度 → 再反投影」的迭代，
    坑深放大到 300 m 后陡坎 53°，迭代在相邻两级之间来回跳不收敛，标签锚点偏了 16–26 px"""
    zs = np.arange(z_top, -cam.DEPTH - 2 * step, -step)
    prev = None
    for z in zs:
        x, y = cam.backproject([img_xy], z)[0]
        f = z - surface(x, y)  # 视线高出地表多少
        if f <= 0:
            if prev is None:
                return float(x), float(y), float(surface(x, y))
            (x0, y0, z0, f0) = prev
            t = f0 / (f0 - f)
            xi, yi = x0 + (x - x0) * t, y0 + (y - y0) * t
            return float(xi), float(yi), float(surface(xi, yi))
        prev = (x, y, z, f)
    return float(x), float(y), float(surface(x, y))


class Pit:
    def __init__(self):
        o = cam.outline()
        self.rim_g = cam.backproject(o["rim"], 0.0)
        self.floor_g = cam.backproject(o["floor"], -cam.DEPTH)
        # 中心：坑底环重心（两条轮廓都对它星形，plate.py 同样的取法）
        self.center = self.floor_g.mean(0)
        self.ang, self.r_rim = _radial(self.rim_g, self.center)
        _, self.r_floor = _radial(self.floor_g, self.center)

    def locate(self, x, y):
        """世界 (x, y) → (θ, s)：s 由该方向上沿 / 坑底半径反求（0 坑沿 … 1 坑底，>1 在坑底内，<0 在坑外）"""
        th = float(np.arctan2(y - self.center[1], x - self.center[0]))
        r = float(np.hypot(x - self.center[0], y - self.center[1]))
        rr = float(np.interp(th, self.ang, self.r_rim, period=2 * np.pi))
        rf = float(np.interp(th, self.ang, self.r_floor, period=2 * np.pi))
        return th, (rr - r) / max(rr - rf, 1e-6)

    def point(self, theta, s):
        """(θ, s) → 世界 (x, y)：s 可超出 [0, 1]（<0 在坑沿外）"""
        rr = np.interp(theta, self.ang, self.r_rim, period=2 * np.pi)
        rf = np.interp(theta, self.ang, self.r_floor, period=2 * np.pi)
        r = rr * (1 - s) + rf * s
        return self.center[0] + r * np.cos(theta), self.center[1] + r * np.sin(theta)

    @staticmethod
    def z_of_s(s):
        """环参数 s → 台阶面高度：平台是平的，陡坎线性下降；s<0（坑外）为 0，s>1（坑底）为 -DEPTH"""
        if s <= 0:
            return 0.0
        if s >= 1:
            return -cam.DEPTH
        k = int(s * cam.NB)
        f = s * cam.NB - k
        if f < PLAT:
            return -cam.BENCH * k
        return -cam.BENCH * (k + (f - PLAT) / (1 - PLAT))

    def place(self, img_xy):
        """设计稿像素 → 视线和台阶面的第一个交点 (x, y, z)（从设计稿相机看过去正好落在这个像素上）"""
        return ray_hit(img_xy, lambda x, y: self.z_of_s(self.locate(x, y)[1]))

    def ring(self, s, z):
        """s: 0 坑沿 → 1 坑底（可超出，<0 向外）；返回 (NA, 3) 顶点"""
        r = self.r_rim * (1 - s) + self.r_floor * s
        return np.c_[
            self.center[0] + r * np.cos(self.ang),
            self.center[1] + r * np.sin(self.ang),
            np.full(len(r), z),
        ]

    def lines(self):
        """台阶环线序列 [(s, z)]：平台起 → 平台 1/3 → 平台 2/3 → 平台止（坎顶）→ 陡坎半高 → 陡坎底（= 下一级平台起）…
        第 20 轮：平台分 3 段、陡坎分 2 段（原来每级只有坎顶 / 坡脚两圈），坡道切进地形时径向才有顶点可动"""
        L = [(0.0, 0.0)]
        for k in range(cam.NB):
            z = -cam.BENCH * k
            L.append(((k + PLAT / 3) / cam.NB, z))
            L.append(((k + PLAT * 2 / 3) / cam.NB, z))
            L.append(((k + PLAT) / cam.NB, z))
            L.append(((k + PLAT + (1 - PLAT) / 2) / cam.NB, z - cam.BENCH / 2))
            L.append(((k + 1) / cam.NB, -cam.BENCH * (k + 1)))
        return L

    def strips(self, lines):
        """相邻环线之间的四边形带 → (verts, faces, loop_uv)。
        loop_uv 是每个面四个角的 (u, v)：u = 角度 / 2π（接缝那一格走到 1.0，不回绕到 0，避免整张图被压进一个面）、v = 环线序号 / 总数"""
        n = len(lines)
        V = np.vstack([self.ring(s, z) for s, z in lines])  # (n*NA, 3)
        faces, luv = [], []
        for i in range(n - 1):
            v0, v1 = i / (n - 1), (i + 1) / (n - 1)
            for j in range(NA):
                a = i * NA + j
                b = i * NA + (j + 1) % NA
                c = (i + 1) * NA + (j + 1) % NA
                d = (i + 1) * NA + j
                faces.append((a, b, c, d))
                u0, u1 = j / NA, (j + 1) / NA
                luv.append([(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
        return V, np.array(faces), luv

    def terraces(self):
        """台阶带（平台 + 陡坎）：返回 (verts, faces, kind)，kind 0 = 平台 1 = 陡坎（相邻两圈高度不同的带是陡坎）"""
        L = self.lines()
        V, F, LUV = self.strips(L)
        kind = np.array([0 if abs(L[i][1] - L[i + 1][1]) < 1e-6 else 1 for i in range(len(L) - 1) for _ in range(NA)])
        return V, F, LUV, kind

    def floor(self):
        """坑底：围着中心的扇形，z = -DEPTH"""
        ring = self.ring(1.0, -cam.DEPTH)
        c = np.array([[self.center[0], self.center[1], -cam.DEPTH]])
        V = np.vstack([ring, c])
        F = np.array([(j, (j + 1) % NA, NA) for j in range(NA)])
        # 平面 UV：按坑底包围盒归一化（扇形面互不重叠）
        lo, hi = ring[:, :2].min(0), ring[:, :2].max(0)
        uv = lambda p: tuple((np.asarray(p[:2]) - lo) / (hi - lo))
        luv = [[uv(V[a]), uv(V[b]), uv(V[c_])] for a, b, c_ in F]
        return V, F, luv

    def ground(self, outer=9000.0):
        """坑外的地面：从坑沿向外逐渐过渡到半径 outer 的圆，z = 0"""
        ts = [0.0, 0.015, 0.04, 0.09, 0.18, 0.34, 0.6, 1.0]
        rings = []
        for t in ts:
            r = self.r_rim * (1 - t) + outer * t
            rings.append(
                np.c_[
                    self.center[0] + r * np.cos(self.ang),
                    self.center[1] + r * np.sin(self.ang),
                    np.zeros(NA),
                ]
            )
        V = np.vstack(rings)
        faces, luv = [], []
        uv = lambda p: ((p[0] - self.center[0]) / (2 * outer) + 0.5, (p[1] - self.center[1]) / (2 * outer) + 0.5)
        for i in range(len(ts) - 1):
            for j in range(NA):
                a = i * NA + j
                b = i * NA + (j + 1) % NA
                c = (i + 1) * NA + (j + 1) % NA
                d = (i + 1) * NA + j
                faces.append((a, b, c, d))
                luv.append([uv(V[a]), uv(V[b]), uv(V[c]), uv(V[d])])
        return V, np.array(faces), luv


# ----------------------------------------------------------------------------- 设计稿投影贴图（地表 / 坑底）


def design_uv(pts3):
    """世界点 (n, 3) → 设计稿投影贴图（models/open-pit/design_ground.png）的 UV：
    先用设计稿相机投到场景图像素，再按贴图的放大倍数和留边换算；Blender 的 UV 原点在左下，所以 v 要翻转"""
    T = cam.outline()["groundTex"]
    px = cam.project(pts3)
    u = (T["pad_x"] + T["scale"] * px[:, 0]) / T["w"]
    v = 1 - (T["pad_y"] + T["scale"] * px[:, 1]) / T["h"]
    return np.c_[u, v]


def ground_design(pit, nx=256, ny=144, lift=1.5):
    """贴设计稿的地表：在场景图像素空间（含留边）铺均匀网格，反投影到地面 z = lift。
    网格按像素均匀，所以 UV 线性插值几乎没有透视误差；坑里的顶点沿径向挪到坑沿上（网格边缘贴着坑沿），整个格子都在坑里的不要。
    lift 1.5 m：比烘焙的大地面（z = 0）高一点，避免深度冲突。"""
    T = cam.outline()["groundTex"]
    x0, x1 = -T["pad_x"] / T["scale"], (T["w"] - T["pad_x"]) / T["scale"]
    y0, y1 = -T["pad_y"] / T["scale"], (T["h"] - T["pad_y"]) / T["scale"]
    xs, ys = np.linspace(x0, x1, nx + 1), np.linspace(y0, y1, ny + 1)
    gx, gy = np.meshgrid(xs, ys)
    img = np.c_[gx.ravel(), gy.ravel()]
    g = cam.backproject(img, lift)
    inside = np.zeros(len(g), bool)
    for i, (x, y) in enumerate(g):
        th, s_ = pit.locate(x, y)
        if s_ > 0:  # 在坑沿以内：挪到坑沿上
            inside[i] = True
            g[i] = pit.point(th, 0.0)
    V = np.c_[g, np.full(len(g), lift)]
    F = []
    w = nx + 1
    for j in range(ny):
        for i in range(nx):
            a, b, c, d = j * w + i, j * w + i + 1, (j + 1) * w + i + 1, (j + 1) * w + i
            if inside[a] and inside[b] and inside[c] and inside[d]:
                continue
            F.append((a, d, c, b))  # 图像 y 向下 = 世界向南，绕向翻一下让法线朝上
    UV = design_uv(V)
    luv = [[tuple(UV[k]) for k in f] for f in F]
    return V, F, luv


def floor_design(pit, rings=36):
    """贴设计稿的坑底：坑底轮廓到中心之间的同心环（细分开，保证投影 UV 准），z = -DEPTH"""
    ring = pit.ring(1.0, -cam.DEPTH)
    c = np.array([pit.center[0], pit.center[1], -cam.DEPTH])
    V = []
    for k in range(rings + 1):
        t = k / rings  # 0 = 坑底轮廓，1 = 中心
        V.append(ring + (c - ring) * t)
    V = np.vstack(V)
    F = []
    for k in range(rings):
        for j in range(NA):
            a, b = k * NA + j, k * NA + (j + 1) % NA
            F.append((a, b, b + NA, a + NA))
    UV = design_uv(V)
    luv = [[tuple(UV[i]) for i in f] for f in F]
    return V, F, luv

# 排土场底面轮廓（设计稿场景图像素，地面接触线）：西侧大的带光伏、东侧小的；高度是演示假设
DUMPS = {
    "DP-W": {
        "base": [(-60, 418), (130, 430), (260, 412), (350, 378), (432, 332), (474, 252), (446, 222), (352, 176), (272, 152), (200, 148), (110, 188), (-60, 255)],
        "height": 95.0,
        "n": 7,
    },
    "DP-I": {
        "base": [(1180, 362), (1232, 402), (1332, 428), (1442, 417), (1502, 372), (1507, 330), (1462, 286), (1382, 266), (1312, 268), (1232, 300), (1190, 336)],
        "height": 62.0,
        "n": 5,
    },
}


_PIT = None


def dump_ground(name, margin=-0.04, step=40.0):
    """排土场底面轮廓（世界 xy）：设计稿手描的底边反投影到地面，按 step 米加密，
    压进坑沿以内的点沿坑的径向推回坑沿外 margin 处（西排土场的东脚原来压进坑里约三级台阶，卸载的卡车悬在台阶上空）"""
    global _PIT
    if _PIT is None:
        _PIT = Pit()
    g = cam.backproject(DUMPS[name]["base"], 0.0)
    dense = []
    for a, b in zip(g, np.roll(g, -1, axis=0)):
        k = max(1, int(np.hypot(*(b - a)) / step))
        dense += [a + (b - a) * (i / k) for i in range(k)]
    out = []
    for x, y in dense:
        th, s = _PIT.locate(x, y)
        if s > margin:
            x, y = _PIT.point(th, margin)
        out.append((float(x), float(y)))
    return np.array(out)


def mound(g, height, n, shrink=0.72):
    """阶梯状土堆：g 是底面轮廓（世界 xy，dump_ground 给的），n 级，每级一个平台带 + 一个陡坎带，整体向重心收拢到 (1 - shrink)；顶面平。
    返回 (verts, faces, kind)：kind 0 平台 1 陡坎 2 顶面"""
    g = np.asarray(g, float)
    c = g.mean(0)
    m = len(g)

    def ring(k_frac, z):
        s_ = 1 - shrink * k_frac
        pts = c + (g - c) * s_
        return np.c_[pts, np.full(m, z)]

    lines = []
    for k in range(n):
        f0, f1 = k / n, (k + 1) / n
        z0, z1 = height * f0, height * f1
        lines.append((f0, z0))  # 本级平台外缘（= 上一级陡坎底）
        lines.append((f0 + (f1 - f0) * 0.62, z0))  # 平台内缘
    lines.append((1.0, height))  # 最后一级陡坎的顶
    V = np.vstack([ring(f, z) for f, z in lines])
    nl = len(lines)
    F, kind, luv = [], [], []
    for i in range(nl - 1):
        v0, v1 = 0.8 * i / (nl - 1), 0.8 * (i + 1) / (nl - 1)  # 侧面占 v 的 0–0.8，顶面占 0.82–1
        for j in range(m):
            a_, b_ = i * m + j, i * m + (j + 1) % m
            F.append((a_, b_, b_ + m, a_ + m))
            kind.append(i % 2)  # 偶数条 = 平台，奇数条 = 陡坎（连到下一级外缘）
            u0, u1 = j / m, (j + 1) / m
            luv.append([(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
    # 顶面：围着重心的扇形，平面 UV 放在 v 的 0.82–1 区域，不和侧面重叠
    ctr = np.array([[c[0], c[1], height]])
    V = np.vstack([V, ctr])
    ci = len(V) - 1
    last = (nl - 1) * m
    R = float(np.max(np.hypot(*(g - c).T))) * (1 - shrink)
    top_uv = lambda p: (0.5 + 0.5 * (p[0] - c[0]) / R, 0.82 + 0.17 * (0.5 + 0.5 * (p[1] - c[1]) / R))
    for j in range(m):
        F.append((last + j, last + (j + 1) % m, ci))
        kind.append(2)
        luv.append([top_uv(V[last + j]), top_uv(V[last + (j + 1) % m]), top_uv(V[ci])])
    return V, F, np.array(kind), luv


def grid_lines(pit, extent=9000.0, spacing=400.0, width=2.5, seg=100.0, z=0.3):
    """地面网格线（真几何的细带，不烘焙：线宽 2.5 m，贴图烘焙的每像素约 9 m 画不出来）。坑里的段不要。"""
    V, F = [], []
    ticks = np.arange(-extent, extent + 1, spacing)
    for t in ticks:
        for axis in (0, 1):
            for s0 in np.arange(-extent, extent, seg):
                p0 = np.array([t, s0]) if axis == 0 else np.array([s0, t])
                p1 = np.array([t, s0 + seg]) if axis == 0 else np.array([s0 + seg, t])
                mid = (p0 + p1) / 2
                th, s_ = pit.locate(mid[0], mid[1])
                if s_ > -0.04:  # 在坑沿内（或贴着坑沿）
                    continue
                n = np.array([1.0, 0.0]) if axis == 0 else np.array([0.0, 1.0])  # 线宽方向（垂直于线）
                k = len(V)
                for q in (p0 - n * width / 2, p0 + n * width / 2, p1 + n * width / 2, p1 - n * width / 2):
                    V.append((q[0], q[1], z))
                F.append((k, k + 1, k + 2, k + 3))
    return np.array(V), F


def ribbons(pit, entries, width):
    """环带：entries 是 [(s, z)]，每条是环线 s 处宽 width（米）、高度 z 的一圈窄带。
    环参数 s 每增加 1 对应的水平距离是 (r_rim - r_floor)，所以半宽换算成 s 的偏移 = (width / 2) / (r_rim - r_floor)。"""
    V, F = [], []
    span = np.maximum(pit.r_rim - pit.r_floor, 1.0)
    ds = (width / 2) / span
    for s_mid, z in entries:
        off = sum(len(x) for x in V)
        V.append(pit.ring(s_mid - ds, z))
        V.append(pit.ring(s_mid + ds, z))
        for j in range(NA):
            i0 = off + j
            i1 = off + (j + 1) % NA
            F.append((i0, i1, i1 + NA, i0 + NA))
    return np.vstack(V), np.array(F)


def roads(pit, width=5.0, nb=cam.NB):
    """每级平台中线上的一条路带（略高于平台面）"""
    return ribbons(pit, [((k + PLAT / 2) / nb, -cam.BENCH * k + 0.5) for k in range(nb)], width)


def crests(pit, width=3.5, nb=cam.NB):
    """每级陡坎顶沿（平台内缘）的亮边线：设计稿里每级台阶沿口都有一道青色亮线。
    宽 3.5 m：总览一个像素约 2 m，1.6 m 宽的线不到一个像素，没有抗锯齿时断成虚线"""
    return ribbons(pit, [((k + PLAT) / nb, -cam.BENCH * k + 0.4) for k in range(nb)], width)


def polyline_ribbons(lines, width=5.0, lift=0.4):
    """折线 → 窄带（斜坡、出坑路等）：lines 是 [[(x, y, z), …], …]，返回 (verts, faces)"""
    V, F = [], []
    for line in lines:
        pts = np.asarray(line, float)
        n = len(pts)
        tang = np.gradient(pts[:, :2], axis=0)
        tang /= np.linalg.norm(tang, axis=1)[:, None] + 1e-9
        nrm = np.c_[-tang[:, 1], tang[:, 0]]
        base = len(V)
        for q, nn in zip(pts, nrm):
            V.append((q[0] + nn[0] * width / 2, q[1] + nn[1] * width / 2, q[2] + lift))
            V.append((q[0] - nn[0] * width / 2, q[1] - nn[1] * width / 2, q[2] + lift))
        for i in range(n - 1):
            F.append((base + 2 * i, base + 2 * i + 1, base + 2 * i + 3, base + 2 * i + 2))
    return np.array(V), F


def offset_polylines(lines, off):
    """折线沿水平法向平移 off 米（正 = 前进方向左侧）：运输道路的两条边线"""
    out = []
    for line in lines:
        pts = np.asarray(line, float)
        tang = np.gradient(pts[:, :2], axis=0)
        tang /= np.linalg.norm(tang, axis=1)[:, None] + 1e-9
        nrm = np.c_[-tang[:, 1], tang[:, 0]]
        out.append([(q[0] + nn[0] * off, q[1] + nn[1] * off, q[2]) for q, nn in zip(pts, nrm)])
    return out


def mound_loops(g, height, n, shrink=0.72):
    """土堆每级平台内缘的闭合折线（画青色沿口亮线用）：和 mound() 同一套几何，g 同 mound()"""
    g = np.asarray(g, float)
    c = g.mean(0)
    loops = []
    for k in range(n):
        f0, f1 = k / n, (k + 1) / n
        f = f0 + (f1 - f0) * 0.62
        pts = c + (g - c) * (1 - shrink * f)
        z = height * f0
        loops.append([(x, y, z) for x, y in pts] + [(pts[0][0], pts[0][1], z)])
    return loops

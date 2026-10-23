"""十堰 · 东环路综合能源站 规划示意图生成脚本。

把甲方草图（docs/design/shiyan-energy/client/sketch.jpg）和语音说明落到真实卫星图
（client/satellite.webp）上：功能分区、园区路、保留林地、后方预留地、流线和图例，
输出 docs/design/shiyan-energy/plan-v1.png（规划示意）和 analysis-v1.png（甲方资料对照），
并打印各分区面积（亩）。

底图配准与比例尺：
  - client/parcels-240mu.jpg（130 亩 + 110 亩 用地红线、甲方粉色手绘圈）和
    client/site-marked.png（甲方手机地图上画的上下两个台阶红框）各取 3~5 对同名点
    （厂房屋顶角、橙顶民房、蓝顶小屋、场地中的白色标记物），最小二乘仿射配准到 satellite.webp 像素坐标；
  - 比例尺按“两块红线合计 240 亩”反算，约 0.47 m/像素，与东环路宽约 21 m、呼北高速桥面宽约 28 m 相符。

局部坐标（米）：原点 O 取现状台地边线 L1（下台阶北沿）西端；u 沿 L1 指向东偏北，
v 垂直于 L1 指向北（上台阶 v > 0，下台阶 v < 0）。规划内容全部用 (u, v) 给出。

用法：python scripts/shiyan-energy/draw_plan.py
"""

import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DOC = os.path.join(ROOT, "docs/design/shiyan-energy")
SAT = os.path.join(DOC, "client/satellite.webp")
SKETCH = os.path.join(DOC, "client/sketch.jpg")
OUT_PLAN = os.path.join(DOC, "plan-v1.png")
OUT_ANALYSIS = os.path.join(DOC, "analysis-v1.png")
FONT_DIR = os.path.join(ROOT, "src/assets/fonts")
FONT_BODY = os.path.join(FONT_DIR, "SourceHanSansCN-Regular.otf")
FONT_TITLE = os.path.join(FONT_DIR, "AlimamaShuHeiTi-Bold.ttf")

MU = 2000 / 3  # 1 亩 = 666.67 m²

# ---------------------------------------------------------------- 配准（甲方资料 → 底图像素）

# 同名点：(资料图像素, 底图像素)
REG_PARCELS = [  # parcels-240mu.jpg
    ((538, 60), (893, 140)),  # 北侧蓝顶厂房东北角
    ((337, 152), (425, 365)),  # 西侧长条浅灰屋顶西北角
    ((225, 108), (160, 258)),  # 西侧蓝顶厂房西北角
    ((262, 228), (252, 545)),  # 红顶厂房西北角
    ((425, 444), (621, 1062)),  # 橙顶民房
]
REG_MARKED = [  # site-marked.png（手机地图，画面相对正北转了约 10°）
    ((35, 207), (621, 1062)),  # 橙顶民房
    ((42, 332), (680, 1254)),  # 蓝顶小屋
    ((233, 63), (906, 775)),  # 场地中的白色标记物
]


def fit_affine(pairs):
    """最小二乘仿射：返回 2×3 矩阵 A，使 dst ≈ A @ [x, y, 1]。"""
    src = np.array([[x, y, 1.0] for (x, y), _ in pairs])
    dst = np.array([d for _, d in pairs], float)
    a, *_ = np.linalg.lstsq(src, dst, rcond=None)
    return a.T


A_PARCELS = fit_affine(REG_PARCELS)
A_MARKED = fit_affine(REG_MARKED)


def tf(a, pts):
    return [tuple(a @ (x, y, 1.0)) for x, y in pts]


def area(pts):
    """多边形面积（鞋带公式）。"""
    p = np.asarray(pts, float)
    x, y = p[:, 0], p[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


# 甲方用地红线（parcels-240mu.jpg 像素，人工描点）：西块 130 亩，东块 110 亩；
# 西块南端缺的小方块是徐氏祠（与卫星图上的 1 号定位点重合）
PARCEL_130 = [(395, 97), (450, 100), (500, 100), (550, 84), (587, 119), (625, 153), (644, 164),
              (655, 170), (528, 418), (528, 544), (497, 544), (497, 578), (459, 575), (452, 500),
              (447, 437), (437, 350), (420, 250), (400, 160), (392, 120)]
PARCEL_110 = [(655, 170), (806, 228), (812, 240), (809, 244), (744, 450), (687, 445), (650, 445),
              (616, 456), (603, 469), (600, 475), (597, 550), (619, 556), (619, 594), (528, 588),
              (528, 418)]
# 甲方在 parcels-240mu.jpg 上用粉色粗笔圈出的使用范围（约 66 亩，即语音里的“总共 70 亩”）
PINK_70 = [(485, 333), (550, 340), (600, 370), (630, 415), (620, 450), (590, 490), (585, 540),
           (590, 600), (560, 608), (470, 595), (462, 550), (460, 450), (462, 365)]
# 甲方在 site-marked.png 上画的两个红框（site-marked.png 像素）：下 = 合并后的下台阶，上 = 上台阶
MARK_LOWER = [(75, 285), (272, 272), (213, 363), (68, 393)]
MARK_UPPER = [(70, 150), (275, 150), (277, 262), (75, 272)]
MARK_SELF = (210, 380)  # 甲方拍照 / 发图时所在位置（蓝点）

PARCELS = [tf(A_PARCELS, PARCEL_130), tf(A_PARCELS, PARCEL_110)]
S = math.sqrt(240 * MU / (area(PARCELS[0]) + area(PARCELS[1])))  # 米 / 底图像素

# ---------------------------------------------------------------- 局部坐标

L1 = ((700, 1162), (1033, 1083))  # 现状台地边线（底图像素），下台阶北沿
O = L1[0]
_th = math.atan2(L1[1][1] - L1[0][1], L1[1][0] - L1[0][0])
U = (math.cos(_th), math.sin(_th))  # 沿 L1，东偏北
V = (U[1], -U[0])  # 垂直 L1，指向北


def base(u, v):
    """局部米坐标 → 底图像素。"""
    return (O[0] + (u * U[0] + v * V[0]) / S, O[1] + (u * U[1] + v * V[1]) / S)


def local(x, y):
    """底图像素 → 局部米坐标。"""
    dx, dy = x - O[0], y - O[1]
    return ((dx * U[0] + dy * U[1]) * S, (dx * V[0] + dy * V[1]) * S)


# ---------------------------------------------------------------- 规划数据（局部坐标，米）

# 园区路中线：东环路现状门口 → 沿厂房西侧斜向北上 → 过 L1 后转正北，一直贯通到后方预留地
ROAD_W = 10.0
ROAD_PTS = [(80, -145), (91, -114), (106, -86), (121, -59), (136, -33), (150, -11), (160, 5),
            (166, 22), (169, 42), (170, 75), (170, 125)]
ROAD_EXT = [(170, 125), (169, 175), (166, 230), (160, 285)]  # 延伸进后方预留地（现状道路保留）

# 规划用地红线（约 70 亩）：南沿东环路，东沿现状厂房西侧围墙（取 110 亩红线），
# 厂房以北以园区路东沿为界（路东这一条不做停车场，退回后方预留），北界按甲方粉色圈，西界取 130 亩红线
RED_SOUTH = [(-23, -106), (80, -139)]
# 乘用车停车带东边线，南 → 北（东环路边 → 厂房西北角）：按用户在规划图上的红色填充描出（2026-10-20），
# 离园区路沿约 12~18 m；也是这一段的规划红线
PARK_EDGE = [(96.2, -144.2), (99.8, -140), (108.1, -126.6), (120, -108.8), (130, -88.2),
             (139.5, -69.9), (150.1, -46.8), (163.1, -24.2), (174.4, -3.8)]
# 进口东侧树林（110 亩红线南端凸出、厂房南面的一块）的外边线，南 → 北：保留原样，不在规划红线内
TREES_LINE = [(142, -153), (152, -117), (130.3, -104.9), (153.7, -22.4)]
RED_NORTH = [(150, 131), (110, 141), (60, 147), (12, 152)]
RED_WEST = [(0.5, 56.4), (-10.9, -13.9), (-23.1, -98)]
V_RED_ROAD = 124.0  # 红线北界跨过园区路的位置（v）

SLOPE = 3.0  # 上下台阶之间的边坡 / 挡墙半宽（L1 两侧各 3 m）
GROVE_N = -77.0  # 徐氏祠林地北沿（下台阶南界）
XU_HALL = (35, -101)  # 徐氏祠（parcels-240mu.jpg 红线缺口中心）
L2 = [(17, -35.4), (111, -34.4)]  # 下台阶中间的现状小台地边线（两级合并平整后消失）

# 下台阶：重卡充电（两排光伏车棚）+ 箱变 + 储能
TRUCK_BAY_W = 4.5
TRUCK_ROWS = [  # (u0, u1, v0, v1)，车位垂直于通道，进深 20 m，车头朝通道倒车入位
    (32, 122, -25, -5),
    (32, 104, -63, -43),
]
TRUCK_AISLE = (22, 140, -43, -25)  # 两排之间 18 m 通道，东端接园区路
SERVICE_LANE = (22, 32, -63, -5)  # 西端检修 / 消防通道
BOX_TRANS = [(4, 10, -18, -8), (12, 18, -18, -8)]  # 箱变 ×2
ESS = [(u, u + 2.5, v, v + 12.2) for v in (-60, -44) for u in (3, 7, 11, 15)]  # 储能预制舱 ×8

# 上台阶：加氢站（西）· 换电站（中）· 综合楼（东，靠园区路）
UP_ROADS = [
    (0, 168, 8, 18),  # 南侧通道（沿边坡顶）
    (10, 168, 112, 121),  # 北侧通道
    (62, 70, 18, 112),  # 加氢 / 换电之间
    (118, 126, 18, 112),  # 换电 / 综合楼之间
]
H2_CANOPY = (14, 56, 28, 50)  # 加氢罩棚（光伏）
H2_DISP = [(u, u + 6, 38, 40) for u in (19, 32, 45)]  # 加氢机岛 ×3
H2_TRAILER = (14, 56, 58, 72)  # 长管拖车卸气位
H2_STORE = (14, 56, 80, 106)  # 储氢 · 压缩区（围栏隔离，离综合楼、徐氏祠最远）
SWAP_HALLS = [(76, 88, 50, 80), (100, 112, 50, 80)]  # 换电站 ×2，南进北出通过式
SWAP_CANOPY = [(74, 114, 24, 46), (74, 114, 84, 108)]  # 待换 / 换后车位光伏车棚
OFFICE = (130, 160, 80, 108)  # 综合楼
OFFICE_PARK = (130, 160, 26, 66)  # 综合楼访客停车（光伏车棚）

# 园区路东侧乘用车充电停车场（光伏车棚）：进口 → 厂房西北角的一条停车带（东界 PARK_EDGE）。
# 车位沿园区路排布，距离以园区路中线为基准（d，向东为正，米）：靠路一排 + 通道 + 外侧一排（带宽够才排），
# 车位 2.5 × 5.3 m、通道 5.5 m（JGJ 100 小型车垂直后退停车）；外侧组（CAR_ROWS / CAR_AISLES 的后几项）
# 留着给更宽的场地用，当前停车带放不下，会被自动略去
CAR_W, CAR_D = 2.5, 5.3
CAR_RANGE = (-144, -4)  # 停车带 v 范围
CAR_ROWS = [(5.5, 10.8), (16.3, 21.6), (21.6, 26.9), (32.4, 37.7)]
CAR_AISLES = [(10.8, 16.3), (26.9, 32.4)]  # 第 k 条通道两侧是第 2k、2k+1 排
CAR_CONNECT = [(-144, -138), (-77, -71), (-10, -4)]  # 第一条通道接园区路的口子：南、中、北各一处
CROSS_N = 3  # 外侧通道两端各一条横向联络道接回第一条通道，占 3 个车位宽（7.5 m）

# 流线（局部坐标折线；乘用车流线依赖园区路几何，在下面几何工具之后生成）
FLOW_TRUCK = [(81, -150), (91, -117), (106, -89), (120, -62), (128, -46), (124, -36), (100, -34),
              (46, -34)]
FLOW_UPPER = [(84, -150), (94, -117), (109, -89), (124, -62), (139, -36), (153, -14), (162, 3),
              (164, 13), (150, 13), (40, 13)]

# 配色（深色底图上的高亮色）
COL = {
    "truck": (74, 144, 255),
    "h2": (40, 214, 236),
    "swap": (168, 124, 255),
    "office": (255, 150, 60),
    "car": (176, 228, 72),
    "box": (255, 86, 104),
    "ess": (255, 206, 72),
    "grove": (46, 160, 84),
    "slope": (196, 140, 84),
    "red": (255, 64, 64),
    "pv": (24, 46, 104),
    "road": (58, 62, 72),
    "back": (210, 214, 222),
}

# ---------------------------------------------------------------- 几何工具


def chaikin(pts, n=3):
    """Chaikin 细分，让道路中线圆顺（保留首尾点）。"""
    for _ in range(n):
        out = [pts[0]]
        for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
            out += [(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1),
                    (0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1)]
        out.append(pts[-1])
        pts = out
    return pts


def offset(pts, d):
    """折线向右（前进方向右手侧，即道路东侧）偏移 d 米；d < 0 为向左。"""
    out = []
    for i, (u, v) in enumerate(pts):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, len(pts) - 1)]
        tu, tv = b[0] - a[0], b[1] - a[1]
        n = math.hypot(tu, tv)
        out.append((u + tv / n * d, v - tu / n * d))
    return out


def clip_v(pts, v0, v1):
    """取折线上 v0 <= v <= v1 的一段（折线 v 单调递增），端点插值。"""
    out = []
    for (u0, a), (u1, b) in zip(pts[:-1], pts[1:]):
        for t in (v0, v1):
            if (a - t) * (b - t) < 0:
                k = (t - a) / (b - a)
                out.append((u0 + (u1 - u0) * k, t))
        if v0 <= b <= v1:
            out.append((u1, b))
    if pts[0][1] >= v0:
        out.insert(0, pts[0])
    return sorted(out, key=lambda p: p[1])


def u_at(pts, v):
    """折线在给定 v 处的 u（线性插值）。"""
    for (u0, a), (u1, b) in zip(pts[:-1], pts[1:]):
        if a <= v <= b:
            return u0 + (u1 - u0) * (v - a) / (b - a)
    raise ValueError(v)


def walk(pts, step):
    """沿折线按弧长等距取点，返回 [(点, 单位切向)]。"""
    seg = [math.dist(a, b) for a, b in zip(pts[:-1], pts[1:])]
    total, out, s, i, acc = sum(seg), [], 0.0, 0, 0.0
    while s <= total:
        while acc + seg[i] < s:
            acc += seg[i]
            i += 1
        k = (s - acc) / seg[i]
        (u0, v0), (u1, v1) = pts[i], pts[i + 1]
        out.append(((u0 + (u1 - u0) * k, v0 + (v1 - v0) * k),
                    ((u1 - u0) / seg[i], (v1 - v0) / seg[i])))
        s += step
    return out


def rect(u0, u1, v0, v1):
    return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]


ROAD_C = chaikin(ROAD_PTS)
ROAD_L = offset(ROAD_C, -ROAD_W / 2)  # 西侧路沿
ROAD_R = offset(ROAD_C, ROAD_W / 2)  # 东侧路沿
ROAD_POLY = ROAD_L + ROAD_R[::-1]
ROAD_EXT_C = chaikin(ROAD_EXT)
ROAD_EXT_POLY = offset(ROAD_EXT_C, -ROAD_W / 2) + offset(ROAD_EXT_C, ROAD_W / 2)[::-1]

V_NW = 122.0  # 园区路西沿与红线北界的交点高度


def west_u(v):
    return u_at(RED_WEST[::-1] + [RED_NORTH[-1]], v)


def inside(poly, p):
    """点是否在多边形内（射线法）。"""
    x, y = p
    hit = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            hit = not hit
    return hit


def poly_cross(a, b):
    """两条折线的第一个交点，返回 (交点, a 中所在线段序号, b 中所在线段序号)。"""
    for i, (p, p2) in enumerate(zip(a[:-1], a[1:])):
        for j, (q, q2) in enumerate(zip(b[:-1], b[1:])):
            rx, ry = p2[0] - p[0], p2[1] - p[1]
            sx, sy = q2[0] - q[0], q2[1] - q[1]
            den = rx * sy - ry * sx
            if abs(den) < 1e-9:
                continue
            t = ((q[0] - p[0]) * sy - (q[1] - p[1]) * sx) / den
            s = ((q[0] - p[0]) * ry - (q[1] - p[1]) * rx) / den
            if 0 <= t <= 1 and 0 <= s <= 1:
                return (p[0] + rx * t, p[1] + ry * t), i, j
    raise ValueError("折线不相交")


def road_south_v():
    """园区路东沿与东环路边线（RED_SOUTH 末点 → PARK_EDGE 首点）的交点 v，停车场从这里往北排。"""
    (ax, ay), (bx, by) = RED_SOUTH[-1], PARK_EDGE[0]

    def side(p):
        return (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax)

    for p, q in zip(ROAD_R[:-1], ROAD_R[1:]):
        if side(p) <= 0 < side(q):
            return p[1] + (q[1] - p[1]) * (-side(p)) / (side(q) - side(p))
    return ROAD_R[0][1]


def car_layout(lot):
    """园区路东侧乘用车停车场排布：沿园区路每 2.5 m 一站，每站按场地宽度决定放哪几排。

    按 CAR_ROWS / CAR_AISLES 自动排几组“车位 | 通道 | 车位”，四角都落在 lot 内的车位才排；
    第一条通道在 CAR_CONNECT 处接园区路（接口上不排车位），外侧通道两端各一条横向联络道接回第一条通道。
    返回 (车位 [(四边形, 车尾一侧)], 通道铺装 [四边形])；车尾一侧 0 = 靠园区路的边（d0），1 = 远离的边（d1）。
    """
    pts = walk(clip_v(ROAD_C, *CAR_RANGE), CAR_W)
    st = [(p, p2, (t[1], -t[0])) for (p, t), (p2, _) in zip(pts[:-1], pts[1:])]  # (起点, 终点, 东侧法向)

    def quad(j, d0, d1):
        p, p2, n = st[j]
        return [(p[0] + n[0] * d0, p[1] + n[1] * d0), (p[0] + n[0] * d1, p[1] + n[1] * d1),
                (p2[0] + n[0] * d1, p2[1] + n[1] * d1), (p2[0] + n[0] * d0, p2[1] + n[1] * d0)]

    def fits(q):
        return all(inside(lot, c) for c in q)

    def in_range(j, rng):
        return rng[0] <= st[j][0][1] and st[j][1][1] <= rng[1]

    conn = [j for j in range(len(st)) if any(in_range(j, r) for r in CAR_CONNECT)]
    wide = [j for j in range(len(st)) if j not in conn]
    rows = {j: {i for i, r in enumerate(CAR_ROWS) if fits(quad(j, *r))} for j in wide}
    # 通道 k 在某站存在：通道本身落在场地内，且两侧（第 2k、2k+1 排）至少一排放得下；
    # 第 i 排只在它面对的通道 i // 2 存在时才排
    has = {j: {k for k, a in enumerate(CAR_AISLES)
               if fits(quad(j, *a)) and rows[j] & {2 * k, 2 * k + 1}} for j in wide}

    def aisle_js(k):
        return [j for j in wide if k in has[j]]

    # 外侧通道太短（放不下两端联络道再加同样长的一段车位）就整组不排，避免联络道连成大片铺装
    for k in range(1, len(CAR_AISLES)):
        if len(aisle_js(k)) < 4 * CROSS_N:
            for j in wide:
                has[j].discard(k)
    for j in wide:
        rows[j] = {i for i in rows[j] if i // 2 in has[j]}
    paving, cut = [], set()
    for k, a in enumerate(CAR_AISLES):
        paving += [quad(j, *a) for j in aisle_js(k)]
    # 外侧各通道共用南、北两条横向联络道：取有外侧通道的最南、最北各 CROSS_N 站，
    # 每站从第一条通道铺到当站最外侧的通道，联络道穿过的车位不排
    outer = sorted({j for k in range(1, len(CAR_AISLES)) for j in aisle_js(k)})
    for j in outer[:CROSS_N] + outer[-CROSS_N:]:
        k = max(k for k in range(len(CAR_AISLES)) if j in aisle_js(k))
        paving.append(quad(j, CAR_AISLES[0][0], CAR_AISLES[k][1]))
        cut.update((j, i) for i in range(1, 2 * k + 1))
    paving += [quad(j, ROAD_W / 2 - 0.5, CAR_AISLES[0][1]) for j in conn]
    # 每排按连续车位分段，不足 3 个的零星车位不排
    stalls = []
    for i, r in enumerate(CAR_ROWS):
        run = []
        for j in wide + [None]:
            if j is not None and i in rows[j] and (j, i) not in cut:
                run.append(j)
                continue
            if len(run) >= 3:
                stalls += [(quad(jj, *r), i % 2) for jj in run]
            run = []
    return stalls, paving


# 规划红线：东环路 → 停车带东边线 → 厂房西北角之后沿园区路东沿向北，到北界跨过园区路
RED = RED_SOUTH + PARK_EDGE + clip_v(ROAD_R, 2, V_RED_ROAD) + RED_NORTH + RED_WEST
# 进口东侧树林：停车带东边线与树林外边线之间（两线在厂房西侧交叉，交点以北只剩停车带）
_x, _ia, _ib = poly_cross(PARK_EDGE, TREES_LINE)
TREES_SE = PARK_EDGE[:_ia + 1] + [_x] + TREES_LINE[_ib::-1]

# 分区多边形
LOWER = ([(west_u(-SLOPE), -SLOPE)] + clip_v(ROAD_L, GROVE_N, -SLOPE)[::-1]
         + [(west_u(GROVE_N), GROVE_N), (-10.9, -13.9)])
UPPER = ([(west_u(SLOPE), SLOPE)] + clip_v(ROAD_L, SLOPE, V_NW) + RED_NORTH + [(0.5, 56.4)])
SLOPE_BAND = ([(west_u(-SLOPE), -SLOPE)] + clip_v(ROAD_L, -SLOPE, SLOPE)
              + [(west_u(SLOPE), SLOPE)])
GROVE = ([(-23.1, -98), (west_u(GROVE_N), GROVE_N)] + clip_v(ROAD_L, -146, GROVE_N)[::-1]
         + [(-23, -106)])
EAST = clip_v(ROAD_R, road_south_v(), CAR_RANGE[1]) + PARK_EDGE[::-1]  # 园区路东侧停车带
CAR_STALLS, CAR_PAVING = car_layout(EAST)
# 乘用车流线：进门沿右侧车道，马上右转进停车场南接口，沿第一条通道向北
FLOW_CAR = (clip_v(offset(ROAD_C, 2.5), -152, -143)
            + offset(clip_v(ROAD_C, -139, -90), sum(CAR_AISLES[0]) / 2))

# ---------------------------------------------------------------- 绘图

K = 2.2  # 主图放大倍数
CROP = (565, 575, 1235, 1478)  # 主图取底图范围（像素）
PANEL_W = 860


def font(size, title=False):
    return ImageFont.truetype(FONT_TITLE if title else FONT_BODY, int(size))


class Canvas:
    """一张输出图：底图裁剪放大 + 局部坐标 → 输出像素的换算。"""

    def __init__(self, crop, k, dx=0, dy=0):
        self.crop, self.k, self.dx, self.dy = crop, k, dx, dy

    def bp(self, x, y):
        """底图像素 → 输出像素。"""
        return ((x - self.crop[0]) * self.k + self.dx, (y - self.crop[1]) * self.k + self.dy)

    def p(self, u, v):
        return self.bp(*base(u, v))

    def ps(self, pts):
        return [self.p(u, v) for u, v in pts]

    def bps(self, pts):
        return [self.bp(x, y) for x, y in pts]


def layer(img):
    return Image.new("RGBA", img.size, (0, 0, 0, 0))


def fill(img, poly, rgba, outline=None, width=1):
    """半透明多边形（单独图层再叠加，避免与已有内容互相覆盖）。"""
    lay = layer(img)
    d = ImageDraw.Draw(lay)
    d.polygon(poly, fill=rgba)
    if outline:
        d.line(poly + [poly[0]], fill=outline, width=width, joint="curve")
    img.alpha_composite(lay)


def mask_of(size, polys):
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    for p in polys:
        d.polygon(p, fill=255)
    return m


def hatch(img, mask, rgba, spacing=14, width=2, angle=45):
    """斜线填充（限制在 mask 内）。"""
    lay = layer(img)
    d = ImageDraw.Draw(lay)
    w, h = img.size
    a = math.radians(angle)
    ca, sa = math.cos(a), math.sin(a)
    r = int(math.hypot(w, h))
    for t in range(-r, r, spacing):
        cx, cy = w / 2 + t * sa, h / 2 - t * ca
        d.line([(cx - r * ca, cy - r * sa), (cx + r * ca, cy + r * sa)], fill=rgba, width=width)
    clear = layer(img)
    img.alpha_composite(Image.composite(lay, clear, mask))


def dashed(d, pts, fill, width, dash=16, gap=10):
    """折线虚线：按累计弧长取 [k·周期, k·周期 + dash] 区间画实线段，跨折点的虚线段连续。"""
    pts = [p for i, p in enumerate(pts) if i == 0 or p != pts[i - 1]]
    cum = [0.0]
    for a, b in zip(pts[:-1], pts[1:]):
        cum.append(cum[-1] + math.dist(a, b))

    def at(s):
        i = max(0, min(np.searchsorted(cum, s, side="right") - 1, len(pts) - 2))
        k = (s - cum[i]) / (cum[i + 1] - cum[i])
        (x1, y1), (x2, y2) = pts[i], pts[i + 1]
        return (x1 + (x2 - x1) * k, y1 + (y2 - y1) * k), i

    s = 0.0
    while s < cum[-1]:
        s2 = min(s + dash, cum[-1])
        (p0, i0), (p1, i1) = at(s), at(s2)
        d.line([p0] + pts[i0 + 1:i1 + 1] + [p1], fill=fill, width=width)
        s += dash + gap


def arrow(img, pts, color, width=6, head=22, dash=False):
    """流线箭头。"""
    lay = layer(img)
    d = ImageDraw.Draw(lay)
    if dash:
        dashed(d, pts, color, width, 18, 12)
    else:
        d.line(pts, fill=color, width=width, joint="curve")
    (x1, y1), (x2, y2) = pts[-2], pts[-1]
    a = math.atan2(y2 - y1, x2 - x1)
    tip = (x2 + math.cos(a) * head * 0.4, y2 + math.sin(a) * head * 0.4)
    left = (x2 - math.cos(a - 0.45) * head, y2 - math.sin(a - 0.45) * head)
    right = (x2 - math.cos(a + 0.45) * head, y2 - math.sin(a + 0.45) * head)
    d.polygon([tip, left, right], fill=color)
    img.alpha_composite(lay)


def text(d, xy, s, size, color=(255, 255, 255), anchor="mm", title=False, stroke=4,
         stroke_fill=(8, 14, 30), spacing=6):
    d.multiline_text(xy, s, font=font(size, title), fill=color, anchor=anchor, align="center",
                     stroke_width=stroke, stroke_fill=stroke_fill, spacing=spacing)


def centroid(poly):
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def pv_rect(img, cv, r, border, alpha=235, lines=True):
    """光伏车棚：深蓝底 + 组件分格线，彩色描边表示所属功能。"""
    u0, u1, v0, v1 = r
    poly = cv.ps(rect(u0, u1, v0, v1))
    fill(img, poly, COL["pv"] + (alpha,))
    if lines:
        lay = layer(img)
        d = ImageDraw.Draw(lay)
        u = u0 + 1.7
        while u < u1:
            d.line([cv.p(u, v0), cv.p(u, v1)], fill=(120, 160, 230, 150), width=1)
            u += 1.7
        v = v0 + 4.0
        while v < v1:
            d.line([cv.p(u0, v), cv.p(u1, v)], fill=(150, 185, 245, 170), width=1)
            v += 4.0
        img.alpha_composite(lay)
    fill(img, poly, (0, 0, 0, 0), outline=border + (255,), width=3)


def draw_plan():
    sat = Image.open(SAT).convert("RGB")
    cv = Canvas(CROP, K)
    mw, mh = int((CROP[2] - CROP[0]) * K), int((CROP[3] - CROP[1]) * K)
    m = sat.crop(CROP).resize((mw, mh), Image.LANCZOS)
    m = ImageEnhance.Color(m).enhance(0.55)
    m = ImageEnhance.Brightness(m).enhance(0.62).convert("RGBA")
    d = ImageDraw.Draw(m)

    # 后方预留用地：甲方 240 亩红线内、规划红线和进口东侧树林以外，灰色斜线
    red_poly = cv.ps(RED)
    back = Image.composite(mask_of(m.size, [cv.bps(p) for p in PARCELS]),
                           Image.new("L", m.size, 0),
                           Image.eval(mask_of(m.size, [red_poly, cv.ps(TREES_SE)]),
                                      lambda x: 255 - x))
    hatch(m, back, COL["back"] + (70,), spacing=18, width=2, angle=-45)
    for p in PARCELS:
        lay = layer(m)
        dashed(ImageDraw.Draw(lay), cv.bps(p + [p[0]]), (255, 214, 102, 200), 2, 10, 8)
        m.alpha_composite(lay)

    # 分区底色（徐氏祠林木、进口东侧树林同一种绿色斜线：保留原样）
    for poly_ in (GROVE, TREES_SE):
        fill(m, cv.ps(poly_), COL["grove"] + (110,))
        hatch(m, mask_of(m.size, [cv.ps(poly_)]), (120, 220, 140, 90), spacing=12, width=2,
              angle=60)
    fill(m, cv.ps(LOWER), COL["truck"] + (58,))
    fill(m, cv.ps(UPPER), COL["h2"] + (40,))
    fill(m, cv.ps(EAST), COL["car"] + (52,))
    fill(m, cv.ps(SLOPE_BAND), COL["slope"] + (120,))
    hatch(m, mask_of(m.size, [cv.ps(SLOPE_BAND)]), (240, 200, 150, 170), spacing=8, width=2,
          angle=-30)

    # 场内道路（沥青）
    road = COL["road"] + (245,)
    for r in [TRUCK_AISLE, SERVICE_LANE] + UP_ROADS:
        fill(m, cv.ps(rect(*r)), road)
    # 东侧停车场通道、横向联络道、接园区路的接口（同一图层，避免接缝处半透明叠色）
    lay = layer(m)
    dl = ImageDraw.Draw(lay)
    for q in CAR_PAVING:
        dl.polygon(cv.ps(q), fill=road)
    m.alpha_composite(lay)
    fill(m, cv.ps(ROAD_EXT_POLY), COL["road"] + (150,))
    lay = layer(m)
    dl = ImageDraw.Draw(lay)
    for side in (offset(ROAD_EXT_C, -ROAD_W / 2), offset(ROAD_EXT_C, ROAD_W / 2)):
        dashed(dl, cv.ps(side), (235, 238, 245, 230), 3, 14, 10)
    m.alpha_composite(lay)
    fill(m, cv.ps(ROAD_POLY), road)
    lay = layer(m)
    dl = ImageDraw.Draw(lay)
    for side in (ROAD_L, ROAD_R):
        dl.line(cv.ps(side), fill=(225, 230, 240, 255), width=3)
    dashed(dl, cv.ps(ROAD_C), (255, 230, 120, 220), 2, 14, 12)
    m.alpha_composite(lay)

    # 下台阶：重卡车位 + 光伏车棚
    for u0, u1, v0, v1 in TRUCK_ROWS:
        pv_rect(m, cv, (u0, u1, v0, v1), COL["truck"], alpha=215, lines=False)
        lay = layer(m)
        dl = ImageDraw.Draw(lay)
        n = int((u1 - u0) / TRUCK_BAY_W)
        front = -25 if v1 == -5 else -43  # 车位前沿 = 靠中间通道一侧（车头朝通道）
        for i in range(n + 1):
            u = u0 + i * TRUCK_BAY_W
            dl.line([cv.p(u, v0), cv.p(u, v1)], fill=(160, 200, 255, 230), width=2)
        for i in range(n):  # 充电终端：车位前沿（靠通道）
            u = u0 + i * TRUCK_BAY_W + 0.6
            sgn = 1 if front == -43 else -1
            dl.polygon(cv.ps(rect(u, u + 1.2, front + sgn * 0.6, front + sgn * 1.8)),
                       fill=(255, 255, 255, 255))
        m.alpha_composite(lay)
    for r in BOX_TRANS:
        fill(m, cv.ps(rect(*r)), COL["box"] + (255,), outline=(255, 220, 225, 255), width=2)
    for r in ESS:
        fill(m, cv.ps(rect(*r)), COL["ess"] + (255,), outline=(120, 80, 0, 255), width=1)

    # 上台阶：加氢 / 换电 / 综合楼
    pv_rect(m, cv, H2_CANOPY, COL["h2"])
    for r in H2_DISP:
        fill(m, cv.ps(rect(*r)), (230, 252, 255, 255))
    fill(m, cv.ps(rect(*H2_TRAILER)), COL["road"] + (245,), outline=COL["h2"] + (255,), width=2)
    lay = layer(m)
    dl = ImageDraw.Draw(lay)
    for u in np.arange(H2_TRAILER[0], H2_TRAILER[1] + 0.1, 14):
        dl.line([cv.p(u, H2_TRAILER[2]), cv.p(u, H2_TRAILER[3])], fill=(200, 240, 250, 220), width=2)
    m.alpha_composite(lay)
    store = cv.ps(rect(*H2_STORE))
    fill(m, store, (8, 70, 90, 235))
    hatch(m, mask_of(m.size, [store]), COL["h2"] + (150,), spacing=10, width=2, angle=45)
    for i in range(4):  # 储氢瓶组示意
        u = H2_STORE[0] + 5 + i * 9.5
        fill(m, cv.ps(rect(u, u + 6, 86, 98)), (220, 248, 255, 255))
    lay = layer(m)
    dashed(ImageDraw.Draw(lay), store + [store[0]], (255, 255, 255, 255), 3, 10, 7)
    m.alpha_composite(lay)
    for r in SWAP_CANOPY:
        pv_rect(m, cv, r, COL["swap"])
    for r in SWAP_HALLS:
        fill(m, cv.ps(rect(*r)), COL["swap"] + (255,), outline=(235, 225, 255, 255), width=3)
    pv_rect(m, cv, OFFICE_PARK, COL["office"])
    fill(m, cv.ps(rect(*OFFICE)), COL["office"] + (255,), outline=(255, 235, 210, 255), width=3)

    # 园区路东侧：乘用车充电车位 + 光伏车棚（每个车位一块，绿色描边）；
    # 一桩两车：每两个车位在车尾分界处立一台充电桩（白点）
    stalls = CAR_STALLS
    lay = layer(m)
    dl = ImageDraw.Draw(lay)
    for i, (q, back) in enumerate(stalls):
        dl.polygon(cv.ps(q), fill=COL["pv"] + (235,), outline=(190, 235, 120, 255))
        if i % 2 == 0:
            # 车尾边与下一个车位的交点，向车位内收 0.6 m
            a, b = (q[3], q[2]) if back == 0 else (q[2], q[3])
            t = 0.6 / math.dist(a, b)
            c = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            x, y = cv.p(*c)
            dl.rectangle([x - 2.5, y - 2.5, x + 2.5, y + 2.5], fill=(255, 255, 255, 255))
    m.alpha_composite(lay)

    # 现状台地边线（下台阶内两级合并）
    lay = layer(m)
    dl = ImageDraw.Draw(lay)
    dashed(dl, cv.ps(L2), (255, 225, 170, 230), 3, 8, 8)
    m.alpha_composite(lay)

    # 规划红线
    lay = layer(m)
    dl = ImageDraw.Draw(lay)
    dashed(dl, red_poly + [red_poly[0]], COL["red"] + (255,), 5, 22, 10)
    m.alpha_composite(lay)

    # 流线
    arrow(m, cv.ps(chaikin(FLOW_TRUCK, 2)), (255, 172, 40, 240), 6)
    arrow(m, cv.ps(chaikin(FLOW_UPPER, 2)), (240, 110, 255, 240), 6)
    arrow(m, cv.ps(chaikin(FLOW_CAR, 2)), (90, 200, 255, 240), 6)

    # 标注
    d = ImageDraw.Draw(m)
    text(d, cv.p(70, -15), "下台阶 · 重卡充电", 40, title=True)
    text(d, cv.p(70, -54), f"重卡充电位约 {sum(int((r[1] - r[0]) / TRUCK_BAY_W) for r in TRUCK_ROWS)} 个"
         "（光伏车棚）", 24)
    text(d, cv.p(12, -2.5 - 20.5), "箱变×2", 22)
    text(d, cv.p(11, -66), "储能", 26, color=COL["ess"])
    text(d, cv.p(72, -32), "原两级台地 平整合并", 20, color=(255, 225, 170))
    text(d, cv.p(82, 132), "上台阶 · 加氢站 / 换电站 / 综合楼", 36, title=True)
    text(d, cv.p(35, 23), "加氢站（光伏罩棚）", 24)
    text(d, cv.p(35, 65), "长管拖车卸气位", 20)
    text(d, cv.p(35, 101.5), "储氢 · 压缩区（围栏隔离）", 20)
    text(d, cv.p(94, 65), "换电站\n×2", 28)
    text(d, cv.p(94, 35), "待换电车位（光伏车棚）", 18)
    text(d, cv.p(145, 94), "综合楼", 30, color=(40, 20, 0), stroke=0)
    text(d, cv.p(145, 46), "访客停车\n（光伏车棚）", 20)
    text(d, cv.p(0, 1), "台地边坡 / 挡墙", 20, color=(255, 215, 170), anchor="lm")
    text(d, cv.p(170, -18), f"乘用车充电停车场\n约 {len(stalls)} 个车位（光伏车棚）", 24,
         anchor="lm")
    text(d, cv.p(*centroid(TREES_SE[:2] + TREES_SE[-3:])), "现状树林\n保留原样", 22,
         color=(205, 255, 210))
    text(d, cv.p(190, 50), "现状保留\n（不做停车）", 22, color=(225, 228, 236))
    gx, gy = cv.p(*XU_HALL)
    d.rectangle([gx - 13, gy - 10, gx + 13, gy + 10], fill=(150, 40, 30), outline=(255, 230, 200),
                width=3)
    text(d, (gx + 20, gy - 4), "徐氏祠（历史建筑）\n及林木 · 保留不动", 24, anchor="lm",
         color=(205, 255, 210))
    rx, ry = cv.p(167, 52)
    text(d, (rx, ry), "园\n区\n路", 26, title=True, stroke=5)
    ex, ey = cv.p(161, 205)
    text(d, (ex + 20, ey), "园区路延伸至后方\n（现状道路保留）", 22, anchor="lm")
    text(d, cv.p(70, 205), "后方预留用地 · 保持现状不动", 34, title=True, color=(235, 238, 245))
    gx, gy = cv.p(80, -145)
    d.ellipse([gx - 16, gy - 16, gx + 16, gy + 16], fill=(255, 64, 64), outline=(255, 255, 255),
              width=3)
    text(d, (gx - 26, gy + 6), "主出入口", 26, anchor="rm")
    text(d, cv.bp(760, 1440), "东 环 路（G209）", 30, title=True, color=(255, 240, 200))
    text(d, cv.bp(1165, 1250), "现状厂房\n十堰聚朋工贸\n（红线外）", 22, color=(220, 225, 235))
    text(d, cv.p(36, 162), "规划用地红线（约 70 亩）", 24, color=(255, 120, 120))

    # 指北针、比例尺
    nx, ny = mw - 70, 100
    d.polygon([(nx, ny - 40), (nx - 18, ny + 18), (nx, ny + 6), (nx + 18, ny + 18)],
              fill=(255, 255, 255))
    text(d, (nx, ny - 60), "N", 28, title=True)
    bar = 50 / S * K
    bx, by = mw - 60 - bar, mh - 60
    d.rectangle([bx - 24, by - 54, bx + bar + 24, by + 26], fill=(8, 14, 30, 220))
    d.line([(bx, by), (bx + bar, by)], fill=(255, 255, 255), width=4)
    for t in (0, 0.5, 1):
        d.line([(bx + bar * t, by - 10), (bx + bar * t, by)], fill=(255, 255, 255), width=3)
    text(d, (bx, by - 30), "0", 20, stroke=0)
    text(d, (bx + bar, by - 30), "50 m", 20, stroke=0)
    return m, cv


def zone_areas():
    """各分区面积（亩）。"""
    a = {
        "规划用地（红线）": area(RED),
        "上台阶：加氢 / 换电 / 综合楼": area(UPPER),
        "下台阶：重卡充电 / 箱变 / 储能": area(LOWER),
        "乘用车充电停车场": area(EAST),
        "园区路（红线内）": area(RED) - area(UPPER) - area(LOWER) - area(EAST) - area(GROVE)
        - area(SLOPE_BAND),
        "台地边坡": area(SLOPE_BAND),
        "徐氏祠及林木（保留）": area(GROVE),
        "进口东侧树林（保留原样，红线外）": area(TREES_SE),
    }
    # 后方预留 = 甲方 240 亩红线内、规划红线和进口东侧树林以外（栅格求差，2 倍超采样）
    k = 2
    size = (Image.open(SAT).width * k, Image.open(SAT).height * k)

    def raster(polys):
        return np.asarray(mask_of(size, [[(x * k, y * k) for x, y in p] for p in polys])) > 0

    keep = raster([[base(*q) for q in RED], [base(*q) for q in TREES_SE]])
    a["后方预留"] = (raster(PARCELS) & ~keep).sum() * (S / k) ** 2
    return {k: v / MU for k, v in a.items()}


def draw_panel(h, areas, inset):
    p = Image.new("RGBA", (PANEL_W, h), (10, 17, 34, 255))
    d = ImageDraw.Draw(p)
    x = 48
    text(d, (x, 60), "十堰 · 东环路综合能源站", 46, anchor="lm", title=True, stroke=0)
    text(d, (x, 118), "规划示意 v1（按甲方草图 + 语音说明）", 30, anchor="lm", stroke=0,
         color=(160, 200, 255))
    text(d, (x, 162), f"湖北省十堰市茅箭区东环路 183 号 · 底图约 {S:.2f} m/像素", 21,
         anchor="lm", stroke=0, color=(170, 180, 200))
    text(d, (x, 192), "比例由甲方 130 亩 + 110 亩 用地红线面积反算", 21, anchor="lm", stroke=0,
         color=(170, 180, 200))
    y = 250
    rows = [
        (COL["red"], "line", f"规划用地红线 ≈ {areas['规划用地（红线）']:.0f} 亩",
         "甲方：200 多亩地只用 70 亩"),
        (COL["h2"], "fill", f"上台阶 ≈ {areas['上台阶：加氢 / 换电 / 综合楼']:.0f} 亩",
         "加氢站（西）· 换电站（中）· 综合楼（东，靠园区路），光伏车棚"),
        (COL["truck"], "fill", f"下台阶 ≈ {areas['下台阶：重卡充电 / 箱变 / 储能']:.0f} 亩",
         "重卡充电（光伏车棚）· 箱变 · 储能；原两级台地合并为一级"),
        (COL["car"], "fill", f"乘用车充电停车场 ≈ {areas['乘用车充电停车场']:.0f} 亩",
         "园区路东侧，进口至厂房西北角一条带，停车 + 充电 + 光伏车棚"),
        (COL["road"], "road", "园区路（现状道路保留）",
         "东环路进口一直往上走，贯通到最里面的预留地"),
        (COL["grove"], "fill",
         f"保留林木 ≈ {areas['徐氏祠及林木（保留）'] + areas['进口东侧树林（保留原样，红线外）']:.0f} 亩",
         "徐氏祠（历史建筑）及林木、进口东侧树林，保持原样，效果图要表现"),
        (COL["slope"], "fill", "台地边坡 / 挡墙", "上下两个台阶之间的高差，待测"),
        (COL["back"], "hatch", f"后方预留用地 ≈ {areas['后方预留']:.0f} 亩",
         "保持现状不动（含厂房以北路东一条），效果图里要表现；黄虚线为甲方 240 亩红线"),
    ]
    for col, kind, title, sub in rows:
        if kind == "line":
            dashed(d, [(x, y + 2), (x + 44, y + 2)], col, 5, 12, 6)
        elif kind == "road":
            d.rectangle([x, y - 12, x + 44, y + 16], fill=col, outline=(225, 230, 240), width=2)
        elif kind == "hatch":
            d.rectangle([x, y - 12, x + 44, y + 16], outline=col, width=2)
            for t in range(-30, 50, 9):
                d.line([(x + max(t, 0), y - 12 + max(-t, 0)),
                        (x + min(t + 28, 44), y + 16 - max(t + 28 - 44, 0))], fill=col, width=1)
        else:
            d.rectangle([x, y - 12, x + 44, y + 16], fill=col)
        text(d, (x + 64, y + 1), title, 27, anchor="lm", stroke=0)
        text(d, (x + 64, y + 35), sub, 19, anchor="lm", stroke=0, color=(170, 180, 200))
        y += 78
    d.rectangle([x, y - 12, x + 44, y + 16], fill=COL["pv"], outline=(150, 185, 245), width=2)
    text(d, (x + 64, y + 1), "光伏车棚（彩色描边 = 所属功能）", 27, anchor="lm", stroke=0)
    y += 56
    for col, s in (((255, 172, 40), "重卡流线：进口 → 下台阶通道，倒车入位"),
                   ((240, 110, 255), "加氢 / 换电车辆：沿园区路上到上台阶"),
                   ((90, 200, 255), "乘用车：进门即右转进东侧停车场")):
        d.line([(x, y), (x + 44, y)], fill=col, width=6)
        d.polygon([(x + 50, y), (x + 38, y - 8), (x + 38, y + 8)], fill=col)
        text(d, (x + 64, y), s, 22, anchor="lm", stroke=0)
        y += 40
    y += 16
    text(d, (x, y), "待甲方确认", 28, anchor="lm", title=True, stroke=0, color=(255, 200, 90))
    y += 40
    notes = [
        "1. 上台阶北界：手机截图红框只画到进深约 90 m，按“共 70 亩”",
        "    （粉色手绘圈约 66 亩）反推到约 145 m，以哪个为准？",
        "2. 上下台阶标高、园区路纵坡 —— 决定两个台阶从园区路进出的位置",
        "3. 加氢站等级 / 储氢量 —— 决定与综合楼、徐氏祠、东环路的",
        "    安全间距（GB 50516、GB 50156），本图未复核",
        "4. 换电站服务车型（重卡 / 乘用车）与数量；重卡充电位数量",
        "5. 乘用车停车带按标注离路沿约 12~18 m，实地宽度待核实",
        "6. 东环路门口能否左转进出（G209 有无中央隔离）",
    ]
    for s in notes:
        text(d, (x, y), s, 20, anchor="lm", stroke=0, color=(215, 220, 232))
        y += 31
    # 位置示意小图
    y += 20
    iw = PANEL_W - 2 * x
    ih = int(inset.height * iw / inset.width)
    if y + ih + 40 > h:
        ih = h - y - 40
        iw = int(inset.width * ih / inset.height)
    text(d, (x, y), "全貌：甲方 240 亩用地与本次 70 亩", 22, anchor="lm", stroke=0,
         color=(170, 180, 200))
    p.paste(inset.resize((iw, ih), Image.LANCZOS), (x, y + 22))
    return p


def draw_inset():
    """位置示意小图：240 亩红线 + 70 亩规划范围。"""
    crop = (360, 40, 1720, 1527)
    k = 0.5
    sat = Image.open(SAT).convert("RGB").crop(crop)
    im = sat.resize((int(sat.width * k), int(sat.height * k)), Image.LANCZOS)
    im = ImageEnhance.Brightness(ImageEnhance.Color(im).enhance(0.55)).enhance(0.65).convert("RGBA")
    cv = Canvas(crop, k)
    for p in PARCELS:
        fill(im, cv.bps(p), COL["back"] + (40,), outline=(255, 214, 102, 230), width=2)
    fill(im, cv.ps(RED), COL["red"] + (90,), outline=COL["red"] + (255,), width=3)
    d = ImageDraw.Draw(im)
    text(d, cv.bp(760, 520), "130 亩", 22)
    text(d, cv.bp(1250, 700), "110 亩", 22)
    text(d, cv.p(85, 0), "70 亩", 22, title=True)
    text(d, cv.bp(1370, 330), "呼北高速", 18, color=(255, 230, 190))
    text(d, cv.bp(260, 900), "东环路", 18, color=(255, 230, 190))
    return im


def draw_analysis():
    """甲方资料对照：左为转正的草图（加注释），右为甲方各图标注配准到同一张卫星图上。"""
    sk = Image.open(SKETCH).convert("RGB")
    sk = sk.crop((180, 60, 1960, 1500))
    sk = ImageEnhance.Contrast(sk).enhance(1.25).convert("RGBA")
    ds = ImageDraw.Draw(sk)
    # 坐标为裁剪后草图像素（转正后的草图减去 (180, 60)）
    notes = [
        ((520, 140), "后方（画小了，实际很大，留着不动）", (150, 150, 150), "mm"),
        ((520, 455), "上台阶", COL["h2"], "mm"),
        ((640, 735), "下台阶（原两级合并）", COL["truck"], "mm"),
        ((560, 975), "保留不动", (40, 150, 80), "mm"),
        ((985, 330), "园区路", (90, 90, 90), "mm"),
        ((1255, 640), "狭长带", COL["car"], "lm"),
        ((1050, 1090), "东环路进口", COL["red"], "lm"),
    ]
    for xy, s, col, anchor in notes:
        text(ds, xy, s, 40, color=col, title=True, stroke=6, stroke_fill=(255, 255, 255),
             anchor=anchor)
    sat = Image.open(SAT).convert("RGB")
    crop = (520, 560, 1420, 1480)
    k = sk.height / (crop[3] - crop[1])
    im = sat.crop(crop).resize((int((crop[2] - crop[0]) * k), sk.height), Image.LANCZOS)
    im = ImageEnhance.Brightness(ImageEnhance.Color(im).enhance(0.6)).enhance(0.7).convert("RGBA")
    cv = Canvas(crop, k)
    for p in PARCELS:
        fill(im, cv.bps(p), (0, 0, 0, 0), outline=(255, 214, 102, 255), width=3)
    pink = cv.bps(tf(A_PARCELS, PINK_70))
    fill(im, pink, (255, 120, 120, 70), outline=(255, 140, 140, 255), width=8)
    for poly_, col in ((MARK_LOWER, COL["truck"]), (MARK_UPPER, COL["h2"])):
        fill(im, cv.bps(tf(A_MARKED, poly_)), col + (60,), outline=col + (255,), width=4)
    lay = layer(im)
    dashed(ImageDraw.Draw(lay), cv.ps(ROAD_C), (255, 255, 255, 255), 5, 16, 10)
    im.alpha_composite(lay)
    d = ImageDraw.Draw(im)
    bx, by = cv.bp(*tf(A_MARKED, [MARK_SELF])[0])
    d.ellipse([bx - 12, by - 12, bx + 12, by + 12], fill=(40, 120, 255), outline=(255, 255, 255),
              width=3)
    a_l = area(tf(A_MARKED, MARK_LOWER)) * S * S / MU
    a_u = area(tf(A_MARKED, MARK_UPPER)) * S * S / MU
    a_p = area(tf(A_PARCELS, PINK_70)) * S * S / MU
    text(d, cv.bp(*tf(A_MARKED, [(170, 330)])[0]), f"手机图下框\n≈{a_l:.0f} 亩", 30)
    text(d, cv.bp(*tf(A_MARKED, [(170, 205)])[0]), f"手机图上框\n≈{a_u:.0f} 亩", 30)
    text(d, cv.bp(760, 700), f"粉色手绘圈 ≈ {a_p:.0f} 亩", 30, color=(255, 170, 170))
    text(d, cv.bp(1250, 800), "110 亩红线", 28, color=(255, 214, 102))
    text(d, cv.bp(600, 640), "130 亩红线", 28, color=(255, 214, 102))
    text(d, (bx + 20, by + 26), "甲方所在位置", 24, anchor="lm")
    gx, gy = cv.p(*XU_HALL)
    text(d, (gx, gy + 10), "徐氏祠", 30, color=(150, 255, 170))
    text(d, cv.bp(1050, 1460), "白虚线 = 园区路（现状土路 / 新修混凝土路）", 26)
    W = sk.width + im.width + 60
    H = sk.height + 150
    out = Image.new("RGBA", (W, H), (10, 17, 34, 255))
    od = ImageDraw.Draw(out)
    text(od, (40, 60), "甲方资料对照：草图（已转正）与卫星图上的各次标注", 44, anchor="lm",
         title=True, stroke=0)
    text(od, (40, 112), "草图东环路在下、进口朝北；园区路东侧为狭长带，西侧自南向北：徐氏祠 → 下台阶 → 上台阶 → 后方",
         24, anchor="lm", stroke=0, color=(170, 180, 200))
    out.paste(sk, (20, 140))
    out.paste(im, (sk.width + 40, 140))
    return out.convert("RGB")


# 场地周边现状（底图像素，人工描出，只用于三维效果图的环境，精度到十来米）
CTX_HUANLU = [(30, 50), (80, 300), (150, 600), (230, 850), (330, 1050), (450, 1250), (600, 1380),
              (800, 1420), (1100, 1435), (1500, 1445), (1950, 1450)]  # 东环路（G209）中线，宽约 21 m
CTX_HIGHWAY = [(790, 0), (1100, 150), (1500, 370), (1950, 640)]  # 呼北高速（高架）中线，宽约 28 m
CTX_RIVER = [(1640, 0), (1760, 0), (1800, 250), (1700, 480), (1600, 700), (1560, 1000),
             (1560, 1250), (1640, 1420), (1700, 1527), (1500, 1527), (1400, 1440), (1440, 1250),
             (1460, 1000), (1500, 700), (1600, 450), (1660, 250)]  # 东侧河道


def export_site():
    """把规划数据（局部米坐标）写成 scripts/blender/shiyan_energy/site.json，供 Blender 建三维效果图。"""
    import json

    def r(pts):
        return [[round(float(u), 2), round(float(v), 2)] for u, v in pts]

    def loc_px(pts):
        return r([local(x, y) for x, y in pts])

    data = {
        "_note": "由 scripts/shiyan-energy/draw_plan.py 生成，勿手改；坐标为局部米坐标 (u 沿台地边线向东偏北, v 向北)",
        "scale_m_per_px": round(S, 5),
        "north_deg": round(math.degrees(math.atan2(-V[0], -V[1])), 3),  # 局部 v 轴相对正北的偏角
        "red": r(RED),
        "parcels": [loc_px(p) for p in PARCELS],
        "upper": r(UPPER),
        "lower": r(LOWER),
        "slope": r(SLOPE_BAND),
        "slope_half": SLOPE,
        "grove": r(GROVE),
        "trees_se": r(TREES_SE),
        "east": r(EAST),
        "road": {"center": r(ROAD_C), "ext": r(ROAD_EXT_C), "width": ROAD_W},
        "truck_rows": TRUCK_ROWS,
        "truck_bay_w": TRUCK_BAY_W,
        "truck_aisle": TRUCK_AISLE,
        "service_lane": SERVICE_LANE,
        "box_trans": BOX_TRANS,
        "ess": ESS,
        "up_roads": UP_ROADS,
        "h2_canopy": H2_CANOPY,
        "h2_disp": H2_DISP,
        "h2_trailer": H2_TRAILER,
        "h2_store": H2_STORE,
        "swap_halls": SWAP_HALLS,
        "swap_canopy": SWAP_CANOPY,
        "office": OFFICE,
        "office_park": OFFICE_PARK,
        "car_stalls": [[r(q), back] for q, back in CAR_STALLS],
        "car_paving": [r(q) for q in CAR_PAVING],
        "xu_hall": XU_HALL,
        "l2": L2,
        "ctx": {"huanlu": loc_px(CTX_HUANLU), "highway": loc_px(CTX_HIGHWAY),
                "river": loc_px(CTX_RIVER)},
    }
    path = os.path.join(ROOT, "scripts/blender/shiyan_energy/site.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    return path


def main():
    areas = zone_areas()
    print(f"比例尺 {S:.4f} m/px")
    for k, v in areas.items():
        print(f"  {k}: {v:.1f} 亩")
    m, _ = draw_plan()
    panel = draw_panel(m.height, areas, draw_inset())
    out = Image.new("RGBA", (panel.width + m.width, m.height))
    out.paste(panel, (0, 0))
    out.paste(m, (panel.width, 0))
    out.convert("RGB").save(OUT_PLAN, optimize=True)
    draw_analysis().save(OUT_ANALYSIS, optimize=True)
    print("写出", OUT_PLAN, OUT_ANALYSIS, export_site())


if __name__ == "__main__":
    main()

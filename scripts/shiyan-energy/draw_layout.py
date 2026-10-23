"""十堰 · 东环路综合能源站 总平面布局图（卫星实景俯瞰，v2）。

按用户定稿的三维设计稿（docs/design/shiyan-energy/design/final.webp）把各设施落到卫星图上，版式参照旧布局图
（client/old-layout.webp）：标题 + 卫星实景总平面（编号分区）+ 右侧分区图例 + 底部指标条 + 注释。
输出 docs/design/shiyan-energy/layout-v2.png，并打印各项面积 / 数量（图上的数字都由这里的布局数据算出）。

坐标沿用 draw_plan.py 的局部米坐标 (u 沿现状台地边线向东偏北, v 向北)，卫星底图配准、比例尺、规划红线、
园区路、乘用车车位都直接取 draw_plan.py 的数据；本脚本只定义设计稿里改动 / 新增的设施。
地图按局部坐标摆正（台地边线水平），指北针相应偏转约 13°。

用法：python scripts/shiyan-energy/draw_layout.py
"""

import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import draw_plan as P  # noqa: E402  （导入时只计算几何，不出图）

OUT = os.path.join(P.DOC, "layout-v2.png")
FONT = "C:/Windows/Fonts/msyh.ttc"
FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
if not os.path.exists(FONT):  # 非 Windows 环境退回仓库自带字体
    FONT = FONT_BOLD = P.FONT_BODY


def rect(u0, u1, v0, v1):
    return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]


# ---------------------------------------------------------------- 布局（局部米坐标）

# 上台阶：一整片大光伏棚（加氢站 + 两座换电站），东端综合楼（屋顶光伏）紧贴园区路；棚后是储氢罐区与长管拖车位
UP_APRON = rect(2, 122, 6, 26)  # 棚前回车场（挡墙顶到棚前沿）
UP_CANOPY = rect(6, 126, 26, 74)  # 大光伏棚 120 × 48 m，东端直接接综合楼（设计稿里两者连成一片）
H2_ISLANDS = [rect(u, u + 2.4, 38, 52) for u in (15, 27, 39)]  # 加氢岛 ×3（车辆南北向通过）
SWAP_HALLS = [rect(58, 72, 34, 64), rect(88, 102, 34, 64)]  # 换电站 ×2，14 × 30 m，南进北出
OFFICE = rect(126, 158, 30, 62)  # 综合楼 32 × 32 m
VISITOR = [rect(128 + 2.5 * i, 130.5 + 2.5 * i, 20, 25.5) for i in range(12)]  # 楼前访客车位 ×12
BACK_LANE = rect(2, 122, 74, 84)  # 棚后车道，东接园区路
H2_STORE = rect(6, 34, 88, 110)  # 储氢罐区（围栏）
H2_TANKS = [(10 + 6 * i, 94 + 9 * j) for i in range(4) for j in range(2)]  # 立式储氢罐 ×8（圆心）
TUBE_BAYS = [rect(40 + 8 * i, 44 + 8 * i, 88, 104) for i in range(3)]  # 长管拖车卸气位 ×3

# 下台阶：两排重卡车位合成一个大光伏棚；西侧储能 / 箱变光伏棚
BAY_W, BAY_N = 4.2, 18
TRUCK_U0 = 30
TRUCK_ROWS = [(-25, -5), (-63, -43)]  # 后排、前排（进深 20 m，车头朝中间通道倒车入位）
TRUCK_AISLE = rect(28, 132, -43, -25)  # 中间通道 18 m，东接园区路
TRUCK_CANOPY = rect(28, TRUCK_U0 + BAY_W * BAY_N + 2, -65, -3)  # 大棚，柱子 6 根（四角 + 两长边中点）
LOW_APRON = rect(-4, 112, -77, -65)  # 棚前（南侧）通道，接徐氏祠林地
ESS_CANOPY = rect(-6, 22, -62, -14)  # 储能 / 箱变光伏棚 28 × 48 m
ESS_UNITS = [rect(u, u + 2.5, v, v + 12.2) for v in (-58, -42) for u in (-2, 3.5, 9, 14.5)]  # 储能舱 ×8
BOX_TRANS = [rect(-2, 4, -26, -21), rect(8, 14, -26, -21)]  # 箱变 ×2

# 园区路东侧乘用车条带的北段改为土坡：轮廓按用户在 layout-v2 上的红圈描出（2026-10-20，北宽南尖，
# 贴着园区路东沿），不是标准子弹头；伸到路面上的点推回路沿外 0.3 m
MOUND_TRACE = [(158.6, -7.9), (153.6, -14.6), (149.3, -21.9), (144.9, -29.1), (140.0, -36.4), (135.3, -42.2),
               (130.4, -48.1), (125.4, -53.3), (121.3, -58.2), (119.3, -62.0), (120.7, -64.4), (126.0, -64.9),
               (131.8, -64.1), (135.3, -61.2), (138.2, -55.3), (141.4, -48.1), (144.0, -40.8), (146.4, -33.5),
               (148.7, -26.2), (151.6, -18.9), (155.1, -13.7)]
# 规划红线新东界（用户蓝圈的西边线，南 → 北）：从乘用车条带东界（PARK_EDGE）上 v≈-54 处起，
# 贴着土坡东侧往北，到 v≈-8 接园区路东沿；蓝圈内（土坡以东、厂房以北）不划入规划
EAST_CUT = [(146.9, -48.1), (146.9, -39.3), (148.7, -29.1), (151.6, -20.4)]
CUT_V = (-53.9, -8.0)  # 在 PARK_EDGE 上的起点 v、接园区路东沿的 v


def push_off_road(p, gap=0.3):
    """点若落在园区路路面上（离中线不到半幅 + gap），沿路面法向推到东沿外 gap 米"""
    best = None
    for a, b in zip(P.ROAD_C[:-1], P.ROAD_C[1:]):
        ex, ey = b[0] - a[0], b[1] - a[1]
        L2 = ex * ex + ey * ey
        t = max(0.0, min(1.0, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / L2))
        q = (a[0] + t * ex, a[1] + t * ey)
        dd = math.dist(p, q)
        if best is None or dd < best[0]:
            n = math.sqrt(L2)
            best = (dd, q, (ey / n, -ex / n))  # 前进方向右手侧（东）法向
    _, q, nrm = best
    lat = (p[0] - q[0]) * nrm[0] + (p[1] - q[1]) * nrm[1]
    need = P.ROAD_W / 2 + gap
    return p if lat >= need else (q[0] + nrm[0] * need, q[1] + nrm[1] * need)


MOUND = P.chaikin([push_off_road(p) for p in MOUND_TRACE] + [push_off_road(MOUND_TRACE[0])], 2)


def _park_edge_to(v):
    """PARK_EDGE 从南端截到 v 处（末点插值）"""
    out = []
    for a, b in zip(P.PARK_EDGE[:-1], P.PARK_EDGE[1:]):
        out.append(a)
        if a[1] <= v <= b[1]:
            k = (v - a[1]) / (b[1] - a[1])
            return out + [(a[0] + (b[0] - a[0]) * k, v)]
    return out


RED = (P.RED_SOUTH + _park_edge_to(CUT_V[0]) + EAST_CUT + P.clip_v(P.ROAD_R, CUT_V[1], P.V_RED_ROAD)
       + P.RED_NORTH + P.RED_WEST)


def _keep(q):
    """车位 / 通道铺装保留条件：四角都在新红线内，且与土坡不相交（四角、中心不在土坡内，土坡顶点也不在它内）"""
    pts = list(q) + [tuple(np.mean(q, axis=0))]
    if not all(P.inside(RED, c) for c in q):
        return False
    return not any(P.inside(MOUND, c) for c in pts) and not any(P.inside(list(q), c) for c in MOUND)


CAR_STALLS = [(q, b) for q, b in P.CAR_STALLS if _keep(q)]
CAR_PAVING = [q for q in P.CAR_PAVING if _keep(q)]

# 卫星底图上要抹掉的地图 App 标注：(卫星像素框 x0, y0, x1, y1), 取样偏移 (dx, dy)
SAT_PATCHES = [
    ((800, 918, 852, 950), (0, 36)),  # 地名“老庄”（上台阶北侧），取正下方的地面
    ((804, 1290, 866, 1366), (-64, 0)),  # 甲方的定位标“1”（徐氏祠，含下方尖角），取左侧林地
]

# 配色：分区底色（半透明）
COL = {
    "h2": (86, 178, 98),
    "swap": (96, 132, 168),
    "office": (226, 156, 64),
    "truck": (64, 120, 196),
    "car": (40, 160, 150),
    "ess": (214, 170, 48),
    "pv": (28, 52, 110),
    "red": (229, 57, 53),
    "road": (70, 74, 82),
    "apron": (205, 208, 212),
    "mound": (196, 160, 98),
    "grove": (60, 140, 70),
    "green": (31, 122, 77),  # 版式主色（标题、编号）
}


# ---------------------------------------------------------------- 统计（图上的数字都从这里来）


def stats():
    """面积（亩）、光伏装机（按棚顶面积 × 铺设率 0.9 × 组件 210 W/m² 估算）、车位数"""
    pv = {
        "上台阶大棚": P.area(UP_CANOPY),
        "综合楼屋顶（铺 70%）": P.area(OFFICE) * 0.7,
        "重卡大棚": P.area(TRUCK_CANOPY),
        "储能棚": P.area(ESS_CANOPY),
        "乘用车棚": sum(P.area(q) for q, _ in CAR_STALLS),
    }
    pv_m2 = sum(pv.values())
    return {
        "red_mu": P.area(RED) / P.MU,
        "pv": pv,
        "pv_mwp": pv_m2 * 0.9 * 0.21 / 1000,
        "truck_bays": BAY_N * len(TRUCK_ROWS),
        "car_bays": len(CAR_STALLS),
        "visitor": len(VISITOR),
        "mound_m2": P.area(MOUND),
    }


# ---------------------------------------------------------------- 地图（局部坐标摆正）

VIEW = (-60, 300, -162, 165)  # u0, u1, v0, v1（米）；左下角再往外就超出卫星图了
K = 3.2  # 像素 / 米
SS = 2  # 叠加层超采样，线条抗锯齿


def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT, int(size))


class Map:
    def __init__(self):
        u0, u1, v0, v1 = VIEW
        self.w, self.h = int((u1 - u0) * K), int((v1 - v0) * K)

    def p(self, u, v, ss=1):
        return ((u - VIEW[0]) * K * ss, (VIEW[3] - v) * K * ss)

    def ps(self, pts, ss=SS):
        return [self.p(u, v, ss) for u, v in pts]

    def satellite(self):
        """把卫星图按局部坐标重采样：输出像素 → (u, v) → 卫星像素（仿射）；先抹掉地图 App 的地名 / 定位标"""
        sat = Image.open(P.SAT).convert("RGB")
        for box, (dx, dy) in SAT_PATCHES:
            # 用旁边一块同样大小的地面盖住（dx, dy 为取样偏移），边缘羽化
            src = sat.crop((box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy))
            mask = Image.new("L", src.size, 0)
            ImageDraw.Draw(mask).rounded_rectangle([3, 3, src.width - 4, src.height - 4], radius=6, fill=255)
            sat.paste(src, box[:2], mask.filter(ImageFilter.GaussianBlur(3)))
        u0, v1 = VIEW[0], VIEW[3]
        # sat = O + (u·U + v·V) / S，u = u0 + X/K，v = v1 − Y/K
        a = P.U[0] / (K * P.S)
        b = -P.V[0] / (K * P.S)
        c = P.O[0] + (u0 * P.U[0] + v1 * P.V[0]) / P.S
        d = P.U[1] / (K * P.S)
        e = -P.V[1] / (K * P.S)
        f = P.O[1] + (u0 * P.U[1] + v1 * P.V[1]) / P.S
        img = sat.transform((self.w, self.h), Image.AFFINE, (a, b, c, d, e, f), Image.BICUBIC)
        img = ImageEnhance.Color(img).enhance(0.85)
        return ImageEnhance.Brightness(img).enhance(1.04).convert("RGBA")


def poly_layer(m, polys, fill=None, outline=None, width=2, dash=None):
    """在超采样图层上画多边形（局部坐标），返回缩小后的 RGBA 图层"""
    lay = Image.new("RGBA", (m.w * SS, m.h * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    for poly in polys:
        pts = m.ps(poly)
        if fill:
            d.polygon(pts, fill=fill)
        if outline:
            if dash:
                P.dashed(d, pts + [pts[0]], outline, width * SS, dash[0] * SS, dash[1] * SS)
            else:
                d.line(pts + [pts[0]], fill=outline, width=width * SS, joint="curve")
    return lay.resize((m.w, m.h), Image.LANCZOS)


def line_layer(m, lines, color, width, dash=None):
    lay = Image.new("RGBA", (m.w * SS, m.h * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    for ln in lines:
        pts = m.ps(ln)
        if dash:
            P.dashed(d, pts, color, int(width * SS), dash[0] * SS, dash[1] * SS)
        else:
            d.line(pts, fill=color, width=int(width * SS), joint="curve")
    return lay.resize((m.w, m.h), Image.LANCZOS)


def pv_layer(m, polys, edge):
    """光伏棚：深蓝底 + 组件分格（沿 u 每 2.3 m、沿 v 每 4.6 m 一道浅线），edge 为所属功能色描边"""
    lay = Image.new("RGBA", (m.w * SS, m.h * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    for poly in polys:
        us = [p[0] for p in poly]
        vs = [p[1] for p in poly]
        d.polygon(m.ps(poly), fill=COL["pv"] + (215,))
        if len(poly) == 4 and len(set(us)) == 2:  # 轴向矩形才画分格
            u = min(us) + 2.3
            while u < max(us):
                d.line([m.p(u, min(vs), SS), m.p(u, max(vs), SS)], fill=(120, 150, 210, 140), width=1)
                u += 2.3
            v = min(vs) + 4.6
            while v < max(vs):
                d.line([m.p(min(us), v, SS), m.p(max(us), v, SS)], fill=(150, 180, 235, 170), width=SS)
                v += 4.6
        pts = m.ps(poly)
        d.line(pts + [pts[0]], fill=edge + (255,), width=2 * SS)
    return lay.resize((m.w, m.h), Image.LANCZOS)


def badge(d, xy, n, r=17):
    """编号圆标：白底、主色描边、主色数字"""
    x, y = xy
    d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255), outline=COL["green"], width=3)
    d.text((x, y + 1), str(n), font=font(r * 1.15, True), fill=COL["green"], anchor="mm")


def tag(d, xy, s, size=17, color=(255, 255, 255), anchor="mm", bg=(18, 32, 28, 170)):
    """地图上的小标签：半透明深色底 + 白字"""
    f = font(size)
    box = d.textbbox(xy, s, font=f, anchor=anchor)
    d.rounded_rectangle([box[0] - 6, box[1] - 3, box[2] + 6, box[3] + 3], radius=5, fill=bg)
    d.text(xy, s, font=f, fill=color, anchor=anchor)


def draw_map():
    m = Map()
    img = m.satellite()
    comp = img.alpha_composite

    # 分区底色
    comp(poly_layer(m, [P.GROVE], fill=COL["grove"] + (70,)))
    comp(poly_layer(m, [UP_CANOPY, H2_STORE] + TUBE_BAYS, fill=COL["h2"] + (60,)))
    comp(poly_layer(m, [OFFICE], fill=COL["office"] + (110,)))
    comp(poly_layer(m, [TRUCK_CANOPY], fill=COL["truck"] + (60,)))
    comp(poly_layer(m, [ESS_CANOPY], fill=COL["ess"] + (70,)))
    # 乘用车条带底色只画在新红线以内（蓝圈部分已划出规划）
    car_tint = poly_layer(m, [P.EAST], fill=COL["car"] + (70,))
    clip = poly_layer(m, [RED], fill=(255, 255, 255, 255)).getchannel("A")
    car_tint.putalpha(Image.fromarray((np.asarray(car_tint.getchannel("A"), float)
                                       * np.asarray(clip, float) / 255).astype(np.uint8)))
    comp(car_tint)

    # 场内道路、回车场（浅灰铺装）与园区路（深灰 + 白色边线 + 黄色中线虚线）
    comp(poly_layer(m, [UP_APRON, BACK_LANE, TRUCK_AISLE, LOW_APRON],
                    fill=COL["apron"] + (150,)))
    comp(poly_layer(m, CAR_PAVING, fill=COL["road"] + (200,)))
    comp(poly_layer(m, [P.ROAD_EXT_POLY], fill=COL["road"] + (120,)))
    comp(poly_layer(m, [P.ROAD_POLY], fill=COL["road"] + (225,)))
    comp(line_layer(m, [P.ROAD_L, P.ROAD_R], (235, 238, 242, 255), 1.6))
    comp(line_layer(m, [P.ROAD_C], (250, 214, 90, 230), 1.4, dash=(10, 8)))

    # 挡墙（上下台阶高差）：现状台地边线 L1（v = 0），西起红线、东到园区路西沿
    comp(line_layer(m, [[(P.west_u(0), 0), (P.u_at(P.ROAD_L, 0), 0)]], (120, 92, 60, 230), 4))

    # 光伏棚（深蓝 + 分格）及棚下 / 周边设备
    comp(pv_layer(m, [UP_CANOPY], COL["h2"]))
    comp(pv_layer(m, [OFFICE], COL["office"]))
    comp(pv_layer(m, [TRUCK_CANOPY], COL["truck"]))
    comp(pv_layer(m, [ESS_CANOPY], COL["ess"]))
    comp(pv_layer(m, [q for q, _ in CAR_STALLS], COL["car"]))
    white = (250, 250, 250, 225)
    comp(poly_layer(m, SWAP_HALLS, fill=white, outline=COL["swap"] + (255,), width=2))
    comp(poly_layer(m, H2_ISLANDS, fill=white))
    comp(poly_layer(m, ESS_UNITS + BOX_TRANS, fill=white, outline=(120, 110, 60, 255), width=1))
    comp(poly_layer(m, VISITOR, outline=(255, 255, 255, 220), width=1))
    comp(poly_layer(m, [H2_STORE], outline=(255, 255, 255, 255), width=2, dash=(6, 4)))
    comp(poly_layer(m, TUBE_BAYS, fill=(240, 244, 248, 200), outline=COL["h2"] + (255,), width=1))
    tanks = Image.new("RGBA", (m.w * SS, m.h * SS), (0, 0, 0, 0))
    dt = ImageDraw.Draw(tanks)
    for u, v in H2_TANKS:
        x, y = m.p(u, v, SS)
        r = 1.8 * K * SS
        dt.ellipse([x - r, y - r, x + r, y + r], fill=(250, 250, 250, 240), outline=(90, 150, 100, 255), width=SS)
    comp(tanks.resize((m.w, m.h), Image.LANCZOS))
    # 重卡车位分隔线（大棚下，浅色细线）与大棚 6 根柱
    bays = []
    for v0, v1 in TRUCK_ROWS:
        for i in range(BAY_N + 1):
            u = TRUCK_U0 + i * BAY_W
            bays.append([(u, v0), (u, v1)])
    comp(line_layer(m, bays, (190, 210, 245, 200), 1))
    posts = Image.new("RGBA", (m.w * SS, m.h * SS), (0, 0, 0, 0))
    dp = ImageDraw.Draw(posts)
    (cu0, cv0), (cu1, _), (_, cv1) = TRUCK_CANOPY[0], TRUCK_CANOPY[1], TRUCK_CANOPY[2]
    for u in (cu0 + 1, (cu0 + cu1) / 2, cu1 - 1):
        for v in (cv0 + 1, cv1 - 1):
            x, y = m.p(u, v, SS)
            dp.rectangle([x - 3 * SS, y - 3 * SS, x + 3 * SS, y + 3 * SS], fill=(240, 180, 20, 255))
    comp(posts.resize((m.w, m.h), Image.LANCZOS))

    # 土坡（用户红圈处，黄褐色；按甲方要求不加文字说明）
    comp(poly_layer(m, [MOUND], fill=COL["mound"] + (200,), outline=(150, 112, 60, 255), width=2))

    # 规划红线
    comp(line_layer(m, [RED + [RED[0]]], COL["red"] + (255,), 3.2, dash=(16, 8)))

    # 标注
    d = ImageDraw.Draw(img)
    badge(d, m.p(30, 62), 1)
    badge(d, m.p(80, 49), 2)
    badge(d, m.p(142, 46), 3)
    badge(d, m.p(70, -34), 4)
    badge(d, m.p(111, -105), 5)  # 乘用车条带中段两排车位之间的通道上
    badge(d, m.p(8, -38), 6)
    tag(d, m.p(20, 116), "储氢罐区 · 长管拖车位", 15)
    tag(d, m.p(52, 15), "上台阶 · 一体化光伏大棚", 16)
    tag(d, m.p(70, -72), "下台阶 · 重卡充电光伏大棚（6 柱）", 16)
    tag(d, m.p(143, 22), "访客停车", 14)
    tag(d, m.p(60, 1.5), "挡墙（上下台阶高差）", 14, bg=(90, 60, 30, 190))
    xu = m.p(*P.XU_HALL)
    d.rectangle([xu[0] - 9, xu[1] - 7, xu[0] + 9, xu[1] + 7], fill=(140, 40, 32), outline=(255, 240, 220), width=2)
    tag(d, (xu[0] + 16, xu[1]), "徐氏祠（保留）· 现状林木", 15, anchor="lm", bg=(30, 80, 40, 190))
    tag(d, m.p(166, 150), "园区路（贯通至后方）", 15, anchor="lm")
    tag(d, m.p(90, 140), "后方预留用地 · 保持现状", 17, bg=(40, 40, 40, 150))
    tag(d, m.p(30, -150), "东 环 路", 20, bg=(40, 40, 40, 170))
    ent = m.p(*P.ROAD_C[0])
    d.ellipse([ent[0] - 9, ent[1] - 9, ent[0] + 9, ent[1] + 9], fill=COL["red"], outline=(255, 255, 255), width=3)
    tag(d, (ent[0] + 16, ent[1] - 2), "主出入口", 15, anchor="lm")

    # 指北针（局部坐标的 v 轴相对正北偏约 13°）与比例尺
    nx, ny = m.w - 56, 64
    # 正北在局部坐标里的方向 = (−U_y, −V_y)，相对图上“向上”顺时针偏 phi
    phi = math.atan2(-P.U[1], -P.V[1])

    def rot(dx, dy):
        """以指北针中心为原点、按 phi 顺时针旋转（屏幕坐标 y 向下）"""
        c, s_ = math.cos(phi), math.sin(phi)
        return (nx + dx * c - dy * s_, ny + dx * s_ + dy * c)

    d.ellipse([nx - 42, ny - 42, nx + 42, ny + 42], fill=(255, 255, 255, 220))
    d.polygon([rot(0, -10), rot(-12, 32), rot(0, 22)], fill=COL["green"])
    d.polygon([rot(0, -10), rot(12, 32), rot(0, 22)], fill=(120, 170, 140))
    d.text(rot(0, -26), "N", font=font(18, True), fill=COL["green"], anchor="mm")
    bar = 50 * K
    bx, by = m.w - 56 - bar, m.h - 34
    d.rounded_rectangle([bx - 20, by - 34, bx + bar + 34, by + 14], radius=6, fill=(255, 255, 255, 220))
    d.line([(bx, by), (bx + bar, by)], fill=(30, 40, 36), width=3)
    for t in (0, 0.5, 1):
        d.line([(bx + bar * t, by - 7), (bx + bar * t, by)], fill=(30, 40, 36), width=2)
    d.text((bx, by - 12), "0", font=font(13), fill=(30, 40, 36), anchor="ms")
    d.text((bx + bar, by - 12), "50 m", font=font(13), fill=(30, 40, 36), anchor="ms")
    return img


# ---------------------------------------------------------------- 整张版面（参照旧布局图）

W, H = 1800, 1360
PAD = 34


def rounded_paste(canvas, img, xy, radius=14):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.width - 1, img.height - 1], radius=radius, fill=255)
    canvas.paste(img.convert("RGB"), xy, mask)


def draw_sheet():
    st = stats()
    canvas = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(canvas)
    d.rectangle([0, 0, W, 8], fill=COL["green"])
    d.text((PAD, 30), "总平面布局示意（卫星实景）", font=font(40, True), fill=(24, 36, 30))
    d.text((PAD, 86), f"十堰市东环路老庄地块综合能源站 · 约 {st['red_mu']:.0f} 亩 · 光储充换氢 + 乘用车充电"
                      "（按三维设计稿定稿布置）", font=font(21), fill=(70, 90, 80))

    mp = draw_map()
    mx, my = PAD, 132
    rounded_paste(canvas, mp, (mx, my))
    d.rounded_rectangle([mx, my, mx + mp.width, my + mp.height], radius=14, outline=(200, 214, 206), width=2)

    # 右侧图例
    lx = mx + mp.width + 26
    lw = W - PAD - lx
    ly0, ly1 = my, my + mp.height
    d.rounded_rectangle([lx, ly0, lx + lw, ly1], radius=14, fill=(248, 252, 249), outline=(198, 224, 208), width=2)
    x = lx + 26
    y = ly0 + 34
    d.text((x, y), "分区图例", font=font(26, True), fill=COL["green"], anchor="lm")
    y += 54
    items = [
        ("加氢站", "35MPa · 1,000 kg/日 · 加氢岛 ×3", "储氢罐区、长管拖车位在棚后", COL["h2"]),
        ("换电站 ×2", "3~5 分钟快速换电 · 南进北出", "与加氢站同在一体化光伏大棚下", COL["swap"]),
        ("综合楼", "调度 / 监控 / 司机之家", f"屋顶光伏 · 楼前访客车位 {st['visitor']} 个", COL["office"]),
        ("重卡充电区", f"{st['truck_bays']} 车位 · 两排合一光伏大棚", "车头朝中间通道倒车入位 · 6 柱大跨", COL["truck"]),
        ("乘用车充电区", f"{st['car_bays']} 车位 · 光伏车棚", "入口右侧、园区路东侧条带", COL["car"]),
        ("储能区", "8MW / 32MWh · 储能舱 ×8 · 箱变 ×2", "上加光伏棚 · 邻近重卡充电区", COL["ess"]),
    ]
    for i, (name, sub1, sub2, col) in enumerate(items, 1):
        badge(d, (x + 17, y + 6), i, 17)
        d.rectangle([x + 44, y - 5, x + 56, y + 17], fill=col)
        d.text((x + 66, y + 6), name, font=font(23, True), fill=(24, 36, 30), anchor="lm")
        d.text((x + 44, y + 38), sub1, font=font(17), fill=(80, 96, 88), anchor="lm")
        d.text((x + 44, y + 62), sub2, font=font(15), fill=(120, 134, 128), anchor="lm")
        y += 98
    y += 6
    d.line([(x, y), (lx + lw - 26, y)], fill=(210, 228, 216), width=2)
    y += 26
    extra = [
        ("line", COL["red"], f"规划用地红线（约 {st['red_mu']:.0f} 亩）"),
        ("pv", COL["pv"], "光伏车棚 / 屋顶光伏（描边色 = 所属分区）"),
        ("fill", COL["grove"], "徐氏祠及现状林木（保留不动）"),
        ("fill", COL["road"], "园区路（现状道路保留，贯通至后方）"),
        ("dot", COL["red"], "主出入口（东环路）"),
    ]
    for kind, col, s in extra:
        if kind == "line":
            P.dashed(d, [(x + 2, y), (x + 40, y)], col, 4, 10, 5)
        elif kind == "dot":
            d.ellipse([x + 13, y - 8, x + 29, y + 8], fill=col, outline=(255, 255, 255), width=2)
        else:
            d.rectangle([x + 2, y - 9, x + 40, y + 9], fill=col)
            if kind == "pv":
                for t in range(1, 5):
                    d.line([(x + 2 + t * 8, y - 9), (x + 2 + t * 8, y + 9)], fill=(150, 180, 235), width=1)
        d.text((x + 54, y), s, font=font(16), fill=(60, 76, 68), anchor="lm")
        y += 36

    # 底部指标条 + 注释
    by = my + mp.height + 22
    d.rounded_rectangle([PAD, by, W - PAD, by + 64], radius=10, fill=(232, 244, 236), outline=(198, 224, 208), width=2)
    bar = (f"约 {st['red_mu']:.0f} 亩  |  光伏约 {st['pv_mwp']:.1f} MWp  |  储能 8MW/32MWh  |  "
           f"充电 {st['truck_bays']}+{st['car_bays']} 车位  |  换电 2 座  |  加氢 1,000 kg/日")
    d.text((PAD + 24, by + 32), bar, font=font(24, True), fill=(26, 90, 58), anchor="lm")
    d.text((PAD + 4, by + 84), "注：方案效果示意，非报规图；分区与设备布置以实测地形、红线及规划条件为准。"
                               "光伏装机按棚顶面积 × 铺设率 0.9 × 210 W/m² 估算。",
           font=font(16), fill=(120, 130, 126), anchor="lm")
    canvas.save(OUT, optimize=True)
    return st


def main():
    st = draw_sheet()
    print(f"红线约 {st['red_mu']:.1f} 亩；土坡 {st['mound_m2']:.0f} m²")
    for k, v in st["pv"].items():
        print(f"  光伏面积 {k}: {v:.0f} m²")
    print(f"光伏约 {st['pv_mwp']:.2f} MWp；重卡 {st['truck_bays']} 位、乘用车 {st['car_bays']} 位、访客 {st['visitor']} 位")
    print("写出", OUT)


if __name__ == "__main__":
    main()

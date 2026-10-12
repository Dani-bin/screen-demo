"""综合能源补给站 规划草图生成脚本。

在假定场址卫星截图（docs/design/energy/site.webp）上叠加功能分区、道路、车流流线和图例，
输出 docs/design/energy/plan-v2.png。

坐标约定（后续 Blender / three.js 建模沿用同一套）：
  u —— 沿门前道路方向，自北向南为正（米）
  v —— 垂直道路，自道路红线向场内（西）为正（米）
  原点 O 取红线东北角附近的点；比例尺为假定值 S 米/像素（截图无比例尺，按车道 / 车辆尺寸估算）。

用法：python3 scripts/energy/draw_plan.py（同时导出 scripts/blender/energy/site.json、src/views/energy/data/plan.json）
"""

import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SITE_IMG = os.path.join(ROOT, "docs/design/energy/site.webp")
OUT_IMG = os.path.join(ROOT, "docs/design/energy/plan-v2.png")
FONT_DIR = os.path.join(ROOT, "src/assets/fonts")
FONT_BODY = os.path.join(FONT_DIR, "SourceHanSansCN-Regular.otf")
FONT_TITLE = os.path.join(FONT_DIR, "AlimamaShuHeiTi-Bold.ttf")

K = 1.5  # 输出放大倍数（原图较糊，放大后线条和文字更清晰）
S = 0.25  # 假定比例尺：米 / 原图像素
O = (1046, 500)  # 局部坐标原点（原图像素）
# 道路方向单位向量 U（沿路向南），V 为其左手法向（指向场内 / 西侧）
_ux, _uy = 0.55, 0.835
_n = math.hypot(_ux, _uy)
U = (_ux / _n, _uy / _n)
V = (-U[1], U[0])


def px(u, v):
    """局部米坐标 → 输出图像素坐标。"""
    x = O[0] + (u * U[0] + v * V[0]) / S
    y = O[1] + (u * U[1] + v * V[1]) / S
    return (x * K, y * K)


class UVPoly(list):
    """像素多边形（供绘图直接使用），同时在 .uv 里保留原始米坐标（供导出布局给建模）。"""

    def __init__(self, uv):
        super().__init__(px(u, v) for u, v in uv)
        self.uv = [(float(u), float(v)) for u, v in uv]


def rect(u0, u1, v0, v1):
    """局部坐标下的矩形（沿路方向 u0..u1，进深 v0..v1）→ 像素多边形。"""
    return UVPoly([(u0, v0), (u1, v0), (u1, v1), (u0, v1)])


def poly(pts):
    return UVPoly(pts)


# ---------------------------------------------------------------- 规划数据
# 所有尺寸单位为米，均在 (u, v) 局部坐标下给出。
#
# v2（2026-10-12）：布局按用户确认的设计稿 docs/design/energy/01-ai-overview.png 反求——
# 先用罩棚屋面、车位前沿等矩形标定出设计稿的相机（正交，方位约 43°、俯角约 24°，误差约 3 px），
# 再把设计稿里每栋建筑、道路、场地边缘的像素位置反投影回地面，得到下面的米坐标（详见 README「v2」）。
# 设计稿从左到右：价格立柱 → 办公楼与停车场 → 加油加气罩棚（后面 CNG 撬、换电站）→ 绿化
# → LNG 罩棚与后排重卡超充车棚 → 箱变 ×2 → LNG 储罐，门前是双向六车道国道。

# 沙盘外轮廓：超椭圆（中心 PLAT_C，半轴 a 沿路、b 进深，指数 n；n=2 为椭圆，越大越接近圆角矩形），含门前国道
PLAT_C = (120.0, 17.0)
PLAT_A, PLAT_B, PLAT_N = 125.0, 49.0, 2.2
# 门前国道（v）：前侧绿化 | 北行三车道 | 中央隔离带 | 南行三车道（靠场地）| 场地侧绿化
HWY = {"front": -28.0, "median": (-17.5, -14.5), "edge": -4.0}


def platform(n_pts=360):
    """超椭圆外轮廓点列（逆时针）"""
    out = []
    for i in range(n_pts):
        t = 2 * math.pi * i / n_pts
        c, s = math.cos(t), math.sin(t)
        out.append((PLAT_C[0] + PLAT_A * math.copysign(abs(c) ** (2 / PLAT_N), c),
                    PLAT_C[1] + PLAT_B * math.copysign(abs(s) ** (2 / PLAT_N), s)))
    return out


def clip_v(poly, v0):
    """Sutherland–Hodgman：保留 v >= v0 的部分（用地红线 = 沙盘外轮廓里国道以内的部分）"""
    out = []
    n = len(poly)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        if p[1] >= v0:
            out.append(p)
        if (p[1] >= v0) != (q[1] >= v0):
            k = (v0 - p[1]) / (q[1] - p[1])
            out.append((p[0] + (q[0] - p[0]) * k, v0))
    return out


# 道路铺装（沥青，先画，作为底层）
ROADS = [
    # 重卡入口：从南行车道分出，斜向上到车位通道东端（东侧是 LNG 储罐区，西侧是箱变）
    poly([(18, -4), (34, -4), (62, 24), (46, 24)]),
    # 车位前的通道（进深 15 m，西端多留到 u 158，供重卡倒车入位前越过车位）
    rect(46, 158, 24, 39),
    # LNG 罩棚前场与两条加气车道（含罩棚前的通行道）
    rect(66, 136, 2, 24),
    # 中部出入口：重卡出站汇入国道、小车由此进站
    rect(128, 162, -4, 6),
    rect(128, 144, 2, 39),
    # 小车进站斜坡道 → 加油罩棚
    poly([(144, 0), (166, 0), (166, 37), (157, 37)]),
    # 换电站前后通道
    rect(156, 186, 37, 46),
    # 西端：罩棚与停车场之间的回场道 + 出口
    rect(204, 214, 0, 37),
    poly([(206, -4), (232, -4), (226, 3), (206, 3)]),
]
# 浅色混凝土站坪（罩棚下、停车场）
FORECOURT = [rect(160, 210, 0, 37)]
PAVING = [rect(210, 236, 14, 33)]  # 停车场

# 功能分区：(名称, 多边形, 填充色, 标签位置(u,v) 或 None 表示放在多边形中心, 标签文字)
COL = {
    "fuel": (64, 200, 255),
    "tank": (214, 98, 46),
    "swap": (34, 199, 232),
    "office": (76, 125, 255),
    "park": (255, 225, 90),
    "lng": (167, 123, 255),
    "lngtank": (124, 82, 214),
    "charge": (155, 225, 93),
    "power": (255, 90, 106),
    "green": (76, 175, 80),
}

ZONES = [
    ("加油加气站", rect(166, 204, 10, 30), COL["fuel"], None, "加油加气站\n汽/柴/CNG"),
    ("CNG储气", rect(184, 204, 37, 48), COL["tank"], None, "CNG"),
    ("换电站", rect(166, 180, 37.5, 45.5), COL["swap"], None, "换电站"),
    ("办公楼", rect(212, 227, 35, 44), COL["office"], None, "办公楼 3F\n便利店 · 司机之家"),
    ("加气站", rect(86, 126, 10, 24), COL["lng"], None, "加气站\n重卡 LNG"),
    ("LNG储罐区", rect(8, 40, 12, 34), COL["lngtank"], None, "LNG\n储罐区"),
    ("箱变", rect(52, 68, 6, 20), COL["power"], None, "箱变 ×2"),
]
# 加油岛：两排各 3 岛（沿路方向 8 m 长），后排东侧两岛为 CNG；LNG 加气岛：一排 2 岛
FUEL_ISLAND_U = (172.5, 185.0, 197.5)
ISLANDS = (
    [rect(c - 4, c + 4, v0, v0 + 1.6) for v0 in (15.5, 23.0) for c in FUEL_ISLAND_U],
    [rect(c - 5.5, c + 5.5, 16.3, 17.9) for c in (97.0, 115.0)],
)

# 停车场：员工车位 6 个（靠办公楼一排）、私家车位 8 个（靠路一排），2.6 × 5.5 m 垂直式，中间通道 6.5 m
STAFF_BAYS = [rect(214 + 2.6 * i, 216.6 + 2.6 * i, 27.5, 33) for i in range(6)]
CAR_BAYS = [rect(212 + 2.6 * i, 214.6 + 2.6 * i, 14, 19.5) for i in range(8)]

# 重卡超充位 10 个：垂直式一排（与设计稿一致），每位宽 6.4 m、进深 20 m，前沿 v 39；
# 充电终端立在每个车位前沿靠东一侧（重卡倒车入位后车头朝通道，充电口在车头附近）
TRUCK_BAY_U0, TRUCK_BAY_W, TRUCK_BAY_V = 70.0, 6.4, (39.0, 59.0)
TRUCK_BAYS = []
CHARGERS = []
for i in range(10):
    u0 = TRUCK_BAY_U0 + TRUCK_BAY_W * i
    TRUCK_BAYS.append(rect(u0, u0 + TRUCK_BAY_W, *TRUCK_BAY_V))
    CHARGERS.append(rect(u0 + 0.3, u0 + 1.5, 39.6, 40.8))

# 车流流线（局部坐标折线，仅用于规划图示意；三维里的车辆路线见 src/views/energy/data/paths.js）
CAR_FLOW = [(136, -6), (150, 1), (162, 18), (200, 20), (209, 12), (216, 1), (230, -6)]
TRUCK_FLOW_GAS = [(14, -6), (36, 6), (56, 22), (80, 17), (124, 17), (136, 10), (146, -6)]
TRUCK_FLOW_CHG = [(40, 10), (54, 31), (150, 31.5), (136, 29), (136, 4)]

SIGNS = [(228, 8, "站名价格牌")]


# ---------------------------------------------------------------- 绘图工具

def font(size, title=False):
    return ImageFont.truetype(FONT_TITLE if title else FONT_BODY, int(size))


def centroid(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def dashed(draw, a, b, fill, width, dash=14, gap=10):
    """两点间画虚线。"""
    (x1, y1), (x2, y2) = a, b
    length = math.hypot(x2 - x1, y2 - y1)
    if length == 0:
        return
    dx, dy = (x2 - x1) / length, (y2 - y1) / length
    t = 0
    while t < length:
        t2 = min(t + dash, length)
        draw.line([(x1 + dx * t, y1 + dy * t), (x1 + dx * t2, y1 + dy * t2)], fill=fill, width=width)
        t += dash + gap


def dashed_poly(draw, pts, fill, width):
    for i in range(len(pts)):
        dashed(draw, pts[i], pts[(i + 1) % len(pts)], fill, width)


def text_c(draw, xy, txt, size, fill=(255, 255, 255), stroke=(20, 24, 32), sw=3):
    """以 xy 为中心绘制多行文字（带描边，保证在卫星图上可读）。"""
    f = font(size)
    draw.multiline_text(xy, txt, font=f, fill=fill, anchor="mm", align="center",
                        stroke_width=sw, stroke_fill=stroke, spacing=4)


def flow(draw, pts_uv, color, width=7):
    """车流流线：折线 + 沿线箭头 + 终点箭头。"""
    pts = [px(u, v) for u, v in pts_uv]
    draw.line(pts, fill=color, width=width, joint="curve")

    def head(p, q, size):
        ang = math.atan2(q[1] - p[1], q[0] - p[0])
        tip = q
        l = (q[0] - size * math.cos(ang - 0.45), q[1] - size * math.sin(ang - 0.45))
        r = (q[0] - size * math.cos(ang + 0.45), q[1] - size * math.sin(ang + 0.45))
        draw.polygon([tip, l, r], fill=color)

    # 每段中点加一个箭头表示方向
    for i in range(len(pts) - 1):
        p, q = pts[i], pts[i + 1]
        if math.hypot(q[0] - p[0], q[1] - p[1]) > 90:
            m = ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
            head(p, m, 24)
    head(pts[-2], pts[-1], 30)


# ---------------------------------------------------------------- 主流程

# 页面航拍底图向四周外扩的比例（每边 = 原图宽 / 高 × AERIAL_PAD）：截图本身不够大，
# 开场俯视镜头斜着看（镜头方位与截图轴线不平行）时，屏幕角落会露出截图外的黑底
AERIAL_PAD = 0.32


def clean_aerial():
    """
    卫星截图上有用户手绘的红色圈地线（v1 的水滴形地块）。v2 地块按设计稿改成了超椭圆，旧红线用 OpenCV 修补抹掉，返回 PIL 图（规划图用）。
    同时写 public/energy/site.webp（页面开场动画的航拍底图）：四周按 AERIAL_PAD 镜像外扩，外扩部分越往外越模糊、越暗，
    最外一圈渐隐到页面背景色，开场俯视时屏幕里不会出现硬边黑楔
    """
    import cv2

    src = np.array(Image.open(SITE_IMG).convert("RGB"))
    r, g, b = (src[..., i].astype(int) for i in range(3))
    red = ((r > 150) & (r - g > 70) & (r - b > 70)).astype(np.uint8) * 255
    red = cv2.dilate(red, np.ones((7, 7), np.uint8))
    # 地图截图自带的界面元素也一并抹掉（外扩时会被镜像出去）：右上角白条、右下角图标、超市 POI 标注
    for x0, y0, x1, y1 in ((1468, 0, 1788, 14), (1696, 1436, 1746, 1478), (1436, 570, 1640, 622)):
        red[y0:y1, x0:x1] = 255
    out = cv2.inpaint(src, red, 9, cv2.INPAINT_TELEA)

    h, w = out.shape[:2]
    px_, py_ = int(w * AERIAL_PAD), int(h * AERIAL_PAD)
    big = cv2.copyMakeBorder(out, py_, py_, px_, px_, cv2.BORDER_REFLECT_101).astype(np.float32)
    blur = cv2.GaussianBlur(big, (0, 0), 40)
    H, W = big.shape[:2]
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    # 到原图矩形的距离（像素，原图内为 0）→ 0..1
    dx = np.maximum(np.maximum(px_ - xx, xx - (px_ + w)), 0)
    dy = np.maximum(np.maximum(py_ - yy, yy - (py_ + h)), 0)
    d = np.clip(np.hypot(dx, dy) / min(px_, py_), 0, 1)[..., None]
    # 模糊过渡带跨在原图边缘两侧（原图内侧也渐渐变糊），清晰区与模糊区之间看不出矩形边；镜像接缝落在重度模糊里
    din = np.minimum(np.minimum(xx - px_, px_ + w - xx), np.minimum(yy - py_, py_ + h - yy))
    sd = np.where(din > 0, -din, np.hypot(dx, dy)) / min(px_, py_)
    k = np.clip((sd[..., None] + 0.22) / 0.34, 0, 1)
    k = k * k * (3 - 2 * k)
    img = big * (1 - k) + blur * k
    bg = np.array([4, 10, 21], np.float32)  # 页面背景 #040a15
    img = img * (1 - d * 0.7) + bg * (d * 0.7)
    fade = np.clip((d - 0.7) / 0.3, 0, 1)  # 最外 30% 渐隐到背景色
    img = img * (1 - fade) + bg * fade
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).resize((W * 3 // 4, H * 3 // 4), Image.Resampling.LANCZOS).save(
        os.path.join(ROOT, "public/energy/site.webp"), quality=84)
    return Image.fromarray(out)


def site_polygon():
    """用地红线：沙盘超椭圆外轮廓去掉门前国道（v < 0）的部分 → 输出图像素点列，及用地面积（m²）"""
    uv = clip_v(platform(), 0.0)
    return [px(u, v) for u, v in uv], abs(_area(uv))


def _area(pts):
    a = 0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return a / 2


def main():
    base = clean_aerial()
    W, H = int(base.width * K), int(base.height * K)
    base = base.resize((W, H), Image.Resampling.LANCZOS)
    # 底图压暗、降饱和，让规划内容突出
    ImageDraw.Draw(base).rectangle([int(1470 * K), 0, W, int(12 * K)], fill=(40, 52, 40))
    base = ImageEnhance.Color(base).enhance(0.45)
    base = ImageEnhance.Brightness(base).enhance(0.62).convert("RGBA")

    site, site_area = site_polygon()
    plat = [px(u, v) for u, v in platform()]

    # ---- 门前国道（沙盘外轮廓内 v < 0 的部分）
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.polygon(plat, fill=(58, 63, 72, 235))
    d.polygon(site, fill=(0, 0, 0, 0))
    m0, m1 = HWY["median"]
    d.polygon(rect(-20, 260, m0, m1), fill=COL["green"] + (200,))
    for v0, v1 in ((-40, HWY["front"]), (HWY["edge"], 0)):
        d.polygon(rect(-20, 260, v0, v1), fill=COL["green"] + (150,))
    pm = Image.new("L", (W, H), 0)
    ImageDraw.Draw(pm).polygon(plat, fill=255)
    layer.putalpha(Image.fromarray(np.minimum(np.array(layer.split()[3]), np.array(pm))))
    base = Image.alpha_composite(base, layer)

    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).polygon(site, fill=255)

    # ---- 场内图层（按红线裁剪）
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.polygon(site, fill=COL["green"] + (95,))  # 场内绿化底色
    for r in ROADS:
        d.polygon(r, fill=(58, 63, 72, 235))
    for r in FORECOURT + PAVING:
        d.polygon(r, fill=(150, 150, 140, 200))
    # 车位
    for b in STAFF_BAYS + CAR_BAYS:
        d.polygon(b, fill=(70, 74, 82, 255), outline=COL["park"] + (255,), width=2)
    for b in TRUCK_BAYS:
        d.polygon(b, fill=(70, 74, 82, 255), outline=COL["charge"] + (255,), width=3)
    for c in CHARGERS:
        d.polygon(c, fill=COL["charge"] + (255,))
    # 功能分区
    for name, pts, col, _, _ in ZONES:
        d.polygon(pts, fill=col + (150,), outline=col + (255,), width=4)
    for isl_group in ISLANDS:
        for isl in isl_group:
            d.polygon(isl, fill=(255, 255, 255, 230))
    # LNG 卧罐示意
    d.polygon(rect(16, 30, 20.5, 25.5), fill=(235, 230, 255, 240))
    layer.putalpha(Image.fromarray(np.minimum(np.array(layer.split()[3]), np.array(mask))))
    base = Image.alpha_composite(base, layer)

    # ---- 不裁剪的图层：红线、沙盘外轮廓、流线
    top = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(top)
    dashed_poly(d, plat, (80, 160, 255, 255), 3)
    d.line(site + [site[0]], fill=(255, 64, 64, 255), width=6)
    flow(d, CAR_FLOW, (90, 170, 255, 235))
    flow(d, TRUCK_FLOW_GAS, (255, 170, 40, 235))
    flow(d, TRUCK_FLOW_CHG, (255, 170, 40, 235))
    for u, v, t in SIGNS:
        x, y = px(u, v)
        d.rectangle([x - 7, y - 22, x + 7, y + 6], fill=(255, 210, 80, 255), outline=(30, 30, 30, 255))
    base = Image.alpha_composite(base, top)

    d = ImageDraw.Draw(base)
    # 分区标签
    for name, pts, col, lab, txt in ZONES:
        xy = px(*lab) if lab else centroid(pts)
        # 主要设施用大字，罐区等小块用小字
        size = 30 if name in ("加油加气站", "办公楼", "加气站") else 20 if name in ("CNG储气", "箱变", "换电站") else 24
        text_c(d, xy, txt, size)
    # 车位组标签
    text_c(d, px(222, 24), "员工车位 ×6\n私家车位 ×8", 20, fill=COL["park"])
    text_c(d, px(102, 63), "重卡超充位 ×10", 30, fill=COL["charge"])
    # 出入口
    for (u, v), txt in (((26, -9), "重卡入口"), ((145, -9), "重卡出口 / 小车入口"), ((220, -9), "小车出口")):
        text_c(d, px(u, v), txt, 22)
    text_c(d, px(100, -36), "门前国道（双向六车道，南行车道靠场地一侧）", 26, fill=(230, 230, 230))
    draw_legend(d, site_area)
    draw_scale(d, W, H)

    base.convert("RGB").save(OUT_IMG, optimize=True)
    print("saved", OUT_IMG, f"site area ≈ {site_area:.0f} m²")


def draw_legend(d, site_area):
    """左上角图例与指标面板。"""
    x0, y0, w = 40, 40, 900
    items = [
        (COL["fuel"], "加油加气站（乘用车）", "罩棚 38×20 m · 6 岛 12 枪 · 汽油/柴油/CNG"),
        (COL["tank"], "CNG 储气 / 埋地油罐", "罩棚北侧，CNG 撬围栏隔离；油罐埋在站坪下"),
        (COL["swap"], "换电站（乘用车）", "通过式，沿路方向驶过"),
        (COL["office"], "办公楼 3F", "一层便利店 + 司机之家，二~三层办公"),
        (COL["park"], "私家车位 ×8 · 员工车位 ×6", "2.6×5.5 m 垂直式"),
        (COL["lng"], "加气站（重卡 LNG）", "罩棚 40×14 m · 2 岛 4 枪"),
        (COL["lngtank"], "LNG 储罐区", "60 m³ 卧罐 + 泵撬，围栏隔离"),
        (COL["charge"], "重卡超充位 ×10", "垂直式一排 + 光伏车棚 · 每位一台液冷超充终端"),
        (COL["power"], "箱变 ×2", "为超充 / 换电供电"),
    ]
    h = 230 + len(items) * 64 + 170
    d.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=18, fill=(12, 20, 34, 225),
                        outline=(80, 140, 220, 255), width=2)
    d.text((x0 + 36, y0 + 30), "综合能源补给站 · 规划方案", font=font(50, True), fill=(255, 255, 255))
    d.text((x0 + 36, y0 + 102), "v2 · 按设计稿反求布局 · 假定场址 · 约 0.25 m/像素", font=font(26),
           fill=(160, 190, 230))
    d.text((x0 + 36, y0 + 146),
           f"用地约 {site_area / 10000:.1f} ha · 沿路长约 250 m · 进深约 65 m",
           font=font(26), fill=(160, 190, 230))
    y = y0 + 210
    for col, name, desc in items:
        d.rectangle([x0 + 36, y + 8, x0 + 76, y + 40], fill=col + (255,))
        d.text((x0 + 96, y), name, font=font(28), fill=(255, 255, 255))
        d.text((x0 + 96, y + 34), desc, font=font(20), fill=(170, 185, 205))
        y += 64
    y += 16
    d.line([(x0 + 36, y + 20), (x0 + 96, y + 20)], fill=(90, 170, 255), width=7)
    d.text((x0 + 110, y + 4), "小车流线：中部进、西端出，场内单向", font=font(24), fill=(255, 255, 255))
    y += 50
    d.line([(x0 + 36, y + 20), (x0 + 96, y + 20)], fill=(255, 170, 40), width=7)
    d.text((x0 + 110, y + 4), "重卡流线：东端进、中部出，倒车入超充位", font=font(24), fill=(255, 255, 255))
    y += 50
    d.line([(x0 + 36, y + 20), (x0 + 96, y + 20)], fill=(255, 64, 64), width=6)
    d.text((x0 + 110, y + 4), "用地红线", font=font(24), fill=(255, 255, 255))


def draw_scale(d, W, H):
    """右下角比例尺与指北针。"""
    m50 = 50 / S * K  # 50 米对应的像素
    x0, y0 = W - 120 - m50, H - 90
    d.rectangle([x0 - 30, y0 - 110, W - 60, H - 30], fill=(12, 20, 34, 200))
    d.line([(x0, y0), (x0 + m50, y0)], fill=(255, 255, 255), width=6)
    for x in (x0, x0 + m50 / 2, x0 + m50):
        d.line([(x, y0 - 12), (x, y0 + 4)], fill=(255, 255, 255), width=4)
    d.text((x0, y0 - 52), "0", font=font(24), fill=(255, 255, 255))
    d.text((x0 + m50 - 50, y0 - 52), "50 m", font=font(24), fill=(255, 255, 255))
    # 指北针
    nx, ny = W - 110, 120
    d.polygon([(nx, ny - 50), (nx - 22, ny + 30), (nx, ny + 14), (nx + 22, ny + 30)],
              fill=(255, 255, 255), outline=(20, 20, 20))
    d.text((nx, ny - 80), "N", font=font(34, True), fill=(255, 255, 255), anchor="mm",
           stroke_width=3, stroke_fill=(20, 20, 20))


def to_uv(x, y):
    """输出图像素 → 局部米坐标（px 的逆变换）。"""
    dx, dy = x / K - O[0], y / K - O[1]
    return ((dx * U[0] + dy * U[1]) * S, (dx * V[0] + dy * V[1]) * S)


def export_layout():
    """把沙盘外轮廓、红线与全部规划要素（米坐标）写到 scripts/blender/energy/site.json，供 Blender 建模读取。"""
    site, area = site_polygon()
    data = {
        "note": "由 scripts/energy/draw_plan.py 生成，勿手改。坐标 (u 沿路向南, v 向场内)，单位米",
        "platform": platform(),
        "site": clip_v(platform(), 0.0),
        "site_area": area,
        "highway": HWY,
        "roads": [r.uv for r in ROADS],
        "forecourt": [r.uv for r in FORECOURT],
        "paving": [r.uv for r in PAVING],
        "zones": {name: pts.uv for name, pts, _, _, _ in ZONES},
        "fuel_islands": [r.uv for r in ISLANDS[0]],
        "lng_islands": [r.uv for r in ISLANDS[1]],
        "staff_bays": [r.uv for r in STAFF_BAYS],
        "car_bays": [r.uv for r in CAR_BAYS],
        "truck_bays": [r.uv for r in TRUCK_BAYS],
        "chargers": [r.uv for r in CHARGERS],
        "flows": {"car": CAR_FLOW, "truck_gas": TRUCK_FLOW_GAS, "truck_charge": TRUCK_FLOW_CHG},
        "signs": [(u, v) for u, v, _ in SIGNS],
    }
    out = os.path.join(ROOT, "scripts/blender/energy/site.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print("saved", out)


def to3(u, v):
    """规划米坐标 → three.js 世界坐标 [x, z]（与 Blender layout.py 一致：x = 110 - u，z = -(v - 40)）"""
    return [round(110.0 - u, 2), round(40.0 - v, 2)]


def export_page_data():
    """
    写 src/views/energy/data/plan.json：页面开场「现状航拍 → 规划」动画与车位逻辑用到的规划数据
    （three.js 坐标），以及卫星底图四角在场景里的位置。
    """
    site, area = site_polygon()
    site_uv = clip_v(platform(120), 0.0)
    w, h = Image.open(SITE_IMG).size
    # 底图四角（原图像素）→ 规划米坐标 → three 坐标；顺序：左上、右上、右下、左下
    corners = []
    ex, ey = w * AERIAL_PAD, h * AERIAL_PAD  # 页面底图四周外扩的部分（见 clean_aerial）
    for cx, cy in ((-ex, -ey), (w + ex, -ey), (w + ex, h + ey), (-ex, h + ey)):
        corners.append(to3(*to_uv(cx * K, cy * K)))
    key = {"加油加气站": "fuel", "CNG储气": "cng", "换电站": "swap", "办公楼": "office",
           "加气站": "lng", "LNG储罐区": "lngtank", "箱变": "power"}
    zones = []
    for name, pts, col, lab, txt in ZONES:
        zones.append({"key": key[name], "name": txt.replace("\n", " "), "color": "#%02x%02x%02x" % col,
                      "pts": [to3(u, v) for u, v in pts.uv]})
    zones.append({"key": "charge", "name": "重卡超充位 ×10", "color": "#%02x%02x%02x" % COL["charge"],
                  "pts": [to3(u, v) for u, v in rect(TRUCK_BAY_U0, TRUCK_BAY_U0 + 10 * TRUCK_BAY_W, *TRUCK_BAY_V).uv]})
    data = {
        "siteArea": round(area),
        "site": [to3(u, v) for u, v in site_uv],
        "aerial": corners,
        "zones": zones,
        "roads": [[to3(u, v) for u, v in r.uv] for r in ROADS + FORECOURT + PAVING],
        "truckBays": [[to3(u, v) for u, v in r.uv] for r in TRUCK_BAYS],
    }
    # JSON 而不是 JS：生成文件不进 ESLint / prettier 的检查，重新生成后也不会报格式错误
    data["_note"] = ("由 scripts/energy/draw_plan.py 生成，与规划草图 docs/design/energy/plan-v2.png 同源，不要手改。"
                     "three.js 坐标：x 沿门前道路、北端为 +x，z 指向道路一侧，单位米；"
                     "aerial 为航拍底图 public/energy/site.webp（原截图四周外扩后）四角（左上、右上、右下、左下）在场景里的位置")
    out = os.path.join(ROOT, "src/views/energy/data/plan.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(data, f, ensure_ascii=False)
    print("saved", out)


if __name__ == "__main__":
    main()
    export_layout()
    export_page_data()

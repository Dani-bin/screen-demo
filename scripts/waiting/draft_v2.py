"""候诊大厅 · 设计稿 v2：四种风格对比（只出设计稿，不是页面代码）。

用法：python3 scripts/waiting/draft_v2.py [b|c|e|f …]（不带参数 = 四张都出 + 对比拼图）
输入：docs/design/waiting/draft/ai-scene-{b-glass,c-holo,e-candy,f-gold}.png（中央三维场景，Figma generate_image，无文字）
     名单 / 号码 / 人数沿用 draft.py 的同一套模拟数据（固定种子）
输出：docs/design/waiting/11-style-b-glass.png  B 医疗青绿 · 玻璃拟态
     docs/design/waiting/12-style-c-holo.png   C 全息线框孪生
     docs/design/waiting/13-style-e-candy.png  E 缤纷等距插画
     docs/design/waiting/14-style-f-gold.png   F 黑金高端
     docs/design/waiting/10-style-compare.png  四张缩小拼在一起

v1 嫌素淡，v2 统一做了这些（第二轮拷问的结论）：
  - 放开"不用渐变 / 发光 / 毛玻璃 / 阴影"的限制，按各自风格加装饰；名字和号码仍是纯色高对比
  - 每间诊室上方立三色状态柱（待诊 / 复诊 / 过诊，柱高 = 人数），标签放在柱顶
  - 被叫诊室：室内染色 + 冲天光柱 + 门前两圈光环
  - 居中大标题 + 装饰标题栏
  - 左栏加分时段候诊曲线；诊室一览每行加"平均等候"条
画面都是"叫号瞬间"（09:42:18，216 诊室刚叫 A102），便于四种风格横向比较。
"""

import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import draft as v1  # noqa: E402  数据与时间格式沿用 v1

ROOT = v1.ROOT
OUT = v1.OUT
FONT_DIR = v1.FONT_DIR
SONGTI = "/System/Library/Fonts/Supplemental/Songti.ttc"  # 黑金版标题用宋体（实现时需换成网页字体，如思源宋体子集）
S = 2
W_, H_ = 1920, 1080
STATUS = v1.STATUS

# 版面网格（1 倍坐标）
LX0, LX1 = 40, 410  # 左栏
CX0, CX1 = 430, 1490  # 中栏
RX0, RX1 = 1510, 1880  # 右栏
TOP = 96
SY0, SY1 = 204, 870  # 三维舞台
HEAD = 186  # 舞台顶到诊室后墙顶留给状态柱和标签的高度
UNIT = 5.5  # 状态柱每人多高

# 各诊室平均等候（分钟，演示数据）
AVG_WAIT = {"213": 14, "214": 22, "215": 26, "216": 31, "217": 19, "218": 24, "219": 28, "220": 17}
# 分时段候诊人数（分钟自 08:00 起，人数）；09:42 之后是预测，画虚线
TREND = [(0, 12), (15, 26), (30, 41), (45, 52), (60, 63), (75, 70), (90, 72), (102, 70)]
FORECAST = [(102, 70), (120, 66), (150, 58), (180, 44), (210, 26), (240, 8)]


# ---------------------------------------------------------------- 四种风格
def hx(c, a=1.0):
    """'#RRGGBB' → (r, g, b, a)；a 为 0–1"""
    c = c.lstrip("#")
    return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16), int(a * 255))


THEMES = {
    "b": dict(
        name="B 医疗青绿 · 玻璃拟态", out="11-style-b-glass.png", dark=False, style="glass",
        # AI 图：诊室分隔墙 x、门中心 x、后墙顶 y、室内地面下沿 y、门前地面 y、内容左右边界、楼板底 y
        ai="ai-scene-b-glass.png", walls=[234, 365, 497, 630, 759, 889, 1021, 1150, 1285],
        doors=[246, 384, 520, 655, 790, 922, 1054, 1186], top=233, floor=388, door_y=512, cx=(25, 1500), bottom=835,
        bg=("#E6F4F1", "#F6FBFA"), ink="#0F2A2A", sub="#4F6B69", faint="#8AA19E",
        brand="#0E9F9A", brand2="#19B9A2", brand_ink="#FFFFFF", brand_sub="#D2F4EF",
        call="#FF7A1A", call_deep="#E2600A", call_ink="#FFFFFF", call_tint=hx("#FFE3CF", 0.92),
        wait="#2F7BEA", recheck="#8B5CF6", missed="#E5487D", busy="#10A37F", over="#C27C0E",
        track=hx("#0E9F9A", 0.12), card=hx("#FFFFFF", 0.66), line=hx("#FFFFFF", 0.95), title_font="title",
    ),
    "c": dict(
        name="C 全息线框孪生", out="12-style-c-holo.png", dark=True, style="holo",
        ai="ai-scene-c-holo.png", walls=[274, 396, 514, 639, 764, 889, 1011, 1133, 1255],
        doors=[286, 411, 539, 671, 792, 930, 1061, 1189], top=311, floor=500, door_y=520, cx=(10, 1530), bottom=850,
        bg=("#02070F", "#071528"), ink="#E6F7FF", sub="#8FB4C8", faint="#4F7086",
        brand="#22D3EE", brand2="#3B82F6", brand_ink="#021018", brand_sub="#9BE7F5",
        call="#FF8A3D", call_deep="#FF7A26", call_ink="#FFFFFF", call_tint=hx("#FF8A3D", 0.16),
        wait="#38BDF8", recheck="#A78BFA", missed="#FB7185", busy="#34D399", over="#FBBF24",
        track=hx("#22D3EE", 0.14), card=hx("#071C2E", 0.62), line=hx("#22D3EE", 0.38), title_font="title",
    ),
    "e": dict(
        name="E 缤纷等距插画", out="13-style-e-candy.png", dark=False, style="candy",
        ai="ai-scene-e-candy.png", walls=[210, 351, 490, 629, 767, 906, 1045, 1186, 1325],
        doors=[239, 381, 520, 665, 810, 945, 1091, 1236], top=246, floor=405, door_y=505, cx=(30, 1510), bottom=895,
        bg=("#ECE6FF", "#E4DCFD"), ink="#231942", sub="#5E548E", faint="#9A8CC4", outline="#231942",
        brand="#6C5CE7", brand2="#8E7CF8", brand_ink="#FFFFFF", brand_sub="#E2DCFF",
        call="#FF7A00", call_deep="#E55B00", call_ink="#FFFFFF", call_tint=hx("#FFE1C2"),
        wait="#3B82F6", recheck="#A855F7", missed="#F43F5E", busy="#10B981", over="#D97706",
        track=hx("#6C5CE7", 0.12), card=hx("#FFFFFF"), line=hx("#231942"), title_font="title",
        # 与 AI 图里诊室地面颜色一致：内分泌黄、神经内科紫、消化绿、呼吸蓝、心内粉
        dept=["#FFE27A", "#D9B8FF", "#9EE6C0", "#9EE6C0", "#9CCBFF", "#9CCBFF", "#FFA8A0", "#FFA8A0"],
    ),
    "f": dict(
        name="F 黑金高端", out="14-style-f-gold.png", dark=True, style="gold",
        ai="ai-scene-f-gold.png", walls=[248, 392, 514, 635, 757, 878, 997, 1115, 1237],
        doors=[264, 408, 542, 670, 798, 926, 1054, 1179], top=196, floor=381, door_y=478, cx=(15, 1525), bottom=850,
        bg=("#0B0C0E", "#17171A"), ink="#F3EDE2", sub="#A79F92", faint="#6E675D",
        brand="#D4AF6A", brand2="#B8924A", brand_ink="#141210", brand_sub="#E9D7AE",
        call="#F2C66D", call_deep="#F5B83D", call_ink="#17130A", call_tint=hx("#F2C66D", 0.14),
        wait="#8FB3E0", recheck="#B9A0E0", missed="#E08A9B", busy="#7FC8A9", over="#D98C5F",
        track=hx("#D4AF6A", 0.14), card=hx("#151518", 0.86), line=hx("#D4AF6A", 0.36), title_font="serif",
    ),
}


# ---------------------------------------------------------------- 画笔
def font(kind, size):
    if kind == "serif":
        return ImageFont.truetype(SONGTI, int(size * S), index=1)  # Songti SC Bold
    path = {"title": "AlimamaShuHeiTi-Bold.ttf", "body": "SourceHanSansCN-Regular.otf", "num": "DIN-Bold.otf"}[kind]
    return ImageFont.truetype(os.path.join(FONT_DIR, path), int(size * S))


def col(c):
    return hx(c) if isinstance(c, str) else c


class Pen:
    """按 1 倍坐标作画（内部乘 S），填充色可带透明度，叠加时按透明度混合"""

    def __init__(self, im):
        self.im = im
        self.d = ImageDraw.Draw(im, "RGBA")

    def rect(self, x0, y0, x1, y1, fill=None, outline=None, w=1):
        self.d.rectangle([x0 * S, y0 * S, x1 * S - 1, y1 * S - 1], fill=fill and col(fill),
                         outline=outline and col(outline), width=int(w * S))

    def rrect(self, x0, y0, x1, y1, r, fill=None, outline=None, w=1):
        self.d.rounded_rectangle([x0 * S, y0 * S, x1 * S - 1, y1 * S - 1], radius=r * S, fill=fill and col(fill),
                                 outline=outline and col(outline), width=int(w * S))

    def ellipse(self, x0, y0, x1, y1, fill=None, outline=None, w=1):
        self.d.ellipse([x0 * S, y0 * S, x1 * S, y1 * S], fill=fill and col(fill), outline=outline and col(outline), width=int(w * S))

    def poly(self, pts, fill=None, outline=None, w=1):
        self.d.polygon([(x * S, y * S) for x, y in pts], fill=fill and col(fill), outline=outline and col(outline),
                       width=int(w * S))

    def line(self, pts, fill, w=1):
        self.d.line([(x * S, y * S) for x, y in pts], fill=col(fill), width=max(1, int(w * S)), joint="curve")

    def arc(self, box, a0, a1, fill, w):
        self.d.arc([v * S for v in box], a0, a1, fill=col(fill), width=int(w * S))

    def text(self, x, y, s, kind, size, fill, anchor="la"):
        self.d.text((x * S, y * S), s, font=font(kind, size), fill=col(fill), anchor=anchor)

    def tw(self, s, kind, size):
        b = self.d.textbbox((0, 0), s, font=font(kind, size), anchor="ls")
        return (b[2] - b[0]) / S

    def run(self, x, base, parts):
        """混排一行：parts = [(文字, 字体, 字号, 颜色, 后间距)]，按基线对齐，返回结束 x"""
        for s, kind, size, c, gap in parts:
            self.text(x, base, s, kind, size, c, anchor="ls")
            x += self.tw(s, kind, size) + gap
        return x


class Canvas(Pen):
    def glow(self, fn, blur=6, times=1):
        """在单独图层上画（fn 接收一支 Pen），模糊后叠回来，用来做发光"""
        layer = Image.new("RGBA", self.im.size, (0, 0, 0, 0))
        fn(Pen(layer))
        layer = layer.filter(ImageFilter.GaussianBlur(blur * S))
        for _ in range(times):
            self.im.paste(layer, (0, 0), layer)

    def shadow(self, x0, y0, x1, y1, r, c, blur, dy=0, dx=0):
        self.glow(lambda p: p.rrect(x0 + dx, y0 + dy, x1 + dx, y1 + dy, r, fill=c), blur)

    def grad(self, x0, y0, x1, y1, c0, c1, vertical=False, r=0):
        """渐变矩形（可圆角），c0 → c1 从左到右或从上到下"""
        w, h = int((x1 - x0) * S), int((y1 - y0) * S)
        a, b = np.array(col(c0), float), np.array(col(c1), float)
        tt = np.linspace(0, 1, h if vertical else w)
        g = a[None, :] * (1 - tt[:, None]) + b[None, :] * tt[:, None]
        arr = np.repeat(g[:, None, :], w, 1) if vertical else np.repeat(g[None, :, :], h, 0)
        patch = Image.fromarray(arr.astype(np.uint8), "RGBA")
        if r:
            m = Image.new("L", (w, h), 0)
            ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], radius=r * S, fill=255)
            patch.putalpha(Image.fromarray((np.array(patch.getchannel("A"), float) * np.array(m, float) / 255).astype(np.uint8)))
        self.im.paste(patch, (int(x0 * S), int(y0 * S)), patch)


def speaker(p, x, y, s, c):
    k = s / 24
    p.rect(x + 2 * k, y + 9 * k, x + 7 * k, y + 15 * k, c)
    p.poly([(x + 7 * k, y + 9 * k), (x + 13 * k, y + 4 * k), (x + 13 * k, y + 20 * k), (x + 7 * k, y + 15 * k)], c)
    p.arc([x + 9 * k, y + 7 * k, x + 19 * k, y + 17 * k], -55, 55, c, 2 * k)
    p.arc([x + 7 * k, y + 3 * k, x + 23 * k, y + 21 * k], -55, 55, c, 2 * k)


# ---------------------------------------------------------------- 背景与卡片（每种风格的"皮肤"）
def background(t):
    w, h = W_ * S, H_ * S
    a, b = np.array(hx(t["bg"][0]), float), np.array(hx(t["bg"][1]), float)
    yy, xx = np.mgrid[0:h, 0:w]
    if t["dark"]:
        # 暗色：中间亮、四周暗的径向渐变
        d = np.sqrt(((xx - w * 0.5) / (w * 0.62)) ** 2 + ((yy - h * 0.45) / (h * 0.75)) ** 2).clip(0, 1)
        m = 1 - d
    else:
        m = (yy / h)[..., None][..., 0]
    arr = a[None, None, :] * (1 - m[..., None]) + b[None, None, :] * m[..., None]
    im = Image.fromarray(arr.astype(np.uint8), "RGBA").convert("RGB")
    cv = Canvas(im)
    st = t["style"]
    if st == "holo":
        # 细网格 + 扫描线
        for x in range(0, W_, 48):
            cv.rect(x, 0, x + 1, H_, hx("#22D3EE", 0.035))
        for y in range(0, H_, 48):
            cv.rect(0, y, W_, y + 1, hx("#22D3EE", 0.035))
        for y in range(0, H_, 4):
            cv.rect(0, y, W_, y + 1, hx("#000000", 0.10))
    elif st == "glass":
        # 两团柔光，让毛玻璃有东西可"透"
        cv.glow(lambda p: (p.ellipse(-200, 600, 700, 1300, fill=hx("#7FD9C8", 0.35)),
                           p.ellipse(1300, -300, 2200, 500, fill=hx("#9FD4F5", 0.30))), blur=120)
    elif st == "candy":
        cv.glow(lambda p: (p.ellipse(-160, 700, 520, 1300, fill=hx("#FFC7E8", 0.55)),
                           p.ellipse(1500, -200, 2150, 420, fill=hx("#B8E6FF", 0.55)),
                           p.ellipse(1180, 820, 1700, 1250, fill=hx("#FFE9A8", 0.45))), blur=90)
    elif st == "gold":
        cv.glow(lambda p: p.ellipse(560, -260, 1360, 260, fill=hx("#D4AF6A", 0.10)), blur=120)
    return cv


def corners(p, x0, y0, x1, y1, c, n=14, w=2):
    """四角折线角标"""
    for (x, y, sx, sy) in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)):
        p.line([(x, y + sy * n), (x, y), (x + sx * n, y)], c, w)


def card(cv, t, x0, y0, x1, y1, title=None, note=None, accent=None, note_color=None):
    """面板。返回标题下方内容起点 y"""
    st = t["style"]
    accent = accent or t["brand"]
    end = x1 - 20 - (cv.tw(note, "body", 13) + 14 if note else 0)  # 标题装饰线的终点（给右侧注释让位）
    if st == "glass":
        cv.shadow(x0, y0, x1, y1, 16, hx("#0E5C58", 0.12), 14, dy=8)
        cv.rrect(x0, y0, x1, y1, 16, fill=t["card"], outline=t["line"], w=1.2)
        if title:
            cv.rrect(x0 + 20, y0 + 21, x0 + 25, y0 + 41, 2.5, fill=accent)
            cv.text(x0 + 34, y0 + 39, title, "title", 19, t["ink"], anchor="ls")
    elif st == "holo":
        cv.rect(x0, y0, x1, y1, fill=t["card"], outline=t["line"], w=1)
        corners(cv, x0, y0, x1, y1, t["brand"], 12, 2)
        if title:
            cv.rect(x0 + 18, y0 + 24, x0 + 26, y0 + 32, fill=accent)
            cv.text(x0 + 34, y0 + 37, title, "title", 18, t["ink"], anchor="ls")
            xe = x0 + 34 + cv.tw(title, "title", 18) + 12
            cv.rect(xe, y0 + 30, end - 34, y0 + 31, hx("#22D3EE", 0.25))
            for k in range(3):
                xs = end - 26 + k * 9
                cv.poly([(xs, y0 + 34), (xs + 5, y0 + 26), (xs + 8, y0 + 26), (xs + 3, y0 + 34)], hx("#22D3EE", 0.75))
    elif st == "candy":
        cv.rrect(x0 + 5, y0 + 5, x1 + 5, y1 + 5, 18, fill=t["outline"])
        cv.rrect(x0, y0, x1, y1, 18, fill=t["card"], outline=t["outline"], w=2.5)
        if title:
            w = cv.tw(title, "title", 17) + 26
            cv.rrect(x0 + 16, y0 + 14, x0 + 16 + w, y0 + 44, 15, fill=accent, outline=t["outline"], w=2)
            cv.text(x0 + 16 + w / 2, y0 + 30, title, "title", 17, "#FFFFFF", anchor="mm")
    elif st == "gold":
        cv.rect(x0, y0, x1, y1, fill=t["card"], outline=t["line"], w=1)
        corners(cv, x0 - 1, y0 - 1, x1 + 1, y1 + 1, t["brand"], 9, 1.5)
        if title:
            cv.poly([(x0 + 22, y0 + 31), (x0 + 27, y0 + 26), (x0 + 32, y0 + 31), (x0 + 27, y0 + 36)], accent)
            cv.text(x0 + 40, y0 + 39, title, "serif", 20, t["brand"], anchor="ls")
            xe = x0 + 40 + cv.tw(title, "serif", 20) + 12
            cv.rect(xe, y0 + 31, end, y0 + 32, hx("#D4AF6A", 0.28))
    if note:
        cv.text(x1 - 20, y0 + 38, note, "body", 13, note_color or t["faint"], anchor="rs")
    return y0 + 56


def chip(cv, t, x, y, s, size, fg, bg, pad=8, h=None, anchor="l", outline=None):
    w = cv.tw(s, "body", size) + pad * 2
    h = h or size + 10
    x0 = {"l": x, "r": x - w, "c": x - w / 2}[anchor]
    if t["style"] == "candy":
        cv.rrect(x0, y, x0 + w, y + h, h / 2, fill=bg, outline=outline or t["outline"], w=1.6)
    else:
        cv.rrect(x0, y, x0 + w, y + h, h / 2 if t["style"] != "holo" else 3, fill=bg)
    cv.text(x0 + w / 2, y + h / 2 + 1, s, "body", size, fg, anchor="mm")
    return x0, x0 + w


# ---------------------------------------------------------------- 顶栏（居中大标题 + 装饰）
def header(cv, t, now):
    st = t["style"]
    title = "××医院 · 内科候诊区"
    tf = t["title_font"]
    if st == "glass":
        cv.shadow(660, 14, 1260, 74, 30, hx("#0E5C58", 0.14), 12, dy=6)
        cv.rrect(660, 14, 1260, 74, 30, fill=hx("#FFFFFF", 0.72), outline=hx("#FFFFFF", 1), w=1.2)
        cv.grad(760, 70, 960, 74, hx(t["brand"], 0), hx(t["brand"], 1))
        cv.grad(960, 70, 1160, 74, hx(t["brand"], 1), hx(t["brand"], 0))
        cv.text(960, 56, title, tf, 32, t["ink"], anchor="ms")
    elif st == "holo":
        pts = [(560, 8), (1360, 8), (1320, 70), (600, 70)]
        cv.poly(pts, fill=hx("#0B2A44", 0.55))
        cv.glow(lambda p: p.line(pts + [pts[0]], t["brand"], 2), blur=4)
        cv.line(pts + [pts[0]], t["brand"], 1.4)
        for sgn in (-1, 1):
            xa = 960 + sgn * 400
            cv.line([(xa, 8), (960 + sgn * 900, 8), (960 + sgn * 920, 24)], hx("#22D3EE", 0.6), 1.2)
            cv.line([(960 + sgn * 380, 70), (960 + sgn * 470, 70)], t["brand"], 3)
        cv.glow(lambda p: p.text(960, 52, title, tf, 32, t["brand"], anchor="ms"), blur=6)
        cv.text(960, 52, title, tf, 32, "#EFFFFF", anchor="ms")
    elif st == "candy":
        cv.rrect(655, 16, 1275, 78, 31, fill=t["outline"])
        cv.rrect(650, 11, 1270, 73, 31, fill=t["brand"], outline=t["outline"], w=3)
        for k, c in enumerate(("#FFE27A", "#9EE6C0", "#9CCBFF", "#FFA8A0")):
            cv.ellipse(676 + k * 16, 36, 688 + k * 16, 48, fill=c, outline=t["outline"], w=1.5)
            cv.ellipse(1232 - k * 16, 36, 1244 - k * 16, 48, fill=c, outline=t["outline"], w=1.5)
        cv.text(960, 55, title, tf, 32, "#FFFFFF", anchor="ms")
    elif st == "gold":
        cv.text(960, 52, title, tf, 34, t["brand"], anchor="ms")
        tw = cv.tw(title, tf, 34) / 2
        for sgn in (-1, 1):
            xa = 960 + sgn * (tw + 24)
            cv.line([(xa, 40), (960 + sgn * 470, 40)], hx("#D4AF6A", 0.55), 1)
            cv.poly([(xa, 34), (xa + sgn * 6, 40), (xa, 46), (xa - sgn * 6, 40)], t["brand"])
        cv.text(960, 76, "INTERNAL MEDICINE  ·  WAITING HALL", "body", 11, hx("#D4AF6A", 0.7), anchor="ms")
    # 左：楼层 / 出诊时段；右：语音开关 + 日期 + 时钟
    cv.text(LX0, 50, "门诊医技综合楼 2F", "body", 17, t["ink"], anchor="ls")
    cv.text(LX0, 72, "上午门诊 08:00–12:00  ·  8 个诊室", "body", 14, t["sub"], anchor="ls")
    clock = v1.hms(now, sec=True)
    cv.text(RX1, 58, clock, "num", 34, t["ink"], anchor="rs")
    x = RX1 - cv.tw(clock, "num", 34) - 18
    cv.text(x, 56, "10月17日 周六", "body", 16, t["sub"], anchor="rs")
    x -= cv.tw("10月17日 周六", "body", 16) + 20
    w = 128
    bg = {"glass": hx("#FFFFFF", 0.7), "holo": hx("#22D3EE", 0.12), "candy": hx("#FFFFFF"), "gold": hx("#D4AF6A", 0.12)}[st]
    if st == "candy":
        cv.rrect(x - w, 30, x, 64, 17, fill=bg, outline=t["outline"], w=2)
    else:
        cv.rrect(x - w, 30, x, 64, 17, fill=bg)
    speaker(cv, x - w + 12, 35, 24, t["brand"])
    cv.text(x - w + 42, 53, "语音已开启", "body", 14, t["brand"] if st != "candy" else t["ink"], anchor="ls")


# ---------------------------------------------------------------- 叫号条
def call_banner(cv, t, r, n_call):
    x0, y0, x1, y1 = CX0, TOP, CX1, 200
    st = t["style"]
    fg, sub = "#FFFFFF", t["brand_sub"]
    if st == "glass":
        cv.shadow(x0, y0, x1, y1, 18, hx("#0E9F9A", 0.35), 16, dy=10)
        cv.grad(x0, y0, x1, y1, t["brand"], t["brand2"], r=18)
        cv.grad(x0, y0, x1, y0 + 52, hx("#FFFFFF", 0.18), hx("#FFFFFF", 0), vertical=True, r=18)
    elif st == "holo":
        cv.rect(x0, y0, x1, y1, fill=hx("#06223A", 0.8), outline=hx("#22D3EE", 0.6), w=1.2)
        cv.glow(lambda p: p.rect(x0, y0, x1, y1, outline=t["brand"], w=2), blur=8)
        corners(cv, x0 - 3, y0 - 3, x1 + 3, y1 + 3, t["brand"], 18, 2.5)
        for yy in range(y0 + 2, y1, 4):
            cv.rect(x0 + 1, yy, x1 - 1, yy + 1, hx("#22D3EE", 0.04))
        fg, sub = "#EFFFFF", t["sub"]
    elif st == "candy":
        cv.rrect(x0 + 6, y0 + 6, x1 + 6, y1 + 6, 20, fill=t["outline"])
        cv.rrect(x0, y0, x1, y1, 20, fill=t["brand"], outline=t["outline"], w=3)
    elif st == "gold":
        cv.rect(x0, y0, x1, y1, fill=hx("#121214", 0.95), outline=hx("#D4AF6A", 0.8), w=1)
        cv.rect(x0 + 5, y0 + 5, x1 - 5, y1 - 5, outline=hx("#D4AF6A", 0.3), w=1)
        fg, sub = t["ink"], t["sub"]
    icon = t["call"] if st in ("holo", "gold") else "#FFFFFF"
    speaker(cv, x0 + 28, y0 + 26, 34, icon)
    cv.text(x0 + 46, y0 + 86, "正在叫号", "body", 15, sub, anchor="ms")
    cv.rect(x0 + 92, y0 + 22, x0 + 93, y1 - 22, hx("#FFFFFF", 0.3) if not t["dark"] else hx(t["brand"], 0.35))
    no, nm, _ = r["cur"]
    base = y0 + 64
    name_font = "serif" if st == "gold" else "title"
    x = cv.run(x0 + 118, base, [("请", "body", 30, fg, 14), (no, "num", 46, fg, 14),
                                 (nm, name_font, 40, fg, 16), ("到", "body", 30, fg, 12)])
    w = cv.tw(r["no"], "num", 44) + cv.tw("诊室", "title", 32) + 34
    if st == "glass":
        cv.shadow(x, y0 + 16, x + w, y0 + 78, 10, hx("#FF7A1A", 0.55), 10, dy=4)
        cv.rrect(x, y0 + 16, x + w, y0 + 78, 10, fill=t["call"])
    elif st == "holo":
        cv.glow(lambda p: p.rect(x, y0 + 16, x + w, y0 + 78, fill=t["call"]), blur=10)
        cv.rect(x, y0 + 16, x + w, y0 + 78, fill=t["call"])
    elif st == "candy":
        cv.rrect(x + 4, y0 + 20, x + w + 4, y0 + 82, 12, fill=t["outline"])
        cv.rrect(x, y0 + 16, x + w, y0 + 78, 12, fill=t["call"], outline=t["outline"], w=2.5)
    elif st == "gold":
        cv.glow(lambda p: p.rect(x, y0 + 16, x + w, y0 + 78, fill=t["call"]), blur=12)
        cv.rect(x, y0 + 16, x + w, y0 + 78, fill=t["call"])
    cv.run(x + 14, base + 1, [(r["no"], "num", 44, t["call_ink"], 6), ("诊室", "title", 32, t["call_ink"], 0)])
    cv.run(x + w + 12, base, [("就诊", "body", 30, fg, 0)])
    cv.text(x0 + 118, y1 - 16, f"{r['dept']}  ·  {r['doctor']} {r['title']}", "body", 16, sub, anchor="ls")
    pill_bg = {"glass": hx("#FFFFFF"), "holo": hx(t["call"]), "candy": hx("#FFFFFF"), "gold": hx(t["call"])}[st]
    pill_fg = {"glass": t["brand"], "holo": "#FFFFFF", "candy": t["ink"], "gold": t["call_ink"]}[st]
    chip(cv, t, x1 - 24, y0 + 22, f"第 {n_call} 次呼叫", 15, pill_fg, pill_bg, pad=12, h=28, anchor="r")
    nx_no, nx_nm = r["wait_list"][0]
    s = f"下一位  {nx_no} {nx_nm}"
    cv.run(x1 - 24 - cv.tw(s, "body", 16) - 4, y1 - 16,
           [("下一位  ", "body", 16, sub, 0), (nx_no, "num", 17, fg, 4), (nx_nm, "body", 16, fg, 0)])


# ---------------------------------------------------------------- 三维舞台
def place_scene(cv, t, focus=None, zoom=1.0):
    """把 AI 图缩放后贴进舞台：后墙顶对齐舞台顶下方 HEAD 处，内容左右居中，四边羽化。返回 AI → 画面坐标的函数"""
    ai = Image.open(os.path.join(OUT, "draft", t["ai"])).convert("RGBA")
    sw, sh = CX1 - CX0, SY1 - SY0
    c0, c1 = t["cx"]
    s = min(sw / (c1 - c0), (sh - HEAD) / (t["bottom"] - t["top"])) * zoom
    ox = ((c0 + c1) / 2 if focus is None else focus) - sw / 2 / s  # 舞台左边对应的 AI x
    oy = t["top"] - HEAD / s  # 舞台上边对应的 AI y
    big = ai.resize((int(ai.width * s * S), int(ai.height * s * S)), Image.Resampling.LANCZOS)
    m = Image.new("L", big.size, 0)
    e = int(26 * S)
    ImageDraw.Draw(m).rectangle([e, e, big.width - e, big.height - e], fill=255)
    big.putalpha(m.filter(ImageFilter.GaussianBlur(e / 2)))
    layer = Image.new("RGBA", (sw * S, sh * S), (0, 0, 0, 0))
    dx, dy = int(-ox * s * S), int(-oy * s * S)  # AI 图左上角在舞台图层里的位置（可能为负，负的部分裁掉）
    sx, sy = max(0, -dx), max(0, -dy)
    dst = (max(0, dx), max(0, dy))
    part = big.crop((sx, sy, sx + min(layer.width - dst[0], big.width - sx), sy + min(layer.height - dst[1], big.height - sy)))
    layer.alpha_composite(part, dst)
    # 舞台四边再羽化一次，和页面底色融在一起
    m2 = Image.new("L", layer.size, 0)
    e2 = int(30 * S)
    ImageDraw.Draw(m2).rectangle([e2, e2, layer.width - e2, layer.height - e2], fill=255)
    m2 = m2.filter(ImageFilter.GaussianBlur(e2 / 2))
    a = np.array(layer.getchannel("A"), float) * np.array(m2, float) / 255
    layer.putalpha(Image.fromarray(a.astype(np.uint8)))
    cv.im.paste(layer, (CX0 * S, SY0 * S), layer)
    return lambda ax, ay: (CX0 + (ax - ox) * s, SY0 + (ay - oy) * s), s


def called_fx(cv, t, P, s, i):
    """被叫诊室：室内染色 + 冲天光柱 + 门前光环"""
    w = t["walls"]
    xa, ya = P(w[i] + 4, t["top"])
    xb, yb = P(w[i + 1] - 4, t["floor"])
    a_room = 0.26 if t["dark"] else 0.30
    cv.rect(xa, ya, xb, yb, fill=hx(t["call"], a_room))
    # 光柱：从后墙顶往上渐隐到舞台顶
    cv.grad(xa, SY0 + 6, xb, ya, hx(t["call"], 0), hx(t["call"], 0.55 if t["dark"] else 0.42), vertical=True)
    cv.glow(lambda p: p.rect(xa + 6, SY0 + 40, xb - 6, ya, fill=hx(t["call"], 0.35)), blur=14)
    for xx in (xa, xb):
        cv.grad(xx - 1, SY0 + 20, xx + 1, ya, hx(t["call"], 0), hx(t["call"], 0.9), vertical=True)
    # 门前两圈光环
    cx, cy = P(t["doors"][i], t["door_y"])
    for rx, a in ((52, 0.55), (34, 0.95)):
        ry = rx * 0.34
        cv.ellipse(cx - rx, cy - ry, cx + rx, cy + ry, fill=hx(t["call"], 0.12), outline=hx(t["call"], a), w=2.4)
    cv.glow(lambda p: p.ellipse(cx - 40, cy - 14, cx + 40, cy + 14, fill=hx(t["call"], 0.6)), blur=10)


def column(cv, t, cx, base, counts):
    """三色状态柱：自下而上 待诊 / 复诊 / 过诊，柱高 = 人数 × UNIT；返回柱顶 y"""
    fw, dx, dy = 9, 7, -5  # 半宽、侧面错开
    y = base
    segs = [(t[k], n * UNIT) for (k, _), n in zip(STATUS, counts) if n]

    def shade(c, f):
        r, g, b, a = hx(c)
        return (int(r * f), int(g * f), int(b * f), 255)

    def lighten(c, f):
        r, g, b, a = hx(c)
        return (int(r + (255 - r) * f), int(g + (255 - g) * f), int(b + (255 - b) * f), 255)

    # 柱脚光盘
    cv.ellipse(cx - 18, base - 6, cx + 24, base + 6, fill=hx(t["brand"], 0.28 if t["dark"] else 0.22))
    if t["dark"]:
        hs = sum(h for _, h in segs)
        cv.glow(lambda p: p.rect(cx - fw - 2, base - hs, cx + fw + dx + 2, base, fill=hx(segs[0][0], 0.75)), blur=10)
    ol = t.get("outline") if t["style"] == "candy" else None
    for c, h in segs:
        top = y - h
        cv.poly([(cx + fw, y), (cx + fw + dx, y + dy), (cx + fw + dx, top + dy), (cx + fw, top)], shade(c, 0.72), outline=ol)
        cv.rect(cx - fw, top, cx + fw, y, fill=c, outline=ol, w=1.4 if ol else 1)
        y = top
    cv.poly([(cx - fw, y), (cx + fw, y), (cx + fw + dx, y + dy), (cx - fw + dx, y + dy)], lighten(segs[-1][0], 0.45), outline=ol)
    return y + dy


def room_label(cv, t, cx, bottom, r, called):
    """柱顶标签：房间号 + 三个人数；被叫诊室换成叫号色并加"叫号中"小签"""
    counts = [len(r["wait_list"]), len(r["recheck_list"]), len(r["missed_list"])]
    st = t["style"]
    w, h = (88, 52) if called else (78, 46)
    x0, y0 = cx - w / 2, bottom - h
    if called:
        bg, numc = t["call"], t["call_ink"]
    else:
        bg = {"glass": hx("#FFFFFF", 0.92), "holo": hx("#04192B", 0.85), "candy": hx("#FFFFFF"), "gold": hx("#121214", 0.92)}[st]
        numc = {"glass": t["ink"], "holo": "#EFFFFF", "candy": t["ink"], "gold": t["brand"]}[st]
    if st == "glass":
        cv.shadow(x0, y0, x0 + w, y0 + h, 10, hx("#0E5C58", 0.18), 6, dy=4)
        cv.rrect(x0, y0, x0 + w, y0 + h, 10, fill=bg, outline=None if called else hx(t["brand"], 0.35), w=1)
    elif st == "holo":
        if called:
            cv.glow(lambda p: p.rect(x0, y0, x0 + w, y0 + h, fill=t["call"]), blur=10)
        cv.rect(x0, y0, x0 + w, y0 + h, fill=bg, outline=None if called else hx(t["brand"], 0.7), w=1)
        corners(cv, x0, y0, x0 + w, y0 + h, "#FFFFFF" if called else t["brand"], 6, 1.5)
    elif st == "candy":
        cv.rrect(x0 + 3, y0 + 3, x0 + w + 3, y0 + h + 3, 12, fill=t["outline"])
        cv.rrect(x0, y0, x0 + w, y0 + h, 12, fill=bg, outline=t["outline"], w=2.2)
    elif st == "gold":
        if called:
            cv.glow(lambda p: p.rect(x0, y0, x0 + w, y0 + h, fill=t["call"]), blur=10)
        cv.rect(x0, y0, x0 + w, y0 + h, fill=bg, outline=None if called else hx("#D4AF6A", 0.6), w=1)
    cv.text(cx, y0 + (24 if called else 21), r["no"], "num", 21 if called else 19, numc, anchor="ms")
    gap = 13
    parts = [(str(v), t[k] if not called else t["call_ink"]) for (k, _), v in zip(STATUS, counts)]
    size = 15 if called else 14
    tot = sum(cv.tw(s_, "num", size) for s_, _ in parts) + gap * 2
    xs = cx - tot / 2
    dot = t["call_ink"] if called else t["faint"]
    for k, (s_, c) in enumerate(parts):
        cv.text(xs, y0 + h - 9, s_, "num", size, c, anchor="ls")
        xs += cv.tw(s_, "num", size)
        if k < 2:
            cv.ellipse(xs + gap / 2 - 1.6, y0 + h - 15.6, xs + gap / 2 + 1.6, y0 + h - 12.4, fill=dot)
            xs += gap
    if called:
        chip(cv, t, cx, y0 - 30, "叫号中", 14, t["call_ink"] if st == "gold" else "#FFFFFF", t["call_deep"], pad=10, h=24, anchor="c")


def tour_label(cv, t, cx, bottom, r, now):
    w, h = 124, 82
    x0, y0 = cx - w / 2, bottom - h
    cv.rrect(x0 + 4, y0 + 4, x0 + w + 4, y0 + h + 4, 14, fill=t["outline"])
    cv.rrect(x0, y0, x0 + w, y0 + h, 14, fill=t["brand"], outline=t["outline"], w=2.5)
    cv.run(x0 + 12, y0 + 27, [(r["no"], "num", 24, "#FFFFFF", 6), (r["short"], "body", 13, t["brand_sub"], 0)])
    cv.text(x0 + 12, y0 + 49, f"就诊中 {v1.mmss(now - r['start'])}", "body", 13, t["brand_sub"], anchor="ls")
    xs = x0 + 12
    for (k, lab), v in zip(STATUS, [len(r["wait_list"]), len(r["recheck_list"]), len(r["missed_list"])]):
        xs = cv.run(xs, y0 + 72, [(lab[0], "body", 12, t["brand_sub"], 3), (str(v), "num", 16, "#FFFFFF", 9)])


def stage(cv, t, called_idx, tour_idx=None, zoom=1.0, now=None):
    w = t["walls"]
    focus = None if tour_idx is None else (w[tour_idx] + w[tour_idx + 1]) / 2
    P, s = place_scene(cv, t, focus, zoom)
    if tour_idx is not None:
        xa, ya = P(w[tour_idx] + 3, t["top"])
        xb, yb = P(w[tour_idx + 1] - 3, t["floor"])
        cv.rect(xa, ya, xb, yb, fill=hx(t["brand"], 0.12), outline=t["brand"], w=3.5)
    called_fx(cv, t, P, s, called_idx)
    for i, r in enumerate(v1.ROOMS):
        cx, top = P((w[i] + w[i + 1]) / 2, t["top"])
        if not (CX0 + 50 < cx < CX1 - 50):
            continue
        counts = [len(r["wait_list"]), len(r["recheck_list"]), len(r["missed_list"])]
        ytop = column(cv, t, cx, top - 6, counts)
        if i == tour_idx:
            tour_label(cv, t, cx, ytop - 8, r, now)
        else:
            room_label(cv, t, cx, ytop - 8, r, i == called_idx)
    # 图例（舞台右上）
    x, y = CX1 - 18, SY0 + 10
    for lab, k in (("叫号中", "call"), ("过诊", "missed"), ("复诊", "recheck"), ("待诊", "wait")):
        x -= cv.tw(lab, "body", 14)
        cv.text(x, y + 14, lab, "body", 14, t["sub"], anchor="ls")
        x -= 16
        cv.rect(x, y + 3, x + 10, y + 13, fill=t[k], outline=t.get("outline") if t["style"] == "candy" else None)
        x -= 16
    cv.text(CX1 - 18, y + 36, "柱高 = 人数（自下而上：待诊 · 复诊 · 过诊）", "body", 12, t["faint"], anchor="rs")


# ---------------------------------------------------------------- 左栏
def overview(cv, t):
    x0, y0, x1, y1 = LX0, TOP, LX1, 356
    yc = card(cv, t, x0, y0, x1, y1, "候诊概况", "截至 09:42")
    vals = [sum(len(r[k + "_list"]) for r in v1.ROOMS) for k, _ in STATUS] + [sum(r["done"] for r in v1.ROOMS)]
    labs = [("wait", "待诊"), ("recheck", "复诊"), ("missed", "过诊"), ("ink", "已诊")]
    for i, ((k, lab), v) in enumerate(zip(labs, vals)):
        x = x0 + 22 + i * 86
        if t["dark"] and k != "ink":
            cv.glow(lambda p, x=x, v=v, k=k: p.text(x, yc + 40, str(v), "num", 38, t[k], anchor="ls"), blur=6)
        cv.run(x, yc + 40, [(str(v), "num", 38, t[k], 3), ("人", "body", 13, t["sub"], 0)])
        cv.text(x, yc + 62, lab, "body", 14, t["sub"], anchor="ls")
    # 分时段候诊曲线
    gx0, gx1, gy0, gy1 = x0 + 22, x1 - 20, yc + 96, y1 - 34
    cv.text(gx0, yc + 88, "分时段候诊人数", "body", 13, t["sub"], anchor="ls")
    cv.text(gx1, yc + 88, "虚线为预测", "body", 12, t["faint"], anchor="rs")
    for k in range(3):
        yy = gy0 + (gy1 - gy0) * k / 2
        cv.rect(gx0, yy, gx1, yy + 1, t["track"])

    def G(m, v):
        return gx0 + (gx1 - gx0) * m / 240, gy1 - (gy1 - gy0) * v / 80

    pts = [G(m, v) for m, v in TREND]
    area = pts + [(pts[-1][0], gy1), (pts[0][0], gy1)]
    cv.poly(area, fill=hx(t["brand"], 0.22 if t["dark"] else 0.18))
    if t["dark"]:
        cv.glow(lambda p: p.line(pts, t["brand"], 3), blur=5)
    cv.line(pts, t["brand"], 2.4)
    fp = [G(m, v) for m, v in FORECAST]
    for a, b in zip(fp, fp[1:]):  # 虚线
        n = 6
        for k in range(n):
            if k % 2 == 0:
                p0 = (a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n)
                p1 = (a[0] + (b[0] - a[0]) * (k + 1) / n, a[1] + (b[1] - a[1]) * (k + 1) / n)
                cv.line([p0, p1], t["faint"], 1.6)
    nx, ny = pts[-1]
    cv.ellipse(nx - 7, ny - 7, nx + 7, ny + 7, fill=hx(t["brand"], 0.25))
    cv.ellipse(nx - 3.5, ny - 3.5, nx + 3.5, ny + 3.5, fill=t["brand"])
    for m, lab in ((0, "08:00"), (60, "09:00"), (120, "10:00"), (180, "11:00"), (240, "12:00")):
        x, _ = G(m, 0)
        cv.text(x, y1 - 16, lab, "num", 11, t["faint"], anchor={0: "ls", 240: "rs"}.get(m, "ms"))


def room_list(cv, t, now, called_idx, tour_idx=None):
    x0, y0, x1, y1 = LX0, 368, LX1, 1044
    yc = card(cv, t, x0, y0, x1, y1, "诊室一览")
    cols = [x1 - 74, x1 - 46, x1 - 18]
    for (k, lab), x in zip(STATUS, cols):
        cv.text(x, yc + 2, lab, "body", 12, t[k], anchor="rs")
    cv.text(x0 + 258, yc + 2, "平均等候", "body", 12, t["faint"], anchor="rs")
    y = yc + 10
    rh = 72
    for i, r in enumerate(v1.ROOMS):
        if i == called_idx:
            if t["style"] == "candy":
                cv.rrect(x0 + 8, y + 2, x1 - 8, y + rh - 2, 12, fill=t["call_tint"], outline=t["call"], w=2)
            elif t["style"] == "glass":
                cv.rrect(x0 + 8, y + 2, x1 - 8, y + rh - 2, 10, fill=t["call_tint"])
                cv.rrect(x0 + 8, y + 12, x0 + 12, y + rh - 12, 2, fill=t["call"])
            else:
                cv.rect(x0 + 1, y + 2, x1 - 1, y + rh - 2, fill=t["call_tint"])
                cv.rect(x0 + 1, y + 2, x0 + 4, y + rh - 2, fill=t["call"])
        elif i == tour_idx:
            cv.rrect(x0 + 8, y + 2, x1 - 8, y + rh - 2, 12, fill=t["brand_sub"], outline=t["brand"], w=2)
        elif i:
            cv.rect(x0 + 18, y, x1 - 18, y + 1, t["track"])
        numc = t["brand"] if t["style"] == "gold" else t["ink"]
        if t["style"] == "candy":
            cv.rrect(x0 + 16, y + 16, x0 + 66, y + 54, 10, fill=t["dept"][i], outline=t["outline"], w=1.8)
            cv.text(x0 + 41, y + 43, r["no"], "num", 21, t["ink"], anchor="ms")
        else:
            cv.text(x0 + 20, y + 44, r["no"], "num", 24, numc, anchor="ls")
        tx = x0 + 76
        cv.run(tx, y + 30, [(r["short"], "body", 15, t["ink"], 6), (r["doctor"], "body", 13, t["sub"], 0)])
        no, nm, kind = r["cur"]
        if i == called_idx:
            cv.run(tx, y + 54, [("叫号中", "body", 13, t["call_deep"], 6), (f"{no} {nm}", "body", 13, t["ink"], 0)])
        else:
            el = now - r["start"]
            cv.ellipse(tx + 1, y + 45, tx + 8, y + 52, fill=t["busy"])
            xx = cv.run(tx + 13, y + 54, [(no, "num", 14, t["ink"], 5)])
            if kind == "复诊":
                xx = chip(cv, t, xx, y + 41, "复诊", 10, "#FFFFFF", t["recheck"], pad=4, h=16)[1] + 5
            cv.text(xx, y + 54, v1.mmss(el), "num", 14, t["over"] if el > 900 else t["sub"], anchor="ls")
        # 平均等候条
        aw = AVG_WAIT[r["no"]]
        bx0, bx1 = x0 + 200, x0 + 258
        cv.run(bx1 - cv.tw(f"{aw}", "num", 15) - cv.tw("分", "body", 11) - 2, y + 34,
               [(str(aw), "num", 15, t["ink"], 2), ("分", "body", 11, t["sub"], 0)])
        cv.rrect(bx0, y + 42, bx1, y + 48, 3, fill=t["track"])
        cv.rrect(bx0, y + 42, bx0 + (bx1 - bx0) * min(1, aw / 40), y + 48, 3, fill=t["over"] if aw >= 30 else t["brand"])
        for (k, _), x in zip(STATUS, cols):
            v = len(r[k + "_list"])
            cv.text(x, y + 45, str(v), "num", 22, t[k] if v else t["faint"], anchor="rs")
        y += rh
    cv.text(x0 + 20, y1 - 14, "复诊优先：每叫 2 位待诊，插叫 1 位复诊", "body", 12, t["faint"], anchor="ls")


# ---------------------------------------------------------------- 中下：最近叫号 + 过号名单
def inner(cv, t, x0, y0, x1, y1, hot=False):
    st = t["style"]
    if st == "glass":
        cv.rrect(x0, y0, x1, y1, 10, fill=t["call_tint"] if hot else hx("#FFFFFF", 0.7))
    elif st == "holo":
        cv.rect(x0, y0, x1, y1, fill=t["call_tint"] if hot else hx("#22D3EE", 0.06), outline=hx(t["call"] if hot else t["brand"], 0.5))
    elif st == "candy":
        cv.rrect(x0, y0, x1, y1, 12, fill=t["call_tint"] if hot else hx("#F4F0FF"), outline=t["outline"], w=1.8)
    elif st == "gold":
        cv.rect(x0, y0, x1, y1, fill=t["call_tint"] if hot else hx("#FFFFFF", 0.03), outline=hx("#D4AF6A", 0.6 if hot else 0.22))
    if hot and st in ("glass", "holo", "gold"):
        cv.rect(x0, y0 + (6 if st == "glass" else 0), x0 + 3, y1 - (6 if st == "glass" else 0), fill=t["call"])


def recent_calls(cv, t, events):
    x0, y0, x1, y1 = CX0, 882, 1150, 1044
    yc = card(cv, t, x0, y0, x1, y1, "最近叫号", "同一号连呼 2 次")
    n = len(events)
    gap = 10
    w = (x1 - x0 - 36 - gap * (n - 1)) / n
    for k, (tm, no, nm, room, dept, state) in enumerate(events):
        x = x0 + 18 + k * (w + gap)
        y = yc - 2
        hot = state == "呼叫中"
        inner(cv, t, x, y, x + w, y1 - 14, hot)
        cv.text(x + 12, y + 22, v1.hms(tm), "num", 15, t["sub"], anchor="ls")
        c = {"呼叫中": t["call_deep"], "已入室": t["busy"], "复诊 · 已入室": t["recheck"], "未到 · 过号": t["missed"]}[state]
        cv.text(x + w - 10, y + 21, state, "body", 12, c, anchor="rs")
        cv.run(x + 12, y + 50, [(no, "num", 17, t["ink"], 5), (nm, "body", 16, t["ink"], 0)])
        cv.run(x + 12, y + 74, [(room, "num", 13, t["sub"], 5), (dept, "body", 12, t["sub"], 0)])


def missed_board(cv, t):
    x0, y0, x1, y1 = 1162, 882, CX1, 1044
    yc = card(cv, t, x0, y0, x1, y1, "过号名单", "请到分诊台重新签到", accent=t["missed"], note_color=t["missed"])
    items = []
    for r in v1.ROOMS:
        for (no, nm), tm in zip(r["missed_list"], r["missed_time"]):
            items.append((tm, no, nm, r["no"]))
    items.sort(reverse=True)
    for k, (tm, no, nm, room) in enumerate(items[:6]):
        x, y = x0 + 20 + (k % 2) * 156, yc + 14 + (k // 2) * 30
        cv.run(x, y, [(no, "num", 15, t["missed"], 5), (nm, "body", 14, t["ink"], 5), (room, "num", 12, t["faint"], 0)])


# ---------------------------------------------------------------- 右栏：被叫诊室详情
def room_detail(cv, t, now, r, i, n_call, mode="called"):
    x0, x1 = RX0, RX1
    st = t["style"]
    cv.text(x0, 116, "诊室轮播", "body", 14, t["sub"], anchor="ls")
    x = x0 + 70
    for k in range(len(v1.ROOMS)):
        on = k == i
        w = 22 if on else 8
        on_c = t["call"] if mode == "called" else t["brand"]
        cv.rrect(x, 106, x + w, 114, 4, fill=on_c if on else t["track"], outline=t.get("outline") if st == "candy" else None)
        x += w + 6
    if mode == "called":
        cv.text(x1, 116, "叫号插播", "body", 14, t["call_deep"], anchor="rs")
    else:
        cv.text(x1, 116, f"{i + 1} / {len(v1.ROOMS)}  ·  5 秒后切换", "body", 14, t["faint"], anchor="rs")

    # 诊室牌
    y0, y1 = 132, 282
    if st == "glass":
        cv.shadow(x0, y0, x1, y1, 16, hx("#0E9F9A", 0.3), 14, dy=8)
        cv.grad(x0, y0, x1, y1, t["brand"], t["brand2"], r=16)
        fg, sub = "#FFFFFF", t["brand_sub"]
    elif st == "holo":
        cv.rect(x0, y0, x1, y1, fill=hx("#06223A", 0.8), outline=hx("#22D3EE", 0.6))
        corners(cv, x0 - 2, y0 - 2, x1 + 2, y1 + 2, t["brand"], 14, 2)
        fg, sub = "#EFFFFF", t["sub"]
    elif st == "candy":
        cv.rrect(x0 + 5, y0 + 5, x1 + 5, y1 + 5, 18, fill=t["outline"])
        cv.rrect(x0, y0, x1, y1, 18, fill=t["dept"][i], outline=t["outline"], w=2.5)
        fg, sub = t["ink"], t["sub"]
    else:
        cv.rect(x0, y0, x1, y1, fill=hx("#121214", 0.95), outline=hx("#D4AF6A", 0.7))
        cv.rect(x0 + 5, y0 + 5, x1 - 5, y1 - 5, outline=hx("#D4AF6A", 0.25))
        fg, sub = t["brand"], t["sub"]
    if t["dark"]:
        cv.glow(lambda p: p.text(x0 + 24, y0 + 74, r["no"], "num", 60, t["brand"], anchor="ls"), blur=8)
    cv.text(x0 + 24, y0 + 74, r["no"], "num", 60, fg, anchor="ls")
    xn = x0 + 24 + cv.tw(r["no"], "num", 60) + 16
    cv.text(xn, y0 + 44, r["dept"], "serif" if st == "gold" else "title", 22, t["ink"] if st != "glass" else "#FFFFFF", anchor="ls")
    cv.text(xn, y0 + 72, f"{r['doctor']}  {r['title']}", "body", 16, sub, anchor="ls")
    cv.rect(x0 + 24, y0 + 96, x1 - 24, y0 + 97, hx("#FFFFFF", 0.35) if st == "glass" else (t["line"] if st != "candy" else hx(t["outline"], 0.4)))
    cv.text(x0 + 24, y0 + 128, "上午 08:00–12:00", "body", 15, sub, anchor="ls")
    s = f"已诊 {r['done']} 人"
    cv.run(x1 - 24 - cv.tw(s, "body", 15) - 6, y0 + 128,
           [("已诊 ", "body", 15, sub, 2), (str(r["done"]), "num", 18, fg if st != "candy" else t["ink"], 2), (" 人", "body", 15, sub, 0)])

    # 叫号中 · 等待入室
    y = 294
    if st == "candy":
        cv.rrect(x0 + 5, y + 5, x1 + 5, y + 133, 18, fill=t["outline"])
        cv.rrect(x0, y, x1, y + 128, 18, fill=t["call_tint"] if mode == "called" else t["card"], outline=t["outline"], w=2.5)
    elif st == "glass":
        cv.rrect(x0, y, x1, y + 128, 16, fill=t["call_tint"])
    else:
        cv.rect(x0, y, x1, y + 128, fill=t["call_tint"], outline=hx(t["call"], 0.6))
        if t["dark"]:
            cv.glow(lambda p: p.rect(x0, y, x0 + 3, y + 128, fill=t["call"]), blur=6)
        cv.rect(x0, y, x0 + 3, y + 128, fill=t["call"])
    no, nm, kind = r["cur"]
    if mode == "called":
        chip(cv, t, x0 + 24, y + 18, "叫号中 · 等待入室", 14, t["call_ink"], t["call"], pad=10, h=26)
        cv.run(x0 + 24, y + 82, [(no, "num", 34, t["ink"], 12), (nm, "serif" if st == "gold" else "title", 30, t["ink"], 0)])
        cv.run(x0 + 24, y + 112, [(f"{v1.hms(r['start'], True)} 第 {n_call} 次呼叫", "body", 15, t["sub"], 14),
                                   ("已等 ", "body", 15, t["sub"], 2), (v1.mmss(now - r["start"]), "num", 17, t["call_deep"], 0)])
    else:
        el = now - r["start"]
        chip(cv, t, x0 + 24, y + 18, "当前就诊", 14, "#FFFFFF", t["busy"], pad=10, h=26)
        if kind == "复诊":
            chip(cv, t, x0 + 118, y + 18, "复诊", 14, "#FFFFFF", t["recheck"], pad=10, h=26)
        cv.run(x0 + 24, y + 82, [(no, "num", 34, t["ink"], 12), (nm, "serif" if st == "gold" else "title", 30, t["ink"], 0)])
        cv.text(x0 + 24, y + 112, f"{v1.hms(r['start'])} 开始", "body", 15, t["sub"], anchor="ls")
        cv.run(x1 - 24 - cv.tw(v1.mmss(el), "num", 30) - cv.tw("已就诊 ", "body", 15) - 2, y + 66,
               [("已就诊 ", "body", 15, t["sub"], 2), (v1.mmss(el), "num", 30, t["over"] if el > 900 else t["busy"], 0)])
        bx0, bx1 = x1 - 150, x1 - 24
        cv.rrect(bx0, y + 102, bx1, y + 110, 4, fill=t["track"], outline=t.get("outline") if st == "candy" else None, w=1.4)
        cv.rrect(bx0, y + 102, bx0 + (bx1 - bx0) * min(1, el / 900), y + 110, 4, fill=t["busy"])
        cv.text(bx1, y + 124, "15 分钟提醒", "body", 11, t["faint"], anchor="rs")

    # 三组名单
    def section(y0, y1, key, lab, items, note, per_row=2, cap=8, extra=None):
        yc = card(cv, t, x0, y0, x1, y1, None, accent=t[key])
        if st == "candy":
            w = cv.tw(lab, "title", 17) + 26
            cv.rrect(x0 + 16, y0 + 14, x0 + 16 + w, y0 + 44, 15, fill=t[key], outline=t["outline"], w=2)
            cv.text(x0 + 16 + w / 2, y0 + 30, lab, "title", 17, "#FFFFFF", anchor="mm")
            cv.run(x0 + 26 + w, y0 + 38, [(str(len(items)), "num", 22, t[key], 3), ("人", "body", 14, t[key], 0)])
        else:
            if st == "glass":
                cv.rrect(x0 + 20, y0 + 21, x0 + 25, y0 + 41, 2.5, fill=t[key])
            elif st == "holo":
                cv.rect(x0 + 18, y0 + 24, x0 + 26, y0 + 32, fill=t[key])
            else:
                cv.poly([(x0 + 22, y0 + 31), (x0 + 27, y0 + 26), (x0 + 32, y0 + 31), (x0 + 27, y0 + 36)], t[key])
            tf = "serif" if st == "gold" else "title"
            cv.run(x0 + 36, y0 + 39, [(lab, tf, 19, t[key], 8), (str(len(items)), "num", 22, t[key], 3), ("人", "body", 14, t[key], 0)])
        cv.text(x1 - 20, y0 + 38, note, "body", 12, t["faint"], anchor="rs")
        cw = (x1 - x0 - 44) / per_row
        for k, it in enumerate(items[:cap]):
            xx, yy = x0 + 22 + (k % per_row) * cw, yc + 16 + (k // per_row) * 31
            parts = [(it[0], "num", 16, t["ink"], 7), (it[1], "body", 16, t["ink"], 8)]
            if extra:
                parts.append((extra(k), "body", 12, t["faint"], 0))
            cv.run(xx, yy, parts)
        if len(items) > cap:
            cv.text(x1 - 20, y1 - 14, f"…… 等 {len(items) - cap} 人", "body", 13, t["sub"], anchor="rs")
        if not items:
            cv.text(x0 + 22, yc + 16, "暂无", "body", 15, t["faint"], anchor="ls")

    section(434, 682, "wait", "待诊", r["wait_list"], "按签到顺序")
    section(694, 856, "recheck", "复诊", r["recheck_list"], "带结果回诊 · 优先插叫", per_row=1, cap=3,
            extra=lambda k: f"{v1.hms(r['recheck_time'][k])} 回诊")
    section(868, 1044, "missed", "过诊", r["missed_list"], "重签后排第 3 位", per_row=1, cap=3,
            extra=lambda k: f"{v1.hms(r['missed_time'][k])} 未到")


# ---------------------------------------------------------------- 合成
def compose(key, mode="called"):
    t = THEMES[key]
    called = next(i for i, r in enumerate(v1.ROOMS) if r.get("called"))
    tour = next(i for i, r in enumerate(v1.ROOMS) if r["no"] == "218") if mode == "tour" else None
    now = v1.NOW + (16 if mode == "tour" else 0)
    n_call = 2 if mode == "tour" else 1
    cv = background(t)
    header(cv, t, now)
    call_banner(cv, t, v1.ROOMS[called], n_call)
    stage(cv, t, called, tour, 1.55 if mode == "tour" else 1.0, now)
    overview(cv, t)
    room_list(cv, t, now, called, tour)
    recent_calls(cv, t, v1.events_at(now)[:4])
    missed_board(cv, t)
    show = tour if mode == "tour" else called
    room_detail(cv, t, now, v1.ROOMS[show], show, n_call, mode)
    out = t["out"] if mode == "called" else t["out"].replace(".png", "-tour.png").replace("13-", "15-")
    im = cv.im.convert("RGB").resize((W_, H_), Image.Resampling.LANCZOS)
    im.save(os.path.join(OUT, out))
    print("写出", out, t["name"], mode)
    return im


def main():
    v1.build_queue()
    if "tour" in sys.argv[1:]:  # 选定风格后的"轮播推近"画面：python3 draft_v2.py tour [风格]
        for k in [a for a in sys.argv[1:] if a in THEMES] or ["e"]:
            compose(k, "tour")
        return
    keys = [a for a in sys.argv[1:] if a in THEMES] or list(THEMES)
    ims = {k: compose(k) for k in keys}
    if len(ims) == 4:
        # 对比拼图：2 × 2，每张 960 × 540，左上角写风格名
        sheet = Image.new("RGB", (1920 + 30, 1080 + 30 + 80), "#FFFFFF")
        d = ImageDraw.Draw(sheet)
        for n, k in enumerate(keys):
            x, y = 10 + (n % 2) * 970, 10 + (n // 2) * 590
            d.text((x, y), THEMES[k]["name"], font=ImageFont.truetype(os.path.join(FONT_DIR, "AlimamaShuHeiTi-Bold.ttf"), 26), fill="#13201C")
            sheet.paste(ims[k].resize((960, 540), Image.Resampling.LANCZOS), (x, y + 40))
        sheet.save(os.path.join(OUT, "10-style-compare.png"))
        print("写出 10-style-compare.png")


if __name__ == "__main__":
    main()

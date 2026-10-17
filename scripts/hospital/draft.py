"""医院院内导航 · 大屏设计稿合成脚本（只出设计稿，不是页面代码）。

用法：python3 scripts/hospital/draft.py
输入：docs/design/hospital/draft/ai-scene-{light,dark}.png（中央三维场景，Figma generate_image 生成，无文字）
     + plan.py / nav.py（CAD 房间、路网和真实算出的路线）
输出：docs/design/hospital/01-draft-light.png、02-draft-dark.png（1920 × 1080，两套配色）

画面结构（1920 × 1080）：
  顶栏      院名 + 当前时间
  左栏      起点 / 终点、搜索、楼层切换、本层科室列表（每项附"从起点步行约几分钟"，按路网真实算出）
  中间      三维场景（AI 图）+ 楼层名 + 起点 / 终点标签
  中下      分层路线：三张按 CAD 画的小平面图，标出本层要走的路线
  右栏      导视牌式的当前提示、全程汇总、推荐 / 无障碍切换、分步提示
设计取意：医院地面的彩色导引线 → 画面里唯一的橙色路线；医院导视牌 → 右侧的分步提示。
界面遵守 tasteskill 的规则：不用渐变、发光、毛玻璃、阴影和细分隔线，面板之间只靠底色深浅区分。
"""

import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import nav  # noqa: E402
import plan as pl  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "docs/design/hospital")
FONT_DIR = os.path.join(ROOT, "src/assets/fonts")
S = 2  # 先按 2 倍画，最后缩到 1920 × 1080，边缘更干净
W_, H_ = 1920, 1080

# 演示用的这条路线：南门（主入口）→ 核磁共振室（推荐路线，扶梯两段）
ROUTE = ("南门（主入口）", "核磁共振室")

THEMES = {
    "light": dict(
        scene="ai-scene-light.png", out="01-draft-light.png",
        ground="#E2E8E6", panel="#F2F5F4", panel2="#E9EEEC", ink="#13201C", sub="#56665F", faint="#8C9A95",
        sign="#0F5B4C", sign_ink="#FFFFFF", sign_sub="#B9D9D0", route="#F26B1D", route_tint="#FBE2D2",
        start="#1F9D57", end="#D7372C", tag="#DDE5E2",
        plan_floor="#FFFFFF", plan_wall="#2A3532", plan_void="#E2E8E6",
        zones={"clinic": "#DCE9F7", "exam": "#E8E0F6", "emergency": "#F9DED8", "service": "#D9EFE1", "public": "#F7F8F6", "traffic": "#F6EACB", "wc": "#D6EDF0", "aux": "#E6E8E7"},
        # 当前演示时刻：病人刚进南门，沿大厅中轴往扶梯走（与 AI 图里人物位置一致）
        now_step=1, labels=[(26, 262), (26, 562), (26, 852)], pins=dict(start=(793, 846), end=(1265, 24)),
    ),
    "dark": dict(
        scene="ai-scene-dark.png", out="02-draft-dark.png",
        ground="#0B1418", panel="#121D21", panel2="#18252A", ink="#E6EEEB", sub="#98ABA5", faint="#5F716C",
        sign="#F5A524", sign_ink="#13201C", sign_sub="#5B4310", route="#F5A524", route_tint="#3A2E14",
        start="#2CC46B", end="#F0473C", tag="#1C2A2F",
        plan_floor="#1A272C", plan_wall="#7C9089", plan_void="#0B1418",
        zones={"clinic": "#25434F", "exam": "#3A3152", "emergency": "#522D31", "service": "#25483B", "public": "#1F2E33", "traffic": "#4C4229", "wc": "#244448", "aux": "#263136"},
        # 当前演示时刻：病人在 2F 换乘，正乘扶梯上 3F（与 AI 图里人物位置一致）
        now_step=4, labels=[(18, 190), (18, 462), (18, 722)], pins=dict(start=(705, 812), end=(1325, 128)),
    ),
}


def font(kind, size):
    path = {"title": "AlimamaShuHeiTi-Bold.ttf", "body": "SourceHanSansCN-Regular.otf", "num": "DIN-Bold.otf"}[kind]
    return ImageFont.truetype(os.path.join(FONT_DIR, path), int(size * S))


class Canvas:
    """按 1 倍坐标作画的小封装（内部乘 S）"""

    def __init__(self, bg):
        self.im = Image.new("RGB", (W_ * S, H_ * S), bg)
        self.d = ImageDraw.Draw(self.im)

    def rect(self, x0, y0, x1, y1, fill):
        self.d.rectangle([x0 * S, y0 * S, x1 * S - 1, y1 * S - 1], fill=fill)

    def rrect(self, x0, y0, x1, y1, r, fill):
        self.d.rounded_rectangle([x0 * S, y0 * S, x1 * S - 1, y1 * S - 1], radius=r * S, fill=fill)

    def circle(self, x, y, r, fill):
        self.d.ellipse([(x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S], fill=fill)

    def poly(self, pts, fill):
        self.d.polygon([(x * S, y * S) for x, y in pts], fill=fill)

    def line(self, pts, fill, w):
        self.d.line([(x * S, y * S) for x, y in pts], fill=fill, width=int(w * S), joint="curve")

    def text(self, x, y, s, kind, size, fill, anchor="la"):
        self.d.text((x * S, y * S), s, font=font(kind, size), fill=fill, anchor=anchor)

    def tw(self, s, kind, size):
        """文字宽度（1 倍坐标）"""
        b = self.d.textbbox((0, 0), s, font=font(kind, size))
        return (b[2] - b[0]) / S

    def paste(self, img, x, y, w):
        h = round(img.height * w / img.width)
        self.im.paste(img.resize((int(w * S), int(h * S)), Image.Resampling.LANCZOS), (int(x * S), int(y * S)))
        return h


# ---------------------------------------------------------------- 图标（导视牌常用的简化图形）
def icon(cv, kind, x, y, s, color, bg):
    """在 (x, y) 为左上角、边长 s 的方格里画图标"""
    k = s / 24.0

    def P(px, py):
        return (x + px * k, y + py * k)

    if kind == "straight":
        cv.line([P(12, 21), P(12, 7)], color, 3 * k)
        cv.poly([P(12, 2), P(18, 9), P(6, 9)], color)
    elif kind in ("left", "right"):
        sgn = -1 if kind == "left" else 1
        cv.line([P(12 - 4 * sgn, 22), P(12 - 4 * sgn, 12), P(12 + 4 * sgn, 12)], color, 3 * k)
        cv.poly([P(12 + 9 * sgn, 12), P(12 + 3 * sgn, 6), P(12 + 3 * sgn, 18)], color)
    elif kind == "escalator":
        # 扶梯：下平台 → 斜段 → 上平台，加一个乘梯的人
        cv.line([P(1, 20), P(7, 20), P(17, 8), P(23, 8)], color, 3 * k)
        cv.circle(*P(12, 5), 2.2 * k, color)
        cv.line([P(12, 8), P(11, 14)], color, 2.4 * k)
    elif kind == "elevator":
        cv.rect(*P(4, 2), *P(20, 22), color)
        cv.poly([P(12, 5), P(16, 10), P(8, 10)], bg)
        cv.poly([P(12, 19), P(16, 14), P(8, 14)], bg)
    elif kind == "stairs":
        cv.line([P(2, 21), P(7, 21), P(7, 16), P(12, 16), P(12, 11), P(17, 11), P(17, 6), P(22, 6)], color, 3 * k)
    elif kind == "start":
        cv.circle(*P(12, 12), 9 * k, color)
        cv.circle(*P(12, 12), 4 * k, bg)
    elif kind == "end":
        cv.circle(*P(12, 9), 7 * k, color)
        cv.poly([P(6, 12), P(18, 12), P(12, 22)], color)
        cv.circle(*P(12, 9), 3 * k, bg)
    elif kind == "search":
        cv.circle(*P(10, 10), 7 * k, color)
        cv.circle(*P(10, 10), 4.6 * k, bg)
        cv.line([P(15, 15), P(21, 21)], color, 3 * k)
    elif kind == "swap":
        cv.line([P(8, 20), P(8, 5)], color, 2.6 * k)
        cv.poly([P(8, 1), P(13, 7), P(3, 7)], color)
        cv.line([P(16, 4), P(16, 19)], color, 2.6 * k)
        cv.poly([P(16, 23), P(21, 17), P(11, 17)], color)


def pin(cv, x, y, color, ring):
    """场景里的地图针（尖端在 x, y）"""
    cv.circle(x, y - 26, 13, color)
    cv.poly([(x - 10, y - 20), (x + 10, y - 20), (x, y)], color)
    cv.circle(x, y - 26, 5, ring)


# ---------------------------------------------------------------- 分层路线小图
def mini_plan(cv, t, floors, prims, f, x0, y0, w, polylines, start, end, conns):
    """按 CAD 画一层的小平面：房间分区色 + 墙 + 本层路线"""
    k = w / pl.W

    def P(x, y):
        return (x0 + x * k, y0 + (pl.D - y) * k)

    # 外轮廓：先铺一层墙色，再内缩铺楼面色，得到一圈实心外墙
    o0, o1 = P(0, pl.D), P(pl.W, 0)
    cv.rect(o0[0] - 1.6, o0[1] - 1.6, o1[0] + 1.6, o1[1] + 1.6, t["plan_wall"])
    cv.rect(*o0, *o1, t["plan_floor"])
    # 小尺寸下墙线会碎成虚线，改成"色块"画法：每个房间内缩 0.35 m 铺分区色，缝隙就是墙
    inset = 0.35

    def tile(rect, color):
        a, b = P(rect[0] + inset, rect[3] - inset), P(rect[2] - inset, rect[1] + inset)
        cv.rect(a[0], a[1], b[0], b[1], color)

    for r in floors[f]:
        tile(r["rect"], t["zones"][r["zone"]])
    for key in ("W", "E"):
        tile(pl.STAIR[key], t["zones"]["traffic"])
        tile(pl.WC[key], t["zones"]["wc"])
    for rect in pl.ELEV.values():
        tile(rect, t["plan_wall"])
    if f > 0:
        a, b = P(pl.VOID[0], pl.VOID[3]), P(pl.VOID[2], pl.VOID[1])
        cv.rect(a[0], a[1], b[0], b[1], t["plan_void"])

    def clamp(x, y):
        return (min(max(x, -1.5), pl.W + 1.5), min(max(y, -1.5), pl.D + 1.5))

    for pts in polylines:
        cv.line([P(*clamp(x, y)) for x, y in pts], t["route"], 3.2)
    for (x, y), kind in conns:
        px, py = P(x, y)
        cv.rect(px - 4, py - 4, px + 4, py + 4, t["ink"])
    if start:
        cv.circle(*P(*clamp(*start)), 5, t["start"])
    if end:
        cv.circle(*P(*end), 5, t["end"])


def wrap(cv, s, kind, size, max_w):
    """按宽度折行：放不下时优先在"，"后或"（"前断开，否则逐字断"""
    if cv.tw(s, kind, size) <= max_w:
        return [s]
    for sep, keep_left in (("，", True), ("（", False)):
        i = s.rfind(sep)
        if i > 0:
            a, b = (s[:i + 1], s[i + 1:]) if keep_left else (s[:i], s[i:])
            if cv.tw(a, kind, size) <= max_w:
                return [a] + wrap(cv, b, kind, size, max_w)
    lines, cur = [], ""
    for ch in s:
        if cv.tw(cur + ch, kind, size) > max_w and cur:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines


def step_icon(s):
    """分步提示 → 图标"""
    if s["kind"] in ("escalator", "elevator"):
        return s["kind"]
    if s["kind"] == "stair":
        return "stairs"
    if s["kind"] == "start":
        return "start"
    if s["kind"] == "hint":
        # "中庭扶梯在右手边"这类提示：用对应交通设施的图标
        for word, ic in (("扶梯", "escalator"), ("电梯", "elevator"), ("楼梯", "stairs")):
            if word in s["text"]:
                return ic
    if s["kind"] == "end":
        return "end"
    if s["text"].startswith("左转") or "后左转" in s["text"]:
        return "left"
    if s["text"].startswith("右转") or "后右转" in s["text"]:
        return "right"
    return "straight"


def compose(name, t, floors, prims, G, places):
    cv = Canvas(t["ground"])
    by = {p["name"]: p for p in places}
    pbn = {p["node"]: p for p in places}
    src, dst = by[ROUTE[0]], by[ROUTE[1]]
    path, cost = nav.shortest(G, src["node"], dst["node"])
    steps = nav.describe(G, path, pbn)
    legs = nav.legs(G, path)
    total = nav.total_length(G, path)
    now = t["now_step"]

    # ---- 顶栏
    cv.text(40, 30, "××医院院内导航", "title", 30, t["ink"])
    cv.text(40 + cv.tw("××医院院内导航", "title", 30) + 20, 38, "门诊医技综合楼  ·  3 层  ·  60 个诊室与检查室", "body", 16, t["sub"])
    cv.text(1880, 26, "09:42", "num", 32, t["ink"], anchor="ra")
    cv.text(1880 - cv.tw("09:42", "num", 32) - 16, 38, "10月16日  周五", "body", 16, t["sub"], anchor="ra")

    # ---- 左栏：起点 / 终点
    x0, x1 = 40, 400
    cv.rect(x0, 92, x1, 300, t["panel"])
    cv.text(x0 + 24, 116, "去哪里", "title", 20, t["ink"])
    rows = [("start", "起点", src["name"], "1F 门诊大厅层"), ("end", "终点", f"{dst['name']}", f"{dst['num']}  ·  3F 医技检查层")]
    for i, (ic, lab, val, sub) in enumerate(rows):
        y = 160 + i * 66
        icon(cv, ic, x0 + 24, y + 4, 24, t[ic], t["panel"])
        cv.text(x0 + 64, y, val, "title", 22, t["ink"])
        cv.text(x0 + 64, y + 30, f"{lab}  ·  {sub}", "body", 14, t["sub"])
    cv.rect(x0 + 36 - 1.5, 192, x0 + 36 + 1.5, 220, t["faint"])  # 起终点之间的连接
    cv.rect(x1 - 64, 176, x1 - 24, 216, t["panel2"])
    icon(cv, "swap", x1 - 56, 184, 24, t["sub"], t["panel2"])

    # 搜索框
    cv.rect(x0, 316, x1, 364, t["panel"])
    icon(cv, "search", x0 + 18, 328, 22, t["faint"], t["panel"])
    cv.text(x0 + 52, 330, "搜索科室、检查项目或房间号", "body", 16, t["faint"])

    # 楼层切换
    tabs = [("1F", "门诊大厅"), ("2F", "门诊诊室"), ("3F", "医技检查")]
    tw_ = (x1 - x0) / 3
    for i, (fl, nm) in enumerate(tabs):
        on = fl == "3F"
        cv.rect(x0 + i * tw_, 380, x0 + (i + 1) * tw_, 428, t["sign"] if on else t["panel"])
        c = t["sign_ink"] if on else t["sub"]
        label = f"{fl} {nm}"
        cv.text(x0 + i * tw_ + tw_ / 2, 404, label, "body", 16, c, anchor="mm")

    # 本层科室列表：附从起点步行时间（路网真实算出）
    cv.rect(x0, 444, x1, 1040, t["panel"])
    rooms3 = [r for r in floors[2] if r["dest"]]
    rooms3.sort(key=lambda r: r["num"])
    y = 456
    for r in rooms3[:12]:
        on = r["num"] == dst["num"]
        if on:
            cv.rect(x0, y, x1, y + 44, t["route_tint"])
            cv.rect(x0, y, x0 + 4, y + 44, t["route"])
        _, c = nav.shortest(G, src["node"], f"room:{r['num']}")
        cv.text(x0 + 24, y + 22, r["num"], "num", 17, t["route"] if on else t["sub"], anchor="lm")
        cv.text(x0 + 76, y + 22, r["label"], "body", 17, t["ink"], anchor="lm")
        cv.text(x1 - 20, y + 22, f"约 {max(1, math.ceil(c / 60))} 分钟", "body", 14, t["sub"], anchor="rm")
        y += 44
    cv.text(x0 + 24, y + 26, f"本层还有 {len(rooms3) - 12} 个科室，下滑查看", "body", 14, t["faint"], anchor="lm")

    # ---- 中间：三维场景
    sx0, sw = 416, 1088
    scene = Image.open(os.path.join(OUT, "draft", t["scene"])).convert("RGB")
    k = sw / scene.width
    sy0 = 78
    sh = cv.paste(scene, sx0, sy0, sw)
    # 楼层名（场景左侧留白处）
    for (lx, ly), f in zip(t["labels"], (2, 1, 0)):
        X, Y = sx0 + lx * k, sy0 + ly * k
        cv.text(X, Y - 6, pl.FLOORS[f], "num", 34, t["ink"], anchor="ls")
        cv.text(X, Y + 18, pl.FLOOR_TITLE[f], "body", 14, t["sub"], anchor="ls")
    # 起点 / 终点标签（导视牌式小牌）
    for key, txt in (("start", "南门  起点"), ("end", "核磁共振室 309")):
        px, py = t["pins"][key]
        X, Y = sx0 + px * k, sy0 + py * k
        w = cv.tw(txt, "body", 15) + 24
        bx = X + 16 if key == "start" else X - w - 16
        by_ = Y - 30 if key == "start" else max(sy0 + 4, Y - 6)
        cv.rect(bx, by_, bx + w, by_ + 30, t["start"] if key == "start" else t["end"])
        cv.text(bx + 12, by_ + 15, txt, "body", 15, "#FFFFFF", anchor="lm")

    # ---- 中下：分层路线小图
    walk_by_floor = {0: 0.0, 1: 0.0, 2: 0.0}
    poly_by_floor = {0: [], 1: [], 2: []}
    for f, pts in nav.route_polylines(G, path):
        poly_by_floor[f].append(pts)
        walk_by_floor[f] += sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
    conns = {0: [], 1: [], 2: []}
    for leg in legs:
        if leg["kind"] != "walk":
            for end_ in (leg["a"], leg["b"]):
                n = G.nodes[end_]
                conns[n["floor"]].append(((n["x"], n["y"]), leg["kind"]))
    cur_floor = G.nodes[path[0]]["floor"] if now < 4 else 1
    pw, gap = (sw - 2 * 16) / 3, 16
    py0 = 824
    notes = {0: f"步行 {round(walk_by_floor[0])} 米，乘扶梯", 1: "出扶梯掉头，换乘上行", 2: f"步行 {round(walk_by_floor[2])} 米到达"}
    for i, f in enumerate((0, 1, 2)):
        X = sx0 + i * (pw + gap)
        on = f == cur_floor
        cv.rect(X, py0, X + pw, 1040, t["panel2"] if on else t["panel"])
        cv.text(X + 16, py0 + 14, pl.FLOORS[f], "num", 22, t["route"] if on else t["ink"])
        cv.text(X + 16 + cv.tw(pl.FLOORS[f], "num", 22) + 10, py0 + 18, pl.FLOOR_TITLE[f] + ("  ·  当前" if on else ""), "body", 14, t["sub"])
        cv.text(X + pw - 16, py0 + 18, notes[f], "body", 14, t["ink"], anchor="ra")
        plan_w = pw - 40  # 留出楼外 1.5 m（主入口外的起点）
        mini_plan(cv, t, floors, prims, f, X + 20, py0 + 48, plan_w, poly_by_floor[f],
                  (G.nodes[path[0]]["x"], G.nodes[path[0]]["y"]) if f == 0 else None,
                  (G.nodes[path[-1]]["x"], G.nodes[path[-1]]["y"]) if f == 2 else None, conns[f])

    # ---- 右栏：导视牌（当前提示）
    rx0, rx1 = 1520, 1880
    cur = steps[now]
    cv.rect(rx0, 92, rx1, 300, t["sign"])
    icon(cv, step_icon(cur), rx0 + 24, 116, 56, t["sign_ink"], t["sign"])
    main = cur["text"].split("（")[0]
    extra = cur["text"][len(main):].strip("（）")
    lines = wrap(cv, main, "title", 28, rx1 - rx0 - 48)
    y = 196
    for ln in lines[:2]:
        cv.text(rx0 + 24, y, ln, "title", 28, t["sign_ink"])
        y += 40
    if extra:
        cv.text(rx0 + 24, y + 4, extra, "body", 16, t["sign_sub"])
    nxt = steps[now + 1]["text"] if now + 1 < len(steps) else ""
    cv.text(rx1 - 24, 120, "下一步", "body", 14, t["sign_sub"], anchor="ra")
    nwrap = wrap(cv, nxt.split("，")[0], "body", 16, 150)
    for j, ln in enumerate(nwrap[:2]):
        cv.text(rx1 - 24, 144 + j * 22, ln, "body", 16, t["sign_ink"], anchor="ra")

    # 进度：当前步骤之前的耗时（演示时刻按 AI 图里人物的位置估）
    elapsed = {1: 6.0, 4: 41.0}.get(now, 0.0)
    frac = elapsed / cost
    cv.rect(rx0 + 24, 276, rx1 - 24, 282, t["sign_sub"])
    cv.rect(rx0 + 24, 276, rx0 + 24 + (rx1 - rx0 - 48) * frac, 282, t["sign_ink"])
    cv.text(rx1 - 24, 262, f"剩余约 {math.ceil((cost - elapsed) / 60)} 分钟", "body", 14, t["sign_sub"], anchor="rs")

    # 全程汇总
    cv.rect(rx0, 316, rx1, 404, t["panel"])
    esc = sum(1 for l in legs if l["kind"] == "escalator")
    stats = [(f"{round(total)}", "米", "全程步行"), (f"{math.ceil(cost / 60)}", "分钟", "预计用时"), (f"{esc}", "段", "乘扶梯")]
    cw = (rx1 - rx0) / 3
    for i, (v, u, lab) in enumerate(stats):
        X = rx0 + 24 + i * cw
        cv.text(X, 332, v, "num", 34, t["ink"])
        cv.text(X + cv.tw(v, "num", 34) + 4, 348, u, "body", 15, t["ink"])
        cv.text(X, 372, lab, "body", 14, t["sub"])

    # 推荐 / 无障碍
    for i, lab in enumerate(("推荐路线", "无障碍 · 只乘电梯")):
        on = i == 0
        X0 = rx0 + i * (rx1 - rx0) / 2
        cv.rect(X0, 420, X0 + (rx1 - rx0) / 2, 468, t["ink"] if on else t["panel"])
        cv.text(X0 + (rx1 - rx0) / 4, 444, lab, "body", 16, t["ground"] if on else t["sub"], anchor="mm")

    # 分步提示
    cv.rect(rx0, 484, rx1, 1040, t["panel"])
    y = 500
    for i, s in enumerate(steps):
        done, on = i < now, i == now
        txt = s["text"]
        lines = wrap(cv, txt, "body", 16, rx1 - rx0 - 124)
        h = 18 + 24 * len(lines)
        if on:
            cv.rect(rx0, y - 8, rx1, y + h - 4, t["route_tint"])
            cv.rect(rx0, y - 8, rx0 + 4, y + h - 4, t["route"])
        col = t["faint"] if done else t["ink"]
        icon(cv, step_icon(s), rx0 + 20, y + 1, 22, t["route"] if on else (t["faint"] if done else t["sub"]), t["route_tint"] if on else t["panel"])
        f = pl.FLOORS[s["floor"]]
        cv.rect(rx0 + 54, y, rx0 + 92, y + 24, t["tag"])
        cv.text(rx0 + 73, y + 12, f, "num", 14, t["sub"], anchor="mm")
        for j, ln in enumerate(lines):
            cv.text(rx0 + 104, y + 2 + j * 24, ln, "body", 16, col)
        y += h + 6

    out = cv.im.resize((W_, H_), Image.Resampling.LANCZOS)
    path_out = os.path.join(OUT, t["out"])
    out.save(path_out, optimize=True)
    return path_out


def main():
    floors = pl.build_rooms()
    prims = [pl.floor_prims(f, floors[f]) for f in range(3)]
    G, places = nav.build_graph(floors)
    for name, t in THEMES.items():
        print("写出", compose(name, t, floors, prims, G, places))


if __name__ == "__main__":
    main()

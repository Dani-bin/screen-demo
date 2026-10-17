"""医院院内导航 · 大屏设计稿 v2（按 ui-ux-pro-max 的设计体系重做，只出设计稿）。

用法：python3 scripts/hospital/draft_v2.py
输出：docs/design/hospital/10-v2-select-light.png / 11-v2-navigate-light.png / 12-v2-select-dark.png / 13-v2-navigate-dark.png

相对 v1 的改动（依据 ui-ux-pro-max 检索结果）：
  - 产品类型按"数字标牌 / 自助终端 + 医疗"：瑞士极简 + 无障碍优先，扁平、无渐变无阴影；
  - 配色用医疗青蓝 + 健康绿（colors.csv · Medical Clinic），导视牌用深青 #0E7490（白字对比 5.4:1）；
    橙色只留给路线（与三维图一致），不用作文字色；
  - 字号按大屏可读性放大：最小 16px，正文 20–24px，关键信息 36–48px；触控目标 ≥ 56px，间距 ≥ 8px；
  - 逐步展开：拆成"选择目的地"和"导航中"两屏，每屏只有一个主按钮；
  - 进度提示：第几步 / 共几步 + 按楼层的进度条；状态不只靠颜色（同时写"已过 / 当前"）。
字体仍用项目固定的三套（阿里妈妈数黑体 / 思源黑体 / DIN），没用检索给出的 Inter / Playfair。
"""

import math
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import nav  # noqa: E402
import plan as pl  # noqa: E402
from draft import OUT, Canvas, icon, mini_plan, step_icon, wrap  # noqa: E402

ROUTE = ("南门（主入口）", "核磁共振室")

# 两套配色同源（dark-mode-pairing：同一套角色，深色版用更亮、更低饱和的色阶）
THEMES = {
    "light": dict(
        scene="ai-scene-light.png", scene_bg="#E2E8E6",
        bg="#F0FDFA", card="#FFFFFF", muted="#E3EEF0", ink="#134E4A", sub="#475569",
        primary="#0E7490", on_primary="#FFFFFF", primary_soft="#CCEFF3", primary_ink="#0E7490",
        cta="#15803D", on_cta="#FFFFFF", route="#F26B1D", start="#15803D", end="#DC2626",
        done="#64748B", sign_sub="#CDEFF4",
        plan_floor="#FFFFFF", plan_wall="#134E4A", plan_void="#E2E8E6",
        zones={k: "#DCE6EA" for k in pl.ZONES},
        labels=[(6, 262), (6, 562), (6, 852)], pins=dict(start=(793, 846), end=(1265, 24)), now=1,
        start_tag="#15803D", end_tag="#DC2626",
    ),
    "dark": dict(
        scene="ai-scene-dark.png", scene_bg="#0B1418",
        bg="#071012", card="#10191D", muted="#18242A", ink="#ECFEFF", sub="#94A3B8",
        primary="#155E75", on_primary="#FFFFFF", primary_soft="#123842", primary_ink="#67E8F9",
        cta="#16A34A", on_cta="#FFFFFF", route="#F5A524", start="#22C55E", end="#F87171",
        done="#7C8B9B", sign_sub="#A5E7F2",
        plan_floor="#1A272C", plan_wall="#94A3B8", plan_void="#0B1418",
        zones={k: "#2A3A40" for k in pl.ZONES},
        labels=[(0, 190), (0, 462), (0, 722)], pins=dict(start=(705, 812), end=(1325, 128)), now=4,
        start_tag="#15803D", end_tag="#B91C1C",  # 标签底色压深一档，白字对比 ≥ 4.5:1
    ),
}
M = 48  # 页边距
LEFT = (M, 616)  # 左栏
RIGHT = (640, 1920 - M)  # 右侧场景区


def route_info(G, places):
    by = {p["name"]: p for p in places}
    pbn = {p["node"]: p for p in places}
    src, dst = by[ROUTE[0]], by[ROUTE[1]]
    path, cost = nav.shortest(G, src["node"], dst["node"])
    return dict(src=src, dst=dst, path=path, cost=cost, steps=nav.describe(G, path, pbn),
                legs=nav.legs(G, path), total=nav.total_length(G, path), by=by)


def top_bar(cv, t):
    cv.text(M, 34, "××医院 · 院内导航", "title", 32, t["ink"])
    cv.text(1920 - M, 30, "09:42", "num", 40, t["ink"], anchor="ra")
    w = cv.tw("09:42", "num", 40)
    cv.text(1920 - M - w - 24, 44, "您在：南门大厅导航屏  ·  10月16日 周五", "body", 20, t["sub"], anchor="ra")


def button(cv, x0, y0, x1, y1, label, fill, ink, size=22, kind="body"):
    cv.rrect(x0, y0, x1, y1, 8, fill)
    cv.text((x0 + x1) / 2, (y0 + y1) / 2, label, kind, size, ink, anchor="mm")


def scene_block(cv, t, R, with_tags=True):
    """右侧场景区：整块铺三维图的底色，图居中，叠楼层名和起终点标签"""
    x0, x1 = RIGHT
    cv.rect(x0, 112, x1, 1040, t["scene_bg"])
    img = Image.open(os.path.join(OUT, "draft", t["scene"])).convert("RGB")
    w = 1180
    k = w / img.width
    sx, sy = x0 + (x1 - x0 - w) / 2, 116
    cv.paste(img, sx, sy, w)
    for (lx, ly), f in zip(t["labels"], (2, 1, 0)):
        X, Y = sx + lx * k, sy + ly * k
        cv.text(X, Y - 4, pl.FLOORS[f], "num", 40, t["ink"], anchor="ls")
        cv.text(X, Y + 22, pl.FLOOR_TITLE[f], "body", 18, t["sub"], anchor="ls")
    if with_tags:
        for key, txt in (("start", "您在这里 · 南门"), ("end", f"{R['dst']['name']} {R['dst']['num']}")):
            px, py = t["pins"][key]
            X, Y = sx + px * k, sy + py * k
            w_ = cv.tw(txt, "body", 20) + 28
            bx = X + 18 if key == "start" else X - w_ - 18
            by_ = Y - 40 if key == "start" else max(sy + 4, Y - 8)
            cv.rrect(bx, by_, bx + w_, by_ + 40, 6, t["start_tag"] if key == "start" else t["end_tag"])
            cv.text(bx + 14, by_ + 20, txt, "body", 20, "#FFFFFF", anchor="lm")
    return sx, sy, k


# ---------------------------------------------------------------- A 选择目的地
def screen_select(t, floors, prims, G, places, R):
    cv = Canvas(t["bg"])
    top_bar(cv, t)
    x0, x1 = LEFT

    # 起点：导航屏自己的位置就是默认起点
    cv.rrect(x0, 112, x1, 196, 8, t["card"])
    icon(cv, "start", x0 + 24, 136, 36, t["start"], t["card"])
    cv.text(x0 + 76, 132, "您在这里", "body", 18, t["sub"])
    cv.text(x0 + 76, 156, "南门（主入口） · 1F 门诊大厅", "title", 24, t["ink"])
    button(cv, x1 - 132, 126, x1 - 16, 182, "换起点", t["muted"], t["ink"], 20)

    cv.text(x0, 218, "您要去哪里？", "title", 44, t["ink"])

    # 搜索
    cv.rrect(x0, 284, x1, 348, 8, t["card"])
    icon(cv, "search", x0 + 22, 302, 28, t["sub"], t["card"])
    cv.text(x0 + 66, 316, "输入科室、检查项目或房间号", "body", 22, t["sub"], anchor="lm")

    # 分类筛选（触控 56px）
    cats = ["全部", "门诊", "检查", "急诊", "服务", "公共"]
    cw = (x1 - x0 - 8 * 5) / 6
    for i, c in enumerate(cats):
        on = c == "检查"
        X = x0 + i * (cw + 8)
        cv.rrect(X, 364, X + cw, 420, 8, t["primary"] if on else t["muted"])
        cv.text(X + cw / 2, 392, c, "body", 22, t["on_primary"] if on else t["ink"], anchor="mm")

    # 结果列表：按楼层分组，每行 64px，附从这里步行的时间（路网实际算出）
    exam = {0: ["检验科", "采血室"], 2: ["核磁共振室", "CT 室1", "CT 室2", "DR 摄片室", "彩超室1"]}
    y = 440
    cv.rrect(x0, y, x1, 1040, 8, t["card"])
    y += 16
    for f in (2, 0):
        cv.text(x0 + 24, y + 14, f"{pl.FLOORS[f]}  {pl.FLOOR_TITLE[f]}", "body", 18, t["sub"], anchor="lm")
        y += 36
        for name in sorted(exam[f], key=lambda n: R["by"][n]["num"]):
            p = R["by"][name]
            on = name == R["dst"]["name"]
            if on:
                cv.rect(x0, y, x1, y + 64, t["primary_soft"])
                cv.rect(x0, y, x0 + 6, y + 64, t["primary"])
            _, c = nav.shortest(G, R["src"]["node"], p["node"])
            cv.text(x0 + 24, y + 32, p["num"], "num", 24, t["primary_ink"] if on else t["sub"], anchor="lm")
            cv.text(x0 + 96, y + 32, p["name"], "body", 24, t["ink"], anchor="lm")
            cv.text(x1 - 56, y + 32, f"约 {max(1, math.ceil(c / 60))} 分钟", "body", 20, t["sub"], anchor="rm")
            cv.line([(x1 - 34, y + 24), (x1 - 26, y + 32), (x1 - 34, y + 40)], t["sub"], 2.4)
            y += 64
        y += 8

    # 右侧：三维预览 + 底部路线预览条（唯一的主按钮"开始导航"）
    scene_block(cv, t, R)
    bx0, bx1 = RIGHT[0] + 24, RIGHT[1] - 24
    cv.rrect(bx0, 920, bx1, 1016, 8, t["card"])
    icon(cv, "end", bx0 + 24, 944, 44, t["end"], t["card"])
    cv.text(bx0 + 84, 940, f"{R['dst']['name']}  {R['dst']['num']}", "title", 30, t["ink"])
    esc = sum(1 for l in R["legs"] if l["kind"] == "escalator")
    cv.text(bx0 + 84, 984, f"3F 医技检查层  ·  步行 {round(R['total'])} 米  ·  约 {math.ceil(R['cost'] / 60)} 分钟  ·  乘扶梯 {esc} 段", "body", 20, t["sub"])
    button(cv, bx1 - 252, 936, bx1 - 24, 1000, "开始导航", t["cta"], t["on_cta"], 26, "title")
    button(cv, bx1 - 476, 936, bx1 - 268, 1000, "无障碍路线", t["muted"], t["ink"], 22)
    return cv


# ---------------------------------------------------------------- B 导航中
def screen_navigate(t, floors, prims, G, places, R):
    cv = Canvas(t["bg"])
    top_bar(cv, t)
    x0, x1 = LEFT
    steps, now = R["steps"], t["now"]

    # 目的地（大字）+ 换目的地
    icon(cv, "end", x0, 124, 40, t["end"], t["bg"])
    cv.text(x0 + 56, 116, R["dst"]["name"], "title", 48, t["ink"])
    cv.text(x0 + 56, 178, f"{R['dst']['num']}  ·  3F 医技检查层  ·  从南门出发", "body", 20, t["sub"])
    button(cv, x1 - 120, 120, x1, 176, "换目的地", t["muted"], t["ink"], 20)

    # 汇总
    esc = sum(1 for l in R["legs"] if l["kind"] == "escalator")
    stats = [(f"{round(R['total'])}", "米", "全程步行"), (f"{math.ceil(R['cost'] / 60)}", "分钟", "预计用时"), (f"{esc}", "段", "乘扶梯")]
    cw = (x1 - x0) / 3
    for i, (v, u, lab) in enumerate(stats):
        X = x0 + i * cw
        cv.text(X, 226, v, "num", 48, t["ink"])
        cv.text(X + cv.tw(v, "num", 48) + 6, 248, u, "body", 20, t["ink"])
        cv.text(X, 286, lab, "body", 18, t["sub"])

    # 推荐 / 无障碍（分段切换，64px）
    half = (x1 - x0 - 8) / 2
    for i, lab in enumerate(("推荐路线", "无障碍 · 只乘电梯")):
        on = i == 0
        X = x0 + i * (half + 8)
        cv.rrect(X, 324, X + half, 388, 8, t["primary"] if on else t["muted"])
        cv.text(X + half / 2, 356, lab, "body", 22, t["on_primary"] if on else t["ink"], anchor="mm")

    # 当前导视牌
    cur = steps[now]
    cv.rrect(x0, 408, x1, 640, 8, t["primary"])
    icon(cv, step_icon(cur), x0 + 28, 436, 72, t["on_primary"], t["primary"])
    cv.text(x1 - 28, 440, f"第 {now + 1} 步 / 共 {len(steps)} 步", "body", 20, t["sign_sub"], anchor="ra")
    main = cur["text"].split("（")[0]
    extra = cur["text"][len(main):].strip("（）")
    lines = wrap(cv, main, "title", 38, x1 - x0 - 56)
    y = 528
    for ln in lines[:2]:
        cv.text(x0 + 28, y, ln, "title", 38, t["on_primary"])
        y += 50
    if extra:
        cv.text(x0 + 28, y + 2, extra, "body", 20, t["sign_sub"])
    elapsed = {1: 6.0, 4: 41.0}.get(now, 0.0)
    frac = elapsed / R["cost"]
    cv.rrect(x0 + 28, 612, x1 - 28, 620, 4, t["sign_sub"])
    cv.rrect(x0 + 28, 612, x0 + 28 + (x1 - x0 - 56) * max(frac, 0.03), 620, 4, t["on_primary"])
    cv.text(x1 - 28, 600, f"剩余约 {math.ceil((R['cost'] - elapsed) / 60)} 分钟", "body", 18, t["sign_sub"], anchor="rs")

    # 接下来的几步（已走过的收起，只列后面 4 步，每行 72px）
    cv.text(x0, 664, "接下来", "body", 20, t["sub"])
    cv.text(x1, 664, f"全部 {len(steps)} 步", "body", 20, t["primary_ink"], anchor="ra")
    y = 700
    for s in steps[now + 1:now + 5]:
        cv.rrect(x0, y, x1, y + 72, 8, t["card"])
        icon(cv, step_icon(s), x0 + 20, y + 20, 32, t["ink"], t["card"])
        cv.rrect(x0 + 68, y + 22, x0 + 116, y + 50, 6, t["muted"])
        cv.text(x0 + 92, y + 36, pl.FLOORS[s["floor"]], "num", 18, t["ink"], anchor="mm")
        txt = s["text"].split("（")[0] if s["kind"] != "end" else s["text"]
        ln = wrap(cv, txt, "body", 22, x1 - x0 - 150)
        cv.text(x0 + 132, y + 36 - (len(ln) - 1) * 14, ln[0], "body", 22, t["ink"], anchor="lm")
        if len(ln) > 1:
            cv.text(x0 + 132, y + 36 + 14, ln[1], "body", 22, t["ink"], anchor="lm")
        y += 80

    # 右侧：三维 + 按楼层的进度条（每段带 CAD 小平面图，点一段可聚焦该层）
    scene_block(cv, t, R)
    bx0, bx1 = RIGHT[0] + 24, RIGHT[1] - 24
    walk = {0: 0.0, 1: 0.0, 2: 0.0}
    polys = {0: [], 1: [], 2: []}
    for f, pts in nav.route_polylines(G, R["path"]):
        polys[f].append(pts)
        walk[f] += sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
    conns = {0: [], 1: [], 2: []}
    for leg in R["legs"]:
        if leg["kind"] != "walk":
            for e in (leg["a"], leg["b"]):
                n = G.nodes[e]
                conns[n["floor"]].append(((n["x"], n["y"]), leg["kind"]))
    cur_floor = 0 if now < 4 else 1
    stages = [
        (0, f"步行 {round(walk[0])} 米"),
        (1, "扶梯换乘"),
        (2, f"步行 {round(walk[2])} 米"),
    ]
    sw = (bx1 - bx0 - 2 * 56) / 3
    for i, (f, note) in enumerate(stages):
        X = bx0 + i * (sw + 56)
        state = "已过" if f < cur_floor else ("当前" if f == cur_floor else "待走")
        on = state == "当前"
        cv.rrect(X, 900, X + sw, 1020, 8, t["primary_soft"] if on else t["card"])
        mini_plan(cv, dict(t, ink=t["ink"]), floors, prims, f, X + 16, 916, 176, polys[f],
                  (G.nodes[R["path"][0]]["x"], G.nodes[R["path"][0]]["y"]) if f == 0 else None,
                  (G.nodes[R["path"][-1]]["x"], G.nodes[R["path"][-1]]["y"]) if f == 2 else None, conns[f])
        tx = X + 212
        cv.text(tx, 916, pl.FLOORS[f], "num", 32, t["primary_ink"] if on else t["ink"])
        cv.text(tx + cv.tw(pl.FLOORS[f], "num", 32) + 10, 924, state, "body", 18, t["primary_ink"] if on else t["sub"])
        cv.text(tx, 962, pl.FLOOR_TITLE[f], "body", 18, t["sub"])
        cv.text(tx, 988, note, "body", 20, t["done"] if state == "已过" else t["ink"])
        if i < 2:
            icon(cv, "escalator", X + sw + 12, 944, 32, t["sub"], t["bg"])
    return cv


def main():
    floors = pl.build_rooms()
    prims = [pl.floor_prims(f, floors[f]) for f in range(3)]
    G, places = nav.build_graph(floors)
    R = route_info(G, places)
    names = {"light": ("10-v2-select-light.png", "11-v2-navigate-light.png"), "dark": ("12-v2-select-dark.png", "13-v2-navigate-dark.png")}
    for mode, t in THEMES.items():
        for fn, screen in zip(names[mode], (screen_select, screen_navigate)):
            cv = screen(t, floors, prims, G, places, R)
            out = cv.im.resize((1920, 1080), Image.Resampling.LANCZOS)
            path = os.path.join(OUT, fn)
            out.save(path, optimize=True)
            print("写出", path)


if __name__ == "__main__":
    main()

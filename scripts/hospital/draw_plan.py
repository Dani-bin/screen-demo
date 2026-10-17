"""模拟医院 · 门诊医技综合楼 CAD 平面图生成脚本。

用法：python3 scripts/hospital/draw_plan.py
输出到 docs/design/hospital/：
  plan-1F.png / plan-2F.png / plan-3F.png  每层一张：轴网尺寸、图例、本层 20 个目的地房间表、图签
  plan-all.png       三层并排总图
  nav-graph.png      路网校核图（通道中线、门口支线、楼梯 / 电梯 / 扶梯连接点）
  nav-routes.png     路线样例（推荐 / 无障碍 / 走楼梯 / 扶梯下行），附分步提示
  hospital-plan.dxf  三层平面（与 PNG 同一份图元），可用 AutoCAD 打开；路网在 NAV 图层（默认关闭）
  src/views/hospital/data/plan.json  页面数据：房间、墙、家具、外墙开口、交通设施、路网（生成文件，勿手改）
数据与图元在 plan.py，路网与寻路在 nav.py。
"""

import json
import math
import os
import sys
import tempfile

os.environ.setdefault("MPLCONFIGDIR", os.path.join(tempfile.gettempdir(), "mpl-hospital"))
import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.collections import LineCollection  # noqa: E402
from matplotlib.font_manager import FontProperties  # noqa: E402
from matplotlib.patches import Arc, Circle, Polygon  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import dxf  # noqa: E402
import nav  # noqa: E402
import plan as pl  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "docs/design/hospital")
FONT_DIR = os.path.join(ROOT, "src/assets/fonts")
FONTS = {
    "body": FontProperties(fname=os.path.join(FONT_DIR, "SourceHanSansCN-Regular.otf")),
    "title": FontProperties(fname=os.path.join(FONT_DIR, "AlimamaShuHeiTi-Bold.ttf")),
    "num": FontProperties(fname=os.path.join(FONT_DIR, "DIN-Bold.otf")),
}
HOSPITAL = "××医院 门诊医技综合楼"
DATE = "2026-10-16"

# 图层样式：color / lw（磅）/ ls 线型 / fill 填充 / z 叠放次序
STYLE = {
    "ZONE": dict(z=0),
    "AXIS": dict(color="#d23a2f", lw=0.35, ls=(0, (14, 3, 2, 3)), z=0.5, alpha=0.55),
    "HATCH": dict(color="#c9c9c9", lw=0.3, z=1),
    "FURN": dict(color="#9b9b9b", lw=0.35, z=2),
    "VOID": dict(color="#b8b8b8", lw=0.4, ls=(0, (4, 3)), z=2),
    "HIDDEN": dict(color="#808080", lw=0.45, ls=(0, (5, 3)), z=3),
    "STAIR": dict(color="#3a3a3a", lw=0.45, z=3),
    "ESC": dict(color="#3a3a3a", lw=0.45, z=3),
    "ELEV": dict(color="#3a3a3a", lw=0.45, z=3),
    "RAIL": dict(color="#4d6b8a", lw=0.8, z=3),
    "WALL": dict(fill="#2b2b2b", z=4),
    "COLUMN": dict(fill="#000000", z=4.5),
    "DOOR": dict(color="#1d1d1d", lw=0.45, z=5),
    "WINDOW": dict(color="#1d1d1d", lw=0.35, z=5),
    "AXIS_B": dict(color="#d23a2f", lw=0.6, z=6),
    "AXIS_T": dict(color="#222222", z=7),
    "DIM": dict(color="#2a5c9a", lw=0.4, z=6),
    "DIM_T": dict(color="#2a5c9a", z=7),
    "MARK": dict(fill="#d23a2f", z=6),
    "MARK_T": dict(color="#d23a2f", z=7),
    "TEXT": dict(color="#141414", z=8),
    "TEXT2": dict(color="#6f6f6f", z=8),
    "NUM": dict(color="#b5381c", z=8),
}
DASH = {"dash": (0, (3, 2))}


def lighten(hex_color, k):
    """颜色往白色混 k（0–1）"""
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return "#%02x%02x%02x" % tuple(round(c + (255 - c) * k) for c in (r, g, b))


class Canvas:
    """把 plan.py 的图元画进 matplotlib 坐标轴（数据坐标 = 米）。"""

    def __init__(self, ax, scale_in_per_m):
        self.ax = ax
        self.pt = scale_in_per_m * 72  # 每米多少磅

    def draw(self, prims, dx=0.0, dy=0.0, faded=False, skip=()):
        ax = self.ax
        lines = {}
        for p in prims:
            L = p["L"]
            if L in skip or (faded and L in ("FURN", "HATCH", "AXIS", "NUM")):
                continue
            st = STYLE.get(L, dict(color="#000", lw=0.4, z=3))
            color = st.get("color", "#000")
            if faded:
                color = lighten(color, 0.55)
            t = p["t"]
            if t == "line":
                key = (L, p.get("ls"))
                lines.setdefault(key, []).append([(p["a"][0] + dx, p["a"][1] + dy), (p["b"][0] + dx, p["b"][1] + dy)])
            elif t == "poly":
                pts = [(x + dx, y + dy) for x, y in p["pts"]]
                fill = p.get("fill")
                if fill:
                    fc = st.get("fill") if fill in ("wall", "column", "mark") else fill
                    if faded:
                        fc = lighten(fc, 0.6 if L in ("WALL", "COLUMN") else 0.4)
                    ax.add_patch(Polygon(pts, closed=True, fc=fc, ec="none", zorder=st["z"], antialiased=True))
                else:
                    ls = DASH.get(p.get("ls"), st.get("ls", "-"))
                    if not p["closed"]:
                        key = (L, p.get("ls"))
                        lines.setdefault(key, []).extend([[a, b] for a, b in zip(pts, pts[1:])])
                    else:
                        ax.add_patch(Polygon(pts, closed=True, fc="none", ec=color, lw=st.get("lw", 0.4), ls=ls, zorder=st["z"]))
            elif t == "arc":
                a0, a1 = p["a0"], p["a1"]
                ax.add_patch(Arc((p["c"][0] + dx, p["c"][1] + dy), 2 * p["r"], 2 * p["r"], theta1=a0, theta2=a1,
                                 ec=color, lw=st.get("lw", 0.4), zorder=st["z"]))
            elif t == "circle":
                fc = p.get("fill") or "none"
                ax.add_patch(Circle((p["c"][0] + dx, p["c"][1] + dy), p["r"], fc=fc if fc != "none" else "white" if L.startswith("AXIS") else "none",
                                    ec=color, lw=st.get("lw", 0.4), zorder=st["z"]))
            elif t == "text":
                if not p["s"]:
                    continue
                ax.text(p["p"][0] + dx, p["p"][1] + dy, p["s"], fontproperties=FONTS[p["font"]],
                        fontsize=p["h"] * self.pt * 1.05, color=color, ha=p["ha"], va={"center": "center_baseline"}.get(p["va"], p["va"]),
                        rotation=p["rot"], rotation_mode="anchor", zorder=st["z"])
        for (L, ls), segs in lines.items():
            st = STYLE.get(L, dict(color="#000", lw=0.4, z=3))
            color = lighten(st.get("color", "#000"), 0.55) if faded else st.get("color", "#000")
            ax.add_collection(LineCollection(segs, colors=color, linewidths=st.get("lw", 0.4),
                                             linestyles=DASH.get(ls, st.get("ls", "-")), zorder=st["z"], alpha=st.get("alpha", 1)))

    def text(self, x, y, s, h, color="#141414", font="body", ha="left", va="center", z=9, **kw):
        self.ax.text(x, y, s, fontproperties=FONTS[font], fontsize=h * self.pt * 1.05, color=color, ha=ha,
                     va={"center": "center_baseline"}.get(va, va), zorder=z, **kw)

    def rect(self, x0, y0, x1, y1, fc="none", ec="#222", lw=0.6, z=9):
        self.ax.add_patch(Polygon([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], closed=True, fc=fc, ec=ec, lw=lw, zorder=z))

    def line(self, a, b, color="#222", lw=0.6, z=9, ls="-"):
        self.ax.plot([a[0], b[0]], [a[1], b[1]], color=color, lw=lw, zorder=z, ls=ls, solid_capstyle="butt")


def sheet(extent, scale):
    (x0, y0), (x1, y1) = extent
    fig = plt.figure(figsize=((x1 - x0) * scale, (y1 - y0) * scale))
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(x0, x1)
    ax.set_ylim(y0, y1)
    ax.set_aspect("equal")
    ax.axis("off")
    fig.patch.set_facecolor("white")
    return fig, ax, Canvas(ax, scale)


# ---------------------------------------------------------------- 单层图
def north_arrow(cv, x, y, r=2.2):
    cv.ax.add_patch(Circle((x, y), r, fc="none", ec="#222", lw=0.6, zorder=9))
    cv.ax.add_patch(Polygon([(x, y + r * 0.95), (x - r * 0.32, y - r * 0.7), (x, y - r * 0.35)], closed=True, fc="#222", ec="#222", lw=0.4, zorder=9))
    cv.ax.add_patch(Polygon([(x, y + r * 0.95), (x + r * 0.32, y - r * 0.7), (x, y - r * 0.35)], closed=True, fc="white", ec="#222", lw=0.4, zorder=9))
    cv.text(x, y + r + 0.9, "北", 0.9, ha="center", va="bottom")


def legend(cv, x, y, row=1.45):
    cv.text(x, y, "图例", 0.95, font="title")
    y -= 1.7
    for key, (name, color) in pl.ZONES.items():
        cv.rect(x, y - 0.45, x + 2.4, y + 0.45, fc=color, ec="#888", lw=0.4)
        if key == "aux":
            for k in range(5):
                cv.line((x + 0.2 + k * 0.45, y - 0.45), (x + 0.65 + k * 0.45, y + 0.45), color="#c9c9c9", lw=0.3)
        cv.text(x + 3.0, y, name, 0.62)
        y -= row
    return y


def room_table(cv, x, y, rooms, f):
    cv.text(x, y, f"本层导航目的地（{sum(r['dest'] for r in rooms)} 个）", 0.95, font="title")
    y -= 1.7
    dests = [r for r in rooms if r["dest"]]
    col_w = 17.5
    for i, r in enumerate(dests):
        cx = x + (i // 10) * col_w
        cy = y - (i % 10) * 1.2
        cv.text(cx, cy, r["num"], 0.62, color="#b5381c", font="num")
        cv.text(cx + 2.4, cy, r["label"], 0.62)
    return y - 10 * 1.2


def title_block(cv, x0, y0, x1, y1, f):
    rows = [
        ("项目名称", HOSPITAL + "（模拟）"),
        ("图    名", f"{pl.FLOOR_CN[f]}平面图（{pl.FLOORS[f]} {pl.FLOOR_TITLE[f]}）"),
        ("比    例", "1:200"),
        ("层    高", f"{pl.FLOOR_H} m   柱网 7.2 × 7.2 m"),
        ("日    期", DATE),
        ("图    号", f"建施-0{f + 1}"),
        ("说    明", "虚构医院，仅用于导航演示"),
    ]
    cv.rect(x0, y0, x1, y1, ec="#222", lw=0.9)
    h = (y1 - y0) / len(rows)
    for i, (k, v) in enumerate(rows):
        yy = y1 - (i + 0.5) * h
        if i:
            cv.line((x0, y1 - i * h), (x1, y1 - i * h), lw=0.4)
        cv.text(x0 + 0.6, yy, k, 0.6, color="#555")
        cv.text(x0 + 6.4, yy, v, 0.62)
    cv.line((x0 + 5.8, y0), (x0 + 5.8, y1), lw=0.4)


def floor_sheet(f, rooms, prims, path):
    ext = ((-12.0, -17.5), (141.0, 56.0))
    scale = 0.105
    fig, ax, cv = sheet(ext, scale)
    cv.draw(prims)
    cv.draw(pl.annotations(f))
    # 图名
    cv.text(43.2, -13.4, f"{pl.FLOOR_CN[f]}平面图", 2.0, font="title", ha="right")
    cv.text(44.6, -13.4, "1:200", 1.2, font="num")
    cv.line((26.0, -14.9), (51.0, -14.9), lw=1.6)
    cv.line((26.0, -15.35), (51.0, -15.35), lw=0.5)
    # 右侧栏
    x = 102.0
    cv.text(x, 51.5, f"{pl.FLOORS[f]} · {pl.FLOOR_TITLE[f]}", 2.0, font="title")
    cv.text(x, 48.6, HOSPITAL + "（模拟）", 0.85, color="#555")
    north_arrow(cv, 134.5, 50.0)
    yb = legend(cv, x, 44.6)
    room_table(cv, x, yb - 1.4, rooms, f)
    title_block(cv, x, -16.5, 139.0, -3.0, f)
    fig.savefig(path, dpi=260)
    plt.close(fig)


# ---------------------------------------------------------------- 三层并排
DX = 112.0  # 并排时每层的横向间距


def all_sheet(floors, prims, path):
    ext = ((-8.0, -14.0), (2 * DX + 96.0, 53.0))
    scale = 0.075
    fig, ax, cv = sheet(ext, scale)
    for f in range(3):
        cv.draw(prims[f], dx=f * DX, skip=("AXIS",))
        cv.text(f * DX + 43.2, 48.6, f"{pl.FLOORS[f]}  {pl.FLOOR_TITLE[f]}", 2.2, font="title", ha="center")
        cv.text(f * DX + 43.2, 45.8, f"导航目的地 {pl.FLOORS[f][0]}01–{pl.FLOORS[f][0]}20", 0.9, color="#666", ha="center")
    # 图例
    x = 0.0
    for key, (name, color) in pl.ZONES.items():
        cv.rect(x, -9.2, x + 2.4, -8.0, fc=color, ec="#888", lw=0.4)
        cv.text(x + 3.0, -8.6, name, 0.9)
        x += 7.5 + len(name) * 0.95
    cv.text(0.0, -12.2, f"{HOSPITAL}（模拟） · 三层平面总图 · 柱网 7.2 m · 层高 {pl.FLOOR_H} m · 楼梯：东 / 西 · 电梯：1 号 / 2 号 · 中庭交叉式扶梯", 0.9, color="#555")
    fig.savefig(path, dpi=280)
    plt.close(fig)


# ---------------------------------------------------------------- 路网校核图
NAV_COLOR = {"walk": "#2f6fd6", "spur": "#7fa7e6", "stair": "#e07b16", "elevator": "#1f9d55", "escalator": "#8a4fd6"}


def draw_graph(cv, G, f, dx):
    segs, spurs = [], []
    for e in G.edges:
        if e["kind"] != "walk":
            continue
        a, b = G.nodes[e["a"]], G.nodes[e["b"]]
        if a["floor"] != f:
            continue
        seg = [(a["x"] + dx, a["y"]), (b["x"] + dx, b["y"])]
        (segs if e.get("label") else spurs).append(seg)
    cv.ax.add_collection(LineCollection(segs, colors=NAV_COLOR["walk"], linewidths=1.1, zorder=10))
    cv.ax.add_collection(LineCollection(spurs, colors=NAV_COLOR["spur"], linewidths=0.8, zorder=10))
    for n in G.nodes.values():
        if n["floor"] != f:
            continue
        x, y = n["x"] + dx, n["y"]
        k = n["kind"]
        if k == "path":
            cv.ax.add_patch(Circle((x, y), 0.22, fc=NAV_COLOR["walk"], ec="none", zorder=11))
        elif k in ("room", "wc", "desk", "gate"):
            cv.ax.add_patch(Circle((x, y), 0.32, fc="white", ec="#c0392b", lw=0.6, zorder=11))
        elif k in ("stair", "elevator", "escalator"):
            c = NAV_COLOR[k]
            cv.ax.add_patch(Polygon([(x - 0.6, y - 0.6), (x + 0.6, y - 0.6), (x + 0.6, y + 0.6), (x - 0.6, y + 0.6)], closed=True, fc=c, ec="white", lw=0.4, zorder=12))


def graph_sheet(floors, G, prims, path):
    ext = ((-8.0, -16.0), (2 * DX + 96.0, 54.0))
    scale = 0.075
    fig, ax, cv = sheet(ext, scale)
    for f in range(3):
        cv.draw(prims[f], dx=f * DX, faded=True)
        draw_graph(cv, G, f, f * DX)
        cv.text(f * DX + 20.0, 50.2, f"{pl.FLOORS[f]}  路网", 2.2, font="title", ha="center")
    # 扶梯方向说明
    for f in range(3):
        for e in pl.ESC:
            ends = pl.esc_ends(e)
            if f in ends:
                x, y = ends[f]
                cv.text(x + f * DX, y + (-1.4 if y < 18 else 1.4), ("↑" if e["up"] else "↓") + e["id"], 0.7, color=NAV_COLOR["escalator"], ha="center",
                        va="top" if y < 18 else "bottom")
    n_walk = sum(1 for e in G.edges if e["kind"] == "walk")
    items = [
        ("walk", "通道中线（主干）"), ("spur", "门口 / 梯口支线"), ("stair", "楼梯口"), ("elevator", "电梯厅"), ("escalator", "扶梯口（↑上行 ↓下行）"),
    ]
    x = 0.0
    for k, name in items:
        if k in ("walk", "spur"):
            cv.line((x, -8.6), (x + 2.6, -8.6), color=NAV_COLOR[k], lw=1.4)
        else:
            cv.rect(x + 0.7, -9.2, x + 1.9, -8.0, fc=NAV_COLOR[k], ec="white")
        cv.text(x + 3.2, -8.6, name, 0.9)
        x += 7.0 + len(name) * 0.95
    cv.ax.add_patch(Circle((x + 1.3, -8.6), 0.45, fc="white", ec="#c0392b", lw=0.8, zorder=11))
    cv.text(x + 2.4, -8.6, "可选起点 / 终点（房间、卫生间、服务台、入口）", 0.9)
    places = sum(1 for n in G.nodes.values() if n["kind"] in ("room", "wc", "desk", "gate"))
    cv.text(0.0, -12.4, f"路网校核：{len(G.nodes)} 个节点、{n_walk} 条步行边；竖向连接 楼梯 2 部（上 {nav.STAIR_UP:.0f} s / 下 {nav.STAIR_DOWN:.0f} s 每层）、"
                        f"电梯 2 台（候梯 {nav.ELEV_WAIT:.0f} s + 每层 {nav.ELEV_PER_FLOOR:.0f} s）、扶梯 4 条（每层 {nav.ESC_RIDE:.0f} s，单向）；{places} 个起终点在两种模式下全部可达", 0.9, color="#555")
    fig.savefig(path, dpi=280)
    plt.close(fig)


# ---------------------------------------------------------------- 路线样例
ROUTES = [
    ("南门（主入口）", "核磁共振室", "recommend", "#e4572e"),
    ("南门（主入口）", "核磁共振室", "accessible", "#1f9d55"),
    ("出入院办理处", "妇科诊室1", "recommend", "#2f6fd6"),
    ("彩超室1", "西药房", "recommend", "#8a4fd6"),
]


def routes_sheet(floors, G, places, prims, path):
    byname = {p["name"]: p for p in places}
    pbn = {p["node"]: p for p in places}
    row_h = 66.0
    ext = ((-8.0, -len(ROUTES) * row_h + 6.0), (2 * DX + 96.0 + 92.0, 12.0))
    scale = 0.05
    fig, ax, cv = sheet(ext, scale)
    report = []
    for i, (a, b, mode, color) in enumerate(ROUTES):
        dy = -i * row_h - 46.0
        src, dst = byname[a]["node"], byname[b]["node"]
        nodes, cost = nav.shortest(G, src, dst, mode)
        steps = nav.describe(G, nodes, pbn)
        for f in range(3):
            cv.draw(prims[f], dx=f * DX, dy=dy, faded=True)
            cv.text(f * DX + 43.2, dy + 47.0, pl.FLOORS[f], 2.4, font="title", ha="center", color="#888")
        for f, pts in nav.route_polylines(G, nodes):
            xs = [x + f * DX for x, _ in pts]
            ys = [y + dy for _, y in pts]
            ax.plot(xs, ys, color=color, lw=3.0, zorder=12, solid_capstyle="round", solid_joinstyle="round")
        # 起终点与换层点
        n0, n1 = G.nodes[src], G.nodes[dst]
        ax.add_patch(Circle((n0["x"] + n0["floor"] * DX, n0["y"] + dy), 1.1, fc="#1f9d55", ec="white", lw=1.0, zorder=13))
        ax.add_patch(Circle((n1["x"] + n1["floor"] * DX, n1["y"] + dy), 1.1, fc="#c0392b", ec="white", lw=1.0, zorder=13))
        cv.text(n0["x"] + n0["floor"] * DX, n0["y"] + dy + 1.6, "起", 1.2, ha="center", va="bottom", color="#1f9d55", font="title", z=14)
        cv.text(n1["x"] + n1["floor"] * DX, n1["y"] + dy + 1.6, "终", 1.2, ha="center", va="bottom", color="#c0392b", font="title", z=14)
        for leg in nav.legs(G, nodes):
            if leg["kind"] == "walk":
                continue
            for end in (leg["a"], leg["b"]):
                n = G.nodes[end]
                ax.add_patch(Polygon([(n["x"] + n["floor"] * DX - 0.9, n["y"] + dy - 0.9), (n["x"] + n["floor"] * DX + 0.9, n["y"] + dy - 0.9),
                                      (n["x"] + n["floor"] * DX + 0.9, n["y"] + dy + 0.9), (n["x"] + n["floor"] * DX - 0.9, n["y"] + dy + 0.9)],
                                     closed=True, fc=NAV_COLOR[leg["kind"]], ec="white", lw=0.8, zorder=13))
        # 分步提示
        tx = 2 * DX + 100.0
        length = nav.total_length(G, nodes)
        cv.text(tx, dy + 46.0, f"{a}  至  {b}", 2.2, font="title", color=color)
        cv.text(tx, dy + 42.6, f"{nav.MODES[mode]} · 步行约 {round(length)} 米 · 预计 {math.ceil(cost / 60)} 分钟", 1.25, color="#555")
        for k, s in enumerate(steps):
            yy = dy + 38.6 - k * 2.9
            cv.text(tx, yy, f"{k + 1:>2}", 1.5, color=color, font="num")
            cv.text(tx + 3.0, yy, f"[{pl.FLOORS[s['floor']]}] {s['text']}", 1.5)
        report.append((a, b, mode, cost, length, steps))
    fig.savefig(path, dpi=300)
    plt.close(fig)
    return report


# ---------------------------------------------------------------- DXF
DXF_LAYERS = {
    # 图层: (ACI 颜色, 线型)
    "AXIS": (1, "CENTER"), "AXIS_B": (1, "CONTINUOUS"), "AXIS_T": (7, "CONTINUOUS"),
    "WALL": (7, "CONTINUOUS"), "COLUMN": (7, "CONTINUOUS"), "DOOR": (4, "CONTINUOUS"), "WINDOW": (4, "CONTINUOUS"),
    "STAIR": (2, "CONTINUOUS"), "ESC": (2, "CONTINUOUS"), "ELEV": (2, "CONTINUOUS"), "RAIL": (5, "CONTINUOUS"),
    "VOID": (8, "DASHED"), "HIDDEN": (8, "DASHED"), "FURN": (8, "CONTINUOUS"), "HATCH": (9, "CONTINUOUS"),
    "DIM": (3, "CONTINUOUS"), "DIM_T": (3, "CONTINUOUS"), "TEXT": (7, "CONTINUOUS"), "TEXT2": (8, "CONTINUOUS"),
    "NUM": (1, "CONTINUOUS"), "MARK": (1, "CONTINUOUS"), "MARK_T": (1, "CONTINUOUS"), "TITLE": (7, "CONTINUOUS"),
}
DXF_DX = 120.0


def write_dxf(floors, prims, G, path):
    d = dxf.DXF()
    for name, (color, lt) in DXF_LAYERS.items():
        d.layer(name, color, lt)
    d.layer("NAV", 5, "CONTINUOUS", off=True)  # 路网，默认关闭
    for f in range(3):
        dx = f * DXF_DX
        for p in list(prims[f]) + list(pl.annotations(f)):
            L = p["L"]
            if L == "ZONE":
                continue
            t = p["t"]
            if t == "line":
                d.line(L, (p["a"][0] + dx, p["a"][1]), (p["b"][0] + dx, p["b"][1]))
            elif t == "poly":
                pts = [(x + dx, y) for x, y in p["pts"]]
                if p.get("fill") and len(pts) == 4:
                    d.solid(L, pts)
                elif p.get("fill"):
                    for k in range(1, len(pts) - 1):
                        d.solid(L, [pts[0], pts[k], pts[k + 1]])
                else:
                    d.poly(L, pts, p["closed"])
            elif t == "arc":
                d.arc(L, (p["c"][0] + dx, p["c"][1]), p["r"], p["a0"], p["a1"])
            elif t == "circle":
                d.circle(L, (p["c"][0] + dx, p["c"][1]), p["r"])
            elif t == "text" and p["s"]:
                d.text(L, (p["p"][0] + dx, p["p"][1]), p["s"], p["h"], p["ha"], p["va"], p["rot"])
        d.text("TITLE", (dx + 43.2, -13.4), f"{pl.FLOOR_CN[f]}平面图（{pl.FLOORS[f]} {pl.FLOOR_TITLE[f]}） 1:200", 1.8)
        d.line("TITLE", (dx + 22.0, -14.9), (dx + 64.4, -14.9))
        for e in G.edges:
            a, b = G.nodes[e["a"]], G.nodes[e["b"]]
            if e["kind"] == "walk" and a["floor"] == f:
                d.line("NAV", (a["x"] + dx, a["y"]), (b["x"] + dx, b["y"]))
    d.text("TITLE", (DXF_DX + 43.2, 60.0), HOSPITAL + "（模拟） 平面图  单位：m", 2.4)
    d.save(path, ((-12.0, -18.0), (2 * DXF_DX + 100.0, 62.0)))


# ---------------------------------------------------------------- JSON（给页面用）
def poly_box(p, r3):
    """WALL 图层的多边形都是轴向矩形 → [x0, y0, x1, y1]"""
    xs = [q[0] for q in p["pts"]]
    ys = [q[1] for q in p["pts"]]
    return [r3(min(xs)), r3(min(ys)), r3(max(xs)), r3(max(ys))]


def export_json(floors, prims, G, places, path):
    r3 = lambda v: round(v, 3)  # noqa: E731
    data = dict(
        meta=dict(
            name=HOSPITAL, size=[pl.W, pl.D], grid=pl.GRID, floorHeight=pl.FLOOR_H, floors=pl.FLOORS, floorTitles=pl.FLOOR_TITLE,
            coords="x 向东、y 向北（米），原点为西南角 ①/Ⓐ 轴交点", generatedBy="scripts/hospital/draw_plan.py",
            zones={k: dict(name=v[0], color=v[1]) for k, v in pl.ZONES.items()},
        ),
        rooms=[
            dict(
                id=r.get("num") or f"{pl.FLOORS[f]}-{r['key']}", num=r.get("num"), name=r["label"], kind=r["kind"], zone=r["zone"],
                floor=f, rect=[r3(v) for v in r["rect"]], dest=r["dest"], open=r["open"],
                door=dict(p=[r3(v) for v in r["door"]["p"]], w=r["door"]["w"], side=r["door"]["side"]) if r["door"] else None,
                nav=[r3(v) for v in pl.nav_point(r)],
            )
            for f, rooms in enumerate(floors) for r in rooms
        ],
        # 三维用的墙：主墙 + 房间内隔断（WALL 图层的全部矩形）
        walls=[[poly_box(p, r3) for p in prims[f] if p["L"] == "WALL" and p["t"] == "poly"] for f in range(3)],
        # 外墙开口：[类型, 方向, 墙线坐标, 起, 止]，窗洞补玻璃、入口补玻璃门
        openings=[[[k, o, r3(c), r3(a), r3(b)] for k, o, c, a, b in prims[f].meta["openings"]] for f in range(3)],
        # 家具：闭合多边形挤出成矮块，圆是椅子（[x, y, r]）
        furniture=[dict(
            polys=[[[r3(x), r3(y)] for x, y in p["pts"]] for p in prims[f] if p["L"] == "FURN" and p["t"] == "poly" and p["closed"] and not p.get("ls")],
            chairs=[[r3(p["c"][0]), r3(p["c"][1]), r3(p["r"])] for p in prims[f] if p["L"] == "FURN" and p["t"] == "circle" and p["r"] < 0.5],
        ) for f in range(3)],
        columns=[[i * pl.GRID, j * pl.GRID] for i in range(pl.NX + 1) for j in range(pl.NY + 1) if (round(i * pl.GRID, 1), round(j * pl.GRID, 1)) not in pl.NO_COLUMN],
        void=pl.VOID,
        stairs={s: dict(name=pl.STAIR_NAME[s], rect=pl.STAIR[s], door=pl.stair_door(s), **pl.stair_geom(s)) for s in pl.STAIR},
        wc={s: dict(rect=pl.WC[s], door=pl.wc_door(s)) for s in pl.WC},
        elevators={e: dict(name=f"{e}号电梯", rect=rect, hall=pl.elev_hall(e)) for e, rect in pl.ELEV.items()},
        escalators=[dict(e, width=pl.ESC_W, ends={str(k): v for k, v in pl.esc_ends(e).items()}, y=pl.ESC_Y) for e in pl.ESC],
        places=[dict(p) for p in places],
        nav=dict(
            speed=nav.SPEED, stairUp=nav.STAIR_UP, stairDown=nav.STAIR_DOWN, escRide=nav.ESC_RIDE,
            elevWait=nav.ELEV_WAIT, elevDoor=nav.ELEV_DOOR, elevPerFloor=nav.ELEV_PER_FLOOR,
            nodes=[dict(id=n["id"], f=n["floor"], x=n["x"], y=n["y"], k=n["kind"], **({"name": n["name"]} if n.get("name") else {})) for n in G.nodes.values()],
            edges=[dict(a=e["a"], b=e["b"], c=e["cost"], k=e["kind"], **({"oneway": True} if e["oneway"] else {}),
                        **({"label": e["label"]} if e.get("label") else {}), **({"conn": e["conn"]} if e.get("conn") else {})) for e in G.edges],
        ),
    )
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))


def main():
    os.makedirs(OUT, exist_ok=True)
    floors = pl.build_rooms()
    prims = [pl.floor_prims(f, floors[f]) for f in range(3)]
    G, places = nav.build_graph(floors)
    for f in range(3):
        floor_sheet(f, floors[f], prims[f], os.path.join(OUT, f"plan-{pl.FLOORS[f]}.png"))
        print("写出", f"plan-{pl.FLOORS[f]}.png")
    all_sheet(floors, prims, os.path.join(OUT, "plan-all.png"))
    graph_sheet(floors, G, prims, os.path.join(OUT, "nav-graph.png"))
    report = routes_sheet(floors, G, places, prims, os.path.join(OUT, "nav-routes.png"))
    write_dxf(floors, prims, G, os.path.join(OUT, "hospital-plan.dxf"))
    page_data = os.path.join(ROOT, "src/views/hospital/data/plan.json")
    os.makedirs(os.path.dirname(page_data), exist_ok=True)
    export_json(floors, prims, G, places, page_data)
    print("写出 plan-all.png / nav-graph.png / nav-routes.png / hospital-plan.dxf / src/views/hospital/data/plan.json")
    # 可达性自检
    gate = next(p["node"] for p in places if p["id"] == "gateS")
    bad = [(m, p["name"]) for m in nav.MODES for p in places if nav.shortest(G, gate, p["node"], m)[0] is None]
    print(f"路网 {len(G.nodes)} 节点 / {len(G.edges)} 边；起终点 {len(places)} 个；不可达 {len(bad)} 个", bad or "")
    for a, b, mode, cost, length, steps in report:
        print(f"\n{a} → {b}（{nav.MODES[mode]}）{cost:.0f} s / {length:.0f} m")
        for s in steps:
            print("   ", pl.FLOORS[s["floor"]], s["text"])


if __name__ == "__main__":
    main()

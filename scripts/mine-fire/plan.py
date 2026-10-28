"""
/mine-fire 全矿平面数据：从用户提供的《2#煤层避灾路线图》（真实矿井 CAD 截图 2000 × 1539，1:5000）描出来的巷网（页面企业名虚构为青崖煤矿）
----------------------------------------------------------
用法：
    python3 scripts/mine-fire/plan.py [CAD 截图路径]
输出：
    src/views/mine-fire/data/plan.json        页面数据（生成文件，不要手改）
    docs/design/mine-fire/plan-v1.png          描线核对图（叠在 CAD 截图上，给截图路径时才画）

坐标：
    CAD 像素 (px, py) → 平面坐标（米）e = (px - 890) × 5（向东），n = -(py - 795) × 5（向北）。
    原点 = 主大巷与东翼大巷交叉口；CAD 自带坐标网约 101 px 一格，按 500 m 一格算（约 5 m/px，假设）。
    three.js 里 x = e、z = -n（北 = -z），镜头从南往北看。

来源说明：
    - 井田边界、巷道、工作面、两处永久避难硐室都按 CAD 描；南边界被图框截断，按图框下沿封口。
    - 四个硐室（空压机站、主排水泵房、井下主变电所、一盘区变电所）CAD 没标，按定稿概念图的位置假设：
      前三个在井底车场交叉口周围，一盘区变电所在主大巷西侧、交叉口到南拐点约 45 % 处。
    - 井筒：CAD 只有一个安全出口符号，按定稿画主井、副井两个立井（数量和类型待矿方确认）。
    - 风流：假设新鲜风从井底车场沿主大巷向南、沿东翼大巷向东（待通风系统图确认）。
"""
import json
import math
import os
import sys

SCALE = 5.0  # 米 / CAD 像素（假设：坐标网 500 m 一格）
ORIGIN = (890.0, 795.0)  # 主大巷与东翼大巷交叉口（CAD 像素）

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_JSON = os.path.join(ROOT, "src", "views", "mine-fire", "data", "plan.json")
# 设计文档目录 docs/ 不入库，只在主检出里有；工作树里运行时往主检出写
DOCS = os.environ.get(
    "MINE_FIRE_DOCS",
    os.path.join(ROOT, "docs", "design", "mine-fire"),
)


def w(px, py):
    """CAD 像素 → 平面坐标（米），保留 1 位小数"""
    return [round((px - ORIGIN[0]) * SCALE, 1), round(-(py - ORIGIN[1]) * SCALE, 1)]


def line(*pts):
    return [w(*p) for p in pts]


# ---------------------------------------------------------------- 井田边界
# 南边界：CAD 图框把井田截在 py 1505；三维里按第二段南界（py 1343）截齐，让煤层板前沿落在画面里（同定稿的沙盘框）
BOUNDARY = line(
    (125, 1343),  # 三盘区西界南端（截齐处）
    (125, 1065),  # 三盘区西界
    (1645, 237),  # 与王家岭煤田分界（西北长斜边）
    (1865, 538),
    (1785, 625),
    (1472, 1110),
    (1138, 1110),
    (1138, 1332),
    (845, 1343),
)

# ---------------------------------------------------------------- 巷道组
# 每组是一条"走廊"：中心线 + 并行巷道数 lanes（CAD 上平行的 2–3 条大巷画成一条玻璃走廊，里面按 lanes 排灯带）
CORRIDORS = [
    {
        "id": "C-N",
        "name": "主大巷组",
        "lanes": 3,
        "pts": line((891, 760), (889, 795), (884, 1000), (877, 1258)),
    },
    {
        "id": "C-E",
        "name": "东翼大巷组",
        "lanes": 3,
        "pts": line((889, 795), (1145, 795), (1404, 795), (1505, 795)),
    },
    {
        "id": "C-W",
        "name": "西翼大巷组",
        "lanes": 3,
        "pts": line((877, 1258), (640, 1258), (480, 1258), (375, 1258), (352, 1286)),
    },
    {
        "id": "C-2N",
        "name": "二盘区北延巷",
        "lanes": 2,
        "pts": line((1404, 795), (1404, 368)),
    },
    {
        "id": "C-D1",
        "name": "三盘区下山",
        "lanes": 1,
        "pts": line((688, 1258), (540, 1282), (385, 1308)),
    },
    {
        "id": "C-D2",
        "name": "西翼联络斜巷",
        "lanes": 1,
        "pts": line((676, 1258), (556, 1212)),
    },
]

# ---------------------------------------------------------------- 工作面（矩形：两条顺槽 + 端部切眼）
# foot = 顺槽和大巷相接的一端，far = 切眼所在的远端；width 为两条顺槽的间距
PANELS = [
    {"id": "WF-201", "name": "二盘区 201 工作面", "rect": [w(1115, 795), w(1175, 533)], "state": "掘进"},
    {"id": "WF-202", "name": "二盘区 202 工作面", "rect": [w(1313, 795), w(1375, 423)], "state": "回采"},
    {"id": "WF-101", "name": "南翼 101 工作面", "rect": [w(882, 1180), w(1110, 1240)], "state": "回采"},
]

# ---------------------------------------------------------------- 井筒（按定稿：主井、副井两个立井）
SHAFTS = [
    {"id": "SH-1", "name": "主井", "at": w(872, 734)},
    {"id": "SH-2", "name": "副井", "at": w(908, 732), "exit": True},
]

# ---------------------------------------------------------------- 受监控硐室（位置是假设，见文件头）
# axis = 硐室长轴方向（e, n 单位向量）；side = 硐室在走廊的哪一侧（显示用）
# 三维里硐室按 380 × 170 m 的放大玻璃房显示，位置按这个尺寸错开：
# 井底车场三间在主大巷北端排成一排（同定稿：DS-01 西、DS-02 骑在主大巷端头、DS-03 东），DS-04 在主大巷西侧
CHAMBERS = [
    {"id": "DS-01", "name": "空压机站", "at": w(810, 765), "axis": [1, 0]},
    {"id": "DS-02", "name": "主排水泵房", "at": w(890, 765), "axis": [1, 0]},
    {"id": "DS-03", "name": "井下主变电所", "at": w(970, 765), "axis": [1, 0]},
    {"id": "DS-04", "name": "一盘区变电所", "at": w(856, 1010), "axis": [0, 1]},
]

# ---------------------------------------------------------------- 永久避难硐室（CAD 引线终点）
# 三维里画成套在大巷上的胶囊舱（同定稿），所以位置取在大巷中心线上：RC-01 在主大巷、RC-02 在东翼大巷
REFUGES = [
    {"id": "RC-01", "name": "永久避难硐室（南）", "at": w(878.5, 1204), "axis": [0, 1], "cap": 100},
    {"id": "RC-02", "name": "二盘区永久避难硐室", "at": w(1145, 795), "axis": [1, 0], "cap": 100},
]

# ---------------------------------------------------------------- 盘区名（CAD 文字位置）
ZONES = [
    {"name": "一盘区", "at": w(605, 845)},
    {"name": "二盘区", "at": w(1205, 612)},
    {"name": "三盘区", "at": w(195, 1177)},
    {"name": "四盘区", "at": w(1530, 410)},
]

# ---------------------------------------------------------------- 避灾路线（定稿的两条：火点北侧上风侧、南侧下风侧）
ROUTES = [
    {
        "id": "R1",
        "side": "上风侧",
        "to": "SH-2",
        "pts": line((884, 1000), (889, 795), (891, 760), (908, 732)),
    },
    {
        "id": "R2",
        "side": "下风侧",
        "to": "RC-01",
        "pts": line((883, 1030), (880, 1150), (878.5, 1204)),
    },
]


def length(pts):
    return sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))


def build():
    data = {
        "meta": {
            "source": "2#煤层避灾路线图（用户提供的真实矿井 CAD 截图，1:5000；页面企业名虚构为青崖煤矿）",
            "scale": f"{SCALE} m / CAD px（坐标网按 500 m 一格，假设）",
            "origin": "主大巷与东翼大巷交叉口；e 向东、n 向北（米）",
            "assumed": ["四个硐室位置", "井筒数量与类型", "风流方向", "工作面编号与状态"],
        },
        "boundary": BOUNDARY,
        "corridors": [{**c, "length": round(length(c["pts"]))} for c in CORRIDORS],
        "panels": PANELS,
        "shafts": SHAFTS,
        "chambers": CHAMBERS,
        "refuges": REFUGES,
        "zones": ZONES,
        "routes": [{**r, "length": round(length(r["pts"]))} for r in ROUTES],
    }
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    print("写出", os.path.relpath(OUT_JSON, ROOT))
    return data


def draw_check(data, cad_path):
    """把描好的线按像素画回 CAD 截图上，核对有没有描偏"""
    from PIL import Image, ImageDraw

    im = Image.open(cad_path).convert("RGB")
    d = ImageDraw.Draw(im)

    def px(p):
        return (p[0] / SCALE + ORIGIN[0], -p[1] / SCALE + ORIGIN[1])

    d.line([px(p) for p in data["boundary"]] + [px(data["boundary"][0])], fill=(0, 140, 255), width=3)
    for c in data["corridors"]:
        d.line([px(p) for p in c["pts"]], fill=(0, 200, 230), width=4 + c["lanes"] * 2)
    for p in data["panels"]:
        a, b = px(p["rect"][0]), px(p["rect"][1])
        d.rectangle([min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1])], outline=(255, 140, 0), width=3)
    for r in data["routes"]:
        d.line([px(p) for p in r["pts"]], fill=(0, 220, 90), width=3)
    for k, col in (("chambers", (255, 40, 40)), ("refuges", (0, 200, 80)), ("shafts", (160, 60, 255))):
        for o in data[k]:
            x, y = px(o["at"])
            d.ellipse([x - 7, y - 7, x + 7, y + 7], outline=col, width=3)
            d.text((x + 9, y - 6), o["id"], fill=col)
    os.makedirs(DOCS, exist_ok=True)
    out = os.path.join(DOCS, "plan-v1.png")
    im.save(out)
    print("写出", out)


if __name__ == "__main__":
    data = build()
    if len(sys.argv) > 1:
        draw_check(data, sys.argv[1])

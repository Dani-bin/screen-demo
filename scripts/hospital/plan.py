"""模拟医院 · 门诊医技综合楼 —— 平面数据与 CAD 图元。

用户确认的设定（2026-10-16，两轮问答，详见 docs/design/hospital/README.md）：
  单栋三层；每层 20 个导航目的地房间（全楼 60 个）；回字形平面 86.4 × 43.2 m，柱网 7.2 m，层高 4.5 m；
  中庭一组交叉式扶梯（每两层之间一上一下）、中庭北侧电梯厅 2 台客梯、东西两端各一部楼梯；
  南主入口 / 东急诊入口 / 北次入口；目的地房间号 x01–x20，自西南角起顺时针编。

坐标约定（之后 three.js 建模沿用同一套）：
  x 向东、y 向北（米），原点为西南角 ①/Ⓐ 轴交点；墙体中线落在轴线 / 模数线上。
  平面自外向内：外圈房间（进深 7.2 m）→ 环形走廊（宽 3.6 m）→ 核心区（大厅 / 候诊 / 中庭 / 电梯厅）。
  外圈房间按 3.6 m 模数（半跨）划分：南、北两侧各 20 个模数（自西向东编 0–19），东西两侧按固定槽位。

本模块不依赖绘图库：只产出房间表和"图元"（线、多边形、圆弧、文字，均带图层名），
由 draw_plan.py 分别渲染成 PNG（matplotlib）和 DXF。
"""

import math

# ---------------------------------------------------------------- 基本尺寸（米）
GRID = 7.2  # 柱网
MOD = 3.6  # 外圈房间模数
NX, NY = 12, 6
W, D = GRID * NX, GRID * NY  # 86.4 × 43.2
FLOOR_H = 4.5
FLOORS = ["1F", "2F", "3F"]
FLOOR_TITLE = ["门诊大厅层", "门诊诊室层", "医技检查层"]
FLOOR_CN = ["一层", "二层", "三层"]
STRIP = 7.2  # 外圈房间进深
COR = 3.6  # 环形走廊宽
T_EXT, T_INT, T_THIN = 0.3, 0.2, 0.12  # 外墙 / 内隔墙 / 轻质隔断厚度
COL = 0.6  # 柱截面

# 走廊中线（也是导航路网的主干）
XW, XE = STRIP + COR / 2, W - STRIP - COR / 2  # 9.0 / 77.4
YS, YN = STRIP + COR / 2, D - STRIP - COR / 2  # 9.0 / 34.2

VOID = (28.8, 14.4, 57.6, 21.6)  # 中庭：1F 为大厅地面，2F / 3F 为上空
Y_MID = 24.6  # 中庭北侧通道中线
X_AXIS = 45.0  # 大厅中轴（南主入口、北入口都落在这条线上）
X_WAIT = {"W": 19.8, "E": 66.6}  # 东西核心候诊区的南北向通道

# 核心区里的柜台式房间（1F 挂号收费 / 西药房，3F 预约登记 / 报告打印），柜台朝南对着大厅
CORE_ROOM = {"CORE_W": (12.6, 27.6, 27.0, 32.4), "CORE_E": (59.4, 27.6, 73.8, 32.4)}
STAIR = {"W": (0.0, 14.4, STRIP, 21.6), "E": (W - STRIP, 21.6, W, 28.8)}
WC = {"W": (0.0, 21.6, STRIP, 28.8), "E": (W - STRIP, 14.4, W, 21.6)}
STAIR_NAME = {"W": "西楼梯", "E": "东楼梯"}
# 电梯井（含井壁），轿厢门朝南开向电梯厅
ELEV = {"1": (50.6, 29.0, 53.6, 32.2), "2": (54.0, 29.0, 57.0, 32.2)}

# 中庭扶梯：交叉式（剪刀式）布置，4 条梯并排横跨中庭（南北走向），每两层之间一上一下。
#   1F↔2F（A 上 / B 下）：下端在 1F 中庭南侧，上端在 2F 中庭北侧；
#   2F↔3F（C 上 / D 下）：下端在 2F 中庭北侧，上端在 3F 中庭南侧。
#   这样 2F 出扶梯后掉头几步就能换乘继续上楼。
ESC_W = 1.6  # 单条扶梯总宽（含扶手）
ESC_Y = (12.0, 14.4, 21.6, 24.0)  # 南端梯头外沿 / 南梳齿板 / 北梳齿板 / 北端梯头外沿
ESC = [
    dict(id="A", x=40.4, lo=0, hi=1, up=True, lo_end="S"),
    dict(id="B", x=42.2, lo=0, hi=1, up=False, lo_end="S"),
    dict(id="C", x=44.2, lo=1, hi=2, up=True, lo_end="N"),
    dict(id="D", x=46.0, lo=1, hi=2, up=False, lo_end="N"),
]

# 去掉的柱子：中庭两条长边在 ⑦ 轴（x = 43.2）处正好落在扶梯之间，按大跨度梁处理
NO_COLUMN = {(43.2, 14.4), (43.2, 21.6)}

# ---------------------------------------------------------------- 分区与房间类型
ZONES = {
    # 分区: (图例名, 填色)
    "clinic": ("门诊诊室", "#e2edfa"),
    "exam": ("医技检查", "#ebe4f7"),
    "emergency": ("急诊", "#fbe3de"),
    "service": ("服务 / 药房 / 收费", "#dff2e5"),
    "public": ("公共 / 候诊", "#f6f6f2"),
    "traffic": ("楼梯 / 电梯 / 扶梯", "#faefcf"),
    "wc": ("卫生间", "#dcf0f2"),
    "aux": ("辅助用房（不作导航目的地）", "#ebebeb"),
}

# 类型 → (分区, 是否导航目的地)
KIND = {
    "clinic": ("clinic", True),
    "clinic_ped": ("clinic", True),
    "clinic_gyn": ("clinic", True),
    "clinic_eye": ("clinic", True),
    "clinic_tcm": ("clinic", True),
    "dental": ("clinic", True),
    "treat": ("clinic", True),
    "clinic_er": ("emergency", True),
    "rescue": ("emergency", True),
    "infusion": ("emergency", True),
    "us": ("exam", True),
    "func": ("exam", True),
    "ct": ("exam", True),
    "mri": ("exam", True),
    "xray": ("exam", True),
    "mammo": ("exam", True),
    "endo": ("exam", True),
    "recovery": ("exam", True),
    "checkup": ("exam", True),
    "patho": ("exam", True),
    "lab": ("exam", True),
    "blood": ("exam", True),
    "service": ("service", True),
    "cashier": ("service", True),
    "pharmacy": ("service", True),
    "pharmacy_cn": ("service", True),
    "triage": ("service", True),
    "mother": ("service", True),
    "aux": ("aux", False),
    "waiting": ("public", False),
    "entrance": ("public", False),
}
# 放射类房间做铅防护，不开外窗
NO_WINDOW = {"ct", "mri", "xray", "mammo"}
DOOR_W = {"rescue": 1.8, "ct": 1.5, "mri": 1.5, "xray": 1.5, "infusion": 1.5, "lab": 1.5}

# ---------------------------------------------------------------- 各层房间表
# 位置：("s", i0, i1) 南侧第 i0..i1 个模数 / ("n", …) 北侧 / 东西侧与核心区的固定槽位名
# 目的地房间每层恰好 20 个；辅助用房、候诊区、入口门厅不计入
PROGRAM = [
    # ---- 1F 门诊大厅层：挂号收费、药房、检验、急诊、儿科
    [
        ("W_SW", "出入院办理处", "service"),
        ("W1", "病案复印室", "service"),
        ("W2", "母婴室", "mother"),
        ("W_NW", "儿科候诊区", "waiting"),
        (("n", 0), "儿科诊室", "clinic_ped"),
        (("n", 1), "儿科诊室", "clinic_ped"),
        (("n", 2, 3), "儿科治疗室", "aux"),
        (("n", 4, 5), "心电图室", "func"),
        (("n", 6, 8), "采血室", "blood"),
        (("n", 9, 10), "北入口门厅", "entrance"),
        (("n", 11, 14), "检验科", "lab"),
        (("n", 15, 16), "药库", "aux"),
        (("n", 17, 19), "中药煎药室", "aux"),
        ("E_NE", "中药房", "pharmacy_cn"),
        ("E2", "污洗间", "aux"),
        ("E1", "急诊入口", "entrance"),
        ("E_SE", "抢救室", "rescue"),
        (("s", 19), "急诊诊室", "clinic_er"),
        (("s", 18), "急诊诊室", "clinic_er"),
        (("s", 15, 17), "输液室", "infusion"),
        (("s", 14), "换药室", "treat"),
        (("s", 13), "注射室", "treat"),
        (("s", 12), "消防控制室", "aux"),
        (("s", 8, 11), "主入口门厅", "entrance"),
        (("s", 7), "预检分诊", "triage"),
        (("s", 6), "值班室", "aux"),
        (("s", 5), "便民门诊", "clinic"),
        (("s", 2, 4), "医保服务中心", "service"),
        (("s", 0, 1), "门诊办公室", "aux"),
        ("CORE_W", "挂号收费处", "cashier"),
        ("CORE_E", "西药房", "pharmacy"),
    ],
    # ---- 2F 门诊诊室层：内科（西南）、外科（东南）、妇科 / 中医（西北）、五官 / 口腔（东北）
    [
        ("W_SW", "内科处置室", "aux"),
        ("W1", "内科医生办公室", "aux"),
        ("W2", "妇科处置室", "aux"),
        ("W_NW", "妇科候诊区", "waiting"),
        (("n", 0, 1), "妇科诊室", "clinic_gyn"),
        (("n", 2, 3), "妇科诊室", "clinic_gyn"),
        (("n", 4, 6), "中医科", "clinic_tcm"),
        (("n", 7, 8), "示教室", "aux"),
        (("n", 9, 10), "北侧候诊区", "waiting"),
        (("n", 11, 12), "眼科", "clinic_eye"),
        (("n", 13), "耳鼻喉科", "clinic"),
        (("n", 14), "皮肤科", "clinic"),
        (("n", 15, 16), "五官候诊区", "waiting"),
        (("n", 17, 19), "五官治疗室", "aux"),
        ("E_NE", "口腔科", "dental"),
        ("E2", "污洗间", "aux"),
        ("E1", "库房", "aux"),
        ("E_SE", "石膏室", "aux"),
        (("s", 17, 19), "外科医生办公室", "aux"),
        (("s", 16), "泌尿外科", "clinic"),
        (("s", 15), "骨科诊室", "clinic"),
        (("s", 14), "骨科诊室", "clinic"),
        (("s", 13), "普外科诊室", "clinic"),
        (("s", 12), "普外科诊室", "clinic"),
        (("s", 8, 11), "南侧候诊区", "waiting"),
        (("s", 7), "内分泌科", "clinic"),
        (("s", 6), "神经内科", "clinic"),
        (("s", 5), "消化内科诊室", "clinic"),
        (("s", 4), "消化内科诊室", "clinic"),
        (("s", 3), "呼吸内科诊室", "clinic"),
        (("s", 2), "呼吸内科诊室", "clinic"),
        (("s", 1), "心内科诊室", "clinic"),
        (("s", 0), "心内科诊室", "clinic"),
    ],
    # ---- 3F 医技检查层：超声（西南）、内镜（东南）、放射（北）、体检（西北）、功能检查
    [
        ("W_SW", "病理科", "patho"),
        ("W1", "脑电图室", "func"),
        ("W2", "肺功能室", "func"),
        ("W_NW", "体检更衣室", "aux"),
        (("n", 0, 5), "体检中心", "checkup"),
        (("n", 6), "乳腺钼靶室", "mammo"),
        (("n", 7, 8), "DR 摄片室", "xray"),
        (("n", 9, 10), "放射候诊区", "waiting"),
        (("n", 11, 12), "CT 室", "ct"),
        (("n", 13, 14), "CT 室", "ct"),
        (("n", 15), "阅片室", "aux"),
        (("n", 16, 19), "核磁共振室", "mri"),
        ("E_NE", "放射科办公室", "aux"),
        ("E2", "动态心电室", "func"),
        ("E1", "骨密度室", "func"),
        ("E_SE", "内镜候诊区", "waiting"),
        (("s", 18, 19), "内镜洗消间", "aux"),
        (("s", 16, 17), "内镜复苏室", "recovery"),
        (("s", 14, 15), "肠镜室", "endo"),
        (("s", 12, 13), "胃镜室", "endo"),
        (("s", 8, 11), "南侧候诊区", "waiting"),
        (("s", 5, 7), "超声候诊区", "waiting"),
        (("s", 4), "超声医生办公室", "aux"),
        (("s", 3), "心脏彩超室", "us"),
        (("s", 2), "彩超室", "us"),
        (("s", 1), "彩超室", "us"),
        (("s", 0), "彩超室", "us"),
        ("CORE_W", "医技预约登记处", "cashier"),
        ("CORE_E", "报告打印取片处", "cashier"),
    ],
]

# 东西两侧与核心区的固定槽位：(矩形, 门所在墙, 门可开的区间（沿墙坐标，None = 整面墙）)
# 四个角部房间只有一段墙贴着走廊，门只能开在那一段
SIDE_SLOTS = {
    "W_SW": ((0.0, 0.0, STRIP, 10.8), "E", (7.2, 10.8)),
    "W1": ((0.0, 10.8, STRIP, 14.4), "E", None),
    "W2": ((0.0, 28.8, STRIP, 32.4), "E", None),
    "W_NW": ((0.0, 32.4, STRIP, D), "E", (32.4, 36.0)),
    "E_NE": ((W - STRIP, 32.4, W, D), "W", (32.4, 36.0)),
    "E2": ((W - STRIP, 28.8, W, 32.4), "W", None),
    "E1": ((W - STRIP, 10.8, W, 14.4), "W", None),
    "E_SE": ((W - STRIP, 0.0, W, 10.8), "W", (7.2, 10.8)),
    "CORE_W": (CORE_ROOM["CORE_W"], "S", None),
    "CORE_E": (CORE_ROOM["CORE_E"], "S", None),
}
# 顺时针编号用的排序值（自西南角起：西侧向北 → 北侧向东 → 东侧向南 → 南侧向西 → 核心区）
_CW = {"W_SW": 0, "W1": 1, "W2": 4, "W_NW": 5, "E_NE": 40, "E2": 41, "E1": 44, "E_SE": 45, "CORE_W": 90, "CORE_E": 91}


def slot(key):
    """槽位 → (矩形, 门所在墙, 门可开区间, 排序值, 文本 key)"""
    if isinstance(key, tuple):
        side, i0, *rest = key
        i1 = rest[0] if rest else i0
        x0, x1 = STRIP + MOD * i0, STRIP + MOD * (i1 + 1)
        name = f"{side}{i0}" if i0 == i1 else f"{side}{i0}-{i1}"
        if side == "s":
            return (x0, 0.0, x1, STRIP), "N", None, 60 + (19 - i1), name
        return (x0, D - STRIP, x1, D), "S", None, 10 + i0, name
    rect, side, rng = SIDE_SLOTS[key]
    return rect, side, rng, _CW[key], key


def build_rooms():
    """展开房间表：编号、同名加序号、门的位置。返回 [floor] → [room]。"""
    floors = []
    for f, table in enumerate(PROGRAM):
        rooms = []
        for key, name, kind in table:
            rect, side, rng, order, k = slot(key)
            zone, dest = KIND[kind]
            rooms.append(dict(
                floor=f, key=k, name=name, kind=kind, zone=zone, rect=rect, side=side,
                dest=dest, open=kind in ("waiting", "entrance"), door_range=rng, order=order,
            ))
        rooms.sort(key=lambda r: r["order"])
        dests = [r for r in rooms if r["dest"]]
        assert len(dests) == 20, f"{FLOORS[f]} 目的地房间 {len(dests)} 个，应为 20"
        for i, r in enumerate(dests):
            r["num"] = f"{f + 1}{i + 1:02d}"
        # 同名房间按编号顺序加序号（心内科诊室1 / 2 …）
        for r in dests:
            same = [q for q in dests if q["name"] == r["name"]]
            if len(same) > 1:
                r["label"] = r["name"] + str(same.index(r) + 1)
        for r in rooms:
            r.setdefault("label", r["name"])
            r["door"] = None if r["open"] else place_door(r)
        floors.append(rooms)
    return floors


def on_grid(v):
    return abs(v / GRID - round(v / GRID)) < 1e-6


def wall_columns(side, rect):
    """门所在墙线上的柱子（沿墙坐标）。走廊侧墙都落在轴线上，每 7.2 m 一根柱。"""
    x0, y0, x1, y1 = rect
    if side in "NS":
        line, a, b = (y1 if side == "N" else y0), x0, x1
    else:
        line, a, b = (x1 if side == "E" else x0), y0, y1
    if not on_grid(line):
        return []
    return [k * GRID for k in range(max(NX, NY) + 1) if a - 0.01 <= k * GRID <= b + 0.01]


def place_door(room):
    """在走廊侧墙上找一个不碰柱子的门位：优先居中，不行就左右挪。"""
    x0, y0, x1, y1 = room["rect"]
    side = room["side"]
    a, b = (x0, x1) if side in "NS" else (y0, y1)
    if room["door_range"]:
        a, b = room["door_range"]
    w = DOOR_W.get(room["kind"]) or (1.0 if (b - a) <= MOD + 0.01 else 1.5)
    cols = wall_columns(side, room["rect"])
    mid = (a + b) / 2
    for dc in (0, -0.9, 0.9, -1.8, 1.8, -2.7, 2.7):
        c = mid + dc
        if c - w / 2 < a + 0.25 or c + w / 2 > b - 0.25:
            continue
        if any(abs(c - k) < w / 2 + 0.4 for k in cols):
            continue
        return door_spec(room["rect"], side, c, w)
    raise ValueError(f"{room['name']} 找不到门位")


def door_spec(rect, side, c, w):
    """门：所在墙、沿墙中心坐标、宽度、门洞中点、指向房间内的法向。"""
    x0, y0, x1, y1 = rect
    if side == "N":
        p, n = (c, y1), (0.0, -1.0)
    elif side == "S":
        p, n = (c, y0), (0.0, 1.0)
    elif side == "E":
        p, n = (x1, c), (-1.0, 0.0)
    else:
        p, n = (x0, c), (1.0, 0.0)
    return dict(side=side, c=c, w=w, p=p, n=n)


def nav_point(room):
    """房间的导航终点：进门 1.2 m；柜台式房间停在柜台前；开敞候诊区取走廊边线往里 1.5 m。"""
    if room["key"].startswith("CORE"):
        x0, y0, x1, y1 = room["rect"]
        return ((x0 + x1) / 2, y0 - 0.8)
    if room["door"]:
        (px, py), (nx, ny) = room["door"]["p"], room["door"]["n"]
        return (px + nx * 1.2, py + ny * 1.2)
    p, n = open_edge_mid(room)
    return (p[0] + n[0] * 1.5, p[1] + n[1] * 1.5)


def open_edge_mid(room):
    """开敞房间（候诊区 / 门厅）贴走廊那段边线的中点和朝内法向。"""
    x0, y0, x1, y1 = room["rect"]
    side = room["side"]
    a, b = (x0, x1) if side in "NS" else (y0, y1)
    if room["door_range"]:
        a, b = room["door_range"]
    return door_spec(room["rect"], side, (a + b) / 2, 0)["p"], door_spec(room["rect"], side, 0, 0)["n"]


def door_point(room):
    """房间门洞中点（走廊一侧）；柜台式房间取柜台中点。"""
    if room["key"].startswith("CORE"):
        x0, y0, x1, y1 = room["rect"]
        return ((x0 + x1) / 2, y0)
    if room["door"]:
        return room["door"]["p"]
    return open_edge_mid(room)[0]


# ---------------------------------------------------------------- 公共导航点（非房间）
def stair_door(s):
    return (STRIP, 20.4) if s == "W" else (W - STRIP, 23.0)


def stair_landing(s):
    return (5.0, 20.4) if s == "W" else (W - 5.0, 23.0)


def wc_door(s):
    """卫生间前室门（与 draw_wc 里的门位一致）"""
    return (STRIP, 24.2) if s == "W" else (W - STRIP, 19.0)


def elev_hall(e):
    x0, y0, x1, y1 = ELEV[e]
    return ((x0 + x1) / 2, y0 - 0.9)


def esc_ends(e):
    """扶梯两端（上 / 下梯点）：返回 {floor: (x, y)}"""
    y_s, y_n = ESC_Y[0], ESC_Y[3]
    lo_y, hi_y = (y_s, y_n) if e["lo_end"] == "S" else (y_n, y_s)
    return {e["lo"]: (e["x"], lo_y), e["hi"]: (e["x"], hi_y)}


def public_points(f):
    """可选作起终点的公共点：卫生间、服务台 / 护士站、入口。"""
    pts = [
        dict(id=f"wcW{f + 1}", name="西侧卫生间", kind="wc", p=wc_door("W"), n=(-1.0, 0.0)),
        dict(id=f"wcE{f + 1}", name="东侧卫生间", kind="wc", p=wc_door("E"), n=(1.0, 0.0)),
    ]
    if f == 0:
        pts += [
            dict(id="desk", name="导诊服务台", kind="desk", p=(31.4, 17.6), n=(1.0, 0.0)),
            dict(id="gateS", name="南门（主入口）", kind="gate", p=(X_AXIS, -4.0), n=(0.0, -1.0)),
            dict(id="gateN", name="北门（停车场）", kind="gate", p=(X_AXIS, D + 4.0), n=(0.0, 1.0)),
            dict(id="gateE", name="东门（急诊入口）", kind="gate", p=(W + 4.0, 12.6), n=(1.0, 0.0)),
        ]
    else:
        pts.append(dict(id=f"nurse{f + 1}", name="护士站", kind="desk", p=(32.4, 25.3), n=(0.0, 1.0)))
    if f == 1:
        pts += [
            dict(id="triageW2", name="内科分诊台", kind="desk", p=(15.0, 27.2), n=(0.0, 1.0)),
            dict(id="triageE2", name="外科分诊台", kind="desk", p=(71.4, 27.2), n=(0.0, 1.0)),
        ]
    for q in pts:
        q["floor"] = f
    return pts


# ---------------------------------------------------------------- 图元
class Prims(list):
    """图元列表。每个图元是 dict，t = line / poly / arc / circle / text，L = 图层名。"""

    def line(self, L, a, b, **kw):
        self.append(dict(t="line", L=L, a=tuple(a), b=tuple(b), **kw))

    def poly(self, L, pts, closed=True, fill=None, **kw):
        self.append(dict(t="poly", L=L, pts=[tuple(p) for p in pts], closed=closed, fill=fill, **kw))

    def rect(self, L, x0, y0, x1, y1, fill=None, **kw):
        self.poly(L, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], True, fill, **kw)

    def arc(self, L, c, r, a0, a1):
        self.append(dict(t="arc", L=L, c=tuple(c), r=r, a0=a0, a1=a1))

    def circle(self, L, c, r, fill=None):
        self.append(dict(t="circle", L=L, c=tuple(c), r=r, fill=fill))

    def text(self, L, p, s, h, ha="center", va="center", rot=0, font="body"):
        self.append(dict(t="text", L=L, p=tuple(p), s=s, h=h, ha=ha, va=va, rot=rot, font=font))


class Local:
    """房间局部坐标：u 沿走廊侧墙展开，v 从走廊侧墙面向房间纵深（v = d 为外墙）。"""

    def __init__(self, rect, side):
        x0, y0, x1, y1 = rect
        if side == "N":
            self.o, self.eu, self.ev, self.w, self.d = (x0, y1), (1, 0), (0, -1), x1 - x0, y1 - y0
        elif side == "S":
            self.o, self.eu, self.ev, self.w, self.d = (x0, y0), (1, 0), (0, 1), x1 - x0, y1 - y0
        elif side == "E":
            self.o, self.eu, self.ev, self.w, self.d = (x1, y0), (0, 1), (-1, 0), y1 - y0, x1 - x0
        else:
            self.o, self.eu, self.ev, self.w, self.d = (x0, y0), (0, 1), (1, 0), y1 - y0, x1 - x0

    def p(self, u, v):
        return (self.o[0] + u * self.eu[0] + v * self.ev[0], self.o[1] + u * self.eu[1] + v * self.ev[1])

    def rect(self, u0, v0, u1, v1):
        return [self.p(u0, v0), self.p(u1, v0), self.p(u1, v1), self.p(u0, v1)]


class Walls:
    """墙体：按墙线归并区间，再扣掉门窗洞口，输出带厚度的矩形。"""

    def __init__(self):
        self.segs = {}  # (方向, 墙线坐标, 厚度) → [[a, b], …]
        self.holes = {}  # (方向, 墙线坐标) → [[a, b], …]

    def add(self, o, c, a, b, t):
        if b - a > 1e-6:
            self.segs.setdefault((o, round(c, 3), t), []).append([min(a, b), max(a, b)])

    def add_rect(self, rect, t, skip_exterior=True, skip=()):
        """矩形四边加墙；外墙线上的边跳过（外墙单独画）；skip 里是不要的边（N/S/E/W）。"""
        x0, y0, x1, y1 = rect
        for side, o, c, a, b in (("S", "h", y0, x0, x1), ("N", "h", y1, x0, x1), ("W", "v", x0, y0, y1), ("E", "v", x1, y0, y1)):
            if side in skip:
                continue
            if skip_exterior and is_exterior(o, c):
                continue
            self.add(o, c, a, b, t)

    def cut(self, o, c, a, b):
        self.holes.setdefault((o, round(c, 3)), []).append([min(a, b), max(a, b)])

    def rects(self):
        out = []
        for (o, c, t), ivs in self.segs.items():
            ivs.sort()
            merged = []
            for a, b in ivs:
                if merged and a <= merged[-1][1] + 1e-6:
                    merged[-1][1] = max(merged[-1][1], b)
                else:
                    merged.append([a, b])
            holes = sorted(self.holes.get((o, c), []))
            for a, b in merged:
                pieces = [[a, b, False, False]]  # 区间 + 两端是否为洞口边（洞口边不外延）
                for ha, hb in holes:
                    nxt = []
                    for pa, pb, ja, jb in pieces:
                        if hb <= pa or ha >= pb:
                            nxt.append([pa, pb, ja, jb])
                            continue
                        if ha > pa:
                            nxt.append([pa, ha, ja, True])
                        if hb < pb:
                            nxt.append([hb, pb, True, jb])
                    pieces = nxt
                for pa, pb, ja, jb in pieces:
                    pa -= 0 if ja else t / 2
                    pb += 0 if jb else t / 2
                    if pb - pa < 0.05:
                        continue
                    if o == "h":
                        out.append((pa, c - t / 2, pb, c + t / 2))
                    else:
                        out.append((c - t / 2, pa, c + t / 2, pb))
        return out


def is_exterior(o, c):
    return (o == "h" and (abs(c) < 1e-6 or abs(c - D) < 1e-6)) or (o == "v" and (abs(c) < 1e-6 or abs(c - W) < 1e-6))


def door_line(spec):
    """门所在墙线：(方向, 坐标)"""
    if spec["side"] in "NS":
        return "h", spec["p"][1]
    return "v", spec["p"][0]


def draw_door(P, spec, L="DOOR"):
    """平开门：门扇 + 90° 开启弧线，向房间内开；宽于 1.2 m 画双扇。"""
    c, w = spec["c"], spec["w"]
    (px, py), (nx, ny) = spec["p"], spec["n"]
    tx, ty = (1.0, 0.0) if spec["side"] in "NS" else (0.0, 1.0)  # 沿墙方向
    j0 = (px - tx * w / 2, py - ty * w / 2)
    j1 = (px + tx * w / 2, py + ty * w / 2)
    leaves = [(j0, j1, w)] if w <= 1.2 else [(j0, (px, py), w / 2), (j1, (px, py), w / 2)]
    for hinge, toward, lw in leaves:
        end = (hinge[0] + nx * lw, hinge[1] + ny * lw)
        P.line(L, hinge, end)
        a0 = math.degrees(math.atan2(end[1] - hinge[1], end[0] - hinge[0]))
        dx, dy = toward[0] - hinge[0], toward[1] - hinge[1]
        a1 = math.degrees(math.atan2(dy, dx))
        if (a1 - a0) % 360 > 180:
            a0, a1 = a1, a0
        P.arc(L, hinge, lw, a0, a1)


def draw_window(P, o, c, a, b, t=T_EXT, L="WINDOW"):
    """外墙窗：洞口两侧的墙面线 + 中间两道玻璃线（CAD 常用的四线窗）。"""
    for off in (-t / 2, -t / 6, t / 6, t / 2):
        if o == "h":
            P.line(L, (a, c + off), (b, c + off))
        else:
            P.line(L, (c + off, a), (c + off, b))
    for s in (a, b):
        if o == "h":
            P.line(L, (s, c - t / 2), (s, c + t / 2))
        else:
            P.line(L, (c - t / 2, s), (c + t / 2, s))


# ---------------------------------------------------------------- 家具
def chair(P, loc, u, v, r=0.24):
    P.circle("FURN", loc.p(u, v), r)


def desk_set(P, loc, u, v, w=1.4):
    """诊桌：桌面 + 医生椅（靠窗）+ 患者椅"""
    P.poly("FURN", loc.rect(u - w / 2, v - 0.35, u + w / 2, v + 0.35))
    chair(P, loc, u, v + 0.75)
    chair(P, loc, u + 0.2, v - 0.8)


def bed(P, loc, u, v, along="v", curtain=False):
    """检查床 0.8 × 1.9（u, v 为床头中点）"""
    if along == "v":
        P.poly("FURN", loc.rect(u - 0.4, v, u + 0.4, v + 1.9))
        P.line("FURN", loc.p(u - 0.4, v + 0.45), loc.p(u + 0.4, v + 0.45))
        if curtain:
            P.poly("FURN", [loc.p(u - 0.7, v - 0.3), loc.p(u - 0.7, v + 2.2), loc.p(u + 0.7, v + 2.2)], closed=False, ls="dash")
    else:
        P.poly("FURN", loc.rect(u, v - 0.4, u + 1.9, v + 0.4))
        P.line("FURN", loc.p(u + 0.45, v - 0.4), loc.p(u + 0.45, v + 0.4))
        if curtain:
            P.poly("FURN", [loc.p(u - 0.3, v - 0.7), loc.p(u + 2.2, v - 0.7), loc.p(u + 2.2, v + 0.7)], closed=False, ls="dash")


def box(P, loc, u0, v0, u1, v1, cross=False):
    P.poly("FURN", loc.rect(u0, v0, u1, v1))
    if cross:
        P.line("FURN", loc.p(u0, v0), loc.p(u1, v1))
        P.line("FURN", loc.p(u0, v1), loc.p(u1, v0))


def box_u(P, loc, ua, ub, v0, v1):
    """box 的变体：u 两端可以给反（镜像布置时用）"""
    box(P, loc, min(ua, ub), v0, max(ua, ub), v1)


def sink(P, loc, u, v):
    P.poly("FURN", loc.rect(u - 0.3, v - 0.25, u + 0.3, v + 0.25))
    P.circle("FURN", loc.p(u, v), 0.15)


def seats(P, loc, u0, u1, v, depth=0.5, pitch=0.55, avoid=()):
    """一排连排椅；avoid 里的 u 区间（门口）断开"""
    pieces = [(u0, u1)]
    for a, b in avoid:
        pieces = [q for pa, pb in pieces for q in ((pa, min(pb, a)), (max(pa, b), pb)) if q[1] - q[0] > 0]
    for pa, pb in pieces:
        if pb - pa < 1.0:
            continue
        P.poly("FURN", loc.rect(pa, v, pb, v + depth))
        n = int((pb - pa) / pitch)
        for i in range(1, n):
            u = pa + (pb - pa) * i / n
            P.line("FURN", loc.p(u, v), loc.p(u, v + depth))


def counter(P, loc, u0, u1, v, depth=0.6, windows=0):
    """服务柜台，windows > 0 时按窗口数画分隔"""
    P.poly("FURN", loc.rect(u0, v, u1, v + depth))
    P.line("FURN", loc.p(u0, v + depth * 0.5), loc.p(u1, v + depth * 0.5))
    for i in range(1, windows):
        u = u0 + (u1 - u0) * i / windows
        P.line("FURN", loc.p(u, v), loc.p(u, v + depth))


def partition(P, loc, u0, v0, u1, v1, gaps=()):
    """房间内轻质隔断（实体填充），gaps 为门洞 (起, 止)，沿隔断方向的局部坐标"""
    horiz = abs(v1 - v0) < 1e-6
    a, b = (u0, u1) if horiz else (v0, v1)
    cuts = sorted(gaps)
    pieces, s = [], a
    for ga, gb in cuts:
        pieces.append((s, ga))
        s = gb
    pieces.append((s, b))
    t = T_THIN / 2
    for pa, pb in pieces:
        if pb - pa < 0.05:
            continue
        if horiz:
            P.poly("WALL", loc.rect(pa, v0 - t, pb, v0 + t), fill="wall")
        else:
            P.poly("WALL", loc.rect(u0 - t, pa, u0 + t, pb), fill="wall")


def furnish(P, room):
    """按房间类型布置家具（只是示意，三维页面里再细化）。"""
    kind = room["kind"]
    loc = Local(room["rect"], room["side"])
    w, d = loc.w, loc.d
    # 门在局部坐标里的中心 du 和避让区间（座椅、柜台不能挡门）
    if room["door"]:
        du = room["door"]["c"] - (room["rect"][0] if room["side"] in "NS" else room["rect"][1])
        dw = room["door"]["w"]
        avoid = [(du - dw / 2 - 0.3, du + dw / 2 + 0.3)]
    else:
        du, avoid = w / 2, []
    # CT / DR：控制室放在离门远的一侧（门被柱子挤到一端时镜像布置）
    mirror = kind in ("ct", "xray") and du < w / 2

    def M(u):
        return w - u if mirror else u

    if kind in ("clinic", "clinic_er", "clinic_ped"):
        desk_set(P, loc, w / 2 - 0.2, d - 2.0)
        bed(P, loc, w - 0.6, 1.5, curtain=True)
        sink(P, loc, 0.55, 0.6)
        if kind == "clinic_ped":
            chair(P, loc, w / 2 + 0.6, d - 2.9, 0.18)
    elif kind == "treat":
        bed(P, loc, w - 0.6, 2.0, curtain=True)
        box(P, loc, 0.3, d - 1.6, 1.3, d - 0.4)
        box(P, loc, 0.3, 2.4, 0.8, 2.9)
        sink(P, loc, 0.55, 0.6)
    elif kind == "clinic_gyn":
        partition(P, loc, 3.6, 1.6, 3.6, d, gaps=[(2.0, 3.0)])
        desk_set(P, loc, 1.8, d - 2.0)
        sink(P, loc, 0.55, 0.6)
        box(P, loc, 4.9, d - 2.8, 5.9, d - 1.2)  # 妇科检查床
        P.poly("FURN", [loc.p(4.4, d - 3.3), loc.p(6.6, d - 3.3), loc.p(6.6, d - 0.6)], closed=False, ls="dash")
    elif kind == "clinic_eye":
        desk_set(P, loc, 1.8, d - 2.0)
        box(P, loc, 3.8, d - 2.4, 5.0, d - 1.7)  # 裂隙灯
        chair(P, loc, 4.4, d - 2.9)
        P.line("FURN", loc.p(6.5, 1.0), loc.p(6.5, d - 0.7), ls="dash")  # 5 m 视力检查距离
        box(P, loc, 6.2, d - 0.6, 6.8, d - 0.35)
    elif kind == "clinic_tcm":
        desk_set(P, loc, 1.8, d - 2.0)
        desk_set(P, loc, 4.6, d - 2.0)
        for u in (7.4, 8.6, 9.8):
            bed(P, loc, u, 2.6, curtain=False)
        P.line("FURN", loc.p(6.7, 2.2), loc.p(10.5, 2.2), ls="dash")
    elif kind == "dental":
        for u in (1.6, 4.4):
            P.poly("FURN", loc.rect(u - 0.35, d - 3.4, u + 0.35, d - 1.6))
            P.circle("FURN", loc.p(u + 0.75, d - 2.0), 0.22)
            box(P, loc, u - 0.6, d - 0.6, u + 0.6, d - 0.15)
        desk_set(P, loc, 8.0, d - 2.0)
        sink(P, loc, 6.4, d - 0.5)
    elif kind in ("us", "func"):
        bed(P, loc, w - 0.6, 2.2, curtain=kind == "us")
        box(P, loc, w - 1.6, 4.0, w - 1.05, 4.6, cross=True)  # 超声 / 心电设备
        box(P, loc, 0.3, d - 1.3, 1.8, d - 0.6)
        chair(P, loc, 1.0, d - 1.8)
    elif kind == "ct":
        partition(P, loc, M(2.4), 0.0, M(2.4), d, gaps=[(1.0, 1.9)])
        box_u(P, loc, M(0.3), M(2.1), d - 1.4, d - 0.7)
        chair(P, loc, M(1.2), d - 1.9)
        box_u(P, loc, M(3.8), M(6.2), 3.3, 4.3)
        P.circle("FURN", loc.p(M(5.0), 3.8), 0.35)
        box_u(P, loc, M(4.7), M(5.3), 4.3, 6.6)
    elif kind == "mri":
        partition(P, loc, 3.6, 0.0, 3.6, d, gaps=[(1.0, 1.9)])
        partition(P, loc, 10.8, 0.0, 10.8, d, gaps=[(5.4, 6.3)])
        box(P, loc, 0.4, d - 1.4, 3.0, d - 0.7)
        chair(P, loc, 1.6, d - 1.9)
        box(P, loc, 5.7, 2.6, 8.7, 5.0)
        P.circle("FURN", loc.p(7.2, 3.8), 0.45)
        box(P, loc, 6.9, 1.0, 7.5, 2.6)
        for v in (1.2, 3.0, 4.8):
            box(P, loc, 11.4, v, 13.8, v + 1.2, cross=True)  # 设备机柜
    elif kind == "xray":
        partition(P, loc, M(2.4), 0.0, M(2.4), d, gaps=[(1.0, 1.9)])
        box_u(P, loc, M(0.3), M(2.1), d - 1.4, d - 0.7)
        box_u(P, loc, M(3.6), M(5.6), 3.0, 3.8)
        P.circle("FURN", loc.p(M(4.6), 3.4), 0.3)
        box_u(P, loc, M(6.3), M(6.9), 2.9, 3.9)
    elif kind == "mammo":
        partition(P, loc, 0.0, 2.6, 1.6, 2.6)
        box(P, loc, 0.3, 1.4, 1.3, 2.2)
        box(P, loc, 1.6, 4.2, 2.6, 5.0)
        P.circle("FURN", loc.p(2.1, 4.6), 0.25)
    elif kind == "endo":
        for v in (3.0, 5.2):
            bed(P, loc, 0.9, v, along="u")
            box(P, loc, 3.2, v - 0.3, 3.8, v + 0.3, cross=True)
        box(P, loc, 5.2, d - 1.4, 6.7, d - 0.7)
        sink(P, loc, w - 0.6, 0.6)
    elif kind == "recovery":
        for u in (0.9, 2.7, 4.5, 6.3):
            bed(P, loc, u, d - 2.3)
        P.line("FURN", loc.p(0.3, d - 2.8), loc.p(w - 0.3, d - 2.8), ls="dash")
        counter(P, loc, 0.6, 2.6, 1.0)
    elif kind == "checkup":
        for i in range(6):
            u = 3.6 * i
            if i:
                partition(P, loc, u, d - 3.0, u, d)
            bed(P, loc, u + 1.8, d - 2.4, curtain=False)
        partition(P, loc, 0.0, d - 3.0, w, d - 3.0, gaps=[(3.6 * i + 1.2, 3.6 * i + 2.4) for i in range(6)])
        counter(P, loc, 1.0, 4.4, 0.9)
        for u0 in (6.0, 12.6):
            seats(P, loc, u0, u0 + 5.4, 1.2, avoid=avoid)
            seats(P, loc, u0, u0 + 5.4, 2.6)
    elif kind in ("patho", "lab"):
        P.poly("FURN", loc.rect(0.3, d - 0.75, w - 0.3, d - 0.05))  # 靠窗实验台
        for u0 in (1.4, w / 2 + 0.6):
            box(P, loc, u0, 3.0, u0 + w / 2 - 2.0, 3.9)
        for u in (1.0, 2.0, w - 2.0, w - 1.0):
            box(P, loc, u - 0.3, d - 0.65, u + 0.3, d - 0.15, cross=True)
    elif kind == "blood":
        counter(P, loc, 0.6, w - 0.6, 2.4, windows=6)
        for i in range(6):
            u = 0.6 + (w - 1.2) * (i + 0.5) / 6
            chair(P, loc, u, 1.8)
            chair(P, loc, u, 3.5, 0.2)
        box(P, loc, 0.6, d - 1.0, 3.0, d - 0.3)
    elif kind == "infusion":
        counter(P, loc, 0.4, 2.6, 0.9)
        for v in (2.6, 4.2, 5.8):
            n = 12
            for i in range(n):
                u = 3.4 + (w - 3.8) * i / n
                P.poly("FURN", loc.rect(u, v, u + 0.55, v + 0.65))
    elif kind == "rescue":
        for u in (1.6, 4.6, 7.6):
            bed(P, loc, u, d - 2.6)
            P.poly("FURN", loc.rect(u - 1.3, d - 3.0, u + 1.3, d - 0.3), ls="dash")
            P.circle("FURN", loc.p(u + 1.0, d - 2.8), 0.2)
        counter(P, loc, 0.4, 3.0, 1.0)
    elif kind in ("service", "triage"):
        n = max(1, int((w - 1.2) / 1.8))
        counter(P, loc, 0.6, w - 0.6, 2.6 if d > 6 else 1.6, windows=n)
        for i in range(n):
            u = 0.6 + (w - 1.2) * (i + 0.5) / n
            chair(P, loc, u, 3.7 if d > 6 else 2.6)
        if d > 6 and w > 6:
            seats(P, loc, 1.0, w - 1.0, 0.9, avoid=avoid)
    elif kind == "cashier":
        n = int(w / 1.8)
        counter(P, loc, 0.0, w, 0.0, depth=0.7, windows=n)
        for i in range(n):
            chair(P, loc, w * (i + 0.5) / n, 1.4)
        P.poly("FURN", loc.rect(2.4, d - 0.6, w - 0.3, d - 0.1))
    elif kind == "pharmacy":
        n = int(w / 1.8)
        counter(P, loc, 0.0, w, 0.0, depth=0.7, windows=n)
        for v in (1.8, 3.0):
            P.poly("FURN", loc.rect(1.0, v, w - 3.0, v + 0.5))
        box(P, loc, w - 2.4, 1.8, w - 0.6, 3.6, cross=True)  # 自动发药机
        P.poly("FURN", loc.rect(2.4, d - 0.5, w - 0.3, d - 0.1))
    elif kind == "pharmacy_cn":
        P.poly("FURN", loc.rect(0.3, d - 0.6, w - 0.3, d - 0.1))  # 中药斗柜
        P.poly("FURN", loc.rect(0.3, 2.6, 0.9, d - 0.6))
        counter(P, loc, 3.0, w - 0.6, 1.6, windows=3)
        box(P, loc, 3.4, 4.0, 6.4, 4.8)
    elif kind == "mother":
        box(P, loc, 0.3, d - 2.6, 1.1, d - 0.4)  # 沙发
        box(P, loc, w - 1.2, d - 1.6, w - 0.3, d - 0.4)  # 护理台
        sink(P, loc, w - 0.7, 1.0)
    elif kind == "waiting":
        u0, u1 = 0.8, w - 0.8
        if room["door_range"]:  # 角部候诊区：座椅避开走廊口
            rows = [(d - 1.4,), (d - 3.0,), (d - 4.6,)]
            for (v,) in rows:
                seats(P, loc, 0.8, w - 4.4, v)
        else:
            for v in (d - 1.6, d - 3.2):
                seats(P, loc, u0, u1, v)
            if d > 6.5 and w > 6:
                seats(P, loc, u0, u1, d - 4.8)


def hatch(P, rect, step=0.6, L="HATCH"):
    """辅助用房的 45° 斜线填充"""
    x0, y0, x1, y1 = rect
    c = x0 - y1
    while c < x1 - y0:
        xa, xb = max(x0, y0 + c), min(x1, y1 + c)
        if xb - xa > 0.05:
            P.line(L, (xa, xa - c), (xb, xb - c))
        c += step


# ---------------------------------------------------------------- 楼梯 / 电梯 / 扶梯 / 卫生间
def draw_stair(P, s, f):
    """双跑楼梯：梯段沿南北向，楼层平台在走廊门口一侧，中间休息平台在另一头。"""
    rect = STAIR[s]
    loc = Local(rect, "E" if s == "W" else "W")  # u 沿南北，v 由走廊向外墙
    # 西楼梯：楼层平台在北端（u 大）；东楼梯与之中心对称，楼层平台在南端（u 小）
    flip = s == "E"

    def U(u):
        return 7.2 - u if flip else u

    fl1, fl2 = (3.6, 5.2), (5.4, 7.0)  # 两个梯段的 v 范围（梯段 1 靠走廊）
    u_mid, u_floor = 1.8, 5.4  # 梯段在 u ∈ [1.8, 5.4]
    for v0, v1 in (fl1, fl2):
        P.poly("STAIR", [loc.p(U(u_mid), v0), loc.p(U(u_floor), v0), loc.p(U(u_floor), v1), loc.p(U(u_mid), v1)])
    for k in range(14):
        u = u_mid + k * (u_floor - u_mid) / 13
        for v0, v1 in (fl1, fl2):
            if f == 0 and v0 == fl2[0] and u > 3.6:
                continue  # 1F：靠外的梯段只看到剖切线以下部分
            P.line("STAIR", loc.p(U(u), v0), loc.p(U(u), v1))
    P.poly("STAIR", [loc.p(U(u_mid), 5.2), loc.p(U(u_floor), 5.2), loc.p(U(u_floor), 5.4), loc.p(U(u_mid), 5.4)])  # 梯井
    P.poly("STAIR", [loc.p(U(0.15), fl1[0]), loc.p(U(u_mid), fl1[0]), loc.p(U(u_mid), fl2[1]), loc.p(U(0.15), fl2[1])])  # 休息平台
    # 箭头：上 = 靠走廊的梯段，下 = 靠外的梯段，都从楼层平台出发
    if f < 2:
        arrow(P, [loc.p(U(6.2), 4.4), loc.p(U(2.4), 4.4)], "STAIR")
        P.text("STAIR", loc.p(U(6.75), 4.4), "上", 0.55, ha="center")
        brk = [loc.p(U(3.3), fl1[0]), loc.p(U(3.9), (fl1[0] + fl1[1]) / 2 - 0.25), loc.p(U(3.5), (fl1[0] + fl1[1]) / 2 + 0.25), loc.p(U(4.1), fl1[1])]
        P.poly("STAIR", brk, closed=False)
    if f > 0:
        arrow(P, [loc.p(U(6.2), 6.2), loc.p(U(2.4), 6.2)], "STAIR")
        P.text("STAIR", loc.p(U(6.75), 6.2), "下", 0.55, ha="center")
    P.text("TEXT", loc.p(U(3.6), 1.8), STAIR_NAME[s], 0.62)


def stair_geom(s):
    """楼梯的三维数据：两个梯段（矩形 + 上行方向 + 起止高度）和中间休息平台。
    与 draw_stair 的布置一致：梯段 1 靠走廊、从楼层平台上到休息平台；梯段 2 从休息平台上到上一层。"""
    loc = Local(STAIR[s], "E" if s == "W" else "W")

    def U(u):
        return 7.2 - u if s == "E" else u

    def rect(u0, v0, u1, v1):
        a, b = loc.p(U(u0), v0), loc.p(U(u1), v1)
        return [round(min(a[0], b[0]), 3), round(min(a[1], b[1]), 3), round(max(a[0], b[0]), 3), round(max(a[1], b[1]), 3)]

    a, b = loc.p(U(5.4), 0), loc.p(U(1.8), 0)
    L = math.dist(a, b)
    d = [round((b[0] - a[0]) / L, 3), round((b[1] - a[1]) / L, 3)]  # 梯段 1 的上行方向（朝休息平台）
    return dict(
        flights=[
            dict(rect=rect(1.8, 3.6, 5.4, 5.2), up=d, z=[0.0, FLOOR_H / 2]),
            dict(rect=rect(1.8, 5.4, 5.4, 7.0), up=[-d[0], -d[1]], z=[FLOOR_H / 2, FLOOR_H]),
        ],
        landing=rect(0.15, 3.6, 1.8, 7.0),
        steps=13,
    )


def arrow(P, pts, L, head=0.45):
    P.poly(L, pts, closed=False)
    (ax, ay), (bx, by) = pts[-2], pts[-1]
    ang = math.atan2(by - ay, bx - ax)
    for da in (2.6, -2.6):
        P.line(L, (bx, by), (bx + head * math.cos(ang + da), by + head * math.sin(ang + da)))


def draw_elevators(P, walls):
    for e, (x0, y0, x1, y1) in ELEV.items():
        walls.add_rect((x0, y0, x1, y1), T_INT)
        cx = (x0 + x1) / 2
        walls.cut("h", y0, cx - 0.55, cx + 0.55)
        P.rect("ELEV", x0 + 0.3, y0 + 0.35, x1 - 0.3, y1 - 0.6)  # 轿厢
        P.line("ELEV", (x0 + 0.3, y0 + 0.35), (x1 - 0.3, y1 - 0.6))
        P.line("ELEV", (x0 + 0.3, y1 - 0.6), (x1 - 0.3, y0 + 0.35))
        P.rect("ELEV", x0 + 0.6, y1 - 0.5, x1 - 0.6, y1 - 0.2)  # 对重
        P.line("ELEV", (cx - 0.55, y0 + 0.12), (cx + 0.55, y0 + 0.12))  # 层门
        P.text("TEXT", (cx, y0 - 0.55), f"{e}号电梯", 0.5)
    P.text("TEXT2", (53.8, 26.3), "电梯厅", 0.7)


def draw_escalators(P, f):
    """中庭扶梯：每条梯画外框、扶手、梯级线和行进方向箭头；不在本层可见的部分画虚线。"""
    y_s, y_c0, y_c1, y_n = ESC_Y
    for e in ESC:
        if f not in (e["lo"], e["hi"]):
            continue
        x0, x1 = e["x"] - ESC_W / 2, e["x"] + ESC_W / 2
        # 本层看得见的范围：下端层看到下梯头 + 斜段；上端层看到上梯头 + 斜段（中庭上空里）
        if f == e["lo"]:
            vis = (y_s, y_c1) if e["lo_end"] == "S" else (y_c0, y_n)
        else:
            vis = (y_c0, y_n) if e["lo_end"] == "S" else (y_s, y_c1)
        hidden = [(y_s, vis[0]), (vis[1], y_n)]
        P.rect("ESC", x0, vis[0], x1, vis[1])
        for hy0, hy1 in hidden:
            if hy1 - hy0 > 0.05:
                P.rect("HIDDEN", x0, hy0, x1, hy1)
        P.line("ESC", (x0 + 0.15, vis[0]), (x0 + 0.15, vis[1]))
        P.line("ESC", (x1 - 0.15, vis[0]), (x1 - 0.15, vis[1]))
        y = max(vis[0], y_c0)
        while y < min(vis[1], y_c1) - 0.01:
            P.line("ESC", (x0 + 0.15, y), (x1 - 0.15, y))
            y += 0.4
        # 行进方向：上行 = 由下端指向上端
        lo_y = y_s if e["lo_end"] == "S" else y_n
        hi_y = y_n if e["lo_end"] == "S" else y_s
        a, b = (lo_y, hi_y) if e["up"] else (hi_y, lo_y)
        a = min(max(a, vis[0] + 0.3), vis[1] - 0.3)
        b = min(max(b, vis[0] + 0.3), vis[1] - 0.3)
        sgn = 1 if b > a else -1
        # 文字：本层是终点写"上自 / 下自"，否则写"上至 / 下至"
        tgt = e["hi"] if e["up"] else e["lo"]
        src_f = e["lo"] if e["up"] else e["hi"]
        word = ("上" if e["up"] else "下") + (f"至{FLOORS[tgt]}" if tgt != f else f"自{FLOORS[src_f]}")
        P.text("TEXT", (e["x"], a + sgn * 0.85), word, 0.36, rot=90)
        arrow(P, [(e["x"], a + sgn * 1.8), (e["x"], b)], "ESC", head=0.4)
    P.text("TEXT", (43.2, 25.5 if f == 1 else 10.9), "中庭扶梯", 0.5)


def draw_wc(P, s, walls):
    """卫生间：走廊侧为前室（洗手台），里面男女分设，无障碍卫生间单独开门。"""
    rect = WC[s]
    loc = Local(rect, "E" if s == "W" else "W")

    def U(u):
        return 7.2 - u if s == "E" else u

    def seg(u0, v0, u1, v1, gaps=()):
        # 隔墙：U() 翻转后区间端点可能反向，partition 需要从小到大
        a0, a1 = sorted((U(u0), U(u1)))
        g = [tuple(sorted((U(ga), U(gb)))) if abs(v1 - v0) < 1e-6 else (ga, gb) for ga, gb in gaps]
        if abs(v1 - v0) < 1e-6:
            partition(P, loc, a0, v0, a1, v1, gaps=g)
        else:
            partition(P, loc, a0, v0, a0, v1, gaps=g)

    seg(0.0, 2.6, 7.2, 2.6, gaps=[(0.5, 1.5), (3.8, 4.7)])  # 前室与男 / 女卫之间
    seg(3.6, 2.6, 3.6, 7.2)  # 男女分隔
    seg(4.9, 0.0, 4.9, 2.6)  # 无障碍卫生间隔墙
    # 女卫：靠外墙 3 个隔间；男卫：2 个隔间 + 3 个小便斗
    for k in range(3):
        u0 = U(0.2 + k * 1.1)
        u1 = U(1.2 + k * 1.1)
        P.poly("FURN", loc.rect(min(u0, u1), 5.9, max(u0, u1), 7.05))
    for k in range(2):
        u0 = U(3.8 + k * 1.1)
        u1 = U(4.8 + k * 1.1)
        P.poly("FURN", loc.rect(min(u0, u1), 5.9, max(u0, u1), 7.05))
    for k in range(3):
        P.circle("FURN", loc.p(U(4.4 + k * 0.8), 3.0), 0.18)
    for k in range(3):
        sink(P, loc, U(1.8 + k * 0.7), 2.25)
    sink(P, loc, U(6.6), 1.9)
    P.circle("FURN", loc.p(U(5.9), 0.9), 0.75)  # 无障碍回转空间示意
    P.text("TEXT", loc.p(U(1.8), 4.6), "女卫", 0.55)
    P.text("TEXT", loc.p(U(5.4), 4.6), "男卫", 0.55)
    P.text("TEXT", loc.p(U(6.05), 1.6), "无障碍", 0.4)
    # 走廊侧两扇门：前室门、无障碍卫生间门
    for uc, w in ((2.6, 1.2), (6.05, 1.0)):
        c = rect[1] + U(uc)
        spec = door_spec(rect, "E" if s == "W" else "W", c, w)
        walls.cut(*door_line(spec), c - w / 2, c + w / 2)
        draw_door(P, spec)


# ---------------------------------------------------------------- 一层平面
def floor_prims(f, rooms):
    """生成第 f 层的全部图元（不含轴线、尺寸、图签等图纸注释）。"""
    P = Prims()
    walls = Walls()

    # 底色：整个楼面
    P.rect("ZONE", 0, 0, W, D, fill=ZONES["public"][1])

    # 外墙
    for o, c, a, b in (("h", 0.0, 0.0, W), ("h", D, 0.0, W), ("v", 0.0, 0.0, D), ("v", W, 0.0, D)):
        walls.add(o, c, a, b, T_EXT)

    # 房间
    for r in rooms:
        x0, y0, x1, y1 = r["rect"]
        P.rect("ZONE", x0, y0, x1, y1, fill=ZONES[r["zone"]][1])
        if r["zone"] == "aux":
            hatch(P, r["rect"])
        if r["key"].startswith("CORE"):
            walls.add_rect(r["rect"], T_INT, skip=("S",))
            # 北墙开一扇员工门通北走廊
            spec = door_spec(r["rect"], "N", x0 + 1.4, 1.0)
            spec["n"] = (0.0, -1.0)
            walls.cut("h", y1, x0 + 0.9, x0 + 1.9)
            draw_door(P, spec)
        elif r["open"]:
            # 开敞空间：贴走廊那段不砌墙，两侧墙由相邻房间提供
            side = r["side"]
            rng = r["door_range"] or ((x0, x1) if side in "NS" else (y0, y1))
            walls.add_rect(r["rect"], T_INT, skip=(side,))
            o, c = ("h", y1 if side == "N" else y0) if side in "NS" else ("v", x1 if side == "E" else x0)
            full = (x0, x1) if side in "NS" else (y0, y1)
            if not is_exterior(o, c):
                walls.add(o, c, full[0], rng[0], T_INT)
                walls.add(o, c, rng[1], full[1], T_INT)
        else:
            walls.add_rect(r["rect"], T_INT)
        if r["door"]:
            spec = r["door"]
            walls.cut(*door_line(spec), spec["c"] - spec["w"] / 2, spec["c"] + spec["w"] / 2)
            draw_door(P, spec)
        furnish(P, r)

    # 楼梯、卫生间
    for s in ("W", "E"):
        P.rect("ZONE", *STAIR[s], fill=ZONES["traffic"][1])
        P.rect("ZONE", *WC[s], fill=ZONES["wc"][1])
        walls.add_rect(STAIR[s], T_INT)
        walls.add_rect(WC[s], T_INT)
        sd = door_spec(STAIR[s], "E" if s == "W" else "W", stair_door(s)[1], 1.2)
        walls.cut(*door_line(sd), sd["c"] - 0.6, sd["c"] + 0.6)
        draw_door(P, sd)
        draw_stair(P, s, f)
        draw_wc(P, s, walls)

    # 电梯
    for x0, y0, x1, y1 in ELEV.values():
        P.rect("ZONE", x0, y0, x1, y1, fill=ZONES["traffic"][1])
    draw_elevators(P, walls)

    # 中庭 + 扶梯
    vx0, vy0, vx1, vy1 = VOID
    if f > 0:
        P.rect("ZONE", vx0, vy0, vx1, vy1, fill="#ffffff")
        for xa, xb in ((vx0, 39.4), (47.0, vx1)):
            P.line("VOID", (xa, vy0), (xb, vy1))
            P.line("VOID", (xa, vy1), (xb, vy0))
        # 栏杆：中庭四周，扶梯接口处断开
        gap_y = vy1 if f == 1 else vy0
        P.line("RAIL", (vx0 + 0.15, vy0 + 0.15), (vx0 + 0.15, vy1 - 0.15))
        P.line("RAIL", (vx1 - 0.15, vy0 + 0.15), (vx1 - 0.15, vy1 - 0.15))
        for yy in (vy0 + 0.15, vy1 - 0.15):
            if abs(yy - gap_y) < 0.3:
                gx0, gx1 = (39.6, 46.8) if f == 1 else (43.4, 46.8)
                P.line("RAIL", (vx0 + 0.15, yy), (gx0, yy))
                P.line("RAIL", (gx1, yy), (vx1 - 0.15, yy))
            else:
                P.line("RAIL", (vx0 + 0.15, yy), (vx1 - 0.15, yy))
        P.text("TEXT2", (34.0, 18.0), "中庭上空", 0.8)
    else:
        P.rect("HIDDEN", vx0, vy0, vx1, vy1)  # 上空轮廓
        P.text("TEXT2", (52.2, 18.0), "门诊大厅", 1.0)
        P.text("TEXT2", (52.2, 16.6), "（中庭上空）", 0.5)
    draw_escalators(P, f)

    # 核心区公共家具与标注
    core_public(P, f)

    # 外窗、入口
    openings = exterior_openings(P, walls, f, rooms)

    # 墙、柱
    wall_rects = walls.rects()
    for x0, y0, x1, y1 in wall_rects:
        P.rect("WALL", x0, y0, x1, y1, fill="wall")
    for i in range(NX + 1):
        for j in range(NY + 1):
            x, y = i * GRID, j * GRID
            if (round(x, 1), round(y, 1)) in NO_COLUMN:
                continue
            P.rect("COLUMN", x - COL / 2, y - COL / 2, x + COL / 2, y + COL / 2, fill="column")

    # 房间名
    for r in rooms:
        room_label(P, r)
    P.meta = dict(walls=wall_rects, openings=openings)  # 墙体矩形、外墙开口，导出给三维页面
    return P


def core_public(P, f):
    """核心区：候诊座椅、服务台 / 护士站、自助机；以及分区文字。"""
    loc = Local((0, 0, W, D), "S")  # 世界坐标直接当局部坐标用
    rows_y = [12.4, 14.6, 16.8, 19.0, 21.2]
    for side, (xa, xb) in (("W", (11.8, 28.2)), ("E", (58.2, 74.6))):
        xm = X_WAIT[side]
        for y in rows_y:
            if f == 0 and side == "W" and y > 20:
                continue
            seats(P, loc, xa + (1.4 if f == 0 and side == "W" else 0), xm - 0.9, y)
            seats(P, loc, xm + 0.9, xb, y)
    if f == 0:
        for k in range(8):  # 自助挂号缴费机
            P.rect("FURN", 11.2, 12.2 + k * 1.1, 11.8, 12.9 + k * 1.1)
        P.text("TEXT2", (12.3, 22.6), "自助机", 0.5, ha="left")
        P.text("TEXT2", (19.8, 25.9), "自助服务 / 候诊区", 0.7)
        P.text("TEXT2", (66.6, 25.9), "候药区", 0.7)
        # 导诊服务台（弧形）
        pts = [(32.0 + 4.0 * (1 - math.cos(math.radians(a))) / 2, 16.6 + 2.0 * math.sin(math.radians(a))) for a in range(0, 181, 15)]
        P.poly("FURN", [(32.0, 16.6)] + pts[1:] + [(36.0, 16.6)], closed=True)
        P.poly("FURN", [(32.6, 16.6), (35.4, 16.6), (35.4, 17.6), (32.6, 17.6)])
        P.text("TEXT", (34.0, 19.3), "导诊服务台", 0.55)
    else:
        P.text("TEXT2", (19.8, 23.4), ["", "内科候诊区", "医技候诊区"][f], 0.7)
        P.text("TEXT2", (66.6, 23.4), ["", "外科候诊区", "医技候诊区"][f], 0.7)
        # 护士站（中庭北侧，U 形柜台）
        P.poly("FURN", [(29.6, 25.3), (35.2, 25.3), (35.2, 27.9), (34.5, 27.9), (34.5, 26.0), (30.3, 26.0), (30.3, 27.9), (29.6, 27.9)])
        chair(P, loc, 31.6, 27.0)
        chair(P, loc, 33.2, 27.0)
        P.text("TEXT", (32.4, 28.6), "护士站", 0.55)
    if f == 1:
        for x0, name in ((13.0, "内科分诊台"), (69.4, "外科分诊台")):
            P.rect("FURN", x0, 27.6, x0 + 4.0, 28.4)
            P.text("TEXT", (x0 + 2.0, 26.9), name, 0.5)
        P.text("TEXT2", (19.8, 31.6), "内科二次候诊", 0.5)
        P.text("TEXT2", (66.6, 31.6), "外科二次候诊", 0.5)
        for xa, xb in ((11.8, 18.6), (21.0, 28.2), (58.2, 65.4), (67.8, 74.6)):
            seats(P, loc, xa, xb, 29.6)


def exterior_openings(P, walls, f, rooms):
    """外墙上的窗与入口门。每个房间按 3.6 m 模数开窗，放射类房间不开窗。
    返回开口列表 [(类型 window / door, 方向 h / v, 墙线坐标, 起, 止)]，供三维页面补玻璃。"""
    opens = []

    def win(o, c, a, b):
        walls.cut(o, c, a, b)
        draw_window(P, o, c, a, b)
        opens.append(("window", o, c, a, b))

    for r in rooms:
        x0, y0, x1, y1 = r["rect"]
        if r["kind"] in NO_WINDOW or r["kind"] == "entrance":
            continue
        for o, c, a, b in (("h", 0.0, x0, x1), ("h", D, x0, x1), ("v", 0.0, y0, y1), ("v", W, y0, y1)):
            on = (o == "h" and abs((y0 if c == 0 else y1) - c) < 1e-6) or (o == "v" and abs((x0 if c == 0 else x1) - c) < 1e-6)
            if not on:
                continue
            n = round((b - a) / MOD)
            for k in range(n):
                m = a + MOD * (k + 0.5)
                win(o, c, m - 1.05, m + 1.05)
    for s in ("W", "E"):
        xc = 0.0 if s == "W" else W
        sy = (STAIR[s][1] + STAIR[s][3]) / 2
        wy = (WC[s][1] + WC[s][3]) / 2
        win("v", xc, sy - 0.75, sy + 0.75)
        win("v", xc, wy - 1.8, wy - 0.6)
        win("v", xc, wy + 0.6, wy + 1.8)
    if f == 0:
        # 南主入口：两樘自动感应门 + 玻璃幕墙
        for a, b in ((40.2, 42.6), (43.8, 46.2)):
            walls.cut("h", 0.0, a, b)
            sliding_door(P, "h", 0.0, a, b)
            opens.append(("door", "h", 0.0, a, b))
        for a, b in ((36.35, 39.9), (46.5, 50.05)):
            win("h", 0.0, a, b)
        # 北入口
        walls.cut("h", D, 43.8, 46.2)
        sliding_door(P, "h", D, 43.8, 46.2)
        opens.append(("door", "h", D, 43.8, 46.2))
        win("h", D, 39.95, 42.75)
        # 东侧急诊入口
        walls.cut("v", W, 11.4, 13.8)
        sliding_door(P, "v", W, 11.4, 13.8)
        opens.append(("door", "v", W, 11.4, 13.8))
    return opens


def sliding_door(P, o, c, a, b, L="DOOR"):
    """自动感应推拉门：两扇门扇错开画"""
    m = (a + b) / 2
    for s0, s1, off in ((a, m + 0.1, -0.06), (m - 0.1, b, 0.06)):
        if o == "h":
            P.rect(L, s0, c + off - 0.03, s1, c + off + 0.03)
        else:
            P.rect(L, c + off - 0.03, s0, c + off + 0.03, s1)


def text_w(s):
    """估算字宽（以字高为单位）：汉字 1，数字 / 字母 / 空格约 0.55"""
    return sum(1.0 if ord(c) > 127 else 0.55 for c in s)


def wrap(name, max_w):
    """房间名折行：优先断在"诊室 / 办公室 / ××室"前或"科"后，避免"诊 / 室"这种断法。"""
    if text_w(name) <= max_w:
        return [name]
    cands = [name.find(k) for k in ("诊室", "办公室", "彩超室", "钼靶室", "摄片室")]
    k = name.find("科")
    cands += [k + 1 if 0 < k < len(name) - 1 else -1, len(name) - 3, len(name) // 2]
    for i in cands:
        if i > 0 and text_w(name[:i]) <= max_w and text_w(name[i:]) <= max_w:
            return [name[:i], name[i:]]
    n = math.ceil(text_w(name) / max_w)
    k = math.ceil(len(name) / n)
    return [name[i:i + k] for i in range(0, len(name), k)]


def room_label(P, r):
    """房间名 + 房间号；窄房间自动折行。"""
    if r["kind"] == "entrance":
        x0, y0, x1, y1 = r["rect"]
        P.text("TEXT2", ((x0 + x1) / 2, (y0 + y1) / 2), r["name"], 0.7)
        return
    x0, y0, x1, y1 = r["rect"]
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    if r["side"] in "NS" and not r["key"].startswith("CORE"):
        cy = y1 - 3.0 if r["side"] == "N" else y0 + 3.0
    h = 0.62
    lines = wrap(r["label"], max(2.0, (x1 - x0 - 0.4) / h))
    layer = "TEXT" if r["dest"] else "TEXT2"
    total = len(lines) + (1 if r.get("num") else 0)
    top = cy + (total - 1) * h * 0.65
    for i, s in enumerate(lines):
        P.text(layer, (cx, top - i * h * 1.3), s, h)
    if r.get("num"):
        P.text("NUM", (cx, top - len(lines) * h * 1.3 - 0.05), r["num"], 0.55, font="num")


# ---------------------------------------------------------------- 图纸注释：轴线、尺寸、雨棚
AXIS_X = [str(i + 1) for i in range(NX + 1)]
AXIS_Y = list("ABCDEFG")


def annotations(f):
    P = Prims()
    top, bottom, left, right = D + 9.0, -9.6, -7.6, W + 9.6
    for i in range(NX + 1):
        x = i * GRID
        P.line("AXIS", (x, bottom + 1.0), (x, top - 1.0))
        for y in (top, bottom):
            P.circle("AXIS_B", (x, y), 1.0)
            P.text("AXIS_T", (x, y), AXIS_X[i], 1.0, font="num")
    for j in range(NY + 1):
        y = j * GRID
        P.line("AXIS", (left + 1.0, y), (right - 1.0, y))
        for x in (left, right):
            P.circle("AXIS_B", (x, y), 1.0)
            P.text("AXIS_T", (x, y), AXIS_Y[j], 1.0, font="num")
    # 尺寸：上方分跨 + 总长，左侧分跨 + 总宽（单位 mm）
    dim_chain(P, "h", D + 4.2, [i * GRID for i in range(NX + 1)])
    dim_chain(P, "h", D + 6.0, [0.0, W])
    dim_chain(P, "v", -3.4, [j * GRID for j in range(NY + 1)])
    dim_chain(P, "v", -5.2, [0.0, D])
    if f == 0:
        # 雨棚（在上方，虚线）+ 台阶 / 坡道
        P.rect("HIDDEN", 34.2, -5.4, 52.2, 0.0)
        P.text("TEXT2", (43.2, -4.4), "雨棚", 0.6)
        for k in range(3):
            P.line("FURN", (36.0, -0.5 - k * 0.35), (50.4, -0.5 - k * 0.35))
        P.rect("HIDDEN", 38.4, D, 48.0, D + 3.0)
        P.text("TEXT2", (43.2, D + 2.2), "雨棚", 0.6)
        P.rect("HIDDEN", W, 8.4, W + 6.0, 16.8)
        P.text("TEXT2", (W + 3.0, 15.6), "急诊雨棚", 0.6)
        P.text("TEXT2", (W + 3.0, 9.5), "救护车停靠", 0.5)
        entrance_mark(P, (X_AXIS, -6.6), "主入口", 90, (X_AXIS + 1.4, -6.6), "left")
        entrance_mark(P, (49.6, D + 1.6), "北入口", -90, (51.0, D + 1.6), "left")
        entrance_mark(P, (W + 7.0, 12.6), "急诊入口", 180, (W + 7.4, 11.0), "center")
    return P


def entrance_mark(P, p, name, ang, tp, ha):
    """入口三角标记（ang 为三角形指向的角度）+ 文字（tp 处）"""
    a = math.radians(ang)
    tip = (p[0] + 1.0 * math.cos(a), p[1] + 1.0 * math.sin(a))
    l = (p[0] + 0.8 * math.cos(a + 2.4), p[1] + 0.8 * math.sin(a + 2.4))
    r = (p[0] + 0.8 * math.cos(a - 2.4), p[1] + 0.8 * math.sin(a - 2.4))
    P.poly("MARK", [tip, l, r], fill="mark")
    P.text("MARK_T", tp, name, 0.75, ha=ha)


def dim_chain(P, o, at, marks):
    """连续尺寸线：o = h 水平（at 为 y），v 竖直（at 为 x）；标注值为 mm。"""
    if o == "h":
        P.line("DIM", (marks[0] - 0.6, at), (marks[-1] + 0.6, at))
        for m in marks:
            P.line("DIM", (m, at - 0.6), (m, at + 0.6))
            P.line("DIM", (m - 0.35, at - 0.35), (m + 0.35, at + 0.35))
        for a, b in zip(marks, marks[1:]):
            P.text("DIM_T", ((a + b) / 2, at + 0.55), f"{round((b - a) * 1000)}", 0.62, va="bottom", font="num")
    else:
        P.line("DIM", (at, marks[0] - 0.6), (at, marks[-1] + 0.6))
        for m in marks:
            P.line("DIM", (at - 0.6, m), (at + 0.6, m))
            P.line("DIM", (at - 0.35, m - 0.35), (at + 0.35, m + 0.35))
        for a, b in zip(marks, marks[1:]):
            P.text("DIM_T", (at - 0.55, (a + b) / 2), f"{round((b - a) * 1000)}", 0.62, va="bottom", rot=90, font="num")

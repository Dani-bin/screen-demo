"""
楼层建模：每种楼层一个模型（变体），三维场景里按楼层数据把变体摆到各层（见 src/views/building/scene/tower/）
----------------------------------------------------------
层高与平面必须和 BuildingScene.js 的常量一致：
  标准层 FLOOR = 2.2 m（示意比例，真实 3.76 m）、裙楼 PODIUM_FLOOR = 4.6 m、裙楼平面 = 塔楼平面 × PODIUM_SCALE 1.42；
  塔楼平面内收 0.35 m（玻璃幕墙在 three.js 里），收分（越往上越小）由 three.js 按层缩放；
  核心筒：沿平面主轴放置，长、短边 = 主轴向 / 次轴向全长 × 0.16 / 0.17（与 BuildingScene._coreDims 一致）。
变体（VARIANTS）：
  off_100 / off_85 / off_70 / off_55 / off_40  办公层，数字为亮灯比例（12 个分区按比例点亮，种子不同，布局一致）
  lobby  1～2F 入口大堂     retail  3～4F 商业     plant  设备层     sky  顶层空中会所
每个变体两个对象：<名>（楼板顶面 + 核心筒墙，烘焙到贴图）与 <名>_v（板边、天花、家具、灯盘，烘焙到顶点色）；
灯盘为自发光，Cycles 里真实照亮室内。
"""

import math
import random

import bmesh
from mathutils import Matrix

from . import lib

FLOOR = 2.2
PODIUM_FLOOR = 4.6
PODIUM_SCALE = 1.42
INSET = 0.35

VARIANTS = {
    "off_100": {"kind": "office", "lit": 1.0, "seed": 11},
    "off_85": {"kind": "office", "lit": 0.85, "seed": 23},
    "off_70": {"kind": "office", "lit": 0.7, "seed": 37},
    "off_55": {"kind": "office", "lit": 0.55, "seed": 41},
    "off_40": {"kind": "office", "lit": 0.4, "seed": 53},
    "lobby": {"kind": "lobby", "lit": 1.0, "seed": 61},
    "retail": {"kind": "retail", "lit": 1.0, "seed": 67},
    "plant": {"kind": "plant", "lit": 0.6, "seed": 71},
    "sky": {"kind": "sky", "lit": 1.0, "seed": 79},
}

# 材质表：名称 → (颜色 sRGB, 粗糙度, 自发光颜色, 强度)。灯盘强度按「楼板被照到约 0.3 的亮度」估算
MATS = [
    ("carpet", "#6a6d74", 0.9, None, 0),
    ("stone", "#9a948c", 0.35, None, 0),
    ("slab_edge", "#8a8e96", 0.7, None, 0),
    ("ceiling", "#b8bcc2", 0.9, None, 0),
    ("concrete", "#7d8088", 0.85, None, 0),
    ("wood", "#a8835c", 0.55, None, 0),
    ("panel", "#56657c", 0.8, None, 0),  # 工位隔板（布面）
    ("chair", "#2e323a", 0.6, None, 0),
    ("monitor", "#0d0f12", 0.4, None, 0),
    ("screen", "#000000", 0.3, "#bcd6ff", 2.5),
    ("screen_w", "#000000", 0.3, "#ffe1b8", 2.5),
    ("alu", "#b4bac2", 0.35, None, 0),
    ("leaf", "#2f5a2c", 0.8, None, 0),
    ("pot", "#d8d4cc", 0.6, None, 0),
    ("sofa", "#7a6a58", 0.8, None, 0),
    ("ahu", "#4a6f9e", 0.5, None, 0),
    ("duct", "#9aa3ad", 0.35, None, 0),
    ("light_off", "#d9dce0", 0.5, None, 0),
    ("light_warm", "#ffffff", 0.5, "#ffd9ad", 12.0),
    ("light_cool", "#ffffff", 0.5, "#e2ecff", 12.0),
    ("light_lobby", "#ffffff", 0.5, "#ffcf8f", 14.0),
]
MI = {name: i for i, (name, *_) in enumerate(MATS)}


def materials():
    return [lib.material("MT_" + n, c, rough=r, emit=e, strength=s) for n, c, r, e, s in MATS]


# ---------------------------------------------------------------- 平面工具


def tower_plan(layout, key):
    """塔楼平面：layout.json 的轮廓减去形心（与 build-park-layout.mjs 的 PARK_TOWERS 一致：顶点平均、保留一位小数）"""
    b = next(x for x in layout["buildings"] if x["key"] == key)
    ring = b["footprint"]
    cx = round(sum(p[0] for p in ring) / len(ring), 1)
    cy = round(sum(p[1] for p in ring) / len(ring), 1)
    return [(round(x - cx, 1), round(y - cy, 1)) for x, y in ring], b


def inset(ring, d):
    """沿形心方向内收（d 为负即外扩）"""
    out = []
    for x, y in ring:
        r = math.hypot(x, y) or 1
        k = max(0.0, (r - d) / r)
        out.append((x * k, y * k))
    return out


def in_poly(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def major_axis(ring):
    sxx = sum(x * x for x, _ in ring)
    syy = sum(y * y for _, y in ring)
    sxy = sum(x * y for x, y in ring)
    return 0.5 * math.atan2(2 * sxy, sxx - syy)


def core_dims(ring, ang):
    """核心筒长、短边（与 BuildingScene._coreDims 相同算法，用未内收的塔楼平面）"""
    ca, sa = math.cos(ang), math.sin(ang)
    ma = max(abs(x * ca + y * sa) for x, y in ring)
    mb = max(abs(-x * sa + y * ca) for x, y in ring)
    return ma * 2 * 0.16, mb * 2 * 0.17


# ---------------------------------------------------------------- 楼层


def build(name, foot, variant, M, col, loc):
    """生成一个楼层模型；foot 为塔楼原始平面（未内收），loc 为烘焙时摆放的位置（各变体错开，互不照亮）"""
    v = VARIANTS[variant]
    kind = v["kind"]
    rnd = random.Random(v["seed"])
    podium = kind in ("lobby", "retail")
    H = PODIUM_FLOOR if podium else FLOOR
    ang = major_axis(foot)
    cw, cd = core_dims(foot, ang)
    plan = inset([(x * PODIUM_SCALE, y * PODIUM_SCALE) for x, y in foot] if podium else foot, INSET)
    ca, sa = math.cos(ang), math.sin(ang)

    def xy(a, b):
        """主轴坐标 (a 沿长轴, b 沿短轴) → 平面 xy"""
        return a * ca - b * sa, a * sa + b * ca

    def inside(a, b, margin=0.0):
        x, y = xy(a, b)
        return in_poly(x, y, inset(plan, margin) if margin else plan)

    inner2 = inset(plan, 1.8)

    def ok(a, b, pad_core=1.6):
        x, y = xy(a, b)
        if not in_poly(x, y, inner2):
            return False
        return not (abs(a) < cw / 2 + pad_core and abs(b) < cd / 2 + pad_core)

    # 两个网格：bm = 楼板顶面 + 核心筒墙（大面，烘焙到贴图）；bv = 其它一切（家具、灯盘、天花、板边，烘焙到顶点色）。
    # 家具有上千个小面，放进贴图会切成上万个 UV 岛，岛间留缝把贴图挤得没有地方给楼板；家具很小，逐顶点的明暗就够了
    bm = bmesh.new()
    bv = bmesh.new()
    lib.add_poly(bm, plan, 0.0, MI["stone" if podium or kind == "sky" else "carpet"])
    core = [xy(-cw / 2, -cd / 2), xy(cw / 2, -cd / 2), xy(cw / 2, cd / 2), xy(-cw / 2, cd / 2)]
    lib.add_band(bm, core, 0.0, H - 0.03, MI["concrete"])
    lib.add_band(bv, plan, -0.32, 0.0, MI["slab_edge"])
    lib.add_poly(bv, plan, H - 0.03, MI["ceiling"], down=True)
    # 天花背面（朝上）：从斜上方透过玻璃看进楼层时，挡住吊顶灯盘的顶面（真实楼宇里天花是实心的）
    lib.add_poly(bv, plan, H - 0.025, MI["concrete"])

    # ---- 亮灯分区：长轴 6 段 × 短轴 2 段，按比例点亮
    zones = [(i, j) for i in range(6) for j in range(2)]
    rnd.shuffle(zones)
    lit_zones = set(zones[: round(len(zones) * v["lit"])])
    amax = max(abs(x * ca + y * sa) for x, y in plan)

    def zone_lit(a, b):
        i = min(5, max(0, int((a + amax) / (2 * amax) * 6)))
        return (i, 0 if b < 0 else 1) in lit_zones

    # ---- 吊顶灯盘：2.4 m 网格
    step = 2.4
    n = int(amax / step) + 2
    for i in range(-n, n + 1):
        for j in range(-n, n + 1):
            a, b = i * step, j * step + step / 2
            if not ok(a, b, 0.6):
                continue
            if podium:
                m = MI["light_lobby"]
            elif kind == "plant":
                m = MI["light_cool"] if zone_lit(a, b) and rnd.random() < 0.6 else MI["light_off"]
            else:
                on = zone_lit(a, b) and rnd.random() > 0.05
                m = (MI["light_cool"] if rnd.random() < 0.2 else MI["light_warm"]) if on else MI["light_off"]
            x, y = xy(a, b)
            lib.add_box(bv, (1.2, 0.6, 0.05), (x, y, H - 0.08), ang, m, bottom=True)

    # ---- 家具
    if kind in ("office",):
        _office(bv, ok, xy, ang, zone_lit, rnd, cw, cd)
    elif kind == "plant":
        _plant(bv, ok, xy, ang, rnd, H)
    elif kind == "sky":
        _sky(bv, ok, xy, ang, rnd)
    else:
        _podium(bv, ok, xy, ang, rnd, kind, plan, H)
    _plants(bv, ok, xy, rnd, 10 if kind != "plant" else 0)

    ob = lib.new_object(name, bm, M, col)
    ov = lib.new_object(name + "_v", bv, M, col)
    for o in (ob, ov):
        o.location = loc
        o["variant"] = variant
        o["height"] = H
    return ob, ov


def _office(bm, ok, xy, ang, zone_lit, rnd, cw, cd):
    """办公：4 人一组的工位岛（两两相对 + 中间隔板），核心筒长轴两端各一间会议室，零星文件柜"""
    W = MI
    # 会议室：核心筒两端，桌 + 椅 + 铝合金框
    for s in (-1, 1):
        a0 = s * (cw / 2 + 4.2)
        if not ok(a0, 0, 0):
            continue
        x, y = xy(a0, 0)
        lib.add_box(bm, (2.4, 4.0, 0.06), (x, y, 0.74), ang, W["wood"])
        lib.add_box(bm, (1.4, 3.0, 0.7), (x, y, 0.36), ang, W["chair"])
        for k in range(4):
            for t in (-1, 1):
                cx, cy = xy(a0 + t * 1.6, -1.5 + k)
                lib.add_box(bm, (0.5, 0.5, 0.45), (cx, cy, 0.23), ang, W["chair"])
        # 会议室框：四角立柱 + 顶框（玻璃不建，否则挡光）
        for ta in (-1, 1):
            for tb in (-1, 1):
                px, py = xy(a0 + ta * 2.4, tb * 2.8)
                lib.add_box(bm, (0.08, 0.08, 2.1), (px, py, 1.05), ang, W["alu"])
        for tb in (-1, 1):
            px, py = xy(a0, tb * 2.8)
            lib.add_box(bm, (4.8, 0.08, 0.08), (px, py, 2.1), ang, W["alu"])
    # 工位岛：长轴方向 3.4 m、短轴方向 3.8 m 一组
    for i in range(-14, 15):
        for j in range(-10, 11):
            a, b = i * 3.4, j * 3.8 + 1.9
            if not all(ok(a + da, b + db) for da in (-1.5, 1.5) for db in (-1.6, 1.6)):
                continue
            if any(abs(a - s * (abs(cw) / 2 + 4.2)) < 3.2 and abs(b) < 3.6 for s in (-1, 1)):
                continue  # 让出会议室
            lit = zone_lit(a, b)
            if rnd.random() < 0.06:
                x, y = xy(a, b)
                lib.add_box(bm, (2.8, 0.5, 1.1), (x, y, 0.55), ang, W["alu"])  # 文件柜
                continue
            x, y = xy(a, b)
            lib.add_box(bm, (2.8, 0.04, 0.4), (x, y, 0.95), ang, W["panel"])  # 中间隔板
            for side in (-1, 1):
                for da in (-0.7, 0.7):
                    dx, dy = xy(a + da, b + side * 0.38)
                    lib.add_box(bm, (1.36, 0.72, 0.04), (dx, dy, 0.74), ang, W["wood"])  # 桌面
                    lx, ly = xy(a + da, b + side * 0.7)
                    lib.add_box(bm, (1.3, 0.04, 0.68), (lx, ly, 0.36), ang, W["panel"])  # 桌下挡板
                    if rnd.random() < 0.85:
                        cx, cy = xy(a + da + rnd.uniform(-0.15, 0.15), b + side * 1.15)
                        r = ang + rnd.uniform(-0.4, 0.4)
                        lib.add_box(bm, (0.5, 0.5, 0.08), (cx, cy, 0.46), r, W["chair"])  # 椅面
                        bx, by = xy(a + da, b + side * 1.38)
                        lib.add_box(bm, (0.48, 0.06, 0.5), (bx, by, 0.75), r, W["chair"])  # 椅背
                    mx, my = xy(a + da, b + side * 0.12)
                    on = lit and rnd.random() < 0.85
                    lib.add_box(bm, (0.6, 0.03, 0.36), (mx, my, 1.0), ang, W["screen" if rnd.random() < 0.6 else "screen_w"] if on else W["monitor"])


def _plant(bm, ok, xy, ang, rnd, H):
    """设备层：一排排空调机组 + 顶部风管"""
    for i in range(-6, 7):
        for b in (-8.5, 8.5):
            a = i * 6.0
            if not ok(a, b, 1.0):
                continue
            x, y = xy(a, b)
            lib.add_box(bm, (4.4, 2.4, min(1.6, H - 0.4)), (x, y, min(0.8, (H - 0.4) / 2)), ang, MI["ahu"])
    for b in (-5, 5):
        for i in range(-8, 9):
            a = i * 4.0
            if ok(a, b, 0.5):
                x, y = xy(a, b)
                lib.add_box(bm, (4.0, 0.9, 0.5), (x, y, H - 0.5), ang, MI["duct"], bottom=True)


def _sky(bm, ok, xy, ang, rnd):
    """空中会所：圆桌 + 四把椅子 + 吧台"""
    for i in range(-12, 13):
        for j in range(-9, 10):
            a, b = i * 3.6, j * 3.6 + 1.8
            if not ok(a, b, 2.0) or rnd.random() < 0.15:
                continue
            x, y = xy(a, b)
            lib.add_cyl(bm, 0.55, 0.74, (x, y, 0.0), seg=10, mat=MI["wood"])
            for k in range(4):
                t = k * math.pi / 2 + 0.4
                lib.add_box(bm, (0.45, 0.45, 0.46), (x + 1.0 * math.cos(t), y + 1.0 * math.sin(t), 0.23), t, MI["sofa"])


def _podium(bm, ok, xy, ang, rnd, kind, plan, H):
    """大堂：前台 + 沙发组 + 圆柱；商业：展台 + 货架岛"""
    # 一圈圆柱（裙楼结构柱）
    ring = inset(plan, 3.0)
    for i in range(0, len(ring), max(1, len(ring) // 14)):
        x, y = ring[i]
        lib.add_cyl(bm, 0.45, H - 0.05, (x, y, 0.0), seg=12, mat=MI["stone"], cap=False)
    if kind == "lobby":
        for s in (-1, 1):
            x, y = xy(0, s * 9.0)
            lib.add_box(bm, (8.0, 1.0, 1.1), (x, y, 0.55), ang, MI["wood"])  # 前台
        for k in range(14):
            a, b = rnd.uniform(-30, 30), rnd.uniform(-24, 24)
            if not ok(a, b, 2.5):
                continue
            x, y = xy(a, b)
            lib.add_box(bm, (2.4, 0.9, 0.42), (x, y, 0.21), ang, MI["sofa"])
            bx, by = xy(a, b + 0.4)
            lib.add_box(bm, (2.4, 0.2, 0.75), (bx, by, 0.38), ang, MI["sofa"])
            tx, ty = xy(a, b - 1.2)
            lib.add_box(bm, (1.2, 0.6, 0.4), (tx, ty, 0.2), ang, MI["stone"])
    else:
        for k in range(26):
            a, b = rnd.uniform(-34, 34), rnd.uniform(-26, 26)
            if not ok(a, b, 2.5):
                continue
            x, y = xy(a, b)
            if rnd.random() < 0.5:
                lib.add_box(bm, (3.0, 1.2, 1.0), (x, y, 0.5), ang, MI["wood"])  # 展台
            else:
                lib.add_box(bm, (4.0, 0.5, 1.8), (x, y, 0.9), ang, MI["alu"])  # 货架


def _plants(bm, ok, xy, rnd, n):
    """盆栽：白色花盆 + 叶团（近看才有，远看是一点点绿）"""
    for _ in range(n * 4):
        if n <= 0:
            break
        a, b = rnd.uniform(-30, 30), rnd.uniform(-24, 24)
        if not ok(a, b, 0.8):
            continue
        x, y = xy(a, b)
        lib.add_cyl(bm, 0.25, 0.45, (x, y, 0.0), seg=8, mat=MI["pot"])
        res = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.45, matrix=Matrix.Translation((x, y, 0.9)))
        for f in {f for v in res["verts"] for f in v.link_faces}:
            f.material_index = MI["leaf"]
        n -= 1

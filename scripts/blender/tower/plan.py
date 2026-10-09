"""
楼层级 · 标准办公层平面布局（纯 Python，不依赖 bpy：Blender 建模与前端数据共用这一份布局）
----------------------------------------------------------
设计稿：docs/design/building/03-ai-floor.png、13-draft-floor.png（南塔 32F）。
平面 = 塔楼真实椭圆轮廓（layout.json，同 floors.tower_plan），沿平面主轴建一个局部坐标 (a 沿长轴, b 沿短轴)，
b > 0 一侧是三维里朝向相机的「前方」。布局：
  中央核心筒（长 0.72 A × 宽 0.6 B）：前半是电梯厅、中间一排 6 部电梯，两端楼梯间，后排男 / 女卫生间、强电间、保洁间；
  核心筒外一圈 1.6 m 走道；走道到幕墙之间按角度分成 7 个区。相机从前方（+b）看过去时 +a 在画面左侧，所以按画面：
  左侧开放办公 A、前方开放办公 B，后排从左到右洽谈室、大会议室、总经理室、茶水间，右端弱电机房（同设计稿）。
  角度 θ 在归一化椭圆坐标里量：θ = atan2(b / B, a / A)，0° 指向 +a（画面左），90° 指向前方。
run() 生成 src/views/building/data/floorPlan.js（三维交互、面板用：房间多边形、玻璃隔断、工位、设备点位），
build_plan(key) 给 detail.py 建模用。命令行：python3 scripts/blender/tower/plan.py
"""

import json
import math
import os
import random

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
LAYOUT = os.path.join(ROOT, "scripts", "blender", "park", "layout.json")
OUT_JS = os.path.join(ROOT, "src", "views", "building", "data", "floorPlan.js")
TOWERS = {"S": "tower_S", "N": "tower_N"}

STOREY = 3.8  # 楼层级按真实层高建模（楼宇级是 2.2 m 的示意层高，两者互不相干）
WALL_H = 2.8  # 隔墙 / 吊顶高度
FACADE_IN = 0.35  # 楼板边到幕墙内收
CORRIDOR = 1.6  # 核心筒外走道宽

# 外圈房间：编号、名称、类型、起止角度（度）、围合方式（open 开敞 / glass 玻璃隔断 / solid 实墙）
RING_ROOMS = [
    ("3212", "茶水间", "pantry", -166, -138, "glass"),
    ("3210", "总经理室", "manager", -138, -110, "glass"),
    ("3205", "大会议室", "conference", -110, -56, "glass"),
    ("3206", "洽谈室", "meeting", -56, -26, "glass"),
    ("3201", "开放办公区 A", "office", -26, 62, "open"),
    ("3202", "开放办公区 B", "office", 62, 168, "open"),
    ("3208", "弱电机房", "machine", 168, 194, "solid"),
]


# ---------------------------------------------------------------- 几何工具


def tower_plan(layout, key):
    """塔楼平面：layout.json 的轮廓减去形心（与 floors.tower_plan 相同）"""
    b = next(x for x in layout["buildings"] if x["key"] == key)
    ring = b["footprint"]
    cx = round(sum(p[0] for p in ring) / len(ring), 1)
    cy = round(sum(p[1] for p in ring) / len(ring), 1)
    return [(round(x - cx, 1), round(y - cy, 1)) for x, y in ring], b


def inset(ring, d):
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


def area_centroid(poly):
    a = cx = cy = 0.0
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        c = x0 * y1 - x1 * y0
        a += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    a *= 0.5
    return abs(a), (cx / (6 * a), cy / (6 * a))


def ray_hit(ring, d):
    """从原点沿方向 d 射出，与闭合多边形的最近交点距离"""
    best = None
    n = len(ring)
    for i in range(n):
        (x0, y0), (x1, y1) = ring[i], ring[(i + 1) % n]
        ex, ey = x1 - x0, y1 - y0
        den = d[0] * ey - d[1] * ex
        if abs(den) < 1e-9:
            continue
        t = (x0 * ey - y0 * ex) / den
        u = (x0 * d[1] - y0 * d[0]) / den
        if t > 0 and -1e-9 <= u <= 1 + 1e-9 and (best is None or t < best):
            best = t
    return best


def major_axis(ring):
    sxx = sum(x * x for x, _ in ring)
    syy = sum(y * y for _, y in ring)
    sxy = sum(x * y for x, y in ring)
    return 0.5 * math.atan2(2 * sxy, sxx - syy)


# ---------------------------------------------------------------- 布局


def build_plan(key):
    """返回局部坐标 (a, b) 下的完整布局，以及换算到 Blender xy 的函数"""
    with open(LAYOUT, encoding="utf-8") as f:
        layout = json.load(f)
    foot, _ = tower_plan(layout, key)
    ang = major_axis(foot)
    ca, sa = math.cos(ang), math.sin(ang)

    def to_ab(x, y):
        return x * ca + y * sa, -x * sa + y * ca

    def to_xy(a, b):
        return a * ca - b * sa, a * sa + b * ca

    slab = [to_ab(x, y) for x, y in inset(foot, FACADE_IN)]  # 楼板 / 幕墙内侧轮廓（局部坐标）
    A = max(abs(a) for a, _ in slab)
    B = max(abs(b) for _, b in slab)
    core = (0.36 * A, 0.3 * B)  # 核心筒半长、半宽
    cor = (core[0] + CORRIDOR, core[1] + CORRIDOR)  # 走道外沿

    def theta(a, b):
        return math.degrees(math.atan2(b / B, a / A))

    def dir_of(t):
        r = math.radians(t)
        d = (A * math.cos(r), B * math.sin(r))
        n = math.hypot(*d)
        return d[0] / n, d[1] / n

    def rect_hit(t, half):
        d = dir_of(t)
        k = min(half[0] / max(abs(d[0]), 1e-9), half[1] / max(abs(d[1]), 1e-9))
        return d[0] * k, d[1] * k

    def facade_hit(t):
        d = dir_of(t)
        k = ray_hit(slab, d)
        return d[0] * k, d[1] * k

    def ring_poly(t0, t1):
        """角度 t0→t1 之间、走道外沿到幕墙的扇环（外弧按 1° 采样，内沿含矩形转角）"""
        outer = [facade_hit(t0 + (t1 - t0) * i / max(1, round(t1 - t0))) for i in range(round(t1 - t0) + 1)]
        corners = []
        for sx in (-1, 1):
            for sy in (-1, 1):
                tc = theta(sx * cor[0], sy * cor[1])
                for off in (0, 360, -360):
                    if t0 < tc + off < t1:
                        corners.append((tc + off, (sx * cor[0], sy * cor[1])))
        inner = [rect_hit(t1, cor)] + [p for _, p in sorted(corners, reverse=True)] + [rect_hit(t0, cor)]
        return outer + inner

    rooms = []
    for rid, name, typ, t0, t1, enc in RING_ROOMS:
        rooms.append({"id": rid, "name": name, "type": typ, "poly": ring_poly(t0, t1), "enclosure": enc, "t": (t0, t1)})

    # 核心筒内的房间（矩形，局部坐标 a0, a1, b0, b1 为核心筒半长 / 半宽的比例）
    cx, cy = core

    def rect(a0, a1, b0, b1):
        return [(a0 * cx, b0 * cy), (a1 * cx, b0 * cy), (a1 * cx, b1 * cy), (a0 * cx, b1 * cy)]

    # 核心筒房间铺满核心筒（边界落在隔墙中线上：a = ±0.46、b = -0.22 / -0.48 / 0.02），地面互不重叠
    CORE_ROOMS = [
        ("3213", "电梯厅", "lobby", rect(-0.46, 0.46, 0.02, 1.0)),
        ("3203", "楼梯间 1", "stair", rect(0.46, 1.0, -0.22, 1.0)),
        ("3214", "楼梯间 2", "stair", rect(-1.0, -0.46, -0.22, 1.0)),
        ("3204", "男卫生间", "wc", rect(-0.46, 0.0, -1.0, -0.48)),
        ("3207", "女卫生间", "wc", rect(0.0, 0.46, -1.0, -0.48)),
        ("3209", "强电间", "power", rect(0.46, 1.0, -1.0, -0.22)),
        ("3211", "保洁间", "service", rect(-1.0, -0.46, -1.0, -0.22)),
    ]
    for rid, name, typ, poly in CORE_ROOMS:
        rooms.append({"id": rid, "name": name, "type": typ, "poly": poly, "enclosure": "core"})
    shafts = rect(-0.46, 0.46, -0.48, 0.02)  # 6 部电梯井（门朝前方电梯厅）

    # ---- 墙：外圈封闭房间的径向边 + 走道一侧（玻璃隔断 / 实墙），走道一侧中间留 1.2 m 门洞
    walls = []  # (a0, b0, a1, b1, 类型 glass/solid, 是否门洞)
    doors = {}
    for r in rooms[: len(RING_ROOMS)]:
        if r["enclosure"] == "open":
            continue
        t0, t1 = r["t"]
        kind = r["enclosure"]
        for t in (t0, t1):
            p, q = rect_hit(t, cor), facade_hit(t)
            walls.append((p[0], p[1], q[0], q[1], kind))
        # 走道一侧：内沿折线（扇环多边形的内沿部分）
        inner = r["poly"][round(t1 - t0) + 1 :]
        segs = list(zip(inner, inner[1:]))
        longest = max(range(len(segs)), key=lambda i: math.dist(*segs[i]))
        for i, (p, q) in enumerate(segs):
            if i == longest:
                # 门洞：最长一段的中点两侧各 0.6 m
                L = math.dist(p, q)
                m = ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
                u = ((q[0] - p[0]) / L, (q[1] - p[1]) / L)
                walls.append((p[0], p[1], m[0] - u[0] * 0.6, m[1] - u[1] * 0.6, kind))
                walls.append((m[0] + u[0] * 0.6, m[1] + u[1] * 0.6, q[0], q[1], kind))
                doors[r["id"]] = m
            else:
                walls.append((p[0], p[1], q[0], q[1], kind))

    # ---- 开放办公工位：沿主轴对齐的 4 人岛（2 × 2），岛距 4.2 × 4.6 m
    rnd = random.Random(32)
    desks = []
    columns = []
    # 结构柱：幕墙内 1.8 m 一圈，约 9 m 一根
    ring_c = inset([(a, b) for a, b in slab], 1.8)
    per = 0.0
    for i in range(len(ring_c)):
        per += math.dist(ring_c[i], ring_c[(i + 1) % len(ring_c)])
    n_col = max(8, round(per / 9))
    for k in range(n_col):
        t = k * 360 / n_col + 8
        d = dir_of(t)
        h = ray_hit(ring_c, d)
        columns.append((d[0] * h, d[1] * h))

    # 工位岛沿幕墙弧线排成几排（离幕墙 2.5 / 6.2 / 9.9 m），岛的朝向跟着弧线切线走，每岛 6 人（沿切线 3 × 两侧）
    office = [r for r in rooms if r["type"] == "office"]
    for r in office:
        poly = r["poly"]
        tag = "A" if r["id"] == "3201" else "B"
        n = 0
        for depth in (2.5, 6.2, 9.9):
            path = inset(slab, depth)
            # 沿这一圈每 0.2 m 取样，累计弧长；每 5.3 m 试放一个岛
            pts = []
            for i in range(len(path)):
                p0, p1 = path[i], path[(i + 1) % len(path)]
                L = math.dist(p0, p1)
                for k in range(max(1, int(L / 0.2))):
                    t = k * 0.2 / L
                    pts.append(((p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t), math.atan2(p1[1] - p0[1], p1[0] - p0[0])))
            acc, last = 0.0, -99.0
            prev = pts[0][0]
            for (a, b), rot in pts:
                acc += math.dist(prev, (a, b))
                prev = (a, b)
                if acc - last < 5.3:
                    continue
                cu, su = math.cos(rot), math.sin(rot)

                def at(u, v):
                    return a + u * cu - v * su, b + u * su + v * cu

                corners = [at(u, v) for u in (-2.4, 2.4) for v in (-1.8, 1.8)]
                if not all(in_poly(x, y, poly) for x, y in corners):
                    continue
                if any(abs(x) < cor[0] + 0.8 and abs(y) < cor[1] + 0.8 for x, y in corners):
                    continue
                if any(math.dist((a, b), c) < 2.3 for c in columns):
                    continue
                last = acc
                for du in (-1.4, 0.0, 1.4):
                    for side in (-1, 1):
                        n += 1
                        x, y = at(du, side * 0.38)
                        desks.append({"id": f"{tag}-{n:02d}", "room": r["id"], "a": x, "b": y, "rot": rot, "face": side})
        r["desks"] = n

    # ---- 机房机柜：两排，每排 5 台，R03 告警（与面板告警「机柜 R03 进风温度」一致）
    mach = next(r for r in rooms if r["type"] == "machine")
    _, (ma, mb) = area_centroid(mach["poly"])
    racks = []
    for row, db in enumerate((-1.3, 1.3)):
        for k in range(5):
            racks.append({"id": f"R{row * 5 + k + 1:02d}", "a": ma - 0.15, "b": mb + db + (k - 2) * 0.0, "k": k, "row": row})
    # 机柜沿房间的径向排开（机房在右端，径向 ≈ a 方向）：一排 5 台沿 b，两排在 a 方向错开
    for r_ in racks:
        r_["a"] = ma + (r_["row"] - 0.5) * 2.4
        r_["b"] = mb + (r_["k"] - 2) * 0.65

    # ---- 设备点位（吊顶上的空调内机、摄像头、烟感、门禁、AP），三维里设备视图显示
    devices = []

    def add_dev(typ, a, b, room):
        devices.append({"type": typ, "a": a, "b": b, "room": room})

    for r in rooms:
        area, (ra, rb) = area_centroid(r["poly"])
        r["area"] = area
        r["center"] = (ra, rb)
        poly = r["poly"]
        # 空调内机：约每 36 m² 一台（6 m 网格）；烟感：每 20 m² 一个（4.5 m 网格），落在房间内
        for typ, step in (("ac", 6.0), ("smoke", 4.5)):
            if r["type"] in ("stair", "lobby") and typ == "ac":
                continue
            for i in range(-12, 13):
                for j in range(-8, 9):
                    a, b = i * step + step / 2, j * step + step / 2
                    if in_poly(a, b, poly) and all(in_poly(a + da, b + db, poly) for da in (-0.8, 0.8) for db in (-0.8, 0.8)):
                        add_dev(typ, a, b, r["id"])
        if r["id"] in doors:
            add_dev("access", *doors[r["id"]], r["id"])
    # 摄像头：走道四角 + 电梯厅 + 开放办公区各 3 个；AP：开放办公各 3 个、会议室各 1 个
    for sx in (-1, 1):
        for sy in (-1, 1):
            add_dev("camera", sx * (cor[0] - 0.8), sy * (cor[1] - 0.8), "corridor")
    add_dev("camera", 0, core[1] * 0.9, "3213")
    for r in rooms:
        pts = [d for d in devices if d["room"] == r["id"] and d["type"] == "ac"]
        if r["type"] == "office":
            for d in pts[:: max(1, len(pts) // 3)][:3]:
                add_dev("camera", d["a"] + 1.5, d["b"] + 1.5, r["id"])
                add_dev("ap", d["a"] - 1.5, d["b"] - 1.0, r["id"])
        elif r["type"] in ("conference", "meeting", "machine"):
            ra, rb = r["center"]
            add_dev("ap", ra + 0.8, rb, r["id"])

    return {
        "key": key,
        "ang": ang,
        "to_xy": to_xy,
        "slab": slab,
        "A": A,
        "B": B,
        "core": core,
        "cor": cor,
        "shafts": shafts,
        "rooms": rooms,
        "walls": walls,
        "doors": doors,
        "desks": desks,
        "columns": columns,
        "racks": racks,
        "devices": devices,
        "foot": foot,
    }


# ---------------------------------------------------------------- 导出前端数据


def _three(p, to_xy):
    """局部坐标 (a, b) → three.js 的 (x, z)：Blender (x, y) → three (x, -y)"""
    x, y = to_xy(*p)
    return [round(x, 2), round(-y, 2)]


def export_js():
    out = {}
    for tag, key in TOWERS.items():
        P = build_plan(key)
        T = lambda p: _three(p, P["to_xy"])  # noqa: E731
        fx, fz = T((0, 1))
        ox, oz = T((0, 0))
        out[key] = {
            "storey": STOREY,
            "wallH": WALL_H,
            "front": [round(fx - ox, 4), round(fz - oz, 4)],  # 朝相机的方向（局部 +b）
            "axis": [round(T((1, 0))[0] - ox, 4), round(T((1, 0))[1] - oz, 4)],  # 长轴方向（局部 +a；相机在前方时显示在画面左侧）
            "slab": [T(p) for p in P["slab"]],
            "core": [T(p) for p in [(-P["core"][0], -P["core"][1]), (P["core"][0], -P["core"][1]), (P["core"][0], P["core"][1]), (-P["core"][0], P["core"][1])]],
            "rooms": [
                {
                    "id": r["id"],
                    "name": r["name"],
                    "type": r["type"],
                    "area": round(r["area"], 1),
                    "poly": [T(p) for p in r["poly"]],
                    "center": T(r["center"]),
                    "desks": r.get("desks", 0),
                }
                for r in P["rooms"]
            ],
            "glass": [T((w[0], w[1])) + T((w[2], w[3])) for w in P["walls"] if w[4] == "glass"],
            "desks": [{"id": d["id"], "room": d["room"], "p": T((d["a"], d["b"]))} for d in P["desks"]],
            "racks": [{"id": r["id"], "p": T((r["a"], r["b"]))} for r in P["racks"]],
            "devices": [{"type": d["type"], "room": d["room"], "p": T((d["a"], d["b"]))} for d in P["devices"]],
        }
    js = (
        "/*\n * 楼层级平面布局（由 scripts/blender/tower/plan.py 生成，勿手改；改布局请改脚本后重新运行并重建楼层模型）\n"
        " * 坐标为 three.js 的 (x, z)，米，原点为塔楼形心；与 public/building/floor_S|N.glb 对齐\n */\n"
        f"export const FLOOR_PLANS = {json.dumps(out, ensure_ascii=False, separators=(',', ':'))}\n"
    )
    with open(OUT_JS, "w", encoding="utf-8") as f:
        f.write(js)
    # 按仓库的 .prettierrc 格式化（同 build-building-geo.mjs），生成结果直接通过 ESLint 的 prettier 规则
    import subprocess

    try:
        subprocess.run(["npx", "prettier", "--write", OUT_JS], cwd=ROOT, check=True, capture_output=True)
    except (OSError, subprocess.CalledProcessError):
        print("提示：未能自动格式化，请在仓库根目录运行 npx prettier --write", os.path.relpath(OUT_JS, ROOT))
    return {k: {"rooms": len(v["rooms"]), "desks": len(v["desks"]), "devices": len(v["devices"])} for k, v in out.items()}


if __name__ == "__main__":
    print(export_js())

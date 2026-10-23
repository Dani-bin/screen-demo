"""
无人机巡检 · 化工园区建模 · 摆放
----------------------------------------------------------
读取 site.json（scripts/drone/plan_site.py 从定稿反投影生成），按设备编号摆放全部要素。

命名约定（页面按名字驱动模型，改名会破坏页面）：
- 每台设备 / 巡检对象一个根空物体，名字 = 编号（TK-101、SP-101、U-1、PR-1、FL-1、DK-01……），
  零件都挂在它下面；机场的两扇舱盖是 DK-0x_lid_L / DK-0x_lid_R（原点在外侧铰链）。
- 非设备的场景件用大写前缀：GROUND_*、ROAD_*、TREES、LAMPS、SHIP-1、CTRL-2……
- 无人机不在园区里，单独放在 FLEET 集合（fleet.glb），页面克隆 4 架。

集合：PARK → public/drone/park.glb；FLEET → public/drone/fleet.glb。
"""

import json
import math
import os
import random

import bmesh
import numpy as np

from . import assets, lib, palette

HERE = os.path.dirname(os.path.abspath(__file__))
SITE_PATH = os.path.join(HERE, "site.json")


def load_site():
    return json.load(open(SITE_PATH, encoding="utf-8"))


def _rect(cx, cy, w, d, pad=0.0):
    return [cx - w / 2 - pad, cy - d / 2 - pad, cx + w / 2 + pad, cy + d / 2 + pad]


def _rect_pts(r):
    x0, y0, x1, y1 = r
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def _bbox(pts, pad=0.0):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return [min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad]


def _dist_rect(x, y, r):
    """点到矩形的距离（在矩形内为负的到边距离）"""
    x0, y0, x1, y1 = r
    dx = max(x0 - x, 0, x - x1)
    dy = max(y0 - y, 0, y - y1)
    if dx == 0 and dy == 0:
        return -min(x - x0, x1 - x, y - y0, y1 - y)
    return math.hypot(dx, dy)


class Placer:
    """在集合里摆对象，自动记录数量；根节点用空物体，零件挂在下面（局部坐标）"""

    def __init__(self, col):
        self.col = col
        self.count = 0

    def root(self, name, loc=(0, 0, 0), rot_z=0.0):
        return lib.empty(name, self.col, loc, rot_z)

    def put(self, me, name, loc=(0, 0, 0), rot_z=0.0, parent=None):
        self.count += 1
        return lib.place(me, name, self.col, loc, rot_z, parent)


# ---------------------------------------------------------------- 地面


def _ground(S, M, P, pads, aprons):
    """农田、江面 + 护岸、远处的河、远山、园区草地、道路（地块外扩的沥青）、混凝土地块"""
    park = S["park"]
    north = S["backdrop"]["groundNorth"]
    bank = S["river"]["bankTop"]
    water = S["river"]["waterLine"]

    # 农田：园区外的大片地面，北边在远山后面截断（山顶以上的视线看到天空）
    mb = assets.MB()
    f = mb.plane((5500, north + 600), (250, (north - 600) / 2, -0.25), M["fields"])
    uv = mb.bm.loops.layers.uv.verify()
    for face in f:
        for l in face.loops:
            co = l.vert.co
            l[uv].uv = (co.x / 1400, co.y / 1400)
    P.put(mb.mesh("GROUND_fields"), "GROUND_fields")

    # 江面 + 护岸（岸顶 z = 0 到水边 z = -2.5）
    mb = assets.MB()
    mb.plane((5500, 3000), (250, -2100, -2.5), M["water"])
    P.put(mb.mesh("GROUND_river"), "GROUND_river")
    mb = assets.MB()
    bm = mb.bm
    k = mb.i(M["rock"])
    top = [(-2500, bank[0][1])] + [tuple(p) for p in bank] + [(3000, bank[-1][1])]
    bot = [(-2500, water[0][1])] + [tuple(p) for p in water] + [(3000, water[-1][1])]
    vt = [bm.verts.new((x, y, 0.0)) for x, y in top]
    vb = [bm.verts.new((x, y, -2.6)) for x, y in bot]
    for i in range(len(vt) - 1):
        bm.faces.new((vb[i], vb[i + 1], vt[i + 1], vt[i])).material_index = k
    P.put(mb.mesh("GROUND_bank"), "GROUND_bank")
    # 岸线到园区南边之间：滨江路 + 绿化带
    mb = assets.MB()
    ymid = (park["y0"] + max(p[1] for p in bank)) / 2
    mb.plane((5500, park["y0"] - ymid + 2), (250, (park["y0"] + ymid) / 2, -0.1), M["grass"])
    mb.plane((5500, 12), (250, ymid - 4, -0.08), M["asphalt"])
    P.put(mb.mesh("GROUND_riverside"), "GROUND_riverside")

    # 远处的河：两条岸线之间的水面（比农田略高，避免共面闪烁）
    rn, rs = S["backdrop"]["farRiver"]["north"], S["backdrop"]["farRiver"]["south"]
    mb = assets.MB()
    bm = mb.bm
    k = mb.i(M["far_water"])
    ext = lambda line: [(line[0][0] - 2500, line[0][1]), *[tuple(p) for p in line], (line[-1][0] + 2500, line[-1][1])]  # noqa: E731
    a = [bm.verts.new((x, y, -0.15)) for x, y in ext(rs)]
    b = [bm.verts.new((x, y, -0.15)) for x, y in ext(rn)]
    for i in range(len(a) - 1):
        bm.faces.new((a[i], a[i + 1], b[i + 1], b[i])).material_index = k
    P.put(mb.mesh("GROUND_farRiver"), "GROUND_farRiver")

    # 远山：沿反投影出的山脊线，前坡到山脊、后坡到北边界
    hills = S["backdrop"]["hills"]
    mb = assets.MB()
    bm = mb.bm
    k = mb.i(M["hill"])
    ridge = [(hills[0][0] - 2500, hills[0][1] - 280, hills[0][2] * 0.6)] + [tuple(h) for h in hills] + [(hills[-1][0] + 2500, hills[-1][1] + 280, hills[-1][2] * 0.8)]
    foot = [bm.verts.new((x, y - 60, -0.2)) for x, y, _ in ridge]
    crest = [bm.verts.new((x, y, z)) for x, y, z in ridge]
    # 后坡只留 30 m：后坡越往北，画面上的地平线越高（会挡住落日天空）
    back = [bm.verts.new((x, y + 30, z * 0.5)) for x, y, z in ridge]
    for i in range(len(ridge) - 1):
        bm.faces.new((foot[i], foot[i + 1], crest[i + 1], crest[i])).material_index = k
        bm.faces.new((crest[i], crest[i + 1], back[i + 1], back[i])).material_index = k
    P.put(mb.mesh("GROUND_hills"), "GROUND_hills")

    # 园区：草地打底 → 道路（各地块外扩 7 m 的沥青，连起来就是路网）→ 混凝土地块
    pr = [park["x0"], park["y0"], park["x1"], park["y1"]]
    # 园区草地用 M_lawn（偏绿、带深浅斑驳的贴图）：原先 M_grass 在页面的暖色夕阳下和沥青、地坪几乎同色（评审第 5 条），
    # M_grass 仍留给滨江绿带
    mb = assets.MB()
    mb.prism(_rect_pts([pr[0] - 6, pr[1] - 6, pr[2] + 6, pr[3] + 6]), -0.2, 0.0, M["lawn"])
    uvl = mb.bm.loops.layers.uv.verify()
    for face in mb.bm.faces:
        for l in face.loops:
            l[uvl].uv = (l.vert.co.x / 60, l.vert.co.y / 60)
    P.put(mb.mesh("GROUND_park"), "GROUND_park")
    mb = assets.MB()
    # 周界内侧环路（宽 10 m）
    x0, y0, x1, y1 = pr
    ring = [[x0 + 4, y0 + 4, x1 - 4, y0 + 14], [x0 + 4, y1 - 14, x1 - 4, y1 - 4], [x0 + 4, y0 + 4, x0 + 14, y1 - 4], [x1 - 14, y0 + 4, x1 - 4, y1 - 4]]
    for r in ring:
        mb.prism(_rect_pts(r), 0.0, 0.03, M["asphalt"])
    for r in aprons:
        mb.prism(_rect_pts(r), 0.0, 0.03 + random.random() * 0.004, M["asphalt"])
    uvl = mb.bm.loops.layers.uv.verify()
    for face in mb.bm.faces:
        for l in face.loops:
            l[uvl].uv = (l.vert.co.x / 16, l.vert.co.y / 16)
    P.put(mb.mesh("ROAD_asphalt"), "ROAD_asphalt")
    _curbs(M, P, pr, ring + aprons, pads)
    mb = assets.MB()
    for r in pads:
        mb.prism(_rect_pts(r), 0.0, 0.08, M["concrete"])
    uvl = mb.bm.loops.layers.uv.verify()
    for face in mb.bm.faces:
        for l in face.loops:
            l[uvl].uv = (l.vert.co.x / 16, l.vert.co.y / 16)
    P.put(mb.mesh("GROUND_pads"), "GROUND_pads")


def _curbs(M, P, pr, roads, pads):
    """
    路沿石：把园区按 1 m 栅格分成 草地 / 路面 / 地坪 三类（路面 = 环路 + 各地块外扩的沥青，地坪 = 混凝土地块），
    凡是"路面—草地""路面—地坪"相邻的格边就是路沿；同一行（列）上连续的格边合成一条长路沿（浅灰，宽 0.5 m，高出路面 9 cm），
    远看是一条条勾出道路轮廓的浅色细线（定稿里道路两边都有路沿）。
    """
    x0, y0, x1, y1 = pr[0] - 6, pr[1] - 6, pr[2] + 6, pr[3] + 6
    W, H = int(x1 - x0), int(y1 - y0)
    g = np.zeros((H, W), np.int8)  # 0 草地，1 路面，2 地坪

    def fill(r, v):
        a0, a1 = max(0, int(round(r[0] - x0))), min(W, int(round(r[2] - x0)))
        b0, b1 = max(0, int(round(r[1] - y0))), min(H, int(round(r[3] - y0)))
        g[b0:b1, a0:a1] = v

    for r in roads:
        fill(r, 1)
    for r in pads:
        fill(r, 2)
    mb = assets.MB()
    k = 0
    zc = 0.12

    def runs(mask):
        """一维布尔数组里连续为真的区段 [(起, 止)]"""
        out, start = [], None
        for i, v in enumerate(mask):
            if v and start is None:
                start = i
            elif not v and start is not None:
                out.append((start, i))
                start = None
        if start is not None:
            out.append((start, len(mask)))
        return out

    # 竖向格边（x = 常数）：第 i 列和第 i-1 列类别不同、且其中一边是路面
    edge_v = (g[:, 1:] != g[:, :-1]) & ((g[:, 1:] == 1) | (g[:, :-1] == 1))
    for i in range(edge_v.shape[1]):
        for a, b in runs(edge_v[:, i]):
            if b - a >= 3:
                mb.box((0.5, b - a, zc), (x0 + i + 1, y0 + (a + b) / 2, zc / 2), M["curb"])
                k += 1
    edge_h = (g[1:, :] != g[:-1, :]) & ((g[1:, :] == 1) | (g[:-1, :] == 1))
    for j in range(edge_h.shape[0]):
        for a, b in runs(edge_h[j, :]):
            if b - a >= 3:
                mb.box((b - a, 0.5, zc), (x0 + (a + b) / 2, y0 + j + 1, zc / 2), M["curb"])
                k += 1
    P.put(mb.mesh("ROAD_curbs"), "ROAD_curbs")
    return k


# ---------------------------------------------------------------- 储运片区


def _storage(S, M, P, pads):
    for t in S["tanks"]:
        key = f"tank_{t['roof']}_{round(t['d'])}_{round(t['h'])}"
        me = _CACHE.get(key)
        if me is None:
            fn = assets.tank_floating if t["roof"] == "floating" else assets.tank_fixed
            me = _CACHE[key] = fn(M, key, t["d"], t["h"])
        root = P.root(t["id"], (t["x"], t["y"], 0))
        P.put(me, t["id"] + "_shell", parent=root)
    for s in S["spheres"]:
        me = _CACHE.get("sphere") or _CACHE.setdefault("sphere", assets.sphere_tank(M, "sphere", s["d"], s["zc"]))
        root = P.root(s["id"], (s["x"], s["y"], 0))
        P.put(me, s["id"] + "_shell", parent=root)
    # 防火堤：罐组外的一圈矮墙 + 堤内混凝土地坪
    for gid, (cx, cy, w, d) in S["dikes"].items():
        pads.append(_rect(cx, cy, w, d, 1.0))
        mb = assets.MB()
        x0, y0, x1, y1 = _rect(cx, cy, w, d)
        for a, b in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
            mb.beam((a[0], a[1], 0.8), (b[0], b[1], 0.8), 1.6, M["concrete"])
        P.put(mb.mesh(f"DIKE_{gid}"), f"DIKE_{gid}")
    # 装卸站：长罩棚 + 棚下 8 辆槽车
    ld = next(b for b in S["buildings"] if b["id"] == "LD-1")
    root = P.root("LD-1", (ld["cx"], ld["cy"], 0))
    P.put(assets.canopy(M, "canopy_LD-1", ld["w"], ld["d"], ld["h"]), "LD-1_canopy", parent=root)
    truck = _truck(M)
    # 8 个鹤位停 6 辆槽车，车头朝南（朝镜头）。主机位俯角只有 17°，7 m 高的屋面会挡住檐口后约 23 m 内的地面，
    # 所以车停在檐口前、车尾留在棚下（定稿里也是在檐口下沿看到一排车头）；棚前场地上再停 2 辆排队的车
    for k in range(8):
        x = -ld["w"] / 2 + ld["w"] * (k + 0.5) / 8
        if k in (3, 6):
            continue  # 留两个空鹤位，和定稿一致（棚下不是满的）
        P.put(truck, f"LD-1_truck_{k + 1}", (x, -ld["d"] / 2 - 3.5, 0), -math.pi / 2, parent=root)
    for j, x in enumerate((-ld["w"] * 0.2, ld["w"] * 0.32)):
        P.put(truck, f"LD-1_truck_{9 + j}", (x, -ld["d"] / 2 - 18 - 2 * j, 0), -math.pi / 2 + 0.06 * (1 - 2 * j), parent=root)
    pads.append(_rect(*S["lots"]["LD-1_apron"]))
    pads.append(_rect(*S["lots"]["DK-01_pad"]))
    # 码头：栈桥平台（接管廊支线）+ 2 艘槽船
    b0, b1 = S["jetty"]["berth"]
    jx, jy = (b0[0] + b1[0]) / 2, (b0[1] + b1[1]) / 2
    root = P.root("JT-1", (jx, jy, 0))
    L = abs(b1[0] - b0[0]) + 30
    jw = S["jetty"]["w"]
    # 引桥：管廊支线最后一段，从岸顶（略往岸上伸一点）到平台北沿
    (ax, ay), (bx, by) = S["pipeRacks"][2]["pts"][-2:]
    bank_y = max(p[1] for p in S["river"]["bankTop"]) + 3

    def at_y(yy):
        t = (yy - ay) / (by - ay)
        return (ax + (bx - ax) * t - jx, yy - jy)

    approach = [at_y(bank_y), at_y(jy + jw / 2)]
    ships = [(s["x"] - jx, s["y"] - jy, s["len"], s["beam"]) for s in S["ships"]]
    P.put(assets.jetty(M, "jetty", L, jw, ships, approach), "JT-1_berth", parent=root)
    for s in S["ships"]:
        me = assets.ship(M, s["id"], s["len"], s["beam"])
        # SHIP-1 掉头（船首朝西）：两艘船的上层建筑都靠码头中间，和定稿一致
        P.put(me, s["id"], (s["x"], s["y"], -2.5), math.pi if s["id"] == "SHIP-1" else 0.0)


def _truck(M):
    if "truck" not in _CACHE:
        _CACHE["truck"] = assets.tanker_truck(M, "tanker_truck")
    return _CACHE["truck"]


# ---------------------------------------------------------------- 生产片区


def _poly_y(pts, x):
    """折线（点按 x 递增）在横坐标 x 处的 y；超出范围取端点"""
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0 or 1)
    return pts[0][1] if x < pts[0][0] else pts[-1][1]


def _free_spans(a, b, y0, y1, blocks):
    """x 区间 [a, b] 扣掉与 y 区间 [y0, y1] 相交的阻挡矩形后剩下的空段"""
    spans = [(a, b)]
    for bx0, by0, bx1, by1 in blocks:
        if by1 <= y0 or by0 >= y1:
            continue
        nxt = []
        for s0, s1 in spans:
            if bx1 <= s0 or bx0 >= s1:
                nxt.append((s0, s1))
                continue
            if bx0 > s0:
                nxt.append((s0, bx0))
            if bx1 < s1:
                nxt.append((bx1, s1))
        spans = nxt
    return spans


def _units(S, M, P, pads):
    """
    三套装置：塔器位置来自 site.json；其余按"占位"铺满地块（定稿里装置区是密密麻麻的钢结构）：
    先预留主管廊 PR-1 穿过的走廊、装置内管廊主干（沿进深，放在离塔器最远的位置）和塔器周围 3 m，
    再沿进深一排排铺钢结构框架（排间留 6–10 m 检修道），放不下框架的空档放立式容器 / 换热器，
    框架和主干管廊之间用几根水平管连起来。U-1 南端一排裂解炉 + 机柜间，U-3 北侧一栋大厂房（定稿里的灰色大屋面）。
    """
    main = S["pipeRacks"][0]["pts"]
    for ui, u in enumerate(S["units"]):
        uid = u["id"]
        cx, cy, w, d = u["block"]
        pads.append(_rect(cx, cy, w, d))
        root = P.root(uid, (cx, cy, 0))
        rnd = random.Random(100 + ui)
        cols = [(c["x"] - cx, c["y"] - cy, c["r"]) for c in u["columns"]]
        for ci, c in enumerate(u["columns"]):
            me = assets.column(M, f"col_{uid}_{ci}", c["r"], c["h"], seed=ui * 10 + ci)
            P.put(me, f"{uid}_col_{ci + 1}", (c["x"] - cx, c["y"] - cy, 0), parent=root)
        yr = _poly_y(main, cx) - cy  # 主管廊在本装置里的局部 y
        cands = range(int(-w / 2 + 10), int(w / 2 - 9), 2)
        spine = max(cands, key=lambda x: min(abs(x - c[0]) - c[2] for c in cols))
        blocks = [(-w / 2, yr - 7, w / 2, yr + 7), (spine - 4.5, -d / 2, spine + 4.5, d / 2)]
        blocks += [(x - r - 3, y - r - 3, x + r + 3, y + r + 3) for x, y, r in cols]
        spine_y0, spine_y1 = -d / 2 + 4, d / 2 - 4
        misc = assets.MB()  # 本装置的零碎件（框架 → 主干管廊的连接管）合成一个网格
        if uid == "U-1":
            # 南端：主干西侧一排 4 台裂解炉，东侧一栋机柜间
            fy, fd_ = -d / 2 + 11, 12
            fx0, fx1 = -w / 2 + 4, spine - 6
            nf = 4
            fw = (fx1 - fx0 - (nf - 1) * 3) / nf
            for j in range(nf):
                P.put(assets.furnace(M, f"furnace_{j}", fw, fd_, 22), f"U-1_furnace_{j + 1}", (fx0 + fw / 2 + j * (fw + 3), fy, 0), parent=root)
            bx0 = spine + 5
            if w / 2 - 3 - bx0 > 6:
                P.put(assets.small_building(M, "U-1_house", w / 2 - 3 - bx0, 16, 7, seed=1), "U-1_house", ((bx0 + w / 2 - 3) / 2, -d / 2 + 12, 0), parent=root)
            blocks.append((-w / 2, -d / 2, w / 2, fy + fd_ / 2 + 5))
        if uid == "U-3":
            hx0, hx1, hy0, hy1 = -w / 2 + 3, 2.0, 40.0, 105.0
            P.put(assets.hall(M, "U-3_hall", hx1 - hx0, hy1 - hy0, 14, seed=3), "U-3_hall", ((hx0 + hx1) / 2, (hy0 + hy1) / 2, 0), parent=root)
            blocks.append((hx0 - 2, hy0 - 4, hx1 + 2, hy1 + 2))
            if hx0 - 2 < spine < hx1 + 2:
                spine_y1 = hy0 - 6
        # 沿进深一排排铺框架
        y = -d / 2 + 4
        k = 0
        nd = 0
        while y < d / 2 - 12:
            fd = rnd.uniform(12, 20)
            y1 = min(y + fd, d / 2 - 4)
            if y1 - y < 8:
                break
            for a, b in ((-w / 2 + 3, spine - 4.5), (spine + 4.5, w / 2 - 3)):
                for s0, s1 in _free_spans(a, b, y - 1, y1 + 1, blocks):
                    L = s1 - s0
                    if L < 10:
                        if L > 6:
                            nd += 1
                            r = min(2.2, L / 2 - 1.5)
                            P.put(assets.drum(M, f"drum_{uid}_{nd}", r, rnd.uniform(8, 18), seed=nd), f"{uid}_drum_{nd}", ((s0 + s1) / 2, (y + y1) / 2, 0), parent=root)
                        continue
                    if rnd.random() > 0.68:
                        # 设备场地：一两台立式容器 + 一台换热器
                        for q in range(rnd.randint(1, 2)):
                            nd += 1
                            r = rnd.uniform(1.5, 2.6)
                            P.put(assets.drum(M, f"drum_{uid}_{nd}", r, rnd.uniform(10, 22), seed=nd), f"{uid}_drum_{nd}", (s0 + r + 2 + q * (2 * r + 4), y + r + 2, 0), parent=root)
                        P.put(assets.exchanger(M, f"hx_{uid}_{k}", min(L - 4, 12), rnd.uniform(1.0, 1.5)), f"{uid}_hx_{k + 1}", ((s0 + s1) / 2, y1 - 3, 0), parent=root)
                        k += 1
                        continue
                    n = max(1, math.ceil(L / 40))
                    seg_w = (L - (n - 1) * 4) / n
                    for q in range(n):
                        fx0 = s0 + q * (seg_w + 4)
                        fw = seg_w - 3.2  # 东端外挂楼梯占 3 m
                        if fw < 7:
                            continue
                        # 塔器旁边的框架高一些（定稿里塔器周围是最高的设备楼），其余高低错落
                        near_col = min(math.hypot(fx0 + fw / 2 - x, (y + y1) / 2 - yy) for x, yy, _ in cols)
                        fh = rnd.uniform(24, 36) if near_col < 25 else rnd.uniform(12, 28)
                        fcx, fcy = fx0 + fw / 2, (y + y1) / 2
                        P.put(assets.frame(M, f"frame_{uid}_{k}", fw, y1 - y, fh, seed=ui * 100 + k), f"{uid}_frame_{k + 1}", (fcx, fcy, 0), parent=root)
                        k += 1
                        # 框架 → 主干管廊的连接管（框架靠主干的一侧，标高 7–8 m 进管廊上层）
                        start = fx0 + fw - 1.0 if fcx < spine else fx0 + 1.0
                        edge = spine - 2.5 if fcx < spine else spine + 2.5
                        if spine_y0 < fcy < spine_y1:
                            for j in range(rnd.randint(2, 4)):
                                yy = fcy - (y1 - y) * 0.3 + j * 1.1
                                zz = 7.4 + 0.5 * (j % 2)
                                misc.tube([(start, yy, zz), (edge, yy, zz)], rnd.choice((0.25, 0.35, 0.45)), M["steel"], seg=6)
            y = y1 + rnd.uniform(7, 12)
        # 装置内管廊主干（沿进深），在主管廊走廊处断开（两层管廊在那里上下交叉）
        for si, (ya, yb) in enumerate(((spine_y0, yr - 7), (yr + 7, spine_y1))):
            if yb - ya < 12:
                continue
            me = assets.pipe_rack_segment(M, f"rack_in_{uid}_{si}", yb - ya, 5, 7, seed=ui * 3 + si)
            P.put(me, f"{uid}_rack_{si + 1}", (spine, (ya + yb) / 2, 0), math.pi / 2, parent=root)
        if misc.mats:
            P.put(misc.mesh(f"{uid}_pipes"), f"{uid}_pipes", parent=root)
    # 装置区控制楼（屋顶放 2# 机场）
    c = next(b for b in S["buildings"] if b["id"] == "CTRL-2")
    pads.append(_rect(c["cx"], c["cy"], c["w"], c["d"], 4))
    P.put(assets.control_building(M, "ctrl_bld", c["w"], c["d"], c["h"]), "CTRL-2", (c["cx"], c["cy"], 0))


def _racks(S, M, P):
    """园区公共主管廊 PR-1：主干 + 南支 + 码头支线，按折线分段"""
    root = P.root("PR-1", (0, 0, 0))
    for r in S["pipeRacks"]:
        for i, (a, b) in enumerate(zip(r["pts"], r["pts"][1:])):
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            if L < 2:
                continue
            me = assets.pipe_rack_segment(M, f"{r['id']}_{i}", L, r["w"], r["z"], seed=i)
            ang = math.atan2(b[1] - a[1], b[0] - a[0])
            P.put(me, f"{r['id']}_seg_{i + 1}", ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0), ang, parent=root)


# ---------------------------------------------------------------- 公用工程


def _utilities(S, M, P, pads):
    cw = S["coolingTowers"]
    root = P.root("CW-1", (sum(c["x"] for c in cw) / 4, sum(c["y"] for c in cw) / 4, 0))
    me = assets.cooling_tower(M, "cooling_tower", cw[0]["dBase"], cw[0]["dTop"], cw[0]["h"])
    for i, c in enumerate(cw):
        P.put(me, f"CW-1_tower_{i + 1}", (c["x"] - root.location.x, c["y"] - root.location.y, 0), parent=root)
    # 循环水泵房 + 冷却塔南侧的供回水总管（两根粗管沿塔排、拐进泵房）
    mb = assets.MB()
    xs = [c["x"] - root.location.x for c in cw]
    ys = [c["y"] - root.location.y for c in cw]
    yh = min(ys) - cw[0]["dBase"] / 2 - 5.0
    for j, zz in enumerate((1.6, 3.2)):
        mb.tube([(min(xs) - 6, yh - j * 1.6, zz), (max(xs) + 6, yh - j * 1.6, zz)], 0.7, M["steel"], seg=8)
        for x in xs:
            mb.tube([(x, yh - j * 1.6, zz), (x, yh + 4.5, zz)], 0.5, M["steel"], seg=6)
    for x in [min(xs) - 6 + k * 6 for k in range(int((max(xs) - min(xs) + 12) / 6) + 1)]:
        mb.box((0.5, 4.0, 0.6), (x, yh - 0.8, 0.8), M["concrete"])
    mb.box((20, 10, 7), (min(xs) - 18, yh - 2, 3.5), M["wall"])
    mb.box((20.4, 10.4, 0.4), (min(xs) - 18, yh - 2, 7.2), M["roof"])
    for i in range(4):
        mb.box((1.6, 0.12, 1.1), (min(xs) - 26 + i * 5, yh - 7.05, 4.8), M["window"])
    P.put(mb.mesh("CW-1_pumps"), "CW-1_pumps", parent=root)
    pads.append(_bbox([(c["x"], c["y"]) for c in cw], 18))
    cb = S["coldBoxes"]
    root = P.root("AS-1", (sum(c["x"] for c in cb) / 2, sum(c["y"] for c in cb) / 2, 0))
    for i, c in enumerate(cb):
        P.put(assets.cold_box(M, f"coldbox_{i}", c["w"], c["h"], seed=i), f"AS-1_coldbox_{i + 1}", (c["x"] - root.location.x, c["y"] - root.location.y, 0), parent=root)
    # 空压机房（窗一排亮着）+ 两台卧式分子筛吸附器 + 冷箱到吸附器之间的一段小管廊（定稿里冷箱周围是成片的设备和管道）
    P.put(assets.small_building(M, "AS-1_compressor", 26, 12, 9, seed=7), "AS-1_compressor", (-2, 24, 0), parent=root)
    for j in range(2):
        P.put(assets.exchanger(M, f"AS-1_adsorber_{j}", 12, 1.8), f"AS-1_adsorber_{j + 1}", (-4, -22 - j * 6, 0), parent=root)
    P.put(assets.pipe_rack_segment(M, "AS-1_rack", 44, 4, 6, seed=5), "AS-1_rack", (2, 12, 0), parent=root)
    lox = assets.tank_fixed(M, "lox_tank", 8, 14)
    for i in range(3):
        P.put(lox, f"AS-1_tank_{i + 1}", (18 + i * 10, -12, 0), parent=root)
    pads.append(_bbox([(c["x"], c["y"]) for c in cb] + [(root.location.x + 40, root.location.y - 20)], 16))
    ww = S["basins"]
    root = P.root("WW-1", (sum(c["x"] for c in ww) / 3, sum(c["y"] for c in ww) / 3, 0))
    for i, c in enumerate(ww):
        P.put(assets.basin(M, f"basin_{i}", c["d"]), f"WW-1_basin_{i + 1}", (c["x"] - root.location.x, c["y"] - root.location.y, 0), parent=root)
    pads.append(_bbox([(c["x"], c["y"]) for c in ww], 26))
    ss = S["lots"]["SS-1"]
    root = P.root("SS-1", (ss[0], ss[1], 0))
    P.put(assets.substation(M, "substation", ss[2] * 0.85, ss[3] * 0.8), "SS-1_yard", parent=root)
    pads.append(_rect(*ss))
    hw = S["hazWaste"]
    root = P.root("HW-1", (hw["cx"], hw["cy"], 0))
    P.put(assets.hazwaste(M, "hazwaste", hw["w"], hw["d"], hw["h"]), "HW-1_building", parent=root)
    pads.append(_rect(hw["cx"], hw["cy"], hw["w"], hw["d"], 6))
    f = S["flare"]
    root = P.root("FL-1", (f["x"], f["y"], 0))
    P.put(assets.flare(M, "flare", f["h"]), "FL-1_stack", parent=root)
    P.put(assets.flare_base(M, "flare_base"), "FL-1_base", parent=root)
    _powerline(S, M, P)
    pads.append(_rect(f["x"], f["y"], 26, 26))


def _powerline(S, M, P):
    """
    高压进线（定稿里变电站以东、沿园区东侧道路有一排输电铁塔）：从总变电站东侧出园区，
    沿外环路东侧向北一排铁塔，导线三相各一根、按悬链下垂。铁塔关联复制（GPU 实例）。
    """
    ss = S["lots"]["SS-1"]
    p = S["park"]
    xt = p["x1"] + 34.0
    ys = [ss[1] - 40 + k * 150 for k in range(8)]
    me = assets.pylon(M, "pylon")
    col = lib.collection("POWERLINE", P.col)
    root = lib.empty("POWERLINE", col)
    for k, y in enumerate(ys):
        lib.place(me, f"PYLON_{k + 1}", col, (xt, y, 0), 0.0, root)
    mb = assets.MB()
    h = 38.0
    for zz, wd in ((h * 0.62, 9.0), (h * 0.74, 11.0), (h * 0.86, 8.0)):
        for sx in (-wd + 0.5, wd - 0.5):
            for a, b in zip(ys, ys[1:]):
                mb.tube(lib.sag((xt + sx, a, zz - 1.5), (xt + sx, b, zz - 1.5), 4.0, n=8), 0.08, M["steel_dark"], seg=4)
    P.put(mb.mesh("POWERLINE_wires"), "POWERLINE_wires")


# ---------------------------------------------------------------- 物流与管理片区


def _north(S, M, P, pads):
    B = {b["id"]: b for b in S["buildings"]}
    c = B["CC-1"]
    root = P.root("CC-1", (c["cx"], c["cy"], 0))
    P.put(assets.office(M, "office_CC-1", c["w"], c["d"], c["h"]), "CC-1_building", parent=root)
    pads.append(_rect(c["cx"], c["cy"], c["w"], c["d"], 8))
    f = B["FS-1"]
    root = P.root("FS-1", (f["cx"], f["cy"], 0))
    P.put(assets.fire_station(M, "firestation", f["w"], f["d"], f["h"]), "FS-1_building", parent=root)
    t = S["fireTower"]
    P.put(assets.fire_tower(M, "firetower", t["w"], t["h"]), "FS-1_tower", (t["x"] - f["cx"], t["y"] - f["cy"], 0), parent=root)
    pads.append(_rect(f["cx"], f["cy"] - 6, f["w"] + 10, f["d"] + 22))
    w = B["WH-1"]
    root = P.root("WH-1", (w["cx"], w["cy"], 0))
    P.put(assets.warehouse(M, "warehouse", w["w"], w["d"], w["h"]), "WH-1_building", parent=root)
    pads.append(_rect(w["cx"], w["cy"], w["w"], w["d"], 8))
    # 危化品车辆专用停车场：按类别分区，几排槽车
    pk = S["lots"]["PK-1"]
    root = P.root("PK-1", (pk[0], pk[1], 0))
    pads.append(_rect(*pk))
    truck = _truck(M)
    rnd = random.Random(9)
    rows = max(2, int(pk[3] / 16))
    cols = max(2, int(pk[2] / 5))
    n = 0
    for i in range(rows):
        for j in range(cols):
            if rnd.random() < 0.18:
                continue
            x = -pk[2] / 2 + (j + 0.5) * pk[2] / cols
            y = -pk[3] / 2 + (i + 0.5) * pk[3] / rows
            n += 1
            P.put(truck, f"PK-1_truck_{n}", (x, y, 0), math.pi / 2, parent=root)


def _perimeter(S, M, P):
    """周界围网四段（PM-N / E / S / W）+ 4 个卡口（岗亭 + 道闸）"""
    p = S["park"]
    x0, y0, x1, y1 = p["x0"], p["y0"], p["x1"], p["y1"]
    for pid, a, b in (("PM-N", (x0, y1), (x1, y1)), ("PM-E", (x1, y1), (x1, y0)), ("PM-S", (x1, y0), (x0, y0)), ("PM-W", (x0, y0), (x0, y1))):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        root = P.root(pid, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0), math.atan2(b[1] - a[1], b[0] - a[0]))
        P.put(assets.fence_segment(M, f"fence_{pid}", L), f"{pid}_fence", parent=root)
    for gid, (gx, gy) in S["gates"].items():
        root = P.root(gid, (gx, gy, 0))
        mb = assets.MB()
        mb.box((6, 4, 3.5), (8, -6, 1.75), M["wall"])
        mb.box((6.4, 4.4, 0.4), (8, -6, 3.7), M["roof"])
        mb.box((7, 0.25, 0.25), (-2, 0, 1.1), M["red"])
        mb.box((0.5, 0.5, 0.3), (8, -8.3, 3.2), M["lamp"])
        P.put(mb.mesh(f"gate_{gid}"), f"{gid}_house", parent=root)


# ---------------------------------------------------------------- 机场


def _docks(S, M, P):
    parts = assets.dock_parts(M, "dock")
    for did, d in S["docks"].items():
        root = P.root(did, (d["x"], d["y"], d["z"] + (0.05 if d["z"] == 0 else 0.6)))
        P.put(parts["body"], f"{did}_body", parent=root)
        P.put(parts["lid_L"], f"{did}_lid_L", (-0.39, 0, 0.56), parent=root)
        P.put(parts["lid_R"], f"{did}_lid_R", (0.39, 0, 0.56), parent=root)
        if d["z"] == 0:
            mb = assets.MB()
            mb.box((6, 6, 0.2), (0, 0, -0.1), M["dock_pad"])
            mb.box((6.2, 0.15, 0.15), (0, 3.0, 0.08), M["pipe_yellow"])
            mb.box((6.2, 0.15, 0.15), (0, -3.0, 0.08), M["pipe_yellow"])
            P.put(mb.mesh(f"dockpad_{did}"), f"{did}_pad", parent=root)


def _fleet(M, col):
    """无人机预制件（FLEET 集合，导出 fleet.glb）：UAV 根节点 + 机身 + 4 个桨（prop_1..4，原点在桨轴）"""
    P = Placer(col)
    parts = assets.drone_parts(M, "drone")
    root = P.root("UAV", (0, 0, 0))
    P.put(parts["body"], "UAV_body", parent=root)
    for i, (x, y) in enumerate(parts["arms"]):
        P.put(parts["prop"], f"UAV_prop_{i + 1}", (x, y, 0.29), i * 0.7, parent=root)
    return P.count


# ---------------------------------------------------------------- 绿化 / 路灯


def _place_tree(protos, kind, name, col, root, loc, rnd, s0=0.75, s1=1.3):
    """摆一棵树：共享网格（导出成 GPU 实例），随机朝向、随机等比缩放（实例的 SCALE 属性），高度再单独抖一点"""
    ob = lib.place(protos[kind], name, col, loc, rnd.random() * 6.28, root)
    s = rnd.uniform(s0, s1)
    ob.scale = (s, s, s * rnd.uniform(0.9, 1.12))
    return ob


# 树种的成团分布：同一片里以一两种为主（值噪声挑种类），不再三种树随机等距排开
_PARK_KINDS = ("round", "big", "round", "dark", "light", "conifer", "round", "big", "shrub")
_ROAD_KINDS = ("poplar", "round", "poplar", "light", "big")


def _greenery(S, M, P, aprons, pads):
    """
    园区内的树：道路两侧 2–10 m 的绿化带按"林团"成片种（值噪声决定疏密和树种），地块之间的大草坪零星几丛，
    周界内侧一条 10 m 宽的防护林带；树种 7 种、逐棵随机缩放，高矮不一。路灯沿园内道路边每 ~35 m 一盏。
    园区外的农田、林带、道路、村落见 _countryside。
    """
    rnd = random.Random(3)
    p = S["park"]
    protos = assets.trees(M)
    tcol = lib.collection("TREES", P.col)
    lcol = lib.collection("LAMPS", P.col)
    # 同一父节点下共享网格的副本，glTF 导出时才会合并成 GPU 实例（场景根上的不会），
    # 所以树和路灯各挂一个父节点：几千棵树 → 7 个实例网格，而不是几千个 draw call
    troot = lib.empty("TREES", tcol)
    lroot = lib.empty("LAMPS", lcol)
    n = 0
    blocked = aprons + pads
    step = 8
    y = p["y0"] + 4
    while y < p["y1"] - 4:
        x = p["x0"] + 4
        while x < p["x1"] - 4:
            px, py = x + rnd.uniform(-2.5, 2.5), y + rnd.uniform(-2.5, 2.5)
            dmin = min(_dist_rect(px, py, r) for r in blocked)
            edge = min(px - p["x0"], p["x1"] - px, py - p["y0"], p["y1"] - py)
            grove = assets._vnoise(px / 45.0, py / 45.0, 11)
            if dmin <= 2.0:
                prob = 0.0
            elif dmin < 10.0:
                prob = 0.35 + 0.6 * grove  # 路边绿化带：成团、有疏有密
            elif 14 < edge < 24:
                prob = 0.85  # 周界防护林带
            else:
                prob = 0.3 * grove * grove  # 大草坪：零星几丛
            if rnd.random() < prob:
                n += 1
                kind = _PARK_KINDS[int(assets._vnoise(px / 30.0, py / 30.0, 5) * len(_PARK_KINDS)) % len(_PARK_KINDS)]
                if rnd.random() < 0.25:
                    kind = rnd.choice(_PARK_KINDS)
                _place_tree(protos, kind, f"TREE_{n}", tcol, troot, (px, py, 0), rnd)
            x += step
        y += step
    # 路灯：每块路面外缘每 ~35 m 一盏
    lm = assets.lamp(M, "lamp")
    nl = 0
    placed = []
    for r in aprons:
        x0, y0, x1, y1 = r
        # 四条边都装（原先只装东西向的边，南北向道路两边是黑的）；离已有路灯 15 m 内的跳过（相邻地块的路面重叠）
        for (ax, ay), (bx, by), rot in (((x0, y0), (x1, y0), math.pi / 2), ((x1, y1), (x0, y1), -math.pi / 2), ((x0, y1), (x0, y0), 0.0), ((x1, y0), (x1, y1), math.pi)):
            L = math.hypot(bx - ax, by - ay)
            nk = max(1, int(L / 35))
            for k in range(nk + 1):
                px, py = ax + (bx - ax) * k / nk, ay + (by - ay) * k / nk
                if not (p["x0"] + 3 < px < p["x1"] - 3 and p["y0"] + 3 < py < p["y1"] - 3):
                    continue
                if any(abs(px - qx) < 15 and abs(py - qy) < 15 for qx, qy in placed):
                    continue
                if any(_dist_rect(px, py, q) < -0.5 for q in pads):
                    continue  # 落在别的地块里
                placed.append((px, py))
                nl += 1
                lib.place(lm, f"LAMP_{nl}", lcol, (px, py, 0), rot, lroot)
    nt, nl2 = _countryside(S, M, P, protos, tcol, troot, lm, lcol, lroot, n, nl)
    return nt, nl2


def _far_river_span(S, x):
    """远处的河在横坐标 x 处的南北岸 y（两条岸线按 x 线性插值；超出岸线范围时外推）"""

    def at(line):
        pts = sorted(line)
        if x <= pts[0][0]:
            (x0, y0), (x1, y1) = pts[0], pts[1]
        elif x >= pts[-1][0]:
            (x0, y0), (x1, y1) = pts[-2], pts[-1]
        else:
            i = next(i for i in range(len(pts) - 1) if pts[i][0] <= x <= pts[i + 1][0])
            (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        return y0 + (y1 - y0) * (x - x0) / (x1 - x0 or 1)

    fr = S["backdrop"]["farRiver"]
    return at(fr["south"]), at(fr["north"])


# 园区外能进画面的范围（场地坐标，主机位视野反算：左缘 x≈-130～-520、右缘 x≈550～820，远到 y≈1300）
_OUT_X0, _OUT_X1, _OUT_Y1 = -620.0, 1000.0, 1250.0
_ROAD_OFF = 13.0  # 园区外环路中线离围栏的距离
_FIELD_Z, _ROAD_Z = -0.21, -0.16  # 农田地块 / 园区外道路的高度（农田底图在 -0.25，层间留 ≥ 4 cm）
_CELL = 6.0  # 林冠高度场的格子边长


def _countryside(S, M, P, protos, tcol, troot, lm, lcol, lroot, n, nl):
    """
    园区外（定稿里四周满是农田、林带、道路，一直铺到画面边缘；原先只有一片暗褐色和几排孤树）：
      - 道路：园区外环路（西、北、东三面，9 m，园区一侧每 35 m 一盏路灯，外侧一排行道树）、
        从三个卡口伸出去的乡道（7 m，两旁钻天杨，过远河的地方架一座桥）、一条和北围栏平行的机耕路；
      - 农田：按道路分块后切成 40–140 m 的长条地块（一个材质 M_crops，按地块取不同作物色），地块间留 3 m 田埂；
      - 林冠：部分地块整块是林地，部分田埂上是林带，远河两岸是密林，河北岸到远山之间零散几片林子——
        全部合成一个"林冠高度场"网格（M_forest），比一棵棵摆树省面得多；园区西侧那片定稿里的密林单独加一块；
      - 村落：6 个小村，每村 8–18 栋坡顶民房（关联复制）+ 房前屋后的树。
    返回 (树总数, 路灯总数)。
    """
    rnd = random.Random(21)
    p = S["park"]
    x0, x1, y0, y1 = p["x0"], p["x1"], p["y0"], p["y1"]
    gates = S["gates"]
    xw, xe, yn = x0 - _ROAD_OFF, x1 + _ROAD_OFF, y1 + _ROAD_OFF
    ys_road = y0 - 23  # 外环路东西两段向南接到滨江路
    river_y = lambda x: _far_river_span(S, x)  # noqa: E731

    # ---------------- 道路（矩形段：(x0, y0, x1, y1, 宽) 的中线段，水平或竖直）
    roads = [
        ("ring_W", (xw, ys_road), (xw, yn), 9.0),
        ("ring_N", (xw, yn), (xe, yn), 9.0),
        ("ring_E", (xe, ys_road), (xe, yn), 9.0),
        ("lane_W", (_OUT_X0, gates["G-4"][1]), (xw, gates["G-4"][1]), 7.0),
        ("lane_E", (xe, gates["G-3"][1]), (_OUT_X1, gates["G-3"][1]), 7.0),
        ("lane_N", (gates["G-1"][0], yn), (gates["G-1"][0], _OUT_Y1), 7.0),
    ]
    # 机耕路：和北围栏平行，西端到画面外，东端停在远河南岸前
    y_farm = 430.0
    xr = next(x for x in range(-600, 1000, 5) if river_y(x)[0] < y_farm + 25)
    roads.append(("farm_N", (_OUT_X0, y_farm), (xr - 10.0, y_farm), 5.0))
    road_rects = []
    mb = assets.MB()
    for _, (ax, ay), (bx, by), w in roads:
        r = [min(ax, bx) - w / 2, min(ay, by) - w / 2, max(ax, bx) + w / 2, max(ay, by) + w / 2]
        road_rects.append(r)
        mb.prism(_rect_pts(r), _ROAD_Z - 0.3, _ROAD_Z, M["asphalt"])
    # 卡口到外环路的连接段
    for gid, (gx, gy) in gates.items():
        if abs(gy - y1) < 1:
            r = [gx - 4.5, y1, gx + 4.5, yn]
        elif abs(gx - x1) < 1:
            r = [x1, gy - 4.5, xe, gy + 4.5]
        else:
            r = [xw, gy - 4.5, x0, gy + 4.5]
        mb.prism(_rect_pts(r), _ROAD_Z - 0.3, _ROAD_Z, M["asphalt"])
    uvl = mb.bm.loops.layers.uv.verify()
    for face in mb.bm.faces:
        for l in face.loops:
            l[uvl].uv = (l.vert.co.x / 16, l.vert.co.y / 16)
    P.put(mb.mesh("GROUND_roads_out"), "GROUND_roads_out")
    # 乡道过远河的桥（桥面 + 栏杆，河面在 -0.15）
    gx = gates["G-1"][0]
    rs, rn = river_y(gx)
    mb = assets.MB()
    mb.box((9, rn - rs + 30, 0.8), (gx, (rs + rn) / 2, 0.9), M["concrete"])
    for sx in (-4.3, 4.3):
        mb.box((0.25, rn - rs + 30, 1.0), (gx + sx, (rs + rn) / 2, 1.8), M["concrete"])
    for k in range(4):
        mb.box((7, 1.6, 2.0), (gx, rs - 5 + (rn - rs + 10) * k / 3, -0.2), M["concrete"])
    P.put(mb.mesh("BRIDGE_N"), "BRIDGE_N")

    # 路灯：外环路靠园区一侧每 35 m；乡道出卡口的 200 m 内每 35 m
    def lamp_line(ax, ay, bx, by, side, step=35.0, upto=None):
        nonlocal nl
        L = math.hypot(bx - ax, by - ay)
        if upto:
            L = min(L, upto)
        ux, uy = (bx - ax) / math.hypot(bx - ax, by - ay), (by - ay) / math.hypot(bx - ax, by - ay)
        nx_, ny_ = -uy * side, ux * side
        for k in range(int(L / step) + 1):
            d = k * step
            px, py = ax + ux * d + nx_, ay + uy * d + ny_
            nl += 1
            lib.place(lm, f"LAMP_{nl}", lcol, (px, py, 0), math.atan2(-ny_, -nx_), lroot)

    lamp_line(xw, ys_road, xw, yn, -5.5)  # 西段：灯在路东侧（园区一侧）
    lamp_line(xw, yn, xe, yn, -5.5)  # 北段：灯在路南侧
    lamp_line(xe, ys_road, xe, yn, 5.5)  # 东段：灯在路西侧
    lamp_line(xw, gates["G-4"][1], _OUT_X0, gates["G-4"][1], 4.5, upto=220)
    lamp_line(xe, gates["G-3"][1], _OUT_X1, gates["G-3"][1], -4.5, upto=220)
    lamp_line(gx, yn, gx, _OUT_Y1, 4.5, upto=240)

    # 行道树：外环路外侧一排（每 10 m）、乡道两旁钻天杨（每 12 m）
    def tree_line(ax, ay, bx, by, off, step, kinds):
        nonlocal n
        L = math.hypot(bx - ax, by - ay)
        ux, uy = (bx - ax) / L, (by - ay) / L
        for k in range(int(L / step)):
            if rnd.random() < 0.12:
                continue
            d = k * step + rnd.uniform(-1.5, 1.5)
            px, py = ax + ux * d - uy * off, ay + uy * d + ux * off
            if py > river_y(px)[0] - 8 and py < river_y(px)[1] + 8:
                continue  # 不种到远河上
            n += 1
            _place_tree(protos, rnd.choice(kinds), f"TREE_{n}", tcol, troot, (px, py, 0), rnd)

    tree_line(xw, ys_road, xw, yn, 8.0, 10, _ROAD_KINDS)
    tree_line(xw - 8, yn, xe + 8, yn, 8.0, 10, _ROAD_KINDS)
    tree_line(xe, yn, xe, ys_road, 8.0, 10, _ROAD_KINDS)
    for _, (ax, ay), (bx, by), w in roads[3:]:
        for off in (w / 2 + 3.5, -(w / 2 + 3.5)):
            tree_line(ax, ay, bx, by, off, 12, ("poplar", "poplar", "round"))

    # ---------------- 村落（先占地，农田避开）
    villages = [(-300, 80), (-430, 520), (40, 360), (300, 360), (650, -120), (780, 440), (180, 660), (560, 540)]
    hp = assets.houses(M)
    vcol = lib.collection("VILLAGE", P.col)
    vroot = lib.empty("VILLAGE", vcol)
    vrects = []
    nh = 0
    for vi, (vx, vy) in enumerate(villages):
        if river_y(vx)[0] - 40 < vy < river_y(vx)[1] + 40:
            continue
        cnt = rnd.randint(8, 18)
        rot = rnd.choice((0.0, math.pi / 2)) + rnd.uniform(-0.15, 0.15)
        for k in range(cnt):
            hx = vx + (k % 5 - 2) * rnd.uniform(16, 22) + rnd.uniform(-3, 3)
            hy = vy + (k // 5 - 1.5) * rnd.uniform(18, 24) + rnd.uniform(-3, 3)
            nh += 1
            kind = rnd.choice(("two", "two", "one", "one", "flat"))
            lib.place(hp[kind], f"HOUSE_{nh}", vcol, (hx, hy, 0), rot + rnd.choice((0, math.pi)), vroot)
            if rnd.random() < 0.8:
                n += 1
                _place_tree(protos, rnd.choice(("round", "big", "light", "dark")), f"TREE_{n}", tcol, troot, (hx + rnd.uniform(-9, 9), hy + rnd.uniform(6, 11), 0), rnd)
        vrects.append([vx - 60, vy - 50, vx + 60, vy + 50])

    # ---------------- 农田地块 + 林地 / 林带（林冠格子）
    forest = {}  # (i, j) → 种类（wood / hedge / river）

    def add_rect_cells(rx0, ry0, rx1, ry1, kind, ragged=0.0, seed=0):
        for i in range(math.floor(rx0 / _CELL), math.ceil(rx1 / _CELL)):
            for j in range(math.floor(ry0 / _CELL), math.ceil(ry1 / _CELL)):
                cx, cy = (i + 0.5) * _CELL, (j + 0.5) * _CELL
                if ragged:
                    # 林缘参差：离矩形边越近越容易缺格
                    e = min(cx - rx0, rx1 - cx, cy - ry0, ry1 - cy)
                    if e < ragged and assets._vnoise(cx / 15.0, cy / 15.0, seed) > e / ragged:
                        continue
                forest[(i, j)] = kind

    park_pad = [x0 - 30, y0 - 30, x1 + 30, y1 + 30]
    blocks = [park_pad] + [[r[0] - 2, r[1] - 2, r[2] + 2, r[3] + 2] for r in road_rects] + vrects

    def free(r):
        if any(not (r[2] <= b[0] or r[0] >= b[2] or r[3] <= b[1] or r[1] >= b[3]) for b in blocks):
            return False
        for xx in (r[0], r[2]):
            rs_, rn_ = river_y(xx)
            if r[3] > rs_ - 14 and r[1] < rn_ + 14:
                return False
        return r[3] < _OUT_Y1 and r[1] > y0 - 15

    mb = assets.MB()
    k_crops = mb.i(M["crops"])
    uv = mb.bm.loops.layers.uv.verify()
    ncol = len(palette.CROP_COLORS)
    nplots = 0
    y = y0 - 12
    while y < _OUT_Y1:
        bh = rnd.uniform(35, 85)
        x = _OUT_X0
        while x < _OUT_X1:
            bw = rnd.uniform(40, 140)
            r = [x + 1.5, y + 1.5, x + bw - 1.5, y + bh - 1.5]
            x += bw
            if not free(r):
                continue
            q = rnd.random()
            if q < 0.13 or (-340 < r[0] < -150 and -150 < r[1] < 240 and q < 0.75):
                # 整块林地（园区西侧那片定稿里的密林大概率是林地）
                add_rect_cells(r[0], r[1], r[2], r[3], "wood", ragged=14, seed=nplots)
                continue
            if q < 0.2:
                continue  # 留一块荒地 / 草地（露出底图）
            nplots += 1
            c = rnd.randrange(ncol)
            along_x = rnd.random() < 0.5
            vs = [mb.bm.verts.new((px, py, _FIELD_Z)) for px, py in _rect_pts(r)]
            f = mb.bm.faces.new(vs)
            f.material_index = k_crops
            for l in f.loops:
                px, py = l.vert.co.x, l.vert.co.y
                s = (py - r[1]) / (r[3] - r[1]) if along_x else (px - r[0]) / (r[2] - r[0])
                t = (px if along_x else py) / 30.0
                l[uv].uv = ((c + 0.1 + 0.8 * s) / ncol, t)
            # 田埂上的林带：北边、东边各有一定概率
            if rnd.random() < 0.35:
                add_rect_cells(r[0] - 1, r[3] - 2, r[2] + 1, r[3] + 8, "hedge", ragged=4, seed=nplots)
            if rnd.random() < 0.2:
                add_rect_cells(r[2] - 2, r[1], r[2] + 8, r[3], "hedge", ragged=4, seed=nplots + 99)
        y += bh
    P.put(mb.mesh("GROUND_farmland"), "GROUND_farmland")
    # 远河两岸的密林带（定稿里河两岸是成片的暗色树林）：宽度随噪声起伏
    for xx in range(int(_OUT_X0) - 200, int(_OUT_X1) + 300, int(_CELL)):
        rs_, rn_ = river_y(xx)
        ws = 16 + 30 * assets._vnoise(xx / 80.0, 1.0, 3)
        wn = 16 + 34 * assets._vnoise(xx / 80.0, 5.0, 4)
        for j in range(math.floor((rs_ - 8 - ws) / _CELL), math.floor((rs_ - 8) / _CELL)):
            forest.setdefault((xx // int(_CELL), j), "river")
        for j in range(math.ceil((rn_ + 8) / _CELL), math.ceil((rn_ + 8 + wn) / _CELL)):
            forest.setdefault((xx // int(_CELL), j), "river")
    # 远河北岸到远山之间：零散几片林子
    hills_y = min(h[1] for h in S["backdrop"]["hills"])
    for i in range(int(_OUT_X0 / _CELL) - 40, int(_OUT_X1 / _CELL) + 60):
        for j in range(int(300 / _CELL), int((hills_y - 40) / _CELL)):
            cx, cy = (i + 0.5) * _CELL, (j + 0.5) * _CELL
            if cy < river_y(cx)[1] + 60:
                continue
            if assets._vnoise(cx / 110.0, cy / 90.0, 17) > 0.62:
                forest.setdefault((i, j), "wood")
    # 不让林冠盖到道路、村落和园区上
    for key in list(forest):
        cx, cy = (key[0] + 0.5) * _CELL, (key[1] + 0.5) * _CELL
        if any(b[0] - 3 < cx < b[2] + 3 and b[1] - 3 < cy < b[3] + 3 for b in blocks):
            del forest[key]
    mb = assets.MB()
    for kind, (hmin, hmax) in {"wood": (8.0, 17.0), "hedge": (6.0, 12.0), "river": (8.0, 15.0)}.items():
        cells = {k for k, v in forest.items() if v == kind}
        if cells:
            assets.canopy_mesh(mb, M["forest"], cells, _CELL, hmin, hmax, seed=len(kind))
    P.put(mb.mesh("FOREST"), "FOREST")
    return n, nl


_CACHE = {}


def build(M):
    """清好场景后调用：摆放园区（PARK）和无人机预制件（FLEET），返回统计"""
    _CACHE.clear()
    random.seed(1)
    S = load_site()
    col = lib.collection("PARK")
    P = Placer(col)
    pads = []
    _storage(S, M, P, pads)
    _units(S, M, P, pads)
    _racks(S, M, P)
    _utilities(S, M, P, pads)
    _north(S, M, P, pads)
    _perimeter(S, M, P)
    _docks(S, M, P)
    aprons = [[r[0] - 7, r[1] - 7, r[2] + 7, r[3] + 7] for r in pads]
    _ground(S, M, P, pads, aprons)
    n_tree, n_lamp = _greenery(S, M, P, aprons, pads)
    fleet = _fleet(M, lib.collection("FLEET"))
    tris = 0
    for ob in col.all_objects:
        if ob.type == "MESH":
            tris += sum(len(p.vertices) - 2 for p in ob.data.polygons)
    return {"objects": len(col.all_objects), "trees": n_tree, "lamps": n_lamp, "fleet": fleet, "tris_instanced": tris, "pads": len(pads)}

"""模拟医院 · 导航路网、寻路与分步提示。

路网由三部分组成：
  1. 每层的通道中线（环形走廊、中庭北侧通道、候诊区通道、大厅中轴…），在交点处切分成边；
  2. 房间门、公共点、楼梯 / 电梯 / 扶梯口用一段"支线"垂直接到最近的通道上；
  3. 楼层之间的竖向连接：楼梯（上下耗时不同）、电梯（任意两层直达，含候梯时间）、扶梯（单向）。
边的权重统一为"秒"（步行按 1 m/s，医院里病人走得慢），寻路用 Dijkstra。

用户确认的规则（Q6）：默认按总耗时推荐；"无障碍"模式只走电梯。
"""

import heapq
import math

import plan as pl

SPEED = 1.0  # 步行速度 m/s
STAIR_UP, STAIR_DOWN = 38.0, 26.0  # 走楼梯每层耗时（秒，含病人爬楼的体力折算：只差一层且离楼梯近才推荐）
ESC_RIDE = 20.0  # 扶梯每层（含上梯）
ELEV_WAIT, ELEV_DOOR, ELEV_PER_FLOOR = 60.0, 6.0, 4.0  # 电梯：候梯（门诊高峰按 1 分钟）+ 开关门 + 每层运行

# 每层的通道中线：(名称, 起点, 终点)，都是水平或竖直线段
def path_lines(f):
    lines = [
        ("南走廊", (pl.XW, pl.YS), (pl.XE, pl.YS)),
        ("北走廊", (pl.XW, pl.YN), (pl.XE, pl.YN)),
        ("西走廊", (pl.XW, pl.YS), (pl.XW, pl.YN)),
        ("东走廊", (pl.XE, pl.YS), (pl.XE, pl.YN)),
        ("中庭北侧通道", (pl.XW, pl.Y_MID), (pl.XE, pl.Y_MID)),
        ("电梯厅通道", (pl.X_AXIS, pl.Y_MID), (pl.X_AXIS, pl.YN)),
    ]
    # 东西候诊区通道：1F / 3F 北头被柜台式房间挡住，只通到中庭北侧通道；2F 一直通到北走廊
    for s, name in (("W", "西候诊区通道"), ("E", "东候诊区通道")):
        lines.append((name, (pl.X_WAIT[s], pl.YS), (pl.X_WAIT[s], pl.YN if f == 1 else pl.Y_MID)))
    if f == 0:
        lines += [
            ("大厅中轴", (pl.X_AXIS, -4.0), (pl.X_AXIS, pl.Y_MID)),
            ("北入口通道", (pl.X_AXIS, pl.YN), (pl.X_AXIS, pl.D + 4.0)),
            ("大厅西侧", (30.6, pl.YS), (30.6, pl.Y_MID)),
            ("大厅东侧", (55.8, pl.YS), (55.8, pl.Y_MID)),
            ("急诊通道", (pl.XE, 12.6), (pl.W + 4.0, 12.6)),
        ]
    return lines


class Graph:
    def __init__(self):
        self.nodes = {}  # id → dict(floor, x, y, kind, name)
        self.adj = {}  # id → [(to, cost, edge)]
        self.edges = []

    def node(self, nid, floor, x, y, kind="path", name=None, **kw):
        if nid not in self.nodes:
            self.nodes[nid] = dict(id=nid, floor=floor, x=round(x, 3), y=round(y, 3), kind=kind, name=name, **kw)
            self.adj[nid] = []
        return nid

    def edge(self, a, b, cost, kind="walk", oneway=False, **kw):
        e = dict(a=a, b=b, cost=round(cost, 2), kind=kind, oneway=oneway, **kw)
        self.edges.append(e)
        self.adj[a].append((b, cost, e))
        if not oneway:
            self.adj[b].append((a, cost, e))
        return e

    def find_edge(self, a, b):
        for to, _, e in self.adj[a]:
            if to == b:
                return e
        raise KeyError((a, b))


def pid(f, x, y):
    return f"{f}:{x:.2f},{y:.2f}"


def project(p, a, b):
    """点到轴向线段的垂足（夹在线段内）与距离"""
    if abs(a[1] - b[1]) < 1e-9:  # 水平
        x = min(max(p[0], min(a[0], b[0])), max(a[0], b[0]))
        q = (x, a[1])
    else:
        y = min(max(p[1], min(a[1], b[1])), max(a[1], b[1]))
        q = (a[0], y)
    return q, math.hypot(p[0] - q[0], p[1] - q[1])


def build_graph(floors):
    """floors：plan.build_rooms() 的结果。返回 (Graph, 目的地表)。"""
    G = Graph()
    places = []  # 可选起终点：dict(id, name, num, floor, node, kind)

    for f, rooms in enumerate(floors):
        lines = path_lines(f)
        cuts = {i: {0.0} for i in range(len(lines))}  # 每条线上的切分点（沿线距离）

        def along(i, q):
            a = lines[i][1]
            return abs(q[0] - a[0]) + abs(q[1] - a[1])

        for i, (_, a, b) in enumerate(lines):
            cuts[i].add(abs(b[0] - a[0]) + abs(b[1] - a[1]))
        # 交点
        for i, (_, a1, b1) in enumerate(lines):
            for j, (_, a2, b2) in enumerate(lines):
                if j <= i:
                    continue
                h1, h2 = abs(a1[1] - b1[1]) < 1e-9, abs(a2[1] - b2[1]) < 1e-9
                if h1 == h2:
                    continue
                (ha, hb), (va, vb) = ((a1, b1), (a2, b2)) if h1 else ((a2, b2), (a1, b1))
                x, y = va[0], ha[1]
                if min(ha[0], hb[0]) - 1e-6 <= x <= max(ha[0], hb[0]) + 1e-6 and min(va[1], vb[1]) - 1e-6 <= y <= max(va[1], vb[1]) + 1e-6:
                    cuts[i].add(along(i, (x, y)))
                    cuts[j].add(along(j, (x, y)))

        attach = []  # (节点 id, 坐标)：要用支线接到通道上的点

        def add_attach(nid, p):
            best = None
            for i, (_, a, b) in enumerate(lines):
                q, dist = project(p, a, b)
                if best is None or dist < best[2] - 1e-9:
                    best = (i, q, dist)
            i, q, dist = best
            cuts[i].add(along(i, q))
            attach.append((nid, q))

        # 房间
        for r in rooms:
            if not (r["dest"] or r["kind"] == "waiting"):
                continue
            ref = r.get("num") or f"{pl.FLOORS[f]}-{r['key']}"
            dp = pl.door_point(r)
            np_ = pl.nav_point(r)
            door = G.node(f"door:{ref}", f, *dp, kind="door")
            dest = G.node(f"room:{ref}", f, *np_, kind="room", name=r["label"], num=r.get("num"))
            G.edge(dest, door, math.dist(dp, np_) / SPEED, label=None)
            add_attach(door, dp)
            places.append(dict(id=ref, name=r["label"], num=r.get("num"), floor=f, node=dest, kind="room" if r["dest"] else "waiting", zone=r["zone"]))
        # 公共点
        for q in pl.public_points(f):
            nid = G.node(f"pt:{q['id']}", f, *q["p"], kind=q["kind"], name=q["name"])
            if q["kind"] != "gate":  # 入口点本身就是通道端点
                add_attach(nid, q["p"])
            places.append(dict(id=q["id"], name=q["name"], num=None, floor=f, node=nid, kind=q["kind"]))
        # 楼梯
        for s in ("W", "E"):
            door = G.node(f"stair{s}:door:{f}", f, *pl.stair_door(s), kind="stair_door")
            land = G.node(f"stair{s}:{f}", f, *pl.stair_landing(s), kind="stair", name=pl.STAIR_NAME[s])
            G.edge(door, land, math.dist(pl.stair_door(s), pl.stair_landing(s)) / SPEED)
            add_attach(door, pl.stair_door(s))
        # 电梯
        for e in pl.ELEV:
            p = pl.elev_hall(e)
            add_attach(G.node(f"elev{e}:{f}", f, *p, kind="elevator", name=f"{e}号电梯"), p)
        # 扶梯口
        for e in pl.ESC:
            ends = pl.esc_ends(e)
            if f in ends:
                end = "lo" if f == e["lo"] else "hi"
                add_attach(G.node(f"esc{e['id']}:{end}", f, *ends[f], kind="escalator", name="中庭扶梯"), ends[f])

        # 入口点直接落在通道端点上：先建好它们对应的路网点，再连
        # 通道切分成边
        for i, (name, a, b) in enumerate(lines):
            ts = sorted(cuts[i])
            L = ts[-1]
            pts = [(a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L) for t in ts]
            for p, q in zip(pts, pts[1:]):
                if math.dist(p, q) < 1e-6:
                    continue
                G.node(pid(f, *p), f, *p)
                G.node(pid(f, *q), f, *q)
                G.edge(pid(f, *p), pid(f, *q), math.dist(p, q) / SPEED, label=name)
        for nid, q in attach:
            G.node(pid(f, *q), f, *q)
            n = G.nodes[nid]
            G.edge(nid, pid(f, *q), math.dist((n["x"], n["y"]), q) / SPEED, label=None)
        for q in pl.public_points(f):
            if q["kind"] == "gate":
                G.edge(f"pt:{q['id']}", pid(f, *q["p"]), 0.0, label=None)

    # 竖向连接
    nf = len(floors)
    for s in ("W", "E"):
        for f in range(nf - 1):
            a, b = f"stair{s}:{f}", f"stair{s}:{f + 1}"
            G.edge(a, b, STAIR_UP, kind="stair", oneway=True, conn=f"stair{s}", name=pl.STAIR_NAME[s])
            G.edge(b, a, STAIR_DOWN, kind="stair", oneway=True, conn=f"stair{s}", name=pl.STAIR_NAME[s])
    for e in pl.ELEV:
        for i in range(nf):
            for j in range(nf):
                if i != j:
                    G.edge(f"elev{e}:{i}", f"elev{e}:{j}", ELEV_WAIT + ELEV_DOOR + ELEV_PER_FLOOR * abs(i - j),
                           kind="elevator", oneway=True, conn=f"elev{e}", name=f"{e}号电梯")
    for e in pl.ESC:
        lo, hi = f"esc{e['id']}:lo", f"esc{e['id']}:hi"
        a, b = (lo, hi) if e["up"] else (hi, lo)
        G.edge(a, b, ESC_RIDE, kind="escalator", oneway=True, conn=f"esc{e['id']}", name="中庭扶梯")
    return G, places


# ---------------------------------------------------------------- 寻路
MODES = {"recommend": "推荐路线", "accessible": "无障碍（只乘电梯）"}


TURN_COST = 4.0  # 每转一次弯加的代价（秒）：网格上等长的路线很多，优先选拐弯少、好描述的


def heading(G, a, b):
    na, nb = G.nodes[a], G.nodes[b]
    dx, dy = nb["x"] - na["x"], nb["y"] - na["y"]
    L = math.hypot(dx, dy)
    return (dx / L, dy / L) if L > 1e-6 else None


def shortest(G, src, dst, mode="recommend"):
    """Dijkstra（状态 = 节点 + 来向，用来计转弯代价）。返回 (节点序列, 实际耗时秒)。"""
    banned = {"stair", "escalator"} if mode == "accessible" else set()
    start = (src, None, None)  # (节点, 上一节点, 来向)
    best = {start: 0.0}
    prev = {}
    heap = [(0.0, 0, start)]
    tick = 1
    final = None
    while heap:
        d, _, state = heapq.heappop(heap)
        u, pu, hu = state
        if d > best.get(state, math.inf):
            continue
        if u == dst:
            final = state
            break
        for v, c, e in G.adj[u]:
            if e["kind"] in banned or v == pu:
                continue
            nd = d + c
            hv = heading(G, u, v) if e["kind"] == "walk" else None
            if e["kind"] == "walk" and hu is not None and hv is not None and hu[0] * hv[0] + hu[1] * hv[1] < 0.9:
                nd += TURN_COST
            nstate = (v, u, hv if hv is not None else (hu if e["kind"] == "walk" else None))
            if nd < best.get(nstate, math.inf) - 1e-9:
                best[nstate] = nd
                prev[nstate] = state
                heapq.heappush(heap, (nd, tick, nstate))
                tick += 1
    if final is None:
        return None, math.inf
    path, s = [], final
    while s is not None:
        path.append(s[0])
        s = prev.get(s)
    path.reverse()
    cost = sum(G.find_edge(a, b)["cost"] for a, b in zip(path, path[1:]))
    return path, cost


def legs(G, path):
    """把节点序列拆成"本层步行段"和"竖向换层段"。"""
    out, cur = [], None
    for a, b in zip(path, path[1:]):
        e = G.find_edge(a, b)
        if e["kind"] == "walk":
            if cur is None:
                cur = dict(kind="walk", floor=G.nodes[a]["floor"], nodes=[a])
                out.append(cur)
            cur["nodes"].append(b)
        else:
            out.append(dict(kind=e["kind"], conn=e["conn"], name=e["name"], a=a, b=b,
                            f0=G.nodes[a]["floor"], f1=G.nodes[b]["floor"]))
            cur = None
    return out


def runs(G, nodes):
    """步行段 → 直线段列表：[(方向单位向量, 长度, 通道名, 起点, 终点)]，同向的相邻边合并。"""
    out = []
    for a, b in zip(nodes, nodes[1:]):
        na, nb = G.nodes[a], G.nodes[b]
        dx, dy = nb["x"] - na["x"], nb["y"] - na["y"]
        L = math.hypot(dx, dy)
        if L < 1e-6:
            continue
        u = (dx / L, dy / L)
        label = G.find_edge(a, b).get("label")
        if out and abs(out[-1][0][0] - u[0]) < 1e-6 and abs(out[-1][0][1] - u[1]) < 1e-6 and (out[-1][2] == label or label is None or out[-1][2] is None):
            d0, L0, lab0, p0, _ = out[-1]
            out[-1] = (d0, L0 + L, lab0 or label, p0, (nb["x"], nb["y"]))
        else:
            out.append((u, L, label, (na["x"], na["y"]), (nb["x"], nb["y"])))
    return out


def turn(u, v):
    """u → v 的转向：左转 / 右转 / 掉头 / 直行（x 向东、y 向北，叉积 > 0 为左转）"""
    cross = u[0] * v[1] - u[1] * v[0]
    dot = u[0] * v[0] + u[1] * v[1]
    if dot < -0.9:
        return "掉头"
    if abs(cross) < 0.3:
        return "直行"
    return "左转" if cross > 0 else "右转"


def describe(G, path, places_by_node):
    """生成分步提示。返回 [dict(text, floor, kind)]。"""
    L = legs(G, path)
    start = places_by_node.get(path[0], dict(name=G.nodes[path[0]].get("name") or "起点"))
    end = places_by_node.get(path[-1], dict(name=G.nodes[path[-1]].get("name") or "终点"))
    steps = [dict(kind="start", floor=G.nodes[path[0]]["floor"], text=f"从 {fmt_place(start)} 出发")]
    i = 0
    while i < len(L):
        leg = L[i]
        if leg["kind"] == "walk":
            rs = runs(G, leg["nodes"])
            main = [k for k, r in enumerate(rs) if r[1] >= 3.0 and r[2]]  # 有名字、长于 3 m 的才单独成句
            prev_dir = rs[0][0] if rs else None
            first = True
            for k in main:
                u, length, label, _, _ = rs[k]
                t = turn(prev_dir, u) if prev_dir is not None and k > 0 else "直行"
                if first and i == 0 and G.nodes[path[0]]["kind"] in ("room", "door"):
                    lead = f"出门后{t}" if t in ("左转", "右转") else "出门"
                elif first and k == 0:
                    lead = ""  # 从入口 / 梯口直接走上这条通道
                elif t == "直行":
                    lead = "继续"
                else:
                    lead = t
                text = f"{lead}，沿{label}直行 {round(length)} 米" if lead else f"沿{label}直行 {round(length)} 米"
                steps.append(dict(kind="walk", floor=leg["floor"], text=text))
                prev_dir = u
                first = False
            # 段尾转进门口 / 梯口：左手边还是右手边
            tail = rs[main[-1] + 1:] if main else rs
            if tail and main:
                side = turn(rs[main[-1]][0], tail[0][0])
                where = {"左转": "左手边", "右转": "右手边"}.get(side, "正前方")
            else:
                where = "附近"
            if i == len(L) - 1:
                steps.append(dict(kind="end", floor=leg["floor"], text=f"到达 {fmt_place(end)}，在{where}"))
            else:
                nxt = L[i + 1]
                steps.append(dict(kind="hint", floor=leg["floor"], text=f"{nxt['name']}在{where}"))
            i += 1
        else:
            # 连续两段扶梯（中间只走几步）合成一句
            f0, f1 = leg["f0"], leg["f1"]
            j = i
            # 同一部楼梯连爬两层是两条边，合成一段
            while j + 1 < len(L) and L[j + 1]["kind"] == leg["kind"] and L[j + 1].get("conn") == leg["conn"]:
                f1 = L[j + 1]["f1"]
                j += 1
            while (leg["kind"] == "escalator" and j + 2 < len(L) and L[j + 1]["kind"] == "walk"
                   and walk_len(G, L[j + 1]) < 10 and L[j + 2]["kind"] == "escalator"):
                f1 = L[j + 2]["f1"]
                j += 2
            updown = "上" if f1 > f0 else "下"
            if leg["kind"] == "elevator":
                text = f"乘 {leg['name']}到 {pl.FLOORS[f1]}"
            elif leg["kind"] == "escalator":
                via = f"（到 {pl.FLOORS[L[i]['f1']]} 后掉头换乘）" if j > i else ""
                text = f"乘中庭扶梯{updown}到 {pl.FLOORS[f1]}{via}"
            else:
                text = f"走{leg['name']}{updown}到 {pl.FLOORS[f1]}"
            steps.append(dict(kind=leg["kind"], floor=f0, text=text, to=f1))
            i = j + 1
    return steps


def walk_len(G, leg):
    return sum(math.dist((G.nodes[a]["x"], G.nodes[a]["y"]), (G.nodes[b]["x"], G.nodes[b]["y"]))
               for a, b in zip(leg["nodes"], leg["nodes"][1:]))


def fmt_place(p):
    return f"{p['name']}（{p['num']}）" if p.get("num") else p["name"]


def route_polylines(G, path):
    """按楼层拆出路线折线（画图用）：[(floor, [(x, y), …])]，换层处断开。"""
    out = []
    for leg in legs(G, path):
        if leg["kind"] == "walk":
            out.append((leg["floor"], [(G.nodes[n]["x"], G.nodes[n]["y"]) for n in leg["nodes"]]))
    return out


def total_length(G, path):
    return sum(walk_len(G, leg) for leg in legs(G, path) if leg["kind"] == "walk")

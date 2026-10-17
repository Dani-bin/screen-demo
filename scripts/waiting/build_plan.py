"""候诊大厅 · 页面平面数据：从 /hospital 的 CAD（scripts/hospital/plan.py）里截取 2F 内科组。

用法：python3 scripts/waiting/build_plan.py
输出：src/views/waiting/data/plan.json（生成文件，勿手改；改布局去改 scripts/hospital/plan.py 再重跑本脚本）

截取范围 REGION：x 0–39.6、y 0–32.4（米，x 向东、y 向北，原点为西南角）。
  - 南排 8 间内科诊室 213–220（x 7.2–36），门朝北开向走廊；
  - 走廊对面的内科候诊区（5 排连排椅）、内科分诊台 + 二次候诊、护士站；
  - 西侧的内科处置室、医生办公室、西楼梯、卫生间，东侧一角南侧候诊区，以及中庭上空的一部分。
页面镜头从北往南看，所以 213 在画面最左、220 在最右。

家具：plan.py 里的 desk_set / bed / sink / seats / counter / box / chair 只画 CAD 图元。
这里临时替换这些函数，记下每次调用的语义（诊桌、医生椅、患者椅、检查床……）和世界坐标，
三维页面就能按类型摆卡通家具，而不是只把 CAD 多边形挤高。
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts/hospital"))
import plan as pl  # noqa: E402

FLOOR = 1  # 2F
REGION = (0.0, 0.0, 39.6, 32.4)
CLINICS = ["213", "214", "215", "216", "217", "218", "219", "220"]
OUT = os.path.join(ROOT, "src/views/waiting/data/plan.json")


def r3(v):
    return round(v, 3)


def bbox(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return [r3(min(xs)), r3(min(ys)), r3(max(xs)), r3(max(ys))]


def pt(p):
    return [r3(p[0]), r3(p[1])]


def clip(b):
    """矩形裁到 REGION 内；裁没了返回 None"""
    x0, y0, x1, y1 = b
    X0, Y0, X1, Y1 = REGION
    c = [max(x0, X0), max(y0, Y0), min(x1, X1), min(y1, Y1)]
    return [r3(v) for v in c] if c[2] - c[0] > 1e-3 and c[3] - c[1] > 1e-3 else None


def inside(p, b=REGION, pad=0.0):
    return b[0] - pad <= p[0] <= b[2] + pad and b[1] - pad <= p[1] <= b[3] + pad


# ---------------------------------------------------------------- 记录家具函数的调用
REC = []
_depth = [0]  # >0 表示正在某个家具函数内部（desk_set 里调 chair 不重复记）
_room = [None]  # 当前正在布置的房间号


def hook(name, geom):
    orig = getattr(pl, name)

    def wrapped(P, loc, *a, **k):
        if _depth[0] == 0:
            g = geom(loc, *a, **k)
            if g:
                REC.append(dict(type=name, room=_room[0], **g))
        _depth[0] += 1
        try:
            return orig(P, loc, *a, **k)
        finally:
            _depth[0] -= 1

    setattr(pl, name, wrapped)


def g_desk(loc, u, v, w=1.4):
    # 与 plan.desk_set 一致：桌面 w × 0.7；医生椅在桌子靠外墙一侧，患者椅在靠门一侧
    return dict(rect=bbox(loc.rect(u - w / 2, v - 0.35, u + w / 2, v + 0.35)), doctor=pt(loc.p(u, v + 0.75)),
                patient=pt(loc.p(u + 0.2, v - 0.8)))


def g_bed(loc, u, v, along="v", curtain=False):
    pts = loc.rect(u - 0.4, v, u + 0.4, v + 1.9) if along == "v" else loc.rect(u, v - 0.4, u + 1.9, v + 0.4)
    return dict(rect=bbox(pts), head=pt(loc.p(u, v)), curtain=curtain)


def g_seats(loc, u0, u1, v, depth=0.5, pitch=0.55, avoid=()):
    # 与 plan.seats 一致：avoid 区间断开，短于 1 m 的段不摆
    pieces = [(u0, u1)]
    for a, b in avoid:
        pieces = [q for pa, pb in pieces for q in ((pa, min(pb, a)), (max(pa, b), pb)) if q[1] - q[0] > 0]
    rows = [dict(rect=bbox(loc.rect(pa, v, pb, v + depth)), n=int((pb - pa) / pitch)) for pa, pb in pieces if pb - pa >= 1.0]
    return dict(rows=rows, ev=list(loc.ev)) if rows else None


hook("desk_set", g_desk)
hook("bed", g_bed)
hook("sink", lambda loc, u, v: dict(p=pt(loc.p(u, v))))
hook("seats", g_seats)
hook("counter", lambda loc, u0, u1, v, depth=0.6, windows=0: dict(rect=bbox(loc.rect(u0, v, u1, v + depth))))
hook("box", lambda loc, u0, v0, u1, v1, cross=False: dict(rect=bbox(loc.rect(u0, v0, u1, v1))))
hook("chair", lambda loc, u, v, r=0.24: dict(p=pt(loc.p(u, v)), r=r))

_furnish = pl.furnish


def furnish(P, room):
    _room[0] = room.get("num") or room["key"]
    try:
        return _furnish(P, room)
    finally:
        _room[0] = None


pl.furnish = furnish


# ---------------------------------------------------------------- 导出
def main():
    floors = pl.build_rooms()
    rooms = floors[FLOOR]
    prims = pl.floor_prims(FLOOR, rooms)

    out_rooms = []
    for r in rooms:
        c = clip(r["rect"])
        if not c:
            continue
        d = r["door"]
        out_rooms.append(dict(
            id=r.get("num") or r["key"], num=r.get("num"), name=r["label"], kind=r["kind"], zone=r["zone"], rect=c,
            open=r["open"], door=dict(p=pt(d["p"]), w=d["w"], side=d["side"]) if d and inside(d["p"]) else None,
        ))
    out_rooms.append(dict(id="stairW", num=None, name=pl.STAIR_NAME["W"], kind="stair", zone="traffic", rect=list(pl.STAIR["W"]),
                          open=False, door=dict(p=pt(pl.stair_door("W")), w=1.2, side="E")))
    out_rooms.append(dict(id="wcW", num=None, name="卫生间", kind="wc", zone="wc", rect=list(pl.WC["W"]), open=False, door=None))

    # 8 间诊室：按类型给出诊桌、医生 / 患者位置、检查床、洗手盆
    clinic_rects = {r["num"]: r["rect"] for r in rooms if r.get("num") in CLINICS}
    clinics = {}
    for num in CLINICS:
        mine = [e for e in REC if e["room"] == num]
        desk = next(e for e in mine if e["type"] == "desk_set")
        bed = next(e for e in mine if e["type"] == "bed")
        sink = next(e for e in mine if e["type"] == "sink")
        clinics[num] = dict(desk=desk["rect"], doctor=desk["doctor"], patient=desk["patient"], bed=bed["rect"],
                            bedHead=bed["head"], curtain=bed["curtain"], sink=sink["p"])

    def in_clinic(p):
        return any(inside(p, rc) for rc in clinic_rects.values())

    # 连排椅（核心区 + 南侧候诊区），只留落在范围内的段
    seat_rows, seat_rects = [], []
    for e in REC:
        if e["type"] != "seats":
            continue
        for row in e["rows"]:
            seat_rects.append(row["rect"])
            c = clip(row["rect"])
            if c and (c[2] - c[0]) >= 1.0 and (c[3] - c[1]) >= 0.3:
                n = max(1, round(row["n"] * (c[2] - c[0]) / (row["rect"][2] - row["rect"][0])))
                seat_rows.append(dict(rect=c, n=n, ev=e["ev"]))

    # 其余家具：闭合多边形（柜台、护士站、卫生间隔板、处置室柜子……），诊室和连排椅另外处理
    blocks = []
    for p in prims:
        if p["L"] != "FURN" or p["t"] != "poly" or not p["closed"] or p.get("ls"):
            continue
        b = bbox(p["pts"])
        cxy = ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
        if not inside(cxy) or in_clinic(cxy) or b in seat_rects:
            continue
        blocks.append([pt(q) for q in p["pts"]])
    stools = [[r3(p["c"][0]), r3(p["c"][1]), r3(p["r"])] for p in prims
              if p["L"] == "FURN" and p["t"] == "circle" and p["r"] < 0.5 and inside(p["c"]) and not in_clinic(p["c"])]

    walls = [c for c in (clip(bbox(p["pts"])) for p in prims if p["L"] == "WALL" and p["t"] == "poly") if c]
    windows = [[o, r3(c), r3(max(a, REGION[0 if o == "h" else 1])), r3(min(b, REGION[2 if o == "h" else 3]))]
               for k, o, c, a, b in prims.meta["openings"]
               if k == "window" and c == 0.0 and min(b, REGION[2 if o == "h" else 3]) - max(a, REGION[0 if o == "h" else 1]) > 0.3]
    columns = [[r3(i * pl.GRID), r3(j * pl.GRID)] for i in range(pl.NX + 1) for j in range(pl.NY + 1)
               if (round(i * pl.GRID, 1), round(j * pl.GRID, 1)) not in pl.NO_COLUMN and inside((i * pl.GRID, j * pl.GRID))]

    data = dict(
        meta=dict(name="××医院 门诊医技综合楼", floor="2F", area="内科候诊区", region=list(REGION),
                  coords="x 向东、y 向北（米），原点为西南角 ①/Ⓐ 轴交点；页面镜头从北往南看",
                  wallT=dict(ext=pl.T_EXT, int=pl.T_INT), generatedBy="scripts/waiting/build_plan.py"),
        rooms=out_rooms, clinics=clinics, walls=walls, windows=windows, seatRows=seat_rows, blocks=blocks, stools=stools,
        columns=columns, void=clip(pl.VOID),
    )
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"写出 {os.path.relpath(OUT, ROOT)}：房间 {len(out_rooms)}、诊室 {len(clinics)}、墙 {len(walls)}、窗 {len(windows)}、"
          f"连排椅 {len(seat_rows)} 段（{sum(r['n'] for r in seat_rows)} 座）、家具块 {len(blocks)}、凳 {len(stools)}、柱 {len(columns)}")


if __name__ == "__main__":
    main()

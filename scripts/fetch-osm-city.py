#!/usr/bin/env python3
"""
从 Overpass API 拉取城市中心的 OpenStreetMap 数据，预处理成大屏三维场景可直接使用的紧凑 JSON。

用法（成都市中心，默认参数即可）：
    python3 scripts/fetch-osm-city.py

换城市 / 换范围：
    python3 scripts/fetch-osm-city.py --city 杭州 \
        --bbox 30.230,120.180,30.270,120.230 --origin 120.2050,30.2500 \
        --out public/city/hangzhou.json

输出结构（坐标为以 origin 为原点的米制局部坐标，X 向东、Z 向南）：
    meta      城市名、原点经纬度、范围、clip 裁剪矩形 [xmin, zmin, xmax, zmax]
    buildings [{ p: [[x, z], ...], h: 楼高(米), n: 楼名或 null }]
    roads     [{ p: [[x, z], ...], c: "a"|"b"|"c"|"d" }]   a 主干 b 次干 c 支路 d 街巷
    water     [[[x, z], ...]]   水面多边形
    parks     [[[x, z], ...]]   绿地多边形
    rivers    [[[x, z], ...]]   河流中心线（按宽度挤成带状面）

道路与河流中心线会裁剪到「范围 + --clip-margin 米」的矩形内；建筑 / 水面 / 绿地多边形不裁剪。

原始响应会缓存到 scripts/osm-cache/，重复运行不再请求网络。
"""
import argparse
import hashlib
import json
import math
import os
import random
import re
import sys
import time
import urllib.parse
import urllib.request

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

# 道路等级归档：a 主干、b 次干、c 支路、d 街巷
ROAD_CLASS = {
    "motorway": "a", "trunk": "a", "primary": "a",
    "motorway_link": "a", "trunk_link": "a", "primary_link": "a",
    "secondary": "b", "secondary_link": "b",
    "tertiary": "c",
    "residential": "d", "unclassified": "d",
}

# 无高度标签时按建筑类型估算的楼高区间（米）
TYPE_HEIGHT = {
    "apartments": (30, 70), "commercial": (24, 60), "office": (40, 90),
    "hotel": (40, 80), "residential": (18, 45), "house": (6, 9),
    "school": (12, 18), "university": (15, 24), "hospital": (20, 40),
    "retail": (8, 15), "yes": (9, 30),
    # 棚顶、车棚、小屋、车库等小型构筑物
    "roof": (3, 5), "carport": (3, 5), "shed": (3, 5),
    "garage": (3, 5), "garages": (3, 5), "hut": (3, 5),
}


def overpass(query, cache_dir):
    """带缓存与多镜像重试的 Overpass 请求，返回解析后的 JSON。"""
    os.makedirs(cache_dir, exist_ok=True)
    key = hashlib.md5(query.encode("utf-8")).hexdigest()
    cache_file = os.path.join(cache_dir, key + ".json")
    if os.path.exists(cache_file):
        with open(cache_file, encoding="utf-8") as f:
            return json.load(f)

    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    last_error = None
    for attempt in range(6):
        url = MIRRORS[attempt % len(MIRRORS)]
        try:
            req = urllib.request.Request(
                url, data=body,
                headers={"User-Agent": "bi-demo-city3d/1.0", "Accept": "*/*"},
            )
            with urllib.request.urlopen(req, timeout=180) as resp:
                text = resp.read().decode("utf-8")
            data = json.loads(text)
            # Overpass 超时 / 内存不足时也可能返回 200，但带 remark 且 elements 被截断，
            # 这种残缺响应不能写入缓存，抛出异常走重试（elements 为空不算：某些范围内确实可能没有数据）
            if "remark" in data:
                raise RuntimeError(f"响应残缺：{data['remark']}")
            with open(cache_file, "w", encoding="utf-8") as f:
                json.dump(data, f)
            return data
        except Exception as err:  # 服务器繁忙 / 超时：换镜像重试
            last_error = err
            print(f"  请求失败（{url}）：{err}，{5 * (attempt + 1)}s 后重试", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise SystemExit(f"Overpass 请求多次失败：{last_error}")


def parse_num(text):
    """从 '24 m' / '6.5' 之类的标签值里取出数字。"""
    m = re.search(r"\d+(?:\.\d+)?", text or "")
    return float(m.group()) if m else None


def estimate_height(tags, osm_id):
    """高度标签优先，其次层数 × 3.3，否则按类型区间用 id 做种子随机（每次一致）。

    最终不低于 3 米：低于 3 米的值多来自围墙、栅栏之类的标注，挤出后是纸片状薄板，观感很差。
    """
    h = parse_num(tags.get("height"))
    if h:
        return max(3, round(h, 1))
    levels = parse_num(tags.get("building:levels"))
    if levels:
        return max(3, round(levels * 3.3, 1))
    lo, hi = TYPE_HEIGHT.get(tags.get("building", "yes"), (9, 30))
    r = random.Random(osm_id)
    return max(3, round(lo + (hi - lo) * r.random() ** 1.6, 1))


def stitch_rings(ways):
    """把多面关系的 outer 成员 way 按端点拼接成闭合环。

    OSM 里大面积水体 / 公园的外轮廓常被拆成多段未闭合的 way（例如 relation 19710348 由 5 段组成），
    直接把每段当独立多边形会得到破碎的形状。这里从任意一段出发，反复寻找首尾节点能与当前环
    首 / 尾相接的其他段（必要时反转方向）并拼上，直到环闭合或再无可接的段。
    返回若干节点列表；无法闭合的残段也原样返回，由调用方按普通多边形处理。
    """
    def key(node):
        return (node["lon"], node["lat"])

    segments = [list(w["geometry"]) for w in ways if len(w.get("geometry", [])) > 1]
    rings = []
    while segments:
        pts = segments.pop(0)
        grown = True
        while grown and key(pts[0]) != key(pts[-1]):
            grown = False
            for i, seg in enumerate(segments):
                if key(seg[0]) == key(pts[-1]):
                    pts = pts + seg[1:]  # 段头接环尾
                elif key(seg[-1]) == key(pts[-1]):
                    pts = pts + seg[-2::-1]  # 段尾接环尾：反转后接上
                elif key(seg[-1]) == key(pts[0]):
                    pts = seg[:-1] + pts  # 段尾接环头
                elif key(seg[0]) == key(pts[0]):
                    pts = seg[:0:-1] + pts  # 段头接环头：反转后接上
                else:
                    continue
                segments.pop(i)
                grown = True
                break
        rings.append(pts)
    return rings


def clip_polyline(points, xmin, zmin, xmax, zmax):
    """把折线裁剪到矩形内，返回若干段折线（离开矩形再进入时断开成多段）。

    Overpass 返回的是与范围相交的整条 way，河流中心线会延伸到十几公里外、道路也会伸出城区很远，
    既跑出地面又浪费 GPU，所以在数据源头裁掉。逐段用 Liang–Barsky 算法求线段在矩形内的参数区间
    [t0, t1]：t0 > 0 表示从外面进入（新开一段），t1 < 1 表示从里面离开（结束当前段）。
    新交点与其余坐标一样保留 1 位小数，并去掉连续重复点；不足 2 个点的段丢弃。
    """
    def snap(x, z):
        # 保留 1 位小数，并夹回矩形内，避免浮点误差让交点落到边界外一丝
        return [min(max(round(x, 1), xmin), xmax), min(max(round(z, 1), zmin), zmax)]

    pieces, cur = [], []

    def flush():
        # 结束当前段：去连续重复点后，至少 2 个点才保留
        nonlocal cur
        dedup = []
        for q in cur:
            if not dedup or q != dedup[-1]:
                dedup.append(q)
        if len(dedup) >= 2:
            pieces.append(dedup)
        cur = []

    for (x0, z0), (x1, z1) in zip(points, points[1:]):
        dx, dz = x1 - x0, z1 - z0
        t0, t1 = 0.0, 1.0
        inside = True
        # Liang–Barsky：依次对左、右、上、下四条边收缩参数区间
        for pk, qk in ((-dx, x0 - xmin), (dx, xmax - x0), (-dz, z0 - zmin), (dz, zmax - z0)):
            if pk == 0:
                if qk < 0:  # 与该边平行且在外侧
                    inside = False
                    break
            else:
                t = qk / pk
                if pk < 0:
                    t0 = max(t0, t)
                else:
                    t1 = min(t1, t)
                if t0 > t1:
                    inside = False
                    break
        if not inside:
            flush()  # 整段在矩形外：若之前在内部，则在此断开
            continue
        if t0 > 0 or not cur:
            flush()  # 从外面进入（或折线起点）：新开一段
            cur.append(snap(x0 + t0 * dx, z0 + t0 * dz))
        cur.append(snap(x0 + t1 * dx, z0 + t1 * dz))
        if t1 < 1:
            flush()  # 从里面离开矩形：结束当前段
    flush()
    return pieces


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--city", default="成都")
    # 默认范围：南界原为 30.636，望江楼公园·崇丽阁（九眼桥以南）在其外约 350 m，
    # 为收录该景点南扩到 30.624（约 1.3 km），其余三边不变
    ap.add_argument("--bbox", default="30.624,104.040,30.686,104.098", help="south,west,north,east")
    ap.add_argument("--origin", default="104.0657,30.6574", help="lon,lat，作为局部坐标原点")
    ap.add_argument("--out", default="public/city/chengdu.json")
    ap.add_argument("--cache-dir", default="scripts/osm-cache")
    ap.add_argument("--clip-margin", type=float, default=300, help="道路 / 河流裁剪矩形在范围外扩的米数")
    args = ap.parse_args()

    south, west, north, east = [float(v) for v in args.bbox.split(",")]
    lon0, lat0 = [float(v) for v in args.origin.split(",")]
    bbox = f"({south},{west},{north},{east})"

    # 等距圆柱投影：1 度经度 ≈ 111320·cos(lat) 米，1 度纬度 ≈ 110540 米
    kx = 111320 * math.cos(math.radians(lat0))
    kz = 110540

    def to_local(node):
        return [round((node["lon"] - lon0) * kx, 1), round(-(node["lat"] - lat0) * kz, 1)]

    def ring(nodes):
        """节点列表 → 局部坐标多边形：去掉四舍五入后产生的连续重复点，以及闭合重复点。"""
        pts = []
        for n in nodes:
            q = to_local(n)
            if not pts or q != pts[-1]:
                pts.append(q)
        if len(pts) > 1 and pts[0] == pts[-1]:
            pts = pts[:-1]  # 去掉闭合重复点
        return pts

    # 裁剪矩形：范围四角投影到局部坐标，再向外扩 clip_margin 米（北在 -Z，所以取 min / max）
    corners = [to_local({"lon": lon, "lat": lat}) for lon in (west, east) for lat in (south, north)]
    xmin = round(min(c[0] for c in corners) - args.clip_margin, 1)
    xmax = round(max(c[0] for c in corners) + args.clip_margin, 1)
    zmin = round(min(c[1] for c in corners) - args.clip_margin, 1)
    zmax = round(max(c[1] for c in corners) + args.clip_margin, 1)
    clip = [xmin, zmin, xmax, zmax]

    print("拉取建筑…")
    raw_b = overpass(f'[out:json][timeout:120];(way["building"]{bbox};);out geom;', args.cache_dir)
    buildings = []
    for w in raw_b["elements"]:
        if w["type"] != "way":
            continue
        p = ring(w.get("geometry", []))
        if len(p) < 3:
            continue
        tags = w.get("tags", {})
        buildings.append({"p": p, "h": estimate_height(tags, w["id"]), "n": tags.get("name")})

    print("拉取道路…")
    kinds = "|".join(ROAD_CLASS.keys())
    raw_r = overpass(f'[out:json][timeout:120];(way["highway"~"^({kinds})$"]{bbox};);out geom;', args.cache_dir)
    roads = []
    for w in raw_r["elements"]:
        if w["type"] != "way" or len(w.get("geometry", [])) < 2:
            continue
        c = ROAD_CLASS[w["tags"]["highway"]]
        # 裁剪到城区矩形，一条 way 可能被切成多段，每段保留原道路等级
        for piece in clip_polyline([to_local(n) for n in w["geometry"]], *clip):
            roads.append({"p": piece, "c": c})

    print("拉取水系与绿地…")
    raw_l = overpass(
        f'[out:json][timeout:120];('
        f'way["natural"="water"]{bbox};way["waterway"~"^(river|canal|stream)$"]{bbox};'
        f'way["leisure"~"^(park|garden)$"]{bbox};way["landuse"~"^(grass|forest)$"]{bbox};'
        f'relation["natural"="water"]{bbox};relation["leisure"="park"]{bbox};'
        f');out geom;',
        args.cache_dir,
    )
    water, parks, rivers = [], [], []
    for e in raw_l["elements"]:
        tags = e.get("tags", {})
        is_water = tags.get("natural") == "water" or "waterway" in tags
        if e["type"] == "way":
            if "waterway" in tags:
                # 河流中心线同样裁剪到城区矩形，可能切成多段
                rivers.extend(clip_polyline([to_local(n) for n in e.get("geometry", [])], *clip))
                continue
            p = ring(e.get("geometry", []))
            if len(p) >= 3:
                (water if is_water else parks).append(p)
        elif e["type"] == "relation":
            # 多面关系只取 outer 成员并拼接成闭合环；inner（岛 / 洞）成员忽略，场景里不做挖洞
            outers = [m for m in e.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
            for nodes in stitch_rings(outers):
                p = ring(nodes)
                if len(p) >= 3:
                    (water if is_water else parks).append(p)

    out = {
        "meta": {"city": args.city, "origin": [lon0, lat0], "bbox": [south, west, north, east], "clip": clip},
        "buildings": buildings, "roads": roads, "water": water, "parks": parks, "rivers": rivers,
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(args.out) // 1024
    print(f"完成：建筑 {len(buildings)}，道路 {len(roads)}，水面 {len(water)}，绿地 {len(parks)}，河流 {len(rivers)}，文件 {size_kb} KB → {args.out}")


if __name__ == "__main__":
    main()

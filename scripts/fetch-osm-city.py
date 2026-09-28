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
    meta      城市名、原点经纬度、范围
    buildings [{ p: [[x, z], ...], h: 楼高(米), n: 楼名或 null }]
    roads     [{ p: [[x, z], ...], c: "a"|"b"|"c"|"d" }]   a 主干 b 次干 c 支路 d 街巷
    water     [[[x, z], ...]]   水面多边形
    parks     [[[x, z], ...]]   绿地多边形
    rivers    [[[x, z], ...]]   河流中心线（按宽度挤成带状面）

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
    m = re.search(r"[\d.]+", text or "")
    return float(m.group()) if m else None


def estimate_height(tags, osm_id):
    """高度标签优先，其次层数 × 3.3，否则按类型区间用 id 做种子随机（每次一致）。"""
    h = parse_num(tags.get("height"))
    if h:
        return round(h, 1)
    levels = parse_num(tags.get("building:levels"))
    if levels:
        return round(levels * 3.3, 1)
    lo, hi = TYPE_HEIGHT.get(tags.get("building", "yes"), (9, 30))
    r = random.Random(osm_id)
    return round(lo + (hi - lo) * r.random() ** 1.6, 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--city", default="成都")
    ap.add_argument("--bbox", default="30.640,104.045,30.678,104.095", help="south,west,north,east")
    ap.add_argument("--origin", default="104.0657,30.6574", help="lon,lat，作为局部坐标原点")
    ap.add_argument("--out", default="public/city/chengdu.json")
    ap.add_argument("--cache-dir", default="scripts/osm-cache")
    args = ap.parse_args()

    south, west, north, east = [float(v) for v in args.bbox.split(",")]
    lon0, lat0 = [float(v) for v in args.origin.split(",")]
    bbox = f"({south},{west},{north},{east})"

    # 等距圆柱投影：1 度经度 ≈ 111320·cos(lat) 米，1 度纬度 ≈ 110540 米
    kx = 111320 * math.cos(math.radians(lat0))
    kz = 110540

    def to_local(node):
        return [round((node["lon"] - lon0) * kx, 1), round(-(node["lat"] - lat0) * kz, 1)]

    def ring(way):
        pts = [to_local(n) for n in way.get("geometry", [])]
        if len(pts) > 1 and pts[0] == pts[-1]:
            pts = pts[:-1]  # 去掉闭合重复点
        return pts

    print("拉取建筑…")
    raw_b = overpass(f'[out:json][timeout:120];(way["building"]{bbox};);out geom;', args.cache_dir)
    buildings = []
    for w in raw_b["elements"]:
        if w["type"] != "way":
            continue
        p = ring(w)
        if len(p) < 3:
            continue
        tags = w.get("tags", {})
        buildings.append({"p": p, "h": estimate_height(tags, w["id"]), "n": tags.get("name")})

    print("拉取道路…")
    kinds = "|".join(ROAD_CLASS.keys())
    raw_r = overpass(f'[out:json][timeout:120];(way["highway"~"^({kinds})$"]{bbox};);out geom;', args.cache_dir)
    roads = [
        {"p": [to_local(n) for n in w["geometry"]], "c": ROAD_CLASS[w["tags"]["highway"]]}
        for w in raw_r["elements"]
        if w["type"] == "way" and len(w.get("geometry", [])) > 1
    ]

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
                rivers.append([to_local(n) for n in e.get("geometry", [])])
                continue
            p = ring(e)
            if len(p) >= 3:
                (water if is_water else parks).append(p)
        elif e["type"] == "relation":
            # 多面关系只取 outer 成员，每段作为独立多边形
            for m in e.get("members", []):
                if m.get("role") == "outer" and m.get("geometry"):
                    p = ring(m)
                    if len(p) >= 3:
                        (water if is_water else parks).append(p)

    out = {
        "meta": {"city": args.city, "origin": [lon0, lat0], "bbox": [south, west, north, east]},
        "buildings": buildings, "roads": roads, "water": water, "parks": parks, "rivers": rivers,
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(args.out) // 1024
    print(f"完成：建筑 {len(buildings)}，道路 {len(roads)}，水面 {len(water)}，绿地 {len(parks)}，河流 {len(rivers)}，文件 {size_kb} KB → {args.out}")


if __name__ == "__main__":
    main()

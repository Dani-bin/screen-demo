#!/usr/bin/env python3
"""
从 Overpass API 拉取城市中心的 OpenStreetMap 数据，预处理成大屏三维场景可直接使用的紧凑 JSON。

用法（成都市中心，默认参数即可）：
    python3 scripts/fetch-osm-city.py

换城市 / 换范围：
    python3 scripts/fetch-osm-city.py --city 杭州 \
        --bbox 30.230,120.180,30.270,120.230 --origin 120.2050,30.2500 \
        --out public/city/hangzhou.json

飞地（主城区以外单独拉数的小块区域，元素追加在主城区之后，见 meta.enclaves）：
    python3 scripts/fetch-osm-city.py --enclave 熊猫基地:30.727,104.115,30.760,104.157
    不给 --enclave 时用 DEFAULT_ENCLAVES；可重复给出多块。

只拉飞地、主城区沿用已有文件（本地没有 Overpass 缓存时，避免主城区随 OSM 更新而变化）：
    python3 scripts/fetch-osm-city.py --keep-main public/city/chengdu.json
    重复运行：本脚本产出的文件带 meta.mainCounts，对它再跑 --keep-main 会保留其中的主城区、
    丢弃旧飞地并重新拉取飞地（可反复刷新飞地，不会重复追加）；若旧文件含飞地却没有 mainCounts，
    无法分出主城区，会报错退出，请改用不含飞地的旧文件（如 git show <提交>:public/city/chengdu.json）。

输出结构（坐标为以 origin 为原点的米制局部坐标，X 向东、Z 向南）：
    meta      城市名、原点经纬度、主城区范围 bbox 与 clip 裁剪矩形 [xmin, zmin, xmax, zmax]、
              飞地列表 enclaves [{ name, bbox, clip }]、
              主城区各类要素个数 mainCounts { buildings, roads, water, parks, rivers }
              （下面五个数组的前 mainCounts[k] 项是主城区，其后是飞地追加的元素）
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

# 默认飞地：成都大熊猫繁育研究基地（OSM way 941885688）在主城区数据东北角外约东 2.3 km、北 5.1 km，
# 整体扩图楼栋会从约 1.9 万翻到 3.8 万，所以只把基地周边单独拉一块（约 333 栋楼），
# 见 docs/superpowers/specs/2026-10-01-city-panda-base-design.md
DEFAULT_ENCLAVES = ["熊猫基地:30.727,104.115,30.760,104.157"]

# 输出的五类要素，主城区与飞地按这个顺序合并
LAYERS = ("buildings", "roads", "water", "parks", "rivers")


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
    # 为收录该景点南扩到 30.624（约 1.3 km）；西界原为 104.040，杜甫草堂在其外约 1.3 km，
    # 为收录该景点并给镜头留约 1.2 km 余量西扩到 104.012；北、东两边不变
    ap.add_argument("--bbox", default="30.624,104.012,30.686,104.098", help="south,west,north,east")
    ap.add_argument(
        "--enclave", action="append", metavar="名称:南,西,北,东",
        help="飞地（主城区以外单独拉数的小块区域），可重复；不给时用 DEFAULT_ENCLAVES",
    )
    ap.add_argument(
        "--keep-main", metavar="旧JSON",
        help="主城区沿用该文件的数据（不重拉），只拉飞地并追加；"
        "文件由本脚本产出时（带 meta.mainCounts）只取其中的主城区部分，旧飞地丢弃重拉，可重复运行",
    )
    ap.add_argument("--origin", default="104.0657,30.6574", help="lon,lat，作为局部坐标原点")
    ap.add_argument("--out", default="public/city/chengdu.json")
    ap.add_argument("--cache-dir", default="scripts/osm-cache")
    ap.add_argument("--clip-margin", type=float, default=300, help="道路 / 河流裁剪矩形在范围外扩的米数")
    args = ap.parse_args()

    lon0, lat0 = [float(v) for v in args.origin.split(",")]

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

    def fetch_region(south, west, north, east):
        """拉取一块矩形范围的五类要素；道路与河流中心线裁剪到「范围 + clip_margin」的矩形。"""
        bbox = f"({south},{west},{north},{east})"
        # 裁剪矩形：范围四角投影到局部坐标，再向外扩 clip_margin 米（北在 -Z，所以取 min / max）
        corners = [to_local({"lon": lon, "lat": lat}) for lon in (west, east) for lat in (south, north)]
        clip = [
            round(min(c[0] for c in corners) - args.clip_margin, 1),
            round(min(c[1] for c in corners) - args.clip_margin, 1),
            round(max(c[0] for c in corners) + args.clip_margin, 1),
            round(max(c[1] for c in corners) + args.clip_margin, 1),
        ]

        print("  拉取建筑…")
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

        print("  拉取道路…")
        kinds = "|".join(ROAD_CLASS.keys())
        raw_r = overpass(f'[out:json][timeout:120];(way["highway"~"^({kinds})$"]{bbox};);out geom;', args.cache_dir)
        roads = []
        for w in raw_r["elements"]:
            if w["type"] != "way" or len(w.get("geometry", [])) < 2:
                continue
            c = ROAD_CLASS[w["tags"]["highway"]]
            # 裁剪到本区域矩形，一条 way 可能被切成多段，每段保留原道路等级
            for piece in clip_polyline([to_local(n) for n in w["geometry"]], *clip):
                roads.append({"p": piece, "c": c})

        print("  拉取水系与绿地…")
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
                    # 河流中心线同样裁剪到本区域矩形，可能切成多段
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
        return {"clip": clip, "buildings": buildings, "roads": roads, "water": water, "parks": parks, "rivers": rivers}

    # ---- 主城区：重新拉取，或沿用旧文件 ----
    if args.keep_main:
        with open(args.keep_main, encoding="utf-8") as f:
            old = json.load(f)
        if old["meta"]["origin"] != [lon0, lat0]:
            raise SystemExit(f"--keep-main 文件原点 {old['meta']['origin']} 与 --origin 不一致")
        old_meta = old["meta"]
        if "mainCounts" in old_meta:
            # 本脚本产出的文件：各数组前 mainCounts[k] 项是主城区，其后是旧飞地。
            # 只取主城区部分，旧飞地丢弃后重拉，这样重复运行不会把飞地追加两遍
            counts = old_meta["mainCounts"]
            if any(counts[k] > len(old[k]) for k in LAYERS):
                raise SystemExit("--keep-main 文件的 meta.mainCounts 超出数组长度，文件已损坏")
            main_part = {k: old[k][: counts[k]] for k in LAYERS}
        elif old_meta.get("enclaves"):
            # 含飞地却没有 mainCounts（旧版脚本产出），分不出主城区，不能硬当主城区用
            raise SystemExit(
                "--keep-main 文件已含飞地但缺少 meta.mainCounts，无法分出主城区；"
                "请改用不含飞地的旧文件（如 git show <提交>:public/city/chengdu.json）"
            )
        else:
            main_part = {k: old[k] for k in LAYERS}  # 不含飞地的旧文件：整份都是主城区
        main_bbox, main_clip = old_meta["bbox"], old_meta["clip"]
        print(
            f"主城区沿用 {args.keep_main}：建筑 {len(main_part['buildings'])}，"
            f"道路 {len(main_part['roads'])}，水面 {len(main_part['water'])}，"
            f"绿地 {len(main_part['parks'])}，河流 {len(main_part['rivers'])}"
        )
    else:
        south, west, north, east = [float(v) for v in args.bbox.split(",")]
        print("拉取主城区…")
        main_part = fetch_region(south, west, north, east)
        main_bbox, main_clip = [south, west, north, east], main_part["clip"]

    layers = {k: list(main_part[k]) for k in LAYERS}
    # 主城区各类要素个数（飞地追加之前）：写进 meta.mainCounts，之后重跑 --keep-main 靠它分出主城区
    main_counts = {k: len(layers[k]) for k in LAYERS}
    # 水面 / 绿地多边形不裁剪：大面（如河流关系）可能被主城区与飞地的查询都返回，按几何去重
    # （同一 OSM 面两次投影、取整的结果逐点相同）
    seen = {k: {json.dumps(p) for p in layers[k]} for k in ("water", "parks")}

    # ---- 飞地：逐块拉取并追加在主城区之后（主城区数组下标不变） ----
    enclaves = []
    for spec in args.enclave if args.enclave is not None else DEFAULT_ENCLAVES:
        name, _, box = spec.partition(":")
        es, ew, en, ee = [float(v) for v in box.split(",")]
        print(f"拉取飞地「{name}」…")
        part = fetch_region(es, ew, en, ee)
        added = {}
        for k in LAYERS:
            items = part[k]
            if k in seen:
                items = [p for p in items if json.dumps(p) not in seen[k]]
                seen[k].update(json.dumps(p) for p in items)
            layers[k].extend(items)
            added[k] = len(items)
        # 自检：飞地楼栋应落在飞地裁剪框内（楼不裁剪；Overpass 只返回与范围相交的楼，跨框的个别楼会计入「超出」）
        x0, z0, x1, z1 = part["clip"]
        outside = sum(
            1 for b in part["buildings"] if not all(x0 <= x <= x1 and z0 <= z <= z1 for x, z in b["p"])
        )
        print(f"  新增：" + "，".join(f"{k} {v}" for k, v in added.items()) + f"；楼栋超出裁剪框 {outside}")
        enclaves.append({"name": name, "bbox": [es, ew, en, ee], "clip": part["clip"]})

    if args.keep_main:
        # 自检：输出前 main_counts[k] 项与沿用的主城区部分逐项一致（飞地只追加在后面）
        if not all(layers[k][: main_counts[k]] == main_part[k] for k in LAYERS):
            raise SystemExit("自检失败：主城区数据与旧文件不一致")
        print("自检：主城区数据与旧文件逐项一致")

    out = {
        "meta": {
            "city": args.city, "origin": [lon0, lat0],
            "bbox": main_bbox, "clip": main_clip, "enclaves": enclaves,
            "mainCounts": main_counts,
        },
        **layers,
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(args.out) // 1024
    print(
        f"完成：建筑 {len(layers['buildings'])}，道路 {len(layers['roads'])}，水面 {len(layers['water'])}，"
        f"绿地 {len(layers['parks'])}，河流 {len(layers['rivers'])}，文件 {size_kb} KB → {args.out}"
    )


if __name__ == "__main__":
    main()

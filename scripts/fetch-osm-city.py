#!/usr/bin/env python3
"""
从 Overpass API 拉取城市中心的 OpenStreetMap 数据，预处理成大屏三维场景可直接使用的紧凑 JSON。

用法（成都市中心，默认参数即可）：
    python3 scripts/fetch-osm-city.py

换城市 / 换范围：
    python3 scripts/fetch-osm-city.py --city 杭州 \
        --bbox 30.230,120.180,30.270,120.230 --origin 120.2050,30.2500 \
        --no-enclave --out public/city/hangzhou.json

飞地（主城区以外单独拉数的小块区域，元素追加在主城区之后，见 meta.enclaves）：
    python3 scripts/fetch-osm-city.py --enclave 熊猫基地:30.727,104.115,30.760,104.157
    既不给 --enclave 也不给 --no-enclave 时用 DEFAULT_ENCLAVES（成都的熊猫基地），所以换城市要加
    --no-enclave（与 --enclave 互斥，一块飞地都不要）；--enclave 可重复给出多块。
    参数在解析时就校验（格式 名称:南,西,北,东，南 < 北、西 < 东），各区域的裁剪框也不能相互重叠
    （楼栋 / 道路 / 河流不跨区域去重），否则报错退出。

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

道路与河流中心线会裁剪到「范围 + --clip-margin 米」的矩形内；建筑不裁剪；水面 / 绿地多边形在主城区
不裁剪，在飞地里则裁剪到该飞地的裁剪矩形（否则会伸进飞地与主城区之间空旷的地带）。

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
# 只在既不给 --enclave 也不给 --no-enclave 时生效；换城市时要用 --no-enclave 关掉，免得带上成都的飞地
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


def clip_polygon(points, xmin, zmin, xmax, zmax):
    """把多边形裁剪到矩形内（Sutherland–Hodgman：依次对左、右、上、下四条边裁剪），返回新的点列表。

    凸多边形裁出来是一个凸多边形；凹多边形可能多出几条贴着矩形边的退化连线（零宽度），
    填充面时不影响观感。裁剪后不足 3 个点或面积近似为 0（< 0.5 m²）时返回 None，表示整块丢弃。
    新交点与其余坐标一样保留 1 位小数，夹回矩形内，并去掉连续重复点（含首尾重复）。
    """
    pts = points
    # (坐标轴下标, 边界值, 保留 >= 边界还是 <= 边界)：左、右、北（-Z 侧）、南
    for axis, bound, keep_ge in ((0, xmin, True), (0, xmax, False), (1, zmin, True), (1, zmax, False)):
        out = []
        for i, cur in enumerate(pts):
            prev = pts[i - 1]  # i = 0 时取最后一点，首尾相连
            cur_in = cur[axis] >= bound if keep_ge else cur[axis] <= bound
            prev_in = prev[axis] >= bound if keep_ge else prev[axis] <= bound
            if cur_in != prev_in:
                # 这条边穿过边界（两端一内一外，坐标轴分量必不相等）：在边界上补一个交点
                t = (bound - prev[axis]) / (cur[axis] - prev[axis])
                q = [0, 0]
                q[axis] = bound
                q[1 - axis] = prev[1 - axis] + t * (cur[1 - axis] - prev[1 - axis])
                out.append(q)
            if cur_in:
                out.append(cur)
        pts = out
        if not pts:
            return None  # 整块在矩形外

    res = []
    for x, z in pts:
        q = [min(max(round(x, 1), xmin), xmax), min(max(round(z, 1), zmin), zmax)]
        if not res or q != res[-1]:
            res.append(q)
    if len(res) > 1 and res[0] == res[-1]:
        res.pop()
    if len(res) < 3:
        return None
    # 鞋带公式求面积的两倍（以首点为原点，减小浮点误差）：< 1 即面积 < 0.5 m²，视为退化丢弃
    ox, oz = res[0]
    area2 = sum(
        (res[i - 1][0] - ox) * (res[i][1] - oz) - (res[i][0] - ox) * (res[i - 1][1] - oz)
        for i in range(len(res))
    )
    return res if abs(area2) >= 1 else None


def parse_enclave(spec):
    """解析 --enclave 的「名称:南,西,北,东」，返回 (名称, [南, 西, 北, 东])。

    用作 argparse 的 type=，格式不对就抛 ArgumentTypeError，argparse 会在解析参数时报错退出，
    不用等到开始拉数才发现。
    """
    name, sep, box = spec.partition(":")
    name = name.strip()
    if not sep or not name:
        raise argparse.ArgumentTypeError(f"飞地「{spec}」缺少冒号或名称，格式应为 名称:南,西,北,东")
    parts = box.split(",")
    if len(parts) != 4:
        raise argparse.ArgumentTypeError(
            f"飞地「{name}」的范围应为 4 个数（南,西,北,东），实际 {len(parts)} 个：{box}"
        )
    try:
        south, west, north, east = [float(v) for v in parts]
    except ValueError:
        raise argparse.ArgumentTypeError(f"飞地「{name}」的范围含非数字：{box}") from None
    if not all(math.isfinite(v) for v in (south, west, north, east)):
        raise argparse.ArgumentTypeError(f"飞地「{name}」的范围含 nan / inf：{box}")
    if not south < north:
        raise argparse.ArgumentTypeError(f"飞地「{name}」的南界 {south} 应小于北界 {north}")
    if not west < east:
        raise argparse.ArgumentTypeError(f"飞地「{name}」的西界 {west} 应小于东界 {east}")
    return name, [south, west, north, east]


def load_kept_main(path, origin):
    """读取 --keep-main 文件，返回 (meta, 主城区各类要素)。

    - 本脚本产出的文件带 meta.mainCounts：各数组前 mainCounts[k] 项是主城区，其后是旧飞地。
      只取主城区部分，旧飞地丢弃后重拉，所以重复运行不会把飞地追加两遍。
    - 不含飞地的旧文件：整份数组都是主城区。
    - 含飞地却没有 mainCounts（旧版脚本产出）：分不出主城区，报错退出。
    文件读不了 / 缺字段时给出明确的中文提示，而不是抛 KeyError 堆栈。
    """
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
    except (OSError, ValueError) as err:
        raise SystemExit(f"--keep-main 文件无法读取：{path}（{err}）")
    if not isinstance(old, dict) or not isinstance(old.get("meta"), dict):
        raise SystemExit("--keep-main 文件缺少 meta，不是本脚本产出的城市 JSON")
    meta = old["meta"]
    missing = [f"meta.{k}" for k in ("origin", "bbox", "clip") if k not in meta]
    missing += [k for k in LAYERS if k not in old]
    if missing:
        raise SystemExit(f"--keep-main 文件缺少字段：{'、'.join(missing)}")
    if meta["origin"] != origin:
        raise SystemExit(f"--keep-main 文件原点 {meta['origin']} 与 --origin 不一致")

    if "mainCounts" in meta:
        counts = meta["mainCounts"]
        if not isinstance(counts, dict):
            counts = {}
        bad = [k for k in LAYERS if not (isinstance(counts.get(k), int) and 0 <= counts[k] <= len(old[k]))]
        if bad:
            raise SystemExit(f"--keep-main 文件的 meta.mainCounts 缺失或超出数组长度：{'、'.join(bad)}")
        return meta, {k: old[k][: counts[k]] for k in LAYERS}
    if meta.get("enclaves"):
        raise SystemExit(
            "--keep-main 文件已含飞地但缺少 meta.mainCounts，无法分出主城区；"
            "请改用不含飞地的旧文件（如 git show <提交>:public/city/chengdu.json）"
        )
    return meta, {k: old[k] for k in LAYERS}  # 不含飞地的旧文件：整份都是主城区


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--city", default=None, help="城市名，默认 成都；用 --keep-main 时默认沿用旧文件的 meta.city")
    # 默认范围：南界原为 30.636，望江楼公园·崇丽阁（九眼桥以南）在其外约 350 m，
    # 为收录该景点南扩到 30.624（约 1.3 km）；西界原为 104.040，杜甫草堂在其外约 1.3 km，
    # 为收录该景点并给镜头留约 1.2 km 余量西扩到 104.012；北、东两边不变
    default_bbox = "30.624,104.012,30.686,104.098"
    ap.add_argument("--bbox", default=default_bbox, help="south,west,north,east；用 --keep-main 时忽略（主城区范围取旧文件）")
    # 飞地：可重复给出多块，或用 --no-enclave 一块都不要（二者互斥）
    group = ap.add_mutually_exclusive_group()
    group.add_argument(
        "--enclave", action="append", type=parse_enclave, metavar="名称:南,西,北,东",
        help="飞地（主城区以外单独拉数的小块区域），可重复；"
        f"既不给 --enclave 也不给 --no-enclave 时默认 {'、'.join(DEFAULT_ENCLAVES)}",
    )
    group.add_argument(
        "--no-enclave", action="store_true",
        help="不要飞地（换城市时用，避免带上默认的成都飞地）",
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

    def region_clip(south, west, north, east):
        """一块矩形范围的裁剪矩形：范围四角投影到局部坐标，再向外扩 clip_margin 米（北在 -Z，所以取 min / max）。"""
        corners = [to_local({"lon": lon, "lat": lat}) for lon in (west, east) for lat in (south, north)]
        return [
            round(min(c[0] for c in corners) - args.clip_margin, 1),
            round(min(c[1] for c in corners) - args.clip_margin, 1),
            round(max(c[0] for c in corners) + args.clip_margin, 1),
            round(max(c[1] for c in corners) + args.clip_margin, 1),
        ]

    def fetch_region(south, west, north, east):
        """拉取一块矩形范围的五类要素；道路与河流中心线裁剪到「范围 + clip_margin」的矩形。"""
        bbox = f"({south},{west},{north},{east})"
        clip = region_clip(south, west, north, east)

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

    # ---- 要拉的飞地：--no-enclave 不要；--enclave 显式给出；都没给就用默认飞地 ----
    if args.no_enclave:
        enclave_specs = []
    elif args.enclave is not None:
        enclave_specs = args.enclave
    else:
        enclave_specs = [parse_enclave(s) for s in DEFAULT_ENCLAVES]

    # ---- 主城区：沿用旧文件，或按 --bbox 重新拉取（这里只定范围，真正拉数在重叠检查之后） ----
    old_meta = None
    if args.keep_main:
        old_meta, main_part = load_kept_main(args.keep_main, [lon0, lat0])
        main_bbox, main_clip = old_meta["bbox"], old_meta["clip"]
        if args.bbox != default_bbox:
            print(f"警告：使用 --keep-main 时 --bbox 被忽略，主城区范围沿用旧文件的 {main_bbox}", file=sys.stderr)
        print(
            f"主城区沿用 {args.keep_main}：建筑 {len(main_part['buildings'])}，"
            f"道路 {len(main_part['roads'])}，水面 {len(main_part['water'])}，"
            f"绿地 {len(main_part['parks'])}，河流 {len(main_part['rivers'])}"
        )
    else:
        south, west, north, east = [float(v) for v in args.bbox.split(",")]
        main_bbox = [south, west, north, east]
        main_clip = region_clip(south, west, north, east)
        main_part = None
    city = args.city if args.city is not None else (old_meta.get("city", "成都") if old_meta else "成都")

    # ---- 重叠检查：各区域的裁剪框两两不能相交 ----
    # 楼栋 / 道路 / 河流不跨区域去重，裁剪框一重叠，重叠处的元素会被两个区域各拉一遍而重复
    regions = [("主城区", main_clip)] + [
        (f"飞地「{name}」", region_clip(*box)) for name, box in enclave_specs
    ]
    for i, (name_a, a) in enumerate(regions):
        for name_b, b in regions[i + 1:]:
            if a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]:
                raise SystemExit(
                    f"{name_a}的裁剪框 {a} 与{name_b}的裁剪框 {b} 重叠："
                    "楼栋、道路、河流不跨区域去重，重叠会重复；请调整飞地范围，或用 --clip-margin 缩小外扩"
                )

    if main_part is None:
        print("拉取主城区…")
        main_part = fetch_region(south, west, north, east)

    layers = {k: list(main_part[k]) for k in LAYERS}
    # 主城区各类要素个数（飞地追加之前）：写进 meta.mainCounts，之后重跑 --keep-main 靠它分出主城区
    main_counts = {k: len(layers[k]) for k in LAYERS}
    # 水面 / 绿地多边形按几何去重（同一 OSM 面两次投影、取整的结果逐点相同）。两个来源要分开处理：
    # - 与主城区比：飞地查询返回的大面（如河流关系）可能主城区已经带了一份完整（未裁剪）的，
    #   拿裁剪前的原始几何跟主城区判重，重了就整块不要；主城区部分原样保留，只用来判重
    # - 飞地之间、飞地内部比：一块面跨两个飞地时，每个飞地应各留自己裁出来的那一块，
    #   所以拿裁剪后的几何判重（同一飞地里同一 OSM 面出两次，如关系的 outer way 自身也带
    #   natural=water，裁出来的形状必然相同，同样会被去掉）
    main_keys = {k: {json.dumps(p) for p in layers[k]} for k in ("water", "parks")}
    out_keys = {k: set(v) for k, v in main_keys.items()}  # 主城区 + 已收下的飞地多边形（裁剪后）

    # ---- 飞地：逐块拉取并追加在主城区之后（主城区数组下标不变） ----
    enclaves = []
    for name, (es, ew, en, ee) in enclave_specs:
        print(f"拉取飞地「{name}」…")
        part = fetch_region(es, ew, en, ee)
        x0, z0, x1, z1 = part["clip"]
        added = {}
        dup = clipped = dropped = 0
        for k in LAYERS:
            if k not in main_keys:
                layers[k].extend(part[k])
                added[k] = len(part[k])
                continue
            # 飞地的水面 / 绿地多边形不裁剪的话，会伸进飞地与主城区之间空旷的地带
            # （如长达 10 km 的运河、在飞地外撒一堆通用树木的大公园），所以去重后
            # 裁剪到本飞地的裁剪矩形；主城区的多边形保持原样不裁剪
            n0 = len(layers[k])
            for p in part[k]:
                if json.dumps(p) in main_keys[k]:  # 主城区已有完整的一份：用裁剪前的几何判重
                    dup += 1
                    continue
                q = clip_polygon(p, x0, z0, x1, z1)
                if q is None:
                    dropped += 1
                    continue
                key = json.dumps(q)
                if key in out_keys[k]:  # 与已收下的重复（含两块不同的面裁完后恰好相同，如都盖满整个矩形）
                    dup += 1
                    continue
                out_keys[k].add(key)
                if q != p:
                    clipped += 1
                layers[k].append(q)
            added[k] = len(layers[k]) - n0
        # 自检：飞地楼栋应落在飞地裁剪框内（楼不裁剪；Overpass 只返回与范围相交的楼，跨框的个别楼会计入「超出」）
        outside = sum(
            1 for b in part["buildings"] if not all(x0 <= x <= x1 and z0 <= z <= z1 for x, z in b["p"])
        )
        print("  新增：" + "，".join(f"{k} {v}" for k, v in added.items()) + f"；楼栋超出裁剪框 {outside}")
        print(f"  水面 / 绿地多边形：重复去掉 {dup}，裁剪 {clipped}，裁剪后丢弃 {dropped}")
        enclaves.append({"name": name, "bbox": [es, ew, en, ee], "clip": part["clip"]})

    out = {
        "meta": {
            "city": city, "origin": [lon0, lat0],
            "bbox": main_bbox, "clip": main_clip, "enclaves": enclaves,
            "mainCounts": main_counts,
        },
        **layers,
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    # 原子写出：先写到 --out 旁边的临时文件，自检通过后再 os.replace 覆盖；
    # 写出或自检失败就删掉临时文件，--out（可能正是 --keep-main 的输入）保持原样不被写坏
    tmp = args.out + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

        if args.keep_main:
            # 自检：把写出的临时文件读回来，前 mainCounts[k] 项必须与旧文件里取出的主城区部分逐项一致
            # （飞地只追加在后面），且数组总长与内存里一致；不一致就以非零状态退出
            with open(tmp, encoding="utf-8") as f:
                written = json.load(f)
            if written["meta"]["mainCounts"] != main_counts or not all(
                len(written[k]) == len(layers[k]) and written[k][: main_counts[k]] == main_part[k]
                for k in LAYERS
            ):
                raise SystemExit(
                    f"自检失败：写出的主城区数据与 {args.keep_main} 不一致，已删除临时文件，{args.out} 保持不变"
                )
            print("自检：输出文件的主城区数据与旧文件逐项一致")
        os.replace(tmp, args.out)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise

    size_kb = os.path.getsize(args.out) // 1024
    print(
        f"完成：建筑 {len(layers['buildings'])}，道路 {len(layers['roads'])}，水面 {len(layers['water'])}，"
        f"绿地 {len(layers['parks'])}，河流 {len(layers['rivers'])}，文件 {size_kb} KB → {args.out}"
    )


if __name__ == "__main__":
    main()

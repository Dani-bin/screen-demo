"""
智慧牧场（呼伦贝尔 · 陈巴尔虎旗 · 莫日格勒河中游）公开数据下载
----------------------------------------------------------
全部是免登录、允许公开展示的数据（署名见 docs/design/smart-ranch/02-research.md）：
  - 高程：Copernicus GLO-30（30 m，含地物的表面高程 DSM），AWS 公开桶里的 COG
  - 影像：Sentinel-2 L2A（10 m），Earth Search STAC 检索，按窗口读 COG
          全年生长季（4–10 月）每个够晴的日期都存红 / 近红外 / 场景分类，用来算真实 NDVI 长势；
          7–8 月的日期再多存蓝 / 绿两个波段，后面合成真彩色底图
  - 地类：ESA WorldCover 2021（10 m）
  - 矢量：OpenStreetMap（河道、道路、建筑、土地利用），Overpass 接口

所有栅格都重投影到同一张网格：以取景中心为原点的横轴墨卡托（米，正北朝上，x 向东、y 向北），
10 m 一个像素。下载范围比沙盘大一圈（16 × 14 km），最终沙盘的裁切在 prepare 阶段决定。
结果放在 git 忽略的 models/smart-ranch/raw/，已存在的文件跳过。

用法：python scripts/smart-ranch/fetch_data.py [dem|s2|wc|osm ...]（默认全部）
      影像可以按年月分几个进程并行：python scripts/smart-ranch/fetch_data.py s2 2026-07 2026-08
需要 numpy、rasterio（pip install rasterio）；在 Claude 沙箱里联网要放到沙箱外运行。
"""

import json
import os
import ssl
import sys
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

import numpy as np

# GDAL 读远程 COG 的设置：不列目录、合并区间请求、匿名访问公开桶
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")
os.environ.setdefault("AWS_NO_SIGN_REQUEST", "YES")
# 跨境访问 AWS 美西偶尔卡住：设超时并自动重试，避免一个请求挂死整个下载
os.environ.setdefault("GDAL_HTTP_TIMEOUT", "40")
os.environ.setdefault("GDAL_HTTP_CONNECTTIMEOUT", "20")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "4")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "3")

import rasterio  # noqa: E402  （要先设好上面的环境变量）
from rasterio.crs import CRS  # noqa: E402
from rasterio.transform import from_origin  # noqa: E402
from rasterio.warp import Resampling, reproject  # noqa: E402

# python.org 安装的 Python 默认没有根证书，urllib 访问 https 会校验失败；
# rasterio 依赖 certifi，装了 rasterio 就一定有这份证书包
try:
    import certifi

    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CTX = ssl.create_default_context()

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "models" / "smart-ranch" / "raw"

# 取景中心：莫日格勒河中游（场地调研选定，影像上核对过河道和丘陵）
CENTER = (49.62, 120.00)
SIZE = (16000, 14000)  # 下载范围，东西 × 南北（米）
PIXEL = 10.0  # 网格分辨率（米 / 像素）

# 生长季：长势历史按月合成；真彩色底图取放牧期（7–8 月）。
# 2026 年是大屏设定的当季，2025 年用来做同比
SEASONS = [("2025-04-01", "2025-10-31"), ("2026-04-01", "2026-10-31")]
SUMMER_MONTHS = (7, 8)
MIN_CLEAR = 0.5  # 窗口内晴空像素占比低于这个值的日期直接跳过

STAC_URL = "https://earth-search.aws.element84.com/v1/search"
DEM_URL = "https://copernicus-dem-30m.s3.amazonaws.com/{n}/{n}.tif"
WC_URL = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{t}_Map.tif"
# Overpass 主站在国内经常连不上，按顺序换镜像（同 scripts/fetch-osm-city.py）
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

# Sentinel-2 场景分类（SCL）里算作"晴空"的类别：植被、裸地、水体、冰雪
SCL_CLEAR = (4, 5, 6, 11)


def grid():
    """目标网格：以中心为原点的横轴墨卡托，返回 (crs, transform, 宽, 高)"""
    lat0, lon0 = CENTER
    crs = CRS.from_proj4(
        f"+proj=tmerc +lat_0={lat0} +lon_0={lon0} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs"
    )
    w, h = int(SIZE[0] / PIXEL), int(SIZE[1] / PIXEL)
    # 左上角在 (-宽/2, +高/2)
    transform = from_origin(-SIZE[0] / 2, SIZE[1] / 2, PIXEL, PIXEL)
    return crs, transform, w, h


def bbox_lonlat(pad=0.01):
    """下载范围的经纬度外包框（略放大，保证重投影时边缘有数据）"""
    lat0, lon0 = CENTER
    dlat = SIZE[1] / 2 / 111320 + pad
    dlon = SIZE[0] / 2 / (111320 * np.cos(np.radians(lat0))) + pad
    return lon0 - dlon, lat0 - dlat, lon0 + dlon, lat0 + dlat


def warp_into(url, dst, resampling, band=1, src_nodata=None):
    """把远程 COG 的一个波段重投影进目标数组；目标里已有的有效值保留（多幅拼接用）"""
    crs, transform, _, _ = grid()
    tmp = np.full(dst.shape, np.nan, dtype=np.float32)
    with rasterio.open("/vsicurl/" + url) as src:
        reproject(
            source=rasterio.band(src, band),
            destination=tmp,
            dst_transform=transform,
            dst_crs=crs,
            src_nodata=src_nodata if src_nodata is not None else src.nodata,
            dst_nodata=np.nan,
            resampling=resampling,
        )
    hole = np.isnan(dst)
    dst[hole] = tmp[hole]


def write_grid_meta():
    crs, transform, w, h = grid()
    meta = {
        "crs": crs.to_proj4(),
        "center": CENTER,
        "size": SIZE,
        "pixel": PIXEL,
        "width": w,
        "height": h,
        # 像素 (列 i, 行 j) 的中心坐标：x = -SIZE[0]/2 + (i+0.5)*PIXEL，y = SIZE[1]/2 - (j+0.5)*PIXEL
        "origin": [-SIZE[0] / 2, SIZE[1] / 2],
    }
    (RAW / "grid.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))


def fetch_dem():
    out = RAW / "dem.npy"
    if out.exists():
        print("dem: 已存在，跳过")
        return
    _, _, w, h = grid()
    dem = np.full((h, w), np.nan, dtype=np.float32)
    x0, y0, x1, y1 = bbox_lonlat()
    # Copernicus 按 1° 分幅，文件名用分幅左下角的整数经纬度
    for lat in range(int(np.floor(y0)), int(np.floor(y1)) + 1):
        for lon in range(int(np.floor(x0)), int(np.floor(x1)) + 1):
            name = f"Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM"
            print("dem:", name)
            # 30 m → 10 m 用三次卷积插值，缓丘过渡更顺
            warp_into(DEM_URL.format(n=name), dem, Resampling.cubic)
    if np.isnan(dem).any():
        raise RuntimeError(f"dem: 还有 {int(np.isnan(dem).sum())} 个像素没有数据")
    np.save(out, dem)
    print(f"dem: {w}×{h}，高程 {dem.min():.1f}–{dem.max():.1f} m")


def fetch_worldcover():
    out = RAW / "worldcover.npy"
    if out.exists():
        print("worldcover: 已存在，跳过")
        return
    _, _, w, h = grid()
    wc = np.full((h, w), np.nan, dtype=np.float32)
    x0, y0, x1, y1 = bbox_lonlat()
    # WorldCover 按 3° 分幅，文件名用分幅左下角（3 的倍数）
    for lat in range(int(np.floor(y0 / 3) * 3), int(np.floor(y1 / 3) * 3) + 1, 3):
        for lon in range(int(np.floor(x0 / 3) * 3), int(np.floor(x1 / 3) * 3) + 1, 3):
            tile = f"N{lat:02d}E{lon:03d}"
            print("worldcover:", tile)
            warp_into(WC_URL.format(t=tile), wc, Resampling.nearest, src_nodata=0)
    np.save(out, np.nan_to_num(wc, nan=0).astype(np.uint8))
    print("worldcover: 完成")


def stac_search():
    """检索生长季内覆盖取景范围的 Sentinel-2 L2A 场景，按时间排序；结果缓存到 s2/stac.json"""
    cache = RAW / "s2" / "stac.json"
    if cache.exists():
        return json.loads(cache.read_text())
    # 只取用得到的字段，响应从约 1.6 MB 降到几十 KB，跨境网络不容易读断
    fields = ["id", "geometry", "properties.datetime"]
    fields += ["properties.earthsearch:boa_offset_applied", "properties.s2:processing_baseline"]
    fields += [f"assets.{b}.href" for b in ("scl", "red", "nir", "blue", "green")]
    items = []
    for start, end in SEASONS:
        body = {
            "collections": ["sentinel-2-l2a"],
            "bbox": list(bbox_lonlat(pad=0)),
            "datetime": f"{start}T00:00:00Z/{end}T23:59:59Z",
            "query": {"eo:cloud_cover": {"lt": 80}},
            "fields": {"include": fields},
            "limit": 100,
        }
        url, payload = STAC_URL, body
        while url:
            page = None
            for attempt in range(5):
                try:
                    req = urllib.request.Request(
                        url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}
                    )
                    with urllib.request.urlopen(req, timeout=60, context=SSL_CTX) as r:
                        page = json.load(r)
                    break
                except Exception as e:  # 读断了就重试
                    print("stac: 重试", attempt + 1, e)
                    time.sleep(5)
            if page is None:
                raise RuntimeError("stac: 检索失败")
            items += page["features"]
            # 翻页：next 链接自带请求体
            nxt = next((ln for ln in page.get("links", []) if ln.get("rel") == "next"), None)
            url = nxt["href"] if nxt else None
            payload = nxt.get("body", payload) if nxt else None
    items.sort(key=lambda it: it["properties"]["datetime"])
    cache.write_text(json.dumps(items))
    return items


def footprint_cover(item, n=12):
    """场景足迹（GeoJSON 多边形）盖住取景范围的比例：在范围内取 n × n 个采样点做点在多边形内判断"""
    x0, y0, x1, y1 = bbox_lonlat(pad=0)
    geom = item["geometry"]
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]

    def inside(px, py, ring):
        hit = False
        for (ax, ay), (bx, by) in zip(ring, ring[1:] + ring[:1]):
            if (ay > py) != (by > py) and px < ax + (py - ay) * (bx - ax) / (by - ay):
                hit = not hit
        return hit

    pts = [(x0 + (x1 - x0) * (i + 0.5) / n, y0 + (y1 - y0) * (j + 0.5) / n) for i in range(n) for j in range(n)]
    hits = sum(any(inside(px, py, poly[0]) for poly in polys) for px, py in pts)
    return hits / len(pts)


def pick_items(group):
    """同一天的多个分幅是同一次过境，只读覆盖最全的那幅；盖不全再按覆盖率补上其它分幅"""
    ranked = sorted(group, key=footprint_cover, reverse=True)
    chosen, total = [], 0.0
    for it in ranked:
        cov = footprint_cover(it)
        if cov < 0.02:
            break
        chosen.append(it)
        total += cov
        if total >= 0.999:
            break
    return chosen


def fetch_s2(prefixes=()):
    """prefixes：只下这些年月开头的日期（如 2026-07），可以开几个进程按年月并行下载"""
    s2dir = RAW / "s2"
    s2dir.mkdir(exist_ok=True)
    # 每个日期的元数据单独存 <日期>.json，几个进程并行时互不覆盖
    done = {p.stem for p in s2dir.glob("20??-??-??.json")}
    _, _, w, h = grid()

    items = stac_search()
    # 同一天可能有相邻分幅（50U / 51U 带交界）各一景，按日期分组后拼接
    by_day = {}
    for it in items:
        by_day.setdefault(it["properties"]["datetime"][:10], []).append(it)
    print(f"s2: 检索到 {len(items)} 景，{len(by_day)} 个日期")

    for day, group in sorted(by_day.items()):
        out = s2dir / f"{day}.npz"
        if day in done or (prefixes and not day.startswith(tuple(prefixes))):
            continue
        group = pick_items(group)
        if not group:
            continue
        try:
            fetch_day(day, group, s2dir / f"{day}.json", out, w, h)
        except Exception as e:  # 单个日期失败不影响其它日期，下次运行会补
            print(f"s2: {day} 失败，下次再补：{e}")


def fetch_day(day, group, meta_path, out, w, h):
    """读一个日期：先算晴空占比，够晴再读各波段"""
    # 先读场景分类（20 m，体积小）算晴空占比，不够晴的日期不再读其它波段
    scl = np.full((h, w), np.nan, dtype=np.float32)
    for it in group:
        warp_into(it["assets"]["scl"]["href"], scl, Resampling.nearest, src_nodata=0)
    scl = np.nan_to_num(scl, nan=0).astype(np.uint8)
    clear = float(np.isin(scl, SCL_CLEAR).mean())
    entry = {
        "items": [it["id"] for it in group],
        "clear": round(clear, 3),
        # 2022 年起处理基线 04.00 的 L2A 反射率带 -1000 偏移；Earth Search 记录了是否已扣除
        "boaOffsetApplied": [it["properties"].get("earthsearch:boa_offset_applied") for it in group],
        "baseline": [it["properties"].get("s2:processing_baseline") for it in group],
    }
    if clear < MIN_CLEAR:
        entry["skipped"] = True
        meta_path.write_text(json.dumps(entry, indent=2))
        print(f"s2: {day} 晴空 {clear:.0%}，跳过")
        return

    month = date.fromisoformat(day).month
    bands = ["red", "nir"] + (["blue", "green"] if month in SUMMER_MONTHS else [])
    arrays = {"scl": scl}
    for b in bands:
        arr = np.full((h, w), np.nan, dtype=np.float32)
        for it in group:
            warp_into(it["assets"][b]["href"], arr, Resampling.bilinear, src_nodata=0)
        arrays[b] = np.nan_to_num(arr, nan=0).astype(np.uint16)
    np.savez_compressed(out, **arrays)
    meta_path.write_text(json.dumps(entry, indent=2))
    print(f"s2: {day} 晴空 {clear:.0%}，存 {'/'.join(bands)}")


def fetch_osm():
    out = RAW / "osm.json"
    if out.exists():
        print("osm: 已存在，跳过")
        return
    x0, y0, x1, y1 = bbox_lonlat(pad=0)
    bb = f"{y0},{x0},{y1},{x1}"
    query = f"""
[out:json][timeout:120];
(
  way["waterway"]({bb});
  way["natural"="water"]({bb});
  relation["natural"="water"]({bb});
  way["highway"]({bb});
  way["building"]({bb});
  way["landuse"]({bb});
  node["place"]({bb});
  way["barrier"]({bb});
  node["man_made"]({bb});
);
out geom;
"""
    data = urllib.parse.urlencode({"data": query}).encode()
    for url in OVERPASS_URLS:
        try:
            with urllib.request.urlopen(url, data=data, timeout=180, context=SSL_CTX) as r:
                out.write_bytes(r.read())
            break
        except Exception as e:  # 换下一个镜像
            print("osm:", url, "失败", e)
            time.sleep(3)
    else:
        # OSM 只用来参考河道和道路走向，拿不到不影响其它数据
        print("osm: 所有镜像都失败，跳过")
        return
    n = len(json.loads(out.read_text())["elements"])
    print(f"osm: {n} 个要素")


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    write_grid_meta()
    steps = {"dem": fetch_dem, "s2": fetch_s2, "wc": fetch_worldcover, "osm": fetch_osm}
    args = sys.argv[1:]
    names = [a for a in args if a in steps] or list(steps)
    prefixes = [a for a in args if a[:2] == "20"]
    for name in names:
        steps[name](prefixes) if name == "s2" else steps[name]()


if __name__ == "__main__":
    main()

"""
青原露天矿：地形与场地数据准备
----------------------------------------------------------
输入：Sentinel-2 L2A 真彩色（10 m，同一天过境的几景拼接）+ Copernicus GLO-30 DEM（30 m）。
输出（都是生成文件，不要手改）：
  public/open-pit/imagery.webp          18 × 13.5 km 的真彩色影像（10 m / 像素）
  public/open-pit/terrain_h.png         高度场（20 m / 像素，16 位：R 高字节 G 低字节；B = 坑深比例 0–1；解码时关色彩转换）
  src/views/open-pit/data/world.json    世界数据：窗口、高度编码、采坑多边形、设备位置、运输路线、道路、排土场等
  models/open-pit/plan.png              俯视检查图（轮廓 / 坑底 / 设备 / 路线叠在影像上，git 忽略）

为什么采坑要自己建模：Copernicus GLO-30 是 2011–2015 年的数据，采坑当时更小，直接用会得到旧坑。
做法：影像里饱和度低的一块是采坑（草原和复垦区饱和度高），最暗的是煤底；
按公开的「开采深度约 150 m、台阶 15 m」建一个碗，坑外用 DEM（坑内用坑沿平面代替）。

坐标：本地米，原点在采坑中心附近，x 向东、y 向北。屏上不出现真实坐标。
用法：先装 rasterio / numpy / scipy / scikit-image / Pillow，在沙盒外运行（要访问 AWS）：
  CURL_CA_BUNDLE=$(python -c "import certifi;print(certifi.where())") AWS_NO_SIGN_REQUEST=YES python scripts/open-pit/prepare.py
"""
import json
import os
import ssl
import sys
import urllib.request
from pathlib import Path

import certifi
import numpy as np
import rasterio
from PIL import Image, ImageDraw
from rasterio.warp import Resampling, reproject, transform
from rasterio.windows import from_bounds
from scipy import ndimage as ndi
from skimage import measure, morphology
from skimage.color import rgb2hsv

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "models" / "open-pit" / "raw"
RAW.mkdir(parents=True, exist_ok=True)
PUB = ROOT / "public" / "open-pit"
PUB.mkdir(parents=True, exist_ok=True)
OUT_WORLD = ROOT / "src" / "views" / "open-pit" / "data" / "world.json"

# ---------- 窗口 ----------
CENTER = (119.704, 48.581)  # 经度、纬度：窗口中心（采坑中心附近）
HALF_W, HALF_H = 9000.0, 6750.0  # 窗口半宽半高，m
RES_IMG = 10.0  # 影像分辨率 m / 像素
RES_H = 20.0  # 高度场分辨率
DAY = "2026-10-08"  # 影像日期：同一天过境四景，云量都低于 1 %
STAC = "https://earth-search.aws.element84.com/v1/search"

# ---------- 采坑建模参数（公开资料：开采深度 30–152 m，台阶高度 15 m） ----------
PIT_DEPTH = 150.0  # 公开资料：开采深度 30–152 m，取 10 级台阶整数
BENCH = 15.0
FLOOR_SCALE = 0.4  # 坑底线性缩放系数（面积约 16 %），见 extract_pit


def log(*a):
    print(*a, file=sys.stderr)


# =============================================================================
# 1. 影像
# =============================================================================
def fetch_rgb():
    cache = RAW / "rgb.npy"
    if cache.exists():
        return np.load(cache)
    ctx = ssl.create_default_context(cafile=certifi.where())
    body = {
        "collections": ["sentinel-2-l2a"],
        "bbox": [CENTER[0] - 0.5, CENTER[1] - 0.35, CENTER[0] + 0.5, CENTER[1] + 0.35],
        "datetime": f"{DAY}T00:00:00Z/{DAY}T23:59:59Z",
        "limit": 20,
    }
    req = urllib.request.Request(STAC, json.dumps(body).encode(), {"Content-Type": "application/json"})
    items = json.load(urllib.request.urlopen(req, timeout=60, context=ctx))["features"]
    w, h = int(2 * HALF_W / RES_IMG), int(2 * HALF_H / RES_IMG)
    canvas = np.zeros((3, h, w), dtype="uint8")
    for it in items:
        with rasterio.open(it["assets"]["visual"]["href"]) as src:
            xs, ys = transform("EPSG:4326", src.crs, [CENTER[0]], [CENTER[1]])
            cx, cy = xs[0], ys[0]
            win = from_bounds(cx - HALF_W, cy - HALF_H, cx + HALF_W, cy + HALF_H, src.transform)
            data = src.read(window=win, out_shape=(3, h, w), boundless=True, fill_value=0)
        hole = canvas.sum(axis=0) == 0  # 分幅有重叠，只补还是黑的像素
        canvas[:, hole] = data[:, hole]
        log("并入", it["id"])
    rgb = np.moveaxis(canvas, 0, -1)
    np.save(cache, rgb)
    return rgb


def window_utm():
    """窗口中心的 UTM 坐标和 EPSG（用来把 DEM 重投影到同一个网格）"""
    zone_crs = "EPSG:32650"
    xs, ys = transform("EPSG:4326", zone_crs, [CENTER[0]], [CENTER[1]])
    return zone_crs, xs[0], ys[0]


# =============================================================================
# 2. DEM（周边地形）
# =============================================================================
def fetch_dem(crs, cx, cy):
    cache = RAW / "dem20.npy"
    if cache.exists():
        return np.load(cache)
    url = "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N48_00_E119_00_DEM/Copernicus_DSM_COG_10_N48_00_E119_00_DEM.tif"
    w, h = int(2 * HALF_W / RES_H), int(2 * HALF_H / RES_H)
    dst = np.full((h, w), np.nan, dtype="float32")
    dst_tf = rasterio.transform.from_origin(cx - HALF_W, cy + HALF_H, RES_H, RES_H)
    with rasterio.open(url) as src:
        reproject(
            source=rasterio.band(src, 1), destination=dst, dst_transform=dst_tf, dst_crs=crs,
            resampling=Resampling.bilinear,
        )
    np.save(cache, dst)
    return dst


# =============================================================================
# 3. 采坑提取
# =============================================================================
def extract_pit(rgb):
    hsv = rgb2hsv(rgb.astype(float) / 255)
    S = ndi.gaussian_filter(hsv[..., 1], 2.0)
    V = ndi.gaussian_filter(hsv[..., 2], 2.0)
    low = (S < 0.36) & (V > 0.12)  # 台阶和煤底饱和度低，草原 / 复垦区高
    low = morphology.opening(low, morphology.disk(11))  # 较大的核：去掉西北角的细带和零星道路
    low = morphology.closing(low, morphology.disk(9))
    lab = measure.label(low)
    h, w = low.shape
    best = None
    for r in measure.regionprops(lab):
        if r.area < 20000:
            continue
        d = np.hypot(r.centroid[0] - h / 2, r.centroid[1] - w / 2)
        if d < 1200 and (best is None or r.area > best.area):
            best = r
    pit = ndi.binary_fill_holes(lab == best.label)
    pit = ndi.binary_fill_holes(morphology.closing(pit, morphology.disk(15)))
    # 煤底：坑内最暗的一块
    dark = pit & (V < 0.22)
    dark = morphology.opening(dark, morphology.disk(4))
    lab2 = measure.label(dark)
    areas = [(r.area, r.label) for r in measure.regionprops(lab2)]
    floor = lab2 == max(areas)[1]
    floor = ndi.binary_fill_holes(morphology.closing(floor, morphology.disk(6)))
    # 坑底按质心等比缩到 FLOOR_SCALE：影像里的坑底占了坑的将近一半，十级台阶只挤在边缘一圈；
    # 设计稿（概念图）里台阶是同心圈铺满整个坑、坑底只是中间一小块（第 6 轮评审：缺「坑」的体积感）
    c = np.array(ndi.center_of_mass(floor))
    m = np.eye(2) / FLOOR_SCALE
    floor = ndi.affine_transform(floor.astype(float), m, offset=c - m @ c, order=1) > 0.5
    floor &= pit
    return pit, floor


# =============================================================================
# 4. 高度场：周边 DEM + 采坑碗 + 排土场
# =============================================================================
def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def px2m(px, py):
    """10 m 影像像素 → 本地米（x 东、y 北，原点窗口中心）"""
    return (px - HALF_W / RES_IMG) * RES_IMG, (HALF_H / RES_IMG - py) * RES_IMG


def m2px(x, y, res):
    return (x + HALF_W) / res, (HALF_H - y) / res


def build_heights(dem, pit10, floor10):
    h, w = dem.shape  # 20 m 网格
    # 采坑 / 坑底降到 20 m 网格
    pit = pit10[::2, ::2][:h, :w]
    floor = floor10[::2, ::2][:h, :w]
    # 坑沿平面：用环带上的 DEM 做最小二乘平面（坑沿四周的地面）
    ring = morphology.dilation(pit, morphology.disk(25)) & ~morphology.dilation(pit, morphology.disk(10))
    yy, xx = np.nonzero(ring & np.isfinite(dem))
    A = np.c_[xx, yy, np.ones_like(xx)]
    coef, *_ = np.linalg.lstsq(A, dem[yy, xx], rcond=None)
    gy, gx = np.mgrid[0:h, 0:w]
    plane = coef[0] * gx + coef[1] * gy + coef[2]
    z_ref = float(plane[pit].mean())
    base = np.where(np.isfinite(dem), dem, plane)
    # 坑里用平面代替（DEM 里是 2011–2015 年的旧坑）
    base = np.where(morphology.dilation(pit, morphology.disk(3)), plane, base)
    # 周边 DEM 的起伏压到 35 %（场景里高度整体再放大 3 倍）：西、南侧丘陵有一百多米，会盖过 150 m 深的采坑
    base = plane + (base - plane) * 0.35
    base = ndi.gaussian_filter(base, 1.0)

    # w：坑内 0（坑沿）→ 1（坑底）
    dr = ndi.distance_transform_edt(pit) * RES_H
    df = ndi.distance_transform_edt(~floor) * RES_H
    wf = np.where(pit, dr / np.maximum(dr + df, 1e-6), 0.0)
    wf = np.where(floor, 1.0, wf)
    wf = ndi.gaussian_filter(wf, 1.4) * pit
    depth = PIT_DEPTH * np.power(np.clip(wf, 0, 1), 0.85)
    # 台阶：每 BENCH 一级，台阶面（陡坡）只占每级宽度的 35 %，其余是平台；坑底（w ≥ 0.97）保持平
    k = depth / BENCH
    fr = k - np.floor(k)
    stepped = BENCH * (np.floor(k) + smoothstep(0.62, 1.0, fr))
    depth = np.where(wf >= 0.97, PIT_DEPTH, stepped)
    z = base - depth

    # 排土场（位置和高度是演示假设：公开资料没有边界和容量）
    def blob(cx, cy, rx, ry, rot, height, soft=0.22):
        px, py = m2px(cx, cy, RES_H)
        c, s = np.cos(rot), np.sin(rot)
        dx, dy = (gx - px) * RES_H, (gy - py) * RES_H
        u = (dx * c + dy * s) / rx
        v = (-dx * s + dy * c) / ry
        r = np.sqrt(u * u + v * v)
        return height * (1 - smoothstep(1 - soft, 1.0, r))

    dumps = {
        "DP-W": dict(cx=-4500, cy=-200, rx=1250, ry=2000, rot=0.12, height=62),
        "DP-I": dict(cx=3650, cy=900, rx=620, ry=1500, rot=-0.08, height=30),
    }
    clear = 1 - morphology.dilation(pit, morphology.disk(8)).astype(float)  # 排土场不叠到坑里
    for d in dumps.values():
        z = z + blob(d["cx"], d["cy"], d["rx"], d["ry"], d["rot"], d["height"]) * clear
    z = z - z_ref
    return z.astype("float32"), wf.astype("float32"), pit, floor, dumps, z_ref


def encode_png(z, wf, path, lo=-220.0, hi=220.0):
    v = np.clip((z - lo) / (hi - lo), 0, 1) * 65535
    v = v.astype(np.uint16)
    rgb = np.zeros(z.shape + (3,), dtype=np.uint8)
    rgb[..., 0] = v >> 8
    rgb[..., 1] = v & 255
    rgb[..., 2] = (np.clip(wf, 0, 1) * 255).astype(np.uint8)  # 坑深比例，场景里坑的着色用
    Image.fromarray(rgb).save(path)
    return lo, hi


# =============================================================================
# 5. 设备位置与运输路线
# =============================================================================
def bilinear(arr, x, y):
    """arr 的像素坐标 (x, y) 双线性取值"""
    return ndi.map_coordinates(arr, [[y], [x]], order=1, mode="nearest")[0]


class Field:
    """w 场（0 坑沿 → 1 坑底）的米制访问：值、梯度"""

    def __init__(self, wf):
        self.w = ndi.gaussian_filter(wf, 2.0)
        self.gy, self.gx = np.gradient(self.w, RES_H)  # 每米

    def val(self, x, y):
        px, py = m2px(x, y, RES_H)
        return bilinear(self.w, px, py)

    def grad(self, x, y):
        px, py = m2px(x, y, RES_H)
        # 图像 y 向下，世界 y 向北：梯度的 y 分量要取反
        return bilinear(self.gx, px, py), -bilinear(self.gy, px, py)


def find_on_ray(field, cx, cy, theta_deg, w_target, rmax=5000.0):
    """从中心沿 θ 方向，自外向内找 w 第一次达到目标的位置"""
    t = np.deg2rad(theta_deg)
    best = None
    for r in np.arange(rmax, 0, -20.0):
        x, y = cx + r * np.cos(t), cy + r * np.sin(t)
        if field.val(x, y) >= w_target:
            best = (x, y)
            break
    return best


def trace_spiral(field, p0, direction, climb_per_rev=0.3, ds=30.0, max_len=30000.0, w_stop=0.03):
    """从 p0 沿 w 的等值线绕坑盘旋并逐渐爬向坑沿：direction = +1 逆时针，-1 顺时针"""
    pts = [p0]
    x, y = p0
    L = 0.0
    while L < max_len:
        gx, gy = field.grad(x, y)
        gm = np.hypot(gx, gy)
        w = field.val(x, y)
        if w < w_stop:
            break
        if gm < 1e-6:
            break
        n = np.array([gx, gy]) / gm  # 指向坑底
        t = np.array([-n[1], n[0]]) * direction  # 等值线切向
        perim = 14000.0 * (1 - 0.5 * w) + 3000
        c = climb_per_rev / perim  # 每米 w 的下降
        sn = min(c / gm, 0.55)  # 向坑沿的分量
        d = np.sqrt(1 - sn * sn) * t - sn * n
        x, y = x + ds * d[0], y + ds * d[1]
        pts.append((x, y))
        L += ds
    return np.array(pts)


def catmull(points, n_per=12):
    """Catmull-Rom 平滑折线"""
    P = np.array(points, dtype=float)
    P = np.vstack([P[0] - (P[1] - P[0]), P, P[-1] + (P[-1] - P[-2])])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for t in np.linspace(0, 1, n_per, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2])
    return np.array(out)


def resample(poly, step=40.0):
    poly = np.asarray(poly, dtype=float)
    seg = np.hypot(*np.diff(poly, axis=0).T)
    s = np.r_[0, np.cumsum(seg)]
    n = max(2, int(s[-1] / step))
    u = np.linspace(0, s[-1], n)
    return np.c_[np.interp(u, s, poly[:, 0]), np.interp(u, s, poly[:, 1])]


def build_layout(field, pit, floor, dumps):
    # 采坑中心 = 坑区域的质心
    yy, xx = np.nonzero(pit)
    cx, cy = px2m(xx.mean() * RES_H / RES_IMG, yy.mean() * RES_H / RES_IMG)
    pos = {}

    def put(id_, x, y, **kw):
        pos[id_] = dict(x=round(float(x), 1), y=round(float(y), 1), **kw)

    # 电铲：位置按设计稿概念图里 7 台所处的方位和台阶深度对应
    for id_, th, w in [("ES-01", 205, 0.55), ("ES-02", 245, 0.5), ("ES-03", 160, 0.5), ("ES-04", 95, 0.45), ("ES-05", 30, 0.45), ("ES-06", 265, 0.9), ("ES-07", 345, 0.88)]:
        p = find_on_ray(field, cx, cy, th, w)
        put(id_, p[0], p[1], angle=th, w=w)
    p = find_on_ray(field, cx, cy, 80, 0.12)
    put("BW-01", p[0], p[1])
    p = find_on_ray(field, cx, cy, 305, 0.8)
    put("CR-02", p[0], p[1])
    # 边坡雷达：站在坑沿外 60 m
    for id_, th in [("SR-01", 150), ("SR-02", 100), ("SR-03", 30)]:
        p = find_on_ray(field, cx, cy, th, 0.03)  # 自外向内第一次进入坑沿
        t = np.deg2rad(th)
        put(id_, p[0] + 80 * np.cos(t), p[1] + 80 * np.sin(t), angle=th)

    # 地面设施（按影像像素读出：x = (px − 900) × 10，y = (675 − py) × 10）
    def img(px, py):
        return px2m(px, py)

    def shift(p, d):
        return (p[0] + d[0], p[1] + d[1])

    CY_SHIFT = (-1000.0, -450.0)
    SW_SHIFT = (-500.0, -150.0)

    put("CR-01", *img(1040, 775))  # 坑东南缘，输煤皮带起点
    # 南侧设施（封闭煤场 / 电厂 / 换电站）按设计稿概念图的取景整体收近：设计稿里它们排在坑下方的下三分之一，
    # 总览镜头（俯角 42°）下坑占满中部，原来影像上的真实位置会落到右栏和底栏后面（第 6 轮评审：下半屏缺设施）
    put("CY-01", *shift(img(1172, 857), CY_SHIFT), heading=55, length=525, width=160)  # 封闭煤场，长轴朝东北
    # 电厂整体往西北收近约 1.7 km：它离坑真实有 5 km，总览里会被右栏压住，而设计稿概念图里电厂离坑很近。
    # 设计稿优先（布局规则），皮带走廊相应缩短；屏上不出现真实距离，影像底图里真实的电厂仍在原处（很暗，不抢眼）。
    PLANT_SHIFT = (-3050.0, 950.0)

    def pl(p):
        return (p[0] + PLANT_SHIFT[0], p[1] + PLANT_SHIFT[1])

    put("PP-01", *pl(img(1440, 1010)))
    for id_, p in [("PP-01-T1", img(1450, 962)), ("PP-01-T2", img(1472, 985)), ("PP-01-C1", img(1428, 1045)), ("PP-01-C2", img(1472, 1050))]:
        put(id_, *pl(p))
    put("SW-01", *shift(img(1000, 872), SW_SHIFT))
    put("SW-02", *shift(img(1040, 888), SW_SHIFT))
    put("OF-01", *img(1180, 1190))  # 办公生活区
    put("WT-01", *img(880, 150))  # 疏干水处理（影像里西北的水池）
    # 输煤皮带：CR-01 → 煤场 → 向东 → 向南进电厂
    belt = [img(1040, 775), (1520.0, -1500.0), (1650.0, -2000.0), (pos["CY-01"]["x"], pos["CY-01"]["y"]), (1900.0, -2330.0), (2050.0, -2330.0), (pos["PP-01"]["x"] - 150, pos["PP-01"]["y"] + 100)]
    # 排土场与光伏
    put("DP-W", dumps["DP-W"]["cx"], dumps["DP-W"]["cy"])
    put("DP-I", dumps["DP-I"]["cx"], dumps["DP-I"]["cy"])
    put("PV-01", dumps["DP-W"]["cx"] + 120, dumps["DP-W"]["cy"] - 200, width=900, length=1300, rot=0.12)

    # 卸载点：沿排土场边缘各 4 个
    for dp, ang, base in (("DP-W", 0.12, "W"), ("DP-I", -0.08, "I")):
        d = dumps[dp]
        for i in range(4):
            a = np.deg2rad(150 + i * 20) if base == "W" else np.deg2rad(40 - i * 20)
            put(f"UL-{base}{i + 1:02d}", d["cx"] + d["rx"] * 0.55 * np.cos(a), d["cy"] + d["ry"] * 0.55 * np.sin(a))

    # ---- 运输路线 ----
    # 每台电铲一条：装车点 → 绕坑盘旋爬到坑沿 → 平滑接到卸载点。
    # 盘旋方向和坡度（每圈爬升的 w）搜出来：出口离卸载点最近、总长不少于 6 km。
    def route(loader_id, sink_xy):
        p0 = (pos[loader_id]["x"], pos[loader_id]["y"])
        best = None
        for direction in (+1, -1):
            for climb in (0.22, 0.3, 0.4, 0.55):
                sp = trace_spiral(field, p0, direction, climb_per_rev=climb)
                end = sp[-1]
                if field.val(*end) > 0.08 or len(sp) * 30 < 6000:
                    continue
                dist = float(np.hypot(end[0] - sink_xy[0], end[1] - sink_xy[1]))
                if best is None or dist < best[0]:
                    best = (dist, sp, direction, climb)
        dist, sp, direction, climb = best
        end = sp[-1]
        mid_pt = ((end[0] + sink_xy[0]) / 2, (end[1] + sink_xy[1]) / 2)
        tail = catmull([end, mid_pt, sink_xy], 8)
        full = np.vstack([resample(sp, 40), resample(tail, 40)[1:]])
        log(loader_id, "盘旋方向", direction, "每圈爬升", climb, "出口离卸载点 m", round(dist))
        return full

    sink_of = {"ES-01": "UL-W01", "ES-02": "UL-W02", "ES-03": "UL-W03", "ES-04": "UL-I01", "ES-05": "UL-I02", "ES-06": "CR-01"}
    out_routes = {}
    for loader, sink in sink_of.items():
        out_routes[loader] = route(loader, (pos[sink]["x"], pos[sink]["y"]))
    # ES-07：坑底电铲 → 自移式破碎机，很短，不出坑
    a = (pos["ES-07"]["x"], pos["ES-07"]["y"])
    b = (pos["CR-02"]["x"], pos["CR-02"]["y"])
    out_routes["ES-07"] = resample(catmull([a, ((a[0] + b[0]) / 2 + 60, (a[1] + b[1]) / 2 - 40), b], 8), 20)
    return pos, (cx, cy), out_routes, belt


# =============================================================================
# 6. 主流程
# =============================================================================
def main():
    crs, ux, uy = window_utm()
    rgb = fetch_rgb()
    log("影像", rgb.shape)
    Image.fromarray(rgb).save(PUB / "imagery.webp", quality=84, method=6)
    dem = fetch_dem(crs, ux, uy)
    log("DEM", dem.shape, "范围", np.nanmin(dem), np.nanmax(dem))

    pit, floor = extract_pit(rgb)
    log("采坑面积 km²", pit.sum() * RES_IMG**2 / 1e6, "坑底 km²", floor.sum() * RES_IMG**2 / 1e6)
    z, wf, pit20, floor20, dumps, z_ref = build_heights(dem, pit, floor)
    lo, hi = encode_png(z, wf, PUB / "terrain_h.png")
    log("高度场范围 m", float(z.min()), float(z.max()))

    field = Field(wf)
    pos, (cx, cy), routes, belt = build_layout(field, pit20, floor20, dumps)

    # 采坑坑沿多边形（简化）
    cont = max(measure.find_contours(pit.astype(float), 0.5), key=len)
    rim = measure.approximate_polygon(cont, 6.0)
    rim_m = [px2m(p[1], p[0]) for p in rim]
    fcont = max(measure.find_contours(floor.astype(float), 0.5), key=len)
    fl_m = [px2m(p[1], p[0]) for p in measure.approximate_polygon(fcont, 5.0)]

    world = {
        "window": {"halfW": HALF_W, "halfH": HALF_H},
        "imagery": {"res": RES_IMG, "size": [rgb.shape[1], rgb.shape[0]]},
        "height": {"res": RES_H, "size": [z.shape[1], z.shape[0]], "lo": lo, "hi": hi, "pitDepth": PIT_DEPTH, "bench": BENCH},
        "pit": {
            "center": [round(cx, 1), round(cy, 1)],
            "areaKm2": round(float(pit.sum() * RES_IMG**2 / 1e6), 2),
            "rim": [[round(x, 1), round(y, 1)] for x, y in rim_m],
            "floor": [[round(x, 1), round(y, 1)] for x, y in fl_m],
        },
        "dumps": {k: {kk: (round(vv, 3) if isinstance(vv, float) else vv) for kk, vv in v.items()} for k, v in dumps.items()},
        "positions": pos,
        "routes": {k: [[round(float(x), 1), round(float(y), 1)] for x, y in v] for k, v in routes.items()},
        "belt": [[round(float(x), 1), round(float(y), 1)] for x, y in belt],
    }
    OUT_WORLD.parent.mkdir(parents=True, exist_ok=True)
    OUT_WORLD.write_text(json.dumps(world, ensure_ascii=False, separators=(",", ":")))
    log("写出", OUT_WORLD, OUT_WORLD.stat().st_size // 1024, "KB")

    # 俯视检查图
    prev = Image.fromarray(rgb).convert("RGB")
    d = ImageDraw.Draw(prev, "RGBA")

    def P(x, y):
        return ((x + HALF_W) / RES_IMG, (HALF_H - y) / RES_IMG)

    d.line([P(*p) for p in rim_m + [rim_m[0]]], fill=(0, 255, 255, 255), width=3)
    d.line([P(*p) for p in fl_m + [fl_m[0]]], fill=(255, 190, 0, 255), width=3)
    cols = {"ES-01": (255, 80, 80), "ES-02": (255, 130, 80), "ES-03": (255, 180, 80), "ES-04": (120, 255, 120), "ES-05": (80, 255, 200), "ES-06": (255, 255, 0), "ES-07": (255, 0, 255)}
    for k, line in routes.items():
        d.line([P(*p) for p in line], fill=cols[k] + (255,), width=3)
    d.line([P(*p) for p in belt], fill=(255, 255, 255, 255), width=3)
    for k, v in pos.items():
        x, y = P(v["x"], v["y"])
        d.ellipse([x - 6, y - 6, x + 6, y + 6], outline=(255, 255, 255, 255), width=2)
        d.text((x + 8, y - 6), k, fill=(255, 255, 255, 255))
    out = ROOT / "models" / "open-pit"
    out.mkdir(parents=True, exist_ok=True)
    prev.save(out / "plan.png")
    # 山体阴影：检查建出来的碗和排土场
    gy, gx = np.gradient(z, RES_H)
    shade = np.clip(0.5 + (-gx * 0.6 + gy * 0.6) * 1.8, 0, 1)
    Image.fromarray((shade * 255).astype("uint8")).save(out / "relief.png")
    log("俯视检查图", out / "plan.png")


if __name__ == "__main__":
    main()

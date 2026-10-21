"""
智慧牧场：沙盘数据准备
----------------------------------------------------------
读 fetch_data.py 下载的原始数据（git 忽略的 models/smart-ranch/raw/，16 × 14 km、正北朝上），
沿河谷走向切出一块 12 × 8 km 的沙盘（长边顺着莫日格勒河谷），输出：

页面数据（入库）：
  - public/smart-ranch/terrain_h.png：高程顶点网格（含四边，10 m 间距，1201 × 801，行从沙盘"上边"即西北岸到东南岸），
    16 位整数拆成 R（高字节）+ G（低字节）的无损 PNG，海拔 = (R × 256 + G) / H_SCALE + H_OFFSET
  - public/smart-ranch/imagery.webp：2026 年 7–8 月 Sentinel-2 晴空像素中值合成的真彩色底图（2400 × 1600）
  - public/smart-ranch/ndvi_a.png / ndvi_b.png：2026 年 4–10 月逐月 NDVI（a 的 RGBA = 4–7 月，b 的 RGB = 8–10 月），
    NDVI = 像素值 / 255 × (NDVI_MAX − NDVI_MIN) + NDVI_MIN
  - src/views/smart-ranch/data/layout.json：沙盘范围与朝向、河道、禁牧保护带、轮牧单元 / 分区多边形、
    营地、饮水点、场部、基站、摄像头的位置，以及各分区逐月 NDVI 均值（2026 年与 2025 年同期）
设计稿 / 核对用（docs/design/smart-ranch/）：
  - plan-v1.png：规划平面图，分区、保护带、设施叠在影像上

两套坐标：
  - 地理局部坐标 (x, y)：原点 49.62°N 120.00°E，x 向东、y 向北（下载网格用）
  - 沙盘坐标 (X, Y)：原点为沙盘中心，X 沿河谷指向东北、Y 跨河谷指向西北，单位米；layout.json 全部用它
    x = cx + X·cosθ − Y·sinθ，y = cy + X·sinθ + Y·cosθ（θ、cx、cy 写在 layout.json 的 sandbox 里）

真实的部分：地形（Copernicus GLO-30）、影像与逐月 NDVI（Sentinel-2，2025、2026 年）、
            河道（按地形求谷底线 + 影像水体）、湿地（WorldCover）。
示意的部分：牧场边界、轮牧单元 / 分区（围栏顺河谷排成方格）、营地、饮水点、场部、基站、摄像头。
编号规则见 docs/design/smart-ranch/03-scope.md。

用法：python scripts/smart-ranch/prepare.py
需要 numpy、scipy、Pillow、scikit-image。
"""

import json
import math
from datetime import date
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi
from skimage import measure
from skimage.graph import route_through_array

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "models" / "smart-ranch" / "raw"
PUBLIC = ROOT / "public" / "smart-ranch"
PAGE_DATA = ROOT / "src" / "views" / "smart-ranch" / "data"
DOCS = ROOT / "docs" / "design" / "smart-ranch"

GRID = json.loads((RAW / "grid.json").read_text())
PIXEL = GRID["pixel"]
GX0, GY0 = GRID["origin"]  # 下载网格左上角（地理局部坐标，米）
GW, GH = GRID["size"]  # 下载范围（米）

# 沙盘：沿河谷 12 km × 跨河谷 8 km
SB_L, SB_W = 12000.0, 8000.0
SB_COLS, SB_ROWS = int(SB_L / PIXEL), int(SB_W / PIXEL)

# 页面高程编码：1 cm 一级，最低 600 m（最低约 620 m，最高约 910 m，编码最大约 31000）
H_OFFSET = 600.0
H_SCALE = 100.0

# NDVI 编码范围、月份
NDVI_MIN, NDVI_MAX = -0.2, 1.0
MONTHS = list(range(4, 11))  # 4–10 月
SUMMER = (7, 8)
# 大屏设定在 2026 年放牧季；2025 年只用来做同比
YEAR, LAST_YEAR = 2026, 2025

# Sentinel-2 场景分类里的晴空类别（植被、裸地、水体）
SCL_CLEAR = (4, 5, 6)

# 牧场规划参数（示意，见 03-scope.md）
UNITS_ALONG = 5  # 每岸沿河谷 5 个轮牧单元，两岸共 10 个；每个单元 2 × 2 个分区
SHEEP_UNITS = 7  # U01–U07 养羊，U08–U10 养牛
RIVER_BUFFER = 150.0  # 河岸禁牧保护带宽度（米）
TARGET_MU = 90000  # 轮牧分区目标总面积（亩）
MU_PER_PX = PIXEL * PIXEL / (10000 / 15)  # 每像素多少亩（1 亩 = 666.7 m²）


# ---------------- 坐标与重采样 ----------------


class Sandbox:
    """沙盘坐标系：中心 (cx, cy)、河谷方向 theta（弧度，从正东逆时针）"""

    def __init__(self, cx, cy, theta):
        self.cx, self.cy, self.theta = cx, cy, theta
        self.c, self.s = math.cos(theta), math.sin(theta)
        # 沙盘像素中心的沙盘坐标（行从 Y = +W/2 往下）
        cols, rows = np.meshgrid(np.arange(SB_COLS) + 0.5, np.arange(SB_ROWS) + 0.5)
        self.X = cols * PIXEL - SB_L / 2
        self.Y = SB_W / 2 - rows * PIXEL

    def to_geo(self, X, Y):
        return self.cx + X * self.c - Y * self.s, self.cy + X * self.s + Y * self.c

    def to_sb(self, x, y):
        dx, dy = x - self.cx, y - self.cy
        return dx * self.c + dy * self.s, -dx * self.s + dy * self.c

    def resample(self, arr, order=1, X=None, Y=None):
        """把下载网格上的栅格采样到沙盘网格（或给定的沙盘坐标点）"""
        X = self.X if X is None else X
        Y = self.Y if Y is None else Y
        x, y = self.to_geo(X, Y)
        col = (x - GX0) / PIXEL - 0.5
        row = (GY0 - y) / PIXEL - 0.5
        return ndi.map_coordinates(arr, [row, col], order=order, mode="nearest")


def sb_pix(X, Y):
    """沙盘坐标 → 沙盘像素（列, 行，小数）"""
    return (X + SB_L / 2) / PIXEL, (SB_W / 2 - Y) / PIXEL


def pix_sb(col, row):
    return col * PIXEL - SB_L / 2, SB_W / 2 - row * PIXEL


def sample(arr, X, Y):
    """双线性采样沙盘栅格"""
    c, r = sb_pix(X, Y)
    return float(ndi.map_coordinates(arr, [[r - 0.5], [c - 0.5]], order=1, mode="nearest")[0])


# ---------------- 河谷走向与沙盘位置 ----------------


def thalweg_path(dem, start, end):
    """在 dem 上求一条"尽量走低处"的最小代价路径（行列号数组）"""
    cost = (dem - dem.min() + 1.0) ** 3  # 高出谷底越多代价越大，路径贴着谷底走
    path, _ = route_through_array(cost, start, end, fully_connected=True, geometric=True)
    return np.array(path)


def smooth_path(path, k=61):
    """路径平滑（窗口约 600 m），去掉像素台阶"""
    path = path.astype(float)
    pad = np.pad(path, ((k // 2, k // 2), (0, 0)), mode="edge")
    return np.stack([np.convolve(pad[:, i], np.ones(k) / k, mode="valid") for i in range(2)], axis=1)


def find_sandbox(dem_full):
    """
    在下载范围的地形上求谷底线（西南 → 东北），用它的主方向定沙盘朝向；
    沙盘中心取谷底线质心，必要时挪动到能完整放进下载范围的位置。
    莫日格勒河只有 10–20 m 宽，10 m 影像上断断续续，所以用地形定河谷走向，而不是直接找水体。
    """
    h, w = dem_full.shape
    sw = [(r, 0) for r in range(h // 2, h)] + [(h - 1, c) for c in range(w // 2)]
    ne = [(0, c) for c in range(w // 2, w)] + [(r, w - 1) for r in range(h // 2)]
    path = smooth_path(thalweg_path(dem_full, min(sw, key=lambda p: dem_full[p]), min(ne, key=lambda p: dem_full[p])))
    xs = GX0 + (path[:, 1] + 0.5) * PIXEL
    ys = GY0 - (path[:, 0] + 0.5) * PIXEL
    pts = np.stack([xs, ys], axis=1)
    c = pts.mean(axis=0)
    vals, vecs = np.linalg.eigh(np.cov((pts - c).T))
    v = vecs[:, int(np.argmax(vals))]
    theta = math.atan2(v[1], v[0])
    if math.cos(theta) < 0:  # X 轴统一指向东北
        theta += math.pi
    # 旋转后沙盘的外包半宽 / 半高，中心要让它留在下载范围里（留 50 m 余量）
    hx = SB_L / 2 * abs(math.cos(theta)) + SB_W / 2 * abs(math.sin(theta))
    hy = SB_L / 2 * abs(math.sin(theta)) + SB_W / 2 * abs(math.cos(theta))
    cx = float(np.clip(c[0], -GW / 2 + hx + 50, GW / 2 - hx - 50))
    cy = float(np.clip(c[1], -GH / 2 + hy + 50, GH / 2 - hy - 50))
    return Sandbox(cx, cy, theta)


# ---------------- Sentinel-2 ----------------


def load_s2(sb):
    """读所有晴空够格的日期并采样到沙盘网格，返回 [(日期, {波段: 反射率 0–1}), ...]"""
    scenes = []
    skipped_offset = []
    # fetch_data.py 每个日期存一个 <日期>.json（元数据）+ <日期>.npz（波段）
    for mp in sorted((RAW / "s2").glob("20??-??-??.json")):
        day, meta = mp.stem, json.loads(mp.read_text())
        if meta.get("skipped") or not (RAW / "s2" / f"{day}.npz").exists():
            continue
        z = np.load(RAW / "s2" / f"{day}.npz")
        # 处理基线 04.00 起 L2A 数值带 +1000 偏移，Earth Search 绝大多数景已经扣除（boaOffsetApplied = true）。
        # 个别景标记为未扣除，但数值和同月已扣除的景一致，照标记再扣会把暗像元扣成负数、NDVI 爆到几十，
        # 所以标记不一致的景直接跳过（2026 年只有 04-03 一景）
        if not all(meta.get("boaOffsetApplied") or [False]):
            skipped_offset.append(day)
            continue
        offset = 0.0
        bands = {"scl": sb.resample(z["scl"], order=0)}
        for k in ("red", "nir", "green", "blue"):
            if k in z:
                v = sb.resample(z[k].astype(np.float32), order=1)
                bands[k] = np.where(v > 0, (v - offset) / 10000.0, np.nan)
        scenes.append((date.fromisoformat(day), bands))
    if skipped_offset:
        print("偏移标记不一致、跳过的日期：", ", ".join(skipped_offset))
    return scenes


def clear_mask(b):
    """晴空且反射率有效（红光、近红外都为正）的像素"""
    return np.isin(b["scl"], SCL_CLEAR) & (b["red"] > 0.002) & (b["nir"] > 0.002)


def summer_median(scenes, keys, year=YEAR):
    """当年 7–8 月晴空像素逐像素取中值"""
    stack = {k: [] for k in keys}
    for d, b in scenes:
        if d.year != year or d.month not in SUMMER or not all(k in b for k in keys):
            continue
        m = clear_mask(b)
        for k in keys:
            stack[k].append(np.where(m, b[k], np.nan))
    if not stack[keys[0]]:
        raise RuntimeError(f"没有 {year} 年 7–8 月的晴空影像")
    out = {k: np.nanmedian(np.stack(stack[k]), axis=0) for k in keys}
    for k in keys:  # 整季都有云的零星像素用全图中值补
        out[k] = np.where(np.isfinite(out[k]), out[k], np.nanmedian(out[k]))
    return out, len(stack[keys[0]])


def tone_map(rgb):
    """
    反射率 → 8 位 sRGB：按亮度的 99.5 百分位定曝光，gamma 2.2；
    草原在近红外以外的波段反射率很低，直接拉伸会偏荧光绿，所以稍微降一点饱和度、给一点暖色
    """
    lum = rgb.mean(axis=2)
    expo = 0.92 / np.percentile(lum, 99.5)
    out = np.clip(rgb * expo, 0, 1) ** (1 / 2.2)
    grey = out.mean(axis=2, keepdims=True)
    out = grey + (out - grey) * 0.85
    out = out * np.array([1.03, 1.0, 0.94])
    return (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)


def monthly_ndvi(scenes, year):
    """某年 4–10 月逐月 NDVI：当月所有晴空日期的逐像素中值；整月无数据的像素用相邻月份插值"""
    by_month = {m: [] for m in MONTHS}
    for d, b in scenes:
        if d.year == year and d.month in by_month:
            m = clear_mask(b)
            nd = np.clip((b["nir"] - b["red"]) / np.maximum(b["nir"] + b["red"], 1e-4), -1, 1)
            by_month[d.month].append(np.where(m, nd, np.nan))
    cube = np.full((len(MONTHS), SB_ROWS, SB_COLS), np.nan, dtype=np.float32)
    counts = {}
    for i, m in enumerate(MONTHS):
        counts[m] = len(by_month[m])
        if by_month[m]:
            cube[i] = np.nanmedian(np.stack(by_month[m]), axis=0)
    # 沿月份方向线性插值补洞（首尾月份缺失时取最近月份）
    idx = np.arange(len(MONTHS))
    flat = cube.reshape(len(MONTHS), -1)
    bad = ~np.isfinite(flat)
    for j in np.where(bad.any(axis=0))[0]:
        ok = ~bad[:, j]
        flat[:, j] = np.interp(idx, idx[ok], flat[ok, j]) if ok.any() else 0.0
    return cube, counts


# ---------------- 河道与保护带 ----------------


def river_masks(wc, green, nir, dem):
    """
    沙盘内的谷底线（左边最低点 → 右边最低点）+ 水体：
      水体 = WorldCover 水体 / 湿地 ∪ 夏季水体指数为正
      河道 = 离谷底线 700 m 以内、和谷底线连通的含水像元（水体指数 > −0.15，含水草混合像元），再连上谷底线
      保护带 = 河道两侧 RIVER_BUFFER 米
    返回 (水体, 河道, 保护带, 谷底线折线 [X, Y])
    """
    ndwi = (green - nir) / np.maximum(green + nir, 1e-4)
    water = np.isin(wc, (80, 90)) | (ndwi > 0.0)
    wet = np.isin(wc, (80, 90)) | (ndwi > -0.15)
    h, w = dem.shape
    start = min(((r, 0) for r in range(h)), key=lambda p: dem[p])
    end = min(((r, w - 1) for r in range(h)), key=lambda p: dem[p])
    path = thalweg_path(dem, start, end)
    on_line = np.zeros(dem.shape, bool)
    on_line[path[:, 0], path[:, 1]] = True
    near = ndi.distance_transform_edt(~on_line) * PIXEL <= 700
    cand = ndi.binary_closing((wet & near) | on_line, iterations=2)
    # 只保留和谷底线连通的那一片（去掉谷底附近零星的水洼）
    lab, _ = ndi.label(cand, structure=np.ones((3, 3)))
    keep = np.unique(lab[on_line])
    river = np.isin(lab, keep[keep > 0])
    buffer = ndi.distance_transform_edt(~river) * PIXEL <= RIVER_BUFFER
    sm = smooth_path(path)
    X, Y = pix_sb(sm[:, 1] + 0.5, sm[:, 0] + 0.5)
    return water, river, buffer, np.stack([X, Y], axis=1)


# ---------------- 轮牧规划（示意） ----------------


def unit_centerline(line, x0, x1):
    """某段 X 范围内谷底线的平均 Y：作为这个单元两排分区的分界"""
    sel = (line[:, 0] >= x0) & (line[:, 0] < x1)
    return float(line[sel, 1].mean()) if sel.any() else float(np.interp((x0 + x1) / 2, line[:, 0], line[:, 1]))


def label_grid(grid, line, buffer, water):
    """
    按网格参数给沙盘像素打标签：0 = 牧场外，-1 = 保护带，k = 分区 1…40。
    - 单元沿河谷每岸 5 个（西北岸 U01–U05、东南岸 U06–U10，各自从西南到东北编号）；
    - 每个单元 2 × 2 个分区：靠河的两个（1、2）内侧以河岸保护带为界，外侧两个（3、4）是直的围栏；
    - 横向围栏垂直于河谷，纵向围栏平行于河谷，每个单元按它那一段河道的平均位置排（内蒙古草场网围栏多是直线方格）。
    """
    ca, cw, x0 = grid["along"], grid["across"], grid["x0"]
    X, Y = grid["X"], grid["Y"]
    v_river = np.interp(X, line[:, 0], line[:, 1])
    side = np.where(Y >= v_river, 0, 1)  # 0 = 西北岸，1 = 东南岸
    along = np.floor((X - x0) / ca).astype(int)  # 0…9
    unit_col = np.clip(along // 2, 0, UNITS_ALONG - 1)
    vc = np.array([unit_centerline(line, x0 + 2 * k * ca, x0 + 2 * (k + 1) * ca) for k in range(UNITS_ALONG)])
    dv = np.where(side == 0, Y - vc[unit_col], vc[unit_col] - Y)  # 离本单元分界线的距离（向外为正）
    across = np.where(dv < cw, 0, 1)  # 0 = 靠河，1 = 外侧
    margin = 200.0
    inside = (np.abs(X) < SB_L / 2 - margin) & (np.abs(Y) < SB_W / 2 - margin)
    in_band = (along >= 0) & (along < 2 * UNITS_ALONG) & (dv < 2 * cw)
    ok = inside & in_band & ~buffer & ~water
    labels = np.zeros(X.shape, dtype=np.int16)
    unit = side * UNITS_ALONG + unit_col
    # 单元内的分区号：靠河西南 1、靠河东北 2、外侧东北 3、外侧西南 4
    sub = np.where(across == 0, 1 + along % 2, 4 - along % 2)
    labels[ok] = (unit * 4 + sub)[ok]
    labels[inside & in_band & buffer & (labels == 0)] = -1
    # 每个分区只保留最大的连通块（河湾切出来的碎片不算牧场）
    for k in range(1, UNITS_ALONG * 2 * 4 + 1):
        m = labels == k
        lab, n = ndi.label(m)
        if n > 1:
            sizes = ndi.sum(m, lab, index=np.arange(1, n + 1))
            labels[m & (lab != int(np.argmax(sizes)) + 1)] = 0
    return labels, vc


def plan_paddocks(sb, line, buffer, water):
    """自动搜分区尺寸和网格起点：每块分区至少有标称面积的 60%，在此前提下总面积最接近 TARGET_MU"""
    best = None
    for ca in (1150, 1120, 1100):
        for cw in (1350, 1300, 1250, 1200, 1150, 1100):
            for x0 in np.linspace(-SB_L / 2 + 150, -5 * ca * 2 / 2 + 250, 5):
                grid = {"along": ca, "across": cw, "x0": float(x0), "X": sb.X, "Y": sb.Y}
                lab, vc = label_grid(grid, line, buffer, water)
                counts = np.bincount(lab[lab > 0].ravel(), minlength=41)[1:]
                nominal = ca * cw / (PIXEL * PIXEL)
                if counts.min() < 0.6 * nominal:
                    continue
                total = counts.sum() * MU_PER_PX
                score = abs(total - TARGET_MU)
                if best is None or score < best[0]:
                    best = (score, grid, lab, vc, total)
    if best is None:
        raise RuntimeError("找不到能放下 40 个完整分区的网格")
    _, grid, lab, vc, total = best
    print(f"轮牧网格：分区 {grid['along']} × {grid['across']} m，起点 X = {grid['x0']:.0f}，分区合计 {total:.0f} 亩")
    return lab, {"along": grid["along"], "across": grid["across"], "x0": grid["x0"], "vc": [round(float(v), 1) for v in vc]}


def outline(mask, tol=1.5):
    """二值掩膜 → 外轮廓多边形（沙盘坐标，逆时针，首尾不重复）"""
    cs = measure.find_contours(np.pad(mask.astype(float), 1), 0.5)
    c = measure.approximate_polygon(max(cs, key=len), tolerance=tol)[:-1]
    pts = []
    for r, col in c:
        # find_contours 的坐标以像素中心为整数，且多了 1 像素的边框
        X, Y = pix_sb(col - 1 + 0.5, r - 1 + 0.5)
        pts.append([round(float(X), 1), round(float(Y), 1)])
    area = sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1] for i in range(len(pts))) / 2
    return pts if area < 0 else pts[::-1]


def pick_flat(slope, X, Y, radius=300.0, avoid=None):
    """在 (X, Y) 附近 radius 米内找坡度最小的点（营地、场部选址用）；avoid 为不能选的像素掩膜"""
    c, r = sb_pix(X, Y)
    rad = int(radius / PIXEL)
    r0, r1 = max(int(r) - rad, 0), min(int(r) + rad, slope.shape[0])
    c0, c1 = max(int(c) - rad, 0), min(int(c) + rad, slope.shape[1])
    win = slope[r0:r1, c0:c1].copy()
    yy, xx = np.mgrid[r0:r1, c0:c1]
    win[(yy - r) ** 2 + (xx - c) ** 2 > rad**2] = 1e9
    if avoid is not None:
        win[avoid[r0:r1, c0:c1]] = 1e9
    j, i = np.unravel_index(np.argmin(win), win.shape)
    return pix_sb(c0 + i + 0.5, r0 + j + 0.5)


def hilltops(dem, labels, n=4, reach=5000.0):
    """中继基站：在沙盘内的局部高点里，贪心选 n 个使覆盖（半径 reach）的牧场像素最多"""
    peaks = (dem == ndi.maximum_filter(dem, size=41)) & (dem > np.percentile(dem, 60))
    rows, cols = np.nonzero(peaks)
    rr, cc = np.nonzero((labels > 0)[::10, ::10])
    rr, cc = rr * 10, cc * 10
    covered = np.zeros(len(rr), bool)
    chosen = []
    for _ in range(n):
        best, best_gain = None, -1
        for r, c in zip(rows, cols):
            d = np.hypot(rr - r, cc - c) * PIXEL
            gain = ((d < reach) & ~covered).sum() + dem[r, c] * 0.01
            if gain > best_gain and all(np.hypot(r - a, c - b) * PIXEL > 2500 for a, b in chosen):
                best, best_gain = (r, c), gain
        if best is None:
            break
        chosen.append(best)
        covered |= np.hypot(rr - best[0], cc - best[1]) * PIXEL < reach
    return [pix_sb(c + 0.5, r + 0.5) for r, c in chosen]


def r1(v):
    return round(float(v), 1)


# ---------------- 输出 ----------------


def export_terrain(sb, dem_full):
    """顶点网格（含四边，10 m 间距）→ 16 位拆两字节的 PNG；返回顶点网格（米）"""
    nx, ny = SB_COLS + 1, SB_ROWS + 1
    X, Y = np.meshgrid(np.linspace(-SB_L / 2, SB_L / 2, nx), np.linspace(SB_W / 2, -SB_W / 2, ny))
    hgt = sb.resample(dem_full, order=1, X=X, Y=Y)
    code = np.clip(np.round((hgt - H_OFFSET) * H_SCALE), 0, 65535).astype(np.uint16)
    rgb = np.zeros((ny, nx, 3), np.uint8)
    rgb[..., 0] = code >> 8
    rgb[..., 1] = code & 255
    Image.fromarray(rgb).save(PUBLIC / "terrain_h.png", optimize=True)
    return hgt


def export_ndvi(cube):
    q = np.clip(np.round((cube - NDVI_MIN) / (NDVI_MAX - NDVI_MIN) * 255), 0, 255).astype(np.uint8)
    Image.fromarray(np.dstack([q[0], q[1], q[2], q[3]]), "RGBA").save(PUBLIC / "ndvi_a.png", optimize=True)  # 4–7 月
    Image.fromarray(np.dstack([q[4], q[5], q[6]]), "RGB").save(PUBLIC / "ndvi_b.png", optimize=True)  # 8–10 月


def font(size):
    for p in ("/System/Library/Fonts/STHeiti Medium.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc"):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            pass
    return ImageFont.load_default()


def draw_plan(rgb, layout, path, scale=2):
    """规划平面图：影像压暗做底，叠分区 / 保护带 / 设施，核对布局用"""
    base = Image.fromarray(rgb).resize((rgb.shape[1] * scale, rgb.shape[0] * scale), Image.LANCZOS)
    base = Image.blend(base, Image.new("RGB", base.size, (20, 24, 28)), 0.3)
    over = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(over)

    def px(p):
        c, r = sb_pix(p[0], p[1])
        return (c * scale, r * scale)

    for rb in layout["reserve"]["polygons"]:
        d.polygon([px(p) for p in rb], fill=(70, 150, 255, 80), outline=(140, 200, 255, 230))
    sheep, cattle = (120, 220, 140), (240, 190, 90)
    for pd in layout["paddocks"]:
        col = sheep if pd["kind"] == "sheep" else cattle
        d.polygon([px(p) for p in pd["polygon"]], fill=col + (45,), outline=(255, 255, 255, 230))
    big, small = font(30), font(20)
    for pd in layout["paddocks"]:
        d.text(px(pd["center"]), pd["id"], fill=(255, 255, 255, 230), font=small, anchor="mm")
    for un in layout["units"]:
        d.text(px(un["label"]), un["id"], fill=(255, 240, 160, 255), font=big, anchor="mm", stroke_width=2, stroke_fill=(0, 0, 0, 180))
    for wp in layout["water"]:
        x, y = px(wp["pos"])
        d.ellipse((x - 9, y - 9, x + 9, y + 9), fill=(60, 160, 255, 255), outline=(255, 255, 255, 255), width=2)
    for hh in layout["homesteads"]:
        x, y = px(hh["pos"])
        d.rectangle((x - 9, y - 9, x + 9, y + 9), fill=(255, 140, 60, 255), outline=(255, 255, 255, 255), width=2)
        d.text((x + 14, y), hh["id"], fill=(255, 210, 170, 255), font=small, anchor="lm")
    x, y = px(layout["hq"]["pos"])
    d.regular_polygon((x, y, 16), 5, fill=(255, 80, 80, 255), outline=(255, 255, 255, 255))
    d.text((x + 20, y), "HQ-01 场部", fill=(255, 200, 200, 255), font=small, anchor="lm")
    for bs in layout["stations"]:
        x, y = px(bs["pos"])
        d.regular_polygon((x, y, 13), 3, fill=(200, 120, 255, 255), outline=(255, 255, 255, 255))
        d.text((x + 16, y), bs["id"], fill=(225, 200, 255, 255), font=small, anchor="lm")
    # 指北针：北方向在沙盘坐标里是 (sinθ, cosθ)，图上 y 向下
    th = layout["sandbox"]["theta"]
    nx, ny = math.sin(th), math.cos(th)
    cx, cy = base.size[0] - 90, 110
    d.line((cx - nx * 50, cy + ny * 50, cx + nx * 50, cy - ny * 50), fill=(255, 255, 255, 255), width=4)
    d.text((cx + nx * 70, cy - ny * 70), "北", fill=(255, 255, 255, 255), font=big, anchor="mm")
    out = Image.alpha_composite(base.convert("RGBA"), over).convert("RGB")
    ImageDraw.Draw(out).text(
        (24, 20),
        f"莫日格勒河示范牧场 · 规划示意（底图 Sentinel-2 {YEAR} 年 7–8 月合成；分区、设施均为虚构）",
        fill=(255, 255, 255),
        font=big,
    )
    out.save(path, quality=90)


def main():
    PUBLIC.mkdir(parents=True, exist_ok=True)
    PAGE_DATA.mkdir(parents=True, exist_ok=True)

    dem_full = np.load(RAW / "dem.npy")
    sb = find_sandbox(dem_full)
    print(f"沙盘：中心 ({sb.cx:.0f}, {sb.cy:.0f}) m，河谷方向 {math.degrees(sb.theta):.1f}°（从正东逆时针）")
    dem = sb.resample(dem_full, order=1)
    wc = sb.resample(np.load(RAW / "worldcover.npy"), order=0)
    gy, gx = np.gradient(dem, PIXEL)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))

    scenes = load_s2(sb)
    med, n_summer = summer_median(scenes, ("red", "green", "blue", "nir"))
    rgb = tone_map(np.dstack([med["red"], med["green"], med["blue"]]))
    cube, counts = monthly_ndvi(scenes, YEAR)
    cube_last, counts_last = monthly_ndvi(scenes, LAST_YEAR)
    print(f"影像：{YEAR} 年 7–8 月 {n_summer} 个晴空日期参与合成")
    print(f"逐月晴空日期数：{YEAR} {counts}；{LAST_YEAR} {counts_last}")

    water, river, buffer, line = river_masks(wc, med["green"], med["nir"], dem)
    labels, grid = plan_paddocks(sb, line, buffer, water)
    ca, cw, x0, vc = grid["along"], grid["across"], grid["x0"], grid["vc"]

    # ---- 单元与分区 ----
    paddocks, units = [], []
    for k in range(UNITS_ALONG * 2):
        uid = f"U{k + 1:02d}"
        kind = "sheep" if k < SHEEP_UNITS else "cattle"
        umask = (labels > k * 4) & (labels <= k * 4 + 4)
        rows, cols = np.nonzero(umask)
        lx, ly = pix_sb(cols.mean() + 0.5, rows.mean() + 0.5)
        units.append({"id": uid, "kind": kind, "areaMu": int(round(umask.sum() * MU_PER_PX)), "label": [r1(lx), r1(ly)], "paddocks": [f"{uid}-{s}" for s in range(1, 5)]})
        for s in range(1, 5):
            m = labels == k * 4 + s
            rows, cols = np.nonzero(m)
            px_, py_ = pix_sb(cols.mean() + 0.5, rows.mean() + 0.5)
            paddocks.append(
                {
                    "id": f"{uid}-{s}",
                    "unit": uid,
                    "kind": kind,
                    "areaMu": int(round(m.sum() * MU_PER_PX)),
                    "center": [r1(px_), r1(py_)],
                    "elev": r1(dem[m].mean()),
                    "slope": r1(slope[m].mean()),
                    # 逐月 NDVI 面积均值（真实），当年和去年同期
                    "ndvi": {
                        str(YEAR): [round(float(cube[i][m].mean()), 3) for i in range(len(MONTHS))],
                        str(LAST_YEAR): [round(float(cube_last[i][m].mean()), 3) for i in range(len(MONTHS))],
                    },
                    "polygon": outline(m),
                }
            )

    # ---- 保护带（只取牧场范围内那一段）、牧场边界 ----
    rb = labels == -1
    lab, nlab = ndi.label(rb)
    sizes = ndi.sum(rb, lab, index=np.arange(1, nlab + 1))
    reserve_polys = [outline(lab == i + 1) for i in np.argsort(sizes)[::-1] if sizes[i] > 200]
    ranch = ndi.binary_closing(labels != 0, iterations=3)

    def unit_geom(k):
        side, col = divmod(k, UNITS_ALONG)
        x_mid = x0 + (2 * col + 1) * ca
        sgn = 1 if side == 0 else -1
        return x_mid, vc[col], sgn

    # ---- 饮水点：羊单元在 4 个分区共用的角上（"车轮式"布置）；牛单元角上 1 个 + 两个外侧分区中心各 1 个 ----
    water_pts = []
    for k, un in enumerate(units):
        x_mid, v0, sgn = unit_geom(k)
        cands = [(x_mid, v0 + sgn * cw)]
        if un["kind"] == "cattle":
            for s in (3, 4):
                cands.append(tuple(next(p["center"] for p in paddocks if p["id"] == f"{un['id']}-{s}")))
        for X, Y in cands:
            water_pts.append({"unit": un["id"], "pos": [r1(X), r1(Y)]})
    for i, w in enumerate(water_pts):
        w["id"] = f"WP-{i + 1:02d}"
        w["elev"] = r1(sample(dem, *w["pos"]))

    # ---- 营地：单元外侧围栏中点往里 200 m 附近找最平的地方（避开水体和保护带） ----
    avoid = water | buffer
    homesteads = []
    for k, un in enumerate(units):
        x_mid, v0, sgn = unit_geom(k)
        X, Y = pick_flat(slope, x_mid, v0 + sgn * (2 * cw - 200), 250, avoid)
        homesteads.append({"id": f"HH-{k + 1:02d}", "unit": un["id"], "pos": [r1(X), r1(Y)], "elev": r1(sample(dem, X, Y))})

    # ---- 场部：牧场中段、西北岸离河道约 600 m 的平地 ----
    y_river0 = float(np.interp(0.0, line[:, 0], line[:, 1]))
    hx, hy = pick_flat(slope, 0.0, y_river0 + 600, 400, avoid)
    hq = {"id": "HQ-01", "pos": [r1(hx), r1(hy)], "elev": r1(sample(dem, hx, hy)), "facilities": ["WS-01", "DP-01", "HS-01"]}

    # ---- 中继基站、摄像头 ----
    stations = [{"id": f"BS-{i + 1:02d}", "pos": [r1(X), r1(Y)], "elev": r1(sample(dem, X, Y)), "range": 5000} for i, (X, Y) in enumerate(hilltops(dem, labels))]
    cam_wp = ["WP-01", "WP-03", "WP-05", "WP-08", "WP-11", "WP-14"]
    cameras = [{"id": "CAM-01", "at": "HQ-01"}, {"id": "CAM-02", "at": "HQ-01"}] + [{"id": f"CAM-{i + 3:02d}", "at": w} for i, w in enumerate(cam_wp)]

    # ---- 河道折线（沙盘坐标，抽稀到约 50 m 一点） ----
    river_line = [[r1(X), r1(Y)] for X, Y in line[::5]]

    layout = {
        "_note": "scripts/smart-ranch/prepare.py 生成，不要手改。沙盘坐标：X 沿河谷指向东北、Y 跨河谷指向西北，米；北方向 = (sinθ, cosθ)",
        "sandbox": {
            "size": [SB_L, SB_W],
            "pixel": PIXEL,
            "theta": round(sb.theta, 5),
            "center": [r1(sb.cx), r1(sb.cy)],
            "origin": "49.62°N 120.00°E",
            "hOffset": H_OFFSET,
            "hScale": H_SCALE,
        },
        "elevation": {"min": r1(dem.min()), "max": r1(dem.max())},
        "ndvi": {"months": MONTHS, "min": NDVI_MIN, "max": NDVI_MAX, "year": YEAR, "scenes": {str(YEAR): counts, str(LAST_YEAR): counts_last}},
        "grid": grid,
        "river": river_line,
        "ranch": {"areaMu": int(round(ranch.sum() * MU_PER_PX)), "outline": outline(ranch, tol=2.0)},
        "reserve": {"id": "RB-01", "bufferM": RIVER_BUFFER, "areaMu": int(round(rb.sum() * MU_PER_PX)), "polygons": reserve_polys},
        "units": units,
        "paddocks": paddocks,
        "water": water_pts,
        "homesteads": homesteads,
        "hq": hq,
        "stations": stations,
        "cameras": cameras,
    }
    (PAGE_DATA / "layout.json").write_text(json.dumps(layout, ensure_ascii=False, separators=(",", ":")))

    export_terrain(sb, dem_full)
    Image.fromarray(rgb).resize((SB_COLS * 2, SB_ROWS * 2), Image.LANCZOS).save(PUBLIC / "imagery.webp", quality=90)
    export_ndvi(cube)
    draw_plan(rgb, layout, DOCS / "plan-v1.png")
    tot = sum(p["areaMu"] for p in paddocks)
    print(f"高程 {dem.min():.1f}–{dem.max():.1f} m；分区 {len(paddocks)} 个，合计 {tot} 亩；保护带 {layout['reserve']['areaMu']} 亩；牧场 {layout['ranch']['areaMu']} 亩")
    print("单元面积（亩）：", {u["id"]: u["areaMu"] for u in units})


if __name__ == "__main__":
    main()

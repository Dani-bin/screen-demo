"""老家沙盘 · 场地数据生成（纯 Python，不依赖 Blender）。

把 draw_plan.py 里按卫星图描的地物（像素坐标）换算成米制场地数据，供
scripts/blender/hometown/ 在 Blender 里建模：
  scripts/blender/hometown/site.json      元数据、沙盘轮廓、房屋、树、路线、池塘水位
  scripts/blender/hometown/site_grid.npz  0.5 m 网格的地面高度（顶点）与地块分类（格子）
两个都是生成文件，不要手改。

坐标：x 向右、y 向上（= 卫星截图 satellite-outline-v2.webp 的右 / 上），单位米，
原点在截图像素 (830, 670)；z 为相对高度（沙盘里最低处约 0）。
图像"上"（+y）= 真方位 76.2°，太阳方向等真实方位要按这个换算。

地形做法：
  1. 高程数据（约 30 m 精度）插值到网格，竖向放大 1.5 倍，高斯平滑去掉网格感
  2. 田地顺着平滑地形走（不做梯田），田块交界处生成田埂（顶点权重 bank + 略抬高）
  3. 房屋和门前院坝整平成台地；厂区整平；公路大半径平滑；池塘下挖
运行：python3 scripts/hometown/build_site.py
"""

import json
import math
import os
import sys

import cv2
import numpy as np
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import draw_plan as P  # noqa: E402  地物数据都在这里

OUT_DIR = os.path.join(ROOT, "scripts", "blender", "hometown")
GEO = os.path.join(ROOT, "docs", "design", "hometown", "geo", "hometown_geo.json")

S = P.M_PER_PX          # 0.2165 m/px
ORIGIN = (830.0, 670.0)  # 米制原点对应的截图像素
G = 0.5                 # 网格边长（米）
EXAGGERATE = 1.5        # 竖向放大
# v2 截图像素 → 2017 截图像素（SIFT 配准求得的相似变换），用来查高程网格
V2_TO_2017 = np.array([[0.52748, -0.02363, -43.625],
                       [0.02363, 0.52748, -33.422]])
SEED = 20170727
HOME_SIDE_GAP = 2.4  # 我家两侧到邻居的最小间距（米）：0.5 挑檐 + 排水沟 + 过道

# 地块分类（格子值）
CLS = {"none": 0, "paddy": 1, "dry": 2, "veg": 3, "wood": 4, "pond": 5,
       "yard": 6, "factory": 7, "rubble": 8, "road": 9, "path": 10,
       "bund": 11, "house": 12}


def px2m(p):
    return ((p[0] - ORIGIN[0]) * S, (ORIGIN[1] - p[1]) * S)


def m2px(x, y):
    return (x / S + ORIGIN[0], ORIGIN[1] - y / S)


class Grid:
    """米制网格：格子 (row, col) 中心 = (x0 + (col+.5)G, y1 - (row+.5)G)。"""

    def __init__(self, x0, y0, x1, y1):
        self.x0, self.y1 = x0, y1
        self.nx = int(math.ceil((x1 - x0) / G))
        self.ny = int(math.ceil((y1 - y0) / G))

    def to_rc(self, pts_m):
        """米制点 → 网格坐标（cv2 用的 x=col, y=row，带 4 位小数精度）。"""
        a = np.array([((x - self.x0) / G, (self.y1 - y) / G) for x, y in pts_m])
        return np.round(a * 16).astype(np.int32)

    def mask(self, pts_px, dilate_m=0.0):
        m = np.zeros((self.ny, self.nx), np.uint8)
        pts = self.to_rc([px2m(p) for p in pts_px])
        cv2.fillPoly(m, [pts], 1, lineType=cv2.LINE_8, shift=4)
        if dilate_m > 0:
            k = int(round(dilate_m / G)) * 2 + 1
            m = cv2.dilate(m, np.ones((k, k), np.uint8))
        return m.astype(bool)

    def line(self, pts_px, width_m):
        m = np.zeros((self.ny, self.nx), np.uint8)
        pts = self.to_rc([px2m(p) for p in pts_px])
        th = max(1, int(round(width_m / G)))
        cv2.polylines(m, [pts], False, 1, thickness=th, lineType=cv2.LINE_8,
                      shift=4)
        return m.astype(bool)

    def centers(self):
        xs = self.x0 + (np.arange(self.nx) + 0.5) * G
        ys = self.y1 - (np.arange(self.ny) + 0.5) * G
        return np.meshgrid(xs, ys)


def dem_height(grid):
    """每个格子中心的高程（米，海拔）——双线性插值 2017 截图上的 32×27 网格。"""
    with open(GEO) as f:
        dem = json.load(f)["dem"]
    el = np.array(dem["elevation_m"], dtype=np.float64)  # (27, 32)，行 0 = 图像顶
    du, dv = dem["grid_spacing_px"]
    X, Y = grid.centers()
    px = X / S + ORIGIN[0]
    py = ORIGIN[1] - Y / S
    u = V2_TO_2017[0, 0] * px + V2_TO_2017[0, 1] * py + V2_TO_2017[0, 2]
    v = V2_TO_2017[1, 0] * px + V2_TO_2017[1, 1] * py + V2_TO_2017[1, 2]
    return ndimage.map_coordinates(el, [v / dv, u / du], order=1,
                                   mode="nearest")


def rect_fit(poly_m):
    """最小外接矩形 → (cx, cy, 长边, 短边, 长边方向角)，并按填充率缩小，保持面积。"""
    a = np.float32(poly_m)
    (cx, cy), (w, h), ang = cv2.minAreaRect(a)
    area = abs(cv2.contourArea(a))
    if w < h:
        w, h, ang = h, w, ang + 90
    fill = area / max(w * h, 1e-6)
    if fill < 0.8:  # L 形 / 不规则：等面积缩小，避免体量过大
        k = math.sqrt(max(fill, 0.45) / 0.85)
        w, h = w * k, h * k
    return cx, cy, w, h, math.radians(ang), area


def main():
    rng = np.random.default_rng(SEED)

    # ---------------- 沙盘范围：红线 ∪ 南边公路（路口一带也要上沙盘，回家路线从这里出发）
    outline_m = [px2m(p) for p in P.OUTLINE]
    xs = [p[0] for p in outline_m]
    ys = [p[1] for p in outline_m]
    grid = Grid(min(xs) - 6, min(ys) - 14, max(xs) + 6, max(ys) + 6)
    inside = grid.mask(P.OUTLINE)
    road = grid.mask(P.ROAD) | grid.mask(P.ROAD_BRANCH)
    X, Y = grid.centers()
    px_x = X / S + ORIGIN[0]
    road_keep = road & (px_x > 360) & (px_x < 1330)
    # 公路只取紧贴红线的那一段（往外不超过 9 m），做成沙盘南边的一条路
    near = ndimage.binary_dilation(inside, iterations=int(9 / G))
    slab = inside | (road_keep & near)
    if P.HD:
        slab = inside   # 高清图的抠图边界已经带着南边公路
    slab = ndimage.binary_closing(slab, iterations=4)
    slab = ndimage.binary_fill_holes(slab)

    # ---------------- 地块分类（后画的覆盖先画的）
    cls = np.where(slab, CLS["paddy"], CLS["none"]).astype(np.uint8)

    def paint(mask, name):
        cls[mask & slab] = CLS[name]

    for kind, pts in P.AREAS:
        if kind != "paddy":
            paint(grid.mask(pts), kind)
    if P.HD:
        # 高清卫星图逐像素分类（plan_hd.landcover）：每个 0.5 m 格子取中心像素；
        # 硬地在厂区范围（ZONES）里算厂区地面，其余算院坝；沙盘内没有分类的算稻田
        lc = P.HD.landcover()
        pxi = np.clip(np.round(X / S + ORIGIN[0]).astype(int), 0, lc.shape[1] - 1)
        pyi = np.clip(np.round(ORIGIN[1] - Y / S).astype(int), 0, lc.shape[0] - 1)
        v = lc[pyi, pxi]
        zone_px = np.zeros(lc.shape, np.uint8)
        for _, pts in P.ZONES:
            cv2.fillPoly(zone_px, [np.int32(pts)], 1)
        in_zone = zone_px[pyi, pxi] > 0
        L = P.HD.LC
        for k, name in ((L["wood"], "wood"), (L["paddy"], "paddy"),
                        (L["dry"], "dry"), (L["veg"], "veg"),
                        (L["pond"], "pond"), (L["road"], "road")):
            paint(v == k, name)
        paint((v == L["hard"]) & in_zone, "factory")
        paint((v == L["hard"]) & ~in_zone, "yard")
    else:
        paint(road, "road")
    route = grid.line(P.ROUTE, 2.2)
    for path in P.PATHS:
        paint(grid.line(path, 1.2), "path")
    paint(route, "path")

    # ---------------- 地形高度
    z = (dem_height(grid) - 321.8) * EXAGGERATE
    z = ndimage.gaussian_filter(z, sigma=8 / G)

    # 田地顺着平滑地形走（用户不要梯田）；田埂在后面按地块边界在顶点上生成
    field_k = [CLS["paddy"], CLS["dry"], CLS["veg"]]

    # 公路：大半径平滑，路面平顺
    zr = ndimage.gaussian_filter(z, sigma=12 / G)
    z = np.where(cls == CLS["road"], zr - 0.2, z)

    # 厂区整平
    fac = cls == CLS["factory"]
    for m in (fac | (cls == CLS["rubble"]),):
        if m.any():
            z[m] = np.median(z[m]) + 0.2

    # ---------------- 房屋：拟合矩形、分配类型、整平台地
    fac_mask_px = np.zeros((1282, 1704), np.uint8)
    for name_, pts_ in P.ZONES:
        if name_ != "气罐仓库":       # 气罐仓库里是普通砖瓦库房，不按厂棚建
            cv2.fillPoly(fac_mask_px, [np.int32(pts_)], 1)
    pig_zone = next(pts for name, pts in P.ZONES if name == "养猪场")
    pig_mask_px = np.zeros((1282, 1704), np.uint8)
    cv2.fillPoly(pig_mask_px, [np.int32(pig_zone)], 1)
    gy, gx = np.gradient(z, G)  # gy 沿行（向下 = -y）
    houses = []
    for i, (roof, pts) in enumerate(P.BUILDINGS):
        poly_m = [px2m(p) for p in pts]
        cx, cy, w, d, ang, area = rect_fit(poly_m)
        cpx = m2px(cx, cy)
        in_fac = fac_mask_px[int(cpx[1]), int(cpx[0])] > 0
        in_pig = pig_mask_px[int(cpx[1]), int(cpx[0])] > 0
        r = rng.random()
        if roof == "home":
            kind, storeys = "home", 3
        elif in_fac or in_pig:
            kind, storeys = "shed", 1
        elif roof == "blue":
            kind, storeys = "flat", 2
        elif roof == "white":
            kind, storeys = "flat", 3 if (area > 110 and r < 0.45) else 2
        elif roof in ("red", "brown"):
            kind, storeys = "tile", 2 if area > 95 else 1
        elif P.HD:  # 高清图里的深灰色屋顶大多是双坡青瓦
            kind, storeys = "tile", 2 if area > 110 else 1
        else:  # grey：小的是青瓦老屋，大的是平顶砖房
            kind, storeys = ("oldtile", 1) if area < 80 else ("flat", 2)
        if area < 40 and kind in ("flat", "tile"):
            storeys = 1                           # 小块屋顶是一层附屋 / 杂屋
        if not P.HD:
            # 旧截图上手描轮廓常把院坝一起圈进去：住宅体量按川北自建房常见尺寸封顶
            cap = {"flat": (15.0, 11.0), "tile": (14.0, 10.0),
                   "oldtile": (14.0, 9.0)}.get(kind)
            if cap:
                w, d = min(w, cap[0]), min(d, cap[1])
        # 正立面朝下坡方向：长边两个法向里选更接近下坡的那个
        rc = grid.to_rc([(cx, cy)])[0] / 16
        rr = int(np.clip(rc[1], 0, grid.ny - 1))
        cc = int(np.clip(rc[0], 0, grid.nx - 1))
        down = np.array([-gx[rr, cc], gy[rr, cc]])  # 下坡方向（米制 x, y）
        n1 = np.array([-math.sin(ang), math.cos(ang)])
        face = ang + math.pi / 2 if down @ n1 >= 0 else ang - math.pi / 2
        if roof == "home":
            # 用户确认：正面朝向约 180–190°（以卫星截图正上方为 0°、顺时针），取 188°，
            # 即朝画面下方略偏左；回家路线终点正好在房子正下方。
            # 正房 12 × 10 m 靠手描轮廓最里（上方）的一端，前面是地坝。
            face = math.radians(90 - P.HOME_BEARING)
            fdir = np.array([math.cos(face), math.sin(face)])
            ldir = np.array([-fdir[1], fdir[0]])
            P_ = np.array(poly_m)
            c_ = P_.mean(0)
            along = (P_ - c_) @ fdir
            lat_ = (P_ - c_) @ ldir
            cx, cy = c_ + fdir * (along.min() + 5.0) + \
                ldir * ((lat_.min() + lat_.max()) / 2)
            w, d = 12.0, 10.0
        # 台地：房屋 + 外扩 2.5 m（门前院坝）整平到周边中位高度
        foot = grid.mask(pts, dilate_m=0.6)
        pad = grid.mask(pts, dilate_m=2.5) & slab
        zp = float(np.median(z[pad])) + 0.25
        z[pad] = zp
        ring = pad & ~foot & np.isin(cls, [CLS["paddy"], CLS["dry"],
                                           CLS["veg"], CLS["bund"]])
        cls[ring] = CLS["yard"]
        cls[foot] = CLS["house"]
        wall = rng.choice(["white", "white", "white", "cream", "pink"]) \
            if kind == "flat" else "white"
        houses.append({
            "id": f"h{i:02d}", "kind": kind, "roof": roof,
            "cx": round(cx, 2), "cy": round(cy, 2), "w": round(w, 2),
            "d": round(d, 2), "face": round(face, 4), "z": round(zp, 2),
            "storeys": storeys, "wall": str(wall),
            "canopy": bool(roof == "blue" and kind == "flat"),
            "stair": bool(kind == "flat" and rng.random() < 0.6),
            "area": round(area, 1),
        })
    home = next(h for h in houses if h["kind"] == "home")
    # 门前地坝（围墙内 12.4 × 9 m，见 houses.py 的 YARD_W / YARD_D）：
    # 拟合出的邻居房屋轮廓若伸进地坝，沿我家正面方向往外推，直到不重叠
    hf_, hc_ = home["face"], np.array([home["cx"], home["cy"]])
    fwd = np.array([math.cos(hf_), math.sin(hf_)])
    lat = np.array([math.sin(hf_), -math.cos(hf_)])

    def in_yard(p):
        d = p - hc_
        return 4.8 < d @ fwd < 5 + 9.0 + 0.6 and abs(d @ lat) < 6.2 + 0.6

    for o in houses:
        if o is home:
            continue
        a_ = o["face"] + math.pi / 2
        ax_ = np.array([math.cos(a_), math.sin(a_)])
        ay_ = np.array([-math.sin(a_), math.cos(a_)])
        for _ in range(12):
            c_ = np.array([o["cx"], o["cy"]])
            hit = any(in_yard(c_ + ax_ * o["w"] * (i / 6 - 0.5)
                              + ay_ * o["d"] * (j / 6 - 0.5))
                      for i in range(7) for j in range(7))
            if not hit:
                break
            o["cx"] = round(o["cx"] + fwd[0] * 0.5, 2)
            o["cy"] = round(o["cy"] + fwd[1] * 0.5, 2)

    # 两侧邻居不能挨着我家（用户确认：中间隔一条排水沟）。我家局部坐标：x 向右（面对房子）、
    # 正立面 y = -5、后排偏屋到 y = 6.8；房子两侧各留 HOME_SIDE_GAP（挑檐 + 排水沟 + 过道），
    # 邻居若伸进来，沿我家左 / 右方向往外推；挪过的房子重新整平台地
    rgt = np.array([-math.sin(hf_), math.cos(hf_)])   # 局部 +x
    bck = -fwd                                        # 局部 +y（向房后）

    def corners(o):
        a_ = o["face"] + math.pi / 2
        ax_ = np.array([math.cos(a_), math.sin(a_)])
        ay_ = np.array([-math.sin(a_), math.cos(a_)])
        c_ = np.array([o["cx"], o["cy"]])
        return [c_ + ax_ * sx * o["w"] / 2 + ay_ * sy * o["d"] / 2
                for sx in (-1, 1) for sy in (-1, 1)]

    # 保护区（局部 x, ly）：正房 + 后排偏屋、右侧新修那栋、门前地坝，各外扩 HOME_SIDE_GAP。
    # 邻居房子轮廓（7×7 采样点）真的伸进保护区才沿左 / 右推开；我家挪到高清图真实位置后，
    # 前后方向上的邻居不再被误推（2026-10-13）
    G_ = HOME_SIDE_GAP
    keep_out = [(-6.0 - G_, 6.0 + G_, -5.0, 6.8 + 0.6),       # 正房 + 后排偏屋
                (6.0, 11.8 + G_, -7.6 - 0.6, 2.8 + 0.6),       # 新修那栋
                (-6.2 - G_, 6.2 + G_, -14.0 - 0.6, -5.0)]      # 门前地坝（围墙）

    def samples(o):
        a_ = o["face"] + math.pi / 2
        ax_ = np.array([math.cos(a_), math.sin(a_)])
        ay_ = np.array([-math.sin(a_), math.cos(a_)])
        c_ = np.array([o["cx"], o["cy"]])
        for i in range(7):
            for j in range(7):
                q = c_ + ax_ * o["w"] * (i / 6 - 0.5) + ay_ * o["d"] * (j / 6 - 0.5)
                yield (q - hc_) @ rgt, (q - hc_) @ bck

    def intrudes(o):
        return any(x0 < lx < x1 and y0 < ly < y1
                   for lx, ly in samples(o) for x0, x1, y0, y1 in keep_out)

    moved = []
    for o in houses:
        if o is home or not intrudes(o):
            continue
        side = 1 if np.mean([lx for lx, _ in samples(o)]) > 0 else -1
        for _ in range(40):                           # 每次往外挪 0.5 m，直到不再伸进保护区
            o["cx"] = round(o["cx"] + rgt[0] * side * 0.5, 2)
            o["cy"] = round(o["cy"] + rgt[1] * side * 0.5, 2)
            if not intrudes(o):
                break
        moved.append(o)
    for o in moved:
        q = np.array(corners(o))
        cen = q.mean(0)
        big = [cen + (p_ - cen) * (1 + 5.0 / max(o["w"], o["d"])) for p_ in q]
        order = [0, 1, 3, 2]                          # 四角按顺序连成多边形
        m_ = np.zeros((grid.ny, grid.nx), np.uint8)
        cv2.fillPoly(m_, [grid.to_rc([tuple(big[i]) for i in order])], 1,
                     lineType=cv2.LINE_8, shift=4)
        m_ = m_.astype(bool) & slab
        z[m_] = o["z"]
        cls[m_ & (cls != CLS["house"])] = CLS["yard"]

    # 我家门前的水泥地坝（照片里台阶直接落在院坝上）：只铺围墙以内（宽 12.4 m、深 9 m，含墙脚），
    # 整平到台地高度。用户确认"房子正面对着的围墙是挨着水田的"，围墙外不再多铺一圈水泥地
    fn = np.array([math.cos(home["face"]), math.sin(home["face"])])
    fl = np.array([-fn[1], fn[0]])
    c0 = np.array([home["cx"], home["cy"]]) + fn * 5.0   # 正房进深 10 m 的前墙线
    quad = [c0 + fl * 6.4, c0 - fl * 6.4, c0 - fl * 6.4 + fn * 9.3,
            c0 + fl * 6.4 + fn * 9.3]
    m = np.zeros((grid.ny, grid.nx), np.uint8)
    cv2.fillPoly(m, [grid.to_rc([tuple(q) for q in quad])], 1,
                 lineType=cv2.LINE_8, shift=4)
    m = m.astype(bool) & slab & (cls != CLS["house"])
    z[m] = home["z"]
    cls[m] = CLS["yard"]
    # 老房子右侧贴墙新修的那栋（houses.py 的 _extension：局部 x 6 → 11.8、y -7.6 → 2.8）：
    # 连同四周 0.6 m 整平到我家台地高度
    ext = [hc_ + rgt * lx + bck * ly for lx, ly in
           ((5.5, -8.2), (12.4, -8.2), (12.4, 3.4), (5.5, 3.4))]
    m = np.zeros((grid.ny, grid.nx), np.uint8)
    cv2.fillPoly(m, [grid.to_rc([tuple(q) for q in ext])], 1,
                 lineType=cv2.LINE_8, shift=4)
    m = m.astype(bool) & slab
    z[m] = home["z"]
    cls[m] = CLS["yard"]
    # 门前院坝（单独描的）整平到我家台地高度
    for kind, pts in P.AREAS:
        if kind == "yard":
            m = grid.mask(pts) & slab
            c = np.mean([px2m(p) for p in pts], axis=0)
            if math.hypot(c[0] - home["cx"], c[1] - home["cy"]) < 20:
                z[m] = home["z"]
            else:
                z[m] = float(np.median(z[m])) + 0.1

    # 池塘：下挖，水面比周边低 0.5 m
    pond = cls == CLS["pond"]
    ring = ndimage.binary_dilation(pond, iterations=3) & ~pond
    pond_water = float(np.min(z[ring])) - 0.5
    z[pond] = pond_water - 1.2

    # 小路：比两边略高一点，穿过梯田处顺着台阶做成坡
    pathm = cls == CLS["path"]
    zs = ndimage.gaussian_filter(z, sigma=1.5 / G)
    z[pathm] = np.maximum(zs[pathm], z[pathm]) + 0.08

    z = np.where(slab, z, np.nan)
    zmin = float(np.nanmin(z))
    z = z - zmin
    pond_water -= zmin

    # ---------------- 顶点高度：每个顶点取周围 4 个格子的平均（沙盘外的不算）
    zz = np.where(slab, z, 0.0)
    ww = slab.astype(np.float64)
    pad_z = np.pad(zz, 1)
    pad_w = np.pad(ww, 1)
    vs = (pad_z[:-1, :-1] + pad_z[1:, :-1] + pad_z[:-1, 1:] + pad_z[1:, 1:])
    vw = (pad_w[:-1, :-1] + pad_w[1:, :-1] + pad_w[:-1, 1:] + pad_w[1:, 1:])
    vz = np.where(vw > 0, vs / np.maximum(vw, 1), 0.0)
    # 田埂：田地与别的地块（另一种田、院坝、路、林地……）交界处的顶点，
    # 向两侧各扩一格成约 1 m 宽的带，再轻微模糊得到平滑的权重；
    # 权重在材质里把稻田贴图混成草埂，同时把这条带抬高 0.25 m
    cp = np.pad(np.where(slab, cls, 0), 1, mode="edge")
    corners = [cp[:-1, :-1], cp[1:, :-1], cp[:-1, 1:], cp[1:, 1:]]
    has_field = np.zeros(vz.shape, bool)
    mixed = np.zeros(vz.shape, bool)
    for c in corners:
        has_field |= np.isin(c, field_k)
        mixed |= c != corners[0]
    edge = has_field & mixed
    edge = ndimage.binary_dilation(edge, iterations=1)
    bank_w = ndimage.gaussian_filter(edge.astype(np.float32), 0.7)
    bank_w = np.clip(bank_w * 1.6, 0, 1)
    # 田块之间的田埂路（draw_plan.FIELD_BUNDS）：按顶点到折线的距离算权重，
    # 中线 = 1，1.3 m 外降到 0，边缘平滑，不受 0.5 m 网格锯齿影响
    S4 = 4  # 在 4 倍细的网格上画线再求距离
    fine = np.ones(((grid.ny + 1) * S4, (grid.nx + 1) * S4), np.uint8)
    for pts in P.FIELD_BUNDS:
        q = np.array([((px2m(p)[0] - grid.x0) / G * S4,
                       (grid.y1 - px2m(p)[1]) / G * S4) for p in pts])
        cv2.polylines(fine, [np.round(q * 16).astype(np.int32)], False, 0,
                      thickness=1, lineType=cv2.LINE_AA, shift=4)
    dist_m = cv2.distanceTransform(fine, cv2.DIST_L2, 5) / S4 * G
    dist_m = dist_m[::S4, ::S4][:vz.shape[0], :vz.shape[1]]
    inner = np.clip(1 - dist_m / 1.3, 0, 1)
    inner = inner * inner * (3 - 2 * inner)
    bank_w = np.maximum(bank_w, inner)
    vfield = np.zeros(vz.shape, bool)
    for c in corners:
        vfield |= np.isin(c, field_k)
    bank_w = np.where(vfield, bank_w, 0.0)
    vz = vz + bank_w * 0.25
    bund = edge

    # ---------------- 树：林地里泊松撒点（约 4 m 间距），靠房子的多竹丛
    wood = (cls == CLS["wood"])
    trees = []
    cand = np.argwhere(wood)
    rng.shuffle(cand)
    taken = np.zeros_like(wood)
    rad = int(4.0 / G)   # 树间距约 4 m（高清图林地面积大，树太密网页会卡）
    hx = np.array([h["cx"] for h in houses])
    hy = np.array([h["cy"] for h in houses])
    for r_, c_ in cand:
        if taken[r_, c_]:
            continue
        taken[max(0, r_ - rad):r_ + rad + 1, max(0, c_ - rad):c_ + rad + 1] = 1
        x = grid.x0 + (c_ + 0.5) * G + rng.uniform(-0.6, 0.6)
        y = grid.y1 - (r_ + 0.5) * G + rng.uniform(-0.6, 0.6)
        dist = np.min(np.hypot(hx - x, hy - y)) if len(hx) else 99
        u = rng.random()
        if dist < 14 and u < 0.45:
            sp = "bamboo"
        elif y > 40 and u < 0.55:
            sp = "cypress"  # 北坡多柏木
        elif u < 0.3:
            sp = "cypress"
        else:
            sp = "broad"
        trees.append([sp, round(float(x), 2), round(float(y), 2),
                      round(float(z[r_, c_]), 2),
                      round(float(rng.uniform(0.8, 1.25)), 2),
                      round(float(rng.uniform(0, 6.283)), 2)])
    # 我家门前不种树：正立面前方 25 m、左右各 10 m 是院坝和田，照片机位要看得到房子
    hf = home["face"]
    fx, fy = math.cos(hf), math.sin(hf)          # 正立面外法线
    lx, ly = math.sin(hf), -math.cos(hf)         # 站在门前面对房子时的左手方向

    def in_front(x, y):
        dx, dy = x - home["cx"], y - home["cy"]
        along = dx * fx + dy * fy
        side = dx * lx + dy * ly
        return home["d"] / 2 < along < 25 and abs(side) < 10

    trees = [t for t in trees if not in_front(t[1], t[2])]

    # 房子两侧 18 m 内不种树（用户不要右侧的竹丛 / 树），只保留房后的林子和枇杷树
    def beside(x, y):
        dx, dy = x - home["cx"], y - home["cy"]
        along = dx * fx + dy * fy
        return along > -4 and math.hypot(dx, dy) < 18

    trees = [t for t in trees if not beside(t[1], t[2])]
    # 枇杷树：地坝左右两侧靠围墙各 3 棵（用户手绘）。房屋局部坐标：
    # x 向右（面对房子看）、y 向房子后方，前墙线 y = -5，地坝深 10 m、宽 12.4 m
    def home_xy(lx_, ly_):
        rx, ry = -fy, fx            # 局部 +x：面对房子时的右手方向
        bx, by = -fx, -fy           # 局部 +y：指向房子后方
        return (home["cx"] + rx * lx_ + bx * ly_,
                home["cy"] + ry * lx_ + by * ly_)

    for lx_, ly_ in ((-4.9, -6.9), (-4.9, -10.0), (-4.9, -12.9),
                     (4.9, -8.9), (4.9, -10.9), (4.9, -12.9)):
        x, y = home_xy(lx_, ly_)
        trees.append(["loquat", round(x, 2), round(y, 2), home["z"],
                      round(float(rng.uniform(0.62, 0.75)), 2),
                      round(float(rng.uniform(0, 6.283)), 2)])

    # ---------------- 路线（回家路线，带高度，用于镜头 / 动画）
    def drape(pts_px):
        out = []
        for p in pts_px:
            x, y = px2m(p)
            rc = grid.to_rc([(x, y)])[0] / 16
            rr = int(np.clip(rc[1], 0, grid.ny - 1))
            cc = int(np.clip(rc[0], 0, grid.nx - 1))
            zz_ = z[rr, cc]
            out.append([round(x, 2), round(y, 2),
                        round(float(0 if np.isnan(zz_) else zz_), 2)])
        return out

    def route_to_gate(r):
        """回家路线最后接到地坝铁门（houses.py：门中心 x = 1.8、前墙往里凹 1 m）。
        先去掉落在房子 / 地坝（外扩 2 m）里的点，再从地坝右前角外侧绕到门外，进门、走到台阶前。"""
        fwd = np.array([math.cos(home["face"]), math.sin(home["face"])])
        rgt = np.array([-math.sin(home["face"]), math.cos(home["face"])])
        c = np.array([home["cx"], home["cy"]])
        zz_ = home["z"]

        def inside(q):
            d_ = np.array(q[:2]) - c
            return -7 < d_ @ fwd < 5 + 9.0 + 2 and abs(d_ @ rgt) < 6.2 + 2

        k = next((i for i, q in enumerate(r) if inside(q)), len(r))
        r = r[:k]
        # draw_plan.ROUTE 按用户画的红线走到地坝前墙外（穿过右侧两户人家的地坝），这里只接进门
        for f_, x_ in ((5 + 9.0 + 1.5, 1.8),
                       (5 + 9.0 - 1.0, 1.8), (5 + 4.0, 0.6), (5 + 2.0, 0.0)):
            p = c + fwd * f_ + rgt * x_
            r.append([round(float(p[0]), 2), round(float(p[1]), 2), zz_])
        return r

    # ---------------- 沙盘轮廓（米制多边形，逆时针）
    cs, _ = cv2.findContours(slab.astype(np.uint8), cv2.RETR_EXTERNAL,
                             cv2.CHAIN_APPROX_NONE)
    c = max(cs, key=cv2.contourArea)
    c = cv2.approxPolyDP(c, 0.8, True).reshape(-1, 2)
    slab_m = [[round(grid.x0 + cc_ * G, 2), round(grid.y1 - rr_ * G, 2)]
              for cc_, rr_ in c]

    meta_route_cache[:] = route_to_gate(drape(P.ROUTE))
    write_page_data(meta_page(grid, home, houses, drape, slab_m, pond_water))
    write_satellite()
    os.makedirs(OUT_DIR, exist_ok=True)
    np.savez_compressed(os.path.join(OUT_DIR, "site_grid.npz"),
                        vz=vz.astype(np.float32), cls=cls,
                        bank=bank_w.astype(np.float16),
                        slab=slab.astype(np.uint8))
    meta = {
        "note": "由 scripts/hometown/build_site.py 生成，不要手改",
        "grid": {"x0": grid.x0, "y1": grid.y1, "g": G, "nx": grid.nx,
                 "ny": grid.ny},
        "classes": CLS,
        "up_azimuth": P.UP_AZIMUTH,
        "z_offset_asl": round(321.8 + zmin / EXAGGERATE, 2),
        "exaggerate": EXAGGERATE,
        "slab": slab_m,
        "pond_water": round(pond_water, 2),
        "houses": houses,
        "trees": trees,
        "route": meta_route_cache,
        "labels": {"home": [home["cx"], home["cy"], home["z"]]},
    }
    with open(os.path.join(OUT_DIR, "site.json"), "w") as f:
        json.dump(meta, f, ensure_ascii=False)
    kinds = {}
    for h in houses:
        kinds[h["kind"]] = kinds.get(h["kind"], 0) + 1
    print(f"网格 {grid.nx}×{grid.ny}（{G} m），沙盘 {slab.sum() * G * G / 1e4:.2f} ha，"
          f"高差 {np.nanmax(z):.1f} m，房屋 {len(houses)} {kinds}，树 {len(trees)}，"
          f"田埂顶点 {int(bund.sum())}，池塘水位 {pond_water:.2f}")


# ---------------------------------------------------------------- 网页数据
PAGE_DATA = os.path.join(ROOT, "src", "views", "hometown", "data", "site.json")
SAT_OUT = os.path.join(ROOT, "public", "hometown", "satellite.webp")


def to3(x, y, z=0.0):
    """Blender 场地坐标 → three.js（glTF Y 轴向上）：(x, z, -y)，保留 2 位小数。"""
    return [round(float(x), 2), round(float(z), 2), round(float(-y), 2)]


def meta_page(grid, home, houses, drape, slab_m, pond_water):
    """页面用的数据（three.js 坐标）：回家路线、路线节点、地点标注锚点、我家位置朝向、
    俯视贴图范围、开场卫星图四角、沙盘轮廓。"""
    xs = [p[0] for p in slab_m]
    ys = [p[1] for p in slab_m]
    frame = [min(xs) - 2, min(ys) - 2, max(xs) + 2, max(ys) + 2]
    route = [to3(*q) for q in meta_route_cache]

    def nearest(pxy):
        x, y = px2m(pxy)
        return min(range(len(route)),
                   key=lambda i: (route[i][0] - x) ** 2 + (route[i][2] + y) ** 2)

    def at(pxy, h):
        x, y = px2m(pxy)
        q = drape([pxy])[0]
        return to3(x, y, q[2] + h)

    # 回家路线节点（与设计稿 drafts-v2.html 一致）：公路路口、小工厂边、大田田埂、地坝铁门
    nodes = [0, nearest((1065, 830)), nearest((985, 580)), len(route) - 3]
    places = [
        {"key": "pond", "name": "池塘", "pos": to3(*px2m((508, 360)), pond_water + 2)},
        {"key": "field", "name": "大田", "pos": at((760, 860), 4)},
        {"key": "recycle", "name": "垃圾回收站", "pos": at((1150, 620), 12)},
        {"key": "pig", "name": "养猪场", "pos": at((1365, 560), 8)},
        {"key": "factory", "name": "小工厂", "pos": at((1250, 812), 8)},
        {"key": "gas", "name": "气罐仓库", "pos": at((355, 990), 10)},
    ]
    corners = [to3(*px2m(p), 0) for p in ((0, 0), (1704, 0), (1704, 1282),
                                         (0, 1282))]
    return {
        "note": "由 scripts/hometown/build_site.py 生成，不要手改（three.js 坐标，米）",
        "frame": [round(v, 2) for v in frame],
        "home": {"pos": to3(home["cx"], home["cy"], home["z"]),
                 "face": round(home["face"], 4)},
        "route": route,
        "nodes": nodes,
        "places": places,
        "satellite": corners,
        "slab": [to3(x, y, 0) for x, y in slab_m],
    }


meta_route_cache = []


def write_page_data(d):
    os.makedirs(os.path.dirname(PAGE_DATA), exist_ok=True)
    with open(PAGE_DATA, "w") as f:
        json.dump(d, f, ensure_ascii=False)


def write_satellite():
    """开场用的卫星图：截图上手画的红线（范围）、蓝线（回家路线）用 inpaint 抹掉，缩到 1600 宽。"""
    img = cv2.imread(os.path.join(ROOT, "docs", "design", "hometown",
                                  "satellite-outline-v2.webp"))
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    red = cv2.inRange(hsv, (0, 120, 120), (8, 255, 255)) | \
        cv2.inRange(hsv, (170, 120, 120), (180, 255, 255))
    blue = cv2.inRange(hsv, (95, 150, 150), (115, 255, 255))
    mask = cv2.dilate(red | blue, np.ones((7, 7), np.uint8))
    out = cv2.inpaint(img, mask, 6, cv2.INPAINT_TELEA)
    out = cv2.resize(out, (1600, round(1600 * img.shape[0] / img.shape[1])),
                     interpolation=cv2.INTER_AREA)
    os.makedirs(os.path.dirname(SAT_OUT), exist_ok=True)
    cv2.imwrite(SAT_OUT, out, [cv2.IMWRITE_WEBP_QUALITY, 85])


if __name__ == "__main__":
    main()

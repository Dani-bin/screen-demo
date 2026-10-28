"""
智慧港口（洋山四期）：公开数据 → 页面底图
----------------------------------------------------------
输入：fetch_data.py 下载到 models/smart-port/raw/ 的 Sentinel-2、GLO-30、WorldCover。
输出（页面用，生成文件不要手改）：
  public/smart-port/context.webp      周边真彩色底图（10 m，Sentinel-2 晴空中值合成），按岸线坐标系 u / v 重采样
  public/smart-port/context_h.png     周边高程（16 位拆成 R 高字节 / G 低字节，单位 0.01 m，从 -10 m 起算），只有岛屿有起伏
  public/smart-port/context_mask.png  陆地掩膜（R：255 = 陆地，按 WorldCover 2021）
  src/views/smart-port/data/context.json  底图范围、像素尺寸、坐标换算
  src/views/smart-port/data/site.json     OSM 矢量换成 u / v：四期码头面轮廓、东海大桥 / 颗珠山大桥、港区建筑
另存一张带网格的预览 models/smart-port/render/context_preview.png（git 忽略），核对周边地物位置用。

码头本体（OSM 四期码头面）以内由三维建模覆盖，底图在那里只是垫底，不显示细节。
屏上不得表示水深：海面统一着色，不使用任何水深数据。

用法：python3 scripts/smart-port/prepare.py   （需要 numpy、Pillow、scipy）
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import binary_closing, binary_opening, gaussian_filter, map_coordinates

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "models" / "smart-port" / "raw"
RENDER = ROOT / "models" / "smart-port" / "render"
PUBLIC = ROOT / "public" / "smart-port"
DATA = ROOT / "src" / "views" / "smart-port" / "data"

layout = json.loads((DATA / "layout.json").read_text())
grid = json.loads((RAW / "grid.json").read_text())

# 底图范围（u / v，米）：西到东海大桥落地处以西，东到小洋山一至三期，南北各留一圈海面
U_RANGE = (-3200.0, 6800.0)
V_RANGE = (-3600.0, 2600.0)
PIXEL = 10.0  # 与 Sentinel-2 原生分辨率一致，不做超分
DECK_H = 6.5  # 码头面高出海面（米，假设；三维里 PortScene 用同一个值）

# Sentinel-2 合成：取晴空像素占比最高的若干天，逐像素取中值（去掉过往船只和薄云）
N_BEST = 18
SCL_CLEAR = (4, 5, 6)


def uv_to_grid(u, v):
    """岸线坐标 (u, v) → 下载网格的 (行, 列)（浮点）"""
    lat0, lon0 = grid["center"]
    k = 111320 * np.cos(np.radians(lat0))
    ox = (layout["origin"]["lon"] - lon0) * k
    oy = (layout["origin"]["lat"] - lat0) * 111320
    b = np.radians(layout["origin"]["uBearing"])
    ue = np.array([np.sin(b), np.cos(b)])  # u 轴在 (东, 北) 里的方向
    ve = np.array([np.sin(b - np.pi / 2), np.cos(b - np.pi / 2)])  # v 轴：u 逆时针转 90°（指向陆地）
    x = ox + u * ue[0] + v * ve[0]
    y = oy + u * ue[1] + v * ve[1]
    col = (x + grid["size"][0] / 2) / grid["pixel"] - 0.5
    row = (grid["size"][1] / 2 - y) / grid["pixel"] - 0.5
    return row, col


def lonlat_to_uv(lon, lat):
    """经纬度 → 岸线坐标 (u, v)（局部等距近似，范围几公里内误差可忽略）"""
    o = layout["origin"]
    k = 111320 * np.cos(np.radians(o["lat"]))
    x = (np.asarray(lon) - o["lon"]) * k
    y = (np.asarray(lat) - o["lat"]) * 111320
    b = np.radians(o["uBearing"])
    u = x * np.sin(b) + y * np.cos(b)
    v = x * np.sin(b - np.pi / 2) + y * np.cos(b - np.pi / 2)
    return u, v


def site_vectors():
    """从 OSM 取三维要用的矢量：码头面轮廓、桥、建筑（只取底图范围内的）"""
    osm = json.loads((RAW / "osm.json").read_text())
    out = {"note": "由 scripts/smart-port/prepare.py 从 OpenStreetMap 生成（© OpenStreetMap contributors, ODbL），不要手改", "terminal": None, "bridges": [], "buildings": [], "roads": []}

    def pts(e):
        u, v = lonlat_to_uv([p["lon"] for p in e["geometry"]], [p["lat"] for p in e["geometry"]])
        return [[round(float(a), 1), round(float(b), 1)] for a, b in zip(u, v)]

    inside = lambda P: any(U_RANGE[0] <= a <= U_RANGE[1] and V_RANGE[0] <= b <= V_RANGE[1] for a, b in P)  # noqa: E731
    for e in osm["elements"]:
        if e["type"] != "way" or "geometry" not in e:
            continue
        t = e.get("tags", {})
        P = pts(e)
        if not inside(P):
            continue
        if e["id"] == 822111020:
            out["terminal"] = P
        elif t.get("highway") == "motorway" and t.get("name") in ("东海大桥",) or t.get("man_made") == "bridge":
            out["bridges"].append({"id": e["id"], "name": t.get("name", ""), "kind": "deck" if "highway" in t else "outline", "pts": P})
        elif "building" in t:
            out["buildings"].append({"id": e["id"], "pts": P, "levels": t.get("building:levels")})
        elif t.get("highway") in ("motorway", "motorway_link", "secondary", "secondary_link", "tertiary", "unclassified", "service"):
            out["roads"].append({"id": e["id"], "name": t.get("name", ""), "kind": t["highway"], "pts": P})
    return out


def composite():
    """晴空中值合成，返回 (H, W, 3) 反射率和逐像素有效天数"""
    days = []
    for meta in sorted((RAW / "s2").glob("20??-??-??.json")):
        m = json.loads(meta.read_text())
        npz = meta.with_suffix(".npz")
        if m.get("skipped") or not npz.exists():
            continue
        days.append((m["clear"], meta.stem, m, npz))
    days.sort(reverse=True)
    days = days[:N_BEST]
    print(f"合成：取 {len(days)} 天", ", ".join(d[1] for d in days))
    stack = []
    for _, day, m, npz in days:
        z = np.load(npz)
        # 处理基线 04.00 起反射率带 -1000 偏移；Earth Search 记录了是否已扣除
        off = 0 if all(m["boaOffsetApplied"]) else 1000
        rgb = np.stack([z[b].astype(np.float32) - off for b in ("red", "green", "blue")], -1) / 10000.0
        ok = np.isin(z["scl"], SCL_CLEAR)
        rgb[~ok] = np.nan
        stack.append(rgb)
    stack = np.stack(stack)
    valid = np.isfinite(stack[..., 0]).sum(0)
    med = np.nanmedian(stack, axis=0)
    # 没有任何晴空像素的地方用全部日期的中值补
    hole = ~np.isfinite(med[..., 0])
    if hole.any():
        med[hole] = 0.06
    return med, valid


def main():
    RENDER.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    med, _ = composite()
    dem = np.load(RAW / "dem.npy")
    wc = np.load(RAW / "worldcover.npy")

    us = np.arange(U_RANGE[0] + PIXEL / 2, U_RANGE[1], PIXEL)
    vs = np.arange(V_RANGE[1] - PIXEL / 2, V_RANGE[0], -PIXEL)  # 图像从上到下 v 递减（陆地在上）
    UU, VV = np.meshgrid(us, vs)
    row, col = uv_to_grid(UU, VV)
    sample = lambda a, order=1: map_coordinates(a, [row, col], order=order, mode="nearest")  # noqa: E731
    rgb = np.stack([sample(med[..., c]) for c in range(3)], -1)
    h = sample(dem)
    land = sample((wc != 80).astype(np.float32) * (wc != 0), order=0) > 0.5
    # 海陆只看 WorldCover 2021（四期 2017 年、一至三期更早已建成，都在里面）。
    # 不能用影像亮度补判：长江口外的浑水反射率和陆地差不多，会把整片海当成陆地
    land = binary_opening(binary_closing(land, iterations=2), iterations=1)
    # 码头面以内（三维建模覆盖）和泊位前沿水域不画底图：影像里靠泊的船会被 WorldCover 判成陆地，在海上留下斑块
    site_osm = json.loads((RAW / "osm.json").read_text())
    term = next(e for e in site_osm["elements"] if e.get("id") == 822111020)
    tu, tv = lonlat_to_uv([p["lon"] for p in term["geometry"]], [p["lat"] for p in term["geometry"]])
    cut = Image.new("L", (len(us), len(vs)), 0)
    cd = ImageDraw.Draw(cut)
    to_px = lambda u, v: ((u - U_RANGE[0]) / PIXEL, (V_RANGE[1] - v) / PIXEL)  # noqa: E731
    cd.polygon([to_px(a, b) for a, b in zip(tu, tv)], fill=255)
    cd.rectangle([to_px(-150, 10), to_px(2500, -180)], fill=255)
    land &= np.array(cut) < 128
    # GLO-30 是含地物的表面高程：码头上的箱堆、岸桥会被当成起伏。只在有植被的山坡（WorldCover 林地 / 灌丛 / 草地 / 耕地）
    # 保留高程，其余陆地压平到码头面高度（DECK_H），岛上的山才有形
    cls = sample(wc.astype(np.float32), order=0)
    veg = np.isin(cls, (10, 20, 30, 40))
    h = np.where(land, np.where(veg, np.maximum(h, DECK_H), DECK_H), 0.0)
    h = gaussian_filter(h, 0.8)

    # 真彩色：轻度拉伸，保留真实色相（底图会在三维里再按主题压暗 / 去饱和）
    img = np.clip((rgb / 0.22) ** (1 / 1.5), 0, 1)
    Image.fromarray((img * 255).astype(np.uint8)).save(PUBLIC / "context.webp", quality=88, method=6)
    # 高程：0.01 m 一档，从 -10 m 起算，拆成两个字节
    q = np.clip(np.round((h + 10) * 100), 0, 65535).astype(np.uint16)
    hb = np.zeros((*q.shape, 3), np.uint8)
    hb[..., 0] = q >> 8
    hb[..., 1] = q & 255
    Image.fromarray(hb).save(PUBLIC / "context_h.png", optimize=True)
    mk = np.zeros((*land.shape, 3), np.uint8)
    mk[..., 0] = land * 255
    Image.fromarray(mk).save(PUBLIC / "context_mask.png", optimize=True)

    meta = {
        "note": "由 scripts/smart-port/prepare.py 生成，不要手改",
        "u": U_RANGE,
        "v": V_RANGE,
        "pixel": PIXEL,
        "width": len(us),
        "height": len(vs),
        "heightEncoding": "R*256+G = (h + 10) * 100",
        "maxHeight": float(h.max()),
        "attribution": "Contains modified Copernicus Sentinel data 2024–2026; Copernicus DEM GLO-30 © DLR e.V. 2010–2014 and © Airbus 2014–2018 provided under COPERNICUS by the European Union and ESA; ESA WorldCover 2021",
    }
    (DATA / "context.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n")
    site = site_vectors()
    (DATA / "site.json").write_text(json.dumps(site, ensure_ascii=False) + "\n")
    print(f"site.json：码头面 {len(site['terminal'] or [])} 点，桥 {len(site['bridges'])} 条，建筑 {len(site['buildings'])} 栋，道路 {len(site['roads'])} 条")

    # 预览：500 m 网格 + 码头分带
    pv = Image.fromarray((img * 255).astype(np.uint8))
    d = ImageDraw.Draw(pv)
    px = lambda u, v: ((u - U_RANGE[0]) / PIXEL, (V_RANGE[1] - v) / PIXEL)  # noqa: E731
    for u in range(int(U_RANGE[0]) // 500 * 500, int(U_RANGE[1]) + 1, 500):
        d.line([px(u, V_RANGE[0]), px(u, V_RANGE[1])], fill=(255, 255, 255) if u % 1000 == 0 else (120, 120, 120))
        if u % 1000 == 0:
            d.text(px(u + 20, V_RANGE[1] - 60), str(u), fill=(255, 255, 0))
    for v in range(int(V_RANGE[0]) // 500 * 500, int(V_RANGE[1]) + 1, 500):
        d.line([px(U_RANGE[0], v), px(U_RANGE[1], v)], fill=(255, 255, 255) if v % 1000 == 0 else (120, 120, 120))
        if v % 1000 == 0:
            d.text(px(U_RANGE[0] + 20, v + 80), str(v), fill=(255, 255, 0))
    q0, q1 = layout["quay"]["u0"], layout["quay"]["u1"]
    d.line([px(q0, 0), px(q1, 0)], fill=(255, 0, 0), width=2)
    for b in layout["blocks"]:
        d.rectangle([px(b["u"] - 15, b["v1"]), px(b["u"] + 15, b["v0"])], outline=(0, 255, 255))
    pv.save(RENDER / "context_preview.png")
    print(f"底图 {len(us)}×{len(vs)}，最高 {h.max():.0f} m；预览 {RENDER / 'context_preview.png'}")


if __name__ == "__main__":
    main()

"""
West Elk 煤矿（美国科罗拉多州 Somerset）地形数据下载
----------------------------------------------------------
从 USGS 公有领域数据服务按范围导出：
  - 高程：3DEP Bare Earth DEM（激光雷达，原始 1 m），float32 GeoTIFF
  - 影像：NAIP 航拍正射影像（原始 0.3 m），JPEG，单次最多 4000 px，超出时分块拼接

两种数据都用 WGS84 / UTM 13N（EPSG:32613）米坐标导出，像素是正方形、正北朝上。
下载结果放在 git 忽略的 models/smart-mine/raw/，已存在的文件跳过。

用法：python scripts/smart-mine/fetch_data.py [overview|closeup ...]（默认全部）
需要 numpy、Pillow；在 Claude 沙箱里联网要放到沙箱外运行。
"""

import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "models" / "smart-mine" / "raw"

DEM_URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
NAIP_URL = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage"
SR = 32613  # WGS84 / UTM 13N
NAIP_MAX = 2000  # NAIP 分块边长（服务上限 4000，但大块经常网关超时）

# 工业广场（选煤厂 + 装车站）中心，GEM 矿山库坐标，已在 NAIP 影像上核对
PLANT = (38.9267, -107.4436)

# 范围：中心经纬度 + 东西 / 南北尺寸（米）+ 高程 / 影像像素尺寸（米 / 像素）
BLOCKS = {
    # 沙盘全景：工业广场在北侧河谷，南面是井田所在的山地
    "overview": {"center": (38.905, -107.45), "size": (12000, 10000), "dem": 4.0, "img": 1.5},
    # 工业广场近景：检查拉近后的清晰度
    "closeup": {"center": PLANT, "size": (3000, 2000), "dem": 1.0, "img": 0.5},
}


def utm_forward(lat, lon, zone=13):
    """WGS84 经纬度 → UTM 北半球米坐标（标准横轴墨卡托级数，精度优于 1 mm）"""
    a, f, k0 = 6378137.0, 1 / 298.257223563, 0.9996
    e2 = f * (2 - f)
    ep2 = e2 / (1 - e2)
    phi, lam = math.radians(lat), math.radians(lon)
    lam0 = math.radians(zone * 6 - 183)
    n = a / math.sqrt(1 - e2 * math.sin(phi) ** 2)
    t = math.tan(phi) ** 2
    c = ep2 * math.cos(phi) ** 2
    aa = math.cos(phi) * (lam - lam0)
    # 子午线弧长
    m = a * (
        (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256) * phi
        - (3 * e2 / 8 + 3 * e2**2 / 32 + 45 * e2**3 / 1024) * math.sin(2 * phi)
        + (15 * e2**2 / 256 + 45 * e2**3 / 1024) * math.sin(4 * phi)
        - (35 * e2**3 / 3072) * math.sin(6 * phi)
    )
    x = k0 * n * (
        aa + (1 - t + c) * aa**3 / 6 + (5 - 18 * t + t**2 + 72 * c - 58 * ep2) * aa**5 / 120
    )
    y = k0 * (
        m
        + n
        * math.tan(phi)
        * (
            aa**2 / 2
            + (5 - t + 9 * c + 4 * c**2) * aa**4 / 24
            + (61 - 58 * t + t**2 + 600 * c - 330 * ep2) * aa**6 / 720
        )
    )
    return x + 500000.0, y


def block_bbox(b):
    """范围中心取整到 10 m，返回 (xmin, ymin, xmax, ymax)"""
    cx, cy = utm_forward(*b["center"])
    cx, cy = round(cx / 10) * 10, round(cy / 10) * 10
    w, h = b["size"]
    return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)


def export(url, bbox, px, py, **extra):
    q = {
        "bbox": ",".join(f"{v:.2f}" for v in bbox),
        "bboxSR": SR,
        "imageSR": SR,
        "size": f"{px},{py}",
        "interpolation": "RSP_BilinearInterpolation",
        "f": "image",
        **extra,
    }
    full = url + "?" + urllib.parse.urlencode(q)
    # 服务偶尔 504，重试几次
    for attempt in range(5):
        try:
            with urllib.request.urlopen(full, timeout=300) as r:
                data = r.read()
            break
        except urllib.error.HTTPError as e:
            if attempt == 4 or e.code < 500:
                raise
            print(f"  HTTP {e.code}，重试")
            time.sleep(3 + attempt * 3)
    if data[:1] == b"{":
        raise RuntimeError(data[:300].decode("utf8", "replace"))
    return data


def fetch_dem(name, bbox, res):
    out = RAW / f"{name}_dem.npy"
    if out.exists():
        print("跳过", out.name)
        return
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    px, py = round(w / res), round(h / res)
    data = export(DEM_URL, bbox, px, py, format="tiff", pixelType="F32", noData=-9999)
    a = np.array(Image.open(BytesIO(data)), dtype=np.float32)
    if (a < -1000).any():
        print("  警告：有无数据像元", int((a < -1000).sum()))
    np.save(out, a)
    print(f"{out.name}: {px}×{py}，高程 {a.min():.0f}–{a.max():.0f} m")


def fetch_naip(name, bbox, res):
    out = RAW / f"{name}_naip.jpg"
    if out.exists():
        print("跳过", out.name)
        return
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    px, py = round(w / res), round(h / res)
    nx, ny = math.ceil(px / NAIP_MAX), math.ceil(py / NAIP_MAX)
    canvas = Image.new("RGB", (px, py))
    # 按像素边界切块，块边界换算回米坐标，保证拼接处严丝合缝
    xs = [round(i * px / nx) for i in range(nx + 1)]
    ys = [round(j * py / ny) for j in range(ny + 1)]
    for j in range(ny):
        for i in range(nx):
            x0, x1, y0, y1 = xs[i], xs[i + 1], ys[j], ys[j + 1]
            sub = (
                bbox[0] + x0 * res,
                bbox[3] - y1 * res,  # 图像行从北往南，米坐标从南往北
                bbox[0] + x1 * res,
                bbox[3] - y0 * res,
            )
            data = export(NAIP_URL, sub, x1 - x0, y1 - y0, format="jpg", compressionQuality=92)
            canvas.paste(Image.open(BytesIO(data)).convert("RGB"), (x0, y0))
            print(f"  影像块 {j * nx + i + 1}/{nx * ny}")
    canvas.save(out, quality=93)
    print(f"{out.name}: {px}×{py}")


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    names = sys.argv[1:] or list(BLOCKS)
    meta_path = RAW / "blocks.json"
    meta = json.loads(meta_path.read_text("utf8")) if meta_path.exists() else {}
    for name in names:
        b = BLOCKS[name]
        bbox = block_bbox(b)
        print(f"== {name}  UTM13N {bbox}")
        fetch_dem(name, bbox, b["dem"])
        fetch_naip(name, bbox, b["img"])
        meta[name] = {"bbox": bbox, "dem_res": b["dem"], "img_res": b["img"], "epsg": SR}
    meta["plant_utm"] = utm_forward(*PLANT)
    meta_path.write_text(json.dumps(meta, indent=2), "utf8")


if __name__ == "__main__":
    main()

"""
West Elk 煤矿：设计稿渲染数据准备
----------------------------------------------------------
读 fetch_data.py 下载的高程 / 影像（models/smart-mine/raw/），输出到 git 忽略的 models/smart-mine/render/：
  - overview_h.bin / closeup_h.bin：float32 高程网格（行从北到南，列从西到东，含四边顶点）
  - overview_tex.jpg / closeup_tex.jpg：正射影像贴图
  - layout.json：煤层、地层、井下巷道 / 工作面、地面钻孔与设施（局部米坐标）
以上供设计稿 docs/design/smart-mine/ 使用；同时导出 /smart-mine 页面用的数据（提交入库）：
  - public/smart-mine/overview_h.png / closeup_h.png：高程网格，16 位整数拆成 R（高字节）+ G（低字节）
    的无损 PNG，海拔 = (R × 256 + G) / H_SCALE + H_OFFSET
  - public/smart-mine/overview.webp（4096 px，约 2.9 m / 像素）/ closeup.webp（6000 px，0.5 m / 像素）
  - src/views/smart-mine/data/layout.json：同 layout.json，去掉页面不用的钻场识别全集

局部坐标：原点 = 全景范围中心（UTM 13N），x 向东、y 向北，单位米；高程为海拔米。

真实的部分：地形、影像、工业广场 / 主平硐 / 回风井位置（影像判读）、钻场位置（影像自动识别）、
地层顺序与煤层名（USGS PP 1625-B、科罗拉多地调局 RS-36）、地层倾角。
示意的部分：各层厚度与间距、工作面编号 / 尺寸 / 走向（按钻场成排的方向推断）、开采进度、传感器与人员。

用法：python scripts/smart-mine/prepare.py
"""

import json
import math
import shutil
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "models" / "smart-mine" / "raw"
OUT = ROOT / "models" / "smart-mine" / "render"
PUBLIC = ROOT / "public" / "smart-mine"
PAGE_DATA = ROOT / "src" / "views" / "smart-mine" / "data"
# 页面高程编码：5 cm 一级，最低 1500 m（全景最低处约 1785 m，最高约 2758 m，编码最大约 25200）
H_OFFSET = 1500.0
H_SCALE = 20.0
PAGE_TEX = {"overview": 4096, "closeup": 6000}

META = json.loads((RAW / "blocks.json").read_text("utf8"))
OV = META["overview"]["bbox"]
CX, CY = (OV[0] + OV[2]) / 2, (OV[1] + OV[3]) / 2


def to_local(e, n):
    return e - CX, n - CY


# ---------------- 高程网格 ----------------


def resample_dem(name, step):
    """把 DEM（像元中心）重采样到含四边的顶点网格，间距 step 米"""
    b = META[name]["bbox"]
    res = META[name]["dem_res"]
    dem = np.load(RAW / f"{name}_dem.npy")
    w, h = b[2] - b[0], b[3] - b[1]
    nx, ny = int(round(w / step)) + 1, int(round(h / step)) + 1
    # 顶点 (i, j) 的米坐标 → DEM 像元下标（像元中心在 (k + 0.5) * res）
    cols = np.linspace(0, w, nx) / res - 0.5
    rows = np.linspace(0, h, ny) / res - 0.5
    rr, cc = np.meshgrid(rows, cols, indexing="ij")
    grid = ndi.map_coordinates(dem, [rr, cc], order=1, mode="nearest").astype(np.float32)
    grid.tofile(OUT / f"{name}_h.bin")
    print(f"{name}_h.bin: {nx}×{ny}，间距 {step} m")
    return grid, nx, ny


class Terrain:
    """按局部米坐标查全景高程（双线性）"""

    def __init__(self):
        self.dem = np.load(RAW / "overview_dem.npy")
        self.res = META["overview"]["dem_res"]

    def z(self, x, y):
        e, n = np.asarray(x) + CX, np.asarray(y) + CY
        c = (e - OV[0]) / self.res - 0.5
        r = (OV[3] - n) / self.res - 0.5
        return ndi.map_coordinates(self.dem, [np.atleast_1d(r), np.atleast_1d(c)], order=1, mode="nearest")


# ---------------- 煤层与地层 ----------------

PLANT_LOCAL = to_local(*META["plant_utm"])
DIP_DEG = 4.0  # 地层倾角（资料：3–5°）
DIP_AZ = 10.0  # 倾向（资料：北北东）
B0 = 1665.0  # 工业广场处 B 煤底板海拔（示意：使 F 煤在河谷平硐口附近出露）


def seam_b(x, y):
    """B 煤层面海拔：过工业广场的倾斜平面，向北北东变深"""
    t = math.tan(math.radians(DIP_DEG))
    az = math.radians(DIP_AZ)
    d = (np.asarray(x) - PLANT_LOCAL[0]) * math.sin(az) + (np.asarray(y) - PLANT_LOCAL[1]) * math.cos(az)
    return B0 - t * d


# 自下而上；top = 层顶相对 B 煤底板的高差（米），最上一层延伸到地表
STRATA = [
    {"key": "mancos", "name": "曼科斯页岩", "top": -45, "color": "#4b5058"},
    {"key": "rollins", "name": "罗林斯砂岩", "top": -6, "color": "#c9bea2"},
    {"key": "bowie", "name": "鲍伊页岩段", "top": 110, "color": "#6c675e"},
    {"key": "paonia", "name": "帕奥尼亚页岩段", "top": 235, "color": "#7d7464"},
    {"key": "barren", "name": "贫煤段砂泥岩", "top": 520, "color": "#9d917c"},
    {"key": "ohio", "name": "俄亥俄溪组砂砾岩", "top": 99999, "color": "#a8967a"},
]
# 煤层：base = 底板相对 B 煤底板高差，thick = 真实厚度（渲染时会加粗）
SEAMS = [
    {"key": "B", "name": "B 煤（萨默塞特煤）", "base": 0, "thick": 5.5, "mined": True},
    {"key": "C", "name": "C 煤", "base": 40, "thick": 1.8, "mined": False},
    {"key": "D", "name": "D 煤", "base": 128, "thick": 1.5, "mined": False},
    {"key": "E", "name": "E 煤（霍克斯内斯特煤）", "base": 152, "thick": 4.0, "mined": True},
    {"key": "F", "name": "F 煤", "base": 180, "thick": 3.5, "mined": True},
]
BLOCK_BASE = 1520.0  # 沙盘底面海拔

# ---------------- 井下布局（示意） ----------------

PORTAL = (260.0, 2070.0)  # 主平硐（影像上南北向长皮带的南端，靠山脚）
SHAFT = to_local(286368, 4306440)  # Deer Creek 回风井（影像上带两个井口的水泥场地）
PANEL_W = 320.0  # 工作面宽（含采空区宽度）
PANEL_PITCH = 400.0  # 相邻工作面中心距（宽 + 区段煤柱与两条顺槽）
MAIN_X = 330.0  # B 煤南翼大巷中心线 x
EAST_X0 = 470.0  # 东翼工作面起采线（大巷保护煤柱以东）
MIN_COVER = 150.0  # 最小埋深：工作面四角埋深不足时缩短


def panel_cover(terrain, x0, x1, y0, y1, seam_dz=0.0):
    xs = np.linspace(x0, x1, 25)
    ys = np.linspace(y0, y1, 5)
    xx, yy = np.meshgrid(xs, ys)
    cover = terrain.z(xx.ravel(), yy.ravel()) - (seam_b(xx.ravel(), yy.ravel()) + seam_dz)
    return cover.reshape(xx.shape)


def build_panels(terrain):
    panels = []
    # 东翼 B 煤：自北向南 8 个工作面，北面 4 个已采完，第 5 个正在回采，第 6 个已掘好顺槽，7、8 规划
    status = ["mined"] * 4 + ["active", "ready", "planned", "planned"]
    lengths = [2700, 2900, 3100, 3300, 3400, 3400, 3300, 3100]
    for k in range(8):
        yc = -1300.0 - PANEL_PITCH * k
        x0, x1 = EAST_X0, EAST_X0 + lengths[k]
        y0, y1 = yc - PANEL_W / 2, yc + PANEL_W / 2
        # 埋深不足的一端往回缩（东端靠近山谷时）
        while x1 - x0 > 1200 and panel_cover(terrain, x1 - 200, x1, y0, y1).min() < MIN_COVER:
            x1 -= 100
        cov = panel_cover(terrain, x0, x1, y0, y1)
        p = {
            "id": f"LW-B{k + 1:02d}",
            "seam": "B",
            "status": status[k],
            "rect": [x0, y0, x1, y1],
            "cover": [round(float(cov.min())), round(float(cov.max()))],
        }
        if status[k] == "active":
            # 后退式回采：从东端（切眼）向大巷方向推进，已推进 58%
            p["face_x"] = round(x1 - 0.58 * (x1 - x0))
        panels.append(p)
    # 西翼 E 煤：早年采完的 4 个工作面（较短）
    e_dz = next(s["base"] for s in SEAMS if s["key"] == "E")
    for k in range(4):
        yc = -950.0 - 380 * k
        x1 = MAIN_X - 160
        x0 = x1 - [1500, 1750, 1900, 1800][k]
        y0, y1 = yc - 150, yc + 150
        cov = panel_cover(terrain, x0, x1, y0, y1, e_dz)
        panels.append(
            {
                "id": f"LW-E{k + 1:02d}",
                "seam": "E",
                "status": "mined",
                "rect": [x0, y0, x1, y1],
                "cover": [round(float(cov.min())), round(float(cov.max()))],
            }
        )
    return panels


def build_roadways(panels):
    """巷道折线 [[x, y, 相对 B 煤底板高差], ...]；kind：main 大巷 / gate 顺槽 / bleeder 回风联络巷 / incline 斜巷 / shaft 立井"""
    f_dz = next(s["base"] for s in SEAMS if s["key"] == "F")
    e_dz = next(s["base"] for s in SEAMS if s["key"] == "E")
    roads = []
    # 主平硐沿 F 煤向南 → 暗斜井下到 B 煤 → B 煤南翼大巷
    roads.append({"kind": "main", "name": "F 煤主平硐", "pts": [[*PORTAL, f_dz], [290, 1500, f_dz]]})
    roads.append({"kind": "incline", "name": "主暗斜井", "pts": [[290, 1500, f_dz], [MAIN_X, 850, 0]]})
    roads.append({"kind": "main", "name": "B 煤南翼大巷", "pts": [[MAIN_X, 850, 0], [MAIN_X, -4500, 0]]})
    # 东翼各工作面两条顺槽（运输顺槽在南、回风顺槽在北），规划面不画
    east = [p for p in panels if p["seam"] == "B"]
    for p in east:
        if p["status"] == "planned":
            continue
        x0, y0, x1, y1 = p["rect"]
        roads.append({"kind": "gate", "name": p["id"] + " 运输顺槽", "pts": [[MAIN_X, y0 - 20, 0], [x1 + 40, y0 - 20, 0]], "panel": p["id"]})
        roads.append({"kind": "gate", "name": p["id"] + " 回风顺槽", "pts": [[MAIN_X, y1 + 20, 0], [x1 + 40, y1 + 20, 0]], "panel": p["id"]})
    # 东端回风联络巷（各面切眼外侧连通，回风经它流向回风井一侧）
    dev = [p for p in east if p["status"] != "planned"]
    bx = max(p["rect"][2] for p in dev) + 40
    roads.append({"kind": "bleeder", "name": "东翼回风联络巷", "pts": [[bx, dev[0]["rect"][3] + 20, 0], [bx, dev[-1]["rect"][1] - 20, 0]]})
    # 回风大巷：大巷南段向西接回风井
    roads.append({"kind": "bleeder", "name": "回风石门", "pts": [[MAIN_X, SHAFT[1], 0], [SHAFT[0], SHAFT[1], 0]]})
    roads.append({"kind": "shaft", "name": "Deer Creek 回风井", "pts": [[SHAFT[0], SHAFT[1], 0], [SHAFT[0], SHAFT[1], None]]})
    # 西翼 E 煤（已闭采）：一条老大巷
    roads.append({"kind": "old", "name": "E 煤西翼老巷", "pts": [[MAIN_X - 60, -700, e_dz], [MAIN_X - 60, -2300, e_dz]]})
    return roads


# ---------------- 地面钻场识别 ----------------


def detect_pads():
    """在 3 m 分辨率影像上找林中的裸土小圆块（瓦斯抽采钻场），返回局部坐标"""
    im = Image.open(RAW / "overview_naip.jpg")
    w0, h0 = im.size
    s = 2  # 1.5 m → 3 m
    small = im.resize((w0 // s, h0 // s), Image.BILINEAR)
    px = META["overview"]["img_res"] * s
    a = np.asarray(small).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    lum = (r + g + b) / 3
    soil = (r > g * 1.02) & (r > b * 1.15) & (lum > 95) & (lum < 200)
    soil = ndi.binary_opening(soil, structure=np.ones((5, 5)))  # 去掉道路（≤ 12 m 宽）
    veg = ((g > r * 0.98) & (lum < 120)).astype(np.float32)
    vegd = ndi.uniform_filter(veg, size=41)  # 周围 120 m 的植被覆盖率
    lab, n = ndi.label(soil)
    idx = np.arange(1, n + 1)
    area = ndi.sum(soil, lab, idx)
    com = ndi.center_of_mass(soil, lab, idx)
    sl = ndi.find_objects(lab)
    pads = []
    for k in range(n):
        if not 40 <= area[k] <= 400:  # 360–3600 m²
            continue
        hh, ww = sl[k][0].stop - sl[k][0].start, sl[k][1].stop - sl[k][1].start
        if max(hh, ww) / max(1, min(hh, ww)) > 2.6 or area[k] / (hh * ww) < 0.45:
            continue
        cy, cx = com[k]
        if vegd[int(cy), int(cx)] < 0.5:  # 稀疏灌丛里的裸地不算
            continue
        e, nn = OV[0] + cx * px, OV[3] - cy * px
        pads.append((*to_local(e, nn), float(area[k] * px * px)))
    keep = []
    for p in sorted(pads, key=lambda t: -t[2]):
        if all((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 > 40**2 for q in keep):
            keep.append(p)
    return keep


def assign_wells(pads, panels, terrain):
    """落在已采 / 在采 / 待采工作面上方（外扩 80 m）的钻场作为抽采钻孔"""
    wells = []
    for x, y, _ in pads:
        for p in panels:
            if p["status"] == "planned":
                continue
            x0, y0, x1, y1 = p["rect"]
            if x0 - 80 <= x <= x1 + 80 and y0 - 80 <= y <= y1 + 80:
                zs = float(terrain.z(x, y)[0])
                dz = next(s["base"] for s in SEAMS if s["key"] == p["seam"])
                wells.append(
                    {
                        "x": round(x, 1),
                        "y": round(y, 1),
                        "z": round(zs, 1),
                        "bottom": round(float(seam_b(x, y)) + dz + 15, 1),  # 钻到煤层顶板上方约 15 m
                        "panel": p["id"],
                    }
                )
                break
    return wells


def export_page(name, grid):
    """页面用的高程 PNG 与影像 webp"""
    code = np.clip(np.round((grid - H_OFFSET) * H_SCALE), 0, 65535).astype(np.uint16)
    rgb = np.zeros((*code.shape, 3), np.uint8)
    rgb[..., 0] = code >> 8
    rgb[..., 1] = code & 255
    # 不写 gAMA / iCCP，浏览器解码时不做色彩转换，字节原样读回
    Image.fromarray(rgb, "RGB").save(PUBLIC / f"{name}_h.png", optimize=True)
    im = Image.open(RAW / f"{name}_naip.jpg")
    w = PAGE_TEX[name]
    im = im.resize((w, round(w * im.height / im.width)), Image.LANCZOS)
    im.save(PUBLIC / f"{name}.webp", "WEBP", quality=80, method=6)
    print(f"public/smart-mine/{name}_h.png、{name}.webp（{im.width}×{im.height}）")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    PAGE_DATA.mkdir(parents=True, exist_ok=True)
    terrain = Terrain()
    ov_grid, nx, ny = resample_dem("overview", 10.0)
    cu_grid, cnx, cny = resample_dem("closeup", 2.0)
    export_page("overview", ov_grid)
    export_page("closeup", cu_grid)
    for name in ("overview", "closeup"):
        shutil.copyfile(RAW / f"{name}_naip.jpg", OUT / f"{name}_tex.jpg")

    panels = build_panels(terrain)
    for p in panels:
        x0, y0, x1, y1 = p["rect"]
        print(f'{p["id"]} {p["status"]:7s} 长 {x1 - x0:.0f} m  埋深 {p["cover"][0]}–{p["cover"][1]} m')
    roads = build_roadways(panels)
    pads = detect_pads()
    wells = assign_wells(pads, panels, terrain)
    print(f"钻场 {len(pads)} 个，其中工作面上方 {len(wells)} 个")

    cb = META["closeup"]["bbox"]
    layout = {
        "note": "地形 / 影像 / 设施与钻场位置为真实数据；地层厚度、工作面与巷道为示意",
        "overview": {"size": [OV[2] - OV[0], OV[3] - OV[1]], "grid": [nx, ny], "step": 10.0},
        "closeup": {
            "center": list(to_local((cb[0] + cb[2]) / 2, (cb[1] + cb[3]) / 2)),
            "size": [cb[2] - cb[0], cb[3] - cb[1]],
            "grid": [cnx, cny],
            "step": 2.0,
        },
        "seamPlane": {"refX": PLANT_LOCAL[0], "refY": PLANT_LOCAL[1], "z0": B0, "dipDeg": DIP_DEG, "dipAz": DIP_AZ},
        "blockBase": BLOCK_BASE,
        "strata": STRATA,
        "seams": SEAMS,
        "panels": panels,
        "roadways": roads,
        "wells": wells,
        "pads": [[round(x, 1), round(y, 1)] for x, y, _ in pads],
        "sites": {
            # 地面设施：按 0.5 m 航拍影像判读（UTM 13N）
            "plant": {"name": "工业广场", "pos": list(PLANT_LOCAL)},
            "portal": {"name": "主平硐", "pos": list(PORTAL)},
            "prep": {"name": "选煤厂", "pos": list(to_local(288430, 4311396))},
            "rawpile": {"name": "原煤堆场", "pos": list(to_local(287670, 4311548))},
            "cleanpile": {"name": "精煤堆场", "pos": list(to_local(288206, 4311548))},
            "office": {"name": "办公区 · 矿灯房", "pos": list(to_local(287990, 4311348))},
            "yard": {"name": "材料设备库", "pos": list(to_local(288166, 4311236))},
            "loadout": {"name": "铁路装车站", "pos": list(to_local(287970, 4311704))},
            "refuse": {"name": "矸石场", "pos": list(to_local(289270, 4310620))},
            "shaft": {"name": "Deer Creek 回风井", "pos": list(SHAFT)},
            "somerset": {"name": "Somerset 镇", "pos": list(to_local(285900, 4311500))},
            "river": {"name": "北福克河", "pos": list(to_local(283700, 4311150))},
        },
    }
    (OUT / "layout.json").write_text(json.dumps(layout, ensure_ascii=False, indent=1), "utf8")
    print("layout.json 已写出")
    # 在采工作面中点的地表 / 煤层海拔（页面「地层柱状」面板用）
    act = next(p for p in panels if p["status"] == "active")
    fy = (act["rect"][1] + act["rect"][3]) / 2
    surf = float(terrain.z(act["face_x"], fy)[0])
    seam = float(seam_b(act["face_x"], fy))
    layout["facts"] = {"faceSurf": round(surf), "faceSeam": round(seam), "faceDepth": round(surf - seam)}
    page = {k: v for k, v in layout.items() if k != "pads"}
    page["heightCode"] = {"offset": H_OFFSET, "scale": H_SCALE}
    page["source"] = "由 scripts/smart-mine/prepare.py 生成，勿手改"
    (PAGE_DATA / "layout.json").write_text(json.dumps(page, ensure_ascii=False, separators=(",", ":")), "utf8")
    print("src/views/smart-mine/data/layout.json 已写出")


if __name__ == "__main__":
    main()

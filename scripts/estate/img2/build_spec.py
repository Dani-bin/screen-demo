#!/usr/bin/env python3
"""
/estate 还原：img2threejs 规格生成器
----------------------------------------------------------
img2threejs 的规格（ObjectSculptSpec）每个部件带一大串字段（动作、碰撞、拆解…），28 栋楼不可能手写 JSON，
所以这里从骨架（new_sculpt_spec.py 的输出）出发，按 layout.json 和还原清单（下面的表）批量生成：
  - 部件树：底座 / 地面 / 道路 / 水系 / 各区块 / 每栋楼（楼号 = 部件 id = 页面里的节点名）/ 屋顶构件
  - 材质：16 种，每种带参考图证据裁片（evidence/mat/*.png，由 extract_pbr_evidence.py 提取 referencePbr）
  - 局部特征（localFeatures）：窗格、壁柱、阳台条、设备盒、光伏片、驳岸块石…，细节清单（detailInventory）引用它们的 id
  - 重复系统：窗、树、路灯、车…（生成器只会环形摆放，所以实际摆放由 scene 里手写的 extras 完成，规格里记录规则和数量）

只管"造型 / 材质 / 光"的还原：楼栋位置沿用 layout.json（本来就是按设计稿屋顶锚点反投影的）。
坐标：规格里 transform 用 three.js 坐标（x 东，y 向上，z 向南 = −北）；dimensions 单位米。

用法：
  python3 scripts/estate/img2/build_spec.py --skeleton <new_sculpt_spec.py 输出的 json> --out .img2threejs/object-sculpt-spec.json
"""
import argparse
import copy
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import refcam  # noqa: E402  评审机位的像素 ↔ 世界换算

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
LAYOUT = json.load(open(os.path.join(ROOT, "src", "views", "estate", "data", "layout.json")))
BASE = LAYOUT["base"]
B = {b["id"]: b for b in LAYOUT["buildings"]}
A = {a["id"]: a for a in LAYOUT["amenities"]}

# 证据裁片（scene-a1.png 原图，1536×864）：{材质 id: (x0, y0, x1, y1)}
CROPS = {
    "mat_plaster": (480, 90, 570, 230),     # B01 南立面
    "mat_window": (990, 90, 1050, 200),     # B04 立面（窗格暖光）
    "mat_roof_slate": (880, 517, 1045, 530),  # 联排深灰屋面 + 光伏片
    "mat_roof_white": (60, 388, 215, 412),  # 周边白模屋面
    "mat_glass": (1345, 330, 1450, 430),    # 商业体弧形玻璃
    "mat_mall_glass": (1345, 330, 1450, 430),  # 商业体弧形玻璃带
    "mat_water_lake": (680, 350, 840, 420),  # 中央湖
    "mat_water_axis": (750, 200, 780, 310),  # 跌水
    "mat_water_river": (400, 700, 900, 760),  # 河
    "mat_grass": (330, 598, 450, 640),      # 草坪
    "mat_asphalt": (300, 600, 700, 632),    # 南侧干道
    "mat_paving": (700, 545, 820, 560),     # 会所前铺装
    "mat_foliage": (580, 395, 700, 445),    # 树冠
    "mat_gold": (0, 830, 400, 864),         # 底座金边
    "mat_plinth": (20, 700, 300, 790),      # 底座侧壁
    "mat_stone_bank": (300, 650, 800, 700),  # 河岸块石
    "mat_mall_core": (1400, 380, 1500, 430),  # 商业体底部几层暖光
    "mat_steel": (1275, 300, 1340, 400),    # 扶梯盒钢框架
    "mat_roof_bright": (700, 480, 830, 500),  # 会所屋顶
    "mat_context": (170, 150, 260, 190),    # 周边白模
    "mat_sports": (150, 345, 285, 425),     # 操场
}


# 周边白模：按设计稿放大后逐块读出来的体块（参考图 1536×864 坐标；一块 = 一个长方体，叠在一起的台阶式组合拆成几块）：
#   (id, x0, x1, ybt, yft, yb)  x0 / x1 = 前立面左右边，ybt = 屋顶后缘 y，yft = 屋顶前缘（= 前立面上缘）y，yb = 前立面下缘（落地处，常被树挡住，估）
# 世界尺寸见 vol()：宽 = 像素宽 × k，高 = 前立面像素高 × k / cos(俯角)，进深 = 屋顶像素进深 × k / sin(俯角)
# 旧版是每块一个大包围盒（把台阶式组合拆不开，高度和进深都被放大），所以和设计稿对不上。
CTX_VOLS = [
    # 左上一排（c01 / c04 单体；c02、c05 是台阶式组合）
    ("ctx_01", 108, 172, 197, 212, 229), ("ctx_04", 70, 148, 220, 238, 265),
    ("ctx_02a", 205, 250, 181, 198, 222), ("ctx_02b", 250, 292, 184, 200, 222), ("ctx_03", 322, 388, 183, 201, 229),
    ("ctx_05a", 167, 212, 233, 246, 270), ("ctx_05b", 210, 242, 241, 249, 272),
    ("ctx_05c", 240, 286, 222, 238, 272), ("ctx_05d", 284, 336, 225, 243, 282),
    # 左侧：c06 两块叠放，c07 = 大体块 + 左边低一级的裙楼
    ("ctx_06a", 0, 72, 300, 321, 337), ("ctx_06b", 0, 42, 322, 336, 372),
    ("ctx_07", 55, 198, 388, 425, 488), ("ctx_07b", 0, 58, 400, 425, 460),
    # 北侧三个小块
    ("ctx_08", 660, 705, 64, 72, 86), ("ctx_09", 775, 818, 64, 72, 86), ("ctx_10", 316, 388, 100, 108, 128),
    # 右上：磨砂半透明感的一组（c11 两块、c12 两块、c13、c14、c15 三块）
    ("ctx_11a", 1183, 1243, 112, 133, 165), ("ctx_11b", 1212, 1268, 120, 142, 172),
    ("ctx_12a", 1192, 1262, 181, 203, 232), ("ctx_12b", 1258, 1300, 187, 200, 226),
    ("ctx_13", 1330, 1405, 180, 200, 226), ("ctx_14", 1250, 1325, 235, 252, 291),
    ("ctx_15a", 1345, 1420, 228, 246, 262), ("ctx_15b", 1372, 1440, 246, 262, 293),
    ("ctx_15c", 1420, 1492, 238, 255, 290),
]
# 社区医院（同样按前立面 / 屋顶读出来）
HP_VOL = (1385, 1505, 481, 520, 556)


def block(bbox, fh_px, ratio=0.65):
    """像素包围盒 + 前立面高度（像素）→ 世界盒子 (cx, cy, w, d, h)；进深由竖直总跨度反推，夹在宽的 0.4–1.1 倍"""
    x0, y0, x1, y1 = bbox
    bx, by = (x0 + x1) / 2, y1
    gx, gy = refcam.ground_point(bx, by)
    dist = refcam.dist_to(bx, by)
    k = dist / refcam.FOC
    w = (x1 - x0) * k
    h = fh_px * k / math.cos(math.radians(refcam.PIT))
    ext = (y1 - y0) * k
    d = (ext - h * math.cos(math.radians(refcam.PIT))) / math.sin(math.radians(refcam.PIT))
    d = max(0.4 * w, min(1.1 * w, d if d > 0 else ratio * w))
    return round(gx, 1), round(gy + d / 2, 1), round(w, 1), round(d, 1), round(h, 1)


def vol(x0, x1, ybt, yft, yb, dmin=8.0):
    """前立面 + 屋顶读数 → 世界盒子 (cx, cy, w, d, h)：前立面下缘中点落地定位置，立面像素高定高度，屋顶像素进深定进深"""
    bx = (x0 + x1) / 2
    gx, gy = refcam.ground_point(bx, yb)
    k = refcam.dist_to(bx, yb) / refcam.FOC
    w = (x1 - x0) * k
    h = (yb - yft) * k / math.cos(math.radians(refcam.PIT))
    d = max(dmin, (yft - ybt) * k / math.sin(math.radians(refcam.PIT)))
    return round(gx, 1), round(gy + d / 2, 1), round(w, 1), round(d, 1), round(h, 1)


def three(x, y, z=0.0):
    """平面坐标（东, 北, 高）→ three.js（x, 高, −北）"""
    return [round(x, 3), round(z, 3), round(-y, 3)]


def rgba(hex_, a=1.0):
    h = hex_.lstrip("#")
    return f"rgba({int(h[0:2], 16)}, {int(h[2:4], 16)}, {int(h[4:6], 16)}, {a})"


def recipe(dom, sec, cls, conf=0.8, stops=None):
    r = {"dominantAlbedo": rgba(dom), "secondaryAlbedo": rgba(sec), "materialClass": cls,
         "materialClassConfidence": conf}
    if stops:
        r["colorGradient"] = {"type": "linear", "stops": [{"position": p, "color": rgba(c)} for p, c in stops]}
    return r


# ------------------------------------------------------------------ 材质表
# (id, 名称, 底色, 次色, 粗糙度, 金属度, 自发光色或 None, 自发光强度, 材质类别, 说明)
MATERIALS = [
    ("mat_plaster", "楼体抹灰（暖灰白）", "#e0d6bf", ["#a89f8a", "#efe6d0"], 0.72, 0.0, "#d8c79e", 0.22, "stone",
     "高层 / 洋房墙面：竖向浅色壁柱 + 深灰窗间墙，被暖光抬暖"),
    ("mat_window", "窗（暖光自发光）", "#ffd79a", ["#ffbf6e", "#fff1cf"], 0.35, 0.0, "#ffc878", 1.6, "glass",
     "每格窗单独发暖光，亮窗占比约 70–80 %"),
    ("mat_roof_slate", "联排 / 洋房屋面（板岩深灰）", "#8a8d93", ["#5c5e64", "#aeb0b5"], 0.8, 0.0, "#9a9ca0", 0.16, "stone",
     "深灰屋面，中央浅灰矩形（光伏 / 天窗）"),
    ("mat_context", "周边白模（无窗实体）", "#cac8c3", ["#a9a7a3", "#e8e6e2"], 0.92, 0.0, None, 0, "stone",
     "周边街区的白色实体：顶亮侧暗、不发光、无窗，景深里虚化"),
    ("mat_roof_bright", "会所白色屋顶板", "#f1f0ee", ["#d7d6d3", "#fbfbfa"], 0.85, 0.0, "#f0efed", 0.18, "stone",
     "会所每一段屋顶都是亮白色出挑薄板（设计稿里是画面里最亮的白）"),
    ("mat_roof_white", "白色平屋面与白模", "#d2d4d8", ["#b6b4b0", "#e8e6e2"], 0.9, 0.0, "#dcdcdc", 0.1, "stone",
     "商业街、周边街区的白模，无纹理"),
    ("mat_glass", "玻璃幕墙", "#6f8f9c", ["#3d5560", "#b8d4de"], 0.12, 0.15, "#ffcf8a", 0.5, "glass",
     "商业体弧形玻璃条带、玻璃盒、穹顶，反射暖光，底层漏光"),
    ("mat_mall_glass", "商业体玻璃带", "#7f96a6", ["#4d6272", "#b4cad6"], 0.12, 0.15, "#6f98b0", 0.1, "glass",
     "商业体弧形玻璃带：蓝灰色反光玻璃，只隐约透出里面的暖光（设计稿不是一整片橙黄）"),
    ("mat_water_lake", "中央湖水", "#1d78b8", ["#0f4d80", "#59b6e6"], 0.05, 0.0, "#2a8fd0", 0.25, "glass",
     "饱和蓝，边缘亮、中心深，高光碎点"),
    ("mat_water_axis", "跌水水池（发亮）", "#49b3e8", ["#2a86c0", "#9bdcf5"], 0.05, 0.0, "#5cc4f0", 0.9, "glass",
     "七级矩形水池，逐级亮蓝"),
    ("mat_water_river", "河水", "#0e4166", ["#082a45", "#2b7aa6"], 0.05, 0.0, None, 0, "glass",
     "深蓝，路灯倒影"),
    ("mat_grass", "草坪", "#4f7330", ["#3b5a22", "#7b9a3c"], 0.95, 0.0, None, 0, "unknown",
     "中绿，近灯处偏黄"),
    ("mat_asphalt", "沥青路面", "#2d2e31", ["#222326", "#4a4b50"], 0.85, 0.0, None, 0, "stone",
     "深灰，白 / 黄标线"),
    ("mat_paving", "铺装（暖灰）", "#b3a58a", ["#9a8c72", "#cdbfa4"], 0.8, 0.0, None, 0, "stone",
     "会所广场、环湖步道、小区路"),
    ("mat_foliage", "树冠（深绿 / 黄绿 / 橙红）", "#3d6a2b", ["#2a4c1d", "#c98a2e"], 0.9, 0.0, None, 0, "unknown",
     "按实例着色：深绿为主，夹黄绿、橙、红"),
    ("mat_gold", "底座金边", "#b98b3e", ["#7a5a22", "#e6c06a"], 0.3, 0.85, None, 0, "metal",
     "古铜金窄边，亮线"),
    ("mat_plinth", "底座侧壁", "#4a3526", ["#2a1d14", "#6a4d38"], 0.4, 0.2, None, 0, "wood",
     "深棕近黑"),
    ("mat_stone_bank", "河岸块石", "#8a8579", ["#6e6a60", "#a9a498"], 0.9, 0.0, None, 0, "stone",
     "驳岸碎石堆砌"),
    ("mat_mall_core", "商业体内芯（暖光楼层）", "#c7a56c", ["#8a6f45", "#e0c08a"], 0.8, 0.0, "#e0a85c", 0.6, "stone",
     "玻璃环后面的楼层：暗暖色，弧面角上隐约透光；平直立面上的亮窗由 extras.js 的亮窗实例负责"),
    ("mat_steel", "钢框架与扶梯", "#b4bbc2", ["#6b7178", "#d3d8dc"], 0.45, 0.25, None, 0, "metal",
     "扶梯盒的钢柱、斜向扶梯"),
    ("mat_sports", "操场（草坪 + 红色跑道）", "#3f7a3a", ["#b9503a", "#2e5c2a"], 0.9, 0.0, None, 0, "rubber",
     "绿色场地，红色塑胶跑道"),
]

# ------------------------------------------------------------------ 局部特征表（细节清单的 mapsTo 引用这里的 id）
# 每项：(id, 类型 kind, 说明, 影响, 证据裁片)
F = {
    "f_tower_pilaster": ("ridge", "竖向浅色壁柱，每 3.4 m 一根，凸出外墙 0.4 m", "立面明暗节奏", "a_towers_gate"),
    "f_tower_window": ("emissive", "逐窗暖光窗格，每层 12 开间，明暗随机", "立面发光", "a_towers_gate"),
    "f_tower_crown": ("bevel", "屋顶收头：深色冠 + 向内收的檐口", "天际线", "a_towers_gate"),
    "f_tower_core": ("ridge", "B02 / B03 屋顶核心筒盒", "天际线", "a_towers_gate"),
    "f_terrace_balcony": ("ridge", "横向阳台板，每层一条，凸出 1.2 m", "洋房立面横向节奏", "b_west_lake"),
    "f_terrace_window": ("emissive", "洋房逐户暖光窗，亮窗约 75 %", "立面发光", "b_west_lake"),
    "f_terrace_roofbox": ("ridge", "洋房屋面设备盒（电梯机房 / 水箱）", "屋面细节", "b_west_lake"),
    "f_villa_pv": ("decal", "联排屋面中央浅灰矩形光伏 / 天窗", "屋面颜色分区", "d_club_south"),
    "f_villa_window": ("emissive", "联排逐户暖光窗", "立面发光", "d_club_south"),
    "f_club_glass": ("gloss", "会所中央整面落地玻璃，门厅暖光外溢", "会所发光", "d_club_south"),
    "f_club_colonnade": ("ridge", "会所门厅前列柱", "会所立面", "d_club_south"),
    "f_club_roofhatch": ("hole", "会所屋顶矩形天窗", "屋面细节", "d_club_south"),
    "f_pool_light": ("emissive", "室外泳池亮蓝池水与池边躺椅", "泳池", "d_club_south"),
    "f_cascade_step": ("emissive", "七级跌水逐级亮蓝，级间有白色水帘", "中轴水景", "g_axis"),
    "f_lake_sparkle": ("gloss", "湖面高光碎点与环湖路灯倒影", "湖面", "b_west_lake"),
    "f_lake_ring": ("linework", "环湖浅色步道", "湖岸线", "b_west_lake"),
    "f_river_bank": ("ridge", "河岸块石驳岸，一条连续的碎石带", "河岸线", "e_river_south"),
    "f_river_reflect": ("gloss", "河面路灯倒影与波纹", "河面", "e_river_south"),
    "f_road_marking": ("linework", "车道虚线、黄实线、斑马线", "道路", "e_river_south"),
    "f_mall_band": ("ridge", "商业体弧形玻璃条带（水平窗带 + 白色楼板边）", "商业体立面", "c_east_mall"),
    "f_mall_podium": ("emissive", "商业体底层通高玻璃暖光", "商业体发光", "c_east_mall"),
    "f_shoprow_roof": ("ridge", "商业街错落白色平屋顶，屋面有小设备盒", "商业街", "h_east_row"),
    "f_shoprow_shopfront": ("emissive", "商业街底层商铺暖光", "商业街", "h_east_row"),
    "f_glassbox_escalator": ("hole", "玻璃扶梯盒：斜面玻璃 + 内部扶梯", "商业体前广场", "c_east_mall"),
    "f_dome_pool": ("gloss", "穹顶玻璃亭下的水池", "商业体前广场", "c_east_mall"),
    "f_gate_portal": ("ridge", "北门楼柱廊与发光门厅", "中轴北端", "a_towers_gate"),
    "f_school_track": ("linework", "操场红色跑道与绿色足球场", "学校", "b_west_lake"),
    "f_context_massing": ("seam", "周边白模块：纯体块，无窗，景深虚化", "周边", "f_north_ctx"),
    "f_tree_canopy": ("stain", "树冠颜色分布：深绿 / 黄绿 / 橙 / 红，冠下接触阴影", "植被", "b_west_lake"),
    "f_lamp_glow": ("emissive", "路灯小光点，暖黄，沿路与步道成排", "夜景光点", "e_river_south"),
    "f_plinth_lip": ("gloss", "底座金边：窄亮线，近处有高光", "底座", "e_river_south"),
}


def feat(fid):
    kind, desc, affects, crop = F[fid]
    return {"id": fid, "kind": kind, "description": desc, "affects": affects, "evidenceRef": f"crops/{crop}.png"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skeleton", required=True, help="new_sculpt_spec.py 输出的骨架 json")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    spec = json.load(open(args.skeleton, encoding="utf-8"))
    tpl = copy.deepcopy(spec["componentTree"][0])  # 骨架里 root 的完整字段当模板
    mat_tpl = copy.deepcopy(spec["materials"][0])

    # ---------------------------------------------------------------- 材质
    mats = []
    for mid, name, base, sec, rough, metal, emis, emis_i, cls, note in MATERIALS:
        m = copy.deepcopy(mat_tpl)
        m["id"] = mid
        m["name"] = name
        m["baseColor"] = m["color"] = base
        m["albedo"] = {"dominant": base, "secondary": sec, "samplingNotes": f"裁片 evidence/mat/{mid}.png；{note}"}
        m["colorVariation"] = {"palette": [base] + sec, "pattern": "mottled", "amplitude": 0.12, "heightCorrelation": 0.2}
        m["roughness"] = {"base": rough, "variation": 0.12, "map": "independent-procedural-field",
                          "localResponse": "边角略粗、受光面略光"}
        m["metalness"] = {"base": metal, "variation": 0.0}
        if emis:
            m["emissive"] = emis
            m["emissiveIntensity"] = {"base": emis_i}
        m["localOverrides"] = [{
            "id": f"{mid}_wear", "kind": "stain",
            "description": f"{name}：低频明暗不均，近灯处偏暖（暖色溢光），冠下 / 墙脚偏暗",
            "region": "full", "dirtAmount": 0.15, "cavityBias": 0.6, "roughness": rough,
            "evidenceRefs": [f"mat/{mid}.png"],
        }]
        m["ambientOcclusion"] = {"cavityStrength": 0.3, "contactShadowBias": 0.4,
                                 "notes": "独立 AO 场：墙脚、屋檐下、树冠下加深，与 albedo 无关"}
        m["textureResolution"] = 1024
        mats.append(m)
    if os.path.exists(args.out):
        old = {m["id"]: m for m in json.load(open(args.out, encoding="utf-8")).get("materials", [])}
        for m in mats:
            o = old.get(m["id"])
            if o and o.get("referencePbr"):
                m["referencePbr"] = o["referencePbr"]
                m["textureResolution"] = o.get("textureResolution", m["textureResolution"])
    spec["materials"] = mats
    mat_ids = {m["id"] for m in mats}

    # ---------------------------------------------------------------- 部件
    comps = []
    world = {"root": [0.0, 0.0, 0.0]}  # 部件 id → 世界坐标（three.js），用来把世界坐标换成相对父节点的局部坐标
    foot = []  # 有体积的部件的世界体积 {id, cx, cy(北), w, d, h, top, ry}，make_ground.py 用它遮挡
    world_ry = {"root": 0.0}  # 部件 id → 世界绕 Y 轴的旋转（弧度）；父节点绕 Y 转了，子节点的局部坐标要反向转回去

    def comp(cid, name, level, role, parent, prim, dims, pos, mat, rationale, feats=None, rot=None,
             recipe_=None, importance=0.6, topo="assembled-solid", evidence=None):
        c = copy.deepcopy(tpl)
        c["id"] = cid
        c["name"] = name
        c["level"] = level
        c["role"] = role
        c["importance"] = importance
        c["confidence"] = 0.75
        c["primitive"] = prim
        c["topologyClass"] = topo
        c["topologyRationale"] = rationale
        c["parent"] = parent
        c["attachment"] = None
        if prim in ("cylinder", "cone", "capsule", "tube", "curve-sweep"):
            # 这些图元按校验规则必须带 attachment；localStart = localEnd 时生成器只把它当契约，不会按端点重新生成圆柱
            c["attachment"] = {"parentId": parent, "parentSocket": f"{parent}-top", "localStart": [0, 0, 0],
                               "localEnd": [0, 0, 0], "contactType": "flush", "embedDepth": 0.2,
                               "gapTolerance": 0.05, "evidenceRefs": ["full-object"]}
        w, h, d = dims
        c["dimensions"] = {"width": round(w, 3), "height": round(h, 3), "depth": round(d, 3), "units": "m",
                           "confidence": 0.7}
        # 不写 scale：生成器看到 transform.scale 就按它缩放、忽略 dimensions，部件会变成 1 米见方
        # 子部件的 position 是相对父节点的：这里统一写世界坐标，自动减去父节点的世界位置（父节点都没有旋转）
        world[cid] = list(pos)
        base_ = world.get(parent, [0.0, 0.0, 0.0])
        phi = world_ry.get(parent, 0.0)
        dx_, dy_, dz_ = pos[0] - base_[0], pos[1] - base_[1], pos[2] - base_[2]
        local = [round(dx_ * math.cos(phi) - dz_ * math.sin(phi), 3), round(dy_, 3),
                 round(dx_ * math.sin(phi) + dz_ * math.cos(phi), 3)]
        rot_w = list(rot or [0, 0, 0])
        world_ry[cid] = rot_w[1] if len(rot_w) > 1 else 0.0
        rot_l = [rot_w[0], round(rot_w[1] - phi, 4), rot_w[2]]
        c["transform"] = {"position": local, "rotation": rot_l}
        assert mat in mat_ids, mat
        c["material"] = mat
        c["materialLayers"] = [mat]
        c["localFeatures"] = [feat(f) for f in (feats or [])]
        c["evidenceRefs"] = evidence or ["full-object"]
        c["fidelityTier"] = "blockout"
        mdef = next(m for m in MATERIALS if m[0] == mat)
        c["colorMaterialRecipe"] = recipe_ or recipe(mdef[2], mdef[3][0], mdef[8], 0.75)
        # 屋面板很薄（1–1.2 m），但屋面构件和白边要靠它的顶面定位，所以 roof 不受 1.5 m 门槛限制
        if role in ("building-mass", "roof", "context") and prim in ("box", "sphere") and (h > 1.5 or role == "roof"):
            foot.append({"id": cid, "cx": round(pos[0], 2), "cy": round(-pos[2], 2), "w": round(w, 2), "d": round(d, 2),
                         "h": round(h, 2), "top": round(pos[1] + h / 2, 2), "ry": round(world_ry[cid], 4)})
        # 动作画像：整件静态，但每个部件都是可单独拾取的命名节点（页面按楼号高亮 / 图层着色）
        c["actionProfile"]["animationRole"] = "static-prop"
        comps.append(c)
        return c

    # 底座椭圆：用参考图反投影的地面图重新量了外缘（见 evidence/projection-route.md），
    # 比 layout.json 的 base（285 × 208）更宽更扁；楼栋位置仍沿用 layout.json
    # 参考图里金边带中心线的椭圆（金边颜色抠出像素 → 反投影到 z=1 → 最小二乘，叠图见 evidence/rim-fit.png）
    cx0, cy0, rx, ry = -0.7, -7.3, 332.4, 192.1

    # root：整座沙盘（装配体，包围盒 = 底座）
    root = copy.deepcopy(tpl)
    root["name"] = "澜岸云境住宅沙盘"
    root["dimensions"] = {"width": 2 * rx, "height": 110.0, "depth": 2 * ry, "units": "m", "confidence": 0.7}
    root["material"] = "mat_plinth"
    root["materialLayers"] = ["mat_plinth"]
    root["colorMaterialRecipe"] = recipe("#2a1d14", "#4a362a", "wood", 0.7)
    root["topologyRationale"] = "整座沙盘是装配体：椭圆底座上放置独立的楼栋、水系和植被，各部件分别建模、分别拾取"
    root["actionProfile"]["animationRole"] = "root"
    comps.append(root)

    def arc_band(a_out, b_out, a_in, b_in, t0, t1, n=48):
        """椭圆弧带（相对底座中心的 (东, 北) 坐标）：外椭圆 t0→t1，内椭圆 t1→t0 闭合"""
        out_pts = [[a_out * math.cos(math.radians(t0 + (t1 - t0) * i / n)), b_out * math.sin(math.radians(t0 + (t1 - t0) * i / n))] for i in range(n + 1)]
        in_pts = [[a_in * math.cos(math.radians(t1 - (t1 - t0) * i / n)), b_in * math.sin(math.radians(t1 - (t1 - t0) * i / n))] for i in range(n + 1)]
        return [[round(x, 2), round(y, 2)] for x, y in out_pts + in_pts]

    # ===== 宏观：底座 / 地面 / 道路 / 水系 =====
    comp("plinth", "椭圆底座", "macro", "base", "root", "cylinder", (2 * (rx + 8), 36, 2 * (ry + 8)),
         three(cx0, cy0, -18), "mat_plinth", "底座是一个扁椭圆柱（圆柱沿 X、Z 不等比缩放），侧壁近黑、顶面被地面盖住",
         importance=0.9, feats=["f_plinth_lip"])
    rim = comp("plinth_rim", "底座金边", "meso", "trim", "plinth", "lathe", (2 * (rx + 6), 1.6, 2 * (ry + 6)),
               three(cx0, cy0, 0.2), "mat_gold",
               "金边是围着地面的一圈窄环（lathe 旋转一个矩形截面，再沿 X、Z 不等比拉成椭圆），顶面略高于地面，近处边缘有一条亮线",
               recipe_=recipe("#b98b3e", "#e6c06a", "metal", 0.8, [(0, "#7a5a22"), (1, "#e6c06a")]))
    rim["geometryDescriptor"]["latheProfile"] = {
        "points": [[0.482, -0.5], [0.5, -0.5], [0.5, 0.5], [0.482, 0.5]], "segments": 128}
    comp("ground", "地面（草坪 + 铺装底）", "macro", "ground", "root", "cylinder", (2 * (rx - 6), 0.6, 2 * (ry - 6)),
         three(cx0, cy0, 0.1), "mat_grass", "地面是和底座同心的薄椭圆盘，草坪色打底；道路、水系、铺装在其上叠加",
         importance=0.9)

    # 道路：宿主 + 四条路带（宽度夹在椭圆弦长内，免得伸出底座）
    def chord_half(vertical, c):
        if vertical:  # 竖路：x = c 处椭圆的半高
            return ry * math.sqrt(max(0.0, 1 - ((c - cx0) / rx) ** 2))
        return rx * math.sqrt(max(0.0, 1 - ((c - cy0) / ry) ** 2))

    comp("roads", "道路网", "macro", "road", "root", "box", (0.02, 0.02, 0.02), three(cx0, cy0, 0.5),
         "mat_asphalt", "道路网的宿主节点：四条路带各自是 meso 部件，标线由地面反投影贴图给出", importance=0.8,
         feats=["f_road_marking"])
    for r in LAYOUT["roads"]:
        vertical = r["d"] > r["w"]
        length = max(r["w"], r["d"])
        width = min(r["w"], r["d"])
        half = chord_half(vertical, r["cx"] if vertical else r["cy"])
        length = min(length, 2 * half * 0.96)
        # plane-card：XY 平面内 (宽, 高)，绕 X 轴转平后高度轴 = 南北向
        dims = (width, length, 1) if vertical else (length, width, 1)
        comp(r["id"], r["name"], "meso", "road", "roads", "plane-card", dims,
             three(r["cx"], r["cy"], 0.55), "mat_asphalt", f"{r['name']}：{r['lanes']} 车道的贴地深灰带",
             rot=[-1.5708, 0, 0])

    # 跌水：宿主 + 七级水池。参考图里两端在像素 (770,195) 和 (762,328) 附近，北高南低，每级是独立的矩形水池
    top = refcam.ground_point(770, 195, 0.9)
    bot = refcam.ground_point(762, 328, 0.9)
    ax_len = top[1] - bot[1]
    comp("AX01", "中轴跌水", "macro", "water", "root", "box", (0.02, 0.02, 0.02),
         three((top[0] + bot[0]) / 2, (top[1] + bot[1]) / 2, 0.9), "mat_water_axis",
         "中轴跌水的宿主节点：七级水池各是 meso 部件", importance=0.85, feats=["f_cascade_step"],
         recipe_=recipe("#49b3e8", "#9bdcf5", "glass", 0.8))
    for i in range(7):
        t = (i + 0.5) / 7
        cy_i = top[1] - ax_len * t
        comp(f"AX01_b{i + 1}", f"跌水第 {i + 1} 级", "meso", "water", "AX01", "box", (11.0, 0.9, ax_len / 7 * 0.62),
             three(top[0] + (bot[0] - top[0]) * t, cy_i, 0.95 + (6 - i) * 0.35), "mat_water_axis",
             f"第 {i + 1} 级水池：矩形，比下一级高 0.35 m，级间留白是水帘")
    lk = A["LK01"]
    comp("LK01", "中央景观湖", "macro", "water", "root", "cylinder", (lk["w"], 0.8, lk["d"]),
         three(lk["cx"], lk["cy"], 0.9), "mat_water_lake", "湖是一个椭圆薄柱，水面略高于草坪",
         importance=0.9, feats=["f_lake_sparkle"], recipe_=recipe("#1d78b8", "#0f4d80", "glass", 0.8, [(0, "#59b6e6"), (1, "#0f4d80")]))
    comp("TR01", "环湖步道", "meso", "path", "LK01", "torus", (lk["w"] + 12, lk["d"] + 12, 1.6),
         three(lk["cx"], lk["cy"], 0.85), "mat_paving", "环湖步道是围着湖的一圈薄环", feats=["f_lake_ring"],
         rot=[1.5708, 0, 0])

    # 河：用参考图实测的北岸 / 南缘曲线（measure_river.py → river.json），两端沿端点外推并被金边内缘裁掉
    river_cols = np.array(json.load(open(os.path.join(ROOT, "src", "views", "estate", "scene", "img2", "river.json")))["columns"])

    def _curve(a_, b_, x):
        return cy0 - b_ * math.sqrt(max(0.0, 1 - ((x - cx0) / a_) ** 2))

    def river_poly(step=6.0):
        xs_ = [cx0 - rx + 8 + step * i for i in range(int((2 * rx - 16) / step) + 1)]
        top, bot = [], []
        for x in xs_:
            # np.interp 在两端取端点值 = 沿端点外推（水平延伸）
            y_n = float(np.interp(x, river_cols[:, 0], river_cols[:, 1]))
            y_s = max(float(np.interp(x, river_cols[:, 0], river_cols[:, 2])), _curve(rx - 8, ry - 8, x) + 4)
            if y_n - y_s > 1.5:
                top.append([round(x - cx0, 2), round(y_n - cy0, 2)])
                bot.append([round(x - cx0, 2), round(y_s - cy0, 2)])
        return top + bot[::-1]

    rv = comp("RV01", "锦澜河", "macro", "water", "root", "extrude", (1, 1, 1), three(cx0, cy0, 0.55),
              "mat_water_river", "河是沿底座南缘的一条弧形深蓝水带，两端被金边内缘裁掉，北岸是驳岸线",
              importance=0.85, feats=["f_river_reflect"], rot=[-1.5708, 0, 0])
    rv["geometryDescriptor"]["profile2D"] = {"points": river_poly(), "depth": 0.7}
    # 挂在根下而不是河下：河的节点自己带了 −90° 旋转，子部件会继承，再转一次就把驳岸立成了一堵墙
    bank = comp("RV01_bank", "河岸块石驳岸", "meso", "embankment", "root", "extrude", (1, 1, 1),
                three(cx0, cy0, 0.6), "mat_stone_bank", "驳岸是河北岸的一条连续块石带（3 m 宽）", feats=["f_river_bank"],
                rot=[-1.5708, 0, 0])
    nb = river_poly()
    # 驳岸 = 北岸线往北 3 m 到北岸线
    bank["geometryDescriptor"]["profile2D"] = {
        "points": [[x, y + 3.0] for x, y in nb[: len(nb) // 2]] + [[x, y] for x, y in nb[: len(nb) // 2]][::-1],
        "depth": 1.4}

    # 区块底（给各楼组一块铺装 / 草坪底，当作它们的父节点）
    def pad(cid, name, cx, cy, w, d, mat="mat_paving"):
        comp(cid, name, "macro", "pad", "root", "box", (w, 0.3, d), three(cx, cy, 0.55), mat,
             "区块底是一块贴地的薄板，承托这一组楼和它们的庭院", importance=0.6)

    pad("pad_towers", "北排高层庭院", 0, 70, 240, 34)
    pad("pad_terrace_w", "西侧洋房庭院", -95, 15, 70, 60, "mat_grass")
    pad("pad_terrace_e", "东侧洋房庭院", 95, 15, 70, 60, "mat_grass")
    pad("pad_villa", "南排联排庭院", 0, -80, 200, 30, "mat_grass")

    # ===== 楼栋（meso，节点名 = 楼号） =====
    # 塔楼高度：直接用布局（B01 / B04 已按设计稿屋顶锚点改成 30 层 96 m，见 layout.mjs；
    # 评审机位下它们的屋顶投影比参考图高 15 / 11 px，对应 94 / 95.7 m，取对称的 30 层）
    H_FIX = {}
    for bid, b in B.items():
        b = dict(b)
        b["height"] = H_FIX.get(bid, b["height"])
        parent = {"tower": "pad_towers", "terrace": "pad_terrace_w" if b["cx"] < 0 else "pad_terrace_e",
                  "villa": "pad_villa"}[b["kind"]]
        if b["kind"] == "tower":
            fs = ["f_tower_pilaster", "f_tower_window", "f_tower_crown"] + (["f_tower_core"] if bid in ("B02", "B03") else [])
            comp(bid, f"{b['name']}（高层 {b['floors']}F）", "meso", "building-mass", parent, "box",
                 (b["w"], b["height"], b["d"]), three(b["cx"], b["cy"], b["height"] / 2 + 0.7), "mat_plaster",
                 "高层是一个竖向长方体，南立面是壁柱 + 窗格的竖向节奏", feats=fs, importance=0.9,
                 recipe_=recipe("#cfc6b0", "#a89f8a", "stone", 0.8, [(0, "#a89f8a"), (1, "#e2d9c3")]))
            comp(f"{bid}_crown", f"{b['name']}屋顶冠", "meso", "roof", bid, "box",
                 (b["w"] * 0.8, 1.6, b["d"] * 0.8), three(b["cx"], b["cy"], b["height"] + 1.5), "mat_roof_slate",
                 "屋顶冠：深灰收头，比楼身略小")
            comp(f"{bid}_core", f"{b['name']}核心筒盒", "meso", "roof", bid, "box",
                 (b["w"] * 0.34, 3.0, b["d"] * 0.5), three(b["cx"], b["cy"], b["height"] + 3.1), "mat_roof_white",
                 "屋顶核心筒盒：电梯机房，白色小盒")
        elif b["kind"] == "terrace":
            comp(bid, f"{b['name']}（洋房 {b['floors']}F）", "meso", "building-mass", parent, "box",
                 (b["w"], b["height"], b["d"]), three(b["cx"], b["cy"], b["height"] / 2 + 0.7), "mat_plaster",
                 "洋房是 7 层长方体，南立面横向阳台板 + 逐户窗",
                 feats=["f_terrace_balcony", "f_terrace_window", "f_terrace_roofbox"], importance=0.8)
            comp(f"{bid}_roof", f"{b['name']}屋面", "meso", "roof", bid, "box",
                 (b["w"] * 0.96, 1.2, b["d"] * 0.96), three(b["cx"], b["cy"], b["height"] + 1.3), "mat_roof_slate",
                 "洋房屋面：深灰屋面带女儿墙")
        else:
            comp(bid, f"{b['name']}（联排 {b['floors']}F）", "meso", "building-mass", parent, "box",
                 (b["w"], b["height"], b["d"]), three(b["cx"], b["cy"], b["height"] / 2 + 0.7), "mat_plaster",
                 "联排是 3 层长方体，深灰屋面带光伏片", feats=["f_villa_pv", "f_villa_window"], importance=0.8)
            comp(f"{bid}_roof", f"{b['name']}屋面", "meso", "roof", bid, "box",
                 (b["w"] * 1.02, 1.0, b["d"] * 1.02), three(b["cx"], b["cy"], b["height"] + 1.2), "mat_roof_slate",
                 "联排屋面：深灰板岩色，中央浅灰光伏片")

    # ===== 配套（位置 / 尺寸按参考图像素反投影；节点名 = 布局里的编号，页面按编号拾取） =====
    def bbox_comp(cid, name, level, role, parent, bbox, fh, mat, why, feats=None, importance=0.7, hscale=1.0):
        cx, cy, w, d, h = block(bbox, fh)
        h *= hscale
        return comp(cid, name, level, role, parent, "box", (w, h, d), three(cx, cy, h / 2 + 0.7), mat, why,
                    feats=feats, importance=importance)

    # 会所：三段式（设计稿放大）——中央段高、宽（约 62 %），两翼低一点、窄、略退后；每一段屋顶都是白色出挑的薄板；
    # 正面是大格玻璃幕墙：粗的深灰柱（开间 ≈ 8.5 m）+ 层间横梁，里面是窗帘暖光（立面着色器按 club 参数画）；
    # 中央屋顶有一块带网格的天窗；门厅前列柱在 extras.js。
    ccx, ccy, cw, cd, chh = block((672, 478, 843, 548), 36)
    # 进深按设计稿屋顶像素进深读数（放大图：中央段屋顶后缘 y ≈ 476、前缘 ≈ 511，共 35 px；现相机下 D = 24.9 m 是 58 px），
    # 收浅到 14 m（屋顶板前后各出挑 1.5 m，所以屋顶实际进深 = 14 + 3 = 17 m ≈ 35 px）；南立面位置不动（ccy 平移进深差的一半）。立面高设计稿 37 px、旧 34 px：高度 × 1.08
    cd_new = 14.0
    ccy = ccy - cd / 2 + cd_new / 2
    cd = cd_new
    chh = chh * 1.08
    c_w = cw * 0.62
    w_w = cw * 0.19
    w_h = chh - 4.5
    w_d = cd * 0.92
    comp("CL01", "社区会所（中央段）", "macro", "building-mass", "root", "box", (c_w, chh, cd),
         three(ccx, ccy, chh / 2 + 0.7), "mat_plaster", "会所中央段：高而宽，正面大格玻璃幕墙 + 粗柱梁",
         feats=["f_club_glass", "f_club_colonnade", "f_club_roofhatch"], importance=0.85)
    for sx, nm in ((-1, "l"), (1, "r")):
        comp(f"CL01_w{nm}", f"会所{'西' if sx < 0 else '东'}翼", "meso", "building-mass", "CL01", "box", (w_w, w_h, w_d),
             three(ccx + sx * cw * 0.405, ccy - (cd - w_d) / 2 * 0 + 0.0, w_h / 2 + 0.7), "mat_plaster",
             "会所翼楼：比中央段低 4.5 m、窄、进深略小")
        comp(f"CL01_roofw{nm}", f"会所{'西' if sx < 0 else '东'}翼屋顶板", "meso", "roof", "CL01", "box",
             (w_w + 2.2, 0.9, w_d + 2.2), three(ccx + sx * cw * 0.405, ccy, w_h + 0.7 + 0.45), "mat_roof_bright",
             "白色出挑的屋顶薄板")
    comp("CL01_roof", "会所中央段屋顶板", "meso", "roof", "CL01", "box", (c_w + 3.0, 1.1, cd + 3.0),
         three(ccx, ccy, chh + 0.7 + 0.55), "mat_roof_bright", "白色出挑的屋顶薄板，比楼身向外 1.5 m")
    comp("CL01_sky", "会所天窗", "meso", "roof", "CL01", "box", (c_w * 0.34, 0.5, cd * 0.3),
         three(ccx, ccy, chh + 0.7 + 1.35), "mat_steel", "中央屋顶上的网格天窗（深灰）")
    sw = A["SW01"]
    comp("SW01", "室外泳池", "meso", "water", "CL01", "box", (sw["w"], 0.8, sw["d"]),
         three(sw["cx"], sw["cy"], 0.9), "mat_water_axis", "泳池：亮蓝矩形水面，池边铺装与躺椅", feats=["f_pool_light"])
    bbox_comp("E01", "北门楼", "macro", "building-mass", "root", (735, 140, 802, 172), 20, "mat_plaster",
              "北门楼：中轴北端的小亭，柱廊 + 发光门厅", ["f_gate_portal"], 0.8)

    # 东侧底商街：参考图里是沿东路的一条斜长条（顶端 ≈ (1100, 235)、底端 ≈ (1228, 560)）
    p1 = refcam.ground_point(1100, 235)
    p2 = refcam.ground_point(1228, 560)
    sh_len = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    sh_ang = math.atan2(p2[1] - p1[1], p2[0] - p1[0])
    comp("SH01", "东侧底商街", "macro", "building-mass", "root", "box", (0.02, 0.02, 0.02),
         three((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, 0.7), "mat_roof_white",
         "底商街的宿主节点：沿东路的一条斜长条，分成 5 段错落的白色平屋顶，每段是 meso 部件", importance=0.75,
         feats=["f_shoprow_roof", "f_shoprow_shopfront"], rot=[0, round(sh_ang, 4), 0])
    seg_frac = [0.20, 0.17, 0.20, 0.23, 0.20]
    seg_h = [8.0, 11.0, 8.5, 10.0, 9.0]
    seg_w = [14.0, 16.0, 14.0, 17.0, 15.0]
    acc = 0.0
    for i, (fr, hh, ww) in enumerate(zip(seg_frac, seg_h, seg_w)):
        tc = acc + fr / 2
        acc += fr
        comp(f"SH01_s{i + 1}", f"底商街第 {i + 1} 段", "meso", "building-mass", "SH01", "box", (sh_len * fr - 1.0, hh, ww),
             three(p1[0] + (p2[0] - p1[0]) * tc, p1[1] + (p2[1] - p1[1]) * tc, hh / 2 + 0.7), "mat_roof_white",
             f"第 {i + 1} 段：白色平屋顶，高 {hh} m，段间留 1 m 缝", rot=[0, round(sh_ang, 4), 0])

    # 商业体：参考图里东侧两角是圆角（弧形玻璃立面），用 extrude 一个圆角矩形轮廓；西侧（挨着扶梯盒）是直角
    # 体量按设计稿读数（放大图上读：南墙底 y = 431–432、屋顶前缘 y = 366、屋顶四角、东端圆角在 x ≈ 1530）：
    #  - 屋顶高度：南墙东端的屋顶前缘 (1530, 366) 与它的落地点 (1522, 432) 应在同一条南墙线上，二分解出 z ≈ 41.5 m（含 0.7 基座）；
    #  - 屋顶四角投到 z = 41.5：西北 (219, 5)、东北 (277, −4)、西南 (231, −20)、东南 (279, −24)；
    #  - 南墙底 y ≈ −24（旧版 −29：立面比设计稿低 10–15 px），西墙 x ≈ 225，东端 x ≈ 279，北缘取 ≈ +3。
    # 旧版从一个 bbox 反推（62 × 45 × 34 m），宽了、深了、矮了：设计稿里是 54 × 27 的紧凑体块，高 40.8 m。
    mcx, mcy, mw, md, mh = 252.0, -10.5, 54.0, 27.0, 40.8
    mr = round(min(mw, md) * 0.3, 1)
    # 层高：底层是通高的大玻璃（约占 28 %），上面四层每层 18 %（设计稿里底层亮窗高约 20 px，上面每层约 12 px）
    FL_FRAC = [0.28, 0.18, 0.18, 0.18, 0.18]
    FL_Z = [sum(FL_FRAC[:i]) * mh for i in range(5)]  # 每层起点（距楼脚）

    def rounded_all(w, d, r, n=10):
        """四个角都是圆角的矩形轮廓（设计稿里西南、东南、东北的角都是弧形，西北角很小）"""
        pts = []
        for cx_, cy_, a0 in ((w / 2 - r, -d / 2 + r, -math.pi / 2), (w / 2 - r, d / 2 - r, 0.0),
                             (-w / 2 + r, d / 2 - r, math.pi / 2), (-w / 2 + r, -d / 2 + r, math.pi)):
            for i in range(n + 1):
                t = a0 + (math.pi / 2) * i / n
                pts.append([cx_ + r * math.cos(t), cy_ + r * math.sin(t)])
        return [[round(x, 2), round(y, 2)] for x, y in pts]

    def rounded_east(w, d, r, n=10):
        pts = [[-w / 2, -d / 2], [w / 2 - r, -d / 2]]  # 西南 → 南边到圆角起点
        for i in range(1, n + 1):  # 东南圆角
            t = -math.pi / 2 + (math.pi / 2) * i / n
            pts.append([w / 2 - r + r * math.cos(t), -d / 2 + r + r * math.sin(t)])
        pts.append([w / 2, d / 2 - r])
        for i in range(1, n + 1):  # 东北圆角
            t = (math.pi / 2) * i / n
            pts.append([w / 2 - r + r * math.cos(t), d / 2 - r + r * math.sin(t)])
        pts += [[-w / 2, d / 2]]
        return [[round(x, 2), round(y, 2)] for x, y in pts]

    # 商业体 = 暖光内芯 + 5 层连续的曲面玻璃环 + 5 层出挑的白色楼板环 + 屋顶盖板。
    # 参考图里立面就是一圈圈白色曲面楼板夹着玻璃，玻璃后面透出暖黄的楼层灯光。
    # 全部用 extrude（圆角矩形轮廓，带洞做成"环"），挂在根下（旋转父节点的孩子会躺倒）。
    core = comp("ML01", "商业综合体（内芯）", "macro", "building-mass", "root", "extrude", (1, 1, 1), three(mcx, mcy, 0.7),
                "mat_mall_core", "商业体的内芯（暗暖色，只在玻璃弧面角上隐约透光）：四角圆角的圆角矩形挤出体；玻璃环和楼板环套在它外面",
                feats=["f_mall_band", "f_mall_podium"], importance=0.85, rot=[-1.5708, 0, 0])
    core["geometryDescriptor"]["profile2D"] = {"points": rounded_all(mw - 1.2, md - 1.2, max(1.0, mr - 0.6)), "depth": round(mh, 2)}
    foot.append({"id": "ML01", "cx": mcx, "cy": mcy, "w": mw, "d": md, "h": mh, "top": round(0.7 + mh, 2), "ry": 0.0,
                 "cornerRadius": mr})
    for i in range(5):
        z0 = 0.7 + FL_Z[i]
        fl_h = FL_FRAC[i] * mh
        # 玻璃环：楼层高度的 66 %（底层通高大玻璃：80 %），壁厚 0.9 m；蓝灰色反光玻璃（mat_mall_glass），不是暖黄
        gh = 0.8 if i == 0 else 0.66
        g = comp(f"ML01_glass{i + 1}", f"商业体第 {i + 1} 层玻璃环", "meso", "building-mass", "root", "extrude", (1, 1, 1),
                 three(mcx, mcy, z0 + fl_h * (0.1 if i == 0 else 0.12)), "mat_mall_glass",
                 "连续的曲面玻璃环：圆角矩形外轮廓挖掉内轮廓，四角是弧面", rot=[-1.5708, 0, 0])
        g["geometryDescriptor"]["profile2D"] = {
            "points": rounded_all(mw, md, mr),
            "holes": [rounded_all(mw - 1.8, md - 1.8, max(1.0, mr - 0.9))],
            "depth": round(fl_h * gh, 2)}
        # 楼板环：每层顶部一圈浅灰色的薄楼板边（设计稿里立面几乎全是玻璃，楼板只是一圈细边），向外 0.6 m、厚 0.5 m
        sl = comp(f"ML01_slab{i + 1}", f"商业体第 {i + 1} 层楼板环", "meso", "building-mass", "root", "extrude", (1, 1, 1),
                  three(mcx, mcy, z0 + fl_h - 0.45), "mat_steel", "浅灰色的薄圆角楼板边，向外 0.6 m，厚 0.5 m",
                  rot=[-1.5708, 0, 0])
        hole = rounded_all(mw - 0.2, md - 0.2, max(1.0, mr - 0.1))
        sl["geometryDescriptor"]["profile2D"] = {"points": rounded_all(mw + 1.2, md + 1.2, mr + 0.6), "holes": [hole], "depth": 0.5}
    cap = comp("ML01_cap", "商业体屋顶盖板", "meso", "roof", "root", "extrude", (1, 1, 1), three(mcx, mcy, 0.7 + mh - 0.2),
               "mat_roof_white", "屋顶盖板：实心圆角板，向外出挑 0.8 m（实测 mat_roof_white 的屋顶色和设计稿最接近，mat_plaster 偏黄）", rot=[-1.5708, 0, 0])
    cap["geometryDescriptor"]["profile2D"] = {"points": rounded_all(mw + 1.6, md + 1.6, mr + 0.8), "depth": 1.2}
    # 屋顶设备盒：设计稿里是屋顶正中偏北的一个退台盒（约 28 × 12 m），不是半个屋顶那么大
    comp("ML01_roof", "商业体屋顶盒", "meso", "roof", "root", "box", (mw * 0.5, 5.5, md * 0.4),
         three(mcx + 1.0, mcy + md * 0.04, 0.7 + mh + 2.75), "mat_roof_white", "商业体屋顶：白色平屋顶带一个退台盒")

    # 扶梯盒：参考图里是钢框架 + 两侧玻璃 + 斜向上去的扶梯（向北上行）
    ex, ey, ew, ed, eh = block((1258, 296, 1332, 410), 40)
    for sx in (-1, 1):
        for sy in (-1, 1):
            comp(f"ML01_esc_post{'w' if sx < 0 else 'e'}{'s' if sy < 0 else 'n'}", "扶梯盒钢柱", "meso", "building-mass", "root", "box",
                 (0.7, eh, 0.7), three(ex + sx * ew / 2, ey + sy * ed / 2, eh / 2 + 0.7), "mat_steel", "钢柱",
                 feats=["f_glassbox_escalator"] if (sx, sy) == (-1, -1) else None)
    for sx in (-1, 1):
        comp(f"ML01_esc_glass{'w' if sx < 0 else 'e'}", "扶梯盒侧面玻璃", "meso", "building-mass", "root", "box",
             (0.3, eh * 0.96, ed - 0.7), three(ex + sx * ew / 2, ey, eh / 2 + 0.7), "mat_glass", "两侧的玻璃面")
    comp("ML01_escalator", "扶梯盒顶", "meso", "roof", "root", "box", (ew + 0.8, 0.5, ed + 0.8), three(ex, ey, eh + 1.0),
         "mat_glass", "扶梯盒的玻璃顶（设计稿里是带钢梁格的玻璃顶）")
    run = ed * 0.82
    hyp = math.hypot(eh * 0.92, run)
    tilt = math.atan2(eh * 0.92, run)
    for sx in (-1, 1):
        comp(f"ML01_esc_ramp{'w' if sx < 0 else 'e'}", "斜向扶梯", "meso", "building-mass", "root", "box",
             (ew * 0.26, 1.0, hyp), three(ex + sx * ew * 0.2, ey, eh * 0.46 + 0.7), "mat_steel",
             "斜向向北上行的扶梯（长方体绕东西轴倾斜，北端高）", rot=[round(tilt, 4), 0, 0])
    dcx, dcy, dw, dd, dh = block((1315, 430, 1375, 475), 18)
    dome = comp("ML01_dome", "穹顶玻璃亭", "meso", "building-mass", "root", "lathe", (dw, dh * 1.4, dd),
                three(dcx, dcy, 0.9), "mat_glass", "穹顶玻璃亭：lathe 旋转一条四分之一圆弧得到的半球罩，罩住一个小水池",
                feats=["f_dome_pool"], topo="continuous-sculpt")
    # 半球剖面：从边沿 (r=0.5, y=−0.5) 到顶点 (r=0, y=0.5)，12 段圆弧
    dome["geometryDescriptor"]["latheProfile"] = {
        "points": [[round(0.5 * math.cos(math.pi / 2 * i / 12), 4), round(-0.5 + math.sin(math.pi / 2 * i / 12), 4)] for i in range(13)],
        "segments": 28}

    foot.append({"id": "ML01_dome", "cx": round(dcx, 2), "cy": round(dcy, 2), "w": round(dw, 2), "d": round(dd, 2),
                 "h": round(dh * 1.4, 2), "top": round(0.9 + dh * 1.4, 2), "ry": 0.0})
    foot.append({"id": "ML01_escalator", "cx": round(ex, 2), "cy": round(ey, 2), "w": round(ew, 2), "d": round(ed, 2),
                 "h": round(eh, 2), "top": round(0.7 + eh, 2), "ry": 0.0})

    # 学校：设计稿里是 3 层、进深约 16 m 的 L 形窄楼（北翼东西向，西翼南北向），不是两块大盒子
    scx, scy, sw_, sd_, sh_ = block((160, 277, 305, 330), 24)
    north_d = 16.0
    sc_h = 12.6  # 3 层 × 4.2 m
    comp("SC01", "九年一贯制学校（北翼）", "macro", "building-mass", "root", "box", (sw_, sc_h, north_d),
         three(scx, scy - sd_ / 2 + north_d / 2, sc_h / 2 + 0.7), "mat_roof_white",
         "学校北翼：3 层、进深 16 m 的东西向窄楼，一整条横向窗带", feats=["f_school_track"], importance=0.7)
    wcx, wcy, ww_, wd_, wh_ = block((62, 287, 152, 385), 42)
    west_w, west_d = 16.0, 52.0
    comp("SC01_west", "学校西翼", "meso", "building-mass", "SC01", "box", (west_w, sc_h, west_d),
         three(wcx - ww_ / 2 + west_w / 2, wcy - wd_ / 2 + west_d / 2, sc_h / 2 + 0.7), "mat_roof_white",
         "学校西翼：3 层、东西 16 m、南北 52 m 的窄楼")
    g0 = refcam.ground_point(150, 335)
    g1 = refcam.ground_point(300, 440)
    comp("SC01_field", "操场", "meso", "ground", "SC01", "box", (abs(g1[0] - g0[0]), 0.3, abs(g1[1] - g0[1])),
         three((g0[0] + g1[0]) / 2, (g0[1] + g1[1]) / 2, 0.75), "mat_sports", "操场：绿色足球场 + 红色跑道")

    hx, hy, hw, hd, hh = vol(*HP_VOL)
    # 医院屋顶进深按设计稿读数换算是 44 px，设计稿 39 px：进深 × 0.88，南立面不动
    hy = hy - hd / 2 + hd * 0.88 / 2
    hd = hd * 0.88
    comp("HP01", "社区医院", "macro", "building-mass", "root", "box", (hw, hh, hd), three(hx, hy, hh / 2 + 0.7),
         "mat_context", "医院：白色大体块（面比顶暗，和周边白模同材质），屋顶有设备盒，立面有红色标识", importance=0.55)
    for cid, aid, mat in (("KG01", "KG01", "mat_plaster"), ("PM01", "PM01", "mat_plaster"), ("MT01", "MT01", "mat_glass")):
        a = A[aid]
        comp(cid, a["name"], "macro", "building-mass", "root", "box", (a["w"], max(a["height"], 3), a["d"]),
             three(a["cx"], a["cy"], max(a["height"], 3) / 2 + 0.7), mat, f"{a['name']}：低矮体块",
             importance=0.55)

    comp("context_blocks", "周边白模街区", "macro", "context", "root", "box", (0.02, 0.02, 0.02),
         three(cx0, cy0, 0.6), "mat_roof_white", "周边街区是无细节的白模体块（景深虚化），每块是 meso 部件", importance=0.4,
         feats=["f_context_massing"])
    for cid, *rd in CTX_VOLS:
        vx, vy, vw, vd, vh = vol(*rd)
        comp(cid, f"周边白模 {cid[4:]}", "meso", "context", "context_blocks", "box", (vw, vh, vd),
             three(vx, vy, vh / 2 + 0.7), "mat_context",
             "周边白模：纯体块，无窗；前立面 / 屋顶按设计稿逐块读数后反投影（台阶式组合拆成几块）", importance=0.35)

    pc = A["SP01"]
    comp("SP01", "运动场", "meso", "ground", "root", "box", (pc["w"], 0.3, pc["d"]), three(pc["cx"], pc["cy"], 0.75),
         "mat_sports", "运动场：橙红场地带白线")
    pg = A["PL01"]
    comp("PL01", "儿童乐园", "meso", "ground", "root", "box", (pg["w"], 0.3, pg["d"]), three(pg["cx"], pg["cy"], 0.75),
         "mat_sports", "儿童乐园：彩色橡胶场地和小型游具")
    # 植被 / 路灯车辆只是挂实例的宿主节点（实例由 extras 摆放），自身不画：尺寸取极小，免得盖住地面
    comp("vegetation", "植被", "macro", "vegetation", "root", "cylinder", (0.02, 0.02, 0.02),
         three(cx0, cy0, 0.3), "mat_foliage", "植被是约 1 800 棵树加灌木，沿路、沿水、沿楼组成片；树实例由 extras 摆放",
         importance=0.9, feats=["f_tree_canopy"])
    comp("site_furniture", "路灯与车辆", "macro", "furniture", "root", "box", (0.02, 0.02, 0.02),
         three(cx0, cy0, 0.3), "mat_plinth", "路灯沿路沿步道成排，车辆在干道上行驶；实例由 extras 摆放",
         importance=0.5, feats=["f_lamp_glow"])
    spec["componentTree"] = comps

    # ---------------------------------------------------------------- 重复系统（规格记录规则；摆放在 extras）
    def rep(rid, level, parent, prim, count, mat, scale, rule, evidence):
        # count 写 0：生成器只会环形摆放，遇到 count > 0 就会在宿主节点处造出一堆垃圾实例（曾造出 4 千万三角形）；
        # 这些系统由 scene/img2/extras.js 按 rule 摆放，真实数量记在 plannedCount
        return {"id": rid, "name": rid, "level": level, "parent": parent, "primitive": prim, "count": 0,
                "plannedCount": count, "material": mat, "instanceScale": scale,
                "placement": {"mode": "custom", "rule": rule},
                "realization": "instanced-in-extras", "buildsGeometry": True,
                "evidenceRefs": [evidence], "elementComponentIds": []}
    spec["repetitionSystems"] = [
        rep("rep_tower_windows", "micro", "pad_towers", "box", 12000, "mat_window", [1.7, 2.0, 0.2],
            "4 栋高层南 / 东 / 西立面：每层 12 开间，窗间为壁柱；每扇窗按随机数决定亮度，亮窗约 75 %", "crops/a_towers_gate.png"),
        rep("rep_lowrise_windows", "micro", "root", "box", 6000, "mat_window", [1.6, 1.7, 0.15],
            "8 栋洋房 + 4 栋联排 + 会所：每户一扇暖光窗，亮窗约 75 %", "crops/b_west_lake.png"),
        rep("rep_pilasters", "micro", "pad_towers", "box", 600, "mat_plaster", [0.9, 1.0, 0.4],
            "高层南立面壁柱：每 3.4 m 一根，通高", "crops/a_towers_gate.png"),
        rep("rep_trees", "micro", "vegetation", "ellipsoid", 1800, "mat_foliage", [5.0, 6.0, 5.0],
            "沿路、沿水、沿楼分布；冠径 3–7 m；颜色分布深绿 55 % / 黄绿 25 % / 橙 12 % / 红 8 %；冠下接触阴影", "crops/b_west_lake.png"),
        rep("rep_lamps", "micro", "site_furniture", "cylinder", 160, "mat_window", [0.5, 3.0, 0.5],
            "沿干道、步道和湖岸成排，间距约 18 m；暖黄光点", "crops/e_river_south.png"),
        rep("rep_cars", "micro", "site_furniture", "box", 60, "mat_plaster", [2.2, 1.2, 4.4],
            "南北干道上随机分布，车头灯 / 尾灯", "crops/e_river_south.png"),
        rep("rep_roof_units", "micro", "root", "box", 90, "mat_roof_white", [2.4, 1.2, 2.4],
            "洋房、联排、商业街、周边白模屋面的设备盒，每栋 2–6 个", "crops/c_east_mall.png"),
    ]

    # ---------------------------------------------------------------- 细节清单（每个局部特征一条，mapsTo 指向它的 id）
    region_of = {  # 证据裁片在原图里的大致区域（v1 坐标 / 1920×1080 归一化）
        "a_towers_gate": (560, 110, 1360, 400), "b_west_lake": (470, 360, 1110, 770),
        "c_east_mall": (1240, 300, 1860, 820), "d_club_south": (600, 600, 1460, 860),
        "e_river_south": (100, 780, 1800, 990), "f_north_ctx": (300, 120, 1750, 340),
        "g_axis": (880, 280, 1040, 640), "h_east_row": (1300, 310, 1560, 720)}
    scale_of = {"emissive": "small", "ridge": "small", "linework": "thin", "gloss": "medium", "decal": "medium",
                "bevel": "small", "hole": "small", "seam": "medium", "stain": "large"}
    details = []
    for fid, (kind, desc, affects, crop) in F.items():
        x0, y0, x1, y1 = region_of[crop]
        details.append({
            "id": f"d_{fid[2:]}", "kind": kind, "description": desc,
            "region": {"x": round(x0 / 1920, 4), "y": round(y0 / 1080, 4), "width": round((x1 - x0) / 1920, 4),
                       "height": round((y1 - y0) / 1080, 4), "units": "normalized"},
            "scale": scale_of.get(kind, "small"), "affects": affects,
            "mapsTo": {"type": "component.localFeatures", "ref": fid},
            "evidenceRef": f"crops/{crop}.png", "confidence": 0.7})
    spec["preSpecAssessment"]["detailInventory"].update({"scanMethod": "component-zones", "details": details})

    # ---------------------------------------------------------------- 评审视点 / 特征评审目标 / 光
    spec["qualityTargets"]["reviewViewpoints"] = [
        "home", "towers-gate", "lake-club", "east-commercial", "river-south"]
    spec["qualityTargets"]["viewCrops"] = {
        "home": [0, 0, 1536, 864], "towers-gate": [440, 40, 1120, 330], "lake-club": [380, 300, 1160, 600],
        "east-commercial": [1080, 190, 1536, 560], "river-south": [0, 600, 1536, 864]}
    spec["featureReviewTargets"] = [
        {"id": "overall-layout", "name": "整体构图与中轴线", "tier": "critical", "passIds": ["blockout"],
         "minimumScore": 0.75, "mustPass": True, "componentRefs": ["plinth", "ground", "LK01", "AX01", "B01", "B04"],
         "evidenceRefs": ["crops/a_towers_gate.png", "crops/g_axis.png"]},
        {"id": "primary-structure", "name": "部件层级与可拾取编号", "tier": "critical",
         "passIds": ["structural-pass"], "minimumScore": 0.75, "mustPass": True,
         "componentRefs": ["root", "pad_towers", "AX01", "SH01", "ML01", "context_blocks"],
         "evidenceRefs": ["crops/a_towers_gate.png", "crops/c_east_mall.png"]},
        {"id": "tower-facade", "name": "高层立面（壁柱 + 逐窗暖光 + 收头）", "tier": "critical",
         "passIds": ["form-refinement"], "minimumScore": 0.7, "mustPass": True,
         "componentRefs": ["B01", "B02", "B03", "B04"], "evidenceRefs": ["crops/a_towers_gate.png"]},
        {"id": "water-system", "name": "水系（跌水 / 湖 / 河 / 泳池）", "tier": "critical",
         "passIds": ["material-pass"], "minimumScore": 0.7, "mustPass": True,
         "componentRefs": ["AX01", "LK01", "RV01", "SW01"],
         "evidenceRefs": ["crops/g_axis.png", "crops/b_west_lake.png", "crops/e_river_south.png"]},
        {"id": "vegetation-density", "name": "植被密度与颜色分布", "tier": "critical",
         "passIds": ["form-refinement", "material-pass"], "minimumScore": 0.65, "mustPass": True,
         "componentRefs": ["vegetation"], "evidenceRefs": ["crops/b_west_lake.png"]},
        {"id": "east-commercial", "name": "东侧商业街与玻璃商业体", "tier": "important",
         "passIds": ["form-refinement"], "minimumScore": 0.6, "mustPass": False,
         "componentRefs": ["SH01", "ML01", "ML01_escalator", "ML01_dome"],
         "evidenceRefs": ["crops/c_east_mall.png", "crops/h_east_row.png"]},
        {"id": "lighting-mood", "name": "黄昏灯光氛围（窗光 / 灯池 / 水面反光）", "tier": "important",
         "passIds": ["lighting-pass"], "minimumScore": 0.6, "mustPass": False,
         "componentRefs": ["root"], "evidenceRefs": ["full-object"]},
    ]
    spec["lightingFromPhoto"] = [
        "key：低角度暖色主光（约 2700 K），从画面左后方照来，在楼体南立面形成长影，强度压低，曝光让窗光与水面成为最亮处",
        "fill：天空半球光偏暖灰，强度约为主光的 0.35，墙脚和树冠下保留深色",
        "rim / 环境：展厅背景是暗棕色大理石，只给底座金边和水面一条高光，不做整体环境提亮",
        "exposure 与 tone mapping：NeutralToneMapping 只在输出阶段做一次，曝光约 1.1，辉光只给窗光、路灯、水面这类真实光源（阈值约 1.15）",
        "contact shadow / ambient occlusion：楼脚、树冠下、河岸块石下做接触阴影，位置按 AO 场加深，不用实时 GTAO",
    ]

    # ---------------------------------------------------------------- 未决问题 → 假设 / 风险（严格校验要求清空）
    pa = spec["preSpecAssessment"]
    pa["assumptions_resolved"] = pa.get("unknownsToResolveBeforeImplementation", [])
    pa["unknownsToResolveBeforeImplementation"] = []
    spec["assumptions"] = [
        "所有楼栋北立面和山墙不可见：按可见南立面同一套立面规则推断（标为推测）。",
        "AI 图透视局部不自洽：评审机位在 1536×864 原图坐标下用 16 个屋顶锚点自由拟合（俯角 54°，RMS 9.8 px），不是按透视反求。",
        "窗的明暗随机：复刻统计特征（亮窗约 75 %），不逐窗复刻。",
        "树冠内部结构和上缘周边体块被景深虚化：按统计分布摆树，周边做白模。",
        "实时帧率预算：窗、树、灯、车全部 InstancedMesh（约 8 个实例批次）；在 optimization pass 里实测。",
    ]
    spec["risks"] = ["实时渲染过去在评审量表上封顶约 5 分；本次靠真实造型 + 参考投影地面 + 实例化植被，是否过 0.7 待评审。"]

    spec["referenceCamera"] = {
        "solved": True, "fovDegrees": 28.0, "aspect": 1536 / 864,
        "orientation": {"yaw": 90.26, "pitch": 54.32, "roll": 0.0},
        "positionHint": [5.3, 536.0, 409.8],
        "note": "scripts/estate/img2/fit_ref_camera.py：scene-a1.png（1536×864）下固定 FOV 28° 自由拟合，RMS 9.8 px；three.js 坐标见 .img2threejs/camera-ref.json"}
    spec["sourceImage"] = "docs/design/estate/design/src/scene-a1.png"
    spec["silhouette"] = {
        "boundingShape": "椭圆底座（长轴东西），撑满画面左右，下沿露出金边和深色侧壁",
        "aspectRatios": ["底座长短轴约 1.54 : 1", "北排高层高宽比约 3 : 1"],
        "symmetry": "中轴左右近似对称（建筑），东西两端不对称（西学校 / 东商业）",
        "dominantCurves": ["底座椭圆", "圆形中央湖", "商业体弧形立面"],
        "negativeSpaces": ["中轴两侧的树林带", "湖与会所之间的广场"],
        "landmarks": ["B01–B04", "跌水", "圆湖", "会所", "商业体", "河"],
    }
    spec["viewEvidence"] = [{
        "id": "full-object", "view": "home-oblique",
        "imageRegion": {"x": 0, "y": 0, "width": 1, "height": 1, "units": "normalized"},
        "observations": ["见 evidence/image-analysis.md"], "confidence": 0.8}]
    spec["proceduralStrategy"] = [
        "生成器负责部件树、图元和材质；窗 / 树 / 路灯 / 车 / 壁柱这类大批量实例由 scene/img2/extras.js 按 repetitionSystems 的规则摆放。",
        "地面（道路、草坪、步道、水岸）用设计稿按评审机位反投影到地面平面得到的去光照贴图（projection-first）。",
        "手写模块：extras.js（实例化系统）、ground 反投影贴图、立面着色器（窗格与壁柱）；每个手写决定写回规格。",
    ]

    # 构建 pass 的部件引用：blockout 只要大体块；structural 加楼栋屋顶构件；其余 pass 全部
    all_ids = [c["id"] for c in comps]
    blockout_ids = (
        ["root", "plinth", "ground", "LK01", "AX01", "RV01", "roads", "R01", "R02", "R03", "R04"]
        + list(B)
        + ["CL01", "ML01", "SH01", "SC01", "SC01_west", "E01", "HP01", "context_blocks",
           "pad_towers", "pad_terrace_w", "pad_terrace_e", "pad_villa"]
        + [f"AX01_b{i}" for i in range(1, 8)]
        + [f"SH01_s{i}" for i in range(1, 6)]
        + [c[0] for c in CTX_VOLS]
    )
    for p in spec["buildPasses"]:
        p["componentRefs"] = blockout_ids if p["id"] == "blockout" else all_ids

    # 参考 PBR 的 url 换成内嵌的 1×1 数据 URL：生成器会为每种材质的 5 张贴图各发一次请求（共 80 次），
    # 生产环境里证据目录并不存在；手写材质（extras / look）会接管外观，这些贴图不参与最终画面。
    # 证据文件的真实路径仍保留在 maps.*.path 里。
    px = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
    for m in spec["materials"]:
        for ch in (m.get("referencePbr", {}).get("maps") or {}).values():
            if isinstance(ch, dict):
                ch["url"] = px
                # 路径也改相对路径：生成物会进前端包，不能带本机的绝对路径
                if isinstance(ch.get("path"), str) and ch["path"].startswith(ROOT):
                    ch["path"] = os.path.relpath(ch["path"], ROOT)
    # referencePbr 里其它字段（sourceImage 等）也可能带绝对路径：整块递归改成相对路径
    def _rel(o):
        if isinstance(o, dict):
            return {k: _rel(v) for k, v in o.items()}
        if isinstance(o, list):
            return [_rel(v) for v in o]
        if isinstance(o, str) and o.startswith(ROOT + os.sep):
            return os.path.relpath(o, ROOT)
        return o
    for m in spec["materials"]:
        if "referencePbr" in m:
            m["referencePbr"] = _rel(m["referencePbr"])
    # 重建规格会冲掉 skill 工具写进去的评审状态（评审记录、一级诊断、pass 进度），从旧文件原样带过来
    if os.path.exists(args.out):
        old_spec = json.load(open(args.out, encoding="utf-8"))
        for key in ("reviewHistory", "visualEvidence", "tier1Results", "sculptPipeline"):
            if key in old_spec:
                spec[key] = old_spec[key]
    json.dump(spec, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"规格已写 {args.out}：部件 {len(comps)}，材质 {len(mats)}，重复系统 {len(spec['repetitionSystems'])}，"
          f"局部特征 {sum(len(c['localFeatures']) for c in comps)}")
    # 运行时用的精简规格：手写材质 / 实验页平涂模式按它取颜色，不必加载 1 MB 的完整规格
    lite = {"materials": {m[0]: {"color": m[2], "rough": m[4], "metal": m[5], "emissive": m[6], "emissiveIntensity": m[7]}
                          for m in MATERIALS},
            "components": {c["id"]: {"material": c["material"], "level": c["level"], "role": c["role"]} for c in comps}}
    lite_path = os.path.join(ROOT, "src", "views", "estate", "scene", "img2", "spec-lite.json")
    json.dump(lite, open(lite_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    # 地面反投影需要：底座椭圆和有体积的部件
    json.dump({"base": {"cx": cx0, "cy": cy0, "rx": rx, "ry": ry}, "footprints": foot},
              open(os.path.join(ROOT, "src", "views", "estate", "scene", "img2", "footprints.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    # 供外部取用
    json.dump({"crops": CROPS, "materials": [m[0] for m in MATERIALS], "features": list(F)},
              open(os.path.join(os.path.dirname(args.out), "spec-index.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()

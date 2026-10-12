"""
综合能源补给站建模 · 外部车辆模型（Sketchfab CC-BY-4.0）
----------------------------------------------------------
把 models/energy/vendor/<目录>/scene.gltf（重卡）与 models/charging/vendor/ 里已有的两款小车导入并「标准化」：
合并部件 → 世界变换烘进顶点 → 删掉看不到的部件（驾驶室内饰、仪表盘零件）和带品牌 logo 的贴图材质 →
车头统一朝 +x、缩放到实车尺寸、原点放在地面 → 识别车轴 → 减面、贴图缩到 512。

车轴：按轮胎材质的顶点沿车长方向聚类得到各轴位置，再平移让
    牵引车前轴落在 x = +2.0，挂车牵引销落在 x = +5.8（牵引销取车厢前端后退 1.3 m）；
实测的后轴组 / 鞍座位置写成对象自定义属性（rig_*），随 glTF extras 导出，
three.js（src/views/energy/scene/vehicles.js）读 userData 让车身与挂车准确跟随路线。

用到的模型与署名（CC-BY-4.0 要求注明作者，页面右下角与 src/views/energy/data/station.js 的 MODEL_CREDITS 同步）：
- 牵引车：MAN TGX 2010 V8 – High-Detail Semi-Truck — DevPoly3D
  https://sketchfab.com/3d-models/34ce748d9a4b4de7b035cfe5cb97f5d1
- 牵引车：Mercedes-Benz Actros MP4 2016 — szymonpasterczyk734
  https://sketchfab.com/3d-models/314722c6a2f9471c99289d4ae55ef232
- 厢式半挂：Semi Trailer — NoblecatSoft
  https://sketchfab.com/3d-models/f507a422e9344e76934c5fbf06eb81d7
- 槽罐半挂：Gas Tanker — Unknown Canadian
  https://sketchfab.com/3d-models/055c6431cdaa440f85e2ac588c4a5ea8
- 轿车：Tesla Model 3 — David_Holiday（与 /charging 共用本地模型文件）
  https://sketchfab.com/3d-models/tesla-model-3-123c10f376ec4f18b93c73afc382808b
- SUV：Low Poly BMW X6M Competition — SharkyStudios
  https://sketchfab.com/3d-models/low-poly-bmw-x6m-competition-dbc45a151624413aac9a378b570ddd02
"""

import io
import math
import os
import re
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import lib

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
VENDOR = os.path.join(ROOT, "models", "energy", "vendor")
CHARGING_VENDOR = os.path.join(ROOT, "models", "charging", "vendor")
TEX_MAX = 512

# 各模型的标准化参数（数值来自导入后的包围盒与材质位置分析）
#   path      scene.gltf 所在目录
#   kind      tractor 牵引车 / trailer 挂车 / car 小车（决定原点与车轴的处理方式）
#   rot       绕 z 轴旋转（度），把车头转到 +x
#   scale     统一缩放系数；height 给定时按总高缩放
#   paint     换成可换色车漆（M_truck_paint / M_car_paint）的原材质名
#   replace   换成自建材质的原材质名 → palette 里的键
#   drop      删除的材质（车内饰等）
#   inside    删除包围盒完全落在该盒子里的部件（原始坐标 x0, x1, y0, y1, z0, z1）：驾驶室内饰
#   clip      删除面中心落在该盒子外的面（原始坐标）：散落在远处的仪表盘零件
#   tyre      轮胎材质（用于识别车轴）
#   decimate  减面比例（车辆在大屏上只有几十像素，每款压到约 1 万面以内，vehicles.glb 控制在 3 MB 左右）
SPEC = {
    # MAN TGX：前灯在 -y → 转 90°；单位约为实车的 6.6 倍，按车身宽 16.5 → 2.5 m 取 0.152；
    # 车漆是蓝色金属漆 Grey；玻璃几乎全透明，换成不透明深色玻璃（看不到车内空腔）
    "truck_tractor": dict(
        path=os.path.join(VENDOR, "man_tgx_2010_v8__high-detail_semi-truck"),
        kind="tractor", rot=90, scale=0.152, paint=("Grey",),
        replace={"Glass": "glass", "White_Light": "headlight", "Red_Light_Back": "taillight"},
        drop=(), tyre=("Tyre_sidewalls", "Tyre_tread"), decimate=0.3,
    ),
    # 奔驰 Actros：驾驶室在 -y → 转 90°；米制但略大（含导流罩高 4.3 m），缩 0.94；
    # 车漆 actros_body / actros_dl（原为黄绿色）；内饰 actros_salo 与驾驶室内的 sunburst 部件删掉。
    # 原模型没有轮胎（轮拱是空的，只有一个轮毂掉在原点地面下）：clip 的 z 下限裁掉那个轮毂，
    # wheels 按侧视渲染量出的轮拱位置补上程序化车轮（原始坐标：前轴 y -1.6、后轴 y 2.33，轮心高 0.56）
    "truck_tractor_b": dict(
        path=os.path.join(VENDOR, "mercedes-benz_actros_mp4_2016"),
        kind="tractor", rot=90, scale=0.94, paint=("actros_body", "actros_dl"),
        replace={"sunburst_glass": "glass", "mirror": "chrome"},
        drop=("actros_salo", "actros_screen"),
        inside=(-1.17, 1.17, -2.92, -0.6, 1.7, 3.9),
        clip=(-1.6, 1.6, -3.2, 3.6, 0.25, 4.3),
        wheels=dict(front=-1.6, rear=(2.33,), z=0.56, r=0.52, track=1.25),
        tyre=(), decimate=0.13,
    ),
    # 冷藏厢式半挂：冷机（Thermo King）在 +y → 转 -90°；模型缩小了约 4.65 倍，按总高 4.0 m 缩放；
    # 厢体贴图 paint_trailer 与图集 The_texture_of_the_trailer 带 NOBLECAT / SCANIA / Schmitz 等品牌标识，
    # 分别换成可换色车漆与深色材质
    "trailer_box": dict(
        path=os.path.join(VENDOR, "semi_trailer"),
        kind="trailer", rot=-90, height=4.0, paint=("paint_trailer",),
        replace={"The_texture_of_the_trailer": "dark"},
        drop=(), tyre=("Tyre_side",), decimate=0.06,
    ),
    # 槽罐半挂：尾灯在 +y → 车头 -y，转 90°；米制，长 11.6 m 偏短，放大 1.12 到 13 m 左右（LNG 低温槽车）；
    # 罐体 Main_Tank 换成不锈钢
    "trailer_tank": dict(
        path=os.path.join(VENDOR, "gas_tanker"),
        kind="trailer", rot=90, scale=1.12, paint=(),
        replace={"Main_Tank": "stainless"},
        drop=(), tyre=("Tires",), decimate=0.2,
    ),
    # 小车：与 /charging 相同的处理（参数取自 charging/vendor.py）
    "car_sedan": dict(
        path=os.path.join(CHARGING_VENDOR, "tesla_model_3"),
        kind="car", rot=90, height=1.44, paint=("CAR_PAINT",),
        replace={"Glass": "glass", "chrome": "chrome"}, drop=("Material.015",), decimate=0.35,
    ),
    # 宝马低模整车只有一个贴图材质（车身、车窗、车灯画在同一张图上），换成金属车漆会整车反光发亮，
    # 所以保留原贴图、不参与换色
    "car_suv": dict(
        path=os.path.join(CHARGING_VENDOR, "low_poly_bmw_x6m_competition"),
        kind="car", rot=180, scale=1.0, paint=(), replace={}, drop=(), decimate=None,
    ),
}


def available():
    """外部模型文件是否齐全（缺任何一个就整体退回自建车型）"""
    return all(os.path.exists(os.path.join(s["path"], "scene.gltf")) for s in SPEC.values())


def _base(name):
    """去掉 Blender 重名时追加的 .001 后缀"""
    return re.sub(r"\.\d{3}$", "", name)


def _import(path):
    """导入 glTF 到临时集合（屏蔽导入器的逐节点日志），返回网格对象与集合"""
    col = bpy.data.collections.new("_vendor_tmp")
    bpy.context.scene.collection.children.link(col)
    bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection.children[col.name]
    old = sys.stdout
    sys.stdout = io.StringIO()
    try:
        bpy.ops.import_scene.gltf(filepath=os.path.join(path, "scene.gltf"))
    finally:
        sys.stdout = old
    bpy.context.view_layer.update()
    return [o for o in col.all_objects if o.type == "MESH"], col


def _cleanup(col):
    for o in list(col.all_objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(col)


def _in_box(p, box):
    x0, x1, y0, y1, z0, z1 = box
    return x0 <= p.x <= x1 and y0 <= p.y <= y1 and z0 <= p.z <= z1


def _axles(xs, gap=0.5):
    """轮胎顶点的 x 坐标聚类成若干车轴，返回各轴中心（从前到后）"""
    xs = sorted(xs, reverse=True)
    groups, cur = [], [xs[0]]
    for x in xs[1:]:
        if cur[-1] - x > gap:
            groups.append(cur)
            cur = []
        cur.append(x)
    groups.append(cur)
    return [(g[0] + g[-1]) / 2 for g in groups if len(g) > 8]


def load(key, M):
    """导入并标准化一个外部模型，返回 (网格数据, rig 字典)"""
    spec = SPEC[key]
    meshes, col = _import(spec["path"])
    bm = bmesh.new()
    mats = []
    tyre_idx = set()
    paint_mat = M["truck_paint"] if spec["kind"] != "car" else M["car_paint"]
    for o in meshes:
        tmp = bmesh.new()
        tmp.from_mesh(o.data)
        bmesh.ops.transform(tmp, matrix=o.matrix_world, verts=tmp.verts)
        # 驾驶室内饰：整个部件都在内饰盒子里就丢掉
        if "inside" in spec and all(_in_box(v.co, spec["inside"]) for v in tmp.verts):
            tmp.free()
            continue
        slots = [s.material for s in o.material_slots]
        # 材质名：原名与去掉 .00x 后缀的名字都参与匹配（特斯拉的内饰材质原名就叫 Material.015）
        names = [(m.name, _base(m.name)) if m else ("", "") for m in slots]

        def hit(nm, keys):
            return nm[0] in keys or nm[1] in keys

        drop = []
        for f in tmp.faces:
            n = names[f.material_index] if names else ("", "")
            if hit(n, spec["drop"]) or ("clip" in spec and not _in_box(f.calc_center_median(), spec["clip"])):
                drop.append(f)
        bmesh.ops.delete(tmp, geom=drop, context="FACES")
        remap = []
        for m, n in zip(slots, names):
            if hit(n, spec.get("paint", ())):
                m = paint_mat
            elif hit(n, spec["replace"]):
                m = M[spec["replace"].get(n[0]) or spec["replace"][n[1]]]
            if m not in mats:
                mats.append(m)
            remap.append(mats.index(m))
            if hit(n, spec.get("tyre", ())):
                tyre_idx.add(mats.index(m))
        for f in tmp.faces:
            f.material_index = remap[f.material_index] if remap else 0
        lib._merge(bm, tmp)
    _cleanup(col)
    if "wheels" in spec:
        _add_wheels(bm, spec["wheels"], mats, M, tyre_idx)

    # 朝向与尺寸
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(spec["rot"]), 3, "Z"), verts=bm.verts)
    zs = [v.co.z for v in bm.verts]
    k = spec["height"] / (max(zs) - min(zs)) if spec.get("height") else spec.get("scale", 1.0)
    bmesh.ops.scale(bm, vec=(k, k, k), verts=bm.verts)

    # 原点：横向居中、贴地；纵向按车轴（牵引车前轴 +2.0 / 挂车牵引销 +5.8）或车身居中（小车）
    xs = [v.co.x for v in bm.verts]
    ys = [v.co.y for v in bm.verts]
    zmin = min(v.co.z for v in bm.verts)
    rig = {}
    if spec["kind"] == "car":
        dx = -(min(xs) + max(xs)) / 2
    else:
        tyre_x = [v.co.x for f in bm.faces if f.material_index in tyre_idx for v in f.verts]
        axles = _axles(tyre_x)
        if spec["kind"] == "tractor":
            dx = 2.0 - axles[0]
            rear = sum(axles[1:]) / len(axles[1:]) + dx
            rig = {"rig_front": 2.0, "rig_rear": round(rear, 3), "rig_fifth": round(rear + 0.25, 3)}
        else:
            dx = 5.8 - (max(xs) - 1.3)
            rig = {"rig_kingpin": 5.8, "rig_rear": round(sum(axles) / len(axles) + dx, 3)}
        rig["axles"] = len(axles)
    bmesh.ops.translate(bm, vec=(dx, -(min(ys) + max(ys)) / 2, -zmin), verts=bm.verts)
    rig["length"] = round(max(xs) - min(xs), 2)
    rig["height"] = round(max(v.co.z for v in bm.verts), 2)

    # 外部材质加前缀（避免与自建材质重名）、贴图缩小
    own = set(M.values())
    for m in mats:
        if m and m not in own and not m.name.startswith("V_"):
            m.name = f"V_{key}_{m.name}"
            _shrink_textures(m)
    me = lib.make_mesh(key, bm, mats, smooth_angle=35)
    if spec["decimate"]:
        me = _decimate(me, spec["decimate"])
    return me, rig


def _add_wheels(bm, w, mats, M, tyre_idx):
    """补程序化车轮（原始坐标，车长沿 y）：前轴单胎、后轴双胎，轮胎 + 轮毂两种材质"""
    for m in (M["tyre"], M["rim"]):
        if m not in mats:
            mats.append(m)
    ti, ri = mats.index(M["tyre"]), mats.index(M["rim"])
    tyre_idx.add(ti)
    for y, width in [(w["front"], 0.32)] + [(r, 0.62) for r in w["rear"]]:
        for sx in (-1, 1):
            x = sx * (w["track"] - width / 2)
            lib.add_cyl(bm, w["r"], width, (x, y, w["z"]), seg=24, mat=ti, axis="X")
            lib.add_cyl(bm, w["r"] * 0.6, 0.02, (x + sx * (width / 2 + 0.01), y, w["z"]), seg=16, mat=ri, axis="X")


def _shrink_textures(mat):
    if not mat.node_tree:
        return
    for n in mat.node_tree.nodes:
        img = getattr(n, "image", None) if n.type == "TEX_IMAGE" else None
        if img and max(img.size) > TEX_MAX:
            w, h = img.size
            s = TEX_MAX / max(w, h)
            img.scale(max(1, round(w * s)), max(1, round(h * s)))


def _decimate(me, ratio):
    """减面（Collapse），返回新网格"""
    ob = bpy.data.objects.new("_dec", me)
    bpy.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new("dec", "DECIMATE")
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    new = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    name = me.name
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.meshes.remove(me)
    new.name = name
    return new

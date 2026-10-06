"""
智慧充电站建模 · 外部模型（Sketchfab CC-BY-4.0）
----------------------------------------------------------
把 models/charging/vendor/<目录>/scene.gltf 导入并「标准化」成与自建预制件一致的网格：
合并所有部件 → 世界变换烘进顶点 → 去掉不需要的部件（车内饰）→ 统一朝向（车头 +x / 桩正面 -y）、
统一尺寸（米）与原点（底面中心）→ 减面 → 平滑着色。材质名加前缀避免与自建材质冲突。

用到的模型与署名（CC-BY-4.0 要求注明作者，页面与 README 同步列出）：
- 轿车：Tesla Model 3 — David_Holiday
  https://sketchfab.com/3d-models/tesla-model-3-123c10f376ec4f18b93c73afc382808b
- SUV：Low Poly BMW X6M Competition — SharkyStudios (sharkycat109)
  https://sketchfab.com/3d-models/low-poly-bmw-x6m-competition-dbc45a151624413aac9a378b570ddd02
- 快充桩：EV Charging Station — np-dev
  https://sketchfab.com/3d-models/ev-charging-station-d89eab4c0ffe440db1d126a050e9a0c9
以下两款为 CC-BY-NC-SA-4.0（署名 · 非商业 · 相同方式共享）：本项目是非商业演示，可以使用；
若将来转为商用，必须先替换掉这两款车（car_lavida_* / car_sylphy_*）
- 轿车：2020 Volkswagen e-Lavida PHEV — Ddiaz Design
  https://sketchfab.com/3d-models/2020-volkswagen-e-lavida-phev-b7e2c4af0c8241f4905c7b81e88e7c5d
- 轿车：2018 Nissan Sylphy EV Zero Emission — Ddiaz Design
  https://sketchfab.com/3d-models/2018-nissan-sylphy-ev-zero-emission-593973027771487fb2f1f41d2933c688
"""

import math
import os
import re

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import lib
from .build import ROOT

VENDOR_DIR = os.path.join(ROOT, "models", "charging", "vendor")

# 各模型的标准化参数（数值来自导入后的包围盒与部件分析）
#   dir     vendor 下的目录名
#   height  目标总高（米），None 表示原模型已是米制
#   rot     绕 z 轴旋转角度（度），把车头转到 +x、桩正面转到 -y
#   paint   车漆材质的原名（car_variant 换漆用）
#   drop    要删掉的材质（车内饰：俯视看不到，删掉能省一半以上的面）
#   replace 换成自建材质的原材质（半透明车窗删了内饰后会透空，统一换成不透明深色玻璃）
#   decimate 减面比例
SPEC = {
    # 特斯拉：车头在 -y（前大灯 LED_PHARE 的位置），整体高 194 个单位 → 实车 1.44 m
    "sedan": dict(
        dir="tesla_model_3", height=1.44, rot=90, paint="CAR_PAINT",
        drop=("Material.015",), replace={"Glass": "glass", "chrome": "chrome"}, decimate=0.6,
    ),
    # 宝马 X6M：已是米制，红色尾灯在 +x → 车头 -x，转 180°
    "suv": dict(dir="low_poly_bmw_x6m_competition", height=None, rot=180, paint="Material", drop=(), replace={}, decimate=None),
    # 大众朗逸：米制；后备箱内衬 trink 在 +y → 车头 -y，转 90°；约 12.5 万面，删内饰后约 7 万再减面
    "lavida": dict(
        dir="2020_volkswagen_e-lavida_phev", height=None, rot=90, paint="carpaint",
        drop=("inner_map", "inner_chair_map", "inner_chair_2", "inner_chair_3", "inner_door_1", "trink"),
        replace={"glass": "glass", "black_glass": "glass"}, decimate=0.2,
    ),
    # 日产轩逸纯电：米制，但底面在 z=-0.33；前脸充电口 charge_mat 在 -y → 转 90°；约 12 万面
    "sylphy": dict(
        dir="2018_nissan_sylphy_ev_zero_emission", height=None, rot=90, paint="paint",
        drop=("phong5", "inner_map", "door_inner_map", "door_R", "phong11", "trunk1"),
        replace={"glass1": "glass"}, decimate=0.18,
    ),
    # np-dev 快充桩：枪与线缆在 -y（已朝南），高 50 个单位 → 1.95 m；
    # 机身（不含垂下的线缆）的 y 范围用来定原点，让机身居中在桩岛上
    "pile": dict(dir="ev_charging_station", height=1.95, rot=0, paint=None, drop=(), replace={}, decimate=0.12, body_from_z=0.5),
}

# 外部模型贴图的最大边长：车在大屏上只占几十像素，512 足够，能明显减小 GLB 体积
TEX_MAX = 512


def _base(name):
    """去掉 Blender 重名时追加的 .001 后缀（同一会话多次导入会出现）"""
    return re.sub(r"\.\d{3}$", "", name)


def _match(name, names):
    return name in names or _base(name) in names


def _import(dir_name):
    """导入 glTF 到临时集合，返回网格对象列表与集合"""
    col = bpy.data.collections.new("_vendor_tmp")
    bpy.context.scene.collection.children.link(col)
    bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection.children[col.name]
    bpy.ops.import_scene.gltf(filepath=os.path.join(VENDOR_DIR, dir_name, "scene.gltf"))
    return [o for o in col.all_objects if o.type == "MESH"], col


def _cleanup(col):
    for o in list(col.all_objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(col)


def load(key, prefix, M=None):
    """
    导入并标准化一个外部模型，返回网格数据（名字 V_<key>）。
    材质改名为 <prefix>_<原名>；SPEC.replace 里的材质换成自建材质 M[...]
    """
    spec = SPEC[key]
    meshes, col = _import(spec["dir"])
    bm = bmesh.new()
    mats = []
    for o in meshes:
        tmp = bmesh.new()
        tmp.from_mesh(o.data)
        bmesh.ops.transform(tmp, matrix=o.matrix_world, verts=tmp.verts)
        slots = [s.material for s in o.material_slots]
        drop = [f for f in tmp.faces if slots and slots[f.material_index] and _match(slots[f.material_index].name, spec["drop"])]
        bmesh.ops.delete(tmp, geom=drop, context="FACES")
        remap = []
        for m in slots:
            # 需要替换的材质直接换成自建材质
            for src, dst in spec["replace"].items():
                if m and M and _match(m.name, (src,)):
                    m = M[dst]
                    break
            if m not in mats:
                mats.append(m)
            remap.append(mats.index(m))
        for f in tmp.faces:
            f.material_index = remap[f.material_index] if remap else 0
        lib._merge(bm, tmp)
    _cleanup(col)

    # 朝向：绕 z 轴旋转
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(spec["rot"]), 3, "Z"), verts=bm.verts)
    # 尺寸：按总高缩放到实物尺寸
    zs = [v.co.z for v in bm.verts]
    h = max(zs) - min(zs)
    if spec["height"]:
        k = spec["height"] / h
        bmesh.ops.scale(bm, vec=(k, k, k), verts=bm.verts)
    # 原点：底面中心（桩以机身部分定水平中心，忽略垂下的线缆）
    zmin = min(v.co.z for v in bm.verts)
    zmax = max(v.co.z for v in bm.verts)
    ref = [v for v in bm.verts if v.co.z > zmin + (zmax - zmin) * spec.get("body_from_z", 0)]
    cx = (min(v.co.x for v in ref) + max(v.co.x for v in ref)) / 2
    cy = (min(v.co.y for v in ref) + max(v.co.y for v in ref)) / 2
    bmesh.ops.translate(bm, vec=(-cx, -cy, -zmin), verts=bm.verts)

    # 外部材质改名（加前缀；不去掉 .0xx，特斯拉的原材质名本身就带编号），并把贴图缩到 TEX_MAX
    own = set(M.values()) if M else set()
    for m in mats:
        if m and m not in own and not m.name.startswith(prefix + "_"):
            m.name = f"{prefix}_{m.name}"
            _shrink_textures(m)
    me = lib.make_mesh(f"V_{key}", bm, mats, smooth_angle=35)

    if spec["decimate"]:
        me = _decimate(me, spec["decimate"])
    return me


def _shrink_textures(mat):
    """材质里超过 TEX_MAX 的贴图缩小（导出时按缩小后的像素写入 GLB）"""
    if not mat.node_tree:
        return
    for n in mat.node_tree.nodes:
        img = getattr(n, "image", None) if n.type == "TEX_IMAGE" else None
        if img and max(img.size) > TEX_MAX:
            w, h = img.size
            k = TEX_MAX / max(w, h)
            img.scale(max(1, round(w * k)), max(1, round(h * k)))


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


def car_variant(base, key, prefix, paint_mat, name):
    """车漆变体：复制网格，把车漆材质槽（<prefix>_<SPEC.paint>）换成指定颜色（其余材质共享）"""
    paint_name = f"{prefix}_{SPEC[key]['paint']}"
    me = base.copy()
    me.name = name
    for i, m in enumerate(me.materials):
        if m and m.name == paint_name:
            me.materials[i] = paint_mat
    return me

"""
井上地面输送 · 103 机头建模 · 静态件光照烘焙（Cycles）
----------------------------------------------------------
"只烘光照"（DIFFUSE，直接光 + 间接光，不含颜色）：颜色留在材质里，three.js 里挂 lightMap 相乘。
两张图集：
  lm_hero   主角件（驱动部机壳、轴承座、联轴器护罩、制动器、头部漏斗、清扫器、驱动平台），2048
  lm_struct 长结构（栈桥钢结构、屋面、巡检通道、护栏、输送机机架），4096
每个物体新建第二套 UV "Lightmap"（导出为 TEXCOORD_1，three.js 的 channel 1），按图集一起打包；
物体的 extras 写 lightmap = 图集名，页面据此挂贴图。
会动的（滚筒、输送带、煤、机器人）和关联复制的（托辊组）、发光件、远景不烘，用实时光照。

金属表面的漫反射为 0，烘焙前把所有材质的 Metallic 临时置 0（只影响光照图，不影响导出的材质）。
输出 models/coal-prep/bake/lm_*.png（scripts/coal-prep/lightmaps.py 去噪后转成 public/coal-prep/lm_*.webp）：存的是 sqrt(irradiance / LM_SCALE)，
页面解码时平方再乘 LM_SCALE（见 src/views/coal-prep/scene/theme.js 的 LIGHTMAP）。
"""

import os

import bpy
import numpy as np

from . import lights, preview

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT_DIR = os.path.join(ROOT, "public", "coal-prep")
BAKE_DIR = os.path.join(ROOT, "models", "coal-prep", "bake")
LM_SCALE = 4.0  # 光照图编码上限（irradiance 超过 4 的截断）

HERO = ("BC103-M1_body", "BC103-M2_body", "BC103-G1_body", "BC103-G2_body", "BC103-D1_body", "BC103-G1_coupling", "BC103-G2_coupling", "BC103-brake", "BC103-chute", "BC103-scraper", "STRUCT_drive_frame", "STRUCT_drive_floor", "STRUCT_p2_bearings", "STRUCT_lamp_bodies")
STRUCT = ("STRUCT_gallery", "STRUCT_roof", "STRUCT_deck", "STRUCT_walkway", "STRUCT_rails", "STRUCT_conveyor_frame", "RB01-rail")


def _prepare_uv(ob):
    """确保第一套 UV 存在（贴图用），再新建第二套 "Lightmap" 并设为活动层（打包写到它上面）"""
    if ob.data.users > 1:
        ob.data = ob.data.copy()
    me = ob.data
    if len(me.uv_layers) == 0:
        me.uv_layers.new(name="UVMap")
    lm = me.uv_layers.get("Lightmap") or me.uv_layers.new(name="Lightmap")
    me.uv_layers.active = lm


def _pack(objs, margin):
    """多个物体一起做 Lightmap Pack（同一张图集里互不重叠）"""
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    vl.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.lightmap_pack(PREF_CONTEXT="ALL_FACES", PREF_PACK_IN_ONE=True, PREF_NEW_UVLAYER=False, PREF_MARGIN_DIV=margin)
    bpy.ops.object.mode_set(mode="OBJECT")


def _bake_group(name, names, size, samples):
    objs = [bpy.data.objects[n] for n in names if n in bpy.data.objects and bpy.data.objects[n].type == "MESH"]
    for o in objs:
        _prepare_uv(o)
    _pack(objs, margin=0.08 if size <= 2048 else 0.05)
    img = bpy.data.images.get(name)
    if img is not None:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)
    # 每个材质里放一个选中的图像节点，烘焙结果写到它上面
    added = []
    for o in objs:
        for slot in o.material_slots:
            m = slot.material
            if m is None:
                continue
            n = m.node_tree.nodes.new("ShaderNodeTexImage")
            n.image = img
            m.node_tree.nodes.active = n
            added.append((m, n))
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
        o["lightmap"] = name
    vl.objects.active = objs[0]
    s = bpy.context.scene
    s.cycles.samples = samples
    s.render.bake.margin = 4
    s.render.bake.use_pass_direct = True
    s.render.bake.use_pass_indirect = True
    s.render.bake.use_pass_color = False
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=4, use_clear=True)
    for m, n in added:
        m.node_tree.nodes.remove(n)
    # 原始浮点结果另存 EXR（以后改编码不用重烘）
    os.makedirs(BAKE_DIR, exist_ok=True)
    img.filepath_raw = os.path.join(BAKE_DIR, name + ".exr")
    img.file_format = "OPEN_EXR"
    img.save()
    # 编码：sqrt(irradiance / LM_SCALE) → 8 位 WebP（暗部精度高一些）
    px = np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)
    enc = np.sqrt(np.clip(px[..., :3] / LM_SCALE, 0, 1))
    out = bpy.data.images.new(name + "_enc", size, size, alpha=False)
    arr = np.ones((size, size, 4), dtype=np.float32)
    arr[..., :3] = enc
    out.pixels.foreach_set(arr.ravel())
    # 注意：不要在写入像素之后改 colorspace_settings，Blender 会重新加载生成图像，像素被清空（存出全黑）
    # 先存 PNG 到 models/（Blender 直接存 WebP 会写出空图），再由 scripts/coal-prep/lightmaps.py 转成 WebP
    os.makedirs(BAKE_DIR, exist_ok=True)
    path = os.path.join(BAKE_DIR, name + ".png")
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()
    stats = {"objects": len(objs), "mean": float(px[..., :3].mean()), "p99": float(np.percentile(px[..., :3], 99)), "file": path}
    bpy.data.images.remove(out)
    return stats


def bake(size=4096, samples=256):
    os.makedirs(OUT_DIR, exist_ok=True)
    lights.build()
    preview.use_cycles(samples)
    # 金属度临时置 0：金属没有漫反射，光照图会全黑
    saved = {}
    for m in bpy.data.materials:
        if not m.node_tree:
            continue
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                saved[m.name] = n.inputs["Metallic"].default_value
                n.inputs["Metallic"].default_value = 0.0
    try:
        res = {"hero": _bake_group("lm_hero", HERO, 2048, samples), "struct": _bake_group("lm_struct", STRUCT, size, samples)}
    finally:
        for m in bpy.data.materials:
            if m.name in saved:
                n = next(x for x in m.node_tree.nodes if x.type == "BSDF_PRINCIPLED")
                n.inputs["Metallic"].default_value = saved[m.name]
    # 烘焙后的 UV 与 extras 存回 .blend，导出时一起带走
    bpy.ops.wm.save_mainfile()
    return res

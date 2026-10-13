"""
老家沙盘建模 · 导出 GLB
----------------------------------------------------------
HOMETOWN 集合 + 电线杆 / 电线（PREVIEW 里由 beauty.poles 生成）→ public/hometown/village.glb

约定：Y 轴向上（three.js：x = Blender x、y = Blender z、z = -Blender y），保留对象名
（home / house_<id> / tree_* / pond_water / ground / pole_* / wires），树导出为 GPU 实例，贴图转 WebP。
地面的十几种地块材质在网页里统一换成正交俯视贴图（bake.py），只有沙盘侧面的紫红土保留原材质。
夜景：立面材质（W_*，带窗）的自发光接上窗洞遮罩（只有窗玻璃是暖黄），强度由网页按户随机点亮；
我家的窗玻璃 H_glass、红灯笼 D_lantern 也在网页里点亮。
"""

import os

import bpy

from .build import ROOT

OUT = os.path.join(ROOT, "public", "hometown", "village.glb")


def _window_emission(on):
    """导出期间把窗洞遮罩接到立面材质的 Emission Color（强度 1）；导出后断开、强度归零。"""
    from .beauty import _window_mask
    mask = bpy.data.images.get("night_win") or _window_mask("night_win")
    for m in bpy.data.materials:
        if not m.name.startswith("W_") or m.name.endswith("_plain") or \
                m.name in ("W_old", "W_shed", "W_brick"):
            continue
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        node = nt.nodes.get("export_emit")
        if on:
            if node is None:
                node = nt.nodes.new("ShaderNodeTexImage")
                node.name = "export_emit"
                node.image = mask
            for l in list(bsdf.inputs["Emission Color"].links):
                nt.links.remove(l)
            for l in list(bsdf.inputs["Emission Strength"].links):
                nt.links.remove(l)
            nt.links.new(node.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = 1.0
        else:
            for l in list(bsdf.inputs["Emission Color"].links):
                nt.links.remove(l)
            bsdf.inputs["Emission Strength"].default_value = 0.0


def _web_ground():
    """网页用的地面副本：顶面只留一个材质（网页里统一换成俯视贴图）+ 侧面紫红土，
    平滑着色让相邻面共用顶点（逐面平直着色会把每个顶点拆开，体积翻好几倍）。
    返回 (原对象, 副本)；导出后调用 _restore_ground 删除副本、恢复名字。"""
    src = bpy.data.objects["ground"]
    me = src.data.copy()
    soil = next(i for i, m in enumerate(me.materials) if m.name == "G_soil")
    top = 0
    idx = [0] * len(me.polygons)
    me.polygons.foreach_get("material_index", idx)
    idx = [1 if i == soil else top for i in idx]
    keep = [me.materials[top], me.materials[soil]]
    me.materials.clear()
    for m in keep:
        me.materials.append(m)
    me.polygons.foreach_set("material_index", idx)
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    for name in [a.name for a in me.attributes if a.name == "bank"]:
        me.attributes.remove(me.attributes[name])
    src.name = "ground_src"
    ob = bpy.data.objects.new("ground", me)
    bpy.data.collections["HOMETOWN"].objects.link(ob)
    return src, ob


def _restore_ground(src, ob):
    me = ob.data
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.meshes.remove(me)
    src.name = "ground"


def _plain_base_colors(on):
    """效果图给树叶 / 稻株材质加了按实例随机色的节点（beauty.leaf_variation），glTF 导不出去
    （会变成白色）。导出期间断开 Base Color 的连线、改用原色，导出后接回去。"""
    for m in bpy.data.materials:
        if not m.get("varied"):
            continue
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        rgb = next(n for n in nt.nodes if n.type == "RGB")
        hsv = next(n for n in nt.nodes if n.type == "HUE_SAT")
        if on:
            for l in list(bsdf.inputs["Base Color"].links):
                nt.links.remove(l)
            bsdf.inputs["Base Color"].default_value = rgb.outputs[0].default_value
        else:
            nt.links.new(hsv.outputs["Color"], bsdf.inputs["Base Color"])


def export():
    src, web = _web_ground()
    vl = bpy.context.view_layer
    for ob in vl.objects:
        ob.select_set(False)
    sel = [o for o in bpy.data.collections["HOMETOWN"].all_objects
           if o is not src]
    sel += [o for o in bpy.data.collections["PREVIEW"].objects
            if o.name.startswith(("pole_", "wires"))]
    for ob in sel:
        ob.hide_set(False)
        ob.select_set(True)
    _window_emission(True)
    _plain_base_colors(True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    try:
        bpy.ops.export_scene.gltf(
            filepath=OUT,
            export_format="GLB",
            use_selection=True,
            export_yup=True,
            export_apply=True,
            export_lights=False,
            export_cameras=False,
            export_gpu_instances=True,
            export_image_format="WEBP",
            export_image_quality=85,
            export_materials="EXPORT",
            export_extras=False,
            export_attributes=False,
            # meshopt 压缩：three.js 的 MeshoptDecoder 自带解码器
            export_meshopt_compression_enable=True,
            export_draco_mesh_compression_enable=False,
        )
    finally:
        _window_emission(False)
        _plain_base_colors(False)
        _restore_ground(src, web)
    return {"village.glb_MB": round(os.path.getsize(OUT) / 1024 / 1024, 2)}

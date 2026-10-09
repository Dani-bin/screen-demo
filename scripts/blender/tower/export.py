"""
楼层模型 · 导出 GLB
----------------------------------------------------------
每座塔一个 GLB：public/building/tower_S.glb / tower_N.glb，内含该塔的全部楼层变体（对象名 = 变体名，如 off_85 与 off_85_v）。
导出前把楼板对象的材质换成「烘焙贴图」材质（models/tower/bake/<对象名>.png，转 WebP 打包进 GLB），家具对象换成顶点色材质；
three.js 里用 MeshBasicMaterial 显示（不再参与实时光照），所以不导出法线；网格用 meshopt 压缩（EXT_meshopt_compression）。
"""

import os

import bpy
import numpy as np

from .bake import BAKE_DIR
from .build import ROOT, TOWERS

OUT_DIR = os.path.join(ROOT, "public", "building")


def _baked_material(ob):
    """单一材质：烘焙图 → Base Color（UV 只有 Lightmap 一套）"""
    path = os.path.join(BAKE_DIR, ob.name + ".png")
    img = bpy.data.images.load(path, check_existing=True)
    m = bpy.data.materials.get("MB_" + ob.name) or bpy.data.materials.new("MB_" + ob.name)
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def _clamp_colors(me, cap=1.0):
    """
    顶点色烘焙结果是 HDR：灯盘自发光强度 12，烘出来十几；直接导出会在 three.js 里整片泛光。
    每个面角按最大通道等比压到 cap 以内（保留色相），灯盘读成纯亮的白 / 暖白，家具的明暗不变
    """
    attr = me.color_attributes["Bake"]
    n = len(attr.data)
    buf = np.empty(n * 4, dtype=np.float32)
    attr.data.foreach_get("color", buf)
    c = buf.reshape(n, 4)
    m = np.maximum(c[:, :3].max(axis=1, keepdims=True), 1e-6)
    c[:, :3] *= np.minimum(1.0, cap / m)
    attr.data.foreach_set("color", c.ravel())


def _vertex_material():
    """顶点色材质：Color Attribute（Bake）→ Base Color，导出器据此写出 COLOR_0"""
    m = bpy.data.materials.get("MB_vertex") or bpy.data.materials.new("MB_vertex")
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Bake"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def export():
    res = {}
    col = bpy.data.collections["TOWER"]
    for tag in TOWERS:
        obs = [o for o in col.objects if o.name.startswith(tag + "_")]
        copies = []
        for ob in obs:
            # 复制一份再改材质、改名（导出后删掉），不破坏 .blend 里供重新烘焙的原始材质
            me = ob.data.copy()
            for p in me.polygons:
                p.material_index = 0
            me.materials.clear()
            me.materials.append(_vertex_material() if ob.name.endswith("_v") else _baked_material(ob))
            if ob.name.endswith("_v"):
                _clamp_colors(me)
            cp = bpy.data.objects.new(ob.name[len(tag) + 1 :], me)
            col.objects.link(cp)
            copies.append(cp)
        vl = bpy.context.view_layer
        for o in bpy.context.scene.objects:
            o.select_set(False)
        for cp in copies:
            cp.select_set(True)
        path = os.path.join(OUT_DIR, f"tower_{tag}.glb")
        bpy.ops.export_scene.gltf(
            filepath=path,
            export_format="GLB",
            use_selection=True,
            export_yup=True,
            export_apply=False,
            export_normals=False,
            export_lights=False,
            export_cameras=False,
            export_extras=False,
            export_image_format="WEBP",
            export_image_quality=88,
            export_materials="EXPORT",
            # meshopt 压缩：three.js 的 MeshoptDecoder 自带解码器（不像 Draco 要额外部署 wasm 文件）
            export_meshopt_compression_enable=True,
            export_draco_mesh_compression_enable=False,
        )
        for cp in copies:
            me = cp.data
            bpy.data.objects.remove(cp, do_unlink=True)
            bpy.data.meshes.remove(me)
        res[os.path.basename(path)] = round(os.path.getsize(path) / 1024 / 1024, 2)
    return res

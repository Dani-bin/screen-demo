"""
综合能源补给站建模 · 导出 GLB
----------------------------------------------------------
STATION 集合  → public/energy/station.glb（场站模型，树 / 路灯等重复件导出为 GPU 实例）
VEHICLES 集合 → public/energy/vehicles.glb（车辆预制，three.js 按名字克隆）

导出约定：Y 轴向上、保留对象名（three.js 按名字找桩 / 车位 / 闸杆）、
贴图转 WebP 减小体积、自发光强度走 KHR_materials_emissive_strength。
"""

import os

import bpy

from .build import ROOT


def _select_collection(name):
    """只选中某个集合里的对象（导出用 use_selection）"""
    col = bpy.data.collections[name]
    # 被隐藏的集合里的对象无法选中，先临时显示
    col.hide_viewport = False
    vl = bpy.context.view_layer
    for ob in vl.objects:
        ob.select_set(False)
    for ob in col.all_objects:
        ob.hide_set(False)
        ob.select_set(True)
    return col


def export(out_dir=None):
    out_dir = out_dir or os.path.join(ROOT, "public", "energy")
    os.makedirs(out_dir, exist_ok=True)
    result = {}
    for col_name, file in (("STATION", "station.glb"), ("VEHICLES", "vehicles.glb")):
        _select_collection(col_name)
        path = os.path.join(out_dir, file)
        bpy.ops.export_scene.gltf(
            filepath=path,
            export_format="GLB",
            use_selection=True,
            export_yup=True,
            export_apply=True,
            export_lights=False,
            export_cameras=False,
            export_image_format="WEBP",
            export_image_quality=92,
            export_materials="EXPORT",
            # 车辆的车轴位置（rig_* 自定义属性）走 glTF extras，three.js 里在 userData 上
            export_extras=col_name == "VEHICLES",
            export_draco_mesh_compression_enable=False,
            export_gpu_instances=True,
        )
        result[file] = round(os.path.getsize(path) / 1024 / 1024, 2)
    return result

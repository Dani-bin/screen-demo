"""
智慧充电站建模 · 导出 GLB
----------------------------------------------------------
STATION 集合 → public/charging/station.glb（场站静态模型）
CARS 集合    → public/charging/cars.glb（车辆预制，three.js 按仿真克隆摆放）

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
    out_dir = out_dir or os.path.join(ROOT, "public", "charging")
    os.makedirs(out_dir, exist_ok=True)
    result = {}
    for col_name, file in (("STATION", "station.glb"), ("CARS", "cars.glb")):
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
            export_extras=False,
            export_draco_mesh_compression_enable=False,
        )
        result[file] = round(os.path.getsize(path) / 1024 / 1024, 2)
    bpy.data.collections["CARS"].hide_viewport = True
    return result

"""
园区建模 · 导出 GLB
----------------------------------------------------------
PARK 集合 → public/building/park.glb

导出约定：Y 轴向上（three.js 里 x 向东、y 向上、z 向南）、保留对象名（bld_<key> 供拾取高亮）、
树与路灯共享网格的副本导出为 GPU 实例（EXT_mesh_gpu_instancing，three.js 加载为 InstancedMesh），
贴图转 WebP、自发光强度走 KHR_materials_emissive_strength。
"""

import os

import bpy

from .build import ROOT

OUT = os.path.join(ROOT, "public", "building", "park.glb")


def export():
    col = bpy.data.collections["PARK"]
    vl = bpy.context.view_layer
    for ob in vl.objects:
        ob.select_set(False)
    for ob in col.all_objects:
        ob.hide_set(False)
        ob.select_set(True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
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
        export_image_quality=90,
        export_materials="EXPORT",
        export_extras=False,
        export_draco_mesh_compression_enable=False,
    )
    return {"park.glb": round(os.path.getsize(OUT) / 1024 / 1024, 2)}

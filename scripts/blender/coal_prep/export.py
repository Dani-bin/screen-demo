"""
井上地面输送 · 103 机头建模 · 导出 GLB
----------------------------------------------------------
SCENE 集合 → public/coal-prep/conveyor.glb（不含灯光、相机、PREVIEW / LIGHTS 集合）。
约定：Y 轴向上、保留对象名（页面按名字驱动滚筒 / 输送带 / 机器人、按设备编号拾取）、
托辊组关联复制 → GPU 实例、extras（lightmap 图集名）随节点导出、贴图转 WebP、网格 meshopt 压缩。
"""

import os

import bpy
from io_scene_gltf2.io.exp import meshopt as _meshopt

from .build import ROOT

# 提高 meshopt 顶点坐标精度（同 drone/export.py：默认 12 位尾数在 100 m 外会有厘米级抖动）
_meshopt.EXP_FILTER_BITS = 20


def export(out_dir=None):
    out_dir = out_dir or os.path.join(ROOT, "public", "coal-prep")
    os.makedirs(out_dir, exist_ok=True)
    vl = bpy.context.view_layer
    for ob in vl.objects:
        ob.select_set(False)
    col = bpy.data.collections["SCENE"]
    for ob in col.all_objects:
        ob.hide_set(False)
        ob.select_set(True)
    path = os.path.join(out_dir, "conveyor.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        use_active_scene=True,
        export_yup=True,
        export_apply=True,
        export_lights=False,
        export_cameras=False,
        export_image_format="WEBP",
        export_image_quality=88,
        export_materials="EXPORT",
        export_extras=True,
        export_texcoords=True,
        export_gpu_instances=True,
        export_meshopt_compression_enable=True,
    )
    return {"conveyor.glb": round(os.path.getsize(path) / 1024 / 1024, 2)}

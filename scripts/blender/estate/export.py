"""
澜岸云境沙盘 · 导出 GLB
----------------------------------------------------------
BUILDINGS 集合 → public/estate/buildings.glb（空物体 = 楼栋编号，<id>_body 可见网格，<id>_hull 外框盒；角点色 COLOR_0 = AO）
TREES 集合    → public/estate/trees.glb（tree_a / tree_b / tree_c / cone 四个树冠，页面只取几何）
网格 meshopt 压缩，提高坐标精度（同 drone/export.py）。
"""

import os

import bpy
from io_scene_gltf2.io.exp import meshopt as _meshopt

from .lib import OUT_DIR

_meshopt.EXP_FILTER_BITS = 20


def _export(coll_name, filename):
    vl = bpy.context.view_layer
    for ob in vl.objects:
        ob.select_set(False)
    col = bpy.data.collections[coll_name]
    for ob in col.all_objects:
        ob.hide_set(False)
        ob.select_set(True)
    path = os.path.join(OUT_DIR, filename)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        use_active_scene=True,
        export_yup=True,
        export_apply=False,
        export_lights=False,
        export_cameras=False,
        export_materials="EXPORT",
        export_normals=True,
        export_vertex_color="ACTIVE",
        export_active_vertex_color_when_no_material=True,
        export_extras=False,
        export_meshopt_compression_enable=True,
    )
    return round(os.path.getsize(path) / 1024, 1)


def export():
    os.makedirs(OUT_DIR, exist_ok=True)
    return {
        "buildings.glb(KB)": _export("BUILDINGS", "buildings.glb"),
        "trees.glb(KB)": _export("TREES", "trees.glb"),
    }

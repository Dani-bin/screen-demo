"""青原露天矿 · 导出 GLB → public/open-pit/pit.glb

约定同其他页面：Y 轴向上、保留物体名（页面按设备编号 / 物体名找节点）、贴图转 WebP、自发光走 KHR_materials_emissive_strength、
网格 meshopt 压缩。meshopt 的顶点位置精度要提到 20 位：默认 12 位共享指数，离原点 3 km 的顶点高度误差约 1.5 m，
这个场景延伸到 9 km，坑的台阶（每级 15 m）和地面层会互相穿插（drone 页面踩过的坑，见 CLAUDE.md /drone）。
"""
import os

import bpy
from io_scene_gltf2.io.exp import meshopt as _meshopt

from .build import COL, REPO

_meshopt.EXP_FILTER_BITS = 20


def export(out_dir=None):
    out_dir = out_dir or os.path.join(REPO, "public", "open-pit")
    os.makedirs(out_dir, exist_ok=True)
    col = bpy.data.collections[COL]
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    n = 0
    for o in col.all_objects:
        if o.type in ("CAMERA", "LIGHT"):
            continue
        o.hide_set(False)
        o.select_set(True)
        n += 1
    path = os.path.join(out_dir, "pit.glb")
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
        export_meshopt_compression_enable=True,
        # 只导出名为 pw 的颜色属性（台阶 / 排土场的设计稿投影权重，project.apply_dual），其它物体没有颜色属性
        export_vertex_color="NAME",
        export_vertex_color_name="pw",
    )
    return {"file": path, "objects": n, "mb": round(os.path.getsize(path) / 1024 / 1024, 2)}

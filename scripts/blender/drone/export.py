"""
无人机巡检 · 化工园区建模 · 导出 GLB
----------------------------------------------------------
PARK 集合  → public/drone/park.glb（园区静态场景；树 / 路灯 / 槽车等重复件导出为 GPU 实例）
FLEET 集合 → public/drone/fleet.glb（无人机预制件，页面克隆 4 架，桨叶 UAV_prop_1..4 单独转动）

导出约定：Y 轴向上、保留对象名（页面按设备编号找根节点、按 DK-0x_lid_L/R 开舱盖）、
贴图转 WebP、自发光强度走 KHR_materials_emissive_strength、网格用 meshopt 压缩
（three.js 的 MeshoptDecoder 自带解码器，不用额外部署 wasm）。
"""

import os

import bpy
from io_scene_gltf2.io.exp import meshopt as _meshopt

from .build import ROOT

# Blender 自带的 meshopt 编码对顶点坐标用"共享指数"滤波、尾数只有 12 位：
# 三个分量共用最大分量的指数，离原点 500 m 的顶点高度误差约 0.24 m，3 km 处约 1.5 m。
# 地面各层（农田 -0.25 / 草地 0 / 地块 0.08 / 远处的河 -0.15）都是世界坐标，
# 会被吸到同一高度互相打架（第 20 轮比对发现农田盖住了公用工程的地块）。
# 提到 20 位：3 km 处误差约 6 mm，滨江路沥青 / 草地（只差 2 cm）也分得开，文件只大几个百分点。
_meshopt.EXP_FILTER_BITS = 20


def _select_collection(name):
    col = bpy.data.collections[name]
    col.hide_viewport = False
    vl = bpy.context.view_layer
    for ob in vl.objects:
        ob.select_set(False)
    for ob in col.all_objects:
        ob.hide_set(False)
        ob.select_set(True)
    return col


def export(out_dir=None):
    out_dir = out_dir or os.path.join(ROOT, "public", "drone")
    os.makedirs(out_dir, exist_ok=True)
    result = {}
    for col_name, file in (("PARK", "park.glb"), ("FLEET", "fleet.glb")):
        _select_collection(col_name)
        path = os.path.join(out_dir, file)
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
            export_image_quality=90,
            export_materials="EXPORT",
            export_extras=True,
            # 无人机预制件不做实例化：4 片桨叶要保留 UAV_prop_1..4 的名字，页面单独转动
            export_gpu_instances=col_name == "PARK",
            export_meshopt_compression_enable=True,
        )
        result[file] = round(os.path.getsize(path) / 1024 / 1024, 2)
    return result

"""
澜岸云境沙盘 · 烘焙（Cycles）
----------------------------------------------------------
只烘"和光源无关"的环境遮挡，光照和阴影仍由页面实时算（时间滑块要能拖）：
  1. 楼栋顶点 AO：阳台板下、窗洞、壁柱根部、楼与楼之间的暗角 → 角点色 "Col"（导出为 COLOR_0，页面里和墙色相乘）
  2. 地面 AO：正俯视的正交相机 + 白色天光（0 次反弹），地面被楼体挡住的天空比例 → models/estate/ground_ao_raw.png
     （线性值；`python3 scripts/estate/ground_ao_post.py` 转成 public/estate/ground_ao.webp，页面把它乘到地面画布上）
树和围墙不在 Blender 里（页面里的树是随机撒的），它们的接触阴影仍由页面画进地面。
"""

import math
import os

import bpy

from .lib import MODEL_DIR, ROOT

# 地面画布覆盖的平面范围（要和 src/views/estate/scene/ground.js 一致）：以底座椭圆的外接矩形为界
BASE = {"cx": 10.0, "cy": -6.0, "rx": 285.0, "ry": 208.0}


def _gpu(scene):
    """能用 Metal 就用 GPU，没有就留在 CPU"""
    scene.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        ok = False
        for d in prefs.devices:
            d.use = True
            ok = ok or d.type != "CPU"
        scene.cycles.device = "GPU" if ok else "CPU"
    except Exception as e:  # noqa: BLE001
        print("GPU 设置失败，用 CPU：", e)
        scene.cycles.device = "CPU"


def _world(scene, strength=1.0):
    w = scene.world or bpy.data.worlds.new("W")
    scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (1, 1, 1, 1)
    bg.inputs[1].default_value = strength
    return w


def vertex_ao(samples=64, distance=14.0, floor=0.5):
    """楼栋顶点 AO：烘焙后做一次提亮重映射（v → floor + (1 − floor)·v），避免暗处发黑"""
    scene = bpy.context.scene
    _gpu(scene)
    scene.cycles.samples = samples
    w = _world(scene)
    try:
        w.light_settings.distance = distance
    except Exception as e:  # noqa: BLE001
        print("AO 距离设置失败：", e)
    objs = [o for o in bpy.data.collections["BUILDINGS"].all_objects if o.type == "MESH" and o.name.endswith("_body")]
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    vl.objects.active = objs[0]
    bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
    n = 0
    for o in objs:
        attr = o.data.color_attributes.get("Col")
        for d in attr.data:
            v = d.color[0]
            k = floor + (1.0 - floor) * v
            d.color = (k, k, k, 1.0)
            n += 1
        # 朝上的面（屋面、阳台板顶）整块是敞开的，但四个角都贴着女儿墙 / 栏板，角点插值会把整块屋面染成暗的：直接记为 1
        for poly in o.data.polygons:
            if poly.normal.z > 0.9:
                for li in poly.loop_indices:
                    attr.data[li].color = (1.0, 1.0, 1.0, 1.0)
    return {"vertex_ao_objects": len(objs), "corners": n}


def ground_ao(size=4096, samples=96):
    """地面 AO：正交俯视，白天光 0 次反弹，出图的明暗 = 天空可见度（楼脚下暗、空地亮）"""
    scene = bpy.context.scene
    _gpu(scene)
    dx, dy = BASE["rx"] * 2, BASE["ry"] * 2
    w, h = size, round(size * dy / dx)
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = 100
    scene.cycles.samples = samples
    scene.cycles.max_bounces = 0
    scene.cycles.diffuse_bounces = 0
    scene.cycles.glossy_bounces = 0
    scene.cycles.use_denoising = True
    _world(scene, 1.0)
    # 所有物体统一成纯白漫反射
    mat = bpy.data.materials.new("ao_white")
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    df = nt.nodes.new("ShaderNodeBsdfDiffuse")
    df.inputs["Color"].default_value = (1, 1, 1, 1)
    nt.links.new(df.outputs[0], out.inputs[0])
    vl = bpy.context.view_layer
    vl.material_override = mat
    # 预览地面藏起来，换一块只给 AO 用的大地面（z = 0）
    pv = bpy.data.objects.get("pv_ground")
    if pv:
        pv.hide_render = True
    bpy.ops.mesh.primitive_plane_add(size=3000, location=(BASE["cx"], BASE["cy"], 0.0))
    ground = bpy.context.active_object
    ground.name = "ao_ground"
    # 相机
    cam = bpy.data.cameras.new("AO")
    cam.type = "ORTHO"
    cam.ortho_scale = dx
    cam.clip_end = 3000
    co = bpy.data.objects.new("AO", cam)
    scene.collection.objects.link(co)
    co.location = (BASE["cx"], BASE["cy"], 600.0)
    co.rotation_euler = (0, 0, 0)
    scene.camera = co
    vs = scene.view_settings
    vs.view_transform, vs.look, vs.exposure, vs.gamma = "Raw", "None", 0.0, 1.0
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "16"
    scene.render.image_settings.color_mode = "RGB"
    path = os.path.join(MODEL_DIR, "ground_ao_raw.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    # 清理临时物体
    vl.material_override = None
    bpy.data.objects.remove(co, do_unlink=True)
    bpy.data.objects.remove(ground, do_unlink=True)
    if pv:
        pv.hide_render = False
    return {"ground_ao": path, "size": [w, h]}


def bake(samples=64, size=4096):
    out = {}
    out.update(vertex_ao(samples))
    out.update(ground_ao(size, max(samples, 96)))
    bpy.ops.wm.save_mainfile()
    return out

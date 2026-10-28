"""
井上地面输送 · 103 机头建模 · 同机位预览
----------------------------------------------------------
用定稿概念图（concept-r3，1536 × 864）反求的透视相机（src/views/coal-prep/data/camera.json）
在 Blender 里摆一台一样的相机，渲染 1536 × 864，直接和 concept-r3.png 叠图核对。
只用于核对，不导出到 GLB。

坐标换算：camera.json 的 three 块是 three.js 坐标 (X, Y, Z) = (x, z, -y)，Blender 里 (x, y, z) = (X, -Z, Y)。
"""

import json
import math
import os

import bpy
from mathutils import Matrix, Vector

from . import lib, lights

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CAMERA_JSON = os.path.join(ROOT, "src", "views", "coal-prep", "data", "camera.json")


def _b(v):
    """three.js 坐标 → Blender 坐标"""
    return Vector((v[0], -v[2], v[1]))


def camera():
    """按标定结果摆相机（含滚转），返回相机对象"""
    cj = json.load(open(CAMERA_JSON, encoding="utf-8"))["three"]
    col = lib.collection("PREVIEW")
    cam = bpy.data.cameras.get("C_design") or bpy.data.cameras.new("C_design")
    cam.type = "PERSP"
    cam.sensor_fit = "VERTICAL"
    cam.angle_y = math.radians(cj["fov"])
    cam.clip_start = 0.1
    cam.clip_end = 3000
    cob = bpy.data.objects.get("C_design") or bpy.data.objects.new("C_design", cam)
    if cob.name not in col.objects:
        col.objects.link(cob)
    pos, tgt, up = _b(cj["position"]), _b(cj["target"]), _b(cj["up"])
    fwd = (tgt - pos).normalized()
    right = fwd.cross(up).normalized()
    up2 = right.cross(fwd).normalized()
    cob.matrix_world = Matrix.Translation(pos) @ Matrix((right, up2, -fwd)).transposed().to_4x4()
    bpy.context.scene.camera = cob
    return cob


def use_eevee(res=(1536, 864), samples=64):
    s = bpy.context.scene
    s.render.engine = "BLENDER_EEVEE"
    s.render.resolution_x, s.render.resolution_y = res
    s.render.resolution_percentage = 100
    s.render.film_transparent = False
    s.view_settings.view_transform = "Standard"
    s.view_settings.look = "None"
    s.eevee.taa_render_samples = samples
    s.eevee.use_shadows = True
    s.eevee.use_raytracing = True
    s.eevee.use_fast_gi = True


def use_cycles(samples=128):
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.samples = samples
    s.cycles.use_denoising = True
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        s.cycles.device = "GPU"
    except (TypeError, AttributeError):
        s.cycles.device = "CPU"


def _compositor(s):
    """合成器：渲染层 → 辉光（灯具光晕）→ 输出（与页面的 UnrealBloom 阈值同量级）"""
    ng = s.compositing_node_group
    if ng is None:
        ng = bpy.data.node_groups.new("CMP_coal", "CompositorNodeTree")
        s.compositing_node_group = ng
    ng.nodes.clear()
    if not ng.interface.items_tree:
        ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    rl = ng.nodes.new("CompositorNodeRLayers")
    gl = ng.nodes.new("CompositorNodeGlare")
    out = ng.nodes.new("NodeGroupOutput")
    gl.inputs["Type"].default_value = "Bloom"
    gl.inputs["Quality"].default_value = "High"
    gl.inputs["Threshold"].default_value = 1.1
    gl.inputs["Strength"].default_value = 0.6
    gl.inputs["Size"].default_value = 0.5
    ng.links.new(rl.outputs["Image"], gl.inputs["Image"])
    ng.links.new(gl.outputs["Image"], out.inputs[0])


def setup(engine="eevee"):
    s = bpy.context.scene
    n = lights.build()
    camera()
    if engine == "cycles":
        use_cycles()
        s.render.resolution_x, s.render.resolution_y = 1536, 864
        s.render.resolution_percentage = 100
        s.view_settings.view_transform = "Standard"
    else:
        use_eevee()
    _compositor(s)
    return {"lights": n}


def render(path):
    s = bpy.context.scene
    s.render.filepath = path
    s.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    return path

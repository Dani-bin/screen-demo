"""
无人机巡检 · 化工园区建模 · 同机位预览
----------------------------------------------------------
用定稿标定出的相机（docs/design/drone/07-camera.json，透视、竖直视场角 23°）在 Blender 里摆一台
一样的相机，打黄昏光，渲染 1920×1080，和定稿的场景区域叠图核对（scripts/drone/compare_scene.py）。
只用于核对，不导出到 GLB。

坐标换算：07-camera.json 的 three 块是 three.js 坐标 (X, Y, Z) = (x, z, -y)，
Blender 里 (x, y, z) = (X, -Z, Y)。

黄昏光：太阳从画面左侧（西边）低角度照过来，暖橙色；天空上蓝紫、地平线橙；
装置区和路灯的钠灯靠材质自发光 + 合成器辉光。
"""

import json
import math
import os

import bpy
from mathutils import Matrix, Vector

from . import lib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CAMERA_JSON = os.path.join(ROOT, "docs", "design", "drone", "07-camera.json")


def _b(v):
    """three.js 坐标 → Blender 坐标"""
    return Vector((v[0], -v[2], v[1]))


def setup(res=(1920, 1080), samples=48):
    s = bpy.context.scene
    col = lib.collection("PREVIEW")
    s.render.engine = "BLENDER_EEVEE"
    s.render.resolution_x, s.render.resolution_y = res
    s.render.resolution_percentage = 100
    s.render.film_transparent = False
    try:
        s.view_settings.view_transform = "AgX"
        s.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    s.eevee.taa_render_samples = samples
    s.eevee.use_shadows = True
    s.eevee.use_raytracing = True
    s.eevee.use_fast_gi = True

    # 世界：上方蓝紫、地平线附近偏橙（按视线高度插值的天空渐变）
    w = bpy.data.worlds.get("W_dusk") or bpy.data.worlds.new("W_dusk")
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    bg = nt.nodes.new("ShaderNodeBackground")
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    # 世界的 Generated 坐标就是视线方向，Z 在 -1..1：0 = 地平线，1 = 天顶
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.0, (0.62, 0.30, 0.13, 1)
    els[1].position, els[1].color = 0.35, (0.03, 0.035, 0.09, 1)
    mid = els.new(0.08)
    mid.color = (0.22, 0.12, 0.16, 1)
    bg.inputs["Strength"].default_value = 0.8
    s.world = w

    # 夕阳：从西（-x）略偏南、高度角 6°，暖橙色，柔和阴影
    sun = bpy.data.lights.get("L_sun") or bpy.data.lights.new("L_sun", "SUN")
    sun.energy = 5.5
    sun.color = (1.0, 0.62, 0.36)
    sun.angle = math.radians(3)
    ob = bpy.data.objects.get("L_sun") or bpy.data.objects.new("L_sun", sun)
    if ob.name not in col.objects:
        col.objects.link(ob)
    d = Vector((-math.cos(math.radians(6)) * 0.97, -0.25, math.sin(math.radians(6)))).normalized()
    ob.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    # 天光补光：冷蓝，从东北上方
    fill = bpy.data.lights.get("L_fill") or bpy.data.lights.new("L_fill", "SUN")
    fill.energy = 1.2
    fill.color = (0.5, 0.6, 1.0)
    ob2 = bpy.data.objects.get("L_fill") or bpy.data.objects.new("L_fill", fill)
    if ob2.name not in col.objects:
        col.objects.link(ob2)
    ob2.rotation_euler = (math.radians(35), 0, math.radians(140))

    # 标定相机
    cj = json.load(open(CAMERA_JSON, encoding="utf-8"))["three"]
    cam = bpy.data.cameras.get("C_design") or bpy.data.cameras.new("C_design")
    cam.type = "PERSP"
    cam.sensor_fit = "VERTICAL"
    cam.angle_y = math.radians(cj["fov"])
    cam.clip_start = 5
    cam.clip_end = 8000
    cob = bpy.data.objects.get("C_design") or bpy.data.objects.new("C_design", cam)
    if cob.name not in col.objects:
        col.objects.link(cob)
    pos, tgt, up = _b(cj["position"]), _b(cj["target"]), _b(cj["up"])
    fwd = (tgt - pos).normalized()
    right = fwd.cross(up).normalized()
    up2 = right.cross(fwd).normalized()
    # 相机看向 -Z，上方向 +Y
    rot = Matrix((right, up2, -fwd)).transposed()
    cob.matrix_world = Matrix.Translation(pos) @ rot.to_4x4()
    s.camera = cob
    _compositor(s)
    return {"camera": [round(v, 1) for v in pos], "fov": cj["fov"]}


def _compositor(s):
    """合成器：渲染层 → 辉光（钠灯、火炬火焰的光晕）→ 输出"""
    ng = s.compositing_node_group
    if ng is None:
        ng = bpy.data.node_groups.new("CMP_drone", "CompositorNodeTree")
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
    gl.inputs["Strength"].default_value = 0.7
    gl.inputs["Size"].default_value = 0.55
    ng.links.new(rl.outputs["Image"], gl.inputs["Image"])
    ng.links.new(gl.outputs["Image"], out.inputs[0])


def render(path):
    s = bpy.context.scene
    s.render.filepath = path
    s.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    return path

"""
园区建模 · 预览渲染设置（复制自 charging/preview.py）
----------------------------------------------------------
只用于在 Blender 里出效果图、与设计稿对照（不导出到 GLB）：
正交相机从东南偏东俯瞰（园区南北长轴横向铺开、双子塔在后排），深海军蓝世界光、弱月光，
Eevee + 合成器辉光（Blender 5 的 Eevee 去掉了内置 Bloom，改用 Glare 节点）。
three.js 页面的相机方位 / 俯角与这里一致，方便逐张对照。
"""

import math

import bpy
from mathutils import Vector

from . import lib


def setup(res=(1536, 1024), ortho_scale=980.0, target=(145, -20, 0), azimuth=-25.0, elevation=35.0):
    """
    azimuth：相机方位角（度，0 为 +x 东，逆时针为正）；-25 即东南偏东方向。
    elevation：俯角（度）。
    """
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
    s.eevee.taa_render_samples = 48
    s.eevee.use_shadows = True
    s.eevee.use_raytracing = True
    s.eevee.use_fast_gi = True

    # 世界：深海军蓝，强度低，让画面主要靠自发光撑亮度
    w = bpy.data.worlds.get("W_night") or bpy.data.worlds.new("W_night")
    if w.node_tree is None:
        w.use_nodes = True
    nt = w.node_tree
    bg = next((n for n in nt.nodes if n.type == "BACKGROUND"), None)
    if bg is None:
        # Blender 5 新建的世界不带节点，补上背景 + 输出
        nt.nodes.clear()
        bg = nt.nodes.new("ShaderNodeBackground")
        wo = nt.nodes.new("ShaderNodeOutputWorld")
        nt.links.new(bg.outputs["Background"], wo.inputs["Surface"])
    bg.inputs["Color"].default_value = (0.004, 0.009, 0.024, 1)
    bg.inputs["Strength"].default_value = 1.2
    s.world = w

    # 月光：从西北上方打下来，冷色，形成柔和阴影
    sun = bpy.data.lights.get("L_moon") or bpy.data.lights.new("L_moon", "SUN")
    sun.energy = 3.2
    sun.color = (0.7, 0.8, 1.0)
    sun.angle = math.radians(8)
    ob = bpy.data.objects.get("L_moon") or bpy.data.objects.new("L_moon", sun)
    if ob.name not in col.objects:
        col.objects.link(ob)
    ob.rotation_euler = (math.radians(50), 0, math.radians(-40))
    # 补光：低强度天光（世界光已很暗，再加一盏面光抬起暗部）
    fill = bpy.data.lights.get("L_fill") or bpy.data.lights.new("L_fill", "SUN")
    fill.energy = 1.4
    fill.color = (0.45, 0.6, 1.0)
    ob2 = bpy.data.objects.get("L_fill") or bpy.data.objects.new("L_fill", fill)
    if ob2.name not in col.objects:
        col.objects.link(ob2)
    ob2.rotation_euler = (math.radians(30), 0, math.radians(150))

    # 正交相机
    cam = bpy.data.cameras.get("C_iso") or bpy.data.cameras.new("C_iso")
    cam.type = "ORTHO"
    cam.ortho_scale = ortho_scale
    cam.clip_end = 5000
    cob = bpy.data.objects.get("C_iso") or bpy.data.objects.new("C_iso", cam)
    if cob.name not in col.objects:
        col.objects.link(cob)
    az, el = math.radians(azimuth), math.radians(elevation)
    d = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
    t = Vector(target)
    cob.location = t + d * 1500
    cob.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    s.camera = cob

    _compositor(s)


def _compositor(s):
    """合成器：渲染层 → 辉光（Bloom）→ 输出"""
    ng = s.compositing_node_group
    if ng is None:
        ng = bpy.data.node_groups.new("CMP_preview", "CompositorNodeTree")
        s.compositing_node_group = ng
    ng.nodes.clear()
    if not ng.interface.items_tree:
        ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    rl = ng.nodes.new("CompositorNodeRLayers")
    gl = ng.nodes.new("CompositorNodeGlare")
    out = ng.nodes.new("NodeGroupOutput")
    gl.inputs["Type"].default_value = "Bloom"
    gl.inputs["Quality"].default_value = "High"
    gl.inputs["Threshold"].default_value = 0.9
    gl.inputs["Strength"].default_value = 0.85
    gl.inputs["Size"].default_value = 0.65
    ng.links.new(rl.outputs["Image"], gl.inputs["Image"])
    ng.links.new(gl.outputs["Image"], out.inputs[0])
    rl.location, gl.location, out.location = (-400, 0), (0, 0), (300, 0)


def render(path):
    """渲染当前相机到 PNG"""
    s = bpy.context.scene
    s.render.filepath = path
    s.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    return path


def use_cycles(samples=128, res=(1536, 1024)):
    """
    切到 Cycles 离线渲染（GPU / Metal）：自发光灯带、面光会真实地照亮周围地面，
    得到光斑、溢光、软阴影与环境遮蔽，用于出「照片级」对比图或 2.5D 底图。
    """
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "GPU"
    s.cycles.samples = samples
    s.cycles.use_denoising = True
    s.cycles.denoiser = "OPENIMAGEDENOISE"
    s.cycles.max_bounces = 6
    s.cycles.caustics_reflective = False
    s.cycles.caustics_refractive = False
    s.render.resolution_x, s.render.resolution_y = res
    # Cycles 里世界光照比 Eevee 更「实」，调暗一些保持夜景氛围
    w = s.world
    # 界面为中文时新建节点的名字会被翻译，按类型查找
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    # 环境光与月光压低，让路灯 / 地灯 / 窗灯形成明暗对比（设计稿的「光影感」）
    bg.inputs["Strength"].default_value = 0.35
    for name, e in (("L_moon", 0.55), ("L_fill", 0.2)):
        li = bpy.data.lights.get(name)
        if li:
            li.energy = e

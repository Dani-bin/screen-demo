"""
井上地面输送 · 103 机头建模 · 黄昏光照（预览和烘焙共用，不导出）
----------------------------------------------------------
- 世界：天顶深蓝 → 地平线暖橙（概念图右侧地平线最亮）
- 夕阳：从驱动侧偏机尾方向、高度角 4° 照过来，暖橙色，给驱动部和筒仓勾轮廓
- 栈桥灯：每盏灯具下一块暖色面光（钠灯 / 暖白 LED，约 3000 K）
- 栈桥下方的场地投光灯：两盏暖色点光（概念图左下、右下的亮灯）
只在 LIGHTS 集合里，导出时不选中。
"""

import math

import bpy
from mathutils import Vector

from . import layout, lib


def _world(strength=1.0):
    s = bpy.context.scene
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
    # 世界 Generated 坐标即视线方向，Z：0 = 地平线，1 = 天顶
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.0, (0.95, 0.38, 0.13, 1)
    els[1].position, els[1].color = 0.45, (0.035, 0.05, 0.13, 1)
    mid = els.new(0.06)
    mid.color = (0.42, 0.2, 0.26, 1)
    mid2 = els.new(0.18)
    mid2.color = (0.12, 0.12, 0.26, 1)
    bg.inputs["Strength"].default_value = strength
    s.world = w


def build(world_strength=1.0, sun_energy=3.5, lamp_power=200.0):
    """建（或重建）全部灯光，返回灯的数量"""
    col = lib.collection("LIGHTS")
    for ob in list(col.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    _world(world_strength)
    n = 0

    sun = bpy.data.lights.new("L_sun", "SUN")
    sun.energy = sun_energy
    sun.color = (1.0, 0.58, 0.32)
    sun.angle = math.radians(2.5)
    ob = bpy.data.objects.new("L_sun", sun)
    col.objects.link(ob)
    # 光线从方位 118°（驱动侧偏机尾）、高度角 4° 射来
    az, el = math.radians(118), math.radians(4)
    d = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
    ob.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    n += 1

    # 栈桥灯：灯具下方的面光（只给镜头附近 50 m 内的灯，远处靠发光材质）
    for x in [-0.5] + [-3 - 6 * i for i in range(9)]:
        z = layout.ROOF_Z - 0.26 if x < -4 else layout.ROOF_Z + 0.82
        li = bpy.data.lights.new(f"L_lamp_{n}", "AREA")
        li.shape = "RECTANGLE"
        li.size, li.size_y = 0.5, 0.26
        li.energy = lamp_power
        li.color = (1.0, 0.78, 0.52)
        o = bpy.data.objects.new(li.name, li)
        o.location = (x, 0.4, z)
        col.objects.link(o)
        n += 1

    # 场地投光灯（栈桥下方左右两盏）
    for name, loc, e in (("L_yard_L", (-16.0, -7.5, -5.0), 1500.0), ("L_yard_R", (2.5, 5.2, -1.2), 1600.0)):
        li = bpy.data.lights.new(name, "POINT")
        li.energy = e
        li.color = (1.0, 0.7, 0.4)
        li.shadow_soft_size = 0.4
        o = bpy.data.objects.new(name, li)
        o.location = loc
        col.objects.link(o)
        n += 1
    return n

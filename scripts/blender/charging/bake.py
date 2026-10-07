"""
智慧充电站建模 · 地面光照烘焙
----------------------------------------------------------
用 Cycles 把「最终画面」烘焙进地面贴图（COMBINED：沥青贴图 × 光照）：
雨棚下的光斑、灯带与储能柜的溢光、建筑 / 雨棚 / 树的软阴影、环境遮蔽。
three.js 里地面直接用这张图做无光照材质（MeshBasicMaterial），实时版也能有离线渲染的地面质感。

烘焙时隐藏会随仿真变化的东西（停放车辆、充电线、告警波纹、车位状态描边），
避免把某一时刻的状态「印」在地上。输出 public/charging/ground_bake.webp。
"""

import os

import bpy

from .build import ROOT

# 烘焙时要藏起来的对象（名字前缀）：随仿真变化，不能烙进静态贴图
DYNAMIC_PREFIX = ("pv_car_", "pv_cable_", "pv_alarm_", "bay_", "pv_underglow")


def bake(size=2048, samples=64):
    s = bpy.context.scene
    from . import preview

    preview.use_cycles(samples=samples)
    s.cycles.samples = samples
    s.render.bake.margin = 4

    hidden = []
    for ob in bpy.data.objects:
        if ob.name.startswith(DYNAMIC_PREFIX) and not ob.hide_render:
            ob.hide_render = True
            hidden.append(ob)

    try:
        return _bake(s, size)
    finally:
        # 无论烘焙成功与否，都恢复被临时隐藏的动态对象
        for ob in hidden:
            ob.hide_render = False


def _bake(s, size):
    ground = bpy.data.objects["ground"]
    me = ground.data
    # 烘焙目标写到 Lightmap UV；贴图采样仍走第一套 UV（active_render 不变）
    me.uv_layers.active = me.uv_layers["Lightmap"]

    img = bpy.data.images.get("T_ground_bake") or bpy.data.images.new("T_ground_bake", size, size, alpha=False)
    if img.size[0] != size:
        img.scale(size, size)
    # 两个材质槽都放一个选中的图像节点：Cycles 烘焙到每个材质的「活动图像节点」
    nodes = []
    for slot in ground.material_slots:
        nt = slot.material.node_tree
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img
        nt.nodes.active = n
        nodes.append((nt, n))

    vl = bpy.context.view_layer
    vl.update()  # 同一次执行里刚重建过场景，先刷新视图层
    for ob in vl.objects:
        if ob is not None:
            ob.select_set(False)
    ground.select_set(True)
    vl.objects.active = ground
    bpy.ops.object.bake(type="COMBINED", use_clear=True, margin=4)

    out = os.path.join(ROOT, "public", "charging", "ground_bake.webp")
    img.filepath_raw = out
    img.file_format = "WEBP"
    s.render.image_settings.quality = 90
    img.save()

    for nt, n in nodes:
        nt.nodes.remove(n)
    me.uv_layers.active = me.uv_layers[0]
    return out

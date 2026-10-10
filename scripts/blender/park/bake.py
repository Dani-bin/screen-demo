"""
园区建模 · 地面光照烘焙
----------------------------------------------------------
设计稿的质感大半来自光：路灯在地上的暖色光斑、楼体窗灯与大堂对周围地面的溢光、树与楼的软阴影。
实时渲染算不出这些，所以用 Cycles 把「最终画面」（COMBINED：铺装 / 草地 / 道路贴图 × 光照）烘进地面的 Lightmap UV，
three.js 里地面直接用这张图做无光照材质（MeshBasicMaterial，channel 1）。

光源：PREVIEW 集合里每盏路灯一个点光源 + 月光 / 补光；楼体的自发光（窗灯、大堂、金色描边）在 Cycles 里会真实照亮地面。
输出 public/building/park_ground.webp。
"""

import os

import bpy

from .build import ROOT

OUT = os.path.join(ROOT, "public", "building", "park_ground.webp")


def bake(width=2560, height=4096, samples=128):
    from . import preview

    s = bpy.context.scene
    preview.use_cycles(samples=samples)
    s.cycles.samples = samples
    s.render.bake.margin = 4

    ground = bpy.data.objects["ground"]
    me = ground.data
    # 烘焙目标写到 Lightmap UV；贴图采样仍走第一套 UV（active_render 不变）
    me.uv_layers.active = me.uv_layers["Lightmap"]
    img = bpy.data.images.get("T_ground_bake")
    if img is not None:
        bpy.data.images.remove(img)
    img = bpy.data.images.new("T_ground_bake", width, height, alpha=False)

    # 每个材质槽都放一个选中的图像节点：Cycles 烘焙到每个材质的「活动图像节点」
    nodes = []
    for slot in ground.material_slots:
        nt = slot.material.node_tree
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img
        nt.nodes.active = n
        nodes.append((nt, n))
    try:
        vl = bpy.context.view_layer
        vl.update()
        for ob in vl.objects:
            ob.select_set(False)
        ground.select_set(True)
        vl.objects.active = ground
        bpy.ops.object.bake(type="COMBINED", use_clear=True, margin=4)

        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        img.filepath_raw = OUT
        img.file_format = "WEBP"
        s.render.image_settings.quality = 88
        img.save()
    finally:
        for nt, n in nodes:
            nt.nodes.remove(n)
        me.uv_layers.active = me.uv_layers[0]
    return OUT

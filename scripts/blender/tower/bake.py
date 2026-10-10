"""
楼层模型 · 烘焙室内灯光
----------------------------------------------------------
逐个变体用 Cycles 烘焙「漫反射直接光 + 间接光 + 自发光」（不含高光，视角相关的高光烘不进贴图）：
楼板对象写到 models/tower/bake/<对象名>.png，家具对象写进顶点色 Bake；export.py 再按这两者导出。
灯盘是自发光网格（光树采样），夜空从楼层四周照进来；烘焙当前对象时其它对象全部不参与渲染。
烘完的贴图再用 OIDN 降噪（denoise）。
M2 GPU 上 2048² / 128 采样每个对象约一两分钟，18 个对象合计二三十分钟（MCP 调用会超时，Blender 会继续跑完）。
"""

import os
import time

import bpy

from .build import MODEL_DIR

BAKE_DIR = os.path.join(MODEL_DIR, "bake")


def _setup(samples):
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "GPU"
    s.cycles.samples = samples
    s.cycles.use_denoising = False
    s.cycles.max_bounces = 4
    s.cycles.diffuse_bounces = 3
    s.cycles.glossy_bounces = 1
    s.render.bake.margin = 6
    s.render.bake.use_pass_direct = True
    s.render.bake.use_pass_indirect = True


def bake(names=None, size=2048, samples=128):
    """names：变体对象名集合（如 {"S_off_85"}，自动带上对应的 _v），不传则全部"""
    _setup(samples)
    os.makedirs(BAKE_DIR, exist_ok=True)
    col = bpy.data.collections["TOWER"]
    bases = [o for o in col.objects if not o.name.endswith("_v") and (not names or o.name in names)]
    log = {}
    for ob in bases:
        ov = bpy.data.objects[ob.name + "_v"]
        t = time.time()
        # 只渲染这一对对象：家具、灯盘既是光源也是遮挡物
        for o in bpy.data.objects:
            o.hide_render = o not in (ob, ov)
        # 地下机房、屋顶机房几乎全靠灯光的间接反射照亮，噪点多：采样翻倍
        dark = "basement" in ob.name or ob.name.endswith("_roof")
        bpy.context.scene.cycles.samples = samples * 2 if dark else samples
        _bake_image(ob, size)
        denoise(os.path.join(BAKE_DIR, ob.name + ".png"))
        _bake_vertex(ov)
        log[ob.name] = round(time.time() - t, 1)
    for o in bpy.data.objects:
        o.hide_render = False
    return log


def _select(ob):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


PASSES = {"EMIT", "DIRECT", "INDIRECT", "DIFFUSE"}


def _bake_image(ob, size):
    """楼板 + 核心筒墙 → models/tower/bake/<名>.png"""
    img = bpy.data.images.get("BK_" + ob.name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new("BK_" + ob.name, size, size, alpha=False)
    # 每个材质槽放一个选中的图像节点：Cycles 烘到每个材质的「活动图像节点」（材质是共用的，烘完立刻删掉）
    nodes = []
    for slot in ob.material_slots:
        nt = slot.material.node_tree
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img
        nt.nodes.active = n
        nodes.append((nt, n))
    try:
        _select(ob)
        bpy.ops.object.bake(type="COMBINED", pass_filter=PASSES, margin=8, use_clear=True)
        img.filepath_raw = os.path.join(BAKE_DIR, ob.name + ".png")
        img.file_format = "PNG"
        img.save()
    finally:
        for nt, n in nodes:
            nt.nodes.remove(n)


def _bake_vertex(ov):
    """家具、灯盘、天花、板边 → 顶点色 Bake（面角域）"""
    _select(ov)
    bpy.ops.object.bake(type="COMBINED", pass_filter=PASSES, target="VERTEX_COLORS")


def denoise(path, out=None, fmt="PNG"):
    """
    烘焙贴图降噪：合成器里 Image → Denoise（OIDN）→ 输出，渲染一帧写回原文件。
    合成器只能随渲染运行：临时隐藏全部对象、换 Workbench（几乎不耗时），色彩管理换 Standard（不经过 AgX，颜色原样写回），
    渲染设置用完恢复。out / fmt 可另存（如浮点烘焙 → OPEN_EXR，保留超过 1 的高光再做色调映射）。降噪只用颜色本身（烘焙图没有法线 / 反照率通道），UV 岛边缘有 8 px 外扩，不会把相邻岛的颜色糊进来
    """
    s = bpy.context.scene
    img = bpy.data.images.load(path, check_existing=False)
    ng = bpy.data.node_groups.new("DN_bake", "CompositorNodeTree")
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    ni = ng.nodes.new("CompositorNodeImage")
    ni.image = img
    dn = ng.nodes.new("CompositorNodeDenoise")
    go = ng.nodes.new("NodeGroupOutput")
    ng.links.new(ni.outputs["Image"], dn.inputs["Image"])
    ng.links.new(dn.outputs["Image"], go.inputs[0])
    r, vs = s.render, s.view_settings
    keep = (s.compositing_node_group, r.resolution_x, r.resolution_y, r.resolution_percentage, r.engine, r.filepath,
            r.image_settings.file_format, vs.view_transform, vs.look, vs.exposure, vs.gamma)
    hidden = {o.name: o.hide_render for o in bpy.data.objects}
    try:
        for o in bpy.data.objects:
            o.hide_render = True
        s.compositing_node_group = ng
        r.resolution_x, r.resolution_y = img.size
        r.resolution_percentage = 100
        r.engine = "BLENDER_WORKBENCH"
        r.filepath = out or path
        r.image_settings.file_format = fmt
        vs.view_transform, vs.look, vs.exposure, vs.gamma = "Standard", "None", 0.0, 1.0
        bpy.ops.render.render(write_still=True)
    finally:
        (s.compositing_node_group, r.resolution_x, r.resolution_y, r.resolution_percentage, r.engine, r.filepath,
         r.image_settings.file_format, vs.view_transform, vs.look, vs.exposure, vs.gamma) = keep
        for n, h in hidden.items():
            bpy.data.objects[n].hide_render = h
        bpy.data.node_groups.remove(ng)
        bpy.data.images.remove(img)

"""青原露天矿 · 烘焙（Cycles，把程序化材质 + 光照烘成贴图，导出 GLB 用）

GLB 不带节点材质，所以坑台阶、坑底、地面、两座排土场的程序化材质要烘成贴图：
烘 COMBINED（固有色 + 日光 / 天空光 + 自发光溢出的光），在 three.js 里当「自带光照的贴图」显示。
设备（电铲、卡车、电厂…）不烘：它们是单色 PBR 材质，直接导出。道路、沿口亮线、网格线是纯发光材质，也不烘。
UV 要求（build.py 已保证）：每个物体一套互不重叠的 UV。
"""
import os
import time

import bpy

from .build import MODEL_DIR

BAKE_DIR = os.path.join(MODEL_DIR, "bake")

# 物体名 → 贴图尺寸（宽, 高）：坑台阶 u 绕一圈 5 km，要的横向像素最多
TARGETS = {
    "pit_terraces": (8192, 2048),
    "ground": (2048, 2048),
    "DP-W": (2048, 1024),
    "DP-I": (1024, 512),
}


def setup_cycles(samples):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    cy = sc.cycles
    cy.samples = samples
    cy.use_denoising = False
    cy.max_bounces = 4
    prefs = bpy.context.preferences.addons["cycles"].preferences
    gpu = False
    try:
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type != "CPU"
            gpu = gpu or d.use
    except Exception as e:  # 没有 Metal：退回 CPU，慢很多
        print("[bake] GPU 不可用，退回 CPU:", e)
    cy.device = "GPU" if gpu else "CPU"
    sc.render.bake.margin = 16
    sc.render.bake.use_clear = True
    return {"gpu": gpu}


def _bake_image(obj, name, w, h):
    img = bpy.data.images.new(f"bake_{name}", w, h, alpha=False)
    img.colorspace_settings.name = "sRGB"
    # 每个材质里放一个图像纹理节点并设为活动节点：烘焙写进活动的图像纹理
    for slot in obj.material_slots:
        nt = slot.material.node_tree
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        nt.nodes.active = tex
        tex.select = True
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type="COMBINED", pass_filter={"EMIT", "DIRECT", "INDIRECT", "COLOR", "DIFFUSE"})
    os.makedirs(BAKE_DIR, exist_ok=True)
    path = os.path.join(BAKE_DIR, f"{name}.png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return img, path


def _apply_baked(obj, img):
    """把物体的材质换成只带烘焙贴图的简单材质（导出 GLB 用）"""
    m = bpy.data.materials.new(f"baked_{obj.name}")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bs.inputs["Roughness"].default_value = 1.0
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(tex.outputs["Color"], bs.inputs["Base Color"])
    nt.links.new(bs.outputs["BSDF"], out.inputs["Surface"])
    obj.data.materials.clear()
    obj.data.materials.append(m)
    # 所有面用同一个材质槽
    for p in obj.data.polygons:
        p.material_index = 0


def bake(names=None, samples=128, scale=1.0):
    """烘焙 TARGETS 里的物体；返回每个物体的耗时和文件。names 可以只烘一部分。"""
    info = setup_cycles(samples)
    out = {"device": info, "baked": {}}
    for name, (w, h) in TARGETS.items():
        if names and name not in names:
            continue
        w, h = max(256, int(w * scale)), max(128, int(h * scale))
        obj = bpy.data.objects[name]
        t0 = time.time()
        img, path = _bake_image(obj, name, w, h)
        _apply_baked(obj, img)
        out["baked"][name] = {"size": [w, h], "sec": round(time.time() - t0, 1), "file": path}
        print(f"[bake] {name} {w}x{h} {time.time() - t0:.0f}s", flush=True)
    return out

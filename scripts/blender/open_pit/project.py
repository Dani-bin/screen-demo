"""台阶 / 排土场投影设计稿（2026-11-03 第 19 轮，用户选「台阶投影设计稿」）

把设计稿场景图（擦掉卡车、电铲、破碎站：models/open-pit/design_pit.png，scripts/open-pit/plate.py 生成）从设计稿相机投影到
坑台阶和两座排土场上，和程序化烘焙的贴图（bake.py 的 bake/<name>.png）按「从设计稿相机看不看得到、正不正对」混合，
再烘回物体自己的 UV 贴图（bake/<name>_proj.png），导出时优先用它。
- 投影 UV：每个顶点用 pit.design_uv（设计稿相机投影到场景图像素，再换算到贴图的留边布局）；面很小（一圈 720 段），
  顶点间线性插值的透视误差可以忽略。
- 权重（每个面角一个值，存在颜色属性 pw）：
  · 可见：从顶点（沿面法线抬 1.5 m）向设计稿相机发射线，只和地形本身求交（BVH，不算设备），被挡住 = 0；
  · 正对：面法线和指向相机方向的夹角余弦 c，smoothstep(0.12, 0.35, c)：背对相机的坡面（南帮的陡坎）、掠射的面不用投影，
    换角度看时那里本来就是设计稿里没画到的地方，用程序化岩石；
  · 在设计稿画面里：投影像素出了场景图范围（留边里是镜像的）= 0。
  总览机位下画面就是设计稿本身；转开以后，看得到的面仍是设计稿的岩壁 / 台阶线 / 光，被挡住和背对的面是程序化岩石。
"""
import os

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from . import camera as cam
from .bake import BAKE_DIR, setup_cycles
from .build import MODEL_DIR
from .pit import design_uv

TARGETS = {"pit_terraces": (8192, 2048), "DP-W": (2048, 1024), "DP-I": (1024, 512)}
PIT_IMG = os.path.join(MODEL_DIR, "design_pit.png")


def _smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def weights_and_uv(obj):
    """给物体加投影 UV（proj）和权重颜色属性（pw，面角域）；返回统计"""
    me = obj.data
    C, _, _, _ = cam.pose()
    Cv = Vector(C.tolist())
    mw = obj.matrix_world
    # 只拿地形本身建 BVH（设备不遮挡：设备在页面里另有三维模型）
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.transform(mw)
    bvh = BVHTree.FromBMesh(bm)
    bm.free()

    V = np.array([mw @ v.co for v in me.vertices])
    UV = design_uv(V)
    T = cam.outline()["groundTex"]
    # 设计稿画面在贴图里的范围（不含留边）
    u0, u1 = T["pad_x"] / T["w"], (T["pad_x"] + T["scale"] * cam.W) / T["w"]
    v0, v1 = 1 - (T["pad_y"] + T["scale"] * cam.H) / T["h"], 1 - T["pad_y"] / T["h"]
    inside = (UV[:, 0] > u0 + 0.002) & (UV[:, 0] < u1 - 0.002) & (UV[:, 1] > v0 + 0.002) & (UV[:, 1] < v1 - 0.002)

    vis = np.zeros(len(V))
    for i, p in enumerate(V):
        if not inside[i]:
            continue
        P = Vector(p.tolist())
        d = Cv - P
        dist = d.length
        d.normalize()
        hit = bvh.ray_cast(P + d * 2.0, d, dist)
        vis[i] = 0.0 if hit[0] is not None else 1.0

    if "proj" not in me.uv_layers:
        me.uv_layers.new(name="proj")
    proj = me.uv_layers["proj"]
    loops_v = np.array([l.vertex_index for l in me.loops])
    proj.data.foreach_set("uv", UV[loops_v].ravel())

    # 面角权重 = 顶点可见 × 面的正对程度。build.py 建网格时没统一法线朝向：按平台（近水平的面）多数朝上 / 朝下定符号
    nz = np.array([(mw.to_3x3() @ p.normal).z for p in me.polygons])
    flip = -1.0 if np.mean(nz[np.abs(nz) > 0.9]) < 0 else 1.0
    n_loops = len(me.loops)
    w = np.zeros(n_loops)
    for poly in me.polygons:
        nrm = (mw.to_3x3() @ poly.normal) * flip
        ctr = mw @ poly.center
        c = nrm.normalized().dot((Cv - ctr).normalized())
        face_w = float(_smooth(0.12, 0.35, c))
        for li in poly.loop_indices:
            w[li] = vis[loops_v[li]] * face_w
    attr = me.color_attributes.get("pw") or me.color_attributes.new("pw", "FLOAT_COLOR", "CORNER")
    cols = np.repeat(w[:, None], 4, axis=1)
    cols[:, 3] = 1.0
    attr.data.foreach_set("color", cols.ravel())
    me.uv_layers.active = me.uv_layers["UVMap"]  # 烘焙目标仍是物体自己的 UV
    return {"verts": len(V), "inside": int(inside.sum()), "visible": int(vis.sum()), "w_mean": round(float(w.mean()), 3), "flip": flip}


def _mix_material(obj, proc_img, pit_img):
    """混合材质：发光 = mix(程序化烘焙贴图 @UVMap, 设计稿投影 @proj, pw)"""
    m = bpy.data.materials.new(f"proj_{obj.name}")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    uv_a = nt.nodes.new("ShaderNodeUVMap")
    uv_a.uv_map = "UVMap"
    uv_b = nt.nodes.new("ShaderNodeUVMap")
    uv_b.uv_map = "proj"
    ta = nt.nodes.new("ShaderNodeTexImage")
    ta.image = proc_img
    tb = nt.nodes.new("ShaderNodeTexImage")
    tb.image = pit_img
    tb.extension = "EXTEND"
    tb.interpolation = "Cubic"
    nt.links.new(uv_a.outputs["UV"], ta.inputs["Vector"])
    nt.links.new(uv_b.outputs["UV"], tb.inputs["Vector"])
    at = nt.nodes.new("ShaderNodeAttribute")
    at.attribute_name = "pw"
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(at.outputs["Fac"], mix.inputs["Factor"])
    nt.links.new(ta.outputs["Color"], mix.inputs[6])  # A
    nt.links.new(tb.outputs["Color"], mix.inputs[7])  # B
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(mix.outputs[2], em.inputs["Color"])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    obj.data.materials.clear()
    obj.data.materials.append(m)
    for p in obj.data.polygons:
        p.material_index = 0
    return m


def apply_dual(obj, proc_img):
    """导出用的双贴图材质（第 20 轮）：底色 = 程序化烘焙（UVMap），自发光 = 设计稿投影（proj UV），顶点色 pw = 投影权重。
    GLB 里就是 baseColorTexture（TEXCOORD_0）+ emissiveTexture（TEXCOORD_1）+ COLOR_0，页面 GlbScene 按镜头距离混合：
    远处（总览）用设计稿、近处用和几何对得上的程序化岩石（近景里投影的台阶线和实际几何错位、分辨率也不够，第 17 轮评审「拖影 / 重影」）。
    材质名以 dual_ 开头，页面按名字识别。"""
    stats = weights_and_uv(obj)
    me = obj.data
    me.color_attributes.active_color = me.color_attributes["pw"]
    pit_img = bpy.data.images.load(PIT_IMG, check_existing=True)
    pit_img.colorspace_settings.name = "sRGB"
    m = bpy.data.materials.new(f"dual_{obj.name}")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    uv_a = nt.nodes.new("ShaderNodeUVMap")
    uv_a.uv_map = "UVMap"
    uv_b = nt.nodes.new("ShaderNodeUVMap")
    uv_b.uv_map = "proj"
    ta = nt.nodes.new("ShaderNodeTexImage")
    ta.image = proc_img
    tb = nt.nodes.new("ShaderNodeTexImage")
    tb.image = pit_img
    tb.extension = "EXTEND"
    nt.links.new(uv_a.outputs["UV"], ta.inputs["Vector"])
    nt.links.new(uv_b.outputs["UV"], tb.inputs["Vector"])
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bs.inputs["Roughness"].default_value = 1.0
    nt.links.new(ta.outputs["Color"], bs.inputs["Base Color"])
    nt.links.new(tb.outputs["Color"], bs.inputs["Emission Color"])
    bs.inputs["Emission Strength"].default_value = 1.0
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(bs.outputs["BSDF"], out.inputs["Surface"])
    me.materials.clear()
    me.materials.append(m)
    for p in me.polygons:
        p.material_index = 0
    return stats


def project(names=None, scale=1.0):
    """对 TARGETS 里的物体：算投影 UV + 权重 → 混合材质 → 烘 EMIT 到 bake/<name>_proj.png。要先有 bake/<name>.png（程序化烘焙）"""
    setup_cycles(1)
    bpy.context.scene.cycles.samples = 1  # 只烘发光，1 个采样就够
    pit_img = bpy.data.images.load(PIT_IMG, check_existing=True)
    pit_img.colorspace_settings.name = "sRGB"
    out = {}
    for name, (w, h) in TARGETS.items():
        if names and name not in names:
            continue
        obj = bpy.data.objects[name]
        proc_path = os.path.join(BAKE_DIR, f"{name}.png")
        proc_img = bpy.data.images.load(proc_path, check_existing=True)
        proc_img.colorspace_settings.name = "sRGB"
        stats = weights_and_uv(obj)
        m = _mix_material(obj, proc_img, pit_img)
        w, h = max(256, int(w * scale)), max(128, int(h * scale))
        img = bpy.data.images.new(f"proj_{name}", w, h, alpha=False)
        img.colorspace_settings.name = "sRGB"
        tex = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = img
        m.node_tree.nodes.active = tex
        for o in bpy.context.view_layer.objects:
            o.select_set(False)
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.bake(type="EMIT")
        path = os.path.join(BAKE_DIR, f"{name}_proj.png")
        img.filepath_raw = path
        img.file_format = "PNG"
        img.save()
        out[name] = {**stats, "file": path, "size": [w, h]}
        print(f"[project] {name} {stats}", flush=True)
    return out

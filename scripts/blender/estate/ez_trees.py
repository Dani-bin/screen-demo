"""
澜岸云境沙盘 · 用 ez-tree 生成的树（Cycles 渲染用）
----------------------------------------------------------
树由 scripts/estate/export_trees.mjs 用 ez-tree（MIT）造好，导成 12 个 GLB（橡树 ×3、白蜡 ×2、白杨 ×2、松 ×2、
灌木 ×3，带树皮和叶片贴图），这里导入 Blender，各合成一个网格（树皮 + 叶片两个材质槽）当模板，
再按页面里每棵树的位置和冠径摆实例：
  - 阔叶树：页面里的 trunks[0..n) 对应 crown0 / crown1 / crown2 依次排开，所以第 i 棵的地面位置取 trunks[i]，
    冠径取 crown 实例矩阵的缩放；变体按随机数在橡 / 白蜡 / 白杨里挑，随机转向；
  - 针叶树：trunks[n..) 对应 conifers；
  - 灌木：shrubs。
叶片材质：叶贴图 × 按页面色板调的色调（实例颜色），一部分透光（Translucent），透明通道做硬边镂空。
"""

import json
import math
import os

import bpy
from mathutils import Matrix, Vector

from .lib import rng

EZ_DIR_NAME = "trees_ez"


def _import_one(path, name):
    """导入一个 GLB，合并成一个网格对象，世界变换烘进顶点，返回 (网格数据, 叶片图片)"""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    with bpy.context.temp_override(active_object=meshes[0], selected_editable_objects=meshes, selected_objects=meshes):
        bpy.ops.object.join()
    ob = meshes[0]
    me = ob.data
    me.transform(ob.matrix_world)
    me.name = name
    ob.matrix_world = Matrix.Identity(4)
    leaf_img = None
    for m in me.materials:
        if m.name.startswith("leaves"):
            for n in m.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image:
                    leaf_img = n.image
    # 合并后被并掉的网格对象已经没了，按"现在多出来的"重新数，把剩下的（合并后的网格、空物体）都删掉，只留网格数据
    for o in [o for o in bpy.data.objects if o not in before]:
        bpy.data.objects.remove(o, do_unlink=True)
    return me, leaf_img


def _leaf_material(name, img, fresh, mul_color):
    """叶片：贴图色 × 实例色调，漫射 + 一部分透光，alpha 硬边镂空"""
    m, nt, b = fresh(name)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Linear"
    tex.extension = "CLIP"
    oi = nt.nodes.new("ShaderNodeObjectInfo")
    sc = nt.nodes.new("ShaderNodeVectorMath")
    sc.operation = "SCALE"
    sc.inputs["Scale"].default_value = 1.7
    nt.links.new(oi.outputs["Color"], sc.inputs[0])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MIX"
    mix.inputs[0].default_value = 0.55
    mix.inputs[6].default_value = (1, 1, 1, 1)
    nt.links.new(sc.outputs[0], mix.inputs[7])
    base0 = mul_color(nt, tex.outputs["Color"], mix.outputs[2])
    lift = nt.nodes.new("ShaderNodeVectorMath")  # 叶贴图本身偏暗，整体提亮一档
    lift.operation = "SCALE"
    lift.inputs["Scale"].default_value = 1.4
    nt.links.new(base0, lift.inputs[0])
    base = lift.outputs[0]
    nt.links.new(base, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.65
    b.inputs["Specular IOR Level"].default_value = 0.3
    tr = nt.nodes.new("ShaderNodeBsdfTranslucent")
    nt.links.new(base, tr.inputs["Color"])
    body = nt.nodes.new("ShaderNodeMixShader")
    body.inputs[0].default_value = 0.35
    nt.links.new(b.outputs[0], body.inputs[1])
    nt.links.new(tr.outputs[0], body.inputs[2])
    cut = nt.nodes.new("ShaderNodeMath")
    cut.operation = "GREATER_THAN"
    cut.inputs[1].default_value = 0.5
    nt.links.new(tex.outputs["Alpha"], cut.inputs[0])
    clear = nt.nodes.new("ShaderNodeBsdfTransparent")
    final = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(cut.outputs[0], final.inputs[0])
    nt.links.new(clear.outputs[0], final.inputs[1])
    nt.links.new(body.outputs[0], final.inputs[2])
    out = [n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"][0]
    # 把原来 Principled → 输出 的连线换成 final → 输出
    for l in list(out.inputs["Surface"].links):
        nt.links.remove(l)
    nt.links.new(final.outputs[0], out.inputs["Surface"])
    return m


def load_templates(render_dir, fresh, mul_color):
    """导入全部变体，返回 {名字: {mesh, kind, crownRadius, height}}；没有导出文件时返回 None"""
    d = os.path.join(render_dir, EZ_DIR_NAME)
    mf = os.path.join(d, "manifest.json")
    if not os.path.exists(mf):
        return None
    out = {}
    leaf_mats = {}
    for v in json.load(open(mf)):
        me, img = _import_one(os.path.join(d, v["name"] + ".glb"), v["name"])
        # 换叶片材质（同一张叶贴图共用一个材质）
        if img is not None:
            if img.name not in leaf_mats:
                leaf_mats[img.name] = _leaf_material("ez_leaf_" + img.name, img, fresh, mul_color)
            for i, m in enumerate(me.materials):
                if m.name.startswith("leaves"):
                    me.materials[i] = leaf_mats[img.name]
        out[v["name"]] = {
            "mesh": me,
            "kind": v["kind"],
            "crown": v["stats"]["crownRadius"],
            "height": v["stats"]["height"],
        }
    return out


def _m(e):
    """three.js 列主序矩阵 → (位置, 缩放) 的 Blender 值：位置 (x, -z, y)，缩放取三轴"""
    m = Matrix((e[0:4], e[4:8], e[8:12], e[12:16])).transposed()
    t = m.to_translation()
    sx = Vector((m[0][0], m[1][0], m[2][0])).length
    sy = Vector((m[0][1], m[1][1], m[2][1])).length
    return (t.x, -t.z, t.y), sx, sy


def place_all(col, inst, tpl, seed=2026):
    """按页面导出的实例摆树。返回各类数量"""
    r = rng(seed)
    broad = [k for k, v in tpl.items() if v["kind"] == "broad"]
    conif = [k for k, v in tpl.items() if v["kind"] == "conifer"]
    bush = [k for k, v in tpl.items() if v["kind"] == "bush"]
    counts = {"broad": 0, "conifer": 0, "bush": 0}

    def put(name, key, pos, target_r, color, jitter=0.12):
        t = tpl[key]
        ob = bpy.data.objects.new(name, t["mesh"])
        s = target_r / t["crown"] * (1.0 + (r() - 0.5) * jitter * 2)
        ob.location = (pos[0], pos[1], 0.0)
        ob.rotation_euler = (0, 0, r() * math.tau)
        ob.scale = (s, s, s * (0.9 + r() * 0.25))
        ob.color = color
        col.objects.link(ob)

    trunks = inst["trunks"]["matrix"]
    crowns = []
    for k in ("crown0", "crown1", "crown2"):
        d = inst.get(k)
        if d:
            for i in range(d["count"]):
                crowns.append((d["matrix"][i * 16 : i * 16 + 16], d["color"][i * 3 : i * 3 + 3]))
    for i, (e, c) in enumerate(crowns):
        pos, _, _ = _m(trunks[i * 16 : i * 16 + 16])
        _, sx, _ = _m(e)
        w = r()
        # 变体：橡 55 %、白蜡 35 %、白杨 10 %（白杨又高又瘦、叶贴图偏黄，多了像一片秋色）
        oaks = [k for k in broad if k.startswith("oak")]
        ashes = [k for k in broad if k.startswith("ash")]
        aspens = [k for k in broad if k.startswith("aspen")]
        pool = oaks if w < 0.55 else ashes if w < 0.9 else aspens
        key = pool[int(r() * len(pool)) % len(pool)]
        # 页面色板里有 10 % 橙黄：叶贴图本身已经偏黄，再乘橙色就成了一片秋色，这里留 35 % 的橙，其余用叶子本色
        warm = c[0] > c[1] * 1.15
        tint = (1.0, 1.0, 1.0, 1.0) if (warm and r() < 0.8) else (c[0], c[1], c[2], 1.0)
        put(f"tree_{i}", key, pos, sx * 1.45, tint)
        counts["broad"] += 1
    base = len(crowns)
    cones = inst.get("conifers")
    if cones:
        for j in range(cones["count"]):
            pos, _, _ = _m(trunks[(base + j) * 16 : (base + j) * 16 + 16])
            _, sx, _ = _m(cones["matrix"][j * 16 : j * 16 + 16])
            key = conif[int(r() * len(conif)) % len(conif)]
            put(f"pine_{j}", key, pos, sx * 1.4, (1, 1, 1, 1), jitter=0.2)
            counts["conifer"] += 1
    sh = inst.get("shrubs")
    if sh:
        for i in range(sh["count"]):
            pos, sx, _ = _m(sh["matrix"][i * 16 : i * 16 + 16])
            c = sh["color"][i * 3 : i * 3 + 3]
            key = bush[int(r() * len(bush)) % len(bush)]
            put(f"bush_{i}", key, pos, sx * 1.7, (c[0], c[1], c[2], 1.0), jitter=0.2)
            counts["bush"] += 1
    return counts

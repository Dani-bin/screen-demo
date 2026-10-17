"""
候诊大厅人物 · 构建、预览、导出
----------------------------------------------------------
run(render_to=None)  清空场景 → 建 9 个人物（PEOPLE 集合）→ 摆成两排人物阵列（医护在后排、患者在前排，
                     每人坐一把预览用的蓝椅子）→ render_to 给路径时出一张 Eevee 预览图，对照概念图
export(path=None)    人物放回原点，只导出 PEOPLE 集合 → public/waiting/people.glb
                     （每个人物一个网格 person_<key>，顶点色 COLOR_0 + 一个共用材质；预览椅子、灯光、相机不导出）
"""

import math
import os

import bpy
from mathutils import Vector

from . import people

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
STAFF = ["doctor_m", "doctor_f", "nurse"]
PATIENTS = ["elder", "woman", "man_mask", "teen", "auntie", "granny"]


def _collection(name):
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if col.name not in [c.name for c in bpy.context.scene.collection.children]:
        bpy.context.scene.collection.children.link(col)
    return col


def _clear():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.metaballs, bpy.data.cameras, bpy.data.lights, bpy.data.curves):
        for item in list(coll):
            coll.remove(item)
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)


def _material(name, color=None, rough=0.5, vertex=False):
    """Principled 材质；vertex=True 时底色取顶点色层 "Col"（Blender 5 新材质不带节点，手动补）"""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Specular IOR Level"].default_value = 0.3
    if vertex:
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    elif color:
        from .toy import linear

        bsdf.inputs["Base Color"].default_value = linear(color)
    return m


def _chair(col, x, y, mat):
    """预览用的蓝色候诊椅（座面 z = 0.45，靠背在人物身后 +Y 一侧）"""
    from .toy import Toy

    t = Toy(f"chair_{x:.2f}_{y:.2f}")
    z = people.SEAT  # 座面
    t.box((0, 0.02, z - 0.035), (0.46, 0.42, 0.07), "#5E7FE6", bevel=0.028)
    t.box((0, 0.22, z + 0.2), (0.46, 0.06, 0.36), "#5E7FE6", bevel=0.028)
    for sx in (-1, 1):
        for sy in (-1, 1):
            t.cyl((sx * 0.18, sy * 0.15 + 0.02, 0.0), (sx * 0.18, sy * 0.15 + 0.02, z - 0.07), 0.016, "#9AA3B8", seg=10)
    ob = t.finish(col)
    ob.location = (x, y, 0)
    ob.data.materials.append(mat)


def run(render_to=None):
    _clear()
    col = _collection("PEOPLE")
    prev = _collection("PREVIEW")
    toy = _material("M_toy", rough=0.48, vertex=True)
    stats = {}
    objs = {}
    for key in STAFF + PATIENTS:
        ob = people.build_person(key, col)
        ob.data.materials.append(toy)
        objs[key] = ob
        stats[key] = len(ob.data.polygons)
    # 人物阵列：后排医护 3 人、前排患者 6 人
    for i, key in enumerate(STAFF):
        objs[key].location = ((i - 1) * 1.15, 1.5, 0)
        _chair(prev, (i - 1) * 1.15, 1.5, toy)
    for i, key in enumerate(PATIENTS):
        objs[key].location = ((i - 2.5) * 1.05, 0, 0)
        _chair(prev, (i - 2.5) * 1.05, 0, toy)
    if render_to:
        _preview(render_to)
    return stats


def _preview(path):
    s = bpy.context.scene
    prev = _collection("PREVIEW")
    s.render.engine = "BLENDER_EEVEE"
    s.render.resolution_x, s.render.resolution_y = 1536, 1024
    s.render.resolution_percentage = 100
    s.render.film_transparent = False
    s.view_settings.view_transform = "Standard"
    s.view_settings.look = "None"
    s.eevee.taa_render_samples = 64
    s.eevee.use_shadows = True
    s.eevee.use_fast_gi = True
    # 世界：与概念图一样的浅紫底
    w = bpy.data.worlds.get("W_lav") or bpy.data.worlds.new("W_lav")
    if w.node_tree is None:
        w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    from .toy import linear

    bg.inputs["Color"].default_value = linear("#EEE9FF")
    bg.inputs["Strength"].default_value = 0.85
    s.world = w
    # 地面（只接阴影的浅紫）
    from .toy import Toy

    t = Toy("floor")
    t.box((0, 0.6, -0.01), (14, 8, 0.02), "#E6E0FA")
    fl = t.finish(prev)
    fl.data.materials.append(_material("M_floor", rough=0.9, vertex=True))
    # 灯：左前上方主光（柔和面光）+ 右侧补光 + 后方轮廓光
    for name, loc, energy, size in (("key", (-4, -6, 7), 420, 6), ("fill", (6, -4, 3), 140, 6), ("rim", (0, 6, 5), 240, 5)):
        L = bpy.data.lights.new(name, "AREA")
        L.energy = energy
        L.size = size
        ob = bpy.data.objects.new(name, L)
        ob.location = loc
        ob.rotation_euler = (Vector((0, 0.6, 0.8)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        prev.objects.link(ob)
    cam = bpy.data.cameras.new("cam")
    cam.lens = 50
    ob = bpy.data.objects.new("cam", cam)
    target = Vector((0, 0.7, 0.62))
    ob.location = (0, -8.4, 2.6)
    ob.rotation_euler = (target - ob.location).to_track_quat("-Z", "Y").to_euler()
    prev.objects.link(ob)
    s.camera = ob
    s.render.filepath = path
    bpy.ops.render.render(write_still=True)


def export(path=None, decimate=0.5):
    path = path or os.path.join(ROOT, "public", "waiting", "people.glb")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    col = bpy.data.collections["PEOPLE"]
    vl = bpy.context.view_layer
    for ob in vl.objects:
        ob.select_set(False)
    for ob in col.objects:
        ob.location = (0, 0, 0)  # 页面按座位摆放，模型本身留在原点
        ob.select_set(True)
        # 导出时减面一半（候诊区要摆八十多个人；元球网格很密，大屏上看不出区别）
        if not ob.modifiers.get("decimate"):
            m = ob.modifiers.new("decimate", "DECIMATE")
            m.ratio = decimate
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_lights=False,
        export_cameras=False,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",
        export_extras=False,
        # meshopt 压缩：three.js 的 MeshoptDecoder 自带解码器（与 /building 的 GLB 一样）
        export_meshopt_compression_enable=True,
        export_draco_mesh_compression_enable=False,
    )
    tris = sum(len(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).data.polygons) for ob in col.objects)
    for ob in col.objects:
        ob.modifiers.remove(ob.modifiers["decimate"])
    return {"file": os.path.relpath(path, ROOT), "MB": round(os.path.getsize(path) / 1024 / 1024, 2), "faces": tris}

"""把 cli-anything-blender 建的设备模型接进 Blender 构建（用户指定用这个工具做设备，建模脚本在 scripts/open-pit/cli/equipment.py）。

工具只能生成「清空场景 → 设渲染 → 建材质 → 建物体 → 相机 / 灯光 → 渲染」的整段 bpy 脚本，不能导出 GLB；
这里只截取其中「材质」到「相机」之前的两段执行（不清场景、不动相机灯光），再：
  1. 求出带修改器（倒角、阵列）后的网格，按世界矩阵合成一个网格；
  2. 材质换成场景统一的那套（op_steel / op_cyan …，页面 GlbScene 靠材质名识别发光件）；
  3. 删掉工具建的临时物体和材质。
返回的网格不挂在场景里，调用方用它建多个物体（7 台电铲共用一份网格数据，GLB 里也只存一份）。
"""
import math
import os

import bmesh
import bpy

from .build import MODEL_DIR

CLI_DIR = os.path.join(MODEL_DIR, "cli")
START = "# ── Materials"
STOP = "# ── Cameras"


def available(name):
    return os.path.exists(os.path.join(CLI_DIR, f"{name}_build.py"))


def load_mesh(name, palette):
    """执行 models/open-pit/cli/<name>_build.py 的建模部分，返回合成后的网格（材质已换成 palette 里同名的那套）"""
    path = os.path.join(CLI_DIR, f"{name}_build.py")
    text = open(path, encoding="utf-8").read()
    body = text[text.index(START) : text.index(STOP)]
    before_obj = set(bpy.data.objects)
    before_mat = set(bpy.data.materials)
    exec(compile(body, path, "exec"), {"bpy": bpy, "math": math, "os": os})
    new = [o for o in bpy.data.objects if o not in before_obj and o.type == "MESH"]
    new_mats = [m for m in bpy.data.materials if m not in before_mat]

    # 工具建的材质名是 steel / dark / white / cyan / amber（重名时带 .001），按去掉后缀的名字对到场景材质
    out_mats = []
    bm = bmesh.new()
    dg = bpy.context.evaluated_depsgraph_get()
    for o in new:
        src = o.data.materials[0] if o.data.materials else None
        key = src.name.split(".")[0] if src else "steel"
        target = palette.get(key, palette["steel"])
        if target not in out_mats:
            out_mats.append(target)
        mi = out_mats.index(target)
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        tmp = bmesh.new()
        tmp.from_mesh(me)
        bmesh.ops.transform(tmp, matrix=o.matrix_world, verts=tmp.verts)
        for f in tmp.faces:
            f.material_index = mi
        tmp_me = bpy.data.meshes.new("_tmp")
        tmp.to_mesh(tmp_me)
        tmp.free()
        ev.to_mesh_clear()
        bm.from_mesh(tmp_me)  # 追加到合成网格里
        bpy.data.meshes.remove(tmp_me)

    mesh = bpy.data.meshes.new(f"cli_{name}")
    bm.to_mesh(mesh)
    bm.free()
    for m in out_mats:
        mesh.materials.append(m)

    # 清掉工具建的临时物体、网格和材质
    for o in new:
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if data.users == 0:
            bpy.data.meshes.remove(data)
    for m in new_mats:
        if m.users == 0:
            bpy.data.materials.remove(m)
    return mesh

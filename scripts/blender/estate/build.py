"""
澜岸云境沙盘 · 总装：楼栋 + 树冠 → models/estate/estate.blend
"""

import json
import os

import bpy

from . import buildings, trees
from .lib import MODEL_DIR, ROOT, clear_scene, make_materials, material


def run(render_to=None):
    os.makedirs(MODEL_DIR, exist_ok=True)
    clear_scene()
    layout = json.load(open(os.path.join(ROOT, "src", "views", "estate", "data", "layout.json")))
    M = make_materials()
    M["tree"] = material("tree", "#ffffff", rough=0.95)
    heights = buildings.build_all(layout, M)
    names = trees.build_trees(M)
    # 预览用的地面（不导出）
    pv = bpy.data.collections.new("PREVIEW")
    bpy.context.scene.collection.children.link(pv)
    gm = material("pv_ground", "#8f9a5a", rough=1.0)
    bpy.ops.mesh.primitive_plane_add(size=900, location=(10, -6, -0.02))
    g = bpy.context.active_object
    g.name = "pv_ground"
    g.data.materials.append(gm)
    for c in list(g.users_collection):
        c.objects.unlink(g)
    pv.objects.link(g)
    # 树冠预览行放在场地南侧外面，不挡楼
    for ob in bpy.data.collections["TREES"].objects:
        ob.location.y -= 260
        ob.location.z += 1.0
    path = os.path.join(MODEL_DIR, "estate.blend")
    bpy.ops.wm.save_as_mainfile(filepath=path)
    out = {"blend": path, "buildings": len(heights), "heights": heights, "trees": names}
    if render_to:
        from . import preview

        out["png"] = preview.render(render_to)
    return out

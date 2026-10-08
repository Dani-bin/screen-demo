"""
园区建模 · 入口
----------------------------------------------------------
run()  清空场景，按 layout.json（scripts/build-park-layout.mjs 由 OSM 生成）完整重建园区，保存 models/park/park.blend：
  PARK 集合     导出到 public/building/park.glb：沙盘 slab、地面 ground、楼体 bld_<key>、树 tree_*、路灯 lamp_*、湖边庭院灯 garden_lamp_*、地灯 bollard_*
  PREVIEW 集合  预览 / 烘焙用的相机、月光、路灯 / 庭院灯 / 地灯点光源（不导出）
"""

import importlib
import json
import os

import bpy

from . import lib

# 仓库根目录：本文件位于 <repo>/scripts/blender/park/
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
MODEL_DIR = os.path.join(ROOT, "models", "park")
LAYOUT = os.path.join(os.path.dirname(__file__), "layout.json")


def _reload():
    """MCP 反复执行时重新加载子模块，确保改过的脚本生效"""
    from . import buildings, palette, preview, site

    for mod in (lib, palette, buildings, site, preview):
        importlib.reload(mod)
    return palette, buildings, site, preview


def run(render_to=None, save=True, with_trees=True, **view):
    palette, buildings, site, preview = _reload()
    lib.TEX_DIR = os.path.join(MODEL_DIR, "textures")
    os.makedirs(lib.TEX_DIR, exist_ok=True)
    lib.clear_scene()
    for li in list(bpy.data.lights):
        bpy.data.lights.remove(li)
    with open(LAYOUT, encoding="utf-8") as f:
        layout = json.load(f)

    M = palette.build()
    col = lib.collection("PARK")
    col_prev = lib.collection("PREVIEW")
    _, ring = site.slab(layout, M, col)
    site.ground(layout, M, col, ring)
    buildings.build(layout, M, col)
    n_trees = site.trees(layout, M, col) if with_trees else 0
    n_lamps = site.lamps(layout, M, col, col_prev)
    n_garden = site.garden_lamps(layout, M, col, col_prev)
    n_bollards = site.path_lights(layout, M, col, col_prev)
    preview.setup(**view)

    stats = {
        "objects": len(col.all_objects),
        "trees": n_trees,
        "lamps": n_lamps,
        "garden_lamps": n_garden,
        "bollards": n_bollards,
        "tris": sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in col.all_objects if o.type == "MESH" and not o.name.startswith(("tree_", "lamp_", "bollard_", "garden_lamp_"))),
    }
    if save:
        os.makedirs(MODEL_DIR, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(MODEL_DIR, "park.blend"))
    if render_to:
        preview.render(render_to)
    return stats

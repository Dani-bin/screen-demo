"""
老家沙盘建模 · 入口
----------------------------------------------------------
run()  按 site.json + site_grid.npz（scripts/hometown/build_site.py 生成）完整重建，保存 models/hometown/hometown.blend：
  HOMETOWN 集合  导出用：地面 ground（含沙盘侧面）、池塘水面 pond_water、我家 home、
                 其它房屋 house_<id>、树 tree_<种类>_<序号>
  PREVIEW 集合   预览相机、太阳（不导出）
"""

import importlib
import json
import os

import bpy

from . import lib

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
MODEL_DIR = os.path.join(ROOT, "models", "hometown")
HERE = os.path.dirname(__file__)


def _reload():
    """MCP 反复执行时重新加载子模块，确保改过的脚本生效"""
    from . import houses, palette, preview, terrain, trees

    for mod in (lib, palette, terrain, houses, trees, preview):
        importlib.reload(mod)
    return palette, terrain, houses, trees, preview


def run(render_to=None, save=True, with_trees=True, **view):
    palette, terrain, houses, trees, preview = _reload()
    os.makedirs(MODEL_DIR, exist_ok=True)
    blend = os.path.join(MODEL_DIR, "hometown.blend")
    # 先另存为本项目的文件再清场，避免误改当前打开的其它 .blend
    if bpy.data.filepath != blend:
        bpy.ops.wm.save_as_mainfile(filepath=blend)
    lib.TEX_DIR = os.path.join(MODEL_DIR, "textures")
    os.makedirs(lib.TEX_DIR, exist_ok=True)
    lib.clear_scene()
    for li in list(bpy.data.lights):
        bpy.data.lights.remove(li)
    with open(os.path.join(HERE, "site.json"), encoding="utf-8") as f:
        meta = json.load(f)
    vz, cls, slab, bank = terrain.load(os.path.join(HERE, "site_grid.npz"))

    M = palette.build()
    col = lib.collection("HOMETOWN")
    lib.collection("PREVIEW")
    g = terrain.ground(meta, vz, cls, slab, M, col, bank)
    terrain.water(meta, vz, cls, M, col)
    n_houses = houses.build(meta, M, col)
    n_trees = trees.build(meta, M, col) if with_trees else 0
    preview.setup(meta, **view)
    stats = {
        "ground_faces": len(g.data.polygons),
        "houses": n_houses,
        "trees": n_trees,
        "tris": sum(sum(len(p.vertices) - 2 for p in o.data.polygons)
                    for o in col.all_objects
                    if o.type == "MESH" and not o.name.startswith("tree_")),
    }
    if save:
        bpy.ops.wm.save_as_mainfile(filepath=blend)
    if render_to:
        preview.render(render_to)
    return stats

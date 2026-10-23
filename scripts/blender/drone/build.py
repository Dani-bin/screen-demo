"""
无人机巡检 · 化工园区建模 · 入口
----------------------------------------------------------
run()          清空场景并完整重建园区（布局见 site.json / layout.py），保存 models/drone/park.blend；
               render_to="<png>" 时再用定稿标定相机渲染一张同机位预览图
"""

import importlib
import os

import bpy

from . import assets, layout, lib, palette, preview

# 仓库根目录：本文件位于 <repo>/scripts/blender/drone/
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
MODEL_DIR = os.path.join(ROOT, "models", "drone")


def _reload():
    """MCP 反复执行时重新加载子模块，确保改过的脚本生效"""
    for mod in (lib, palette, assets, layout, preview):
        importlib.reload(mod)


def run(render_to=None, save=True):
    _reload()
    lib.TEX_DIR = os.path.join(MODEL_DIR, "textures")
    os.makedirs(lib.TEX_DIR, exist_ok=True)
    lib.clear_scene()
    M = palette.build()
    info = layout.build(M)
    info["preview"] = preview.setup()
    if save:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(MODEL_DIR, "park.blend"))
    if render_to:
        preview.render(render_to)
    return info

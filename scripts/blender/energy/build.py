"""
综合能源补给站建模 · 入口
----------------------------------------------------------
run()          清空场景并完整重建场站（布局见 layout.py），保存 models/energy/station.blend；
               render_to="<png>" 时再用预览相机渲染一张效果图
"""

import importlib
import os

import bpy

from . import assets, bake, layout, lib, lights, palette, preview, vehicles, vendor

# 仓库根目录：本文件位于 <repo>/scripts/blender/energy/
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
MODEL_DIR = os.path.join(ROOT, "models", "energy")


def _reload():
    """MCP 反复执行时重新加载子模块，确保改过的脚本生效"""
    for mod in (lib, palette, assets, vendor, vehicles, layout, preview, lights, bake):
        importlib.reload(mod)


def run(render_to=None, save=True, **view):
    _reload()
    lib.TEX_DIR = os.path.join(MODEL_DIR, "textures")
    os.makedirs(lib.TEX_DIR, exist_ok=True)
    lib.clear_scene()
    M = palette.build()
    info = layout.build(M)
    info["vehicles"] = vehicles.build(M)
    preview.setup(**view)
    if save:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(MODEL_DIR, "station.blend"))
    if render_to:
        preview.render(render_to)
    return info

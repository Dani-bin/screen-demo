"""
井上地面输送 · 103 机头建模 · 入口
----------------------------------------------------------
run()  清空场景并完整重建（尺寸见 layout.py），保存 models/coal-prep/conveyor.blend；
       render_to="<png>" 时再用定稿标定相机渲染一张同机位预览图（1536 × 864，与 concept-r3 同尺寸）
"""

import importlib
import os

import bpy

from . import layout, lib, lights, palette, preview

# 仓库根目录：本文件位于 <repo>/scripts/blender/coal_prep/
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
MODEL_DIR = os.path.join(ROOT, "models", "coal-prep")


def _reload():
    """MCP 反复执行时重新加载子模块，确保改过的脚本生效"""
    for mod in (lib, palette, layout, lights, preview):
        importlib.reload(mod)


def run(render_to=None, save=True, engine="eevee"):
    _reload()
    lib.TEX_DIR = os.path.join(MODEL_DIR, "textures")
    os.makedirs(lib.TEX_DIR, exist_ok=True)
    lib.clear_scene()
    M = palette.build()
    info = layout.build(M)
    info["preview"] = preview.setup(engine)
    if save:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(MODEL_DIR, "conveyor.blend"))
    if render_to:
        preview.render(render_to)
    return info

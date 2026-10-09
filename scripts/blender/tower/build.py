"""
楼层模型 · 入口
----------------------------------------------------------
run()  清空场景，按 scripts/blender/park/layout.json 的双子塔轮廓，为南塔 / 北塔各生成 floors.VARIANTS 里的全部楼层变体，
       每个变体两个对象 <塔>_<变体>（如 S_off_85，楼板 + 核心筒墙，自动展开烘焙用 UV）与 <塔>_<变体>_v（家具等，烘焙到顶点色），
       保存 models/tower/tower.blend。
       变体在场景里相互错开 220 m 摆放：烘焙时只渲染当前对象，其它对象隐藏，互不照亮。
"""

import importlib
import json
import math
import os

import bpy

from . import floors, lib

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
MODEL_DIR = os.path.join(ROOT, "models", "tower")
LAYOUT = os.path.join(ROOT, "scripts", "blender", "park", "layout.json")
TOWERS = {"S": "tower_S", "N": "tower_N"}


def unwrap(ob):
    """烘焙用 UV：Smart UV Project（楼板顶面一整块，核心筒四面墙各一块），岛间留 0.01 的缝"""
    vl = bpy.context.view_layer
    vl.update()
    for o in bpy.context.scene.objects:
        o.select_set(False)
    ob.select_set(True)
    vl.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    ob.data.uv_layers[0].name = "Lightmap"


def run(only=None):
    importlib.reload(lib)
    importlib.reload(floors)
    lib.clear_scene()
    with open(LAYOUT, encoding="utf-8") as f:
        layout = json.load(f)
    M = floors.materials()
    col = lib.collection("TOWER")
    stats = {}
    for ti, (tag, key) in enumerate(TOWERS.items()):
        foot, _ = floors.tower_plan(layout, key)
        for vi, var in enumerate(floors.VARIANTS):
            name = f"{tag}_{var}"
            if only and name not in only:
                continue
            ob, ov = floors.build(name, foot, var, M, col, (vi * 220.0, ti * 220.0, 0.0))
            unwrap(ob)
            # 顶点色烘焙目标：面角域（每个面的四个角各存一份，盒子各面明暗分开）
            ov.data.color_attributes.new("Bake", "FLOAT_COLOR", "CORNER")
            ov.data.color_attributes.active_color = ov.data.color_attributes["Bake"]
            stats[name] = [len(ob.data.polygons), len(ov.data.polygons)]
    # 夜空：深蓝弱光，从敞开的楼层四周照进来，熄灯区读成冷蓝
    w = bpy.data.worlds.get("W_tower") or bpy.data.worlds.new("W_tower")
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.012, 0.03, 0.08, 1)
    bg.inputs["Strength"].default_value = 1.0
    bpy.context.scene.world = w
    os.makedirs(MODEL_DIR, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(MODEL_DIR, "tower.blend"))
    return stats

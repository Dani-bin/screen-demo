"""
楼层模型 · 入口
----------------------------------------------------------
run()  清空场景，按 scripts/blender/park/layout.json 的双子塔轮廓，为南塔 / 北塔各生成 floors.VARIANTS 里的全部楼层变体，
       另为斜屋顶下的几层各建一个 <塔>_top_<层号>（楼板与家具按屋面裁剪），以及地下机房 <塔>_basement（basement.py）。
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


def roof_floors(foot, b):
    """
    斜屋顶下的楼层：与 BuildingScene.js 相同的竖向换算（标准层 2.2 m、裙楼 4 × 4.6 m、屋顶高差按层高比例缩放），
    返回 [(楼层号, 变体, (下坡方向, 楼板处投影上限, 家具处投影上限))]
    """
    levels = b["levels"]
    roof = b.get("roof") or {}
    podium_h = 4 * floors.PODIUM_FLOOR
    rise = (roof.get("height", 18) / (b["height"] / levels)) * floors.FLOOR
    H = podium_h + (levels - 4) * floors.FLOOR + rise
    a = math.radians(roof.get("direction", 90))
    d = (math.sin(a), math.cos(a))  # three 的 (sin, -cos) 换到 Blender 的 xy（y = -z）
    proj = [x * d[0] + y * d[1] for x, y in foot]
    lo, span = min(proj), max(proj) - min(proj)

    def lim(y):
        return lo + (H - y) * span / rise

    out = []
    for i in range(5, levels + 1):
        bottom = podium_h + (i - 5) * floors.FLOOR
        if bottom + floors.FLOOR < H - rise - 0.01:
            continue
        var = "sky" if i >= levels - 1 else "plant" if i == 54 else "off_85"
        out.append((i, var, (d, lim(bottom + 0.05), lim(bottom + 1.3))))
    return out


def run(only=None, keep=False):
    """
    only：只生成这些对象名（如 {"S_basement"}）；keep=True 时不清空场景、只替换这些对象（已烘焙的其它对象保留）
    """
    from . import basement

    importlib.reload(lib)
    importlib.reload(floors)
    importlib.reload(basement)
    if not keep:
        lib.clear_scene()
    with open(LAYOUT, encoding="utf-8") as f:
        layout = json.load(f)
    M = floors.materials()
    col = lib.collection("TOWER")
    stats = {}

    def make(name, fn, slot):
        if only and name not in only:
            return
        for nm in (name, name + "_v"):
            old = bpy.data.objects.get(nm)
            if old:
                me = old.data
                bpy.data.objects.remove(old, do_unlink=True)
                bpy.data.meshes.remove(me)
        ob, ov = fn((slot % 12 * 220.0, slot // 12 * 220.0 + ti * 1000.0, 0.0))
        ob.name, ov.name = name, name + "_v"
        unwrap(ob)
        # 顶点色烘焙目标：面角域（每个面的四个角各存一份，盒子各面明暗分开）
        ov.data.color_attributes.new("Bake", "FLOAT_COLOR", "CORNER")
        ov.data.color_attributes.active_color = ov.data.color_attributes["Bake"]
        stats[name] = [len(ob.data.polygons), len(ov.data.polygons)]

    for ti, (tag, key) in enumerate(TOWERS.items()):
        foot, b = floors.tower_plan(layout, key)
        slot = 0
        for var in floors.VARIANTS:
            make(f"{tag}_{var}", lambda loc, var=var: floors.build(f"{tag}_{var}", foot, var, M, col, loc), slot)
            slot += 1
        # 斜屋顶下的楼层：每层单独建模（楼板与家具按屋面裁剪）
        for i, var, roof in roof_floors(foot, b):
            nm = f"{tag}_top_{i}"
            make(nm, lambda loc, var=var, roof=roof, nm=nm: floors.build(nm, foot, var, M, col, loc, roof), slot)
            slot += 1
        radius = max(math.hypot(x, y) for x, y in foot)
        make(f"{tag}_basement", lambda loc: basement.build(f"{tag}_basement", radius, M, col, loc), slot)
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

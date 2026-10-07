"""
智慧充电站建模 · 入口
----------------------------------------------------------
run()          清空场景并完整重建场站（布局见 layout.py），保存 models/charging/station.blend
test_assets()  把各预制件排成一排，渲染核对单件造型
"""

import importlib
import os

import bpy

from . import assets, lib, palette, preview

# 仓库根目录：本文件位于 <repo>/scripts/blender/charging/
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
MODEL_DIR = os.path.join(ROOT, "models", "charging")


def _reload():
    """MCP 反复执行时重新加载子模块，确保改过的脚本生效"""
    from . import building, layout, vendor

    for mod in (lib, palette, assets, vendor, building, layout, preview):
        importlib.reload(mod)


def _init():
    _reload()
    lib.TEX_DIR = os.path.join(MODEL_DIR, "textures")
    os.makedirs(lib.TEX_DIR, exist_ok=True)
    lib.clear_scene()
    return palette.build()


def test_assets(out, scale=52, target=(19, 5, 1.5)):
    """预制件陈列：桩、超充、车、储能柜、箱变、树等排成一排，渲染到 out"""
    M = _init()
    col = lib.collection("TEST")
    fp = assets.fast_pile(M)
    sp = assets.super_pile(M)
    items = []
    for k in ("body", "screen", "status"):
        items.append((fp[k], 0, 0))
        items.append((sp[k], 3, 0))
    items += [
        (assets.car(M, "sedan", "white"), 7, 0),
        (assets.car(M, "suv", "graphite"), 7, 3.5),
        (assets.ess_cabinet(M), 13, 0),
        (assets.transformer(M), 17.5, 0),
        (assets.switchgear(M), 20.5, 0),
        (assets.power_cabinet(M), 23.5, 0),
        (assets.tree(M, 0), 27, 0),
        (assets.tree(M, 1), 29.5, 0),
        (assets.bush(M), 27, 2.5),
        (assets.street_light(M), 31.5, 0),
        (assets.bollard(M), 31.5, 2),
        (assets.totem(M), 35, 0),
    ]
    g = assets.gate(M)
    items += [(g["base"], 40, 0), (g["arm"], 40, 0)]
    for i, (me, x, y) in enumerate(items):
        ob = lib.place(me, f"t_{i}_{me.name}", col, (x, y, 0))
        if me.name == "gate_arm":
            ob.location.z = 1.0
    cp = assets.canopy(M, 16, 10.4, 5.6, "canopy_test", [-5, 5])
    for k, me in cp.items():
        lib.place(me, "t_canopy_" + k, col, (10, 14, 0))
    # 地面
    import bmesh

    bm = bmesh.new()
    lib.add_box(bm, (70, 40, 0.2), (18, 6, -0.1))
    lib.uv_box(bm, 4.0)
    lib.place(lib.make_mesh("t_ground", bm, [M["asphalt"]]), "t_ground", col)
    preview.setup(ortho_scale=scale, target=target)
    return preview.render(out)


def run(render_to=None, save=True, ortho_scale=112.0, target=(-3, 2, 0), azimuth=-128.0, elevation=36.0):
    """
    完整重建场站：
    - STATION 集合：场站静态模型（导出 public/charging/station.glb）
    - CARS 集合：车辆预制（导出 public/charging/cars.glb），预览时隐藏
    - PREVIEW 集合：预览用的停放车辆、充电线、告警波纹、光晕、相机灯光（不导出）
    render_to 给出路径时渲染一张整站效果图；save=True 时保存 models/charging/station.blend
    """
    from . import layout

    M = _init()
    col_station = lib.collection("STATION")
    col_cars = lib.collection("CARS")
    col_preview = lib.collection("PREVIEW")
    layout.build(M, col_station, col_cars, col_preview)
    col_cars.hide_render = True
    col_cars.hide_viewport = True
    preview.setup(ortho_scale=ortho_scale, target=target, azimuth=azimuth, elevation=elevation)
    stats = {
        "objects": len(col_station.all_objects),
        "tris": sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in col_station.all_objects if o.type == "MESH"),
    }
    if save:
        os.makedirs(MODEL_DIR, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(MODEL_DIR, "station.blend"))
    if render_to:
        preview.render(render_to)
    return stats

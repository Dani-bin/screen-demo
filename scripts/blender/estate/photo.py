"""
澜岸云境沙盘 · 照片模式整套渲染
----------------------------------------------------------
场景只建一次，按分镜表逐张渲染，已有的 PNG 默认跳过（可中断重跑）：
  home_<光照>      主视图 × 4 档光照（day / golden / dusk / night），页面按小时在相邻两档之间渐变
  <近景>_<光照>    8 个近景视图（导览停靠点和图层镜头）× 2 档（day / dusk）
  orbit_<i>        环绕：以主视图的目标为圆心、同俯角同距离，方位角每 30° 一张（orbit_0 就是 home_dusk，不重渲），黄昏光
  mask_home        主视图的楼栋 ID 遮罩（Workbench 平涂，无抗锯齿），页面点楼 / 高亮用
输出：models/estate/render/photo/*.png（原图）和 public/estate/photo/manifest.json（相机、光照档、视图表）。
PNG → WebP 由 scripts/estate/photo_post.py 转。

相机的取景数学和页面 EstateScene.flyToPlan / setLayer 保持一致：目标 (x, h, -y)，相机在目标的球面坐标上
（azimuth 0 = 从正南往北看，正值向东绕；polar = 离竖直方向的角度）。manifest 里写的是 three.js 坐标，
页面（PhotoScene）直接用它做投影，所以插牌和高亮能和图对上。
"""

import json
import math
import os

import bpy
from mathutils import Vector

from . import render as R
from .lib import ROOT

OUT_PNG = os.path.join(R.RENDER_DIR, "photo")
OUT_PUBLIC = os.path.join(ROOT, "public", "estate", "photo")
SIZE = (1920, 1080)

# 光照档对应的页面时刻（小时）；页面按小时在相邻两档之间渐变
LIGHTINGS = [("day", 10.0), ("golden", 16.0), ("dusk", 18.5), ("night", 21.5)]

# 平面坐标 → three.js：(x, h, -y)；three → Blender：(x, -z, y)
def _three(pos):
    return [round(pos.x, 3), round(pos.y, 3), round(pos.z, 3)]


def _to_blender(p):
    return Vector((p[0], -p[2], p[1]))


def fly_camera(x, y, dist=260.0, polar=37.0, azimuth=0.0, h=0.0):
    """EstateScene.flyToPlan 的相机位置（three.js 坐标）：返回 (位置, 目标)"""
    tgt = Vector((x, h, -y))
    p, a = math.radians(polar), math.radians(azimuth)
    pos = tgt + Vector((math.sin(a) * math.sin(p) * dist, math.cos(p) * dist, math.cos(a) * math.sin(p) * dist))
    return pos, tgt


def layer_camera(layout, layer_id):
    """EstateScene.setLayer 的取景：框住这一类里靠近小区的对象（宽 < 200 m）"""
    info = {a["id"]: a for a in layout["buildings"] + layout["amenities"]}
    layer = next(l for l in layout["layers"] if l["id"] == layer_id)
    near = [info[i] for i in layer["ids"] if i in info and info[i]["w"] < 200]
    minx = min(m["cx"] - m["w"] / 2 for m in near)
    maxx = max(m["cx"] + m["w"] / 2 for m in near)
    miny = min(m["cy"] - m["d"] / 2 for m in near)
    maxy = max(m["cy"] + m["d"] / 2 for m in near)
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    span = max(maxx - minx, (maxy - miny) * 1.6, 60)
    return (cx, cy), dict(dist=min(900.0, 150 + span * 1.25), polar=44.0)


def close_up_defs(layout):
    """8 个近景：id → (名称, 取景参数)。前三个是 tour.js 里 flyToPlan 的参数，后五个是图层镜头"""
    defs = {
        "towers": ("北排高层", (0, 70), dict(dist=320, polar=50, azimuth=-22, h=40)),
        "terrace": ("洋房组团", (0, 15), dict(dist=270, polar=46, azimuth=24, h=8)),
        "villas": ("滨河联排", (0, -78), dict(dist=230, polar=44, azimuth=-16, h=4)),
    }
    for lid, name in (("traffic", "区位交通"), ("scenic", "景观轴与湖"), ("club", "会所与配套"), ("shop", "商业"), ("edu", "教育")):
        xy, o = layer_camera(layout, lid)
        defs[lid] = (name, xy, o)
    return defs


def view_table(layout):
    """全部视图：{id: {name, kind, camera(three), focus, lightings}}，以及环绕帧表"""
    home_pos, home_tgt, fov = R.home_camera()
    # 主视图的 three 坐标直接取 camera.json
    cj = json.load(open(os.path.join(ROOT, "src", "views", "estate", "data", "camera.json")))["three"]
    views = {
        "home": {
            "name": "总览",
            "camera": {"position": cj["position"], "target": cj["target"], "fov": cj["fov"]},
            "focus": [cj["target"][0], -cj["target"][2]],
            "lightings": [l for l, _ in LIGHTINGS],
        }
    }
    for vid, (name, xy, o) in close_up_defs(layout).items():
        pos, tgt = fly_camera(xy[0], xy[1], **o)
        views[vid] = {
            "name": name,
            "camera": {"position": _three(pos), "target": _three(tgt), "fov": cj["fov"]},
            "focus": [xy[0], xy[1]],
            "lightings": ["day", "dusk"],
        }
    # 环绕：围着主视图的目标点转，俯角和距离同主视图
    t = Vector(cj["target"])
    p = Vector(cj["position"])
    d = (p - t).length
    polar = math.degrees(math.acos((p - t).y / d))
    frames = []
    for i in range(12):
        az = i * 30.0
        pos, tgt = fly_camera(t.x, -t.z, dist=d, polar=polar, azimuth=az, h=t.y)
        frames.append({"azimuth": az, "camera": {"position": _three(pos), "target": _three(tgt), "fov": cj["fov"]}})
    return views, frames


def jobs(views, frames):
    """渲染任务表 [(名字, 相机(three), 光照档)]"""
    out = []
    for lid, _ in LIGHTINGS:
        out.append((f"home_{lid}", views["home"]["camera"], lid))
    for vid, v in views.items():
        if vid == "home":
            continue
        for lid in v["lightings"]:
            out.append((f"{vid}_{lid}", v["camera"], lid))
    for i, f in enumerate(frames):
        if i == 0:
            continue  # orbit_0 = home_dusk
        out.append((f"orbit_{i}", f["camera"], "dusk"))
    return out


def render_mask(layout, path):
    """楼栋 ID 遮罩：只留楼体，每栋一个平涂色（R = (序号 + 1) × 8，G = B = 40），Workbench、无抗锯齿"""
    s = bpy.context.scene
    ids = [b["id"] for b in layout["buildings"]] + [a["id"] for a in layout["amenities"] if a["shape"] in ("building", "gate", "garage")]
    code = {i: n + 1 for n, i in enumerate(ids)}
    body = {}
    for ob in bpy.data.objects:
        if ob.name.endswith("_body") and ob.name[:-5] in code:
            body[ob.name[:-5]] = ob
    hidden = {}
    for ob in bpy.data.objects:
        hidden[ob.name] = ob.hide_render
        ob.hide_render = ob not in body.values()
    lin = lambda b: (b / 255 / 12.92) if b / 255 <= 0.04045 else ((b / 255 + 0.055) / 1.055) ** 2.4  # noqa: E731
    for i, ob in body.items():
        ob.color = (lin(code[i] * 8), lin(40), lin(40), 1.0)
    keep = (s.render.engine, s.render.filepath, s.view_settings.view_transform, s.view_settings.look, s.render.dither_intensity, tuple(s.world.color))
    ng = s.compositing_node_group  # 遮罩要精确颜色，不能过泛光
    s.compositing_node_group = None
    s.render.engine = "BLENDER_WORKBENCH"
    sh = s.display.shading
    sh.light, sh.color_type, sh.show_shadows, sh.show_cavity = "FLAT", "OBJECT", False, False
    s.display.render_aa = "OFF"
    s.view_settings.view_transform, s.view_settings.look = "Standard", "None"
    s.render.dither_intensity = 0.0
    s.world.color = (0, 0, 0)
    s.render.filepath = path
    bpy.ops.render.render(write_still=True)
    s.render.engine, s.render.filepath, s.view_settings.view_transform, s.view_settings.look, s.render.dither_intensity = keep[:5]
    s.world.color = keep[5]
    s.compositing_node_group = ng
    for name, h in hidden.items():
        if name in bpy.data.objects:
            bpy.data.objects[name].hide_render = h
    return {i: [code[i] * 8, 40, 40] for i in ids}


def render_all(samples=128, orbit_samples=96, only=None, force=False):
    os.makedirs(OUT_PNG, exist_ok=True)
    os.makedirs(OUT_PUBLIC, exist_ok=True)
    info = R.build_scene(0.85)
    M, layout = info["M"], info["layout"]
    views, frames = view_table(layout)
    task = jobs(views, frames)
    # manifest 先写出（页面和后处理都要用），遮罩色表一并写进去
    manifest = {
        "size": list(SIZE),
        "lightings": [{"id": l, "hour": h} for l, h in LIGHTINGS],
        "views": views,
        "orbit": {"lighting": "dusk", "frames": frames},
    }
    done = {}
    cam = bpy.data.objects.get("CAM")
    R.configure_render(SIZE[0], SIZE[1], samples)
    # ---- 遮罩（主视图机位）
    mpath = os.path.join(OUT_PNG, "mask_home.png")
    if force or not os.path.exists(mpath) or (only and "mask_home" in only):
        R.set_camera(*R.home_camera())
        manifest["maskColors"] = render_mask(layout, mpath)
        json.dump(manifest["maskColors"], open(os.path.join(OUT_PNG, "mask_colors.json"), "w"))
    else:
        manifest["maskColors"] = json.load(open(os.path.join(OUT_PNG, "mask_colors.json")))
    # ---- 逐张渲染；按光照档分组，减少重设光照的次数
    order = {"day": 0, "golden": 1, "dusk": 2, "night": 3}
    task.sort(key=lambda t: (order[t[2]], t[0]))
    cur = None
    for name, camera, lid in task:
        out = os.path.join(OUT_PNG, name + ".png")
        if only and name not in only:
            continue
        if os.path.exists(out) and not force:
            done[name] = "skip"
            continue
        if cur != lid:
            R.apply_lighting(M, lid)
            cur = lid
        pos, tgt = _to_blender(camera["position"]), _to_blender(camera["target"])
        R.set_camera(pos, tgt, camera["fov"])
        bpy.context.scene.cycles.samples = orbit_samples if name.startswith("orbit_") else samples
        bpy.context.scene.render.filepath = out
        bpy.ops.render.render(write_still=True)
        done[name] = "ok"
        print("PHOTO_DONE", name, flush=True)
    json.dump(manifest, open(os.path.join(OUT_PUBLIC, "manifest.json"), "w"), ensure_ascii=False, indent=1)
    return {"jobs": len(task), "done": done}

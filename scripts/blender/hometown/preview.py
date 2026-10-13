"""
老家沙盘建模 · 预览渲染
----------------------------------------------------------
盛夏傍晚：太阳按真实方位放在西北偏西（真方位约 290°、高度约 16°），
换算到场地坐标（+y = 真方位 76.2°）后是从截图左下方照过来，正好照亮我家正立面。
相机默认从大田一侧（截图下方）往坡上看，我家在画面中部偏上。
"""

import math

import bpy
from mathutils import Vector

from . import lib


def _dir(az_true, el, up_az):
    """真方位角 / 高度角 → 场地坐标里的单位向量（+y = 图像上 = 真方位 up_az）。"""
    a = math.radians(az_true - up_az)          # 相对图像上方的顺时针角
    e = math.radians(el)
    return Vector((math.sin(a) * math.cos(e), math.cos(a) * math.cos(e),
                   math.sin(e)))


def setup(meta, res=(1600, 900), target=(0, 8, 6), azimuth=-96.0,
          elevation=34.0, dist=430.0, lens=50.0, sun_az=290.0, sun_el=16.0):
    """azimuth：相机所在方向（场地坐标，0 = +x，逆时针为正；-90 = 截图正下方）。"""
    s = bpy.context.scene
    col = lib.collection("PREVIEW")
    s.render.engine = "BLENDER_EEVEE"
    s.render.resolution_x, s.render.resolution_y = res
    s.render.resolution_percentage = 100
    s.render.film_transparent = False
    try:
        s.view_settings.view_transform = "AgX"
        s.view_settings.look = "AgX - Base Contrast"
    except TypeError:
        pass
    s.eevee.taa_render_samples = 48
    s.eevee.use_shadows = True
    s.eevee.use_raytracing = True
    s.eevee.use_fast_gi = True

    # 世界：傍晚偏暖的灰蓝天光
    w = bpy.data.worlds.get("W_dusk") or bpy.data.worlds.new("W_dusk")
    if w.node_tree is None:
        w.use_nodes = True
    nt = w.node_tree
    bg = next((n for n in nt.nodes if n.type == "BACKGROUND"), None)
    if bg is None:
        nt.nodes.clear()
        bg = nt.nodes.new("ShaderNodeBackground")
        wo = nt.nodes.new("ShaderNodeOutputWorld")
        nt.links.new(bg.outputs["Background"], wo.inputs["Surface"])
    bg.inputs["Color"].default_value = (0.42, 0.45, 0.52, 1)
    bg.inputs["Strength"].default_value = 0.9
    s.world = w

    up_az = meta["up_azimuth"]
    to_sun = _dir(sun_az, sun_el, up_az)
    sun = bpy.data.lights.get("L_sun") or bpy.data.lights.new("L_sun", "SUN")
    sun.energy = 4.2
    sun.color = (1.0, 0.82, 0.62)
    sun.angle = math.radians(2.5)
    ob = bpy.data.objects.get("L_sun") or bpy.data.objects.new("L_sun", sun)
    if ob.name not in col.objects:
        col.objects.link(ob)
    ob.rotation_euler = (-to_sun).to_track_quat("-Z", "Y").to_euler()

    cam = bpy.data.cameras.get("C_main") or bpy.data.cameras.new("C_main")
    cam.lens = lens
    cam.clip_start = 1
    cam.clip_end = 5000
    cob = bpy.data.objects.get("C_main") or bpy.data.objects.new("C_main", cam)
    if cob.name not in col.objects:
        col.objects.link(cob)
    az, el = math.radians(azimuth), math.radians(elevation)
    d = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el),
                math.sin(el)))
    t = Vector(target)
    cob.location = t + d * dist
    cob.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    s.camera = cob


def home_view(meta, dist=30.0, eye=2.2, lens=32.0, side=0.0, aim=0.0):
    """近景：照片机位——站在我家门前的院坝 / 田坎上，正对正立面略仰视。
    side：沿立面方向的横移（米，正值往面朝外时的右手边）。"""
    h = next(x for x in meta["houses"] if x["kind"] == "home")
    n = Vector((math.cos(h["face"]), math.sin(h["face"]), 0))
    r = Vector((math.sin(h["face"]), -math.cos(h["face"]), 0))
    c = Vector((h["cx"], h["cy"], h["z"]))
    cob = bpy.data.objects["C_main"]
    cob.data.lens = lens
    s = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    goal = c + Vector((0, 0, 5.5))
    # 门前有邻居家房子和树，可能挡住镜头：从房子往机位打射线，被挡就换个横移 / 距离再试
    best = None
    for dd in (dist, dist - 3, dist - 6, dist + 3):
        for sd in (side, side + 2, side - 2, side + 4, side - 4, 0.0):
            pos = c + n * dd + r * sd + Vector((0, 0, eye))
            v = pos - goal
            hit, loc, _, _, ob, _ = s.ray_cast(dg, goal + v.normalized() * 7,
                                               v.normalized(), distance=v.length - 7)
            if not hit:
                best = pos
                break
        if best:
            break
    cob.location = best or (c + n * dist + r * side + Vector((0, 0, eye)))
    # aim：看向房子右侧一点，让房子落在画面左半边（右边留给老照片卡片）
    look = goal + r * aim - cob.location
    cob.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()


def route_line(meta, M):
    """回家路线（设计稿用）：沿路线抬高 0.5 m 的暖黄色发光细管，只放 PREVIEW 集合、不导出。"""
    import bmesh
    col = lib.collection("PREVIEW")
    old = bpy.data.objects.get("route_line")
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    pts = [Vector((x, y, z + 0.5)) for x, y, z in meta["route"]]
    dense = []
    for a, b in zip(pts, pts[1:]):  # 加密，管子转弯更顺
        for k in range(4):
            dense.append(a.lerp(b, k / 4))
    dense.append(pts[-1])
    bm = bmesh.new()
    lib.add_tube(bm, dense, 0.35, seg=8)
    mat = lib.material("PV_route", "#ffd27a", emit="#ffc451", strength=6.0)
    ob = bpy.data.objects.new("route_line", lib.make_mesh("route_line", bm,
                                                          [mat]))
    col.objects.link(ob)
    return ob


def use_cycles(samples=64):
    """出设计稿时切到 Cycles（软阴影、天光遮蔽更真实）。"""
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "GPU"
    s.cycles.samples = samples
    s.cycles.use_denoising = True
    s.cycles.max_bounces = 4


def render(path):
    s = bpy.context.scene
    s.render.filepath = path
    s.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    return path

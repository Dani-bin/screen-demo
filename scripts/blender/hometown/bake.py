"""
老家沙盘建模 · 地面贴图（正交俯视渲染）
----------------------------------------------------------
网页里看不了几十万株稻子的实例，所以把地面连同稻株、田埂草、菜、林下草，以及房屋 / 树投下的影子，
用 Cycles 从正上方正交渲染成一张贴图，按地面第二套 UV（Lightmap，terrain.ortho_frame）铺回地面：
  public/hometown/ground_dusk.webp   盛夏傍晚
  public/hometown/ground_night.webp  夜晚（家家门口的暖灯照亮地坝）
房屋、树、电线杆只投影子不出镜（visible_camera = False）；水面不出镜（网页里单独做反光水面）。
渲染较慢（每张约 2–4 分钟），在 bpy.app.timers 里跑，MCP 调用立即返回；完成写 <out>/ground_done。
"""

import math
import os

import bpy

from . import lib
from .build import ROOT
from .terrain import ortho_frame

OUT = os.path.join(ROOT, "public", "hometown")


def _camera(meta, res):
    x0, y0, x1, y1 = ortho_frame(meta)
    s = bpy.context.scene
    cam = bpy.data.cameras.get("C_ortho") or bpy.data.cameras.new("C_ortho")
    cam.type = "ORTHO"
    cam.ortho_scale = max(x1 - x0, y1 - y0)
    cam.clip_start, cam.clip_end = 1, 500
    ob = bpy.data.objects.get("C_ortho") or bpy.data.objects.new("C_ortho", cam)
    col = lib.collection("PREVIEW")
    if ob.name not in col.objects:
        col.objects.link(ob)
    ob.location = ((x0 + x1) / 2, (y0 + y1) / 2, 200)
    ob.rotation_euler = (0, 0, 0)
    w = x1 - x0
    h = y1 - y0
    s.render.resolution_x = res if w >= h else round(res * w / h)
    s.render.resolution_y = round(res * h / w) if w >= h else res
    s.render.resolution_percentage = 100
    s.camera = ob


def _hide_from_camera(on):
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        if o.name.startswith(("house_", "home", "tree_", "pole_", "wires",
                              "pond_water", "route_line")):
            o.visible_camera = not on


def bake_async(meta, res=4096, samples=96):
    from . import beauty, preview as pv
    done = os.path.join(OUT, "ground_done")
    os.makedirs(OUT, exist_ok=True)
    if os.path.exists(done):
        os.remove(done)

    def job():
        s = bpy.context.scene
        s.render.film_transparent = False
        _hide_from_camera(True)
        pv.use_cycles(samples)
        s.view_settings.look = "AgX - Medium High Contrast"
        s.render.image_settings.file_format = "WEBP"
        s.render.image_settings.quality = 88
        for key, night in (("dusk", False), ("night", True)):
            pv.setup(meta)                      # 太阳 / 世界恢复默认
            beauty.sky(meta, sun_az=290.0, sun_el=11.0, strength=0.16)
            bpy.data.lights["L_sun"].energy = 5.0
            s.view_settings.exposure = -0.35
            if night:
                beauty.night(meta, True)
            _camera(meta, res)
            s.render.film_transparent = False
            s.camera.data.dof.use_dof = False
            pv.use_cycles(samples)
            s.render.image_settings.file_format = "WEBP"
            s.render.filepath = os.path.join(OUT, f"ground_{key}.webp")
            bpy.ops.render.render(write_still=True)
            if night:
                beauty.night(meta, False)
        _hide_from_camera(False)
        s.render.image_settings.file_format = "PNG"
        open(done, "w").close()
        return None

    bpy.app.timers.register(job, first_interval=0.5)

"""
澜岸云境沙盘 · 预览渲染（Workbench，几秒一张，只用来看造型对不对）
----------------------------------------------------------
相机用页面的主机位 src/views/estate/data/camera.json（three.js 坐标 → Blender：(X, Y, Z) → (X, -Z, Y)）。
"""

import json
import math
import os

import bpy
from mathutils import Vector

from .lib import ROOT


def _look_at(cam, pos, target):
    d = Vector(target) - Vector(pos)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def render(path, width=1920, height=1080, cam=None, shots=None):
    """cam：(pos, target, fov) 用 Blender 坐标；默认页面主机位"""
    scene = bpy.context.scene
    if cam is None:
        c = json.load(open(os.path.join(ROOT, "src", "views", "estate", "data", "camera.json")))["three"]
        p, t = c["position"], c["target"]
        cam = ((p[0], -p[2], p[1]), (t[0], -t[2], t[1]), c["fov"])
    pos, target, fov = cam
    co = bpy.data.cameras.new("PV")
    co.sensor_fit = "VERTICAL"
    co.angle_y = math.radians(fov)
    co.clip_end = 5000
    ob = bpy.data.objects.new("PV", co)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = pos
    _look_at(ob, pos, target)
    scene.camera = ob
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.render.resolution_percentage = 100
    sh = scene.display.shading
    sh.light = "STUDIO"
    sh.color_type = "MATERIAL"
    sh.show_shadows = True
    sh.shadow_intensity = 0.4
    sh.show_cavity = True
    scene.display.render_aa = "8"
    scene.world = scene.world or bpy.data.worlds.new("W")
    scene.world.color = (0.55, 0.52, 0.48)
    scene.render.filepath = path
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(ob, do_unlink=True)
    return path

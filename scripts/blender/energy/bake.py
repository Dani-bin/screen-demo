"""
综合能源补给站建模 · 地面光照烘焙
----------------------------------------------------------
用 Cycles 把「最终画面」烘进地面贴图（COMBINED：沥青 / 混凝土 / 草地贴图 × 光照）：
罩棚下的亮白站坪、路灯光斑、树下投光、灯带溢光、罩棚 / 建筑 / 设备 / 树的软阴影与环境遮蔽。
three.js 里地面（ground 对象）直接用这张图（UV channel 1，见 layout.join_ground）。

光源见 lights.py；烘焙时隐藏会随仿真变化的东西（超充位状态描边），避免把某一时刻的状态印在地上。
输出 public/energy/ground_bake.webp。整图烘焙在 M2 GPU 上约几分钟：MCP 调用会超时，
用 bake_async() 交给 bpy.app.timers 在 Blender 里跑，跑完写文件（status() 查看进度）。
"""

import os
import time

import bpy

from . import lights

# 仓库根目录（不从 build 导入，避免 build ↔ bake 循环导入）
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "public", "energy", "ground_bake.webp")
DYNAMIC_PREFIX = ("bay_",)
STATE = {"status": "idle"}


def _setup(samples):
    from . import preview

    s = bpy.context.scene
    preview.use_cycles(samples=samples)
    s.cycles.samples = samples
    s.render.bake.margin = 4
    # 夜景：世界光很暗，月光只留一点冷色轮廓，画面亮度主要来自人工光源
    bg = next(n for n in s.world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Strength"].default_value = 0.7
    for name, e in (("L_moon", 0.7), ("L_fill", 0.25)):
        li = bpy.data.lights.get(name)
        if li:
            li.energy = e
    for c in ("VEHICLES",):
        if c in bpy.data.collections:
            bpy.data.collections[c].hide_render = True
    return s


def bake(width=6144, samples=96, out=OUT):
    """同步烘焙（小尺寸试烘时用；整图请用 bake_async）"""
    s = _setup(samples)
    n_lights = lights.build()
    ground = bpy.data.objects["ground"]
    me = ground.data
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    # 贴图宽高比与 Lightmap 覆盖范围一致（像素是正方形的）
    height = int(round(width * (max(ys) - min(ys)) / (max(xs) - min(xs)) / 8)) * 8
    me.uv_layers.active = me.uv_layers["Lightmap"]
    img = bpy.data.images.get("T_ground_bake")
    if img is not None:
        bpy.data.images.remove(img)
    img = bpy.data.images.new("T_ground_bake", width, height, alpha=False)

    hidden = [ob for ob in bpy.data.objects if ob.name.startswith(DYNAMIC_PREFIX) and not ob.hide_render]
    for ob in hidden:
        ob.hide_render = True
    nodes = []
    for slot in ground.material_slots:
        nt = slot.material.node_tree
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img
        nt.nodes.active = n
        nodes.append((nt, n))
    t0 = time.time()
    try:
        vl = bpy.context.view_layer
        vl.update()
        for ob in vl.objects:
            ob.select_set(False)
        ground.select_set(True)
        vl.objects.active = ground
        bpy.ops.object.bake(type="COMBINED", use_clear=True, margin=4)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        img.filepath_raw = out
        img.file_format = "WEBP" if out.endswith(".webp") else "PNG"
        s.render.image_settings.quality = 90
        img.save()
    finally:
        for nt, n in nodes:
            nt.nodes.remove(n)
        me.uv_layers.active = me.uv_layers[0]
        for ob in hidden:
            ob.hide_render = False
    return {"out": out, "size": [width, height], "lights": n_lights, "sec": round(time.time() - t0, 1)}


def bake_async(**kw):
    """交给 Blender 的定时器执行整图烘焙（MCP 调用立即返回），完成后 STATE 里有结果"""
    STATE.clear()
    STATE["status"] = "running"
    STATE["start"] = time.time()

    def run():
        try:
            STATE.update(bake(**kw))
            STATE["status"] = "done"
        except Exception as e:  # noqa: BLE001  烘焙失败时把原因留给 status() 查看
            STATE["status"] = f"error: {e}"
        return None

    bpy.app.timers.register(run, first_interval=0.5)
    return STATE


def status():
    return dict(STATE)

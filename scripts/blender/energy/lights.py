"""
综合能源补给站建模 · 烘焙用光源
----------------------------------------------------------
设计稿的真实感几乎全来自光：罩棚下整片亮白的站坪、路灯下边缘清楚的暖色光斑、树下投光、建筑与设备的软阴影。
这些光源只用于 Cycles 烘焙地面（bake.py），放在 BAKE_LIGHTS 集合里，不导出到 GLB。

- 罩棚 / 车棚 / 换电站通道：棚底灯面位置放一盏同尺寸的面光（朝下）
- 路灯：每个灯头一盏朝下的聚光（layout.LAMPS）
- 树下投光：layout.UPLIGHTS 每处一盏暖色点光
- 便利店门前：一盏面光，模拟橱窗透出的冷白光
功率按「每平方米」给，方便按面积缩放；数值是对着烘焙结果调出来的。
"""

import math

import bpy
from mathutils import Vector

from . import layout, lib

# 色温：罩棚 / 换电冷白，路灯与树下投光暖黄
COOL = (0.92, 0.96, 1.0)
CANOPY = (1.0, 0.76, 0.52)  # 罩棚 / 车棚下：设计稿是暖白（实测站坪约 136,107,91）
WARM = (1.0, 0.78, 0.52)
CANOPY_W_PER_M2 = 3.0  # 罩棚面光：每平方米功率（W）
LAMP_W = 5200.0  # 路灯聚光（对照设计稿实测：路面、车位前通道要更亮一些）
UPLIGHT_W = 260.0  # 树下投光（放在树冠下 2.5 m 高、光源半径 1 m：照亮树下一圈地面，而不是一个小亮点）
# 罩棚檐口彩色灯带的溢光：每米功率（W），颜色与灯带一致
EDGE_W_PER_M = 12.0
# 加油罩棚的青色檐口溢光压低：设计稿里站坪整体偏暖，青色只在檐口一圈
EDGE_COLOR = {"canopy_fuel_led": (0.1, 0.3, 0.45), "canopy_lng_led": (0.7, 0.45, 1.0), "carport_led": (0.25, 1.0, 0.5)}


def _light(col, name, kind, loc, energy, color, **kw):
    li = bpy.data.lights.new(name, kind)
    li.energy = energy
    li.color = color
    for k, v in kw.items():
        setattr(li, k, v)
    ob = bpy.data.objects.new(name, li)
    ob.location = loc
    col.objects.link(ob)
    return ob


def build():
    """重建 BAKE_LIGHTS 集合，返回光源数量"""
    old = bpy.data.collections.get("BAKE_LIGHTS")
    if old:
        for ob in list(old.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.collections.remove(old)
    col = lib.collection("BAKE_LIGHTS")
    n = 0

    # 罩棚 / 车棚：棚底整片自发光灯面在 Cycles 里本身就是面光源，这里只给车棚补一点（它的灯条很窄）
    for name, k in (("carport_light", 2.2),):
        ob = bpy.data.objects.get(name)
        if not ob:
            continue
        pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        sx = max(p.x for p in pts) - min(p.x for p in pts)
        sy = max(p.y for p in pts) - min(p.y for p in pts)
        c = sum(pts, Vector()) / 8
        _light(col, f"BL_{name}", "AREA", (c.x, c.y, min(p.z for p in pts) - 0.05), CANOPY_W_PER_M2 * k * sx * sy, CANOPY,
               shape="RECTANGLE", size=sx, size_y=sy)
        n += 1
    # 檐口彩色灯带溢光：沿灯带包围盒的四条边各放一条细长面光（朝下），给周边地面染上灯带的颜色
    for name, color in EDGE_COLOR.items():
        ob = bpy.data.objects.get(name)
        if not ob:
            continue
        pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        x0, x1 = min(p.x for p in pts), max(p.x for p in pts)
        y0, y1 = min(p.y for p in pts), max(p.y for p in pts)
        z = min(p.z for p in pts) - 0.1
        for (cx, cy, sx, sy) in (((x0 + x1) / 2, y0, x1 - x0, 0.3), ((x0 + x1) / 2, y1, x1 - x0, 0.3), (x0, (y0 + y1) / 2, 0.3, y1 - y0), (x1, (y0 + y1) / 2, 0.3, y1 - y0)):
            _light(col, f"BL_edge_{n:03d}", "AREA", (cx, cy, z), EDGE_W_PER_M * max(sx, sy), color, shape="RECTANGLE", size=sx, size_y=sy)
            n += 1

    sw = bpy.data.objects.get("swap_station_body")
    if sw:
        _light(col, "BL_swap", "AREA", (sw.location.x, sw.location.y, 3.8), 1500.0, (0.75, 0.95, 1.0), shape="RECTANGLE", size=13, size_y=4.0)
        n += 1
    off = bpy.data.objects.get("office_body")
    if off:
        # 便利店橱窗在南立面（-y，朝停车场），门前地面被照亮；办公楼进深 10 m
        _light(col, "BL_store", "AREA", (off.location.x, off.location.y - 6.5, 2.0), 900.0, COOL, shape="RECTANGLE", size=14, size_y=2)
        col.objects["BL_store"].rotation_euler = (math.radians(-60), 0, 0)
        n += 1

    # 路灯：灯头朝下的聚光
    for heads in layout.LAMPS:
        for h in heads:
            _light(col, f"BL_lamp_{n:03d}", "SPOT", h, LAMP_W, WARM, spot_size=math.radians(130), spot_blend=0.5, shadow_soft_size=0.25)
            n += 1
    # 树下投光
    for x, y in layout.UPLIGHTS:
        _light(col, f"BL_up_{n:03d}", "POINT", (x, y, 2.5), UPLIGHT_W, WARM, shadow_soft_size=1.0)
        n += 1
    return n

"""
智慧充电站建模 · 剖切服务楼
----------------------------------------------------------
两层服务楼，去掉屋顶做剖切展示（与设计稿 v4 一致）：
- 一层：司机之家（咖啡吧台、沙发区、售货机、卫生间），南、西两面玻璃幕墙，南侧入口雨篷
- 二层：监控中心（北墙大屏、两排值班台）+ 东侧会议休息区，南、西两面通高玻璃，墙顶青色描边

局部坐标：楼体中心在原点，宽 W（x）× 深 D（y），z 向上。返回一个网格（多材质）和一个发光件网格。
"""

import bmesh

from . import lib

W, D = 18.0, 16.0
H1, SLAB, H2 = 4.2, 0.3, 3.6  # 一层层高、楼板厚、二层墙高


def _glass_wall(bm, x0, y0, x1, y1, z0, h, step=1.5, gmat=3, fmat=1):
    """玻璃幕墙：一整块透明玻璃 + 竖向竖梃 + 顶底横梁"""
    import math

    L = math.hypot(x1 - x0, y1 - y0)
    along_x = abs(y1 - y0) < 1e-6
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    if along_x:
        lib.add_box(bm, (L, 0.05, h), (cx, cy, z0 + h / 2), mat=gmat)
        lib.add_box(bm, (L, 0.14, 0.12), (cx, cy, z0 + 0.06), mat=fmat)
        lib.add_box(bm, (L, 0.14, 0.12), (cx, cy, z0 + h - 0.06), mat=fmat)
        n = int(L // step)
        for i in range(n + 1):
            lib.add_box(bm, (0.08, 0.12, h), (min(x0, x1) + i * L / n, cy, z0 + h / 2), mat=fmat)
    else:
        lib.add_box(bm, (0.05, L, h), (cx, cy, z0 + h / 2), mat=gmat)
        lib.add_box(bm, (0.14, L, 0.12), (cx, cy, z0 + 0.06), mat=fmat)
        lib.add_box(bm, (0.14, L, 0.12), (cx, cy, z0 + h - 0.06), mat=fmat)
        n = int(L // step)
        for i in range(n + 1):
            lib.add_box(bm, (0.12, 0.08, h), (cx, min(y0, y1) + i * L / n, z0 + h / 2), mat=fmat)


def _desk(bm, x, y, z, w=1.6, face=-1):
    """值班台 + 椅子 + 三联显示器，z 为所在楼层地面高度（face：人面朝 +y 为 1，-y 为 -1）"""
    lib.add_box(bm, (w, 0.75, 0.06), (x, y, z + 0.75), mat=6)
    lib.add_box(bm, (w, 0.05, 0.72), (x, y - face * 0.35, z + 0.37), mat=7)
    lib.add_box(bm, (0.5, 0.5, 0.08), (x, y + face * 0.75, z + 0.48), mat=7)  # 椅面
    lib.add_box(bm, (0.5, 0.06, 0.55), (x, y + face * 0.98, z + 0.78), mat=7)  # 椅背
    lib.add_cyl(bm, 0.04, 0.42, (x, y + face * 0.75, z + 0.24), seg=6, mat=7)
    for dx in (-w / 3, 0, w / 3):
        lib.add_box(bm, (0.48, 0.03, 0.3), (x + dx, y - face * 0.2, z + 1.02), mat=9)  # 屏幕（发光）
        lib.add_box(bm, (0.04, 0.04, 0.16), (x + dx, y - face * 0.22, z + 0.85), mat=7)


def _sofa(bm, x, y, z, w=2.2, face=1):
    """沙发：坐垫 + 靠背 + 扶手，z 为楼层地面高度，人面朝 face 方向（±y）"""
    lib.add_box(bm, (w, 0.85, 0.42), (x, y, z + 0.21), bevel=0.06, mat=8)
    lib.add_box(bm, (w, 0.22, 0.75), (x, y - face * 0.42, z + 0.45), bevel=0.06, mat=8)
    for s in (-1, 1):
        lib.add_box(bm, (0.2, 0.85, 0.58), (x + s * (w / 2 - 0.1), y, z + 0.29), bevel=0.05, mat=8)


def _plant(bm, x, y, z=0.0, s=1.0):
    lib.add_cyl(bm, 0.22 * s, 0.45 * s, (x, y, z + 0.225 * s), seg=10, mat=7)
    lib.add_ico(bm, 0.4 * s, (x, y, z + 0.75 * s), sub=1, mat=10, scale=(1, 1, 1.3))


def build(M):
    """返回 {"shell", "led"}：楼体（含家具，多材质）与墙顶 / 雨篷发光描边"""
    mats = [
        M["floor"],  # 0 楼板
        M["steel_dark"],  # 1 幕墙框 / 柱
        M["wall"],  # 2 实墙
        M["glass_bld"],  # 3 玻璃
        M["video"],  # 4 大屏
        M["vending"],  # 5 售货机
        M["wood"],  # 6 桌面 / 吧台
        M["graphite"],  # 7 家具深色
        M["fabric"],  # 8 沙发
        M["monitor"],  # 9 显示器
        M["leaf2"],  # 10 绿植
        M["fabric_light"],  # 11 浅色软装
        M["light_cool"],  # 12 吸顶灯
    ]
    bm = bmesh.new()
    hw, hd = W / 2, D / 2

    # ---------------- 一层
    lib.add_box(bm, (W + 0.6, D + 0.6, 0.25), (0, 0, 0.125), mat=0)  # 基座
    lib.add_box(bm, (W, 0.3, H1), (0, hd - 0.15, 0.25 + H1 / 2), mat=2)  # 北墙
    lib.add_box(bm, (0.3, D, H1), (hw - 0.15, 0, 0.25 + H1 / 2), mat=2)  # 东墙
    _glass_wall(bm, -hw, -hd, hw - 0.3, -hd, 0.25, H1)  # 南幕墙
    _glass_wall(bm, -hw, -hd, -hw, hd - 0.3, 0.25, H1)  # 西幕墙
    for x, y in ((-hw, -hd), (-hw, hd - 0.3), (hw - 0.3, -hd)):
        lib.add_box(bm, (0.4, 0.4, H1), (x + 0.15, y + 0.15, 0.25 + H1 / 2), mat=1)
    # 入口雨篷（南侧居中）
    lib.add_box(bm, (8, 2.6, 0.22), (-1, -hd - 1.3, 3.4), mat=1)
    # 卫生间隔间（东北角）
    lib.add_box(bm, (4, 4, 3.0), (hw - 2.3, hd - 2.3, 0.25 + 1.5), mat=2)
    # 咖啡吧台 + 背柜
    lib.add_box(bm, (6, 0.8, 1.1), (-3, hd - 2.4, 0.25 + 0.55), bevel=0.04, mat=6)
    lib.add_box(bm, (6, 0.5, 2.2), (-3, hd - 0.6, 0.25 + 1.1), mat=7)
    for i in range(4):
        lib.add_box(bm, (1.2, 0.02, 0.6), (-5.2 + i * 1.5, hd - 0.86, 1.9), mat=5)  # 背柜灯箱菜单
    # 沙发区（西南）
    for (x, y) in ((-6.0, -4.6), (-6.0, -1.2), (-2.4, -4.6)):
        _sofa(bm, x, y, 0.25, 2.2, face=1)
        lib.add_box(bm, (1.2, 0.7, 0.42), (x, y + 1.1, 0.25 + 0.21), bevel=0.04, mat=6)
    # 售货机（东墙，面朝 -x）
    for i in range(3):
        lib.add_box(bm, (0.8, 1.0, 1.9), (hw - 0.75, -5 + i * 1.2, 0.25 + 0.95), mat=7)
        lib.add_box(bm, (0.02, 0.8, 1.5), (hw - 1.16, -5 + i * 1.2, 0.25 + 1.05), mat=5)
    for (x, y) in ((-8.2, -7.2), (2.5, -7.2), (-8.2, 6.8)):
        _plant(bm, x, y, 0.25)

    # ---------------- 二层楼板（四周外挑 0.3）
    z2 = 0.25 + H1
    lib.add_box(bm, (W + 0.6, D + 0.6, SLAB), (0, 0, z2 + SLAB / 2), mat=1)
    z2 += SLAB
    lib.add_box(bm, (W, D, 0.05), (0, 0, z2 + 0.025), mat=0)
    # 二层墙：北、东实墙；南、西通高玻璃
    lib.add_box(bm, (W, 0.3, H2), (0, hd - 0.15, z2 + H2 / 2), mat=2)
    lib.add_box(bm, (0.3, D, H2), (hw - 0.15, 0, z2 + H2 / 2), mat=2)
    _glass_wall(bm, -hw, -hd, hw - 0.3, -hd, z2, H2, step=2.0)
    _glass_wall(bm, -hw, -hd, -hw, hd - 0.3, z2, H2, step=2.0)
    # 监控中心：北墙大屏（7.6 × 2.2）+ 两排值班台
    lib.add_box(bm, (8.0, 0.2, 2.6), (-4.2, hd - 0.42, z2 + 2.0), mat=7)
    lib.add_plane(bm, (7.6, 2.2), (-4.2, hd - 0.53, z2 + 2.0), rot=lib.FACE_S, mat=4)
    for y in (2.4, -0.6):
        for x in (-6.6, -4.2, -1.8):
            _desk(bm, x, y, z2, 2.0, face=-1)
    # 服务器机柜（东墙内侧）
    for i in range(4):
        lib.add_box(bm, (0.7, 1.0, 2.1), (hw - 0.75, 4.5 - i * 1.1, z2 + 1.05), mat=7)
        lib.add_box(bm, (0.02, 0.8, 1.8), (hw - 1.11, 4.5 - i * 1.1, z2 + 1.05), mat=9)
    # 玻璃隔断 + 会议休息区（东南）
    _glass_wall(bm, 1.0, -hd, 1.0, 0.0, z2, H2, step=2.0)
    lib.add_box(bm, (3.2, 1.4, 0.06), (4.6, -4.0, z2 + 0.74), mat=6)
    for s in (-1, 1):
        for i in range(3):
            lib.add_box(bm, (0.45, 0.45, 0.45), (3.6 + i * 1.0, -4.0 + s * 1.05, z2 + 0.23), mat=11)
    _sofa(bm, 4.6, -7.0, z2, 3.0, face=1)  # 靠南玻璃、面朝室内
    for (x, y) in ((-8.3, -7.3), (7.6, -7.3), (2.0, 7.0)):
        _plant(bm, x, y, z2)
    # 吸顶灯（只在一层，二层无顶）
    for x in (-5, 0, 4):
        lib.add_box(bm, (2.4, 0.3, 0.04), (x, -2, z2 - SLAB - 0.04), mat=12)
    shell = lib.make_mesh("service_building", bm, mats, smooth_angle=35)

    # ---------------- 发光描边：二层墙顶、楼板边、雨篷边
    bm = bmesh.new()
    zt = z2 + H2
    for (sx, sy, cx, cy) in ((W, 0.08, 0, -hd), (W, 0.08, 0, hd), (0.08, D, -hw, 0), (0.08, D, hw, 0)):
        lib.add_box(bm, (sx + 0.08, sy, 0.08), (cx, cy, zt + 0.04))
    for (sx, sy, cx, cy) in ((W + 0.6, 0.06, 0, -hd - 0.33), (0.06, D + 0.6, -hw - 0.33, 0)):
        lib.add_box(bm, (sx, sy, 0.08), (cx, cy, z2 - SLAB / 2))
    lib.add_box(bm, (8, 0.06, 0.06), (-1, -hd - 2.63, 3.4))
    led = lib.make_mesh("service_building_led", bm, [M["led_cyan"]])
    return {"shell": shell, "led": led}

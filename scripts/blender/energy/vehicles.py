"""
综合能源补给站建模 · 车辆预制
----------------------------------------------------------
导出到 public/energy/vehicles.glb（集合 VEHICLES），three.js 按名字克隆后沿路径行驶：
    car_sedan / car_suv        小车（自建，复制自 charging）
    truck_tractor              平头牵引车（国内重卡多为平头）
    trailer_box / trailer_tank 厢式半挂 / LNG 低温槽罐半挂

这些是程序化的「备用」车型：Sketchfab 外部模型（见 vendor.py）齐全时改用外部模型（同名，另加一款牵引车
truck_tractor_b），three.js 侧不用改。车头一律朝 +x，原点在地面上；车轴位置写在对象自定义属性 rig_* 里。
牵引车与挂车的连接尺寸（与 src/views/energy/scene/vehicles.js 的 RIG 一致）：
    牵引车长 6.2，前轴 x=+2.0，鞍座 x=-1.5；挂车长 13.6，牵引销 x=+5.8，后轴组中心 x=-5.3
"""

import math

import bmesh
from mathutils import Matrix

from . import lib

TRACTOR_L, TRAILER_L = 6.2, 13.6


def _wheel(bm, x, y, r, w, M_idx_tyre=2, M_idx_rim=3):
    lib.add_cyl(bm, r, w, (x, y, r), seg=20, mat=M_idx_tyre, axis="Y")
    s = 1 if y > 0 else -1
    lib.add_cyl(bm, r * 0.62, 0.02, (x, y + s * (w / 2 + 0.005), r), seg=16, mat=M_idx_rim, axis="Y")


def tractor(M):
    """平头牵引车：长 6.2、宽 2.5、高 3.9；驾驶室在前（x 0.9~3.1），后部鞍座，双后桥"""
    bm = bmesh.new()
    # 材质槽：0 车漆 1 玻璃 2 轮胎 3 轮毂 4 深色件 5 前灯 6 尾灯 7 镀铬
    lib.add_box(bm, (6.0, 0.95, 0.32), (0, 0, 0.95), mat=4)  # 大梁
    lib.add_box(bm, (2.2, 2.5, 2.5), (2.0, 0, 1.15 + 1.25), bevel=0.12, segments=3, mat=0)  # 驾驶室
    lib.add_box(bm, (1.6, 2.3, 0.55), (1.7, 0, 3.92), bevel=0.15, segments=3, mat=0)  # 导流罩
    lib.add_plane(bm, (1.05, 2.2), (3.112, 0, 2.95), rot=lib.FACE_E, mat=1)  # 前挡风
    for s in (-1, 1):
        lib.add_plane(bm, (0.9, 0.85), (2.55, s * 1.252, 2.95), rot=lib.FACE_N if s > 0 else lib.FACE_S, mat=1)  # 侧窗
        lib.add_box(bm, (0.08, 0.06, 0.55), (3.25, s * 1.35, 2.85), mat=4)  # 后视镜
        lib.add_box(bm, (1.6, 0.5, 0.55), (0.4, s * 0.95, 0.95), bevel=0.06, mat=7)  # 油箱 / 电池箱
        lib.add_box(bm, (0.12, 0.5, 0.18), (3.12, s * 0.95, 1.45), mat=5)  # 大灯
        lib.add_box(bm, (0.06, 0.25, 0.12), (-3.0, s * 1.0, 1.0), mat=6)  # 尾灯
    lib.add_box(bm, (0.25, 2.5, 0.45), (3.0, 0, 1.0), bevel=0.05, mat=4)  # 保险杠
    lib.add_box(bm, (0.04, 1.6, 0.6), (3.115, 0, 1.75), mat=4)  # 格栅
    lib.add_cyl(bm, 0.75, 0.12, (-1.5, 0, 1.18), seg=20, mat=4)  # 鞍座
    for x, w in ((2.0, 0.32), (-1.0, 0.6), (-2.35, 0.6)):
        for s in (-1, 1):
            _wheel(bm, x, s * (1.25 - w / 2), 0.52, w)
    mats = [M["truck_paint"], M["glass"], M["tyre"], M["rim"], M["dark"], M["headlight"], M["taillight"], M["chrome"]]
    return lib.make_mesh("truck_tractor", bm, mats, smooth_angle=35)


def _trailer_chassis(bm):
    lib.add_box(bm, (13.0, 1.0, 0.3), (0, 0, 1.1), mat=4)
    for x in (-4.0, -5.3, -6.6):
        for s in (-1, 1):
            _wheel(bm, x, s * 0.95, 0.5, 0.6)
    for s in (-1, 1):
        lib.add_box(bm, (0.12, 0.12, 0.9), (3.6, s * 0.8, 0.5), mat=4)  # 支腿
        lib.add_box(bm, (0.06, 0.3, 0.12), (-6.78, s * 1.05, 1.05), mat=6)  # 尾灯
    lib.add_box(bm, (6.0, 0.04, 0.5), (-0.5, 1.26, 0.95), mat=4)  # 侧防护
    lib.add_box(bm, (6.0, 0.04, 0.5), (-0.5, -1.26, 0.95), mat=4)


def trailer_box(M):
    """厢式半挂：13.6 × 2.55 × 4.0（厢体 1.3~4.1 m），三轴；车厢侧面一道车漆色腰线"""
    bm = bmesh.new()
    _trailer_chassis(bm)
    lib.add_box(bm, (13.6, 2.55, 2.85), (0, 0, 1.3 + 1.425), bevel=0.04, mat=8)  # 厢体
    for s in (-1, 1):
        lib.add_box(bm, (12.8, 0.02, 0.35), (0, s * 1.285, 2.1), mat=0)  # 腰线
    lib.add_box(bm, (0.04, 2.4, 2.6), (-6.82, 0, 2.7), mat=4)  # 后门
    mats = [M["truck_paint"], M["glass"], M["tyre"], M["rim"], M["dark"], M["headlight"], M["taillight"], M["chrome"], M["white"]]
    return lib.make_mesh("trailer_box", bm, mats, smooth_angle=35)


def trailer_tank(M):
    """LNG 低温槽罐半挂：不锈钢卧罐（直径 2.4、长 11.6）+ 后部操作箱 + 罐顶走道，三轴"""
    bm = bmesh.new()
    _trailer_chassis(bm)
    lib.add_cyl(bm, 1.2, 10.6, (0.2, 0, 2.55), seg=32, mat=7, axis="X")
    for s, x in ((1, 5.5), (-1, -5.1)):
        lib.add_ico(bm, 1.2, (x, 0, 2.55), sub=3, mat=7, scale=(0.4, 1, 1))
    lib.add_box(bm, (1.0, 2.3, 1.4), (-6.3, 0, 1.9), bevel=0.04, mat=4)  # 操作箱
    lib.add_box(bm, (9.0, 0.6, 0.06), (0.2, 0, 3.8), mat=4)  # 走道
    for x in (-3.0, 3.0):
        lib.add_box(bm, (0.5, 2.6, 0.18), (x, 0, 1.45), mat=4)  # 罐体托架
    mats = [M["truck_paint"], M["glass"], M["tyre"], M["rim"], M["dark"], M["headlight"], M["taillight"], M["stainless"]]
    return lib.make_mesh("trailer_tank", bm, mats, smooth_angle=35)


def car(M, kind):
    """
    小车（复制自 charging/assets.py 的自建车型）：车头朝 +x，底面中心在原点。kind = sedan（轿车）/ suv。
    车漆统一用 M_car_paint，three.js 按车辆克隆换色。
    由下车身轮廓、收窄的玻璃车舱、黑色下包围、轮拱阴影、五辐轮毂、后视镜、贯穿式灯带组成，
    远看能分辨出车窗、轮毂与灯，比单块挤出更像车。
    """
    if kind == "suv":
        L, W = 4.78, 1.95
        body = [(-2.36, 0.40), (-2.40, 0.98), (-2.30, 1.14), (-1.90, 1.18), (1.30, 1.18), (2.02, 1.02), (2.36, 0.86), (2.40, 0.52), (2.32, 0.40)]
        glass = [(-2.22, 1.16), (-2.02, 1.66), (0.70, 1.70), (1.42, 1.17)]
        wr, wx = 0.40, 1.48
    else:
        L, W = 4.86, 1.9
        body = [(-2.40, 0.34), (-2.44, 0.74), (-2.32, 0.92), (-1.82, 0.99), (1.28, 0.99), (2.08, 0.86), (2.40, 0.70), (2.44, 0.46), (2.36, 0.34)]
        glass = [(-2.0, 0.97), (-1.18, 1.43), (0.36, 1.46), (1.34, 0.97)]
        wr, wx = 0.36, 1.46
    wy = W / 2 - 0.13
    bm = bmesh.new()
    lib.add_profile(bm, body, W, mat=0, bevel=0.14)  # 车身
    gfaces = lib.add_profile(bm, glass, W - 0.2, mat=1, bevel=0.1)  # 玻璃车舱（含全景天幕）
    # 车舱向上收窄（真实车辆的侧窗内倾），俯视时能看出前挡、天幕、后窗的轮廓
    z0, z1 = glass[0][1], max(z for _, z in glass)
    for v in {v for f in gfaces for v in f.verts}:
        k = max(0.0, (v.co.z - z0) / (z1 - z0))
        v.co.y *= 1 - 0.2 * k
    # 车舱下沿的亮条（窗框）
    lib.add_box(bm, (abs(glass[-1][0] - glass[0][0]) - 0.1, W - 0.16, 0.035), ((glass[0][0] + glass[-1][0]) / 2, 0, glass[0][1] + 0.01), mat=7)
    # 黑色下包围与侧裙
    lib.add_box(bm, (L - 0.5, W + 0.01, 0.12), (0, 0, body[0][1] + 0.06), mat=2)
    # 门缝（侧面两道竖线）
    for x in (-0.55, 0.55):
        lib.add_box(bm, (0.012, W + 0.012, 0.42), (x, 0, body[0][1] + 0.38), mat=2)
    # 轮拱阴影 + 轮胎 + 五辐轮毂
    for x in (-wx, wx):
        for s in (-1, 1):
            lib.add_cyl(bm, wr + 0.07, 0.04, (x, s * (W / 2 - 0.005), wr), seg=24, mat=2, axis="Y")
            lib.add_cyl(bm, wr, 0.24, (x, s * wy, wr), seg=24, mat=2, axis="Y")
            lib.add_cyl(bm, wr * 0.66, 0.02, (x, s * (wy + 0.12), wr), seg=20, mat=3, axis="Y")
            for k in range(5):
                a = k * 2 * math.pi / 5
                spoke = lib.add_box(bm, (0.06, 0.02, wr * 0.62), (x, s * (wy + 0.135), wr), mat=3)
                bmesh.ops.rotate(bm, cent=(x, s * (wy + 0.135), wr), matrix=Matrix.Rotation(a, 3, "Y"), verts=list({v for f in spoke for v in f.verts}))
    # 后视镜
    for s in (-1, 1):
        lib.add_box(bm, (0.12, 0.2, 0.1), (glass[-1][0] - 0.12, s * (W / 2 + 0.06), glass[0][1] + 0.08), bevel=0.03, mat=0)
    hz = body[-3][1] - 0.02
    lib.add_box(bm, (0.05, W * 0.84, 0.05), (L / 2 - 0.04, 0, hz), mat=4)  # 贯穿式日行灯
    lib.add_box(bm, (0.05, W * 0.9, 0.06), (-L / 2 + 0.03, 0, body[1][1] + 0.04), mat=5)  # 贯穿式尾灯
    mats = [M["car_paint"], M["glass"], M["tyre"], M["rim"], M["headlight"], M["taillight"], M["dark"], M["chrome"]]
    return lib.make_mesh(f"car_{kind}", bm, mats, smooth_angle=40)



# 自建车型的车轴（与上面的造型一致），外部模型的车轴由 vendor.py 实测
_RIG = {
    "truck_tractor": {"rig_front": 2.0, "rig_rear": -1.7, "rig_fifth": -1.5},
    "trailer_box": {"rig_kingpin": 5.8, "rig_rear": -5.3},
    "trailer_tank": {"rig_kingpin": 5.8, "rig_rear": -5.3},
}


def build(M):
    """
    VEHICLES 集合：每种车型一份，排成一排便于在 Blender 里查看（three.js 只按名字取）。
    外部模型齐全时用外部模型（多一款牵引车 truck_tractor_b），否则用上面的自建车型。
    车轴位置写成对象自定义属性 rig_*，导出为 glTF extras
    """
    from . import vendor

    col = lib.collection("VEHICLES")
    items = []
    if vendor.available():
        for key in ("car_sedan", "car_suv", "truck_tractor", "truck_tractor_b", "trailer_box", "trailer_tank"):
            items.append(vendor.load(key, M))
    else:
        items = [(car(M, "sedan"), {}), (car(M, "suv"), {}), (tractor(M), _RIG["truck_tractor"])]
        items += [(trailer_box(M), _RIG["trailer_box"]), (trailer_tank(M), _RIG["trailer_tank"])]
    y = 0.0
    info = {}
    for me, rig in items:
        ob = lib.place(me, me.name, col, (0, 60 + y, 0))
        for k, v in rig.items():
            if k.startswith("rig_"):
                ob[k] = v
        info[me.name] = {**rig, "faces": len(me.polygons)}
        y += 6.0
    col.hide_render = True
    return info

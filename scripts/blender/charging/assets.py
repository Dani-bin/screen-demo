"""
智慧充电站建模 · 设备预制件
----------------------------------------------------------
每个函数生成一份（或几份）网格数据，场景里用 place() 共享引用摆放，导出 glTF 时只存一份几何。
预制件的局部坐标：底面中心在原点，z 向上；朝向在各函数注释里说明。

会被代码驱动的部件拆成独立网格（*_status 状态灯、*_screen 屏幕、*_arm 闸杆），
three.js 按对象名找到后改发光色 / 做动画。
"""

import math
import random

import bmesh
from mathutils import Matrix, Vector

from . import lib


# ---------------------------------------------------------------- 充电设备


def fast_pile(M):
    """
    直流快充桩（双枪，160 kW）：立在桩岛上，两面（±y）各一块大屏、各一把枪，服务南北两个车位。
    造型：白色圆角机身 + 深色顶盖 + 正面深色玻璃面板（屏幕嵌在其中）+ 侧面枪座与盘线 + 灰色基座。
    返回 {"body", "screen", "status"} 三份网格。
    """
    bm = bmesh.new()
    lib.add_box(bm, (1.0, 0.7, 0.14), (0, 0, 0.07), bevel=0.03, mat=1)  # 基座
    lib.add_box(bm, (0.66, 0.44, 1.78), (0, 0, 0.14 + 0.89), bevel=0.09, segments=4, mat=0)  # 机身
    lib.add_box(bm, (0.74, 0.52, 0.1), (0, 0, 1.97), bevel=0.04, segments=3, mat=1)  # 顶盖
    lib.add_box(bm, (0.68, 0.46, 0.04), (0, 0, 0.36), mat=1)  # 腰线
    for s in (-1, 1):
        # 正面深色玻璃面板（屏幕与状态灯嵌在里面）
        lib.add_box(bm, (0.5, 0.02, 1.08), (0, s * 0.222, 1.3), bevel=0.01, mat=4)
        # 侧面枪座 + 枪柄
        lib.add_box(bm, (0.1, 0.22, 0.42), (s * 0.37, s * 0.06, 1.05), bevel=0.03, mat=1)
        lib.add_box(bm, (0.08, 0.12, 0.24), (s * 0.43, s * 0.08, 1.1), bevel=0.025, mat=2)
        # 盘在枪座下方的粗线缆
        pts = [(s * 0.43, s * 0.1, 0.98), (s * 0.55, s * 0.16, 0.7), (s * 0.58, s * 0.14, 0.42), (s * 0.5, s * 0.04, 0.3), (s * 0.42, -s * 0.02, 0.5), (s * 0.4, s * 0.02, 0.85)]
        lib.add_tube(bm, pts, 0.032, mat=3)
        # 急停按钮
        lib.add_cyl(bm, 0.035, 0.02, (0.17, s * 0.234, 1.75), seg=12, mat=5, axis="Y")
    body = lib.make_mesh("pile_fast_body", bm, [M["white"], M["graphite"], M["dark"], M["cable"], M["glass_dark"], M["alarm"]], smooth_angle=35)

    bm = bmesh.new()
    for rot, s in ((lib.FACE_S, -1), (lib.FACE_N, 1)):
        lib.add_plane(bm, (0.4, 0.56), (0, s * 0.234, 1.48), rot=rot)
    screen = lib.make_mesh("pile_fast_screen", bm, [M["screen"]])

    bm = bmesh.new()
    for s in (-1, 1):
        lib.add_box(bm, (0.36, 0.012, 0.035), (0, s * 0.234, 1.08))  # 屏下横向状态灯条
        for x in (-0.335, 0.335):
            lib.add_box(bm, (0.018, 0.03, 1.5), (x, s * 0.18, 1.0))  # 机身两侧竖向灯线
    lib.add_box(bm, (0.6, 0.4, 0.025), (0, 0, 1.915))  # 顶盖下沿光带
    status = lib.make_mesh("pile_fast_status", bm, [M["status_charging"]])
    return {"body": body, "screen": screen, "status": status}


def vendor_pile_overlays(M):
    """
    外部快充桩模型（np-dev，见 vendor.py）的代码控制部件：机身宽约 0.99 m、深 0.70 m、高 1.95 m，
    正面朝 -y。在正面两侧边加竖向状态灯、顶部加横向灯带、正面上部贴一块屏幕，
    命名与自建桩一致（*_status / *_screen），three.js 无需改动。
    """
    bm = bmesh.new()
    for x in (-0.49, 0.49):
        lib.add_box(bm, (0.03, 0.03, 1.45), (x, -0.36, 1.02))
    lib.add_box(bm, (0.86, 0.03, 0.035), (0, -0.36, 1.86))
    status = lib.make_mesh("pile_fast_status", bm, [M["status_charging"]])
    bm = bmesh.new()
    lib.add_plane(bm, (0.34, 0.46), (0, -0.372, 1.42), rot=lib.FACE_S)
    screen = lib.make_mesh("pile_fast_screen", bm, [M["screen"]])
    return {"screen": screen, "status": status}


def super_pile(M):
    """
    液冷超充终端（600 kW）：白色圆柱塔身 + 深色正面凹槽 + 顶部发光光环，屏幕朝 -y（南）。
    返回 {"body", "screen", "status"}。
    """
    bm = bmesh.new()
    lib.add_cyl(bm, 0.72, 0.14, (0, 0, 0.07), seg=32, mat=1)  # 底座
    lib.add_cyl(bm, 0.55, 3.1, (0, 0, 0.14 + 1.55), seg=32, mat=0)  # 塔身
    lib.add_cyl(bm, 0.6, 0.12, (0, 0, 3.3), seg=32, mat=1)  # 顶盖
    lib.add_box(bm, (0.56, 0.2, 2.2), (0, -0.47, 1.55), bevel=0.05, mat=1)  # 正面深色凹槽
    lib.add_box(bm, (0.16, 0.2, 0.34), (0.4, -0.5, 1.0), bevel=0.03, mat=2)  # 枪座
    pts = [(0.42, -0.58, 0.9), (0.62, -0.7, 0.45), (0.56, -0.78, 0.18), (0.36, -0.7, 0.35), (0.34, -0.6, 0.8)]
    lib.add_tube(bm, pts, 0.055, mat=3)  # 液冷粗线
    body = lib.make_mesh("pile_super_body", bm, [M["white"], M["graphite"], M["dark"], M["cable"]], smooth_angle=40)

    bm = bmesh.new()
    lib.add_plane(bm, (0.44, 0.62), (0, -0.576, 1.9), rot=lib.FACE_S)
    screen = lib.make_mesh("pile_super_screen", bm, [M["screen_super"]])

    bm = bmesh.new()
    lib.add_torus(bm, 0.66, 0.06, (0, 0, 3.6), seg=48, seg2=8)  # 悬浮光环
    lib.add_torus(bm, 0.565, 0.03, (0, 0, 3.0), seg=48, seg2=6)  # 塔身上部灯环
    lib.add_box(bm, (0.04, 0.04, 1.9), (-0.3, -0.58, 1.55))
    lib.add_box(bm, (0.04, 0.04, 1.9), (0.3, -0.58, 1.55))
    status = lib.make_mesh("pile_super_status", bm, [M["status_charging"]])
    return {"body": body, "screen": screen, "status": status}


def power_cabinet(M):
    """液冷超充功率柜：2.4 × 1.4 × 2.4，正面朝 -y，带散热格栅与运行灯带"""
    bm = bmesh.new()
    lib.add_box(bm, (2.4, 1.4, 2.3), (0, 0, 1.15 + 0.1), bevel=0.04, mat=0)
    lib.add_box(bm, (2.6, 1.6, 0.1), (0, 0, 0.05), mat=1)
    for i in range(9):
        lib.add_box(bm, (0.04, 0.02, 1.2), (-0.8 + i * 0.2, -0.71, 1.2), mat=1)
    lib.add_box(bm, (2.2, 0.02, 0.05), (0, -0.715, 2.15), mat=2)
    return lib.make_mesh("power_cabinet", bm, [M["white"], M["graphite"], M["led_cyan"]], smooth_angle=35)


# ---------------------------------------------------------------- 车辆


def car(M, kind, paint):
    """
    车辆：车头朝 +x，底面中心在原点。kind = sedan（轿车）/ suv。
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
    mats = [M["paint_" + paint], M["glass"], M["tyre"], M["rim"], M["headlight"], M["taillight"], M["dark"], M["chrome"]]
    return lib.make_mesh(f"car_{kind}_{paint}", bm, mats, smooth_angle=40)


# ---------------------------------------------------------------- 雨棚 / 光伏


def canopy(M, length, width, height, name, col_x, tilt_deg=4.0):
    """
    快充区 T 形光伏雨棚：沿 x 方向长 length，宽 width（y），中心在原点；
    立柱在 y=0 中线（桩岛上），col_x 为立柱的 x 坐标列表。
    整个屋面（悬挑梁、屋面板、光伏、檐口）绕主梁向南单坡倾斜 tilt_deg 度，北高南低，
    与设计稿一致：从西南方向俯视能看到大片完整的蓝色光伏阵列。
    返回 {"frame", "pv", "led", "light"}：钢结构、光伏阵列（带贴图 UV）、檐口灯带、棚底灯带。
    """
    pivot = (0, 0, height - 0.45)
    tilt = Matrix.Rotation(math.radians(tilt_deg), 3, "X")

    def _tilt(bm):
        """把整个 bmesh 绕主梁轴线倾斜（屋面部件统一调用）"""
        bmesh.ops.rotate(bm, cent=pivot, matrix=tilt, verts=bm.verts)

    # 立柱与墩（不倾斜）
    bm = bmesh.new()
    for x in col_x:
        lib.add_box(bm, (0.9, 0.9, 0.3), (x, 0, 0.15), mat=2)  # 混凝土墩
        lib.add_box(bm, (0.42, 0.42, height - 0.5), (x, 0, 0.3 + (height - 0.8) / 2), bevel=0.04, mat=0)
        for s in (-1, 1):
            br = lib.add_box(bm, (0.16, 2.6, 0.16), (x, s * 1.15, height - 1.25), mat=0)  # 斜撑
            bmesh.ops.rotate(bm, cent=(x, s * 1.15, height - 1.25), matrix=Matrix.Rotation(-s * 0.62, 3, "X"), verts=list({v for f in br for v in f.verts}))
    lib.add_box(bm, (length, 0.45, 0.5), (0, 0, height - 0.45), mat=0)  # 主梁

    # 屋面结构（倾斜）：悬挑梁、屋面板、檐口板（檐口加厚，侧面能读出屋面厚度）
    roof = bmesh.new()
    for x in col_x:
        lib.add_box(roof, (0.26, width - 0.6, 0.32), (x, 0, height - 0.42), mat=0)
    lib.add_box(roof, (length, width, 0.14), (0, 0, height - 0.17), mat=1)  # 屋面板
    for s in (-1, 1):
        lib.add_box(roof, (length + 0.16, 0.14, 0.42), (0, s * width / 2, height - 0.12), mat=1)  # 南北檐口
    for s in (-1, 1):
        lib.add_box(roof, (0.14, width + 0.16, 0.42), (s * (length / 2 + 0.01), 0, height - 0.12), mat=1)  # 东西封边
    _tilt(roof)
    lib._merge(bm, roof)
    frame = lib.make_mesh(name + "_frame", bm, [M["steel"], M["roof"], M["curb"]], smooth_angle=30)

    # 光伏板：1.13 × 2.27 m 竖排、2 cm 缝，铺满屋面
    bm = bmesh.new()
    pw, ph, gap = 1.13, 2.27, 0.02
    nx = int((length - 0.2) // (pw + gap))
    ny = int((width - 0.1) // (ph + gap))
    x0 = -(nx * (pw + gap)) / 2 + pw / 2
    y0 = -(ny * (ph + gap)) / 2 + ph / 2
    for i in range(nx):
        for j in range(ny):
            c = (x0 + i * (pw + gap), y0 + j * (ph + gap))
            lib.add_plane(bm, (pw, ph), (c[0], c[1], height + 0.08))
            lib.add_box(bm, (pw, ph, 0.05), (c[0], c[1], height + 0.05), mat=1)  # 铝边框 / 背板
    _tilt(bm)
    pv = lib.make_mesh(name + "_pv", bm, [M["pv"], M["steel_dark"]])
    _panel_shade(pv, name)

    # 檐口细灯带：只在南北檐口下沿，细而暗，勾出屋面轮廓但不抢光伏的颜色
    bm = bmesh.new()
    for s in (-1, 1):
        lib.add_box(bm, (length + 0.16, 0.04, 0.04), (0, s * (width / 2 + 0.08), height - 0.33))
    _tilt(bm)
    led = lib.make_mesh(name + "_led", bm, [M["led_canopy"]])

    # 棚底冷白灯带（随屋面倾斜）
    bm = bmesh.new()
    for y in (-width * 0.38, -width * 0.2, width * 0.2, width * 0.38):
        lib.add_box(bm, (length - 1.0, 0.16, 0.04), (0, y, height - 0.26))
    _tilt(bm)
    under = lib.make_mesh(name + "_light", bm, [M["light_cool"]])
    return {"frame": frame, "pv": pv, "led": led, "light": under}


def _panel_shade(me, seed):
    """
    每块光伏板一个随机明暗（顶点色 Col，0.6~1.0）：真实阵列里每块板的反光角度、批次色差都不同，
    设计稿上也是深浅不一的「拼块感」。顶点色在材质里与贴图相乘，导出为 glTF COLOR_0，
    three.js 的光伏反光着色器（scene/pvSheen.js）也用它调制反光强度。边框 / 背板保持 1.0
    """
    rng = random.Random(seed)
    attr = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    me.color_attributes.active_color = attr
    for poly in me.polygons:
        v = 1.0 if poly.material_index else 0.6 + 0.4 * rng.random()
        for li in poly.loop_indices:
            attr.data[li].color = (v, v, v, 1.0)


# ---------------------------------------------------------------- 能源区


def ess_cabinet(M):
    """
    液冷储能柜（250 kWh）：2.6 × 1.7 × 2.7，正面朝 -y。
    浅灰绿色哑光柜体（不发光），前后各 3 扇门板（门缝 + 下部百叶 + 把手），侧面散热百叶；
    发光只在细节上：四角竖向灯带、顶沿一圈灯带、门缝透光，外加正面一块小状态屏——与设计稿一致
    材质槽：0 状态屏 / 1 柜体 / 2 框架与深色细节 / 3 绿色灯带
    """
    W, D, H, z0 = 2.6, 1.7, 2.5, 0.18
    bm = bmesh.new()
    lib.add_box(bm, (W + 0.2, D + 0.2, z0), (0, 0, z0 / 2), mat=2)  # 基础
    lib.add_box(bm, (W, D, H), (0, 0, z0 + H / 2), bevel=0.03, mat=1)  # 柜体
    lib.add_box(bm, (W + 0.06, D + 0.06, 0.1), (0, 0, z0 + H + 0.05), mat=1)  # 顶盖
    lib.add_box(bm, (1.5, 1.0, 0.36), (0, 0.1, z0 + H + 0.28), bevel=0.04, mat=1)  # 液冷机组
    lib.add_box(bm, (0.9, 0.6, 0.04), (0, 0.1, z0 + H + 0.47), mat=2)  # 机组顶部风扇格栅

    # 前后门板：3 扇门，竖向门缝透出绿光；每扇门下部百叶、中部把手
    door_w = W / 3
    for sy in (-1, 1):
        y = sy * (D / 2 + 0.006)
        for k in (-1, 1):
            lib.add_box(bm, (0.022, 0.012, H - 0.16), (k * door_w / 2, y, z0 + H / 2), mat=3)  # 门缝灯
        for i in (-1, 0, 1):
            cx = i * door_w
            for j in range(6):
                lib.add_box(bm, (door_w - 0.24, 0.014, 0.03), (cx, y, z0 + 0.28 + j * 0.07), mat=2)  # 百叶
            lib.add_box(bm, (0.04, 0.03, 0.22), (cx + door_w / 2 - 0.16, y + sy * 0.01, z0 + 1.25), mat=2)  # 把手
    # 侧面散热百叶
    for sx in (-1, 1):
        x = sx * (W / 2 + 0.006)
        for j in range(10):
            lib.add_box(bm, (0.014, D - 0.4, 0.03), (x, 0, z0 + 0.9 + j * 0.09), mat=2)

    # 四角竖向灯带（略凸出柜体倒角）+ 顶沿一圈灯带
    for sx in (-1, 1):
        for sy in (-1, 1):
            lib.add_box(bm, (0.05, 0.05, H - 0.04), (sx * (W / 2 - 0.005), sy * (D / 2 - 0.005), z0 + H / 2), mat=3)
    for sy in (-1, 1):
        lib.add_box(bm, (W, 0.04, 0.04), (0, sy * (D / 2 + 0.02), z0 + H - 0.02), mat=3)
    for sx in (-1, 1):
        lib.add_box(bm, (0.04, D, 0.04), (sx * (W / 2 + 0.02), 0, z0 + H - 0.02), mat=3)

    # 正面右上角状态屏
    lib.add_plane(bm, (0.42, 0.56), (door_w, -(D / 2 + 0.014), z0 + 1.85), rot=lib.FACE_S, mat=0)
    return lib.make_mesh("ess_cabinet", bm, [M["ess_face"], M["ess_body"], M["ess_frame"], M["ess_led"]])


def transformer(M):
    """箱式变压器：3.6 × 2.4 × 2.6，散热片在东西两侧，正面朝 -y 贴高压警示牌"""
    bm = bmesh.new()
    lib.add_box(bm, (3.8, 2.6, 0.2), (0, 0, 0.1), mat=1)
    lib.add_box(bm, (3.6, 2.4, 2.4), (0, 0, 0.2 + 1.2), bevel=0.03, mat=0)
    lib.add_box(bm, (3.9, 2.7, 0.14), (0, 0, 2.67), mat=1)  # 顶盖
    for s in (-1, 1):
        for i in range(10):
            lib.add_box(bm, (0.32, 0.05, 1.7), (s * 1.95, -0.9 + i * 0.2, 1.2), mat=0)  # 散热片
    for i in range(12):
        lib.add_box(bm, (0.05, 0.02, 0.9), (-1.4 + i * 0.12, -1.21, 1.9), mat=1)  # 百叶
    lib.add_plane(bm, (0.5, 0.5), (1.1, -1.215, 1.7), rot=lib.FACE_S, mat=2)
    return lib.make_mesh("transformer", bm, [M["transformer"], M["steel_dark"], M["warn"]], smooth_angle=30)


def switchgear(M):
    """配电 / 逆变柜：1.0 × 0.8 × 2.2，正面朝 -y，带蓝色指示灯"""
    bm = bmesh.new()
    lib.add_box(bm, (1.0, 0.8, 2.2), (0, 0, 1.1), bevel=0.02, mat=0)
    lib.add_box(bm, (0.02, 0.02, 2.0), (0, -0.405, 1.1), mat=1)
    for i in range(3):
        lib.add_box(bm, (0.08, 0.02, 0.04), (-0.3 + i * 0.12, -0.41, 1.85), mat=2)
    return lib.make_mesh("switchgear", bm, [M["graphite"], M["dark"], M["led_blue"]], smooth_angle=30)


# ---------------------------------------------------------------- 场地配套


def street_light(M):
    """路灯：7 m 立杆 + 单臂灯头（灯头朝 +x）"""
    bm = bmesh.new()
    lib.add_cyl(bm, 0.18, 0.3, (0, 0, 0.15), seg=12, mat=0)
    lib.add_cyl(bm, 0.07, 7.0, (0, 0, 3.5), seg=10, mat=0, r2=0.05)
    lib.add_box(bm, (1.4, 0.1, 0.1), (0.65, 0, 6.95), mat=0)
    lib.add_box(bm, (0.7, 0.3, 0.12), (1.2, 0, 6.88), bevel=0.03, mat=0)
    lib.add_box(bm, (0.6, 0.22, 0.03), (1.2, 0, 6.81), mat=1)
    return lib.make_mesh("street_light", bm, [M["steel"], M["light_warm"]], smooth_angle=40)


def bollard(M):
    """隔离桩：深色立柱 + 两道青色发光环"""
    bm = bmesh.new()
    lib.add_cyl(bm, 0.11, 0.95, (0, 0, 0.475), seg=14, mat=0)
    lib.add_cyl(bm, 0.115, 0.06, (0, 0, 0.7), seg=14, mat=1)
    lib.add_cyl(bm, 0.115, 0.04, (0, 0, 0.88), seg=14, mat=1)
    return lib.make_mesh("bollard", bm, [M["graphite"], M["led_cyan"]], smooth_angle=40)


def tree(M, kind=0):
    """
    行道树：树干 + 主枝 + 7~9 团带扰动的树冠，两种绿色交错，三种形态（kind 0 圆冠、1 塔形、2 散冠）。
    树冠顶点随机外扰，打破几何球的「塑料感」。
    """
    import random

    rng = random.Random(100 + kind)
    bm = bmesh.new()
    h = (2.4, 2.8, 2.1)[kind % 3]
    lib.add_cyl(bm, 0.14, h, (0, 0, h / 2), seg=8, mat=0, r2=0.09)
    for k in range(3):
        a = k * 2.1 + rng.random()
        lib.add_tube(bm, [(0, 0, h * 0.7), (math.cos(a) * 0.6, math.sin(a) * 0.6, h + 0.3)], 0.05, seg=5, mat=0)
    # 树冠：在椭球体积内撒 16~22 个小叶团（半径 0.38~0.62），比几个大球更像真实树冠的层次
    if kind % 3 == 1:
        ry, rz, n = 1.0, 2.0, 18  # 塔形
    elif kind % 3 == 2:
        ry, rz, n = 1.7, 1.1, 22  # 散冠
    else:
        ry, rz, n = 1.35, 1.3, 20  # 圆冠
    cz = h + rz * 0.75
    blobs = []
    for i in range(n):
        while True:
            x, y, z = (rng.uniform(-1, 1) for _ in range(3))
            if x * x + y * y + z * z <= 1:
                break
        r = 0.38 + rng.random() * 0.24
        blobs.append(((x * ry, y * ry, cz + z * rz), r))
    for i, (c, r) in enumerate(blobs):
        faces = lib.add_ico(bm, r, c, sub=2, mat=1 + (i % 3 == 0), scale=(1, 1, 0.9))
        for v in {v for f in faces for v in f.verts}:
            v.co += (v.co - Vector(c)).normalized() * (rng.random() - 0.5) * r * 0.18
    return lib.make_mesh(f"tree_{kind}", bm, [M["trunk"], M["leaf"], M["leaf2"]], smooth_angle=60)


def bush(M):
    """矮灌木团：5 团带扰动的小球，深浅两色"""
    import random

    rng = random.Random(7)
    bm = bmesh.new()
    for i, (c, r) in enumerate((((0, 0, 0.42), 0.55), ((0.5, 0.15, 0.32), 0.42), ((-0.45, -0.1, 0.3), 0.4), ((0.15, -0.45, 0.28), 0.36), ((-0.2, 0.45, 0.3), 0.38))):
        faces = lib.add_ico(bm, r, c, sub=2, mat=i % 2, scale=(1, 1, 0.8))
        for v in {v for f in faces for v in f.verts}:
            v.co += (v.co - Vector(c)).normalized() * (rng.random() - 0.5) * r * 0.25
    return lib.make_mesh("bush", bm, [M["leaf2"], M["leaf"]], smooth_angle=60)


def gate(M):
    """
    道闸：岗亭 + 闸机柱 + 车牌识别杆；闸杆单独返回（绕柱顶转轴做抬杆动画）。
    闸杆沿 +x 伸出，转轴在原点（局部）。返回 {"base", "arm"}。
    """
    bm = bmesh.new()
    lib.add_box(bm, (0.42, 0.42, 1.1), (0, 0, 0.55), bevel=0.03, mat=0)  # 闸机
    lib.add_box(bm, (0.3, 0.02, 0.2), (0, -0.215, 0.85), mat=2)  # 状态灯
    lib.add_cyl(bm, 0.05, 2.6, (-0.6, 0, 1.3), seg=10, mat=1)  # 识别杆
    lib.add_box(bm, (0.28, 0.42, 0.2), (-0.6, -0.12, 2.6), bevel=0.03, mat=1)
    # 岗亭
    lib.add_box(bm, (1.5, 1.5, 0.12), (-1.8, 0.6, 0.06), mat=1)
    lib.add_box(bm, (1.4, 1.4, 2.4), (-1.8, 0.6, 1.32), mat=3)
    lib.add_box(bm, (1.6, 1.6, 0.12), (-1.8, 0.6, 2.58), mat=1)
    base = lib.make_mesh("gate_base", bm, [M["white"], M["steel_dark"], M["led_cyan"], M["glass_bld"]], smooth_angle=35)
    bm = bmesh.new()
    for i in range(6):
        lib.add_box(bm, (0.7, 0.1, 0.1), (0.35 + i * 0.7, 0, 0), mat=i % 2)
    arm = lib.make_mesh("gate_arm", bm, [M["alarm"], M["white"]])
    return {"base": base, "arm": arm}


def totem(M):
    """价格立柱：1.8 × 0.7 × 7.2，两面屏幕（±y），顶部青色灯带"""
    bm = bmesh.new()
    lib.add_box(bm, (2.2, 1.1, 0.3), (0, 0, 0.15), mat=1)
    lib.add_box(bm, (1.8, 0.7, 7.0), (0, 0, 0.3 + 3.5), bevel=0.06, mat=0)
    lib.add_box(bm, (1.9, 0.8, 0.12), (0, 0, 7.36), mat=2)
    lib.add_plane(bm, (1.4, 4.6), (0, -0.356, 4.2), rot=lib.FACE_S, mat=3)
    lib.add_plane(bm, (1.4, 4.6), (0, 0.356, 4.2), rot=lib.FACE_N, mat=3)
    return lib.make_mesh("totem", bm, [M["graphite"], M["steel_dark"], M["led_cyan"], M["totem_screen"]], smooth_angle=35)

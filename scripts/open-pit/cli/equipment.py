"""用 cli-anything-blender 建露天矿的全部设备（用户指定的工具）。每台设备一个工程 + 一份工具生成的 bpy 脚本，
Blender 构建（scripts/blender/open_pit/cli_models.py）截取脚本里的建模部分拼成网格进 GLB。

这个工具只有基本体、修改器和单色材质（没有贴图、节点材质、烘焙，也不能导出 GLB），所以只用来做设备造型；
岩石 / 煤层 / 地表还是走 scripts/blender/open_pit 的烘焙流程。尺寸按真实设备建，场景里整体放大（build.py 的 CLI_SCALE）。

用法：python3 scripts/open-pit/cli/equipment.py [名字 …] [--preview]   （不给名字 = 全部；--preview 要在 Claude 沙盒外跑）
"""
import math
import sys

from kit import Model


def shovel():
    """电铲（斗容约 50 m³ 的电铲）：履带 + 机房 + 驾驶室 + A 形架 + 桁架吊臂 + 拉索 / 钢丝绳 + 斗杆 + 铲斗"""
    m = Model("shovel").new()
    for side, sx in (("L", -4.6), ("R", 4.6)):
        m.part("cube", f"track_{side}", (sx, 0, 1.2), (1.5, 7.2, 1.2), m="dark", bevel=0.5)
        shoe = m.part("cube", f"shoe_{side}", (sx, -6.9, 2.45), (1.55, 0.25, 0.08))
        m.array(shoe, 12, (0, 2.4, 0))  # 履带板一节一节的齿
    m.part("cube", "carbody", (0, 0, 3.0), (3.4, 4.2, 0.8), bevel=0.3)
    m.part("cylinder", "swing_ring", (0, 0, 4.0), (4.2, 4.2, 0.25), m="dark")
    m.part("cube", "house", (0, -1.8, 7.2), (5.2, 6.2, 3.0), bevel=0.5)
    m.part("cube", "house_roof", (0, -1.8, 10.35), (5.0, 6.0, 0.15), m="white")
    m.part("cube", "counterweight", (0, -8.4, 6.2), (5.3, 1.2, 2.2), m="dark", bevel=0.3)
    m.part("cube", "cab", (3.4, 4.0, 11.6), (1.6, 1.7, 1.3), m="white", bevel=0.2)
    m.part("cube", "cab_glass", (3.4, 5.72, 11.9), (1.45, 0.05, 0.6), m="cyan")
    m.part("cube", "house_light_strip", (0, 4.42, 9.2), (5.0, 0.05, 0.12), m="cyan")
    for sx in (-2.6, 2.6):  # A 形架（龙门架）
        m.beam(f"gantry_front_{sx:+.0f}", (sx, -0.5, 10.3), (sx * 0.4, -3.2, 21.5), 0.7)
        m.beam(f"gantry_back_{sx:+.0f}", (sx, -7.0, 10.3), (sx * 0.4, -3.2, 21.5), 0.6)
    foot, tip = (0, 2.4, 8.4), (0, 21.0, 27.0)
    for sx in (-0.9, 0.9):  # 吊臂：两根主弦杆 + 发光边
        m.beam(f"boom_chord_{sx:+.1f}", (sx, foot[1], foot[2]), (sx, tip[1], tip[2]), 0.7)
        m.beam(f"boom_glow_{sx:+.1f}", (sx * 1.25, foot[1], foot[2] + 0.5), (sx * 1.25, tip[1], tip[2] + 0.5), 0.14, m="cyan")
    lacing = m.part("cube", "boom_lacing", (0, foot[1] + 1.3, foot[2] + 1.3), (0.95, 0.12, 0.12), (45, 0, 0))
    m.array(lacing, 12, (0, 10.6, 0))  # 腹杆：沿吊臂方向一格一格
    m.part("cylinder", "boom_sheave", tip, (1.8, 1.8, 0.5), (0, 90, 0))
    m.beam("pendant", (0, -3.2, 21.5), (0, tip[1] - 0.6, tip[2] + 0.4), 0.18, m="white")
    m.beam("hoist_rope", (0, tip[1] + 0.9, tip[2] - 1.4), (0, 19.8, 13.6), 0.16, m="white")
    m.beam("dipper_handle", (0, 8.5, 15.6), (0, 19.0, 11.2), 1.0)
    m.part("cube", "dipper", (0, 19.6, 11.6), (2.4, 2.0, 2.0), (-15, 0, 0), bevel=0.4)
    m.part("cube", "dipper_teeth", (0, 21.7, 10.1), (2.3, 0.25, 0.25), m="amber")
    for i, loc in enumerate(((-3.0, 4.5, 10.1), (3.0, 4.5, 10.1), (0, 12.0, 18.6))):
        m.part("sphere", f"work_light_{i}", loc, (0.45, 0.45, 0.45), m="amber")
    return m.finish((50, -40, 30), (0, 6, 12))


def truck():
    """无人驾驶矿卡（约 300 t 级，无驾驶室）：底盘 + 前动力舱 + 车斗（带护顶）+ 前单后双轮 + 车灯 / 尾灯 / 车斗青色边光。
    白色件是车斗，页面里用实例色表示状态（scene/GlbScene.js 按材质名 op_white 识别）"""
    m = Model("truck").new()
    m.part("cube", "chassis", (0, 0, 2.6), (2.2, 6.0, 0.6), m="dark")
    for sx in (-3.3, 3.3):  # 前轮
        m.part("cylinder", f"wheel_f_{sx:+.0f}", (sx, 4.2, 1.9), (1, 1, 1), (0, 90, 0), m="dark", params={"radius": 1.9, "depth": 1.4, "vertices": 20})
    for sx in (-3.9, -2.5, 2.5, 3.9):  # 后双轮
        m.part("cylinder", f"wheel_r_{sx:+.1f}", (sx, -3.4, 1.9), (1, 1, 1), (0, 90, 0), m="dark", params={"radius": 1.9, "depth": 1.2, "vertices": 20})
    m.part("cube", "power_module", (0, 5.0, 3.6), (3.2, 1.3, 1.4), bevel=0.2)
    m.part("cube", "bed", (0, -0.8, 5.0), (4.1, 4.6, 1.3), (-6, 0, 0), m="white", bevel=0.3)
    m.part("cube", "canopy", (0, 4.6, 6.5), (4.1, 1.5, 0.22), m="white")
    m.part("cube", "headlights", (0, 6.35, 3.9), (3.0, 0.08, 0.28), m="cyan")
    m.part("cube", "taillights", (0, -6.15, 3.2), (3.0, 0.08, 0.22), m="red")
    for sx in (-4.17, 4.17):
        m.part("cube", f"bed_edge_{sx:+.0f}", (sx, -0.8, 6.15), (0.07, 4.4, 0.08), m="cyan")
    return m.finish((24, -20, 14), (0, 0, 3))


def bucket_wheel():
    """斗轮挖掘机：三条履带 + 回转平台 + 机房 + 塔架 + 斗轮臂（桁架）+ 斗轮 + 配重臂 + 拉索"""
    m = Model("bucket_wheel").new()
    for i, (x, y) in enumerate(((-6, -3), (6, -3), (0, 7))):
        m.part("cube", f"crawler_{i}", (x, y, 1.6), (2.4, 5.5, 1.6), m="dark", bevel=0.5)
    m.part("cylinder", "turntable", (0, 0, 4.4), (1, 1, 1), m="steel", params={"radius": 7, "depth": 2.4})
    m.part("cube", "house", (0, -1, 9), (5, 6, 3.6), bevel=0.4)
    m.part("cube", "house_glass", (0, 5.05, 9.6), (4.6, 0.05, 0.8), m="cyan")
    m.beam("mast", (0, -1, 12.6), (0, -3, 34), 1.6)
    for sx in (-1.4, 1.4):  # 斗轮臂
        m.beam(f"boom_chord_{sx:+.1f}", (sx, 4, 11), (sx, 44, 17), 0.9)
        m.beam(f"boom_glow_{sx:+.1f}", (sx * 1.3, 4, 11.8), (sx * 1.3, 44, 17.8), 0.18, m="cyan")
    lac = m.part("cube", "boom_lacing", (0, 6, 11.3), (1.4, 0.15, 0.15), (8.5, 0, 0))
    m.array(lac, 14, (0, 9.4, 0))
    m.part("cylinder", "wheel", (0, 46, 17), (1, 1, 1), (0, 90, 0), params={"radius": 6.5, "depth": 2.2, "vertices": 32})
    m.part("torus", "wheel_buckets", (0, 46, 17), (1, 1, 1), (0, 90, 0), m="amber", params={"major_radius": 6.8, "minor_radius": 0.55, "major_segments": 32, "minor_segments": 8})
    m.beam("counter_boom", (0, -4, 12.6), (0, -30, 20), 1.6)
    m.part("cube", "counterweight", (0, -31, 18.5), (4, 3, 3), m="dark", bevel=0.3)
    m.beam("stay_front", (0, -3, 34), (0, 30, 15.5), 0.25, m="white")
    m.beam("stay_back", (0, -3, 34), (0, -29, 21.5), 0.25, m="white")
    m.beam("discharge", (0, -5, 7), (0, -30, 12), 1.2)
    for i, loc in enumerate(((-4, 5.2, 12.8), (4, 5.2, 12.8), (0, 40, 19))):
        m.part("sphere", f"light_{i}", loc, (0.5, 0.5, 0.5), m="amber")
    return m.finish((80, -30, 45), (0, 8, 14))


def crusher():
    """半移动破碎站：底座 + 支腿 + 破碎机房 + 受料斗 + 出料皮带（桁架，带青色灯带）"""
    m = Model("crusher").new()
    m.part("cube", "base", (0, 0, 1.4), (9, 11, 1.4), m="dark", bevel=0.4)
    for sx in (-7, 7):
        for sy in (-8, 8):
            m.part("cylinder", f"leg_{sx:+.0f}_{sy:+.0f}", (sx, sy, 6.4), (1, 1, 1), params={"radius": 0.8, "depth": 8})
    m.part("cube", "deck", (0, 0, 10.8), (8, 10, 0.4), m="steel")
    m.part("cube", "house", (0, -2, 16.5), (5.5, 5.5, 5.3), bevel=0.4)
    m.part("cube", "house_roof", (0, -2, 22), (5.7, 5.7, 0.2), m="white")
    m.part("cube", "house_glass", (5.55, -2, 18), (0.05, 4, 0.6), m="glass")
    m.part("cone", "hopper", (0, 7.5, 16.5), (1, 1, 1), params={"radius1": 2.5, "radius2": 7.5, "depth": 7})
    m.part("torus", "hopper_rim", (0, 7.5, 20.0), (1, 1, 1), m="cyan", params={"major_radius": 7.5, "minor_radius": 0.18})
    m.beam("conveyor", (0, -7, 12), (0, -42, 26), 3.0)
    m.beam("conveyor_glow", (0, -7, 13.8), (0, -42, 27.8), 0.4, m="cyan")
    m.beam("conveyor_leg", (0, -30, 0), (0, -30, 21), 1.0)
    for i, loc in enumerate(((-5, 3.7, 22.6), (5, 3.7, 22.6))):
        m.part("sphere", f"light_{i}", loc, (0.5, 0.5, 0.5), m="amber")
    return m.finish((60, -50, 40), (0, -8, 12))


def swap_station():
    """换电站：长条厂房 + 屋顶 + 三个亮着的换电工位（朝 −Y，面向道路）+ 电池仓 + 青色屋檐灯带"""
    m = Model("swap_station").new()
    m.part("cube", "hall", (0, 0, 5), (22, 9, 5), m="concrete", bevel=0.3)
    m.part("cube", "roof", (0, 0, 10.4), (23, 10, 0.4), m="white")
    m.part("cube", "eave_glow", (0, -10.1, 10.0), (23, 0.08, 0.25), m="cyan")
    for i, x in enumerate((-14, 0, 14)):
        m.part("cube", f"bay_{i}", (x, -9.05, 3.6), (4.5, 0.06, 3.4), m="glass")
        m.part("cube", f"bay_frame_{i}", (x, -9.15, 7.3), (4.9, 0.08, 0.3), m="cyan")
    m.part("cube", "battery_store", (0, 15, 3.5), (18, 5, 3.5), m="steel", bevel=0.3)
    store = m.part("cube", "battery_rack", (-14, 9.9, 3.5), (1.2, 0.05, 2.6), m="cyan")
    m.array(store, 8, (1.65, 0, 0))  # 相对偏移 × 架子宽 2.4 m = 每 4 m 一个，8 个正好落在电池仓正面
    return m.finish((60, -70, 40), (0, 2, 4))


def radar_tower():
    """边坡雷达塔：四脚格构塔（腿 + 横撑 + 斜撑）+ 雷达头 + 青色信标"""
    m = Model("radar_tower").new()
    H = 70.0
    base, top = 6.0, 1.2
    w = lambda z: base + (top - base) * z / H  # noqa: E731  高度 z 处的半宽
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.beam(f"leg_{sx:+d}{sy:+d}", (sx * base, sy * base, 0), (sx * top, sy * top, H), 0.8)
    levels = [0, 14, 28, 42, 56, 70]
    for i, z in enumerate(levels[1:], 1):
        a = w(z)
        corners = [(-a, -a), (a, -a), (a, a), (-a, a)]
        for j in range(4):
            p, q = corners[j], corners[(j + 1) % 4]
            m.beam(f"ring_{i}_{j}", (p[0], p[1], z), (q[0], q[1], z), 0.4)
        z0 = levels[i - 1]
        b = w(z0)
        lower = [(-b, -b), (b, -b), (b, b), (-b, b)]
        for j in range(4):  # 每面一根斜撑
            p, q = lower[j], corners[(j + 1) % 4]
            m.beam(f"brace_{i}_{j}", (p[0], p[1], z0), (q[0], q[1], z), 0.3)
    m.part("cube", "radar_head", (0, 0, H + 2), (2.5, 2.5, 2), m="white", bevel=0.3)
    m.part("cylinder", "radar_dish", (0, 2.8, H + 3), (1, 1, 1), (70, 0, 0), m="steel", params={"radius": 3, "depth": 0.5})
    m.part("sphere", "beacon", (0, 0, H + 5.5), (1.2, 1.2, 1.2), m="cyan")
    return m.finish((60, -80, 60), (0, 0, 35), focal=28)


def cooling_tower():
    """双曲线冷却塔：两段圆锥台拼出收腰的塔身 + 底部青色灯环 + 顶部白色塔沿"""
    m = Model("cooling_tower").new()
    m.part("cone", "shell_low", (0, 0, 40), (1, 1, 1), m="concrete", params={"radius1": 52, "radius2": 33, "depth": 80, "vertices": 48})
    m.part("cone", "shell_top", (0, 0, 96), (1, 1, 1), m="concrete", params={"radius1": 33, "radius2": 36, "depth": 32, "vertices": 48})
    m.part("torus", "base_glow", (0, 0, 2), (1, 1, 1), m="cyan", params={"major_radius": 52.5, "minor_radius": 1.0, "major_segments": 64})
    m.part("torus", "rim", (0, 0, 112), (1, 1, 1), m="white", params={"major_radius": 36, "minor_radius": 0.9, "major_segments": 64})
    return m.finish((220, -260, 140), (0, 0, 55), focal=35)


def chimney():
    """烟囱：8 段圆锥台红白相间 + 顶部航空障碍灯"""
    m = Model("chimney").new()
    n, H = 8, 150.0
    for i in range(n):
        h = H / n
        r0 = 7 - 3 * i / n
        r1 = 7 - 3 * (i + 1) / n
        m.part("cone", f"band_{i}", (0, 0, h * i + h / 2), (1, 1, 1), m="white" if i % 2 else "red", params={"radius1": r0, "radius2": r1, "depth": h, "vertices": 24})
    m.part("sphere", "beacon", (0, 0, H + 1), (1.2, 1.2, 1.2), m="red")
    return m.finish((120, -160, 90), (0, 0, 70), focal=35)


def barn():
    """封闭煤场：拱顶大棚（半埋的扁圆柱，长 360 m、跨度 130 m）+ 一圈圈青色拱肋（圆环阵列）+ 端墙亮窗"""
    m = Model("barn").new()
    L, R = 360.0, 65.0
    # 圆柱轴转到沿 Y：绕 X 转 90°，局部 Y 就成了世界 Z，所以局部 Y 缩 0.55 把拱压扁；圆心在地面，下半截埋在地下
    m.part("cylinder", "roof", (0, 0, 0), (1, 0.55, 1), (90, 0, 0), m="white", params={"radius": R, "depth": L, "vertices": 64})
    rib = m.part("torus", "ribs", (0, L / 2 - 10, 0), (1, 0.55, 1), (90, 0, 0), m="cyan", params={"major_radius": R + 0.4, "minor_radius": 0.6, "major_segments": 64, "minor_segments": 6})
    m.array(rib, 18, (0, 0, 16.7))  # 圆环局部 Z 转到了世界 −Y：沿局部 Z 阵列 = 沿长度方向每 20 m 一道
    for sy in (-1, 1):
        m.part("cube", f"end_glass_{sy:+d}", (0, sy * (L / 2 + 0.2), 8), (40, 0.1, 6), m="glass")
    return m.finish((420, -380, 220), (0, 0, 10), focal=35)


def plant_blocks():
    """电厂厂房群：汽机房、锅炉房、办公楼等几个方盒 + 每栋一条亮窗带 + 屋顶"""
    m = Model("plant_blocks").new()
    for i, (w, d, h, x, y) in enumerate([(70, 40, 24, 0, 0), (40, 30, 34, -60, 20), (50, 26, 18, 56, 10), (36, 26, 14, 10, -40), (30, 20, 20, -30, -46)]):
        m.part("cube", f"block_{i}", (x, y, h / 2), (w / 2, d / 2, h / 2), m="concrete", bevel=0.4)
        m.part("cube", f"roof_{i}", (x, y, h + 0.3), (w / 2 + 0.5, d / 2 + 0.5, 0.3), m="white")
        m.part("cube", f"glass_{i}", (x, y - d / 2 - 0.1, h * 0.6), (w * 0.46, 0.06, h * 0.12), m="glass")
    return m.finish((160, -200, 120), (0, 0, 10), focal=35)


def belt_segment():
    """输煤走廊的一节（40 m 长）：封闭廊道 + 顶部青色灯带 + 侧窗 + 两端支架；Blender 构建沿走廊折线一节一节铺"""
    m = Model("belt_segment").new()
    m.part("cube", "gallery", (0, 0, 14), (3.5, 20, 3), m="white", bevel=0.3)
    m.part("cube", "top_glow", (0, 0, 17.15), (0.4, 20, 0.12), m="cyan")
    for sx in (-3.55, 3.55):
        m.part("cube", f"window_{sx:+.0f}", (sx, 0, 14.4), (0.05, 18.5, 0.5), m="glass")
    for sy in (-18, 18):
        m.beam(f"leg_l_{sy:+d}", (-3, sy, 0), (-2, sy, 11), 0.8)
        m.beam(f"leg_r_{sy:+d}", (3, sy, 0), (2, sy, 11), 0.8)
        m.beam(f"cross_{sy:+d}", (-2.5, sy, 5.5), (2.5, sy, 5.5), 0.5)
    return m.finish((40, -50, 30), (0, 0, 10), focal=35)


MODELS = {
    "shovel": shovel,
    "truck": truck,
    "bucket_wheel": bucket_wheel,
    "crusher": crusher,
    "swap_station": swap_station,
    "radar_tower": radar_tower,
    "cooling_tower": cooling_tower,
    "chimney": chimney,
    "barn": barn,
    "plant_blocks": plant_blocks,
    "belt_segment": belt_segment,
}

if __name__ == "__main__":
    names = [a for a in sys.argv[1:] if not a.startswith("--")] or list(MODELS)
    for n in names:
        model = MODELS[n]()
        line = f"{n}: 已建"
        if "--preview" in sys.argv:
            line += f"，预览 {model.preview()}"
        print(line, flush=True)
    _ = math  # 保留 math 给以后的模型用

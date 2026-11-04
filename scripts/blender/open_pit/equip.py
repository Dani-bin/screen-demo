"""青原露天矿 · 其余设备的 Blender 模型（bmesh 拼装，在 Blender 里直接建，不走 cli-anything-blender）：
穿孔钻机、推土机、洒水车、指挥巡检车、移动 5G 基站、采场变电站、充电区、现场调度中心、办公生活区、疏干水处理站、卸载点、
端帮皮带 / 排土皮带。

模型按真实尺寸建（米，局部 +Y 朝前 / 正面朝 -Y，+Z 向上，原点在底面中心），摆放时放大 SCALE 倍（总览镜头离坑 3.5 km，
真实尺寸的车只有一两个像素，和电铲、矿卡一样放大）。同类设备共用一份网格数据（GLB 里只存一份），物体名就是设备编号，
页面按名字找。位置和朝向来自 sites.py（纯 numpy）。
发光件用调色板里的发光材质：op_amber 工作灯、op_cyan 设备灯带、op_glass 窗、op_signal 基站信标（页面按在线 / 离线改色）。
"""
import bmesh
import bpy
import numpy as np
from mathutils import Vector

from .props import Builder

# 放大倍数（和 build.py 的 CLI_SCALE 同一个思路：电铲 ×3.2、矿卡 ×2.4）
SCALE = {
    "drill": 3.0,
    "dozer": 3.2,
    "water_truck": 2.6,
    "patrol": 3.4,
    "mast": 2.2,
    "unload": 2.4,
    "substation": 1.6,
    "charger": 2.0,
    "control_center": 1.5,
    "office": 1.4,
    "water_plant": 1.6,
}


# ----------------------------------------------------------------------------- 移动设备


def drill(b, P):
    """穿孔钻机（牙轮钻机，约 14 m 长、钻架 22 m 高）：履带底盘 + 机房 + 驾驶室 + 前端竖直钻架（格构）+ 钻杆 + 液压支腿 + 工作灯"""
    for sx in (-2.4, 2.4):  # 履带
        b.box((1.4, 10.0, 1.6), (sx, 0, 0.8), P["dark"])
        for y in (-5.0, 5.0):
            b.cyl(0.8, 1.4, (sx, y, 0.8), P["dark"], axis="X", seg=12)
    b.box((4.0, 9.6, 0.8), (0, 0, 1.95), P["steel"])  # 底盘
    b.box((5.6, 7.4, 3.2), (0, -1.6, 3.95), P["ochre"])  # 机房（动力、空压机）
    b.box((5.8, 7.6, 0.3), (0, -1.6, 5.7), P["dark"])  # 机房顶
    for sx in (-2.86, 2.86):  # 机房侧面的进风百叶
        for y in (-4.2, -2.9, -1.6):
            b.box((0.1, 0.9, 2.0), (sx, y, 3.9), P["dark"])
    b.box((2.4, 2.6, 2.6), (-1.5, 3.4, 3.65), P["white"])  # 驾驶室（左前）
    b.box((2.2, 0.12, 1.2), (-1.5, 4.72, 4.1), P["glass"])
    b.box((0.12, 2.0, 1.2), (-2.72, 3.4, 4.1), P["glass"])
    H = 22.0  # 钻架
    mx, my = 1.1, 5.4
    corners = [(mx + sx, my + sy) for sx in (-0.7, 0.7) for sy in (-0.55, 0.55)]
    for x, y in corners:
        b.beam((x, y, 2.3), (x, y, H), 0.3, P["ochre"])
    for z in np.arange(4.0, H, 2.6):  # 水平腹杆 + 斜腹杆
        ring =[(mx - 0.7, my - 0.55), (mx + 0.7, my - 0.55), (mx + 0.7, my + 0.55), (mx - 0.7, my + 0.55)]
        for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
            b.beam((x0, y0, z), (x1, y1, z), 0.14, P["ochre"])
            b.beam((x0, y0, z), (x1, y1, z + 2.6), 0.1, P["ochre"])
    b.box((1.9, 1.5, 1.0), (mx, my, H + 0.5), P["steel"])  # 顶部滑轮组
    b.cyl(0.32, H - 4, (mx, my, H / 2 + 1.5), P["steel"], seg=10)  # 钻杆
    b.box((2.0, 1.7, 1.2), (mx, my, 3.4), P["steel"])  # 钻台
    for i in range(4):  # 钻杆架
        b.cyl(0.16, 9.0, (-2.0 + 0.36 * i, -0.4, 6.4), P["steel"], axis="Y", seg=8)
    for sx in (-2.6, 2.6):  # 液压支腿
        for sy in (-4.6, 4.6):
            b.cyl(0.25, 2.0, (sx, sy, 1.0), P["steel"], seg=8)
            b.box((0.9, 0.9, 0.15), (sx, sy, 0.08), P["dark"])
    for z in (7.0, 13.0):  # 钻架上的照明（照钻孔位置）
        b.box((0.9, 0.3, 0.55), (mx, my + 0.75, z), P["amber"])
    b.box((1.4, 0.3, 0.4), (-1.5, 4.75, 5.1), P["amber"])
    b.box((0.6, 0.3, 0.4), (0, -5.4, 5.0), P["amber"])
    b.cyl(0.3, 0.6, (mx, my, H + 1.3), P["cyan"], seg=8)  # 顶部信标


def dozer(b, P):
    """大型履带推土机（约 10 m 长）：三角履带（高置驱动轮）+ 机架 + 发动机罩 + 驾驶室（ROPS + 玻璃）+ 前铲刀 + 推臂 + 后松土器 + 灯"""
    for sx in (-1.9, 1.9):
        b.box((0.95, 6.0, 1.1), (sx, -0.2, 0.55), P["dark"])  # 履带下段
        b.box((0.95, 2.6, 0.9), (sx, -2.1, 1.55), P["dark"], rot=(0.62, 0, 0))  # 后斜段
        b.box((0.95, 2.8, 0.9), (sx, 1.1, 1.5), P["dark"], rot=(-0.5, 0, 0))  # 前斜段
        b.cyl(0.95, 1.0, (sx, -2.6, 2.35), P["steel"], axis="X", seg=14)  # 驱动轮
        for y in (-1.6, -0.4, 0.8, 2.0):  # 支重轮
            b.cyl(0.32, 1.05, (sx, y, 0.55), P["steel"], axis="X", seg=10)
    b.box((2.9, 6.2, 1.2), (0, -0.2, 1.55), P["ochre"])  # 机架
    b.box((2.4, 3.3, 1.7), (0, 1.35, 2.95), P["ochre"])  # 发动机罩
    b.box((2.2, 0.15, 1.3), (0, 3.02, 2.9), P["dark"])  # 散热格栅
    b.cyl(0.16, 1.3, (0.65, 1.9, 4.4), P["dark"], seg=8)  # 排气管
    b.box((2.6, 2.4, 0.45), (0, -1.05, 2.35), P["ochre"])  # 驾驶室底座
    b.box((2.2, 2.0, 1.9), (0, -1.05, 3.5), P["glass"])  # 驾驶室玻璃
    b.box((2.6, 2.5, 0.28), (0, -1.05, 4.6), P["ochre"])  # 顶棚
    for sx in (-1.15, 1.15):
        for sy in (-2.15, 0.05):
            b.box((0.16, 0.16, 2.1), (sx, sy, 3.5), P["ochre"])  # ROPS 立柱
    for y, z, rx in ((4.25, 0.65, 0.3), (4.12, 1.65, 0.0), (3.9, 2.55, -0.38)):  # 铲刀（三段拼出弧面）
        b.box((4.8, 0.36, 1.05), (0, y, z), P["ochre"], rot=(rx, 0, 0))
    for sx in (-2.42, 2.42):  # 铲刀两侧挡板
        b.box((0.15, 0.9, 2.8), (sx, 4.1, 1.5), P["ochre"])
    b.box((4.8, 0.22, 0.25), (0, 4.42, 0.14), P["steel"])  # 刀刃
    for sx in (-2.0, 2.0):  # 推臂
        b.beam((sx, 0.2, 1.2), (sx * 1.04, 3.9, 0.95), 0.36, P["ochre"])
    for sx in (-0.75, 0.75):  # 提升油缸
        b.beam((sx, 2.6, 3.2), (sx, 3.85, 2.1), 0.28, P["steel"])
    b.box((2.2, 0.6, 0.55), (0, -3.6, 1.7), P["ochre"])  # 松土器横梁
    b.beam((0, -3.75, 1.6), (0, -4.3, 0.15), 0.38, P["steel"])  # 松土齿
    for sx in (-0.85, 0.85):
        b.box((0.36, 0.2, 0.26), (sx, 0.2, 4.6), P["amber"])  # 前工作灯
    b.box((0.4, 0.2, 0.26), (0, -2.35, 4.6), P["amber"])  # 后工作灯
    b.cyl(0.15, 0.3, (0.95, -1.8, 4.9), P["amber"], seg=8)  # 警示灯


def water_truck(b, P):
    """洒水车（矿用自卸底盘改装，约 12 m 长）：驾驶室 + 卧式水罐（封头、箍）+ 后喷洒杆 + 灯"""
    b.box((2.6, 11.0, 0.7), (0, 0, 1.5), P["steel"])  # 车架
    for y in (4.0, -2.0, -3.6):
        for sx in (-1.32, 1.32):
            b.cyl(0.78, 0.62, (sx, y, 0.78), P["dark"], axis="X", seg=14)
    b.box((2.6, 2.4, 2.2), (0, 4.4, 2.95), P["white"])  # 驾驶室
    b.box((2.4, 0.12, 1.0), (0, 5.62, 3.4), P["glass"])
    b.box((0.12, 1.6, 0.8), (1.31, 4.5, 3.4), P["glass"])
    b.box((0.12, 1.6, 0.8), (-1.31, 4.5, 3.4), P["glass"])
    b.box((2.7, 0.6, 0.8), (0, 5.45, 1.9), P["steel"])  # 前保险杠
    b.cyl(1.45, 7.6, (0, -0.9, 3.35), P["white"], axis="Y", seg=20)  # 水罐
    for y in (2.95, -4.75):
        b.cyl(1.5, 0.25, (0, y, 3.35), P["steel"], axis="Y", seg=20)  # 封头
    for y in (-3.0, -0.9, 1.2):
        b.cyl(1.53, 0.16, (0, y, 3.35), P["cyan"], axis="Y", seg=20)  # 罐箍（青色反光条）
    b.box((0.8, 1.2, 0.3), (0, 0.6, 4.88), P["steel"])  # 人孔
    b.box((3.2, 0.25, 0.25), (0, -5.25, 1.2), P["steel"])  # 喷洒杆
    b.box((3.8, 0.7, 0.1), (0, -5.75, 0.9), P["cyan"])  # 喷出的水幕（亮带）
    for sx in (-0.9, 0.9):
        b.box((0.4, 0.2, 0.3), (sx, 5.72, 2.1), P["amber"])  # 前灯
        b.box((0.3, 0.15, 0.3), (sx * 1.2, -5.0, 1.8), P["red"])  # 尾灯
    b.cyl(0.18, 0.3, (0.0, 4.4, 4.2), P["amber"], seg=8)  # 顶部警示灯


def patrol(b, P):
    """指挥巡检车（皮卡，约 5.4 m 长）：车身 + 乘员舱（玻璃 + 顶）+ 货厢 + 车轮 + 顶部警灯条（黄 / 红 / 青）+ 大灯"""
    b.box((2.0, 5.4, 0.85), (0, 0, 0.95), P["white"])  # 下车身
    b.box((1.9, 2.5, 0.62), (0, 0.45, 1.68), P["glass"])  # 车窗带
    b.box((1.92, 2.3, 0.18), (0, 0.4, 2.08), P["white"])  # 车顶
    b.box((1.9, 0.12, 0.5), (0, -0.9, 1.6), P["white"])  # 后窗框
    for sx in (-0.98, 0.98):
        b.box((0.08, 2.2, 0.45), (sx, -1.75, 1.6), P["white"])  # 货厢侧板
    b.box((1.9, 0.08, 0.45), (0, -2.68, 1.6), P["white"])  # 货厢尾板
    for y in (1.7, -1.6):
        for sx in (-0.95, 0.95):
            b.cyl(0.42, 0.32, (sx, y, 0.42), P["dark"], axis="X", seg=12)
    b.box((0.5, 0.25, 0.15), (-0.45, 0.4, 2.24), P["amber"])  # 警灯条
    b.box((0.5, 0.25, 0.15), (0.45, 0.4, 2.24), P["red"])
    b.box((0.3, 0.25, 0.15), (0, 0.4, 2.24), P["cyan"])
    for sx in (-0.7, 0.7):
        b.box((0.4, 0.1, 0.18), (sx, 2.72, 1.15), P["amber"])  # 大灯
        b.box((0.3, 0.1, 0.18), (sx, -2.72, 1.15), P["red"])  # 尾灯
    b.box((0.08, 0.08, 1.6), (-0.8, -0.8, 2.6), P["steel"])  # 通信天线


def mast(b, P):
    """移动 5G 基站（拖车式）：拖车 + 设备舱 + 4 条支腿 + 三节伸缩桅杆 + 3 根拉线 + 天线平台 + 三扇区天线板 + RRU + 顶部信标"""
    b.box((2.4, 6.0, 0.5), (0, 0, 1.0), P["steel"])  # 拖车底架
    for sx in (-1.15, 1.15):
        b.cyl(0.45, 0.35, (sx, -1.0, 0.45), P["dark"], axis="X", seg=10)
    b.box((0.2, 1.8, 0.2), (0, 3.9, 0.9), P["steel"])  # 牵引杆
    b.box((2.2, 3.0, 2.2), (0, 1.3, 2.35), P["white"])  # 设备舱
    b.box((2.25, 0.1, 0.3), (0, -0.21, 3.2), P["signal"])  # 设备舱指示灯带
    for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):  # 支腿
        b.beam((sx * 1.0, sy * 2.6, 1.0), (sx * 1.9, sy * 2.9, 0.08), 0.18, P["steel"])
        b.box((0.6, 0.6, 0.1), (sx * 1.9, sy * 2.9, 0.05), P["dark"])
    mx, my = 0.0, -1.6
    for r, h, z0 in ((0.36, 12.0, 1.3), (0.28, 10.0, 13.3), (0.21, 8.0, 23.3)):  # 三节桅杆
        b.cyl(r, h, (mx, my, z0 + h / 2), P["steel"], seg=10)
    for a in (0.3, 2.39, 4.48):  # 拉线
        b.beam((mx, my, 22.0), (mx + np.cos(a) * 10, my + np.sin(a) * 10, 0.2), 0.06, P["steel"])
    b.cyl(1.3, 0.25, (mx, my, 30.0), P["steel"], seg=12)  # 天线平台
    for k in range(3):
        a = k * 2 * np.pi / 3 + 0.4
        b.box((0.6, 0.22, 2.4), (mx + np.cos(a) * 1.05, my + np.sin(a) * 1.05, 31.6), P["white"], rot=(0, 0, a + np.pi / 2))
        b.box((0.4, 0.3, 0.6), (mx + np.cos(a) * 0.55, my + np.sin(a) * 0.55, 30.6), P["steel"], rot=(0, 0, a))
    b.cyl(0.28, 0.6, (mx, my, 33.2), P["signal"], seg=8)  # 顶部信标


# ----------------------------------------------------------------------------- 场站 / 建筑（正面朝 -Y，摆放时朝南对着相机）


def _fence(b, P, w, d, h=2.4, step=6.0):
    """矩形围栏：立柱 + 两道横杆"""
    pts = [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
        L = float(np.hypot(x1 - x0, y1 - y0))
        for z in (h * 0.45, h):
            b.beam((x0, y0, z), (x1, y1, z), 0.12, P["steel"])
        for t in np.linspace(0, 1, max(2, int(L / step)) + 1)[:-1]:
            b.box((0.16, 0.16, h), (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, h / 2), P["steel"])


def _lamp_pole(b, P, x, y, h=12.0):
    b.cyl(0.18, h, (x, y, h / 2), P["steel"], seg=8)
    b.box((1.4, 0.5, 0.35), (x, y, h + 0.1), P["amber"])


def substation(b, P):
    """采场变电站（110 kV，约 64 × 44 m）：场地 + 围栏 + 两台主变（本体、散热片、套管、储油柜）+ 进线门型构架 + 母线 + 配电室 + 灯杆"""
    W, D = 64.0, 44.0
    b.box((W, D, 0.4), (0, 0, 0.2), P["concrete"])
    _fence(b, P, W, D)
    for x in (-14.0, 8.0):
        b.box((2.0, 6.0, 0.6), (x, 4.0, 0.7), P["concrete"])  # 基础
        b.box((7.0, 5.0, 4.6), (x, 4.0, 3.3), P["steel"])  # 本体
        for sx in (-1, 1):  # 两侧散热片组
            for i in range(6):
                b.box((1.4, 0.18, 3.6), (x + sx * 4.3, 2.0 + 0.8 * i, 3.0), P["dark"])
        b.cyl(0.7, 5.0, (x, 6.2, 6.6), P["steel"], axis="X", seg=12)  # 储油柜
        for i in (-2.0, 0.0, 2.0):  # 高压套管（白色瓷瓶）
            b.cyl(0.28, 3.0, (x + i, 3.0, 7.1), P["white"], seg=8)
    for y in (-8.0, 14.0):  # 门型构架
        for x in (-26.0, -2.0, 22.0):
            b.box((0.6, 0.6, 14.0), (x, y, 7.0), P["steel"])
        b.box((50.0, 0.5, 0.8), (-2.0, y, 13.6), P["steel"])
    for x in (-20.0, -2.0, 14.0):  # 母线
        b.beam((x, -8.0, 13.0), (x, 14.0, 13.0), 0.18, P["white"])
        for y in (-8.0, 14.0):
            b.cyl(0.18, 2.2, (x, y, 12.0), P["white"], seg=6)  # 绝缘子串
    b.box((16.0, 8.0, 5.0), (18.0, -13.0, 2.9), P["concrete"])  # 配电室
    b.box((16.2, 8.2, 0.4), (18.0, -13.0, 5.6), P["white"])
    b.box((13.0, 0.12, 1.2), (18.0, -17.06, 3.4), P["glass"])
    b.box((16.2, 0.12, 0.25), (18.0, -17.1, 5.2), P["cyan"])
    for x, y in ((-30.0, -20.0), (30.0, -20.0), (-30.0, 20.0), (30.0, 20.0)):
        _lamp_pole(b, P, x, y)


def charger(b, P):
    """充电区（矿卡 / 辅助车辆充电，约 48 × 26 m）：场地 + 车位线 + 雨棚（6 根柱 + 屋面 + 青色灯带）+ 6 台充电柜（屏幕亮）+ 箱变"""
    W, D = 48.0, 26.0
    b.box((W, D, 0.3), (0, 0, 0.15), P["concrete"])
    for x in np.linspace(-20, 20, 7):  # 车位线
        b.box((0.35, 16.0, 0.08), (x, 2.0, 0.34), P["cyan"])
    for x in (-21.0, 0.0, 21.0):  # 雨棚柱
        for y in (-6.0, 10.0):
            b.box((0.7, 0.7, 9.0), (x, y, 4.5), P["steel"])
    b.box((46.0, 18.0, 0.8), (0, 2.0, 9.4), P["white"])  # 屋面
    b.box((46.2, 0.3, 0.35), (0, -7.05, 9.3), P["cyan"])  # 檐口灯带
    for x in np.linspace(-17, 17, 6):  # 充电柜
        b.box((1.8, 1.0, 2.6), (x, -8.0, 1.6), P["steel"])
        b.box((1.0, 0.08, 0.7), (x, -8.55, 2.1), P["cyan"])  # 屏幕
        b.box((0.9, 0.08, 0.25), (x, -8.55, 2.9), P["amber"])  # 状态灯
    b.box((5.0, 3.0, 3.0), (-22.0, -10.5, 1.8), P["concrete"])  # 箱变
    b.box((5.1, 0.1, 0.2), (-22.0, -12.05, 3.0), P["cyan"])


def control_center(b, P):
    """现场调度中心（约 42 × 24 m，三层）：主楼 + 每层一圈玻璃幕墙带 + 屋顶女儿墙 / 设备 + 通信塔 + 入口雨棚 + 青色标识带"""
    W, D, Hf = 42.0, 24.0, 4.6
    for k in range(3):
        z0 = k * Hf
        b.box((W, D, 1.4), (0, 0, z0 + 0.7), P["concrete"])  # 楼板 / 窗下墙
        b.box((W - 0.6, D - 0.6, Hf - 1.4), (0, 0, z0 + 1.4 + (Hf - 1.4) / 2), P["glass"])  # 玻璃幕墙
    b.box((W + 0.4, D + 0.4, 1.0), (0, 0, 3 * Hf + 0.5), P["white"])  # 女儿墙
    b.box((W - 2, D - 2, 0.3), (0, 0, 3 * Hf + 0.2), P["dark"])
    for x in (-12.0, -4.0, 6.0):  # 屋顶空调机组
        b.box((4.0, 3.0, 2.0), (x, 4.0, 3 * Hf + 1.3), P["steel"])
    b.box((1.2, 1.2, 1.2), (14.0, 6.0, 3 * Hf + 0.9), P["steel"])  # 通信塔
    b.cyl(0.35, 16.0, (14.0, 6.0, 3 * Hf + 9.0), P["steel"], seg=8)
    b.box((2.2, 0.3, 1.4), (14.0, 6.0, 3 * Hf + 15.0), P["white"])
    b.cyl(0.3, 0.5, (14.0, 6.0, 3 * Hf + 17.3), P["red"], seg=8)
    b.box((12.0, 6.0, 0.5), (0, -D / 2 - 3.0, 4.2), P["white"])  # 入口雨棚
    for x in (-5.5, 5.5):
        b.box((0.4, 0.4, 4.0), (x, -D / 2 - 5.6, 2.0), P["steel"])
    b.box((W + 0.5, 0.3, 0.45), (0, -D / 2 - 0.25, 3 * Hf - 0.4), P["cyan"])  # 标识灯带
    b.box((50.0, 36.0, 0.25), (0, 0, 0.12), P["concrete"])  # 场地


def office(b, P):
    """办公生活区（约 160 × 110 m）：两栋宿舍楼 + 办公楼 + 食堂 + 活动场地 + 灯杆，楼层用玻璃窗带表示"""

    def block(x, y, w, d, floors, fh=3.4):
        for k in range(floors):
            z0 = k * fh
            b.box((w, d, 1.1), (x, y, z0 + 0.55), P["concrete"])
            b.box((w - 0.5, d - 0.5, fh - 1.1), (x, y, z0 + 1.1 + (fh - 1.1) / 2), P["glass"])
        b.box((w + 0.3, d + 0.3, 0.8), (x, y, floors * fh + 0.4), P["white"])

    b.box((160.0, 110.0, 0.25), (0, 0, 0.12), P["concrete"])  # 场地
    block(-45.0, 20.0, 52.0, 14.0, 6)  # 宿舍 1
    block(-45.0, -12.0, 52.0, 14.0, 6)  # 宿舍 2
    block(30.0, 22.0, 40.0, 16.0, 4, fh=4.0)  # 办公楼
    block(32.0, -18.0, 30.0, 22.0, 2, fh=4.5)  # 食堂
    b.box((40.0, 22.0, 0.15), (-45.0, -40.0, 0.3), P["dark"])  # 球场
    b.box((38.0, 0.25, 0.1), (-45.0, -40.0, 0.4), P["cyan"])
    for x in (-70.0, -20.0, 10.0, 60.0):
        _lamp_pole(b, P, x, -50.0, 9.0)


def water_plant(b, P):
    """疏干水处理站（约 120 × 70 m）：两座圆形沉淀池（池壁 + 水面 + 刮泥桥）+ 矩形过滤池 + 泵房 + 两个清水罐 + 管道"""
    b.box((120.0, 70.0, 0.3), (0, 0, 0.15), P["concrete"])
    for x in (-36.0, 0.0):  # 圆形沉淀池
        b.lathe([(14.0, 0.0), (14.0, 3.0), (13.4, 3.0), (13.4, 0.5)], P["concrete"], seg=40, center=(x, 12.0, 0))
        b.cyl(13.4, 0.2, (x, 12.0, 2.5), P["water"], seg=40)
        b.box((27.0, 1.2, 1.0), (x, 12.0, 3.4), P["steel"], rot=(0, 0, 0.6))  # 刮泥桥
        b.cyl(1.2, 1.6, (x, 12.0, 3.6), P["steel"], seg=12)
    b.box((34.0, 16.0, 2.6), (34.0, 14.0, 1.3), P["concrete"])  # 过滤池
    for k in range(3):
        b.box((10.0, 14.0, 0.2), (23.5 + 10.5 * k, 14.0, 2.5), P["water"])
    b.box((20.0, 12.0, 7.0), (-24.0, -20.0, 3.5), P["concrete"])  # 泵房
    b.box((20.3, 12.3, 0.5), (-24.0, -20.0, 7.2), P["white"])
    b.box((16.0, 0.12, 1.4), (-24.0, -26.07, 4.6), P["glass"])
    b.box((20.3, 0.12, 0.25), (-24.0, -26.1, 6.8), P["cyan"])
    for x in (16.0, 32.0):  # 清水罐
        b.cyl(5.5, 11.0, (x, -18.0, 5.5), P["white"], seg=24)
        b.cyl(5.6, 0.3, (x, -18.0, 8.5), P["cyan"], seg=24)
    b.cyl(0.6, 52.0, (-6.0, -6.0, 1.2), P["steel"], axis="X", seg=10)  # 管道
    b.cyl(0.6, 24.0, (-36.0, -4.0, 1.2), P["steel"], axis="Y", seg=10)
    for x, y in ((-55.0, -30.0), (55.0, -30.0), (55.0, 30.0)):
        _lamp_pole(b, P, x, y, 10.0)


def unload(b, P):
    """卸载点（排土场坡脚）：挡车土埂（沿 ±X 走向的梯形截面，原点在土埂外侧）+ 两座移动照明灯塔 + 青色卸载位标桩"""
    L = 34.0
    b.box((L, 3.0, 1.1), (0, 1.5, 0.55), P["dump"])  # 土埂下半
    b.box((L, 1.6, 1.0), (0, 1.5, 1.6), P["dump"])  # 土埂上半
    for x in (-L / 2 - 4.0, L / 2 + 4.0):  # 移动照明灯塔：拖车 + 桅杆 + 4 个灯头
        b.box((1.8, 3.6, 1.2), (x, -2.0, 0.9), P["steel"])
        b.cyl(0.15, 8.5, (x, -2.0, 5.5), P["steel"], seg=8)
        b.box((2.4, 0.7, 0.9), (x, -2.2, 9.9), P["amber"])
    for x in (-8.0, 8.0):  # 卸载位标桩
        b.box((0.4, 0.4, 2.6), (x, -1.0, 1.3), P["cyan"])


def cooling_tower(b, P, R0=59.0, rw=38.0, H=200.0, zw=150.0):
    """双曲线冷却塔（第 18 轮，替换 cli 工具的两段圆锥台）：r(z) = rw·√(1 + ((z − zw) / c)²)，
    c 由底部半径 R0 定；尺寸按设计稿量的（底宽约 80 px、顶宽约 54 px、高约 103 px，喉部在一半偏上）反求：
    底半径 59 m、喉部 38 m、顶部约 41 m、高 200 m。塔筒底部 10 m 是一圈人字柱（进风口），底部一圈青灯，顶部白色塔沿，
    塔口的亮由页面叠加的蒸汽表现"""
    c = zw / np.sqrt((R0 / rw) ** 2 - 1)
    zs = np.linspace(10.0, H, 24)
    prof = [(float(rw * np.sqrt(1 + ((z - zw) / c) ** 2)), float(z)) for z in zs]
    b.lathe(prof, P["concrete"], seg=56)
    rt = prof[-1][0]
    b.lathe([(rt - 0.5, H), (rt + 1.6, H + 0.6), (rt + 1.6, H + 2.4), (rt - 0.5, H + 2.4)], P["white"], seg=56)  # 塔沿
    for z in (H * 0.42, H * 0.7):  # 两道淡青灯带
        r = rw * np.sqrt(1 + ((z - zw) / c) ** 2)
        b.lathe([(r + 0.2, z - 0.6), (r + 0.6, z), (r + 0.2, z + 0.6)], P["cyan"], seg=56)
    r_base = prof[0][0]
    n = 40
    for i in range(n):  # 人字柱：相邻两根斜着交叉
        a0, a1 = 2 * np.pi * i / n, 2 * np.pi * (i + 0.5) / n
        p0 = (r_base * np.cos(a0), r_base * np.sin(a0), 0.0)
        p1 = (r_base * np.cos(a1), r_base * np.sin(a1), 10.0)
        b.beam(p0, p1, 1.4, P["concrete"])
        b.beam((p1[0], p1[1], 0.0), (p0[0], p0[1], 10.0), 1.4, P["concrete"])
    b.lathe([(r_base + 2.0, 0.3), (r_base + 2.0, 2.2), (r_base + 0.5, 2.2)], P["cyan"], seg=56)  # 底部灯环
    for i in range(16):  # 底部一圈灯（设计稿里塔脚一串青色光点）
        a = 2 * np.pi * i / 16
        b.box((4.0, 4.0, 2.4), ((r_base + 4.5) * np.cos(a), (r_base + 4.5) * np.sin(a), 1.4), P["cyan"])
    # 塔口不放发光盘（近景里像一块白盖子），塔口的亮靠页面里的蒸汽
    b.cyl(r_base * 0.98, 0.5, (0, 0, 0.3), P["dark"], seg=40)  # 塔底水池


def barn(b, P, length, W=150.0, Hb=62.0, rib_step=14.0):
    """封闭煤场（第 18 轮，替换 cli 工具的压扁圆柱）：椭圆拱（跨度 W、拱高 Hb）壳 + 一道道拱肋 + 两端山墙（带亮的拱形门洞）+ 底座；
    沿局部 Y 长 length。设计稿里拱棚是亮白的、很高，原来拱高只有跨度的 0.275、整个棚子是贴地的一块斜线面片"""
    n = 28
    prof = [(W / 2 * np.cos(np.pi * k / n), Hb * np.sin(np.pi * k / n)) for k in range(n + 1)]
    seg = max(8, int(length / 20))
    rings = []
    for i in range(seg + 1):
        y = -length / 2 + length * i / seg
        rings.append([b.bm.verts.new((x, y, z)) for x, z in prof])
    mi = b._mi(P["white"])
    for i in range(seg):
        for j in range(n):
            f = b.bm.faces.new((rings[i][j], rings[i][j + 1], rings[i + 1][j + 1], rings[i + 1][j]))
            f.material_index = mi
    for y in np.arange(-length / 2 + rib_step / 2, length / 2, rib_step):  # 拱肋
        for (x0, z0), (x1, z1) in zip(prof[:-1], prof[1:]):
            b.beam((x0 * 1.01, y, z0 * 1.01 + 0.3), (x1 * 1.01, y, z1 * 1.01 + 0.3), 0.9, P["steel"])
    for sy in (-1, 1):  # 山墙：扇形面 + 亮门洞
        ctr = b.bm.verts.new((0, sy * length / 2, 0))
        edge = [b.bm.verts.new((x, sy * length / 2, z)) for x, z in prof]
        mi2 = b._mi(P["concrete"])
        for j in range(n):
            f = b.bm.faces.new((ctr, edge[j], edge[j + 1]) if sy > 0 else (ctr, edge[j + 1], edge[j]))
            f.material_index = mi2
        b.box((40.0, 0.6, 18.0), (0, sy * (length / 2 + 0.4), 9.0), P["glass"])
        b.box((W * 0.9, 0.5, 1.2), (0, sy * (length / 2 + 0.5), Hb * 0.55), P["cyan"])
    b.box((W + 16.0, length + 16.0, 1.2), (0, 0, 0.6), P["concrete"])  # 底座
    for sx in (-1, 1):  # 底边一圈灯带
        b.box((1.0, length, 1.2), (sx * (W / 2 + 3.0), 0, 1.6), P["cyan"])


def power_plant(b, P):
    """坑口电厂主厂区（约 300 × 200 m，正面朝 -Y）：主厂房（汽机房 + 除氧间 + 煤仓间 + 锅炉房）、输煤栈桥接口、
    升压站、办公楼、化水 / 综合楼，屋顶白、墙暗、每层一道亮窗带、檐口青灯带——设计稿右下角是一片亮着灯的厂房群，
    原来的 cli 方盒子在近景里是几块灰平板（第 18 轮）"""

    def block(x, y, w, d, h, floors, roof="white"):
        b.box((w, d, h), (x, y, h / 2), P["concrete"])
        b.box((w + 1.0, d + 1.0, 1.2), (x, y, h + 0.6), P[roof])
        fh = h / floors
        for k in range(floors):  # 南、东两面的窗带
            z = fh * (k + 0.55)
            b.box((w * 0.9, 0.3, fh * 0.32), (x, y - d / 2 - 0.15, z), P["glass"])
            b.box((0.3, d * 0.85, fh * 0.32), (x + w / 2 + 0.15, y, z), P["glass"])
        b.box((w + 1.2, 0.4, 0.5), (x, y - d / 2 - 0.6, h + 0.2), P["cyan"])  # 檐口灯带

    b.box((310.0, 210.0, 0.4), (0, 0, 0.2), P["concrete"])  # 场地
    block(-60.0, 10.0, 120.0, 42.0, 34.0, 4)  # 汽机房
    block(-60.0, 38.0, 120.0, 14.0, 42.0, 6)  # 除氧间
    block(-60.0, 54.0, 120.0, 18.0, 52.0, 7)  # 煤仓间
    for x in (-95.0, -25.0):  # 两台锅炉房（最高）
        block(x, 86.0, 46.0, 44.0, 78.0, 9)
        b.box((20.0, 20.0, 10.0), (x, 86.0, 83.0), P["steel"])  # 顶部汽包间
    b.box((60.0, 14.0, 26.0), (30.0, 60.0, 30.0), P["steel"], rot=(0, 0, 0))  # 输煤栈桥接口
    b.box((60.0, 1.0, 1.0), (30.0, 52.5, 43.5), P["cyan"])
    block(70.0, -40.0, 50.0, 26.0, 22.0, 5)  # 办公楼
    block(30.0, -70.0, 40.0, 30.0, 12.0, 2)  # 化水 / 综合楼
    # 升压站：围栏场地 + 一排门型构架 + 三台主变
    b.box((90.0, 60.0, 0.3), (100.0, 50.0, 0.45), P["dark"])
    for x in (65.0, 95.0, 125.0):
        b.box((0.8, 0.8, 18.0), (x, 70.0, 9.0), P["steel"])
        b.box((7.0, 5.0, 5.0), (x, 40.0, 3.0), P["steel"])
    b.box((64.0, 0.6, 0.8), (95.0, 70.0, 17.6), P["steel"])
    for x, y in ((-140.0, -90.0), (0.0, -95.0), (140.0, -90.0), (140.0, 90.0)):
        b.cyl(0.3, 16.0, (x, y, 8.0), P["steel"], seg=8)
        b.box((2.0, 0.8, 0.5), (x, y, 16.2), P["amber"])


KINDS = {
    "drill": drill,
    "dozer": dozer,
    "water_truck": water_truck,
    "patrol": patrol,
    "mast": mast,
    "substation": substation,
    "charger": charger,
    "control_center": control_center,
    "office": office,
    "water_plant": water_plant,
    "unload": unload,
}


# ----------------------------------------------------------------------------- 皮带


def belt(P, name, col, pts, height=9.0, width=7.0, straight=False):
    """露天皮带（端帮皮带 / 排土皮带）：沿 pts（世界 (x, y, 地表 z)）的桁架机架 + 皮带面 + 两侧青色边灯 + 支腿。
    带面高度 = 端点之间按长度线性插值（坡度均匀），且不低于地表 + height；宽度按总览能看见放大（真实 2.4 m）。
    straight：端帮皮带走切出来的直线槽（carve.py），带面就是直线坡，地表也按槽底算（支腿到槽底）"""
    b = Builder()
    P3 = np.asarray(pts, float)
    seg = np.hypot(*np.diff(P3[:, :2], axis=0).T)
    cum = np.r_[0, np.cumsum(seg)]
    za, zb = P3[0, 2] + height, P3[-1, 2] + height
    z = za + (zb - za) * cum / max(cum[-1], 1.0)
    if straight:
        P3 = P3.copy()
        P3[:, 2] = z - height - 0.6  # 槽底（和 carve.SURFACE_BELOW 一致）
    else:
        z = np.maximum(z, P3[:, 2] + height)
    for i in range(len(P3) - 1):
        a = Vector((P3[i, 0], P3[i, 1], z[i]))
        c = Vector((P3[i + 1, 0], P3[i + 1, 1], z[i + 1]))
        d = (c - a).normalized()
        side = Vector((-d.y, d.x, 0)).normalized() * (width / 2)
        b.beam(a, c, width * 0.8, P["steel"])  # 机架
        b.beam(a + Vector((0, 0, width * 0.42)), c + Vector((0, 0, width * 0.42)), width * 0.55, P["dark"])  # 带面（煤 / 土）
        b.beam(a + side + Vector((0, 0, width * 0.45)), c + side + Vector((0, 0, width * 0.45)), 0.9, P["cyan"])
        b.beam(a - side + Vector((0, 0, width * 0.45)), c - side + Vector((0, 0, width * 0.45)), 0.9, P["cyan"])
        for s in (-1, 1):  # 支腿（到地表）
            foot = Vector((a.x, a.y, P3[i, 2])) + side * s * 0.8
            b.beam(a + side * s * 0.6, foot, 1.0, P["steel"])
    return b.finish(name, col, (0, 0, 0), 0.0, 1.0)


# ----------------------------------------------------------------------------- 摆放


def place_all(col, P):
    """按 sites.py 摆全部设备：每种一份网格（Builder 建一次），每台设备一个物体共用它；再建两条皮带"""
    from . import sites as S

    st = S.Sites()
    meshes = {}
    n = 0
    for i, d in st.devices().items():
        kind = d["kind"]
        if kind not in meshes:
            b = Builder()
            KINDS[kind](b, P)
            proto = b.finish(f"_proto_{kind}", col)
            meshes[kind] = proto.data
            meshes[kind].name = f"eq_{kind}"
            bpy.data.objects.remove(proto, do_unlink=True)
        o = bpy.data.objects.new(i, meshes[kind])
        col.objects.link(o)
        o.location = d["loc"]
        o.rotation_euler = (0, 0, d["yaw"])
        k = SCALE[kind]
        o.scale = (k, k, k)
        n += 1
    for name, pts in st.belts().items():
        belt(P, name, col, pts, straight=(name == "BC-01"))
        n += 1
    return n

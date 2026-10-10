"""
房间级 · 会议室精细模型（设计稿 docs/design/building/04-ai-room.png、14-draft-room.png：南塔 32F 3205 大会议室）
----------------------------------------------------------
房间按设计稿建成独立的 12 × 7.2 m（约 86 m²）会议室，层高 3.0 m（吊顶），吊顶以上 0.8 m 设备层；坐标（Blender，z 向上）：
  x 横向（-6 左侧玻璃幕墙 → +6 右侧实墙与玻璃门），y 进深（-3.6 前沿剖切敞开 → +3.6 后墙：白板、木格栅、会议大屏），
  左前角是半径 2.5 m 的圆角（塔楼外立面的弧）。three.js 里 (x, y, z) = Blender (x, z, -y)，相机在右前上方。
对象：
  room          地面（地毯纹理）+ 墙面 → 烘焙贴图（4096²）
  room_v        家具（会议桌、10 把班椅、边柜、白板、绿植）、木格栅、门框、窗框、楼板边、走廊 → 烘焙面角顶点色
  glass         幕墙玻璃、玻璃门（不烘焙，three.js 玻璃材质）
  dev_<编号>    资产设备（空调内机、灯盘、烟感、喷淋、AP、摄像机、温湿度、门禁、插座、灯控面板、会议大屏）→ 不烘焙，
                带材质导出，three.js 实时光照、可点选（编号与 src/views/building/data/room.js 一致）
  plenum        吊顶内风管、喷淋管 → 同设备，不可点选
  room_bakeonly 吊顶、筒灯、洗墙灯、窗外城市光、走廊灯 → 只在烘焙时照亮室内，不导出
Blender（MCP）：import tower.room as r; r.run(); r.bake()（约 10 分钟）; r.export()（public/building/room.glb）
"""

import importlib
import math
import os
import random
import time

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import floors, lib
from .build import MODEL_DIR, ROOT
from .floors import MI

OUT = os.path.join(ROOT, "public", "building", "room.glb")
W, D, H = 12.0, 7.2, 3.0  # 房间宽、进深、吊顶高
X0, X1, Y0, Y1 = -W / 2, W / 2, -D / 2, D / 2
CR = 2.5  # 左前角圆角半径
PLENUM = 0.8  # 吊顶以上设备层高
EXPOSURE = 1.3

# 房间级新增材质（追加在楼层材质表之后，按名称取）
ROOM_MATS = [
    ("r_carpet", "#5c6068", 0.95, None, 0),
    ("r_plaster", "#a39b90", 0.85, None, 0),
    ("r_slat", "#8a5c36", 0.5, None, 0),
    ("r_slat_bk", "#2a2420", 0.8, None, 0),
    ("r_table", "#8f5f37", 0.35, None, 0),
    ("r_leather", "#1a1c20", 0.45, None, 0),
    ("r_chrome", "#c8ccd2", 0.2, None, 0),
    ("r_board", "#e9ebee", 0.3, None, 0),
    ("r_frame", "#3a3f46", 0.4, None, 0),
    ("r_slab", "#4a5058", 0.7, None, 0),
    ("r_corr_fl", "#b9bbbe", 0.3, None, 0),
    ("r_tv", "#0b0d10", 0.3, None, 0),
    ("r_tv_scr", "#000000", 0.3, "#3d7dff", 3.0),
    ("r_dev_w", "#e8eaee", 0.45, None, 0),
    ("r_dev_g", "#9aa1aa", 0.4, None, 0),
    ("r_dev_k", "#23272d", 0.4, None, 0),
    ("r_duct", "#2b2f35", 0.6, None, 0),
    ("r_pipe_r", "#b23a32", 0.4, None, 0),
    ("r_panel_l", "#ffffff", 0.5, "#eef4ff", 30.0),  # 灯盘（设备，三维里实时显示；烘焙时照亮室内）
    ("r_down", "#ffffff", 0.5, "#ffd8a6", 500.0),  # 筒灯 3000K
    ("r_wash", "#ffffff", 0.5, "#ffcf96", 140.0),  # 木格栅洗墙灯带
    ("r_city", "#000000", 0.5, "#4a6ab0", 0.8),  # 窗外城市夜光
    ("r_corr_lt", "#ffffff", 0.5, "#fff2e0", 18.0),  # 走廊灯
    ("r_ceil", "#3a3d42", 0.9, None, 0),
    ("r_leaf", "#2f6a2e", 0.7, None, 0),
    ("r_pot", "#2c2f34", 0.5, None, 0),
    ("r_led_g", "#000000", 0.5, "#30ff90", 4.0),
]


def _materials():
    base = floors.materials()
    extra = [lib.material("MT_" + n, c, rough=r, emit=e, strength=s) for n, c, r, e, s in ROOM_MATS]
    return base + extra


R = {}  # 材质名 → 槽位序号（_materials 之后填）


def _carpet_texture():
    """地毯程序纹理：细密的圈绒斑点 + 一道道浅色横纹（设计稿灰色块毯），烘焙进贴图"""
    m = bpy.data.materials["MT_r_carpet"]
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    for n in [n for n in nt.nodes if n.name.startswith("RT_")]:
        nt.nodes.remove(n)

    def node(t, nm):
        n = nt.nodes.new(t)
        n.name = "RT_" + nm
        return n

    tc = node("ShaderNodeTexCoord", "tc")
    mp = node("ShaderNodeMapping", "map")
    mp.inputs["Scale"].default_value = (1.0, 3.0, 1.0)  # 横向拉长：圈绒的条纹感
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    n1 = node("ShaderNodeTexNoise", "fine")
    n1.inputs["Scale"].default_value = 60.0
    n1.inputs["Detail"].default_value = 8.0
    nt.links.new(mp.outputs["Vector"], n1.inputs["Vector"])
    n2 = node("ShaderNodeTexNoise", "coarse")
    n2.inputs["Scale"].default_value = 1.6
    n2.inputs["Detail"].default_value = 3.0
    nt.links.new(tc.outputs["Object"], n2.inputs["Vector"])
    ramp = node("ShaderNodeValToRGB", "ramp")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = lib._lin("#3e4249")
    ramp.color_ramp.elements[1].position = 0.7
    ramp.color_ramp.elements[1].color = lib._lin("#7a7e86")
    nt.links.new(n1.outputs["Fac"], ramp.inputs["Fac"])
    mr = node("ShaderNodeMapRange", "range")
    mr.inputs["To Min"].default_value = 0.85
    mr.inputs["To Max"].default_value = 1.1
    nt.links.new(n2.outputs["Fac"], mr.inputs["Value"])
    mx = node("ShaderNodeMix", "mix")
    mx.data_type = "RGBA"
    mx.blend_type = "MULTIPLY"
    mx.inputs["Factor"].default_value = 1.0
    nt.links.new(ramp.outputs["Color"], mx.inputs["A"])
    nt.links.new(mr.outputs["Result"], mx.inputs["B"])
    nt.links.new(mx.outputs["Result"], bsdf.inputs["Base Color"])


# ---------------------------------------------------------------- 几何工具


def outline(step_deg=6):
    """房间平面轮廓（逆时针）：右前 → 右后 → 左后 → 左侧直段 → 左前圆角 → 前沿"""
    pts = [(X1, Y0), (X1, Y1), (X0, Y1), (X0, Y0 + CR)]
    cx, cy = X0 + CR, Y0 + CR
    for k in range(1, int(90 / step_deg)):
        t = math.radians(180 + k * step_deg)
        pts.append((cx + CR * math.cos(t), cy + CR * math.sin(t)))
    pts.append((X0 + CR, Y0))
    return pts


def facade_path(step_deg=6):
    """幕墙路径：左后角 → 左侧直段 → 左前圆角 → 前沿圆角止点（玻璃只沿外立面）"""
    pts = [(X0, Y1), (X0, Y0 + CR)]
    cx, cy = X0 + CR, Y0 + CR
    for k in range(1, int(90 / step_deg) + 1):
        t = math.radians(180 + k * step_deg)
        pts.append((cx + CR * math.cos(t), cy + CR * math.sin(t)))
    return pts


def box(bm, mat, size, c, rot=0.0, bottom=False):
    lib.add_box(bm, size, c, rot, R[mat], bottom)


def cyl(bm, mat, r, h, c, seg=14, cap=True):
    lib.add_cyl(bm, r, h, c, seg=seg, mat=R[mat], cap=cap)


def seg(bm, mat, a, b, r, n=10):
    lib.add_seg(bm, a, b, r, R[mat], n)


def beam(bm, mat, a, b, w, h):
    lib.add_beam(bm, a, b, w, h, R[mat])


def wall_quad(bm, mat, p, q, z0, z1, normal_toward):
    """竖直墙面（单面），法线朝 normal_toward 一侧"""
    v = [Vector((p[0], p[1], z0)), Vector((q[0], q[1], z0)), Vector((q[0], q[1], z1)), Vector((p[0], p[1], z1))]
    n = (v[1] - v[0]).cross(v[2] - v[1])
    mid = (v[0] + v[2]) / 2
    if n.dot(Vector((*normal_toward, mid.z)) - mid) < 0:
        v.reverse()
    f = bm.faces.new([bm.verts.new(x) for x in v])
    f.material_index = R[mat]


def rounded_rect(cx, cy, w, h, r, n=8):
    pts = []
    for (sx, sy, a0) in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ox, oy = cx + sx * (w / 2 - r), cy + sy * (h / 2 - r)
        for k in range(n + 1):
            t = math.radians(a0 + 90 * k / n)
            pts.append((ox + r * math.cos(t), oy + r * math.sin(t)))
    return pts


# ---------------------------------------------------------------- 家具


def chair(bv, x, y, face):
    """高背班椅（设计稿黑色皮面 + 镀铬扶手 / 五星脚）：face 为椅子朝向（坐的人面朝的方向，弧度）"""
    cf, sf = math.cos(face), math.sin(face)

    def at(u, v, z):
        """局部 u 朝前、v 朝左"""
        return (x + u * cf - v * sf, y + u * sf + v * cf, z)

    # 五星脚 + 万向轮
    for k in range(5):
        t = face + k * 2 * math.pi / 5
        e = (x + 0.3 * math.cos(t), y + 0.3 * math.sin(t), 0.08)
        beam(bv, "r_chrome", (x, y, 0.1), e, 0.05, 0.035)
        cyl(bv, "r_leather", 0.03, 0.06, (e[0], e[1], 0.0), seg=8)
    cyl(bv, "r_chrome", 0.03, 0.34, (x, y, 0.1), seg=8, cap=False)
    # 座垫（两层：底盘 + 软垫）
    box(bv, "r_frame", (0.46, 0.46, 0.04), at(0, 0, 0.44), face)
    box(bv, "r_leather", (0.5, 0.5, 0.08), at(0.02, 0, 0.5), face)
    # 椅背：略后仰的高背 + 头枕段
    b0, b1 = at(-0.24, 0, 0.56), at(-0.33, 0, 1.12)
    beam(bv, "r_leather", b0, b1, 0.48, 0.07)
    beam(bv, "r_chrome", at(-0.22, 0, 0.5), at(-0.27, 0, 0.68), 0.06, 0.03)
    # 扶手：镀铬立柱 + 皮面扶手垫
    for s in (-1, 1):
        beam(bv, "r_chrome", at(-0.12, s * 0.27, 0.48), at(0.0, s * 0.27, 0.7), 0.03, 0.025)
        box(bv, "r_leather", (0.3, 0.06, 0.035), at(0.02, s * 0.27, 0.72), face)


def plant(bv, x, y, big=False, z=0.0):
    """绿植：深色方盆 + 多团叶簇（大盆 1.6 m 高）"""
    rnd = random.Random(int(x * 100 + y * 10))
    s = 1.6 if big else 0.7
    if big:
        box(bv, "r_pot", (0.45, 0.45, 0.5), (x, y, z + 0.25))
    else:
        box(bv, "r_pot", (0.22, 0.22, 0.16), (x, y, z + 0.08))
    for i in range(9 if big else 5):
        t = rnd.random() * 6.28
        r = rnd.random() * 0.22 * s
        zz = z + (0.5 if big else 0.18) + rnd.random() * 0.75 * s
        res = bmesh.ops.create_icosphere(
            bv, subdivisions=2, radius=(0.12 + rnd.random() * 0.1) * s,
            matrix=Matrix.Translation((x + r * math.cos(t), y + r * math.sin(t), zz)) @ Matrix.Scale(1.0, 4),
        )
        for f in {f for v in res["verts"] for f in v.link_faces}:
            f.material_index = R["r_leaf"]
    if big:
        cyl(bv, "r_slat_bk", 0.025, 0.9, (x, y, z + 0.5), seg=6, cap=False)


# ---------------------------------------------------------------- 设备（每个一个对象）


def _new(name, bm, M, col, loc):
    ob = lib.new_object(name, bm, M, col)
    ob.location = loc
    return ob


def devices(M, col, loc):
    """资产设备：编号与 data/room.js 的 ASSETS 一致（dev_ 前缀 + 编号）"""
    out = []

    def make(name, build):
        bm = bmesh.new()
        build(bm)
        out.append(_new("dev_" + name, bm, M, col, loc))

    def ac(cx, cy):
        def b(bm):
            # 四面出风嵌入机：机身在吊顶上，面板贴吊顶（四周出风口 + 中间回风格栅）
            box(bm, "r_dev_w", (0.95, 0.95, 0.3), (cx, cy, H + 0.15))
            box(bm, "r_dev_g", (0.98, 0.98, 0.04), (cx, cy, H - 0.01), bottom=True)
            box(bm, "r_dev_w", (0.95, 0.95, 0.02), (cx, cy, H - 0.04), bottom=True)
            for k in range(7):
                box(bm, "r_dev_g", (0.5, 0.025, 0.015), (cx, cy - 0.18 + k * 0.06, H - 0.055), bottom=True)
            for s in (-1, 1):
                box(bm, "r_dev_k", (0.62, 0.05, 0.012), (cx, cy + s * 0.4, H - 0.055), bottom=True)
                box(bm, "r_dev_k", (0.05, 0.62, 0.012), (cx + s * 0.4, cy, H - 0.055), bottom=True)
            # 侧面检修盖、冷媒管接口
            box(bm, "r_dev_g", (0.3, 0.02, 0.18), (cx + 0.2, cy + 0.48, H + 0.15))
            seg(bm, "r_chrome", (cx + 0.3, cy + 0.49, H + 0.2), (cx + 0.3, cy + 0.75, H + 0.2), 0.02, 8)
        return b

    make("AC-3205-01", ac(-2.2, 1.0))
    make("AC-3205-02", ac(2.3, 0.6))

    def light(cx, cy):
        def b(bm):
            box(bm, "r_dev_g", (0.62, 0.62, 0.05), (cx, cy, H - 0.02), bottom=True)
            box(bm, "r_panel_l", (0.58, 0.58, 0.01), (cx, cy, H - 0.05), bottom=True)
        return b

    for i, (cx, cy) in enumerate([(-3.8, -0.9), (-0.4, -0.6), (0.2, 2.4), (3.9, -1.0)], 1):
        make(f"LT-3205-0{i}", light(cx, cy))

    def smoke(bm):
        cyl(bm, "r_dev_w", 0.1, 0.05, (-0.9, 2.0, H - 0.05), seg=18)
        cyl(bm, "r_dev_w", 0.06, 0.03, (-0.9, 2.0, H - 0.08), seg=14)
        cyl(bm, "alarm_led", 0.012, 0.005, (-0.84, 2.0, H - 0.085), seg=6)

    make("SD-3205-01", smoke)

    def sprinklers(bm):
        for cx, cy in [(0.0, 0.8), (-3.0, 2.2), (3.0, 2.4), (-2.6, -2.0)]:
            seg(bm, "r_pipe_r", (cx, cy, H + 0.3), (cx, cy, H - 0.05), 0.02, 8)
            cyl(bm, "r_chrome", 0.035, 0.05, (cx, cy, H - 0.1), seg=10)
            cyl(bm, "r_pipe_r", 0.025, 0.04, (cx, cy, H - 0.14), seg=10)
            cyl(bm, "r_chrome", 0.05, 0.008, (cx, cy, H - 0.15), seg=12)

    make("SP-3205-01", sprinklers)

    def ap(bm):
        cyl(bm, "r_dev_w", 0.17, 0.045, (4.3, 1.8, H - 0.045), seg=24)
        cyl(bm, "r_led_g", 0.015, 0.005, (4.3, 1.8, H - 0.05), seg=6)

    make("AP-3205-01", ap)

    def cam(bm):
        cyl(bm, "r_dev_w", 0.11, 0.04, (5.4, 3.0, H - 0.04), seg=20)
        res = bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=0.085, matrix=Matrix.Translation((5.4, 3.0, H - 0.05)))
        for f in {f for v in res["verts"] for f in v.link_faces}:
            f.material_index = R["r_dev_k"] if f.calc_center_median().z < H - 0.05 else R["r_dev_w"]

    make("CAM-3205-01", cam)

    def th(bm):
        # 温湿度传感器：后墙右段，带小屏
        box(bm, "r_dev_w", (0.12, 0.03, 0.12), (4.6, Y1 - 0.02, 1.45))
        box(bm, "screen", (0.08, 0.005, 0.05), (4.6, Y1 - 0.037, 1.47))

    make("TH-3205-01", th)

    def lc(bm):
        # 灯光 / 场景控制面板
        box(bm, "r_dev_w", (0.09, 0.02, 0.18), (4.95, Y1 - 0.015, 1.3))
        for k in range(3):
            box(bm, "r_dev_g", (0.06, 0.005, 0.035), (4.95, Y1 - 0.027, 1.36 - k * 0.055))

    make("LC-3205-01", lc)

    def ps(bm):
        # 地插 / 墙插：后墙右段贴地
        box(bm, "r_dev_w", (0.36, 0.02, 0.1), (4.4, Y1 - 0.015, 0.3))
        for k in range(3):
            box(bm, "r_dev_k", (0.07, 0.005, 0.05), (4.29 + k * 0.11, Y1 - 0.027, 0.3))

    make("PS-3205-01", ps)

    def acr(bm):
        # 门禁读卡器：右墙玻璃门旁
        box(bm, "r_dev_k", (0.025, 0.09, 0.14), (X1 - 0.015, 1.05, 1.35))
        box(bm, "r_led_g", (0.005, 0.02, 0.02), (X1 - 0.03, 1.05, 1.4))

    make("ACR-3205", acr)

    def ds(bm):
        # 会议大屏（86 寸）：黑色边框 + 屏幕（屏面图像在 three.js 里叠一张城市画面）
        box(bm, "r_tv", (1.92, 0.06, 1.1), (1.0, Y1 - 0.12, 1.55))
        box(bm, "r_tv_scr", (1.86, 0.005, 1.04), (1.0, Y1 - 0.153, 1.55))

    make("DS-3205-01", ds)
    return out


def plenum(M, col, loc):
    """吊顶内：两台空调的黑色软风管通到后墙主风管、红色喷淋管网"""
    bm = bmesh.new()
    zt = H + 0.55
    seg(bm, "r_duct", (X0 + 0.6, Y1 - 0.5, zt), (X1 - 0.6, Y1 - 0.5, zt), 0.18, 16)
    for cx, cy in ((-2.2, 1.0), (2.3, 0.6)):
        seg(bm, "r_duct", (cx, cy + 0.3, H + 0.3), (cx, cy + 0.3, zt), 0.11, 12)
        seg(bm, "r_duct", (cx, cy + 0.3, zt), (cx, Y1 - 0.5, zt), 0.11, 12)
        cyl(bm, "r_duct", 0.13, 0.04, (cx, cy + 0.3, H + 0.3), seg=12)
    # 喷淋管：一根主管 + 支管接到各喷头
    zp = H + 0.3
    seg(bm, "r_pipe_r", (X0 + 0.8, 1.4, zp), (X1 - 0.8, 1.4, zp), 0.04, 10)
    for cx, cy in [(0.0, 0.8), (-3.0, 2.2), (3.0, 2.4), (-2.6, -2.0)]:
        seg(bm, "r_pipe_r", (cx, 1.4, zp), (cx, cy, zp), 0.025, 8)
    return _new("plenum", bm, M, col, loc)


# ---------------------------------------------------------------- 主体


def build(M, col, loc):
    bm = bmesh.new()  # 地面 + 墙：烘贴图
    bv = bmesh.new()  # 家具等：烘顶点色
    bg = bmesh.new()  # 玻璃
    bb = bmesh.new()  # 只参与烘焙的光源与吊顶
    ring = outline()

    # ---- 地面（地毯）+ 楼板外沿（前沿、圆角外侧露出的楼板厚边与 0.5 m 挑檐）
    lib.add_poly(bm, ring, 0.0, R["r_carpet"])
    lib.add_band(bv, ring, -0.45, 0.0, R["r_slab"])
    # ---- 墙：后墙（白板段灰泥、格栅段深色背板、右段灰泥）、右墙（灰泥，玻璃门洞）
    wall_quad(bm, "r_plaster", (X0, Y1), (-1.6, Y1), 0.0, H, (0, 0))
    wall_quad(bm, "r_slat_bk", (-1.6, Y1), (3.6, Y1), 0.0, H, (0, 0))
    wall_quad(bm, "r_plaster", (3.6, Y1), (X1, Y1), 0.0, H, (0, 0))
    wall_quad(bm, "r_plaster", (X1, Y0), (X1, 1.4), 0.0, H, (0, 0))
    wall_quad(bm, "r_plaster", (X1, 1.4), (X1, 3.0), 2.25, H, (0, 0))  # 门楣
    wall_quad(bm, "r_plaster", (X1, 3.0), (X1, Y1), 0.0, H, (0, 0))
    # 踢脚线
    for p, q in (((X0, Y1 - 0.01), (X1, Y1 - 0.01)), ((X1 - 0.01, Y0), (X1 - 0.01, 1.4)), ((X1 - 0.01, 3.0), (X1 - 0.01, Y1))):
        L = math.dist(p, q)
        box(bv, "r_frame", (L if p[1] == q[1] else 0.02, 0.02 if p[1] == q[1] else L, 0.08), ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, 0.04))

    # ---- 木格栅：0.04 宽、0.06 深，间距 0.085；顶部洗墙灯带（只参与烘焙）
    x = -1.55
    while x < 3.56:
        box(bv, "r_slat", (0.04, 0.06, H - 0.02), (x, Y1 - 0.04, H / 2))
        x += 0.085
    box(bb, "r_wash", (5.1, 0.05, 0.02), (1.0, Y1 - 0.2, H - 0.03), bottom=True)

    # ---- 白板（铝框 + 白色板面 + 笔槽）
    box(bv, "r_chrome", (2.3, 0.03, 1.3), (-3.4, Y1 - 0.02, 1.55))
    box(bv, "r_board", (2.24, 0.01, 1.24), (-3.4, Y1 - 0.04, 1.55))
    box(bv, "r_chrome", (0.8, 0.07, 0.03), (-3.0, Y1 - 0.06, 0.92))
    box(bv, "r_frame", (0.14, 0.03, 0.02), (-2.9, Y1 - 0.07, 0.95))

    # ---- 边柜 + 柜上物件、大屏下方的条形音箱
    box(bv, "r_table", (4.2, 0.5, 0.7), (1.0, Y1 - 0.3, 0.35))
    for k in range(4):
        box(bv, "r_slat_bk", (0.005, 0.01, 0.6), (-0.05 + k * 1.05, Y1 - 0.556, 0.35))
    box(bv, "r_tv", (1.1, 0.1, 0.07), (1.0, Y1 - 0.2, 0.92))
    box(bv, "r_frame", (0.35, 0.25, 0.06), (-0.4, Y1 - 0.3, 0.73))
    box(bv, "r_frame", (0.3, 0.22, 0.04), (-0.4, Y1 - 0.3, 0.78))
    plant(bv, 2.75, Y1 - 0.3, False, 0.7)

    # ---- 会议桌：圆角长桌（4.8 × 1.5），桌面厚 5 cm、深色桌裙、两只方柱桌脚、中间线盒 + 绿植
    top = rounded_rect(0.2, 0.2, 4.8, 1.5, 0.7, 10)
    lib.add_poly(bv, top, 0.76, R["r_table"])
    lib.add_band(bv, top, 0.71, 0.76, R["r_table"])
    lib.add_poly(bv, top, 0.71, R["r_slat_bk"], down=True)
    for dx in (-1.4, 1.4):
        box(bv, "r_frame", (0.3, 0.6, 0.7), (0.2 + dx, 0.2, 0.36))
    box(bv, "r_tv", (0.7, 0.24, 0.015), (0.2, 0.2, 0.77))
    plant(bv, 0.2, 0.2, False, 0.77)
    # 10 把班椅：长边各 4 把、两端各 1 把，略带随机转角
    rnd = random.Random(3205)
    for k in range(4):
        x = 0.2 - 1.65 + k * 1.1
        for s in (-1, 1):
            j = rnd.uniform(-0.18, 0.18)
            chair(bv, x + rnd.uniform(-0.1, 0.1), 0.2 + s * (0.95 + rnd.uniform(0, 0.12)), -s * math.pi / 2 + j)
    chair(bv, 0.2 - 3.0, 0.2, 0.0)
    chair(bv, 0.2 + 3.0, 0.2, math.pi)

    # ---- 绿植：左后角大盆、玻璃门外走廊
    plant(bv, X0 + 0.7, Y1 - 0.7, True)

    # ---- 幕墙：竖梃（1.5 m 一档）+ 顶 / 底横框 + 玻璃
    path = facade_path()
    for i in range(len(path) - 1):
        p, q = path[i], path[i + 1]
        L = math.dist(p, q)
        n = max(1, round(L / 1.5)) if i == 0 else 1
        for k in range(n + 1 if i == 0 else 1):
            t = k / n
            mx, my = p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t
            if i == 0 or (i % 3 == 0):
                box(bv, "r_frame", (0.06, 0.06, H), (mx, my, H / 2))
        for z0, z1 in ((0.0, 0.08), (H - 0.08, H)):
            beam(bv, "r_frame", (p[0], p[1], (z0 + z1) / 2), (q[0], q[1], (z0 + z1) / 2), 0.06, z1 - z0)
        v = [Vector((p[0], p[1], 0.08)), Vector((q[0], q[1], 0.08)), Vector((q[0], q[1], H - 0.08)), Vector((p[0], p[1], H - 0.08))]
        f = bg.faces.new([bg.verts.new(c) for c in v])
        f.material_index = 0
    box(bv, "r_frame", (0.06, 0.06, H), (path[-1][0], path[-1][1], H / 2))

    # ---- 玻璃门（右墙 y 1.4～3.0）：门框 + 拉手 + 玻璃；门外一段亮着的走廊
    for yy in (1.4, 3.0):
        box(bv, "r_frame", (0.12, 0.06, 2.25), (X1, yy, 1.125))
    box(bv, "r_frame", (0.12, 1.66, 0.06), (X1, 2.2, 2.25))
    box(bv, "r_frame", (0.04, 0.03, 0.03), (X1 - 0.03, 2.2, 0.02))
    beam(bv, "r_chrome", (X1 - 0.06, 2.85, 0.75), (X1 - 0.06, 2.85, 1.45), 0.025, 0.025)
    v = [Vector((X1, 1.43, 0.02)), Vector((X1, 2.97, 0.02)), Vector((X1, 2.97, 2.22)), Vector((X1, 1.43, 2.22))]
    bg.faces.new([bg.verts.new(c) for c in v])
    # 走廊：门外 1.8 m 进深的一段（地面石材 + 对面墙 + 前后两道端墙围起来，从房间外看是一个实体盒子，不是悬空的地面）
    cx0, cx1, cy0, cy1 = X1, X1 + 1.8, 0.6, Y1
    lib.add_poly(bv, [(cx0, cy0), (cx1, cy0), (cx1, cy1), (cx0, cy1)], 0.0, R["r_corr_fl"])
    wall_quad(bv, "r_plaster", (cx1, cy0), (cx1, cy1), 0.0, H, (X1, 2.0))
    for yy in (cy0, cy1):
        box(bv, "r_slab", (cx1 - cx0 + 0.1, 0.12, H), ((cx0 + cx1) / 2, yy, H / 2))
    lib.add_band(bv, [(cx0, cy0), (cx1, cy0), (cx1, cy1), (cx0, cy1)], -0.45, 0.0, R["r_slab"])
    plant(bv, cx1 - 0.45, 2.7, True)
    box(bb, "r_corr_lt", (1.0, 0.3, 0.02), ((cx0 + cx1) / 2, 2.2, H - 0.02), bottom=True)

    # ---- 只参与烘焙：吊顶（朝下）、筒灯（大屏前、桌子上方）、窗外城市光面
    lib.add_poly(bb, ring, H, R["r_ceil"], down=True)
    for cx, cy in [(-1.4, 2.9), (1.0, 2.9), (3.4, 2.9), (-1.6, 0.2), (0.2, 0.2), (2.0, 0.2), (-3.6, 2.4), (4.6, 2.4)]:
        pts = [(cx + 0.08 * math.cos(k * math.pi / 6), cy + 0.08 * math.sin(k * math.pi / 6)) for k in range(12)]
        lib.add_poly(bb, pts, H - 0.02, R["r_down"], down=True)
    for k in range(5):
        y = Y1 - k * 2.2
        v = [Vector((X0 - 8, y, -2)), Vector((X0 - 8, y - 2.2, -2)), Vector((X0 - 8, y - 2.2, 6)), Vector((X0 - 8, y, 6))]
        f = bb.faces.new([bb.verts.new(c) for c in v])
        f.material_index = R["r_city"]
        f.normal_update()
        if f.normal.x < 0:
            f.normal_flip()

    ob = lib.new_object("room", bm, M, col)
    ov = lib.new_object("room_v", bv, M, col)
    og = lib.new_object("glass", bg, M, col)
    obk = lib.new_object("room_bakeonly", bb, M, col)
    for o in (ob, ov, og, obk):
        o.location = loc
    return ob, ov, og, obk


LOC = (0.0, -3000.0, 0.0)  # 远离楼宇级 / 楼层级对象，烘焙互不干扰


def run():
    """建模（只替换房间级对象，集合 ROOM）"""
    from . import build as B

    importlib.reload(lib)
    importlib.reload(floors)
    col = lib.collection("ROOM")
    for ob in list(col.objects):
        me = ob.data
        bpy.data.objects.remove(ob, do_unlink=True)
        if me and me.users == 0:
            bpy.data.meshes.remove(me)
    M = _materials()
    R.clear()
    R.update({m.name[3:]: i for i, m in enumerate(M)})
    _carpet_texture()
    ob, ov, og, obk = build(M, col, LOC)
    devs = devices(M, col, LOC)
    pl = plenum(M, col, LOC)
    B.unwrap(ob)
    ov.data.color_attributes.new("Bake", "FLOAT_COLOR", "CORNER")
    ov.data.color_attributes.active_color = ov.data.color_attributes["Bake"]
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(MODEL_DIR, "tower.blend"))
    return {"room": len(ob.data.polygons), "room_v": len(ov.data.polygons), "devices": [d.name for d in devs], "plenum": len(pl.data.polygons)}


def bake(size=4096, samples=256, vertex_samples=1024):
    """地面 / 墙烘贴图（浮点 → OIDN → 色调映射），家具烘顶点色；只渲染房间级对象（玻璃不参与，免得挡住窗外光）"""
    from . import bake as K
    from . import detail as DT

    K._setup(samples)
    col = bpy.data.collections["ROOM"]
    ob, ov, og = bpy.data.objects["room"], bpy.data.objects["room_v"], bpy.data.objects["glass"]
    t = time.time()
    for o in bpy.data.objects:
        o.hide_render = not (o.name in col.objects and o is not og)
    bpy.context.scene.cycles.samples = samples
    DT._bake_raw(ob, size)
    K.denoise(os.path.join(K.BAKE_DIR, "room_raw.exr"), os.path.join(K.BAKE_DIR, "room_dn.exr"), "OPEN_EXR")
    bpy.context.scene.cycles.samples = vertex_samples
    K._bake_vertex(ov)
    for o in bpy.data.objects:
        o.hide_render = False
    tonemap()
    bpy.ops.wm.save_mainfile()
    return round(time.time() - t, 1)


def tonemap(k=None):
    """room_dn.exr → 色调映射 → room.png（同 detail.tonemap）"""
    import numpy as np

    from . import bake as K
    from . import detail as DT

    k = EXPOSURE if k is None else k
    src = bpy.data.images.load(os.path.join(K.BAKE_DIR, "room_dn.exr"), check_existing=False)
    w, h = src.size
    px = np.empty(w * h * 4, dtype=np.float32)
    src.pixels.foreach_get(px)
    bpy.data.images.remove(src)
    px = px.reshape(-1, 4)
    c = DT._tone(px[:, :3], k)
    c = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)
    px[:, :3] = c
    px[:, 3] = 1.0
    out = bpy.data.images.new("TM_room", w, h, alpha=False)
    out.pixels.foreach_set(px.ravel())
    out.filepath_raw = os.path.join(K.BAKE_DIR, "room.png")
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)


def export():
    """public/building/room.glb：room（贴图）、room_v（顶点色）、glass、plenum 与 dev_*（带原材质，三维里实时光照）"""
    from . import detail as DT
    from . import export as E

    col = bpy.data.collections["ROOM"]
    copies = []
    # 先取快照：循环里会往同一个集合加副本，直接遍历 col.objects 会无限复制下去
    for ob in list(col.objects):
        if ob.name == "room_bakeonly":
            continue
        me = ob.data.copy()
        if ob.name in ("room", "room_v"):
            for p in me.polygons:
                p.material_index = 0
            me.materials.clear()
            if ob.name == "room_v":
                me.materials.append(E._vertex_material())
                DT._tone_colors(me, EXPOSURE)
            else:
                me.materials.append(E._baked_material(ob))
        cp = bpy.data.objects.new(ob.name, me)
        cp.location = (0, 0, 0)
        col.objects.link(cp)
        copies.append((ob, cp))
    # 原对象先改名让出名字，导出后恢复
    for ob, cp in copies:
        nm = ob.name
        ob.name = nm + "__src"
        cp.name = nm
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for _, cp in copies:
        cp.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_normals=True,
        export_lights=False,
        export_cameras=False,
        export_extras=False,
        export_image_format="WEBP",
        export_image_quality=90,
        export_materials="EXPORT",
        export_meshopt_compression_enable=True,
        export_draco_mesh_compression_enable=False,
    )
    for ob, cp in copies:
        me = cp.data
        nm = cp.name
        bpy.data.objects.remove(cp, do_unlink=True)
        bpy.data.meshes.remove(me)
        ob.name = nm
    return round(os.path.getsize(OUT) / 1024 / 1024, 2)

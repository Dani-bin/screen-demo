"""
井上地面输送 · 103 原煤上仓带式输送机机头（栈桥剖切）· 按尺寸建模
----------------------------------------------------------
还原基准：docs/design/coal-prep/design/final.png（中央概念图 concept-r3）。真实尺度，单位米。
坐标见 lib.py：x 沿皮带指向机头（1# 驱动滚筒轴线 x = 0），y 指向驱动侧，z 向上；里程 m ↔ x = −m。

对象命名（three.js 按名字驱动 / 拾取，改名要同步改 src/views/coal-prep/scene）：
  BC103-P1 / BC103-P2      1# / 2# 驱动滚筒（原点在轴线中点，绕 y 轴转）
  BC103-belt               输送带（承载段 + 绕滚筒 + 回程段，UV 的 u = 沿带长米数 / 2，页面按带速滚动）
  BC103-coal               承载段上的煤（UV 的 u = x / 1.2，同速滚动）
  BC103-fiber              光纤测温条（UV 的 u = 里程 / 248，页面用温度贴图着色）
  BC103-M1 / M2 / G1 / G2  电机 / 减速机根节点（M1、G1 驱动 2# 滚筒，M2、G2 驱动 1# 滚筒）
  BC103-D1                 1# 滚筒两端轴承座
  VT-103-01…05             温振传感器白盒（M1、M2、G1、G2、D1）
  ES-103-01                机头急停按钮盒
  IDL_<组号>               承载托辊组（第 1 组离机头 1.0 m，之后每 1.2 m 一组）；3 组过渡托辊单独建模，其余关联复制
  RB01                     吊轨巡检机器人根节点（页面按里程改 x）
  STRUCT_* / BG_*          静态结构与远景（烘焙光照）
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import lib

# ---------------------------------------------------------------- 尺寸（与 src/views/coal-prep/scene/theme.js 的 BELT 一致）

L_MODEL = 110.0  # 建模长度（m）；再往后镜头看不到
B = 1.4  # 带宽
C_HALF = 0.27  # 中托辊半长（中间平段半宽）
W_WING = B / 2 - C_HALF  # 输送带单侧翼宽
ROLLER_R = 0.0665  # 托辊半径（φ133）
BELT_T = 0.018  # 带厚
PITCH = 1.2  # 上托辊组间距
RET_PITCH = 3.0  # 回程托辊间距
P1 = (0.0, 1.40, 0.45)  # 1# 驱动滚筒（x, z, r）
P2 = (-1.7, 0.52, 0.41)  # 2# 驱动滚筒（在 1# 后下方）
FACE = 1.6  # 滚筒面宽
G1_X, G1_Z = -1.15, 2.05  # 2# 驱动组（G1 / M1）轴线位置：定稿像素按主机位反投影约 x −0.9、z 2.1
G1_DECK = 1.25  # 2# 驱动组的抬高平台
WALK_Z = 0.60  # 巡检通道地面
WALK_Y0, WALK_Y1 = -1.10, -2.10  # 通道内沿 / 外沿
STR_Y = 0.95  # 纵梁 y
COL_YN, COL_YF = -2.7, 4.6  # 栈桥柱（近侧 / 远侧）；远侧让出驱动部（电机风罩到 y ≈ 4.15）
ROOF_Z = 3.6  # 栈桥屋面梁底（通道净高约 3 m）
GROUND_Z = -8.0
CAM_XY = (5.32, -6.30)  # 主机位相机的平面位置（远景按它摆，见 scripts/coal-prep/compose_camera.py）
YARD_Z = -34.0  # 远处厂区地面：103 是上仓皮带，机头在高处，筒仓坐落在低处的厂区（定稿里筒仓底部压在地平线以下）
RET_Z = 0.93  # 回程带上表面
GROUPS = int(L_MODEL / PITCH)

# 机头过渡段：x → (带面中心高度, 槽角°)；第 1–3 组托辊跟着它抬高、变平
# 托辊组 g 的位置：x = −(1.0 + 1.2 (g − 1))（第 1 组离机头 1.0 m；按定稿概念图反求的结果）
TRANSITION = [(-1e9, 1.3665 + BELT_T, 35), (-4.6, 1.3665 + BELT_T, 35), (-3.4, 1.45, 28), (-2.2, 1.56, 18), (-1.0, 1.70, 8), (0.0, P1[1] + P1[2] + BELT_T, 0)]


def carry_at(x):
    """承载段在 x 处的带面中心高度（上表面）与槽角（度）"""
    for (x0, z0, a0), (x1, z1, a1) in zip(TRANSITION, TRANSITION[1:]):
        if x0 <= x <= x1:
            k = 0 if x1 - x0 > 1e6 else (x - x0) / (x1 - x0)
            k = k * k * (3 - 2 * k)  # 平滑过渡
            return z0 + (z1 - z0) * k, a0 + (a1 - a0) * k
    return TRANSITION[-1][1], 0


def trough_point(y_rel, a_deg):
    """槽形断面：横向坐标 y_rel（−B/2..B/2）处带面相对中心的高度"""
    a = math.radians(a_deg)
    s = abs(y_rel)
    if s <= C_HALF:
        return y_rel, 0.0
    w = s - C_HALF
    return math.copysign(C_HALF + w * math.cos(a), y_rel), w * math.sin(a)


# ---------------------------------------------------------------- 小工具


def add_cyl_between(bm, p0, p1, r, seg=16, mat=0):
    """两点之间的圆柱（托辊、斜撑钢管、吊杆）"""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    tmp = bmesh.new()
    bmesh.ops.create_cone(tmp, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r, depth=d.length)
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(tmp, matrix=Matrix.Translation((p0 + p1) / 2) @ rot, verts=tmp.verts)
    for f in tmp.faces:
        f.material_index = mat
        f.smooth = True
    return lib._merge(bm, tmp)


def add_beam(bm, p0, p1, w=0.2, h=0.2, mat=0):
    """两点之间的方钢 / 型钢（截面 w × h），用于柱、梁、斜撑"""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    tmp = bmesh.new()
    bmesh.ops.create_cube(tmp, size=1.0)
    bmesh.ops.scale(tmp, vec=(w, h, d.length), verts=tmp.verts)
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(tmp, matrix=Matrix.Translation((p0 + p1) / 2) @ rot, verts=tmp.verts)
    for f in tmp.faces:
        f.material_index = mat
    return lib._merge(bm, tmp)


def add_hbeam(bm, p0, p1, size=0.25, mat=0):
    """H 型钢：两块翼缘 + 腹板（截面 size × size），沿 p0→p1"""
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0).normalized()
    side = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    u = d.cross(side).normalized()
    t = size * 0.08
    for s in (-1, 1):
        off = u * (s * (size / 2 - t / 2))
        add_beam(bm, p0 + off, p1 + off, w=t if abs(d.z) > 0.9 else size, h=size if abs(d.z) > 0.9 else t, mat=mat)
    add_beam(bm, p0, p1, w=size * 0.06 if abs(d.z) > 0.9 else size * 0.9, h=size * 0.9 if abs(d.z) > 0.9 else size * 0.06, mat=mat)


def drum(name, x, z, r, face, col, M, rot_axis_parts=True):
    """驱动滚筒：包胶筒面（UV：u 绕圆周、v 沿面宽）+ 端板 + 轮毂 + 轴；原点在轴线中点"""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.verify()
    seg = 64
    rings = []
    for j, y in enumerate((-face / 2, face / 2)):
        rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / seg), y, r * math.sin(2 * math.pi * i / seg))) for i in range(seg)])
    for i in range(seg):
        a, b = rings[0], rings[1]
        f = bm.faces.new((a[i], a[(i + 1) % seg], b[(i + 1) % seg], b[i]))
        f.material_index = 0
        f.smooth = True
        for l, (u, v) in zip(f.loops, ((i / seg, 0), ((i + 1) / seg, 0), ((i + 1) / seg, 1), (i / seg, 1))):
            l[uv].uv = (u * 4, v * 2)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # 端板（钢）、轮毂、轴
    for s in (-1, 1):
        lib.add_cyl(bm, r * 0.985, 0.03, center=(0, s * (face / 2 + 0.012), 0), seg=48, mat=1, axis="Y")
        lib.add_cyl(bm, r * 0.35, 0.12, center=(0, s * (face / 2 + 0.07), 0), seg=24, mat=1, axis="Y")
    lib.add_cyl(bm, 0.085, face + 0.9 + (0.55 if name.endswith("P1") else 0.35), center=(0, 0.42 if name.endswith("P1") else 0.32, 0), seg=20, mat=2, axis="Y")
    ob = lib.new_object(name, bm, [M["lagging"], M["galv"], M["shaft"]], col, smooth_angle=40)
    ob.location = (x, 0, z)
    return ob


# ---------------------------------------------------------------- 托辊组


def idler_mesh(name, M, trough=35, z_center_top=1.3665):
    """一组承载托辊（三节槽形）：托辊 + 底横梁 + 立架；原点在 x = 0（局部），y 居中"""
    bm = bmesh.new()
    a = math.radians(trough)
    zc = z_center_top - ROLLER_R  # 中辊轴线高度
    # 中辊
    add_cyl_between(bm, (0, -C_HALF + 0.01, zc), (0, C_HALF - 0.01, zc), ROLLER_R, seg=14, mat=0)
    # 两侧翼辊：内端略高于中辊端点，按槽角倾斜
    for s in (-1, 1):
        p0 = Vector((0, s * (C_HALF + 0.03), zc + 0.02))
        p1 = p0 + Vector((0, s * math.cos(a), math.sin(a))) * (W_WING + 0.08)
        add_cyl_between(bm, p0, p1, ROLLER_R, seg=14, mat=0)
        # 外立架（翼辊外端支点）+ 内立架
        tip = p1 + Vector((0, s * 0.04, 0))
        add_beam(bm, (0, tip.y, 1.10), (0, tip.y, tip.z + 0.06), w=0.07, h=0.012, mat=1)
        add_beam(bm, (0, s * (C_HALF + 0.015), 1.10), (0, s * (C_HALF + 0.015), zc + 0.03), w=0.07, h=0.012, mat=1)
    add_beam(bm, (0, -STR_Y - 0.05, 1.10), (0, STR_Y + 0.05, 1.10), w=0.07, h=0.05, mat=1)
    return lib.make_mesh(name, bm, [M["roller"], M["galv"]], smooth_angle=45)


def return_idler_mesh(M):
    """回程平托辊 + 两侧吊架（挂在纵梁下）"""
    bm = bmesh.new()
    zc = RET_Z - ROLLER_R
    add_cyl_between(bm, (0, -0.78, zc), (0, 0.78, zc), ROLLER_R, seg=14, mat=0)
    for s in (-1, 1):
        add_beam(bm, (0, s * 0.84, zc), (0, s * 0.84, 1.0), w=0.06, h=0.01, mat=1)
    return lib.make_mesh("ME_idler_ret", bm, [M["roller"], M["galv"]], smooth_angle=45)


def build_idlers(col, M):
    std = idler_mesh("ME_idler_std", M)
    for g in range(1, GROUPS + 1):
        x = -(1.0 + (g - 1) * PITCH)
        name = f"IDL_{g:03d}"
        if x > -4.0:
            # 机头过渡段：托辊按带面高度抬高、槽角变小（单独网格）
            z, a = carry_at(x)
            me = idler_mesh(f"ME_idler_tr{g}", M, trough=a, z_center_top=z - BELT_T)
            lib.place(me, name, col, loc=(x, 0, 0))
        else:
            lib.place(std, name, col, loc=(x, 0, 0))
    ret = return_idler_mesh(M)
    n = 0
    x = -2.6
    while x > -L_MODEL:
        n += 1
        lib.place(ret, f"IDLR_{n:03d}", col, loc=(x, 0, 0))
        x -= RET_PITCH
    return GROUPS


# ---------------------------------------------------------------- 输送带与煤


def _strip_faces(bm, rows, uv, uvs, mat):
    """相邻两排顶点连成四边形条带（rows[i][j] 为 BMVert，uvs[i][j] 为 (u, v)）"""
    for i in range(len(rows) - 1):
        for j in range(len(rows[i]) - 1):
            vs = (rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1])
            f = bm.faces.new(vs)
            f.material_index = mat
            f.smooth = True
            for l, (a, b) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                l[uv].uv = uvs[a][b]


def build_belt(col, M):
    """输送带：槽形承载段 → 绕 1# 滚筒 → 绕 2# 滚筒 → 平的回程段；一整条，UV 的 u 连续（米 / 2）"""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.verify()
    ny = 13
    ys = [-B / 2 + B * j / (ny - 1) for j in range(ny)]

    # 承载段 x 采样：远处稀、机头密
    xs = []
    x = -L_MODEL
    while x < 0:
        xs.append(x)
        x += 1.2 if x < -12 else 0.3 if x < -5 else 0.1
    xs.append(0.0)
    top, bot, uvt, uvb = [], [], [], []
    s = 0.0
    prev = None
    for x in xs:
        zc, a = carry_at(x)
        if prev is not None:
            s += math.hypot(x - prev[0], zc - prev[1])
        prev = (x, zc)
        rt, rb, ut, ub = [], [], [], []
        for y in ys:
            yy, dz = trough_point(y, a)
            rt.append(bm.verts.new((x, yy, zc + dz)))
            rb.append(bm.verts.new((x, yy, zc + dz - BELT_T)))
            ut.append((s / 2, (y + B / 2) / B))
            ub.append((s / 2, (y + B / 2) / B))
        top.append(rt)
        bot.append(list(reversed(rb)))
        uvt.append(ut)
        uvb.append(list(reversed(ub)))
    _strip_faces(bm, top, uv, uvt, 0)
    _strip_faces(bm, bot, uv, uvb, 0)
    s_carry = s

    # 绕滚筒 + 回程：一条平带，路径为折线（圆弧离散）
    path = []
    R1 = P1[2] + BELT_T / 2
    for k in range(0, 36):
        th = math.radians(90 - k * 6)  # 1# 滚筒：顶 → 前 → 底 → 后下方（−120°）
        if th < math.radians(-120):
            break
        path.append((P1[0] + R1 * math.cos(th), P1[1] + R1 * math.sin(th)))
    R2 = P2[2] + BELT_T / 2
    for k in range(0, 60):
        th = math.radians(0 - k * 6)  # 2# 滚筒：前 → 底 → 后 → 顶（−270°）
        if th < math.radians(-270):
            break
        path.append((P2[0] + R2 * math.cos(th), P2[1] + R2 * math.sin(th)))
    path.append((P2[0] - 0.3, RET_Z + BELT_T / 2))
    x = P2[0] - 3
    while x > -L_MODEL:
        path.append((x, RET_Z + BELT_T / 2))
        x -= 6
    path.append((-L_MODEL, RET_Z + BELT_T / 2))
    rows_a, rows_b, uva, uvb2 = [], [], [], []
    s = s_carry
    for i, (px, pz) in enumerate(path):
        if i:
            s += math.hypot(px - path[i - 1][0], pz - path[i - 1][1])
        # 法线：相邻点切线转 90°（带面朝外）
        p_prev = path[max(i - 1, 0)]
        p_next = path[min(i + 1, len(path) - 1)]
        tx, tz = p_next[0] - p_prev[0], p_next[1] - p_prev[1]
        ln = math.hypot(tx, tz) or 1
        nx, nz = tz / ln, -tx / ln
        ra, rb, ua, ub = [], [], [], []
        for y in (ys[0], ys[-1]):
            ra.append(bm.verts.new((px + nx * BELT_T / 2, y, pz + nz * BELT_T / 2)))
            rb.append(bm.verts.new((px - nx * BELT_T / 2, y, pz - nz * BELT_T / 2)))
            ua.append((s / 2, (y + B / 2) / B))
            ub.append((s / 2, (y + B / 2) / B))
        rows_a.append(ra)
        rows_b.append(list(reversed(rb)))
        uva.append(ua)
        uvb2.append(list(reversed(ub)))
    _strip_faces(bm, rows_a, uv, uva, 0)
    _strip_faces(bm, rows_b, uv, uvb2, 0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = lib.new_object("BC103-belt", bm, [M["belt"]], col)
    ob.data.polygons.foreach_set("use_smooth", [True] * len(ob.data.polygons))
    return ob


def build_coal(col, M):
    """承载段上的煤：抛物线堆积断面，沿带面走到机头滚筒顶点前收尖"""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.verify()
    half = 0.56
    ny = 19
    xs = []
    x = -L_MODEL
    while x < 0.05:
        xs.append(x)
        x += 0.6 if x < -12 else 0.2 if x < -5 else 0.05
    rows, uvs = [], []
    rs = __import__("random").Random(3)
    for x in xs:
        zc, a = carry_at(x)
        taper = min(1.0, max(0.0, (0.1 - x) / 1.2))  # 机头前 1.2 m 内堆高收到 0
        row, ur = [], []
        for j in range(ny):
            y = -half + 2 * half * j / (ny - 1)
            yy, dz = trough_point(y, a)
            hgt = 0.24 * max(0.0, 1 - (y / half) ** 2) ** 0.6 * taper
            # 堆积面不规则起伏（固定种子），边缘贴合带面
            hgt += (rs.random() - 0.5) * 0.06 * (1 - abs(y) / half) * taper
            row.append(bm.verts.new((x, yy, zc + dz + max(0.002, hgt))))
            ur.append((x / 1.2, (y + half) / (2 * half)))
        rows.append(row)
        uvs.append(ur)
    _strip_faces(bm, rows, uv, uvs, 0)
    ob = lib.new_object("BC103-coal", bm, [M["coal"]], col)
    ob.data.polygons.foreach_set("use_smooth", [True] * len(ob.data.polygons))
    return ob


# ---------------------------------------------------------------- 驱动部


def _motor(name, col, M, center, length=0.9, r=0.36, sensor=None):
    """电机：机壳 + 散热筋 + 端盖 + 风罩 + 接线盒 + 底脚；轴线沿 y，风罩朝 +y"""
    root = lib.empty(name, col, loc=center)
    bm = bmesh.new()
    lib.add_cyl(bm, r, length, center=(0, 0, 0), seg=40, mat=0, axis="Y")
    for i in range(20):
        a = 2 * math.pi * i / 20
        if math.sin(a) < -0.5:
            continue  # 底部不放散热筋（底脚位置）
        faces = lib.add_box(bm, (0.03, length * 0.86, 0.06), center=(0, 0, 0), mat=0)
        verts = list({v for face in faces for v in face.verts})
        bmesh.ops.translate(bm, vec=(0, 0, r + 0.02), verts=verts)
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(a - math.pi / 2, 3, "Y"), verts=verts)
    lib.add_cyl(bm, r * 0.92, 0.08, center=(0, -length / 2 - 0.04, 0), seg=40, mat=0, axis="Y")  # 前端盖
    lib.add_cyl(bm, r * 0.95, 0.2, center=(0, length / 2 + 0.1, 0), seg=40, mat=1, axis="Y")  # 风罩
    lib.add_box(bm, (0.26, 0.3, 0.16), center=(0, -0.05, r + 0.1), bevel=0.01, mat=0)  # 接线盒
    for s in (-1, 1):
        lib.add_box(bm, (0.12, length * 0.7, 0.2), center=(s * r * 0.62, 0, -r - 0.02), mat=0)
    lib.add_box(bm, (r * 1.8, length * 0.95, 0.05), center=(0, 0, -r - 0.12), mat=1)
    ob = lib.new_object(name + "_body", bm, [M["motor"], M["steel"]], col, smooth_angle=35)
    ob.parent = root
    if sensor:
        sb = bmesh.new()
        lib.add_box(sb, (0.12, 0.1, 0.14), center=(0, 0, 0), bevel=0.008, mat=0)
        so = lib.new_object(sensor, sb, [M["sensor"]], col)
        so.parent = root
        so.location = (0.0, length * 0.2, r + 0.26)
    return root


def _reducer(name, col, M, center, sensor=None):
    """减速机：铸件箱体（带加强筋、观察盖、底座），输出轴朝 −y、输入轴朝 +y"""
    root = lib.empty(name, col, loc=center)
    bm = bmesh.new()
    lib.add_box(bm, (1.05, 0.66, 0.92), center=(0, 0, 0), bevel=0.04, segments=2, mat=0)
    lib.add_box(bm, (0.7, 0.66, 0.08), center=(0, 0, 0.36), bevel=0.01, mat=0)  # 剖分面法兰
    for x in (-0.3, 0, 0.3):
        lib.add_box(bm, (0.04, 0.66, 0.7), center=(x, 0, -0.02), mat=0)  # 竖筋
    lib.add_box(bm, (0.4, 0.3, 0.05), center=(-0.1, 0, 0.43), bevel=0.01, mat=0)  # 观察盖
    lib.add_cyl(bm, 0.16, 0.16, center=(0, -0.38, 0), seg=24, mat=0, axis="Y")  # 输出轴承盖
    lib.add_cyl(bm, 0.09, 0.2, center=(0, 0.4, 0), seg=20, mat=0, axis="Y")  # 输入轴承盖
    lib.add_box(bm, (1.1, 0.8, 0.12), center=(0, 0, -0.46), mat=1)  # 底座
    ob = lib.new_object(name + "_body", bm, [M["reducer"], M["steel"]], col, smooth_angle=35)
    ob.parent = root
    if sensor:
        sb = bmesh.new()
        lib.add_box(sb, (0.1, 0.12, 0.14), center=(0, 0, 0), bevel=0.008, mat=0)
        so = lib.new_object(sensor, sb, [M["sensor"]], col)
        so.parent = root
        so.location = (0.52, 0.0, 0.1)
    return root


def _coupling(name, col, M, center):
    """联轴器 + 黄色护罩（静止件）"""
    bm = bmesh.new()
    lib.add_cyl(bm, 0.4, 0.5, center=(0, 0, 0), seg=40, mat=0, axis="Y")
    lib.add_cyl(bm, 0.43, 0.06, center=(0, -0.22, 0), seg=40, mat=0, axis="Y")  # 护罩两端翻边
    lib.add_cyl(bm, 0.43, 0.06, center=(0, 0.22, 0), seg=40, mat=0, axis="Y")
    lib.add_cyl(bm, 0.2, 0.4, center=(0, 0, -0.3), seg=8, mat=1, axis="Z")  # 护罩支座
    ob = lib.new_object(name, bm, [M["yellow"], M["steel"]], col, smooth_angle=40)
    ob.location = center
    return ob


def build_drive(col, M):
    """双滚筒驱动：1# 滚筒（机头）由 G2 + M2 驱动，2# 滚筒（后下方）由 G1 + M1 驱动；驱动部都在 y 正侧"""
    p1 = drum("BC103-P1", P1[0], P1[1], P1[2], FACE, col, M)
    p2 = drum("BC103-P2", P2[0], P2[1], P2[2], FACE, col, M)
    # 1# 滚筒轴承座（两端）
    d1 = lib.empty("BC103-D1", col, loc=(P1[0], 0, P1[1]))
    bm = bmesh.new()
    for s in (-1, 1):
        y = s * 0.98
        lib.add_box(bm, (0.42, 0.2, 0.22), center=(0, y, -0.06), bevel=0.02, mat=0)
        lib.add_cyl(bm, 0.15, 0.2, center=(0, y, 0.02), seg=24, mat=0, axis="Y")
        lib.add_box(bm, (0.5, 0.26, P1[1] - WALK_Z - 0.17), center=(0, y, -(P1[1] - WALK_Z) / 2 - 0.09), mat=1)
    ob = lib.new_object("BC103-D1_body", bm, [M["reducer"], M["steel"]], col, smooth_angle=35)
    ob.parent = d1
    sb = bmesh.new()
    lib.add_box(sb, (0.1, 0.1, 0.13), center=(0, 0, 0), bevel=0.008, mat=0)
    so = lib.new_object("VT-103-05", sb, [M["sensor"]], col)
    so.parent = d1
    so.location = (0.0, -0.98, 0.22)
    # 2# 滚筒轴承座
    bm = bmesh.new()
    for s in (-1, 1):
        lib.add_box(bm, (0.4, 0.2, 0.2), center=(P2[0], s * 0.98, P2[1] - 0.06), bevel=0.02, mat=0)
        lib.add_box(bm, (0.46, 0.24, P2[1] + 0.25), center=(P2[0], s * 0.98, (P2[1] - 0.25) / 2 - 0.1), mat=1)
    lib.new_object("STRUCT_p2_bearings", bm, [M["reducer"], M["steel"]], col, smooth_angle=35)
    # 制动器（1# 滚筒驱动侧，制动盘随轴转动，这里只做夹钳）
    bm = bmesh.new()
    lib.add_cyl(bm, 0.34, 0.03, center=(P1[0], 1.22, P1[1]), seg=40, mat=1, axis="Y")
    lib.add_box(bm, (0.22, 0.16, 0.26), center=(P1[0] + 0.3, 1.22, P1[1] - 0.12), bevel=0.02, mat=0)
    lib.new_object("BC103-brake", bm, [M["estop"], M["shaft"]], col, smooth_angle=35)
    # 减速机 / 联轴器 / 电机
    # 电机按定稿的比例做大（315 kW 卧式电机，机壳 φ0.96 m、长 1.3 m）；联轴器护罩是定稿里醒目的黄色圆筒
    _reducer("BC103-G2", col, M, (P1[0], 1.72, P1[1]), sensor="VT-103-04")
    _coupling("BC103-G2_coupling", col, M, (P1[0], 2.36, P1[1]))
    _motor("BC103-M2", col, M, (P1[0], 3.3, P1[1]), length=1.3, r=0.48, sensor="VT-103-02")
    # 2# 驱动组：按定稿放在 1# 驱动组后上方的抬高平台上（定稿里两台电机前后错开、都看得见；
    # 2026-10-28 用户决定按定稿摆，演示里不画它到 2# 滚筒的传动轴）
    _reducer("BC103-G1", col, M, (G1_X, 1.72, G1_Z), sensor="VT-103-03")
    _coupling("BC103-G1_coupling", col, M, (G1_X, 2.36, G1_Z))
    _motor("BC103-M1", col, M, (G1_X, 3.3, G1_Z), length=1.3, r=0.48, sensor="VT-103-01")
    # 驱动底座：两层平台（上层托 1# 驱动，下层托 2# 驱动）+ 型钢框架
    bm = bmesh.new()
    for x0, x1, z, y0, y1 in ((-0.85, 1.9, WALK_Z, 0.9, 4.4), (-3.4, -0.85, -0.12, 0.9, 4.4), (-2.0, -0.62, G1_DECK, 1.25, 4.4)):
        for y in (y0, (y0 + y1) / 2, y1):
            add_hbeam(bm, (x0, y, z - 0.12), (x1, y, z - 0.12), size=0.24, mat=0)
        for x in (x0, x1):
            add_hbeam(bm, (x, y0, z - 0.12), (x, y1, z - 0.12), size=0.24, mat=0)
            for y in (y0, y1):
                add_hbeam(bm, (x, y, GROUND_Z), (x, y, z - 0.24), size=0.26, mat=0)
    # 减速机 / 电机底座（从平台到设备底脚的型钢墩）
    for xc, zc, z_deck in ((P1[0], P1[1], WALK_Z), (G1_X, G1_Z, G1_DECK)):
        for yc, w, d, bottom in ((1.72, 1.1, 0.8, zc - 0.52), (2.36, 0.5, 0.4, zc - 0.5), (3.3, 1.0, 1.2, zc - 0.48 - 0.145)):
            if bottom > z_deck + 0.01:
                lib.add_box(bm, (w, d, bottom - z_deck), center=(xc, yc, (bottom + z_deck) / 2), mat=0)
    lib.new_object("STRUCT_drive_frame", bm, [M["steel"]], col)
    bm = bmesh.new()
    lib.add_plane(bm, (2.75, 3.5), center=(0.525, 2.65, WALK_Z), mat=0, uv=(0, 0, 2.75 / 0.5, 3.5 / 0.5))
    lib.add_plane(bm, (2.55, 3.5), center=(-2.125, 2.65, -0.12), mat=0, uv=(0, 0, 2.55 / 0.5, 3.5 / 0.5))
    lib.add_plane(bm, (1.38, 3.15), center=(-1.31, 2.825, G1_DECK), mat=0, uv=(0, 0, 1.38 / 0.5, 3.15 / 0.5))
    lib.new_object("STRUCT_drive_floor", bm, [M["grating"]], col)
    return p1, p2


def build_chute(col, M):
    """头部漏斗：上口在 1# 滚筒前下方，斜板收口到出料口；前壁矮、能看见里面的煤；加刮板清扫器"""
    bm = bmesh.new()
    x0, x1, yw, ztop = 0.12, 1.55, 0.9, 1.0
    ox0, ox1, ow, zb = 0.55, 1.15, 0.42, -1.5
    top = [(x0, -yw), (x1, -yw), (x1, yw), (x0, yw)]
    bot = [(ox0, -ow), (ox1, -ow), (ox1, ow), (ox0, ow)]
    for i in range(4):
        a, b = top[i], top[(i + 1) % 4]
        c, d = bot[(i + 1) % 4], bot[i]
        zt = ztop - (0.35 if i == 0 else 0)  # 朝镜头的一侧（y 负）矮一些
        vs = [bm.verts.new((a[0], a[1], zt)), bm.verts.new((b[0], b[1], zt)), bm.verts.new((c[0], c[1], zb)), bm.verts.new((d[0], d[1], zb))]
        bm.faces.new(vs)
    lib.add_box(bm, (x1 - x0 + 0.1, 0.08, 0.1), center=((x0 + x1) / 2, -yw, ztop - 0.35), mat=0)
    lib.add_box(bm, (x1 - x0 + 0.1, 0.08, 0.1), center=((x0 + x1) / 2, yw, ztop), mat=0)
    lib.add_box(bm, (0.08, 2 * yw + 0.1, 0.1), center=(x1, 0, ztop), mat=0)
    lib.add_box(bm, (ox1 - ox0 + 0.2, 2 * ow + 0.2, 0.12), center=((ox0 + ox1) / 2, 0, zb), mat=0)
    ob = lib.new_object("BC103-chute", bm, [M["steel"]], col)
    for p in ob.data.polygons:
        p.use_smooth = False
    # 漏斗里的存煤（斜面）
    bm = bmesh.new()
    lib.add_prism(bm, [(0.45, -0.6), (1.3, -0.6), (1.3, 0.6), (0.45, 0.6)], -0.6, -0.25, mat=0)
    lib.new_object("BC103-chute_coal", bm, [M["coal"]], col)
    # 头部清扫器
    bm = bmesh.new()
    lib.add_box(bm, (0.05, 1.5, 0.12), center=(0.28, 0, P1[1] - P1[2] - 0.02), mat=1)
    add_beam(bm, (0.32, -0.85, P1[1] - 0.62), (0.32, 0.85, P1[1] - 0.62), w=0.08, h=0.08, mat=0)
    lib.new_object("BC103-scraper", bm, [M["steel"], M["yellow"]], col)


# ---------------------------------------------------------------- 栈桥结构、通道、护栏


def build_frame(col, M):
    """输送机机架：两根纵梁 + 每 3 m 一组支腿和横梁（落在栈桥地板梁上）"""
    bm = bmesh.new()
    for s in (-1, 1):
        add_beam(bm, (-L_MODEL, s * STR_Y, 1.04), (-0.6, s * STR_Y, 1.04), w=0.06, h=0.16, mat=0)
    x = -0.6
    while x > -L_MODEL:
        for s in (-1, 1):
            add_beam(bm, (x, s * STR_Y, 0.52), (x, s * STR_Y, 0.98), w=0.1, h=0.1, mat=0)
        add_beam(bm, (x, -STR_Y, 0.62), (x, STR_Y, 0.62), w=0.08, h=0.08, mat=0)
        x -= 3.0
    lib.new_object("STRUCT_conveyor_frame", bm, [M["galv"]], col)
    # 栈桥楼板（花纹钢板）：输送机下方、通道内沿到远侧墙；机头驱动部区域（x > −3.6）不铺，露出下层平台
    bm = bmesh.new()
    w = COL_YF - WALK_Y0
    lib.add_plane(bm, (L_MODEL - 3.6, w), center=((-3.6 - L_MODEL) / 2, (COL_YF + WALK_Y0) / 2, 0.56), mat=0, uv=(0, 0, (L_MODEL - 3.6) / 2, w / 2))
    lib.new_object("STRUCT_deck", bm, [M["deck"]], col)


def build_walkway(col, M):
    """巡检通道（钢格板）+ 两道黄色护栏（外侧 1.1 m 高、内侧靠皮带）+ 踢脚板"""
    bm = bmesh.new()
    x0, x1 = -L_MODEL, 1.6
    w = WALK_Y0 - WALK_Y1
    lib.add_plane(bm, (x1 - x0, w), center=((x0 + x1) / 2, (WALK_Y0 + WALK_Y1) / 2, WALK_Z), mat=0, uv=(0, 0, (x1 - x0) / 0.5, w / 0.5))
    lib.new_object("STRUCT_walkway", bm, [M["grating"]], col)

    bm = bmesh.new()
    for y, top, mid, x_end in ((WALK_Y1 - 0.02, WALK_Z + 1.1, WALK_Z + 0.55, 1.5), (WALK_Y0 + 0.04, WALK_Z + 0.95, WALK_Z + 0.48, -3.2)):
        x = x_end
        while x > -L_MODEL:
            add_cyl_between(bm, (x, y, WALK_Z), (x, y, top), 0.022, seg=10, mat=0)
            x -= 1.2  # 立柱间距：定稿里的立柱比常规的 1.8 m 密（护栏立柱参与相机复核时反求约 1.1 m）
        add_cyl_between(bm, (x_end, y, top), (-L_MODEL, y, top), 0.024, seg=10, mat=0)
        add_cyl_between(bm, (x_end, y, mid), (-L_MODEL, y, mid), 0.018, seg=8, mat=0)
        lib.add_box(bm, (L_MODEL + x_end, 0.01, 0.1), center=((x_end - L_MODEL) / 2, y, WALK_Z + 0.05), mat=0)
    lib.new_object("STRUCT_rails", bm, [M["yellow"]], col)

    # 拉线急停：沿内侧护栏的红色拉绳 + 每 40 m 一个拉线开关（黄盒）
    bm = bmesh.new()
    yc, zc = WALK_Y0 + 0.08, WALK_Z + 0.78
    add_cyl_between(bm, (-3.2, yc, zc), (-L_MODEL, yc, zc), 0.008, seg=6, mat=0)
    for m in (40, 80):
        lib.add_box(bm, (0.16, 0.12, 0.2), center=(-m, yc + 0.02, zc - 0.05), bevel=0.01, mat=1)
    lib.new_object("BC103-cord", bm, [M["red"], M["estop"]], col)

    # 机头急停按钮盒（黄盒 + 红色蘑菇头，朝通道）
    bm = bmesh.new()
    lib.add_box(bm, (0.2, 0.12, 0.26), center=(0, 0, 0), bevel=0.012, mat=0)
    lib.add_cyl(bm, 0.045, 0.05, center=(0, -0.08, 0.02), seg=20, mat=1, axis="Y")
    lib.add_cyl(bm, 0.02, 0.5, center=(0, 0.02, -0.38), seg=8, mat=0, axis="Z")
    es = lib.new_object("ES-103-01", bm, [M["estop"], M["red"]], col, smooth_angle=40)
    es.location = (-3.0, WALK_Y0 + 0.02, WALK_Z + 0.75)

    # 托辊组上的温速传感器白盒（第 2 组近侧立架）
    bm = bmesh.new()
    lib.add_box(bm, (0.12, 0.1, 0.15), center=(0, 0, 0), bevel=0.008, mat=0)
    s = lib.new_object("VT-103-IDL", bm, [M["sensor"]], col)
    s.location = (-2.4, -1.0, 1.5)

    # 光纤测温条：贴在近侧纵梁外侧，UV 的 u = 里程 / 248（页面用温度贴图着色）
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.verify()
    n = 60
    vs = []
    for i in range(n + 1):
        x = -0.6 - (L_MODEL - 0.6) * i / n
        vs.append((bm.verts.new((x, -STR_Y - 0.035, 1.0)), bm.verts.new((x, -STR_Y - 0.035, 1.03))))
    for i in range(n):
        f = bm.faces.new((vs[i][0], vs[i + 1][0], vs[i + 1][1], vs[i][1]))
        for l, u in zip(f.loops, (i, i + 1, i + 1, i)):
            l[uvl].uv = ((0.6 + (L_MODEL - 0.6) * u / n) / 248, 0.5)
    lib.new_object("BC103-fiber", bm, [M["fiber"]], col)


def build_gallery(col, M):
    """栈桥钢结构：柱（近侧 / 远侧）+ 屋面梁 + 檩条 + 压型钢板屋面 + 远侧墙面交叉支撑；近侧墙皮和机头段屋面去掉（剖切）"""
    bm = bmesh.new()
    xs = [3.0 - 6 * i for i in range(int((L_MODEL + 3) / 6) + 1)]
    for x in xs:
        if x < -4:
            add_hbeam(bm, (x, COL_YN, GROUND_Z), (x, COL_YN, ROOF_Z), size=0.28, mat=0)
        add_hbeam(bm, (x, COL_YF, GROUND_Z), (x, COL_YF, ROOF_Z + 0.3), size=0.3, mat=0)
        add_hbeam(bm, (x, COL_YN, ROOF_Z), (x, COL_YF, ROOF_Z), size=0.26, mat=0)
        # 栈桥地板横梁（承托输送机支腿和巡检通道）
        add_beam(bm, (x, COL_YN, 0.45), (x, COL_YF, 0.45), w=0.18, h=0.2, mat=0)
    for i in range(len(xs) - 1):
        xa, xb = xs[i], xs[i + 1]
        # 远侧墙面交叉支撑（墙皮已剖掉，只在机头附近 3 跨保留支撑，远处露出厂区）
        if xa > -16:
            add_beam(bm, (xa, COL_YF, 0.5), (xb, COL_YF, ROOF_Z), w=0.09, h=0.09, mat=0)
            add_beam(bm, (xa, COL_YF, ROOF_Z), (xb, COL_YF, 0.5), w=0.09, h=0.09, mat=0)
        # 栈桥下部桁架（地面以上的支撑）
        for y in (COL_YN, COL_YF):
            if xa < -4 or y == COL_YF:
                add_beam(bm, (xa, y, GROUND_Z + 2.5), (xb, y, -0.4), w=0.1, h=0.1, mat=0)
                add_beam(bm, (xa, y, -0.4), (xb, y, GROUND_Z + 2.5), w=0.1, h=0.1, mat=0)
                add_beam(bm, (xa, y, -0.4), (xb, y, -0.4), w=0.12, h=0.16, mat=0)
    # 纵向梁：屋面边梁、地板边梁
    for y in (COL_YN, COL_YF):
        add_beam(bm, (3.0 if y == COL_YF else -4, y, ROOF_Z), (-L_MODEL, y, ROOF_Z), w=0.16, h=0.24, mat=0)
        add_beam(bm, (3.0, y, 0.45), (-L_MODEL, y, 0.45), w=0.16, h=0.22, mat=0)
    # 檩条
    y = COL_YN
    while y <= COL_YF:
        add_beam(bm, (-5, y, ROOF_Z + 0.16), (-L_MODEL, y, ROOF_Z + 0.16), w=0.08, h=0.14, mat=0)
        y += 1.3
    # 机头段：远侧大斜撑（概念图右上方的大斜撑）；近侧门式立柱会挡在主机位镜头前，定稿里也没有，不建
    add_beam(bm, (3.0, COL_YF, ROOF_Z + 0.3), (-3.0, COL_YF, 0.5), w=0.2, h=0.2, mat=0)
    lib.new_object("STRUCT_gallery", bm, [M["steel"]], col)

    # 压型钢板屋面（底面朝下可见），机头 4 m 不铺
    bm = bmesh.new()
    lib.add_plane(bm, (L_MODEL - 4, COL_YF - COL_YN + 0.4), center=((-4 - L_MODEL) / 2, (COL_YN + COL_YF) / 2, ROOF_Z + 0.24), mat=0, uv=(0, 0, (L_MODEL - 4) / 3, 1))
    ob = lib.new_object("STRUCT_roof", bm, [M["roof"]], col)
    for p in ob.data.polygons:
        p.use_smooth = False

    # 屋面下的灯具（每 6 m 一盏，机头上方一盏）：灯壳 + 发光面
    bm_body = bmesh.new()
    bm_lamp = bmesh.new()
    for x in [-0.5] + [-3 - 6 * i for i in range(int(L_MODEL / 6))]:
        z = ROOF_Z - 0.18 if x < -4 else ROOF_Z + 0.9
        y = 0.4
        lib.add_box(bm_body, (0.55, 0.3, 0.1), center=(x, y, z), bevel=0.01, mat=0)
        add_beam(bm_body, (x, y, z + 0.05), (x, y, ROOF_Z + (0.2 if x < -4 else 1.2)), w=0.03, h=0.03, mat=0)
        lib.add_plane(bm_lamp, (0.48, 0.24), center=(x, y, z - 0.052), mat=0, rot=Matrix.Rotation(math.pi, 3, "X"))
    lib.new_object("STRUCT_lamp_bodies", bm_body, [M["lampbody"]], col)
    lib.new_object("LAMPS", bm_lamp, [M["lamp"]], col)

    # 吊轨：I 字形轨道沿屋面下方，吊杆挂在屋面梁上
    bm = bmesh.new()
    ry, rz = 0.2, ROOF_Z - 0.3
    add_hbeam(bm, (-2.0, ry, rz), (-L_MODEL, ry, rz), size=0.14, mat=0)
    x = -3.0
    while x > -L_MODEL:
        add_beam(bm, (x, ry, rz + 0.07), (x, ry, ROOF_Z), w=0.04, h=0.04, mat=0)
        x -= 6
    lib.new_object("RB01-rail", bm, [M["galv"]], col)


def build_robot(col, M, mileage=4.3):
    """吊轨巡检机器人：行走小车 + 机身 + 云台（可见光 + 红外两颗镜头）+ 状态灯；根节点 RB01 的 x = −里程"""
    root = lib.empty("RB01", col, loc=(-mileage, 0.2, ROOF_Z - 0.3))
    bm = bmesh.new()
    lib.add_box(bm, (0.42, 0.24, 0.12), center=(0, 0, -0.1), bevel=0.02, mat=1)  # 小车
    lib.add_box(bm, (0.36, 0.3, 0.38), center=(0, 0, -0.4), bevel=0.04, segments=3, mat=0)  # 机身
    lib.add_cyl(bm, 0.05, 0.12, center=(0, 0, -0.66), seg=16, mat=1)  # 云台立柱
    lib.add_box(bm, (0.2, 0.26, 0.14), center=(0.02, 0, -0.78), bevel=0.03, mat=0)  # 云台
    for y in (-0.07, 0.07):
        lib.add_cyl(bm, 0.045, 0.06, center=(0.13, y, -0.78), seg=16, mat=1, axis="X")
    ob = lib.new_object("RB01_body", bm, [M["robot"], M["dark"]], col, smooth_angle=35)
    ob.parent = root
    bm = bmesh.new()
    lib.add_box(bm, (0.04, 0.12, 0.02), center=(0.17, 0, -0.25), mat=0)
    lp = lib.new_object("RB01_led", bm, [M["fiber"]], col)
    lp.parent = root
    return root


# ---------------------------------------------------------------- 远景


def _yard_z(x, y):
    """地面高度：栈桥附近是 GROUND_Z 的场地，往外按缓坡降到远处厂区 YARD_Z（以栈桥中段为圆心）"""
    r = math.hypot(x + 20.0, y)
    k = min(1.0, max(0.0, (r - 40.0) / 130.0))
    k = k * k * (3 - 2 * k)
    return GROUND_Z + (YARD_Z - GROUND_Z) * k


def build_background(col, M):
    """远景：地面（近处场地 + 缓坡 + 低处厂区）、筒仓群、筒仓之间的栈桥、厂区灯点"""
    # 地面：以栈桥中段为圆心的极坐标网格，高度按 _yard_z
    bm = bmesh.new()
    radii = [0, 25, 40, 55, 75, 100, 130, 170, 260, 450, 800, 1500]
    seg = 72
    rings = []
    for r in radii:
        if r == 0:
            rings.append([bm.verts.new((-20.0, 0.0, GROUND_Z))])
            continue
        rings.append([bm.verts.new((-20.0 + r * math.cos(2 * math.pi * i / seg), r * math.sin(2 * math.pi * i / seg), 0)) for i in range(seg)])
        for v in rings[-1]:
            v.co.z = _yard_z(v.co.x, v.co.y)
    for i in range(seg):
        bm.faces.new((rings[0][0], rings[1][i], rings[1][(i + 1) % seg]))
    for a, b in zip(rings[1:], rings[2:]):
        for i in range(seg):
            bm.faces.new((a[i], b[i], b[(i + 1) % seg], a[(i + 1) % seg]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    lib.new_object("BG_ground", bm, [M["ground"]], col)

    # 筒仓：（方位 °、距离 m、半径、高度），由定稿上每座筒仓的左右边、顶、底像素反投影得到
    # （主机位相机在 CAM_XY、高 3.46 m，见 scripts/coal-prep/compose_camera.py；底部按落在 YARD_Z 的厂区地面算；换机位要重算）
    silos = [(150.4, 352, 4.9, 13.8), (148.1, 352, 3.7, 11.4), (140.7, 331, 5.6, 25.2), (136.2, 299, 7.8, 35.1), (125.1, 336, 11.0, 47.4), (122.4, 353, 6.1, 35.9), (114.2, 373, 8.2, 41.5), (111.4, 386, 6.8, 35.7)]
    bm = bmesh.new()
    bm_win = bmesh.new()
    tops = []
    for az, d, r, h in silos:
        a = math.radians(az)
        cx, cy = CAM_XY[0] + d * math.cos(a), CAM_XY[1] + d * math.sin(a)
        z0 = YARD_Z - 2
        lib.add_cyl(bm, r, h + 2, center=(cx, cy, z0 + (h + 2) / 2), seg=40, mat=0)
        lib.add_box(bm, (r * 1.1, r * 0.8, r * 0.35), center=(cx, cy, YARD_Z + h + r * 0.17), mat=0)  # 仓顶皮带间
        lib.add_box(bm_win, (r * 0.9, 0.3, r * 0.05), center=(cx, cy - r * 0.42, YARD_Z + h + r * 0.2), mat=0)
        for k in range(5):
            lib.add_box(bm_win, (0.8, 0.8, 0.8), center=(cx + r * math.cos(k * 1.7), cy + r * math.sin(k * 1.7), YARD_Z + 3 + k * h / 5), mat=0)
        tops.append((cx, cy, h))
    lib.uv_box(bm, 6.0)
    lib.new_object("BG_silos", bm, [M["concrete"]], col)
    # 筒仓之间的倾斜栈桥（定稿里筒仓群上部连着几道廊道）：（起点筒仓, 高度比例）→（终点筒仓, 高度比例）
    bm = bmesh.new()
    for (i0, f0), (i1, f1) in (((2, 0.72), (3, 0.66)), ((3, 0.7), (4, 0.58)), ((4, 0.66), (6, 0.72)), ((6, 0.74), (7, 0.8)), ((0, 0.9), (2, 0.6))):
        x0, y0, h0 = tops[i0]
        x1, y1, h1 = tops[i1]
        add_beam(bm, (x0, y0, YARD_Z + h0 * f0), (x1, y1, YARD_Z + h1 * f1), w=4.0, h=3.6, mat=0)
    lib.new_object("BG_galleries", bm, [M["steel"]], col)
    # 厂区灯点：大部分在低处厂区（路灯、窗户），少量在近处场地。不能太多，否则像一片星空（第 6 轮评审）
    rs = __import__("random").Random(5)
    for _ in range(60):
        a = math.radians(rs.uniform(95, 178))
        d = rs.uniform(40, 760)
        x, y = CAM_XY[0] + d * math.cos(a), CAM_XY[1] + d * math.sin(a)
        s = 0.5 + d / 400
        lib.add_box(bm_win, (s, s, s * 0.6), center=(x, y, _yard_z(x, y) + rs.uniform(3, 9)), mat=0)
    lib.new_object("BG_lights", bm_win, [M["window"]], col)


def build(M):
    """建整个场景，返回统计信息"""
    scene_col = lib.collection("SCENE")
    col = lib.collection("CONVEYOR", scene_col)
    st = lib.collection("STRUCT", scene_col)
    bg = lib.collection("BG", scene_col)
    n_idl = build_idlers(col, M)
    build_belt(col, M)
    build_coal(col, M)
    build_drive(col, M)
    build_chute(col, M)
    build_frame(st, M)
    build_walkway(st, M)
    build_gallery(st, M)
    build_robot(col, M)
    build_background(bg, M)
    tris = sum(sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in bpy.data.objects if ob.type == "MESH")
    return {"idlers": n_idl, "objects": len(bpy.data.objects), "tris": tris}

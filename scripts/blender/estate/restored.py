"""
澜岸云境沙盘 · 还原版住宅楼栋（高层 B01–B04、洋房 B05–B12、联排 B13–B16）
----------------------------------------------------------
还原页（RestoredScene）原来用的是 img2threejs 生成器的方盒 + 着色器画的窗 + 实例化的梁墩盒子。放大到整页尺度看，窗格是
一块块随机色，墙面、深槽、阳台都对不上设计稿，所以住宅楼改回用 Blender 建模：

  - 位置、尺寸、层数都读 src/views/estate/scene/img2/footprints.json（build_spec.py 从设计稿反投影得到的体积登记，是唯一来源）；
  - 每个面按"开间 × 层"摆真实几何：横梁（每层窗之间一条）、竖墩（窗与窗之间）、成组窗的组界 = 壁柱 + 深槽 + 壁柱、楼角通高角柱；
    窗洞里是一块贴了窗格贴图的玻璃（贴图集 models/estate/window_atlas.png，见 scripts/estate/img2/make_window_atlas.py：
    深色凹框里一块带窗帘褶皱 / 家具 / 灯的橙黄亮芯，可带中间窗框和底部暗带），所以窗里的细节是真贴图；
  - 洋房南立面每户每排窗一个小挑台（挑板 + 栏板）；
  - 屋顶：塔楼 = 白色出挑檐口 + 塔冠 + 带深色凹口的核心筒；洋房 / 联排 = 板岩深灰屋面 + 白色出挑边 + 浅色光伏台座 + 设备盒；
  - 顶点 AO 用 Cycles 烘（窗洞里、阳台下、壁柱根、楼脚），楼与楼之间的暗角也进去；
  - 导出 public/estate/img2/buildings_bl.glb：每栋一个空物体（名字 = 楼栋编号），下面 <id>_body 一个网格。
    窗玻璃材质叫 bl_window，页面按时间调它的 emissiveIntensity（白天暗、夜里亮）。

局部坐标：空物体在楼栋中心 (cx, cy, 0)，z 直接用世界高度（本体从 z0 = top − h 起，一般是 0.7 的底座上面）。
立面坐标 (u, d, z) 同 buildings.py 的 side_frame：u 沿墙从观察者左到右，d 从外墙面往室内为正，凸出的构件 d 为负。

用法（命令行）：
    blender --background --factory-startup --python scripts/blender/estate/run_cli.py -- restored [--samples 48] [--render <png>]
"""

import json
import math
import os

import bpy

from . import bake
from .buildings import side_frame
from .export import _export
from .lib import MB, MODEL_DIR, ROOT, collection, material, rng

FOOT = os.path.join(ROOT, "src", "views", "estate", "scene", "img2", "footprints.json")
LAYOUT = os.path.join(ROOT, "src", "views", "estate", "data", "layout.json")
ATLAS = os.path.join(MODEL_DIR, "window_atlas.png")
ATLAS_DARK = os.path.join(MODEL_DIR, "window_atlas_dark.png")  # 联排：深炭灰凹槽
ATLAS_CLUB = os.path.join(MODEL_DIR, "window_atlas_club.png")  # 会所：金黄大玻璃（0–31 下层高窗，32–63 上层矮窗带）
ATLAS_TER = os.path.join(MODEL_DIR, "window_atlas_terrace.png")  # 洋房：暖褐凹槽 + 浅色阳台栏板

# 每类楼的立面参数（和 extras.js 的 FACADE 同一套，是对着设计稿量出来的）：
#   bay 开间宽 / row 一排窗的高（洋房、联排的"一排"是设计稿里的一排大窗，不是一层）/ win 窗占开间、占排高的比例 /
#   group 几个开间成一组 / groove 组界深槽宽 / pilaster 深槽两侧壁柱宽 / depth 墩凸出墙面多少 / beam 横梁凸出量是墩的几倍 /
#   color 墙色 / gain 墙色增益（线性）
KINDS = {
    # 塔楼：设计稿放大 9 倍看，墙面是暖褐色（整栋分位：中位亮度 ≈ 123，p25 ≈ 97，所以反照率要取到 ≈ (190,160,128)——页面光照 + AO 会把亮度压到 ≈ 0.55 倍），窗洞约占开间 7 成、里面的亮芯再占 8 成；
    # 组界是一条 ≈ 1.5 m 宽的深色通高槽，槽两侧各一条很细的浅色壁柱（≈ 0.4 m，(200,186,166)）。窗排间距约 8 px = 4.4 m
    "tower": dict(bay=4.25, row=4.4, win=(0.82, 0.72), group=2, groove=1.5, pilaster=0.4, depth=0.45, beam=0.4, color="#c6aa8e", gain=0.82, pil="#efe0c8", groove_color="#86786b"),
    "terrace": dict(bay=4.3, row=4.3, win=(0.84, 0.8), group=2, groove=0.5, pilaster=0.5, depth=0.4, beam=0.55, color="#e4c692", gain=0.86),
    "villa": dict(bay=3.75, row=9.5, win=(0.84, 0.8), group=2, groove=0.3, pilaster=0.9, depth=0.4, beam=0.55, color="#dcc7a4", gain=0.86),
}
WIN_CY = 0.46  # 窗洞在一排里的竖向中心
REC = 0.15  # 玻璃面比外墙面往里缩多少（窗洞的凹进深度 = 墩凸出量 + REC）
GROOVE_D = 0.12  # 深槽凸出墙面多少：比普通墩低得多才是"深"槽
PIL_OUT = 0.35  # 壁柱比普通墩再多凸出多少

# 窗格贴图集的格分段（和 make_window_atlas.py 一致）
TILE_N = 8
LIT = range(0, 32)
MID = range(32, 48)
DARK = range(48, 64)
P_LIT, P_MID = 0.9, 0.08  # 亮窗 / 半亮窗占比，其余暗窗


# ---------------------------------------------------------------- 材质


def _lin(h):
    h = h.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def _mat_lin(name, rgb, rough=0.85):
    """按线性 RGB 建 Principled 材质（页面里 THREE.Color(hex).multiplyScalar 也是在线性空间乘，所以增益要在线性里乘）"""
    m = material(name, "#808080", rough=rough)
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*[min(1.0, max(0.0, x)) for x in rgb], 1.0)
    return m


def make_materials():
    M = {}
    for kind, P in KINDS.items():
        base = [x * P["gain"] for x in _lin(P["color"])]
        M[f"wall_{kind}"] = _mat_lin(f"bl_wall_{kind}", base, 0.82)
        pil = _lin(P["pil"]) if P.get("pil") else [x * 1.3 for x in base]
        gv = _lin(P["groove_color"]) if P.get("groove_color") else [x * 0.35 for x in base]
        M[f"pil_{kind}"] = _mat_lin(f"bl_pil_{kind}", pil, 0.8)
        M[f"groove_{kind}"] = _mat_lin(f"bl_groove_{kind}", gv, 0.9)
    # 会所：灰色细柱（设计稿 ≈ (120,112,104)）、深灰窗梁、墙、屋顶、天窗
    M["club_col"] = material("bl_wall_clubcol", "#aaa194", rough=0.8)
    M["club_beam"] = material("bl_wall_clubbeam", "#8d857a", rough=0.85)
    M["club_wall"] = material("bl_wall_club", "#a69f93", rough=0.85)
    M["club_mull"] = material("bl_wall_clubmull", "#3b3631", rough=0.8)
    M["club_roof"] = material("bl_wall_clubroof", "#f4eee8", rough=0.85)  # 名字以 bl_wall 开头：整量自发光——设计稿里会所屋顶是画面里最亮的白
    M["club_sky"] = material("bl_roofclubsky", "#b4aca2", rough=0.9)
    M["shell"] = material("bl_shell", "#2b2723", rough=0.9)
    M["trim"] = material("bl_trim", "#e9e5dc", rough=0.8)  # 白色出挑檐口 / 屋面边
    M["slate"] = material("bl_slate", "#8a8d93", rough=0.85)  # 板岩深灰屋面
    M["roofw"] = material("bl_roofw", "#d2d4d8", rough=0.88)  # 塔楼屋顶 / 塔冠
    M["core"] = material("bl_core", "#b9b4a8", rough=0.85)
    M["coredark"] = material("bl_coredark", "#35373b", rough=0.9)
    M["pvplat"] = material("bl_pvplat", "#c6c8cc", rough=0.85)  # 光伏台座：设计稿里是冷一点的浅灰
    M["unit"] = material("bl_unit", "#dcdbd8", rough=0.85)
    M["slab"] = material("bl_slab", "#d2cabb", rough=0.82)  # 阳台挑板
    M["rail"] = material("bl_rail", "#c9ccd0", rough=0.5, metal=0.2)  # 栏板
    # 窗玻璃：基色深，窗格贴图集走自发光（glTF 原样导出；页面调 emissiveIntensity 控制昼夜）。
    # 塔楼用 window_atlas.png，洋房 / 联排用窗框更暗的 window_atlas_dark.png（材质名都以 bl_window 开头，页面一起调）
    for key, path, name in (
        ("window", ATLAS, "bl_window"),
        ("window_res", ATLAS_DARK, "bl_window_res"),
        ("window_ter", ATLAS_TER, "bl_window_ter"),
        ("window_club", ATLAS_CLUB, "bl_window_club"),
    ):
        m = material(name, "#241f1c", rough=0.2)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        img = bpy.data.images.get(os.path.basename(path)) or bpy.data.images.load(path)
        img.colorspace_settings.name = "sRGB"
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.interpolation = "Linear"
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 1.0
        M[key] = m
    return M


# ---------------------------------------------------------------- 立面


def tile_uv(t):
    """贴图集第 t 格的四个角 UV（左下、右下、右上、左上；图像第 0 行在上，所以 v 倒过来），四周内缩 1.5 px 防串色"""
    row, col = divmod(t, TILE_N)
    pad = 1.5 / (TILE_N * 64)
    u0 = col / TILE_N + pad
    u1 = (col + 1) / TILE_N - pad
    v1 = 1 - row / TILE_N - pad
    v0 = 1 - (row + 1) / TILE_N + pad
    return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]


def pick_tile(r):
    x = r()
    pool = LIT if x < P_LIT else MID if x < P_LIT + P_MID else DARK
    return list(pool)[int(r() * len(pool)) % len(pool)]


def facade(mb, side, W, D, z0, ztop, kind, r, balcony=False):
    """一个立面：横梁 + 竖墩 + 组界壁柱 / 深槽 + 窗玻璃（贴图集）+ 可选小挑台"""
    P = KINDS[kind]
    L, tf = side_frame(side, W, D)
    grp = P["group"]
    nb = grp * max(1, round(L / (P["bay"] * grp)))
    bw = L / nb
    h = ztop - z0
    nr = max(1, round(h / P["row"]))
    rh = h / nr
    ww, wh = P["win"]
    p = P["depth"]
    pb = p * P["beam"]
    g = P["groove"] / 2
    pl = P["pilaster"]
    wall, pil, groove = f"wall_{kind}", f"pil_{kind}", f"groove_{kind}"
    inner = REC + 0.04  # 墩 / 梁伸进外墙面以内多少（接上后面的壳）

    def box(m, a0, a1, za, zb, dout):
        mb.box(m, a0, a1, -dout, inner, za, zb, skip=("+y", "-z"), tf=tf)

    # 横梁：每排窗洞之间一条（含最下、最上各一条）；成组的楼在组界深槽处断开，深槽贯通整个楼高
    for k in range(nr + 1):
        za = z0 if k == 0 else z0 + (k - 1 + WIN_CY + wh / 2) * rh
        zb = ztop if k == nr else z0 + (k + WIN_CY - wh / 2) * rh
        start = 0.0
        if grp:
            for i in range(grp, nb, grp):
                box(wall, start, i * bw - g, za, zb, pb)
                start = i * bw + g
        box(wall, start, L, za, zb, pb)

    # 竖墩：窗洞之间；成组的组界上是 壁柱 + 深槽 + 壁柱
    for i in range(nb + 1):
        a0 = 0.0 if i == 0 else (i - 1 + 0.5 + ww / 2) * bw
        a1 = L if i == nb else (i + 0.5 - ww / 2) * bw
        boundary = grp > 0 and 0 < i < nb and i % grp == 0
        if not boundary:
            box(wall, a0, a1, z0, ztop, p - 0.02)
            continue
        c = i * bw
        lo = max(a0, c - g - pl)
        hi = min(a1, c + g + pl)
        box(wall, a0, lo, z0, ztop, p - 0.02)
        box(pil, lo, c - g, z0, ztop, p + PIL_OUT)
        box(groove, c - g, c + g, z0, ztop, GROOVE_D)
        box(pil, c + g, hi, z0, ztop, p + PIL_OUT)
        box(wall, hi, a1, z0, ztop, p - 0.02)

    # 窗玻璃 + 小挑台
    for k in range(nr):
        za = z0 + (k + WIN_CY - wh / 2) * rh
        zb = z0 + (k + WIN_CY + wh / 2) * rh
        for j in range(nb):
            ua = (j + 0.5 - ww / 2) * bw
            ub = (j + 0.5 + ww / 2) * bw
            mb.quad(
                {"tower": "window", "terrace": "window_ter", "villa": "window_res"}[kind],
                tf(ua, REC, za),
                tf(ub, REC, za),
                tf(ub, REC, zb),
                tf(ua, REC, zb),
                uv=tile_uv(pick_tile(r)),
            )
            if balcony:
                # 挑台：挑板 + 前沿栏板 + 两侧栏板（设计稿里每户窗下一个小挑台）
                mb.box("slab", ua - 0.1, ub + 0.1, -0.9, inner, za - 0.32, za - 0.04, skip=("-z", "+y"), tf=tf)
                mb.box("rail", ua - 0.1, ub + 0.1, -0.9, -0.82, za - 0.04, za + 0.95, skip=("-z",), tf=tf)
                mb.box("rail", ua - 0.1, ua - 0.03, -0.9, -0.0, za - 0.04, za + 0.95, skip=("-z",), tf=tf)
                mb.box("rail", ub + 0.03, ub + 0.1, -0.9, -0.0, za - 0.04, za + 0.95, skip=("-z",), tf=tf)


def corner_posts(mb, W, D, z0, ztop, kind):
    """四个楼角的通高角柱：盖住四个面的梁墩在转角处留下的缺口"""
    P = KINDS[kind]
    p = P["depth"]
    inner = REC + 0.04
    for sx in (-1, 1):
        for sy in (-1, 1):
            x0, x1 = (sx * W / 2 - inner, sx * W / 2 + p) if sx > 0 else (sx * W / 2 - p, sx * W / 2 + inner)
            y0, y1 = (sy * D / 2 - inner, sy * D / 2 + p) if sy > 0 else (sy * D / 2 - p, sy * D / 2 + inner)
            mb.box(f"wall_{kind}", x0, x1, y0, y1, z0, ztop, skip=("-z",))


def shell(mb, W, D, z0, ztop):
    """后面的壳：比外墙面往里 REC + 0.04，深色，只用来把窗洞后面封死（看不见）"""
    i = REC + 0.04
    mb.box("shell", -W / 2 + i, W / 2 - i, -D / 2 + i, D / 2 - i, z0, ztop)


# ---------------------------------------------------------------- 屋顶


def slab(mb, mat, W, D, z0, z1, over=0.0, off=(0.0, 0.0)):
    ox, oy = off
    mb.box(mat, -W / 2 - over + ox, W / 2 + over + ox, -D / 2 - over + oy, D / 2 + over + oy, z0, z1, skip=("-z",))


def ring(mb, mat, W, D, t, z0, z1, off=(0.0, 0.0)):
    """屋面边上一圈矮墙（外廓 W × D，墙厚 t，中心偏移 off）"""
    ox, oy = off
    mb.box(mat, -W / 2 + ox, W / 2 + ox, -D / 2 + oy, -D / 2 + t + oy, z0, z1)
    mb.box(mat, -W / 2 + ox, W / 2 + ox, D / 2 - t + oy, D / 2 + oy, z0, z1)
    mb.box(mat, -W / 2 + ox, -W / 2 + t + ox, -D / 2 + t + oy, D / 2 - t + oy, z0, z1)
    mb.box(mat, W / 2 - t + ox, W / 2 + ox, -D / 2 + t + oy, D / 2 - t + oy, z0, z1)


def tower_top(mb, W, D, ztop):
    """塔楼顶：白色出挑檐口（比楼身宽 0.7 m）、塔冠、带深色凹口的核心筒"""
    slab(mb, "trim", W, D, ztop - 0.9, ztop + 0.3, over=0.7)
    cw, cd = W * 0.8, D * 0.8
    mb.box("roofw", -cw / 2, cw / 2, -cd / 2, cd / 2, ztop + 0.3, ztop + 1.6)
    kw, kd = W * 0.34, D * 0.5  # 核心筒盒（和 build_spec.py 的 B0x_core 一致）
    mb.box("core", -kw / 2, kw / 2, -kd / 2, kd / 2, ztop + 1.6, ztop + 3.9)
    mb.box("coredark", -kw * 0.37, kw * 0.37, -kd * 0.31, kd * 0.31, ztop + 3.9, ztop + 4.1)


def residential_top(mb, kind, W, D, ztop, r):
    """洋房 / 联排屋顶：板岩深灰屋面 + 白色出挑边 + 光伏台座 + 设备盒"""
    th = 1.2 if kind == "terrace" else 1.0
    slab(mb, "slate", W * 0.96, D * 0.96, ztop, ztop + th)
    rt = ztop + th
    ring(mb, "trim", W + 0.6, D + 0.6, 0.45, rt - 0.1, rt + 0.65)
    if kind == "terrace":
        rw, rd = W * 0.96, D * 0.96
        for sx in (-1, 1):
            mb.box("pvplat", sx * rw * 0.25 - rw * 0.17, sx * rw * 0.25 + rw * 0.17, rd * 0.14 - rd * 0.25, rd * 0.14 + rd * 0.25, rt, rt + 0.6)
        mb.box("unit", -rw * 0.04, rw * 0.04, rd * 0.14 - rd * 0.17, rd * 0.14 + rd * 0.17, rt, rt + 1.8)
    else:
        rw, rd = W * 0.96, D * 0.96
        for sx in (-1, 1):
            mb.box("pvplat", sx * rw * 0.17 - rw * 0.155, sx * rw * 0.17 + rw * 0.155, -rd * 0.26, rd * 0.26, rt, rt + 0.5)
        mb.box("unit", -rw * 0.03, rw * 0.03, rd * 0.12 - rd * 0.1, rd * 0.12 + rd * 0.1, rt, rt + 1.4)
        mb.box("unit", rw * 0.4 - 0.8, rw * 0.4 + 0.8, -rd * 0.2 - 0.8, -rd * 0.2 + 0.8, rt, rt + 1.4)



# ---------------------------------------------------------------- 会所


def club_pane(mb, r, mat_tiles, x0, x1, z0, z1, y, tf=lambda x, y, z: (x, y, z), max_w=2.4):
    """一片玻璃：按 max_w 分成若干块，每块一个贴图格，块与块之间一根细窗梃；mat_tiles = 可选的贴图格编号列表"""
    n = max(1, round((x1 - x0) / max_w))
    w = (x1 - x0) / n
    for i in range(n):
        a, b = x0 + i * w, x0 + (i + 1) * w
        t = mat_tiles[int(r() * len(mat_tiles)) % len(mat_tiles)]
        mb.quad("window_club", tf(a, y, z0), tf(b, y, z0), tf(b, y, z1), tf(a, y, z1), uv=tile_uv(t))
        if i > 0:
            mb.box("club_mull", a - 0.07, a + 0.07, y - 0.12, y + 0.05, z0, z1, skip=("-z", "+z"))


def club(col, M, fp, seed):
    """社区会所：中央段（两层玻璃：下层高窗 / 上层矮窗带，夹一道粗横梁，4 根细灰柱）+ 两翼（一层通高玻璃）+ 白色出挑屋顶板 + 天窗。
    尺寸读 footprints.json（CL01 / CL01_wl / CL01_wr / CL01_roof* / CL01_sky）；立面分划按设计稿放大图读出来的米数：
    柱缘 0–1.9 / 9.75–11.25 / 28.5–30.4 / 36.75–38.63 m，开间 A 7.85 m、B 17.25 m（中央大开间，带门）、C 6.35 m；
    竖向（距楼脚）：基座 0.6 → 下层玻璃 11.8 → 粗梁 14.7 → 上层玻璃 22.4 → 檐口带 24.3 m（总高随登记值缩放）。"""
    c = fp["CL01"]
    W, D = c["w"], c["d"]
    z0 = c["top"] - c["h"]
    zt = c["top"]
    H = c["h"]
    k = H / 24.3  # 竖向分划按总高缩放
    r = rng(seed)
    mb = MB()
    LOWER = list(range(0, 32))
    UPPER = list(range(32, 64))
    xl = -W / 2
    sy = -D / 2  # 中央段南墙面
    gy = sy + 0.3  # 玻璃面比墙面往里 0.3 m

    def zz(v):
        return z0 + v * k

    # 中央段本体（四面墙，南面被玻璃 / 柱 / 梁盖住）
    mb.box("club_wall", -W / 2, W / 2, gy + 0.06, D / 2, z0, zt)  # 比玻璃面往里 6 cm，免得和玻璃共面闪烁
    # 南立面：柱、梁、玻璃
    s = W / 38.63
    cols = [(0.0, 1.9), (9.75, 11.25), (28.5, 30.4), (36.75, 38.63)]
    for a, b in cols:
        mb.box("club_col", xl + a * s, xl + b * s, sy - 0.6, gy + 0.1, z0, zt, skip=("-z", "+z"))
    # 粗横梁（上下层之间）、檐口带、基座
    mb.box("club_beam", -W / 2, W / 2, sy - 0.45, gy + 0.1, zz(11.8), zz(14.7))
    mb.box("club_beam", -W / 2, W / 2, sy - 0.5, gy + 0.1, zz(22.4), zt)
    mb.box("club_beam", -W / 2, W / 2, sy - 0.3, gy + 0.1, z0, zz(0.6))
    bays = [(1.9, 9.75), (11.25, 28.5), (30.4, 36.75)]
    for a, b in bays:
        club_pane(mb, r, LOWER, xl + a * s, xl + b * s, zz(0.6), zz(11.8), gy)
        club_pane(mb, r, UPPER, xl + a * s, xl + b * s, zz(14.7), zz(22.4), gy)
    # 中央屋顶板（出挑 1.5 m）+ 细白边 + 天窗
    rw, rd = fp["CL01_roof"]["w"], fp["CL01_roof"]["d"]
    rz0, rz1 = zt, fp["CL01_roof"]["top"]
    mb.box("club_roof", -rw / 2, rw / 2, -rd / 2, rd / 2, rz0, rz1, skip=("-z",))
    ring(mb, "club_roof", rw, rd, 0.35, rz1, rz1 + 0.5)
    sw, sd = fp["CL01_sky"]["w"], 5.5
    mb.box("club_sky", -sw / 2, sw / 2, -sd / 2, sd / 2, rz1, rz1 + 0.5)
    # 两翼：一层通高玻璃，两端细柱，檐口带
    for name, sgn in (("CL01_wl", -1), ("CL01_wr", 1)):
        f = fp[name]
        ww, wd = f["w"], f["d"]
        dx = f["cx"] - c["cx"]
        dy = f["cy"] - c["cy"]
        wz0 = f["top"] - f["h"]
        wzt = f["top"]
        wk = f["h"] / 19.8
        wsy = dy - wd / 2
        wgy = wsy + 0.3
        x0, x1 = dx - ww / 2, dx + ww / 2
        mb.box("club_wall", x0, x1, wgy + 0.06, dy + wd / 2, wz0, wzt)
        for a, b in ((x0, x0 + 1.1), (x1 - 1.1, x1)):
            mb.box("club_col", a, b, wsy - 0.5, wgy + 0.1, wz0, wzt, skip=("-z", "+z"))
        mb.box("club_beam", x0, x1, wsy - 0.4, wgy + 0.1, wz0 + 17.5 * wk, wzt)
        mb.box("club_beam", x0, x1, wsy - 0.25, wgy + 0.1, wz0, wz0 + 0.6 * wk)
        club_pane(mb, r, LOWER, x0 + 1.1, x1 - 1.1, wz0 + 0.6 * wk, wz0 + 17.5 * wk, wgy)
        # 屋顶板
        fr = fp["CL01_roofw" + ("l" if sgn < 0 else "r")]
        mb.box("club_roof", dx - fr["w"] / 2, dx + fr["w"] / 2, dy - fr["d"] / 2, dy + fr["d"] / 2, wzt, fr["top"], skip=("-z",))
        ring(mb, "club_roof", fr["w"], fr["d"], 0.3, fr["top"], fr["top"] + 0.45, off=(dx, dy))
    empty = bpy.data.objects.new("CL01", None)
    empty.location = (c["cx"], c["cy"], 0.0)
    col.objects.link(empty)
    body = mb.build("CL01_body", M, col)
    body.parent = empty
    return body

# ---------------------------------------------------------------- 总装


def build_building(col, M, f, kind, seed):
    W, D = f["w"], f["d"]
    ztop = f["top"]
    z0 = ztop - f["h"]
    mb = MB()
    r = rng(seed)
    shell(mb, W, D, z0, ztop)
    for side in "SNEW":
        facade(mb, side, W, D, z0, ztop, kind, r, balcony=(kind == "terrace" and side == "S"))
    corner_posts(mb, W, D, z0, ztop, kind)
    if kind == "tower":
        tower_top(mb, W, D, ztop)
    else:
        residential_top(mb, kind, W, D, ztop, r)
    empty = bpy.data.objects.new(f["id"], None)
    empty.location = (f["cx"], f["cy"], 0.0)
    col.objects.link(empty)
    body = mb.build(f"{f['id']}_body", M, col)
    body.parent = empty
    return body


def build_all():
    fp = {x["id"]: x for x in json.load(open(FOOT))["footprints"]}
    layout = json.load(open(LAYOUT))
    M = make_materials()
    col = collection("BUILDINGS")
    names = []
    for i, b in enumerate(layout["buildings"]):
        f = fp[b["id"]]
        build_building(col, M, f, b["kind"], 100 + i * 17)
        names.append(b["id"])
    club(col, M, fp, 777)
    names.append("CL01")
    return names


def run(render_to=None, samples=48):
    from .lib import clear_scene

    os.makedirs(MODEL_DIR, exist_ok=True)
    clear_scene()
    names = build_all()
    # AO 烘焙要有"地面"才有楼脚暗角：临时铺一块大地面（不进集合、不导出）
    bpy.ops.mesh.primitive_plane_add(size=1200, location=(0, 0, 0.0))
    ground = bpy.context.active_object
    ground.name = "ao_ground_tmp"
    out = {"buildings": names}
    out.update(bake.vertex_ao(samples=samples, distance=16.0, floor=0.58))
    bpy.data.objects.remove(ground, do_unlink=True)
    os.makedirs(os.path.join(ROOT, "public", "estate", "img2"), exist_ok=True)
    out["buildings_bl.glb(KB)"] = _export("BUILDINGS", os.path.join("img2", "buildings_bl.glb"))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(MODEL_DIR, "restored.blend"))
    if render_to:
        from . import preview

        out["png"] = preview.render(render_to)
    return out

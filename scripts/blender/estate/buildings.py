"""
澜岸云境沙盘 · 楼栋建模
----------------------------------------------------------
每栋楼一个空物体（名字 = 楼栋编号，位置 = 楼栋中心），下面挂：
  <id>_body   可见网格：墙、壁柱、楼板、阳台、屋面、窗玻璃（按亮灯档分材质）、金色灯带
  <id>_hull   不可见外框盒（页面用来拾取和画轮廓线，不渲染）
立面按"开间"一格一格摆真实几何：楼板带（略凸）、窗间墙、凹进去的窗玻璃、阳台板和栏板、通高壁柱；
高度不再靠贴图假装。南面（朝镜头）细节最多，北面和山墙只做窗。

局部坐标：facade() 里用 (u, d, z)：u 沿墙从观察者左到右，d 从外墙面往室内为正（凸出的构件 d 为负），z 向上。
SIDES 把 (u, d, z) 变成楼栋坐标，四个面都是纯旋转，盒子法线保持朝外。
"""

import math

import bpy

from .lib import GLASS_TIERS, MB, collection, rng


# ---------------------------------------------------------------- 四个立面的坐标变换


def side_frame(side, W, D, off=(0.0, 0.0)):
    """(L, tf)：该面长度和 (u, d, z) → 楼栋坐标的变换"""
    ox, oy = off
    if side == "S":
        return W, lambda u, d, z: (-W / 2 + u + ox, -D / 2 + d + oy, z)
    if side == "N":
        return W, lambda u, d, z: (W / 2 - u + ox, D / 2 - d + oy, z)
    if side == "E":
        return D, lambda u, d, z: (W / 2 - d + ox, -D / 2 + u + oy, z)
    return D, lambda u, d, z: (-W / 2 + d + ox, D / 2 - u + oy, z)  # "W"


def pick_glass(r, tiers=GLASS_TIERS):
    """按占比随机取一档窗玻璃材质名"""
    x = r()
    acc = 0.0
    for name, p, _ in tiers:
        acc += p
        if x < acc:
            return name
    return tiers[-1][0]


# ---------------------------------------------------------------- 立面


def facade(
    mb,
    side,
    W,
    D,
    z0,
    rows,
    H,
    bays,
    r,
    *,
    off=(0.0, 0.0),
    span=None,
    sill=1.0,
    win_h=1.5,
    pier=1.3,
    band=0.12,
    thick=0.5,
    rec=0.3,
    balcony=None,
    bal_depth=1.5,
    fins=(),
    fin_w=1.5,
    fin_out=0.45,
    wall="wall",
    fin_mat="wall2",
    slab_mat="slab",
    glass=None,
    glass_fn=None,
    top_extra=0.0,
):
    """
    一个立面：rows 层、bays 个开间。span=(u0,u1) 只做墙的一段（其余被别的体量挡住）。
    balcony(row, bay) → 该开间该层是否带阳台；glass_fn(row, bay) → 指定窗玻璃材质（None = 随机亮灯档）。
    """
    L, tf = side_frame(side, W, D, off)
    u0, u1 = span if span else (0.0, L)
    bw = (u1 - u0) / bays
    top = z0 + rows * H

    def wallbox(m, a, b, d0, d1, za, zb, skip):
        mb.box(m, u0 + a, u0 + b, d0, d1, za, zb, skip=skip, tf=tf)

    # 楼板带：底部窗台墙、层间（上一层窗头 + 下一层窗台）、顶部窗头，一整条，略凸出
    Lw = u1 - u0
    wallbox(wall, 0, Lw, -band, thick, z0, z0 + sill, ("+y", "-z"))
    for k in range(1, rows):
        za = z0 + (k - 1) * H + sill + win_h
        zb = z0 + k * H + sill
        wallbox(wall, 0, Lw, -band, thick, za, zb, ("+y", "-z"))
    wallbox(wall, 0, Lw, -band, thick, z0 + (rows - 1) * H + sill + win_h, top, ("+y", "-z"))

    # 通高壁柱
    fin_set = set(fins)
    for b in fin_set:
        c = b * bw
        a = max(0.0, c - fin_w / 2)
        e = min(Lw, c + fin_w / 2)
        wallbox(fin_mat, a, e, -fin_out, thick, z0, top + top_extra, ("+y", "-z"))

    # 窗间墙 + 窗玻璃 + 阳台
    for k in range(rows):
        zb = z0 + k * H
        zw0 = zb + sill
        zw1 = zw0 + win_h
        for b in range(bays + 1):
            if b in fin_set:
                continue
            c = b * bw
            a = max(0.0, c - pier / 2)
            e = min(Lw, c + pier / 2)
            wallbox(wall, a, e, 0.0, thick, zw0, zw1, ("+y", "-z", "+z"))
        for b in range(bays):
            ua = u0 + b * bw + pier / 2
            ub = u0 + (b + 1) * bw - pier / 2
            has_bal = balcony(k, b) if balcony else False
            gm = glass_fn(k, b) if glass_fn else None
            gm = gm or glass or pick_glass(r)
            zlo = zb + 0.22 if has_bal else zw0
            p = [tf(ua, rec, zlo), tf(ub, rec, zlo), tf(ub, rec, zw1), tf(ua, rec, zw1)]
            mb.quad(gm, *p)
            if has_bal:
                mb.box(slab_mat, ua - 0.15, ub + 0.15, -bal_depth, 0.0, zb, zb + 0.2, skip=("-z",), tf=tf)
                mb.box("rail", ua - 0.15, ub + 0.15, -bal_depth, -bal_depth + 0.07, zb + 0.2, zb + 1.2, tf=tf)
                mb.box("rail", ua - 0.15, ua - 0.08, -bal_depth, 0.0, zb + 0.2, zb + 1.2, tf=tf)
                mb.box("rail", ub + 0.08, ub + 0.15, -bal_depth, 0.0, zb + 0.2, zb + 1.2, tf=tf)


def roof_slab(mb, W, D, z, mat="roof_flat", over=0.6, th=0.35, off=(0.0, 0.0)):
    """屋面板：比墙体四周各出挑 over"""
    ox, oy = off
    mb.box(mat, -W / 2 - over + ox, W / 2 + over + ox, -D / 2 - over + oy, D / 2 + over + oy, z, z + th, skip=("-z",))


def parapet(mb, W, D, z, h=0.9, th=0.3, mat="wall2", off=(0.0, 0.0)):
    """女儿墙：屋面边上一圈矮墙"""
    ox, oy = off
    x0, x1, y0, y1 = -W / 2 + ox, W / 2 + ox, -D / 2 + oy, D / 2 + oy
    mb.box(mat, x0, x1, y0, y0 + th, z, z + h)
    mb.box(mat, x0, x1, y1 - th, y1, z, z + h)
    mb.box(mat, x0, x0 + th, y0 + th, y1 - th, z, z + h)
    mb.box(mat, x1 - th, x1, y0 + th, y1 - th, z, z + h)


def led_ring(mb, W, D, z, off=(0.0, 0.0), th=0.22, h=0.28):
    """金色 LED 灯带：屋檐下一圈细条，夜里亮起"""
    ox, oy = off
    x0, x1, y0, y1 = -W / 2 + ox, W / 2 + ox, -D / 2 + oy, D / 2 + oy
    mb.box("gold", x0, x1, y0 - 0.02, y0 + th, z, z + h)
    mb.box("gold", x0, x1, y1 - th, y1 + 0.02, z, z + h)
    mb.box("gold", x0 - 0.02, x0 + th, y0 + th, y1 - th, z, z + h)
    mb.box("gold", x1 - th, x1 + 0.02, y0 + th, y1 - th, z, z + h)


# ---------------------------------------------------------------- 住宅


def tower(mb, b, r):
    """高层：十几开间的长面、南面连排阳台、通高壁柱、顶部收进去的小塔冠 + 金色灯带"""
    W, D, N, H = b["w"], b["d"], b["floors"], b["storeyH"]
    main = N * H
    bl = max(4, round(W / 3.4))
    bs = max(3, round(D / 3.4))
    fins_l = [0, bl // 2, bl]
    for side in "SNEW":
        L, bays = (W, bl) if side in "SN" else (D, bs)
        south = side == "S"
        facade(
            mb,
            side,
            W,
            D,
            0.0,
            N,
            H,
            bays,
            r,
            balcony=(lambda k, i: k >= 1 and i % 3 != 1) if south else None,
            fins=fins_l if side in "SN" else [0, bays],
            glass_fn=(lambda k, i: "glass_a") if False else None,
        )
    roof_slab(mb, W, D, main, over=0.4, th=0.35)
    parapet(mb, W, D, main + 0.35, 0.9)
    cw, cd = W * 0.58, D * 0.66
    z1 = main + 0.35
    ch = 4.2
    for side in "SNEW":
        L, bays = (cw, 6) if side in "SN" else (cd, 4)
        facade(mb, side, cw, cd, z1, 2, ch / 2, bays, r, sill=0.45, win_h=1.1, pier=0.9, thick=0.4, band=0.08, rec=0.2, wall="wall2")
    roof_slab(mb, cw, cd, z1 + ch, "roof_flat", over=0.7, th=0.45)
    led_ring(mb, cw + 1.4, cd + 1.4, z1 + ch - 0.28)
    mb.box("dark", -0.15 + cw * 0.18, 0.15 + cw * 0.18, -0.15, 0.15, z1 + ch + 0.45, z1 + ch + 5.0)
    mb.box("wall2", -cw * 0.3, -cw * 0.02, -cd * 0.18, cd * 0.18, z1 + ch + 0.45, z1 + ch + 1.9)
    # 一层大堂的雨棚
    mb.box("slab", -5.0, 5.0, -D / 2 - 2.6, -D / 2, 3.6, 3.85)
    return main + 0.35 + ch + 0.45


def terrace(mb, b, r):
    """洋房：主体 N-1 层 + 退台的顶层（南面留露台），挑檐屋面"""
    W, D, N, H = b["w"], b["d"], b["floors"], b["storeyH"]
    mainN = N - 1
    main = mainN * H
    bl = max(4, round(W / 3.4))
    bs = max(3, round(D / 3.4))
    for side in "SNEW":
        L, bays = (W, bl) if side in "SN" else (D, bs)
        facade(
            mb,
            side,
            W,
            D,
            0.0,
            mainN,
            H,
            bays,
            r,
            balcony=(lambda k, i: k >= 1 and i % 2 == 0) if side == "S" else None,
            bal_depth=1.3,
            fins=[0, bays] if side not in "SN" else [0, bays // 2, bays],
        )
    roof_slab(mb, W, D, main, over=0.35, th=0.3)
    # 顶层退台：南面退 2.4 m 做露台，北面退 0.4 m
    tw, td = W - 2.6, D - 3.0
    off = (0.0, 1.1)
    z1 = main + 0.3
    parapet(mb, W, D, z1, 1.0, 0.18, "rail")
    tb = max(4, round(tw / 3.4))
    for side in "SNEW":
        L, bays = (tw, tb) if side in "SN" else (td, 3)
        facade(mb, side, tw, td, z1, 1, H, bays, r, off=off, sill=0.5, win_h=2.1, pier=0.8, thick=0.45, rec=0.25, wall="wall2")
    roof_slab(mb, tw, td, z1 + H, "roof_flat", over=0.9, th=0.4, off=off)
    mb.box("wall2", W * 0.12, W * 0.32, 0.0, 2.0, z1 + H + 0.4, z1 + H + 1.9)
    return z1 + H + 0.4


def villa(mb, b, r):
    """联排：4 户并排，每户 3 层，南面一层车库门 + 二层阳台，双坡瓦屋面"""
    W, D, N, H = b["w"], b["d"], b["floors"], b["storeyH"]
    main = N * H
    units = 4
    bays = units * 2
    for side in "SNEW":
        L, nb = (W, bays) if side in "SN" else (D, 3)
        south = side == "S"
        facade(
            mb,
            side,
            W,
            D,
            0.0,
            N,
            H,
            nb,
            r,
            wall="wall_warm",
            fin_mat="wall2",
            pier=0.9,
            balcony=(lambda k, i: k == 1 and i % 2 == 1) if south else None,
            bal_depth=1.2,
            fins=[j * 2 for j in range(units + 1)] if side in "SN" else [0, nb],
            glass_fn=(lambda k, i: "dark" if (k == 0 and i % 2 == 0) else None) if south else None,
        )
    eave = 0.9
    rise = (D / 2 + eave) * 0.52
    mb.prism_x("roof_tile", -W / 2 - 0.45, W / 2 + 0.45, -D / 2 - eave, D / 2 + eave, main - 0.1, main + rise, gable=True, wall_m="wall_warm")
    # 每户屋顶一个小老虎窗
    for j in range(units):
        cx = -W / 2 + (j + 0.5) * W / units
        mb.box("wall_warm", cx - 0.9, cx + 0.9, -D * 0.5 + 0.1, -D * 0.5 + 1.8, main - 0.1, main + 1.7)
        mb.prism_x("roof_tile", cx - 1.15, cx + 1.15, -D * 0.5 - 0.05, -D * 0.5 + 1.95, main + 1.6, main + 2.4, gable=False)
        mb.quad("glass_c", (cx - 0.7, -D * 0.5 + 0.08, main + 0.15), (cx + 0.7, -D * 0.5 + 0.08, main + 0.15), (cx + 0.7, -D * 0.5 + 0.08, main + 1.4), (cx - 0.7, -D * 0.5 + 0.08, main + 1.4))
    return main + rise


# ---------------------------------------------------------------- 配套


def simple_block(mb, a, r, floors, H, wall, *, fin_mat=None, bay_w=3.6, roof="roof_flat", cap=None, glass=None, sill=0.9, win_h=1.9, pier=0.9, over=0.4, balcony_s=False, bal_depth=1.4):
    """学校、医院、幼儿园等普通体量：窗带 + 屋面板 + 女儿墙"""
    W, D = a["w"], a["d"]
    for side in "SNEW":
        L = W if side in "SN" else D
        bays = max(3, round(L / bay_w))
        facade(
            mb,
            side,
            W,
            D,
            0.0,
            floors,
            H,
            bays,
            r,
            wall=wall,
            fin_mat=fin_mat or wall,
            sill=sill,
            win_h=win_h,
            pier=pier,
            glass=glass,
            balcony=(lambda k, i: k >= 1 and i % 2 == 0) if (balcony_s and side == "S") else None,
            bal_depth=bal_depth,
        )
    top = floors * H
    roof_slab(mb, W, D, top, roof, over=over, th=0.35)
    parapet(mb, W, D, top + 0.35, 0.7, 0.25, cap or "wall2")
    return top + 1.05


def school(mb, a, r):
    h = simple_block(mb, a, r, 4, 3.25, "school", fin_mat="school2", bay_w=3.8, roof="roof_flat")
    led_ring(mb, a["w"], a["d"], 4 * 3.25 - 0.05, th=0.2, h=0.2)
    return h


def clinic(mb, a, r):
    h = simple_block(mb, a, r, 4, 3.25, "clinic", fin_mat="wall2", bay_w=3.2, glass=None)
    W, D = a["w"], a["d"]
    # 南面红十字
    zc = 4 * 3.25 - 2.6
    mb.box("cross", -0.5, 0.5, -D / 2 - 0.35, -D / 2 - 0.15, zc - 1.6, zc + 1.6)
    mb.box("cross", -1.6, 1.6, -D / 2 - 0.35, -D / 2 - 0.15, zc - 0.5, zc + 0.5)
    return h


def kindergarten(mb, a, r):
    return simple_block(mb, a, r, 3, 3.5, "school", fin_mat="wall2", bay_w=3.0, roof="green_roof", sill=0.8, win_h=2.0)


def pavilion(mb, a, r, height):
    """物业用房、地铁站口：一层玻璃盒 + 挑檐屋面"""
    W, D = a["w"], a["d"]
    for side in "SNEW":
        L = W if side in "SN" else D
        facade(mb, side, W, D, 0.0, 1, height - 0.5, max(2, round(L / 2.6)), r, sill=0.3, win_h=height - 1.5, pier=0.4, wall="frame", fin_mat="frame", glass="shop_glass", thick=0.3, band=0.05)
    roof_slab(mb, W, D, height - 0.5, "slab", over=0.8, th=0.35)
    led_ring(mb, W + 1.6, D + 1.6, height - 0.55, th=0.15, h=0.18)
    return height


def clubhouse(mb, a, r):
    """会所：中间两层主楼 + 两翼一层，南面柱廊挑檐，通透玻璃"""
    W, D = a["w"], a["d"]
    cw = W * 0.4
    wing_w = (W - cw) / 2
    # 主楼
    for side in "SNEW":
        L = cw if side in "SN" else D
        if side in "EW":
            continue
        facade(mb, side, cw, D, 0.0, 2, 3.6, max(3, round(L / 2.4)), r, sill=0.45, win_h=2.7, pier=0.35, wall="wall2", glass=None, thick=0.35, band=0.1)
    # 主楼山墙（被两翼遮住的部分省掉，只留上层露出的一段）
    for sx in (-1, 1):
        mb.box("wall2", sx * cw / 2 - 0.2 if sx < 0 else sx * cw / 2 - 0.2, sx * cw / 2 + 0.2, -D / 2, D / 2, 3.6, 7.2)
    roof_slab(mb, cw, D, 7.2, "roof_flat", over=0.9, th=0.4)
    led_ring(mb, cw + 1.8, D + 1.8, 6.9, th=0.2, h=0.25)
    # 两翼
    for sx in (-1, 1):
        cx = sx * (cw / 2 + wing_w / 2)
        wd = D * 0.74
        oy = D / 2 - wd / 2
        for side in "SNEW":
            if (sx < 0 and side == "E") or (sx > 0 and side == "W"):
                continue
            L = wing_w if side in "SN" else wd
            facade(mb, side, wing_w, wd, 0.0, 1, 3.8, max(2, round(L / 2.4)), r, off=(cx, oy), sill=0.45, win_h=2.9, pier=0.35, wall="wall2", glass=None, thick=0.35, band=0.1)
        roof_slab(mb, wing_w, wd, 3.8, "roof_flat", over=0.7, th=0.35, off=(cx, oy))
        mb.box("green_roof", cx - wing_w / 2 + 0.6, cx + wing_w / 2 - 0.6, oy - wd / 2 + 0.6, oy + wd / 2 - 0.6, 4.15, 4.3)
    # 南面柱廊
    n = int(cw // 3)
    for i in range(n + 1):
        x = -cw / 2 + i * cw / n
        mb.box("wall2", x - 0.22, x + 0.22, -D / 2 - 2.8, -D / 2 - 2.36, 0.0, 3.8)
    mb.box("slab", -cw / 2 - 0.4, cw / 2 + 0.4, -D / 2 - 3.0, -D / 2, 3.8, 4.1)
    return 7.6


def mall(mb, a, r):
    """商业综合体：L 形三层玻璃幕墙，南面入口雨棚，屋顶金色招牌带"""
    W, D = a["w"], a["d"]  # 44 × 54
    # 北翼：x ∈ [-22, 22], y ∈ [-2, 27]；南翼：x ∈ [-22, 0], y ∈ [-27, -2]
    parts = [
        ("A", 44.0, 29.0, (0.0, 12.5), {"S": (22.0, 44.0), "N": None, "E": None, "W": None}),
        ("B", 22.0, 25.0, (-11.0, -14.5), {"S": None, "N": "skip", "E": None, "W": None}),
    ]
    for name, pw, pd, off, spans in parts:
        for side in "SNEW":
            if name == "B" and side == "N":
                continue
            L = pw if side in "SN" else pd
            span = spans.get(side)
            if side == "S" and name == "A":
                # 北翼的南墙只有东半段露在外面（西半段被南翼接住）
                bays = max(2, round(22.0 / 2.4))
                facade(mb, side, pw, pd, 0.0, 3, 3.4, bays, r, off=off, span=(22.0, 44.0), sill=0.4, win_h=2.5, pier=0.3, wall="wall2", glass=None, thick=0.3, band=0.1)
            else:
                facade(mb, side, pw, pd, 0.0, 3, 3.4, max(3, round(L / 2.4)), r, off=off, sill=0.4, win_h=2.5, pier=0.3, wall="wall2", glass=None, thick=0.3, band=0.1)
        roof_slab(mb, pw, pd, 10.2, "roof_flat", over=0.5, th=0.4, off=off)
        parapet(mb, pw, pd, 10.6, 0.6, 0.25, "wall2", off=off)
    led_ring(mb, 23.0, 26.0, 10.0, off=(-11.0, -14.5), th=0.2, h=0.25)
    # 入口雨棚（南翼南面中间）
    mb.box("slab", -17.0, -5.0, -27.0 - 6.0, -27.0, 4.6, 4.95)
    for x in (-16.2, -5.8):
        mb.box("wall2", x - 0.25, x + 0.25, -27.0 - 5.6, -27.0 - 5.1, 0.0, 4.6)
    # 屋顶招牌带
    mb.box("gold", -20.0, 2.0, -27.2, -26.8, 9.0, 9.7)
    return 11.0


def shop_street(mb, a, r):
    """底商街：沿 y 方向 6 个铺面，西面（朝镜头和小区）是一层通高玻璃店面 + 彩色遮阳篷"""
    W, D = a["w"], a["d"]  # 14 × 120
    n = 6
    seg = D / n
    colors = ["awn_a", "awn_b", "awn_c"]
    for i in range(n):
        oy = -D / 2 + seg * (i + 0.5)
        sd = seg - 0.6
        for side in "SNEW":
            L = W if side in "SN" else sd
            if side == "W":
                # 一层店面：通高玻璃；二层窗
                facade(mb, side, W, sd, 0.0, 1, 3.8, 4, r, off=(0.0, oy), sill=0.2, win_h=3.1, pier=0.5, wall="wall_warm", glass="shop_glass", thick=0.4, band=0.1)
                facade(mb, side, W, sd, 3.8, 1, 3.2, 4, r, off=(0.0, oy), sill=0.8, win_h=1.7, pier=0.9, wall="wall_warm", thick=0.4, band=0.1)
                mb.box(colors[i % 3], -W / 2 - 1.7, -W / 2, oy - sd / 2 + 0.3, oy + sd / 2 - 0.3, 3.35, 3.55, skip=("-z",))
            elif side in "NS":
                facade(mb, side, W, sd, 0.0, 2, 3.5, 4, r, off=(0.0, oy), wall="wall_warm", sill=0.8, win_h=1.8)
            else:
                facade(mb, side, W, sd, 0.0, 2, 3.5, 4, r, off=(0.0, oy), wall="wall_warm", sill=0.8, win_h=1.8)
        roof_slab(mb, W, sd, 7.0, "roof_flat", over=0.35, th=0.3, off=(0.0, oy))
    return 7.3


def gate(mb, a, r, kind):
    """出入口：两根门柱 + 横梁 + 发光门楣；车库口：矮盒 + 深色坡道口"""
    W, D = a["w"], a["d"]
    if kind == "gate":
        horiz = W >= D
        if horiz:
            for sx in (-1, 1):
                mb.box("wall2", sx * (W / 2 - 1.1) - 1.1, sx * (W / 2 - 1.1) + 1.1, -1.4, 1.4, 0.0, 6.0)
                mb.box("gold", sx * (W / 2 - 1.1) - 0.5, sx * (W / 2 - 1.1) + 0.5, -1.45, -1.3, 5.4, 6.2)
            mb.box("slab", -W / 2, W / 2, -1.6, 1.6, 6.0, 6.5)
            mb.box("gold", -W / 2 + 2.2, W / 2 - 2.2, -1.65, -1.5, 5.4, 5.8)
            mb.box("dark", -W / 2 + 2.4, -W / 2 + 6.0, -D / 2, D / 2 + 3.0, 0.0, 2.6)
        else:
            for sy in (-1, 1):
                mb.box("wall2", -1.4, 1.4, sy * (D / 2 - 1.1) - 1.1, sy * (D / 2 - 1.1) + 1.1, 0.0, 6.0)
                mb.box("gold", -1.45, -1.3, sy * (D / 2 - 1.1) - 0.5, sy * (D / 2 - 1.1) + 0.5, 5.4, 6.2)
            mb.box("slab", -1.6, 1.6, -D / 2, D / 2, 6.0, 6.5)
        return 6.6
    # garage
    mb.box("wall2", -W / 2, W / 2, -D / 2, D / 2, 0.0, 1.4)
    mb.quad("dark", (-W / 2 + 1.5, -D / 2 - 0.02, 0.1), (W / 2 - 1.5, -D / 2 - 0.02, 0.1), (W / 2 - 1.5, -D / 2 - 0.02, 1.2), (-W / 2 + 1.5, -D / 2 - 0.02, 1.2))
    mb.box("gold", -W / 2, W / 2, -D / 2 - 0.05, -D / 2 + 0.15, 1.4, 1.55)
    return 1.6


# ---------------------------------------------------------------- 总装


def build_all(layout, M):
    """按 layout.json 建全部楼栋，返回 {id: 高度}"""
    col = collection("BUILDINGS")
    heights = {}

    def put(id_, a, fn, seed, *args):
        mb = MB()
        r = rng(seed)
        h = fn(mb, a, r, *args) if args else fn(mb, a, r)
        # 空物体承载位置，网格和外框盒挂在下面
        empty = bpy.data.objects.new(id_, None)
        empty.location = (a["cx"], a["cy"], 0.0)
        col.objects.link(empty)
        body = mb.build(f"{id_}_body", M, col)
        body.parent = empty
        hull = MB()
        hull.box("hull", -a["w"] / 2, a["w"] / 2, -a["d"] / 2, a["d"] / 2, 0.0, h)
        ho = hull.build(f"{id_}_hull", M, col)
        ho.parent = empty
        heights[id_] = round(float(h), 2)

    for i, b in enumerate(layout["buildings"]):
        fn = {"tower": tower, "terrace": terrace, "villa": villa}[b["kind"]]
        put(b["id"], b, lambda mb, a, r, fn=fn: fn(mb, a, r), 100 + i * 17)
    for a in layout["amenities"]:
        i_ = a["id"]
        if a["shape"] == "building":
            fn = {
                "CL01": clubhouse,
                "SH01": shop_street,
                "SC01": school,
                "HP01": clinic,
                "ML01": mall,
                "KG01": kindergarten,
            }.get(i_)
            if fn:
                put(i_, a, fn, 900 + len(heights))
            elif i_ == "PM01":
                put(i_, a, lambda mb, a, r: pavilion(mb, a, r, 4.2), 1200)
            elif i_ == "MT01":
                put(i_, a, lambda mb, a, r: pavilion(mb, a, r, 5.0), 1300)
        elif a["shape"] == "gate":
            put(i_, a, lambda mb, a, r: gate(mb, a, r, "gate"), 1500)
        elif a["shape"] == "garage":
            put(i_, a, lambda mb, a, r: gate(mb, a, r, "garage"), 1600)
    return heights

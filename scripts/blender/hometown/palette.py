"""
老家沙盘建模 · 材质与程序化贴图
----------------------------------------------------------
贴图全部用 numpy 画（lib.image），存到 models/hometown/textures，导出时打包进 GLB。

立面贴图的约定：一张图 = 一个开间（BAY 米宽）× 一层（STOREY 米高），
墙面按开间 / 层数平铺，窗户正好落在每个开间的中间。
颜色取自用户给的照片：白色条形瓷砖（灰色勾缝、错缝砌）、铝合金推拉窗、
浅绿窗帘、一楼白色防盗窗、墨绿裙砖；红瓦 / 青瓦 / 蓝色彩钢瓦；川北紫红色土。
"""

import bpy
import numpy as np

from . import lib

BAY = 3.6     # 开间宽（米）
STOREY = 3.1  # 层高（米）


def _rgb(hexc):
    c = hexc.lstrip("#")
    return np.array([int(c[i:i + 2], 16) / 255 for i in (0, 2, 4)],
                    dtype=np.float32)


def _noise(h, w, seed, amp):
    """细碎的明暗噪点，避免贴图像塑料。"""
    rng = np.random.default_rng(seed)
    return (rng.random((h, w, 1), dtype=np.float32) - 0.5) * amp


def _tiles(arr, base, grout, rows, cols, seed=1):
    """条形瓷砖：rows 行、每行 cols 块，错缝；arr 原点在左下。"""
    h, w = arr.shape[:2]
    arr[..., :3] = _rgb(base) + _noise(h, w, seed, 0.05)
    th = h / rows
    for r in range(rows):
        y = int(r * th)
        arr[y:y + 1, :, :3] = _rgb(grout)
        off = 0.5 if r % 2 else 0.0
        for c in range(cols + 1):
            x = int((c + off) * w / cols)
            if 0 <= x < w:
                arr[y:int((r + 1) * th), x:x + 1, :3] = _rgb(grout)


def _rect(arr, x0, y0, x1, y1, color):
    """在 0..1 归一化坐标里画实心矩形（左下原点）。"""
    h, w = arr.shape[:2]
    arr[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w), :3] = _rgb(color)


def _window(arr, x0, y0, x1, y1, curtain="#9fcfa6", bars=False,
            frame="#e6e8e8", glass="#2f4a4c"):
    """铝合金推拉窗：外框 + 中梃 + 玻璃（半拉窗帘）；bars=True 加一楼防盗窗。"""
    _rect(arr, x0, y0, x1, y1, frame)
    fw = 0.012
    _rect(arr, x0 + fw, y0 + fw * 2, x1 - fw, y1 - fw * 2, glass)
    # 窗帘：两侧各拉一半，浅绿
    cx = (x0 + x1) / 2
    _rect(arr, x0 + fw, y0 + fw * 2, x0 + (cx - x0) * 0.55, y1 - fw * 2,
          curtain)
    _rect(arr, x1 - (x1 - cx) * 0.55, y0 + fw * 2, x1 - fw, y1 - fw * 2,
          curtain)
    # 中梃（四扇推拉 + 上亮子）
    for k in (0.25, 0.5, 0.75):
        xx = x0 + (x1 - x0) * k
        _rect(arr, xx - fw / 2, y0, xx + fw / 2, y1 - (y1 - y0) * 0.22, frame)
    yy = y1 - (y1 - y0) * 0.22
    _rect(arr, x0, yy - fw, x1, yy + fw, frame)
    if bars:
        for k in np.linspace(0.06, 0.94, 11):
            xx = x0 + (x1 - x0) * k
            _rect(arr, xx - 0.004, y0, xx + 0.004, y1, "#f2f2f0")
        for k in (0.33, 0.66):
            yy = y0 + (y1 - y0) * k
            _rect(arr, x0, yy - 0.004, x1, yy + 0.004, "#f2f2f0")


def _facade(name, base, grout, window=True, ground=False, plinth=None,
            curtain="#9fcfa6", seed=1):
    """一开间一层的立面贴图（256×224，约 1.4 cm/px）。"""
    def paint(a):
        _tiles(a, base, grout, rows=22, cols=10, seed=seed)
        if plinth:  # 一楼墙脚的深色裙砖（约 0.9 m）
            h = a.shape[0]
            a[:int(h * 0.29), :, :3] = _rgb(plinth) + _noise(
                int(h * 0.29), a.shape[1], seed + 7, 0.04)
            for r in range(4):
                a[int(h * 0.29 * r / 4), :, :3] = _rgb("#1e2b22")
        if window:
            # 窗洞 1.8 × 1.5 m，窗台高 0.9 m
            _window(a, 0.25, 0.29, 0.75, 0.78, curtain=curtain, bars=ground)
    return lib.image(name, 256, 224, paint)


def _stripes(name, w, h, c0, c1, period, axis=0, jitter=0.0, seed=0):
    """条纹贴图（瓦垄、彩钢瓦楞、稻行、菜畦）。axis=0 竖条纹，1 横条纹。"""
    def paint(a):
        n = a.shape[1] if axis == 0 else a.shape[0]
        t = (np.arange(n) % period) / period
        prof = 0.5 + 0.5 * np.cos(t * 2 * np.pi)
        col = _rgb(c0)[None, :] * (1 - prof[:, None]) + \
            _rgb(c1)[None, :] * prof[:, None]
        if axis == 0:
            a[..., :3] = col[None, :, :]
        else:
            a[..., :3] = col[:, None, :]
        if jitter:
            a[..., :3] += _noise(a.shape[0], a.shape[1], seed, jitter)
    return lib.image(name, w, h, paint)


def _speckle(name, base, dots, density, size=1, seed=0, w=256):
    """底色 + 随机色点（土地、碎石、回收料堆）。"""
    def paint(a):
        a[..., :3] = _rgb(base) + _noise(w, w, seed, 0.08)
        rng = np.random.default_rng(seed)
        n = int(w * w * density)
        ys = rng.integers(0, w, n)
        xs = rng.integers(0, w, n)
        cs = [_rgb(c) for c in dots]
        for i in range(n):
            c = cs[i % len(cs)]
            a[ys[i]:ys[i] + size, xs[i]:xs[i] + size, :3] = c
    return lib.image(name, w, w, paint)


def _soil(name):
    """沙盘切面：川北紫红土分层，顶部一层深色表土 + 草根。"""
    def paint(a):
        h = a.shape[0]
        rng = np.random.default_rng(5)
        a[..., :3] = _rgb("#8a5444") + _noise(h, a.shape[1], 5, 0.06)
        y = 0
        while y < h:  # 不规则的水平分层
            t = int(rng.integers(6, 22))
            c = _rgb(rng.choice(["#7d4a3c", "#94604d", "#6f4236", "#a26a52"]))
            a[y:y + t, :, :3] = c + _noise(min(t, h - y), a.shape[1],
                                           int(y), 0.06)
            y += t
        top = int(h * 0.08)
        a[h - top:, :, :3] = _rgb("#4a3427") + _noise(top, a.shape[1], 9, 0.06)
        a[h - 3:, :, :3] = _rgb("#5d7a3a")
    return lib.image(name, 256, 256, paint)


def _bank_mix(mat, grass_img):
    """田地材质：按顶点属性 bank 把本身的贴图和草坎贴图平滑混合（田坎边缘顺着等高线走）。
    只在 Blender 里生效；网页版用烘焙后的地面贴图，混合结果会一起烘进去。"""
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
    g = nt.nodes.new("ShaderNodeTexImage")
    g.image = grass_img
    at = nt.nodes.new("ShaderNodeAttribute")
    at.attribute_name = "bank"
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.45
    mr.inputs["From Max"].default_value = 0.7
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(at.outputs["Fac"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], mix.inputs["Factor"])
    nt.links.new(tex.outputs["Color"], mix.inputs["A"])
    nt.links.new(g.outputs["Color"], mix.inputs["B"])
    # 田埂中线：一条踩出来的土路（权重 0.82 以上渐变成土路贴图）
    pt = nt.nodes.new("ShaderNodeTexImage")
    pt.image = bpy.data.images["g_path"]
    mr2 = nt.nodes.new("ShaderNodeMapRange")
    mr2.inputs["From Min"].default_value = 0.82
    mr2.inputs["From Max"].default_value = 0.93
    mix2 = nt.nodes.new("ShaderNodeMix")
    mix2.data_type = "RGBA"
    nt.links.new(at.outputs["Fac"], mr2.inputs["Value"])
    nt.links.new(mr2.outputs["Result"], mix2.inputs["Factor"])
    nt.links.new(mix.outputs["Result"], mix2.inputs["A"])
    nt.links.new(pt.outputs["Color"], mix2.inputs["B"])
    nt.links.new(mix2.outputs["Result"], bsdf.inputs["Base Color"])


def build():
    """创建全部材质，返回 {名字: 材质}。"""
    M = {}
    m = lib.material
    # ---------------- 地面（贴图按世界坐标平铺，见 terrain.py 的 UV）
    M["paddy"] = m("G_paddy", tex=_stripes("g_rice", 64, 256, "#4f8f2c",
                                           "#78b23a", 16, axis=1,
                                           jitter=0.10, seed=1), rough=0.8)
    M["bund"] = m("G_bund", tex=_speckle("g_bund", "#5f8a3a",
                                         ["#4d7330", "#7a9a4a", "#6b5a3a"],
                                         0.05, 2, seed=2), rough=0.95)
    M["dry"] = m("G_dry", tex=_stripes("g_dry", 64, 256, "#a98a5c",
                                       "#c2a675", 24, axis=1, jitter=0.12,
                                       seed=3), rough=1.0)
    M["veg"] = m("G_veg", tex=_stripes("g_veg", 64, 256, "#7a6045",
                                       "#78a83e", 20, axis=1, jitter=0.12,
                                       seed=4), rough=0.9)
    M["wood"] = m("G_wood", tex=_speckle("g_wood", "#3f5a2c",
                                         ["#2f4722", "#55703a", "#5a4a32"],
                                         0.10, 2, seed=5), rough=1.0)
    M["pond_bed"] = m("G_pondbed", "#3b4a3a", rough=1.0)
    M["yard"] = m("G_yard", tex=_speckle("g_concrete", "#b9b4aa",
                                         ["#a7a298", "#c9c4ba", "#8f8a80"],
                                         0.06, 2, seed=6), rough=0.9)
    M["factory"] = m("G_factory", tex=_speckle("g_factory", "#a9a49a",
                                               ["#8f8a80", "#c0bbb1",
                                                "#7a756c"], 0.08, 2, seed=7),
                     rough=0.95)
    M["rubble"] = m("G_rubble", tex=_speckle("g_rubble", "#c9c6bd",
                                             ["#e8e6e0", "#9a978e",
                                              "#6f8fb0", "#b08f6a"], 0.25, 3,
                                             seed=8), rough=1.0)
    M["road"] = m("G_road", tex=_speckle("g_road", "#c8c2b4",
                                         ["#b5afa1",
                                          "#d6d0c2", "#9e988a"], 0.05, 2,
                                         seed=9), rough=0.85)
    M["path"] = m("G_path", tex=_speckle("g_path", "#b7ab90",
                                         ["#a49879", "#c8bca2", "#8d826a"],
                                         0.08, 2, seed=10), rough=0.95)
    M["house"] = M["yard"]
    for k in ("paddy", "dry", "veg"):
        _bank_mix(M[k], bpy.data.images["g_bund"])
    M["soil"] = m("G_soil", tex=_soil("g_soil"), rough=1.0)
    M["water"] = m("G_water", "#4f6f63", rough=0.06, metal=0.0)

    # ---------------- 立面
    for key, base, grout in (("white", "#eceae4", "#b9b7b1"),
                             ("cream", "#e8dcb6", "#bdb08c"),
                             ("pink", "#e9b9a6", "#c49484")):
        M[f"wall_{key}"] = m(f"W_{key}", tex=_facade(f"f_{key}", base, grout,
                                                     seed=11), rough=0.35)
        M[f"wall_{key}_gf"] = m(f"W_{key}_gf", tex=_facade(
            f"f_{key}_gf", base, grout, ground=True, plinth="#2f4a3a",
            seed=12), rough=0.35)
        M[f"wall_{key}_plain"] = m(f"W_{key}_plain", tex=_facade(
            f"f_{key}_plain", base, grout, window=False, seed=13), rough=0.35)
    M["wall_home"] = m("W_home", tex=_facade("f_home", "#efede8", "#b3b1ab",
                                             curtain="#a8d8b0", seed=14),
                       rough=0.3)
    M["wall_home_gf"] = m("W_home_gf", tex=_facade(
        "f_home_gf", "#efede8", "#b3b1ab", ground=True, curtain="#a8d8b0",
        seed=15), rough=0.3)
    M["wall_home_plain"] = m("W_home_plain", tex=_facade(
        "f_home_plain", "#efede8", "#b3b1ab", window=False, seed=16),
        rough=0.3)

    def old_wall(a):
        # 穿斗木结构：白灰墙 + 深色木梁柱
        a[..., :3] = _rgb("#e4dccb") + _noise(a.shape[0], a.shape[1], 17, 0.05)
        h, w = a.shape[:2]
        for x in (0, 0.33, 0.66):
            _rect(a, x, 0, x + 0.035, 1, "#5a3f2a")
        for y in (0.0, 0.42, 0.95):
            _rect(a, 0, y, 1, y + 0.04, "#5a3f2a")
        a[:int(h * 0.22), :, :3] = _rgb("#9d968a") + _noise(int(h * 0.22), w,
                                                            18, 0.06)
        _rect(a, 0.45, 0.22, 0.62, 0.42, "#3a2a1e")  # 小木窗
    M["wall_old"] = m("W_old", tex=lib.image("f_old", 256, 224, old_wall),
                      rough=0.9)
    M["wall_shed"] = m("W_shed", tex=_stripes("f_shed", 128, 128, "#9ea3a5",
                                              "#b8bcbd", 8, axis=0,
                                              jitter=0.05, seed=19),
                       rough=0.6, metal=0.2)
    M["wall_brick"] = m("W_brick", tex=lib.image(
        "f_brick", 128, 128, lambda a: _tiles(a, "#a8664e", "#8c8a84", 16, 6,
                                              seed=20)), rough=0.9)

    # ---------------- 屋面
    M["roof_red"] = m("R_red", tex=_stripes("r_red", 128, 64, "#a8432c",
                                            "#c8613f", 8, axis=0,
                                            jitter=0.08, seed=21), rough=0.6)
    M["roof_brown"] = m("R_brown", tex=_stripes("r_brown", 128, 64, "#6b4a36",
                                                "#8a6248", 8, axis=0,
                                                jitter=0.08, seed=26), rough=0.7)
    M["roof_grey"] = m("R_grey", tex=_stripes("r_grey", 128, 64, "#3e3f40",
                                              "#5d5f60", 8, axis=0,
                                              jitter=0.08, seed=22), rough=0.8)
    M["roof_blue"] = m("R_blue", tex=_stripes("r_blue", 128, 64, "#2d64b8",
                                              "#4a86d6", 6, axis=0,
                                              jitter=0.03, seed=23),
                       rough=0.35, metal=0.3)
    M["roof_white"] = m("R_white", tex=_stripes("r_white", 128, 64,
                                                "#c9cccd", "#e9ebeb", 6,
                                                axis=0, jitter=0.03, seed=24),
                        rough=0.4, metal=0.3)
    M["roof_flat"] = m("R_flat", tex=_speckle("r_flat", "#9d9a93",
                                              ["#8a877f", "#aeaba3"], 0.06, 2,
                                              seed=25), rough=0.9)
    M["glazed"] = m("R_glazed", "#b8462c", rough=0.3)   # 琉璃瓦檐口
    M["band_red"] = m("B_red", "#8e2f2a", rough=0.5)    # 楼层间红色腰线
    M["band_grey"] = m("B_grey", "#9a9892", rough=0.6)  # 楼板 / 挑檐
    M["steel"] = m("S_steel", "#8d9295", metal=0.6, rough=0.4)
    M["gate"] = m("S_gate", "#3a4046", metal=0.5, rough=0.45)   # 地坝铁门
    # 我家门窗（几何窗，不靠立面贴图）
    M["win_frame"] = m("H_win_frame", "#e9ebea", rough=0.35, metal=0.2)
    M["glass"] = m("H_glass", "#1f2b2e", rough=0.08, metal=0.0,
                   emit="#ffb866", strength=0.0)   # 夜里由页面点亮
    M["curtain"] = m("H_curtain", "#9fd3a8", rough=0.8)
    M["ditch_water"] = m("H_ditch", "#2c3a33", rough=0.1)   # 排水沟里的积水
    # 新修那栋的右侧、背面：普通水泥砂浆粉刷（灰色、带抹灰的细斑）
    M["wall_cement"] = m("H_cement", tex=_speckle("h_cement", "#a9a69e",
                                                  ["#9b988f", "#b6b3ab", "#8d8a82"],
                                                  0.12, 2, seed=37), rough=0.95)
    # 我家屋顶：红色筒瓦（参考 ref/roof-red-barrel.webp）、深灰小青瓦（ref/roof-grey-tile.webp）
    M["barrel"] = m("H_barrel", "#c9714f", rough=0.55)
    M["barrel_lip"] = m("H_barrel_lip", "#a4513a", rough=0.6)
    M["barrel_under"] = m("H_barrel_under", "#6e3424", rough=0.8)
    M["greytile"] = m("H_greytile", "#5a5e60", rough=0.85)
    M["greytile_lip"] = m("H_greytile_lip", "#43474a", rough=0.85)
    M["greytile_under"] = m("H_greytile_under", "#2c2f31", rough=0.9)
    M["bars"] = m("H_bars", "#e4e4e0", rough=0.4, metal=0.3)
    M["stone"] = m("H_stone", tex=_speckle("h_stone", "#8e8a82",
                                           ["#7b776f", "#a29e95", "#6a665f"],
                                           0.08, 2, seed=31), rough=0.95)
    M["rail"] = m("S_rail", "#f1efe9", rough=0.4)       # 宝瓶栏杆
    M["door"] = m("D_door", "#3a2a1f", rough=0.6)
    M["door_dark"] = m("D_dark", "#141210", rough=0.9)  # 堂屋门洞
    M["couplet"] = m("D_couplet", "#c21f1a", rough=0.6)
    M["lantern"] = m("D_lantern", "#d8261c", emit="#ff4a2a", strength=0.0,
                     rough=0.4)
    M["plaque"] = m("D_plaque", "#6b2a1e", rough=0.5)
    M["dish"] = m("D_dish", "#d9d9d6", rough=0.4)
    # ---------------- 植物
    M["leaf_cypress"] = m("T_cypress", "#2c4a2a", rough=0.9)
    M["leaf_broad"] = m("T_broad", "#3f6b2e", rough=0.9)
    M["leaf_bamboo"] = m("T_bamboo", "#6a9a3a", rough=0.85)
    M["leaf_loquat"] = m("T_loquat", "#2f5a2a", rough=0.8)
    M["trunk"] = m("T_trunk", "#4a3a2c", rough=1.0)
    M["culm"] = m("T_culm", "#7f9a4a", rough=0.5)        # 竹竿
    M["pole"] = m("P_pole", "#8f8b82", rough=0.9)       # 水泥电线杆
    M["wire"] = m("P_wire", "#1c1c1c", rough=0.6)
    return M

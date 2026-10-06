"""
智慧充电站建模 · 材质与贴图
----------------------------------------------------------
所有材质集中在这里，按名字复用（M_xxx）。three.js 侧按材质名 / 对象名替换状态色，
所以状态类材质（M_status_*）只是 Blender 预览用的默认值。

贴图全部用 numpy 程序化绘制后存成 PNG，导出时打包进 GLB，不依赖外部素材。
配色取自设计稿：底色深海军蓝，结构发光青色，储能 / 正常绿色，告警红色。
"""

import numpy as np

from . import lib

# 设计稿主色
CYAN = "#2de2e6"
BLUE = "#2f9bff"
GREEN = "#34e07a"
RED = "#ff3b47"
AMBER = "#ffb020"

# 桩 / 车位状态色：充电中绿、空闲蓝、故障红、离线灰
STATUS = {"charging": GREEN, "idle": BLUE, "fault": RED, "offline": "#5d6876"}


def _noise(h, w, seed, scale=1.0):
    rng = np.random.default_rng(seed)
    return rng.random((h, w)).astype(np.float32) * scale


# ---------------------------------------------------------------- 贴图


def tex_asphalt():
    """沥青：多尺度骨料颗粒 + 淡淡油渍，偏冷的深灰；1024 可平铺（盒式投影 6 m 一块）"""

    def paint(a):
        h, w = a.shape[:2]
        n1 = _noise(h, w, 1)
        n2 = np.kron(_noise(h // 4, w // 4, 2), np.ones((4, 4), dtype=np.float32))
        n3 = np.kron(_noise(h // 32, w // 32, 3), np.ones((32, 32), dtype=np.float32))
        # 骨料亮点：少量明显的小白点
        grit = (n1 > 0.985).astype(np.float32) * 0.08
        v = 0.085 + n1 * 0.035 + n2 * 0.02 + n3 * 0.025 + grit
        a[..., 0] = v * 0.86
        a[..., 1] = v * 0.93
        a[..., 2] = v * 1.08

    return lib.image("T_asphalt", 1024, 1024, paint)


def tex_pavers():
    """人行道铺装：60 × 30 cm 错缝砖，带细灰缝与砖面明暗变化"""

    def paint(a):
        h, w = a.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        rng = np.random.default_rng(5)
        bw, bh = w / 4, h / 8
        row = np.floor(yy / bh)
        xo = xx + (row % 2) * bw / 2
        col = np.floor(xo / bw)
        tone = rng.random((9, 6))[row.astype(int) % 9, col.astype(int) % 6]
        v = 0.22 + tone * 0.06 + _noise(h, w, 9) * 0.03
        joint = (np.mod(yy, bh) < 2) | (np.mod(xo, bw) < 2)
        v[joint] = 0.1
        a[..., 0] = v * 0.92
        a[..., 1] = v * 0.96
        a[..., 2] = v * 1.04

    return lib.image("T_pavers", 512, 512, paint)


def tex_pv():
    """
    光伏板：深蓝单晶电池片 6×10（片间缝只比底色略亮，近看才有纹理）+ 一圈细亮边框。
    不画高光：同一张贴图每块板重复使用，画进去的高光会变成一格一格的重复图案；
    整片阵列连续的反光带交给 three.js 着色器（scene/pvSheen.js），每块板的深浅交给顶点色
    """

    def paint(a):
        h, w = a.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        base = np.stack([0.05 + 0 * xx, 0.13 + 0 * xx, 0.38 + 0 * xx], -1)
        a[..., :3] = base
        cw, ch = w / 6, h / 10
        grid = (np.mod(xx, cw) < 2) | (np.mod(yy, ch) < 2)
        a[grid, :3] = [0.11, 0.24, 0.52]
        bus = (np.abs(np.mod(xx, cw) - cw / 2) < 0.7) & ~grid
        a[bus, :3] = [0.08, 0.19, 0.46]
        frame = (xx < 4) | (xx > w - 5) | (yy < 4) | (yy > h - 5)
        a[frame, :3] = [0.50, 0.68, 0.95]

    return lib.image("T_pv", 384, 640, paint)


def _link_alpha(mat):
    """把贴图的 Alpha 接到 BSDF 的 Alpha（glTF 导出为 alphaMode BLEND，three.js 里按透明处理）"""
    nt = mat.node_tree
    tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])


def _multiply_vertex_color(mat, layer):
    """在 贴图 → Base Color 之间插入「× 顶点色」，glTF 导出时据此带上 COLOR_0"""
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = layer
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 1.0
    a = next(i for i in mix.inputs if i.identifier == "A_Color")
    b = next(i for i in mix.inputs if i.identifier == "B_Color")
    out = next(o for o in mix.outputs if o.identifier == "Result_Color")
    nt.links.new(tex.outputs["Color"], a)
    nt.links.new(vc.outputs["Color"], b)
    nt.links.new(out, bsdf.inputs["Base Color"])


def tex_fence():
    """围栏钢丝网：深灰网格线不透明，网眼几乎全透明（alpha 通道），俯视能看出网格又不挡后面的柜子"""

    def paint(a):
        h, w = a.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        wire = (np.mod(xx, 16) < 2) | (np.mod(yy, 16) < 2)
        a[..., :3] = [0.30, 0.36, 0.36]
        a[..., 3] = np.where(wire, 0.9, 0.06)

    return lib.image("T_fence", 128, 128, paint)


def tex_ess():
    """储能柜正面：黑底上 2 列 × 8 行发光电池模组，单元亮度随机，营造运行中的效果"""

    def paint(a):
        h, w = a.shape[:2]
        a[..., :3] = [0.01, 0.04, 0.02]
        rng = np.random.default_rng(7)
        for c in range(3):
            for r in range(8):
                x0 = 8 + c * 40
                y0 = 10 + r * 30
                k = 0.55 + rng.random() * 0.45
                a[y0 : y0 + 22, x0 : x0 + 34, :3] = np.array([0.20, 1.0, 0.36]) * k
                a[y0 + 4 : y0 + 7, x0 + 4 : x0 + 30, :3] = [0.85, 1.0, 0.85]

    return lib.image("T_ess", 128, 256, paint)


def tex_screen(name, accent):
    """
    桩屏 / 价格立柱屏：深蓝底；顶部状态栏、中部大号 SOC 进度环、下方功率柱与信息行、底部按钮。
    192 × 320，近看也不糊
    """
    acc = np.array(accent, dtype=np.float32)

    def paint(a):
        h, w = a.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        g = np.clip(yy / h, 0, 1)[..., None]
        a[..., :3] = np.array([0.01, 0.03, 0.09]) * (1 - g) + np.array([0.02, 0.07, 0.16]) * g
        a[h - 26 : h - 10, 12 : w - 12, :3] = acc * 0.85  # 顶部状态栏
        a[h - 22 : h - 14, 18 : 60, :3] = [0.9, 0.97, 1.0]
        cx, cy, r = w / 2, h * 0.6, w * 0.3
        d = np.hypot(xx - cx, yy - cy)
        ang = (np.arctan2(yy - cy, xx - cx) + np.pi) / (2 * np.pi)
        ring = (d > r - 10) & (d < r)
        a[ring & (ang < 0.68), :3] = acc
        a[ring & (ang >= 0.68), :3] = [0.07, 0.13, 0.24]
        core = d < r * 0.45
        a[core, :3] = a[core, :3] * 0.5 + acc * 0.25
        for i in range(8):  # 功率柱
            hh = int(18 + 30 * abs(np.sin(i * 1.3)))
            x0 = 18 + i * 20
            a[int(h * 0.25) : int(h * 0.25) + hh, x0 : x0 + 12, :3] = acc * 0.7
        for i in range(3):  # 信息行
            y0 = int(h * 0.12) + i * 12
            a[y0 : y0 + 5, 16 : int(w * (0.45 + 0.15 * i)), :3] = [0.35, 0.55, 0.82]
        a[8:26, 16 : w // 2 - 6, :3] = [0.1, 0.55, 0.3]  # 底部按钮
        a[8:26, w // 2 + 6 : w - 16, :3] = [0.55, 0.15, 0.18]

    return lib.image(name, 192, 320, paint)


def tex_videowall():
    """监控大屏墙：4×2 块屏，每块有折线 / 柱状 / 地图色块，整体偏蓝"""

    def paint(a):
        h, w = a.shape[:2]
        a[..., :3] = [0.01, 0.02, 0.05]
        rng = np.random.default_rng(3)
        bw, bh = w // 4, h // 2
        for c in range(4):
            for r in range(2):
                x0, y0 = c * bw + 4, r * bh + 4
                a[y0 : y0 + bh - 8, x0 : x0 + bw - 8, :3] = [0.03, 0.12, 0.30]
                kind = (c + r) % 3
                if kind == 0:  # 折线
                    pts = rng.random(10) * (bh - 30) + 10
                    for i in range(9):
                        for t in np.linspace(0, 1, 20):
                            x = int(x0 + 8 + (i + t) * (bw - 24) / 9)
                            y = int(y0 + pts[i] * (1 - t) + pts[i + 1] * t)
                            a[y : y + 3, x : x + 2, :3] = [0.2, 0.9, 1.0]
                elif kind == 1:  # 柱状
                    for i in range(8):
                        hh = int(rng.random() * (bh - 30)) + 8
                        x = x0 + 10 + i * (bw - 20) // 8
                        a[y0 + 8 : y0 + 8 + hh, x : x + 10, :3] = [0.2, 0.6, 1.0]
                else:  # 地图色块
                    for _ in range(14):
                        x = x0 + int(rng.random() * (bw - 30)) + 6
                        y = y0 + int(rng.random() * (bh - 30)) + 6
                        a[y : y + 14, x : x + 20, :3] = [0.1, 0.5, 0.9] if rng.random() > 0.3 else [0.2, 1.0, 0.5]

    return lib.image("T_videowall", 512, 192, paint)


def tex_warning():
    """黄色三角高压警示牌"""

    def paint(a):
        h, w = a.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        a[..., :3] = [0.05, 0.05, 0.05]
        inside = (yy > 8) & (yy < h - 10) & (np.abs(xx - w / 2) < (h - 10 - yy) * 0.58)
        a[inside, :3] = [1.0, 0.72, 0.05]
        bolt = (np.abs(xx - w / 2 - (yy - h * 0.4) * 0.3) < 4) & (yy > h * 0.2) & (yy < h * 0.65)
        a[bolt, :3] = [0.05, 0.05, 0.05]

    return lib.image("T_warning", 64, 64, paint)


# ---------------------------------------------------------------- 材质


def build():
    """创建全部材质，返回 dict：名字 → 材质"""
    T = {
        "asphalt": tex_asphalt(),
        "pv": tex_pv(),
        "ess": tex_ess(),
        "fence": tex_fence(),
        "screen": tex_screen("T_screen", (0.15, 0.65, 1.0)),
        "screen_super": tex_screen("T_screen_super", (0.18, 0.9, 0.9)),
        "totem": tex_screen("T_totem", (0.2, 0.8, 1.0)),
        "video": tex_videowall(),
        "warn": tex_warning(),
        "pavers": tex_pavers(),
    }
    M = {}
    m = lib.material

    # 地面与沙盘
    M["asphalt"] = m("M_asphalt", "#ffffff", rough=0.55, tex=T["asphalt"])  # 微湿路面，略有反光
    M["sidewalk"] = m("M_sidewalk", "#ffffff", rough=0.8, tex=T["pavers"])
    M["curb"] = m("M_curb", "#6b7686", rough=0.7)
    M["base"] = m("M_base", "#1a2230", metal=0.7, rough=0.34)  # 沙盘侧壁：深灰金属，底部打上蓝光后能读出立面
    M["base_top"] = m("M_base_top", "#16233a", metal=0.6, rough=0.4)
    M["grass"] = m("M_grass", "#173f2b", rough=0.95)
    M["soil"] = m("M_soil", "#2a2622", rough=0.95)
    M["planter"] = m("M_planter", "#4a5464", rough=0.6)

    # 发光件
    M["led_edge"] = m("M_led_edge", "#2a7fff", emit="#2a7fff", strength=5)  # 沙盘边缘细灯带（设计稿里是偏蓝的细线）
    M["led_cyan"] = m("M_led_cyan", CYAN, emit=CYAN, strength=6)
    M["led_blue"] = m("M_led_blue", BLUE, emit=BLUE, strength=5)
    M["lane"] = m("M_lane", "#3aa8ff", emit="#3aa8ff", strength=2.5)
    M["paint"] = m("M_paint", "#d8dee6", rough=0.7)
    M["light_warm"] = m("M_light_warm", "#fff1d6", emit="#ffe7c2", strength=8)
    M["led_canopy"] = m("M_led_canopy", "#3f9bff", emit="#3f9bff", strength=4)  # 雨棚檐口细灯带
    M["light_cool"] = m("M_light_cool", "#eaf6ff", emit="#eaf6ff", strength=6)
    for k, c in STATUS.items():
        M["status_" + k] = m("M_status_" + k, c, emit=c, strength=5 if k != "offline" else 0.3)
    M["alarm"] = m("M_alarm", RED, emit=RED, strength=6)

    # 设备
    M["white"] = m("M_white", "#e6ebf0", metal=0.15, rough=0.28)
    M["graphite"] = m("M_graphite", "#20262e", metal=0.6, rough=0.35)
    M["dark"] = m("M_dark", "#12161c", metal=0.3, rough=0.5)
    M["steel"] = m("M_steel", "#4a5563", metal=0.85, rough=0.32)
    M["steel_dark"] = m("M_steel_dark", "#2c333d", metal=0.8, rough=0.35)
    M["roof"] = m("M_roof", "#2a323e", metal=0.5, rough=0.45)
    M["screen"] = m("M_screen", "#000000", emit="#ffffff", tex=T["screen"], emit_tex=True, strength=2.5)
    M["screen_super"] = m("M_screen_super", "#000000", emit="#ffffff", tex=T["screen_super"], emit_tex=True, strength=2.5)
    M["totem_screen"] = m("M_totem_screen", "#000000", emit="#ffffff", tex=T["totem"], emit_tex=True, strength=3)
    # 光伏：贴图 × 每块板的顶点色（明暗不一）；反光带在 three.js 里由 scene/pvSheen.js 叠加
    M["pv"] = m("M_pv", "#ffffff", metal=0.2, rough=0.2, tex=T["pv"])
    _multiply_vertex_color(M["pv"], "Col")
    # 储能柜（对照设计稿）：柜体是浅灰绿色哑光钣金、不发光；只有角柱、顶沿和门缝的细灯带发绿光，
    # 正面一块小状态屏（电池模组贴图）
    M["ess_face"] = m("M_ess_face", "#000000", emit="#ffffff", tex=T["ess"], emit_tex=True, strength=2.5)
    M["ess_body"] = m("M_ess_body", "#a7b8b1", metal=0.25, rough=0.5)
    M["ess_frame"] = m("M_ess_frame", "#2a3532", metal=0.6, rough=0.4)
    M["ess_led"] = m("M_ess_led", GREEN, emit=GREEN, strength=9)
    # 储能区围栏：深灰钢丝网（贴图 alpha 控制网眼透明），不发光
    M["fence_mesh"] = m("M_fence_mesh", "#ffffff", metal=0.4, rough=0.5, tex=T["fence"], alpha=0.99)
    _link_alpha(M["fence_mesh"])
    M["transformer"] = m("M_transformer", "#363f4b", metal=0.6, rough=0.45)
    M["warn"] = m("M_warn", "#ffffff", tex=T["warn"], rough=0.5)
    M["cable"] = m("M_cable", "#15191f", rough=0.6)
    M["glass_dark"] = m("M_glass_dark", "#05080d", metal=0.6, rough=0.08)
    M["chrome"] = m("M_chrome", "#c9d2dc", metal=1.0, rough=0.15)

    # 车辆
    M["glass"] = m("M_car_glass", "#1a2a3e", metal=0.35, rough=0.04)  # 偏蓝的反光玻璃，俯视能读出车窗
    M["tyre"] = m("M_tyre", "#0b0d10", rough=0.9)
    M["rim"] = m("M_rim", "#9aa3ad", metal=0.95, rough=0.25)
    M["headlight"] = m("M_headlight", "#e8f6ff", emit="#e8f6ff", strength=3)
    M["taillight"] = m("M_taillight", "#ff2a3a", emit="#ff2a3a", strength=5)
    # 漆色与 src/views/charging/scene/theme.js 的 PAINT_COLOR 一致
    for k, c in {"black": "#16191e", "graphite": "#3a414b", "silver": "#a7afb8", "white": "#e9edf1", "blue": "#2c4f7a", "red": "#7a2a30"}.items():
        M["paint_" + k] = m("M_paint_" + k, c, metal=0.75, rough=0.22)
    # 导出用的通用车漆：cars.glb 每款车只导出一份，three.js 按名字 M_car_paint 找到车漆再换色
    M["car_paint"] = m("M_car_paint", "#e9edf1", metal=0.75, rough=0.22)

    # 建筑
    M["wall"] = m("M_wall", "#cfd6df", rough=0.6)
    M["floor"] = m("M_floor", "#3a4352", rough=0.5)
    M["glass_bld"] = m("M_glass_bld", "#7fb8ff", metal=0.1, rough=0.05, alpha=0.16)
    M["wood"] = m("M_wood", "#6b5440", rough=0.6)
    M["fabric"] = m("M_fabric", "#3d5f86", rough=0.8)
    M["fabric_light"] = m("M_fabric_light", "#b9c2cc", rough=0.8)
    M["video"] = m("M_video", "#000000", emit="#ffffff", tex=T["video"], emit_tex=True, strength=2.5)
    M["monitor"] = m("M_monitor", "#000000", emit="#2f8fff", strength=3)
    M["vending"] = m("M_vending", "#000000", emit="#38c8ff", strength=2.5)

    # 植物
    M["leaf"] = m("M_leaf", "#1f5a3a", rough=0.85)
    M["leaf2"] = m("M_leaf2", "#2a6e45", rough=0.85)
    M["trunk"] = m("M_trunk", "#3b2f26", rough=0.9)
    return M

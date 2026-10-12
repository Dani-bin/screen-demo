"""
综合能源补给站建模 · 材质与贴图
----------------------------------------------------------
所有材质集中在这里，按名字复用（M_xxx）。three.js 侧按材质名 / 对象名替换状态色与发光强度，
所以状态类材质（M_status_*）只是 Blender 预览用的默认值。

贴图全部用 numpy 程序化绘制后存成 PNG，导出时打包进 GLB，不依赖外部素材。
沥青 / 铺装 / 光伏 / 围栏 / 屏幕 / 警示牌贴图沿用 charging/palette.py 的画法。
配色取自设计稿 03-dashboard-v1：深海军蓝底；结构青色；加油橙色、LNG 紫色、充电绿色、换电青色。
"""

import numpy as np

from . import lib

# 设计稿主色
CYAN = "#2de2e6"
BLUE = "#2f9bff"
GREEN = "#34e07a"
RED = "#ff3b47"
AMBER = "#ffb020"
FUEL = "#ff8a3d"  # 加油机
CANOPY = "#36b8ff"  # 加油加气罩棚檐口
LNG = "#b07cff"  # LNG 加气站 / 储罐
SWAP = "#22c7e8"  # 换电站

# 超充位状态色：充电中绿、空闲蓝、告警红、离线灰
STATUS = {"charging": GREEN, "idle": BLUE, "fault": RED, "offline": "#5d6876"}

# ---------------------------------------------------------------- 贴图（沿用 charging 的画法）

def _noise(h, w, seed, scale=1.0):
    rng = np.random.default_rng(seed)
    return rng.random((h, w)).astype(np.float32) * scale



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



def tex_price(name, logo=False):
    """
    价格立柱的屏：logo=True 为站标（蓝底白色闪电圆标），否则为价格屏（亮青蓝底 + 白色油品名与数字块），
    设计稿里立柱上是一串亮青蓝色的横向灯箱
    """

    def paint(a):
        h, w = a.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        if logo:
            a[..., :3] = [0.05, 0.25, 0.75]
            d = np.hypot(xx - w / 2, yy - h / 2)
            a[(d > h * 0.28) & (d < h * 0.36), :3] = [0.95, 0.98, 1.0]
            bolt = (np.abs((xx - w / 2) + (yy - h / 2) * 0.45) < 6) & (np.abs(yy - h / 2) < h * 0.22)
            a[bolt, :3] = [1.0, 0.85, 0.3]
            return
        g = np.clip(yy / h, 0, 1)[..., None]
        a[..., :3] = np.array([0.12, 0.55, 0.95]) * (0.8 + 0.2 * g)
        a[int(h * 0.3) : int(h * 0.7), int(w * 0.07) : int(w * 0.3), :3] = [0.92, 0.97, 1.0]  # 油品名
        for i in range(4):  # 价格数字块
            x0 = int(w * (0.45 + i * 0.13))
            a[int(h * 0.22) : int(h * 0.78), x0 : x0 + int(w * 0.09), :3] = [1.0, 1.0, 1.0]

    return lib.image(name, 256, 128, paint)


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



def tex_lane_dash():
    """道路白色虚线：上半段白、下半段透明（6 m 一个周期，线长 3 m），用在门前道路的车道分隔线"""

    def paint(a):
        h, w = a.shape[:2]
        a[..., :3] = [0.85, 0.88, 0.92]
        a[: h // 2, :, 3] = 0.0

    return lib.image("T_lane_dash", 8, 64, paint)


def tex_window_band():
    """
    办公楼窗带：一层楼高的横向贴图，暖白室内光 + 竖向窗框 + 随机几间暗房间，
    让夜景下立面有「有人加班」的生活感（自发光贴图，强度在 three.js 里调）
    """

    def paint(a):
        h, w = a.shape[:2]
        rng = np.random.default_rng(11)
        cols = 24
        cw = w / cols
        xx = np.arange(w)
        for c in range(cols):
            x0, x1 = int(c * cw), int((c + 1) * cw)
            k = rng.choice([1.0, 0.9, 0.75, 0.25, 0.08], p=[0.35, 0.25, 0.2, 0.12, 0.08])
            a[:, x0:x1, 0] = 1.0 * k
            a[:, x0:x1, 1] = 0.78 * k
            a[:, x0:x1, 2] = 0.5 * k
        mull = (np.mod(xx, cw) < 2)
        a[:, mull, :3] = 0.02
        a[: h // 6, :, :3] *= 0.2  # 窗台下沿较暗
        a[-h // 8 :, :, :3] *= 0.35  # 吊顶反光带

    return lib.image("T_window", 512, 64, paint)


def tex_store():
    """便利店橱窗：暖白室内 + 货架剪影 + 顶部暖色招牌带（自发光；设计稿一层是暖光玻璃，不是冷白）"""

    def paint(a):
        h, w = a.shape[:2]
        a[..., :3] = [1.0, 0.84, 0.6]
        for i in range(10):
            x0 = 20 + i * (w - 40) // 10
            a[int(h * 0.12) : int(h * 0.55), x0 : x0 + 30, :3] = [0.42, 0.33, 0.24]
        a[int(h * 0.82) :, :, :3] = [1.0, 0.7, 0.35]
        a[:, np.mod(np.arange(w), w // 8) < 3, :3] = 0.05

    return lib.image("T_store", 512, 128, paint)


def tex_swap_bay():
    """换电站通道内壁：深色底 + 横向青色灯条 + 中部举升平台的亮边（自发光）"""

    def paint(a):
        h, w = a.shape[:2]
        a[..., :3] = [0.01, 0.04, 0.07]
        for i in range(6):
            y0 = int(h * (0.15 + i * 0.14))
            a[y0 : y0 + 4, :, :3] = [0.15, 0.85, 0.95]
        a[:, : w // 40, :3] = [0.15, 0.85, 0.95]
        a[:, -w // 40 :, :3] = [0.15, 0.85, 0.95]

    return lib.image("T_swap_bay", 256, 128, paint)


def tex_battery_rack():
    """换电站电池仓：3 层 × 5 列电池格，满电绿色、充电中青色、空仓暗（自发光）"""

    def paint(a):
        h, w = a.shape[:2]
        a[..., :3] = [0.02, 0.03, 0.05]
        rng = np.random.default_rng(4)
        for r in range(3):
            for c in range(5):
                x0, y0 = 6 + c * (w - 12) // 5, 6 + r * (h - 12) // 3
                cw, ch = (w - 12) // 5 - 8, (h - 12) // 3 - 10
                k = rng.random()
                col = [0.2, 1.0, 0.45] if k < 0.6 else ([0.15, 0.8, 0.95] if k < 0.9 else [0.08, 0.1, 0.14])
                a[y0 : y0 + ch, x0 : x0 + cw, :3] = col
                a[y0 + 4 : y0 + 8, x0 + 4 : x0 + cw - 4, :3] = [0.9, 1.0, 0.95]

    return lib.image("T_battery", 256, 128, paint)


def tex_hazard():
    """黄黑斜纹（加油岛端头防撞、LNG 防火堤警示）"""

    def paint(a):
        h, w = a.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        band = np.mod(xx + yy, 32) < 16
        a[..., :3] = np.where(band[..., None], [1.0, 0.72, 0.05], [0.04, 0.04, 0.04])

    return lib.image("T_hazard", 64, 64, paint)


def tex_concrete():
    """站坪混凝土：浅灰底 + 大尺度明暗斑驳 + 细颗粒 + 每 6 m 一道伸缩缝（1024 对应 12 m，可平铺）"""

    def paint(a):
        h, w = a.shape[:2]
        n1 = _noise(h, w, 21)
        n2 = np.kron(_noise(h // 8, w // 8, 22), np.ones((8, 8), dtype=np.float32))
        n3 = np.kron(_noise(h // 64, w // 64, 23), np.ones((64, 64), dtype=np.float32))
        v = 0.42 + n1 * 0.05 + n2 * 0.05 + n3 * 0.08
        yy, xx = np.mgrid[0:h, 0:w]
        joint = (np.mod(xx, w // 2) < 2) | (np.mod(yy, h // 2) < 2)
        v[joint] *= 0.55
        a[..., 0] = v * 0.97
        a[..., 1] = v * 0.99
        a[..., 2] = v * 1.02

    return lib.image("T_concrete", 1024, 1024, paint)


def tex_grass():
    """草地：深绿底上大小两级的明暗斑块（修剪草坪的条纹 + 稀疏杂色），1024 对应 16 m"""

    def paint(a):
        h, w = a.shape[:2]
        n1 = _noise(h, w, 31)
        n2 = np.kron(_noise(h // 16, w // 16, 32), np.ones((16, 16), dtype=np.float32))
        n3 = np.kron(_noise(h // 128, w // 128, 33), np.ones((128, 128), dtype=np.float32))
        yy, xx = np.mgrid[0:h, 0:w]
        stripe = (np.mod(xx // 64, 2) * 0.03).astype(np.float32)
        v = 0.75 + n1 * 0.12 + n2 * 0.15 + n3 * 0.2 + stripe
        a[..., 0] = 0.07 * v
        a[..., 1] = 0.20 * v
        a[..., 2] = 0.11 * v

    return lib.image("T_grass", 1024, 1024, paint)


# ---------------------------------------------------------------- 材质


def build():
    """创建全部材质，返回 dict：名字 → 材质"""
    T = {
        "asphalt": tex_asphalt(),
        "pv": tex_pv(),
        "fence": tex_fence(),
        "screen_fuel": tex_screen("T_screen_fuel", (1.0, 0.55, 0.2)),
        "screen_lng": tex_screen("T_screen_lng", (0.7, 0.5, 1.0)),
        "screen_super": tex_screen("T_screen_super", (0.18, 0.9, 0.9)),
        "totem": tex_price("T_totem"),
        "totem_logo": tex_price("T_totem_logo", logo=True),
        "warn": tex_warning(),
        "pavers": tex_pavers(),
        "lane_dash": tex_lane_dash(),
        "window": tex_window_band(),
        "store": tex_store(),
        "swap_bay": tex_swap_bay(),
        "battery": tex_battery_rack(),
        "hazard": tex_hazard(),
        "concrete": tex_concrete(),
        "grass": tex_grass(),
    }
    M = {}
    m = lib.material

    # 地面与沙盘
    M["asphalt"] = m("M_asphalt", "#ffffff", rough=0.55, tex=T["asphalt"])
    M["asphalt_road"] = m("M_asphalt_road", "#c8ccd4", rough=0.6, tex=T["asphalt"])  # 门前国道：比站内路面略浅
    M["concrete"] = m("M_concrete", "#6d7480", rough=0.75)  # 罐区 / 设备基础的混凝土
    # 站坪（加油 / 加气罩棚下与周边）：浅灰混凝土，设计稿里罩棚下是被灯照亮的浅色地坪
    M["forecourt"] = m("M_forecourt", "#ffffff", rough=0.45, tex=T["concrete"])
    M["sidewalk"] = m("M_sidewalk", "#ffffff", rough=0.8, tex=T["pavers"])
    M["curb"] = m("M_curb", "#6b7686", rough=0.7)
    M["base"] = m("M_base", "#1a2230", metal=0.7, rough=0.34)
    M["grass"] = m("M_grass", "#ffffff", rough=0.95, tex=T["grass"])
    M["grass_dark"] = m("M_grass_dark", "#14283a", rough=0.95)  # 远山坡面（设计稿夜景是深蓝灰）
    M["soil"] = m("M_soil", "#2a2622", rough=0.95)
    M["rock"] = m("M_rock", "#3a3f44", rough=0.9)

    # 发光件
    M["led_edge"] = m("M_led_edge", "#2a7fff", emit="#2a7fff", strength=5)
    M["led_cyan"] = m("M_led_cyan", CYAN, emit=CYAN, strength=6)
    M["led_blue"] = m("M_led_blue", BLUE, emit=BLUE, strength=5)
    M["led_fuel"] = m("M_led_fuel", FUEL, emit=FUEL, strength=12)  # 加油机顶部灯带（橙）
    M["led_canopy"] = m("M_led_canopy", CANOPY, emit=CANOPY, strength=12)  # 加油加气罩棚檐口灯带（设计稿是青蓝色）
    M["led_lng"] = m("M_led_lng", LNG, emit=LNG, strength=12)  # LNG 罩棚檐口灯带
    M["led_swap"] = m("M_led_swap", SWAP, emit=SWAP, strength=10)
    M["led_green"] = m("M_led_green", GREEN, emit=GREEN, strength=10)
    M["lane"] = m("M_lane", "#3aa8ff", emit="#3aa8ff", strength=2.5)  # 站内导向箭头
    M["paint"] = m("M_paint", "#d8dee6", rough=0.7)  # 白色标线
    M["paint_yellow"] = m("M_paint_yellow", "#e8b923", rough=0.7)
    M["lane_dash"] = m("M_lane_dash", "#ffffff", rough=0.7, tex=T["lane_dash"], alpha=0.99)
    _link_alpha(M["lane_dash"])
    M["light_warm"] = m("M_light_warm", "#fff1d6", emit="#ffe2b8", strength=14)
    M["house_light"] = m("M_house_light", "#ffd9a0", emit="#ffbf70", strength=6)  # 远山村庄窗光（页面里不受雾影响）
    # 罩棚底灯（整片灯面）：Cycles 烘焙里它就是照亮站坪的面光源，强度按烘焙结果调；three.js 里显示亮度单独设定
    # 设计稿里罩棚下是暖白光（站坪偏暖黄），不是冷白
    M["light_cool"] = m("M_light_cool", "#ffe8cc", emit="#ffc890", strength=1.3)
    for k, c in STATUS.items():
        M["status_" + k] = m("M_status_" + k, c, emit=c, strength=5 if k != "offline" else 0.3)
    M["alarm"] = m("M_alarm", RED, emit=RED, strength=6)
    M["reserve"] = m("M_reserve", CYAN, emit=CYAN, strength=2)  # 预留储能区的虚线框

    # 设备
    M["white"] = m("M_white", "#e6ebf0", metal=0.15, rough=0.28)
    M["silver"] = m("M_silver", "#b8c2cc", metal=0.7, rough=0.25)  # 铝板
    # 罩棚檐口：设计稿是白色厚檐口（哑光烤漆），金属材质在暗场里会反射成一片黑，改用高反照率非金属
    M["fascia"] = m("M_fascia", "#eef2f6", metal=0.05, rough=0.35)
    M["graphite"] = m("M_graphite", "#20262e", metal=0.6, rough=0.35)
    M["dark"] = m("M_dark", "#12161c", metal=0.3, rough=0.5)
    M["steel"] = m("M_steel", "#4a5563", metal=0.85, rough=0.32)
    M["steel_dark"] = m("M_steel_dark", "#2c333d", metal=0.8, rough=0.35)
    M["stainless"] = m("M_stainless", "#d9dee4", metal=0.9, rough=0.18)  # LNG 储罐 / 槽车
    M["pipe_yellow"] = m("M_pipe_yellow", "#d9a420", metal=0.3, rough=0.45)  # 燃气管道
    M["roof"] = m("M_roof", "#2a323e", metal=0.5, rough=0.45)
    M["canopy_roof"] = m("M_canopy_roof", "#5c6570", metal=0.1, rough=0.6)  # 罩棚屋面：中灰金属屋面板（设计稿夜景里是灰色）
    M["canopy_under"] = m("M_canopy_under", "#cfd6de", rough=0.5)  # 罩棚吊顶
    M["screen_fuel"] = m("M_screen_fuel", "#000000", emit="#ffffff", tex=T["screen_fuel"], emit_tex=True, strength=2.5)
    M["screen_lng"] = m("M_screen_lng", "#000000", emit="#ffffff", tex=T["screen_lng"], emit_tex=True, strength=2.5)
    M["screen_super"] = m("M_screen_super", "#000000", emit="#ffffff", tex=T["screen_super"], emit_tex=True, strength=2.5)
    M["totem_logo"] = m("M_totem_logo", "#000000", emit="#ffffff", tex=T["totem_logo"], emit_tex=True, strength=3)
    M["totem_screen"] = m("M_totem_screen", "#000000", emit="#ffffff", tex=T["totem"], emit_tex=True, strength=3)
    M["pv"] = m("M_pv", "#ffffff", metal=0.2, rough=0.2, tex=T["pv"])
    _multiply_vertex_color(M["pv"], "Col")
    M["fence_mesh"] = m("M_fence_mesh", "#ffffff", metal=0.4, rough=0.5, tex=T["fence"], alpha=0.99)
    _link_alpha(M["fence_mesh"])
    M["transformer"] = m("M_transformer", "#363f4b", metal=0.6, rough=0.45)
    M["warn"] = m("M_warn", "#ffffff", tex=T["warn"], rough=0.5)
    M["hazard"] = m("M_hazard", "#ffffff", tex=T["hazard"], rough=0.5)
    M["cable"] = m("M_cable", "#15191f", rough=0.6)
    M["glass_dark"] = m("M_glass_dark", "#05080d", metal=0.6, rough=0.08)
    M["chrome"] = m("M_chrome", "#c9d2dc", metal=1.0, rough=0.15)
    M["swap_bay"] = m("M_swap_bay", "#000000", emit="#ffffff", tex=T["swap_bay"], emit_tex=True, strength=2.5)
    M["battery"] = m("M_battery", "#000000", emit="#ffffff", tex=T["battery"], emit_tex=True, strength=2.5)

    # 建筑
    M["wall"] = m("M_wall", "#5d636c", rough=0.6)  # 外墙压暗一档：夜景里衬托暖色窗光，不抢罩棚的亮
    M["wall_dark"] = m("M_wall_dark", "#3a4352", rough=0.55)
    M["glass_bld"] = m("M_glass_bld", "#0d1826", metal=0.5, rough=0.06)  # 幕墙玻璃（不透明深色，靠窗带贴图发光）
    M["window"] = m("M_window", "#000000", emit="#ffffff", tex=T["window"], emit_tex=True, strength=1.6)
    M["store"] = m("M_store", "#000000", emit="#ffffff", tex=T["store"], emit_tex=True, strength=2.2)
    M["mullion"] = m("M_mullion", "#8792a0", metal=0.8, rough=0.3)

    # 车辆（vehicles.py）：车漆统一一份材质，three.js 按车辆克隆换色
    M["glass"] = m("M_car_glass", "#1a2a3e", metal=0.35, rough=0.04)
    M["tyre"] = m("M_tyre", "#0b0d10", rough=0.9)
    M["rim"] = m("M_rim", "#9aa3ad", metal=0.95, rough=0.25)
    M["headlight"] = m("M_headlight", "#e8f6ff", emit="#e8f6ff", strength=3)
    M["taillight"] = m("M_taillight", "#ff2a3a", emit="#ff2a3a", strength=5)
    M["car_paint"] = m("M_car_paint", "#e9edf1", metal=0.75, rough=0.22)
    M["truck_paint"] = m("M_truck_paint", "#d9dee4", metal=0.4, rough=0.3)

    # 植物
    # 树叶：设计稿是偏冷的深墨绿（夜景），亮部靠树下投光；针叶更深
    # 设计稿的树林是偏蓝的墨绿（夜色），实测比 v1 暗约 40%
    M["leaf"] = m("M_leaf", "#0f2a26", rough=0.85)
    M["leaf2"] = m("M_leaf2", "#153530", rough=0.85)
    M["needle"] = m("M_needle", "#0a1f20", rough=0.9)
    # 被投光照亮的树：叶子带一点暖黄自发光（实时渲染里不必给每棵树打灯），烘焙时同时放真实点光源
    M["leaf_lit"] = m("M_leaf_lit", "#3d6b3f", rough=0.8, emit="#c9b35a", strength=0.35)
    M["trunk"] = m("M_trunk", "#3b2f26", rough=0.9)
    return M

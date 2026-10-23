"""
无人机巡检 · 化工园区建模 · 材质与程序化贴图
----------------------------------------------------------
定稿（docs/design/drone/design/final.png，方向 A · 黄昏沙盘）的颜色基调：
白色储罐 / 球罐被夕阳染成暖白，装置区银色塔器和管束反光偏橙，钢结构深灰，
厂内路面深灰沥青、地块浅灰混凝土，道路两侧行道树和草坪偏暗的橄榄绿，
指挥中心玻璃幕墙暗蓝、窗内透出暖黄灯光，装置区和路灯是钠灯暖橙色光点，
江面暗蓝灰。所有材质都按"角色"命名（M_<角色>），three.js 里按材质名调自发光 / 反射，
改名会让页面里的调整失效。
"""

import numpy as np

from . import lib


def _noise(h, w, seed, scale=1.0):
    """低频噪声（叠加几层随机网格插值），取值 0..1"""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp = 1.0
    for k in (4, 8, 16, 32):
        g = rng.random((k + 1, k + 1)).astype(np.float32)
        ys = np.linspace(0, k, h)
        xs = np.linspace(0, k, w)
        y0 = np.floor(ys).astype(int).clip(0, k - 1)
        x0 = np.floor(xs).astype(int).clip(0, k - 1)
        fy = (ys - y0)[:, None]
        fx = (xs - x0)[None, :]
        a = g[y0][:, x0]
        b = g[y0][:, x0 + 1]
        c = g[y0 + 1][:, x0]
        d = g[y0 + 1][:, x0 + 1]
        out += amp * ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy)
        amp *= 0.5 * scale
    out -= out.min()
    return out / max(out.max(), 1e-6)


def tex_fields():
    """园区外的农田：大小不一的长条地块（绿 / 黄绿 / 褐），地块之间有田埂和树带"""

    def paint(a):
        h, w = a.shape[:2]
        rng = np.random.default_rng(7)
        # 定稿里黄昏的农田偏灰：降低饱和度（灰绿 / 灰褐）
        cols = np.array([[0.22, 0.25, 0.18], [0.27, 0.28, 0.21], [0.30, 0.28, 0.23], [0.24, 0.27, 0.21], [0.28, 0.25, 0.21], [0.19, 0.22, 0.17]], np.float32)
        n = _noise(h, w, 3)
        y = 0
        while y < h:
            bh = int(rng.integers(h // 18, h // 7))
            x = 0
            while x < w:
                bw = int(rng.integers(w // 10, w // 3))
                c = cols[rng.integers(len(cols))]
                a[y : y + bh, x : x + bw, :3] = c
                # 田埂 / 树带：地块边上一条暗色细线
                a[y : y + bh, x : x + 3, :3] = (0.10, 0.14, 0.08)
                x += bw
            a[y : y + 3, :, :3] = (0.10, 0.14, 0.08)
            y += bh
        a[..., :3] *= (0.85 + 0.3 * n)[..., None]

    return lib.image("T_fields", 1024, 1024, paint)


def tex_asphalt():
    """厂内沥青路面：深灰带细微噪点"""

    def paint(a):
        h, w = a.shape[:2]
        n = _noise(h, w, 11)
        rng = np.random.default_rng(5)
        # 偏冷的深灰：页面暖色夕阳 + 路灯光池下原先显得发褐、和草地分不开
        g = 0.075 + 0.035 * n + 0.015 * rng.random((h, w))
        a[..., 0] = g
        a[..., 1] = g * 1.04
        a[..., 2] = g * 1.12

    return lib.image("T_asphalt", 256, 256, paint)


def tex_concrete():
    """地块混凝土：浅灰，带分缝"""

    def paint(a):
        h, w = a.shape[:2]
        n = _noise(h, w, 21)
        g = 0.36 + 0.08 * n
        a[..., 0] = g
        a[..., 1] = g * 0.99
        a[..., 2] = g * 0.96
        a[::64, :, :3] *= 0.7
        a[:, ::64, :3] *= 0.7

    return lib.image("T_concrete", 256, 256, paint)


def tex_window_band():
    """
    指挥中心玻璃幕墙（横向铺满整栋楼一次，竖向对应整栋楼高）：4 层，每层上部一道深色窗槛墙、下面是玻璃，
    每 ~2 m 一根竖梃；中段（约 1/3 楼宽）各层整片亮着暖光，两端按成段的房间随机亮、底层大堂大多亮着。
    原先 5×12 格随机亮灭，像像素噪点（评审第 7 条）。
    """

    def paint(a):
        h, w = a.shape[:2]
        rng = np.random.default_rng(31)
        floors, bays = 4, 48
        fh, bw = h / floors, w / bays
        u = (np.arange(w) + 0.5) / w
        v = (np.arange(h) + 0.5) / h
        # 未亮的玻璃：暗蓝灰，上部略亮（反射天光）
        a[..., 0] = 0.035 + 0.02 * v[:, None]
        a[..., 1] = 0.05 + 0.025 * v[:, None]
        a[..., 2] = 0.075 + 0.03 * v[:, None]
        for f in range(floors):
            j0, j1 = int(f * fh), int((f + 1) * fh)
            glass1 = int(j1 - fh * 0.24)
            i = 0
            while i < bays:
                run = int(rng.integers(2, 7))
                center = abs((i + run / 2) / bays - 0.5) < 0.17
                p = 0.95 if center else (0.45 if f == 0 else 0.16)
                if rng.random() < p:
                    # 亮度别太满：页面给幕墙的自发光强度 1.4，满亮会糊成一片
                    k = (0.55 + 0.2 * rng.random()) * (1.0 if center else 0.8)
                    x0, x1 = int(i * bw), int(min(bays, i + run) * bw)
                    a[j0 + 2 : glass1, x0:x1, 0] = 1.0 * k
                    a[j0 + 2 : glass1, x0:x1, 1] = 0.74 * k
                    a[j0 + 2 : glass1, x0:x1, 2] = 0.44 * k
                i += run
            a[glass1:j1, :, :3] = (0.09, 0.095, 0.10)  # 窗槛墙
        for i in range(bays + 1):  # 竖梃
            x = min(w - 1, int(i * bw))
            a[:, x : x + 2, :3] *= 0.35
        a[: int(fh * 0.06), :, :3] = (0.08, 0.08, 0.085)

    return lib.image("T_windows", 1024, 256, paint)


def tex_tank_shell():
    """
    储罐 / 球罐罐壁（柱面展开：u = 方位角一周，v = 罐底→罐顶）：哑光暖白，
    下部略暗（雨水、尘土）、罐底一圈污渍，每圈壁板一道浅接缝、竖向板缝，再叠一点竖向雨痕。
    原先是纯色 + 光滑，在黄昏光里像粉紫色塑料（评审第 3 条）。
    """

    def paint(a):
        h, w = a.shape[:2]
        rng = np.random.default_rng(41)
        v = (np.arange(h) / (h - 1))[:, None]
        # 底色偏暖、接近白：页面的天光偏蓝紫，罐壁原先实测 (100, 79, 84)、蓝大于绿，定稿约 (140, 116, 115)
        base = np.array([0.98, 0.93, 0.84], np.float32)
        k = 0.80 + 0.20 * np.clip(v / 0.3, 0, 1)  # 下部偏暗
        k = k * np.where(v < 0.035, 0.72, 1.0)  # 罐底污渍
        streak = np.convolve(rng.random(w), np.ones(5) / 5, mode="same")[None, :]
        k = k * (0.96 + 0.05 * streak)
        a[..., :3] = base * k[..., None]
        for i in range(1, 7):  # 壁板环缝
            a[int(h * i / 7), :, :3] *= 0.9
        for j in range(24):  # 竖向板缝
            a[:, int(w * j / 24), :3] *= 0.93

    return lib.image("T_tank_shell", 256, 256, paint)


def tex_tank_dome():
    """罐顶（俯视平面展开，罐心在贴图中心）：浅灰铝顶，24 道径向接缝 + 两圈环缝 + 中心通气口，边缘略暗"""

    def paint(a):
        h, w = a.shape[:2]
        y, x = np.mgrid[0:h, 0:w]
        dx, dy = (x - w / 2 + 0.5) / (w / 2), (y - h / 2 + 0.5) / (h / 2)
        r = np.hypot(dx, dy)
        ang = np.arctan2(dy, dx)
        g = 0.82 - 0.08 * np.clip(r, 0, 1) ** 2
        a[..., 0] = g
        a[..., 1] = g * 0.995
        a[..., 2] = g * 0.97
        seam = np.abs(((ang / (2 * np.pi) * 24) % 1) - 0.5) > 0.44  # 径向接缝
        a[..., :3] *= np.where((seam & (r > 0.08))[..., None], 0.78, 1.0)
        for rr in (0.5, 0.93):
            a[..., :3] *= np.where((np.abs(r - rr) < 0.012)[..., None], 0.8, 1.0)
        a[..., :3] *= np.where((r < 0.06)[..., None], 0.6, 1.0)

    return lib.image("T_tank_dome", 256, 256, paint)


def tex_metal_roof():
    """压型钢板屋面（罩棚）：沿坡向的波峰波谷条纹，每 1 m 一道（贴图 8 m 一铺）"""

    def paint(a):
        h, w = a.shape[:2]
        x = np.arange(w)
        ph = (x / w * 8) % 1
        # 屋面朝向夕阳，原先实测 (235, 202, 180) 一片白，定稿约 (167, 135, 131)：整体压暗
        g = np.where(ph < 0.25, 0.37, np.where(ph < 0.5, 0.29, 0.33))
        rng = np.random.default_rng(13)
        n = 0.97 + 0.03 * rng.random((h, w))
        a[..., 0] = g[None, :] * n
        a[..., 1] = g[None, :] * n * 0.99
        a[..., 2] = g[None, :] * n * 0.97

    return lib.image("T_metal_roof", 64, 64, paint)


def tex_canopy():
    """
    成片林冠（园区外的林地、林带、远河两岸密林，俯视平铺，50 m 一铺）：
    深绿底 + 一团团亮一些的树冠 + 冠间暗缝，远看是"高矮不一的成片树冠"而不是一棵棵等距的树。
    """

    def paint(a):
        h, w = a.shape[:2]
        rng = np.random.default_rng(61)
        n1 = _noise(h, w, 62)
        n2 = _noise(h, w, 63, scale=1.6)
        g = np.zeros((h, w), np.float32)
        y, x = np.mgrid[0:h, 0:w]
        for _ in range(420):  # 树冠团块（可平铺：按环绕距离算）
            cx, cy, r = rng.random() * w, rng.random() * h, rng.uniform(4, 11)
            dx = np.minimum(np.abs(x - cx), w - np.abs(x - cx))
            dy = np.minimum(np.abs(y - cy), h - np.abs(y - cy))
            g = np.maximum(g, np.clip(1 - np.hypot(dx, dy) / r, 0, 1) ** 0.7 * rng.uniform(0.6, 1.0))
        k = 0.45 + 0.55 * g
        k *= 0.85 + 0.3 * n1
        a[..., 0] = (0.14 + 0.05 * n2) * k
        a[..., 1] = (0.21 + 0.04 * n2) * k
        a[..., 2] = 0.11 * k

    return lib.image("T_canopy", 256, 256, paint)


# 农田作物颜色（定稿里园区四周的田：深浅不一的绿、成熟的黄绿、收割后的褐色、翻耕的深褐）
CROP_COLORS = [(0.24, 0.31, 0.16), (0.30, 0.36, 0.19), (0.20, 0.27, 0.15), (0.38, 0.38, 0.21), (0.42, 0.37, 0.24), (0.33, 0.27, 0.19), (0.27, 0.33, 0.17), (0.36, 0.31, 0.22)]


def tex_crops():
    """
    农田调色板贴图：横向 8 格，每格一种作物颜色，格内竖向是一垄一垄的条纹。
    所有地块共用一个材质 M_crops，按地块把 UV 指到不同的格子上（一个材质画出多种颜色的田）。
    """

    def paint(a):
        h, w = a.shape[:2]
        n = len(CROP_COLORS)
        cw = w // n
        rows = 0.92 + 0.08 * (np.sin(np.arange(h) / h * 2 * np.pi * 16) > 0)
        noise = _noise(h, w, 71)
        for i, c in enumerate(CROP_COLORS):
            a[:, i * cw : (i + 1) * cw, :3] = np.array(c, np.float32)
            a[:, i * cw : (i + 1) * cw, :3] *= (rows[:, None] * (0.9 + 0.2 * noise[:, i * cw : (i + 1) * cw]))[..., None]

    return lib.image("T_crops", 256, 64, paint)


def tex_lawn():
    """园区草坪：偏绿的草色，大块深浅斑驳（修剪的草坪 + 稍暗的灌木地被），60 m 一铺"""

    def paint(a):
        h, w = a.shape[:2]
        n1 = _noise(h, w, 81)
        n2 = _noise(h, w, 82, scale=1.5)
        k = 0.8 + 0.35 * n1
        # 实测和定稿亮度相当，但蓝通道偏低（发黄绿），蓝色提一点
        a[..., 0] = (0.25 + 0.05 * n2) * k
        a[..., 1] = (0.31 + 0.04 * n2) * k
        a[..., 2] = 0.22 * k

    return lib.image("T_lawn", 256, 256, paint)


def tex_panel():
    """空分冷箱外壁：浅灰压型板，每 2.5 m 一道竖向板缝、每 3.3 m 一道横缝，局部轻微色差（贴图 10 m 一铺）"""

    def paint(a):
        h, w = a.shape[:2]
        rng = np.random.default_rng(91)
        n = _noise(h, w, 92)
        g = 0.74 + 0.06 * n
        a[..., 0] = g
        a[..., 1] = g * 0.99
        a[..., 2] = g * 0.97
        for i in range(4):
            x0 = int(w * i / 4)
            a[:, x0 : x0 + 2, :3] *= 0.72
            a[:, x0 : x0 + int(w / 4), :3] *= 0.97 + 0.05 * rng.random()
        for j in range(3):
            a[int(h * j / 3), :, :3] *= 0.78

    return lib.image("T_panel", 128, 128, paint)


def build():
    """返回材质字典 M[角色]"""
    panel = tex_panel()
    lawn = tex_lawn()
    canopy_tex = tex_canopy()
    crops = tex_crops()
    fields = tex_fields()
    asphalt = tex_asphalt()
    concrete = tex_concrete()
    windows = tex_window_band()
    shell = tex_tank_shell()
    dome = tex_tank_dome()
    metal_roof = tex_metal_roof()
    m = lib.material
    return {
        # ---- 储罐 / 球罐
        # 罐壁：哑光（粗糙度 0.42 → 0.72，去掉塑料感的高光），底色来自 T_tank_shell
        "tank": m("M_tank_white", "#dcd8d0", rough=0.72, metal=0.02, tex=shell),
        # 罐顶（浮顶罐的铝网壳顶、拱顶罐的拱顶）：浅灰，带径向接缝的 T_tank_dome
        "tank_roof": m("M_tank_roof", "#cfccc4", rough=0.6, metal=0.15, tex=dome),
        "tank_ring": m("M_tank_ring", "#c9c5bc", rough=0.5, metal=0.2),
        # ---- 钢结构 / 管道
        "steel": m("M_steel_silver", "#b8bfc6", rough=0.28, metal=0.8),
        # 塔器：定稿里是装置区最亮的银白色细高塔。原先金属度 0.75，黄昏的暗环境下只能反射暗天空、和深色框架混成一片，
        # 降低金属度、提亮底色，让它主要靠漫反射吃夕阳（页面只按名字调 envMapIntensity）
        "column": m("M_column", "#e2e4e4", rough=0.32, metal=0.35),
        "steel_dark": m("M_steel_dark", "#4b5158", rough=0.55, metal=0.5),
        "steel_rust": m("M_steel_rust", "#6b5847", rough=0.7, metal=0.3),
        "pipe_yellow": m("M_pipe_yellow", "#c8a636", rough=0.45, metal=0.3),
        # 保温铝皮（塔器、容器、保温管）：定稿里装置区的银白色主体，比 M_steel_silver 亮、金属度低，
        # 黄昏的环境光很暗，金属度高的面只能反射暗天空，所以主要靠漫反射吃夕阳和天光
        "insulation": m("M_insulation", "#d4d6d4", rough=0.38, metal=0.25),
        # 钢格栅平台（框架各层铺板、塔器平台、楼梯平台）
        "grating": m("M_grating", "#8a8a84", rough=0.7, metal=0.3),
        # 被平台灯照亮的格栅：带一点暖色自发光（低于辉光阈值），模拟定稿里各层平台被钠灯照成暖橙色
        "grating_lit": m("M_grating_lit", "#8e8070", rough=0.65, metal=0.2, emit="#ff9440", strength=0.4),
        # ---- 地面
        "fields": m("M_fields", "#3a4526", rough=0.95, tex=fields),
        "asphalt": m("M_asphalt", "#2a2c30", rough=0.9, tex=asphalt),
        "concrete": m("M_concrete", "#8f8e8a", rough=0.85, tex=concrete),
        "grass": m("M_grass", "#36432a", rough=0.95),
        "road_line": m("M_road_line", "#c6c1b2", rough=0.7),
        # 园区内草坪（GROUND_park）：比 M_grass 绿，贴图 T_lawn
        "lawn": m("M_lawn", "#4a5a32", rough=0.95, tex=lawn),
        # 路沿石：浅灰，勾出道路轮廓
        "curb": m("M_curb", "#bdb9b0", rough=0.8),
        "rock": m("M_rock", "#5a554d", rough=0.95),
        "water": m("M_water", "#1b2836", rough=0.06, metal=0.0),
        # 远处的河：定稿里映着落日天光、比近处江面亮得多（单独一个材质，页面里按名字调）
        "far_water": m("M_far_water", "#8e8aa2", rough=0.2, metal=0.0, emit="#7a7090", strength=0.35),
        "basin_water": m("M_basin_water", "#26343d", rough=0.15),
        "hill": m("M_hill", "#232b21", rough=1.0),
        "tree": m("M_tree", "#2b3a22", rough=0.9),
        # 树冠的另外两种颜色（黄绿的阔叶 / 钻天杨、深绿的针叶树），和 M_tree 混着种，避免满园一个颜色
        "tree_light": m("M_tree_light", "#435229", rough=0.9),
        "tree_dark": m("M_tree_dark", "#1e2a1a", rough=0.92),
        # 成片林冠（林地、林带、远河两岸密林的高度场网格），底色来自 T_canopy
        "forest": m("M_forest", "#26331f", rough=0.95, tex=canopy_tex),
        # 园区外的农田地块（一个材质，地块 UV 指向 T_crops 的不同色格）
        "crops": m("M_crops", "#3d4a28", rough=0.95, tex=crops),
        # 村落民房的坡屋面（暗红褐色瓦）
        "house_roof": m("M_house_roof", "#6a3b2e", rough=0.8),
        "trunk": m("M_trunk", "#3b3026", rough=0.9),
        # ---- 建筑
        "wall": m("M_wall_light", "#c3bfb6", rough=0.8),
        "wall_dark": m("M_wall_dark", "#6c6f72", rough=0.8),
        "roof": m("M_roof_grey", "#6f7377", rough=0.75, metal=0.1),
        "glass": m("M_glass_windows", "#1b2a38", rough=0.12, metal=0.3, emit="#ffffff", strength=1.6, tex=windows, emit_tex=True),
        "window": m("M_window_lit", "#ffcf8a", rough=0.4, emit="#ffc27a", strength=2.5),
        "red": m("M_red_door", "#9f241c", rough=0.6),
        # 罩棚屋面：压型钢板条纹（T_metal_roof），比原先的纯色白板暗一档
        "canopy": m("M_canopy_roof", "#9a9893", rough=0.6, metal=0.3, tex=metal_roof),
        # ---- 车辆 / 船
        "truck_cab": m("M_truck_cab", "#d8d6d0", rough=0.5),
        "tanker": m("M_tanker_steel", "#c3c7cb", rough=0.3, metal=0.7),
        "tyre": m("M_tyre", "#151618", rough=0.9),
        # 化学品船：定稿里是深蓝船壳 + 红色水线带，甲板灰褐
        "hull": m("M_ship_hull", "#24304a", rough=0.55, metal=0.1),
        "hull_red": m("M_ship_bottom", "#8a2a20", rough=0.65),
        "deck": m("M_ship_deck", "#6e6a5c", rough=0.8),
        "super": m("M_ship_super", "#e4e2dc", rough=0.6),
        # ---- 灯光（自发光，强度在页面里按昼夜 / 状态调）
        "lamp": m("M_lamp_sodium", "#ffb35c", emit="#ffad55", strength=8.0),
        "lamp_unit": m("M_lamp_unit", "#ffc070", emit="#ffbb66", strength=10.0),
        "flame": m("M_flame", "#ff8a2a", emit="#ff7a1f", strength=18.0),
        "red_light": m("M_aviation_red", "#ff3020", emit="#ff2a1a", strength=12.0),
        # ---- 其他
        "fence": m("M_fence", "#6b7076", rough=0.6, metal=0.4),
        "steam": m("M_steam", "#e8e6e2", rough=1.0, alpha=0.35),
        "transformer": m("M_transformer", "#5c6a5a", rough=0.6, metal=0.3),
        # 空分冷箱外壁（带板缝的浅灰压型板，贴图 T_panel）
        "panel": m("M_panel", "#c4c3be", rough=0.7, metal=0.1, tex=panel),
        # ---- 机场 / 无人机（fleet.glb 也用这些）
        "dock_body": m("M_dock_body", "#e9e9e6", rough=0.45, metal=0.1),
        "dock_dark": m("M_dock_dark", "#2a2d32", rough=0.5, metal=0.3),
        "dock_pad": m("M_dock_pad", "#3b3f45", rough=0.7),
        "dock_led": m("M_dock_led", "#3ce8dc", emit="#36e3d8", strength=6.0),
        "drone_body": m("M_drone_body", "#2f3237", rough=0.4, metal=0.3),
        "drone_arm": m("M_drone_arm", "#23262a", rough=0.5, metal=0.2),
        "prop": m("M_prop", "#16181b", rough=0.4),
        "drone_led": m("M_drone_led", "#ff4a3a", emit="#ff3b30", strength=8.0),
        "drone_led_g": m("M_drone_led_g", "#3cff7a", emit="#2cff6a", strength=8.0),
        "lens": m("M_lens", "#0d1014", rough=0.05, metal=0.6),
    }

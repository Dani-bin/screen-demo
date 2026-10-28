"""
井上地面输送 · 103 机头建模 · 材质与程序化贴图
----------------------------------------------------------
按"材质角色"建一套共享材质（见 build-3d-visual-dashboard 的 threejs-rendering.md）：
结构钢（灰漆）、镀锌钢、黄色护栏漆、电机蓝、减速机铸件灰、橡胶、包胶、煤、钢格板、压型钢板、混凝土、
传感器白盒、急停黄 / 红、拉绳红、灯具发光面、机器人。
颜色取自定稿概念图 concept-r3 的取色；贴图用 numpy 画好存成 PNG，导出时打进 GLB。
材质名就是 three.js 里按名字调整的依据（煤和输送带滚动贴图、灯具发光强度），改名要同步改页面代码。
"""

import math

import numpy as np

from . import lib


def _noise(h, w, seed, scale):
    """简单的值噪声（双线性插值的随机格子），返回 0..1"""
    rs = np.random.RandomState(seed)
    gh, gw = max(2, h // scale + 2), max(2, w // scale + 2)
    g = rs.rand(gh, gw)
    y = np.linspace(0, gh - 1.001, h)
    x = np.linspace(0, gw - 1.001, w)
    y0, x0 = np.floor(y).astype(int), np.floor(x).astype(int)
    fy, fx = (y - y0)[:, None], (x - x0)[None, :]
    a = g[y0][:, x0]
    b = g[y0][:, x0 + 1]
    c = g[y0 + 1][:, x0]
    d = g[y0 + 1][:, x0 + 1]
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy


def _coal(arr):
    """煤面：深灰底 + 大小煤块（左上受光、亮面带反光），横向可平铺；数值是 sRGB 编码值"""
    h, w = arr.shape[:2]
    rs = np.random.RandomState(7)
    base = 0.16 + 0.06 * _noise(h, w, 3, 16)
    img = np.repeat(base[..., None], 3, axis=2)
    for _ in range(1400):
        cx, cy = rs.rand() * w, rs.rand() * h
        r = 2 + rs.rand() ** 2.2 * 18
        lum = 0.24 + rs.rand() * 0.26
        # 只算煤块外接方框内的像素；下标取模实现平铺（接缝处的煤块连续）
        ri = int(math.ceil(r))
        oy, ox = np.mgrid[-ri : ri + 1, -ri : ri + 1].astype(np.float32)
        dx = ox - (cx - math.floor(cx))
        dy = oy - (cy - math.floor(cy))
        d2 = (dx * dx + dy * dy) / (r * r)
        m = d2 < 1
        ys = (np.floor(cy).astype(int) + oy.astype(int)) % h
        xs = (np.floor(cx).astype(int) + ox.astype(int)) % w
        shade = lum * (1.25 - 0.8 * np.sqrt(np.minimum(d2, 1))) + 0.3 * np.clip((-dx - dy) / r, 0, 1)
        for k, tint in enumerate((1.0, 0.97, 0.92)):
            cur = img[ys, xs, k]
            img[ys, xs, k] = np.where(m, np.maximum(cur, shade * tint), cur)
    arr[..., :3] = np.clip(img, 0, 1)


def _lagging(arr):
    """滚筒包胶：黑橡胶 + 凸起菱形纹（人字形沟槽的亮边）"""
    h, w = arr.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    p = 32.0
    a = np.abs(((xx + yy) % p) - p / 2)
    b = np.abs(((xx - yy) % p) - p / 2)
    ridge = np.clip(1 - np.minimum(a, b) / 3.0, 0, 1)
    v = 0.035 + 0.05 * ridge + 0.01 * _noise(h, w, 5, 8)
    arr[..., 0] = v
    arr[..., 1] = v * 1.02
    arr[..., 2] = v * 1.06


def _rubber(arr):
    """输送带橡胶面：近黑 + 细微灰尘斑，滚动时能看出在动"""
    h, w = arr.shape[:2]
    n = _noise(h, w, 9, 6) * 0.6 + _noise(h, w, 10, 24) * 0.4
    v = 0.025 + 0.03 * n
    arr[..., 0] = v
    arr[..., 1] = v
    arr[..., 2] = v * 1.05


def _grating(arr):
    """钢格板：镀锌灰扁钢 + 透空孔（alpha），一格 = 贴图的 1/8"""
    h, w = arr.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    bar = ((xx % (w // 8)) < 3) | ((yy % (h // 4)) < 3)
    arr[..., 0] = 0.32
    arr[..., 1] = 0.34
    arr[..., 2] = 0.36
    arr[..., 3] = np.where(bar, 1.0, 0.0)


def _corrugated(arr):
    """压型钢板：沿 x 方向的明暗波纹"""
    h, w = arr.shape[:2]
    x = np.arange(w)[None, :]
    k = 0.5 + 0.5 * np.cos(x / w * 8 * 2 * math.pi)
    v = 0.12 + 0.12 * k
    arr[..., 0] = v
    arr[..., 1] = v * 1.02
    arr[..., 2] = v * 1.06


def _concrete(arr):
    """混凝土筒仓：竖向浇筑纹 + 水平施工缝"""
    h, w = arr.shape[:2]
    n = _noise(h, w, 11, 32) * 0.5 + _noise(h, w, 12, 6) * 0.5
    v = 0.5 + 0.1 * n
    seam = (np.arange(h)[:, None] % (h // 6)) < 2
    v = np.where(seam, v * 0.75, v)
    arr[..., 0] = v
    arr[..., 1] = v * 0.99
    arr[..., 2] = v * 0.96


def build():
    """建全部材质，返回 {角色: 材质}"""
    T = {
        "coal": lib.image("T_coal", 512, 512, _coal),
        "lagging": lib.image("T_lagging", 256, 256, _lagging),
        "rubber": lib.image("T_rubber", 256, 256, _rubber),
        "grating": lib.image("T_grating", 256, 256, _grating),
        "corrugated": lib.image("T_corrugated", 256, 16, _corrugated),
        "concrete": lib.image("T_concrete", 256, 256, _concrete),
    }
    M = {
        # 结构钢：栈桥柱梁、支腿、桁架（冷灰漆，半哑光；第 10 轮评审：浅色在灯下像奶油色石膏，压深一档）
        # 金属度都压得比较低：three.js 里光照图只作用于漫反射，金属度高的件吃不到烘焙的暖光，只反射天空（第 4 轮比对：整屏偏紫）
        "steel": lib.material("M_steel", "#5e666f", metal=0.35, rough=0.5),
        # 镀锌钢：托辊架、纵梁、滚筒端盖（亮一些）
        "galv": lib.material("M_galv", "#848d97", metal=0.4, rough=0.45),
        # 托辊筒体（钢管，轴承座附近略暗）
        "roller": lib.material("M_roller", "#5f656c", metal=0.35, rough=0.45),
        # 黄色安全漆：护栏、联轴器护罩
        "yellow": lib.material("M_yellow", "#d9ac1c", metal=0.15, rough=0.5),
        # 电机：深钢蓝金属漆（定稿里是深蓝灰；第 6 轮评审：饱和的蓝像卡通模型）
        "motor": lib.material("M_motor", "#2b3f57", metal=0.4, rough=0.55),
        # 减速机：深铸铁灰漆（正上方就是机头灯，光照图很亮，浅灰会发白；第 6、8 轮评审：像米白塑料块）
        "reducer": lib.material("M_reducer", "#4f565e", metal=0.35, rough=0.48),
        # 驱动轴、制动盘
        "shaft": lib.material("M_shaft", "#b8bec4", metal=1.0, rough=0.22),
        # 输送带 / 包胶（贴图在 three.js 里按带速滚动，名字不能改）
        "belt": lib.material("M_belt", "#ffffff", metal=0.0, rough=0.88, tex=T["rubber"]),
        "lagging": lib.material("M_lagging", "#ffffff", metal=0.0, rough=0.8, tex=T["lagging"]),
        "coal": lib.material("M_coal", "#ffffff", metal=0.3, rough=0.42, tex=T["coal"]),
        # 钢格板（alpha 透空）
        "grating": lib.material("M_grating", "#ffffff", metal=0.3, rough=0.6, tex=T["grating"]),
        "roof": lib.material("M_roof", "#ffffff", metal=0.3, rough=0.55, tex=T["corrugated"]),
        "concrete": lib.material("M_concrete", "#ffffff", metal=0.0, rough=0.9, tex=T["concrete"]),
        "ground": lib.material("M_ground", "#1c1f24", metal=0.0, rough=0.95),  # 冷灰：暖褐色地面被夕阳一照，右半画面一片橙棕（第 8 轮评审）
        # 栈桥楼板（花纹钢板，深灰）
        "deck": lib.material("M_deck", "#4c5157", metal=0.25, rough=0.7),
        # 传感器白盒、急停盒、拉绳
        "sensor": lib.material("M_sensor", "#d9dcdf", metal=0.05, rough=0.4),
        "estop": lib.material("M_estop", "#e2a714", metal=0.1, rough=0.45),
        "red": lib.material("M_red", "#c81e1e", metal=0.05, rough=0.4),
        # 灯具：灯壳 + 发光面（强度在 three.js 里调，材质名 M_lamp）
        "lampbody": lib.material("M_lampbody", "#3a3f45", metal=0.3, rough=0.5),
        "lamp": lib.material("M_lamp", "#fff1d6", emit="#ffd9a0", strength=6.0),
        # 远处的厂区灯光、窗户
        "window": lib.material("M_window", "#ffcf8a", emit="#ffbf70", strength=4.0),
        # 机器人：白色机身 + 深灰
        "robot": lib.material("M_robot", "#e6e8ea", metal=0.1, rough=0.35),
        "dark": lib.material("M_dark", "#1d2126", metal=0.4, rough=0.5),
        # 光纤测温条：页面用温度贴图着色（名字不能改）
        "fiber": lib.material("M_fiber", "#38bdf8", emit="#38bdf8", strength=1.0),
    }
    # 钢格板用 alpha 镂空（导出为 alphaMode MASK）
    g = M["grating"]
    nt = g.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    g.surface_render_method = "DITHERED"
    try:
        g.blend_method = "CLIP"
    except (AttributeError, TypeError):
        pass
    return M

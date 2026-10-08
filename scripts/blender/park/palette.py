"""
园区建模 · 材质与程序化贴图
----------------------------------------------------------
配色对照设计稿 docs/design/building/01-ai-park.png：深海军蓝夜景，楼体靠窗灯与描边发光撑亮度。

贴图都用 numpy 画成 PNG（导出 glTF 时打包进 GLB），只接 Principled 的常量参数与图片节点，保证能原样导出：
  T_tower_glass / T_tower_emit   塔楼幕墙：深蓝玻璃外罩白色「冰裂纹」铝格栅（实景）；窗灯（暖白为主、少量冷白，整层成片亮 / 暗）从格栅缝透出
  T_pebble_glass / T_pebble_emit 鹅卵石楼：白色层间带 + 玻璃窗带 + 白色斜向枝杈格构（实景）；窗灯
  T_hall_shell                   会议中心金属壳屋面：经向肋条 + 纬向环梁 + 顶部深色天窗
  T_paving / T_grass             园区铺装 / 草地（世界尺度平铺）
贴图的 UV 约定见 buildings.py：u 沿外墙周长（米 / 贴图宽对应的米数），v 沿高度（米 / 贴图高对应的米数）。
"""

import numpy as np

from . import lib

# 塔楼：窗宽 1.5 m、层高 218 / 58 ≈ 3.76 m；一张贴图（2048²）覆盖 64 列 × 32 层
TOWER_COL = 1.5
TOWER_FLOOR = 218.0 / 58.0
TOWER_TEX_COLS = 64
TOWER_TEX_FLOORS = 32
# 鹅卵石楼：窗宽 1.8 m、层高 4.2 m；一张贴图（2048 × 1024）覆盖 48 列 × 8 层
PEBBLE_COL = 1.8
PEBBLE_FLOOR = 4.2
PEBBLE_TEX_COLS = 48
PEBBLE_TEX_FLOORS = 8


def _rng(seed):
    return np.random.default_rng(seed)


def _hex01(c):
    c = c.lstrip("#")
    return np.array([int(c[i : i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)


def _window_lights(rng, cols, floors, lit_ratio=0.7, low_bias=0.25):
    """
    每扇窗的亮灯颜色（floors × cols × 3，0 为不亮）。
    设计稿里的写字楼夜景明暗跨度很大：有的楼层灯火通明、有的只开了几盏、有的全黑，偶尔几扇特别亮的窗。
    远看一扇窗不到两个像素，所以先按「层」定亮度档，再在层内分长区段，最后撒少量单独的亮窗：
      全暗 / 微亮（0.08～0.18）/ 正常（0.35～0.6）/ 通明（0.85～1.0）
    贴图只有 0..1，three.js 里自发光强度放大后只有「通明」档和单独亮窗会超过辉光阈值，其余不泛光。
    """
    warm = [_hex01("#ffd59a"), _hex01("#ffdcae"), _hex01("#ffc879"), _hex01("#ffe6c4")]
    neutral = _hex01("#fff4e2")
    cool = _hex01("#d2e8ff")
    out = np.zeros((floors, cols, 3), dtype=np.float32)
    for f in range(floors):
        # 越往上越容易整层熄灯
        p_on = lit_ratio + low_bias * (0.5 - f / max(1, floors - 1))
        if rng.random() > p_on:
            # 熄灯的层也可能留一两盏
            for k in rng.integers(0, cols, int(rng.integers(0, 3))):
                out[f, k] = warm[0] * 0.25
            continue
        r = rng.random()
        if r < 0.3:
            lo, hi = 0.08, 0.18  # 微亮：走廊灯、应急照明
        elif r < 0.82:
            lo, hi = 0.35, 0.6  # 正常办公
        else:
            lo, hi = 0.85, 1.0  # 灯火通明（加班层、开放办公区）
        t = rng.random()
        base = cool if t < 0.12 else neutral if t < 0.3 else warm[rng.integers(len(warm))]
        c = 0
        while c < cols:
            run = int(rng.integers(6, 26))
            if rng.random() < 0.82:
                level = lo + (hi - lo) * rng.random()
                for k in range(c, min(cols, c + run)):
                    # 拉了窗帘的窗暗一截
                    out[f, k] = base * level * (0.45 if rng.random() < 0.15 else 1.0)
            c += run + int(rng.integers(0, 5))
    # 零星特别亮的单窗（台灯、会议室投影）
    n = int(cols * floors * 0.012)
    for f, k in zip(rng.integers(0, floors, n), rng.integers(0, cols, n)):
        out[f, k] = warm[rng.integers(len(warm))]
    return out


def _lattice(W, H, segs, widths):
    """
    把一组线段画成抗锯齿的格栅遮罩（H × W，0..1），线段端点为像素坐标 (x0, y0, x1, y1)。
    横竖都按贴图尺寸取模：格栅跨过贴图边缘时从另一侧接上，平铺时无缝。
    """
    segs = np.asarray(segs, dtype=np.float32)
    widths = np.broadcast_to(np.asarray(widths, dtype=np.float32), (len(segs),))
    length = np.hypot(segs[:, 2] - segs[:, 0], segs[:, 3] - segs[:, 1])
    n = np.maximum(2, np.ceil(length * 1.5).astype(int))
    idx = np.repeat(np.arange(len(segs)), n)
    t = np.concatenate([np.linspace(0, 1, k, dtype=np.float32) for k in n])
    px = segs[idx, 0] + (segs[idx, 2] - segs[idx, 0]) * t
    py = segs[idx, 1] + (segs[idx, 3] - segs[idx, 1]) * t
    half = widths[idx] / 2
    mask = np.zeros((H, W), dtype=np.float32)
    r = int(np.ceil(widths.max() / 2 + 1))
    bx, by = np.floor(px).astype(int), np.floor(py).astype(int)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            xx, yy = bx + dx, by + dy
            w = np.clip(half + 0.5 - np.hypot(xx + 0.5 - px, yy + 0.5 - py), 0, 1)
            ok = w > 0
            np.maximum.at(mask, (yy[ok] % H, xx[ok] % W), w[ok])
    return mask


def _tower_lattice(W, H, rng):
    """
    双子塔外表皮：白色铝合金「冰裂纹」格栅（见实景照片）。
    每层上下两排节点交错连成三角网，节点位置随机抖动，再随机加几根斜撑打破规律；每层楼板处一道较粗的横向环梁。
    """
    fh = H / TOWER_TEX_FLOORS
    nodes = 56  # 每排节点数：约 1.7 m 一个，接近实景格栅的尺度
    step = W / nodes
    rows = []
    for r in range(TOWER_TEX_FLOORS * 2):
        y = r * fh / 2 + (0 if r % 2 == 0 else rng.uniform(-0.12, 0.12) * fh)
        xs = (np.arange(nodes) + 0.5 * (r % 2)) * step + rng.uniform(-0.32, 0.32, nodes) * step
        rows.append((y, xs))
    segs, widths = [], []
    for r in range(len(rows)):
        (ya, xa), (yb, xb) = rows[r], rows[(r + 1) % len(rows)]
        if r + 1 == len(rows):
            yb += H  # 最上一排接回贴图底边（取模绕回）
        for i in range(nodes):
            a_next = xa[(i + 1) % nodes] + (W if i + 1 == nodes else 0)
            segs += [(xa[i], ya, xb[i], yb), (xb[i], yb, a_next, ya)]
            widths += [4.4, 4.4]
            if rng.random() < 0.3:
                b_next = xb[(i + 1) % nodes] + (W if i + 1 == nodes else 0)
                segs.append((xa[i], ya, b_next, yb))
                widths.append(3.2)
    for f in range(TOWER_TEX_FLOORS):
        segs.append((0, f * fh, W, f * fh))
        widths.append(7.0)
    return _lattice(W, H, segs, widths)


def tower_textures():
    """塔楼幕墙：底色贴图（深蓝玻璃 + 白色格栅）+ 窗灯贴图（被格栅遮挡），同一套 UV"""
    W, H = 2048, 2048
    cw, fh = W // TOWER_TEX_COLS, H // TOWER_TEX_FLOORS  # 每列 32 px、每层 64 px
    lights = _window_lights(_rng(7), TOWER_TEX_COLS, TOWER_TEX_FLOORS)
    mask = _tower_lattice(W, H, _rng(17))[..., None]

    def glass(a):
        # 深蓝玻璃，自下而上略微变亮（天空反射）；格栅为银白铝板
        y = np.linspace(0, 1, H, dtype=np.float32)[:, None]
        a[..., 0] = 0.035 + 0.03 * y
        a[..., 1] = 0.075 + 0.05 * y
        a[..., 2] = 0.15 + 0.08 * y
        a[..., :3] = a[..., :3] * (1 - mask) + np.array([0.7, 0.74, 0.8], dtype=np.float32) * mask

    def emit(a):
        a[..., :3] = 0
        for f in range(TOWER_TEX_FLOORS):
            for k in range(TOWER_TEX_COLS):
                col = lights[f, k]
                if col.any():
                    # 窗内留出层间梁的位置；窗顶略亮（吊顶灯带）
                    blk = a[f * fh + 8 : (f + 1) * fh - 3, k * cw + 2 : (k + 1) * cw - 2, :3]
                    grad = np.linspace(0.75, 1.0, blk.shape[0])[:, None, None]
                    blk[:] = col * grad
        # 窗灯从格栅缝里透出来；格栅本身带一点冷白微光（夜景泛光照着的铝板），远看整栋楼读成银白网格
        a[..., :3] = a[..., :3] * (1 - 0.88 * mask) + np.array([0.3, 0.32, 0.36], dtype=np.float32) * mask

    return lib.image("T_tower_glass", W, H, glass), lib.image("T_tower_emit", W, H, emit)


def _pebble_lattice(W, H, band, rng):
    """
    鹅卵石楼外表皮：白色「枝杈」斜向格构（见实景照片），每层从层间带下沿斜拉到上一条层间带，
    左右两个方向交叉，少数枝杈中途分叉
    """
    fh = H / PEBBLE_TEX_FLOORS
    segs = []
    for f in range(PEBBLE_TEX_FLOORS):
        y0, y1 = f * fh + band, (f + 1) * fh
        for _ in range(64):
            x = rng.uniform(0, W)
            dx = rng.choice((-1, 1)) * rng.uniform(0.35, 1.0) * (y1 - y0)
            segs.append((x, y0, x + dx, y1))
            if rng.random() < 0.35:
                t = rng.uniform(0.3, 0.7)
                mx, my = x + dx * t, y0 + (y1 - y0) * t
                segs.append((mx, my, mx - dx * rng.uniform(0.4, 0.8), y1))
    return _lattice(W, H, segs, 3.0)


def pebble_textures():
    """鹅卵石楼：白色层间带（1.0 m）+ 玻璃窗带 + 白色斜向格构"""
    W, H = 2048, 1024
    cw = W // PEBBLE_TEX_COLS  # 42 px
    fh = H // PEBBLE_TEX_FLOORS  # 128 px
    band = int(fh * 1.0 / PEBBLE_FLOOR)  # 层间带高度（像素），1.0 m
    # 鹅卵石楼是园区里的办公楼，设计稿里几乎整栋亮着暖灯，亮灯比例比塔楼高
    lights = _window_lights(_rng(11), PEBBLE_TEX_COLS, PEBBLE_TEX_FLOORS, lit_ratio=0.88, low_bias=0.1)
    mask = _pebble_lattice(W, H, band, _rng(23))[..., None]

    def glass(a):
        a[..., 0], a[..., 1], a[..., 2] = 0.05, 0.09, 0.16
        for k in range(PEBBLE_TEX_COLS):
            a[:, k * cw : k * cw + 2, :3] = (0.3, 0.35, 0.42)
        for f in range(PEBBLE_TEX_FLOORS):
            a[f * fh : f * fh + band, :, :3] = (0.9, 0.92, 0.95)
        a[..., :3] = a[..., :3] * (1 - mask) + np.array([0.86, 0.88, 0.91], dtype=np.float32) * mask

    def emit(a):
        a[..., :3] = 0
        for f in range(PEBBLE_TEX_FLOORS):
            # 白色层间带也带一点冷白自发光（泛光照亮的金属带），夜里读出设计稿那种明亮的横向线条
            a[f * fh : f * fh + band, :, :3] = (0.32, 0.35, 0.4)
            for k in range(PEBBLE_TEX_COLS):
                col = lights[f, k]
                if col.any():
                    a[f * fh + band + 3 : (f + 1) * fh - 3, k * cw + 4 : (k + 1) * cw - 2, :3] = col
        # 格构挡住一部分窗灯，自身带微光
        a[..., :3] = a[..., :3] * (1 - 0.85 * mask) + np.array([0.12, 0.13, 0.15], dtype=np.float32) * mask

    return lib.image("T_pebble_glass", W, H, glass), lib.image("T_pebble_emit", W, H, emit)


def hall_shell_texture():
    """
    会议中心金属壳（u 沿周长、每张贴图 64 m；v 从檐口 0 到穹顶中心 1）：
    银灰铝板 + 每 2 m 一道经向肋条 + 两道纬向环梁；顶部中央一块深色玻璃天窗（设计稿穹顶中央的椭圆）
    """
    W, H = 1024, 256

    def paint(a):
        a[..., 0], a[..., 1], a[..., 2] = 0.5, 0.53, 0.58
        n = _rng(3).random((H, W)).astype(np.float32) * 0.03
        a[..., :3] += n[..., None]
        for k in range(0, W, 32):
            a[:, k : k + 5, :3] = (0.3, 0.33, 0.38)
        for v in (0.34, 0.62):
            y = int(v * H)
            a[y : y + 3, :, :3] = (0.3, 0.33, 0.38)
        top = int(0.84 * H)
        a[top:, :, :3] = (0.1, 0.13, 0.18)
        a[top : top + 4, :, :3] = (0.72, 0.75, 0.8)

    return lib.image("T_hall_shell", W, H, paint)


def lobby_texture():
    """
    塔楼大堂玻璃（与塔身同一套 UV：贴图宽 = 64 × 1.5 m，高 = 32 层，大堂只用到最下面 14 m）：
    暖光玻璃 + 1.5 m 一道竖梃、4.6 m / 9.2 m 两道横档，避免大堂读成一整块发光的圆柱
    """
    W, H = 1024, 1024
    mv = TOWER_TEX_FLOORS * TOWER_FLOOR  # 贴图高度对应的米数
    cw = W // TOWER_TEX_COLS

    def paint(a):
        y = np.arange(H, dtype=np.float32)[:, None] / H * mv
        # 越靠地面越亮（门厅灯 + 地灯）
        k = np.clip(1.0 - y / 18.0, 0.55, 1.0)
        a[..., 0], a[..., 1], a[..., 2] = 1.0 * k, 0.82 * k, 0.58 * k
        for c in range(TOWER_TEX_COLS):
            a[:, c * cw : c * cw + 2, :3] = (0.12, 0.1, 0.08)
        for z in (4.6, 9.2, 13.6):
            r = int(z / mv * H)
            a[r : r + 3, :, :3] = (0.12, 0.1, 0.08)

    return lib.image("T_lobby", W, H, paint)


def paving_texture():
    """园区铺装：蓝灰石材，3 m 分格（贴图覆盖 12 m）"""
    W = 512

    def paint(a):
        rng = _rng(5)
        # 铺装比沥青略亮、比人行道暗：楼前广场与路外地面读成灰色石材，而不是一片黑
        base = np.array([0.15, 0.163, 0.18], dtype=np.float32)
        a[..., :3] = base + rng.random((W, W, 1)).astype(np.float32) * 0.02
        cell = W // 4
        for i in range(4):
            for j in range(4):
                a[i * cell : (i + 1) * cell, j * cell : (j + 1) * cell, :3] += rng.random() * 0.025
        for k in range(0, W, cell):
            a[k : k + 2, :, :3] = 0.1
            a[:, k : k + 2, :3] = 0.1

    return lib.image("T_paving", W, W, paint)


def grass_texture():
    """
    草地：中绿杂色（贴图覆盖 16 m）。
    贴图按 sRGB 存，0.3 左右的 sRGB 值换成线性反照率才 0.07；原来画到 0.03～0.08 时线性反照率不到 0.01，
    夜景烘焙后草坪整片发黑。设计稿的草坪在夜里仍是看得出的中绿，所以底色要给到白天草坪的亮度
    """
    W = 512

    def paint(a):
        rng = _rng(9)
        n = rng.random((W // 8, W // 8)).astype(np.float32)
        n = np.kron(n, np.ones((8, 8), dtype=np.float32))  # 大块明暗（修剪纹路、深浅不一的草）
        f = rng.random((W, W)).astype(np.float32)
        # 偏黄的草绿（设计稿草坪在暖色路灯下是黄绿色，不是冷的蓝绿）
        a[..., 0] = 0.22 + 0.05 * n + 0.03 * f
        a[..., 1] = 0.46 + 0.09 * n + 0.05 * f
        a[..., 2] = 0.12 + 0.03 * n + 0.02 * f

    return lib.image("T_grass", W, W, paint)


def build():
    """创建全部材质，返回 {名字: 材质}"""
    tg, te = tower_textures()
    pg, pe = pebble_textures()
    M = {}
    m = lib.material
    # ---- 沙盘与地面
    M["slab"] = m("M_slab", "#0a1322", metal=0.6, rough=0.45)
    M["slab_edge"] = m("M_slab_edge", "#2de2e6", emit="#2de2e6", strength=6.0)
    M["paving"] = m("M_paving", "#ffffff", rough=0.75, tex=paving_texture())
    # 路面与人行道比周边亮一档：夜景里路面中灰、人行道浅灰，才能和深色草地 / 铺装分开（原来的近黑沥青整片糊成黑）
    M["sidewalk"] = m("M_sidewalk", "#7b8591", rough=0.8)
    M["curb"] = m("M_curb", "#b9c1cb", rough=0.6)
    # 园路（园内步道 / 服务道路）：米灰色铺装，比人行道暖、比草坪亮
    M["path"] = m("M_path", "#a7a294", rough=0.8)
    M["asphalt"] = m("M_asphalt", "#3d444e", rough=0.6)
    # 标线带一点自发光（反光漆被车灯 / 路灯照亮），远看也是清楚的白线
    M["lane"] = m("M_lane", "#eef2f6", rough=0.5, emit="#dfe6ee", strength=0.6)
    M["lane_cyan"] = m("M_lane_cyan", "#2bb8ff", emit="#2bb8ff", strength=2.5)
    M["grass"] = m("M_grass", "#ffffff", rough=0.9, tex=grass_texture())
    M["water"] = m("M_water", "#06182a", metal=0.4, rough=0.06)
    M["water_edge"] = m("M_water_edge", "#3a5a72", rough=0.6)
    # ---- 塔楼
    M["tower_glass"] = _emissive_tex(m("M_tower_glass", "#ffffff", metal=0.75, rough=0.12, tex=tg), te, 1.5)
    M["tower_gold"] = m("M_tower_gold", "#ffc65a", emit="#ffc65a", strength=9.0)
    M["tower_roof"] = m("M_tower_roof", "#1a2230", metal=0.5, rough=0.4)
    # 冠顶凹面里的同心光环（设计稿塔顶那几圈椭圆光），比檐口金线弱
    M["tower_crown"] = m("M_tower_crown", "#ffd88a", emit="#ffc65a", strength=3.0)
    M["lobby"] = m("M_lobby", "#ffffff", rough=0.3, tex=lobby_texture(), emit_tex=True, strength=2.6)
    # ---- 鹅卵石楼 / 会议中心
    M["pebble_glass"] = _emissive_tex(m("M_pebble_glass", "#ffffff", metal=0.3, rough=0.25, tex=pg), pe, 1.6)
    M["pebble_roof"] = m("M_pebble_roof", "#7a8592", rough=0.7)
    M["roof_green"] = m("M_roof_green", "#2c5a33", rough=0.9)
    # 银白金属檐口：带一点冷白自发光（夜景泛光照亮的铝板），读出设计稿那圈亮白檐口
    M["roof_edge"] = m("M_roof_edge", "#d8dee6", metal=0.35, rough=0.35, emit="#dfe8f5", strength=1.0)
    M["hall_shell"] = m("M_hall_shell", "#ffffff", metal=0.45, rough=0.35, tex=hall_shell_texture())
    M["hall_glass"] = m("M_hall_glass", "#ffe0b0", emit="#ffcf8a", strength=2.0)
    M["equip"] = m("M_equip", "#59626e", metal=0.5, rough=0.5)
    M["small"] = m("M_small", "#4a5562", rough=0.6)
    # ---- 植物与小品
    M["tree"] = vertex_color_material("M_tree", rough=0.85)
    M["bollard"] = m("M_bollard", "#2b313a", metal=0.5, rough=0.5)
    M["bollard_head"] = m("M_bollard_head", "#ffe2b8", emit="#ffcf8f", strength=6.0)
    M["lamp_pole"] = m("M_lamp_pole", "#2b313a", metal=0.6, rough=0.4)
    M["lamp_head"] = m("M_lamp_head", "#fff1d6", emit="#ffd9a0", strength=12.0)
    return M


def _emissive_tex(mat, img, strength):
    """给材质再接一张自发光贴图（窗灯），自发光强度走 KHR_materials_emissive_strength"""
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    if bsdf.inputs["Emission Color"].is_linked:
        return mat
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = img
    node.location = (-400, -200)
    nt.links.new(node.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def vertex_color_material(name, rough=0.85):
    """颜色取顶点色（Color Attribute 节点 → Base Color）；glTF 导出为 COLOR_0，three.js 自动开启 vertexColors"""
    mat = lib.material(name, "#ffffff", rough=rough)
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    if not bsdf.inputs["Base Color"].is_linked:
        node = nt.nodes.new("ShaderNodeVertexColor")
        node.layer_name = "Col"
        node.location = (-400, 0)
        nt.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    return mat

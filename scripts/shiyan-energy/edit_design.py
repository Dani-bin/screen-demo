"""在 AI 设计稿上做后期修改（不重新生图）。

用法：python scripts/shiyan-energy/edit_design.py
按 EDITS 依次处理：读 docs/design/shiyan-energy/design/<输入>，逐步执行 steps，写出 <输出>；
后一项可以读前一项的输出（v1-c → v1-c2 → v1-c3）。坐标都是图像像素（1536 × 864）。

可用的步骤（op）：
  clone       多边形内换成平移后的像素（去掉不要的树林等），边缘羽化
  pv_roof     在四边形上铺一块光伏屋面：纹理取自 PV_SRC（图中现有重卡车棚的屋面，先透视拉正再贴到新四边形上）；
              keep 里的四边形保留原像素（原有屋面不动，只补缺的部分）
  erase_posts 抹掉细竖柱：柱子范围内每一行用左右两侧的像素线性插值
  post        画一根黄色钢柱
  fascia      沿屋面边线往下画檐口（白色面 + 黄色下沿）
  shade       棚下阴影：多边形内压暗（上缘最暗，往下渐浅）
  label       叠加文字（路名），白字 + 深色描边 + 投影
"""

import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DESIGN = os.path.join(ROOT, "docs/design/shiyan-energy/design")
FONT = os.path.join(ROOT, "src/assets/fonts/AlimamaShuHeiTi-Bold.ttf")

YELLOW = (232, 176, 22)
YELLOW_DARK = (176, 128, 12)
FASCIA_WHITE = (228, 231, 234)

# 光伏纹理来源：v1-c2 里前排重卡车棚的屋面（后左、后右、前右、前左，各向内收 2 px 避开檐口），
# 实际约 90 m × 20 m；拉正时按 16 像素 / 米采样
PV_SRC = {"file": "v1-c2.png", "quad": [(279, 375), (1080, 457), (1064, 489), (241, 395)], "meters": (90, 20)}
PX_PER_M = 16


def fascia_y(x):
    """v1-c2 前排车棚前檐黄色下沿的 y（实测 x=262 处 404、x=1062 处 503，直线）"""
    return 404 + 0.1236 * (x - 262)


# 前排车棚前檐下要抹掉的柱子 x（保留 262 左角柱、636 中柱、1062 右角柱），柱子从檐口下沿到地面约 31 px
ERASE_FRONT = [326, 378, 438, 508, 564, 704, 794, 860, 950]

# 合并后的重卡大棚屋面：后排车棚后檐 → 前排车棚前檐（后左、后右、前右、前左）；右端两棚本来共线
TRUCK_ROOF = [(340, 305), (1113, 368), (1067, 492), (238, 396)]
# 原有两块屋面（保留原像素）：后排车棚屋面（前檐线以上）、前排车棚屋面
ROOF_BACK = [(340, 305), (1113, 368), (1102, 395), (330, 322)]
ROOF_FRONT = [(277, 373), (1083, 455), (1067, 492), (238, 396)]

# 储能 / 箱变光伏棚：平面上是标准矩形，画面里是平行四边形——
# 前后檐与重卡大棚的长边平行（斜率 ESS_SLOPE），两端与重卡大棚左端平行（进深方向）
ESS_FOOT = (70, 413)  # 前左柱脚（地面）
ESS_H = 30  # 柱高（檐口下沿到地面，像素），与重卡大棚相当
FASCIA = 7  # 檐口高（白 5 + 黄 2）
ESS_SLOPE = 0.1  # 前后檐斜率
ESS_GAP = 20  # 右端与重卡大棚左端的水平间距（中间是通道）
ESS_DEPTH = 105  # 沿进深方向的长度（像素），约 46 m；前檐约 17 m


def ess_roof():
    """储能棚屋面四角（后左、后右、前右、前左）"""
    fl = (ESS_FOOT[0], ESS_FOOT[1] - ESS_H - FASCIA)
    (bx, by), (fx, fy) = TRUCK_ROOF[0], TRUCK_ROOF[3]
    k = (bx - fx) / (fy - by)  # 重卡大棚左端：x = bx - k (y - by)
    # 前右角：前檐线 y = fl.y + s (x - fl.x) 与「大棚左端左移 GAP」的交点
    x = (bx - ESS_GAP - k * (fl[1] - ESS_SLOPE * fl[0] - by)) / (1 + k * ESS_SLOPE)
    fr = (x, fl[1] + ESS_SLOPE * (x - fl[0]))
    n = np.hypot(bx - fx, by - fy)
    d = ((bx - fx) / n * ESS_DEPTH, (by - fy) / n * ESS_DEPTH)  # 进深方向（往后）
    return [(fl[0] + d[0], fl[1] + d[1]), (fr[0] + d[0], fr[1] + d[1]), fr, fl]


ESS_ROOF = ess_roof()


def ess_post(t_front, t_depth):
    """储能棚的柱：t_front 沿前檐（0 左 → 1 右）、t_depth 沿进深（0 前 → 1 后）的位置"""
    bl, br, fr, fl = ESS_ROOF
    x = fl[0] + (fr[0] - fl[0]) * t_front + (bl[0] - fl[0]) * t_depth
    y = fl[1] + (fr[1] - fl[1]) * t_front + (bl[1] - fl[1]) * t_depth
    inset = -4 if t_front > 0.5 else 5  # 柱子比檐角向内收几像素
    return {"op": "post", "x": x + inset, "y0": y + FASCIA, "y1": y + FASCIA + ESS_H, "w": 4}

# 园区路东侧旱地草带（v1-c3 实测）：西边是园区路路缘、东边是白色围栏、南端是挡墙石砌顶
CURB = ((1291, 180), (1260, 322))
FENCE = ((1340, 190), (1362, 335))
# 子弹头土坡（地面轮廓）：南端平底贴着挡墙顶（左、右端点），北端尖头；坡高 MOUND_H 像素（约 3.5 m）
MOUND_BASE = ((1268, 318), (1352, 331))
MOUND_TIP = (1314, 188)
MOUND_H = 16

# 右侧上半组厂房整体左移 SHIFT 像素：从小路东边开始（小路和围栏不动，小路与厂房之间的树带变窄），
# 到下半组大厂房屋面上沿（y≈379，天然的水平分界）为止；顶部 128~146 行在荒地里渐变
SHIFT = 15


def path_right(y):
    """厂房前小路的东边线 x（实测 (1372,190)→(1404,335)，190 以上是荒地，取 1362）"""
    return 1362 if y < 190 else min(1406, 1372 + 0.2207 * (y - 190))


EDITS = [
    {
        "src": "v1-c.png",
        "out": "v1-c2.png",
        "steps": [
            # 右上角树林（园区路东侧、厂房屋顶以北，即用户红圈处）：换成同一行、园区路西侧后方预留地的荒地
            # （同一行像素远近相同，透视尺度一致）；左边界贴着园区路东侧路缘石外 2 px，不碰路面
            {"op": "clone", "shift": (300, 0), "feather": 3,
             "poly": [(1313, 84), (1350, 88), (1400, 98), (1460, 104), (1536, 110), (1536, 147), (1384, 146),
                      (1384, 152), (1302, 152), (1305, 130), (1309, 110)]},
            # 路边往下到厂房西北角、旱地草带以北的一段树：取西侧预留地中段的荒地，
            # 源区 x 1093~1186、y 108~154 全在荒地里，不碰综合楼和大棚
            {"op": "clone", "shift": (200, 38), "feather": 4,
             "poly": [(1302, 146), (1384, 144), (1387, 166), (1374, 192), (1345, 187), (1292, 185), (1297, 170)]},
            # 东环路：标在前景主路北侧车道里（路缘线向右下倾约 4.5°），避开左侧的车和右侧的导向箭头
            {"op": "label", "text": "东 环 路", "xy": (548, 797), "size": 36, "angle": -4.5},
        ],
    },
    {
        "src": "v1-c2.png",
        "out": "v1-c3.png",
        "steps": [
            # 1. 两排重卡车棚合成一个大棚：先抹掉前檐下多余的柱子（只留左角、中间、右角三根），
            #    以及后排车棚右前角那根（合并后它落在大棚右端中段，不要）
            {"op": "erase_posts",
             "posts": [(x, fascia_y(x) + 1, fascia_y(x) + 31, 3) for x in ERASE_FRONT] + [(1095, 401, 439, 3)]},
            # 2. 铺合并后的屋面：原有两块屋面保留，只补两棚之间的空档、后排前檐和两端的小三角
            {"op": "pv_roof", "quad": TRUCK_ROOF, "meters": (90, 58), "keep": [ROOF_BACK, ROOF_FRONT]},
            # 3. 两端檐口（右端可见面 + 左端细边），后右角柱（伸出大棚右端外，看得见）
            {"op": "fascia", "line": [TRUCK_ROOF[1], TRUCK_ROOF[2]], "white": 6, "yellow": 2},
            {"op": "fascia", "line": [TRUCK_ROOF[0], TRUCK_ROOF[3]], "white": 3, "yellow": 1},
            {"op": "post", "x": 1111, "y0": 376, "y1": 405, "w": 5},
            # 4. 储能 / 箱变光伏棚（标准矩形）：棚下阴影（前檐下、右端下两条看得见的带）、屋面、檐口、柱
            #    柱子：前檐两角 + 右侧长边前、中、后（左侧长边的柱被屋面挡住）
            {"op": "shade", "strength": 0.45,
             "poly": [ESS_ROOF[3], ESS_ROOF[2], (ESS_ROOF[2][0], ESS_ROOF[2][1] + ESS_H + FASCIA),
                      (ESS_ROOF[3][0], ESS_ROOF[3][1] + ESS_H + FASCIA)]},
            {"op": "shade", "strength": 0.35,
             "poly": [ESS_ROOF[2], ESS_ROOF[1], (ESS_ROOF[1][0], ESS_ROOF[1][1] + ESS_H + FASCIA),
                      (ESS_ROOF[2][0], ESS_ROOF[2][1] + ESS_H + FASCIA)]},
            {"op": "pv_roof", "quad": ESS_ROOF, "meters": (17, 46), "keep": []},
            {"op": "fascia", "line": [ESS_ROOF[0], ESS_ROOF[3]], "white": 2, "yellow": 1},
            {"op": "fascia", "line": [ESS_ROOF[1], ESS_ROOF[2]], "white": 5, "yellow": 2},
            {"op": "fascia", "line": [ESS_ROOF[3], ESS_ROOF[2]], "white": 5, "yellow": 2},
            ess_post(0, 0), ess_post(1, 0), ess_post(1, 0.5), ess_post(1, 1),
        ],
    },
    {
        "src": "v1-c3.png",
        "out": "v1-c4.png",
        "steps": [
            # 1. 右侧上半组厂房往左靠（连同它前面的树一起平移，图右边缘补一段重复的屋面）
            {"op": "shift_block", "dx": SHIFT, "x_left": path_right, "y_top": 128, "ramp": 18, "y_bottom": 378},
            # 2. 旱地草带上堆一个子弹头形的草坡（用户红圈处）
            {"op": "mound", "base": MOUND_BASE, "tip": MOUND_TIP, "height": MOUND_H},
        ],
    },
]


# ---------------------------------------------------------------- 几何


def persp_coeffs(dst, src):
    """PIL PERSPECTIVE 变换系数：输出图上的点 dst[i] 取输入图上的 src[i]"""
    a, b = [], []
    for (x, y), (X, Y) in zip(dst, src):
        a.append([x, y, 1, 0, 0, 0, -X * x, -X * y])
        b.append(X)
        a.append([0, 0, 0, x, y, 1, -Y * x, -Y * y])
        b.append(Y)
    return np.linalg.solve(np.array(a, float), np.array(b, float)).tolist()


def poly_mask(size, polys, feather=0):
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    for p in polys:
        d.polygon([tuple(map(float, q)) for q in p], fill=255)
    return m.filter(ImageFilter.GaussianBlur(feather)) if feather else m


_PV_TEX = None


def pv_texture():
    """把 PV_SRC 的屋面透视拉正成矩形纹理（宽 = 长度方向，高 = 进深方向，后檐在上）"""
    global _PV_TEX
    if _PV_TEX is None:
        img = Image.open(os.path.join(DESIGN, PV_SRC["file"])).convert("RGBA")
        w, h = (int(m * PX_PER_M) for m in PV_SRC["meters"])
        rect = [(0, 0), (w, 0), (w, h), (0, h)]
        _PV_TEX = img.transform((w, h), Image.PERSPECTIVE, persp_coeffs(rect, PV_SRC["quad"]), Image.BICUBIC)
    return _PV_TEX


# ---------------------------------------------------------------- 步骤


def op_clone(img, poly, shift, feather):
    dx, dy = shift
    moved = Image.new("RGBA", img.size, (0, 0, 0, 0))
    moved.paste(img, (dx, dy))
    return Image.composite(moved, img, poly_mask(img.size, [poly], feather))


def op_pv_roof(img, quad, meters, keep):
    """纹理按实际尺寸平铺（屋面进深超过纹理时上下重复），再透视贴到 quad；keep 内保留原像素。
    平铺图四周多铺 PAD 像素，透视采样到 quad 边缘时不会取到纹理外的透明黑（否则檐口边会出现黑色虚线）"""
    tex = pv_texture()
    w, h = (int(m * PX_PER_M) for m in meters)
    pad = 32
    tiled = Image.new("RGBA", (w + 2 * pad, h + 2 * pad))
    for y in range(-tex.height, h + 2 * pad, tex.height):
        for x in range(-tex.width, w + 2 * pad, tex.width):
            tiled.paste(tex, (x + pad, y + pad))
    rect = [(pad, pad), (pad + w, pad), (pad + w, pad + h), (pad, pad + h)]
    warped = tiled.transform(img.size, Image.PERSPECTIVE, persp_coeffs(quad, rect), Image.BICUBIC)
    mask = poly_mask(img.size, [quad])
    if keep:
        # 保留区向内收 1 px 再羽化，新旧屋面的接缝软一点
        k = poly_mask(img.size, keep).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1))
        mask = Image.fromarray((np.asarray(mask, float) * (1 - np.asarray(k, float) / 255)).astype(np.uint8))
    return Image.composite(warped, img, mask)


def op_erase_posts(img, posts):
    """每根柱子 (中心 x, 顶 y, 底 y, 半宽)：每行在 [x-半宽, x+半宽] 内用两侧像素插值；底部 5 行（柱脚）加宽 2 px"""
    a = np.asarray(img, float).copy()
    for xc, y0, y1, hw in posts:
        for y in range(int(y0), int(y1) + 1):
            w = hw + (2 if y > y1 - 5 else 0)
            x0, x1 = int(round(xc - w - 1)), int(round(xc + w + 1))
            left, right = a[y, x0], a[y, x1]
            for x in range(x0 + 1, x1):
                t = (x - x0) / (x1 - x0)
                a[y, x] = left * (1 - t) + right * t
    return Image.fromarray(a.astype(np.uint8))


SS = 4  # 抗锯齿：在 4 倍图层上画，再缩小叠回


def draw_aa(img, shapes):
    """抗锯齿多边形：shapes = [(点列, 颜色)]，只在外接框范围内放大绘制"""
    xs = [x for pts, _ in shapes for x, _ in pts]
    ys = [y for pts, _ in shapes for _, y in pts]
    x0, y0 = int(min(xs)) - 2, int(min(ys)) - 2
    w, h = int(max(xs)) - x0 + 3, int(max(ys)) - y0 + 3
    lay = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    for pts, col in shapes:
        d.polygon([((x - x0) * SS, (y - y0) * SS) for x, y in pts], fill=col + (255,))
    img.alpha_composite(lay.resize((w, h), Image.LANCZOS), (x0, y0))
    return img


def op_post(img, x, y0, y1, w):
    """黄色钢柱：亮面 + 右侧暗面 + 灰色柱脚"""
    l, r = x - w / 2, x + w / 2
    dark = r - max(1.0, w / 3)
    return draw_aa(img, [([(l, y0), (r, y0), (r, y1), (l, y1)], YELLOW),
                         ([(dark, y0), (r, y0), (r, y1), (dark, y1)], YELLOW_DARK),
                         ([(l - 1, y1 - 2), (r + 1, y1 - 2), (r + 1, y1), (l - 1, y1)], (150, 150, 146))])


def op_fascia(img, line, white, yellow):
    """沿屋面边线往下画檐口：白色面 white px + 黄色下沿 yellow px"""
    (x0, y0), (x1, y1) = line
    return draw_aa(img, [([(x0, y0), (x1, y1), (x1, y1 + white), (x0, y0 + white)], FASCIA_WHITE),
                         ([(x0, y0 + white), (x1, y1 + white), (x1, y1 + white + yellow),
                           (x0, y0 + white + yellow)], YELLOW)])


def op_shade(img, poly, strength):
    """多边形内压暗，上缘最暗（strength），往下线性变浅到 0"""
    m = np.asarray(poly_mask(img.size, [poly], 1), float) / 255
    ys = [p[1] for p in poly]
    top, bot = min(ys), max(ys)
    grad = np.clip((bot - np.arange(img.height)) / max(bot - top, 1), 0, 1)[:, None]
    k = 1 - strength * m * (0.4 + 0.6 * grad)
    a = np.asarray(img, float)
    a[..., :3] *= k[..., None]
    return Image.fromarray(a.astype(np.uint8))


def op_label(img, text, xy, size, angle):
    font = ImageFont.truetype(FONT, size)
    w, h = font.getbbox(text)[2] + 40, size + 40
    lay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(lay).text((w / 2, h / 2), text, font=font, fill=(255, 255, 255, 255), anchor="mm",
                             stroke_width=2, stroke_fill=(20, 28, 40, 200))
    shadow = Image.new("RGBA", lay.size, (0, 0, 0, 0))
    shadow.putalpha(lay.getchannel("A").filter(ImageFilter.GaussianBlur(4)).point(lambda v: v * 0.6))
    out = Image.new("RGBA", lay.size, (0, 0, 0, 0))
    out.alpha_composite(shadow, (3, 3))
    out.alpha_composite(lay)
    out = out.rotate(angle, resample=Image.BICUBIC, expand=True)
    img.alpha_composite(out, (int(xy[0] - out.width / 2), int(xy[1] - out.height / 2)))
    return img


def op_shift_block(img, dx, x_left, y_top, ramp, y_bottom):
    """
    把 x_left(y) 以东、y_top..y_bottom 行的内容整体左移 dx 像素（亚像素线性插值）：
    新图 x 处取原图 x + dx 处；图右边缘最后 dx 列保持原样，等于把边缘那段屋面重复一次（厂房屋面是重复的长条，看不出接缝）。
    顶部 ramp 行内移动量从 0 渐变到 dx；左边界羽化 4 px，避免出现竖直接缝
    """
    a = np.asarray(img, float)
    out = a.copy()
    w = a.shape[1]
    x_cut = w - dx
    xs = np.arange(w, dtype=float)
    for y in range(y_top, y_bottom + 1):
        d = dx * min(1.0, (y - y_top) / ramp)
        x0 = int(x_left(y))
        cols = np.arange(x0, x_cut)
        src = cols + d
        for c in range(a.shape[2]):
            out[y, x0:x_cut, c] = np.interp(src, xs, a[y, :, c])
        # 左边界羽化：前 4 列由原图渐变到移动后的内容
        for i in range(4):
            t = (i + 1) / 5
            out[y, x0 + i] = a[y, x0 + i] * (1 - t) + out[y, x0 + i] * t
    return Image.fromarray(out.astype(np.uint8))


def op_mound(img, base, tip, height):
    """
    子弹头形草坡：南端平底（base 两点）、北端尖头（tip），平面轮廓半宽 w(s) = W/2 · (1 − s²)^0.6（s 为底 → 尖，两侧外凸）；
    坡高沿长轴 g(s)：南端 10% 内由 0 升起（朝南的短陡坡），之后向北缓降到尖头为 0；
    横断面是两面坡 + 圆脊（不用圆拱：圆拱在斜光下只是一片渐变，看着像斜平面，两面坡才有明暗分界的脊线）。
    渲染：在 3 倍分辨率上按「从北往南」顺序把地面采样点画到 (x, y − 高度) 处（近处遮挡远处），
    光照取西南方向阳光（与图中建筑的明暗一致），东北侧在地上投一道阴影
    """
    from scipy.ndimage import gaussian_filter

    (bx0, by0), (bx1, by1) = base
    bc = np.array([(bx0 + bx1) / 2, (by0 + by1) / 2])
    axis = np.array(tip, float) - bc
    half = np.hypot(bx1 - bx0, by1 - by0) / 2
    u = np.array([bx1 - bx0, by1 - by0], float) / (2 * half)

    # 采样：南端陡坡在屏幕上拉得长，s 方向在底部加密（s = t^1.5），否则会漏像素
    ns, nr = 1300, 500
    s, r = np.meshgrid(np.linspace(0, 1, ns) ** 1.5, np.linspace(-1, 1, nr), indexing="ij")
    wid = half * (1 - s * s) ** 0.6
    gx = bc[0] + s * axis[0] + r * wid * u[0]  # 地面点（图像坐标）
    gy = bc[1] + s * axis[1] + r * wid * u[1]
    g = np.clip(s / 0.1, 0, 1) ** 2 * (3 - 2 * np.clip(s / 0.1, 0, 1)) * (1 - s) ** 0.9
    e = 0.012  # 脊线圆角
    ridge = (np.sqrt(1 + e) - np.sqrt(r * r + e)) / (np.sqrt(1 + e) - np.sqrt(e))
    h = height * g * ridge

    # 法线：换成大致的米制坐标再求（水平 1 m ≈ 9.2 px、地面进深 1 m ≈ 2.4 px、高度 1 m ≈ 4.3 px）
    X, Y, Z = gx / 9.2, gy / 2.4, h / 4.3
    dXs, dYs, dZs = (np.gradient(q, axis=0) for q in (X, Y, Z))
    dXr, dYr, dZr = (np.gradient(q, axis=1) for q in (X, Y, Z))
    n = np.stack([dYs * dZr - dZs * dYr, dZs * dXr - dXs * dZr, dXs * dYr - dYs * dXr], -1)
    n *= np.sign(n[..., 2:3] + 1e-9)
    n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9
    sun = np.array([-0.7, 0.35, 0.62])  # 指向太阳：西（−x）、南（+y，朝镜头）、上；偏低，两侧坡面明暗分得开
    sun /= np.linalg.norm(sun)
    lit = np.clip(n @ sun, 0, 1) / sun[2]  # 平地 = 1
    shade = 0.3 + 0.78 * lit

    # 草坪颜色：两层噪声（贴在地面坐标上）；颜色取自图中其他草坪（偏黄绿、饱和度低）
    x0i, y0i = int(gx.min()) - 2, int(gy.min()) - 2
    rng = np.random.default_rng(7)
    H, W = int(gy.max()) - y0i + 4, int(gx.max()) - x0i + 4
    coarse = gaussian_filter(rng.random((H * 3, W * 3)), 9)
    fine = gaussian_filter(rng.random((H * 3, W * 3)), 1.2)
    coarse = (coarse - coarse.min()) / (np.ptp(coarse) + 1e-9)
    fine = (fine - fine.min()) / (np.ptp(fine) + 1e-9)
    iy = np.clip(((gy - y0i) * 3).astype(int), 0, H * 3 - 1)
    ix = np.clip(((gx - x0i) * 3).astype(int), 0, W * 3 - 1)
    c0, c1 = np.array([86, 102, 56], float), np.array([128, 140, 82], float)
    col = c0 + (c1 - c0) * coarse[iy, ix][..., None]
    col *= (0.84 + 0.32 * fine[iy, ix])[..., None]
    col *= shade[..., None]
    col *= (1 - 0.18 * np.clip((np.abs(r) - 0.8) / 0.2, 0, 1))[..., None]  # 坡脚一圈略暗（接地）
    col = col.clip(0, 255)
    alpha = np.clip((1 - np.abs(r)) / 0.06, 0, 1)  # 轮廓边缘 6% 渐隐，与旱地草带自然过渡

    # 地上阴影（东北方向：右、略上），先压暗地面
    a = np.asarray(img, float).copy()
    foot = Image.new("L", img.size, 0)
    outline = [(bx0, by0)] + [tuple(p) for p in zip(gx[:, 0], gy[:, 0])] + [tuple(p) for p in zip(gx[::-1, -1], gy[::-1, -1])]
    ImageDraw.Draw(foot).polygon([(x + 6, y - 2) for x, y in outline], fill=255)
    sh = np.asarray(foot.filter(ImageFilter.GaussianBlur(3)), float)[..., None] / 255
    a[..., :3] *= 1 - 0.3 * sh

    # 3 倍分辨率上按地面 y 从小到大（北 → 南）依次画，南边的点后画、盖住北边
    SSM = 3
    sx = ((gx - x0i) * SSM).ravel()
    sy = ((gy - h - y0i) * SSM).ravel()
    order = np.argsort(gy.ravel(), kind="stable")
    lay = np.zeros((H * SSM, W * SSM, 4))
    xi = np.clip(sx[order].astype(int), 0, W * SSM - 1)
    yi = np.clip(sy[order].astype(int), 0, H * SSM - 1)
    lay[yi, xi, :3] = col.reshape(-1, 3)[order]
    lay[yi, xi, 3] = alpha.ravel()[order]
    small = np.asarray(Image.fromarray((lay * [1, 1, 1, 255]).clip(0, 255).astype(np.uint8), "RGBA")
                       .resize((W, H), Image.BOX), float)
    k = small[..., 3:4] / 255
    reg = a[y0i:y0i + H, x0i:x0i + W, :3]
    a[y0i:y0i + H, x0i:x0i + W, :3] = reg * (1 - k) + small[..., :3] * k
    return Image.fromarray(a.astype(np.uint8))


OPS = {"clone": op_clone, "pv_roof": op_pv_roof, "erase_posts": op_erase_posts, "post": op_post,
       "fascia": op_fascia, "shade": op_shade, "label": op_label, "shift_block": op_shift_block,
       "mound": op_mound}


def main():
    for e in EDITS:
        img = Image.open(os.path.join(DESIGN, e["src"])).convert("RGBA")
        for step in e["steps"]:
            args = {k: v for k, v in step.items() if k != "op"}
            img = OPS[step["op"]](img, **args)
        out = os.path.join(DESIGN, e["out"])
        img.convert("RGB").save(out, optimize=True)
        print("写出", out)


if __name__ == "__main__":
    main()

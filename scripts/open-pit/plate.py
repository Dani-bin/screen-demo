"""总览底图（设计稿场景图）的预处理：擦掉图里画好的静态卡车、求运输路线、写出页面数据。

为什么要这一步：实时三维拔不到设计稿那种质感（评审 3 分上下），所以总览视角直接用设计稿里那张 AI 场景图做底，
页面在上面实时叠加卡车、预警、选中等（近景视角仍是实时三维）。图里原本画着几十辆静止的卡车，会和实时卡车重复，
所以先用图像修补把它们擦掉。

输入：docs/design/open-pit/design/src/scene-a1.png（1536 × 864，docs 不入库，只在本地）
输出：
  public/open-pit/overview.webp                 擦掉静态卡车、放大 2 倍的底图
  src/views/open-pit/data/plate.json            图像坐标（1536 × 864 像素）下的设备锚点、每台电铲的运输路线、换电站、皮带
用法：python3 scripts/open-pit/plate.py [--check <png>]  （--check 把路线叠在底图上存成 png，肉眼核对）

坑里的环路：手读两条轮廓（坑沿环 RIM 和坑底环 FLOOR，图像像素），中间的台阶环沿每条射线线性内插
（台阶本来就是沿每条射线等深度排开的）；每台电铲的路线 = 从它所在的环出发，绕坑螺旋爬向坑沿，再接到卸载点。
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "docs/design/open-pit/design/src/scene-a1.png"
OUT_IMG = ROOT / "public/open-pit/overview.webp"
OUT_JSON = ROOT / "src/views/open-pit/data/plate.json"
OUT_OUTLINE = ROOT / "scripts/blender/open_pit/outline.json"
OUT_GROUND = ROOT / "models/open-pit/design_ground.png"  # Blender 模型版的地表 / 坑底投影贴图（models/ 不入库）
OUT_PIT = ROOT / "models/open-pit/design_pit.png"  # Blender 模型版的台阶 / 排土场投影贴图（擦掉卡车和电铲，填坑壁岩石）

W, H = 1536, 864
UPSCALE = 2

# 底图在舞台（1920 × 1080 设计稿坐标）里的位置：设计稿 drafts.html 里 .scene 的 left / top / width / height
STAGE = {"x": -110, "y": 92, "w": 1720, "h": 968}

# ---------------------------------------------------------------- 1. 擦掉静态卡车

# 不是卡车的亮块：电铲、轮斗、雷达塔、破碎站 / 皮带群、换电站、电厂
EXCLUDE_BOXES = [
    (725, 205, 805, 260), (595, 315, 675, 370), (1005, 280, 1070, 330), (720, 390, 790, 450),
    (910, 430, 980, 485), (520, 495, 605, 550), (635, 550, 700, 600),
    (900, 55, 1065, 135), (685, 45, 730, 145), (480, 150, 515, 255), (1280, 145, 1310, 245),
    (815, 560, 965, 645), (350, 628, 445, 685), (630, 650, 740, 710),
]
PLANT_POLY = [[1090, 520], [1536, 440], [1536, 864], [1090, 864]]


def erase_trucks(im):
    """检测小而亮、偏白的块（卡车），外扩后用图像修补擦掉"""
    rgb = im[..., ::-1].astype(float)
    lum = rgb.mean(2)
    sat = (rgb.max(2) - rgb.min(2)) / np.maximum(rgb.max(2), 1)
    top = lum - cv2.GaussianBlur(lum, (0, 0), 6)  # 局部对比：比周围亮出一截
    m = (top > 15) & (lum > 88) & (sat < 0.6)
    m = ndi.binary_closing(m, iterations=1)
    lab, _ = ndi.label(m)
    excl = np.zeros(m.shape, np.uint8)
    for x0, y0, x1, y1 in EXCLUDE_BOXES:
        excl[y0:y1, x0:x1] = 1
    cv2.fillPoly(excl, [np.array(PLANT_POLY, np.int32)], 1)
    keep = np.zeros(m.shape, np.uint8)
    n = 0
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        h = sl[0].stop - sl[0].start
        w = sl[1].stop - sl[1].start
        mask = lab[sl] == i
        cy, cx = (sl[0].start + sl[0].stop) // 2, (sl[1].start + sl[1].stop) // 2
        if 9 <= mask.sum() <= 380 and 3 <= w <= 34 and 3 <= h <= 22 and not excl[cy, cx]:
            keep[sl][mask] = 1
            n += 1
    mask = cv2.dilate(keep, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 9)))
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8))
    print(f"擦掉静态卡车 {n} 辆")
    return cv2.inpaint(im, mask * 255, 5, cv2.INPAINT_TELEA)


# ---------------------------------------------------------------- 2. 坑里的环路

# 坑沿环（最外一圈路）和坑底环：顺时针，从左上起，图像像素（对着底图手读，--check 叠图核对）
RIM = [(640, 158), (700, 132), (760, 122), (850, 113), (950, 108), (1040, 106), (1110, 115), (1170, 140), (1220, 170),
       (1250, 215), (1258, 255), (1240, 295), (1200, 325), (1150, 350), (1110, 380), (1095, 420), (1080, 470),
       (1050, 520), (1005, 560), (950, 592), (890, 612), (820, 625), (740, 638), (650, 650), (560, 655), (470, 655),
       (380, 645), (300, 630), (235, 600), (190, 560), (170, 520), (185, 470), (220, 430), (260, 395), (310, 350),
       (370, 305), (430, 265), (500, 225), (560, 195), (600, 175)]
FLOOR = [(560, 605), (500, 590), (520, 555), (580, 520), (650, 480), (720, 440), (790, 400), (860, 350), (930, 325),
         (1000, 302), (1060, 298), (1088, 320), (1080, 360), (1050, 420), (1010, 470), (960, 500), (900, 525),
         (820, 555), (740, 580), (650, 600)]
CENTER = np.array([790.0, 470.0])  # 在坑底环里面，两条轮廓都对它星形
N_ANG = 360


def radial(poly):
    """多边形按绕 CENTER 的角度重采样：返回角度数组和每个角度上最外面的交点半径"""
    P = np.array(poly, float)
    Q = np.vstack([P, P[:1]])
    ang = np.linspace(-np.pi, np.pi, N_ANG, endpoint=False)
    out = np.zeros(N_ANG)
    for i, t in enumerate(ang):
        d = np.array([np.cos(t), np.sin(t)])
        best = 0.0
        for a, b in zip(Q[:-1], Q[1:]):
            e = b - a
            M = np.array([[d[0], -e[0]], [d[1], -e[1]]])
            if abs(np.linalg.det(M)) < 1e-9:
                continue
            r, k = np.linalg.solve(M, a - CENTER)
            if r > 0 and 0 <= k <= 1:
                best = max(best, r)
        out[i] = best
    return ang, out


ANG, R_RIM = radial(RIM)
_, R_FLOOR = radial(FLOOR)


def ring_point(theta, s):
    """环上的点：theta 为图像坐标下的角度（弧度，y 向下），s 0 = 坑沿 → 1 = 坑底，都可以连续取值"""
    t = (theta + np.pi) % (2 * np.pi) - np.pi
    r = np.interp(t, ANG, R_RIM, period=2 * np.pi) * (1 - s) + np.interp(t, ANG, R_FLOOR, period=2 * np.pi) * s
    return CENTER + r * np.array([np.cos(t), np.sin(t)])


def locate(x, y):
    """图像点 → (theta, s)：s 用该方向上沿 / 坑底半径的比例反求"""
    theta = float(np.arctan2(y - CENTER[1], x - CENTER[0]))
    r = float(np.hypot(x - CENTER[0], y - CENTER[1]))
    rr = float(np.interp(theta, ANG, R_RIM, period=2 * np.pi))
    rf = float(np.interp(theta, ANG, R_FLOOR, period=2 * np.pi))
    return theta, float(np.clip((rr - r) / max(rr - rf, 1e-6), 0, 1))


def spiral(start, direction, exit_deg, sink, extra_turns=1.0, via=None):
    """从电铲点出发，绕坑螺旋爬向坑沿（s 线性减到 0），在 exit_deg 方向出坑，再接到卸载点 sink"""
    th0, s0 = locate(*start)
    th1 = np.deg2rad(exit_deg)
    # 沿 direction 转到出口方向的角度差（0..2π），再加 extra_turns 整圈让路线够长
    d = ((th1 - th0) * direction) % (2 * np.pi) + 2 * np.pi * extra_turns
    n = max(8, int(d / np.deg2rad(2)))
    pts = [np.array(start, float)]
    for i in range(1, n + 1):
        k = i / n
        pts.append(ring_point(th0 + direction * d * k, s0 * (1 - k)))
    tail = [np.array(p, float) for p in (via or [])] + [np.array(sink, float)]
    return smooth(np.vstack([pts, tail]))


def smooth(pts, step=3.0):
    """Catmull-Rom 平滑后按 step 像素等距重采样"""
    P = np.asarray(pts, float)
    P = np.vstack([P[0] - (P[1] - P[0]), P, P[-1] + (P[-1] - P[-2])])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for t in np.linspace(0, 1, 6, endpoint=False):
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t**2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t**3))
    out.append(P[-2])
    out = np.array(out)
    seg = np.hypot(*np.diff(out, axis=0).T)
    s = np.r_[0, np.cumsum(seg)]
    u = np.arange(0, s[-1], step)
    return np.c_[np.interp(u, s, out[:, 0]), np.interp(u, s, out[:, 1])]


# ---------------------------------------------------------------- 3. 设备锚点与路线

# 锚点（图像像素）：电铲、破碎站、电厂、煤场、换电站、排土场、轮斗、雷达，位置来自设计稿 drafts.html 里的标签
ANCHORS = {
    "ES-01": (560, 520), "ES-02": (665, 572), "ES-03": (640, 340), "ES-04": (775, 235),
    "ES-05": (1038, 300), "ES-06": (760, 418), "ES-07": (938, 457),
    "CR-01": (905, 598), "CR-02": (860, 500),
    "BC-02": (1075, 650), "PP-01": (1340, 612), "CY-01": (1290, 690),
    "SW-01": (395, 655), "SW-02": (685, 675),
    "DP-I": (1350, 330), "DP-W": (200, 300), "BW-01": (950, 100), "PV-01": (110, 300),
    "SR-01": (497, 200), "SR-02": (710, 100), "SR-03": (1297, 185),
    "OF-01": (1000, 790), "WT-01": (600, 60),
}
# 预警热区中心（设计稿 .heat）和故障车 TK-037 的位置
HEAT = (790, 165)
FAULT_SPOT = {"TK-037": (1130, 160)}

# 卸载点：西排土场在左栏后面，路线就伸到左边缘外；东排土场在坑东北；破碎站 CR-01 在坑南缘，CR-02 在坑底
SINK_W = (125, 505)
SINK_E = (1335, 345)


def build_routes():
    """每台电铲一条「装载点 → 卸载点」的路线（重载方向），页面里空载按反方向走"""
    A = ANCHORS
    return {
        "ES-01": spiral(A["ES-01"], +1, 190, SINK_W, 1.0),
        "ES-02": spiral(A["ES-02"], +1, 187, SINK_W, 1.0),
        "ES-03": spiral(A["ES-03"], -1, 192, SINK_W, 0.9),
        "ES-04": spiral(A["ES-04"], +1, -22, SINK_E, 1.0, via=[(1275, 275), (1310, 315)]),
        "ES-05": spiral(A["ES-05"], +1, -22, SINK_E, 1.0, via=[(1275, 275), (1310, 315)]),
        "ES-06": spiral(A["ES-06"], +1, 50, A["CR-01"], 0.8),
        # ES-07 → CR-02 是坑底短运距：直接在坑底走一小段
        "ES-07": smooth([A["ES-07"], (915, 478), (890, 490), A["CR-02"]]),
    }


def build_belt():
    """输煤走廊：CR-01 → 煤场（沿图里那条发光的长廊）"""
    return smooth([(850, 585), (905, 600), (1000, 625), (1100, 650), (1190, 672), (1235, 690)], 6.0)


# 地表投影贴图要再擦掉的「高出地面的东西」：投影到平地上会变成躺在地上的画（从别的角度看很怪），模型里另有三维的
TALL_BOXES = EXCLUDE_BOXES + [
    (1300, 575, 1465, 700),  # 冷却塔
    (1435, 570, 1462, 748), (1478, 572, 1504, 724),  # 烟囱
    (1195, 655, 1398, 778),  # 封闭煤场
    (1035, 625, 1212, 705),  # 输煤廊进煤场那一段
    (1378, 688, 1478, 805),  # 电厂主厂房
    (1285, 488, 1480, 602), (1462, 520, 1510, 580),  # 冷却塔和烟囱冒出的蒸汽（模型里用粒子）
]
# 投影贴图的布局：设计稿 2 倍放大后放在画布中间，四周留边，边上从镜像的图渐变到暗色地面（远处的地面都是这个颜色）
GROUND_TEX = {"w": 4096, "h": 2304, "pad_x": 512, "pad_y": 288, "scale": 2}


def fill_holes(img, mask, donor_box=(640, 860, 150, 450)):
    """大块区域的填充：图像修补（inpaint）在几十像素的洞里会拖出亮色十字，这里改成
    1. 金字塔推拉（push-pull）：逐级缩小求有效像素的平均色，再逐级放大填回洞里，得到平滑的周边色；
    2. 叠一层细节：从设计稿左下角纯林地（150–450, 640–860）取高频纹理，平铺到洞里，幅度 0.8。"""
    valid = (mask == 0).astype(np.float32)
    col = img.astype(np.float32) * valid[..., None]
    levels = []
    c, w = col, valid
    while min(c.shape[:2]) > 4:
        levels.append((c, w))
        c = cv2.resize(c, (max(1, c.shape[1] // 2), max(1, c.shape[0] // 2)), interpolation=cv2.INTER_AREA)
        w = cv2.resize(w, (max(1, w.shape[1] // 2), max(1, w.shape[0] // 2)), interpolation=cv2.INTER_AREA)
    fill = c / np.maximum(w, 1e-4)[..., None]
    for c, w in reversed(levels):
        up = cv2.resize(fill, (c.shape[1], c.shape[0]), interpolation=cv2.INTER_LINEAR)
        here = c / np.maximum(w, 1e-4)[..., None]
        k = np.clip(w * 4, 0, 1)[..., None]  # 有效像素多的地方用本级颜色，洞里用上一级放大的颜色
        fill = here * k + up * (1 - k)
    y0, y1, x0, x1 = donor_box
    donor = img[y0:y1, x0:x1].astype(np.float32)
    detail = donor - cv2.GaussianBlur(donor, (0, 0), 6)
    reps = (img.shape[0] // detail.shape[0] + 1, img.shape[1] // detail.shape[1] + 1, 1)
    tile = np.tile(detail, reps)[: img.shape[0], : img.shape[1]]
    filled = np.clip(fill + tile * 0.8, 0, 255)
    soft = cv2.GaussianBlur(mask.astype(np.float32) / 255, (0, 0), 3)[..., None]  # 洞的边缘柔和过渡
    return (img.astype(np.float32) * (1 - soft) + filled * soft).astype(np.uint8)


def design_ground(clean):
    """模型版的地表 / 坑底贴图：在擦掉卡车的图上再擦掉高出地面的设备，放大 2 倍、四周加渐变边"""
    mask = np.zeros(clean.shape[:2], np.uint8)
    for x0, y0, x1, y1 in TALL_BOXES:
        mask[y0:y1, x0:x1] = 255
    img = fill_holes(clean, mask)
    T = GROUND_TEX
    big = cv2.resize(img, None, fx=T["scale"], fy=T["scale"], interpolation=cv2.INTER_LANCZOS4)
    h, w = big.shape[:2]
    px, py = T["pad_x"], T["pad_y"]
    canvas = cv2.copyMakeBorder(big, py, T["h"] - h - py, px, T["w"] - w - px, cv2.BORDER_REFLECT)
    canvas = cv2.GaussianBlur(canvas, (0, 0), 1.0)
    # 暗色地面：设计稿外圈地面的中位色
    ring = np.concatenate([img[:40].reshape(-1, 3), img[-40:].reshape(-1, 3), img[:, :40].reshape(-1, 3), img[:, -40:].reshape(-1, 3)])
    dark = np.median(ring, axis=0)
    yy, xx = np.mgrid[0 : T["h"], 0 : T["w"]]
    d = np.maximum.reduce([px - xx, xx - (px + w - 1), py - yy, yy - (py + h - 1), np.zeros_like(xx)]).astype(np.float32)
    k = np.clip(d / 220.0, 0, 1)[..., None]  # 出了设计稿 220 px（110 设计稿像素）就完全是暗色
    out = canvas * (1 - k) + dark[None, None] * k
    OUT_GROUND.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(OUT_GROUND), out.astype(np.uint8))
    print("写出", OUT_GROUND, "暗色地面 BGR", dark.round(1).tolist())
    return dark


# 台阶贴图要擦掉的：坑里的 7 台电铲和坑沿的破碎站（模型里有三维的，画上的会和模型叠成两台）
PIT_BOXES = [
    (725, 205, 805, 260), (595, 315, 675, 370), (1005, 280, 1070, 330), (720, 390, 790, 450),
    (910, 430, 980, 485), (520, 495, 605, 550), (635, 550, 700, 600), (815, 560, 965, 645),
]


def design_pit(clean):
    """台阶 / 排土场的投影贴图（第 19 轮，用户选「台阶投影设计稿」）：擦掉卡车的图上再擦掉电铲和破碎站，
    洞里填坑壁岩石（推拉平均色 + 东帮岩壁 (440–520, 1140–1240) 的高频纹理），布局同 GROUND_TEX，Blender 里共用 design_uv"""
    mask = np.zeros(clean.shape[:2], np.uint8)
    for x0, y0, x1, y1 in PIT_BOXES:
        mask[y0:y1, x0:x1] = 255
    img = fill_holes(clean, mask, donor_box=(440, 520, 1140, 1240))
    T = GROUND_TEX
    big = cv2.resize(img, None, fx=T["scale"], fy=T["scale"], interpolation=cv2.INTER_LANCZOS4)
    h, w = big.shape[:2]
    px, py = T["pad_x"], T["pad_y"]
    canvas = cv2.copyMakeBorder(big, py, T["h"] - h - py, px, T["w"] - w - px, cv2.BORDER_REFLECT)
    cv2.imwrite(str(OUT_PIT), canvas)
    print("写出", OUT_PIT)


def main():
    im = cv2.imread(str(SRC))
    assert im is not None and im.shape[:2] == (H, W), "找不到设计稿场景图 scene-a1.png（docs 只在本地）"
    clean = erase_trucks(im)
    dark = design_ground(clean)
    design_pit(clean)

    # 底图：放大 2 倍（Lanczos + 轻微锐化），存 webp
    big = cv2.resize(clean, None, fx=UPSCALE, fy=UPSCALE, interpolation=cv2.INTER_LANCZOS4)
    blur = cv2.GaussianBlur(big, (0, 0), 1.2)
    big = cv2.addWeighted(big, 1.35, blur, -0.35, 0)
    OUT_IMG.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(big[..., ::-1]).save(OUT_IMG, quality=80, method=6)
    print("写出", OUT_IMG, f"{OUT_IMG.stat().st_size / 1024:.0f} KB")

    # 给 Blender 建模（scripts/blender/open_pit）用的设计稿轮廓：坑沿环 / 坑底环 / 锚点，都是场景图像素
    OUT_OUTLINE.parent.mkdir(parents=True, exist_ok=True)
    OUT_OUTLINE.write_text(
        json.dumps(
            {
                "image": [W, H],
                "rim": RIM,
                "floor": FLOOR,
                "anchors": {k: list(v) for k, v in ANCHORS.items()},
                "heat": list(HEAT),
                "groundTex": {**GROUND_TEX, "dark_rgb": [round(float(v) / 255, 4) for v in dark[::-1]]},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    routes = build_routes()
    r1 = lambda a: [[round(float(x), 1), round(float(y), 1)] for x, y in a]
    data = {
        "image": {"w": W, "h": H, "upscale": UPSCALE, "stage": STAGE},
        "anchors": {k: list(v) for k, v in ANCHORS.items()},
        "heat": list(HEAT),
        "faultSpot": {k: list(v) for k, v in FAULT_SPOT.items()},
        "routes": {k: r1(v) for k, v in routes.items()},
        "belt": r1(build_belt()),
        "swap": {"SW-01": [395, 655], "SW-02": [685, 675]},
    }
    OUT_JSON.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("写出", OUT_JSON, f"{OUT_JSON.stat().st_size / 1024:.0f} KB", {k: f"{len(v)} 点" for k, v in routes.items()})

    if "--check" in sys.argv:
        out = Path(sys.argv[sys.argv.index("--check") + 1])
        vis = clean.copy()
        cols = [(0, 255, 255), (0, 255, 0), (255, 0, 255), (0, 128, 255), (255, 255, 0), (255, 128, 0), (128, 255, 128)]
        for i, (k, p) in enumerate(routes.items()):
            cv2.polylines(vis, [np.array(p, np.int32)], False, cols[i % 7], 1)
            cv2.putText(vis, k, tuple(int(v) for v in p[0]), cv2.FONT_HERSHEY_SIMPLEX, 0.45, cols[i % 7], 1)
        cv2.polylines(vis, [np.array(build_belt(), np.int32)], False, (255, 255, 255), 2)
        for k, (x, y) in ANCHORS.items():
            cv2.circle(vis, (x, y), 3, (0, 0, 255), -1)
        cv2.imwrite(str(out), vis)
        print("核对图", out)


if __name__ == "__main__":
    main()

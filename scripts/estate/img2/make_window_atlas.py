#!/usr/bin/env python3
"""
/estate Blender 楼栋：窗格贴图集（自发光贴图）
----------------------------------------------------------
设计稿里每个窗格是"深色凹框里一块橙黄亮芯"：亮芯里是窗帘（竖向褶皱）、家具和灯的细碎明暗，有的窗格中间一道窗框分成两扇，
洋房的窗格下沿还有一条阳台栏板的暗带。Blender 里每块窗玻璃是一个四边形，UV 指向这张图集里的一格——
这样窗里的细节是真实贴图，不是着色器里随机出来的色块，也能被 glTF 原样导出。

图集 512 × 512，8 × 8 = 64 格，每格 64 × 64（窗格宽高比约 1 : 1.1，贴上去会略拉伸）。
格的编号规则（restored.py 按这个选格）：
    0–31   亮窗（亮度 0.75–1.0，奶白 / 橙黄 / 金黄三种色调，一半带中间窗框，四分之一带底部暗带）
    32–47  半亮窗（亮度 0.5–0.68，拉了窗帘 / 灯没全开）
    48–63  暗窗（亮度 0.28–0.4，深暖灰，不是纯黑——设计稿里最暗的窗格也有 (94,77,63)）
颜色取自设计稿窗格的实测分位（塔楼 B01：最亮 10 % ≈ (240,217,183)，亮 10–30 % ≈ (203,165,123)，暗部 ≈ (94,77,63)）。
输出 models/estate/window_atlas.png（sRGB）。

用法：python3 scripts/estate/img2/make_window_atlas.py
"""
import os
import random

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "models", "estate", "window_atlas.png")
OUT_TER = os.path.join(ROOT, "models", "estate", "window_atlas_terrace.png")  # 洋房用：暖褐凹槽 + 浅色阳台栏板
OUT_CLUB = os.path.join(ROOT, "models", "estate", "window_atlas_club.png")  # 会所：整面金黄大玻璃（下层高窗 / 上层矮窗带）
OUT_DARK = os.path.join(ROOT, "models", "estate", "window_atlas_dark.png")  # 洋房 / 联排用：窗框更暗（设计稿里洋房的凹框几乎是黑褐色，整栋 p5 ≈ 35）
T = 64  # 每格像素
N = 8  # 每行每列格数

# 三种色调：亮芯顶部色、底部色（0–255）
TINTS = [
    ((255, 236, 200), (232, 176, 112)),  # 奶白偏暖
    ((255, 218, 160), (226, 150, 78)),  # 橙黄
    ((255, 206, 128), (220, 138, 60)),  # 金黄
]
FRAME_LIGHT = np.array([26, 21, 17], float)
FRAME_DARK = np.array([10, 8, 6], float)
FRAME = FRAME_LIGHT  # 深色窗框（设计稿里最暗的窗格也有 (94,77,63) 的暖灰，不是黑的）


def tile(rng, bright, tint, split, sill, core_w, core_h):
    """生成一格：返回 (T, T, 3) float 0–255"""
    img = np.empty((T, T, 3), float)
    img[:] = FRAME
    x0 = int(round((1 - core_w) / 2 * T))
    x1 = T - x0
    y0 = int(round((1 - core_h) / 2 * T))
    y1 = T - y0
    top, bot = np.array(TINTS[tint][0], float), np.array(TINTS[tint][1], float)
    h = y1 - y0
    w = x1 - x0
    # 竖向渐变：上亮下暗
    g = np.linspace(0, 1, h)[:, None, None]
    core = top * (1 - g) + bot * g
    core = np.broadcast_to(core, (h, w, 3)).copy()
    # 窗帘褶皱：竖向条纹（2–4 个周期，随机相位）
    xs = np.arange(w)[None, :, None]
    folds = 1.0 + 0.16 * np.sin(xs / w * 2 * np.pi * rng.uniform(2.0, 4.5) + rng.uniform(0, 6.28))
    folds = folds + 0.07 * np.sin(xs / w * 2 * np.pi * rng.uniform(7, 11) + rng.uniform(0, 6.28))
    core *= folds
    # 家具 / 灯：几块随机的亮或暗的小矩形
    for _ in range(rng.randint(2, 4)):
        bw, bh = rng.randint(4, max(5, w // 2)), rng.randint(3, max(4, h // 3))
        bx, by = rng.randint(0, max(0, w - bw)), rng.randint(0, max(0, h - bh))
        f = rng.choice([0.55, 0.7, 1.25, 1.4])
        core[by : by + bh, bx : bx + bw] *= f
    # 中间一道窗框，两扇亮度不同
    if split:
        mx = w // 2
        left = rng.uniform(0.5, 1.0)
        right = rng.uniform(0.5, 1.0)
        core[:, :mx] *= left
        core[:, mx:] *= right
        core[:, max(0, mx - 1) : mx + 1] = FRAME
    img[y0:y1, x0:x1] = core * bright + FRAME * (1 - bright) * 0.35
    # 底部暗带：阳台栏板的阴影
    if sill:
        sh = int(T * sill)
        img[T - sh :, :] = img[T - sh :, :] * 0.28 + FRAME * 0.72
    # 轻微的像素噪声，避免放大后一整块平
    img += np.array([rng.gauss(0, 3) for _ in range(T * T)]).reshape(T, T)[:, :, None]
    return np.clip(img, 0, 255)


TER_FRAME = np.array([34, 24, 16], float)  # 自发光 ×1.8 后约 (61,43,29)  # 洋房凹槽：暖褐
TER_BAND = np.array([150, 132, 108], float)  # 洋房阳台栏板：浅米色
RES_FRAME = np.array([30, 28, 27], float)  # 洋房 / 联排的凹槽：深炭灰（设计稿 (55,50,48) 附近），不是黑


def warm_pane(rng, w, h, bright):
    """一块暖色窗芯：上亮下暗渐变 + 窗帘竖褶 + 一两块家具明暗；w × h 像素"""
    tint = rng.randrange(3)
    top, bot = np.array(TINTS[tint][0], float), np.array(TINTS[tint][1], float)
    g = np.linspace(0, 1, h)[:, None, None]
    pane = top * (1 - g) + bot * g
    pane = np.broadcast_to(pane, (h, w, 3)).copy()
    xs = np.arange(w)[None, :, None]
    pane *= 1.0 + 0.14 * np.sin(xs / max(w, 1) * 2 * np.pi * rng.uniform(1.5, 3.5) + rng.uniform(0, 6.28))
    for _ in range(rng.randint(0, 2)):
        bw, bh = rng.randint(2, max(3, w // 2)), rng.randint(2, max(3, h // 2))
        bx, by = rng.randint(0, max(0, w - bw)), rng.randint(0, max(0, h - bh))
        pane[by : by + bh, bx : bx + bw] *= rng.choice([0.6, 1.25])
    return pane * bright


def res_tile(rng, kind, bright, style="villa"):
    """洋房 / 联排的一格：kind = pair（两扇小窗）/ full（整块亮）/ single（一扇）/ dark"""
    img = np.empty((T, T, 3), float)
    if style == "terrace":
        # 洋房：暖褐凹槽（上深下浅）+ 底部一条浅色阳台栏板（设计稿里每格窗下一条浅米色的带）
        img[:] = TER_FRAME
        g = np.linspace(0.8, 1.15, T)[:, None, None]
        img *= g
        img[int(T * 0.68) : int(T * 0.9), int(T * 0.06) : int(T * 0.94)] = TER_BAND
    else:
        img[:] = RES_FRAME
        # 下半部分的栏板 / 百叶：一排细横线，比凹槽略亮
        for y in range(int(T * 0.64), int(T * 0.92), 4):
            img[y : y + 1, int(T * 0.08) : int(T * 0.92)] = RES_FRAME * 1.45
    if kind == "pair":
        for cx in (0.33, 0.67):
            w, h = int(T * 0.27), int(T * 0.44)
            x0, y0 = int(T * cx - w / 2), int(T * 0.16)
            img[y0 : y0 + h, x0 : x0 + w] = warm_pane(rng, w, h, bright)
    elif kind == "single":
        w, h = int(T * 0.28), int(T * 0.42)
        x0, y0 = int(T * 0.5 - w / 2), int(T * 0.18)
        img[y0 : y0 + h, x0 : x0 + w] = warm_pane(rng, w, h, bright)
    elif kind == "full":
        w, h = int(T * 0.74), int(T * 0.5)
        x0, y0 = int(T * 0.13), int(T * 0.14)
        pane = warm_pane(rng, w, h, bright)
        mx = w // 2
        pane[:, mx - 1 : mx + 1] = RES_FRAME  # 中间一道窗框
        img[y0 : y0 + h, x0 : x0 + w] = pane
    else:  # dark：只有一点暖色反光
        w, h = int(T * 0.26), int(T * 0.38)
        x0, y0 = int(T * 0.5 - w / 2), int(T * 0.2)
        img[y0 : y0 + h, x0 : x0 + w] = RES_FRAME * 1.5 + np.array([14, 8, 3])
    img += np.array([rng.gauss(0, 2.5) for _ in range(T * T)]).reshape(T, T)[:, :, None]
    return np.clip(img, 0, 255)


def make_res(path, seed, style="villa"):
    rng = random.Random(seed)
    atlas = np.zeros((N * T, N * T, 3), float)
    for i in range(N * N):
        if i < 32:  # 亮：pair 55 % / full 25 % / single 20 %
            x = (i % 32) / 32
            kind = "pair" if x < 0.55 else "full" if x < 0.8 else "single"
            bright = rng.uniform(0.72, 0.92)
        elif i < 48:  # 半亮
            kind = rng.choice(["pair", "single", "full"])
            bright = rng.uniform(0.45, 0.62)
        else:
            kind = "dark"
            bright = 1.0
        r, c = divmod(i, N)
        atlas[r * T : (r + 1) * T, c * T : (c + 1) * T] = res_tile(rng, kind, bright, style)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(atlas.astype(np.uint8)).save(path)
    print("saved", path, atlas.shape)


def club_lower(rng):
    """会所下层高窗的一格：金黄玻璃，上亮下暗，细密的竖向窗帘褶皱，底部几块家具暗影。
    整张贴图走 ×1.8 自发光，所以数值取目标亮度 / 1.8（设计稿下层玻璃约 (230,180,110)）。"""
    top = np.array([185, 146, 90], float) * rng.uniform(0.95, 1.05)
    bot = np.array([138, 96, 56], float) * rng.uniform(0.95, 1.05)
    g = np.linspace(0, 1, T)[:, None, None]
    img = np.broadcast_to(top * (1 - g) + bot * g, (T, T, 3)).copy()
    xs = np.arange(T)[None, :, None]
    # 窗帘褶皱：4–6 个周期的竖条，叠一层高频细纹
    img *= 1.0 + 0.1 * np.sin(xs / T * 2 * np.pi * rng.uniform(4.0, 6.0) + rng.uniform(0, 6.28))
    img *= 1.0 + 0.05 * np.sin(xs / T * 2 * np.pi * rng.uniform(11, 15) + rng.uniform(0, 6.28))
    for _ in range(rng.randint(0, 1)):  # 窗帘缝：一道细亮缝
        x = rng.randint(4, T - 6)
        img[:, x : x + 2] *= 1.2
    for _ in range(rng.randint(1, 3)):  # 家具 / 人影：底部暗块
        bw, bh = rng.randint(5, 12), rng.randint(8, 18)
        bx = rng.randint(0, T - bw)
        img[T - bh :, bx : bx + bw] *= rng.uniform(0.45, 0.7)
    img += np.array([rng.gauss(0, 2.5) for _ in range(T * T)]).reshape(T, T)[:, :, None]
    return np.clip(img, 0, 255)


def club_upper(rng):
    """会所上层矮窗带的一格：上半 3 扇亮小窗（深色窗梃隔开），下半是偏暗的棕色"""
    img = np.empty((T, T, 3), float)
    img[:] = np.array([78, 52, 30], float)
    y0, y1 = int(T * 0.12), int(T * 0.7)
    for k in range(3):
        x0 = int(T * (0.05 + k * 0.32))
        x1 = int(T * (0.05 + k * 0.32 + 0.27))
        top = np.array([150, 118, 70], float) * rng.uniform(0.85, 1.1)
        bot = np.array([120, 84, 46], float) * rng.uniform(0.85, 1.1)
        g = np.linspace(0, 1, y1 - y0)[:, None, None]
        pane = np.broadcast_to(top * (1 - g) + bot * g, (y1 - y0, x1 - x0, 3)).copy()
        xs = np.arange(x1 - x0)[None, :, None]
        pane *= 1.0 + 0.16 * np.sin(xs / max(1, x1 - x0) * 2 * np.pi * rng.uniform(1.5, 3) + rng.uniform(0, 6.28))
        img[y0:y1, x0:x1] = pane
    # 下半：偏暗的暖棕，一条更亮的横带（窗内的吊灯 / 天花）
    img[int(T * 0.76) : int(T * 0.94), :] = np.array([104, 70, 40], float) * rng.uniform(0.9, 1.15)
    img += np.array([rng.gauss(0, 2.5) for _ in range(T * T)]).reshape(T, T)[:, :, None]
    return np.clip(img, 0, 255)


def make_club(path, seed):
    rng = random.Random(seed)
    atlas = np.zeros((N * T, N * T, 3), float)
    for i in range(N * N):
        t = club_lower(rng) if i < 32 else club_upper(rng)
        r, c = divmod(i, N)
        atlas[r * T : (r + 1) * T, c * T : (c + 1) * T] = t
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(atlas.astype(np.uint8)).save(path)
    print("saved", path, atlas.shape)


def make(path, frame, seed, core=(0.62, 0.8)):
    global FRAME
    FRAME = frame
    rng = random.Random(seed)
    atlas = np.zeros((N * T, N * T, 3), float)
    for i in range(N * N):
        if i < 32:
            kind = "lit"
        elif i < 48:
            kind = "mid"
        else:
            kind = "dark"
        if kind == "lit":
            bright = rng.uniform(0.62, 0.86)
        elif kind == "mid":
            bright = rng.uniform(0.4, 0.56)
        else:
            bright = rng.uniform(0.16, 0.26)
        t = tile(
            rng,
            bright,
            rng.randrange(3),
            split=(i % 2 == 0),
            sill=(0.26 if i % 4 < 1 else 0.0),
            core_w=rng.uniform(*core),
            core_h=rng.uniform(*core),
        )
        r, c = divmod(i, N)
        atlas[r * T : (r + 1) * T, c * T : (c + 1) * T] = t
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(atlas.astype(np.uint8)).save(path)
    print("saved", path, atlas.shape)


def main():
    make(OUT, FRAME_LIGHT, 2610)
    make_club(OUT_CLUB, 2613)
    make_res(OUT_TER, 2612, "terrace")
    make_res(OUT_DARK, 2611)  # 洋房 / 联排：深炭灰凹槽里两扇小窗 / 整块亮 / 单窗


if __name__ == "__main__":
    main()

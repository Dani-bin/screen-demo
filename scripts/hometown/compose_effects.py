"""老家沙盘 · 效果图后期合成（把 Blender 透明背景渲染合成为成片）。

用法：python3 scripts/hometown/compose_effects.py <全景.png> <近景.png> [<夜景全景.png>]
输出：docs/design/hometown/05-effect-overview.png、06-effect-my-house.png（、07-effect-night.png）

全景：傍晚暖色天空 + 雾中远山 + 沙盘下方软阴影 + 移轴模糊（上下虚、中间实，微缩模型感）+ 发光路线泛光
近景：蓝→桃色傍晚天空 + 暗角 + 灯笼 / 亮部泛光
"""

import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "docs", "design", "hometown")


def load(path):
    a = np.asarray(Image.open(path).convert("RGBA")).astype(np.float32) / 255
    return a[..., :3], a[..., 3:4]


def gradient(h, w, stops):
    y = np.linspace(0, 1, h)
    col = np.stack([np.interp(y, [s for s, _ in stops],
                              [c[i] / 255 for _, c in stops])
                    for i in range(3)], -1)
    return np.repeat(col[:, None, :], w, 1)


def glow(h, w, cx, cy, r, color, k):
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.hypot((xx - cx * w) / w, (yy - cy * h) / w)
    g = np.clip(1 - d / r, 0, 1) ** 2 * k
    return g[..., None], np.array(color, np.float32) / 255


def hills(h, w, seed, base_y, amp, color, blur, freq):
    """一层远山剪影：几组正弦叠加的山脊线，下方填色，整体高斯模糊。"""
    rng = np.random.default_rng(seed)
    x = np.linspace(0, 1, w)
    ridge = np.full(w, base_y)
    for f in freq:
        ridge -= amp * rng.uniform(0.4, 1.0) * np.sin(
            2 * np.pi * (x * f + rng.uniform(0, 1)))
    yy = np.arange(h)[:, None] / h
    mask = (yy > ridge[None, :]).astype(np.float32)
    mask = ndimage.gaussian_filter(mask, blur)
    return mask[..., None], np.array(color, np.float32) / 255


def over(dst, src, a):
    return dst * (1 - a) + src * a


def bloom(img, thresh=0.82, sigma=14, k=0.35):
    lum = img.mean(-1, keepdims=True)
    hi = np.clip(lum - thresh, 0, 1) / (1 - thresh) * img
    b = np.stack([ndimage.gaussian_filter(hi[..., i], sigma)
                  for i in range(3)], -1)
    return np.clip(img + b * k, 0, 1)


def vignette(img, k=0.28):
    h, w = img.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.hypot((xx - w / 2) / (w / 2), (yy - h / 2) / (h / 2))
    return img * (1 - k * np.clip(d - 0.55, 0, 1)[..., None] ** 1.5)


def tilt_shift(img, focus=0.42, band=0.2, max_sigma=4.5):
    """按行渐变模糊：focus 附近 band 范围内清晰，往上 / 往下越来越虚。"""
    h = img.shape[0]
    y = np.arange(h) / h
    t = np.clip((np.abs(y - focus) - band / 2) / (0.5 - band / 2), 0, 1)
    sig = t ** 1.4 * max_sigma
    levels = [0, 1, 2, 3, max_sigma]
    blurred = [img] + [np.stack([ndimage.gaussian_filter(img[..., c], s)
                                 for c in range(3)], -1)
                       for s in levels[1:]]
    out = np.zeros_like(img)
    for row in range(h):
        s = sig[row]
        i = np.searchsorted(levels, s) if s > 0 else 0
        if i == 0:
            out[row] = img[row]
            continue
        s0, s1 = levels[i - 1], levels[i]
        f = (s - s0) / (s1 - s0)
        out[row] = blurred[i - 1][row] * (1 - f) + blurred[i][row] * f
    return out


def grade(img, warm=0.04):
    """轻微暖色分离：暗部略冷、亮部略暖，饱和度稍降（回忆感）。"""
    lum = img.mean(-1, keepdims=True)
    img = img + (lum - 0.5) * np.array([warm, warm * 0.3, -warm])
    img = lum + (img - lum) * 0.92
    return np.clip(img, 0, 1)


def overview(path):
    rgb, a = load(path)
    h, w = a.shape[:2]
    bg = gradient(h, w, [(0, (92, 104, 122)), (0.3, (150, 140, 136)),
                         (0.5, (214, 176, 140)), (0.62, (226, 190, 152)),
                         (0.8, (176, 168, 166)), (1, (126, 128, 136))])
    g, c = glow(h, w, 0.08, 0.34, 0.55, (255, 205, 140), 0.85)
    bg = over(bg, c, g)
    for seed, by, amp, col, bl, fr in (
            (1, 0.46, 0.05, (150, 140, 146), 3, (1.3, 3.1, 7.0)),
            (2, 0.53, 0.045, (128, 126, 134), 2, (1.7, 4.3, 9.0)),
            (3, 0.6, 0.04, (112, 114, 124), 1.5, (2.1, 5.2, 11.0))):
        m, cc = hills(h, w, seed, by, amp, col, bl, fr)
        bg = over(bg, cc, m * 0.75)
    # 雾带：远山脚下和画面底部
    yy = np.arange(h)[:, None, None] / h
    fog = np.clip(1 - np.abs(yy - 0.72) / 0.2, 0, 1) ** 1.5 * 0.55
    bg = over(bg, np.array([228, 214, 200], np.float32) / 255, fog)
    # 沙盘下方的软阴影
    sh = ndimage.gaussian_filter(np.roll(a[..., 0], int(h * 0.03), 0), 28)
    bg = bg * (1 - 0.35 * sh[..., None])
    img = over(bg, rgb, a)
    img = bloom(img, 0.8, 10, 0.45)
    img = tilt_shift(img, focus=0.4, band=0.28, max_sigma=3.5)
    img = vignette(grade(img), 0.32)
    Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(
        os.path.join(OUT, "05-effect-overview.png"))


def home(path):
    rgb, a = load(path)
    h, w = a.shape[:2]
    bg = gradient(h, w, [(0, (108, 142, 186)), (0.35, (168, 182, 200)),
                         (0.6, (232, 196, 160)), (1, (240, 184, 140))])
    g, c = glow(h, w, 0.0, 0.55, 0.6, (255, 214, 160), 0.6)
    bg = over(bg, c, g)
    for seed, by, amp, col, bl, fr in (
            (5, 0.6, 0.06, (120, 140, 120), 3, (1.1, 2.7, 6.0)),):
        m, cc = hills(h, w, seed, by, amp, col, bl, fr)
        bg = over(bg, cc, m * 0.6)
    img = over(bg, rgb, a)
    img = bloom(img, 0.85, 12, 0.3)
    img = vignette(grade(img, 0.03), 0.38)
    Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(
        os.path.join(OUT, "06-effect-my-house.png"))


def night(path):
    """夜景全景：深蓝夜空 + 稀疏星点 + 暗色远山 + 地平线一抹余光 + 强泛光（窗灯 / 路线）。"""
    rgb, a = load(path)
    h, w = a.shape[:2]
    bg = gradient(h, w, [(0, (8, 14, 32)), (0.45, (18, 30, 58)),
                         (0.62, (40, 48, 72)), (0.8, (22, 28, 46)),
                         (1, (12, 16, 28))])
    g, c = glow(h, w, 0.12, 0.6, 0.5, (120, 96, 110), 0.35)
    bg = over(bg, c, g)
    rng = np.random.default_rng(7)
    n = 420
    ys = rng.integers(0, int(h * 0.5), n)
    xs = rng.integers(0, w, n)
    star = np.zeros((h, w), np.float32)
    star[ys, xs] = rng.uniform(0.3, 1.0, n)
    star = ndimage.gaussian_filter(star, 0.7) * 2.2
    bg = np.clip(bg + star[..., None] * np.array([0.9, 0.95, 1.0]), 0, 1)
    for seed, by, amp, col, bl, fr in (
            (1, 0.5, 0.05, (20, 26, 44), 3, (1.3, 3.1, 7.0)),
            (2, 0.57, 0.045, (14, 19, 34), 2, (1.7, 4.3, 9.0))):
        m, cc = hills(h, w, seed, by, amp, col, bl, fr)
        bg = over(bg, cc, m * 0.9)
    sh = ndimage.gaussian_filter(np.roll(a[..., 0], int(h * 0.03), 0), 28)
    bg = bg * (1 - 0.4 * sh[..., None])
    img = over(bg, rgb, a)
    img = bloom(img, 0.55, 9, 0.9)
    img = bloom(img, 0.7, 26, 0.5)
    img = tilt_shift(img, focus=0.4, band=0.28, max_sigma=3.0)
    img = vignette(img, 0.4)
    Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(
        os.path.join(OUT, "07-effect-night.png"))


if __name__ == "__main__":
    # 用法：compose_effects.py <全景> <近景> [<夜景全景>]
    overview(sys.argv[1])
    home(sys.argv[2])
    if len(sys.argv) > 3:
        night(sys.argv[3])
    print("写出 05-effect-overview.png、06-effect-my-house.png",
          "、07-effect-night.png" if len(sys.argv) > 3 else "")

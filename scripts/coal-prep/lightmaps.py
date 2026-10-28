"""
光照图后处理：models/coal-prep/bake/lm_*.png → public/coal-prep/lm_*.webp
----------------------------------------------------------
Blender 烘焙出的光照图（已编码为 sqrt(irradiance / 4)）先做中值滤波去萤火虫噪点，再轻微模糊，
再把颜色往中性灰拉一半（烘焙用的是橙色夕阳、暖色灯和橙色地平线，原样用钢结构会整片偏粉橙，
第 5、7 轮评审：钢材应是中性偏冷的灰，暖色只留在灯具附近——只有最亮的灯池核心保留原色），
然后存成 WebP 给页面用。需要 Pillow、numpy。
    python3 scripts/coal-prep/lightmaps.py
"""

import glob
import os

import numpy as np
from PIL import Image, ImageFilter

DESAT = 0.8  # 去饱和的比例（第 7、9 轮评审：钢构仍偏粉米色、整体偏棕，0.55 → 0.65 → 0.8）
COOL = np.array([0.95, 1.0, 1.07])  # 去饱和后略偏冷

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "models", "coal-prep", "bake")
DST = os.path.join(ROOT, "public", "coal-prep")

for path in sorted(glob.glob(os.path.join(SRC, "lm_*.png"))):
    im = Image.open(path).convert("RGB")
    im = im.filter(ImageFilter.MedianFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    a = np.asarray(im).astype(np.float32) / 255
    lum = (a @ np.array([0.299, 0.587, 0.114], np.float32))[..., None]
    # 只有最亮的灯池核心（编码值 0.75 以上）逐渐保留原色
    k = DESAT * (1 - np.clip((lum - 0.75) / 0.2, 0, 1))
    a = a * (1 - k) + lum * COOL * k
    im = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))
    out = os.path.join(DST, os.path.basename(path).replace(".png", ".webp"))
    im.save(out, quality=90, method=6)
    print(out, im.size, round(os.path.getsize(out) / 1024), "KB")

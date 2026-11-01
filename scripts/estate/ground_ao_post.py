#!/usr/bin/env python3
"""
地面 AO 后处理：models/estate/ground_ao_raw.png（Blender 烘出的线性天空可见度）→ public/estate/ground_ao.webp
----------------------------------------------------------
页面把它用 multiply 乘到地面画布上（画布是 sRGB 编码的，所以先把线性系数换成 sRGB 再存）。
强度 K：1 − K·(1 − 可见度)，K 小一点别把楼脚下压成死黑；最亮处归一到 1。

用法：python3 scripts/estate/ground_ao_post.py [强度 K，默认 0.8]
"""
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
K = float(sys.argv[1]) if len(sys.argv) > 1 else 0.8

im = Image.open(os.path.join(ROOT, "models", "estate", "ground_ao_raw.png"))
a = np.asarray(im, dtype=np.float64)
a = a[..., 0] / (65535.0 if a.max() > 255 else 255.0)  # 取红通道（灰度）
a = a / max(np.percentile(a, 99.5), 1e-6)  # 空地归一到 1
a = np.clip(a, 0, 1)
f = 1.0 - K * (1.0 - a)
f = f ** (1 / 2.2)  # 线性 → sRGB，页面里按 sRGB 相乘
out = Image.fromarray((np.clip(f, 0, 1) * 255 + 0.5).astype(np.uint8), "L")
dst = os.path.join(ROOT, "public", "estate", "ground_ao.webp")
out.save(dst, quality=88)
print("写入", os.path.relpath(dst, ROOT), out.size, "最暗", round(float(f.min()), 3))

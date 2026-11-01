#!/usr/bin/env python3
"""
照片模式后处理：models/estate/render/photo/*.png → public/estate/photo/*.webp（遮罩保持 PNG，颜色必须精确）
----------------------------------------------------------
manifest.json 由 `run_cli.py -- photo` 写到 public/estate/photo/。只转新的或更新过的图；转完打印总大小。
用法：python3 scripts/estate/photo_post.py [WebP 质量，默认 86]
"""
import os
import shutil
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "models", "estate", "render", "photo")
DST = os.path.join(ROOT, "public", "estate", "photo")
Q = int(sys.argv[1]) if len(sys.argv) > 1 else 86
os.makedirs(DST, exist_ok=True)
total = 0
n = 0
for f in sorted(os.listdir(SRC)):
    if not f.endswith(".png"):
        continue
    src = os.path.join(SRC, f)
    if f == "mask_home.png":
        dst = os.path.join(DST, f)
        shutil.copyfile(src, dst)
    else:
        dst = os.path.join(DST, f[:-4] + ".webp")
        if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
            total += os.path.getsize(dst)
            continue
        Image.open(src).convert("RGB").save(dst, quality=Q, method=6)
        n += 1
    total += os.path.getsize(dst)
print(f"转了 {n} 张，public/estate/photo 共 {total / 1e6:.1f} MB")

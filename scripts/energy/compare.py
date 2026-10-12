"""
设计稿 ↔ 实现 对比图生成（还原度检查工具）
----------------------------------------------------------
把实现截图与设计稿对齐后输出一张三联图：
  左：设计稿 | 中：实现 | 右：叠图（设计稿压暗打底 + 实现的边缘描成青色，对不上的地方一眼可见）
另附半透明混合图（*_blend.png），便于逐栋建筑比对位置、体量。

对齐方式：
  - 设计稿是 01-ai-overview.png（1536×864）时，实现截图按页面里的映射裁切：
    设计稿在整屏效果图 03 里放在 left 412、top 82、宽 1096（见 drafts-source.html），
    页面截图（1920×1080 设计尺寸）先缩放到 1920 宽，再裁出这一块缩放回 1536×864；
  - --raw：两张图直接按尺寸拉齐（例如 Blender 用标定相机渲染的 1536×864 预览图）。

用法：
  python3 scripts/energy/compare.py <实现截图> [--design docs/design/energy/01-ai-overview.png] [--raw] [--out <png>]
"""

import argparse
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DESIGN = os.path.join(ROOT, "docs/design/energy/01-ai-overview.png")
FONT = os.path.join(ROOT, "src/assets/fonts/SourceHanSansCN-Regular.otf")
# 设计稿 01 在 1920×1080 整屏里的位置（drafts-source.html 的 .scene）
SCENE_BOX = (412, 82, 1096, 616)


def load_impl(path, size, raw):
    img = Image.open(path).convert("RGB")
    if raw:
        return img.resize(size, Image.Resampling.LANCZOS)
    k = 1920 / img.width
    img = img.resize((1920, round(img.height * k)), Image.Resampling.LANCZOS)
    x, y, w, h = SCENE_BOX
    return img.crop((x, y, x + w, y + h)).resize(size, Image.Resampling.LANCZOS)


def edges(img):
    """亮度边缘（Sobel 近似），归一到 0..1"""
    g = np.asarray(img.convert("L").filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float32)
    gx = np.abs(np.diff(g, axis=1, prepend=g[:, :1]))
    gy = np.abs(np.diff(g, axis=0, prepend=g[:1]))
    e = np.hypot(gx, gy)
    return np.clip(e / np.percentile(e, 97), 0, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("impl")
    ap.add_argument("--design", default=DESIGN)
    ap.add_argument("--raw", action="store_true")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    design = Image.open(a.design).convert("RGB")
    impl = load_impl(a.impl, design.size, a.raw)
    out = a.out or os.path.splitext(a.impl)[0] + "_compare.png"

    # 叠图：设计稿压暗 + 实现边缘（青色）+ 设计稿边缘（品红），两者重合处偏白
    d = np.asarray(design, dtype=np.float32) / 255
    ei, ed = edges(impl), edges(design)
    ov = d * 0.35
    ov = ov + ei[..., None] * np.array([0.1, 0.95, 1.0]) * 0.9
    ov = ov + ed[..., None] * np.array([1.0, 0.2, 0.85]) * 0.55
    ov = Image.fromarray((np.clip(ov, 0, 1) * 255).astype(np.uint8))

    W, H = design.size
    sheet = Image.new("RGB", (W * 3, H + 44), (8, 12, 20))
    for i, (im, label) in enumerate(((design, "设计稿"), (impl, "实现"), (ov, "叠图：品红 = 设计稿边缘，青 = 实现边缘"))):
        sheet.paste(im, (i * W, 44))
        ImageDraw.Draw(sheet).text((i * W + 14, 8), label, font=ImageFont.truetype(FONT, 24), fill=(230, 236, 245))
    sheet.save(out)
    Image.blend(design, impl, 0.5).save(os.path.splitext(out)[0] + "_blend.png")
    print("saved", out)


if __name__ == "__main__":
    main()

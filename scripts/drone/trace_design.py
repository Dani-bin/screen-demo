"""
/drone 定稿物体轮廓的半自动描边（阶段 11 轮廓 IoU 用）
----------------------------------------------------------
compare.py 的 --annotations 需要定稿上每个物体的轮廓多边形。手描几十个多边形既慢又不准，这里半自动生成：

  1. 以页面导出的设备 ID 图（capture.mjs --id-mask）里该物体的像素做种子：
     腐蚀后的核心像素当前景颜色样本，外扩一圈的环带当背景颜色样本；
  2. 在定稿像素上、物体外接框外扩 PAD 的窗口里，按 Lab 颜色到前景 / 背景样本（各取 k-means 中心）的最近距离分类；
  3. 取和种子核心重叠最多的连通块，填洞、做一次开闭运算去毛刺，再取凸包（参与的物体外轮廓都是凸的）；
     相邻设备在实现里占的像素不当背景样本、也不让分割越过去（相邻的白罐会被当成"背景色"）；
  4. 沿边界追踪（Moore 邻域）再用 Ramer-Douglas-Peucker 简化成多边形。

边界完全来自定稿像素；实现侧只提供位置和颜色样本，所以实现明显错位时（种子落在别的东西上）结果会不可信——
每次都要看叠图 objects-check.png 逐个确认，不对的物体从 IDS 里去掉或者改成手描。

用法：python scripts/drone/trace_design.py <id-mask.png>（同名 .json 为 {"<id>": [r,g,b]}）
输出：docs/design/drone/design/objects.json（{"objects": [{"id", "polygon"}]}）+ objects-check.png
依赖：numpy、Pillow、scipy
"""

import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.cluster.vq import kmeans2
from scipy.spatial import ConvexHull

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
DESIGN = os.path.join(ROOT, "docs", "design", "drone", "design")
PAD = 10  # 搜索窗口外扩（px）

# 参与比对的物体：轮廓清楚、不被标签大面积遮挡的单体或成组设施
IDS = [
    "TK-104", "TK-105", "TK-106",  # 前排外浮顶罐（后排被前排挡住下半截，分割会粘连，不参与）
    "TK-205", "TK-206", "TK-207", "TK-208",  # 前排内浮顶罐
    "SP-101", "SP-102", "SP-103",  # 后排球罐（前排被 UAV-04 标签挡住）
    "LD-1",  # 装卸站罩棚
    "FS-1",  # 消防站
    "WH-1",  # 仓库
]
# 不参与：冷却塔 CW-1（4 座共用一个编号，一个多边形表示不了）、空分冷箱 AS-1 和污水池 WW-1（多个部件、
# 明暗复杂，分割失败）、火炬 FL-1（只有约 10 px 宽，2 px 偏差 IoU 就掉到 0.6）、各装置区（塔、框架、管线交错，
# 无法按颜色分割）、CC-1（被 4# 机场标签挡住）


def lab(rgb):
    """sRGB（0–255，N×3）→ CIE Lab（D65）"""
    c = rgb / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], 1)


def centers(samples, k):
    """颜色样本的 k-means 中心（样本少时直接用全部样本）"""
    if len(samples) <= k:
        return samples
    rng = np.random.default_rng(0)
    pick = samples[rng.choice(len(samples), min(len(samples), 4000), replace=False)]
    c, _ = kmeans2(pick, k, seed=1, minit="++")
    return c


def trace(mask):
    """二值图最大连通块的外边界（Moore 邻域追踪），返回 [(x, y)…]"""
    h, w = mask.shape
    pad = np.zeros((h + 2, w + 2), bool)
    pad[1:-1, 1:-1] = mask
    ys, xs = np.nonzero(pad)
    i = np.lexsort((xs, ys))[0]
    start = (xs[i], ys[i])
    nb = [(-1, 0), (-1, -1), (0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1)]
    pts = [start]
    cur, back = start, 0  # back：上一步来的方向索引
    for _ in range(4 * mask.size):
        for j in range(8):
            d = (back + 1 + j) % 8
            nx, ny = cur[0] + nb[d][0], cur[1] + nb[d][1]
            if pad[ny, nx]:
                back = (d + 4) % 8
                cur = (nx, ny)
                break
        if cur == start:
            break
        pts.append(cur)
    return [(x - 1, y - 1) for x, y in pts]


def convex(mask):
    """二值图的凸包（栅格化回二值图）"""
    ys, xs = np.nonzero(mask)
    pts = np.stack([xs, ys], 1).astype(float)
    hull = ConvexHull(pts)
    im = Image.new("L", (mask.shape[1], mask.shape[0]), 0)
    ImageDraw.Draw(im).polygon([tuple(pts[i]) for i in hull.vertices], fill=1)
    return np.asarray(im) > 0


def rdp(pts, eps):
    """Ramer-Douglas-Peucker 折线简化"""
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0], float), np.array(pts[-1], float)
    p = np.array(pts, float)
    ab = b - a
    n = np.hypot(*ab)
    q = p - a
    # 二维叉积（numpy 2 的 np.cross 不再支持二维向量）
    d = np.abs(ab[0] * q[:, 1] - ab[1] * q[:, 0]) / n if n > 0 else np.hypot(q[:, 0], q[:, 1])
    i = int(np.argmax(d))
    if d[i] > eps:
        return rdp(pts[: i + 1], eps)[:-1] + rdp(pts[i:], eps)
    return [pts[0], pts[-1]]


def main(id_png):
    design = np.asarray(Image.open(os.path.join(DESIGN, "final.png")).convert("RGB"), float)
    idm = np.asarray(Image.open(id_png).convert("RGB"), int)
    cmap = json.load(open(os.path.splitext(id_png)[0] + ".json", encoding="utf-8"))
    H, W = idm.shape[:2]
    objects = []
    check = Image.open(os.path.join(DESIGN, "final.png")).convert("RGB")
    dr = ImageDraw.Draw(check)
    for oid in IDS:
        col = cmap.get(oid)
        if col is None:
            print(f"跳过 {oid}：ID 图里没有")
            continue
        seed = (np.abs(idm - np.array(col)) <= 2).all(-1)
        ys, xs = np.nonzero(seed)
        x0, y0 = max(0, xs.min() - PAD), max(0, ys.min() - PAD)
        x1, y1 = min(W, xs.max() + PAD + 1), min(H, ys.max() + PAD + 1)
        s = seed[y0:y1, x0:x1]
        core = ndimage.binary_erosion(s, iterations=2)
        if core.sum() < 20:
            core = s
        # 其他设备（相邻的罐等）在实现里占的像素：既不当背景样本，也不让分割结果越过去
        other = ~(idm[y0:y1, x0:x1] == 0).all(-1) & ~s
        ring = ndimage.binary_dilation(s, iterations=6) & ~ndimage.binary_dilation(s, iterations=2) & ~other
        px = lab(design[y0:y1, x0:x1].reshape(-1, 3)).reshape(y1 - y0, x1 - x0, 3)
        fg, bg = centers(px[core], 4), centers(px[ring], 6)
        dfg = np.min(np.linalg.norm(px[..., None, :] - fg[None, None], axis=-1), -1)
        dbg = np.min(np.linalg.norm(px[..., None, :] - bg[None, None], axis=-1), -1)
        cls = (dfg < dbg) & ~ndimage.binary_erosion(other, iterations=2)
        cls = ndimage.binary_opening(cls, iterations=1)
        cls = ndimage.binary_closing(cls, iterations=2)
        lb, n = ndimage.label(cls)
        if n == 0:
            print(f"跳过 {oid}：分割为空")
            continue
        # 和种子核心重叠的连通块：最大的一块，加上自身面积一半以上落在种子里的小块（消防站旁的训练塔、球罐支腿）
        cnt = np.bincount(lb[core], minlength=n + 1)
        cnt[0] = 0
        area = np.bincount(lb.ravel(), minlength=n + 1)
        inseed = np.bincount(lb[s], minlength=n + 1)
        keep = [int(np.argmax(cnt))] + [k for k in range(1, n + 1) if inseed[k] > 0.5 * area[k] and area[k] >= 12]
        main = ndimage.binary_fill_holes(lb == keep[0])
        # 罐、球罐、方盒子建筑的主体外轮廓是凸的：主体取凸包补上背光面被分到背景的缺口，附属小块原样并入
        comp = convex(main) | np.isin(lb, keep[1:])
        # 主体和附属小块之间用一条 1 px 宽的桥连起来，保证是一个连通块、一条闭合轮廓（compare.py 每个物体只认一个多边形）
        cl, cn = ndimage.label(comp)
        if cn > 1:
            cy, cx = ndimage.center_of_mass(comp, cl, 1)
            for k in range(2, cn + 1):
                ky, kx = ndimage.center_of_mass(comp, cl, k)
                for t in np.linspace(0, 1, 200):
                    comp[int(round(cy + (ky - cy) * t)), int(round(cx + (kx - cx) * t))] = True
        # 闭合轮廓：先在离起点最远的点处断成两段，再分别简化
        loop = trace(comp)
        far = int(np.argmax([np.hypot(x - loop[0][0], y - loop[0][1]) for x, y in loop]))
        poly = rdp(loop[: far + 1], 0.8)[:-1] + rdp(loop[far:] + [loop[0]], 0.8)[:-1]
        poly = [[int(x + x0), int(y + y0)] for x, y in poly]
        objects.append({"id": oid, "polygon": poly})
        dr.polygon([tuple(p) for p in poly], outline=(255, 0, 255))
        print(f"{oid}: {len(poly)} 点，面积 {int(comp.sum())} px（实现 {int(s.sum())} px），并入 {len(keep) - 1} 个附属块")
    out = os.path.join(DESIGN, "objects.json")
    json.dump(
        {"image": [W, H], "note": "scripts/drone/trace_design.py 半自动描边（定稿像素分割，ID 图做种子），已逐个看叠图确认", "objects": objects},
        open(out, "w", encoding="utf-8"),
        ensure_ascii=False,
        indent=1,
    )
    check.save(os.path.join(DESIGN, "objects-check.png"))
    print(f"→ {out}")


if __name__ == "__main__":
    main(sys.argv[1])

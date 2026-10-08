"""
园区建模 · 沙盘、地面、道路、绿化、路灯
----------------------------------------------------------
- slab      悬浮沙盘底座：圆角矩形厚板，顶边一圈青色发光线（设计稿「切出来的一块地」）
- ground    地面合成一个对象（便于整块烘焙光照）：铺装底 → 园区草坪 → 绿地 → 楼前广场 → 人行道 → 园路 → 车行道 / 路缘石 → 水面 → 标线，逐层抬高 1～4 cm 防止共面闪烁；
            路面是中灰沥青、人行道浅灰，夜景里也要和草地、铺装拉开明度（设计稿的路一眼可辨）；
            标线：车道白虚线、路缘白实线、路口斑马线，主干道外缘青色发光线；
            第二套 UV「Lightmap」按沙盘范围平面投影，bake.py 把 Cycles 光照烘进这一套
- trees     行道树（道路两侧等距）+ 绿地 / 铺装空地里成簇种植（设计稿是一丛丛的树团，中间留出草坪），避开楼体、路面与水面；
            七种树形共享网格（导出为 GPU 实例）
- lamps     路灯：行驶道路两侧交错立灯；湖边一圈庭院灯；PREVIEW 集合里同位置放点光源，只用于 Cycles 烘焙地面光斑（不导出）
"""

import math
import random

import bmesh
import bpy
from mathutils import Vector

from . import lib

SLAB_DEPTH = 16.0
SLAB_RADIUS = 22.0

# 地面各层高度（米）
Z_PAVE = 0.0
Z_LAWN = 0.012  # 园区地块整体草坪（在人行道、道路之下）
Z_GRASS = 0.018  # OSM 绿地面：压在园路、道路之下，否则穿过绿地的步道会被盖住
Z_APRON = 0.024  # 楼前铺装广场
Z_WALK = 0.03
Z_PATH = 0.04  # 园内步道 / 服务道路（浅色园路）
Z_ROAD = 0.065
# 同一层的多条路 / 标线逐条抬高这么多（米）：交叉处不同高，烘焙时不会互相遮挡成黑块（见 _ribbon）
Z_STEP = 0.0004
Z_WATER = 0.12
Z_MARK = 0.14

# 行驶道路（会画车道线、种行道树、立路灯）
DRIVE = {"primary", "secondary", "tertiary", "residential"}
# 行驶道路两侧人行道各宽（米），与 scripts/build-park-layout.mjs 的 SIDEWALK 一致
SIDEWALK = 3.0


# ---------------------------------------------------------------- 几何工具


def rounded_rect(b, r, seg=6):
    """圆角矩形轮廓（逆时针）"""
    pts = []
    corners = (
        (b["x1"] - r, b["y0"] + r, -90),
        (b["x1"] - r, b["y1"] - r, 0),
        (b["x0"] + r, b["y1"] - r, 90),
        (b["x0"] + r, b["y0"] + r, 180),
    )
    for cx, cy, a0 in corners:
        for k in range(seg + 1):
            a = math.radians(a0 + 90 * k / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def _poly_face(bm, ring, z, mat, uv_scale):
    """水平多边形（可凹）→ 三角面，写世界尺度 UV"""
    if len(ring) < 3:
        return
    vs = [bm.verts.new((x, y, z)) for x, y in ring]
    try:
        f = bm.faces.new(vs)
    except ValueError:
        return
    f.material_index = mat
    uv = bm.loops.layers.uv.verify()
    for loop in f.loops:
        loop[uv].uv = (loop.vert.co.x / uv_scale, loop.vert.co.y / uv_scale)
    bmesh.ops.triangulate(bm, faces=[f], quad_method="BEAUTY", ngon_method="EAR_CLIP")


def _ribbon(bm, pts, width, z, mat, uv_scale=8.0, joints=True, segments=True):
    """
    折线挤成带状面：每段一个矩形，折点处补圆盘接头（同 /city 的 roads.js 做法）。
    接头先生成、并压低 3 mm：烘焙用的 Lightmap 是平面投影，重叠的面共用同一块像素、后烘的覆盖先烘的；
    接头若在路段之后生成且同高，会被同高的路段面遮挡烘成纯黑并覆盖路段（园路发黑的原因）。
    同一层有多条路时用 _ribbons：先生成全部接头、再生成全部路段，避免一条路的端头接头压在另一条路下面烘黑
    """
    uv = bm.loops.layers.uv.verify()
    h = width / 2

    def face(coords, zz):
        vs = [bm.verts.new((x, y, zz)) for x, y in coords]
        f = bm.faces.new(vs)
        f.material_index = mat
        for loop in f.loops:
            loop[uv].uv = (loop.vert.co.x / uv_scale, loop.vert.co.y / uv_scale)

    if joints:
        for x, y in pts:
            face([(x + h * math.cos(2 * math.pi * k / 10), y + h * math.sin(2 * math.pi * k / 10)) for k in range(10)], z - 0.003)
    if not segments:
        return
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        dx, dy = x2 - x1, y2 - y1
        ln = math.hypot(dx, dy)
        if ln < 1e-3:
            continue
        nx, ny = -dy / ln * h, dx / ln * h
        face(((x1 - nx, y1 - ny), (x2 - nx, y2 - ny), (x2 + nx, y2 + ny), (x1 + nx, y1 + ny)), z)


def _ribbons(bm, items, z, mat):
    """
    同一层的多条带：items 为 [(点列, 宽度)]，先生成全部接头、再生成全部路段（原因见 _ribbon）；
    第 i 条抬高 i × Z_STEP，交叉处后生成的在上面，不与先生成的同高重叠
    """
    for i, (pts, w) in enumerate(items):
        _ribbon(bm, pts, w, z + i * Z_STEP, mat, segments=False)
    for i, (pts, w) in enumerate(items):
        _ribbon(bm, pts, w, z + i * Z_STEP, mat, joints=False)


def _offset_line(pts, d):
    """折线向左偏移 d 米（d<0 向右），逐点用相邻段的平均法线"""
    out = []
    for i, (x, y) in enumerate(pts):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, len(pts) - 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(dx, dy) or 1
        out.append((x - dy / ln * d, y + dx / ln * d))
    return out


def _resample(pts, step, offset=0.0):
    """沿折线每隔 step 米取一点（跨折点连续计距），返回 [(点, 该处方向角)]"""
    res = []
    nxt = offset  # 下一个取样点距当前段起点的距离
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        ln = math.hypot(x2 - x1, y2 - y1)
        if ln < 1e-6:
            continue
        ang = math.atan2(y2 - y1, x2 - x1)
        while nxt <= ln:
            res.append(((x1 + (x2 - x1) * nxt / ln, y1 + (y2 - y1) * nxt / ln), ang))
            nxt += step
        nxt -= ln
    return res


def _dashes(pts, dash, gap):
    """虚线：返回若干短折线"""
    out = []
    total = 0.0
    period = dash + gap
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        ln = math.hypot(x2 - x1, y2 - y1)
        t = 0.0
        while t < ln:
            phase = (total + t) % period
            if phase < dash:
                end = min(ln, t + dash - phase)
                a = (x1 + (x2 - x1) * t / ln, y1 + (y2 - y1) * t / ln)
                b = (x1 + (x2 - x1) * end / ln, y1 + (y2 - y1) * end / ln)
                out.append([a, b])
                t = end
            else:
                t += period - phase
        total += ln
    return out


def _grow(ring, d):
    """轮廓沿中心方向外扩 d 米（楼前广场；楼体轮廓都是星形，不会自交）"""
    cx = sum(p[0] for p in ring) / len(ring)
    cy = sum(p[1] for p in ring) / len(ring)
    out = []
    for x, y in ring:
        r = math.hypot(x - cx, y - cy) or 1
        out.append((x + (x - cx) / r * d, y + (y - cy) / r * d))
    return out


def _in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _seg_dist(px, py, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln2 = dx * dx + dy * dy or 1
    t = max(0, min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / ln2))
    return math.hypot(a[0] + t * dx - px, a[1] + t * dy - py)


LANE_W = 3.6  # 单条车道宽（米），按路幅推算车道数


def _lane_marks(bm, r, mat, z=None):
    """
    车道标线：单行道（OSM 里双幅路的一幅）按路幅分车道，车道之间白色虚线（4 m 线 / 6 m 空）、两侧路缘内白实线；
    双向路中间一条白实线，两个方向各自分车道
    """
    w, pts = r["width"], r["points"]
    z = Z_MARK if z is None else z
    marks = []  # (偏移, 是否实线)
    if r["oneway"]:
        n = max(1, round(w / LANE_W))
        marks += [(-w / 2 + k * w / n, False) for k in range(1, n)]
    else:
        n = max(1, round(w / 2 / LANE_W))
        marks.append((0.0, True))
        for k in range(1, n):
            marks += [(k * w / 2 / n, False), (-k * w / 2 / n, False)]
    marks += [(w / 2 - 0.7, True), (-w / 2 + 0.7, True)]
    for off, solid in marks:
        line = _offset_line(pts, off) if off else pts
        if solid:
            _ribbon(bm, line, 0.22, z, mat, joints=False)
        else:
            for d in _dashes(line, 4.0, 6.0):
                _ribbon(bm, d, 0.2, z, mat, joints=False)


def _walk(pts, dist):
    """沿折线从起点走 dist 米，返回 (点, 单位方向)；折线不够长返回 None"""
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        ln = math.hypot(x2 - x1, y2 - y1)
        if ln < 1e-6:
            continue
        if dist <= ln:
            t = dist / ln
            return (x1 + (x2 - x1) * t, y1 + (y2 - y1) * t), ((x2 - x1) / ln, (y2 - y1) / ln)
        dist -= ln
    return None


def _crosswalks(roads):
    """
    路口斑马线：行驶道路的端点落在另一条行驶道路上（且两路夹角大于 35°，排除同一条路的分段接头）即为路口，
    在离路口一个「对方半幅 + 人行道」处横跨本路画一排 3 m 长、0.55 m 宽、间距 1.1 m 的白条
    """
    drive = [r for r in roads if r["kind"] in DRIVE and len(r["points"]) >= 2]
    out = []
    for r in drive:
        for pts in (r["points"], r["points"][::-1]):
            ex, ey = pts[0]
            d0 = _walk(pts, 0.0)
            if d0 is None:
                continue
            best = None
            for o in drive:
                if o is r:
                    continue
                for a, c in zip(o["points"], o["points"][1:]):
                    dist = _seg_dist(ex, ey, a, c)
                    if dist < 4.0 and (best is None or dist < best[0]):
                        ln = math.hypot(c[0] - a[0], c[1] - a[1]) or 1
                        best = (dist, o, ((c[0] - a[0]) / ln, (c[1] - a[1]) / ln))
            if best is None:
                continue
            _, o, odir = best
            if abs(odir[0] * d0[1][0] + odir[1] * d0[1][1]) > math.cos(math.radians(35)):
                continue
            hit = _walk(pts, o["width"] / 2 + SIDEWALK + 2.0)
            if hit is None:
                continue
            (px, py), (tx, ty) = hit
            nx, ny = -ty, tx
            w = r["width"]
            k = -w / 2 + 0.8
            while k < w / 2 - 0.5:
                cx, cy = px + nx * k, py + ny * k
                out.append([(cx - tx * 1.5, cy - ty * 1.5), (cx + tx * 1.5, cy + ty * 1.5)])
                k += 1.1
    return out


# ---------------------------------------------------------------- 沙盘


def slab(layout, M, col):
    b = layout["bounds"]
    ring = rounded_rect(b, SLAB_RADIUS)
    bm = bmesh.new()
    lib.add_prism(bm, ring, -SLAB_DEPTH, -0.02, mat=0)
    # 顶边青色发光线、底边一条暗一些的蓝线
    lib.add_tube(bm, [(x, y, 0.15) for x, y in ring] + [(ring[0][0], ring[0][1], 0.15)], 0.7, seg=6, mat=1)
    ob = lib.new_object("slab", bm, [M["slab"], M["slab_edge"]], col)
    return ob, ring


# ---------------------------------------------------------------- 地面


def ground(layout, M, col, slab_ring):
    mats = [M["paving"], M["sidewalk"], M["asphalt"], M["grass"], M["water"], M["lane"], M["lane_cyan"], M["water_edge"], M["curb"], M["path"]]
    PAVE, WALK, ROAD, GRASS, WATER, LANE, CYAN, WEDGE, CURB, PATH = range(10)
    bm = bmesh.new()
    _poly_face(bm, slab_ring, Z_PAVE, PAVE, 12.0)
    # 园区地块铺草坪（设计稿园区内是大片草坪，道路、步道压在上面）；楼栋外扩 9 m 为铺装广场
    _poly_face(bm, layout["campus"], Z_LAWN, GRASS, 16.0)

    # 注意：各层必须按从下到上的顺序生成。Lightmap 是平面投影，上下重叠的面共用同一块像素，后烘的覆盖先烘的；
    # 下层被上层挡住的部分烘出来是黑的，若下层后生成就会把上层盖成黑色（穿过绿地的园路发黑就是这个原因）
    for a in layout["areas"]:
        if a["kind"] in ("grass", "park"):
            _poly_face(bm, a["ring"], Z_GRASS, GRASS, 16.0)
    for bl in layout["buildings"]:
        _poly_face(bm, _grow(bl["footprint"], 9.0), Z_APRON, PAVE, 12.0)

    roads = layout["roads"]
    drive = [r for r in roads if r["kind"] in DRIVE]
    # 人行道垫在车行道下面，比路面宽出两侧各 SIDEWALK 米
    _ribbons(bm, [(r["points"], r["width"] + 2 * SIDEWALK) for r in drive], Z_WALK, WALK)
    # 园内服务道路与步道都是浅色园路（设计稿园区里的路是米灰色铺装，不是沥青），在草坪上一眼可辨
    _ribbons(bm, [(r["points"], r["width"]) for r in roads if r["kind"] not in DRIVE], Z_PATH, PATH)
    _ribbons(bm, [(r["points"], r["width"]) for r in drive], Z_ROAD, ROAD)
    # 路缘石：车行道两侧一道浅色窄带，把路面和人行道分开
    for r in roads:
        if r["kind"] in DRIVE:
            for side in (1, -1):
                _ribbon(bm, _offset_line(r["points"], side * r["width"] / 2), 0.35, Z_ROAD + 0.015, CURB, joints=False)
    for a in layout["areas"]:
        if a["kind"] == "water":
            _poly_face(bm, a["ring"], Z_WATER, WATER, 16.0)
            ring = a["ring"] + [a["ring"][0]]
            # 石砌驳岸：一圈 1.4 m 宽的浅色岸边
            _ribbon(bm, ring, 1.4, Z_WATER + 0.01, WEDGE, joints=False)
    # 标线（设计稿：每条车道白色虚线、路缘白实线、路口斑马线；主干道外缘青色发光线）
    for i, r in enumerate(d for d in drive if len(d["points"]) >= 2):
        # 每条路的标线各抬高一点：两条路在路口交叉时标线不同高
        zm = Z_MARK + i * Z_STEP
        _lane_marks(bm, r, LANE, zm)
        if r["kind"] in ("primary", "secondary", "tertiary"):
            for side in (1, -1):
                _ribbon(bm, _offset_line(r["points"], side * (r["width"] / 2 - 0.25)), 0.3, zm, CYAN, joints=False)
    for stripe in _crosswalks(roads):
        # 斑马线比所有车道线都高：与车道虚线重叠处不能同高（同高的重叠面烘焙时互相遮挡成黑）
        _ribbon(bm, stripe, 0.55, Z_MARK + 0.015, LANE, joints=False)

    _lightmap_uv(bm, layout["bounds"])
    ob = lib.new_object("ground", bm, mats, col)
    return ob


def _lightmap_uv(bm, b):
    """第二套 UV：按沙盘范围平面投影到 0..1（地面全是水平面，平面投影没有拉伸）"""
    lm = bm.loops.layers.uv.new("Lightmap")
    w, h = b["x1"] - b["x0"], b["y1"] - b["y0"]
    for f in bm.faces:
        for loop in f.loops:
            co = loop.vert.co
            loop[lm].uv = ((co.x - b["x0"]) / w, (co.y - b["y0"]) / h)


# ---------------------------------------------------------------- 树木


# 树形：名称、叶色（sRGB 0..1）、树冠半径 R、冠中心高度、叶团数、树干高度；kind 区分阔叶 / 柱形 / 针叶 / 灌木
TREE_SPECS = [
    ("tree_broad_dark", (0.10, 0.27, 0.13), 3.2, 6.0, 7, 3.2, "broad"),
    ("tree_broad_mid", (0.17, 0.37, 0.17), 3.0, 5.6, 7, 3.0, "broad"),
    ("tree_broad_yellow", (0.33, 0.43, 0.15), 2.8, 5.4, 6, 2.8, "broad"),
    ("tree_column", (0.12, 0.31, 0.16), 1.7, 6.8, 6, 2.6, "column"),
    ("tree_conifer", (0.06, 0.20, 0.13), 2.0, 0.0, 4, 1.4, "conifer"),
    ("tree_small", (0.40, 0.47, 0.20), 2.0, 3.9, 5, 2.0, "broad"),
    ("shrub", (0.12, 0.29, 0.14), 1.5, 1.0, 4, 0.0, "shrub"),
]
TRUNK_RGB = (0.18, 0.13, 0.09)


def tree_meshes(M, seed=5):
    """
    七种树形（含灌木），每种一份网格，全部用顶点色上色（材质 M_tree）。
    树冠不是一个光滑球，而是 4～7 个随机大小、带噪声起伏的叶团簇在一起；
    顶点色写入体积明暗：越靠下、越靠冠心越暗，顶部外沿最亮——没有实时阴影也能读出体积。
    """
    rnd = random.Random(seed)
    out = []
    for name, rgb, R, zc, n_blob, trunk_h, kind in TREE_SPECS:
        bm = bmesh.new()
        # 字节型顶点色层按 sRGB 存储（导出 glTF 时由导出器转线性），所以直接写 sRGB 值，不要自己再转一次
        col = bm.loops.layers.color.new("Col")
        leaf_rgb = rgb
        # 树干（灌木没有）
        if trunk_h > 0:
            for f in lib.add_cyl(bm, 0.2, trunk_h + 1.0, (0, 0, (trunk_h + 1.0) / 2), seg=6, mat=0, r2=0.12):
                for loop in f.loops:
                    loop[col] = (*TRUNK_RGB, 1.0)
        blobs = []
        if kind == "conifer":
            # 针叶：三层圆锥叠起来
            for k in range(3):
                r = R * (1.0 - 0.25 * k)
                z = trunk_h + 1.6 + k * 1.9
                blobs.append(lib.add_cyl(bm, r, 3.2, (0, 0, z), seg=9, mat=0, r2=0.15))
        else:
            sx = R * (0.55 if kind != "column" else 0.35)
            sz = R * (0.45 if kind != "column" else 1.3)
            for k in range(n_blob):
                # 叶团中心：在冠心附近的椭球里随机，略偏上
                for _ in range(20):
                    dx, dy, dz = (rnd.uniform(-1, 1) for _ in range(3))
                    if dx * dx + dy * dy + dz * dz <= 1:
                        break
                c = (dx * sx, dy * sx, zc + dz * sz + 0.3 * sz)
                r = R * rnd.uniform(0.45, 0.68) * (0.8 if kind == "column" else 1.0)
                faces = lib.add_ico(bm, r, c, sub=1, mat=0)
                # 叶团表面起伏：顶点沿径向随机伸缩
                verts = {v for f in faces for v in f.verts}
                for v in verts:
                    d = v.co - Vector(c)
                    v.co = Vector(c) + d * rnd.uniform(0.86, 1.12)
                blobs.append(faces)
        # 顶点色：体积明暗 + 每个叶团一点色差
        zs = [v.co.z for faces in blobs for f in faces for v in f.verts]
        z0, z1 = min(zs), max(zs)
        for faces in blobs:
            tint = rnd.uniform(0.88, 1.12)
            for f in faces:
                for loop in f.loops:
                    co = loop.vert.co
                    h = (co.z - z0) / ((z1 - z0) or 1)
                    out_r = min(1.0, math.hypot(co.x, co.y) / (R * 0.9))
                    shade = (0.42 + 0.58 * h**0.8) * (0.72 + 0.28 * out_r) * tint
                    loop[col] = (*(min(1.0, x * shade * 1.35) for x in leaf_rgb), 1.0)
        me = lib.make_mesh(name, bm, [M["tree"]], smooth_angle=70)
        out.append(me)
    return out


def scatter_trees(layout, seed=21):
    """返回 [(x, y, 角度, 缩放, 树形下标)]"""
    rnd = random.Random(seed)
    b = layout["bounds"]
    blds = [[tuple(p) for p in bl["footprint"]] for bl in layout["buildings"]]
    bld_boxes = [(min(p[0] for p in r) - 9, max(p[0] for p in r) + 9, min(p[1] for p in r) - 9, max(p[1] for p in r) + 9) for r in blds]
    waters = [a["ring"] for a in layout["areas"] if a["kind"] == "water"]
    roads = layout["roads"]
    margin = 6.0

    def blocked(x, y, road_clear=1.5):
        if not (b["x0"] + margin < x < b["x1"] - margin and b["y0"] + margin < y < b["y1"] - margin):
            return True
        for (x0, x1, y0, y1), ring in zip(bld_boxes, blds):
            if x0 < x < x1 and y0 < y < y1:
                # 楼前广场（轮廓外扩 9 m）不种
                if _in_ring(x, y, ring) or any(_seg_dist(x, y, ring[i], ring[(i + 1) % len(ring)]) < 9 for i in range(len(ring))):
                    return True
        for w in waters:
            # 水面以及岸边 4 m（驳岸、庭院灯）不种
            if _in_ring(x, y, w) or any(_seg_dist(x, y, w[i], w[(i + 1) % len(w)]) < 4 for i in range(len(w))):
                return True
        for r in roads:
            pts = r["points"]
            half = r["width"] / 2 + (SIDEWALK if r["kind"] in DRIVE else 0) + road_clear
            for a, c in zip(pts, pts[1:]):
                if _seg_dist(x, y, a, c) < half:
                    return True
        return False

    trees = []
    grid = {}
    cell = 5.0

    def far_enough(x, y, dmin):
        gx, gy = int(x // cell), int(y // cell)
        for i in range(gx - 2, gx + 3):
            for j in range(gy - 2, gy + 3):
                for tx, ty in grid.get((i, j), ()):
                    if (tx - x) ** 2 + (ty - y) ** 2 < dmin * dmin:
                        return False
        return True

    # 树形权重（与 TREE_SPECS 顺序一致）：阔叶为主，点缀柱形、针叶、小乔木与灌木
    weights = [0.24, 0.24, 0.1, 0.1, 0.08, 0.08, 0.16]

    def add(x, y, kind=None):
        if kind is None:
            kind = rnd.choices(range(len(weights)), weights)[0]
        # 比真实树冠放大一档：真实尺度的园区在默认取景下树只有一两个像素，设计稿里的树团更醒目
        trees.append((x, y, rnd.random() * math.tau, 1.15 + rnd.random() * 0.5, kind))
        grid.setdefault((int(x // cell), int(y // cell)), []).append((x, y))

    # 行道树：行驶道路两侧人行道上，间距 14 m（设计稿的行道树是一排疏朗的点，不是连成一片的树墙）
    for r in roads:
        if r["kind"] not in DRIVE:
            continue
        street_kind = rnd.choice((0, 1, 3))
        for side in (1, -1):
            line = _offset_line(r["points"], side * (r["width"] / 2 + SIDEWALK * 0.6))
            for (x, y), _ in _resample(line, 14.0, rnd.random() * 14):
                if not blocked(x, y, road_clear=-SIDEWALK) and far_enough(x, y, 9):
                    # 行道树：同一条路用同一种阔叶，像真实街道那样整齐
                    add(x, y, street_kind)
    # 园内：先撒树团中心（绿地里间距 26 m、其余园区 40 m），每个树团 3～6 棵挤在 9 m 范围内，
    # 树团之间留出成片的草坪与铺装，地面的灯光光斑才露得出来
    grass = [a["ring"] for a in layout["areas"] if a["kind"] in ("grass", "park")]
    centers = []
    for _ in range(9000):
        x = b["x0"] + rnd.random() * (b["x1"] - b["x0"])
        y = b["y0"] + rnd.random() * (b["y1"] - b["y0"])
        in_grass = any(_in_ring(x, y, g) for g in grass)
        if not in_grass and not _in_ring(x, y, layout["campus"]):
            continue
        dmin = 26.0 if in_grass else 40.0
        if all((cx - x) ** 2 + (cy - y) ** 2 > dmin * dmin for cx, cy in centers) and not blocked(x, y, road_clear=4):
            centers.append((x, y))
    for cx, cy in centers:
        kind = rnd.choices(range(len(weights)), weights)[0]
        for _ in range(rnd.randint(3, 6)):
            for _ in range(12):
                a, d = rnd.random() * math.tau, rnd.random() ** 0.5 * 9.0
                x, y = cx + d * math.cos(a), cy + d * math.sin(a)
                if far_enough(x, y, 5.0) and not blocked(x, y):
                    # 同一团里多半是同一种树，偶尔混一棵别的
                    add(x, y, kind if rnd.random() < 0.7 else None)
                    break
    return trees


def trees(layout, M, col):
    meshes = tree_meshes(M)
    parent = lib.empty("trees", col)
    pts = scatter_trees(layout)
    for i, (x, y, a, s, k) in enumerate(pts):
        ob = lib.place(meshes[k], f"tree_{i}", col, (x, y, Z_GRASS), rot_z=a, parent=parent)
        ob.scale = (s, s, s)
    return len(pts)


# ---------------------------------------------------------------- 路灯


def lamps(layout, M, col, light_col):
    """
    路灯：行驶道路两侧交错立灯（每侧间距 40 m，两侧错开半个间距）；湖边庭院灯见 garden_lamps。返回数量。
    设计稿里道路两侧是连续的暖色灯点，夜景的地面光池主要靠它们
    """
    bm = bmesh.new()
    lib.add_cyl(bm, 0.12, 7.0, (0, 0, 3.5), seg=6, mat=0)
    lib.add_box(bm, (1.6, 0.25, 0.18), (0.7, 0, 7.0), mat=0)
    lib.add_box(bm, (0.7, 0.45, 0.16), (1.3, 0, 6.88), mat=1)
    me = lib.make_mesh("lamp", bm, [M["lamp_pole"], M["lamp_head"]])
    parent = lib.empty("lamps", col)
    n = 0
    data = bpy.data.lights.get("L_lamp") or bpy.data.lights.new("L_lamp", "POINT")
    # 路灯光斑是地面「光影感」的主要来源：钠灯暖色、能量足够在烘焙图里形成明显的光池
    data.energy = 3600
    data.color = (1.0, 0.74, 0.48)
    data.shadow_soft_size = 0.6
    step = 40.0
    for r in layout["roads"]:
        if r["kind"] not in DRIVE:
            continue
        for side in (-1, 1):
            # 灯立在人行道靠路缘一侧
            line = _offset_line(r["points"], side * (r["width"] / 2 + 0.8))
            for (x, y), ang in _resample(line, step, 10.0 if side < 0 else 10.0 + step / 2):
                # 灯臂伸向路中
                rot = ang + (math.pi / 2 if side < 0 else -math.pi / 2)
                lib.place(me, f"lamp_{n}", col, (x, y, Z_ROAD), rot_z=rot, parent=parent)
                hx, hy = x + 1.3 * math.cos(rot), y + 1.3 * math.sin(rot)
                lo = bpy.data.objects.new(f"L_lamp_{n}", data)
                lo.location = Vector((hx, hy, 6.6))
                light_col.objects.link(lo)
                n += 1
    return n


def garden_lamps(layout, M, col, light_col):
    """
    湖边庭院灯：每片水面外 2.5 m 一圈、间距 14 m 的 3.6 m 高球形灯（灯头与路灯共用 M_lamp_head，three.js 里同样会把附近的树染暖）；
    落在楼体或行驶道路上的点跳过。PREVIEW 集合里同位置放点光源，烘焙出湖岸的暖色光池与水面倒影的亮斑
    """
    bm = bmesh.new()
    lib.add_cyl(bm, 0.08, 3.4, (0, 0, 1.7), seg=6, mat=0)
    lib.add_ico(bm, 0.32, (0, 0, 3.6), sub=2, mat=1)
    me = lib.make_mesh("garden_lamp", bm, [M["lamp_pole"], M["lamp_head"]])
    parent = lib.empty("garden_lamps", col)
    data = bpy.data.lights.get("L_garden") or bpy.data.lights.new("L_garden", "POINT")
    data.energy = 900
    data.color = (1.0, 0.8, 0.56)
    data.shadow_soft_size = 0.4
    blds = [[tuple(p) for p in bl["footprint"]] for bl in layout["buildings"]]
    n = 0
    for a in layout["areas"]:
        if a["kind"] != "water":
            continue
        ring = a["ring"]
        cx = sum(p[0] for p in ring) / len(ring)
        cy = sum(p[1] for p in ring) / len(ring)
        out = []
        for x, y in ring:
            d = math.hypot(x - cx, y - cy) or 1
            out.append((x + (x - cx) / d * 2.5, y + (y - cy) / d * 2.5))
        for (x, y), _ in _resample(out + [out[0]], 14.0, 3.0):
            if any(_in_ring(x, y, r) for r in blds):
                continue
            if any(
                _seg_dist(x, y, p, q) < r["width"] / 2 + 0.5
                for r in layout["roads"]
                if r["kind"] in DRIVE
                for p, q in zip(r["points"], r["points"][1:])
            ):
                continue
            lib.place(me, f"garden_lamp_{n}", col, (x, y, Z_WALK), parent=parent)
            lo = bpy.data.objects.new(f"L_garden_{n}", data)
            lo.location = Vector((x, y, 3.6))
            light_col.objects.link(lo)
            n += 1
    return n


# ---------------------------------------------------------------- 园内地灯

PATH_KINDS = {"service", "footway", "pedestrian", "path", "cycleway"}
PATH_STEP = 13.0  # 与 three.js 的 scene/park/pathLights.js 一致，烘焙出的光斑正好落在发光点下面


def path_lights(layout, M, col, light_col):
    """
    园内步道 / 服务道路两旁的矮柱地灯：灯柱网格（导出为 GPU 实例）+ PREVIEW 集合里的小点光源（只用于烘焙地面光斑）。
    取点算法与 pathLights.js 相同：每条线从 STEP/2 处开始、跨折点连续计距。
    """
    bm = bmesh.new()
    lib.add_cyl(bm, 0.09, 0.9, (0, 0, 0.45), seg=6, mat=0)
    lib.add_cyl(bm, 0.13, 0.18, (0, 0, 0.92), seg=8, mat=1)
    me = lib.make_mesh("bollard", bm, [M["bollard"], M["bollard_head"]])
    parent = lib.empty("bollards", col)
    data = bpy.data.lights.get("L_bollard") or bpy.data.lights.new("L_bollard", "POINT")
    data.energy = 220
    data.color = (1.0, 0.78, 0.52)
    data.shadow_soft_size = 0.3
    n = 0
    for r in layout["roads"]:
        if r["kind"] not in PATH_KINDS:
            continue
        for (x, y), _ in _resample(r["points"], PATH_STEP, PATH_STEP / 2):
            lib.place(me, f"bollard_{n}", col, (x, y, Z_WALK), parent=parent)
            lo = bpy.data.objects.new(f"L_bollard_{n}", data)
            lo.location = Vector((x, y, 1.0))
            light_col.objects.link(lo)
            n += 1
    return n

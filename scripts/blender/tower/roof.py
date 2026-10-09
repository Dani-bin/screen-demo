"""
屋顶机房：顶层（58F）顶板到斜屋面之间的楔形空腔（设计稿里斜屋顶玻璃下透出的设备）
----------------------------------------------------------
斜屋面几何见 floors.roof_geom（与 BuildingScene.js 一致）：屋面最高点高出 58F 顶板 ROOF_HIGH，沿下坡方向 d 线性下降；
模型原点 = 塔楼形心、z = 0 为 58F 顶板顶面（three.js 里放在 58F 顶板处，按该段中部收分缩放，再用屋面裁剪平面兜底）。
投影 p = x·d.x + y·d.y，屋面 z_r(p) = ROOF_HIGH - rise × (p - lo) / span：p = lo 处最高，往低侧约 27 m 降到顶板，
所以屋顶机房只占平面的高侧一段（斜面再往下切过 53～58F，那几层单独建模，见 build.roof_floors）。
内容：顶板（烘贴图）；顺坡钢梁 + 檩条 + 立柱、梁底灯带；电梯机房（核心筒顶）、三台冷却塔、热泵机组、
冷却水管、擦窗机（轨道 + 机身 + 吊臂 + 吊篮）、检修走道与地面安全线（烘顶点色）。
"""

import math

import bmesh

from . import lib
from .floors import INSET, MI, ROOF_HIGH, clip_half, core_dims, in_poly, inset, major_axis, roof_geom


def build(name, foot, b, M, col, loc):
    g = roof_geom(foot, b)
    rise, d, lo, span = g["rise"], g["d"], g["lo"], g["span"]
    e = (-d[1], d[0])  # 沿屋脊方向
    depth = ROOF_HIGH * span / rise  # 屋面降到顶板处的投影距离（从 lo 起算）
    # 屋顶机房平面：屋面高出顶板 0.3 m 以上的部分（高侧一段）
    plan = clip_half(inset(foot, INSET), d, lo + depth * (1 - 0.3 / ROOF_HIGH))
    inner = inset(plan, 1.2)

    def zr(p):
        """投影 p 处的屋面高度（相对 58F 顶板）"""
        return ROOF_HIGH - rise * (p - lo) / span

    def xy(p, q):
        return p * d[0] + q * e[0], p * d[1] + q * e[1]

    def fits(p, q, rp, rq, h, gap=0.5):
        """以 (p, q) 为中心、半尺寸 rp × rq 的设备，高 h：四角都在平面内、最低处屋面下还留 gap"""
        for sp in (-1, 1):
            for sq in (-1, 1):
                if not in_poly(*xy(p + sp * rp, q + sq * rq), inner):
                    return False
        return zr(p + rp) - h >= gap

    rot = math.atan2(d[1], d[0])  # 盒子沿 (p, q) 摆放的转角
    bm = bmesh.new()
    bv = bmesh.new()

    def box(target, size_pq, p, q, z, mat, bottom=False):
        """(p, q) 坐标下的盒子：size = (沿 p, 沿 q, 高)"""
        lib.add_box(target, size_pq, (*xy(p, q), z), rot, mat, bottom)

    # ---- 顶板（烘贴图）+ 板边
    lib.add_poly(bm, plan, 0.03, MI["concrete"])
    lib.add_band(bv, plan, -0.3, 0.03, MI["slab_edge"])

    # ---- q 方向的范围（沿屋脊），按 2 m 一步扫出平面内 p 的区间
    qs = [x * e[0] + y * e[1] for x, y in plan]
    qmin, qmax = min(qs), max(qs)

    def p_range(q, ring, step=0.25):
        ps = [lo + i * step for i in range(int(depth / step) + 1)]
        ins = [p for p in ps if in_poly(*xy(p, q), ring)]
        return (min(ins), max(ins)) if ins else None

    # ---- 顺坡钢梁（每 4.5 m 一根，梁顶贴着屋面下 0.25 m）+ 梁底灯带（隔一根一条）+ 高侧立柱
    beam_ring = clip_half(inset(plan, 0.6), d, lo + depth * (1 - 1.2 / ROOF_HIGH))
    n = int((qmax - qmin) / 4.5)
    for i in range(1, n):
        q = qmin + (qmax - qmin) * i / n
        r = p_range(q, beam_ring)
        if not r or r[1] - r[0] < 3:
            continue
        p0, p1 = r
        zt = lambda p: zr(p) - 0.25 - 0.35  # 梁中心
        A, B = (*xy(p0, q), zt(p0)), (*xy(p1, q), zt(p1))
        lib.add_beam(bv, A, B, 0.35, 0.7, MI["steel"])
        # 灯带：每根梁底下方 0.1 m，比梁短一截（屋顶机房只靠灯带照亮，透过斜屋面玻璃要读得出设备）
        pa, pb = p0 + 1.5, p1 - 1.5
        if pb > pa:
            lib.add_beam(bv, (*xy(pa, q), zt(pa) - 0.42), (*xy(pb, q), zt(pb) - 0.42), 0.3, 0.06, MI["light_roof"])
        # 立柱：屋面高于 4 m 的地方每 9 m 一根
        p = p0 + 2
        while p < p1 - 2:
            h = zt(p) - 0.35
            if h > 4:
                lib.add_box(bv, (0.35, 0.35, h), (*xy(p, q), h / 2), rot, MI["steel"], bottom=True)
            p += 9
    # 檩条：沿屋脊方向，每 5 m 一道
    p = lo + 3
    while p < lo + depth - 3:
        qr = [x for x in (qmin + t * 0.25 for t in range(int((qmax - qmin) / 0.25) + 1)) if in_poly(*xy(p, x), beam_ring)]
        if len(qr) > 4:
            z = zr(p) - 0.25 - 0.12
            lib.add_beam(bv, (*xy(p, min(qr)), z), (*xy(p, max(qr)), z), 0.22, 0.24, MI["steel"])
        p += 5

    # ---- 电梯机房：核心筒正上方的混凝土方盒（高度按屋面压低）
    ang = major_axis(foot)
    cw, cd = core_dims(foot, ang)
    # 核心筒四角在下坡方向上的最大投影 → 那里的屋面高度决定机房能多高
    corners = [(sa * cw / 2, sb * cd / 2) for sa in (-1, 1) for sb in (-1, 1)]
    pmax = max((u * math.cos(ang) - v * math.sin(ang)) * d[0] + (u * math.sin(ang) + v * math.cos(ang)) * d[1] for u, v in corners)
    hm = min(4.2, zr(pmax) - 0.8)
    if hm > 1.5:
        lib.add_box(bm, (cw, cd, hm), (0, 0, hm / 2 + 0.03), ang, MI["concrete"])
        # 机房门 + 百叶
        ca, sa_ = math.cos(ang), math.sin(ang)
        for s in (-1, 1):
            ox, oy = -sa_ * s * (cd / 2 + 0.03), ca * s * (cd / 2 + 0.03)
            lib.add_box(bv, (1.6, 0.08, 2.2), (ox, oy, 1.13), ang, MI["steel"])
            for t in range(4):
                lib.add_box(bv, (2.4, 0.08, 0.08), (ox + ca * 3.0, oy + sa_ * 3.0, hm - 1.2 + t * 0.22), ang, MI["monitor"])
            lib.add_box(bv, (0.8, 0.1, 0.3), (ox, oy, 2.5), ang, MI["exit"])

    # ---- 冷却塔：高侧（p 小）沿屋脊排成一排，取能放下最多台的那一排
    tw, th = 4.6, 3.8
    towers = []
    for pp in [lo + 4 + t * 1.5 for t in range(8)]:
        row = []
        for t in range(13):
            q = qmin + (qmax - qmin) * (0.2 + t * 0.05)
            if fits(pp, q, tw / 2, tw / 2, th + 1.0) and all(abs(q - b_) > tw + 1.2 for _, b_ in row):
                row.append((pp, q))
        if len(row) > len(towers):
            towers = row[:3]
    for p, q in towers:
        _cooling_tower(bv, box, xy, p, q, tw, th)

    def near_core(p, q, pad):
        """(p, q) 是否落在电梯机房（核心筒顶）外扩 pad 的范围内"""
        x, y = xy(p, q)
        u = x * math.cos(ang) + y * math.sin(ang)
        v = -x * math.sin(ang) + y * math.cos(ang)
        return abs(u) < cw / 2 + pad and abs(v) < cd / 2 + pad

    # ---- 热泵 / 空调机组：屋面中部一排
    units = []
    for t in range(12):
        q = qmin + (qmax - qmin) * (0.15 + t * 0.07)
        p = lo + depth * 0.7
        if fits(p, q, 1.3, 1.0, 2.0) and all(abs(q - u) > 2.6 for u in units) and not near_core(p, q, 2.2):
            units.append(q)
            box(bv, (2.6, 2.0, 1.7), p, q, 0.88, MI["ahu"])
            lib.add_cyl(bv, 0.7, 0.2, (*xy(p, q), 1.73), seg=14, mat=MI["steel"])  # 顶部风扇
            lib.add_cyl(bv, 0.55, 0.02, (*xy(p, q), 1.93), seg=14, mat=MI["monitor"], cap=True)
            box(bv, (0.3, 0.6, 0.4), p + 1.3, q, 1.2, MI["pot"])  # 电控箱

    # ---- 冷却水管：每台冷却塔接出供 / 回两根支管 → 沿屋脊的总管 → 中间一根下到管井（绿 / 蓝 + 管架）
    if towers:
        qa = min(t[1] for t in towers) - 0.5
        qb = max(t[1] for t in towers) + 0.5
        pz = towers[0][0] + tw / 2 + 1.2
        zp = 1.1
        for k, mat in ((0, "pipe_g"), (0.8, "pipe_b")):
            lib.add_seg(bv, (*xy(pz + k, qa), zp), (*xy(pz + k, qb), zp), 0.28, MI[mat], 12)
            for p, q in towers:
                lib.add_seg(bv, (*xy(p + tw / 2, q + k - 0.4), zp), (*xy(pz + k, q + k - 0.4), zp), 0.22, MI[mat], 10)
            qm = (qa + qb) / 2 + 2.0
            lib.add_seg(bv, (*xy(pz + k, qm), zp), (*xy(pz + k, qm), 0.03), 0.28, MI[mat], 12)
            lib.add_seg(bv, (*xy(pz + k, qm), 0.35), (*xy(pz + k, qm), 0.45), 0.42, MI["steel"], 12)  # 穿楼板套管法兰
        for t in range(int((qb - qa) / 3) + 1):  # 管架
            box(bv, (2.0, 0.12, 0.9), pz + 0.4, qa + t * 3, 0.48, MI["steel"])

    # ---- 擦窗机：沿屋脊的双轨 + 机身 + 立柱 + 吊臂（伸向高侧外缘）+ 吊篮
    pb = lo + depth * 0.5
    rr = [x for x in (qmin + t * 0.25 for t in range(int((qmax - qmin) / 0.25) + 1)) if in_poly(*xy(pb, x), inset(plan, 2.0))]
    if rr:
        for dp in (-1.1, 1.1):
            lib.add_beam(bv, (*xy(pb + dp, min(rr)), 0.12), (*xy(pb + dp, max(rr)), 0.12), 0.18, 0.18, MI["steel"])
        qb_ = min(rr) + (max(rr) - min(rr)) * 0.35
        h_body = 1.4
        box(bv, (3.0, 2.6, h_body), pb, qb_, 0.2 + h_body / 2, MI["bmu"])
        box(bv, (3.02, 2.62, 0.18), pb, qb_, 0.2 + h_body * 0.65, MI["yellow"])
        mast = min(3.0, zr(pb + 1.2) - h_body - 1.3)
        if mast > 0.8:
            zm = 0.2 + h_body + mast
            lib.add_cyl(bv, 0.32, mast, (*xy(pb, qb_), 0.2 + h_body), seg=12, mat=MI["bmu"])
            # 吊臂：朝高侧（p 减小）伸出，高度在屋面下
            p_end = pb - 9.0
            while p_end < pb - 2 and not in_poly(*xy(p_end, qb_), inset(plan, 0.8)):
                p_end += 0.5
            lib.add_beam(bv, (*xy(pb + 1.0, qb_), zm), (*xy(p_end, qb_), zm), 0.45, 0.55, MI["bmu"])
            lib.add_box(bv, (0.15, 0.15, 1.6), (*xy(p_end + 0.3, qb_), zm - 0.8), rot, MI["alu"], bottom=True)
            box(bv, (0.9, 2.4, 0.9), p_end + 0.3, qb_, zm - 2.0, MI["bmu"], bottom=True)  # 吊篮
            box(bv, (0.92, 2.42, 0.12), p_end + 0.3, qb_, zm - 1.6, MI["yellow"])

    # ---- 检修走道（铝格栅）+ 安全线
    for p in (lo + depth * 0.36, lo + depth * 0.82):
        rq = [x for x in (qmin + t * 0.25 for t in range(int((qmax - qmin) / 0.25) + 1)) if in_poly(*xy(p, x), inset(plan, 2.5))]
        if len(rq) > 4:
            box(bv, (1.2, max(rq) - min(rq), 0.06), p, (min(rq) + max(rq)) / 2, 0.06, MI["alu"])
            for s in (-1, 1):
                box(bv, (0.12, max(rq) - min(rq), 0.03), p + s * 0.75, (min(rq) + max(rq)) / 2, 0.05, MI["yellow"])

    ob = lib.new_object(name, bm, M, col)
    ov = lib.new_object(name + "_v", bv, M, col)
    for o in (ob, ov):
        o.location = loc
        o["variant"] = "roof"
        o["rise"] = rise
    return ob, ov


def _cooling_tower(bv, box, xy, p, q, w, h):
    """方形横流冷却塔：钢支架 + 灰白塔体 + 四面横向百叶 + 顶部风筒 + 风机（深色）"""
    box(bv, (w + 0.4, w + 0.4, 0.5), p, q, 0.28, MI["steel"])
    box(bv, (w, w, h), p, q, 0.5 + h / 2, MI["pot"])
    for j in range(6):  # 百叶：四面各一圈
        z = 0.8 + j * (h - 0.9) / 6
        box(bv, (w + 0.08, w + 0.08, 0.12), p, q, z, MI["duct"])
    x, y = xy(p, q)
    lib.add_cyl(bv, w * 0.36, 0.9, (x, y, 0.5 + h), seg=20, mat=MI["alu"], cap=False)
    lib.add_cyl(bv, w * 0.34, 0.02, (x, y, 0.5 + h + 0.55), seg=20, mat=MI["monitor"])
    lib.add_cyl(bv, 0.25, 0.3, (x, y, 0.5 + h + 0.4), seg=10, mat=MI["steel"])

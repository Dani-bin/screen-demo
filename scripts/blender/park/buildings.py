"""
园区建模 · 楼体
----------------------------------------------------------
轮廓、层数、屋顶全部来自 layout.json（OSM），对象名 bld_<key> 供 three.js 拾取与高亮。
外形按设计稿 01-ai-park.png 与实景照片还原（OSM 只有平面轮廓，竖向造型是按照片补的）：
  tower   双子塔：椭圆平面向上收分（「口红」形，塔顶约为底部的 0.86），顶部斜切（OSM roof:shape=skillion，
          高差 roof:height，朝 roof:direction 下坡），斜切口外沿倒成圆肩；冠顶内凹，凹面里两圈同心光环；
          底部 14 m 为暖光大堂；冠顶外沿、大堂顶与塔身左右轮廓描金色发光线（设计稿的金色轮廓光）；
          外墙贴图为深蓝玻璃外罩白色冰裂纹格栅（palette.py）
  pebble  鹅卵石楼：轮廓尖角先倒圆，外墙到顶部按四分之一椭圆向内卷成圆弧檐口（实景的蛋形立面），
          檐口上段为银白金属，屋面内缩一圈屋顶花园与设备；外墙为白色层间带 + 枝杈格构
  hall    会议中心：底部 6 m 暖光玻璃，上覆金属壳穹顶，檐口一圈银边
  small   园区内其他小建筑：简单挤出
外墙用放样网格（相邻面共用顶点）做平滑着色，避免每段墙各自成平面的「折纸」感；
UV 约定：外墙 u = 沿周长的米数 / 贴图宽对应的米数，v = 高度 / 贴图高对应的米数（见 palette.py）。
"""

import math

import bmesh

from . import lib
from . import palette as P

LOBBY_H = 14.0  # 塔楼大堂高度
TOWER_TAPER = 0.14  # 塔顶相对底部的收分比例
TOWER_SHOULDER = (4.0, 8.0)  # 斜切口圆肩：水平内收、竖向高度（米）
HALL_BASE = 6.0  # 会议中心玻璃基座高度
HALL_DOME = 11.0  # 会议中心穹顶矢高


def _centroid(ring):
    n = len(ring)
    return (sum(p[0] for p in ring) / n, sum(p[1] for p in ring) / n)


def _perimeter_u(ring, metres_per_u):
    """每个顶点沿周长的累计 u（首点重复一份闭合，避免贴图接缝处整段拉伸）"""
    us = [0.0]
    for i in range(1, len(ring) + 1):
        a, b = ring[i - 1], ring[i % len(ring)]
        us.append(us[-1] + math.hypot(b[0] - a[0], b[1] - a[1]) / metres_per_u)
    return us


def _walls(bm, ring, z0, z_top, mat, metres_u, metres_v, smooth=True):
    """
    沿轮廓竖起外墙：z_top 可以是常数或每个顶点各自的顶高。
    每段墙一个四边形（不共用顶点，硬边），UV 按周长 / 高度写入。用于矮墙、花园围边等小部件。
    """
    uv = bm.loops.layers.uv.verify()
    us = _perimeter_u(ring, metres_u)
    n = len(ring)
    tops = z_top if isinstance(z_top, (list, tuple)) else [z_top] * n
    for i in range(n):
        j = (i + 1) % n
        a, b = ring[i], ring[j]
        vs = [
            bm.verts.new((a[0], a[1], z0)),
            bm.verts.new((b[0], b[1], z0)),
            bm.verts.new((b[0], b[1], tops[j])),
            bm.verts.new((a[0], a[1], tops[i])),
        ]
        f = bm.faces.new(vs)
        f.material_index = mat
        f.smooth = smooth
        coords = [(us[i], z0), (us[i + 1], z0), (us[i + 1], tops[j]), (us[i], tops[i])]
        for loop, (u, z) in zip(f.loops, coords):
            loop[uv].uv = (u, z / metres_v)


def _loft(bm, rings, us, metres_v, mats):
    """
    放样外墙：rings 为自下而上的若干圈顶点 [(x, y, z), …]（每圈点数相同、与 us 一一对应），
    相邻两圈连成四边形、共用顶点（平滑着色）；mats[k] 为第 k 圈与第 k+1 圈之间那一段的材质下标。
    UV：u 取底圈周长（us），v = z / metres_v。返回每圈的 BMVert 列表。
    """
    uv = bm.loops.layers.uv.verify()
    n = len(us) - 1
    vrings = [[bm.verts.new(p) for p in ring] for ring in rings]
    for k in range(len(rings) - 1):
        lo, hi = vrings[k], vrings[k + 1]
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
            f.material_index = mats[k]
            f.smooth = True
            uvs = ((us[i], lo[i].co.z), (us[i + 1], lo[j].co.z), (us[i + 1], hi[j].co.z), (us[i], hi[i].co.z))
            for loop, (u, z) in zip(f.loops, uvs):
                loop[uv].uv = (u, z / metres_v)
    return vrings


def _cap(bm, ring, z, mat, flip=False):
    """水平封顶（多边形可凹，三角化）；z 可为每顶点高度"""
    zs = z if isinstance(z, (list, tuple)) else [z] * len(ring)
    vs = [bm.verts.new((p[0], p[1], zz)) for p, zz in zip(ring, zs)]
    f = bm.faces.new(list(reversed(vs)) if flip else vs)
    f.material_index = mat
    bmesh.ops.triangulate(bm, faces=[f], quad_method="BEAUTY", ngon_method="EAR_CLIP")


def _inset(ring, d):
    """轮廓向内收缩 d 米（按到中心的方向等距收缩，鹅卵石形、椭圆够用，不会自交）"""
    cx, cy = _centroid(ring)
    out = []
    for x, y in ring:
        dx, dy = x - cx, y - cy
        r = math.hypot(dx, dy) or 1
        k = max(0.0, (r - d) / r)
        out.append((cx + dx * k, cy + dy * k))
    return out


def _round_corners(ring, radius=3.5, min_turn=35.0):
    """
    把轮廓上的尖角（转角大于 min_turn 度）倒成圆角：OSM 轮廓在鹅卵石楼的入口凹口、水滴尖端有直角，
    直接放样会出现硬折线，实景这些位置都是圆滑过渡的
    """
    n = len(ring)
    out = []
    for i in range(n):
        a, p, c = ring[i - 1], ring[i], ring[(i + 1) % n]
        v1 = (p[0] - a[0], p[1] - a[1])
        v2 = (c[0] - p[0], c[1] - p[1])
        l1, l2 = math.hypot(*v1), math.hypot(*v2)
        turn = abs(math.degrees(math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1])))
        if turn < min_turn or l1 < 1e-6 or l2 < 1e-6:
            out.append(p)
            continue
        cut = min(radius, 0.45 * l1, 0.45 * l2)
        p0 = (p[0] - v1[0] / l1 * cut, p[1] - v1[1] / l1 * cut)
        p2 = (p[0] + v2[0] / l2 * cut, p[1] + v2[1] / l2 * cut)
        # 二次贝塞尔：切点 → 原角点（控制点）→ 切点
        for t in (0.0, 0.25, 0.5, 0.75, 1.0):
            out.append(
                (
                    (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p[0] + t * t * p2[0],
                    (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p[1] + t * t * p2[1],
                )
            )
    return out


def _silhouette_ends(ring, azimuth=-25.0):
    """
    默认视角下塔身左右轮廓线所在的两个顶点：塔楼两侧竖向描金线（设计稿里金线沿塔身左右边缘）。
    azimuth 为相机方位角（度，0 = 东、逆时针为正），与 preview.py 和 three.js 的 THEME.camera.azimuth 一致；
    取与视线垂直方向上投影最大 / 最小的顶点。
    """
    cx, cy = _centroid(ring)
    a = math.radians(azimuth)
    w = (-math.sin(a), math.cos(a))
    proj = [(x - cx) * w[0] + (y - cy) * w[1] for x, y in ring]
    return proj.index(max(proj)), proj.index(min(proj))


def _shrink(c, p, scale, inset):
    """点 p 相对中心 c 先按比例缩放，再沿径向内收 inset 米"""
    dx, dy = (p[0] - c[0]) * scale, (p[1] - c[1]) * scale
    r = math.hypot(dx, dy) or 1
    k = max(0.0, (r - inset) / r)
    return (c[0] + dx * k, c[1] + dy * k)


def tower(b, M, col):
    ring = [tuple(p) for p in b["footprint"]]
    H = b["height"]
    roof = b.get("roof") or {}
    c = _centroid(ring)
    n = len(ring)
    # 斜屋顶：沿下坡方向（罗盘角，0 = 北、90 = 东）线性降低 roof.height
    d = math.radians(roof.get("direction", 90))
    dirv = (math.sin(d), math.cos(d))
    proj = [(x - c[0]) * dirv[0] + (y - c[1]) * dirv[1] for x, y in ring]
    lo, hi = min(proj), max(proj)
    rh = roof.get("height", 0)
    tops = [H - rh * (p - lo) / ((hi - lo) or 1) for p in proj]

    def taper(z):
        # 收分：越往上收得越快（实景塔身像一支口红，下部几乎笔直）
        return 1.0 - TOWER_TAPER * (z / H) ** 1.7

    sh, sv = TOWER_SHOULDER
    # 每圈的 (高度参数 → 每个顶点的 z 与径向内收)：大堂两圈、塔身 24 圈（高度按各点顶高等分）、圆肩 7 圈
    plans = [(lambda i: 0.0, lambda i: 0.0), (lambda i: LOBBY_H, lambda i: 0.0)]
    body_n = 24
    for k in range(1, body_n + 1):
        plans.append((lambda i, k=k: LOBBY_H + (tops[i] - sv - LOBBY_H) * k / body_n, lambda i: 0.0))
    for k in range(1, 8):
        th = math.radians(90 * k / 7)
        plans.append((lambda i, th=th: tops[i] - sv + sv * math.sin(th), lambda i, th=th: sh * (1 - math.cos(th))))
    rings = []
    for zf, inf in plans:
        r = []
        for i, p in enumerate(ring):
            z = zf(i)
            r.append((*_shrink(c, p, taper(z), inf(i)), z))
        rings.append(r)

    mats = [M["tower_glass"], M["lobby"], M["tower_roof"], M["tower_gold"], M["tower_crown"]]
    bm = bmesh.new()
    mu = P.TOWER_TEX_COLS * P.TOWER_COL
    mv = P.TOWER_TEX_FLOORS * P.TOWER_FLOOR
    us = _perimeter_u(ring, mu)
    _loft(bm, rings, us, mv, [1] + [0] * (len(rings) - 2))

    # 冠顶：斜切口内凹 1.6 m 的浅碟，碟面上两圈同心光环
    top = rings[-1]
    zc = sum(p[2] for p in top) / n
    tc = _centroid([(p[0], p[1]) for p in top])

    def on_dish(k, drop):
        # 碟面上按比例 k 缩向中心的一圈点（随斜面倾斜）
        return [(tc[0] + (p[0] - tc[0]) * k, tc[1] + (p[1] - tc[1]) * k, zc + (p[2] - zc) * k - drop) for p in top]

    dish = [top, on_dish(0.9, 1.2), on_dish(0.55, 1.6)]
    _loft(bm, dish, [0.0] * (n + 1), mv, [2, 2])
    _cap(bm, [(p[0], p[1]) for p in dish[-1]], [p[2] for p in dish[-1]], 2)
    for k in (0.76, 0.48):
        # 光环贴着碟面（外圈在斜坡段、内圈在碟底），抬高 0.15 m 防止穿插
        drop = 1.2 + 0.4 * (0.9 - k) / 0.35 if k > 0.55 else 1.6
        pts = on_dish(k, drop - 0.15)
        lib.add_tube(bm, pts + [pts[0]], 0.22, seg=5, mat=4)

    # 金色轮廓：冠顶外沿一圈 + 大堂顶一圈 + 默认视角下左右轮廓处两条竖线（沿收分后的外墙）
    rim = [(x, y, z + 0.25) for x, y, z in top]
    lib.add_tube(bm, rim + [rim[0]], 0.55, seg=6, mat=3)
    lob = rings[1]
    lib.add_tube(bm, lob + [lob[0]], 0.35, seg=6, mat=3)
    for i in _silhouette_ends(ring):
        line = []
        for r in rings[1:]:
            x, y, z = r[i]
            # 金线略浮出墙面 0.3 m，避免与外墙 z-fighting
            q = _shrink(c, (x, y), 1.0, -0.3)
            line.append((q[0], q[1], z))
        lib.add_tube(bm, line, 0.45, seg=6, mat=3)
    ob = lib.new_object("bld_" + b["key"], bm, mats, col)
    return ob


def pebble(b, M, col):
    ring = _round_corners([tuple(p) for p in b["footprint"]])
    H = b["height"]
    c = _centroid(ring)
    # 圆弧檐口：外墙最上面一段按四分之一椭圆向内卷（水平 rh、竖向 rv），矮楼按比例缩小
    rv = min(5.0, 0.42 * H)
    rh = min(5.0, 0.9 * rv)
    mats = [M["pebble_glass"], M["roof_edge"], M["pebble_roof"], M["roof_green"], M["equip"]]
    bm = bmesh.new()
    mu = P.PEBBLE_TEX_COLS * P.PEBBLE_COL
    mv = P.PEBBLE_TEX_FLOORS * P.PEBBLE_FLOOR
    # 竖直墙身：每层一圈（顶点多一点，平滑着色时曲面更圆）
    zs = [0.0]
    z_curve = H - rv
    while zs[-1] + P.PEBBLE_FLOOR < z_curve - 0.5:
        zs.append(zs[-1] + P.PEBBLE_FLOOR)
    zs.append(z_curve)
    rings = [[(x, y, z) for x, y in ring] for z in zs]
    seg_mats = [0] * (len(zs) - 1)
    # 圆弧段：前段仍是玻璃外墙，转过约 40° 后换成银白金属檐口（设计稿那圈粗白边）
    for k in range(1, 9):
        th = math.radians(90 * k / 8)
        z = z_curve + rv * math.sin(th)
        ins = rh * (1 - math.cos(th))
        rings.append([(*_shrink(c, p, 1.0, ins), z) for p in ring])
        seg_mats.append(0 if th <= math.radians(36) else 1)
    _loft(bm, rings, _perimeter_u(ring, mu), mv, seg_mats)
    roof = [(p[0], p[1]) for p in rings[-1]]
    _cap(bm, roof, H, 2)
    # 屋顶花园：檐口内再收一圈的绿化（设计稿里鹅卵石楼都是绿色屋顶），银色矮边；层数多的楼再加几台屋面设备
    # 花园只占屋面中部（设计稿屋面以浅灰为主，中间一块绿），内收量取平均半径的 35%
    mean_r = sum(math.hypot(x - c[0], y - c[1]) for x, y in roof) / len(roof)
    garden = _inset(roof, max(4.0, 0.35 * mean_r))
    _walls(bm, garden, H, H + 0.6, 1, mu, mv)
    _cap(bm, garden, H + 0.6, 3)
    if b["levels"] >= 6:
        cx, cy = c
        for k, (dx, dy) in enumerate(((-4, 2), (3, -3), (5, 4))):
            lib.add_box(bm, (3.2, 2.2, 2.0), (cx + dx, cy + dy, H + 1.6), mat=4, rot_z=0.3 * k)
    # 平滑着色，但倒圆后仍超过 50° 的折角保持锐利
    ob = lib.new_object("bld_" + b["key"], bm, mats, col, smooth_angle=50)
    return ob


def hall(b, M, col):
    ring = [tuple(p) for p in b["footprint"]]
    cx, cy = _centroid(ring)
    mats = [M["hall_glass"], M["hall_shell"], M["roof_edge"]]
    bm = bmesh.new()
    _walls(bm, _inset(ring, 2.5), 0.0, HALL_BASE, 0, 40, 10)
    # 穹顶：从外挑 1.04 倍的檐口开始，逐圈向中心收、升高，顶点汇于中心
    uv = bm.loops.layers.uv.verify()
    rings_n = 10
    layers = []
    for k in range(rings_n + 1):
        t = k / rings_n
        s = 1.04 * math.cos(t * math.pi / 2) ** 0.8
        z = HALL_BASE + HALL_DOME * math.sin(t * math.pi / 2) ** 0.9
        layers.append([bm.verts.new((cx + (x - cx) * s, cy + (y - cy) * s, z)) for x, y in ring])
    us = _perimeter_u(ring, 64.0)
    n = len(ring)
    for k in range(rings_n):
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((layers[k][i], layers[k][j], layers[k + 1][j], layers[k + 1][i]))
            f.material_index = 1
            f.smooth = True
            for loop, (u, v) in zip(f.loops, ((us[i], k), (us[i + 1], k), (us[i + 1], k + 1), (us[i], k + 1))):
                loop[uv].uv = (u, v / rings_n)
    # 檐口底面 + 檐口银边（设计稿穹顶外沿的一圈亮线）
    _cap(bm, ring, HALL_BASE, 1, flip=True)
    eave = [(cx + (x - cx) * 1.04, cy + (y - cy) * 1.04, HALL_BASE) for x, y in ring]
    lib.add_tube(bm, eave + [eave[0]], 0.4, seg=6, mat=2)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.05)
    return lib.new_object("bld_" + b["key"], bm, mats, col)


def small(b, M, col):
    ring = [tuple(p) for p in b["footprint"]]
    bm = bmesh.new()
    lib.add_prism(bm, ring, 0.0, max(3.0, b["height"]), mat=0)
    return lib.new_object("bld_" + b["key"], bm, [M["small"]], col)


BUILDERS = {"tower": tower, "pebble": pebble, "hall": hall, "small": small}


def build(layout, M, col):
    obs = []
    for b in layout["buildings"]:
        obs.append(BUILDERS[b["kind"]](b, M, col))
    return obs

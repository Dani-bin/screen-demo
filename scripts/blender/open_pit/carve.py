"""坡道切进地形（2026-11-03 第 20 轮，用户要求改「道路和岩壁近景」，纯 numpy，不依赖 bpy）

运输路线的坡道是从下一级平台中线到上一级平台中线的直线坡（routes._arc），中间要跨过一面 30 m 高的陡坎：
原来地形不动、坡道被抬到地表以上，近景里道路像一座桥悬在陡坎上、斜着穿过台阶（第 17 轮评审）。
现在反过来改地形：沿每条坡道（以及出坑段、接入段和端帮皮带 BC-01 的槽）把台阶网格的顶点切 / 填到路面高度，
路面以外按 1 : 1.5 的边坡渐变回原地形——上坡一侧切进上一级平台的坎顶，下坡一侧在陡坎脚下填出路堤。
"""
import numpy as np

from . import camera as cam
from .pit import Pit
from .routes import PLAN, anchors_world, build_route, dump_edge

CORE = 13.0  # 路面半宽 m（路面宽 22 m + 两侧各 2 m 路肩）
BATTER = 0.6  # 边坡：每米高差向外渐变 0.6 m（约 59°，和陡坎差不多陡；1 : 1.5 时一条坡道两侧各拖出 45 m，坑壁三分之一都被改了）
MAX_SIDE = 20.0  # 边坡最宽 20 m
BELT_CORE = 9.0  # 端帮皮带槽半宽
SURFACE_BELOW = 0.6  # 切出来的路基比路线点低多少（路面带在路线点上方 0.4 m）
CELL = 40.0  # 空间分格


def _smooth(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def road_lines(p=None):
    """要切进地形的线：每条运输路线整条（平台环路、斜坡、出坑、接入），加端帮皮带 BC-01 的直线槽。
    返回 [(points (n, 3), core 半宽), …]，points 里的 z 是路面（或皮带基座）的高度"""
    p = p or Pit()
    a = cam.outline()["anchors"]
    anchors, _ = anchors_world(p, a)
    sinks = {"DP-W": dump_edge(p, "DP-W"), "DP-I": dump_edge(p, "DP-I"), "CR-01": anchors["CR-01"], "CR-02": anchors["CR-02"]}
    out = []
    for es, (sink, d, extra) in PLAN.items():
        # 平台上的环路也参与：它本来就在平台高度上，切 / 填时只起「保护」作用——每个顶点取最近的那条路，
        # 别的路线的坡道边坡就不会把这条环路埋进去（第 20 轮自查：有车埋在岩体里 31 m）
        pts = [(x, y, z - SURFACE_BELOW) for x, y, z, _ in build_route(p, anchors[es], sinks[sink], d, extra)]
        if len(pts) > 1:
            out.append((np.array(pts), CORE))
    c2, c1 = np.array(anchors["CR-02"]), np.array(anchors["CR-01"])
    out.append((np.array([c2, c1]), BELT_CORE))
    return out


def _dense(pts, step=3.0):
    res = []
    for a, b in zip(pts[:-1], pts[1:]):
        n = max(1, int(np.hypot(b[0] - a[0], b[1] - a[1]) / step))
        t = np.linspace(0, 1, n, endpoint=False)[:, None]
        res.append(a + (b - a) * t)
    res.append(pts[-1:])
    return np.vstack(res)


def carve(V, p=None):
    """V：台阶网格顶点 (n, 3)，就地改 z 并返回；统计改了多少顶点"""
    p = p or Pit()
    samples, cores = [], []
    for pts, core in road_lines(p):
        d = _dense(pts)
        samples.append(d)
        cores.append(np.full(len(d), core))
    S = np.vstack(samples)
    C = np.concatenate(cores)
    # 采样点按格子分桶
    keys = np.floor(S[:, :2] / CELL).astype(int)
    buckets = {}
    for i, k in enumerate(map(tuple, keys)):
        buckets.setdefault(k, []).append(i)
    buckets = {k: np.array(v) for k, v in buckets.items()}
    vkeys = np.floor(V[:, :2] / CELL).astype(int)
    changed = 0
    groups = {}
    for i, k in enumerate(map(tuple, vkeys)):
        groups.setdefault(k, []).append(i)
    for (cx, cy), idx in groups.items():
        cand = [buckets[(cx + dx, cy + dy)] for dx in (-1, 0, 1) for dy in (-1, 0, 1) if (cx + dx, cy + dy) in buckets]
        if not cand:
            continue
        cand = np.concatenate(cand)
        idx = np.array(idx)
        P = V[idx]
        dxy = P[:, None, :2] - S[None, cand, :2]
        dist = np.hypot(dxy[..., 0], dxy[..., 1])
        # 每个顶点取「影响最大」的采样点：距离减去它的路面半宽最小的那个；
        # 高差超过 1.25 级台阶的不算（坡道只跨一级，别把下面几级台阶的顶点拉上来）
        dzm = np.abs(S[cand, 2][None, :] - P[:, 2][:, None])
        score = np.where(dzm <= 1.25 * cam.BENCH, dist - C[cand][None, :], np.inf)
        j = np.argmin(score, axis=1)
        dmin = dist[np.arange(len(idx)), j]
        core = C[cand][j]
        zr = S[cand[j], 2]
        z0 = P[:, 2]
        reach = core + np.minimum(BATTER * np.abs(zr - z0), MAX_SIDE)
        w = np.where(dmin <= core, 0.0, _smooth((dmin - core) / np.maximum(reach - core, 1e-3)))
        hit = np.isfinite(score[np.arange(len(idx)), j]) & (dmin < reach)
        if not hit.any():
            continue
        znew = zr + (z0 - zr) * w
        V[idx[hit], 2] = znew[hit]
        changed += int(hit.sum())
    return V, changed

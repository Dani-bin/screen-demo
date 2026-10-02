/*
 * 坡屋顶民居（由 parts.js 转出，外部统一从 parts.js 导入）
 * ----------------------------------------------------------
 * 双坡屋顶只能盖矩形。OSM 轮廓常是 L 形、凹形，直接拿最小外接矩形盖顶，
 * 屋顶会悬在轮廓缺口上空、墙和屋顶对不上。做法：
 *   1. 充满度 fill = 轮廓面积 / 外接矩形面积 ≥ 0.85：墙按轮廓挤出，屋顶盖外接矩形；
 *   2. 否则用一条垂直于外接矩形某条轴、过轮廓某个顶点的直线切成两半（半平面裁剪，
 *      取两半里较差一半充满度最高的切法，L / T / U 形因此在凹角处被切成规整矩形），
 *      每半再按 1 判断，最多切两层（至多 4 块）；每块各自一套墙 + 屋顶，屋顶相交处自然形成组合屋面；
 *   3. 两层后仍有不达标的块：放弃切分，墙体改用整个外接矩形，保证墙顶与屋檐严丝合缝。
 * 充满度达标但不是矩形的块，墙体仍按轮廓挤出：轮廓内凹处墙顶低于屋面，形成檐廊式的内凹，
 * 墙与屋顶只在外接矩形边上严丝合缝。
 */
import { extrudeBuilding } from "../../buildings.js"
import { frame } from "./builder.js"
import {
  clipHalfPlane,
  minAreaRect,
  polygonArea,
  rectPolygon
} from "./footprint.js"
import { gableRidge, gableRoof, gableWalls } from "./roofs.js"
import { L, addTop, eaveDrop } from "./common.js"

// 充满度阈值：低于它的轮廓不直接盖双坡顶
const FILL_MIN = 0.85
// 最多切分层数
const MAX_DEPTH = 2

const DEG = Math.PI / 180

/** 充满度：轮廓面积 / 外接矩形面积 */
function fillOf(points, rect) {
  const a = rect.w * rect.d
  return a > 0 ? polygonArea(points) / a : 0
}

/**
 * 找最佳切线：候选线垂直于外接矩形的两条轴之一，过轮廓的某个顶点（或长边中点）；
 * 取「两半里较差那一半的充满度」最高的一条。L / T / U 形轮廓由此在凹角处被切成规整矩形。
 * @returns {Array|null} 两半多边形 [A, B]；没有可行切线返回 null
 */
function bestCut(points, rect) {
  const b = rect.bearing * DEG
  const axes = [
    [Math.sin(b), -Math.cos(b)], // 长边方向
    [Math.cos(b), Math.sin(b)] // 短边方向
  ]
  let best = null
  axes.forEach((n, ai) => {
    const proj = points.map(([x, z]) => x * n[0] + z * n[1])
    const lo = Math.min(...proj)
    const hi = Math.max(...proj)
    const cands = new Set(proj.map((c) => Math.round(c * 100) / 100))
    if (ai === 0) cands.add((lo + hi) / 2)
    for (const c of cands) {
      // 离两端太近的切线切出来的是细条，跳过
      if (c < lo + 0.5 || c > hi - 0.5) continue
      const o = [n[0] * c, n[1] * c]
      const A = clipHalfPlane(points, o, n)
      const B = clipHalfPlane(points, o, [-n[0], -n[1]])
      if (A.length < 3 || B.length < 3) continue
      if (polygonArea(A) < 0.5 || polygonArea(B) < 0.5) continue
      const score = Math.min(
        fillOf(A, minAreaRect(A)),
        fillOf(B, minAreaRect(B))
      )
      if (!best || score > best.score + 1e-9) best = { score, halves: [A, B] }
    }
  })
  return best ? best.halves : null
}

/** 递归切分（最多 MAX_DEPTH 层）；返回达标的块 [{ points, rect }]，做不到返回 null */
function split(points, depth) {
  const rect = minAreaRect(points)
  if (fillOf(points, rect) >= FILL_MIN) return [{ points, rect }]
  if (depth >= MAX_DEPTH) return null
  const halves = bestCut(points, rect)
  if (!halves) return null
  const out = []
  for (const h of halves) {
    const sub = split(h, depth + 1)
    if (!sub) return null
    out.push(...sub)
  }
  return out
}

/**
 * 把轮廓分成若干块「墙轮廓 + 屋顶矩形」（不建几何体，便于测试与规划）。
 * @param {Array<[number, number]>} points 世界坐标轮廓
 * @param {object} [rect] 指定外接矩形（minAreaRect 同构对象）时不再切分：
 *   充满度达标用原轮廓做墙，否则墙用该矩形
 * @returns {Array<{ points: Array, rect: object }>}
 */
export function housePieces(points, rect) {
  if (rect) {
    const walls =
      fillOf(points, rect) >= FILL_MIN
        ? points
        : rectPolygon(rect.cx, rect.cz, rect.w, rect.d, rect.bearing)
    return [{ points: walls, rect }]
  }
  const pieces = split(points, 0)
  if (pieces) return pieces
  const r = minAreaRect(points)
  return [{ points: rectPolygon(r.cx, r.cz, r.w, r.d, r.bearing), rect: r }]
}

/**
 * 屋脊方向：缺省沿矩形长边；给了 ridgeBearing 时取矩形两条轴里离它更近的那条
 * （屋顶必须与矩形对齐，所以只能二选一，不会按任意角度斜放）。
 * @returns {{ w: number, d: number, bearing: number }} 沿屋脊的长度、进深与屋脊方位角
 */
function ridgeAxis(rect, ridgeBearing) {
  if (ridgeBearing === undefined || ridgeBearing === null) {
    return { w: rect.w, d: rect.d, bearing: rect.bearing }
  }
  const diff = Math.abs(((ridgeBearing - rect.bearing) % 180) + 180) % 180
  const off = Math.min(diff, 180 - diff)
  if (off <= 45) return { w: rect.w, d: rect.d, bearing: rect.bearing }
  return { w: rect.d, d: rect.w, bearing: rect.bearing + 90 }
}

/**
 * 坡屋顶民居：墙体按轮廓（或切分后的块 / 外接矩形，见文件头）挤出到 eaveH
 * （剔除底面，同 buildings.js），每块盖一个 gableRoof(沿屋脊长, 进深, ridgeH, { overhang })，
 * 屋面在墙线处正好等于檐口高度；两端山墙用墙色。footprintPoints 为世界坐标（不需要 parent）。
 * @param {object} opts
 *   { eaveH, ridgeH（屋脊高出檐口的高度）, overhang = 0.6, wallColor = plaster,
 *     roofColor = roof, ridgeColor（可选，正脊色；缺省灰瓦配专用脊色、其他瓦色同屋面色）,
 *     y = 0, rect（可选，指定外接矩形，不再切分）,
 *     ridgeBearing（可选，屋脊方位角，吸附到矩形较近的轴） }
 * @returns {{ rects: object[], top: number }|null} 各块的屋顶矩形与屋脊最高点；轮廓无效返回 null
 */
export function addPitchedHouse(b, footprintPoints, opts) {
  const { eaveH, ridgeH, overhang = 0.6, y = 0 } = opts
  if (!footprintPoints || footprintPoints.length < 3 || !(eaveH > 0))
    return null
  const wallColor = opts.wallColor ?? L.plaster
  const roofColor = opts.roofColor ?? L.roof
  const ridgeColor =
    opts.ridgeColor ?? (roofColor === L.roof ? L.roofRidge : roofColor)
  const go = { overhang, ridges: false, gables: false }
  const rects = []
  let top = -Infinity
  for (const piece of housePieces(footprintPoints, opts.rect)) {
    const walls = extrudeBuilding({ p: piece.points, h: eaveH })
    if (!walls) continue
    if (y) walls.translate(0, y, 0)
    b.add(walls, wallColor)
    const { rect } = piece
    const ax = ridgeAxis(rect, opts.ridgeBearing)
    // 下沉量取 0：屋面恰好在墙线处等于檐口高度
    const ry = y + eaveH - eaveDrop(ax.d / 2, overhang, ridgeH, 1.3, 0)
    // 屋脊沿局部 X；frame 的局部 +X 指向 bearing + 90°，故传 bearing - 90
    const m = frame(rect.cx, ry, rect.cz, ax.bearing - 90)
    b.add(gableRoof(ax.w, ax.d, ridgeH, go), roofColor, m)
    b.add(gableWalls(ax.w, ax.d, ridgeH, go), wallColor, m)
    top = Math.max(
      top,
      addTop(b, gableRidge(ax.w, ax.d, ridgeH, go), ridgeColor, m, ry)
    )
    rects.push(rect)
  }
  return rects.length ? { rects, top } : null
}

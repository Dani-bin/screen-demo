/*
 * 轮廓工具：按名称查楼、最小外接矩形、替换区
 * ----------------------------------------------------------
 * 景点模型的位置、朝向、尺寸都从 OSM 真实轮廓里取：
 * 按名称找到楼 → 最小面积外接矩形 → 得到中心、长宽与长边方位角。
 * 点坐标均为 [x, z]（X 向东、Z 向南）；方位角为相对正北的顺时针角度（度）。
 */
import { pointInPolygon, polygonBounds, polygonCenter } from "../../utils.js"
import { frame } from "./builder.js"

const DEG = Math.PI / 180

/**
 * 按名称查楼：先精确匹配，再「名称包含 name」匹配。
 * @param {Array<{n?: string}>} buildings 几何数据里的楼栋数组
 * @returns {number} 楼栋索引，找不到返回 -1
 */
export function findBuilding(buildings, name) {
  const exact = buildings.findIndex((b) => b.n === name)
  if (exact >= 0) return exact
  return buildings.findIndex((b) => b.n && b.n.includes(name))
}

/** 点集的凸包（Andrew 单调链），返回逆时针顺序的顶点，去掉共线点 */
function convexHull(points) {
  const pts = points
    .map(([x, z]) => [x, z])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower = []
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    )
      lower.pop()
    lower.push(p)
  }
  const upper = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    )
      upper.pop()
    upper.push(p)
  }
  upper.pop()
  lower.pop()
  return lower.concat(upper)
}

/**
 * 最小面积外接矩形（凸包 + 旋转卡壳：最优矩形必有一条边与凸包某条边共线，
 * 逐条凸包边作为矩形方向求投影范围，取面积最小者）。
 * @param {Array<[number, number]>} points 轮廓点
 * @returns {{ cx: number, cz: number, w: number, d: number, bearing: number }}
 *   w ≥ d，w 为长边；bearing 为长边方向的方位角，归一到 [0, 180)
 */
export function minAreaRect(points) {
  const hull = convexHull(points)
  if (hull.length < 3) {
    // 退化输入（点或线段）：按包围盒处理
    const b = polygonBounds(points)
    const w = b.maxX - b.minX
    const d = b.maxZ - b.minZ
    return {
      cx: (b.minX + b.maxX) / 2,
      cz: (b.minZ + b.maxZ) / 2,
      w: Math.max(w, d),
      d: Math.min(w, d),
      bearing: w >= d ? 90 : 0
    }
  }
  let best = null
  for (let i = 0; i < hull.length; i++) {
    const [x1, z1] = hull[i]
    const [x2, z2] = hull[(i + 1) % hull.length]
    const len = Math.hypot(x2 - x1, z2 - z1)
    if (len < 1e-9) continue
    // u 沿当前凸包边，v 垂直于它
    const ux = (x2 - x1) / len
    const uz = (z2 - z1) / len
    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    for (const [x, z] of hull) {
      const pu = x * ux + z * uz
      const pv = -x * uz + z * ux
      if (pu < minU) minU = pu
      if (pu > maxU) maxU = pu
      if (pv < minV) minV = pv
      if (pv > maxV) maxV = pv
    }
    const area = (maxU - minU) * (maxV - minV)
    if (!best || area < best.area) {
      best = { area, ux, uz, minU, maxU, minV, maxV }
    }
  }
  const { ux, uz, minU, maxU, minV, maxV } = best
  const mu = (minU + maxU) / 2
  const mv = (minV + maxV) / 2
  // (u, v) → (x, z)：x = u·ux − v·uz，z = u·uz + v·ux
  const cx = mu * ux - mv * uz
  const cz = mu * uz + mv * ux
  const lu = maxU - minU
  const lv = maxV - minV
  // 长边方向向量：lu 更长取 u，否则取 v = (-uz, ux)
  const [lx, lz] = lu >= lv ? [ux, uz] : [-uz, ux]
  // 方位角：北为 -Z，东为 +X → bearing = atan2(dx, -dz)
  let bearing = Math.atan2(lx, -lz) / DEG
  bearing = ((bearing % 180) + 180) % 180
  if (bearing >= 180 - 1e-9) bearing = 0
  return { cx, cz, w: Math.max(lu, lv), d: Math.min(lu, lv), bearing }
}

/**
 * 由 minAreaRect 的结果建景点坐标系：局部 X 沿长边（殿堂、悬山屋脊方向），
 * 局部 +Z（正面）取两条长边法向中更接近 frontBearing 的那一个。
 * 于是 addHall(b, rectFrame(r, 0, 218), { w: r.w, d: r.d }) 即按真实轮廓、朝西南建殿。
 * @param {{ cx, cz, bearing }} rect minAreaRect 的结果
 * @param {number} [y=0] 坐标系原点高度
 * @param {number} [frontBearing=180] 期望的正面朝向（方位角，默认朝南）
 * @returns {Matrix4}
 */
export function rectFrame(rect, y = 0, frontBearing = 180) {
  // frame(..., b) 的局部 +X 指向 b + 90°、+Z 指向 b + 180°；
  // 要让 +X 沿长边，b 取 rect.bearing ± 90，再按正面朝向二选一
  const diff = (a, c) => Math.abs(((a - c + 540) % 360) - 180)
  const b1 = rect.bearing - 90
  const b2 = rect.bearing + 90
  const b =
    diff(b1 + 180, frontBearing) <= diff(b2 + 180, frontBearing) ? b1 : b2
  return frame(rect.cx, y, rect.cz, b)
}

/**
 * 以 (cx, cz) 为中心、长边 w 沿 bearing 方向、短边 d 的矩形，
 * 返回 4 点多边形 [[x, z], ...]（从上往下看、北在上时为逆时针），用作替换区。
 */
export function rectPolygon(cx, cz, w, d, bearing) {
  const b = bearing * DEG
  // u：长边方向（bearing），v：u 顺时针转 90°
  const ux = Math.sin(b) * (w / 2)
  const uz = -Math.cos(b) * (w / 2)
  const vx = Math.cos(b) * (d / 2)
  const vz = Math.sin(b) * (d / 2)
  return [
    [cx + ux + vx, cz + uz + vz],
    [cx + ux - vx, cz + uz - vz],
    [cx - ux - vx, cz - uz - vz],
    [cx - ux + vx, cz - uz + vz]
  ]
}

/** 圆形替换区：以 (cx, cz) 为中心、半径 r 的正 n 边形 */
export function circlePolygon(cx, cz, r, n = 16) {
  return Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2
    return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]
  })
}

/**
 * 找出顶点平均点落在任一区域内的楼栋。
 * @param {Array<{p: Array}>} buildings
 * @param {Array<Array<[number, number]>>} zones 区域多边形数组
 * @returns {Set<number>} 楼栋索引集合
 */
export function buildingsInZones(buildings, zones) {
  const out = new Set()
  const valid = zones.filter((z) => z && z.length >= 3)
  if (!valid.length) return out
  // 先用区域包围盒粗筛，避免每栋楼都做多边形判断
  const boxes = valid.map((z) => ({ z, b: polygonBounds(z) }))
  buildings.forEach((bd, i) => {
    if (!bd.p || !bd.p.length) return
    const [x, z] = polygonCenter(bd.p)
    for (const { z: poly, b } of boxes) {
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue
      if (pointInPolygon(x, z, poly)) {
        out.add(i)
        break
      }
    }
  })
  return out
}

/** 轮廓顶点平均点 [x, z]（即 utils.js 的 polygonCenter） */
export function centroid(points) {
  return polygonCenter(points)
}

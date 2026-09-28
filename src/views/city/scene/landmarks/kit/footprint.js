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
 * 按名称查全部同名楼：先取所有精确匹配；一个都没有时，取所有「名称包含 name」的楼。
 * @returns {number[]} 楼栋索引数组（可能为空）
 */
export function findBuildings(buildings, name) {
  const exact = []
  const partial = []
  buildings.forEach((b, i) => {
    if (!b.n) return
    if (b.n === name) exact.push(i)
    else if (b.n.includes(name)) partial.push(i)
  })
  return exact.length ? exact : partial
}

/**
 * 按名称查楼。数据里常有重名（如文殊院与大慈寺都有「大雄宝殿」），
 * 传 near 时在候选里取顶点平均点离 near 最近、且不超过 maxDist 的那栋。
 * 不传 near 时：先精确匹配，再「包含」匹配，取第一栋。
 * @param {Array<{n?: string, p?: Array}>} buildings
 * @param {string} name
 * @param {{ near?: [number, number], maxDist?: number }} [opts]
 * @returns {number} 楼栋索引，找不到（或最近的也超出 maxDist）返回 -1
 */
export function findBuilding(
  buildings,
  name,
  { near, maxDist = Infinity } = {}
) {
  const list = findBuildings(buildings, name)
  if (!near) return list.length ? list[0] : -1
  let best = -1
  let bestD = maxDist
  for (const i of list) {
    const p = buildings[i].p
    if (!p || !p.length) continue
    const [x, z] = polygonCenter(p)
    const dist = Math.hypot(x - near[0], z - near[1])
    if (dist <= bestD) {
      best = i
      bestD = dist
    }
  }
  return best
}

/** 多边形面积（鞋带公式，取绝对值，与顶点绕向无关） */
export function polygonArea(points) {
  let a = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += points[j][0] * points[i][1] - points[i][0] * points[j][1]
  }
  return Math.abs(a) / 2
}

/**
 * 用半平面裁剪多边形（Sutherland–Hodgman）：保留满足 (p - o)·n ≥ 0 的部分。
 * 凹多边形被切成几块时结果以零宽边相连，面积仍然正确；沿分界线折返的零宽尖刺会被去掉。
 * @param {Array<[number, number]>} points
 * @param {[number, number]} o 分界线上一点
 * @param {[number, number]} n 分界线法向（指向保留一侧）
 * @returns {Array<[number, number]>} 裁剪后的多边形（可能少于 3 点）
 */
export function clipHalfPlane(points, o, n) {
  const side = ([x, z]) => (x - o[0]) * n[0] + (z - o[1]) * n[1]
  const out = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const sa = side(a)
    const sb = side(b)
    if (sa >= 0) out.push(a)
    // 边跨过分界线：补上交点
    if (sa >= 0 !== sb >= 0) {
      const t = sa / (sa - sb)
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  return removeSpikes(out)
}

/**
 * 去掉重复点与「原路折返」的共线点（零宽尖刺）。
 * 落在分界线上的轮廓边会同时留在两半里，形成沿分界线来回的零宽边，
 * 不去掉会把外接矩形撑大。
 */
function removeSpikes(points) {
  const pts = points.slice()
  let changed = true
  while (changed && pts.length >= 3) {
    changed = false
    for (let i = 0; i < pts.length && pts.length >= 3; i++) {
      const p = pts[(i + pts.length - 1) % pts.length]
      const c = pts[i]
      const n = pts[(i + 1) % pts.length]
      const ax = c[0] - p[0]
      const az = c[1] - p[1]
      const bx = n[0] - c[0]
      const bz = n[1] - c[1]
      const dup = Math.abs(ax) < 1e-9 && Math.abs(az) < 1e-9
      const cross = ax * bz - az * bx
      // 共线且前后两段方向相反 = 折返
      const back = Math.abs(cross) < 1e-6 && ax * bx + az * bz < 0
      if (dup || back) {
        pts.splice(i, 1)
        changed = true
        i--
      }
    }
  }
  return pts
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

/**
 * 点 (px, pz) 到线段 a-b（[x, z]）的最短距离；退化线段（两端重合）取到端点的距离
 */
export function distToSegment(px, pz, a, b) {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len2 = dx * dx + dz * dz
  const t =
    len2 > 0
      ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / len2))
      : 0
  return Math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz)
}

/**
 * 两个方位角之差的绝对值（度）。
 * period = 360（默认）时按方向比较，结果 0～180；
 * period = 180 时按轴线比较（长边方位 0～180 循环），结果 0～90。
 */
export function bearingDiff(a, b, period = 360) {
  const d = (((a - b) % period) + period) % period
  return Math.min(d, period - d)
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

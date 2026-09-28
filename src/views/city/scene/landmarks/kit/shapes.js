/*
 * 基础几何体
 * ----------------------------------------------------------
 * 统一约定：底面在 y = 0、水平居中于原点，返回非索引 BufferGeometry（含法线），
 * 直接交给 ColorBuilder.add(geometry, color, matrix)。
 *
 * 正多边形朝向约定（全 kit 通用）：第 k 个顶点位于
 *   θ = π/n + k·2π/n，x = r·sin θ，z = r·cos θ
 * 即「有一条边正对 +Z（正面）」，与 CylinderGeometry(thetaStart = π/n) 一致。
 * 六边形时 ±X 方向是顶点、±Z 方向是边。
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  SphereGeometry
} from "three"

/**
 * 正 n 边形第 k 个顶点 [x, z]（外接圆半径 r，朝向见文件头约定）
 */
export function polygonVertex(sides, r, k) {
  const a = Math.PI / sides + (k * 2 * Math.PI) / sides
  return [r * Math.sin(a), r * Math.cos(a)]
}

/** 由平铺的三角形坐标数组建几何体，法线按面计算（棱角分明） */
export function fromTriangles(positions) {
  const g = new BufferGeometry()
  g.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(positions), 3)
  )
  g.computeVertexNormals()
  return g
}

/**
 * 剔除法线朝下的三角形（贴地的底面永远看不见）。
 * 输入须带法线；返回新的非索引几何体并释放原件。
 */
export function dropBottom(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry
  const p = g.attributes.position.array
  const n = g.attributes.normal.array
  const pos = []
  const nor = []
  for (let k = 0; k < p.length; k += 9) {
    // 三个顶点法线都朝下才算底面，避免误删斜面
    if (n[k + 1] < -0.5 && n[k + 4] < -0.5 && n[k + 7] < -0.5) continue
    for (let j = 0; j < 9; j++) {
      pos.push(p[k + j])
      nor.push(n[k + j])
    }
  }
  if (g !== geometry) g.dispose()
  geometry.dispose()
  const out = new BufferGeometry()
  out.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3))
  out.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3))
  return out
}

/**
 * 长方体：X 向宽 w、高 h、Z 向深 d，底在 y = 0。
 * @param {{ bottom?: boolean }} [opts] bottom 为 false（默认）时去掉底面
 */
export function box(w, h, d, { bottom = false } = {}) {
  const g = new BoxGeometry(w, h, d)
  g.translate(0, h / 2, 0)
  if (bottom) return g.toNonIndexed()
  return dropBottom(g)
}

/**
 * 正 n 棱柱 / 棱台（外接圆半径 rBottom → rTop），底在 y = 0，朝向见文件头约定。
 * 侧面为平面法线（棱角分明），适合台基、塔身。
 * @param {{ top?: boolean, bottom?: boolean }} [opts] 是否封顶面 / 底面（默认有顶无底）
 */
export function prism(sides, rBottom, rTop, h, opts = {}) {
  const { top = true, bottom = false } = opts
  const pos = []
  for (let k = 0; k < sides; k++) {
    const [x0, z0] = polygonVertex(sides, rBottom, k)
    const [x1, z1] = polygonVertex(sides, rBottom, k + 1)
    const [u0, w0] = polygonVertex(sides, rTop, k)
    const [u1, w1] = polygonVertex(sides, rTop, k + 1)
    // 侧面：k 增大方向在「从上往下看、北在上」时为逆时针（+Z 转向 +X，见约定）
    pos.push(x0, 0, z0, u1, h, w1, u0, h, w0)
    pos.push(x0, 0, z0, x1, 0, z1, u1, h, w1)
    if (top && rTop > 0) pos.push(0, h, 0, u0, h, w0, u1, h, w1)
    if (bottom) pos.push(0, 0, 0, x1, 0, z1, x0, 0, z0)
  }
  return fromTriangles(pos)
}

/**
 * 圆柱（平滑法线，看起来是圆的），底在 y = 0。用于柱子、柱础等。
 * @param {{ segments?: number, caps?: boolean }} [opts] caps 为 true 时封顶（不封底）
 */
export function cylinder(rBottom, rTop, h, opts = {}) {
  const { segments = 8, caps = false } = opts
  const g = new CylinderGeometry(rTop, rBottom, h, segments, 1, !caps)
  g.translate(0, h / 2, 0)
  return caps ? dropBottom(g) : g.toNonIndexed()
}

/**
 * 球（平滑法线），底在 y = 0，球心在 (0, r, 0)。
 * 配合 local() 的缩放参数可做椭球（灯笼、莲花瓣等）。
 */
export function sphere(r, widthSegments = 10, heightSegments = 7) {
  const g = new SphereGeometry(r, widthSegments, heightSegments)
  g.translate(0, r, 0)
  const out = g.toNonIndexed()
  g.dispose()
  return out
}

/**
 * 沿三维折线扫出一根方截面的细条（屋脊、扶手等）：顶面 + 两个侧面，无底面。
 * 截面宽 w、高 h，条身从折线向上长出 h（底边贴着折线）。
 * @param {Array<[number, number, number]>} points 折线顶点 [x, y, z]，至少 2 个
 * @param {{ sink?: number }} [opts] sink 为底边下沉量（嵌进屋面，避免悬空缝隙）
 */
export function sweepBar(points, w, h, { sink = 0 } = {}) {
  const pos = []
  const n = points.length
  // 每个折点的水平侧向量（取相邻段水平方向的平均，保证转折处连续）
  const sides = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)]
    const b = points[Math.min(n - 1, i + 1)]
    let dx = b[0] - a[0]
    let dz = b[2] - a[2]
    const len = Math.hypot(dx, dz) || 1
    dx /= len
    dz /= len
    // 水平切向顺时针转 90°
    return [-dz * (w / 2), dx * (w / 2)]
  })
  const corner = (i, side, up) => {
    const [x, y, z] = points[i]
    const [sx, sz] = sides[i]
    return [x + sx * side, y + (up ? h : -sink), z + sz * side]
  }
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d)
  for (let i = 0; i < n - 1; i++) {
    // 顶面
    quad(
      corner(i, 1, 1),
      corner(i + 1, 1, 1),
      corner(i + 1, -1, 1),
      corner(i, -1, 1)
    )
    // 两个侧面
    quad(
      corner(i, 1, 0),
      corner(i + 1, 1, 0),
      corner(i + 1, 1, 1),
      corner(i, 1, 1)
    )
    quad(
      corner(i, -1, 1),
      corner(i + 1, -1, 1),
      corner(i + 1, -1, 0),
      corner(i, -1, 0)
    )
  }
  // 两端封口
  const cap = (i) =>
    quad(corner(i, -1, 0), corner(i, 1, 0), corner(i, 1, 1), corner(i, -1, 1))
  cap(0)
  cap(n - 1)
  return fromTriangles(pos)
}

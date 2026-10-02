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
  ExtrudeGeometry,
  Path,
  RingGeometry,
  Shape,
  SphereGeometry,
  Vector2
} from "three"
import { signedArea2 } from "./footprint.js"

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
 * 平面多边形竖直挤出成 y0～y1 的实体（可凹、可带洞），去掉底面。
 * 点坐标为 [x, z]（与传入的坐标系一致，世界坐标或局部坐标均可）。
 * Shape 的 (x, y) 对应 (x, z)：绕 X 轴转 +90° 后挤出方向朝 -Y，再上移到 y1
 * （旋转不含镜像，法线仍朝外）。
 * @param {Array<[number, number]>} outer 外轮廓
 * @param {Array<Array<[number, number]>>} holes 洞（可为空数组）
 * @param {number} y0 底面高度
 * @param {number} y1 顶面高度
 */
export function extrudePolygon(outer, holes, y0, y1) {
  const shape = new Shape(outer.map(([x, z]) => new Vector2(x, z)))
  for (const h of holes) {
    shape.holes.push(new Path(h.map(([x, z]) => new Vector2(x, z))))
  }
  const g = new ExtrudeGeometry(shape, {
    depth: y1 - y0,
    bevelEnabled: false,
    curveSegments: 1
  })
  g.rotateX(Math.PI / 2)
  g.translate(0, y1, 0)
  return dropBottom(g)
}

/**
 * 竖直侧墙：沿闭合轮廓每条边一块 y0～y1 的竖直四边形（每边 2 个三角形，无顶面、底面）。
 * 先按带符号面积统一绕向（> 0 即 x→z 逆时针时反转），使每条边 a→b 的左手法向 (−dz, dx) 朝外，
 * 法线朝外；inward 为真时再整体反转，法线朝里（女儿墙内侧、围合院落的内墙）。
 * @param {Array<[number, number]>} poly 轮廓 [x, z]，不重复首点，绕向任意
 * @param {number} y0 墙底高度
 * @param {number} y1 墙顶高度
 * @param {boolean} [inward=false] 法线朝里
 */
export function sideWalls(poly, y0, y1, inward = false) {
  const p = signedArea2(poly) > 0 ? poly.slice().reverse() : poly.slice()
  if (inward) p.reverse()
  const pos = []
  for (let i = 0; i < p.length; i++) {
    const [ax, az] = p[i]
    const [bx, bz] = p[(i + 1) % p.length]
    pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz)
    pos.push(ax, y0, az, bx, y1, bz, ax, y1, az)
  }
  return fromTriangles(pos)
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
 * 水平圆环面，y = 0。down 为假时法线朝上（顶面、水面），为真时朝下（悬空环板的底面）。
 * 景点主体的阴影一般只画背光面，悬在空中的底面必须朝下，否则挡不住阳光。
 * 顶点方位角：RingGeometry 第 k 个点转到水平后在 (r cos θ, −r sin θ)，θ = 2πk / n，与 footprint.js 的
 * circlePolygon 是同一组方位角；本文件的 cylinder 第 k 个点在 (r sin θ, r cos θ)，方位角差 π/2，
 * 只有段数 n 是 4 的倍数时三者才落在同一组方位角上（池壁、水面、挖口逐点重合要靠这一点）
 */
export function annulus(rIn, rOut, segments = 32, down = false) {
  const g = new RingGeometry(rIn, rOut, segments, 1)
  g.rotateX(down ? Math.PI / 2 : -Math.PI / 2)
  return g
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
 * 沿三维折线扫出一根方截面的细条（屋脊、扶手等）：顶面 + 两个侧面，默认无底面。
 * 截面宽 w、高 h，条身从折线向上长出 h（底边贴着折线）。
 * @param {Array<[number, number, number]>} points 折线顶点 [x, y, z]，至少 2 个
 * @param {{ sink?: number, bottom?: boolean }} [opts] sink 为底边下沉量（嵌进屋面，避免悬空缝隙）；
 *   bottom 为真时补底面（悬空的细条，如鱼眼雕塑的金龙飘带，低机位看得到下沿）。
 *   不传 bottom 时几何与加这个选项之前逐位相同
 */
export function sweepBar(points, w, h, { sink = 0, bottom = false } = {}) {
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
    // 底面（可选）：与顶面反向的绕序，法线朝下
    if (bottom) {
      quad(
        corner(i, -1, 0),
        corner(i + 1, -1, 0),
        corner(i + 1, 1, 0),
        corner(i, 1, 0)
      )
    }
  }
  // 两端封口
  const cap = (i) =>
    quad(corner(i, -1, 0), corner(i, 1, 0), corner(i, 1, 1), corner(i, -1, 1))
  cap(0)
  cap(n - 1)
  return fromTriangles(pos)
}

/**
 * 带斜接的路面带：沿折线 pts（[x, z]）铺宽 w、从 y0 到 y1 的实心带（顶面 + 两侧面 + 封口）。
 * 折点处两侧边线按斜接（miter）求交，急弯外角不缺块、内角不重叠（sweepBar 在折点只取
 * 相邻两段的平均法向，90° 弯处路面会扭成窄条）；斜接长度限制在 2.5 倍半宽以内。
 * 端面封口朝外（sweepBar 的封口朝内，在单面材质下会被剔除），可直接进单面（FrontSide）地面批。
 * @param {Array<[number, number]>} pts 折线顶点 [x, z]，至少 2 个
 * @param {number} w 路面宽
 * @param {number} y0 底面高度
 * @param {number} y1 顶面高度
 * @param {{ closed?: boolean }} [opts] closed 为 true 时按环形闭合（默认 false）：
 *   末点与首点之间补一段，接缝处同样斜接，没有端面封口；pts 不要重复首点
 *   （末点与首点重合时自动去掉末点）
 */
export function ribbon(pts, w, y0, y1, { closed = false } = {}) {
  // 闭合时去掉与首点重合的末点：否则会多出一段零长度的线段，接缝处的法向变成 0
  if (
    closed &&
    pts.length > 2 &&
    pts[0][0] === pts[pts.length - 1][0] &&
    pts[0][1] === pts[pts.length - 1][1]
  ) {
    pts = pts.slice(0, -1)
  }
  const n = pts.length
  const segCount = closed ? n : n - 1
  // 逐段左手侧单位法向 (−dz, dx)；开放折线的最后一个点没有「下一段」，由下面的 min 夹取
  const seg = []
  for (let i = 0; i < segCount; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const l = Math.hypot(dx, dz) || 1
    seg.push([-dz / l, dx / l])
  }
  const side = pts.map((p, i) => {
    // 折点前后两段：闭合时首尾相接，开放时端点只有一段（取同一段）
    const a = closed ? seg[(i - 1 + n) % n] : seg[Math.max(0, i - 1)]
    const c = closed ? seg[i] : seg[Math.min(n - 2, i)]
    let mx = a[0] + c[0]
    let mz = a[1] + c[1]
    const ml = Math.hypot(mx, mz) || 1
    mx /= ml
    mz /= ml
    // 斜接长度 = 半宽 / cos(半转角)
    const k = Math.min(2.5, 1 / Math.max(0.4, mx * c[0] + mz * c[1]))
    return [mx * (w / 2) * k, mz * (w / 2) * k]
  })
  const L0 = pts.map(([x, z], i) => [x + side[i][0], z + side[i][1]])
  const R0 = pts.map(([x, z], i) => [x - side[i][0], z - side[i][1]])
  const pos = []
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d)
  const v3 = ([x, z], y) => [x, y, z]
  for (let i = 0; i < segCount; i++) {
    const j = (i + 1) % n
    quad(v3(L0[i], y1), v3(L0[j], y1), v3(R0[j], y1), v3(R0[i], y1))
    quad(v3(L0[i], y0), v3(L0[j], y0), v3(L0[j], y1), v3(L0[i], y1))
    quad(v3(R0[i], y1), v3(R0[j], y1), v3(R0[j], y0), v3(R0[i], y0))
  }
  if (!closed) {
    quad(v3(R0[0], y0), v3(L0[0], y0), v3(L0[0], y1), v3(R0[0], y1))
    quad(
      v3(L0[n - 1], y0),
      v3(R0[n - 1], y0),
      v3(R0[n - 1], y1),
      v3(L0[n - 1], y1)
    )
  }
  return fromTriangles(pos)
}

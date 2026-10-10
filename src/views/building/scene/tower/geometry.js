/*
 * 楼宇级 · 塔楼几何工具
 * ----------------------------------------------------------
 * 平面全部在 three.js 的 xz 平面上（x 东、z 南），多边形为 [[x, z], …]，形心在原点。
 * 竖向尺度（层高）见 TowerShape：塔楼是按「示意比例」压低的，不是真实 218 m（文件头说明见 BuildingScene.js）。
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  ShapeUtils,
  Vector2
} from "three"

/** 多边形面积（带符号，xz 平面上逆时针为负——只用来统一绕向） */
export function signedArea(poly) {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i]
    const [x1, z1] = poly[(i + 1) % poly.length]
    a += x0 * z1 - x1 * z0
  }
  return a / 2
}

/** 点在多边形内（射线法） */
export function inPoly(x, z, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
      inside = !inside
  }
  return inside
}

/** 多边形按「投影 ≤ limit」的半平面裁剪（dir 为单位向量），Sutherland–Hodgman */
export function clipHalfPlane(poly, dir, limit) {
  const f = ([x, z]) => x * dir[0] + z * dir[1] - limit
  const out = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const fa = f(a)
    const fb = f(b)
    if (fa <= 0) out.push(a)
    if (fa <= 0 !== fb <= 0) {
      const t = fa / (fa - fb)
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  return out
}

/** 沿形心方向内收 d 米（椭圆、卵形平面够用） */
export function insetPoly(poly, d) {
  return poly.map(([x, z]) => {
    const r = Math.hypot(x, z) || 1
    const k = Math.max(0, (r - d) / r)
    return [x * k, z * k]
  })
}

/** 主轴角度（协方差最大特征向量与 +x 的夹角，弧度） */
export function majorAxisAngle(poly) {
  let sxx = 0
  let szz = 0
  let sxz = 0
  for (const [x, z] of poly) {
    sxx += x * x
    szz += z * z
    sxz += x * z
  }
  return 0.5 * Math.atan2(2 * sxz, sxx - szz)
}

/** 多边形三角化 → 索引（ShapeUtils 要求逆时针，绕向不对时自动翻转） */
function triangulate(poly) {
  const pts = poly.map(([x, z]) => new Vector2(x, z))
  const ccw = ShapeUtils.isClockWise(pts)
  const src = ccw ? pts.slice().reverse() : pts
  const tris = ShapeUtils.triangulateShape(src, [])
  // 翻转过的话把下标映射回原顺序
  return ccw ? tris.map((t) => t.map((i) => poly.length - 1 - i)) : tris
}

/**
 * 实心棱柱：底面 y0、顶面 y1（可以是每个顶点各自的高度数组），含上下盖与侧面。
 * 只输出 position（法线由调用方 computeVertexNormals，侧面与盖子不共用顶点，棱角是硬的）
 */
export function prismGeometry(poly, y0, y1) {
  const n = poly.length
  const tops = Array.isArray(y1) ? y1 : poly.map(() => y1)
  const pos = []
  const tris = triangulate(poly)
  // 顶面：法线朝上（从上往下看逆时针）
  for (const t of tris)
    for (const i of [t[0], t[2], t[1]])
      pos.push(poly[i][0], tops[i], poly[i][1])
  for (const t of tris) for (const i of t) pos.push(poly[i][0], y0, poly[i][1])
  const flip = signedArea(poly) > 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const a = poly[i]
    const b = poly[j]
    const quad = [
      [a[0], y0, a[1]],
      [b[0], y0, b[1]],
      [b[0], tops[j], b[1]],
      [a[0], tops[i], a[1]]
    ]
    const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]
    for (const k of order) pos.push(...quad[k])
  }
  const g = new BufferGeometry()
  g.setAttribute("position", new Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

/** 水平多边形面（双面材质用），可带每顶点的附加属性 */
export function flatPolyPositions(poly, y) {
  const pos = []
  for (const t of triangulate(poly))
    for (const i of t) pos.push(poly[i][0], y, poly[i][1])
  return pos
}

/** 闭合折线 → LineSegments 用的顶点对 */
export function loopSegments(poly, y) {
  const pos = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    pos.push(a[0], y, a[1], b[0], y, b[1])
  }
  return pos
}

/**
 * 放样外墙：rings 为自下而上若干圈 [[x, y, z], …]（每圈点数相同），首点在末尾重复一份闭合，
 * uv：u = 沿周长米数（第一圈），v = 世界高度 y；相邻面共用顶点 → 平滑法线
 */
export function loftGeometry(rings) {
  const n = rings[0].length
  const us = [0]
  for (let i = 1; i <= n; i++) {
    const a = rings[0][i - 1]
    const b = rings[0][i % n]
    us.push(us[i - 1] + Math.hypot(b[0] - a[0], b[2] - a[2]))
  }
  const pos = []
  const uv = []
  for (const ring of rings)
    for (let i = 0; i <= n; i++) {
      const p = ring[i % n]
      pos.push(p[0], p[1], p[2])
      uv.push(us[i], p[1])
    }
  const idx = []
  const w = n + 1
  for (let k = 0; k < rings.length - 1; k++)
    for (let i = 0; i < n; i++) {
      const a = k * w + i
      const b = a + 1
      const c = a + w
      const d = c + 1
      idx.push(a, b, d, a, d, c)
    }
  const g = new BufferGeometry()
  g.setAttribute("position", new Float32BufferAttribute(pos, 3))
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/*
 * 天府广场 · 通用几何小函数
 * ----------------------------------------------------------
 * 各分区模块共用、与具体构件无关的几何工具（竖直侧墙用 kit/shapes.js 的 sideWalls，
 * 圆周点用 kit/footprint.js 的 circlePolygon）：
 * - 手拼几何：triMesh（三角形列表建几何体）、rectUV（设计系轴向矩形）、strut（两点之间的斜杆）；
 * - 平面三角化与铺面：cleanRing、triangulate、pushUp、surfaceTris、addSurface、addInlay、addPrism
 *   （地面、神鸟盘、鱼眼、北侧组团共用；polygon.js 的挖口与内收也用 cleanRing、triangulate）；
 * - 三维向量 sub / dot / cross 与按法线校正绕向的 pushTri。
 * 点为 [x, z] 的函数一般收设计系 [u, v]；b.add 时由调用方乘坐标系矩阵。
 */
import { Matrix4, Quaternion, ShapeUtils, Vector2, Vector3 } from "three"
import { cylinder, fromTriangles, sideWalls } from "../kit/shapes.js"

/* ---------------- 手拼几何 ---------------- */

/**
 * 由三角形列表建几何体：tris 为 [[p, q, r], ...]，每个点 [x, y, z]，法线按面计算（kit fromTriangles）。
 * 楔形雨棚、旗面这类手拼的几块面用它，比平铺坐标数组好读
 */
export const triMesh = (tris) => fromTriangles(tris.flat(2))

/** 设计系轴向矩形 [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]（不重复首点；北缘水池、雨棚、挖口等用） */
export const rectUV = (u0, u1, v0, v1) => [
  [u0, v0],
  [u1, v0],
  [u1, v1],
  [u0, v1]
]

/**
 * 两点之间的圆柱（a、c 为父坐标系 [x, y, z]），用于雕像手臂、灯臂等斜杆。
 * opts 默认 8 段、封顶（雕像手臂沿用）；细小的灯臂可传 { segments: 3, caps: false } 省三角形
 */
export function strut(
  b,
  parent,
  a,
  c,
  r0,
  r1,
  color,
  { segments = 8, caps = true } = {}
) {
  const dir = new Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2])
  const len = dir.length()
  const q = new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    dir.normalize()
  )
  const m = new Matrix4().compose(new Vector3(...a), q, new Vector3(1, 1, 1))
  b.add(
    cylinder(r0, r1, len, { segments, caps }),
    color,
    parent.clone().multiply(m)
  )
}

/* ---------------- 平面三角化与铺面（地面、神鸟盘、西鱼眼、北侧组团共用） ---------------- */

/**
 * 去掉相邻的重复点（含末点与首点重合）：几段弧线首尾拼接时接点会出现两次，
 * earcut 遇到零长度边容易漏三角形
 * @param {Array<[number, number]>} poly
 * @returns {Array<[number, number]>} 新数组
 */
export function cleanRing(poly, eps = 1e-6) {
  const out = []
  for (const p of poly) {
    const q = out[out.length - 1]
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p)
  }
  while (
    out.length > 1 &&
    Math.hypot(
      out[0][0] - out[out.length - 1][0],
      out[0][1] - out[out.length - 1][1]
    ) <= eps
  ) {
    out.pop()
  }
  return out
}

/**
 * 平面多边形（可带洞）三角化：three 的 ShapeUtils（earcut），外轮廓、洞的绕向任意。
 * 点为 [x, z]（本景点里一般是设计系 [u, v]）；洞须在外轮廓内、彼此不相交。
 * @returns {Array<Array<[number, number]>>} 三角形数组 [[a, b, c], ...]（绕向未定，写入时由 pushUp 调整）
 */
export function triangulate(outer, holes = []) {
  const rings = [cleanRing(outer), ...holes.map((h) => cleanRing(h))]
  const verts = rings.flat()
  const v2 = (ring) => ring.map(([x, z]) => new Vector2(x, z))
  const faces = ShapeUtils.triangulateShape(
    v2(rings[0]),
    rings.slice(1).map(v2)
  )
  return faces.map(([i, j, k]) => [verts[i], verts[j], verts[k]])
}

/**
 * 把一个三角形写进平铺坐标数组 pos，绕向调成法线朝上（y 分量 > 0）。
 * 点为 [x, z]，高度由 yAt(x, z) 给出（水平面传常数函数，神鸟盘倾斜顶面传平面方程）。
 * 法线 y 分量 = (b − a).z·(c − a).x − (b − a).x·(c − a).z，为负时交换 b、c
 */
export function pushUp(pos, [a, b, c], yAt) {
  const cr = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1])
  const [p, q] = cr >= 0 ? [b, c] : [c, b]
  for (const [x, z] of [a, p, q]) pos.push(x, yAt(x, z), z)
}

/**
 * 一组平面三角形（[x, z] 点，即 triangulate 的结果）写成法线朝上的几何体，高度由 yAt(x, z) 给出：
 * 常数函数即水平面，平面方程即斜面（北侧组团的斜坡、后部台阶）。ground.js 的 flatTris 是它的水平特例
 */
export function surfaceTris(tris, yAt) {
  const pos = []
  for (const t of tris) pushUp(pos, t, yAt)
  return fromTriangles(pos)
}

/** 平面多边形（可带洞）铺成朝上的面，高度由 yAt(x, z) 给出（见 surfaceTris） */
export function addSurface(b, f, outer, holes, yAt, color) {
  b.add(surfaceTris(triangulate(outer, holes), yAt), color, f)
}

/**
 * 「挖洞铺回」：outer 先把 inlays 当洞三角化、铺 baseColor，每块 inlay 再用同一组顶点逐块铺回。
 * 两层同在水平面 y 上、边界顶点逐个相同，既不浮起也不闪；抬高 0.15 m 再铺图案（kit/figures.js 的
 * PATTERN_LIFT）在人走的面上会破坏步行校验的支撑判定，所以图案一律用这个。
 * 用在：草坪花带里的草地与祥云块（ground.js）、阶梯花坡的菱形（statue.js）、门前广场的分格（north.js）。
 * @param {number} y 水平面高度
 * @param {string|((i: number) => string)} inlayColor 铺回的颜色；给函数时按块序号 i 取色
 */
export function addInlay(b, f, outer, inlays, y, baseColor, inlayColor) {
  const yAt = () => y
  addSurface(b, f, outer, inlays, yAt, baseColor)
  inlays.forEach((p, i) => {
    const color = typeof inlayColor === "function" ? inlayColor(i) : inlayColor
    b.add(surfaceTris(triangulate(p), yAt), color, f)
  })
}

/** 实心棱柱：竖直侧墙一种颜色、顶面另一种颜色（extrudePolygon 只有一种颜色；屋面与墙面分色时用这个） */
export function addPrism(b, f, outer, holes, y0, y1, wallColor, topColor) {
  b.add(sideWalls(outer, y0, y1), wallColor, f)
  for (const h of holes) b.add(sideWalls(h, y0, y1, true), wallColor, f)
  addSurface(b, f, outer, holes, () => y1, topColor)
}

/* ---------------- 三维向量与按法线校正绕向（托盘旋转体、东鱼眼坑壁、构筑物共用） ---------------- */

/** 三维向量相减 a − b */
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
/** 三维向量点积 */
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
/** 三维向量叉积 a × b */
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]

/**
 * 按法线校正绕向，把一个三角形写进平铺数组 pos / nor：三个顶点各为 [点, 法线]，
 * 几何法线 (B − A) × (C − A) 与 A 处法线反向时交换 B、C。
 * 双面材质靠绕向判断正反面来翻法线，阴影只画背光面：绕向与法线不一致时，底面不投影、背面发黑
 */
export function pushTri(pos, nor, A, B, Cc) {
  const n = cross(sub(B[0], A[0]), sub(Cc[0], A[0]))
  const list = dot(n, A[1]) >= 0 ? [A, B, Cc] : [A, Cc, B]
  for (const [p, q] of list) {
    pos.push(...p)
    nor.push(...q)
  }
}

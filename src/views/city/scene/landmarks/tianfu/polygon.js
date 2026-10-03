/*
 * 天府广场 · 平面多边形运算（地面 ground.js 用）
 * ----------------------------------------------------------
 * - cutTriangles：铺装（可带洞）三角化后减去一组凸多边形 cut（西鱼眼深色盘、下沉坑口等的挖口）；
 * - robustInset：草坪轮廓内收（花带内沿、花带中线），处理 kit insetPolygon 在短边处收过头的情况。
 * 点一律为设计系 [u, v]（不重复首点，绕向任意）。轮廓相交用 kit/footprint.js 的 ringsCross，
 * 自交判断用 utils.js 的 selfIntersects。
 *
 * cuts 的约定：
 * - 每个 cut 必须是凸多边形（入口检查，凹的或自交的直接抛错：逐三角形相减只对凸 cut 成立）；
 * - cuts 应彼此不重叠。重叠时结果仍正确：两个都整块落在铺装里（inside）而又相交、互相包含或贴边的 cut，
 *   会降级为逐三角形相减（cross），只是多出一些三角形；
 * - cut 可以与铺装外轮廓、洞、别的 cut 共边、共点或顶点落在边上（如 0.5 m 网格上的矩形）：
 *   贴边一律按 cross 处理，见 cutRelation 的 TOUCH。
 */
import {
  clipHalfPlane,
  distToSegment,
  insetPolygon,
  polygonArea,
  ringsCross,
  signedArea2
} from "../kit/footprint.js"
import { pointInPolygon, selfIntersects } from "../../utils.js"
import { cleanRing, triangulate } from "./surface.js"

/* ---------------- 挖口 ---------------- */

/**
 * 检查 cut 是凸多边形：每个角的转向（相邻两边的叉积）都与整个多边形的绕向（带符号面积）同号
 * （共线的零叉积跳过），且不自交（五角星形各角叉积也同号）。
 * 不满足时抛错——凹 cut 若照常相减，会把凹进去的那块也挖掉（L 形少挖、多挖都可能）。
 * 绕向取带符号面积而不是第一个角的转向：第一个角恰好是凹角时，后者会把凸角报成凹角；
 * 报错里的顶点就是第一个转向与绕向相反的凹角顶点（从 1 数）。
 */
function assertConvex(cut) {
  const n = cut.length
  const sign = Math.sign(signedArea2(cut))
  if (n < 3 || sign === 0 || selfIntersects(cut)) {
    throw new Error("天府广场地面挖口：cut 须为不自交、面积非零的凸多边形")
  }
  for (let i = 0; i < n; i++) {
    const a = cut[i]
    const b = cut[(i + 1) % n]
    const c = cut[(i + 2) % n]
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
    if (Math.abs(cr) < 1e-12) continue
    if (Math.sign(cr) !== sign) {
      throw new Error(
        `天府广场地面挖口：cut 须为凸多边形（第 ${((i + 1) % n) + 1} 个顶点是凹角）`
      )
    }
  }
}

/**
 * 三角形减去凸多边形 cut，返回剩下的若干凸多边形（三角形完全在 cut 外时原样返回）。
 * 做法：T − P = ∪ᵢ（T ∩ 第 i 条边外侧 ∩ 前 i − 1 条边内侧），每块都是凸的，
 * 用 kit 的 clipHalfPlane（半平面裁剪）逐条边切。
 */
function subtractConvex(tri, cut) {
  const xs = tri.map((p) => p[0])
  const zs = tri.map((p) => p[1])
  const cx = cut.map((p) => p[0])
  const cz = cut.map((p) => p[1])
  if (
    Math.max(...xs) <= Math.min(...cx) ||
    Math.min(...xs) >= Math.max(...cx) ||
    Math.max(...zs) <= Math.min(...cz) ||
    Math.min(...zs) >= Math.max(...cz)
  ) {
    return [tri]
  }
  // cut 的绕向：带符号面积 > 0 时内法向取左手 (−dz, dx)，否则取反（同 kit 的 insetPolygon）
  const s = signedArea2(cut) > 0 ? 1 : -1
  const pieces = []
  let rest = tri
  for (let i = 0; i < cut.length && rest.length >= 3; i++) {
    const o = cut[i]
    const q = cut[(i + 1) % cut.length]
    const nIn = [-s * (q[1] - o[1]), s * (q[0] - o[0])]
    const out = clipHalfPlane(rest, o, [-nIn[0], -nIn[1]])
    if (out.length >= 3 && polygonArea(out) > 1e-6) pieces.push(out)
    rest = clipHalfPlane(rest, o, nIn)
  }
  return pieces
}

/*
 * 贴边判定容差（米）：一方的某个顶点离另一方的某条边比这还近，就算两者碰到。
 * 碰边只靠严格相交（segmentsCross）判断时，共边、共点、顶点落在边上都判成「不相交」，接着用
 * 一个顶点做点在多边形内判断，点正好落在边界上时结果不确定——会把贴着外轮廓、洞的 cut 误判成
 * inside / outside 而悄悄漏挖（审查的模糊测试：共边、0.5 m 网格坐标、cut 与洞重合等情形）。
 * 碰到就一律走逐三角形相减（cross），结果总是对的，只是多些三角形
 */
const TOUCH = 1e-6
/** 点 p 离轮廓 ring 的某条边不到 TOUCH */
const onRing = (p, ring) =>
  ring.some(
    (a, i) => distToSegment(p[0], p[1], a, ring[(i + 1) % ring.length]) < TOUCH
  )
/** 两个轮廓贴边：任一方的顶点落在另一方的边上（含共点、共边） */
const touches = (a, b) =>
  a.some((p) => onRing(p, b)) || b.some((p) => onRing(p, a))

/**
 * cut 与一块铺装（outer 挖掉 holes）的关系：
 * - "inside"：整块落在铺装里（不碰外轮廓、不碰也不包住任何洞）→ 直接当洞交给 earcut，最省三角形；
 * - "outside"：与铺装不相交 → 跳过；
 * - "cross"：其余情况（跨过边界、与边界贴边或共点、把某个洞包在里面、把整块铺装包在里面）
 *   → 逐个三角形相减。
 * 先排除贴边，后面用单个顶点做点在多边形内判断才可靠（该顶点必定离边界 ≥ TOUCH）。
 */
function cutRelation(cut, outer, holes) {
  const rings = [outer, ...holes]
  if (rings.some((r) => touches(cut, r))) return "cross"
  if (rings.some((r) => ringsCross(r, cut))) return "cross"
  if (holes.some((h) => pointInPolygon(h[0][0], h[0][1], cut))) return "cross"
  // 边不相交、而铺装的一个顶点落在 cut 里：整块铺装都在 cut 里（如包住整段地灯带的矩形），
  // 不能判成 outside，交给逐三角形相减，结果为空
  if (pointInPolygon(outer[0][0], outer[0][1], cut)) return "cross"
  const [x, z] = cut[0]
  const inPave =
    pointInPolygon(x, z, outer) && !holes.some((h) => pointInPolygon(x, z, h))
  return inPave ? "inside" : "outside"
}

/**
 * 两个凸多边形是否相交、互相包含或贴边（贴边、共点也算：见 TOUCH；
 * 排除贴边之后，一方的顶点落在另一方里即为包含）
 */
function convexOverlap(a, b) {
  if (touches(a, b)) return true
  if (ringsCross(a, b)) return true
  return (
    pointInPolygon(a[0][0], a[0][1], b) || pointInPolygon(b[0][0], b[0][1], a)
  )
}

/**
 * 多边形（可带洞）三角化后减去全部 cuts，返回三角形数组（凸块按扇形拆成三角形）。
 * 整块落在铺装里的 cut 直接并进洞里三角化；跨边界或贴着边界的才逐个三角形相减，被切到的三角形会碎成很多小块。
 * 两个 inside 的 cut 若相交、互相包含或贴边，作为两个洞交给 earcut 会输出重叠三角形或出错，所以都降级为 cross。
 * 实测：
 * - 西鱼眼深色盘（48 边形，半径 27）整块在外板里，只多 50 个；
 * - Task 5 的下沉坑口跨阴鱼、东段地灯带与外板，与西鱼眼盘同时挖时：48 边形半径 27.5 多 720 个，
 *   半径 28 多 749 个（64 边形则多 950～1,000 个），预算算进 Task 5（审查估计约 770～800）；
 *   逐三角形相减切出的新顶点不与相邻三角形共享，铺装顶面会有约 140 个 T 形接点（顶点落在别的三角形
 *   边的中段；审查数得 128）。接点都在同一平面上，远看不露缝，近看偶尔可能有像素级亮点。
 * @param {Array<[number, number]>} outer 外轮廓
 * @param {Array<Array<[number, number]>>} holes 洞
 * @param {Array<Array<[number, number]>>} cuts 凸多边形（见文件头的约定）
 * @returns {Array<Array<[number, number]>>} 三角形数组 [[a, b, c], ...]
 */
export function cutTriangles(outer, holes, cuts) {
  cuts.forEach(assertConvex)
  const rel = cuts.map((c) => cutRelation(c, outer, holes))
  for (let i = 0; i < cuts.length; i++) {
    for (let j = i + 1; j < cuts.length; j++) {
      if (
        rel[i] === "inside" &&
        rel[j] === "inside" &&
        convexOverlap(cuts[i], cuts[j])
      ) {
        rel[i] = "cross"
        rel[j] = "cross"
      }
    }
  }
  const inner = cuts.filter((_, i) => rel[i] === "inside")
  let tris = triangulate(outer, [...holes, ...inner])
  for (const cut of cuts.filter((_, i) => rel[i] === "cross")) {
    const next = []
    for (const t of tris) {
      for (const p of subtractConvex(t, cut)) {
        for (let i = 1; i + 1 < p.length; i++) next.push([p[0], p[i], p[i + 1]])
      }
    }
    tris = next
  }
  return tris
}

/* ---------------- 轮廓内收 ---------------- */

/** 直线 ab 与直线 cd 的交点；近乎平行时返回 null */
function lineCross(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]]
  const s = [d[0] - c[0], d[1] - c[1]]
  const den = r[0] * s[1] - r[1] * s[0]
  if (Math.abs(den) < 1e-9) return null
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den
  return [a[0] + r[0] * t, a[1] + r[1] * t]
}

/**
 * 轮廓向内收 d 米（花带内沿、花带中线）。kit 的 insetPolygon 按斜接平移各边，
 * 遇到「两头都是凸角的短边」（草坪圆角、钝尖）会收过头、边反向，轮廓自交。
 * 这里每轮找出反向的短边，把它删掉、让前后两条边直接相交（这条边在收 d 米后本来就不存在了），
 * 再重新内收，直到没有反向边。结果仍自交、越出原轮廓或面积过小时返回 null（这块草坪太窄）。
 * @returns {Array<[number, number]>|null}
 */
export function robustInset(poly, d) {
  let p = cleanRing(poly)
  while (p.length >= 3) {
    const q = insetPolygon(p, d)
    const n = p.length
    // 反向（或收成零长）的边里取原长最短的一条先删
    let bad = -1
    let badLen = Infinity
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const ex = p[j][0] - p[i][0]
      const ez = p[j][1] - p[i][1]
      const dot = ex * (q[j][0] - q[i][0]) + ez * (q[j][1] - q[i][1])
      const len = Math.hypot(ex, ez)
      if (dot <= 0 && len < badLen) {
        bad = i
        badLen = len
      }
    }
    if (bad < 0) {
      const ok =
        !selfIntersects(q) &&
        q.every(([x, z]) => pointInPolygon(x, z, poly)) &&
        polygonArea(q) > 0.05 * polygonArea(poly)
      return ok ? q : null
    }
    const i0 = (bad - 1 + n) % n
    const i2 = (bad + 1) % n
    const i3 = (bad + 2) % n
    const x = lineCross(p[i0], p[bad], p[i2], p[i3])
    if (!x) return null
    p = p.flatMap((pt, k) => (k === bad ? [x] : k === i2 ? [] : [pt]))
  }
  return null
}

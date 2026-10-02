/*
 * 熊猫基地 · 活动场构件（enclosures.js、nurseries.js 共用）
 * ----------------------------------------------------------
 * 规格：设计文档 4.8（下沉活动场：挡土墙 + 墙顶木栏 + 绿篱；场内栖架、水池、套竹筒树、裸土与原木排、
 * 矮竹；塑石兽舍）、4.9（原木栖架，插画放大 ×2.5）、4.12（熊猫小人）。
 * 照片：pb_enclosure_moat01/02（砖红挡土墙、墙顶木栏、外侧绿篱，游客俯看下沉场）、
 * pb_rockhouse01/02（塑石仿岩兽舍、墨绿门）、pb_feeding_platform、pb_frames01～03（风化灰褐原木栖架、
 * 树干竹筒护套）。
 * 约定：坐标为世界坐标 [x, z]，高度为世界 y；构件进主体批 b（双面材质，三角形绕向不影响显示），
 * 贴地的薄片（水池、裸土、原木排）进地面批 gb（单面材质，三角形一律朝上）。
 * 朝向：熊猫的脸、趴架熊猫的头、栖架的正面都朝到站机位的相机，方位按各自位置用
 * site.bearingToCamera 算（透视下各处约 119°～137°，不是统一的 125°）；熊猫头部登记进
 * site.viewTargets，供后续种树种竹避开视线（site.blocksView）。
 */
import {
  IcosahedronGeometry,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  ShapeUtils,
  Vector2,
  Vector3
} from "three"
import { THEME } from "../../theme.js"
import { GROUND_Y } from "../../terrain.js"
import { hashInts, mulberry32 } from "../../utils.js"
import { frame, local } from "../kit/builder.js"
import { addPanda, addTree } from "../kit/figures.js"
import { bearingDiff, insetPolygon, rectPolygon } from "../kit/footprint.js"
import { pushSpindle } from "../kit/plants.js"
import { box, cylinder, fromTriangles, prism } from "../kit/shapes.js"
import { PLATE_OFF, facades, flatFace, safeInset } from "./blocks.js"
import { BAMBOO, C, LAWN_Y, YARD_Y } from "./site.js"

const DEG = Math.PI / 180
const Y_UP = new Vector3(0, 1, 0)

/* ---------------- 轮廓 ---------------- */

/**
 * 多边形倒圆角：每个角换成半径 r、seg 段的圆弧（相切于两条邻边）。
 * 切点离角点 r / tan(半角)；角很尖时切点会越过邻边中点，这里把该角的半径收小到
 * 切点不超过邻边长的 0.45 倍。凹角同样倒圆（圆弧向外凸）。返回新多边形（不重复首点）
 */
export function fillet(poly, r, seg = 2) {
  const n = poly.length
  const out = []
  const unit = (x, z) => {
    const l = Math.hypot(x, z) || 1
    return [x / l, z / l]
  }
  for (let i = 0; i < n; i++) {
    const p = poly[(i - 1 + n) % n]
    const c = poly[i]
    const q = poly[(i + 1) % n]
    const a = unit(p[0] - c[0], p[1] - c[1])
    const b = unit(q[0] - c[0], q[1] - c[1])
    const cos = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))
    const half = Math.acos(cos) / 2
    // 近乎共线的角（半角 > 88°）不必倒圆
    if (half > 88 * DEG) {
      out.push(c)
      continue
    }
    const lim =
      0.45 *
      Math.min(
        Math.hypot(p[0] - c[0], p[1] - c[1]),
        Math.hypot(q[0] - c[0], q[1] - c[1])
      )
    const rr = Math.min(r, lim * Math.tan(half))
    const t = rr / Math.tan(half) // 切点离角点的距离
    const bis = unit(a[0] + b[0], a[1] + b[1])
    const k = rr / Math.sin(half) // 圆心离角点的距离
    const o = [c[0] + bis[0] * k, c[1] + bis[1] * k]
    const p0 = [c[0] + a[0] * t, c[1] + a[1] * t]
    const p1 = [c[0] + b[0] * t, c[1] + b[1] * t]
    const a0 = Math.atan2(p0[1] - o[1], p0[0] - o[0])
    let da = Math.atan2(p1[1] - o[1], p1[0] - o[0]) - a0
    // 取劣弧（圆角总小于 180°）
    while (da > Math.PI) da -= 2 * Math.PI
    while (da < -Math.PI) da += 2 * Math.PI
    for (let s = 0; s <= seg; s++) {
      const ang = a0 + (da * s) / seg
      out.push([o[0] + rr * Math.cos(ang), o[1] + rr * Math.sin(ang)])
    }
  }
  return out
}

/** 圆角矩形：中心 (cx, cz)，沿 bearing 长 w、垂直方向宽 d，四角半径 r（每角 seg 段） */
export function roundedRect(cx, cz, w, d, bearing, r, seg = 2) {
  return fillet(rectPolygon(cx, cz, w, d, bearing), r, seg)
}

/** 方位 b（度）、离 c 距离 r 的点 [x, z] */
export function polar(c, r, b) {
  return [c[0] + r * Math.sin(b * DEG), c[1] - r * Math.cos(b * DEG)]
}

/**
 * 圆弧点列：圆心 c，自方位 b0 顺时针转 span 度、n 段（n + 1 个点）。
 * r 可以是方位（度）的函数（偏心圆、外弧随方位放宽）
 */
export function arcPts(c, r, b0, span, n) {
  const out = []
  for (let k = 0; k <= n; k++) {
    const b = b0 + (span * k) / n
    out.push(polar(c, typeof r === "function" ? r(b) : r, b))
  }
  return out
}

/**
 * 环形（C 形）活动场轮廓：外弧 rOut（可为方位的函数）自 b0 顺时针转 span 度，再沿内弧 rIn 回到 b0。
 * 外弧 nOut 段、内弧 nIn 段
 */
export function ringSector(c, rIn, rOut, b0, span, nOut, nIn) {
  return [
    ...arcPts(c, rOut, b0, span, nOut),
    ...arcPts(c, rIn, b0, span, nIn).reverse()
  ]
}

/* ---------------- 院墙、木栏、绿篱 ---------------- */

/*
 * 下沉活动场的院墙（照片 pb_enclosure_moat01/02）：场地 YARD_Y 0.3 → 墙顶 2.0（砖红），墙顶外沿一道
 * 木栏（竖直面带 2.0 → 2.9），墙外紧贴一条绿篱（宽 1.0、顶 LAWN_Y + 0.8）。数值为离活动场边线
 * （草地洞的边）向外的水平距离：墙内皮在边线以内 wallIn，盖住草地洞的侧面且不与它共面闪烁。
 * 墙外皮不做：外侧有绿篱与墙顶挡着，从外面看过去落在墙内皮的背面（同色、双面材质）
 */
export const MOAT = {
  wallIn: 0.04,
  wallOut: 0.46,
  wallTop: 2.0,
  railTop: 2.9,
  hedgeOut: 1.46,
  hedgeTop: LAWN_Y + 0.8
}
// 隔墙、端墙（box）厚度
const WALL_T = 0.5
/**
 * addMoat 的选项：活动场内弧（贴着兽舍 / 环楼外一圈草地、没有游客的一侧）的矮挡土墙。
 * 墙厚 0.3，自场地顶到草地顶以上 0.1 m（盖住草地洞 0.55 m 的土坎），每段 4 个三角形
 */
export const INNER_CURB = {
  hedge: false,
  rail: false,
  top: LAWN_Y + 0.1,
  wallIn: MOAT.wallIn,
  wallOut: 0.26
}

/** 折线 R 上 y0 → y1 的竖直面带（每段 2 个三角形），写进 pos */
function wallStrip(pos, R, y0, y1, closed) {
  const n = closed ? R.length : R.length - 1
  for (let i = 0; i < n; i++) {
    const [ax, az] = R[i]
    const [bx, bz] = R[(i + 1) % R.length]
    pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz)
    pos.push(ax, y0, az, bx, y1, bz, ax, y1, az)
  }
  return pos
}

/** 两条一一对应的折线 A、B 之间高 y 的水平面带（每段 2 个三角形），写进 pos */
function topStrip(pos, A, B, y, closed) {
  const n = closed ? A.length : A.length - 1
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % A.length
    pos.push(A[i][0], y, A[i][1], A[j][0], y, A[j][1], B[j][0], y, B[j][1])
    pos.push(A[i][0], y, A[i][1], B[j][0], y, B[j][1], B[i][0], y, B[i][1])
  }
  return pos
}

/**
 * 沿活动场边线做院墙（+ 木栏 + 绿篱）。off(d) 返回边线向外平移 d 米（d < 0 向内）的折线，
 * 各次返回的点数相同、逐点对应；closed 为闭合环，开放折线两端各补一块封口（墙、绿篱的断面）。
 * 每段 10 个三角形（不带绿篱 6 个、都不带 4 个）。
 * @param {object} [o] { hedge = true, rail = true, y0（墙内皮下沿）, top（墙顶）, wallIn, wallOut
 *   （墙内皮、外皮离边线的距离）, color }，缺省为 MOAT 的下沉活动场院墙
 */
export function addMoat(b, off, closed, o = {}) {
  const M = MOAT
  const {
    hedge = true,
    rail = true,
    y0 = YARD_Y - 0.05,
    top = M.wallTop,
    wallIn = M.wallIn,
    wallOut = M.wallOut,
    color = C.moatWall
  } = o
  const inner = off(-wallIn)
  const outer = off(wallOut)
  const pos = []
  wallStrip(pos, inner, y0, top, closed)
  topStrip(pos, inner, outer, top, closed)
  const h = hedge ? off(M.hedgeOut) : null
  const hp = []
  if (!closed) {
    // 两端封口：墙的断面（内皮 → 外皮），带绿篱时再补绿篱断面（外皮 → 绿篱外沿）
    for (const k of [0, inner.length - 1]) {
      wallStrip(pos, [inner[k], outer[k]], y0, top, false)
      if (h) wallStrip(hp, [outer[k], h[k]], LAWN_Y - 0.05, M.hedgeTop, false)
    }
  }
  b.add(fromTriangles(pos), color)
  if (rail) {
    b.add(
      fromTriangles(wallStrip([], outer, top, M.railTop, closed)),
      C.railWood
    )
  }
  if (h) {
    topStrip(hp, outer, h, M.hedgeTop, closed)
    wallStrip(hp, h, LAWN_Y - 0.05, M.hedgeTop, closed)
    b.add(fromTriangles(hp), C.hedge)
  }
}

/** 闭合活动场轮廓的院墙：边线外扩用 kit 的斜接 insetPolygon（轮廓须近凸、凹角已倒圆） */
export function addPolyMoat(b, poly, o) {
  addMoat(b, (d) => insetPolygon(poly, -d), true, o)
}

/** p → q 一段直墙（隔墙、端墙）：box 厚 t、y0 → y1，10 个三角形 */
export function wallBox(b, p, q, y0, y1, t = WALL_T, color = C.moatWall) {
  const dx = q[0] - p[0]
  const dz = q[1] - p[1]
  const bearing = Math.atan2(dx, -dz) / DEG
  // frame 局部 +X 指向「frame 方位 + 90°」：frame 方位取线段方位 − 90°，局部 X 即沿 p → q
  b.add(
    box(Math.hypot(dx, dz), y1 - y0, t),
    color,
    frame((p[0] + q[0]) / 2, y0, (p[1] + q[1]) / 2, bearing - 90)
  )
}

/** 活动场里沿径向的隔墙 / 端墙：圆心 c、方位 bearing、半径 r0 → r1，墙高同院墙 */
export function radialWall(b, c, bearing, r0, r1) {
  wallBox(
    b,
    polar(c, r0, bearing),
    polar(c, r1, bearing),
    YARD_Y - 0.05,
    MOAT.wallTop
  )
}

/* ---------------- 原木（五棱柱） ---------------- */

const _q = new Quaternion()
const _s = new Vector3(1, 1, 1)

/** 自 a 到 b（世界坐标 [x, y, z]）的一根原木：五棱柱、半径 r、不封口，10 个三角形 */
export function addLog(b, a, c, r, color = C.perch) {
  const dir = new Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2])
  const len = dir.length()
  _q.setFromUnitVectors(Y_UP, dir.normalize())
  b.add(
    prism(5, r, r, len, { top: false }),
    color,
    new Matrix4().compose(new Vector3(...a), _q, _s)
  )
}

/* ---------------- 原木栖架（4.9，×2.5） ---------------- */

/*
 * 双层栖架：在 frame(x, y0, z, 朝机位方位) 里摆，局部 −Z 朝机位、+Z 为背面。
 *   上层台 high：宽 4.5（局部 X）× 深 3.5（局部 Z）、台顶 3.6，四角原木立柱；
 *   下层台 low：6.0 × 4.5、台顶 2.0，接在上层台前方（朝机位一侧），前沿两根立柱、后沿搭在上层台前柱上；
 *   台面 = 一块 0.15 厚的板（box，不做底面）+ 横铺的原木（前沿各一根，下层台再加一根）；
 *   一根斜靠的长原木当爬梯（Ø0.5、长约 6.6），自上层台台沿伸向 ladder 方位、落到场地上。
 * 趴架熊猫（kit climb 姿态）要求台顶 ≥ 0.56 × 熊猫高：6 m 熊猫 → 3.36，上层台顶取 3.6。
 * 熊猫趴在上层台背面（离机位远的）台沿中点，头朝机位、后腿垂向背面（addPerch 返回的 anchor）。
 * single：只有上层台（窄的太阳产房扇形院放不下双层），约 70 个三角形；双层约 120 个
 */
export const PERCH = {
  high: { w: 4.5, d: 3.5, top: 3.6 },
  low: { w: 6.0, d: 4.5, top: 2.0 },
  board: 0.15,
  postR: 0.225, // 立柱五棱柱外接半径（Ø0.45）
  logR: 0.2, // 台面横铺原木（Ø0.4）
  ladderR: 0.25,
  ladderRun: 5.6 // 爬梯水平跨度（自台沿算起）；落差 3.5 → 长约 6.6
}

/**
 * 原木栖架（进 site.b，台面占地登记 site.solid）。(x, z) 为上层台中心，y0 为场地顶；
 * 正面朝 site.bearingToCamera(x, z)。
 * @param {object} [o] { single = false, ladder = 35（爬梯自台沿伸出的世界方位） }
 * @returns {{ anchor: Matrix4, foot: Array<[number, number]>, ladderFoot: [number, number] }}
 *   anchor：趴架熊猫的 frame（上层台背面台沿中点、台顶、朝向机位）；foot：台面占地四边形；
 *   ladderFoot：爬梯落脚点（布置自检用）
 */
export function addPerch(site, x, y0, z, o = {}) {
  const { single = false, ladder = 35 } = o
  const b = site.b
  const P = PERCH
  const facing = site.bearingToCamera(x, z)
  const F = frame(x, y0, z, facing)
  const W = (u, y, v) => {
    const p = new Vector3(u, y, v).applyMatrix4(F)
    return [p.x, p.y, p.z]
  }
  const hi = P.high
  const lo = P.low
  // 上层台：台板 + 四角立柱 + 前沿一根横铺原木
  b.add(box(hi.w, P.board, hi.d), C.perch, local(F, 0, hi.top - P.board, 0))
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const u = sx * (hi.w / 2 - 0.3)
      const v = sz * (hi.d / 2 - 0.3)
      addLog(b, W(u, 0, v), W(u, hi.top - P.board, v), P.postR, C.perchDark)
    }
  }
  const vFront = -hi.d / 2 + P.logR
  addLog(
    b,
    W(-hi.w / 2 - 0.2, hi.top + P.logR * 0.6, vFront),
    W(hi.w / 2 + 0.2, hi.top + P.logR * 0.6, vFront),
    P.logR
  )
  if (!single) {
    // 下层台：自上层台前沿向机位一侧伸出 lo.d
    const vc = -hi.d / 2 - lo.d / 2
    b.add(box(lo.w, P.board, lo.d), C.perch, local(F, 0, lo.top - P.board, vc))
    const vF = -hi.d / 2 - lo.d + 0.3
    for (const sx of [-1, 1]) {
      const u = sx * (lo.w / 2 - 0.3)
      addLog(b, W(u, 0, vF), W(u, lo.top - P.board, vF), P.postR, C.perchDark)
    }
    for (const v of [vF - 0.1, vc]) {
      addLog(
        b,
        W(-lo.w / 2 - 0.2, lo.top + P.logR * 0.6, v),
        W(lo.w / 2 + 0.2, lo.top + P.logR * 0.6, v),
        P.logR
      )
    }
  }
  // 爬梯：自上层台中心沿 ladder 方位到台沿（矩形台沿上的交点）内 0.2 m，再水平伸出 ladderRun 落地
  const d = [Math.sin(ladder * DEG), -Math.cos(ladder * DEG)]
  // 爬梯方向在栖架 frame 里的分量：局部 X 指向「朝向 + 90°」，局部 −Z 指向朝向
  const lx = Math.cos((ladder - facing - 90) * DEG)
  const lz = Math.cos((ladder - facing) * DEG)
  const ex = hi.w / 2 / Math.max(1e-6, Math.abs(lx))
  const ez = hi.d / 2 / Math.max(1e-6, Math.abs(lz))
  const edge = Math.min(ex, ez) - 0.2
  const top = [x + d[0] * edge, y0 + hi.top - 0.1, z + d[1] * edge]
  const foot = [
    x + d[0] * (edge + P.ladderRun),
    y0,
    z + d[1] * (edge + P.ladderRun)
  ]
  addLog(b, foot, top, P.ladderR)
  // 占地：台面范围（局部 X ±half、Z front → back）的四边形；爬梯另以落脚点返回
  const back = hi.d / 2
  const front = single ? -hi.d / 2 : -hi.d / 2 - lo.d
  const half = single ? hi.w / 2 : lo.w / 2
  const fp = [
    [-half, front],
    [half, front],
    [half, back],
    [-half, back]
  ].map(([u, v]) => {
    const p = W(u, 0, v)
    return [p[0], p[2]]
  })
  site.solid(fp)
  const anchor = local(F, 0, hi.top, hi.d / 2)
  return { anchor, foot: fp, ladderFoot: [foot[0], foot[2]] }
}

/*
 * 树杈栖架（小熊猫活动场）：一根主干 Ø0.6 自地面到 2.2，两根分叉 Ø0.45 自 2.0 斜向两侧到 3.4，
 * 分叉顶上一块 3 × 2 的小台（顶 3.6），约 40 个三角形
 */
export function addForkPerch(b, x, y0, z, bearing) {
  const F = frame(x, y0, z, bearing)
  const W = (u, y, v) => {
    const p = new Vector3(u, y, v).applyMatrix4(F)
    return [p.x, p.y, p.z]
  }
  addLog(b, W(0, 0, 0), W(0, 2.2, 0), 0.3, C.perchDark)
  for (const s of [-1, 1]) addLog(b, W(0, 2.0, 0), W(s * 1.2, 3.45, 0), 0.22)
  b.add(box(3, 0.15, 2), C.perch, local(F, 0, 3.45, 0))
  return rectPolygon(x, z, 3.4, 2.4, bearing + 90)
}

/*
 * 受保护视线的起点（熊猫头部）：坐姿取坐面以上 0.85 h（头心约 0.77 h、耳尖约 1.0 h）；
 * 趴姿按 kit/figures.js 的 pandaParts 换算，头心在台沿以上约 0.275 h、朝头的方向（frame 局部 −Z）0.02 h。
 * CLIMB_HEAD 是从 pandaParts 里 climb 姿态的头部部件位置手算出的比例，没有从 kit 读取：
 * 改动 climb 部件表（头的位置、身体前倾角）时须同步这里，否则视线保护（blocksView）会护错位置
 */
const SIT_HEAD = 0.85
const CLIMB_HEAD = { y: 0.275, z: -0.02 }
const CLIMB_H = 6 // 趴架熊猫高（台顶 3.6 ≥ 0.56 × 6）

/**
 * 趴架熊猫：kit climb 姿态，高 6 m，frame 为 addPerch 返回的 anchor（flat、细分 0，并入主体批）；
 * 头部登记进 site.viewTargets
 */
export function addClimbPanda(site, anchor) {
  addPanda(site.b, anchor, {
    height: CLIMB_H,
    pose: "climb",
    flat: true,
    detail: 0
  })
  const head = new Vector3(
    0,
    CLIMB_HEAD.y * CLIMB_H,
    CLIMB_HEAD.z * CLIMB_H
  ).applyMatrix4(anchor)
  site.viewTargets.push({ x: head.x, y: head.y, z: head.z })
}

/**
 * 坐姿熊猫：脸朝该处望向机位的方位（site.bearingToCamera）±20°（按位置播种的确定性随机），
 * frame 局部 +Z 为脸，故 frame 方位取「面朝 + 180」；头部登记进 site.viewTargets。
 * @param {number} h 总高：成年 6.5、幼崽 3.8（真实坐高约 1 m 的插画放大）
 */
export function addSitPanda(site, x, y, z, h) {
  const rand = mulberry32(hashInts(61, Math.round(x * 10), Math.round(z * 10)))
  const facing = site.bearingToCamera(x, z) + (rand() * 2 - 1) * 20
  addPanda(site.b, frame(x, y, z, facing + 180), {
    height: h,
    pose: "sit",
    flat: true,
    detail: 0
  })
  site.viewTargets.push({ x, y: y + SIT_HEAD * h, z })
}

/* ---------------- 水池、斑块、套竹筒树、矮竹 ---------------- */

/*
 * 小水池：12 边形椭圆 5 × 3.5，水面 rim 内；石沿外扩 0.45，两层都是贴场地的薄片（地面批）。
 * 高度：场地 0.3 → 石沿 0.34 → 水面 0.37（远景深度精度约 6 mm，3～4 cm 的高差不闪烁）
 */
const POOL = { a: 2.5, b: 1.75, rim: 0.45, seg: 12, rimY: 0.34, waterY: 0.37 }

function ellipse(x, z, a, c, bearing, n) {
  const out = []
  for (let k = 0; k < n; k++) {
    const t = (k / n) * Math.PI * 2
    // 局部 (u, v) = (a cos t, c sin t)，u 沿 bearing
    const u = a * Math.cos(t)
    const v = c * Math.sin(t)
    const s = Math.sin(bearing * DEG)
    const cb = Math.cos(bearing * DEG)
    out.push([x + u * s + v * cb, z - u * cb + v * s])
  }
  return out
}

/** 小水池（进地面批），返回石沿轮廓 */
export function addPool(gb, x, z, bearing) {
  const P = POOL
  const rim = ellipse(x, z, P.a + P.rim, P.b + P.rim, bearing, P.seg)
  gb.add(flatFace(rim, [], P.rimY), C.bankStone)
  gb.add(
    flatFace(ellipse(x, z, P.a, P.b, bearing, P.seg), [], P.waterY),
    THEME.water
  )
  return rim
}

/**
 * 场内斑块（地面批）：裸土（不规则六边形，约 w × d）与原木排（矩形）。
 * 薄片高出场地 2 / 3.5 cm，与场地面、彼此都不共面
 */
export function addSoil(gb, x, z, w, d, bearing) {
  const rand = mulberry32(hashInts(67, Math.round(x * 10), Math.round(z * 10)))
  const poly = ellipse(x, z, w / 2, d / 2, bearing, 6).map(([px, pz]) => {
    const k = 0.8 + 0.35 * rand()
    return [x + (px - x) * k, z + (pz - z) * k]
  })
  gb.add(flatFace(poly, [], YARD_Y + 0.02), C.yardSoil)
  return poly
}
export function addLogMat(gb, x, z, w, d, bearing) {
  const poly = rectPolygon(x, z, w, d, bearing)
  gb.add(flatFace(poly, [], YARD_Y + 0.035), C.yardLogs)
  return poly
}

/**
 * 套竹筒的乔木（照片 pb_rockhouse02、pb_frames01）：kit addTree 细分 0（32 个三角形），
 * 树干下段套一截 #C8B27E 圆柱（六棱、不封口，12 个三角形）
 */
export function addSleevedTree(b, x, y, z, r, color, yaw) {
  addTree(b, x, y, z, { r, color, detail: 0, yaw, trunkH: 0.9 * r })
  const rr = 0.12 * r * 1.5
  b.add(
    cylinder(rr, rr, 0.45 * r, { segments: 6 }),
    C.trunkSleeve,
    local(null, x, y, z)
  )
}

/** 矮竹一丛（「熊猫食堂」）：n 束竹梢叶团（kit/plants.js），顶点按色写进 bufs，最后 flushBamboo 合成 */
export function addBambooClump(bufs, x, y, z, h = 3.4, n = 3) {
  const rand = mulberry32(hashInts(71, Math.round(x * 10), Math.round(z * 10)))
  const m = new Matrix4()
  const q = new Quaternion()
  for (let k = 0; k < n; k++) {
    const a = ((k + rand() * 0.5) / n) * Math.PI * 2
    const d = 0.5 + 0.6 * rand()
    // 竿梢外倾 8～16°：绕水平轴（与外倾方向垂直）转
    const lean = (8 + 8 * rand()) * DEG
    q.setFromAxisAngle(new Vector3(Math.sin(a), 0, -Math.cos(a)), lean)
    m.compose(new Vector3(x + Math.cos(a) * d, y, z + Math.sin(a) * d), q, _s)
    pushSpindle(
      bufs[Math.floor(rand() * bufs.length) % bufs.length],
      m,
      h * (0.8 + 0.35 * rand()),
      0.9 + 0.4 * rand()
    )
  }
}

/** 竹梢顶点缓冲（每色一个数组） */
export function bambooBufs() {
  return BAMBOO.map(() => [])
}

/** 把 addBambooClump 写下的顶点按色合成几何体，加进合批器 */
export function flushBamboo(b, bufs) {
  bufs.forEach((pos, i) => {
    if (pos.length) b.add(fromTriangles(pos), BAMBOO[i])
  })
}

/* ---------------- 塑石兽舍 ---------------- */

/**
 * 塑石体：轮廓 poly 从城市地面立起，墙顶一圈收进 batter 米（墙面微微内倾，读成堆起来的岩体；
 * 收进后的轮廓不合格时不收，见 blocks.js safeInset），墙顶各顶点的高度在 h0～h1（世界 y）之间
 * 按位置抖动，顶面按收进后的轮廓三角剖分、各顶点各用自己的高度（俯看是一块不平的岩顶）。
 * n 点轮廓 3n − 2 个三角形
 * @returns {{ tops: number[], batter: number }} 各顶点的顶高、实际收进量（没收时为 0）
 */
export function addRockMass(b, poly, h0, h1, seed, batter = 0.8) {
  const tops = poly.map(([x, z]) => {
    const r = mulberry32(
      hashInts(seed, Math.round(x * 10), Math.round(z * 10))
    )()
    return h0 + (h1 - h0) * r
  })
  // safeInset 只用来验收（它会先统一绕向、顶点顺序可能反过来）；顶点一一对应的收进轮廓用 kit 的
  // insetPolygon（保持原顺序，两种绕向都向内收）
  const up = safeInset(poly, batter) ? insetPolygon(poly, batter) : poly
  // 墙面按位置播种分成亮、暗两色（塑石的明暗块面，免得读成一只灰盒子）
  const walls = [[], []]
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const [ax, az] = poly[i]
    const [bx, bz] = poly[j]
    const [cx, cz] = up[j]
    const [dx, dz] = up[i]
    const k = hashInts(seed + 1, Math.round(ax * 10), Math.round(az * 10)) & 1
    walls[k].push(ax, GROUND_Y, az, bx, GROUND_Y, bz, cx, tops[j], cz)
    walls[k].push(ax, GROUND_Y, az, cx, tops[j], cz, dx, tops[i], dz)
  }
  walls.forEach((pos, k) => {
    if (pos.length) b.add(fromTriangles(pos), k ? C.rockDark : C.rock)
  })
  const faces = ShapeUtils.triangulateShape(
    up.map(([x, z]) => new Vector2(x, z)),
    []
  )
  const top = []
  for (const f of faces) {
    for (const k of f) top.push(up[k][0], tops[k], up[k][1])
  }
  b.add(fromTriangles(top), C.rock)
  return { tops, batter: up === poly ? 0 : batter }
}

/** 岩包：压扁的二十面体（细分 0、去法线按面着色，20 个三角形），中心 (x, y, z)、半轴 (sx, sy, sz) */
export function addRockLump(b, x, y, z, sx, sy, sz, yaw, color = C.rockDark) {
  const g = new IcosahedronGeometry(1, 0)
  g.deleteAttribute("normal")
  b.add(g, color, local(null, x, y, z, yaw, sx, sy, sz))
}

/**
 * 把轮廓「打毛」成塑石的不规则外缘：长于 step 的边按约 step 米等分，新插的点沿该边法向抖动 ±amp
 * （按位置播种），原有顶点不动。返回新多边形
 */
export function roughen(poly, step = 5, amp = 0.5) {
  const out = []
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i]
    const [bx, bz] = poly[(i + 1) % poly.length]
    const len = Math.hypot(bx - ax, bz - az)
    out.push(poly[i])
    const n = Math.round(len / step)
    for (let k = 1; k < n; k++) {
      const t = k / n
      const x = ax + (bx - ax) * t
      const z = az + (bz - az) * t
      const r = mulberry32(hashInts(89, Math.round(x * 10), Math.round(z * 10)))
      const d = (r() * 2 - 1) * amp
      out.push([x - ((bz - az) / len) * d, z + ((bx - ax) / len) * d])
    }
  }
  return out
}

/**
 * 兽舍塑石轮廓：中心 (cx, cz)、沿 bearing 长 w、宽 d 的椭圆上 n 个点，半径按位置抖动 ±12%
 * （真实 20 × 10 → 模型 22 × 10，设计文档 4.8）
 */
export function rockOutline(cx, cz, w, d, bearing, n = 9) {
  const rand = mulberry32(
    hashInts(73, Math.round(cx * 10), Math.round(cz * 10))
  )
  return ellipse(cx, cz, w / 2, d / 2, bearing, n).map(([x, z]) => {
    const k = 0.88 + 0.24 * rand()
    return [cx + (x - cx) * k, cz + (z - cz) * k]
  })
}

/**
 * 塑石兽舍：塑石体（顶高 y0 + h ± 1.1）+ 顶上岩包 + 一扇墨绿门（贴在外法向最接近 doorFacing 的墙面上）。
 * @param {object} o { y0（门底 / 地面高）, h（平均高）, doorFacing（门朝向方位）, lumps（岩包个数，缺省 2） }
 */
export function addRockShelter(b, poly, o) {
  const { y0, h, doorFacing, lumps = 2 } = o
  const [cx, cz] = poly
    .reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0])
    .map((v) => v / poly.length)
  const { tops, batter } = addRockMass(b, poly, y0 + h - 1.1, y0 + h + 1.1, 79)
  // 岩包心放在岩顶的平均高度：半埋进岩顶，露出 1～2 m
  const mid = tops.reduce((a, t) => a + t, 0) / tops.length
  const rand = mulberry32(
    hashInts(83, Math.round(cx * 10), Math.round(cz * 10))
  )
  // 岩包摆在轮廓中心与各顶点之间（取前 lumps 个相隔较远的顶点方向），半埋进岩顶
  for (let k = 0; k < lumps; k++) {
    const p =
      poly[Math.floor((k * poly.length) / lumps + rand() * 2) % poly.length]
    const t = 0.35 + 0.2 * rand()
    const s = 2.2 + 1.4 * rand()
    addRockLump(
      b,
      cx + (p[0] - cx) * t,
      mid,
      cz + (p[1] - cz) * t,
      s * 1.3,
      s * 0.55,
      s,
      rand() * Math.PI,
      k % 2 ? C.rock : C.rockDark
    )
  }
  const list = facades(poly).filter((f) => f.len >= 3)
  if (list.length) {
    const f = list.reduce((p, q) =>
      bearingDiff(q.facing, doorFacing) < bearingDiff(p.facing, doorFacing)
        ? q
        : p
    )
    // 门贴着内倾的墙面：绕墙面横轴后仰 tilt，门心随墙面在该高度的收进量往里挪
    const tilt = Math.atan(batter / (y0 + h - GROUND_Y))
    const yc = y0 + 1.4
    const m = local(
      f.m,
      f.len / 2,
      yc,
      PLATE_OFF - (yc - GROUND_Y) * Math.tan(tilt)
    ).multiply(new Matrix4().makeRotationX(-tilt))
    b.add(new PlaneGeometry(2.2, 2.8), C.shelterDoor, m)
  }
}

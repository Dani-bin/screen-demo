/*
 * 天府广场 · 南侧与东侧构筑物：两座「天书」雨棚、东入口下沉楼梯口、东南构筑物（草坡、槽带、白色斜玻璃）
 * ----------------------------------------------------------
 * 依据：设计文档第 3 节「南侧构筑物」、开头「用户航拍要点」（东侧草坪里有一块玻璃或采光构筑物）；
 * 调研报告 2.1（OSM 雨棚 w1395271429 / 30，屋顶 layer=1；东南构筑物 r19252926「带 6 个内环的草地」）、
 * 3.2（南缘两座白色「天书」雨棚 u −94.8～−37.3 与 41.3～98.8、v 91.5～97.8；东入口 u 80～96、v −26～−13，
 * 带玻璃栏板的下沉楼梯口；东南构筑物 u 61～99、v 17～52，草坡里嵌几条硬质槽带，西北部一块约 7 × 9 m 的
 * 白色斜玻璃）、4.2（新浪 2007-07-30：南侧地铁口的设计叫「天书地画」）、7（雨棚高度按照片比例估计）；
 * 按 Esri 影像量得的位置（东入口白板在 u 86～90、v −23～−16；东南白玻璃中心约 (88.6, 26.8)）。
 * 全部在设计系 (u, v) 里写，b.add 时乘 site.design。
 *
 * 构成（高度从铺装顶面 PAVE 算）：
 * - 「天书」雨棚：白色蝶形屋面，像一本摊开的书：两片书页沿长边中线（书脊）对折，书脊高 3.5、
 *   南北外沿翘到 4.6（坡约 19°，外沿顶面实测 4.73），书脊上一条深灰缝；两端各一块白色端墙、正中一道肋墙
 *   撑住书脊；北侧一道深青玻璃围护，一直做到屋面底下（衬出上面的白屋面）。书页带底面：材质只把背光面
 *   画进阴影贴图，悬空的屋面要有朝下的面才投影（同 index.js 的说明）。
 * - 东入口下沉楼梯口：矩形 u 91～97、v −25.5～−13.5，铺装经 index.js 的 cuts 挖口（EAST_ENTRY_CUT）。
 *   - 为什么不是设计的 u 80～96：这一带西半是东侧小草坪 w815853375（ground.js 的 LAWNS），草坪东边沿
 *     (89.5, −24.5)→(85.5, −14) 斜切，u 80～89.5 都在草坪里；挖口只能落在草坪以东的铺装上，取 6 m 宽，
 *     东边比设计多出 1 m 到 u 97（离林带内侧步道 BELT_PATH 内沿 u 103 仍有 6 m）。
 *   - 为什么只做 0.5 m 浅凹：设计与报告都没给楼梯口的深度；凹底 PAVE − 0.5 = 1.0 仍高于城市路面最高处 0.9
 *     （roads.js），而且实测广场范围内没有道路带，凹底下不会露出路面，也不必给城市地面挖洞。
 *   - 南端 3 级台阶下去，北半是深色凹底（读成通往地下）；东、西、北三面 1.1 m 玻璃栏板加深绿扶手，
 *     南端敞开作入口。
 *   - 白色斜罩（影像里那块白板）：在挖口西边、草坪斜边与西栏板之间，长边顺草坪斜边，宽 1.6、长 7.6；
 *     靠草坪的长边落在铺装上，靠挖口的长边抬高 1.5，下面是竖直的玻璃立面，整块立在地上、不悬空。
 * - 东南构筑物：轮廓取东南细草带（ground.js 的 LAWNS）内侧那几个点围成的六边形，草坡从西边的草坪高度
 *   （PAVE + 0.15）向东抬到东边 PAVE + 1.65（只随 u 变，约 2.2°），四周石材挡墙
 *   （与细草带共边的四条边从草坪顶面起，另两条边从铺装起，法线朝外）；
 *   坡上嵌 6 条 1.2 m 宽的深灰硬质槽带（影像里是暗色槽）：3 条南北向，3 条从西边垂直伸进坡里（影像里
 *   斜槽带与西边近乎垂直）；高出坡面 0.15，城市总览距离下不与坡面闪烁（同 kit/figures.js 的 PATTERN_LIFT）。
 *   白色斜玻璃 8 × 4（外包框约 8.3 × 9.1，即报告的约 7 × 9 m），中心 (88.6, 26.8)，长边顺西边，
 *   靠西的长边贴坡面、另一条长边抬高 2.4。
 * 两块斜玻璃（东入口斜罩、东南白玻璃）共用 glassWedge：三角形绕向一律按「法线背离楔体中心」统一，
 * 挡墙同样朝外——法线朝内会让整块面落在自己的阴影里发灰（城市阴影 normalBias 1 m + shadowSide BackSide）。
 *
 * 三角形（实测）：雨棚 2 × 74（书页 24、书脊缝 10、端墙 20、肋墙 10、玻璃 10）；东入口 106（凹壁 8、凹底 2、
 * 台阶 30、栏板与扶手 60、斜罩 6）；东南构筑物 80（草坡 4、挡墙 10、槽带 60、斜玻璃 6）。共 334，另 ground.js
 * 为东入口挖口多出 34，本件合计 368（设计第 5 节上限 1,200）。
 */
import { Matrix4 } from "three"
import { local } from "../kit/builder.js"
import { box, fromTriangles, sideWalls } from "../kit/shapes.js"
import { LAWN_TOP, flatTris } from "./ground.js"
import { C } from "./colors.js"
import { PAVE } from "./site.js"
import {
  cross,
  dot,
  pushUp,
  rectUV,
  sub,
  triMesh,
  triangulate
} from "./surface.js"

/* ---------------- 小工具 ---------------- */

// 三维向量 sub / cross / dot 在 surface.js；mean 取一组点的平均点
const mean = (ps) =>
  [0, 1, 2].map((k) => ps.reduce((s, p) => s + p[k], 0) / ps.length)

/**
 * 三角形绕向统一成「法线背离中心 c」（凸体的外表面朝外）。三角形为 [[x, y, z] × 3]
 */
function facingOut(tris, c) {
  return tris.map(([a, b, d]) => {
    const n = cross(sub(b, a), sub(d, a))
    return dot(n, sub(mean([a, b, d]), c)) < 0 ? [a, d, b] : [a, b, d]
  })
}

/**
 * 楔形斜玻璃（东入口白色斜罩、东南构筑物白色斜玻璃共用）。
 * 底面四边形 [lo0, lo1, hi1, hi0]（设计系 [u, v]）贴着 yAt(u, v) 给出的地面，不建底面；
 * 低边 lo0→lo1 贴地，高边 hi0→hi1 抬高 rise。斜顶面 + 高边一侧的竖直立面 + 两端三角，共 6 个三角形，
 * 绕向由 facingOut 统一朝外
 */
function glassWedge([lo0, lo1, hi1, hi0], rise, yAt) {
  const at = ([u, v], up = 0) => [u, yAt(u, v) + up, v]
  const L0 = at(lo0)
  const L1 = at(lo1)
  const B0 = at(hi0)
  const B1 = at(hi1)
  const H0 = at(hi0, rise)
  const H1 = at(hi1, rise)
  const tris = [
    // 斜顶面
    [L0, L1, H1],
    [L0, H1, H0],
    // 高边一侧的立面
    [B0, B1, H1],
    [B0, H1, H0],
    // 两端三角
    [L0, B0, H0],
    [L1, H1, B1]
  ]
  return triMesh(facingOut(tris, mean([L0, L1, B0, B1, H0, H1])))
}

/**
 * 沿一条直线 a → b（设计系 [u, v]）摆的平行四边形底面：低边从 a 起沿线偏 lo、高边偏 hi（法向 n 一侧），
 * 沿线方向取 s0～s1。返回 glassWedge 要的 [lo0, lo1, hi1, hi0]
 */
function stripAlong(a, dir, n, s0, s1, lo, hi) {
  const at = (s, t) => [
    a[0] + dir[0] * s + n[0] * t,
    a[1] + dir[1] * s + n[1] * t
  ]
  return [at(s0, lo), at(s1, lo), at(s1, hi), at(s0, hi)]
}

/** 单位方向 a → b 与它的法向 [dv, −du]：俯视（北在上，u 向东、v 向南）是方向逆时针转 90°，即沿 a→b 走时的左手边 */
function axisOf(a, b) {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1])
  const d = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
  return { d, n: [d[1], -d[0]] }
}

/* ---------------- 「天书」雨棚 ---------------- */

/** 两座雨棚的 u 区间（报告 3.2）；trees.js 据此让开南缘行道树的树冠 */
export const CANOPY_US = [
  [-94.8, -37.3],
  [41.3, 98.8]
]
// v 区间、书脊高、外沿高、书页厚（高度离铺装，估计值）
const CANOPY = { v0: 91.5, v1: 97.8, spineY: 3.5, edgeY: 4.6, t: 0.25 }
// 端墙厚 0.5，外面比书页端头缩进 0.1（不与书页端面共面）；肋墙厚 0.4 深 1.2；都立到书脊高
const CANOPY_END = { t: 0.5, inset: 0.1 }
const CANOPY_RIB = { t: 0.4, d: 1.2 }
// 北侧玻璃围护：离北沿 0.4、厚 0.12，顶伸进书页底面 0.05
const CANOPY_GLASS = { inset: 0.4, t: 0.12, tuck: 0.05 }
// 书脊深灰缝：宽 0.4、高 0.15，底在书脊高 + 0.1（嵌进书页），两端各缩进 0.1
const CANOPY_SEAM = { w: 0.4, h: 0.15, base: 0.1, inset: 0.1 }

/**
 * 一片书页：设计系里从书脊 (vSpine, spineY) 斜到外沿 (vEdge, edgeY) 的长方板，带底面。
 * inset 为两端各缩进的长度：两页在书脊处互相嵌着，端面若同在 u0 / u1 平面上会在那一小块共面闪烁，
 * 所以南页两端各缩进 1 cm
 */
function canopyPage(b, f, u0, u1, vSpine, vEdge, inset = 0) {
  const { spineY, edgeY, t } = CANOPY
  const dv = vEdge - vSpine
  const dy = edgeY - spineY
  const len = Math.hypot(dv, dy)
  // 绕 u 轴转 θ：局部 +z（向南）随 θ > 0 往下。北页（外沿在北）向南变低取 +θ，南页取 −θ
  const tilt = Math.atan2(dy, Math.abs(dv)) * (dv < 0 ? 1 : -1)
  const m = new Matrix4()
    .makeTranslation(
      (u0 + u1) / 2,
      PAVE + (spineY + edgeY) / 2,
      vSpine + dv / 2
    )
    .multiply(new Matrix4().makeRotationX(tilt))
    .multiply(new Matrix4().makeTranslation(0, -t / 2, 0))
    .premultiply(f)
  b.add(box(u1 - u0 - 2 * inset, t, len, { bottom: true }), C.canopy, m)
}

/** 北页在 v 处的底面高度（离铺装）：中面从外沿 edgeY 线性降到书脊 spineY，再减半个板厚的竖向投影 */
function northPageUnderside(v) {
  const { v0, v1, spineY, edgeY, t } = CANOPY
  const run = (v1 - v0) / 2
  const slope = (edgeY - spineY) / run
  const cos = run / Math.hypot(run, edgeY - spineY)
  return edgeY - slope * (v - v0) - t / 2 / cos
}

function buildCanopies(b, f) {
  const { v0, v1, spineY } = CANOPY
  const vm = (v0 + v1) / 2
  for (const [u0, u1] of CANOPY_US) {
    const uc = (u0 + u1) / 2
    canopyPage(b, f, u0, u1, vm, v0)
    canopyPage(b, f, u0, u1, vm, v1, 0.01)
    // 书脊深灰缝
    b.add(
      box(u1 - u0 - 2 * CANOPY_SEAM.inset, CANOPY_SEAM.h, CANOPY_SEAM.w),
      C.canopySeam,
      local(f, uc, PAVE + spineY + CANOPY_SEAM.base, vm)
    )
    // 两端端墙与正中肋墙，立到书脊
    const endOff = CANOPY_END.inset + CANOPY_END.t / 2
    for (const u of [u0 + endOff, u1 - endOff]) {
      b.add(box(CANOPY_END.t, spineY, v1 - v0), C.canopy, local(f, u, PAVE, vm))
    }
    b.add(
      box(CANOPY_RIB.t, spineY, CANOPY_RIB.d),
      C.canopy,
      local(f, uc, PAVE, vm)
    )
    // 北侧深青玻璃围护：夹在两端墙之间，从铺装做到北页底面以上 tuck
    const gv = v0 + CANOPY_GLASS.inset
    const gh = northPageUnderside(gv) + CANOPY_GLASS.tuck
    b.add(
      box(u1 - u0 - 2 * (CANOPY_END.inset + CANOPY_END.t), gh, CANOPY_GLASS.t),
      C.canopyGlass,
      local(f, uc, PAVE, gv)
    )
  }
}

/* ---------------- 东入口下沉楼梯口 ---------------- */

/** 东入口挖口矩形（设计系）：u 91～97、v −25.5～−13.5，只落在浅色外板里（位置理由见文件头） */
const EAST_ENTRY = { u0: 91, u1: 97, v0: -25.5, v1: -13.5 }
/** 交给 buildGround 的 cuts：铺装在这里挖口，凹里的墙、台阶、坑底由本文件建 */
export const EAST_ENTRY_CUT = rectUV(
  EAST_ENTRY.u0,
  EAST_ENTRY.u1,
  EAST_ENTRY.v0,
  EAST_ENTRY.v1
)
// 凹深 0.5：凹底 1.0 高于路面最高处 0.9（见文件头）
const ENTRY_FLOOR = PAVE - 0.5
// 南端 3 级台阶，每级沿 v 1.5 m、落差 0.125（第 3 级下来就是凹底）
const ENTRY_STEPS = { n: 3, run: 1.5, drop: 0.125 }
// 玻璃栏板：离挖口边 0.25、高 1.1、厚 0.08；扶手 0.12 × 0.08
const ENTRY_RAIL = { off: 0.25, h: 1.1, t: 0.08, hand: 0.12, handH: 0.08 }
/*
 * 白色斜罩：沿东侧小草坪的斜边 (89.5, −24.5)→(85.5, −14)（ground.js 的 LAWNS），从斜边起点量 2.1～9.7 m，
 * 低边离斜边 0.3、高边离斜边 1.9（宽 1.6），高边抬 1.5。外包框 u 86.3～90.5、v −22.4～−14.8，
 * 与影像白板（u 86～90、v −23～−16）相符；高边离西栏板外面 0.18 m
 */
const LAWN_EDGE = [
  [89.5, -24.5],
  [85.5, -14]
]
const ENTRY_HOOD = { s0: 2.1, s1: 9.7, lo: 0.3, hi: 1.9, rise: 1.5 }

function buildEastEntry(b, f) {
  const E = EAST_ENTRY
  const w = E.u1 - E.u0
  const uc = (E.u0 + E.u1) / 2
  // 凹壁（法线朝里）与凹底：台阶以北是深色凹底
  b.add(sideWalls(EAST_ENTRY_CUT, ENTRY_FLOOR, PAVE, true), C.stairStone, f)
  const stairN = E.v1 - ENTRY_STEPS.n * ENTRY_STEPS.run
  b.add(
    flatTris(triangulate(rectUV(E.u0, E.u1, E.v0, stairN)), ENTRY_FLOOR),
    C.stairDark,
    f
  )
  // 台阶：从南端（入口）往北一级比一级低
  for (let k = 0; k < ENTRY_STEPS.n; k++) {
    const top = PAVE - ENTRY_STEPS.drop * (k + 1)
    b.add(
      box(w, top - ENTRY_FLOOR, ENTRY_STEPS.run),
      C.stairStone,
      local(f, uc, ENTRY_FLOOR, E.v1 - ENTRY_STEPS.run * (k + 0.5))
    )
  }
  // 东、西、北三面玻璃栏板与扶手（南端敞开）。北面一道夹在东西两道的内侧面之间，转角不重叠
  const R = ENTRY_RAIL
  const sideLen = E.v1 - E.v0 + R.off
  const sideV = E.v0 - R.off + sideLen / 2
  const span = w + 2 * R.off
  for (const u of [E.u0 - R.off, E.u1 + R.off]) {
    b.add(box(R.t, R.h, sideLen), C.railGlass, local(f, u, PAVE, sideV))
    b.add(box(R.hand, R.handH, sideLen), C.rail, local(f, u, PAVE + R.h, sideV))
  }
  const vN = E.v0 - R.off
  b.add(box(span - R.t, R.h, R.t), C.railGlass, local(f, uc, PAVE, vN))
  b.add(
    box(span - R.hand, R.handH, R.hand),
    C.rail,
    local(f, uc, PAVE + R.h, vN)
  )
  // 白色斜罩：立在铺装上的楔形（见 ENTRY_HOOD）
  const { d, n } = axisOf(LAWN_EDGE[0], LAWN_EDGE[1])
  // n 取指向挖口（东）的一侧
  const east = n[0] > 0 ? n : [-n[0], -n[1]]
  const H = ENTRY_HOOD
  b.add(
    glassWedge(
      stripAlong(LAWN_EDGE[0], d, east, H.s0, H.s1, H.lo, H.hi),
      H.rise,
      () => PAVE
    ),
    C.whiteGlass,
    f
  )
}

/* ---------------- 东南构筑物 ---------------- */

/*
 * 轮廓（设计系）：东南细草带（ground.js 的 LAWNS）内侧的 5 个点 + 东南角 (99, 52)。
 * 西边 (63.5, 51.5)→(60.5, 49.5)→(69.5, 37)→(82, 19) 与北边 (82, 19)→(99, 18.5) 都与细草带共边
 * （SE_ON_LAWN 为真：挡墙从草坪顶面起，免得与草坪侧墙共面）；东边 u = 99、南边 v ≈ 52 挨着铺装
 */
const SE_OUTLINE = [
  [63.5, 51.5],
  [60.5, 49.5],
  [69.5, 37],
  [82, 19],
  [99, 18.5],
  [99, 52]
]
const SE_ON_LAWN = [true, true, true, true, false, false]
// 草坡：西端 u 60.5 处与草坪同高（LAWN_TOP），向东线性抬高到 u 99 处再高 1.5
const SE_SLOPE = { u0: 60.5, u1: 99, rise: 1.5 }
const slopeY = (u) =>
  LAWN_TOP + (SE_SLOPE.rise * (u - SE_SLOPE.u0)) / (SE_SLOPE.u1 - SE_SLOPE.u0)
// 西边的方向（由 (82, 19) 指向 (60.5, 49.5)，即向西南）与指向坡内的法向（≈ (0.82, 0.58)，朝东南：v 向南为正）
const SW_A = [82, 19]
const { d: SW_DIR, n: SW_IN } = axisOf(SW_A, [60.5, 49.5])
/*
 * 硬质槽带：3 条南北向（u 89、93.5、97.5，到 v 51；u 89 那条从 v 32 起，让开白玻璃），
 * 3 条从西边垂直伸进坡里：沿西边离 (82, 19) 16、22、28 m 处，从离西边 1 m 伸到 12 / 12 / 10 m
 */
const SE_CHANNELS_NS = [
  [89, 32, 51],
  [93.5, 20, 51],
  [97.5, 20, 51]
]
const SE_CHANNELS_CROSS = [
  [16, 1, 12],
  [22, 1, 12],
  [28, 1, 10]
]
const CHANNEL = { w: 1.2, lift: 0.15, sink: 0.15 }
// 白色斜玻璃：中心 (88.6, 26.8)，长 8 顺西边、宽 4 朝坡内，靠西的长边贴坡面、另一条抬高 2.4
const SE_GLASS = { c: [88.6, 26.8], len: 8, wid: 4, rise: 2.4 }

/**
 * 一条贴坡面的槽带：a → b（设计系 [u, v]）的长条，宽 w，顶面高出坡面 lift、底面低于坡面 sink
 * （顶面 + 四个侧面，法线朝外）。不用 kit 的 sweepBar：它末端的封口法线朝里，
 * 而改 kit 会动到其他景点的几何哈希
 */
function slopedBar(a, b, w, lift, sink) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const n = [(-(b[1] - a[1]) / len) * (w / 2), ((b[0] - a[0]) / len) * (w / 2)]
  const ring = [
    [a[0] + n[0], a[1] + n[1]],
    [b[0] + n[0], b[1] + n[1]],
    [b[0] - n[0], b[1] - n[1]],
    [a[0] - n[0], a[1] - n[1]]
  ]
  const top = ring.map(([u, v]) => [u, slopeY(u) + lift, v])
  const bot = ring.map(([u, v]) => [u, slopeY(u) - sink, v])
  const pos = [...top[0], ...top[1], ...top[2], ...top[0], ...top[2], ...top[3]]
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    pos.push(...bot[i], ...bot[j], ...top[j], ...bot[i], ...top[j], ...top[i])
  }
  return fromTriangles(pos)
}

/** 四周挡墙：每条边一块竖直四边形，底在铺装或草坪顶面、顶随坡面倾斜；法线朝外，零高度的三角形不建 */
function seWalls() {
  const tris = []
  SE_OUTLINE.forEach(([ua, va], i) => {
    const [ub, vb] = SE_OUTLINE[(i + 1) % SE_OUTLINE.length]
    const y0 = SE_ON_LAWN[i] ? LAWN_TOP : PAVE
    // 顶点按 b → a 走：SE_OUTLINE 在 (u, v) 平面里的绕向下，这样排的四边形法线朝外
    const quad = [
      [ub, y0, vb],
      [ua, y0, va],
      [ua, slopeY(ua), va],
      [ub, slopeY(ub), vb]
    ]
    for (const t of [
      [quad[0], quad[1], quad[2]],
      [quad[0], quad[2], quad[3]]
    ]) {
      const area = cross(sub(t[1], t[0]), sub(t[2], t[0]))
      if (Math.hypot(...area) > 1e-9) tris.push(t)
    }
  })
  return triMesh(tris)
}

function buildSoutheast(b, f) {
  // 草坡顶面：轮廓三角化后按 slopeY 抬高
  const pos = []
  for (const t of triangulate(SE_OUTLINE)) pushUp(pos, t, (u) => slopeY(u))
  b.add(fromTriangles(pos), C.grass, f)
  b.add(seWalls(), C.slopeWall, f)
  // 槽带：南北向 + 从西边垂直伸进坡里
  for (const [u, va, vb] of SE_CHANNELS_NS) {
    b.add(
      slopedBar([u, va], [u, vb], CHANNEL.w, CHANNEL.lift, CHANNEL.sink),
      C.channel,
      f
    )
  }
  const along = (s, t) => [
    SW_A[0] + SW_DIR[0] * s + SW_IN[0] * t,
    SW_A[1] + SW_DIR[1] * s + SW_IN[1] * t
  ]
  for (const [s, t0, t1] of SE_CHANNELS_CROSS) {
    b.add(
      slopedBar(
        along(s, t0),
        along(s, t1),
        CHANNEL.w,
        CHANNEL.lift,
        CHANNEL.sink
      ),
      C.channel,
      f
    )
  }
  // 白色斜玻璃：低边在靠西一侧（−SW_IN 方向）
  const G = SE_GLASS
  const a = [G.c[0] - SW_DIR[0] * (G.len / 2), G.c[1] - SW_DIR[1] * (G.len / 2)]
  b.add(
    glassWedge(
      stripAlong(a, SW_DIR, SW_IN, 0, G.len, -G.wid / 2, G.wid / 2),
      G.rise,
      (u) => slopeY(u)
    ),
    C.whiteGlass,
    f
  )
}

/* ---------------- 入口 ---------------- */

/**
 * 南侧两座「天书」雨棚、东入口下沉楼梯口、东南构筑物。
 * 东入口的铺装挖口（EAST_ENTRY_CUT）须由调用方交给 buildGround 的 cuts。
 * @param {ColorBuilder} b 静态件
 * @param {object} site 场地对象（site.js 的 createSite），用 site.design
 */
export function buildStructures(b, site) {
  const f = site.design
  buildCanopies(b, f)
  buildEastEntry(b, f)
  buildSoutheast(b, f)
}

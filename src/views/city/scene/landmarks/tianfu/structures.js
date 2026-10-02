/*
 * 天府广场 · 南侧与东侧构筑物：两座「天书」雨棚、东入口下沉楼梯口、东南构筑物（草坡、槽带、白色斜玻璃）
 * ----------------------------------------------------------
 * 依据：设计文档第 3 节「南侧构筑物」；调研报告 2.1（OSM 雨棚 w1395271429 / 30，屋顶 layer=1；
 * 东南构筑物 r19252926「带 6 个内环的草地」）、3.2（南缘两座白色「天书」雨棚 u −94.8～−37.3 与 41.3～98.8、
 * v 91.5～97.8；东入口 u 80～96、v −26～−13，带玻璃栏板的下沉楼梯口；东南构筑物 u 61～99、v 17～52，
 * 草坡里嵌几条硬质槽带，西北部一块约 7 × 9 m 的白色斜玻璃，即用户说的「东侧草坪里的玻璃」）、
 * 4.2（新浪 2007-07-30：南侧地铁口的设计叫「天书地画」）、7（雨棚高度按照片比例估计）；
 * Esri 影像按设计系重采样（东入口是一块深色矩形，里面有一块白色斜板；东南构筑物里南北向槽带 3 条、
 * 与西南边平行的斜槽带若干，白色斜玻璃贴着西南边）。全部在设计系 (u, v) 里写，b.add 时乘 site.design。
 *
 * 构成（高度从铺装顶面 PAVE 算）：
 * - 「天书」雨棚：白色蝶形屋面，像一本摊开的书：两片书页沿长边中线（书脊）对折，书脊高 3.5、
 *   南北外沿翘到 4.6（坡约 19°）；两端各一块白色端墙、正中一道肋墙撑住书脊，北侧一道玻璃围护。
 *   书页带底面：材质只把背光面画进阴影贴图，悬空的屋面要有朝下的面才投影（同 index.js 的说明）。
 * - 东入口下沉楼梯口：东侧小草坪东边那块铺装上（草坪轮廓在 u 85.5～89.5 斜切，见 ground.js 的 LAWNS），
 *   取 u 91～97、v −25.5～−13.5 的矩形，铺装经 index.js 的 cuts 挖口（EAST_ENTRY_CUT）；
 *   挖口下是 0.5 m 浅凹：南端 3 级台阶下去，北半是深色坑底（读成通往地下）；东、西、北三面 1.1 m 玻璃栏板
 *   加深绿扶手，南端敞开作入口；北半盖一块白色斜玻璃雨棚（影像里那块白色斜板），北高 2.6、南低 1.1。
 *   浅凹而不深挖：凹底 PAVE − 0.5 = 1.0，仍高于城市路面最高处 0.9（roads.js），不必给城市地面挖洞，
 *   也不会露出底下的路面（设计第 3 节允许「用浅凹加栏板表示」）。
 * - 东南构筑物：轮廓取东南细草带（ground.js 的 LAWNS）内侧那几个点围成的六边形，草坡从西南边的草坪高度
 *   （PAVE + 0.15）向东抬到东边 PAVE + 1.65（只随 u 变，约 2.2°），四周石材挡墙；
 *   坡上嵌 5 条 1.2 m 宽的浅色硬质槽带（3 条南北向、2 条与西南边平行），高出坡面 0.12；
 *   西北部一块 9 × 7 的白色斜玻璃（长边顺西南边，靠西南的一边贴着坡面、另一边抬高 2.4），
 *   西南边中段另一块 6 × 2.5 的小斜玻璃（影像里同一排的小白块）。
 *
 * 三角形（实测）：雨棚 2 × 64、东入口 106、东南构筑物 78，共 312；另 ground.js 铺装为东入口挖口多出 34，
 * 本件合计 346（设计第 5 节上限 1,200）。
 */
import { Matrix4 } from "three"
import { local } from "../kit/builder.js"
import { box, fromTriangles, sideWalls } from "../kit/shapes.js"
import { LAWN_TOP, flatTris } from "./ground.js"
import { C, PAVE, pushUp, rectUV, triMesh, triangulate } from "./site.js"

/* ---------------- 「天书」雨棚 ---------------- */

// 两座雨棚的 u 区间（报告 3.2）
const CANOPY_US = [
  [-94.8, -37.3],
  [41.3, 98.8]
]
// v 区间、书脊高、外沿高、书页厚（高度离铺装，估计值）
const CANOPY = { v0: 91.5, v1: 97.8, spineY: 3.5, edgeY: 4.6, t: 0.25 }
// 端墙厚 0.5、肋墙厚 0.4 深 1.2，都立到书脊高；北侧玻璃围护离北沿 0.4、高 3.4、厚 0.12
const CANOPY_END_T = 0.5
const CANOPY_RIB = { t: 0.4, d: 1.2 }
const CANOPY_GLASS = { inset: 0.4, h: 3.4, t: 0.12 }

/** 一片书页：设计系里从书脊 (vSpine, spineY) 斜到外沿 (vEdge, edgeY) 的长方板，带底面 */
function canopyPage(b, f, u0, u1, vSpine, vEdge) {
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
  b.add(box(u1 - u0, t, len, { bottom: true }), C.canopy, m)
}

function buildCanopies(b, f) {
  const { v0, v1, spineY } = CANOPY
  const vm = (v0 + v1) / 2
  for (const [u0, u1] of CANOPY_US) {
    canopyPage(b, f, u0, u1, vm, v0)
    canopyPage(b, f, u0, u1, vm, v1)
    // 两端端墙与正中肋墙，立到书脊
    for (const u of [u0 + CANOPY_END_T / 2, u1 - CANOPY_END_T / 2]) {
      b.add(box(CANOPY_END_T, spineY, v1 - v0), C.canopy, local(f, u, PAVE, vm))
    }
    b.add(
      box(CANOPY_RIB.t, spineY, CANOPY_RIB.d),
      C.canopy,
      local(f, (u0 + u1) / 2, PAVE, vm)
    )
    // 北侧玻璃围护（夹在两端墙之间）
    b.add(
      box(u1 - u0 - 2 * CANOPY_END_T, CANOPY_GLASS.h, CANOPY_GLASS.t),
      C.canopyGlass,
      local(f, (u0 + u1) / 2, PAVE, v0 + CANOPY_GLASS.inset)
    )
  }
}

/* ---------------- 东入口下沉楼梯口 ---------------- */

/** 东入口挖口矩形（设计系）：u 91～97、v −25.5～−13.5，只落在浅色外板里 */
export const EAST_ENTRY = { u0: 91, u1: 97, v0: -25.5, v1: -13.5 }
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
// 北半斜玻璃雨棚：北沿高 2.6、南沿高 1.1（与扶手齐），盖到凹的中线
const ENTRY_HOOD = { yN: 2.6, yS: 1.1 }

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
  // 东、西、北三面玻璃栏板与扶手（南端敞开）
  const R = ENTRY_RAIL
  const sideLen = E.v1 - E.v0 + R.off
  const sideV = E.v0 - R.off + sideLen / 2
  const panels = [
    [E.u0 - R.off, sideV, R.t, sideLen],
    [E.u1 + R.off, sideV, R.t, sideLen],
    [uc, E.v0 - R.off, w + 2 * R.off, R.t]
  ]
  for (const [u, v, sw, sd] of panels) {
    b.add(box(sw, R.h, sd), C.railGlass, local(f, u, PAVE, v))
    b.add(
      box(Math.max(sw, R.hand), R.handH, Math.max(sd, R.hand)),
      C.rail,
      local(f, u, PAVE + R.h, v)
    )
  }
  // 北半斜玻璃雨棚：楔形（斜顶面 + 北立面 + 东西两块三角侧面），底面敞开罩在凹上
  const vMid = (E.v0 + E.v1) / 2
  const yN = PAVE + ENTRY_HOOD.yN
  const yS = PAVE + ENTRY_HOOD.yS
  const pN0 = [E.u0, yN, E.v0]
  const pN1 = [E.u1, yN, E.v0]
  const pS0 = [E.u0, yS, vMid]
  const pS1 = [E.u1, yS, vMid]
  const bN0 = [E.u0, yS, E.v0]
  const bN1 = [E.u1, yS, E.v0]
  b.add(
    triMesh([
      // 斜顶面
      [pN0, pS1, pN1],
      [pN0, pS0, pS1],
      // 北立面（从扶手高到北沿）
      [bN0, pN1, bN1],
      [bN0, pN0, pN1],
      // 西、东两块三角侧面
      [bN0, pS0, pN0],
      [bN1, pN1, pS1]
    ]),
    C.whiteGlass,
    f
  )
}

/* ---------------- 东南构筑物 ---------------- */

/*
 * 轮廓（设计系）：东南细草带（ground.js 的 LAWNS）内侧的 5 个点 + 东南角 (99, 52)。
 * 西南边 (60.5, 49.5)→(69.5, 37)→(82, 19) 与细草带共边，北边 (82, 19)→(99, 18.5)，东边 u = 99
 */
const SE_OUTLINE = [
  [63.5, 51.5],
  [60.5, 49.5],
  [69.5, 37],
  [82, 19],
  [99, 18.5],
  [99, 52]
]
// 草坡：西端 u 60.5 处与草坪同高（LAWN_TOP），向东线性抬高到 u 99 处再高 1.5
const SE_SLOPE = { u0: 60.5, u1: 99, rise: 1.5 }
const slopeY = (u) =>
  LAWN_TOP + (SE_SLOPE.rise * (u - SE_SLOPE.u0)) / (SE_SLOPE.u1 - SE_SLOPE.u0)
/*
 * 硬质槽带（设计系端点）：3 条南北向（u 89、93.5、97.5，v 20～51），
 * 2 条与西南边 (82, 19)→(60.5, 49.5) 平行、向东北偏 9.5 m 与 16 m，北端停在 u 88.3（南北向第一条以西）、南端到 v 51
 */
const SE_CHANNELS = [
  [
    [89, 20],
    [89, 51]
  ],
  [
    [93.5, 20],
    [93.5, 51]
  ],
  [
    [97.5, 20],
    [97.5, 51]
  ],
  [
    [88.3, 26.6],
    [71.1, 51]
  ],
  [
    [88.3, 37.9],
    [79.1, 51]
  ]
]
const CHANNEL = { w: 1.2, lift: 0.12, sink: 0.18 }
// 西南边的方向（由 (82, 19) 指向 (60.5, 49.5)）与指向坡内（东北）的法向
const SW_A = [82, 19]
const SW_DIR = (() => {
  const d = [60.5 - 82, 49.5 - 19]
  const l = Math.hypot(d[0], d[1])
  return [d[0] / l, d[1] / l]
})()
const SW_IN = [SW_DIR[1], -SW_DIR[0]] // ≈ (0.82, 0.58)，指向东北
/*
 * 白色斜玻璃：中心 = 西南边起点 + along·边向 + off·内法向；长 len 顺西南边、宽 wid 朝坡内，
 * 靠西南的长边贴坡面，另一条长边抬高 rise。大块即报告的约 7 × 9 m（西北部），小块在西南边中段
 */
const SE_GLASS = [
  { along: 6.5, off: 3.6, len: 9, wid: 7, rise: 2.4 },
  { along: 22, off: 2.0, len: 6, wid: 2.5, rise: 1.2 }
]

/** 一条贴坡面的槽带：a → b 的长条，宽 w，顶面高出坡面 lift、底面低于坡面 sink（顶面 + 四个侧面） */
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

/** 一块斜玻璃：楔形（斜顶面 + 抬高那一侧的立面 + 两端三角），底面贴着坡面不建 */
function glassWedge({ along, off, len, wid, rise }) {
  const [ax, az] = SW_A
  const [dx, dz] = SW_DIR
  const [nx, nz] = SW_IN
  const at = (s, t) => [ax + dx * s + nx * t, az + dz * s + nz * t]
  const s0 = along - len / 2
  const s1 = along + len / 2
  const t0 = off - wid / 2
  const t1 = off + wid / 2
  // 低边（靠西南，贴坡面）与高边（坡内一侧）的点，y 取坡面高
  const lo = [at(s0, t0), at(s1, t0)].map(([u, v]) => [u, slopeY(u), v])
  const hiBase = [at(s0, t1), at(s1, t1)].map(([u, v]) => [u, slopeY(u), v])
  const hi = hiBase.map(([u, y, v]) => [u, y + rise, v])
  return triMesh([
    // 斜顶面
    [lo[0], hi[1], lo[1]],
    [lo[0], hi[0], hi[1]],
    // 抬高一侧的立面
    [hiBase[0], hiBase[1], hi[1]],
    [hiBase[0], hi[1], hi[0]],
    // 两端三角
    [lo[0], hiBase[0], hi[0]],
    [lo[1], hi[1], hiBase[1]]
  ])
}

function buildSoutheast(b, f) {
  // 草坡顶面：轮廓三角化后按 slopeY 抬高
  const pos = []
  for (const t of triangulate(SE_OUTLINE)) pushUp(pos, t, (u) => slopeY(u))
  b.add(fromTriangles(pos), C.grass, f)
  // 四周挡墙：每条边一块从铺装到坡面的竖直四边形（顶边随坡面倾斜）
  const walls = []
  SE_OUTLINE.forEach(([ua, va], i) => {
    const [ub, vb] = SE_OUTLINE[(i + 1) % SE_OUTLINE.length]
    const ya = slopeY(ua)
    const yb = slopeY(ub)
    walls.push(ua, PAVE, va, ub, PAVE, vb, ub, yb, vb)
    walls.push(ua, PAVE, va, ub, yb, vb, ua, ya, va)
  })
  b.add(fromTriangles(walls), C.slopeWall, f)
  for (const [a, c] of SE_CHANNELS) {
    b.add(slopedBar(a, c, CHANNEL.w, CHANNEL.lift, CHANNEL.sink), C.channel, f)
  }
  for (const g of SE_GLASS) b.add(glassWedge(g), C.whiteGlass, f)
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

/*
 * 天府广场 · 太阳神鸟盘
 * ----------------------------------------------------------
 * 依据：设计文档第 3 节「太阳神鸟盘」、调研报告 3.2 与 6.2；照片 old2（近景：金色盘面、红色旋涡太阳、
 * 4 只银鸟、不锈钢包边、黑色侧面）、c13 / c16（侧面：低矮深色鼓座、顶面朝南倾斜），影像 g21_disc
 * （俯视：红色太阳外一圈深金色环，再外是浅金盘面与银鸟，盘外一圈深色环）。
 * 设计系中心 (0, −0.3)，即 cityData.js 天府广场的落点（定位针挂在盘顶）。
 *
 * 构成（半径单位米）：
 * - 鼓座：直径 14.5，顶面朝南倾斜 5°：南缘比铺装高 0.62、北缘高 1.88（报告「南缘约 0.6、北缘约 1.9」），
 *   侧面黑色石材，上沿 0.3 m 是不锈钢包边（old2）；
 * - 顶面（同一倾斜平面上按颜色拼成，各块共面、互不重叠，所以不必一层层抬高防闪）：
 *   中心金色小圆 0.9 → 12 道顺时针旋出的金色弧形光芒与其间的红色楔块（太阳，外半径 2.8）
 *   → 太阳外缘深金色环（2.8～3.15）→ 浅金盘面（3.15～6.55，嵌 4 只逆时针飞的银鸟）
 *   → 细金环（6.55～6.85）→ 不锈钢包边（6.85～7.25）；
 *   光芒与银鸟的转向取金沙太阳神鸟：内圈旋涡顺时针、外圈四鸟逆时针，相背而行；
 * - 盘外深色环：半径 7.25～9.15（报告 3.2「外面深色环半径 9.1」），高出铺装 0.15，内沿伸进鼓座 5 cm 不留缝。
 *
 * 没有复用 kit/figures.js 的 addSunbirdDisc：它是一块水平的金色薄圆盘、纹样逐层抬高 0.15 m、
 * 光芒为浅金色，而这里要倾斜的鼓座、红色太阳与银鸟；kit 版的默认外观（kit 样例页仍在用）保持不变。
 */
import { local } from "../kit/builder.js"
import { fromTriangles } from "../kit/shapes.js"
import { C, PAVE, pushUp, triangulate } from "./site.js"

const DEG = Math.PI / 180

/** 神鸟盘中心（设计系）与鼓座半径（直径 14.5，报告 3.2、4.3） */
export const SUNBIRD = { u: 0, v: -0.3, r: 7.25 }
// 顶面倾角与盘心高度（离铺装顶面）：南北两缘各差 7.25·tan 5° ≈ 0.63
const TILT = Math.tan(5 * DEG)
const MID_H = 1.25
/** 盘顶最高处（北缘）离铺装顶面的高度 ≈ 1.88 */
export const SUNBIRD_TOP = MID_H + SUNBIRD.r * TILT
// 顶面各圈半径
const R_CORE = 0.9 // 中心金色小圆
const R_SUN = 2.8 // 太阳（光芒尖）外半径：直径 5.6 m（报告 6.2「直径约 5 m」，g21 俯视略大）
const R_SUN_RING = 3.15 // 太阳外缘深金色环
const R_FIELD = 6.55 // 浅金盘面外径
const R_GOLD_RING = 6.85 // 细金环外径
// 鼓座侧面上沿的不锈钢包边高度
const RIM_BAND = 0.3
// 盘外深色环：内径伸进鼓座 5 cm，外径 9.15，高出铺装 0.15
const RING_IN = SUNBIRD.r - 0.05
const RING_OUT = 9.15
const RING_H = 0.15
// 圆周分段：鼓座、各圈环 40 段（9° 一段，盘面直径 14.5 m 时弦长约 1.1 m）
const SEG = 40
// 太阳光芒：12 道，从中心小圆旋到太阳外径，沿途顺时针扫过 40°；分 6 段
const RAYS = 12
const RAY_SWEEP = 40 * DEG
const RAY_STEPS = 6
// 光芒半宽（方位角）：根部 12°（相邻光芒根部只隔 6°），尖端 1°
const rayHalf = (t) => (1 + 11 * Math.pow(1 - t, 1.2)) * DEG
// 银鸟：4 只，鸟身中线在半径 4.85 的圆上，分别在 45°、135°、225°、315° 方位（不正对南北）
const BIRD_R = 4.85
// 鸟形放大倍数：下面的轮廓长 3.2 m，放大到约 3.8 m（报告 6.2「每只约 3 m 长」是估计值，
// 照片 old2 里鸟身细长、几乎占满四分之一圈，3.2 m 的鸟在 40 m 近景里显得太小）
const BIRD_SCALE = 1.2
/*
 * 鸟的俯视轮廓（鸟身坐标：x 朝飞行方向，y 朝盘外，单位米，乘 BIRD_SCALE 后使用）：
 * 长喙、小头、细颈、弓背、分叉长尾，腹下一条前伸的腿（金沙太阳神鸟的鸟形，简化到 17 个点）
 */
const BIRD = [
  [1.6, 0.25],
  [1.1, 0.4],
  [0.9, 0.55],
  [0.6, 0.35],
  [0.3, 0.2],
  [-0.4, 0.35],
  [-1.0, 0.45],
  [-1.6, 0.6],
  [-1.4, 0.2],
  [-1.6, -0.1],
  [-0.9, -0.15],
  [-0.3, -0.35],
  [0.0, -0.75],
  [0.15, -0.35],
  [0.4, -0.1],
  [0.9, 0.2],
  [1.15, 0.2]
]

/**
 * 顶面高度（离 y = 0 的地面）：盘面是一个朝南倾斜的平面，(x, z) 为盘心坐标系的水平位置。
 * 北（−z）高、南（+z）低
 */
const topAt = (x, z) => PAVE + MID_H - z * TILT

/** 方位角 a、半径 r 处的点 [x, z]（盘心坐标系，a 从东起向南转，俯视顺时针） */
const polar = (a, r) => [Math.cos(a) * r, Math.sin(a) * r]

/** 两圈之间的环带：同一组方位角上内外两圈各取一点，逐段拼成四边形 */
function annulus(pos, angles, r0, r1, yAt) {
  const n = angles.length
  for (let i = 0; i < n; i++) {
    const a = angles[i]
    const c = angles[(i + 1) % n]
    const p0 = polar(a, r0)
    const p1 = polar(c, r0)
    const q0 = polar(a, r1)
    const q1 = polar(c, r1)
    pushUp(pos, [p0, q0, q1], yAt)
    pushUp(pos, [p0, q1, p1], yAt)
  }
}

/**
 * 太阳：中心金色小圆 + 12 道金色光芒 + 光芒之间的红色楔块。
 * 第 k 道光芒在参数 t（0 根部 → 1 尖端，半径 R_CORE → R_SUN）处的方位角为 k·30° + 40°·t，
 * 两侧边各偏 ±rayHalf(t)；红色楔块夹在第 k 道的右边与第 k + 1 道的左边之间。
 * @returns {number[]} 太阳外缘（t = 1）上的 24 个方位角，按角度递增（外缘深金环的内沿沿用这组角，顶点不错位）
 */
function addSun(gold, red) {
  const r = (t) => R_CORE + (R_SUN - R_CORE) * t
  const edges = (t) => {
    // 每道光芒的左、右边方位角，按 k 递增排好：[左0, 右0, 左1, 右1, …]
    const out = []
    for (let k = 0; k < RAYS; k++) {
      const mid = (k * 2 * Math.PI) / RAYS + RAY_SWEEP * t
      out.push(mid - rayHalf(t), mid + rayHalf(t))
    }
    return out
  }
  for (let s = 0; s < RAY_STEPS; s++) {
    const t0 = s / RAY_STEPS
    const t1 = (s + 1) / RAY_STEPS
    const e0 = edges(t0)
    const e1 = edges(t1)
    for (let j = 0; j < RAYS * 2; j++) {
      // j 为偶数：第 j/2 道光芒本身（左边 → 右边）；奇数：它右边到下一道左边的红色楔块
      const jn = (j + 1) % (RAYS * 2)
      const wrap = jn === 0 ? Math.PI * 2 : 0
      const a0 = polar(e0[j], r(t0))
      const b0 = polar(e0[jn] + wrap, r(t0))
      const a1 = polar(e1[j], r(t1))
      const b1 = polar(e1[jn] + wrap, r(t1))
      const pos = j % 2 === 0 ? gold : red
      pushUp(pos, [a0, b0, b1], topAt)
      pushUp(pos, [a0, b1, a1], topAt)
    }
  }
  // 中心金色小圆：以根部 24 个边角为扇形
  const root = edges(0)
  root.forEach((a, j) => {
    const c =
      root[(j + 1) % root.length] + (j + 1 === root.length ? Math.PI * 2 : 0)
    pushUp(gold, [[0, 0], polar(a, R_CORE), polar(c, R_CORE)], topAt)
  })
  return edges(1)
}

/** 第 k 只银鸟的轮廓（盘心坐标系）：逆时针飞（俯视），背朝盘外 */
function birdOutline(k) {
  const a = (45 + k * 90) * DEG
  const c = polar(a, BIRD_R)
  // 逆时针（俯视）的切向是方位角减小的方向 (sin a, −cos a)；盘外方向 (cos a, sin a)
  const fwd = [Math.sin(a), -Math.cos(a)]
  const out = [Math.cos(a), Math.sin(a)]
  return BIRD.map(([x, y]) => [
    c[0] + (fwd[0] * x + out[0] * y) * BIRD_SCALE,
    c[1] + (fwd[1] * x + out[1] * y) * BIRD_SCALE
  ])
}

/**
 * 建太阳神鸟盘。
 * @param {ColorBuilder} b 静态件
 * @param {object} site 场地对象（site.js 的 createSite），用 site.design
 * @returns {{ top: number }} 盘顶最高处（北缘）的世界高度，作定位针底座
 */
export function buildSunbird(b, site) {
  // 盘心坐标系：设计系平移到 (0, −0.3)，y 仍从地面算
  const f = local(site.design, SUNBIRD.u, 0, SUNBIRD.v)
  const R = SUNBIRD.r
  const ring = Array.from({ length: SEG }, (_, i) => (i / SEG) * Math.PI * 2)

  // 顶面各色块（同一倾斜平面）
  const gold = []
  const red = []
  const deep = []
  const silver = []
  const sunEdge = addSun(gold, red)
  // 太阳外缘深金环：内沿就是太阳外缘那 24 个点（光芒尖与红色楔块的弦），
  // 外沿另取均匀的 48 点，环的外轮廓才是圆的（只用 24 个不等距的点会看成十二边形）
  const sunRing = Array.from({ length: 48 }, (_, i) =>
    polar((i / 48) * Math.PI * 2, R_SUN_RING)
  )
  const sunIn = sunEdge.map((a) => polar(a, R_SUN))
  for (const t of triangulate(sunRing, [sunIn])) pushUp(deep, t, topAt)
  // 浅金盘面：外圈 40 点、内圈即深金环外沿，挖掉 4 只鸟
  const birds = [0, 1, 2, 3].map(birdOutline)
  const field = triangulate(
    ring.map((a) => polar(a, R_FIELD)),
    [sunRing, ...birds]
  )
  for (const t of field) pushUp(gold, t, topAt)
  for (const bird of birds) {
    for (const t of triangulate(bird)) pushUp(silver, t, topAt)
  }
  annulus(deep, ring, R_FIELD, R_GOLD_RING, topAt)
  annulus(silver, ring, R_GOLD_RING, R, topAt)
  b.add(fromTriangles(gold), C.sunGold, f)
  b.add(fromTriangles(red), C.sunRed, f)
  b.add(fromTriangles(deep), C.sunGoldDeep, f)
  b.add(fromTriangles(silver), C.sunSilver, f)

  // 鼓座侧面：从铺装顶面立到倾斜的盘沿，下段黑色石材、上段 0.3 m 不锈钢包边。
  // 盘沿顶点与顶面外圈同一组方位角，侧面上沿与顶面严丝合缝
  const side = []
  const band = []
  for (let i = 0; i < SEG; i++) {
    const [x0, z0] = polar(ring[i], R)
    const [x1, z1] = polar(ring[(i + 1) % SEG], R)
    const t0 = topAt(x0, z0)
    const t1 = topAt(x1, z1)
    // 方位角递增 = 俯视顺时针；(p0 低, p1 低, p1 高) 的法线朝外
    const quad = (pos, y0a, y0b, y1a, y1b) => {
      pos.push(x0, y0a, z0, x1, y1b, z1, x1, y0b, z1)
      pos.push(x0, y0a, z0, x0, y1a, z0, x1, y1b, z1)
    }
    quad(side, PAVE, PAVE, t0 - RIM_BAND, t1 - RIM_BAND)
    quad(band, t0 - RIM_BAND, t1 - RIM_BAND, t0, t1)
  }
  b.add(fromTriangles(side), C.discSide, f)
  b.add(fromTriangles(band), C.sunSilver, f)

  // 盘外深色环：顶面环带 + 外侧墙
  const dark = []
  annulus(dark, ring, RING_IN, RING_OUT, () => PAVE + RING_H)
  for (let i = 0; i < SEG; i++) {
    const [x0, z0] = polar(ring[i], RING_OUT)
    const [x1, z1] = polar(ring[(i + 1) % SEG], RING_OUT)
    dark.push(x0, PAVE, z0, x1, PAVE + RING_H, z1, x1, PAVE, z1)
    dark.push(x0, PAVE, z0, x0, PAVE + RING_H, z0, x1, PAVE + RING_H, z1)
  }
  b.add(fromTriangles(dark), C.discRing, f)

  return { top: PAVE + SUNBIRD_TOP }
}

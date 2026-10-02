/*
 * 天府广场 · 图腾柱 4 根、凤鸟路灯 12 盏
 * ----------------------------------------------------------
 * 依据：设计文档关键决策「图腾柱只做南北中轴 4 根」、第 3 节「图腾柱 4 根」「凤鸟路灯」；
 * 调研报告 0（结论第 5 条：绿色柱身、金色球顶、两侧卷耳，高约 12 m）、3.2（北对 (±17, −69) 卫星图上有长杆阴影）、
 * 4.1（照片 c15 图腾柱近景与凤鸟路灯，c28 南侧中轴一对图腾柱，old3 西北角的图腾柱与池北路灯）、
 * 4.2（景观中国 31539：凤鸟路灯 6.6 m 高、共 54 盏）、4.3（柱高取 12 m）、6.6（南对 (±17, +86) 由照片推断）；
 * 用户航拍「北缘道路边有挂红旗的灯杆」。全部在设计系 (u, v) 里定位，底在铺装顶面 PAVE。
 *
 * 图腾柱：kit addTotem，高 12（柱座、方形套筒、圆柱身、两道金箍、柱头、金球）。
 * - kit 默认 12 段柱身、14 × 10 段金球，一根 378 个三角形，4 根就占满本项预算；这里传 segments 8、
 *   ballSegments [8, 5]（kit 新增的可选项，默认值不变，kit 展示页的几何不变），一根 158 个；
 * - kit 的柱子没有卷耳，在本景点补：柱头两侧各一片卷曲的「耳」（c15、c28 里柱头下那对 S 形卷草），
 *   做成竖直的单层薄片（材质双面），面朝南北，从南面机位看得到；颜色同 kit 柱身绿。
 *
 * 凤鸟路灯（造型从简，c15）：灯杆 + 顶上 4 只斜伸的弯臂托火炬形白灯罩 + 杆顶一只，共 5 头，顶高 6.6。
 * - 布置 12 盏：北缘 6 盏（v −83，在绿篱与广场北沿之间；u ±27、±62、±97，对齐影像上北沿那排长杆阴影），
 *   每盏在 3.5～4.55 m 处挂一面 1.6 × 1.05 的小红旗（用户航拍）；东西步道内侧各 3 盏
 *   （u ±100.8，在草坪花带外沿 |u| 99.5 与林带内侧步道 BELT_PATH 内沿 |u| 103 之间；v −45、0、45）。
 * - 灯臂用 site.js 的 strut（3 段、不封顶，每只 6 个三角形），灯罩是上长下短的三棱双锥（6 个三角形）。
 *
 * 三角形（实测）：图腾柱 4 × (158 + 卷耳 2 × 8) = 696；路灯 12 × 64 + 小红旗 6 × 2 = 780；
 * 共 1,476（设计第 5 节「图腾柱 4 根、凤鸟路灯约 12 盏」上限 1,500）。
 */
import { local } from "../kit/builder.js"
import { TOTEM_GREEN, addTotem } from "../kit/figures.js"
import { cylinder, fromTriangles } from "../kit/shapes.js"
import { C, PAVE, strut, triMesh, triangulate } from "./site.js"
import { BELT_PATH } from "./trees.js"

/* ---------------- 图腾柱 ---------------- */

// 位置（设计系）：北对卫星图定位，南对照片推断（报告 3.2、6.6）
const TOTEMS = [
  [-17, -69],
  [17, -69],
  [-17, 86],
  [17, 86]
]
// kit addTotem 参数：高 12、柱半径 0.6；细分降一档（见文件头）
const TOTEM = { h: 12, r: 0.6, segments: 8, ballSegments: [8, 5] }
/*
 * 卷耳轮廓（柱局部 x 向外、y 向上，单位米）：从柱头侧面向外上方卷起，顶端向里回卷成钩。
 * 起点 (EAR_X, EAR_Y) 在柱头侧面以内一点（柱头半宽 1.1r = 0.66，从 10.2 m 到 10.68 m；
 * 金球从 10.65 m 到 11.97 m），卷耳顶到 11.17 m、外伸到 1.46 m。点按顺序围成简单多边形（不自交）
 */
const EAR = [
  [0, 0],
  [0.5, 0.15],
  [0.82, 0.5],
  [0.86, 0.95],
  [0.62, 1.22],
  [0.4, 1.08],
  [0.58, 0.9],
  [0.58, 0.62],
  [0.3, 0.4],
  [0, 0.42]
]
const EAR_X = 0.6
const EAR_Y = 9.95

/** 一对卷耳：柱局部 z = 0 的竖直平面上，左右对称（左耳取 x 的负值，点序反过来仍是同一多边形） */
function earPair() {
  const tris = triangulate(EAR.map(([x, y]) => [EAR_X + x, EAR_Y + y]))
  const pos = []
  for (const s of [1, -1]) {
    for (const t of tris) for (const [x, y] of t) pos.push(s * x, y, 0)
  }
  return fromTriangles(pos)
}

function buildTotems(b, f) {
  for (const [u, v] of TOTEMS) {
    const m = local(f, u, PAVE, v)
    addTotem(b, m, TOTEM)
    b.add(earPair(), TOTEM_GREEN, m)
  }
}

/* ---------------- 凤鸟路灯 ---------------- */

// 灯杆：高 5.4、底半径 0.16 → 顶 0.11，5 段；杆顶灯罩 5.4～6.6（顶高 6.6，报告 4.2）
const POLE = { h: 5.4, r0: 0.16, r1: 0.11, seg: 5 }
const TOP_BULB = { h: 1.2, r: 0.3 }
// 4 只弯臂：从杆上 4.9 m 处斜伸 0.95 m、抬高 0.6 m；臂端灯罩高 0.95。灯罩按 c15 的比例取得较大
// （一头约 0.5 m 宽、1 m 高），远看才读得出「一簇白灯头」。俯视转 45°，从南面看左右各两头
const ARM = { y: 4.9, reach: 0.95, rise: 0.6, r0: 0.07, r1: 0.05 }
const ARM_BULB = { h: 0.95, r: 0.26 }
// 北缘灯杆上的小红旗：1.6 × 1.05（3 : 2），下沿 3.5 m，沿 +u 飘出（与国旗同向）
const LAMP_FLAG = { w: 1.6, h: 1.05, y: 3.5, gap: 0.1 }

// 北缘 6 盏（挂小红旗）与东西步道内侧 6 盏（见文件头）
const NORTH_LAMP_V = -83
const NORTH_LAMP_U = [27, 62, 97]
const SIDE_LAMP_U = BELT_PATH.u - BELT_PATH.width / 2 - 2.2 // 100.8：离步道内沿 2.2 m
const SIDE_LAMP_V = [-45, 0, 45]

/**
 * 火炬形灯罩：上长下短的三棱双锥，底尖在 y = 0、顶尖在 y = h，腰（半径 r）在 0.35 h。
 * 三角形绕向使法线朝外（材质双面，绕向只影响背光面阴影）
 */
function bulb(h, r) {
  const yw = 0.35 * h
  const ring = [0, 1, 2].map((k) => {
    const a = (k / 3) * Math.PI * 2
    return [Math.cos(a) * r, yw, Math.sin(a) * r]
  })
  const pos = []
  for (let k = 0; k < 3; k++) {
    const p = ring[k]
    const q = ring[(k + 1) % 3]
    pos.push(0, h, 0, ...q, ...p)
    pos.push(0, 0, 0, ...p, ...q)
  }
  return fromTriangles(pos)
}

/** 一盏凤鸟路灯，底在 (u, PAVE, v)；flag 为真时在杆上挂小红旗 */
function addLamp(b, f, u, v, flag) {
  const m = local(f, u, PAVE, v)
  b.add(
    cylinder(POLE.r0, POLE.r1, POLE.h, { segments: POLE.seg }),
    C.lampPole,
    m
  )
  b.add(bulb(TOP_BULB.h, TOP_BULB.r), C.lampBulb, local(m, 0, POLE.h, 0))
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2
    const tip = [
      Math.cos(a) * ARM.reach,
      ARM.y + ARM.rise,
      Math.sin(a) * ARM.reach
    ]
    strut(b, m, [0, ARM.y, 0], tip, ARM.r0, ARM.r1, C.lampPole, {
      segments: 3,
      caps: false
    })
    b.add(
      bulb(ARM_BULB.h, ARM_BULB.r),
      C.lampBulb,
      local(m, tip[0], tip[1], tip[2])
    )
  }
  if (flag) {
    // 竖直的单层矩形旗面（面朝南北），贴着灯杆向 +u 伸出
    const x0 = LAMP_FLAG.gap
    const x1 = x0 + LAMP_FLAG.w
    const y0 = LAMP_FLAG.y
    const y1 = y0 + LAMP_FLAG.h
    const q = [
      [x0, y0, 0],
      [x1, y0, 0],
      [x1, y1, 0],
      [x0, y1, 0]
    ]
    b.add(
      triMesh([
        [q[0], q[1], q[2]],
        [q[0], q[2], q[3]]
      ]),
      C.flagRed,
      m
    )
  }
}

function buildLamps(b, f) {
  for (const s of [-1, 1]) {
    for (const u of NORTH_LAMP_U) addLamp(b, f, s * u, NORTH_LAMP_V, true)
  }
  for (const s of [-1, 1]) {
    for (const v of SIDE_LAMP_V) addLamp(b, f, s * SIDE_LAMP_U, v, false)
  }
}

/* ---------------- 入口 ---------------- */

/**
 * 图腾柱 4 根与凤鸟路灯 12 盏。
 * @param {ColorBuilder} b 静态件
 * @param {object} site 场地对象（site.js 的 createSite），用 site.design
 */
export function buildFurniture(b, site) {
  const f = site.design
  buildTotems(b, f)
  buildLamps(b, f)
}

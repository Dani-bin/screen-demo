/*
 * 天府广场 · 东鱼眼「黄河龙」中心雕塑（立在下沉广场坑底中央）
 * ----------------------------------------------------------
 * 依据：调研报告 4.2（新浪 2007-07-30：高 17.2 m、龙长 40 多米；景观中国 31583：两个托盘直径都是 12 m）、
 * 4.3（上托盘按照片取约 9 m）、6.4（构件尺寸）、6.9（颜色）；照片 c00、c07、c09～c12、c25～c27。
 * 坑与周边构件见 eastEye.js；托盘旋转体、水池、金龙扁带与龙首的做法与西鱼眼共用（sculpture.js）。
 * 全部在「鱼眼坐标系」里写（设计系平移到坑心，x 沿 u、z 沿 v），高度一律写成「坑底 + 离坑底的高度」。
 *
 * 构成（高度从坑底算）：
 * - 圆池：直径 11，池壁高 0.7；柱脚四个墨绿方墩（c00、c07、c09）；
 * - 柱身：墨绿，直径 3.1，上下两道金色回纹带、中段两道云纹带；
 * - 下托盘：直径 12，盘面 7.5；两盘之间白色中柱；上托盘：直径 9，盘面 12.5；白杆到 16.3；
 * - 金龙：扁带从下托盘面起盘绕上升，龙首顶 17.2（约高出广场铺装 11 m）。
 *
 * 三角形（实测）：圆池 256、方墩 40、柱身与金带 200、下托盘 288、中柱 24、上托盘 308、白杆 36、
 * 金龙 556（扁带 484，其中底面 120；龙首 72），共 1,708。
 *
 * 与报告 6.4 不同之处：柱身直径报告写 3.4。照片里柱宽与下托盘宽之比，c09 为 122 / 487 px，
 * c00 为 125 / 497 px，c25 为 95 / 356 px（两者在同一深度），按托盘 12 m 折算为 3.0～3.2 m，取 3.1。
 */
import { local } from "../kit/builder.js"
import { box, cylinder } from "../kit/shapes.js"
import { C } from "./site.js"
import {
  DRAGON_HEAD_TOP,
  TUCK,
  addDragon,
  addPool,
  addRevolved
} from "./sculpture.js"

const DEG = Math.PI / 180

/* ---------------- 尺寸（高度从坑底算） ---------------- */

// 柱身：直径 3.1（见文件头），20 段，从池水面到下托盘底面里
const COLUMN = { r: 1.55, seg: 20, top: 6.55 }
// 圆池：直径 11（报告 6.4），池壁高 0.7、厚 0.4，水面 0.45；水面从柱身铺到池壁。32 段
const POOL = {
  r: 5.5,
  t: 0.4,
  h: 0.7,
  water: 0.45,
  inner: COLUMN.r,
  seg: 32,
  wall: C.marbleDark,
  top: C.marbleLight
}
// 柱脚四个墨绿方墩（c00、c07、c09）：1.1 见方、高 0.95，立在池里半径 2.45 处
const PEDESTAL = { size: 1.1, h: 0.95, r: 2.45 }
// 柱身金带 [底, 顶, 颜色]：上下两道回纹带（c09、c12）、中段两道云纹带（远看读成金纹满身）
const COLUMN_BANDS = [
  [0.4, 1.1, C.sculptGold],
  [2.4, 2.9, C.goldPattern],
  [3.9, 4.4, C.goldPattern],
  [5.6, 6.3, C.sculptGold]
]
/*
 * 托盘剖面 [半径, 离坑底高度]：从盘面中心向外、沿盘沿下折、再沿底面倒锥回到柱子（同 westEye.js 的写法）。
 * 下托盘直径 12、盘面 7.5（报告 6.4）；上托盘按报告 4.3 取直径 9、盘面 12.5，盘面上一圈金色回纹
 * （c09、卫星图俯视都看得到）。底面外圈金色回纹带、近柱金色云纹带（c09、c11）
 */
const LOWER_TRAY = [
  { p: [0, 7.5], color: C.tray },
  { p: [6, 7.5], color: C.trayRim },
  { p: [6, 7.2], color: C.goldPattern },
  { p: [5.3, 7.05], color: C.tray },
  { p: [3.0, 6.65], color: C.goldPattern },
  { p: [COLUMN.r - 0.05, 6.45] }
]
const UPPER_TRAY = [
  { p: [0, 12.5], color: C.tray },
  { p: [2.6, 12.5], color: C.goldPattern },
  { p: [3.3, 12.5], color: C.tray },
  { p: [4.5, 12.5], color: C.trayRim },
  { p: [4.5, 12.2], color: C.goldPattern },
  { p: [3.9, 12.05], color: C.tray },
  { p: [0.55, 11.5] }
]
const LOWER_SEG = 32
const UPPER_SEG = 28
// 两盘之间的白色中柱：直径 1.2（c09 约 45 px，按柱身比例折算），12 段
const MID_COLUMN = { r: 0.6, y0: 7.4, y1: 11.6, seg: 12 }
// 白杆：上盘面 12.5 到 16.3（报告 6.4），直径 0.66（c09 约 25 px），12 段带顶盖
const POLE = { r: 0.33, y1: 16.3, seg: 12 }

/*
 * 金龙飘带：截面竖直，宽 1.6、厚 0.3（c25：带宽约为柱径的一半）。
 * 中线关键点 [方位角°, 半径, 中线离坑底高度]，中线 ± 0.8 是带子上下沿：
 * - 60°：龙尾落在下托盘面上（下沿 7.4，压进盘面 0.1）；
 * - 140°～300°：绕出下托盘外缘（半径 6）成一个大环，逐渐升高（c25、c27 两盘之间的大环）；
 * - 370°～490°：在上托盘外缘（半径 4.5、盘面 12.5）外侧升过上盘面，再从盘沿上方向内收；
 *   带子离上托盘处处 ≥ 0.25 m（审查脚本 edragon.mjs 实测最近 0.49 m，在上盘沿顶角）；
 * - 540°～610°：在上盘面以上向内收到白杆旁（半径 1.2），末端中线 16.3，龙首顶 16.3 + 0.9 = 17.2
 *   （报告 4.2：雕塑高 17.2；末端中线由 SCULPTURE_TOP 减去 DRAGON_HEAD_TOP 得到）。
 * 中线全长 52.8 m（实测；报告 4.2「龙长 40 多米」）。俯视顺时针上升，与西鱼眼同向。
 */
const SCULPTURE_TOP = 17.2
const DRAGON = {
  thick: 0.3,
  half: 0.8,
  keys: [
    [60, 4.4, 8.2],
    [140, 5.8, 8.6],
    [220, 6.6, 9.3],
    [300, 6.6, 10.1],
    [370, 5.9, 10.9],
    [430, 5.3, 12.0],
    [490, 5.2, 13.5],
    [540, 3.4, 14.4],
    [580, 2.0, 15.5],
    [610, 1.2, SCULPTURE_TOP - DRAGON_HEAD_TOP]
  ],
  chord: 0.9,
  maxStep: 12 * DEG
}

/* ---------------- 入口 ---------------- */

/**
 * 东鱼眼中心雕塑：圆池、柱脚方墩、柱身与金带、两层托盘、中柱、白杆、金龙。
 * 调用顺序决定合批后的顶点顺序，不要随意调换。
 * @param {ColorBuilder} b 静态件
 * @param {Matrix4} f 鱼眼坐标系（设计系平移到坑心，y 仍从地面算）
 * @param {number} floor 坑底高度（eastEye.js 的 PIT_FLOOR）
 */
export function buildEastSculpture(b, f, floor) {
  const at = (y) => local(f, 0, floor + y, 0)
  addPool(b, f, POOL, floor)
  // 柱脚方墩：45° 起每 90° 一个，方墩一面朝坑心
  for (let i = 0; i < 4; i++) {
    const a = (45 + 90 * i) * DEG
    b.add(
      box(PEDESTAL.size, PEDESTAL.h, PEDESTAL.size),
      C.columnGreen,
      local(
        f,
        Math.cos(a) * PEDESTAL.r,
        floor + POOL.water - TUCK,
        Math.sin(a) * PEDESTAL.r,
        -a
      )
    )
  }
  // 柱身：从水面下到下托盘底面里（开口圆柱，两头都看不见）
  const col0 = POOL.water - TUCK
  b.add(
    cylinder(COLUMN.r, COLUMN.r, COLUMN.top - col0, { segments: COLUMN.seg }),
    C.columnGreen,
    at(col0)
  )
  for (const [y0, y1, color] of COLUMN_BANDS) {
    b.add(
      cylinder(COLUMN.r + 0.05, COLUMN.r + 0.05, y1 - y0, {
        segments: COLUMN.seg
      }),
      color,
      at(y0)
    )
  }
  // 两层托盘与中柱、白杆
  addRevolved(b, f, LOWER_TRAY, LOWER_SEG, floor)
  b.add(
    cylinder(MID_COLUMN.r, MID_COLUMN.r, MID_COLUMN.y1 - MID_COLUMN.y0, {
      segments: MID_COLUMN.seg
    }),
    C.sculptPole,
    at(MID_COLUMN.y0)
  )
  addRevolved(b, f, UPPER_TRAY, UPPER_SEG, floor)
  const trayTop = UPPER_TRAY[0].p[1]
  b.add(
    cylinder(POLE.r, POLE.r, POLE.y1 - trayTop, {
      segments: POLE.seg,
      caps: true
    }),
    C.sculptPole,
    at(trayTop)
  )
  // 金龙：扁带（带底面）+ 龙首（sculpture.js，与西鱼眼共用）
  addDragon(b, f, DRAGON, floor)
}

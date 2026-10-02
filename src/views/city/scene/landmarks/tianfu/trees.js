/*
 * 天府广场 · 东西林带、南缘行道树与林带内侧步道
 * ----------------------------------------------------------
 * 依据：设计文档第 3 节「树」；调研报告 2.1（OSM 树 24 棵：西林带、东侧、南缘一排）、3.2（东西林带
 * 西 u −147～−111、东 u 111～146，乔木密植；林带内侧各有一条约 11 m 宽的南北步道 u ±99～±111；
 * 雨棚南侧 v ≈ 101 有一排树）、6.6（每侧 3 排、南缘一排约 8 棵）、6.7（步道 u ≈ ±105）；
 * Esri 影像按设计系重采样（林带树冠连成一片，西林带 u −134～−116、v 0～28 与东林带 u 125～138、
 * v −5～25 各有一块空地：小路与小屋）；用户航拍「东西两侧行道树成林」「南缘一排树」。
 * 整个广场都在替换区里，通用树撒不进来（铺装 1.5 m 也高过 1.2 m 的占用阈值，报告 5），所以由景点自己种。
 * 全部在设计系 (u, v) 里定位，种树时换成世界坐标（kit addTree 收世界坐标）。
 *
 * 构成：
 * - 林下草地：两块矩形（西 u −146～−111、东 u 111～142，v −62～70 / 71），高同草坪 0.15，比草坪暗一档，
 *   衬在树冠下，林带从高处看是连成一片的深绿（不用 OSM 林带多边形：它只是林下草地的一部分，
 *   树冠实际铺满两条带子）。
 * - 林带乔木：每侧 3 排（|u| 118、127.5、137），排内间距 23 m、中排错开半档，空地处不种；
 *   冠半径 7.2～8.6、干高 4.2～5.2，与城市通用树（冠 7～12）同一量级；冠径 14～17 m 大于斜向邻树间距
 *   （约 15 m），相邻树冠交叠，从高处看林带连成一片（30 来棵树铺满两条 35 × 130 m 的带子）。
 * - 南缘一排：v ≈ 101.5，u ±10、±32、±54、±76、±98 共 10 棵，冠半径 4.6～5.4、干高 5：
 *   树冠伸到「天书」雨棚上方时，冠底已高过雨棚顶（4.5 m），不穿模。
 * - 位置、冠径、干高、颜色的抖动用固定种子的伪随机数，几何每次构建逐位相同。
 * 全部用 kit addTree 的 detail 0（二十面体树冠 20 面 + 六棱树干 12 面，每棵 32 个三角形）。
 *
 * 林带内侧步道（BELT_PATH，Task 8 重排时可沿用）：u = ±105、宽 4，v −78 → 73。
 * - 北端离北缘灯杆（v −83）5 m；南端停在南侧两条草带（v 77.5 起，东带伸到 u 111、西带到 u −113）以北 4.5 m；
 * - 两侧：内侧最近是草坪花带外沿（|u| 99～99.5）、北池东西端（|u| 101.5）、凤鸟路灯杆（|u| 100.8），
 *   外侧林带乔木内排最靠里的树干在 |u| 116.8，冠下沿约 2.5 m 以上，冠在 4.35 m（人头高）以下只是
 *   底部一小截（水平半径不到 4 m），离步道外沿 |u| 107 还有几米。
 *
 * 三角形（实测）：林下草地 2 × 10；乔木 42 棵（林带每侧 18 个树位、空地处去掉 4 个，共 32 棵；南缘 10 棵）
 * × 32 = 1,344（树上限 1,400）；草地 20 计入「绿篱与花带」。
 */
import { addTree } from "../kit/figures.js"
import { extrudePolygon } from "../kit/shapes.js"
import { LAWN_TOP } from "./ground.js"
import { C, PAVE, rectUV } from "./site.js"

/* ---------------- 布局 ---------------- */

/** 林带内侧南北步道（设计系）：u = ±105、宽 4、v −78 → 73，每米人数系数 density 1（见文件头） */
export const BELT_PATH = { u: 105, width: 4, v0: -78, v1: 73, density: 1 }

// 林下草地（设计系矩形 [u0, u1, v0, v1]）：东边按广场面东沿（u 146 → 143 斜收）留出 1 m
const FOREST_FLOORS = [
  [-146, -111, -62, 70],
  [111, 142, -62, 71]
]

// 林带三排的 |u|（内排、中排、外排）与各排树的 v：内外排同档，中排错开半档并补北南两端
const BELT_ROWS = [
  { u: 118, vs: [-56, -33, -10, 13, 36, 59] },
  { u: 127.5, vs: [-44.5, -21.5, 1.5, 24.5, 47.5, 69] },
  { u: 137, vs: [-56, -33, -10, 13, 36, 59] }
]
// 林带里的空地（影像：小路与小屋），树干落在里面的不种。[u0, u1, v0, v1]
const CLEARINGS = [
  [-134, -116, 0, 28],
  [125, 138, -5, 25]
]
// 林带乔木：冠半径 7.2～8.6、干高 4.2～5.2；位置抖动 u ±1.2、v ±3
const BELT_TREE = { r: [7.2, 8.6], trunkH: [4.2, 5.2], du: 1.2, dv: 3 }

// 南缘一排：v 101.5，u 取正负对称的 5 档
const SOUTH_ROW = { v: 101.5, us: [10, 32, 54, 76, 98] }
// 南缘行道树：冠半径 4.6～5.4、干高 5（冠底高过雨棚顶，见文件头）；u 抖动 ±1
const SOUTH_TREE = { r: [4.6, 5.4], trunkH: 5, du: 1 }

/* ---------------- 伪随机 ---------------- */

/** 固定种子的伪随机数（mulberry32），返回 [0, 1) 的生成器：几何每次构建逐位相同 */
function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const lerp = ([a, b], t) => a + (b - a) * t
const inRect = (u, v, [u0, u1, v0, v1]) =>
  u >= u0 && u <= u1 && v >= v0 && v <= v1

/* ---------------- 种树 ---------------- */

/** 林带与南缘的树位（设计系，含抖动）：[{ u, v, r, trunkH, yaw, color, y }] */
function treeSpots() {
  const rand = seeded(20261002)
  const out = []
  for (const s of [-1, 1]) {
    for (const row of BELT_ROWS) {
      for (const v0 of row.vs) {
        // 每棵树固定取 5 个随机数（空地处也取），抖动不随种不种而串位
        const [a, c, d, e, g] = [rand(), rand(), rand(), rand(), rand()]
        const u = s * row.u + (a * 2 - 1) * BELT_TREE.du
        const v = v0 + (c * 2 - 1) * BELT_TREE.dv
        if (CLEARINGS.some((q) => inRect(u, v, q))) continue
        out.push({
          u,
          v,
          r: lerp(BELT_TREE.r, d),
          trunkH: lerp(BELT_TREE.trunkH, e),
          yaw: g * Math.PI * 2,
          color: C.forest[Math.floor(g * 997) % C.forest.length],
          // 树根落在林下草地上；抖动到草地外（中排北南两端）的落在铺装上
          y: FOREST_FLOORS.some((q) => inRect(u, v, q)) ? LAWN_TOP : PAVE
        })
      }
    }
  }
  for (const s of [-1, 1]) {
    for (const u0 of SOUTH_ROW.us) {
      const [a, d, g] = [rand(), rand(), rand()]
      out.push({
        u: s * u0 + (a * 2 - 1) * SOUTH_TREE.du,
        v: SOUTH_ROW.v,
        r: lerp(SOUTH_TREE.r, d),
        trunkH: SOUTH_TREE.trunkH,
        yaw: g * Math.PI * 2,
        color: C.forest[Math.floor(g * 997) % C.forest.length],
        y: PAVE
      })
    }
  }
  return out
}

/* ---------------- 入口 ---------------- */

/**
 * 东西林带（林下草地 + 乔木）与南缘一排行道树。
 * @param {ColorBuilder} b 静态件
 * @param {object} site 场地对象（site.js 的 createSite），用 site.design、site.toWorld
 * @returns {{ walkways: Array }} 林带内侧两条南北步道（世界坐标）
 */
export function buildTrees(b, site) {
  const f = site.design
  for (const [u0, u1, v0, v1] of FOREST_FLOORS) {
    b.add(
      extrudePolygon(rectUV(u0, u1, v0, v1), [], PAVE, LAWN_TOP),
      C.forestFloor,
      f
    )
  }
  for (const t of treeSpots()) {
    const [x, z] = site.toWorld(t.u, t.v)
    addTree(b, x, t.y, z, {
      r: t.r,
      color: t.color,
      trunkH: t.trunkH,
      yaw: t.yaw,
      detail: 0
    })
  }
  const P = BELT_PATH
  return {
    walkways: [-1, 1].map((s) => ({
      points: site.toWorldPts([
        [s * P.u, P.v0],
        [s * P.u, P.v1]
      ]),
      y: PAVE,
      width: P.width,
      closed: false,
      density: P.density
    }))
  }
}

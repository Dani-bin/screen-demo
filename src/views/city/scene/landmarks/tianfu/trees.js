/*
 * 天府广场 · 东西林带、南缘行道树与林带内侧步道
 * ----------------------------------------------------------
 * 依据：设计文档第 3 节「树」、第 5 节预算（执行时修订：东西林带 4 排错位 + 南缘一排，约 55 棵，上限 2,200）、
 * 开头「用户航拍要点」（广场东西两侧行道树成林，南缘有一排树）；调研报告 2.1（OSM 树 24 棵：西林带、东侧、
 * 南缘一排）、3.2（东西林带西 u −147～−111、东 u 111～146，乔木密植；林带内侧各有一条约 11 m 宽的南北步道
 * u ±99～±111；雨棚南侧 v ≈ 101 有一排树）、6.7（步道 u ≈ ±105）；Esri 影像按设计系重采样
 * （林带树冠几乎铺满，西林带 u −134～−116、v 0～28 与东林带 u 125～138、v −5～25 各有一块空地：小路与小屋）。
 * 整个广场都在替换区里，通用树撒不进来（铺装 1.5 m 也高过 1.2 m 的占用阈值，报告 5），所以由景点自己种。
 * 全部在设计系 (u, v) 里定位，种树时换成世界坐标（kit addTree 收世界坐标）。
 *
 * 构成：
 * - 林下草地：两块矩形（西 u −146～−111、东 u 111～142，v −62～70 / 71），高同草坪 0.15，深绿 #4A7A3A，
 *   比广场草坪暗得多，树冠之间露出的地面也读成林下（不用 OSM 林带多边形：它只是林下草地的一部分）。
 * - 林带乔木：每侧 4 排（|u| 116.5、124.5、132.5、140）错位，排内间距 17 m，相邻两排错开半档，
 *   空地处不种；冠半径 7.2～8.6，与城市通用树（冠 7～12）同一量级。干高 3.2～4.0（比 Task 6 初版低 1～1.2 m，
 *   冠径放大后树顶仍在 18～22 m）。树冠覆盖率见文末「实测」。
 * - 南缘一排：u ±24、±44、±62、±80、±98 共 10 棵，干高 5。±24 那两棵在南对图腾柱（u ±15）与雨棚之间，
 *   冠半径 4.6～5.4、v 101.5；其余 8 棵的树冠横向落在「天书」雨棚的 u 区间里，冠半径收到 4.0～4.4、
 *   树往南挪到 v 102.5：冠北缘 ≥ 98.1，在雨棚南沿 v 97.8 以南，任何高度都不压雨棚（雨棚外沿顶 4.73 m）。
 * - 位置、冠径、干高、颜色的抖动用固定种子的伪随机数（utils.js 的 mulberry32），几何每次构建逐位相同。
 * 全部用 kit addTree 的 detail 0（二十面体树冠 20 面 + 六棱树干 12 面，每棵 32 个三角形）。
 *
 * 林带内侧步道：位置与理由见 site.js 的 BELT_PATH（Task 8 沿用；南端与 walkways.js 的南侧东西横线相接）。两侧最近的障碍：
 * 内侧是草坪花带外沿（|u| 99～99.5）、北池东西端（|u| 101.5）、凤鸟路灯杆（|u| 100.8）；
 * 外侧林带内排最靠里的树干在 |u| 115.5（实测），冠下沿约 1.5 m，但冠在 4.35 m（人头高）以下只是底部一截
 * （水平半径约 6 m 以内），离步道外沿 |u| 107 还有 2 m 以上（walk 校验 0 坏点）。
 *
 * 实测：林带树冠覆盖率 82%（只看林下草地矩形、扣除空地，1 m 网格，可见冠半径取 0.9 r；按完整冠半径算 89%），
 * Task 6 初版 3 排 32 棵时为 59% / 69%。
 * 三角形（实测）：林下草地 2 × 10；乔木 64 棵（林带每侧 30 个树位、空地处去掉 6 个共 54 棵，南缘 10 棵）
 * × 32 = 2,048（设计第 5 节修订后的树上限 2,200）；草地 20 计入「绿篱与花带」。
 */
import { addTree } from "../kit/figures.js"
import { extrudePolygon } from "../kit/shapes.js"
import { LAWN_TOP } from "./ground.js"
import { mulberry32 } from "../../utils.js"
import { BELT_PATH, C, PAVE, rectUV } from "./site.js"
import { CANOPY_US } from "./structures.js"

/* ---------------- 布局 ---------------- */

// 林下草地（设计系矩形 [u0, u1, v0, v1]）：东边按广场面东沿（u 146 → 143 斜收）留出 1 m
const FOREST_FLOORS = [
  [-146, -111, -62, 70],
  [111, 142, -62, 71]
]

// 林带 4 排的 |u|（由内到外）；偶数排（第 1、3 排）与奇数排（第 2、4 排）的 v 错开半档（8.5 m）
const BELT_ROWS = [116.5, 124.5, 132.5, 140]
const BELT_VS = [
  [-56, -39, -22, -5, 12, 29, 46, 63],
  [-47.5, -30.5, -13.5, 3.5, 20.5, 37.5, 54.5]
]
// 林带里的空地（影像：小路与小屋），树干落在里面的不种。[u0, u1, v0, v1]
const CLEARINGS = [
  [-134, -116, 0, 28],
  [125, 138, -5, 25]
]
// 林带乔木：冠半径 7.2～8.6、干高 3.2～4.0；位置抖动 u ±1.2、v ±3
const BELT_TREE = { r: [7.2, 8.6], trunkH: [3.2, 4.0], du: 1.2, dv: 3 }

// 南缘一排：u 取正负对称的 5 档；u 抖动 ±1、干高 5
const SOUTH_ROW = { us: [24, 44, 62, 80, 98], du: 1, trunkH: 5 }
// 树冠不碰雨棚的：v 101.5、冠半径 4.6～5.4；树冠横向落进雨棚 u 区间的：南挪到 v 102.5、冠半径 4.0～4.4
const SOUTH_OPEN = { v: 101.5, r: [4.6, 5.4] }
const SOUTH_UNDER = { v: 102.5, r: [4.0, 4.4] }

const lerp = ([a, b], t) => a + (b - a) * t
const inRect = (u, v, [u0, u1, v0, v1]) =>
  u >= u0 && u <= u1 && v >= v0 && v <= v1

/* ---------------- 种树 ---------------- */

/** 林带与南缘的树位（设计系，含抖动）：[{ u, v, r, trunkH, yaw, color, y }] */
function treeSpots() {
  // 固定种子的伪随机数（utils.js 的 mulberry32）：几何每次构建逐位相同
  const rand = mulberry32(20261002)
  const out = []
  for (const s of [-1, 1]) {
    BELT_ROWS.forEach((rowU, k) => {
      for (const v0 of BELT_VS[k % 2]) {
        // 每棵树固定取 5 个随机数（空地处也取），抖动不随种不种而串位
        const [a, c, d, e, g] = [rand(), rand(), rand(), rand(), rand()]
        const u = s * rowU + (a * 2 - 1) * BELT_TREE.du
        const v = v0 + (c * 2 - 1) * BELT_TREE.dv
        if (CLEARINGS.some((q) => inRect(u, v, q))) continue
        out.push({
          u,
          v,
          r: lerp(BELT_TREE.r, d),
          trunkH: lerp(BELT_TREE.trunkH, e),
          yaw: g * Math.PI * 2,
          color: C.forest[Math.floor(g * 997) % C.forest.length],
          // 树根落在林下草地上（抖动后仍都在草地矩形内，这里照样按位置判断）
          y: FOREST_FLOORS.some((q) => inRect(u, v, q)) ? LAWN_TOP : PAVE
        })
      }
    })
  }
  for (const s of [-1, 1]) {
    for (const u0 of SOUTH_ROW.us) {
      const [a, d, g] = [rand(), rand(), rand()]
      const u = s * u0 + (a * 2 - 1) * SOUTH_ROW.du
      // 按最大冠半径判断树冠横向是否伸进雨棚的 u 区间
      const under = CANOPY_US.some(
        ([c0, c1]) => u + SOUTH_OPEN.r[1] > c0 && u - SOUTH_OPEN.r[1] < c1
      )
      const P = under ? SOUTH_UNDER : SOUTH_OPEN
      out.push({
        u,
        v: P.v,
        r: lerp(P.r, d),
        trunkH: SOUTH_ROW.trunkH,
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

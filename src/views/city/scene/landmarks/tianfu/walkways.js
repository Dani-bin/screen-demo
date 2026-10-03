/*
 * 天府广场 · 广场中部的步行路径
 * ----------------------------------------------------------
 * 依据：设计文档第 6 节「步行路径」、调研报告 6.7。这里只写不属于某个构件的几条：
 * 绕神鸟盘环、南北中轴、东西两条横线。其余路径跟着各自的构件走，由各模块返回、index.js 汇总：
 * 西鱼眼绕池环（westEye.js）、东鱼眼坑底环与坑口外环（eastEye.js）、林带内侧两条南北步道（trees.js，
 * 位置见 site.js 的 BELT_PATH）、科技馆前南北轴线（north.js）。
 * 全部走在铺装顶面 PAVE 上（坑底环在 PIT_FLOOR、科技馆前轴线在 NORTH_Y）：外板、阴鱼、地灯带三者共面，
 * 横穿 S 线不起伏。草坪与花带比铺装高 0.15，步行校验的「支撑面」不认（差值 > 0.06），所以路径一律不上草坪。
 *
 * 人数（crowd.js 的 allocate：长度 × theme.crowd.perMeter 0.04 × density，逐条四舍五入）：
 *
 * | 路径 | 长度 m | density | 人数 |
 * |---|---:|---:|---:|
 * | 绕神鸟盘环（本文件） | 75 | 3 | 9 |
 * | 南北中轴北段 / 南段（本文件） | 50 / 86 | 2.5 | 5 / 9 |
 * | 东西横线北 / 南（本文件） | 210 / 210 | 1.2 | 10 / 10 |
 * | 西鱼眼绕池环 | 141 | 1.5 | 8 |
 * | 东鱼眼坑底环 / 坑口外环 | 47 / 186 | 1.5 / 1.2 | 3 / 9 |
 * | 林带内侧步道西 / 东 | 151 / 151 | 1 | 6 / 6 |
 * | 科技馆前轴线 | 52 | 1.5 | 3 |
 * | 合计（11 条） | 1,359 | | 78 |
 *
 * 每米人数：神鸟盘环 0.12、中轴 0.10 最密（落点与主轴，镜头正中）；鱼眼与科技馆前 0.05～0.06；
 * 东西横线 0.048、林带步道 0.04 最疏（在画面边上，人太多会显得挤）。
 */
import { circlePolygon } from "../kit/footprint.js"
import { BELT_PATH, PAVE } from "./site.js"
import { SUNBIRD } from "./sunbird.js"

/*
 * 绕神鸟盘一圈：半径 12、宽 3（设计第 6 节「半径 11～13」）。内沿 10.5 离盘外深色环（9.15）有 1.35 m，
 * 深色环只高 0.15，不算障碍；离鼓座侧面 ≥ 3.25 m
 */
const RING = { r: 12, width: 3, density: 3, n: 32 }

/*
 * 南北中轴：宽 6（|u| ≤ 3），两侧最近的草坪在 |u| ≥ 24。在神鸟盘处断开，两段内端落在绕盘环的中线上：
 * - 北段 v −62 → −12.3：北端离国旗台（v −70.3）还有 8 m，与北侧东西横线（v −61）交叉；
 * - 南段 v 11.7 → 98：穿过南侧东西横线（v 73），南端在南对图腾柱（±15, 97）之间，离广场南沿 v 104 有 6 m
 */
const AXIS = { width: 6, density: 2.5 }
const AXIS_SEGMENTS = [
  [
    [0, -62],
    [0, SUNBIRD.v - RING.r]
  ],
  [
    [0, SUNBIRD.v + RING.r],
    [0, 98]
  ]
]

/*
 * 东西两条横线（设计第 6 节「v ≈ −61、v ≈ 73」），宽 4，两端接到林带内侧步道的中线（u ±105）：
 * - 北线 v −61：夹在北缘喷泉池南沿（v −66，池沿高 0.6）与两块北侧大草坪北沿（西 v −55.5～−54.5、
 *   东 v −56）的正中，两边各留约 3 m；北对图腾柱（±17, −69）在池间，离路沿 6 m；
 * - 南线 v 73（= BELT_PATH.v1，与两条林带步道的南端相接，三条连成 U 形）：夹在南侧几块草坪南沿
 *   （西南大草坪、东南矩形与小三角都止于 v 69.5）与南侧两条草带北沿（v 77.5）之间，
 *   北边留 1.5 m、南边留 2.5 m。两条横线全程都在铺装上，不经过草坪与构筑物
 *   （东入口楼梯口 v −25.5～−13.5、东南构筑物 v 17～52、雨棚 v 91.5 起，都不在这两条线上）
 */
const CROSS = { width: 4, density: 1.2, vs: [-61, BELT_PATH.v1] }

/**
 * 广场中部的步行路径（设计系 → 世界坐标）：绕神鸟盘环、南北中轴两段、东西横线两条。
 * @param {object} site 场地对象（site.js 的 createSite），用 site.toWorldPts
 * @returns {Array} 步行路径（格式见 crowd.js 文件头）
 */
export function squareWalkways(site) {
  const open = (pts, { width, density }) => ({
    points: site.toWorldPts(pts),
    y: PAVE,
    width,
    closed: false,
    density
  })
  return [
    {
      points: site.toWorldPts(
        circlePolygon(SUNBIRD.u, SUNBIRD.v, RING.r, RING.n)
      ),
      y: PAVE,
      width: RING.width,
      closed: true,
      density: RING.density
    },
    ...AXIS_SEGMENTS.map((pts) => open(pts, AXIS)),
    ...CROSS.vs.map((v) =>
      open(
        [
          [-BELT_PATH.u, v],
          [BELT_PATH.u, v]
        ],
        CROSS
      )
    )
  ]
}

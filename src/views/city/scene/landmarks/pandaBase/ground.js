/*
 * 熊猫基地 · 地面批：园路、南门广场、湖心岛、园区林下草地
 * ----------------------------------------------------------
 * 全部进 site.gb（单面材质）。园路坐标取自 OSM 园路（设计文档 3.3 与第 6 节，简化到 2 m 容差）。
 * 坐标口径：本文件的 ROADS 点列（以及 site.js 的 WEST_POOLS）已经是局部坐标（米，按 meta.origin
 * 投影后取出）；site.js 里其余轮廓常量（园区、湖、广场、南大门）是经纬度，在 createSite 里投影。
 * 主路（观光车道）顶在 PAVE_Y、次级步道在 PATH_Y：同类路颜色相同，交叠处共面也看不出闪烁；
 * 两类相差 0.03 m，交叉处主路在上。次级步道之间不再逐条错开高度：它们颜色、法线都相同，
 * 共面重叠的三角形肉眼看不出，错开反而要为每条路分配一个微小高差。
 * 路面带用 kit 的 ribbon（折点斜接、端面朝外、可闭合），而不是 sweepBar：后者端面朝内、
 * 在单面材质下被剔除，急弯处路面还会收窄。
 * 绘制顺序：先 buildPaths（园路、湖心岛与水面标记），各分区登记完草地要挖的洞之后，
 * 再依次调用 buildLawn（林下草地）、buildPlaza（南门广场，最后挤出以便挖草坪岛与喷泉池）。
 */
import { extrudePolygon, ribbon } from "../kit/shapes.js"
import { GROUND_Y } from "../../terrain.js"
import {
  C,
  F_PAVE,
  F_WATER,
  ISLAND_Y,
  LAWN_Y,
  PATH_Y,
  PAVE_Y,
  WEST_POOLS
} from "./site.js"

/** 路面带厚度（米）：顶面在 y，侧面向下 0.15 m，底埋在草地里 */
const ROAD_THICK = 0.15
/** 开放园路渲染时两端各外延的长度（米）：与相邻路面带、广场重叠，接缝处不漏出草地 */
const ROAD_END_EXT = 0.4

/**
 * 园路：id 供 walkways 引用；main 为观光车道 / 主路（PAVE_Y、宽 w），否则为次级步道（PATH_Y）；
 * closed 为环形（点列不重复首点）。入园主路从南大门门洞北口起铺，门洞地面与广场由 gate.js 负责。
 * 末尾三条 *Link 是补上的短连接段：这些路在 OSM 里断头，会悬在草地中间。
 * lakeEast 路面收窄到 4 m，并把中间三个点向外（远离天鹅湖）平移了约 1 m：
 * OSM 里这条路的中线离天鹅湖洞边只有约 1.95 m，4 m 宽的路面会压进湖洞；平移后
 * 路面边缘（含折点斜接）离湖洞 ≥ 0.8 m（lakeWest 本身离湖洞 ≥ 0.36 m，无需处理）。
 */
export const ROADS = [
  {
    id: "entry",
    main: true,
    w: 6,
    pts: [
      [7447, -8617],
      [7410, -8703]
    ]
  },
  {
    id: "loop",
    main: true,
    w: 4.5,
    pts: [
      [7410, -8703],
      [7433, -8747],
      [7449, -8772],
      [7448, -8791],
      [7430, -8810],
      [7405, -8826],
      [7382, -8836],
      [7267, -8855],
      [7238, -8853],
      [7218, -8843],
      [7191, -8848],
      [7178, -8863],
      [7174, -8896],
      [7095, -9004]
    ]
  },
  {
    id: "science",
    main: true,
    w: 4.5,
    // 首点 [7410, -8703] 是铜像路口：补上它，科普路才与入口路、环路在路口衔接
    pts: [
      [7410, -8703],
      [7396, -8711],
      [7333, -8778],
      [7157, -8783],
      [7134, -8857],
      [7147, -8935]
    ]
  },
  {
    id: "sunSouth",
    main: true,
    w: 4.5,
    pts: [
      [7203, -9191],
      [7284, -9136],
      [7437, -9117],
      [7463, -9042]
    ]
  },
  {
    id: "toMoon",
    main: true,
    w: 4.5,
    pts: [
      [7201, -9341],
      [6996, -9210],
      [6945, -9212],
      [6891, -9241],
      [6876, -9241],
      [6863, -9235],
      [6847, -9223]
    ]
  },
  {
    id: "lakeEast",
    main: true,
    w: 4,
    pts: [
      [7446, -8794],
      [7506.7, -8911.3],
      [7512.7, -8919.3],
      [7529.7, -8926.3],
      [7551, -8949],
      [7559, -8953]
    ]
  },
  {
    id: "museumFront",
    main: true,
    w: 4.5,
    pts: [
      [7410, -8703],
      [7423, -8712],
      [7431, -8712],
      [7457, -8701],
      [7485, -8707],
      [7555, -8755]
    ]
  },
  {
    id: "entrySide",
    main: false,
    w: 3,
    pts: [
      [7427, -8603],
      [7412, -8700]
    ]
  },
  {
    id: "villas",
    main: false,
    w: 3,
    pts: [
      [7174, -8896],
      [7199, -8919],
      [7201, -8957],
      [7205, -8972],
      [7254, -9012],
      [7328, -9082],
      [7344, -9097],
      [7381, -9094],
      [7437, -9068]
    ]
  },
  {
    id: "sunLoop",
    main: false,
    w: 3,
    closed: true,
    pts: [
      [7204, -9178],
      [7226, -9174],
      [7243, -9143],
      [7263, -9130],
      [7264, -9120],
      [7248, -9103],
      [7223, -9084],
      [7209, -9078],
      [7185, -9090],
      [7169, -9104],
      [7163, -9128],
      [7165, -9144],
      [7175, -9155],
      [7199, -9170]
    ]
  },
  {
    id: "sunToNo2",
    main: false,
    w: 3,
    pts: [
      [7163, -9128],
      [7157, -9130],
      [7014, -9110],
      [7002, -9131],
      [7002, -9159],
      [7012, -9171],
      [7005, -9200],
      [6996, -9210]
    ]
  },
  {
    id: "moonLoop",
    main: false,
    w: 3,
    pts: [
      [6878, -9307],
      [6884, -9325],
      [6886, -9346],
      [6880, -9366],
      [6872, -9379],
      [6838, -9397],
      [6801, -9393],
      [6771, -9369],
      [6763, -9338],
      [6777, -9303],
      [6786, -9294],
      [6812, -9294],
      [6818, -9285]
    ]
  },
  {
    id: "lakeWest",
    main: false,
    w: 3,
    pts: [
      [7461, -8823],
      [7437, -8821],
      [7420, -8826],
      [7401, -8868],
      [7399, -8886],
      [7388, -8917],
      [7409, -8935],
      [7431, -8947],
      [7438, -8968],
      [7449, -8980],
      [7495, -9019]
    ]
  },
  {
    id: "no2Loop",
    main: false,
    w: 3,
    pts: [
      [6945, -9212],
      [6934, -9229],
      [6931, -9251],
      [6938, -9269],
      [6947, -9281],
      [6958, -9289],
      [6971, -9294],
      [6982, -9295],
      [7009, -9287],
      [7026, -9276],
      [7040, -9254],
      [7041, -9240],
      [7032, -9228],
      [7016, -9225],
      [6999, -9227],
      [6996, -9210]
    ]
  },
  {
    id: "no1",
    main: false,
    w: 3,
    pts: [
      [6725, -9068],
      [6709, -9077],
      [6703, -9084],
      [6698, -9106],
      [6705, -9132],
      [6723, -9139],
      [6738, -9150],
      [6755, -9143],
      [6771, -9140],
      [6776, -9133],
      [6775, -9116],
      [6768, -9104]
    ]
  },
  // 连接段：终点取目标路线上离起点最近的点（夹取到整米）
  {
    id: "sunSouthLink",
    main: false,
    w: 3,
    pts: [
      [7203, -9191],
      [7204, -9178]
    ]
  }, // 阳光产房南路起点 → 阳光环路
  {
    id: "villasLink",
    main: false,
    w: 3,
    pts: [
      [7437, -9068],
      [7452, -9073]
    ]
  }, // 别墅步道终点 → 阳光产房南路
  {
    id: "lakeWestLink",
    main: false,
    w: 3,
    pts: [
      [7495, -9019],
      [7463, -9042]
    ]
  } // 湖西步道终点 → 阳光产房南路终点
]

/**
 * 把开放折线两端各沿首 / 末段方向外延 d 米，返回新数组（不改原点列）。
 * 只用于渲染：site.paths 登记的仍是原始点列，步行路径取原始端点。
 */
function extendEnds(pts, d) {
  const n = pts.length
  // 从 a 指向 b 的单位向量
  const dir = (a, b) => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
  }
  const [sx, sz] = dir(pts[1], pts[0])
  const [ex, ez] = dir(pts[n - 2], pts[n - 1])
  return [
    [pts[0][0] + sx * d, pts[0][1] + sz * d],
    ...pts.slice(1, -1),
    [pts[n - 1][0] + ex * d, pts[n - 1][1] + ez * d]
  ]
}

/**
 * 一条园路的路面带几何：顶面在 PAVE_Y（主路）/ PATH_Y（次级），斜接折点；
 * 开放路两端外延 ROAD_END_EXT，闭合路接缝处斜接。导出供校验脚本复算路面边缘。
 */
export function roadRibbon(r) {
  const y = r.main ? PAVE_Y : PATH_Y
  const pts = r.closed ? r.pts : extendEnds(r.pts, ROAD_END_EXT)
  return ribbon(pts, r.w, y - ROAD_THICK, y, { closed: !!r.closed })
}

/**
 * 开放园路渲染后一端的封口边：两端外延 ROAD_END_EXT 后，端点沿该端所在段的左右法向各偏半宽
 * （与 roadRibbon → ribbon 在开放端的算法一致：端点只有一段，斜接系数为 1）。
 * 供相邻铺装（如南大门门洞地面）对齐这条边、只对边不重叠。
 * @param {object} r ROADS 里的一条开放园路
 * @param {"start" | "end"} which 起端或末端
 * @returns {[[number, number], [number, number]]} [左角, 右角]：沿点列前进方向的左手侧、右手侧
 *   （左手法向为 (−dz, dx)，同 ribbon 的 L0 / R0）
 */
export function roadEndCap(r, which = "start") {
  if (r.closed) throw new Error(`熊猫基地：环形园路 ${r.id} 没有端口`)
  const pts = extendEnds(r.pts, ROAD_END_EXT)
  const n = pts.length
  const [a, b] = which === "start" ? [pts[0], pts[1]] : [pts[n - 2], pts[n - 1]]
  const p = which === "start" ? a : b
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const l = Math.hypot(dx, dz) || 1
  const sx = ((-dz / l) * r.w) / 2
  const sz = ((dx / l) * r.w) / 2
  return [
    [p[0] + sx, p[1] + sz],
    [p[0] - sx, p[1] - sz]
  ]
}

/** 铺一条园路：路面带进地面批、栅格打 F_PAVE（用原始点列，不含外延）、登记到 site.paths */
function addRoad(site, r) {
  site.gb.add(roadRibbon(r), r.main ? C.road : C.path)
  site.grid.stampLine(r.pts, r.w / 2, F_PAVE, !!r.closed)
  site.paths.push({
    id: r.id,
    pts: r.pts,
    w: r.w,
    y: r.main ? PAVE_Y : PATH_Y,
    closed: !!r.closed
  })
}

/**
 * 园路、湖心岛与水面标记，在各分区之前调用。
 * 南门广场在此只打 F_PAVE 标记（后续分区要据此避开），几何留到 buildPlaza 最后挤出。
 */
export function buildPaths(site) {
  for (const r of ROADS) addRoad(site, r)
  site.grid.fillPoly(site.plaza, F_PAVE)
  // 湖心岛：落在天鹅湖洞里，单独挤出
  site.gb.add(
    extrudePolygon(site.lakes.island, [], GROUND_Y, ISLAND_Y),
    C.lawnOpen
  )
  // 水面先打 F_WATER 标记（外扩 1 m）：后续分区与树竹都要避开，草地虽然最后才挤出，
  // 标记必须在这里打。天鹅湖外环包含湖心岛，所以岛上也带着 F_WATER：岛上的树与樱花由
  // lake.js 按坐标常量直接种；树竹分区（vegetation）的避让掩码含 F_WATER，会自动跳过湖心岛
  for (const h of [site.lakes.swan, site.lakes.ne, ...WEST_POOLS]) {
    site.grid.fillPoly(h, F_WATER, 1)
  }
}

/** 园区林下草地：整片挤出到 LAWN_Y，湖、池、活动场开洞；在各分区登记完洞之后调用 */
export function buildLawn(site) {
  site.gb.add(
    extrudePolygon(site.park, site.lawnHoles, GROUND_Y, LAWN_Y),
    C.lawn
  )
}

/**
 * 南门广场铺装：挤出到 PAVE_Y，挖掉 site.plazaHoles（草坪岛、喷泉池，由 gate.js 登记）；
 * 洞里的内容由登记方自己画。必须放在最后，保证 plazaHoles 登记完整。
 */
export function buildPlaza(site) {
  site.gb.add(
    extrudePolygon(site.plaza, site.plazaHoles, GROUND_Y, PAVE_Y),
    C.plaza
  )
}

/** 按 id 取已铺园路（walkways 用） */
export function pathById(site, id) {
  const p = site.paths.find((q) => q.id === id)
  if (!p) throw new Error(`熊猫基地：未知园路 ${id}`)
  return p
}

/*
 * 熊猫基地 · 地面批：园路、南门广场、湖心岛、园区林下草地
 * ----------------------------------------------------------
 * 全部进 site.gb（单面材质）。园路坐标取自 OSM 园路（设计文档 3.3 与第 6 节，简化到 2 m 容差）。
 * 主路（观光车道）顶在 PAVE_Y、次级步道在 PATH_Y：同类路颜色相同，交叠处共面也看不出闪烁；
 * 两类相差 0.03 m，交叉处主路在上。草地最后挤出（buildLawn），以便各分区先登记要挖的洞。
 */
import { extrudePolygon, sweepBar } from "../kit/shapes.js"
import { GROUND_Y } from "../../terrain.js"
import { C, F_PAVE, F_WATER, ISLAND_Y, LAWN_Y, PATH_Y, PAVE_Y } from "./site.js"

/**
 * 园路：id 供 walkways 引用；main 为观光车道 / 主路（PAVE_Y、宽 w），否则为次级步道（PATH_Y）。
 * 入园主路从南大门门洞北口起铺，门洞地面与广场由 gate.js 负责
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
    pts: [
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
    w: 4.5,
    pts: [
      [7446, -8794],
      [7506, -8912],
      [7512, -8920],
      [7529, -8927],
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
  }
]

/** 园路带：顶面在 y、侧面 0.15 m（只做顶面与侧面，底埋在草地里） */
function addRoad(site, r) {
  const y = r.main ? PAVE_Y : PATH_Y
  const pts = r.closed ? [...r.pts, r.pts[0]] : r.pts
  site.gb.add(
    sweepBar(
      pts.map(([x, z]) => [x, y - 0.15, z]),
      r.w,
      0.15
    ),
    r.main ? C.road : C.path
  )
  site.grid.stampLine(pts, r.w / 2, F_PAVE)
  site.paths.push({ id: r.id, pts: r.pts, w: r.w, y, closed: !!r.closed })
}

/** 园路、南门广场、湖心岛（草地之外的地面），在各分区之前调用 */
export function buildPaths(site) {
  for (const r of ROADS) addRoad(site, r)
  // 南门广场（园界外、熊猫大道旁）：与主路同高；草坪内环、喷泉由 gate.js 叠加
  site.gb.add(extrudePolygon(site.plaza, [], GROUND_Y, PAVE_Y), C.plaza)
  site.grid.fillPoly(site.plaza, F_PAVE)
  // 湖心岛：落在天鹅湖洞里，单独挤出
  site.gb.add(
    extrudePolygon(site.lakes.island, [], GROUND_Y, ISLAND_Y),
    C.lawnOpen
  )
  // 湖面先打水面标记（外扩 1 m）：后续分区与树竹都要避开，草地虽然最后才挤出，标记必须在这里打
  for (const h of [site.lakes.swan, site.lakes.ne]) {
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

/** 按 id 取已铺园路（walkways 用） */
export function pathById(site, id) {
  const p = site.paths.find((q) => q.id === id)
  if (!p) throw new Error(`熊猫基地：未知园路 ${id}`)
  return p
}

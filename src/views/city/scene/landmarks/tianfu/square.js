/*
 * 天府广场 · 旧广场部分（道路以南）
 * ----------------------------------------------------------
 * 职责：重做前的广场模型，依据是维基百科与 2007 年新闻，与实景差别很大（见设计文档开头与报告第 5 节）：
 * 圆角矩形铺装（东西两半）+ 外沿低台阶 + S 形分界带 + 太阳神鸟金盘 Φ54 + 东半下沉广场与螺旋雕塑 +
 * 西半两道条形喷泉 + OSM 草坪 + 12 根图腾柱，以及绕开这些构件的临时步行路径。
 * 本次拆分（Task 2）只搬家，几何、路径与拆分前逐位一致。
 *
 * 全部在广场局部系里写（site.square：原点在 OSM 广场面包围盒中心、铺装顶面以下的地面，
 * X 向东、Z 向南）。广场内的草坪取自 OSM 公园面（相对广场中心），与城市树木层撒树的范围一致，
 * 这样通用树木正好长在草坪上，而不会戳进喷泉或下沉广场。
 *
 * 后续任务逐块替换，新件改在设计系（site.design）里写、放进新文件：
 * - Task 3：外沿台阶、东西两半铺装、S 形分界带、Φ54 金盘、条形喷泉与水柱、下沉广场、
 *   12 根图腾柱、草坪全部删掉，由 ground.js（太极铺装、草坪花带）与 sunbird.js（神鸟盘）取代；
 *   步行路径先换成临时的几条。
 * - Task 4、5：西鱼眼 westEye.js、东鱼眼下沉广场 eastEye.js。
 * - Task 6：北缘喷泉（水柱动画件）、4 根图腾柱、路灯、构筑物与树。
 * - Task 8：步行路径按设计第 6 节重排。旧件全部替换后删掉本文件。
 */
import { local } from "../kit/builder.js"
import { circlePolygon, rectPolygon } from "../kit/footprint.js"
import {
  box,
  cylinder,
  extrudePolygon,
  sphere,
  sweepBar
} from "../kit/shapes.js"
import { addBalustrade } from "../kit/parts.js"
import { addSunbirdDisc, addTotem } from "../kit/figures.js"
import { THEME } from "../../theme.js"
import { C, PAVE, SQUARE, offsetPoints, ringPoints } from "./site.js"

const L = THEME.landmark

/* ---------------- 尺寸与定位（广场局部系） ---------------- */

// 外沿再加一圈 1.5 m 宽、1.0 m 高的低台阶（铺装高度 PAVE 见 site.js）
const CURB_H = 1.0
const CURB_W = 1.5
// S 形分界线：x = S_AMP · sin(π z / (d/2))，北半偏西、南半偏东；带宽 3 m
const S_AMP = 22
const S_BAND = 3
// 下沉广场（东半）：圆形，中心与半径（广场局部坐标），坑底高度（比铺装低 1.2 m），台阶级数
const SUNKEN = { x: 52, z: -10, r: 21, floor: 0.3, steps: 4, tread: 1.2 }
// 西半两道条形喷泉（南北向）：中心 x，长 76、宽 8
const FOUNTAINS = [-102, -36]
const FOUNTAIN_L = 76
const FOUNTAIN_W = 8
// 水面高度：喷泉水柱动画 Mesh 整体抬到这里（index.js）
export const WATER_TOP = PAVE + 0.4
// 12 根图腾柱（广场局部坐标）：南北两边各 4 根、东西两边各 2 根，避开草坪
const TOTEMS = [
  [-115, -86],
  [-14, -86],
  [14, -86],
  [115, -86],
  [-115, 86],
  [-14, 86],
  [14, 86],
  [115, 86],
  [-143.5, -25],
  [-143.5, 25],
  [143.5, -25],
  [143.5, 25]
]

/*
 * 广场草坪：OSM 公园面（相对广场中心，米）。
 * 西侧长条东缘略向西收 2 m，给西侧喷泉让位。
 */
const LAWNS = [
  // 西南、西北 K 形草坪
  [
    [-67, 18],
    [-73, 6],
    [-77, 3],
    [-95, 4],
    [-95, 31],
    [-82, 32],
    [-81, 40],
    [-94, 40],
    [-94, 61],
    [-38, 61],
    [-36, 59],
    [-37, 55],
    [-44, 50],
    [-53, 41],
    [-61, 31],
    [-64, 24]
  ],
  [
    [-57, -53],
    [-56, -58],
    [-55, -61],
    [-56, -64],
    [-97, -62],
    [-96, -16],
    [-87, -15],
    [-81, -16],
    [-76, -18],
    [-73, -22],
    [-69, -27],
    [-67, -36],
    [-63, -44],
    [-60, -49]
  ],
  // 东北两块
  [
    [71, -41],
    [89, -42],
    [89, -45],
    [100, -46],
    [100, -69],
    [59, -68],
    [58, -66],
    [56, -62],
    [63, -54],
    [68, -46]
  ],
  [
    [73, -37],
    [91, -37],
    [88, -26],
    [88, -23],
    [101, -23],
    [101, -21],
    [93, -20],
    [86, -21],
    [82, -23],
    [79, -27],
    [76, -32]
  ],
  // 东南两块
  [
    [61, 46],
    [61, 58],
    [103, 57],
    [103, 45],
    [69, 45],
    [67, 39],
    [64, 38],
    [73, 25],
    [85, 6],
    [102, 5],
    [102, -2],
    [95, -3],
    [89, -2],
    [84, 0],
    [80, 2],
    [77, 8],
    [76, 14],
    [72, 24],
    [66, 34],
    [62, 39]
  ],
  [
    [45, 55],
    [44, 58],
    [56, 58],
    [57, 45],
    [52, 49]
  ],
  // 东西两侧长条
  [
    [134, -76],
    [136, 59],
    [114, 55],
    [112, -75]
  ],
  [
    [-131, -56],
    [-129, 6],
    [-117, 5],
    [-116, 32],
    [-127, 32],
    [-126, 65],
    [-114, 64],
    [-114, 59],
    [-108, 58],
    [-113, -71],
    [-121, -70],
    [-120, -66],
    [-123, -65],
    [-123, -56]
  ],
  [
    [-140, -10],
    [-141, -8],
    [-139, 64],
    [-133, 64],
    [-135, -5]
  ],
  // 南北两边的草带
  [
    [30, 66],
    [116, 65],
    [116, 76],
    [110, 76],
    [44, 77],
    [30, 78]
  ],
  [
    [-108, 70],
    [-108, 82],
    [-19, 80],
    [-19, 68]
  ],
  [
    [-100, -81],
    [-103, -81],
    [-103, -86],
    [-24, -88],
    [-24, -83]
  ],
  [
    [26, -84],
    [26, -89],
    [102, -91],
    [104, -89],
    [105, -86],
    [105, -78],
    [102, -78],
    [102, -85]
  ]
]

/*
 * 步行路径（广场局部坐标，人群系统用）：均避开草坪、喷泉池沿、图腾柱与下沉广场栏杆。
 * 广场大、游人多，密度整体偏高（全站约 70 人），金盘外环最密。
 * - 南北两条东西向散步线：北线走北侧草带与中部草坪之间的空当（z ≈ -75）；
 *   南线西段 z = 64.5、东段 z = 61.5（两侧草坪边缘错位，中段缓缓过渡）；
 * - 两条南北向散步线：西线夹在东侧喷泉池沿（外缘 x = -31.4）与金盘（半径 27）之间
 *   （x = -29.5，只留 2 m 宽），东线在东侧草坪与东缘长条草坪之间（x = 107.5），
 *   两端都接到南北散步线；
 * - 中轴：金盘南北两侧各一段（北段偏东 3 m、南段偏西 4 m，让开两端斜穿的 S 形分界带）；
 * 这些都在铺装顶面 PAVE 上；S 形分界带只高出铺装 0.2 m，横穿时看不出。
 */
const WALK_W = [
  {
    // 宽 4.2：东端（x 102～105）北侧是北边草带的一个凸角，南沿 z = -78 离中线仅 3 m，
    // 可走半宽 + 身体半径 0.8 须小于 3，宽 5 时贴边小人的身体会擦进草坪
    points: [
      [-138, -75],
      [106, -75]
    ],
    width: 4.2,
    density: 1.5
  },
  {
    points: [
      [-110, 64.5],
      [-40, 64.5],
      [25, 61.5],
      [106, 61.5]
    ],
    width: 3,
    density: 1.5
  },
  {
    points: [
      [-29.5, -72],
      [-29.5, 62]
    ],
    width: 2,
    density: 1.2
  },
  {
    points: [
      [107.5, -72],
      [107.5, 58]
    ],
    width: 3,
    density: 1.2
  },
  {
    points: [
      [3, -92],
      [3, -31]
    ],
    width: 6,
    density: 1.5
  },
  {
    points: [
      [-4, 31],
      [-4, 92]
    ],
    width: 6,
    density: 1.5
  }
]
// 金盘外环：盘半径 27，环中线 29.5、宽 2（外缘 30.5 离下沉广场栏杆约 1 m）
const RING = { r: 29.5, width: 2, density: 2 }
// 下沉广场环路：半径 12，走在坑底 SUNKEN.floor 上
// （内侧离螺旋雕塑飘带 ≥ 3.5 m，外侧离台阶 ≥ 3.9 m）
const SUNKEN_RING = { r: 12, width: 3, density: 1.5, y: SUNKEN.floor }

/* ---------------- 小工具 ---------------- */

/**
 * 圆角矩形外轮廓：从南边中点出发，经西南 → 西北 → 北边中点 → 东北 → 东南回到起点。
 * 返回 { west, east } 两段折线（都含两端中点），便于与 S 形分界线拼成东西两半。
 */
function roundedRectHalves(w, d, r, grow = 0) {
  const hw = w / 2 + grow
  const hd = d / 2 + grow
  const rr = r + grow
  const seg = 5
  const arc = (cx, cz, a0, a1) =>
    Array.from({ length: seg + 1 }, (_, i) => {
      const a = a0 + ((a1 - a0) * i) / seg
      return [cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]
    })
  const P = Math.PI
  const west = [
    [0, hd],
    ...arc(-(hw - rr), hd - rr, P / 2, P),
    ...arc(-(hw - rr), -(hd - rr), P, 1.5 * P),
    [0, -hd]
  ]
  const east = [
    [0, -hd],
    ...arc(hw - rr, -(hd - rr), 1.5 * P, 2 * P),
    ...arc(hw - rr, hd - rr, 0, P / 2),
    [0, hd]
  ]
  return { west, east }
}

/** S 形分界线 x 坐标 */
const sCurve = (z) => S_AMP * Math.sin((Math.PI * z) / (SQUARE.d / 2))

/* ---------------- 广场 ---------------- */

/**
 * 广场铺装、分界线、金盘、下沉广场、喷泉、草坪、图腾柱。
 * @param {ColorBuilder} b 静态件
 * @param {ColorBuilder} jets 喷泉水柱（单独成动画 Mesh）
 * @param {object} site 场地对象（site.js 的 createSite）；旧件都在广场局部系 site.square 里
 * @returns {{ zones: Array, walkways: Array }} 广场替换区与步行路径（世界坐标）
 */
export function buildSquare(b, jets, site) {
  const f = site.square
  const { w, d, r } = SQUARE
  // 外沿低台阶：整块圆角矩形外扩 1.5 m，顶面 CURB_H。
  // 必须在下沉广场处挖洞：否则这块实心板的顶面（1.0）会盖住坑底 SUNKEN.floor（0.3）
  // 和下面两级台阶，下沉广场看上去只下沉约 0.5 m。洞口与铺装洞口、坑底外缘
  // 用同一个圆（同中心、半径、分段数），洞壁完全藏在最高一级台阶里，不露缝
  const g = roundedRectHalves(w, d, r, CURB_W)
  const sunkenHole = circlePolygon(SUNKEN.x, SUNKEN.z, SUNKEN.r, 48)
  b.add(
    extrudePolygon(
      [...g.west, ...g.east.slice(1, -1)],
      [sunkenHole],
      0,
      CURB_H
    ),
    C.curb,
    f
  )

  // S 形分界线：北端 → 南端采样
  const n = 40
  const s = Array.from({ length: n + 1 }, (_, i) => {
    const z = -d / 2 + (d * i) / n
    return [sCurve(z), z]
  })
  const inner = s.slice(1, -1)
  const half = roundedRectHalves(w, d, r)
  // 西半：外轮廓（南中点 → 西侧 → 北中点）+ 分界线（北 → 南）
  b.add(extrudePolygon([...half.west, ...inner], [], 0, PAVE), C.paveWest, f)
  // 东半：外轮廓（北中点 → 东侧 → 南中点）+ 分界线（南 → 北），挖出下沉广场
  b.add(
    extrudePolygon(
      [...half.east, ...inner.slice().reverse()],
      [sunkenHole],
      0,
      PAVE
    ),
    C.paveEast,
    f
  )
  // 分界带：浅金白色细条，底边嵌进铺装 0.05 m、顶面高出 0.2 m。
  // 两端斜穿南北边缘，端面的外角会伸出铺装，所以带只取 z ∈ [-d/2 + 1, d/2 - 1]
  const band = Array.from({ length: n + 1 }, (_, i) => {
    const z = -d / 2 + 1 + ((d - 2) * i) / n
    return [sCurve(z), PAVE, z]
  })
  b.add(sweepBar(band, S_BAND, 0.2, { sink: 0.05 }), C.band, f)

  // 中心太阳神鸟金盘 Φ54
  addSunbirdDisc(b, local(f, 0, PAVE, 0), { radius: 27 })

  buildSunken(b, f)
  buildFountains(b, jets, f)

  // 草坪：高出铺装 0.3 m 的绿地
  for (const poly of LAWNS) {
    b.add(extrudePolygon(poly, [], PAVE - 0.1, PAVE + 0.3), C.lawn, f)
  }
  // 12 根文化图腾柱
  for (const [x, z] of TOTEMS) {
    addTotem(b, local(f, x, PAVE, z), { h: 12, r: 0.6 })
  }

  return {
    zones: [rectPolygon(site.qx, site.qz, w + 4, d + 4, 90)],
    walkways: squareWalkways(site.qx, site.qz)
  }
}

/** 东半下沉广场：坑底 + 一圈台阶 + 汉白玉栏杆 + 中心金色螺旋雕塑 */
function buildSunken(b, f) {
  const { x, z, r, floor, steps, tread } = SUNKEN
  const outer = circlePolygon(x, z, r, 48)
  b.add(extrudePolygon(outer, [], 0, floor), C.sunkenFloor, f)
  // 台阶：由外向内逐级降低，每级是一个环形实体（外缘与铺装洞口重合）
  const rise = (PAVE - floor) / steps
  for (let k = 1; k < steps; k++) {
    const rin = r - tread * (steps - k)
    b.add(
      extrudePolygon(
        outer,
        [circlePolygon(x, z, rin, 48)],
        0,
        floor + rise * k
      ),
      k % 2 ? C.step : C.rim,
      f
    )
  }
  // 洞口一圈栏杆
  addBalustrade(b, f, {
    points: circlePolygon(x, z, r + 0.4, 28),
    y: PAVE,
    h: 1.1,
    postSpacing: 3
  })

  // 中心雕塑：圆座 + 白色立柱 + 两层圆台 + 缠绕的金色飘带（照片里的金色螺旋）
  const m = local(f, x, floor, z)
  b.add(cylinder(5, 5, 1.2, { segments: 24, caps: true }), C.tier, m)
  b.add(cylinder(0.9, 0.8, 17, { segments: 12, caps: true }), C.spiralPole, m)
  b.add(
    cylinder(6.5, 6, 0.7, { segments: 28, caps: true }),
    C.spiralPole,
    local(m, 0, 6.5, 0)
  )
  b.add(
    cylinder(4.2, 4, 0.6, { segments: 24, caps: true }),
    C.spiralPole,
    local(m, 0, 11.5, 0)
  )
  const helix = []
  const turns = 1.6
  const hn = 40
  for (let i = 0; i <= hn; i++) {
    const t = i / hn
    const a = t * turns * Math.PI * 2
    // 半径由 6.5 收到 3，高度 1.5 → 18.5
    const rad = 6.5 - 3.5 * t
    helix.push([Math.cos(a) * rad, 1.5 + 17 * t, Math.sin(a) * rad])
  }
  b.add(sweepBar(helix, 1.6, 0.5), L.glaze, m)
  b.add(sphere(0.9, 10, 7), L.glaze, local(m, 0, 17, 0))
}

/** 西半两道条形喷泉：石砌池沿 + 浅蓝水面（静态），一排白色细水柱（动画件） */
function buildFountains(b, jets, f) {
  const FL = FOUNTAIN_L
  const W = FOUNTAIN_W
  for (const fx of FOUNTAINS) {
    const m = local(f, fx, PAVE, 0)
    // 池沿：四边 0.6 m 宽、高出铺装 0.6 m
    b.add(box(W + 1.2, 0.6, 0.6), C.rim, local(m, 0, 0, FL / 2 + 0.3))
    b.add(box(W + 1.2, 0.6, 0.6), C.rim, local(m, 0, 0, -FL / 2 - 0.3))
    b.add(box(0.6, 0.6, FL), C.rim, local(m, W / 2 + 0.3, 0, 0))
    b.add(box(0.6, 0.6, FL), C.rim, local(m, -W / 2 - 0.3, 0, 0))
    // 水面
    b.add(box(W, WATER_TOP - PAVE + 0.1, FL), C.water, local(m, 0, -0.1, 0))
    // 水柱：沿中线每 4 m 一根，高矮交替；底在 y = 0（Mesh 整体抬到水面高度）
    const count = Math.floor(FL / 4)
    for (let i = 0; i <= count; i++) {
      const zz = -FL / 2 + 2 + ((FL - 4) * i) / count
      const h = i % 2 ? 2.6 : 4.2
      jets.add(
        cylinder(0.32, 0.12, h, { segments: 6, caps: true }),
        C.jet,
        local(f, fx, 0, zz)
      )
    }
  }
}

/**
 * 步行路径：广场局部坐标 → 世界坐标（qx、qz 为广场局部原点的世界坐标）。
 * 顺序与拆分前一致：散步线与中轴、金盘外环、下沉广场环路。
 */
function squareWalkways(qx, qz) {
  return [
    ...WALK_W.map((w) => ({
      points: offsetPoints(w.points, qx, qz),
      y: PAVE,
      width: w.width,
      closed: false,
      density: w.density
    })),
    {
      points: ringPoints(qx, qz, RING.r, 32),
      y: PAVE,
      width: RING.width,
      closed: true,
      density: RING.density
    },
    {
      points: ringPoints(qx + SUNKEN.x, qz + SUNKEN.z, SUNKEN_RING.r, 20),
      y: SUNKEN_RING.y,
      width: SUNKEN_RING.width,
      closed: true,
      density: SUNKEN_RING.density
    }
  ]
}

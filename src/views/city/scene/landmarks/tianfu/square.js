/*
 * 天府广场精细模型：广场铺装 + 太阳神鸟金盘 + S 形分界线 + 下沉广场 + 条形喷泉 +
 * 12 根图腾柱 + 毛主席像 + 四川科技馆 + 成都博物馆 + 四川省图书馆
 * ----------------------------------------------------------
 * 整体正南北布置。定位依据（OpenStreetMap）：
 * - 广场：place=square「天府广场」面的包围盒中心，294 × 190；
 * - 毛主席像：building:part「毛主席像」（min_height 15.2、height 27.46，
 *   即台基 8.1 + 基座 7.1 + 像身 12.3），立在一座无名三级台基楼（h 15.1）上；
 * - 四川科技馆：tourism=museum 面（不是 building，几何数据里没有），包围盒 142 × 110，
 *   正门朝南；像在科技馆正门以南约 80 m（OSM 实测），并非紧贴门前；
 * - 成都博物馆、四川省图书馆：几何数据里按名称查到，保留轮廓与高度。
 *
 * 广场局部坐标系：原点在广场中心、铺装顶面以下的地面，X 向东、Z 向南。
 * 广场内的草坪取自 OSM 公园面（相对广场中心），与城市树木层撒树的范围一致，
 * 这样通用树木正好长在草坪上，而不会戳进喷泉或下沉广场。
 */
import { BackSide, Matrix4, Mesh, Quaternion, Vector3 } from "three"
import { ColorBuilder, frame, landmarkMaterial, local } from "../kit/builder.js"
import {
  circlePolygon,
  findBuilding,
  minAreaRect,
  rectFrame,
  rectPolygon
} from "../kit/footprint.js"
import {
  box,
  cylinder,
  extrudePolygon,
  sphere,
  sweepBar
} from "../kit/shapes.js"
import { addBalustrade, addPlatform } from "../kit/parts.js"
import { addSunbirdDisc, addTotem } from "../kit/figures.js"
import { THEME } from "../../theme.js"
import { polygonBounds } from "../../utils.js"
import { GROUND_Y } from "../../terrain.js"

const NEAR = 400 // 按名称查楼的搜索半径（米）
const L = THEME.landmark

/* ---------------- 尺寸与定位 ---------------- */

// 广场：OSM 天府广场面包围盒中心；294 × 190，圆角半径 12
const SQUARE = { lon: 104.0632899, lat: 30.6597912, w: 294, d: 190, r: 12 }
// 铺装顶面高度：只需盖住道路（路面最高 0.9 m）；照片里广场边缘是一道
// 能坐人的低矮石沿，不宜抬高成台地。外沿再加一圈 1.5 m 宽、1.0 m 高的低台阶
const PAVE = 1.5
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
const WATER_TOP = PAVE + 0.4
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

// 毛主席像（OSM 点位）与三级台基（台基大小取像下那座无名台基楼的轮廓 76 × 56）
const STATUE = { lon: 104.0633079, lat: 30.6612661 }
const STATUE_TIERS = [
  [72, 52],
  [50, 36],
  [28, 20]
]
const TIER_H = 2.7 // 三级共 8.1
const PEDESTAL_H = 7.1

// 四川科技馆：OSM tourism=museum 面包围盒（142 × 110，正南北，正门朝南）
const SCIENCE = { lon: 104.0633057, lat: 30.6624898, w: 142.2, d: 110.3 }

// 按名称查不到时的回退轮廓（取自当前几何数据，世界坐标 [x, z]）
const FALLBACK = {
  成都博物馆: {
    h: 46.9,
    p: [
      [-465, -330],
      [-413, -330],
      [-411, -172],
      [-463, -171]
    ]
  },
  四川省图书馆: {
    h: 38.5,
    p: [
      [-518, -469],
      [-414, -472],
      [-414, -408],
      [-477, -399],
      [-517, -405]
    ]
  }
}

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
// 科技馆前南北轴线（毛主席像北侧、科技馆正门以南的空地，直接露出 terrain 地面）：
// 由科技馆正门前 5 m 走到像的台基北沿外 7 m，x 相对像中心
const AXIS = { z0: -75, z1: -33, width: 8, density: 1.5, y: GROUND_Y }

/* ---------------- 本景点专用色 ---------------- */

const C = {
  paveWest: "#E2DDD2", // 西半浅石材
  paveEast: "#BDB3A1", // 东半略深的石材（与西半拉开对比，突出太极两仪）
  curb: "#A9A499", // 外沿台阶
  sunkenFloor: "#A39B8E",
  step: "#C8C2B6",
  band: "#F4E6BC", // S 形浅金白色分界带
  lawn: "#86C95A",
  water: "#8FD0EA",
  jet: "#F4FAFF",
  rim: "#E6E1D6",
  spiralPole: "#DCE4E0",
  // 毛主席像
  tier: "#E2DCCF",
  pedestal: "#8C4A3C",
  statue: "#F2EFE7",
  // 四川科技馆
  sciWall: "#E8D8A8", // 米黄墙
  sciRed: "#B4553B", // 砖红线脚、塔顶
  sciGlass: "#2E3A4A", // 中部通高深色玻璃
  sciWindow: "#56606C",
  sign: "#D8352A",
  // 成都博物馆
  bronze: "#C9A55C", // 金色铜网
  bronzeLine: "#A7843F",
  museumGlass: "#4E9C82", // 绿色玻璃
  // 四川省图书馆
  libStone: "#D9CDB7",
  libFin: "#BCAE95",
  libGlass: "#5E93A6",
  libSlab: "#E6DECF"
}

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

/** 两点之间的圆柱（a、c 为父坐标系 [x, y, z]），用于雕像手臂 */
function strut(b, parent, a, c, r0, r1, color) {
  const dir = new Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2])
  const len = dir.length()
  const q = new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    dir.normalize()
  )
  const m = new Matrix4().compose(new Vector3(...a), q, new Vector3(1, 1, 1))
  b.add(
    cylinder(r0, r1, len, { segments: 8, caps: true }),
    color,
    parent.clone().multiply(m)
  )
}

/* ---------------- 广场 ---------------- */

/**
 * 广场铺装、分界线、金盘、下沉广场、喷泉、草坪、图腾柱。
 * @param {ColorBuilder} b 静态件
 * @param {ColorBuilder} jets 喷泉水柱（单独成动画 Mesh）
 * @param {Matrix4} f 广场坐标系（原点在广场中心地面）
 */
function buildSquare(b, jets, f) {
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

/* ---------------- 毛主席像 ---------------- */

/**
 * 三级浅色台基（共 8.1 m）+ 红褐基座 7.1 m + 白色立像 12.3 m，面朝正南（局部 +Z）。
 * 立像用几个几何体组合：外扩的大衣下摆、身体、肩、头、上扬的右手、背在身后的左手。
 */
function buildStatue(b, f) {
  let y = 0
  STATUE_TIERS.forEach(([w, d], i) => {
    addPlatform(b, local(f, 0, y, 0), {
      w,
      d,
      h: TIER_H,
      steps: "front",
      color: C.tier
    })
    // 第一、二级台面南侧两块绿篱花坛
    if (i < 2) {
      const nw = STATUE_TIERS[i + 1][0]
      const bw = (w - nw) / 2 - 4
      for (const sx of [-1, 1]) {
        b.add(
          box(bw, 0.5, d * 0.4),
          C.lawn,
          local(f, sx * (nw / 2 + 2 + bw / 2), y + TIER_H, d * 0.18)
        )
      }
    }
    y += TIER_H
  })
  // 红褐基座：主体 + 顶部压檐
  b.add(box(8, PEDESTAL_H - 0.8, 8), C.pedestal, local(f, 0, y, 0))
  b.add(box(9, 0.8, 9), C.pedestal, local(f, 0, y + PEDESTAL_H - 0.8, 0))
  y += PEDESTAL_H

  // 立像（局部 +Z 为正面；面朝南时像的右手在局部 -X 一侧）
  const s = local(f, 0, y, 0)
  b.add(cylinder(1.75, 1.25, 4.4, { segments: 12, caps: true }), C.statue, s)
  b.add(
    cylinder(1.25, 1.1, 3.8, { segments: 12, caps: true }),
    C.statue,
    local(s, 0, 4.4, 0)
  )
  b.add(box(3.0, 0.9, 1.7), C.statue, local(s, 0, 7.6, 0))
  b.add(
    cylinder(0.42, 0.42, 0.6, { segments: 8, caps: true }),
    C.statue,
    local(s, 0, 8.4, 0)
  )
  b.add(sphere(0.72, 12, 9), C.statue, local(s, 0, 8.85, 0.05))
  // 右臂：肩 → 肘 → 上扬的手
  strut(b, s, [-1.35, 8.2, 0], [-2.05, 9.9, 0.7], 0.42, 0.36, C.statue)
  strut(b, s, [-2.05, 9.9, 0.7], [-2.2, 11.8, 1.0], 0.36, 0.3, C.statue)
  b.add(sphere(0.42, 8, 6), C.statue, local(s, -2.2, 11.5, 1.0))
  // 左臂：垂下背到身后
  strut(b, s, [1.35, 8.2, 0], [1.55, 5.6, -0.6], 0.42, 0.34, C.statue)
}

/* ---------------- 四川科技馆 ---------------- */

/**
 * 米黄墙、砖红线脚与转角塔楼、中部通高深色玻璃柱廊、楼顶红色招牌。
 * f 原点在 OSM 包围盒中心、局部 +Z 朝南（正门）。
 * 平面：前部 142 × 28 的正立面体量 + 后部 112 × 83 的主体（与 OSM 轮廓一致）。
 */
function buildScience(b, f) {
  const hd = SCIENCE.d / 2
  const z0 = hd - 28 // 前部体量北缘
  const z1 = hd // 正立面
  const dz = z1 - z0
  const zc = (z0 + z1) / 2
  // 后部主体与屋面
  b.add(box(112, 27, z0 + hd), C.sciWall, local(f, 0, 0, (z0 - hd) / 2))
  b.add(box(108, 0.8, z0 + hd - 4), "#D6C594", local(f, 0, 27, (z0 - hd) / 2))

  // 正立面分段（|x| 区间、高度、类型）：两端低翼、外侧塔楼、墙段、内侧塔楼
  const parts = [
    { x0: 63, x1: 71.1, h: 17, kind: "wing" },
    { x0: 53, x1: 63, h: 30, kind: "tower" },
    { x0: 37, x1: 53, h: 24, kind: "wall" },
    { x0: 27, x1: 37, h: 30, kind: "tower" }
  ]
  for (const sx of [-1, 1]) {
    for (const p of parts) {
      const w = p.x1 - p.x0
      const x = (sx * (p.x0 + p.x1)) / 2
      b.add(box(w, p.h, dz), C.sciWall, local(f, x, 0, zc))
      // 窗带：深色横条，每层一条
      const rows = p.kind === "wing" ? [3, 8.5] : [3, 8.5, 14, 19.5]
      if (p.kind === "tower") rows.push(25)
      for (const y of rows) {
        b.add(box(w - 2.4, 2.3, 0.2), C.sciWindow, local(f, x, y, z1 + 0.05))
      }
      if (p.kind === "tower") {
        // 塔顶砖红压顶
        b.add(box(w + 0.8, 1.6, dz + 0.8), C.sciRed, local(f, x, p.h, zc))
      } else {
        // 顶部砖红檐口：只在正立面一条（屋面保持米黄）
        b.add(box(w, 1.0, 0.6), C.sciRed, local(f, x, p.h - 1, z1 + 0.3))
      }
    }
  }
  // 中部柱廊：米黄墙体 + 通高深色玻璃 + 8 根方柱（柱头砖红）
  b.add(box(54, 24, dz), C.sciWall, local(f, 0, 0, zc))
  b.add(box(52, 21, 0.2), C.sciGlass, local(f, 0, 0.5, z1 + 0.05))
  for (let i = 0; i < 8; i++) {
    const x = -24.5 + i * 7
    b.add(box(2.2, 21, 1.6), C.sciWall, local(f, x, 0, z1 + 0.8))
    b.add(box(2.6, 1.2, 2.0), C.sciRed, local(f, x, 20.2, z1 + 0.8))
  }
  // 两道通长砖红线脚：檐口下与柱头处（正立面 |x| ≤ 63）
  b.add(box(126, 1.2, 0.5), C.sciRed, local(f, 0, 22.4, z1 + 0.25))
  // 下道线脚只画在两侧（|x| ≥ 27），不横穿中部通高玻璃柱廊
  for (const sx of [-1, 1]) {
    b.add(box(36, 0.6, 0.5), C.sciRed, local(f, sx * 45, 16.2, z1 + 0.25))
  }

  // 楼顶招牌：五块红色字牌（四川科技馆）+ 下方白色英文条
  const sz = z1 - 5
  b.add(box(44, 1.4, 0.5), "#F2EEE4", local(f, 0, 24, sz))
  for (let i = 0; i < 5; i++) {
    b.add(box(5.8, 5.8, 0.5), C.sign, local(f, -16 + i * 8, 25.6, sz))
  }
}

/* ---------------- 成都博物馆 ---------------- */

/** 金色铜网立面（竖向网线 + 一道折线腰带）+ 底部与入口绿色玻璃；按 OSM 轮廓与高度 */
function buildChengduMuseum(b, bd) {
  const rect = minAreaRect(bd.p)
  // 局部 X 沿长边（南北），+Z 朝东（面向广场）
  const f = rectFrame(rect, 0, 90)
  const { w, d } = rect
  const H = bd.h || 46.9
  const podium = 10
  b.add(box(w - 4, podium, d - 4), C.museumGlass, f)
  b.add(box(w, H - podium, d), C.bronze, local(f, 0, podium, 0))
  b.add(box(w - 2, 0.6, d - 2), C.bronzeLine, local(f, 0, H, 0))
  // 腰带：铜网折线处略凸出
  b.add(box(w + 0.8, 1.2, d + 0.8), C.bronzeLine, local(f, 0, 27, 0))
  // 竖向网线：长边每 3.2 m、短边每 3.2 m 一道
  const lineH = H - podium - 0.4
  const nl = Math.floor(w / 3.2)
  for (let i = 1; i < nl; i++) {
    const x = -w / 2 + (w * i) / nl
    for (const sz of [-1, 1]) {
      b.add(
        box(0.5, lineH, 0.4),
        C.bronzeLine,
        local(f, x, podium + 0.2, sz * (d / 2 + 0.2))
      )
    }
  }
  const ns = Math.floor(d / 3.2)
  for (let i = 1; i < ns; i++) {
    const z = -d / 2 + (d * i) / ns
    for (const sx of [-1, 1]) {
      b.add(
        box(0.4, lineH, 0.5),
        C.bronzeLine,
        local(f, sx * (w / 2 + 0.2), podium + 0.2, z)
      )
    }
  }
  // 东立面中部绿色玻璃入口（通高 22 m）+ 白色雨棚
  b.add(box(34, 22, 1.2), C.museumGlass, local(f, 0, 0, d / 2 + 0.4))
  b.add(box(40, 0.8, 6), "#EDEBE4", local(f, 0, 9, d / 2 + 3))
}

/* ---------------- 四川省图书馆 ---------------- */

/**
 * 两座石材阙楼夹台阶式玻璃中庭（由南向北逐级升高）+ 竖向石材纹；正面朝南。
 * 主体按 OSM 轮廓南部的大矩形，北侧附楼按轮廓北端的小块。
 */
function buildLibrary(b, bd) {
  const bb = polygonBounds(bd.p)
  // 北侧附楼：轮廓里 z 最小（最北）一段的点
  const annexPts = bd.p.filter(([, z]) => z < bb.minZ + 5)
  const annexDepth = 21
  const hasAnnex = annexPts.length >= 2 && bb.maxZ - bb.minZ > 85
  const z0 = hasAnnex ? bb.minZ + annexDepth : bb.minZ
  const z1 = bb.maxZ - 4
  const W = bb.maxX - bb.minX
  const D = z1 - z0
  const H = bd.h || 38.5
  const f = frame((bb.minX + bb.maxX) / 2, 0, (z0 + z1) / 2, 0)

  const towerW = 22
  const atriumW = W - 2 * towerW
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - towerW / 2)
    b.add(box(towerW, H, D), C.libStone, local(f, x, 0, 0))
    b.add(box(towerW + 1, 1, D + 1), C.libFin, local(f, x, H, 0))
    // 竖向石材纹：南立面与外侧立面
    for (let i = 0; i < 8; i++) {
      const fx = x - towerW / 2 + 1.5 + (i * (towerW - 3)) / 7
      b.add(box(0.7, H - 2, 0.6), C.libFin, local(f, fx, 0, D / 2 + 0.3))
    }
    const nz = Math.floor(D / 3)
    for (let i = 0; i <= nz; i++) {
      const z = -D / 2 + 1.5 + ((D - 3) * i) / nz
      b.add(box(0.6, H - 2, 0.7), C.libFin, local(f, sx * (W / 2 + 0.3), 0, z))
    }
  }
  // 中庭：北半为高体量，南半四级玻璃台阶，顶面铺石
  const back = D * 0.43
  const zb = -D / 2 + back
  b.add(
    box(atriumW, H - 4, back),
    C.libGlass,
    local(f, 0, 0, -D / 2 + back / 2)
  )
  b.add(
    box(atriumW, 0.6, back),
    C.libSlab,
    local(f, 0, H - 4, -D / 2 + back / 2)
  )
  const terraces = 4
  const stepD = (D / 2 - zb) / terraces
  for (let i = 0; i < terraces; i++) {
    const h = 8 + i * 7
    const zf = D / 2 - i * stepD
    const depth = zf - zb
    const zc = (zf + zb) / 2
    b.add(box(atriumW, h, depth), C.libGlass, local(f, 0, 0, zc))
    // 石材压顶坐在玻璃体量顶上，并向前挑出 0.4 m，避免与玻璃面共面闪烁
    b.add(
      box(atriumW + 0.4, 0.8, depth + 0.4),
      C.libSlab,
      local(f, 0, h, zc + 0.2)
    )
  }
  // 正门前大台阶
  b.add(box(40, 1.2, 5), C.tier, local(f, 0, 0, D / 2 + 2.5))
  // 北侧附楼
  if (hasAnnex) {
    const ab = polygonBounds(annexPts)
    const aw = Math.max(10, ab.maxX - ab.minX)
    b.add(
      box(aw, Math.min(H, 30), annexDepth + 2),
      C.libStone,
      frame((ab.minX + ab.maxX) / 2, 0, bb.minZ + annexDepth / 2, 0)
    )
  }
}

/* ---------------- 入口 ---------------- */

/** 按名称查楼，查不到用回退轮廓 */
function lookup(buildings, name, spot) {
  const i = findBuilding(buildings, name, {
    near: [spot.x, spot.z],
    maxDist: NEAR
  })
  if (i >= 0) return buildings[i]
  return FALLBACK[name]
}

export function build(ctx) {
  const { project, buildings, spot } = ctx
  const b = new ColorBuilder()
  const jets = new ColorBuilder()
  const zones = []

  // 广场
  const [qx, qz] = project.toLocal(SQUARE.lon, SQUARE.lat)
  buildSquare(b, jets, frame(qx, 0, qz, 0))
  zones.push(rectPolygon(qx, qz, SQUARE.w + 4, SQUARE.d + 4, 90))

  // 毛主席像（替换像下那座无名台基楼）
  const [sx, sz] = project.toLocal(STATUE.lon, STATUE.lat)
  buildStatue(b, frame(sx, 0, sz, 0))
  zones.push(rectPolygon(sx + 1.5, sz + 4.5, 80, 62, 90))

  // 四川科技馆
  const [cx, cz] = project.toLocal(SCIENCE.lon, SCIENCE.lat)
  buildScience(b, frame(cx, 0, cz, 0))
  zones.push(rectPolygon(cx, cz, SCIENCE.w + 2, SCIENCE.d + 2, 90))

  // 成都博物馆、四川省图书馆
  const museum = lookup(buildings, "成都博物馆", spot)
  buildChengduMuseum(b, museum)
  zones.push(museum.p)
  const library = lookup(buildings, "四川省图书馆", spot)
  buildLibrary(b, library)
  zones.push(library.p)

  const mat = landmarkMaterial()
  // 本景点全由封闭体块组成：阴影贴图只画背光面（与通用楼一致），
  // 避免双面材质在大面积铺装上出现自阴影条纹
  mat.shadowSide = BackSide
  const mesh = new Mesh(b.bake(), mat)
  // 喷泉水柱：单独一个动画 Mesh，整体抬到水面高度，update 里只改 scale.y
  const jetMesh = new Mesh(jets.bake(), landmarkMaterial())
  jetMesh.position.y = WATER_TOP
  jetMesh.userData.animated = true

  // 步行路径：广场局部坐标 → 世界坐标
  const toWorld = (pts, ox, oz) => pts.map(([x, z]) => [ox + x, oz + z])
  const ring = (cx, cz, r, n) =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2
      return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]
    })
  const walkways = [
    ...WALK_W.map((w) => ({
      points: toWorld(w.points, qx, qz),
      y: PAVE,
      width: w.width,
      closed: false,
      density: w.density
    })),
    {
      points: ring(qx, qz, RING.r, 32),
      y: PAVE,
      width: RING.width,
      closed: true,
      density: RING.density
    },
    {
      points: ring(qx + SUNKEN.x, qz + SUNKEN.z, SUNKEN_RING.r, 20),
      y: SUNKEN_RING.y,
      width: SUNKEN_RING.width,
      closed: true,
      density: SUNKEN_RING.density
    },
    {
      // 轴线相对毛主席像中心：北端在科技馆正门前，南端在像的台基北沿外
      points: toWorld(
        [
          [0, AXIS.z0],
          [0, AXIS.z1]
        ],
        sx,
        sz
      ),
      y: AXIS.y,
      width: AXIS.width,
      closed: false,
      density: AXIS.density
    }
  ]

  return {
    meshes: [mesh, jetMesh],
    zones,
    // 落点球坐在广场中心金盘上（盘厚 0.3 + 纹样 0.15）
    markerHeight: PAVE + 0.45,
    walkways,
    update(t) {
      jetMesh.scale.y = 1 + 0.18 * Math.sin(t * 2.2)
    }
  }
}

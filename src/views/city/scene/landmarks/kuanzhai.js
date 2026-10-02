/*
 * 宽窄巷子
 * ----------------------------------------------------------
 * 宽巷子、窄巷子、井巷子三条平行老街（自北向南）及其间的川西民居院落：
 *   1. 三条巷按巷宽（7.7 / 4.5 / 5 m）铺浅石板路面，顶面 y = 1.0（高于道路面）；
 *   2. 区内低层 OSM 楼一律改成灰瓦悬山民居（檐口 4～6 m、屋脊 +2.5 m，青砖 / 白灰墙随机），
 *      轮廓先按巷道「掏空」：侵入巷面的部分切掉，巷面保持通畅；
 *   3. 巷两侧每 12 m 在檐下挂一个红灯笼（身后没有房屋时不挂，免得悬空）；
 *   4. 井巷子南侧一道约 330 m 的青砖文化墙（高 3 m、灰瓦墙帽、砖柱与浅色浮雕墙板），
 *      东端止于穿过井巷子南侧的小路（OSM 道路 #387，u ≈ 85）之前；
 *   5. 东入口（宽巷子东口的东广场）一座三间四柱单檐悬山牌坊，红柱灰瓦；
 *   6. 院落天井、巷边空地与宽巷子两侧种低多边形树：树冠比屋脊高时允许伸出屋檐，
 *      大树冠打破成片灰瓦（屋面按楼栋略微深浅不一，正脊用浅灰勾线，避免俯瞰成一块深色毯子）；
 *   7. 返回 walkways：三条巷的中线（收口后的两端），到站时人群系统在巷里生成行人。
 *
 * 巷道东西两端按数据收口：保留的通用楼（现代公寓）轮廓只要伸进巷面，巷面就在它前面截止，
 * 巷面、文化墙、灯笼都不会和保留楼相交。
 *
 * 街区坐标系（偏差说明一）：
 *   这一带（少城）街巷并非正东西向。OSM 楼轮廓的主方向集中在 25°～30°（按面积统计），
 *   按巷道方位扫描楼群空隙，三条巷的空隙在方位 118° 时最干净（即自西北向东南、偏东西约 28°）。
 *   故全部布局放在「街区坐标系」里：原点在 spot，u 沿巷指向东南偏东（方位 118°），
 *   v 垂直于巷指向南偏西（方位 208°）；即 frame(spot, 118 - 90) 的局部 x = u、z = v。
 *   巷中线的 v 由 OSM 巷道中点（LANES 的经纬度）经 toLocal 换算后投影得到，
 *   与楼群空隙吻合（宽 / 窄 / 井巷子分别在 v ≈ -11、58、103）。
 *
 * 选楼规则（偏差说明二）：
 *   - 以 spot 为中心、460（沿巷）× 260 的矩形内，低于 20 m 的楼全部重建；
 *   - 另外「历史核心带」（宽巷子北侧一排院落到井巷子，沿巷覆盖三条巷全长）里
 *     低于 30 m 的楼也重建：这一带 OSM 楼都没有高度 / 层数标签，
 *     数据里的高度是按 building=yes 在 9～30 m 间随机估的，并非真实的现代楼；
 *     真正的现代公寓（building=apartments）估高 ≥ 30 m，仍留给通用楼层。
 * zones 只返回被重建楼各自的外接矩形（外扩 0.5 m），不会误删其他楼。
 */
import { Mesh } from "three"
import { THEME } from "../theme.js"
import {
  mulberry32,
  pointInPolygon,
  polygonBounds,
  shapeSeed
} from "../utils.js"
import { ColorBuilder, frame, landmarkMaterial, local } from "./kit/builder.js"
import {
  centroid,
  circlePolygon,
  clipHalfPlane,
  distToSegment,
  minAreaRect,
  polygonArea,
  rectPolygon
} from "./kit/footprint.js"
import { box, cylinder, sphere } from "./kit/shapes.js"
import { gableRidge, gableRoof } from "./kit/roofs.js"
import { addPitchedHouse, housePieces } from "./kit/parts.js"
import { addTree } from "./kit/figures.js"

const L = THEME.landmark
const DEG = Math.PI / 180

/* ---------------- 定位与尺寸常量 ---------------- */

// 巷道方位（度，自西北指向东南）：街区坐标系的 u 轴
const BEARING = 118
// 巷面（石板路）顶面高度：高于道路最高面 0.9 m，避免深度冲突
const LANE_Y = 1.0
// 重建矩形（街区坐标系）：以 spot 为中心，沿巷 460、垂直巷 260
const REGION = { w: 460, d: 260 }
// 矩形内低于此高度的楼重建为民居
const LOW_H = 20
// 历史核心带内低于此高度的楼也重建（见文件头「偏差说明二」）
const CORE_H = 30
// 历史核心带：北界在宽巷子中线以北 36 m（北侧一排院落，再往北是现代公寓），
// 南界在井巷子中线以南 3 m
const CORE_NORTH = 36
const CORE_SOUTH = 3

/*
 * 三条巷（自北向南）：lon / lat 为 OSM 巷道中点（只取它在街区坐标系里的 v），width 为巷宽；
 * u0 / u1 为巷两端的 u（米，相对 spot 沿巷方向）：巷长约 400 m，
 * 西端止于下同仁路东侧路缘，宽巷子东端接东广场。
 */
const LANES = [
  {
    name: "宽巷子",
    lon: 104.05093,
    lat: 30.66656,
    width: 7.7,
    u0: -273,
    u1: 130
  },
  {
    name: "窄巷子",
    lon: 104.05086,
    lat: 30.66589,
    width: 4.5,
    u0: -250,
    u1: 150
  },
  { name: "井巷子", lon: 104.05052, lat: 30.66558, width: 5, u0: -246, u1: 152 }
]

// 巷宽按墙到墙计：临巷房屋的墙面就立在巷边（出檐 0.6 m 挑进巷子上空）。
// 石板路面两侧各多铺 PAVE_TUCK 压进墙根，路面侧面藏进墙里，不与墙面共面闪烁。
// 文化墙背后的房屋离墙留 BEHIND_WALL 的空隙
const PAVE_TUCK = 0.1
const BEHIND_WALL = 0.5
// 掏空后剩下的碎块小于这些尺寸就不建（细条、碎角）
const MIN_PIECE_AREA = 10
const MIN_PIECE_WIDTH = 2.5

// 民居：檐口 4～6 m（离巷面）、屋脊高出檐口 2.5 m
const HOUSE = { eaveMin: 4, eaveMax: 6, ridgeH: 2.5, overhang: 0.6 }
// 民居屋面：比 kit 灰瓦略浅的石板灰，每栋按 ±5% 深浅浮动；正脊用浅灰勾出屋脊线
const ROOF = { base: "#5C6573", jitter: 0.05, ridge: "#8E959E" }
// 大块轮廓改建成合院：四面房进深 5～7 m（取短边的 0.3），中间天井至少 5 m 见方
const COURT = { minSide: 17, depthMin: 5, depthMax: 7, ratio: 0.3, open: 5 }
// 随机种子（确定性随机：同一份数据每次加载结果相同）
const SEED = 20260929

// 灯笼：沿巷每 12 m 一个，灯笼顶离巷面 3.5 m；民居檐下的灯笼球心离墙面 out 米
const LANTERN = { step: 12, r: 0.4, top: 3.5, out: 0.45 }
// 巷面收口时离保留楼轮廓留的空隙（米）
const END_GAP = 0.5

// 井巷子南侧文化墙：离巷面高 3 m、厚 0.6 m，墙面即巷南缘；砖柱间距 12 m，每 2 跨一块浮雕墙板
const WALL = { h: 3, t: 0.6, pier: 12, panelEvery: 2 }
// 文化墙东端：OSM 道路 #387（d 级小路，宽 5～7 m）在 u ≈ 85 处南北向穿过井巷子南侧，
// ctx 不含道路，按数据写死：墙止于路西侧路缘外 0.5 m（85 − 3.5 − 0.5），墙长约 330 m
const WALL_EAST_U = 81
// 墙上灯笼离墙面的距离：浮雕墙板凸出墙面 0.15 m，灯笼（半径 0.4）挂在 0.6 m 外不碰墙板
const WALL_LANTERN_OUT = 0.6

// 东广场（OSM 约 104.05329, 30.66563，在宽巷子东口外）：铺装范围（街区坐标系 u / v）
const PLAZA = { u0: 130, u1: 182, v0: -30, v1: -2 }
// 牌坊立在宽巷子中线上、广场西侧（巷口），正面朝东广场（+u）
const GATE_U = 138

// 树：候选点网格间距、数量上限、树冠半径范围、树冠离屋檐的净距、树干离墙的净距、
// 抬到屋脊以上的树冠离屋脊的净距、树冠中心最高高度
const TREE = {
  grid: 4,
  max: 70,
  rMin: 3,
  rMax: 4.5,
  clear: 0.9,
  trunkClear: 0.3,
  overRidge: 0.3,
  maxCrownY: 16
}
// 宽巷子两侧的行道大树：棵数、树冠中心高度、树冠半径范围、树干离墙面的距离
const LANE_TREES = { count: 11, crownY: 9, rMin: 3, rMax: 3.4, fromWall: 1.6 }

/* ---------------- 街区坐标系 ---------------- */

/**
 * 街区坐标系：u 沿巷（方位 BEARING），v 垂直于巷（方位 BEARING + 90）。
 * frame 为对应的 Matrix4（局部 x = u、z = v），toUV / toXZ 在它与世界坐标 [x, z] 间换算。
 */
function districtAxes(spot) {
  const a = BEARING * DEG
  const U = [Math.sin(a), -Math.cos(a)]
  const V = [Math.cos(a), Math.sin(a)]
  return {
    frame: frame(spot.x, 0, spot.z, BEARING - 90),
    toUV: ([x, z]) => {
      const dx = x - spot.x
      const dz = z - spot.z
      return [dx * U[0] + dz * U[1], dx * V[0] + dz * V[1]]
    },
    toXZ: ([u, v]) => [
      spot.x + u * U[0] + v * V[0],
      spot.z + u * U[1] + v * V[1]
    ]
  }
}

/* ---------------- 几何小工具（街区坐标系下） ---------------- */

/** 点到多边形边界的最短距离 */
function edgeDist(px, pz, poly) {
  let d = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    d = Math.min(d, distToSegment(px, pz, poly[j], poly[i]))
  }
  return d
}

/**
 * 用一条沿巷的「禁建带」切轮廓（街区坐标系）：strip = { u0, u1, v0, v1 }。
 * 保留带北（v < v0）、带南（v > v1）两部分，以及落在带内但超出巷两端（u < u0 或 u > u1）的部分。
 * 与带不相交的轮廓原样返回。clipHalfPlane 保留满足 (p - o)·n ≥ 0 的一侧。
 */
function cutStrip(points, s) {
  const b = polygonBounds(points)
  if (b.maxZ <= s.v0 || b.minZ >= s.v1 || b.maxX <= s.u0 || b.minX >= s.u1) {
    return [points]
  }
  const out = [
    clipHalfPlane(points, [0, s.v0], [0, -1]),
    clipHalfPlane(points, [0, s.v1], [0, 1])
  ]
  // 带内那一段：只留巷两端以外的部分
  const band = clipHalfPlane(
    clipHalfPlane(points, [0, s.v0], [0, 1]),
    [0, s.v1],
    [0, -1]
  )
  if (band.length >= 3) {
    out.push(clipHalfPlane(band, [s.u0, 0], [-1, 0]))
    out.push(clipHalfPlane(band, [s.u1, 0], [1, 0]))
  }
  return out.filter((p) => p.length >= 3)
}

/** 依次用每条禁建带切轮廓，丢掉碎块，返回可建房的块（街区坐标系） */
function carve(points, strips) {
  let pieces = [points]
  for (const s of strips) {
    pieces = pieces.flatMap((p) => cutStrip(p, s))
  }
  return pieces.filter(
    (p) =>
      polygonArea(p) >= MIN_PIECE_AREA && minAreaRect(p).d >= MIN_PIECE_WIDTH
  )
}

/**
 * 大块规整轮廓改成合院（川西民居「一颗印」式四合院）：沿外接矩形四边各一栋房，中间留天井。
 * 输入输出都在街区坐标系。块不够大、不够规整时原样返回 [points]。
 * 长边两栋通长、短边两栋夹在中间；各栋自成一块矩形，屋顶在转角处自然相交。
 * @returns {{ wings: Array<Array<[number, number]>>, court: object|null }}
 */
function courtyard(points) {
  const r = minAreaRect(points)
  const fill = polygonArea(points) / (r.w * r.d)
  if (fill < 0.85 || r.d < COURT.minSide)
    return { wings: [points], court: null }
  const D = Math.min(
    COURT.depthMax,
    Math.max(COURT.depthMin, COURT.ratio * r.d)
  )
  if (r.w - 2 * D < COURT.open || r.d - 2 * D < COURT.open) {
    return { wings: [points], court: null }
  }
  const a = r.bearing * DEG
  // e1 沿长边、e2 沿短边（与 rectPolygon 的方位约定一致）
  const e1 = [Math.sin(a), -Math.cos(a)]
  const e2 = [Math.cos(a), Math.sin(a)]
  const at = (s1, s2) => [
    r.cx + e1[0] * s1 + e2[0] * s2,
    r.cz + e1[1] * s1 + e2[1] * s2
  ]
  const wings = []
  // 长边两栋：通长 w、进深 D
  for (const sd of [-1, 1]) {
    const [x, z] = at(0, sd * (r.d / 2 - D / 2))
    wings.push(rectPolygon(x, z, r.w, D, r.bearing))
  }
  // 短边两栋：长 d - 2D（沿 e2）、进深 D
  for (const sw of [-1, 1]) {
    const [x, z] = at(sw * (r.w / 2 - D / 2), 0)
    wings.push(rectPolygon(x, z, r.d - 2 * D, D, r.bearing + 90))
  }
  return {
    wings,
    court: { u: r.cx, v: r.cz, open: Math.min(r.w, r.d) - 2 * D }
  }
}

/* ---------------- 步行路径 ---------------- */

// 小人身体半径：crowd.js 低多边形小人躯干底部半径为 0.2 × 身高（身高 4 m 时 0.8 m）
const BODY_R = THEME.crowd.height * 0.2
// 身体离障碍再留的余量（米），防止贴着灯笼、树干擦过
const WALK_MARGIN = 0.05

/**
 * 巷一侧（side = -1 为北侧、1 为南侧，即 v 的负 / 正方向）从墙面往巷中心要让出的距离：
 * 可走带的边缘 + 身体半径不能碰到该侧伸进巷子的东西。
 *   - 民居一侧：檐下灯笼伸到离墙 LANTERN.out + r（0.85 m），出檐 0.6 m 在它以内；
 *   - 井巷子南侧文化墙：墙上灯笼伸到离墙 WALL_LANTERN_OUT + r（1.0 m）；
 *   - 宽巷子：两侧行道树树干立在巷面上，离墙 fromWall、半径最大 min(0.12 rMax, 0.45)，
 *     比灯笼伸得更远（约 2 m），宽巷子两侧都按树干算（树左右交替种）。
 * 行道树树冠底离巷面约 4.1～4.5 m，在 4 m 小人头顶之上，不再为树冠收窄。
 * @param {boolean} isKuan 是否宽巷子
 * @param {boolean} isJing 是否井巷子
 * @param {number} side -1 北侧 / 1 南侧
 */
function walkClear(isKuan, isJing, side) {
  let reach = Math.max(HOUSE.overhang, LANTERN.out + LANTERN.r)
  if (isJing && side > 0) reach = WALL_LANTERN_OUT + LANTERN.r
  if (isKuan) {
    const trunkR = Math.min(0.12 * LANE_TREES.rMax, 0.45)
    reach = Math.max(reach, LANE_TREES.fromWall + trunkR)
  }
  return reach + BODY_R + WALK_MARGIN
}

/* ---------------- 构件 ---------------- */

/**
 * 简化灯笼（20 个三角形）：压扁的红色低细分球，(x, y, z) 为球心（父坐标系）。
 * kit 的 addLantern 约 180 个三角形，本景点要挂近百个，预算吃不消；
 * 生产相机最近 300 m（约 0.15 m/像素），直径 0.8 m 的灯笼只有几个像素，帽子、流苏看不出来。
 */
function addLanternLite(b, parent, x, y, z, r) {
  b.add(
    sphere(r, 5, 3),
    L.lantern,
    local(parent, x, y - r * 0.85, z, 0, 1, 0.85)
  )
}

/**
 * 按比例调整 sRGB 十六进制颜色的明度（各通道同乘 k，结果仍是 sRGB 字符串）。
 * 用于民居屋面逐栋深浅浮动。
 */
function shadeHex(hex, k) {
  const n = Number.parseInt(hex.slice(1), 16)
  const ch = (shift) =>
    Math.min(255, Math.round(((n >> shift) & 255) * k))
      .toString(16)
      .padStart(2, "0")
  return `#${ch(16)}${ch(8)}${ch(0)}`
}

/**
 * 悬山顶正脊两端的一对上翘脊头（吻）。m 为屋顶坐标系（檐口 y = 0），
 * w / h / overhang 同 gableRoof 的参数。返回局部最高点 y。
 */
function addRidgeEnds(b, m, w, h, overhang) {
  const x = w / 2 + overhang - 0.15
  for (const sx of [-1, 1]) {
    b.add(box(0.3, 0.75, 0.3), L.roofRidge, local(m, sx * x, h, 0))
    // 脊头向外挑出的一小段，形成翘起的剪影
    b.add(
      box(0.35, 0.18, 0.26),
      L.roofRidge,
      local(m, sx * (x + 0.2), h + 0.55, 0)
    )
  }
  return h + 0.75
}

/**
 * 东入口牌坊：三间四柱、单檐悬山（明间高、次间低），红柱灰瓦。
 * f 为牌坊坐标系：局部 X 沿面宽、+Z 为正面，y = 0 为广场地面。
 * @returns {number} 局部最高点 y
 */
function addGateway(b, f) {
  const mainW = 5.2 // 明间面宽（柱中到柱中）
  const sideW = 3 // 次间面宽
  const hMain = 6.4 // 明间柱高
  const hSide = 5 // 边柱高
  const cols = [-mainW / 2 - sideW, -mainW / 2, mainW / 2, mainW / 2 + sideW]
  for (const x of cols) {
    const inner = Math.abs(x) < mainW / 2 + 0.1
    // 夹杆石（柱脚前后夹一块石墩）+ 红柱
    b.add(box(0.9, 1.2, 1.5), L.granite, local(f, x, 0, 0))
    b.add(
      cylinder(0.3, 0.27, inner ? hMain : hSide, { segments: 8 }),
      L.column,
      local(f, x, 0, 0)
    )
  }

  // 明间：大额枋、小额枋，中间夹匾额（金边深红底；底板比金边厚 0.3 m，前后各凸出 0.15 m）
  b.add(box(mainW + 0.3, 0.55, 0.45), L.lattice, local(f, 0, hMain - 0.55, 0))
  b.add(box(mainW, 0.4, 0.4), L.lattice, local(f, 0, hMain - 1.95, 0))
  b.add(box(2.6, 0.95, 0.5), L.gold, local(f, 0, hMain - 1.52, 0))
  b.add(box(2.2, 0.7, 0.8), L.lattice, local(f, 0, hMain - 1.4, 0))
  // 次间额枋
  for (const sx of [-1, 1]) {
    const x = sx * (mainW / 2 + sideW / 2)
    b.add(box(sideW, 0.45, 0.4), L.lattice, local(f, x, hSide - 0.45, 0))
  }

  // 明间屋顶：柱顶一道斗栱层（深红色带），上盖悬山顶
  const go = { overhang: 0.8, gables: false, ridges: false }
  const mainRoofW = mainW + 1.2
  b.add(box(mainRoofW - 0.2, 0.5, 1.1), L.lattice, local(f, 0, hMain, 0))
  const mm = local(f, 0, hMain + 0.5, 0)
  b.add(gableRoof(mainRoofW, 1.6, 1.4, go), L.roof, mm)
  b.add(gableRidge(mainRoofW, 1.6, 1.4, go), L.roofRidge, mm)
  const top = hMain + 0.5 + addRidgeEnds(b, mm, mainRoofW, 1.4, go.overhang)

  // 次间屋顶：比明间低一截，内侧抵到明间柱
  const so = { overhang: 0.7, gables: false, ridges: false }
  for (const sx of [-1, 1]) {
    const x = sx * (mainW / 2 + sideW / 2)
    b.add(box(sideW - 0.2, 0.4, 0.9), L.lattice, local(f, x, hSide, 0))
    const ms = local(f, x, hSide + 0.4, 0)
    b.add(gableRoof(sideW, 1.4, 1.1, so), L.roof, ms)
    b.add(gableRidge(sideW, 1.4, 1.1, so), L.roofRidge, ms)
    addRidgeEnds(b, ms, sideW, 1.1, so.overhang)
  }
  return top
}

/**
 * 井巷子南侧文化墙：青砖墙身 + 等距砖柱 + 灰瓦墙帽 + 朝巷一面的浅色浮雕墙板。
 * F 为街区坐标系；u0 / u1 为墙两端，vFace 为朝巷（北）一面的 v。
 */
function addCultureWall(b, F, u0, u1, vFace) {
  const len = u1 - u0
  const cu = (u0 + u1) / 2
  const cv = vFace + WALL.t / 2
  const top = LANE_Y + WALL.h
  // 墙身从地面起（巷面以下部分被石板路面挡住）
  b.add(box(len, top, WALL.t), L.brick, local(F, cu, 0, cv))
  // 砖柱：比墙身厚 0.24 m、略高出墙帽下沿
  const piers = Math.max(1, Math.round(len / WALL.pier))
  const step = len / piers
  for (let k = 0; k <= piers; k++) {
    b.add(
      box(0.8, top + 0.1, WALL.t + 0.24),
      L.brick,
      local(F, u0 + k * step, 0, cv)
    )
  }
  // 墙帽：沿墙一道小悬山灰瓦顶
  const go = { overhang: 0.25, gables: false, ridges: false }
  const m = local(F, cu, top + 0.1, cv)
  b.add(gableRoof(len, WALL.t, 0.35, go), L.roof, m)
  b.add(gableRidge(len, WALL.t, 0.35, go), L.roofRidge, m)
  // 浮雕墙板：放在两根砖柱正中，朝巷一面凸出墙面 0.15 m、比砖柱面再凸出 0.03 m
  // （墙板比柱间净宽窄，与砖柱不相接，不会出现共面闪烁）
  for (let k = 0; k < piers; k += WALL.panelEvery) {
    b.add(
      box(step * 0.7, 1.6, 0.3),
      L.granite,
      local(F, u0 + (k + 0.5) * step, LANE_Y + 0.7, vFace)
    )
  }
}

/* ---------------- 布局：收口与选楼 ---------------- */

/**
 * 把一段沿巷的带状区域 span = { u0, u1, v0, v1 }（街区坐标系）按保留楼收口：
 * 保留楼轮廓伸进带内的部分若在 spot 以东（u > 0），带的东端截到它西侧 END_GAP 处；
 * 在 spot 以西则截西端。返回新的 { u0, u1 }。
 */
function trimToKept(span, kept) {
  let { u0, u1 } = span
  for (const { p, bb } of kept) {
    if (bb.maxZ <= span.v0 || bb.minZ >= span.v1) continue
    if (bb.maxX <= span.u0 || bb.minX >= span.u1) continue
    let c = clipHalfPlane(p, [0, span.v0], [0, 1])
    c = clipHalfPlane(c, [0, span.v1], [0, -1])
    c = clipHalfPlane(c, [span.u0, 0], [1, 0])
    c = clipHalfPlane(c, [span.u1, 0], [-1, 0])
    if (c.length < 3 || polygonArea(c) < 0.05) continue
    const us = c.map(([u]) => u)
    const lo = Math.min(...us)
    const hi = Math.max(...us)
    if (lo > 0) u1 = Math.min(u1, lo - END_GAP)
    else if (hi < 0) u0 = Math.max(u0, hi + END_GAP)
  }
  return { u0, u1 }
}

/* ---------------- 主构建 ---------------- */

export function build(ctx) {
  const { project, buildings, spot } = ctx
  const b = new ColorBuilder()
  const { frame: F, toUV, toXZ } = districtAxes(spot)

  // 巷道：中线 v 取 OSM 巷道中点在街区坐标系里的投影（两端先取名义值，选楼后再按保留楼收口）
  const lanes = LANES.map((l) => {
    const [, v] = toUV(project.toLocal(l.lon, l.lat))
    return { ...l, v }
  })
  const [kuan, , jing] = lanes
  // 文化墙朝巷一面的 v（井巷子南缘）
  const wallFace = jing.v + jing.width / 2

  // 历史核心带（按名义巷长划定，只用于选楼）
  const core = {
    u0: Math.min(...lanes.map((l) => l.u0)),
    u1: Math.max(...lanes.map((l) => l.u1)),
    v0: kuan.v - CORE_NORTH,
    v1: jing.v + CORE_SOUTH
  }
  const inCore = (u, v) =>
    u >= core.u0 && u <= core.u1 && v >= core.v0 && v <= core.v1

  /* ---- 1. 选楼：重建 / 保留 ---- */
  const rebuilds = [] // { i, uv, c }：要改成民居的楼
  const kept = [] // { p（街区坐标系）, bb }：不重建、仍由通用楼层绘制的附近楼
  const keptCenters = [] // 保留楼的顶点平均点（世界坐标；替换区按它判断楼是否被隐藏）
  // 只看重建矩形与核心带并集附近的楼（街区坐标系包围盒外扩 40 m）
  const near = {
    u0: Math.min(-REGION.w / 2, core.u0) - 40,
    u1: Math.max(REGION.w / 2, core.u1) + 40,
    v0: Math.min(-REGION.d / 2, core.v0) - 40,
    v1: Math.max(REGION.d / 2, core.v1) + 40
  }
  buildings.forEach((bd, i) => {
    if (!bd.p || bd.p.length < 3) return
    const c = centroid(bd.p)
    const [cu, cv] = toUV(c)
    if (cu < near.u0 || cu > near.u1 || cv < near.v0 || cv > near.v1) return
    const uv = bd.p.map(toUV)
    const inRect = Math.abs(cu) <= REGION.w / 2 && Math.abs(cv) <= REGION.d / 2
    const rebuild =
      (inRect && bd.h < LOW_H) || (inCore(cu, cv) && bd.h < CORE_H)
    if (rebuild) {
      rebuilds.push({ i, uv, c })
    } else {
      kept.push({ p: uv, bb: polygonBounds(uv) })
      keptCenters.push(c)
    }
  })

  /* ---- 2. 巷道、文化墙按保留楼收口 ---- */
  for (const l of lanes) {
    // 带宽含压进墙根的路面边
    const half = l.width / 2 + PAVE_TUCK
    Object.assign(
      l,
      trimToKept({ u0: l.u0, u1: l.u1, v0: l.v - half, v1: l.v + half }, kept)
    )
  }
  // 文化墙带：墙身 + 两侧砖柱、墙帽出挑（各 0.3 m）
  const wall = trimToKept(
    {
      u0: jing.u0,
      u1: Math.min(jing.u1, WALL_EAST_U),
      v0: wallFace - 0.3,
      v1: wallFace + WALL.t + 0.3
    },
    kept
  )

  // 禁建带：巷面（墙到墙）；井巷子南侧再包住文化墙及其背后的空隙；广场也不建房
  const strips = lanes.map((l) => ({
    u0: l.u0,
    u1: l.u1,
    v0: l.v - l.width / 2,
    v1: l === jing ? wallFace + WALL.t + BEHIND_WALL : l.v + l.width / 2
  }))
  strips.push({ ...PLAZA })

  /* ---- 3. 石板巷面与东广场 ---- */
  for (const l of lanes) {
    b.add(
      box(l.u1 - l.u0, LANE_Y, l.width + 2 * PAVE_TUCK),
      L.stonePave,
      local(F, (l.u0 + l.u1) / 2, 0, l.v)
    )
  }
  b.add(
    box(PLAZA.u1 - PLAZA.u0, LANE_Y, PLAZA.v1 - PLAZA.v0),
    L.stonePave,
    local(F, (PLAZA.u0 + PLAZA.u1) / 2, 0, (PLAZA.v0 + PLAZA.v1) / 2)
  )

  /* ---- 4. 民居 ---- */
  const zones = []
  const pieces = [] // { p（街区坐标系）, bb, top }：每块房子（灯笼、树、落点高度都要用）
  const courts = [] // 合院天井中心（街区坐标系）
  for (const { i, uv, c } of rebuilds) {
    // 替换区：原轮廓的最小外接矩形外扩 0.5 m（与保留楼冲突时见下文回退）
    const r = minAreaRect(buildings[i].p)
    zones.push({
      rect: rectPolygon(r.cx, r.cz, r.w + 1, r.d + 1, r.bearing),
      c
    })

    // 每栋楼一个独立的随机序列（按楼的原始轮廓播种，见 utils.shapeSeed），
    // 与遍历顺序、楼栋在数据列表里的下标都无关：数据扩范围插入新楼时这里不变
    const rand = mulberry32(shapeSeed(SEED, buildings[i].p))
    const eave = HOUSE.eaveMin + (HOUSE.eaveMax - HOUSE.eaveMin) * rand()
    const wallColor = rand() < 0.5 ? L.brick : L.plaster
    const roofColor = shadeHex(ROOF.base, 1 + (rand() * 2 - 1) * ROOF.jitter)
    // 掏空巷道后，L / U 形等不规整轮廓先按 kit 的规则切成矩形块，大块再拆成合院
    // （天井中心记下来种树）
    const blocks = []
    for (const p of carve(uv, strips)) {
      for (const hp of housePieces(p)) {
        const { wings, court } = courtyard(hp.points)
        blocks.push(...wings)
        if (court) courts.push(court)
      }
    }
    for (const p of blocks) {
      // 临巷的块：屋脊尽量平行巷子（川西临街铺面的常见做法）；块太「纵深」时仍沿长边
      const pb = polygonBounds(p)
      const byLane = lanes.some(
        (l) =>
          pb.maxX > l.u0 &&
          pb.minX < l.u1 &&
          Math.min(
            Math.abs(pb.minZ - (l.v + l.width / 2)),
            Math.abs(l.v - l.width / 2 - pb.maxZ)
          ) < 0.5
      )
      const along = pb.maxX - pb.minX
      const across = pb.maxZ - pb.minZ
      const res = addPitchedHouse(b, p.map(toXZ), {
        // 墙从地面起，檐口高度按离巷面计
        eaveH: LANE_Y + eave,
        ridgeH: HOUSE.ridgeH,
        overhang: HOUSE.overhang,
        wallColor,
        roofColor,
        ridgeColor: ROOF.ridge,
        ridgeBearing: byLane && along >= 0.6 * across ? BEARING : undefined
      })
      if (res) pieces.push({ p, bb: pb, top: res.top })
    }
  }

  // 点 (u, v) 是否落在任一楼（重建块或保留的楼）内：挂灯笼时判断身后有没有房
  const occupied = (u, v) =>
    pieces.some(({ p }) => pointInPolygon(u, v, p)) ||
    kept.some(({ p }) => pointInPolygon(u, v, p))

  /* ---- 5. 灯笼 ---- */
  // 灯笼沿巷的位置：每条巷居中排布，两端各留半个间距（巷面收口后按新的两端重排）
  const lanternUs = (u0, u1) => {
    const n = Math.floor((u1 - u0) / LANTERN.step)
    const start = (u0 + u1) / 2 - ((n - 1) * LANTERN.step) / 2
    return Array.from({ length: n }, (_, k) => start + k * LANTERN.step)
  }
  for (const l of lanes) {
    for (const u of lanternUs(l.u0, l.u1)) {
      for (const side of [-1, 1]) {
        const edge = l.v + (side * l.width) / 2
        if (l === jing && side > 0) {
          // 井巷子南侧挂在文化墙上（只在墙的范围内）：比墙顶低 0.5 m
          if (u < wall.u0 + 1 || u > wall.u1 - 1) continue
          const y = LANE_Y + WALL.h - 0.5
          addLanternLite(b, F, u, y, wallFace - WALL_LANTERN_OUT, LANTERN.r)
          continue
        }
        // 身后（墙内 1 m 处）有房才挂；挂在檐下，离墙面 LANTERN.out（出檐 0.6 m 以内）
        if (!occupied(u, edge + side * 1)) continue
        const y = LANE_Y + LANTERN.top - LANTERN.r * 1.4
        addLanternLite(b, F, u, y, edge - side * LANTERN.out, LANTERN.r)
      }
    }
  }

  /* ---- 6. 井巷子文化墙 ---- */
  addCultureWall(b, F, wall.u0, wall.u1, wallFace)

  /* ---- 7. 东入口牌坊 ---- */
  // 立在宽巷子中线上；正面朝东广场（+u，方位 BEARING）：frame 的 +Z 指向 bearing + 180°
  const [gx, gz] = toXZ([GATE_U, kuan.v])
  const gateTop = LANE_Y + addGateway(b, frame(gx, LANE_Y, gz, BEARING + 180))

  /* ---- 8. 树 ---- */
  const trand = mulberry32(SEED + 7)
  const greens = THEME.tree.greens
  const nearPoly = ({ bb, p }, u, v, d) =>
    u > bb.minX - d &&
    u < bb.maxX + d &&
    v > bb.minZ - d &&
    v < bb.maxZ + d &&
    (pointInPolygon(u, v, p) || edgeDist(u, v, p) < d)

  // 候选点：先是各合院天井中心，再是核心带内抖动网格（随机排序打散）
  const grid = []
  for (let u = core.u0 + 20; u <= core.u1 - 5; u += TREE.grid) {
    for (let v = core.v0; v <= core.v1; v += TREE.grid) {
      grid.push({
        u: u + (trand() - 0.5) * TREE.grid * 0.8,
        v: v + (trand() - 0.5) * TREE.grid * 0.8,
        key: trand()
      })
    }
  }
  grid.sort((a, c) => a.key - c.key)
  const cands = [...courts.map((c) => ({ ...c, court: true })), ...grid]

  const trees = []
  for (const c of cands) {
    if (trees.length >= TREE.max) break
    const s = TREE.rMin + (TREE.rMax - TREE.rMin) * trand()
    const trunkR = Math.min(0.12 * s, 0.45)
    // 树干：不进巷面、广场，不越过文化墙，不进保留楼
    const inStrip = (d) =>
      strips.some(
        (t) =>
          c.u > t.u0 - d && c.u < t.u1 + d && c.v > t.v0 - d && c.v < t.v1 + d
      )
    if (inStrip(1) || c.v > wallFace - 1) continue
    // 保留楼（现代楼）四周整棵树都要让开
    if (kept.some((k) => nearPoly(k, c.u, c.v, s + TREE.clear))) continue
    // 树干离民居墙面至少出檐 + 净距（不从屋檐里长出来）
    const trunkNeed = HOUSE.overhang + trunkR + TREE.trunkClear
    if (pieces.some((q) => nearPoly(q, c.u, c.v, trunkNeed))) continue
    // 树冠范围内的民居：没有就按常规高度种；有就把树冠抬到它们屋脊以上，允许伸出屋檐
    const reach = s + HOUSE.overhang + (c.court ? 0.2 : TREE.clear)
    let top = 0
    for (const q of pieces) {
      if (nearPoly(q, c.u, c.v, reach)) top = Math.max(top, q.top)
    }
    // 常规树冠中心 1.7 s（树冠底 0.55 s）；抬高时树冠底离屋脊 overRidge
    const crownY = top > 0 ? top + TREE.overRidge + 1.15 * s : 1.7 * s
    if (crownY > TREE.maxCrownY) continue
    // 树冠低于屋脊时不许伸进巷子（挡住巷面）
    if (top === 0 && inStrip(s)) continue
    const crowded = trees.some(
      (t) => Math.hypot(t.u - c.u, t.v - c.v) < 1.3 * (t.s + s)
    )
    if (crowded) continue
    trees.push({ u: c.u, v: c.v, s, crownY, court: Boolean(c.court) })
  }
  trees.forEach((t, k) => {
    const [x, z] = toXZ([t.u, t.v])
    // 天井树用细分二十面体（80 面），其余树用二十面体（20 面）
    addTree(b, x, 0, z, {
      r: t.s,
      trunkH: t.crownY - 0.95 * t.s, // 让树冠中心正好落在 crownY
      trunkR: Math.min(0.12 * t.s, 0.45),
      color: greens[k % greens.length],
      detail: t.court ? 1 : 0
    })
  })

  // 宽巷子两侧行道大树：沿巷均布、左右交替，落在两盏灯笼正中；树干立在巷面上，
  // 树冠中心约 9 m，伸出两侧屋檐
  const lamps = lanternUs(kuan.u0, kuan.u1)
  const laneLen = kuan.u1 - kuan.u0
  let laneTrees = 0
  for (let k = 0; k < LANE_TREES.count; k++) {
    const want = kuan.u0 + ((k + 0.5) * laneLen) / LANE_TREES.count
    // 最近的一盏灯笼再往东半个间距
    const lamp = lamps.reduce((a, u) =>
      Math.abs(u - want) < Math.abs(a - want) ? u : a
    )
    const u = lamp + LANTERN.step / 2
    if (u > Math.min(kuan.u1, GATE_U) - 8) continue
    const side = k % 2 ? 1 : -1
    const v = kuan.v + side * (kuan.width / 2 - LANE_TREES.fromWall)
    const s = LANE_TREES.rMin + (LANE_TREES.rMax - LANE_TREES.rMin) * trand()
    if (kept.some((q) => nearPoly(q, u, v, s + TREE.clear))) continue
    const [x, z] = toXZ([u, v])
    addTree(b, x, LANE_Y, z, {
      r: s,
      trunkH: LANE_TREES.crownY - LANE_Y - 0.95 * s,
      trunkR: Math.min(0.12 * s, 0.45),
      color: greens[(k + 1) % 4],
      detail: 0
    })
    laneTrees++
  }

  /* ---- 落点高度 ---- */
  // 景区中心（街区坐标系原点）所在或最近的民居屋脊高度，与牌坊高度取大
  let centerTop = 0
  let best = Infinity
  for (const q of pieces) {
    const d = pointInPolygon(0, 0, q.p) ? 0 : edgeDist(0, 0, q.p)
    if (d < best) {
      best = d
      centerTop = q.top
    }
  }

  // 外接矩形可能罩住相邻保留楼的顶点平均点（斜放或 L 形轮廓的矩形偏大），
  // 那样会把不该隐藏的楼一起隐藏：这种情况改用原楼顶点平均点处半径 1 m 的小圆
  // （buildingsInZones 正是按顶点平均点判断，小圆只命中本楼）
  const zonePolys = zones.map(({ rect, c }) =>
    keptCenters.some(([x, z]) => pointInPolygon(x, z, rect))
      ? circlePolygon(c[0], c[1], 1)
      : rect
  )

  const g = b.bake()
  const mesh = g ? new Mesh(g, landmarkMaterial()) : null
  // 调试信息（Node 验证脚本读取）：收口后的巷道、文化墙范围与树的棵数
  if (mesh) {
    mesh.userData.layout = {
      lanes: lanes.map(({ name, u0, u1, v, width }) => ({
        name,
        u0,
        u1,
        v,
        width
      })),
      wall: { ...wall, vFace: wallFace },
      trees: trees.length,
      laneTrees
    }
  }
  // 步行路径：三条巷（用收口后的两端，不会走进保留楼），换到世界坐标；宽巷子游人最多。
  // 可走带 = 巷宽（墙到墙）两侧各扣掉 walkClear(l, side)，贴边走的小人身体
  // 不会穿过檐下灯笼、文化墙灯笼和宽巷子行道树树干；两侧扣得不一样时中线相应偏移
  const walkways = lanes.map((l) => {
    const lo = l.v - l.width / 2 + walkClear(l === kuan, l === jing, -1)
    const hi = l.v + l.width / 2 - walkClear(l === kuan, l === jing, 1)
    const v = (lo + hi) / 2
    return {
      points: [toXZ([l.u0, v]), toXZ([l.u1, v])],
      y: LANE_Y,
      width: hi - lo,
      closed: false,
      density: l === kuan ? 1.5 : 1
    }
  })

  return {
    meshes: mesh ? [mesh] : [],
    zones: zonePolys,
    markerHeight: Math.max(gateTop, centerTop),
    walkways
  }
}

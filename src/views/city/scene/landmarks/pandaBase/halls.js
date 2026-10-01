/*
 * 熊猫基地 · 博物馆与园内其余建筑
 * ----------------------------------------------------------
 * 规格：设计文档 4.6（大熊猫博物馆、游客服务中心与门前小楼、熊猫科学探秘馆、办公区、竹韵餐厅 / 玫瑰苑木屋、
 * 其余矮房）、4.11「熊猫厨房」、3.5（12 栋改平屋面矮房；686460737 推定为兽舍，这里先按矮房做，
 * Task 10 的兽舍做法可以再改）。照片：off_museum_1（博物馆外景：石材墙基、白色檐板、深灰上层开白色圆窗、
 * 石材塔、白色花架）、pb_statue_gold（铜像背后米灰面砖、拱窗的办公楼）、pb_keeper_cabin（原木墙、覆藤坡顶木屋）。
 *
 * 尺度（4.1）：平面按 OSM，现代建筑高度 ×1.25。下面的高度常量都是放大后的模型值，从林下草地 LAWN_Y 起算；
 * 墙体下沿一律从城市地面 GROUND_Y 立起（不建底面，不多花三角形），埋进草地与铺装，不露缝。
 * 轮廓：blocks.js 的 outlineOf（先找包含设计文档 3.2 / 3.5 中心的 OSM 楼，再找 12 m 内最近的；
 * 取不到时按 3.2 的矩形兜底）。博物馆 relation 18696465 的 4 个外环没有 building 标签、不进 chengdu.json，
 * 轮廓从 Overpass 结果抄成常量。
 * 楼体做法（平屋面女儿墙、窗带、玻璃、外圈色带、圆窗 / 拱窗模板、共墙判断）在 blocks.js。
 * 每栋楼先用 site.solid 登记、再贴窗：贴着邻楼的墙（facingBlocked）不贴窗带与窗。
 * 全部进主体批 site.b；后续种树种竹会避开登记过的轮廓。
 */
import { PlaneGeometry, Vector3 } from "three"
import { THEME } from "../../theme.js"
import { GROUND_Y } from "../../terrain.js"
import { hashInts, pointInPolygon, polygonCenter } from "../../utils.js"
import { frame, local } from "../kit/builder.js"
import {
  clipHalfPlane,
  insetPolygon,
  minAreaRect,
  polygonArea,
  rectFrame,
  rectPolygon
} from "../kit/footprint.js"
import { housePieces } from "../kit/parts.js"
import { hipRoof } from "../kit/roofs.js"
import { box, extrudePolygon, fromTriangles } from "../kit/shapes.js"
import {
  PLATE_OFF,
  PROBE,
  archWindow,
  facadeBands,
  facades,
  facingBlocked,
  flatBlock,
  flatFace,
  orient,
  outlineOf,
  roundWindow,
  sideWalls,
  skin
} from "./blocks.js"
import { C, LAWN_Y } from "./site.js"

const L = THEME.landmark
const DEG = Math.PI / 180

/* ---------------- 大熊猫博物馆（relation 18696465，局部坐标，四块彼此共边） ---------------- */

// A 主馆 way 1476511691、B 石材塔 1476511690、C 大厅（影院）281241822、D 东翼 686460730。
// 自西向东 A → B → C → D 依次相接：A、B 共边，B、C 共边，C、D 共边
const MUSEUM = {
  A: [
    [7475.9, -8664.3],
    [7474.2, -8665.7],
    [7455.7, -8640.3],
    [7475.7, -8624.4],
    [7490.6, -8642.9],
    [7496.1, -8638.5],
    [7500.9, -8644.5],
    [7494.6, -8649.5]
  ],
  B: [
    [7491.8, -8675.5],
    [7480.2, -8667.4],
    [7475.9, -8664.3],
    [7494.6, -8649.5],
    [7503.3, -8659.9]
  ],
  C: [
    [7503.3, -8659.9],
    [7516.7, -8641.7],
    [7551.5, -8666.9],
    [7544.0, -8677.0],
    [7526.5, -8700.8],
    [7491.8, -8675.5]
  ],
  D: [
    [7544.0, -8677.0],
    [7558.8, -8687.7],
    [7545.7, -8705.4],
    [7566.8, -8720.7],
    [7563.6, -8725.1],
    [7544.1, -8710.9],
    [7540.4, -8715.9],
    [7524.1, -8704.1],
    [7526.5, -8700.8]
  ]
}
// 高度（×1.25 后，离草地）：A、D 一层石材墙基到 base，墙基顶一圈外挑 corniceOut 的白色檐板
// （照片里那道白板），其上深灰上层到 A / D；B 石材塔通高；C 石材墙到 cWall，墙顶一圈外扩 cBand.out、
// 高 cBand.h 的白色檐口带，再盖低坡浅灰金属四坡顶（屋脊高 C，出檐 cOverhang）
const MUSEUM_H = {
  base: 6.3,
  cornice: [6.0, 6.5],
  corniceOut: 0.3,
  A: 13.8,
  B: 18.8,
  C: 10,
  cWall: 8.7,
  cBand: { out: 0.25, h: 0.5 },
  cOverhang: 0.6,
  D: 12.5
}
// A 上层白色圆窗：每面按边长每 step 米一个（至多 max 个，短于 minLen 的墙与共墙不开），
// 半径 r 上下浮动 ±15%、窗心高度在 y ± jitter / 2 之间按位置播种（照片里圆窗大小、高低错落）
const ROUND_WIN = {
  r: 0.8,
  seg: 6,
  step: 4.5,
  max: 7,
  minLen: 5,
  y: 9.9,
  jitter: 2.4
}
// A 西侧白色花架：沿 A 西北面（方位 36° 的 31.4 m 长边）外 1.5～5.5 m，离西角 3～15 m；
// 4 根柱 + 2 根纵梁 + 4 根横梁（文档「4 根柱 + 6 根梁」），柱高 h（×1.25 后）
const PERGOLA = {
  at: [7458.2, -8649.6],
  bearing: 36,
  len: 12,
  dep: 4,
  h: 4.2,
  col: 0.4,
  beam: [0.35, 0.4], // 纵梁宽、高
  rafter: [0.25, 0.3], // 横梁宽、高
  rafterX: [-4.5, -1.5, 1.5, 4.5]
}

/* ---------------- 游客服务中心、办公区 ---------------- */

// name：警告用；at：OSM 面积形心；rect：兜底矩形 [长, 宽, 长边方位]；area：OSM 面积（兜底矩形按它缩小）
const VISITOR = {
  name: "游客服务中心 281241821",
  at: [7401.4, -8615.7],
  rect: [60.2, 26.6, 169],
  area: 838,
  // 沿长轴中点横切两半：朝南门广场的一半 2 层（high）、另一半 1 层（low），深灰屋面成两级台阶；
  // 切出的任一半小于 minHalf ㎡ 时不切（整栋按 high）
  high: 8.8,
  low: 5.6,
  minHalf: 30,
  parapet: 0.5,
  // 2 层那半朝广场的墙挂玻璃：底离草地 glass[0]、顶离墙顶 glass[1]，长 ≥ 4 m、两端内收 0.6 m
  glass: [0.4, 1.2]
}
// 游客中心与门前小楼朝广场一面挂玻璃：外法向方位离 GLASS_FACING ≤ 55° 的墙
// （140° 约为游客中心指向南门广场中部的方位）
const GLASS_FACING = 140

const OFFICE = {
  name: "办公区 306335312",
  at: [7343.3, -8713.9],
  rect: [63.9, 28.5, 140],
  area: 798,
  h: 13, // 3 层，层高 h / 3
  // 二、三层拱窗：宽 w、直段高 hs（上接半径 w / 2 的拱）、窗底离楼层地面 sill、间距约 step、
  // 只开在长 ≥ minLen 的墙上
  arch: { w: 1.5, hs: 1.5, sill: 0.9, step: 3.4, minLen: 5 }
}

/* ---------------- 表驱动的平屋面楼（门前小楼、探秘馆、熊猫厨房、矮房） ---------------- */

/*
 * 字段：name / at / rect / area 同上（取轮廓）；h 高（×1.25 后，离草地）；wall / roof / coping 墙、屋面、
 * 压顶色；parapet / inset 女儿墙高、厚（缺省 0.6 / 0.45，见 blocks.js flatBlock）；
 * bands：贴墙色带 [{ y0, y1（离草地）, minLen, end, color?, facing?, spread?, best? }]（见 facadeBands）；
 * trim：外圈色带 { y0, y1（离草地）, color }
 */
const KIOSK = {
  name: "门前小楼 686460728",
  at: [7421.4, -8582.5],
  rect: [11.4, 8.9, 177],
  area: 101,
  h: 5,
  wall: L.plaster,
  roof: C.flatRoof,
  parapet: 0.4,
  inset: 0.35,
  // 只在最正对广场的一面挂玻璃
  bands: [
    {
      y0: 0.4,
      y1: 3.9,
      color: L.glass,
      minLen: 4,
      end: 0.6,
      facing: GLASS_FACING,
      best: true
    }
  ]
}
const SCIENCE = {
  name: "熊猫科学探秘馆 281241820",
  at: [7276.0, -8739.0],
  rect: [62.1, 16.9, 87],
  area: 998,
  h: 7.5,
  wall: L.plaster,
  roof: C.flatRoof,
  parapet: 0.5,
  bands: [{ y0: 1.4, y1: 3.8, minLen: 10, end: 1.5 }],
  trim: { y0: 6.2, y1: 7.2, color: C.hallGreen } // 檐口绿色带（推定）
}
const KITCHEN = {
  name: "熊猫厨房 306455470",
  at: [6930.2, -8918.4],
  rect: [50.4, 45.6, 151],
  area: 1254,
  h: 6.3,
  wall: C.wallGrey,
  roof: C.flatRoof, // 灰色平屋面，比墙暗一档，女儿墙勾出 L 形
  bands: [{ y0: 1.6, y1: 3.2, minLen: 8, end: 1.2 }]
}

// 3.5 节改平屋面矮房：[way, 中心 x, z, OSM 面积, 兜底矩形长, 宽, 方位（现数据轮廓的最小外接矩形）, 墙色, 高]。
// 墙色逐行写明（白墙 / 浅灰墙交替），删改某一行不会让其余各栋换色；
// 高缺省按面积分档（lowHouseHeight），686460740 按文档 3.2「约 4 m」（×1.25）写明 5 m
const W = L.plaster
const G = C.wallGrey
const LOW_HOUSES = [
  [686460729, 7474.3, -8730.3, 206, 20.5, 10.8, 164, W],
  [686460726, 7239.8, -8681.3, 245, 33.6, 7.6, 81, G],
  [686460727, 7279.3, -8685.0, 213, 20.3, 12.1, 91, W],
  [306335313, 7214.2, -8745.6, 411, 27.8, 18.0, 86, G],
  [306335314, 7187.0, -8746.2, 287, 26.3, 12.8, 153, W],
  [686460725, 7008.8, -8839.0, 200, 18.1, 16.8, 29, G],
  [686460737, 7030.9, -9185.7, 583, 32.1, 20.9, 77, W],
  [686460740, 7158.6, -9196.8, 235, 17.2, 14.8, 65, G, 5],
  [1226059870, 6661.0, -8808.0, 865, 29.7, 29.3, 153, W],
  [1222939137, 6698.6, -9414.8, 294, 44.2, 9.3, 89, G],
  [1222939135, 6699.9, -9424.3, 505, 46.4, 17.4, 87, W],
  [1222939136, 6683.4, -9427.8, 107, 28.9, 6.0, 57, G]
]
// 矮房共用：女儿墙、窗带（7 m 以上的两层楼再加一条 upper）
const LOW_HOUSE = {
  roof: C.flatRoof,
  parapet: 0.5,
  inset: 0.4,
  band: { y0: 1.5, y1: 2.6, minLen: 6, end: 1 },
  upper: { y0: 4.6, y1: 5.7, minLen: 6, end: 1 },
  twoStorey: 7
}

/** 矮房高度（×1.25 后的模型值，5～8 m）：按面积分三档 */
function lowHouseHeight(area) {
  if (area < 230) return 5
  if (area < 450) return 6.3
  return 7.5
}

/* ---------------- 竹韵餐厅、玫瑰苑（覆藤木屋） ---------------- */

const CABINS = [
  {
    name: "竹韵餐厅 686460731",
    at: [7470.0, -8793.9],
    rect: [25.7, 15.0, 124],
    area: 318
  },
  {
    name: "玫瑰苑 686460732",
    at: [7503.4, -8832.3],
    rect: [18.2, 17.0, 143],
    area: 218
  }
]
// 木屋（×1.25 后，离草地）：檐口 eave、屋脊 ridge、四面出檐 overhang；
// 进深 < minDepth 的轮廓块做原木平顶附属间（高 annex、深灰顶）；
// 轮廓充满度 < fillMin 时 housePieces 退回整个外接矩形（同 kit/houses.js 的阈值），
// 这时长宽按 √(OSM 面积 / 矩形面积) 缩小，木屋不比 OSM 楼大一圈
const CABIN = {
  eave: 5,
  ridge: 8,
  overhang: 0.6,
  minDepth: 6,
  annex: 3.8,
  fillMin: 0.85,
  // 藤蔓：屋面坡上沿檐口一条（水平进深 along）、沿两端博风各一条（宽 rake），略抬离屋面 lift；
  // 檐下每 step 米垂一个长 drop[0]～drop[1] 的三角（按位置播种）；垂在附属间上方的藤，
  // 尖端至少高出附属间屋面 clear
  vine: {
    lift: 0.05,
    along: 1.4,
    rake: 0.7,
    step: 2.5,
    drop: [0.6, 1.4],
    clear: 0.15
  },
  // 长墙窗：每 step 米一扇，宽 w、高 h、窗心离草地 y；两端山墙正中各一扇门（宽 w、高 h）
  window: { w: 1.6, h: 1.8, y: 2.1, step: 6 },
  door: { w: 2, h: 2.6 }
}

/* ---------------- 大熊猫博物馆 ---------------- */

/** A、D：石材墙基 + 白色檐板 + 深灰上层（女儿墙压顶同色）+ 浅灰屋面 */
function addMuseumWing(b, poly, topH) {
  const H = MUSEUM_H
  b.add(sideWalls(poly, GROUND_Y, LAWN_Y + H.base), C.museumStone)
  // 白色檐板：轮廓外扩 corniceOut 的实心板，顶面盖住墙基顶
  b.add(
    extrudePolygon(
      insetPolygon(orient(poly), -H.corniceOut),
      [],
      LAWN_Y + H.cornice[0],
      LAWN_Y + H.cornice[1]
    ),
    C.gateWhite
  )
  flatBlock(b, poly, {
    y0: LAWN_Y + H.cornice[1],
    top: LAWN_Y + topH,
    wall: C.museumUpper,
    roof: C.hallRoof
  })
}

/** A 上层一圈白色圆窗：共墙（facingBlocked）与短墙不开 */
function addRoundWindows(b, poly, blockers) {
  const rw = ROUND_WIN
  const tmpl = roundWindow(rw.seg)
  for (const f of facades(poly)) {
    if (f.len < rw.minLen || facingBlocked(f, blockers)) continue
    const n = Math.min(rw.max, Math.max(1, Math.round(f.len / rw.step)))
    const step = f.len / n
    for (let i = 0; i < n; i++) {
      // 按窗心世界坐标播种，与边的遍历顺序无关
      const s = (i + 0.5) * step
      const wx = f.a[0] + (f.b[0] - f.a[0]) * (s / f.len)
      const wz = f.a[1] + (f.b[1] - f.a[1]) * (s / f.len)
      const h = hashInts(17, Math.round(wx * 10), Math.round(wz * 10))
      const r1 = (h & 0xffff) / 0x10000
      const r2 = (h >>> 16) / 0x10000
      const r = rw.r * (0.85 + 0.3 * r1)
      const y = LAWN_Y + rw.y + (r2 - 0.5) * rw.jitter
      b.add(tmpl, C.gateWhite, local(f.m, s, y, PLATE_OFF, 0, r, r, 1))
    }
  }
}

/** A 西侧白色花架：4 根柱 + 2 根纵梁 + 4 根横梁；返回占地矩形（登记实体用） */
function addPergola(b) {
  const pg = PERGOLA
  const [x, z] = pg.at
  // 局部 X 沿花架长向（方位 bearing）、Z 横向，y = 0 在草地顶
  const F = frame(x, LAWN_Y, z, pg.bearing - 90)
  const cx = pg.len / 2 - pg.col
  const cz = pg.dep / 2 - pg.col
  const sink = LAWN_Y - GROUND_Y // 柱脚埋到城市地面
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.add(
        box(pg.col, pg.h + sink, pg.col),
        C.gateWhite,
        local(F, sx * cx, -sink, sz * cz)
      )
    }
  }
  const [bw, bh] = pg.beam
  for (const sz of [-1, 1]) {
    b.add(
      box(pg.len + 0.6, bh, bw, { bottom: true }),
      C.gateWhite,
      local(F, 0, pg.h, sz * cz)
    )
  }
  const [rw, rh] = pg.rafter
  for (const rx of pg.rafterX) {
    b.add(
      box(rw, rh, pg.dep + 0.6, { bottom: true }),
      C.gateWhite,
      local(F, rx, pg.h + bh, 0)
    )
  }
  return rectPolygon(x, z, pg.len, pg.dep, pg.bearing)
}

/**
 * 大熊猫博物馆 4 块：A 主馆（墙基 + 檐板 + 深灰上层圆窗）、B 石材塔（白色压顶）、
 * C 大厅（石材墙 + 白色檐口带 + 低坡浅灰金属四坡顶）、D 东翼（同 A，无圆窗），A 西侧白色花架
 */
function buildMuseum(site) {
  const b = site.b
  const H = MUSEUM_H
  const { A, B, C: hall, D } = MUSEUM
  for (const p of [A, B, hall, D]) site.solid(p)

  addMuseumWing(b, A, H.A)
  addRoundWindows(b, A, site.solids)
  addMuseumWing(b, D, H.D)

  // B 石材塔：通高石材，白色压顶（照片里塔顶一圈白框），浅灰屋面
  flatBlock(b, B, {
    top: LAWN_Y + H.B,
    wall: C.museumStone,
    roof: C.hallRoof,
    coping: C.gateWhite,
    parapet: 0.8,
    inset: 0.5
  })

  // C 大厅：石材墙到 cWall，顶上一圈白色檐口带（外扩的实心板，顶面封住墙顶），
  // 再盖低坡四坡顶：最小外接矩形（C 的充满度 0.99）、坡面各 1 段（约 14 个三角形）
  const wallTop = LAWN_Y + H.cWall
  b.add(sideWalls(hall, GROUND_Y, wallTop), C.museumStone)
  b.add(
    extrudePolygon(
      insetPolygon(orient(hall), -H.cBand.out),
      [],
      wallTop - H.cBand.h,
      wallTop
    ),
    C.gateWhite
  )
  const r = minAreaRect(hall)
  b.add(
    hipRoof(r.w, r.d, H.C - H.cWall, {
      overhang: H.cOverhang,
      curl: 0,
      ridge: 0.5,
      segS: 1,
      segT: 1,
      pow: 1,
      ridges: false,
      thick: 0.15
    }),
    C.hallRoof,
    rectFrame(r, wallTop)
  )

  site.solid(addPergola(b))
}

/* ---------------- 游客服务中心、办公区 ---------------- */

/**
 * 沿最小外接矩形长轴的中点横切成两半：[离 toward 近的一半, 另一半]；
 * 任一半小于 minArea ㎡（切出碎片）时返回 null
 */
function splitAcross(poly, toward, minArea) {
  const r = minAreaRect(poly)
  const n = [Math.sin(r.bearing * DEG), -Math.cos(r.bearing * DEG)]
  const o = [r.cx, r.cz]
  const a = clipHalfPlane(poly, o, n)
  const c = clipHalfPlane(poly, o, [-n[0], -n[1]])
  if (a.length < 3 || c.length < 3) return null
  if (polygonArea(a) < minArea || polygonArea(c) < minArea) return null
  const dist = (p) => {
    const [x, z] = polygonCenter(p)
    return Math.hypot(x - toward[0], z - toward[1])
  }
  return dist(a) <= dist(c) ? [a, c] : [c, a]
}

/**
 * 游客服务中心：沿长轴横切两半，朝南门广场的一半 2 层、另一半 1 层，白墙、深灰屋面（阶梯两级）；
 * 2 层那半朝广场的墙挂玻璃
 */
function buildVisitorCentre(site) {
  const b = site.b
  const v = VISITOR
  const { spot } = site.ctx
  const poly = outlineOf(site, v)
  site.solid(poly)
  const halves = splitAcross(poly, [spot.x, spot.z], v.minHalf)
  const parts = halves
    ? [
        [halves[0], v.high],
        [halves[1], v.low]
      ]
    : [[poly, v.high]]
  for (const [p, h] of parts) {
    flatBlock(b, p, {
      top: LAWN_Y + h,
      wall: L.plaster,
      roof: C.museumUpper,
      parapet: v.parapet
    })
  }
  const [front, frontH] = parts[0]
  facadeBands(b, front, {
    y0: LAWN_Y + v.glass[0],
    y1: LAWN_Y + frontH - v.glass[1],
    color: L.glass,
    minLen: 4,
    end: 0.6,
    facing: GLASS_FACING,
    blockers: site.solids
  })
}

/** 办公区：按 OSM 轮廓挤出 13 m，米灰面砖，平屋面女儿墙；二、三层每面一排深色拱窗 */
function buildOffice(site) {
  const b = site.b
  const ar = OFFICE.arch
  const poly = outlineOf(site, OFFICE)
  site.solid(poly)
  flatBlock(b, poly, {
    top: LAWN_Y + OFFICE.h,
    wall: C.officeTile,
    roof: C.flatRoof
  })
  const floorH = OFFICE.h / 3
  const tmpl = archWindow(ar.w, ar.hs)
  for (const f of facades(poly)) {
    if (f.len < ar.minLen || facingBlocked(f, site.solids)) continue
    const n = Math.max(1, Math.floor(f.len / ar.step))
    const step = f.len / n
    for (const floor of [1, 2]) {
      const y = LAWN_Y + floor * floorH + ar.sill
      for (let i = 0; i < n; i++) {
        b.add(tmpl, C.windowBand, local(f.m, (i + 0.5) * step, y, PLATE_OFF))
      }
    }
  }
}

/* ---------------- 表驱动的平屋面楼 ---------------- */

/**
 * 按 spec 建一栋平屋面楼（轮廓 poly 须已登记 site.solid，共墙判断才认得出邻楼）：
 * 女儿墙平屋面 + 外圈色带 trim + 贴墙色带 bands（贴着邻楼的墙不贴）
 */
function buildFlatHall(site, spec, poly) {
  const b = site.b
  flatBlock(b, poly, {
    top: LAWN_Y + spec.h,
    wall: spec.wall,
    roof: spec.roof,
    coping: spec.coping,
    parapet: spec.parapet,
    inset: spec.inset
  })
  if (spec.trim) {
    const t = spec.trim
    b.add(skin(poly, LAWN_Y + t.y0, LAWN_Y + t.y1), t.color)
  }
  for (const band of spec.bands ?? []) {
    facadeBands(b, poly, {
      ...band,
      y0: LAWN_Y + band.y0,
      y1: LAWN_Y + band.y1,
      blockers: site.solids
    })
  }
}

/** 取轮廓、登记、建楼（门前小楼、探秘馆、熊猫厨房） */
function buildSingleHall(site, spec) {
  const poly = outlineOf(site, spec)
  site.solid(poly)
  buildFlatHall(site, spec, poly)
}

/**
 * 12 栋改平屋面矮房（3.5 节）：先取齐全部轮廓并登记（1222939137 / 135 / 136 三栋共墙，
 * 都登记后共墙判断才完整），再逐栋建：高度按面积 5 / 6.3 / 7.5 m（或表中写明），
 * 长 ≥ 6 m 且不贴邻楼的墙面一条深色窗带（两层楼两条）
 */
function buildLowHouses(site) {
  const lh = LOW_HOUSE
  const list = LOW_HOUSES.map(([id, x, z, area, w, d, bearing, wall, h]) => {
    const poly = outlineOf(site, {
      name: `矮房 ${id}`,
      at: [x, z],
      rect: [w, d, bearing],
      area
    })
    site.solid(poly)
    return { poly, wall, h: h ?? lowHouseHeight(polygonArea(poly)) }
  })
  for (const { poly, wall, h } of list) {
    buildFlatHall(
      site,
      {
        h,
        wall,
        roof: lh.roof,
        parapet: lh.parapet,
        inset: lh.inset,
        bands: h > lh.twoStorey ? [lh.band, lh.upper] : [lh.band]
      },
      poly
    )
  }
}

/* ---------------- 竹韵餐厅、玫瑰苑（覆藤木屋） ---------------- */

/** frame 局部 (x, 0, z) → 世界 [x, z] */
function toWorld(F, x, z) {
  const p = new Vector3(x, 0, z).applyMatrix4(F)
  return [p.x, p.z]
}

/**
 * 悬山顶木屋：墙体取 rect 的矩形（原木墙），屋脊沿长边，屋面在墙线处正好等于檐口高；
 * 两端山墙三角用墙色、正中各一扇门；屋面四周一圈藤蔓（屋面边缘的绿色条 + 檐下垂挂的锯齿）；
 * 长墙面开深色窗。blockers 里的实体（只会是同一木屋的附属间）上方：窗不开、垂藤收短到附属间屋面以上
 */
function addCabin(b, rect, blockers) {
  const cb = CABIN
  const vn = cb.vine
  const { w, d } = rect
  const rise = cb.ridge - cb.eave
  const ov = cb.overhang
  const ex = w / 2 + ov
  const ez = d / 2 + ov
  const yE = (-ov * rise) / (d / 2) // 檐口外沿高度（相对墙顶）
  // 局部 X 沿屋脊（长边）、+Z 为一侧长墙外侧，y = 0 为墙顶（檐口高）
  const F = frame(rect.cx, LAWN_Y + cb.eave, rect.cz, rect.bearing - 90)
  const blocked = (x, z) => {
    const [wx, wz] = toWorld(F, x, z)
    return blockers.some((p) => pointInPolygon(wx, wz, p))
  }
  const walls = rectPolygon(rect.cx, rect.cz, w, d, rect.bearing)
  b.add(sideWalls(walls, GROUND_Y, LAWN_Y + cb.eave), C.cabinLog)

  const pos = []
  const quad = (p, q, r, s) => pos.push(...p, ...q, ...r, ...p, ...r, ...s)
  // 两坡屋面
  quad([-ex, yE, ez], [ex, yE, ez], [ex, rise, 0], [-ex, rise, 0])
  quad([ex, yE, -ez], [-ex, yE, -ez], [-ex, rise, 0], [ex, rise, 0])
  b.add(fromTriangles(pos), L.roof, F)

  // 山墙三角
  const gab = []
  for (const sx of [-1, 1]) {
    const x = (sx * w) / 2
    gab.push(x, 0, d / 2, x, 0, -d / 2, x, rise, 0)
  }
  b.add(fromTriangles(gab), C.cabinLog, F)

  // 藤蔓
  const vine = []
  const slope = rise / (d / 2)
  // 垂在附属间上方的藤：尖端最低到附属间屋面以上 clear（相对墙顶的高度）
  const lowest = cb.annex + vn.clear - cb.eave
  for (const sz of [-1, 1]) {
    const z0 = sz * ez
    const z1 = sz * (ez - vn.along)
    const y0 = yE + vn.lift
    const y1 = yE + vn.along * slope + vn.lift
    vine.push(-ex, y0, z0, ex, y0, z0, ex, y1, z1)
    vine.push(-ex, y0, z0, ex, y1, z1, -ex, y1, z1)
    // 两端博风：自檐口到屋脊、宽 rake 的条
    for (const sx of [-1, 1]) {
      const xa = sx * ex
      const xb = sx * (ex - vn.rake)
      vine.push(xa, y0, z0, xb, y0, z0, xb, rise + vn.lift, 0)
      vine.push(xa, y0, z0, xb, rise + vn.lift, 0, xa, rise + vn.lift, 0)
    }
    // 檐下垂藤：锯齿三角，长短按位置播种
    const n = Math.max(2, Math.round((2 * ex) / vn.step))
    const step = (2 * ex) / n
    for (let i = 0; i < n; i++) {
      const xa = -ex + i * step
      const h = hashInts(29, Math.round((rect.cx + xa) * 10), sz)
      let drop =
        vn.drop[0] + (vn.drop[1] - vn.drop[0]) * ((h & 0xffff) / 0x10000)
      if (blocked(xa + step / 2, z0)) drop = Math.min(drop, yE - lowest)
      vine.push(xa, yE, z0, xa + step, yE, z0, xa + step / 2, yE - drop, z0)
    }
  }
  b.add(fromTriangles(vine), C.hedge, F)

  // 长墙窗（每 window.step 米一扇；窗外 PROBE 米处是附属间的不开）与山墙门
  const wn = cb.window
  const n = Math.max(1, Math.floor(w / wn.step))
  for (const sz of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + ((i + 0.5) * w) / n
      if (blocked(x, sz * (d / 2 + PROBE))) continue
      b.add(
        new PlaneGeometry(wn.w, wn.h),
        C.windowBand,
        local(
          F,
          x,
          wn.y - cb.eave,
          sz * (d / 2 + PLATE_OFF),
          sz > 0 ? 0 : Math.PI
        )
      )
    }
    // 山墙正中的门：沿屋脊方向看过来（到站机位看竹韵餐厅）不是一面光墙
    b.add(
      new PlaneGeometry(cb.door.w, cb.door.h),
      C.windowBand,
      local(
        F,
        sz * (w / 2 + PLATE_OFF),
        cb.door.h / 2 - cb.eave,
        0,
        (sz * Math.PI) / 2
      )
    )
  }
}

/**
 * 竹韵餐厅 / 玫瑰苑：轮廓按 housePieces 切成近矩形的块，进深 ≥ minDepth 的块盖悬山木屋，
 * 更窄的附属间做原木平顶小屋（深灰顶）。先把各块都登记成实体，木屋才认得出旁边的附属间
 */
function buildCabins(site) {
  const b = site.b
  const cb = CABIN
  const cabins = []
  const annexes = []
  for (const spec of CABINS) {
    const poly = outlineOf(site, spec)
    const pieces = housePieces(poly)
    for (const piece of pieces) {
      if (piece.rect.d < cb.minDepth) {
        annexes.push(piece.points)
        continue
      }
      let rect = piece.rect
      // housePieces 退回整个外接矩形（只有一块且轮廓充满度不够）：长宽等比缩到 OSM 面积
      const fill = polygonArea(poly) / (rect.w * rect.d)
      if (pieces.length === 1 && fill < cb.fillMin) {
        const k = Math.sqrt(fill)
        rect = { ...rect, w: rect.w * k, d: rect.d * k }
      }
      cabins.push(rect)
    }
  }
  for (const rect of cabins) {
    site.solid(rectPolygon(rect.cx, rect.cz, rect.w, rect.d, rect.bearing))
  }
  for (const p of annexes) site.solid(p)

  for (const rect of cabins) addCabin(b, rect, annexes)
  for (const p of annexes) {
    const top = LAWN_Y + cb.annex
    b.add(sideWalls(p, GROUND_Y, top), C.cabinLog)
    b.add(flatFace(p, [], top), L.roof)
  }
}

/* ---------------- 入口 ---------------- */

/**
 * 博物馆、游客服务中心与门前小楼、办公区、熊猫科学探秘馆、两座木屋餐厅、熊猫厨房、12 栋矮房。
 * 在 buildGate 之后调用（南大门已先取走门体与岗亭的 OSM 轮廓）。
 */
export function buildHalls(site) {
  buildMuseum(site)
  buildVisitorCentre(site)
  buildSingleHall(site, KIOSK)
  buildOffice(site)
  buildSingleHall(site, SCIENCE)
  buildCabins(site)
  buildSingleHall(site, KITCHEN)
  buildLowHouses(site)
}

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
 * 轮廓：优先 site.footprintNear(设计文档 3.2 / 3.5 的中心)；取不到时（数据重拉后楼没了或挪了）按 3.2 的
 * 长 × 宽 @ 方位做 rectPolygon 兜底（按 OSM 面积等比缩小，不让兜底矩形比原楼大一圈）并在开发期警告。
 * 博物馆 relation 18696465 的 4 个外环没有 building 标签、不进 chengdu.json，轮廓从 Overpass 结果抄成常量。
 * 平屋面做法见 flatBlock：侧墙 + 女儿墙压顶（环形面）+ 女儿墙内侧 + 下沉的屋面。
 * 全部进主体批 site.b（双面材质：贴墙的窗、玻璃色块只做单面片，离墙 0.06 m），每栋楼用 site.solid 登记，
 * 后续种树种竹会避开。
 */
import {
  CircleGeometry,
  Matrix4,
  Path,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3
} from "three"
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
import { housePieces } from "../kit/houses.js"
import { hipRoof } from "../kit/roofs.js"
import { box, extrudePolygon, fromTriangles } from "../kit/shapes.js"
import { C, LAWN_Y } from "./site.js"

const L = THEME.landmark
const DEG = Math.PI / 180

/** 贴墙色块（窗、玻璃、色带）离墙面的距离（米） */
const PLATE_OFF = 0.06

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
// 高度（×1.25 后，离草地）：A、D 一层石材墙基到 base，墙基顶一圈外挑 0.3 m 的白色檐板（照片里那道白板），
// 其上深灰上层到 A / D；B 石材塔通高；C 石材墙到 cWall，再盖低坡浅灰金属四坡顶（屋脊高 C）
const MUSEUM_H = {
  base: 6.3,
  cornice: [6.0, 6.5],
  corniceOut: 0.3,
  A: 13.8,
  B: 18.8,
  C: 10,
  cWall: 8.7,
  D: 12.5
}
// A 上层白色圆窗：每面按边长每 step 米一个（至多 max 个，短于 minLen 的边与共边不开），
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

/* ---------------- 其余建筑（设计文档 3.2 / 3.5） ---------------- */

// name：警告用；at：OSM 面积形心；rect：兜底矩形 [长, 宽, 长边方位]；area：OSM 面积（兜底矩形按它缩小）
const VISITOR = {
  name: "游客服务中心 281241821",
  at: [7401.4, -8615.7],
  rect: [60.2, 26.6, 169],
  area: 838
}
const KIOSK = {
  name: "门前小楼 686460728",
  at: [7421.4, -8582.5],
  rect: [11.4, 8.9, 177],
  area: 101
}
const OFFICE = {
  name: "办公区 306335312",
  at: [7343.3, -8713.9],
  rect: [63.9, 28.5, 140],
  area: 798
}
const SCIENCE = {
  name: "熊猫科学探秘馆 281241820",
  at: [7276.0, -8739.0],
  rect: [62.1, 16.9, 87],
  area: 998
}
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
const KITCHEN = {
  name: "熊猫厨房 306455470",
  at: [6930.2, -8918.4],
  rect: [50.4, 45.6, 151],
  area: 1254
}

// 高度（×1.25 后，离草地）：游客中心朝广场的一半 2 层、另一半 1 层（深灰阶梯屋面两级）；
// 门前小楼；办公区 3 层（层高 office / 3）；探秘馆；木屋餐厅檐口 / 屋脊；熊猫厨房
const HALL_H = {
  visitorHigh: 8.8,
  visitorLow: 5.6,
  kiosk: 5,
  office: 13,
  science: 7.5,
  cabinEave: 5,
  cabinRidge: 8,
  annex: 3.8, // 木屋旁窄条附属间（进深 < 6 m 的轮廓块）的平顶高
  kitchen: 6.3
}

// 游客中心朝广场一面（含门前小楼）挂玻璃：外法向方位在 GLASS_FACING ± 55° 以内、长 ≥ 4 m 的墙面。
// 140° 约为游客中心指向南门广场中部的方位
const GLASS_FACING = 140

// 办公区二、三层拱窗：宽 w、直段高 hs（上接半径 w / 2 的半圆拱）、窗底离楼层地面 sill、间距约 step
const ARCH_WIN = { w: 1.5, hs: 1.5, sill: 0.9, step: 3.4, minLen: 5 }

// 3.5 节改平屋面矮房：[way, 中心 x, z, OSM 面积, 兜底矩形长, 宽, 方位（现数据轮廓的最小外接矩形）]。
// 1222939137 / 135 / 136 三栋相邻：按表中顺序取轮廓，每栋拿到的都是离自己最近的那一栋
const LOW_HOUSES = [
  [686460729, 7474.3, -8730.3, 206, 20.5, 10.8, 164],
  [686460726, 7239.8, -8681.3, 245, 33.6, 7.6, 81],
  [686460727, 7279.3, -8685.0, 213, 20.3, 12.1, 91],
  [306335313, 7214.2, -8745.6, 411, 27.8, 18.0, 86],
  [306335314, 7187.0, -8746.2, 287, 26.3, 12.8, 153],
  [686460725, 7008.8, -8839.0, 200, 18.1, 16.8, 29],
  [686460737, 7030.9, -9185.7, 583, 32.1, 20.9, 77],
  [686460740, 7158.6, -9196.8, 235, 17.2, 14.8, 65],
  [1226059870, 6661.0, -8808.0, 865, 29.7, 29.3, 153],
  [1222939137, 6698.6, -9414.8, 294, 44.2, 9.3, 89],
  [1222939135, 6699.9, -9424.3, 505, 46.4, 17.4, 87],
  [1222939136, 6683.4, -9427.8, 107, 28.9, 6.0, 57]
]

/** 矮房高度（×1.25 后的模型值，5～8 m）：按面积分三档 */
function lowHouseHeight(area) {
  if (area < 230) return 5
  if (area < 450) return 6.3
  return 7.5
}

/* ---------------- 轮廓工具 ---------------- */

/** 带符号面积的两倍（> 0 为 x→z 逆时针，同 footprint.js 的 insetPolygon） */
function area2(poly) {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i]
    const [x1, z1] = poly[(i + 1) % poly.length]
    a += x0 * z1 - x1 * z0
  }
  return a
}

/** 统一绕向（返回新数组）：使每条边 a→b 的左手法向 (−dz, dx) 朝外 */
function orient(poly) {
  return area2(poly) > 0 ? poly.slice().reverse() : poly.slice()
}

/** 两条线段是否严格相交（端点相接、共线不算） */
function segmentsCross(p, q, r, s) {
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const d1 = cross(r, s, p)
  const d2 = cross(r, s, q)
  const d3 = cross(p, q, r)
  const d4 = cross(p, q, s)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** 多边形是否自交（任意两条不相邻的边相交） */
function selfIntersects(poly) {
  const n = poly.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue // 首尾两边相邻
      if (
        segmentsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])
      ) {
        return true
      }
    }
  }
  return false
}

/**
 * 轮廓向内收 d 米（女儿墙内皮）：insetPolygon 只适合近凸轮廓，短边、凹角处可能收出自交或越界，
 * 这里逐项自检（面积变小但不过小、顶点都在原轮廓内、不自交），不合格返回 null（调用方不做女儿墙）
 */
function safeInset(poly, d) {
  const inner = insetPolygon(poly, d)
  const a0 = polygonArea(poly)
  const a1 = polygonArea(inner)
  if (!(a1 > 0.2 * a0 && a1 < a0)) return null
  if (!inner.every(([x, z]) => pointInPolygon(x, z, poly))) return null
  if (selfIntersects(inner)) return null
  return inner
}

/**
 * 侧墙：轮廓每条边一块 y0～y1 的竖直四边形（不含顶面、底面）。
 * inward 为 true 时法线朝里（女儿墙内侧面）
 */
function sideWalls(poly, y0, y1, inward = false) {
  const p = inward ? orient(poly).reverse() : orient(poly)
  const pos = []
  for (let i = 0; i < p.length; i++) {
    const [ax, az] = p[i]
    const [bx, bz] = p[(i + 1) % p.length]
    pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz)
    pos.push(ax, y0, az, bx, y1, bz, ax, y1, az)
  }
  return fromTriangles(pos)
}

/** 水平面：轮廓（可带洞）在高度 y 的一层面，法线朝上 */
function flatFace(outer, holes, y) {
  // Shape 的 (x, y) 取 (x, −z)，绕 X 轴转 −90° 后落回 (x, 0, z)，正面朝上
  const v = ([x, z]) => new Vector2(x, -z)
  const shape = new Shape(outer.map(v))
  for (const h of holes) shape.holes.push(new Path(h.map(v)))
  const g = new ShapeGeometry(shape)
  g.rotateX(-Math.PI / 2)
  g.translate(0, y, 0)
  return g
}

/**
 * 平屋面楼：侧墙（y0 → top）+ 女儿墙压顶（轮廓挖掉内收 inset 的环形面）+ 女儿墙内侧
 * + 下沉 parapet 的屋面。内收轮廓不合格时不做女儿墙，屋面直接封在 top。
 * @param {object} o { top, wall, roof, coping = wall（压顶色）, parapet = 0.6, inset = 0.45, y0 = GROUND_Y }
 */
function flatBlock(b, poly, o) {
  const { top, wall, roof, parapet = 0.6, inset = 0.45, y0 = GROUND_Y } = o
  const coping = o.coping ?? wall
  b.add(sideWalls(poly, y0, top), wall)
  const inner = parapet > 0 ? safeInset(orient(poly), inset) : null
  if (!inner) {
    b.add(flatFace(poly, [], top), roof)
    return
  }
  b.add(flatFace(poly, [inner], top), coping)
  b.add(sideWalls(inner, top - parapet, top, true), wall)
  b.add(flatFace(inner, [], top - parapet), roof)
}

/** 贴在轮廓外 off 米的一圈色带（y0～y1，只有侧面）：檐口带、墙基顶的色线 */
function skin(poly, y0, y1, off = PLATE_OFF) {
  return sideWalls(insetPolygon(orient(poly), -off), y0, y1)
}

/**
 * 轮廓各面外墙：{ a, b, len, m, facing, n }。a、b 为边的起点、终点（[x, z]，已按外法向统一绕向）；
 * m 为墙面坐标系：原点在边起点、y = 0，局部 X 沿墙、Y 向上、+Z 朝外（贴墙色块的
 * PlaneGeometry / ShapeGeometry 正面朝外）；facing 为外法向方位角（度），n 为外法向单位向量 [x, z]
 */
function facades(poly) {
  const p = orient(poly)
  return p.map((a, i) => {
    const b = p[(i + 1) % p.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const tx = (b[0] - a[0]) / len
    const tz = (b[1] - a[1]) / len
    // 外法向 (−tz, tx)；X × Y = Z，行列式为正（ColorBuilder 不收镜像矩阵）
    const m = new Matrix4()
      .makeBasis(
        new Vector3(tx, 0, tz),
        new Vector3(0, 1, 0),
        new Vector3(-tz, 0, tx)
      )
      .setPosition(a[0], 0, a[1])
    const facing = (Math.atan2(-tz, -tx) / DEG + 360) % 360
    return { a, b, len, m, facing, n: [-tz, tx] }
  })
}

/** 两方位角之差（0～180） */
function angleDiff(a, b) {
  const d = (((a - b) % 360) + 360) % 360
  return Math.min(d, 360 - d)
}

/**
 * 长 ≥ minLen 的每面墙上贴一条横向色带（窗带、玻璃）：底 y0、顶 y1（世界高度），两端各内收 end 米
 * @param {(f) => boolean} [pick] 额外筛选（如只挑朝广场的面）
 */
function facadeBands(b, poly, y0, y1, color, minLen, end, pick) {
  for (const f of facades(poly)) {
    if (f.len < minLen || (pick && !pick(f))) continue
    b.add(
      new PlaneGeometry(f.len - 2 * end, y1 - y0),
      color,
      local(f.m, f.len / 2, (y0 + y1) / 2, PLATE_OFF)
    )
  }
}

/**
 * 取 OSM 轮廓：设计文档中心附近（12 m 内）的替换区楼；没有时按 3.2 的矩形兜底并警告
 * @param {object} spec { name, at, rect: [长, 宽, 方位], area }
 */
function outlineOf(site, spec) {
  const p = site.footprintNear(spec.at[0], spec.at[1])
  if (p) return p
  console.warn(`熊猫基地：未找到 ${spec.name} 的 OSM 轮廓，按设计文档矩形兜底`)
  const [w, d, bearing] = spec.rect
  const k = Math.min(1, Math.sqrt(spec.area / (w * d)))
  return rectPolygon(spec.at[0], spec.at[1], w * k, d * k, bearing)
}

/* ---------------- 大熊猫博物馆 ---------------- */

/** 圆窗模板（单面圆片，正面 +Z） */
const roundWindow = () => new CircleGeometry(1, ROUND_WIN.seg)

/**
 * A、D：石材墙基 + 白色檐板 + 深灰上层（女儿墙压顶同色）+ 浅灰屋面
 * @returns {number} 顶高（世界 y）
 */
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
  return LAWN_Y + topH
}

/**
 * A 上层一圈白色圆窗：与 B、C、D 共边的墙面（外侧 0.6 m 处落在别的块里）不开
 */
function addRoundWindows(b, poly, others) {
  const rw = ROUND_WIN
  const tmpl = roundWindow()
  for (const f of facades(poly)) {
    if (f.len < rw.minLen) continue
    const mx = (f.a[0] + f.b[0]) / 2 + f.n[0] * 0.6
    const mz = (f.a[1] + f.b[1]) / 2 + f.n[1] * 0.6
    if (others.some((o) => pointInPolygon(mx, mz, o))) continue
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

  addMuseumWing(b, A, H.A)
  addRoundWindows(b, A, [B, hall, D])
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

  // C 大厅：石材墙到 cWall，顶上一圈白色檐口带（外扩 0.25 m 的实心板，顶面封住墙顶），
  // 再盖低坡四坡顶：最小外接矩形（C 的充满度 0.99）、出檐 0.6、坡面各 1 段（约 14 个三角形）
  const wallTop = LAWN_Y + H.cWall
  b.add(sideWalls(hall, GROUND_Y, wallTop), C.museumStone)
  b.add(
    extrudePolygon(
      insetPolygon(orient(hall), -0.25),
      [],
      wallTop - 0.5,
      wallTop
    ),
    C.gateWhite
  )
  const r = minAreaRect(hall)
  b.add(
    hipRoof(r.w, r.d, H.C - H.cWall, {
      overhang: 0.6,
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

  for (const p of [A, B, hall, D]) site.solid(p)
  site.solid(addPergola(b))
}

/* ---------------- 游客服务中心与门前小楼 ---------------- */

/**
 * 沿最小外接矩形长轴的中点横切成两半：[离 toward 近的一半, 另一半]；切出碎片时返回 null
 */
function splitAcross(poly, toward) {
  const r = minAreaRect(poly)
  const n = [Math.sin(r.bearing * DEG), -Math.cos(r.bearing * DEG)]
  const o = [r.cx, r.cz]
  const a = clipHalfPlane(poly, o, n)
  const c = clipHalfPlane(poly, o, [-n[0], -n[1]])
  if (a.length < 3 || c.length < 3) return null
  if (polygonArea(a) < 30 || polygonArea(c) < 30) return null
  const dist = (p) => {
    const [x, z] = polygonCenter(p)
    return Math.hypot(x - toward[0], z - toward[1])
  }
  return dist(a) <= dist(c) ? [a, c] : [c, a]
}

/** 朝广场的墙面（外法向在 GLASS_FACING ± 55° 内） */
const facingPlaza = (f) => angleDiff(f.facing, GLASS_FACING) <= 55

/**
 * 游客服务中心：沿长轴横切两半，朝南门广场的一半 2 层、另一半 1 层，白墙、深灰屋面（阶梯两级）；
 * 2 层那半朝广场的墙面挂玻璃。门前小楼：白墙平顶，朝广场一面玻璃
 */
function buildVisitorCentre(site) {
  const b = site.b
  const { spot } = site.ctx
  const poly = outlineOf(site, VISITOR)
  const halves = splitAcross(poly, [spot.x, spot.z])
  const parts = halves
    ? [
        [halves[0], HALL_H.visitorHigh],
        [halves[1], HALL_H.visitorLow]
      ]
    : [[poly, HALL_H.visitorHigh]]
  for (const [p, h] of parts) {
    flatBlock(b, p, {
      top: LAWN_Y + h,
      wall: L.plaster,
      roof: C.museumUpper,
      parapet: 0.5
    })
  }
  const [front, frontH] = parts[0]
  facadeBands(
    b,
    front,
    LAWN_Y + 0.4,
    LAWN_Y + frontH - 1.2,
    L.glass,
    4,
    0.6,
    facingPlaza
  )
  site.solid(poly)

  const kiosk = outlineOf(site, KIOSK)
  flatBlock(b, kiosk, {
    top: LAWN_Y + HALL_H.kiosk,
    wall: L.plaster,
    roof: C.flatRoof,
    parapet: 0.4,
    inset: 0.35
  })
  facadeBands(
    b,
    kiosk,
    LAWN_Y + 0.4,
    LAWN_Y + HALL_H.kiosk - 1.1,
    L.glass,
    4,
    0.6,
    facingPlaza
  )
  site.solid(kiosk)
}

/* ---------------- 办公区、熊猫科学探秘馆 ---------------- */

/** 拱窗模板：宽 w、直段高 hs、顶上半径 w / 2 的拱（三段折线），底边中点在原点，正面 +Z */
function archWindow() {
  const { w, hs } = ARCH_WIN
  const r = w / 2
  const pts = [
    [-r, 0],
    [r, 0],
    [r, hs],
    [r * Math.cos(60 * DEG), hs + r * Math.sin(60 * DEG)],
    [r * Math.cos(120 * DEG), hs + r * Math.sin(120 * DEG)],
    [-r, hs]
  ]
  return new ShapeGeometry(new Shape(pts.map(([x, y]) => new Vector2(x, y))))
}

/** 办公区：按 OSM 轮廓挤出 13 m，米灰面砖，平屋面女儿墙；二、三层每面一排深色拱窗 */
function buildOffice(site) {
  const b = site.b
  const poly = outlineOf(site, OFFICE)
  const top = LAWN_Y + HALL_H.office
  flatBlock(b, poly, { top, wall: C.officeTile, roof: C.flatRoof })
  const floorH = HALL_H.office / 3
  const tmpl = archWindow()
  for (const f of facades(poly)) {
    if (f.len < ARCH_WIN.minLen) continue
    const n = Math.max(1, Math.floor(f.len / ARCH_WIN.step))
    const step = f.len / n
    for (const floor of [1, 2]) {
      const y = LAWN_Y + floor * floorH + ARCH_WIN.sill
      for (let i = 0; i < n; i++) {
        b.add(tmpl, C.windowBand, local(f.m, (i + 0.5) * step, y, PLATE_OFF))
      }
    }
  }
  site.solid(poly)
}

/** 熊猫科学探秘馆：白墙平顶 7.5 m，檐口一道绿色带（推定），长墙面一条深色窗带 */
function buildScienceHall(site) {
  const b = site.b
  const poly = outlineOf(site, SCIENCE)
  const top = LAWN_Y + HALL_H.science
  flatBlock(b, poly, {
    top,
    wall: L.plaster,
    roof: C.flatRoof,
    parapet: 0.5
  })
  b.add(skin(poly, top - 1.3, top - 0.3), C.hallGreen)
  facadeBands(b, poly, LAWN_Y + 1.4, LAWN_Y + 3.8, C.windowBand, 10, 1.5)
  site.solid(poly)
}

/* ---------------- 竹韵餐厅、玫瑰苑（覆藤木屋） ---------------- */

/**
 * 悬山顶木屋：墙体取 rect 的矩形（原木墙），屋脊沿长边，屋面在墙线处正好等于檐口高；
 * 两端山墙三角用墙色；屋面四周一圈藤蔓（屋面边缘的绿色条 + 檐下垂挂的锯齿），长墙面开深色窗
 */
function addCabin(b, rect) {
  const { w, d } = rect
  const eave = HALL_H.cabinEave
  const rise = HALL_H.cabinRidge - eave
  const ov = 0.6 // 出檐（四面）
  const ex = w / 2 + ov
  const ez = d / 2 + ov
  const yE = (-ov * rise) / (d / 2) // 檐口外沿高度（相对墙顶）
  // 局部 X 沿屋脊（长边）、+Z 为一侧长墙外侧，y = 0 为墙顶（檐口高）
  const F = frame(rect.cx, LAWN_Y + eave, rect.cz, rect.bearing - 90)
  const walls = rectPolygon(rect.cx, rect.cz, w, d, rect.bearing)
  b.add(sideWalls(walls, GROUND_Y, LAWN_Y + eave), C.cabinLog)

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

  // 藤蔓：屋面坡上沿檐口一条（宽 vine 米）、沿两端博风各一条（宽 0.7 m），略抬离屋面 0.05 m；
  // 檐口下垂挂一排长短不一的三角（每 2.5 m 一个），读成照片里垂下的藤
  const vine = []
  const lift = 0.05
  const along = 1.4 // 檐口绿条沿坡面的水平进深
  const slope = rise / (d / 2)
  for (const sz of [-1, 1]) {
    const z0 = sz * ez
    const z1 = sz * (ez - along)
    const y0 = yE + lift
    const y1 = yE + along * slope + lift
    vine.push(-ex, y0, z0, ex, y0, z0, ex, y1, z1)
    vine.push(-ex, y0, z0, ex, y1, z1, -ex, y1, z1)
    // 两端博风：自檐口到屋脊、宽 0.7 m 的条
    for (const sx of [-1, 1]) {
      const xa = sx * ex
      const xb = sx * (ex - 0.7)
      vine.push(xa, y0, z0, xb, y0, z0, xb, rise + lift, 0)
      vine.push(xa, y0, z0, xb, rise + lift, 0, xa, rise + lift, 0)
    }
    // 檐下垂藤：锯齿三角，长 0.6～1.4 m（按位置播种）
    const n = Math.max(2, Math.round((2 * ex) / 2.5))
    const step = (2 * ex) / n
    for (let i = 0; i < n; i++) {
      const xa = -ex + i * step
      const h = hashInts(29, Math.round((rect.cx + xa) * 10), sz)
      const drop = 0.6 + 0.8 * ((h & 0xffff) / 0x10000)
      vine.push(xa, yE, z0, xa + step, yE, z0, xa + step / 2, yE - drop, z0)
    }
  }
  b.add(fromTriangles(vine), C.hedge, F)

  // 两面长墙各开几扇深色窗（每 6 m 一扇），窗高 1.2～3.0 m
  const n = Math.max(1, Math.floor(w / 6))
  for (const sz of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + ((i + 0.5) * w) / n
      b.add(
        new PlaneGeometry(1.6, 1.8),
        C.windowBand,
        local(F, x, 2.1 - eave, sz * (d / 2 + PLATE_OFF), sz > 0 ? 0 : Math.PI)
      )
    }
    // 两端山墙正中各一扇深色门（宽 2、高 2.6）：沿屋脊方向看过来（到站机位看竹韵餐厅）不是一面光墙
    b.add(
      new PlaneGeometry(2, 2.6),
      C.windowBand,
      local(F, sz * (w / 2 + PLATE_OFF), 1.3 - eave, 0, (sz * Math.PI) / 2)
    )
  }
  return walls
}

/**
 * 竹韵餐厅 / 玫瑰苑：轮廓按 housePieces 切成近矩形的块，进深 ≥ 6 m 的块盖悬山木屋，
 * 更窄的附属间做原木平顶小屋（深灰顶）
 */
function buildCabins(site) {
  const b = site.b
  for (const spec of CABINS) {
    const poly = outlineOf(site, spec)
    for (const piece of housePieces(poly)) {
      if (piece.rect.d >= 6) {
        site.solid(addCabin(b, piece.rect))
      } else {
        const top = LAWN_Y + HALL_H.annex
        b.add(sideWalls(piece.points, GROUND_Y, top), C.cabinLog)
        b.add(flatFace(piece.points, [], top), L.roof)
        site.solid(piece.points)
      }
    }
  }
}

/* ---------------- 熊猫厨房与矮房 ---------------- */

/** 熊猫厨房：L 形平屋面 6.3 m，浅灰墙、灰色屋面（比墙暗一档，女儿墙勾出 L 形），长墙面一条深色窗带 */
function buildKitchen(site) {
  const b = site.b
  const poly = outlineOf(site, KITCHEN)
  const top = LAWN_Y + HALL_H.kitchen
  flatBlock(b, poly, { top, wall: C.wallGrey, roof: C.flatRoof })
  facadeBands(b, poly, LAWN_Y + 1.6, LAWN_Y + 3.2, C.windowBand, 8, 1.2)
  site.solid(poly)
}

/**
 * 12 栋改平屋面矮房（3.5 节）：按轮廓挤出，高度按面积 5 / 6.3 / 7.5 m，白墙与浅灰墙交替，
 * 平屋面女儿墙；长 ≥ 6 m 的墙面一条深色窗带（7.5 m 的两层楼两条）
 */
function buildLowHouses(site) {
  const b = site.b
  LOW_HOUSES.forEach(([id, x, z, area, w, d, bearing], i) => {
    const poly = outlineOf(site, {
      name: `矮房 ${id}`,
      at: [x, z],
      rect: [w, d, bearing],
      area
    })
    const h = lowHouseHeight(polygonArea(poly))
    flatBlock(b, poly, {
      top: LAWN_Y + h,
      wall: i % 2 ? C.wallGrey : L.plaster,
      roof: C.flatRoof,
      parapet: 0.5,
      inset: 0.4
    })
    facadeBands(b, poly, LAWN_Y + 1.5, LAWN_Y + 2.6, C.windowBand, 6, 1)
    if (h > 7) {
      facadeBands(b, poly, LAWN_Y + 4.6, LAWN_Y + 5.7, C.windowBand, 6, 1)
    }
    site.solid(poly)
  })
}

/* ---------------- 入口 ---------------- */

/**
 * 博物馆、游客服务中心与门前小楼、办公区、熊猫科学探秘馆、两座木屋餐厅、熊猫厨房、12 栋矮房。
 * 在 buildGate 之后调用（南大门已先取走门体与岗亭的 OSM 轮廓）。
 */
export function buildHalls(site) {
  buildMuseum(site)
  buildVisitorCentre(site)
  buildOffice(site)
  buildScienceHall(site)
  buildCabins(site)
  buildKitchen(site)
  buildLowHouses(site)
}

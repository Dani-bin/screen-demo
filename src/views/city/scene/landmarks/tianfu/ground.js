/*
 * 天府广场 · 地面：浅色外板、太极阴鱼与 S 线地灯带、草坪与花带
 * ----------------------------------------------------------
 * 依据：设计文档第 3 节「铺装高度」「浅色外板」「太极」「草坪与花带」；调研报告 3.2、6.1、6.6、6.9；
 * 附录 B（spec_frame.json）的 OSM 多边形（已换到设计系、已扣除 OSM 与影像的 4.5 m 偏移）；
 * 叠图 spec_overlay_esri.png，照片 c16（S 线地灯带）、c18（南侧草坪红色花饰）、c22（红底黄祥云花带）。
 * 全部在设计系 (u, v) 里写（u 东、v 南，原点在太极圆心），b.add 时统一乘 site.design。
 *
 * 分层（高度从铺装顶面 PAVE 算）：
 * - 铺装顶面 PAVE：浅色外板 + 深色阴鱼 + S 线地灯带，三者共面、互不重叠（边界顶点逐个相同，没有缝也不闪）。
 *   外板外沿是一圈与铺装同色的直边（GROUND_Y → PAVE），不再有旧模型那道 1 m 高的浅色台阶（报告 5）。
 * - 草坪 PAVE + 0.15（设计第 3 节）：直接压在外板上，外板不为草坪挖洞（顶面相差 0.15 m，
 *   城市总览距离下也不闪，见 kit/figures.js 的 PATTERN_LIFT 注释），省掉洞壁与洞口三角形。
 *   有花带的草坪：外圈 4 m 宽红色花带与中间绿草共面相接（同为 PAVE + 0.15），外沿侧墙红色。
 * - 黄色祥云块、南侧草坪红色花饰 PAVE + 0.3：比花带 / 草坪再高 0.15，同样为了远景不闪。
 *
 * 太极（报告 3.2、6.1）：大圆半径 74.7；S 线由两个半径 37.35 的半圆组成，西半圆圆心 (−37.35, 0)
 * 向南凸、东半圆圆心 (37.35, 0) 向北凸。深色阴鱼 = 南半圆 − 西小圆南半 + 东小圆北半；
 * 浅色阳鱼与外板同色，所以外板只在「阴鱼 + 地灯带」处挖一个洞，阳鱼不单独建。
 * 地灯带宽 0.45 m，沿 S 线两段半圆铺，两端在大圆的切点附近收成尖角（推导见 taijiRings）。
 *
 * 给后续任务的挖洞接口（buildGround 的 cuts 参数）：
 * - cuts 为设计系下的凸多边形数组（如 circlePolygon(48.7, −0.7, 27.5, 48)），从外板、阴鱼、地灯带
 *   三层铺装的顶面里减掉：整块落在某一层里的直接当洞三角化；跨过阴阳分界、大圆边的逐个三角形做
 *   「三角形 − 凸多边形」（见 cutTriangles）。只减顶面、不补洞壁：洞里的坑壁、深色盘、池子由调用方
 *   自己建。草坪不受 cuts 影响。
 * - Task 4 西鱼眼深色盘：cuts 加 circlePolygon(−44.9, −0.75, 27, n)，盘面由 westEye.js 在 PAVE 上
 *   自己铺（整块在浅色阳鱼与外板里，不碰地灯带）。
 * - Task 5 东鱼眼下沉坑口：cuts 加坑口圆（半径 27.5，略大一点盖住栏杆脚）。坑口跨过阴鱼、东段地灯带
 *   并伸出大圆约 1.5 m，正好由逐三角形相减处理。城市地面另由 index.js 的 groundHoles 挖洞。
 * - Task 6 北侧两池（|u| 24.5～101.5、v −76.5～−66）：水面若低于 PAVE 就把两块矩形加进 cuts；
 *   池子整块压在铺装上（水面高于 PAVE ≥ 0.15）时不必挖。北侧花带、绿篱也在 Task 6 做。
 */
import { clipHalfPlane, insetPolygon, polygonArea } from "../kit/footprint.js"
import { extrudePolygon, fromTriangles } from "../kit/shapes.js"
import { GROUND_Y } from "../../terrain.js"
import { pointInPolygon } from "../../utils.js"
import { C, PAVE, cleanRing, pushUp, sideWalls, triangulate } from "./site.js"

/* ---------------- 尺寸 ---------------- */

/** 太极大圆半径（报告 3.2：Esri 拟合残差 0.33 m） */
export const TAIJI_R = 74.7
// S 线两个小圆的半径（= 大圆半径的一半），圆心 (∓FISH_R, 0)
const FISH_R = TAIJI_R / 2
// 地灯带半宽：带宽 0.45（设计第 3 节、照片 c16）
const LAMP_HALF = 0.225
// 弧线分段步长（弧度）：大圆每段 3.75°（约 4.9 m），小圆每段 5.625°（约 3.7 m）
const BIG_STEP = (Math.PI * 2) / 96
const SMALL_STEP = (Math.PI * 2) / 64

/** 草坪顶面：比铺装高 0.15（设计第 3 节） */
export const LAWN_TOP = PAVE + 0.15
// 黄色祥云块、红色花饰的顶面与底面（底面埋进花带 / 草坪 0.05）
const DECOR_TOP = PAVE + 0.3
const DECOR_BOTTOM = LAWN_TOP - 0.05
// 草坪靠太极圆一侧的内凹弧半径（四块大草坪，以及东侧小草坪、东南细草带、东南小三角的弧边）：
// 与大圆同心，比大圆大 0.8 m，花带外沿贴着大圆、中间留一线浅色铺装（OSM 弧上各点半径 73.4～77.3，见附录 B）
const LAWN_ARC_R = 75.5
// 草坪内凹弧的分段步长（弧度，约 2.6 m 一段）
const LAWN_ARC_STEP = (Math.PI * 2) / 180
// 花带宽（报告 3.2「花带宽 3.5–4 m」、6.6）
const BAND_W = 4
// 黄色祥云块：沿花带中线每 9 m 一块，长 4 m、宽 1.6 m 的尖头六边形（照片 c22：红底上成串的黄色团花）
const CLOUD_SPACING = 9
const CLOUD_LEN = 4
const CLOUD_W = 1.6

/* ---------------- OSM 轮廓（设计系，附录 B） ---------------- */

/**
 * 广场面 w1395271422：浅色外板外轮廓（u −147.5～146、v −84～104，四角圆角）。
 * 外板外沿的直边就沿这条轮廓立起来。
 */
export const SQUARE_OUTLINE = [
  [-132.5, -82.5],
  [-125, -84],
  [-108, -84],
  [124, -84],
  [131.5, -82],
  [137, -78.5],
  [140.5, -75],
  [144.5, -69.5],
  [146, -63],
  [143, 74.5],
  [140.5, 82],
  [136.5, 88],
  [133, 92.5],
  [128, 97],
  [121.5, 101],
  [112.5, 104],
  [-112.5, 104],
  [-121.5, 103],
  [-128, 100.5],
  [-133, 96.5],
  [-139.5, 90.5],
  [-144.5, 83],
  [-147, 76],
  [-147.5, 68],
  [-147.5, -65.5],
  [-145, -72.5],
  [-140.5, -78.5]
]

/*
 * 8 块草坪（OSM，附录 B）。每块写成 { pts, arc?, band, ornaments? }：
 * - pts：不在内凹弧上的 OSM 顶点，按原顺序；
 * - arc：[起点, 终点]，两个 OSM 弧端点。轮廓走完 pts 后接一段半径 LAWN_ARC_R、与太极大圆同心的圆弧
 *   （角度取两端点的方位角），再回到 pts[0]。OSM 弧上的中间点不用，统一换成同心圆弧；
 * - band：外圈 4 m 红底黄祥云花带（叠图与照片里看得到花带的才加）；
 * - ornaments：草地上的红色祥云花饰（用户航拍「南侧草坪有红色花饰」、照片 c18），[u, v, 长, 宽, 转角°]。
 * 东南草坪 w1395271432 是一条绕着「东南构筑物」（Task 6）的细草带加南端一块矩形，
 * 这里在 (57, 57.5)–(65, 57.5) 处切成两块：南端矩形加花带与花饰，细草带只铺草（太窄，放不下 4 m 花带）。
 * 东侧小草坪、南侧两条草带在影像上没有花带，只铺草。
 */
const LAWNS = [
  {
    // 西北大草坪 w815853372：西、北两条直边，东南边是内凹弧
    pts: [
      [-57, -55.5],
      [-99.5, -54.5],
      [-98.5, -8],
      [-89, -7],
      [-83, -7.5],
      [-78.5, -9.5],
      [-75, -14]
    ],
    arc: [
      [-71.5, -19],
      [-57, -49]
    ],
    band: true
  },
  {
    // 东北大草坪 w815853373：南边在 u ≈ 87 有一道 3 m 的错台
    pts: [
      [87, -29],
      [87.5, -32],
      [99, -32.5],
      [99, -56],
      [58.5, -56],
      [56.5, -54]
    ],
    arc: [
      [55, -50.5],
      [69.5, -29]
    ],
    band: true
  },
  {
    // 东侧小草坪 w815853375（Task 6 的东入口下沉楼梯口在这块草坪里）
    pts: [
      [89.5, -24.5],
      [85.5, -14],
      [86, -11],
      [99, -10.5],
      [98.5, -8.5],
      [90.5, -8],
      [83.5, -9],
      [80, -11],
      [77, -14.5]
    ],
    arc: [
      [73.5, -20],
      [71, -25]
    ],
    band: false
  },
  {
    // 西南大草坪 w815853371：西侧 (−98～−85.5, 39～48) 凹进去一块（叠图里是一座小亭），
    // 东南角收成一个钝尖
    pts: [
      [-76, 14],
      [-79.5, 11.5],
      [-98, 11.5],
      [-98.5, 39],
      [-85.5, 40],
      [-85, 48],
      [-98, 48],
      [-98, 69],
      [-42.5, 69.5],
      [-40, 68]
    ],
    arc: [
      [-41, 64.5],
      [-70.5, 26]
    ],
    band: true,
    // 四朵红色祥云，沿南侧花带内沿一字排开（从南面看最显眼）
    ornaments: [
      [-89, 59.5, 7, 3.4, 0],
      [-78, 60.5, 7, 3.4, 0],
      [-67, 60.5, 7, 3.4, 0],
      [-57, 57.5, 6, 3, -20]
    ]
  },
  {
    // 东南草坪 w1395271432 的南端矩形
    pts: [
      [57, 57.5],
      [57, 69.5],
      [98.5, 69.5],
      [98.5, 58],
      [65, 57.5]
    ],
    band: true,
    // 中间只剩 4 m 宽的草，花饰做小一点，压在草带中线上
    ornaments: [
      [67, 63.5, 5, 2.6, 0],
      [78, 63.5, 5, 2.6, 0],
      [89, 63.5, 5, 2.6, 0]
    ]
  },
  {
    // 东南草坪 w1395271432 的细草带：沿内凹弧绕在东南构筑物（u 61～99、v 17～52，Task 6）西南两侧
    pts: [
      [65, 57.5],
      [63.5, 51.5],
      [60.5, 49.5],
      [69.5, 37],
      [82, 19],
      [99, 18.5],
      [99, 10.5],
      [92, 10],
      [86, 10],
      [81, 12],
      [77.5, 14.5]
    ],
    arc: [
      [74, 19.5],
      [58, 51]
    ],
    tail: [[57, 57.5]],
    band: false
  },
  {
    // 东南小三角草坪 w1395271431（叠图里整块是红色花坛）
    pts: [
      [39.5, 69.5],
      [51.5, 69.5]
    ],
    arc: [
      [52.5, 56.5],
      [40.5, 66]
    ],
    band: true
  },
  {
    // 南侧西草带 w1303858050
    pts: [
      [-113, 77.5],
      [-113, 89.5],
      [-24, 89],
      [-24, 77.5]
    ],
    band: false
  },
  {
    // 南侧东草带 w1303858047
    pts: [
      [25, 77.5],
      [111, 78],
      [111, 89.5],
      [105.5, 89.5],
      [39, 89],
      [25, 88.5]
    ],
    band: false
  }
]

/* ---------------- 小工具 ---------------- */

/** 圆弧上的点（含两端）：圆心 (cu, cv)、半径 rad，角度 a0 → a1（atan2(v, u) 口径，增大即俯视顺时针） */
function arcPoints(cu, cv, rad, a0, a1, step) {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / step - 1e-9))
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n
    return [cu + Math.cos(a) * rad, cv + Math.sin(a) * rad]
  })
}

/** 水平面高度函数 */
const at = (y) => () => y

/** 一组三角形写成朝上的水平面几何体 */
function flatTris(tris, y) {
  const pos = []
  for (const t of tris) pushUp(pos, t, at(y))
  return fromTriangles(pos)
}

/**
 * 三角形减去凸多边形 cut，返回剩下的若干凸多边形（三角形完全在 cut 外时原样返回）。
 * 做法：T − P = ∪ᵢ（T ∩ 第 i 条边外侧 ∩ 前 i − 1 条边内侧），每块都是凸的，
 * 用 kit 的 clipHalfPlane（半平面裁剪）逐条边切。
 */
function subtractConvex(tri, cut) {
  const xs = tri.map((p) => p[0])
  const zs = tri.map((p) => p[1])
  const cx = cut.map((p) => p[0])
  const cz = cut.map((p) => p[1])
  if (
    Math.max(...xs) <= Math.min(...cx) ||
    Math.min(...xs) >= Math.max(...cx) ||
    Math.max(...zs) <= Math.min(...cz) ||
    Math.min(...zs) >= Math.max(...cz)
  ) {
    return [tri]
  }
  // cut 的绕向：带符号面积 > 0 时内法向取左手 (−dz, dx)，否则取反（同 kit 的 insetPolygon）
  let a2 = 0
  for (let i = 0; i < cut.length; i++) {
    const [x0, z0] = cut[i]
    const [x1, z1] = cut[(i + 1) % cut.length]
    a2 += x0 * z1 - x1 * z0
  }
  const s = a2 > 0 ? 1 : -1
  const pieces = []
  let rest = tri
  for (let i = 0; i < cut.length && rest.length >= 3; i++) {
    const o = cut[i]
    const q = cut[(i + 1) % cut.length]
    const nIn = [-s * (q[1] - o[1]), s * (q[0] - o[0])]
    const out = clipHalfPlane(rest, o, [-nIn[0], -nIn[1]])
    if (out.length >= 3 && polygonArea(out) > 1e-6) pieces.push(out)
    rest = clipHalfPlane(rest, o, nIn)
  }
  return pieces
}

/**
 * cut 与一块铺装（outer 挖掉 holes）的关系：
 * - "inside"：整块落在铺装里（不碰外轮廓、不碰也不包住任何洞）→ 直接当洞交给 earcut，最省三角形；
 * - "outside"：与铺装不相交 → 跳过；
 * - "cross"：其余情况（跨过边界，或把某个洞包在里面）→ 逐个三角形相减。
 */
function cutRelation(cut, outer, holes) {
  const rings = [outer, ...holes]
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      for (let j = 0; j < cut.length; j++) {
        if (segmentsCross(a, b, cut[j], cut[(j + 1) % cut.length])) {
          return "cross"
        }
      }
    }
  }
  if (holes.some((h) => pointInPolygon(h[0][0], h[0][1], cut))) return "cross"
  const [x, z] = cut[0]
  const inPave =
    pointInPolygon(x, z, outer) && !holes.some((h) => pointInPolygon(x, z, h))
  return inPave ? "inside" : "outside"
}

/**
 * 多边形（可带洞）三角化后减去全部 cuts，返回三角形数组（凸块按扇形拆成三角形）。
 * 整块落在铺装里的 cut 直接并进洞里三角化；跨边界的才逐个三角形相减
 * （被切到的三角形会碎成很多小块。实测：48 边形西鱼眼盘整块在外板里，只多 50 个；
 * 48 边形下沉坑口跨阴鱼、地灯带与外板，多约 550 个，算进 Task 5 的预算）
 */
function cutTriangles(outer, holes, cuts) {
  const rel = cuts.map((c) => cutRelation(c, outer, holes))
  const inner = cuts.filter((_, i) => rel[i] === "inside")
  let tris = triangulate(outer, [...holes, ...inner])
  for (const cut of cuts.filter((_, i) => rel[i] === "cross")) {
    const next = []
    for (const t of tris) {
      for (const p of subtractConvex(t, cut)) {
        for (let i = 1; i + 1 < p.length; i++) next.push([p[0], p[i], p[i + 1]])
      }
    }
    tris = next
  }
  return tris
}

/** 两条线段是否严格相交（端点相接、共线不算） */
function segmentsCross(p, q, r, s) {
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  return (
    cross(r, s, p) * cross(r, s, q) < 0 && cross(p, q, r) * cross(p, q, s) < 0
  )
}

/** 多边形是否自交（任意两条不相邻的边相交） */
function selfIntersects(poly) {
  const n = poly.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      if (segmentsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n]))
        return true
    }
  }
  return false
}

/** 直线 ab 与直线 cd 的交点；近乎平行时返回 null */
function lineCross(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]]
  const s = [d[0] - c[0], d[1] - c[1]]
  const den = r[0] * s[1] - r[1] * s[0]
  if (Math.abs(den) < 1e-9) return null
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den
  return [a[0] + r[0] * t, a[1] + r[1] * t]
}

/**
 * 轮廓向内收 d 米（花带内沿、花带中线）。kit 的 insetPolygon 按斜接平移各边，
 * 遇到「两头都是凸角的短边」（草坪圆角、钝尖）会收过头、边反向，轮廓自交。
 * 这里每轮找出反向的短边，把它删掉、让前后两条边直接相交（这条边在收 d 米后本来就不存在了），
 * 再重新内收，直到没有反向边。结果仍自交、越出原轮廓或面积过小时返回 null（这块草坪太窄）。
 * @returns {Array<[number, number]>|null}
 */
function robustInset(poly, d) {
  let p = cleanRing(poly)
  while (p.length >= 3) {
    const q = insetPolygon(p, d)
    const n = p.length
    // 反向（或收成零长）的边里取原长最短的一条先删
    let bad = -1
    let badLen = Infinity
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const ex = p[j][0] - p[i][0]
      const ez = p[j][1] - p[i][1]
      const dot = ex * (q[j][0] - q[i][0]) + ez * (q[j][1] - q[i][1])
      const len = Math.hypot(ex, ez)
      if (dot <= 0 && len < badLen) {
        bad = i
        badLen = len
      }
    }
    if (bad < 0) {
      const ok =
        !selfIntersects(q) &&
        q.every(([x, z]) => pointInPolygon(x, z, poly)) &&
        polygonArea(q) > 0.05 * polygonArea(poly)
      return ok ? q : null
    }
    const i0 = (bad - 1 + n) % n
    const i2 = (bad + 1) % n
    const i3 = (bad + 2) % n
    const x = lineCross(p[i0], p[bad], p[i2], p[i3])
    if (!x) return null
    p = p.flatMap((pt, k) => (k === bad ? [x] : k === i2 ? [] : [pt]))
  }
  return null
}

/* ---------------- 太极 ---------------- */

/**
 * 太极三块铺装与外板上的洞（设计系，点不重复首点）：
 * - yin：深色阴鱼；
 * - lampW / lampE：S 线西段（西小圆南半）/ 东段（东小圆北半）的地灯带；
 * - hole：阴鱼 + 地灯带的外轮廓，即浅色外板上要挖的洞。
 * 地灯带夹在小圆半径 r ± h 之间（r = 37.35，h = 0.225）。两个小圆与大圆内切于 (∓74.7, 0)，
 * 外偏的 r + h 圆会在切点附近伸出大圆：西小圆的 r + h 圆与大圆交于大圆方位角 π − β 处，
 * cos β = (R² + r² − (r + h)²) / (2Rr)，β ≈ 4.45°，交点约 (−74.47, 5.80)；东侧点对称，约 (74.47, −5.80)。
 * 所以阴鱼的西尾止于这个交点，交点到切点之间那一小段月牙归地灯带；东尾同理。
 * 各块共用同一组弧线点（同一数组），共边上的顶点逐个相同，不会出现 T 形接缝。
 */
function taijiRings() {
  const R = TAIJI_R
  const r = FISH_R
  const h = LAMP_HALF
  const beta = Math.acos((R * R + r * r - (r + h) ** 2) / (2 * R * r))
  // 交点在西小圆（圆心 (−r, 0)）上的方位角，约 π − 0.155
  const pW = [-R * Math.cos(beta), R * Math.sin(beta)]
  const gamma = Math.atan2(pW[1], pW[0] + r)
  // 大圆：东尾小段（−β → 0）、南半（0 → π − β，阴鱼外沿）、西尾小段（π − β → π）
  const bigE = arcPoints(0, 0, R, -beta, 0, BIG_STEP)
  const bigS = arcPoints(0, 0, R, 0, Math.PI - beta, BIG_STEP)
  const bigW = arcPoints(0, 0, R, Math.PI - beta, Math.PI, BIG_STEP)
  // 西小圆南半：内沿 r − h（(−h, 0) → (−2r + h, 0)），外沿 r + h（(h, 0) → 交点 pW）
  const wIn = arcPoints(-r, 0, r - h, 0, Math.PI, SMALL_STEP)
  const wOut = arcPoints(-r, 0, r + h, 0, gamma, SMALL_STEP)
  // 东小圆北半：内沿 r − h（(h, 0) → (2r − h, 0)），外沿 r + h（(−h, 0) → 东侧交点，与 pW 中心对称）
  const eIn = arcPoints(r, 0, r - h, Math.PI, Math.PI * 2, SMALL_STEP)
  const eOut = arcPoints(r, 0, r + h, Math.PI, Math.PI + gamma, SMALL_STEP)
  // 交点处换成大圆上的同一个点（两条圆弧算出来的末点只差浮点误差）
  wOut[wOut.length - 1] = bigS[bigS.length - 1]
  eOut[eOut.length - 1] = bigE[0]
  bigW[0] = bigS[bigS.length - 1]
  const rev = (a) => a.slice().reverse()
  return {
    // 阴鱼：大圆南半 → 西小圆外偏弧回到圆心旁 → 东小圆内偏弧到东切点旁 →（沿 v = 0 回到大圆起点）
    yin: cleanRing([...bigS, ...rev(wOut), ...eIn]),
    // 西段地灯带：内偏弧 → 切点 → 大圆西尾 → 外偏弧回到圆心旁
    lampW: cleanRing([...wIn, ...rev(bigW), ...rev(wOut)]),
    // 东段地灯带（与西段中心对称）
    lampE: cleanRing([...eIn, ...rev(bigE), ...rev(eOut)]),
    // 外板上的洞：大圆东尾 + 南半 + 西尾 → 西小圆内偏弧 → 东小圆外偏弧
    hole: cleanRing([...bigE, ...bigS, ...bigW, ...rev(wIn), ...eOut])
  }
}

/* ---------------- 草坪 ---------------- */

/** 草坪轮廓：pts + 同心内凹弧（+ tail），点为设计系 [u, v] */
function lawnOutline(lawn) {
  if (!lawn.arc) return lawn.pts.slice()
  const [p0, p1] = lawn.arc
  let a0 = Math.atan2(p0[1], p0[0])
  let a1 = Math.atan2(p1[1], p1[0])
  // 走短弧（各块的弧都不到 60°）
  if (a1 - a0 > Math.PI) a1 -= Math.PI * 2
  if (a0 - a1 > Math.PI) a0 -= Math.PI * 2
  const arc = arcPoints(0, 0, LAWN_ARC_R, a0, a1, LAWN_ARC_STEP)
  return cleanRing([...lawn.pts, ...arc, ...(lawn.tail || [])])
}

/**
 * 沿闭合折线等距取祥云块的位置：返回 [{ p: [u, v], dir: [du, dv] }]。
 * 离急转角（转角 > 35°）不到「半块长 + 1 m」的位置跳过，免得块体压出花带。
 */
function bandSlots(line) {
  const n = line.length
  const segs = line.map((a, i) => {
    const b = line[(i + 1) % n]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    return { a, b, len, dir: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] }
  })
  const total = segs.reduce((s, g) => s + g.len, 0)
  // 急转角的弧长位置
  const corners = []
  let acc = 0
  segs.forEach((g, i) => {
    const prev = segs[(i - 1 + n) % n].dir
    const cos = prev[0] * g.dir[0] + prev[1] * g.dir[1]
    if (cos < Math.cos((35 * Math.PI) / 180)) corners.push(acc)
    acc += g.len
  })
  const count = Math.floor(total / CLOUD_SPACING)
  const step = total / count
  const out = []
  for (let k = 0; k < count; k++) {
    const s = (k + 0.5) * step
    const near = corners.some((c) => {
      const d = Math.abs(c - s)
      return Math.min(d, total - d) < CLOUD_LEN / 2 + 1
    })
    if (near) continue
    let rest = s
    for (const g of segs) {
      if (rest <= g.len) {
        const p = [g.a[0] + g.dir[0] * rest, g.a[1] + g.dir[1] * rest]
        out.push({ p, dir: g.dir })
        break
      }
      rest -= g.len
    }
  }
  return out
}

/** 黄色祥云块：沿 dir 方向、长 CLOUD_LEN、宽 CLOUD_W 的尖头六边形 */
function cloudBlock({ p, dir }) {
  const a = CLOUD_LEN / 2
  const w = CLOUD_W / 2
  const tip = 0.8 // 尖头长度
  const n = [-dir[1], dir[0]]
  const at2 = (s, t) => [
    p[0] + dir[0] * s + n[0] * t,
    p[1] + dir[1] * s + n[1] * t
  ]
  return [
    at2(a, 0),
    at2(a - tip, w),
    at2(-a + tip, w),
    at2(-a, 0),
    at2(-a + tip, -w),
    at2(a - tip, -w)
  ]
}

/**
 * 红色祥云花饰的轮廓（俯视）：椭圆，北侧（−v）一半的边缘按 |sin 3θ| 鼓出三道云头。
 * 极坐标半径处处为正，是星形多边形，不会自交。
 * @param {number} cu 中心 u
 * @param {number} cv 中心 v
 * @param {number} len 长（沿转角方向）
 * @param {number} wid 宽
 * @param {number} deg 转角（度，绕竖轴，俯视顺时针为正）
 */
function ornamentShape(cu, cv, len, wid, deg) {
  const n = 16
  const c = Math.cos((deg * Math.PI) / 180)
  const s = Math.sin((deg * Math.PI) / 180)
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2
    const k = Math.sin(t) < 0 ? 1 + 0.28 * Math.abs(Math.sin(3 * t)) : 1
    const x = (len / 2) * Math.cos(t) * k
    const z = (wid / 2) * Math.sin(t) * k
    return [cu + x * c - z * s, cv + x * s + z * c]
  })
}

/**
 * 一块草坪：草地（或整块红色花坛）+ 外圈花带 + 黄色祥云块 + 红色花饰
 */
function buildLawn(b, f, lawn) {
  const outer = lawnOutline(lawn)
  if (!lawn.band) {
    // 只铺草：顶面 + 侧墙（PAVE → LAWN_TOP）
    b.add(flatTris(triangulate(outer), LAWN_TOP), C.grass, f)
    b.add(sideWalls(outer, PAVE, LAWN_TOP), C.grass, f)
    return
  }
  // 花带内沿：内收 4 m 不成（草坪太小，如东南小三角）就整块做红色花坛
  const inner = robustInset(outer, BAND_W)
  if (inner) {
    b.add(flatTris(triangulate(outer, [inner]), LAWN_TOP), C.flowerRed, f)
    b.add(flatTris(triangulate(inner), LAWN_TOP), C.grass, f)
  } else {
    b.add(flatTris(triangulate(outer), LAWN_TOP), C.flowerRed, f)
  }
  b.add(sideWalls(outer, PAVE, LAWN_TOP), C.flowerRed, f)
  // 黄色祥云块：沿花带中线（内收 2 m）摆放
  const mid = robustInset(outer, BAND_W / 2)
  if (mid) {
    for (const slot of bandSlots(mid)) {
      b.add(
        extrudePolygon(cloudBlock(slot), [], DECOR_BOTTOM, DECOR_TOP),
        C.flowerYellow,
        f
      )
    }
  }
  for (const [u, v, len, wid, deg] of lawn.ornaments || []) {
    b.add(
      extrudePolygon(
        ornamentShape(u, v, len, wid, deg),
        [],
        DECOR_BOTTOM,
        DECOR_TOP
      ),
      C.flowerRed,
      f
    )
  }
}

/* ---------------- 入口 ---------------- */

/**
 * 广场地面：浅色外板（含外沿直边）、深色阴鱼、S 线地灯带、8 块草坪与花带。
 * @param {ColorBuilder} b 静态件
 * @param {object} site 场地对象（site.js 的 createSite），用 site.design
 * @param {{ cuts?: Array<Array<[number, number]>> }} [opts] cuts：从三层铺装顶面减掉的凸多边形
 *   （设计系），给西鱼眼深色盘、下沉坑口等挖口子，用法见文件头
 */
export function buildGround(b, site, { cuts = [] } = {}) {
  const f = site.design
  const t = taijiRings()
  // 铺装顶面：外板（挖掉阴鱼 + 地灯带）、阴鱼、两段地灯带，共面
  b.add(flatTris(cutTriangles(SQUARE_OUTLINE, [t.hole], cuts), PAVE), C.pave, f)
  b.add(flatTris(cutTriangles(t.yin, [], cuts), PAVE), C.yin, f)
  for (const lamp of [t.lampW, t.lampE]) {
    b.add(flatTris(cutTriangles(lamp, [], cuts), PAVE), C.lamp, f)
  }
  // 外沿直边：与铺装同色，从城市地面立到铺装顶面
  b.add(sideWalls(SQUARE_OUTLINE, GROUND_Y, PAVE), C.pave, f)

  for (const lawn of LAWNS) buildLawn(b, f, lawn)
}

/*
 * 天府广场 · 地面：浅色外板、太极阴鱼与 S 线地灯带、草坪与花带
 * ----------------------------------------------------------
 * 依据：设计文档第 3 节「铺装高度」「浅色外板」「太极」「草坪与花带」；调研报告 3.2、6.1、6.6、6.9；
 * 附录 B（spec_frame.json）的 OSM 多边形（已换到设计系、已扣除 OSM 与影像的 4.5 m 偏移）；
 * 叠图 spec_overlay_esri.png，照片 c16（S 线地灯带）、c18（红色图案在花带里）、c22（红底黄祥云花带）。
 * 全部在设计系 (u, v) 里写（u 东、v 南，原点在太极圆心），b.add 时统一乘 site.design。
 * 挖口相减、轮廓内收这类平面多边形运算在 polygon.js。
 *
 * 分层（高度从铺装顶面 PAVE 算）：
 * - 铺装顶面 PAVE：浅色外板 + 深色阴鱼 + S 线地灯带，三者共面、互不重叠（边界顶点逐个相同，没有缝也不闪）。
 *   外板外沿是一圈与铺装同色的直边（GROUND_Y → PAVE），不再有旧模型那道 1 m 高的浅色台阶（报告 5）。
 * - 草坪 PAVE + 0.15（设计第 3 节）：直接压在外板上，外板不为草坪挖洞（顶面相差 0.15 m，
 *   城市总览距离下也不闪，见 kit/figures.js 的 PATTERN_LIFT 注释），省掉洞壁与洞口三角形。
 *   有花带的草坪：外圈 4 m 宽红色花带与中间绿草共面相接（同为 PAVE + 0.15），外沿侧墙红色。
 *   黄色祥云块也平铺在这一层：红色花带三角化时把云块当洞挖掉，云块再用同一组顶点铺回去，
 *   共面共边，既不浮起也不闪。
 * - 大草坪中间是纯草：照片 c18 与 Esri 影像里红色图案都在花带里，草地上不另加花饰。
 *
 * 太极（报告 3.2、6.1）：大圆半径 74.7；S 线由两个半径 37.35 的半圆组成，西半圆圆心 (−37.35, 0)
 * 向南凸、东半圆圆心 (37.35, 0) 向北凸。深色阴鱼 = 南半圆 − 西小圆南半 + 东小圆北半；
 * 浅色阳鱼与外板同色，所以外板只在「阴鱼 + 地灯带」处挖一个洞，阳鱼不单独建。
 * 地灯带宽 0.45 m，沿 S 线两段半圆铺，两端在大圆的切点附近收成尖角（推导见 taijiRings）。
 *
 * 给后续任务的挖洞接口（buildGround 的 cuts 参数，运算见 polygon.js 的 cutTriangles）：
 * - cuts 为设计系下的凸多边形数组（如 circlePolygon(48.7, −0.7, 27.5, 48)），彼此不重叠；凹的或自交的
 *   cut 直接抛错。从外板、阴鱼、地灯带三层铺装的顶面里减掉：整块落在某一层里的直接当洞三角化；
 *   跨过阴阳分界、大圆边，或把某一层整块包在里面的，逐个三角形做「三角形 − 凸多边形」。
 *   只减顶面、不补洞壁：洞里的坑壁、深色盘、池子由调用方自己建。草坪不受 cuts 影响。
 * - Task 4 西鱼眼深色盘：cuts 加 westEye.js 的 WEST_EYE_CUT（circlePolygon(−44.9, −0.75, 27, 48)），
 *   盘面由 westEye.js 用同一组顶点在 PAVE 上铺（整块在浅色阳鱼与外板里，不碰地灯带，只多 50 个三角形）。
 * - Task 5 东鱼眼下沉坑口：cuts 加 eastEye.js 的 EAST_EYE_CUT（circlePolygon(48.7, −0.7, 27.5, 48)），
 *   坑壁、雨棚、台阶在坑口上的顶点用同一组点；坑口栏杆立在挖口外 0.25 m 的铺装上。坑口跨过阴鱼、
 *   东段地灯带并伸出大圆约 1.5 m，由逐三角形相减处理：与西鱼眼盘同时挖时实测多 720 个三角形，
 *   坑口一带有约 140 个 T 形接点（见 polygon.js）。城市地面另由 index.js 的 groundHoles 挖洞。
 * - Task 6 北侧两池（|u| 24.5～101.5、v −76.5～−66）：水面若低于 PAVE 就把两块矩形加进 cuts；
 *   池子整块压在铺装上（水面高于 PAVE ≥ 0.15）时不必挖。北侧花带、绿篱也在 Task 6 做。
 */
import { distToSegment, segmentsCross } from "../kit/footprint.js"
import { extrudePolygon, fromTriangles, sideWalls } from "../kit/shapes.js"
import { GROUND_Y } from "../../terrain.js"
import { pointInPolygon } from "../../utils.js"
import { C, PAVE, cleanRing, pushUp, triangulate } from "./site.js"
import { cutTriangles, robustInset } from "./polygon.js"

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
// 草坪靠太极圆一侧的内凹弧半径（四块大草坪，以及东侧小草坪、东南细草带、东南小三角的弧边）：
// 与大圆同心，比大圆大 0.8 m，花带外沿贴着大圆、中间留一线浅色铺装（OSM 弧上各点半径 73.2～77.6，见附录 B）
const LAWN_ARC_R = 75.5
// 草坪内凹弧的分段步长（弧度，约 2.6 m 一段）
const LAWN_ARC_STEP = (Math.PI * 2) / 180
// 花带宽（报告 3.2「花带宽 3.5–4 m」、6.6）
const BAND_W = 4
/*
 * 黄色祥云块（照片 c22：红底上成串的黄色团花，大小、疏密不一）：沿花带中线排开，大小两种交替，
 * 打破等距排列——长 5.5 × 宽 1.5 与长 3 × 宽 1.1；从这一块到下一块的中心距 10 / 7 m 交替；
 * 横向交替偏出中线 ±0.35 m。gap 是本块到下一块的中心距
 */
const CLOUDS = [
  { len: 5.5, wid: 1.5, gap: 10, off: 0.35 },
  { len: 3, wid: 1.1, gap: 7, off: -0.35 }
]
// 云块轮廓点数：两端各 3 点收成圆钝的云头；每块 16 个三角形（云块 6 + 在红色花带里挖洞多出的 10）
const CLOUD_PTS = 8
// 云块离花带内外边线的最小距离：急弯处直的云块会顶出花带，放不下的位置跳过
const CLOUD_MARGIN = 0.25

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
 * 8 块草坪（OSM，附录 B）。每块写成 { pts, arc?, tail?, band }：
 * - pts：不在内凹弧上的 OSM 顶点，按原顺序；
 * - arc：[起点, 终点]，两个 OSM 弧端点。轮廓走完 pts 后接一段半径 LAWN_ARC_R、与太极大圆同心的圆弧
 *   （角度取两端点的方位角），再回到 pts[0]。OSM 弧上的中间点不用，统一换成同心圆弧；
 * - tail：弧之后、回到 pts[0] 之前再补的点（只有东南细草带用）；
 * - band：外圈 4 m 红底黄祥云花带（叠图与照片里看得到花带的才加）。
 * 东南草坪 w1395271432 是一条绕着「东南构筑物」（Task 6）的细草带加南端一块矩形，
 * 这里在 (57, 57.5)–(65, 57.5) 处切成两块：南端矩形加花带，细草带只铺草（太窄，放不下 4 m 花带）。
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
    band: true
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
    band: true
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
 * 沿闭合折线排祥云块：从起点 5 m 处开始，大小两种交替，中心距按 CLOUDS 的 gap 交替；
 * 末块到首块（绕回起点）的中心距不足 7 m 时不再排。
 * @returns {Array<{ p: [number, number], dir: [number, number], len: number, wid: number, off: number }>}
 */
function cloudSlots(line) {
  const n = line.length
  const segs = line.map((a, i) => {
    const b = line[(i + 1) % n]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    return { a, len, dir: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] }
  })
  const total = segs.reduce((s, g) => s + g.len, 0)
  const s0 = CLOUDS[0].gap / 2
  const out = []
  for (let s = s0, k = 0; total - s + s0 >= CLOUDS[1].gap; k++) {
    const kind = CLOUDS[k % CLOUDS.length]
    let rest = s
    for (const g of segs) {
      if (rest <= g.len) {
        const p = [g.a[0] + g.dir[0] * rest, g.a[1] + g.dir[1] * rest]
        out.push({ p, dir: g.dir, ...kind })
        break
      }
      rest -= g.len
    }
    s += kind.gap
  }
  return out
}

/**
 * 一块祥云的轮廓：沿 dir 方向的超椭圆（指数 0.6，两端圆钝，不再是尖头），中心横向偏 off；
 * 一侧边缘按 |sin 3t| 鼓出云头（与草地花饰原来的写法相同），轮廓是星形多边形，不自交
 */
function cloudShape({ p, dir, len, wid, off }) {
  const nrm = [-dir[1], dir[0]]
  return Array.from({ length: CLOUD_PTS }, (_, i) => {
    const t = (i / CLOUD_PTS) * Math.PI * 2
    const c = Math.cos(t)
    const sn = Math.sin(t)
    const k = sn < 0 ? 1 + 0.2 * Math.abs(Math.sin(3 * t)) : 1
    const x = (len / 2) * Math.sign(c) * Math.abs(c) ** 0.6 * k
    const z = (wid / 2) * Math.sign(sn) * Math.abs(sn) ** 0.6 * k + off
    return [p[0] + dir[0] * x + nrm[0] * z, p[1] + dir[1] * x + nrm[1] * z]
  })
}

/** 两个闭合轮廓的边是否严格相交 */
function ringsCross(a, b) {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (
        segmentsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])
      ) {
        return true
      }
    }
  }
  return false
}

/**
 * 在花带里排祥云块，只留完整落在花带里的：顶点都在外轮廓内、内沿（草地）外，
 * 与内外边线不相交且离边线 ≥ CLOUD_MARGIN，与已排的云块不相交、不互相包含。
 * 留下的云块要当洞交给 earcut，所以这几条缺一不可（洞碰边、洞相交都会三角化出错）。
 * @param {Array<[number, number]>} mid 花带中线（外轮廓内收 2 m）
 * @param {Array<[number, number]>} outer 草坪外轮廓
 * @param {Array<[number, number]>|null} inner 花带内沿（整块是红色花坛时为 null）
 * @returns {Array<Array<[number, number]>>} 云块轮廓
 */
function placeClouds(mid, outer, inner) {
  const rings = inner ? [outer, inner] : [outer]
  const inside = ([x, z]) =>
    pointInPolygon(x, z, outer) && !(inner && pointInPolygon(x, z, inner))
  const nearEdge = ([x, z]) =>
    rings.some((r) =>
      r.some(
        (a, i) => distToSegment(x, z, a, r[(i + 1) % r.length]) < CLOUD_MARGIN
      )
    )
  const placed = []
  for (const slot of cloudSlots(mid)) {
    const c = cloudShape(slot)
    const ok =
      c.every(inside) &&
      !c.some(nearEdge) &&
      !rings.some((r) => ringsCross(c, r)) &&
      !placed.some(
        (q) =>
          ringsCross(c, q) ||
          pointInPolygon(q[0][0], q[0][1], c) ||
          pointInPolygon(c[0][0], c[0][1], q)
      )
    if (ok) placed.push(c)
  }
  return placed
}

/**
 * 一块草坪：只铺草的直接竖直挤出；有花带的为红色花带（或整块红色花坛）+ 中间草地 + 黄色祥云块，
 * 三者同在 LAWN_TOP 共面拼接，外沿一圈红色侧墙
 */
function buildLawn(b, f, lawn) {
  const outer = lawnOutline(lawn)
  if (!lawn.band) {
    // 只铺草：顶面 + 侧墙（PAVE → LAWN_TOP），kit 的挤出体不带底面
    b.add(extrudePolygon(outer, [], PAVE, LAWN_TOP), C.grass, f)
    return
  }
  // 花带内沿：内收 4 m 不成（草坪太小，如东南小三角）就整块做红色花坛
  const inner = robustInset(outer, BAND_W)
  // 黄色祥云块：沿花带中线（内收 2 m）排开
  const mid = robustInset(outer, BAND_W / 2)
  const clouds = mid ? placeClouds(mid, outer, inner) : []
  // 红色花带把草地与云块都当洞，草地、云块再各自铺回去
  const holes = inner ? [inner, ...clouds] : clouds
  b.add(flatTris(triangulate(outer, holes), LAWN_TOP), C.flowerRed, f)
  if (inner) b.add(flatTris(triangulate(inner), LAWN_TOP), C.grass, f)
  for (const c of clouds) {
    b.add(flatTris(triangulate(c), LAWN_TOP), C.flowerYellow, f)
  }
  b.add(sideWalls(outer, PAVE, LAWN_TOP), C.flowerRed, f)
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

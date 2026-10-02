/*
 * 天府广场 · 东鱼眼「黄河龙」下沉广场
 * ----------------------------------------------------------
 * 依据：设计文档第 2 节（城市地面挖洞）、第 3 节「东鱼眼」；调研报告 0（结论第 2 条）、3.2（影像量测）、
 * 4.1（照片 c00、c07、c09～c12 雕塑，c25～c27 下沉广场全貌）、4.2（新浪 2007-07-30：高 17.2 m、龙长 40 多米；
 * 景观中国 31539：浮雕带宽 2.4 m）、6.4（构件尺寸）、6.9（颜色）；影像 g_eeye、e_eeye、mosaic_google_z21_eeye
 * 与按设计系重采样的 Google z20 极坐标展开图。
 * 中心在设计系 (48.7, −0.7)（报告 3.2）。坑口半径 27.5 跨过阴鱼、东段地灯带并伸出太极大圆约 1.5 m
 * （48.7 + 27.5 = 76.2 > 74.7，与影像一致），铺装由 ground.js 按 EAST_EYE_CUT 逐三角形相减挖口。
 * 城市地面另由 index.js 返回的 groundHoles 挖洞（坑口外扩 0.5 m，见 eastEyeGroundHole）。
 *
 * 坐标：贴着坑口的构件（坑壁、栏杆、雨棚、大台阶、采光顶）直接在设计系 (u, v) 里写，坑口上的顶点
 * 一律取 EAST_EYE_CUT 的同一组点，与铺装挖口逐点重合、不留缝；雕塑在「鱼眼坐标系」里写
 * （设计系平移到坑心，同 westEye.js）。方位角 θ 从东（+u）起向南（+v）转，即俯视顺时针；
 * 坑口 48 边形的第 k 个顶点在 θ = 7.5k°。高度：坑底 PIT_FLOOR = PAVE − 6 ≈ −4.5，低于城市地面 −0.5。
 *
 * 构成（半径单位米，高度从坑底算，另注明的除外）：
 * - 坑底：半径 28.6 的浅灰石材圆面（含店面前的退进部分）。卫星图上中心圆（半径 15.6）与放射步道同色。
 * - 坑壁（半径 27.5，法线朝里）：上部 2.4 m 红褐浮雕带（相邻两段深浅交替）、0.3 m 浅色檐口线；
 *   其下是地下一层店面带，退进 1.1 m 到半径 28.6，顶上一圈浅灰吊顶，前沿一排黄色圆柱（c11、c12）。
 * - 坑口栏杆：半径 27.75，玻璃栏板 + 深绿扶手，高 1.1（离铺装），大台阶处断开。
 * - 坑口到坑底之间的环带：6 道 3 m 宽的放射步道、8 块平铺玻璃采光顶（玻璃面高 0.3，四周 1 m 高玻璃栏板 +
 *   深绿扶手，c00、c07、c26），北、南两处斜玻璃雨棚从坑口斜落到半径 18（扶梯雨棚，c25、c26；
 *   卫星图上北侧那块反光最亮）。
 * - A、B 玻璃亭：8 × 6 × 4，中心取 OSM 地铁口节点（已扣 OSM 偏移），长边沿切向，旁立蓝灰色地铁立牌。
 * - 西南大台阶：南侧雨棚西边接一段 12 级放射台阶（坑口 → 半径 18），台阶东侧是雨棚的玻璃侧墙（c26）。
 * - 中心雕塑：圆池直径 11；墨绿柱身带金色回纹 / 云纹带；下托盘直径 12（盘面 7.5）、白色中柱、
 *   上托盘直径 9（盘面 12.5）、白杆到 16.3；金龙扁带从下托盘面起盘绕上升，龙首顶 17.2（约高出铺装 11 m）。
 *
 * 与报告 6.4 不同之处（逐条有影像 / 照片依据）：
 * 1. 「5 道放射楼梯」改为 6 道平的放射步道：
 *    - 卫星图（Google z20 极坐标展开）上浅色放射带有 6 道，在 θ ≈ 16°、53°、156°、193°、229°、336°；
 *    - 这些带子外端都止于坑口内侧那圈连续的深色环（浮雕带顶与栏杆的阴影），没有一道接到地面铺装，
 *      说明它们不通到坑口；
 *    - 照片 c00、c07、c09、c25～c27 里浮雕带与店面一整圈连续，环带是地下一层平地：
 *      玻璃采光顶四周围着栏板，人在采光顶之间的平步道上走。
 *    从地面下到坑底，靠的是西南大台阶（OSM w512988921 highway=steps）与南北两处扶梯雨棚。
 * 2. 西南大台阶：OSM 的台阶线在坑口外半径 31～33 m 处，实景是坑口外一道切向下沉槽。
 *    城市地面只挖坑口圆（设计第 2 节），坑口外再开槽会让挖口、地面洞都不再是一个圆，
 *    所以把它收进坑口以内：放在南侧雨棚西边（θ 112.5°～127.5°，与 OSM 台阶同一方位），宽约 7 m、
 *    水平长 9.5 m，旁边就是雨棚的斜玻璃，读法与照片 c26 一致。
 * 3. 柱身直径：报告写 3.4。照片里柱宽与下托盘宽之比，c09 为 122 / 487 px，c00 为 125 / 497 px，
 *    c25 为 95 / 356 px（两者在同一深度），按托盘 12 m 折算为 3.0～3.2 m，取 3.1。
 * 4. 采光顶：报告写约 8 段。影像上是 8 块平铺 + 2 处斜雨棚，共 10 块玻璃，按影像做。
 *
 * 阴影：材质只画背光面进阴影贴图（index.js 的 shadowSide = BackSide），太阳在西南（theme.light），
 * 所以坑壁、栏杆的法线朝里：西南侧那半圈背对太阳、画进阴影贴图，影子落进坑里；吊顶法线朝下，
 * 店面带在阴影里。坑底低于城市地面，阴影深度范围的核实见 Task 5 报告。
 *
 * 三角形（实测）：坑底 46、坑壁店面与圆柱 544、坑口栏杆 184、南雨棚 56、北雨棚 112、西南大台阶 135、
 * 采光顶 384、A / B 玻璃亭 60、雕塑 1,588（圆池 256、方墩 40、柱身与金带 200、下托盘 288、中柱 24、
 * 上托盘 308、白杆 36、金龙 436），本体共 3,109；另 ground.js 铺装挖口多出 720，本件合计 3,829
 * （设计第 5 节上限 5,500）。
 */
import { BufferAttribute, BufferGeometry } from "three"
import { local } from "../kit/builder.js"
import { circlePolygon } from "../kit/footprint.js"
import {
  box,
  cylinder,
  fromTriangles,
  sideWalls,
  sweepBar
} from "../kit/shapes.js"
import { C, PAVE, pushUp, triangulate } from "./site.js"
import { DRAGON_HEAD_TOP, addDragon, addRevolved, ring } from "./sculpture.js"

const DEG = Math.PI / 180

/* ---------------- 坑 ---------------- */

/** 东鱼眼中心（设计系，报告 3.2） */
export const EAST_EYE = { u: 48.7, v: -0.7 }
// 坑深 6.0（报告 6.4，估计值）
const DEPTH = 6
/** 坑底高度：PAVE − 6 ≈ −4.5，比城市地面 GROUND_Y（−0.5）低 4 m */
export const PIT_FLOOR = PAVE - DEPTH
// 坑口圆周分段：48 段（7.5° 一段，弦长 3.6 m）。坑壁、栏杆、雨棚、台阶都按这组方位角分段
const SEG = 48
/** 坑口半径（报告 3.2：两套影像 27.38 / 27.82） */
export const RIM_R = 27.5
/**
 * 铺装挖口：坑口 48 边形（设计系）。index.js 把它交给 buildGround 的 cuts，
 * 坑壁、雨棚、台阶的坑口顶点都取这同一组点，挖口与坑沿逐点重合，没有缝
 */
export const EAST_EYE_CUT = circlePolygon(EAST_EYE.u, EAST_EYE.v, RIM_R, SEG)
// 城市地面洞比坑口外扩 0.5 m（洞口边缘藏在铺装下面），64 段
const HOLE_PAD = 0.5
const HOLE_SEG = 64

// 坑壁分层（离坑底）：浮雕带 2.4 m（景观中国 31539）在最上面，下面 0.3 m 浅色檐口线，再下面是店面带
const RELIEF_Y0 = DEPTH - 2.4
const FASCIA_Y0 = RELIEF_Y0 - 0.3
// 店面退进到半径 28.6（吊顶宽 1.1 m），店招带 0.6 m 高
const SHOP_R = 28.6
const SIGN_Y0 = FASCIA_Y0 - 0.6
// 店面前一排黄色圆柱：半径 0.4、8 段，立在半径 28.0（浮雕带面与店面之间），每 3 个顶点一根
const SHOP_COL = { r: 0.4, at: 28.0, every: 3, seg: 8 }

/*
 * 坑口一圈按 48 边形的段号 k（第 k 段从 θ = 7.5k° 到 7.5(k + 1)°）分区，区间为 [起, 止)：
 * - 南侧扶梯雨棚 k 12～14（θ 90°～112.5°；卫星图里南侧暗色的一块，c25 前景）；
 * - 西南大台阶 k 15～16（θ 112.5°～127.5°；OSM 台阶 θ 90°～130°）；
 * - 北侧扶梯雨棚 k 33～39（θ 247.5°～300°；卫星图里反光最亮的那块）；
 * - 其余为坑壁（浮雕带 + 店面）。雨棚、台阶从坑口直落坑底，后面那几段坑壁看不见，不建。
 * 栏杆除大台阶外一整圈。
 */
const SW_CANOPY = [12, 15]
const SW_STAIR = [15, 17]
const N_CANOPY = [33, 40]
const WALL_RUNS = [
  [17, 33],
  [40, 60]
]
const RAIL_RUN = [17, 63]
// 坑口栏杆：半径 27.75（坑口外 0.25 m，立在铺装上），玻璃栏板到 0.95、深绿扶手到 1.1（离铺装）
const RAIL = { r: 27.75, panel: 0.95, top: 1.1 }

// 斜玻璃雨棚：顶边在坑口（铺装高），斜落到半径 18、离坑底 3.6 处，前面一道竖直玻璃墙落到坑底
const CANOPY = { footR: 18, footY: 3.6, frame: 0.16 }
// 西南大台阶：12 级，每级高 0.5，从坑口落到半径 18（水平 9.5 m，坡度约 32°）
const STAIR = { n: 12, footR: 18, inset: 0.2, rail: 0.9 }

/*
 * 采光顶：每块夹在两道分隔之间，分隔为 [方位角°, 半宽]——放射步道半宽 1.5（宽 3，设计第 3 节），
 * 贴着雨棚、台阶的一侧留 1 m。采光顶内外沿在半径 16.4、25.8（卫星图：玻璃从坑底圆外侧起，
 * 外沿与坑口之间留店面前的步道）。块边是与分隔中线平行的直线，步道宽度处处 3 m
 */
const SKY = { r0: 16.4, r1: 25.8, top: 0.3, rail: 1.0, railTop: 1.1 }
const SKYLIGHTS = [
  [
    [-24, 1.5],
    [16, 1.5]
  ],
  [
    [16, 1.5],
    [53, 1.5]
  ],
  [
    [53, 1.5],
    [90, 1]
  ],
  [
    [127.5, 1],
    [156, 1.5]
  ],
  [
    [156, 1.5],
    [193, 1.5]
  ],
  [
    [193, 1.5],
    [229, 1.5]
  ],
  [
    [229, 1.5],
    [247.5, 1]
  ],
  [
    [300, 1],
    [336, 1.5]
  ]
]
// 采光顶弧边分段步长（约 7.5°）
const SKY_STEP = 7.5 * DEG

/*
 * A、B 玻璃亭（报告 2.1 地铁 A / B 口，OSM 节点 1311904397 / 1311904471，已按报告 3.1 扣除
 * OSM 与影像的偏移换到设计系）：A 在坑心东北偏北（θ 302°、半径 12.4），B 在南偏西（θ 103°、半径 14.2）。
 * 8 × 6 × 4（报告 6.4）：长边 8 沿切向、短边 6 沿半径，跨在坑底圆边上
 */
const PAVILIONS = [
  { u: 55.3, v: -11.2 },
  { u: 45.5, v: 13.1 }
]
const PAVILION = { w: 8, d: 6, h: 3.7, roof: 0.3, over: 0.2 }
// 地铁立牌：0.5 × 0.5 × 4.6，立在亭子外半边的一侧（不挡坑底步道）
const SIGN = { w: 0.5, h: 4.6, x: 4.6, z: 1.5 }

/* ---------------- 雕塑（高度从坑底算） ---------------- */

// 圆池：直径 11（报告 6.4），池壁高 0.7、厚 0.4，水面 0.45。32 段
const POOL = { r: 5.5, t: 0.4, h: 0.7, water: 0.45, seg: 32 }
// 池壁、水面相接处互相插进 5 cm（同 westEye.js）
const TUCK = 0.05
// 柱脚四个墨绿方墩（c00、c07、c09）：1.1 见方、高 0.95，立在池里半径 2.45 处
const PEDESTAL = { size: 1.1, h: 0.95, r: 2.45 }
// 柱身：直径 3.1（见文件头第 3 条），20 段，从池水面到下托盘底面里
const COLUMN = { r: 1.55, seg: 20, top: 6.55 }
// 柱身金带 [底, 顶, 颜色]：上下两道回纹带（c09、c12）、中段两道云纹带（远看读成金纹满身）
const COLUMN_BANDS = [
  [0.4, 1.1, C.sculptGold],
  [2.4, 2.9, C.goldPattern],
  [3.9, 4.4, C.goldPattern],
  [5.6, 6.3, C.sculptGold]
]
/*
 * 托盘剖面 [半径, 离坑底高度]：从盘面中心向外、沿盘沿下折、再沿底面倒锥回到柱子（同 westEye.js 的写法）。
 * 下托盘直径 12、盘面 7.5（报告 6.4）；上托盘按报告 4.3 取直径 9、盘面 12.5，盘面上一圈金色回纹
 * （c09、卫星图俯视都看得到）。底面外圈金色回纹带、近柱金色云纹带（c09、c11）
 */
const LOWER_TRAY = [
  { p: [0, 7.5], color: C.tray },
  { p: [6, 7.5], color: C.trayRim },
  { p: [6, 7.2], color: C.goldPattern },
  { p: [5.3, 7.05], color: C.tray },
  { p: [3.0, 6.65], color: C.goldPattern },
  { p: [COLUMN.r - 0.05, 6.45] }
]
const UPPER_TRAY = [
  { p: [0, 12.5], color: C.tray },
  { p: [2.6, 12.5], color: C.goldPattern },
  { p: [3.3, 12.5], color: C.tray },
  { p: [4.5, 12.5], color: C.trayRim },
  { p: [4.5, 12.2], color: C.goldPattern },
  { p: [3.9, 12.05], color: C.tray },
  { p: [0.55, 11.5] }
]
const LOWER_SEG = 32
const UPPER_SEG = 28
// 两盘之间的白色中柱：直径 1.2（c09 约 45 px，按柱身比例折算），12 段
const MID_COLUMN = { r: 0.6, y0: 7.4, y1: 11.6, seg: 12 }
// 白杆：上盘面 12.5 到 16.3（报告 6.4），直径 0.66（c09 约 25 px），12 段带顶盖
const POLE = { r: 0.33, y1: 16.3, seg: 12 }

/*
 * 金龙飘带：截面竖直，宽 1.6、厚 0.3（c25：带宽约为柱径的一半）。
 * 中线关键点 [方位角°, 半径, 中线离坑底高度]，中线 ± 0.8 是带子上下沿：
 * - 60°：龙尾落在下托盘面上（下沿 7.4，压进盘面 0.1）；
 * - 140°～300°：绕出下托盘外缘（半径 6）成一个大环，逐渐升高（c25、c27 两盘之间的大环）；
 * - 370°～490°：贴着上托盘外缘（半径 4.5）外侧升过上盘面，带子内侧离盘沿 ≥ 0.25 m；
 * - 540°～610°：在上盘面以上向内收到白杆旁（半径 1.2），末端中线 16.3，龙首顶 16.3 + 0.9 = 17.2
 *   （报告 4.2：雕塑高 17.2；末端中线由 SCULPTURE_TOP 减去 DRAGON_HEAD_TOP 得到）。
 *   全长约 48 m（报告 4.2「龙长 40 多米」）。
 * 俯视顺时针上升，与西鱼眼同向。
 */
const SCULPTURE_TOP = 17.2
const DRAGON = {
  thick: 0.3,
  half: 0.8,
  keys: [
    [60, 4.4, 8.2],
    [140, 5.8, 8.6],
    [220, 6.6, 9.3],
    [300, 6.6, 10.1],
    [370, 5.9, 10.9],
    [430, 5.3, 12.0],
    [490, 4.9, 13.2],
    [540, 3.4, 14.4],
    [580, 2.0, 15.5],
    [610, 1.2, SCULPTURE_TOP - DRAGON_HEAD_TOP]
  ],
  chord: 0.9,
  maxStep: 12 * DEG
}

/* ---------------- 步行路径 ---------------- */

/*
 * - 坑底环：半径 7.5、宽 1.8，标高 PIT_FLOOR（设计第 6 节「坑底环，半径 7～13」）。
 *   内沿 6.6 离圆池外壁 5.5 有 1.1 m；外沿 8.4 离 A 亭内侧面（半径 9.4）有 1.0 m，B 亭更远；
 *   托盘、龙带都在离坑底 6.4 m 以上，不碍头顶。
 * - 坑口外环：半径 29.6、宽 1.6，走在铺装上（设计第 6 节「半径 29～31」）。内沿 28.8 离坑口栏杆 27.75
 *   有 1.05 m；外沿 30.4 离东侧小草坪弧端（离坑心 30.8 m）还有 0.4 m，东南细草带（31.4 m）更远。
 */
const FLOOR_WALK = { r: 7.5, width: 1.8, density: 1.5, n: 32 }
const RIM_WALK = { r: 29.6, width: 1.6, density: 1.2, n: 64 }

/* ---------------- 小工具 ---------------- */

/** 坑口 48 边形第 k 个顶点的方位角（与 circlePolygon 同一算式，k 取模，坑口顶点逐位相同） */
const ang = (k) => ((((k % SEG) + SEG) % SEG) / SEG) * Math.PI * 2
/** 设计系点：坑心为圆心、半径 r、方位角 a（弧度） */
const polar = (r, a) => [
  EAST_EYE.u + Math.cos(a) * r,
  EAST_EYE.v + Math.sin(a) * r
]
/** 半径 r、第 k 个顶点：r 为坑口半径时直接取 EAST_EYE_CUT 的点 */
const vertex = (r, k) =>
  r === RIM_R ? EAST_EYE_CUT[((k % SEG) + SEG) % SEG] : polar(r, ang(k))
/** 设计系 [u, v] 加高度 → 三维点 [u, y, v]（site.design 坐标） */
const p3 = ([u, v], y) => [u, y, v]
/** 方位角 a 处指向坑心的水平单位向量（坑壁、栏杆的法线） */
const inward = (a) => [-Math.cos(a), 0, -Math.sin(a)]
/** 方位角 a 处沿 θ 增大方向的水平切向 */
const tangent = (a) => [-Math.sin(a), 0, Math.cos(a)]
const neg = ([x, y, z]) => [-x, -y, -z]
const UP = [0, 1, 0]
const DOWN = [0, -1, 0]

/**
 * 三角形集：一种颜色一份，最后转成带法线的几何体。
 * - smooth(A, B, C)：三点各带法线 [点, 法线]（坑壁这类曲面，法线沿圆周平滑）；
 * - flat(a, b, c, hint)：只给点，法线取面法线、朝 hint 一侧。
 * 两者都按法线校正绕向：双面材质靠绕向判断正反面，阴影只画背光面，绕向错了就投不出影子。
 */
class Tris {
  constructor() {
    this.pos = []
    this.nor = []
  }

  smooth(A, B, Cc) {
    const n = cross(sub(B[0], A[0]), sub(Cc[0], A[0]))
    const list = dot(n, A[1]) >= 0 ? [A, B, Cc] : [A, Cc, B]
    for (const [p, q] of list) {
      this.pos.push(...p)
      this.nor.push(...q)
    }
  }

  smoothQuad(a, b, c, d) {
    this.smooth(a, b, c)
    this.smooth(a, c, d)
  }

  flat(a, b, c, hint) {
    let n = cross(sub(b, a), sub(c, a))
    const len = Math.hypot(...n)
    if (len < 1e-12) return
    n = n.map((x) => x / len)
    if (dot(n, hint) < 0) n = neg(n)
    this.smooth([a, n], [b, n], [c, n])
  }

  flatQuad(a, b, c, d, hint) {
    this.flat(a, b, c, hint)
    this.flat(a, c, d, hint)
  }

  get count() {
    return this.pos.length / 9
  }

  geometry() {
    const g = new BufferGeometry()
    g.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(this.pos), 3)
    )
    g.setAttribute("normal", new BufferAttribute(new Float32Array(this.nor), 3))
    return g
  }
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]

/** 按颜色分组的三角形集：同色的件并成一份，最后逐色加进合批器 */
function trisByColor() {
  const map = new Map()
  return {
    of(color) {
      if (!map.has(color)) map.set(color, new Tris())
      return map.get(color)
    },
    addTo(b, matrix) {
      for (const [color, t] of map) {
        if (t.count) b.add(t.geometry(), color, matrix)
      }
    }
  }
}

/** 区间 [s, e) 里的段号 */
const range = ([s, e]) => Array.from({ length: e - s }, (_, i) => s + i)

/**
 * 坑壁一圈竖直带（平滑法线朝里）：半径 r、离坑底 y0～y1，段号 ks 里各段一块四边形
 * @param {(k: number) => string} colorOf 每段颜色
 */
function wallBand(sets, ks, r, y0, y1, colorOf) {
  for (const k of ks) {
    const a0 = ang(k)
    const a1 = ang(k + 1)
    const p0 = vertex(r, k)
    const p1 = vertex(r, k + 1)
    const n0 = inward(a0)
    const n1 = inward(a1)
    sets
      .of(colorOf(k))
      .smoothQuad(
        [p3(p0, PIT_FLOOR + y0), n0],
        [p3(p1, PIT_FLOOR + y0), n1],
        [p3(p1, PIT_FLOOR + y1), n1],
        [p3(p0, PIT_FLOOR + y1), n0]
      )
  }
}

/* ---------------- 各部分 ---------------- */

/**
 * 坑壁与店面：浮雕带、檐口线、吊顶、店面带、店面前的圆柱；每段坑壁两端（挨着雨棚、台阶处）
 * 补一块封板，挡住店面退进的那道缝
 */
function buildWall(b, site, sets) {
  for (const run of WALL_RUNS) {
    const ks = range(run)
    // 浮雕带：相邻两段深浅交替
    wallBand(sets, ks, RIM_R, RELIEF_Y0, DEPTH, (k) =>
      k % 2 ? C.reliefShade : C.relief
    )
    wallBand(sets, ks, RIM_R, FASCIA_Y0, RELIEF_Y0, () => C.fascia)
    // 店面带：店招在上、玻璃在下，相邻店铺轮换颜色
    wallBand(
      sets,
      ks,
      SHOP_R,
      SIGN_Y0,
      FASCIA_Y0,
      (k) => C.shopSign[k % C.shopSign.length]
    )
    wallBand(
      sets,
      ks,
      SHOP_R,
      0,
      SIGN_Y0,
      (k) => C.shopGlass[k % C.shopGlass.length]
    )
    // 吊顶：坑壁与店面之间的水平环带，法线朝下
    const y = PIT_FLOOR + FASCIA_Y0
    for (const k of ks) {
      sets
        .of(C.soffit)
        .flatQuad(
          p3(vertex(RIM_R, k), y),
          p3(vertex(RIM_R, k + 1), y),
          p3(vertex(SHOP_R, k + 1), y),
          p3(vertex(SHOP_R, k), y),
          DOWN
        )
    }
    // 两端封板：从坑底到吊顶，挡住店面退进的端头（法线朝坑壁外侧）
    for (const [k, out] of [
      [run[0], neg(tangent(ang(run[0])))],
      [run[1], tangent(ang(run[1]))]
    ]) {
      sets
        .of(C.soffit)
        .flatQuad(
          p3(vertex(RIM_R, k), PIT_FLOOR),
          p3(vertex(SHOP_R, k), PIT_FLOOR),
          p3(vertex(SHOP_R, k), y),
          p3(vertex(RIM_R, k), y),
          out
        )
    }
    // 黄色圆柱：段内每 3 个顶点一根（不立在段的两端）
    for (let k = run[0] + 1; k < run[1]; k++) {
      if (k % SHOP_COL.every) continue
      const [u, v] = polar(SHOP_COL.at, ang(k))
      b.add(
        cylinder(SHOP_COL.r, SHOP_COL.r, FASCIA_Y0, {
          segments: SHOP_COL.seg
        }),
        C.shopColumn,
        local(site.design, u, PIT_FLOOR, v)
      )
    }
  }
}

/** 坑口栏杆：玻璃栏板 + 深绿扶手（法线朝里：西南侧背对太阳，影子落进坑里） */
function buildRimRail(sets) {
  const ks = range(RAIL_RUN)
  const base = DEPTH
  wallBand(sets, ks, RAIL.r, base, base + RAIL.panel, () => C.railGlass)
  wallBand(sets, ks, RAIL.r, base + RAIL.panel, base + RAIL.top, () => C.rail)
}

/**
 * 斜玻璃雨棚：顶面从坑口（铺装高）斜落到半径 18；前面一道竖直玻璃墙、两侧梯形玻璃墙落到坑底；
 * 顶面沿每个顶点一根浅色竖框
 * @param {number[]} span 段号区间 [起, 止)
 */
function buildCanopy(b, site, sets, span) {
  const glass = sets.of(C.skyGlass)
  const footY = PIT_FLOOR + CANOPY.footY
  const top = (k) => p3(vertex(RIM_R, k), PAVE)
  const foot = (k, y) => p3(vertex(CANOPY.footR, k), y)
  for (const k of range(span)) {
    const mid = ang(k + 0.5)
    // 顶面法线朝上
    glass.flatQuad(top(k), top(k + 1), foot(k + 1, footY), foot(k, footY), UP)
    // 前墙法线朝坑心
    sets
      .of(C.railGlass)
      .flatQuad(
        foot(k, PIT_FLOOR),
        foot(k + 1, PIT_FLOOR),
        foot(k + 1, footY),
        foot(k, footY),
        inward(mid)
      )
  }
  // 侧墙：法线朝雨棚外
  for (const [k, out] of [
    [span[0], neg(tangent(ang(span[0])))],
    [span[1], tangent(ang(span[1]))]
  ]) {
    sets
      .of(C.railGlass)
      .flatQuad(
        foot(k, PIT_FLOOR),
        p3(vertex(RIM_R, k), PIT_FLOOR),
        top(k),
        foot(k, footY),
        out
      )
  }
  // 竖框：沿顶面斜线的细条
  for (let k = span[0]; k <= span[1]; k++) {
    b.add(
      sweepBar([top(k), foot(k, footY)], CANOPY.frame, 0.1),
      C.glassFrame,
      site.design
    )
  }
}

/**
 * 西南大台阶：12 级放射台阶，从坑口落到半径 18。踏面、踢面在每个顶点处取点（3 个方位角），
 * 坑口那一级的顶点与铺装挖口逐点重合；θ 较大一侧补台阶侧墙（锯齿形剖面），θ 较小一侧是南侧雨棚的
 * 玻璃侧墙（不再重复建，免得两面重合闪烁）；两侧各一道玻璃栏板与扶手
 */
function buildStair(b, site, sets) {
  const ks = [SW_STAIR[0], SW_STAIR[0] + 1, SW_STAIR[1]]
  const rise = DEPTH / STAIR.n
  const run = (RIM_R - STAIR.footR) / (STAIR.n - 1)
  const rAt = (j) => (j === 0 ? RIM_R : RIM_R - j * run)
  const stone = sets.of(C.stairStone)
  for (let j = 0; j < STAIR.n; j++) {
    const r = rAt(j)
    const yTop = PAVE - j * rise
    const yBot = PAVE - (j + 1) * rise
    for (let i = 0; i + 1 < ks.length; i++) {
      const a = vertex(r, ks[i])
      const c = vertex(r, ks[i + 1])
      // 踢面：法线朝坑心（下台阶的方向）
      stone.flatQuad(
        p3(a, yBot),
        p3(c, yBot),
        p3(c, yTop),
        p3(a, yTop),
        inward(ang(ks[i] + 0.5))
      )
      // 踏面（最后一级下面就是坑底，不另铺）
      if (j + 1 < STAIR.n) {
        const r2 = rAt(j + 1)
        stone.flatQuad(
          p3(a, yBot),
          p3(c, yBot),
          p3(vertex(r2, ks[i + 1]), yBot),
          p3(vertex(r2, ks[i]), yBot),
          UP
        )
      }
    }
  }
  // 侧墙（θ 较大一侧）：剖面在 (半径, 高) 平面里三角化，再放到该方位角上
  const a = ang(SW_STAIR[1])
  const prof = [[RIM_R, PAVE - rise]]
  for (let j = 1; j < STAIR.n; j++) {
    prof.push([rAt(j), PAVE - j * rise], [rAt(j), PAVE - (j + 1) * rise])
  }
  prof.push([RIM_R, PIT_FLOOR])
  for (const [p, q, s] of triangulate(prof)) {
    const at = ([r, y]) => p3(polar(r, a), y)
    stone.flat(at(p), at(q), at(s), tangent(a))
  }
  // 栏板与扶手：沿台阶前缘连线（各级踢面顶边）上方 0.9 m，离两侧各 0.2 m
  const r0 = RIM_R
  const r1 = rAt(STAIR.n - 1)
  const y0 = PAVE
  const y1 = PAVE - (STAIR.n - 1) * rise
  for (const [k, sgn] of [
    [SW_STAIR[0], 1],
    [SW_STAIR[1], -1]
  ]) {
    const side = (r) => polar(r, ang(k) + sgn * Math.asin(STAIR.inset / r))
    const pA = side(r0)
    const pB = side(r1)
    sets
      .of(C.railGlass)
      .flatQuad(
        p3(pA, y0),
        p3(pB, y1),
        p3(pB, y1 + STAIR.rail),
        p3(pA, y0 + STAIR.rail),
        sgn > 0 ? neg(tangent(ang(k))) : tangent(ang(k))
      )
    b.add(
      sweepBar([p3(pA, y0 + STAIR.rail), p3(pB, y1 + STAIR.rail)], 0.1, 0.1),
      C.rail,
      site.design
    )
  }
}

/**
 * 一块采光顶的轮廓（设计系）：外弧、内弧加两条与分隔中线平行的直边
 * @param {[number, number][]} pair [[起始分隔角°, 半宽], [终止分隔角°, 半宽]]
 */
function skylightOutline([[a0, d0], [a1, d1]]) {
  // 与方位角 α 的射线平行、相距 d 的直线，在半径 R 处的方位角为 α ± asin(d / R)
  const from = (R) => a0 * DEG + Math.asin(d0 / R)
  const to = (R) => a1 * DEG - Math.asin(d1 / R)
  const arc = (R, s, e) => {
    const n = Math.max(1, Math.ceil(Math.abs(e - s) / SKY_STEP))
    return Array.from({ length: n + 1 }, (_, i) =>
      polar(R, s + ((e - s) * i) / n)
    )
  }
  const outer = arc(SKY.r1, from(SKY.r1), to(SKY.r1))
  const inner = arc(SKY.r0, to(SKY.r0), from(SKY.r0))
  return [...outer, ...inner]
}

/** 平铺采光顶：玻璃面 + 四周玻璃栏板 + 深绿扶手（c00、c07、c26） */
function buildSkylights(b, site) {
  for (const pair of SKYLIGHTS) {
    const poly = skylightOutline(pair)
    const top = []
    for (const t of triangulate(poly)) {
      pushUp(top, t, () => PIT_FLOOR + SKY.top)
    }
    b.add(fromTriangles(top), C.skyGlass, site.design)
    b.add(
      sideWalls(poly, PIT_FLOOR, PIT_FLOOR + SKY.rail),
      C.railGlass,
      site.design
    )
    b.add(
      sideWalls(poly, PIT_FLOOR + SKY.rail, PIT_FLOOR + SKY.railTop),
      C.rail,
      site.design
    )
  }
}

/** A、B 玻璃亭与地铁立牌 */
function buildPavilions(b, site) {
  for (const { u, v } of PAVILIONS) {
    // 局部 +z 指向背离坑心的半径方向、+x 沿切向：local() 偏航 θ 把 +z 转到 (sin θ, cos θ)
    const yaw = Math.atan2(u - EAST_EYE.u, v - EAST_EYE.v)
    const m = local(site.design, u, PIT_FLOOR, v, yaw)
    b.add(box(PAVILION.w, PAVILION.h, PAVILION.d), C.pavilionGlass, m)
    b.add(
      box(
        PAVILION.w + PAVILION.over * 2,
        PAVILION.roof,
        PAVILION.d + PAVILION.over * 2
      ),
      C.pavilionRoof,
      local(m, 0, PAVILION.h, 0)
    )
    b.add(box(SIGN.w, SIGN.h, SIGN.w), C.metroSign, local(m, SIGN.x, 0, SIGN.z))
  }
}

/** 中心雕塑：圆池、柱脚方墩、柱身与金带、两层托盘、中柱、白杆、金龙 */
function buildSculpture(b, site) {
  const f = local(site.design, EAST_EYE.u, 0, EAST_EYE.v)
  const at = (y) => local(f, 0, PIT_FLOOR + y, 0)
  const inR = POOL.r - POOL.t
  // 圆池：外壁、壁顶、内壁（从水面下起）、水面
  b.add(
    cylinder(POOL.r, POOL.r, POOL.h, { segments: POOL.seg }),
    C.marbleDark,
    at(0)
  )
  b.add(ring(inR, POOL.r, POOL.seg), C.marbleLight, at(POOL.h))
  b.add(
    cylinder(inR, inR, POOL.h - POOL.water + TUCK, { segments: POOL.seg }),
    C.marbleDark,
    at(POOL.water - TUCK)
  )
  b.add(ring(COLUMN.r - TUCK, inR + TUCK, POOL.seg), C.water, at(POOL.water))
  // 柱脚方墩：45° 起每 90° 一个，方墩一面朝坑心
  for (let i = 0; i < 4; i++) {
    const a = (45 + 90 * i) * DEG
    b.add(
      box(PEDESTAL.size, PEDESTAL.h, PEDESTAL.size),
      C.columnGreen,
      local(
        f,
        Math.cos(a) * PEDESTAL.r,
        PIT_FLOOR + POOL.water - TUCK,
        Math.sin(a) * PEDESTAL.r,
        -a
      )
    )
  }
  // 柱身：从水面下到下托盘底面里（开口圆柱，两头都看不见）
  const col0 = POOL.water - TUCK
  b.add(
    cylinder(COLUMN.r, COLUMN.r, COLUMN.top - col0, { segments: COLUMN.seg }),
    C.columnGreen,
    at(col0)
  )
  for (const [y0, y1, color] of COLUMN_BANDS) {
    b.add(
      cylinder(COLUMN.r + 0.05, COLUMN.r + 0.05, y1 - y0, {
        segments: COLUMN.seg
      }),
      color,
      at(y0)
    )
  }
  // 两层托盘与中柱、白杆
  addRevolved(b, f, LOWER_TRAY, LOWER_SEG, PIT_FLOOR)
  b.add(
    cylinder(MID_COLUMN.r, MID_COLUMN.r, MID_COLUMN.y1 - MID_COLUMN.y0, {
      segments: MID_COLUMN.seg
    }),
    C.sculptPole,
    at(MID_COLUMN.y0)
  )
  addRevolved(b, f, UPPER_TRAY, UPPER_SEG, PIT_FLOOR)
  const trayTop = UPPER_TRAY[0].p[1]
  b.add(
    cylinder(POLE.r, POLE.r, POLE.y1 - trayTop, {
      segments: POLE.seg,
      caps: true
    }),
    C.sculptPole,
    at(trayTop)
  )
  // 金龙：扁带 + 龙首（sculpture.js，与西鱼眼共用）
  addDragon(b, f, DRAGON, PIT_FLOOR)
}

/* ---------------- 入口 ---------------- */

/**
 * 城市地面洞：坑口圆外扩 0.5 m（世界坐标，64 边形）。洞口边缘在铺装下面、坑壁以外，
 * 坑壁从铺装顶一直落到坑底，城市地面的洞边从坑里、坑外都看不见
 */
export function eastEyeGroundHole(site) {
  return site.toWorldPts(
    circlePolygon(EAST_EYE.u, EAST_EYE.v, RIM_R + HOLE_PAD, HOLE_SEG)
  )
}

/**
 * 建东鱼眼下沉广场。铺装上的口子由调用方把 EAST_EYE_CUT 交给 buildGround 的 cuts。
 * @param {ColorBuilder} b 静态件
 * @param {object} site 场地对象（site.js 的 createSite）
 * @returns {{ walkways: Array, groundHoles: Array }} 坑底环与坑口外环（世界坐标）、城市地面洞
 */
export function buildEastEye(b, site) {
  // 坑底：半径 28.6 的圆面（含店面退进部分），法线朝上
  const floor = []
  for (const t of triangulate(
    circlePolygon(EAST_EYE.u, EAST_EYE.v, SHOP_R, SEG)
  )) {
    pushUp(floor, t, () => PIT_FLOOR)
  }
  b.add(fromTriangles(floor), C.pitFloor, site.design)

  // 坑壁、栏杆、雨棚、台阶：按颜色收进三角形集，最后逐色加入
  const sets = trisByColor()
  buildWall(b, site, sets)
  buildRimRail(sets)
  // 南侧雨棚 θ 较大一侧挨着大台阶：雨棚的这面侧墙兼作台阶东侧（θ 较小一侧）的玻璃墙
  buildCanopy(b, site, sets, SW_CANOPY)
  buildCanopy(b, site, sets, N_CANOPY)
  buildStair(b, site, sets)
  sets.addTo(b, site.design)

  buildSkylights(b, site)
  buildPavilions(b, site)
  buildSculpture(b, site)

  const walk = (w, y) => ({
    points: site.toWorldPts(circlePolygon(EAST_EYE.u, EAST_EYE.v, w.r, w.n)),
    y,
    width: w.width,
    closed: true,
    density: w.density
  })
  return {
    walkways: [walk(FLOOR_WALK, PIT_FLOOR), walk(RIM_WALK, PAVE)],
    groundHoles: [eastEyeGroundHole(site)]
  }
}

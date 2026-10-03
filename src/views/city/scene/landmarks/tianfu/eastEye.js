/*
 * 天府广场 · 东鱼眼「黄河龙」下沉广场
 * ----------------------------------------------------------
 * 依据：设计文档第 2 节（城市地面挖洞）、第 3 节「东鱼眼」；调研报告 0（结论第 2 条）、2.1（OSM 台阶、地铁口）、
 * 3.2（影像量测）、4.1（照片 c00、c07、c09～c12，c25～c27 下沉广场全貌）、4.2（景观中国 31539：浮雕带宽 2.4 m）、
 * 6.4（构件尺寸）、6.9（颜色）；影像 g_eeye、e_eeye、mosaic_google_z21_eeye 与按设计系重采样的
 * Google z20 极坐标展开图。中心雕塑在 eastSculpture.js。
 * 中心在设计系 (48.7, −0.7)（报告 3.2）。坑口半径 27.5 跨过阴鱼、东段地灯带并伸出太极大圆约 1.5 m
 * （48.7 + 27.5 = 76.2 > 74.7，与影像一致），铺装由 ground.js 按 EAST_EYE_CUT 逐三角形相减挖口。
 * 城市地面另由 index.js 返回的 groundHoles 挖洞（坑口外扩 0.5 m，见 eastEyeGroundHole）。
 *
 * 坐标：贴着坑口的构件（坑壁、栏杆、雨棚、大台阶、采光顶）直接在设计系 (u, v) 里写，坑口上的顶点
 * 一律取 EAST_EYE_CUT 的同一组点（台阶落在两个顶点之间的点取在同一条弦上），与铺装挖口、坑壁
 * 逐点重合、不留缝；雕塑在「鱼眼坐标系」里写（设计系平移到坑心，同 westEye.js）。
 * 方位角 θ 从东（+u）起向南（+v）转，即俯视顺时针；坑口 48 边形的第 k 个顶点在 θ = 7.5k°。
 * 高度：坑底 PIT_FLOOR = PAVE − 6 ≈ −4.5，低于城市地面 −0.5。
 *
 * 构成（半径单位米，高度从坑底算，另注明的除外）：
 * - 坑底：半径 28.6 的浅灰石材圆面（含店面前的退进部分）。卫星图上中心圆（半径 15.6）与放射步道同色。
 * - 坑壁（半径 27.5，法线朝里）：上部 2.4 m 红褐浮雕带（相邻两段深浅交替）、0.3 m 浅色檐口线；
 *   其下是地下一层店面带，退进 1.1 m 到半径 28.6，顶上一圈浅灰吊顶，前沿一排黄色圆柱（c11、c12）。
 *   大台阶背后那几段只有浮雕带与素面挡土墙（台阶贴着坑壁，不开店面）。
 * - 坑口栏杆：半径 27.75，玻璃栏板 + 深绿扶手，高 1.1（离铺装），只在大台阶顶的平台处断开。
 * - 坑口到坑底之间的环带：6 道 3 m 宽的放射步道、8 块平铺玻璃采光顶（玻璃面高 0.3，四周 1 m 高玻璃栏板 +
 *   深绿扶手，c00、c07、c26），北、南两处斜玻璃扶梯雨棚（c25、c26；卫星图上北侧那块反光最亮）。
 * - A、B 玻璃亭：8 × 6 × 4，中心取 OSM 地铁口节点（已扣 OSM 偏移），长边沿切向，旁立蓝灰色地铁立牌。
 * - 西南大台阶：贴着坑壁的切向台阶（半径 24～27.5），顶平台在 θ 127.5°～135° 与地面铺装齐平，
 *   15 级向东南降到 θ 92.5° 的坑底；内侧就是南侧雨棚的玻璃外墙（c26）。
 *
 * 与报告 6.4 不同之处（逐条有影像 / 照片依据）：
 * 1. 「5 道放射楼梯」改为 6 道平的放射步道：
 *    - 卫星图（Google z20 极坐标展开）上浅色放射带有 6 道，在 θ ≈ 16°、53°、156°、193°、229°、336°；
 *    - 这些带子外端都止于坑口内侧那圈连续的深色环（浮雕带顶与栏杆的阴影），没有一道接到地面铺装，
 *      说明它们不通到坑口；
 *    - 照片 c00、c07、c09、c25～c27 里浮雕带与店面一整圈连续，环带是地下一层平地：
 *      玻璃采光顶四周围着栏板，人在采光顶之间的平步道上走。
 *    从地面下到坑底，靠的是西南大台阶（OSM w512988921 highway=steps）与南北两处扶梯雨棚。
 * 2. 西南大台阶：OSM 的台阶线长约 22 m、在坑口外半径 31～33 m 处沿坑口切向（θ 130° → 90°），
 *    c26 里台阶也是顺着坑口往东南降。城市地面只挖坑口圆（设计第 2 节），坑口外再开槽会让挖口、
 *    地面洞都不再是一个圆，所以把这段切向台阶收进坑口以内、贴着坑壁：半径 24～27.5、
 *    θ 92.5°～135°（中线长约 19 m，含顶平台），方向、走向与 OSM、c26 一致，位置向坑心挪了约 5 m。
 * 3. 采光顶：报告写约 8 段。影像上是 8 块平铺 + 2 处斜雨棚，共 10 块玻璃，按影像做。
 * 4. 柱身直径（雕塑）：见 eastSculpture.js。
 *
 * 阴影：材质只画背光面进阴影贴图（index.js 的 shadowSide = BackSide），太阳在西南（theme.light），
 * 所以坑壁、栏杆的法线朝里：西南侧那半圈背对太阳、画进阴影贴图，影子落进坑里；吊顶法线朝下，
 * 店面带在阴影里。坑底低于城市地面，深度范围仍包得住：
 * - 主城区静态阴影的 far 由各投影物包围盒的角点算出（shadow.js 的 computeCityShadow），本景点 Mesh 的
 *   包围盒含坑底 y，far 不会比坑底浅（实测 far 比坑底最深处还深数千米）；
 * - 到站收紧阴影的 near / far 为 500 / 3,500（太阳距收紧中心 2,000 m），坑底各点深度约 2,005～2,043。
 * 所以 shadow.js 不必为坑底另作修正。
 *
 * 三角形（实测）：坑底 46、带店面的坑壁与圆柱 518、台阶背后坑壁 20、坑口栏杆 188、南雨棚 94、北雨棚 112、
 * 大台阶 92（踏步 58、顶平台 6、栏杆 28）、采光顶 374、A / B 玻璃亭 60、中心雕塑 1,708（分项见 eastSculpture.js），
 * 本体共 3,212；另 ground.js 铺装挖口多出 720，本件合计 3,932（设计第 5 节上限 5,500）。
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
import { C } from "./colors.js"
import { PAVE } from "./site.js"
import { cross, dot, pushTri, pushUp, sub, triangulate } from "./surface.js"
import { buildEastSculpture } from "./eastSculpture.js"

const DEG = Math.PI / 180

/* ---------------- 坑 ---------------- */

/** 东鱼眼中心（设计系，报告 3.2） */
const EAST_EYE = { u: 48.7, v: -0.7 }
// 坑深 6.0（报告 6.4，估计值）
const DEPTH = 6
/** 坑底高度：PAVE − 6 ≈ −4.5，比城市地面 GROUND_Y（−0.5）低 4 m */
const PIT_FLOOR = PAVE - DEPTH
// 坑口圆周分段：48 段（7.5° 一段，弦长 3.6 m）。坑壁、栏杆、雨棚、台阶都按这组方位角分段
const SEG = 48
/** 坑口半径（报告 3.2：两套影像 27.38 / 27.82） */
const RIM_R = 27.5
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
 * - 西南大台阶：k 17（θ 127.5°～135°）是顶平台，k 12～16（θ 90°～127.5°）是台阶段，
 *   台阶段背后的坑壁只有浮雕带与素面挡土墙（STAIR_WALL）；顶平台整块实心，背后的坑壁不建；
 * - 南侧扶梯雨棚 k 12～16：在台阶内侧（半径 18～24），雨棚外墙兼作台阶内侧的挡墙；
 * - 北侧扶梯雨棚 k 33～39（θ 247.5°～300°）：顶边就在坑口，后面那几段坑壁看不见，不建；
 * - 其余为带店面的坑壁（SHOP_RUNS）。
 * 栏杆除顶平台外一整圈（RAIL_RUN），在顶平台两侧接上台阶的栏杆。
 */
const SHOP_RUNS = [
  [18, 33],
  [40, 60]
]
const STAIR_WALL = [12, 17]
const RAIL_RUN = [18, 65]
// 坑口栏杆：半径 27.75（坑口外 0.25 m，立在铺装上），玻璃栏板到 0.95、深绿扶手到 1.1（离铺装）
const RAIL = { r: 27.75, panel: 0.95, top: 1.1 }
// 台阶栏杆的栏板下沿离脚下 5 cm（见 railSpan）
const RAIL_GAP = 0.05

/*
 * 斜玻璃扶梯雨棚：顶面从 topR（铺装高）斜落到 footR、离坑底 3.6 处，前面一道竖直玻璃墙落到坑底；
 * topR 在坑口以内时另有一道竖直外墙。尺寸都是估计值：
 * - 卫星图极坐标展开上北雨棚的玻璃向内伸到半径 13～14，c25、c26 里南雨棚的下沿接近圆池；
 * - 但坑底圆边上有 OSM 定位的 A、B 玻璃亭（A 亭外沿挑檐到半径 16.2、B 亭到 17.9），雨棚只能停在亭子后面：
 *   北雨棚落到 16.5（离 A 亭挑檐角 0.3 m），南雨棚落到 18（B 亭在它脚下，读作扶梯下到亭子）；
 * - 下沿离坑底 3.6：比玻璃亭（4.0）略低，c25 里雨棚低端约与亭顶齐平。
 * 南雨棚让出坑壁内侧 3.5 m 给大台阶，顶边在半径 24
 */
const S_CANOPY = { span: [12, 17], topR: 24, footR: 18, footY: 3.6 }
const N_CANOPY = { span: [33, 40], topR: RIM_R, footR: 16.5, footY: 3.6 }
// 雨棚竖框：宽 0.16、高 0.1；两头各缩进斜边长的 1.5%，不碰坑壁、外墙与台阶平台
const CANOPY_FRAME = { w: 0.16, h: 0.1, trim: 0.015 }

/*
 * 西南大台阶（切向，贴着坑壁）：半径 24～27.5（宽 3.5）。
 * - 顶平台：k 17（θ 127.5°～135°），与铺装齐平，坑口这一段不立栏杆，从广场直接走上平台；
 * - 台阶：从 θ 127.5° 起每 2.5° 一级、共 15 个踢面（每级高 0.4），降到 θ 92.5° 落在坑底；
 *   踏面在中线上深约 1.1 m，坡度约 20°。级距 2.5° 让每 3 级正好落在一个坑口顶点上；
 * - 栏杆：坑口栏杆在 θ 135° 的端头接着沿平台端边、平台内沿走，再顺台阶内沿（半径 24.25）下到坑底，
 *   同样是玻璃栏板 + 深绿扶手、高 1.1（离脚下踏步前缘连线）
 */
const STAIR = {
  r0: 24,
  landing: 17,
  top: 127.5,
  bottom: 92.5,
  n: 15,
  railR: 24.25
}

/*
 * 采光顶：每块夹在两道分隔之间，分隔为 [方位角°, 半宽]——放射步道半宽 1.5（宽 3，设计第 3 节），
 * 贴着雨棚、台阶平台的一侧留 1 m。采光顶内外沿在半径 16.4、25.8（卫星图：玻璃从坑底圆外侧起，
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
    [135, 1],
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
 * 8 × 6 × 4（报告 6.4）：长边 8 沿切向、短边 6 沿半径；A 亭贴着坑底圆边（外沿在半径 15.4），
 * B 亭跨在坑底圆边上（半径 11.2～17.2）
 */
const PAVILIONS = [
  { u: 55.3, v: -11.2 },
  { u: 45.5, v: 13.1 }
]
const PAVILION = { w: 8, d: 6, h: 3.7, roof: 0.3, over: 0.2 }
// 地铁立牌：0.5 × 0.5 × 4.6，立在亭子一侧、偏外半边（不挡坑底步道）；离亭子中心沿半径向外 1.0，
// B 亭的立牌外角在半径 16.1，不碰半径 16.4 起的采光顶
const SIGN = { w: 0.5, h: 4.6, x: 4.6, z: 1.0 }

/* ---------------- 步行路径 ---------------- */

/*
 * - 坑底环：半径 7.5、宽 1.8，标高 PIT_FLOOR（设计第 6 节「坑底环，半径 7～13」）。
 *   内沿 6.6 离圆池外壁 5.5 有 1.1 m；外沿 8.4 离 A 亭内侧面（半径 9.4）有 1.0 m，B 亭更远；
 *   托盘、龙带都在离坑底 6.4 m 以上，不碍头顶。
 * - 坑口外环：半径 29.6、宽 1.6，走在铺装上（设计第 6 节「半径 29～31」）。内沿 28.8 离坑口栏杆 27.75
 *   有 1.05 m；外沿 30.4 离东侧小草坪弧端（离坑心 30.8 m）还有 0.4 m，东南细草带（31.4 m）更远。
 *   大台阶整段在坑口以内，外环从顶平台外侧的铺装上走过。
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
/**
 * 半径 r 的 48 边形上、方位角 deg（度）处的点：落在顶点上时取顶点，否则取所在那条弦上按角度比例插值的点。
 * 台阶的踏步在两个顶点之间，取在弦上才与坑壁、雨棚外墙（都是 48 边形的弦）贴合、不留缝
 */
function chordPoint(r, deg) {
  const k = Math.floor(deg / 7.5 + 1e-9)
  const t = deg / 7.5 - k
  if (t < 1e-9) return vertex(r, k)
  const a = vertex(r, k)
  const c = vertex(r, k + 1)
  return [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t]
}
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
 * 两者都按法线校正绕向（surface.js 的 pushTri，与托盘旋转体同一个工具）。
 */
class Tris {
  constructor() {
    this.pos = []
    this.nor = []
  }

  smooth(A, B, Cc) {
    pushTri(this.pos, this.nor, A, B, Cc)
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

/** 浮雕带：坑壁最上面 2.4 m，相邻两段深浅交替 */
function buildRelief(sets, ks) {
  wallBand(sets, ks, RIM_R, RELIEF_Y0, DEPTH, (k) =>
    k % 2 ? C.reliefShade : C.relief
  )
}

/* ---------------- 坑壁 ---------------- */

/**
 * 带店面的一段坑壁：浮雕带、檐口线、店面带（店招 + 玻璃）、吊顶，两端封板挡住店面退进的端头，
 * 店面前的黄色圆柱
 * @param {number[]} run 段号区间 [起, 止)
 */
function buildShopWall(b, site, sets, run) {
  const ks = range(run)
  buildRelief(sets, ks)
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
      cylinder(SHOP_COL.r, SHOP_COL.r, FASCIA_Y0, { segments: SHOP_COL.seg }),
      C.shopColumn,
      local(site.design, u, PIT_FLOOR, v)
    )
  }
}

/** 大台阶背后的坑壁：浮雕带 + 素面挡土墙（被台阶挡住的下半截藏在台阶实体里） */
function buildStairWall(sets) {
  const ks = range(STAIR_WALL)
  buildRelief(sets, ks)
  wallBand(sets, ks, RIM_R, 0, RELIEF_Y0, () => C.stairStone)
}

/**
 * 栏杆的一段：玻璃栏板 + 深绿扶手两条竖直带（单面，法线朝 hint 一侧）。
 * a、c 为两端的设计系点，ya、yc 为两端栏杆脚下的高度（台阶上按踏步前缘连线逐段下降）。
 * 栏板下沿离脚下留 RAIL_GAP：栏板沿弦走、前缘连线按方位角线性下降，两者之间差几毫米，
 * 贴着踏步会与踢面互相穿插
 */
function railSpan(sets, a, c, ya, yc, hint) {
  const band = (color, d0, d1) =>
    sets
      .of(color)
      .flatQuad(
        p3(a, ya + d0),
        p3(c, yc + d0),
        p3(c, yc + d1),
        p3(a, ya + d1),
        hint
      )
  band(C.railGlass, RAIL_GAP, RAIL.panel)
  band(C.rail, RAIL.panel, RAIL.top)
}

/** 坑口栏杆：玻璃栏板 + 深绿扶手（法线朝里：西南侧背对太阳，影子落进坑里） */
function buildRimRail(sets) {
  const ks = range(RAIL_RUN)
  wallBand(sets, ks, RAIL.r, DEPTH, DEPTH + RAIL.panel, () => C.railGlass)
  wallBand(sets, ks, RAIL.r, DEPTH + RAIL.panel, DEPTH + RAIL.top, () => C.rail)
}

/* ---------------- 雨棚 ---------------- */

/**
 * 斜玻璃扶梯雨棚：顶面从 topR（铺装高）斜落到 footR；前面一道竖直玻璃墙、两侧梯形玻璃墙落到坑底；
 * topR 在坑口以内时补一道竖直外墙。顶面沿每个顶点一根浅色竖框
 * @param {{ span: number[], topR: number, footR: number, footY: number }} c 见 S_CANOPY / N_CANOPY
 */
function buildCanopy(b, site, sets, { span, topR, footR, footY }) {
  const glass = sets.of(C.skyGlass)
  const yFoot = PIT_FLOOR + footY
  const top = (k, y = PAVE) => p3(vertex(topR, k), y)
  const foot = (k, y) => p3(vertex(footR, k), y)
  for (const k of range(span)) {
    const mid = ang(k + 0.5)
    // 顶面法线朝上
    glass.flatQuad(top(k), top(k + 1), foot(k + 1, yFoot), foot(k, yFoot), UP)
    // 前墙法线朝坑心
    sets
      .of(C.railGlass)
      .flatQuad(
        foot(k, PIT_FLOOR),
        foot(k + 1, PIT_FLOOR),
        foot(k + 1, yFoot),
        foot(k, yFoot),
        inward(mid)
      )
    // 外墙（顶边在坑口以内时）：法线朝坑壁
    if (topR < RIM_R) {
      sets
        .of(C.railGlass)
        .flatQuad(
          top(k, PIT_FLOOR),
          top(k + 1, PIT_FLOOR),
          top(k + 1),
          top(k),
          neg(inward(mid))
        )
    }
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
        top(k, PIT_FLOOR),
        top(k),
        foot(k, yFoot),
        out
      )
  }
  // 竖框：沿顶面斜线的细条，两头缩进一点
  const { w, h, trim } = CANOPY_FRAME
  const lerp = (p, q, t) => p.map((x, i) => x + (q[i] - x) * t)
  for (let k = span[0]; k <= span[1]; k++) {
    const p = top(k)
    const q = foot(k, yFoot)
    b.add(
      sweepBar([lerp(p, q, trim), lerp(p, q, 1 - trim)], w, h),
      C.glassFrame,
      site.design
    )
  }
}

/* ---------------- 西南大台阶 ---------------- */

// 台阶每级的高、级距（度）与踏步前缘连线：θ 从 top 降到 bottom，前缘高度随 θ 线性下降
const STAIR_RISE = DEPTH / STAIR.n
const STAIR_STEP = (STAIR.top - STAIR.bottom) / (STAIR.n - 1)
const nosingY = (deg) => PAVE - (STAIR_RISE * (STAIR.top - deg)) / STAIR_STEP
/*
 * 台阶踏步的内外沿：取在南雨棚外墙（半径 24）、坑壁（坑口弦）那两条弦上，再沿半径往台阶里收 2 mm。
 * 正好贴在墙上时，墙面三角形的斜边恰好穿过踏步顶点，存成 Float32 后会算出微米级的「穿插」；
 * 2 mm 的缝在任何机位下都远小于一个像素
 */
const STAIR_GAP = 0.002
function stairEdge(r, deg, sgn) {
  const [u, v] = chordPoint(r, deg)
  const a = deg * DEG
  return [u + Math.cos(a) * STAIR_GAP * sgn, v + Math.sin(a) * STAIR_GAP * sgn]
}

/**
 * 台阶本体：15 个踢面、14 个踏面（最后一个踢面下面就是坑底），每块都从内沿（半径 24）铺到坑壁的弦上
 * （两边各收 2 mm，见 STAIR_GAP）。
 * 内侧由南雨棚的外墙挡住、外侧贴着坑壁，不另建侧墙
 */
function buildStairFlight(sets) {
  const stone = sets.of(C.stairStone)
  for (let j = 0; j < STAIR.n; j++) {
    const deg = STAIR.top - j * STAIR_STEP
    const a = deg * DEG
    const yTop = PAVE - j * STAIR_RISE
    const yBot = PAVE - (j + 1) * STAIR_RISE
    const pin = stairEdge(STAIR.r0, deg, 1)
    const pout = stairEdge(RIM_R, deg, -1)
    // 踢面：法线朝下台阶的方向（θ 减小）
    stone.flatQuad(
      p3(pin, yBot),
      p3(pout, yBot),
      p3(pout, yTop),
      p3(pin, yTop),
      neg(tangent(a))
    )
    // 踏面
    if (j + 1 < STAIR.n) {
      const d2 = deg - STAIR_STEP
      stone.flatQuad(
        p3(pin, yBot),
        p3(pout, yBot),
        p3(stairEdge(RIM_R, d2, -1), yBot),
        p3(stairEdge(STAIR.r0, d2, 1), yBot),
        UP
      )
    }
  }
}

/**
 * 顶平台：k 17 一段，从坑底到铺装实心（顶面与铺装齐平，坑口一侧就是挖口的弦），
 * 内侧面（半径 24）、端面（θ 135°）落到坑底
 */
function buildStairLanding(sets) {
  const stone = sets.of(C.stairStone)
  const k = STAIR.landing
  const in0 = vertex(STAIR.r0, k)
  const in1 = vertex(STAIR.r0, k + 1)
  const out1 = vertex(RIM_R, k + 1)
  stone.flatQuad(
    p3(in0, PAVE),
    p3(vertex(RIM_R, k), PAVE),
    p3(out1, PAVE),
    p3(in1, PAVE),
    UP
  )
  stone.flatQuad(
    p3(in0, PIT_FLOOR),
    p3(in1, PIT_FLOOR),
    p3(in1, PAVE),
    p3(in0, PAVE),
    inward(ang(k + 0.5))
  )
  stone.flatQuad(
    p3(in1, PIT_FLOOR),
    p3(out1, PIT_FLOOR),
    p3(out1, PAVE),
    p3(in1, PAVE),
    tangent(ang(k + 1))
  )
}

/**
 * 台阶栏杆：从坑口栏杆在 θ 135° 的端头起，沿平台端边、平台内沿走到台阶顶，
 * 再顺台阶内沿（半径 24.25）按踏步前缘连线下到坑底；样式、高度与坑口栏杆相同
 */
function buildStairRail(sets) {
  const kEnd = STAIR.landing + 1
  const aEnd = ang(kEnd)
  const rimEnd = vertex(RAIL.r, kEnd)
  const corner = vertex(STAIR.railR, kEnd)
  const top = vertex(STAIR.railR, STAIR.landing)
  railSpan(sets, rimEnd, corner, PAVE, PAVE, tangent(aEnd))
  railSpan(sets, corner, top, PAVE, PAVE, inward(ang(STAIR.landing + 0.5)))
  // 台阶段：每个坑口顶点一折，末端在台阶底
  const degs = []
  for (let d = STAIR.top; d > STAIR.bottom + 1e-9; d -= 7.5) degs.push(d)
  degs.push(STAIR.bottom)
  for (let i = 0; i + 1 < degs.length; i++) {
    const [d0, d1] = [degs[i], degs[i + 1]]
    railSpan(
      sets,
      chordPoint(STAIR.railR, d0),
      chordPoint(STAIR.railR, d1),
      nosingY(d0),
      nosingY(d1),
      inward(((d0 + d1) / 2) * DEG)
    )
  }
}

/* ---------------- 采光顶、玻璃亭 ---------------- */

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

/* ---------------- 入口 ---------------- */

/**
 * 城市地面洞：坑口圆外扩 0.5 m（世界坐标，64 边形）。洞口边缘在铺装下面、坑壁以外，
 * 坑壁从铺装顶一直落到坑底，城市地面的洞边从坑里、坑外都看不见
 */
function eastEyeGroundHole(site) {
  return site.toWorldPts(
    circlePolygon(EAST_EYE.u, EAST_EYE.v, RIM_R + HOLE_PAD, HOLE_SEG)
  )
}

/**
 * 建东鱼眼下沉广场。铺装上的口子由调用方把 EAST_EYE_CUT 交给 buildGround 的 cuts。
 * 三角形分项见文件头。
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
  for (const run of SHOP_RUNS) buildShopWall(b, site, sets, run)
  buildStairWall(sets)
  buildRimRail(sets)
  buildCanopy(b, site, sets, S_CANOPY)
  buildCanopy(b, site, sets, N_CANOPY)
  buildStairFlight(sets)
  buildStairLanding(sets)
  buildStairRail(sets)
  sets.addTo(b, site.design)

  buildSkylights(b, site)
  buildPavilions(b, site)
  buildEastSculpture(
    b,
    local(site.design, EAST_EYE.u, 0, EAST_EYE.v),
    PIT_FLOOR
  )

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

/*
 * 熊猫基地 · 树竹（竹林甬道、核心区乔木、点种竹丛、林冠起伏面与西区竹）
 * ----------------------------------------------------------
 * 规格：设计文档文首决策表（预算 ≤ 4 万：核心区乔木全用 addTree detail 0；西区林团改林冠起伏面）
 * 与调研报告 3.1（分区）、4.2（配色）、4.11（小熊猫 2 号活动场在林下）、4.13（全园绿地与竹林）、4.15（预算）。
 * 照片：pb_bamboo_road01 / 02（竹林甬道：两侧高竹竿顶向路心弯、在路面上空合拢）、sat_core_z17（核心区几乎满铺树冠）。
 *
 * 分区（调研 3.1）：核心区 = 园区 ∩ {x ≥ 6660} ∩ {z ≥ −9440}，西区 = 园区其余部分。
 * 种植顺序（后种的要避开先种的 F_TREE）：
 *   1 竹林甬道：第 2 条步行路径（loop，铜像 → 7 号别墅）西半段与第 3 条（villas，别墅步道）两侧，
 *     竹根离路中线 4.7 m、每 8 m 一丛、高 8～11 m，竿顶向路心倾 14°；路的镜头一侧倾角收小到 × 0.75，
 *     竹梢少探到路面上空（从机位看少挡路面与行人）；
 *   2 小熊猫 2 号活动场的林下乔木（场内不开草地洞、不打 F_YARD，见 enclosures.js）；
 *   3 林冠起伏面：40 m 网格三角网、顶点高 8～16 m，铺满西区，并延伸进核心区远处的大片空草地
 *     （宽约 80 m 以上、离步行路径远、不压熊猫视线；整片草地留在画面里会读成一条空带）；
 *   4 核心区乔木：kit addTree detail 0、r 8～13、干高 5～8。先按加权随机种主体（入口区与太阳产房周边
 *     权重最高、先种满，其余按「林团」成片；离南大门 > 900 m 的权重再 × 0.35，排得更靠后），
 *     再按空隙大小补种中等空隙（大片空地已由第 3 步的林冠面盖住）；
 *   5 核心区点种竹约 60 丛：活动场背侧（背向机位的一侧）、天鹅湖西岸步道外侧、太阳 / 月亮产房周边；
 *   6 西区竹 40 丛：沿园区西南边界内侧，3 丛一组。
 * 竹丛都写进 site.bambooBufs（每色一个顶点数组），种完后每色 fromTriangles 合成一个几何体加进 site.b。
 * 活动场里的矮竹（「熊猫食堂」）由 yards.js 自己合成进了 site.b，这里不碰。
 *
 * 避让（占用栅格，1 m 一格）：
 *   - 乔木：树冠赤道半径 r 的圆盘按 0.5 m 取样扫查（diskOk，比 kit freeDisk 的圆心 + 8 点严）不含
 *     F_SOLID | F_PAVE | F_WATER | F_WALK | F_TREE | F_YARD、整盘在园界内；另按几何距离复核
 *     冠缘离每条步行路径可走带边缘 ≥ 1.5 m（F_WALK 标记是「可走带 + 1.5 m」，栅格量化后窄处会差一点）；
 *   - 一般竹丛：同一掩码按丛半径扫查，另要求丛心离每条步行路径可走带边缘 ≥ 4.5 m（同望江楼 BAMBOO_CLEAR）；
 *   - 竹林甬道：按路径偏移落位，不查 F_WALK（否则每丛都会被挡掉），只查
 *     F_SOLID | F_WATER | F_YARD | F_TREE，且竹根所在格不是路面（F_PAVE）；另要求竹根离每条步行路径的
 *     可走带边缘 ≥ TUNNEL.edge（路口、急弯内侧的偏移点会贴近别的路，竹梢会探进那条路的净空）。
 *     竹梢不进 4.35 m 头顶净空与分部件净距的估算见 TUNNEL 注释，由步行路径校验兜底；
 *   - 林冠面：三角形覆盖的格子不含实体 / 路面 / 活动场（核心区部分再加水面、可走带、已种树竹），
 *     核心区部分种下后按三角形打 F_TREE，后面的乔木、竹丛不往里种；
 *   - 乔木、竹丛种下后在栅格上打 F_TREE（乔木按冠半径、竹丛按丛半径）。
 * 熊猫视线：每棵乔木（冠心、半径 1.15 r）、每丛竹（半高处、半径「丛半径 + 半高」）、核心区每块林冠三角形
 * （形心、半径取到最远顶点）落位前调用 site.blocksView，半径再加 VIEW_PAD + VIEW_SLACK（见其注释）。
 *
 * 预算（本分区 ≤ 约 16,900 三角形，景点合计 ≤ 38,500）：乔木 32 / 棵，竹丛 4 束 × 8 = 32 / 丛，
 * 林冠面每块 1 个三角形。超出时依次减西区竹、补空隙的乔木（WEST_BAMBOO.count、GAP_TREES.count）。
 */
import { Matrix4 } from "three"
import { THEME } from "../../theme.js"
import {
  hashInts,
  mulberry32,
  pointInPolygon,
  polygonBounds
} from "../../utils.js"
import { addTree } from "../kit/figures.js"
import { pushSpindle } from "../kit/plants.js"
import { fromTriangles } from "../kit/shapes.js"
import { FORK_PERCHES, RED_PANDA_AREA, RED_PANDA_HOUSE } from "./enclosures.js"
import { pathById } from "./ground.js"
import { MOON, SUN } from "./nurseries.js"
import {
  BAMBOO,
  C,
  F_PARK,
  F_PAVE,
  F_SOLID,
  F_TREE,
  F_WALK,
  F_WATER,
  F_YARD,
  LAWN_Y,
  WEST_POOLS
} from "./site.js"

const DEG = Math.PI / 180

/* ---------------- 分区、掩码与公共参数 ---------------- */

/** 核心区西界、北界（调研 3.1：核心区 = 园区 ∩ {x ≥ 6660} ∩ {z ≥ −9440}） */
const CORE_X = 6660
const CORE_Z = -9440

/** 乔木、一般竹丛、核心区林冠面的避让掩码（甬道竹另用 TUNNEL_BLOCK） */
const BLOCK = F_SOLID | F_PAVE | F_WATER | F_WALK | F_TREE | F_YARD
/** 竹林甬道的避让掩码：不含 F_WALK（甬道就贴着路种）与 F_PAVE（只查竹根那一格） */
const TUNNEL_BLOCK = F_SOLID | F_WATER | F_YARD | F_TREE

/** 树冠缘离步行路径可走带边缘的最小水平距离（米），同 walkways.js 的 WALK_CLEAR */
const CROWN_WALK_GAP = 1.5

/*
 * 视线判断的半径余量（米）：
 *   VIEW_PAD 1.5：blocksView 只保护熊猫头部那条线，加余量免得擦过视线挡住身体（任务规格）；
 *   VIEW_SLACK 4：到站机位还会微调（方位约 125° ± 5°、俯仰 28°～35°）。视线绕熊猫头部转动，
 *   离头部 s 米处横向约挪 0.09 s、竖向约挪 0.05 s；树冠、竹丛能碰到视线的地方都在头部 50 m 以内，
 *   多留 4 m 后机位在上述范围内小改也不会被挡（视线两侧各让出一条窄带，不会挨着视线种林团）
 */
const VIEW_PAD = 1.5
const VIEW_SLACK = 4

/** 乔木冠色：深林色两份 + 城市树四色（密林比城市公园树深一档，深色占一半） */
const GREENS = [...C.forest, ...C.forest, ...THEME.tree.greens]

/*
 * 竹林甬道（设计文档 4.13）：
 *   off 竹根离路中线、step 沿路间距、h 丛高（各束再 × 0.85～1.1）、lean 竿顶向路心倾角、
 *   nearK 路的镜头一侧倾角系数（这一侧倾角收小，竹梢少探到路面上空，从机位看少挡路面与行人）、
 *   along 一丛各束沿路排开的半宽、r 丛半径（查栅格、打 F_TREE，按沿路半宽取）、
 *   edge 竹根离任一步行路径可走带边缘的最小距离（第 2 条宽 3.0：4.7 − 1.5 = 3.2，留 0.05 m 浮点余量）。
 * 净空估算（最坏情况：最大倾角 16.1°、竹根朝路挪 0.2 m、叶团半径 0.14 倍高）：头部带（路面上 3.11～4.35 m）
 * 里叶团离竹根至多约 2.3 m，离路中线 ≥ 2.2 m，即离第 2 条可走带边缘 ≥ 0.7 m（要求 0.52 m）；
 * 身体带里离可走带边缘 ≥ 1.2 m（要求 0.86 m）；叶团要到路面以上约 5.5 m 才探进可走带上空，在 4.35 m
 * 头顶净空之上（实测第 2 条头部带最近 0.77 m）。
 */
const TUNNEL = {
  seed: 103,
  off: 4.7,
  step: 8,
  h: [8, 11],
  lean: 14,
  nearK: 0.75,
  along: 2.4,
  r: 2.4,
  n: 4,
  edge: 3.15
}

/*
 * 核心区乔木主体（设计文档 4.13）：count 棵、kit addTree detail 0，冠半径 r、干高 trunkH。
 * 候选点：从核心区西北角起 step 米网格、格内抖动 0.8 格，每格用「种子 + 格号」派生的独立随机流。
 * 落位顺序按加权随机（键 = 指数随机数 / 权重，从小到大逐个试种，种满 count 为止）：
 *   入口区（南大门 → 铜像一线 entry 米以内）与太阳产房周边（离圆心 sun 米以内）权重 focus
 *   （远大于林团，这两区先种满）；林团（groves 个圆，半径 grove 米，按种子撒在中近景的空地上，
 *   见 groveCircles）里权重 groveW；其余 rest（不为 0：林团之间也零星有树）；
 *   离南大门 > far 米的权重再 × farK（排得更靠后，预算紧时先少种它们）。
 */
const TREES = {
  seed: 101,
  count: 160,
  step: 15,
  r: [8, 13],
  trunkH: [5, 8],
  entry: 150,
  sun: [40, 110],
  focus: 24,
  groves: 16,
  grove: [40, 75],
  groveW: 6,
  rest: 0.1,
  far: 900,
  farK: 0.35
}
/** 铜像（入园主路 entry 北端，即第 1 条步行路径终点；同 ground.js ROADS 的 entry 末点） */
const STATUE = [7410, -8703]

/*
 * 补空隙的乔木：主体种完后，剩下的候选点按所在处的空地净距（离最近的实体 / 路 / 水 / 可走带 / 活动场 /
 * 已种树竹与林冠面的距离）从大到小试种 count 棵；离南大门 > far 米的净距按 farK 折算（画面里小）。
 * 净距场是种前算一次的静态场，同一块空地会连种几棵，读成一小片林子而不是均匀散点
 */
const GAP_TREES = { count: 73, farK: 0.6 }

/*
 * 小熊猫 2 号活动场的林下乔木（调研 4.11「林下」）：场内 step 米网格抖动取点，按种子打乱后试种 count 棵。
 * 冠盘不压矮墙（墙线打了 F_SOLID）、3 座树杈栖架与小熊猫产房（site.solid 登记）；冠半径取 r（比园区
 * 乔木小一档，场地窄）。冠底离草地 trunkH − 0.03 r ≥ 4.7 m，高过树杈栖架顶（3.6 m），不会压住栖架。
 * 另外树冠不挡住栖架顶、产房顶望向到站机位的线（同熊猫视线的判法，余量 propPad 米）：
 * 场里本来只有这几样东西，被树冠挡住就只剩一圈矮墙和几棵树
 */
const RED_PANDA_TREES = {
  seed: 97,
  count: 10,
  step: 6,
  r: [6, 9],
  trunkH: [5, 7],
  perchTop: 3.6,
  propPad: 1.5
}

/*
 * 核心区点种竹（设计文档 4.13「活动场背侧、湖西岸、产房周边点种约 60 丛」）：
 *   r 丛半径、h 丛高、clear 丛心离可走带边缘的最小距离（同望江楼 BAMBOO_CLEAR）；
 *   quota 三处的丛数上限：活动场背侧（外法向背向机位的那几段院边外 yardOff 米）、
 *   湖西岸（lakeWest 步道两侧 lakeOff 米，靠湖一侧落水被掩码挡掉）、产房周边（两座产房外 ring 米的环上）。
 */
const CLUMPS = {
  seed: 107,
  r: 1.8,
  h: [7, 10],
  n: 4,
  clear: 4.5,
  quota: { yard: 30, lake: 12, nursery: 18 },
  yardOff: [7, 12],
  yardStep: 9,
  lakeOff: [8.5, 12],
  lakeStep: 9,
  ring: { sun: [50, 68], moon: [42, 60] }
}

/*
 * 林冠起伏面（设计文档 3 节 / 4.13 最终决策：40 m 网格三角网、顶点高 8～16 m 随机）：
 *   网格线对齐核心区西界与北界（x = 6660、z = −9440 落在网格线上），顶点在平面上再抖动 ±jitter 米
 *   （打散规则的网格线与锯齿状的分区边，不加三角形）；高度 h 为离林下草地的高度。
 *   顶点「在林冠里」：西区园界内，或核心区里的开阔草地顶点（见 OPEN）。只留三个顶点都在林冠里、
 *   且中心不在 F_WATER（西区两池）的三角形；三角形覆盖的格子若有实体 / 路面 / 活动场也去掉
 *   （核心区西界上的矮房 1226059870 有一半在西区，免得把楼埋进林冠里）。
 *   林冠面的边缘顶点（只被一个三角形用到的边的端点）压到 edgeH：边缘斜落到林下，
 *   不悬空成一张「浮在 8～16 m 的毯子」（机位斜看时边缘下面会露出一条草地）。
 */
const CANOPY = {
  seed: 109,
  step: 40,
  h: [8, 16],
  jitter: 9,
  edgeH: 1.5,
  // 林冠面色：深林色为主，城市树色只取两档较深的（整片斜面受光强，亮色会把林冠读成一张揉皱的纸）
  colors: [...C.forest, ...C.forest, THEME.tree.greens[2], THEME.tree.greens[0]]
}

/*
 * 林冠面延伸进核心区的开阔草地：
 *   核心区顶点的空地净距（到 BLOCK 标记或园界外的距离，种完甬道竹与小熊猫区乔木后算）≥ vertex 米、
 *   离南大门 ≥ far 米（只铺远处：近景里一整块起伏面读成土丘，近处空地交给乔木）、离太阳产房圆心
 *   ≥ sunClear 米（乔木优先区）、不在小熊猫 2 号活动场里，才算在林冠里；
 *   核心区三角形再查熊猫视线，并按连通块（共用顶点）筛：块里最大净距 ≥ wide 米（草地宽约 80 m 以上）
 *   且不少于 minTris 个三角形，或与西区林冠相连（把西区林冠接着铺过分区线），才保留
 */
const OPEN = {
  vertex: 22,
  far: 600,
  sunClear: 130,
  wide: 40,
  minTris: 4,
  cell: 2,
  margin: 120
}

/*
 * 西区竹（设计文档 4.13「约 40 丛」，按任务说明沿园区西南边界内侧）：
 *   园界上外法向方位在 bearing 范围内（朝南～朝西）、中点在西区的边，接成一条边界线；
 *   count 丛按 group 丛一组（组内相隔 gap 米）沿整条线均匀分布，向园内偏 inset 米；
 *   丛半径、高、束数同点种竹。
 */
const WEST_BAMBOO = {
  seed: 113,
  count: 40,
  group: 3,
  gap: 9,
  bearing: [170, 280],
  inset: [6, 14]
}

/* ---------------- 几何小工具 ---------------- */

const _m = new Matrix4()
const _rx = new Matrix4()
const _ry = new Matrix4()

/** 区间 [a, b] 内按 t ∈ [0, 1) 取值 */
const lerpRange = ([a, b], t) => a + (b - a) * t

/** 点在核心区（不查园界） */
const inCoreRect = (x, z) => x >= CORE_X && z >= CORE_Z

/**
 * 点到折线（closed 时含末点回到首点的一段）的最近点与水平距离。
 * @returns {{ d: number, x: number, z: number }}
 */
function nearestOnLine(x, z, pts, closed = false) {
  let best = { d: Infinity, x: 0, z: 0 }
  const n = closed ? pts.length : pts.length - 1
  for (let i = 0; i < n; i++) {
    const [ax, az] = pts[i]
    const [bx, bz] = pts[(i + 1) % pts.length]
    const dx = bx - ax
    const dz = bz - az
    const len2 = dx * dx + dz * dz
    const t =
      len2 > 0
        ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2))
        : 0
    const px = ax + t * dx
    const pz = az + t * dz
    const d = Math.hypot(x - px, z - pz)
    if (d < best.d) best = { d, x: px, z: pz }
  }
  return best
}

/** (x, z) 离各步行路径可走带边缘（中线外 width / 2）的最小水平距离 */
function walkEdgeDist(x, z, walkways) {
  let best = Infinity
  for (const w of walkways) {
    const { d } = nearestOnLine(x, z, w.points, w.closed)
    best = Math.min(best, d - w.width / 2)
  }
  return best
}

/** diskOk 扫圆盘的取样步长（米）：半格，盘内任一点离最近的取样点 ≤ 0.35 m */
const DISK_STEP = 0.5

/**
 * 圆盘（圆心 (x, z)、半径 r）里是否没有 mask 标记、且整盘在园界内（F_PARK）。
 * 先查圆周 16 点（多数不合格的圆盘在这里就被挡下），再按 DISK_STEP 步长扫圆盘内的点。
 * 比 kit freeDisk（圆心 + 圆周 8 点）严：窄的路面带、可走带外扩带、实体外扩带会从 8 点之间漏过去
 */
function diskOk(grid, x, z, r, mask) {
  const bad = (px, pz) => {
    const f = grid.get(px, pz)
    return f & mask || !(f & F_PARK)
  }
  for (let k = 0; k < 16; k++) {
    const t = (k / 16) * Math.PI * 2
    if (bad(x + r * Math.cos(t), z + r * Math.sin(t))) return false
  }
  const n = Math.floor(r / DISK_STEP)
  const r2 = r * r
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const dx = i * DISK_STEP
      const dz = j * DISK_STEP
      if (dx * dx + dz * dz <= r2 && bad(x + dx, z + dz)) return false
    }
  }
  return true
}

/** 折线总长 */
function polyLength(pts) {
  let len = 0
  for (let i = 0; i + 1 < pts.length; i++) {
    len += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
  }
  return len
}

/**
 * 沿折线按弧长取点：返回弧长 s 处的点与该段的单位方向 { x, z, ux, uz }（s 超出两端时夹到端点）
 */
function pointAt(pts, s) {
  let rest = Math.max(0, s)
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i]
    const [bx, bz] = pts[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    if (len < 1e-9) continue
    if (rest <= len || i + 2 === pts.length) {
      const t = Math.min(rest, len) / len
      return {
        x: ax + (bx - ax) * t,
        z: az + (bz - az) * t,
        ux: (bx - ax) / len,
        uz: (bz - az) / len
      }
    }
    rest -= len
  }
  const [x, z] = pts[pts.length - 1]
  return { x, z, ux: 1, uz: 0 }
}

/** 取折线弧长 [s0, s1] 的一段（含两端插值点） */
function slicePolyline(pts, s0, s1) {
  const out = []
  const a = pointAt(pts, s0)
  out.push([a.x, a.z])
  let acc = 0
  for (let i = 0; i + 1 < pts.length; i++) {
    acc += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
    if (acc > s0 && acc < s1) out.push([pts[i + 1][0], pts[i + 1][1]])
  }
  const b = pointAt(pts, s1)
  out.push([b.x, b.z])
  return out
}

/**
 * 多边形各边的外法向（单位向量）：按边中点向一侧挪 0.5 m 是否落在多边形内判断朝向，
 * 不依赖顶点绕向。返回 [{ a, b, len, nx, nz }]。
 */
function outwardEdges(poly) {
  const out = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 1e-6) continue
    let nx = (b[1] - a[1]) / len
    let nz = -(b[0] - a[0]) / len
    const mx = (a[0] + b[0]) / 2
    const mz = (a[1] + b[1]) / 2
    if (pointInPolygon(mx + nx * 0.5, mz + nz * 0.5, poly)) {
      nx = -nx
      nz = -nz
    }
    out.push({ a, b, len, nx, nz })
  }
  return out
}

/**
 * 空地净距场：核心区（向西、向北各多取 OPEN.margin 米，让分区线附近也看得到西区的空地）按 OPEN.cell 米
 * 一格，每格到最近「障碍格」（mask 标记或园界外）的近似距离：八邻域两遍倒角距离变换，误差 < 8%。
 * @returns {(x: number, z: number) => number} 查询函数，场外返回 0
 */
function clearanceField(site, mask) {
  const { grid } = site
  const pb = polygonBounds(site.park)
  const cs = OPEN.cell
  const x0 = CORE_X - OPEN.margin
  const z0 = CORE_Z - OPEN.margin
  const nx = Math.ceil((pb.maxX - x0) / cs) + 1
  const nz = Math.ceil((pb.maxZ - z0) / cs) + 1
  const d = new Float32Array(nx * nz)
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const f = grid.get(x0 + (i + 0.5) * cs, z0 + (k + 0.5) * cs)
      d[k * nx + i] = f & mask || !(f & F_PARK) ? 0 : 1e9
    }
  }
  const a = cs
  const b = cs * Math.SQRT2
  // 正向：左、上、左上、右上
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const o = k * nx + i
      let v = d[o]
      if (i > 0) v = Math.min(v, d[o - 1] + a)
      if (k > 0) {
        v = Math.min(v, d[o - nx] + a)
        if (i > 0) v = Math.min(v, d[o - nx - 1] + b)
        if (i < nx - 1) v = Math.min(v, d[o - nx + 1] + b)
      }
      d[o] = v
    }
  }
  // 反向：右、下、右下、左下
  for (let k = nz - 1; k >= 0; k--) {
    for (let i = nx - 1; i >= 0; i--) {
      const o = k * nx + i
      let v = d[o]
      if (i < nx - 1) v = Math.min(v, d[o + 1] + a)
      if (k < nz - 1) {
        v = Math.min(v, d[o + nx] + a)
        if (i < nx - 1) v = Math.min(v, d[o + nx + 1] + b)
        if (i > 0) v = Math.min(v, d[o + nx - 1] + b)
      }
      d[o] = v
    }
  }
  return (x, z) => {
    const i = Math.floor((x - x0) / cs)
    const k = Math.floor((z - z0) / cs)
    if (i < 0 || i >= nx || k < 0 || k >= nz) return 0
    return d[k * nx + i]
  }
}

/** 熊猫视线检查（半径加 VIEW_PAD 与 VIEW_SLACK，见其注释） */
function blocks(site, x, y, z, radius) {
  return site.blocksView(x, y, z, radius + VIEW_PAD + VIEW_SLACK)
}

/* ---------------- 竹丛 ---------------- */

/**
 * 一丛竹：n 束竹梢叶团（kit pushSpindle），丛心地面点 (x, y, z)，丛高 h（各束 × 0.85～1.1）。
 *   - lean 给出时（{ dx, dz, deg, along }：倾向的水平单位向量、倾角、沿路半宽）为甬道竹：各束竹根沿路方向
 *     在 ±along 米内均匀排开（一丛铺满大半个间距，两侧读成连续的竹墙），横向只在 −0.8～+0.2 m
 *     （+ 为朝路一侧：竹根不往路面挤），叶团半径为高的 0.11～0.14（比一般竹丛胖），竿顶朝 lean 方向倾
 *     deg × 0.85～1.15，方向左右抖 ±0.25 rad（同草堂花径 lean 的写法，抖动收窄：竹梢要越过路面上空、
 *     又不能压低到净空里）；
 *   - 否则为一般竹丛：各束竹根在丛心 0.3～1.2 m 内随机散开，从丛心向外微倾 4°～12°。
 * 顶点写进 bufs[颜色下标]（BAMBOO 四色随机取一）。
 */
function addBamboo(bufs, x, y, z, rand, h, n, lean) {
  for (let i = 0; i < n; i++) {
    const hh = h * (0.85 + rand() * 0.25)
    // 甬道竹的叶团更胖（照片里两侧是连成一片的竹墙），一般竹丛同草堂、望江楼的比例
    const r = hh * (lean ? 0.11 + rand() * 0.03 : 0.08 + rand() * 0.03)
    const out = bufs[Math.floor(rand() * bufs.length)]
    let px
    let pz
    let dir
    let tilt
    if (lean) {
      // 沿路均匀排开（第 i 束落在 ±along 的第 i 份里，再抖 ±0.4 m），一丛铺满大半个间距
      const along =
        ((i + 0.5) / n - 0.5) * 2 * lean.along + (rand() - 0.5) * 0.8
      const across = -0.8 + rand()
      // lean 方向 (dx, dz) 指向路心；沿路方向取它的垂直方向 (−dz, dx)
      px = x + lean.dx * across - lean.dz * along
      pz = z + lean.dz * across + lean.dx * along
      dir = Math.atan2(lean.dx, lean.dz) + (rand() - 0.5) * 0.5
      tilt = lean.deg * (0.85 + rand() * 0.3) * DEG
    } else {
      const a = rand() * Math.PI * 2
      const off = 0.3 + rand() * 0.9
      px = x + Math.sin(a) * off
      pz = z + Math.cos(a) * off
      dir = a
      tilt = (4 + rand() * 8) * DEG
    }
    // 先绕 X 轴把 +Y 向 +Z 倾 tilt，再绕 Y 轴把 +Z 转到 dir 方位：竿顶朝 (sin dir, cos dir) 倾
    _ry.makeRotationY(dir)
    _rx.makeRotationX(tilt)
    _m.makeTranslation(px, y, pz).multiply(_ry).multiply(_rx)
    pushSpindle(out, _m, hh, r)
  }
}

/**
 * 一般竹丛的落位检查与种植（核心区点种、西区竹共用）：掩码与园界（diskOk 扫查）、离可走带边缘、熊猫视线，
 * 通过就种下并打 F_TREE。返回是否种下；没种下时在 rej 里按原因计数。
 */
function tryClump(site, walkways, bufs, x, z, rand, rej) {
  const K = CLUMPS
  const { grid } = site
  const h = lerpRange(K.h, rand())
  if (!diskOk(grid, x, z, K.r, BLOCK)) {
    rej.mask++
    return false
  }
  if (walkEdgeDist(x, z, walkways) < K.clear) {
    rej.walk++
    return false
  }
  if (blocks(site, x, LAWN_Y + h / 2, z, K.r + h / 2)) {
    rej.view++
    return false
  }
  addBamboo(bufs, x, LAWN_Y, z, rand, h, K.n, null)
  grid.disk(x, z, K.r, F_TREE)
  return true
}

/* ---------------- 1 竹林甬道 ---------------- */

/**
 * 第 2 条步行路径（loop 去掉末点，同 walkways.js）的西半段（按弧长后一半）与第 3 条（villas）两侧，
 * 每 step 米、两侧各一丛，竹根离中线 off 米；竿顶倾向竹根到路中线的最近点（折点处也朝路心）。
 */
function plantTunnels(site, walkways, bufs, stats) {
  const K = TUNNEL
  const { grid } = site
  const rej = stats.rejected.tunnel
  const [camX, , camZ] = site.cameraPos()
  const loop = pathById(site, "loop").pts.slice(0, -1)
  const loopLen = polyLength(loop)
  const lines = [
    slicePolyline(loop, loopLen / 2, loopLen),
    pathById(site, "villas").pts
  ]
  lines.forEach((line, li) => {
    const len = polyLength(line)
    const n = Math.floor(len / K.step)
    for (let k = 0; k <= n; k++) {
      // 两端各让出半格，均匀铺满整段
      const s = (len - n * K.step) / 2 + k * K.step
      for (const side of [-1, 1]) {
        const rand = mulberry32(hashInts(K.seed, li, k, side))
        const p = pointAt(line, s + (rand() - 0.5) * 1.6)
        // 法向 (−uz, ux)，side 选左右两侧
        const x = p.x - p.uz * K.off * side
        const z = p.z + p.ux * K.off * side
        if (grid.get(x, z) & F_PAVE) {
          rej.pave++
          continue
        }
        if (!diskOk(grid, x, z, K.r, TUNNEL_BLOCK)) {
          rej.mask++
          continue
        }
        if (walkEdgeDist(x, z, walkways) < K.edge) {
          rej.edge++
          continue
        }
        const h = lerpRange(K.h, rand())
        if (blocks(site, x, LAWN_Y + h / 2, z, K.r + h / 2)) {
          rej.view++
          continue
        }
        // 倾向：竹根 → 路中线最近点
        const q = nearestOnLine(x, z, line)
        const dx = (q.x - x) / q.d
        const dz = (q.z - z) / q.d
        // 竹根在路的镜头一侧（路心 → 竹根的方向朝向机位）时倾角收小
        const near = -dx * (camX - x) - dz * (camZ - z) > 0
        const deg = K.lean * (near ? K.nearK : 1)
        addBamboo(bufs, x, LAWN_Y, z, rand, h, K.n, {
          dx,
          dz,
          deg,
          along: K.along
        })
        grid.disk(x, z, K.r, F_TREE)
        stats.tunnel++
      }
    }
  })
}

/* ---------------- 乔木公共 ---------------- */

/**
 * 一棵乔木的落位检查与种植：冠盘按 0.5 m 取样扫掩码与园界、冠缘离可走带边缘 ≥ CROWN_WALK_GAP、熊猫视线；
 * 通过就种下（kit addTree detail 0）并按冠半径打 F_TREE。c 为 { x, z, r, trunkH, color, yaw }。
 * 返回是否种下；没种下时在 rej 里按原因计数。
 */
function tryTree(site, walkways, c, rej) {
  const { grid } = site
  if (!diskOk(grid, c.x, c.z, c.r, BLOCK)) {
    rej.mask++
    return false
  }
  if (walkEdgeDist(c.x, c.z, walkways) - c.r < CROWN_WALK_GAP) {
    rej.walk++
    return false
  }
  // 冠心：树根以上 trunkH + 0.95 r（kit addTree）
  const cy = LAWN_Y + c.trunkH + 0.95 * c.r
  if (blocks(site, c.x, cy, c.z, 1.15 * c.r)) {
    rej.view++
    return false
  }
  addTree(site.b, c.x, LAWN_Y, c.z, {
    r: c.r,
    color: c.color,
    trunkH: c.trunkH,
    yaw: c.yaw,
    detail: 0
  })
  grid.disk(c.x, c.z, c.r, F_TREE)
  return true
}

/* ---------------- 2 小熊猫 2 号活动场林下乔木 ---------------- */

/**
 * 球（球心 (cx, cy, cz)、半径 radius）是否压到某个点 targets[i] 望向到站机位的线段
 * （自该点起 1～150 m 一段，同 site.blocksView 的视线取法）
 */
function blocksProps(site, targets, cx, cy, cz, radius) {
  const [px, py, pz] = site.cameraPos()
  for (const [tx, ty, tz] of targets) {
    const len = Math.hypot(px - tx, py - ty, pz - tz)
    const dx = (px - tx) / len
    const dy = (py - ty) / len
    const dz = (pz - tz) / len
    const s = Math.max(
      1,
      Math.min(150, (cx - tx) * dx + (cy - ty) * dy + (cz - tz) * dz)
    )
    const d = Math.hypot(cx - tx - dx * s, cy - ty - dy * s, cz - tz - dz * s)
    if (d < radius) return true
  }
  return false
}

function plantRedPanda(site, walkways, stats) {
  const R = RED_PANDA_TREES
  const bb = polygonBounds(RED_PANDA_AREA)
  // 受保护的点：三座栖架顶、产房屋顶中心
  const props = [
    ...FORK_PERCHES.map(([x, z]) => [x, LAWN_Y + R.perchTop, z]),
    [RED_PANDA_HOUSE.at[0], RED_PANDA_HOUSE.top, RED_PANDA_HOUSE.at[1]]
  ]
  const cands = []
  for (let x = bb.minX; x < bb.maxX; x += R.step) {
    for (let z = bb.minZ; z < bb.maxZ; z += R.step) {
      // 每格独立随机流：抖动 x、z，冠半径、干高、冠色、朝向、排序键
      const rand = mulberry32(hashInts(R.seed, Math.round(x), Math.round(z)))
      const px = x + rand() * R.step
      const pz = z + rand() * R.step
      const r = lerpRange(R.r, rand())
      const trunkH = lerpRange(R.trunkH, rand())
      const color = GREENS[Math.floor(rand() * GREENS.length)]
      const yaw = rand() * Math.PI * 2
      const key = rand()
      if (!pointInPolygon(px, pz, RED_PANDA_AREA)) continue
      cands.push({ x: px, z: pz, r, trunkH, color, yaw, key })
    }
  }
  cands.sort((a, b) => a.key - b.key)
  for (const c of cands) {
    if (stats.trees.redPanda >= R.count) break
    const cy = LAWN_Y + c.trunkH + 0.95 * c.r
    if (blocksProps(site, props, c.x, cy, c.z, 1.15 * c.r + R.propPad)) {
      stats.rejected.tree.props++
      continue
    }
    if (tryTree(site, walkways, c, stats.rejected.tree)) stats.trees.redPanda++
  }
}

/* ---------------- 3 林冠起伏面（西区 + 核心区远处空地） ---------------- */

/** 点在西区园界内（园区多边形内、且不在核心区矩形里） */
function inWest(site, x, z) {
  return !inCoreRect(x, z) && pointInPolygon(x, z, site.park)
}

/** 三角形（xz 平面）覆盖的格子里是否有 mask 标记：按 2 m 步长扫包围盒，取落在三角形内的点 */
function triangleHits(grid, a, b, c, mask) {
  const minX = Math.min(a.x, b.x, c.x)
  const maxX = Math.max(a.x, b.x, c.x)
  const minZ = Math.min(a.z, b.z, c.z)
  const maxZ = Math.max(a.z, b.z, c.z)
  const tri = [
    [a.x, a.z],
    [b.x, b.z],
    [c.x, c.z]
  ]
  for (let x = minX; x <= maxX; x += 2) {
    for (let z = minZ; z <= maxZ; z += 2) {
      if (grid.get(x, z) & mask && pointInPolygon(x, z, tri)) return true
    }
  }
  return false
}

/** 核心区顶点是否算开阔草地（见 OPEN 注释）；clear 为空地净距场 */
function openCore(site, clear, x, z) {
  const O = OPEN
  const { spot } = site.ctx
  if (!inCoreRect(x, z) || !pointInPolygon(x, z, site.park)) return false
  if (clear(x, z) < O.vertex) return false
  if (Math.hypot(x - spot.x, z - spot.z) < O.far) return false
  if (Math.hypot(x - SUN.c[0], z - SUN.c[1]) < O.sunClear) return false
  return !pointInPolygon(x, z, RED_PANDA_AREA)
}

/**
 * 核心区林冠三角形按连通块（共用顶点）筛选（见 OPEN 注释），返回保留的三角形下标集合。
 * cores 为核心区三角形 [{ t: 顶点下标三元组, ti: 在 tris 里的下标 }]
 */
function keepCoreBlocks(cores, verts) {
  const O = OPEN
  // 并查集：共用顶点的三角形归一块
  const parent = cores.map((_, i) => i)
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const byVert = new Map()
  cores.forEach(({ t }, i) => {
    for (const j of t) {
      if (byVert.has(j)) parent[find(i)] = find(byVert.get(j))
      else byVert.set(j, i)
    }
  })
  const groups = new Map()
  cores.forEach(({ t, ti }, i) => {
    const root = find(i)
    if (!groups.has(root)) groups.set(root, { tis: [], wide: 0, west: false })
    const blk = groups.get(root)
    blk.tis.push(ti)
    for (const j of t) {
      const v = verts[j]
      if (v.west) blk.west = true
      else blk.wide = Math.max(blk.wide, v.clear)
    }
  })
  const keep = new Set()
  for (const blk of groups.values()) {
    if (blk.west || (blk.wide >= O.wide && blk.tis.length >= O.minTris)) {
      for (const ti of blk.tis) keep.add(ti)
    }
  }
  return keep
}

function buildCanopy(site, stats) {
  const K = CANOPY
  const { grid } = site
  const pb = polygonBounds(site.park)
  // 空地净距：此时已种甬道竹、小熊猫区乔木，已登记全部实体、路面、水面、活动场、可走带
  const clear = clearanceField(site, BLOCK)
  // 网格号 i、k 以核心区西北角 (CORE_X, CORE_Z) 为原点（负号在西、北）
  const i0 = Math.floor((pb.minX - CORE_X) / K.step)
  const i1 = Math.ceil((pb.maxX - CORE_X) / K.step)
  const k0 = Math.floor((pb.minZ - CORE_Z) / K.step)
  const k1 = Math.ceil((pb.maxZ - CORE_Z) / K.step)
  const ni = i1 - i0 + 1
  const verts = []
  for (let k = k0; k <= k1; k++) {
    for (let i = i0; i <= i1; i++) {
      // 每个顶点独立随机流：平面抖动 x、z，高度
      const rand = mulberry32(hashInts(K.seed, i, k))
      const x = CORE_X + i * K.step + (rand() - 0.5) * 2 * K.jitter
      const z = CORE_Z + k * K.step + (rand() - 0.5) * 2 * K.jitter
      const h = lerpRange(K.h, rand())
      const west = inWest(site, x, z)
      const core = !west && openCore(site, clear, x, z)
      verts.push({ x, z, y: LAWN_Y + h, west, core, clear: clear(x, z) })
    }
  }
  const V = (i, k) => (k - k0) * ni + (i - i0)
  // 每格两个三角形，对角线方向按格号播种（避免整片同向的斜纹）
  const tris = []
  const cores = []
  for (let k = k0; k < k1; k++) {
    for (let i = i0; i < i1; i++) {
      const q = [V(i, k), V(i + 1, k), V(i + 1, k + 1), V(i, k + 1)]
      const flip = hashInts(K.seed + 1, i, k) & 1
      const pair = flip
        ? [
            [q[0], q[1], q[2]],
            [q[0], q[2], q[3]]
          ]
        : [
            [q[0], q[1], q[3]],
            [q[1], q[2], q[3]]
          ]
      pair.forEach((t, ti) => {
        const vs = t.map((j) => verts[j])
        if (!vs.every((v) => v.west || v.core)) return
        const [a, b, c] = vs
        const cx = (a.x + b.x + c.x) / 3
        const cz = (a.z + b.z + c.z) / 3
        if (grid.get(cx, cz) & F_WATER) return
        // 有核心区顶点的三角形伸进了核心区：掩码加严（水面、可走带、已种树竹），并查熊猫视线
        const inCore = vs.some((v) => v.core)
        const mask = inCore ? BLOCK : F_SOLID | F_PAVE | F_YARD
        if (triangleHits(grid, a, b, c, mask)) {
          stats.rejected.canopy.mask++
          return
        }
        if (inCore) {
          const cy = (a.y + b.y + c.y) / 3
          const rr = Math.max(
            ...vs.map((v) => Math.hypot(v.x - cx, v.y - cy, v.z - cz))
          )
          if (blocks(site, cx, cy, cz, rr)) {
            stats.rejected.canopy.view++
            return
          }
          cores.push({ t, ti: tris.length })
        }
        tris.push({
          t,
          color: hashInts(K.seed + 2, i, k, ti) % K.colors.length
        })
      })
    }
  }
  // 核心区部分按连通块筛，西区三角形全留
  const keepCore = keepCoreBlocks(cores, verts)
  const coreSet = new Set(cores.map((c) => c.ti))
  const kept = tris.filter((_, ti) => !coreSet.has(ti) || keepCore.has(ti))
  stats.rejected.canopy.block = coreSet.size - keepCore.size
  // 边缘顶点：只被一个保留三角形用到的边是林冠面的边界，其两端压到 edgeH
  const edgeUse = new Map()
  const edgeKey = (p, q) => (p < q ? `${p},${q}` : `${q},${p}`)
  for (const { t } of kept) {
    for (let e = 0; e < 3; e++) {
      const key = edgeKey(t[e], t[(e + 1) % 3])
      edgeUse.set(key, (edgeUse.get(key) || 0) + 1)
    }
  }
  for (const [key, n] of edgeUse) {
    if (n !== 1) continue
    for (const j of key.split(",")) verts[Number(j)].y = LAWN_Y + K.edgeH
  }
  // 按色分组写顶点（法线朝上：xz 平面上逆着 +Y 看为逆时针）；核心区部分打 F_TREE，后种的乔木竹丛避开
  const bufs = K.colors.map(() => [])
  for (const { t, color } of kept) {
    let [a, b, c] = t.map((j) => verts[j])
    if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0)
      [b, c] = [c, b]
    bufs[color].push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    if (a.core || b.core || c.core) {
      grid.fillPoly(
        [
          [a.x, a.z],
          [b.x, b.z],
          [c.x, c.z]
        ],
        F_TREE
      )
    }
  }
  bufs.forEach((pos, ci) => {
    if (pos.length) site.b.add(fromTriangles(pos), K.colors[ci])
  })
  stats.canopy.total = kept.length
  stats.canopy.core = keepCore.size
}

/* ---------------- 4 核心区乔木 ---------------- */

/**
 * 林团圆心：按种子在核心区包围盒里撒点，只取落在园界内、核心区内、离南大门 far 米以内
 * （机位画面的中近景，远处的林团在画面里太小）、且格子空着（无实体 / 路 / 水 / 活动场）的点，
 * 取满 TREES.groves 个为止。
 * @returns {Array<[number, number, number]>} [x, z, 半径]
 */
function groveCircles(site) {
  const T = TREES
  const { grid } = site
  const { spot } = site.ctx
  const pb = polygonBounds(site.park)
  const rand = mulberry32(T.seed + 1)
  const out = []
  for (let i = 0; i < T.groves * 20 && out.length < T.groves; i++) {
    const x = CORE_X + rand() * (pb.maxX - CORE_X)
    const z = CORE_Z + rand() * (pb.maxZ - CORE_Z)
    const r = lerpRange(T.grove, rand())
    const f = grid.get(x, z)
    if (!(f & F_PARK) || f & (F_SOLID | F_PAVE | F_WATER | F_YARD)) continue
    if (Math.hypot(x - spot.x, z - spot.z) > T.far) continue
    out.push([x, z, r])
  }
  return out
}

/**
 * 乔木候选点的权重与所属分档（见 TREES 注释）
 * @returns {{ w: number, zone: "focus" | "grove" | "rest" }}
 */
function treeWeight(site, groves, x, z) {
  const T = TREES
  const { spot } = site.ctx
  const gate = [spot.x, spot.z]
  const entry = nearestOnLine(x, z, [gate, STATUE]).d
  const sun = Math.hypot(x - SUN.c[0], z - SUN.c[1])
  let w = T.rest
  let zone = "rest"
  if (entry < T.entry || (sun > T.sun[0] && sun < T.sun[1])) {
    w = T.focus
    zone = "focus"
  } else if (groves.some(([gx, gz, r]) => Math.hypot(x - gx, z - gz) < r)) {
    w = T.groveW
    zone = "grove"
  }
  if (Math.hypot(x - gate[0], z - gate[1]) > T.far) w *= T.farK
  return { w, zone }
}

/** 核心区乔木：主体按加权随机种 TREES.count 棵，再按空隙大小补种 GAP_TREES.count 棵 */
function plantTrees(site, walkways, stats) {
  const T = TREES
  const { grid } = site
  const { spot } = site.ctx
  const rej = stats.rejected.tree
  const pb = polygonBounds(site.park)
  const groves = groveCircles(site)
  const nx = Math.ceil((pb.maxX - CORE_X) / T.step)
  const nz = Math.ceil((pb.maxZ - CORE_Z) / T.step)
  const cands = []
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      // 每格独立随机流，取用顺序固定：抖动 x、z，冠半径、干高、冠色、朝向、排序键
      const rand = mulberry32(hashInts(T.seed, ix, iz))
      const x = CORE_X + (ix + 0.5 + (rand() - 0.5) * 0.8) * T.step
      const z = CORE_Z + (iz + 0.5 + (rand() - 0.5) * 0.8) * T.step
      // 冠半径偏向大的一端（√u）：同样棵数，冠幅大些更显林密
      const r = lerpRange(T.r, Math.sqrt(rand()))
      const trunkH = lerpRange(T.trunkH, rand())
      const color = GREENS[Math.floor(rand() * GREENS.length)]
      const yaw = rand() * Math.PI * 2
      const u = rand()
      if (!inCoreRect(x, z) || !(grid.get(x, z) & F_PARK)) continue
      // 加权随机排序（Efraimidis–Spirakis）：键 = −ln(1 − u) / 权重，越小越先种
      const { w, zone } = treeWeight(site, groves, x, z)
      const key = -Math.log(1 - u) / w
      cands.push({ x, z, r, trunkH, color, yaw, key, zone, done: false })
    }
  }
  cands.sort((a, b) => a.key - b.key)
  let main = 0
  for (const c of cands) {
    if (main >= T.count) break
    if (!tryTree(site, walkways, c, rej)) continue
    c.done = true
    main++
    stats.trees[c.zone]++
  }
  // 补空隙：剩下的候选按空地净距（种完主体后算一次）从大到小试种
  const G = GAP_TREES
  const clear = clearanceField(site, BLOCK)
  const rest = cands
    .filter((c) => !c.done)
    .map((c) => {
      const far = Math.hypot(c.x - spot.x, c.z - spot.z) > T.far
      return { c, gap: clear(c.x, c.z) * (far ? G.farK : 1) }
    })
  rest.sort((a, b) => b.gap - a.gap)
  for (const { c } of rest) {
    if (stats.trees.gap >= G.count) break
    if (tryTree(site, walkways, c, rej)) stats.trees.gap++
  }
}

/* ---------------- 5 核心区点种竹 ---------------- */

/** 活动场轮廓：草地洞里除去湖、池（其余都是 site.addYard 登记的活动场） */
function yardPolys(site) {
  const water = new Set([site.lakes.swan, site.lakes.ne, ...WEST_POOLS])
  return site.lawnHoles.filter((h) => !water.has(h))
}

/**
 * 候选点按「种子 + 来源 + 序号」派生的随机键打乱后逐个试种，种满 quota 为止。
 * cands 为 [x, z] 数组，src 为来源名（stats.clumps 的键）。
 */
function plantClumpSet(site, walkways, bufs, stats, cands, src, si) {
  const K = CLUMPS
  const order = cands.map(([x, z], i) => {
    const rand = mulberry32(hashInts(K.seed, si, i))
    return { x, z, key: rand(), rand }
  })
  order.sort((a, b) => a.key - b.key)
  for (const c of order) {
    if (stats.clumps[src] >= K.quota[src]) break
    if (
      tryClump(site, walkways, bufs, c.x, c.z, c.rand, stats.rejected.clump)
    ) {
      stats.clumps[src]++
    }
  }
}

function plantClumps(site, walkways, bufs, stats) {
  const K = CLUMPS
  const [camX, , camZ] = site.cameraPos()
  // 活动场背侧：外法向背向机位（与「边中点 → 机位」方向夹角 > 105°）的院边，每 yardStep 米一个点，
  // 向外 yardOff 米（院墙、绿篱登记为实体，落在上面的点被掩码挡掉）
  const yard = []
  yardPolys(site).forEach((poly, pi) => {
    for (const e of outwardEdges(poly)) {
      const mx = (e.a[0] + e.b[0]) / 2
      const mz = (e.a[1] + e.b[1]) / 2
      const cl = Math.hypot(camX - mx, camZ - mz)
      if ((e.nx * (camX - mx) + e.nz * (camZ - mz)) / cl > -0.26) continue
      const n = Math.max(1, Math.round(e.len / K.yardStep))
      for (let k = 0; k < n; k++) {
        const rand = mulberry32(hashInts(K.seed + 1, pi, yard.length))
        const t = (k + 0.5) / n
        const off = lerpRange(K.yardOff, rand())
        yard.push([
          e.a[0] + (e.b[0] - e.a[0]) * t + e.nx * off,
          e.a[1] + (e.b[1] - e.a[1]) * t + e.nz * off
        ])
      }
    }
  })
  // 天鹅湖西岸步道两侧：每 lakeStep 米、两侧各一个点（靠湖一侧落进水面标记，被掩码挡掉）
  const lake = []
  const lw = pathById(site, "lakeWest").pts
  const lwLen = polyLength(lw)
  for (let s = K.lakeStep / 2; s < lwLen; s += K.lakeStep) {
    const p = pointAt(lw, s)
    for (const side of [-1, 1]) {
      const rand = mulberry32(hashInts(K.seed + 2, Math.round(s), side))
      const off = lerpRange(K.lakeOff, rand()) * side
      lake.push([p.x - p.uz * off, p.z + p.ux * off])
    }
  }
  // 太阳、月亮产房周边：圆心外 ring 米的环上每 10° 一个点
  const nursery = []
  for (const [c, ring] of [
    [SUN.c, K.ring.sun],
    [MOON.c, K.ring.moon]
  ]) {
    for (let a = 0; a < 360; a += 10) {
      const rand = mulberry32(hashInts(K.seed + 3, Math.round(c[0]), a))
      const t = (a + (rand() - 0.5) * 6) * DEG
      const rr = lerpRange(ring, rand())
      nursery.push([c[0] + Math.sin(t) * rr, c[1] - Math.cos(t) * rr])
    }
  }
  plantClumpSet(site, walkways, bufs, stats, yard, "yard", 0)
  plantClumpSet(site, walkways, bufs, stats, lake, "lake", 1)
  plantClumpSet(site, walkways, bufs, stats, nursery, "nursery", 2)
}

/* ---------------- 6 西区竹 ---------------- */

function plantWestBamboo(site, walkways, bufs, stats) {
  const K = WEST_BAMBOO
  // 园界上外法向朝南～朝西、中点在西区的边，按园界顺序接起来当作一条「西南边界」（中间可以不连续）
  const edges = outwardEdges(site.park).filter((e) => {
    const mx = (e.a[0] + e.b[0]) / 2
    const mz = (e.a[1] + e.b[1]) / 2
    const brg = (Math.atan2(e.nx, -e.nz) / DEG + 360) % 360
    return brg >= K.bearing[0] && brg <= K.bearing[1] && !inCoreRect(mx, mz)
  })
  const total = edges.reduce((sum, e) => sum + e.len, 0)
  // 弧长 s 处的边界点：返回所在边与边内参数 t
  const at = (s) => {
    let rest = s
    for (const e of edges) {
      if (rest <= e.len) return { e, t: rest / e.len }
      rest -= e.len
    }
    return null
  }
  // 竹丛 group 丛一组（组内沿边界相隔 gap 米），各组沿整条边界均匀分布，组数按 count 定，
  // 不会挤在边界开头一段；每丛向园内（外法向的反方向）偏 inset 米
  const groups = Math.ceil(K.count / K.group)
  const span = total / groups
  for (let g = 0; g < groups; g++) {
    for (let j = 0; j < K.group && stats.west < K.count; j++) {
      const rand = mulberry32(hashInts(K.seed, g, j))
      const s = (g + 0.5) * span + (j - (K.group - 1) / 2) * K.gap
      const p = at(s + (rand() - 0.5) * 3)
      if (!p) continue
      const { e, t } = p
      const off = lerpRange(K.inset, rand())
      const x = e.a[0] + (e.b[0] - e.a[0]) * t - e.nx * off
      const z = e.a[1] + (e.b[1] - e.a[1]) * t - e.nz * off
      if (!inWest(site, x, z)) continue
      if (tryClump(site, walkways, bufs, x, z, rand, stats.rejected.west)) {
        stats.west++
      }
    }
  }
}

/* ---------------- 入口 ---------------- */

/**
 * 种全园树竹。在 buildWalkways 之后（要避开可走带 F_WALK、按步行路径算竹丛离路距离）、
 * buildLawn 之前调用。竹丛写进 site.bambooBufs，最后每色合成一个几何体加进 site.b。
 * @param {object} site 场地对象
 * @param {Array<{ points: number[][], y: number, width: number, closed: boolean }>} walkways buildWalkways 的返回值
 * @returns {object} 各类数量、各部分三角形数与被拒原因计数（调试用；index.js 不用）
 */
export function plantAll(site, walkways) {
  const bufs = site.bambooBufs
  const reasons = () => ({ mask: 0, walk: 0, view: 0 })
  const stats = {
    tunnel: 0,
    trees: { redPanda: 0, focus: 0, grove: 0, rest: 0, gap: 0 },
    canopy: { total: 0, core: 0 },
    clumps: { yard: 0, lake: 0, nursery: 0 },
    west: 0,
    triangles: {},
    rejected: {
      tunnel: { pave: 0, mask: 0, edge: 0, view: 0 },
      tree: { ...reasons(), props: 0 },
      clump: reasons(),
      west: reasons(),
      canopy: { mask: 0, view: 0, block: 0 }
    }
  }
  const b = site.b
  let t0 = b.triangles
  const tally = (name) => {
    stats.triangles[name] = (stats.triangles[name] || 0) + b.triangles - t0
    t0 = b.triangles
  }
  // 竹丛的三角形最后才合成进 site.b，按丛数计（每丛 n 束 × 8）
  plantTunnels(site, walkways, bufs, stats)
  plantRedPanda(site, walkways, stats)
  tally("trees")
  buildCanopy(site, stats)
  tally("canopy")
  plantTrees(site, walkways, stats)
  tally("trees")
  plantClumps(site, walkways, bufs, stats)
  plantWestBamboo(site, walkways, bufs, stats)
  bufs.forEach((pos, i) => {
    if (pos.length) b.add(fromTriangles(pos), BAMBOO[i])
    // 合成后清空：同一个 site 不会再写竹梢，但免得误调两次时重复合成
    pos.length = 0
  })
  tally("bamboo")
  return stats
}

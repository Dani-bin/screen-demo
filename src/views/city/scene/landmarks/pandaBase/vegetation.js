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
 *     （离步行路径远、不压熊猫视线；整片草地留在画面里会读成一条空带）；
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
 *     F_SOLID | F_WATER | F_YARD | F_TREE，且整条竹根带（各束竹根散开的范围）不压路面（F_PAVE）；
 *     另要求竹根离每条步行路径的可走带边缘 ≥ TUNNEL.edge（路口、急弯内侧的偏移点会贴近别的路，
 *     竹梢会探进那条路的净空）。竹梢不进 4.35 m 头顶净空与分部件净距的估算见 TUNNEL 注释，由步行路径校验兜底；
 *   - 林冠面：三角形不压实体 / 路面 / 活动场 / 水面（核心区部分再加可走带、已种树竹），离园界、水边留出
 *     几何余量；种下后整片打 F_TREE | F_CANOPY，后种的乔木冠盘、竹丛离林冠再留 CANOPY_GAP（不穿插）；
 *   - 乔木、竹丛种下后在栅格上打 F_TREE（乔木按冠半径、竹丛按丛半径）。
 * 熊猫视线：每棵乔木（冠心、半径 1.15 r）、每丛竹（半高处、半径「丛半径 + 半高」）、核心区每块林冠三角形
 * （形心、半径取到最远顶点）落位前调用 site.blocksView，半径再加 VIEW_PAD + VIEW_SLACK（见其注释）。
 *
 * 预算（按当前 OSM 数据，本分区实际 16,783 三角形，景点合计 38,353 ≤ 38,500）：乔木 243 棵 × 32 = 7,776，
 * 竹丛 224 丛 × 4 束 × 8 = 7,168，林冠面 1,839 块。超出时依次减西区竹、补空隙的乔木
 * （WEST_BAMBOO.count、GAP_TREES.count）。
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
import { distToSegment } from "../kit/footprint.js"
import { pushSpindle } from "../kit/plants.js"
import { fromTriangles } from "../kit/shapes.js"
import { FORK_PERCHES, RED_PANDA_AREA, RED_PANDA_HOUSE } from "./enclosures.js"
import { pathById } from "./ground.js"
import { MOON, SUN } from "./nurseries.js"
import {
  BAMBOO,
  C,
  F_CANOPY,
  F_PARK,
  F_PAVE,
  F_SOLID,
  F_TREE,
  F_WALK,
  F_WATER,
  F_YARD,
  LAWN_Y,
  WEST_POOLS,
  sightBlocked
} from "./site.js"

const DEG = Math.PI / 180

/* ---------------- 分区、掩码与公共参数 ---------------- */

/** 核心区西界、北界（调研 3.1：核心区 = 园区 ∩ {x ≥ 6660} ∩ {z ≥ −9440}） */
const CORE_X = 6660
const CORE_Z = -9440

/** 乔木、一般竹丛、核心区林冠面的避让掩码（甬道竹另用 TUNNEL_BLOCK） */
const BLOCK = F_SOLID | F_PAVE | F_WATER | F_WALK | F_TREE | F_YARD
/** 竹林甬道的避让掩码：不含 F_WALK（甬道就贴着路种）与 F_PAVE（另查整条竹根带） */
const TUNNEL_BLOCK = F_SOLID | F_WATER | F_YARD | F_TREE

/** 树冠缘离步行路径可走带边缘的最小水平距离（米），同 walkways.js 的 WALK_CLEAR */
const CROWN_WALK_GAP = 1.5

/*
 * 离林冠面（F_CANOPY 格）的余量（米）：
 *   tree：乔木冠盘半径之外再留的距离（林冠格按格心是否落在三角形里打标记，冠缘可能差出半格）；
 *   clump：竹丛丛心到林冠的最小距离。一般竹丛叶团离丛心最远约 3.8 m（竹根散开 1.2 m + 最高一束 11 m
 *   倾 12° 后最宽一圈 2.6 m），再加 0.7 m 格子量化，竹梢就不会伸到林冠面上方或从里面穿出来。
 * 这两项都用 diskOk 查，diskOk 同时查园界：乔木冠外 1 m、竹丛心 4.5 m 的整个圆盘也必须在园界内
 */
const CANOPY_GAP = { tree: 1, clump: 4.5 }

/*
 * 视线判断的半径余量（米）：
 *   VIEW_PAD 1.5：blocksView 只保护熊猫头部那条线，加余量免得擦过视线挡住身体（任务规格）；
 *   VIEW_SLACK 4：到站机位还会微调（方位约 125° ± 5°、俯仰 28°～35°）。视线绕头部转动，离头部 s 米处
 *   横向挪 s × sin 5°。本分区最高的冠顶约 33.8 m，视线（俯仰 18°～28°）升到这一高度时离头部 59～90 m，
 *   那里方位偏 5° 会横移 5.1～7.8 m，比 VIEW_PAD + VIEW_SLACK（5.5 m）大，所以这个余量不是按几何推出的
 *   保证，而是实测取的：当前机位下树竹离 10 条视线最近 9.93 m；方位 120° / 125° / 130° × 俯仰 28° / 30° /
 *   32° / 35° 共 12 个机位，从 10 只熊猫的头部、头下 1.5 m、头下 3 m 射向机位，树竹命中 0
 *   （不加这 4 m 时 120° / 28° 有 2 处命中）。机位改动超出上述范围时要重跑这项复核
 */
const VIEW_PAD = 1.5
const VIEW_SLACK = 4

/** 乔木冠色：深林色两份 + 城市树四色（密林比城市公园树深一档，深色占一半） */
const GREENS = [...C.forest, ...C.forest, ...THEME.tree.greens]

/*
 * 随机种子：每种用途一个，互不相同（同一个种子派生的随机流在两处用会让两处的取值相关）。
 * 97 小熊猫区乔木，101 乔木候选，102 林团，103 甬道竹，107 点种竹排序，109 林冠顶点，110 林冠对角线，
 * 111 林冠配色，113 西区竹，127 / 131 / 137 点种竹的活动场背侧 / 湖西岸 / 产房周边取点
 */

/*
 * 竹林甬道（设计文档 4.13）：
 *   off 竹根离路中线、step 沿路间距、jitter 沿路位置抖动（± jitter / 2 米，打散整齐的等距排列）、
 *   h 丛高（各束再 × 0.85～1.1）、lean 竿顶向路心倾角、
 *   nearK 路的镜头一侧倾角系数（这一侧倾角收小，竹梢少探到路面上空，从机位看少挡路面与行人）、
 *   along 一丛各束沿路排开的半宽（各束再抖 ±0.4 m）、across 各束竹根的横向范围（+ 为朝路一侧）、
 *   r 丛半径（查栅格、打 F_TREE，按沿路半宽取）、
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
  jitter: 1.6,
  h: [8, 11],
  lean: 14,
  nearK: 0.75,
  along: 2.4,
  across: [-0.8, 0.2],
  r: 2.4,
  n: 4,
  edge: 3.15
}

/*
 * 核心区乔木主体（设计文档 4.13）：count 棵、kit addTree detail 0，冠半径 r、干高 trunkH。
 * 候选点：从核心区西北角起 step 米网格、格内抖动 0.8 格，每格用「种子 + 格号」派生的独立随机流；
 * 小熊猫 2 号活动场里的候选不要（场内只由 plantRedPanda 种，它另查栖架、产房的视线）。
 * 落位顺序按加权随机（键 = 指数随机数 / 权重，从小到大逐个试种，种满 count 为止）：
 *   入口区（南大门 → 铜像一线 entry 米以内）与太阳产房周边（离圆心 sun 米以内）权重 focus
 *   （远大于林团，这两区先种满）；林团（groves 个圆，半径 grove 米，按种子 groveSeed 撒在中近景的空地上，
 *   见 groveCircles）里权重 groveW；其余 rest（不为 0：林团之间也零星有树）；
 *   离南大门 > far 米的权重再 × farK（排得更靠后，预算紧时先少种它们）。
 */
const TREES = {
  seed: 101,
  groveSeed: 102,
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

/*
 * 补空隙的乔木：主体种完后，剩下的候选点按所在处的空地净距（离最近的实体 / 路 / 水 / 可走带 / 活动场 /
 * 已种树竹与林冠面的距离）从大到小试种 count 棵；离南大门 > far 米的净距按 farK 折算（画面里小）。
 * 净距场是种前算一次的静态场，同一块空地会连种几棵，读成一小片林子而不是均匀散点。
 * count 按预算余量取：景点合计 ≤ 38,500（给最终审查留 ≥ 1,500）减去其余各项后能放下的棵数
 */
const GAP_TREES = { count: 73, farK: 0.6 }

/*
 * 小熊猫 2 号活动场的林下乔木（调研 4.11「林下」）：场内 step 米网格抖动取点，按种子打乱后试种 count 棵。
 * 冠盘不压矮墙（墙线打了 F_SOLID）、3 座树杈栖架与小熊猫产房（site.solid 登记）；冠半径取 r（比园区
 * 乔木小一档，场地窄）。冠底离草地 trunkH − 0.03 r ≥ 4.7 m，高过树杈栖架顶（perchTop 3.6 m），不会压住栖架。
 * 另外树冠不挡住栖架顶、产房顶望向到站机位的线（site.js 的 sightBlocked，余量 propPad 米）：
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
 *   湖西岸（lakeWest 步道两侧 lakeOff 米，靠湖一侧落水被掩码挡掉）、产房周边（两座产房外 ring 米的环上，
 *   每 10° 一个点，方位再抖 ±ringJitter / 2 度，免得排成正圆）；
 *   seed 候选排序，yardSeed / lakeSeed / ringSeed 三处取点
 */
const CLUMPS = {
  seed: 107,
  yardSeed: 127,
  lakeSeed: 131,
  ringSeed: 137,
  r: 1.8,
  h: [7, 10],
  n: 4,
  clear: 4.5,
  quota: { yard: 30, lake: 12, nursery: 18 },
  yardOff: [7, 12],
  yardStep: 9,
  lakeOff: [8.5, 12],
  lakeStep: 9,
  ring: { sun: [50, 68], moon: [42, 60] },
  ringJitter: 6
}

/*
 * 林冠起伏面（设计文档 3 节 / 4.13 最终决策：40 m 网格三角网、顶点高 8～16 m 随机）：
 *   网格线对齐核心区西界与北界（x = 6660、z = −9440 落在网格线上），顶点在平面上再抖动 ±jitter 米
 *   （打散规则的网格线与锯齿状的分区边，不加三角形）；高度 h 为离林下草地的高度。
 *   顶点「在林冠里」：西区园界内，或核心区里的开阔草地顶点（见 OPEN）。只留三个顶点都在林冠里的三角形，并且
 *     - 覆盖的格子（2 m 取样）没有实体 / 路面 / 活动场 / 水面、都在园界内（核心区部分掩码再加可走带、已种树竹；
 *       核心区西界上的矮房 1226059870 有一半在西区，免得把楼埋进林冠里）；
 *     - 离园界 ≥ parkGap、离各水面（西区两池、天鹅湖、东北小湖）≥ waterGap（几何距离，比 2 m 取样准；
 *       余量盖过 1 m 栅格量化与水面外扩 1 m 的标记，林冠不伸出园界、不盖水面）。
 *   林冠面的边缘顶点（只被一个三角形用到的边的端点）压到 edgeH：边缘斜落到林下，
 *   不悬空成一张「浮在 8～16 m 的毯子」（机位斜看时边缘下面会露出一条草地）。三个顶点都在边缘上的三角形
 *   会整块压成离草地 edgeH 的平板，反复去掉直到没有（见 dropFlatSlabs）。
 *   seed 顶点，flipSeed 每格对角线方向，colorSeed 每块配色
 */
const CANOPY = {
  seed: 109,
  flipSeed: 110,
  colorSeed: 111,
  step: 40,
  h: [8, 16],
  jitter: 9,
  edgeH: 1.5,
  parkGap: 1.5,
  waterGap: 2.5,
  // 林冠面色：深林色为主，城市树色只取两档较深的（整片斜面受光强，亮色会把林冠读成一张揉皱的纸）
  colors: [...C.forest, ...C.forest, THEME.tree.greens[2], THEME.tree.greens[0]]
}

/*
 * 林冠面延伸进核心区的开阔草地：
 *   核心区顶点的空地净距（到 BLOCK 标记或园界外的距离，种完甬道竹与小熊猫区乔木后算）≥ vertex 米、
 *   离南大门 ≥ far 米（只铺远处：近景里一整块起伏面读成土丘，近处空地交给乔木）、离太阳产房圆心
 *   ≥ sunClear 米（乔木优先区）、不在小熊猫 2 号活动场里，才算在林冠里；
 *   核心区三角形再查熊猫视线，并按连通块（共用顶点）筛：块与保留下来的西区林冠共用顶点（把西区林冠接着
 *   铺过分区线），或块里最大净距 ≥ wide 米（草地宽约 80 m 以上）且不少于 minTris 个三角形，才保留。
 *   按当前 OSM 数据实测保留 5 块（数据重拉、园路或活动场改动后会变）：与西区林冠相连的 3 块
 *   （别墅群西北、1 号别墅一带那条空带 103 个三角形，核心区西界、北缘各一小块），独立的大块 2 块
 *   （天鹅湖以东的园区东臂 107 个、月亮产房东北的北缘空地 29 个）。
 *   独立的小块（几个三角形）多半是两排树、两条路之间的夹缝，铺上去像一块补丁，所以要求宽度与块大小
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
 *   count 丛按 group 丛一组（组内相隔 gap 米）沿整条线均匀分布，每丛沿线抖 ±jitter / 2 米；
 *   每个位置依次试 shifts（沿线错开）× insets（向园内偏）里的候选，第一个合格的种下：
 *   林冠面已占满西区大部分，边界与林冠之间的草地宽窄不一，单一偏距常落进林冠或落到园界外。
 *   insets 末尾的 4 m 实际上从不成功（tryClump 要求离林冠 4.5 m 的圆盘整个在园界内），但 tryClump 先从本丛的
 *   随机流里抽丛高再做检查，这次失败的尝试也消耗一个随机数；删掉它，之后在同一位置种下的竹丛丛高、
 *   各束形状都会变（几何哈希变）。要清掉它，得连同「检查通过后才抽随机数」一起改，作为一次几何改动单独做。
 *   丛半径、高、束数同点种竹
 */
const WEST_BAMBOO = {
  seed: 113,
  count: 40,
  group: 3,
  gap: 9,
  jitter: 3,
  bearing: [170, 280],
  insets: [6, 9, 12, 15, 4],
  shifts: [0, 12, -12, 24, -24]
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
 * 点到折线（closed 时含末点回到首点的一段）的最近点与水平距离（甬道竹求倾向用）。
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
    const n = w.closed ? w.points.length : w.points.length - 1
    for (let i = 0; i < n; i++) {
      const d = distToSegment(
        x,
        z,
        w.points[i],
        w.points[(i + 1) % w.points.length]
      )
      best = Math.min(best, d - w.width / 2)
    }
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
 * 沿折线按弧长取点：返回弧长 s 处的点与所在段的单位方向 { x, z, ux, uz }（s 超出两端时夹到端点）。
 * 长度为零的段跳过；落在末端时沿用最后一段非零长段的方向
 */
function pointAt(pts, s) {
  let rest = Math.max(0, s)
  let ux = 1
  let uz = 0
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i]
    const [bx, bz] = pts[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    if (len < 1e-9) continue
    ux = (bx - ax) / len
    uz = (bz - az) / len
    if (rest <= len) {
      return { x: ax + ux * rest, z: az + uz * rest, ux, uz }
    }
    rest -= len
  }
  const [x, z] = pts[pts.length - 1]
  return { x, z, ux, uz }
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

/** 两条线段（[x, z] 端点）之间的最短水平距离：相交时为 0 */
function segSegDist(a, b, c, d) {
  const cross = (o, p, q) =>
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
  const d1 = cross(a, b, c)
  const d2 = cross(a, b, d)
  const d3 = cross(c, d, a)
  const d4 = cross(c, d, b)
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0
  return Math.min(
    distToSegment(a[0], a[1], c, d),
    distToSegment(b[0], b[1], c, d),
    distToSegment(c[0], c[1], a, b),
    distToSegment(d[0], d[1], a, b)
  )
}

/**
 * 三角形（[x, z] 三点）的边与多边形的边之间的最短距离；只算包围盒外扩 limit 后与三角形相交的多边形边，
 * 都不相交时返回 Infinity（调用方只关心是否 < limit）
 */
function edgeGap(tri, poly, limit) {
  const xs = tri.map((p) => p[0])
  const zs = tri.map((p) => p[1])
  const minX = Math.min(...xs) - limit
  const maxX = Math.max(...xs) + limit
  const minZ = Math.min(...zs) - limit
  const maxZ = Math.max(...zs) + limit
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    if (Math.max(p[0], q[0]) < minX || Math.min(p[0], q[0]) > maxX) continue
    if (Math.max(p[1], q[1]) < minZ || Math.min(p[1], q[1]) > maxZ) continue
    for (let k = 0; k < 3; k++) {
      best = Math.min(best, segSegDist(tri[k], tri[(k + 1) % 3], p, q))
    }
  }
  return best
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
 *     在 ±along 米内均匀排开（一丛铺满大半个间距，两侧读成连续的竹墙），横向在 TUNNEL.across 范围内
 *     （+ 为朝路一侧：竹根不往路面挤），叶团半径为高的 0.11～0.14（比一般竹丛胖），竿顶朝 lean 方向倾
 *     deg × 0.85～1.15，方向左右抖 ±0.25 rad（同草堂花径 lean 的写法，抖动收窄：竹梢要越过路面上空、
 *     又不能压低到净空里）；
 *   - 否则为一般竹丛：各束竹根在丛心 0.3～1.2 m 内随机散开，从丛心向外微倾 4°～12°。
 * 顶点写进 bufs[颜色下标]（BAMBOO 四色随机取一）。
 */
function addBamboo(bufs, x, y, z, rand, h, n, lean) {
  const [a0, a1] = TUNNEL.across
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
      const across = a0 + rand() * (a1 - a0)
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
 * 一般竹丛（核心区点种、西区竹共用）的落位检查与种植：掩码与园界（diskOk 扫查）、离林冠面 CANOPY_GAP.clump、
 * 离可走带边缘、熊猫视线；通过就种下并打 F_TREE。返回是否种下。
 */
function tryClump(site, walkways, bufs, x, z, rand) {
  const K = CLUMPS
  const { grid } = site
  const h = lerpRange(K.h, rand())
  if (!diskOk(grid, x, z, K.r, BLOCK)) return false
  if (!diskOk(grid, x, z, CANOPY_GAP.clump, F_CANOPY)) return false
  if (walkEdgeDist(x, z, walkways) < K.clear) return false
  if (blocks(site, x, LAWN_Y + h / 2, z, K.r + h / 2)) return false
  addBamboo(bufs, x, LAWN_Y, z, rand, h, K.n, null)
  grid.disk(x, z, K.r, F_TREE)
  return true
}

/* ---------------- 1 竹林甬道 ---------------- */

/**
 * 甬道竹一丛的竹根带（各束竹根可能落到的范围：沿路 ±(along + 0.4)、横向 TUNNEL.across）是否压到路面：
 * 按 0.5 m 取样查 F_PAVE。路口处丛心离路远，但沿路散开的竹根会伸进相邻园路的路面
 */
function rootBandOnPave(grid, x, z, dx, dz) {
  const K = TUNNEL
  const half = K.along + 0.4
  for (let u = -half; u <= half + 1e-9; u += 0.5) {
    for (let v = K.across[0]; v <= K.across[1] + 1e-9; v += 0.5) {
      if (grid.get(x + dx * v - dz * u, z + dz * v + dx * u) & F_PAVE) {
        return true
      }
    }
  }
  return false
}

/**
 * 第 2 条步行路径（loop 去掉末点，同 walkways.js）的西半段（按弧长后一半）与第 3 条（villas）两侧，
 * 每 step 米、两侧各一丛，竹根离中线 off 米；竿顶倾向竹根到路中线的最近点（折点处也朝路心）。
 */
function plantTunnels(site, walkways, bufs) {
  const K = TUNNEL
  const { grid } = site
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
        const p = pointAt(line, s + (rand() - 0.5) * K.jitter)
        // 法向 (−uz, ux)，side 选左右两侧
        const x = p.x - p.uz * K.off * side
        const z = p.z + p.ux * K.off * side
        if (!diskOk(grid, x, z, K.r, TUNNEL_BLOCK)) continue
        if (walkEdgeDist(x, z, walkways) < K.edge) continue
        // 倾向：竹根 → 路中线最近点
        const q = nearestOnLine(x, z, line)
        const dx = (q.x - x) / q.d
        const dz = (q.z - z) / q.d
        if (rootBandOnPave(grid, x, z, dx, dz)) continue
        const h = lerpRange(K.h, rand())
        if (blocks(site, x, LAWN_Y + h / 2, z, K.r + h / 2)) continue
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
      }
    }
  })
}

/* ---------------- 乔木公共 ---------------- */

/**
 * 一棵乔木的落位检查与种植：冠盘按 0.5 m 取样扫掩码与园界、冠盘外再留 CANOPY_GAP.tree 不碰林冠面、
 * 冠缘离可走带边缘 ≥ CROWN_WALK_GAP、熊猫视线；通过就种下（kit addTree detail 0）并按冠半径打 F_TREE。
 * c 为 { x, z, r, trunkH, color, yaw }。返回是否种下。
 */
function tryTree(site, walkways, c) {
  const { grid } = site
  if (!diskOk(grid, c.x, c.z, c.r, BLOCK)) return false
  if (!diskOk(grid, c.x, c.z, c.r + CANOPY_GAP.tree, F_CANOPY)) return false
  if (walkEdgeDist(c.x, c.z, walkways) - c.r < CROWN_WALK_GAP) return false
  // 冠心：树根以上 trunkH + 0.95 r（kit addTree）
  const cy = LAWN_Y + c.trunkH + 0.95 * c.r
  if (blocks(site, c.x, cy, c.z, 1.15 * c.r)) return false
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

function plantRedPanda(site, walkways) {
  const R = RED_PANDA_TREES
  const bb = polygonBounds(RED_PANDA_AREA)
  const cam = site.cameraPos()
  // 受保护的点：三座栖架顶、产房屋顶中心
  const props = [
    ...FORK_PERCHES.map(([x, z]) => ({ x, y: LAWN_Y + R.perchTop, z })),
    {
      x: RED_PANDA_HOUSE.at[0],
      y: RED_PANDA_HOUSE.top,
      z: RED_PANDA_HOUSE.at[1]
    }
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
  let planted = 0
  for (const c of cands) {
    if (planted >= R.count) break
    const cy = LAWN_Y + c.trunkH + 0.95 * c.r
    const rr = 1.15 * c.r + R.propPad
    if (props.some((p) => sightBlocked(p, cam, c.x, cy, c.z, rr))) continue
    if (tryTree(site, walkways, c)) planted++
  }
}

/* ---------------- 3 林冠起伏面（西区 + 核心区远处空地） ---------------- */

/** 园界点内判断的分桶高度（米） */
const PARK_BIN = 16
/** 各多边形的分桶边表（以多边形数组本身为键） */
const binCache = new WeakMap()

/**
 * 点是否在园区多边形内：与 utils.js 的 pointInPolygon 同一射线法判定式，只是先按 z 把边分桶。
 * 射线法里只有「一端 z > 点、另一端 z ≤ 点」的边会翻转结果，这样的边 z 范围 [min, max) 必含点的 z，
 * 一定登记在点所在的桶里，所以参与翻转的边与原判定完全相同，结果逐位一致。
 * 林冠网格顶点、西区竹候选点要对 165 点园界查上万次，逐边扫是林冠构建里最慢的一步
 */
function inPark(site, x, z) {
  const poly = site.park
  let t = binCache.get(poly)
  if (!t) {
    const b = polygonBounds(poly)
    const nb = Math.floor((b.maxZ - b.minZ) / PARK_BIN) + 1
    const bins = Array.from({ length: nb }, () => [])
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i]
      const [xj, zj] = poly[j]
      const lo = Math.floor((Math.min(zi, zj) - b.minZ) / PARK_BIN)
      const hi = Math.floor((Math.max(zi, zj) - b.minZ) / PARK_BIN)
      for (let k = lo; k <= hi; k++) bins[k].push([xi, zi, xj, zj])
    }
    t = { minZ: b.minZ, nb, bins }
    binCache.set(poly, t)
  }
  const k = Math.floor((z - t.minZ) / PARK_BIN)
  if (!(k >= 0 && k < t.nb)) return false
  let inside = false
  for (const [xi, zi, xj, zj] of t.bins[k]) {
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/** 点在西区园界内（园区多边形内、且不在核心区矩形里） */
function inWest(site, x, z) {
  return !inCoreRect(x, z) && inPark(site, x, z)
}

/**
 * 三角形（xz 平面）覆盖的格子里是否有 mask 标记、或有格子在园界外：按 2 m 步长扫包围盒，
 * 取落在三角形内的点（粗查；园界与水边另有几何余量检查，见 triangleClear）
 */
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
      const f = grid.get(x, z)
      if ((f & mask || !(f & F_PARK)) && pointInPolygon(x, z, tri)) return true
    }
  }
  return false
}

/** 多边形包围盒缓存（以多边形数组本身为键）：林冠三角形逐个查水面时不必每次重算 */
const boundsCache = new WeakMap()
function cachedBounds(poly) {
  let b = boundsCache.get(poly)
  if (!b) {
    b = polygonBounds(poly)
    boundsCache.set(poly, b)
  }
  return b
}

/**
 * 三角形离园界 ≥ CANOPY.parkGap（三点已在园内，再看边距）、离各水面 ≥ CANOPY.waterGap
 * （不相交、互不包含、边距够）。水面：西区两池、天鹅湖、东北小湖。
 * 包围盒与三角形包围盒在 x 或 z 方向上相隔超过 waterGap 的水面直接跳过：两者的点都至少相隔这么远，
 * 后面三项检查一项也不会成立，判定结论不变
 */
function triangleClear(site, tri) {
  const K = CANOPY
  if (edgeGap(tri, site.park, K.parkGap) < K.parkGap) return false
  const g = K.waterGap
  const tx0 = Math.min(tri[0][0], tri[1][0], tri[2][0])
  const tx1 = Math.max(tri[0][0], tri[1][0], tri[2][0])
  const tz0 = Math.min(tri[0][1], tri[1][1], tri[2][1])
  const tz1 = Math.max(tri[0][1], tri[1][1], tri[2][1])
  for (const w of [...WEST_POOLS, site.lakes.swan, site.lakes.ne]) {
    const b = cachedBounds(w)
    if (tx0 - b.maxX > g || b.minX - tx1 > g) continue
    if (tz0 - b.maxZ > g || b.minZ - tz1 > g) continue
    if (tri.some(([x, z]) => pointInPolygon(x, z, w))) return false
    if (w.some(([x, z]) => pointInPolygon(x, z, tri))) return false
    if (edgeGap(tri, w, K.waterGap) < K.waterGap) return false
  }
  return true
}

/** 核心区顶点是否算开阔草地（见 OPEN 注释）；clear 为空地净距场 */
function openCore(site, clear, x, z) {
  const O = OPEN
  const { spot } = site.ctx
  if (!inCoreRect(x, z) || !inPark(site, x, z)) return false
  if (clear(x, z) < O.vertex) return false
  if (Math.hypot(x - spot.x, z - spot.z) < O.far) return false
  if (Math.hypot(x - SUN.c[0], z - SUN.c[1]) < O.sunClear) return false
  return !pointInPolygon(x, z, RED_PANDA_AREA)
}

/**
 * 林冠网格顶点：以核心区西北角 (CORE_X, CORE_Z) 为原点的 step 米网格（i、k 为网格号，负号在西、北），
 * 每个顶点独立随机流（平面抖动 x、z，高度），并标出是否在西区、是否算核心区开阔草地。
 * @returns {{ verts: object[], i0: number, i1: number, k0: number, k1: number, V: Function }}
 */
function canopyVertices(site, clear) {
  const K = CANOPY
  const pb = polygonBounds(site.park)
  const i0 = Math.floor((pb.minX - CORE_X) / K.step)
  const i1 = Math.ceil((pb.maxX - CORE_X) / K.step)
  const k0 = Math.floor((pb.minZ - CORE_Z) / K.step)
  const k1 = Math.ceil((pb.maxZ - CORE_Z) / K.step)
  const ni = i1 - i0 + 1
  const verts = []
  for (let k = k0; k <= k1; k++) {
    for (let i = i0; i <= i1; i++) {
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
  return { verts, i0, i1, k0, k1, V }
}

/**
 * 候选林冠三角形：每格两个三角形（对角线方向按格号播种，避免整片同向的斜纹），三个顶点都在林冠里、
 * 不压掩码格、离园界与水面够远；伸进核心区的（有核心区顶点）掩码加严并查熊猫视线。
 * @returns {{ west: object[], core: object[] }} 各为 [{ t: 顶点下标三元组, color: 配色下标 }]
 */
function canopyCandidates(site, mesh) {
  const K = CANOPY
  const { grid } = site
  const { verts, i0, i1, k0, k1, V } = mesh
  const west = []
  const core = []
  for (let k = k0; k < k1; k++) {
    for (let i = i0; i < i1; i++) {
      const q = [V(i, k), V(i + 1, k), V(i + 1, k + 1), V(i, k + 1)]
      const flip = hashInts(K.flipSeed, i, k) & 1
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
        const inCore = vs.some((v) => v.core)
        const [a, b, c] = vs
        const mask = inCore ? BLOCK : F_SOLID | F_PAVE | F_YARD | F_WATER
        if (triangleHits(grid, a, b, c, mask)) return
        if (
          !triangleClear(
            site,
            vs.map((v) => [v.x, v.z])
          )
        )
          return
        if (inCore) {
          const cx = (a.x + b.x + c.x) / 3
          const cy = (a.y + b.y + c.y) / 3
          const cz = (a.z + b.z + c.z) / 3
          const rr = Math.max(
            ...vs.map((v) => Math.hypot(v.x - cx, v.y - cy, v.z - cz))
          )
          if (blocks(site, cx, cy, cz, rr)) return
        }
        const color = hashInts(K.colorSeed, i, k, ti) % K.colors.length
        ;(inCore ? core : west).push({ t, color })
      })
    }
  }
  return { west, core }
}

/**
 * 核心区林冠三角形按连通块（共用顶点）筛选（见 OPEN 注释）。
 * @param {object[]} cores 核心区候选三角形 [{ t }]
 * @param {object[]} verts 林冠网格顶点（取 clear 净距）
 * @param {Set<number>} westUsed 保留下来的西区三角形用到的顶点下标
 * @returns {object[]} 保留的核心区三角形
 */
function keepCoreBlocks(cores, verts, westUsed) {
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
  cores.forEach((tri, i) => {
    const root = find(i)
    if (!groups.has(root)) groups.set(root, { tris: [], wide: 0, west: false })
    const g = groups.get(root)
    g.tris.push(tri)
    for (const j of tri.t) {
      if (westUsed.has(j)) g.west = true
      else if (!verts[j].west) g.wide = Math.max(g.wide, verts[j].clear)
    }
  })
  const keep = []
  for (const g of groups.values()) {
    if (g.west || (g.wide >= O.wide && g.tris.length >= O.minTris)) {
      keep.push(...g.tris)
    }
  }
  return keep
}

/** 三角形集合的边界顶点：只被一个三角形用到的边的两个端点 */
function boundaryVertices(tris) {
  const edgeUse = new Map()
  const edgeKey = (p, q) => (p < q ? `${p},${q}` : `${q},${p}`)
  for (const { t } of tris) {
    for (let e = 0; e < 3; e++) {
      const key = edgeKey(t[e], t[(e + 1) % 3])
      edgeUse.set(key, (edgeUse.get(key) || 0) + 1)
    }
  }
  const out = new Set()
  for (const [key, n] of edgeUse) {
    if (n === 1) for (const j of key.split(",")) out.add(Number(j))
  }
  return out
}

/**
 * 去掉「平板」：三个顶点都在边界上的三角形压低后整块离草地 edgeH，读成悬空的平板。
 * 去掉一批后边界会变，可能又冒出新的平板，反复到没有为止（窄到一两格宽的林冠条会整条去掉）。
 * @returns {{ kept: object[], boundary: Set<number> }}
 */
function dropFlatSlabs(tris) {
  let kept = tris
  for (;;) {
    const boundary = boundaryVertices(kept)
    const next = kept.filter(({ t }) => !t.every((j) => boundary.has(j)))
    if (next.length === kept.length) return { kept, boundary }
    kept = next
  }
}

/**
 * 写出林冠面：边界顶点压到 edgeH，按色分组写顶点（法线朝上：xz 平面上逆着 +Y 看为逆时针）合成进 site.b；
 * 每块在栅格上打 F_TREE | F_CANOPY（后种的乔木、竹丛避开并留出 CANOPY_GAP）
 */
function emitCanopy(site, verts, kept, boundary) {
  const K = CANOPY
  for (const j of boundary) verts[j].y = LAWN_Y + K.edgeH
  const bufs = K.colors.map(() => [])
  for (const { t, color } of kept) {
    let [a, b, c] = t.map((j) => verts[j])
    if ((b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) < 0) {
      ;[b, c] = [c, b]
    }
    bufs[color].push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    site.grid.fillPoly(
      [
        [a.x, a.z],
        [b.x, b.z],
        [c.x, c.z]
      ],
      F_TREE | F_CANOPY
    )
  }
  bufs.forEach((pos, ci) => {
    if (pos.length) site.b.add(fromTriangles(pos), K.colors[ci])
  })
}

/**
 * 林冠起伏面。三角形的取舍分三步：
 *   1 西区候选先去平板，得到稳定的西区林冠（之后再并进核心区三角形，西区三角形的边界顶点只会减少，
 *     不会再变成平板）；
 *   2 核心区候选按连通块筛（只认与第 1 步留下的西区三角形共用的顶点，见 keepCoreBlocks）；
 *   3 并起来再去平板。去掉的核心区平板可能把某块与西区林冠断开，所以 2、3 两步反复做到核心区三角形不再变。
 */
function buildCanopy(site) {
  // 空地净距：此时已种甬道竹、小熊猫区乔木，已登记全部实体、路面、水面、活动场、可走带
  const mesh = canopyVertices(site, clearanceField(site, BLOCK))
  const { west, core } = canopyCandidates(site, mesh)
  const westKept = dropFlatSlabs(west).kept
  const westUsed = new Set(westKept.flatMap(({ t }) => t))
  let coreKept = core
  for (;;) {
    const blocksKept = new Set(keepCoreBlocks(coreKept, mesh.verts, westUsed))
    const { kept } = dropFlatSlabs([...westKept, ...blocksKept])
    const next = kept.filter((tri) => blocksKept.has(tri))
    if (next.length === coreKept.length) break
    coreKept = next
  }
  const { kept, boundary } = dropFlatSlabs([...westKept, ...coreKept])
  emitCanopy(site, mesh.verts, kept, boundary)
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
  const rand = mulberry32(T.groveSeed)
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
 * 乔木候选点的权重（见 TREES 注释）。statue 为铜像（入园主路 entry 的末点，即第 1 条步行路径终点）
 */
function treeWeight(site, groves, statue, x, z) {
  const T = TREES
  const { spot } = site.ctx
  const gate = [spot.x, spot.z]
  const entry = distToSegment(x, z, gate, statue)
  const sun = Math.hypot(x - SUN.c[0], z - SUN.c[1])
  let w = T.rest
  if (entry < T.entry || (sun > T.sun[0] && sun < T.sun[1])) w = T.focus
  else if (groves.some(([gx, gz, r]) => Math.hypot(x - gx, z - gz) < r)) {
    w = T.groveW
  }
  if (Math.hypot(x - gate[0], z - gate[1]) > T.far) w *= T.farK
  return w
}

/** 核心区乔木：主体按加权随机种 TREES.count 棵，再按空隙大小补种 GAP_TREES.count 棵 */
function plantTrees(site, walkways) {
  const T = TREES
  const { grid } = site
  const { spot } = site.ctx
  const pb = polygonBounds(site.park)
  const groves = groveCircles(site)
  const statue = pathById(site, "entry").pts.at(-1)
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
      if (pointInPolygon(x, z, RED_PANDA_AREA)) continue
      // 加权随机排序（Efraimidis–Spirakis）：键 = −ln(1 − u) / 权重，越小越先种
      const key = -Math.log(1 - u) / treeWeight(site, groves, statue, x, z)
      cands.push({ x, z, r, trunkH, color, yaw, key, done: false })
    }
  }
  cands.sort((a, b) => a.key - b.key)
  let planted = 0
  for (const c of cands) {
    if (planted >= T.count) break
    if (!tryTree(site, walkways, c)) continue
    c.done = true
    planted++
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
  planted = 0
  for (const { c } of rest) {
    if (planted >= G.count) break
    if (tryTree(site, walkways, c)) planted++
  }
}

/* ---------------- 5 核心区点种竹 ---------------- */

/** 活动场轮廓：草地洞里除去湖、池（其余都是 site.addYard 登记的活动场） */
function yardPolys(site) {
  const water = new Set([site.lakes.swan, site.lakes.ne, ...WEST_POOLS])
  return site.lawnHoles.filter((h) => !water.has(h))
}

/**
 * 候选点按「种子 + 来源 + 序号」派生的随机键打乱后逐个试种，种满 quota 丛为止。cands 为 [x, z] 数组
 */
function plantClumpSet(site, walkways, bufs, cands, quota, si) {
  const order = cands.map(([x, z], i) => {
    const rand = mulberry32(hashInts(CLUMPS.seed, si, i))
    return { x, z, key: rand(), rand }
  })
  order.sort((a, b) => a.key - b.key)
  let planted = 0
  for (const c of order) {
    if (planted >= quota) break
    if (tryClump(site, walkways, bufs, c.x, c.z, c.rand)) planted++
  }
}

function plantClumps(site, walkways, bufs) {
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
        const rand = mulberry32(hashInts(K.yardSeed, pi, yard.length))
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
      const rand = mulberry32(hashInts(K.lakeSeed, Math.round(s), side))
      const off = lerpRange(K.lakeOff, rand()) * side
      lake.push([p.x - p.uz * off, p.z + p.ux * off])
    }
  }
  // 太阳、月亮产房周边：圆心外 ring 米的环上每 10° 一个点（方位抖 ±ringJitter / 2 度）
  const nursery = []
  for (const [c, ring] of [
    [SUN.c, K.ring.sun],
    [MOON.c, K.ring.moon]
  ]) {
    for (let a = 0; a < 360; a += 10) {
      const rand = mulberry32(hashInts(K.ringSeed, Math.round(c[0]), a))
      const t = (a + (rand() - 0.5) * K.ringJitter) * DEG
      const rr = lerpRange(ring, rand())
      nursery.push([c[0] + Math.sin(t) * rr, c[1] - Math.cos(t) * rr])
    }
  }
  plantClumpSet(site, walkways, bufs, yard, K.quota.yard, 0)
  plantClumpSet(site, walkways, bufs, lake, K.quota.lake, 1)
  plantClumpSet(site, walkways, bufs, nursery, K.quota.nursery, 2)
}

/* ---------------- 6 西区竹 ---------------- */

function plantWestBamboo(site, walkways, bufs) {
  const K = WEST_BAMBOO
  // 园界上外法向朝南～朝西、中点在西区的边，按园界顺序接起来当作一条「西南边界」（中间可以不连续）
  const edges = outwardEdges(site.park).filter((e) => {
    const mx = (e.a[0] + e.b[0]) / 2
    const mz = (e.a[1] + e.b[1]) / 2
    const brg = (Math.atan2(e.nx, -e.nz) / DEG + 360) % 360
    return brg >= K.bearing[0] && brg <= K.bearing[1] && !inCoreRect(mx, mz)
  })
  // 没有合乎条件的边（园界数据变了）就不种：下面按弧长取点要用到边
  if (!edges.length) return
  const total = edges.reduce((sum, e) => sum + e.len, 0)
  // 弧长 s 处的边界点（s 先夹到 [0, total]）：返回所在边与边内参数 t
  const at = (s) => {
    let rest = Math.max(0, Math.min(total, s))
    for (const e of edges) {
      if (rest <= e.len) return { e, t: rest / e.len }
      rest -= e.len
    }
    const e = edges[edges.length - 1]
    return { e, t: 1 }
  }
  // 竹丛 group 丛一组（组内沿边界相隔 gap 米），各组沿整条边界均匀分布，组数按 count 定，
  // 不会挤在边界开头一段；每个位置按 shifts × insets 依次试，第一个合格的种下
  const groups = Math.ceil(K.count / K.group)
  const span = total / groups
  let planted = 0
  for (let g = 0; g < groups; g++) {
    for (let j = 0; j < K.group && planted < K.count; j++) {
      const rand = mulberry32(hashInts(K.seed, g, j))
      const s0 =
        (g + 0.5) * span +
        (j - (K.group - 1) / 2) * K.gap +
        (rand() - 0.5) * K.jitter
      tries: for (const shift of K.shifts) {
        const { e, t } = at(s0 + shift)
        for (const inset of K.insets) {
          const x = e.a[0] + (e.b[0] - e.a[0]) * t - e.nx * inset
          const z = e.a[1] + (e.b[1] - e.a[1]) * t - e.nz * inset
          if (!inWest(site, x, z)) continue
          if (tryClump(site, walkways, bufs, x, z, rand)) {
            planted++
            break tries
          }
        }
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
 */
export function plantAll(site, walkways) {
  const bufs = site.bambooBufs
  plantTunnels(site, walkways, bufs)
  plantRedPanda(site, walkways)
  buildCanopy(site)
  plantTrees(site, walkways)
  plantClumps(site, walkways, bufs)
  plantWestBamboo(site, walkways, bufs)
  bufs.forEach((pos, i) => {
    if (pos.length) site.b.add(fromTriangles(pos), BAMBOO[i])
    // 合成后清空：同一个 site 不会再写竹梢，但免得误调两次时重复合成
    pos.length = 0
  })
}

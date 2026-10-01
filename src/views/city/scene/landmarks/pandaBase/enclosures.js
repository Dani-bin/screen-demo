/*
 * 熊猫基地 · 熊猫别墅、产房、栖架与熊猫
 * ----------------------------------------------------------
 * 规格：设计文档 4.8（别墅通用模板与 7 座别墅表）、4.9（栖架）、4.10 / 4.11（产房、小熊猫区、686460737）、
 * 4.12（熊猫：按决策 10 只，摆放表去掉第 8、12 行）。照片见 yards.js 文件头。
 * 分文件：yards.js 为活动场构件（院墙、栖架、水池、塑石兽舍、熊猫等），nurseries.js 为太阳 / 月亮产房与吊桥，
 * 本文件为入口、7 座别墅、小熊猫区（2 号活动场矮墙、树杈栖架、小熊猫产房）与 686460737 塑石兽舍。
 *
 * 别墅通用模板（4.8）：下沉活动场（YARD_Y 0.3，site.addYard 登记草地洞）四周院墙 + 墙顶木栏 + 绿篱；
 * 兽舍放在离机位较远的一端；场内一座双层原木栖架、一个小水池、2 棵套竹筒的乔木、裸土与原木排斑块、
 * 一丛矮竹；坐姿熊猫脸朝机位。3～7 号兽舍为塑石仿岩（22 × 10 × 7.5），1、2 号按 OSM 轮廓挤出。
 *
 * 活动场形状与文档的出入（文档的地块按 OSM 全部园路围合求得，模型只铺了 ground.js 的主要园路，
 * 文档建议的活动场有几处压到这些园路；都按「不压园路、留够人流净距」收改，见各别墅常量注释）：
 *   - 7 号：文档 100 × 36 @142° 的矩形横跨环路 loop 的拐角，改成环路拐角西南侧的 L 形（楔形地 + 南侧条带）；
 *   - 3 号：文档 66 × 72 @48° 的北角越过别墅步道，缩成 60 × 56、中心南移；
 *   - 5 号：中心东移 11 m（西角原本压到别墅步道）。
 * 净距：活动场边线离主路（loop、science 等宽 4.5 m）中线 ≥ 5.2 m、离次级步道中线 ≥ 4.4 m，
 * 绿篱外沿（边线外 1.46 m）都在步行路径可走带外 0.86 m（人流身体净距）以外。
 *
 * 每个活动场在构建时自检布置（checkLayout）：构件超出活动场或彼此压叠时 console.warn，不阻断构建。
 */
import { THEME } from "../../theme.js"
import { GROUND_Y } from "../../terrain.js"
import { pointInPolygon } from "../../utils.js"
import { circlePolygon, insetPolygon, rectPolygon } from "../kit/footprint.js"
import {
  facadeBands,
  flatBlock,
  flatFace,
  outlineOf,
  sideWalls
} from "./blocks.js"
import { buildNurseries } from "./nurseries.js"
import { C, F_SOLID, LAWN_Y, YARD_Y } from "./site.js"
import {
  MOAT,
  addBambooClump,
  addClimbPanda,
  addForkPerch,
  addLogMat,
  addMoat,
  addPerch,
  addPolyMoat,
  addPool,
  addRockLump,
  addRockShelter,
  addSitPanda,
  addSleevedTree,
  addSoil,
  arcPts,
  bambooBufs,
  fillet,
  flushBamboo,
  polar,
  radialWall,
  ringSector,
  rockOutline,
  roughen,
  roundedRect
} from "./yards.js"

const DEG = Math.PI / 180
const GREENS = [...C.forest, ...THEME.tree.greens]

/* ---------------- 别墅表 ---------------- */

/*
 * 字段：
 *   yard     活动场轮廓（世界坐标）；
 *   frame    [x, z, 方位]：下面 uv 坐标的原点与 u 轴方位（v 轴为方位 + 90°），圆角矩形取其中心与长边方位；
 *   shelter  塑石兽舍 { uv | at, w, d, along（长轴方位）, door（门朝向方位）, out（是否允许伸出活动场） }；
 *   perch    双层栖架 { uv | at, ladder（爬梯方位） }，climb 为上面趴着熊猫（4.12 摆放表）；
 *   panda    坐姿熊猫 { at, h }（4.12 摆放表的世界坐标）；
 *   pool / soil / logs / bamboo / trees：水池 [u, v, 长轴方位]、裸土 [u, v, 长, 宽, 方位]、原木排（同）、
 *            矮竹 [u, v]、套竹筒树 [u, v, 冠半径]（树都放在熊猫、栖架的背面或侧面，不挡机位视线）
 */
const VILLAS = [
  {
    name: "7 号别墅",
    // 文档：地块 (7165, −8860) 127 × 55 @142°，活动场 100 × 36 @142°，兽舍西北端 (7138, −8895)。
    // 环路 loop 在 (7178, −8863)～(7191, −8848) 拐了个角，正好横在文档矩形的长轴上；科普路 science
    // 又贴着西侧。改成拐角西南侧的 L 形：北段是两路之间的楔形地（兽舍在楔形尖、离两路 ≥ 5.9 m），
    // 南段是环路以南、科普路以北的条带。约 3,700 ㎡（文档 3,600 ㎡）。凹角（拐角下）倒圆半径 4 m
    yard: fillet(
      [
        [7149, -8910],
        [7166, -8893],
        [7170, -8866],
        [7183, -8840],
        [7222, -8835],
        [7220, -8796],
        [7165, -8792],
        [7150, -8840]
      ],
      4
    ),
    shelter: {
      at: [7156, -8895],
      w: 20,
      d: 9,
      along: 170,
      door: 150,
      out: true
    },
    panda: { at: [7168, -8858], h: 6.5 }, // #4
    perch: { at: [7198, -8816], ladder: 35 },
    pool: { at: [7176, -8806], bearing: 80 },
    soil: { at: [7186, -8834], w: 8, d: 6, bearing: 60 },
    logs: { at: [7205, -8800], w: 7, d: 4, bearing: 90 },
    bamboo: { at: [7166, -8815] },
    trees: [
      { at: [7158, -8840], r: 4.6 },
      { at: [7216, -8826], r: 4.8 }
    ]
  },
  {
    name: "5 号别墅",
    // 文档：地块 (7247, −8941) 95 × 92 @137°，活动场 72 × 70 @137°，兽舍西北角。
    // 中心东移到 (7258, −8944)：原中心下活动场西角压到别墅步道 villas。栖架即文档第 5 行的位置
    yard: roundedRect(7258, -8944, 72, 70, 137, 10),
    frame: [7258, -8944, 137],
    shelter: { uv: [-28.5, 0], w: 22, d: 10, along: 47, door: 137 },
    perch: { at: [7247, -8941], ladder: 35, climb: true }, // #5
    pool: { uv: [14, -15], bearing: 137 },
    soil: { uv: [8, -4], w: 9, d: 6, bearing: 137 },
    logs: { uv: [20, 12], w: 7, d: 4, bearing: 47 },
    bamboo: { uv: [-8, -27] },
    trees: [
      { uv: [-18, -24], r: 5 },
      { uv: [-22, 22], r: 4.6 }
    ]
  },
  {
    name: "4 号别墅",
    // 文档：4、3 号共用地块 171 × 95 @48° 沿长轴一分为二，4 号为西南半 (7319, −9005)，活动场 66 × 72
    // （66 沿 48°、72 沿 138°）。兽舍在离机位较远的西北边（−v，方位 318°）
    yard: roundedRect(7319, -9005, 66, 72, 48, 10),
    frame: [7319, -9005, 48],
    shelter: { uv: [0, -29], w: 22, d: 10, along: 48, door: 138 },
    panda: { at: [7319, -9005], h: 6.5 }, // #6
    perch: { uv: [17, -6], ladder: 35 },
    pool: { uv: [-16, 15], bearing: 48 },
    soil: { uv: [-5, 13], w: 9, d: 6, bearing: 48 },
    logs: { uv: [14, 17], w: 7, d: 4, bearing: 138 },
    bamboo: { uv: [-26, -6] },
    trees: [
      { uv: [21, -22], r: 5 },
      { uv: [-22, -20], r: 4.6 }
    ]
  },
  {
    name: "3 号别墅",
    // 文档：东北半 (7383, −9063)，66 × 72。别墅步道东段在 z ≈ −9094 自西向东南斜下，文档矩形的北角
    // 越过步道约 15 m；缩成 60 × 56、中心挪到 (7392, −9045)，熊猫（文档第 7 行）仍在场内北部。
    // 熊猫占了离机位远的西北边，兽舍改放西南端（−u，方位 228°）
    yard: roundedRect(7392, -9045, 60, 56, 48, 10),
    frame: [7392, -9045, 48],
    shelter: { uv: [-22, -6], w: 22, d: 10, along: 138, door: 48 },
    panda: { at: [7383, -9063], h: 6.5 }, // #7
    perch: { uv: [14, 10], ladder: 35 },
    pool: { uv: [-6, 16], bearing: 48 },
    soil: { uv: [6, 2], w: 9, d: 6, bearing: 48 },
    logs: { uv: [-4, -14], w: 7, d: 4, bearing: 138 },
    bamboo: { uv: [24, -4] },
    trees: [
      { uv: [20, -18], r: 4.8 },
      { uv: [-18, 18], r: 4.4 }
    ]
  },
  {
    name: "6 号别墅",
    // 文档：地块 (7185, −9004) 109 × 57 @21°，活动场 85 × 40 @21°，兽舍北端（+u）。
    // 文档第 8 行（6 号栖架上的熊猫）按决策去掉，栖架保留在场中
    yard: roundedRect(7185, -9004, 85, 40, 21, 9),
    frame: [7185, -9004, 21],
    shelter: { uv: [35.5, 0], w: 22, d: 10, along: 111, door: 201 },
    perch: { uv: [0, 0], ladder: 35 },
    pool: { uv: [-22, 8], bearing: 21 },
    soil: { uv: [-10, -8], w: 9, d: 6, bearing: 21 },
    logs: { uv: [14, 9], w: 7, d: 4, bearing: 111 },
    bamboo: { uv: [26, 13] },
    trees: [
      { uv: [20, -12], r: 4.8 },
      { uv: [-30, -10], r: 4.4 }
    ]
  }
]

/*
 * 1 号别墅（way 613349748，圆形兽舍，拟合圆心 (6751.0, −9099.5)、r 15.4）：
 * 兽舍为环形屋面（文档推定中心圆院 r 6），墙顶 6.3（×1.25）；活动场为环形场，内弧 r 17（贴着兽舍外一圈草地，
 * 不做墙），外弧 r 31 + 3·cos(方位 − 135°)（东南半最宽 34、西北半 28，即文档「东南半开阔」）。
 * 参观道 no1 自东北伸到兽舍东门（方位 55°～75°、r 18～29），环形场在 30°～98° 之间断开让路，
 * 两端各一道径向端墙。栖架即文档第 10 行（东南，趴架熊猫）
 */
const VILLA1 = {
  name: "1 号别墅",
  spec: {
    name: "1 号别墅 613349748",
    at: [6751.0, -9099.5],
    rect: [30.6, 30.6, 0],
    area: 698
  },
  c: [6751.0, -9099.5],
  court: 6,
  top: 6.3,
  yard: {
    rIn: 17,
    rOut: (b) => 31 + 3 * Math.cos((b - 135) * DEG),
    b0: 98,
    span: 292,
    n: 18,
    nIn: 12
  },
  perch: { at: [6768, -9083], ladder: 35, climb: true }, // #10
  // 其余构件 [方位, 离圆心距离]
  pool: [205, 24],
  soil: [170, 22.5],
  logs: [245, 23],
  bamboo: [310, 25],
  trees: [
    [285, 23.5, 4.6],
    [340, 23, 4.4]
  ]
}

/*
 * 2 号别墅（way 686460734，影像为浅灰平屋面兽舍，约 6 m → 7.5 m）：活动场为环绕兽舍的 C 形场——
 * 自兽舍西墙内绕西、北、东三面到兽舍东南角外，南沿（兽舍南侧的饲养入口一带）不围；东南侧最宽，
 * 熊猫（文档第 9 行）在兽舍东南。活动场的南沿穿进兽舍（墙藏在兽舍里），离参观环 no2Loop 南段与
 * 去月亮产房的主路 toMoon 中线 ≥ 5.2 m
 */
const VILLA2 = {
  name: "2 号别墅",
  spec: {
    name: "2 号别墅 686460734",
    at: [6985.3, -9244.0],
    rect: [34.3, 31.5, 168],
    area: 805
  },
  top: LAWN_Y + 6.65,
  yard: fillet(
    [
      [6971, -9241],
      [6948, -9244],
      [6947, -9266],
      [6962, -9283],
      [6987, -9289],
      [7008, -9279],
      [7023, -9264],
      [7027, -9247],
      [7022, -9232],
      [7003, -9232]
    ],
    4
  ),
  panda: { at: [7008, -9236], h: 6.5 }, // #9
  perch: { at: [6975, -9275], ladder: 35 },
  pool: { at: [7018, -9262], bearing: 40 },
  soil: { at: [7015, -9248], w: 8, d: 5, bearing: 40 },
  logs: { at: [6958, -9266], w: 6, d: 4, bearing: 10 },
  bamboo: { at: [6992, -9282] },
  trees: [
    { at: [6955, -9254], r: 4.4 },
    { at: [7006, -9278], r: 4.6 }
  ]
}

/* ---------------- 小熊猫区、686460737 ---------------- */

/*
 * 小熊猫 2 号活动场（way 686460724，tourism=attraction，11,698 ㎡，林下）：四周 1.2 m 矮墙即可（文档 4.11）。
 * 轮廓为 OSM 46 点按 Douglas–Peucker 2 m 抽稀的 26 点（面积误差 < 0.1%），局部坐标；
 * 场内不开草地洞、不打 F_YARD（林下，树竹分区照常往里种），只沿墙线打 F_SOLID。
 * 东北角离别墅—产房步道 sunToNo2 中线 ≥ 5.3 m。场内 3 座树杈栖架
 */
const RED_PANDA_AREA = [
  [6930.9, -9135.4],
  [6910.3, -9099.3],
  [6906.2, -9088.4],
  [6906.2, -9076.3],
  [6936.5, -9034.6],
  [6950.1, -9025],
  [7005.6, -9009.3],
  [7029.2, -9016.9],
  [7033.9, -9021.9],
  [7033.7, -9034],
  [7049.1, -9050.8],
  [7021.8, -9078.9],
  [7002.8, -9066.3],
  [6992.9, -9071.3],
  [6985.4, -9076.9],
  [6983.9, -9089.5],
  [6975, -9100.9],
  [6974, -9116.8],
  [6996.7, -9137.3],
  [6996.4, -9145.6],
  [6990.4, -9157.3],
  [6983.3, -9162.8],
  [6969.8, -9166.1],
  [6943.2, -9154.4],
  [6936.4, -9145.8],
  [6929.4, -9144.3]
]
const RED_PANDA_WALL = { h: 1.2, t: 0.4 }
const FORK_PERCHES = [
  [6960, -9050, 20],
  [7012, -9030, 70],
  [6948, -9118, 160]
]
/*
 * 小熊猫产房（node 11994568340 (6905.5, −9120.3)，照片 pb_redpanda_house：粉墙 + 塑石立面）：
 * 12 × 8 粉墙平顶小屋，长边顺着 2 号活动场西界（方位 30°），顶上 2 块塑石岩包，门朝活动场（东南）
 */
const RED_PANDA_HOUSE = {
  at: [6905.5, -9120.3],
  w: 12,
  d: 8,
  bearing: 30,
  top: LAWN_Y + 5,
  door: 120
}
/*
 * 686460737（(7030.9, −9185.7)，583 ㎡，推定为 14 号兽舍一类）：按 OSM 轮廓做塑石兽舍（Task 8 原先在
 * halls.js 按 7.5 m 矮房建，已从那里的 LOW_HOUSES 删去），顶高 7.5 ± 1.1，门朝西边的步道 sunToNo2
 */
const ROCK_HOUSE = {
  name: "塑石兽舍 686460737",
  at: [7030.9, -9185.7],
  rect: [32.1, 20.9, 77],
  area: 583,
  h: 6.65,
  door: 257
}

/* ---------------- 布置自检 ---------------- */

/**
 * 开发期自检：inside 构件的轮廓顶点须在活动场内（墙内皮以内 0.5 m），各构件两两不压叠
 * （任一顶点落进另一个的轮廓里）。只 console.warn，不阻断构建。
 * @param {Array<{ name, poly, inside?: boolean, soft?: boolean }>} items soft：只与非 soft 构件比
 *   （裸土、原木排可以垫在别的构件下面，只查它们别压到水池上）
 */
function checkLayout(name, yard, items) {
  const inner = insetPolygon(yard, MOAT.wallIn + 0.5)
  for (const it of items) {
    if (it.inside === false) continue
    const out = it.poly.filter(([x, z]) => !pointInPolygon(x, z, inner)).length
    if (out)
      console.warn(`熊猫基地：${name}的${it.name}有 ${out} 个点超出活动场`)
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]
      const b = items[j]
      if (a.soft && b.soft) continue
      if ((a.soft || b.soft) && a.name !== "水池" && b.name !== "水池") continue
      const hit = (p, q) =>
        p.poly.some(([x, z]) => pointInPolygon(x, z, q.poly))
      if (hit(a, b) || hit(b, a)) {
        console.warn(`熊猫基地：${name}的${a.name}与${b.name}压叠`)
      }
    }
  }
}

/** 一点周围的小圆（自检用的熊猫、树干占地） */
const disk = (x, z, r) => circlePolygon(x, z, r, 8)

/* ---------------- 别墅通用模板 ---------------- */

/** frame [x, z, 方位] 下 (u, v) → 世界 [x, z]；u 沿方位，v 沿方位 + 90° */
function uvToXZ(fr, [u, v]) {
  const b = fr[2] * DEG
  return [
    fr[0] + u * Math.sin(b) + v * Math.cos(b),
    fr[1] - u * Math.cos(b) + v * Math.sin(b)
  ]
}

/** 构件位置：给了 at 用 at，否则按 frame 换算 uv */
const posOf = (v, item) => item.at ?? uvToXZ(v.frame, item.uv)

/**
 * 场内构件（栖架、水池、斑块、矮竹、树、坐姿熊猫），返回自检用的占地列表。
 * spec 字段同 VILLAS；pos(item) 给出构件的世界坐标 [x, z]
 */
function addYardProps(site, spec, pos, bufs) {
  const b = site.b
  const gb = site.gb
  const items = []
  if (spec.perch) {
    const [x, z] = pos(spec.perch)
    const r = addPerch(b, x, YARD_Y, z, { ladder: spec.perch.ladder })
    if (spec.perch.climb) addClimbPanda(b, r.anchor)
    site.solid(r.foot)
    items.push({ name: "栖架", poly: r.foot })
    items.push({ name: "爬梯落脚点", poly: disk(...r.ladderFoot, 0.6) })
  }
  if (spec.pool) {
    const [x, z] = pos(spec.pool)
    items.push({ name: "水池", poly: addPool(gb, x, z, spec.pool.bearing) })
  }
  if (spec.soil) {
    const s = spec.soil
    const [x, z] = pos(s)
    items.push({
      name: "裸土",
      poly: addSoil(gb, x, z, s.w, s.d, s.bearing),
      soft: true
    })
  }
  if (spec.logs) {
    const s = spec.logs
    const [x, z] = pos(s)
    items.push({
      name: "原木排",
      poly: addLogMat(gb, x, z, s.w, s.d, s.bearing),
      soft: true
    })
  }
  if (spec.bamboo) {
    const [x, z] = pos(spec.bamboo)
    addBambooClump(bufs, x, YARD_Y, z)
    items.push({ name: "矮竹", poly: disk(x, z, 1.6) })
  }
  spec.trees?.forEach((t, i) => {
    const [x, z] = pos(t)
    const k = Math.round(x) + Math.round(z) + i
    const color = GREENS[((k % GREENS.length) + GREENS.length) % GREENS.length]
    addSleevedTree(b, x, YARD_Y, z, t.r, color, i * 1.7 + 0.4)
    items.push({ name: `第 ${i + 1} 棵树`, poly: disk(x, z, 0.9) })
  })
  if (spec.panda) {
    const [x, z] = spec.panda.at
    addSitPanda(b, x, YARD_Y, z, spec.panda.h)
    // 坐姿熊猫占地：身体半径约 0.3 h，脚向脸前伸出约 0.45 h
    items.push({ name: "熊猫", poly: disk(x, z, 0.4 * spec.panda.h) })
  }
  return items
}

/** 3～7 号别墅：下沉活动场 + 院墙 + 塑石兽舍 + 场内构件 */
function buildVilla(site, v, bufs) {
  const b = site.b
  site.addYard(v.yard)
  addPolyMoat(b, v.yard)
  site.solid(insetPolygon(v.yard, -MOAT.hedgeOut))
  const pos = (item) => posOf(v, item)
  const s = v.shelter
  const [sx, sz] = pos(s)
  const shelter = rockOutline(sx, sz, s.w, s.d, s.along)
  addRockShelter(b, shelter, { y0: YARD_Y, h: 7.5, doorFacing: s.door })
  site.solid(shelter)
  const items = addYardProps(site, v, pos, bufs)
  items.push({ name: "兽舍", poly: shelter, inside: !s.out })
  checkLayout(v.name, v.yard, items)
}

/* ---------------- 1 号、2 号别墅 ---------------- */

/** 1 号别墅：环形兽舍（OSM 外轮廓 + 中心圆院）、环形活动场（外弧院墙 + 两端端墙）、场内构件 */
function buildVilla1(site, bufs) {
  const v = VILLA1
  const b = site.b
  const outer = outlineOf(site, v.spec)
  const court = circlePolygon(v.c[0], v.c[1], v.court, 8)
  site.solid(outer)
  b.add(sideWalls(outer, GROUND_Y, v.top), C.nurseryWall)
  b.add(sideWalls(court, GROUND_Y, v.top, true), C.nurseryWall)
  b.add(flatFace(outer, [court], v.top), C.nurseryRoof)
  facadeBands(b, outer, {
    y0: LAWN_Y + 1.4,
    y1: LAWN_Y + 3.4,
    minLen: 3,
    end: 0.4,
    facing: 150,
    spread: 70
  })
  const y = v.yard
  const hole = ringSector(v.c, y.rIn, y.rOut, y.b0, y.span, y.n, y.nIn)
  site.addYard(hole)
  addMoat(
    b,
    (d) => arcPts(v.c, (bb) => y.rOut(bb) + d, y.b0, y.span, y.n),
    false
  )
  for (const bb of [y.b0, y.b0 + y.span]) {
    radialWall(b, v.c, bb, y.rIn - 0.25, y.rOut(bb) + 0.3)
  }
  site.solid(
    ringSector(
      v.c,
      y.rIn,
      (bb) => y.rOut(bb) + MOAT.hedgeOut,
      y.b0,
      y.span,
      y.n,
      y.nIn
    )
  )
  // 其余构件按 [方位, 距离] 换算成世界坐标后套通用模板
  const at = ([bb, r]) => polar(v.c, r, bb)
  const spec = {
    perch: v.perch,
    pool: { at: at(v.pool), bearing: v.pool[0] + 90 },
    soil: { at: at(v.soil), w: 8, d: 6, bearing: v.soil[0] + 90 },
    logs: { at: at(v.logs), w: 7, d: 4, bearing: v.logs[0] + 90 },
    bamboo: { at: at(v.bamboo) },
    trees: v.trees.map(([bb, r, cr]) => ({ at: at([bb, r]), r: cr }))
  }
  const items = addYardProps(site, spec, (it) => it.at, bufs)
  checkLayout(v.name, hole, items)
}

/** 2 号别墅：OSM 轮廓平屋面兽舍（白墙浅灰屋面、朝活动场的墙面一条观察窗带）+ C 形活动场 */
function buildVilla2(site, bufs) {
  const v = VILLA2
  const b = site.b
  const shelter = outlineOf(site, v.spec)
  site.solid(shelter)
  flatBlock(b, shelter, {
    top: v.top,
    wall: C.nurseryWall,
    roof: C.nurseryRoof,
    parapet: 0.5,
    inset: 0.4
  })
  facadeBands(b, shelter, {
    y0: LAWN_Y + 2.0,
    y1: LAWN_Y + 4.0,
    minLen: 8,
    end: 1,
    facing: 60,
    spread: 80,
    blockers: site.solids
  })
  site.addYard(v.yard)
  addPolyMoat(b, v.yard)
  site.solid(insetPolygon(v.yard, -MOAT.hedgeOut))
  const items = addYardProps(site, v, (it) => it.at, bufs)
  checkLayout(v.name, v.yard, items)
}

/* ---------------- 小熊猫区、686460737 ---------------- */

/** 小熊猫 2 号活动场：一圈 1.2 m 矮墙（墙内皮 + 墙顶）、3 座树杈栖架；小熊猫产房 */
function buildRedPanda(site) {
  const b = site.b
  const w = RED_PANDA_WALL
  const ring = RED_PANDA_AREA
  // 墙身骑在轮廓线上（内外皮各离轮廓 t / 2），只做内皮与墙顶
  addMoat(b, (d) => insetPolygon(ring, -d), true, {
    hedge: false,
    rail: false,
    y0: GROUND_Y,
    top: LAWN_Y + w.h,
    wallIn: w.t / 2,
    wallOut: w.t / 2
  })
  site.grid.stampLine(ring, 0.8, F_SOLID, true)
  for (const [x, z, bearing] of FORK_PERCHES) {
    site.solid(addForkPerch(b, x, LAWN_Y, z, bearing))
  }
  const h = RED_PANDA_HOUSE
  const poly = rectPolygon(h.at[0], h.at[1], h.w, h.d, h.bearing)
  site.solid(poly)
  flatBlock(b, poly, {
    top: h.top,
    wall: C.redPandaWall,
    roof: C.flatRoof,
    parapet: 0.4,
    inset: 0.35
  })
  facadeBands(b, poly, {
    y0: LAWN_Y,
    y1: LAWN_Y + 2.6,
    color: C.windowBand,
    minLen: 6,
    end: 4.5,
    facing: h.door,
    best: true
  })
  // 顶上两块塑石岩包（照片里门楣与两侧的塑石）
  for (const [k, s] of [
    [-0.28, 2.6],
    [0.3, 2.1]
  ]) {
    const u = [Math.sin(h.bearing * DEG), -Math.cos(h.bearing * DEG)]
    addRockLump(
      b,
      h.at[0] + u[0] * k * h.w,
      h.top,
      h.at[1] + u[1] * k * h.w,
      s * 1.3,
      s * 0.6,
      s,
      k * 3,
      k < 0 ? C.rock : C.rockDark
    )
  }
}

/** 686460737：按 OSM 轮廓做塑石兽舍（轮廓打毛、顶高抖动、岩包、墨绿门） */
function buildRockHouse(site) {
  const r = ROCK_HOUSE
  // OSM 轮廓近乎矩形，直接挤出读成一只灰盒子：长边每约 5 m 插一点、沿法向抖动 ±0.5 m
  const poly = roughen(outlineOf(site, r))
  site.solid(poly)
  addRockShelter(site.b, poly, {
    y0: LAWN_Y,
    h: r.h,
    doorFacing: r.door,
    lumps: 4
  })
}

/* ---------------- 入口 ---------------- */

/**
 * 熊猫别墅（3～7 号、1 号、2 号）、太阳 / 月亮产房、吊桥、小熊猫区、686460737 塑石兽舍、10 只熊猫。
 * 在 buildLake 之后调用（园路、建筑、湖已登记；本分区的活动场在 buildLawn 之前登记进草地洞）。
 */
export function buildEnclosures(site) {
  const bufs = bambooBufs()
  buildNurseries(site)
  for (const v of VILLAS) buildVilla(site, v, bufs)
  buildVilla1(site, bufs)
  buildVilla2(site, bufs)
  buildRedPanda(site)
  buildRockHouse(site)
  flushBamboo(site.b, bufs)
}

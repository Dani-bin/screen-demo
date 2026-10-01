/*
 * 熊猫基地 · 天鹅湖
 * ----------------------------------------------------------
 * 规格：设计文档 4.7（天鹅湖）、4.2（配色）、4.1（黑天鹅 ×3 插画放大）。照片：pb_swanlake01（黑天鹅红喙）、
 * pb_swanlake02（对岸垂柳、水边芦苇、木栈平台）、sheet_main_3 #87～#97（湖边红色长椅、木栏、木栈平台）、
 * pb_pond_island（湖心小岛）。
 * 湖面由城市水面层画（terrain.js，y 0.3），林下草地已在天鹅湖外环、东北小湖处开洞（ground.js），
 * 湖心岛草地也已在 ground.js 挤出；本模块不画水，只做：
 *   - 驳岸：天鹅湖外环、东北小湖各一圈石块色护岸（地面批），见 addBank；
 *   - 木栈平台 3 处（西湾西头、西南角、南岸）：6 × 4、面高 1.0，三面 0.9 m 木栏，台上各一张红色长椅；
 *     另有一张长椅在西岸步道边的草地上；
 *   - 垂柳 7 株（冠竖向拉长 1.5 倍、下摆略外张）、芦苇 8 丛（北岸与湖心岛四周的水里）；
 *   - 湖心岛 3 棵树 + 1 株樱花（种在 ISLAND_Y）；
 *   - 黑天鹅 5 只（插画放大 ×3，散在湖心岛南北两侧水面）：做成静态件，不做漂游动画
 *     （动画件要单独成 Mesh、另守「不投影」的约定，这里不值得）。
 * 西岸步道两侧的竹丛由树竹分区（vegetation，设计文档 4.13「湖西岸点种」）统一种，这里不种。
 *
 * 坐标：各构件位置是按 site.lakes 的湖岸线（附录 B 经纬度投影后的局部坐标）离线算好的世界坐标常量，
 * 并逐个核对过与园路、实体的距离（见各常量注释）：
 *   - 步行路径（第 6 节 7、8 条：lakeWest 宽 2.4、lakeEast 宽 3.0）的可走带外，
 *     木栏、长椅离可走带边 ≥ 1.9 m，垂柳冠缘 ≥ 3.5 m（人流校验的分部件净距最大 0.86 m）；
 *   - 都不压园路路面带（ROADS），离竹韵餐厅、玫瑰苑等实体 ≥ 25 m。
 * 占用栅格：栈台、草地上的长椅用 site.solid 登记；垂柳、岛上树按冠半径打 F_TREE（树竹分区不再往里种）。
 * 湖心岛被天鹅湖外环的 F_WATER 一并盖住，所以岛上的树按常量直接种，不查栅格。
 */
import {
  IcosahedronGeometry,
  Matrix4,
  OctahedronGeometry,
  Vector3
} from "three"
import { THEME } from "../../theme.js"
import { hashInts, mulberry32 } from "../../utils.js"
import { frame, local } from "../kit/builder.js"
import { insetPolygon, rectPolygon } from "../kit/footprint.js"
import { box, fromTriangles, prism } from "../kit/shapes.js"
import { C, F_TREE, ISLAND_Y, LAWN_Y } from "./site.js"

const L = THEME.landmark
const DEG = Math.PI / 180

/** 城市水面层的高度（terrain.js 的 buildFlatPolygons(data.water, 0.3)） */
const WATER_Y = 0.3

/* ---------------- 驳岸 ---------------- */

/*
 * 护岸：外沿在草地洞边、高 LAWN_Y（与草地顶面齐平、只对边不重叠，不会共面闪烁），
 * 向湖内平铺 w 米、斜落到水面以下 low（插画里读成一圈石砌斜坡护岸，即文档的「0.3 → 0.85」）。
 * 宽度取 1.6 m 的原因：草地洞用的是抽稀 1.5 m 的湖岸线（附录 B），城市水面层用 OSM 全量轮廓，
 * 两者最多差约 1.5 m（天鹅湖南岸、北岸、东岸几段），洞边与水边之间会露出城市地面（−0.5）；
 * 护岸铺 1.6 m 正好盖住这条缝。
 * 没有照计划用 sweepBar：它不能闭合成环（接缝处两端封口朝内）、折点取相邻边平均法向而不斜接，
 * 外沿跟不上洞边，会与草地顶面重叠闪烁或留缝；1.6 m 宽的方截面条带也会读成一圈石板路。
 * 这里用斜接内收（kit insetPolygon）的斜坡带，每段 2 个三角形，外沿逐点落在洞边上。
 */
const BANK = { w: 1.6, top: LAWN_Y, low: 0.2 }

/**
 * 一圈护岸（进地面批，单面材质：三角形统一朝上）
 * @param {Array<[number, number]>} poly 湖洞轮廓（与 lawnHoles 里的同一个数组）
 */
function addBank(gb, poly) {
  const inner = insetPolygon(poly, BANK.w)
  const n = poly.length
  const pos = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const a = [poly[i][0], BANK.top, poly[i][1]]
    const b = [poly[j][0], BANK.top, poly[j][1]]
    const c = [inner[j][0], BANK.low, inner[j][1]]
    const d = [inner[i][0], BANK.low, inner[i][1]]
    pos.push(...a, ...b, ...c, ...a, ...c, ...d)
  }
  gb.add(fromTriangles(faceUp(pos)), C.bankStone)
}

/**
 * 让一组三角形统一朝上（地面批是单面材质）：按第一个三角形的法向判断绕向，朝下就整体翻转。
 * 只适用于绕向一致的条带（同一条轮廓逐段生成），返回新数组
 */
function faceUp(pos) {
  const [ax, , az, bx, , bz, cx, , cz] = pos
  // 法向 y 分量 = (b − a) × (c − a) 的 y
  const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
  if (ny >= 0) return pos
  const out = pos.slice()
  for (let k = 0; k < out.length; k += 9) {
    for (let j = 0; j < 3; j++) {
      out[k + 3 + j] = pos[k + 6 + j]
      out[k + 6 + j] = pos[k + 3 + j]
    }
  }
  return out
}

/* ---------------- 木栈平台、长椅 ---------------- */

/*
 * 栈台：at 为平台中心，bearing 为伸向湖心的方位（frame 局部 −Z），局部 X 沿岸。
 * 位置：在湖岸线某段上取一点，沿该段指向湖内的法向推 d / 2 − 0.6 —— 陆侧边压进岸上草地 0.6 m、
 * 其余 3.4 m 伸到水面上；三处陆侧都挨着湖边步道（lakeWest），木栏离步道可走带边 1.9～2.6 m。
 *   西湾西头：湖岸线第 0 段（西湾西端）45% 处，朝东南伸进西湾（也正对到站机位方位 125°）；
 *   西南角：第 19 段中点，朝东北；南岸：第 17 段 45% 处，朝北偏西。
 */
const DECKS = [
  { at: [7397.0, -8916.6], bearing: 129.0 },
  { at: [7424.1, -8831.4], bearing: 46.4 },
  { at: [7445.4, -8828.2], bearing: 341.1 }
]
// 平台 w（沿岸）× d（进深）、台面顶 top（文档「高 1.0」，比草地高 0.15）、台体下沿 bottom（落到水面以下，
// 读成一整块实心栈台，不在水面上悬空）；木栏高 rail、离台边内收 railIn，只在临水三面
const DECK = { w: 6, d: 4, top: 1.0, bottom: 0.2, rail: 0.9, railIn: 0.06 }
// 长椅色块：长 len、高 h、深 dep（照片里是红漆木长椅，这个尺度只读得出一块红色）
const BENCH = { len: 1.8, h: 0.5, dep: 0.55 }
// 草地上的长椅：西岸步道（lakeWest）东侧、南湾西岸的草地上，面朝东边湖面（离路面带边 2.4 m）
const LAWN_BENCH = { at: [7404.5, -8872.0], facing: 90 }

/** 一处栈台：台体 + 三面木栏（竖直面带）+ 靠一侧木栏的长椅；陆侧压在草地上，登记为实体 */
function addDeck(site, dk) {
  const b = site.b
  const D = DECK
  const [x, z] = dk.at
  const F = frame(x, 0, z, dk.bearing)
  b.add(box(D.w, D.top - D.bottom, D.d), C.deck, local(F, 0, D.bottom, 0))
  // 木栏：两侧与临水一面连成 U 形，单面竖直面带（主体批是双面材质），0.06 m 的栏杆厚度在这个尺度看不出
  const hx = D.w / 2 - D.railIn
  const hz = D.d / 2 - D.railIn
  const ring = [
    [-hx, hz],
    [-hx, -hz],
    [hx, -hz],
    [hx, hz]
  ]
  const y0 = D.top
  const y1 = D.top + D.rail
  const pos = []
  for (let i = 0; i + 1 < ring.length; i++) {
    const [px, pz] = ring[i]
    const [qx, qz] = ring[i + 1]
    pos.push(px, y0, pz, qx, y0, qz, qx, y1, qz)
    pos.push(px, y0, pz, qx, y1, qz, px, y1, pz)
  }
  b.add(fromTriangles(pos), C.railWood, F)
  // 长椅：长边沿 −X 一侧的木栏，面朝平台中间
  b.add(
    box(BENCH.dep, BENCH.h, BENCH.len),
    C.bench,
    local(F, -hx + 0.1 + BENCH.dep / 2, D.top, -0.3)
  )
  // 实体：长边 w 沿岸（方位 bearing + 90）
  site.solid(rectPolygon(x, z, D.w, D.d, dk.bearing + 90))
}

/** 草地上的长椅：长边与面朝方向垂直，登记为实体 */
function addLawnBench(site) {
  const { at, facing } = LAWN_BENCH
  // frame 局部 +Z 朝 facing（bearing = facing + 180），局部 X 为长边
  const F = frame(at[0], LAWN_Y, at[1], facing + 180)
  site.b.add(box(BENCH.len, BENCH.h, BENCH.dep), C.bench, F)
  site.solid(rectPolygon(at[0], at[1], BENCH.len, BENCH.dep, facing + 90))
}

/* ---------------- 垂柳、湖心岛树 ---------------- */

// 单位二十面体（detail 0）的最高 / 最低顶点高度（半高）：t / √(1 + t²)，t 为黄金比
const ICO_HALF = 1.618034 / Math.hypot(1, 1.618034)

/**
 * 树冠模板：单位二十面体去掉法线（合批器按面重算，与 kit addTree 的棱面一致）。
 * 下半部可变形成垂柳的「裙摆」：按离赤道的深度逐渐外张（冠底放宽 1 + flare 倍）并压扁 squash 倍，
 * 赤道及以上不变 —— 上面是拉长的圆顶、下面是张开的垂枝。
 * @returns {{ geo, above: number, below: number, spread: number }} 单位尺寸下冠顶高出冠心 above、
 *   冠底低于冠心 below、最大水平半径 spread（按 (r, sy·r, r) 缩放后各乘相应的 r）
 */
function crownTemplate(flare = 0, squash = 1) {
  const geo = new IcosahedronGeometry(1, 0)
  geo.deleteAttribute("normal")
  const p = geo.attributes.position
  let spread = 0
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i)
    const deep = Math.max(0, -y / ICO_HALF) // 赤道 0 → 冠底 1
    const k = 1 + flare * deep
    const x = p.getX(i) * k
    const z = p.getZ(i) * k
    p.setXYZ(i, x, y < 0 ? y * squash : y, z)
    spread = Math.max(spread, Math.hypot(x, z))
  }
  return { geo, above: ICO_HALF, below: ICO_HALF * squash, spread }
}

/*
 * 垂柳（文档：addTree 冠拉长，r 6、竖向 1.5 倍、柳色）。kit addTree 的冠竖向固定 1.15 倍，这里自写：
 * 三棱树干 + 竖向拉长 sy 倍的二十面体冠，下半部外张 flare、压扁 squash（见 crownTemplate），
 * 冠底离草地 lift（柳枝垂到人高附近）。
 * [x, z, r]：树干都在岸上草地、离湖洞边约 2.5 m（冠伸到水面上），离湖边步道路面带 ≥ 9.6 m
 * （外张后冠缘最远 1.11 r，离步道可走带仍 ≥ 3.5 m）。自南向北：南湾西岸 2 株、南湾与西湾之间的岬角、
 * 主湖西岸、西北岸、北岸、东北岸各 1 株
 */
const WILLOWS = [
  [7416.8, -8862.5, 6.0],
  [7415.3, -8881.5, 5.6],
  [7432.0, -8892.3, 6.2],
  [7449.6, -8946.5, 6.0],
  [7466.5, -8979.8, 5.8],
  [7528.0, -9008.8, 6.2],
  [7561.0, -8991.0, 5.8]
]
const WILLOW = { sy: 1.5, flare: 0.5, squash: 0.75, lift: 2.0 }

// 湖心岛（609 ㎡，岛草地顶 ISLAND_Y）：3 棵树 [x, z, r]，树干离岛边 ≥ 4.9 m；
// 樱花一株在岛的东南侧（朝到站机位），冠略扁
const ISLAND_TREES = [
  [7492.5, -8983.0, 4.6],
  [7503.5, -8988.5, 5.0],
  [7511.5, -8981.5, 4.2]
]
const SAKURA = { at: [7503.0, -8976.0], r: 3.4, sy: 0.95 }
// 岛上树冠竖向 1.15 倍、冠底离地 0.7 r（同 kit addTree 的比例）
const ISLAND_TREE = { sy: 1.15, lift: 0.7 }

/**
 * 低多边形树：三棱树干（伸到冠心）+ 冠模板（crownTemplate 的结果）按 (r, sy·r, r) 缩放，
 * 冠底离树根 lift；返回树顶高度。三棱树干比 kit addTree 的六棱圆柱省 6 个三角形（本分区预算紧）
 */
function addLiteTree(b, x, y, z, o) {
  const { r, sy, lift, color, crown, yaw = 0 } = o
  const cy = y + lift + crown.below * sy * r
  b.add(
    prism(3, 0.09 * r, 0.06 * r, cy - y, { top: false }),
    THEME.tree.trunk,
    local(null, x, y, z, yaw)
  )
  b.add(crown.geo, color, local(null, x, cy, z, yaw, r, sy * r, r))
  return cy + crown.above * sy * r
}

function plantTrees(site) {
  const { b, grid } = site
  const willowCrown = crownTemplate(WILLOW.flare, WILLOW.squash)
  WILLOWS.forEach(([x, z, r], i) => {
    addLiteTree(b, x, LAWN_Y, z, {
      r,
      sy: WILLOW.sy,
      lift: WILLOW.lift,
      color: C.willow,
      crown: willowCrown,
      yaw: i * 1.3
    })
    grid.disk(x, z, r * willowCrown.spread, F_TREE)
  })
  const crown = crownTemplate()
  const greens = [...C.forest, ...THEME.tree.greens]
  ISLAND_TREES.forEach(([x, z, r], i) => {
    addLiteTree(b, x, ISLAND_Y, z, {
      r,
      sy: ISLAND_TREE.sy,
      lift: ISLAND_TREE.lift * r,
      color: greens[i % greens.length],
      crown,
      yaw: i * 2.1 + 0.4
    })
    grid.disk(x, z, r, F_TREE)
  })
  const s = SAKURA
  addLiteTree(b, s.at[0], ISLAND_Y, s.at[1], {
    r: s.r,
    sy: s.sy,
    lift: ISLAND_TREE.lift * s.r,
    color: C.sakura,
    crown,
    yaw: 0.9
  })
  grid.disk(s.at[0], s.at[1], s.r, F_TREE)
}

/* ---------------- 芦苇 ---------------- */

/*
 * 芦苇丛中心（水里）：北岸 4 丛离湖洞边 2.6 m（在 1.6 m 宽的护岸以外），西北岸 1 丛（湖心岛西侧窄水道），
 * 湖心岛西、东、东北 3 丛离岛边 1.0 m。岛南侧（朝机位）不种，免得挡住樱花与天鹅
 */
const REEDS = [
  [7481.7, -8987.0],
  [7524.9, -9002.1],
  [7534.1, -9005.7],
  [7541.9, -9008.8],
  [7547.3, -9003.8],
  [7483.3, -8977.9],
  [7517.3, -8983.1],
  [7510.9, -8991.2]
]
// 每丛 blades 根细长四棱锥，每根代表一束芦苇（底半对角 r，比真实苇秆粗得多，远景才读得出一丛）：
// 根部在丛心 spread 米内、落在水面以下 0.1 m，高 h[0]～h[1]，梢头向外倾 lean[0]～lean[1] 米；按丛心坐标播种
const REED = {
  blades: 3,
  r: 0.45,
  spread: 0.8,
  h: [2.8, 4.0],
  lean: [0.4, 0.9]
}

/** 全部芦苇写进一个三角形数组，合成一个几何体（每根 4 个侧面三角形，无底面） */
function addReeds(b) {
  const pos = []
  for (const [x, z] of REEDS) {
    const rand = mulberry32(
      hashInts(41, Math.round(x * 10), Math.round(z * 10))
    )
    for (let k = 0; k < REED.blades; k++) {
      // 根部：丛心周围均匀散开（每根占 1 / blades 圈，再加抖动）
      const a = ((k + rand() * 0.6) / REED.blades) * Math.PI * 2
      const d = REED.spread * (0.3 + 0.7 * rand())
      const bx = x + Math.cos(a) * d
      const bz = z + Math.sin(a) * d
      const y0 = WATER_Y - 0.1
      const h = REED.h[0] + (REED.h[1] - REED.h[0]) * rand()
      const lean = REED.lean[0] + (REED.lean[1] - REED.lean[0]) * rand()
      const tip = [bx + Math.cos(a) * lean, y0 + h, bz + Math.sin(a) * lean]
      // 底面四角：绕根部转一个随机角
      const rot = rand() * Math.PI
      const base = []
      for (let q = 0; q < 4; q++) {
        const t = rot + (q * Math.PI) / 2
        base.push([bx + Math.cos(t) * REED.r, y0, bz + Math.sin(t) * REED.r])
      }
      for (let q = 0; q < 4; q++) {
        pos.push(...base[q], ...base[(q + 1) % 4], ...tip)
      }
    }
  }
  b.add(fromTriangles(pos), C.reed)
}

/* ---------------- 黑天鹅 ---------------- */

/*
 * 黑天鹅（插画放大 ×3）：局部 +Z 为头的朝向，y 从水面算起。
 *   身体：压扁的二十面体（detail 0），长 3.6、宽 1.4、高 0.9，尾部上翘 8°，背高出水面约 0.7 m、腹底没在水面以下；
 *   颈：S 形，4 个截面点连成 3 段五棱柱（不封口，颈根压进身体、颈梢伸进头里）；
 *   头：压扁的八面体，略低头；喙：红色四棱锥。
 * 每只 20 + 30 + 8 + 4 = 62 个三角形。
 */
const SWAN = {
  body: { at: [0, 0.25, -0.1], half: [0.7, 0.45, 1.8], pitch: 8 },
  neck: [
    [0, 0.3, 1.1, 0.2],
    [0, 1.15, 1.55, 0.16],
    [0, 1.85, 1.3, 0.14],
    [0, 2.36, 1.56, 0.13]
  ],
  head: { at: [0, 2.4, 1.68], half: [0.2, 0.2, 0.34], pitch: 15 },
  beak: { base: [0, 2.33, 1.98], half: 0.09, tip: [0, 2.18, 2.45] }
}
// [x, z, 头朝方位]：岛北水道 1 只、岛东北 1 只、岛南一对、西南 1 只，都离湖岸、岛岸 ≥ 4 m；
// 头朝方位多取在与机位视线（125° / 305°）近乎垂直的方向，侧影最好认
const SWANS = [
  [7501.0, -8998.8, 262],
  [7531.0, -8996.0, 215],
  [7494.0, -8964.0, 40],
  [7500.5, -8961.0, 50],
  [7472.0, -8952.0, 200]
]

/** 把几何体 geo 按矩阵 m 变换后的三角形顶点追加进 out（geo 不变） */
function pushGeo(out, geo, m) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone()
  g.applyMatrix4(m)
  out.push(...g.attributes.position.array)
  g.dispose()
}

/** 缩放 + 绕 X 轴俯仰（度，正值把 −Z 一端抬起）+ 平移 */
function poseMatrix(at, half, pitchDeg) {
  return new Matrix4()
    .makeTranslation(at[0], at[1], at[2])
    .multiply(new Matrix4().makeRotationX(pitchDeg * DEG))
    .multiply(new Matrix4().makeScale(half[0], half[1], half[2]))
}

/** 黑天鹅模板：[黑色部分（身体、颈、头）, 红喙]，局部坐标、法线按面计算 */
function swanTemplates() {
  const S = SWAN
  const black = []
  const ico = new IcosahedronGeometry(1, 0)
  // 二十面体顶点在单位球上，半轴缩放前先除以 ICO_HALF，外形的半长 / 半宽 / 半高才正好是 half
  const bh = S.body.half.map((v) => v / ICO_HALF)
  pushGeo(black, ico, poseMatrix(S.body.at, bh, S.body.pitch))
  ico.dispose()

  // 颈：每个截面点取前后点连线为切向，截面在 X 轴与「切向 × X 轴」张成的平面里（颈在 YZ 平面内）
  const rings = S.neck.map(([x, y, z, r], i) => {
    const prev = S.neck[Math.max(0, i - 1)]
    const next = S.neck[Math.min(S.neck.length - 1, i + 1)]
    const t = new Vector3(
      next[0] - prev[0],
      next[1] - prev[1],
      next[2] - prev[2]
    ).normalize()
    const u = new Vector3(1, 0, 0)
    const v = new Vector3().crossVectors(t, u).normalize()
    const ring = []
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2
      ring.push(
        new Vector3(x, y, z)
          .addScaledVector(u, Math.cos(a) * r)
          .addScaledVector(v, Math.sin(a) * r)
      )
    }
    return ring
  })
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let k = 0; k < 5; k++) {
      const a = rings[i][k]
      const b = rings[i][(k + 1) % 5]
      const c = rings[i + 1][(k + 1) % 5]
      const d = rings[i + 1][k]
      black.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
      black.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z)
    }
  }

  const oct = new OctahedronGeometry(1, 0)
  pushGeo(black, oct, poseMatrix(S.head.at, S.head.half, S.head.pitch))
  oct.dispose()

  // 喙：底面是垂直于 X 轴的平面里的小正方形（四角沿 ±X、±(底 → 尖垂直方向)），只做 4 个侧面
  const { base, half, tip } = S.beak
  const axis = new Vector3(
    tip[0] - base[0],
    tip[1] - base[1],
    tip[2] - base[2]
  ).normalize()
  const ux = new Vector3(1, 0, 0)
  const uy = new Vector3().crossVectors(axis, ux).normalize()
  const o = new Vector3(...base)
  const corners = [
    o.clone().addScaledVector(ux, half),
    o.clone().addScaledVector(uy, half),
    o.clone().addScaledVector(ux, -half),
    o.clone().addScaledVector(uy, -half)
  ]
  const red = []
  for (let k = 0; k < 4; k++) {
    const p = corners[k]
    const q = corners[(k + 1) % 4]
    red.push(p.x, p.y, p.z, q.x, q.y, q.z, ...tip)
  }
  return [fromTriangles(black), fromTriangles(red)]
}

function addSwans(b) {
  const [black, beak] = swanTemplates()
  for (const [x, z, heading] of SWANS) {
    // frame 局部 −Z 指向 bearing：让局部 +Z（头）指向 heading
    const F = frame(x, WATER_Y, z, heading + 180)
    b.add(black, L.pandaBlack, F)
    b.add(beak, C.swanRed, F)
  }
}

/* ---------------- 入口 ---------------- */

/**
 * 天鹅湖：驳岸（天鹅湖外环、东北小湖）、木栈平台与长椅、垂柳与湖心岛树、芦苇、黑天鹅。
 * 在 buildHalls 之后调用（竹韵餐厅、玫瑰苑已登记为实体）。
 */
export function buildLake(site) {
  addBank(site.gb, site.lakes.swan)
  addBank(site.gb, site.lakes.ne)
  for (const dk of DECKS) addDeck(site, dk)
  addLawnBench(site)
  plantTrees(site)
  addReeds(site.b)
  addSwans(site.b)
}

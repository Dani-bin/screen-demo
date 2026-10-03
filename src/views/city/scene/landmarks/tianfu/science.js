/*
 * 天府广场 · 北侧组团：四川科技馆
 * ----------------------------------------------------------
 * 职责：科技馆的体块、柱廊、窗、赭红线脚与楼顶招牌（设计第 4 节、报告 2.2 与 6.8；照片 c15、c21、c22）。
 * 由 north.js 的 buildNorth 调用；替换区、门前广场与路径在 north.js。
 * 轮廓取 OpenStreetMap（报告 2.2）：主体 r21034011（142.2 × 104.4，高 30.75，中间有内院）、
 * 前楼 w1395649617（125.9 × 25.4，30.75 → 38）、4 座塔 w1532678575～78（约 7 × 9，高 40）。
 * 坐标：科技馆系 M——原点在正立面中点（OSM 楼顶招牌点 n13970973053），方位角 −1.39°，
 * +X 向东（略偏北）、+Z 向南（正门）。轮廓是 OSM 换到 M 系后取到 0.1 m，由下面几条关键线拼出。
 * 高度从组团地坪 NORTH_Y 起算（site.js），外墙从城市地面 GROUND_Y 立起。
 * 与旧模型的差别（报告 5）：加高到 30.75 / 38 / 40，去掉砖红塔楼，换成米黄塔身 + 赭红压顶、
 * 10 根赭红柱、横梁与窗带、屋顶红字。
 */
import { Matrix4 } from "three"
import { local } from "../kit/builder.js"
import { box, fromTriangles, sideWalls } from "../kit/shapes.js"
import { GROUND_Y } from "../../terrain.js"
import { C } from "./colors.js"
import { NORTH_Y } from "./site.js"
import { addPrism, addSurface, rectUV } from "./surface.js"

/* ---------------- 尺寸与定位（科技馆系 M） ---------------- */

// 原点：正立面中点（OSM 楼顶招牌点 n13970973053，正好在前楼南墙中点上）
export const SCIENCE = { lon: 104.0633096, lat: 30.6620219, bearing: -1.39 }
// 高度（OSM）：主体 30.75、前楼顶 38、塔顶 40（含 1.2 m 赭红压顶）
const SCI_H = { body: 30.75, front: 38, tower: 40, cap: 1.2 }

// 轮廓上的关键线（M 系）：
const FACE_Z = 0 // 正立面：前楼南墙、两翼、两端低翼
const PORTICO_Z = -5.2 // 柱廊后墙（主体南墙在两内塔之间退到这里）；前楼两端也退后到这条线
const SLOT_Z = -7.0 // 塔槽北沿：4 座塔塞在主体与前楼南墙的槽里
const BODY_Z = -22.5 // 主体前部北沿 = 前楼北墙 = 内院南沿
const BACK_Z = -101.3 // 后部主体北墙
const END_X = [-70.9, 70.7] // 两端低翼外墙（主体前部东西两端）
const REAR_X = [-55.9, 56.2] // 后部主体东西墙
const FRONT_X = [-62.6, 62.8] // 前楼东西两端
// 4 座塔（w1532678575～78）：自西向东的 x 区间；南北 z 2.0 → −7.0（比立面凸出 2 m）
const SCI_TOWERS = [
  [-61.5, -54.4],
  [-36.1, -29.7],
  [29.7, 36.7],
  [55.0, 61.3]
]
const [T0, T1, T2, T3] = SCI_TOWERS
const TOWER_Z = [2.0, SLOT_Z]

/** 南墙上一座塔的槽，自东向西走：东侧立面 zE → 槽底两角 → 西侧立面 zW */
const slot = ([x0, x1], zE, zW) => [
  [x1, zE],
  [x1, SLOT_Z],
  [x0, SLOT_Z],
  [x0, zW]
]

// 主体（r21034011 外环，高 30.75）：前部一条 141.6 × 22.5 横贯东西，后部 112 × 78.8；
// 南墙在 4 座塔处各让出一个槽（塔填进去），两内塔之间退到柱廊后墙
const SCI_BODY = [
  [END_X[0], FACE_Z],
  [END_X[0], BODY_Z],
  [REAR_X[0], BODY_Z],
  [REAR_X[0], BACK_Z],
  [REAR_X[1], BACK_Z],
  [REAR_X[1], BODY_Z],
  [END_X[1], BODY_Z],
  [END_X[1], FACE_Z],
  ...slot(T3, FACE_Z, FACE_Z),
  ...slot(T2, FACE_Z, PORTICO_Z),
  ...slot(T1, PORTICO_Z, FACE_Z),
  ...slot(T0, FACE_Z, FACE_Z)
]
// 内院（r21034011 内环）：南沿就是前楼北墙
const SCI_COURT = rectUV(-41.9, 44.0, -79.3, BODY_Z)
// 前楼（w1395649617，30.75 → 38）：南墙自西向东（槽反着走），两内塔之间不退后（压在柱廊上），
// 东西两端外塔以外的 1～1.5 m 退后到 PORTICO_Z
const SCI_FRONT = [
  [FRONT_X[0], BODY_Z],
  [FRONT_X[0], PORTICO_Z],
  ...slot(T0, FACE_Z, PORTICO_Z).reverse(),
  ...slot(T1, FACE_Z, FACE_Z).reverse(),
  ...slot(T2, FACE_Z, FACE_Z).reverse(),
  ...slot(T3, PORTICO_Z, FACE_Z).reverse(),
  [FRONT_X[1], PORTICO_Z],
  [FRONT_X[1], BODY_Z]
]

// 柱廊（报告 6.8；照片 c21、c22 数得 10 根柱、9 开间）：两内塔之间 59.4 m，
// 10 根 2.2 m 见方的柱，柱心从 −26.6 到 26.6 等距（间距 5.91，净开间 3.71），柱前面与立面平；
// 柱高 24（含 0.8 柱础、1.0 柱头）
const COLONNADE = {
  x0: -26.6,
  x1: 26.6,
  n: 10,
  size: 2.2,
  h: 24,
  base: 0.8,
  cap: 1.0
}
// 柱间玻璃：贴柱廊后墙，窗底 0.6、高 21.9（到柱头下）；宽 = 净开间 − 0.5
const PORTICO_GLASS = { y: 0.6, h: 21.9, margin: 0.5 }

// 赭红线脚（照片 c15、c21）：柱廊横梁 24～26.2；两翼腰线与横梁同高（24.4～25.8）；顶上檐口 1.2 m。
// 都是贴在立面外的薄板，d 为挑出深度。前楼南沿那条檐口两端各伸进外塔 tuck：
// 端面若正好落在塔的外侧面上，红、米黄两面同向重叠会闪（审查实测两处各 0.72 m²），伸进去就藏在塔里
const BEAM = { y: 24, h: 2.2, d: 0.6 }
const BELT = { y: 24.4, h: 1.4, d: 0.5 }
const CORNICE = { h: 1.2, d: 0.6, tuck: 0.05 }

// 窗参数表（照片 c15、c21 估）：w × h 为窗洞宽高，y / rows 为窗底高度（OSM 高度），
// 窗片是贴在墙外 gap 处的单面四边形
const FLOORS = [2.6, 8.3, 14.0, 19.7] // 腰线以下四层的窗底（c15 两翼腰线以下 4 层，层高约 5.7）
const WIN = {
  gap: 0.06,
  // 横梁以上那排：柱廊上方每个开间一扇，共 9 扇（c21）；两翼同排各 3 扇，宽取两翼的 wing.w
  band: { w: 3.0, h: 4.6, y: 28.6 },
  // 两翼（内外塔之间）：腰线以下每层 3 扇，间距 5.6（c15）
  wing: { w: 3.2, h: 3.4, step: 5.6 },
  // 两端低翼（外塔以外，30.75 高）：南墙每层 2 扇、离中线 2.3；比两翼多一层 24.8（c15 左端）
  end: { w: 2.6, h: 3.0, step: 2.3, rows: [...FLOORS, 24.8] },
  // 低翼东西墙：每层 4 扇，z −3.5～−19（层同 end.rows）
  endSide: { w: 2.6, h: 3.0, z0: -3.5, z1: -19, n: 4 },
  // 后部主体东西墙：每层 13 扇，z −26～−98（间距 6；层同 end.rows）
  rearSide: { w: 2.8, h: 3.0, z0: -26, z1: -98, n: 13 }
}

// 内院：OSM 只标了环形主体；Google 影像里院子被一层低屋面盖住，中间一座南北向的大拱顶
// （宽约 35.5、长约 45）。高度没有资料，取低屋面 14、拱顶再高 9（都低于主体 30.75）
const COURT_ROOF = 14
const VAULT = { x: 1.4, hw: 17.6, z0: -24, z1: -68, rise: 9, seg: 8 }

// 楼顶招牌（c15、old1）：5 个红色书法大字各约 6 m，每字一个白色方框架；下面一行红色英文。
// 立在前楼屋面靠南沿（z −2.4），字心间距 7.2。自下而上：底梁 base、英文底板 panel、空 lift、方框架 frame；
// 方框架的两根竖边往下伸到底梁顶上兼作立柱（底板在框前面，不挡）
const SIGN = {
  z: -2.4,
  pitch: 7.2,
  frame: [6.4, 6.8],
  bar: 0.35,
  base: 0.5,
  panel: 1.5,
  lift: 0.2
}
// 笔画：每字在 6 × 6.4 的格子里用几根扁方条拼出大致字形（不追求真字形，读出「一排红字」即可）。
// 每一笔是 [x0, y0, x1, y1]（格内坐标：x 以字心为 0，y 从框底算起）
const GLYPHS = [
  // 四
  [
    [-2.5, 5.6, 2.6, 5.7],
    [-2.5, 5.6, -2.6, 0.8],
    [2.6, 5.7, 2.5, 0.8],
    [-2.6, 0.8, 2.5, 0.8],
    [-0.8, 5.5, -1.5, 2.6],
    [0.8, 5.5, 1.8, 2.6]
  ],
  // 川
  [
    [-1.9, 6, -2.4, 0.6],
    [0, 5.4, 0, 1.4],
    [2.1, 6.2, 2.1, 0.3]
  ],
  // 科
  [
    [-0.9, 6, -2.6, 5.2],
    [-2.8, 4.2, -0.4, 4.3],
    [-1.6, 5.4, -1.6, 0.3],
    [-1.7, 3.9, -2.9, 1.8],
    [0.5, 4.6, 1.3, 3.6],
    [0.1, 2.2, 2.9, 2.7],
    [2.1, 6.1, 2.1, 0.3]
  ],
  // 技
  [
    [-2.8, 4.4, -0.8, 4.6],
    [-1.8, 6, -1.8, 0.7],
    [-2.8, 2, -0.8, 3],
    [0, 4.9, 2.9, 4.9],
    [1.45, 6.1, 1.45, 3.5],
    [0.3, 3.3, 2.6, 3.2],
    [2.6, 3.2, 0.2, 0.4],
    [1, 2.2, 2.9, 0.3]
  ],
  // 馆
  [
    [-1.9, 6, -2.9, 4.2],
    [-2.4, 3.8, -2.4, 0.6],
    [-2.4, 0.6, -1.3, 1.4],
    [-0.5, 5.2, 2.9, 5.2],
    [1.2, 6.2, 1.2, 5.2],
    [0.2, 4.2, 0.2, 0.3],
    [0.2, 4.2, 2.4, 4.2],
    [2.4, 4.2, 2.4, 0.3],
    [0.2, 2.3, 2.4, 2.3],
    [0.2, 0.3, 2.6, 0.3]
  ]
]
const STROKE = { w: 0.75, d: 0.4 }
// 英文条「SICHUAN SCIENCE AND TECHNOLOGY MUSEUM」：每个单词一根红条，长度按字母数（每字母 0.92 m）
const ENGLISH = { words: [7, 7, 3, 10, 6], letter: 0.92, gap: 1.0, h: 0.9 }

/* ---------------- 小工具 ---------------- */

/** 高度：OSM 高度 h（从组团地坪起算）→ 世界 y */
const Y = (h) => NORTH_Y + h

/**
 * 立面上排一组矩形窗片（单面四边形，法线朝立面外侧），写进 pos。
 * face = { axis, at, dir }：axis "z" 为南北立面（z = at，dir 1 法线朝 +Z、−1 朝 −Z），
 * axis "x" 为东西立面（x = at，dir 1 朝 +X、−1 朝 −X）。
 * us 为窗中心沿立面的坐标（南北立面是 x、东西立面是 z），ys 为窗底高度
 */
function addWindows(pos, { axis, at, dir }, us, ys, w, h) {
  // 法线朝 +Z 时沿 +x 绕；朝 +X 时要沿 −z 绕，所以东西立面的走向反过来
  const s = axis === "z" ? dir : -dir
  const P = axis === "z" ? (u, y) => [u, y, at] : (u, y) => [at, y, u]
  for (const y of ys) {
    for (const u of us) {
      const ua = u - (s * w) / 2
      const ub = u + (s * w) / 2
      pos.push(...P(ua, y), ...P(ub, y), ...P(ub, y + h))
      pos.push(...P(ua, y), ...P(ub, y + h), ...P(ua, y + h))
    }
  }
}

/** 等距取 n 个数：a → c（含两端） */
const spread = (a, c, n) =>
  Array.from({ length: n }, (_, i) => a + ((c - a) * i) / (n - 1))

/* ---------------- 立面分段（几个函数共用） ---------------- */

// 柱廊两端：两内塔相对的两个侧面
const [TX0, TX1] = [T1[1], T2[0]]
// 10 根柱的柱心、9 个开间的中心（柱廊玻璃、柱廊上方那排窗都按开间排）
const COLS = spread(COLONNADE.x0, COLONNADE.x1, COLONNADE.n)
const BAYS = COLS.slice(1).map((x, i) => (x + COLS[i]) / 2)
// 两翼：内外塔之间那两段 38 m 高的立面
const WINGS = [
  [T0[1], T1[0]],
  [T2[1], T3[0]]
]
// 两端低翼：外塔以外、只有 30.75 m 高的两段
const ENDS = [
  [END_X[0], T0[0]],
  [T3[1], END_X[1]]
]

/* ---------------- 体块、柱廊、窗、线脚 ---------------- */

/** 体块：主体（墙米黄、屋面灰）、前楼、柱廊上方的檐墙、内院低屋面与拱顶、4 座塔 */
function buildMasses(b, f) {
  addPrism(
    b,
    f,
    SCI_BODY,
    [SCI_COURT],
    GROUND_Y,
    Y(SCI_H.body),
    C.sciWall,
    C.roofGrey
  )
  b.add(sideWalls(SCI_FRONT, Y(SCI_H.body), Y(SCI_H.front)), C.sciWall, f)
  addSurface(b, f, SCI_FRONT, [], () => Y(SCI_H.front), C.roofGrey)
  // 柱廊上方的檐墙：两内塔之间、柱廊后墙以南，24 → 30.75，底面就是柱廊顶棚（保留底面）
  b.add(
    box(TX1 - TX0, SCI_H.body - BEAM.y, -PORTICO_Z, { bottom: true }),
    C.sciWall,
    local(f, (TX0 + TX1) / 2, Y(BEAM.y), PORTICO_Z / 2)
  )

  // 内院：低屋面 + 南北向拱顶（半椭圆截面，seg 段）
  addSurface(b, f, SCI_COURT, [], () => Y(COURT_ROOF), C.roofGrey)
  const vault = []
  const arc = (k) => {
    const a = (Math.PI * k) / VAULT.seg
    return [
      VAULT.x + VAULT.hw * Math.cos(a),
      Y(COURT_ROOF) + VAULT.rise * Math.sin(a)
    ]
  }
  const yr = Y(COURT_ROOF)
  for (let k = 0; k < VAULT.seg; k++) {
    const [xa, ya] = arc(k)
    const [xb, yb] = arc(k + 1)
    // a / b 为这一段拱面的东 / 西两条母线，0 / 1 为南 / 北端
    const [a0, a1] = [
      [xa, ya, VAULT.z0],
      [xa, ya, VAULT.z1]
    ]
    const [b0, b1] = [
      [xb, yb, VAULT.z0],
      [xb, yb, VAULT.z1]
    ]
    // 拱面：从东往西绕，法线朝外上方
    vault.push(...a0, ...a1, ...b1, ...a0, ...b1, ...b0)
    // 南北两端的半椭圆封面：南端（z0）法线朝 +Z、北端（z1）朝 −Z
    vault.push(VAULT.x, yr, VAULT.z0, ...a0, ...b0)
    vault.push(VAULT.x, yr, VAULT.z1, ...b1, ...a1)
  }
  b.add(fromTriangles(vault), C.sciVault, f)

  // 4 座塔：米黄塔身到 38.8，顶上 1.2 m 赭红压顶（四周各挑出 0.3），去掉旧模型的砖红塔楼
  const tz = (TOWER_Z[0] + TOWER_Z[1]) / 2
  const td = TOWER_Z[0] - TOWER_Z[1]
  for (const [x0, x1] of SCI_TOWERS) {
    const w = x1 - x0
    const xm = (x0 + x1) / 2
    const body = Y(SCI_H.tower - SCI_H.cap) - GROUND_Y
    b.add(box(w, body, td), C.sciWall, local(f, xm, GROUND_Y, tz))
    b.add(
      box(w + 0.6, SCI_H.cap, td + 0.6),
      C.sciRed,
      local(f, xm, Y(SCI_H.tower - SCI_H.cap), tz)
    )
  }
}

/** 柱廊：10 根赭红方柱（白色柱础、柱头，柱前面与立面平），柱间深色玻璃贴在柱廊后墙上 */
function buildColonnade(b, f) {
  const cs = COLONNADE.size
  const shaft = COLONNADE.h - COLONNADE.base - COLONNADE.cap
  for (const x of COLS) {
    const m = local(f, x, Y(0), -cs / 2)
    b.add(box(cs + 0.4, COLONNADE.base, cs + 0.4), C.sciWhite, m)
    b.add(box(cs, shaft, cs), C.sciColumn, local(m, 0, COLONNADE.base, 0))
    b.add(
      box(cs + 0.5, COLONNADE.cap, cs + 0.5),
      C.sciWhite,
      local(m, 0, COLONNADE.base + shaft, 0)
    )
  }
  // 柱间深色玻璃：每个开间一块
  const g = PORTICO_GLASS
  const glass = []
  addWindows(
    glass,
    { axis: "z", at: PORTICO_Z + WIN.gap, dir: 1 },
    BAYS,
    [Y(g.y)],
    COLS[1] - COLS[0] - cs - g.margin,
    g.h
  )
  b.add(fromTriangles(glass), C.sciGlass, f)
}

/**
 * 窗（尺寸见 WIN 表）：柱廊上方一排 9 扇；两翼各 4 层 × 3 + 顶排 3；两端低翼 5 层 × 2；
 * 侧立面（低翼东西墙、后部主体东西墙）5 层
 */
function buildWindows(b, f) {
  const win = []
  const south = { axis: "z", at: FACE_Z + WIN.gap, dir: 1 }
  const { band, wing, end, endSide, rearSide } = WIN
  addWindows(win, south, BAYS, [Y(band.y)], band.w, band.h)
  for (const [x0, x1] of WINGS) {
    const xm = (x0 + x1) / 2
    const xs = [xm - wing.step, xm, xm + wing.step]
    addWindows(win, south, xs, FLOORS.map(Y), wing.w, wing.h)
    addWindows(win, south, xs, [Y(band.y)], wing.w, band.h)
  }
  const endRows = end.rows.map(Y)
  for (const [x0, x1] of ENDS) {
    const xm = (x0 + x1) / 2
    addWindows(
      win,
      south,
      [xm - end.step, xm + end.step],
      endRows,
      end.w,
      end.h
    )
  }
  // 东西立面：西墙法线朝 −X、东墙朝 +X
  const sides = [
    [endSide, END_X],
    [rearSide, REAR_X]
  ]
  for (const [p, xs] of sides) {
    const zs = spread(p.z0, p.z1, p.n)
    addWindows(
      win,
      { axis: "x", at: xs[0] - WIN.gap, dir: -1 },
      zs,
      endRows,
      p.w,
      p.h
    )
    addWindows(
      win,
      { axis: "x", at: xs[1] + WIN.gap, dir: 1 },
      zs,
      endRows,
      p.w,
      p.h
    )
  }
  b.add(fromTriangles(win), C.sciWindow, f)
}

/** 赭红线脚（c15、c21）：柱廊横梁、两翼腰线（同高）、前楼与主体顶上的檐口 */
function buildTrims(b, f) {
  const red = (w, h, d, x, y, z) =>
    b.add(box(w, h, d), C.sciRed, local(f, x, y, z))
  red(TX1 - TX0, BEAM.h, BEAM.d, (TX0 + TX1) / 2, Y(BEAM.y), BEAM.d / 2)
  for (const [x0, x1] of WINGS)
    red(x1 - x0, BELT.h, BELT.d, (x0 + x1) / 2, Y(BELT.y), BELT.d / 2)
  const { h: ch, d: cd } = CORNICE
  // 前楼南沿（两外塔外侧面以内 tuck；外端退后的一小段不挑）与东西两端
  const yf = Y(SCI_H.front - ch)
  const [fx0, fx1] = [T0[0] + CORNICE.tuck, T3[1] - CORNICE.tuck]
  red(fx1 - fx0, ch, cd, (fx0 + fx1) / 2, yf, cd / 2)
  const [fd, fz] = [PORTICO_Z - BODY_Z, (PORTICO_Z + BODY_Z) / 2]
  red(cd, ch, fd, FRONT_X[0] - cd / 2, yf, fz)
  red(cd, ch, fd, FRONT_X[1] + cd / 2, yf, fz)
  // 主体：两端低翼南沿与外侧墙、后部东西墙、北墙
  const yb = Y(SCI_H.body - ch)
  for (const [x0, x1] of ENDS) red(x1 - x0, ch, cd, (x0 + x1) / 2, yb, cd / 2)
  const [ed, ez] = [FACE_Z - BODY_Z, (FACE_Z + BODY_Z) / 2]
  red(cd, ch, ed, END_X[0] - cd / 2, yb, ez)
  red(cd, ch, ed, END_X[1] + cd / 2, yb, ez)
  const [rd, rz] = [BODY_Z - BACK_Z, (BODY_Z + BACK_Z) / 2]
  red(cd, ch, rd, REAR_X[0] - cd / 2, yb, rz)
  red(cd, ch, rd, REAR_X[1] + cd / 2, yb, rz)
  const [bx0, bx1] = REAR_X
  red(bx1 - bx0 + 2 * cd, ch, cd, (bx0 + bx1) / 2, yb, BACK_Z - cd / 2)
}

/* ---------------- 楼顶招牌 ---------------- */

/** 招牌笔画：父坐标系里 (x0, y0) → (x1, y1) 的一根扁方条，立在 z 平面上（宽 w、厚 d），两端各伸出半个笔宽 */
function addStroke(b, f, [x0, y0], [x1, y1], z, color) {
  const len = Math.hypot(x1 - x0, y1 - y0)
  const m = new Matrix4().makeRotationZ(Math.atan2(y1 - y0, x1 - x0))
  m.setPosition((x0 + x1) / 2, (y0 + y1) / 2, z)
  // 斜放的笔画底面会转到侧面，所以保留底面
  const g = box(len + STROKE.w, STROKE.w, STROKE.d, { bottom: true })
  g.translate(0, -STROKE.w / 2, 0)
  b.add(g, color, f.clone().multiply(m))
}

/** 楼顶招牌：白色底梁、英文条（白底红字条）、5 个白色方框架与红色大字 */
function buildSign(b, f) {
  const y0 = NORTH_Y + SCI_H.front
  const z = SIGN.z
  const [fw, fh] = SIGN.frame
  const span = SIGN.pitch * 4 + fw
  b.add(box(span, SIGN.base, 1.2), C.sciWhite, local(f, 0, y0, z))
  // 英文条：白色底板上 5 根红条（单词），总长按字母数 + 词间距
  const eb = y0 + SIGN.base
  b.add(box(span, SIGN.panel, 0.3), C.sciWhite, local(f, 0, eb, z + 0.45))
  const lens = ENGLISH.words.map((n) => n * ENGLISH.letter)
  const total =
    lens.reduce((s, l) => s + l, 0) + ENGLISH.gap * (lens.length - 1)
  let x = -total / 2
  for (const l of lens) {
    b.add(
      box(l, ENGLISH.h, 0.15),
      C.sign,
      local(f, x + l / 2, eb + 0.3, z + 0.67)
    )
    x += l + ENGLISH.gap
  }
  // 方框架与大字：框底离底梁顶 leg，两根竖边从底梁顶立到顶边下（兼作立柱）；
  // 底边夹在两根竖边之间、顶边压在竖边上，各段只相接不重叠
  const fy = eb + SIGN.panel + SIGN.lift
  const leg = fy - eb
  GLYPHS.forEach((strokes, i) => {
    const cx = (i - 2) * SIGN.pitch
    const t = SIGN.bar
    const fm = local(f, cx, fy, z)
    b.add(box(fw - 2 * t, t, t), C.sciWhite, fm)
    b.add(box(fw, t, t), C.sciWhite, local(fm, 0, fh - t, 0))
    for (const s of [-1, 1]) {
      b.add(
        box(t, fh - t + leg, t),
        C.sciWhite,
        local(fm, (s * (fw - t)) / 2, -leg, 0)
      )
    }
    for (const [px, py, qx, qy] of strokes) {
      addStroke(
        b,
        f,
        [cx + px, fy + py + 0.1],
        [cx + qx, fy + qy + 0.1],
        z + 0.4,
        C.sign
      )
    }
  })
}

/* ---------------- 入口 ---------------- */

/**
 * 四川科技馆：体块 → 柱廊 → 窗 → 线脚 → 楼顶招牌（顺序决定合批后的顶点顺序，不要调换）。
 * 墙米黄（#E6D6AA），屋面灰（Google 影像）。
 * @param {ColorBuilder} b 静态件
 * @param {Matrix4} f 科技馆系 M（north.js 由 SCIENCE 建），局部 +Z 朝南（正门）
 */
export function buildScience(b, f) {
  buildMasses(b, f)
  buildColonnade(b, f)
  buildWindows(b, f)
  buildTrims(b, f)
  buildSign(b, f)
}

/*
 * 天府广场 · 北侧组团：四川科技馆
 * ----------------------------------------------------------
 * 职责：科技馆的体块、柱廊、窗、赭红线脚与楼顶招牌（设计第 4 节、报告 2.2 与 6.8；照片 c15、c21、c22）。
 * 由 north.js 的 buildNorth 调用；替换区、门前广场与路径在 north.js。
 * 轮廓取 OpenStreetMap（报告 2.2）：主体 r21034011（142.2 × 104.4，高 30.75，中间有内院）、
 * 前楼 w1395649617（125.9 × 25.4，30.75 → 38）、4 座塔 w1532678575～78（约 7 × 9，高 40）。
 * 坐标：科技馆系 M——原点在正立面中点（OSM 楼顶招牌点 n13970973053），方位角 −1.39°，
 * +X 向东（略偏北）、+Z 向南（正门）。多边形是 OSM 轮廓换到 M 系后取到 0.1 m。
 * 高度从组团地坪 NORTH_Y 起算（site.js），外墙从城市地面 GROUND_Y 立起。
 * 与旧模型的差别（报告 5）：加高到 30.75 / 38 / 40，去掉砖红塔楼，换成米黄塔身 + 赭红压顶、
 * 10 根赭红柱、横梁与窗带、屋顶红字。
 */
import { Matrix4 } from "three"
import { local } from "../kit/builder.js"
import { box, fromTriangles, sideWalls } from "../kit/shapes.js"
import { GROUND_Y } from "../../terrain.js"
import { C, NORTH_Y, addPrism, addSurface, rectUV } from "./site.js"

/* ---------------- 尺寸与定位（科技馆系 M） ---------------- */

// 原点：正立面中点（OSM 楼顶招牌点 n13970973053，正好在前楼南墙中点上）
export const SCIENCE = { lon: 104.0633096, lat: 30.6620219, bearing: -1.39 }
const SCI_H = { body: 30.75, front: 38, tower: 40, cap: 1.2 }

// 主体（r21034011 外环，高 30.75）：前部一条 141.6 × 22.5 横贯东西，后部 112 × 78.8；
// 南墙在 4 座塔处各让出一个槽（塔填进去），两内塔之间退后 5.2 m 成柱廊
const SCI_BODY = [
  [-70.9, 0],
  [-70.9, -22.5],
  [-55.9, -22.5],
  [-55.9, -101.3],
  [56.2, -101.3],
  [56.2, -22.5],
  [70.7, -22.5],
  [70.7, 0],
  [61.3, 0],
  [61.3, -7.0],
  [55.0, -7.0],
  [55.0, 0],
  [36.7, 0],
  [36.7, -7.0],
  [29.7, -7.0],
  [29.7, -5.2],
  [-29.7, -5.2],
  [-29.7, -7.0],
  [-36.1, -7.0],
  [-36.1, 0],
  [-54.4, 0],
  [-54.4, -7.0],
  [-61.5, -7.0],
  [-61.5, 0]
]
// 内院（r21034011 内环）：南沿就是前楼北墙
const SCI_COURT = rectUV(-41.9, 44.0, -79.3, -22.5)
// 前楼（w1395649617，30.75 → 38）：东西两端各有 1～1.5 m 退后 5.2 m；同样在塔处让槽
const SCI_FRONT = [
  [-62.6, -22.5],
  [-62.6, -5.2],
  [-61.5, -5.2],
  [-61.5, -7.0],
  [-54.4, -7.0],
  [-54.4, 0],
  [-36.1, 0],
  [-36.1, -7.0],
  [-29.7, -7.0],
  [-29.7, 0],
  [29.7, 0],
  [29.7, -7.0],
  [36.7, -7.0],
  [36.7, 0],
  [55.0, 0],
  [55.0, -7.0],
  [61.3, -7.0],
  [61.3, -5.2],
  [62.8, -5.2],
  [62.8, -22.5]
]
// 4 座塔（w1532678575～78）：x 区间，南北都是 z 2.0 → −7.0（比立面凸出 2 m）
const SCI_TOWERS = [
  [-61.5, -54.4],
  [-36.1, -29.7],
  [29.7, 36.7],
  [55.0, 61.3]
]
const TOWER_Z = [2.0, -7.0]
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
// 柱廊后墙（主体南墙退后处）
const PORTICO_Z = -5.2
// 窗带与线脚高度（照片 c15、c21：赭红横梁与两翼的赭红腰线同高，横梁以上一排窗，顶上赭红檐口）
const BEAM = { y: 24, h: 2.2 }
const CORNICE_H = 1.2
const BAND = { y: 28.6, h: 4.6 } // 横梁以上那排窗（柱廊 9 个，两翼各 3 个）
const FLOOR_ROWS = [2.6, 8.3, 14.0, 19.7] // 腰线以下四层窗的窗底
// 内院：OSM 只标了环形主体；Google 影像里院子被一层低屋面盖住，中间一座南北向的大拱顶
// （宽约 35.5、长约 45）。高度没有资料，取低屋面 14、拱顶再高 9（都低于主体 30.75）
const COURT_ROOF = 14
const VAULT = { x: 1.4, hw: 17.6, z0: -24, z1: -68, rise: 9, seg: 8 }

// 楼顶招牌（c15、old1）：5 个红色书法大字各约 6 m，每字一个白色方框架；下面一行红色英文。
// 立在前楼屋面靠南沿（z −2.4），字心间距 7.2
const SIGN = { z: -2.4, pitch: 7.2, frame: [6.4, 6.8], bar: 0.35, base: 0.5 }
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

/** 南立面（z = zf，法线朝 +Z）上排窗：xs 为窗中心、ys 为窗底，写进 pos */
function frontWindows(pos, xs, ys, w, h, zf) {
  for (const y of ys) {
    for (const x of xs) {
      const x0 = x - w / 2
      const x1 = x + w / 2
      pos.push(x0, y, zf, x1, y, zf, x1, y + h, zf)
      pos.push(x0, y, zf, x1, y + h, zf, x0, y + h, zf)
    }
  }
}

/**
 * 东西立面（x = xf）上排窗：zs 为窗中心、ys 为窗底，写进 pos。
 * dir = 1 为东立面（法线朝 +X），−1 为西立面：沿 z 减小方向绕时法线朝 +X
 */
function sideWindows(pos, zs, ys, w, h, xf, dir) {
  for (const y of ys) {
    for (const z of zs) {
      const za = z + (dir * w) / 2
      const zb = z - (dir * w) / 2
      pos.push(xf, y, za, xf, y, zb, xf, y + h, zb)
      pos.push(xf, y, za, xf, y + h, zb, xf, y + h, za)
    }
  }
}

/** 等距取 n 个数：a → c（含两端） */
const spread = (a, c, n) =>
  Array.from({ length: n }, (_, i) => a + ((c - a) * i) / (n - 1))

/* ---------------- 立面分段（几个函数共用） ---------------- */

// 柱廊两端：两内塔相对的两个侧面
const [TX0, TX1] = [SCI_TOWERS[1][1], SCI_TOWERS[2][0]]
// 10 根柱的柱心、9 个开间的中心（柱廊玻璃、柱廊上方那排窗都按开间排）
const COLS = spread(COLONNADE.x0, COLONNADE.x1, COLONNADE.n)
const BAYS = COLS.slice(1).map((x, i) => (x + COLS[i]) / 2)
// 两翼：内外塔之间那两段 38 m 高的立面
const WINGS = [
  [SCI_TOWERS[0][1], SCI_TOWERS[1][0]],
  [SCI_TOWERS[2][1], SCI_TOWERS[3][0]]
]
// 两端低翼：外塔以外、只有 30.75 m 高的两段
const ENDS = [
  [SCI_BODY[0][0], SCI_TOWERS[0][0]],
  [SCI_TOWERS[3][1], SCI_BODY[7][0]]
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

/** 柱廊：10 根赭红方柱（白色柱础、柱头，柱前面与立面平 z 0），柱间深色玻璃贴在柱廊后墙上 */
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
  const bayW = COLS[1] - COLS[0] - cs - 0.5
  const glass = []
  frontWindows(glass, BAYS, [Y(0.6)], bayW, 21.9, PORTICO_Z + 0.06)
  b.add(fromTriangles(glass), C.sciGlass, f)
}

/**
 * 窗：柱廊上方一排 9 个；两内外塔之间的两翼各 4 层 × 3 + 顶排 3；最外两端低翼 5 层 × 2；
 * 侧立面（外端低翼东西墙、后部主体东西墙）5 层窗
 */
function buildWindows(b, f) {
  const win = []
  frontWindows(win, BAYS, [Y(BAND.y)], 3.0, BAND.h, 0.06)
  for (const [x0, x1] of WINGS) {
    const xm = (x0 + x1) / 2
    const xs = [xm - 5.6, xm, xm + 5.6]
    frontWindows(win, xs, FLOOR_ROWS.map(Y), 3.2, 3.4, 0.06)
    frontWindows(win, xs, [Y(BAND.y)], 3.2, BAND.h, 0.06)
  }
  const endRows = [...FLOOR_ROWS, 24.8].map(Y)
  for (const [x0, x1] of ENDS) {
    const xm = (x0 + x1) / 2
    frontWindows(win, [xm - 2.3, xm + 2.3], endRows, 2.6, 3.0, 0.06)
  }
  const endZs = spread(-3.5, -19, 4)
  sideWindows(win, endZs, endRows, 2.6, 3.0, SCI_BODY[0][0] - 0.06, -1)
  sideWindows(win, endZs, endRows, 2.6, 3.0, SCI_BODY[7][0] + 0.06, 1)
  const rearZs = spread(-26, -98, 13)
  sideWindows(win, rearZs, endRows, 2.8, 3.0, SCI_BODY[2][0] - 0.06, -1)
  sideWindows(win, rearZs, endRows, 2.8, 3.0, SCI_BODY[5][0] + 0.06, 1)
  b.add(fromTriangles(win), C.sciWindow, f)
}

/** 赭红线脚（c15、c21）：柱廊横梁、两翼腰线（同高）、前楼与主体顶上的檐口 */
function buildTrims(b, f) {
  const red = (w, h, d, x, y, z) =>
    b.add(box(w, h, d), C.sciRed, local(f, x, y, z))
  red(TX1 - TX0, BEAM.h, 0.6, (TX0 + TX1) / 2, Y(BEAM.y), 0.3)
  for (const [x0, x1] of WINGS)
    red(x1 - x0, 1.4, 0.5, (x0 + x1) / 2, Y(24.4), 0.25)
  const ch = CORNICE_H
  // 前楼南沿（两外塔外侧之间；外端退后的一小段不挑）与东西两端
  const [fx0, fx1] = [SCI_TOWERS[0][0], SCI_TOWERS[3][1]]
  red(fx1 - fx0, ch, 0.6, (fx0 + fx1) / 2, Y(SCI_H.front - ch), 0.3)
  red(0.6, ch, 17.3, SCI_FRONT[0][0] - 0.3, Y(SCI_H.front - ch), -13.85)
  red(0.6, ch, 17.3, SCI_FRONT[19][0] + 0.3, Y(SCI_H.front - ch), -13.85)
  // 主体：两端低翼南沿与外侧墙、后部东西墙、北墙
  const yb = Y(SCI_H.body - ch)
  for (const [x0, x1] of ENDS) red(x1 - x0, ch, 0.6, (x0 + x1) / 2, yb, 0.3)
  red(0.6, ch, 22.5, SCI_BODY[0][0] - 0.3, yb, -11.25)
  red(0.6, ch, 22.5, SCI_BODY[7][0] + 0.3, yb, -11.25)
  const [rz0, rz1] = [SCI_BODY[2][1], SCI_BODY[3][1]]
  red(0.6, ch, rz0 - rz1, SCI_BODY[2][0] - 0.3, yb, (rz0 + rz1) / 2)
  red(0.6, ch, rz0 - rz1, SCI_BODY[5][0] + 0.3, yb, (rz0 + rz1) / 2)
  const [bx0, bx1] = [SCI_BODY[3][0], SCI_BODY[4][0]]
  red(bx1 - bx0 + 1.2, ch, 0.6, (bx0 + bx1) / 2, yb, rz1 - 0.3)
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
  b.add(box(span, 1.5, 0.3), C.sciWhite, local(f, 0, eb, z + 0.45))
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
  // 方框架与大字
  const fy = eb + 1.5 + 0.2
  GLYPHS.forEach((strokes, i) => {
    const cx = (i - 2) * SIGN.pitch
    const t = SIGN.bar
    const fm = local(f, cx, fy, z)
    b.add(box(fw, t, t), C.sciWhite, fm)
    b.add(box(fw, t, t), C.sciWhite, local(fm, 0, fh - t, 0))
    for (const s of [-1, 1]) {
      b.add(
        box(t, fh - 2 * t, t),
        C.sciWhite,
        local(fm, (s * (fw - t)) / 2, t, 0)
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

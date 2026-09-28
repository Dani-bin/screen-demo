/*
 * 人民公园 · 辛亥秋保路死事纪念碑 · 鹤鸣茶社
 * ----------------------------------------------------------
 * 本景点包含两部分（公园其余部分沿用第一版的绿地与通用树）：
 *   1. 辛亥秋保路死事纪念碑（1913 年建，青砖砌筑的方尖碑）：
 *      圆形碑台 Φ17 × 4.2 + 石栏 + 四向台阶；四层逐层收分的碑座（灰黄砖身 + 红砂石线脚，
 *      第二层四面是火车铁轨浮雕）；方形碑身 12.66 × 2.2 × 2.2（四角砖垛凸出、中部内凹，
 *      每面一块白底题字板，竖写「辛亥秋保路死事纪念碑」十字）；碑顶约 6 m：
 *      线脚 + 四角攒尖琉璃顶 + 顶四角小塔 + 中央塔刹。真实总高 31.86 m。
 *      碑外一圈圆形铺装小广场（Φ48）与几棵大树。
 *   2. 鹤鸣茶社：公园湖（OSM 无名水面）北岸，三段灰瓦开敞茶廊围出一个茶园院子，
 *      西侧单檐牌坊入口（黑底匾额），廊下与院中铺满竹椅色小方块，院里几把红伞。
 *
 * 插画化夸张：纪念碑真实尺寸（总高 31.86、碑身宽 2.2 m）在生产相机 300 m 以上的镜头里
 * 只有十几个像素宽，碑身细得像一根线，认不出四层碑座与题字板。
 * 因此纪念碑整体按 SCALE = 1.6 倍同比放大（碑台、碑座、碑身、碑顶一起放大，
 * 放大后总高约 51 m、碑台 Φ27）；下面的尺寸常量都写真实尺寸，放大只在坐标系上做一次。
 * 广场与大树、鹤鸣茶社不放大。
 *
 * 定位（OpenStreetMap）：
 *   - 纪念碑：historic=memorial「辛亥秋保路死事纪念碑」为 Φ17 的圆形碑台轮廓，
 *     中心 (104.05447, 30.66076)；碑座是其中一栋无名小楼（约 4 × 4 m），
 *     取它的最小外接矩形定碑身朝向（四面与之平行，约偏转 29°）。
 *   - 鹤鸣茶社：OSM 点位 (104.05585, 30.65936) 东侧有一栋无名 L 形楼（约 21 × 20 m）
 *     紧贴湖北岸，即茶社所在；茶廊沿湖岸方向（约 111°）布置，牌坊朝西。
 *   - 注：OSM 的「辛亥保路纪念广场」（约 48 × 48 的圆形步行区）在纪念碑东南约 100 m，
 *     并不环绕碑台；这里按任务约定把同尺寸的圆形铺装广场放在碑台周围。
 */
import { IcosahedronGeometry, Matrix4, Mesh } from "three"
import { THEME } from "../theme.js"
import { ColorBuilder, frame, landmarkMaterial, local } from "./kit/builder.js"
import {
  centroid,
  circlePolygon,
  minAreaRect,
  polygonArea,
  rectPolygon
} from "./kit/footprint.js"
import { box, cylinder, fromTriangles, prism, sphere } from "./kit/shapes.js"
import {
  gableRidge,
  gableRoof,
  gableWalls,
  hipRidges,
  hipRoof,
  pyramidRidges,
  pyramidRoof,
  roofHeight
} from "./kit/roofs.js"
import { eaveDrop } from "./kit/common.js"
import { addBalustrade, addColumns, addLantern } from "./kit/parts.js"

const L = THEME.landmark
const DEG = Math.PI / 180

/* ---------------- 定位常量 ---------------- */

const MONUMENT = { lon: 104.05447, lat: 30.66076, bearing: 29 }
// 鹤鸣茶社：OSM 点位；茶社楼（无名）在点位东侧，按「点位 40 m 内、300～600 ㎡」查找
const TEAHOUSE = { lon: 104.05585, lat: 30.65936, bearing: 111 }

/* ---------------- 纪念碑尺寸（真实尺寸，单位米） ---------------- */

const SCALE = 1.6 // 插画化放大倍数（原因见文件头）

// 纪念碑配色
const C = {
  brick: "#9A968C", // 灰黄砖
  pier: "#A7A397", // 砖垛（比砖身略亮，靠明暗分出凹凸）
  sand: "#A5654A", // 红砂石线脚
  relief: "#5E5A52", // 浮雕底（深色）
  rail: "#C9C3B5", // 铁轨浮雕
  board: "#E6E0D0", // 白底题字板
  ink: "#26262A", // 题字
  roof: "#8C6A3A", // 碑顶琉璃
  drum: "#9E6A52", // 碑台红砂石墙
  coping: "#CDBFAE", // 碑台顶面压顶石
  rim: "#B07A5E" // 碑台石栏
}

const DRUM = { r: 8.5, h: 4.2 } // 圆形碑台
const STAIR = { w: 3, n: 14, tread: 0.3 } // 四向台阶：宽、级数、踏步深
// 四层碑座：边长 w、层高 h（逐层收分），合计 9.0。
// 照片（rm_7609、rm_1421）里四层碑座与碑身体量相当，碑座按照片比例取高，
// 碑身相应取 12.66（设计文档写「约 15」），总高仍为 31.86。
// 照片 rm_7609：下两层是高大的浮雕层，上两层是矮的过渡层
const TIERS = [
  { w: 4.4, h: 3.1 },
  { w: 3.9, h: 2.8 },
  { w: 3.4, h: 1.5 },
  { w: 2.9, h: 1.6 }
]
// 碑身：底宽 2.2 → 顶宽 1.8，高 12.66；四角砖垛宽 0.35，中部内凹 0.12
const SHAFT = { h: 12.66, bottom: 2.2, top: 1.8, pier: 0.35, recess: 0.12 }
// 碑顶（合计 6.0）：线脚 0.65 + 攒尖顶 2.2 + 塔刹
const CAP = { cornice: 0.65, roofH: 2.2, spire: 3.15 }

const RAIL_ANGLE = 50 * DEG // 铁轨浮雕的倾角（绕墙面法线）
const PLAZA_R = 24 // 圆形铺装小广场半径（不放大）
const PLAZA_Y = 1.15 // 广场顶面高度（外圈镶边 1.0，内圈 1.15）

/* ---------------- 鹤鸣茶社尺寸（不放大） ---------------- */

// 茶社局部坐标：X 沿湖岸（约 111°，偏东南），+Z 朝湖（约 201°）；原点为茶社楼外接矩形中心
const TEA_BASE = { x0: -9, x1: 27, z0: -8, z1: 26, h: 1.0 } // 整体铺装地坪
// 三段茶廊：中心 (x, z)、长 w、深 d、yaw（弧度）、矮墙所在的一侧（局部 ±Z）
const GALLERIES = [
  { x: 6, z: -3.2, w: 26, d: 7, yaw: 0, wall: -1 }, // 北廊（背靠园路）
  // 东廊：yaw = π/2 时廊的局部 +Z 指向茶社 +X（东），矮墙在东侧
  { x: 22.5, z: 9.5, w: 15, d: 6, yaw: Math.PI / 2, wall: 1 },
  { x: 6, z: 21.5, w: 26, d: 6, yaw: 0, wall: 1 } // 临湖廊（美人靠朝湖）
]
const PAILOU = { x: -8, z: 9.5 } // 牌坊：站在地坪西沿，朝西（局部 -X）
const CHAIR = "#C9A46A" // 竹椅色

/* ---------------- 通用小工具 ---------------- */

/**
 * 上下两个水平矩形围成的六面体（去掉底面），用于收分的碑身、砖垛、贴面板。
 * bot / top 为 [x0, x1, z0, z1]，底在 y = 0、顶在 y = h。
 * 三角形绕向按「法线背离几何中心」逐个校正，保证外法线。
 */
function taperBox(bot, top, h) {
  const [a0, a1, b0, b1] = bot
  const [c0, c1, d0, d1] = top
  const B = [
    [a0, 0, b0],
    [a1, 0, b0],
    [a1, 0, b1],
    [a0, 0, b1]
  ]
  const T = [
    [c0, h, d0],
    [c1, h, d0],
    [c1, h, d1],
    [c0, h, d1]
  ]
  const center = [(a0 + a1 + c0 + c1) / 4, h / 2, (b0 + b1 + d0 + d1) / 4]
  const quads = [
    [T[0], T[1], T[2], T[3]], // 顶面
    [B[0], B[1], T[1], T[0]],
    [B[1], B[2], T[2], T[1]],
    [B[2], B[3], T[3], T[2]],
    [B[3], B[0], T[0], T[3]]
  ]
  const pos = []
  const tri = (p, q, r) => {
    // 面法线 (q - p) × (r - p) 与「面心 - 几何中心」同向才是外法线，否则交换绕向
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]]
    const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]]
    const n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0]
    ]
    const m = [0, 1, 2].map((i) => (p[i] + q[i] + r[i]) / 3 - center[i])
    const out = n[0] * m[0] + n[1] * m[1] + n[2] * m[2] >= 0
    pos.push(...p, ...(out ? q : r), ...(out ? r : q))
  }
  for (const [p, q, r, s] of quads) {
    tri(p, q, r)
    tri(p, r, s)
  }
  return fromTriangles(pos)
}

/**
 * 三棱柱楔块：宽 w（沿 X）、长 len（沿 +Z），z = 0 端高 h、z = len 端高 0（台阶两侧的斜垂带）。
 */
function wedge(w, h, len) {
  const x0 = -w / 2
  const x1 = w / 2
  // 顶点 [x, y, z]，每 3 个一组为一个三角形
  const tris = [
    // 斜顶面
    [x0, h, 0],
    [x0, 0, len],
    [x1, 0, len],
    [x0, h, 0],
    [x1, 0, len],
    [x1, h, 0],
    // 竖直背面（z = 0）
    [x0, 0, 0],
    [x0, h, 0],
    [x1, h, 0],
    [x0, 0, 0],
    [x1, h, 0],
    [x1, 0, 0],
    // 两个三角侧面
    [x0, 0, 0],
    [x0, 0, len],
    [x0, h, 0],
    [x1, 0, 0],
    [x1, h, 0],
    [x1, 0, len]
  ]
  return fromTriangles(tris.flat())
}

/**
 * 低多边形树：六棱柱树干 + 二十面体树冠（平面着色，与城市通用树一致）。
 * (x, z) 为世界坐标，s 为树冠半径。
 */
function addTree(b, x, z, s, color, y = 0) {
  const trunkH = 0.75 * s
  b.add(
    cylinder(0.12 * s, 0.09 * s, trunkH + 0.4 * s, { segments: 6 }),
    THEME.tree.trunk,
    local(null, x, y, z)
  )
  const crown = new IcosahedronGeometry(1, 1)
  // 删掉平滑法线，合批器会按面重算，得到棱面分明的树冠
  crown.deleteAttribute("normal")
  b.add(
    crown,
    color,
    local(null, x, y + trunkH + 0.95 * s, z, 0, s, 1.15 * s, s)
  )
}

/** 把坐标系 m 里的局部点 (x, z) 换成世界坐标 [x, z]（m 只含平移、绕 Y 旋转与等比缩放） */
function toWorld(m, x, z) {
  const e = m.elements
  return [e[12] + e[0] * x + e[8] * z, e[14] + e[2] * x + e[10] * z]
}

/** 正方形四个面的坐标系：k = 0..3 依次朝 +Z、+X、-Z、-X（原点仍在中心，+Z 为该面外法线） */
function faceFrames(parent, y = 0) {
  return [0, 1, 2, 3].map((k) => local(parent, 0, y, 0, (k * Math.PI) / 2))
}

/* ---------------- 纪念碑 ---------------- */

/**
 * 圆形碑台：红砂石墙 + 顶面压顶石 + 顶沿石栏（在台阶口断开） + 四向台阶与斜垂带。
 * 台阶朝碑身四个正面（局部 ±X、±Z）。
 */
function addDrum(b, fm) {
  const { r, h } = DRUM
  const coping = 0.3
  b.add(cylinder(r, r, h - coping, { segments: 36 }), C.drum, fm)
  b.add(
    cylinder(r + 0.18, r + 0.18, coping, { segments: 36, caps: true }),
    C.coping,
    local(fm, 0, h - coping, 0)
  )
  // 墙脚一圈略宽的勒脚石
  b.add(cylinder(r + 0.12, r + 0.12, 0.5, { segments: 36 }), C.sand, fm)

  // 石栏：沿台边一圈，四个台阶口各断开 STAIR.w + 0.4 宽
  const rr = r - 0.25
  const gap = Math.asin((STAIR.w / 2 + 0.2) / rr)
  for (let k = 0; k < 4; k++) {
    // 台阶在 a = k·90°（从 +Z 起逆时针量），两台阶之间为一段栏杆弧
    const a0 = (k * Math.PI) / 2 + gap
    const a1 = ((k + 1) * Math.PI) / 2 - gap
    const pts = []
    const n = 6
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n
      pts.push([rr * Math.sin(a), rr * Math.cos(a)])
    }
    addBalustrade(b, fm, {
      points: pts,
      closed: false,
      h: 1.0,
      postSpacing: 1.6,
      y: h,
      color: C.rim
    })
  }

  // 四向台阶：从台边落到地面，每级高 h / n
  const { w: sw, n, tread } = STAIR
  const rise = h / n
  const edge = Math.sqrt(r * r - (sw / 2) ** 2) - 0.1
  for (const m of faceFrames(fm)) {
    for (let k = 1; k < n; k++) {
      b.add(
        box(sw, h - k * rise, tread),
        C.coping,
        local(m, 0, 0, edge + (k - 0.5) * tread)
      )
    }
    // 斜垂带：顶端比台面高 0.5，贴着踏步口落到地面
    const run = (n - 1) * tread
    for (const sx of [-1, 1]) {
      b.add(
        wedge(0.45, h + 0.5, run + 0.2),
        C.rim,
        local(m, sx * (sw / 2 + 0.22), 0, edge)
      )
    }
  }
}

/**
 * 火车铁轨浮雕：深色浮雕底 + 两道斜向铁轨 + 枕木（绕面法线旋转 RAIL_ANGLE，
 * 照片 rm_1421 里铁轨斜穿浮雕面，约 50°）。
 * m 为某一面的坐标系（+Z 为外法线），浮雕贴在 z = face 处，中心高 yc、宽 pw、高 ph。
 */
function addRailRelief(b, m, face, yc, pw, ph) {
  b.add(box(pw, ph, 0.1), C.relief, local(m, 0, yc - ph / 2, face + 0.05))
  const rot = new Matrix4().makeRotationZ(RAIL_ANGLE)
  // 铁轨长度：斜放后竖向投影不超出浮雕底（留 5% 余量），横向也不超出
  const len =
    0.95 * Math.min(ph / Math.sin(RAIL_ANGLE), pw / Math.cos(RAIL_ANGLE))
  for (const off of [-0.32, 0.32]) {
    // 铁轨：先平移到浮雕中心，再绕面法线转 RAIL_ANGLE（凸出浮雕底 0.15）
    const rm = local(m, 0, yc, face + 0.2).multiply(rot)
    b.add(box(len, 0.16, 0.1), C.rail, local(rm, 0, off - 0.08, 0))
  }
  // 枕木：压在铁轨下面一层
  for (let i = -2; i <= 2; i++) {
    const rm = local(m, 0, yc, face + 0.16).multiply(rot)
    b.add(box(0.16, 0.8, 0.07), C.sand, local(rm, i * 0.42, -0.4, 0))
  }
}

/**
 * 四层碑座：每层砖身 + 四角砖垛 + 顶部红砂石线脚（挑出 0.15）+ 线脚下一道细砂石腰线；
 * 首层四面一块深色浮雕，二层四面是火车铁轨浮雕。
 * @returns {number} 碑座顶高度（局部）
 */
function addPedestal(b, fm, y0) {
  let y = y0
  // 首层底部勒脚
  b.add(
    box(TIERS[0].w + 0.3, 0.35, TIERS[0].w + 0.3),
    C.sand,
    local(fm, 0, y, 0)
  )
  TIERS.forEach((t, i) => {
    const lip = 0.28 // 顶部线脚高
    const bodyH = t.h - lip
    b.add(box(t.w, bodyH, t.w), C.brick, local(fm, 0, y, 0))
    // 四角砖垛：各边凸出 0.06
    const pw = 0.42
    const px = t.w / 2 - pw / 2 + 0.06
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.add(box(pw, bodyH, pw), C.pier, local(fm, sx * px, y, sz * px))
      }
    }
    // 线脚下的细腰线与顶部挑出的红砂石线脚
    b.add(
      box(t.w + 0.2, 0.12, t.w + 0.2),
      C.sand,
      local(fm, 0, y + bodyH - 0.18, 0)
    )
    b.add(box(t.w + 0.34, lip, t.w + 0.34), C.sand, local(fm, 0, y + bodyH, 0))
    // 浮雕：首层素面深色浮雕，二层铁轨浮雕（贴面离墙 ≥ 0.1 m，放大后 ≥ 0.16 m）
    const face = t.w / 2
    const pw2 = t.w - 2 * pw - 0.2
    for (const m of faceFrames(fm)) {
      if (i === 0) {
        b.add(
          box(pw2, bodyH * 0.62, 0.1),
          C.relief,
          local(m, 0, y + bodyH * 0.2, face + 0.05)
        )
        // 浮雕中部一道浅色人物 / 纹样色块
        b.add(
          box(pw2 * 0.5, bodyH * 0.3, 0.1),
          C.rail,
          local(m, 0, y + bodyH * 0.36, face + 0.16)
        )
      } else if (i === 1) {
        addRailRelief(b, m, face, y + bodyH * 0.5, pw2, bodyH * 0.72)
      }
    }
    y += t.h
  })
  return y
}

/**
 * 碑身：收分方柱，四角砖垛凸出、中部内凹，每面一块白底题字板与十个题字块，
 * 底部一道红砂石座、顶部一道红砂石束腰。
 * @returns {number} 碑身顶高度（局部）
 */
function addShaft(b, fm, y0) {
  const { h, bottom, top, pier, recess } = SHAFT
  const hb = bottom / 2
  const ht = top / 2
  // 碑身座
  b.add(box(bottom + 0.3, 0.5, bottom + 0.3), C.sand, local(fm, 0, y0, 0))
  const y = y0 + 0.5
  const H = h - 0.5
  const m0 = local(fm, 0, y, 0)
  // 内凹的碑身芯
  const cb = hb - recess
  const ct = ht - recess
  b.add(taperBox([-cb, cb, -cb, cb], [-ct, ct, -ct, ct], H), C.brick, m0)
  // 四角砖垛（随碑身收分）
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const bx = [sx * hb, sx * (hb - pier)].sort((p, q) => p - q)
      const bz = [sz * hb, sz * (hb - pier)].sort((p, q) => p - q)
      const tx = [sx * ht, sx * (ht - pier)].sort((p, q) => p - q)
      const tz = [sz * ht, sz * (ht - pier)].sort((p, q) => p - q)
      b.add(taperBox([...bx, ...bz], [...tx, ...tz], H), C.pier, m0)
    }
  }
  // 题字板：从 0.08H 到 0.93H，离碑身芯 0.1（放大后 0.16 m）
  const y1 = 0.08 * H
  const y2 = 0.93 * H
  const at = (yy) => hb + (ht - hb) * (yy / H) // 碑面半宽随高度
  const bw = (yy) => at(yy) - pier - 0.08 // 题字板半宽
  for (const m of faceFrames(m0)) {
    const f1 = at(y1) - recess
    const f2 = at(y2) - recess
    const board = taperBox(
      [-bw(y1), bw(y1), f1, f1 + 0.1],
      [-bw(y2), bw(y2), f2, f2 + 0.1],
      y2 - y1
    )
    b.add(board, C.board, local(m, 0, y1, 0))
    // 十个题字「辛亥秋保路死事纪念碑」，竖写一列。每个字用一横一竖两笔色块拼成，
    // 笔画位置逐字错开：远看是一列墨字的肌理，而不是一排方窗
    const n = 10
    const step = (y2 - y1 - 0.6) / n
    for (let i = 0; i < n; i++) {
      const yy = y2 - 0.3 - (i + 0.5) * step
      const z = at(yy) - recess + 0.1
      const w = bw(yy)
      const sx = [-0.25, 0.2, 0, 0.3, -0.15][i % 5] * w
      // 横笔：字的上半部，宽 1.3w
      b.add(
        box(w * 1.3, step * 0.2, 0.1),
        C.ink,
        local(m, 0, yy + step * 0.08, z + 0.05)
      )
      // 竖笔 / 下半部笔画团：左右错开
      b.add(
        box(w * 0.7, step * 0.46, 0.1),
        C.ink,
        local(m, sx, yy - step * 0.36, z + 0.05)
      )
    }
  }
  // 碑身顶部一道红砂石束腰
  b.add(box(top + 0.14, 0.3, top + 0.14), C.sand, local(fm, 0, y0 + h - 0.3, 0))
  return y0 + h
}

/**
 * 碑顶：两道挑出的线脚 + 四角攒尖琉璃顶（翘角）+ 顶四角小塔 + 中央塔刹。
 * @returns {number} 碑顶最高点（局部）
 */
function addCap(b, fm, y0) {
  const { top } = SHAFT
  b.add(box(top + 0.4, 0.3, top + 0.4), C.sand, local(fm, 0, y0, 0))
  b.add(box(top + 0.7, 0.35, top + 0.7), C.brick, local(fm, 0, y0 + 0.3, 0))
  const y = y0 + CAP.cornice
  // 攒尖顶：檐口为外接半径 R + overhang 的正方形（四边对齐碑面）
  const half = top / 2 + 0.35
  const R = half * Math.SQRT2
  const ro = { overhang: 0.6, curl: 0.38, ridges: false }
  const mr = local(fm, 0, y - 0.05, 0)
  b.add(pyramidRoof(4, R, CAP.roofH, ro), C.roof, mr)
  b.add(pyramidRidges(4, R, CAP.roofH, ro), "#6E5230", mr)
  // 顶四角小塔：坐在起翘的檐角上（檐角高 = curl × roofH），略向内收
  const cornerY = y - 0.05 + roofHeight(1, 0.12, CAP.roofH, ro.curl)
  const cr = (R + ro.overhang) * 0.82
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2
    const m = local(fm, cr * Math.sin(a), cornerY, cr * Math.cos(a))
    b.add(prism(4, 0.22, 0.2, 0.35), C.roof, m)
    b.add(
      pyramidRoof(4, 0.2, 0.35, {
        overhang: 0.08,
        curl: 0.3,
        segS: 4,
        segT: 3
      }),
      C.roof,
      local(m, 0, 0.35, 0)
    )
    b.add(
      cylinder(0.05, 0, 0.55, { segments: 5 }),
      L.gold,
      local(m, 0, 0.62, 0)
    )
  }
  // 中央塔刹：刹座 + 两颗宝珠 + 尖刹
  const ys = y - 0.05 + CAP.roofH * 0.9
  b.add(
    cylinder(0.2, 0.15, 0.4, { segments: 8, caps: true }),
    C.roof,
    local(fm, 0, ys, 0)
  )
  b.add(sphere(0.26, 10, 7), L.gold, local(fm, 0, ys + 0.35, 0))
  b.add(sphere(0.17, 8, 6), L.gold, local(fm, 0, ys + 0.85, 0))
  const coneH = CAP.spire - 0.85
  b.add(
    cylinder(0.08, 0, coneH, { segments: 6 }),
    L.gold,
    local(fm, 0, ys + 1.15, 0)
  )
  return ys + 1.15 + coneH
}

/**
 * 纪念碑整体。fm 已含 SCALE 放大（局部尺寸为真实尺寸）。
 * @returns {number} 局部最高点
 */
function buildMonument(b, fm) {
  addDrum(b, fm)
  const yPed = addPedestal(b, fm, DRUM.h)
  const yShaft = addShaft(b, fm, yPed)
  return addCap(b, fm, yShaft)
}

/**
 * 圆形铺装小广场：外圈深一号的镶边石（顶 1.0），内圈浅石（顶 1.15），
 * 内圈上再压一圈放射状的深色分隔条（8 条）。f 为不放大的坐标系（原点在地面）。
 */
function buildPlaza(b, f) {
  b.add(
    cylinder(PLAZA_R, PLAZA_R, 1.0, { segments: 40, caps: true }),
    "#B6AEA2",
    f
  )
  b.add(
    cylinder(PLAZA_R - 1.2, PLAZA_R - 1.2, PLAZA_Y, {
      segments: 40,
      caps: true
    }),
    L.stonePave,
    f
  )
  // 放射状分隔条：只铺在四个斜向（正四面是台阶落脚处），从碑台边铺到镶边
  const r0 = DRUM.r * SCALE + 0.6
  const r1 = PLAZA_R - 1.2
  for (let k = 0; k < 8; k++) {
    if (k % 2 === 0) continue
    const m = local(f, 0, 0, 0, (k * Math.PI) / 4)
    b.add(
      box(1.2, PLAZA_Y + 0.15, r1 - r0),
      "#B6AEA2",
      local(m, 0, 0, (r0 + r1) / 2)
    )
  }
}

/* ---------------- 鹤鸣茶社 ---------------- */

/**
 * 一段开敞茶廊：低台基 + 红柱 + 额枋 + 一侧矮墙（或临湖美人靠）+ 灰瓦悬山顶，
 * 廊下地面铺满竹椅色小方块，檐角挂红灯笼。
 * parent 为茶廊中心坐标系（局部 X 沿廊长），底在茶社地坪顶面。
 */
function addGallery(b, parent, g) {
  const { w, d, wall } = g
  const baseH = 0.3
  const colH = 3.2
  // 低台基
  b.add(box(w, baseH, d), L.granite, parent)
  const y0 = baseH
  // 柱网：从台基边内缩 0.5
  const cw = w - 1
  const cd = d - 1
  addColumns(b, parent, {
    w: cw,
    d: cd,
    h: colH,
    y: y0,
    spacing: 3.2,
    radius: 0.2
  })
  // 额枋：柱顶一圈深红
  const bh = 0.35
  for (const sz of [-1, 1]) {
    b.add(
      box(cw + 0.3, bh, 0.28),
      L.lattice,
      local(parent, 0, y0 + colH - bh, (sz * cd) / 2)
    )
  }
  for (const sx of [-1, 1]) {
    b.add(
      box(0.28, bh, cd),
      L.lattice,
      local(parent, (sx * cw) / 2, y0 + colH - bh, 0)
    )
  }
  // 矮墙（背街一侧）或美人靠（临湖一侧）：0.7 m 高木栏
  b.add(box(cw, 0.7, 0.22), L.timber, local(parent, 0, y0, (wall * cd) / 2))
  // 廊下竹椅：约 0.9 m 见方的小方块，按 1.6 m 网格铺满（给柱与墙留 0.6 m）
  const nx = Math.floor((cw - 1.2) / 1.6)
  const nz = Math.floor((cd - 1.4) / 1.6)
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x = -((nx - 1) * 1.6) / 2 + i * 1.6
      const z = -((nz - 1) * 1.6) / 2 + j * 1.6
      b.add(box(0.9, 0.5, 0.9), CHAIR, local(parent, x, y0, z))
    }
  }
  // 灰瓦悬山顶（屋脊沿廊长），山墙三角用深木色
  const roofH = cd * 0.34
  const go = { overhang: 0.9, ridges: false, gables: false }
  const yr = y0 + colH - eaveDrop(cd / 2, 0.9, roofH, 1.3, 0.5)
  const mr = local(parent, 0, yr, 0)
  b.add(gableRoof(cw, cd, roofH, go), L.roof, mr)
  b.add(gableWalls(cw, cd, roofH, go), L.timber, mr)
  b.add(gableRidge(cw, cd, roofH, go), L.roofRidge, mr)
  // 敞开一侧的额枋下挂两盏红灯笼（避开角柱）
  for (const sx of [-1, 1]) {
    const x = sx * (cw / 2 - 1.6)
    addLantern(b, parent, x, y0 + colH - 0.9, (-wall * cd) / 2, { r: 0.35 })
  }
}

/**
 * 单檐牌坊入口：两根深木柱（柱脚抱鼓石）+ 额枋 + 花格心板 + 黑底匾额（金边）+
 * 翘角灰瓦顶；柱旁挂红灯笼。m 的 +Z 为牌坊正面（朝园路）。
 */
function addPailou(b, m) {
  const span = 4.6 // 两柱中心距
  const colH = 5.0
  for (const sx of [-1, 1]) {
    const x = (sx * span) / 2
    b.add(
      cylinder(0.24, 0.22, colH, { segments: 8 }),
      L.timber,
      local(m, x, 0, 0)
    )
    // 抱鼓石：柱脚前后各一块
    b.add(box(0.5, 0.9, 1.6), L.granite, local(m, x, 0, 0))
  }
  // 下额枋、花格心板、上额枋
  b.add(box(span + 0.9, 0.35, 0.32), L.timber, local(m, 0, 3.7, 0))
  b.add(box(span - 0.3, 1.0, 0.12), L.lattice, local(m, 0, 4.05, 0))
  b.add(box(span + 0.9, 0.3, 0.32), L.timber, local(m, 0, 5.0 - 0.25, 0))
  // 匾额：金边 + 黑底（离心板 ≥ 0.15 m）
  b.add(box(2.5, 1.05, 0.1), L.gold, local(m, 0, 3.98, 0.16))
  b.add(box(2.3, 0.88, 0.1), L.pandaBlack, local(m, 0, 4.06, 0.3))
  // 两个浅色字块「鹤鸣」
  for (const sx of [-1, 1]) {
    b.add(box(0.5, 0.5, 0.06), "#E9E2CC", local(m, sx * 0.45, 4.25, 0.42))
  }
  // 翘角灰瓦顶
  const ro = { overhang: 0.8, curl: 0.7, ridge: 0.6, ridges: false }
  const mr = local(m, 0, colH, 0)
  b.add(hipRoof(span + 0.6, 1.0, 1.3, ro), L.roof, mr)
  b.add(hipRidges(span + 0.6, 1.0, 1.3, ro), L.roofRidge, mr)
  for (const sx of [-1, 1]) {
    addLantern(b, m, sx * (span / 2 - 0.55), 3.2, 0.4, { r: 0.32 })
  }
}

/** 院中红伞：伞杆 + 八角伞面（压扁圆锥） */
function addUmbrella(b, parent, x, z) {
  b.add(
    cylinder(0.06, 0.06, 2.4, { segments: 5 }),
    L.timber,
    local(parent, x, 0, z)
  )
  b.add(
    cylinder(1.5, 0.05, 0.6, { segments: 8 }),
    L.lantern,
    local(parent, x, 2.1, z)
  )
}

/**
 * 鹤鸣茶社整体。f 为茶社坐标系（X 沿湖岸、+Z 朝湖，原点在地面）。
 */
function buildTeahouse(b, f) {
  const { x0, x1, z0, z1, h } = TEA_BASE
  // 整体地坪（院子与廊子的共同地面）
  b.add(
    box(x1 - x0, h, z1 - z0),
    "#C2B9AA",
    local(f, (x0 + x1) / 2, 0, (z0 + z1) / 2)
  )
  const fy = local(f, 0, h, 0)
  for (const g of GALLERIES) addGallery(b, local(fy, g.x, 0, g.z, g.yaw), g)

  // 院中竹椅：在三段廊围出的院子里铺满小方块，中间留一条从牌坊进来的石板路（z ≈ 9.5）
  for (let x = -6; x <= 17; x += 1.8) {
    for (let z = 2.2; z <= 17; z += 1.8) {
      if (Math.abs(z - PAILOU.z) < 1.2) continue
      b.add(box(0.9, 0.5, 0.9), CHAIR, local(fy, x, 0, z))
    }
  }
  // 石板路（高出地坪 0.18，颜色略浅）：从牌坊一直通到东廊
  b.add(box(27, 0.18, 2.4), L.stonePave, local(fy, 5.5, 0, PAILOU.z))
  // 院中三把红伞
  for (const [x, z] of [
    [-3, 4.5],
    [14, 14.5],
    [15, 4.5]
  ]) {
    addUmbrella(b, fy, x, z)
  }
  // 牌坊：正面朝西（局部 -X），站在地坪西沿
  addPailou(b, local(fy, PAILOU.x, 0, PAILOU.z, -Math.PI / 2))
  // 牌坊外三级台阶从地坪落到地面：每级高 h / 4、踏步深 0.45，逐级向西（局部 -X）
  const rise = h / 4
  const tread = 0.45
  for (let k = 1; k <= 3; k++) {
    b.add(
      box(tread, h - k * rise, 2.8),
      L.stonePave,
      local(f, x0 - (k - 0.5) * tread, 0, PAILOU.z)
    )
  }
}

/* ---------------- 定位 ---------------- */

/** 纪念碑碑座（OSM 无名小楼）：碑台中心 6 m 内、占地 < 40 ㎡ 的楼 */
function locateMonument(ctx) {
  const [x, z] = ctx.project.toLocal(MONUMENT.lon, MONUMENT.lat)
  let best = -1
  let bestD = 6
  ctx.buildings.forEach((bd, i) => {
    if (!bd.p || bd.p.length < 3 || polygonArea(bd.p) > 40) return
    const [cx, cz] = centroid(bd.p)
    const dist = Math.hypot(cx - x, cz - z)
    if (dist < bestD) {
      best = i
      bestD = dist
    }
  })
  if (best < 0) return { x, z, bearing: MONUMENT.bearing }
  const r = minAreaRect(ctx.buildings[best].p)
  // 近方形轮廓长轴不稳，只取模 90° 的偏转角（四面对称）
  return { x: r.cx, z: r.cz, bearing: r.bearing % 90 }
}

/** 鹤鸣茶社楼（OSM 无名）：点位 40 m 内、占地 300～600 ㎡ 的楼，取外接矩形中心 */
function locateTeahouse(ctx) {
  const [x, z] = ctx.project.toLocal(TEAHOUSE.lon, TEAHOUSE.lat)
  let best = -1
  let bestD = 40
  ctx.buildings.forEach((bd, i) => {
    if (bd.n || !bd.p || bd.p.length < 3) return
    const a = polygonArea(bd.p)
    if (a < 300 || a > 600) return
    const [cx, cz] = centroid(bd.p)
    const dist = Math.hypot(cx - x, cz - z)
    if (dist < bestD) {
      best = i
      bestD = dist
    }
  })
  if (best < 0) {
    // 查不到时：楼在点位东侧约 18 m
    const b = TEAHOUSE.bearing * DEG
    return {
      x: x + Math.sin(b) * 18,
      z: z - Math.cos(b) * 18,
      bearing: TEAHOUSE.bearing
    }
  }
  const r = minAreaRect(ctx.buildings[best].p)
  // 长边方位取 [90, 180) 内与湖岸一致的一支（湖岸约 105°～111°）
  const bearing = r.bearing < 60 ? r.bearing + 90 : r.bearing
  return { x: r.cx, z: r.cz, bearing }
}

/* ---------------- 入口 ---------------- */

export function build(ctx) {
  const b = new ColorBuilder()
  const greens = THEME.tree.greens

  // 纪念碑：局部四面与碑座轮廓平行；fm 含放大，fp 不放大（广场、大树）
  const mon = locateMonument(ctx)
  const fp = frame(mon.x, 0, mon.z, mon.bearing)
  const fm = local(
    frame(mon.x, PLAZA_Y, mon.z, mon.bearing),
    0,
    0,
    0,
    0,
    SCALE,
    SCALE,
    SCALE
  )
  buildPlaza(b, fp)
  const monTop = PLAZA_Y + buildMonument(b, fm) * SCALE

  // 广场四周的大树：落在广场外沿一圈，避开 OSM 楼（楼心 16 m 内不种）
  const obstacles = ctx.buildings
    .filter((bd) => bd.p && bd.p.length >= 3)
    .map((bd) => centroid(bd.p))
  const clear = (x, z, r) =>
    obstacles.every(([ox, oz]) => Math.hypot(ox - x, oz - z) > r)
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) * Math.PI) / 4
    const rr = PLAZA_R + 6 + (k % 2) * 3
    const [x, z] = toWorld(fp, rr * Math.sin(a), rr * Math.cos(a))
    if (!clear(x, z, 16)) continue
    addTree(b, x, z, 6 + (k % 3), k === 5 ? THEME.tree.yellow : greens[k % 4])
  }

  // 鹤鸣茶社：局部 X 沿湖岸（frame 的 +X 指向 bearing + 90°，故传 bearing − 90）
  const tea = locateTeahouse(ctx)
  const ft = frame(tea.x, 0, tea.z, tea.bearing - 90)
  buildTeahouse(b, ft)
  // 茶社的大树：院子中央一棵，外围几棵（局部坐标，已避开湖面与东侧楼）
  const TEA_TREES = [
    [4, 13, 4.5],
    [-14, -4, 6],
    [-16, 20, 6.5],
    [29, -16, 6],
    [13, -14, 5.5]
  ]
  TEA_TREES.forEach(([x, z, s], k) => {
    const [wx, wz] = toWorld(ft, x, z)
    // 院中那棵从地坪上长出来
    addTree(b, wx, wz, s, greens[(k + 1) % 4], k === 0 ? TEA_BASE.h : 0)
  })

  const g = b.bake()
  const meshes = g ? [new Mesh(g, landmarkMaterial())] : []

  // 替换区：纪念碑取整个圆形广场（半径 26 m，区内只有碑座那栋 OSM 小楼；
  // 取到广场外沿是为了将来通用树也按替换区避让时，广场上不再长树）、茶社地坪范围
  const zones = [circlePolygon(mon.x, mon.z, PLAZA_R + 2, 24)]
  const { x0, x1, z0, z1 } = TEA_BASE
  const [tcx, tcz] = toWorld(ft, (x0 + x1) / 2, (z0 + z1) / 2)
  zones.push(rectPolygon(tcx, tcz, x1 - x0 + 2, z1 - z0 + 2, tea.bearing))

  return { meshes, zones, markerHeight: monTop + 2 }
}

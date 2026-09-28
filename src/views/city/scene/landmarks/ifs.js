/*
 * 成都 IFS 国际金融中心 + 熊猫「I Am Here」
 * ----------------------------------------------------------
 * 构成（均按 OSM 真实轮廓，网格约 30°）：
 * - 4 座塔楼：T1 / T2 高 248、T3 高 188、T4 高 198（OSM 高度），蓝色玻璃盒，
 *   自下而上由深蓝渐变到浅蓝，每隔约 20 m 一道深色腰线，外立面细竖梃，顶部两段收进；
 * - 裙楼：OSM 轮廓挤出到 40 m，米色石材横纹，底层深色玻璃店面；
 *   面向红星路的长边上部石材体量外挑 2 m，立面嵌几个凸出的浅蓝玻璃盒
 *   （参考照片里 UNIQLO、IFS 标识所在的那些），屋顶一层草地 + 小径 + 小树；
 * - 熊猫：真实高 15、模型放大到 20，低多边形平面着色，单独一个 Mesh，趴在红星路一侧、离北端约 30 m 的女儿墙上，
 *   背朝街、头和前爪探进屋顶花园、后腿垂在立面外。
 * 替换区覆盖 4 座塔、裙楼与塔 3 / 塔 4 之间的一小段附楼（OSM 无名，高 6.6）。
 */
import { BackSide, Mesh } from "three"
import { THEME } from "../theme.js"
import { mulberry32, pointInPolygon } from "../utils.js"
import {
  ColorBuilder,
  flatMaterial,
  landmarkMaterial,
  local
} from "./kit/builder.js"
import {
  bearingDiff,
  distToSegment,
  findBuilding,
  minAreaRect,
  rectFrame,
  rectPolygon
} from "./kit/footprint.js"
import {
  box,
  cylinder,
  extrudePolygon,
  sphere,
  sweepBar
} from "./kit/shapes.js"
import { addPanda } from "./kit/figures.js"

const DEG = Math.PI / 180

/* ---------------- 尺寸 ---------------- */

const PODIUM_H = 40 // 裙楼女儿墙顶
const ROOF_Y = 38.6 // 屋面（女儿墙高 1.4）
const GRASS_T = 0.35 // 草皮厚
const STORE_H = 9 // 底层店面高
const CANTI_Y = 18 // 红星路一侧外挑石材体量的底
const CANTI_OUT = 2 // 外挑距离
// 熊猫高度：真实雕塑高 15 m；这里放大到 20 m（插画式夸张），保证 300 m 外的站点画面里一眼可辨
const PANDA_H = 20
const PANDA_S = 30 // 熊猫离裙楼红星路长边北端的距离
const PATH_W = 2.6 // 屋顶花园小径宽
// 小径顶面：草皮顶 + 0.2（小径高 0.25、底边下沉 0.05）
const PATH_TOP = ROOF_Y + GRASS_T + 0.2
// 屋顶小径上的步行路径：可走宽度（小径 2.6 m 宽，两侧各留 0.7 m 给小人身体），
// 以及离树冠边缘的最小距离（半个可走宽度 + 小人身体半径）
const WALK_W = 1.2
const WALK_CLEAR = 1.4
// 红星路一侧人行道：裙楼临街立面（外挑玻璃盒最远凸出 7 m）与红星路路缘（离立面约 28 m）之间
// 是一片没铺装的前场，露出 terrain.js 的地面（y = -0.5）。人行道中线离立面 off 米、
// 可走宽度 width（离立面 13～23 m：熊猫垂在立面外的后腿与身体约伸出 11 m，人不从它下面走），
// 两端各从长边端点内收 trim 米
const SIDEWALK = { off: 18, width: 10, trim: 4, y: -0.5, density: 1.2 }

/* ---------------- 配色 ---------------- */

const C = {
  stone: "#DCCDAE", // 米色石材
  stoneLine: "#B9A785", // 石材横纹（深一档）
  parapet: "#E6D9BD",
  store: "#7A8A99", // 底层深色玻璃店面
  soffit: "#8C7E68", // 外挑体量底面
  glassLow: THEME.glassBottom, // 塔楼玻璃：底部深蓝
  glassHigh: THEME.glassTop, // 顶部浅蓝
  band: "#2C4863", // 塔楼深色腰线
  mullion: "#DCEAF3", // 竖梃
  towerRoof: "#C9D4DC",
  boxGlass: "#C4DFE8", // 裙楼凸出的浅蓝玻璃盒
  boxLine: "#93AFBD",
  boxFrame: "#5C6970",
  logoRed: "#D2372E", // UNIQLO 红色标识
  logoGrey: "#6F7F88", // IFS 标识
  grass: THEME.park,
  path: "#EFE8D8",
  trunk: THEME.tree.trunk
}

/*
 * OSM 名称缺失时的兜底：由当前 OSM 轮廓的最小外接矩形换算成经纬度
 * （中心经纬度、长 w、宽 d、长边方位角），保证模型仍在正确位置。
 */
const FALLBACK = {
  podium: [104.0789, 30.65737, 202.2, 126.3, 30.7],
  "IFS Tower 1": [104.07933, 30.65833, 65.2, 44.0, 120.4],
  "IFS Tower 2": [104.07803, 30.65668, 63.8, 44.2, 120.3],
  "IFS Tower 3": [104.07975, 30.6573, 56.7, 23.2, 31.2],
  "IFS Tower 4": [104.0791, 30.65635, 70.9, 22.6, 31.2]
}
// T3 与 T4 之间的无名附楼（OSM 高 6.6），并入裙楼
const ANNEX = [104.07944, 30.65686, 58.7, 23.1, 30.3]

const TOWERS = [
  { name: "IFS Tower 1", h: 248 },
  { name: "IFS Tower 2", h: 248 },
  { name: "IFS Tower 3", h: 188 },
  { name: "IFS Tower 4", h: 198 }
]

/* ---------------- 几何小工具 ---------------- */

/**
 * 多边形各条边的坐标系：原点在边中点（y = 0），局部 X 沿边、局部 +Z 指向多边形外侧。
 * 局部 X 旋转 a 后为 (cos a, -sin a)、+Z 为 (sin a, cos a)；
 * 若 +Z 指向内侧就把 a 加 π（边反向，构件左右对称不受影响），从而不需要镜像。
 * @returns {Array<{ m, yaw: number, len, a: number[], b: number[], out: number[] }>}
 */
function edgeFrames(pts) {
  const out = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const len = Math.hypot(dx, dz)
    if (len < 1) continue
    const mx = (a[0] + b[0]) / 2
    const mz = (a[1] + b[1]) / 2
    let yaw = Math.atan2(-dz, dx)
    let nx = Math.sin(yaw)
    let nz = Math.cos(yaw)
    if (pointInPolygon(mx + nx * 0.5, mz + nz * 0.5, pts)) {
      yaw += Math.PI
      nx = -nx
      nz = -nz
    }
    out.push({ m: local(null, mx, 0, mz, yaw), yaw, len, a, b, out: [nx, nz] })
  }
  return out
}

/** 方位角（度）：北为 -Z、东为 +X */
const bearingOf = (x, z) => (((Math.atan2(x, -z) / DEG) % 360) + 360) % 360

/** 两个 sRGB 颜色按 t 插值（返回 sRGB 十六进制串，交给 ColorBuilder 统一转线性） */
function mix(c1, c2, t) {
  const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
  const a = p(c1)
  const b = p(c2)
  return (
    "#" +
    a
      .map((v, i) =>
        Math.round(v + (b[i] - v) * t)
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  )
}

/* ---------------- 轮廓 ---------------- */

/** 按名称查楼，查不到时用兜底矩形；返回 { pts, rect, found } */
function footprintOf(ctx, name, fb) {
  const { buildings, project, spot } = ctx
  const i = findBuilding(buildings, name, {
    near: [spot.x, spot.z],
    maxDist: 400
  })
  if (i >= 0) {
    const pts = buildings[i].p
    return { pts, rect: minAreaRect(pts), found: true }
  }
  const [lon, lat, w, d, bearing] = fb
  const [cx, cz] = project.toLocal(lon, lat)
  const pts = rectPolygon(cx, cz, w, d, bearing)
  return { pts, rect: minAreaRect(pts), found: false }
}

/**
 * 裙楼轮廓并上 T3、T4 之间的附楼：附楼与裙楼共用一条边（OSM 顶点完全重合），
 * 在裙楼轮廓的那条边中间插入附楼的另外两个顶点即可。共边找不到时不合并。
 */
function mergeAnnex(podium, annex) {
  const key = (p) => `${p[0]},${p[1]}`
  const n = podium.length
  for (let i = 0; i < n; i++) {
    const a = podium[i]
    const b = podium[(i + 1) % n]
    const ia = annex.findIndex((p) => key(p) === key(a))
    const ib = annex.findIndex((p) => key(p) === key(b))
    if (ia < 0 || ib < 0) continue
    // 沿附楼轮廓从 a 走到 b、且不经过共边的那一侧顶点（不含 a、b）
    const m = annex.length
    const step = key(annex[(ia + 1) % m]) === key(b) ? -1 : 1
    const extra = []
    for (let k = (ia + step + m) % m; k !== ib; k = (k + step + m) % m) {
      extra.push(annex[k])
    }
    return [...podium.slice(0, i + 1), ...extra, ...podium.slice(i + 1)]
  }
  return podium
}

/* ---------------- 塔楼 ---------------- */

/**
 * 玻璃塔楼：按轮廓外接矩形做方盒，底部深蓝 → 顶部浅蓝分段渐变，
 * 段与段之间一道略宽的深色腰线；四面细竖梃；顶部两段收进（各收 2 m、4.5 m）+ 屋顶设备间。
 */
function addTower(b, rect, h) {
  const f = rectFrame(rect, 0, 180)
  const { w, d } = rect
  const crown = 12 // 两段收顶的总高
  const shaft = h - crown
  const segs = Math.max(4, Math.round(shaft / 20))
  const segH = shaft / segs
  for (let i = 0; i < segs; i++) {
    const t = (i + 0.5) / segs
    b.add(
      box(w, segH, d),
      mix(C.glassLow, C.glassHigh, t),
      local(f, 0, i * segH, 0)
    )
    // 腰线：段顶一道 1.1 m 高、外凸 0.3 m 的深色带
    b.add(
      box(w + 0.6, 1.1, d + 0.6),
      C.band,
      local(f, 0, (i + 1) * segH - 0.55, 0)
    )
  }
  // 竖梃：四面约每 6 m 一根，贴在玻璃外 0.15 m
  const fins = (len, depth, yaw) => {
    const n = Math.max(2, Math.round(len / 6))
    for (let k = 1; k < n; k++) {
      const u = -len / 2 + (k * len) / n
      for (const s of [-1, 1]) {
        const x = Math.cos(yaw) * u + Math.sin(yaw) * s * (depth / 2 + 0.1)
        const z = -Math.sin(yaw) * u + Math.cos(yaw) * s * (depth / 2 + 0.1)
        b.add(box(0.35, shaft, 0.3), C.mullion, local(f, x, 0, z, yaw))
      }
    }
  }
  fins(w, d, 0)
  fins(d, w, Math.PI / 2)
  // 两段收顶：上段颜色延续渐变的最浅值
  b.add(box(w - 4, 6, d - 4), C.glassHigh, local(f, 0, shaft, 0))
  b.add(box(w - 3.4, 0.8, d - 3.4), C.band, local(f, 0, shaft + 5.6, 0))
  b.add(box(w - 9, 6, d - 9), C.glassHigh, local(f, 0, shaft + 6, 0))
  // 屋顶女儿墙压顶与设备间
  b.add(box(w - 8.6, 0.6, d - 8.6), C.towerRoof, local(f, 0, h - 0.3, 0))
  b.add(
    box(Math.min(14, w * 0.3), 3.5, Math.min(8, d * 0.35)),
    C.towerRoof,
    local(f, 0, h, 0)
  )
}

/* ---------------- 裙楼 ---------------- */

/**
 * 裙楼凸出的浅蓝玻璃盒：盒体外表面凸出立面 out 米，其余部分嵌进裙楼；底面深色；
 * 横向细分格线；可选标识（红色 UNIQLO 方块 / 灰色 IFS 字牌）。
 * ef 为所在长边的坐标系，s 为盒子中心离长边起点的距离（沿局部 X），
 * base 为立面外缘（局部 z），y0 / y1 为盒底 / 盒顶。
 */
function addGlassBox(b, ef, sx, opts) {
  const { width, y0, y1, out, depth = 8, base = 0, logo } = opts
  const h = y1 - y0
  // box 在局部 z 上居中：中心取「外表面 - 半深」，外表面恰在 base + out，背面嵌进裙楼
  const zc = base + out - depth / 2
  const f = local(ef, sx, 0, 0)
  b.add(box(width, h, depth), C.boxGlass, local(f, 0, y0, zc))
  // 深色底面 / 框：盒底一圈略大的薄板
  b.add(
    box(width + 0.4, 0.8, depth + 0.4, { bottom: true }),
    C.boxFrame,
    local(f, 0, y0 - 0.4, zc)
  )
  // 格线：正面与两侧每 3.6 m 一道（各面外凸 0.15 m，远景深度精度下不闪烁）
  for (let y = y0 + 3.6; y < y1 - 1; y += 3.6) {
    b.add(box(width + 0.3, 0.18, depth + 0.3), C.boxLine, local(f, 0, y, zc))
  }
  const face = base + out + 0.08
  if (logo === "uniqlo") {
    b.add(box(3.6, 3.6, 0.16), C.logoRed, local(f, 0, y0 + h * 0.45, face))
  } else if (logo === "ifs") {
    addIfsLetters(b, local(f, 0, y0 + h * 0.5, face))
  }
}

/**
 * 「IFS」字样：笔画用细长方块拼出（字高 4.4 m，笔画宽 0.7 m），原点在字样中心、贴在玻璃面上。
 * 每个笔画 [x, y, 宽, 高]，x / y 为笔画中心。
 */
function addIfsLetters(b, f) {
  const H = 4.4
  const s = 0.7
  const strokes = [
    // I
    [-3.6, 0, s, H],
    // F：竖笔 + 顶横 + 中横
    [-1.9, 0, s, H],
    [-0.9, H / 2 - s / 2, 2.0, s],
    [-1.05, 0, 1.7, s],
    // S：三横 + 左上竖 + 右下竖
    [2.4, H / 2 - s / 2, 2.4, s],
    [2.4, 0, 2.4, s],
    [2.4, -H / 2 + s / 2, 2.4, s],
    [1.55, H / 4, s, H / 2],
    [3.25, -H / 4, s, H / 2]
  ]
  for (const [x, y, w, h] of strokes) {
    b.add(box(w, h, 0.16), C.logoGrey, local(f, x, y - h / 2, 0))
  }
}

/**
 * 裙楼本体：轮廓挤出、底层店面、石材横纹、女儿墙；
 * frontEdge（红星路长边）上部石材体量外挑 CANTI_OUT。
 */
function addPodium(b, pts, edges, frontEdge) {
  b.add(extrudePolygon(pts, [], 0, ROOF_Y), C.stone)
  for (const e of edges) {
    const front = e === frontEdge
    const o = front ? CANTI_OUT : 0
    // 底层深色玻璃店面（外凸 0.25 m）
    b.add(box(e.len, STORE_H, 0.5), C.store, local(e.m, 0, 0, 0))
    if (front) {
      // 外挑石材体量：自 CANTI_Y 到屋面，底面可见
      b.add(
        box(e.len, ROOF_Y - CANTI_Y, CANTI_OUT, { bottom: true }),
        C.stone,
        local(e.m, 0, CANTI_Y, CANTI_OUT / 2)
      )
      b.add(
        box(e.len, 0.15, CANTI_OUT, { bottom: true }),
        C.soffit,
        local(e.m, 0, CANTI_Y - 0.15, CANTI_OUT / 2)
      )
    }
    // 石材横纹：店面以上每 3 m 一道细线（外凸 0.15 m）
    for (let y = STORE_H + 3; y < ROOF_Y - 0.5; y += 3) {
      if (front && y < CANTI_Y) continue
      b.add(box(e.len, 0.3, 0.3), C.stoneLine, local(e.m, 0, y, o))
    }
    // 女儿墙：内皮在立面内 0.8 m，外皮比立面外凸 0.15 m，盖住草皮侧面（两者相距 ≥ 0.15 m）
    b.add(
      box(e.len, PODIUM_H - ROOF_Y + 0.1, 0.95),
      C.parapet,
      local(e.m, 0, ROOF_Y - 0.1, o - 0.325)
    )
  }
  // 屋顶草皮
  b.add(extrudePolygon(pts, [], ROOF_Y, ROOF_Y + GRASS_T), C.grass)
}

/**
 * 屋顶花园：沿长轴一条蜿蜒小径 + 几条横向支路，其余位置随机种小树
 * （避开塔楼、女儿墙边、熊猫所在处与小径）。
 * @returns {Array<Array<number[]>>} 各段小径中线（世界坐标 [x, z]），供人群步行路径使用
 */
function addRoofGarden(b, pts, rect, towerRects, panda) {
  const f = rectFrame(rect, 0, 180)
  const toWorld = (u, v) => {
    const e = f.elements
    return [e[12] + e[0] * u + e[8] * v, e[14] + e[2] * u + e[10] * v]
  }
  const inside = (x, z, margin) => {
    if (!pointInPolygon(x, z, pts)) return false
    for (let i = 0; i < pts.length; i++) {
      if (distToSegment(x, z, pts[i], pts[(i + 1) % pts.length]) < margin)
        return false
    }
    for (const r of towerRects) {
      // 塔楼矩形局部坐标判断（外扩 margin）
      const bb = (r.bearing * DEG) % Math.PI
      const ux = Math.sin(bb)
      const uz = -Math.cos(bb)
      const du = (x - r.cx) * ux + (z - r.cz) * uz
      const dv = -(x - r.cx) * uz + (z - r.cz) * ux
      if (Math.abs(du) < r.w / 2 + margin && Math.abs(dv) < r.d / 2 + margin)
        return false
    }
    return true
  }
  const y = ROOF_Y + GRASS_T
  // 小径：沿长轴的正弦曲线，截取落在花园里的连续段
  const paths = []
  const main = []
  for (let u = -rect.w / 2; u <= rect.w / 2; u += 6) {
    main.push([u, 14 * Math.sin(u / 26)])
  }
  paths.push(main)
  for (const u0 of [-55, -5, 45]) {
    const line = []
    for (let v = -rect.d / 2; v <= rect.d / 2; v += 6) {
      line.push([u0 + 6 * Math.sin(v / 15), v])
    }
    paths.push(line)
  }
  const pathPts = []
  const runs = []
  for (const line of paths) {
    let run = []
    const flush = () => {
      // 小径高 0.25、底边下沉 0.05：顶面高出草皮 0.2 m
      if (run.length >= 2) {
        b.add(sweepBar(run, PATH_W, 0.25), C.path)
        runs.push(run.map(([x, , z]) => [x, z]))
      }
      run = []
    }
    for (const [u, v] of line) {
      const [x, z] = toWorld(u, v)
      if (inside(x, z, 2.5)) {
        run.push([x, y - 0.05, z])
        pathPts.push([x, z])
      } else flush()
    }
    flush()
  }
  // 小树：确定性随机撒点
  const rnd = mulberry32(20260929)
  const greens = THEME.tree.greens
  let planted = 0
  const trees = []
  for (let tries = 0; tries < 900 && planted < 46; tries++) {
    const u = (rnd() - 0.5) * rect.w
    const v = (rnd() - 0.5) * rect.d
    const [x, z] = toWorld(u, v)
    if (!inside(x, z, 4)) continue
    if (Math.hypot(x - panda[0], z - panda[1]) < 11) continue
    if (pathPts.some(([px, pz]) => Math.hypot(x - px, z - pz) < 3.2)) continue
    const r = 1.8 + rnd() * 1.4
    const trunkH = 1.6 + rnd() * 1.2
    b.add(
      cylinder(0.28, 0.22, trunkH + r * 0.5, { segments: 5 }),
      C.trunk,
      local(null, x, y, z)
    )
    b.add(
      sphere(r, 8, 6),
      greens[Math.floor(rnd() * greens.length)],
      local(null, x, y + trunkH, z, 0, 1, 1.1, 1)
    )
    trees.push([x, z, r])
    planted++
  }
  return clearRuns(runs, trees)
}

/**
 * 小径中线避开树冠：树只和小径的采样点（每 6 m 一个）保持 3.2 m，
 * 采样点之间的小径仍可能擦到树冠。把每段小径按 1 m 重采样，
 * 离树心不足「树冠半径 + WALK_CLEAR」的点断开，剩下长于 8 m 的连续段作为步行路径。
 * @param {Array<Array<number[]>>} runs 小径中线（世界坐标 [x, z]）
 * @param {Array<number[]>} trees 树 [x, z, 树冠半径]
 */
function clearRuns(runs, trees) {
  const out = []
  for (const run of runs) {
    let cur = []
    let len = 0
    const flush = () => {
      if (cur.length >= 2 && len >= 8) out.push(cur)
      cur = []
      len = 0
    }
    for (let i = 0; i < run.length - 1; i++) {
      const [ax, az] = run[i]
      const [bx, bz] = run[i + 1]
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)))
      // 每段的终点留给下一段做起点（最后一段含终点）
      const last = i === run.length - 2 ? n : n - 1
      for (let k = 0; k <= last; k++) {
        const x = ax + ((bx - ax) * k) / n
        const z = az + ((bz - az) * k) / n
        const hit = trees.some(
          ([tx, tz, r]) => Math.hypot(x - tx, z - tz) < r + WALK_CLEAR
        )
        if (hit) {
          flush()
          continue
        }
        if (cur.length) {
          const [px, pz] = cur[cur.length - 1]
          len += Math.hypot(x - px, z - pz)
        }
        cur.push([x, z])
      }
    }
    flush()
  }
  return out
}

/* ---------------- 入口 ---------------- */

export function build(ctx) {
  const b = new ColorBuilder()
  const pb = new ColorBuilder() // 熊猫单独一批（平面着色材质）

  // 裙楼 + 附楼轮廓
  const podium = footprintOf(ctx, "IFS国际金融中心", FALLBACK.podium)
  const annex = (() => {
    // 附楼在 OSM 里无名：取离兜底中心 15 m 内最近的无名四边形楼（是否与裙楼共边由 mergeAnnex 判断）；
    // 找不到就不并入，也不加替换区
    const [cx, cz] = ctx.project.toLocal(ANNEX[0], ANNEX[1])
    let best = -1
    let bestD = 15
    ctx.buildings.forEach((bd, i) => {
      if (bd.n || !bd.p || bd.p.length !== 4) return
      const mx = bd.p.reduce((s, p) => s + p[0], 0) / 4
      const mz = bd.p.reduce((s, p) => s + p[1], 0) / 4
      const dd = Math.hypot(mx - cx, mz - cz)
      if (dd < bestD) {
        best = i
        bestD = dd
      }
    })
    return best >= 0 ? ctx.buildings[best].p : null
  })()
  const podiumPts =
    podium.found && annex ? mergeAnnex(podium.pts, annex) : podium.pts
  const edges = edgeFrames(podiumPts)

  // 红星路长边：外法向最接近「长轴方位 - 90°」（西北偏西）的边里最长的一条
  const streetBearing = (podium.rect.bearing + 270) % 360
  const offStreet = (e) =>
    bearingDiff(bearingOf(e.out[0], e.out[1]), streetBearing)
  const maxLen = Math.max(...edges.map((e) => e.len))
  const frontEdge =
    edges.filter((e) => offStreet(e) < 30).sort((p, q) => q.len - p.len)[0] ||
    // 兜底：轮廓异常时，在较长的边（≥ 最长边的 30%）里取外法向最接近预期方位的一条
    edges
      .filter((e) => e.len >= maxLen * 0.3)
      .sort((p, q) => offStreet(p) - offStreet(q))[0]

  // 长边坐标系：原点取北端（z 较小的端点），沿用该边的 yaw（+Z 朝街）；
  // 若该边的局部 X 指向北，则「离北端 s 米」在局部 X 上为 -s
  const north = frontEdge.a[1] < frontEdge.b[1] ? frontEdge.a : frontEdge.b
  const south = north === frontEdge.a ? frontEdge.b : frontEdge.a
  const dir =
    Math.cos(frontEdge.yaw) * (south[0] - north[0]) -
      Math.sin(frontEdge.yaw) * (south[1] - north[1]) >=
    0
      ? 1
      : -1
  const ef = local(null, north[0], 0, north[1], frontEdge.yaw)
  const alongX = (s) => dir * s

  addPodium(b, podiumPts, edges, frontEdge)

  // 红星路立面的浅蓝玻璃盒（离北端的距离 s、宽、上下沿、外凸量、标识）
  const boxes = [
    { s: 15, width: 18, y0: 13, y1: 43.5, out: 5, logo: "ifs" },
    { s: 46, width: 20, y0: 19, y1: 42.5, out: 4, logo: "uniqlo" },
    { s: 72, width: 17, y0: 21, y1: 43, out: 5, logo: "uniqlo" },
    { s: 128, width: 22, y0: 17, y1: 42, out: 4 }
  ]
  for (const bx of boxes) {
    if (bx.s + bx.width / 2 > frontEdge.len - 4) continue
    addGlassBox(b, ef, alongX(bx.s), { ...bx, base: CANTI_OUT })
  }

  // 塔楼
  const towerRects = []
  const found = []
  const missing = []
  const zones = [podiumPts]
  // 附楼只有真正并进裙楼轮廓（被模型替代）时才加进替换区
  if (annex && podiumPts !== podium.pts) zones.push(annex)
  for (const t of TOWERS) {
    const fp = footprintOf(ctx, t.name, FALLBACK[t.name])
    ;(fp.found ? found : missing).push(t.name)
    towerRects.push(fp.rect)
    zones.push(fp.pts)
    addTower(b, fp.rect, t.h)
  }
  ;(podium.found ? found : missing).push("IFS国际金融中心")
  if (missing.length) {
    console.warn(
      `成都 IFS：未在 OSM 中找到 ${missing.join("、")}，已按兜底坐标放置`
    )
  }

  // 熊猫：原点在女儿墙顶外沿（外挑体量外皮），+Z 朝街
  const pandaFrame = local(ef, alongX(PANDA_S), PODIUM_H, CANTI_OUT)
  addPanda(pb, pandaFrame, { height: PANDA_H })
  const pe = pandaFrame.elements
  const gardenPaths = addRoofGarden(b, podiumPts, podium.rect, towerRects, [
    pe[12],
    pe[14]
  ])

  // 步行路径：屋顶花园各段小径中线 + 红星路一侧人行道（与临街长边平行）
  const walkways = gardenPaths.map((points) => ({
    points,
    y: PATH_TOP,
    width: WALK_W,
    closed: false,
    density: 2
  }))
  const sw = SIDEWALK
  const ux = (south[0] - north[0]) / frontEdge.len
  const uz = (south[1] - north[1]) / frontEdge.len
  const [ox, oz] = frontEdge.out
  const along = (p, t) => [
    p[0] + ux * t + ox * sw.off,
    p[1] + uz * t + oz * sw.off
  ]
  walkways.push({
    points: [along(north, sw.trim), along(south, -sw.trim)],
    y: sw.y,
    width: sw.width,
    closed: false,
    density: sw.density
  })

  const meshes = []
  const g = b.bake()
  if (g) {
    const mat = landmarkMaterial()
    // 本景点全由封闭体块组成：阴影贴图只画背光面（与通用楼一致），
    // 避免双面材质在大面积平屋面（草坪、塔顶）上出现自阴影条纹
    mat.shadowSide = BackSide
    meshes.push(new Mesh(g, mat))
  }
  const pg = pb.bake()
  if (pg) meshes.push(new Mesh(pg, flatMaterial()))

  return {
    meshes,
    zones,
    // 定位针的底座 = 落点处的屋顶花园草皮顶面（落点在熊猫身后 20 m 的屋顶花园里）：
    // 竖线落在草地上，小球悬在其上 14 m，高于熊猫头顶（女儿墙顶 + 0.44·PANDA_H ≈ 48.8 m）
    markerHeight: ROOF_Y + GRASS_T,
    walkways
  }
}

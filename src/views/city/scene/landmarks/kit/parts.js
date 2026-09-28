/*
 * 古建构件：台基、柱列、墙体、殿堂、栏杆、灯笼
 * （亭、塔见 towers.js，坡屋顶民居见 houses.js，均由本文件转出，外部统一从 parts.js 导入）
 * ----------------------------------------------------------
 * 所有函数形如 addXxx(b, parent, opts)：直接把几何体加进 ColorBuilder b，
 * parent 为 Matrix4 坐标系（通常是 frame(...) 的结果，局部 +Z 为正面）。
 * 构件底面在局部 y = 0（或 opts.y），水平居中于原点；尺寸单位米。
 * 颜色缺省取 THEME.landmark；殿堂 / 亭子可用 opts.colors 覆盖其中任意几项，
 * 键名见 palette()。返回「整体高度」的函数，返回值为局部坐标下的最高点 y。
 */
import { local } from "./builder.js"
import { box, cylinder, sphere } from "./shapes.js"
import {
  gableRidge,
  gableRoof,
  gableWalls,
  hipRidges,
  hipRoof,
  roofHeight
} from "./roofs.js"
import { L, addTop, clamp, eaveDrop, palette } from "./common.js"

export { palette, edgeFrame } from "./common.js"
export { addPavilion, addPagoda } from "./towers.js"
export { addPitchedHouse, housePieces } from "./houses.js"

/* ---------------- 台基 ---------------- */

/**
 * 台基方台：w × d × h，顶沿一圈略宽的压面石。
 * steps："front" 正面（+Z）| "both" 前后 | "all" 四面 | "none"；
 * 台阶宽 min(边长 × 0.35, 8)、每级高约 0.3、踏步深 0.35。
 */
export function addPlatform(b, parent, opts) {
  const { w, d, h, steps = "front", color = L.granite } = opts
  b.add(box(w, h, d), color, parent)
  // 压面石：顶部 0.15 m 高、四周各宽出 0.12 m
  const lip = Math.min(0.15, h * 0.3)
  b.add(box(w + 0.24, lip, d + 0.24), color, local(parent, 0, h - lip, 0))
  const sides = {
    front: [0],
    both: [0, Math.PI],
    all: [0, Math.PI / 2, Math.PI, -Math.PI / 2],
    none: []
  }[steps] || [0]
  const n = Math.max(1, Math.round(h / 0.3))
  const rise = h / n
  const tread = 0.35
  for (const yaw of sides) {
    // yaw = 0 为 +Z 面；绕 Y 转 π/2 后局部 +Z 指向 +X
    const across = Math.abs(Math.sin(yaw)) > 0.5
    const edge = across ? w / 2 : d / 2
    const sw = Math.min((across ? d : w) * 0.35, 8)
    const m = local(parent, 0, 0, 0, yaw)
    for (let k = 1; k < n; k++) {
      b.add(
        box(sw, h - k * rise, tread),
        color,
        local(m, 0, 0, edge + (k - 0.5) * tread)
      )
    }
    // 台阶两侧的垂带石
    for (const sx of [-1, 1]) {
      b.add(
        box(0.3, h * 0.55, (n - 1) * tread + 0.1),
        color,
        local(m, sx * (sw / 2 + 0.15), 0, edge + ((n - 1) * tread) / 2)
      )
    }
  }
}

/* ---------------- 柱列 ---------------- */

/**
 * 沿 w × d 矩形周边等距立圆柱（8 边形，平滑法线）。
 * @returns {Array<[number, number]>} 柱位 [x, z]
 */
export function addColumns(b, parent, opts) {
  const {
    w,
    d,
    h,
    spacing = 3.2,
    radius = 0.35,
    y = 0,
    color = L.column
  } = opts
  const nx = Math.max(1, Math.round(w / spacing))
  const nz = Math.max(1, Math.round(d / spacing))
  const at = []
  for (let i = 0; i <= nx; i++) {
    const x = -w / 2 + (i * w) / nx
    at.push([x, d / 2], [x, -d / 2])
  }
  for (let j = 1; j < nz; j++) {
    const z = -d / 2 + (j * d) / nz
    at.push([w / 2, z], [-w / 2, z])
  }
  for (const [x, z] of at) {
    b.add(cylinder(radius, radius * 0.9, h), color, local(parent, x, y, z))
  }
  return at
}

/* ---------------- 墙体 ---------------- */

/**
 * 四面墙体（实心箱体），正面（+Z）中央贴一块门色薄板（离墙面 0.05 m）。
 * door：{ width = min(w × 0.3, 3.2), height = h × 0.75, color = lattice }，传 false 不开门。
 */
export function addWalls(b, parent, opts) {
  const { w, d, h, y = 0, color = L.redWall, door = {} } = opts
  b.add(box(w, h, d), color, local(parent, 0, y, 0))
  if (door) {
    const dw = door.width ?? Math.min(w * 0.3, 3.2)
    const dh = door.height ?? h * 0.75
    b.add(
      box(dw, dh, 0.1),
      door.color ?? L.lattice,
      local(parent, 0, y, d / 2 + 0.05)
    )
  }
}

/** 柱顶一圈额枋（矩形），底在 y */
function addBeamRing(b, parent, w, d, y, bh, color) {
  const t = 0.4
  for (const sz of [-1, 1]) {
    b.add(box(w + t, bh, t), color, local(parent, 0, y, (sz * d) / 2))
  }
  for (const sx of [-1, 1]) {
    b.add(box(t, bh, d), color, local(parent, (sx * w) / 2, y, 0))
  }
}

/* ---------------- 殿堂 ---------------- */

/**
 * 殿堂：台基 + 檐柱 + 内缩 0.8 m 的墙体 + 正面花格门窗色带 + 额枋 + 屋顶。
 * w × d 为台基（即 OSM 轮廓）尺寸，w 沿局部 X（屋脊方向，通常为长边），d 沿 Z（进深），
 * 檐柱从台基边内缩 clamp(0.1 × 短边, 0.5, 1.5)。由 minAreaRect 结果放置时用 rectFrame()。
 * @param {object} opts
 *   { w, d, wallH = 5, platformH = 1.2, roof = "hip" | "gable", roofH, overhang,
 *     curl = 0.3, ridge = 0.55, double = false, steps = "front", spacing = 3.2,
 *     columnRadius = 0.35, colors }
 *   roofH 缺省为柱网进深的 0.42（悬山 0.3）；overhang 缺省为进深的 0.16（0.8～3）。
 *   double: true 做重檐（仅四坡顶）：下层截断檐放在柱顶，中间一圈上层墙
 *   （露出 0.4 × wallH），上层完整屋顶盖在上层墙顶。
 * @returns {number} 整体高度（屋脊 / 吻兽最高点）
 */
export function addHall(b, parent, opts) {
  const { w, d, wallH = 5, platformH = 1.2, roof = "hip" } = opts
  const c = palette(opts.colors)
  const inset = clamp(0.1 * Math.min(w, d), 0.5, 1.5)
  const cw = w - 2 * inset
  const cd = d - 2 * inset
  const gable = roof === "gable"
  const roofH = opts.roofH ?? cd * (gable ? 0.3 : 0.42)
  const o = opts.overhang ?? clamp(0.16 * cd, 0.8, 3)
  const curl = opts.curl ?? 0.3
  const ridge = opts.ridge ?? 0.55

  addPlatform(b, parent, {
    w,
    d,
    h: platformH,
    steps: opts.steps ?? "front",
    color: c.platform
  })
  const y0 = platformH
  addColumns(b, parent, {
    w: cw,
    d: cd,
    h: wallH,
    y: y0,
    spacing: opts.spacing ?? 3.2,
    radius: opts.columnRadius ?? 0.35,
    color: c.column
  })
  // 墙体在柱内 0.8 m；正面整面花格门窗色带（高为墙高 70%）
  const ww = Math.max(1, cw - 1.6)
  const wd = Math.max(1, cd - 1.6)
  addWalls(b, parent, {
    w: ww,
    d: wd,
    h: wallH,
    y: y0,
    color: c.wall,
    door: false
  })
  b.add(
    box(ww * 0.96, wallH * 0.7, 0.1),
    c.lattice,
    local(parent, 0, y0, wd / 2 + 0.05)
  )
  const beamH = clamp(0.1 * wallH, 0.35, 0.8)
  const top = y0 + wallH
  addBeamRing(b, parent, cw, cd, top - beamH, beamH, c.lattice)

  if (gable) {
    const go = { overhang: o, ridges: false, gables: false }
    const y = top - eaveDrop(cd / 2, o, roofH, 1.3, 0.5)
    const m = local(parent, 0, y, 0)
    b.add(gableRoof(cw, cd, roofH, go), c.roof, m)
    b.add(gableWalls(cw, cd, roofH, go), c.wall, m)
    return addTop(b, gableRidge(cw, cd, roofH, go), c.ridge, m, y)
  }

  const ro = { overhang: o, curl, ridge, ridges: false }
  const y = top - eaveDrop(cd / 2, o, roofH, 1.5, 0.5)
  if (!opts.double) {
    const m = local(parent, 0, y, 0)
    b.add(hipRoof(cw, cd, roofH, ro), c.roof, m)
    return addTop(b, hipRidges(cw, cd, roofH, ro), c.ridge, m, y)
  }

  // 重檐：下层截断到 tMax = 0.55，只剩一圈檐
  const tMax = 0.55
  const lower = { ...ro, tMax }
  const ml = local(parent, 0, y, 0)
  b.add(hipRoof(cw, cd, roofH, lower), c.roof, ml)
  b.add(hipRidges(cw, cd, roofH, lower), c.ridge, ml)
  // 下层檐内缘围出的矩形（上层墙须盖住它）
  const ex = cw / 2 + o
  const ez = cd / 2 + o
  const hx = ex * (1 - tMax) + ((ridge * cw) / 2) * tMax
  const hz = ez * (1 - tMax)
  const ringTop = y + roofHeight(0, tMax, roofH, 0)
  const y1 = ringTop + 0.4 * wallH
  // 上层墙从柱顶起（下半截藏在下层檐下面），露出 0.4 × wallH
  b.add(
    box(2 * hx + 0.4, y1 - top, 2 * hz + 0.4),
    c.column,
    local(parent, 0, top, 0)
  )
  b.add(
    box(2 * hx * 0.9, (y1 - ringTop) * 0.8, 0.1),
    c.lattice,
    local(parent, 0, ringTop, hz + 0.25)
  )
  const uw = 2 * hx
  const ud = 2 * hz
  const uH = roofH * 0.8
  const uo = Math.max(0.6, 0.8 * ez - hz)
  const yu = y1 - eaveDrop(hz, uo, uH)
  const upper = { ...ro, overhang: uo }
  const mu = local(parent, 0, yu, 0)
  b.add(hipRoof(uw, ud, uH, upper), c.roof, mu)
  return addTop(b, hipRidges(uw, ud, uH, upper), c.ridge, mu, yu)
}

/* ---------------- 栏杆 ---------------- */

/**
 * 沿折线立栏杆：望柱 + 寻杖扶手 + 实心栏板（汉白玉式）。
 * @param {object} opts
 *   { points: [[x, z], ...], closed = true, h = 1.1, postSpacing = 2, y = 0, color = marble }
 */
export function addBalustrade(b, parent, opts) {
  const { points, closed = true, h = 1.1, postSpacing = 2, y = 0 } = opts
  const color = opts.color ?? L.marble
  const n = points.length
  const segs = closed ? n : n - 1
  for (let i = 0; i < segs; i++) {
    const [x0, z0] = points[i]
    const [x1, z1] = points[(i + 1) % n]
    const len = Math.hypot(x1 - x0, z1 - z0)
    if (len < 1e-6) continue
    // 局部 X 沿线段方向：绕 Y 转 θ 后 (1,0,0) → (cos θ, 0, -sin θ)
    const yaw = Math.atan2(-(z1 - z0), x1 - x0)
    const m = local(parent, (x0 + x1) / 2, y, (z0 + z1) / 2, yaw)
    b.add(box(len, 0.12, 0.16), color, local(m, 0, h * 0.8, 0))
    b.add(box(len, h * 0.55, 0.08), color, local(m, 0, h * 0.15, 0))
    b.add(box(len, 0.12, 0.2), color, m)
    const posts = Math.max(1, Math.ceil(len / postSpacing))
    const last = !closed && i === segs - 1 ? posts : posts - 1
    for (let p = 0; p <= last; p++) {
      const u = p / posts - 0.5
      b.add(box(0.22, h, 0.22), color, local(m, u * len, 0, 0))
      b.add(box(0.26, 0.12, 0.26), color, local(m, u * len, h, 0))
    }
  }
}

/* ---------------- 灯笼 ---------------- */

/**
 * 灯笼：压扁球身 + 上下金色小帽 + 流苏，(x, y, z) 为球心（父坐标系）。
 * @param {object} [opts] { r = 0.5, color = lantern }
 */
export function addLantern(b, parent, x, y, z, opts = {}) {
  const { r = 0.5, color = L.lantern } = opts
  const m = local(parent, x, y, z)
  b.add(sphere(r, 10, 7), color, local(m, 0, -r * 0.82, 0, 0, 1, 0.82, 1))
  b.add(
    cylinder(r * 0.42, r * 0.42, r * 0.2, { caps: true }),
    L.gold,
    local(m, 0, r * 0.72, 0)
  )
  b.add(
    cylinder(r * 0.42, r * 0.42, r * 0.2, { caps: true }),
    L.gold,
    local(m, 0, -r * 0.92, 0)
  )
  b.add(
    cylinder(r * 0.08, r * 0.08, r * 0.7, { segments: 5 }),
    color,
    local(m, 0, -r * 1.6, 0)
  )
}

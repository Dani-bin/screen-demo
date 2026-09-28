/*
 * 亭与塔：正 n 边形平面的构件
 * ----------------------------------------------------------
 * 约定同 parts.js（本文件的函数也由 parts.js 转出，外部统一从 parts.js 导入）。
 * 正多边形朝向见 shapes.js：一条边正对 +Z，六边形时 ±X 方向为顶点。
 */
import { local } from "./builder.js"
import { box, cylinder, polygonVertex, prism } from "./shapes.js"
import { finial, pyramidRidges, pyramidRoof, roofHeight } from "./roofs.js"
import {
  L,
  addTop,
  clamp,
  eaveDrop,
  edgeFrame,
  lerpNum,
  palette,
  ridgeColorFor
} from "./common.js"

/* ---------------- 亭 ---------------- */

/**
 * 亭：正 n 边形台基 + n 根柱 + 柱顶额枋 + 坐凳栏（正面留口）+ 攒尖顶（可重檐）+ 宝顶。
 * 正多边形朝向：一条边正对 +Z（见 shapes.js），柱位于外接半径 radius 的顶点上。
 * @param {object} opts
 *   { sides = 6, radius, colH = 3.2, platformH = 0.8, roofH = radius × 0.9,
 *     double = true, roofColor = colors.roof, overhang = 0.35·radius + 0.3,
 *     curl = 0.3, columnRadius, colors }
 * @returns {number} 整体高度（宝顶尖）
 */
export function addPavilion(b, parent, opts) {
  const { sides = 6, radius, colH = 3.2, platformH = 0.8 } = opts
  const c = palette(opts.colors)
  const roofH = opts.roofH ?? radius * 0.9
  const double = opts.double ?? true
  const roofColor = opts.roofColor ?? c.roof
  const ridgeColor = ridgeColorFor(roofColor, c)
  const o = opts.overhang ?? 0.35 * radius + 0.3
  const curl = opts.curl ?? 0.3
  const colR = opts.columnRadius ?? clamp(0.06 * radius, 0.15, 0.4)

  if (platformH > 0) {
    const pr = radius + Math.max(0.6, 0.25 * radius)
    b.add(prism(sides, pr, pr, platformH), c.platform, parent)
  }
  const y0 = platformH
  for (let k = 0; k < sides; k++) {
    const [x, z] = polygonVertex(sides, radius, k)
    b.add(cylinder(colR, colR * 0.9, colH), c.column, local(parent, x, y0, z))
  }
  const side = 2 * radius * Math.sin(Math.PI / sides)
  const beamH = clamp(0.12 * colH, 0.25, 0.6)
  for (let k = 0; k < sides; k++) {
    b.add(
      box(side, beamH, colR * 1.4),
      c.lattice,
      edgeFrame(parent, sides, radius, k, y0 + colH - beamH)
    )
    // 坐凳栏：k = sides - 1 那条边正对 +Z，作为入口不设
    if (k === sides - 1) continue
    b.add(
      box(side - colR * 2, 0.5, 0.3),
      c.lattice,
      edgeFrame(parent, sides, radius, k, y0)
    )
  }

  const top = y0 + colH
  const ro = { overhang: o, curl, ridges: false }
  const margin = colR * 0.7 + 0.1
  // 攒尖顶沿径向插值：柱线处 t = 出檐 / 檐口外接半径，故传外接半径而非边心距
  const y = top - eaveDrop(radius, o, roofH, 1.5, margin)
  let apex
  let apexH
  if (!double) {
    const m = local(parent, 0, y, 0)
    b.add(pyramidRoof(sides, radius, roofH, ro), roofColor, m)
    b.add(pyramidRidges(sides, radius, roofH, ro), ridgeColor, m)
    apex = y + roofH
    apexH = roofH
  } else {
    // 下层檐截到一半，上层檐口半径只取下层的 72%、上层短墙露出 0.45 × colH，
    // 两层檐之间拉开距离，远看也能分辨出重檐
    const tMax = 0.5
    const lower = { ...ro, tMax }
    const m = local(parent, 0, y, 0)
    b.add(pyramidRoof(sides, radius, roofH, lower), roofColor, m)
    b.add(pyramidRidges(sides, radius, roofH, lower), ridgeColor, m)
    const R = radius + o
    const ringTop = y + roofHeight(0, tMax, roofH, 0)
    // 上层：一圈短墙盖住下层檐的内缘（外接半径略大于檐口内缘）
    const ur = R * (1 - tMax) + 0.25
    const y1 = ringTop + 0.45 * colH
    b.add(prism(sides, ur, ur, y1 - top), c.lattice, local(parent, 0, top, 0))
    const uH = roofH * 0.8
    const uo = Math.max(0.5, 0.72 * R - ur)
    const yu = y1 - eaveDrop(ur, uo, uH)
    const upper = { ...ro, overhang: uo }
    const mu = local(parent, 0, yu, 0)
    b.add(pyramidRoof(sides, ur, uH, upper), roofColor, mu)
    b.add(pyramidRidges(sides, ur, uH, upper), ridgeColor, mu)
    apex = yu + uH
    apexH = uH
  }
  // 宝顶底略埋进屋尖
  const fh = Math.max(0.8, 0.4 * apexH)
  return addTop(
    b,
    finial(fh),
    c.finial,
    local(parent, 0, apex - 0.06 * apexH, 0),
    apex - 0.06 * apexH
  )
}

/* ---------------- 塔 ---------------- */

/**
 * 塔：tiers 层，每层 n 边形塔身（半径由 baseRadius 线性收分到 topRadius）
 * + 塔身每面一块贴金佛龛色块 + 层间一圈截断攒尖翘檐；顶层完整攒尖 + 塔刹。
 * 首层塔身比其余层高，其余层自下而上略矮；总高（含塔刹）= height。
 * @param {object} opts
 *   { sides = 6, tiers, height, baseRadius, topRadius, bodyColor = pagodaRed,
 *     eaveColor = iron, trimColor = gold }
 * @returns {number} 整体高度（塔刹尖，等于 height）
 */
export function addPagoda(b, parent, opts) {
  const { sides = 6, tiers, height, baseRadius, topRadius } = opts
  const bodyColor = opts.bodyColor ?? L.pagodaRed
  const eaveColor = opts.eaveColor ?? L.iron
  const trimColor = opts.trimColor ?? L.gold
  const tMax = 0.5
  const curl = 0.38
  const spireH = 0.12 * height

  // 各层几何参数：半径 r、出檐 ov、檐高 eh、檐在塔身顶下沉 drop
  const levels = []
  for (let i = 0; i < tiers; i++) {
    const f = tiers > 1 ? i / (tiers - 1) : 0
    const r = lerpNum(baseRadius, topRadius, f)
    const ov = 0.4 * r + 0.15
    const last = i === tiers - 1
    const eh = 0.5 * (r + ov) * (last ? 1.6 : 1)
    const drop = eaveDrop(r, ov, eh, 1.5, 0)
    const weight = i === 0 ? 1.6 : lerpNum(1, 0.8, f)
    levels.push({ r, ov, eh, drop, weight, last })
  }
  // 上一层塔身从本层檐面上「上一层半径处」的高度起：
  // 檐内缘（截断处）比那里高，若从内缘起塔身底下会露出一圈缝
  let fixed = 0
  let weightSum = 0
  levels.forEach((lv, i) => {
    weightSum += lv.weight
    if (lv.last) {
      lv.rise = lv.eh - lv.drop
      return
    }
    const tn = Math.min(tMax, 1 - levels[i + 1].r / (lv.r + lv.ov))
    lv.rise = roofHeight(0, tn, lv.eh, 0) - lv.drop - 0.02
    fixed += lv.rise
  })
  const top = levels[tiers - 1]
  // 塔身总高 = 总高 - 塔刹 - 各层檐占高 - 顶层攒尖（塔刹底埋进屋尖 0.05·eh）
  const bodyTotal = Math.max(
    tiers * 0.5,
    height - spireH - fixed - top.rise + 0.05 * top.eh
  )
  const k = bodyTotal / weightSum

  let y = 0
  for (const lv of levels) {
    const hb = lv.weight * k
    b.add(prism(sides, lv.r, lv.r, hb), bodyColor, local(parent, 0, y, 0))
    // 每面一块贴金佛龛色块
    const side = 2 * lv.r * Math.sin(Math.PI / sides)
    for (let s = 0; s < sides; s++) {
      b.add(
        box(side * 0.62, hb * 0.6, 0.06),
        trimColor,
        edgeFrame(parent, sides, lv.r, s, y + hb * 0.18)
      )
    }
    const ye = y + hb - lv.drop
    const ro = {
      overhang: lv.ov,
      curl,
      tMax: lv.last ? 1 : tMax,
      ridges: false,
      thick: Math.max(0.06, 0.06 * lv.eh),
      // 塔檐小，细分减半即可保持翘角圆顺，三角形省一半以上
      segS: 6,
      segT: lv.last ? 4 : 3
    }
    const m = local(parent, 0, ye, 0)
    b.add(pyramidRoof(sides, lv.r, lv.eh, ro), eaveColor, m)
    b.add(pyramidRidges(sides, lv.r, lv.eh, ro), eaveColor, m)
    y += hb + lv.rise
  }
  // 塔刹：宝顶竖向拉长成细长尖顶
  const sy = y - 0.05 * top.eh // y 此时为顶层攒尖尖顶
  b.add(finial(spireH), trimColor, local(parent, 0, sy, 0, 0, 0.7, 1, 0.7))
  return sy + spireH
}

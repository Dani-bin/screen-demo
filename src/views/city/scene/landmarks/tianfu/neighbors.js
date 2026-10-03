/*
 * 天府广场 · 周边地标：成都博物馆、四川省图书馆
 * ----------------------------------------------------------
 * 职责：广场西侧两座馆，按名称在 OSM 几何数据里查轮廓与高度（查不到用回退轮廓），
 * 替换区就是各自的 OSM 轮廓。
 *
 * 几何冻结：设计文档的关键决策是「成都博物馆、四川省图书馆几何不变」，本文件的几何不再改动。
 * 为此本文件自带颜色表，不用 colors.js 的 C：图书馆正门台阶沿用毛主席像台基原先的颜色，
 * 与 C 里像组团的颜色脱钩，改像的颜色时这里不跟着变。
 */
import { frame, local } from "../kit/builder.js"
import { findBuilding, minAreaRect, rectFrame } from "../kit/footprint.js"
import { box } from "../kit/shapes.js"
import { polygonBounds } from "../../utils.js"

const NEAR = 400 // 按名称查楼的搜索半径（米）

// 按名称查不到时的回退轮廓（取自当前几何数据，世界坐标 [x, z]）
const FALLBACK = {
  成都博物馆: {
    h: 46.9,
    p: [
      [-465, -330],
      [-413, -330],
      [-411, -172],
      [-463, -171]
    ]
  },
  四川省图书馆: {
    h: 38.5,
    p: [
      [-518, -469],
      [-414, -472],
      [-414, -408],
      [-477, -399],
      [-517, -405]
    ]
  }
}

/* ---------------- 本文件专用色（冻结） ---------------- */

const C = {
  // 成都博物馆
  bronze: "#C9A55C", // 金色铜网
  bronzeLine: "#A7843F",
  museumGlass: "#4E9C82", // 绿色玻璃
  // 四川省图书馆
  libStone: "#D9CDB7",
  libFin: "#BCAE95",
  libGlass: "#5E93A6",
  libSlab: "#E6DECF",
  tier: "#E2DCCF" // 正门前大台阶（与拆分前共用的毛主席像台基色相同，这里单独一份）
}

/* ---------------- 成都博物馆 ---------------- */

/** 金色铜网立面（竖向网线 + 一道折线腰带）+ 底部与入口绿色玻璃；按 OSM 轮廓与高度 */
function buildChengduMuseum(b, bd) {
  const rect = minAreaRect(bd.p)
  // 局部 X 沿长边（南北），+Z 朝东（面向广场）
  const f = rectFrame(rect, 0, 90)
  const { w, d } = rect
  const H = bd.h || 46.9
  const podium = 10
  b.add(box(w - 4, podium, d - 4), C.museumGlass, f)
  b.add(box(w, H - podium, d), C.bronze, local(f, 0, podium, 0))
  b.add(box(w - 2, 0.6, d - 2), C.bronzeLine, local(f, 0, H, 0))
  // 腰带：铜网折线处略凸出
  b.add(box(w + 0.8, 1.2, d + 0.8), C.bronzeLine, local(f, 0, 27, 0))
  // 竖向网线：长边每 3.2 m、短边每 3.2 m 一道
  const lineH = H - podium - 0.4
  const nl = Math.floor(w / 3.2)
  for (let i = 1; i < nl; i++) {
    const x = -w / 2 + (w * i) / nl
    for (const sz of [-1, 1]) {
      b.add(
        box(0.5, lineH, 0.4),
        C.bronzeLine,
        local(f, x, podium + 0.2, sz * (d / 2 + 0.2))
      )
    }
  }
  const ns = Math.floor(d / 3.2)
  for (let i = 1; i < ns; i++) {
    const z = -d / 2 + (d * i) / ns
    for (const sx of [-1, 1]) {
      b.add(
        box(0.4, lineH, 0.5),
        C.bronzeLine,
        local(f, sx * (w / 2 + 0.2), podium + 0.2, z)
      )
    }
  }
  // 东立面中部绿色玻璃入口（通高 22 m）+ 白色雨棚
  b.add(box(34, 22, 1.2), C.museumGlass, local(f, 0, 0, d / 2 + 0.4))
  b.add(box(40, 0.8, 6), "#EDEBE4", local(f, 0, 9, d / 2 + 3))
}

/* ---------------- 四川省图书馆 ---------------- */

/**
 * 两座石材阙楼夹台阶式玻璃中庭（由南向北逐级升高）+ 竖向石材纹；正面朝南。
 * 主体按 OSM 轮廓南部的大矩形，北侧附楼按轮廓北端的小块。
 */
function buildLibrary(b, bd) {
  const bb = polygonBounds(bd.p)
  // 北侧附楼：轮廓里 z 最小（最北）一段的点
  const annexPts = bd.p.filter(([, z]) => z < bb.minZ + 5)
  const annexDepth = 21
  const hasAnnex = annexPts.length >= 2 && bb.maxZ - bb.minZ > 85
  const z0 = hasAnnex ? bb.minZ + annexDepth : bb.minZ
  const z1 = bb.maxZ - 4
  const W = bb.maxX - bb.minX
  const D = z1 - z0
  const H = bd.h || 38.5
  const f = frame((bb.minX + bb.maxX) / 2, 0, (z0 + z1) / 2, 0)

  const towerW = 22
  const atriumW = W - 2 * towerW
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - towerW / 2)
    b.add(box(towerW, H, D), C.libStone, local(f, x, 0, 0))
    b.add(box(towerW + 1, 1, D + 1), C.libFin, local(f, x, H, 0))
    // 竖向石材纹：南立面与外侧立面
    for (let i = 0; i < 8; i++) {
      const fx = x - towerW / 2 + 1.5 + (i * (towerW - 3)) / 7
      b.add(box(0.7, H - 2, 0.6), C.libFin, local(f, fx, 0, D / 2 + 0.3))
    }
    const nz = Math.floor(D / 3)
    for (let i = 0; i <= nz; i++) {
      const z = -D / 2 + 1.5 + ((D - 3) * i) / nz
      b.add(box(0.6, H - 2, 0.7), C.libFin, local(f, sx * (W / 2 + 0.3), 0, z))
    }
  }
  // 中庭：北半为高体量，南半四级玻璃台阶，顶面铺石
  const back = D * 0.43
  const zb = -D / 2 + back
  b.add(
    box(atriumW, H - 4, back),
    C.libGlass,
    local(f, 0, 0, -D / 2 + back / 2)
  )
  b.add(
    box(atriumW, 0.6, back),
    C.libSlab,
    local(f, 0, H - 4, -D / 2 + back / 2)
  )
  const terraces = 4
  const stepD = (D / 2 - zb) / terraces
  for (let i = 0; i < terraces; i++) {
    const h = 8 + i * 7
    const zf = D / 2 - i * stepD
    const depth = zf - zb
    const zc = (zf + zb) / 2
    b.add(box(atriumW, h, depth), C.libGlass, local(f, 0, 0, zc))
    // 石材压顶坐在玻璃体量顶上，并向前挑出 0.4 m，避免与玻璃面共面闪烁
    b.add(
      box(atriumW + 0.4, 0.8, depth + 0.4),
      C.libSlab,
      local(f, 0, h, zc + 0.2)
    )
  }
  // 正门前大台阶
  b.add(box(40, 1.2, 5), C.tier, local(f, 0, 0, D / 2 + 2.5))
  // 北侧附楼
  if (hasAnnex) {
    const ab = polygonBounds(annexPts)
    const aw = Math.max(10, ab.maxX - ab.minX)
    b.add(
      box(aw, Math.min(H, 30), annexDepth + 2),
      C.libStone,
      frame((ab.minX + ab.maxX) / 2, 0, bb.minZ + annexDepth / 2, 0)
    )
  }
}

/* ---------------- 入口 ---------------- */

/** 按名称查楼，查不到用回退轮廓 */
function lookup(buildings, name, spot) {
  const i = findBuilding(buildings, name, {
    near: [spot.x, spot.z],
    maxDist: NEAR
  })
  if (i >= 0) return buildings[i]
  return FALLBACK[name]
}

/**
 * 建成都博物馆与四川省图书馆（顺序与拆分前一致：先博物馆、后图书馆）。
 * @param {ColorBuilder} b 静态件
 * @param {object} site 场地对象（site.js 的 createSite），用到 site.buildings、site.spot
 * @returns {{ zones: Array }} 两座馆的替换区（OSM 轮廓，世界坐标）
 */
export function buildNeighbors(b, site) {
  const { buildings, spot } = site
  const museum = lookup(buildings, "成都博物馆", spot)
  buildChengduMuseum(b, museum)
  const library = lookup(buildings, "四川省图书馆", spot)
  buildLibrary(b, library)
  return { zones: [museum.p, library.p] }
}

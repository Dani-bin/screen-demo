#!/usr/bin/env node
/*
 * 景点模型校验（Node，只读仓库）
 * ----------------------------------------------------------
 * 用法（仓库根目录）：
 *   node scripts/city-landmark-check.mjs stats 熊猫基地 杜甫草堂 …
 *     每个景点一行：三角形（各 Mesh 分列）、Mesh 数、定位针底座高度、步行路径条数与总长、几何哈希、构建耗时。
 *     几何哈希对各 Mesh 的世界矩阵与 position / color 字节做 FNV-1a，用来确认重构前后几何一字不差。
 *   node scripts/city-landmark-check.mjs walk 熊猫基地
 *     步行路径校验（方法同 docs/superpowers/specs/2026-09-29-city-crowd-design.md「校验方法」）：
 *     1 支撑面：可走带内每个样点，路径高度 y + 0.25 以下最高的景点表面须与 y 相差 ≤ 0.06 m；
 *     2 头顶净空：样点正上方 y + 0.25 ～ y + 4.35 之间不得有景点表面；
 *     3 分部件净距：腿 / 身体 / 头三个高度带内的景点三角形，离样点的水平距离分别 ≥ 0.63 / 0.86 / 0.52 m；
 *       开放路径端点再沿路径方向外探 1 m 取样，只查是否碰到障碍（不要求净距；
 *       同 dufu.js 设计注释的口径）。
 *     只看景点自己的三角形（城市通用楼、通用树、水面不在其中）。有坏点时退出码为 1。
 * 景点构建与线上一致：ctx = { project, buildings, theme, spot }（同 lab.js 的 buildSubject）。
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Vector3 } from "three"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const imp = (p) => import(pathToFileURL(resolve(ROOT, p)).href)
const { createProjection } = await imp("src/views/city/scene/projection.js")
const { THEME } = await imp("src/views/city/scene/theme.js")
const { SPOTS } = await imp("src/views/city/data/cityData.js")
const { buildLandmark } = await imp("src/views/city/scene/landmarks/index.js")

const geo = JSON.parse(
  readFileSync(resolve(ROOT, "public/city/chengdu.json"), "utf8")
)
const project = createProjection(geo.meta.origin)

/** 按景点名构建（ctx 与 createLandmarks 传给模块的完全一致） */
function build(name) {
  const raw = SPOTS.find((s) => s.name === name)
  if (!raw) throw new Error(`未知景点：${name}`)
  const [x, z] = project.toLocal(raw.lon, raw.lat)
  return buildLandmark(name, {
    project,
    buildings: geo.buildings,
    theme: THEME,
    spot: { ...raw, x, z }
  })
}

/** 模块返回的全部 Mesh（含子孙），世界矩阵已更新 */
function meshesOf(r) {
  const out = []
  for (const root of r.meshes) {
    root.updateWorldMatrix(true, true)
    root.traverse((o) => {
      if (o.isMesh && o.geometry) out.push(o)
    })
  }
  return out
}

/** FNV-1a 累加一段字节 */
function fnv(hash, bytes) {
  let h = hash
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}
const bytesOf = (arr) =>
  new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)

/** 折线长度（closed 时含末点回到首点） */
function pathLength(points, closed) {
  let len = 0
  const n = closed ? points.length : points.length - 1
  for (let i = 0; i < n; i++) {
    const [ax, az] = points[i]
    const [bx, bz] = points[(i + 1) % points.length]
    len += Math.hypot(bx - ax, bz - az)
  }
  return len
}

function stats(name) {
  const t0 = performance.now()
  const r = build(name)
  const ms = performance.now() - t0
  let tris = 0
  let hash = 2166136261
  const per = []
  for (const m of meshesOf(r)) {
    const g = m.geometry
    const n = (g.index ? g.index.count : g.attributes.position.count) / 3
    tris += n
    per.push(String(n))
    hash = fnv(hash, bytesOf(new Float32Array(m.matrixWorld.elements)))
    for (const key of ["position", "color"]) {
      const a = g.attributes[key]
      if (a) hash = fnv(hash, bytesOf(a.array))
    }
  }
  const walk = r.walkways.reduce(
    (s, w) => s + pathLength(w.points, w.closed),
    0
  )
  console.log(
    `${name}  三角形 ${tris}（${per.join(" + ")}）  Mesh ${per.length}  ` +
      `底座 ${r.markerHeight.toFixed(1)}  路径 ${r.walkways.length} 条 ` +
      `${Math.round(walk)} m  哈希 ${hash.toString(16).padStart(8, "0")}  ` +
      `构建 ${ms.toFixed(0)} ms`
  )
}

/* ---------------- 步行路径校验 ---------------- */

const HEAD = 4.35 // 最高个体头顶（4 m × 1.08）
const STEP = 0.5 // 沿中线取样间距
const LAT = 0.25 // 横向取样间距
const SUPPORT_TOL = 0.06
const UNDERFOOT = 0.25 // 路面以上这个高度以内的表面算「脚下」，以上算「头顶」
const CELL = 2 // 三角形索引格（米）
const BANDS = [
  { name: "腿", y0: 0.25, y1: 1.56, clear: 0.63 },
  { name: "身体", y0: 1.56, y1: 3.11, clear: 0.86 },
  { name: "头", y0: 3.11, y1: HEAD, clear: 0.52 }
]
const MAX_CLEAR = 0.86

/** 一条路径的样点：{ x, z, end }，end 为开放路径端点外探样点（只查净距） */
function samplesOf(w) {
  const pts = w.closed ? [...w.points, w.points[0]] : w.points
  const half = w.width / 2
  const nLat = Math.floor(half / LAT + 1e-9)
  const out = []
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i]
    const [bx, bz] = pts[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    if (len < 1e-6) continue
    const ux = (bx - ax) / len
    const uz = (bz - az) / len
    const n = Math.ceil(len / STEP)
    for (let s = 0; s <= n; s++) {
      const t = (s / n) * len
      for (let k = -nLat; k <= nLat; k++) {
        // 法向 (−uz, ux)：沿中线两侧 ±width/2 均匀取点
        out.push({
          x: ax + ux * t - uz * k * LAT,
          z: az + uz * t + ux * k * LAT,
          end: false
        })
      }
    }
  }
  if (!w.closed) {
    const ends = [
      [pts[0], pts[1]],
      [pts[pts.length - 1], pts[pts.length - 2]]
    ]
    for (const [p, q] of ends) {
      const len = Math.hypot(p[0] - q[0], p[1] - q[1])
      if (len < 1e-6) continue
      out.push({
        x: p[0] + (p[0] - q[0]) / len,
        z: p[1] + (p[1] - q[1]) / len,
        end: true
      })
    }
  }
  return out
}

/** 全部景点三角形的世界坐标，平铺 [ax, ay, az, bx, …]，每 9 个数一个三角形 */
function worldTriangles(r) {
  const out = []
  const v = new Vector3()
  for (const m of meshesOf(r)) {
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld)
      out.push(v.x, v.y, v.z)
    }
  }
  return new Float64Array(out)
}

const cellKey = (i, k) => `${i},${k}`
const cellOf = (x) => Math.floor(x / CELL)

/**
 * 三角形空间索引，只建在样点所在的格子上：样点格集合 cells（Map 键 → []），
 * 每个三角形按 xz 包围盒（外扩 MAX_CLEAR）登记进相交的样点格。
 * 大三角形（草地、广场）包围盒格数多于样点格数时改为遍历样点格，避免逐格枚举上百万格
 */
function indexTriangles(T, cells) {
  const keys = [...cells.keys()].map((k) => k.split(",").map(Number))
  for (let t = 0; t * 9 < T.length; t++) {
    const o = t * 9
    const xs = [T[o], T[o + 3], T[o + 6]]
    const zs = [T[o + 2], T[o + 5], T[o + 8]]
    const i0 = cellOf(Math.min(...xs) - MAX_CLEAR)
    const i1 = cellOf(Math.max(...xs) + MAX_CLEAR)
    const k0 = cellOf(Math.min(...zs) - MAX_CLEAR)
    const k1 = cellOf(Math.max(...zs) + MAX_CLEAR)
    if ((i1 - i0 + 1) * (k1 - k0 + 1) <= keys.length) {
      for (let i = i0; i <= i1; i++) {
        for (let k = k0; k <= k1; k++) {
          const list = cells.get(cellKey(i, k))
          if (list) list.push(t)
        }
      }
    } else {
      for (const [i, k] of keys) {
        if (i >= i0 && i <= i1 && k >= k0 && k <= k1) {
          cells.get(cellKey(i, k)).push(t)
        }
      }
    }
  }
}

/** (x, z) 在三角形水平投影内时返回该处高度，否则 null；竖直三角形（墙面）返回 null */
function heightAt(T, o, x, z) {
  const ax = T[o]
  const az = T[o + 2]
  const bx = T[o + 3]
  const bz = T[o + 5]
  const cx = T[o + 6]
  const cz = T[o + 8]
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
  if (Math.abs(d) < 1e-9) return null
  const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d
  const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d
  const l3 = 1 - l1 - l2
  if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) return null
  return l1 * T[o + 1] + l2 * T[o + 4] + l3 * T[o + 7]
}

/** 三角形与水平板 y ∈ [y0, y1] 的交（3D 点数组）：依次用 y ≥ y0、y ≤ y1 两个半空间裁剪 */
function clipSlab(T, o, y0, y1) {
  let poly = [
    [T[o], T[o + 1], T[o + 2]],
    [T[o + 3], T[o + 4], T[o + 5]],
    [T[o + 6], T[o + 7], T[o + 8]]
  ]
  for (const [lim, above] of [
    [y0, true],
    [y1, false]
  ]) {
    const out = []
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]
      const q = poly[(i + 1) % poly.length]
      const pin = above ? p[1] >= lim : p[1] <= lim
      const qin = above ? q[1] >= lim : q[1] <= lim
      if (pin) out.push(p)
      if (pin !== qin) {
        const t = (lim - p[1]) / (q[1] - p[1])
        out.push([p[0] + (q[0] - p[0]) * t, lim, p[2] + (q[2] - p[2]) * t])
      }
    }
    poly = out
    if (!poly.length) break
  }
  return poly
}

/** 点到线段的水平距离 */
function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax
  const dz = bz - az
  const L = dx * dx + dz * dz
  const t = L
    ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L))
    : 0
  return Math.hypot(x - ax - t * dx, z - az - t * dz)
}

/** 点到凸多边形水平投影的距离：在内部为 0 */
function polyDist(poly, x, z) {
  if (poly.length >= 3) {
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, , zi] = poly[i]
      const [xj, , zj] = poly[j]
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
        inside = !inside
      }
    }
    if (inside) return 0
  }
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    best = Math.min(best, segDist(x, z, a[0], a[2], b[0], b[2]))
  }
  return best
}

function walk(name) {
  const r = build(name)
  const T = worldTriangles(r)
  let total = 0
  console.log(`${name}  步行路径 ${r.walkways.length} 条`)
  r.walkways.forEach((w, idx) => {
    const samples = samplesOf(w)
    const cells = new Map()
    for (const s of samples) {
      const k = cellKey(cellOf(s.x), cellOf(s.z))
      if (!cells.has(k)) cells.set(k, [])
    }
    indexTriangles(T, cells)
    const bad = { support: 0, head: 0 }
    const near = BANDS.map(() => Infinity)
    const bandBad = BANDS.map(() => 0)
    for (const s of samples) {
      const list = cells.get(cellKey(cellOf(s.x), cellOf(s.z)))
      if (!s.end) {
        let support = -Infinity
        let roof = false
        for (const t of list) {
          const y = heightAt(T, t * 9, s.x, s.z)
          if (y === null) continue
          if (y <= w.y + UNDERFOOT) support = Math.max(support, y)
          else if (y < w.y + HEAD) roof = true
        }
        if (Math.abs(support - w.y) > SUPPORT_TOL) bad.support++
        if (roof) bad.head++
      }
      BANDS.forEach((band, bi) => {
        let d = Infinity
        for (const t of list) {
          const poly = clipSlab(T, t * 9, w.y + band.y0, w.y + band.y1)
          if (poly.length) d = Math.min(d, polyDist(poly, s.x, s.z))
        }
        near[bi] = Math.min(near[bi], d)
        // 端点外探样点只查「碰到障碍」（落在高度带内三角形的水平投影内或边上），
        // 路径本体样点要满足该高度带的完整净距
        if (s.end ? d <= 0 : d < band.clear) bandBad[bi]++
      })
    }
    const n = bad.support + bad.head + bandBad.reduce((a, b) => a + b, 0)
    total += n
    const fmt = (d) => (Number.isFinite(d) ? d.toFixed(2) : "—")
    console.log(
      `  #${idx + 1}  样点 ${samples.length}  支撑 ${bad.support}  净空 ${bad.head}  ` +
        BANDS.map((b, i) => `${b.name} ${bandBad[i]}`).join("  ") +
        `  最近：` +
        BANDS.map((b, i) => `${b.name} ${fmt(near[i])}`).join(" / ") +
        " m"
    )
  })
  console.log(`坏点合计 ${total}`)
  if (total > 0) process.exitCode = 1
}

const [mode, ...names] = process.argv.slice(2)
if (mode === "stats" && names.length) names.forEach(stats)
else if (mode === "walk" && names.length) names.forEach(walk)
else {
  console.error(
    "用法：node scripts/city-landmark-check.mjs stats|walk <景点名> …"
  )
  process.exitCode = 2
}

#!/usr/bin/env node
/*
 * 景点模型校验（Node，只读仓库）
 * ----------------------------------------------------------
 * 用法（仓库根目录）：
 *   node scripts/city-landmark-check.mjs stats 熊猫基地 杜甫草堂 …
 *     每个景点一行：三角形（各 Mesh 分列）、Mesh 数、定位针底座高度、步行路径条数与总长、几何哈希、构建耗时。
 *     几何哈希对各 Mesh 的世界矩阵与 position / normal / color / index 字节做 FNV-1a，
 *     用来确认重构前后几何一字不差。
 *   node scripts/city-landmark-check.mjs walk 熊猫基地
 *     步行路径校验（方法同 docs/superpowers/specs/2026-09-29-city-crowd-design.md「校验方法」）。
 *     路径字段先按 crowd.js 的 preparePath 规整（丢弃非法点；有效点不足 2 个的路径判为坏；
 *     点数 ≥ 3 才算闭合；y、width 非法时取 0，width 为 0 时只取中线样点）。
 *     路径本体样点沿中线每 0.5 m 一组，横向从 −width/2 到 +width/2（含两条边缘）等距取点：
 *     1 支撑面：路径高度 y + 0.25 以下最高的景点表面须与 y 相差 ≤ 0.06 m；
 *     2 头顶净空：样点正上方 y + 0.25 ～ y + 4.35 之间不得有景点表面；
 *     3 分部件净距：腿 / 身体 / 头三个高度带内的景点三角形，离样点的水平距离分别 ≥ 0.63 / 0.86 / 0.52 m。
 *     开放路径两端再各取一条外探线（端点沿路径方向外延 1 m，每 0.05 m 一个点），
 *     只查是否碰到障碍、不查支撑与净空：任一高度带内有景点三角形落在外探线上或离它 ≤ 0.04 m
 *     即判坏（竖直墙面的水平投影是线段，所以用 0.04 m 容差，同 wuhou.js 的校验口径；
 *     不要求完整净距，同 dufu.js 设计注释「端点沿路径方向外探 1 m 仍不碰障碍」）。
 *     有坏点、无步行路径、无效路径时退出码为 1。
 *   局限：
 *     - 支撑面只认该景点自己的三角形（城市通用楼、通用树、地面、道路、水面都不在其中），
 *       所以走在城市地面 / 道路上的景点（如 IFS 的路边人行道）会报支撑失败，不适用本模式。
 *     - 三角形索引按 2 m 格登记并外扩 0.86 m，「最近」超过 0.86 m 的数值只是上界。
 * 退出码：0 通过；1 有坏点 / 无步行路径 / 景点没有注册模块；2 用法错误或未知景点名。
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
const { buildLandmark, LANDMARK_MODULES } = await imp(
  "src/views/city/scene/landmarks/index.js"
)

const geo = JSON.parse(
  readFileSync(resolve(ROOT, "public/city/chengdu.json"), "utf8")
)
const project = createProjection(geo.meta.origin)

/** 取较大的退出码（多个景点依次校验时，不让后面的 1 盖掉前面的 2） */
function fail(code) {
  process.exitCode = Math.max(process.exitCode || 0, code)
}

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

/**
 * 路径规整，规则同 crowd.js 的 preparePath：丢弃非有限点；有效点不足 2 个返回 null；
 * 点数 ≥ 3 才算闭合；y 非有限时取 0；width 非有限或 ≤ 0 时取 0（只取中线样点）。
 * 返回值里的 count 为有效点数，供报告「路径无效」时使用。
 */
function normalizeWalkway(w) {
  const raw = w && Array.isArray(w.points) ? w.points : []
  const points = raw.filter(
    (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
  )
  if (points.length < 2) return { valid: false, count: points.length }
  return {
    valid: true,
    count: points.length,
    points,
    closed: Boolean(w.closed) && points.length >= 3,
    y: Number.isFinite(w.y) ? w.y : 0,
    width: Number.isFinite(w.width) && w.width > 0 ? w.width : 0
  }
}

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
    for (const key of ["position", "normal", "color"]) {
      const a = g.attributes[key]
      if (!a) continue
      // 交错属性的数据在 data.array 里
      hash = fnv(
        hash,
        bytesOf(a.isInterleavedBufferAttribute ? a.data.array : a.array)
      )
    }
    if (g.index) hash = fnv(hash, bytesOf(g.index.array))
  }
  const walkLen = r.walkways.reduce((s, raw) => {
    const w = normalizeWalkway(raw)
    return w.valid ? s + pathLength(w.points, w.closed) : s
  }, 0)
  console.log(
    `${name}  三角形 ${tris}（${per.join(" + ")}）  Mesh ${per.length}  ` +
      `底座 ${r.markerHeight.toFixed(1)}  路径 ${r.walkways.length} 条 ` +
      `${Math.round(walkLen)} m  哈希 ${hash.toString(16).padStart(8, "0")}  ` +
      `构建 ${ms.toFixed(0)} ms`
  )
}

/* ---------------- 步行路径校验 ---------------- */

const HEAD = 4.35 // 最高个体头顶（4 m × 1.08）
const STEP = 0.5 // 沿中线取样间距
const LAT = 0.25 // 横向取样间距上限（实际间距 = 半宽 / ceil(半宽 / LAT)，样点恰好落在 ±width/2 边缘）
const SUPPORT_TOL = 0.06
const UNDERFOOT = 0.25 // 路面以上这个高度以内的表面算「脚下」，以上算「头顶」
const PROBE_LEN = 1 // 开放路径端点外探长度
const PROBE_STEP = 0.05 // 外探线上的取点间距
const TOUCH = 0.04 // 外探「碰到障碍」的水平距离容差（竖直面的水平投影是线段）
const CELL = 2 // 三角形索引格（米）
const BANDS = [
  { name: "腿", y0: 0.25, y1: 1.56, clear: 0.63 },
  { name: "身体", y0: 1.56, y1: 3.11, clear: 0.86 },
  { name: "头", y0: 3.11, y1: HEAD, clear: 0.52 }
]
const MAX_CLEAR = 0.86

/**
 * 一条（已规整）路径的样点，统一为 { end, pts }：pts 是 [x, z] 数组。
 *   - 路径本体样点：end = false，pts 只有一个点，要查支撑、头顶净空和完整分带净距；
 *   - 开放路径端点外探线：end = true，pts 是端点到外延 1 m 的一串点（每 0.05 m 一个），
 *     只查是否碰到障碍（任一点离某高度带内的三角形 ≤ TOUCH），不查支撑与净空。
 */
function samplesOf(w) {
  const pts = w.closed ? [...w.points, w.points[0]] : w.points
  const half = w.width / 2
  // 横向点数取整到刚好覆盖 ±half，间距 half / nLat ≤ LAT；width 为 0 时只取中线
  const nLat = half > 0 ? Math.ceil(half / LAT - 1e-9) : 0
  const latStep = nLat ? half / nLat : 0
  const out = []
  let started = false
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
        // 中间顶点处，上一段的末样点已取过中线点（k = 0），这里只跳过它；
        // 横向两侧的点必须按本段法向再取一遍，否则拐角外侧取不到
        if (started && s === 0 && k === 0) continue
        // 法向 (−uz, ux)：沿中线两侧 ±width/2 均匀取点
        const off = k * latStep
        out.push({
          end: false,
          pts: [[ax + ux * t - uz * off, az + uz * t + ux * off]]
        })
      }
    }
    started = true
  }
  if (!w.closed) {
    // 外探方向：从端点向内找到第一个不重合的点，方向取「内点 → 端点」
    const ends = [
      [0, 1, 1],
      [pts.length - 1, pts.length - 2, -1]
    ]
    for (const [pi, first, dir] of ends) {
      const p = pts[pi]
      let q = null
      for (let j = first; j >= 0 && j < pts.length; j += dir) {
        if (Math.hypot(p[0] - pts[j][0], p[1] - pts[j][1]) >= 1e-6) {
          q = pts[j]
          break
        }
      }
      if (!q) continue
      const len = Math.hypot(p[0] - q[0], p[1] - q[1])
      const dx = (p[0] - q[0]) / len
      const dz = (p[1] - q[1]) / len
      const probe = []
      const m = Math.round(PROBE_LEN / PROBE_STEP)
      for (let s = 0; s <= m; s++) {
        probe.push([p[0] + dx * s * PROBE_STEP, p[1] + dz * s * PROBE_STEP])
      }
      out.push({ end: true, pts: probe })
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
  if (!r.walkways.length) {
    console.log(`${name}  没有步行路径`)
    fail(1)
    return
  }
  const T = worldTriangles(r)
  let total = 0
  console.log(`${name}  步行路径 ${r.walkways.length} 条`)
  r.walkways.forEach((raw, idx) => {
    const w = normalizeWalkway(raw)
    if (!w.valid) {
      total++
      console.log(`  #${idx + 1}  无效路径（有效点 ${w.count} 个，不足 2 个）`)
      return
    }
    const samples = samplesOf(w)
    // 样点格集合：本体样点一个点，外探线上每个点都要登记
    const cells = new Map()
    for (const s of samples) {
      for (const [x, z] of s.pts) {
        const k = cellKey(cellOf(x), cellOf(z))
        if (!cells.has(k)) cells.set(k, [])
      }
    }
    indexTriangles(T, cells)
    const bad = { support: 0, head: 0 }
    const near = BANDS.map(() => Infinity) // 路径本体样点的最近距离
    let probeNear = Infinity // 外探线到任一高度带三角形的最近距离
    const bandBad = BANDS.map(() => 0)
    for (const s of samples) {
      if (!s.end) {
        const [x, z] = s.pts[0]
        const list = cells.get(cellKey(cellOf(x), cellOf(z)))
        let support = -Infinity
        let roof = false
        for (const t of list) {
          const y = heightAt(T, t * 9, x, z)
          if (y === null) continue
          if (y <= w.y + UNDERFOOT) support = Math.max(support, y)
          else if (y < w.y + HEAD) roof = true
        }
        if (Math.abs(support - w.y) > SUPPORT_TOL) bad.support++
        if (roof) bad.head++
      }
      BANDS.forEach((band, bi) => {
        // 外探线取其全部点中最近的一个
        let d = Infinity
        for (const [x, z] of s.pts) {
          const list = cells.get(cellKey(cellOf(x), cellOf(z)))
          for (const t of list) {
            const poly = clipSlab(T, t * 9, w.y + band.y0, w.y + band.y1)
            if (poly.length) d = Math.min(d, polyDist(poly, x, z))
          }
        }
        if (s.end) {
          // 外探线只查是否碰到障碍（含竖直墙面）
          probeNear = Math.min(probeNear, d)
          if (d <= TOUCH) bandBad[bi]++
        } else {
          // 路径本体样点要满足该高度带的完整净距
          near[bi] = Math.min(near[bi], d)
          if (d < band.clear) bandBad[bi]++
        }
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
        " m" +
        (w.closed ? "" : `  外探最近 ${fmt(probeNear)} m`)
    )
  })
  console.log(`坏点合计 ${total}`)
  if (total > 0) fail(1)
}

const [mode, ...names] = process.argv.slice(2)
const runner = mode === "stats" ? stats : mode === "walk" ? walk : null
if (!runner || !names.length) {
  console.error(
    "用法：node scripts/city-landmark-check.mjs stats|walk <景点名> …"
  )
  fail(2)
} else {
  for (const name of names) {
    if (!SPOTS.some((s) => s.name === name)) {
      console.error(
        `未知景点：${name}\n可用景点：${SPOTS.map((s) => s.name).join("、")}`
      )
      fail(2)
      continue
    }
    if (!LANDMARK_MODULES[name]) {
      console.warn(
        `警告：${name} 在 SPOTS 里有、但没有注册景点模块（landmarks/index.js 的 LANDMARK_MODULES），无法校验`
      )
      fail(1)
      continue
    }
    runner(name)
  }
}

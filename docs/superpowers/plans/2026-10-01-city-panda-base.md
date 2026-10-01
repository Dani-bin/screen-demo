# 熊猫基地（第 12 站）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `/city` 加第 12 站「熊猫基地」：飞地 OSM 数据、多区域相机范围与长距离飞行、主城区专用整城阴影，以及 ≤ 4 万三角形的核心区精细模型与步行路径。

**Architecture:** 拉数脚本支持 `--enclave` / `--keep-main`，熊猫基地周边数据追加进同一份 `chengdu.json`（`meta.enclaves`）。`CameraTour` 的注视点范围改为矩形数组、飞行途中不夹取，位移 > 5 km 的飞行加长并拉高；`computeCityShadow` 新增 `within` 过滤只算主城区。景点模型按分区拆成 `landmarks/pandaBase/` 下的若干文件，共用一个 `site` 场地对象。新增 Node 校验脚本统计三角形、几何哈希并校验步行路径。

**Tech Stack:** three.js 0.186、Vue 3 + Vite、Python 3（拉数）、Node（校验脚本）、Claude 内置浏览器（截图验收）。

**设计文档：** `docs/superpowers/specs/2026-10-01-city-panda-base-design.md`（坐标、尺寸、配色以它为准；文首决策表优先于文末调研报告）

---

## 通用约定

- 分支 `feature/city-3d`。提交信息末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`；**逐个 `git add` 路径，不用 `git add -A`**。工作区里 `.claude/launch.json` 的改动和 `scripts/dev-http.mjs` 不是本计划的，**永远不要提交它们**。
- 环境：Windows 11 + Git Bash。Python 用 `python`，输出中文时加 `PYTHONIOENCODING=utf-8`。Node 脚本在仓库根目录运行。
- 代码风格：无分号、双引号、2 空格、80 列；注释与界面文字用简体中文，生成的代码带清晰的中文注释；CSS 写 px。场景模块不依赖 Vue；相对导入带 `.js` 扩展名（Node 校验脚本要求）。
- Lint 门槛（每个改代码的任务都跑）：
  ```bash
  npx eslint --max-warnings 0 "src/views/city/**/*.{vue,js}"
  npx prettier --check "src/views/city/**/*.{vue,js}" scripts/city-landmark-check.mjs
  ```
  第一条除 `.eslintignore` 弃用提示外无输出；第二条通过（不通过就对相应文件跑 `npx prettier --write <文件>`）。不要运行 `yarn lint:eslint`（它带 `--fix` 会改写历史文件）。
- 预览与截图：用 Claude 内置浏览器（`mcp__Claude_Browser__preview_start` `{ name: "bi-demo" }`，端口自动分配，以返回值为准），**不要用 Bash 启动开发服务器**。子代理并行时不要同时操作浏览器；截图验收由主控在任务之间做。
  - 单景点预览：`http://localhost:<端口>/city-lab.html?landmark=pandaBase&yaw=125&pitch=30&dist=1000&tx=-160.6&tz=-291.6`（与站点机位同视野）。近看构件改 `dist`、`tx`、`tz`。
  - 城市页：`http://localhost:<端口>/#/city?spot=11`，视口设 1920×1080（`resize_window`）。
- 坐标约定：世界 X 东、Z 南、Y 上，单位米；局部坐标原点 104.0657, 30.6574。方位角 bearing 自北顺时针；kit 的 `frame(cx, y, cz, bearing)` 局部 −Z 指向 bearing、+Z 为正面。
- 熊猫基地全部常量按**坐标**取，不要按「熊猫」「熊猫塔」这类短名查楼（`findBuildings` 退回包含匹配，会误中「天府熊猫塔」）。

## 文件清单

| 文件 | 职责 |
|---|---|
| `scripts/city-landmark-check.mjs`（新） | Node 校验：三角形 / Mesh / 几何哈希统计；步行路径支撑面、头顶净空、分部件净距 |
| `scripts/fetch-osm-city.py` | `--enclave`、`--keep-main`，`meta.enclaves` |
| `public/city/chengdu.json` | 追加熊猫基地飞地数据 |
| `src/views/city/scene/landmarks/kit/grid.js`（新） | 占用栅格 `createGrid`（自 `dufu.js` 原样移出） |
| `src/views/city/scene/landmarks/kit/plants.js`（新） | 竹梢叶团 `SPINDLE` 与 `pushSpindle`（`dufu.js`、`wangjiang.js` 共用） |
| `src/views/city/scene/landmarks/kit/figures.js` | `addPanda` 新增 `pose: "sit"`、`flat`、`detail` |
| `src/views/city/scene/landmarks/{dufu,wangjiang,pandaTower}.js` | 改用上面三处 kit，几何不变 |
| `src/views/city/scene/cameraTour.js` | 注视点范围矩形数组、飞行中不夹取、长距离飞行 |
| `src/views/city/scene/shadow.js` | `computeCityShadow` 新增 `within` |
| `src/views/city/scene/CityScene.js` | 多区域范围、主城区整城阴影 |
| `src/views/city/scene/theme.js` | 注释同步 |
| `src/views/city/scene/landmarks/pandaBase/*.js`（新） | 熊猫基地模型：`index` 入口、`site` 场地、`ground` 地面、`gate` 南大门与铜像、`halls` 建筑、`lake` 天鹅湖、`enclosures` 别墅与产房、`walkways` 步行路径、`vegetation` 树竹 |
| `src/views/city/scene/landmarks/index.js` | 注册 `熊猫基地` |
| `src/views/city/data/cityData.js` | `SPOTS` 第 12 站、`FLOW` Top5 |
| `src/views/city/lab/lab.js` | 实验页键 `pandaBase` |
| `src/views/city/components/TourBar.vue` | 文件头尺寸说明 |
| `CLAUDE.md` | 实验页键列表、飞地说明 |

---

### Task 1: Node 校验脚本

**Files:**
- Create: `scripts/city-landmark-check.mjs`

- [ ] **Step 1: 写脚本**

```js
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
 *       开放路径端点再沿路径方向外探 1 m 取样，只查是否碰到障碍（不要求净距；同 dufu.js 设计注释的口径）。
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
  const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0
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
  console.error("用法：node scripts/city-landmark-check.mjs stats|walk <景点名> …")
  process.exitCode = 2
}
```

- [ ] **Step 2: 跑统计，记录基线**

```bash
node scripts/city-landmark-check.mjs stats 天府熊猫塔 "成都 IFS" 杜甫草堂 望江楼 "武侯祠·锦里" | tee /tmp/landmark-baseline.txt
```
Expected：5 行，各含「三角形 … 哈希 xxxxxxxx」。杜甫草堂约 39,193、武侯祠约 39,547、望江楼约 33,912、熊猫塔约 5,858、IFS 约 10,666。基线文件留到 Task 2 对比（临时文件，不提交）。

- [ ] **Step 3: 跑一次路径校验确认脚本可用**

```bash
node scripts/city-landmark-check.mjs walk 杜甫草堂
```
Expected：逐条打印样点与坏点数、末行「坏点合计 N」。杜甫草堂已按同一方法验收过，N 应为 0 或很小；若坏点集中在某一类，检查脚本实现（取样、单位）而不是改景点。在提交说明里记下这个数。

- [ ] **Step 4: Lint 与提交**

```bash
npx prettier --check scripts/city-landmark-check.mjs
git add scripts/city-landmark-check.mjs
git commit -m "chore(city): 景点模型校验脚本（三角形、几何哈希、步行路径）" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: kit 抽取（占用栅格、竹梢叶团、坐姿熊猫）

只移动与新增，已有景点几何必须一字不差（Task 1 的哈希）。

**Files:**
- Create: `src/views/city/scene/landmarks/kit/grid.js`、`src/views/city/scene/landmarks/kit/plants.js`
- Modify: `src/views/city/scene/landmarks/dufu.js`、`src/views/city/scene/landmarks/wangjiang.js`、`src/views/city/scene/landmarks/kit/figures.js`、`src/views/city/scene/landmarks/pandaTower.js`

- [ ] **Step 1: `kit/grid.js`**

新建文件，文件头注释如下，正文是 `dufu.js` 里 `function createGrid(x0, z0, x1, z1, cell = 0.5) { … }` 整个函数（约第 1032～1131 行）**原样剪切**过来并在前面加 `export`：

```js
/*
 * 占用栅格：布置树木、竹丛时判断空地
 * ----------------------------------------------------------
 * 按 cell 米划分的位标记栅格（Uint8，每格最多 8 种标记），世界坐标 [x, z]。
 * fillPoly 多边形打标记（可沿边外扩）、stamp / stampLine 线段盖印、disk 圆盘、
 * freeDisk 判断圆盘内是否不含某些标记。标记位由各景点自定义（如 F_SOLID、F_WATER）。
 * 由 dufu.js 移出共用；wuhou.js 的同名函数 stampLine / freeDisk 细节不同，保持原样不并入。
 */

export function createGrid(x0, z0, x1, z1, cell = 0.5) {
  // ……dufu.js 原函数体，一字不改……
}
```
`dufu.js` 删除该函数及其上方的分节注释 `/* ---------------- 占用栅格（布置树木、竹丛时判断空地；写法同 wuhou.js） ---------------- */`，在 import 区加 `import { createGrid } from "./kit/grid.js"`。

- [ ] **Step 2: `kit/plants.js`**

```js
/*
 * 植物小件的公共几何：竹梢叶团
 * ----------------------------------------------------------
 * 竹簇数量多（数百簇、上千束），逐束 ColorBuilder.add 太慢：各景点把变换后的三角形顶点
 * 按颜色直接写进数组，全部种完后每种颜色合成一个几何体（shapes.js 的 fromTriangles）再加进合批器。
 * 撒点、倾斜、尺寸的随机规则各景点不同（随机数取用顺序决定已有景点的画面），留在各自模块里，
 * 这里只放共用的叶团形状与写顶点的函数。
 */
import { Vector3 } from "three"

/**
 * 竹梢叶团的单位三角形（半径 1、高 1）四棱双锥：顶尖 (0, 1, 0)，最宽一圈在 62% 高，
 * 下尖细长（建模时抬到 0.3 m，像一束竹竿）。每项 [x, y, z, 是否在最宽一圈]
 */
export const SPINDLE = (() => {
  const n = 4
  const ring = Array.from({ length: n + 1 }, (_, k) => {
    const a = (k / n) * Math.PI * 2
    return [Math.sin(a), Math.cos(a)]
  })
  const tris = []
  for (let k = 0; k < n; k++) {
    const [s0, c0] = ring[k]
    const [s1, c1] = ring[k + 1]
    tris.push([0, 1, 0, 0], [s0, 0.62, c0, 1], [s1, 0.62, c1, 1])
    tris.push([0, 0, 0, 0], [s1, 0.62, c1, 1], [s0, 0.62, c0, 1])
  }
  return tris
})()

const _v = new Vector3()

/**
 * 按变换 m 写入一束竹梢叶团的 8 个三角形：高 h、最宽一圈半径 r，下尖在 0.3 m。
 * @param {number[]} out 顶点坐标数组（平铺 x, y, z），按颜色分组由调用方管理
 * @param {Matrix4} m 局部 → 世界变换（原点在束根，局部 +Y 为竹梢方向）
 * @param {number} h 叶团高（米）
 * @param {number} r 最宽一圈半径（米）
 */
export function pushSpindle(out, m, h, r) {
  for (const [ux, uy, uz, wide] of SPINDLE) {
    const yy = uy === 0 ? 0.3 : uy * h
    const k = wide ? r : 0
    _v.set(ux * k, yy, uz * k).applyMatrix4(m)
    out.push(_v.x, _v.y, _v.z)
  }
}
```

`dufu.js`：删除本地 `const SPINDLE = …` 及其注释；`addBamboo` 里把
```js
    for (const [ux, uy, uz, wide] of SPINDLE) {
      const yy = uy === 0 ? 0.3 : uy * hh
      const k = wide ? r : 0
      v.set(ux * k, yy, uz * k).applyMatrix4(m)
      out.push(v.x, v.y, v.z)
    }
```
换成 `pushSpindle(out, m, hh, r)`，删掉不再使用的 `const v = new Vector3()`；import 区加 `import { pushSpindle } from "./kit/plants.js"`。`wangjiang.js` 同样处理（它的 `SPINDLE` 在约第 1024 行、`addBamboo` 在约第 1046 行）。之后若 `Vector3` 等导入不再使用，按 ESLint 提示删除。

- [ ] **Step 3: `figures.js` 的 `addPanda` 扩展**

1. `pandaParts()` 里给尾巴、鼻头、两只耳朵、两个眼圈的部件对象加 `small: true`（其余不变）。
2. 在 `limb()` 之后新增坐姿部件表与手握竹子（数值自 `pandaTower.js` 的 `addSittingPanda` 原样搬来；`pandaTower.js` 的 `limbPart` 与 figures.js 的 `limb` 公式相同，直接用 `limb`）：

```js
/**
 * 坐姿熊猫部件（单位为总高）：身体略后仰的蛋形、黑色肩带与四肢、后腿前伸、双手抱在肚前。
 * 局部原点在臀下（y = 0 为坐面），+Z 为脸的朝向。数值由 pandaTower.js 的模块内实现原样移入
 */
function sittingParts() {
  const back = new Quaternion().setFromAxisAngle(v3(1, 0, 0), -8 * DEG)
  const none = new Quaternion()
  const parts = [
    { c: v3(0, 0.34, -0.02), r: [0.29, 0.34, 0.26], q: back, black: false },
    // 肩带：比身体略大一圈的扁椭球，只在肩背一段露出
    { c: v3(0, 0.55, -0.04), r: [0.305, 0.12, 0.275], q: back, black: true },
    { c: v3(0, 0.765, 0.02), r: [0.215, 0.185, 0.195], q: none, black: false },
    // 吻部（白）与鼻头（黑）
    { c: v3(0, 0.725, 0.175), r: [0.1, 0.07, 0.07], q: none, black: false },
    {
      c: v3(0, 0.745, 0.24),
      r: [0.04, 0.028, 0.025],
      q: none,
      black: true,
      small: true
    },
    // 尾巴
    {
      c: v3(0, 0.07, -0.26),
      r: [0.065, 0.055, 0.055],
      q: none,
      black: false,
      small: true
    }
  ]
  for (const sx of [-1, 1]) {
    // 耳朵
    parts.push({
      c: v3(sx * 0.15, 0.925, -0.01),
      r: [0.07, 0.07, 0.045],
      q: none,
      black: true,
      small: true
    })
    // 眼圈：外眼角下垂（绕脸轴转 ±25°）
    parts.push({
      c: v3(sx * 0.078, 0.79, 0.175),
      r: [0.05, 0.068, 0.04],
      q: new Quaternion().setFromAxisAngle(v3(0, 0, 1), sx * 25 * DEG),
      black: true,
      small: true
    })
    // 前肢：肩 → 肚前的爪（右爪偏外，握住竹子）
    const paw = sx > 0 ? v3(0.19, 0.36, 0.25) : v3(-0.1, 0.35, 0.23)
    parts.push(limb(v3(sx * 0.23, 0.56, 0.02), paw, 0.085))
    // 后腿：臀部 → 向前伸出的脚
    parts.push(limb(v3(sx * 0.16, 0.13, 0.06), v3(sx * 0.2, 0.08, 0.37), 0.1))
  }
  return parts
}

/** 坐姿熊猫右手握的竹子：竹竿自脚边斜向外上方，顶端三片竹叶（k 为总高） */
function addHeldBamboo(b, base, k, { bamboo, leaf, flat }) {
  const m = new Matrix4()
  const s = new Vector3()
  const bot = v3(0.14, 0.03, 0.3)
  const top = v3(0.32, 1.02, 0.2)
  const dir = top.clone().sub(bot)
  const q = new Quaternion().setFromUnitVectors(
    v3(0, 1, 0),
    dir.clone().normalize()
  )
  m.compose(bot.clone().multiplyScalar(k), q, s.set(1, 1, 1))
  b.add(
    cylinder(0.024 * k, 0.018 * k, dir.length() * k, { segments: 6 }),
    bamboo,
    base.clone().multiply(m)
  )
  const leaves = [
    [0.36, 1.0, 0.24, 30],
    [0.27, 1.0, 0.16, -40],
    [0.31, 0.95, 0.27, 75]
  ]
  for (const [x, y, z, yaw] of leaves) {
    m.compose(
      v3(x, y, z).multiplyScalar(k),
      new Quaternion().setFromAxisAngle(v3(0, 1, 0), yaw * DEG),
      s.set(0.11 * k, 0.018 * k, 0.035 * k)
    )
    const g = new IcosahedronGeometry(1, 0)
    if (flat) g.deleteAttribute("normal")
    b.add(g, leaf, base.clone().multiply(m))
  }
}
```

3. `addPanda` 换成下面的实现，并把它的 JSDoc 补上 `sit`、`flat`、`detail` 的说明（原 climb 说明保留）：

```js
/**
 * 低多边形熊猫：二十面体按三轴半径拉伸成头、身体、四肢、耳朵；
 * 耳朵、眼圈、鼻头、四肢、肩带黑色，其余白色。parent 可为 null（即世界坐标）。
 * pose "climb"（默认）：身体前倾约 35°，前爪搭在墙顶内侧，后腿悬在墙外。
 *   局部原点为女儿墙顶外沿中点（y = 0 墙顶、z = 0 外立面，墙在 z < 0 一侧）；
 *   +Z 为背部朝向（朝街），-Z 为头部朝向（朝屋顶花园）。
 *   竖向总高约 height：脚底约在 -0.56·height，耳尖约在 +0.44·height；
 *   前爪、鼻尖伸进墙内约 0.36·height，臀部离外立面约 0.47·height。
 * pose "sit"：坐姿抱竹。局部原点在臀下（y = 0 为坐面），+Z 为脸的朝向；
 *   总高（脚底到耳尖）= height；右手握一根斜出的竹子，顶端三片竹叶。
 * flat：false（默认）保留二十面体的平滑法线，须配 flatMaterial() 单独成批；
 *   true 时删掉法线，ColorBuilder 按面重算，配 landmarkMaterial 也是棱面分明的折纸感，可并入景点主体批。
 * detail：1（默认）全部部件细分 1 次；0 时耳朵、眼圈、鼻头、尾巴改用 20 面（远景看不出，省三角形）。
 * @param {object} [opts] { height = 15, pose = "climb", flat = false, detail = 1,
 *   bamboo = "#5DA83A", leaf = "#7CC24E" }（bamboo / leaf 只用于坐姿手里的竹子）
 */
export function addPanda(b, parent, opts = {}) {
  const {
    height = 15,
    pose = "climb",
    flat = false,
    detail = 1,
    bamboo = "#5DA83A",
    leaf = "#7CC24E"
  } = opts
  // parent 可传 null，表示直接用世界坐标
  const base = parent ?? new Matrix4()
  const sit = pose === "sit"
  // 坐姿部件以总高为单位；趴姿部件的竖向总跨度为 PANDA_SPAN
  const k = sit ? height : height / PANDA_SPAN
  const m = new Matrix4()
  const s = new Vector3()
  for (const p of sit ? sittingParts() : pandaParts()) {
    const g = new IcosahedronGeometry(1, p.small && detail === 0 ? 0 : 1)
    if (flat) g.deleteAttribute("normal")
    m.compose(
      p.c.clone().multiplyScalar(k),
      p.q,
      s.set(...p.r).multiplyScalar(k)
    )
    b.add(g, p.black ? L.pandaBlack : L.pandaWhite, base.clone().multiply(m))
  }
  if (sit) addHeldBamboo(b, base, k, { bamboo, leaf, flat })
}
```
`cylinder` 已从 `./shapes.js` 导入（figures.js 第 10 行），无需新增导入。

4. `pandaTower.js`：删除 `limbPart`、`addSittingPanda` 及其上方的分节注释与 `const v3 = …`（若别处不再用）；调用处改为
```js
  addPanda(pb, frame(px, plinthTop, pz, PANDA.facing + 180), {
    height: PANDA.height,
    pose: "sit"
  })
```
import 区从 `./kit/figures.js` 加 `addPanda`；调色板 `C` 里的 `bamboo`、`leaf` 两项删除（默认值与之相同）。按 ESLint 提示删掉不再使用的导入（`IcosahedronGeometry`、`Quaternion` 等，若确实不用）。

- [ ] **Step 4: 几何回归**

```bash
node scripts/city-landmark-check.mjs stats 天府熊猫塔 "成都 IFS" 杜甫草堂 望江楼 "武侯祠·锦里" > /tmp/landmark-after.txt
diff <(sed 's/构建 .*//' /tmp/landmark-baseline.txt) <(sed 's/构建 .*//' /tmp/landmark-after.txt) && echo 几何一致
```
Expected：打印「几何一致」。若某站哈希变了：熊猫塔查坐姿部件顺序、颜色、竹子；杜甫草堂 / 望江楼查 `pushSpindle` 替换是否改了随机数取用顺序。

- [ ] **Step 5: 新选项冒烟**

```bash
node --input-type=module -e "
import { addPanda } from './src/views/city/scene/landmarks/kit/figures.js'
import { ColorBuilder } from './src/views/city/scene/landmarks/kit/builder.js'
for (const o of [{ pose: 'sit' }, { pose: 'sit', flat: true, detail: 0 }, { pose: 'climb', flat: true, detail: 0 }]) {
  const b = new ColorBuilder(); addPanda(b, null, { height: 6, ...o }); console.log(JSON.stringify(o), b.triangles)
}"
```
Expected：三行三角形数，第 2、3 行明显少于第 1 行（坐姿约 830、趴姿约 680 量级），不报错。

- [ ] **Step 6: Lint 与提交**

```bash
npx eslint --max-warnings 0 "src/views/city/**/*.{vue,js}"
npx prettier --check "src/views/city/**/*.{vue,js}"
git add src/views/city/scene/landmarks/kit/grid.js src/views/city/scene/landmarks/kit/plants.js src/views/city/scene/landmarks/kit/figures.js src/views/city/scene/landmarks/dufu.js src/views/city/scene/landmarks/wangjiang.js src/views/city/scene/landmarks/pandaTower.js
git commit -m "refactor(city): 占用栅格、竹梢叶团、坐姿熊猫移入 kit" -m "addPanda 新增 pose: sit、flat、detail 选项；熊猫塔、IFS、杜甫草堂、望江楼几何哈希不变。" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 拉数脚本支持飞地，追加熊猫基地数据

**Files:**
- Modify: `scripts/fetch-osm-city.py`
- Modify: `public/city/chengdu.json`（重新生成）

- [ ] **Step 1: 文件头文档**

模块 docstring 的「用法」后追加：

```
飞地（主城区以外单独拉数的小块区域，元素追加在主城区之后，见 meta.enclaves）：
    python3 scripts/fetch-osm-city.py --enclave 熊猫基地:30.727,104.115,30.760,104.157
    不给 --enclave 时用 DEFAULT_ENCLAVES；可重复给出多块。

只拉飞地、主城区沿用已有文件（本地没有 Overpass 缓存时，避免主城区随 OSM 更新而变化）：
    python3 scripts/fetch-osm-city.py --keep-main public/city/chengdu.json
```
「输出结构」里 `meta` 一行改为：
```
    meta      城市名、原点经纬度、主城区范围 bbox 与 clip 裁剪矩形 [xmin, zmin, xmax, zmax]、
              飞地列表 enclaves [{ name, bbox, clip }]
```

- [ ] **Step 2: 默认飞地常量**

`TYPE_HEIGHT` 之后加：

```python
# 默认飞地：成都大熊猫繁育研究基地（OSM way 941885688）在主城区数据东北角外约东 2.3 km、北 5.1 km，
# 整体扩图楼栋会从约 1.9 万翻到 3.8 万，所以只把基地周边单独拉一块（约 333 栋楼），
# 见 docs/superpowers/specs/2026-10-01-city-panda-base-design.md
DEFAULT_ENCLAVES = ["熊猫基地:30.727,104.115,30.760,104.157"]

# 输出的五类要素，主城区与飞地按这个顺序合并
LAYERS = ("buildings", "roads", "water", "parks", "rivers")
```

- [ ] **Step 3: 重写 `main()`**

整个 `main()` 替换为：

```python
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--city", default="成都")
    # 默认范围：南界原为 30.636，望江楼公园·崇丽阁（九眼桥以南）在其外约 350 m，
    # 为收录该景点南扩到 30.624（约 1.3 km）；西界原为 104.040，杜甫草堂在其外约 1.3 km，
    # 为收录该景点并给镜头留约 1.2 km 余量西扩到 104.012；北、东两边不变
    ap.add_argument("--bbox", default="30.624,104.012,30.686,104.098", help="south,west,north,east")
    ap.add_argument(
        "--enclave", action="append", metavar="名称:南,西,北,东",
        help="飞地（主城区以外单独拉数的小块区域），可重复；不给时用 DEFAULT_ENCLAVES",
    )
    ap.add_argument("--keep-main", metavar="旧JSON", help="主城区沿用该文件的数据（不重拉），只拉飞地并追加")
    ap.add_argument("--origin", default="104.0657,30.6574", help="lon,lat，作为局部坐标原点")
    ap.add_argument("--out", default="public/city/chengdu.json")
    ap.add_argument("--cache-dir", default="scripts/osm-cache")
    ap.add_argument("--clip-margin", type=float, default=300, help="道路 / 河流裁剪矩形在范围外扩的米数")
    args = ap.parse_args()

    lon0, lat0 = [float(v) for v in args.origin.split(",")]

    # 等距圆柱投影：1 度经度 ≈ 111320·cos(lat) 米，1 度纬度 ≈ 110540 米
    kx = 111320 * math.cos(math.radians(lat0))
    kz = 110540

    def to_local(node):
        return [round((node["lon"] - lon0) * kx, 1), round(-(node["lat"] - lat0) * kz, 1)]

    def ring(nodes):
        """节点列表 → 局部坐标多边形：去掉四舍五入后产生的连续重复点，以及闭合重复点。"""
        pts = []
        for n in nodes:
            q = to_local(n)
            if not pts or q != pts[-1]:
                pts.append(q)
        if len(pts) > 1 and pts[0] == pts[-1]:
            pts = pts[:-1]  # 去掉闭合重复点
        return pts

    def fetch_region(south, west, north, east):
        """拉取一块矩形范围的五类要素；道路与河流中心线裁剪到「范围 + clip_margin」的矩形。"""
        bbox = f"({south},{west},{north},{east})"
        # 裁剪矩形：范围四角投影到局部坐标，再向外扩 clip_margin 米（北在 -Z，所以取 min / max）
        corners = [to_local({"lon": lon, "lat": lat}) for lon in (west, east) for lat in (south, north)]
        clip = [
            round(min(c[0] for c in corners) - args.clip_margin, 1),
            round(min(c[1] for c in corners) - args.clip_margin, 1),
            round(max(c[0] for c in corners) + args.clip_margin, 1),
            round(max(c[1] for c in corners) + args.clip_margin, 1),
        ]

        print("  拉取建筑…")
        raw_b = overpass(f'[out:json][timeout:120];(way["building"]{bbox};);out geom;', args.cache_dir)
        buildings = []
        for w in raw_b["elements"]:
            if w["type"] != "way":
                continue
            p = ring(w.get("geometry", []))
            if len(p) < 3:
                continue
            tags = w.get("tags", {})
            buildings.append({"p": p, "h": estimate_height(tags, w["id"]), "n": tags.get("name")})

        print("  拉取道路…")
        kinds = "|".join(ROAD_CLASS.keys())
        raw_r = overpass(f'[out:json][timeout:120];(way["highway"~"^({kinds})$"]{bbox};);out geom;', args.cache_dir)
        roads = []
        for w in raw_r["elements"]:
            if w["type"] != "way" or len(w.get("geometry", [])) < 2:
                continue
            c = ROAD_CLASS[w["tags"]["highway"]]
            # 裁剪到本区域矩形，一条 way 可能被切成多段，每段保留原道路等级
            for piece in clip_polyline([to_local(n) for n in w["geometry"]], *clip):
                roads.append({"p": piece, "c": c})

        print("  拉取水系与绿地…")
        raw_l = overpass(
            f'[out:json][timeout:120];('
            f'way["natural"="water"]{bbox};way["waterway"~"^(river|canal|stream)$"]{bbox};'
            f'way["leisure"~"^(park|garden)$"]{bbox};way["landuse"~"^(grass|forest)$"]{bbox};'
            f'relation["natural"="water"]{bbox};relation["leisure"="park"]{bbox};'
            f');out geom;',
            args.cache_dir,
        )
        water, parks, rivers = [], [], []
        for e in raw_l["elements"]:
            tags = e.get("tags", {})
            is_water = tags.get("natural") == "water" or "waterway" in tags
            if e["type"] == "way":
                if "waterway" in tags:
                    # 河流中心线同样裁剪到本区域矩形，可能切成多段
                    rivers.extend(clip_polyline([to_local(n) for n in e.get("geometry", [])], *clip))
                    continue
                p = ring(e.get("geometry", []))
                if len(p) >= 3:
                    (water if is_water else parks).append(p)
            elif e["type"] == "relation":
                # 多面关系只取 outer 成员并拼接成闭合环；inner（岛 / 洞）成员忽略，场景里不做挖洞
                outers = [m for m in e.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
                for nodes in stitch_rings(outers):
                    p = ring(nodes)
                    if len(p) >= 3:
                        (water if is_water else parks).append(p)
        return {"clip": clip, "buildings": buildings, "roads": roads, "water": water, "parks": parks, "rivers": rivers}

    # ---- 主城区：重新拉取，或沿用旧文件 ----
    if args.keep_main:
        with open(args.keep_main, encoding="utf-8") as f:
            old = json.load(f)
        if old["meta"]["origin"] != [lon0, lat0]:
            raise SystemExit(f"--keep-main 文件原点 {old['meta']['origin']} 与 --origin 不一致")
        main_part = {k: old[k] for k in LAYERS}
        main_bbox, main_clip = old["meta"]["bbox"], old["meta"]["clip"]
        print(f"主城区沿用 {args.keep_main}：建筑 {len(old['buildings'])}，道路 {len(old['roads'])}")
    else:
        south, west, north, east = [float(v) for v in args.bbox.split(",")]
        print("拉取主城区…")
        main_part = fetch_region(south, west, north, east)
        main_bbox, main_clip = [south, west, north, east], main_part["clip"]

    layers = {k: list(main_part[k]) for k in LAYERS}
    # 水面 / 绿地多边形不裁剪：大面（如河流关系）可能被主城区与飞地的查询都返回，按几何去重
    # （同一 OSM 面两次投影、取整的结果逐点相同）
    seen = {k: {json.dumps(p) for p in layers[k]} for k in ("water", "parks")}

    # ---- 飞地：逐块拉取并追加在主城区之后（主城区数组下标不变） ----
    enclaves = []
    for spec in args.enclave if args.enclave is not None else DEFAULT_ENCLAVES:
        name, _, box = spec.partition(":")
        es, ew, en, ee = [float(v) for v in box.split(",")]
        print(f"拉取飞地「{name}」…")
        part = fetch_region(es, ew, en, ee)
        added = {}
        for k in LAYERS:
            items = part[k]
            if k in seen:
                items = [p for p in items if json.dumps(p) not in seen[k]]
                seen[k].update(json.dumps(p) for p in items)
            layers[k].extend(items)
            added[k] = len(items)
        # 自检：飞地楼栋应落在飞地裁剪框内（楼不裁剪；Overpass 只返回与范围相交的楼，跨框的个别楼会计入「超出」）
        x0, z0, x1, z1 = part["clip"]
        outside = sum(
            1 for b in part["buildings"] if not all(x0 <= x <= x1 and z0 <= z <= z1 for x, z in b["p"])
        )
        print(f"  新增：" + "，".join(f"{k} {v}" for k, v in added.items()) + f"；楼栋超出裁剪框 {outside}")
        enclaves.append({"name": name, "bbox": [es, ew, en, ee], "clip": part["clip"]})

    if args.keep_main:
        # 自检：主城区部分与旧文件逐项一致（飞地只追加在后面）
        if not all(layers[k][: len(old[k])] == old[k] for k in LAYERS):
            raise SystemExit("自检失败：主城区数据与旧文件不一致")
        print("自检：主城区数据与旧文件逐项一致")

    out = {
        "meta": {
            "city": args.city, "origin": [lon0, lat0],
            "bbox": main_bbox, "clip": main_clip, "enclaves": enclaves,
        },
        **layers,
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(args.out) // 1024
    print(
        f"完成：建筑 {len(layers['buildings'])}，道路 {len(layers['roads'])}，水面 {len(layers['water'])}，"
        f"绿地 {len(layers['parks'])}，河流 {len(layers['rivers'])}，文件 {size_kb} KB → {args.out}"
    )
```

- [ ] **Step 4: 生成数据**

```bash
PYTHONIOENCODING=utf-8 python scripts/fetch-osm-city.py --keep-main public/city/chengdu.json
```
公共 Overpass 常 504，脚本会自动换镜像重试（最多 6 次）；整次失败就隔几分钟重跑。
Expected：「主城区沿用 …：建筑 18750」→「拉取飞地「熊猫基地」…」→「新增：buildings 约 333，…」→「自检：主城区数据与旧文件逐项一致」→「完成：建筑约 19083 … 文件约 2,700 KB」。

- [ ] **Step 5: 校验数据**

```bash
node -e "
const d=require('./public/city/chengdu.json');const m=d.meta
console.log('bbox',m.bbox,'clip',m.clip,'enclaves',JSON.stringify(m.enclaves))
const e=m.enclaves[0].clip
const inE=d.buildings.slice(18750).filter(b=>b.p.every(([x,z])=>x>=e[0]&&x<=e[2]&&z>=e[1]&&z<=e[3])).length
console.log('飞地楼',d.buildings.length-18750,'在裁剪框内',inE)
const gate=d.buildings.find(b=>b.p.some(([x,z])=>Math.hypot(x-7464,z+8588)<25))
console.log('南大门附近有楼',!!gate)"
```
Expected：`enclaves` 一项，name「熊猫基地」，clip 约 `[4421, -11641, 9043, -7394]`；飞地楼约 333、绝大多数在裁剪框内；「南大门附近有楼 true」。

- [ ] **Step 6: 主城区景点不受影响**

```bash
node scripts/city-landmark-check.mjs stats 天府熊猫塔 "成都 IFS" 杜甫草堂 望江楼 "武侯祠·锦里" > /tmp/landmark-after3.txt
diff <(sed 's/构建 .*//' /tmp/landmark-baseline.txt) <(sed 's/构建 .*//' /tmp/landmark-after3.txt) && echo 几何一致
```
Expected：「几何一致」（只追加了飞地楼，主城区景点的替换区与几何不变）。

- [ ] **Step 7: 提交**

```bash
git add scripts/fetch-osm-city.py public/city/chengdu.json
git commit -m "feat(city): 拉数脚本支持飞地，追加熊猫基地周边数据" -m "--enclave 名称:南,西,北,东 可重复，默认熊猫基地；--keep-main 沿用已有主城区数据只追加飞地；meta 新增 enclaves。" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 多区域注视点范围与长距离飞行

**Files:**
- Modify: `src/views/city/scene/cameraTour.js`
- Modify: `src/views/city/scene/CityScene.js`（`_initTour` 的范围计算）
- Modify: `src/views/city/scene/theme.js`（`camera` 段末尾注释）

- [ ] **Step 1: 常量与工具函数**

`cameraTour.js` 在 `SLOW_TURN_MAX` 之后加：

```js
// 长距离飞行（主城区 ↔ 飞地）：注视点水平位移超过 LONG_FLY_FROM（米）时，
// 时长按 √(位移 / LONG_FLY_FROM) 放大，与大角度转向系数取较大者，最多 × LONG_FLY_MAX；
// 并在半程把相机拉高（见 _flyTo 的 flyHop）。主城区内各站相距 ≤ 约 4.7 km，不受影响。
// 例：杜甫草堂 → 熊猫基地约 13.9 km，× 1.67 约 3.3 s；熊猫基地 → 天府广场约 11.4 km，约 3.0 s
const LONG_FLY_FROM = 5000
const LONG_FLY_MAX = 2.5
```

在 `lerp` 之后加：

```js
/**
 * 把 (x, z) 夹到矩形数组里离它最近的一块（已在某块内时原样返回），结果写回 out。
 * @param {Array<{x: number[], z: number[]}>} rects
 */
function clampToRects(x, z, rects, out) {
  let best = Infinity
  for (const r of rects) {
    const cx = Math.max(r.x[0], Math.min(r.x[1], x))
    const cz = Math.max(r.z[0], Math.min(r.z[1], z))
    const d = (cx - x) ** 2 + (cz - z) ** 2
    if (d < best) {
      best = d
      out.x = cx
      out.z = cz
    }
  }
}
```

- [ ] **Step 2: 构造参数文档与状态**

构造函数 JSDoc 的 `options.limits` 一行改为：
```js
   * @param {object} options.limits theme.camera（pitchMin/Max、radiusMin/Max）加 bounds：
   *   注视点可移动的矩形数组 [{ x: [min, max], z: [min, max] }, …]（主城区 + 各飞地），由 CityScene 按数据范围算出
```
`this.flyDuration = …` 一行之后加：
```js
    this.flyHop = 0 // 本次飞行半程的相机距离抬升量（米），只有长距离飞行非 0（见 _flyTo）
```

- [ ] **Step 3: `apply()` 只在非飞行时夹取注视点**

`apply()` 的 JSDoc 与注视点夹取部分改为：

```js
  /**
   * 把球坐标写回相机，并做俯仰、距离、注视点范围的夹取。
   * 注视点只在非飞行时夹取（夹到离它最近的那块范围矩形）：飞行（巡览、复位、点导航）的
   * 起止点都在数据范围内，途中跨越主城区与飞地之间的空白地面时不能被拽回最近的区域
   */
  apply() {
    const s = this.spherical
    const L = this.limits
    // phi 是与 +Y 的夹角：俯仰 pitch = 90° - phi
    s.phi = Math.max(
      (90 - L.pitchMax) * DEG,
      Math.min((90 - L.pitchMin) * DEG, s.phi)
    )
    s.radius = Math.max(L.radiusMin, Math.min(L.radiusMax, s.radius))
    if (!this.flying) {
      clampToRects(this.target.x, this.target.z, L.bounds, this.target)
    }
    this.camera.position
      .copy(this.target)
      .add(new Vector3().setFromSpherical(s))
    this.camera.lookAt(this.target)
  }
```
（`update()` 飞行分支最后一帧调用 `apply()` 时 `flying` 仍为 true，终点本就在范围内，无需夹取；人工拖拽 / 缩放会先置 `flying = false` 再 `apply()`。）

- [ ] **Step 4: `_flyTo` 计算时长与拉高量**

`_flyTo` 里从 `// 大角度转向按方位差拉长飞行时间` 到 `this.flyProgress = 0` 之前的部分替换为：

```js
    // 大角度转向按方位差拉长飞行时间（见 SLOW_TURN_FROM）
    const turn = Math.abs(this.flyDTheta)
    const turnK =
      turn > SLOW_TURN_FROM ? Math.min(SLOW_TURN_MAX, turn / SLOW_TURN_FROM) : 1
    // 长距离飞行按注视点水平位移拉长时间，并在半程拉高（见 LONG_FLY_FROM）：
    // 相机距离在线性插值之外叠加 flyHop · sin(π · 缓动进度)，半程距离至少为位移的一半，
    // 既看得到飞越的过程，又不会贴地掠过空白地面
    const travel = Math.hypot(
      this.flyTo.target.x - this.flyFrom.target.x,
      this.flyTo.target.z - this.flyFrom.target.z
    )
    const long = travel > LONG_FLY_FROM
    const farK = long ? Math.sqrt(travel / LONG_FLY_FROM) : 1
    this.flyDuration =
      this.timing.fly * Math.min(LONG_FLY_MAX, Math.max(turnK, farK))
    this.flyHop = long
      ? Math.max(
          0,
          travel / 2 - (this.flyFrom.s.radius + this.flyTo.s.radius) / 2
        )
      : 0
```
（位移 ≤ 5 km 时 `farK = 1`，时长 = `fly × min(2.5, turnK)` = 原来的 `fly × turnK`，现有飞行不变。）

- [ ] **Step 5: `update()` 叠加拉高**

飞行分支里
```js
      this.spherical.radius = lerp(from.s.radius, to.s.radius, e)
```
改为
```js
      this.spherical.radius =
        lerp(from.s.radius, to.s.radius, e) + this.flyHop * Math.sin(Math.PI * e)
```

- [ ] **Step 6: `CityScene._initTour` 传入矩形数组**

把「注视点可移动范围 = 拉数范围 meta.bbox …」那段注释与 `const [south, west, north, east] = …`、`const [x0, z1] = …`、`const [x1, z0] = …` 三行替换为：

```js
    // 注视点可移动范围 = 各块拉数范围换成局部坐标的矩形：主城区 meta.bbox 与各飞地 meta.enclaves[].bbox
    // （[南, 西, 北, 东] 纬经度）。道路 / 河流按 bbox 外扩 300 m 裁剪（clip），楼栋落在 bbox 附近，
    // 注视点不出这些矩形，镜头就不会停在数据边缘外的空地上；
    // 人工操作时夹到离注视点最近的一块，飞行途中不夹取（见 CameraTour.apply）
    const meta = this.geometry.meta
    const bounds = [meta, ...(meta.enclaves || [])].map(({ bbox }) => {
      const [south, west, north, east] = bbox
      const [x0, z1] = this.project.toLocal(west, south)
      const [x1, z0] = this.project.toLocal(east, north)
      return { x: [x0, x1], z: [z0, z1] }
    })
```
并把 `new CameraTour({ … })` 里的
```js
      limits: { ...this.theme.camera, bounds: { x: [x0, x1], z: [z0, z1] } },
```
改为
```js
      limits: { ...this.theme.camera, bounds },
```

- [ ] **Step 7: theme.js 注释**

`camera` 段末尾两行注释改为：
```js
    // 注视点可移动范围不在这里配置：CityScene 按 chengdu.json 的 meta.bbox 与 meta.enclaves
    // （拉数范围，比各自的 clip 四周各内缩 300 m）换算成局部坐标矩形，数据范围变了自动跟随
```

- [ ] **Step 8: Lint**

```bash
npx eslint --max-warnings 0 "src/views/city/**/*.{vue,js}"
npx prettier --check "src/views/city/**/*.{vue,js}"
```

- [ ] **Step 9: 预览验收（主控）**

此时还没有第 12 站，只验证回归：打开 `#/city`（1920×1080），等巡览飞完 2～3 站，确认飞行与原来一样（时长、路线）；在画面边缘外拖拽、缩放，注视点仍停在主城区范围内；`read_console_messages` 无报错。

- [ ] **Step 10: 提交**

```bash
git add src/views/city/scene/cameraTour.js src/views/city/scene/CityScene.js src/views/city/scene/theme.js
git commit -m "feat(city): 注视点范围支持多区域，长距离飞行加长并拉高" -m "bounds 改为矩形数组（主城区 + 飞地），人工操作夹到最近一块、飞行途中不夹取；注视点位移超过 5 km 的飞行时长 × √(d/5km)（≤ × 2.5），半程相机距离至少为位移的一半。" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 整城阴影只算主城区

**Files:**
- Modify: `src/views/city/scene/shadow.js`（`computeCityShadow`）
- Modify: `src/views/city/scene/CityScene.js`（`_buildCity`）

- [ ] **Step 1: `computeCityShadow` 加 `within`**

函数签名与 JSDoc 加参数（找到 `export function computeCityShadow(` 上方的 JSDoc，在 objects 的说明后补一行）：
```js
 * @param {(x: number, z: number) => boolean} [input.within] 只计入落在该区域内的投影物
 *   （楼按首个轮廓点、树按树根、Mesh 按包围盒中心判断）；缺省全部计入
```
签名改为：
```js
export function computeCityShadow(
  { buildings = [], trees = [], objects = [], within = null },
  light
) {
```
三处登记循环各加一行过滤：
```js
  for (const b of buildings) {
    if (!b.p) continue
    if (within && !within(b.p[0][0], b.p[0][1])) continue
```
```js
  for (const { x, z, size, height } of trees) {
    if (within && !within(x, z)) continue
```
`objects` 的 traverse 里，在 `if (box.isEmpty()) return` 之后加：
```js
      // 区域过滤按包围盒中心的世界坐标判断（景点模型、定位针各自整块进出）
      if (within) {
        box.getCenter(p).applyMatrix4(obj.matrixWorld)
        if (!within(p.x, p.z)) return
      }
```

- [ ] **Step 2: CityScene 只按主城区算整城阴影**

`_buildCity` 里 `this.cityShadow = computeCityShadow(` 上方的注释末尾补两行，调用改为：

```js
    // 初始为整城阴影：全部投影物建完后实算一次正交范围、朝向与偏移（shadow.js 的 computeCityShadow）——
    // 楼栋轮廓、通用树的真实树冠、景点模型与落点球的 Mesh，含影子落到地面的深度；
    // 停靠站点时由 _fitShadow 收紧，回总览 / 离站时 _resetShadow 恢复。
    // 只计入主城区（meta.clip）：飞地离主城区约 5 km，并进来会把阴影框撑大约一倍、主城区阴影糊一倍；
    // 飞地只在停靠该站时由 _fitShadow 收紧出阴影，人工拉远去看飞地时没有阴影（已知限制）
    const [cx0, cz0, cx1, cz1] = d.meta.clip
    this.cityShadow = computeCityShadow(
      {
        buildings: d.buildings,
        trees: this.trees.layout,
        objects: [this.landmarks.group, this.markers.group],
        within: (x, z) => x >= cx0 && x <= cx1 && z >= cz0 && z <= cz1
      },
      this.theme.light
    )
```

- [ ] **Step 2b: 飞地内不退回整城阴影**

> **执行时已改为「每个区域一张静态阴影」**（质量审查建议，提交 Task 5 的修复提交）：投影物按离哪块区域最近归类（`utils.js` 的 `nearestRegion`），主城区与各飞地各算一张静态阴影；离站或拉远时恢复注视点所在区域的那张，注视点换区域时切换一次。下面的「收紧范围跟着注视点走」写法已被取代，以代码为准。

整城阴影只覆盖主城区；停靠熊猫基地站时若照旧「视野超出收紧范围就恢复整城阴影」，飞地会整片失去阴影（站点机位平移 333 m + 距离 1000 m，只余 167 m，滚轮拉远两格就会触发）。`_buildCity` 里在算整城阴影前把主城区判定存成方法（与 Step 2 的 within 共用）：

```js
    const [cx0, cz0, cx1, cz1] = d.meta.clip
    // 主城区判定（meta.clip）：整城阴影只计入主城区，_loop 也按它决定停站阴影如何退出
    this._inMain = (x, z) => x >= cx0 && x <= cx1 && z >= cz0 && z <= cz1
```
（Step 2 的 `within` 改为直接传 `this._inMain`。）`_loop` 里停站阴影的判断改为：

```js
    // 停靠时人工拉远、或滚轮缩放把注视点带离站点，视野超出收紧范围：
    // 主城区——恢复整城阴影（整城阴影覆盖整个主城区）；
    // 飞地——整城阴影不含飞地，恢复它飞地就没有影子了，改为把收紧范围移到当前注视点（重绘一次），
    //   注视点离收紧中心超过半径一半才移，避免逐帧重绘。
    // 视野粗估为「注视点离收紧中心的水平距离 + 相机距离」；恢复后不会因拉近而重新收紧，只在下一次飞抵站点时收紧；
    // 因此各站机位距离加注视点平移（cam.look）必须小于 1.5 倍半径，否则一飞抵就会被这里立即恢复
    if (this.shadowFitted) {
      const t = this.tour.target
      const [cx, , cz] = this.shadowCenter
      const off = Math.hypot(t.x - cx, t.z - cz)
      if (this._inMain(t.x, t.z)) {
        if (off + this.tour.getDistance() > STOP_SHADOW_RADIUS * 1.5) {
          this._resetShadow()
        }
      } else if (off > STOP_SHADOW_RADIUS * 0.5) {
        this._fitShadow([t.x, 0, t.z], STOP_SHADOW_RADIUS)
      }
    }
```
设计文档 §2.3 补一句：停靠飞地站时拉远或移动视角不恢复整城阴影，收紧范围随注视点移动（离中心超过 500 m 时重绘）。

- [ ] **Step 3: 数值核对**

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs'
import { computeCityShadow } from './src/views/city/scene/shadow.js'
import { THEME } from './src/views/city/scene/theme.js'
const d = JSON.parse(readFileSync('public/city/chengdu.json', 'utf8'))
const [a, b, c, e] = d.meta.clip
const all = computeCityShadow({ buildings: d.buildings }, THEME.light)
const main = computeCityShadow({ buildings: d.buildings, within: (x, z) => x >= a && x <= c && z >= b && z <= e }, THEME.light)
const size = (s) => Math.round(Math.max(s.right - s.left, s.top - s.bottom))
console.log('全部', size(all), '主城区', size(main))"
```
Expected：「全部」约为「主城区」的 1.8～2 倍；「主城区」与飞地加入前的整城阴影边长相当（约 9～11 km）。若 `computeCityShadow` 返回字段名不是 `left/right/top/bottom`，按 shadow.js 实际返回的字段改这个核对脚本。

- [ ] **Step 4: Lint、预览、提交**

Lint 同 Task 4 Step 8。预览（主控）：`#/city` 总览与第 0 站阴影与改动前一致（楼影清晰度不变），控制台无报错。
（飞地停站阴影的行为在 Task 6 有了熊猫基地站之后由主控验收。）
```bash
git add src/views/city/scene/shadow.js src/views/city/scene/CityScene.js docs/superpowers/specs/2026-10-01-city-panda-base-design.md
git commit -m "feat(city): 整城阴影只按主城区计算" -m "computeCityShadow 新增 within 过滤；飞地只在停靠该站时有阴影。" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 熊猫基地骨架（站点数据、注册、场地、地面）

做完这一步，第 12 站端到端可用：导航栏有「熊猫基地」，飞过去能看到绿色园区、园路、广场，园内 OSM 楼被隐藏。后续任务只往 `site` 里加构件。

**Files:**
- Create: `src/views/city/scene/landmarks/pandaBase/index.js`、`site.js`、`ground.js`
- Modify: `src/views/city/scene/landmarks/index.js`、`src/views/city/data/cityData.js`、`src/views/city/lab/lab.js`、`CLAUDE.md`

- [ ] **Step 1: 取西区两个水池的轮廓常量**

```bash
node -e "
const d=require('./public/city/chengdu.json')
for (const [cx,cz] of [[5993,-9861],[5583,-9979]]) {
  const p=d.water.find(w=>{const x=w.reduce((s,q)=>s+q[0],0)/w.length,z=w.reduce((s,q)=>s+q[1],0)/w.length;return Math.hypot(x-cx,z-cz)<40})
  console.log(JSON.stringify(p||null))
}"
```
两行输出即 `WEST_POOLS` 的两个多边形（局部坐标）。某一行为 `null` 时该池不开洞（草地会盖住城市水面），在提交说明里写明。

- [ ] **Step 2: `pandaBase/site.js`**

```js
/*
 * 熊猫基地 · 场地公共部分
 * ----------------------------------------------------------
 * 轮廓常量（经纬度，来自 OSM，见设计文档附录 A / B）、配色（设计文档 4.2）、分层高度，
 * 以及各分区共用的场地对象 site：两个合批器、园界、湖面、占用栅格与登记工具。
 * 坐标约定同其他景点：世界 X 东、Z 南、Y 上，单位米。
 */
import { ColorBuilder } from "../kit/builder.js"
import { centroid, rectPolygon } from "../kit/footprint.js"
import { createGrid } from "../kit/grid.js"
import { polygonBounds } from "../../utils.js"

/* ---------------- 分层高度（米） ---------------- */

export const YARD_Y = 0.3 // 熊猫活动场下沉场地顶
export const LAWN_Y = 0.85 // 园区林下草地顶
export const ISLAND_Y = 0.9 // 湖心岛草地顶（略高于林地，看得出是岛）
export const PATH_Y = 0.97 // 次级步道顶（比主路低 0.03，交叉处不闪烁）
export const PAVE_Y = 1.0 // 主园路、南门广场铺装顶

/* ---------------- 占用栅格标记 ---------------- */

export const F_SOLID = 1 // 建筑、墙、兽舍、栖架
export const F_PAVE = 2 // 园路、广场
export const F_WATER = 4 // 湖、池
export const F_TREE = 8 // 已种树 / 竹
export const F_WALK = 16 // 步行路径可走带外扩：树冠、竹丛不进
export const F_PARK = 32 // 园界以内
export const F_YARD = 64 // 熊猫活动场：只留场内布置的树

/* ---------------- 配色（设计文档 4.2） ---------------- */

export const C = {
  lawn: "#6FA24A", // 园区林下草地
  lawnOpen: "#7DB356", // 开阔草坪（广场边、湖岸、湖心岛）
  yardGrass: "#8CC063", // 活动场草地
  yardSoil: "#B59A6E", // 活动场裸土
  yardLogs: "#9A8468", // 活动场原木排
  road: "#BDB9B0", // 观光车道、主步道
  path: "#A9A59C", // 次级步道
  plaza: "#D9D4C9", // 南门广场铺装
  gateWhite: "#F2F0EA", // 南大门白壳、花盆沿、圆窗
  gateSlat: "#B9826C", // 南大门竖向格栅
  gateSign: "#2E3033", // 南大门名牌座
  bronze: "#C9A043", // 熊猫铜像金
  bronzeDark: "#8C6A2E", // 铜像暗部
  flowerRed: "#D8352A",
  flowerPink: "#E27AA6",
  museumStone: "#8A8D90",
  museumUpper: "#4E535A",
  officeTile: "#D9D2C3",
  nurseryWall: "#EDEBE4", // 产房白墙
  nurseryRoof: "#D6D3CB", // 产房屋面
  windowBand: "#3C4A55", // 观察窗深色带
  rock: "#9C9A94", // 兽舍塑石
  rockDark: "#7E7C76",
  shelterDoor: "#1F6E62",
  redPandaWall: "#C9938A",
  cabinLog: "#8A5A3A", // 木屋原木墙
  moatWall: "#A0675A", // 活动场挡土墙
  railWood: "#7A5A3C", // 墙顶木栏
  hedge: "#4F8F3E", // 绿篱
  perch: "#8C7B66", // 原木栖架
  perchDark: "#6E5F4E",
  trunkSleeve: "#C8B27E", // 树干竹筒护套
  forest: ["#4E8F3E", "#5E9C45"], // 深林色（与 THEME.tree.greens 混用）
  willow: "#9CC86A",
  reed: "#B9C47A",
  sakura: "#F2A7B8",
  swanRed: "#D8352A",
  deck: "#9A7B58", // 木栈平台
  bankStone: "#9A948A" // 驳岸石
}

/** 竹叶四色（同杜甫草堂、望江楼） */
export const BAMBOO = ["#6FAE4C", "#86C05A", "#3F7F3A", "#5E9E44"]

/* ---------------- 轮廓常量 ---------------- */

// 园区 way 941885688，Douglas–Peucker 6 m，165 点（设计文档附录 A）
export const PARK_LL = [
  /* 原样粘贴设计文档「附录 A　园区轮廓 PARK_LL」代码块里的 165 个 [lon, lat] 点 */
]
// 天鹅湖外环、湖心岛、东北小湖、南门广场、南大门（设计文档附录 B）
export const SWAN_LAKE_LL = [/* 附录 B「天鹅湖外环」32 点 */]
export const ISLAND_LL = [/* 附录 B「湖心岛」10 点 */]
export const NE_LAKE_LL = [/* 附录 B「东北小湖」14 点 */]
export const PLAZA_LL = [/* 附录 B「南门广场」25 点 */]
export const GATE_LL = [/* 附录 B「南大门」6 点 */]
// 西区两池（局部坐标，Task 6 Step 1 从 chengdu.json 取出；只开洞、不做驳岸）
export const WEST_POOLS = [/* Step 1 输出的两个多边形，null 的不放 */]

/* ---------------- 场地对象 ---------------- */

/**
 * @param {object} ctx 景点构建上下文 { project, buildings, theme, spot }
 */
export function createSite(ctx) {
  const { project, buildings } = ctx
  const ll = (list) => list.map(([lon, lat]) => project.toLocal(lon, lat))
  const park = ll(PARK_LL)
  const plaza = ll(PLAZA_LL)
  const gate = ll(GATE_LL)
  // 南大门两端（含东端岗亭 686460743）与门前空间一并替换：门的长轴 61°、进深 151°，
  // 沿长轴 u −24～36 m、进深 v −14～12 m 的矩形，中心按形心沿两轴平移（u +6、v −1）
  const [gx, gz] = centroid(gate)
  const gateZone = rectPolygon(gx + 4.76, gz - 3.78, 60, 26, 61)
  const zones = [park, plaza, gateZone]

  const pb = polygonBounds(park)
  // 园区 2.6 × 2.5 km：1 m 一格（约 2700 × 2540 格、6.9 MB）。kit/grid.js 的盖印只标记格心在半径内的格子，
  // 半径须 ≥ 0.71 × 格宽才可靠：1 m 格下园路半宽（≥ 1.5 m）、实体外扩（0.8 m）都满足；2 m 格会漏盖细路
  const grid = createGrid(
    pb.minX - 40,
    pb.minZ - 40,
    pb.maxX + 40,
    pb.maxZ + 40,
    1
  )
  grid.fillPoly(park, F_PARK)

  const lakes = {
    swan: ll(SWAN_LAKE_LL),
    island: ll(ISLAND_LL),
    ne: ll(NE_LAKE_LL)
  }
  const solids = []
  return {
    ctx,
    ll,
    b: new ColorBuilder(), // 主体（landmarkMaterial，双面）
    gb: new ColorBuilder(), // 地面批（单面）：草地、广场、园路、活动场地面
    park,
    plaza,
    gate,
    zones,
    grid,
    lakes,
    // 林下草地要挖的洞：湖、池在这里先登记，活动场由 enclosures 追加（各洞互不相交、都在园界内）
    lawnHoles: [lakes.swan, lakes.ne, ...WEST_POOLS],
    paths: [], // 已铺园路 { id, pts, w, y, closed }，walkways 按 id 取高度
    solids,
    /** 登记实体（建筑、墙、兽舍）：占用栅格打 F_SOLID，并沿边外扩 pad 米（≥ 0.71 m，见上方格宽说明） */
    solid(poly, pad = 0.8) {
      solids.push(poly)
      grid.fillPoly(poly, F_SOLID, pad)
    },
    /**
     * 取形心离 (x, z) 最近且不超过 maxDist 的 OSM 楼轮廓；没有时返回 null，
     * 调用方用设计文档 3.2 的中心 / 尺寸 / 方位做 rectPolygon 兜底（数据重拉后 id 与顺序会变，只按坐标找）
     */
    footprintNear(x, z, maxDist = 12) {
      let best = null
      let bestD = maxDist
      for (const bd of buildings) {
        if (!bd.p || bd.p.length < 3) continue
        const [cx, cz] = centroid(bd.p)
        const d = Math.hypot(cx - x, cz - z)
        if (d <= bestD) {
          bestD = d
          best = bd.p
        }
      }
      return best
    },
    bambooBufs: BAMBOO.map(() => []) // 竹梢顶点按颜色分组（vegetation 写入，最后合成）
  }
}
```
注：`gateZone` 中心偏移 (+4.76, −3.78) = 长轴单位向量 (sin 61°, −cos 61°) × 6 + 进深单位向量 (sin 151°, −cos 151°) × (−1)。

- [ ] **Step 3: `pandaBase/ground.js`**

```js
/*
 * 熊猫基地 · 地面批：园路、南门广场、湖心岛、园区林下草地
 * ----------------------------------------------------------
 * 全部进 site.gb（单面材质）。园路坐标取自 OSM 园路（设计文档 3.3 与第 6 节，简化到 2 m 容差）。
 * 主路（观光车道）顶在 PAVE_Y、次级步道在 PATH_Y：同类路颜色相同，交叠处共面也看不出闪烁；
 * 两类相差 0.03 m，交叉处主路在上。草地最后挤出（buildLawn），以便各分区先登记要挖的洞。
 */
import { extrudePolygon, sweepBar } from "../kit/shapes.js"
import { GROUND_Y } from "../../terrain.js"
import {
  C,
  F_PAVE,
  F_WATER,
  ISLAND_Y,
  LAWN_Y,
  PATH_Y,
  PAVE_Y
} from "./site.js"

/**
 * 园路：id 供 walkways 引用；main 为观光车道 / 主路（PAVE_Y、宽 w），否则为次级步道（PATH_Y）。
 * 入园主路从南大门门洞北口起铺，门洞地面与广场由 gate.js 负责
 */
export const ROADS = [
  { id: "entry", main: true, w: 6, pts: [[7447, -8617], [7410, -8703]] },
  {
    id: "loop",
    main: true,
    w: 4.5,
    pts: [
      [7410, -8703], [7433, -8747], [7449, -8772], [7448, -8791],
      [7430, -8810], [7405, -8826], [7382, -8836], [7267, -8855],
      [7238, -8853], [7218, -8843], [7191, -8848], [7178, -8863],
      [7174, -8896], [7095, -9004]
    ]
  },
  {
    id: "science",
    main: true,
    w: 4.5,
    pts: [[7396, -8711], [7333, -8778], [7157, -8783], [7134, -8857], [7147, -8935]]
  },
  {
    id: "sunSouth",
    main: true,
    w: 4.5,
    pts: [[7203, -9191], [7284, -9136], [7437, -9117], [7463, -9042]]
  },
  {
    id: "toMoon",
    main: true,
    w: 4.5,
    pts: [
      [7201, -9341], [6996, -9210], [6945, -9212], [6891, -9241],
      [6876, -9241], [6863, -9235], [6847, -9223]
    ]
  },
  {
    id: "lakeEast",
    main: true,
    w: 4.5,
    pts: [[7446, -8794], [7506, -8912], [7512, -8920], [7529, -8927], [7551, -8949], [7559, -8953]]
  },
  {
    id: "museumFront",
    main: true,
    w: 4.5,
    pts: [[7410, -8703], [7423, -8712], [7431, -8712], [7457, -8701], [7485, -8707], [7555, -8755]]
  },
  { id: "entrySide", main: false, w: 3, pts: [[7427, -8603], [7412, -8700]] },
  {
    id: "villas",
    main: false,
    w: 3,
    pts: [
      [7174, -8896], [7199, -8919], [7201, -8957], [7205, -8972],
      [7254, -9012], [7328, -9082], [7344, -9097], [7381, -9094], [7437, -9068]
    ]
  },
  {
    id: "sunLoop",
    main: false,
    w: 3,
    closed: true,
    pts: [
      [7204, -9178], [7226, -9174], [7243, -9143], [7263, -9130],
      [7264, -9120], [7248, -9103], [7223, -9084], [7209, -9078],
      [7185, -9090], [7169, -9104], [7163, -9128], [7165, -9144],
      [7175, -9155], [7199, -9170]
    ]
  },
  {
    id: "sunToNo2",
    main: false,
    w: 3,
    pts: [
      [7163, -9128], [7157, -9130], [7014, -9110], [7002, -9131],
      [7002, -9159], [7012, -9171], [7005, -9200], [6996, -9210]
    ]
  },
  {
    id: "moonLoop",
    main: false,
    w: 3,
    pts: [
      [6878, -9307], [6884, -9325], [6886, -9346], [6880, -9366],
      [6872, -9379], [6838, -9397], [6801, -9393], [6771, -9369],
      [6763, -9338], [6777, -9303], [6786, -9294], [6812, -9294],
      [6818, -9285]
    ]
  },
  {
    id: "lakeWest",
    main: false,
    w: 3,
    pts: [
      [7461, -8823], [7437, -8821], [7420, -8826], [7401, -8868],
      [7399, -8886], [7388, -8917], [7409, -8935], [7431, -8947],
      [7438, -8968], [7449, -8980], [7495, -9019]
    ]
  },
  {
    id: "no2Loop",
    main: false,
    w: 3,
    pts: [
      [6945, -9212], [6934, -9229], [6931, -9251], [6938, -9269],
      [6947, -9281], [6958, -9289], [6971, -9294], [6982, -9295],
      [7009, -9287], [7026, -9276], [7040, -9254], [7041, -9240],
      [7032, -9228], [7016, -9225], [6999, -9227], [6996, -9210]
    ]
  },
  {
    id: "no1",
    main: false,
    w: 3,
    pts: [
      [6725, -9068], [6709, -9077], [6703, -9084], [6698, -9106],
      [6705, -9132], [6723, -9139], [6738, -9150], [6755, -9143],
      [6771, -9140], [6776, -9133], [6775, -9116], [6768, -9104]
    ]
  }
]

/** 园路带：顶面在 y、侧面 0.15 m（只做顶面与侧面，底埋在草地里） */
function addRoad(site, r) {
  const y = r.main ? PAVE_Y : PATH_Y
  const pts = r.closed ? [...r.pts, r.pts[0]] : r.pts
  site.gb.add(
    sweepBar(
      pts.map(([x, z]) => [x, y - 0.15, z]),
      r.w,
      0.15
    ),
    r.main ? C.road : C.path
  )
  site.grid.stampLine(pts, r.w / 2, F_PAVE)
  site.paths.push({ id: r.id, pts: r.pts, w: r.w, y, closed: !!r.closed })
}

/** 园路、南门广场、湖心岛（草地之外的地面），在各分区之前调用 */
export function buildPaths(site) {
  for (const r of ROADS) addRoad(site, r)
  // 南门广场（园界外、熊猫大道旁）：与主路同高；草坪内环、喷泉由 gate.js 叠加
  site.gb.add(extrudePolygon(site.plaza, [], GROUND_Y, PAVE_Y), C.plaza)
  site.grid.fillPoly(site.plaza, F_PAVE)
  // 湖心岛：落在天鹅湖洞里，单独挤出
  site.gb.add(
    extrudePolygon(site.lakes.island, [], GROUND_Y, ISLAND_Y),
    C.lawnOpen
  )
  // 湖面先打水面标记（外扩 1 m）：后续分区与树竹都要避开，草地虽然最后才挤出，标记必须在这里打
  for (const h of [site.lakes.swan, site.lakes.ne]) {
    site.grid.fillPoly(h, F_WATER, 1)
  }
}

/** 园区林下草地：整片挤出到 LAWN_Y，湖、池、活动场开洞；在各分区登记完洞之后调用 */
export function buildLawn(site) {
  site.gb.add(
    extrudePolygon(site.park, site.lawnHoles, GROUND_Y, LAWN_Y),
    C.lawn
  )
}

/** 按 id 取已铺园路（walkways 用） */
export function pathById(site, id) {
  const p = site.paths.find((q) => q.id === id)
  if (!p) throw new Error(`熊猫基地：未知园路 ${id}`)
  return p
}
```
（ROADS 坐标按上面格式书写，跑 prettier 后会自动换成每点一行，正常。）

- [ ] **Step 4: `pandaBase/index.js`**

```js
/*
 * 熊猫基地（成都大熊猫繁育研究基地）· 第 12 站
 * ----------------------------------------------------------
 * 设计文档：docs/superpowers/specs/2026-10-01-city-panda-base-design.md（坐标、尺寸、配色以它为准）。
 * 园区在主城区数据东北约 5 km 外的飞地数据里（chengdu.json 的 meta.enclaves）。
 * 按分区拆文件：site 场地公共部分、ground 地面、gate 南大门与铜像、halls 博物馆等建筑、
 * lake 天鹅湖、enclosures 熊猫别墅与产房、walkways 步行路径、vegetation 树竹。
 * 预算：≤ 4 万三角形、2 个 Mesh（主体 DoubleSide + 地面批 FrontSide），熊猫并入主体批。
 */
import { FrontSide, Mesh } from "three"
import { landmarkMaterial } from "../kit/builder.js"
import { createSite } from "./site.js"
import { buildLawn, buildPaths } from "./ground.js"

// 定位针底座高度：南大门熊猫头左耳顶（真实约 10.5 m × 1.25 插画放大）
const MARKER_HEIGHT = 13.1

export function build(ctx) {
  const site = createSite(ctx)
  buildPaths(site)
  const walkways = []
  buildLawn(site)

  const meshes = []
  const g = site.b.bake()
  if (g) meshes.push(new Mesh(g, landmarkMaterial()))
  const gg = site.gb.bake()
  if (gg) {
    const mat = landmarkMaterial()
    mat.side = FrontSide
    meshes.push(new Mesh(gg, mat))
  }
  return { meshes, zones: site.zones, markerHeight: MARKER_HEIGHT, walkways }
}
```

- [ ] **Step 5: 注册、站点数据、实验页键**

`landmarks/index.js`：import 区加 `import { build as pandaBase } from "./pandaBase/index.js"`，`LANDMARK_MODULES` 末尾加 `熊猫基地: pandaBase`。

`cityData.js`：
- `FLOW` 改为（注释同步）：
```js
/**
 * 热门景点客流 Top5（示意值，单位：人次；按降序排列，面板按最大值归一化）。
 * 新增熊猫基地站后纳入熊猫基地（示意值 16.8 万），原第 5 名文殊院移出 Top5
 */
export const FLOW = [
  { name: "春熙路·太古里", value: 186000 },
  { name: "熊猫基地", value: 168000 },
  { name: "宽窄巷子", value: 149000 },
  { name: "武侯祠·锦里", value: 135000 },
  { name: "天府广场", value: 123000 }
]
```
- `SPOTS` 末尾（杜甫草堂之后）追加：
```js
  {
    name: "熊猫基地",
    en: "CHENGDU PANDA BASE",
    // 依据：OSM 南大门轮廓形心（way 686460747）；定位针挂在熊猫头大门上方（最能一眼读成熊猫基地），
    // 园区在主城区数据东北约 5 km 外的飞地数据里（chengdu.json 的 meta.enclaves）
    lon: 104.143645,
    lat: 30.735095,
    desc: "成都北郊熊猫大道旁的大熊猫迁地保护与繁育研究基地，1987 年以 6 只抢救自野外的大熊猫起步。园区竹林成荫，熊猫造型的南大门、太阳产房与月亮产房、熊猫别墅群和天鹅湖串成经典游线，可看到从幼崽到成年的大熊猫。",
    facts: [
      ["建立时间", "1987 年"],
      ["景区类型", "繁育研究基地"],
      ["所属区域", "成华区"],
      ["开放时间", "07:30–18:00"]
    ],
    image: null,
    // 初始机位（调研阶段按估计高度手算，待景点建模后按截图调整）：从东南偏东（方位 125°）
    // 俯仰 30°、1000 m 看，注视点从南大门向西北平移约 333 m 到核心区中部；南大门在左下，
    // 铜像、博物馆、天鹅湖、别墅群、太阳产房、月亮产房同框
    cam: { offset: [709.4, 500.0, 496.7], look: [-160.6, -291.6] }
  }
```

`lab.js`：文件头 `landmark` 键列表末尾加 ` | pandaBase`；`SPOT_KEYS` 加 `pandaBase: "熊猫基地"`。

`CLAUDE.md`：
- 「Dev-only single-landmark preview」一句的 `key` 列表末尾加 `| \`pandaBase\``。
- `/city` 那条说明后补一句：`The panda base stop (index 11) lives in an "enclave" — a separately fetched OSM patch ~5 km NE of the main data (meta.enclaves in chengdu.json; fetch-osm-city.py --enclave / --keep-main).`

- [ ] **Step 6: 统计**

```bash
node scripts/city-landmark-check.mjs stats 熊猫基地
```
Expected：`熊猫基地  三角形 约 1,500～2,500（…）  Mesh 2  底座 13.1  路径 0 条 0 m …`，不报错。

- [ ] **Step 7: Lint、预览（主控）、提交**

Lint 同前。预览：
1. 实验页 `city-lab.html?landmark=pandaBase&yaw=125&pitch=30&dist=1000&tx=-160.6&tz=-291.6`：深绿园区、浅灰园路网、南门广场、湖与池露出水面，园内无通用方盒楼。
2. 城市页 `#/city?spot=11`：导航栏第 12 个按钮「熊猫基地」，右栏介绍正确；巡览从杜甫草堂飞过来时明显拉高（看得到城区与飞地之间的空白地面）、时长约 3 s；在熊猫基地附近拖拽、缩放，注视点不会跳回主城区；左栏 Top5 第 2 名为熊猫基地。
```bash
git add src/views/city/scene/landmarks/pandaBase/index.js src/views/city/scene/landmarks/pandaBase/site.js src/views/city/scene/landmarks/pandaBase/ground.js src/views/city/scene/landmarks/index.js src/views/city/data/cityData.js src/views/city/lab/lab.js CLAUDE.md
git commit -m "feat(city): 新增熊猫基地站点、场地与地面" -m "第 12 站（下标 11）：站点数据、客流 Top5、注册与实验页键；园区草地、园路、南门广场、湖心岛，园内 OSM 楼替换。" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### 建模任务通用要求（Task 7～12）

- 每个分区一个文件，导出 `buildXxx(site)`（walkways 返回数组，vegetation 收 walkways），在 `pandaBase/index.js` 按下列顺序接入：
  ```js
  buildPaths(site)
  buildGate(site)
  buildHalls(site)
  buildLake(site)
  buildEnclosures(site)
  const walkways = buildWalkways(site)
  plantAll(site, walkways)
  buildLawn(site)
  ```
- 构件进 `site.b`（主体）或 `site.gb`（贴地平面）；实体轮廓用 `site.solid(poly)` 登记，水面 / 铺装 / 活动场分别打 `F_WATER` / `F_PAVE` / `F_YARD`。
- 占用栅格 1 m 一格：`stamp` / `disk` / `stampLine` / `fillPoly` 的外扩只标记格心在半径内的格子，**半径与 pad 须 ≥ 0.71 m**，否则可能一格都盖不上（见 `kit/grid.js` 文件头）。颜色一律用 `site.js` 的 `C` / `BAMBOO`，确需新色就加进 `C` 并注释用途。
- 尺寸、坐标、高度、放大系数严格按设计文档对应小节；调研推定的内容（太阳产房扇形院、月亮产房内院、3～7 号别墅布局）照文档推定值做。
- **三角形子预算**（合计 ≤ 40,000，每个任务结束都跑 `stats` 核对总数）：

  | 任务 | 内容 | 子预算 |
  |---|---|---|
  | Task 6 | 园路、广场、湖心岛、草地 | ≤ 3,000 |
  | Task 7 | 南大门、铜像花坛、广场草坪与喷泉、入园行道树 | ≤ 2,800 |
  | Task 8 | 博物馆、游客中心、探秘馆、办公区、木屋餐厅、熊猫厨房、矮房 | ≤ 3,000 |
  | Task 9 | 天鹅湖驳岸、栈台、柳、芦苇、岛上树、黑天鹅 | ≤ 900 |
  | Task 10 | 7 座别墅、太阳 / 月亮产房、栖架、水池、小熊猫区、10 只熊猫 | ≤ 15,500 |
  | Task 12 | 核心区乔木 160、竹丛、西区林冠面与竹 | ≤ 14,000 |

- 每个任务的固定收尾步骤：
  1. `node scripts/city-landmark-check.mjs stats 熊猫基地` —— 总三角形 ≤ 已完成任务子预算之和、`Mesh 2`。
  2. Lint（eslint + prettier）。
  3. 主控在实验页按站点视野截图，再按任务给的近景参数截图，对照设计文档第 2 节照片描述检查形体与配色。
  4. 提交（只 add 本任务改的文件）。

---

### Task 7: 南大门、熊猫铜像、南门广场（`pandaBase/gate.js`）

**规格：** 设计文档 4.4（南大门，整体 ×1.25，绕形心 (7464.1, −8588.4)）、4.5（入园主路两侧行道树、铜像 ×2.2 与三层花坛）、4.3「南门广场」（5 块草坪内环与喷泉池，内环轮廓可在 `/tmp/panda-research/core.json` 里按 relation 16672648 取；临时目录不在时，用 3～5 个椭圆草坪按广场形状示意）。

**接口：** `export function buildGate(site)`；南大门「绕形心放大」的中心用 `site.ctx.spot.x / z`（OSM 面积形心 (7464.1, −8588.4)），不要用 `centroid(site.gate)`（顶点平均，差 2.7 m）；门洞地面与 `entry` 园路都在 `PAVE_Y`、颜色不同，只能对接、不能重叠；**门洞地面必须铺满广场边 [7478, −8571] 到 `entry` 起点 [7447, −8617] 之间约 46 m 的整段**（至少覆盖 3 m 宽的步行带，Task 11 第 1 条路径从这里穿过；`entry` 的渲染路面会自动往外延 0.4 m，对接时留意不要叠在门洞地面上）；广场草坪内环与喷泉池用 `site.plazaHoles.push(poly)` 从广场挖洞（须在广场内、互不相交），洞里的草坪 / 池水 / 池沿由本文件画（城市水面层的喷泉水面 0.3 m 会从洞里露出）；门洞地面铺到 `PAVE_Y`，从广场接到入园主路 `entry` 起点；名牌座、白壳、头环、格栅、亭都用 `site.solid` 登记（门洞通道不登记）。

- [ ] **Step 1:** 按规格实现 `gate.js`，在 index.js 接入（`buildPaths` 之后）。
- [ ] **Step 2:** 核对左耳顶高：放大后约 13.1 m（= `MARKER_HEIGHT`），定位针球应悬在耳顶上方约 14 m。
- [ ] **Step 3:** 收尾（通用要求）。近景：`dist=160&yaw=150&pitch=20&tx=0&tz=0`（正对门立面）、`dist=220&yaw=120&pitch=35&tx=-74&tz=-113`（铜像）。
- [ ] **Step 4:** 提交 `feat(city): 熊猫基地南大门与熊猫铜像`。

### Task 8: 博物馆与其余建筑（`pandaBase/halls.js`）

**规格：** 设计文档 4.6（博物馆 4 块用模块常量；游客中心、探秘馆、办公区、两座木屋餐厅）、4.11「熊猫厨房」、3.5 的 12 栋改平屋面矮房与 686460737（塑石兽舍做法可留给 Task 10 的兽舍函数，此处先按矮房做）。轮廓优先 `site.footprintNear(中心 x, z)`，取不到用 3.2 的中心 / 尺寸 / 方位 `rectPolygon` 兜底；高度按 ×1.25 后的值。

**接口：** `export function buildHalls(site)`。

- [ ] **Step 1:** 实现并接入（`buildGate` 之后）。
- [ ] **Step 2:** 收尾。近景：`dist=300&yaw=125&pitch=30&tx=40&tz=-90`（博物馆一带）。
- [ ] **Step 3:** 提交 `feat(city): 熊猫基地博物馆与园内建筑`。

### Task 9: 天鹅湖（`pandaBase/lake.js`）

**规格：** 设计文档 4.7。黑天鹅做**静态**件（不做漂游动画，免得动画件与阴影约定增加复杂度）；驳岸用 `sweepBar` 沿湖外环一圈（0.3 → 0.85）；湖心岛树与樱花丛种在 `ISLAND_Y`。湖面由城市水面层画，模块不再画水。

**接口：** `export function buildLake(site)`。

- [ ] **Step 1:** 实现并接入（`buildHalls` 之后）。
- [ ] **Step 2:** 收尾。近景：`dist=320&yaw=125&pitch=35&tx=16&tz=-338`。
- [ ] **Step 3:** 提交 `feat(city): 熊猫基地天鹅湖`。

### Task 10: 熊猫别墅、产房、栖架与熊猫（`pandaBase/enclosures.js`）

**规格：** 设计文档 4.8（别墅通用模板与 7 座别墅表）、4.9（栖架）、4.10（太阳产房：环楼、门厅、6 个扇形院、小卖亭）、4.11（月亮产房、吊桥、小熊猫区、686460737 塑石兽舍）、4.12（熊猫）。熊猫按决策**10 只**：4.12 摆放表去掉第 8、12 行；调用
```js
addPanda(site.b, frame(x, y, z, 125 + 180 + 抖动), { height: 6.5, pose: "sit", flat: true, detail: 0 })
```
（幼崽 `height: 3.8`；趴姿 `pose: "climb"`、`height: 6`，`frame(台沿中点, 台顶, 125)`）。抖动 ±20° 用 `mulberry32(hashInts(…))` 按位置播种。

**活动场与草地洞：** 每个下沉活动场的场地多边形用 `site.addYard(poly)` 登记（它会加进 `lawnHoles`、打 `F_YARD`、把场地面挤出到地面批，并在压到园路 / 水面 / 其他活动场时告警；多边形必须互不相交、都在园界内、不压园路，控制台出现告警就改形状）；挡土墙、木栏、绿篱进 `site.b` 并 `site.solid`。

**接口：** `export function buildEnclosures(site)`。

**交接（Task 8 已做）：** 686460737（(7030.9, −9185.7)）已在 `halls.js` 的 `LOW_HOUSES` 里按 7.5 m 矮房建成，轮廓也已被 `footprintNear` 取走。若本任务按 4.11 改做塑石兽舍，必须同时把它从 `LOW_HOUSES` 删掉，否则会叠两栋、且取轮廓得到 null。

**月亮产房不要用 `footprintNear` 取轮廓**：它现在优先返回「包含查询点」的楼，而环形楼的面积形心与拟合圆心都落在内院里，会被内环 1229850750 包含，取到的是内环（外环 / 内环对调）。外环按 4.11 直接用附录 B 的 31 点常量（`ll()` 换算）建；内环已在替换区里被隐藏，不用取。顺手在 `site.js` 的 `footprintNear` 注释里补一句「环形楼的面积形心会落在院内，这类楼请用常量轮廓」。一号别墅、太阳产房、2 号别墅按 3.5 节中心查找正常。

**共用工具**：平屋面 / 立面工具已在 `pandaBase/blocks.js`（`flatBlock`、`facadeBands`、`safeInset`、`facingBlocked`、`outlineOf` 等），兽舍、2 号别墅、产房的白墙与观察窗带直接复用，不要复制。

- [ ] **Step 1:** 实现别墅模板函数与 7 座别墅、栖架、水池。
- [ ] **Step 2:** 实现太阳产房、月亮产房、吊桥、小熊猫区、兽舍。
- [ ] **Step 3:** 摆 10 只熊猫，接入 index.js（`buildLake` 之后）。
- [ ] **Step 4:** 收尾。近景：`dist=300&yaw=125&pitch=35&tx=-261&tz=-542`（太阳产房）、`dist=320&yaw=150&pitch=35&tx=-636&tz=-747`（月亮产房）、`dist=360&yaw=125&pitch=32&tx=-210&tz=-390`（别墅群）。熊猫在站点视野里要能分辨黑白（约 10 px 以上）。
- [ ] **Step 5:** 提交 `feat(city): 熊猫基地别墅、产房与熊猫`。

### Task 11: 步行路径（`pandaBase/walkways.js`）

**规格：** 设计文档第 6 节 11 条路径与其后的微调说明。路径点列直接取 `site.paths`（即 `ground.js` 的 `ROADS` 原始点列；渲染的路面两端已外延 0.4 m、折点带斜接，路径端点不会落在路面边缘），高度用 `pathById(site, id).y`，不要另抄坐标：

| # | 园路 id | width | density | closed |
|---|---|---|---|---|
| 1 | 广场段 [[7503,−8551],[7478,−8571]] + 门洞中点（Task 7 门洞实际位置） + `entry` | 3.0 | 1.8 | — |
| 2 | `loop`（到 [7174,−8896] 为止，去掉末点） | 3.0 | 0.6 | — |
| 3 | `villas` | 2.4 | 0.8 | — |
| 4 | `sunLoop` | 2.4 | 1.4 | ✓ |
| 5 | `sunToNo2` 后接 `toMoon` 自 [6996,−9210] 起 | 2.4 | 0.4 | — |
| 6 | `moonLoop` | 2.4 | 1.0 | — |
| 7 | `lakeWest` | 2.4 | 0.5 | — |
| 8 | `lakeEast` | 3.0 | 0.3 | — |
| 9 | `museumFront` | 3.0 | 0.5 | — |
| 10 | `no2Loop` | 2.4 | 0.5 | — |
| 11 | `no1` | 2.4 | 0.4 | — |

第 1 条的广场段 y 取 `PAVE_Y`（广场顶）；拼接两段时去掉重复点。各路径登记 `grid.stampLine(points, width / 2 + 4.5, F_WALK)`（树竹离可走带 ≥ 4.5 m，见 4.13「净空」）。

**接口：** `export function buildWalkways(site)` 返回 `[{ points, y, width, closed, density }]`。

- [ ] **Step 1:** 实现并接入（`buildEnclosures` 之后，`const walkways = buildWalkways(site)`）。
- [ ] **Step 2:** 校验：
  ```bash
  node scripts/city-landmark-check.mjs walk 熊猫基地
  ```
  Expected：「坏点合计 0」。有坏点就按打印的类别改**模型或路径点**（门洞净空、院墙离路距离、礼品亭位置等），不要放宽阈值。确属设计取舍且远景不可见的残留坏点，记进提交说明与 Task 13 的集成记录。
- [ ] **Step 3:** `stats` 显示路径 11 条、约 3,100 m；收尾。
- [ ] **Step 4:** 提交 `feat(city): 熊猫基地步行路径`。

### Task 12: 树竹（`pandaBase/vegetation.js`）

**规格：** 设计文档 4.13 按最终决策：核心区乔木**全部** `addTree` detail 0、共 160 棵（入口区、太阳产房周边优先）；竹林甬道沿 `loop` 西半段与 `villas` 两侧约 120 丛 + 点种约 60 丛，竿顶向路心倾 14°；西区**林冠起伏面**：园区西区部分（园区多边形减去核心区 x ≥ 6660 且 z ≥ −9440）按 40 m 网格三角网、顶点高 8～16 m（`mulberry32(hashInts(种子, ix, iz))`），只保留三个顶点都在西区园界内、且三角形中心不在 `F_WATER` 格（西区两池已打水面标记）上的三角形，颜色取 `C.forest` 与 `THEME.tree.greens`；西区竹约 40 丛沿园区西南边界内侧。

竹丛写法：本文件内 `addBamboo(bufs, x, y, z, rand, h, n, lean)` 自写随机规则（可参照 `dufu.js` 的同名函数），写顶点一律调 `kit/plants.js` 的 `pushSpindle`；种完后 `site.bambooBufs[i]` 每色 `fromTriangles` 一个几何体加进 `site.b`。

**熊猫视线**：每棵乔木（冠心、半径约 1.15 r）与每丛竹（半高处、半径约 簇半径 + 半高）落位前调用 `site.blocksView(cx, cy, cz, radius)`，为真就跳过（Task 10 导出，保护 10 只熊猫到站点机位的视线；它只保护头部那条线，调用时半径再加约 1.5 m，免得擦过视线挡住熊猫身体）。活动场里的低竹已由 yards.js 直接并进 `site.b`，不要重复加进 `site.bambooBufs`。

避让：乔木、竹丛中心要求 `grid.freeDisk(x, z, r, F_SOLID | F_PAVE | F_WATER | F_WALK | F_TREE | F_YARD)` 为真（活动场内只有 Task 10 布置的套竹筒树），种下后 `grid.disk(x, z, r, F_TREE)`；竹梢与树冠不得压到路径头顶 4.35 m 以内。

**接口：** `export function plantAll(site, walkways)`。

- [ ] **Step 1:** 实现并接入（`buildWalkways` 之后、`buildLawn` 之前）。
- [ ] **Step 2:** `stats`：总三角形 **≤ 40,000**、Mesh 2。超出时依次减西区竹、核心区远处乔木（离南大门 > 900 m 的先减）。
- [ ] **Step 3:** `walk 熊猫基地` 仍为 0 坏点（树竹不进路径净空）。
- [ ] **Step 4:** 收尾。近景：`dist=240&yaw=125&pitch=25&tx=-200&tz=-260`（竹林甬道）。
- [ ] **Step 5:** 提交 `feat(city): 熊猫基地树竹与西区林冠`。

---

### Task 13: 城市页联调与集成记录

**Files:**
- Modify: `src/views/city/data/cityData.js`（`cam` 微调）、`src/views/city/components/TourBar.vue`（文件头注释）、`docs/superpowers/specs/2026-10-01-city-panda-base-design.md`（追加「集成记录」）

- [ ] **Step 1: 机位微调**

`#/city?spot=11`（1920×1080）截图。要求：南大门、定位针与当前站标签不压左栏（x 28～408 / y 92～611）、右栏（x 1452～1832 / y 92～546）、顶栏（y < 80）、导航（y 985～1055）；核心区主体约占画宽 40%～60%；月亮产房在画面内。按截图调 `cam.offset`（保持方位约 125°、俯仰 28°～35°）与 `cam.look`；约束 `|look| + 相机距离 < 1500`（否则一到站就恢复整城阴影）。把最终取值与理由写进 `cam` 上方注释（同其他站的写法）。

- [ ] **Step 2: 巡览与交互**

逐项验证并记录：
1. 巡览 杜甫草堂 → 熊猫基地 → 天府广场：两段都拉高、时长约 3.0～3.3 s，途中注视点不被拽回、无跳变。
2. 复位到总览：11 个标签与改动前一致，熊猫基地标签不出现；从熊猫基地复位也是长飞行（拉高）。
3. 在熊猫基地站拖拽、滚轮缩放（含光标指向园外空白处），注视点不离开飞地矩形；在城区与飞地之间的空白处缩放后，注视点落回最近区域。
4. 停站：熊猫基地有阴影且清晰；在熊猫基地拉远到超出收紧范围后换成飞地的静态阴影（仍有影子）；离站飞回主城区途中换成主城区静态阴影。
5. 行人：到站生成、离站淡出；控制台无报错（`read_console_messages`）。
6. 导航栏 1920 与 1280×720 下都是单行，不碰左下提示与右下指北针。

- [ ] **Step 3: TourBar 注释**

按实测把文件头的「11 个站点 … 约 1126px …」改为 12 站的宽度、居中范围、离左右控件距离与余量。

- [ ] **Step 4: 集成记录**

在设计文档末尾追加 `## 集成记录`（格式参照 `2026-09-30-city-dufu-design.md` 的同名章节）：最终机位与取舍、三角形与 Mesh 统计、步行路径校验结果、长飞行实测时长、导航栏实测尺寸、已知限制（飞地拉远无阴影、人工打断长飞行时注视点会跳回最近区域、园内「熊猫塔」与西区场馆未建）。

- [ ] **Step 5: 全量检查与提交**

```bash
npx eslint --max-warnings 0 "src/views/city/**/*.{vue,js}"
npx prettier --check "src/views/city/**/*.{vue,js}" scripts/city-landmark-check.mjs
node scripts/city-landmark-check.mjs stats 熊猫基地 天府熊猫塔 "成都 IFS" 杜甫草堂 望江楼
node scripts/city-landmark-check.mjs walk 熊猫基地
```
```bash
git add src/views/city/data/cityData.js src/views/city/components/TourBar.vue docs/superpowers/specs/2026-10-01-city-panda-base-design.md
git commit -m "docs(city): 熊猫基地集成记录与机位微调" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 自查记录

- 规格覆盖：数据层 1.1 → Task 3；注视点范围 2.1 / 长飞行 2.2 → Task 4；阴影 2.3 → Task 5；落点、机位、预算、kit、注册 → Task 2、6～12；界面与文案 4 → Task 6、13；验证 5 → 各任务收尾与 Task 13。
- 建模任务（7～12）给出的是接口、规格出处、子预算与验收命令，不逐行给代码：各分区是数百至上千行的程序化建模，具体形体以设计文档的尺寸表为准（同 `2026-09-28-city-landmarks.md` 的景点任务写法）。基础设施任务（1～6）给出完整代码。
- 名称一致性：`createSite` / `buildPaths` / `buildLawn` / `pathById` / `ROADS` / `site.solid` / `site.lawnHoles` / `site.footprintNear` / `site.bambooBufs` 在 Task 6 定义，Task 7～12 引用；`pushSpindle`、`createGrid`、`addPanda({ pose, flat, detail })` 在 Task 2 定义。

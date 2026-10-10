/*
 * 数字楼宇 园区级（成都金融城双子塔 · 天府国际金融中心）布局数据生成
 * ----------------------------------------------------------
 * 从 OSM 取园区及四周道路，换算成以双子塔两楼中点为原点的本地米制坐标（x 向东、y 向北），
 * 裁到沙盘范围内，输出给 Blender 建模脚本与前端：
 *   scripts/blender/park/layout.json   楼体轮廓 / 层数 / 屋顶、道路中心线与宽度、草地 / 水面 / 公园面、沙盘范围；
 *                                      另在园区空地上生成几处景观湖与环湖步道（设计稿有、OSM 没有，示意）
 *   src/views/building/data/parkData.js 楼栋清单（名称、层数、高度、中心点），前端标签与面板用
 *
 * 用法：node scripts/build-park-layout.mjs
 * Overpass 结果缓存在 node_modules/.cache/building-geo/park-osm.json；Node 的 fetch 在 Claude 沙箱里不走代理，需在沙箱外运行。
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const CACHE = path.join(ROOT, "node_modules/.cache/building-geo/park-osm.json")
const OUT_LAYOUT = path.join(ROOT, "scripts/blender/park/layout.json")
const OUT_DATA = path.join(ROOT, "src/views/building/data/parkData.js")

/** 原点：双子塔南北两楼中点（与城市级 mapData.js 的 PARK.center 一致） */
const ORIGIN = [104.062265, 30.585043]
/** 沙盘范围（本地米）：西含交子北一路 / 交子南一路，东含天府大道与辅道，南到锦尚西二路，北到园区北路 */
const BOUNDS = { x0: -105, x1: 395, y0: -425, y1: 385 }
/** 查询用的经纬度包围盒（比沙盘略大） */
const BBOX = "30.578,104.055,30.592,104.072"

/** 楼层高度（米）：写字楼标准层 4.2 m；会议中心按 OSM 的层数与实测高度 16 m 推算 */
const FLOOR_H = 4.2

/** 园区楼栋：OSM way id → 简称 / 类型；未列出的园区内小建筑按 small 处理 */
const BUILDINGS = {
  475895964: { short: "南塔", kind: "tower", key: "tower_S" },
  475895965: { short: "北塔", kind: "tower", key: "tower_N" },
  305255527: { short: "会议中心", kind: "hall", key: "hall" },
  305255521: { short: "1 号楼", kind: "pebble", key: "ifc_1" },
  305255522: { short: "2 号楼", kind: "pebble", key: "ifc_2" },
  305255523: { short: "3 号楼", kind: "pebble", key: "ifc_3" },
  305255524: { short: "4 号楼", kind: "pebble", key: "ifc_4" },
  305255525: { short: "5 号楼", kind: "pebble", key: "ifc_5" },
  305255526: { short: "6 号楼", kind: "pebble", key: "ifc_6" },
  484309799: { short: "8 号楼", kind: "pebble", key: "ifc_8", levels: 2 },
  481311782: { short: "9 号楼", kind: "pebble", key: "ifc_9", levels: 2 }
}

/**
 * 道路宽度（米，单幅）：比真实路幅略宽一档（天府大道主路每幅约 15 m，这里给 18 m）。
 * 真实园区 500 × 810 m，默认取景下按实宽画的路只有几个像素，设计稿里的路明显更宽、更醒目
 */
const ROAD_WIDTH = {
  primary: 18,
  secondary: 15,
  tertiary: 14,
  residential: 11,
  service: 7.5,
  pedestrian: 8,
  footway: 4,
  cycleway: 4,
  path: 3
}
/** 行驶道路两侧人行道各宽（米），与 scripts/blender/park/site.py 的 SIDEWALK 一致 */
const SIDEWALK = 3
const DRIVE_KINDS = new Set(["primary", "secondary", "tertiary", "residential"])

/**
 * 景观湖：OSM 里园区只有 5 个二三十米的小水池，设计稿园区里有好几处湖面。
 * 在园区地块内找离楼、路、已有水面最远的空地，按「最大空圆」贪心放置（示意，非真实数据），
 * 湖周留 LAKE_GAP 米给环湖步道与灯
 */
const LAKES = { max: 5, minR: 13, maxR: 34, gap: 8, seed: 3 }

// ---------------------------------------------------------------- 取数
async function loadOsm() {
  if (fs.existsSync(CACHE)) return JSON.parse(fs.readFileSync(CACHE, "utf8"))
  const q = `[out:json][timeout:90];(
    way["building"](${BBOX});way["highway"](${BBOX});way["leisure"](${BBOX});
    way["landuse"](${BBOX});way["natural"="water"](${BBOX});way["amenity"="parking"](${BBOX}););out tags geom;`
  const mirrors = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
  ]
  for (let round = 0; round < 3; round++) {
    for (const url of mirrors) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "User-Agent": "bi-demo-building/1.0",
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: "data=" + encodeURIComponent(q)
        })
        const text = await res.text()
        const data = JSON.parse(text)
        if (!Array.isArray(data.elements)) throw new Error("无 elements")
        fs.mkdirSync(path.dirname(CACHE), { recursive: true })
        fs.writeFileSync(CACHE, text)
        return data
      } catch {
        // Overpass 忙时返回 HTML，换镜像重试
      }
    }
    await new Promise((r) => setTimeout(r, 5000 * (round + 1)))
  }
  throw new Error("Overpass 取数失败")
}

// ---------------------------------------------------------------- 几何工具
const KX = Math.cos((ORIGIN[1] * Math.PI) / 180) * 111320
const KY = 110540
const round1 = (n) => Math.round(n * 10) / 10
const toLocal = (p) => [
  round1((p.lon - ORIGIN[0]) * KX),
  round1((p.lat - ORIGIN[1]) * KY)
]

function area(ring) {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[(i + 1) % ring.length]
    a += x0 * y1 - x1 * y0
  }
  return a / 2
}

/** 闭合环 → 去掉重复末点、统一逆时针 */
function normRing(pts) {
  const r = pts.slice()
  const a = r[0]
  const b = r[r.length - 1]
  if (a[0] === b[0] && a[1] === b[1]) r.pop()
  return area(r) < 0 ? r.reverse() : r
}

/** 多边形按矩形裁剪（Sutherland–Hodgman） */
function clipPolygon(ring, b) {
  const edges = [
    (p) => p[0] >= b.x0,
    (p) => p[0] <= b.x1,
    (p) => p[1] >= b.y0,
    (p) => p[1] <= b.y1
  ]
  const cut = [
    (p, q) => lerpAt(p, q, 0, b.x0),
    (p, q) => lerpAt(p, q, 0, b.x1),
    (p, q) => lerpAt(p, q, 1, b.y0),
    (p, q) => lerpAt(p, q, 1, b.y1)
  ]
  let out = ring
  for (let e = 0; e < 4 && out.length; e++) {
    const inp = out
    out = []
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i]
      const prev = inp[(i + inp.length - 1) % inp.length]
      const ci = edges[e](cur)
      const pi = edges[e](prev)
      if (ci) {
        if (!pi) out.push(cut[e](prev, cur))
        out.push(cur)
      } else if (pi) {
        out.push(cut[e](prev, cur))
      }
    }
  }
  return out.length >= 3 ? out : null
}

function lerpAt(p, q, axis, v) {
  const t = (v - p[axis]) / (q[axis] - p[axis])
  return [round1(p[0] + (q[0] - p[0]) * t), round1(p[1] + (q[1] - p[1]) * t)]
}

/** 折线按矩形裁剪（逐段 Liang–Barsky），出界处断开，返回若干段折线 */
function clipPolyline(pts, b) {
  const parts = []
  let cur = []
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = clipSegment(pts[i], pts[i + 1], b)
    if (!seg) {
      if (cur.length > 1) parts.push(cur)
      cur = []
      continue
    }
    const [a, c] = seg
    if (!cur.length) cur.push(a)
    else if (
      cur[cur.length - 1][0] !== a[0] ||
      cur[cur.length - 1][1] !== a[1]
    ) {
      parts.push(cur)
      cur = [a]
    }
    cur.push(c)
    // 本段末端被裁掉，说明出界，断开
    if (c[0] !== pts[i + 1][0] || c[1] !== pts[i + 1][1]) {
      parts.push(cur)
      cur = []
    }
  }
  if (cur.length > 1) parts.push(cur)
  return parts
}

function clipSegment(p, q, b) {
  let t0 = 0
  let t1 = 1
  const dx = q[0] - p[0]
  const dy = q[1] - p[1]
  const checks = [
    [-dx, p[0] - b.x0],
    [dx, b.x1 - p[0]],
    [-dy, p[1] - b.y0],
    [dy, b.y1 - p[1]]
  ]
  for (const [pp, qq] of checks) {
    if (pp === 0) {
      if (qq < 0) return null
    } else {
      const t = qq / pp
      if (pp < 0) t0 = Math.max(t0, t)
      else t1 = Math.min(t1, t)
    }
  }
  if (t0 > t1) return null
  const at = (t) => [round1(p[0] + dx * t), round1(p[1] + dy * t)]
  return [at(t0), at(t1)]
}

const centroid = (ring) => {
  let cx = 0
  let cy = 0
  ring.forEach(([x, y]) => {
    cx += x
    cy += y
  })
  return [round1(cx / ring.length), round1(cy / ring.length)]
}

// ---------------------------------------------------------------- 主流程
const osm = await loadOsm()
const inBounds = (ring) =>
  ring.some(
    ([x, y]) => x > BOUNDS.x0 && x < BOUNDS.x1 && y > BOUNDS.y0 && y < BOUNDS.y1
  )

// 先找园区地块：判断「园区内的小建筑」要用到它
const campusEl = osm.elements.find(
  (e) => e.tags?.landuse === "commercial" && e.tags?.name === "天府国际金融中心"
)
if (!campusEl) throw new Error("没找到「天府国际金融中心」地块")
const campus = normRing(campusEl.geometry.map(toLocal))
const buildings = []
const roads = []
const areas = []
for (const e of osm.elements) {
  const t = e.tags || {}
  const pts = e.geometry.map(toLocal)
  if (e === campusEl) continue
  if (t.building) {
    const ring = normRing(pts)
    if (!inBounds(ring)) continue
    const meta = BUILDINGS[e.id]
    const c = centroid(ring)
    // 园区外的建筑不建（沙盘只保留园区本身与四周道路）
    if (!meta && !(c[0] > -50 && c[0] < 285 && c[1] > -398 && c[1] < 352))
      continue
    // 鹅卵石楼在 OSM 里把层数误填进了 height（12 / 9 / 2），按层数 × 层高换算
    const pebble = meta?.kind === "pebble"
    const levels =
      meta?.levels ??
      (pebble ? parseFloat(t.height) : parseInt(t["building:levels"])) ??
      1
    const height = pebble
      ? levels * FLOOR_H
      : parseFloat(t.height) || (levels || 1) * FLOOR_H
    buildings.push({
      key: meta?.key || `small_${e.id}`,
      osm: e.id,
      name: t.name || "",
      short: meta?.short || "",
      kind: meta?.kind || "small",
      levels,
      height: round1(meta?.kind === "hall" ? 16 : height),
      roof: t["roof:shape"]
        ? {
            shape: t["roof:shape"],
            direction: parseFloat(t["roof:direction"]) || 0,
            height: parseFloat(t["roof:height"]) || 0
          }
        : null,
      center: c,
      footprint: ring
    })
    continue
  }
  if (t.highway) {
    const width = ROAD_WIDTH[t.highway]
    if (!width) continue
    for (const part of clipPolyline(pts, BOUNDS)) {
      roads.push({
        kind: t.highway,
        name: t.name || "",
        width,
        oneway: t.oneway === "yes",
        points: part
      })
    }
    continue
  }
  const kind =
    t.natural === "water"
      ? "water"
      : t.landuse === "grass" || t.leisure === "garden"
        ? "grass"
        : t.leisure === "park"
          ? "park"
          : t.landuse === "recreation_ground"
            ? "grass"
            : null
  if (!kind) continue
  const clipped = clipPolygon(normRing(pts), BOUNDS)
  if (clipped) areas.push({ kind, name: t.name || "", ring: clipped })
}

// ---------------------------------------------------------------- 景观湖
function inRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

function segDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
  return Math.hypot(ax + t * dx - px, ay + t * dy - py)
}

/** 点到闭合环边界的距离 */
const ringDist = (p, ring) =>
  Math.min(...ring.map((a, i) => segDist(p, a, ring[(i + 1) % ring.length])))

/**
 * 在园区空地上放景观湖，返回 [{ center, r, ring }]。
 * 网格 4 m 采样每个点的「净空」（到楼体、路缘、已有水面、园区边界的最近距离），
 * 每次取净空最大的点放一个湖（半径 = 净空 - gap），再把这个湖当成障碍继续找
 */
function placeLakes() {
  const waters = areas.filter((a) => a.kind === "water").map((a) => a.ring)
  const obstacles = (p) => {
    let d = ringDist(p, campus)
    for (const b of buildings) {
      if (inRing(p, b.footprint)) return -1
      d = Math.min(d, ringDist(p, b.footprint))
    }
    for (const w of waters) {
      if (inRing(p, w)) return -1
      d = Math.min(d, ringDist(p, w))
    }
    for (const r of roads) {
      const half = r.width / 2 + (DRIVE_KINDS.has(r.kind) ? SIDEWALK : 0) + 1
      for (let i = 0; i < r.points.length - 1; i++)
        d = Math.min(d, segDist(p, r.points[i], r.points[i + 1]) - half)
    }
    return d
  }
  const xs = campus.map((p) => p[0])
  const ys = campus.map((p) => p[1])
  const cells = []
  for (let x = Math.min(...xs); x < Math.max(...xs); x += 4)
    for (let y = Math.min(...ys); y < Math.max(...ys); y += 4)
      if (inRing([x, y], campus))
        cells.push({ p: [x, y], d: obstacles([x, y]) })
  // 固定种子的伪随机：湖形每次生成都一样
  let seed = LAKES.seed
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const lakes = []
  while (lakes.length < LAKES.max) {
    let best = null
    for (const c of cells) {
      let d = c.d
      for (const l of lakes)
        d = Math.min(
          d,
          Math.hypot(c.p[0] - l.center[0], c.p[1] - l.center[1]) -
            l.r -
            LAKES.gap
        )
      if (!best || d > best.d) best = { p: c.p, d }
    }
    const r = Math.min(LAKES.maxR, best.d - LAKES.gap)
    if (r < LAKES.minR) break
    // 湖形：随机朝向的椭圆，长短轴比 0.6～0.85，周边叠两组低频起伏，像自然水岸
    const ang = rnd() * Math.PI
    const k = 0.6 + rnd() * 0.25
    const ph = [rnd() * 6.28, rnd() * 6.28]
    const ring = []
    for (let i = 0; i < 48; i++) {
      const t = (i / 48) * Math.PI * 2
      const wob =
        1 + 0.07 * Math.sin(2 * t + ph[0]) + 0.05 * Math.sin(3 * t + ph[1])
      const ex = Math.cos(t) * r * 0.94 * wob
      const ey = Math.sin(t) * r * k * 0.94 * wob
      ring.push([
        round1(best.p[0] + ex * Math.cos(ang) - ey * Math.sin(ang)),
        round1(best.p[1] + ex * Math.sin(ang) + ey * Math.cos(ang))
      ])
    }
    lakes.push({ center: best.p, r, ring })
  }
  return lakes
}

const lakes = placeLakes()
for (const l of lakes) {
  areas.push({
    kind: "water",
    name: "景观湖（示意）",
    designed: true,
    ring: l.ring
  })
  // 环湖步道：湖岸外扩 4.5 m 的闭合环（沿湖心方向外扩，湖形是星形，不会自交）
  const walk = l.ring.map(([x, y]) => {
    const dx = x - l.center[0]
    const dy = y - l.center[1]
    const d = Math.hypot(dx, dy) || 1
    return [round1(x + (dx / d) * 4.5), round1(y + (dy / d) * 4.5)]
  })
  roads.push({
    kind: "footway",
    name: "环湖步道",
    width: ROAD_WIDTH.footway,
    oneway: false,
    points: [...walk, walk[0]]
  })
}

const layout = {
  _doc: "由 scripts/build-park-layout.mjs 生成，请勿手改。本地米制坐标：原点为双子塔两楼中点，x 向东、y 向北。",
  origin: ORIGIN,
  bounds: BOUNDS,
  floorHeight: FLOOR_H,
  campus: clipPolygon(campus, BOUNDS),
  buildings,
  roads,
  areas
}
fs.mkdirSync(path.dirname(OUT_LAYOUT), { recursive: true })
fs.writeFileSync(OUT_LAYOUT, JSON.stringify(layout, null, 1))

// 前端用的楼栋清单（不含轮廓）：three.js 坐标 x = 东、z = 南，即 z = -y
const named = buildings
  .filter((b) => b.kind !== "small")
  .sort((a, b) => b.height - a.height || a.key.localeCompare(b.key))
  .map((b) => ({
    key: b.key,
    name: b.name,
    short: b.short,
    kind: b.kind,
    levels: b.levels,
    height: b.height,
    center: [b.center[0], -b.center[1]]
  }))
// 车流只跑在车行道上（不含园区内部的服务道路）
const drive = roads
  .filter((r) => DRIVE_KINDS.has(r.kind))
  .map((r) => ({
    kind: r.kind,
    width: r.width,
    oneway: r.oneway,
    points: r.points.map(([x, y]) => [x, -y])
  }))
// 园内步道 / 服务道路：只取园区地块范围内的
const PATH_KINDS = new Set([
  "service",
  "footway",
  "pedestrian",
  "path",
  "cycleway"
])
const paths = roads
  .filter((r) => PATH_KINDS.has(r.kind))
  .map((r) => r.points.map(([x, y]) => [x, -y]))
const body = `/*
 * 园区级楼栋清单（成都金融城双子塔 · 天府国际金融中心）
 * 由 scripts/build-park-layout.mjs 生成，请勿手改。数据来源：OpenStreetMap（© OpenStreetMap contributors，ODbL）。
 * center 为 three.js 坐标 [x 东, z 南]（米，原点为双子塔两楼中点）；key 与 park.glb 里的对象名 bld_<key> 对应。
 */
export const PARK_BUILDINGS = ${JSON.stringify(named, null, 2)}

/**
 * 行驶道路中心线（车流动画用）：three.js 坐标 [x, z]；oneway 为单行（OSM 点序即行驶方向），
 * 否则双向，两个方向各占半幅
 */
export const PARK_ROADS = ${JSON.stringify(drive)}

/** 园内步道与服务道路中心线（地灯沿线布置）：three.js 坐标 [x, z] */
export const PARK_PATHS = ${JSON.stringify(paths)}

/**
 * 双子塔单楼数据（楼宇级三维用）：footprint 为相对塔楼形心的 three.js 坐标 [x 东, z 南]（米），
 * roof 为斜切屋顶（OSM roof:direction 罗盘角、roof:height 高差）
 */
export const PARK_TOWERS = ${JSON.stringify(
  Object.fromEntries(
    buildings
      .filter((b) => b.kind === "tower")
      .map((b) => [
        b.key,
        {
          height: b.height,
          levels: b.levels,
          roof: b.roof,
          footprint: b.footprint.map(([x, y]) => [
            round1(x - b.center[0]),
            round1(-(y - b.center[1]))
          ])
        }
      ])
  )
)}

/** 水面（OSM 小水池 + 生成的景观湖）轮廓：three.js 坐标 [x, z]，实时端在烘焙地面上再叠一层反光水面 */
export const PARK_WATERS = ${JSON.stringify(areas.filter((a) => a.kind === "water").map((a) => a.ring.map(([x, y]) => [x, -y])))}

/** 沙盘范围（three.js 坐标：x 东西、z 南北，z = -y） */
export const PARK_BOUNDS = ${JSON.stringify({ x0: BOUNDS.x0, x1: BOUNDS.x1, z0: -BOUNDS.y1, z1: -BOUNDS.y0 })}
`
const prettier = await import("prettier")
const opts = (await prettier.resolveConfig(OUT_DATA)) || {}
fs.writeFileSync(
  OUT_DATA,
  await prettier.format(body, { ...opts, filepath: OUT_DATA })
)

console.log(
  `楼栋 ${buildings.length}（命名 ${named.length}），道路段 ${roads.length}，面 ${areas.length}，景观湖 ${lakes.length}`
)
lakes.forEach((l) => console.log("  湖", l.center, "r", round1(l.r)))
named.forEach((b) =>
  console.log(" ", b.key, b.short, b.levels + "F", b.height + "m", b.center)
)

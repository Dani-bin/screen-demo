/*
 * 数字楼宇（/building）城市级地图数据生成脚本
 * ----------------------------------------------------------
 * 城市级展示「成都高新区南区」：5 个街道立体挤出，周边成都区县做底图，
 * 南区内真实的超高层楼宇做点位，成都金融城双子塔作为可进入的园区。
 * 西区（合作、西园街道）在约 20 km 外的西北方，和南区放在一起地图中间空出一大片，城市级不展示。
 *
 * 输入（在线获取，首次运行后缓存到 node_modules/.cache/building-geo/，之后离线可重跑）：
 *   OSM 街道边界     polygons.openstreetmap.fr 按关系 id 导出 GeoJSON（相邻街道共用 OSM 的同一条边，坐标逐点一致）
 *   成都区县面       DataV GeoAtlas 510100_full / 510100
 *   高层楼宇         Overpass：带 name + height 的建筑（OSM 覆盖不全，只用作点位，不做统计）
 *
 * 输出：
 *   public/building/map/gaoxin.json          高新区 7 个街道面（properties: name / enName / zone / center）
 *   public/building/map/gaoxin-stroke.json   高新区外轮廓（由街道面推导，保证与街道边缘严丝合缝）
 *   public/building/map/chengdu.json         成都区县面（背景底图）
 *   src/views/building/data/mapData.js       投影参数、街道锚点、周边区县标签、高层楼宇点位
 *
 * 用法：node scripts/build-building-geo.mjs
 * 需要 Node 18+（内置 fetch）。Overpass 繁忙时会自动换镜像重试。
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const CACHE_DIR = path.join(ROOT, "node_modules/.cache/building-geo")
const PUBLIC_DIR = path.join(ROOT, "public/building/map")
const DATA_FILE = path.join(ROOT, "src/views/building/data/mapData.js")

/** 高新区南区街道：OSM 关系 id → 中文名 / 拼音 / 所属片区 */
const STREETS = [
  { id: 8732293, name: "桂溪街道", enName: "GUIXI", zone: "南区" },
  { id: 8732297, name: "中和街道", enName: "ZHONGHE", zone: "南区" },
  { id: 8732295, name: "石羊街道", enName: "SHIYANG", zone: "南区" },
  { id: 8732294, name: "肖家河街道", enName: "XIAOJIAHE", zone: "南区" },
  { id: 8732296, name: "芳草街街道", enName: "FANGCAOJIE", zone: "南区" }
]

/**
 * 周边区县标签：近处清晰、远处模糊。
 * 高新区在行政上与武侯 / 双流 / 郫都等区重叠（它是功能区，不是行政区），底图里这些区照常画，
 * 被立体的高新区盖住的部分自然看不见。武侯区的标签点正好落在南区上，不标；
 * 底图按到南区中心的距离淡出，十几公里外的区只做模糊点缀。
 */
const NEIGHBOR_STYLE = {
  锦江区: {},
  双流区: {},
  青羊区: { blur: true },
  成华区: { blur: true }
}

/** 双子塔：OSM 里南北两塔各是一条 way，名称含「双子塔」 */
const TWIN_KEYWORD = "双子塔"

/** 地图投影后的目标高度（世界单位），与参考项目射阳县地图保持同量级，相机参数可直接沿用 */
const TARGET_HEIGHT = 16.8

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
]

// ---------------------------------------------------------------- 工具
const round = (n, d) => Number(n.toFixed(d))
const roundRing = (ring, d) => ring.map(([x, y]) => [round(x, d), round(y, d)])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 带缓存的下载：缓存命中直接读文件；validate 不通过视为失败（如 Overpass 忙时返回的 HTML） */
async function cached(name, fetchers, validate = () => true) {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const file = path.join(CACHE_DIR, name)
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"))
  let lastErr = null
  // 每个来源最多试 3 轮，失败后递增等待
  for (let round = 0; round < 3; round++) {
    for (const fetcher of fetchers) {
      try {
        const text = await fetcher()
        const data = JSON.parse(text)
        if (!validate(data)) throw new Error("数据校验未通过")
        fs.writeFileSync(file, text)
        return data
      } catch (err) {
        lastErr = err
      }
    }
    await sleep(5000 * (round + 1))
  }
  throw new Error(`下载失败 ${name}: ${lastErr?.message}`)
}

const getText = async (url, init) => {
  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": "bi-demo-building/1.0",
      Accept: "*/*",
      ...init?.headers
    }
  })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.text()
}

const osmBoundary = (id) =>
  cached(`osm-${id}.json`, [
    () =>
      getText(
        `https://polygons.openstreetmap.fr/get_geojson.py?id=${id}&params=0`
      )
  ])

const datav = (code) =>
  cached(`datav-${code}.json`, [
    () => getText(`https://geo.datav.aliyun.com/areas_v3/bound/${code}.json`)
  ])

const overpass = (name, query) =>
  cached(
    name,
    OVERPASS.map(
      (url) => () =>
        getText(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(query)
        })
    ),
    (d) => Array.isArray(d.elements)
  )

/** 取几何体的所有多边形：[[外环, ...洞], ...] */
function polygonsOf(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates]
  if (geometry.type === "MultiPolygon") return geometry.coordinates
  if (geometry.type === "GeometryCollection")
    return geometry.geometries.flatMap(polygonsOf)
  return []
}

function ringArea(pts) {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[(i + 1) % pts.length]
    a += x0 * y1 - x1 * y0
  }
  return a / 2
}

function inRing(x, y, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

const inPolygons = (polys, x, y) =>
  polys.some(
    ([outer, ...holes]) =>
      inRing(x, y, outer) && !holes.some((h) => inRing(x, y, h))
  )

/**
 * 面内「最空旷」的点（离边界最远），用作柱子 / 标签锚点。
 * 质心在狭长、凹形的街道上可能贴边甚至落到面外，这里在包围盒里撒网格再逐级细化。
 * 经度按纬度余弦压缩，避免东西向距离被高估。
 */
function anchorOf(polys) {
  let best = polys[0]
  polys.forEach((p) => {
    if (Math.abs(ringArea(p[0])) > Math.abs(ringArea(best[0]))) best = p
  })
  const [outer] = best
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const [x, y] of outer) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  const kx = Math.cos((((minY + maxY) / 2) * Math.PI) / 180)
  const clearance = (x, y) => {
    if (!inPolygons([best], x, y)) return -1
    let d = Infinity
    for (const r of best) {
      for (let i = 0; i < r.length - 1; i++) {
        const [ax, ay] = r[i]
        const [bx, by] = r[i + 1]
        const dx = (bx - ax) * kx
        const dy = by - ay
        const len = dx * dx + dy * dy
        let t = len ? ((x - ax) * kx * dx + (y - ay) * dy) / len : 0
        t = Math.max(0, Math.min(1, t))
        d = Math.min(d, Math.hypot((ax - x) * kx + t * dx, ay - y + t * dy))
      }
    }
    return d
  }
  const N = 24
  let pick = [(minX + maxX) / 2, (minY + maxY) / 2]
  let pickD = -1
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const x = minX + ((maxX - minX) * i) / N
      const y = minY + ((maxY - minY) * j) / N
      const d = clearance(x, y)
      if (d > pickD) {
        pickD = d
        pick = [x, y]
      }
    }
  }
  // 逐级细化：在当前最优点周围以减半的步长继续找
  let sx = (maxX - minX) / N
  let sy = (maxY - minY) / N
  for (let pass = 0; pass < 5; pass++) {
    sx /= 2
    sy /= 2
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const x = pick[0] + i * sx
        const y = pick[1] + j * sy
        const d = clearance(x, y)
        if (d > pickD) {
          pickD = d
          pick = [x, y]
        }
      }
    }
  }
  return pick
}

/**
 * 从街道面推导外轮廓：相邻街道共用同一条边，只出现一次的边就是外边界，再首尾串成环。
 * 比直接用高新区关系的边界更可靠——两份数据只要有一点偏差，流光描边就会和街道边缘错开。
 */
function outlineFromPolygons(polysList) {
  const key = ([x, y]) => `${x.toFixed(7)},${y.toFixed(7)}`
  const edges = new Map()
  polysList.forEach((polys) =>
    polys.forEach((poly) =>
      poly.forEach((ring) => {
        for (let i = 0; i < ring.length - 1; i++) {
          const a = ring[i]
          const b = ring[i + 1]
          const ka = key(a)
          const kb = key(b)
          if (ka === kb) continue
          const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
          const e = edges.get(k)
          if (e) e.count++
          else edges.set(k, { a, b, ka, kb, count: 1 })
        }
      })
    )
  )
  const adj = new Map()
  const pt = new Map()
  edges.forEach((e) => {
    if (e.count !== 1) return
    pt.set(e.ka, e.a)
    pt.set(e.kb, e.b)
    if (!adj.has(e.ka)) adj.set(e.ka, [])
    if (!adj.has(e.kb)) adj.set(e.kb, [])
    adj.get(e.ka).push(e.kb)
    adj.get(e.kb).push(e.ka)
  })
  const rings = []
  const used = new Set()
  adj.forEach((_, start) => {
    if (used.has(start)) return
    const ring = [pt.get(start)]
    used.add(start)
    let cur = start
    for (;;) {
      const next = (adj.get(cur) || []).find((k) => !used.has(k))
      if (!next) break
      used.add(next)
      ring.push(pt.get(next))
      cur = next
    }
    ring.push(ring[0])
    // 小于 20 个点的碎环多半是两份边界在交界处的微小错位，丢掉
    if (ring.length >= 20) rings.push(ring)
  })
  return rings.sort((r1, r2) => r2.length - r1.length)
}

const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data))
  console.log(
    "写入",
    path.relative(ROOT, file),
    (fs.statSync(file).size / 1024).toFixed(0) + "KB"
  )
}

// ---------------------------------------------------------------- 1. 街道面
/**
 * 多边形面积（km²）：经纬度按所在纬度换算成米再用鞋带公式，街道尺度（几公里）下误差可忽略
 */
function areaKm2(polys) {
  const R = 6371.0088
  let total = 0
  for (const [outer, ...holes] of polys) {
    const lat0 = (outer[0][1] * Math.PI) / 180
    const toKm = (ring) =>
      ring.map(([lng, lat]) => [
        ((lng * Math.PI) / 180) * R * Math.cos(lat0),
        ((lat * Math.PI) / 180) * R
      ])
    total += Math.abs(ringArea(toKm(outer)))
    holes.forEach((h) => (total -= Math.abs(ringArea(toKm(h)))))
  }
  return total
}

const streetFeatures = []
for (const s of STREETS) {
  const geo = await osmBoundary(s.id)
  const polys = polygonsOf(geo).map((p) => p.map((r) => roundRing(r, 6)))
  const center = anchorOf(polys).map((n) => round(n, 6))
  streetFeatures.push({
    type: "Feature",
    properties: {
      name: s.name,
      enName: s.enName,
      zone: s.zone,
      area: round(areaKm2(polys), 1),
      center,
      centroid: center
    },
    geometry: { type: "MultiPolygon", coordinates: polys }
  })
  console.log("街道", s.name, polys.length, "块，锚点", center.join(","))
}
writeJson(path.join(PUBLIC_DIR, "gaoxin.json"), {
  type: "FeatureCollection",
  features: streetFeatures
})

// ---------------------------------------------------------------- 2. 外轮廓
const outlineRings = outlineFromPolygons(
  streetFeatures.map((f) => f.geometry.coordinates)
)
writeJson(path.join(PUBLIC_DIR, "gaoxin-stroke.json"), {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "成都高新区" },
      geometry: {
        type: "MultiPolygon",
        coordinates: outlineRings.map((r) => [r])
      }
    }
  ]
})
console.log("外轮廓", outlineRings.length, "个环")

// ---------------------------------------------------------------- 3. 成都区县底图
const chengdu = await datav("510100_full")
writeJson(path.join(PUBLIC_DIR, "chengdu.json"), {
  type: "FeatureCollection",
  features: chengdu.features.map((f) => ({
    type: "Feature",
    properties: {
      name: f.properties.name,
      center: f.properties.center,
      centroid: f.properties.centroid
    },
    geometry: {
      type: f.geometry.type,
      coordinates:
        f.geometry.type === "Polygon"
          ? f.geometry.coordinates.map((r) => roundRing(r, 5))
          : f.geometry.coordinates.map((p) => p.map((r) => roundRing(r, 5)))
    }
  }))
})
const neighbors = chengdu.features
  .filter((f) => NEIGHBOR_STYLE[f.properties.name])
  .map((f) => ({
    name: f.properties.name,
    center: f.properties.centroid || f.properties.center,
    ...NEIGHBOR_STYLE[f.properties.name]
  }))

// ---------------------------------------------------------------- 4. 高层楼宇点位
const towerQuery = (bbox) =>
  `[out:json][timeout:90];way["building"]["name"]["height"](${bbox});out tags center;`
const towerRaw = (
  await overpass("towers-south.json", towerQuery("30.52,103.99,30.63,104.13"))
).elements
const streetPolys = streetFeatures.map((f) => ({
  name: f.properties.name,
  polys: f.geometry.coordinates
}))
const streetOf = (lng, lat) =>
  streetPolys.find((s) => inPolygons(s.polys, lng, lat))?.name || null

// 同名建筑（如一栋楼拆成多段轮廓）只取最高的一段
const towerByName = new Map()
for (const e of towerRaw) {
  const height = parseFloat(e.tags.height)
  if (!(height > 0) || !e.center) continue
  const lng = round(e.center.lon, 6)
  const lat = round(e.center.lat, 6)
  const street = streetOf(lng, lat)
  if (!street) continue
  const t = {
    name: e.tags.name,
    height: Math.round(height),
    levels: parseInt(e.tags["building:levels"]) || null,
    center: [lng, lat],
    street
  }
  const old = towerByName.get(t.name)
  if (!old || old.height < t.height) towerByName.set(t.name, t)
}
const allTowers = [...towerByName.values()].sort((a, b) => b.height - a.height)
const twins = allTowers.filter((t) => t.name.includes(TWIN_KEYWORD))
if (twins.length < 2) throw new Error("没在 OSM 数据里找到双子塔的两栋楼")
// 高层点位：100 m 以上、去掉双子塔本身（双子塔单独作为园区标记）
const towers = allTowers.filter(
  (t) => t.height >= 100 && !t.name.includes(TWIN_KEYWORD)
)
console.log(
  "高层楼宇（≥100m）",
  towers.length,
  "栋；双子塔",
  twins.map((t) => t.name)
)

// ---------------------------------------------------------------- 5. 投影参数
let minLon = Infinity
let maxLon = -Infinity
let minLat = Infinity
let maxLat = -Infinity
streetFeatures.forEach((f) =>
  f.geometry.coordinates.forEach((p) =>
    p[0].forEach(([x, y]) => {
      minLon = Math.min(minLon, x)
      maxLon = Math.max(maxLon, x)
      minLat = Math.min(minLat, y)
      maxLat = Math.max(maxLat, y)
    })
  )
)
const rad = (d) => (d * Math.PI) / 180
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2))
const scale = Math.round(TARGET_HEIGHT / (mercY(maxLat) - mercY(minLat)))
const center = [
  round((minLon + maxLon) / 2, 6),
  round((minLat + maxLat) / 2, 6)
]
const mapConfig = {
  geoProjectionCenter: center,
  geoProjectionScale: scale,
  projectedWidth: round(rad(maxLon - minLon) * scale, 3),
  projectedHeight: round((mercY(maxLat) - mercY(minLat)) * scale, 3),
  bbox: [minLon, minLat, maxLon, maxLat].map((n) => round(n, 6))
}

// 双子塔园区：两塔中点作为园区锚点
const park = {
  name: "成都金融城双子塔",
  enName: "CHENGDU IFC TWIN TOWERS",
  street: twins[0].street,
  center: [
    round((twins[0].center[0] + twins[1].center[0]) / 2, 6),
    round((twins[0].center[1] + twins[1].center[1]) / 2, 6)
  ],
  towers: twins.map((t) => ({
    name: t.name,
    height: t.height,
    levels: t.levels,
    center: t.center
  }))
}

const header = `/*
 * 数字楼宇 城市级地图数据
 * 由 scripts/build-building-geo.mjs 生成，请勿手改。
 * 数据来源：OpenStreetMap（© OpenStreetMap contributors，ODbL）、DataV GeoAtlas。
 */
`
const body = [
  [
    "地图投影参数（墨卡托：中心经纬度 / 缩放；投影后的宽高，世界单位）",
    "MAP_CONFIG",
    mapConfig
  ],
  [
    "高新区街道：名称、拼音、片区、锚点（面内离边界最远的点）",
    "STREETS",
    streetFeatures.map((f) => f.properties)
  ],
  ["周边区县标签（blur: 远处模糊显示）", "NEIGHBORS", neighbors],
  ["园区：成都金融城双子塔（南北两塔，高度 / 层数取自 OSM）", "PARK", park],
  [
    "高新区内 100 m 以上的高层楼宇（OSM 有 name + height 的建筑，覆盖不全）",
    "TOWERS",
    towers
  ]
]
  .map(
    ([doc, name, data]) =>
      `/** ${doc} */\nexport const ${name} = ${JSON.stringify(data, null, 2)}\n`
  )
  .join("\n")
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
// 按仓库的 .prettierrc 格式化后再写，生成结果直接通过 ESLint（prettier 规则）
const prettier = await import("prettier")
const prettierOptions = (await prettier.resolveConfig(DATA_FILE)) || {}
fs.writeFileSync(
  DATA_FILE,
  await prettier.format(header + "\n" + body, {
    ...prettierOptions,
    filepath: DATA_FILE
  })
)
console.log("写入", path.relative(ROOT, DATA_FILE))
console.log("投影", mapConfig)

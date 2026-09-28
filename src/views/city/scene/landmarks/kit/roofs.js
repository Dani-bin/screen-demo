/*
 * 屋顶：悬山、庑殿 / 歇山（翘角、可截断成一圈檐）、n 边攒尖、宝顶
 * ----------------------------------------------------------
 * 全部在局部坐标：檐口在 y = 0（未起翘处）、中心在原点、屋脊沿 X。
 * 檐口外沿挂一圈竖直封檐板，下沿在 y = -thick（默认 max(0.08, 0.05h)），
 * 所以几何体最低点略低于 0；放到柱顶上时由 parts.js 按柱线处的屋面高度下移落位。
 *
 * 屋面是参数曲面。每个坡面由檐口线段 E(s) 与屋脊线段 R(s) 插值，
 * s ∈ [-1, 1] 沿檐口，t ∈ [0, tMax] 从檐口到屋脊：
 *   水平位置 P(s, t) = lerp(E(s), R(s), t)
 *   高度     y = h·t^pow + curl·h·s⁴·(1 − t)²
 * pow = 1.5 时檐口平缓、屋脊陡（凹曲面）；s⁴ 项只在坡面两端（四角）抬起，
 * 于是檐口线中段平直、到角部陡然上翘，角部沿戗脊先略降再升，形成翘角。
 * 相邻坡面在 s = ±1 处位置与高度完全相同，接缝严丝合缝。
 *
 * 每个坡面按 segS × segT 细分（默认 8 × 6，可用 opts 调）；有起翘时 s 方向向两端加密，
 * 翘角曲线更圆顺。
 * 坡面法线在各自网格内平滑，坡面之间（戗脊）保留折线。
 * 檐口加一圈竖直封檐板，屋面有厚度感；戗脊、正脊用细条压线。
 *
 * 每种屋顶有两个出口：
 *   xxxRoof(..., { ridges: true })  屋面 + 屋脊合成一个几何体（单色）
 *   xxxRoof(..., { ridges: false }) 只有屋面；屋脊另用 xxxRidges() 取，便于配不同颜色
 */
import { BufferAttribute, BufferGeometry } from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import {
  box,
  cylinder,
  fromTriangles,
  polygonVertex,
  sphere,
  sweepBar
} from "./shapes.js"

/* ---------------- 曲面公式 ---------------- */

/** 坡面高度：y(s, t) = h·t^pow + curl·h·s⁴·(1 − t)² */
export function roofHeight(s, t, h, curl, pow = 1.5) {
  const s2 = s * s
  const u = 1 - t
  return h * Math.pow(Math.max(0, t), pow) + curl * h * s2 * s2 * u * u
}

/** 均匀参数 u ∈ [-1, 1] → 向两端加密的 s（s 仍从 -1 到 1，端点不变） */
function biasS(u) {
  return Math.sign(u) * (1 - Math.pow(1 - Math.abs(u), 1.6))
}

const lerp = (a, b, t) => a + (b - a) * t

/**
 * 一个坡面。E0→E1 为檐口端点、R0→R1 为屋脊端点（[x, z]），
 * 顺序须使从上方看坡面在 E0→E1 的左侧（沿檐口逆时针绕屋顶一周）。
 * @returns {{ surface: BufferGeometry, eave: Array<[number, number, number]> }}
 *   surface 为平滑法线的非索引几何体，eave 为檐口线上的点（封檐板用）
 */
function slope(E0, E1, R0, R1, h, o) {
  const { curl, tMax, pow, segS, segT } = o
  const cols = segS + 1
  const pos = new Float32Array(cols * (segT + 1) * 3)
  const eave = []
  for (let j = 0; j <= segT; j++) {
    const t = (j / segT) * tMax
    for (let i = 0; i <= segS; i++) {
      const s = curl > 0 ? biasS(-1 + (2 * i) / segS) : -1 + (2 * i) / segS
      const a = (s + 1) / 2
      const ex = lerp(E0[0], E1[0], a)
      const ez = lerp(E0[1], E1[1], a)
      const rx = lerp(R0[0], R1[0], a)
      const rz = lerp(R0[1], R1[1], a)
      const x = lerp(ex, rx, t)
      const z = lerp(ez, rz, t)
      const y = roofHeight(s, t, h, curl, pow)
      pos.set([x, y, z], (j * cols + i) * 3)
      if (j === 0) eave.push([x, y, z])
    }
  }
  // 两个网格点重合（屋脊退化成一点时，最后一行全部重合）
  const same = (p, q) =>
    Math.abs(pos[p * 3] - pos[q * 3]) < 1e-9 &&
    Math.abs(pos[p * 3 + 1] - pos[q * 3 + 1]) < 1e-9 &&
    Math.abs(pos[p * 3 + 2] - pos[q * 3 + 2]) < 1e-9
  const index = []
  for (let j = 0; j < segT; j++) {
    for (let i = 0; i < segS; i++) {
      const a = j * cols + i
      const b = a + 1
      const c = a + cols + 1
      const d = a + cols
      // 跳过面积为 0 的三角形（有两个顶点重合），不白占三角形预算
      if (!same(a, b) && !same(b, c) && !same(a, c)) index.push(a, b, c)
      if (!same(a, c) && !same(c, d) && !same(a, d)) index.push(a, c, d)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute("position", new BufferAttribute(pos, 3))
  g.setIndex(index)
  // 索引网格上算法线 = 坡面内平滑；坡面之间不共享顶点，戗脊处保留折线
  g.computeVertexNormals()
  const surface = g.toNonIndexed()
  g.dispose()
  return { surface, eave }
}

/** 沿檐口线挂一圈竖直封檐板（厚度 th） */
function fascia(eave, th) {
  const pos = []
  for (let i = 0; i < eave.length - 1; i++) {
    const [x0, y0, z0] = eave[i]
    const [x1, y1, z1] = eave[i + 1]
    pos.push(x0, y0, z0, x0, y0 - th, z0, x1, y1 - th, z1)
    pos.push(x0, y0, z0, x1, y1 - th, z1, x1, y1, z1)
  }
  return fromTriangles(pos)
}

/** 合并若干非索引几何体并释放原件 */
function merge(list) {
  const parts = list.filter(Boolean)
  // 统一只保留 position / normal，mergeGeometries 要求属性一致
  for (const g of parts) {
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "normal") g.deleteAttribute(name)
    }
  }
  const out = mergeGeometries(parts)
  parts.forEach((g) => g.dispose())
  return out
}

/** 由坡面列表生成屋面（坡面 + 封檐板） */
function surfaceFromSlopes(defs, h, o) {
  const th = o.thick ?? Math.max(0.08, 0.05 * h)
  const list = []
  for (const [E0, E1, R0, R1] of defs) {
    const { surface, eave } = slope(E0, E1, R0, R1, h, o)
    list.push(surface, fascia(eave, th))
  }
  return merge(list)
}

/** 沿坡面 s = ±1 边（戗脊 / 垂脊）采样的折线 */
function hipLine(E, R, h, o) {
  const pts = []
  for (let j = 0; j <= o.segT; j++) {
    const t = (j / o.segT) * o.tMax
    pts.push([
      lerp(E[0], R[0], t),
      roofHeight(1, t, h, o.curl, o.pow),
      lerp(E[1], R[1], t)
    ])
  }
  return pts
}

/* ---------------- 四坡顶（庑殿 / 歇山） ---------------- */

function hipDefaults(opts) {
  return {
    overhang: 0.8,
    curl: 0.35,
    ridge: 0.5,
    tMax: 1,
    segS: 8,
    segT: 6,
    pow: 1.5,
    ridges: true,
    ...opts
  }
}

/** 四坡顶的四个坡面定义与关键尺寸 */
function hipLayout(w, d, o) {
  const ex = w / 2 + o.overhang
  const ez = d / 2 + o.overhang
  const rx = (o.ridge * w) / 2
  const defs = [
    [
      [-ex, ez],
      [ex, ez],
      [-rx, 0],
      [rx, 0]
    ], // 前坡（+Z，梯形）
    [
      [ex, ez],
      [ex, -ez],
      [rx, 0],
      [rx, 0]
    ], // 右坡（+X，三角形）
    [
      [ex, -ez],
      [-ex, -ez],
      [rx, 0],
      [-rx, 0]
    ], // 后坡（-Z，梯形）
    [
      [-ex, -ez],
      [-ex, ez],
      [-rx, 0],
      [-rx, 0]
    ] // 左坡（-X，三角形）
  ]
  return { ex, ez, rx, defs }
}

/**
 * 四坡顶（庑殿 / 歇山）。w × d 为檐柱围合尺寸，檐口矩形 (w + 2o) × (d + 2o)，
 * 屋脊沿 X、长 ridge × w（ridge 小为庑殿感、0.5～0.65 为歇山感）。
 * tMax < 1 时截断成一圈檐（重檐下层），此时不加正脊。
 * @param {object} [opts] { overhang=0.8, curl=0.35, ridge=0.5, tMax=1, segS=8, segT=6, ridges=true, thick }
 * @returns {BufferGeometry}
 */
export function hipRoof(w, d, h, opts = {}) {
  const o = hipDefaults(opts)
  const { defs } = hipLayout(w, d, o)
  const surface = surfaceFromSlopes(defs, h, o)
  if (!o.ridges) return surface
  return merge([surface, hipRidges(w, d, h, opts)])
}

/**
 * 四坡顶的屋脊：四条戗脊 + 正脊（高 0.08h、宽 0.06d）+ 脊端两个上翘的吻兽块。
 * 参数与 hipRoof 相同；tMax < 1 时只有戗脊。
 */
export function hipRidges(w, d, h, opts = {}) {
  const o = hipDefaults(opts)
  const { defs, rx } = hipLayout(w, d, o)
  const bw = Math.max(0.12, 0.035 * d)
  const bh = Math.max(0.1, 0.04 * h)
  const list = defs.map(([E0, , R0]) =>
    sweepBar(hipLine(E0, R0, h, o), bw, bh, { sink: bh * 0.5 })
  )
  if (o.tMax >= 1) {
    const rh = 0.08 * h
    const rw = 0.06 * d
    const bar = box(2 * rx + rw, rh + 0.02 * h, rw)
    bar.translate(0, h - 0.02 * h, 0)
    list.push(bar)
    // 脊端吻兽：比正脊高出一截的方块，略向内收
    for (const sx of [-1, 1]) {
      const k = box(rw * 1.2, rh * 1.6, rw * 1.2)
      k.translate(sx * rx, h - 0.02 * h, 0)
      list.push(k)
    }
  }
  return merge(list)
}

/* ---------------- 双坡悬山 ---------------- */

function gableDefaults(opts) {
  return {
    overhang: 0.6,
    sag: 1.3,
    segS: 2,
    segT: 6,
    ridges: true,
    gables: true,
    ...opts
  }
}

/**
 * 双坡悬山顶：w × d 为墙体围合尺寸，屋脊沿 X；四周出檐 overhang（山墙端也出挑）。
 * 坡面按曲面公式（无起翘，指数 sag），两端 x = ±w/2 处补竖直山墙三角，屋脊加正脊。
 * @param {object} [opts] { overhang=0.6, sag=1.3, ridges=true, gables=true, thick }
 *   gables 为 false 时不含山墙（用 gableWalls 另取，配墙体颜色）
 */
export function gableRoof(w, d, h, opts = {}) {
  const o = gableDefaults(opts)
  const ex = w / 2 + o.overhang
  const ez = d / 2 + o.overhang
  const so = { curl: 0, tMax: 1, pow: o.sag, segS: o.segS, segT: o.segT }
  so.thick = o.thick
  const defs = [
    [
      [-ex, ez],
      [ex, ez],
      [-ex, 0],
      [ex, 0]
    ],
    [
      [ex, -ez],
      [-ex, -ez],
      [ex, 0],
      [-ex, 0]
    ]
  ]
  const th = o.thick ?? Math.max(0.08, 0.05 * h)
  const list = [surfaceFromSlopes(defs, h, so)]
  // 山墙端的博风板：沿两坡端边挂一道竖直板
  for (const sx of [-ex, ex]) {
    for (const sz of [-1, 1]) {
      const pts = []
      for (let j = 0; j <= o.segT; j++) {
        const t = j / o.segT
        pts.push([sx, roofHeight(0, t, h, 0, o.sag), sz * ez * (1 - t)])
      }
      list.push(fascia(pts, th))
    }
  }
  if (o.gables) list.push(gableWalls(w, d, h, opts))
  if (o.ridges) list.push(gableRidge(w, d, h, opts))
  return merge(list)
}

/**
 * 悬山顶两端的山墙：x = ±w/2 处的竖直面，下沿 y = 0、z ∈ [-d/2, d/2]，上沿贴着屋面曲线。
 * 参数与 gableRoof 相同。
 */
export function gableWalls(w, d, h, opts = {}) {
  const o = gableDefaults(opts)
  const ez = d / 2 + o.overhang
  const n = o.segT * 2
  const pos = []
  for (const x of [-w / 2, w / 2]) {
    // 以底边中点为扇心，上沿按屋面曲线取点（z 从 d/2 到 -d/2）
    const top = []
    for (let i = 0; i <= n; i++) {
      const z = d / 2 - (d * i) / n
      const t = 1 - Math.abs(z) / ez
      top.push([z, roofHeight(0, t, h, 0, o.sag)])
    }
    const poly = [[d / 2, 0], ...top, [-d / 2, 0]]
    for (let i = 1; i < poly.length - 1; i++) {
      pos.push(
        x,
        0,
        0,
        x,
        poly[i][1],
        poly[i][0],
        x,
        poly[i + 1][1],
        poly[i + 1][0]
      )
    }
    // 下沿两个角到扇心
    pos.push(x, 0, 0, x, 0, d / 2, x, top[0][1], top[0][0])
    pos.push(x, 0, 0, x, top[n][1], top[n][0], x, 0, -d / 2)
  }
  return fromTriangles(pos)
}

/** 悬山顶正脊：沿 X 贯通（含出檐），高 0.08h、宽 max(0.2, 0.05d) */
export function gableRidge(w, d, h, opts = {}) {
  const o = gableDefaults(opts)
  const len = w + 2 * o.overhang
  const rh = Math.max(0.15, 0.08 * h)
  const rw = Math.max(0.2, 0.05 * d)
  const bar = box(len, rh + 0.03 * h, rw)
  bar.translate(0, h - 0.03 * h, 0)
  return bar
}

/* ---------------- n 边攒尖 ---------------- */

function pyramidDefaults(opts) {
  return {
    overhang: 0.8,
    curl: 0.45,
    tMax: 1,
    segS: 8,
    segT: 6,
    pow: 1.5,
    ridges: true,
    ...opts
  }
}

function pyramidDefs(sides, radius, o) {
  const R = radius + o.overhang
  const defs = []
  for (let k = 0; k < sides; k++) {
    defs.push([
      polygonVertex(sides, R, k),
      polygonVertex(sides, R, k + 1),
      [0, 0],
      [0, 0]
    ])
  }
  return defs
}

/**
 * n 边攒尖顶：檐口为外接半径 radius + overhang 的正 n 边形（朝向见 shapes.js：
 * 一条边正对 +Z），屋脊退化为顶点 (0, h, 0)。tMax < 1 时截断成一圈檐。
 * @param {object} [opts] { overhang=0.8, curl=0.45, tMax=1, segS=8, segT=6, ridges=true, thick }
 */
export function pyramidRoof(sides, radius, h, opts = {}) {
  const o = pyramidDefaults(opts)
  const surface = surfaceFromSlopes(pyramidDefs(sides, radius, o), h, o)
  if (!o.ridges) return surface
  return merge([surface, pyramidRidges(sides, radius, h, opts)])
}

/** 攒尖顶的 n 条垂脊（参数同 pyramidRoof）；到顶点前收住，顶点留给宝顶 */
export function pyramidRidges(sides, radius, h, opts = {}) {
  const o = pyramidDefaults(opts)
  const R = radius + o.overhang
  const bw = Math.max(0.08, 0.05 * R)
  const bh = Math.max(0.06, 0.04 * h)
  // 垂脊止于 t = 0.92（顶点处条带会挤成一团）
  const lo = { ...o, tMax: Math.min(o.tMax, 0.92) }
  const list = []
  for (let k = 0; k < sides; k++) {
    const E = polygonVertex(sides, R, k)
    list.push(sweepBar(hipLine(E, [0, 0], h, lo), bw, bh, { sink: bh * 0.5 }))
  }
  return merge(list)
}

/* ---------------- 宝顶与屋脊条 ---------------- */

/**
 * 宝顶：底座小圆柱 + 两个球 + 尖锥，底在 y = 0，总高 h。
 */
export function finial(h) {
  const base = cylinder(0.16 * h, 0.12 * h, 0.16 * h, {
    segments: 10,
    caps: true
  })
  const ball1 = sphere(0.17 * h, 12, 8)
  ball1.translate(0, 0.13 * h, 0) // 球心 0.3h
  const ball2 = sphere(0.11 * h, 10, 6)
  ball2.translate(0, 0.46 * h, 0) // 球心 0.57h
  const cone = cylinder(0.07 * h, 0, 0.36 * h, { segments: 8 })
  cone.translate(0, 0.64 * h, 0)
  return merge([base, ball1, ball2, cone])
}

/** 独立屋脊条：长 len（沿 X）、高 h、宽 w（沿 Z），底在 y = 0、水平居中 */
export function ridgeBar(len, h, w) {
  return box(len, h, w)
}

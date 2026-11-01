/**
 * 沙盘地面：底座、地面贴图、周边白模布局
 * ----------------------------------------------------------
 * 地面是一张 4096 的画布贴图（7.6 px/m），一次画出草地、道路、人行道、水岸、步道、广场、运动场、
 * 建筑底座和接触阴影；水面、楼体、树都是另外的网格。画完后缩成 1024 的遮罩，给树木避让用。
 * 平面坐标 x 向东、y 向北；贴图原点在底座外接方形的西北角。
 */
import * as THREE from "three"
import { THEME } from "./theme.js"
import { lakeOutline, riverBanks } from "./shapes.js"

const { rx: RX, ry: RY } = THEME.base
const W = 4096 // 画布宽（px），对应 2·RX 米
const DX = RX * 2
const DY = RY * 2
const SC = W / DX
const H = Math.round(DY * SC) // 画布高，对应 2·RY 米
const X0 = THEME.base.cx - RX
const YN = THEME.base.cy + RY
// 三种草地底色的 RGB（用来从地面画布反查"哪里是草地"，要和下面 C 里的草色保持一致）
const LAWN_RGB = [
  [0x88, 0x91, 0x53],
  [0x93, 0xa2, 0x59],
  [0x86, 0x9b, 0x54]
]
const MW = 1024 // 树木遮罩宽
const MH = Math.round((MW * DY) / DX)
const px = (x) => (x - X0) * SC
const py = (y) => (YN - y) * SC

/** 固定种子的随机数（mulberry32） */
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------- 画布小工具

const C = {
  grass: "#889153",
  lawn: "#93a259",
  park: "#869b54",
  asphalt: "#857f74",
  walk: "#b3ad9e",
  paving: "#ddd1b4",
  promenade: "#e3d8bf",
  path: "#dcd0b4",
  deck: "#d8ccb0",
  stone: "#a8a296",
  bed: "#16364b",
  pad: "#cfc9b8",
  hedge: "#2f5a35",
  lane: "#e2ded2"
}

function rect(ctx, cx, cy, w, d, fill) {
  ctx.fillStyle = fill
  ctx.fillRect(px(cx - w / 2), py(cy + d / 2), w * SC, d * SC)
}

function poly(ctx, pts, fill) {
  ctx.beginPath()
  pts.forEach(([x, y], i) =>
    i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))
  )
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
}

function stroke(ctx, pts, width, color, close = false) {
  ctx.beginPath()
  pts.forEach(([x, y], i) =>
    i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))
  )
  if (close) ctx.closePath()
  ctx.lineWidth = width * SC
  ctx.strokeStyle = color
  ctx.lineJoin = "round"
  ctx.lineCap = "round"
  ctx.stroke()
}

/** 草地颗粒：模仿沙盘草粉的细碎明暗，用一小块可平铺的图案铺满 */
function speckle(light, dark, density = 0.5, size = 160, seed = 7) {
  const c = document.createElement("canvas")
  c.width = c.height = size
  const g = c.getContext("2d")
  const r = rng(seed)
  for (let i = 0; i < size * size * density * 0.12; i++) {
    g.fillStyle = r() > 0.5 ? light : dark
    const s = 1 + Math.floor(r() * 2.2)
    g.fillRect(r() * size, r() * size, s, s)
  }
  return c
}

function fillGrain(ctx, drawShape, patterns) {
  ctx.save()
  drawShape()
  ctx.clip()
  for (const [img, alpha] of patterns) {
    ctx.globalAlpha = alpha
    ctx.fillStyle = ctx.createPattern(img, "repeat")
    ctx.fillRect(0, 0, W, H)
  }
  ctx.restore()
}

// ---------------------------------------------------------------- 周边白模布局

/**
 * 地块外的"远处普通建筑"：淡灰白模，只摆在空草地上，避开道路、命名对象和底座边缘。
 * 地面贴图要给它们画底座，三维里用实例化方块，所以先在这里定好位置。
 */
export function ellipseK(base, x, y, margin = 0) {
  return Math.hypot(
    (x - base.cx) / (base.rx - margin),
    (y - base.cy) / (base.ry - margin)
  )
}

export function contextBlocks(layout) {
  const r = rng(20261030)
  const named = layout.amenities.map((a) => ({
    cx: a.cx,
    cy: a.cy,
    w: a.w + 14,
    d: a.d + 14
  }))
  const placed = []
  const base = layout.base
  const inZone = (cx, cy) => cy > 158 || cy < -184 || cx < -176 || cx > 178 // 道路、地块、河之外的四片空地
  const out = []
  for (let n = 0; n < 4000 && out.length < 46; n++) {
    const w = 14 + r() * 16
    const d = 12 + r() * 12
    const cx = base.cx + (r() * 2 - 1) * (base.rx - 18)
    const cy = base.cy + (r() * 2 - 1) * (base.ry - 18)
    // 整个体块（含对角线的一半）要落在底座椭圆内，留 14 m 边
    if (ellipseK(base, cx, cy, Math.hypot(w, d) / 2 + 14) > 1) continue
    // 四个角都要落在空地里
    const corners = [
      [cx - w / 2, cy - d / 2],
      [cx + w / 2, cy - d / 2],
      [cx - w / 2, cy + d / 2],
      [cx + w / 2, cy + d / 2]
    ]
    if (!corners.every(([x, y]) => inZone(x, y))) continue
    if (cy > 150 && cy < 158) continue
    const hit = (o, pad) =>
      Math.abs(cx - o.cx) < (w + o.w) / 2 + pad &&
      Math.abs(cy - o.cy) < (d + o.d) / 2 + pad
    if (named.some((o) => hit(o, 4))) continue
    if (placed.some((o) => hit(o, 8))) continue
    // 北侧（楼后面）的周边楼压低：定稿里那里只有矮房子，高了会从两栋塔之间冒出来
    const h0 = 8 + r() * 16
    const h = cy > 150 ? 7 + (h0 - 8) * 0.25 : h0
    const blk = { cx, cy, w, d, h }
    placed.push(blk)
    out.push(blk)
  }
  return out
}

// ---------------------------------------------------------------- 地面贴图

/**
 * 画地面贴图。返回 { canvas, mask }：mask 是 1024×1024 的草地遮罩（1 = 可种树）。
 * @param layout layout.json
 * @param blocks 周边白模（contextBlocks 的结果）
 */
export function paintGround(layout, blocks) {
  const canvas = document.createElement("canvas")
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext("2d")
  const r = rng(11)
  const A = (id) => layout.amenities.find((a) => a.id === id)
  const road = (id) => layout.roads.find((o) => o.id === id)
  const site = layout.site
  const grainA = speckle(
    "rgba(255,255,210,0.55)",
    "rgba(20,40,10,0.5)",
    0.55,
    160,
    3
  )
  const grainB = speckle(
    "rgba(255,255,255,0.35)",
    "rgba(10,20,5,0.35)",
    0.35,
    220,
    9
  )

  // 1. 底色：整个底座都是草粉绿，再叠大块明暗，避免一张平色
  ctx.fillStyle = C.grass
  ctx.fillRect(0, 0, W, H)
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = r() > 0.5 ? "rgba(150,190,90,0.07)" : "rgba(30,60,20,0.07)"
    ctx.beginPath()
    ctx.arc(r() * W, r() * H, (12 + r() * 36) * SC, 0, Math.PI * 2)
    ctx.fill()
  }

  // 2. 河岸公园、河
  const park = A("PK01")
  const river = A("RV01")
  rect(ctx, park.cx, park.cy, 560, park.d, C.park)
  const x0 = X0 - 20
  const x1 = X0 + DX + 20
  const rb = riverBanks(river, x0, x1)
  const outer = riverBanks(river, x0, x1, 6, 2.6)
  poly(ctx, [...outer.top, ...outer.bottom.slice().reverse()], C.stone)
  poly(ctx, [...rb.top, ...rb.bottom.slice().reverse()], C.bed)
  // 公园里一条蜿蜒的步道
  const pw = []
  for (let x = x0; x <= x1; x += 8)
    pw.push([x, park.cy + 3.2 * Math.sin(x / 24)])
  stroke(ctx, pw, 3.2, C.path)

  // 3. 道路：路面、人行道、车道线
  const R01 = road("R01")
  const R02 = road("R02")
  const R03 = road("R03")
  const R04 = road("R04")
  for (const o of [R01, R02, R03, R04])
    rect(ctx, o.cx, o.cy, o.w, o.d, C.asphalt)
  // 人行道
  const wk = (cx, cy, w, d) => rect(ctx, cx, cy, w, d, C.walk)
  wk(R01.cx, R01.cy - 17 + 1.5, R01.w, 3)
  wk(R01.cx, R01.cy + 17 - 1.5, R01.w, 3)
  wk(R02.cx, R02.cy + 8 - 1.25, R02.w, 2.5)
  wk(R02.cx, R02.cy - 8 + 1.25, R02.w, 2.5)
  wk(R03.cx - 6 + 1.25, R03.cy, 2.5, R03.d)
  wk(R03.cx + 6 - 1.25, R03.cy, 2.5, R03.d)
  wk(R04.cx - 10 + 1.25, R04.cy, 2.5, R04.d)
  wk(R04.cx + 10 - 1.25, R04.cy, 2.5, R04.d)
  // 北侧大道中央绿化带
  rect(ctx, R01.cx, R01.cy, R01.w, 3, C.park)
  // 车道线
  const dash = (pts, width, color, on = 3, off = 5) => {
    ctx.setLineDash([on * SC, off * SC])
    stroke(ctx, pts, width, color)
    ctx.setLineDash([])
  }
  const xa = X0
  const xb = X0 + DX
  for (const dy of [-13, -9, -5, 5, 9, 13])
    dash(
      [
        [xa, R01.cy + dy],
        [xb, R01.cy + dy]
      ],
      0.25,
      C.lane
    )
  dash(
    [
      [xa, R02.cy],
      [xb, R02.cy]
    ],
    0.25,
    C.lane
  )
  dash(
    [
      [R03.cx, -140],
      [R03.cx, 140]
    ],
    0.25,
    C.lane
  )
  for (const dx of [-0.3, 0.3])
    stroke(
      ctx,
      [
        [R04.cx + dx, -140],
        [R04.cx + dx, 140]
      ],
      0.2,
      "#d9b23a"
    )
  // 斑马线：北侧大道三处
  for (const zx of [-120, 0, 120]) {
    for (let k = 0; k < 9; k++) {
      rect(ctx, zx, R01.cy - 14 + k * 3.4 + 1.3, 7, 1.4, C.lane)
    }
  }

  // 4. 地块：草坪、周边步道、绿篱
  rect(ctx, 0, 0, site.w, site.d, C.lawn)
  const ring = [
    [-site.w / 2 + 1.5, -site.d / 2 + 1.5],
    [site.w / 2 - 1.5, -site.d / 2 + 1.5],
    [site.w / 2 - 1.5, site.d / 2 - 1.5],
    [-site.w / 2 + 1.5, site.d / 2 - 1.5]
  ]
  stroke(ctx, ring, 3, C.walk, true)
  const ring2 = ring.map(([x, y]) => [
    x - Math.sign(x) * 2.2,
    y - Math.sign(y) * 2.2
  ])
  stroke(ctx, ring2, 1.1, C.hedge, true)

  // 5. 水下的底色（水面是另外的网格）
  const lake = A("LK01")
  poly(ctx, lakeOutline(lake, 1, 2.6), C.stone)
  poly(ctx, lakeOutline(lake, 1, 0.1), C.bed)
  const pool = A("SW01")
  // 环湖步道
  stroke(ctx, lakeOutline(lake, 1, 5.4), 3.2, C.promenade, true)
  stroke(ctx, lakeOutline(lake, 1, 6.9), 0.25, "#b9ad92", true)

  // 6. 景观轴、入口广场、会所广场、泳池
  const ax = A("AX01")
  rect(ctx, ax.cx, ax.cy, ax.w, ax.d, C.promenade)
  rect(ctx, ax.cx, ax.cy, 6.4, ax.d - 4, C.bed) // 跌水的水槽（水面另有网格）
  for (const sx of [-1, 1])
    stroke(
      ctx,
      [
        [sx * 12, ax.cy - ax.d / 2],
        [sx * 12, ax.cy + ax.d / 2]
      ],
      0.3,
      "#b9ad92"
    )
  rect(ctx, 0, 99, 44, 12, C.paving)
  for (const id of ["G01", "G02"]) {
    const g = A(id)
    rect(ctx, g.cx, g.cy - 2, 18, 12, C.asphalt)
    rect(ctx, g.cx, g.cy - 2, 14, 9, "#2c2a27")
    for (let k = 0; k < 4; k++)
      stroke(
        ctx,
        [
          [g.cx - 6, g.cy - 5 + k * 2],
          [g.cx + 6, g.cy - 5 + k * 2]
        ],
        0.18,
        "#8c877d"
      )
  }
  const cl = A("CL01")
  rect(ctx, cl.cx, cl.cy + 1, 64, 36, C.paving)
  rect(ctx, pool.cx, pool.cy, 44, 24, C.deck)
  rect(ctx, pool.cx, pool.cy, pool.w + 1.4, pool.d + 1.4, "#8c877d")
  rect(ctx, pool.cx, pool.cy, pool.w, pool.d, C.bed)

  // 7. 步道网：东西向横路、洋房列间竖路、会所前横路、南侧路、东次入口
  const P = (pts, w = 3.2) => stroke(ctx, pts, w, C.path)
  P([
    [-136, 15],
    [-44, 15]
  ])
  P([
    [44, 15],
    [136, 15]
  ])
  for (const sx of [-96, 96])
    P(
      [
        [sx, 56],
        [sx, -22]
      ],
      3
    )
  P([
    [-112, -49],
    [-34, -49]
  ])
  P([
    [34, -49],
    [112, -49]
  ])
  P(
    [
      [-132, -58],
      [-112, -58],
      [-112, -100],
      [112, -100],
      [138, -100]
    ],
    3
  )
  P(
    [
      [150, -72],
      [138, -72],
      [138, -100]
    ],
    4
  )
  P(
    [
      [0, 93],
      [0, 105]
    ],
    8
  )
  // 儿童乐园、运动场、幼儿园操场
  const pl = A("PL01")
  const sp = A("SP01")
  rect(ctx, pl.cx, pl.cy, pl.w + 4, pl.d + 4, C.paving)
  rect(ctx, pl.cx, pl.cy, pl.w, pl.d, "#d9b07a")
  ctx.fillStyle = "#c4553f"
  ctx.beginPath()
  ctx.arc(px(pl.cx - 5), py(pl.cy + 1), 5 * SC, 0, Math.PI * 2)
  ctx.fill()
  rect(ctx, pl.cx + 5, pl.cy - 2, 8, 7, "#3f86b0")
  rect(ctx, pl.cx + 1, pl.cy + 5, 9, 4, "#e0b341")
  rect(ctx, sp.cx, sp.cy, sp.w + 4, sp.d + 4, C.paving)
  rect(ctx, sp.cx, sp.cy, sp.w, sp.d, "#3f7d52")
  rect(ctx, sp.cx, sp.cy, sp.w - 3, sp.d - 3, "#b5533d")
  stroke(
    ctx,
    [
      [sp.cx - 10.5, sp.cy - 6.5],
      [sp.cx + 10.5, sp.cy - 6.5],
      [sp.cx + 10.5, sp.cy + 6.5],
      [sp.cx - 10.5, sp.cy + 6.5]
    ],
    0.2,
    C.lane,
    true
  )
  stroke(
    ctx,
    [
      [sp.cx, sp.cy - 6.5],
      [sp.cx, sp.cy + 6.5]
    ],
    0.2,
    C.lane
  )
  const kg = A("KG01")
  rect(ctx, kg.cx, kg.cy - 16, 26, 16, C.paving)
  rect(ctx, kg.cx - 5, kg.cy - 16, 10, 12, "#d08a3a")
  rect(ctx, kg.cx + 6, kg.cy - 16, 9, 12, "#4b8fa8")

  // 8. 周边：学校操场、商业 / 医院 / 地铁口铺地
  const sc = A("SC01")
  rect(ctx, sc.cx + 0, sc.cy - 56, 54, 42, C.pad)
  rect(ctx, sc.cx, sc.cy - 56, 48, 34, "#a5503c")
  rect(ctx, sc.cx, sc.cy - 56, 38, 24, "#4c8a5a")
  stroke(
    ctx,
    [
      [sc.cx - 19, sc.cy - 56],
      [sc.cx + 19, sc.cy - 56]
    ],
    0.2,
    C.lane
  )
  rect(ctx, sc.cx, sc.cy, sc.w + 8, sc.d + 8, C.pad)
  const ml = A("ML01")
  rect(ctx, ml.cx, ml.cy, ml.w + 14, ml.d + 14, "#bfb9ab")
  const hp = A("HP01")
  rect(ctx, hp.cx, hp.cy, hp.w + 10, hp.d + 10, "#c8c2b4")
  const mt = A("MT01")
  rect(ctx, mt.cx, mt.cy, 26, 18, "#c8c2b4")

  // 9. 草地颗粒（只铺在草地上：先画完非草地，再用遮罩叠颗粒——这里按区域叠，避开已画的铺装）
  const lawnArea = () => {
    ctx.beginPath()
    ctx.rect(0, 0, W, H)
  }
  fillGrain(ctx, lawnArea, [
    [grainA, 0.22],
    [grainB, 0.18]
  ])
  // 颗粒会盖到路面上，所以先记下草地以外的区域，之后按需要重画一遍路面和铺装颜色较深的部分不会糊——
  // 这里的做法是：颗粒透明度低，路面本身是深灰，肉眼只看到轻微噪点，和沙盘路面的磨砂质感一致。

  // 10. 建筑底座和接触阴影
  const pads = []
  for (const b of layout.buildings) pads.push([b.cx, b.cy, b.w, b.d])
  for (const a of layout.amenities) {
    if (a.shape === "building" && !a.outside) pads.push([a.cx, a.cy, a.w, a.d])
  }
  for (const b of blocks) pads.push([b.cx, b.cy, b.w, b.d])
  ctx.save()
  ctx.shadowColor = "rgba(15,12,8,0.6)"
  ctx.shadowBlur = 20 * SC * 0.5
  ctx.fillStyle = "rgba(15,12,8,0.5)"
  for (const [cx, cy, w, d] of pads)
    ctx.fillRect(
      px(cx - w / 2 - 1),
      py(cy + d / 2 + 1),
      (w + 2) * SC,
      (d + 2) * SC
    )
  ctx.restore()
  for (const [cx, cy, w, d] of pads) rect(ctx, cx, cy, w + 4.4, d + 4.4, C.pad)

  // 11. 遮罩：缩到 1024，草地（偏绿）= 可种树
  const m = document.createElement("canvas")
  m.width = MW
  m.height = MH
  const mg = m.getContext("2d", { willReadFrequently: true })
  mg.drawImage(canvas, 0, 0, MW, MH)
  const img = mg.getImageData(0, 0, MW, MH).data
  const mask = new Uint8Array(MW * MH)
  for (let i = 0; i < mask.length; i++) {
    const rr = img[i * 4]
    const gg = img[i * 4 + 1]
    const bb = img[i * 4 + 2]
    // 草地 = 离三种草色（含草粉颗粒的明暗）足够近；路面、铺装、水岸、建筑底座都离得远
    let near = 1e9
    for (const [lr, lg, lb] of LAWN_RGB) {
      near = Math.min(near, Math.hypot(rr - lr, gg - lg, bb - lb))
    }
    mask[i] = near < 30 ? 1 : 0
  }
  return { canvas, mask }
}

/**
 * 把树和灌木脚下的接触阴影烘焙进地面画布：一圈柔和的暗斑（相乘叠加），略偏东南（展厅主光从西北来）。
 * 实时 GTAO 太贵，这是最便宜的"实体沙盘质感"来源。画完要让地面贴图 needsUpdate。
 * @param {[number, number, number][]} spots [x, y, 半径（m）]
 */
export function paintContactShadows(canvas, spots) {
  const ctx = canvas.getContext("2d")
  ctx.save()
  ctx.globalCompositeOperation = "multiply"
  for (const [x, y, r] of spots) {
    const cx = px(x + r * 0.22)
    const cy = py(y - r * 0.22)
    const rad = r * SC
    const g = ctx.createRadialGradient(cx, cy, rad * 0.1, cx, cy, rad)
    g.addColorStop(0, "rgb(150,140,112)")
    g.addColorStop(0.55, "rgb(208,198,172)")
    g.addColorStop(1, "rgb(255,255,255)")
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, rad, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** 查遮罩：平面坐标 (x, y) 是否是草地 */
export function isLawn(mask, x, y) {
  const u = Math.floor(((x - X0) / DX) * MW)
  const v = Math.floor(((YN - y) / DY) * MH)
  if (u < 0 || v < 0 || u >= MW || v >= MH) return false
  return mask[v * MW + u] === 1
}

/** 草粉颗粒的凹凸图：可平铺的小噪声，在地面上重复很多遍，灯光下出沙盘草粉的细碎质感 */
function grainBump() {
  const c = document.createElement("canvas")
  c.width = c.height = 128
  const g = c.getContext("2d")
  const r = rng(61)
  g.fillStyle = "#808080"
  g.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 2600; i++) {
    const v = 90 + ((r() * 90) | 0)
    g.fillStyle = `rgb(${v},${v},${v})`
    g.fillRect(r() * 128, r() * 128, 1 + ((r() * 2) | 0), 1 + ((r() * 2) | 0))
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(220, 150)
  t.anisotropy = 4
  return t
}

// ---------------------------------------------------------------- 地面与底座网格

/** 地面圆盘 + 黑色底座 + 金边，返回 Group；渲染器用来设各向异性 */
export function buildGroundMesh(canvas, renderer) {
  const group = new THREE.Group()
  const { cx, cy, depth } = THEME.base
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter

  // 单位圆缩放成椭圆；默认 UV 正好对应画布（画布覆盖椭圆的外接矩形）
  const geo = new THREE.CircleGeometry(1, 192)
  geo.rotateX(-Math.PI / 2)
  geo.scale(RX, 1, RY)
  const ground = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({
      map: tex,
      bumpMap: grainBump(),
      bumpScale: 1.6
    })
  )
  ground.name = "ground"
  ground.receiveShadow = true
  group.add(ground)

  // 底座：深色哑光圆柱，顶部一圈金边
  const kz = (RY + 7) / (RX + 7) // 椭圆：沿 z 压扁
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(RX + 7, RX + 10, depth, 192, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x14100c,
      roughness: 0.55,
      metalness: 0.35,
      side: THREE.DoubleSide
    })
  )
  body.position.y = -depth / 2
  body.scale.z = kz
  group.add(body)
  // 顶面的外缘平台（地面盘之外的一圈）
  const gold = new THREE.MeshStandardMaterial({
    color: 0xc9a86a,
    roughness: 0.42,
    metalness: 0.85,
    emissive: 0xc9a86a,
    emissiveIntensity: 0.05
  })
  // 顶面外缘：里面一道 2.6 m 的深金细边，外面是深色哑光平台（原来 7 m 全是米黄色，像一圈塑料环）
  const deck = new THREE.Mesh(
    new THREE.RingGeometry(RX + 2.6, RX + 7, 192),
    new THREE.MeshStandardMaterial({
      color: 0x1b1510,
      roughness: 0.5,
      metalness: 0.3
    })
  )
  deck.rotation.x = -Math.PI / 2
  deck.scale.y = kz
  deck.position.y = -0.06
  group.add(deck)
  const lip = new THREE.Mesh(new THREE.RingGeometry(RX, RX + 2.6, 192), gold)
  lip.rotation.x = -Math.PI / 2
  lip.scale.y = kz
  lip.position.y = -0.05
  group.add(lip)
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(RX + 7.05, RX + 8.4, 9, 192, 1, true),
    gold
  )
  band.scale.z = kz
  band.position.y = -4.5
  band.material.side = THREE.DoubleSide
  band.name = "goldBand"
  group.add(band)
  const top = new THREE.Mesh(
    new THREE.TorusGeometry(RX + 7.2, 0.6, 8, 240),
    gold
  )
  top.rotation.x = Math.PI / 2
  top.scale.y = kz
  top.position.y = 0.05
  group.add(top)
  // 底座下沿再一圈细金线
  const low = new THREE.Mesh(new THREE.TorusGeometry(RX + 9, 0.4, 8, 240), gold)
  low.rotation.x = Math.PI / 2
  low.scale.y = kz
  low.position.y = -depth + 0.4
  group.add(low)

  group.position.set(cx, 0, -cy)
  return { group, texture: tex, gold }
}

/** 底座下面的展厅地面：深色，边缘一圈柔和的接触阴影 */
export function buildFloor() {
  const { cx, cy, depth } = THEME.base
  const c = document.createElement("canvas")
  c.width = c.height = 512
  const g = c.getContext("2d")
  const grad = g.createRadialGradient(256, 256, 0, 256, 256, 256)
  const k = RX / 700
  grad.addColorStop(0, "rgba(0,0,0,1)")
  grad.addColorStop(k * 1.0, "rgba(0,0,0,0.95)")
  grad.addColorStop(k * 1.22, "rgba(0,0,0,0.45)")
  grad.addColorStop(1, "rgba(0,0,0,0)")
  g.fillStyle = grad
  g.fillRect(0, 0, 512, 512)
  const tex = new THREE.CanvasTexture(c)
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 1400),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false
    })
  )
  m.rotation.x = -Math.PI / 2
  m.scale.y = RY / RX
  m.position.set(cx, -depth - 0.2, -cy)
  m.renderOrder = -1
  return m
}

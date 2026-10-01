/*
 * 熊猫基地 · 太阳产房、月亮产房与吊桥
 * ----------------------------------------------------------
 * 规格：设计文档 4.10（太阳产房：环形主楼、门厅、6 个放射状扇形院、小卖亭）、
 * 4.11（月亮产房：外环挤出、内凹面观察窗带、内院 3 个扇形活动场、开口处低墙 + 参观平台、东南吊桥）、
 * 4.12（熊猫摆放表第 1～3、11 行）。影像：sat_sun_z18（白色环形平屋面、中庭有树、西北侧门厅）、
 * sat_moon_z18（被树冠遮住，只认得出月牙轮廓）。扇形院、内院为调研推定（文档第 7 节），按推定值做。
 * 高度：两座产房的墙与屋面板按文档写成世界 y（墙顶 6.3、屋面板顶 6.6）；墙体一律自城市地面 GROUND_Y 立起。
 * 净距：太阳产房的门厅、扇形院外弧、小卖亭都按参观环 sunLoop（步行路径第 4 条，可走带宽 2.4）留够
 * 人流分部件净距；吊桥立柱让开月亮产房参观道 moonLoop 的末端（步行路径第 6 条止于西桥头）。
 */
import { PlaneGeometry } from "three"
import { THEME } from "../../theme.js"
import { GROUND_Y } from "../../terrain.js"
import { frame, local } from "../kit/builder.js"
import { addTree } from "../kit/figures.js"
import {
  circlePolygon,
  clipHalfPlane,
  distToSegment,
  insetPolygon,
  rectPolygon
} from "../kit/footprint.js"
import { box, extrudePolygon, fromTriangles, ribbon } from "../kit/shapes.js"
import {
  PLATE_OFF,
  facadeBands,
  facades,
  flatBlock,
  flatFace,
  sideWalls
} from "./blocks.js"
import { pathById } from "./ground.js"
import {
  C,
  F_PAVE,
  F_SOLID,
  F_WALK,
  LAWN_Y,
  MOON_LL,
  PATH_Y,
  PAVE_Y,
  YARD_Y
} from "./site.js"
import {
  MOAT,
  addClimbPanda,
  addLog,
  addMoat,
  addPerch,
  addSitPanda,
  arcPts,
  polar,
  radialWall,
  ringSector
} from "./yards.js"

const L = THEME.landmark
const DEG = Math.PI / 180

/* ---------------- 太阳产房（way 613349756） ---------------- */

/*
 * 环形主楼：圆心为 OSM 轮廓的拟合圆心，外墙半径 rOut、中庭半径 rIn（影像中庭直径约 20 m）。
 * 外墙 24 边形（每段 15°，正好与扇形院的分界 15° + 45°k 对齐）、中庭 12 边形；
 * 屋面板外沿出挑到 roofOut（6.3 → 6.6 的一圈板边），中庭一侧不出挑（墙直接到 6.6）。
 * 外墙 band 高度一圈深色观察窗：每段墙一块，西北门厅一侧（285°～15°）不开
 */
const SUN = {
  c: [7203.5, -9130.0],
  rOut: 23.2,
  rIn: 10,
  seg: 24,
  segIn: 12,
  wallTop: 6.3,
  roofTop: 6.6,
  roofOut: 23.6,
  band: [2.2, 4.4],
  // 中庭大树（影像中庭有树）：细分 1
  courtTree: { r: 5.2, color: C.forest[0] }
}
/*
 * 放射状扇形院：6 个，各宽 45°，自 15° 顺时针排到 285°（中心方位 37.5°…262.5°），半径 rIn～rOut；
 * 合成一个 C 形活动场（一个草地洞），扇与扇之间、两端各一道径向隔墙；外弧做院墙 + 木栏 + 绿篱
 * （参观环一侧），内弧贴着环楼外的一圈草地，不做墙。外弧 18 段（每段 15°）、内弧同。
 * 外弧最外的绿篱外沿 rOut + 1.46 = 35.46，离参观环中线 ≥ 4.3 m（参观环在扇形院方位上离圆心 ≥ 39.8 m）
 */
const SUN_YARD = { rIn: 25, rOut: 34, b0: 15, span: 270, n: 18, parts: 6 }
/*
 * 门厅：文档给的平顶盒子 x 7178～7190、z −9160～−9139.5（南沿比文档的 −9137 收进 2.5 m，
 * 离 285° 的扇形院端墙 ≥ 2 m），再按参观环各段向内退 clear 米裁掉压到参观环的西北角
 * （文档原盒子的西北角有约 5 m 落在参观环上）。clear = 可走带半宽 1.2 + 身体净距 0.86 + 余量
 */
const FOYER = { x: [7178, 7190], z: [-9160, -9139.5], top: 5.5, clear: 2.7 }
/*
 * 小卖亭（丰容工坊、礼品屋等，OSM 节点在参观环北侧外）：木构 3 × 3、檐高 3.5，深灰四坡小顶。
 * [x, z, 长边方位]：都在参观环外侧、离中线 6.2～7.1 m（亭身最近角离可走带边 ≥ 2.8 m），方位顺着环
 */
const KIOSKS = [
  [7184.0, -9168.5, 58],
  [7168.0, -9156.5, 42],
  [7158.0, -9145.0, 25]
]
const KIOSK = { w: 3, top: LAWN_Y + 3.5, roof: 1.1, eaves: 0.35 }
/*
 * 正北入口小路 306455477：自参观环 (7199.2, −9170) 起，按 OSM 走向延长到环楼外墙（OSM 止于墙外 4 m）
 */
const SUN_ENTRY = {
  pts: [
    [7199.2, -9170.0],
    [7203.3, -9153.6]
  ],
  w: 2.4
}
/*
 * 栖架 2 座（只有上层台：扇形院径向只有 9 m，双层栖架放不下），ladder 为爬梯伸出的方位（顺着院的切向，
 * 爬梯落脚点留在院内）；院 2 的栖架上趴着第 2 只熊猫。
 * 熊猫（4.12 第 1～3 行）：院 3 成年坐姿、院 4 幼崽坐姿，场地顶 YARD_Y
 */
const SUN_PERCHES = [
  { at: [7232.7, -9133.9], ladder: 172.5, panda: true }, // 院 2（#2 趴架）
  { at: [7185.5, -9106.6], ladder: 127.5, panda: false } // 院 5
]
const SUN_PANDAS = [
  { at: [7226.9, -9112.0], h: 6.5 }, // #1 院 3
  { at: [7207.4, -9100.8], h: 3.8 } // #3 院 4 幼崽
]

/** 环楼：外墙、中庭墙、屋面板（顶面 + 外沿板边）、外墙观察窗带 */
function addSunRing(site) {
  const b = site.b
  const s = SUN
  // circlePolygon 第 k 点自正东起、俯看顺时针转 k·360/n（方位 90° + k·360/n）：24 / 12 边形的顶点
  // 都在 15° 的整数倍方位上，与扇形院分界对齐
  const outer = circlePolygon(s.c[0], s.c[1], s.rOut, s.seg)
  const inner = circlePolygon(s.c[0], s.c[1], s.rIn, s.segIn)
  const roof = circlePolygon(s.c[0], s.c[1], s.roofOut, s.seg)
  site.solid(roof)
  b.add(sideWalls(outer, GROUND_Y, s.wallTop), C.nurseryWall)
  b.add(sideWalls(inner, GROUND_Y, s.roofTop, true), C.nurseryWall)
  b.add(flatFace(roof, [inner], s.roofTop), C.nurseryRoof)
  b.add(sideWalls(roof, s.wallTop, s.roofTop), C.nurseryRoof)
  // 观察窗：外法向在 150° ± 135°（即 15°～285°，扇形院一侧）的墙面，每面两端各收 0.3 m
  facadeBands(b, outer, {
    y0: s.band[0],
    y1: s.band[1],
    end: 0.3,
    facing: 150,
    spread: 135
  })
  addTree(b, s.c[0], LAWN_Y, s.c[1], {
    r: s.courtTree.r,
    color: s.courtTree.color,
    detail: 1
  })
}

/** 放射状扇形院：一个 C 形草地洞 + 外弧院墙 / 木栏 / 绿篱 + 7 道径向墙（两端 + 5 道隔墙） */
function addSunYards(site) {
  const b = site.b
  const y = SUN_YARD
  const c = SUN.c
  site.addYard(ringSector(c, y.rIn, y.rOut, y.b0, y.span, y.n, y.n))
  addMoat(b, (d) => arcPts(c, y.rOut + d, y.b0, y.span, y.n), false)
  const step = y.span / y.parts
  for (let k = 0; k <= y.parts; k++) {
    // 径向墙自内弧以内 0.25 m（埋进环楼外的草地坡）到外弧墙里
    radialWall(b, c, y.b0 + k * step, y.rIn - 0.25, y.rOut + 0.3)
  }
  // 院墙与绿篱占地（整个 C 形外扩到绿篱外沿）
  site.solid(
    ringSector(c, y.rIn, y.rOut + MOAT.hedgeOut, y.b0, y.span, y.n, y.n)
  )
}

/** 门厅：文档矩形按参观环各段向内退 FOYER.clear 裁角，平顶白墙、朝西北入口一面玻璃 */
function addSunFoyer(site) {
  const f = FOYER
  let poly = rectPolygon(
    (f.x[0] + f.x[1]) / 2,
    (f.z[0] + f.z[1]) / 2,
    f.z[1] - f.z[0],
    f.x[1] - f.x[0],
    0
  )
  const loop = pathById(site, "sunLoop").pts
  const [cx, cz] = SUN.c
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]
    const q = loop[(i + 1) % loop.length]
    // 只用离门厅近的段：远处的段延长线可能切到门厅（参观环并不严格是凸的）
    if (Math.min(...poly.map(([x, z]) => distToSegment(x, z, a, q))) > 8) {
      continue
    }
    const l = Math.hypot(q[0] - a[0], q[1] - a[1])
    // 该段的左右法向里指向产房圆心一侧的那个（参观环内侧）
    let n = [-(q[1] - a[1]) / l, (q[0] - a[0]) / l]
    if ((cx - a[0]) * n[0] + (cz - a[1]) * n[1] < 0) n = [-n[0], -n[1]]
    poly = clipHalfPlane(
      poly,
      [a[0] + n[0] * f.clear, a[1] + n[1] * f.clear],
      n
    )
  }
  site.solid(poly)
  flatBlock(site.b, poly, {
    top: f.top,
    wall: C.nurseryWall,
    roof: C.nurseryRoof,
    parapet: 0.4,
    inset: 0.35
  })
  facadeBands(site.b, poly, {
    y0: LAWN_Y + 0.3,
    y1: f.top - 1.2,
    color: L.glass,
    minLen: 3,
    end: 0.5,
    facing: 300,
    best: true
  })
}

/** 小卖亭：原木墙小盒子 + 四棱锥小顶 */
function addKiosks(site) {
  const k = KIOSK
  for (const [x, z, bearing] of KIOSKS) {
    const F = frame(x, GROUND_Y, z, bearing)
    site.b.add(box(k.w, k.top - GROUND_Y, k.w), C.cabinLog, F)
    // 四棱锥小顶：底边比亭身每边出挑 eaves（4 个三角形）
    const a = k.w / 2 + k.eaves
    const y = k.top - GROUND_Y
    const c4 = [
      [-a, -a],
      [a, -a],
      [a, a],
      [-a, a]
    ]
    const pos = []
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = c4[i]
      const [x1, z1] = c4[(i + 1) % 4]
      pos.push(x0, y, z0, x1, y, z1, 0, y + k.roof, 0)
    }
    site.b.add(fromTriangles(pos), L.roof, F)
    site.solid(rectPolygon(x, z, k.w, k.w, bearing))
  }
}

/** 正北入口小路：次级步道高度、路面带进地面批，打 F_PAVE */
function addSunEntry(site) {
  const e = SUN_ENTRY
  site.gb.add(ribbon(e.pts, e.w, PATH_Y - 0.15, PATH_Y), C.path)
  site.grid.stampLine(e.pts, Math.max(0.71, e.w / 2), F_PAVE)
}

function buildSunNursery(site) {
  addSunRing(site)
  addSunFoyer(site)
  addSunYards(site)
  addKiosks(site)
  addSunEntry(site)
  for (const p of SUN_PERCHES) {
    const r = addPerch(site.b, p.at[0], YARD_Y, p.at[1], {
      single: true,
      ladder: p.ladder
    })
    if (p.panda) addClimbPanda(site.b, r.anchor)
  }
  for (const p of SUN_PANDAS) {
    addSitPanda(site.b, p.at[0], YARD_Y, p.at[1], p.h)
  }
}

/* ---------------- 月亮产房（way 1229850749） ---------------- */

/*
 * 外环：附录 B 的 31 点常量（MOON_LL），挤出到 wallTop，白墙；屋面板为轮廓外扩 roofOut、6.3 → 6.6。
 * 内凹面（朝院心的一侧，r ≈ 30.5）一圈深色观察窗带：外法向指向拟合圆心的墙面，每面两端收 0.3 m。
 * 内环 1229850750 已在替换区里被隐藏，不建（文档：疑为内圈矮廊或误画）
 */
const MOON = {
  c: [6828.7, -9335.8],
  wallTop: 6.3,
  roofTop: 6.6,
  roofOut: 0.4,
  band: [2.2, 4.4]
}
/*
 * 内院（文档推定）：3 个扇形活动场，方位 260° 经北顺时针到 100°（共 200°）平分三份，半径 8～27；
 * 合成一个 C 形草地洞。外弧（离环楼内墙约 3.5 m 的后场）与内弧（院心一块草地）只做院墙
 * （无游客一侧，不做绿篱与木栏），两端与两道隔墙为径向墙。
 * 开口处（南，128°～215°）：一块参观平台（铺装 PAVE_Y，沿两个月牙尖之间的弦）+ 平台朝院一侧的白色低墙
 */
const MOON_YARD = { rIn: 8, rOut: 27, b0: 260, span: 200, n: 16, nIn: 8 }
// 内院半径（环楼内凹面 r ≈ 30.5 以内）
const MOON_COURT = 30
const MOON_PLATFORM = {
  at: [6833.3, -9306.0],
  len: 26,
  dep: 5,
  bearing: 80.6, // 两个月牙内尖连线的方位
  wall: { h: 1.2, t: 0.4 }
}
/*
 * 栖架：院 2（正北那一份）中部一座双层栖架。
 * 熊猫（4.12 第 11 行）：表中坐标 (6829, −9322) 落在内院南侧开口里（方位 179°、离圆心 13.8 m），
 * 不在本节推定的 3 个扇形院内（260° 经北到 100°）；挪进院 1 靠开口的一端（方位 275°、r 17：
 * 脚朝机位伸出约 3 m 也离 260° 的端墙 ≥ 1.6 m），仍是「母子熊猫在南侧开口附近」，
 * 从到站机位经开口看得见。第 12 行（幼崽）按决策去掉
 */
const MOON_PERCH = { b: 0, r: 17.5 }
const MOON_PANDA = { b: 275, r: 17, h: 6.5 }
/*
 * 吊桥（way 1222937420，OSM 18 m，layer=1）：西桥头 = 参观道 moonLoop 末点。桥面板顶 1.0（比步道高 3 cm），
 * 两端各一对立柱（离桥头 postIn 米、离桥面中线 postOff 米：西头一对离 moonLoop 可走带边 ≥ 1 m），
 * 两根缆索自柱顶垂到桥中（竖直细带，4 段）
 */
const BRIDGE = {
  a: [6818.2, -9285.2],
  b: [6830.8, -9272.8],
  w: 2.4,
  top: 1.0,
  thick: 0.2,
  postIn: 1.2,
  postOff: 1.4,
  postR: 0.16,
  postTop: 2.7,
  sag: 1.0,
  cable: 0.1
}

/** 外环：白墙、屋面板、内凹面观察窗带 */
function addMoonRing(site, ring) {
  const b = site.b
  const m = MOON
  site.solid(ring)
  b.add(sideWalls(ring, GROUND_Y, m.wallTop), C.nurseryWall)
  const slab = insetPolygon(ring, -m.roofOut)
  b.add(flatFace(slab, [], m.roofTop), C.nurseryRoof)
  b.add(sideWalls(slab, m.wallTop, m.roofTop), C.nurseryRoof)
  for (const f of facades(ring)) {
    if (f.len < 3) continue
    const mx = (f.a[0] + f.b[0]) / 2
    const mz = (f.a[1] + f.b[1]) / 2
    const tx = m.c[0] - mx
    const tz = m.c[1] - mz
    // 外法向与指向圆心的方向夹角 < 45°：内凹面
    if (f.n[0] * tx + f.n[1] * tz < 0.7 * Math.hypot(tx, tz)) continue
    b.add(
      new PlaneGeometry(f.len - 0.6, m.band[1] - m.band[0]),
      C.windowBand,
      local(f.m, f.len / 2, (m.band[0] + m.band[1]) / 2, PLATE_OFF)
    )
  }
}

/** 内院三个扇形活动场：C 形草地洞、外弧与内弧院墙、两端与两道隔墙、一座栖架、一只熊猫 */
function addMoonYards(site) {
  const b = site.b
  const y = MOON_YARD
  const c = MOON.c
  const hole = ringSector(c, y.rIn, y.rOut, y.b0, y.span, y.n, y.nIn)
  site.addYard(hole)
  site.solid(hole)
  // 整个内院（环楼内墙以内）打 F_WALK 作视线走廊：后续种树种竹不进，开口处的熊猫与院墙不被树冠挡住
  // （同 gate.js 铜像脸前的做法）
  site.grid.fillPoly(circlePolygon(c[0], c[1], MOON_COURT, 24), F_WALK)
  addMoat(b, (d) => arcPts(c, y.rOut + d, y.b0, y.span, y.n), false, {
    hedge: false,
    rail: false
  })
  // 内弧的「外」是朝院心（半径变小）
  addMoat(b, (d) => arcPts(c, y.rIn - d, y.b0, y.span, y.nIn), false, {
    hedge: false,
    rail: false
  })
  for (let k = 0; k <= 3; k++) {
    radialWall(b, c, y.b0 + (k * y.span) / 3, y.rIn - 0.3, y.rOut + 0.3)
  }
  const [px, pz] = polar(c, MOON_PERCH.r, MOON_PERCH.b)
  addPerch(b, px, YARD_Y, pz)
  const [qx, qz] = polar(c, MOON_PANDA.r, MOON_PANDA.b)
  addSitPanda(b, qx, YARD_Y, qz, MOON_PANDA.h)
}

/** 开口处参观平台（地面批铺装，打 F_PAVE）+ 平台朝院一侧（北沿）的白色低墙 */
function addMoonPlatform(site) {
  const p = MOON_PLATFORM
  const poly = rectPolygon(p.at[0], p.at[1], p.len, p.dep, p.bearing)
  site.gb.add(extrudePolygon(poly, [], GROUND_Y, PAVE_Y), C.plaza)
  site.grid.fillPoly(poly, F_PAVE)
  // 北沿：长边方位 80.6°，北沿两端 = 中心 ± 长边半长，再向北（方位 bearing − 90）挪半个进深
  const u = [Math.sin(p.bearing * DEG), -Math.cos(p.bearing * DEG)]
  const n = [
    Math.sin((p.bearing - 90) * DEG),
    -Math.cos((p.bearing - 90) * DEG)
  ]
  const off = p.dep / 2 - p.wall.t / 2
  const e0 = [
    p.at[0] - (u[0] * p.len) / 2 + n[0] * off,
    p.at[1] - (u[1] * p.len) / 2 + n[1] * off
  ]
  const e1 = [
    p.at[0] + (u[0] * p.len) / 2 + n[0] * off,
    p.at[1] + (u[1] * p.len) / 2 + n[1] * off
  ]
  const dx = e1[0] - e0[0]
  const dz = e1[1] - e0[1]
  const bearing = Math.atan2(dx, -dz) / DEG
  site.b.add(
    box(Math.hypot(dx, dz), PAVE_Y + p.wall.h - GROUND_Y, p.wall.t),
    C.nurseryWall,
    frame((e0[0] + e1[0]) / 2, GROUND_Y, (e0[1] + e1[1]) / 2, bearing - 90)
  )
  site.grid.stampLine([e0, e1], 0.8, F_SOLID)
}

/** 吊桥：桥面板 + 两对立柱 + 两根垂下的缆索 */
function addBridge(site) {
  const g = BRIDGE
  const b = site.b
  const dx = g.b[0] - g.a[0]
  const dz = g.b[1] - g.a[1]
  const len = Math.hypot(dx, dz)
  const t = [dx / len, dz / len]
  const n = [-t[1], t[0]]
  const bearing = Math.atan2(dx, -dz) / DEG
  const mid = [(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2]
  b.add(
    box(len, g.thick, g.w),
    C.deck,
    frame(mid[0], g.top - g.thick, mid[1], bearing - 90)
  )
  const at = (s, side) => [
    g.a[0] + t[0] * s + n[0] * side,
    g.a[1] + t[1] * s + n[1] * side
  ]
  for (const side of [-g.postOff, g.postOff]) {
    const s0 = g.postIn
    const s1 = len - g.postIn
    for (const s of [s0, s1]) {
      const [x, z] = at(s, side)
      addLog(b, [x, LAWN_Y - 0.05, z], [x, g.postTop, z], g.postR, C.perchDark)
    }
    // 缆索：自两端柱顶垂到桥中，抛物线 4 段，竖直细带
    const pos = []
    const N = 4
    const pt = (k) => {
      const u = k / N
      const [x, z] = at(s0 + (s1 - s0) * u, side)
      return [x, g.postTop - 0.1 - g.sag * 4 * u * (1 - u), z]
    }
    for (let k = 0; k < N; k++) {
      const [px, py, pz] = pt(k)
      const [qx, qy, qz] = pt(k + 1)
      const lo = g.cable
      pos.push(px, py - lo, pz, qx, qy - lo, qz, qx, qy, qz)
      pos.push(px, py - lo, pz, qx, qy, qz, px, py, pz)
    }
    b.add(fromTriangles(pos), C.railWood)
  }
  site.grid.stampLine([g.a, g.b], g.w / 2 + 0.3, F_PAVE)
}

function buildMoonNursery(site) {
  const ring = site.ll(MOON_LL)
  addMoonRing(site, ring)
  addMoonYards(site)
  addMoonPlatform(site)
  addBridge(site)
}

/** 太阳产房、月亮产房（含吊桥）。在 buildLake 之后、别墅之前调用 */
export function buildNurseries(site) {
  buildSunNursery(site)
  buildMoonNursery(site)
}

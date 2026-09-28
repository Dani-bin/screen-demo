/*
 * 春熙路·太古里 · 大慈寺精细模型
 * ----------------------------------------------------------
 * 老城网格约偏北向东 30°。三部分：
 *   1. 太古里街区：以站点（Apple Store）为中心、长边沿 30° 的 370 × 360 矩形，
 *      加上大慈寺东侧同一街坊的一小块矩形（太古里北段环抱寺院），
 *      区内低于 25 m 的 OSM 楼改成深灰坡屋顶店铺（深木格栅为主 / 少量白灰墙，
 *      长边贴通高玻璃带，出檐 1.8～2 m）。
 *      IFS（塔楼与裙楼，由 ifs.js 负责）紧邻街区北侧，名称含「IFS」或落在 IFS 裙楼轮廓内的楼一律跳过；
 *      25 m 以上的楼留给通用层。
 *   2. 大慈寺：各殿按名称就近查楼（大雄宝殿、藏经楼与文殊院重名，必须带 near），
 *      用单檐歇山殿堂重建；按全部殿堂的外接矩形外扩 8 m 围一圈红墙（灰瓦墙帽），
 *      正面（西南）对着弥勒殿开山门；院内铺装、放生池、种树；
 *      弥勒殿 OSM 轮廓是凹字形（前殿 + 两翼厢房），殿只建在前殿那一条上，两翼另建低矮厢房；
 *      院内其余 OSM 楼（僧寮、廊房等，OSM 高度普遍偏高，如观音殿标 28 m）改成白墙灰瓦的附属房。
 *   3. 北糠市街字库：六角两层青砖小塔。
 * 替换区 zones 只列「真正重建了的楼」各自的轮廓，没重建的楼不会被误删。
 * 店铺墙体默认取切块的外接矩形；外接矩形比轮廓大太多、或会压到保留的通用楼时，
 * 墙体改回轮廓（屋顶仍盖外接矩形），避免新墙伸进旁边没替换的楼里。
 */
import { Mesh } from "three"
import { ColorBuilder, frame, landmarkMaterial, local } from "./kit/builder.js"
import {
  clipHalfPlane,
  findBuilding,
  minAreaRect,
  polygonArea,
  rectFrame,
  rectPolygon
} from "./kit/footprint.js"
import { box, prism } from "./kit/shapes.js"
import { gableRidge, gableRoof, gableWalls, roofHeight } from "./kit/roofs.js"
import { addHall, addPagoda, housePieces } from "./kit/parts.js"
import { addTree } from "./kit/figures.js"
import { extrudeBuilding } from "../buildings.js"
import {
  mulberry32,
  pointInPolygon,
  polygonBounds,
  polygonCenter
} from "../utils.js"

const DEG = Math.PI / 180

/* ---------------- 太古里街区参数 ---------------- */

// 替换区矩形（站点坐标系：u 沿方位 30°、v 沿 120°，原点在站点）：
// 主街区 370 × 360；东北块为大慈寺东侧同一街坊（u 185～310、v −100～30），
// 再往东南（v > 30）那排较高的楼保留通用方盒
const DISTRICT_BEARING = 30
const DISTRICTS = [
  { u: 0, v: 0, w: 370, d: 360 },
  { u: 247.5, v: -35, w: 125, d: 130 }
]
// 只替换低于这个高度的 OSM 楼
const LOW_MAX = 25
// 名称含这些字的楼不改坡顶：IFS 归 ifs.js；晶融汇等现代购物中心是独立商场、
// 不属于太古里街区，改成坡顶会变成两片巨大的灰瓦屋面，保留通用方盒
const SKIP_NAMES = ["IFS", "购物中心"]
// 店铺：檐口 8～12 m，屋脊高出檐口 3 m，出檐 1.8～2 m（太古里屋檐出挑很深）；
// 白灰墙只占约四分之一，深木格栅 + 玻璃为主调
const SHOP = {
  eaveMin: 8,
  eaveMax: 12,
  ridgeH: 3,
  overhangMin: 1.8,
  overhangMax: 2,
  plaster: 0.25
}
// 寺院围墙外侧、被裁掉一截的楼：檐口压低到 6～8 m，别压过寺院殿堂
const EDGE_EAVE = { min: 6, max: 8 }
// 店铺墙体取外接矩形的前提：矩形面积不超过轮廓面积的这个倍数
const RECT_GROW_MAX = 1.3
// 两栋楼顶点平均点相距小于它（米）且面积相差不到 5% 视为重复轮廓，只建一栋
const DUP_DIST = 1
// 玻璃带：占长边 86%、高为檐口的 62%，贴墙外 0.1 m
const GLASS = { len: 0.86, h: 0.62, t: 0.1 }

/* ---------------- 大慈寺参数 ---------------- */

// 大慈寺 OSM 中心（按名称查殿时的 near 点）与搜索半径
const TEMPLE_CENTER = [104.08134, 30.65694]
const TEMPLE_NEAR = 200
// 寺院中轴方位缺省值（从弥勒殿指向藏经楼）；有殿查到时按轮廓重算
const AXIS_BEARING = 27.4
// 院墙：离殿外接矩形 8 m，高 3.5、厚 0.8，山门开口宽 8
const WALL = { margin: 8, h: 3.5, t: 0.8, gate: 8 }
// 跨墙楼裁剪后离墙中线的距离：半个墙厚再留 0.3 m
const CLIP_GAP = WALL.t / 2 + 0.3
// 裁剪后面积小于它（㎡）的残块不重建：8 m 以上的檐口配这么小的底面会变成一根细塔
const MIN_PIECE = 40
// 院内铺装顶面高度：盖住道路（最高 0.9 m）
const PAVE = 1.0
// 附属房：檐口 5.5～7 m，屋脊 +2.5 m
const ANNEX = { eaveMin: 5.5, eaveMax: 7, ridgeH: 2.5, overhang: 0.8 }
// 弥勒殿两翼厢房：檐口 5 m（从地面算，露出铺装约 4 m），屋脊 +2 m
const WING = { eaveH: 5, ridgeH: 2, overhang: 0.6 }
// 种树时离殿堂 / 其他楼轮廓的最小距离（米）：殿堂出檐深，要让得更远
const TREE_CLEAR = { hall: 7, other: 4 }
// 放生池（OSM 水面，大雄宝殿西南）：[经度, 纬度, 长, 宽, 长边方位]；
// ctx 里没有水面数据，按当前 OSM 轮廓的最小外接矩形记录。池面高出铺装 0.3 m，一圈花岗岩池沿
const POND = { fb: [104.081213, 30.65666, 22.7, 7.3, 116.7], h: 0.3, rim: 0.5 }

/*
 * 大慈寺各殿。fb 为 OSM 查不到时的回退轮廓：[经度, 纬度, 长, 宽, 长边方位]
 * （取自当前 OSM 数据的最小外接矩形）。中轴上的殿面朝西南（中轴方位 + 180°）；
 * 祈福殿在中轴西北侧、长边平行中轴，面朝中轴（中轴方位 + 90°）。
 * 钟楼、鼓楼、天王殿当前 OSM 数据里没有，查不到时不建（不给回退）。
 */
const HALLS = [
  {
    name: "弥勒殿",
    fb: [104.08085, 30.65608, 34.6, 23.0, 118.1],
    wallH: 5.5,
    steps: "both",
    front: true,
    // OSM 轮廓是凹字形：西南一条前殿（约 27 × 10.6）+ 东北两翼各宽约 5.2 m 的厢房，中间是天井。
    // 殿只建在前殿那条上，两翼改建低矮厢房（见 splitUHall）
    strip: { w: 27, d: 10.6, wing: 5.2 }
  },
  {
    name: "药师殿",
    fb: [104.08096, 30.65625, 16.6, 12.2, 117.6],
    wallH: 4.5,
    steps: "both"
  },
  {
    name: "观音殿",
    fb: [104.08115, 30.65655, 26.1, 15.7, 117.3],
    wallH: 5.5,
    steps: "both"
  },
  {
    name: "大雄宝殿",
    fb: [104.08142, 30.657, 37.8, 18.5, 117.2],
    wallH: 7,
    platformH: 1.8,
    steps: "both"
  },
  {
    name: "藏经楼",
    fb: [104.08163, 30.65731, 37.7, 18.5, 117.3],
    wallH: 7.5,
    platformH: 1.5
  },
  {
    name: "祈福殿",
    fb: [104.08109, 30.65716, 24.0, 15.3, 26.9],
    wallH: 5,
    side: true
  },
  { name: "钟楼", wallH: 4.5 },
  { name: "鼓楼", wallH: 4.5 }
]

/* ---------------- 步行路径（人群用） ---------------- */

// 街区地面高度：terrain.js 的地面平面（店铺之间的空地不铺装，直接露出地面）
const GROUND_Y = -0.5
/*
 * 街区内的步行街（站点坐标系 u / v，同 DISTRICTS）：取重建店铺之间空隙的中线。
 * 由店铺墙体与出檐（含 1.8～2 m 挑檐）栅格化后的净空图寻路得到——
 * 沿净空最大的中线走、再抽稀为折线，转角 > 45° 处已切角加点：
 *   S1 大慈寺南侧长街（北端一小段沿寺院西南角）；S2 其东南约 45 m 的另一条长街；
 *   S3 由 S1 拐角经中部小广场直通街区东南缘的主街；S4 街区东南部横街；
 *   S5、S6 街区中部两条较窄的里巷（落点 Apple Store 西北两侧）；
 *   S7 街区西南缘沿街人行道（店铺与道路路缘之间，到站机位的前景）；
 *   另有 Apple Store 东侧小广场的环路与通往西南的一段（PLAZA_LOOP 与最后一条）。
 * 小人不避让店铺，所以 width 只取净空的一半左右；主街人多，里巷与人行道人少。
 */
const STREETS = [
  {
    uv: [
      [108, -105],
      [120, -57.9],
      [125, -54],
      [240, -55]
    ],
    width: 3,
    density: 2
  },
  {
    uv: [
      [125, -6],
      [148, -9],
      [248, -13]
    ],
    width: 3,
    density: 2
  },
  {
    uv: [
      [119, -54],
      [116, -43],
      [115.2, -28],
      [111.2, -22.8],
      [81.8, -13.2],
      [78.5, -8],
      [97, 133]
    ],
    width: 3,
    density: 2
  },
  {
    uv: [
      [-39, 81],
      [-26, 74],
      [45, 74],
      [66, 76]
    ],
    width: 3,
    density: 2
  },
  {
    uv: [
      [-6, -205],
      [0, -131],
      [1, -130],
      [5, -76],
      [9, -57],
      [10, -24]
    ],
    width: 1.5,
    density: 1.2
  },
  {
    uv: [
      [38, -146],
      [43, -28]
    ],
    width: 1.5,
    density: 1.2
  },
  {
    uv: [
      [-44, -150],
      [-40, 143]
    ],
    width: 2,
    density: 1
  },
  {
    // Apple Store 东侧小广场通往西南的一段（接广场环路）
    uv: [
      [27, 9],
      [18, 22],
      [4, 28],
      [-12, 28]
    ],
    width: 3,
    density: 1.5
  }
]
// Apple Store 东侧小广场（约 30 × 33 m 空地）里的闭合环路：中心与半径（站点坐标系）
const PLAZA_LOOP = { u: 27, v: -3, r: 10, n: 16, width: 3, density: 2 }
// 大慈寺中轴甬道（香客多，段又短，密度取高些）：沿山门—中轴线（院内铺装顶面 PAVE），被殿堂（含台阶与出檐，
// 离殿台基矩形 STEP_CLEAR 米以内）与放生池隔开成若干段，每段一条来回走的路径；
// 短于 MIN_LEN 的段不要（殿与殿挨得太近，站不下人）
const TEMPLE_WALK = {
  width: 4,
  density: 3,
  stepClear: 3.5,
  pondClear: 1.5,
  wallClear: 3,
  minLen: 8
}

/* ---------------- 字库 ---------------- */

const ZIKU = {
  name: "北糠市街字库",
  lon: 104.08066,
  lat: 30.65555,
  height: 7.6, // 含石座
  baseH: 0.5,
  radius: 1.5
}

// 本景点专用色：寺院铺地（偏暖的浅石板）
const PAVE_COLOR = "#D6CCBA"

/* ---------------- 小工具 ---------------- */

/** 每栋楼按索引取一个固定种子的随机数，模型每次加载都一样 */
function randFor(index) {
  return mulberry32(index * 7919 + 17)
}

/**
 * 楼栋自己的替换区。buildingsInZones 以楼的顶点平均点判断是否落在区内：
 * 轮廓本身含平均点时直接用轮廓；凹形轮廓的平均点可能落在轮廓外，
 * 此时退回以平均点为中心、边长 1 m 的小方块——只会命中平均点几乎重合的楼
 * （即重复轮廓），不会像外接矩形那样罩住旁边没重建的楼。
 */
function zoneOf(points) {
  const [x, z] = polygonCenter(points)
  if (pointInPolygon(x, z, points)) return points
  return rectPolygon(x, z, 1, 1, 0)
}

/** 两条线段是否严格相交（共线、只碰端点不算） */
function segmentsCross(p1, p2, q1, q2) {
  const orient = (a, b, c) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const d1 = orient(q1, q2, p1)
  const d2 = orient(q1, q2, p2)
  const d3 = orient(p1, p2, q1)
  const d4 = orient(p1, p2, q2)
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9
}

/**
 * 两个多边形是否重叠：包围盒粗筛 → 边相交 → 一方顶点落在另一方内。
 * 只擦边共线不算重叠（相邻楼共用一道墙很常见）。
 */
export function polygonsOverlap(A, B) {
  const a = polygonBounds(A)
  const b = polygonBounds(B)
  if (a.maxX < b.minX || b.maxX < a.minX) return false
  if (a.maxZ < b.minZ || b.maxZ < a.minZ) return false
  for (let i = 0; i < A.length; i++) {
    const p1 = A[i]
    const p2 = A[(i + 1) % A.length]
    for (let j = 0; j < B.length; j++) {
      if (segmentsCross(p1, p2, B[j], B[(j + 1) % B.length])) return true
    }
  }
  return (
    A.some(([x, z]) => pointInPolygon(x, z, B)) ||
    B.some(([x, z]) => pointInPolygon(x, z, A))
  )
}

/* ---------------- 太古里店铺 ---------------- */

/**
 * 在矩形 r 上盖双坡顶（屋脊沿长边），屋面在墙线处正好等于檐口高度
 * （同 kit addPitchedHouse 的落位：下沉量 = 屋面在墙线处的高度）。
 * gableColor 为 null 时不加山墙三角（墙体按轮廓、没顶到矩形两端时，山墙会悬空）。
 * @returns {number} 屋脊最高点
 */
function addRectRoof(b, L, r, eaveH, ridgeH, overhang, gableColor) {
  const go = { overhang, ridges: false, gables: false }
  const drop = roofHeight(0, overhang / (r.d / 2 + overhang), ridgeH, 0, 1.3)
  const y = eaveH - drop
  // 屋脊沿局部 X；frame 的局部 +X 指向 bearing + 90°，故传 bearing - 90
  const m = frame(r.cx, y, r.cz, r.bearing - 90)
  b.add(gableRoof(r.w, r.d, ridgeH, go), L.roof, m)
  if (gableColor) b.add(gableWalls(r.w, r.d, ridgeH, go), gableColor, m)
  const ridge = gableRidge(r.w, r.d, ridgeH, go)
  ridge.computeBoundingBox()
  const top = y + ridge.boundingBox.max.y
  b.add(ridge, L.roofRidge, m)
  return top
}

/**
 * 沿墙体轮廓贴玻璃带：长度 ≥ 6 m、且与屋脊方向（矩形长边）夹角 < 12° 的墙段
 * 各贴一块（占墙段 86%、高为檐口 62%、厚 0.1 m，内侧面贴着墙面）。
 * 外法向用「中点外移 0.5 m 是否落在轮廓外」判断，与轮廓绕向无关。
 * 墙段外侧紧贴保留的通用楼（外移 0.2 m 落进其轮廓）时不贴，免得玻璃板嵌进邻楼。
 */
function addGlassBands(b, L, walls, bearing, eaveH, kept) {
  const ux = Math.sin(bearing * DEG)
  const uz = -Math.cos(bearing * DEG)
  for (let i = 0; i < walls.length; i++) {
    const [x0, z0] = walls[i]
    const [x1, z1] = walls[(i + 1) % walls.length]
    const len = Math.hypot(x1 - x0, z1 - z0)
    if (len < 6) continue
    const dx = (x1 - x0) / len
    const dz = (z1 - z0) / len
    if (Math.abs(dx * ux + dz * uz) < Math.cos(12 * DEG)) continue
    const mx = (x0 + x1) / 2
    const mz = (z0 + z1) / 2
    // 两个候选法向里取指向轮廓外的那个
    let nx = dz
    let nz = -dx
    if (pointInPolygon(mx + nx * 0.5, mz + nz * 0.5, walls)) {
      nx = -nx
      nz = -nz
    }
    const ox = mx + nx * 0.2
    const oz = mz + nz * 0.2
    if (kept.some((poly) => pointInPolygon(ox, oz, poly))) continue
    // 局部 X 沿墙段：绕 Y 转 θ 后 (1,0,0) → (cos θ, 0, -sin θ)
    const yaw = Math.atan2(-dz, dx)
    b.add(
      box(len * GLASS.len, eaveH * GLASS.h, GLASS.t),
      L.glass,
      local(null, mx + (nx * GLASS.t) / 2, 0, mz + (nz * GLASS.t) / 2, yaw)
    )
  }
}

/**
 * 一栋坡屋顶房（店铺、附属房、厢房共用）：轮廓先按 housePieces 切成若干块，每块：
 *   - 墙体默认取块的外接矩形（墙顶与屋檐严丝合缝）；矩形面积超过轮廓 RECT_GROW_MAX 倍，
 *     或矩形会压到保留的通用楼（kept）时，墙体改回块的轮廓，屋顶仍盖外接矩形；
 *   - 盖双坡顶；glass 为真时长边墙段贴通高玻璃带。
 * @param {Array<Array>} kept 附近保留的通用楼轮廓（墙体不得伸进去）
 * @returns {number} 屋脊最高点（米），轮廓无效返回 0
 */
function addShop(b, L, points, opts, kept) {
  const { eaveH, ridgeH, overhang, wallColor, glass } = opts
  let top = 0
  for (const piece of housePieces(points)) {
    const r = piece.rect
    const rectWalls = rectPolygon(r.cx, r.cz, r.w, r.d, r.bearing)
    // 碰撞检测用每边略缩 0.1 m 的矩形：与邻楼共用墙线不算压到
    const probe = rectPolygon(r.cx, r.cz, r.w - 0.2, r.d - 0.2, r.bearing)
    const useRect =
      r.w * r.d <= RECT_GROW_MAX * polygonArea(piece.points) &&
      !kept.some((poly) => polygonsOverlap(probe, poly))
    const walls = useRect ? rectWalls : piece.points
    const geo = extrudeBuilding({ p: walls, h: eaveH })
    if (!geo) continue
    b.add(geo, wallColor)
    top = Math.max(
      top,
      addRectRoof(b, L, r, eaveH, ridgeH, overhang, useRect ? wallColor : null)
    )
    if (glass) addGlassBands(b, L, walls, r.bearing, eaveH, kept)
  }
  return top
}

/* ---------------- 大慈寺 ---------------- */

/**
 * 按名称就近查殿并取最小外接矩形；查不到时按回退轮廓（没有回退的返回 null）。
 */
function locateHall(ctx, near, hall) {
  const { buildings, project } = ctx
  const i = findBuilding(buildings, hall.name, { near, maxDist: TEMPLE_NEAR })
  if (i >= 0) {
    const points = buildings[i].p
    return { rect: minAreaRect(points), index: i, points }
  }
  if (!hall.fb) return null
  const [lon, lat, w, d, bearing] = hall.fb
  const [cx, cz] = project.toLocal(lon, lat)
  const rect = { cx, cz, w, d, bearing }
  return {
    rect,
    index: -1,
    points: rectPolygon(cx, cz, w, d, bearing)
  }
}

/**
 * 凹字形殿（弥勒殿）拆分：把外接矩形里靠正面的一条（strip.w × strip.d）作为殿的台基矩形，
 * 其后两端各一条宽 strip.wing 的厢房矩形（长 = 外接矩形进深 − strip.d，屋脊沿进深方向）。
 * @param {object} h locateHall 的结果（rect 会被替换为前殿矩形）
 * @param {number} frontBearing 殿的正面朝向
 * @returns {object[]} 两翼厢房矩形（minAreaRect 同构对象）
 */
function splitUHall(h, frontBearing) {
  const r = h.rect
  const s = h.strip
  const diff = (a, c) => Math.abs(((a - c + 540) % 360) - 180)
  // 正面法向：长边两条法向里更接近 frontBearing 的那条
  const nb =
    diff(r.bearing + 90, frontBearing) <= diff(r.bearing - 90, frontBearing)
      ? r.bearing + 90
      : r.bearing - 90
  const f = [Math.sin(nb * DEG), -Math.cos(nb * DEG)]
  const l = [Math.sin(r.bearing * DEG), -Math.cos(r.bearing * DEG)]
  // 外接矩形沿正面法向从 -d/2（背面）到 +d/2（正面）：前殿占 [d/2 - s.d, d/2]，两翼占其余
  const shift = (r.d - s.d) / 2
  h.rect = {
    cx: r.cx + f[0] * shift,
    cz: r.cz + f[1] * shift,
    w: s.w,
    d: s.d,
    bearing: r.bearing
  }
  const len = r.d - s.d
  const lat = r.w / 2 - s.wing / 2
  return [-1, 1].map((sg) => ({
    cx: r.cx + l[0] * sg * lat - f[0] * (s.d / 2),
    cz: r.cz + l[1] * sg * lat - f[1] * (s.d / 2),
    w: len,
    d: s.wing,
    bearing: nb
  }))
}

/** 放生池：一圈花岗岩池沿 + 水面（顶面高出铺装 POND.h），返回池沿外轮廓（种树避让用） */
function addPond(b, L, project, waterColor) {
  const [lon, lat, w, d, bearing] = POND.fb
  const [cx, cz] = project.toLocal(lon, lat)
  // 局部 X 沿长边
  const m = frame(cx, PAVE, cz, bearing - 90)
  const t = POND.rim
  b.add(box(w, POND.h, d), waterColor, m)
  const rimH = POND.h + 0.15
  for (const sz of [-1, 1]) {
    b.add(
      box(w + 2 * t, rimH, t),
      L.granite,
      local(m, 0, 0, (sz * (d + t)) / 2)
    )
  }
  for (const sx of [-1, 1]) {
    b.add(box(t, rimH, d), L.granite, local(m, (sx * (w + t)) / 2, 0, 0))
  }
  return rectPolygon(cx, cz, w + 2 * t, d + 2 * t, bearing)
}

/**
 * 寺院坐标系换算：a 沿中轴（指向藏经楼），c 垂直中轴（中轴方位 + 90°，东南）。
 * 对应 frame(中心, 中轴方位) 的局部 x = c、z = -a（局部 +Z 即西南正面）。
 */
function axisTools(bearing, origin) {
  const b = bearing * DEG
  const au = [Math.sin(b), -Math.cos(b)]
  const av = [Math.cos(b), Math.sin(b)]
  return {
    toAC: ([x, z]) => {
      const dx = x - origin[0]
      const dz = z - origin[1]
      return [dx * au[0] + dz * au[1], dx * av[0] + dz * av[1]]
    },
    toXZ: (a, c) => [
      origin[0] + a * au[0] + c * av[0],
      origin[1] + a * au[1] + c * av[1]
    ]
  }
}

/** 一段院墙：墙身 + 双坡灰瓦墙帽。m 为这段墙的坐标系（原点在墙段中点、局部 X 沿墙），len 为墙长 */
function wallSegment(b, L, m, len) {
  if (len < 0.5) return
  b.add(box(len, WALL.h, WALL.t), L.redWall, m)
  b.add(
    gableRoof(len, WALL.t, 0.5, { overhang: 0.3, segT: 2, ridges: true }),
    L.roof,
    local(m, 0, WALL.h, 0)
  )
}

/**
 * 院墙一圈 + 山门门楼 + 院内铺装。
 * @param {Matrix4} tf 寺院坐标系（原点在院子中心，局部 +Z 为西南正面）
 * @param {number} W 院子沿局部 X 的宽，D 沿局部 Z 的深
 * @param {number} gx 山门中心的局部 x
 */
function addCompound(b, L, tf, W, D, gx) {
  const t = WALL.t
  const hw = W / 2
  const hd = D / 2
  // 院内铺装：底在地面、顶在 PAVE，比墙略小一圈
  b.add(box(W - t, PAVE, D - t), PAVE_COLOR, tf)
  // 后墙（-Z）与两侧墙（±X）
  wallSegment(b, L, local(tf, 0, 0, -hd), W + t)
  wallSegment(b, L, local(tf, hw, 0, 0, Math.PI / 2), D - t)
  wallSegment(b, L, local(tf, -hw, 0, 0, Math.PI / 2), D - t)
  // 前墙（+Z）在山门处断开
  const g0 = Math.max(-hw, gx - WALL.gate / 2)
  const g1 = Math.min(hw, gx + WALL.gate / 2)
  const l0 = g0 + hw + t / 2
  const l1 = hw + t / 2 - g1
  wallSegment(b, L, local(tf, g0 - l0 / 2, 0, hd), l0)
  wallSegment(b, L, local(tf, g1 + l1 / 2, 0, hd), l1)
  // 山门门楼：两根红墩 + 深红额枋 + 双坡灰瓦顶（比院墙高出一截）
  const gm = local(tf, gx, 0, hd)
  const pierW = 1.4
  const gateH = 5.2
  for (const sx of [-1, 1]) {
    b.add(
      box(pierW, gateH, 1.8),
      L.redWall,
      local(gm, sx * (WALL.gate / 2 + pierW / 2), 0, 0)
    )
  }
  b.add(box(WALL.gate, 0.7, 1.2), L.lattice, local(gm, 0, gateH - 0.7, 0))
  const gw = WALL.gate + 2 * pierW
  b.add(
    gableRoof(gw, 1.8, 1.4, { overhang: 0.7, ridges: true }),
    L.roof,
    local(gm, 0, gateH, 0)
  )
}

/**
 * 寺院坐标系（只有平移与绕 Y 旋转）下的世界 ↔ 局部换算，以及按院墙裁剪轮廓：
 * 院子为局部 |x| ≤ W/2、|z| ≤ D/2 的矩形。
 * 跨墙的楼（OSM 轮廓与院墙相交）要切到墙的一侧，否则墙会从楼里穿出来：
 *   院内的楼切到墙内侧，院外的楼切到离它最近那道墙的外侧，都离墙中线 CLIP_GAP。
 */

function compoundTools(tf, W, D) {
  const e = tf.elements
  const ox = e[12]
  const oz = e[14]
  const toLocal = ([x, z]) => {
    const dx = x - ox
    const dz = z - oz
    return [dx * e[0] + dz * e[2], dx * e[8] + dz * e[10]]
  }
  const toWorld = ([x, z]) => [
    ox + e[0] * x + e[8] * z,
    oz + e[2] * x + e[10] * z
  ]
  const hw = W / 2
  const hd = D / 2
  // 局部坐标里按轴对齐半平面裁剪：keep = [轴(0 为 x, 1 为 z), 界值, 方向(+1 保留 ≥, -1 保留 ≤)]
  const clip = (points, planes) => {
    let pts = points.map(toLocal)
    for (const [axis, v, dir] of planes) {
      const o = axis === 0 ? [v, 0] : [0, v]
      const n = axis === 0 ? [dir, 0] : [0, dir]
      pts = clipHalfPlane(pts, o, n)
      if (pts.length < 3) return null
    }
    return pts.map(toWorld)
  }
  return {
    toLocal,
    toWorld,
    /** 轮廓是否有顶点落进院墙范围（含墙厚与间隙） */
    touches(points) {
      return points.some((p) => {
        const [x, z] = toLocal(p)
        return Math.abs(x) < hw + CLIP_GAP && Math.abs(z) < hd + CLIP_GAP
      })
    },
    /** 切到院墙内侧 */
    clipInside(points) {
      const g = CLIP_GAP
      return clip(points, [
        [0, hw - g, -1],
        [0, -hw + g, 1],
        [1, hd - g, -1],
        [1, -hd + g, 1]
      ])
    },
    /** 切到离顶点平均点最近那道墙的外侧 */
    clipOutside(points) {
      const [cx, cz] = toLocal(polygonCenter(points))
      const sides = [
        [cx - hw, [0, hw + CLIP_GAP, 1]],
        [-cx - hw, [0, -hw - CLIP_GAP, -1]],
        [cz - hd, [1, hd + CLIP_GAP, 1]],
        [-cz - hd, [1, -hd - CLIP_GAP, -1]]
      ]
      sides.sort((p, q) => q[0] - p[0])
      return clip(points, [sides[0][1]])
    }
  }
}

/**
 * 院内种树：局部坐标每 12 m 取一个格点（离墙 4 m 以上，避开山门—中轴甬道 ±7 m），
 * 离障碍物轮廓不足其避让距离（殿堂 7 m、其他 4 m）就跳过，再按固定种子随机留下约七成。
 * 距离用 8 个方向的探测点判断（树冠半径 2.4～3.8 m，够用）。
 * @param {Array<{ poly: Array, r: number }>} blockers 障碍物轮廓与避让距离
 */
function addCompoundTrees(b, tools, W, D, gx, blockers, greens, trunk) {
  const step = 12
  const inset = 4
  const rand = mulberry32(20140)
  const dirs = Array.from({ length: 8 }, (_, k) => [
    Math.cos((k * Math.PI) / 4),
    Math.sin((k * Math.PI) / 4)
  ])
  const clear = (x, z) =>
    !blockers.some(
      ({ poly, r }) =>
        pointInPolygon(x, z, poly) ||
        dirs.some(([dx, dz]) => pointInPolygon(x + dx * r, z + dz * r, poly))
    )
  const nx = Math.floor((W - 2 * inset) / step)
  const nz = Math.floor((D - 2 * inset) / step)
  let k = 0
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const lx = -W / 2 + inset + (i * (W - 2 * inset)) / Math.max(1, nx)
      const lz = -D / 2 + inset + (j * (D - 2 * inset)) / Math.max(1, nz)
      const s = 2.4 + rand() * 1.4
      const keep = rand() < 0.7
      if (!keep || Math.abs(lx - gx) < 7) continue
      const [x, z] = tools.toWorld([lx, lz])
      if (!clear(x, z)) continue
      addTree(b, x, PAVE, z, {
        r: s,
        color: greens[k++ % greens.length],
        trunkColor: trunk
      })
    }
  }
}

/* ---------------- 字库 ---------------- */

/** 北糠市街字库：六角石座 + 两层青砖小塔（塔檐灰瓦，每面一块深色焚字口） */
function addZiku(b, L, cx, cz) {
  const m = frame(cx, 0, cz, 0)
  const R = ZIKU.radius
  b.add(prism(6, R + 0.5, R + 0.5, ZIKU.baseH), L.granite, m)
  return (
    ZIKU.baseH +
    addPagoda(b, local(m, 0, ZIKU.baseH, 0), {
      sides: 6,
      tiers: 2,
      height: ZIKU.height - ZIKU.baseH,
      baseRadius: R,
      topRadius: R * 0.78,
      bodyColor: L.brick,
      eaveColor: L.roof,
      trimColor: L.iron
    })
  )
}

/* ---------------- 步行路径 ---------------- */

/**
 * 大慈寺中轴甬道：沿院子局部 x = gx（山门中线）自山门内侧走到后墙内侧，
 * 每 0.5 m 采样一次，落进殿堂（外扩 stepClear）或放生池（外扩 pondClear）的采样点断开，
 * 剩下的连续段各成一条开放路径（世界坐标）。
 * @param {object} compound 寺院（tf / W / D / tools）
 * @param {number} gx 山门中心的局部 x
 * @param {object[]} halls 殿堂（含 rect）
 * @param {object} pondRect 放生池外接矩形 { cx, cz, w, d, bearing }
 */
function templeAxisWalks(compound, gx, halls, pondRect) {
  const { D, tools } = compound
  const T = TEMPLE_WALK
  const grow = (r, m) =>
    rectPolygon(r.cx, r.cz, r.w + 2 * m, r.d + 2 * m, r.bearing)
  const blocks = halls.map((h) => grow(h.rect, T.stepClear))
  if (pondRect) blocks.push(grow(pondRect, T.pondClear))
  const z0 = D / 2 - T.wallClear
  const z1 = -D / 2 + T.wallClear
  const runs = []
  let run = null
  for (let z = z0; z >= z1; z -= 0.5) {
    const [x, wz] = tools.toWorld([gx, z])
    // 路面两侧边缘也要避开（殿堂矩形是斜的，只看中线不够）
    const hit = [-T.width / 2, 0, T.width / 2].some((o) => {
      const [px, pz] = tools.toWorld([gx + o, z])
      return blocks.some((poly) => pointInPolygon(px, pz, poly))
    })
    if (hit) {
      if (run) runs.push(run)
      run = null
    } else if (run) run[1] = [x, wz]
    else
      run = [
        [x, wz],
        [x, wz]
      ]
  }
  if (run) runs.push(run)
  return runs
    .filter(([a, c]) => Math.hypot(c[0] - a[0], c[1] - a[1]) >= T.minLen)
    .map((points) => ({
      points,
      y: PAVE,
      width: T.width,
      closed: false,
      density: T.density
    }))
}

/* ---------------- 主函数 ---------------- */

/**
 * @param {{ project, buildings, theme, spot }} ctx
 * @returns {{ meshes: Mesh[], zones: Array, markerHeight: number, walkways: Array }}
 */
export function build(ctx) {
  const { project, buildings, theme, spot } = ctx
  const L = theme.landmark
  const greens = theme.tree.greens
  const b = new ColorBuilder()
  const zones = []
  // 已由本模块接管（重建，或重复 / 残块只隐藏）的楼栋索引
  const done = new Set()
  const take = (i) => {
    done.add(i)
    zones.push(zoneOf(buildings[i].p))
  }

  /* ---- 1. 大慈寺各殿定位 ---- */
  const near = project.toLocal(TEMPLE_CENTER[0], TEMPLE_CENTER[1])
  const halls = []
  for (const h of HALLS) {
    const loc = locateHall(ctx, near, h)
    if (!loc) continue
    halls.push({ ...h, ...loc })
    if (loc.index >= 0) take(loc.index)
  }
  // 中轴方位：取中轴殿（非侧殿）长边方位的平均值 − 90°
  const axisHalls = halls.filter((h) => !h.side)
  const axis = axisHalls.length
    ? axisHalls.reduce((s, h) => s + h.rect.bearing, 0) / axisHalls.length - 90
    : AXIS_BEARING
  const { toAC, toXZ } = axisTools(axis, near)
  // 凹字形殿拆成前殿 + 两翼厢房（院墙范围仍按 OSM 原轮廓算）
  const wings = []
  for (const h of halls) {
    if (h.strip) wings.push(...splitUHall(h, axis + 180))
  }

  // 殿堂的整体外接矩形（寺院坐标系 a / c），外扩 8 m 为院墙
  let a0 = Infinity
  let a1 = -Infinity
  let c0 = Infinity
  let c1 = -Infinity
  for (const h of halls) {
    for (const p of h.points) {
      const [a, c] = toAC(p)
      a0 = Math.min(a0, a)
      a1 = Math.max(a1, a)
      c0 = Math.min(c0, c)
      c1 = Math.max(c1, c)
    }
  }
  let compound = null
  if (halls.length) {
    a0 -= WALL.margin
    a1 += WALL.margin
    c0 -= WALL.margin
    c1 += WALL.margin
    const [ox, oz] = toXZ((a0 + a1) / 2, (c0 + c1) / 2)
    const W = c1 - c0
    const D = a1 - a0
    const tf = frame(ox, 0, oz, axis)
    compound = {
      tf,
      W,
      D,
      // 院子多边形（世界坐标），用来判断哪些楼在院内
      poly: rectPolygon(ox, oz, D, W, axis),
      cm: (c0 + c1) / 2,
      tools: compoundTools(tf, W, D)
    }
  }

  /* ---- 2. 字库 ---- */
  const zi = findBuilding(buildings, ZIKU.name, {
    near: [spot.x, spot.z],
    maxDist: 400
  })
  const [zx, zz] =
    zi >= 0
      ? polygonCenter(buildings[zi].p)
      : project.toLocal(ZIKU.lon, ZIKU.lat)
  if (zi >= 0) take(zi)
  addZiku(b, L, zx, zz)

  /* ---- 3. 规划要重建的楼（先定全部名单，才知道哪些通用楼会保留） ---- */
  const districts = DISTRICTS.map((d) => {
    const bu = DISTRICT_BEARING * DEG
    // 站点坐标系 (u, v) → 世界：u 沿方位 30°，v 沿 120°
    const cx = spot.x + d.u * Math.sin(bu) + d.v * Math.cos(bu)
    const cz = spot.z - d.u * Math.cos(bu) + d.v * Math.sin(bu)
    return rectPolygon(cx, cz, d.w, d.d, DISTRICT_BEARING)
  })
  // IFS 裙楼轮廓：落在其中的楼归 ifs.js
  const ifsPodium = buildings
    .filter((bd) => bd.n && bd.n.includes("IFS") && bd.p && bd.p.length >= 3)
    .map((bd) => bd.p)
  const apple = findBuilding(buildings, "Apple Store", {
    near: [spot.x, spot.z],
    maxDist: 200
  })
  // jobs：{ i, pts, kind: "annex" 院内附属房 | "edge" 墙外裁剪 | "shop" 店铺 }
  const jobs = []
  const accepted = [] // 已接收轮廓的 { c: 平均点, a: 面积 }，用于去重
  const isDuplicate = (p) => {
    const c = polygonCenter(p)
    const a = polygonArea(p)
    const dup = accepted.some(
      (o) =>
        Math.hypot(o.c[0] - c[0], o.c[1] - c[1]) < DUP_DIST &&
        Math.abs(o.a - a) < 0.05 * Math.max(o.a, a)
    )
    if (!dup) accepted.push({ c, a })
    return dup
  }
  buildings.forEach((bd, i) => {
    if (done.has(i) || !bd.p || bd.p.length < 3) return
    const [x, z] = polygonCenter(bd.p)
    let kind = null
    let pts = bd.p
    if (compound && pointInPolygon(x, z, compound.poly)) {
      // 院内其余楼：一律改成附属房（不看 OSM 高度）；跨墙的部分切掉
      kind = "annex"
      if (compound.tools.touches(bd.p)) pts = compound.tools.clipInside(bd.p)
    } else {
      if (!(bd.h > 0) || bd.h >= LOW_MAX) return
      if (bd.n && SKIP_NAMES.some((k) => bd.n.includes(k))) return
      if (ifsPodium.some((poly) => pointInPolygon(x, z, poly))) return
      // 院外但轮廓伸进寺院围墙的楼：不论是否在街区矩形内都要处理，切到墙外侧
      if (compound && compound.tools.touches(bd.p)) {
        kind = "edge"
        pts = compound.tools.clipOutside(bd.p)
      } else if (districts.some((poly) => pointInPolygon(x, z, poly))) {
        kind = "shop"
      } else return
    }
    take(i)
    // 重复轮廓（如 OSM 里同一栋楼录了两次）与裁剪后的残块只隐藏、不重建
    if (isDuplicate(bd.p)) return
    if (!pts || polygonArea(pts) < MIN_PIECE) return
    jobs.push({ i, pts, kind })
  })

  // 保留的通用楼（附近 800 m 内）：新墙体不得伸进去
  const kept = []
  buildings.forEach((bd, i) => {
    if (done.has(i) || !bd.p || bd.p.length < 3) return
    const [x, z] = polygonCenter(bd.p)
    if (Math.hypot(x - spot.x, z - spot.z) < 800) kept.push(bd.p)
  })

  /* ---- 4. 建殿、院墙、厢房、附属房、放生池与树 ---- */
  const blockers = []
  for (const h of halls) {
    const front = h.side ? axis + 90 : axis + 180
    const f = rectFrame(h.rect, compound ? PAVE : 0, front)
    addHall(b, f, {
      w: h.rect.w,
      d: h.rect.d,
      wallH: h.wallH,
      platformH: h.platformH ?? 1.2,
      steps: h.steps ?? "front",
      roof: "hip"
    })
    const hp = rectPolygon(
      h.rect.cx,
      h.rect.cz,
      h.rect.w,
      h.rect.d,
      h.rect.bearing
    )
    blockers.push({ poly: hp, r: TREE_CLEAR.hall })
  }
  for (const r of wings) {
    const wp = rectPolygon(r.cx, r.cz, r.w, r.d, r.bearing)
    addShop(b, L, wp, { ...WING, wallColor: L.plaster, glass: false }, kept)
    blockers.push({ poly: wp, r: TREE_CLEAR.other })
  }
  let gx = 0
  if (compound) {
    const { tf, W, D, cm } = compound
    // 山门对准弥勒殿（查不到时对准院子中线）
    const gateHall = halls.find((h) => h.front)
    if (gateHall) gx = toAC([gateHall.rect.cx, gateHall.rect.cz])[1] - cm
    addCompound(b, L, tf, W, D, gx)
    const pond = addPond(b, L, project, theme.water)
    blockers.push({ poly: pond, r: 3 })
  }

  /* ---- 5. 店铺与附属房 ---- */
  let appleTop = 0
  for (const { i, pts, kind } of jobs) {
    const rand = randFor(i)
    if (kind === "annex") {
      const eaveH = ANNEX.eaveMin + rand() * (ANNEX.eaveMax - ANNEX.eaveMin)
      addShop(
        b,
        L,
        pts,
        {
          eaveH,
          ridgeH: ANNEX.ridgeH,
          overhang: ANNEX.overhang,
          wallColor: L.plaster,
          glass: false
        },
        kept
      )
      blockers.push({ poly: pts, r: TREE_CLEAR.other })
      continue
    }
    const eave =
      kind === "edge" ? EDGE_EAVE : { min: SHOP.eaveMin, max: SHOP.eaveMax }
    const eaveH = eave.min + rand() * (eave.max - eave.min)
    const overhang =
      SHOP.overhangMin + rand() * (SHOP.overhangMax - SHOP.overhangMin)
    // Apple Store（落点球所在）四面通透玻璃；其余深木格栅为主、约四分之一白灰墙
    const wallColor =
      i === apple ? L.glass : rand() < SHOP.plaster ? L.plaster : L.timber
    const top = addShop(
      b,
      L,
      pts,
      { eaveH, ridgeH: SHOP.ridgeH, overhang, wallColor, glass: i !== apple },
      kept
    )
    if (i === apple) appleTop = top
  }
  if (compound) {
    const { tools, W, D } = compound
    addCompoundTrees(b, tools, W, D, gx, blockers, greens, theme.tree.trunk)
  }

  const geo = b.bake()
  const meshes = []
  if (geo) {
    const mesh = new Mesh(geo, landmarkMaterial())
    mesh.name = "landmark-taikooli"
    meshes.push(mesh)
  }
  // 落点球坐在 Apple Store 那栋楼的屋脊上；没重建时取店铺典型屋脊高度
  const markerHeight = appleTop || SHOP.eaveMax + SHOP.ridgeH

  // 步行路径：街区步行街（站点坐标系 → 世界）+ 大慈寺中轴甬道
  const bu = DISTRICT_BEARING * DEG
  const uvToXZ = ([u, v]) => [
    spot.x + u * Math.sin(bu) + v * Math.cos(bu),
    spot.z - u * Math.cos(bu) + v * Math.sin(bu)
  ]
  const walkways = STREETS.map((st) => ({
    points: st.uv.map(uvToXZ),
    y: GROUND_Y,
    width: st.width,
    closed: false,
    density: st.density
  }))
  const pl = PLAZA_LOOP
  walkways.push({
    points: Array.from({ length: pl.n }, (_, i) => {
      const a = (i / pl.n) * Math.PI * 2
      return uvToXZ([pl.u + Math.cos(a) * pl.r, pl.v + Math.sin(a) * pl.r])
    }),
    y: GROUND_Y,
    width: pl.width,
    closed: true,
    density: pl.density
  })
  if (compound) {
    const [plon, plat, pw, pd, pb] = POND.fb
    const [pcx, pcz] = project.toLocal(plon, plat)
    const t = 2 * POND.rim
    const pondRect = { cx: pcx, cz: pcz, w: pw + t, d: pd + t, bearing: pb }
    walkways.push(...templeAxisWalks(compound, gx, halls, pondRect))
  }
  return { meshes, zones, markerHeight, walkways }
}

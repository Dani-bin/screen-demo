/*
 * 熊猫基地 · 楼体工具（halls.js 建筑、enclosures.js 兽舍 / 产房共用）
 * ----------------------------------------------------------
 * - 平屋面楼 flatBlock：侧墙 + 女儿墙压顶（环形面）+ 女儿墙内侧 + 下沉屋面；
 *   底层零件 sideWalls（只有侧面的墙，在 kit/shapes.js，这里转出给 halls / enclosures / nurseries 用）、
 *   flatFace（水平面，可带洞）、safeInset（带自检的内收轮廓）。
 * - 贴墙色块：facades 给出每面外墙的墙面坐标系，facadeBands 贴横向色带（窗带、玻璃），
 *   skin 贴一圈外圈色带（檐口带），roundWindow / archWindow 为圆窗、拱窗模板；
 *   facingBlocked 判断墙外紧贴着别的实体（共墙）——这种墙上的色块藏在邻楼里，不贴。
 * - outlineOf：按设计文档坐标取 OSM 轮廓（site.footprintNear），取不到时矩形兜底并警告。
 * 约定：轮廓为世界坐标 [[x, z], ...]（不重复首点，顺 / 逆时针都可）；高度为世界 y。
 * 生成的几何体都已在世界坐标（色块模板除外，配 facades 的墙面坐标系用），直接 b.add(geo, color[, m])。
 * 贴墙色块离墙 PLATE_OFF 米、只做单面片：主体批是双面材质，背面朝墙看不见。
 */
import {
  CircleGeometry,
  Matrix4,
  Path,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3
} from "three"
import { GROUND_Y } from "../../terrain.js"
import { pointInPolygon, selfIntersects } from "../../utils.js"
import { local } from "../kit/builder.js"
import {
  bearingDiff,
  insetPolygon,
  polygonArea,
  rectPolygon,
  signedArea2
} from "../kit/footprint.js"
import { sideWalls } from "../kit/shapes.js"
import { C, F_SOLID } from "./site.js"

// 侧墙并入 kit（与天府广场共用），本文件仍转出，兄弟模块的导入不变
export { sideWalls }

const DEG = Math.PI / 180

/** 贴墙色块（窗、玻璃、色带）离墙面的距离（米） */
export const PLATE_OFF = 0.06
/** 共墙探测距离（米）：墙中点沿外法向外移这么远，落在别的实体里即视为贴着邻楼 */
export const PROBE = 0.6

/* ---------------- 轮廓 ---------------- */

/**
 * 统一绕向（返回新数组）：使每条边 a→b 的左手法向 (−dz, dx) 朝外。
 * 带符号面积 > 0 为 x→z 逆时针（kit/footprint.js 的 signedArea2）
 */
export function orient(poly) {
  return signedArea2(poly) > 0 ? poly.slice().reverse() : poly.slice()
}

/**
 * 轮廓向内收 d 米（女儿墙内皮）：kit 的 insetPolygon 只适合近凸轮廓，短边、凹角处可能收出自交
 * 或越界，这里逐项自检（面积变小但不过小、顶点都在原轮廓内、不自交），不合格返回 null
 * @returns {Array<[number, number]>|null}
 */
export function safeInset(poly, d) {
  const inner = insetPolygon(orient(poly), d)
  const a0 = polygonArea(poly)
  const a1 = polygonArea(inner)
  if (!(a1 > 0.2 * a0 && a1 < a0)) return null
  if (!inner.every(([x, z]) => pointInPolygon(x, z, poly))) return null
  if (selfIntersects(inner)) return null
  return inner
}

/* ---------------- 墙、面、平屋面楼 ---------------- */

/** 水平面：轮廓（可带洞）在高度 y 的一层面，法线朝上（n 点轮廓约 n − 2 个三角形） */
export function flatFace(outer, holes, y) {
  // Shape 的 (x, y) 取 (x, −z)，绕 X 轴转 −90° 后落回 (x, 0, z)，正面朝上
  const v = ([x, z]) => new Vector2(x, -z)
  const shape = new Shape(outer.map(v))
  for (const h of holes) shape.holes.push(new Path(h.map(v)))
  const g = new ShapeGeometry(shape)
  g.rotateX(-Math.PI / 2)
  g.translate(0, y, 0)
  return g
}

/**
 * 平屋面楼：侧墙（y0 → top）+ 女儿墙压顶（轮廓挖掉内收 inset 的环形面）+ 女儿墙内侧
 * + 下沉 parapet 的屋面，n 点轮廓约 7n 个三角形。内收轮廓不合格（见 safeInset）或 parapet 为 0 时
 * 不做女儿墙，屋面直接封在 top（约 3n 个）。
 * @param {object} o
 * @param {number} o.top 墙顶（女儿墙顶）世界高度
 * @param {string} o.wall 墙色
 * @param {string} o.roof 屋面色
 * @param {string} [o.coping] 女儿墙压顶色，缺省同墙色
 * @param {number} [o.parapet=0.6] 女儿墙高（屋面下沉量）
 * @param {number} [o.inset=0.45] 女儿墙厚（轮廓内收量）
 * @param {number} [o.y0=GROUND_Y] 墙下沿（缺省埋到城市地面，草地、铺装上都不露缝）
 */
export function flatBlock(b, poly, o) {
  const { top, wall, roof, parapet = 0.6, inset = 0.45, y0 = GROUND_Y } = o
  const coping = o.coping ?? wall
  b.add(sideWalls(poly, y0, top), wall)
  const inner = parapet > 0 ? safeInset(poly, inset) : null
  if (!inner) {
    b.add(flatFace(poly, [], top), roof)
    return
  }
  b.add(flatFace(poly, [inner], top), coping)
  b.add(sideWalls(inner, top - parapet, top, true), wall)
  b.add(flatFace(inner, [], top - parapet), roof)
}

/** 贴在轮廓外 off 米的一圈色带（y0～y1，只有侧面）：檐口带、墙顶色线 */
export function skin(poly, y0, y1, off = PLATE_OFF) {
  return sideWalls(insetPolygon(orient(poly), -off), y0, y1)
}

/* ---------------- 贴墙色块 ---------------- */

/**
 * 轮廓各面外墙（已按外法向统一绕向）。
 * @returns {Array<{ a, b, len, m, facing, n }>} a、b 为边的起点、终点 [x, z]；m 为墙面坐标系：
 *   原点在边起点、y = 0，局部 X 沿墙、Y 向上、+Z 朝外（贴墙色块的 PlaneGeometry / ShapeGeometry
 *   正面朝外）；facing 为外法向方位角（度）；n 为外法向单位向量 [x, z]
 */
export function facades(poly) {
  const p = orient(poly)
  return p.map((a, i) => {
    const b = p[(i + 1) % p.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const tx = (b[0] - a[0]) / len
    const tz = (b[1] - a[1]) / len
    // 外法向 (−tz, tx)；X × Y = Z，行列式为正（ColorBuilder 不收镜像矩阵）
    const m = new Matrix4()
      .makeBasis(
        new Vector3(tx, 0, tz),
        new Vector3(0, 1, 0),
        new Vector3(-tz, 0, tx)
      )
      .setPosition(a[0], 0, a[1])
    const facing = (Math.atan2(-tz, -tx) / DEG + 360) % 360
    return { a, b, len, m, facing, n: [-tz, tx] }
  })
}

/**
 * 墙 f 外 PROBE 米处（墙中点沿外法向）是否落在 blockers 的某个多边形里：贴着邻楼（共墙）的墙，
 * 色块会藏在邻楼里或从邻楼矮屋面上冒出来，不贴。blockers 可直接传 site.solids
 * （本楼自己的轮廓也在里面无妨：探测点在墙外）
 */
export function facingBlocked(f, blockers) {
  if (!blockers) return false
  const x = (f.a[0] + f.b[0]) / 2 + f.n[0] * PROBE
  const z = (f.a[1] + f.b[1]) / 2 + f.n[1] * PROBE
  return blockers.some((p) => pointInPolygon(x, z, p))
}

/**
 * 在符合条件的每面墙上贴一条横向色带（窗带、玻璃）：宽 = 墙长 − 2 × end，y0～y1，离墙 PLATE_OFF。
 * @param {object} o
 * @param {number} o.y0 色带底（世界高度）
 * @param {number} o.y1 色带顶（世界高度）
 * @param {string} [o.color=C.windowBand]
 * @param {number} [o.minLen=0] 只贴长 ≥ minLen 的墙
 * @param {number} [o.end=0] 两端各内收的长度
 * @param {number} [o.facing] 只贴外法向方位在 facing ± spread 内的墙（缺省不限朝向）
 * @param {number} [o.spread=55]
 * @param {boolean} [o.best=false] 只贴最正对 facing 的一面（需给 facing）
 * @param {Array} [o.blockers] 共墙判断用的实体轮廓（见 facingBlocked）
 * @returns {number} 贴了几面
 */
export function facadeBands(b, poly, o) {
  const { y0, y1, minLen = 0, end = 0, facing, spread = 55, best = false } = o
  const color = o.color ?? C.windowBand
  let list = facades(poly).filter(
    (f) =>
      f.len >= minLen &&
      f.len > 2 * end &&
      (facing === undefined || bearingDiff(f.facing, facing) <= spread) &&
      !facingBlocked(f, o.blockers)
  )
  if (best && facing !== undefined && list.length > 1) {
    const d = (f) => bearingDiff(f.facing, facing)
    list = [list.reduce((p, q) => (d(q) < d(p) ? q : p))]
  }
  for (const f of list) {
    b.add(
      new PlaneGeometry(f.len - 2 * end, y1 - y0),
      color,
      local(f.m, f.len / 2, (y0 + y1) / 2, PLATE_OFF)
    )
  }
  return list.length
}

/** 圆窗模板：XY 平面上半径 1 的正 seg 边形（中心在原点、正面 +Z），按 local 的缩放取半径 */
export function roundWindow(seg = 6) {
  return new CircleGeometry(1, seg)
}

/**
 * 拱窗模板：宽 w、直段高 hs，上接半径 w / 2 的半圆拱（arcSeg 段折线），底边中点在原点、
 * XY 平面、正面 +Z。三段拱共 6 个顶点、4 个三角形
 */
export function archWindow(w, hs, arcSeg = 3) {
  const r = w / 2
  const pts = [
    [-r, 0],
    [r, 0],
    [r, hs]
  ]
  for (let k = 1; k < arcSeg; k++) {
    const a = (k / arcSeg) * Math.PI
    pts.push([r * Math.cos(a), hs + r * Math.sin(a)])
  }
  pts.push([-r, hs])
  return new ShapeGeometry(new Shape(pts.map(([x, y]) => new Vector2(x, y))))
}

/* ---------------- 取轮廓 ---------------- */

/**
 * 取 OSM 轮廓：site.footprintNear(spec.at)（先找包含该点的楼，再找 maxDist 内最近的）；
 * 取不到时（数据重拉后楼没了或挪了）按设计文档的矩形兜底：长宽按 OSM 面积等比缩小
 * （不让兜底矩形比原楼大一圈），开发期警告；兜底矩形压到已登记的实体（含其外扩带）时再警告一次。
 * @param {object} spec { name（警告用）, at: [x, z], rect: [长, 宽, 长边方位], area（OSM 面积） }
 * @returns {Array<[number, number]>}
 */
export function outlineOf(site, spec, maxDist = 12) {
  const p = site.footprintNear(spec.at[0], spec.at[1], maxDist)
  if (p) return p
  console.warn(`熊猫基地：未找到 ${spec.name} 的 OSM 轮廓，按设计文档矩形兜底`)
  const [w, d, bearing] = spec.rect
  const k = Math.min(1, Math.sqrt(spec.area / (w * d)))
  const rect = rectPolygon(spec.at[0], spec.at[1], w * k, d * k, bearing)
  // 逐个 1 m 格心检查：落在兜底矩形内、已标 F_SOLID 的格子数
  let hit = 0
  const xs = rect.map((q) => q[0])
  const zs = rect.map((q) => q[1])
  for (let x = Math.floor(Math.min(...xs)) + 0.5; x < Math.max(...xs); x++) {
    for (let z = Math.floor(Math.min(...zs)) + 0.5; z < Math.max(...zs); z++) {
      if (site.grid.get(x, z) & F_SOLID && pointInPolygon(x, z, rect)) hit++
    }
  }
  if (hit > 0) {
    console.warn(
      `熊猫基地：${spec.name} 的兜底矩形压到已登记的实体 ${hit} 格，可能与邻楼相撞`
    )
  }
  return rect
}

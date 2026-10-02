/*
 * 天府广场 · 场地公共部分
 * ----------------------------------------------------------
 * 职责：两套坐标系（广场局部系、设计系）、铺装高度 PAVE、广场与北侧组团共用的颜色表 C、
 * 通用小函数（平面三角化、侧墙等）。各分区模块（ground / sunbird / north / neighbors，以及后续任务
 * 新增的 westEye、eastEye 等）都从这里取坐标与颜色，不各自换算。
 *
 * 两套坐标（设计文档第 1 节、调研报告第 1 节；世界 X 东、Z 南、Y 上，单位米）：
 * - 广场局部系：原点在 OSM「天府广场」面的包围盒中心（SQUARE.lon / lat）、铺装顶面以下的地面，
 *   X 向东、Z 向南、正南北不旋转。只剩设计系原点换算还用它（north.js 用自己的 OSM 点位）。
 * - 设计系 (u, v)：原点在太极大圆圆心，u 沿广场东西轴向东、v 沿南北轴向南，方位角 −1.5°
 *   （东端偏北）。原点在广场局部系的 (2.3, −10.0)。后续任务的广场构件一律在设计系里写，
 *   用 designFrame 换到世界；路径、替换区、地面洞等世界坐标点用 site.toWorld(u, v)。
 *
 * 后续任务：
 * - Task 4～6 按报告 6.9「主要颜色」往 C 里补新颜色。
 * - Task 7 修正北侧组团时改 C 里的毛主席像、科技馆颜色；成都博物馆、四川省图书馆的颜色
 *   放在 neighbors.js 自己的表里，不受这里影响。
 */
import { Matrix4, Quaternion, ShapeUtils, Vector2, Vector3 } from "three"
import { frame } from "../kit/builder.js"
import { cylinder, fromTriangles } from "../kit/shapes.js"

const DEG = Math.PI / 180

/* ---------------- 广场局部系与铺装 ---------------- */

// 广场：OSM 天府广场面包围盒中心（广场局部系原点）
export const SQUARE = {
  lon: 104.0632899,
  lat: 30.6597912
}
// 铺装顶面高度：只需盖住道路（路面最高 0.9 m）；实景广场与人行道齐平（报告 3.2），
// 这里只保留盖住路面所需的高差，外沿是与铺装同色的直边（ground.js）。广场构件的高度都从这个顶面往上算
export const PAVE = 1.5

/* ---------------- 设计系 ---------------- */

// 设计系原点（太极大圆圆心）在广场局部系里的位置
export const DESIGN_ORIGIN = { x: 2.3, z: -10.0 }
// 设计系方位角（度）：u 轴指向方位 88.5°，即东端偏北 1.5°；含义同 kit/builder.js 的 frame
export const DESIGN_BEARING = -1.5

// 设计系 → 广场局部系的旋转系数。必须与 frame(…, DESIGN_BEARING) 的旋转矩阵完全一致：
// frame 用 makeRotationY(−bearing·DEG)，θ = 1.5°，矩阵把局部 (u, 0, v) 变成
// (cosθ·u + sinθ·v, 0, −sinθ·u + cosθ·v)，这里取同一个 θ 算 cos、sin
const THETA = -DESIGN_BEARING * DEG
const COS = Math.cos(THETA) // ≈ 0.99966
const SIN = Math.sin(THETA) // ≈ 0.02618

/**
 * 设计系的坐标系矩阵：原点在太极圆心、铺装以下的地面（y = 0），局部 +X 为 u、+Z 为 v。
 * 写法同设计文档：frame(qx + 2.3, 0, qz − 10.0, −1.5)。构件高度仍从 PAVE 算。
 * @param {number} qx 广场局部系原点的世界 x（project.toLocal(SQUARE.lon, SQUARE.lat)）
 * @param {number} qz 广场局部系原点的世界 z
 * @returns {Matrix4}
 */
export function designFrame(qx, qz) {
  return frame(qx + DESIGN_ORIGIN.x, 0, qz + DESIGN_ORIGIN.z, DESIGN_BEARING)
}

/**
 * 设计系点 → 广场局部系 [x, z]（相对广场局部原点）：
 *   x =  2.3 + 0.99966·u + 0.02618·v
 *   z = −10.0 − 0.02618·u + 0.99966·v
 * 旋转方向与 designFrame（即 frame 的 makeRotationY）一致：+u 向东略偏北（z 减小），
 * +v 向南略偏东（x 增大）。系数取精确的 cos 1.5°、sin 1.5°，上式里的五位小数只是示意。
 */
export function designToSquare(u, v) {
  return [
    COS * u + SIN * v + DESIGN_ORIGIN.x,
    -SIN * u + COS * v + DESIGN_ORIGIN.z
  ]
}

/* ---------------- 场地对象 ---------------- */

/**
 * 场地对象：各分区模块共用的上下文与坐标换算。
 * @param {object} ctx 景点构建上下文 { project, buildings, spot, … }
 * @returns {{
 *   project, buildings, spot,
 *   qx: number, qz: number,   广场局部系原点的世界坐标
 *   square: Matrix4,          广场局部系（旧件用）：frame(qx, 0, qz, 0)
 *   design: Matrix4,          设计系（新件用）：designFrame(qx, qz)
 *   toWorld: (u, v) => [x, z],      设计系点 → 世界 [x, z]，供 walkways、zones、groundHoles
 *   toWorldPts: (pts) => [x, z][]   同上，批量换一组 [u, v]
 * }}
 */
export function createSite(ctx) {
  const { project, buildings, spot } = ctx
  const [qx, qz] = project.toLocal(SQUARE.lon, SQUARE.lat)
  // 世界 = 广场局部原点 + 设计系换到广场局部系的偏移。乘加顺序照 Vector3.applyMatrix4（先旋转、后平移），
  // 结果与 designFrame 矩阵作用于 (u, 0, v)、或 local(site.design, u, y, v) 的平移量逐位相同
  const tx = qx + DESIGN_ORIGIN.x
  const tz = qz + DESIGN_ORIGIN.z
  const toWorld = (u, v) => [COS * u + SIN * v + tx, -SIN * u + COS * v + tz]
  return {
    project,
    buildings,
    spot,
    qx,
    qz,
    square: frame(qx, 0, qz, 0),
    design: designFrame(qx, qz),
    toWorld,
    toWorldPts: (pts) => pts.map(([u, v]) => toWorld(u, v))
  }
}

/* ---------------- 颜色表（广场与北侧组团） ---------------- */

export const C = {
  // 地面（报告 6.9；Esri 实测浅鱼 RGB(190,179,161)、深鱼 RGB(128,115,98)，见报告 3.2）
  pave: "#D8D0C2", // 浅色外板与浅色阳鱼（同色：大圆北半看不出边界）
  yin: "#776E64", // 深色阴鱼
  lamp: "#3C3A38", // S 线上的深色地灯带（照片 c16）
  grass: "#7DB653", // 广场草坪
  flowerRed: "#C8372D", // 草坪外圈花带红底、南侧草坪红色花饰（照片 c22、c18）
  flowerYellow: "#F2C230", // 花带里的黄色祥云块
  // 太阳神鸟盘（报告 6.2、6.9；照片 old2、c13）
  sunGold: "#E2B54A", // 金色盘面、旋纹光芒
  sunGoldDeep: "#C08A2E", // 细金环、太阳外缘环（比盘面深一档，俯视才分得开）
  sunRed: "#D8532F", // 红橙色太阳
  sunSilver: "#D9DCE0", // 银鸟、盘沿不锈钢包边
  discSide: "#24221F", // 鼓座黑色石材侧面
  discRing: "#4A443E", // 鼓座外一圈深色环
  // 北侧组团：毛主席像台基两侧的绿篱花坛（Task 7 重做时再定）
  lawn: "#86C95A",
  // 毛主席像
  tier: "#E2DCCF",
  pedestal: "#8C4A3C",
  statue: "#F2EFE7",
  // 四川科技馆
  sciWall: "#E8D8A8", // 米黄墙
  sciRed: "#B4553B", // 砖红线脚、塔顶
  sciGlass: "#2E3A4A", // 中部通高深色玻璃
  sciWindow: "#56606C",
  sign: "#D8352A"
}

/* ---------------- 通用小函数 ---------------- */

/** 一组局部点 [x, z] 平移到世界：原点在 (ox, oz)、坐标轴不旋转（广场局部系、像中心系） */
export const offsetPoints = (pts, ox, oz) =>
  pts.map(([x, z]) => [ox + x, oz + z])

/** 圆周上等分的 n 个点 [x, z]：从 +X（东）起转向 +Z（南），俯视顺时针；闭合路径用，不含重复首点 */
export const ringPoints = (cx, cz, r, n) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]
  })

/** 两点之间的圆柱（a、c 为父坐标系 [x, y, z]），用于雕像手臂等斜杆 */
export function strut(b, parent, a, c, r0, r1, color) {
  const dir = new Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2])
  const len = dir.length()
  const q = new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    dir.normalize()
  )
  const m = new Matrix4().compose(new Vector3(...a), q, new Vector3(1, 1, 1))
  b.add(
    cylinder(r0, r1, len, { segments: 8, caps: true }),
    color,
    parent.clone().multiply(m)
  )
}

/* ---------------- 平面三角化与侧墙（地面、神鸟盘共用） ---------------- */

/**
 * 去掉相邻的重复点（含末点与首点重合）：几段弧线首尾拼接时接点会出现两次，
 * earcut 遇到零长度边容易漏三角形
 * @param {Array<[number, number]>} poly
 * @returns {Array<[number, number]>} 新数组
 */
export function cleanRing(poly, eps = 1e-6) {
  const out = []
  for (const p of poly) {
    const q = out[out.length - 1]
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p)
  }
  while (
    out.length > 1 &&
    Math.hypot(
      out[0][0] - out[out.length - 1][0],
      out[0][1] - out[out.length - 1][1]
    ) <= eps
  ) {
    out.pop()
  }
  return out
}

/**
 * 平面多边形（可带洞）三角化：three 的 ShapeUtils（earcut），外轮廓、洞的绕向任意。
 * 点为 [x, z]（本景点里一般是设计系 [u, v]）；洞须在外轮廓内、彼此不相交。
 * @returns {Array<Array<[number, number]>>} 三角形数组 [[a, b, c], ...]（绕向未定，写入时由 pushUp 调整）
 */
export function triangulate(outer, holes = []) {
  const rings = [cleanRing(outer), ...holes.map((h) => cleanRing(h))]
  const verts = rings.flat()
  const v2 = (ring) => ring.map(([x, z]) => new Vector2(x, z))
  const faces = ShapeUtils.triangulateShape(
    v2(rings[0]),
    rings.slice(1).map(v2)
  )
  return faces.map(([i, j, k]) => [verts[i], verts[j], verts[k]])
}

/**
 * 把一个三角形写进平铺坐标数组 pos，绕向调成法线朝上（y 分量 > 0）。
 * 点为 [x, z]，高度由 yAt(x, z) 给出（水平面传常数函数，神鸟盘倾斜顶面传平面方程）。
 * 法线 y 分量 = (b − a).z·(c − a).x − (b − a).x·(c − a).z，为负时交换 b、c
 */
export function pushUp(pos, [a, b, c], yAt) {
  const cr = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1])
  const [p, q] = cr >= 0 ? [b, c] : [c, b]
  for (const [x, z] of [a, p, q]) pos.push(x, yAt(x, z), z)
}

/**
 * 竖直侧墙：沿闭合轮廓每条边一块 y0～y1 的四边形，法线朝外（每边 2 个三角形，无顶面、底面）。
 * 口径同 pandaBase/blocks.js 的 sideWalls（不跨景点引用，这里留一份）。
 * @param {Array<[number, number]>} poly 轮廓 [x, z]，不重复首点，绕向任意
 */
export function sideWalls(poly, y0, y1) {
  // 带符号面积 > 0（x→z 逆时针）时反转，使每条边 a→b 的左手法向 (−dz, dx) 朝外
  let a2 = 0
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i]
    const [x1, z1] = poly[(i + 1) % poly.length]
    a2 += x0 * z1 - x1 * z0
  }
  const p = a2 > 0 ? poly.slice().reverse() : poly
  const pos = []
  for (let i = 0; i < p.length; i++) {
    const [ax, az] = p[i]
    const [bx, bz] = p[(i + 1) % p.length]
    pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz)
    pos.push(ax, y0, az, bx, y1, bz, ax, y1, az)
  }
  return fromTriangles(pos)
}

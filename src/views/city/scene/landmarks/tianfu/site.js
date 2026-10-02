/*
 * 天府广场 · 场地公共部分
 * ----------------------------------------------------------
 * 职责：两套坐标系（广场局部系、设计系）、铺装高度 PAVE、广场与北侧组团共用的颜色表 C、
 * 通用小函数。各分区模块（square / north / neighbors，以及后续任务新增的 ground、sunbird、
 * westEye、eastEye 等）都从这里取坐标与颜色，不各自换算。
 *
 * 两套坐标（设计文档第 1 节、调研报告第 1 节；世界 X 东、Z 南、Y 上，单位米）：
 * - 广场局部系：原点在 OSM「天府广场」面的包围盒中心（SQUARE.lon / lat）、铺装顶面以下的地面，
 *   X 向东、Z 向南、正南北不旋转。旧模型（square.js、north.js 的点位）都在这套坐标里写。
 * - 设计系 (u, v)：原点在太极大圆圆心，u 沿广场东西轴向东、v 沿南北轴向南，方位角 −1.5°
 *   （东端偏北）。原点在广场局部系的 (2.3, −10.0)。后续任务的广场构件一律在设计系里写，
 *   用 designFrame 换到世界；路径、替换区、地面洞等世界坐标点用 site.toWorld(u, v)。
 *
 * 后续任务：
 * - Task 3～6 按报告 6.9「主要颜色」往 C 里补新颜色；旧件删掉后，只有它们用的颜色一并删掉。
 * - Task 7 修正北侧组团时改 C 里的毛主席像、科技馆颜色；成都博物馆、四川省图书馆的颜色
 *   放在 neighbors.js 自己的表里，不受这里影响。
 */
import { Matrix4, Quaternion, Vector3 } from "three"
import { frame } from "../kit/builder.js"
import { cylinder } from "../kit/shapes.js"

const DEG = Math.PI / 180

/* ---------------- 广场局部系与铺装 ---------------- */

// 广场：OSM 天府广场面包围盒中心（广场局部系原点）；294 × 190，圆角半径 12
export const SQUARE = {
  lon: 104.0632899,
  lat: 30.6597912,
  w: 294,
  d: 190,
  r: 12
}
// 铺装顶面高度：只需盖住道路（路面最高 0.9 m）；照片里广场边缘是一道
// 能坐人的低矮石沿，不宜抬高成台地。广场构件的高度都从这个顶面往上算
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
  paveWest: "#E2DDD2", // 西半浅石材
  paveEast: "#BDB3A1", // 东半略深的石材（与西半拉开对比，突出太极两仪）
  curb: "#A9A499", // 外沿台阶
  sunkenFloor: "#A39B8E",
  step: "#C8C2B6",
  band: "#F4E6BC", // S 形浅金白色分界带
  lawn: "#86C95A",
  water: "#8FD0EA",
  jet: "#F4FAFF",
  rim: "#E6E1D6",
  spiralPole: "#DCE4E0",
  // 毛主席像（tier 也用于下沉广场雕塑圆座）
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

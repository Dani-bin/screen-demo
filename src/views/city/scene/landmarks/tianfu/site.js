/*
 * 天府广场 · 场地公共部分
 * ----------------------------------------------------------
 * 职责：两套坐标系（广场局部系、设计系）与场地对象 createSite，以及多个分区共用的布局常量：
 * 铺装高度 PAVE、北侧组团地坪 NORTH_Y、林带内侧步道 BELT_PATH。各分区模块（ground / sunbird / westEye /
 * eastEye / north / statue / science / neighbors 等）都从这里取坐标，不各自换算。
 * 颜色表 C 在 colors.js；平面三角化、铺面、棱柱、斜杆、三维向量这类通用几何小函数在 surface.js。
 *
 * 两套坐标（设计文档第 1 节、调研报告第 1 节；世界 X 东、Z 南、Y 上，单位米）：
 * - 广场局部系：原点在 OSM「天府广场」面的包围盒中心（SQUARE.lon / lat）、铺装顶面以下的地面，
 *   X 向东、Z 向南、正南北不旋转。只剩设计系原点换算还用它（北侧组团用自己的 OSM 点位，见 north.js）。
 * - 设计系 (u, v)：原点在太极大圆圆心，u 沿广场东西轴向东、v 沿南北轴向南，方位角 −1.5°
 *   （东端偏北）。原点在广场局部系的 (2.3, −10.0)。广场构件一律在设计系里写，
 *   用 designFrame 换到世界；路径、替换区、地面洞等世界坐标点用 site.toWorld(u, v)。
 */
import { frame } from "../kit/builder.js"

const DEG = Math.PI / 180

/* ---------------- 广场局部系与铺装 ---------------- */

// 广场：OSM 天府广场面包围盒中心（广场局部系原点）
const SQUARE = {
  lon: 104.0632899,
  lat: 30.6597912
}
// 铺装顶面高度：只需盖住道路（路面最高 0.9 m）；实景广场与人行道齐平（报告 3.2），
// 这里只保留盖住路面所需的高差，外沿是与铺装同色的直边（ground.js）。广场构件的高度都从这个顶面往上算
export const PAVE = 1.5

/* ---------------- 设计系 ---------------- */

// 设计系原点（太极大圆圆心）在广场局部系里的位置
const DESIGN_ORIGIN = { x: 2.3, z: -10.0 }
// 设计系方位角（度）：u 轴指向方位 88.5°，即东端偏北 1.5°；含义同 kit/builder.js 的 frame
const DESIGN_BEARING = -1.5

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
function designFrame(qx, qz) {
  return frame(qx + DESIGN_ORIGIN.x, 0, qz + DESIGN_ORIGIN.z, DESIGN_BEARING)
}

/* ---------------- 场地对象 ---------------- */

/**
 * 场地对象：各分区模块共用的上下文与坐标换算。
 * @param {object} ctx 景点构建上下文 { project, buildings, spot, … }
 * @returns {{
 *   project, buildings, spot,
 *   design: Matrix4,                设计系：designFrame(qx, qz)，构件 b.add 时乘它
 *   toWorld: (u, v) => [x, z],      设计系点 → 世界 [x, z]，供 walkways、zones、groundHoles
 *   toWorldPts: (pts) => [x, z][]   同上，批量换一组 [u, v]
 * }}
 */
export function createSite(ctx) {
  const { project, buildings, spot } = ctx
  // 广场局部系原点的世界坐标
  const [qx, qz] = project.toLocal(SQUARE.lon, SQUARE.lat)
  // 世界 = 广场局部原点 + 设计系换到广场局部系的偏移（cos 1.5° ≈ 0.99966、sin 1.5° ≈ 0.02618）：
  //   x = qx + 2.3 + cos·u + sin·v，z = qz − 10.0 − sin·u + cos·v
  // 即 +u 向东略偏北（z 减小）、+v 向南略偏东（x 增大），与 designFrame（frame 的 makeRotationY）同向。
  // 乘加顺序照 Vector3.applyMatrix4（先旋转、后平移），
  // 结果与 designFrame 矩阵作用于 (u, 0, v)、或 local(site.design, u, y, v) 的平移量逐位相同
  const tx = qx + DESIGN_ORIGIN.x
  const tz = qz + DESIGN_ORIGIN.z
  const toWorld = (u, v) => [COS * u + SIN * v + tx, -SIN * u + COS * v + tz]
  return {
    project,
    buildings,
    spot,
    design: designFrame(qx, qz),
    toWorld,
    toWorldPts: (pts) => pts.map(([u, v]) => toWorld(u, v))
  }
}

/* ---------------- 布局常量（多个分区共用） ---------------- */

/**
 * 东西林带内侧的南北步道（设计系，报告 3.2：步道 u ±99～±111、约 11 m 宽；6.7：路径 u ≈ ±105）：
 * 人流走中间 4 m，v −78 → 73，每米人数系数 density 1。trees.js 据此建步行路径并让开树冠，
 * furniture.js 据此摆两侧路灯，walkways.js 的东西两条横线两端接在 u ±105、南线就在 v1 上。北端离北缘灯杆（v −83）5 m；南端停在南侧两条草带（v 77.5 起，
 * 东带伸到 u 111、西带到 u −113）以北 4.5 m
 */
export const BELT_PATH = { u: 105, width: 4, v0: -78, v1: 73, density: 1 }

/**
 * 北侧组团地坪（north.js、statue.js、science.js 共用）：像与科技馆之间广场铺装的顶面，也是 OSM 高度的起算面。
 * 比城市地面（GROUND_Y −0.5）高 1.5 m、比道路面最高处（0.9）略高，免得哪段路面压上来；
 * 广场南侧的天府广场铺装是 PAVE 1.5，这里低 0.5 m，中间隔着一条道路，看不出高差。
 * 放在这里而不放 north.js：statue.js、science.js 都要用，north.js 又要导入它们，放 north.js 会循环导入
 */
export const NORTH_Y = 1.0

/*
 * kit 内部共用：配色、屋顶落位、最高点统计等小工具（parts.js / towers.js 共用）
 */
import { Color } from "three"
import { THEME } from "../../theme.js"
import { local } from "./builder.js"
import { roofHeight } from "./roofs.js"

export const L = THEME.landmark
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

/**
 * 殿堂 / 亭子的默认配色，colors 里同名键覆盖：
 * platform 台基、column 柱、wall 墙、lattice 花格门窗与额枋、roof 屋面、
 * ridge 屋脊、finial 宝顶、trim 贴金
 */
export function palette(colors = {}) {
  return {
    platform: L.granite,
    column: L.column,
    wall: L.redWall,
    lattice: L.lattice,
    roof: L.roof,
    ridge: L.roofRidge,
    finial: L.glaze,
    trim: L.gold,
    ...colors
  }
}

/** 屋脊色：灰瓦用专门的脊色，其他瓦色（如琉璃）取同色压暗 */
export function ridgeColorFor(roofColor, c) {
  if (roofColor === c.roof) return c.ridge
  return new Color(roofColor).multiplyScalar(0.78)
}

/** 把几何体加进 b，返回它在局部坐标里的最高点 y（放置高度 + 包围盒上沿） */
export function addTop(b, geo, color, matrix, y) {
  geo.computeBoundingBox()
  const top = y + geo.boundingBox.max.y
  b.add(geo, color, matrix)
  return top
}

/**
 * 屋顶放在柱顶时应整体下移的量：让屋面在「柱线外 margin 米」处正好等于柱顶高度。
 * 这样额枋、上层墙（向柱线外凸出不超过 margin）都藏在屋面下，不会从瓦面上戳出来；
 * 檐口则垂到柱顶以下，形成真实的出檐下垂感。
 */
export function eaveDrop(halfDepth, overhang, h, pow = 1.5, margin = 0.35) {
  const t = Math.max(0, overhang - margin) / (halfDepth + overhang)
  return roofHeight(0, t, h, 0, pow)
}

/**
 * 正 n 边形第 k 条边上的坐标系（给沿边摆放的构件用：额枋、坐凳、塔身贴面等）。
 * 原点在边中点（边心距处）、高度 y；局部 X 沿边、局部 +Z 朝外。
 * 边 k 连接顶点 k 与 k+1（顶点约定见 shapes.js），边 sides-1 正对 +Z。
 * @returns {Matrix4}
 */
export function edgeFrame(parent, sides, radius, k, y) {
  const a = Math.PI / sides + ((k + 0.5) * 2 * Math.PI) / sides
  const ap = radius * Math.cos(Math.PI / sides)
  return local(parent, ap * Math.sin(a), y, ap * Math.cos(a), a)
}

/** 线性插值 */
export function lerpNum(a, b, t) {
  return a + (b - a) * t
}

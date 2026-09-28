/*
 * 场景通用工具：确定性随机、几何判断
 */

/** 用整数索引生成 [0,1) 的稳定伪随机数：同一索引每次结果相同 */
export function hash01(i) {
  const x = Math.sin(i * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/** mulberry32：给定种子的可复现随机数生成器，返回每次产出 [0,1) 的函数 */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 射线法判断点 (x, z) 是否在多边形 [[x, z], ...] 内 */
export function pointInPolygon(x, z, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    const cross =
      zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi
    if (cross) inside = !inside
  }
  return inside
}

/** 多边形包围盒 */
export function polygonBounds(poly) {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const [x, z] of poly) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  return { minX, maxX, minZ, maxZ }
}

/** 多边形顶点平均点（做标签落点够用，不追求真实质心） */
export function polygonCenter(poly) {
  let sx = 0
  let sz = 0
  for (const [x, z] of poly) {
    sx += x
    sz += z
  }
  return [sx / poly.length, sz / poly.length]
}

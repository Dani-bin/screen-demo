/*
 * 场景通用工具：确定性随机、稳定哈希种子、几何判断
 */

/**
 * 用整数索引生成 [0,1) 的稳定伪随机数：同一索引在同一 JS 引擎内每次结果相同。
 * 跨浏览器 Math.sin 末位可能不同，因此仅用于选色等不影响观感的场合。
 */
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

/**
 * 把若干整数混成一个 32 位无符号种子（MurmurHash3 的逐字混合 + 末尾雪崩）。
 * 只用 Math.imul 与位运算，各 JS 引擎结果一致；相邻输入（如坐标差 1）也会得到毫不相关的种子。
 * 非整数先按 |0 截成 32 位整数，调用方需自行取整。
 * @param {...number} values
 * @returns {number}
 */
export function hashInts(...values) {
  let h = 0x9747b28c
  for (const value of values) {
    let k = Math.imul(value | 0, 0xcc9e2d51)
    k = (k << 15) | (k >>> 17)
    k = Math.imul(k, 0x1b873593)
    h ^= k
    h = (h << 13) | (h >>> 19)
    h = (Math.imul(h, 5) + 0xe6546b64) | 0
  }
  h ^= values.length
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * 由几何形状生成稳定种子：取顶点数与前 n 个顶点坐标（四舍五入到米）做哈希。
 * 用于「每个 OSM 元素一个独立随机流」——不依赖元素在数据列表里的下标，
 * 数据增删、重排时只有几何本身变了的元素结果才会变。
 * @param {number} seed 全局种子（区分不同用途，如撒树 / 景点楼栋）
 * @param {Array<[number, number]>} points 多边形或折线顶点 [[x, z], ...]
 * @param {number} [n=3] 参与哈希的顶点数
 * @returns {number}
 */
export function shapeSeed(seed, points, n = 3) {
  const ints = [seed, points.length]
  for (let i = 0; i < Math.min(n, points.length); i++) {
    ints.push(Math.round(points[i][0]), Math.round(points[i][1]))
  }
  return hashInts(...ints)
}

/**
 * 射线法判断点 (x, z) 是否在多边形 [[x, z], ...] 内。
 * 采用半开区间约定：落在下/左边界上的点算在内、上/右边界不算，
 * 这样相邻多边形共享的边不会被重复计数。
 */
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

/** 多边形包围盒（要求非空多边形） */
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

/** 多边形顶点平均点（要求非空多边形；做标签落点够用，不追求真实质心） */
export function polygonCenter(poly) {
  let sx = 0
  let sz = 0
  for (const [x, z] of poly) {
    sx += x
    sz += z
  }
  return [sx / poly.length, sz / poly.length]
}

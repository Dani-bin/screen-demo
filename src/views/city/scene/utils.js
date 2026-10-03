/*
 * 场景通用工具：确定性随机、稳定哈希种子、几何判断（点在多边形内、包围盒、线段交叉与多边形自交等）
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

/** 有向面积的两倍：点 c 在有向线段 a→b 的哪一侧（正负各在一侧，0 为共线）。点为 [x, z] */
function orient(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

/**
 * 两条线段 p-q、r-s 是否严格交叉（端点相接、共线重叠都不算）。点为 [x, z]。
 * 城市地面挖洞（terrain.js 的 segmentGap）与景点轮廓工具（kit/footprint.js 的 ringsCross）共用
 */
export function segmentsCross(p, q, r, s) {
  return (
    orient(r, s, p) * orient(r, s, q) < 0 &&
    orient(p, q, r) * orient(p, q, s) < 0
  )
}

/**
 * 多边形是否自交：有不相邻的两条边严格交叉（首尾两边相邻，不比；端点相接、共线重叠不算）。
 * 逐对比较，只适合几十个点的小轮廓：城市地面洞（terrain.js）、天府广场的挖口与草坪内收（tianfu/polygon.js）、
 * 熊猫基地的楼块内收轮廓（pandaBase/blocks.js）
 * @param {Array<[number, number]>} poly 轮廓 [x, z]，不重复首点
 */
export function selfIntersects(poly) {
  const n = poly.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue // 末边与首边相邻
      if (
        segmentsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])
      ) {
        return true
      }
    }
  }
  return false
}

/**
 * 「落在数据区域内」的容差（米）：点离主城区与各飞地的 clip 都超过这么远，就算不在任何数据区域内。
 * 用途：景点落点的有效性检查（landmarks/index.js 的 createLandmarks）、静态阴影的投影物筛选（CityScene）。
 * 取 1 km：数据里离 clip 最远的正常元素是主城区公园面撒出的通用树（约 170 m），留足余量；
 * 而旧版 chengdu.json（缺 meta.enclaves）里，熊猫基地落点离主城区 clip 约 6 km，能可靠地判为区域外
 */
export const REGION_MARGIN = 1000

/**
 * 点 (x, z) 离哪块数据区域最近：返回 clips 中点到矩形距离最小的下标（点在矩形内距离为 0）。
 * clips 是各区域的裁剪矩形 [x0, z0, x1, z1]（meta.clip 与 meta.enclaves[].clip），
 * 下标 0 是主城区；距离并列时取下标小者，主城区优先。
 * 给了 maxGap 时，最近的区域也离点超过 maxGap 米就返回 -1（不在任何区域内）；
 * 缺省 maxGap 为 Infinity，总能返回某块区域（与加 maxGap 之前逐位一致）。
 *
 * 为什么按「最近」而不是「是否落在 clip 内」：
 * - 主城区的公园面不按 clip 裁剪，通用树会撒到 clip 外约 170 m（西北角最多）；
 * - 飞地的树同样会超出飞地 clip 约 30 m。
 * 若用「不在飞地 clip 内就归主城区」，这些树会被错归到另一块；严格按「在 clip 内」筛选又会把它们丢掉。
 * 最近归类让每个投影物恰好落进一块区域，且离哪块近就归哪块（区域之间相距数公里，不会有歧义；
 * 拉数脚本 fetch-osm-city.py 要求各区域 clip 至少相距 MIN_REGION_GAP = 1 km）。
 *
 * 与 cameraTour.js 的 nearestRect 算法相同（点到矩形的距离取最小、并列取靠前者），但有意分开：
 * - 口径不同：这里是 clip（拉数范围 bbox 外扩 300 m，数据实际铺到的范围），用于给投影物、落点归区；
 *   nearestRect 是 bbox 本身（比 clip 每边内缩 300 m），是注视点可移动的范围，镜头不该停到 clip 边缘的空地上；
 * - 需要的结果不同：这里只要下标，nearestRect 还要夹进矩形后的点与距离；
 * - 这里是热路径（静态阴影要对每栋楼、每棵树调用），矩形保持紧凑的数组形式、不分配结果对象
 * @param {number} x
 * @param {number} z
 * @param {number[][]} clips 各区域裁剪矩形 [[x0, z0, x1, z1], ...]
 * @param {number} [maxGap=Infinity] 最近区域的最大允许距离（米），超过返回 -1
 * @returns {number} 最近区域的下标；超出 maxGap 时为 -1
 */
export function nearestRegion(x, z, clips, maxGap = Infinity) {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < clips.length; i++) {
    const [x0, z0, x1, z1] = clips[i]
    // 点到矩形的距离：各轴上超出区间的部分，区间内取 0
    const dx = Math.max(x0 - x, 0, x - x1)
    const dz = Math.max(z0 - z, 0, z - z1)
    const dist = Math.hypot(dx, dz)
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  // maxGap 缺省为 Infinity 时恒成立（含 clips 为空、bestDist 仍为 Infinity 的情形），返回值同改动前
  return bestDist <= maxGap ? best : -1
}

/**
 * 各数据区域的裁剪矩形：下标 0 为主城区 meta.clip，其后依次为 meta.enclaves[].clip。
 * 数据缺 meta.clip（极旧的数据格式）时返回空数组：createLandmarks 据此跳过落点检查；
 * 但 CityScene 的分区域阴影仍需要主城区 clip（regionShadows[0]），这种数据整页会构建失败、
 * 由 index.vue 降级提示（与加飞地前相同，现有数据都有 meta.clip）
 * @param {object} meta chengdu.json 的 meta
 * @returns {number[][]}
 */
export function regionClips(meta) {
  if (!meta?.clip) return []
  return [meta.clip, ...(meta.enclaves || []).map((e) => e.clip)]
}

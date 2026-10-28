/*
 * 折线工具：长度、按距离取点、取切向（平面坐标 [e, n]，米）
 * 仿真（人员沿路线移动）和三维场景（巷道、箭头、粒子）共用。
 */

/** 折线总长 */
export function polyLength(pts) {
  let L = 0
  for (let i = 1; i < pts.length; i++)
    L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return L
}

/**
 * 沿折线走 d 米处的点和单位切向（d 超出两端时夹在端点）
 * @returns {{ p: number[], t: number[] }}
 */
export function pointAt(pts, d) {
  let left = Math.max(0, d)
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (left <= seg || i === pts.length - 1) {
      const k = seg ? Math.min(1, left / seg) : 0
      const t = seg ? [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg] : [1, 0]
      return { p: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], t }
    }
    left -= seg
  }
  return { p: pts[0].slice(), t: [1, 0] }
}

/** 固定种子的伪随机数（mulberry32），同一种子每次结果一样 */
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 分段线性插值：keys = [[x, y], ...]（x 递增），x 超出两端取端值 */
export function interp(keys, x) {
  if (x <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i][0]) {
      const [x0, y0] = keys[i - 1]
      const [x1, y1] = keys[i]
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
  }
  return keys[keys.length - 1][1]
}

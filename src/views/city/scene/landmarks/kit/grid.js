/*
 * 占用栅格：布置树木、竹丛时判断空地
 * ----------------------------------------------------------
 * 按 cell 米划分的位标记栅格（Uint8，每格最多 8 种标记），世界坐标 [x, z]。
 * fillPoly 多边形打标记（可沿边外扩）、stamp / stampLine 线段盖印、disk 圆盘、
 * freeDisk 判断圆盘内是否不含某些标记。标记位由各景点自定义（如 F_SOLID、F_WATER）。
 * 由 dufu.js 移出共用；wuhou.js 的同名函数 stampLine / freeDisk 细节不同，保持原样不并入。
 */

export function createGrid(x0, z0, x1, z1, cell = 0.5) {
  const nx = Math.ceil((x1 - x0) / cell)
  const nz = Math.ceil((z1 - z0) / cell)
  const a = new Uint8Array(nx * nz)
  const ix = (x) => Math.floor((x - x0) / cell)
  const iz = (z) => Math.floor((z - z0) / cell)
  const set = (i, k, flag) => {
    if (i >= 0 && i < nx && k >= 0 && k < nz) a[k * nx + i] |= flag
  }
  const grid = {
    get(x, z) {
      const i = ix(x)
      const k = iz(z)
      if (i < 0 || i >= nx || k < 0 || k >= nz) return 0
      return a[k * nx + i]
    },
    /** 多边形（世界坐标）内的格子打标记；pad > 0 时再沿边外扩 */
    fillPoly(poly, flag, pad = 0) {
      let zMin = Infinity
      let zMax = -Infinity
      for (const [, z] of poly) {
        zMin = Math.min(zMin, z)
        zMax = Math.max(zMax, z)
      }
      for (
        let k = Math.max(0, iz(zMin));
        k <= Math.min(nz - 1, iz(zMax));
        k++
      ) {
        const zc = z0 + (k + 0.5) * cell
        const xs = []
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const [xa, za] = poly[j]
          const [xb, zb] = poly[i]
          if (za > zc !== zb > zc)
            xs.push(xa + ((zc - za) * (xb - xa)) / (zb - za))
        }
        xs.sort((p, q) => p - q)
        for (let m = 0; m + 1 < xs.length; m += 2) {
          const i0 = Math.max(0, Math.ceil((xs[m] - x0) / cell - 0.5))
          const i1 = Math.min(nx - 1, Math.floor((xs[m + 1] - x0) / cell - 0.5))
          for (let i = i0; i <= i1; i++) a[k * nx + i] |= flag
        }
      }
      if (pad > 0) {
        for (let i = 0; i < poly.length; i++) {
          grid.stamp(poly[i], poly[(i + 1) % poly.length], pad, flag)
        }
      }
    },
    /** 线段两侧 r 以内的格子打标记 */
    stamp(p, q, r, flag) {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1])
      const n = Math.max(1, Math.ceil(len / (cell * 0.8)))
      const rr = Math.ceil(r / cell)
      for (let s = 0; s <= n; s++) {
        const x = p[0] + ((q[0] - p[0]) * s) / n
        const z = p[1] + ((q[1] - p[1]) * s) / n
        const ci = ix(x)
        const ck = iz(z)
        for (let di = -rr; di <= rr; di++) {
          for (let dk = -rr; dk <= rr; dk++) {
            const xc = x0 + (ci + di + 0.5) * cell
            const zc = z0 + (ck + dk + 0.5) * cell
            if (Math.hypot(xc - x, zc - z) <= r) set(ci + di, ck + dk, flag)
          }
        }
      }
    },
    /** 折线整体盖印（线宽 2r；closed 时含末点回到首点的一段） */
    stampLine(pts, r, flag, closed = false) {
      const n = closed ? pts.length : pts.length - 1
      for (let i = 0; i < n; i++) {
        grid.stamp(pts[i], pts[(i + 1) % pts.length], r, flag)
      }
    },
    /** 圆盘打标记 */
    disk(cx, cz, r, flag) {
      grid.stamp([cx, cz], [cx, cz], r, flag)
    },
    /** 圆盘内（圆心 + 圆周 8 点）是否都不含 mask 中的任何标记 */
    freeDisk(cx, cz, r, mask) {
      if (grid.get(cx, cz) & mask) return false
      for (let k = 0; k < 8; k++) {
        const t = (k / 8) * Math.PI * 2
        if (grid.get(cx + r * Math.cos(t), cz + r * Math.sin(t)) & mask)
          return false
      }
      return true
    }
  }
  return grid
}

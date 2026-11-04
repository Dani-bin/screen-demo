/**
 * 青原露天矿：世界数据（高度场、坐标换算、运输路线）
 * ----------------------------------------------------------
 * 世界坐标（world.json、仿真、设计文档里都用这套）：本地米，原点在采坑中心附近，x 向东、y 向北。
 * three.js 坐标：(X, 高度, -Y)，即 x 向东、z 向南，保证从正南往北看时右边是东。
 * 高度整体放大 VS 倍（采坑只有 150 m 深而宽 6 km，不放大在 38° 俯角下像一个浅盘）。
 */
import * as THREE from "three"

import world from "../data/world.json"

/** 竖向放大倍数：地形与设备落点共用 */
export const VS = 5.5

export { world }

const HALF_W = world.window.halfW
const HALF_H = world.window.halfH

/** 世界 (x 东, y 北, 高度 m) → three 向量，高度已乘 VS */
export function toV3(x, y, h = 0, out = new THREE.Vector3()) {
  return out.set(x, h * VS, -y)
}

/**
 * 加载高度场与影像。
 * 高度 PNG：R 高字节 G 低字节 = 16 位高度（lo..hi 线性），B = 坑深比例；解码必须关色彩转换。
 */
export async function loadWorld(base) {
  const hmeta = world.height
  const blob = await fetch(`${base}open-pit/terrain_h.png`).then((r) =>
    r.blob()
  )
  const bmp = await createImageBitmap(blob, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none"
  })
  const cv = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = cv.getContext("2d", { willReadFrequently: true })
  ctx.drawImage(bmp, 0, 0)
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data
  const n = bmp.width * bmp.height
  const h = new Float32Array(n)
  const w = new Uint8Array(n)
  const span = hmeta.hi - hmeta.lo
  for (let i = 0; i < n; i++) {
    h[i] = hmeta.lo + (((px[i * 4] << 8) | px[i * 4 + 1]) / 65535) * span
    w[i] = px[i * 4 + 2]
  }
  const tex = await new THREE.TextureLoader().loadAsync(
    `${base}open-pit/imagery.webp`
  )
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return new Grid(h, w, bmp.width, bmp.height, tex)
}

/** 高度场：双线性采样 */
export class Grid {
  constructor(h, w, nx, ny, imagery) {
    this.h = h
    this.w = w
    this.nx = nx
    this.ny = ny
    this.imagery = imagery
    this.res = world.height.res
  }

  _ij(x, y) {
    return [(x + HALF_W) / this.res, (HALF_H - y) / this.res]
  }

  /** 世界 (x, y) 处的地面高度（米，未放大） */
  height(x, y) {
    const [fx, fy] = this._ij(x, y)
    return this._bilinear(this.h, fx, fy)
  }

  /** 坑深比例 0（坑沿）→ 1（坑底） */
  pit(x, y) {
    const [fx, fy] = this._ij(x, y)
    return this._bilinear(this.w, fx, fy) / 255
  }

  _bilinear(arr, fx, fy) {
    const x0 = Math.max(0, Math.min(this.nx - 2, Math.floor(fx)))
    const y0 = Math.max(0, Math.min(this.ny - 2, Math.floor(fy)))
    const tx = Math.max(0, Math.min(1, fx - x0))
    const ty = Math.max(0, Math.min(1, fy - y0))
    const i = y0 * this.nx + x0
    const a = arr[i] * (1 - tx) + arr[i + 1] * tx
    const b = arr[i + this.nx] * (1 - tx) + arr[i + this.nx + 1] * tx
    return a * (1 - ty) + b * ty
  }

  /** 排土场权重：椭圆内 1，边缘软过渡（和 prepare.py 里建排土场用的同一套参数） */
  dumpWeight(x, y) {
    let m = 0
    for (const d of Object.values(world.dumps)) {
      const c = Math.cos(d.rot)
      const s = Math.sin(d.rot)
      // prepare.py 里图像 y 向下，世界 y 向北：旋转方向要对应取反
      const dx = x - d.cx
      const dy = y - d.cy
      const u = (dx * c - dy * s) / d.rx
      const v = (dx * s + dy * c) / d.ry
      const r = Math.hypot(u, v)
      // 平台到 r = 0.78，之后 0.22 的宽度收到地面（和 prepare.py 里 blob 的 soft = 0.22 对应）
      m = Math.max(m, 1 - Math.min(1, Math.max(0, (r - 0.78) / 0.22)))
    }
    return m
  }
}

/** 折线路线：弧长参数化，f ∈ [0, 1] 取点和朝向 */
export class Route {
  constructor(points) {
    this.pts = points
    this.cum = [0]
    for (let i = 1; i < points.length; i++) {
      this.cum.push(
        this.cum[i - 1] +
          Math.hypot(
            points[i][0] - points[i - 1][0],
            points[i][1] - points[i - 1][1]
          )
      )
    }
    this.len = this.cum[this.cum.length - 1]
  }

  /** 弧长 s（米）处的位置和朝向角（世界坐标，朝向以 +x 为 0，逆时针） */
  atMeters(s, out = {}) {
    s = Math.max(0, Math.min(this.len, s))
    let lo = 0
    let hi = this.cum.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (this.cum[mid] <= s) lo = mid
      else hi = mid
    }
    const seg = this.cum[hi] - this.cum[lo] || 1
    const t = (s - this.cum[lo]) / seg
    const a = this.pts[lo]
    const b = this.pts[hi]
    out.x = a[0] + (b[0] - a[0]) * t
    out.y = a[1] + (b[1] - a[1]) * t
    out.yaw = Math.atan2(b[1] - a[1], b[0] - a[0])
    return out
  }

  at(f, out) {
    return this.atMeters(f * this.len, out)
  }
}

/** 全部路线：键是电铲编号（ES-01…07），每条从电铲出发、到卸载点 / 破碎站结束 */
export function buildRoutes() {
  const r = {}
  for (const [id, pts] of Object.entries(world.routes)) r[id] = new Route(pts)
  return r
}

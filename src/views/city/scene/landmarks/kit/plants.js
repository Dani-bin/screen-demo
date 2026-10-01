/*
 * 植物小件的公共几何：竹梢叶团
 * ----------------------------------------------------------
 * 竹簇数量多（数百簇、上千束），逐束 ColorBuilder.add 太慢：各景点把变换后的三角形顶点
 * 按颜色直接写进数组，全部种完后每种颜色合成一个几何体（shapes.js 的 fromTriangles）再加进合批器。
 * 撒点、倾斜、尺寸的随机规则各景点不同（随机数取用顺序决定已有景点的画面），留在各自模块里，
 * 这里只放共用的叶团形状与写顶点的函数。
 */
import { Vector3 } from "three"

/**
 * 竹梢叶团的单位三角形（半径 1、高 1）四棱双锥：顶尖 (0, 1, 0)，最宽一圈在 62% 高，
 * 下尖细长（建模时抬到 0.3 m，像一束竹竿）。每项 [x, y, z, 是否在最宽一圈]
 */
export const SPINDLE = (() => {
  const n = 4
  const ring = Array.from({ length: n + 1 }, (_, k) => {
    const a = (k / n) * Math.PI * 2
    return [Math.sin(a), Math.cos(a)]
  })
  const tris = []
  for (let k = 0; k < n; k++) {
    const [s0, c0] = ring[k]
    const [s1, c1] = ring[k + 1]
    tris.push([0, 1, 0, 0], [s0, 0.62, c0, 1], [s1, 0.62, c1, 1])
    tris.push([0, 0, 0, 0], [s1, 0.62, c1, 1], [s0, 0.62, c0, 1])
  }
  return tris
})()

const _v = new Vector3()

/**
 * 按变换 m 写入一束竹梢叶团的 8 个三角形：高 h、最宽一圈半径 r，下尖在 0.3 m。
 * @param {number[]} out 顶点坐标数组（平铺 x, y, z），按颜色分组由调用方管理
 * @param {Matrix4} m 局部 → 世界变换（原点在束根，局部 +Y 为竹梢方向）
 * @param {number} h 叶团高（米）
 * @param {number} r 最宽一圈半径（米）
 */
export function pushSpindle(out, m, h, r) {
  for (const [ux, uy, uz, wide] of SPINDLE) {
    const yy = uy === 0 ? 0.3 : uy * h
    const k = wide ? r : 0
    _v.set(ux * k, yy, uz * k).applyMatrix4(m)
    out.push(_v.x, _v.y, _v.z)
  }
}

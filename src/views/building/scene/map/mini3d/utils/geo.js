/**
 * 墨卡托投影，行为与 d3-geo 的 geoMercator().center().scale().translate() 一致：
 *   x = tx + scale * (λ - λc)
 *   y = ty - scale * (mercY(φ) - mercY(φc))      // y 向下为正（屏幕坐标），场景里再取负
 * 输入输出均为 [经度, 纬度] / [x, y]
 */
const rad = (deg) => (deg * Math.PI) / 180
const mercY = (latDeg) => Math.log(Math.tan(Math.PI / 4 + rad(latDeg) / 2))

export function geoMercator() {
  let center = [0, 0]
  let scale = 961 / (2 * Math.PI)
  let translate = [480, 250]

  const projection = ([lon, lat]) => {
    const x = rad(lon) - rad(center[0])
    const y = mercY(lat) - mercY(center[1])
    return [translate[0] + scale * x, translate[1] - scale * y]
  }
  projection.center = (c) => {
    center = c
    return projection
  }
  projection.scale = (s) => {
    scale = s
    return projection
  }
  projection.translate = (t) => {
    translate = t
    return projection
  }
  return projection
}

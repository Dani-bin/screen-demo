import { Box3, Vector3, Shape, Path } from "three"

export function uuid(len = 10, radix = 62) {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".split("")
  const out = []
  for (let i = 0; i < len; i++) out[i] = chars[0 | (Math.random() * radix)]
  return out.join("")
}

export function getBoundBox(group) {
  const size = new Vector3()
  const box3 = new Box3()
  box3.expandByObject(group)
  const boxSize = new Vector3()
  box3.getSize(boxSize)
  const center = new Vector3()
  box3.getCenter(center)
  const obj = { box3, boxSize, center }
  if (group.geometry) {
    group.geometry.computeBoundingBox()
    group.geometry.computeBoundingSphere()
    const { max, min } = group.geometry.boundingBox
    size.x = max.x - min.x
    size.y = max.y - min.y
    size.z = max.z - min.z
    obj.size = size
  }
  return obj
}

/**
 * 统一 GeoJSON 结构：Polygon 的 coordinates 包一层，使之与 MultiPolygon 同构
 * 入参可以是 JSON 字符串（FileLoader 返回）或已解析的对象
 */
export const transfromMapGeoJSON = (data) => {
  const worldData = typeof data === "string" ? JSON.parse(data) : data
  const features = worldData.features
  for (let i = 0; i < features.length; i++) {
    const element = features[i]
    if (["Polygon"].includes(element.geometry.type)) {
      element.geometry.coordinates = [element.geometry.coordinates]
      element.geometry.type = "MultiPolygon"
    }
  }
  return worldData
}

/**
 * GeoJSON 的一个多边形（[外环, ...洞]）→ THREE.Shape
 * 第 0 个环是外轮廓，其余环是洞（GeoJSON 约定）。之前每个环都当成独立的面来画，
 * 合德镇里的县经济开发区飞地就被合德镇的面盖了一层，hover 合德镇时飞地也跟着亮
 * @param {number[][][]} polygon
 * @param {(lngLat: number[]) => [number, number]} project 投影函数
 * @returns {Shape|null} 环上有坏点时返回 null
 */
export const polygonToShape = (polygon, project) => {
  const ringToPath = (ring, path) => {
    for (let i = 0; i < ring.length; i++) {
      if (!ring[i][0] || !ring[i][1]) return false
      const [x, y] = project(ring[i])
      if (i === 0) path.moveTo(x, -y)
      path.lineTo(x, -y)
    }
    return true
  }
  const shape = new Shape()
  if (!ringToPath(polygon[0], shape)) return null
  for (let i = 1; i < polygon.length; i++) {
    const hole = new Path()
    if (ringToPath(polygon[i], hole)) shape.holes.push(hole)
  }
  return shape
}

/*
 * 景点标注：落点球 + HTML 标签
 * ----------------------------------------------------------
 * 标签用 CSS2DObject 挂在三维坐标上，由 CSS2DRenderer 换算成屏幕位置，
 * 样式在页面 index.vue 的非 scoped 样式里定义（.city-label）。
 */
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js"
import { Group, Mesh, SphereGeometry } from "three"
import { pointInPolygon, polygonBounds } from "./utils.js"

/** 点 (px, pz) 到线段 (ax, az)-(bx, bz) 的最短距离 */
function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz
  // 退化线段（两端点重合）直接取到端点的距离
  let k = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0
  k = Math.max(0, Math.min(1, k))
  return Math.hypot(px - (ax + dx * k), pz - (az + dz * k))
}

/**
 * 落点球的底座高度（米）。
 * 景点经纬度常落在楼体轮廓内（广场周边商场、寺院主殿），或紧贴楼墙；
 * 若球放在地面上，会被楼体整颗吞掉或半截插进墙里。
 * 这里取「轮廓包含落点，或最近边距落点不超过 radius + 2 m」的所有楼中最高者，
 * 球就放在这栋楼的楼顶上，保证从任何角度都完整可见。
 * @param {number} x 落点 X
 * @param {number} z 落点 Z
 * @param {number} radius 球半径
 * @param {Array} buildings 楼栋数组 [{ p: [[x, z], ...], h }]
 * @returns {number} 无相交楼体时为 0
 */
export function markerBaseHeight(x, z, radius, buildings) {
  const reach = radius + 2
  let base = 0
  for (const b of buildings) {
    if (!b.p || b.p.length < 3 || !(b.h > base)) continue
    // 包围盒外扩 reach 仍不含落点的楼直接跳过，省去逐边计算
    const bb = polygonBounds(b.p)
    if (
      x < bb.minX - reach ||
      x > bb.maxX + reach ||
      z < bb.minZ - reach ||
      z > bb.maxZ + reach
    )
      continue
    let hit = pointInPolygon(x, z, b.p)
    for (let i = 0, j = b.p.length - 1; !hit && i < b.p.length; j = i++) {
      const [ax, az] = b.p[j]
      const [bx, bz] = b.p[i]
      if (distToSegment(x, z, ax, az, bx, bz) <= reach) hit = true
    }
    if (hit) base = b.h
  }
  return base
}

/**
 * @param {Array} spots 景点数组（已含 x / z 局部坐标）
 * @param {Array} buildings 楼栋数组，用于把落点球抬到所压楼体的楼顶（见 markerBaseHeight）
 * @returns {{ group: Group, bases: number[], setActive: Function, dispose: Function }}
 *   bases 为各景点落点球的底座高度（米），便于测试与调试。
 *   dispose 只释放几何体与标签 DOM，不会把 group 移出场景；
 *   调用方需自行 group.removeFromParent()（或 scene.remove(group)）。
 */
export function createMarkers(spots, materials, theme, buildings = []) {
  const group = new Group()
  const labels = []
  const bases = []
  // 所有落点球只有两种尺寸：首个景点（主景点）用大球，其余共用小球
  const mainGeo = new SphereGeometry(theme.marker.mainRadius, 24, 16)
  const normalGeo = new SphereGeometry(theme.marker.radius, 24, 16)

  spots.forEach((spot, i) => {
    const main = i === 0
    const r = main ? theme.marker.mainRadius : theme.marker.radius
    // 落点压在楼上时，球与标签整体抬到楼顶
    const base = markerBaseHeight(spot.x, spot.z, r, buildings)
    bases.push(base)
    const dot = new Mesh(main ? mainGeo : normalGeo, materials.marker)
    dot.position.set(spot.x, base + r + 3, spot.z)
    dot.castShadow = true
    group.add(dot)

    // 标签文字用 textContent 写入而非 innerHTML：
    // 景点数据后续可能来自接口，避免接口文本被当作 HTML 解析（XSS）
    const el = document.createElement("div")
    el.className = "city-label"
    const name = document.createElement("b")
    name.textContent = spot.name
    const en = document.createElement("small")
    en.textContent = spot.en
    el.append(name, en)
    const label = new CSS2DObject(el)
    // CSS2DRenderer 每帧都会写内联 transform: translate(-cx%, -cy%) translate(x, y)，
    // 页面 CSS 里的 transform 会被覆盖，锚点只能通过 center 设置。
    // (0.5, 1) 表示标签底边中点落在锚点上，标签整体显示在落点球正上方
    label.center.set(0.5, 1)
    label.position.set(spot.x, base + r + 3 + theme.marker.labelLift, spot.z)
    group.add(label)
    labels.push(el)
  })

  return {
    group,
    bases,
    /** 当前站标签加高亮描边 */
    setActive(index) {
      labels.forEach((el, i) => el.classList.toggle("is-active", i === index))
    },
    dispose() {
      mainGeo.dispose()
      normalGeo.dispose()
      labels.forEach((el) => el.remove())
    }
  }
}

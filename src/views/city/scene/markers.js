/*
 * 景点标注：落点球 + HTML 标签
 * ----------------------------------------------------------
 * 标签用 CSS2DObject 挂在三维坐标上，由 CSS2DRenderer 换算成屏幕位置，
 * 样式在页面 index.vue 的非 scoped 样式里定义（.city-label）。
 */
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js"
import { Group, Mesh, SphereGeometry } from "three"

/**
 * @param {Array} spots 景点数组（已含 x / z 局部坐标）
 * @returns {{ group: Group, setActive: Function, dispose: Function }}
 */
export function createMarkers(spots, materials, theme) {
  const group = new Group()
  const labels = []
  const geos = []

  spots.forEach((spot, i) => {
    const r = i === 0 ? theme.marker.mainRadius : theme.marker.radius
    const geo = new SphereGeometry(r, 24, 16)
    geos.push(geo)
    const dot = new Mesh(geo, materials.marker)
    dot.position.set(spot.x, r + 3, spot.z)
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
    label.position.set(spot.x, r + 3 + theme.marker.labelLift, spot.z)
    group.add(label)
    labels.push(el)
  })

  return {
    group,
    /** 当前站标签加高亮描边 */
    setActive(index) {
      labels.forEach((el, i) => el.classList.toggle("is-active", i === index))
    },
    dispose() {
      geos.forEach((g) => g.dispose())
      labels.forEach((el) => el.remove())
    }
  }
}

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
 *   dispose 只释放几何体与标签 DOM，不会把 group 移出场景；
 *   调用方需自行 group.removeFromParent()（或 scene.remove(group)）。
 */
export function createMarkers(spots, materials, theme) {
  const group = new Group()
  const labels = []
  // 所有落点球只有两种尺寸：首个景点（主景点）用大球，其余共用小球
  const mainGeo = new SphereGeometry(theme.marker.mainRadius, 24, 16)
  const normalGeo = new SphereGeometry(theme.marker.radius, 24, 16)

  spots.forEach((spot, i) => {
    const main = i === 0
    const r = main ? theme.marker.mainRadius : theme.marker.radius
    const dot = new Mesh(main ? mainGeo : normalGeo, materials.marker)
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
    // CSS2DRenderer 每帧都会写内联 transform: translate(-cx%, -cy%) translate(x, y)，
    // 页面 CSS 里的 transform 会被覆盖，锚点只能通过 center 设置。
    // (0.5, 1) 表示标签底边中点落在锚点上，标签整体显示在落点球正上方
    label.center.set(0.5, 1)
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
      mainGeo.dispose()
      normalGeo.dispose()
      labels.forEach((el) => el.remove())
    }
  }
}

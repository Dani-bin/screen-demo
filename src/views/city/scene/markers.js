/*
 * 景点标注：悬浮定位针（小球 + 细竖线）+ HTML 标签
 * ----------------------------------------------------------
 * 小球悬在景点模型（或所压楼顶）上方 theme.marker.hover 米，细竖线连到底座，
 * 不再压住精细模型的亭顶、熊猫、塔尖（尺寸说明见 theme.js 的 marker 段）。
 * 标签用 CSS2DObject 挂在三维坐标上，由 CSS2DRenderer 换算成屏幕位置，
 * 样式在页面 index.vue 的非 scoped 样式里定义（.city-label）。
 * 标签压到顶部标题栏时按 avoidLabels 的规则避让（当前站先下压，压不下与其余标签一样隐藏）；
 * 拉远后标签互相压住时，按优先级（当前站最先，其余按景点顺序）隐藏后放置的标签。
 */
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js"
import { CylinderGeometry, Group, Mesh, SphereGeometry, Vector3 } from "three"
import { pointInPolygon, polygonBounds } from "./utils.js"
import { distToSegment } from "./landmarks/kit/footprint.js"

/**
 * 标签引线默认长度（设计稿 px）：必须与 index.vue 里 .city-label 的 --lead（40px）一致。
 * 标签底边锚在球顶，再由 CSS 上抬这么多，引线（::after）正好连回锚点
 */
export const LABEL_LEAD = 40
// 当前站标签避让顶部栏时，引线最短压到默认长度的这个比例（再短就贴着球、看不出是引线）
const MIN_LEAD_RATIO = 0.3
// 标签隐藏后，要离开保留带、或与已显示的标签拉开这么多（设计稿 px，与保留带同样按视口缩放）才重新显示：
// 停靠时镜头缓慢环绕，标签在边界上来回时不会闪烁
const CLIP_HYSTERESIS = 4

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
      if (distToSegment(x, z, b.p[j], b.p[i]) <= reach) hit = true
    }
    if (hit) base = b.h
  }
  return base
}

/**
 * @param {Array} spots 景点数组（已含 x / z 局部坐标）
 * @param {Array} buildings 楼栋数组，用于把落点球抬到所压楼体的楼顶（见 markerBaseHeight）
 * @param {number[]} [baseHeights] 外部给定的底座高度（景点精细模型的 markerHeight）；
 *   baseHeights[i] > 0 时直接使用，否则按 buildings 估算
 * @returns {{ group: Group, bases: number[], setActive: Function, avoidLabels: Function, dispose: Function }}
 *   bases 为各景点落点球的底座高度（米），便于测试与调试；avoidLabels 为标签避让顶部栏与互相避让（每帧调用）。
 *   dispose 只释放几何体与标签 DOM，不会把 group 移出场景；
 *   调用方需自行 group.removeFromParent()（或 scene.remove(group)）。
 */
export function createMarkers(
  spots,
  materials,
  theme,
  buildings = [],
  baseHeights = []
) {
  const group = new Group()
  const labels = []
  const labelObjects = []
  const bases = []
  const mk = theme.marker
  // 所有落点球只有两种尺寸：首个景点（主景点）用大球，其余共用小球
  const mainGeo = new SphereGeometry(mk.mainRadius, 24, 16)
  const normalGeo = new SphereGeometry(mk.radius, 24, 16)
  // 竖线：单位高度的细圆柱，底面在 y = 0，每根按长度纵向缩放
  const stemGeo = new CylinderGeometry(mk.stemRadius, mk.stemRadius, 1, 8)
  stemGeo.translate(0, 0.5, 0)

  spots.forEach((spot, i) => {
    const main = i === 0
    const r = main ? mk.mainRadius : mk.radius
    // 景点精细模型给了底座高度就直接用；否则落点压在楼上时，定位针整体抬到楼顶
    const base =
      baseHeights[i] > 0
        ? baseHeights[i]
        : markerBaseHeight(spot.x, spot.z, r, buildings)
    bases.push(base)
    const cy = base + mk.hover // 球心高度
    const dot = new Mesh(main ? mainGeo : normalGeo, materials.marker)
    dot.position.set(spot.x, cy, spot.z)
    dot.castShadow = true
    group.add(dot)

    // 竖线从底座上方 stemGap 画到球底；太细，投影几乎看不见，不参与阴影
    const stemLen = cy - r - (base + mk.stemGap)
    if (stemLen > 0) {
      const stem = new Mesh(stemGeo, materials.marker)
      stem.position.set(spot.x, base + mk.stemGap, spot.z)
      stem.scale.set(1, stemLen, 1)
      stem.castShadow = false
      group.add(stem)
    }

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
    label.position.set(spot.x, cy + r + mk.labelLift, spot.z)
    group.add(label)
    labels.push(el)
    labelObjects.push(label)
  })

  /*
   * 标签避让的状态（见 avoidLabels）：
   * widths / heights 为标签框尺寸缓存（屏幕 px，高度为 0 表示待测量；当前站切换时重测新旧两个当前站标签、
   * 缩放比例变化时全部重测，免得每帧读布局触发排版），
   * topClipped 为标签是否因压到顶栏而隐藏，crowded 为是否因被更优先的标签压住而隐藏，
   * leads 为当前站标签已写入的引线长度（屏幕 px，保留 1 位小数；0 表示用 CSS 默认值）
   */
  const widths = labels.map(() => 0)
  const heights = labels.map(() => 0)
  const topClipped = labels.map(() => false)
  const crowded = labels.map(() => false)
  const hidden = labels.map(() => false)
  const leads = labels.map(() => 0)
  let activeIndex = -1
  let lastLead = 0
  const v = new Vector3()

  return {
    group,
    bases,
    /** 当前站标签加高亮描边 */
    setActive(index) {
      const prev = activeIndex
      activeIndex = index
      labels.forEach((el, i) => el.classList.toggle("is-active", i === index))
      // 当前站标签字号与内边距更大：只有新旧两个当前站标签的尺寸变了，只重测这两个
      if (prev >= 0 && prev < heights.length) heights[prev] = 0
      if (index >= 0 && index < heights.length) heights[index] = 0
    },
    /**
     * 标签避让，每帧在 CSS2DRenderer.render 之后调用（此时标签的世界矩阵已更新）。
     * 标签框按锚点的屏幕位置算：框底 = 锚点 y − 引线长，框顶 = 框底 − 框高，左右以锚点 x 居中。
     *
     * 一、避让顶部栏：框顶进入顶部保留带（y < safeTop，标题、时钟与天气所在的顶栏）时：
     * - 当前站标签：先缩短引线把标签往下压，最短压到 MIN_LEAD_RATIO × lead；
     *   压到最短仍压着顶栏（定位针本身已贴近画面顶部，多为人工拖拽）就同样隐藏。
     *   站点机位本身应让标签落在保留带以下，这里只兜底（如熊猫塔定位针在 339 m 塔尖上方）；
     * - 其余标签：远处站点的标签只是参照，直接淡出隐藏（class is-clipped）。
     * 隐藏的标签离开保留带 CLIP_HYSTERESIS（设计稿 px，按视口缩放）后再显示。
     *
     * 二、标签之间避让：拉远到总览距离以外时景点挤在一起，标签会互相压住。
     * 按优先级（当前站最先，其余按景点顺序）逐个放置，框与已放置的标签相交就淡出隐藏；
     * 已隐藏的标签要与已放置的标签拉开 CLIP_HYSTERESIS 才重新显示，镜头缓慢环绕时不会闪烁。
     * 总览机位下标签两两不相压（见 theme.js 的 overview），不受影响。
     *
     * 不针对具体站点，任何站、任何视角（含人工拖拽、缩放）都按同一规则处理。
     * @param {THREE.Camera} camera 渲染相机
     * @param {number} width 渲染区宽度（屏幕 px）
     * @param {number} height 渲染区高度（屏幕 px）
     * @param {number} safeTop 顶部保留带下沿（屏幕 px）；传 -Infinity 则不避让顶部栏
     * @param {number} lead 默认引线长度（屏幕 px，即 LABEL_LEAD 按视口缩放后的值）
     */
    avoidLabels(camera, width, height, safeTop, lead) {
      // 视口缩放变了（rem 跟着变），标签尺寸全部重测
      if (lead !== lastLead) {
        heights.fill(0)
        lastLead = lead
      }
      // 设计稿 px → 屏幕 px 的比例（lead 即 LABEL_LEAD 按视口缩放后的值）
      const k = lead / LABEL_LEAD
      const hysteresis = CLIP_HYSTERESIS * k
      const minLead = lead * MIN_LEAD_RATIO
      const minLeadR = Math.round(minLead * 10) / 10
      // 先读后写：这一帧要测量的尺寸全部读完，再统一改 class / 内联样式，
      // 避免读写交错让浏览器反复重排（尺寸缓存清零的那一帧会连读多个标签）。
      // CSS2DRenderer 对相机背后 / 视锥外的标签设 display: none，不参与避让
      const shown = []
      labels.forEach((el, i) => {
        if (el.style.display === "none") return
        if (!heights[i]) {
          const rect = el.getBoundingClientRect()
          widths[i] = rect.width
          heights[i] = rect.height
        }
        shown.push(i)
      })

      // 第一步：避让顶部栏，算出各标签的引线长度与框的屏幕位置
      const boxes = []
      for (const i of shown) {
        v.setFromMatrixPosition(labelObjects[i].matrixWorld).project(camera)
        const anchorX = (v.x * 0.5 + 0.5) * width
        const anchorY = (-v.y * 0.5 + 0.5) * height
        // 按默认引线算出的框顶离保留带下沿的距离，< 0 表示压进了顶栏
        const room = anchorY - lead - heights[i] - safeTop
        // 当前站可以靠缩短引线腾出的高度；缩完仍压进保留带的深度 over > 0 时隐藏
        const active = i === activeIndex
        const over = -room - (active ? lead - minLead : 0)
        const nextLead = active && room < 0 ? Math.max(minLead, lead + room) : 0
        topClipped[i] = topClipped[i] ? over > -hysteresis : over > 0
        const bottom = anchorY - (nextLead || lead)
        boxes[i] = {
          left: anchorX - widths[i] / 2,
          right: anchorX + widths[i] / 2,
          top: bottom - heights[i],
          bottom,
          lead: nextLead
        }
      }

      // 第二步：按优先级放置，与已放置的标签相交则隐藏；已压到顶栏而隐藏的不参与放置
      const order = shown.filter((i) => i !== activeIndex).sort((a, b) => a - b)
      if (shown.includes(activeIndex)) order.unshift(activeIndex)
      const placed = []
      for (const i of order) {
        if (topClipped[i]) {
          crowded[i] = false
          continue
        }
        const b = boxes[i]
        // 已隐藏的标签按外扩 hysteresis 的框判断，拉开足够距离才重新显示
        const pad = crowded[i] ? hysteresis : 0
        crowded[i] = placed.some(
          (o) =>
            b.left - pad < o.right &&
            b.right + pad > o.left &&
            b.top - pad < o.bottom &&
            b.bottom + pad > o.top
        )
        if (!crowded[i]) placed.push(b)
      }

      // 第三步：统一写入 class 与引线长度
      for (const i of shown) {
        const el = labels[i]
        const nextHidden = topClipped[i] || crowded[i]
        if (nextHidden !== hidden[i]) {
          hidden[i] = nextHidden
          el.classList.toggle("is-clipped", nextHidden)
        }
        // 引线写入保留 1 位小数；变化不足 0.5 px 不写，避免每帧改内联样式。
        // 但缩到最短、或恢复默认时即使变化很小也写入，保证停下来时的最终值准确
        const r = Math.round(boxes[i].lead * 10) / 10
        if (
          r !== leads[i] &&
          (Math.abs(r - leads[i]) >= 0.5 || r === minLeadR || r === 0)
        ) {
          leads[i] = r
          if (r) el.style.setProperty("--lead", `${r}px`)
          else el.style.removeProperty("--lead")
        }
      }
    },
    dispose() {
      mainGeo.dispose()
      normalGeo.dispose()
      stemGeo.dispose()
      labels.forEach((el) => el.remove())
    }
  }
}

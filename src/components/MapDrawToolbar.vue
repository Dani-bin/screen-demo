<template>
  <!-- 地图标绘工具栏：标绘工具 + 部署工具 + 调度按钮，可在多个页面复用 -->
  <div class="map-draw-toolbar-wrap">
    <div class="map-draw-toolbar">
    <!-- 标绘工具组（点、旗帜、箭头、多段线、多边形等） -->
    <div class="tool-group">
      <div v-for="tool in topDrawTools" :key="tool.key" class="tool-item"
        :class="{ active: activeDrawTool === tool.key }" :title="tool.name" @click="selectDrawTool(tool.key)">
        <svg v-if="tool.icon === 'pin'" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
          stroke-width="2">
          <path
            d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
        </svg>
        <svg v-else-if="tool.icon === 'flag'" viewBox="0 0 24 24" width="20" height="20" fill="none"
          stroke="currentColor" stroke-width="2">
          <path
            d="M4 15c1-1 2.5-1 3.5-1s2.5 1 3.5 1 2.5-1 3.5-1h2V4h-2c-1 0-2.5 1-3.5 1S11 4 10 4 7.5 5 6.5 5H4v17h2" />
        </svg>
        <svg v-else-if="tool.icon === 'arrow'" viewBox="0 0 24 24" width="20" height="20" fill="none"
          stroke="currentColor" stroke-width="2">
          <path d="M5 19L19 5M19 5H10M19 5v9" />
        </svg>
        <svg v-else-if="tool.icon === 'line'" viewBox="0 0 24 24" width="20" height="20" fill="none"
          stroke="currentColor" stroke-width="2">
          <circle cx="6" cy="18" r="2" fill="currentColor" />
          <circle cx="18" cy="6" r="2" fill="currentColor" />
          <line x1="7.4" y1="16.6" x2="16.6" y2="7.4" />
        </svg>
        <svg v-else-if="tool.icon === 'hexagon'" viewBox="0 0 24 24" width="20" height="20" fill="none"
          stroke="currentColor" stroke-width="2">
          <polygon points="12,2 21,7.2 21,16.8 12,22 3,16.8 3,7.2" />
        </svg>
        <svg v-else-if="tool.icon === 'rectangle'" viewBox="0 0 24 24" width="20" height="20" fill="none"
          stroke="currentColor" stroke-width="2">
          <rect x="4" y="4" width="16" height="16" rx="1" />
        </svg>
        <svg v-else-if="tool.icon === 'circle'" viewBox="0 0 24 24" width="20" height="20" fill="none"
          stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="8" />
        </svg>
        <svg v-else-if="tool.icon === 'triangle'" viewBox="0 0 24 24" width="20" height="20" fill="none"
          stroke="currentColor" stroke-width="2">
          <polygon points="4,4 4,20 20,20" />
        </svg>
        <svg v-else-if="tool.icon === 'text'" viewBox="0 0 24 24" width="20" height="20" fill="none"
          stroke="currentColor" stroke-width="2">
          <path d="M5 19L11 5h2l6 14M7 14h10" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
    </div>

    <div class="toolbar-divider"></div>

    <!-- 部署应用工具组（被困人员、救援车、消防车） -->
    <div class="tool-group">
      <div v-for="tool in topActionTools" :key="tool.key" class="tool-item custom-tool"
        :class="{ active: activeRightTool === tool.key }" :title="tool.name" @click="selectRightTool(tool.key)">
        <img :src="tool.icon" :alt="tool.name" />
      </div>
    </div>

    <div class="toolbar-divider"></div>

    <!-- 快速调度触发按钮 -->
    <div class="dispatch-btn" @click="emitDispatch('team')">队伍调度</div>
    <div class="dispatch-btn" @click="emitDispatch('material')">物资调度</div>
    </div>

    <!-- 子面板：根据当前工具显示「旗帜图片选择」或「粗细 + 颜色选择」 -->
    <div v-if="showSubPanel" class="draw-sub-panel">
      <!-- 旗帜：仅图片选择，无颜色 -->
      <template v-if="showFlagPanel">
        <div v-for="f in FLAG_IMAGES" :key="f.key" class="flag-item" :class="{ active: selectedFlagKey === f.key }"
          :title="`旗帜 ${f.key}`" @click="setFlag(f.key)">
          <img :src="f.url" :alt="`flag-${f.key}`" />
        </div>
      </template>
      <!-- 其它标绘：粗细 + 颜色 -->
      <template v-else>
        <div class="width-group">
          <div v-for="w in WIDTHS" :key="w" class="width-item" :class="{ active: selectedWidth === w }"
            :title="`线宽 ${w}`" @click="setWidth(w)">
            <span class="width-dot" :style="{ width: (w + 4) + 'px', height: (w + 4) + 'px' }"></span>
          </div>
        </div>
        <div class="sub-divider"></div>
        <div class="color-group">
          <div v-for="c in PALETTE" :key="c" class="color-item" :class="{ active: selectedColor === c }"
            :style="{ background: c }" :title="c" @click="setColor(c)"></div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from "vue"
import { ElMessageBox } from "element-plus"
import {
  MAP_DRAW_STYLE,
  MAP_POLYLINE_STYLE,
  calculateArrowPoints,
  createTextLabel,
  renderSavedLayers
} from "@/utils/mapDrawHelpers"
import { uploadResponseLayer, getResponseLayerList, deleteResponseLayer } from "@/api/commandDispatch"

const props = defineProps({
  /** 百度地图 GL 实例，由父页面地图初始化完成后传入 */
  map: {
    type: Object,
    default: null
  },
  /**
   * 关联的预案 ID，绘制完成后上报图层接口需要
   * 缺省时与项目其他位置保持一致占位 280
   */
  planId: {
    type: [Number, String],
    default: null
  }
})

const emit = defineEmits(["dispatch"])

const activeDrawTool = ref(null)
const activeRightTool = ref(null)

/**
 * bmap-draw 由 bmap-draw 库支持的标绘工具 key
 * 注：marker 已从这里移除——bmap-draw 的 MarkerDraw 会渲染库内置图标，
 * 与"默认使用百度地图自带水滴 marker"的需求不符。改用 CUSTOM 路径，
 * 在 handleMapClick 里 new BMapGL.Marker(latlng) 即用百度默认图标。
 */
const BMAP_DRAW_TOOLS = [
  "line",
  "polygon",
  "rectangle",
  "circle",
  "triangle"
]
/** 需自定义地图事件处理的标绘工具 key */
const CUSTOM_DRAW_TOOLS = ["marker", "flag", "arrow", "text"]

const topDrawTools = [
  { key: "marker", name: "标注点", icon: "pin" },
  { key: "flag", name: "旗帜", icon: "flag" },
  { key: "arrow", name: "箭头", icon: "arrow" },
  { key: "line", name: "多段线", icon: "line" },
  { key: "polygon", name: "多边形", icon: "hexagon" },
  { key: "rectangle", name: "矩形", icon: "rectangle" },
  { key: "circle", name: "圆形", icon: "circle" },
  { key: "triangle", name: "三角形", icon: "triangle" },
  { key: "text", name: "文字", icon: "text" }
]

const topActionTools = [
  {
    key: "trapped",
    name: "被困人员",
    icon: new URL("@/assets/images/sydp/trapped_person.svg", import.meta.url)
      .href
  },
  {
    key: "rescue_vehicle",
    name: "救援车",
    icon: new URL("@/assets/images/sydp/rescue_vehicle.svg", import.meta.url)
      .href
  },
  {
    key: "fire_truck",
    name: "消防车",
    icon: new URL("@/assets/images/sydp/fire_truck.svg", import.meta.url).href
  }
]

/* ===== 颜色 / 粗细 / 旗帜图片 选择 ===== */

/**
 * 需要"颜色 + 粗细"选择的工具集合：
 * 即除第一个（标注点 marker）和最后 3 个部署工具外的标绘工具，且不含旗帜（旗帜走图片选择）
 */
const STYLE_TOOLS = ["arrow", "line", "polygon", "rectangle", "circle", "triangle", "text"]

/** 可选颜色（与设计稿一致：红 / 橙 / 绿 / 蓝 / 紫 / 黑 / 白） */
const PALETTE = [
  "#f5222d",
  "#fa8c16",
  "#52c41a",
  "#1890ff",
  "#722ed1",
  "#000000",
  "#ffffff"
]
/** 可选线宽（细 / 中 / 粗） */
const WIDTHS = [2, 4, 6]

/** 旗帜图片（旗帜工具专用，三种颜色旗） */
const FLAG_IMAGES = [
  { key: "b", url: new URL("@/assets/images/sydp/flag-b.svg", import.meta.url).href },
  { key: "g", url: new URL("@/assets/images/sydp/flag-g.svg", import.meta.url).href },
  { key: "y", url: new URL("@/assets/images/sydp/flag-y.svg", import.meta.url).href }
]

/** 当前选中的颜色 / 线宽 / 旗帜 */
const selectedColor = ref("#1890ff")
const selectedWidth = ref(4)
const selectedFlagKey = ref("b")
const selectedFlagUrl = computed(
  () =>
    FLAG_IMAGES.find(f => f.key === selectedFlagKey.value)?.url ||
    FLAG_IMAGES[0].url
)

/** 子面板显隐：颜色粗细面板 / 旗帜图片面板 */
const showStylePanel = computed(() => STYLE_TOOLS.includes(activeDrawTool.value))
const showFlagPanel = computed(() => activeDrawTool.value === "flag")
const showSubPanel = computed(() => showStylePanel.value || showFlagPanel.value)

/** 线宽 → 文字字号映射（细 12 / 中 14 / 粗 16） */
const widthToFontSize = w => 10 + w

/** 多边形 / 矩形 / 圆 / 三角 的动态样式（描边 + 填充用当前颜色，线宽用当前粗细） */
const shapeStyle = () => ({
  ...MAP_DRAW_STYLE,
  strokeColor: selectedColor.value,
  strokeWeight: selectedWidth.value,
  fillColor: selectedColor.value
})
/** 多段线 / 箭头 的动态样式（仅描边） */
const lineStyle = () => ({
  ...MAP_POLYLINE_STYLE,
  strokeColor: selectedColor.value,
  strokeWeight: selectedWidth.value
})

/** 旗帜图标：用选中的旗帜图片生成 BMapGL.Icon（锚点贴旗杆底部） */
const makeFlagIcon = url =>
  new BMapGL.Icon(url, new BMapGL.Size(36, 36), {
    anchor: new BMapGL.Size(10, 32)
  })

/** 切换颜色：若当前正在用 bmap-draw 工具，则重启绘制以应用新样式 */
const setColor = c => {
  selectedColor.value = c
  refreshActiveBmapDraw()
}
/** 切换线宽：同上 */
const setWidth = w => {
  selectedWidth.value = w
  refreshActiveBmapDraw()
}
/** 切换旗帜图片 */
const setFlag = key => {
  selectedFlagKey.value = key
}
/** 若当前激活的是 bmap-draw 工具，重启以应用最新颜色/粗细（箭头/文字在绘制时实时读取，无需重启） */
const refreshActiveBmapDraw = () => {
  if (BMAP_DRAW_TOOLS.includes(activeDrawTool.value)) {
    startBmapDraw(activeDrawTool.value)
  }
}

/** bmap-draw 绘制场景与各 Draw 实例引用 */
let drawScene = null
let currentDraw = null
let OperateEventType = null
/** 当前 Draw 实例绑定的完成/取消回调，关闭前需先解绑以防递归触发 */
let onDrawCompleteHandler = null
let onDrawCancelHandler = null
/**
 * 绘制开始前的 overlay 快照
 * 用途：bmap-draw 的 CircleDraw / RectDraw 在 COMPLETE 事件 / Draw 实例上都不暴露
 * 生成的主图形 overlay 引用，导致 extractBmapDrawGeometry / attachEditableLabel 拿不到。
 * 这里抓一份开始前的 overlays 集合，结束时 diff 出新增的覆盖物兜底拿 overlay。
 */
let beforeDrawOverlays = null

/** 箭头拖拽绘制状态 */
let isDrawingArrow = false
let arrowStartPoint = null
let tempArrowPolyline = null

/** 自定义工具绑定的地图事件处理器引用，便于解绑 */
let mapClickHandler = null
let mapMouseDownHandler = null
let mapMouseMoveHandler = null
let mapMouseUpHandler = null

/** bmap-draw 通用配置：跳过后续编辑、关闭测距提示 */
const commonDrawOpts = {
  isSeries: false,
  skipEditing: true,
  enableCalculate: false,
  hideTip: true,
  isOnMap: true
}

/**
 * 已绘制图层的累积数组：每完成一次绘制就 push 一项，
 * 上报接口时整组序列化为 JSON 字符串，覆盖式提交到后端
 *   - 结构：[{ type, points, props? }, ...]
 *   - 生命周期：组件存活期间一直累积；组件卸载时自动随实例释放
 */
const drawnLayers = []

/**
 * 上报序号：每次调用 uplayer 接口时 +1，表明这是第几次提交，
 * 便于后端识别"覆盖更新"的版本顺序
 */
let layerSortCounter = 0

/**
 * 把 BMapGL.Point 数组归一为 [{lng, lat}] 简洁格式，便于 JSON 序列化
 */
const toLatLngList = path =>
  (path || []).map(p => ({ lng: p.lng, lat: p.lat }))

/**
 * 根据工具类型 + bmap-draw 实例 + 事件对象，提取几何信息
 * 兼容四种数据来源：外部传入 overlay（diff 兜底）→ 事件 e.overlay → currentDraw.overlay → currentDraw.points
 */
const extractBmapDrawGeometry = (key, draw, evt, externalOverlay) => {
  const overlay = externalOverlay || evt?.overlay || draw?.overlay
  switch (key) {
    case "line":
    case "polygon":
    case "triangle":
    case "rectangle": {
      let path = []
      if (overlay?.getPath) path = overlay.getPath()
      else if (Array.isArray(draw?.points)) path = draw.points
      const points = toLatLngList(path)
      return points.length ? { type: key, points } : null
    }
    case "circle": {
      const c = overlay?.getCenter?.()
      const r = overlay?.getRadius?.()
      if (!c) return null
      return {
        type: "circle",
        points: [{ lng: c.lng, lat: c.lat }],
        props: { radius: r }
      }
    }
    default:
      return null
  }
}

/**
 * 兼容 bmap-draw 部分 Draw 类不暴露 overlay：通过 diff 绘制前后 map.getOverlays() 找回主图形
 * - circle  → BMapGL.Circle 实例
 * - line    → BMapGL.Polyline 实例
 * - polygon / triangle / rectangle → BMapGL.Polygon 实例
 *   bmap-draw 绘制过程中可能附加顶点 marker 等辅助物，按实例类型筛掉它们；命中不上时返回 null
 */
const pickDrawnOverlay = (key, beforeSet) => {
  if (!beforeSet || !props.map?.getOverlays) return null
  const news = props.map.getOverlays().filter(o => !beforeSet.has(o))
  if (!news.length) return null

  if (key === "circle") {
    return news.find(o => o instanceof BMapGL.Circle) || null
  }
  if (key === "line") {
    return news.find(o => o instanceof BMapGL.Polyline) || null
  }
  if (["polygon", "triangle", "rectangle"].includes(key)) {
    return news.find(o => o instanceof BMapGL.Polygon) || null
  }
  return null
}

/**
 * 绘制完成回调：把新图形追加到累积数组，并把"完整图层数组"上报到 uplayer 接口
 *   - layerJson 是 JSON 数组字符串，包含到目前为止所有已绘制图形
 *   - 失败时仅 console.warn，避免大屏画面被错误提示打断
 */
const saveLayer = (layer, overlay = null, extras = []) => {
  if (!layer || !layer.type) return
  if (!Array.isArray(layer.points) || !layer.points.length) return

  drawnLayers.push(layer)

  // 传入覆盖物引用时，注册"点击可删除"，并保留 layer 关联以便删除后同步上报
  // extras：与该图层一起需要被删除的附属覆盖物（如旗帜的文本说明框）
  if (overlay) registerDeletableOverlay(overlay, layer, extras)

  reuploadLayers()
}

/** 把当前 drawnLayers 整组覆盖式上报到 uplayer 接口（失败仅告警，不打断大屏） */
const reuploadLayers = () => {

  uploadResponseLayer({
    planId: props.planId,
    layerJson: JSON.stringify(drawnLayers),
    sort: ++layerSortCounter
  }).catch(err => {
    console.warn("[MapDrawToolbar] 上传响应图层失败：", err)
  })
}
/** 把当前 drawnLayers 整组覆盖式上报到 uplayer 接口（失败仅告警，不打断大屏） */
const removeLayer = (id) => {

  deleteResponseLayer({
    id: id
  }).catch(err => {
    console.warn("[MapDrawToolbar] 删除响应图层失败：", err)
  })
}

/**
 * 文本说明框点击编辑（旗帜自带文本框）：空闲态下弹框修改文字
 * @param {BMapGL.Label} label 文本标注实例
 * @param {Object} layer 关联图层数据（更新其 props.text 并重新上报）
 */
const editTextLabel = (label, layer) => {
  if (activeDrawTool.value || activeRightTool.value || isDrawingArrow) return
  ElMessageBox.prompt("编辑文字说明", {
    confirmButtonText: "确定",
    cancelButtonText: "取消",
    inputValue: layer?.props?.text || "",
    customClass: "map-text-label-prompt"
  })
    .then(({ value }) => {
      const text = (value || "").trim()
      if (!text) return
      label.setContent(text)
      if (layer && layer.props) layer.props.text = text
      reuploadLayers()
    })
    .catch(() => { })
}

/** 文本说明框默认占位文案 */
const DEFAULT_LABEL_TEXT = "点击编辑文字"

/** 点状覆盖物的类型集合（用放置点作锚点；其余面/线状用外接框底部中心） */
const POINT_LIKE_TYPES = [
  "marker",
  "flag",
  "text",
  "trapped",
  "rescue_vehicle",
  "fire_truck"
]

/**
 * 计算覆盖物"下方"的锚点经纬度
 *   - 点状覆盖物：取放置点（图标锚点在底部，即覆盖物底部）
 *   - 面/线状覆盖物：取外接矩形的底部中心
 */
const getOverlayBottomPoint = (overlay, type, fallbackPoint) => {
  if (POINT_LIKE_TYPES.includes(type)) {
    return fallbackPoint || overlay?.getPosition?.() || null
  }
  // 圆：底部 = 圆心向正南移动一个半径（纬度 1° ≈ 111000m）
  if (type === "circle" && overlay?.getCenter && overlay?.getRadius) {
    const c = overlay.getCenter()
    const r = overlay.getRadius()
    if (c && isFinite(r)) {
      return new BMapGL.Point(c.lng, c.lat - r / 111000)
    }
  }
  if (overlay?.getBounds) {
    const b = overlay.getBounds()
    if (b?.getSouthWest && b?.getNorthEast) {
      const sw = b.getSouthWest()
      const ne = b.getNorthEast()
      return new BMapGL.Point((sw.lng + ne.lng) / 2, sw.lat)
    }
  }
  return fallbackPoint || null
}

/**
 * 不依赖 overlay 引用，仅基于 layer 几何数据计算"下方锚点"。
 *
 * 为什么需要这条路径：bmap-draw 的部分 Draw 类（实测圆 / 矩形）在 COMPLETE 事件中
 * 没有把生成的 overlay 通过 evt.overlay / currentDraw.overlay 暴露出来，导致原先
 * 走 getOverlayBottomPoint 的路径拿不到 pos → label 不创建。
 * 这个函数只读 layer.points / layer.props.radius，对所有图形类型都稳定可用。
 */
const getLayerBottomPoint = layer => {
  if (!layer || !Array.isArray(layer.points) || !layer.points.length) {
    return null
  }
  const { type, points, props: lp } = layer

  // 圆：圆心(points[0]) + 半径(props.radius) → 圆心正南方向半径处
  if (type === "circle" && lp?.radius != null) {
    const c = points[0]
    const r = Number(lp.radius)
    if (c && isFinite(c.lng) && isFinite(c.lat) && isFinite(r) && r > 0) {
      return new BMapGL.Point(c.lng, c.lat - r / 111000)
    }
  }

  // 点状（marker / flag / text / 部署工具）：直接用第一个点
  if (POINT_LIKE_TYPES.includes(type)) {
    const p = points[0]
    if (p && isFinite(p.lng) && isFinite(p.lat)) {
      return new BMapGL.Point(p.lng, p.lat)
    }
  }

  // 线 / 面（line / polygon / triangle / rectangle 等）：所有顶点外接框底部中心
  let minLat = Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const p of points) {
    if (!p || !isFinite(p.lng) || !isFinite(p.lat)) continue
    if (p.lat < minLat) minLat = p.lat
    if (p.lng < minLng) minLng = p.lng
    if (p.lng > maxLng) maxLng = p.lng
  }
  if (isFinite(minLat) && isFinite(minLng) && isFinite(maxLng)) {
    return new BMapGL.Point((minLng + maxLng) / 2, minLat)
  }
  return null
}

/**
 * 在覆盖物下方 10px 处创建可编辑文本说明框
 *   - 默认文案"点击编辑文字"，点击文本框可修改
 *   - 文本同步写入 layer.props.text，便于上报与删除联动
 *   - 位置优先用 layer 几何数据计算（更可靠，不依赖 bmap-draw 是否暴露 overlay）
 * @returns {BMapGL.Label|null} 创建的文本标注（供 saveLayer 作为附属覆盖物一起管理）
 */
const attachEditableLabel = (overlay, type, layer, fallbackPoint) => {
  // 优先用 layer 几何数据计算锚点；overlay 路径作为兼容回退（如 marker/flag 由 handleMapClick 直接 new，
  // 这条路径下 fallbackPoint 是点击的经纬度，比从 marker.getPosition 读取更省事）
  const pos =
    getLayerBottomPoint(layer) ||
    getOverlayBottomPoint(overlay, type, fallbackPoint)
  if (!pos || !props.map) return null

  const text = DEFAULT_LABEL_TEXT
  // 估算文本宽度用于水平居中；offset.y=10 使文本框位于覆盖物下方 10px
  const approxWidth = text.length * 12 + 20
  const label = new BMapGL.Label(text, {
    position: pos,
    offset: new BMapGL.Size(-approxWidth / 2, 2)
  })
  label.setStyle({
    color: "#00CEEA",
    backgroundColor: "rgba(16, 28, 48, 0.95)",
    border: "1px solid #00CEEA",
    borderRadius: "4px",
    padding: "3px 10px",
    fontSize: "12px",
    cursor: "pointer"
  })

  if (layer) {
    layer.props = layer.props || {}
    if (layer.props.text == null) layer.props.text = text
  }
  // 点击文本框 → 编辑（空闲态）
  label.addEventListener("click", () => editTextLabel(label, layer))
  props.map.addOverlay(label)
  return label
}

/**
 * 已绘制覆盖物与其图层数据的关联表：[{ overlay, layer, extras }]
 * 用于"点击选中删除"：删除时同时移除地图覆盖物（含附属 extras）、drawnLayers 中的对应项并重新上报
 */
const placedOverlays = []

/** 给覆盖物绑定点击事件，使其在空闲态下可被点选删除 */
const registerDeletableOverlay = (overlay, layer, extras = []) => {
  
  if (!overlay || typeof overlay.addEventListener !== "function") return
  // 记录创建时刻：在 handleOverlayClick 内做时间窗判定，防止"刚绘制完成的覆盖物"
  // 因为 mouseup 紧跟派发的 click 事件被误判为"点击删除"
  const entry = { overlay, layer, extras, createdAt: Date.now() }
  placedOverlays.push(entry)
  overlay.addEventListener("click", () => handleOverlayClick(entry))
}

/**
 * 覆盖物点击：仅在"空闲态"（未选中任何标绘/部署工具、且未在拖拽画箭头）下
 * 才弹出确认删除；否则把点击让给正在进行的绘制流程，不打断绘制
 */
const handleOverlayClick = entry => {
  if (activeDrawTool.value || activeRightTool.value || isDrawingArrow) return
  // 防御性时间窗：刚绘制完成的覆盖物 300ms 内忽略 click。
  // 适用场景：箭头通过 mousedown→mouseup 拖拽绘制，松手时刚 saveLayer 绑好 click，
  // BMapGL 紧跟就在该位置派发一次 click → 此时 activeDrawTool 已被重置为 null →
  // 若不拦截会直接进入删除确认框，体验上等于"画完就问你要不要删"。
  if (entry.createdAt && Date.now() - entry.createdAt < 300) return
  ElMessageBox.confirm("确认删除该标绘吗？", "删除标绘", {
    confirmButtonText: "删除",
    cancelButtonText: "取消",
    type: "warning"
  })
    .then(() => removePlacedOverlay(entry))
    .catch(() => { })
}

/**
 * 把本工具栏画到地图上的所有覆盖物（含附属物）从地图上移除，并清空注册表。
 * 共享地图模式下页面切走（组件卸载）时调用，避免标绘残留在共享地图上。
 * @param {BMapGL.Map} [mapInstance] 目标地图，缺省用 props.map
 */
const clearAllDrawnOverlays = mapInstance => {
  const map = mapInstance || props.map
  if (map) {
    placedOverlays.forEach(entry => {
      try {
        if (entry.overlay) map.removeOverlay(entry.overlay)
        ;(entry.extras || []).forEach(o => o && map.removeOverlay(o))
      } catch (e) {
        // 单个覆盖物移除失败不阻断其余清理
        console.warn("[MapDrawToolbar] 移除覆盖物失败：", e)
      }
    })
  }
  placedOverlays.length = 0
  drawnLayers.length = 0
}

/** 删除单个已绘制覆盖物：移除地图覆盖物 + 同步 drawnLayers 并重新上报 */
const removePlacedOverlay = entry => {
  if (!entry) return
  // 1. 从地图移除覆盖物（含附属 extras，如旗帜的文本说明框）
  if (props.map) {
    if (entry.overlay) props.map.removeOverlay(entry.overlay)
    ;(entry.extras || []).forEach(o => o && props.map.removeOverlay(o))
  }
  // 2. 从已放置关联表移除
  const oi = placedOverlays.indexOf(entry)
  if (oi > -1) placedOverlays.splice(oi, 1)
  // 3. 从图层数组移除对应项，并把更新后的图层重新上报（覆盖式提交）
  const li = drawnLayers.indexOf(entry.layer)
  if (li > -1) {
    drawnLayers.splice(li, 1)
    // 4. 判断是否存在ID，不存在则表示新增图层，需要上报
    const layer = entry.layer
    if (layer.id) {
      // 存在ID，直接删除
      removeLayer(layer.id)
    }else{
      // 新增图层，需要上报
      reuploadLayers()
    }
  }
}

/** 初始化 bmap-draw 绘制场景（需在 BMapGL 加载后动态 import） */
const initDrawScene = async mapInstance => {
  const bmapDraw = await import("bmap-draw")
  OperateEventType = bmapDraw.OperateEventType
  drawScene = new bmapDraw.DrawScene(mapInstance, {
    baseOpts: MAP_DRAW_STYLE,
    drawCursor: "crosshair"
  })
}

/** 解绑当前 Draw 实例上的 COMPLETE/CANCEL 监听，避免 closeAll 再次触发回调 */
const detachDrawListeners = () => {
  if (!currentDraw || !OperateEventType) return
  if (onDrawCompleteHandler) {
    currentDraw.removeEventListener(
      OperateEventType.COMPLETE,
      onDrawCompleteHandler
    )
  }
  if (onDrawCancelHandler) {
    currentDraw.removeEventListener(
      OperateEventType.CANCEL,
      onDrawCancelHandler
    )
  }
  onDrawCompleteHandler = null
  onDrawCancelHandler = null
}

/** 关闭 DrawScene 遮罩层 */
const closeDrawScene = () => {
  if (drawScene) {
    drawScene.closeRunningAction()
    drawScene.close()
  }
}

/** 强制中断当前绘制（切换/取消工具时调用） */
const closeBmapDraw = () => {
  if (currentDraw) {
    detachDrawListeners()
    currentDraw.closeAll?.()
    currentDraw = null
  }
  closeDrawScene()
}

/**
 * 绘制自然完成（或被取消）后的清理：
 *   - 解绑当前 Draw 实例的回调（防止 closeAll → COMPLETE → closeAll 递归）
 *   - 保留 activeDrawTool 选中态，并异步重启同一绘制类型，实现"连续绘制"
 *   - shouldSave=true 时（COMPLETE）抽取几何信息并调用 uplayer 接口保存；
 *     CANCEL 路径只清理状态，不上报
 */
const handleDrawComplete = (evt, shouldSave = false) => {
  const key = activeDrawTool.value

  // 在清理 currentDraw 引用前抓取几何信息上报，避免后续读取空指针
  if (shouldSave && key && BMAP_DRAW_TOOLS.includes(key)) {
    // 优先按事件 / Draw 实例约定字段拿 overlay；拿不到再 diff 快照兜底
    // （实测 CircleDraw / RectDraw 走这条兜底路径才能拿到主图形）
    let overlay = evt?.overlay || currentDraw?.overlay || null
    if (!overlay) overlay = pickDrawnOverlay(key, beforeDrawOverlays)

    const layer = extractBmapDrawGeometry(key, currentDraw, evt, overlay)
    if (layer) {
      // 图形下方 10px 自带可编辑文本说明框，删除图形时一并移除
      // const label = attachEditableLabel(overlay, key, layer)
      saveLayer(layer, overlay,  [])
      
      // 多边形绘制完成后自动弹出输入框设置名称
      if (key === "polygon" && label && layer) {
        editTextLabel(label, layer)
      }
    }
  }

  // 无论 COMPLETE 还是 CANCEL，绘制流程结束后释放快照，避免下次绘制误用旧集合
  beforeDrawOverlays = null

  detachDrawListeners()
  currentDraw = null
  closeDrawScene()

  // 单次绘制完成（或取消）后取消选中：用户需要继续绘制必须重新点击工具
  // 不再像之前那样异步重新 open 同一工具来实现连续绘制
  if (key && BMAP_DRAW_TOOLS.includes(key)) {
    activeDrawTool.value = null
  }
}

/** 重置工具选中状态（含强制中断进行中的绘制） */
const resetDrawTool = () => {
  activeDrawTool.value = null
  closeBmapDraw()
  unbindCustomMapEvents()
}

/** 启动 bmap-draw 内置标绘工具 */
const startBmapDraw = async key => {
  if (!drawScene || !props.map) return

  const bmapDraw = await import("bmap-draw")
  closeBmapDraw()

  // 抓一份"绘制前 overlays 快照"：COMPLETE 时若拿不到 overlay 引用就用它 diff 出主图形
  beforeDrawOverlays = new Set(props.map.getOverlays?.() || [])

  const attachComplete = draw => {
    // COMPLETE：调用 handleDrawComplete(e, true) 触发上报
    // CANCEL：仅清理，不上报，避免无效图形被保存
    onDrawCompleteHandler = e => handleDrawComplete(e, true)
    onDrawCancelHandler = () => handleDrawComplete(null, false)
    draw.addEventListener(
      bmapDraw.OperateEventType.COMPLETE,
      onDrawCompleteHandler
    )
    draw.addEventListener(
      bmapDraw.OperateEventType.CANCEL,
      onDrawCancelHandler
    )
  }

  switch (key) {
    case "line":
      currentDraw = new bmapDraw.PolylineDraw(drawScene, {
        ...commonDrawOpts,
        baseOpts: lineStyle()
      })
      break
    case "polygon":
      currentDraw = new bmapDraw.PolygonDraw(drawScene, {
        ...commonDrawOpts,
        baseOpts: shapeStyle()
      })
      break
    case "triangle": {
      // 复用多边形绘制流程，限制只能点击 3 个顶点
      currentDraw = new bmapDraw.PolygonDraw(drawScene, {
        ...commonDrawOpts,
        baseOpts: shapeStyle(),
        limitPoint: 3
      })
      const originalStartAction = currentDraw.startAction.bind(currentDraw)
      currentDraw.startAction = e => {
        originalStartAction(e)
        // bmap-draw 内置 limitPoint 仅对 polyline 自动结束，三角形需在第 3 点手动触发闭合
        if (currentDraw.points.length >= 3) {
          currentDraw.dblclickAction(e)
        }
      }
      break
    }
    case "rectangle":
      currentDraw = new bmapDraw.RectDraw(drawScene, {
        ...commonDrawOpts,
        baseOpts: shapeStyle()
      })
      break
    case "circle":
      currentDraw = new bmapDraw.CircleDraw(drawScene, {
        ...commonDrawOpts,
        baseOpts: shapeStyle()
      })
      break
    default:
      return
  }

  attachComplete(currentDraw)
  currentDraw.open()
}

/** 解绑自定义地图事件 */
const unbindCustomMapEvents = () => {
  if (!props.map) return
  if (mapClickHandler) {
    props.map.removeEventListener("click", mapClickHandler)
    mapClickHandler = null
  }
  if (mapMouseDownHandler) {
    props.map.removeEventListener("mousedown", mapMouseDownHandler)
    mapMouseDownHandler = null
  }
  if (mapMouseMoveHandler) {
    props.map.removeEventListener("mousemove", mapMouseMoveHandler)
    mapMouseMoveHandler = null
  }
  if (mapMouseUpHandler) {
    props.map.removeEventListener("mouseup", mapMouseUpHandler)
    mapMouseUpHandler = null
  }
}

/** 绑定自定义地图事件（旗帜/箭头/文字/部署工具） */
const bindCustomMapEvents = () => {
  if (!props.map) return
  unbindCustomMapEvents()

  mapClickHandler = handleMapClick
  mapMouseDownHandler = handleMapMouseDown
  mapMouseMoveHandler = handleMapMouseMove
  mapMouseUpHandler = handleMapMouseUp

  props.map.addEventListener("click", mapClickHandler)
  props.map.addEventListener("mousedown", mapMouseDownHandler)
  props.map.addEventListener("mousemove", mapMouseMoveHandler)
  props.map.addEventListener("mouseup", mapMouseUpHandler)
}

/** 地图点击：处理标注点、旗帜、文字及部署实体 */
const handleMapClick = e => {
  if (!e.latlng) return

  if (activeDrawTool.value === "marker") {
    // 不传 icon，使用百度地图自带的默认水滴 marker
    const marker = new BMapGL.Marker(e.latlng)
    props.map.addOverlay(marker)
    const layer = {
      type: "marker",
      points: [{ lng: e.latlng.lng, lat: e.latlng.lat }]
    }
    // 标注点下方 10px 自带可编辑文本说明框
    const label = attachEditableLabel(marker, "marker", layer, e.latlng)
    saveLayer(layer, marker, label ? [label] : [])
    // 单次完成后取消选中：继续打点需重新点击工具图标
    activeDrawTool.value = null
    unbindCustomMapEvents()
    return
  }

  if (activeDrawTool.value === "flag") {
    // 旗帜图标使用当前选中的旗帜图片
    const pt = e.latlng
    const marker = new BMapGL.Marker(pt, { icon: makeFlagIcon(selectedFlagUrl.value) })
    props.map.addOverlay(marker)

    const layer = {
      type: "flag",
      points: [{ lng: pt.lng, lat: pt.lat }],
      props: { flag: selectedFlagKey.value }
    }
    // 旗帜下方 10px 自带可编辑文本说明框
    const label = attachEditableLabel(marker, "flag", layer, pt)
    // 旗帜 marker 可点击删除，删除时一并移除其文本框
    saveLayer(layer, marker, label ? [label] : [])
    // 单次完成后取消选中：继续插旗需重新点击工具图标
    activeDrawTool.value = null
    unbindCustomMapEvents()
    return
  }

  if (activeDrawTool.value === "text") {
    const clickPoint = e.latlng
    ElMessageBox.prompt("添加文字标注", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      inputPlaceholder: "例如：河道险工段段长部署点",
      customClass: "map-text-label-prompt"
    })
      .then(({ value }) => {
        const text = value && value.trim()
        if (text) {
          // 文字标注应用当前选中的颜色与字号（粗细 → 字号）
          const label = createTextLabel(text, clickPoint, {
            color: selectedColor.value,
            fontSize: widthToFontSize(selectedWidth.value)
          })
          props.map.addOverlay(label)
          saveLayer(
            {
              type: "text",
              points: [{ lng: clickPoint.lng, lat: clickPoint.lat }],
              props: {
                text,
                color: selectedColor.value,
                fontSize: widthToFontSize(selectedWidth.value)
              }
            },
            label
          )
        }
      })
      .catch(() => { })
      .finally(() => {
        // 单次完成（或用户取消）后取消选中：继续标注需重新点击工具图标
        // 由于 prompt 是异步的，必须放在 finally 里，覆盖 then / catch 两条路径
        activeDrawTool.value = null
        unbindCustomMapEvents()
      })
    return
  }

  if (activeRightTool.value) {
    const tool = topActionTools.find(t => t.key === activeRightTool.value)
    let size = new BMapGL.Size(24, 24)
    if (activeRightTool.value === "fire_truck") {
      size = new BMapGL.Size(52, 32)
    } else if (activeRightTool.value === "rescue_vehicle") {
      size = new BMapGL.Size(32, 32)
    }
    const icon = new BMapGL.Icon(tool.icon, size)
    const marker = new BMapGL.Marker(e.latlng, { icon })
    props.map.addOverlay(marker)
    // 部署工具也保存为图层：type 用部署工具 key（trapped / rescue_vehicle / fire_truck）
    saveLayer(
      {
        type: activeRightTool.value,
        points: [{ lng: e.latlng.lng, lat: e.latlng.lat }]
      },
      marker
    )
    activeRightTool.value = null
    unbindCustomMapEvents()
  }
}

/** 箭头绘制：鼠标按下开始 */
const handleMapMouseDown = e => {
  if (activeDrawTool.value !== "arrow" || !e.latlng) return
  isDrawingArrow = true
  arrowStartPoint = e.latlng
  props.map.disableDragging()
  // 箭头应用当前选中的颜色与粗细
  tempArrowPolyline = new BMapGL.Polyline([e.latlng, e.latlng], lineStyle())
  props.map.addOverlay(tempArrowPolyline)
}

/** 箭头绘制：拖拽预览 */
const handleMapMouseMove = e => {
  if (
    !isDrawingArrow ||
    !arrowStartPoint ||
    !tempArrowPolyline ||
    !e.latlng
  ) {
    return
  }
  const points = calculateArrowPoints(props.map, arrowStartPoint, e.latlng)
  if (points.length > 0) {
    tempArrowPolyline.setPath(points)
  }
}

/** 箭头绘制：鼠标松开完成 */
const handleMapMouseUp = e => {
  if (!isDrawingArrow) return
  props.map.enableDragging()

  if (arrowStartPoint && e.latlng) {
    const distance = props.map.getDistance(arrowStartPoint, e.latlng)
    if (distance < 5) {
      // 起止点重合视为误触，移除临时折线并放弃保存
      if (tempArrowPolyline) {
        props.map.removeOverlay(tempArrowPolyline)
      }
    } else {
      const points = calculateArrowPoints(
        props.map,
        arrowStartPoint,
        e.latlng
      )
      if (points.length > 0 && tempArrowPolyline) {
        tempArrowPolyline.setPath(points)
        // 只保存"起点 + 终点"两关键点，渲染时由前端再算出箭头翼瓣
        const layer = {
          type: "arrow",
          points: [
            { lng: arrowStartPoint.lng, lat: arrowStartPoint.lat },
            { lng: e.latlng.lng, lat: e.latlng.lat }
          ]
        }
        // 箭头下方 10px 自带可编辑文本说明框
        // const label = attachEditableLabel(tempArrowPolyline, "arrow", layer)
        saveLayer(layer, tempArrowPolyline,  [])
      }
    }
  }

  // 重置箭头本身的临时绘制状态
  isDrawingArrow = false
  arrowStartPoint = null
  tempArrowPolyline = null
  // 单次完成（含误触）后取消选中：继续画箭头需重新点击工具图标
  activeDrawTool.value = null
  unbindCustomMapEvents()
}

/** 切换标绘工具 */
const selectDrawTool = key => {
  if (activeDrawTool.value === key) {
    resetDrawTool()
    return
  }

  activeDrawTool.value = key
  activeRightTool.value = null
  closeBmapDraw()
  unbindCustomMapEvents()

  if (BMAP_DRAW_TOOLS.includes(key)) {
    startBmapDraw(key)
  } else if (CUSTOM_DRAW_TOOLS.includes(key)) {
    bindCustomMapEvents()
  }
}

/** 切换部署工具 */
const selectRightTool = key => {
  if (activeRightTool.value === key) {
    activeRightTool.value = null
    unbindCustomMapEvents()
    return
  }

  activeRightTool.value = key
  activeDrawTool.value = null
  closeBmapDraw()
  bindCustomMapEvents()
}

/** 向父组件抛出调度事件 */
const emitDispatch = type => {
  emit("dispatch", type)
}

/**
 * 加载已保存的响应图层（页面加载时调用）
 */
const loadSavedLayers = async () => {
  const map = props.map
  if (!map) return

  try {
    const res = await getResponseLayerList({ planId: props.planId })
    const responseList = Array.isArray(res?.data) ? res.data : []

    if (!Array.isArray(responseList)) {
      console.warn("[MapDrawToolbar] 图层数据格式不正确")
      return
    }

    // 解析 layerJson 字段，提取所有图层
    const allLayers = []
    for (const item of responseList) {
      if (!item || !item.layerJson) continue

      try {
        const parsedLayers = JSON.parse(item.layerJson)
        const layerId = item.id
        if (Array.isArray(parsedLayers)) {
          allLayers.push(...parsedLayers.map(layer => ({ ...layer, id: layerId })))
        }
      } catch (err) {
        console.warn("[MapDrawToolbar] 解析 layerJson 失败：", err)
      }
    }

    if (!allLayers.length) {
      console.log("[MapDrawToolbar] 没有找到已保存的图层")
      return
    }

    // 渲染已保存的图层
    const rendered = renderSavedLayers(map, allLayers)
    
    // 更新 drawnLayers 数组，保持与后端同步
    drawnLayers.length = 0
    drawnLayers.push(...allLayers)
    
    // 更新 layerSortCounter 为最新值
    if (responseList.length > 0) {
      const maxSort = Math.max(...responseList.map(l => Number(l.sort) || 0))
      layerSortCounter = maxSort
    }
    // 注册已渲染的图层为可删除
    rendered.forEach(({ layer, overlay, extras }) => {
      if (overlay) {
        registerDeletableOverlay(overlay, layer, extras)
      }
    })

    console.log(`[MapDrawToolbar] 已加载 ${allLayers.length} 个图层`)
  } catch (err) {
    console.warn("[MapDrawToolbar] 加载已保存图层失败：", err)
  }
}

watch(
  () => props.map,
  (mapInstance, oldMap) => {
    // 地图被替换 / 置空时，先把画在旧地图上的标绘清掉（共享地图模式防残留）
    if (oldMap && oldMap !== mapInstance) {
      clearAllDrawnOverlays(oldMap)
    }
    if (mapInstance) {
      initDrawScene(mapInstance)
      loadSavedLayers()
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  resetDrawTool()
  // 共享地图模式：组件卸载（页面切走）时把自己画的标绘从地图上清掉
  clearAllDrawnOverlays()
  drawScene = null
  OperateEventType = null
})
</script>

<style lang="scss" scoped>
/* 外层容器：负责定位，纵向排列工具栏与子面板 */
.map-draw-toolbar-wrap {
  position: absolute;
  top: 96px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  user-select: none;
}

.map-draw-toolbar {
  display: flex;
  align-items: center;
  background: rgba(16, 28, 48, 0.85);
  border: 1px solid rgba(0, 206, 234, 0.35);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.65),
    inset 0 0 12px rgba(0, 206, 234, 0.15);
  border-radius: 8px;
  padding: 6px 16px;
  gap: 12px;
  user-select: none;

  .tool-group {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .tool-item {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    color: #a4c2db;
    cursor: pointer;
    transition: all 0.25s ease-in-out;

    svg {
      width: 18px;
      height: 18px;
      display: block;
    }

    img {
      width: 22px;
      height: 22px;
      object-fit: contain;
    }

    &:hover {
      color: #00ceea;
      background: rgba(0, 206, 234, 0.15);
      transform: scale(1.08);
    }

    &.active {
      color: #ffffff;
      background: #00ceea;
      box-shadow: 0 0 10px rgba(0, 206, 234, 0.5);
    }
  }

  .toolbar-divider {
    width: 1px;
    height: 20px;
    background: rgba(255, 255, 255, 0.2);
    margin: 0 4px;
  }

  .dispatch-btn {
    padding: 4px 12px;
    border: 1px solid rgba(0, 206, 234, 0.5);
    border-radius: 4px;
    font-size: 13px;
    color: #00ceea;
    background: rgba(0, 206, 234, 0.05);
    cursor: pointer;
    transition: all 0.25s ease-in-out;
    font-weight: 500;
    white-space: nowrap;

    &:hover {
      background: #00ceea;
      color: #ffffff;
      box-shadow: 0 0 10px rgba(0, 206, 234, 0.4);
      transform: translateY(-1px);
    }

    &:active {
      transform: translateY(0);
    }
  }
}

/* 子面板：颜色 / 粗细 / 旗帜图片 选择 */
.draw-sub-panel {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  background: rgba(16, 28, 48, 0.85);
  border: 1px solid rgba(0, 206, 234, 0.35);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.65),
    inset 0 0 12px rgba(0, 206, 234, 0.15);
  border-radius: 8px;

  .sub-divider {
    width: 1px;
    height: 20px;
    background: rgba(255, 255, 255, 0.2);
    margin: 0 2px;
  }

  /* 旗帜图片选项 */
  .flag-item {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 0.2s ease;

    img {
      width: 24px;
      height: 24px;
      object-fit: contain;
    }

    &:hover {
      background: rgba(0, 206, 234, 0.15);
    }

    &.active {
      border-color: #00ceea;
      background: rgba(0, 206, 234, 0.2);
      box-shadow: 0 0 8px rgba(0, 206, 234, 0.4);
    }
  }

  /* 粗细选项 */
  .width-group {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .width-item {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 0.2s ease;

    .width-dot {
      display: block;
      border-radius: 50%;
      background: #c0d6e8;
    }

    &:hover {
      background: rgba(0, 206, 234, 0.15);
    }

    &.active {
      border-color: #00ceea;
      background: rgba(0, 206, 234, 0.2);

      .width-dot {
        background: #00ceea;
      }
    }
  }

  /* 颜色选项 */
  .color-group {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .color-item {
    width: 20px;
    height: 20px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.25);
    cursor: pointer;
    transition: all 0.2s ease;

    &:hover {
      transform: scale(1.12);
    }

    &.active {
      border-color: #00ceea;
      box-shadow: 0 0 0 2px rgba(0, 206, 234, 0.5);
    }
  }
}
</style>

<!-- MessageBox 挂载在 body 下，需用非 scoped 样式定制输入框边框 -->
<style lang="scss">
.map-text-label-prompt.el-message-box {
  .el-message-box__input {
    padding-top: 10px;

    .el-input__wrapper {
      border: 1px solid #dcdfe6;
      box-shadow: none;
      border-radius: 4px;
      padding: 8px 12px;
    }

    .el-input__wrapper.is-focus {
      border-color: #00ceea;
      box-shadow: 0 0 0 1px rgba(0, 206, 234, 0.25);
    }

    .el-input__inner {
      height: 48px;
      line-height: 48px;
      color: #303133;

      &::placeholder {
        color: #afafaf;
        opacity: 1;
      }
    }
  }
}
</style>

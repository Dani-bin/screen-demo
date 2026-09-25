/**
 * 调度路线绘制工具
 *
 * 把"起点 marker + 终点 marker + 虚线 Polyline + 中点任务标签"封装成纯函数，
 * 由两处共享：
 *   1. EmergencyResponsePanel.vue —— 点击"显示路线"手动展示后端记录的路线
 *   2. commandDispatch / specialCommand 调度页面 —— 创建调度任务后自动绘制
 *
 * 颜色与样式延续原 EmergencyResponsePanel.showRoute 的设定：物资绿 / 队伍蓝。
 */
import { MAP_POLYLINE_STYLE } from "./mapDrawHelpers"
import startIconUrl from "@/assets/images/sydp/start.png"
import endIconUrl from "@/assets/images/sydp/end.png"

/** 调度类型 → 路线主色 */
const strokeColorByType = type => (type === "物资" ? "#3fc882" : "#2f88ff")

/** 轨迹动画配置 */
const TRAIL_CONFIG = {
  dashArray: [8, 6],      // 虚线样式：[实线长度, 间隙长度]
  animationSpeed: 0.003,  // 每帧前进比例（调慢）
  lightSize: 5            // 光点大小（最小）
}

/**
 * 绘制一条调度路线（起点 marker + 终点 marker + 虚线 Polyline + 中点 Label）
 * 起止任一经纬度非法直接返回 null，调用方需做空值兼容。
 *
 * @param {BMapGL.Map} map 地图实例
 * @param {object} params
 * @param {number|string} params.startLng / params.startLat
 * @param {number|string} params.endLng   / params.endLat
 * @param {string} [params.startName]     起点名（用于中点 Label 文案 "${startName}调度任务"）
 * @param {"物资"|"队伍"} [params.type]   调度类型，决定线条颜色
 * @param {boolean} [params.fitView=false] 绘制后是否自动 setViewport 调整视野
 *                                         （单条展示场景设 true；批量场景由外部统一 setViewport）
 * @returns {object|null} 句柄
 */
export function drawDispatchRoute(map, params = {}) {
  if (!map) return null
  const startLng = parseFloat(params.startLng)
  const startLat = parseFloat(params.startLat)
  const endLng = parseFloat(params.endLng)
  const endLat = parseFloat(params.endLat)
  if (
    !isFinite(startLng) ||
    !isFinite(startLat) ||
    !isFinite(endLng) ||
    !isFinite(endLat)
  ) {
    return null
  }

  const startLatLng = { lng: startLng, lat: startLat }
  const endLatLng = { lng: endLng, lat: endLat }
  const strokeColor = strokeColorByType(params.type)
  const highlightColor = params.type === "物资" ? "#6ef7a4" : "#6bb3ff"

  // 起点 marker：底部锚点对齐经纬度位置
  const startIcon = new BMapGL.Icon(startIconUrl, new BMapGL.Size(32, 30), {
    anchor: new BMapGL.Size(16, 36)
  })
  const startMarker = new BMapGL.Marker(
    new BMapGL.Point(startLng, startLat),
    { icon: startIcon }
  )
  map.addOverlay(startMarker)

  // 终点 marker
  const endIcon = new BMapGL.Icon(endIconUrl, new BMapGL.Size(32, 36), {
    anchor: new BMapGL.Size(16, 36)
  })
  const endMarker = new BMapGL.Marker(
    new BMapGL.Point(endLng, endLat),
    { icon: endIcon }
  )
  map.addOverlay(endMarker)

  // 创建虚线线段（起点 → 终点）
  const startPoint = new BMapGL.Point(startLng, startLat)
  const endPoint = new BMapGL.Point(endLng, endLat)
  
  const polyline = new BMapGL.Polyline([startPoint, endPoint], {
    ...MAP_POLYLINE_STYLE,
    strokeColor,
    strokeWeight: 3,
    strokeOpacity: 0.85,
    strokeStyle: "dashed",
    strokeDashArray: TRAIL_CONFIG.dashArray
  })
  map.addOverlay(polyline)

  // 启动轨迹动画（流动光点效果）
  const animationHandle = startTrailAnimation(map, startPoint, endPoint, strokeColor)

  // 中点任务名称标签：${startName}调度任务，过长截断 16 字
  const startNameRaw = params.startName || ""
  const startNameShort =
    startNameRaw.length > 16 ? startNameRaw.slice(0, 16) + "…" : startNameRaw
  const taskLabelText = `${startNameShort}调度任务`
  // 估算文本宽度用于水平居中（中文 ≈14px 一字 + 左右各 10px padding）
  const approxLabelWidth = taskLabelText.length * 14 + 20
  const taskLabel = new BMapGL.Label(taskLabelText, {
    position: new BMapGL.Point(
      (startLng + endLng) / 2,
      (startLat + endLat) / 2
    ),
    offset: new BMapGL.Size(-approxLabelWidth / 2, -14)
  })
  taskLabel.setStyle({
    color: strokeColor,
    backgroundColor: "rgba(16, 28, 48, 0.95)",
    border: `1px solid ${strokeColor}`,
    borderRadius: "6px",
    padding: "4px 12px",
    fontSize: "12px",
    fontWeight: "500",
    whiteSpace: "nowrap",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
    display: "none" // 默认隐藏标签
  })
  map.addOverlay(taskLabel)

  // 鼠标悬停交互
  let isHovered = false
  
  const handleMouseEnter = () => {
    if (isHovered) return
    isHovered = true
    
    // 显示标签
    taskLabel.setStyle({ display: "block" })
    // 高亮线段
    if (polyline) {
      polyline.setStrokeColor(highlightColor)
      polyline.setStrokeWeight(5)
      polyline.setStrokeOpacity(1)
    }
    // 高亮 marker
    if (startMarker) {
      startMarker.setZIndex(1000)
    }
    if (endMarker) {
      endMarker.setZIndex(1000)
    }
  }

  const handleMouseLeave = () => {
    isHovered = false
    
    // 隐藏标签
    taskLabel.setStyle({ display: "none" })
    // 恢复线段样式
    if (polyline) {
      polyline.setStrokeColor(strokeColor)
      polyline.setStrokeWeight(3)
      polyline.setStrokeOpacity(0.85)
    }
    // 恢复 marker z-index
    if (startMarker) {
      startMarker.setZIndex(1)
    }
    if (endMarker) {
      endMarker.setZIndex(1)
    }
  }

  // 为起点 marker 添加悬停事件
  startMarker.addEventListener("mouseover", handleMouseEnter)
  startMarker.addEventListener("mouseout", handleMouseLeave)

  // 为终点 marker 添加悬停事件
  endMarker.addEventListener("mouseover", handleMouseEnter)
  endMarker.addEventListener("mouseout", handleMouseLeave)

  // 为线段添加悬停事件
  if (polyline) {
    polyline.addEventListener("mouseover", handleMouseEnter)
    polyline.addEventListener("mouseout", handleMouseLeave)
  }

  if (params.fitView) {
    map.setViewport([
      new BMapGL.Point(startLng, startLat),
      new BMapGL.Point(endLng, endLat)
    ])
  }

  return {
    startMarker,
    endMarker,
    polyline,
    taskLabel,
    startLatLng,
    endLatLng,
    animationHandle
  }
}

/**
 * 启动轨迹动画
 * 使用百度地图的 Label 创建光点效果
 */
function startTrailAnimation(map, startPoint, endPoint, color) {
  if (!map) return null
  
  // 固定使用橘黄色作为光点颜色
  const lightColor = '#ff9500'
  
  // 创建光点 Label - 使用 0 偏移，通过 CSS transform 居中
  const lightLabel = new BMapGL.Label('', {
    position: startPoint,
    offset: new BMapGL.Size(0, 0)
  })
  
  lightLabel.setStyle({
    width: TRAIL_CONFIG.lightSize + 'px',
    height: TRAIL_CONFIG.lightSize + 'px',
    borderRadius: '50%',
    backgroundColor: lightColor,
    boxShadow: `0 0 ${TRAIL_CONFIG.lightSize * 1.5}px ${lightColor}, 0 0 ${TRAIL_CONFIG.lightSize * 2.5}px ${lightColor}88`,
    opacity: '0.9',
    border: 'none',
    padding: '0',
    margin: '0',
    cursor: 'default',
    pointerEvents: 'none',
    zIndex: '9999',
    transform: 'translate(-50%, -50%)',
    left: '50%',
    top: '50%'
  })
  
  map.addOverlay(lightLabel)
  
  let progress = 0
  let animationId = null
  
  // 动画帧函数
  const animate = () => {
    progress = (progress + TRAIL_CONFIG.animationSpeed) % 1
    
    // 计算当前位置（线性插值）
    const currentLng = startPoint.lng + (endPoint.lng - startPoint.lng) * progress
    const currentLat = startPoint.lat + (endPoint.lat - startPoint.lat) * progress
    
    // 更新光点位置
    lightLabel.setPosition(new BMapGL.Point(currentLng, currentLat))
    
    // 动态调整光点大小（5px → 8px）和透明度
    const size = TRAIL_CONFIG.lightSize + Math.sin(progress * Math.PI) * 3
    const opacity = 0.7 + Math.sin(progress * Math.PI) * 0.3
    
    lightLabel.setStyle({
      width: size + 'px',
      height: size + 'px',
      opacity: opacity.toString(),
      boxShadow: `0 0 ${size * 1.5}px ${lightColor}, 0 0 ${size * 2.5}px ${lightColor}88`,
      transform: 'translate(-50%, -50%)'
    })
    
    animationId = requestAnimationFrame(animate)
  }
  
  // 启动动画
  animationId = requestAnimationFrame(animate)
  
  return { 
    animationId,
    stop: () => {
      if (animationId) {
        cancelAnimationFrame(animationId)
      }
      try {
        map.removeOverlay(lightLabel)
      } catch (e) {
        // 忽略移除错误
      }
    }
  }
}

/**
 * 清除一条已绘制的调度路线（移除起 / 终点 marker、线段、Label）
 * @param {BMapGL.Map} map
 * @param {object} handle drawDispatchRoute 的返回值
 */
export function clearDispatchRoute(map, handle) {
  if (!map || !handle) return
  
  // 停止动画
  if (handle.animationHandle && handle.animationHandle.stop) {
    handle.animationHandle.stop()
  }
  
  // 移除事件监听器
  if (handle.startMarker) {
    handle.startMarker.removeEventListener("mouseover", () => {})
    handle.startMarker.removeEventListener("mouseout", () => {})
    map.removeOverlay(handle.startMarker)
  }
  if (handle.endMarker) {
    handle.endMarker.removeEventListener("mouseover", () => {})
    handle.endMarker.removeEventListener("mouseout", () => {})
    map.removeOverlay(handle.endMarker)
  }
  if (handle.polyline) {
    handle.polyline.removeEventListener("mouseover", () => {})
    handle.polyline.removeEventListener("mouseout", () => {})
    map.removeOverlay(handle.polyline)
  }
  if (handle.taskLabel) map.removeOverlay(handle.taskLabel)
}

/**
 * 缩放后更新线段（两点线段会自动适应地图缩放）
 */
export function recomputeRouteArrow(map, handle) {
  // 两点线段不需要重新计算
}
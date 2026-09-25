/**
 * 地图标绘辅助函数：箭头路径计算、旗帜/三角形等 bmap-draw 未内置的图形生成
 */

/** 大屏主题色标绘样式 */
export const MAP_DRAW_STYLE = {
  strokeColor: "#00CEEA",
  strokeWeight: 3,
  strokeOpacity: 0.9,
  strokeStyle: "solid",
  fillColor: "#00CEEA",
  fillOpacity: 0.15
}

/** 多段线专用样式（线宽略粗） */
export const MAP_POLYLINE_STYLE = {
  ...MAP_DRAW_STYLE,
  strokeWeight: 4
}

/**
 * 根据起点和终点，在像素坐标系中计算带箭头翼瓣的 Polyline 路径
 * @param {BMapGL.Map} map 地图实例
 * @param {Object} startLatlng 起点 { lng, lat }
 * @param {Object} endLatlng 终点 { lng, lat }
 * @param {Object} [options] 可选参数
 * @param {number} [options.arrowLength=16] 翼瓣像素长度
 * @param {number} [options.arrowAngle=Math.PI/5] 翼瓣张开半角
 * @param {number} [options.startShrink=0] 起点向终点方向回退的像素，避免被起点图标遮住
 * @param {number} [options.endShrink=0]   终点向起点方向回退的像素，避免被终点图标遮住
 */
export function calculateArrowPoints(map, startLatlng, endLatlng, options = {}) {
  if (!map) return []

  const pStart = map.pointToPixel(
    new BMapGL.Point(startLatlng.lng, startLatlng.lat)
  )
  const pEnd = map.pointToPixel(new BMapGL.Point(endLatlng.lng, endLatlng.lat))

  const dx = pEnd.x - pStart.x
  const dy = pEnd.y - pStart.y
  const length = Math.sqrt(dx * dx + dy * dy)
  if (length === 0) return []

  // 优化箭头参数
  const arrowLength = options.arrowLength ?? 16
  const arrowAngle = options.arrowAngle ?? Math.PI / 5 // 36度角，更尖锐的箭头
  const startShrink = Math.max(0, options.startShrink ?? 0)
  const endShrink = Math.max(0, options.endShrink ?? 0)

  // 在像素坐标系下沿方向向量收缩端点
  let totalShrink = startShrink + endShrink
  let startK = startShrink
  let endK = endShrink
  if (totalShrink >= length) {
    const safe = Math.max(0, length - 1)
    startK = (startShrink / totalShrink) * safe
    endK = (endShrink / totalShrink) * safe
  }
  const ux = dx / length
  const uy = dy / length
  const sx = pStart.x + ux * startK
  const sy = pStart.y + uy * startK
  const ex = pEnd.x - ux * endK
  const ey = pEnd.y - uy * endK

  // 翼瓣基于"收缩后的方向向量"反算，保证翼瓣依然贴合实际线段方向
  const angle = Math.atan2(ey - sy, ex - sx)
  
  // 计算箭头翼瓣点
  const xLeft = ex - arrowLength * Math.cos(angle - arrowAngle)
  const yLeft = ey - arrowLength * Math.sin(angle - arrowAngle)
  const xRight = ex - arrowLength * Math.cos(angle + arrowAngle)
  const yRight = ey - arrowLength * Math.sin(angle + arrowAngle)

  // 计算箭头中心线上的点，用于形成更平滑的箭头
  const midOffset = arrowLength * 0.4
  const midX = ex - ux * midOffset
  const midY = ey - uy * midOffset

  const ptStart = map.pixelToPoint({ x: sx, y: sy })
  const ptEnd = map.pixelToPoint({ x: ex, y: ey })
  const ptLeft = map.pixelToPoint({ x: xLeft, y: yLeft })
  const ptRight = map.pixelToPoint({ x: xRight, y: yRight })
  const ptMid = map.pixelToPoint({ x: midX, y: midY })

  // 返回优化后的箭头路径：主体线 + 箭头翼瓣
  // 路径：起点 -> 箭头根部中心点 -> 终点 -> 左翼 -> 终点 -> 右翼
  return [ptStart, ptMid, ptEnd, ptLeft, ptEnd, ptRight]
}

/** 创建旗帜 Marker 图标 */
export function createFlagIcon() {
  const flagSvg = `data:image/svg+xml;utf8,<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 3v26M6 6h18l-4 5 4 5H6" stroke="%23E90F24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="%23E90F24" fill-opacity="0.5"/></svg>`
  return new BMapGL.Icon(flagSvg, new BMapGL.Size(32, 32), {
    anchor: new BMapGL.Size(6, 29)
  })
}

/**
 * 创建文字标注 Label
 * @param {string} text 文本内容
 * @param {Object} position BMapGL.Point 位置
 * @param {Object} [options] 样式参数
 * @param {string} [options.color="#00CEEA"] 文字与边框颜色
 * @param {number} [options.fontSize=12] 字号（px）
 */
export function createTextLabel(text, position, options = {}) {
  const { color = "#00CEEA", fontSize = 12 } = options
  const textLabel = new BMapGL.Label(text, {
    position,
    offset: new BMapGL.Size(-30, -10)
  })
  textLabel.setStyle({
    color,
    backgroundColor: "rgba(16, 28, 48, 0.95)",
    border: `1px solid ${color}`,
    borderRadius: "4px",
    padding: "3px 10px",
    fontSize: `${fontSize}px`,
    cursor: "pointer"
  })
  return textLabel
}

/**
 * 旗帜图片配置
 */
const FLAG_IMAGES = {
  b: "data:image/svg+xml;utf8,<svg width='36' height='36' viewBox='0 0 36 36' fill='none' xmlns='http://www.w3.org/2000/svg'><path d='M10 3v30M10 8h20l-5 6 5 6H10' stroke='%231890ff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' fill='%231890ff' fill-opacity='0.6'/></svg>",
  g: "data:image/svg+xml;utf8,<svg width='36' height='36' viewBox='0 0 36 36' fill='none' xmlns='http://www.w3.org/2000/svg'><path d='M10 3v30M10 8h20l-5 6 5 6H10' stroke='%2352c41a' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' fill='%2352c41a' fill-opacity='0.6'/></svg>",
  y: "data:image/svg+xml;utf8,<svg width='36' height='36' viewBox='0 0 36 36' fill='none' xmlns='http://www.w3.org/2000/svg'><path d='M10 3v30M10 8h20l-5 6 5 6H10' stroke='%23faad14' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' fill='%23faad14' fill-opacity='0.6'/></svg>"
}

/**
 * 创建旗帜图标
 */
function makeFlagIcon(flagKey) {
  const url = FLAG_IMAGES[flagKey] || FLAG_IMAGES.b
  return new BMapGL.Icon(url, new BMapGL.Size(36, 36), {
    anchor: new BMapGL.Size(10, 32)
  })
}

/**
 * 将图层坐标点转换为 BMapGL.Point 数组
 */
function toPointArray(points) {
  if (!Array.isArray(points)) return []
  return points.map(p => {
    if (p && isFinite(p.lng) && isFinite(p.lat)) {
      return new BMapGL.Point(p.lng, p.lat)
    }
    return null
  }).filter(Boolean)
}

/**
 * 渲染单个图层
 * @param {BMapGL.Map} map 地图实例
 * @param {Object} layer 图层数据
 * @returns {Object} 包含 overlay 和附属元素的对象
 */
export function renderLayer(map, layer) {
  if (!map || !layer || !layer.type || !layer.points || !layer.points.length) {
    return null
  }

  const points = toPointArray(layer.points)
  if (!points.length) return null

  const props = layer.props || {}
  const overlayInfo = { overlay: null, extras: [] }

  switch (layer.type) {
    case "marker": {
      const marker = new BMapGL.Marker(points[0])
      map.addOverlay(marker)
      overlayInfo.overlay = marker
      break
    }

    case "flag": {
      const flagKey = props.flag || "b"
      const marker = new BMapGL.Marker(points[0], { icon: makeFlagIcon(flagKey) })
      map.addOverlay(marker)
      overlayInfo.overlay = marker
      break
    }

    case "arrow": {
      if (points.length < 2) return null
      const arrowPoints = calculateArrowPoints(map, { lng: layer.points[0].lng, lat: layer.points[0].lat }, { lng: layer.points[1].lng, lat: layer.points[1].lat })
      if (!arrowPoints.length) return null
      const polyline = new BMapGL.Polyline(arrowPoints, MAP_POLYLINE_STYLE)
      map.addOverlay(polyline)
      overlayInfo.overlay = polyline
      break
    }

    case "line": {
      const polyline = new BMapGL.Polyline(points, MAP_POLYLINE_STYLE)
      map.addOverlay(polyline)
      overlayInfo.overlay = polyline
      break
    }

    case "polygon":
    case "rectangle":
    case "triangle": {
      const polygon = new BMapGL.Polygon(points, MAP_DRAW_STYLE)
      map.addOverlay(polygon)
      overlayInfo.overlay = polygon
      break
    }

    case "circle": {
      const center = points[0]
      const radius = props.radius || 100
      const circle = new BMapGL.Circle(center, radius, MAP_DRAW_STYLE)
      map.addOverlay(circle)
      overlayInfo.overlay = circle
      break
    }

    case "text": {
      const text = props.text || ""
      const color = props.color || "#00CEEA"
      const fontSize = props.fontSize || 12
      const label = createTextLabel(text, points[0], { color, fontSize })
      map.addOverlay(label)
      overlayInfo.overlay = label
      break
    }

    case "trapped":
    case "rescue_vehicle":
    case "fire_truck": {
      const iconUrl = getDeployToolIcon(layer.type)
      let size = new BMapGL.Size(24, 24)
      if (layer.type === "fire_truck") {
        size = new BMapGL.Size(52, 32)
      } else if (layer.type === "rescue_vehicle") {
        size = new BMapGL.Size(32, 32)
      }
      const icon = new BMapGL.Icon(iconUrl, size)
      const marker = new BMapGL.Marker(points[0], { icon })
      map.addOverlay(marker)
      overlayInfo.overlay = marker
      break
    }

    default:
      console.warn(`[renderLayer] 未知图层类型: ${layer.type}`)
      return null
  }

  // 如果有文字标注，添加到附属元素
  if (props.text && overlayInfo.overlay) {
    const label = attachLabelToOverlay(map, overlayInfo.overlay, layer.type, layer, points[0])
    if (label) {
      overlayInfo.extras.push(label)
    }
  }

  return overlayInfo
}

/**
 * 获取部署工具图标
 */
function getDeployToolIcon(type) {
  const icons = {
    trapped: "data:image/svg+xml;utf8,<svg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'><circle cx='12' cy='10' r='3' fill='%23f5222d'/><path d='M12 13v8M8 17l4-4 4 4' stroke='%23f5222d' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>",
    rescue_vehicle: "data:image/svg+xml;utf8,<svg width='32' height='32' viewBox='0 0 32 32' fill='none' xmlns='http://www.w3.org/2000/svg'><rect x='4' y='10' width='24' height='14' rx='2' stroke='%231890ff' stroke-width='2' fill='%231890ff' fill-opacity='0.2'/><circle cx='8' cy='24' r='3' fill='%23333'/><circle cx='24' cy='24' r='3' fill='%23333'/><path d='M8 14h16' stroke='%231890ff' stroke-width='1.5'/></svg>",
    fire_truck: "data:image/svg+xml;utf8,<svg width='52' height='32' viewBox='0 0 52 32' fill='none' xmlns='http://www.w3.org/2000/svg'><rect x='4' y='8' width='44' height='16' rx='2' stroke='%23f5222d' stroke-width='2' fill='%23f5222d' fill-opacity='0.2'/><circle cx='10' cy='24' r='4' fill='%23333'/><circle cx='42' cy='24' r='4' fill='%23333'/><path d='M20 12h12' stroke='%23f5222d' stroke-width='1.5'/></svg>"
  }
  return icons[type] || icons.trapped
}

/**
 * 给覆盖物添加文字标注
 */
function attachLabelToOverlay(map, overlay, type, layer, fallbackPoint) {
  const pos = getLayerBottomPoint(layer) || fallbackPoint
  if (!pos) return null

  const text = layer.props?.text || "点击编辑文字"
  const approxWidth = text.length * 12 + 20
  const label = new BMapGL.Label(text, {
    position: pos,
    offset: new BMapGL.Size(-approxWidth / 2, 10)
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
  map.addOverlay(label)
  return label
}

/**
 * 计算图层底部点（用于放置文字标注）
 */
function getLayerBottomPoint(layer) {
  if (!layer || !Array.isArray(layer.points) || !layer.points.length) {
    return null
  }
  const { type, points, props } = layer

  if (type === "circle" && props?.radius != null) {
    const c = points[0]
    const r = Number(props.radius)
    if (c && isFinite(c.lng) && isFinite(c.lat) && isFinite(r) && r > 0) {
      return new BMapGL.Point(c.lng, c.lat - r / 111000)
    }
  }

  const pointLikeTypes = ["marker", "flag", "text", "trapped", "rescue_vehicle", "fire_truck"]
  if (pointLikeTypes.includes(type)) {
    const p = points[0]
    if (p && isFinite(p.lng) && isFinite(p.lat)) {
      return new BMapGL.Point(p.lng, p.lat)
    }
  }

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
 * 批量渲染已保存的图层
 * @param {BMapGL.Map} map 地图实例
 * @param {Array} layers 图层列表
 * @returns {Array} 渲染结果列表
 */
export function renderSavedLayers(map, layers) {
  if (!map || !Array.isArray(layers)) return []

  const results = []
  for (const layer of layers) {
    const result = renderLayer(map, layer)
    if (result) {
      results.push({ layer, ...result })
    }
  }
  return results
}

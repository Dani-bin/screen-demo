/**
 * 低洼地带绘制层渲染
 *
 * 后端 `additionalAttributes` 字段是后台用 DrawingManager 画的图形 JSON 字符串。
 * 新格式（对象，**当前主用**）：
 *   {
 *     center: { lng, lat },           // 后台保存时的地图中心
 *     zoom:   12.5,                    // 后台保存时的地图缩放
 *     overlays: [
 *       { type: "Polygon",  pathList: [...], style: { strokeColor, fillColor, ... } },
 *       { type: "Polyline", pathList: [...], style: {...} },
 *       { type: "Circle",   center: {lng,lat}, radius: 8055, style: {...} },
 *       { type: "Marker",   position: {lng,lat}, iconType: "shelter" | "rescue" | "hospital" | "marker", style: {...} }
 *     ]
 *   }
 * 旧格式（数组，向下兼容）：直接是 overlay 列表，无 style/iconType。
 *
 * 渲染策略：
 *   - Polygon/Polyline/Circle 优先使用接口 style 字段中的颜色/边宽/透明度等
 *   - Marker 的 iconType 通过外部传入的 iconMap 映射为分类 SVG 图标，
 *     未命中则使用 BMapGL 默认 marker
 *   - 如调用方要求 fitView，优先使用后端保存的 center+zoom（最精准），
 *     否则回退到根据全部坐标 setViewport
 */

/** Polygon / Polyline / Circle 默认样式（接口 style 缺省时兜底） */
const DEFAULTS = {
  polygon: {
    strokeColor: "#1890ff",
    strokeWeight: 2,
    strokeOpacity: 0.8,
    fillColor: "#1890ff",
    fillOpacity: 0.2,
    strokeStyle: "solid"
  },
  polyline: {
    strokeColor: "#4FC3F7",
    strokeWeight: 4,
    strokeOpacity: 0.9,
    strokeStyle: "solid"
  },
  circle: {
    strokeColor: "#2BCE6B",
    strokeWeight: 2,
    strokeOpacity: 0.9,
    fillColor: "transparent",
    fillOpacity: 0,
    strokeStyle: "solid"
  }
}

/** 合并接口 style 与默认值，缺省字段用默认 */
const mergeStyle = (style, defaults) => ({
  strokeColor: style?.strokeColor ?? defaults.strokeColor,
  strokeWeight: style?.strokeWeight ?? defaults.strokeWeight,
  strokeOpacity: style?.strokeOpacity ?? defaults.strokeOpacity,
  fillColor: style?.fillColor ?? defaults.fillColor,
  fillOpacity: style?.fillOpacity ?? defaults.fillOpacity,
  strokeStyle: style?.strokeStyle ?? defaults.strokeStyle
})

/** 判断颜色是否为深色（用于优化黑色河道堤防的显示） */
const isDarkColor = (color) => {
  if (!color) return false
  // 移除 # 号
  const hex = color.replace('#', '')
  // 解析 RGB 值
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)
  // 计算相对亮度 (YIQ 公式)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  // 亮度低于 0.25 视为深色
  return luminance < 0.25
}

/**
 * 单个 drawing → BMapGL overlay
 * @returns {{overlay, points}|null}
 */
const buildOverlayFromDrawing = (d, iconMap, options = {}) => {
  const { pointName, categoryKey } = options
  if (!d || !d.type) return null
  

  if (d.type === "Polygon" && Array.isArray(d.pathList) && d.pathList.length) {
    const points = d.pathList.map(p => new BMapGL.Point(p.lng, p.lat))
    const style = mergeStyle(d.style, DEFAULTS.polygon)
    return { overlay: new BMapGL.Polygon(points, style), points }
  }

  if (
    d.type === "Polyline" &&
    Array.isArray(d.pathList) &&
    d.pathList.length
  ) {
    const points = d.pathList.map(p => new BMapGL.Point(p.lng, p.lat))
    // Polyline 没有 fillColor / fillOpacity，只取描边相关字段
    const merged = mergeStyle(d.style, DEFAULTS.polyline)
    
    // 优化颜色：如果是黑色或接近黑色，使用美观的青色系
    let strokeColor = merged.strokeColor
    if (isDarkColor(strokeColor)) {
      strokeColor = "#4FC3F7"
    }
    
    // 调用方可通过 options.polylineWidthBoost 整体加粗（>1 加粗，<1 变细，=1 不变）
    const boost = Number.isFinite(options.polylineWidthBoost)
      ? options.polylineWidthBoost
      : 1
    const boostedWeight = Math.max(2, Math.round(merged.strokeWeight * boost))
    
    const polyline = new BMapGL.Polyline(points, {
      strokeColor: strokeColor,
      strokeWeight: boostedWeight,
      strokeOpacity: merged.strokeOpacity,
      strokeStyle: merged.strokeStyle
    })
    
    // 在 Polyline 中点位置显示点位名称标签
    const result = {
      overlay: polyline,
      points,
      label: null
    }
    if (categoryKey === "人员转移") return result
    if((categoryKey === "海堤" && options.isMidOverlay) || categoryKey !== "海堤" ) {
      // 如果有点位名称且 Polyline 有多个点，在中间位置添加标签
      if (pointName && points.length >= 2) {
        const midIndex = Math.floor(points.length / 2)
        const midPoint = points[midIndex]
        
        const label = new BMapGL.Label(pointName, {
          position: midPoint,
          offset: new BMapGL.Size(-30, -25)
        })
        label.setStyle({
          color: "#fff",
          fontSize: "12px",
          fontWeight: "500",
          backgroundColor: "rgba(33, 150, 243, 0.9)",
          padding: "4px 10px",
          borderRadius: "4px",
          border: "none",
          whiteSpace: "nowrap",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)"
        })
        result.label = label
      }
    }
    
    return result
  }

  if (d.type === "Circle" && d.center && Number.isFinite(d.radius)) {
    const center = new BMapGL.Point(d.center.lng, d.center.lat)
    const style = mergeStyle(d.style, DEFAULTS.circle)
    return {
      overlay: new BMapGL.Circle(center, d.radius, style),
      points: [center]
    }
  }

  if (d.type === "Marker" && d.position) {
    const pt = new BMapGL.Point(d.position.lng, d.position.lat)
    // iconType: 'shelter' | 'rescue' | 'hospital' | 'marker' | 'flag'
    // 通过外部 iconMap 映射到分类自定义 SVG；未配置则使用百度默认 marker
    const iconKey = d.iconType || d.style?.icon
    const iconUrl = iconKey && iconMap ? iconMap[iconKey] : null
    // 物质类小圆点使用 20x20 的紧凑尺寸，其它 marker 用 32x36 默认尺寸
    const size =
      iconKey === "material"
        ? new BMapGL.Size(20, 20)
        : new BMapGL.Size(32, 36)
    const opts = iconUrl
      ? { icon: new BMapGL.Icon(iconUrl, size) }
      : {}
    const marker = new BMapGL.Marker(pt, opts)
    
    // 只在 iconType 为 shelterZy 时显示点位名称标签
    if (iconKey === 'shelterZy' && pointName) {
      const label = new BMapGL.Label(pointName, {
        offset: new BMapGL.Size(-20, -35), // 标签位置调整到图标上方
        position: pt
      })
      label.setStyle({
        color: "#fff",
        fontSize: "12px",
        fontWeight: "500",
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        padding: "4px 8px",
        borderRadius: "4px",
        border: "none",
        whiteSpace: "nowrap"
      })
      marker.setLabel(label)
    }
    
    return { overlay: marker, points: [pt] }
  }

  return null
}

/**
 * 解析后端 additionalAttributes 字段
 * @returns {{overlays: Array, center: {lng,lat}|null, zoom: number|null}}
 */
export const parseAdditionalAttributes = raw => {
  const empty = { overlays: [], center: null, zoom: null }
  if (!raw) return empty
  let parsed = raw
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      console.warn("[low_lying] additionalAttributes 解析失败", e)
      return empty
    }
  }

  // 新格式：{ center, zoom, overlays: [...] }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return {
      overlays: Array.isArray(parsed.overlays) ? parsed.overlays : [],
      center:
        parsed.center && Number.isFinite(parsed.center.lng)
          ? parsed.center
          : null,
      zoom: Number.isFinite(parsed.zoom) ? parsed.zoom : null
    }
  }

  // 旧格式：直接是 overlay 数组
  if (Array.isArray(parsed)) {
    return { overlays: parsed, center: null, zoom: null }
  }

  return empty
}

/**
 * 在地图上渲染低洼地带绘制层
 * @param {object}   map     BMapGL 地图实例
 * @param {Array}    list    后端点位列表，每项含 additionalAttributes
 * @param {object}   options
 * @param {object}   [options.iconMap]  iconType → 图标 URL 的映射表
 * @param {boolean}  [options.fitView]  是否自动调整视野到数据范围
 * @param {number}   [options.polylineWidthBoost]  Polyline 描边宽度倍数（默认 1）
 * @returns {Array} 已添加的 overlay 列表
 */
export const renderLowLyingPoints = (
  map,
  list,
  { iconMap, fitView = false, polylineWidthBoost = 1 } = {}
) => {
  if (!map || !Array.isArray(list)) return []

  const allOverlays = []
  const allPoints = []
  let firstCenter = null
  let firstZoom = null

  list.forEach((point, idx) => {
    const { overlays, center, zoom } = parseAdditionalAttributes(
      point?.additionalAttributes
    )
    // 记下第一条的 center/zoom 作为 fitView 的精准依据
    if (idx === 0) {
      firstCenter = center
      firstZoom = zoom
    }
    // 对于海堤类型，找出所有 Polyline 线段，只在中间线段显示名称
    const categoryKey = point.typeName || ""
    const polylineCount = categoryKey === "海堤" 
      ? overlays.filter(d => d.type === "Polyline").length 
      : 0
    const midPolylineIndex = polylineCount > 0 ? Math.floor(polylineCount / 2) : -1
    
    let polylineIndex = 0
    overlays.forEach(d => {
      // 判断当前是否是中间线段
      const isMidOverlay = categoryKey === "海堤" && d.type === "Polyline" && polylineIndex === midPolylineIndex
      if (d.type === "Polyline") polylineIndex++
      
      const built = buildOverlayFromDrawing(d, iconMap, { 
        polylineWidthBoost,
        pointName: point.pointName || point.name,
        categoryKey: categoryKey,
        isMidOverlay: isMidOverlay
      })
      if (!built) return
      map.addOverlay(built.overlay)
      allOverlays.push(built.overlay)
      // 如果有 label（如 Polyline 的名称标签），也添加到地图并记录
      if (built.label) {
        map.addOverlay(built.label)
        allOverlays.push(built.label)
      }
      if (Array.isArray(built.points)) allPoints.push(...built.points)
    })
  })

  // fitView 策略：
  //   优先使用第一条数据自带的 center+zoom（后台保存时的视野，最精准）
  //   否则用所有坐标的 BMapGL.setViewport 兜底
  if (fitView) {
    if (firstCenter && Number.isFinite(firstZoom)) {
      try {
        map.centerAndZoom(
          new BMapGL.Point(firstCenter.lng, firstCenter.lat),
          firstZoom
        )
      } catch (e) {
        console.warn("[low_lying] centerAndZoom 失败", e)
      }
    } else if (allPoints.length) {
      try {
        map.setViewport(allPoints, {
          margins: [80, 80, 80, 80],
          enableAnimation: true
        })
      } catch (e) {
        console.warn("[low_lying] setViewport 失败", e)
      }
    }
  }

  return allOverlays
}

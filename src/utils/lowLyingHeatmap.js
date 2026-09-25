/**
 * 低洼地带 Demo 热力图：在射阳县周边生成若干网格化风险簇
 * 使用 mapvgl.HeatmapLayer，颜色由蓝 → 橙 → 红渐变
 */

/** Demo 风险簇中心（对应原型中 5 处低洼聚集区） */
const DEMO_CLUSTERS = [
  { name: "西北部", lng: 120.175, lat: 33.855, gridSize: 5, outerRing: true },
  { name: "海河镇", lng: 120.342, lat: 33.835, gridSize: 4, outerRing: false },
  { name: "射阳县", lng: 120.265, lat: 33.775, gridSize: 4, outerRing: true },
  { name: "兴桥镇", lng: 120.198, lat: 33.728, gridSize: 5, outerRing: true },
  { name: "黄沙港镇", lng: 120.395, lat: 33.748, gridSize: 4, outerRing: false }
]

/** 网格步长（度），控制热力块大小 */
const GRID_STEP = 0.0035

/**
 * 根据距中心远近分配热力值：核心区红、中间橙、外围蓝
 */
const calcHeatValue = (dist, maxDist, outerRing) => {
  const ratio = dist / maxDist
  if (ratio <= 0.35) return 38
  if (ratio <= 0.65) return 24
  if (outerRing && ratio <= 0.95) return 10
  return null
}

/** 生成全部 Demo 热力点 */
export const buildLowLyingHeatmapPoints = () => {
  const result = []

  DEMO_CLUSTERS.forEach(cluster => {
    const { lng: cx, lat: cy, gridSize, outerRing } = cluster
    for (let i = -gridSize; i <= gridSize; i++) {
      for (let j = -gridSize; j <= gridSize; j++) {
        const dist = Math.sqrt(i * i + j * j)
        const heatValue = calcHeatValue(dist, gridSize, outerRing)
        if (heatValue == null) continue

        result.push({
          lng: cx + i * GRID_STEP,
          lat: cy + j * GRID_STEP,
          heatValue
        })
      }
    }
  })

  return result
}

/**
 * 在地图上渲染低洼地带热力图
 * @param {object}                map      BMapGL 地图实例
 * @param {Array<{lng,lat,heatValue?}>} [points]
 *        外部传入的点位数组（来自接口）。缺省时回退到内置 Demo 数据，
 *        便于离线开发或接口不可用时仍能看到效果。
 *        - lng/lat 为数字
 *        - heatValue 可选，未提供时统一按 30（中等强度）
 * @returns {object|null} mapvgl.View 实例，供外部销毁
 */
export const renderLowLyingHeatmap = (map, points) => {
  if (!map || typeof mapvgl === "undefined") return null

  // 优先使用外部点位；为空时回退到 Demo
  const pointList =
    points && points.length
      ? points.map(p => ({
          lng: p.lng,
          lat: p.lat,
          heatValue: p.heatValue ?? 30
        }))
      : buildLowLyingHeatmapPoints()

  const view = new mapvgl.View({ map })

  const pointData = pointList.map(item => ({
    geometry: {
      type: "Point",
      coordinates: [item.lng, item.lat]
    },
    properties: {
      count: item.heatValue
    }
  }))

  const layer = new mapvgl.HeatmapLayer({
    size: 420,
    max: 40,
    height: 0,
    unit: "m",
    gradient: {
      0: "rgb(0, 120, 255)",
      0.45: "rgb(255, 140, 0)",
      1: "rgb(255, 30, 30)"
    }
  })

  view.addLayer(layer)
  layer.setData(pointData)

  return view
}

/** 销毁热力图视图 */
export const destroyHeatmapView = view => {
  if (view && typeof view.destroy === "function") {
    view.destroy()
  }
}

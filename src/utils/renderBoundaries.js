/*
 * @Author:
 * @Date: 2025-09-17 14:42:29
 * @Description:
 */
import thqGeo from "@/assets/map/thqGeo.json"
import thqSxGeo from "@/assets/map/thqSxGeo.json"

const defaultStyle = {
  strokeColor: "#4A90E2", // 边界线颜色
  strokeWeight: 1, // 边界线宽度
  strokeOpacity: 0.8, // 边界线透明度
  fillColor: "#4A90E2", // 填充颜色
  fillOpacity: 0.1 // 填充透明度
}

// 计算多边形的中心点
const getPolygonCenter = (coordinates) => {
  let totalLng = 0
  let totalLat = 0
  let pointCount = 0

  coordinates.forEach(polygon => {
    polygon.forEach(ring => {
      ring.forEach(coord => {
        totalLng += coord[0]
        totalLat += coord[1]
        pointCount++
      })
    })
  })

  return new BMapGL.Point(totalLng / pointCount, totalLat / pointCount)
}

// 水系图样式配置
const waterSystemStyle = {
  strokeColor: "#4CAF50", // 水系边界线颜色
  strokeWeight: 2, // 水系边界线宽度
  strokeOpacity: 0.8, // 水系边界线透明度
  fillColor: "#4CAF50", // 水系填充颜色
  fillOpacity: 0.3 // 水系填充透明度
}

// 存储水系图实例的数组
let waterSystemOverlays = []

// 清除水系图
export const clearWaterSystem = (map) => {
  if (!map || waterSystemOverlays.length === 0) return

  // 从地图上移除所有水系覆盖物
  waterSystemOverlays.forEach(overlay => {
    map.removeOverlay(overlay)
  })

  // 清空数组
  waterSystemOverlays = []

  console.log('水系图已清除')
}

// 渲染水系图
export const renderWaterSystem = (map, geoJson = thqSxGeo) => {
  if (!map) return

  // 先清除之前的水系图
  clearWaterSystem(map)

  geoJson.features.forEach((feature, index) => {
    const coordinates = feature.geometry.coordinates
    const properties = feature.properties

    // 处理MultiLineString类型的几何数据
    if (feature.geometry.type === 'MultiLineString') {
      coordinates.forEach(lineString => {
        const points = lineString.map(coord => new BMapGL.Point(coord[0], coord[1]))
        // 创建水系线条
        const polyline = new BMapGL.Polyline(points, {
          strokeColor: waterSystemStyle.strokeColor,
          strokeWeight: waterSystemStyle.strokeWeight,
          strokeOpacity: waterSystemStyle.strokeOpacity,
          strokeStyle: 'solid'
        })
        // 添加到地图
        map.addOverlay(polyline)
        // 存储实例用于后续清除
        waterSystemOverlays.push(polyline)
      })
    }

    // 处理MultiPolygon类型的几何数据（如果有面状水系数据）
    if (feature.geometry.type === 'MultiPolygon') {
      coordinates.forEach(polygon => {
        polygon.forEach(ring => {
          const points = ring.map(coord => new BMapGL.Point(coord[0], coord[1]))
          // 创建水系多边形
          const polygon = new BMapGL.Polygon(points, waterSystemStyle)
          // 添加到地图
          map.addOverlay(polygon)
          // 存储实例用于后续清除
          waterSystemOverlays.push(polygon)
        })
      })
    }
  })
}

// 渲染射阳县行政区边界
export const renderBoundaries = (map, geoJson = thqGeo) => {
  if (!map) return
  geoJson.features.forEach((feature, index) => {
    const coordinates = feature.geometry.coordinates
    const properties = feature.properties

    // 处理MultiPolygon类型的几何数据
    if (feature.geometry.type === 'MultiPolygon') {
      coordinates.forEach(polygon => {
        polygon.forEach(ring => {
          const points = ring.map(coord => new BMapGL.Point(coord[0], coord[1]))

          // 创建多边形
          const polygon = new BMapGL.Polygon(points, defaultStyle)

          // 设置属性信息
          // polygon.properties = properties
          // polygon.boundaryType = 'thq'

          // // 添加点击事件
          // polygon.addEventListener('click', (e) => {
          //   console.log('点击行政区:', properties.name, properties)
          //   // 可以在这里添加点击后的处理逻辑，比如显示详细信息
          // })

          // 添加到地图
          map.addOverlay(polygon)
        })
      })

      // 添加行政区名称标签
      if (properties.name) {
        const centerPoint = getPolygonCenter(coordinates)

        // 创建文本标签
        const label = new BMapGL.Label(properties.name, {
          position: centerPoint,
          offset: new BMapGL.Size(0, 0)
        })

        // 设置标签样式
        label.setStyle({
          color: '#03A9F4',
          fontSize: '12px',
          fontFamily: 'Source Han Sans CN, Source Han Sans CN',
          backgroundColor: 'transparent',
          border: 'none',
          fontWeight: '400',
          // borderRadius: '4px',
          // padding: '4px 8px',
          textAlign: 'center',
          whiteSpace: 'nowrap'
        })

        // 设置标签属性
        // label.properties = properties
        // label.boundaryType = 'thq-label'

        // // 添加点击事件
        // label.addEventListener('click', (e) => {
        //   console.log('点击行政区标签:', properties.name, properties)
        // })

        // 添加到地图
        map.addOverlay(label)
      }
    }
  })
}

// 同时渲染行政边界和水系图
export const renderAllBoundaries = (map) => {
  renderBoundaries(map, thqGeo)
  renderWaterSystem(map, thqSxGeo)
}

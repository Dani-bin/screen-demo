/*
 * 共享地图单实例 composable
 * ----------------------------------------------------------
 * 背景：此前 5 个地图页各自 new BMapGL.Map 且被 KeepAlive 缓存常驻，
 * 每个实例附带一份个性化样式解析缓存（约 10MB JS 堆）+ 全屏 WebGL
 * canvas / 瓦片缓存（数百 MB），导致整页内存高达 1.3G。
 *
 * 方案：全应用只创建一个 BMapGL 实例，挂在 typhoon/index.vue 的
 * 常驻容器 #shared-map 上（router-view 之下），各页面通过本 composable
 * 共享。页面 onActivated 恢复视野并重绘自己的图层，onDeactivated
 * 清掉自己的覆盖物 —— 地图本体永不销毁。
 *
 * 注意：BMapGL 全局对象由路由守卫（src/permission.js）保证先于
 * 任何页面加载完成，因此 ensureMap 可同步创建。
 */
import custom_map_config from "@/assets/map/custom_map_config.json"
import { renderBoundaries } from "@/utils/renderBoundaries"

/* global BMapGL, BMAP_SATELLITE_MAP, BMAP_NORMAL_MAP */

/** 共享地图容器 DOM id（位于 src/views/typhoon/index.vue） */
const SHARED_MAP_CONTAINER_ID = "shared-map"

/** 唯一地图实例（shallowRef 避免深度响应式包装 BMapGL 对象） */
const mapRef = shallowRef(null)

/** 全局底图类型：normal-普通 / dark-深色（custom_map_config）/ satellite-卫星 */
const mapType = ref("dark")

/** 各页面离开时的视野记录：pageKey -> { lng, lat, zoom } */
const savedViews = new Map()

/**
 * 确保共享地图已创建并返回实例；已创建则直接复用。
 * 行政边界（renderBoundaries）作为共享基础图层只画这一次、永不清理。
 */
function ensureMap() {
  if (mapRef.value) return mapRef.value
  if (typeof BMapGL === "undefined" || !BMapGL.Map) {
    console.error("[useSharedMap] BMapGL 未加载，无法创建共享地图")
    return null
  }
  const container = document.getElementById(SHARED_MAP_CONTAINER_ID)
  if (!container) {
    console.error(`[useSharedMap] 找不到共享地图容器 #${SHARED_MAP_CONTAINER_ID}`)
    return null
  }
  const map = new BMapGL.Map(SHARED_MAP_CONTAINER_ID)
  // 初始视野无业务含义，页面激活时会立即被 activatePage 覆盖
  map.centerAndZoom(new BMapGL.Point(120.298777, 33.762996), 13)
  map.enableScrollWheelZoom(true)
  map.setTilt(10)
  map.setMapStyleV2({ styleJson: custom_map_config })
  map.setDisplayOptions({
    skyColors: ["rgba(255, 255, 255, 0)", "rgba(255, 255, 255, 0)"]
  })
  renderBoundaries(map)
  mapRef.value = map
  return map
}

/**
 * 切换底图类型（全局共享，所有页面状态一致）。
 * 守卫：目标类型与当前相同直接返回，避免不必要的样式 JSON 重复解析。
 * @param {"normal"|"dark"|"satellite"} type
 */
function switchMapType(type) {
  const map = mapRef.value
  if (!map || type === mapType.value) return
  mapType.value = type
  if (type === "satellite") {
    map.setMapType(BMAP_SATELLITE_MAP)
    return
  }
  // 普通 / 深色 都基于百度普通底图，差别在是否套深色自定义样式
  map.setMapType(BMAP_NORMAL_MAP)
  if (type === "dark") {
    map.setMapStyleV2({ styleJson: custom_map_config })
  } else {
    // 普通：传空 styleJson 清掉之前应用的深色规则，回到百度默认配色
    map.setMapStyleV2({ styleJson: [] })
  }
}

/**
 * 页面激活：确保地图存在并恢复视野。
 * 优先恢复该页"离开时的视野"；首次进入用传入的页面默认值。
 * @param {string} pageKey 页面标识（如 "commandDispatch"）
 * @param {{lng:number, lat:number, zoom:number}} defaults 页面默认视野
 * @returns {BMapGL.Map|null}
 */
function activatePage(pageKey, defaults) {
  const map = ensureMap()
  if (!map) return null
  const view = savedViews.get(pageKey) || defaults
  if (!view) {
    console.error(`[useSharedMap] activatePage("${pageKey}") 缺少默认视野参数`)
    return null
  }
  map.centerAndZoom(new BMapGL.Point(view.lng, view.lat), view.zoom)
  return map
}

/** 页面失活：记录离开时的视野，供下次激活恢复 */
function deactivatePage(pageKey) {
  const map = mapRef.value
  if (!map) return
  const center = map.getCenter()
  savedViews.set(pageKey, {
    lng: center.lng,
    lat: center.lat,
    zoom: map.getZoom()
  })
}

/** 某页面是否已有"离开时视野"记录（用于区分首次进入） */
function hasSavedView(pageKey) {
  return savedViews.has(pageKey)
}

export function useSharedMap() {
  return {
    mapRef,
    mapType,
    ensureMap,
    switchMapType,
    activatePage,
    deactivatePage,
    hasSavedView
  }
}

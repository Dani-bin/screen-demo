# 共享地图单实例改造（第一期）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全应用只保留一个 BMapGL 实例，第一期迁移 commandDispatch 与 specialCommand 两个页面共享它，使内存基线大幅下降。

**Architecture:** 常驻底图容器放在 `typhoon/index.vue` 的 router-view 之下，由 `useSharedMap` composable（模块级单例）负责"首次创建、永不销毁"。页面 `onActivated` 恢复视野并重绘自己的图层，`onDeactivated` 清掉自己的覆盖物和地图事件。底图类型（普通/深色/卫星）收敛为全局共享状态。行政边界作为共享基础图层在创建地图时画一次、永不清理。

**Tech Stack:** Vue 3 `<script setup>` + KeepAlive、BMapGL（全局脚本，路由守卫 `src/permission.js` 保证先于页面加载）、`@bmapgl-plugin/cluster`、bmap-draw。

**前置事实（执行者必读）：**

- 项目无测试框架，每个任务用「手工验证」步骤代替单测；dev 启动命令 `yarn dev`（端口 8080，本机已有 dev server 时跳过启动）。
- Vue/Router API（`ref`、`shallowRef`、`onActivated` 等）由 unplugin-auto-import 全局注入，**新代码不需要手写 import**；但现有文件已有的显式 import 行保留不动（在其中追加 `onActivated, onDeactivated` 即可）。
- 代码风格：无分号、双引号、2 空格缩进；所有注释用中文。
- 两个页面被 `<KeepAlive>` 缓存：`onUnmounted` 在切换标签时**不会触发**，只有 `onActivated`/`onDeactivated` 触发。
- `renderBoundaries(map)`（`src/utils/renderBoundaries.js:110`）画完不保留句柄、无法清除 —— 因此边界改为共享地图的"永久基础图层"，只在 ensureMap 里画一次，页面里不再调用。
- `MapDrawToolbar.vue` 内部用 `placedOverlays` 数组（`src/components/MapDrawToolbar.vue:580` 附近 push）登记自己画的覆盖物，但卸载时不会从地图上移除它们 —— Task 3 补上。
- 行为决策（已与需求方确认的设计）：页面切走时若处于队伍/物资调度模式，按"退出调度"语义整体退出（丢弃未提交任务）；切回页面恢复"离开时的视野"；底图类型全局一致。

---

### Task 1: 新建 useSharedMap composable

**Files:**
- Create: `src/composables/useSharedMap.js`

- [ ] **Step 1: 创建文件，写入完整实现**

```js
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
 * 守卫：目标类型与当前相同直接返回，避免重复 setMapStyleV2
 * 触发 BMapGL 重新解析样式 JSON（每次约 10MB 堆开销）。
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
```

- [ ] **Step 2: 验证（lint 通过即可，此文件暂无调用方）**

Run: `yarn lint:eslint`
Expected: 0 errors / 0 warnings（若报其它文件的既有问题，确认与本文件无关）

- [ ] **Step 3: Commit**

```bash
git add src/composables/useSharedMap.js
git commit -m "feat: 新增共享地图单实例 composable（useSharedMap）"
```

---

### Task 2: typhoon/index.vue 增加常驻共享地图容器

**Files:**
- Modify: `src/views/typhoon/index.vue`

- [ ] **Step 1: 模板中 router-view 之前插入共享容器**

把：

```html
    <div class="typhoon-content">
      <router-view v-slot="{ Component }">
```

改为：

```html
    <div class="typhoon-content">
      <!-- 共享地图底图：所有已迁移地图页共用的唯一 BMapGL 实例容器（useSharedMap）
           未迁移页面自带全屏地图，会盖在它上面，过渡期共存 -->
      <div :id="'shared-map'" class="shared-map-container"></div>
      <router-view v-slot="{ Component }">
```

（注：id 用静态写法 `id="shared-map"` 即可，上面的绑定写法仅为防止与说明混淆，落码时写 `<div id="shared-map" class="shared-map-container"></div>`。）

- [ ] **Step 2: 样式中加入容器与页面的层级规则**

在 `.typhoon-content` 规则内追加：

```scss
    /* 共享地图底图：铺满内容区，永远垫在页面内容之下 */
    .shared-map-container {
      position: absolute;
      inset: 0;
      z-index: 0;
    }

    /* 路由页面内容必须浮在共享底图之上 */
    > :not(.shared-map-container) {
      position: relative;
      z-index: 1;
    }
```

- [ ] **Step 3: 手工验证**

启动 `yarn dev` 打开页面：5 个标签页全部表现与改造前一致（此时共享容器是个空 div，被各页自己的地图盖住），无白屏、无层级异常。

- [ ] **Step 4: Commit**

```bash
git add src/views/typhoon/index.vue
git commit -m "feat: typhoon 布局加入共享地图常驻容器"
```

---

### Task 3: MapDrawToolbar 支持从地图上回收自己画的覆盖物

**背景：** 共享地图后，页面切走时会用 `v-if` 卸载 MapDrawToolbar（KeepAlive 内部 v-if 置 false 会真正 unmount），由它的 `onUnmounted` 把自己画的标绘从共享地图上清掉；切回时重新挂载，`watch(props.map, immediate)` 自动 `initDrawScene + loadSavedLayers` 重绘。当前缺口：组件卸载时不会从地图移除 `placedOverlays` 里登记的覆盖物。

**Files:**
- Modify: `src/components/MapDrawToolbar.vue`（`placedOverlays` 定义在约 570-580 行，watch 在约 1119-1128 行，onUnmounted 在约 1130-1134 行）

- [ ] **Step 1: 在 `registerDeletableOverlay` 函数附近新增清理函数**

```js
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
```

注意：若 `placedOverlays` 实际声明名称不同（执行时以文件内 `registerDeletableOverlay` 中 push 的数组名为准），同步替换。

- [ ] **Step 2: watch 增加旧地图清理分支**

把：

```js
watch(
  () => props.map,
  mapInstance => {
    if (mapInstance) {
      initDrawScene(mapInstance)
      loadSavedLayers()
    }
  },
  { immediate: true }
)
```

改为：

```js
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
```

- [ ] **Step 3: onUnmounted 增加覆盖物清理**

把：

```js
onUnmounted(() => {
  resetDrawTool()
  drawScene = null
  OperateEventType = null
})
```

改为：

```js
onUnmounted(() => {
  resetDrawTool()
  // 共享地图模式：组件卸载（页面切走）时把自己画的标绘从地图上清掉
  clearAllDrawnOverlays()
  drawScene = null
  OperateEventType = null
})
```

- [ ] **Step 4: 手工验证**

在指挥调度页用工具栏画 2 个图形（如圆 + 旗帜）→ 切到其它标签再切回：图形通过 `loadSavedLayers` 重新出现（此时仍是每页独立地图，行为应与改造前无差异，重点是不报错）。

- [ ] **Step 5: Commit**

```bash
git add src/components/MapDrawToolbar.vue
git commit -m "feat: MapDrawToolbar 卸载/换图时回收已绘制覆盖物"
```

---

### Task 4: 迁移 commandDispatch 到共享地图

**Files:**
- Modify: `src/views/typhoon/commandDispatch/index.vue`

- [ ] **Step 1: 模板 —— 删除自有地图容器，加 loading 浮层与工具栏挂载开关**

把（第 2-8 行附近）：

```html
  <div class="command-dispatch-page" :class="{ 'is-normal-map': mapType === 'normal' }">
    <!-- 百度地图容器（接口请求中显示 loading 浮层） -->
    <div class="map-box" id="command-dispatch-map" v-loading="categoryLoading" element-loading-text="点位加载中..."
      element-loading-background="rgba(8, 20, 40, 0.45)"></div>

    <!-- 地图标绘工具栏（队伍调度模式下隐藏） -->
    <MapDrawToolbar v-if="showMapToolbar" :map="mapRef" :planId="281" @dispatch="handleDispatch" />
```

改为：

```html
  <div class="command-dispatch-page" :class="{ 'is-normal-map': mapType === 'normal' }">
    <!-- 共享地图模式：地图本体在 typhoon/index.vue 的 #shared-map，本页只保留点位加载 loading 浮层 -->
    <div v-if="categoryLoading" class="map-loading-mask" v-loading="categoryLoading"
      element-loading-text="点位加载中..." element-loading-background="rgba(8, 20, 40, 0.45)"></div>

    <!-- 地图标绘工具栏（队伍调度模式下隐藏；页面失活时卸载，由其清理共享地图上的标绘） -->
    <MapDrawToolbar v-if="showMapToolbar && isPageActive" :map="mapRef" :planId="281" @dispatch="handleDispatch" />
```

- [ ] **Step 2: 样式 —— 页面壳层放行地图交互**

在 `.command-dispatch-page` 规则顶部（`position: relative;` 之后）加：

```scss
  /* 共享地图模式：页面壳层本身不拦截鼠标事件，让拖拽/缩放透传给底下的共享地图；
     所有直接子元素（面板/按钮/底栏）恢复可交互 */
  pointer-events: none;

  > * {
    pointer-events: auto;
  }
```

并把 `.map-box` 规则替换为：

```scss
  /* 点位接口请求中的 loading 浮层（盖住整个地图区域） */
  .map-loading-mask {
    position: absolute;
    inset: 0;
    z-index: 50;
  }
```

- [ ] **Step 3: script —— 接入 composable，删除本地地图初始化**

3a. import 区（第 171-174 行附近）：在现有 import 后追加一行，并删除两个不再使用的 import：

```js
import { useSharedMap } from "@/composables/useSharedMap"
```

删除：`import custom_map_config from "@/assets/map/custom_map_config.json"` 和 `import { renderBoundaries } from "@/utils/renderBoundaries"`。
第 171 行的 vue import 改为：`import { ref, shallowRef, onMounted, onUnmounted, onActivated, onDeactivated } from "vue"`。

3b. 把本地地图状态声明（第 306-309 行附近）：

```js
/** 地图实例（shallowRef 避免深度响应式包装 BMapGL 对象） */
const mapRef = shallowRef(null)
/** 当前底图类型：normal-普通（百度默认配色） / dark-深色（大屏自定义样式） / satellite-卫星 */
const mapType = ref("dark")
```

替换为：

```js
/** 共享地图：mapRef / 底图类型 / 视野与类型切换均由 useSharedMap 全局单例提供 */
const { mapRef, mapType, switchMapType, activatePage, deactivatePage } =
  useSharedMap()
/** 本页是否处于激活态（控制 MapDrawToolbar 挂载/卸载） */
const isPageActive = ref(false)
```

3c. 删除整个 `renderMap` 函数（第 618-632 行）和整个本地 `switchMapType` 函数（第 641-657 行）。模板里的 `mapType` / `switchMapType` 引用自动落到 composable 提供的同名变量上，无需改模板。

- [ ] **Step 4: script —— activateCategory 支持不重置视野**

把 `activateCategory` 开头（第 1280-1291 行附近）：

```js
const activateCategory = async key => {
  const map = mapRef.value
  if (!map) return

  clearAllCategoryLayers(map)
  // 每次切换分类先重置地图视野；"人员转移"分类需要拉近，使用更高的缩放级别
  const targetZoom = key === 'personnel_transfer' ? personnelTransferZoom : rootZoom
  map.centerAndZoom(
    new BMapGL.Point(rootCenter.lng, rootCenter.lat),
    targetZoom
  )
  activeCategories.value = [key]
```

改为：

```js
const activateCategory = async (key, { resetView = true } = {}) => {
  const map = mapRef.value
  if (!map) return

  clearAllCategoryLayers(map)
  // 每次切换分类先重置地图视野；"人员转移"分类需要拉近，使用更高的缩放级别
  // 页面从 KeepAlive 切回重绘时传 resetView=false，保持"离开时视野"
  if (resetView) {
    const targetZoom = key === 'personnel_transfer' ? personnelTransferZoom : rootZoom
    map.centerAndZoom(
      new BMapGL.Point(rootCenter.lng, rootCenter.lat),
      targetZoom
    )
  }
  activeCategories.value = [key]
```

- [ ] **Step 5: script —— 重写生命周期钩子**

把现有 `onMounted`（第 1860-1878 行）中的 `await renderMap()` 与 `await nextTick()` 两行删掉（EventBus 注册保留），并在 `onMounted` 之后新增：

```js
onActivated(() => {
  // 共享地图：激活时恢复视野（优先离开时视野，首次用页面默认），并接管地图
  const map = activatePage("commandDispatch", {
    lng: rootCenter.lng,
    lat: rootCenter.lat,
    zoom: rootZoom
  })
  if (!map) return
  // 缩放后重算所有自动绘制的调度路线箭头（失活时移除，避免跨页重复触发）
  map.addEventListener("zoomend", recomputeAllDispatchArrows)
  // 挂载标绘工具栏（其内部会重新加载并绘制已保存的标绘图层）
  isPageActive.value = true
  // 恢复离开前激活的分类点位（数据命中 categoryDataCache，不重复请求接口）
  if (activeCategories.value.length) {
    activateCategory(activeCategories.value[0], { resetView: false })
  }
})

onDeactivated(() => {
  const map = mapRef.value
  // 记录离开时视野，供切回时恢复
  deactivatePage("commandDispatch")
  // 卸载标绘工具栏 → 其 onUnmounted 会把标绘覆盖物从共享地图上清掉
  isPageActive.value = false
  if (!map) return
  // 进行中的交互态全部终止：取点监听 / 点位闪烁 / 名称 tip
  cancelDispatchPicking()
  stopLocateBlink()
  closePointTip(map)
  // 调度模式按"退出调度"语义整体退出（丢弃未提交任务并清路线）
  if (teamDispatchVisible.value) {
    closeTeamDispatch()
  } else if (materialDispatchVisible.value) {
    closeMaterialDispatch()
  }
  // 应急响应面板画的路线 + 残留调度路线
  emergencyResponseRef.value?.hideAndClearRoutes?.()
  clearAllDispatchRoutes()
  // 分类点位图层（activeCategories 保留，切回时据此重绘）
  clearAllCategoryLayers(map)
  map.removeEventListener("zoomend", recomputeAllDispatchArrows)
})
```

`onUnmounted`（第 1880-1894 行）保持不变（KeepAlive 下作为兜底清理仍有意义）。

- [ ] **Step 6: 手工验证**

`yarn dev` 后回归以下场景（此时 specialCommand 尚未迁移，重点验证与未迁移页面共存）：

1. 进入"指挥调度"：共享底图出现，行政边界、底图切换、标绘工具栏正常；
2. 切换各点位分类：marker / 聚合 / 绘制层正常显示与清除，loading 浮层正常；
3. 地图可拖拽缩放（pointer-events 透传验证），面板按钮可点击；
4. 队伍/物资调度全流程：发起 → 地图取点 → 任务列表 → 下发；调度中切到"态势分析"再切回 → 调度模式已退出、无路线残留；
5. 切到"天气地图"（未迁移，自带地图）再切回 → 视野恢复为离开时状态，激活的分类点位自动重绘；
6. 底图切到"卫星"再切回"深色"，样式正常。

- [ ] **Step 7: Commit**

```bash
git add src/views/typhoon/commandDispatch/index.vue
git commit -m "refactor: 指挥调度页迁移到共享地图单实例"
```

---

### Task 5: 迁移 specialCommand 到共享地图

与 Task 4 同构，差异点：planId=280、页面 key="specialCommand"、默认视野 zoom=18、额外有"影响范围圆 + 风险点 GroundOverlay"两组覆盖物需要随激活/失活重建。

**Files:**
- Modify: `src/views/typhoon/specialCommand/index.vue`

- [ ] **Step 1: 模板 —— 同 Task 4 Step 1**

把（第 2-9 行附近）：

```html
  <div class="special-command-page" :class="{ 'is-normal-map': mapType === 'normal' }">
    <!-- 百度地图容器（接口请求中显示 loading 浮层）
         注意：地图容器 id 必须与"指挥调度"页面不同，KeepAlive 同时缓存两个页面时避免 BMapGL 抢占同一个 DOM -->
    <div class="map-box" id="special-command-map" v-loading="categoryLoading" element-loading-text="点位加载中..."
      element-loading-background="rgba(8, 20, 40, 0.45)"></div>

    <!-- 地图标绘工具栏（队伍调度模式下隐藏） -->
    <MapDrawToolbar v-if="showMapToolbar" :map="mapRef" :planId="280" @dispatch="handleDispatch" />
```

改为：

```html
  <div class="special-command-page" :class="{ 'is-normal-map': mapType === 'normal' }">
    <!-- 共享地图模式：地图本体在 typhoon/index.vue 的 #shared-map，本页只保留点位加载 loading 浮层 -->
    <div v-if="categoryLoading" class="map-loading-mask" v-loading="categoryLoading"
      element-loading-text="点位加载中..." element-loading-background="rgba(8, 20, 40, 0.45)"></div>

    <!-- 地图标绘工具栏（队伍调度模式下隐藏；页面失活时卸载，由其清理共享地图上的标绘） -->
    <MapDrawToolbar v-if="showMapToolbar && isPageActive" :map="mapRef" :planId="280" @dispatch="handleDispatch" />
```

- [ ] **Step 2: 样式 —— 同 Task 4 Step 2**

`.special-command-page` 顶部加 `pointer-events: none;` + `> * { pointer-events: auto; }`；`.map-box` 规则替换为 `.map-loading-mask`（代码与 Task 4 Step 2 完全一致）。

- [ ] **Step 3: script —— 接入 composable**

3a. 追加 `import { useSharedMap } from "@/composables/useSharedMap"`；删除 `custom_map_config` 与 `renderBoundaries` 的 import；vue import 行（第 158 行）追加 `onActivated, onDeactivated`。

3b. 本地 `mapRef` / `mapType` 声明（第 246-248 行附近）替换为：

```js
/** 共享地图：mapRef / 底图类型 / 视野与类型切换均由 useSharedMap 全局单例提供 */
const { mapRef, mapType, switchMapType, activatePage, deactivatePage, hasSavedView } =
  useSharedMap()
/** 本页是否处于激活态（控制 MapDrawToolbar 挂载/卸载） */
const isPageActive = ref(false)
```

3c. 删除整个 `renderMap`（第 452-466 行）和本地 `switchMapType`（第 475-491 行）。

- [ ] **Step 4: script —— 风险点 GroundOverlay 改为「拉取一次、缓存重绘」**

4a. 在 `riskPointOverlayRef` 声明（第 574 行附近）下面加：

```js
/** 风险点接口数据缓存：首次激活拉取后复用，切回页面时直接重绘不再请求 */
const riskPointDataRef = shallowRef(null)
```

4b. 把 `loadInitialRiskPointOverlay`（第 602-669 行）拆成"取数"与"绘制"两步，整体替换为：

```js
/**
 * 拉取固定风险点位数据（只拉一次，结果缓存到 riskPointDataRef）
 */
const fetchRiskPointData = async () => {
  if (riskPointDataRef.value) return riskPointDataRef.value
  try {
    const res = await getRiskPointById({ id: FIXED_RISK_POINT_ID })
    riskPointDataRef.value = res?.data || null
  } catch (e) {
    // 失败仅静默，不阻塞底栏分类加载等其它功能
    console.warn("[specialCommand] 风险点位接口请求失败：", e)
  }
  return riskPointDataRef.value
}

/** 清除已渲染的风险点 GroundOverlay */
const clearRiskPointOverlay = () => {
  const map = mapRef.value
  if (map && riskPointOverlayRef.value) {
    map.removeOverlay(riskPointOverlayRef.value)
  }
  riskPointOverlayRef.value = null
}

/**
 * 按缓存数据渲染风险点 GroundOverlay
 * @param {{focus?: boolean}} [opts] focus=true 时把视野推到贴图中心
 *   （图覆盖区域约 200m×190m，不聚焦的话在低缩放下看不见；
 *    仅首次进入页面聚焦，切回页面时保持"离开时视野"）
 */
const drawRiskPointOverlay = async (opts = {}) => {
  const map = mapRef.value
  if (!map) return
  clearRiskPointOverlay()

  const data = await fetchRiskPointData()
  if (!data) return

  const startLng = parseFloat(data.lng)
  const startLat = parseFloat(data.lat)
  const endLng = parseFloat(readAttribute(data.attributesJson, "endLng"))
  const endLat = parseFloat(readAttribute(data.attributesJson, "endLat"))
  const imageUrl = data.imageUrl

  // 任一关键字段缺失或非法 → 不渲染，保持地图干净
  if (
    !isFinite(startLng) ||
    !isFinite(startLat) ||
    !isFinite(endLng) ||
    !isFinite(endLat) ||
    !imageUrl
  ) {
    return
  }

  // 构造 Bounds：以 (start.lng, end.lat) 与 (end.lng, start.lat) 两组对角
  // 描述图片在地图上的实际投影范围（百度 GroundOverlay 文档同款做法）
  const bounds = new BMapGL.Bounds(
    new BMapGL.Point(startLng, endLat),
    new BMapGL.Point(endLng, startLat)
  )
  const imgOverlay = new BMapGL.GroundOverlay(bounds, {
    type: "image",
    url: imageUrl,
    opacity: 1
  })
  map.addOverlay(imgOverlay)
  riskPointOverlayRef.value = imgOverlay

  if (opts.focus) {
    const centerLng = (startLng + endLng) / 2
    const centerLat = (startLat + endLat) / 2
    map.centerAndZoom(new BMapGL.Point(centerLng, centerLat), rootZoom)
  }
}
```

（原函数尾部的 `Image` 预加载探测段可保留也可删除；保留时附在 `drawRiskPointOverlay` 内 `riskPointOverlayRef.value = imgOverlay` 之后。）

- [ ] **Step 5: script —— activateCategory 支持不重置视野**

与 Task 4 Step 4 完全相同的改法（specialCommand 的 `activateCategory` 在第 1276 行附近；该页若没有 `personnelTransferZoom` 变量，则只包裹原有的 `map.centerAndZoom(new BMapGL.Point(rootCenter.lng, rootCenter.lat), rootZoom)` 这一句进 `if (resetView)`，以文件实际代码为准）。

- [ ] **Step 6: script —— 重写生命周期钩子**

把 `onMounted`（第 1772-1791 行）改为只保留 EventBus 注册（删除 `await renderMap()`、`await loadInitialRiskPointOverlay()`、`await drawInfluenceOverlay()` 三行），并在其后新增：

```js
onActivated(async () => {
  // 首次进入：无离开视野记录 → 激活后聚焦风险点贴图；之后恢复离开时视野
  const isFirstEnter = !hasSavedView("specialCommand")
  const map = activatePage("specialCommand", {
    lng: rootCenter.lng,
    lat: rootCenter.lat,
    zoom: rootZoom
  })
  if (!map) return
  // 缩放后重算所有自动绘制的调度路线箭头（失活时移除，避免跨页重复触发）
  map.addEventListener("zoomend", recomputeAllDispatchArrows)
  // 挂载标绘工具栏（其内部会重新加载并绘制已保存的标绘图层）
  isPageActive.value = true
  // 重建本页固定覆盖物：风险点贴图（首次聚焦）+ 影响范围圆（不改变视野）
  await drawRiskPointOverlay({ focus: isFirstEnter })
  drawInfluenceOverlay()
  // 恢复离开前激活的分类点位（数据命中 categoryDataCache，不重复请求接口）
  if (activeCategories.value.length) {
    activateCategory(activeCategories.value[0], { resetView: false })
  }
})

onDeactivated(() => {
  const map = mapRef.value
  // 记录离开时视野，供切回时恢复
  deactivatePage("specialCommand")
  // 卸载标绘工具栏 → 其 onUnmounted 会把标绘覆盖物从共享地图上清掉
  isPageActive.value = false
  if (!map) return
  // 进行中的交互态全部终止：取点监听 / 点位闪烁 / 名称 tip
  cancelDispatchPicking()
  stopLocateBlink()
  closePointTip(map)
  // 调度模式按"退出调度"语义整体退出（丢弃未提交任务并清路线）
  if (teamDispatchVisible.value) {
    closeTeamDispatch()
  } else if (materialDispatchVisible.value) {
    closeMaterialDispatch()
  }
  emergencyResponseRef.value?.hideAndClearRoutes?.()
  clearAllDispatchRoutes()
  // 本页固定覆盖物：影响范围圆 + 风险点贴图
  clearInfluenceOverlay()
  clearRiskPointOverlay()
  // 分类点位图层（activeCategories 保留，切回时据此重绘）
  clearAllCategoryLayers(map)
  map.removeEventListener("zoomend", recomputeAllDispatchArrows)
})
```

注：若该页没有 `emergencyResponseRef` 或 `stopLocateBlink` 等成员（以文件实际代码为准），对应行删掉即可。

- [ ] **Step 7: 手工验证**

1. 进入"专项指挥"：首屏聚焦风险点贴图，影响范围圆与半径切换（1-5km）正常；
2. "指挥调度 ↔ 专项指挥"互切 ≥5 次：两页各自的点位/路线/标绘/影响圆**互不残留**（重点回归项），各自视野分别恢复；
3. 两页的底图类型现在是全局联动的（在一页切"卫星"，另一页也是"卫星"）——确认 UI 状态一致、无闪烁异常；
4. 标绘工具栏在两页分别画图形，互切后各自只显示自己 planId 的图层；
5. 与未迁移页面（天气地图/态势分析/视频中心）互切正常。

- [ ] **Step 8: Commit**

```bash
git add src/views/typhoon/specialCommand/index.vue
git commit -m "refactor: 专项指挥页迁移到共享地图单实例"
```

---

### Task 6: 内存复测与收尾

- [ ] **Step 1: 内存复测**

无痕窗口打开 dev 页面 →"指挥调度 ↔ 专项指挥"互切 5 次 → Chrome 任务管理器（Shift+Esc）记录标签页内存与 JavaScript 内存；DevTools Memory 拍堆快照，确认：

- `BMapGL.customStyleInfo_*` 相关数组组数比改造前少（两页共 1 份而非 2 份）；
- Console 执行 `[...document.querySelectorAll("canvas")].length`，两页互切时 canvas 数量不再随页面数叠加。

把前后数字记录到本文件末尾。

- [ ] **Step 2: lint + 整体回归**

Run: `yarn lint:eslint`
Expected: 0 errors / 0 warnings

- [ ] **Step 3: 最终 commit（如有 lint 自动修复产生的变更）**

```bash
git add -A
git commit -m "chore: 共享地图一期收尾（lint 修复与复测记录）"
```

---

## 复测记录（Task 6 填写）

| 指标 | 改造前 | 改造后 |
|---|---|---|
| 标签页内存（任务管理器） | ~983MB | |
| JavaScript 内存 | ~342MB | |
| 堆快照大小 | ~263MB（8 次切换后） | |

> 一期复测的关键结论：单实例结构已生效（堆快照中 `customStyleInfo_custom*` 收敛为 1 组、`BMapGL` 在 Window 下唯一）；
> 但「所有标签都点过」场景下标签页内存仍 ~1.3GB —— 因为一期只迁了 5 个地图页中的 2 个，
> 其余 3 个（天气地图 / 态势分析 / 视频中心）仍各自 `new BMapGL.Map` 且被 KeepAlive 常驻。
> 注意：`document.querySelectorAll("canvas").length` 在 KeepAlive 下只数得到「当前激活页」的 canvas
> （失活页 DOM 被 detached），**不能**用它判断总实例数。

---

## 第二期：剩余 3 个地图页迁移（已完成）

**目标：** 把天气地图 / 态势分析 / 视频中心也迁到共享地图，使全应用真正只剩 1 个 BMapGL 实例。

完成后全 `src/` 内 `new BMapGL.Map` 仅存在于 `src/composables/useSharedMap.js`（唯一实例）。

| 页面 | 文件 | 迁移要点 | Commit |
|---|---|---|---|
| 态势分析 | `src/views/typhoon/situationAnalysis/index.vue` | 与指挥调度同构：删自建地图/renderMap/本地 switchMapType，接 useSharedMap；`activateCategory` 加 `resetView`；onActivated 恢复视野+重绘分类，onDeactivated 记录视野+清分类图层。无标绘工具栏、无调度流程，最简单 | `态势分析页迁移` |
| 天气地图 | `src/views/typhoon/weatherMap/index.vue` | 局部 `var map` 改为 onActivated 时指向共享实例、onDeactivated 置空；renderMap 拆成 `drawAllLayers`(按 currentPhase / showTyphon / showRain 还原) + `clearAllLayers`；`zoomend` 台风图标缩放回调改具名函数随激活/失活增删；雨量 tooltip 的 mousemove 监听容器由 `#typhoon-weather-map` 改 `#shared-map` | `天气地图页迁移` |
| 视频中心 | `src/views/typhoon/videoCenter/index.vue` | 同 weatherMap 局部 `map` 模式；设备相关 EventBus(`getDeviceList`/`handleDeviceClick`/`selectDeviceForMap`)收敛进 `registerDeviceHandlers`/`unregisterDeviceHandlers`；`activateMapView`/`deactivateMapView` 封装接管/释放；**子路由"分屏监控"** 由 `watch(route.path)` 处理：进子路由清点位置空、回主视图重新接管；onUnmounted 不再 `map.clearOverlays()`（避免清掉共享地图边界） | `视频中心页迁移` |

**三页共性改法：** 删除自有 `.map-box` 容器、删 `custom_map_config`/`renderBoundaries` import（边界已由 ensureMap 画一次）、页面壳层加 `pointer-events:none` + `> * { pointer-events:auto }` 让拖拽透传给底下共享地图、底图类型改为全局联动。

**已知行为变化：** 天气地图过去不画行政边界，迁移后会共享那条边界线（zoom 9 远景下很小，基本无感）。

**验证：** `yarn build` 通过（lint 因既有 `eslint.config.js` 引用了失效规则 `vue/setup-compiler-macros` 无法运行，与本次改动无关）。

**二期内存复测（待填）：** 现在「所有标签都点过」应能大幅下降（5 页共 1 实例）。

| 指标 | 一期后(全标签) | 二期后(全标签) |
|---|---|---|
| 标签页内存（任务管理器） | ~1.3GB | |
| JavaScript 内存 | | |

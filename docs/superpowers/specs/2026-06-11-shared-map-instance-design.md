# 共享地图单实例改造设计（第一期）

日期：2026-06-11
状态：已确认

## 背景与目标

大屏的 5 个地图页（weatherMap、situationAnalysis、commandDispatch、specialCommand、videoCenter）各自 `new BMapGL.Map`，且全部被 `<KeepAlive>` 缓存常驻。堆快照证实：

- 每个地图实例触发一份百度个性化样式（`custom_map_config`）的解析缓存，挂在全局 `BMapGL.customStyleInfo_*` 上，约 10MB/份，共 6 份 ≈ 64MB JS 堆（占 24%）；
- 每个实例还附带全屏 WebGL canvas、瓦片缓存等数百 MB 非 JS 堆内存；
- 整页内存普遍达到 1.3G。

目标：全应用只保留一个 BMapGL 实例，各页面共享，使内存基线大幅下降。

## 已确认的决策

1. **覆盖物策略：切走清空、切回重绘。** 页面 `onDeactivated` 清掉自己加到地图上的全部覆盖物和地图事件监听；`onActivated` 恢复视野并重绘。业务数据走页面已有缓存，不重复请求接口。
2. **分批实施：第一期只迁移 commandDispatch 和 specialCommand**（两者结构最接近、共用 MapDrawToolbar），加上共享地图基础设施。weatherMap、situationAnalysis、videoCenter 本期不动，继续用自己的地图实例，与共享底图共存。
3. **实现方式：常驻底图组件 + composable**（方案 A）。不采用 DOM 搬移（方案 B，KeepAlive 下容器归属有竞态风险）。

## 架构

### 1. `src/composables/useSharedMap.js`（新增）

模块级单例，`shallowRef` 持有唯一 map 实例。

- `ensureMap()`：首次调用时在共享容器 `#shared-map` 上创建 `BMapGL.Map`，执行一次 `centerAndZoom`、`enableScrollWheelZoom`、`setTilt(10)`、`setMapStyleV2({ styleJson: custom_map_config })`、`setDisplayOptions`；之后所有调用直接返回已有实例。需兼容 BMapGL 脚本异步加载（`src/bmpgl.js`）。
- `setMapType(type)`：底图类型（normal/dark/satellite）为**全局共享状态**。带守卫：目标类型与当前相同则直接返回，避免重复 `setMapStyleV2` 导致样式缓存重复解析。
- 视野管理：`activatePage(pageKey, { center, zoom })` / `deactivatePage(pageKey)`。切走时记录该页离开时的 center/zoom，切回时优先恢复"离开时视野"，首次进入用页面默认值。

### 2. 共享容器

放在 `src/views/typhoon/index.vue` 的 `.typhoon-content` 内、`router-view` 之下（z-index 更低）的全屏 `<div id="shared-map">`。未迁移页面自带全屏地图，会自然盖住共享底图，过渡期可以共存。

### 3. 页面接入模式（本期：commandDispatch、specialCommand）

- 模板删除自己的地图容器 div；页面根元素背景透明，面板浮在共享底图上。
- 删除 `new BMapGL.Map`、`setMapStyleV2`、`centerAndZoom` 等初始化代码，地图实例改为 `useSharedMap()` 获取。
- `onMounted` 中的首次渲染逻辑迁到 `onActivated`（KeepAlive 下每次进入都触发）：
  `ensureMap()` → 恢复视野 → 重绘本页图层（行政边界、当前勾选的点位分类、调度路线、specialCommand 的风险点 GroundOverlay 与影响范围圈、已保存的绘制图层）→ 注册本页地图事件（如 `zoomend`）。
- `onDeactivated`：移除本页全部覆盖物、聚合实例（Cluster.View）、热力图、地图事件监听。现有 `onUnmounted` 的清理逻辑平移/合并到这里；`onUnmounted` 保留 EventBus 等非地图清理。
- `MapDrawToolbar`、`renderBoundaries`、`dispatchRouteDraw`、`mapDrawHelpers` 等均为参数传入 map，内部不改，传入共享实例即可。
- 底图类型切换 UI 改为读写 composable 的全局状态，两页状态一致。

### 4. 本期不动的部分

- weatherMap、situationAnalysis、videoCenter 的地图逻辑；
- `<KeepAlive>` 机制保留（面板、图表状态仍缓存）；
- 各工具函数（utils/*）内部实现。

## 错误处理

- `ensureMap()` 在 BMapGL 未就绪时等待加载完成（Promise 化），失败时报错并允许重试；
- 页面 `onDeactivated` 清理需容错：单个覆盖物移除失败不阻断其余清理；
- 共享容器若被意外移除（理论不发生），`ensureMap()` 检测容器存在性。

## 验证标准

无测试框架，采用手工回归 + 内存复测：

1. commandDispatch / specialCommand 功能回归：点位分类切换、点聚合、调度路线绘制与清除、绘制工具（MapDrawToolbar）、影响范围圈、风险点贴图、底图类型切换、AI 调度联动；
2. 两页来回切换 ≥5 次：覆盖物不串台、不残留、事件不重复绑定（路线箭头不重复重算）；
3. 堆快照复测：`BMapGL.customStyleInfo_*` 解析份数减少；任务管理器中标签页内存较改造前下降；
4. 与未迁移页面（如 situationAnalysis）互切正常，无遮挡/层级问题。

## 已知代价（预期行为）

- 切回页面时点位有短暂重绘过程（数百 ms 量级）；
- 两页共享视野记录与底图类型，切换页面后底图类型保持全局一致（与现状"各页独立"不同，属有意收敛）。

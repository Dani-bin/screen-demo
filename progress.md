# Progress — 专项指挥页面

## Session 1（完结）
- 摸排 commandDispatch 结构、planId 出现点、icon 资源、Head 导航
- 写规划文件 task_plan.md / findings.md
- Phase 1 完成：`/typhoon/specialCommand` 路由注入；Head.vue 的"专项指挥" tab 路由名接上
- Phase 2 完成：`cp -r` 复制 commandDispatch → specialCommand；改 map 容器 id 为 `special-command-map`，根 class 为 `special-command-page`
- Phase 3 完成：
  - `POINT_FETCHERS` 改为 7 项（4 核心 + 3 新专项 pointType 203/204/205）
  - `CLUSTER_CATEGORIES` 缩到 `rescue_team` 单项
  - `POINT_DETAIL_CATEGORIES` 改为 3 个新分类的 key
  - `bottomCategories` 数组缩到 7 项，删除 group 3，剩下 group 1（4 项）+ group 2（3 项）
  - 删除 template 中第三组胶囊渲染块、`<WaterloggingPointPanel>`、`<PersonnelTransferPanel>`
  - 删除底部注释、`heatmapViewRef` state、`showLowLyingHeatmap` 函数、`clearAllCategoryLayers` 中的 heatmap 分支、`onUnmounted` 中 heatmap 释放、import 中的低洼相关项与两个 Panel
- Phase 4 完成：
  - `specialCommand/index.vue` 两处 `planId: 280` → `281`
  - `PersonnelDispatchPanel.vue` `PLAN_ID = 280` → `281`
  - `DispatchTaskPopup.vue` 默认值 280 → 281（兜底）
- Phase 5 完成：
  - 在 scoped scss 中给 `.capsule-group--special` 单独覆盖蓝色背景 / 边框 / hover / active 样式
  - 整体校验：grep 已删除模块的引用、planId 280 残留、新分类 key 用法、括号匹配（{:195 }:195 (:354 ):354）

## 自查结果
- 文件行数：specialCommand/index.vue 1300 行（commandDispatch 1480 行）→ 删减 180 行，与设计目标吻合
- KeepAlive 共存：两个页面地图容器 id 区分（`command-dispatch-map` vs `special-command-map`），不会抢占 DOM
- 路由路径：`#/typhoon/specialCommand`，命名 `TyphoonSpecialCommand`
- 顶部 tab "专项指挥" 点击跳转到该路由，active 高亮逻辑 isActive 命中

## Session 2 — 风险点 GroundOverlay
- `src/api/commandDispatch.js`：新增 `getRiskPointById`（`/admin-api/business/risk-point/get`）
- `specialCommand/index.vue`：
  - 引入 `getRiskPointById`，定义 `FIXED_RISK_POINT_ID = "2062897713614602241"`
  - 新增 `readAttribute / loadInitialRiskPointOverlay`
  - onMounted 中 renderMap 后调用 loadInitialRiskPointOverlay 拉接口、渲染 `BMapGL.GroundOverlay`
- 用户反馈"图没渲染出来"，定位原因：
  - 数据点 lng/lat = `(120.26307, 33.78485)` 与 endLng/endLat = `(120.26518, 33.78311)`
  - 跨度约 200m × 190m，在默认 zoom=11 全县视野下只占 2~3 像素 → 视觉上不可见
- 修复：在加完 GroundOverlay 后用 `map.centerAndZoom(center, 18)` 把视野推到覆盖物中心（与 safetyProduction 同款做法）
- 附加：新增图片预加载探测（`new Image()`）—— 若资源因证书/混合内容/CORS 被拦截，console.warn 留排查线索

## 已知后续优化点
- `personnel_evacuation` / `peripheral_risk` / `peripheral_video` 三个分类暂未提供专属底栏 svg 图标
  （`peripheral_*` 用了 pin 版做占位 / `personnel_evacuation` 用 `personnel_transfer.svg` 占位）
  → 待视觉补 svg 后替换即可，不影响功能与接口对接
- 第二组胶囊蓝色背景与截图设计稿色值如有差异，可在 `.capsule-group--special` 处微调

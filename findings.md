# Findings — 专项指挥页面实现

## 现有代码线索

### 路由 / 导航
- `src/router/index.js`：`/typhoon` 下三个 children（weatherMap / situationAnalysis / commandDispatch）+ videoCenter，均通过 typhoon/index.vue 的 KeepAlive router-view 加载
- `src/views/typhoon/index.vue`：父布局 = Head + KeepAlive router-view
- `src/components/Head.vue` tabList 第 47 行：`{ name: "专项指挥", route: "" }` — 路由名是空字符串，点击不会跳转。需要把 route 改成 `TyphoonSpecialCommand`

### commandDispatch 当前结构（要原样保留的部分）
- 1480 行的 index.vue + 14 个 components/*.vue（9265 行总规模）
- 底部 3 组胶囊（group 1 / 2 / 3）共 15 个分类
- 顶部叠加 MapDrawToolbar 浮层（提供"队伍调度 / 物资调度"按钮）
- 各类联动面板（MaterialStatistics / Shelter / Hospital / RescueTeam / Waterlogging / PersonnelTransfer / MaterialDispatch / PersonnelDispatch）
- 调度核心：handleStart{Material,Team}Dispatch → finishDispatchPicking（lookupCategoryOrigins / calculateArrowPoints / createDispatchTask）

### planId 全部出现点（要改为 281）
| 文件 | 行 | 用法 |
|---|---|---|
| commandDispatch/index.vue | 573 | `dispatchTaskRef.open({ planId: 280, type })` |
| commandDispatch/index.vue | 832 | `createDispatchTask({ ..., planId: 280, ... })` |
| commandDispatch/components/PersonnelDispatchPanel.vue | 96 | `const PLAN_ID = 280` |
| commandDispatch/components/DispatchTaskPopup.vue | 127 | 默认值 280（调用方显式传 281 后无影响，但更新默认更整洁） |
| commandDispatch/components/GroupDetailPopup.vue | 66 | 通过 prop 传入（由 PersonnelDispatchPanel 传） |

### POINT_FETCHERS / pointType 字典
- 现有 pointType：101 低洼 / 102 积涝 / 103 危房 / 104 大棚 / 105 高空构建 / 106 高空作业 / 107 海堤 / 108 河道 / 109 闸口 / 110 人员转移
- 新增 pointType：**203 人员疏散 / 204 周边风险 / 205 周边视频**（来自用户截图标注）
- 调用方式：`getPointsByType({ pointType: 203 })`（与现有完全相同）

### SVG 资源现状（src/assets/images/sydp/）
**已有**：
- 4 个核心分类的 svg + _active + pin_ 三件套：emergency_materials / shelter / hospital / rescue_team
- 仅 pin 版：`pin_peripheral_risk.svg`、`pin_peripheral_video.svg`
- 与"人员疏散"语义最近：`personnel_transfer.svg`（_active 也有）+ `pin_personnel_transfer.svg`
- 终点旗：`destination.svg`

**缺**：
- `personnel_evacuation.svg` / `_active`（用 personnel_transfer 占位）
- `peripheral_risk.svg` / `_active`（用 pin 版占位）
- `peripheral_video.svg` / `_active`（用 pin 版占位）

### 截图分析
- 顶部地图叠加：标绘工具按钮 + "队伍调度" "物资调度"（与 commandDispatch 一致）
- 底部胶囊：左侧深色组（4 项）+ 右侧偏蓝色组（3 项）
- 右侧组中"人员疏散"为 active 态（亮蓝高亮）
- 上方地图标注红色路径（救援车 → 红旗 + destination 标记）→ 已实现的调度箭头
- 左侧红色"被困人员"图标 + 蓝色"积水区" + 绿色"疏散区" → 是用 MapDrawToolbar 标绘的，无需在新页面单独实现

## 决策记录

### 复用还是新建子组件？
**决策：完整复制 commandDispatch/components 全套**
理由：
- 用户指令"其它功能都是一样的，调用的接口也是一样的" → 行为完全一致
- 若改成 commandDispatch 引用 + 配置注入，需要把 commandDispatch 改造成可配置组件（planId、bottomCategories 注入），大改面铺得太广，回归测试代价高
- 复制后两份独立维护，安全可控；后续如有共用诉求再做抽象

### 地图容器 id 冲突
typhoon 父布局对子路由统一 `<KeepAlive>`，两个页面同时存在缓存时若共用 `id="command-dispatch-map"` 会导致 BMapGL 二次初始化抢 DOM。新页面用 `id="special-command-map"` 隔离。

### 第二组胶囊视觉
截图右侧 3 项胶囊背景明显偏亮蓝（与左侧深色不一致）。在 specialCommand/index.vue scoped scss 内单独覆盖 `.capsule-group:nth-of-type(2)` 的 background / border。如视觉对不上设计稿可再调。

# 城市三维景点人流 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 巡览镜头到站后，在该景点的步行路径上生成低多边形小人并走动，离站淡出。

**Architecture:** 新增 `src/views/city/scene/crowd.js`（全城共用一套 InstancedMesh 人群，按路径生成与推进）；景点模块在 build 结果里新增 `walkways`；注册表汇总后由 `CityScene` 在到站 / 离站时调用 `crowd.show / hide`。

**Tech Stack:** three.js 0.186（InstancedMesh、instanceColor）、Node 冒烟测试、无头 Chrome 截图脚本。

**设计文档：** `docs/superpowers/specs/2026-09-29-city-crowd-design.md`

---

## 通用约定

与 `docs/superpowers/plans/2026-09-28-city-landmarks.md` 的「通用约定」一致：分支 `feature/city-3d`、提交信息末尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`、逐个 `git add` 路径、中文注释、场景模块相对导入带 `.js`、lint 门槛只检查 `src/views/city`、开发服务器已在 https://localhost:8892 运行（不要启动服务器）、截图用 scratchpad 里的 `cdp.mjs`。坐标 X 东 Z 南 Y 上（米）。

---

### Task 1: 人群系统与接入（以宽窄巷子为首个样例）

**Files:** Create `src/views/city/scene/crowd.js`；Modify `src/views/city/scene/theme.js`、`landmarks/index.js`、`CityScene.js`、`src/views/city/lab/lab.js`、`landmarks/kuanzhai.js`（只加 walkways）

- [ ] **Step 1: theme.js 新增 crowd 段**

```js
  /* ---- 景点人流（插画式放大：真人约 1.7 m，到站 300～720 m 外只有几个像素） ---- */
  crowd: {
    max: 240, // 全城同时活跃的人数上限
    height: 3, // 小人身高（米）
    speed: [2.0, 3.2], // 行走速度区间（米/秒，按放大后的身高换算）
    perMeter: 0.04, // 每米路径的人数（density = 1 时）
    fade: 0.6, // 淡入淡出时长（秒）
    turn: 0.4, // 折返转身时长（秒）
    shirts: ["#E8553D", "#F2A93B", "#3F8FD6", "#5FB36A", "#F4F1EA", "#8E6FD1", "#E27AA6", "#2E3440"],
    pants: ["#2F3A4A", "#4A4F57", "#6B5A48", "#3C5A7A"],
    skin: ["#F2D3B3", "#E8C29C", "#D9AE86"],
    hair: ["#1E1E22", "#3A2A20", "#5A4030"]
  },
```

- [ ] **Step 2: crowd.js**

按设计文档「crowd 模块」实现，要点：
- 几何（局部 y=0 为脚底，身高 h）：身体 = 8 边圆台（底半径 0.2h、顶半径 0.16h、高 0.36h，底在 0.36h）；头 = 球（半径 0.11h，中心 0.86h）；发片 = 球的上半部（半径 0.115h，同中心，稍压扁，与头同一实例矩阵）；腿 = 6 边圆柱（半径 0.06h、长 0.38h，顶端在髋 0.38h 处，几何原点平移到髋部，便于绕 X 轴摆动）。左右腿分别一个 InstancedMesh（相位相差 π）。
- 共 5 个 InstancedMesh：body、head、hair、legL、legR，全部 `castShadow = false`、`receiveShadow = true`、`frustumCulled = false`（实例分散，默认包围球不准），`userData.animated = true`；材质 `MeshStandardMaterial({ roughness: 0.8, flatShading: true })`，基色白、靠 instanceColor 着色。
- 每人状态存于 Float32Array（结构化数组）：walkway 索引、s、dir、speed、offset、phase、scale（淡入淡出）、yawCurrent、turnTimer；颜色在 show 时写入 instanceColor 一次。
- 路径预处理：折线累积弧长、每段切线；闭合路径首尾相连。`sample(walkway, s)` 返回位置与切线。
- 人数分配：`n_i = round(length_i × perMeter × density_i)`，总和超过 max 时按比例缩减；每人初始 s 均匀随机、dir 随机（闭合路径全部同向或各半），偏移 `(rand − 0.5) × width`。
- update(dt)：s += dir × speed × dt；开放路径到端点折返（dir 取反并启动转身计时，转身期间原地、yaw 平滑过渡 π）；步频 = speed / (0.9 × h 步长)；腿摆角 = 0.5 rad × sin(phase)；身体起伏 = 0.03h × |sin(phase)|；写入实例矩阵（位置、yaw、scale）。hide 时 scale 逐步到 0 后把 count 置 0。reduceMotion 时 speed = 0、腿不摆。
- 随机用 `utils.js` 的 `mulberry32(seed)`。
- 只在有活跃人时更新矩阵；`instanceMatrix.needsUpdate = true`。

- [ ] **Step 3: 注册表与场景接入**

- `landmarks/index.js`：build 结果里的 `walkways`（缺省 `[]`）汇总为 `walkwaysBySpot`，随 `createLandmarks` 返回。
- `CityScene`：创建 crowd（加入 root）；`onArrive(i)` → `crowd.show(walkwaysBySpot[i], 1000 + i)`；`onStopChange`（离站）与 `gotoOverview` → `crowd.hide()`；`_loop` → `crowd.update(dt)`；`dispose` → `crowd.dispose()`。拾取忽略人群。
- lab.js：景点模式默认显示人群（`people=0` 关闭）；显示后先 `update` 推进 3 秒（固定 60 步）再渲染首帧；陈列页 `landmark=kit` 增加一组人群样例（一条 40 m 直线路径，10 人），用于检查造型。

- [ ] **Step 4: 宽窄巷子 walkways**

在 `kuanzhai.js` 的返回里加 `walkways`：三条巷道中线（用已算好的裁剪后端点，街区坐标换算到世界坐标），`y = 1.0`，宽度取巷宽减 1.5 m，宽巷子 density 1.5、窄巷子 1、井巷子 1。

- [ ] **Step 5: 验证**

- Node：`crowd` 冒烟——一条 100 m 直线路径，show 后推进 10 s，所有人都在路径 ± width/2 内、y 等于路面、无 NaN；开放路径端点折返有效；hide 后 1 s 内 count 为 0；推进 120 人一帧的耗时 < 1 ms（取 1000 帧平均）。
- lab：`city-lab.html?landmark=kit` 近看人群样例（shadow=tight），确认头、发、身体、腿比例与配色；`city-lab.html?landmark=kuanzhai&yaw=298&pitch=35&dist=320` 截图，确认巷道里有人；再用 `--eval` 推进后连拍第二帧（或两次截图间隔 1 s），确认位置变化。
- 城市页：`#/city?spot=3`（约 16 s 延迟）截图，确认到站后巷道里出现人群；控制台无报错。

- [ ] **Step 6: Lint 并提交**

```bash
git add src/views/city/scene/crowd.js src/views/city/scene/theme.js src/views/city/scene/landmarks/index.js src/views/city/scene/CityScene.js src/views/city/lab/lab.js src/views/city/lab/kitShowcase.js src/views/city/scene/landmarks/kuanzhai.js
git commit -m "feat(city): 景点人流系统，宽窄巷子巷道行人"
```

---

### Task 2: 其余 6 个景点的步行路径

每个景点模块只加 `walkways` 字段，不改模型。路径必须落在可走的面上（铺装、巷道、甬道、屋顶花园小径、桥面、步道），不穿楼、不落水、不悬空；路面高度用模块里已有的常量。

- **天府广场**：铺装顶面高度；3～4 条贯穿广场的散步线（避开草坪与喷泉）、金盘外环（闭合）、科技馆前南北轴线；下沉广场里一条环路（下沉地面高度）。
- **春熙路·太古里**：街区内 3～4 条主要步行街（取重建店铺之间的空隙中线）、大慈寺中轴甬道（铺装高度）。
- **成都 IFS**：屋顶花园已有小径的中线（草皮顶面 + 路面厚度）、红星路一侧人行道（地面 0.9）。
- **人民公园**：纪念碑广场环路（闭合）、广场通往茶社的园路、茶社院内一条短路。
- **文殊院**：中轴甬道、东院环路、塔周环路（闭合，塔放大后的石台外）。
- **合江亭**：河岸步道（亭子一侧）、廊桥桥面全长（桥面高度）、亭子台基上一小段环路。

每个景点截图 `#/city?spot=N`，确认人群分布自然。可由 1～2 个实现者完成，改动只在各景点模块。

提交：`feat(city): 其余景点步行路径与人流`（可按景点分多次提交）。

---

### Task 3: 验收与文档

- 7 站截图（`#/city?spot=0..6`），每站连拍两帧确认在走动。
- 性能：7 站各自人数、人群系统每帧耗时。
- 设计文档状态改「已实现」，追加实现记录；`CLAUDE.md` 的 city 说明补一句人群与 `people=0`。
- Lint 门槛、`yarn build` 成功后删除 dist/。

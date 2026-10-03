# 天府广场按实景重做 实施计划

> 设计文档：`docs/superpowers/specs/2026-10-02-city-tianfu-redo-design.md`（下称「设计」）。
> 设计里的「报告」是附录 A 的调研报告，「附录 B」是设计系坐标数据。
> 按任务派子代理实现，每个任务完成后做规格审查与质量审查，中途不停下等用户确认。

**目标**：把 `/city` 第 1 站天府广场的景点模型按卫星图与近年照片重做，景点合计 ≤ 30,000 三角形、Mesh ≤ 3、步行路径 0 坏点。

## 共用约定（每个任务都适用）

- **先读**：
  - 仓库根目录的 `CLAUDE.md`：rem 缩放、自动导入、代码风格、中文注释要求。
  - 设计的第 1～7 节；报告里与本任务相关的小节。
- **代码风格**：Prettier（无分号、双引号、2 空格），ESLint 0 警告。所有新代码都要有清晰的中文注释，写清业务含义、尺寸来历（引用报告小节或照片编号）。
- **坐标**：广场构件一律在设计系 (u, v) 里写，用 `frame(qx + 2.3, 0, qz - 10.0, -1.5)` 换到世界。高度从铺装顶面 `PAVE` 算。
  - `kit/builder.js` 的 `frame(cx, y, cz, bearing)`：bearing 0 时局部 +X 向东、+Z 向南；bearing −1.5 时 +X 指向方位 88.5°。
- **kit 工具**：`src/views/city/scene/landmarks/kit/`。
  - builder：`ColorBuilder`、`frame`、`local`、`landmarkMaterial`；
  - shapes：`box`、`cylinder`、`sphere`、`extrudePolygon`、`ribbon`、`sweepBar`、`fromTriangles`；
  - footprint：`circlePolygon`、`rectPolygon`、`insetPolygon`、`distToSegment`；
  - figures：`addTree`、`addTotem`、`addSunbirdDisc`；
  - parts：`addBalustrade`、`addColumns`；
  - 其余见各文件。能复用就复用，不要另写一份同样的函数。
- **校验工具**（只读，Node 里构建景点）：
  - `node scripts/city-landmark-check.mjs stats 天府广场`：三角形、Mesh、底座高度、路径、几何哈希；
  - `node scripts/city-landmark-check.mjs walk 天府广场`：步行路径校验，`坏点合计 0` 为过线；
  - 回归：`node scripts/city-landmark-check.mjs stats 天府熊猫塔 "成都 IFS" 杜甫草堂 望江楼 "武侯祠·锦里" 熊猫基地`，与 `/tmp/tianfu-baseline.txt` 比对（Task 0 生成）。**除天府广场外，所有景点哈希都不能变。**
- **实验页**：`/city-lab.html?landmark=tianfu&yaw=&pitch=&dist=&tx=&tz=`。从南看用 `yaw=180`；`people=0` 关人群。
  - 开发服务器用内置浏览器的 `preview_start` 名称 `bi-demo`（端口 8893），不要用 Bash 启动服务器。
  - 用 `tabs_create` 开自己的标签页，截图前 `tabs_select` 把它切到前台：后台标签页的 requestAnimationFrame 不跑。
  - 实验页渲染一帧后设 `window.__labReady = true`；`window.__labStats` 给出三角形与 Mesh 数。
- **城市页**：`#/city?spot=0` 是天府广场站。1920 × 1080 的视口模拟只渲染在角落，用 960 × 540（同 16:9）模拟测量，坐标 × 2 换回设计稿 px。
- **提交**：
  - 只暂存本任务改的文件，逐个 `git add`。
  - **绝不要**暂存或修改 `.claude/launch.json`、`scripts/dev-http.mjs`（不是我们的改动）。
  - 提交信息结尾带一行 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- **换行符**：用 Python 改文件时一律二进制读写（`open(p, 'rb')` / `'wb'`）。文本模式在 Windows 上会把整篇转成 CRLF。
- **预算**：每个任务报告本任务新增三角形与景点累计值，不超过设计第 5 节的分项上限。

---

## Task 0（主控自己做）：记录基线

- [ ] 跑全部景点 `stats`，存到 `/tmp/tianfu-baseline.txt`。
- [ ] 记下天府广场现状：14,528（13,808 + 720），Mesh 2。

## Task 1：城市地面挖洞

**文件**：`src/views/city/scene/terrain.js`、`src/views/city/scene/CityScene.js`、`src/views/city/lab/lab.js`、`src/views/city/scene/landmarks/index.js`（契约注释与收集）。

- [ ] **景点契约**：`build(ctx)` 可选返回 `groundHoles: [[x, z], ...][]`，即世界坐标多边形。`createLandmarks` 汇总所有景点的洞，放进结果的 `groundHoles` 数组；文件头的契约注释同步。
- [ ] **terrain**：`createTerrain` 返回的对象（或另导出的函数）提供 `setGroundHoles(holes)`。
  - 有洞时用带洞的 `Shape` 三角化 `GROUND_SIZE` 见方的地面，旋转、平移与现在的 `PlaneGeometry` 一致；无洞时不动现在的平面。
  - 注意三角化方向与法线朝上；`receiveShadow` 保持。
- [ ] **调用**：`CityScene` 与 `lab.js` 在景点建完后调用一次。lab 页没有洞时同样不变。
- [ ] **其他图层**：检查绿地层（0.2）与水面层（0.3）会不会压在洞上。只需写一个通用机制：
  - 洞所在区域内的绿地、水面多边形整块跳过，或也挖洞，任选其一，并写清理由；
  - 天府广场坑口范围内有没有这类多边形，留到 Task 5 实测。
- [ ] **验证**：
  - 主城区所有景点哈希不变（stats 回归）；`CityScene` 构建流程在无洞时与改动前逐位一致。
  - 写一个临时 Node 脚本或在实验页里传一个测试洞，确认地面确实挖空、法线朝上、阴影正常；测试代码不提交。
- [ ] **提交**：`feat(city): 城市地面支持景点挖洞`。

## Task 2：拆分 tianfu.js（几何不变）

**文件**：`src/views/city/scene/landmarks/tianfu.js` → `src/views/city/scene/landmarks/tianfu/`；改 `landmarks/index.js` 的注册路径，以及 `lab.js` 若有直接引用的地方。

- [ ] 拆成目录：
  - `index.js`：`build` 入口，组装各部分、材质、`walkways`、`update`；
  - `site.js`：坐标系、`PAVE`、颜色表 `C`、设计系 `frame` 工具、通用小函数；
  - `square.js`：现有广场部分，后续任务逐块替换；
  - `north.js`：毛主席像、科技馆；
  - `neighbors.js`：成都博物馆、四川省图书馆，以后不再改。
- [ ] 在 `site.js` 里加好设计系常量与工具：
  - 原点偏移 (2.3, −10.0)、方位 −1.5°；
  - `designFrame(qx, qz)`；
  - 设计系 → 世界坐标的点换算 `toWorld(u, v)`，供 walkways、zones、groundHoles 使用。
- [ ] **验证**：`stats 天府广场` 的三角形与哈希与 Task 0 记录的**逐位相同**；回归不变。
- [ ] **提交**：`refactor(city): 天府广场拆成目录模块（几何不变）`。

## Task 3：地面、太极、草坪花带、太阳神鸟盘

**文件**：`tianfu/ground.js`（新）、`tianfu/sunbird.js`（新，或并入 ground）、`tianfu/index.js`、`tianfu/square.js`（删掉被取代的部分）、`src/views/city/data/cityData.js`（天府广场 lon / lat）。

- [ ] **按设计第 3 节「铺装高度」「浅色外板」「太极」「太阳神鸟盘」「草坪与花带」实现**：
  - 外沿：去掉浅色台阶，改成与铺装同色的直边。
  - 北侧花带与连续绿篱放在 Task 6 一起做。
- [ ] **删除旧件**：
  - S 形分界带（横贯矩形的那条）、Φ54 大金盘；
  - 两道南北向条形喷泉与其水柱：水柱 Mesh 留到 Task 6 改用；本任务可以先让水柱 Mesh 为空，但要保证 `update` 不报错；
  - 旧下沉广场、12 根图腾柱、旧草坪。
- [ ] **定位针**：`cityData.js` 天府广场的 lon / lat 改为神鸟盘中心（设计系 (0, −0.3)，用 `projection.js` 反算到 6～7 位小数）。`markerHeight` 取盘顶最高处（北缘）的世界高度，并在注释里写明。
- [ ] **zones**（替换区）：覆盖整个广场面，外扩 2 m，按 −1.5° 旋转。
- [ ] **walkways 临时**：
  - 保留仍然有效的几条，或先放一条绕神鸟盘的环（半径 12）和南北中轴；
  - `walk` 必须 0 坏点；
  - 最终路径在 Task 8 重排。
- [ ] **验证**：
  - stats 记下本任务三角形（地面 ≤ 5,000 减去绿篱份额、神鸟盘 ≤ 1,200）；walk 0；回归不变。
  - 实验页从南、东南截图：太极只在圆内，草坪内凹弧贴着大圆，花带红底黄块。
- [ ] **提交**：`feat(city): 天府广场太极铺装、草坪花带与太阳神鸟盘`。

## Task 4：西鱼眼「长江龙」

**文件**：`tianfu/westEye.js`（新）、`tianfu/index.js`、`tianfu/ground.js`（挖深色盘洞，若需要）。

- [ ] 按设计第 3 节与报告 6.3 实现，中心 (−44.9, −0.75)。
- [ ] **金色飘带龙**：
  - 用 `kit/shapes.js` 的 `ribbon`（或 `sweepBar`）沿螺旋折线生成扁带，宽 1.6～2.0；
  - 从水面绕柱身、绕出托盘外缘、再绕白杆上升，龙头到 10.8；
  - 龙头可以用几个块体简化，读成「金色龙首」即可。
- [ ] 水面颜色 #5E9AA3，托盘青绿 #5E8F80，金 #D9AE4A，青铜柱 #2E3A33。
- [ ] **验证**：
  - 本任务 ≤ 3,200；walk 0；回归不变。
  - 近景截图：`dist=150`，`tx`、`tz` 对准西鱼眼。对照报告照片 c29、c16。
- [ ] **提交**：`feat(city): 天府广场西鱼眼长江龙`。

## Task 5：东鱼眼「黄河龙」下沉广场

**文件**：`tianfu/eastEye.js`（新）、`tianfu/index.js`（返回 `groundHoles`）、`tianfu/ground.js`（铺装在坑口挖洞）。

- [ ] 按设计第 3 节与报告 6.4 实现，中心 (48.7, −0.7)：
  - 坑口半径 27.5、深 6.0、坑底半径 15.6；
  - 坑壁上部 2.4 m 是红褐色浮雕带，下部是店面带；
  - 8 段玻璃采光顶，夹 5 道 3 m 宽的放射楼梯；
  - 坑口深绿栏杆；
  - A、B 玻璃亭；
  - 西南大台阶与斜玻璃雨棚；
  - 中心双托盘金龙雕塑，高 17.2（从坑底算）。
- [ ] **`groundHoles`**：返回坑口圆（世界坐标，外扩 0.5 m）。核实城市地面在坑口内确实挖空：城市页与实验页都要看。
  - 同时实测坑口范围内有没有 OSM 绿地或水面多边形（Task 1 的机制），有就处理。
- [ ] **坑底**：标高 `PAVE − 6`（约 −4.5），低于 `GROUND_Y`。阴影、深度排序要正常，坑壁不露缝。
- [ ] **验证**：
  - 本任务 ≤ 5,500；walk 0；回归不变。
  - 近景与俯视截图对照报告照片 c25–c27、c00、c07。
- [ ] **提交**：`feat(city): 天府广场东鱼眼下沉广场（地面挖洞）`。

## Task 6：北缘喷泉、图腾柱、路灯、构筑物与树

**文件**：`tianfu/north edge` 一类的新文件（命名自定，如 `edges.js`、`trees.js`）、`tianfu/index.js`。

- [ ] **北缘**（设计第 3 节「北缘」、报告 6.5）：
  - 两个喷泉池，池内隔墙每 10 m 一道；
  - 水柱进动画 Mesh（`update(t)` 里只改 `scale.y`，同旧做法），≤ 1,200；
  - 池北红色花带与一条连续绿篱；
  - 国旗台与旗杆、红旗。
- [ ] **图腾柱 4 根**：北 (±17, −69)、南 (±17, +86)。用 `addTotem`，高 12，确认它有金球与卷耳；没有就在本景点内补，不改 kit 的默认外观：其他景点若有用到，几何不能变。
- [ ] **凤鸟路灯约 12 盏**：高 6.6，沿北缘与东西步道，造型从简：灯杆加几只弯臂灯头。
- [ ] **构筑物**：两座「天书」雨棚、东入口下沉楼梯口、东南构筑物（设计第 3 节）。
- [ ] **树约 40 棵**：东西林带与南缘一排，`addTree` 的 detail 0。不能种到步道（u ≈ ±105）、构筑物、草坪上。
- [ ] **验证**：
  - 本任务合计 ≤ 1,000 + 1,200 + 1,500 + 1,200 + 1,400 + 绿篱份额；walk 0；回归不变。
  - 从南、东南截图对照用户的两张航拍（设计开头的描述）与报告照片 c19、c15、c28。
- [ ] **提交**：`feat(city): 天府广场北缘喷泉、图腾柱、路灯、构筑物与林带`。

## Task 7：毛主席像与四川科技馆

**文件**：`tianfu/north.js`。

- [ ] 按设计第 4 节、报告 2.2 与 6.8 重做：
  - 毛主席像：深红台座、正面阶梯花坡、两侧草坡、基座与立像；
  - 科技馆：高度，去掉砖红塔楼，10 根赭红柱、横梁与窗带，屋顶红字块与英文条。
  - 轮廓用 OSM（报告 2.2）。
- [ ] 替换区（zones）覆盖新轮廓。科技馆前的南北轴线路径若受影响要一并改。
- [ ] **验证**：
  - 像组团 ≤ 1,800、科技馆 ≤ 3,800；walk 0；回归不变。
  - 截图对照照片 c15、c21、c22。
- [ ] **提交**：`feat(city): 天府广场北侧毛主席像与四川科技馆按照片修正`。

## Task 8：步行路径、机位与集成

**文件**：`tianfu/index.js`（或单独的 `walkways.js`）、`src/views/city/data/cityData.js`（`cam`）、设计文档（追加「集成记录」）。

- [ ] **步行路径**：按设计第 6 节重排，walk 0 坏点；人数约 70～100（`theme.crowd.perMeter` × 长度 × density）。
- [ ] **到站机位**：`#/city?spot=0`（960 × 540 模拟）。
  - 要求：太极大圆、两鱼眼、北缘喷泉、毛主席像与科技馆同框；南侧高楼不挡下沉广场；定位针与标签不压左栏（x 28～408、y 92～611）、右栏（x 1452～1832、y 92～523）、顶栏（y < 80）、导航（y 1001～1054）。
  - 最终值与理由写进 `cam` 上方注释。
- [ ] **总览**：飞回总览，11 个标签互不隐藏、不压面板；比较天府广场标签位置与改前，差约 1 px 内。
- [ ] **城市页**：
  - 下沉广场处地面挖空（拉近看坑底与浮雕带）；
  - 行人到站生成、离站淡出；
  - 控制台无报错。
- [ ] **集成记录**：在设计文档末尾追加 `## 集成记录`，格式参照 `2026-10-01-city-panda-base-design.md` 的同名章节：
  - 最终三角形分项与 Mesh；
  - 步行路径结果；
  - 机位与取舍；
  - 已知限制，例如 8 根图腾柱未建、尺寸估计值。
- [ ] **全量检查**：eslint、prettier、回归 stats、`walk 天府广场`、`yarn build`。
- [ ] **提交**：`docs(city): 天府广场集成记录与机位调整`。

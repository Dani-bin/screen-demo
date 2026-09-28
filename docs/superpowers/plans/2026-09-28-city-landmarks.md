# 城市三维景点精细建模 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/city` 的 7 个景点按真实建筑形制做成微缩插画风的程序化精细模型，替换景点范围内的通用方盒楼。

**Architecture:** 新增 `src/views/city/scene/landmarks/`：`kit/` 是可复用的古建与构件库（顶点色合批、屋顶、台基柱列、坡屋顶民居、熊猫等），每个景点一个模块 `build(ctx)`，`index.js` 汇总并告诉通用建筑层要隐藏哪些楼。另加一个仅开发用的单景点预览页 `city-lab.html`，用来快速截图迭代。

**Tech Stack:** three.js 0.186、Vue 3 + Vite、Node 冒烟测试、无头 Chrome 调试协议截图脚本。

**设计文档：** `docs/superpowers/specs/2026-09-28-city-landmarks-design.md`（各景点尺寸、配色、朝向以它为准）

---

## 通用约定

- 分支 `feature/city-3d`。提交信息末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`；提交时逐个 `git add` 路径，不用 `git add -A`。
- 代码风格：无分号、双引号、2 空格、80 列；注释与界面文字用简体中文；CSS 写 px。
- 场景模块不依赖 Vue；相对导入带 `.js` 扩展名（Node 冒烟测试要求）。
- Lint 门槛：`npx eslint --max-warnings 0 "src/views/city/**/*.{vue,js}"` 无输出（`.eslintignore` 弃用提示除外），`npx prettier --check "src/views/city/**/*.{vue,js}"` 通过。不要运行 `yarn lint:eslint`（它带 `--fix` 会改写历史文件）。
- 开发服务器已由主控用预览工具启动在 `https://localhost:8892`（带热更新）。不要再启动服务器，也不要用 Bash 启动服务器。
- 截图工具（无头 Chrome 调试协议）：
  ```bash
  node /private/tmp/claude-501/-Users-zhangjiabin-Desktop-Company-bi-demo/77915fdc-6f9d-4374-afb1-6e5be14b3297/scratchpad/cdp.mjs \
    --url "<URL>" --wait-js "<条件表达式>" --delay <秒> --console --timeout 90 \
    [--eval "<表达式>"] --out <png> [--size 1920x1080]
  ```
  清理临时目录时偶尔以退出码 1 报 `ENOTEMPTY`，只要截图和输出已打印就不影响。渲染是 SwiftShader 软件渲染，很慢，延迟要给足。截图后用 Read 查看图片。
- 参考照片目录：`/private/tmp/claude-501/-Users-zhangjiabin-Desktop-Company-bi-demo/77915fdc-6f9d-4374-afb1-6e5be14b3297/scratchpad/w/img/`
  （前缀：`tf_` 天府广场、`tk_` 太古里、`pd_` IFS 熊猫、`kz_` 宽窄巷子、`rm_` 人民公园、`ws_` 文殊院、`hj_` 合江亭、`as_` 安顺廊桥）。
- 坐标约定：世界坐标 X 向东、Z 向南、Y 向上，单位米。**方位角 bearing** 为相对正北的顺时针角度；局部坐标系里 **-Z 指向 bearing 方向**，+Z 是「正面」。换算：`yaw = -bearing × π/180`，`frame = 平移(cx, y, cz) × 绕 Y 旋转(yaw)`。

## 文件清单

| 文件 | 职责 |
|---|---|
| `scripts/fetch-osm-city.py` | 默认 bbox 扩大 |
| `public/city/chengdu.json` | 重新生成 |
| `src/views/city/data/cityData.js` | 景点坐标纠正 |
| `src/views/city/scene/theme.js` | 新增 `landmark` 配色段 |
| `src/views/city/scene/landmarks/kit/builder.js` | 顶点色合批器、frame 变换工具 |
| `src/views/city/scene/landmarks/kit/footprint.js` | 按名称查楼、最小外接矩形、区域筛选 |
| `src/views/city/scene/landmarks/kit/roofs.js` | 悬山、庑殿/歇山（翘角、可截断）、n 边攒尖、宝顶 |
| `src/views/city/scene/landmarks/kit/parts.js` | 台基、柱列、墙体、殿堂、亭、塔、栏杆、灯笼、坡屋顶民居 |
| `src/views/city/scene/landmarks/kit/figures.js` | 低多边形熊猫、游船、神鸟金盘、图腾柱 |
| `src/views/city/scene/landmarks/index.js` | 注册表 `createLandmarks` |
| `src/views/city/scene/landmarks/{tianfu,taikooli,ifs,kuanzhai,peoplesPark,wenshu,hejiang}.js` | 7 个景点 |
| `src/views/city/scene/buildings.js` | `createBuildings` 支持排除集合 |
| `src/views/city/scene/markers.js` | 支持外部传入底座高度 |
| `src/views/city/scene/CityScene.js` | 接入景点、深链接起始站、景点拾取 |
| `src/views/city/index.vue` | 读取 `?spot=N` |
| `city-lab.html`、`src/views/city/lab/lab.js` | 开发用单景点预览页（不进生产构建） |

---

### Task 1: 数据范围扩大、景点坐标纠正、深链接

**Files:** Modify `scripts/fetch-osm-city.py`、`public/city/chengdu.json`、`src/views/city/data/cityData.js`、`src/views/city/scene/theme.js`、`src/views/city/scene/CityScene.js`、`src/views/city/index.vue`

- [ ] **Step 1: 扩大默认 bbox**

`fetch-osm-city.py` 的 `--bbox` 默认值改为 `30.636,104.040,30.686,104.098`（原点 `--origin` 不变）。

- [ ] **Step 2: 重新生成数据**

```bash
SSL_CERT_FILE=/etc/ssl/cert.pem python3 scripts/fetch-osm-city.py
```
Overpass 繁忙时脚本会自动换镜像重试，可能要十几分钟。完成后校验：
```bash
python3 -c "
import json; d=json.load(open('public/city/chengdu.json'))
names={b['n'] for b in d['buildings'] if b['n']}
need=['山门（天王殿）','三大士殿','大雄宝殿','说法堂','藏经楼','文殊阁','IFS Tower 1','IFS Tower 2','IFS Tower 3','IFS Tower 4','IFS国际金融中心','成都博物馆','四川省图书馆','弥勒殿','观音殿','药师殿']
miss=[n for n in need if n not in names]
print('buildings',len(d['buildings']),'clip',d['meta']['clip'],'missing',miss)"
```
Expected：建筑数约 9000～11000，`missing` 为空列表（若某个名称缺失，在报告里列出，后续景点任务会退化为按坐标放置）。

- [ ] **Step 3: 相机边界随数据扩大**

`theme.js` 的 `camera.bounds` 改为 `{ x: [-2600, 3100], z: [-3100, 2300] }`，注释说明依据新 `meta.clip`。

- [ ] **Step 4: 纠正景点坐标**

`cityData.js` 中 `SPOTS` 的 `lon/lat` 按设计文档「景点坐标纠正」表修改；每个坐标上方加一行中文注释说明依据（OSM 要素名）。

- [ ] **Step 5: 深链接起始站**

- `CityScene` 构造参数新增 `startStop`（默认 0，越界时取 0），`_initTour` 末尾 `this.tour.gotoStop(startStop, false)`。
- `index.vue` 用 `useRoute()` 读取 `route.query.spot`，`Number.parseInt` 后传给 `startStop`。注释说明用途：分享某个景点的大屏画面、逐景点截图验收。

- [ ] **Step 6: 验证**

```bash
node <cdp.mjs> --url "https://localhost:8892/#/city?spot=5" --wait-js "!!document.querySelector('.city-page') && !document.querySelector('.scene-loading')" --delay 12 --console --timeout 120 --eval "document.querySelector('.spot-name')?.textContent" --out /tmp/claude-501/lm-t1-wenshu.png
```
Expected：eval 输出 `"文殊院"`，截图中镜头停在文殊院上方，北侧不再露出数据边缘。控制台无报错。

- [ ] **Step 7: Lint 并提交**

```bash
git add scripts/fetch-osm-city.py public/city/chengdu.json src/views/city/data/cityData.js src/views/city/scene/theme.js src/views/city/scene/CityScene.js src/views/city/index.vue
git commit -m "feat(city): 扩大数据范围、纠正景点坐标、支持 ?spot 深链接"
```

---

### Task 2: 景点构件库 kit 与单景点预览页

**Files:** Create `src/views/city/scene/landmarks/kit/{builder,footprint,shapes,roofs,common,parts,towers,houses,figures}.js`、`city-lab.html`、`src/views/city/lab/{lab,kitShowcase}.js`；Modify `src/views/city/scene/theme.js`
（实现时拆分：`shapes.js` 基础几何体、`towers.js` 亭与塔、`houses.js` 坡屋顶民居、`common.js` 内部小工具、`kitShowcase.js` 构件陈列；`addPavilion`/`addPagoda`/`addPitchedHouse` 仍从 `parts.js` 导入。）

- [ ] **Step 1: theme.js 新增 landmark 配色段**

```js
  /* ---- 景点精细模型配色（依据实景照片，略提饱和度贴近插画风） ---- */
  landmark: {
    roof: "#4A5361", // 古建灰瓦（偏蓝石板灰）
    roofRidge: "#3A414C", // 正脊、垂脊
    glaze: "#E8B838", // 金黄琉璃瓦 / 宝顶
    gold: "#D9A93C", // 贴金、神鸟金盘
    column: "#B8352B", // 红柱 / 红木
    lattice: "#8E2A22", // 深红花格门窗
    ochreWall: "#D9A640", // 赭黄院墙
    redWall: "#A33A2E", // 寺院红墙
    marble: "#EFEAE0", // 汉白玉 / 浅石栏杆
    granite: "#B9B6AE", // 台基花岗岩
    brick: "#6B7076", // 青砖
    plaster: "#EDE6D6", // 白灰墙
    timber: "#5A4A3C", // 深木格栅
    iron: "#3A3C40", // 铸铁
    pagodaRed: "#8A2E26", // 塔身暗红
    pandaBlack: "#1E1E22",
    pandaWhite: "#F4F4F0",
    lantern: "#D8352A",
    stonePave: "#CFCAC0", // 广场石材铺装
    glass: "#6FA7D6",
    beige: "#E6D6A6"
  },
```

- [ ] **Step 2: builder.js（顶点色合批器）**

导出：
- `class ColorBuilder`：
  - `add(geometry, color, matrix?)`：接管 `geometry` 的所有权（复制后释放原件）。索引几何先 `toNonIndexed()`；缺法线时 `computeVertexNormals()`；删除 `uv`；有 `matrix` 时 `applyMatrix4`（法线随之变换）；写入每顶点 `color`（`Color` 转线性值，与 `Color.set` 默认行为一致）。返回 `this` 以便链式调用。
  - `get triangles()`：已加入的三角形总数。
  - `bake()`：`mergeGeometries` 合并全部部件（只保留 position、normal、color），释放部件，返回 `BufferGeometry`；没有部件时返回 `null`。
- `frame(cx, y, cz, bearingDeg = 0)` → `Matrix4`：平移后绕 Y 旋转 `-bearing`（见通用约定）。
- `local(parent, x, y, z, yawRad = 0, sx = 1, sy = 1, sz = 1)` → `Matrix4`：`parent × 平移 × 旋转 × 缩放`，用于在某个 frame 内摆放部件。
- `landmarkMaterial()` → `MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05, side: DoubleSide })`（屋面是单层曲面，需要双面）。
- `flatMaterial()`：同上但 `flatShading: true`（熊猫用）。

Node 测试（写在 Step 7 统一跑）：两个 BoxGeometry 分别用不同颜色和 frame 加入，`bake()` 后三角形数 = 24，颜色属性前 3 个分量等于第一个颜色的线性值，`frame(10, 0, 0, 90)` 把局部 `(0,0,-1)` 变换到世界约 `(11, 0, 0)`（bearing 90° 指向正东）。

- [ ] **Step 3: footprint.js（轮廓工具）**

导出：
- `findBuilding(buildings, name)` → 索引或 `-1`（先精确匹配，再「包含」匹配）。
- `minAreaRect(points)` → `{ cx, cz, w, d, bearing }`：凸包 + 旋转卡壳求最小面积外接矩形；`w ≥ d`，`w` 是长边；`bearing` 是长边方向的方位角，归一到 `[0, 180)`。
- `rectPolygon(cx, cz, w, d, bearing)` → 4 点多边形 `[[x, z], ...]`（逆时针），用作替换区。
- `circlePolygon(cx, cz, r, n = 16)` → n 点多边形。
- `buildingsInZones(buildings, zones)` → `Set` 索引：楼的顶点平均点落在任一区域内。
- `centroid(points)`（复用 `utils.js` 的 `polygonCenter`）。

Node 测试：矩形 `[[0,0],[40,0],[40,10],[0,10]]` 绕原点旋转 30° 后求 `minAreaRect`，`w≈40、d≈10`，`bearing` 与 `(90-30)=60°` 或其对边相差 < 0.5°；真实数据中 `findBuilding(d.buildings,'大雄宝殿') >= 0`，其 `minAreaRect` 的 `w` 在 20～35 之间。

- [ ] **Step 4: roofs.js（屋顶，全部在局部坐标、底边在 y=0、中心在原点）**

屋面用参数曲面生成：每个坡面由「檐口线段 E(s)」和「屋脊线段 R(s)」插值，`s ∈ [-1, 1]` 沿檐口，`t ∈ [0, tMax]` 从檐口到屋脊：
- 水平位置：`P(s, t) = lerp(E(s), R(s), t)`
- 高度：`y = h × t^1.5`（凹曲面：檐口平缓、屋脊陡）`+ curl × h × s⁴ × (1 − t)²`（四角起翘）
- 每个坡面按 `segS × segT` 细分（默认 8 × 6）。

导出：
- `hipRoof(w, d, h, { overhang = 0.8, curl = 0.35, ridge = 0.5, tMax = 1 })`：四坡顶。檐口矩形 `(w + 2o) × (d + 2o)`，屋脊沿 X，长度 `ridge × w`（`ridge` 小为庑殿感、0.5～0.65 为歇山感）。前后两坡是梯形（屋脊为线段），两侧坡是三角形（屋脊退化为端点）。`tMax < 1` 时截断成一圈檐（重檐下层用）。再沿屋脊加一根正脊方条（高 `0.08h`、宽 `0.06d`），`tMax < 1` 时不加。
- `gableRoof(w, d, h, { overhang = 0.6, sag = 1.3 })`：双坡悬山，屋脊沿 X；两坡按上面的曲面公式（无起翘，指数用 `sag`），两端补竖直山墙三角形，并加正脊。
- `pyramidRoof(sides, radius, h, { overhang = 0.8, curl = 0.45, tMax = 1 })`：n 边攒尖。檐口为外接半径 `radius + overhang` 的正 n 边形，屋脊退化为顶点；`tMax < 1` 时截断。
- `finial(h)`：宝顶，底座小圆柱 + 两个球 + 尖锥，底在 y=0。
- `ridgeBar(len, h, w)`：独立屋脊条（给需要自定义屋脊的地方用）。

Node 测试：`hipRoof(20, 12, 5)` 的包围盒 `x∈[-10.8, 10.8]`、`y∈[0, ≈5.4]`；檐口四角点的 y ≈ `curl × h`（起翘生效）；`pyramidRoof(6, 4, 3)` 顶点 y ≈ 3；所有顶点无 NaN。

- [ ] **Step 5: parts.js（构件，全部接收 `(b, parent, opts)`，直接加进 ColorBuilder；parent 为 Matrix4 frame）**

导出（尺寸单位米，`colors` 缺省取 `THEME.landmark`）：
- `addPlatform(b, parent, { w, d, h, steps = "front", color })`：台基方台；`steps` 为 `"front" | "both" | "all" | "none"`，台阶宽 `min(w × 0.35, 8)`、每级 0.3 高。
- `addColumns(b, parent, { w, d, h, spacing = 3.2, radius = 0.35, y = 0, color })`：沿 `w × d` 矩形周边等距立圆柱（8 边形）。
- `addWalls(b, parent, { w, d, h, y = 0, color, door = { width, height, color } })`：四面墙体（箱体），正面（+Z）中央开一个门色块（贴在墙面外 0.05 m 的薄板）。
- `addHall(b, parent, opts)`：殿堂 = 台基 + 柱列 + 内缩 0.8 m 的墙体 + 花格门窗色带（正面整面 `lattice` 色薄板，高为墙高 70%）+ 屋顶。`opts`：`{ w, d, wallH, platformH, roof: "hip" | "gable", roofH, overhang, curl, ridge, double = false, colors }`。`double: true` 时做重檐：下层 `hipRoof(tMax: 0.55)` 放在墙顶，上层完整屋顶再抬高 `roofH × 0.6`，中间补一圈 `wallH × 0.35` 高的上层墙。返回整体高度（屋顶最高点）。
- `addPavilion(b, parent, { sides, radius, colH, platformH, roofH, double = true, roofColor, colors })`：亭：台基（正 n 边形棱柱）+ n 根柱 + 柱顶一圈额枋 + 攒尖顶（`double` 时重檐）+ 宝顶。返回整体高度。
- `addPagoda(b, parent, { sides = 6, tiers, height, baseRadius, topRadius, bodyColor, eaveColor, trimColor })`：塔：每层塔身 n 边形棱柱（半径由底到顶线性收分），层间一圈截断攒尖翘檐，顶部塔刹（`finial`）。返回整体高度。
- `addBalustrade(b, parent, { points, closed = true, h = 1.1, postSpacing = 2, color })`：沿折线立望柱 + 上下两道扶手条。
- `addLantern(b, parent, x, y, z, { r = 0.5, color })`：灯笼（压扁球 + 上下小帽）。
- `addPitchedHouse(b, footprintPoints, { eaveH, ridgeH, overhang = 0.6, wallColor, roofColor })`：坡屋顶民居。墙体为轮廓挤出到 `eaveH`（ExtrudeGeometry，剔除底面，做法同 `buildings.js`）；屋顶取 `minAreaRect` 沿长边做 `gableRoof(w, d, ridgeH, { overhang })`，放在 `eaveH`。

- [ ] **Step 6: figures.js（小件）**

导出（都加进传入的 builder，parent 为 frame）：
- `addPanda(b, parent, { height = 15, pose = "climb" })`：低多边形熊猫（配合 `flatMaterial` 使用）。由二十面体（detail 1）按比例拉伸的头、身体、四肢、耳朵组成，黑白按真实熊猫分区：耳朵、眼圈、四肢、肩带黑色，其余白色。`pose: "climb"`：身体前倾约 35°，前爪前伸（搭在墙顶），后腿下垂（悬在墙外）；局部 +Z 为熊猫背部朝向（朝街），-Z 为头部朝向（朝屋顶花园）。
- `addBoat(b, parent, { length = 14 })`：游船：红色船身（上窄下宽的截面挤出）+ 黄色顶棚 + 4 根细柱。
- `addSunbirdDisc(b, parent, { radius = 27 })`：太阳神鸟金盘：金色薄圆盘 + 一圈 12 道放射状浅金条纹 + 中心小圆。
- `addTotem(b, parent, { h = 12, r = 0.6 })`：图腾柱：外方内圆柱身（深绿 `#2F5A48`）+ 顶部金球。

- [ ] **Step 7: Node 冒烟测试**

新建 `/private/tmp/claude-501/-Users-zhangjiabin-Desktop-Company-bi-demo/77915fdc-6f9d-4374-afb1-6e5be14b3297/scratchpad/kit-test.mjs`，覆盖 Step 2～4 的断言，并对 parts / figures 每个函数各调用一次后 `bake()`：三角形数 > 0、无 NaN、包围盒尺寸与参数相符（误差 10% 内）。从项目根目录运行：
```bash
node /private/tmp/claude-501/-Users-zhangjiabin-Desktop-Company-bi-demo/77915fdc-6f9d-4374-afb1-6e5be14b3297/scratchpad/kit-test.mjs
```
Expected：逐项 `ok`，最后一行 `kit ok`。

- [ ] **Step 8: 单景点预览页**

- `city-lab.html`（项目根目录，与 `index.html` 同级；Vite 开发时可访问 `/city-lab.html`，生产构建只打包 `index.html`，所以不会进产物）：全屏 canvas，`<script type="module" src="/src/views/city/lab/lab.js">`。
- `lab.js`：读 URL 查询参数 `landmark`（`kit` 或景点名）、`yaw`（相机方位角，度）、`pitch`（俯仰，度）、`dist`（距离，米）、`y`（注视点高度）。
  - 加载 `/city/chengdu.json`，复用 `THEME`、`createMaterials`、`createTerrain`、`createRivers`、`createRoads`、光照参数（与 CityScene 一致，阴影开启）。
  - `landmark=kit`：在原点排一行构件样例（殿堂单檐、殿堂重檐、六角亭、11 层塔、坡屋顶民居、熊猫、游船、神鸟金盘、图腾柱），用于检查构件造型。
  - 其他值：调用 `landmarks/index.js` 的单景点构建（Task 3 提供 `buildLandmark(name, ctx)`；Task 2 阶段只支持 `kit`），并用 `createBuildings` 只画以景点为中心 600 m 内、且不在替换区里的通用楼；相机默认对准景点。
  - 渲染一帧后设 `window.__labReady = true`，之后停止循环（静态截图用，省 CPU）。
- 验证：
  ```bash
  node <cdp.mjs> --url "https://localhost:8892/city-lab.html?landmark=kit&yaw=210&pitch=30&dist=160" --wait-js "window.__labReady===true" --delay 1 --console --timeout 90 --out /tmp/claude-501/lm-kit.png
  ```
  查看截图：殿堂屋顶四角明显上翘、屋面呈凹曲线；重檐两层清楚；亭子攒尖有宝顶；塔 11 层逐层收分；熊猫黑白分区正确；无黑面、无破面。

- [ ] **Step 9: Lint 并提交**

```bash
git add src/views/city/scene/theme.js src/views/city/scene/landmarks/kit city-lab.html src/views/city/lab/lab.js src/views/city/lab/kitShowcase.js docs/superpowers/plans/2026-09-28-city-landmarks.md
git commit -m "feat(city): 景点构件库与单景点预览页"
```

#### 实现记录：最终 API 与相对上文的偏差（Task 3～10 以此为准）

通用约定：所有构件底在局部 y = 0、水平居中；返回非索引几何体。正多边形朝向统一为
「一条边正对 +Z」，顶点 k 在 θ = π/n + k·2π/n（x = r·sin θ，z = r·cos θ），六边形时 ±X 为顶点、±Z 为边
（两座六角亭共用一条边时，应沿局部 Z 排列，或把 frame 转 90°）。

- **builder.js**：`add()` 总是先复制再对原件 `dispose()`（只释放 GPU 资源、不清顶点），所以同一模板几何体可以反复 `add`；`matrix` 行列式 < 0（镜像）时直接抛错。`bake()` 之后合批器清空、可继续复用，并算好包围盒 / 包围球。
- **footprint.js**：
  - `findBuilding(buildings, name, { near, maxDist = Infinity } = {})`：传 `near: [x, z]` 时在同名候选里取顶点平均点最近、且不超过 maxDist 的那栋。数据里「大雄宝殿」有两座：文殊院 #1659（OSM h = 16.2）、大慈寺 #2265（h = 10.4），**重名楼一律传 near**。
  - 新增 `findBuildings(buildings, name)`（全部同名索引）、`polygonArea(points)`、`clipHalfPlane(points, o, n)`（Sutherland–Hodgman，并去掉沿分界线的零宽尖刺）。
  - 新增 `rectFrame(rect, y = 0, frontBearing = 180)` → Matrix4：局部 X 沿长边，+Z 取两条长边法向里更接近 `frontBearing` 的那一个（按 OSM 轮廓放 `addHall` 用这个）。
- **shapes.js（新增）**：`polygonVertex(sides, r, k)`、`fromTriangles(positions)`、`dropBottom(geo)`、`box(w, h, d, { bottom })`、`prism(sides, rBottom, rTop, h, { top, bottom })`、`cylinder(rBottom, rTop, h, { segments, caps })`、`sphere(r, ws, hs)`（底在 0）、`sweepBar(points3d, w, h, { sink })`。
- **roofs.js**：
  - 所有屋顶都接受 `ridges`（默认 true；false 时只返回屋面）、`segS`、`segT`、`thick`（封檐板厚，默认 max(0.08, 0.05h)）选项。檐口外沿挂竖直封檐板，所以几何体最低点在 y = -thick。
  - 新增只返回屋脊的出口：`hipRidges`、`pyramidRidges`、`gableRidge`，以及悬山山墙 `gableWalls`；`gableRoof` 加了 `gables` 选项（默认 true）。这样屋面、屋脊、山墙可以分别配色。
  - `hipRidges` 含 4 条戗脊，外加正脊与两端吻兽块（吻兽高 ≈ 0.13h），所以 `hipRoof(20, 12, 5)` 最高点是 5.54 而不是 5.4。攒尖垂脊止于 t = 0.92，顶点留给宝顶；屋脊退化成点时不输出零面积三角形。
  - 有起翘时，s 方向网格向两端加密（曲面公式不变）；`gableRoof` 默认 `segS = 2`（沿檐口无起翘）。
  - 导出 `roofHeight(s, t, h, curl, pow)`（曲面高度公式）。
- **parts.js**：
  - `addHall`：w × d 是台基（即 OSM 轮廓）尺寸，w 沿局部 X（屋脊方向）；檐柱内缩 clamp(0.1 × 短边, 0.5, 1.5)。新增选项 `steps`、`spacing`、`columnRadius`；缺省 `curl = 0.3`、`ridge = 0.55`、`roofH = 0.42 × 柱网进深`（悬山 0.3）、`overhang = clamp(0.16 × 进深, 0.8, 3)`。
  - 重檐的上层高度不是「roofH × 0.6」：下层截断檐顶再往上露出 0.4 × wallH 的上层墙，上层屋顶檐口约为下层的 80%。悬山殿的山墙用墙色；`double` 只对四坡顶生效。
  - 所有屋顶按「柱线外 0.5 m 处屋面 = 柱顶」下沉落位，檐口垂到柱顶以下，额枋不会戳穿瓦面。
  - `addColumns` 返回柱位 `[[x, z], ...]`；`addWalls` 的 `door: false` 表示不开门；`addBalustrade` 新增 `y` 选项，并加了实心栏板；`addLantern` 的 (x, y, z) 是球心。
  - `addPitchedHouse(b, footprint, { eaveH, ridgeH, overhang = 0.6, wallColor, roofColor, y = 0, rect, ridgeBearing })`，实现在 `houses.js`，由 parts.js 转出。`ridgeH` 指屋脊高出檐口的高度。返回 **`{ rects: [...], top }`**（数组；轮廓无效时返回 null）。
    - 凹形 / L 形处理：充满度 fill = 面积 / 外接矩形面积。fill ≥ 0.85 时，墙按轮廓挤出、屋顶盖外接矩形。
    - fill 不达标时，找一条垂直于矩形某条轴、过轮廓某个顶点的切线，取「较差一半的充满度」最高的切法切成两半，最多切两层（至多 4 块），每块各一套墙和屋顶。
    - 仍不达标时，墙体退回整个外接矩形，保证墙和屋顶相接。L / T 形由此在凹角处切成规整矩形。
    - 传 `rect`（minAreaRect 同构对象）时不切分：fill 达标用轮廓做墙，否则用该矩形做墙。
    - `ridgeBearing` 吸附到矩形里较近的那条轴。
    - 另导出 `housePieces(points, rect?)` → `[{ points, rect }]`，只做切分、不建几何，便于规划和测试。
  - 新增 `palette(colors)`，键为 platform / column / wall / lattice / roof / ridge / finial / trim。
  - 新增转出 `edgeFrame(parent, sides, radius, k, y)` → Matrix4：正 n 边形第 k 条边中点处的坐标系，局部 X 沿边、+Z 朝外；边 k 连接顶点 k 与 k+1，边 sides-1 正对 +Z。
- **towers.js（由 parts.js 转出）**：
  - `addPavilion`：新增 `overhang`（缺省 0.35·radius + 0.3）、`curl`（缺省 0.3）、`columnRadius` 选项。
    - `openEdges`（缺省 `[sides - 1]`，即 +Z 那条边）列出不设坐凳栏的边。六边形的边 5 朝 +Z、边 2 朝 -Z，±X 方向是顶点。
    - 连体双亭（合江亭）沿局部 Z 排列：两中心在 z = ∓radius·cos30°，openEdges 都取 `[2, 5]`。
    - 沿 X 排列：每座用 `local(parent, ∓radius·cos30°, 0, 0, Math.PI / 2)`，openEdges 同样取 `[2, 5]`。预览页 `focus=twin` 有示例。重檐时上层檐口半径为下层的 72%，上层短墙露出 0.45 × colH（花格色）。琉璃瓦的屋脊取同色压暗。
  - `addPagoda`：首层塔身较高；每面一块贴金色块；檐口 `curl = 0.38`；总高（含塔刹）严格等于 `height`。11 层 21 m 约 5.9k 三角形。
- **figures.js**：
  - `addPanda` 的 parent 可为 null（世界坐标）；局部原点在女儿墙顶外沿（y = 0 墙顶，z = 0 外立面，墙在 z < 0 一侧）。脚底约 -0.56·height、耳尖约 +0.44·height；前爪、鼻尖伸进墙内约 0.36·height。目前只有 `"climb"` 一种姿态。
  - `addBoat`：船底在 y = 0，船头朝 +X，船舷外张（上宽下窄，比「上窄下宽」更像船），另加金色舷边；顶棚是黄色小悬山。
  - `addSunbirdDisc`：光芒是 12 道旋转的镰刀形，外加一道外圈细环；纹样高出盘面 0.15 m，避免远景闪烁。
  - `addTotem`：总高 h 含顶部金球；柱身深绿 `#2F5A48` 以常量形式写在 figures.js 里。
- **lab**：
  - 新增 `focus` 参数：kit 时对准某件样例（hall | hall2 | pagoda | panda | pavilion | house | disc | boat | totem）。
  - Task 3 的接入点是 lab.js 里的 `const buildLandmark = null`，换成 `import { buildLandmark } from "../scene/landmarks/index.js"` 即可；景点键映射、600 m 通用楼筛选、替换区排除都已写好。
  - 传给景点模块的 ctx 与生产完全一致，为 `{ project, buildings, theme, spot }`。**ctx 里没有 footprint**，景点模块直接 `import` kit。
  - `shadow` 参数：
    - `city`：景点模式的缺省。太阳位置、`THEME.light.shadowBox`、`shadowBias`、`shadowNormalBias` 和相机 near = 20 全部照搬线上，**验收截图用这个模式，dist ≥ 300**。
    - `tight`：kit 的缺省。阴影收紧到注视点周围 110 m，相机 near = 1，只用于近看构件造型；景点近景细节可以加 `&shadow=tight` 用更小的 dist，但不作为验收依据。
  - 三角形统计挂在 `window.__labStats`；出错时同时设 `window.__labError` 与 `window.__labReady = true`，截图脚本不用等到超时。
  - kit 样例新增 `twin`（共边连体双亭）与 `lhouse`（L 形民居自动切分）。

---

### Task 3: 注册表、通用楼排除与场景接入

**Files:** Create `src/views/city/scene/landmarks/index.js` 与 7 个景点占位模块；Modify `buildings.js`、`markers.js`、`CityScene.js`、`src/views/city/lab/lab.js`

- [ ] **Step 1: 7 个景点占位模块**

每个文件（`tianfu.js`、`taikooli.js`、`ifs.js`、`kuanzhai.js`、`peoplesPark.js`、`wenshu.js`、`hejiang.js`）先导出：
```js
/*
 * <景点名>精细模型（占位）：返回空结果，由对应景点任务替换为真实模型
 */
export function build() {
  return { meshes: [], zones: [], markerHeight: 0 }
}
```

- [ ] **Step 2: index.js 注册表**

```js
/*
 * 景点注册表
 * ----------------------------------------------------------
 * 景点顺序与 cityData.js 的 SPOTS 一一对应（按景点名匹配，不依赖数组下标），
 * 每个模块 build(ctx) 返回 { meshes, zones, markerHeight, update? }。
 * 单个景点构建失败只跳过该景点并打印错误，不影响城市其他部分。
 */
```
导出：
- `LANDMARK_MODULES`：`{ 天府广场: tianfu, "春熙路·太古里": taikooli, "成都 IFS": ifs, 宽窄巷子: kuanzhai, 人民公园: peoplesPark, 文殊院: wenshu, 合江亭: hejiang }`（值为模块的 `build`）。
- `buildLandmark(name, ctx)` → 单个景点结果（lab 页用），模块不存在返回空结果。
- `createLandmarks({ geometry, spots, theme, project })` → `{ group, excluded, markerHeights, pickables, update(t), dispose() }`：
  - 对每个 spot 构造 `ctx = { project, buildings: geometry.buildings, theme, spot }`（spot 已含局部 `x/z`），调用 build；用 try/catch 包住，失败时 `console.error` 并视为空结果。
  - `excluded = buildingsInZones(geometry.buildings, 所有 zones)`。
  - `markerHeights[i] = result.markerHeight`。
  - `pickables`：`Map<Mesh, spotIndex>`，每个 Mesh `castShadow = receiveShadow = true` 并加入 `group`。
  - `update(t)` 依次调用各景点的 `update`；`dispose()` 释放全部 Mesh 的几何体和材质。

- [ ] **Step 3: buildings.js 支持排除**

`createBuildings(buildings, theme, excluded = new Set())`：`excluded.has(i)` 的楼跳过（不参与合并），`faceToBuilding` 仍记录原始索引。Node 测试：排除前 10 栋后，`faceToBuilding` 中不含 0～9。

- [ ] **Step 4: markers.js 支持外部底座高度**

`createMarkers(spots, materials, theme, buildings = [], baseHeights = [])`：`baseHeights[i] > 0` 时直接用它，否则退回 `markerBaseHeight` 估算。

- [ ] **Step 5: CityScene 接入**

- `_buildCity`：先 `this.landmarks = createLandmarks({ geometry: d, spots: this.spots, theme: this.theme, project: this.project })`，`root.add(this.landmarks.group)`；再 `createBuildings(d.buildings, this.theme, this.landmarks.excluded)`；`createMarkers(..., d.buildings, this.landmarks.markerHeights)`。
- 拾取：点击时先对 `this.landmarks.group` 做射线检测，命中则 `tour.gotoStop(spotIndex, true)` 并清除楼体选中；未命中再走原来的楼体拾取。
- `_loop` 里调用 `this.landmarks.update(elapsed)`（elapsed 为累计秒数）。
- 静态阴影：景点动画（游船、喷泉）不投影，所以仍保持 `shadowMap.autoUpdate = false`；在注释里写明「景点动画件一律不投影」。
- `dispose` 中调用 `this.landmarks.dispose()`。

- [ ] **Step 5b: 按站点收紧阴影范围**

城区统一阴影约 1.9 m/texel，景点的柱子、檐下、栏杆阴影会全部糊掉。在 `CityScene` 增加 `_fitShadow(center, R)`：
- 太阳位置 = `center + 光照方向 × 2000`，`sun.target` = `center`（光照方向取 `THEME.light.sunPosition` 归一化）；
- 正交范围 `±R`，`near = 2000 − 1.5R`、`far = 2000 + 1.5R`；`bias ≈ −0.15 / (3R)`，`normalBias = 0.15`；
- `shadow.camera.updateProjectionMatrix()`，`renderer.shadowMap.needsUpdate = true`。

调用时机：巡览飞抵某站（`CameraTour` 抵达回调；没有就在 `onStopChange` 后飞行结束时）用 `R = 1000`；
回总览 / 复位时恢复 `THEME.light` 的原始阴影范围与偏移。注释说明代价：离站点 R 以外的楼在该站停留期间没有阴影。
验证：`?spot=5` 截图中文殊院殿堂的檐下阴影、塔身阴影清晰可见。

- [ ] **Step 6: lab 页支持单景点**

`lab.js` 在 `landmark` 不是 `kit` 时调用 `buildLandmark(name, ctx)`，用它的 `zones` 排除通用楼，相机对准 spot。URL 里景点名用英文键：`tianfu | taikooli | ifs | kuanzhai | peoplesPark | wenshu | hejiang`，在 lab.js 里映射到中文景点名。

- [ ] **Step 7: 验证**

- Node：`createLandmarks` 在占位模块下返回 `excluded.size === 0`、`markerHeights` 全 0，不抛错；一个模块抛错时其他景点照常（用临时 mock 模块测试后删除）。
- 浏览器：`#/city` 正常渲染、7 个标签、无报错（占位阶段画面应与之前一致）。

- [ ] **Step 8: Lint 并提交**

```bash
git add src/views/city/scene/landmarks src/views/city/scene/buildings.js src/views/city/scene/markers.js src/views/city/scene/CityScene.js src/views/city/lab/lab.js
git commit -m "feat(city): 景点注册表、通用楼排除与场景接入"
```

---

### Task 4～10: 七个景点模型（可并行）

每个景点任务只修改自己的模块文件（Task 3 建的占位），不改 kit、注册表或其他文件；如果 kit 缺少必需的构件，在自己的模块里写局部函数，并在报告里说明建议上移到 kit。**不要提交**，由主控在审查通过后提交。

**每个景点任务的统一流程：**
1. 读设计文档对应小节、参考照片（通用约定里的目录与前缀）、kit 源码。
2. 用 `footprint.js` 按名称从 `ctx.buildings` 取真实轮廓（重名时传 `{ near: spot 或设计坐标 }`；名称缺失时退回到设计文档给的坐标与朝向，并在报告中说明）；用 `ctx.project.toLocal(lon, lat)` 换算坐标。
3. 所有静态件加进一个 `ColorBuilder`，`bake()` 后配 `landmarkMaterial()` 成一个 Mesh；熊猫用 `flatMaterial()` 单独一个 Mesh；动画件单独 Mesh 且 `castShadow = false`。
4. 返回 `zones`（替换区，覆盖被模型取代的 OSM 楼）与 `markerHeight`（落点球应坐的高度）。
5. 迭代截图：
   ```bash
   node <cdp.mjs> --url "https://localhost:8892/city-lab.html?landmark=<key>&yaw=<角度>&pitch=32&dist=<距离>" --wait-js "window.__labReady===true" --delay 1 --console --timeout 120 --out /tmp/claude-501/lm-<key>-<n>.png
   ```
   至少两个角度（一张 45° 斜俯视全景、一张近景看标志细节），与参考照片对比形制、层数、朝向、配色，改到可辨认为止。
   景点模式默认 `shadow=city`（与线上相同、相机 near = 20），验收截图 **dist ≥ 300**；看细节可另加 `&shadow=tight` 用更近的 dist，但只作参考。
6. 预算：本景点三角形 ≤ 3 万（天府广场、宽窄巷子、太古里这类片区 ≤ 4 万），Mesh ≤ 2 个。
7. Lint 门槛通过。报告里给出：最终截图路径、三角形数、`zones` 覆盖了哪些 OSM 楼（名称或数量）、与照片对照的结论、偏差与原因。

各景点的形制、尺寸、配色、朝向见设计文档「各景点规格」，这里补充实现要点：

- **Task 4 天府广场 `tianfu.js`**：广场面取 OSM `天府广场` 附近区域（广场本身不是建筑，按设计坐标做 294 × 190 正南北矩形铺装，y = 0.9 盖在道路之上）；科技馆、成都博物馆、四川省图书馆按名称取轮廓（科技馆若无同名建筑，按坐标 104.06329, 30.66226、142 × 109 正南北放置）；毛主席像放在科技馆正南 30 m、面朝南。替换区覆盖三座馆的 OSM 轮廓。
- **Task 5 太古里 `taikooli.js`**：替换区为以 spot 为中心、bearing 30°、370 × 360 的矩形；区内低于 25 m 的 OSM 楼改成 `addPitchedHouse`（檐口 8～12 m 随机，屋脊 +3 m，墙色在 `timber` 与 `plaster` 间随机，屋顶 `roof`）；大慈寺各殿（弥勒殿、观音殿、药师殿、祈福殿等，按名称取）用 `addHall` 单檐歇山、红墙、深灰瓦；寺院外围一圈红墙（按这些殿的整体外接矩形外扩 8 m）；北糠市街字库做六角两层小塔。高于 25 m 的楼不替换（留给通用层）。
- **Task 6 IFS `ifs.js`**：按名称取 `IFS Tower 1～4` 与 `IFS国际金融中心`（裙楼）；塔楼玻璃盒按 OSM 高度，外立面用 `glass` 色 + 横向深色腰线；裙楼高 40、米色、屋顶一层草地与小树（直接加几个低多边形树冠）；熊猫按设计文档放在裙楼面向红星路（裙楼西南长边）一侧、离北端约 30 m 的女儿墙上：背朝街、头朝屋顶花园、后腿垂在立面外。`markerHeight` 取熊猫头顶高度，让落点球停在熊猫旁。
- **Task 7 宽窄巷子 `kuanzhai.js`**：替换区取以 spot 为中心、东西 460 × 南北 260 的矩形（正东西向）；区内 OSM 低层楼全部改成 `addPitchedHouse`（檐口 4～6 m、屋脊 +2.5 m，墙色 `brick`/`plaster` 随机，屋顶 `roof`）；三条巷的中线用设计文档里的巷宽铺石板色带（y = 1.0）；每条巷沿两侧每 12 m 挂一个红灯笼（高 3.5 m）；井巷子南侧文化墙；东入口牌坊。院落天井里的树可直接用低多边形树冠加进 builder。
- **Task 8 人民公园 `peoplesPark.js`**：纪念碑按 OSM 要素位置（104.05447, 30.66076）；鹤鸣茶社按（104.05585, 30.65936）；茶廊 2～3 段、灰瓦、红柱，廊下地面铺满竹椅色小方块。替换区只覆盖碑台与茶社范围。`markerHeight` 取碑顶高度 + 2。
- **Task 9 文殊院 `wenshu.js`**：按名称取山门（天王殿）、三大士殿、大雄宝殿、说法堂、藏经楼、文殊阁及其余有名殿堂（玉佛殿、圆通殿、祖堂、三圣殿）；每殿按 `minAreaRect` 的中心、长宽、朝向用 `addHall`（大雄宝殿单檐歇山、文殊阁三层重檐楼阁、其余单檐）；千佛和平塔按 OSM 位置（104.07025, 30.67710）用 `addPagoda(sides 6, tiers 11, height 21)`，下面六角石台 + 莲花座（一圈压扁球）+ 石栏；院墙沿全部殿堂外接矩形外扩 12 m，赭黄色、灰瓦墙帽，山门一侧开口。替换区覆盖这些殿堂的 OSM 轮廓。
- **Task 10 合江亭 `hejiang.js`**：合江亭按 OSM 轮廓中心（104.08119, 30.64533）与长轴朝向，两座六角重檐亭沿长轴并排、共用中间两根柱（用两次 `addPavilion` 并让中心距 = 2 × 半径 × cos30°），`glaze` 金黄瓦、红柱、3.5 m 花岗岩台基 + 汉白玉栏杆 + 两向台阶；安顺廊桥按 OSM 桥轮廓（104.08340, 30.64425）的 `minAreaRect` 定位与朝向：三孔半圆石拱（拱之间桥墩开圆孔）+ 两层红柱木廊 + 灰瓦歇山顶，中部与两端楼阁高出一层；游船一艘放在两者之间的河面，`update(t)` 让它沿河中心线来回缓慢漂移（振幅 60 m，周期 60 s），不投影。

---

### Task 11: 联调、总览截图、性能与文档

- [ ] **Step 1: 逐景点截图**：`#/city?spot=0..6` 各截一张（delay 足够让飞行结束），查看每张：模型可辨认、与城区衔接自然（无悬空、无穿插、落点球在模型上方）。
- [ ] **Step 2: 总览截图**：`#/city` 点「复位」后截图，确认景点在总览尺度下也醒目、无闪烁。
- [ ] **Step 3: 预算核对**：Node 中构建 7 个景点，统计三角形总数（≤ 20 万）与 Mesh 数（≤ 12）；记录首帧构建耗时增量。
- [ ] **Step 4: 文档**：
  - 本期设计文档状态改为「已实现」，追加「实现记录」：各景点三角形数、替换了哪些 OSM 楼、与照片对照的偏差、已知限制。
  - `CLAUDE.md` 的 city 说明补一句：开发用单景点预览页 `/city-lab.html?landmark=<key>`。
- [ ] **Step 5: Lint、构建并提交**：Lint 门槛；`yarn build` 成功且 `dist` 中没有 `city-lab` 相关产物（`ls dist | grep -i lab` 为空），然后删除 `dist/`。
  ```bash
  git add docs/superpowers/specs/2026-09-28-city-landmarks-design.md CLAUDE.md
  git commit -m "docs(city): 景点精细建模标记已实现并补充实现记录"
  ```

---

## 自查记录

- **规格覆盖**：数据范围与坐标纠正（Task 1）、深链接（Task 1）、配色段与构件库（Task 2）、坡屋顶民居（Task 2 `addPitchedHouse`，Task 5/7 使用）、注册表与排除、失败隔离、景点拾取、落点高度（Task 3）、七个景点（Task 4～10）、验收截图与预算与文档（Task 11）。
- **命名一致性**：`build(ctx)` 返回 `{ meshes, zones, markerHeight, update? }` 在设计文档、Task 3 与 Task 4～10 一致；`createLandmarks` 返回 `{ group, excluded, markerHeights, pickables, update, dispose }` 在 Task 3 定义、Task 3 Step 5 使用；`createBuildings(buildings, theme, excluded)`、`createMarkers(..., buildings, baseHeights)` 前后一致；kit 函数名在 Task 2 定义、Task 4～10 引用。
- **说明**：景点建模需要对照截图迭代，Task 4～10 以精确的形制规格与验收标准代替逐行代码。

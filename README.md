# 三维可视化大屏 · 演示合集

基于 Vue 3 + Vite + three.js 的大屏演示项目，面向展厅 / 指挥中心的 1920 × 1080 整屏展示。
首页集中介绍各个演示，无人操作时自动轮播；每个演示都是可自动巡览、也可随时接管操作的三维场景。

所有演示都使用静态或仿真数据，不需要登录，不依赖地图 SDK、UI 组件库或后端接口。

**在线访问**（推送到 master 后都会自动更新）：

- GitHub Pages：<https://dani-bin.github.io/screen-demo/>
- 自有服务器：<http://152.136.122.39:8892>

> **强制要求（AI 助手协作）**：每次对话都必须使用**简体中文**回复，没有例外。
> 中途的进度说明、调用工具前的一句话说明、最终汇报、提问、代码注释都要用中文，长时间连续工作或上下文压缩之后也一样。

## 演示一览

| 页面             | 路由         | 内容                                                                                                                                           |
| ---------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 演示中心首页     | `#/home`     | 两种视图，顶栏一键切换：「聚焦」为深色全屏预览 + 右侧可筛选目录，每 8 秒轮播；「作品墙」为浅色卡片网格，可按行业分类筛选、搜索，最新演示占大格 |
| 智慧校园三维导览 | `#/school`   | 成都市实验小学西区分校。程序化建模还原红砖学院风校园，6 个导览站自动巡览，可点击建筑查看介绍                                                   |
| 城市三维总览     | `#/city`     | 成都市中心。基于 OpenStreetMap 真实数据还原约 1.9 万栋建筑，12 处地标精细建模，到站后有人流漫步                                                |
| 智慧充电站       | `#/charging` | 光储充一体化超充站数字孪生。Blender 建模，34 根充电桩、光伏与储能，仿真驱动车辆进出、充放电与告警                                              |
| 高新区数字楼宇   | `#/building` | 成都高新区南区 → 金融城双子塔，按城市、园区、楼宇、楼层、房间五级钻取；园区、楼层、房间为 Blender 建模 + Cycles 烘焙光照                       |
| 综合能源补给站   | `#/energy`   | 加油、LNG 加气、重卡超充、乘用车换电的综合补给站。开场从卫星航拍「长出」三维场站，仿真驱动客货车辆进站补能                                     |
| 营山 · 五通村    | `#/hometown` | 作者老家的盛夏沙盘。按卫星图与老照片还原，沿「回家的路」巡览记忆节点，可切换傍晚 / 夜晚                                                        |

根路径 `#/` 自动跳转到首页。常用的链接参数：

- 首页：`#/home?view=spotlight`（聚焦）或 `?view=wall`（作品墙），不带参数时沿用上次的选择；聚焦视图支持方向键和 Enter
- 城市：`#/city?spot=N` 从第 N 站开始巡览
- 数字楼宇：`#/building?level=park` 直接进入某一级（`city` / `park` / `building` / `floor` / `room`），
  楼宇及以下再加 `&b=tower_S`（南塔）或 `&b=tower_N`（北塔），楼层及以下再加 `&f=32F`
- 老家：`#/hometown?skip=1` 跳过开场，`?view=home` 直接看我家近景，`?night=1` 夜晚

## 快速开始

环境要求：Node.js 18+（推荐 22，线上构建和截图脚本都用 22）、yarn。

```bash
# 安装依赖
yarn

# 启动开发服务器：https://localhost:8892（自签名证书，首次打开需在浏览器里确认信任）
yarn dev

# 生产构建（产物在 dist/，部署路径为 /bi/）
yarn build

# 本地预览生产构建
yarn preview
```

不想用自签名证书时，可以改走 http：`DEV_HTTP=1 PORT=8893 yarn dev`（Windows 用 `node scripts/dev-http.mjs`）。

## 目录结构

```
src/
  views/
    home/        演示中心首页（data/demos.js 是演示列表）
    school/      智慧校园三维导览
    city/        城市三维总览（scene/landmarks/ 各地标模型，lab/ 单地标调试页）
    charging/    智慧充电站（sim/ 为运行仿真）
    building/    数字楼宇（components/levels/ 为五个层级，scene/ 下分 map、park、tower、floor、room）
    energy/      综合能源补给站
    hometown/    营山 · 五通村
  router/        路由（hash 模式）
  assets/        字体（标题、正文、数字三款）与全局基础样式
  main.js        入口：全局样式、根字号适配、路由
public/          各演示加载的模型（GLB）、烘焙贴图、地理数据与首页预览图，按演示分目录
scripts/
  blender/       Blender 建模脚本（charging、energy、park、tower、hometown）
  energy/        能源站规划图生成与设计稿比对
  hometown/      老家沙盘地图数据生成
  *.mjs / *.py   数据预处理、截图与校验脚本（见下）
docs/
  design/        各演示的设计稿、效果图与设计说明
  superpowers/   早期功能的设计文档（specs）与实现计划（plans）
.github/workflows/deploy-pages.yml   GitHub Pages 自动部署
.github/workflows/deploy-server.yml  自有服务器（宝塔面板）自动部署，配置步骤见 docs/deploy-baota.md
city-lab.html    单地标调试页入口（仅开发环境）
```

每个演示的页面结构相同：`index.vue` 是页面外壳，`components/` 放面板，`scene/` 放纯 three.js 场景（不依赖 Vue），
`data/` 放静态内容。演示之间不共享组件，各自有自己的顶栏、配色和工具函数。

## 新增一个演示

1. 在 `src/views/<名称>/` 下按上面的结构实现页面，在 `src/router/index.js` 注册路由。
2. 在 `src/views/home/data/demos.js` 的 `DEMOS` 末尾追加一项（名称、介绍、行业分类、标签、3 个指标、主题色、预览图路径）。
   末尾即「最新上线」，在作品墙视图里占大格；行业分类决定首页的筛选标签。首页的页面和组件都不用改。
3. 启动开发服务器后生成预览图（见下）。

## 三维模型

充电站、能源站、数字楼宇（园区、楼层、房间）和老家沙盘的三维模型，由 `scripts/blender/` 下的 Python 脚本在 Blender 5.1+ 里生成
（通过 Blender MCP 插件执行），光照用 Cycles 烘焙成贴图，再导出为 `public/` 下的 GLB。
`public/` 里的 GLB 和烘焙贴图都是生成结果，要改模型请改脚本，不要手动修改。

`models/` 目录（.blend 源文件、烘焙中间文件、Sketchfab 原始模型）不入库，只存在作者本机：
新克隆的仓库可以正常运行所有页面，但无法重新生成模型。各演示的建模、烘焙、导出命令见 `CLAUDE.md`。

## 工具脚本

| 命令                                                            | 用途                                                                                                                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/capture-home-previews.mjs [服务器地址] [key…]`    | 用本机 Chrome 无头模式截取各演示画面，生成 `public/home/<key>.webp`。需先启动开发服务器，默认地址 `https://localhost:8892`；可用 `CHROME_PATH` 指定 Chrome |
| `python3 scripts/fetch-osm-city.py`                             | 从 Overpass API 拉取 OpenStreetMap 数据，生成 `public/city/chengdu.json`；换城市、换范围、只刷新飞地等参数见脚本头注释                                     |
| `node scripts/city-landmark-check.mjs stats <景点名…>`          | 城市地标模型统计：三角形数、Mesh 数、几何哈希等，重构前后对比哈希可确认几何不变                                                                            |
| `node scripts/city-landmark-check.mjs walk <景点名>`            | 校验地标步行路径（支撑面、头顶净空、净距），新地标要求 `坏点合计 0`                                                                                        |
| `node scripts/build-building-geo.mjs`                           | 生成数字楼宇的地图数据（OSM 街道边界、DataV 成都区县、高楼高度），输出到 `public/building/map/` 和 `src/views/building/data/mapData.js`                    |
| `node scripts/build-park-layout.mjs`                            | 把 OSM 园区数据转成 Blender 布局 `scripts/blender/park/layout.json` 和页面数据 `src/views/building/data/parkData.js`                                       |
| `python3 scripts/energy/draw_plan.py`                           | 能源站规划：生成规划图、Blender 布局、页面数据和开场航拍底图                                                                                               |
| `node scripts/energy/capture.mjs` + `scripts/energy/compare.py` | 能源站设计还原度检查：无头截图后与设计稿叠图对比                                                                                                           |
| `python3 scripts/hometown/build_site.py`                        | 老家沙盘：把描好的地图数据转成 Blender 场景数据、页面数据和开场卫星图                                                                                      |

单地标调试页（仅开发环境）：`/city-lab.html?landmark=<key>`，可用 `yaw`、`pitch`、`dist`、`tx`、`tz`、`people`、`t` 等参数调整机位与人流，
`key` 的取值见 `CLAUDE.md`。

## 开发约定

- **尺寸一律写 px**：构建时由 `postcss-pxtorem`（`rootValue: 192`）转成 rem，运行时 `amfe-flexible` 按视口宽度设置根字号，
  整屏按 1920 设计稿等比缩放。不需要转换的样式放进文件名以 `no-convert.css` 结尾的文件。
- **自动导入**：`ref`、`computed`、`onMounted`、`useRouter` 等 Vue / Vue Router API 无需手动 import；
  子组件需要显式 import。`auto-imports.d.ts`、`.eslintrc-auto-import.json` 为生成文件，不要手改。
- **样式基础**：页面样式都是手写 SCSS；`src/main.js` 引入 Tailwind 只为它的基础重置样式（preflight），各页面依赖它，不要删。
- **静态资源路径**：引用 `public/` 下的文件要拼上 `import.meta.env.BASE_URL`，不要写以 `/` 开头的绝对路径，
  否则部署在 `/bi/` 或 `/screen-demo/` 下会找不到文件。
- **代码风格**：Prettier（无分号、双引号、2 空格缩进、80 列）+ ESLint，`src` 目前可全量通过：
  `npx eslint --max-warnings 0 "src/**/*.{vue,js}"`。
- **注释与界面文字使用中文**；非显而易见的业务逻辑、算法与结构要写清楚注释。
- 项目没有单元测试框架，改动通过浏览器实际效果与上面的校验脚本验证。

## 部署

`yarn build` 生成纯静态文件。路由使用 hash 模式，服务器无需配置路由回退。

- **GitHub Pages**：推送到 master 后，`.github/workflows/deploy-pages.yml` 自动以 `BASE_PATH=/screen-demo/` 构建，
  并发布到 <https://dani-bin.github.io/screen-demo/>。进度在仓库的 Actions 页面查看，也可以在那里点 Run workflow 手动重新部署。
  仓库 Settings → Pages 的 Source 需设为 GitHub Actions。
- **自有服务器（宝塔面板）**：同一次推送还会触发 `.github/workflows/deploy-server.yml`，以站点根路径 `/` 构建
  （挂在子目录时用仓库变量 `DEPLOY_BASE_PATH` 指定），再通过 SSH + rsync 发布到服务器的站点目录，
  访问地址 <http://152.136.122.39:8892>。
  服务器地址、部署用户、私钥、目录都放在 GitHub Secrets，没配置时自动跳过。建站、Nginx、密钥与 Secrets 的配置步骤见
  [`docs/deploy-baota.md`](docs/deploy-baota.md)。
- **手动部署**：本地 `yarn build` 默认部署路径为 `/bi/`（由 `.env.production` 的 `VITE_APP_ENV=production` 决定）；
  要部署到其他路径，构建时传入 `BASE_PATH`，例如 `BASE_PATH=/demo/ yarn build`，再把 `dist/` 整个传到服务器对应目录。

## 数据来源

- 城市和数字楼宇的地图数据 © OpenStreetMap contributors，遵循 ODbL 协议，页面中已标注；成都区县边界来自阿里云 DataV GeoAtlas。
- 校园介绍文字与数字引自百度百科词条「成都市实验小学西区分校」，页面中已注明出处与时效。
- 城市景点实景图由项目方提供，存放在 `public/city/spots/`。
- 充电站、能源站的车辆和快充桩外壳等模型来自 Sketchfab，作者与协议在页面上标注（各自 `data/station.js` 的 `MODEL_CREDITS`）。
  其中充电站的两款车（e-Lavida、Sylphy EV）为 CC BY-NC-SA 4.0，仅限非商业使用，商用前必须替换。
- 能源站场址是在地图上截取的假定地块，规划按甲方的设施清单自行设计。
- 老家沙盘按作者提供的卫星影像截图与老照片还原；回忆文字目前是占位内容。
- 各页面中的运营指标、客流、告警等数值均为示意或仿真数据。

## 项目沿革

项目由一个应急管理大屏演变而来。2026-10-06 移除了原有的百度地图、ECharts 面板、视频、AI 对话、登录与字典流程、
Pinia、Element Plus 及公共组件，只保留演示所需的代码与依赖；`docs/superpowers` 中此前的文档可能仍会提到这些内容。

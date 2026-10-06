# 三维可视化大屏 · 演示合集

基于 Vue 3 + Vite + three.js 的大屏演示项目，面向展厅 / 指挥中心的 1920 × 1080 整屏展示。
首页集中介绍各个演示，无人操作时自动轮播；每个演示都是可自动巡览、也可随时接管操作的三维场景。

所有演示都使用静态数据，不需要登录，不依赖地图 SDK 或后端接口。

## 演示一览

| 页面             | 路由       | 内容                                                                                            |
| ---------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| 演示中心首页     | `#/home`   | 聚焦轮播：左侧介绍、右侧大预览、底部演示列表，每 8 秒切换，悬停暂停，支持 ← / → / Enter         |
| 智慧校园三维导览 | `#/school` | 成都市实验小学西区分校。程序化建模还原红砖学院风校园，6 个导览站自动巡览，可点击建筑查看介绍    |
| 城市三维总览     | `#/city`   | 成都市中心。基于 OpenStreetMap 真实数据还原约 1.9 万栋建筑，12 处地标精细建模，到站后有人流漫步 |

根路径 `#/` 自动跳转到首页。

## 快速开始

环境要求：Node.js 18+（预览图截图脚本需要 22+）、yarn。

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
    school/      智慧校园三维导览（scene/ 为纯 three.js 场景，不依赖 Vue）
    city/        城市三维总览（scene/ 三维场景，scene/landmarks/ 各地标模型，lab/ 单地标调试页）
  router/        路由（hash 模式）
  permission.js  路由守卫：首页与演示页免登录
  assets/        字体、全局样式
public/
  home/          首页预览图（脚本生成）
  city/          城市几何数据 chengdu.json（脚本生成）与景点实景图
scripts/         数据预处理、截图与校验脚本（见下）
docs/superpowers/  各功能的设计文档（specs）与实现计划（plans）
city-lab.html    单地标调试页入口（仅开发环境）
```

## 新增一个演示

1. 在 `src/views/<名称>/` 下实现页面，在 `src/router/index.js` 注册路由；
   免登录的演示还要加进 `src/permission.js` 的 `PUBLIC_PATHS`。
2. 在 `src/views/home/data/demos.js` 的 `DEMOS` 末尾追加一项（名称、介绍、标签、3 个指标、主题色、预览图路径）。
   首页的页面和组件都不用改。
3. 启动开发服务器后生成预览图（见下）。

## 工具脚本

| 命令                                                         | 用途                                                                                                                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/capture-home-previews.mjs [服务器地址] [key…]` | 用本机 Chrome 无头模式截取各演示画面，生成 `public/home/<key>.webp`。需先启动开发服务器，默认地址 `https://localhost:8892`；可用 `CHROME_PATH` 指定 Chrome |
| `python3 scripts/fetch-osm-city.py`                          | 从 Overpass API 拉取 OpenStreetMap 数据，生成 `public/city/chengdu.json`；换城市、换范围、只刷新飞地等参数见脚本头注释                                     |
| `node scripts/city-landmark-check.mjs stats <景点名…>`       | 城市地标模型统计：三角形数、Mesh 数、几何哈希等，重构前后对比哈希可确认几何不变                                                                            |
| `node scripts/city-landmark-check.mjs walk <景点名>`         | 校验地标步行路径（支撑面、头顶净空、净距），新地标要求 `坏点合计 0`                                                                                        |

单地标调试页（仅开发环境）：`/city-lab.html?landmark=<key>`，可用 `yaw`、`pitch`、`dist`、`tx`、`tz`、`people`、`t` 等参数调整机位与人流，
`key` 的取值见 `CLAUDE.md`。城市页可用 `#/city?spot=N` 从第 N 站开始巡览。

## 开发约定

- **尺寸一律写 px**：构建时由 `postcss-pxtorem`（`rootValue: 192`）转成 rem，运行时 `amfe-flexible` 按视口宽度设置根字号，
  整屏按 1920 设计稿等比缩放。不需要转换的样式放进名为 `no-convert.css` 的文件。
- **自动导入**：`ref`、`computed`、`onMounted`、`useRouter` 等 Vue / Vue Router API 无需手动 import；
  `src/components` 下的组件全局自动注册。`auto-imports.d.ts`、`components.d.ts`、`.eslintrc-auto-import.json` 为生成文件，不要手改。
- **代码风格**：Prettier（无分号、双引号、2 空格缩进、80 列）+ ESLint。只检查改动的目录，避免 `--fix` 改到无关旧文件：
  `npx eslint --max-warnings 0 "src/views/<目录>/**/*.{vue,js}"`。
- **注释与界面文字使用中文**；非显而易见的业务逻辑、算法与结构要写清楚注释。
- 项目没有单元测试框架，改动通过浏览器实际效果与上面的校验脚本验证。

## 部署

`yarn build` 生成纯静态文件，部署在站点的 `/bi/` 路径下（由 `.env.production` 的 `VITE_APP_ENV=production` 决定）。
路由使用 hash 模式，服务器无需配置路由回退。

## 数据来源

- 城市地图数据 © OpenStreetMap contributors，遵循 ODbL 协议，页面左下角已标注。
- 校园介绍文字与数字引自百度百科词条「成都市实验小学西区分校」，页面中已注明出处与时效。
- 城市景点实景图由项目方提供，存放在 `public/city/spots/`。
- 页面中的城市客流等数值为示意值。

## 遗留代码说明

项目由应急指挥大屏演变而来，`src/components`、`src/api`、`src/utils`、`src/store` 中仍保留部分原有业务代码
（ECharts 面板、视频播放、AI 对话、登录与字典等），目前没有任何路由使用它们。
百度地图相关代码已于 2026-10-06 全部移除。

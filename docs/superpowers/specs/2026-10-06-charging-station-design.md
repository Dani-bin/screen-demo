# 智慧充电站数字孪生 设计文档

日期：2026-10-06
状态：已实现（`/charging`）

## 背景与目标

大屏 demo 合集新增第三个演示：大型「光储充一体化超充站」的运营大屏。
要求：模拟真实车辆充电站、偏科技风；三维**先在 Blender 里建模，再用 three.js 展示**（不再纯代码低模）。

## 关键决策

| 决策点 | 结论 | 理由 |
|---|---|---|
| 场站类型 | 光储充一体化超充站（大型） | 用户选定；能量流、谷充峰放等可展示内容最多 |
| 风格 | 暗场科技风：悬浮沙盘 + 正交等轴俯视 + 青 / 绿 / 红发光 | 用户提供的 EMS 大屏参考图；v1、v2 几何体设计稿被否，v3 起改用 AI 概念图定稿 |
| 设计稿 | AI 生图（中央场站）+ HTML 面板合成 | three.js 几何体做不出参考图质感；概念图 `docs/design/charging/08-ai-station-large.png` |
| 建模 | Blender 5.2，全部写成 Python 构建脚本（`scripts/blender/charging/`），经 Blender Lab MCP 执行 | 可重复构建、改模即改脚本；命名可控，便于代码绑定 |
| 导出 | GLB，不压缩（station 1.9 MB + cars 2.6 MB），贴图转 WebP | 体积已够小，省去 Draco 解码器 |
| 数据 | 纯 JS 仿真（`sim/simulator.js`），按真实时刻与分时电价 | 无后端；车辆会话做演示加速，保证画面上持续有车进出 |
| 图表 | 手写 SVG（环图、电池、曲线） | 与 rem 等比缩放天然契合，无需按屏宽换算 ECharts 尺寸 |

## 场站（90 × 64 m，见 `layout.py`）

- 快充区：3 排 T 形光伏雨棚（宽 11.2 m、向南单坡 4°，罩住桩岛与两侧车位），每排 10 根双枪 160 kW 直流桩，B01–B30，南北各一车位（60 个）
- 超充区：4 根液冷超充终端 A01–A04（顶部光环）+ 功率柜，场地中部
- 能源区（东北）：6 台储能柜（合计 2 MWh）、2 台箱变、6 台配电 / 逆变柜，发光围栏
- 服务楼（东）：两层剖切，一层司机之家，二层监控中心（大屏墙、值班台）
- 南侧：入口 / 出口道闸、价格立柱、斑马线；四周人行道、行道树、路灯、灌木

## 对象命名约定（Blender ↔ three.js 接口）

| 对象名 | 用途 |
|---|---|
| `pile_B01`（空对象）/ `_body` / `_screen` / `_status` | 桩；`_status` 为状态灯，代码按状态改色 |
| `bay_B01_N`、`bay_B01_S`、`bay_A01` | 车位描边，代码按枪状态改色；中心与朝向用于摆车 |
| `gate_in_arm`、`gate_out_arm` | 闸杆，车辆进 / 出站时抬杆 |
| `canopy_F1_pv`、`ess_03/04`、`transformer_01`、`pile_A02` | 四个能量节点的锚点 |
| `base_led_top` / `base_led_bottom` | 沙盘边缘灯带（单独加亮） |
| `car_<sedan|suv|lavida|sylphy>`（cars.glb） | 车辆预制，按仿真克隆摆放；车漆材质统一叫 `M_car_paint`，运行时按 `theme.js` 的 `PAINT_COLOR` 换色 |

改名必须同时改 `scene/ChargingScene.js`；桩号与数量必须与 `data/station.js` 一致。

## 外部模型（Sketchfab）

车辆与快充桩机身用 Sketchfab 下载的模型，原文件放在 `models/charging/vendor/<目录>/scene.gltf`（含 license.txt），
由 `scripts/blender/charging/vendor.py` 统一处理：合并部件、删内饰、统一朝向与尺寸、半透明车窗换成自建深色玻璃、
贴图缩到 512、减面（每辆车约 1.4 万面）。页面右下角与 `data/station.js` 的 `MODEL_CREDITS` 列出署名。

| 用途 | 模型 | 作者 | 许可 |
|---|---|---|---|
| 轿车 `sedan` | [Tesla Model 3](https://sketchfab.com/3d-models/tesla-model-3-123c10f376ec4f18b93c73afc382808b) | David_Holiday | CC BY 4.0 |
| SUV `suv` | [Low Poly BMW X6M Competition](https://sketchfab.com/3d-models/low-poly-bmw-x6m-competition-dbc45a151624413aac9a378b570ddd02) | SharkyStudios | CC BY 4.0 |
| 快充桩机身 | [EV Charging Station](https://sketchfab.com/3d-models/ev-charging-station-d89eab4c0ffe440db1d126a050e9a0c9) | np-dev | CC BY 4.0 |
| 轿车 `lavida` | [2020 Volkswagen e-Lavida PHEV](https://sketchfab.com/3d-models/2020-volkswagen-e-lavida-phev-b7e2c4af0c8241f4905c7b81e88e7c5d) | Ddiaz Design | CC BY-NC-SA 4.0 |
| 轿车 `sylphy` | [2018 Nissan Sylphy EV Zero Emission](https://sketchfab.com/3d-models/2018-nissan-sylphy-ev-zero-emission-593973027771487fb2f1f41d2933c688) | Ddiaz Design | CC BY-NC-SA 4.0 |

CC BY-NC-SA 的两款禁止商用：本项目是非商业演示可以用，**转商用前必须从 `layout.py` 的 `_car_prefabs` 和
`sim/simulator.js` 的 `CAR_KINDS` 里去掉 `lavida` / `sylphy`**。`vendor/electric_charging_station`（cedric4296，CC BY）已下载但未使用。

## 页面

- 版式沿用设计稿 v4：左栏能源概览 / 光伏发电 / 储能状态，右栏充电运营 / 实时功率 / 告警信息，
  底部能量流动趋势（24 h）/ 设备状态；顶栏显示当前电价时段
- 光伏板：正交相机下平面反射处处相同，`scene/pvSheen.js` 按世界坐标叠加缓慢漂移的对角反光带，每块板深浅取自 Blender 写入的顶点色（`_panel_shade`）
- 场景：正交相机自动适配到设计稿目标框（`THEME.fit`）；空闲时镜头缓慢左右摆动，人工操作后 15 秒恢复
- 状态联动：车位描边与桩灯颜色、桩顶悬浮图标、车辆从通道滑入 / 滑出、充电线、故障红色波纹、抬杆、地面能量流光
- 点击桩或车位弹出详情浮窗（各枪 SOC、功率、电量、时长，每秒刷新）

## 后续可做

- 车辆沿行车动线完整驶入（现为从通道一侧滑入车位）
- 昼夜切换、一天快进回放（展示储能削峰填谷）
- 静态物体烘焙光照贴图，进一步提升质感

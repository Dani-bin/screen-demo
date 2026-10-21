# 06 素材拆分

> 定稿 `design/final.png` 里所有可见元素分四类。这个项目的中央画面是真实数据实时渲染（不是 AI 图），所以没有需要切图回填的场景底图。

| 类别 | 元素 | 做法 | 代码 |
|---|---|---|---|
| 3D 模型 | 地表（地形 + 影像 + 长势）、侧壁土层、接触阴影 | 程序化（真实高程网格 + 着色器） | `scene/terrain.js` |
| 3D 模型 | 营地、场部、饮水点、中继基站 | 程序化低模，造型参照 `design/closeup-a.png` | `scene/props.js` |
| 3D 模型 | 羊、牛 | 远景点云，拉近换单体低模（实例化） | `scene/animals.js` |
| 3D 模型 | 告警光柱、扩散环、越界光墙、轨迹线 | 程序化 | `scene/RanchScene.js` |
| 地表图层 | 围栏、在牧 / 休牧 / 下一块分区、保护带斜纹、单元编号、剩余天数、土色、热力、基站覆盖 | Canvas 画在地表贴图上（跟着地形起伏） | `scene/overlay.js` |
| 场景标签 | 畜群徽标、饮水点液位环、营地、场部、基站、摄像头、告警标注、指北针、比例尺 | DOM，按三维锚点每帧定位（不烘焙进材质） | `components/SceneLabels.vue` |
| 业务组件 | 指标卡、草畜平衡、长势曲线与矩阵、轮牧甘特、气象、称重、告警、畜群表、视频、存栏、生产作业、饮水点、设备 | Vue + SVG，数据来自仿真器 | `components/`、`components/cards/` |
| 装饰素材 | 磨砂玻璃卡片、品牌图标、长势色带 | CSS | `index.vue` |
| 图片 | 告警近景、视频画面 | Figma AI 概念图（示意），`public/smart-ranch/closeup-a/b.webp` | — |

重组检查：页面截图与定稿逐区比对见 `compare/` 和 `11-review-report.md`。

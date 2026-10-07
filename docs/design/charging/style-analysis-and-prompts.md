# 参考图中央场站：风格拆解与生图提示词

参考图：用户提供的「光储充 EMS 管理系统」大屏截图（带作者水印，仅作风格参考，不直接复用）。
用途：自己用 AI 生图工具生成「智慧充电站」中央场站的概念设计稿，再据此在 Blender 里建模。

---

## 一、中央场站的风格拆解

### 1. 构图与视角

| 项 | 参考图做法 | 我的 v2 设计稿差在哪 |
|---|---|---|
| 视角 | 约 45° 方位、35～40° 俯角的**等轴测**，近似正交，无透视畸变 | 视角接近，但场地太大，物体显得小 |
| 主体形态 | 一块**被"切"出来的悬浮地块**：圆角厚底座，前沿是一段弧形道路转角，底座侧面深色金属 | 底座是规整矩形，缺少"地块切片"的道路与弧形转角 |
| 密度 | 地块不大，设备**塞得很满**：车棚、桩、车、储能、机房、站房、斑马线首尾相接，几乎没有空地 | 大片空沥青，元素稀疏 |
| 尺度感 | 单车约占画面宽 4～5%，能看清车窗、轮毂、桩屏 | 单车不到 2%，细节全丢 |
| 留白 | 地块居中，四角留给浮动数据卡片和连线 | 一致 |

### 2. 渲染质感

- **不是低多边形**，而是中高精度的写实建模，接近 C4D + Octane / UE5 的「数字孪生」渲染风。
- 材质以**深色为主**：地面是深蓝灰沥青，设备是深灰金属和哑光黑，车是深色车漆，带高光反射。
- 有**环境反射与细小高光**：车漆、光伏板、地面都有微弱反光，所以画面有"湿润"的高级感。
- 有**微观细节**：充电线、枪头、桩屏 UI、护栏、隔离柱、路灯、机柜散热格栅、机房里的桌椅和显示器。

### 3. 光影与色彩

| 角色 | 颜色 | 用在哪 |
|---|---|---|
| 底色 | `#070d18`～`#13203a` 深海军蓝 / 炭黑 | 背景、地面、设备主体 |
| 主发光 | 电光青 / 冰蓝 `#1ec8ff`～`#2de2e6` | 底座描边、车道线、建筑墙顶、桩屏、灯带 |
| 能量 / 正常 | 荧光绿 `#39ff5a` | 储能柜（像全息体一样整块发光）、充电中车位描边、桩顶图标 |
| 告警 | 警示红 `#ff2a2a` | 故障车位的同心圆波纹、悬浮三角警示牌 |
| 点缀 | 光伏板深蓝带天光反射、少量暖白路灯 | 车棚顶、路灯 |

- 整体是**暗场布光**：只有弱顶光勾出形体，画面亮度主要来自**自发光物体 + 辉光（bloom）**。
- 发光物体之间形成**明暗节奏**：左边绿色车位、中间红色告警、右上绿色储能、右侧蓝色机房，四个亮区把视线拉满整个地块。
- 底座外缘有**两道光**：顶边一圈青色细线，底部一圈蓝色光晕投在背景上，营造"悬浮"感。

### 4. 关键元素清单（从左到右、从前到后）

1. **左前**：独立式充电机柜 / 价格立柱（高柜体 + 蓝色屏幕）、白色斑马线、发光隔离桩
2. **左中**：光伏车棚（深色钢架 + 蓝色光伏板顶，略倾斜），棚下 2～3 根充电桩，车位描边发**绿光**，桩顶悬浮**圆形图标**
3. **中部**：一辆车停在告警车位，地面**红色同心圆波纹**，上方悬浮**红色三角感叹号**
4. **后排**：沿地块后沿一整条长光伏车棚 / 光伏板阵列
5. **中后**：一组深色机柜（类似服务器 / 配电柜），带蓝色指示灯
6. **右上**：**储能电池柜群**，半透明荧光绿、像全息体，旁边是深色箱式变压器
7. **右侧**：**剖切的监控机房 / 站房**（无屋顶），能看到工位、显示器、大屏墙，墙顶有青色描边
8. **地面**：深色沥青 + 发光蓝色车道线、箭头、弧形路缘灯带

### 5. 浮层（2D，不属于三维场景）

- 四角各一张数据卡：图标 + 名称 + 功率（光伏 / 储能 / 电网 / 充电桩）
- 卡片用**带箭头的青色折线**连到场景里的对应设备，线上有流动感
- 这部分建议**不要让 AI 生成**（AI 写不好中文和数字），留空后由页面代码叠加

---

## 二、推荐流程

```
生图（只生成中央场站，无文字）→ 挑 1 张定稿 → 当作 Blender 建模的概念图
                                         ↘ 抠出来叠到 HTML 面板框架里看整屏效果
```

- **只生成中央场站**，背景纯深蓝黑、四周留白；面板和数字用页面叠加，避免 AI 乱码。
- 想让生成结果和我们的场站布局（超充 4 + 快充 12 + 慢充 8、储能 4 柜、剖切站房）一致，
  用 **图生图 / 结构参考**，底图用 [05-layout-base-for-img2img.png](05-layout-base-for-img2img.png)：
  - 即梦 / 可灵 / 通义万相：上传为「参考图」，选「轮廓 / 结构 / 景深」参考，强度 50%～70%
  - Stable Diffusion / Flux：ControlNet（depth 或 canny）+ 底图，或 img2img 重绘幅度 0.55～0.7
  - Midjourney：把底图作为图像提示放在提示词最前面，`--iw 1～1.5`
  - 不用底图也可以，但数量和布局会随机，建模时要再对齐
- 同一个满意结果，固定种子（seed）微调关键词，比反复重抽更快收敛。

---

## 三、提示词

### A. 中文（即梦 / 可灵 / 通义万相 / 豆包）

```
等轴测 45 度俯视的三维渲染，智慧充电站数字孪生沙盘，主体居中，四周留出大面积深色空白，无任何文字。
场站是从城市里切出来的一块悬浮地块：圆角厚底座，侧面是深色金属，前沿是一段弧形道路转角，
底座顶边有一圈青色霓虹细线，底部有蓝色光晕投在深蓝黑背景上。
地块上元素密集：左侧是深色钢结构光伏车棚，棚顶铺满反光的深蓝色光伏板，
棚下一排白色与深灰色直流快充桩和高挑的液冷超充终端，桩屏发蓝光，
深色电动轿车停在车位上充电，充电线微微发光，车位用荧光绿色描边，每根充电桩上方悬浮圆形闪电图标；
后排沿边缘是一长排光伏车棚；中后部是一组带蓝色指示灯的深色配电机柜；
右上角是四台储能电池柜，整体发出明亮的荧光绿色，像全息影像，旁边是深色箱式变压器；
右侧是一座去掉屋顶的剖切监控室，内部可见工位、显示器和蓝色大屏墙，墙顶有青色发光描边；
左前方有发光的价格立柱、入口道闸、白色斑马线和发光隔离桩；
深色沥青地面上有发光的蓝色车道线和箭头；
中间一个车位地面有红色同心圆告警波纹，车辆上方悬浮红色三角警示图标。
暗调电影感布光，自发光霓虹，强烈辉光，车漆和光伏板有细腻反射，超高细节，写实材质，
C4D + Octane 渲染，UE5，科技感数据大屏风格，正交视角，16:9
```

反向提示词（支持时填写）：

```
文字，字母，数字，水印，logo，UI 界面，卡通，低多边形，扁平色块，白天，天空，人群，透视畸变，鱼眼，模糊，车辆变形，杂乱
```

### B. 英文（Midjourney / Flux / SDXL / GPT 图像）

```
isometric 3D render of a smart EV charging station digital twin, a floating diorama
cut out of a city block, rounded thick dark metallic base with a curved road corner at the front,
thin cyan neon outline along the top edge and a blue under-glow on a dark navy background.
Densely packed: solar carport canopies with dark steel frames and reflective blue photovoltaic
panel roofs, rows of sleek white and graphite DC fast chargers and tall liquid-cooled supercharger
posts with glowing blue screens, dark electric sedans parked and charging with softly glowing cables,
parking bays outlined in neon green, floating circular lightning-bolt status icons above each charger,
a long row of solar panels along the back edge, a cluster of dark electrical cabinets with blue LEDs,
four battery energy storage cabinets glowing bright neon green like holograms next to a dark box
transformer, a roofless cutaway control room showing desks, monitors and a blue video wall,
a glowing price totem, entrance barrier gate, white zebra crossing, glowing bollards,
blue glowing lane markings and arrows on dark asphalt, one parking bay with red concentric alarm
ripple rings and a floating red warning triangle above the car.
Dark cinematic lighting, emissive neon, strong bloom, subtle reflections on car paint and solar panels,
ultra detailed, realistic materials, octane render, unreal engine 5, high-tech dashboard aesthetic,
orthographic isometric view, centered with wide empty dark margins, no text
```

Midjourney 参数：`--ar 16:9 --style raw --s 200 --v 7`（用底图时在最前面放图片链接，加 `--iw 1.2`）

Negative（SD / Flux）：

```
text, letters, numbers, watermark, logo, ui, cartoon, low poly, flat shading, daylight, sky,
crowd, fisheye, perspective distortion, blurry, deformed cars, cluttered noise
```

### C. 局部重绘 / 微调用的短语

| 想要的调整 | 追加 / 替换的词 |
|---|---|
| 更"悬浮" | `floating platform, strong under-glow, dark void background` |
| 更亮更有科技感 | `more neon accents, holographic glow, rim light` |
| 更写实 | `photorealistic, physically based materials, global illumination` |
| 减少杂乱 | `clean composition, fewer props, clear readable layout` |
| 储能更醒目 | `energy storage cabinets emitting intense green light, light spill on the ground` |
| 告警更明显 | `pulsing red alarm rings, red light reflected on the car` |

---

## 四、生成后的检查清单

- [ ] 视角是等轴测俯视、无明显透视畸变
- [ ] 底座悬浮感：顶边青色描边 + 底部蓝色光晕
- [ ] 四类发光主色齐全：青（结构）、绿（储能 / 正常）、红（告警）、蓝（屏幕）
- [ ] 场景内无文字、无乱码
- [ ] 四角留白足够放数据卡片
- [ ] 主要设备都能在 Blender 里还原（选定稿时避免 AI 臆造的奇怪结构）

/*
 * 演示中心首页 演示列表
 * ----------------------------------------------------------
 * 首页的全部内容都来自这里。新增演示的步骤：
 *   1. 在 DEMOS 末尾追加一项（末尾即「最新上线」，作品墙视图里占大格）；
 *   2. 在 src/router/index.js 注册该演示的路由；
 *   3. 启动开发服务器后运行 scripts/capture-home-previews.mjs 生成预览图。
 * 页面与组件都不用改。
 *
 * 本文件不能有任何 import：截图脚本在 Node 里直接引用它。
 * 指标取自各演示自身的数据与设计文档，不写示意值。
 */

/**
 * 字段说明：
 * key       唯一标识，也是预览图文件名（public/home/<key>.webp）
 * path      演示路由
 * name / en 中文名 / 英文名
 * subTitle  副标题：演示对象
 * category  行业分类：首页按它生成筛选标签（同名即归为一类）
 * desc      介绍，控制在两三行
 * tags      特性标签，最多 3 个
 * stats     关键指标，固定 3 个：{ value, unit, key }
 * accent    主题色（十六进制）：序号、标签、进度条与右侧背景色块都用它
 * preview   预览图，相对 public/ 的路径，页面会拼上 BASE_URL
 */
export const DEMOS = [
  {
    key: "school",
    path: "/school",
    name: "智慧校园三维导览",
    en: "SMART CAMPUS 3D",
    subTitle: "成都市实验小学西区分校",
    category: "智慧教育",
    desc: "程序化建模还原红砖学院风校园，镜头沿南校门、中轴广场、钟楼、罗马议事厅、运动场自动巡览，可随时拖拽接管、点击建筑查看介绍。",
    tags: ["Three.js 实时三维", "程序化建模", "自动巡览"],
    // 依据：schoolData.js 的 LANDMARKS 共 6 站；占地 30 亩见百科；场景 148m × 130m 见校园设计文档
    stats: [
      { value: "6", unit: "站", key: "导览地标" },
      { value: "30", unit: "亩", key: "校园还原" },
      { value: "148×130", unit: "m", key: "场景尺度" }
    ],
    // 取自校园的清水红砖色
    accent: "#a8432e",
    preview: "home/school.webp"
  },
  {
    key: "city",
    path: "/city",
    name: "城市三维总览",
    en: "CITY 3D OVERVIEW",
    subTitle: "锦绣天府 · 安逸四川",
    category: "智慧城市",
    desc: "基于 OpenStreetMap 真实数据还原成都市中心街区，12 处地标精细建模、到站人流漫步，缤纷插画风自动巡览城市名片。",
    tags: ["OSM 真实街区", "地标精细建模", "人流动画"],
    // 依据：cityData.js 的 SPOTS 共 12 站；建筑数取 public/city/chengdu.json 的 meta.mainCounts.buildings；
    // 范围取 meta.clip 的东西跨度 8835 m、南北跨度 7453 m
    stats: [
      { value: "12", unit: "站", key: "城市地标" },
      { value: "18,750", unit: "栋", key: "真实建筑" },
      { value: "8.8×7.5", unit: "km", key: "街区范围" }
    ],
    // 与城市页界面强调色一致
    accent: "#2f8f96",
    preview: "home/city.webp"
  },
  {
    key: "charging",
    path: "/charging",
    name: "智慧充电站",
    en: "SMART CHARGING STATION",
    subTitle: "光储充一体化超充站 · 数字孪生",
    category: "新能源",
    desc: "Blender 建模还原大型光储充超充站，悬浮沙盘呈现超充、快充、储能与服务楼；仿真驱动车辆进出、充放电与告警，四角能量节点实时联动。",
    tags: ["Blender 建模", "光储充能量流", "运行仿真"],
    // 依据：charging/data/station.js 的 PILES（快充 30 + 超充 4）与 STATION.pvKwp、essKwh
    stats: [
      { value: "34", unit: "根", key: "充电桩" },
      { value: "600", unit: "kWp", key: "光伏装机" },
      { value: "2", unit: "MWh", key: "储能容量" }
    ],
    // 取自大屏的能源蓝
    accent: "#1f7fd6",
    preview: "home/charging.webp"
  },
  {
    key: "building",
    path: "/building",
    name: "高新区数字楼宇",
    en: "DIGITAL BUILDING",
    subTitle: "成都高新区 · 金融城双子塔",
    category: "智慧城市",
    desc: "立体行政区地图呈现成都高新区南区 5 个街道，百米高楼光柱与金融城双子塔联动；园区级按 OSM 真实布局建模、烘焙夜景光照，按城市、园区、楼宇、楼层、房间五级钻取。",
    tags: ["五级钻取", "立体行政区地图", "OSM 真实边界"],
    // 依据：building/data/mapData.js 的 STREETS（南区 5 个街道，面积由边界计算，合计 86.1 km²）与 PARK（双子塔高 218 m）
    stats: [
      { value: "5", unit: "个", key: "南区街道" },
      { value: "86.1", unit: "km²", key: "辖区面积" },
      { value: "218", unit: "m", key: "双子塔高度" }
    ],
    // 取自园区强调色（双子塔金色光柱）
    accent: "#c8902e",
    preview: "home/building.webp"
  },
  {
    key: "energy",
    path: "/energy",
    name: "综合能源补给站",
    en: "INTEGRATED ENERGY STATION",
    subTitle: "油 · 气 · 电 · 换电 · 数字孪生",
    category: "新能源",
    desc: "按甲方设施清单在假定地块上完成规划，开场从卫星航拍「长出」三维场站；加油、LNG 加气、重卡超充、乘用车换电客货分流，仿真驱动车辆进站补能与库存告警。",
    tags: ["规划到三维", "Blender 建模", "补给车流仿真"],
    // 依据：energy/data/station.js 的 PILE_IDS（重卡超充 10 位）、补给类型 KINDS（油 / 气 / 电 / 换电），
    // 用地面积取 energy/data/plan.json 的 siteArea（19,450 m²）
    stats: [
      { value: "4", unit: "类", key: "补给能源" },
      { value: "10", unit: "位", key: "重卡超充" },
      { value: "1.9", unit: "ha", key: "规划用地" }
    ],
    // 取自加油罩棚的橙色灯带
    accent: "#e0782f",
    preview: "home/energy.webp"
  },
  {
    key: "hometown",
    path: "/hometown",
    name: "营山 · 五通村",
    en: "HOMETOWN MEMORY",
    subTitle: "老家记忆 · 四季沙盘之夏",
    category: "乡村文旅",
    desc: "四川营山五通村，按卫星图与老照片还原的盛夏沙盘：开场从卫星图长成三维村庄，沿田埂走一遍回家的路，推门回到老屋前对照老照片，傍晚与夜晚可切换。",
    tags: ["卫星图配准", "老照片还原", "昼夜切换"],
    // 依据：scripts/hometown/build_site.py 输出（沙盘 5.23 公顷、房屋 73 栋，含厂区 16 栋厂棚）
    // 与 data/memories.js 的回家路线长度 ROUTE_LENGTH
    stats: [
      { value: "5.2", unit: "公顷", key: "还原范围" },
      { value: "73", unit: "栋", key: "房屋" },
      { value: "180", unit: "m", key: "回家的路" }
    ],
    // 取自页面的印章红
    accent: "#b8392b",
    preview: "home/hometown.webp"
  },
  {
    key: "hospital",
    path: "/hospital",
    name: "医院院内导航",
    en: "HOSPITAL WAYFINDING",
    subTitle: "门诊医技综合楼 · 三层",
    category: "智慧医疗",
    desc: "三层门诊医技综合楼的院内导航：自选起点和终点，按路网规划跨楼层路线，明确提示走楼梯、电梯还是扶梯，人员沿路线模拟走到诊室，可一键切换只乘电梯的无障碍路线。",
    tags: ["路网寻路", "跨楼层导航", "无障碍路线"],
    // 依据：scripts/hospital/plan.py 每层 20 个导航目的地、共 3 层；
    // 竖向交通 = 东西 2 部楼梯 + 2 台电梯 + 中庭 4 部扶梯（plan.py 的 STAIR / ELEV / ESC）
    stats: [
      { value: "60", unit: "个", key: "诊室与检查室" },
      { value: "3", unit: "层", key: "跨楼层导航" },
      { value: "8", unit: "处", key: "楼梯 · 电梯 · 扶梯" }
    ],
    // 取自页面导视牌的深绿
    accent: "#0f5b4c",
    preview: "home/hospital.webp"
  },
  {
    key: "waiting",
    path: "/waiting",
    name: "候诊大厅叫号",
    en: "CLINIC WAITING HALL",
    subTitle: "门诊医技综合楼 · 2F 内科候诊区",
    category: "智慧医疗",
    desc: "把候诊区搬进三维：8 间诊室上方的三色状态柱一眼看出待诊、复诊、过诊各有多少人，自动轮播每间诊室的名单和就诊时长；新叫号时镜头飞到被叫诊室、诊室亮起橙色光柱，可开语音播报。",
    tags: ["三维叫号", "诊室轮播", "复诊插队"],
    // 依据：data/rooms.js 8 间诊室；状态分待诊 / 复诊 / 过诊三类；
    // data/plan.json（scripts/waiting/build_plan.py 按 CAD 截出）连排椅共 165 座
    stats: [
      { value: "8", unit: "间", key: "内科诊室" },
      { value: "3", unit: "类", key: "待诊 · 复诊 · 过诊" },
      { value: "165", unit: "座", key: "候诊座位" }
    ],
    // 取自页面的主题紫
    accent: "#6c5ce7",
    preview: "home/waiting.webp"
  },
  {
    key: "smart-mine",
    path: "/smart-mine",
    name: "智能矿山综合管控",
    en: "SMART COAL MINE",
    subTitle: "West Elk 煤矿 · 美国科罗拉多州",
    category: "智慧矿山",
    desc: "用 USGS 激光雷达高程与 NAIP 航拍直接生成真实地形沙盘；地表一键透视，露出井下长壁工作面、巷道风流与瓦斯抽采钻孔，还能沿在采工作面剖切看地层，工业广场近景看到 0.5 m 影像。",
    tags: ["真实地形 + 航拍", "井下透视 / 剖切", "通风瓦斯监测"],
    // 依据：smart-mine/data/layout.json 的 overview.size（12 000 × 10 000 m）与 wells（影像识别出的工作面上方钻场 85 处）；
    // 高程为 USGS 3DEP 1 m 激光雷达 DEM（scripts/smart-mine/fetch_data.py）
    stats: [
      { value: "12×10", unit: "km", key: "真实地形" },
      { value: "1", unit: "m", key: "激光雷达高程" },
      { value: "85", unit: "处", key: "抽采钻场" }
    ],
    // 取自沙盘山林的苔绿
    accent: "#5f8f3e",
    preview: "home/smart-mine.webp"
  },
  {
    key: "smart-ranch",
    path: "/smart-ranch",
    name: "智慧牧场 · 草畜平衡",
    en: "SMART GRAZING RANCH",
    subTitle: "呼伦贝尔 · 莫日格勒河示范牧场",
    category: "智慧农牧",
    desc: "用 Copernicus 地形和 Sentinel-2 卫星影像还原莫日格勒河谷，草场长势是真实的逐月 NDVI；10 个轮牧单元、40 块分区按河谷排开，项圈定位的羊群牛群在沙盘上实时走动，越界、离群、饮水点告警自动飞到现场。",
    tags: ["真实地形 + 卫星 NDVI", "划区轮牧", "畜群定位告警"],
    // 依据：smart-ranch/data/layout.json 的 sandbox.size（12 000 × 8 000 m）与 paddocks（40 块）；
    // 存栏 = sim/simulator.js 的 FLOCK_HEADS + HERD_HEADS（羊 5 400 + 牛 380）
    stats: [
      { value: "12×8", unit: "km", key: "真实地形" },
      { value: "40", unit: "块", key: "轮牧分区" },
      { value: "5,780", unit: "头只", key: "项圈牛羊" }
    ],
    // 取自定稿的草原绿
    accent: "#2f8f4e",
    preview: "home/smart-ranch.webp"
  },
  {
    key: "smart-port",
    path: "/smart-port",
    name: "智慧港口 · 数字孪生",
    en: "SMART PORT DIGITAL TWIN",
    subTitle: "上海洋山四期 · 全自动化集装箱码头",
    category: "智慧港口",
    desc: "按公开参数还原洋山四期 2350 m 岸线、61 个箱区，28 台双小车岸桥、121 台轨道吊、145 台 AGV 全息孪生；周泊位计划驱动船舶靠离泊与装卸，作业路光带串起岸桥、AGV 和箱区，故障告警自动飞到现场。",
    tags: ["全息孪生", "岸桥 · AGV · 轨道吊协同", "单船作业跟踪"],
    // 依据：smart-port/data/layout.json 的 cranes（28）、blocks 的 rmg 合计（121）、agvs（145）
    stats: [
      { value: "28", unit: "台", key: "双小车岸桥" },
      { value: "121", unit: "台", key: "自动化轨道吊" },
      { value: "145", unit: "台", key: "AGV" }
    ],
    // 取自定稿的全息青
    accent: "#19e3ff",
    preview: "home/smart-port.webp"
  },
  {
    key: "drone",
    path: "/drone",
    name: "无人机巡检监控平台",
    en: "DRONE INSPECTION CENTER",
    subTitle: "临江化工园区（虚构）· 机场自动巡检",
    category: "低空经济",
    desc: "4 座机场各驻一架无人机，按计划自动巡检储罐、装置与周界；AI 识别气体泄漏、周界入侵等事件，值班员看机载红外实时画面确认、派单、复核，大风自动停飞，可拖动时间轴回放整天。",
    tags: ["机载红外画面", "事件处置闭环", "整天回放"],
    // 依据：drone/data/layout.js 的 DOCKS（4 座，一机一巢）与 SCHEDULE（每天 49 趟）；
    // data/catalog.js 的 EVENT_TYPES 共 11 类 AI 识别事件
    stats: [
      { value: "4", unit: "座", key: "机场 · 一机一巢" },
      { value: "49", unit: "趟", key: "每日计划巡检" },
      { value: "11", unit: "类", key: "AI 识别事件" }
    ],
    // 取自页面的航线青
    accent: "#36e3d8",
    preview: "home/drone.webp"
  },
  {
    key: "smart-conveyor",
    path: "/smart-conveyor",
    name: "主煤流输送机安全预警与集控孪生",
    en: "BELT CONVEYOR PHM TWIN",
    subTitle: "青岚煤矿（虚构）· 工作面到地面原煤仓",
    category: "智慧矿山",
    desc: "井工煤矿主煤流全链剖面沙盘：6 条皮带、3 个煤仓按料流均衡调速运行；光纤测温 / 听诊、X 光、AI 视频提前发现托辊劣化，和集控事后跳闸对照演示；可一键起停集控，下钻到单条皮带和托辊、驱动部。",
    tags: ["全链剖面孪生", "平台预警 vs 集控跳闸", "三级下钻"],
    // 依据：smart-conveyor/data/layout.json 的 belts（6 条，长度合计 9 634 m）与 devices（502 个设备编号）
    stats: [
      { value: "6", unit: "条", key: "主煤流皮带" },
      { value: "9.6", unit: "km", key: "全链长度" },
      { value: "502", unit: "个", key: "设备编号" }
    ],
    // 取自定稿的煤流琥珀
    accent: "#ffb23e",
    preview: "home/smart-conveyor.webp"
  },
  {
    key: "coal-prep",
    path: "/coal-prep",
    name: "地面输送 · 带式输送机安全孪生",
    en: "SURFACE BELT CONVEYOR TWIN",
    subTitle: "青峰煤矿（虚构）· 103 原煤上仓输送机机头",
    category: "智慧矿山",
    desc: "井上栈桥里一台带式输送机的机头特写：双滚筒驱动部的温振、206 组托辊健康、光纤测温沿线热力、纵撕 / X 光 / 跑偏检测和吊轨巡检机器人；第 35 组托辊轴承劣化由平台提前 5.5 天预警，先于超温保护跳闸。",
    tags: [
      "机头驱动部特写",
      "Blender + Cycles 光照烘焙",
      "平台预警 vs 保护跳闸"
    ],
    // 依据：coal-prep/sim/simulator.js 的 FOCUS（248 m、托辊间距 1.2 m → 206 组）、DRIVE（5 个温振测点）
    // 与第 35 组托辊的劣化周期（首次异响到外推跳闸 5.5 天）
    stats: [
      { value: "206", unit: "组", key: "上托辊" },
      { value: "5", unit: "个", key: "驱动部温振测点" },
      { value: "5.5", unit: "天", key: "预警提前量" }
    ],
    // 取自定稿的煤流安全橙
    accent: "#f97316",
    preview: "home/coal-prep.webp"
  }
]

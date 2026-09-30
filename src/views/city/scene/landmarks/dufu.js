/*
 * 杜甫草堂精细模型
 * ----------------------------------------------------------
 * 草堂旧址中轴方位约 31°（正门在西南、工部祠在东北，各殿正立面朝西南 211°），由西南向东北：
 * 照壁 → 正门 → 西溪石桥 → 大廨（通堂敞厅）→ 梅林院（两侧 C 形连廊）→ 诗史堂 → 堂后溪小桥 → 柴门 → 工部祠。
 * 中轴两侧：草堂留后世 / 诗圣著千秋陈列室、水槛、恰受航轩、水竹居；
 * 工部祠东侧：少陵草堂碑亭（六角茅草亭，全园标志，落点）；其东北：茅屋景区（五开间茅屋 + 配房 + 竹篱菜畦 + 茅屋前池）。
 * 花径：诗史堂东北起的 L 形红墙夹道（墙外高竹），尽头是青花碎瓷拼「草堂」二字的影壁；北墙在浣花祠处开门楼。
 * 西北：梅园（梅花湖 + 四层六角砖塔一览亭 + 水榭 + 曲桥）；东侧：草堂寺（南门、展厅、大雅堂、大雄宝殿、藏经阁、
 * 东西厢房，中等精度）与 2005 年重建的八角四重檐万佛楼（楠木林中）。
 * 园内水系 OSM 未画，按导览图示意：西溪（梅花湖南流，贴中轴西侧，在正门与大廨之间横穿中轴）、
 * 堂后溪（自西溪分出，横穿中轴于诗史堂与柴门之间，经柴门与水竹居之间、工部祠与碑亭之间入茅屋前池）。
 *
 * 「中轴坐标系」(u, v)：原点在诗史堂 OSM 轮廓顶点平均点，u 沿中轴指向东北（方位 31°），
 * v 垂直中轴指向东南（方位 121°）；对应 frame(原点, 31°) 的局部 x = v、z = −u（局部 +Z 即朝西南的正立面）。
 * 中轴各殿的 [u0, u1, v0, v1] 为 OSM 轮廓换算到该坐标系的范围（离线常量，2026-09 数据，way id 见注释）；
 * 草堂寺、万佛楼等东区建筑按名称查 OSM 楼（findBuilding），查不到时退回注释里的设计坐标。
 *
 * 尺度：平面按 OSM，殿堂高度 ×1.35、脊饰宝顶 ×1.6；碑亭整体 ×1.8、茅屋景区 ×1.3（绕各自中心），
 * 影壁 ×1.5，花径红墙加高到 3.6 m。万佛楼、一览亭按估计的真实高度（不放大）。
 *
 * 地面分两层（地面批单独一个 Mesh，单面材质，避免大平面自阴影波纹）：
 *   草地 LAWN_Y = 0.85（园界内整片挤出，湖、溪、池处开洞）；中轴石板甬道 PAVE_Y = 1.0，
 *   次级园路比它低 0.03～0.06 m（逐条再错开 7.5 mm），交叉处不共面闪烁；溪、池水面 WATER_Y = 0.45（石砌驳岸）。
 *   步行路径落在铺装顶面；过溪处的桥面比路面高 0.03 m（与路面带不共面）。
 *
 * 替换区：杜甫草堂范围（way 299409723）整片，园内 59 栋 OSM 楼全部隐藏：
 *   30 栋专门建模，其余 26 栋按轮廓改成灰瓦坡顶矮房，三处厕所省略；园外的楼不受影响。
 *   替换区同时挡住城市通用树，园内的竹、梅、罗汉松、楠木、银杏与杂树由本模块自己种。
 *
 * 随机数：按固定种子（mulberry32）或按位置 / 轮廓播种（hashInts / shapeSeed），与数组下标无关。
 */
import {
  BufferAttribute,
  BufferGeometry,
  ExtrudeGeometry,
  FrontSide,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  Path,
  Shape,
  Vector3
} from "three"
import { THEME } from "../theme.js"
import {
  hashInts,
  mulberry32,
  pointInPolygon,
  polygonBounds,
  shapeSeed
} from "../utils.js"
import { ColorBuilder, frame, landmarkMaterial, local } from "./kit/builder.js"
import {
  buildingsInZones,
  centroid,
  distToSegment,
  findBuilding,
  minAreaRect,
  polygonArea,
  rectFrame,
  rectPolygon
} from "./kit/footprint.js"
import {
  box,
  cylinder,
  extrudePolygon,
  fromTriangles,
  polygonVertex,
  prism,
  sphere,
  sweepBar
} from "./kit/shapes.js"
import {
  gableRidge,
  gableRoof,
  gableWalls,
  hipRidges,
  hipRoof,
  pyramidRidges,
  pyramidRoof,
  roofHeight
} from "./kit/roofs.js"
import { addPitchedHouse, clamp, eaveDrop, edgeFrame } from "./kit/parts.js"

const L = THEME.landmark
const DEG = Math.PI / 180

/* ---------------- 尺度与高度 ---------------- */

// 中轴原点：诗史堂 OSM 轮廓（way 486569631）顶点平均点
const AXIS_LL = [104.024582, 30.662602]
// 中轴方位：各殿中心连线 33.1° 与各殿朝向 28.5° 的折中（OSM 描绘误差约 2 m）
const AXIS_BEARING = 31
// 草地顶面、石板铺装顶面（米）
const LAWN_Y = 0.85
const PAVE_Y = 1.0
// 次级园路比主甬道低 LOW，逐条再错开 LOW_STEP：交叉处不共面，步行路径高度容差 0.06 m 以内
const LOW = 0.03
const LOW_STEP = 0.0075
// 小院铺装（工部祠前院、影壁小院）：夹在主甬道与第一档园路之间，与任何园路都不同高
const COURT_Y = PAVE_Y - LOW + LOW_STEP
// 大雅堂前后院铺装
const TEMPLE_COURT_Y = PAVE_Y - LOW - 2 * LOW_STEP
// 城市地面（terrain.js 的 GROUND_Y）：底面挤出从这里起，边缘不悬空
const GROUND_Y = -0.5
// 园内溪、池水面（比草地低 0.4 m，石砌驳岸露出）
const WATER_Y = 0.45
// 插画式放大：殿堂屋顶与台基 ×1.35，脊饰与宝顶 ×1.6
const K_ROOF = 1.35
const K_ORN = 1.6
// 随机种子（与其他景点区分）
const SEED = 20261001
// 门殿明间净高（离铺装面）：高于小人头顶净空 4.35 m
const PASS_H = 4.6
// 站点镜头方位（cityData 该站 cam，从西南偏南看）：花径朝镜头一侧的竹丛压低，两道红墙都露出来
const CAM_BEARING = 195

/* ---------------- 本景点专用色 ---------------- */

const C = {
  lawn: "#80B656", // 园内草地（比城市公园绿略深，衬出灰瓦白墙）
  pave: "#9A9DA0", // 青灰石板（甬道、园路；照片石板偏青灰）
  court: "#B2B1AA", // 院落、广场铺装
  platform: "#A7A49C", // 殿堂台基青石
  redStone: "#B5725C", // 红砂石（碑亭台基、桥栏）
  darkWood: "#3E2C24", // 中轴殿堂黑褐木构
  redBrown: "#7A3428", // 工部祠、恰受航轩红褐柱
  pavilionRed: "#8A3A2E", // 碑亭柱、美人靠
  gateColumn: "#6E2A24", // 正门深红褐柱
  lattice: "#4A3328", // 深色格扇、额枋
  dado: "#5B6470", // 青灰墙裙、砖垛
  thatch: "#8C7A5C", // 茅草
  thatchLight: "#A8946E", // 茅草受光、檐口草层
  thatchDark: "#6E5E44", // 茅草暗部、草束尖
  mud: "#C8B27E", // 黄泥墙
  rubble: "#9A948A", // 毛石台基
  redWall: "#C9644F", // 花径红墙、园区外墙（照片偏砖橘）
  redWallFoot: "#A64A3C", // 红墙墙脚
  capGrey: "#4A4F55", // 红墙墙帽深灰瓦
  screenBody: "#3F454C", // 影壁炭灰墙身
  screenPanel: "#F2EEE6", // 影壁白心
  screenFrame: "#B8432F", // 影壁红框
  blue: "#2F5DA8", // 青花碎瓷
  bronze: "#6E5A3A", // 杜甫铜像
  stele: "#2A2A2E", // 黑石碑
  plaque: "#1F1C1A", // 黑底匾
  figure: "#B9B6AE", // 灰塑宝顶、鸱吻
  wanfoRed: "#9E3A2C", // 万佛楼红漆柱
  fascia: "#C8563A", // 檐口红橙饰线（万佛楼、一览亭）
  towerBrick: "#8E9296", // 一览亭青砖
  southRoof: "#56605E", // 草堂寺南门偏绿灰瓦
  bank: "#8E9296", // 石砌驳岸
  fence: "#D2BE8A", // 竹篱
  veg: ["#6FA83E", "#A6C95A", "#86B84A"], // 菜畦
  bamboo: ["#6FAE4C", "#86C05A", "#3F7F3A", "#5E9E44"], // 竹叶：亮绿、嫩绿、深绿、中绿
  plum: ["#F2A7B8", "#E98FA6", "#F6C3CF", "#7DB35A"], // 梅林：粉、深粉、浅粉、少量绿叶
  forest: ["#4E8F45", "#5E9E4C", "#3F7A3C", "#6BA852"], // 园内杂树
  nanmu: ["#2F6B3A", "#3A7A40", "#2A5E36"], // 楠木林深绿
  ginkgo: "#E8C040", // 银杏秋色
  pine: ["#2F5E3A", "#3A6B40"], // 罗汉松、盆景松
  shedWall: "#D8D6CF", // 唐代遗址保护棚墙
  timber: L.timber
}

/* ---------------- OSM 几何（经纬度，WGS84） ---------------- */

// 杜甫草堂范围 way 299409723（首尾不重复）：替换区、草地外轮廓、园区外墙
const PARK_LL = [
  [104.028959, 30.661134],
  [104.028146, 30.661006],
  [104.026729, 30.660904],
  [104.025625, 30.66081],
  [104.025538, 30.660847],
  [104.025235, 30.661159],
  [104.024799, 30.661558],
  [104.024305, 30.66178],
  [104.02412, 30.661833],
  [104.023607, 30.662106],
  [104.023594, 30.662164],
  [104.024149, 30.662983],
  [104.023868, 30.663145],
  [104.024025, 30.663414],
  [104.023626, 30.663629],
  [104.023735, 30.664221],
  [104.024412, 30.664271],
  [104.024474, 30.664702],
  [104.025222, 30.664733],
  [104.025144, 30.66426],
  [104.025659, 30.664183],
  [104.026192, 30.664225],
  [104.026693, 30.664086],
  [104.027707, 30.663995],
  [104.027669, 30.663589],
  [104.028235, 30.663466],
  [104.028375, 30.66311],
  [104.028336, 30.662957],
  [104.028458, 30.662749],
  [104.028591, 30.662707],
  [104.02866, 30.662562],
  [104.028682, 30.662388],
  [104.028631, 30.662156],
  [104.02862, 30.661927],
  [104.028669, 30.661717],
  [104.02876, 30.66159],
  [104.028898, 30.661426],
  [104.028955, 30.661268]
]
// 园内 OSM 水面（城市水面已画，草地在这里开洞露出来）：梅花湖 way 486544029、
// 正觉湖 way 486541754、东侧小池 way 1283559857（首尾不重复）
const LAKES_LL = [
  [
    [104.024331, 30.663901],
    [104.024476, 30.663938],
    [104.024535, 30.663938],
    [104.024535, 30.663719],
    [104.024443, 30.663744],
    [104.024358, 30.663719],
    [104.024366, 30.663668],
    [104.024202, 30.66373],
    [104.02428, 30.663806]
  ],
  [
    [104.026243, 30.663904],
    [104.02625, 30.663781],
    [104.02627, 30.663708],
    [104.026309, 30.663691],
    [104.026371, 30.663705],
    [104.026395, 30.663681],
    [104.026499, 30.663668],
    [104.026537, 30.663634],
    [104.026735, 30.663604],
    [104.026835, 30.663675],
    [104.026845, 30.663823],
    [104.026628, 30.663865],
    [104.026652, 30.663969],
    [104.026518, 30.664],
    [104.026364, 30.663961],
    [104.026309, 30.663935]
  ],
  [
    [104.028362, 30.662257],
    [104.028413, 30.662282],
    [104.028449, 30.662261],
    [104.028468, 30.662259],
    [104.028571, 30.662285],
    [104.028583, 30.66227],
    [104.028569, 30.662207],
    [104.028563, 30.662132],
    [104.028563, 30.662051],
    [104.028569, 30.661995],
    [104.028565, 30.661973],
    [104.028425, 30.662034],
    [104.028402, 30.662077],
    [104.028372, 30.662201]
  ]
]
// 园区外墙在园界上的分段（PARK_LL 下标，含两端）：西北经北、东到东南，再沿南缘西行到浣花深处以西。
// 缺口：正门前场（下标 8～10 之间）、北门园路（17 → 18 边中段）、东门园路（27 → 28 边中段）、
// 草堂寺南门前广场（2 → 3 边中段），见 buildWalls
const WALL_RUN = { from: 11, to: 8 }

// 园内石板园路（OSM footway，仅铺装，不设人流；中轴区的园路见下方中轴坐标 PATHS_UV）。
// 铺装时在建筑、竹篱院外截断（见 buildFootways）；id 供园墙开口按名引用
const FOOTWAYS = [
  // 东园环路 way 486562584：花径南口外 → 草堂寺前 → 万佛楼西 → 东园 → 正觉湖南 → 盆景园北
  {
    id: "eastLoop",
    ll: [
      [104.025399, 30.661663],
      [104.025707, 30.661569],
      [104.026039, 30.6615],
      [104.026129, 30.661481],
      [104.026382, 30.661498],
      [104.026788, 30.661525],
      [104.027126, 30.661546],
      [104.027476, 30.661599],
      [104.027562, 30.661848],
      [104.027649, 30.661925],
      [104.027831, 30.662264],
      [104.027956, 30.662675],
      [104.028029, 30.662914],
      [104.027938, 30.66321],
      [104.027466, 30.663307],
      [104.026951, 30.66333],
      [104.02684, 30.663342],
      [104.026672, 30.66336],
      [104.026425, 30.663373],
      [104.025875, 30.663404],
      [104.025824, 30.663407],
      [104.0258, 30.663408],
      [104.02569, 30.663387]
    ]
  },
  // way 486574439：大雅堂西侧南北园路
  {
    id: "daya",
    ll: [
      [104.026135, 30.662099],
      [104.026129, 30.661481]
    ]
  },
  // way 486575154
  {
    id: "nanmenW",
    ll: [
      [104.026039, 30.6615],
      [104.026016, 30.661193]
    ]
  },
  // way 358370405 南段：正门前场 → 浣花深处北 → 花径南口外
  {
    id: "southW",
    ll: [
      [104.024102, 30.66198],
      [104.024691, 30.661765],
      [104.025251, 30.661617],
      [104.025399, 30.661663]
    ]
  },
  // way 358370405 北段：盆景园 → 唐代遗址西
  {
    id: "penjingN",
    ll: [
      [104.025757, 30.662795],
      [104.025775, 30.662982],
      [104.025786, 30.663094],
      [104.025778, 30.663232],
      [104.025678, 30.663283],
      [104.0257, 30.663321],
      [104.02569, 30.663387],
      [104.025756, 30.663563],
      [104.025786, 30.663753],
      [104.025792, 30.663919]
    ]
  },
  // way 1374953409：唐代遗址西 → 北门内
  {
    id: "northWest",
    ll: [
      [104.025786, 30.663753],
      [104.025485, 30.664072],
      [104.025159, 30.66415],
      [104.025024, 30.664182]
    ]
  },
  // way 1374953414～16：北门园路（青华路 → 北门 → 园内）
  {
    id: "northGate",
    ll: [
      [104.025012, 30.664867],
      [104.025024, 30.664391],
      [104.025024, 30.664182]
    ]
  },
  // way 486562830：正觉湖北岸
  {
    id: "zhengjue",
    ll: [
      [104.025792, 30.663919],
      [104.0261, 30.663902],
      [104.026113, 30.664003],
      [104.026196, 30.664008],
      [104.026312, 30.66395],
      [104.0265, 30.664022],
      [104.026717, 30.663966],
      [104.026813, 30.663906],
      [104.026894, 30.663814],
      [104.02684, 30.663342]
    ]
  },
  // way 1029995604：东门园路
  {
    id: "eastGate",
    ll: [
      [104.02852, 30.662899],
      [104.028366, 30.662824],
      [104.028252, 30.662769],
      [104.027956, 30.662675]
    ]
  },
  // way 619395931 + 1374953410：北门内 → 草堂研究会 → 茅屋景区北
  {
    id: "northInner",
    ll: [
      [104.025024, 30.664182],
      [104.024856, 30.663598],
      [104.024944, 30.663573],
      [104.02512, 30.663504],
      [104.02569, 30.663387]
    ]
  },
  // way 486564696
  {
    id: "northSpur",
    ll: [
      [104.025139, 30.664082],
      [104.024944, 30.663573]
    ]
  }
]

/* ---------------- 中轴与两侧建筑（中轴坐标 [u0, u1, v0, v1]，米） ---------------- */

const LAYOUT = {
  zhaobi: [-93.6, -90.3, -10.1, 1.2], // 照壁（OSM 名「草堂影壁」way 486544217）
  gate: [-80.4, -72.7, -9.7, 2.7], // 正门（草堂山门 way 486544169）
  daxie: [-36.0, -28.3, -8.1, 8.8], // 大廨 way 486536890
  shishi: [-4.2, 4.2, -9.1, 9.1], // 诗史堂 way 486569631
  hallW: [-16.8, 6.1, -31.2, -21.0], // 草堂留后世 way 486573143
  hallE: [-12.7, 10.3, 26.3, 34.9], // 诗圣著千秋 way 486572606（L 形主体）
  shuikan: [12.3, 20.6, -34.0, -28.1], // 水槛 way 486574317
  chaimen: [26.5, 30.7, -3.5, 5.8], // 柴门 way 486536181
  qiashou: [33.2, 38.5, -24.7, -8.7], // 恰受航轩 way 486536701
  shuizhu: [35.1, 41.6, 11.3, 29.6], // 水竹居 way 486536534
  gongbu: [46.3, 56.0, -8.3, 9.2] // 工部祠 way 486068053
}
// 少陵草堂碑亭中心（way 486538627，OSM 画成圆）
const BEITING_UV = [53.5, 27]

// 中轴建筑的真实高度（米，未放大）：eave 檐口（离铺装面）、roof 屋顶高、plat 台基高
const HEIGHTS = {
  gate: { eave: 4.0, roof: 2.4, plat: 0.45 },
  daxie: { eave: 4.2, roof: 2.8, plat: 0.6 },
  shishi: { eave: 4.8, roof: 3.4, plat: 0.8 },
  side: { eave: 4.0, roof: 2.5, plat: 0.3 },
  chaimen: { eave: 3.6, roof: 2.0, plat: 0.25 },
  gongbu: { eave: 4.8, roof: 3.2, plat: 1.0 },
  xuan: { eave: 3.5, roof: 2.3, plat: 0.4 }
}

// 连廊（两道 C 形，中轴坐标折线的各段：[起点, 终点, 起点外延, 终点外延]，外延 = 伸过拐角半个廊宽）
const GALLERY = { w: 4.0, floor: 0.3, eave: 5.0, roofH: 1.6 }
const GALLERY_SEGS = [
  // 西廊：大廨西端 → 主段 → 诗史堂西端；南北向短廊另接草堂留后世
  [[-32.5, -8.1], [-32.5, -15.4], 0, 1],
  [[-32.5, -15.4], [-0.9, -15.4], 1, 1],
  [[-0.9, -9.1], [-0.9, -21.0], 0, 0],
  // 东廊：大廨东端 → 主段 → 诗史堂东端；短廊另接诗圣著千秋
  [[-31.1, 8.8], [-31.1, 16.5], 0, 1],
  [[-31.1, 16.5], [-1.5, 16.5], 1, 1],
  [[-1.5, 9.1], [-1.5, 26.3], 0, 0]
]

/* ---------------- 水系（中轴坐标） ---------------- */

// 西溪：梅花湖南端 → 沿中轴西侧（v ≈ −40）南流 → 在正门与大廨之间（u = −55）横穿中轴 → 止于正门东侧
const WEST_STREAM = {
  pts: [
    [97.3, -73.2],
    [88, -62],
    [70, -50],
    [45, -42],
    [20, -40],
    [0, -40],
    [-25, -38],
    [-45, -30],
    [-55, -15],
    [-55, 12],
    [-60, 26]
  ],
  w: 5.5
}
// 堂后溪：自西溪分出（留 1.3 m 石板堰）→ 沿 u = 23.5 横穿中轴 → 沿 v ≈ 8 经柴门与水竹居之间
// → 穿过水竹居与工部祠之间 → 工部祠与碑亭之间 → 入茅屋前池
const BACK_STREAM = {
  pts: [
    [24.5, -36.3],
    [23.5, -22],
    [23.5, 5.5],
    [23.9, 8.0],
    [25.6, 9.1],
    [35, 9.0],
    [40.5, 8.8],
    [44, 10.5],
    [48, 14],
    [53, 16.4],
    [60, 18],
    [68, 18],
    [74, 15],
    [79.5, 9],
    [81.4, 4.6]
  ],
  w: 3.4
}
// 茅屋前池（OSM 园路围出的一圈，推定为池）：椭圆中心、沿 u / v 的半轴
const POND = { u: 93.5, v: 1.5, su: 11.5, sv: 5 }

/* ---------------- 园路（中轴坐标；铺装 + 过溪自动架桥） ---------------- */

// id 供步行路径、种植按名引用；w 路宽；low 比 PAVE_Y 低几档（0 为主甬道，见 pathY）；walk 可走带宽
const PATHS_UV = [
  // 中轴南段：正门明间 → 石桥 → 大廨前
  {
    id: "axisS",
    pts: [
      [-80.6, -3.5],
      [-72.5, -3.5],
      [-38.2, 0.2],
      [-35.8, 0.3]
    ],
    w: 3.2,
    low: 0,
    walk: 2.2
  },
  // 梅林甬道：大廨后 → 诗史堂前
  {
    id: "meilin",
    pts: [
      [-28.3, 0.3],
      [-4.2, 0.1]
    ],
    w: 3.0,
    low: 0,
    walk: 2.2
  },
  // 中轴北段：诗史堂后 → 堂后溪小桥 → 柴门明间 → 工部祠前
  {
    id: "axisN",
    pts: [
      [4.2, 1.15],
      [46.3, 1.15]
    ],
    w: 3.2,
    low: 0,
    walk: 2.2
  },
  // 诗史堂后 → 花径西口
  {
    id: "toHuajing",
    pts: [
      [7.5, 1.8],
      [10, 5],
      [15.5, 30.2],
      [18.9, 36.8]
    ],
    w: 2.6,
    low: 1,
    walk: 2
  },
  // 诗史堂后 → 水槛
  {
    id: "toShuikan",
    pts: [
      [9.5, -0.5],
      [9.1, -27.8]
    ],
    w: 2.2,
    low: 2
  },
  // 水槛 → 恰受航轩东
  {
    id: "shuikanE",
    pts: [
      [20.6, -30.8],
      [40.3, -30.2]
    ],
    w: 2.2,
    low: 3
  },
  // 柴门东 → 恰受航轩东 → 梅园
  {
    id: "meiTail",
    pts: [
      [40.2, 1.2],
      [42.5, -10.9],
      [40.3, -30.2],
      [40.3, -36.6],
      [64.4, -34.6]
    ],
    w: 2.4,
    low: 1
  },
  // 柴门东 → 水竹居西 → 碑亭北 → 茅屋前 → 茅屋前池东（与步行路径 W11 同线）
  {
    id: "toMaowu",
    pts: [
      [32.7, 1.5],
      [32.7, 30.8],
      [36, 34],
      [46.5, 34.6],
      [54, 35],
      [62, 36],
      [70, 35.8],
      [78, 34.8],
      [88.3, 30.9],
      [85.1, 11.2],
      [87, 8.2],
      [99, 8.2],
      [105.5, 5.6]
    ],
    w: 2.6,
    low: 2,
    walk: 2
  },
  // 茅屋前池一圈
  {
    id: "pondLoop",
    pts: [
      [72.4, 12.5],
      [80.5, -8],
      [107.9, -7.3],
      [110.7, 4.4],
      [105.5, 5.6]
    ],
    w: 2.4,
    low: 3
  },
  // 茅屋前池 → 碑亭北
  {
    id: "pondNorth",
    pts: [
      [72.4, 12.5],
      [75.1, 24.7],
      [76.3, 34.2]
    ],
    w: 2.4,
    low: 1,
    walk: 2
  },
  // 茅屋北 → 花径北侧（与步行路径 W12 同线）
  {
    id: "toHuajingN",
    pts: [
      [78, 34.8],
      [79.4, 46.3],
      [57, 54.5],
      [40, 60.5]
    ],
    w: 2.6,
    low: 3,
    walk: 2
  },
  {
    id: "maowuE",
    pts: [
      [79.4, 46.3],
      [96, 45.6]
    ],
    w: 2.4,
    low: 1
  },
  // 梅园环路（绕梅花湖、一览亭，闭合；与步行路径 W13 同线）
  {
    id: "meiLoop",
    pts: [
      [64.4, -34.6],
      [59.4, -52.6],
      [55.4, -63],
      [65.5, -71.4],
      [62.6, -86],
      [84, -104.7],
      [104.6, -117.1],
      [130, -104.5],
      [140.5, -87],
      [138.6, -54.7],
      [123.3, -54.9],
      [94.4, -35.1]
    ],
    w: 2.6,
    low: 2,
    walk: 2,
    closed: true
  }
]

/** 按 id 取 PATHS_UV 的一条园路 */
function pathById(id) {
  const p = PATHS_UV.find((q) => q.id === id)
  if (!p) throw new Error(`杜甫草堂：没有 id 为 ${id} 的园路`)
  return p
}

/* ---------------- 花径（世界坐标） ---------------- */

// 夹道中线：东西段（诗圣著千秋东北 → 草堂寺西墙外）+ 南北段（贴草堂寺西墙，南端接影壁小院）
const HUAJING_XZ = [
  [-3897.5, -572.6],
  [-3818.6, -564.3],
  [-3816.8, -525.0]
]
const HUAJING = {
  clear: 3.5, // 两墙内侧净距
  t: 0.45, // 墙厚
  h: 3.6, // 墙高（离铺装面，插画加高；真实约 2.3）
  corner: 5, // 拐角圆弧半径
  capW: 0.8,
  capH: 0.26,
  footH: 0.55, // 深色墙脚高
  bambooOff: 4.7, // 竹丛根部离夹道中线
  bambooStep: 2.3,
  bambooH: [12, 14], // 远离镜头一侧竹高（竿顶向夹道弯）
  bambooNearH: [7.5, 9], // 朝镜头一侧压低
  gateBack: 6 // 南北段门楼离拐角终点的距离
}
// 影壁（×1.5）：在南北段南端小院里、面朝北正对夹道；along 为离夹道南端的距离
const SCREEN = { along: 13.2, w: 8.25, h: 5.4, t: 0.9, base: 0.6 }

/* ---------------- 其余建筑的设计坐标（查不到 OSM 楼时用；世界坐标，来自 2026-09 数据） ---------------- */

const FALLBACK = {
  草堂寺山门: { cx: -3763.6, cz: -422.7, w: 42.9, d: 9.3, bearing: 86.9 },
  展厅: { cx: -3767.1, cz: -476.6, w: 26.3, d: 7.5, bearing: 87.2 },
  大雅堂: { cx: -3770.1, cz: -528.3, w: 19.1, d: 16.7, bearing: 85.2 },
  草堂寺大雄宝殿: { cx: -3775, cz: -559.3, w: 26.7, d: 10.8, bearing: 84.6 },
  草堂寺藏经阁: { cx: -3777.2, cz: -594.6, w: 25.2, d: 19.5, bearing: 87.7 },
  西厢房: { cx: -3803.1, cz: -566.5, w: 30.7, d: 18, bearing: 176.1 },
  唐风遗韵: { cx: -3801.5, cz: -535.3, w: 24.1, d: 16.2, bearing: 174.7 },
  万福楼: { cx: -3628.7, cz: -472.6, w: 13.8, d: 13.5, bearing: 69.4 },
  唐代遗址: { cx: -3817.2, cz: -735.8, w: 40.9, d: 25.3, bearing: 95.1 },
  藏书楼: { cx: -3858.6, cz: -712, w: 24.5, d: 14.3, bearing: 117 },
  浣花祠: { cx: -3839.4, cz: -578.2, w: 19, d: 12.3, bearing: 116.6 },
  草堂北邻: { cx: -3840.7, cz: -657.3, w: 11.6, d: 5.5, bearing: 104 },
  草堂南邻: { cx: -3858.8, cz: -576.5, w: 8.9, d: 4.4, bearing: 11.8 },
  茅屋故居: { cx: -3869.4, cz: -646.6, w: 14.1, d: 6.4, bearing: 111.7 },
  水榭: { cx: -3944.3, cz: -730.2, w: 15.3, d: 6.2, bearing: 99.8 },
  一览亭: { cx: -3994.5, cz: -692.1, w: 12.9, d: 12.8, bearing: 70.7 }
}
// 专门建模的楼（名称）：园内其余楼改灰瓦坡顶矮房
const SPECIAL_NAMES = new Set([
  "草堂影壁",
  "草堂山门",
  "大廨",
  "连廊",
  "草堂留后世",
  "诗圣著千秋",
  "诗史堂",
  "水槛",
  "柴门",
  "恰受航轩",
  "水竹居",
  "工部祠",
  "少陵草堂碑亭",
  ...Object.keys(FALLBACK)
])
// 三处厕所（无名 OSM 楼，way 486537062 / 486543712 / 486574942 的中心）：省略不建
const TOILETS = [
  [-3886.9, -557.6],
  [-4001.2, -737.7],
  [-3801.7, -415.9]
]

/* ---------------- 占用栅格标记 ---------------- */

const F_SOLID = 1 // 建筑、墙
const F_PAVE = 2 // 铺装
const F_WATER = 4 // 湖、溪、池
const F_TREE = 8 // 已种树 / 竹
const F_WALK = 16 // 步行路径可走带（外扩）：树冠、竹丛不进
const F_PARK = 32 // 园界以内
const F_NOTREE = 64 // 不种杂树（花径东西段南侧：让镜头看得见两道红墙）

/* ---------------- 几何小工具 ---------------- */

/** 中轴坐标系（写法同 wuhou.js） */
function makeAxis(ox, oz, bearing) {
  const ab = bearing * DEG
  const s = Math.sin(ab)
  const c = Math.cos(ab)
  return {
    bearing,
    frame: frame(ox, 0, oz, bearing),
    toWorld: (u, v) => [ox + u * s + v * c, oz - u * c + v * s],
    toAxis: (x, z) => [(x - ox) * s - (z - oz) * c, (x - ox) * c + (z - oz) * s]
  }
}

/** 中轴矩形 [u0, u1, v0, v1] → { cu, cv, lu, lv } */
function rectInfo(r) {
  return {
    cu: (r[0] + r[1]) / 2,
    cv: (r[2] + r[3]) / 2,
    lu: r[1] - r[0],
    lv: r[3] - r[2]
  }
}

/** 折线长度（closed 时含末点回到首点的一段） */
function polyLength(pts, closed = false) {
  let s = 0
  const n = closed ? pts.length : pts.length - 1
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    s += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  return s
}

/** Chaikin 割角平滑（开放折线，保留两端点） */
function chaikin(pts, iterations) {
  let p = pts
  for (let k = 0; k < iterations; k++) {
    const out = [p[0]]
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i]
      const [bx, bz] = p[i + 1]
      out.push([0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz])
      out.push([0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz])
    }
    out.push(p[p.length - 1])
    p = out
  }
  return p
}

/** 按弧长等距重采样开放折线（步长约 step，保留两端点） */
function resample(pts, step) {
  const total = polyLength(pts)
  const n = Math.max(1, Math.round(total / step))
  const out = []
  let seg = 0
  let acc = 0
  const segLen = (i) =>
    Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
  for (let k = 0; k <= n; k++) {
    const target = (total * k) / n
    while (seg < pts.length - 2 && acc + segLen(seg) < target) {
      acc += segLen(seg)
      seg++
    }
    const a = pts[seg]
    const b = pts[seg + 1]
    const l = segLen(seg) || 1
    const t = Math.min(1, Math.max(0, (target - acc) / l))
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  return out
}

/** 折线按弧长截取 [s0, s1] 一段（开放折线） */
function slicePolyline(pts, s0, s1) {
  const out = []
  let acc = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    const p = (t) => [
      a[0] + ((b[0] - a[0]) * t) / l,
      a[1] + ((b[1] - a[1]) * t) / l
    ]
    if (acc + l >= s0 && acc <= s1) {
      if (!out.length) out.push(p(Math.max(0, s0 - acc)))
      if (acc + l <= s1) out.push(b)
      else {
        out.push(p(s1 - acc))
        break
      }
    }
    acc += l
  }
  return out
}

/** 折线顶点处换成半径 r 的圆弧（每个拐角 n 段），两端点不变 */
function roundCorners(pts, r, n = 5) {
  const out = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, pz] = pts[i - 1]
    const [cx, cz] = pts[i]
    const [qx, qz] = pts[i + 1]
    const l1 = Math.hypot(cx - px, cz - pz)
    const l2 = Math.hypot(qx - cx, qz - cz)
    const d1 = [(cx - px) / l1, (cz - pz) / l1]
    const d2 = [(qx - cx) / l2, (qz - cz) / l2]
    const turn = Math.acos(clamp(d1[0] * d2[0] + d1[1] * d2[1], -1, 1))
    // 切点离拐点 r·tan(转角 / 2)
    const t = Math.min(r * Math.tan(turn / 2), l1 * 0.45, l2 * 0.45)
    const a = [cx - d1[0] * t, cz - d1[1] * t]
    const b = [cx + d2[0] * t, cz + d2[1] * t]
    // 二次贝塞尔近似圆弧（控制点即拐点）
    for (let k = 0; k <= n; k++) {
      const s = k / n
      const w0 = (1 - s) * (1 - s)
      const w1 = 2 * s * (1 - s)
      const w2 = s * s
      out.push([
        w0 * a[0] + w1 * cx + w2 * b[0],
        w0 * a[1] + w1 * cz + w2 * b[1]
      ])
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

/** 折线逐点法向（相邻段法向平均，左手侧为正：(−dz, dx)） */
function normals(pts) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const l = Math.hypot(dx, dz) || 1
    return [-dz / l, dx / l]
  })
}

/** 折线按斜接整体侧移 d（左手侧为正；折点处沿角平分线移 d / cos(半转角)） */
function offsetMiter(pts, d) {
  const n = pts.length
  const seg = []
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0]
    const dz = pts[i + 1][1] - pts[i][1]
    const l = Math.hypot(dx, dz) || 1
    seg.push([-dz / l, dx / l])
  }
  return pts.map(([x, z], i) => {
    const a = seg[Math.max(0, i - 1)]
    const c = seg[Math.min(n - 2, i)]
    let mx = a[0] + c[0]
    let mz = a[1] + c[1]
    const ml = Math.hypot(mx, mz) || 1
    mx /= ml
    mz /= ml
    const k = 1 / Math.max(0.4, mx * c[0] + mz * c[1])
    return [x + mx * d * k, z + mz * d * k]
  })
}

/** [x, z] 折线 → sweepBar 用的 [x, y, z] */
const lift = (pts, y) => pts.map(([x, z]) => [x, y, z])

/**
 * 带斜接的路面带（同 wuhou.js 的 ribbon）：沿折线铺宽 w、从 y0 到 y1 的实心带
 * （顶面 + 两侧面 + 两端封口），折点处两侧边线按斜接求交。
 */
function ribbon(pts, w, y0, y1, closed = false) {
  const n = pts.length
  const seg = []
  const segs = closed ? n : n - 1
  for (let i = 0; i < segs; i++) {
    const q = pts[(i + 1) % n]
    const dx = q[0] - pts[i][0]
    const dz = q[1] - pts[i][1]
    const l = Math.hypot(dx, dz) || 1
    seg.push([-dz / l, dx / l])
  }
  const side = pts.map((p, i) => {
    // 闭合环：首点的前一段是末段（首尾斜接相连，无封口）
    const a = closed ? seg[(i + n - 1) % n] : seg[Math.max(0, i - 1)]
    const c = closed ? seg[i] : seg[Math.min(n - 2, i)]
    let mx = a[0] + c[0]
    let mz = a[1] + c[1]
    const ml = Math.hypot(mx, mz) || 1
    mx /= ml
    mz /= ml
    const k = Math.min(2.5, 1 / Math.max(0.4, mx * c[0] + mz * c[1]))
    return [mx * (w / 2) * k, mz * (w / 2) * k]
  })
  const L0 = pts.map(([x, z], i) => [x + side[i][0], z + side[i][1]])
  const R0 = pts.map(([x, z], i) => [x - side[i][0], z - side[i][1]])
  const pos = []
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d)
  const v3 = ([x, z], y) => [x, y, z]
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n
    quad(v3(L0[i], y1), v3(L0[j], y1), v3(R0[j], y1), v3(R0[i], y1))
    quad(v3(L0[i], y0), v3(L0[j], y0), v3(L0[j], y1), v3(L0[i], y1))
    quad(v3(R0[i], y1), v3(R0[j], y1), v3(R0[j], y0), v3(R0[i], y0))
  }
  if (closed) return fromTriangles(pos)
  quad(v3(R0[0], y0), v3(L0[0], y0), v3(L0[0], y1), v3(R0[0], y1))
  quad(
    v3(L0[n - 1], y0),
    v3(R0[n - 1], y0),
    v3(R0[n - 1], y1),
    v3(L0[n - 1], y1)
  )
  return fromTriangles(pos)
}

/** 正 sides 边尖锥（无底，顶点汇于一点） */
function cone(sides, r, h) {
  const pos = []
  for (let k = 0; k < sides; k++) {
    const a0 = Math.PI / sides + (k * 2 * Math.PI) / sides
    const a1 = a0 + (2 * Math.PI) / sides
    pos.push(r * Math.sin(a0), 0, r * Math.cos(a0))
    pos.push(r * Math.sin(a1), 0, r * Math.cos(a1))
    pos.push(0, h, 0)
  }
  return fromTriangles(pos)
}

/**
 * 旋转体的一圈环带：半径 r0（高 y0）→ r1（高 y1），n 段；r1 = 0 时退化成锥面（不产生退化三角形）。
 * 碑亭茅草顶由几圈这样的环带叠成。
 */
function ringBand(n, r0, y0, r1, y1) {
  const pos = []
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2
    const a1 = ((k + 1) / n) * Math.PI * 2
    const p = (r, y, a) => [r * Math.sin(a), y, r * Math.cos(a)]
    if (r1 > 1e-6) {
      pos.push(...p(r0, y0, a0), ...p(r0, y0, a1), ...p(r1, y1, a1))
      pos.push(...p(r0, y0, a0), ...p(r1, y1, a1), ...p(r1, y1, a0))
    } else {
      pos.push(...p(r0, y0, a0), ...p(r0, y0, a1), 0, y1, 0)
    }
  }
  return fromTriangles(pos)
}

/** 由平铺三角形坐标数组建几何体（给竹丛批量写顶点用） */
function trianglesGeometry(positions) {
  const g = new BufferGeometry()
  g.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(positions), 3)
  )
  g.computeVertexNormals()
  return g
}

/** 矩阵 m 作用在局部点 (x, 0, z) 上，返回世界 [x, z] */
const _v = new Vector3()
function xzOf(m, x, z) {
  _v.set(x, 0, z).applyMatrix4(m)
  return [_v.x, _v.z]
}

/** 均分：从 −a 到 a 共 n + 1 个点 */
const spread = (a, n) =>
  Array.from({ length: n + 1 }, (_, i) => -a + (2 * a * i) / n)

/* ---------------- 占用栅格（布置树木、竹丛时判断空地；写法同 wuhou.js） ---------------- */

function createGrid(x0, z0, x1, z1, cell = 0.5) {
  const nx = Math.ceil((x1 - x0) / cell)
  const nz = Math.ceil((z1 - z0) / cell)
  const a = new Uint8Array(nx * nz)
  const ix = (x) => Math.floor((x - x0) / cell)
  const iz = (z) => Math.floor((z - z0) / cell)
  const set = (i, k, flag) => {
    if (i >= 0 && i < nx && k >= 0 && k < nz) a[k * nx + i] |= flag
  }
  const grid = {
    get(x, z) {
      const i = ix(x)
      const k = iz(z)
      if (i < 0 || i >= nx || k < 0 || k >= nz) return 0
      return a[k * nx + i]
    },
    /** 多边形（世界坐标）内的格子打标记；pad > 0 时再沿边外扩 */
    fillPoly(poly, flag, pad = 0) {
      let zMin = Infinity
      let zMax = -Infinity
      for (const [, z] of poly) {
        zMin = Math.min(zMin, z)
        zMax = Math.max(zMax, z)
      }
      for (
        let k = Math.max(0, iz(zMin));
        k <= Math.min(nz - 1, iz(zMax));
        k++
      ) {
        const zc = z0 + (k + 0.5) * cell
        const xs = []
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const [xa, za] = poly[j]
          const [xb, zb] = poly[i]
          if (za > zc !== zb > zc)
            xs.push(xa + ((zc - za) * (xb - xa)) / (zb - za))
        }
        xs.sort((p, q) => p - q)
        for (let m = 0; m + 1 < xs.length; m += 2) {
          const i0 = Math.max(0, Math.ceil((xs[m] - x0) / cell - 0.5))
          const i1 = Math.min(nx - 1, Math.floor((xs[m + 1] - x0) / cell - 0.5))
          for (let i = i0; i <= i1; i++) a[k * nx + i] |= flag
        }
      }
      if (pad > 0) {
        for (let i = 0; i < poly.length; i++) {
          grid.stamp(poly[i], poly[(i + 1) % poly.length], pad, flag)
        }
      }
    },
    /** 线段两侧 r 以内的格子打标记 */
    stamp(p, q, r, flag) {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1])
      const n = Math.max(1, Math.ceil(len / (cell * 0.8)))
      const rr = Math.ceil(r / cell)
      for (let s = 0; s <= n; s++) {
        const x = p[0] + ((q[0] - p[0]) * s) / n
        const z = p[1] + ((q[1] - p[1]) * s) / n
        const ci = ix(x)
        const ck = iz(z)
        for (let di = -rr; di <= rr; di++) {
          for (let dk = -rr; dk <= rr; dk++) {
            const xc = x0 + (ci + di + 0.5) * cell
            const zc = z0 + (ck + dk + 0.5) * cell
            if (Math.hypot(xc - x, zc - z) <= r) set(ci + di, ck + dk, flag)
          }
        }
      }
    },
    /** 折线整体盖印（线宽 2r；closed 时含末点回到首点的一段） */
    stampLine(pts, r, flag, closed = false) {
      const n = closed ? pts.length : pts.length - 1
      for (let i = 0; i < n; i++) {
        grid.stamp(pts[i], pts[(i + 1) % pts.length], r, flag)
      }
    },
    /** 圆盘打标记 */
    disk(cx, cz, r, flag) {
      grid.stamp([cx, cz], [cx, cz], r, flag)
    },
    /** 圆盘内（圆心 + 圆周 8 点）是否都不含 mask 中的任何标记 */
    freeDisk(cx, cz, r, mask) {
      if (grid.get(cx, cz) & mask) return false
      for (let k = 0; k < 8; k++) {
        const t = (k / 8) * Math.PI * 2
        if (grid.get(cx + r * Math.cos(t), cz + r * Math.sin(t)) & mask)
          return false
      }
      return true
    }
  }
  return grid
}

/* ---------------- 通用构件 ---------------- */

/** 台基（或任何从草地以下长起的实心块）：底埋进草地以下 0.35 m，顶面在局部 y = h */
function addBase(b, f, w, d, h, color, x = 0, z = 0) {
  b.add(box(w, h + 0.35, d), color, local(f, x, -0.35, z))
}

/**
 * 踏步：在局部 +Z（dir = 1）或 −Z（dir = −1）的台基边（离中心 edge）外，宽 sw、总高 h，
 * 每级高约 0.27、踏面深 0.36。返回最外一级外沿离中心的距离。
 */
function addSteps(b, f, sw, h, edge, dir, color, x = 0) {
  const n = Math.max(2, Math.round(h / 0.27))
  const rise = h / n
  const m = local(f, x, 0, 0, dir > 0 ? 0 : Math.PI)
  for (let k = 1; k < n; k++) {
    b.add(
      box(sw, h - k * rise + 0.35, 0.36),
      color,
      local(m, 0, -0.35, edge + (k - 0.5) * 0.36)
    )
  }
  return edge + (n - 1) * 0.36
}

/** 一组六棱圆柱：xs × zs 网格，底在 y0、高 h */
function addPosts(b, f, xs, zs, y0, h, r, color) {
  for (const x of xs) {
    for (const z of zs) {
      b.add(cylinder(r, r * 0.9, h, { segments: 5 }), color, local(f, x, y0, z))
    }
  }
}

/** 黑底金边匾（金边在后、黑底在前），(x, y, z) 为底边中点 */
function addPlaque(b, f, x, y, z, w, h) {
  b.add(box(w, h, 0.12), L.gold, local(f, x, y, z))
  b.add(
    box(w - 0.24, h - 0.24, 0.12),
    C.plaque,
    local(f, x, y + 0.12, z + 0.06)
  )
}

/**
 * 宝顶（简化版，约 60 个三角形，同 wuhou.js）：6 棱底座 + 球 + 尖锥，底在 m 的 y = 0，总高 h。
 */
function addFinial(b, m, h, color) {
  b.add(prism(6, 0.16 * h, 0.12 * h, 0.18 * h, { top: false }), color, m)
  b.add(sphere(0.19 * h, 6, 4), color, local(m, 0, 0.14 * h, 0))
  b.add(cone(6, 0.08 * h, 0.5 * h), color, local(m, 0, 0.5 * h, 0))
}

/**
 * 悬山顶正脊两端的一对上翘脊头（鳌尖）。m 为屋顶坐标系（檐口 y = 0），
 * w / h / overhang 同 gableRoof；k 为脊饰放大倍数。返回局部最高点 y。
 */
function addRidgeEnds(b, m, w, h, overhang, k = K_ORN, color = L.roofRidge) {
  const x = w / 2 + overhang - 0.15 * k
  for (const sx of [-1, 1]) {
    b.add(box(0.3 * k, 0.55 * k, 0.3 * k), color, local(m, sx * x, h, 0))
    // 脊头向外、向上挑出的一小段，形成上翘的剪影
    b.add(
      box(0.4 * k, 0.16 * k, 0.26 * k),
      color,
      local(m, sx * (x + 0.22 * k), h + 0.45 * k, 0)
    )
  }
  return h + 0.61 * k
}

/**
 * 悬山顶（屋面、山面、正脊一次加好；写法同 wuhou.js）：w × d 为柱网 / 墙体围合，屋脊沿局部 X。
 * f 的 y = 0 为铺装面；eave 为柱顶（离铺装面），roofH 为屋顶高。
 * @returns {{ m, top, ridgeY, y }} 屋顶坐标系、最高点、正脊顶面高度、屋面落位高度
 */
function addGable(b, f, o) {
  const { w, d, eave, roofH, overhang = 1, wall = L.plaster } = o
  const go = {
    overhang,
    segS: 1,
    segT: o.segT ?? 4,
    ridges: false,
    gables: false,
    thick: o.thick
  }
  const y = eave - eaveDrop(d / 2, overhang, roofH, 1.3, o.margin ?? 0.4)
  const m = local(f, 0, y, 0)
  b.add(gableRoof(w, d, roofH, go), o.roof ?? L.roof, m)
  b.add(gableWalls(w, d, roofH, go), wall, m)
  b.add(gableRidge(w, d, roofH, go), o.ridge ?? L.roofRidge, m)
  // 正脊顶面：gableRidge 高 max(0.15, 0.08h) + 0.03h，底在 0.97h
  const ridgeY = y + roofH + Math.max(0.15, 0.08 * roofH)
  let top = ridgeY
  if (o.ends !== false) {
    top = y + addRidgeEnds(b, m, w, roofH, overhang, o.endK ?? K_ORN)
  }
  return { m, top, ridgeY, y }
}

/**
 * 川西悬山殿堂（诗史堂、大廨、工部祠、陈列室、展厅、大雄宝殿等）：
 * 台基 + 前后檐柱 + 白粉墙（前檐让出前廊；明间可前后开敞）+ 正面深色格扇 + 额枋 + 悬山灰瓦顶，
 * 可选山面露明穿斗木架（「封山亮柱」）、檐下黑底匾。
 * f：殿堂坐标系（局部 X 沿面阔、+Z 为正面，y = 0 为铺装面）。
 * @param {object} o { w, d, plat, eave（柱顶，离铺装面）, roofH, bays = 5, overhang = 1.1,
 *   open: "none" | "mid"（明间前后贯通）| "all"（四面开敞，大廨）, porch = 1.4,
 *   steps: "front" | "both" | "none", column, wall, lattice, platColor, roof, timber, plaque: { w, h } }
 * @returns {{ top, ridgeY, y, m }}
 */
function addXiHall(b, f, o) {
  const { w, d, plat, eave, roofH } = o
  const bays = o.bays ?? 5
  const col = o.column ?? C.darkWood
  const wall = o.wall ?? L.plaster
  const lat = o.lattice ?? C.lattice
  const pc = o.platColor ?? C.platform
  addBase(b, f, w, d, plat, pc)
  const sw = o.stepW ?? Math.min(w * 0.28, 4.4)
  const steps = o.steps ?? "front"
  if (steps !== "none") addSteps(b, f, sw, plat, d / 2, 1, pc)
  if (steps === "both") addSteps(b, f, sw, plat, d / 2, -1, pc)
  const cx = w / 2 - 0.5
  const cz = d / 2 - 0.5
  const colH = eave - plat
  addPosts(
    b,
    f,
    spread(cx, bays),
    [cz, -cz],
    plat,
    colH + 0.05,
    o.colR ?? 0.22,
    col
  )
  const open = o.open ?? "none"
  const bayW = (2 * cx) / bays
  if (open !== "all") {
    // 墙体从后檐柱线到前廊后沿；明间开敞时左右各一段
    const porch = o.porch ?? 1.4
    const wd = 2 * cz - porch
    const wz = -porch / 2
    const fz = cz - porch + 0.05 // 墙前皮（格扇贴在这里）
    const spans =
      open === "mid"
        ? [
            [-cx, -bayW / 2],
            [bayW / 2, cx]
          ]
        : [[-cx, cx]]
    for (const [x0, x1] of spans) {
      const xm = (x0 + x1) / 2
      // 墙顶比额枋顶低 3 cm：两者都藏在屋面下，错开后不共面
      b.add(box(x1 - x0, colH - 0.03, wd), wall, local(f, xm, plat, wz))
      // 正面格扇：墙高的 72%
      b.add(
        box((x1 - x0) * 0.92, colH * 0.72, 0.1),
        lat,
        local(f, xm, plat, fz)
      )
    }
    if (open === "mid") {
      // 明间上方的走马板（门洞以上）
      const t0 = Math.min(eave - 0.5, plat + Math.max(3.2, colH * 0.72))
      b.add(box(bayW, eave - t0, 0.3), wall, local(f, 0, t0, wz))
    }
  } else {
    // 四面开敞：两端次间前后檐柱间设美人靠（坐凳栏杆）
    for (const sx of [-1, 1]) {
      const x = sx * (cx - bayW / 2)
      for (const z of [cz, -cz]) {
        b.add(box(bayW - 0.4, 0.9, 0.14), lat, local(f, x, plat, z))
      }
    }
  }
  // 前后檐额枋
  for (const z of [cz, -cz]) {
    b.add(box(2 * cx + 0.3, 0.42, 0.3), lat, local(f, 0, eave - 0.42, z))
  }
  const g = addGable(b, f, {
    w: 2 * cx,
    d: 2 * cz,
    eave,
    roofH,
    overhang: o.overhang ?? 1.1,
    wall,
    roof: o.roof,
    ends: o.ends,
    endK: o.endK
  })
  if (o.timber) {
    // 山面露明穿斗木架：每端三根立柱（顶到屋面下）+ 一道穿枋
    const ez = cz + (o.overhang ?? 1.1)
    for (const sx of [-1, 1]) {
      const x = sx * (cx + 0.04)
      for (const z of [-cz * 0.5, 0, cz * 0.5]) {
        const t = 1 - Math.abs(z) / ez
        const top = g.y + roofHeight(0, t, roofH, 0, 1.3) - 0.1
        b.add(box(0.12, top - plat, 0.2), col, local(f, x, plat, z))
      }
      b.add(
        box(0.1, 0.22, 2 * cz),
        col,
        local(f, x, eave + 0.3 * roofH * 0.6, 0)
      )
    }
  }
  if (o.plaque) {
    const ph = o.plaque.h
    addPlaque(b, f, 0, eave - 0.42 - ph - 0.05, cz + 0.2, o.plaque.w, ph)
  }
  return g
}

/**
 * 门殿（正门、柴门）：明间敞开可穿行（地面即铺装面，门洞净高 ≥ PASS_H），次间坐在矮台基上，
 * 进深中部一道白粉墙（下部青灰墙裙、中间深色窗），两端可加青灰砖垛；悬山灰瓦顶。
 * f：门殿坐标系（+Z 朝外，y = 0 为铺装面）。
 * @param {object} o { w, d, mid（明间面阔）, pier（两端砖垛宽，0 为无）, eave, roofH, plat, column }
 * @returns {{ top, ridgeY, y, m }}
 */
function addGateHall(b, f, o) {
  const { w, d, mid, eave, roofH, plat } = o
  const pier = o.pier ?? 0
  const col = o.column ?? C.darkWood
  const wi = w - 2 * pier
  const side = (wi - mid) / 2
  const cz = d / 2 - 0.5
  // 两端青灰砖垛
  if (pier > 0) {
    for (const sx of [-1, 1]) {
      addBase(b, f, pier, d - 0.4, eave - 0.1, C.dado, sx * (w / 2 - pier / 2))
    }
  }
  for (const sx of [-1, 1]) {
    const x = sx * (mid / 2 + side / 2)
    // 次间台基
    addBase(b, f, side, d, plat, C.platform, x)
    // 进深中部的墙：白粉墙 + 青灰墙裙 + 深色窗
    b.add(
      box(side - 0.3, eave - plat - 0.4, 0.4),
      L.plaster,
      local(f, x, plat, 0)
    )
    b.add(box(side - 0.3, 1.0, 0.5), C.dado, local(f, x, plat, 0))
    b.add(box(side * 0.45, 1.3, 0.5), C.lattice, local(f, x, plat + 1.5, 0))
  }
  // 前后檐柱：明间两柱 + 次间外侧柱
  addPosts(
    b,
    f,
    [-wi / 2 + 0.3, -mid / 2, mid / 2, wi / 2 - 0.3],
    [cz, -cz],
    -0.2,
    eave + 0.2,
    0.24,
    col
  )
  // 明间门洞以上的走马板（净高 PASS_H）
  b.add(box(mid, eave - PASS_H, 0.4), L.plaster, local(f, 0, PASS_H, 0))
  // 前后檐额枋（底边不低于 PASS_H）
  for (const z of [cz, -cz]) {
    b.add(
      box(wi, Math.min(0.45, eave - PASS_H), 0.3),
      C.lattice,
      local(f, 0, eave - Math.min(0.45, eave - PASS_H), z)
    )
  }
  return addGable(b, f, {
    w: wi,
    d: d - 0.6,
    eave,
    roofH,
    overhang: o.overhang ?? 1.0,
    wall: L.plaster,
    ends: o.ends
  })
}

/**
 * 四坡翘角（歇山近似）殿 / 轩：台基 + 周圈檐柱 + 芯体墙（可无，为敞轩）+ 正面格扇 + 坐凳栏杆 + 四坡顶。
 * f 同 addXiHall。
 * @param {object} o { w, d, plat, eave, roofH, overhang, curl, ridge, bays, column, wall, lattice,
 *   core（芯体墙相对柱网的内缩；null 为敞轩）, rail（柱间坐凳栏杆）, steps, segS, segT, roof, ridgeColor }
 * @returns {{ y, top, cx, cz }} 屋面落位高度、正脊顶面高度、柱网半宽 / 半深
 */
function addHipHall(b, f, o) {
  const { w, d, plat, eave, roofH } = o
  const col = o.column ?? C.darkWood
  const pc = o.platColor ?? C.platform
  addBase(b, f, w, d, plat, pc)
  if ((o.steps ?? "front") !== "none") {
    addSteps(b, f, Math.min(w * 0.3, 5), plat, d / 2, 1, pc)
  }
  const cx = w / 2 - (o.inset ?? 0.6)
  const cz = d / 2 - (o.inset ?? 0.6)
  const colH = eave - plat
  const bays = o.bays ?? Math.max(1, Math.round((2 * cx) / 3.6))
  const nz = Math.max(1, Math.round((2 * cz) / 3.6))
  addPosts(
    b,
    f,
    spread(cx, bays),
    [cz, -cz],
    plat,
    colH + 0.05,
    o.colR ?? 0.22,
    col
  )
  addPosts(
    b,
    f,
    [cx, -cx],
    spread(cz, nz).slice(1, -1),
    plat,
    colH + 0.05,
    o.colR ?? 0.22,
    col
  )
  if (o.core != null) {
    const ww = 2 * (cx - o.core)
    const wd = 2 * (cz - o.core)
    b.add(box(ww, colH, wd), o.wall ?? C.lattice, local(f, 0, plat, 0))
    b.add(
      box(ww * 0.9, colH * 0.7, 0.1),
      o.lattice ?? C.lattice,
      local(f, 0, plat, wd / 2 + 0.05)
    )
  }
  if (o.rail) {
    // 柱间坐凳栏杆（正面明间留口）
    const lat = o.lattice ?? C.lattice
    for (const z of [cz, -cz]) {
      for (const sx of [-1, 1]) {
        const x0 = z > 0 ? (2 * cx) / bays / 2 : 0
        const len = cx - x0
        b.add(box(len, 0.75, 0.12), lat, local(f, sx * (x0 + len / 2), plat, z))
      }
    }
    for (const x of [cx, -cx]) {
      b.add(box(0.12, 0.75, 2 * cz), lat, local(f, x, plat, 0))
    }
  }
  // 额枋一圈
  for (const z of [cz, -cz]) {
    b.add(box(2 * cx + 0.3, 0.4, 0.28), col, local(f, 0, eave - 0.4, z))
  }
  for (const x of [cx, -cx]) {
    b.add(box(0.28, 0.4, 2 * cz), col, local(f, x, eave - 0.4, 0))
  }
  const ro = {
    overhang: o.overhang ?? 1.1,
    curl: o.curl ?? 0.4,
    ridge: o.ridge ?? 0.55,
    segS: o.segS ?? 4,
    segT: o.segT ?? 3,
    ridges: false
  }
  const y = eave - eaveDrop(cz, ro.overhang, roofH, 1.5, 0.4)
  const m = local(f, 0, y, 0)
  b.add(hipRoof(2 * cx, 2 * cz, roofH, ro), o.roof ?? L.roof, m)
  b.add(hipRidges(2 * cx, 2 * cz, roofH, ro), o.ridgeColor ?? L.roofRidge, m)
  // hipRidges 正脊顶面在 1.08h
  return { y, top: y + 1.08 * roofH, cx, cz, m }
}

/**
 * 茅草悬山屋（茅屋、配房、南邻 / 北邻）：毛石台基 + 黄泥墙（深色穿斗木框分格、木格窗）+ 厚茅草顶
 * （檐口草层厚 thick）+ 压脊草卷与一排草把。f 为真实尺寸坐标系（可含整体放大），
 * 局部 X 沿面阔、+Z 为正面，y = 0 为地面。
 * @param {object} o { w, d, plinth = 0.4, eave, roofH, overhang = 0.9, thick = 0.35, porch = 0 }
 * @returns {number} 局部最高点
 */
function addThatchHouse(b, f, o) {
  const { w, d, eave, roofH } = o
  const plinth = o.plinth ?? 0.4
  const ov = o.overhang ?? 0.9
  const porch = o.porch ?? 0
  addBase(b, f, w, d, plinth, C.rubble)
  const ww = w - 0.3
  const wd = d - 0.3 - porch
  const wz = -porch / 2
  const wallH = eave - plinth
  b.add(box(ww, wallH, wd), C.mud, local(f, 0, plinth, wz))
  // 穿斗木框：正面每 ~2.6 m 一根立柱 + 中腰一道枋
  const fz = wz + wd / 2 + 0.04
  const nPost = Math.max(2, Math.round(ww / 2.6))
  for (const x of spread(ww / 2 - 0.1, nPost)) {
    // 木框立柱比墙顶低 2 cm：与墙顶不共面
    b.add(box(0.16, wallH - 0.02, 0.08), C.darkWood, local(f, x, plinth, fz))
  }
  b.add(box(ww, 0.14, 0.08), C.darkWood, local(f, 0, plinth + wallH * 0.55, fz))
  // 木格窗两扇
  for (const sx of [-1, 1]) {
    b.add(
      box(Math.min(1.4, ww * 0.16), 0.9, 0.1),
      C.lattice,
      local(f, sx * ww * 0.22, plinth + 1.0, fz + 0.02)
    )
  }
  // 前廊木柱
  if (porch > 0) {
    addPosts(
      b,
      f,
      spread(w / 2 - 0.3, nPost),
      [d / 2 - 0.25],
      plinth,
      wallH,
      0.12,
      C.darkWood
    )
  }
  // 厚茅草顶：封檐板即草层厚度
  const go = {
    overhang: ov,
    segS: 1,
    segT: 3,
    ridges: false,
    gables: false,
    thick: o.thick ?? 0.35
  }
  const y = eave - eaveDrop(d / 2, ov, roofH, 1.3, 0.2)
  const m = local(f, 0, y, 0)
  b.add(gableRoof(w, d, roofH, go), C.thatch, m)
  b.add(gableWalls(w, d, roofH, go), C.mud, m)
  // 压脊草卷 + 草把（每 ~2 m 一个）
  b.add(box(w + 2 * ov, 0.32, 0.7), C.thatchDark, local(m, 0, roofH - 0.12, 0))
  const nb = Math.max(2, Math.round(w / 2))
  for (const x of spread(w / 2 + ov * 0.6, nb)) {
    b.add(
      cylinder(0.2, 0.14, 0.45, { segments: 5, caps: true }),
      C.thatchLight,
      local(m, x, roofH + 0.1, 0)
    )
  }
  return y + roofH + 0.55
}

/** 低多边形树：四棱树干 + 二十面体树冠（竖向拉长 sy 倍），y 为树根高度；返回树顶高度 */
const CROWN = new IcosahedronGeometry(1, 0)
function addTreeLite(b, x, y, z, o) {
  const { r, sy = 1.15, trunkH, color, yaw = 0 } = o
  b.add(
    prism(3, 0.14 * r, 0.1 * r, trunkH + 0.5 * r, { top: false }),
    o.trunk ?? THEME.tree.trunk,
    local(null, x, y, z, yaw)
  )
  const cy = y + trunkH + 0.85 * sy * r
  b.add(CROWN, color, local(null, x, cy, z, yaw, r, sy * r, r))
  return cy + sy * r
}

/** 细高尖塔形树冠（楠木林）：三棱树干 + 五棱台 + 五棱锥，y 为树根；返回树顶高度 */
function addSpireTree(b, x, y, z, o) {
  const { r, h, trunkH, color, yaw = 0 } = o
  b.add(
    prism(3, 0.14 * r, 0.1 * r, trunkH + 0.3 * h, { top: false }),
    THEME.tree.trunk,
    local(null, x, y, z, yaw)
  )
  b.add(
    prism(5, 0.55 * r, r, 0.35 * h, { top: false }),
    color,
    local(null, x, y + trunkH, z, yaw)
  )
  b.add(
    cone(5, r, 0.65 * h),
    color,
    local(null, x, y + trunkH + 0.35 * h, z, yaw)
  )
  return y + trunkH + h
}

/**
 * 层叠松（诗史堂前罗汉松、工部祠前盆景松）：细干 + 3 层压扁的深绿圆盘冠，y 为树根。
 */
function addLayeredPine(b, x, y, z, h, r, color, yaw) {
  b.add(
    prism(5, 0.1 * h, 0.06 * h, h * 0.9, { top: false }),
    C.darkWood,
    local(null, x, y, z, yaw)
  )
  const layers = [
    [0.38, 1.0],
    [0.62, 0.78],
    [0.84, 0.52]
  ]
  for (const [t, s] of layers) {
    b.add(
      sphere(1, 6, 3),
      color,
      local(
        null,
        x,
        y + h * t - 0.35 * r * s,
        z,
        yaw,
        r * s,
        0.35 * r * s,
        r * s
      )
    )
  }
}

/* ---------------- 竹丛（批量写顶点，同 wangjiang.js） ---------------- */

// 竹梢叶团的单位三角形（半径 1、高 1）四棱双锥：顶尖 (0, 1, 0)，最宽一圈在 62% 高，
// 下尖细长到 0.3 m 处（像一束竹竿）
const SPINDLE = (() => {
  const n = 4
  const ring = Array.from({ length: n + 1 }, (_, k) => {
    const a = (k / n) * Math.PI * 2
    return [Math.sin(a), Math.cos(a)]
  })
  const tris = []
  for (let k = 0; k < n; k++) {
    const [s0, c0] = ring[k]
    const [s1, c1] = ring[k + 1]
    tris.push([0, 1, 0, 0], [s0, 0.62, c0, 1], [s1, 0.62, c1, 1])
    tris.push([0, 0, 0, 0], [s1, 0.62, c1, 1], [s0, 0.62, c0, 1])
  }
  return tris
})()

/**
 * 一簇竹：n 束竹梢叶团，簇心 (x, y, z)。lean 给出时（{ dx, dz, deg }）各束朝该方向倾斜
 * （花径两侧竿顶向夹道弯，形成拱廊感），否则从簇心向外微倾。顶点直接写进 bufs[颜色下标]。
 */
function addBamboo(bufs, x, y, z, rand, h, n, lean) {
  const m = new Matrix4()
  const rx = new Matrix4()
  const ry = new Matrix4()
  const v = new Vector3()
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2
    const off = 0.3 + rand() * 0.9
    const hh = h * (0.82 + rand() * 0.26)
    const r = hh * (0.08 + rand() * 0.03)
    const out = bufs[Math.floor(rand() * bufs.length)]
    let dir = a
    let tilt = (4 + rand() * 8) * DEG
    if (lean) {
      dir = Math.atan2(lean.dx, lean.dz) + (rand() - 0.5) * 0.7
      tilt = lean.deg * (0.75 + rand() * 0.45) * DEG
    }
    ry.makeRotationY(dir)
    rx.makeRotationX(tilt)
    m.makeTranslation(x + Math.sin(a) * off, y, z + Math.cos(a) * off)
      .multiply(ry)
      .multiply(rx)
    for (const [ux, uy, uz, wide] of SPINDLE) {
      const yy = uy === 0 ? 0.3 : uy * hh
      const k = wide ? r : 0
      v.set(ux * k, yy, uz * k).applyMatrix4(m)
      out.push(v.x, v.y, v.z)
    }
  }
}

/* ---------------- 场地 ---------------- */

/**
 * 场地公共状态：两个合批器、中轴坐标系、园界与替换区、占用栅格与登记小工具。
 */
function createSite(ctx) {
  const { project, buildings } = ctx
  const ll = (list) => list.map(([lon, lat]) => project.toLocal(lon, lat))
  const b = new ColorBuilder() // 主体
  const gb = new ColorBuilder() // 地面批（单面材质）
  const [ox, oz] = project.toLocal(AXIS_LL[0], AXIS_LL[1])
  const axis = makeAxis(ox, oz, AXIS_BEARING)
  const W = axis.toWorld
  const A = axis.frame
  // 中轴坐标下的构件坐标系：(u, v) 处、高 y、朝向 yaw（0 = 正面朝西南，π/2 朝东南 +v，−π/2 朝西北 −v，π 朝东北）
  const at = (u, v, y = PAVE_Y, yaw = 0) => local(A, v, y, -u, yaw)
  const U = (list) => list.map(([u, v]) => W(u, v))
  const rectW = ([u0, u1, v0, v1]) => [
    W(u0, v0),
    W(u0, v1),
    W(u1, v1),
    W(u1, v0)
  ]

  const park = ll(PARK_LL)
  const zones = [park]
  const replaced = buildingsInZones(buildings, zones)

  const pb = polygonBounds(park)
  const grid = createGrid(
    pb.minX - 20,
    pb.minZ - 20,
    pb.maxX + 20,
    pb.maxZ + 20
  )
  grid.fillPoly(park, F_PARK)

  // 已建成构件的世界多边形（调试 / 校验用）
  const solids = []
  const solid = (poly, pad = 0.4) => {
    solids.push(poly)
    grid.fillPoly(poly, F_SOLID, pad)
  }
  // 按名称查 OSM 楼（在设计坐标附近 25 m 内）；查不到时用设计坐标
  const used = new Set()
  const locate = (name) => {
    const fb = FALLBACK[name]
    const i = findBuilding(buildings, name, {
      near: [fb.cx, fb.cz],
      maxDist: 25
    })
    if (i >= 0) {
      used.add(i)
      return { rect: minAreaRect(buildings[i].p), pts: buildings[i].p }
    }
    return {
      rect: fb,
      pts: rectPolygon(fb.cx, fb.cz, fb.w, fb.d, fb.bearing)
    }
  }
  return {
    project,
    buildings,
    ll,
    b,
    gb,
    axis,
    W,
    at,
    U,
    rectW,
    park,
    zones,
    replaced,
    grid,
    solids,
    solid,
    locate,
    used,
    bambooBufs: C.bamboo.map(() => []),
    paths: [], // 已铺的园路 { pts, w, y, walk, closed }
    lakes: LAKES_LL.map(ll),
    streams: [], // 园内溪 { pts, w }
    bridges: [],
    debug: { water: [], walls: [] }
  }
}

/* ---------------- 地面：草地、水系、驳岸、铺装、桥 ---------------- */

/** 溪流中线（世界坐标，平滑重采样）与水面多边形 */
function streamShape(site, def) {
  const pts = resample(chaikin(site.U(def.pts), 2), 3.2)
  const left = offsetMiter(pts, def.w / 2)
  const right = offsetMiter(pts, -def.w / 2)
  return {
    pts,
    w: def.w,
    left,
    right,
    poly: [...left, ...right.slice().reverse()]
  }
}

/** 茅屋前池：略带起伏的椭圆（固定相位的正弦扰动，每次构建一致） */
function pondPoly(site) {
  const n = 22
  const out = []
  for (let k = 0; k < n; k++) {
    const t = (k / n) * Math.PI * 2
    const wob = 1 + 0.06 * Math.sin(3 * t + 0.7) + 0.04 * Math.sin(5 * t + 2.1)
    out.push(
      site.W(
        POND.u + POND.su * wob * Math.cos(t),
        POND.v + POND.sv * wob * Math.sin(t)
      )
    )
  }
  return out
}

/**
 * 沿折线立一道石砌驳岸（水面以下起、高出草地 0.12 m）：只做顶面与朝水一侧的立面
 * （朝草地一侧的立面只露出 0.12 m，省掉，三角形少三分之一）。
 * water = 1 表示水在折线左手侧（法向 (−dz, dx)），−1 在右手侧；closed 为闭合环（湖、池）。
 */
function addBank(b, pts, water, closed = false) {
  const line = closed ? [...pts, pts[0]] : pts
  const ns = normals(line)
  const top = LAWN_Y + 0.12
  const low = WATER_Y - 0.15
  const hw = 0.23
  const pos = []
  const quad = (a, c, d, e) => pos.push(...a, ...c, ...d, ...a, ...d, ...e)
  for (let i = 0; i < line.length - 1; i++) {
    const [x0, z0] = line[i]
    const [x1, z1] = line[i + 1]
    const [n0x, n0z] = ns[i]
    const [n1x, n1z] = ns[i + 1]
    const w0 = [x0 + water * n0x * hw, z0 + water * n0z * hw]
    const w1 = [x1 + water * n1x * hw, z1 + water * n1z * hw]
    const l0 = [x0 - water * n0x * hw, z0 - water * n0z * hw]
    const l1 = [x1 - water * n1x * hw, z1 - water * n1z * hw]
    quad(
      [l0[0], top, l0[1]],
      [l1[0], top, l1[1]],
      [w1[0], top, w1[1]],
      [w0[0], top, w0[1]]
    )
    quad(
      [w0[0], top, w0[1]],
      [w1[0], top, w1[1]],
      [w1[0], low, w1[1]],
      [w0[0], low, w0[1]]
    )
  }
  b.add(fromTriangles(pos), C.bank)
}

/** 闭合多边形的内侧在其折线的哪一手（1 左手、−1 右手）：首条边中点沿左法向探 0.3 m 是否在多边形内 */
function insideSide(poly) {
  const [ax, az] = poly[0]
  const [bx, bz] = poly[1]
  const l = Math.hypot(bx - ax, bz - az) || 1
  const mx = (ax + bx) / 2 + (-(bz - az) / l) * 0.3
  const mz = (az + bz) / 2 + ((bx - ax) / l) * 0.3
  return pointInPolygon(mx, mz, poly) ? 1 : -1
}

/** 两段水面之间的石板堰（盖住草地缺口）：a、b 为两端点（世界坐标），宽 w */
function addSlab(b, a, c, w) {
  const len = Math.hypot(c[0] - a[0], c[1] - a[1])
  const bearing = Math.atan2(c[0] - a[0], -(c[1] - a[1])) / DEG
  const f = frame((a[0] + c[0]) / 2, 0, (a[1] + c[1]) / 2, bearing - 90)
  b.add(
    box(len + 1.2, LAWN_Y + 0.15 - WATER_Y + 0.2, w),
    L.granite,
    local(f, 0, WATER_Y - 0.2, 0)
  )
}

/** 铺一条园路（地面批），登记到 site.paths 并盖印栅格 */
function addPath(site, pts, w, y, opts = {}) {
  const line = opts.closed ? [...pts, pts[0]] : pts
  site.gb.add(
    ribbon(opts.closed ? pts : line, w, LAWN_Y - 0.03, y, opts.closed),
    opts.color ?? C.pave
  )
  site.grid.stampLine(line, w / 2, F_PAVE)
  site.paths.push({
    pts: line,
    w,
    y,
    walk: opts.walk ?? w,
    bridge: opts.bridge !== false
  })
}

/** 两线段 p1-p2 与 q1-q2 的交点参数（不相交返回 null） */
function segCross(p1, p2, q1, q2) {
  const rx = p2[0] - p1[0]
  const rz = p2[1] - p1[1]
  const sx = q2[0] - q1[0]
  const sz = q2[1] - q1[1]
  const den = rx * sz - rz * sx
  if (Math.abs(den) < 1e-9) return null
  const qpx = q1[0] - p1[0]
  const qpz = q1[1] - p1[1]
  const t = (qpx * sz - qpz * sx) / den
  const u = (qpx * rz - qpz * rx) / den
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { t, sinA: Math.abs(den) / (Math.hypot(rx, rz) * Math.hypot(sx, sz)) }
}

/**
 * 园路过溪处自动架石板桥：桥沿园路方向，长 = 溪宽 / sin(夹角) + 2.6，宽取「路宽 + 0.8」与
 * 「可走带 + 1.9」较大者（两侧红砂石矮栏离可走带边缘 ≥ 0.6 m）；桥面比路面高 0.03 m。
 */
function buildBridges(site) {
  const { b, grid } = site
  for (const path of site.paths) {
    if (!path.bridge) continue
    for (let i = 0; i < path.pts.length - 1; i++) {
      const p1 = path.pts[i]
      const p2 = path.pts[i + 1]
      for (const st of site.streams) {
        for (let j = 0; j < st.pts.length - 1; j++) {
          const hit = segCross(p1, p2, st.pts[j], st.pts[j + 1])
          if (!hit) continue
          const x = p1[0] + (p2[0] - p1[0]) * hit.t
          const z = p1[1] + (p2[1] - p1[1]) * hit.t
          const len = st.w / Math.max(0.35, hit.sinA) + 2.6
          const w = Math.max(path.w + 0.8, path.walk + 1.9)
          const bearing = Math.atan2(p2[0] - p1[0], -(p2[1] - p1[1])) / DEG
          // 局部 X 沿园路：frame 的局部 +X 指向 bearing + 90，故传 bearing − 90
          const f = frame(x, 0, z, bearing - 90)
          const top = path.y + 0.03
          b.add(
            box(len, top - (WATER_Y - 0.25), w),
            C.redStone,
            local(f, 0, WATER_Y - 0.25, 0)
          )
          // 桥身两侧拱券暗影（示意拱桥）
          for (const sz of [-1, 1]) {
            b.add(
              box(st.w * 0.7, 0.35, 0.05),
              "#6B4A3E",
              local(f, 0, WATER_Y + 0.05, sz * (w / 2 + 0.02))
            )
            b.add(
              box(len, 0.7, 0.2),
              C.redStone,
              local(f, 0, top, sz * (w / 2 - 0.1))
            )
            for (const sx of [-1, 1]) {
              b.add(
                box(0.34, 0.95, 0.34),
                C.redStone,
                local(f, sx * (len / 2 - 0.17), top, sz * (w / 2 - 0.1))
              )
            }
          }
          const poly = [
            xzOf(f, -len / 2, -w / 2),
            xzOf(f, len / 2, -w / 2),
            xzOf(f, len / 2, w / 2),
            xzOf(f, -len / 2, w / 2)
          ]
          grid.fillPoly(poly, F_PAVE)
          site.bridges.push(poly)
        }
      }
    }
  }
}

/** 地面：草地（湖、溪、池开洞）、水面与驳岸、石堰、园路铺装、前场与院落、桥 */
function buildGround(site) {
  const { b, gb, grid, park, U, at, rectW, lakes } = site
  const west = streamShape(site, WEST_STREAM)
  const back = streamShape(site, BACK_STREAM)
  const pond = pondPoly(site)
  site.streams.push(west, back)
  const holes = [...lakes, west.poly, back.poly, pond]
  gb.add(extrudePolygon(park, holes, GROUND_Y, LAWN_Y), C.lawn)
  // 自画的溪、池水面（城市水面色）
  for (const poly of [west.poly, back.poly, pond]) {
    gb.add(extrudePolygon(poly, [], WATER_Y - 0.3, WATER_Y), THEME.water)
  }
  for (const poly of holes) {
    grid.fillPoly(poly, F_WATER, 0.8)
    site.debug.water.push(poly)
  }
  // 驳岸：溪两岸 + 两端封口、池与湖一圈
  // 溪：左岸线的水在右手侧、右岸线的水在左手侧；两端封口
  for (const s of [west, back]) {
    addBank(b, s.left, -1)
    addBank(b, s.right, 1)
    addBank(
      b,
      [s.left[0], s.right[0]],
      insideSide([s.left[0], s.right[0], s.right[1], s.left[1]])
    )
    const n = s.left.length - 1
    addBank(
      b,
      [s.left[n], s.right[n]],
      insideSide([s.left[n], s.right[n], s.right[n - 1], s.left[n - 1]])
    )
  }
  for (const poly of [pond, ...lakes]) addBank(b, poly, insideSide(poly), true)
  // 石板堰：西溪源头与梅花湖之间、堂后溪分水口、堂后溪入池口
  {
    const nearest = (p, poly) => {
      let best = null
      let bd = Infinity
      for (const q of poly) {
        const d = Math.hypot(q[0] - p[0], q[1] - p[1])
        if (d < bd) {
          bd = d
          best = q
        }
      }
      return best
    }
    const w0 = west.pts[0]
    const lake = lakes.length
      ? lakes.reduce((p, q) => {
          const dp = Math.hypot(
            nearest(w0, p)[0] - w0[0],
            nearest(w0, p)[1] - w0[1]
          )
          const dq = Math.hypot(
            nearest(w0, q)[0] - w0[0],
            nearest(w0, q)[1] - w0[1]
          )
          return dq < dp ? q : p
        })
      : null
    if (lake) addSlab(b, w0, nearest(w0, lake), WEST_STREAM.w + 0.6)
    addSlab(b, back.pts[0], nearest(back.pts[0], west.pts), BACK_STREAM.w + 0.6)
    const bl = back.pts[back.pts.length - 1]
    addSlab(b, bl, nearest(bl, pond), BACK_STREAM.w + 0.6)
  }

  /* ---- 铺装：前场、院落、广场 ---- */
  const courtRect = (r, y, color = C.court) => {
    const { cu, cv, lu, lv } = rectInfo(r)
    gb.add(box(lv, y - GROUND_Y, lu), color, at(cu, cv, GROUND_Y))
    grid.fillPoly(rectW(r), F_PAVE)
  }
  // 正门前场（照壁与正门之间，西南接草堂路人行道）
  courtRect([-95.2, -80.6, -24, 14], PAVE_Y)
  // 工部祠前院：高度 COURT_Y 与各档园路都不同，和穿院而过的园路不共面
  courtRect([38.6, 46.2, -9.4, 5.9], COURT_Y)

  /* ---- 中轴区园路 ---- */
  for (const p of PATHS_UV) {
    addPath(site, U(p.pts), p.w, pathY(p), { walk: p.walk, closed: p.closed })
  }
  // 东区、北区的 OSM 园路要等建筑登记进栅格后再铺（见 buildFootways）；
  // 过溪的桥在全部园路铺完后统一架（见 buildBridges）
}

/**
 * 折线按栅格截断：沿线每 step 米取点，圆盘（半径 r）碰到 mask 标记的点不要，
 * 剩下的连续段保留原折点、在断点处补端点。返回若干段折线。
 */
function clipByGrid(pts, grid, mask, r, step = 0.5) {
  const pieces = []
  let cur = null
  let last = null
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const c = pts[i + 1]
    const n = Math.max(
      1,
      Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / step)
    )
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const q = [a[0] + ((c[0] - a[0]) * k) / n, a[1] + ((c[1] - a[1]) * k) / n]
      if (grid.freeDisk(q[0], q[1], r, mask)) {
        if (!cur) {
          cur = [q]
          pieces.push(cur)
        } else if (k === n) cur.push(q) // 原折点
        last = q
      } else if (cur) {
        if (cur[cur.length - 1] !== last) cur.push(last)
        cur = null
      }
    }
  }
  return pieces.filter((pc) => pc.length >= 2 && polyLength(pc) >= 3)
}

/** 东区、北区 OSM 园路：在建筑、竹篱院外截断后铺装（北门、东门园路也在门房外断开） */
function buildFootways(site) {
  FOOTWAYS.forEach((fw, k) => {
    const y = PAVE_Y - LOW - 2 * LOW_STEP - (k % 3) * LOW_STEP
    for (const piece of clipByGrid(site.ll(fw.ll), site.grid, F_SOLID, 1.3)) {
      addPath(site, piece, 2.8, y)
    }
  })
}

/** 按 id 取 FOOTWAYS 的一条园路（经纬度） */
function footwayById(id) {
  const f = FOOTWAYS.find((q) => q.id === id)
  if (!f) throw new Error(`杜甫草堂：没有 id 为 ${id} 的 OSM 园路`)
  return f.ll
}

/** PATHS_UV 一条园路的路面高度 */
function pathY(p) {
  return PAVE_Y - (p.low ? LOW + (p.low - 1) * LOW_STEP : 0)
}

/* ---------------- 中轴建筑 ---------------- */

/** 照壁：一字照壁，青灰边框白粉心、灰瓦墙帽（×1.35），正面朝东北对正门 */
function addZhaobi(b, f, w) {
  const h = 3.5 * K_ROOF
  b.add(box(w + 0.4, 0.55, 1.7), L.granite, local(f, 0, -0.35, 0))
  addBase(b, f, w, 1.2, h, C.dado)
  b.add(box(w - 1.4, h - 1.8, 1.32), L.plaster, local(f, 0, 0.9, 0))
  const go = { overhang: 0.35, segS: 1, segT: 2, ridges: false, gables: false }
  const m = local(f, 0, h - 0.05, 0)
  b.add(gableRoof(w, 1.2, 0.8, go), L.roof, m)
  b.add(gableRidge(w, 1.2, 0.8, go), L.roofRidge, m)
  return h + 0.9
}

/**
 * 碑亭（×1.8）：青砖座 + 红砂石六角台基、两级踏步（朝工部祠）、六根红褐柱、五面美人靠，
 * 亭中拱形碑首黑石碑「少陵草堂」；茅草圆锥顶（厚檐口草层、略鼓的锥面）收成一个高高的草束尖。
 * f 的局部 +Z 为踏步一侧，y = 0 为地面。返回局部最高点（草束尖）。
 */
function addBeiting(b, f) {
  const K = 1.8
  const R = 2.3 * K // 台基外接半径
  const brickH = 0.35 * K
  const stoneH = 0.45 * K
  b.add(
    prism(6, R + 0.3, R + 0.3, brickH + 0.35),
    L.brick,
    local(f, 0, -0.35, 0)
  )
  b.add(prism(6, R, R, stoneH), C.redStone, local(f, 0, brickH, 0))
  const y0 = brickH + stoneH
  // 踏步：边 5 正对 +Z，边心距 R·cos30°
  const ap = R * Math.cos(Math.PI / 6)
  b.add(
    box(3.4, (y0 * 2) / 3 + 0.35, 0.6),
    C.redStone,
    local(f, 0, -0.35, ap + 0.3)
  )
  b.add(box(3.4, y0 / 3 + 0.35, 0.6), C.redStone, local(f, 0, -0.35, ap + 0.9))
  // 茅草檐口草层下沿（柱头收进檐口以内，从檐下仰视不露柱头）
  const yr = 5.15
  // 六根红褐柱（柱圈外接半径 1.8K）与五面美人靠；柱顶只高出檐口下沿 0.35 m，藏在吊顶之上
  const rc = 1.8 * K
  const colH = yr + 0.35 - y0
  for (let k = 0; k < 6; k++) {
    const [x, z] = polygonVertex(6, rc, k)
    b.add(
      cylinder(0.2, 0.18, colH, { segments: 6 }),
      C.pavilionRed,
      local(f, x, y0, z)
    )
  }
  const side = rc // 六边形边长 = 外接半径
  for (let k = 0; k < 6; k++) {
    if (k === 5) continue
    b.add(
      box(side - 0.5, 0.5, 0.5),
      C.pavilionRed,
      edgeFrame(f, 6, rc, k, y0 + 0.3)
    )
    b.add(
      box(side - 0.5, 0.8, 0.12),
      C.pavilionRed,
      local(edgeFrame(f, 6, rc, k, y0 + 0.8), 0, 0, 0.3)
    )
  }
  // 柱顶一圈额枋（藏在茅草檐下）
  for (let k = 0; k < 6; k++) {
    b.add(
      box(side, 0.4, 0.28),
      C.pavilionRed,
      edgeFrame(f, 6, rc, k, y0 + colH - 0.45)
    )
  }
  // 碑：石座 + 黑碑身 + 拱形碑首 + 碑面四个白字块
  b.add(box(2.2, 0.45, 1.0), L.granite, local(f, 0, y0, 0))
  // 碑身高 2.3 m（碑首拱顶约在柱高的 90%，低于亭内吊顶）
  const sh = 2.3
  b.add(box(1.62, sh, 0.45), C.stele, local(f, 0, y0 + 0.45, 0))
  const arch = cylinder(0.81, 0.81, 0.45, { segments: 8, caps: true })
  arch.rotateX(Math.PI / 2)
  arch.translate(0, 0, -0.225)
  b.add(arch, C.stele, local(f, 0, y0 + 0.45 + sh, 0))
  for (let k = 0; k < 4; k++) {
    b.add(
      box(0.42, 0.42, 0.05),
      L.plaster,
      local(f, 0, y0 + 0.75 + k * 0.5, 0.24)
    )
  }
  // 茅草顶（真实：檐口 2.9、檐口外径 5.4、锥顶 6.0、草束尖 7.0；×1.8 后檐径 9.7、锥顶 10.8、尖顶 12.6）
  const n = 12
  const Re = 4.85
  const yt = yr + 0.5 // 檐口草层上沿
  b.add(ringBand(n, Re, yr, Re, yt), C.thatchLight, f)
  b.add(ringBand(n, Re - 0.55, yr + 0.02, Re, yr), C.thatchDark, f) // 檐口草层底面
  // 亭内浅锥形吊顶：封住锥顶内腔，柱头与额枋收在它上面
  b.add(ringBand(n, Re - 0.55, yr + 0.02, 0, yr + 0.4), C.thatchDark, f)
  b.add(ringBand(n, Re, yt, 3.3, 7.75), C.thatchLight, f)
  b.add(ringBand(n, 3.3, 7.75, 1.65, 9.55), C.thatch, f)
  b.add(ringBand(n, 1.65, 9.55, 0.42, 10.75), C.thatch, f)
  // 草束尖：一道收口草箍 + 细长草束
  b.add(ringBand(8, 0.42, 10.75, 0.6, 11.1), C.thatchDark, f)
  b.add(ringBand(8, 0.6, 11.1, 0, 12.6), C.thatchDark, f)
  return 12.6
}

/**
 * 连廊一段：通长石板地坪（高 floor）+ 两侧黑褐柱（柱距约 3 m）+ 低矮木格栏杆 + 额枋
 * + 每两跨一盏竹编灯笼（挂在柱线上）+ 灰瓦两坡顶。f 的局部 X 沿廊长。
 */
function addGallerySeg(b, f, len, toUV, others, lift = 0) {
  const { w, eave } = GALLERY
  const floor = GALLERY.floor + lift
  addBase(b, f, len, w, floor, C.platform)
  const cz = w / 2 - 0.25
  const n = Math.max(1, Math.round((len - 0.5) / 3))
  const xs = spread(len / 2 - 0.25, n)
  // 与其他段相交处（拐角、丁字口）让开：柱、栏杆落在别的段里就不做，行人从廊口穿过
  const inOther = (x, z, pad) =>
    others.some(([u0, u1, v0, v1]) => {
      const [u, v] = toUV(x, z)
      return u > u0 + pad && u < u1 - pad && v > v0 + pad && v < v1 - pad
    })
  for (const z of [cz, -cz]) {
    for (const x of xs) {
      if (inOther(x, z, 0.3)) continue
      b.add(
        cylinder(0.15, 0.135, eave - GALLERY.floor + 0.05, { segments: 5 }),
        C.darkWood,
        local(f, x, floor, z)
      )
    }
    for (let i = 0; i < xs.length - 1; i++) {
      const xm = (xs[i] + xs[i + 1]) / 2
      // 整跨五点采样：任一点进了别的段（外扩 0.3 m）就不做这跨栏杆
      let hit = false
      for (let t = 0; t <= 4; t++) {
        if (inOther(xs[i] + ((xs[i + 1] - xs[i]) * t) / 4, z, -0.3)) hit = true
      }
      if (hit) continue
      b.add(
        box(xs[i + 1] - xs[i] - 0.2, 0.5, 0.1),
        C.darkWood,
        local(f, xm, floor, z)
      )
      // 每两跨一盏竹编灯笼：顶面贴着柱线上的额枋底（不悬空），底边离地坪约 4.1 m
      if (i % 2 === 1) {
        b.add(
          cylinder(0.2, 0.2, 0.5, { segments: 5, caps: true }),
          "#E8B860",
          local(f, xm, GALLERY.floor + eave - 0.35 - 0.5, z)
        )
      }
    }
    b.add(
      box(len, 0.35, 0.22),
      C.darkWood,
      local(f, 0, GALLERY.floor + eave - 0.35, z)
    )
  }
  addGable(b, f, {
    w: len,
    d: w - 0.5,
    eave: GALLERY.floor + eave,
    roofH: GALLERY.roofH,
    overhang: 0.6,
    ends: false,
    segT: 3
  })
}

/**
 * 月洞门墙（连廊接大廨山面处的赭黄墙）：宽 w、高 h、厚 0.35，中间圆洞半径 r。
 * f 的局部 X 沿墙长，y = 0 为地坪。
 */
function addMoonWall(b, f, w, h, r, color) {
  const s = new Shape()
  s.moveTo(-w / 2, 0)
  s.lineTo(w / 2, 0)
  s.lineTo(w / 2, h)
  s.lineTo(-w / 2, h)
  s.lineTo(-w / 2, 0)
  const hole = new Path()
  const cy = r + 0.35
  for (let k = 0; k <= 12; k++) {
    const t = (k / 12) * Math.PI * 2
    const x = r * Math.cos(t)
    const y = cy + r * Math.sin(t)
    if (k === 0) hole.moveTo(x, y)
    else hole.lineTo(x, y)
  }
  s.holes.push(hole)
  const g = new ExtrudeGeometry(s, {
    depth: 0.35,
    bevelEnabled: false,
    curveSegments: 1
  })
  g.translate(0, 0, -0.175)
  b.add(g, color, f)
  // 墙帽
  b.add(box(w + 0.3, 0.2, 0.6), L.roof, local(f, 0, h, 0))
}

/** 镂空塔形灰塑宝顶（工部祠、大雅堂正脊中）：三层收分的六棱台 + 宝珠 + 尖，底在 m 的 y = 0，总高 h */
function addTowerFinial(b, m, h, color, tip) {
  const s = h / 3.5
  b.add(prism(6, 0.6 * s, 0.5 * s, 0.9 * s, { top: false }), color, m)
  b.add(
    prism(6, 0.46 * s, 0.36 * s, 0.9 * s, { top: false }),
    color,
    local(m, 0, 0.9 * s, 0)
  )
  b.add(
    prism(6, 0.32 * s, 0.22 * s, 0.8 * s, { top: false }),
    color,
    local(m, 0, 1.8 * s, 0)
  )
  b.add(sphere(0.3 * s, 6, 4), tip ?? color, local(m, 0, 2.5 * s, 0))
  b.add(cone(6, 0.1 * s, 0.6 * s), tip ?? color, local(m, 0, 2.9 * s, 0))
}

/**
 * 中轴与两侧：照壁、正门、大廨（铜像、月洞门墙）、连廊、诗史堂、陈列室、水槛、柴门、
 * 恰受航轩、水竹居、工部祠（宝顶）、碑亭。
 * @returns {number} 落点高度（碑亭草束尖）
 */
function buildAxis(site) {
  const { b, at, rectW, solid } = site
  const H = HEIGHTS
  // 照壁：正面朝东北（对正门）
  {
    const { cu, cv, lv } = rectInfo(LAYOUT.zhaobi)
    addZhaobi(b, at(cu, cv, PAVE_Y, Math.PI), lv)
    solid(rectW(LAYOUT.zhaobi))
  }
  // 正门：五开间（中三间开敞），两端青灰砖垛，深红褐柱；脊上一排小饰件
  {
    const r = LAYOUT.gate
    const { cu, cv, lu, lv } = rectInfo(r)
    const f = at(cu, cv)
    const eave = Math.max(H.gate.eave * K_ROOF, PASS_H + 0.8)
    const g = addGateHall(b, f, {
      w: lv,
      d: lu,
      mid: 4.4,
      pier: 1.4,
      eave,
      roofH: H.gate.roof * K_ROOF,
      plat: H.gate.plat * K_ROOF,
      column: C.gateColumn
    })
    const wi = lv - 2.8
    for (const x of spread(wi / 2 - 1.2, 6)) {
      b.add(
        box(0.3, 0.5, 0.3),
        L.roofRidge,
        local(g.m, x, H.gate.roof * K_ROOF + 0.1, 0)
      )
    }
    // 黑底金字「草堂」匾（前檐额枋下沿之上）
    addPlaque(b, f, 0, PASS_H + 0.02, lu / 2 - 0.2, 2.6, eave - PASS_H - 0.1)
    solid(rectW(r))
  }
  // 大廨：五间通堂敞厅，四面开敞，侧间美人靠，明间正中杜甫铜像
  {
    const r = LAYOUT.daxie
    const { cu, cv, lu, lv } = rectInfo(r)
    const f = at(cu, cv)
    const plat = H.daxie.plat * K_ROOF
    addXiHall(b, f, {
      w: lv,
      d: lu,
      plat,
      eave: H.daxie.eave * K_ROOF,
      roofH: H.daxie.roof * K_ROOF,
      open: "all",
      steps: "both",
      stepW: 4.2
    })
    b.add(box(1.3, 0.9, 1.3), L.granite, local(f, 0, plat, 0))
    b.add(
      cylinder(0.5, 0.36, 2.6, { segments: 6 }),
      C.bronze,
      local(f, 0, plat + 0.9, 0)
    )
    b.add(sphere(0.36, 6, 4), C.bronze, local(f, 0, plat + 3.45, 0))
    solid(rectW(r))
  }
  // 连廊两道（C 形）+ 大廨两端的赭黄月洞门墙
  {
    // 各段的中轴矩形 [u0, u1, v0, v1]（含伸过拐角的外延）
    const hw = GALLERY.w / 2
    const segs = GALLERY_SEGS.map(([a, c, e0, e1]) => {
      const alongU = Math.abs(c[0] - a[0]) > Math.abs(c[1] - a[1])
      const len = Math.hypot(c[0] - a[0], c[1] - a[1])
      const dir = alongU ? Math.sign(c[0] - a[0]) : Math.sign(c[1] - a[1])
      const ext0 = (e0 * GALLERY.w) / 2
      const ext1 = (e1 * GALLERY.w) / 2
      const mid = (len + ext1 - ext0) / 2 // 从 a 沿方向到段中心
      const cu = alongU ? a[0] + dir * mid : a[0]
      const cv = alongU ? a[1] : a[1] + dir * mid
      const tot = (len + ext0 + ext1) / 2
      const rect = alongU
        ? [cu - tot, cu + tot, cv - hw, cv + hw]
        : [cu - hw, cu + hw, cv - tot, cv + tot]
      return { alongU, cu, cv, full: 2 * tot, rect }
    })
    segs.forEach((sg, k) => {
      const others = segs.filter((o) => o !== sg).map((o) => o.rect)
      // 局部 (x, z) → 中轴 (u, v)：沿 u 的段 yaw = π/2（局部 X = +u、+Z = +v），沿 v 的段 yaw = 0（X = +v、Z = −u）
      const toUV = sg.alongU
        ? (x, z) => [sg.cu + x, sg.cv + z]
        : (x, z) => [sg.cu - z, sg.cv + x]
      // 相邻段地坪错开 1.2 cm，交叠处不共面闪烁
      addGallerySeg(
        b,
        at(sg.cu, sg.cv, PAVE_Y, sg.alongU ? Math.PI / 2 : 0),
        sg.full,
        toUV,
        others,
        (k % 2) * 0.012
      )
      solid(rectW(sg.rect), 0.2)
    })
  }
  for (const [u, v] of [
    [-32.5, -8.5],
    [-31.1, 9.2]
  ]) {
    addMoonWall(
      b,
      at(u, v, PAVE_Y + GALLERY.floor, Math.PI / 2),
      GALLERY.w + 0.4,
      4.3,
      1.25,
      L.ochreWall
    )
  }
  // 诗史堂：五开间，明间前后开敞，堂中铜胸像；山面露明木架，檐下黑底匾
  {
    const r = LAYOUT.shishi
    const { cu, cv, lu, lv } = rectInfo(r)
    const f = at(cu, cv)
    const plat = H.shishi.plat * K_ROOF
    addXiHall(b, f, {
      w: lv,
      d: lu,
      plat,
      eave: H.shishi.eave * K_ROOF,
      roofH: H.shishi.roof * K_ROOF,
      open: "mid",
      steps: "both",
      porch: 1.4,
      timber: true,
      plaque: { w: 3.2, h: 1.0 }
    })
    b.add(box(1.1, 1.1, 1.1), L.granite, local(f, 0, plat, -0.6))
    b.add(
      cylinder(0.55, 0.3, 1.1, { segments: 6 }),
      C.bronze,
      local(f, 0, plat + 1.1, -0.6)
    )
    b.add(sphere(0.38, 6, 4), C.bronze, local(f, 0, plat + 2.1, -0.6))
    solid(rectW(r))
  }
  // 两侧陈列室：草堂留后世（西，面朝中轴 +v）、诗圣著千秋（东，面朝中轴 −v）
  for (const [r, yaw] of [
    [LAYOUT.hallW, Math.PI / 2],
    [LAYOUT.hallE, -Math.PI / 2]
  ]) {
    const { cu, cv, lu, lv } = rectInfo(r)
    addXiHall(b, at(cu, cv, PAVE_Y, yaw), {
      w: lu,
      d: lv,
      plat: H.side.plat * K_ROOF,
      eave: H.side.eave * K_ROOF,
      roofH: H.side.roof * K_ROOF,
      bays: 7,
      porch: 1.6
    })
    solid(rectW(r))
  }
  // 水槛：临西溪的小敞轩，台基伸到驳岸（面朝溪 −v），翘角四坡顶
  {
    const r = [LAYOUT.shuikan[0], LAYOUT.shuikan[1], -37.3, LAYOUT.shuikan[3]]
    const { cu, cv, lu, lv } = rectInfo(r)
    const f = at(cu, cv, PAVE_Y, -Math.PI / 2)
    addBase(b, f, lu, lv, 0.4, C.platform)
    const fk = local(f, 0, 0, 1.6)
    addHipHall(b, fk, {
      w: lu,
      d: lv - 3.2,
      plat: 0.4,
      eave: H.xuan.eave * K_ROOF - 0.4,
      roofH: 2.4,
      overhang: 1.0,
      curl: 0.5,
      column: C.redBrown,
      rail: true,
      steps: "none",
      bays: 3
    })
    solid(rectW(r))
  }
  // 柴门：三间小门厅，明间穿行；屋脊加高一层（叠瓦脊）
  {
    const r = LAYOUT.chaimen
    const { cu, cv, lu, lv } = rectInfo(r)
    const f = at(cu, cv)
    const roofH = H.chaimen.roof * K_ROOF
    const g = addGateHall(b, f, {
      w: lv,
      d: lu,
      mid: 4.4,
      eave: Math.max(H.chaimen.eave * K_ROOF, PASS_H + 0.3),
      roofH,
      plat: H.chaimen.plat * K_ROOF,
      overhang: 0.9
    })
    b.add(box(lv + 1.2, 0.3, 0.32), L.roofRidge, local(g.m, 0, roofH + 0.2, 0))
    addPlaque(b, f, 0, PASS_H + 0.02, lu / 2 - 0.2, 2.0, 0.55)
    solid(rectW(r))
  }
  // 恰受航轩：临水轩，歇山翘角、红褐木构、坐凳栏杆
  {
    const r = LAYOUT.qiashou
    const { cu, cv, lu, lv } = rectInfo(r)
    addHipHall(b, at(cu, cv), {
      w: lv,
      d: lu,
      plat: H.xuan.plat * K_ROOF,
      eave: H.xuan.eave * K_ROOF,
      roofH: H.xuan.roof * K_ROOF,
      overhang: 1.1,
      curl: 0.55,
      column: C.redBrown,
      core: 1.0,
      wall: C.redBrown,
      lattice: C.lattice,
      rail: true,
      bays: 5
    })
    solid(rectW(r))
  }
  // 水竹居：单层轩，悬山
  {
    const r = LAYOUT.shuizhu
    const { cu, cv, lu, lv } = rectInfo(r)
    addXiHall(b, at(cu, cv), {
      w: lv,
      d: lu,
      plat: H.xuan.plat * K_ROOF,
      eave: H.xuan.eave * K_ROOF,
      roofH: H.xuan.roof * K_ROOF,
      bays: 5,
      porch: 1.3
    })
    solid(rectW(r))
  }
  // 工部祠：三间带前廊，高台五级石阶；红褐柱、花窗格扇；正脊两端鳌尖、脊中镂空塔形灰塑宝顶
  {
    const r = LAYOUT.gongbu
    const { cu, cv, lu, lv } = rectInfo(r)
    const f = at(cu, cv)
    const roofH = H.gongbu.roof * K_ROOF
    const g = addXiHall(b, f, {
      w: lv,
      d: lu,
      plat: H.gongbu.plat * K_ROOF,
      eave: H.gongbu.eave * K_ROOF,
      roofH,
      bays: 3,
      open: "none",
      porch: 1.9,
      column: C.redBrown,
      lattice: "#5A2A22",
      timber: true,
      stepW: 4.2,
      endK: K_ORN * 1.25,
      plaque: { w: 3.4, h: 1.0 }
    })
    addTowerFinial(b, local(f, 0, g.ridgeY - 0.1, 0), 2.2 * K_ORN, C.figure)
    solid(rectW(r))
  }
  // 碑亭（×1.8 绕自身中心）：踏步朝工部祠（−v）
  const [bu, bv] = BEITING_UV
  const top = addBeiting(b, at(bu, bv, PAVE_Y, -Math.PI / 2))
  const [bx, bz] = site.W(bu, bv)
  site.grid.disk(bx, bz, 5, F_SOLID)
  site.solids.push(rectPolygon(bx, bz, 9.6, 9.6, 0))
  site.beiting = [bx, bz]
  // 碑亭脚下一圈石板（与园路同高）
  site.gb.add(
    prism(12, 6.2, 6.2, PAVE_Y - LOW - LAWN_Y + 0.03),
    C.court,
    local(null, bx, LAWN_Y - 0.03, bz)
  )
  return PAVE_Y + top
}

/* ---------------- 茅屋景区（×1.3） ---------------- */

function buildMaowu(site) {
  const { b, grid, solid } = site
  const { rect } = site.locate("茅屋故居")
  // 局部 X 沿长边、+Z 朝西南（园路一侧）；整组绕茅屋中心 ×1.3
  const G = rectFrame(rect, LAWN_Y, rect.bearing + 90).multiply(
    new Matrix4().makeScale(1.3, 1.3, 1.3)
  )
  const w = 14.1
  const d = 6.4
  addThatchHouse(b, G, {
    w,
    d,
    eave: 2.7,
    roofH: 2.6,
    overhang: 0.9,
    thick: 0.35,
    porch: 1.3
  })
  // 一端更低的茅草披屋（敞廊，有柱）
  {
    const f = local(G, w / 2 + 2.0, 0, 0.3)
    addBase(b, f, 4, 5.6, 0.3, C.rubble)
    addPosts(b, f, [-1.7, 1.7], [2.5, -2.5], 0.3, 1.95, 0.12, C.darkWood)
    const go = {
      overhang: 0.7,
      segS: 1,
      segT: 3,
      ridges: false,
      gables: false,
      thick: 0.3
    }
    const m = local(f, 0, 2.2 - eaveDrop(2.8, 0.7, 1.4, 1.3, 0.2), 0)
    b.add(gableRoof(4, 5.6, 1.4, go), C.thatch, m)
    b.add(box(5.4, 0.28, 0.6), C.thatchDark, local(m, 0, 1.28, 0))
  }
  // 配房三座（屋后围出小院）
  const annex = [
    [-5.4, -10.3, 4.6, 6.4, Math.PI / 2],
    [5.6, -10.3, 4.6, 6.4, Math.PI / 2],
    [0, -15.4, 9, 4.4, 0]
  ]
  for (const [x, z, aw, ad, yaw] of annex) {
    const f = local(G, x, 0, z, yaw)
    // 旋转 90° 的配房：局部 X 沿其面阔（ad），正面朝院子
    const [fw, fd] = yaw ? [ad, aw] : [aw, ad]
    addThatchHouse(b, f, {
      w: fw,
      d: fd,
      eave: 2.4,
      roofH: 1.8,
      overhang: 0.7,
      thick: 0.3
    })
  }
  // 竹篱（高 1.1）围出院子，正面中间留口
  {
    const x0 = -7.9
    const x1 = 11.8
    const z0 = -18.4
    const z1 = 5.4
    const runs = [
      [
        [x0, z1],
        [-1.2, z1]
      ],
      [
        [1.2, z1],
        [x1, z1]
      ],
      [
        [x1, z1],
        [x1, z0]
      ],
      [
        [x1, z0],
        [x0, z0]
      ],
      [
        [x0, z0],
        [x0, z1]
      ]
    ]
    for (const [p, q] of runs) {
      const pts = [xzOf(G, p[0], p[1]), xzOf(G, q[0], q[1])]
      b.add(sweepBar(lift(pts, LAWN_Y), 0.12, 1.1 * 1.3), C.fence)
      grid.stampLine(pts, 0.4, F_SOLID)
    }
  }
  // 菜畦与药圃（配房东侧）
  for (const [x, z, k] of [
    [9.6, -8, 0],
    [9.6, -12.2, 1],
    [9.6, -16.2, 2]
  ]) {
    b.add(box(2.6, 0.25, 3.4), C.veg[k], local(G, x, 0, z))
  }
  const poly = [
    xzOf(G, -7.9, 5.4),
    xzOf(G, 11.8, 5.4),
    xzOf(G, 11.8, -18.4),
    xzOf(G, -7.9, -18.4)
  ]
  grid.fillPoly(poly, F_SOLID, 0.3)
  site.solids.push(poly)
  site.maowu = G
  // 草堂北邻：茅草小屋（×1.3 绕自身中心）
  {
    const { rect: r } = site.locate("草堂北邻")
    const f = rectFrame(r, LAWN_Y, r.bearing + 90).multiply(
      new Matrix4().makeScale(1.3, 1.3, 1.3)
    )
    addThatchHouse(b, f, {
      w: r.w,
      d: r.d,
      eave: 2.5,
      roofH: 2.1,
      overhang: 0.8,
      thick: 0.32,
      porch: 1.0
    })
    solid(rectPolygon(r.cx, r.cz, r.w * 1.3 + 2, r.d * 1.3 + 2, r.bearing), 0.2)
  }
}

/* ---------------- 花径、影壁、浣花祠、南邻 ---------------- */

function buildHuajing(site) {
  const { b, gb, grid } = site
  const K = HUAJING
  const cl = roundCorners(HUAJING_XZ, K.corner, 5)
  site.huajing = cl
  const total = polyLength(cl)
  // 夹道铺装（盖到两道墙外皮）
  gb.add(ribbon(cl, K.clear + 2 * K.t + 0.3, LAWN_Y - 0.03, PAVE_Y), C.pave)
  grid.stampLine(cl, K.clear / 2 + K.t + 0.15, F_PAVE)
  // 浣花祠门楼在北墙上的位置：浣花祠中心在夹道上的投影
  const { rect: hr } = site.locate("浣花祠")
  let gateS = 0
  {
    let best = Infinity
    let acc = 0
    for (let i = 0; i < cl.length - 1; i++) {
      const a = cl[i]
      const c = cl[i + 1]
      const l = Math.hypot(c[0] - a[0], c[1] - a[1])
      const t = clamp(
        ((hr.cx - a[0]) * (c[0] - a[0]) + (hr.cz - a[1]) * (c[1] - a[1])) /
          (l * l),
        0,
        1
      )
      const dd = Math.hypot(
        a[0] + (c[0] - a[0]) * t - hr.cx,
        a[1] + (c[1] - a[1]) * t - hr.cz
      )
      if (dd < best) {
        best = dd
        gateS = acc + t * l
      }
      acc += l
    }
  }
  const off = K.clear / 2 + K.t / 2
  const top = PAVE_Y + K.h
  const wallRun = (line) => {
    if (line.length < 2) return
    b.add(ribbon(line, K.t, LAWN_Y - 0.03, top), C.redWall)
    b.add(
      ribbon(line, K.t + 0.06, LAWN_Y - 0.03, PAVE_Y + K.footH),
      C.redWallFoot
    )
    b.add(sweepBar(lift(line, top), K.capW, K.capH), C.capGrey)
    b.add(sweepBar(lift(line, top + K.capH), 0.3, 0.14), L.roofRidge)
    grid.stampLine(line, K.t / 2 + 0.3, F_SOLID)
    site.debug.walls.push(line)
  }
  // s = −1 为北墙 / 东墙（拐角内侧），北墙在浣花祠门楼处断开 3.2 m
  for (const s of [-1, 1]) {
    const line = offsetMiter(cl, s * off)
    if (s < 0) {
      const lt = polyLength(line)
      const k = lt / total
      wallRun(slicePolyline(line, 0, (gateS - 1.6) * k))
      wallRun(slicePolyline(line, (gateS + 1.6) * k, lt))
    } else {
      wallRun(line)
    }
  }
  // 门楼：浣花祠门（北墙上，单开间，门洞外挑小悬山顶 + 黑底匾）
  const pointAt = (s) => {
    const p = slicePolyline(cl, Math.max(0, s - 0.5), Math.min(total, s + 0.5))
    const a = p[0]
    const c = p[p.length - 1]
    const bearing = Math.atan2(c[0] - a[0], -(c[1] - a[1])) / DEG
    return { x: (a[0] + c[0]) / 2, z: (a[1] + c[1]) / 2, bearing }
  }
  {
    const g = pointAt(gateS)
    // 局部 X 沿夹道、+Z 朝北墙外侧（浣花祠）；frame 的 +Z 指向 bearing + 180 → 取 bearing + 90 使 +Z 指向左手侧的反向
    const f = local(
      frame(g.x, PAVE_Y, g.z, g.bearing - 90),
      0,
      0,
      -off,
      Math.PI
    )
    for (const sx of [-1, 1]) {
      addBase(b, f, 0.7, K.t + 0.05, K.h + 0.9, C.redWall, sx * 1.95)
    }
    b.add(box(4.6, 0.5, K.t + 0.05), C.redWall, local(f, 0, K.h + 0.4, 0))
    // 黑底匾「浣花祠」朝夹道一侧
    addPlaque(b, local(f, 0, 0, -0.3, Math.PI), 0, K.h - 0.3, 0, 1.8, 0.62)
    const go = { overhang: 0.6, segS: 1, segT: 3, ridges: false, gables: false }
    const m = local(f, 0, K.h + 0.9, 0)
    b.add(gableRoof(4.6, 1.6, 1.3, go), L.roof, m)
    b.add(gableRidge(4.6, 1.6, 1.3, go), L.roofRidge, m)
  }
  // 门楼：南北段北口横跨夹道的单开间灰瓦小门楼（行人从下面穿过，净高 ≥ PASS_H）
  {
    // 南北段起点（拐角圆弧之后）再往南 gateBack 米
    const sEnd =
      total -
      Math.hypot(
        HUAJING_XZ[2][0] - HUAJING_XZ[1][0],
        HUAJING_XZ[2][1] - HUAJING_XZ[1][1]
      ) +
      K.corner +
      K.gateBack
    const g = pointAt(sEnd)
    const f = frame(g.x, PAVE_Y, g.z, g.bearing - 90)
    // 局部 X 沿夹道：门楼面阔横跨夹道，故构件沿局部 Z 排
    for (const sz of [-1, 1]) {
      addBase(b, f, 1.0, 0.8, PASS_H + 0.9, C.redWall, 0, sz * (off + 0.1))
    }
    const m = local(f, 0, PASS_H + 0.55, 0, Math.PI / 2)
    b.add(
      box(K.clear + 2 * K.t + 1.2, 0.6, 1.2),
      C.redWall,
      local(m, 0, -0.1, 0)
    )
    const go = { overhang: 0.7, segS: 1, segT: 3, ridges: false, gables: false }
    const mr = local(m, 0, 0.5, 0)
    b.add(gableRoof(K.clear + 2 * K.t + 1.2, 2.2, 1.5, go), L.roof, mr)
    b.add(gableWalls(K.clear + 2 * K.t + 1.2, 2.2, 1.5, go), C.redWall, mr)
    b.add(gableRidge(K.clear + 2 * K.t + 1.2, 2.2, 1.5, go), L.roofRidge, mr)
    addRidgeEnds(b, mr, K.clear + 2 * K.t + 1.2, 1.5, 0.7, 1.1)
  }
  // 影壁小院与「草堂」影壁（×1.5）：南北段南端外，面朝北正对夹道
  {
    const e = cl[cl.length - 1]
    const p = cl[cl.length - 2]
    const l = Math.hypot(e[0] - p[0], e[1] - p[1])
    const dx = (e[0] - p[0]) / l
    const dz = (e[1] - p[1]) / l
    const bearing = Math.atan2(dx, -dz) / DEG // 夹道南北段走向（朝南）
    // 小院坐标系：原点在夹道南端，局部 −Z 沿夹道向南（frame 的 −Z 指向 bearing），+X 朝西
    const Y = frame(e[0], 0, e[1], bearing)
    const court = [
      xzOf(Y, -7, 0.5),
      xzOf(Y, 6.5, 0.5),
      xzOf(Y, 6.5, -SCREEN.along - 1.4),
      xzOf(Y, -7, -SCREEN.along - 1.4)
    ]
    gb.add(extrudePolygon(court, [], LAWN_Y - 0.03, COURT_Y), C.court)
    grid.fillPoly(court, F_PAVE)
    // 影壁：+Z 朝北（夹道一侧），y = 0 为铺装面
    const f = local(Y, 0.4, PAVE_Y, -SCREEN.along)
    addScreen(b, f)
    const sp = [
      xzOf(Y, 0.4 - SCREEN.w / 2, -SCREEN.along - 0.6),
      xzOf(Y, 0.4 + SCREEN.w / 2, -SCREEN.along - 0.6),
      xzOf(Y, 0.4 + SCREEN.w / 2, -SCREEN.along + 1.6),
      xzOf(Y, 0.4 - SCREEN.w / 2, -SCREEN.along + 1.6)
    ]
    site.solid(sp, 0.3)
    site.yingbiCourt = Y
  }
  // 浣花祠：一厅两厢独院，粉墙青瓦（南面即花径北墙）
  {
    const f = rectFrame(hr, PAVE_Y, hr.bearing + 90)
    const hw = hr.w / 2
    const hd = hr.d / 2
    addXiHall(b, local(f, 0, 0, -hd + 3.0), {
      w: 12,
      d: 6,
      plat: 0.4,
      eave: 4.0 * K_ROOF,
      roofH: 2.8 * K_ROOF,
      bays: 3,
      porch: 1.4
    })
    for (const sx of [-1, 1]) {
      addXiHall(b, local(f, sx * (hw - 2.4), 0, 1.6, (-sx * Math.PI) / 2), {
        w: 6.4,
        d: 4.6,
        plat: 0.3,
        eave: 3.4 * K_ROOF,
        roofH: 2.2 * K_ROOF,
        bays: 2,
        porch: 1.0,
        steps: "none"
      })
    }
    // 院内石板：从草地以下长起，顶面比铺装面低 2.5 cm（院内无其他铺装）
    b.add(
      box(hr.w - 10, 0.975 - LAWN_Y + 0.03, hr.d - 7.5),
      C.court,
      local(f, 0, LAWN_Y - 0.03 - PAVE_Y, 2.2)
    )
    site.solid(rectPolygon(hr.cx, hr.cz, hr.w, hr.d, hr.bearing), 0.3)
  }
  // 草堂南邻：贴花径北墙的茅草小屋（×1.3）
  {
    // 南端离花径北墙只有约 1.5 m：平面不放大、只放大高度
    const { rect: r } = site.locate("草堂南邻")
    const f = rectFrame(r, LAWN_Y, r.bearing + 90).multiply(
      new Matrix4().makeScale(1, 1.3, 1)
    )
    addThatchHouse(b, f, {
      w: r.w,
      d: r.d,
      eave: 2.4,
      roofH: 2.0,
      overhang: 0.5,
      thick: 0.3
    })
    site.solid(rectPolygon(r.cx, r.cz, r.w + 1, r.d + 1, r.bearing), 0.2)
  }
}

// 「草堂」二字的笔画（单位字框 [0, 1]²，y 向上）：[x0, y0, x1, y1]
const GLYPH_CAO = [
  [0.05, 0.84, 0.95, 0.92],
  [0.28, 0.74, 0.36, 1.0],
  [0.64, 0.74, 0.72, 1.0],
  [0.22, 0.62, 0.78, 0.68],
  [0.22, 0.36, 0.78, 0.42],
  [0.22, 0.36, 0.28, 0.68],
  [0.72, 0.36, 0.78, 0.68],
  [0.22, 0.49, 0.78, 0.54],
  [0.05, 0.22, 0.95, 0.29],
  [0.46, 0.0, 0.54, 0.42]
]
const GLYPH_TANG = [
  [0.46, 0.86, 0.54, 1.0],
  [0.2, 0.84, 0.28, 0.95],
  [0.72, 0.84, 0.8, 0.95],
  [0.08, 0.74, 0.92, 0.8],
  [0.08, 0.62, 0.14, 0.8],
  [0.86, 0.62, 0.92, 0.8],
  [0.3, 0.62, 0.7, 0.67],
  [0.3, 0.46, 0.7, 0.51],
  [0.3, 0.46, 0.35, 0.67],
  [0.65, 0.46, 0.7, 0.67],
  [0.2, 0.3, 0.8, 0.36],
  [0.05, 0.02, 0.95, 0.09],
  [0.46, 0.02, 0.54, 0.4]
]

/**
 * 「草堂」影壁（×1.5）：石座 + 炭灰墙身 + 红框白心 + 青花碎瓷拼的「草堂」二字（右起：面对影壁时
 * 「草」在右）+ 灰瓦墙帽（红边）+ 前面一道竹栏花池。f 的 +Z 为正面，y = 0 为铺装面。
 */
function addScreen(b, f) {
  const { w, h, t, base } = SCREEN
  addBase(b, f, w + 0.5, t + 0.5, base, L.granite)
  b.add(box(w, h - base, t), C.screenBody, local(f, 0, base, 0))
  const pw = w - 1.5
  const ph = h - base - 1.3
  const py = base + 0.55
  b.add(
    box(pw + 0.3, ph + 0.3, t + 0.06),
    C.screenFrame,
    local(f, 0, py - 0.15, 0)
  )
  b.add(box(pw, ph, t + 0.12), C.screenPanel, local(f, 0, py, 0))
  // 二字：字框各占白心一半宽。真实只在正面（朝北、对夹道）；站点镜头从西南偏南看到的是背面，
  // 插画处理为两面都拼字（背面按背面观者右起，「草」仍在右）
  const cw = pw * 0.4
  const ch = ph * 0.78
  const fz = t / 2 + 0.07
  for (const face of [f, local(f, 0, 0, 0, Math.PI)]) {
    for (const [glyph, cx] of [
      [GLYPH_CAO, pw * 0.24],
      [GLYPH_TANG, -pw * 0.24]
    ]) {
      for (const [x0, y0, x1, y1] of glyph) {
        b.add(
          box((x1 - x0) * cw, (y1 - y0) * ch, 0.1),
          C.blue,
          local(
            face,
            cx + ((x0 + x1) / 2 - 0.5) * cw,
            py + ph * 0.11 + y0 * ch,
            fz
          )
        )
      }
    }
  }
  // 墙帽：红边 + 灰瓦两坡
  b.add(box(w + 0.1, 0.18, t + 0.1), C.screenFrame, local(f, 0, h, 0))
  const go = { overhang: 0.35, segS: 1, segT: 2, ridges: false, gables: false }
  const m = local(f, 0, h + 0.15, 0)
  b.add(gableRoof(w + 0.2, t, 0.7, go), L.roof, m)
  b.add(gableRidge(w + 0.2, t, 0.7, go), L.roofRidge, m)
  // 竹栏花池（石座、竹栏从铺装以下长起，不悬空）
  addBase(b, f, w * 0.8, 1.2, 0.5, L.granite, 0, t / 2 + 0.9)
  b.add(box(w * 0.78, 0.55, 1.1), "#4F8A42", local(f, 0, 0.5, t / 2 + 0.9))
  addBase(b, f, w * 0.8, 0.08, 1.2, C.fence, 0, t / 2 + 1.5)
}

/* ---------------- 楼阁 / 砖塔（万佛楼、一览亭） ---------------- */

// 与 roofs.js 的 biasS（未导出）相同的「向两端加密」映射，封檐饰线与屋面翘角曲线一致
const biasS = (u) => Math.sign(u) * (1 - Math.pow(1 - Math.abs(u), 1.6))

/** 攒尖檐口一圈红橙饰线（沿翘角曲线，盖在屋面自带封檐板外 6 cm） */
function fasciaBand(b, m, sides, R, h, curl, color, bandH = 0.4) {
  const pos = []
  const N = 4
  const out = (R + 0.06) / R
  const quad = (a, c, d, e) => pos.push(...a, ...c, ...d, ...a, ...d, ...e)
  for (let k = 0; k < sides; k++) {
    const a0 = polygonVertex(sides, R, k)
    const a1 = polygonVertex(sides, R, k + 1)
    for (let i = 0; i < N; i++) {
      const s0 = biasS(-1 + (2 * i) / N)
      const s1 = biasS(-1 + (2 * (i + 1)) / N)
      const u0 = (s0 + 1) / 2
      const u1 = (s1 + 1) / 2
      const y0 = curl * h * s0 ** 4
      const y1 = curl * h * s1 ** 4
      const x0 = (a0[0] + (a1[0] - a0[0]) * u0) * out
      const z0 = (a0[1] + (a1[1] - a0[1]) * u0) * out
      const x1 = (a0[0] + (a1[0] - a0[0]) * u1) * out
      const z1 = (a0[1] + (a1[1] - a0[1]) * u1) * out
      quad(
        [x0, y0 + 0.04, z0],
        [x1, y1 + 0.04, z1],
        [x1, y1 - bandH, z1],
        [x0, y0 - bandH, z0]
      )
    }
  }
  b.add(fromTriangles(pos), color, m)
}

/**
 * 多层楼阁 / 砖塔：正 n 边形，每层芯体（可加一圈檐柱、每面窗）+ 截断攒尖翘角檐，顶层完整攒尖 + 宝顶；
 * 檐口一圈红橙饰线。f 的 y = 0 为首层地坪。
 * levels：[{ r 檐柱 / 塔身外接半径, h 层高, ov 出檐, eh 屋面高度参数, core 芯体外接半径 }]
 * @returns {number} 宝顶尖高度（局部）
 */
function addTower(b, f, o) {
  const { sides, levels } = o
  let y = 0
  let topY = 0
  levels.forEach((lv, i) => {
    const last = i === levels.length - 1
    const colTop = y + lv.h
    if (o.column) {
      for (let k = 0; k < sides; k++) {
        const [x, z] = polygonVertex(sides, lv.r, k)
        b.add(
          cylinder(o.colR ?? 0.3, (o.colR ?? 0.3) * 0.9, lv.h + 0.1, {
            segments: 6
          }),
          o.column,
          local(f, x, y, z)
        )
      }
    }
    b.add(
      prism(sides, lv.core, lv.core, lv.h + 0.1, { top: false }),
      o.core,
      local(f, 0, y, 0)
    )
    if (o.window) {
      const side = 2 * lv.core * Math.sin(Math.PI / sides)
      for (let s = 0; s < sides; s++) {
        b.add(
          box(side * 0.36, lv.h * 0.42, 0.08),
          o.window,
          edgeFrame(f, sides, lv.core, s, y + lv.h * 0.3)
        )
      }
    }
    const tMax = last ? 1 : 0.5
    const ro = {
      overhang: lv.ov,
      curl: o.curl,
      tMax,
      ridges: false,
      segS: 4,
      segT: last ? 4 : 2,
      thick: 0.22
    }
    const yr = colTop - eaveDrop(lv.r, lv.ov, lv.eh, 1.5, 0.3)
    const m = local(f, 0, yr, 0)
    b.add(pyramidRoof(sides, lv.r, lv.eh, ro), o.roof, m)
    b.add(pyramidRidges(sides, lv.r, lv.eh, ro), o.ridge, m)
    fasciaBand(
      b,
      m,
      sides,
      lv.r + lv.ov,
      lv.eh,
      o.curl,
      o.fascia,
      o.fasciaH ?? 0.4
    )
    if (!last) {
      // 上一层从本层檐面上「上层半径外 0.25 m」处起，塔身底下不露缝
      const nr = levels[i + 1].r + 0.25
      const tn = Math.min(tMax, Math.max(0, 1 - nr / (lv.r + lv.ov)))
      y = yr + roofHeight(0, tn, lv.eh, 0) - 0.05
    } else {
      const apex = yr + lv.eh
      addFinial(b, local(f, 0, apex - 0.15, 0), o.finialH, o.finial)
      topY = apex - 0.15 + o.finialH
    }
  })
  return topY
}

/** 八角台基一圈石栏（顶扶手 + 实心栏板 + 顶点望柱，简化版） */
function addRingRail(b, f, sides, r, y, h, color) {
  const pts = Array.from({ length: sides + 1 }, (_, k) =>
    polygonVertex(sides, r, k % sides)
  )
  const m = local(f, 0, y, 0)
  b.add(sweepBar(lift(pts, 0), 0.14, h * 0.7), color, m)
  b.add(sweepBar(lift(pts, h * 0.7), 0.2, h * 0.3), color, m)
  for (let k = 0; k < sides; k++) {
    const [x, z] = pts[k]
    b.add(box(0.3, h + 0.2, 0.3), color, local(m, x, 0, z))
  }
}

/* ---------------- 梅园：一览亭、水榭、曲桥 ---------------- */

function buildMeiyuan(site) {
  const { b, grid } = site
  // 一览亭：青砖高台（六角，外接径 12.9、高 3）+ 石栏 + 朝环路的大台阶；六角四层砖塔
  {
    const { rect } = site.locate("一览亭")
    const [lx, lz] = [rect.cx, rect.cz]
    // 台阶朝向环路：环路离塔最近的一点
    const loop = site.U(pathById("meiLoop").pts)
    let best = null
    let bd = Infinity
    for (const p of loop) {
      const dd = Math.hypot(p[0] - lx, p[1] - lz)
      if (dd < bd) {
        bd = dd
        best = p
      }
    }
    const face = Math.atan2(best[0] - lx, -(best[1] - lz)) / DEG
    // frame 的 +Z 指向 bearing + 180：台阶（+Z）朝 face，六边形边 5 正对 +Z
    const f = frame(lx, LAWN_Y, lz, face + 180)
    const R = rect.w / 2
    const th = 3
    b.add(prism(6, R, R, th + 0.35), L.brick, local(f, 0, -0.35, 0))
    addRingRail(b, f, 6, R - 0.3, th, 0.9, L.granite)
    const ap = R * Math.cos(Math.PI / 6)
    addSteps(b, f, 3.6, th, ap, 1, L.granite)
    addTower(b, local(f, 0, th, 0), {
      sides: 6,
      levels: [
        { r: 3.75, core: 3.75, h: 3.6, ov: 1.3, eh: 1.8 },
        { r: 3.45, core: 3.45, h: 3.1, ov: 1.2, eh: 1.7 },
        { r: 3.15, core: 3.15, h: 3.0, ov: 1.1, eh: 1.6 },
        { r: 2.85, core: 2.85, h: 2.9, ov: 1.1, eh: 2.8 }
      ],
      core: C.towerBrick,
      window: C.darkWood,
      roof: L.roof,
      ridge: L.roofRidge,
      fascia: C.fascia,
      fasciaH: 0.3,
      curl: 0.55,
      finialH: 1.6,
      finial: L.roofRidge
    })
    site.solid(rectPolygon(lx, lz, rect.w + 6, rect.w + 6, face), 0.3)
  }
  // 水榭：梅花湖北岸，单檐歇山、临水栏杆
  {
    const { rect } = site.locate("水榭")
    const f = rectFrame(rect, PAVE_Y, rect.bearing + 90)
    addHipHall(b, f, {
      w: rect.w,
      d: rect.d,
      plat: 0.5,
      eave: 3.4 * K_ROOF,
      roofH: 2.7,
      overhang: 1.1,
      curl: 0.5,
      column: C.redBrown,
      rail: true,
      core: 1.2,
      wall: L.plaster,
      steps: "none"
    })
    site.solid(rectPolygon(rect.cx, rect.cz, rect.w, rect.d, rect.bearing), 0.3)
  }
  // 三折曲桥：梅花湖南北（石板、低栏）
  {
    const pts = [
      [-3956.5, -693.8],
      [-3951.8, -701.8],
      [-3957.4, -710.2],
      [-3953.4, -720.2]
    ]
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const c = pts[i + 1]
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]) + 1.6
      const bearing = Math.atan2(c[0] - a[0], -(c[1] - a[1])) / DEG
      const f = frame((a[0] + c[0]) / 2, 0, (a[1] + c[1]) / 2, bearing - 90)
      b.add(box(len, 1.0 - 0.1, 2.0), L.granite, local(f, 0, 0.1, 0))
      for (const sz of [-1, 1]) {
        b.add(box(len, 0.5, 0.12), L.marble, local(f, 0, 1.0, sz * 0.95))
      }
      grid.stamp(a, c, 1.2, F_PAVE)
    }
    // 北端上岸后接到梅园环路（经水榭西侧）；路面比环路低一档，交接处不共面
    const loop = site.U(pathById("meiLoop").pts)
    const tail = [-3954, -722.2]
    let best = loop[0]
    for (const q of loop) {
      if (
        Math.hypot(q[0] - tail[0], q[1] - tail[1]) <
        Math.hypot(best[0] - tail[0], best[1] - tail[1])
      )
        best = q
    }
    addPath(
      site,
      [tail, [-3956.6, -728.5], best],
      2.4,
      PAVE_Y - LOW - 3 * LOW_STEP
    )
  }
}

/* ---------------- 草堂寺（中等精度） ---------------- */

function buildTemple(site) {
  const { b, gb, grid } = site
  const S = (name) => site.locate(name).rect
  // 南门（原草堂寺山门，今主入口）：中部五开间高歇山（偏绿灰瓦）、两翼低悬山；
  // 明间穿行（地面即铺装面）；檐下黑底金字「杜甫草堂」大匾；门前石板广场
  {
    const r = S("草堂寺山门")
    const f = rectFrame(r, PAVE_Y, r.bearing + 90)
    site.southGate = f
    const cw = 22
    const d = r.d
    const cz = d / 2 - 0.55
    const eave = 5.0 * K_ROOF
    const plat = 0.45 * K_ROOF
    const mid = 4.8
    const xs = [-cw / 2 + 0.5, -6.6, -mid / 2, mid / 2, 6.6, cw / 2 - 0.5]
    for (const sx of [-1, 1]) {
      const x0 = mid / 2
      const x1 = cw / 2
      addBase(b, f, x1 - x0, d, plat, C.platform, (sx * (x0 + x1)) / 2)
      b.add(
        box(x1 - x0 - 0.3, eave - plat - 0.4, 0.4),
        C.lattice,
        local(f, (sx * (x0 + x1)) / 2, plat, 0)
      )
      addSteps(b, f, 4, plat, d / 2, 1, C.platform, sx * 7.5)
    }
    addPosts(b, f, xs, [cz, -cz], -0.2, eave + 0.2, 0.28, C.darkWood)
    b.add(box(mid, eave - PASS_H, 0.4), C.lattice, local(f, 0, PASS_H, 0))
    for (const z of [cz, -cz]) {
      b.add(box(cw, 0.5, 0.32), C.lattice, local(f, 0, eave - 0.5, z))
    }
    addPlaque(b, f, 0, eave - 1.85, cz + 0.25, 5.6, 1.3)
    const ro = {
      overhang: 1.5,
      curl: 0.3,
      ridge: 0.62,
      segS: 6,
      segT: 3,
      ridges: false
    }
    const roofH = 3.6 * K_ROOF
    const y = eave - eaveDrop(cz, 1.5, roofH, 1.5, 0.4)
    const m = local(f, 0, y, 0)
    b.add(hipRoof(cw - 1, 2 * cz, roofH, ro), C.southRoof, m)
    b.add(hipRidges(cw - 1, 2 * cz, roofH, ro), L.roofRidge, m)
    // 两翼低屋
    const ww = (r.w - cw) / 2
    for (const sx of [-1, 1]) {
      addXiHall(b, local(f, sx * (cw / 2 + ww / 2), 0, 0), {
        w: ww,
        d: d - 0.8,
        plat: 0.3,
        eave: 3.6 * K_ROOF,
        roofH: 1.9 * K_ROOF,
        bays: 3,
        porch: 1.2,
        roof: C.southRoof,
        steps: "none"
      })
    }
    site.solid(rectPolygon(r.cx, r.cz, r.w, r.d, r.bearing), 0.3)
    // 门前石板广场（到园界内）
    const plaza = [
      xzOf(f, -21.5, d / 2),
      xzOf(f, 21.5, d / 2),
      xzOf(f, 21.5, d / 2 + 27),
      xzOf(f, -21.5, d / 2 + 27)
    ]
    gb.add(extrudePolygon(plaza, [], GROUND_Y, PAVE_Y - LOW), C.court)
    grid.fillPoly(plaza, F_PAVE)
    // 草堂寺中轴甬道：广场 → 南门明间 → 展厅
    const za = S("展厅")
    const zf = rectFrame(za, PAVE_Y, za.bearing + 90)
    const pts = [
      xzOf(f, 0, d / 2 + 26),
      xzOf(f, 0, -d / 2),
      xzOf(zf, 0, za.d / 2 + 0.2)
    ]
    addPath(site, pts, 3.4, PAVE_Y, { walk: 2.2 })
    site.templeAxis = pts
  }
  // 展厅（情系草堂陈列室）：悬山
  {
    const r = S("展厅")
    const f = rectFrame(r, PAVE_Y, r.bearing + 90)
    addXiHall(b, f, {
      w: r.w,
      d: r.d,
      plat: 0.4 * K_ROOF,
      eave: 4.0 * K_ROOF,
      roofH: 2.5 * K_ROOF,
      bays: 7,
      open: "mid",
      porch: 1.2,
      steps: "both"
    })
    site.solid(rectPolygon(r.cx, r.cz, r.w, r.d, r.bearing), 0.3)
  }
  // 大雅堂：单檐歇山、高台，红褐柱；正脊两端卷草鸱吻、脊中镂空宝顶 + 金色宝刹
  {
    const r = S("大雅堂")
    const f = rectFrame(r, PAVE_Y, r.bearing + 90)
    const roofH = 5 * K_ROOF
    const hh = addHipHall(b, f, {
      w: r.w,
      d: r.d,
      plat: 1.0 * K_ROOF,
      eave: 6.0 * K_ROOF,
      roofH,
      overhang: 2.0,
      curl: 0.32,
      ridge: 0.55,
      column: C.redBrown,
      core: 1.6,
      wall: C.lattice,
      lattice: "#5A2A22",
      bays: 5,
      segS: 6,
      segT: 4
    })
    const rx = (0.55 * 2 * hh.cx) / 2
    for (const sx of [-1, 1]) {
      b.add(
        box(0.5 * K_ORN, 1.0 * K_ORN, 0.5),
        C.figure,
        local(f, sx * rx, hh.top - 0.2, 0)
      )
      b.add(
        box(0.7 * K_ORN, 0.3 * K_ORN, 0.4),
        C.figure,
        local(f, sx * (rx + 0.35), hh.top + 0.75 * K_ORN, 0)
      )
    }
    addTowerFinial(
      b,
      local(f, 0, hh.top - 0.2, 0),
      1.9 * K_ORN,
      C.figure,
      L.gold
    )
    b.add(
      cone(6, 0.12, 1.2 * K_ORN),
      L.gold,
      local(f, 0, hh.top - 0.2 + 1.9 * K_ORN, 0)
    )
    site.solid(rectPolygon(r.cx, r.cz, r.w, r.d, r.bearing), 0.3)
    // 展厅后 → 大雅堂前甬道；大雅堂前院、后院石板
    const za = S("展厅")
    const zf = rectFrame(za, PAVE_Y, za.bearing + 90)
    const pa = [xzOf(zf, 0, -za.d / 2 - 0.2), xzOf(f, 0, r.d / 2 + 0.3)]
    addPath(site, pa, 3.4, PAVE_Y, { walk: 2.2 })
    site.templeAxis2 = pa
    const court = (x0, x1, z0, z1) => {
      const poly = [
        xzOf(f, x0, z0),
        xzOf(f, x1, z0),
        xzOf(f, x1, z1),
        xzOf(f, x0, z1)
      ]
      gb.add(extrudePolygon(poly, [], LAWN_Y - 0.03, TEMPLE_COURT_Y), C.court)
      grid.fillPoly(poly, F_PAVE)
    }
    const dx = S("草堂寺大雄宝殿")
    const gap = Math.hypot(dx.cx - r.cx, dx.cz - r.cz) - r.d / 2 - dx.d / 2
    court(-12, 12, r.d / 2 + 0.3, r.d / 2 + 16)
    court(-13, 13, -r.d / 2 - gap + 0.5, -r.d / 2 - 0.3)
    // 影壁小院 → 大雅堂前园路（步行路径 W8 同线）
    {
      const start = xzOf(site.yingbiCourt, 0, -5.8)
      const end = xzOf(f, -5.5, r.d / 2 + 5.6)
      const mid = [start[0] + (end[0] - start[0]) * 0.55, start[1] + 1.2]
      site.yingbiPath = [start, mid, end]
      addPath(site, site.yingbiPath, 2.6, PAVE_Y - LOW, { walk: 2 })
    }
    // 两株古银杏（大雅堂后院两侧，秋色金黄）
    site.ginkgo = [
      xzOf(f, -10, -r.d / 2 - gap / 2),
      xzOf(f, 10.5, -r.d / 2 - gap / 2)
    ]
  }
  // 大雄宝殿：单檐悬山
  {
    const r = S("草堂寺大雄宝殿")
    addXiHall(b, rectFrame(r, PAVE_Y, r.bearing + 90), {
      w: r.w,
      d: r.d,
      plat: 0.6 * K_ROOF,
      eave: 5.0 * K_ROOF,
      roofH: 3.5 * K_ROOF,
      bays: 5,
      porch: 1.8,
      plaque: { w: 3.0, h: 0.9 }
    })
    site.solid(rectPolygon(r.cx, r.cz, r.w, r.d, r.bearing), 0.3)
  }
  // 藏经阁：两层重檐歇山（下层腰檐截断成一圈，上层楼身盖住檐内缘）
  {
    const r = S("草堂寺藏经阁")
    const f = rectFrame(r, PAVE_Y, r.bearing + 90)
    const plat = 0.6 * K_ROOF
    const e1 = 4.2 * K_ROOF
    const e2 = 8.4 * K_ROOF
    addBase(b, f, r.w, r.d, plat, C.platform)
    addSteps(b, f, 5, plat, r.d / 2, 1, C.platform)
    const cx = r.w / 2 - 0.8
    const cz = r.d / 2 - 0.8
    addPosts(b, f, spread(cx, 7), [cz, -cz], plat, e1 - plat, 0.26, C.darkWood)
    b.add(
      box(2 * cx - 1.6, e1 - plat, 2 * cz - 1.6),
      L.plaster,
      local(f, 0, plat, 0)
    )
    b.add(
      box((2 * cx - 1.6) * 0.9, (e1 - plat) * 0.7, 0.1),
      C.lattice,
      local(f, 0, plat, cz - 0.75)
    )
    const pent = {
      overhang: 1.4,
      curl: 0.35,
      ridge: 0.7,
      tMax: 0.5,
      segS: 4,
      segT: 2,
      ridges: false
    }
    const ph = 2.4
    const yp = e1 - eaveDrop(cz, 1.4, ph, 1.5, 0.4)
    b.add(hipRoof(2 * cx, 2 * cz, ph, pent), L.roof, local(f, 0, yp, 0))
    b.add(hipRidges(2 * cx, 2 * cz, ph, pent), L.roofRidge, local(f, 0, yp, 0))
    const ex = cx + 1.4
    const ez = cz + 1.4
    const hx = ex * 0.5 + 0.7 * cx * 0.5
    const hz = ez * 0.5
    const ring = yp + roofHeight(0, 0.5, ph, 0)
    b.add(
      box(2 * hx + 0.4, e2 - e1, 2 * hz + 0.4),
      C.lattice,
      local(f, 0, e1, 0)
    )
    b.add(
      box(2 * hx * 0.9, (e2 - ring) * 0.7, 0.1),
      "#5A2A22",
      local(f, 0, ring + 0.2, hz + 0.25)
    )
    const roofH = 3.6 * K_ROOF
    const ro = {
      overhang: 1.6,
      curl: 0.35,
      ridge: 0.55,
      segS: 6,
      segT: 3,
      ridges: false
    }
    const yu = e2 - eaveDrop(hz, 1.6, roofH, 1.5, 0.3)
    b.add(hipRoof(2 * hx, 2 * hz, roofH, ro), L.roof, local(f, 0, yu, 0))
    b.add(hipRidges(2 * hx, 2 * hz, roofH, ro), L.roofRidge, local(f, 0, yu, 0))
    site.solid(rectPolygon(r.cx, r.cz, r.w, r.d, r.bearing), 0.3)
  }
  // 西厢房、唐风遗韵：灰瓦悬山院落房，面朝草堂寺中轴（东）
  for (const name of ["西厢房", "唐风遗韵"]) {
    const r = S(name)
    addXiHall(b, rectFrame(r, PAVE_Y, r.bearing + 90), {
      w: r.w,
      d: r.d,
      plat: 0.3 * K_ROOF,
      eave: 4.0 * K_ROOF,
      roofH: 3.0 * K_ROOF,
      bays: 7,
      porch: 2.0,
      overhang: 1.0
    })
    site.solid(rectPolygon(r.cx, r.cz, r.w, r.d, r.bearing), 0.3)
  }
}

/* ---------------- 万佛楼 ---------------- */

/** 万佛楼：八角四层四重檐 + 攒尖宝顶，红漆柱与红木构、灰瓦、翼角高翘；白石台基带栏杆与四面石阶 */
function buildWanfo(site) {
  const { b } = site
  const { rect } = site.locate("万福楼")
  // 八边形的一条边朝 OSM 轮廓的长边方位（frame 的局部 −Z 指向 bearing，边 2k 的法向落在 ±Z、±X）
  const f = frame(rect.cx, LAWN_Y, rect.cz, rect.bearing)
  const R = 10.2
  const ph = 1.6
  b.add(prism(8, R, R, ph + 0.35), L.marble, local(f, 0, -0.35, 0))
  addRingRail(b, f, 8, R - 0.3, ph, 0.9, L.marble)
  const ap = R * Math.cos(Math.PI / 8)
  for (const k of [1, 3, 5, 7]) {
    const a = Math.PI / 8 + ((k + 0.5) * 2 * Math.PI) / 8
    addSteps(b, local(f, 0, 0, 0, a), 3.6, ph, ap, 1, L.marble)
  }
  const top = addTower(b, local(f, 0, ph, 0), {
    sides: 8,
    levels: [
      { r: 7.0, core: 5.9, h: 4.3, ov: 2.3, eh: 3.6 },
      { r: 6.2, core: 5.2, h: 3.5, ov: 2.0, eh: 3.2 },
      { r: 5.5, core: 4.6, h: 3.3, ov: 1.9, eh: 3.0 },
      { r: 4.8, core: 4.0, h: 3.2, ov: 1.9, eh: 4.6 }
    ],
    column: C.wanfoRed,
    colR: 0.32,
    core: L.lattice,
    roof: L.roof,
    ridge: L.roofRidge,
    fascia: C.fascia,
    curl: 0.6,
    finialH: 2.8,
    finial: L.gold
  })
  site.solid(rectPolygon(rect.cx, rect.cz, 2 * R, 2 * R, rect.bearing), 0.3)
  // 台基外一圈石板环路（r 15，24 段），步行路径 W14 同线
  const ring = Array.from({ length: 24 }, (_, k) => {
    const a = (k / 24) * Math.PI * 2
    return [rect.cx + 15 * Math.cos(a), rect.cz + 15 * Math.sin(a)]
  })
  const ringY = PAVE_Y - LOW - 3 * LOW_STEP
  addPath(site, ring, 3.0, ringY, { closed: true, walk: 2 })
  site.wanfo = { x: rect.cx, z: rect.cz, top: LAWN_Y + ph + top, ring, ringY }
}

/* ---------------- 其余建筑（藏书楼、唐代遗址、园内其余 OSM 楼） ---------------- */

/**
 * 矩形轮廓的灰瓦坡顶房：墙体盒子 + 低细分悬山顶，约 60 个三角形（同 wuhou.js 的 addBlockHouse）。
 */
function addBlockHouse(b, rect, o) {
  const { eave, ridgeH, overhang, wall } = o
  const f = frame(rect.cx, 0, rect.cz, rect.bearing - 90)
  b.add(box(rect.w, eave - GROUND_Y, rect.d), wall, local(f, 0, GROUND_Y, 0))
  const go = { overhang, segS: 1, segT: 2, gables: false, ridges: false }
  const m = local(
    f,
    0,
    eave - eaveDrop(rect.d / 2, overhang, ridgeH, 1.3, 0),
    0
  )
  b.add(gableRoof(rect.w, rect.d, ridgeH, go), o.roof ?? L.roof, m)
  b.add(gableWalls(rect.w, rect.d, ridgeH, go), wall, m)
  b.add(gableRidge(rect.w, rect.d, ridgeH, go), o.ridge ?? L.roofRidge, m)
  return m
}

function buildOthers(site) {
  const { b, buildings, replaced, grid } = site
  // 唐代遗址陈列馆：大跨灰瓦悬山保护棚
  {
    const { rect } = site.locate("唐代遗址")
    addBlockHouse(b, rect, {
      eave: PAVE_Y + 5 * K_ROOF,
      ridgeH: 4 * K_ROOF,
      overhang: 0.9,
      wall: C.shedWall
    })
    site.solid(rectPolygon(rect.cx, rect.cz, rect.w, rect.d, rect.bearing), 0.5)
  }
  // 藏书楼：两层，腰檐一圈
  {
    const { rect } = site.locate("藏书楼")
    addBlockHouse(b, rect, {
      eave: PAVE_Y + 7.2 * K_ROOF,
      ridgeH: 2.8 * K_ROOF,
      overhang: 1.2,
      wall: L.plaster
    })
    const f = frame(rect.cx, 0, rect.cz, rect.bearing - 90)
    b.add(
      box(rect.w + 1.6, 0.3, rect.d + 1.6),
      L.roof,
      local(f, 0, PAVE_Y + 3.6 * K_ROOF, 0)
    )
    b.add(
      box(rect.w * 0.9, 1.8, rect.d + 0.1),
      C.lattice,
      local(f, 0, PAVE_Y + 3.6 * K_ROOF + 1.2, 0)
    )
    site.solid(rectPolygon(rect.cx, rect.cz, rect.w, rect.d, rect.bearing), 0.5)
  }
  // 园内其余 OSM 楼：灰瓦坡顶矮房（≤ 8 m，按轮廓播种）；厕所省略
  const generic = []
  for (const i of replaced) {
    if (site.used.has(i)) continue
    const bd = buildings[i]
    if (!bd.p || bd.p.length < 3) continue
    if (bd.n && SPECIAL_NAMES.has(bd.n)) continue
    const [cx, cz] = centroid(bd.p)
    if (TOILETS.some(([x, z]) => Math.hypot(x - cx, z - cz) < 4)) continue
    const r = minAreaRect(bd.p)
    if (r.d < 2.5) continue
    const rand = mulberry32(shapeSeed(SEED, bd.p))
    const area = polygonArea(bd.p)
    const eave = PAVE_Y + (area > 420 ? 6.0 : area > 150 ? 5.0 : 4.3)
    const ridgeH = clamp(0.28 * r.d, 1.8, 3.4)
    const pick = rand()
    const wall = pick < 0.65 ? L.plaster : pick < 0.85 ? C.timber : C.dado
    if (area / (r.w * r.d) >= 0.85) {
      addBlockHouse(b, r, { eave, ridgeH, overhang: 0.8, wall })
    } else {
      addPitchedHouse(b, bd.p, {
        eaveH: eave,
        ridgeH,
        overhang: 0.8,
        wallColor: wall,
        roofColor: L.roof,
        ridgeColor: L.roofRidge
      })
    }
    grid.fillPoly(bd.p, F_SOLID, 0.8)
    generic.push(bd.n ?? `#${i}`)
  }
  site.genericCount = generic.length
}

/* ---------------- 园区外墙 ---------------- */

/**
 * 朱红园墙（灰瓦墙帽）：沿园界一圈，正门处改接到门殿两侧（西侧一道到园界西缘、东侧一小段翼墙），
 * 北门、东门、南门前广场处断开。
 */
function buildWalls(site) {
  const { b, grid, park, W } = site
  const h = PAVE_Y + 3.2
  const run = (pts) => {
    if (pts.length < 2) return
    b.add(ribbon(pts, 0.6, GROUND_Y, h), C.redWall)
    b.add(sweepBar(lift(pts, h), 1.0, 0.22), L.roof)
    b.add(sweepBar(lift(pts, h + 0.22), 0.36, 0.16), L.roofRidge)
    grid.stampLine(pts, 0.7, F_SOLID)
    site.debug.walls.push(pts)
  }
  // 园界上从下标 from 顺序走到 to（绕回首点），再按缺口切段
  const n = park.length
  const loop = []
  for (let i = WALL_RUN.from; ; i = (i + 1) % n) {
    loop.push(park[i])
    if (i === WALL_RUN.to) break
  }
  // 缺口：园路穿过园界处（北门、东门、南门广场）按园路与园界交点外扩
  const gaps = []
  const cutAt = (pts, halfW) => {
    for (let i = 0; i < loop.length - 1; i++) {
      for (let j = 0; j < pts.length - 1; j++) {
        const hit = segCross(loop[i], loop[i + 1], pts[j], pts[j + 1])
        if (hit) gaps.push({ seg: i, t: hit.t, half: halfW })
      }
    }
  }
  cutAt(site.ll(footwayById("northGate")), 4) // 北门园路
  cutAt(site.ll(footwayById("eastGate")), 4) // 东门园路
  if (site.templeAxis) cutAt(site.templeAxis, 23) // 南门前广场
  // 按弧长切段
  const cum = [0]
  for (let i = 0; i < loop.length - 1; i++) {
    cum.push(
      cum[i] +
        Math.hypot(loop[i + 1][0] - loop[i][0], loop[i + 1][1] - loop[i][1])
    )
  }
  const total = cum[cum.length - 1]
  const raw = gaps.map((g) => {
    const s = cum[g.seg] + g.t * (cum[g.seg + 1] - cum[g.seg])
    return [s - g.half, s + g.half]
  })
  // 园界压到楼处也断开：园外保留楼（唐代遗址北侧跨园界的 #3962 等）与贴着园界的园内楼
  // （唐代遗址北墙即园墙）。沿墙每 0.5 m 取点，落在楼轮廓内或离轮廓 0.9 m 以内的段不建墙
  {
    const pb = polygonBounds(park)
    const kept = []
    site.buildings.forEach((bd) => {
      if (!bd.p || bd.p.length < 3) return
      // 厕所不建，不算
      const [cx, cz] = centroid(bd.p)
      if (TOILETS.some(([x, z]) => Math.hypot(x - cx, z - cz) < 4)) return
      const bb = polygonBounds(bd.p)
      if (bb.maxX < pb.minX - 5 || bb.minX > pb.maxX + 5) return
      if (bb.maxZ < pb.minZ - 5 || bb.minZ > pb.maxZ + 5) return
      kept.push({ p: bd.p, bb })
    })
    const nearKept = ([x, z]) =>
      kept.some(({ p, bb }) => {
        if (x < bb.minX - 1 || x > bb.maxX + 1) return false
        if (z < bb.minZ - 1 || z > bb.maxZ + 1) return false
        if (pointInPolygon(x, z, p)) return true
        for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
          if (distToSegment(x, z, p[j], p[i]) < 0.9) return true
        }
        return false
      })
    let from = null
    for (let t = 0; t <= total; t += 0.5) {
      const hit = nearKept(slicePolyline(loop, t, t + 0.01)[0])
      if (hit && from === null) from = t
      if (!hit && from !== null) {
        raw.push([from - 0.5, t])
        from = null
      }
    }
    if (from !== null) raw.push([from - 0.5, total])
  }
  // 缺口按起点排序、重叠的合并，再逐段建墙
  raw.sort((p, q) => p[0] - q[0])
  const ranges = []
  for (const r of raw) {
    const last = ranges[ranges.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else ranges.push([...r])
  }
  // 缺口之间短于 10 m 的零碎墙段不建（两楼之间夹出的短墙头）
  let s0 = 0
  for (const [a, c] of ranges) {
    if (a - s0 >= 10) run(slicePolyline(loop, s0, a))
    s0 = Math.max(s0, c)
  }
  if (total - s0 >= 10) run(slicePolyline(loop, s0, total))
  // 正门两侧：西侧园墙从门殿西端砖垛接到园界西缘，东侧一小段翼墙
  const g = LAYOUT.gate
  const cu = (g[0] + g[1]) / 2
  run([W(cu, g[2] - 0.2), W(cu, -56.3), loop[0]])
  run([W(cu, g[3] + 0.2), W(cu, 13)])
}

/* ---------------- 种植：竹、梅、松、银杏、楠木、杂树 ---------------- */

function plantAll(site, walkways) {
  const { b, grid, W, U } = site
  const bufs = site.bambooBufs
  // 步行路径可走带外扩 0.9 m：树冠、竹丛根部都不进
  for (const w of walkways) {
    grid.stampLine(w.points, w.width / 2 + 0.9, F_WALK, w.closed)
  }
  const block = F_SOLID | F_PAVE | F_WATER | F_TREE | F_WALK
  const cam = [Math.sin(CAM_BEARING * DEG), -Math.cos(CAM_BEARING * DEG)]
  // 花径东西段南侧（朝站点镜头一侧）墙外 8 m 内不种杂树：两道红墙不被树冠挡住
  {
    const cl = site.huajing
    const [a, c] = HUAJING_XZ
    const ew = slicePolyline(cl, 0, Math.hypot(c[0] - a[0], c[1] - a[1]) - 2)
    const off = HUAJING.clear / 2 + HUAJING.t
    grid.stampLine(offsetMiter(ew, off + 4), 4, F_NOTREE)
  }

  /* ---- 花径两侧高竹 ---- */
  {
    const K = HUAJING
    const cl = site.huajing
    const rand = mulberry32(SEED + 11)
    for (const s of [-1, 1]) {
      const line = resample(offsetMiter(cl, s * K.bambooOff), K.bambooStep)
      const ns = normals(line)
      line.forEach(([x, z], k) => {
        const jx = (rand() - 0.5) * 0.7
        const jz = (rand() - 0.5) * 0.7
        const px = x + jx
        const pz = z + jz
        // 外法向朝镜头的一侧压低
        const near = s * (ns[k][0] * cam[0] + ns[k][1] * cam[1]) > 0
        const [h0, h1] = near ? K.bambooNearH : K.bambooH
        const h = h0 + (h1 - h0) * rand()
        if (!grid.freeDisk(px, pz, 1.0, F_SOLID | F_WATER)) return
        // 竿顶朝夹道一侧弯：法向的反方向
        addBamboo(bufs, px, LAWN_Y, pz, rand, h, 4, {
          dx: -s * ns[k][0],
          dz: -s * ns[k][1],
          deg: near ? 7 : 13
        })
        grid.disk(px, pz, 1.2, F_TREE)
      })
    }
  }

  /* ---- 成片竹丛：碑亭北东两侧、茅屋院后、茅屋前池北、西溪西岸、堂后溪北岸 ---- */
  {
    const rand = mulberry32(SEED + 23)
    const clump = (x, z, h, n = 4) => {
      if (!grid.freeDisk(x, z, 1.6, block)) return false
      addBamboo(bufs, x, LAWN_Y, z, rand, h, n, null)
      grid.disk(x, z, 1.9, F_TREE)
      return true
    }
    // 碑亭：北、东两侧弧形竹丛（半径 9～13 m）
    const [bu, bv] = BEITING_UV
    for (let k = 0; k < 16; k++) {
      const a = (-25 + (k / 15) * 140) * DEG // 从 +u（东北）转向 +v（东南）
      const rr = 9 + rand() * 4
      const [x, z] = W(bu + rr * Math.cos(a), bv + rr * Math.sin(a))
      clump(x, z, 10 + rand() * 3, 5)
    }
    // 茅屋院后（竹篱外东北）
    if (site.maowu) {
      for (let k = 0; k < 9; k++) {
        const x = -8 + k * 2.5 + (rand() - 0.5)
        const [px, pz] = xzOf(site.maowu, x, -21 - rand() * 2)
        clump(px, pz, 9 + rand() * 3)
      }
    }
    // 西溪西岸（v ≈ −47）
    for (let u = -40; u <= 60; u += 6.5) {
      const [x, z] = W(u + (rand() - 0.5) * 2, -47.5 - rand() * 2.5)
      clump(x, z, 9 + rand() * 3.5)
    }
    // 茅屋前池北侧、堂后溪北岸
    for (let k = 0; k < 6; k++) {
      const [x, z] = W(106 + rand() * 6, -10 + k * 3.2)
      clump(x, z, 9 + rand() * 3)
    }
    for (let u = 58; u <= 76; u += 4.5) {
      const [x, z] = W(u, 24.5 + rand() * 2)
      clump(x, z, 9 + rand() * 2)
    }
  }

  /* ---- 点景树：诗史堂前罗汉松、工部祠前盆景松、梅林院、银杏 ---- */
  {
    const rand = mulberry32(SEED + 31)
    for (const v of [-6.2, 6.2]) {
      const [x, z] = W(-8.6, v)
      addLayeredPine(b, x, LAWN_Y, z, 7.5, 2.8, C.pine[0], rand() * 6.28)
      grid.disk(x, z, 2.8, F_TREE)
    }
    for (const v of [-4.4, 5.6]) {
      const [x, z] = W(44.4, v)
      addLayeredPine(b, x, COURT_Y, z, 3.4, 1.4, C.pine[1], rand() * 6.28)
      grid.disk(x, z, 1.5, F_TREE)
    }
    // 梅林院：甬道两侧各数排梅树（粉花）
    for (let u = -25; u <= -9; u += 3.8) {
      for (const v of [-11, -7.5, -4.2, 4.2, 7.5, 11]) {
        const x0 = u + (rand() - 0.5) * 1.2
        const v0 = v + (rand() - 0.5) * 1.0
        const [x, z] = W(x0, v0)
        const r = 1.5 + rand() * 0.4
        if (!grid.freeDisk(x, z, r * 0.8, block)) continue
        addTreeLite(b, x, LAWN_Y, z, {
          r,
          sy: 1.0,
          trunkH: 1.5 + rand() * 0.4,
          color: C.plum[Math.floor(rand() * C.plum.length)],
          yaw: rand() * 6.28,
          trunk: C.darkWood
        })
        grid.disk(x, z, r, F_TREE)
      }
    }
    grid.fillPoly(site.rectW([-28, -5, -13.4, 13.4]), F_TREE)
    // 两株古银杏（30 m 以上，秋色）
    for (const [x, z] of site.ginkgo ?? []) {
      addTreeLite(b, x, TEMPLE_COURT_Y, z, {
        r: 5.5,
        sy: 1.7,
        trunkH: 11,
        color: C.ginkgo,
        yaw: rand() * 6.28
      })
      grid.disk(x, z, 5, F_TREE)
    }
  }

  /* ---- 梅园：梅花湖一带梅树 ---- */
  {
    const loop = U(pathById("meiLoop").pts)
    const bb = polygonBounds(loop)
    for (let x = bb.minX; x <= bb.maxX; x += 5) {
      for (let z = bb.minZ; z <= bb.maxZ; z += 5) {
        const rand = mulberry32(
          hashInts(SEED + 41, Math.round(x), Math.round(z))
        )
        const px = x + (rand() - 0.5) * 4
        const pz = z + (rand() - 0.5) * 4
        if (rand() > 0.34 || !pointInPolygon(px, pz, loop)) continue
        const r = 1.7 + rand() * 0.6
        if (!grid.freeDisk(px, pz, r + 0.4, block)) continue
        addTreeLite(b, px, LAWN_Y, pz, {
          r,
          sy: 1.0,
          trunkH: 1.6 + rand() * 0.5,
          color: C.plum[Math.floor(rand() * C.plum.length)],
          yaw: rand() * 6.28,
          trunk: C.darkWood
        })
        grid.disk(px, pz, r + 0.3, F_TREE)
      }
    }
  }

  /* ---- 杂树与楠木林：全园空地（东部楠木林为深绿细高树冠） ---- */
  {
    const pb = polygonBounds(site.park)
    const step = 11
    for (let x = pb.minX; x <= pb.maxX; x += step) {
      for (let z = pb.minZ; z <= pb.maxZ; z += step) {
        const rand = mulberry32(
          hashInts(SEED + 53, Math.round(x), Math.round(z))
        )
        const px = x + (rand() - 0.5) * step * 0.8
        const pz = z + (rand() - 0.5) * step * 0.8
        const keep = rand()
        if (!(grid.get(px, pz) & F_PARK)) continue
        const nanmu = px > -3730
        // 南部园林区（中轴以南、花径与草堂寺南门之间，站点镜头的前景）加密
        const south = !nanmu && pz > -565 && px > -3935
        const p = nanmu ? 0.46 : south ? 0.66 : 0.4
        if (keep > p) continue
        const r = nanmu
          ? 2.6 + rand() * 0.8
          : 3.4 + rand() * (south ? 2.2 : 1.6)
        if (!grid.freeDisk(px, pz, r + 0.6, block | F_NOTREE)) continue
        if (!grid.freeDisk(px, pz, r * 0.5, block)) continue
        if (nanmu) {
          addSpireTree(b, px, LAWN_Y, pz, {
            r,
            h: 12 + rand() * 5,
            trunkH: 5 + rand() * 3,
            color: C.nanmu[Math.floor(rand() * C.nanmu.length)],
            yaw: rand() * 6.28
          })
        } else {
          addTreeLite(b, px, LAWN_Y, pz, {
            r,
            sy: 1.1 + rand() * 0.25,
            trunkH: 3.2 + rand() * 2.8,
            color: C.forest[Math.floor(rand() * C.forest.length)],
            yaw: rand() * 6.28
          })
        }
        grid.disk(px, pz, r + 0.4, F_TREE)
      }
    }
  }

  // 竹丛顶点按颜色合成
  bufs.forEach((pos, i) => {
    if (pos.length) b.add(trianglesGeometry(pos), C.bamboo[i])
  })
}

/* ---------------- 步行路径 ---------------- */

/**
 * 步行路径（世界坐标，格式见 crowd.js）。宽度按两侧障碍扣除：
 * 门殿明间柱、连廊柱、花径墙身离可走带边缘 ≥ 0.8 m（身体带），台基、栏杆 ≥ 0.58 m（腿部带）。
 */
function buildWalkways(site) {
  const { U } = site
  const ws = []
  const add = (points, y, width, density, closed = false) =>
    ws.push({ points, y, width, closed, density })
  const P = (id) => pathById(id).pts
  const lowOf = (id) => pathY(pathById(id))
  // 1 中轴南段：草堂路 → 前场 → 正门明间 → 石桥 → 大廨前踏步前
  add(
    U([
      [-94.2, -17.5],
      [-86.5, -9.5],
      [-86.5, -3.5],
      [-72.5, -3.5],
      [-38.3, 0.2]
    ]),
    PAVE_Y,
    2.2,
    1.6
  )
  // 开放路径两端离踏步、墙 ≥ 1.4 m：端点沿路径方向外探 1 m 仍不碰障碍（crowd 校验方法）
  // 2 梅林甬道：大廨后踏步外 → 诗史堂前踏步前
  add(
    U([
      [-26.0, 0.3],
      [-6.9, 0.1]
    ]),
    PAVE_Y,
    2.2,
    1.6
  )
  // 3 中轴北段：诗史堂后 → 小桥 → 柴门明间 → 工部祠前踏步前
  add(
    U([
      [6.8, 1.15],
      [43.4, 1.15]
    ]),
    PAVE_Y,
    2.2,
    1.6
  )
  // 4、5 西、东连廊廊下（C 形，廊内地坪）
  const gy = PAVE_Y + GALLERY.floor
  add(
    U([
      [-32.5, -10.4],
      [-32.5, -15.4],
      [-0.9, -15.4],
      [-0.9, -10.8]
    ]),
    gy,
    1.4,
    1.3
  )
  add(
    U([
      [-31.1, 11.0],
      [-31.1, 16.5],
      [-1.5, 16.5],
      [-1.5, 10.8]
    ]),
    gy,
    1.4,
    1.3
  )
  // 6 诗史堂后 → 花径西口
  add(
    trimPolyline(U(P("toHuajing").slice(1)), 0.4, 2.6),
    lowOf("toHuajing"),
    2.0,
    1.2
  )
  // 7 花径（最密）：两墙内侧净距 3.5，身体离墙 ≥ 0.86
  add(
    trimPolyline(site.huajing, 0.8, 1.2),
    PAVE_Y,
    HUAJING.clear - 2 * (0.86 + 0.1),
    3.0
  )
  // 8 影壁小院 → 大雅堂前
  add(trimPolyline(site.yingbiPath, 0.4, 0.6), PAVE_Y - LOW, 2.0, 1.5)
  // 9 草堂寺中轴：南门外广场 → 南门明间 → 展厅前
  {
    const t = site.templeAxis
    add([t[0], t[1], shorten(t[2], t[1], 3.6)], PAVE_Y, 2.2, 1.5)
  }
  // 10 展厅后 → 大雅堂前
  {
    const t = site.templeAxis2
    add([shorten(t[0], t[1], 3.4), shorten(t[1], t[0], 4.0)], PAVE_Y, 2.2, 1.5)
  }
  // 11 柴门东 → 水竹居西 → 碑亭北 → 茅屋前 → 茅屋前池东
  add(
    trimPolyline(
      U(P("toMaowu").map((p, i) => (i === 0 ? [32.7, 2.3] : p))),
      0,
      0.8
    ),
    lowOf("toMaowu"),
    2.0,
    1.3
  )
  // 12 茅屋北 → 花径北侧
  add(trimPolyline(U(P("toHuajingN")), 0, 0.6), lowOf("toHuajingN"), 2.0, 1.0)
  // 13 梅园环路（闭合）
  add(U(P("meiLoop")), lowOf("meiLoop"), 2.0, 1.0, true)
  // 14 万佛楼环（闭合，r 15，台基外）
  add(site.wanfo.ring, site.wanfo.ringY, 2.0, 1.0, true)
  return ws
}

/** 开放折线两端各截掉 a / e 米 */
function trimPolyline(pts, a, e) {
  const total = polyLength(pts)
  return slicePolyline(pts, a, total - e)
}

/** 从 p 朝 q 方向移动 d 米（d < 0 时反向） */
function shorten(p, q, d) {
  const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
  return [p[0] + ((q[0] - p[0]) * d) / l, p[1] + ((q[1] - p[1]) * d) / l]
}

/* ---------------- 入口 ---------------- */

/**
 * @param {{ project, buildings, theme, spot }} ctx
 * @returns {{ meshes: Mesh[], zones: Array, markerHeight: number, walkways: Array }}
 */
export function build(ctx) {
  const site = createSite(ctx)
  buildGround(site)
  const markerHeight = buildAxis(site)
  buildMaowu(site)
  buildHuajing(site)
  buildMeiyuan(site)
  buildTemple(site)
  buildWanfo(site)
  buildOthers(site)
  buildFootways(site)
  buildWalls(site)
  buildBridges(site)
  const walkways = buildWalkways(site)
  plantAll(site, walkways)

  const meshes = []
  const g = site.b.bake()
  if (g) {
    const mesh = new Mesh(g, landmarkMaterial())
    // 调试信息只在显式开关 ctx.debug 时附加（Node 校验脚本用），生产构建不带
    if (ctx.debug)
      mesh.userData.layout = {
        solids: site.solids,
        water: site.debug.water,
        walls: site.debug.walls,
        bridges: site.bridges,
        paths: site.paths.map((p) => p.pts),
        generic: site.genericCount
      }
    meshes.push(mesh)
  }
  const gg = site.gb.bake()
  if (gg) {
    const mat = landmarkMaterial()
    mat.side = FrontSide
    meshes.push(new Mesh(gg, mat))
  }
  return { meshes, zones: site.zones, markerHeight, walkways }
}

/*
 * 武侯祠·锦里精细模型
 * ----------------------------------------------------------
 * 武侯祠（汉昭烈庙）坐北朝南，中轴方位约 3.5°（取刘备殿 OSM 轮廓的长边方位 − 90°）。
 * 由南向北：大门「汉昭烈庙」→ 二门「明良千古」→ 一进院东西碑亭 → 文臣廊 / 武将廊围合的二进院
 * → 刘备殿（主角，单檐歇山七间）→ 过厅（卷棚顶）→ 东西厢房与钟鼓楼围合的诸葛亮殿院
 * → 后园 → 三义庙（前殿 + 正殿，硬山青砖山墙）。
 * 西侧：惠陵（封土圆丘 + 石条护边 + 石板环道 + 青灰砖圆墙；陵前阙坊、寝殿、神道、惠陵大门、照壁），
 * 红墙夹道（两道朱红弧墙 + 墙外竹林，从诸葛亮殿西北绕到惠陵门前），西区林地。
 * 东侧与北侧：锦里古街（沿 OSM 中线两侧程序化排川西民居、街道上空红灯笼串、黄色幌子、
 * 南入口门楼、古戏台与小广场大树）、九品街、水岸锦里。
 *
 * 「中轴坐标系」(u, v)：原点在刘备殿 OSM 轮廓中心，u 沿中轴指向北（方位 AXIS），
 * v 垂直中轴指向东（方位 AXIS + 90°）；对应 frame(原点, AXIS) 的局部 x = v、z = −u
 * （局部 +Z 即朝南的正立面）。下文各殿的 [u0, u1, v0, v1] 是 OSM 轮廓换算到该坐标系的范围
 * （2026-09 数据，way id 见注释），平面按 OSM，只放大高度：屋顶与台基 ×1.3、脊饰与宝顶 ×1.5。
 *
 * 地面分两层（地面批单独一个 Mesh，单面材质，避免大平面自阴影波纹）：
 *   草地 / 锦里底面 LAWN_Y = 0.85；石板铺装（院落、甬道、街道、环道）PAVE_Y = 1.0。
 * 同高的铺装块在平面上互不重叠，避免共面闪烁；步行路径都落在铺装顶面上。
 *
 * 替换区：武侯祠范围（way 277942162）、锦里范围（way 837197354）与大门前广场（way 1203841531）
 * 内的 OSM 楼一律隐藏；范围内的楼除中轴殿堂等专门建模者外改成灰瓦坡顶房，锦里铺面整体程序化重排。
 * 东侧 3 栋 67～86 m 的高楼与其余景区外的楼保留。
 *
 * 随机数：锦里民居按所在位置播种（hashInts），OSM 楼按轮廓播种（shapeSeed），与数组下标无关。
 */
import { FrontSide, Mesh } from "three"
import { THEME } from "../theme.js"
import { hashInts, mulberry32, pointInPolygon, shapeSeed } from "../utils.js"
import { ColorBuilder, frame, landmarkMaterial, local } from "./kit/builder.js"
import {
  buildingsInZones,
  centroid,
  findBuilding,
  minAreaRect,
  polygonArea
} from "./kit/footprint.js"
import {
  box,
  cylinder,
  extrudePolygon,
  fromTriangles,
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
import {
  addBalustrade,
  addHall,
  addPitchedHouse,
  clamp,
  eaveDrop
} from "./kit/parts.js"
import { addTree } from "./kit/figures.js"

const L = THEME.landmark
const DEG = Math.PI / 180

/* ---------------- 尺度与高度 ---------------- */

// 中轴方位缺省值（刘备殿查不到时用）
const AXIS_BEARING = 3.5
// 草地 / 锦里底面顶面、石板铺装顶面（米）
const LAWN_Y = 0.85
const PAVE_Y = 1.0
// 次一级铺装（门前广场、支巷、戏台小广场）比主铺装低 LOW：两者搭接处不共面闪烁，
// 步行路径的高度校验容差 0.06 m 以内
const LOW = 0.03
// 城市地面高度（terrain.js 的 GROUND_Y）：底面挤出从这里起，边缘不悬空
const GROUND_Y = -0.5
// 插画式放大：屋顶与台基 ×1.3，脊饰与宝顶 ×1.5（平面不放大）
const K_ROOF = 1.3
const K_ORN = 1.5
// 随机种子（与其他景点区分）
const SEED = 20260930

/* ---------------- 本景点专用色 ---------------- */

const C = {
  lawn: "#86BD5A", // 院内草地
  pave: "#BDBAB2", // 院内灰石板
  axis: "#C99C84", // 中轴红砂石甬道
  redStone: "#B5725C", // 红砂石栏杆 / 花台
  platform: "#BFAEA2", // 殿堂台基（偏红的砂石）
  column: "#8E2F27", // 殿堂深红柱
  gateColumn: "#6E2A24", // 大门深红褐柱
  hallWall: "#9A3B2F", // 殿堂墙身
  vermilion: "#B8352B", // 朱红院墙
  corridor: "#C0443A", // 红墙夹道墙身
  capGrey: "#3E434A", // 红墙墙帽深灰
  glazeGreen: "#3F9E78", // 墙帽绿琉璃筒瓦
  bamboo: ["#7DBA45", "#5E9E3A", "#93C64E"], // 竹林（比柏树亮一大截，衬出红墙）
  cypress: ["#2F5E3A", "#3A6B3E", "#2B5536", "#44744A"], // 柏树
  moundGrass: "#6E9A4A", // 封土
  moundTrees: ["#3E7A3C", "#4F8A42", "#2F6534"],
  curb: "#9AA0A0", // 石条护边
  greyBrick: "#7A7F84", // 惠陵青灰砖墙
  door: "#2A2522", // 黑色门扇
  plaque: "#A8231C", // 红底匾
  plaqueDark: "#2E2A28", // 暗底匾
  stele: "#4A4E52", // 石碑
  figure: "#A7ACB2", // 屋脊灰塑
  street: "#9E9A92", // 锦里青石板街面
  jlBase: "#C8C0B0", // 锦里院落底面
  timberLight: "#7A5A3E", // 锦里木构浅色
  banner: "#E8C23A", // 黄色幌子
  lantern: "#D8433A", // 红灯笼
  houseRidge: "#8E959E", // 民居正脊浅灰勾线
  stageWood: "#6E3A2E", // 戏台台身
  stageScreen: "#E3CD8F", // 戏台彩绘屏
  genericWall: "#9C4A3C" // 园内附属房墙身（深红木色）
}

/* ---------------- OSM 几何（经纬度，WGS84） ---------------- */

// 武侯祠范围 way 277942162（首尾不重复）。下标 17 为南边界东段（大门西侧）、18 为东南角、
// 19～22 为东边界、23 为东北角：东边界在构建时换成院墙折线（见 build 里的 compound）
const WH_LL = [
  [104.045562, 30.650037],
  [104.045015, 30.649197],
  [104.044832, 30.649138],
  [104.044634, 30.648808],
  [104.044538, 30.648629],
  [104.044423, 30.648417],
  [104.043691, 30.647266],
  [104.043615, 30.647156],
  [104.044498, 30.646735],
  [104.044906, 30.646827],
  [104.045084, 30.646861],
  [104.045078, 30.64696],
  [104.045127, 30.646965],
  [104.045173, 30.646964],
  [104.045288, 30.646873],
  [104.045325, 30.646877],
  [104.046594, 30.647012],
  [104.04687, 30.647039],
  [104.047194, 30.647031],
  [104.047299, 30.648468],
  [104.047216, 30.64857],
  [104.047241, 30.648849],
  [104.047246, 30.648901],
  [104.047218, 30.649713],
  [104.046285, 30.649876]
]
// 锦里范围 way 837197354 的外侧部分：东南角 → 东边界 → 北端 → 西北角（其余边与武侯祠共用）
const JL_OUTER_LL = [
  [104.047613, 30.647216],
  [104.047513, 30.647385],
  [104.047593, 30.650111],
  [104.046461, 30.650583]
]
// 大门前广场 way 1203841531
const PLAZA_LL = [
  [104.046714, 30.647013],
  [104.046744, 30.646942],
  [104.046739, 30.646916],
  [104.046732, 30.646872],
  [104.046943, 30.646868],
  [104.046992, 30.64689],
  [104.047237, 30.646999],
  [104.04716, 30.647043],
  [104.047115, 30.647051],
  [104.047063, 30.647054],
  [104.04688, 30.647056],
  [104.046859, 30.647057]
]
// 西区水池 way 277942161（草地在这里开洞，露出城市水面）
const POND_LL = [
  [104.044496, 30.648076],
  [104.044448, 30.64797],
  [104.044336, 30.648027],
  [104.04429, 30.647961],
  [104.04434, 30.647944],
  [104.044282, 30.647827],
  [104.044216, 30.647853],
  [104.044117, 30.647703],
  [104.044168, 30.647583],
  [104.044336, 30.647474],
  [104.044766, 30.647364],
  [104.044781, 30.647637],
  [104.044915, 30.647797],
  [104.044708, 30.647934],
  [104.044645, 30.647958],
  [104.044591, 30.648054],
  [104.044602, 30.648131],
  [104.044652, 30.648206],
  [104.044746, 30.648222],
  [104.044867, 30.648164],
  [104.044952, 30.648155],
  [104.045012, 30.648188],
  [104.044894, 30.648236],
  [104.044828, 30.64829],
  [104.044703, 30.648283],
  [104.044625, 30.648251],
  [104.044566, 30.648178]
]
// 红墙夹道：OSM 游览路线 way 786214416 中从诸葛亮殿西北到惠陵门前的一段（约 128 m 的 S 形弯）
const CORRIDOR_LL = [
  [104.046502, 30.648877],
  [104.046492, 30.648811],
  [104.046451, 30.648722],
  [104.046409, 30.64862],
  [104.046347, 30.648601],
  [104.046307, 30.648568],
  [104.046261, 30.648521],
  [104.046244, 30.64847],
  [104.046191, 30.648198],
  [104.046144, 30.648135],
  [104.046053, 30.648067],
  [104.045978, 30.648028],
  [104.045825, 30.648008]
]
// 锦里古街中线 way 116428407（南入口在武侯祠大街上；北端拐角处两个几乎共线的短折点已并掉）
const MAIN_LL = [
  [104.047574, 30.647046],
  [104.047457, 30.647216],
  [104.047508, 30.648611],
  [104.047517, 30.649812],
  [104.047286, 30.6498],
  [104.046735, 30.64985]
]
// 九品街 way 116428413
const JIUPIN_LL = [
  [104.047508, 30.648611],
  [104.047359, 30.64873],
  [104.047275, 30.64885],
  [104.047301, 30.649343],
  [104.047289, 30.649685],
  [104.047286, 30.6498]
]
// 水岸锦里：way 618883896 + 116428404
const SHUIAN_LL = [
  [104.047286, 30.6498],
  [104.047306, 30.650176],
  [104.047156, 30.650281],
  [104.046944, 30.65027],
  [104.046773, 30.650358],
  [104.046493, 30.650422]
]
// 文物区与西区之间的界墙 way 1203841940（南端即武侯祠范围西南角）
const WEST_WALL_LL = [
  [104.045325, 30.646877],
  [104.045406, 30.647653],
  [104.045424, 30.64782],
  [104.045473, 30.648477],
  [104.045513, 30.648563],
  [104.045556, 30.648615],
  [104.045618, 30.648665],
  [104.04566, 30.648702]
]
// 惠陵封土中心（relation 17553101，外环 way 486080922 的圆心）
const HUILING_LL = [104.045837, 30.648304]

/* ---------------- 中轴殿堂布局（中轴坐标 [u0, u1, v0, v1]，米） ---------------- */

const LAYOUT = {
  // 大门「汉昭烈庙」（way 1203841522 只画了门洞 9.9 × 4.7；按照片取 3 开间 14 × 6，中线对中轴）
  gate: [-117.6, -111.6, -7, 7],
  // 二门「明良千古」（way 1203841548）与两侧配房（1203841544 / 1203841545）
  ermen: [-57.8, -49, -6.1, 6.1],
  ermenE: [-56.4, -49.6, 6.1, 27.1],
  ermenW: [-56.3, -49.7, -25.7, -6.1],
  // 一进院碑亭：唐碑（三绝碑，1203841549）/ 明碑（1203841550）
  steleE: [-82.8, -77, 18.8, 24.8],
  steleW: [-81.7, -76, -21.3, -15.3],
  // 武将廊（西，1203841547）/ 文臣廊（东，1203841546）
  galleryW: [-49.7, -3.7, -29.2, -19.3],
  galleryE: [-49.7, -0.1, 19.3, 29.2],
  // 刘备殿 way 653532200（38.7 × 18.7，原点）
  liubei: [-9.33, 9.33, -19.34, 19.34],
  // 过厅 way 653532216
  guoting: [17.7, 27.6, -6.6, 6.6],
  // 东西厢房（way 653532217 / 653532218 均为 L 形：过厅两侧一排 + 沿院子两侧的厢房）
  wingEa: [17.6, 24.3, 6.6, 28],
  wingEb: [24.3, 38.8, 18.3, 28],
  wingWa: [17.9, 25, -32.6, -6.6],
  wingWb: [25, 39.2, -32.5, -20.5],
  // 钟楼（东）/ 鼓楼（西）：诸葛亮殿前两角，OSM 未单独画出
  bell: [40.5, 46.5, 12.2, 18.2],
  drum: [40.5, 46.5, -20.2, -14.2],
  // 诸葛亮殿 way 653532215
  zhuge: [47.4, 62, -13.7, 10.4],
  // 三义庙前殿（653532214）与正殿（653532212）
  sanyiFront: [105, 116.8, -13.5, 10.8],
  sanyi: [116.8, 133.1, -13.6, 10.7]
}

// 中轴建筑的真实高度（米，未放大）：eave 檐口（离铺装面）、roof 屋顶高、plat 台基高
const HEIGHTS = {
  gate: { eave: 5.5, roof: 2.5, plat: 0.35 },
  ermen: { eave: 5.3, roof: 2.5, plat: 0.35 },
  side: { eave: 4, roof: 1.2 },
  stele: { eave: 3.2, roof: 2, plat: 0.3 },
  gallery: { eave: 4.5, roof: 2.4, plat: 0.35 },
  liubei: { eave: 7, roof: 5, plat: 1.2 },
  guoting: { eave: 5.2, roof: 2.5, plat: 0.5 },
  wing: { eave: 4.5, roof: 2.5, plat: 0.35 },
  tower: { eave: 4.4, plat: 0.5 },
  zhuge: { eave: 6, roof: 4, plat: 1 },
  sanyi: { eave: 5.5, roof: 3.5, plat: 0.5 }
}

/* ---------------- 惠陵（中轴坐标；陵轴与中轴平行，v = HL_V） ---------------- */

const HL_V = -105.6
const HUILING = {
  moundR: 22.5, // 封土底半径（OSM 石条护边直径 41 m，插画放大到 45 m）
  moundH: 15, // 封土高（资料 12 m，插画放大）
  curbH: 1.2, // 石条护边高（离铺装面）
  curbT: 0.6, // 护边厚
  wallR: 27.5, // 砖墙内侧半径（环道 23.1～27.5，约 4.4 m 宽）
  wallT: 0.8, // 砖墙厚（外径约 56.6 m，对上资料「周长 180 m」）
  wallH: 3, // 砖墙高（离铺装面）
  gapHalf: 2.2, // 砖墙南侧开口半宽
  queFang: -20.5, // 阙坊（碑亭式）中心 u
  forecourt: [-26.5, -14.5, -114, -98.5], // 陵前小院铺装（东缘让开古柏斋）
  qinDian: [-34, -26, HL_V - 5.5, HL_V + 5.5], // 寝殿 11 × 8
  gate: [-56.2, -52, HL_V - 5.5, HL_V + 5.5], // 惠陵大门 way 1203841496（11 × 4）
  zhaobi: -67, // 照壁中心 u
  shendao: [-66.3, -34, HL_V - 2, HL_V + 2] // 神道铺装（南端接到照壁）
}

/* ---------------- 院墙（中轴坐标折线） ---------------- */

// 东院墙：文臣廊背后 → 厢房东北角外斜折 → 沿武侯祠东边界到东北角（九品街西侧）
const EAST_WALL = [
  [-115.5, 30],
  [41, 30],
  [50, 23.1],
  [88, 23.1],
  [177.4, 15.4]
]
// 南院墙：东南角 → 大门东侧；大门西侧 → 一进院西南角 → 沿范围南边界到西南角（与界墙相接）
const SOUTH_WALL_E = [
  [-115.5, 30],
  [-115.5, 7.2]
]
const SOUTH_WALL_W = [
  [-115.5, -7.2],
  [-115.5, -31],
  [-125.3, -31],
  [-146.6, -146.1]
]
// 一进院、二进院西侧的内院墙（止于西厢房前）
const INNER_WEST_WALL = [
  [-115.5, -31],
  [16.5, -31]
]
// 院墙：墙身高（离地面）、厚；墙帽宽
const WALL = { h: PAVE_Y + 4, t: 0.7, cap: 1.1 }
// 界墙在南北向园路 way 1203841516 处开的门洞（中轴坐标 u、半宽）
const WEST_WALL_GAP = { u: -60.4, half: 2.2 }

/* ---------------- 红墙夹道 ---------------- */

const CORRIDOR = {
  clear: 3.5, // 两墙内侧净距
  t: 0.5, // 墙厚
  h: 4.5, // 墙高（离铺装面，插画放大）
  capW: 0.9, // 深灰墙帽宽
  capH: 0.3,
  glazeW: 0.5, // 绿琉璃筒瓦
  glazeH: 0.25,
  endV: -97.8, // 南端：进入陵前小院前截止（小院东缘 v = -98.5）
  bambooOff: 3.7, // 竹林带中线离路径中线
  bambooStep: 2.1, // 竹丛间距
  bambooH: [8.5, 10.5], // 竹丛高
  bambooR: 1.6 // 竹丛冠幅半径
}

/* ---------------- 锦里 ---------------- */

const JINLI = {
  mainW: 5, // 主街宽（墙到墙）
  laneW: 3.5, // 九品街宽
  shuianW: 4.5, // 水岸锦里巷宽（两侧都有房，比九品街宽一些）
  eave1: 4, // 单层檐口（离街面）
  eave2: 7, // 两层檐口
  ridgeH: 2.5, // 屋脊高出檐口
  overhang: 0.8, // 主街出檐
  laneOverhang: 0.5, // 支巷出檐
  depth: [8, 12], // 进深
  front: [6, 12], // 沿街面宽（一栋 1～2 开间）
  backGap: 1.5, // 前后两排之间的天井
  lanternStep: 8.5, // 灯笼串间距
  lanternR: 0.42,
  lanternY: 4.95, // 灯笼球心离街面（最低点约 4.59 m，高于 4.35 m 头顶净空）
  stringY: 5.35 // 灯笼串绳离街面
}
// 沿街民居在街道折点两侧让出的长度（米）
const BEND_GAP = 3
// 南入口门楼：沿主街第一段离街口（武侯祠大街中线）的距离（米）
const JL_GATE_T = 13.5
// 主街从街口起铺装的距离：武侯祠大街路缘半宽 8 m 之外
const JL_STREET_T0 = 7.5
// 古戏台与小广场（中轴坐标）：台面宽沿 u、朝东（+v）对着主街
const STAGE = { u: 19.5, v: 35, w: 10, d: 8, plazaU: [11.5, 27.5] }

// 门洞 / 过厅明间 / 门楼门洞的净高（离铺装面）：高于小人头顶净空 4.35 m
const PASS_H = 4.5

// 小人分部件净距（见 crowd 设计文档「校验方法」：头部带 0.52、身体带 0.86）
const BODY_CLEAR = 0.86
// 屋檐、腰檐外沿（离街面 3.7～4.0 m，在头部带里）离可走带边缘的净距：
// 按小人身体半径 0.8 m（人群整体外扩校验 BODY = 0.8）再留 0.12 m
// （校验把 0.08 m 内的竖直面算作碰到），比头部带要求的 0.52 m 更严
const EAVE_CLEAR = 0.92

/* ---------------- 几何小工具 ---------------- */

/** 中轴坐标系 */
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

/** 折线长度 */
function polyLength(pts) {
  let s = 0
  for (let i = 1; i < pts.length; i++) {
    s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
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

/** 按弧长等距重采样折线（步长 step，保留终点） */
function resample(pts, step) {
  const total = polyLength(pts)
  const n = Math.max(1, Math.round(total / step))
  const out = []
  let seg = 0
  let acc = 0
  for (let k = 0; k <= n; k++) {
    const target = (total * k) / n
    while (
      seg < pts.length - 2 &&
      acc +
        Math.hypot(
          pts[seg + 1][0] - pts[seg][0],
          pts[seg + 1][1] - pts[seg][1]
        ) <
        target
    ) {
      acc += Math.hypot(
        pts[seg + 1][0] - pts[seg][0],
        pts[seg + 1][1] - pts[seg][1]
      )
      seg++
    }
    const a = pts[seg]
    const b = pts[seg + 1]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const t = Math.min(1, Math.max(0, (target - acc) / l))
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
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

/** 折线整体侧移 d（沿逐点法向） */
function offsetLine(pts, d) {
  const ns = normals(pts)
  return pts.map(([x, z], i) => [x + ns[i][0] * d, z + ns[i][1] * d])
}

/** [x, z] 折线 → sweepBar 用的 [x, y, z] */
const lift = (pts, y) => pts.map(([x, z]) => [x, y, z])

/**
 * 带斜接的路面带：沿折线 pts（[x, z]）铺宽 w、从 y0 到 y1 的实心带（顶面 + 两侧面 + 两端封口）。
 * 折点处两侧边线按斜接（miter）求交，急弯外角不缺块、内角不重叠（kit 的 sweepBar 在折点只取
 * 相邻两段的平均法向，90° 弯处路面会扭成窄条）；斜接长度限制在 2.5 倍半宽以内。
 */
function ribbon(pts, w, y0, y1) {
  const n = pts.length
  const seg = []
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0]
    const dz = pts[i + 1][1] - pts[i][1]
    const l = Math.hypot(dx, dz) || 1
    seg.push([-dz / l, dx / l])
  }
  const side = pts.map((p, i) => {
    const a = seg[Math.max(0, i - 1)]
    const c = seg[Math.min(n - 2, i)]
    let mx = a[0] + c[0]
    let mz = a[1] + c[1]
    const ml = Math.hypot(mx, mz) || 1
    mx /= ml
    mz /= ml
    // 斜接长度 = 半宽 / cos(半转角)
    const k = Math.min(2.5, 1 / Math.max(0.4, mx * c[0] + mz * c[1]))
    return [mx * (w / 2) * k, mz * (w / 2) * k]
  })
  const L0 = pts.map(([x, z], i) => [x + side[i][0], z + side[i][1]])
  const R0 = pts.map(([x, z], i) => [x - side[i][0], z - side[i][1]])
  const pos = []
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d)
  const v3 = ([x, z], y) => [x, y, z]
  for (let i = 0; i < n - 1; i++) {
    quad(v3(L0[i], y1), v3(L0[i + 1], y1), v3(R0[i + 1], y1), v3(R0[i], y1))
    quad(v3(L0[i], y0), v3(L0[i + 1], y0), v3(L0[i + 1], y1), v3(L0[i], y1))
    quad(v3(R0[i], y1), v3(R0[i + 1], y1), v3(R0[i + 1], y0), v3(R0[i], y0))
  }
  quad(v3(R0[0], y0), v3(L0[0], y0), v3(L0[0], y1), v3(R0[0], y1))
  quad(
    v3(L0[n - 1], y0),
    v3(R0[n - 1], y0),
    v3(R0[n - 1], y1),
    v3(L0[n - 1], y1)
  )
  return fromTriangles(pos)
}

/** 5 边圆锥（无底，顶点汇于一点，不产生退化三角形） */
function cone(sides, r, h) {
  const pos = []
  for (let k = 0; k < sides; k++) {
    const a0 = Math.PI / sides + (k * 2 * Math.PI) / sides
    const a1 = a0 + (2 * Math.PI) / sides
    pos.push(
      r * Math.sin(a0),
      0,
      r * Math.cos(a0),
      r * Math.sin(a1),
      0,
      r * Math.cos(a1),
      0,
      h,
      0
    )
  }
  return fromTriangles(pos)
}

/** 水平圆环面（只有顶面），圆心 (0, y, 0)，半径 r0～r1，seg 段 */
function annulus(r0, r1, y, seg) {
  const pos = []
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2
    const a1 = ((k + 1) / seg) * Math.PI * 2
    const p = (r, a) => [r * Math.cos(a), y, r * Math.sin(a)]
    const A = p(r0, a0)
    const B = p(r1, a0)
    const Cc = p(r1, a1)
    const D = p(r0, a1)
    // 顶点顺序使法线朝上（从上往下看顺时针，Z 向南）
    pos.push(...A, ...Cc, ...B, ...A, ...D, ...Cc)
  }
  return fromTriangles(pos)
}

/**
 * 卷棚顶：屋面横截面圆顺起拱、没有正脊（过厅的辨识特征）。
 * 局部坐标同 kit 屋顶：檐口在 y = 0，屋面沿 X 贯通（两端各出挑 overhang），Z 为进深。
 * 截面：t = 1 − |z| / ez，y = h·(t^1.3 − a·t^6) / (1 − a)，a = 1.3 / 6
 * ——檐口平缓外挑（与 kit 悬山同样的凹曲线），到顶部斜率恰好归零，脊部浑圆。
 * @returns {{ roof: BufferGeometry, ends: BufferGeometry }} 屋面（含封檐板）与两端山面
 */
function rollRoof(w, d, h, overhang, seg = 12) {
  const ex = w / 2 + overhang
  const ez = d / 2 + overhang
  const a = 1.3 / 6
  const yAt = (z) => {
    const t = Math.max(0, 1 - Math.abs(z) / ez)
    return (h * (Math.pow(t, 1.3) - a * Math.pow(t, 6))) / (1 - a)
  }
  const prof = []
  for (let i = 0; i <= seg; i++) {
    const z = ez - (2 * ez * i) / seg
    prof.push([z, yAt(z)])
  }
  const pos = []
  for (let i = 0; i < seg; i++) {
    const [z0, y0] = prof[i]
    const [z1, y1] = prof[i + 1]
    pos.push(-ex, y0, z0, ex, y0, z0, ex, y1, z1)
    pos.push(-ex, y0, z0, ex, y1, z1, -ex, y1, z1)
  }
  // 前后檐口封檐板
  const th = Math.max(0.1, 0.05 * h)
  for (const z of [ez, -ez]) {
    pos.push(-ex, 0, z, ex, 0, z, ex, -th, z)
    pos.push(-ex, 0, z, ex, -th, z, -ex, -th, z)
  }
  // 两端山面（墙线处 x = ±w/2，z 在墙内 ±d/2）：以底边中点为扇心
  const ends = []
  const inner = prof.filter(([z]) => Math.abs(z) <= d / 2 + 1e-6)
  for (const x of [-w / 2, w / 2]) {
    const poly = [[d / 2, 0], [d / 2, yAt(d / 2)], ...inner, [-d / 2, 0]]
    for (let i = 0; i < poly.length - 1; i++) {
      ends.push(
        x,
        0,
        0,
        x,
        poly[i][1],
        poly[i][0],
        x,
        poly[i + 1][1],
        poly[i + 1][0]
      )
    }
  }
  return { roof: fromTriangles(pos), ends: fromTriangles(ends) }
}

/**
 * 单坡顶（二门两侧配房）：局部 X 沿长边，前檐（+Z）低、后墙（−Z）高 rise；
 * 墙顶在 y = 0，屋面在前墙线处正好等于墙顶、向前出挑 overhang（檐口略低于墙顶）。
 * @returns {{ roof: BufferGeometry, ends: BufferGeometry }} 屋面，与两端三角山面 + 后墙高出部分
 */
function shedRoof(w, d, rise, overhang) {
  const x = w / 2 + overhang
  const zf = d / 2 + overhang
  const zb = -d / 2
  const yf = (-rise * overhang) / d // 前檐比墙顶略低
  const roof = [-x, yf, zf, x, yf, zf, x, rise, zb]
  roof.push(-x, yf, zf, x, rise, zb, -x, rise, zb)
  // 两端三角山面（x = ±w/2）与后墙高出墙顶的一条（z = −d/2）
  const hw = w / 2
  const ends = [-hw, 0, d / 2, -hw, 0, zb, -hw, rise, zb]
  ends.push(hw, 0, d / 2, hw, rise, zb, hw, 0, zb)
  ends.push(-hw, 0, zb, hw, 0, zb, hw, rise, zb, -hw, 0, zb, hw, rise, zb)
  ends.push(-hw, rise, zb)
  return { roof: fromTriangles(roof), ends: fromTriangles(ends) }
}

/* ---------------- 构件 ---------------- */

/**
 * 宝顶（简化版，约 60 个三角形）：6 棱底座 + 球 + 尖锥，底在 m 的 y = 0，总高 h。
 * kit 的 finial 约 300 个三角形，本景点要放十来个，预算吃不消；300 m 外看轮廓已足够。
 */
function addFinial(b, m, h, color) {
  b.add(prism(6, 0.16 * h, 0.12 * h, 0.18 * h, { top: false }), color, m)
  b.add(sphere(0.19 * h, 6, 4), color, local(m, 0, 0.14 * h, 0))
  b.add(cone(6, 0.08 * h, 0.5 * h), color, local(m, 0, 0.5 * h, 0))
}

/**
 * 矩形轮廓的灰瓦坡顶房（园内附属房）：墙体盒子 + 低细分悬山顶，约 60 个三角形。
 * kit 的 addPitchedHouse 约 170 个三角形，只在轮廓不规整（需要切块）时才用。
 */
function addBlockHouse(b, rect, o) {
  const { eave, ridgeH, overhang, wall } = o
  // 屋脊沿局部 X（长边）：frame 的局部 +X 指向 bearing + 90°，故传 bearing − 90
  const f = frame(rect.cx, 0, rect.cz, rect.bearing - 90)
  b.add(box(rect.w, eave, rect.d), wall, f)
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
}

/**
 * 简化灯笼（20 个三角形）：压扁的红色低细分球，(x, y, z) 为球心（父坐标系），
 * 最低点在 y − 0.85r。kit 的 addLantern 约 180 个三角形，锦里要挂近百个，预算吃不消。
 */
function addLanternLite(b, parent, x, y, z, r) {
  b.add(
    sphere(r, 5, 3),
    C.lantern,
    local(parent, x, y - r * 0.85, z, 0, 1, 0.85)
  )
}

/**
 * 悬山顶正脊两端的一对上翘脊头（吻）。m 为屋顶坐标系（檐口 y = 0），
 * w / h / overhang 同 gableRoof；k 为脊饰放大倍数。返回局部最高点 y。
 */
function addRidgeEnds(b, m, w, h, overhang, k = K_ORN, color = L.roofRidge) {
  const x = w / 2 + overhang - 0.15 * k
  for (const sx of [-1, 1]) {
    b.add(box(0.3 * k, 0.6 * k, 0.3 * k), color, local(m, sx * x, h, 0))
    // 脊头向外挑出的一小段，形成翘起的剪影
    b.add(
      box(0.35 * k, 0.16 * k, 0.26 * k),
      color,
      local(m, sx * (x + 0.2 * k), h + 0.45 * k, 0)
    )
  }
  return h + 0.6 * k
}

/**
 * 悬山顶（屋面、山面、正脊一次加好）：w × d 为柱网 / 墙体围合，屋脊沿局部 X。
 * f 的 y = 0 为铺装面；eave 为柱顶（离铺装面），roofH 为屋顶高。
 * @returns {{ m: Matrix4, top: number, ridgeY: number }} 屋顶坐标系、最高点、正脊顶面高度
 */
function addGable(b, f, o) {
  const { w, d, eave, roofH, overhang = 1, wall = C.hallWall } = o
  const go = {
    overhang,
    segS: o.segS ?? 1,
    segT: o.segT ?? 4,
    ridges: false,
    gables: false
  }
  const y = eave - eaveDrop(d / 2, overhang, roofH, 1.3, o.margin ?? 0.4)
  const m = local(f, 0, y, 0)
  b.add(gableRoof(w, d, roofH, go), o.roof ?? L.roof, m)
  b.add(gableWalls(w, d, roofH, go), wall, m)
  b.add(gableRidge(w, d, roofH, go), o.ridge ?? L.roofRidge, m)
  // 正脊顶面：gableRidge 高 max(0.15, 0.08h) + 0.03h，底在 0.97h
  const ridgeY = y + roofH + Math.max(0.15, 0.08 * roofH)
  let top = ridgeY
  if (o.ends !== false) top = y + addRidgeEnds(b, m, w, roofH, overhang)
  return { m, top, ridgeY, y }
}

/**
 * 三开间门屋（大门、二门、惠陵大门）：明间敞开可穿行（地面即铺装面，门洞净高 ≥ PASS_H），
 * 次间坐在矮台基上，朱红墙面 + 黑色门扇；柱顶额枋、正面红底金字匾色块；悬山顶 + 脊中宝顶。
 * f 为门屋坐标系（+Z 朝南 / 朝外，y = 0 为铺装面）。
 * @param {object} o { w, d, mid（明间面阔）, eave, roofH, plat, column, wall }
 * @returns {number} 最高点（局部）
 */
function addGatehouse(b, f, o) {
  const { w, d, mid, eave, roofH, plat } = o
  const col = o.column ?? C.gateColumn
  const wall = o.wall ?? C.vermilion
  const side = (w - mid) / 2
  const cz = d / 2 - 0.5
  // 次间台基（明间不设台基，门洞地面与铺装齐平）
  for (const sx of [-1, 1]) {
    b.add(
      box(side, plat + 0.2, d),
      C.platform,
      local(f, sx * (mid / 2 + side / 2), -0.2, 0)
    )
  }
  // 前后两排柱：明间两柱 + 两端角柱
  for (const x of [-w / 2 + 0.35, -mid / 2, mid / 2, w / 2 - 0.35]) {
    for (const z of [cz, -cz]) {
      b.add(cylinder(0.32, 0.29, eave, { segments: 6 }), col, local(f, x, 0, z))
    }
  }
  // 次间：门扇所在的一道墙（进深中部）+ 前面一对黑色门扇
  for (const sx of [-1, 1]) {
    const x = sx * (mid / 2 + side / 2)
    b.add(box(side - 0.5, eave - plat, 0.5), wall, local(f, x, plat, 0))
    b.add(box(side * 0.55, 3.2, 0.12), C.door, local(f, x, plat, 0.3))
  }
  // 明间门洞净高 PASS_H：门洞以上的走马板、额枋、匾额底边都不低于它（行人从明间穿过）
  const t0 = Math.max(PASS_H, eave - 0.9)
  b.add(box(mid, eave - t0, 0.5), wall, local(f, 0, t0, 0))
  // 柱顶一圈额枋（前后各一道）
  for (const z of [cz, -cz]) {
    b.add(box(w, 0.5, 0.35), L.lattice, local(f, 0, eave - 0.5, z))
  }
  // 红底金字匾：金边在后、红底在前，挂在前檐额枋前（上沿不高出檐口太多，免得戳出屋面）
  const ph = Math.min(1.15, eave + 0.05 - PASS_H)
  const py = Math.max(PASS_H, eave - 0.95)
  b.add(box(3.1, ph, 0.12), L.gold, local(f, 0, py, cz + 0.25))
  b.add(box(2.7, ph - 0.3, 0.12), C.plaque, local(f, 0, py + 0.15, cz + 0.33))
  // 悬山顶 + 脊中宝顶
  const g = addGable(b, f, {
    w: w - 0.7,
    d: d - 1,
    eave,
    roofH,
    overhang: 1.1,
    wall
  })
  const fh = 0.9 * K_ORN
  addFinial(b, local(f, 0, g.ridgeY - 0.1, 0), fh, L.roofRidge)
  return Math.max(g.top, g.ridgeY - 0.1 + fh)
}

/**
 * 碑亭：矮台基 + 四柱 + 石碑（龟趺座）+ 单檐歇山小顶 + 宝顶。f 同上。
 */
function addStelePavilion(b, f, o) {
  const { w, d } = o
  const H = HEIGHTS.stele
  const plat = H.plat * K_ROOF
  b.add(box(w, plat + 0.2, d), C.platform, local(f, 0, -0.2, 0))
  const cw = w - 1.2
  const cd = d - 1.2
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.add(
        cylinder(0.25, 0.22, H.eave, { segments: 6 }),
        C.column,
        local(f, (sx * cw) / 2, plat, (sz * cd) / 2)
      )
    }
  }
  b.add(box(1.8, 0.5, 1.2), L.granite, local(f, 0, plat, 0))
  b.add(box(1.3, 2.4, 0.4), C.stele, local(f, 0, plat + 0.5, 0))
  const roofH = H.roof * K_ROOF
  const ro = { overhang: 0.9, curl: 0.45, ridge: 0.45, segS: 4, segT: 3 }
  const y = plat + H.eave - eaveDrop(cd / 2, 0.9, roofH, 1.5, 0.3)
  const m = local(f, 0, y, 0)
  b.add(hipRoof(cw, cd, roofH, { ...ro, ridges: false }), L.roof, m)
  b.add(hipRidges(cw, cd, roofH, ro), L.roofRidge, m)
  addFinial(b, local(f, 0, y + roofH * 1.05, 0), 0.7 * K_ORN, L.roofRidge)
}

/**
 * 廊庑（文臣廊 / 武将廊）：通长矮台基、实心后墙与两端山墙、面向院子一侧敞开，
 * 连排深红柱（柱距约 4 m）+ 额枋；悬山灰瓦顶。f 的局部 X 沿廊长、+Z 朝院子。
 * 廊内地面高 plat（步行路径走廊下）。
 */
function addGallery(b, f, o) {
  const { len, dep } = o
  const H = HEIGHTS.gallery
  const plat = H.plat * K_ROOF
  b.add(box(len, plat + 0.2, dep), L.granite, local(f, 0, -0.2, 0))
  // 后墙、两端山墙（从台基下起，顶藏进屋面下）
  b.add(
    box(len, H.eave + 0.2, 0.5),
    C.hallWall,
    local(f, 0, 0, -dep / 2 + 0.25)
  )
  for (const sx of [-1, 1]) {
    b.add(
      box(0.5, H.eave, dep - 0.5),
      C.hallWall,
      local(f, sx * (len / 2 - 0.25), 0, 0.25)
    )
  }
  // 前檐柱列 + 额枋
  const cz = dep / 2 - 0.5
  const n = Math.max(2, Math.round((len - 1) / 4))
  for (let k = 0; k <= n; k++) {
    const x = -len / 2 + 0.5 + (k * (len - 1)) / n
    b.add(
      cylinder(0.26, 0.23, H.eave - plat, { segments: 6 }),
      C.column,
      local(f, x, plat, cz)
    )
  }
  b.add(box(len, 0.45, 0.35), L.lattice, local(f, 0, H.eave - 0.45, cz))
  addGable(b, f, {
    w: len - 0.4,
    d: dep - 0.8,
    eave: H.eave,
    roofH: H.roof * K_ROOF,
    overhang: 0.9,
    ends: false
  })
}

/**
 * 简化殿屋（厢房、寝殿等单层悬山房）：矮台基 + 退后的墙体 + 前檐柱列（留出前廊）
 * + 正面花格门窗色带 + 悬山顶。f 的局部 X 沿面阔、+Z 为正面，y = 0 为铺装面。
 * @returns {number} 最高点（局部）
 */
function addSideHall(b, f, o) {
  const { w, d, eave, roofH, plat } = o
  const porch = o.porch ?? 1.6
  b.add(box(w, plat + 0.2, d), C.platform, local(f, 0, -0.2, 0))
  // 墙体从台基顶起，前面让出前廊
  const wd = d - 0.8 - porch
  b.add(
    box(w - 0.8, eave - plat, wd),
    o.wall ?? C.hallWall,
    local(f, 0, plat, -porch / 2)
  )
  b.add(
    box((w - 0.8) * 0.9, (eave - plat) * 0.7, 0.1),
    L.lattice,
    local(f, 0, plat, wd / 2 - porch / 2 + 0.05)
  )
  const cz = d / 2 - 0.5
  const n = Math.max(2, Math.round((w - 1) / 3.6))
  for (let k = 0; k <= n; k++) {
    b.add(
      cylinder(0.24, 0.22, eave - plat, { segments: 6 }),
      o.column ?? C.column,
      local(f, -w / 2 + 0.5 + (k * (w - 1)) / n, plat, cz)
    )
  }
  b.add(box(w - 0.6, 0.4, 0.3), L.lattice, local(f, 0, eave - 0.4, cz))
  return addGable(b, f, {
    w: w - 0.6,
    d: d - 0.8,
    eave,
    roofH,
    overhang: o.overhang ?? 0.9
  }).top
}

/**
 * 钟楼 / 鼓楼：方形两层、重檐四角攒尖，翼角高翘（curl 0.6），金色宝顶。
 * 下层实心墙身 + 四角柱，上层内收的木构楼身。f 同上，s 为台基边长。
 */
function addBellTower(b, f, s) {
  const H = HEIGHTS.tower
  const plat = H.plat * K_ROOF
  b.add(box(s, plat + 0.2, s), C.platform, local(f, 0, -0.2, 0))
  const a = s - 1.2 // 下层柱网边长
  b.add(box(a - 0.6, H.eave, a - 0.6), C.hallWall, local(f, 0, plat, 0))
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.add(
        cylinder(0.26, 0.24, H.eave, { segments: 6 }),
        C.column,
        local(f, (sx * a) / 2, plat, (sz * a) / 2)
      )
    }
  }
  // 下层檐：四角攒尖截成一圈（攒尖 4 边形的外接半径 = 边长 / √2）
  const R1 = a / Math.SQRT2
  const h1 = 2.2 * K_ROOF
  const lower = { overhang: 1.1, curl: 0.6, tMax: 0.5, segS: 4, segT: 2 }
  const y1 = plat + H.eave - eaveDrop(R1, 1.1, h1, 1.5, 0.3)
  const m1 = local(f, 0, y1, 0)
  b.add(pyramidRoof(4, R1, h1, { ...lower, ridges: false }), L.roof, m1)
  b.add(pyramidRidges(4, R1, h1, lower), L.roofRidge, m1)
  // 上层楼身：外接半径盖住下层檐内缘
  const ringTop = y1 + roofHeight(0, 0.5, h1, 0)
  const ur = (R1 + 1.1) * 0.5 + 0.2
  const ua = ur * Math.SQRT2
  const y2 = ringTop + 2.2
  b.add(
    box(ua, y2 - (plat + H.eave), ua),
    L.lattice,
    local(f, 0, plat + H.eave, 0)
  )
  const h2 = 2.4 * K_ROOF
  const upper = { overhang: 1.0, curl: 0.6, segS: 4, segT: 3 }
  const yu = y2 - eaveDrop(ur, 1.0, h2, 1.5, 0.2)
  const m2 = local(f, 0, yu, 0)
  b.add(pyramidRoof(4, ur, h2, { ...upper, ridges: false }), L.roof, m2)
  b.add(pyramidRidges(4, ur, h2, upper), L.roofRidge, m2)
  const fh = 0.9 * K_ORN
  addFinial(b, local(f, 0, yu + h2 * 0.94, 0), fh, L.glaze)
}

/**
 * 硬山殿（三义庙前殿 / 正殿）：屋面两端不出挑、与青砖山墙齐平，山墙顶压一道砖脊；
 * 开敞前廊深红柱。f 的局部 X 沿面阔、+Z 为正面，y = 0 为铺装面。
 * @returns {number} 最高点（局部）
 */
function addHardGable(b, f, o) {
  const { w, d } = o
  const H = HEIGHTS.sanyi
  const plat = H.plat * K_ROOF
  const roofH = H.roof * K_ROOF
  const ov = 0.9
  b.add(box(w, plat + 0.2, d), C.platform, local(f, 0, -0.2, 0))
  // 墙体（前面让出 2.2 m 前廊）+ 花格门窗
  const porch = 2.2
  const wd = d - 0.6 - porch
  b.add(
    box(w - 1.4, H.eave - plat, wd),
    C.hallWall,
    local(f, 0, plat, -porch / 2)
  )
  b.add(
    box((w - 1.4) * 0.85, (H.eave - plat) * 0.7, 0.1),
    L.lattice,
    local(f, 0, plat, wd / 2 - porch / 2 + 0.05)
  )
  // 青砖山墙（外皮即台基两端）
  for (const sx of [-1, 1]) {
    b.add(box(0.7, H.eave, d), L.brick, local(f, sx * (w / 2 - 0.35), 0, 0))
  }
  // 前檐柱（五开间六柱）+ 额枋
  const cz = d / 2 - 0.5
  for (let k = 0; k <= 5; k++) {
    b.add(
      cylinder(0.28, 0.25, H.eave - plat, { segments: 6 }),
      C.column,
      local(f, -w / 2 + 1.2 + (k * (w - 2.4)) / 5, plat, cz)
    )
  }
  b.add(box(w - 1.4, 0.5, 0.35), L.lattice, local(f, 0, H.eave - 0.5, cz))
  // 屋面：两端檐口止于山墙外皮内 0.1 m（ex = w/2 − 0.1），前后出檐 ov
  const rw = w - 2 * ov - 0.2
  const go = { overhang: ov, segS: 1, segT: 4, ridges: false, gables: false }
  const y = H.eave - eaveDrop(d / 2 - 0.5, ov, roofH, 1.3, 0.4)
  const m = local(f, 0, y, 0)
  b.add(gableRoof(rw, d - 1, roofH, go), L.roof, m)
  // 山墙三角（按同一屋面曲线，贴在山墙外皮 x = ±w/2）
  b.add(gableWalls(w, d - 1, roofH, go), L.brick, m)
  b.add(
    gableRidge(w - 0.2, d - 1, roofH, { ...go, overhang: 0 }),
    L.roofRidge,
    m
  )
  // 山墙顶的砖脊：沿屋面曲线在墙头压一道
  const ez = (d - 1) / 2 + ov
  for (const sx of [-1, 1]) {
    const pts = []
    for (let j = 0; j <= 8; j++) {
      const z = -(d - 1) / 2 + ((d - 1) * j) / 8
      const t = 1 - Math.abs(z) / ez
      pts.push([sx * (w / 2 - 0.35), roofHeight(0, t, roofH, 0, 1.3), z])
    }
    b.add(sweepBar(pts, 0.8, 0.28, { sink: 0.1 }), "#5C6167", m)
  }
  return y + roofH * 1.12
}

/**
 * 屋脊灰塑人物：沿正脊一排小色块（诸葛亮殿「名垂宇宙」正脊的成排灰塑）。
 * m 为屋顶坐标系原点所在的父坐标，(y, len) 为正脊顶面高度与可用长度。
 */
function addRidgeFigures(b, f, y, len, n) {
  const colors = [C.figure, "#C9B27A", C.figure, "#8B9AA6"]
  for (let k = 0; k < n; k++) {
    const x = -len / 2 + ((k + 0.5) * len) / n
    if (Math.abs(x) < 1.2) continue // 正中留给宝顶
    const h = (0.9 + (k % 2) * 0.25) * K_ORN
    b.add(box(0.45, h, 0.4), colors[k % colors.length], local(f, x, y - 0.1, 0))
  }
}

/**
 * 竹丛（竹林带的单元）：下窄上宽的 5 边台体 + 顶部 5 边尖锥，远看是一团向上散开的亮绿竹叶。
 */
function addBamboo(b, x, y, z, h, r, color, yaw) {
  b.add(
    prism(5, r * 0.3, r, h * 0.62, { top: false }),
    color,
    local(null, x, y, z, yaw)
  )
  b.add(cone(5, r, h * 0.38), color, local(null, x, y + h * 0.62, z, yaw))
}

/** 柏树：细长的深绿尖锥（下段台体 + 上段尖锥），y 为地面 */
function addCypress(b, x, y, z, h, r, color, yaw) {
  b.add(
    prism(5, r * 0.4, r, h * 0.3, { top: false }),
    color,
    local(null, x, y, z, yaw)
  )
  b.add(cone(5, r, h * 0.7), color, local(null, x, y + h * 0.3, z, yaw))
}

/* ---------------- 占用栅格（布置民居、竹林、树木时判断空地） ---------------- */

const F_SOLID = 1 // 建筑、墙
const F_PAVE = 2 // 铺装、街道
const F_COMPOUND = 4 // 武侯祠院墙以内
const F_TREE = 8 // 已种树 / 竹
const F_NOTREE = 16 // 不种树的区域（惠陵圆墙内、步行路径两侧）
const F_JINLI = 32 // 锦里底面

/**
 * 0.5 m 分辨率的位标记栅格（世界坐标）。
 * fillPoly 用扫描线填充多边形，stamp 沿线段盖圆点（线宽 / 外扩）。
 */
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
    /** 折线整体盖印（线宽 2r） */
    stampLine(pts, r, flag) {
      for (let i = 0; i < pts.length - 1; i++) {
        grid.stamp(pts[i], pts[i + 1], r, flag)
      }
    },
    /** 圆盘打标记 */
    disk(cx, cz, r, flag) {
      grid.stamp([cx, cz], [cx, cz], r, flag)
    },
    /** 圆盘内（按 7 个采样点）是否都不含 mask 中的任何标记 */
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

/* ---------------- 锦里构件 ---------------- */

/**
 * 按比例调整 sRGB 十六进制颜色的明度（各通道同乘 k，结果仍是 sRGB 字符串）。
 * 用于民居屋面逐栋深浅浮动。
 */
function shadeHex(hex, k) {
  const n = Number.parseInt(hex.slice(1), 16)
  const ch = (shift) =>
    Math.min(255, Math.round(((n >> shift) & 255) * k))
      .toString(16)
      .padStart(2, "0")
  return `#${ch(16)}${ch(8)}${ch(0)}`
}

/** 折线在中轴坐标 u 处的 v（取第一段 u 范围覆盖它的线段插值；找不到取最近端点） */
function streetVAt(pts, axis, u) {
  const a = pts.map(([x, z]) => axis.toAxis(x, z))
  for (let i = 0; i < a.length - 1; i++) {
    const [u0, v0] = a[i]
    const [u1, v1] = a[i + 1]
    if ((u0 - u) * (u1 - u) <= 0 && u0 !== u1) {
      return v0 + ((v1 - v0) * (u - u0)) / (u1 - u0)
    }
  }
  return a.reduce((p, q) =>
    Math.abs(q[0] - u) < Math.abs(p[0] - u) ? q : p
  )[1]
}

/**
 * 川西铺面一栋：墙体 + 悬山灰瓦顶（屋脊平行街道，出檐大）+ 临街木构铺面；
 * 两层的加一道腰檐与上层木格窗，部分挂黄色幌子。
 * f 为房屋坐标系：局部 X 沿街、+Z 朝街，y = 0 为城市地面（墙从地面起）。
 * 高度都按离街面（PAVE_Y）计。腰檐与屋檐都只挑出 overhang（头顶净空按它扣步行宽度）。
 */
function addShop(b, f, o) {
  const { len, dep, two, wall, roof, overhang, banner } = o
  const eave = two ? JINLI.eave2 : JINLI.eave1
  b.add(box(len, PAVE_Y + eave, dep), wall, f)
  const go = { overhang, segS: 1, segT: 2, gables: false, ridges: false }
  const ry = PAVE_Y + eave - eaveDrop(dep / 2, overhang, JINLI.ridgeH, 1.3, 0)
  const m = local(f, 0, ry, 0)
  b.add(gableRoof(len, dep, JINLI.ridgeH, go), roof, m)
  b.add(gableWalls(len, dep, JINLI.ridgeH, go), wall, m)
  b.add(gableRidge(len, dep, JINLI.ridgeH, go), C.houseRidge, m)
  // 临街铺面：深木色门板（木构墙的房子用浅一号的木色）
  const panel = wall === L.timber ? C.timberLight : L.timber
  const fz = dep / 2 + 0.05
  b.add(box(len * 0.82, 3.0, 0.1), panel, local(f, 0, PAVE_Y, fz))
  if (two) {
    // 腰檐：底边离街面 3.8 m、挑出 overhang（与屋檐同样的净空约束）
    b.add(
      box(len + 0.2, 0.2, overhang - 0.05),
      roof,
      local(f, 0, PAVE_Y + 3.8, dep / 2 + (overhang - 0.05) / 2)
    )
    b.add(box(len * 0.8, 1.7, 0.1), panel, local(f, 0, PAVE_Y + 4.6, fz))
    if (banner) {
      b.add(
        box(1.0, 2.3, 0.06),
        C.banner,
        local(f, len * 0.28, PAVE_Y + 4.25, dep / 2 + 0.14)
      )
    }
  }
}

/**
 * 沿街一侧排民居：逐段（折线的每一段）从段首到段尾按面宽 6～12 m 连排，
 * 进深 8～12 m（地块不够时依次退到 0.75 倍、5 m、3.5 m），前墙贴街面边缘（后排再退 offset）。
 * 候选矩形内按 0.8 m 采样，碰到建筑、街道、院墙以内即换小一号；放不下就前进 2 m 再试。
 * 随机数按每栋起点的位置播种（hashInts），与遍历顺序、数组下标无关。
 * @param {Array<[number, number]>} pts 街道中线（世界坐标）
 * @param {number} side 1 取线段左手法向 (−dz, dx) 一侧，−1 取另一侧
 * @param {object} o { streetW, overhang, offset = 0, back = false, main = false,
 *   minSeg（短于它的线段不排） }
 * @param {Array} out 放下的民居记录 { x, z, len, dep, two, seg, side, back }（调试 / 校验用）
 */
function placeHouses(b, grid, pts, side, o, out) {
  const off0 = o.streetW / 2 + (o.offset ?? 0)
  const mask = F_SOLID | F_PAVE | F_COMPOUND
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i]
    const [bx, bz] = pts[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    if (len < Math.max(6, o.minSeg ?? 0)) continue
    const dx = (bx - ax) / len
    const dz = (bz - az) / len
    const nx = -dz * side
    const nz = dx * side
    // (s 沿街, c 离街) → 世界坐标
    const P = (s0, c) => [ax + dx * s0 + nx * c, az + dz * s0 + nz * c]
    const free = (s0, fw, c0, dep) => {
      for (let a = 0.35; a <= fw - 0.35 + 1e-6; a += 0.8) {
        for (let c = 0.35; c <= dep - 0.35 + 1e-6; c += 0.8) {
          if (grid.get(...P(s0 + a, c0 + c)) & mask) return false
        }
        if (grid.get(...P(s0 + a, c0 + dep - 0.35)) & mask) return false
      }
      if (grid.get(...P(s0 + fw - 0.35, c0 + dep - 0.35)) & mask) return false
      // 山面与后檐的出挑（overhang）不许伸到别的街巷上空（路口处的侧房、背靠支巷的房子）
      const ov = o.overhang - 0.1
      for (let c = 0.35; c <= dep + ov + 1e-6; c += 0.8) {
        if (grid.get(...P(s0 - ov, c0 + c)) & F_PAVE) return false
        if (grid.get(...P(s0 + fw + ov, c0 + c)) & F_PAVE) return false
      }
      for (let a = 0; a <= fw + 1e-6; a += 0.8) {
        if (grid.get(...P(s0 + a, c0 + dep + ov)) & F_PAVE) return false
      }
      return true
    }
    // 折点处（转角 > 15°）两端各让出 BEND_GAP：转角内侧的房子山面出檐会伸到另一段街面上空
    const turn = (j) => {
      if (j <= 0 || j >= pts.length - 1) return 0
      const [p, q, r] = [pts[j - 1], pts[j], pts[j + 1]]
      const a1 = Math.atan2(q[1] - p[1], q[0] - p[0])
      const a2 = Math.atan2(r[1] - q[1], r[0] - q[0])
      return Math.abs(((a2 - a1 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)
    }
    const m0 = turn(i) > 15 * DEG ? BEND_GAP : 0.3
    const m1 = turn(i + 1) > 15 * DEG ? BEND_GAP : 0.3
    let s0 = m0
    while (s0 < len - m1 - 3.2) {
      const [px, pz] = P(s0, off0)
      const rand = mulberry32(
        hashInts(SEED, Math.round(px), Math.round(pz), o.back ? 2 : 1)
      )
      let fw = JINLI.front[0] + rand() * (JINLI.front[1] - JINLI.front[0])
      if (s0 + fw > len - m1) fw = len - m1 - s0
      if (fw < 3.5) break
      const want = JINLI.depth[0] + rand() * (JINLI.depth[1] - JINLI.depth[0])
      const two = rand() < (o.back ? 0.3 : 0.45)
      const pick = rand()
      const wall = pick < 0.34 ? L.brick : pick < 0.67 ? L.plaster : L.timber
      const roof = shadeHex("#5C6573", 1 + (rand() * 2 - 1) * 0.05)
      const banner = o.main && rand() < 0.4
      const deps = o.back ? [want, 7, 5] : [want, want * 0.75, 5, 3.5]
      let placed = false
      for (const dep of deps) {
        if (!free(s0, fw, off0, dep)) continue
        const [cx, cz] = P(s0 + fw / 2, off0 + dep / 2)
        // 房屋坐标系 +Z 朝街（−n）：frame 的 +Z 指向 bearing + 180，bearing 取 n 的方位
        const f = frame(cx, 0, cz, Math.atan2(nx, -nz) / DEG)
        // 后排只做单层或两层的屋面，不挂幌子
        addShop(b, f, {
          len: fw,
          dep,
          two,
          wall,
          roof,
          overhang: o.overhang,
          banner: banner && two && !o.back
        })
        grid.fillPoly(
          [
            P(s0, off0),
            P(s0 + fw, off0),
            P(s0 + fw, off0 + dep),
            P(s0, off0 + dep)
          ],
          F_SOLID,
          0.2
        )
        out.push({
          x: cx,
          z: cz,
          len: fw,
          dep,
          two,
          seg: i,
          side,
          back: !!o.back
        })
        placed = true
        break
      }
      s0 += placed ? fw : 2
    }
  }
}

/**
 * 街道上空每隔 step 米横挂一串红灯笼：一根横绳（离街面 stringY）+ n 盏灯笼（球心 lanternY）。
 * 离折点 3 m 以内、离门楼 6 m 以内不挂。y0 为街面高度。
 */
function addLanternStrings(b, pts, streetW, step, n, avoid, y0) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i]
    const [bx, bz] = pts[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    const dx = (bx - ax) / len
    const dz = (bz - az) / len
    const bearing = Math.atan2(dx, -dz) / DEG
    for (let s0 = step / 2; s0 < len - 3; s0 += step) {
      if (s0 < 3) continue
      const x = ax + dx * s0
      const z = az + dz * s0
      if (avoid && Math.hypot(x - avoid[0], z - avoid[1]) < 6) continue
      // 局部 X = bearing + 90 即横跨街道
      const f = frame(x, y0, z, bearing)
      b.add(
        box(streetW + 1.2, 0.08, 0.08),
        L.iron,
        local(f, 0, JINLI.stringY, 0)
      )
      for (let k = 0; k < n; k++) {
        const u = (k - (n - 1) / 2) * 1.15
        addLanternLite(b, f, u, JINLI.lanternY, 0, JINLI.lanternR)
      }
    }
  }
}

/**
 * 锦里南入口门楼：青砖门洞（净宽 4.4、净高 PASS_H + 0.7），中部屋顶升起并带
 * 大号金色脊饰（双龙 + 火焰宝顶，约 11 m），两翼砖墙上各一座翘角歇山小顶（约 7 m）；
 * 暗底金字匾、门洞两侧大红灯笼。
 * f 的局部 X 横跨街道、+Z 朝武侯祠大街，y = 0 为街面。
 */
function addJinliGate(b, f) {
  const midW = 6.4
  const midD = 5
  const door = 4.4
  const doorH = PASS_H + 0.7
  const midH = 6.4
  for (const sx of [-1, 1]) {
    const pw = (midW - door) / 2
    b.add(
      box(pw, midH + 0.2, midD),
      L.brick,
      local(f, sx * (door / 2 + pw / 2), -0.2, 0)
    )
  }
  b.add(box(door, midH - doorH, midD), L.brick, local(f, 0, doorH, 0))
  // 暗底金字匾（门洞上方正面）
  b.add(box(3.4, 0.95, 0.1), L.gold, local(f, 0, doorH + 0.1, midD / 2 + 0.05))
  b.add(
    box(3.0, 0.68, 0.1),
    C.plaqueDark,
    local(f, 0, doorH + 0.23, midD / 2 + 0.12)
  )
  // 中部屋顶 + 金色脊饰
  const g = addGable(b, f, {
    w: midW,
    d: midD,
    eave: midH,
    roofH: 2.2,
    overhang: 0.9,
    wall: L.brick,
    margin: 0,
    ends: false
  })
  for (const sx of [-1, 1]) {
    // 双龙：正脊两侧拱起的金色长块，龙头向外昂起
    b.add(box(2.0, 0.6, 0.4), L.glaze, local(f, sx * 1.5, g.ridgeY - 0.1, 0))
    b.add(box(0.55, 1.3, 0.4), L.glaze, local(f, sx * 2.7, g.ridgeY - 0.1, 0))
  }
  addFinial(b, local(f, 0, g.ridgeY - 0.15, 0), 2.8, L.glaze)
  // 两翼：砖墙 + 翘角歇山小顶
  const ro = { overhang: 0.8, curl: 0.6, ridge: 0.5, segS: 6, segT: 3 }
  for (const sx of [-1, 1]) {
    const x = sx * (midW / 2 + 2.3)
    b.add(box(4.6, 5.4, 4.2), L.brick, local(f, x, -0.2, -0.2))
    const m = local(f, x, 5.1, -0.2)
    b.add(hipRoof(4.6, 4.2, 1.7, { ...ro, ridges: false }), L.roof, m)
    b.add(hipRidges(4.6, 4.2, 1.7, ro), L.roofRidge, m)
  }
  // 门洞两侧的大红灯笼（挂在砖垛前，最低点约 5 m）
  for (const sx of [-1, 1]) {
    addLanternLite(b, f, sx * 2.35, doorH + 0.4, midD / 2 + 0.6, 0.55)
  }
}

/**
 * 古戏台（万年台）：高 1.5 m 的台身、后台彩绘屏，前檐四柱、檐下 4 盏红灯笼，
 * 重檐歇山、翼角高翘（curl 0.65）。f 的局部 X 沿台口、+Z 朝观众（小广场），y = 0 为地面铺装。
 */
function addStage(b, f, w, d) {
  const ph = 1.8
  b.add(box(w, ph + 0.2, d), C.stageWood, local(f, 0, -0.2, 0))
  b.add(box(w + 0.2, 0.25, d + 0.2), L.lattice, local(f, 0, ph - 0.25, 0))
  // 后台彩绘屏 + 两侧短墙
  b.add(box(w - 1.0, 4.4, 0.4), L.lattice, local(f, 0, ph, -d / 2 + 0.8))
  b.add(
    box(w * 0.55, 3.0, 0.1),
    C.stageScreen,
    local(f, 0, ph + 0.6, -d / 2 + 1.05)
  )
  for (const sx of [-1, 1]) {
    b.add(
      box(0.35, 4.4, 2.4),
      L.lattice,
      local(f, sx * (w / 2 - 0.6), ph, -d / 2 + 2)
    )
  }
  const colH = 4.8
  for (const x of [-w / 2 + 0.5, -1.7, 1.7, w / 2 - 0.5]) {
    b.add(
      cylinder(0.24, 0.22, colH, { segments: 6 }),
      L.column,
      local(f, x, ph, d / 2 - 0.5)
    )
  }
  for (const sx of [-1, 1]) {
    b.add(
      cylinder(0.24, 0.22, colH, { segments: 6 }),
      L.column,
      local(f, sx * (w / 2 - 0.5), ph, -d / 2 + 0.5)
    )
  }
  b.add(
    box(w, 0.55, 0.4),
    L.lattice,
    local(f, 0, ph + colH - 0.55, d / 2 - 0.5)
  )
  for (const x of [-3.3, -1.1, 1.1, 3.3]) {
    addLanternLite(b, f, x, ph + colH - 1.0, d / 2 - 0.2, 0.42)
  }
  // 重檐歇山（同 kit addHall 的重檐做法）：下层截断成一圈檐，上层墙身盖住檐内缘
  const cw = w - 1
  const cd = d - 1
  const roofH = 3.4
  const o = 1.4
  const ridge = 0.55
  const tMax = 0.55
  const top = ph + colH
  const ro = { overhang: o, curl: 0.65, ridge, segS: 6, segT: 4 }
  const lower = { ...ro, tMax }
  const y = top - eaveDrop(cd / 2, o, roofH, 1.5, 0.5)
  b.add(
    hipRoof(cw, cd, roofH, { ...lower, ridges: false }),
    L.roof,
    local(f, 0, y, 0)
  )
  b.add(hipRidges(cw, cd, roofH, lower), L.roofRidge, local(f, 0, y, 0))
  const ex = cw / 2 + o
  const ez = cd / 2 + o
  const hx = ex * (1 - tMax) + ((ridge * cw) / 2) * tMax
  const hz = ez * (1 - tMax)
  const ringTop = y + roofHeight(0, tMax, roofH, 0)
  const y1 = ringTop + 1.6
  b.add(
    box(2 * hx + 0.4, y1 - top, 2 * hz + 0.4),
    L.lattice,
    local(f, 0, top, 0)
  )
  const uH = roofH * 0.85
  const uo = Math.max(0.6, 0.8 * ez - hz)
  const yu = y1 - eaveDrop(hz, uo, uH)
  const upper = { ...ro, overhang: uo }
  b.add(
    hipRoof(2 * hx, 2 * hz, uH, { ...upper, ridges: false }),
    L.roof,
    local(f, 0, yu, 0)
  )
  // 上层屋脊贴金：戏台在一片灰瓦里要一眼认得出
  b.add(hipRidges(2 * hx, 2 * hz, uH, upper), L.glaze, local(f, 0, yu, 0))
  addFinial(b, local(f, 0, yu + uH * 1.05, 0), 1.4, L.glaze)
}

/* ---------------- 步行路径 ---------------- */

/**
 * 步行路径（世界坐标，格式见 crowd.js）。宽度按两侧障碍逐项扣除：
 * 屋檐 / 腰檐外沿离可走带边缘 ≥ EAVE_CLEAR，身体带离墙、柱 ≥ BODY_CLEAR。
 */
function buildWalkways(o) {
  const { axis, main, jiupin, shuian, corridor, hl, jSide } = o
  const A = (list) => list.map(([u, v]) => axis.toWorld(u, v))
  const ws = []
  const add = (points, y, width, density, closed = false) =>
    ws.push({ points, y, width, closed, density })
  const galleryY = PAVE_Y + HEIGHTS.gallery.plat * K_ROOF
  // 中轴南段：门前广场 → 大门明间 → 一进院 → 二门明间 → 二进院甬道（止于御路前）
  add(
    A([
      [-133.5, 0],
      [-22, 0]
    ]),
    PAVE_Y,
    2.4,
    1.6
  )
  // 武将廊、文臣廊廊下（廊内地面）
  add(
    A([
      [-47.5, -24.25],
      [-6.5, -24.25]
    ]),
    galleryY,
    2,
    1.5
  )
  add(
    A([
      [-47.5, 24.25],
      [-2.8, 24.25]
    ]),
    galleryY,
    2,
    1.5
  )
  // 过厅段：刘备殿后踏步外 → 过厅明间 → 诸葛亮殿前踏步前
  add(
    A([
      [13.2, 0],
      [44.5, 0]
    ]),
    PAVE_Y,
    2.4,
    1.6
  )
  // 后园：诸葛亮殿后踏步外 → 三义庙前殿台基前
  add(
    A([
      [64.6, 0],
      [104, 0]
    ]),
    PAVE_Y,
    2.4,
    1.2
  )
  // 红墙夹道（最密）：两墙内侧净距 3.5，身体离墙 ≥ 0.86
  // 弯道内侧墙线（逐点法向平均侧移）会略向路径中线收拢，再多留 0.1 m
  add(corridor, PAVE_Y, CORRIDOR.clear - 2 * (BODY_CLEAR + 0.13), 3.2)
  // 惠陵神道：照壁北 → 惠陵大门明间 → 寝殿前踏步前
  add(
    A([
      [-64.5, HL_V],
      [-36.5, HL_V]
    ]),
    PAVE_Y,
    2,
    1.5
  )
  // 惠陵环道（闭合圆，环道 23.1～27.5 m 的中线附近）
  const ring = []
  for (let k = 0; k < 36; k++) {
    const t = (k / 36) * Math.PI * 2
    ring.push([hl[0] + 25.2 * Math.cos(t), hl[1] + 25.2 * Math.sin(t)])
  }
  // 宽 2.2：内缘离石条护边外皮 1.0 m，外缘离砖墙墙帽内沿约 0.9 m
  add(ring, PAVE_Y, 2.2, 1.3, true)
  // 锦里古街（最密）：两侧屋檐挑出 overhang，再留 EAVE_CLEAR
  const mainW = JINLI.mainW - 2 * (JINLI.overhang + EAVE_CLEAR)
  add(trimEnds(main, JL_STREET_T0 + 1, 1.5), PAVE_Y, mainW, 2.2)
  // 九品街：只有一侧有房（出檐 laneOverhang），可走带偏向院墙一侧
  const houseReach = JINLI.laneOverhang + EAVE_CLEAR
  const jw = JINLI.laneW - houseReach - 0.1
  add(
    // 从西北拐角之后起算：拐角前那段斜巷与主街路口挤在一起，屋檐离得太近
    offsetMiter(
      trimEnds(jiupin.slice(2), 5, 11),
      (-jSide * (houseReach - 0.1)) / 2
    ),
    PAVE_Y - LOW,
    jw,
    1.3
  )
  // 水岸锦里：两侧都有房
  const sw = JINLI.shuianW - 2 * (JINLI.laneOverhang + EAVE_CLEAR)
  add(trimEnds(shuian, 4, 1), PAVE_Y - LOW, sw, 1.2)
  return ws
}

/** 折线按斜接整体侧移 d（折点处沿角平分线移 d / cos(半转角)，各段都与原线平行） */
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

/** 开放折线两端各截掉 a / e 米 */
function trimEnds(pts, a, e) {
  const cut = (p, q, t) => {
    const l = Math.hypot(q[0] - p[0], q[1] - p[1])
    return [p[0] + ((q[0] - p[0]) * t) / l, p[1] + ((q[1] - p[1]) * t) / l]
  }
  const out = pts.slice()
  out[0] = cut(pts[0], pts[1], a)
  const n = out.length
  out[n - 1] = cut(pts[n - 1], pts[n - 2], e)
  return out
}

/* ---------------- 主构建 ---------------- */

/**
 * @param {{ project, buildings, theme, spot }} ctx
 * @returns {{ meshes: Mesh[], zones: Array, markerHeight: number, walkways: Array }}
 */
export function build(ctx) {
  const { project, buildings, spot } = ctx
  const ll = (list) => list.map(([lon, lat]) => project.toLocal(lon, lat))
  const b = new ColorBuilder() // 主体
  const gb = new ColorBuilder() // 地面批（单面材质）

  /* ---- 1. 中轴坐标系：原点取刘备殿 OSM 轮廓中心，方位取其长边方位 − 90° ---- */
  const li = findBuilding(buildings, "刘备殿", {
    near: [spot.x, spot.z],
    maxDist: 60
  })
  let ox = spot.x
  let oz = spot.z
  let bearing = AXIS_BEARING
  if (li >= 0) {
    const r = minAreaRect(buildings[li].p)
    ox = r.cx
    oz = r.cz
    // 长边方位 ∈ [0, 180)，刘备殿长边约 93.5°，中轴 = 长边 − 90°
    const cand = r.bearing - 90
    if (Math.abs(cand - AXIS_BEARING) < 15) bearing = cand
  }
  const axis = makeAxis(ox, oz, bearing)
  const A = axis.frame
  const W = (u, v) => axis.toWorld(u, v)
  // 中轴坐标下的构件坐标系：(u, v) 处、高 y、朝向 yaw（0 = 正面朝南，π/2 朝东，−π/2 朝西，π 朝北）
  const at = (u, v, y = PAVE_Y, yaw = 0) => local(A, v, y, -u, yaw)
  const rectW = (r) => [
    W(r[0], r[2]),
    W(r[0], r[3]),
    W(r[1], r[3]),
    W(r[1], r[2])
  ]

  /* ---- 2. 范围多边形与替换区 ---- */
  const wh = ll(WH_LL)
  const eastWallW = EAST_WALL.map(([u, v]) => W(u, v))
  // 院墙以内（草地）：武侯祠范围的东边界换成院墙折线
  const compound = [...wh.slice(0, 18), ...eastWallW, wh[24]]
  // 锦里底面：锦里范围的外侧 + 院墙折线（反向），两者沿院墙严丝合缝
  const jinliBase = [
    wh[18],
    ...ll(JL_OUTER_LL),
    wh[24],
    ...eastWallW.slice().reverse()
  ]
  const plaza = ll(PLAZA_LL)
  const zones = [
    wh,
    [wh[18], ...ll(JL_OUTER_LL), ...wh.slice(19, 25).reverse()],
    plaza
  ]
  const replaced = buildingsInZones(buildings, zones)

  /* ---- 3. 占用栅格 ---- */
  const grid = createGrid(-2140, 735, -1675, 1205)
  grid.fillPoly(compound, F_COMPOUND)
  grid.fillPoly(jinliBase, F_JINLI)
  // 保留的楼（景区外）：外扩 1 m 不许民居、树靠近
  const kept = []
  buildings.forEach((bd, i) => {
    if (replaced.has(i) || !bd.p || bd.p.length < 3) return
    const [cx, cz] = centroid(bd.p)
    if (cx < -2160 || cx > -1640 || cz < 700 || cz > 1240) return
    kept.push(bd.p)
    grid.fillPoly(bd.p, F_SOLID, 1)
  })

  /* ---- 4. 地面：草地、锦里底面、广场、院落铺装、甬道 ---- */
  // 草地（院墙以内，西区水池处开洞）与锦里底面：从城市地面挤出，边缘不悬空
  gb.add(extrudePolygon(compound, [ll(POND_LL)], GROUND_Y, LAWN_Y), C.lawn)
  gb.add(extrudePolygon(jinliBase, [], GROUND_Y, LAWN_Y), C.jlBase)
  // 广场顶面比甬道低 3 cm：甬道伸进广场的一段压在上面，不共面闪烁
  gb.add(extrudePolygon(plaza, [], GROUND_Y, PAVE_Y - LOW), C.pave)
  grid.fillPoly(plaza, F_PAVE)
  // 中轴坐标矩形铺装：盒子顶面 PAVE_Y、底面 LAWN_Y
  const paveRect = (r, color = C.pave) => {
    const { cu, cv, lu, lv } = rectInfo(r)
    gb.add(box(lv, PAVE_Y - LAWN_Y, lu), color, at(cu, cv, LAWN_Y))
    grid.fillPoly(rectW(r), F_PAVE)
  }
  // 中轴红砂石甬道：大门到三义庙前殿（v ±2.5）；各殿台基压在上面
  const AX = 2.5
  paveRect([-120, 104.5, -AX, AX], C.axis)
  // 一进院、二进院、刘备殿后院、诸葛亮殿院、三义庙前小广场（甬道两侧）
  const courts = [
    [-115.1, -57.8, -30.6, 29.6],
    [-49, -12.2, -19.2, 19.2],
    [9.4, 17.6, -16.7, 27.9],
    [25.1, 47.3, -20.4, 18.2],
    [95, 104.9, -16, 14]
  ]
  for (const [u0, u1, v0, v1] of courts) {
    paveRect([u0, u1, v0, -AX])
    paveRect([u0, u1, AX, v1])
  }

  /* ---- 5. 中轴殿堂 ---- */
  const solids = [] // 已建成构件的中轴矩形（附属房选楼时跳过压在它们下面的 OSM 楼）
  const solid = (r, pad = 0.3) => {
    solids.push(r)
    grid.fillPoly(rectW(r), F_SOLID, pad)
  }
  const Hh = HEIGHTS

  // 大门「汉昭烈庙」
  {
    const { cu, cv, lu, lv } = rectInfo(LAYOUT.gate)
    addGatehouse(b, at(cu, cv), {
      w: lv,
      d: lu,
      mid: 5,
      eave: Hh.gate.eave,
      roofH: Hh.gate.roof * K_ROOF,
      plat: Hh.gate.plat * K_ROOF
    })
    solid(LAYOUT.gate)
  }
  // 二门「明良千古」+ 两侧单坡配房
  {
    const { cu, cv, lu, lv } = rectInfo(LAYOUT.ermen)
    addGatehouse(b, at(cu, cv), {
      w: lv,
      d: lu,
      mid: 5,
      eave: Hh.ermen.eave,
      roofH: Hh.ermen.roof * K_ROOF,
      plat: Hh.ermen.plat * K_ROOF,
      column: C.column,
      wall: C.hallWall
    })
    solid(LAYOUT.ermen)
    for (const r of [LAYOUT.ermenE, LAYOUT.ermenW]) {
      const { cu: u, cv: v, lu: du, lv: dv } = rectInfo(r)
      const f = at(u, v)
      b.add(box(dv, Hh.side.eave, du), C.hallWall, local(f, 0, -0.2, 0))
      // 单坡：朝南（一进院）低、朝北高
      const shed = shedRoof(dv, du, Hh.side.roof * K_ROOF, 0.8)
      const m = local(f, 0, Hh.side.eave - 0.2, 0)
      b.add(shed.roof, L.roof, m)
      b.add(shed.ends, C.hallWall, m)
      solid(r)
    }
  }
  // 一进院东西碑亭
  for (const r of [LAYOUT.steleE, LAYOUT.steleW]) {
    const { cu, cv, lu, lv } = rectInfo(r)
    addStelePavilion(b, at(cu, cv), { w: lv, d: lu })
    solid(r)
  }
  // 武将廊（西，面朝东）/ 文臣廊（东，面朝西）
  for (const [r, yaw] of [
    [LAYOUT.galleryW, Math.PI / 2],
    [LAYOUT.galleryE, -Math.PI / 2]
  ]) {
    const { cu, cv, lu, lv } = rectInfo(r)
    addGallery(b, at(cu, cv, PAVE_Y, yaw), { len: lu, dep: lv })
    solid(r)
  }

  // 刘备殿（主角）：单檐歇山七间，台基 ×1.3、屋顶 ×1.3
  let markerHeight = 0
  {
    const H = Hh.liubei
    const { lu, lv } = rectInfo(LAYOUT.liubei)
    const platH = H.plat * K_ROOF
    const roofH = H.roof * K_ROOF
    // 台基从草地面起（多出的 PAVE_Y − LAWN_Y 埋在铺装里）
    const f = at(0, 0, LAWN_Y)
    const top = addHall(b, f, {
      w: lv,
      d: lu,
      wallH: H.eave - H.plat,
      platformH: platH + PAVE_Y - LAWN_Y,
      roof: "hip",
      roofH,
      spacing: 5.1,
      columnRadius: 0.42,
      curl: 0.36,
      ridge: 0.56,
      steps: "both",
      colors: {
        platform: C.platform,
        column: C.column,
        wall: C.hallWall
      }
    })
    markerHeight = LAWN_Y + top
    // 正脊灰塑带 + 脊中宝顶（×1.5）：正脊顶面 = 最高点 − 0.028 × roofH（见 roofs.js hipRidges）
    const ridgeTop = top - 0.028 * roofH
    const cw = lv - 3
    const ridgeLen = 0.56 * cw
    b.add(
      box(ridgeLen * 0.6, 0.45 * K_ORN, 0.5),
      C.figure,
      local(f, 0, ridgeTop - 0.1, 0)
    )
    const fh = 1.4 * K_ORN
    addFinial(b, local(f, 0, ridgeTop + 0.45 * K_ORN - 0.2, 0), fh, L.glaze)
    markerHeight = Math.max(markerHeight, LAWN_Y + ridgeTop + 0.45 * K_ORN + fh)
    // 台基前沿红砂石栏杆（踏步处留口）
    const py = platH + PAVE_Y - LAWN_Y
    const fz = lu / 2 - 0.25
    for (const sx of [-1, 1]) {
      addBalustrade(b, f, {
        points: [
          [sx * 4.4, fz],
          [sx * (lv / 2 - 0.3), fz]
        ],
        closed: false,
        h: 1.0,
        y: py,
        postSpacing: 2.6,
        color: C.redStone
      })
    }
    // 前檐撑弓金色点缀（前檐柱顶）+ 红底金字匾
    const cwCols = lv - 3
    for (let k = 0; k <= 7; k++) {
      b.add(
        box(0.9, 0.5, 0.35),
        L.gold,
        local(
          f,
          -cwCols / 2 + (k * cwCols) / 7,
          py + H.eave - H.plat - 1.1,
          lu / 2 - 1.1
        )
      )
    }
    b.add(box(4.6, 1.5, 0.12), L.gold, local(f, 0, py + 4, lu / 2 - 1.2))
    b.add(box(4.1, 1.1, 0.12), C.plaque, local(f, 0, py + 4.2, lu / 2 - 1.08))
    solid(LAYOUT.liubei, 0.5)
    // 殿前甬道两侧的红砂石花台（花台上种苏铁 / 柏树）与雕花御路
    for (const sx of [-1, 1]) {
      const r = sx > 0 ? [-24, -12.6, 3, 14.5] : [-24, -12.6, -14.5, -3]
      const { cu, cv, lu: du, lv: dv } = rectInfo(r)
      b.add(box(dv, 0.8 + 0.15, du), C.redStone, at(cu, cv, LAWN_Y))
      b.add(box(dv - 0.6, 0.06, du - 0.6), C.lawn, at(cu, cv, PAVE_Y + 0.8))
      addBalustrade(b, at(cu, cv, PAVE_Y + 0.8), {
        points: [
          [-sx * (dv / 2 - 0.15), du / 2 - 0.15],
          [-sx * (dv / 2 - 0.15), -du / 2 + 0.15]
        ],
        closed: false,
        h: 0.9,
        postSpacing: 2.4,
        color: C.redStone
      })
      solid(r, 0.2)
    }
    b.add(box(1.6, 0.3, 7.4), L.granite, at(-16.3, 0, PAVE_Y))
    b.add(box(1.1, 0.12, 6.6), L.gold, at(-16.3, 0, PAVE_Y + 0.3))
  }

  // 过厅：卷棚顶，明间前后贯通（地面与铺装齐平），次间矮台基 + 花格墙
  {
    const H = Hh.guoting
    const { cu, cv, lu, lv } = rectInfo(LAYOUT.guoting)
    const f = at(cu, cv)
    const mid = 5.2
    const side = (lv - mid) / 2
    const plat = H.plat * K_ROOF
    for (const sx of [-1, 1]) {
      const x = sx * (mid / 2 + side / 2)
      b.add(box(side, plat + 0.2, lu), C.platform, local(f, x, -0.2, 0))
      b.add(
        box(side - 0.4, H.eave - plat - 0.5, 0.3),
        L.lattice,
        local(f, x, plat, 0)
      )
    }
    const cz = lu / 2 - 0.6
    for (const x of [-lv / 2 + 0.4, -mid / 2, mid / 2, lv / 2 - 0.4]) {
      for (const z of [cz, -cz]) {
        b.add(
          cylinder(0.28, 0.25, H.eave, { segments: 6 }),
          C.gateColumn,
          local(f, x, 0, z)
        )
      }
    }
    for (const z of [cz, -cz]) {
      b.add(box(lv, 0.55, 0.4), L.lattice, local(f, 0, H.eave - 0.55, z))
    }
    // 暗底金字匾「武侯祠」：挂在前檐额枋前，底边高 4.5 m，行人从下面穿过
    b.add(box(3.6, 1.0, 0.12), L.gold, local(f, 0, H.eave - 0.72, cz + 0.28))
    b.add(
      box(3.2, 0.75, 0.12),
      C.plaqueDark,
      local(f, 0, H.eave - 0.6, cz + 0.36)
    )
    const rw = lv - 0.8
    const rd = lu - 1.2
    const roofH = H.roof * K_ROOF
    const { roof, ends } = rollRoof(rw, rd, roofH, 1.0)
    const y = H.eave - 0.25
    b.add(roof, L.roof, local(f, 0, y, 0))
    b.add(ends, L.lattice, local(f, 0, y, 0))
    solid(LAYOUT.guoting)
  }

  // 东西厢房（L 形各拆两栋，单层悬山）
  for (const [r, yaw] of [
    [LAYOUT.wingEa, Math.PI],
    [LAYOUT.wingWa, Math.PI],
    [LAYOUT.wingEb, -Math.PI / 2],
    [LAYOUT.wingWb, Math.PI / 2]
  ]) {
    const { cu, cv, lu, lv } = rectInfo(r)
    // 面阔沿 v（朝北）或沿 u（朝东 / 西）
    const alongV = Math.abs(yaw) > Math.PI * 0.75
    // 过厅两侧的一排（alongV）压低一截，让卷棚顶的过厅在这一排里冒出来
    addSideHall(b, at(cu, cv, PAVE_Y, yaw), {
      w: alongV ? lv : lu,
      d: alongV ? lu : lv,
      eave: alongV ? Hh.wing.eave - 0.6 : Hh.wing.eave,
      roofH: Hh.wing.roof * K_ROOF * (alongV ? 0.8 : 1),
      plat: Hh.wing.plat * K_ROOF,
      porch: 1.4
    })
    solid(r)
  }
  // 钟楼 / 鼓楼
  for (const r of [LAYOUT.bell, LAYOUT.drum]) {
    const { cu, cv, lu } = rectInfo(r)
    addBellTower(b, at(cu, cv), lu)
    solid(r)
  }

  // 诸葛亮殿「名垂宇宙」：单檐歇山，比刘备殿低（前高后低）；正脊一排灰塑人物 + 宝顶
  {
    const H = Hh.zhuge
    const { cu, cv, lu, lv } = rectInfo(LAYOUT.zhuge)
    const platH = H.plat * K_ROOF
    const roofH = H.roof * K_ROOF
    const f = at(cu, cv, LAWN_Y)
    const top = addHall(b, f, {
      w: lv,
      d: lu,
      wallH: H.eave - H.plat,
      platformH: platH + PAVE_Y - LAWN_Y,
      roof: "hip",
      roofH,
      spacing: 4.4,
      columnRadius: 0.36,
      curl: 0.36,
      ridge: 0.55,
      steps: "both",
      colors: { platform: C.platform, column: C.column, wall: C.hallWall }
    })
    const ridgeTop = top - 0.028 * roofH
    const inset = clamp(0.1 * Math.min(lv, lu), 0.5, 1.5)
    addRidgeFigures(b, f, ridgeTop, 0.55 * (lv - 2 * inset), 9)
    addFinial(b, local(f, 0, ridgeTop - 0.2, 0), 1.2 * K_ORN, L.glaze)
    const py = platH + PAVE_Y - LAWN_Y
    for (const sx of [-1, 1]) {
      addBalustrade(b, f, {
        points: [
          [sx * 4.3, lu / 2 - 0.25],
          [sx * (lv / 2 - 0.3), lu / 2 - 0.25]
        ],
        closed: false,
        h: 1.0,
        y: py,
        postSpacing: 2.6,
        color: L.granite
      })
    }
    b.add(box(4.2, 1.3, 0.12), L.gold, local(f, 0, py + 3.4, lu / 2 - 1.2))
    b.add(
      box(3.8, 0.95, 0.12),
      C.plaqueDark,
      local(f, 0, py + 3.55, lu / 2 - 1.08)
    )
    solid(LAYOUT.zhuge, 0.5)
  }

  // 三义庙前殿 + 正殿（硬山、青砖山墙）
  for (const r of [LAYOUT.sanyiFront, LAYOUT.sanyi]) {
    const { cu, cv, lu, lv } = rectInfo(r)
    addHardGable(b, at(cu, cv), { w: lv, d: lu })
    solid(r)
  }

  /* ---- 6. 惠陵 ---- */
  const hl = project.toLocal(HUILING_LL[0], HUILING_LL[1])
  const [hlU, hlV] = axis.toAxis(hl[0], hl[1])
  {
    const Hl = HUILING
    const hf = frame(hl[0], 0, hl[1], bearing)
    // 封土：旋转体，底在石条护边顶，顶部平缓；表面按 16 × 5 网格
    const seg = 16
    const rings = 6
    const top = PAVE_Y + Hl.moundH
    const base = PAVE_Y + Hl.curbH
    const hAt = (r) =>
      base + (top - base) * Math.pow(Math.max(0, 1 - (r / Hl.moundR) ** 2), 0.7)
    const pos = []
    for (let j = 0; j < rings; j++) {
      const r0 = (Hl.moundR * j) / rings
      const r1 = (Hl.moundR * (j + 1)) / rings
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * Math.PI * 2
        const a1 = ((k + 1) / seg) * Math.PI * 2
        const p = (r, a) => [r * Math.cos(a), hAt(r), r * Math.sin(a)]
        const P00 = p(r0, a0)
        const P01 = p(r0, a1)
        const P10 = p(r1, a0)
        const P11 = p(r1, a1)
        if (j === 0) pos.push(...P00, ...P11, ...P10)
        else pos.push(...P00, ...P11, ...P10, ...P00, ...P01, ...P11)
      }
    }
    const mound = fromTriangles(pos)
    b.add(mound, C.moundGrass, hf)
    // 石条护边：外皮一圈（从草地起到护边顶）+ 顶面压条
    b.add(
      cylinder(Hl.moundR + Hl.curbT, Hl.moundR + Hl.curbT, base - LAWN_Y, {
        segments: 32
      }),
      C.curb,
      local(hf, 0, LAWN_Y, 0)
    )
    b.add(annulus(Hl.moundR - 0.05, Hl.moundR + Hl.curbT, base, 32), C.curb, hf)
    // 石板环道
    gb.add(
      annulus(Hl.moundR + Hl.curbT, Hl.wallR + 0.05, PAVE_Y, 40),
      C.pave,
      hf
    )
    // 青灰砖圆墙（南侧开口）+ 灰瓦墙帽
    const wr = Hl.wallR + Hl.wallT / 2
    const gapA = Math.asin(Hl.gapHalf / wr)
    // 圆墙在陵轴坐标里：角度从 +v（东）起、向 −u（南）量；南侧开口正对神道
    const arcPts = []
    const southA = Math.PI / 2 // 局部 +Z 为南
    const n = 40
    for (let k = 0; k <= n; k++) {
      const a = southA + gapA + ((2 * Math.PI - 2 * gapA) * k) / n
      arcPts.push([wr * Math.cos(a), wr * Math.sin(a)])
    }
    const hw = PAVE_Y + Hl.wallH
    b.add(
      sweepBar(lift(arcPts, LAWN_Y), Hl.wallT, hw - LAWN_Y),
      C.greyBrick,
      hf
    )
    b.add(sweepBar(lift(arcPts, hw), Hl.wallT + 0.4, 0.2), L.roof, hf)
    b.add(sweepBar(lift(arcPts, hw + 0.2), 0.35, 0.16), L.roofRidge, hf)
    // 开口处的门垛
    for (const s of [-1, 1]) {
      const a = southA + s * gapA
      b.add(
        box(1.2, hw - LAWN_Y + 0.5, 1.2),
        C.greyBrick,
        local(hf, wr * Math.cos(a), LAWN_Y, wr * Math.sin(a))
      )
    }
    // 圆墙以内不种通用树（封土上另种小树），圆墙本身算墙
    grid.disk(hl[0], hl[1], wr + 1.5, F_NOTREE)
    // 陵轴局部 (x, z) = (v 偏移, −u 偏移) → 世界坐标
    grid.stampLine(
      arcPts.map(([x, z]) => W(hlU - z, hlV + x)),
      Hl.wallT / 2 + 0.3,
      F_SOLID
    )

    // 陵前小院、神道铺装
    paveRect(Hl.forecourt)
    paveRect(Hl.shendao, L.granite)
    // 阙坊（碑亭式）：石柱 + 小歇山顶，中间立墓碑
    {
      const f = at(Hl.queFang, HL_V)
      for (const sx of [-1, 1]) {
        b.add(box(0.8, 4.2, 0.8), L.granite, local(f, sx * 2.1, -0.2, 0))
      }
      b.add(box(5.2, 0.6, 1.0), L.granite, local(f, 0, 3.8, 0))
      b.add(box(1.6, 3.0, 0.45), C.stele, local(f, 0, -0.2, -0.6))
      const ro = { overhang: 0.6, curl: 0.4, ridge: 0.5, segS: 6, segT: 3 }
      const m = local(f, 0, 4.4, 0)
      b.add(
        hipRoof(4.6, 1.4, 1.2 * K_ROOF, { ...ro, ridges: false }),
        L.roof,
        m
      )
      b.add(hipRidges(4.6, 1.4, 1.2 * K_ROOF, ro), L.roofRidge, m)
      solid([Hl.queFang - 1.2, Hl.queFang + 1.2, HL_V - 2.6, HL_V + 2.6])
    }
    // 寝殿（面阔三间 11 × 8，单檐悬山灰筒瓦）
    {
      const { cu, cv, lu, lv } = rectInfo(Hl.qinDian)
      addSideHall(b, at(cu, cv), {
        w: lv,
        d: lu,
        eave: 5,
        roofH: 2.5 * K_ROOF,
        plat: 0.45 * K_ROOF
      })
      solid(Hl.qinDian)
    }
    // 惠陵大门（明间可穿行）
    {
      const { cu, cv, lu, lv } = rectInfo(Hl.gate)
      addGatehouse(b, at(cu, cv), {
        w: lv,
        d: lu,
        mid: 4.4,
        eave: 5.3,
        roofH: 1.8 * K_ROOF,
        plat: 0.3 * K_ROOF,
        column: C.column,
        wall: C.vermilion
      })
      solid(Hl.gate)
    }
    // 照壁：朱红墙身 + 灰瓦墙帽
    {
      const f = at(Hl.zhaobi, HL_V)
      b.add(box(12, 4.8, 1.0), C.vermilion, local(f, 0, -0.2, 0))
      b.add(box(12.2, 0.4, 1.2), L.granite, local(f, 0, -0.2, 0))
      const go = { overhang: 0.35, segS: 1, segT: 2 }
      b.add(gableRoof(12, 1.0, 0.7, go), L.roof, local(f, 0, 4.6, 0))
      solid([Hl.zhaobi - 0.6, Hl.zhaobi + 0.6, HL_V - 6, HL_V + 6])
    }
  }

  /* ---- 7. 院墙 ---- */
  const wallRun = (pts, h = WALL.h) => {
    if (pts.length < 2 || polyLength(pts) < 0.5) return
    b.add(sweepBar(lift(pts, 0), WALL.t, h), C.vermilion)
    b.add(sweepBar(lift(pts, h), WALL.cap, 0.22), L.roof)
    b.add(sweepBar(lift(pts, h + 0.22), 0.35, 0.18), L.roofRidge)
    grid.stampLine(pts, WALL.t / 2 + 0.3, F_SOLID)
  }
  const toW = (list) => list.map(([u, v]) => W(u, v))
  wallRun(toW(EAST_WALL))
  wallRun(toW(SOUTH_WALL_E))
  wallRun(toW(SOUTH_WALL_W))
  wallRun(toW(INNER_WEST_WALL))
  // 文物区与西区之间的界墙：在南北向园路处开门洞
  {
    const west = ll(WEST_WALL_LL)
    const ua = west.map(([x, z]) => axis.toAxis(x, z))
    const south = []
    const north = []
    for (const p of ua) {
      if (p[0] < WEST_WALL_GAP.u - WEST_WALL_GAP.half) south.push(p)
      else if (p[0] > WEST_WALL_GAP.u + WEST_WALL_GAP.half) north.push(p)
    }
    // 门洞两侧补端点（按相邻两点线性插值到门洞边）
    const cut = (u) => {
      for (let i = 0; i < ua.length - 1; i++) {
        const [u0, v0] = ua[i]
        const [u1, v1] = ua[i + 1]
        if ((u0 - u) * (u1 - u) <= 0 && u0 !== u1) {
          return [u, v0 + ((v1 - v0) * (u - u0)) / (u1 - u0)]
        }
      }
      return null
    }
    const s1 = cut(WEST_WALL_GAP.u - WEST_WALL_GAP.half)
    const n1 = cut(WEST_WALL_GAP.u + WEST_WALL_GAP.half)
    if (s1) south.push(s1)
    if (n1) north.unshift(n1)
    wallRun(toW(south))
    wallRun(toW(north))
  }

  /* ---- 8. 红墙夹道 + 竹林 ---- */
  const corridorPath = (() => {
    const raw = ll(CORRIDOR_LL)
    const smooth = resample(chaikin(raw, 3), 3)
    // 南端截到陵前小院东缘以外（中轴坐标 v ≥ endV）
    const out = []
    for (const p of smooth) {
      const [, v] = axis.toAxis(p[0], p[1])
      if (v < CORRIDOR.endV) break
      out.push(p)
    }
    return out
  })()
  {
    const K = CORRIDOR
    const off = K.clear / 2 + K.t / 2
    // 夹道铺装（盖到两道墙外皮）
    gb.add(
      ribbon(corridorPath, K.clear + 2 * K.t + 0.2, LAWN_Y, PAVE_Y),
      C.pave
    )
    grid.stampLine(corridorPath, K.clear / 2 + K.t + 0.1, F_PAVE)
    for (const s of [-1, 1]) {
      const line = offsetLine(corridorPath, s * off)
      const top = PAVE_Y + K.h
      b.add(sweepBar(lift(line, LAWN_Y), K.t, top - LAWN_Y), C.corridor)
      b.add(sweepBar(lift(line, top), K.capW, K.capH), C.capGrey)
      b.add(
        sweepBar(lift(line, top + K.capH), K.glazeW, K.glazeH),
        C.glazeGreen
      )
      grid.stampLine(line, K.t / 2 + 0.3, F_SOLID)
    }
  }

  /* ---- 9. 园内其余 OSM 楼：灰瓦坡顶附属房 ---- */
  // 压在专门建模构件下面的楼（大门、殿堂、廊庑……）跳过；锦里范围内的楼由锦里程序化重排
  const jinliPolyOSM = zones[1]
  const inSolid = (x, z) => {
    const [u, v] = axis.toAxis(x, z)
    return solids.some(
      ([u0, u1, v0, v1]) =>
        u > u0 - 1.5 && u < u1 + 1.5 && v > v0 - 1.5 && v < v1 + 1.5
    )
  }
  const lateOSM = [] // 锦里范围内的 OSM 楼：民居排完后再补空地
  for (const i of replaced) {
    const bd = buildings[i]
    if (!bd.p || bd.p.length < 3) continue
    const [cx, cz] = centroid(bd.p)
    if (pointInPolygon(cx, cz, jinliPolyOSM)) {
      lateOSM.push(i)
      continue
    }
    if (pointInPolygon(cx, cz, plaza)) {
      // 门前广场上的细长块（way 1203841xxx，13 × 1.1 m）：做成低矮石砌花台
      const r = minAreaRect(bd.p)
      const f = frame(r.cx, PAVE_Y, r.cz, r.bearing - 90)
      b.add(box(r.w, 0.8, Math.max(1, r.d)), L.granite, f)
      b.add(
        box(r.w - 0.3, 0.3, Math.max(0.7, r.d - 0.3)),
        "#5E9E44",
        local(f, 0, 0.8, 0)
      )
      continue
    }
    if (inSolid(cx, cz)) continue
    const r = minAreaRect(bd.p)
    // 细长条（墙垛、围栏）不建房：南院墙、夹道已经画了墙
    if (r.d < 2.5) continue
    const rand = mulberry32(shapeSeed(SEED, bd.p))
    const area = polygonArea(bd.p)
    const eave = PAVE_Y + (area > 420 ? 7 : area > 150 ? 5.5 : 4.5)
    const ridgeH = clamp(0.3 * r.d, 1.8, 3.6)
    const wall = rand() < 0.7 ? C.genericWall : L.plaster
    if (area / (r.w * r.d) >= 0.85) {
      addBlockHouse(b, r, { eave, ridgeH, overhang: 0.7, wall })
    } else {
      addPitchedHouse(b, bd.p, {
        eaveH: eave,
        ridgeH,
        overhang: 0.7,
        wallColor: wall,
        roofColor: L.roof,
        ridgeColor: L.roofRidge
      })
    }
    grid.fillPoly(bd.p, F_SOLID, 0.6)
  }

  /* ---- 10. 竹林（夹道两侧）---- */
  {
    const K = CORRIDOR
    const rand = mulberry32(SEED + 11)
    for (const s of [-1, 1]) {
      const line = resample(
        offsetLine(corridorPath, s * K.bambooOff),
        K.bambooStep
      )
      line.forEach(([x, z], k) => {
        const jx = (rand() - 0.5) * 0.8
        const jz = (rand() - 0.5) * 0.8
        const r = K.bambooR * (0.8 + rand() * 0.4)
        const h = K.bambooH[0] + (K.bambooH[1] - K.bambooH[0]) * rand()
        // 竹丛根部不压建筑、墙；冠幅允许伸到墙帽上空（竹比墙高一倍）
        if (!grid.freeDisk(x + jx, z + jz, 0.5, F_SOLID)) return
        addBamboo(
          b,
          x + jx,
          LAWN_Y,
          z + jz,
          h,
          r,
          C.bamboo[k % 3],
          rand() * 6.28
        )
        grid.disk(x + jx, z + jz, r, F_TREE)
      })
    }
  }

  /* ---- 11. 锦里 ---- */
  const main = ll(MAIN_LL)
  const jiupin = ll(JIUPIN_LL)
  const shuian = ll(SHUIAN_LL)
  // 主街第一段（街口 → 西北拐点）的方向：门楼、入口小广场都排在这一段上
  const [p0, p1] = main
  const l01 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
  const d01 = [(p1[0] - p0[0]) / l01, (p1[1] - p0[1]) / l01]
  const onFirst = (t, s = 0) => [
    p0[0] + d01[0] * t - d01[1] * s,
    p0[1] + d01[1] * t + d01[0] * s
  ]
  // 主街铺装从门楼后 3.5 m（plazaEnd）起；街口到这里是入口小广场
  const plazaEnd = JL_GATE_T + 3.5
  const mainPave = [onFirst(plazaEnd), ...main.slice(1)]
  // 支巷顶面低 LOW：与主街搭接处不共面
  const streets = [
    { pts: mainPave, w: JINLI.mainW, top: PAVE_Y },
    { pts: jiupin, w: JINLI.laneW, top: PAVE_Y - LOW },
    { pts: shuian, w: JINLI.shuianW, top: PAVE_Y - LOW }
  ]
  for (const s of streets) {
    gb.add(ribbon(s.pts, s.w, GROUND_Y, s.top), C.street)
    grid.stampLine(s.pts, s.w / 2, F_PAVE)
  }

  // 南入口门楼：正面（+Z）朝武侯祠大街；frame 的 +Z 指向 bearing + 180，故 bearing 取指向街内的方位
  const inward = Math.atan2(d01[0], -d01[1]) / DEG
  {
    const [gx, gz] = onFirst(JL_GATE_T)
    addJinliGate(b, frame(gx, PAVE_Y, gz, inward))
    // 入口小广场：武侯祠大街路缘以外到门楼后（盖住门楼门洞地面）
    const hw = 8.5
    const poly = [
      onFirst(JL_STREET_T0, -hw),
      onFirst(JL_STREET_T0, hw),
      onFirst(plazaEnd, hw),
      onFirst(plazaEnd, -hw)
    ]
    gb.add(extrudePolygon(poly, [], GROUND_Y, PAVE_Y), C.street)
    grid.fillPoly(poly, F_PAVE)
    // 门楼前（街口一侧）两边各 30 m 不排民居：栅格里没有城市道路，不预留会把房子排到路缘上
    grid.fillPoly(
      [
        onFirst(0, -30),
        onFirst(0, 30),
        onFirst(JL_GATE_T - 2.8, 30),
        onFirst(JL_GATE_T - 2.8, -30)
      ],
      F_PAVE
    )
    grid.fillPoly(
      [
        onFirst(JL_GATE_T - 2.8, -8),
        onFirst(JL_GATE_T - 2.8, 8),
        onFirst(JL_GATE_T + 2.8, 8),
        onFirst(JL_GATE_T + 2.8, -8)
      ],
      F_SOLID
    )
  }

  // 古戏台 + 小广场 + 大树（中轴坐标，台口朝东对着主街）
  {
    const S = STAGE
    addStage(b, at(S.u, S.v, PAVE_Y, Math.PI / 2), S.w, S.d)
    grid.fillPoly(
      rectW([S.u - S.w / 2, S.u + S.w / 2, S.v - S.d / 2, S.v + S.d / 2]),
      F_SOLID,
      0.3
    )
    // 小广场：台口到主街西缘（搭进街面 0.5 m，顶面低 LOW）
    const v1 = streetVAt(main, axis, S.u) - JINLI.mainW / 2 + 0.5
    const r = [S.plazaU[0], S.plazaU[1], S.v + S.d / 2, v1]
    const { cu, cv, lu, lv } = rectInfo(r)
    gb.add(box(lv, PAVE_Y - LOW - LAWN_Y, lu), C.street, at(cu, cv, LAWN_Y))
    grid.fillPoly(rectW(r), F_PAVE)
    // 广场南角一棵大树（树冠伸到台前）；树冠范围不排民居
    const [tx, tz] = W(S.plazaU[0] + 2.2, S.v + S.d / 2 + 3.2)
    addTree(b, tx, PAVE_Y - LOW, tz, {
      r: 5.5,
      trunkH: 7,
      trunkR: 0.55,
      color: THEME.tree.greens[2],
      detail: 1
    })
    grid.disk(tx, tz, 6, F_PAVE)
  }

  const houses = []
  // 折线第 k 段的哪一侧（1 / −1，含义同 placeHouses 的 side）在 dist 米外落在院墙以内
  const sideToward = (pts, k, dist) => {
    const [ax, az] = pts[k]
    const [bx, bz] = pts[k + 1]
    const l = Math.hypot(bx - ax, bz - az)
    const mx = (ax + bx) / 2 - ((bz - az) / l) * dist
    const mz = (az + bz) / 2 + ((bx - ax) / l) * dist
    return grid.get(mx, mz) & F_COMPOUND ? 1 : -1
  }
  // 沿街民居：主街两侧前排 → 主街西侧后排 → 九品街（只排远离院墙的一侧）→ 水岸锦里两侧
  const mainRow = { streetW: JINLI.mainW, overhang: JINLI.overhang, main: true }
  placeHouses(b, grid, main, 1, mainRow, houses)
  placeHouses(b, grid, main, -1, mainRow, houses)
  // 后排只排在朝院墙的一侧（主街西侧 18～22 m 进深的地块）；东侧再往外已是景区外
  const backRow = {
    ...mainRow,
    offset: JINLI.depth[1] + JINLI.backGap,
    back: true,
    minSeg: 40
  }
  placeHouses(b, grid, main, sideToward(main, 1, 20), backRow, houses)
  const jSide = -sideToward(jiupin, Math.floor(jiupin.length / 2) - 1, 4)
  const laneRow = { streetW: JINLI.laneW, overhang: JINLI.laneOverhang }
  placeHouses(b, grid, jiupin, jSide, laneRow, houses)
  const shuianRow = { streetW: JINLI.shuianW, overhang: JINLI.laneOverhang }
  placeHouses(b, grid, shuian, 1, shuianRow, houses)
  placeHouses(b, grid, shuian, -1, shuianRow, houses)
  // 锦里北段剩下的 OSM 楼：整栋不碰民居、街道的，按轮廓补成灰瓦坡顶房
  for (const i of lateOSM) {
    const bd = buildings[i]
    const hit = (x, z) => grid.get(x, z) & (F_SOLID | F_PAVE)
    const [cx, cz] = centroid(bd.p)
    if (hit(cx, cz) || bd.p.some(([x, z]) => hit(x, z))) continue
    const rand = mulberry32(shapeSeed(SEED + 3, bd.p))
    const res = addPitchedHouse(b, bd.p, {
      eaveH: PAVE_Y + (rand() < 0.5 ? JINLI.eave1 : JINLI.eave2),
      ridgeH: JINLI.ridgeH,
      overhang: 0.6,
      wallColor: [L.brick, L.plaster, L.timber][Math.floor(rand() * 3)],
      roofColor: L.roof,
      ridgeColor: C.houseRidge
    })
    if (res) grid.fillPoly(bd.p, F_SOLID, 0.5)
  }

  // 主街、九品街上空的红灯笼串（门楼前后各 6 m 内不挂）
  const gateAt = onFirst(JL_GATE_T)
  addLanternStrings(
    b,
    mainPave,
    JINLI.mainW,
    JINLI.lanternStep,
    4,
    gateAt,
    PAVE_Y
  )
  addLanternStrings(
    b,
    jiupin,
    JINLI.laneW,
    JINLI.lanternStep + 1,
    2,
    null,
    PAVE_Y - LOW
  )

  /* ---- 12. 树：院内柏树、封土小树 ---- */
  // 院落里的古柏（中轴坐标）：一进院沿东西两侧、二进院四角、诸葛亮殿院两侧
  {
    const rand = mulberry32(SEED + 17)
    const spots = []
    for (let u = -107; u <= -62; u += 7.5) {
      if (u > -86 && u < -72) continue // 让开碑亭
      spots.push([u, -26.5], [u, 25.5])
    }
    spots.push(
      [-44, -14],
      [-44, 14],
      [-35, -14],
      [-35, 14],
      [31, -13],
      [31, 11]
    )
    spots.forEach(([u, v], k) => {
      const [x, z] = W(u, v)
      if (!grid.freeDisk(x, z, 2.4, F_SOLID)) return
      const h = 10 + rand() * 3
      addCypress(b, x, PAVE_Y, z, h, 2.1, C.cypress[k % 4], rand() * 6.28)
      grid.disk(x, z, 2.6, F_TREE)
    })
  }
  {
    const rand = mulberry32(SEED + 21)
    // 候选：院墙以内抖动网格（文物区 7 m、西区 9 m）
    const cands = []
    for (let x = -2130; x <= -1765; x += 3.5) {
      for (let z = 800; z <= 1180; z += 3.5) {
        const jx = x + (rand() - 0.5) * 3
        const jz = z + (rand() - 0.5) * 3
        const [, v] = axis.toAxis(jx, jz)
        const key = rand()
        const keep = v < -150 ? 0.08 : 0.16
        if (key > keep) continue
        cands.push([jx, jz])
      }
    }
    const blockMask = F_SOLID | F_PAVE | F_TREE | F_NOTREE
    let n = 0
    for (const [x, z] of cands) {
      if (!(grid.get(x, z) & F_COMPOUND)) continue
      const r = 2 + rand() * 0.9
      if (!grid.freeDisk(x, z, r + 0.6, blockMask)) continue
      const h = 9 + rand() * 5
      addCypress(b, x, LAWN_Y, z, h, r, C.cypress[n % 4], rand() * 6.28)
      grid.disk(x, z, r * 1.25, F_TREE)
      n++
    }
    // 锦里院落里零星的阔叶树（民居背后、北段空地）：离房屋、街面多留 1.2 m，树冠不压屋檐
    const jrand = mulberry32(SEED + 41)
    for (let x = -1870; x <= -1690; x += 6) {
      for (let z = 750; z <= 1150; z += 6) {
        const jx = x + (jrand() - 0.5) * 5
        const jz = z + (jrand() - 0.5) * 5
        const r = 2.4 + jrand() * 1.1
        const pick = jrand()
        if (pick > 0.35) continue
        const here = grid.get(jx, jz)
        if (!(here & F_JINLI) || here & F_COMPOUND) continue
        if (!grid.freeDisk(jx, jz, r + 1.2, F_SOLID | F_PAVE | F_TREE)) continue
        addTree(b, jx, LAWN_Y, jz, {
          r,
          trunkH: 4.2,
          trunkR: 0.3,
          color: THEME.tree.greens[Math.floor(pick * 11) % 4],
          detail: 0,
          yaw: pick * 18
        })
        grid.disk(jx, jz, r * 1.3, F_TREE)
      }
    }
    // 封土上的小树（冠幅不伸出护边）
    const trand = mulberry32(SEED + 31)
    const Hl = HUILING
    for (let k = 0; k < 20; k++) {
      const a = trand() * Math.PI * 2
      const r = 2.3 + trand() * 1.2
      // 树冠整个落在护边以内（离环道上的行人头顶远一些）
      const rr = Math.sqrt(trand()) * (Hl.moundR - 2.5 - r)
      const x = hl[0] + rr * Math.cos(a)
      const z = hl[1] + rr * Math.sin(a)
      const top = PAVE_Y + Hl.moundH
      const base = PAVE_Y + Hl.curbH
      const y =
        base +
        (top - base) * Math.pow(Math.max(0, 1 - (rr / Hl.moundR) ** 2), 0.7) -
        0.3
      addTree(b, x, y, z, {
        r,
        trunkH: r * 0.7,
        trunkR: 0.3,
        color: C.moundTrees[k % 3],
        detail: 0,
        yaw: trand() * 6.28
      })
    }
  }

  /* ---- 13. 步行路径 ---- */
  const walkways = buildWalkways({
    axis,
    main,
    jiupin,
    shuian,
    corridor: corridorPath,
    hl,
    jSide
  })

  /* ---- 出网格 ---- */
  const meshes = []
  const g = b.bake()
  if (g) {
    const mesh = new Mesh(g, landmarkMaterial())
    // 调试信息（Node 校验脚本读取）：锦里民居布置
    mesh.userData.layout = { houses }
    meshes.push(mesh)
  }
  const gg = gb.bake()
  if (gg) {
    const mat = landmarkMaterial()
    mat.side = FrontSide
    meshes.push(new Mesh(gg, mat))
  }
  return { meshes, zones, markerHeight, walkways }
}

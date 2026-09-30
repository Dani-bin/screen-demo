/*
 * 望江楼（崇丽阁 + 园南仿古九孔桥）
 * ----------------------------------------------------------
 * 锦江南岸的望江楼公园（纪念唐代女诗人薛涛）与园南的仿古九孔「新九眼桥」。本景点包含：
 *   1. 崇丽阁（望江楼，主角）：四层四重檐，下两层四方、上两层八角，层层内收；
 *      翠绿琉璃瓦、红橙封檐板加金线、深褐柱，翼角高翘（比统一规则更翘，川派楼阁特征），
 *      檐角挂小金铃，八角攒尖顶上鎏金葫芦宝顶，坐在红砂石栏杆台基上（台阶朝园内西南）；
 *   2. 文物区其余建筑：濯锦楼（两层、四周回廊，沿江如船舫）、吟诗楼（二层三檐、四面敞开，
 *      坐在假山石台上）、浣笺亭（T 形单层敞轩）、薛涛井（圆形石台、红砂石栏、八角井口，
 *      背后一段红墙中嵌绿琉璃顶牌坊）；
 *   3. 公园：园内其余 OSM 楼改成灰瓦坡顶矮房；地面成簇细竹代替普通树（文物区周边加密）；
 *      公园临江的东、南两面做灰色石砌驳岸（高出水面约 1.7 m）加白石栏杆；
 *   4. 新九眼桥：九孔半圆石拱（孔径由中间 9.9 m 向两端递减到 4.9 m）、驼背桥面、两侧石栏，
 *      每个桥墩外侧伸出一只石雕瑞兽头（吸水兽，比例放大一倍）；不放大；
 *   5. 崇丽阁前江湾一艘游船（复用 figures.js 的游船，单独 Mesh、不投影）。
 * 返回 walkways（到站时人群系统在其上生成行人）：沿江步道、文物区环路、园区主路、
 * 薛涛井环、崇丽阁台基环、九孔桥桥顶两侧人行边道。
 *
 * 插画式放大：崇丽阁真实通高 27.98 m、台基 18 m，在能与九孔桥同框的镜头里只占画宽约 5%。
 * 因此文物区一组（崇丽阁、濯锦楼、吟诗楼、浣笺亭、薛涛井）以 GROUP 中心整体 ×1.6，
 * 与合江亭、纪念碑的放大一致；下面的尺寸常量都写真实尺寸，放大只在坐标系 G 上做一次。
 * 放大后崇丽阁台基东角、濯锦楼东侧会伸进锦江，故整组再向陆地（西、略偏南）平移 GROUP.shift，
 * 台基东角离水边约 4.8 m、濯锦楼约 3 m，中间是驳岸石墙（Node 按水面多边形与河道带核对过）。
 * 被放大组挤到的薛涛纪念馆、枕流两栋灰瓦房：中心随组一起换算（相对位置不变）、本身不放大。
 *
 * 定位：崇丽阁、濯锦楼、吟诗楼、浣笺亭按名称查 OSM 楼（取最小外接矩形），查不到时用设计坐标；
 * 无名的园内小楼按顶点平均点就近匹配（≤ 6 m）。ctx 里没有公园 / 水面数据，
 * 公园轮廓、驳岸线（水面多边形与 48 m 河道带的并集边界）、园中湖轮廓离线算好后以经纬度常量写在下面。
 * 替换区用公园轮廓本身：园内 11 栋 OSM 楼全部由本模块重建，普通树也不再撒进园内（由竹林代替）。
 */
import {
  CylinderGeometry,
  ExtrudeGeometry,
  Matrix4,
  Mesh,
  Shape,
  Vector3
} from "three"
import { THEME } from "../theme.js"
import {
  hashInts,
  mulberry32,
  pointInPolygon,
  polygonBounds
} from "../utils.js"
import { ColorBuilder, frame, landmarkMaterial, local } from "./kit/builder.js"
import {
  centroid,
  distToSegment,
  findBuilding,
  minAreaRect,
  rectFrame,
  rectPolygon
} from "./kit/footprint.js"
import {
  box,
  cylinder,
  fromTriangles,
  polygonVertex,
  prism,
  sweepBar
} from "./kit/shapes.js"
import {
  finial,
  hipRidges,
  hipRoof,
  pyramidRidges,
  pyramidRoof,
  roofHeight
} from "./kit/roofs.js"
import {
  addBalustrade,
  addColumns,
  addPitchedHouse,
  addPlatform,
  housePieces,
  clamp,
  eaveDrop
} from "./kit/parts.js"
import { addBoat } from "./kit/figures.js"
import { roundedLoop } from "./kit/walkways.js"

const L = THEME.landmark
const DEG = Math.PI / 180

/* ---------------- 本景点专用配色 ---------------- */

const GLAZE_GREEN = "#3F9E78" // 崇丽阁翠绿琉璃瓦（薛涛井牌坊同色）
const FASCIA_RED = "#C8442E" // 红橙封檐板、屋脊、翼角鳌尖
const BRIGHT_GOLD = "#E8B838" // 鎏金宝顶、檐角金铃、封檐金线
const DARK_COLUMN = "#4A2A24" // 深褐柱（崇丽阁、濯锦楼、吟诗楼）
const DARK_LATTICE = "#5C3026" // 深褐红格扇 / 芯体
const SANDSTONE = "#B5725C" // 红砂石台基、栏杆
const WELL_STONE = "#B9B2A4" // 薛涛井石台
const WELL_WALL = "#B03C30" // 薛涛井背后红墙
const ROCK = "#8C8274" // 吟诗楼假山石
const ROCK_DARK = "#766C60"
const BRIDGE_STONE = "#9AA3A8" // 九孔桥青石
const BRIDGE_LIGHT = "#B6BDC0" // 桥面压面石、拱券石
const ARCH_DARK = "#3E474D" // 拱洞内侧
const BEAST = "#7A858C" // 瑞兽头
const BANK_STONE = "#8E9296" // 石砌驳岸
const BAMBOO = ["#6FAE4C", "#86C05A", "#3F7F3A", "#5E9E44"] // 竹叶：亮绿、嫩绿、深绿、中绿

/* ---------------- 定位常量（经纬度，离线由 OSM 算出） ---------------- */
// 以下常量都由 public/city/chengdu.json（scripts/fetch-osm-city.py 生成）离线算出，
// 局部坐标经 projection.js 的 toLonLat 换成经纬度（6 位小数，约 0.1 m）。
// 重新拉数据后若公园、河道、园内楼轮廓有变，需按各条注释里的方法重算后再核对步行路径与竹林。

// 文物区放大组：以设计文档给的 (2425, 2735) 为中心 ×1.6，再平移 shift（世界米，X 东 Z 南）；
// shift 按「放大后崇丽阁台基、濯锦楼不入水」在 Node 里对 water 多边形与河道带试算取定。
// cityData.js 望江楼站的落点（放大后的阁心）由这里的放大中心、倍数与平移换算得出，改其一需同步另一处
const GROUP = { lon: 104.091023, lat: 30.632658, scale: 1.6, shift: [-16, 5] }

// 文物区四栋有名的楼（按名称查 chengdu.json buildings；lon/lat 为其最小外接矩形中心，
// 查不到时退回这里的坐标与尺寸，bearing 为长轴方位）
const CHONGLI = {
  name: "崇丽阁",
  lon: 104.091172,
  lat: 30.632714,
  bearing: 135
}
const ZHUOJIN = {
  name: "濯锦楼",
  lon: 104.09113,
  lat: 30.63298,
  w: 23.5,
  d: 11.1,
  bearing: 159
}
const YINSHI = {
  name: "吟诗楼",
  lon: 104.091221,
  lat: 30.632394,
  w: 16.7,
  d: 11.6,
  bearing: 175.5
}
const HUANJIAN = { name: "浣笺亭", lon: 104.090736, lat: 30.632629 }
// 薛涛井（OSM 无，按导游图估计），背后红墙沿方位 86°（与浣笺亭同向）
const WELL = { lon: 104.090627, lat: 30.632784, bearing: 86 }

// 园内其余 OSM 楼（chengdu.json buildings 里落在公园轮廓内的无名楼，此处为各自的顶点平均点，
// 构建时按 ≤ 6 m 就近匹配）：前两栋随放大组换算中心（不放大），其余原位重建。
// 重算：buildingsInZones(buildings, [PARK]) 取园内楼，去掉四栋有名的，求 polygonCenter
const HOUSES = [
  { lon: 104.090511, lat: 30.633045, follow: true, wall: "timber" }, // 薛涛纪念馆（推测）
  { lon: 104.090249, lat: 30.632753, follow: true, wall: "plaster" }, // 枕流（推测）
  { lon: 104.088529, lat: 30.631431, wall: "plaster" },
  { lon: 104.089606, lat: 30.631165, wall: "timber" },
  { lon: 104.090854, lat: 30.631321, wall: "plaster" },
  { lon: 104.090643, lat: 30.63075, wall: "plaster" }, // 茶楼（cafe）
  { lon: 104.088608, lat: 30.630112, wall: "timber" }
]

// 望江楼公园轮廓：chengdu.json parks 里包含崇丽阁的那个多边形（OSM way 116486191，28 点，原样照抄）；
// 用作替换区与竹林范围。重算：取 parks 中 pointInPolygon(崇丽阁中心) 为真的多边形
const PARK = [
  [104.089731, 30.634645],
  [104.088751, 30.632547],
  [104.088623, 30.632195],
  [104.08851, 30.631911],
  [104.088381, 30.631642],
  [104.087577, 30.629906],
  [104.087453, 30.629653],
  [104.087447, 30.629291],
  [104.089046, 30.629316],
  [104.089348, 30.629366],
  [104.08976, 30.629465],
  [104.090086, 30.629609],
  [104.090374, 30.629747],
  [104.090654, 30.629904],
  [104.090886, 30.630245],
  [104.090983, 30.630545],
  [104.091058, 30.630991],
  [104.09109, 30.631123],
  [104.091332, 30.631665],
  [104.09141, 30.631749],
  [104.091409, 30.632547],
  [104.091356, 30.632786],
  [104.091086, 30.633298],
  [104.090862, 30.633775],
  [104.090549, 30.634078],
  [104.090412, 30.634365],
  [104.090277, 30.634735],
  [104.090145, 30.634713]
]
// 驳岸线：公园临江一侧的实际水边，自西南桥头沿南岸、东岸到北端（公园在前进方向左侧，buildBank 依赖此顺序）。
// 重算：沿 PARK 第 7～27 点（临江的边）每约 3 m 取点，沿指向园内的法向每 0.25 m 内移，
// 直到既不在 chengdu.json 的 water 多边形里、离 rivers 中心线也 ≥ 24.3 m（河道带宽 theme.riverWidth = 48），
// 再以 0.6 m 容差 Douglas-Peucker 抽稀。南岸的河道带伸进公园轮廓最多约 8 m，故不能直接用公园轮廓
const BANK = [
  [104.087445, 30.629366],
  [104.088522, 30.629342],
  [104.089311, 30.629392],
  [104.089399, 30.629404],
  [104.090084, 30.629612],
  [104.090372, 30.629749],
  [104.090651, 30.629905],
  [104.090883, 30.630246],
  [104.09098, 30.630545],
  [104.091055, 30.630991],
  [104.091087, 30.631124],
  [104.091329, 30.631667],
  [104.091407, 30.631749],
  [104.091406, 30.632546],
  [104.091353, 30.632785],
  [104.091083, 30.633297],
  [104.090859, 30.633773],
  [104.090546, 30.634077],
  [104.090409, 30.634364],
  [104.090277, 30.634732]
]
// 园中湖：chengdu.json water 里落在公园内的那个多边形（26 点）隔点抽稀为 13 点；竹林避开（另留 3 m）
const LAKE = [
  [104.088752, 30.630824],
  [104.088596, 30.630489],
  [104.088801, 30.630155],
  [104.089071, 30.630163],
  [104.089133, 30.630363],
  [104.089295, 30.630491],
  [104.089812, 30.630636],
  [104.090014, 30.630925],
  [104.090236, 30.631322],
  [104.089984, 30.631283],
  [104.089891, 30.630876],
  [104.089412, 30.630646],
  [104.089167, 30.630901]
]

// 新九眼桥：OSM way 1322100682（man_made=bridge，不在 chengdu.json 的 buildings 里）四角点的中心与长轴方位，
// 取自调研报告 2.3 节（南北向跨江）
const BRIDGE = { lon: 104.087285, lat: 30.62908, bearing: 178.5 }
// 游船漂移线：崇丽阁东侧锦江中心线（chengdu.json rivers 中锦江那条）上两点
const RIVER = [
  [104.091623, 30.632902],
  [104.091792, 30.63216]
]
const BOAT = { amp: 34, period: 60, length: 14 }
const RIVER_Y = 0.35 // 河面高度（roads.js 的河流水面）
const PARK_Y = 0.2 // 公园绿地顶面（terrain.js）

/* ---------------- 崇丽阁尺寸（真实，米） ---------------- */

// 各层：sides 边数；half（四方层）为柱网半边长、r（八角层）为柱网外接半径；
// eave 檐口高（边中点）；ov 出檐（垂直于边）；h 屋面曲面高度参数；tMax 截断（1 为完整攒尖）；
// lift 翼角起翘高度（约为出檐的 90%，比统一规则更翘，角上另加上挑的鳌尖）；cols 每边开间数
const CHONGLI_LEVELS = [
  {
    sides: 4,
    half: 7.2,
    eave: 6,
    ov: 2.5,
    h: 7,
    tMax: 0.52,
    lift: 2.2,
    cols: 3
  },
  { sides: 4, half: 5.5, eave: 11, ov: 2, h: 5.5, tMax: 0.67, lift: 1.8 },
  { sides: 8, r: 4.5, eave: 16, ov: 1.8, h: 5, tMax: 0.56, lift: 1.65 },
  { sides: 8, r: 3.5, eave: 21, ov: 1.6, h: 4.5, tMax: 1, lift: 1.45 }
]
// 各层芯体（墙）外接半径：一层是敞开柱廊里的深色内室，二层起为格扇墙
const CHONGLI_WALLS = [4.4 * Math.SQRT2, 5 * Math.SQRT2, 4.15, 3.2]
// 台基边长：规格 18 m；为让 4 m 高的插画小人能在柱列与栏杆之间绕台基走一圈（身体带净距 0.86 m），
// 加宽到 19.5 m（柱网 14.4 m 不变）
// 栏杆高 0.84 m（含望柱帽 0.96 m，放大后 1.54 m，低于小人身体带下沿 1.56 m）
const CHONGLI_BASE = { size: 19.5, h: 1.2, railH: 0.84 }
const CHONGLI_TOP = 27.98 // 宝顶尖（通高）
const FASCIA_H = 0.45 // 红橙封檐带高
const GOLD_LINE = 0.12 // 封檐下沿金线高

/* ---------------- 九孔桥尺寸（真实，不放大） ---------------- */

// 九孔孔径（自北向南，对称），桥墩宽 PIER
const SPANS = [4.9, 5.9, 7.2, 8.5, 9.9, 8.5, 7.2, 5.9, 4.9]
const PIER = 1.2
const BRIDGE_W = 20 // 桥宽
const DECK_TOP = 7.3 // 桥顶桥面高（高出水面约 7 m）
const DECK_END = 3.0 // 桥两端桥面高（比岸边道路高约 2 m）
const DECK_FLAT = 12 // 桥顶平段半长：人行边道只走这一段（y 为常数）
const RAMP = 12 // 两端引坡长（落到道路面 0.8）
const RAMP_FOOT = 0.8
const COPING = 0.3 // 桥面压面石厚

/* ---------------- 驳岸与竹林 ---------------- */

const BANK_TOP = 2.0 // 驳岸顶（高出水面约 1.7 m）
const BANK_T = 1.0 // 驳岸墙厚
const BANK_OUT = 0.4 // 墙外立面在驳岸线外（水侧）的距离，见 buildBank
const BANK_RAIL = 0.95 // 岸边白石栏杆高
const BAMBOO_SEED = 0x57a15a
const BAMBOO_GRID = 9 // 竹林撒点网格（米）
// 竹丛分布：count 片圆形丛区（半径 rMin～rMin + rVar），丛区内 / 文物区外围一圈 / 其余草坪的每格种植概率
const BAMBOO_GROVES = {
  count: 22,
  rMin: 16,
  rVar: 14,
  grove: 0.92,
  ring: 0.5,
  lawn: 0.05
}
const BAMBOO_CLEAR = 4.5 // 竹簇中心离步行路径可走带边缘的最小距离

/* ---------------- 步行路径（人群用，见 crowd.js） ---------------- */

// 园内路径：相对放大组中心 (gx, gz) 的世界米（X 东 Z 南，不随组放大），落脚在草坪 PARK_Y；
// 已按放大后的建筑、驳岸（离水边 ≥ 6.5 m）、湖与保留的园内小楼核对过
const PATHS = {
  // 沿江步道：崇丽阁南侧起，沿东岸、东南岸、南岸一直走到九孔桥北桥头东侧
  riverside: {
    points: [
      [29, 27],
      [30.5, 65],
      [31, 93],
      [21, 111],
      [-1, 168],
      [-11, 215],
      [-19, 257],
      [-40, 293],
      [-67, 311],
      [-95, 326],
      [-127, 341],
      [-163, 352],
      [-239, 358],
      [-325, 356]
    ],
    width: 2.2,
    density: 1
  },
  // 文物区环路：濯锦楼西 → 崇丽阁西（台阶前）→ 吟诗楼西 → 浣笺亭南、西 → 薛涛井西、北 → 回到濯锦楼西
  loop: {
    points: [
      [-22, -47],
      [-27, -23],
      [-32, 3],
      [-23, 31],
      [-7, 55],
      [-7, 77],
      [-33, 71],
      [-63, 45],
      [-91, 37],
      [-100, 10],
      [-99, -14],
      [-92, -34],
      [-77, -48],
      [-49, -52],
      [-29, -59]
    ],
    closed: true,
    width: 2.2,
    density: 1.3
  },
  // 园区主路（西北段）：自园西北斜穿到文物区西口（与环路相接处折返）
  diagonal: {
    points: [
      [-165, -97],
      [-140, -65],
      [-113, -35],
      [-101, -17]
    ],
    width: 2.4,
    density: 1
  }
}
// 崇丽阁台基环：阁坐标系（真实尺寸）里的圆角方环，居中夹在一层柱列外皮（7.52）与台基栏杆内皮（9.37）
// 之间；可走宽 1.1 m（世界米），两侧身体外扩 0.8 m 后仍离柱与栏杆约 0.13 m；路面 = 台基顶
const TERRACE_WALK = { half: 8.44, r: 0.9, width: 1.1, density: 3 }
// 薛涛井环：井台外一圈（井坐标系真实半径），在草坪上
const WELL_WALK = { r: 6.2, width: 1.2, density: 2 }
// 九孔桥：桥顶平段两侧人行边道（桥坐标系 |u| ≤ x、z = ±z），路面 = 桥顶
const DECK_WALK = { x: 11, z: 8, width: 1.4, density: 3 }

/* ---------------- 通用小工具 ---------------- */

const lerp = (a, b, t) => a + (b - a) * t
/**
 * 与 roofs.js 的 biasS（未导出）相同的「向两端加密」参数映射，复制于此，使封檐带与屋面翘角曲线一致；
 * roofs.js 若修改该映射需同步这里
 */
const biasS = (u) => Math.sign(u) * (1 - Math.pow(1 - Math.abs(u), 1.6))
/** 四边形 → 两个三角形（写进 out） */
const quad = (out, a, b, c, d) => out.push(...a, ...b, ...c, ...a, ...c, ...d)

/** 矩阵乘积 a × b（均不改动） */
const mul = (a, b) => a.clone().multiply(b)

/* ---------------- 崇丽阁 ---------------- */

/**
 * 攒尖檐口的装饰：红橙封檐带 + 下沿金线（沿翘角曲线）、每个角一只上挑的鳌尖、一只金铃。
 * m 为屋面坐标系（屋面 t = 0 的檐口在 y = 0）；R 为檐口外接半径，h / curl 与屋面相同。
 */
function eaveTrim(b, m, sides, R, h, curl) {
  const band = []
  const gold = []
  const N = 8
  const out1 = (R + 0.06) / R
  const out2 = (R + 0.1) / R
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
      const x0 = lerp(a0[0], a1[0], u0)
      const z0 = lerp(a0[1], a1[1], u0)
      const x1 = lerp(a0[0], a1[0], u1)
      const z1 = lerp(a0[1], a1[1], u1)
      // 封檐带：盖住屋面自带的绿色封檐板（略向外 6 cm）
      quad(
        band,
        [x0 * out1, y0 + 0.04, z0 * out1],
        [x1 * out1, y1 + 0.04, z1 * out1],
        [x1 * out1, y1 - FASCIA_H, z1 * out1],
        [x0 * out1, y0 - FASCIA_H, z0 * out1]
      )
      quad(
        gold,
        [x0 * out2, y0 - FASCIA_H + 0.02, z0 * out2],
        [x1 * out2, y1 - FASCIA_H + 0.02, z1 * out2],
        [x1 * out2, y1 - FASCIA_H - GOLD_LINE, z1 * out2],
        [x0 * out2, y0 - FASCIA_H - GOLD_LINE, z0 * out2]
      )
    }
  }
  b.add(fromTriangles(band), FASCIA_RED, m)
  b.add(fromTriangles(gold), BRIGHT_GOLD, m)
  // 角部：鳌尖（沿对角线向外、向上挑起的细条）与金铃
  const yc = curl * h
  for (let k = 0; k < sides; k++) {
    const [ux, uz] = polygonVertex(sides, 1, k)
    const p = (r, y) => [ux * r, yc + y, uz * r]
    b.add(
      sweepBar(
        [p(R - 0.6, -0.1), p(R + 0.2, 0.25), p(R + 0.55, 1.1)],
        0.28,
        0.24
      ),
      FASCIA_RED,
      m
    )
    b.add(
      cylinder(0.17, 0.07, 0.38, { segments: 6, caps: true }),
      BRIGHT_GOLD,
      local(m, ux * (R - 0.35), yc - FASCIA_H - 0.75, uz * (R - 0.35))
    )
  }
}

/**
 * 一层柱：四方层每边 cols 间（柱位含角柱），八角层只在顶点。
 * topAt(s) 给出柱顶高度：s ∈ [-1, 1] 为柱位在所在边上的屋面参数（角柱 s = ±1，
 * 屋面在戗脊处有起翘，角柱要比边中的柱高，才顶得住翘起的屋角）
 */
function levelColumns(b, f, sides, rc, cols, y0, topAt, radius) {
  for (let k = 0; k < sides; k++) {
    const v0 = polygonVertex(sides, rc, k)
    const v1 = polygonVertex(sides, rc, k + 1)
    for (let j = 0; j < cols; j++) {
      const u = j / cols
      b.add(
        cylinder(radius, radius * 0.9, topAt(2 * u - 1) - y0),
        DARK_COLUMN,
        local(f, lerp(v0[0], v1[0], u), y0, lerp(v0[1], v1[1], u))
      )
    }
  }
}

/**
 * 崇丽阁：红砂石台基（西南面台阶）+ 栏杆 + 四层四重檐 + 鎏金葫芦宝顶。
 * f 为阁的坐标系（局部 +Z 朝西南、含放大）；返回宝顶尖高度（f 的局部米数）。
 */
function buildChongli(b, f) {
  const { size, h: bh, railH } = CHONGLI_BASE
  addPlatform(b, f, {
    w: size,
    d: size,
    h: bh,
    steps: "front",
    color: SANDSTONE
  })
  // 台基顶一圈栏杆，正面台阶口留缺口
  const e = size / 2 - 0.25
  const gap = 3.6
  addBalustrade(b, f, {
    points: [
      [gap, e],
      [e, e],
      [e, -e],
      [-e, -e],
      [-e, e],
      [-gap, e]
    ],
    closed: false,
    h: railH,
    y: bh,
    postSpacing: 2.3,
    color: SANDSTONE
  })

  let yBase = bh
  CHONGLI_LEVELS.forEach((lv, i) => {
    const n = lv.sides
    const rc = n === 4 ? lv.half * Math.SQRT2 : lv.r
    const ovR = lv.ov / Math.cos(Math.PI / n) // 攒尖的出檐按外接半径方向给
    const R = rc + ovR
    const curl = lv.lift / lv.h
    // 柱线在屋面上的 t（攒尖沿径向插值：柱线外接半径 rc = R·(1 − t)）；
    // 柱顶埋进柱线处的屋面以下 5 cm，屋面高度按柱位的 s 取（含翼角起翘 curl·h·s⁴·(1 − t)²）
    const tc = ovR / R
    const topAt = (s) => lv.eave + roofHeight(s, tc, lv.h, curl) - 0.05
    const colTop = topAt(0)
    levelColumns(b, f, n, rc, lv.cols ?? 1, yBase, topAt, i === 0 ? 0.32 : 0.26)
    const wr = CHONGLI_WALLS[i]
    b.add(prism(n, wr, wr, colTop - yBase), DARK_LATTICE, local(f, 0, yBase, 0))
    const ro = {
      overhang: ovR,
      curl,
      tMax: lv.tMax,
      ridges: false,
      thick: 0.1,
      segT: lv.tMax < 1 ? 4 : 6
    }
    const m = local(f, 0, lv.eave, 0)
    b.add(pyramidRoof(n, rc, lv.h, ro), GLAZE_GREEN, m)
    b.add(pyramidRidges(n, rc, lv.h, ro), FASCIA_RED, m)
    eaveTrim(b, m, n, R, lv.h, curl)
    yBase = lv.eave
  })
  // 鎏金葫芦宝顶：底略埋进攒尖顶
  const top = CHONGLI_LEVELS[CHONGLI_LEVELS.length - 1]
  const apex = top.eave + top.h
  const fy = apex - 0.25
  b.add(finial(CHONGLI_TOP - fy), BRIGHT_GOLD, local(f, 0, fy, 0))
  return CHONGLI_TOP
}

/* ---------------- 楼阁 / 敞轩（灰瓦） ---------------- */

/**
 * 楼阁 / 敞轩：若干层（每层一圈柱、可选芯体、额枋），层间一圈腰檐（截断四坡翘角顶）与楼板，
 * 顶上完整四坡翘角顶（歇山近似）。w × d 为柱网（w ≥ d，屋脊沿 X），原点在底层地坪中心（y = y0）。
 * floors：[{ h 层高, core 芯体相对柱网的内缩（米，缺省为敞开）, cols = true 是否有柱 }]
 * @returns {number} 屋脊最高点 y
 */
function addStack(b, parent, o) {
  const { w, d, y0 = 0, floors, pent = 1.1, roofH, overhang } = o
  const curl = o.curl ?? 0.4
  const ridge = o.ridge ?? 0.55
  const col = o.column ?? DARK_COLUMN
  const coreColor = o.core ?? DARK_LATTICE
  const tMax = 0.5
  const pentH = 1.3
  let y = y0
  floors.forEach((fl, i) => {
    if (i > 0) {
      // 腰檐：柱线外 0.35 m 处屋面正好等于楼面；屋脊比例让内缘缩进上层芯体（或楼板）以内
      const inner = fl.core != null ? fl.core + 0.15 : 0.15
      const pr = clamp(
        (w / 2 - inner - (w / 2 + pent) * (1 - tMax)) / ((w / 2) * tMax),
        0.2,
        0.9
      )
      // 腰檐只剩外半圈，坡面细分 4 行已足够圆顺
      const po = {
        overhang: pent,
        curl,
        ridge: pr,
        tMax,
        ridges: false,
        segT: 4
      }
      const m = local(parent, 0, y - eaveDrop(d / 2, pent, pentH, 1.5, 0.35), 0)
      b.add(hipRoof(w, d, pentH, po), L.roof, m)
      b.add(hipRidges(w, d, pentH, po), L.roofRidge, m)
      // 楼板（盖住腰檐内圈开口）与平座矮栏
      b.add(box(w + 0.3, 0.3, d + 0.3), col, local(parent, 0, y - 0.3, 0))
      railRing(b, parent, w, d, y, 0.8, col)
    }
    if (fl.cols !== false) {
      addColumns(b, parent, {
        w,
        d,
        h: fl.h,
        y,
        spacing: 3.2,
        radius: 0.25,
        color: col
      })
    }
    if (fl.core != null) {
      b.add(
        box(w - 2 * fl.core, fl.h, d - 2 * fl.core),
        coreColor,
        local(parent, 0, y, 0)
      )
    }
    beamRing(b, parent, w, d, y + fl.h - 0.4, 0.4, DARK_LATTICE)
    y += fl.h
  })
  const ro = { overhang, curl, ridge, ridges: false }
  const yr = y - eaveDrop(d / 2, overhang, roofH, 1.5, 0.5)
  const m = local(parent, 0, yr, 0)
  b.add(hipRoof(w, d, roofH, ro), L.roof, m)
  b.add(hipRidges(w, d, roofH, ro), L.roofRidge, m)
  return yr + roofH * 1.1
}

/** 柱顶一圈额枋（矩形 w × d 的柱线上），底在 y */
function beamRing(b, parent, w, d, y, bh, color) {
  const t = 0.3
  for (const sz of [-1, 1]) {
    b.add(box(w + t, bh, t), color, local(parent, 0, y, (sz * d) / 2))
  }
  for (const sx of [-1, 1]) {
    b.add(box(t, bh, d), color, local(parent, (sx * w) / 2, y, 0))
  }
}

/** 矩形一圈矮栏板（平座栏杆），沿柱线外 0.05 m，底在 y */
function railRing(b, parent, w, d, y, h, color) {
  const t = 0.1
  for (const sz of [-1, 1]) {
    b.add(box(w + 0.1, h, t), color, local(parent, 0, y, sz * (d / 2 + 0.05)))
  }
  for (const sx of [-1, 1]) {
    b.add(box(t, h, d), color, local(parent, sx * (w / 2 + 0.05), y, 0))
  }
}

/** 濯锦楼：两层（檐口约 4 / 7.5），四周回廊，灰瓦翘角顶；f 局部 X 沿长轴 */
function buildZhuojin(b, f, w, d) {
  const pad = 0.6
  addPlatform(b, f, { w, d, h: 0.5, steps: "both", color: L.granite })
  return addStack(b, f, {
    w: w - 2 * pad,
    d: d - 2 * pad,
    y0: 0.5,
    floors: [
      { h: 3.6, core: 1.4 },
      { h: 3.7, core: 1.1 }
    ],
    pent: 1.1,
    roofH: 3.6,
    overhang: 1.4,
    ridge: 0.6
  })
}

/**
 * 吟诗楼：假山石台（高 2 m）上的二层三檐楼：一层腰檐、二层腰檐、顶檐，四面敞开（只留很小的芯体）。
 * f 局部 X 沿长轴；w × d 为 OSM 轮廓（即石台范围）。
 */
function buildYinshi(b, f, w, d, rand) {
  const rockH = 2
  // 假山石台：几块高低、大小不一的石块拼成不规整的台，顶面齐平在 rockH
  b.add(box(w - 1, rockH, d - 1), ROCK, f)
  const blocks = [
    [-w / 2 + 1.2, -d / 2 + 1, 3.2, 2.6],
    [w / 2 - 1.5, -d / 2 + 1.4, 3.6, 3],
    [w / 2 - 1, d / 2 - 1.6, 2.8, 3.4],
    [-w / 2 + 1.6, d / 2 - 1.1, 3.8, 2.4],
    [0, -d / 2 + 0.6, 4.2, 1.6],
    [4.2, d / 2 - 0.5, 3.4, 1.4] // 西侧中段：让开登台石阶（x ∈ ±1.2）
  ]
  blocks.forEach(([x, z, bw, bd], i) => {
    const hh = rockH + 0.2 + rand() * 0.9
    b.add(
      box(bw, hh, bd),
      i % 2 ? ROCK_DARK : ROCK,
      local(f, x, 0, z, (rand() - 0.5) * 0.6)
    )
  })
  // 登台石阶（朝西、园内一侧）
  for (let k = 1; k <= 5; k++) {
    b.add(
      box(2.4, rockH - (k - 1) * 0.4, 0.45),
      ROCK_DARK,
      local(f, 0, 0, d / 2 - 0.3 + k * 0.45)
    )
  }
  const cw = w - 3.4
  const cd = d - 3.2
  return addStack(b, f, {
    w: cw,
    d: cd,
    y0: rockH,
    floors: [
      { h: 3.2, core: cd / 2 - 1.2 },
      { h: 3.0, core: cd / 2 - 1.4 },
      { h: 1.5, core: 0.9, cols: false }
    ],
    pent: 1.0,
    roofH: 3.2,
    overhang: 1.3,
    ridge: 0.5
  })
}

/** 浣笺亭：T 形单层敞轩（两块矩形各一套柱与翘角灰瓦顶，屋面相交成组合屋面） */
function buildHuanjian(b, G, rects) {
  let top = 0
  for (const r of rects) {
    const f = mul(G, rectFrame(r, 0, 180))
    addPlatform(b, f, {
      w: r.w,
      d: r.d,
      h: 0.45,
      steps: "none",
      color: L.granite
    })
    top = Math.max(
      top,
      addStack(b, f, {
        w: r.w - 1.2,
        d: r.d - 1.2,
        y0: 0.45,
        floors: [{ h: 3.4 }],
        roofH: Math.min(3.2, 0.42 * (r.d - 1.2)),
        overhang: 1.1,
        ridge: 0.6
      })
    )
  }
  return top
}

/**
 * 薛涛井：圆形石台（直径 10、高 0.45）+ 红砂石栏（背面留口）+ 莲花井台、八角井口加石盖；
 * 北侧一段 12 m 红墙（灰瓦墙帽），中间嵌一座约 4.5 m 高、绿琉璃顶的砖砌牌坊。
 * f：原点井心，局部 -Z 朝北（红墙一侧），X 沿红墙。
 */
function buildWell(b, f) {
  const R = 5
  const ph = 0.45
  b.add(cylinder(R, R, ph, { segments: 24, caps: true }), WELL_STONE, f)
  // 栏杆：16 根望柱（第 k 根在方位角 (k + 0.5) / 16 × 360° 处，180° 为 -Z 即红墙一侧）。
  // 照片 wj_2191：栏杆是朝红墙敞开的 U 形，这里望柱 5 → 10 之间（约 124°～236°，开口 112°）
  // 不设栏板，开口里的望柱 6～9 也不立
  const n = 16
  const posts = []
  for (let k = 0; k < n; k++) {
    const a = ((k + 0.5) / n) * Math.PI * 2
    posts.push([Math.sin(a) * (R - 0.3), Math.cos(a) * (R - 0.3)])
  }
  const open0 = 5
  const open1 = 10
  for (let k = 0; k < n; k++) {
    const [x, z] = posts[k]
    if (k > open0 && k < open1) continue
    b.add(box(0.3, 1.05, 0.3), SANDSTONE, local(f, x, ph, z))
    if (k === open0) continue
    const [x1, z1] = posts[(k + 1) % n]
    const len = Math.hypot(x1 - x, z1 - z)
    const yaw = Math.atan2(-(z1 - z), x1 - x)
    b.add(
      box(len, 0.65, 0.16),
      SANDSTONE,
      local(f, (x + x1) / 2, ph + 0.15, (z + z1) / 2, yaw)
    )
  }
  // 井台、井口、石盖
  b.add(
    cylinder(1.5, 1.6, 0.18, { segments: 12, caps: true }),
    L.granite,
    local(f, 0, ph, 0)
  )
  b.add(prism(8, 0.85, 0.85, 0.55), L.granite, local(f, 0, ph + 0.18, 0))
  b.add(
    cylinder(0.72, 0.72, 0.16, { segments: 10, caps: true }),
    WELL_STONE,
    local(f, 0, ph + 0.73, 0)
  )
  // 红墙：井心北 8 m，长 12、高 3、厚 0.5，灰瓦墙帽（井外环路与牌坊匾额之间留出行人身体净距）
  const zw = -8
  b.add(box(12, 3, 0.5), WELL_WALL, local(f, 0, 0, zw))
  b.add(box(12.4, 0.35, 0.9), L.roof, local(f, 0, 3, zw))
  // 牌坊：中段加高到 4.2 的砖墙 + 金黄线脚 + 暗色匾 + 绿琉璃翘角小顶
  b.add(box(4.2, 4.2, 0.8), WELL_WALL, local(f, 0, 0, zw))
  b.add(box(4.4, 0.18, 0.95), L.glaze, local(f, 0, 3.55, zw))
  b.add(box(1.1, 1.9, 0.12), L.timber, local(f, 0, 1.2, zw + 0.42))
  const ro = { overhang: 0.5, curl: 0.5, ridge: 0.5, ridges: false }
  const m = local(f, 0, 4.2, zw)
  b.add(hipRoof(4.2, 0.8, 0.9, ro), GLAZE_GREEN, m)
  b.add(hipRidges(4.2, 0.8, 0.9, ro), FASCIA_RED, m)
}

/* ---------------- 九孔桥 ---------------- */

/** 九孔各拱：拱心沿桥位置 x 与半径 r（半圆拱，拱脚在 y = 0，即水面以下一点） */
function archLayout() {
  const total = SPANS.reduce((a, s) => a + s, 0) + PIER * (SPANS.length - 1)
  let x = -total / 2
  return {
    half: total / 2,
    arches: SPANS.map((s) => {
      const a = { x: x + s / 2, r: s / 2 }
      x += s + PIER
      return a
    })
  }
}

/** 桥面高度（桥坐标 u，沿桥）：桥顶平段 → 缓降到桥端 → 引坡落到道路面 */
function deckY(u, half) {
  const a = Math.abs(u)
  if (a <= DECK_FLAT) return DECK_TOP
  if (a <= half) {
    const t = (a - DECK_FLAT) / (half - DECK_FLAT)
    return DECK_TOP - (DECK_TOP - DECK_END) * Math.pow(t, 1.3)
  }
  const t = Math.min(1, (a - half) / RAMP)
  return DECK_END - (DECK_END - RAMP_FOOT) * t
}

/** 桥面轮廓采样点 u（含平段两端、桥端、引坡脚） */
function deckSamples(half) {
  const us = [0, DECK_FLAT]
  for (let u = DECK_FLAT + 3; u < half; u += 3) us.push(u)
  us.push(half, half + RAMP)
  const all = [
    ...us
      .slice(1)
      .map((u) => -u)
      .reverse(),
    ...us
  ]
  return all
}

/**
 * 九孔桥：青石桥体（立面挖出九个半圆拱后沿宽度挤出）+ 深色拱腹 + 拱券石 + 压面石 + 两侧石栏 +
 * 桥墩瑞兽头 + 两端引坡；桥下铺一层水色薄板，盖住从桥下穿过的道路带。
 * f：局部 X 沿桥（指向南端），原点在桥心水面处。
 */
function buildBridge(b, f) {
  const { half, arches } = archLayout()
  const xe = half + RAMP
  const us = deckSamples(half)
  const depth = BRIDGE_W - 0.4
  // 桥体立面：底边 y = -0.6（埋进地面 / 水面以下），拱脚 y = 0，顶边沿桥面轮廓（压面石以下）
  const s = new Shape()
  s.moveTo(-xe, -0.6)
  for (const a of arches) {
    s.lineTo(a.x - a.r, -0.6)
    s.lineTo(a.x - a.r, 0)
    s.absarc(a.x, 0, a.r, Math.PI, 0, true)
    s.lineTo(a.x + a.r, -0.6)
  }
  s.lineTo(xe, -0.6)
  for (let i = us.length - 1; i >= 0; i--) {
    s.lineTo(us[i], deckY(us[i], half) - COPING)
  }
  s.closePath()
  const body = new ExtrudeGeometry(s, {
    depth,
    bevelEnabled: false,
    curveSegments: 5
  })
  body.translate(0, 0, -depth / 2)
  b.add(body, BRIDGE_STONE, f)

  // 拱腹（深色半圆筒，贴在拱洞内侧）与两个立面上的拱券石
  for (const a of arches) {
    // 圆筒轴沿 Y，θ ∈ [π/2, 3π/2]（x = r·sinθ, z = r·cosθ）绕 X 转 90° 后正是轴沿 Z 的上半圆。
    // 拱洞弧线由 ExtrudeGeometry 按 curveSegments × 2 = 10 段取点（圆弧曲线加倍），
    // 圆筒也取 10 段、顶点角度与之对齐，并内缩 0.08 m，整圈都在拱洞面以内，不会交替露出条纹
    const barrel = new CylinderGeometry(
      a.r - 0.08,
      a.r - 0.08,
      depth,
      10,
      1,
      true,
      Math.PI / 2,
      Math.PI
    )
    barrel.rotateX(Math.PI / 2)
    barrel.translate(a.x, 0, 0)
    b.add(barrel, ARCH_DARK, f)
    for (const z of [-depth / 2, depth / 2]) {
      b.add(
        archRing(a.x, a.r, a.r + 0.55, 0.3),
        BRIDGE_LIGHT,
        local(f, 0, 0, z)
      )
    }
  }
  // 桥下水色薄板（只在河面范围内：桥心以北 31.5 m 到以南 27.5 m）；
  // 高过最高的道路面（0.9 m，且道路材质带多边形偏移），拱洞里看不到桥下穿过的白色道路带
  b.add(box(59, 0.05, depth - 0.2), THEME.water, local(f, -2, 0.95, 0))
  // 两端孔下是岸（桥心以北 31.5 m、以南 27.5 m 之外）：同样高度铺地面色薄板，盖住道路带
  const land = (u0, u1) =>
    b.add(
      box(u1 - u0, 0.05, depth - 0.2),
      THEME.ground,
      local(f, (u0 + u1) / 2, 0.95, 0)
    )
  land(-half, -31.5)
  land(27.5, half)

  // 压面石：沿桥面轮廓的宽条，顶面即桥面
  const line = us.map((u) => [u, deckY(u, half) - COPING, 0])
  b.add(sweepBar(line, BRIDGE_W + 0.4, COPING, { sink: 0.1 }), BRIDGE_LIGHT, f)

  // 两侧石栏：扶手与栏板沿桥面轮廓扫出，望柱约每 4.4 m 一根（引坡上也有）
  for (const sz of [-1, 1]) {
    const z = sz * (BRIDGE_W / 2 - 0.1)
    const rail = us.map((u) => [u, deckY(u, half) + 0.85, z])
    const panel = us.map((u) => [u, deckY(u, half) + 0.05, z])
    b.add(sweepBar(rail, 0.26, 0.2), BRIDGE_LIGHT, f)
    b.add(sweepBar(panel, 0.14, 0.75), BRIDGE_LIGHT, f)
    for (let u = -xe + 0.4; u <= xe - 0.4 + 1e-6; u += (2 * xe - 0.8) / 22) {
      const y = deckY(u, half)
      b.add(box(0.3, 1.2, 0.3), BRIDGE_LIGHT, local(f, u, y - 0.1, z))
    }
    // 引坡脚的抱鼓石
    for (const sx of [-1, 1]) {
      b.add(
        box(0.9, 1.3, 0.5),
        BRIDGE_STONE,
        local(f, sx * (xe - 0.5), RAMP_FOOT - 0.2, z)
      )
    }
  }

  // 瑞兽头：每个桥墩上方、东西两个立面各一只，向外探出（比例放大一倍）
  for (let i = 0; i < arches.length - 1; i++) {
    const a = arches[i]
    const u = a.x + a.r + PIER / 2
    const yh = Math.max(1.6, Math.min(a.r, arches[i + 1].r) * 0.95)
    for (const sz of [-1, 1]) {
      // 局部 +Z 朝外：桥坐标系 +Z 为西立面（sz = 1 直接用），东立面绕 Y 转 π
      const m = local(f, u, yh, sz * (depth / 2), sz > 0 ? 0 : Math.PI)
      b.add(box(1.1, 1.0, 1.3), BEAST, m) // 颈与头
      b.add(box(0.75, 0.55, 0.7), BEAST, local(m, 0, 0.12, 1.5)) // 吻部
      b.add(box(0.9, 0.45, 0.35), BEAST, local(m, 0, 1.0, 0.45)) // 双角 / 鬃
    }
  }
  return deckY(0, half)
}

/** 拱券石：半圆环（内半径 r0、外半径 r1，圆心 (x, 0)），拱脚落在 y = 0，挤出 depth */
function archRing(x, r0, r1, depth) {
  const s = new Shape()
  s.moveTo(x - r1, 0)
  s.absarc(x, 0, r1, Math.PI, 0, true)
  s.lineTo(x + r0, 0)
  s.absarc(x, 0, r0, 0, Math.PI, false)
  s.closePath()
  const g = new ExtrudeGeometry(s, {
    depth,
    bevelEnabled: false,
    curveSegments: 5
  })
  g.translate(0, 0, -depth / 2)
  return g
}

/* ---------------- 驳岸 ---------------- */

/**
 * 石砌驳岸：沿驳岸线（水边）一道厚 BANK_T 的石墙（外立面在水边，顶高 BANK_TOP）+ 压顶石，
 * 墙顶一道白石栏杆（扶手 + 腰栏 + 每约 9 m 一根望柱）。
 * line 按「西南桥头 → 南岸 → 东岸 → 北端」排列，公园始终在前进方向左侧（从上往下看、北在上），
 * 所以指向公园的法向直接取 (tz, −tx)。不能用「法向外 3 m 的点是否在公园轮廓里」判断：
 * OSM 公园轮廓在南岸伸进河道带 3 m 以上，两侧都会判成在园内，墙会建到水里。
 * 驳岸线取的是离水边最近的干点（离真实水边 0.25～0.5 m），墙外立面再向水侧让出 BANK_OUT，
 * 正好落在真实水边上（水下部分被水面挡住）。
 */
function buildBank(b, line) {
  for (let i = 0; i < line.length - 1; i++) {
    const [x0, z0] = line[i]
    const [x1, z1] = line[i + 1]
    const len = Math.hypot(x1 - x0, z1 - z0)
    if (len < 0.5) continue
    const tx = (x1 - x0) / len
    const tz = (z1 - z0) / len
    // 指向公园一侧的法向：前进方向左侧
    const nx = tz
    const nz = -tx
    const mx = (x0 + x1) / 2
    const mz = (z0 + z1) / 2
    const yaw = Math.atan2(-tz, tx)
    // o 为离驳岸线向公园一侧的距离（负值在水侧）
    const m = (o) => local(null, mx + nx * o, 0, mz + nz * o, yaw)
    const wallM = m(BANK_T / 2 - BANK_OUT)
    b.add(
      box(len + 0.3, BANK_TOP + 0.6, BANK_T),
      BANK_STONE,
      local(wallM, 0, -0.6, 0)
    )
    b.add(
      box(len + 0.4, 0.15, BANK_T + 0.2),
      L.granite,
      local(wallM, 0, BANK_TOP, 0)
    )
    const railM = m(0.35 - BANK_OUT)
    const yTop = BANK_TOP + 0.15
    b.add(
      box(len, 0.12, 0.16),
      L.marble,
      local(railM, 0, yTop + BANK_RAIL - 0.12, 0)
    )
    b.add(box(len, 0.1, 0.1), L.marble, local(railM, 0, yTop + 0.4, 0))
    const posts = Math.max(1, Math.round(len / 9))
    for (let p = 0; p < posts; p++) {
      const u = (p / posts - 0.5) * len
      b.add(box(0.22, BANK_RAIL, 0.22), L.marble, local(railM, u, yTop, 0))
    }
  }
}

/* ---------------- 竹林 ---------------- */

// 竹梢叶团的局部三角形顶点（单位尺寸：半径 1、高 1），四棱双锥：
// 顶尖 (0, 1, 0)，最宽一圈在 62% 高，下尖细长到 0.3 / h 处（像一束竹竿）
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
  return tris // 每项 [x, y, z, 是否在最宽一圈]；y = 0 的下尖在建模时抬到 0.3 m
})()

/**
 * 一簇竹：n 束细长的竹梢叶团从簇心附近向外微倾（5°～15°），高 h 上下浮动，
 * 亮绿、嫩绿、深绿、中绿混排；(x, y, z) 为簇心地面点。
 * 竹簇数量多（数百簇、上千束），逐束 ColorBuilder.add 太慢：这里直接把变换后的三角形顶点
 * 按颜色写进 bufs[颜色下标]，全部种完后每种颜色合成一个几何体再加进合批器。
 */
function addBamboo(bufs, x, y, z, rand, h, n) {
  const m = new Matrix4()
  const rx = new Matrix4()
  const ry = new Matrix4()
  const v = new Vector3()
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2
    const tilt = (5 + rand() * 10) * DEG
    const hh = h * (0.8 + rand() * 0.28)
    const r = hh * (0.095 + rand() * 0.035)
    const off = 0.4 + rand() * 1.4
    const out = bufs[Math.floor(rand() * BAMBOO.length)]
    ry.makeRotationY(a)
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

/**
 * 在公园里撒竹簇：BAMBOO_GRID 网格抖动取点，每格用「种子 + 格号」派生的独立随机流
 * （与数据顺序、别处是否种树都无关）。疏密：成片竹丛（固定种子取的若干圆形丛区）里几乎格格都种，
 * 文物区外围一圈（离崇丽阁 34～110 m）加密，其余草坪只零星点缀，形成「竹林 + 空旷草坪」的对比。
 * 落在公园内、离驳岸 ≥ 7 m、不在湖里、离障碍（建筑、广场）与步行路径足够远的点才种。
 * @returns {number} 种下的竹簇数
 */
function plantBamboo(b, park, bank, lake, obstacles, walkways, hub) {
  const bb = polygonBounds(park)
  const G = BAMBOO_GROVES
  const gr = mulberry32(BAMBOO_SEED)
  const groves = []
  for (let i = 0; i < G.count * 4 && groves.length < G.count; i++) {
    const x = bb.minX + gr() * (bb.maxX - bb.minX)
    const z = bb.minZ + gr() * (bb.maxZ - bb.minZ)
    const r = G.rMin + gr() * G.rVar
    if (pointInPolygon(x, z, park)) groves.push([x, z, r])
  }
  const nearLine = (x, z, pts, closed, lim) => {
    const n = closed ? pts.length : pts.length - 1
    for (let i = 0; i < n; i++) {
      if (distToSegment(x, z, pts[i], pts[(i + 1) % pts.length]) < lim)
        return true
    }
    return false
  }
  let count = 0
  const bufs = BAMBOO.map(() => [])
  const nx = Math.ceil((bb.maxX - bb.minX) / BAMBOO_GRID)
  const nz = Math.ceil((bb.maxZ - bb.minZ) / BAMBOO_GRID)
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const rand = mulberry32(hashInts(BAMBOO_SEED, ix, iz))
      const x = bb.minX + (ix + rand()) * BAMBOO_GRID
      const z = bb.minZ + (iz + rand()) * BAMBOO_GRID
      const keep = rand()
      const hr = rand()
      if (!pointInPolygon(x, z, park)) continue
      const dh = Math.hypot(x - hub[0], z - hub[1])
      let p = G.lawn
      if (dh > 34 && dh < 110) p = G.ring
      if (groves.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r)) {
        p = G.grove
      }
      if (keep > p) continue
      if (nearLine(x, z, bank, false, 7)) continue
      if (pointInPolygon(x, z, lake) || nearLine(x, z, lake, true, 3)) continue
      if (obstacles.some((o) => o(x, z))) continue
      if (
        walkways.some((w) =>
          nearLine(x, z, w.points, w.closed, w.width / 2 + BAMBOO_CLEAR)
        )
      )
        continue
      addBamboo(bufs, x, PARK_Y, z, rand, 8 + hr * 4, 4 + Math.floor(hr * 2.5))
      count++
    }
  }
  bufs.forEach((pos, i) => {
    if (pos.length) b.add(fromTriangles(pos), BAMBOO[i])
  })
  return count
}

/* ---------------- 定位 ---------------- */

/** 按名称查楼（取最小外接矩形）；查不到时用 spec 的设计坐标与尺寸 */
function locate(ctx, spec) {
  const [x, z] = ctx.project.toLocal(spec.lon, spec.lat)
  const i = findBuilding(ctx.buildings, spec.name, {
    near: [x, z],
    maxDist: 60
  })
  if (i >= 0) {
    return { rect: minAreaRect(ctx.buildings[i].p), pts: ctx.buildings[i].p }
  }
  return {
    rect: {
      cx: x,
      cz: z,
      w: spec.w ?? 15,
      d: spec.d ?? 14,
      bearing: spec.bearing ?? 0
    },
    pts: null
  }
}

/** 按顶点平均点就近匹配无名小楼（≤ 6 m），找不到返回 null */
function nearestBuilding(ctx, lon, lat) {
  const [x, z] = ctx.project.toLocal(lon, lat)
  let best = null
  let bestD = 6
  for (const bd of ctx.buildings) {
    if (!bd.p || bd.p.length < 3) continue
    // 先用首个顶点粗筛（园内小楼边长都在 60 m 以内），省掉全城逐栋求平均点
    const [px, pz] = bd.p[0]
    if (Math.abs(px - x) > 80 || Math.abs(pz - z) > 80) continue
    const [cx, cz] = centroid(bd.p)
    const dd = Math.hypot(cx - x, cz - z)
    if (dd < bestD) {
      best = bd
      bestD = dd
    }
  }
  return best
}

/* ---------------- 入口 ---------------- */

export function build(ctx) {
  const b = new ColorBuilder()
  const ll = (pts) => pts.map(([lon, lat]) => ctx.project.toLocal(lon, lat))
  const park = ll(PARK)
  const bank = ll(BANK)
  const lake = ll(LAKE)

  // 放大组坐标系 G：以组中心等比放大 S 倍后平移 shift；toWorld 为同一变换的平面版
  const [gx, gz] = ctx.project.toLocal(GROUP.lon, GROUP.lat)
  const S = GROUP.scale
  const [sx, sz] = GROUP.shift
  const G = new Matrix4()
    .makeTranslation(gx + sx, 0, gz + sz)
    .multiply(new Matrix4().makeScale(S, S, S))
    .multiply(new Matrix4().makeTranslation(-gx, 0, -gz))
  const toWorld = (x, z) => [gx + sx + S * (x - gx), gz + sz + S * (z - gz)]

  // 崇丽阁：OSM 菱形四边方位 45° / 135°，局部 +Z（台阶）朝园内西南
  const cl = locate(ctx, CHONGLI).rect
  const clBearing = ((cl.bearing % 90) + 90) % 90 // 取 0～90 内的边方位（约 45°）
  const fc = mul(G, frame(cl.cx, 0, cl.cz, clBearing))
  const top = buildChongli(b, fc) * S

  // 濯锦楼：局部 X 沿长轴，正面朝江（东北偏东）
  const zj = locate(ctx, ZHUOJIN).rect
  buildZhuojin(b, mul(G, rectFrame(zj, 0, zj.bearing - 90)), zj.w, zj.d)

  // 吟诗楼：正面（石阶）朝园内（西）
  const ys = locate(ctx, YINSHI).rect
  // 假山石块的高低与转角用固定种子，每次构建一致
  const rockRand = mulberry32(0x9e1)
  buildYinshi(
    b,
    mul(G, rectFrame(ys, 0, ys.bearing + 90)),
    ys.w,
    ys.d,
    rockRand
  )

  // 浣笺亭：T 形轮廓用 housePieces 在凹角处切成主体长条与北侧凸出两块；查不到 OSM 时退回单块
  const hj = locate(ctx, HUANJIAN)
  const hjRects = hj.pts ? housePieces(hj.pts).map((p) => p.rect) : [hj.rect]
  buildHuanjian(b, G, hjRects)

  // 薛涛井：局部 -Z 朝北（frame 的 -Z 指向 bearing - 90 → 北偏东 −4°）
  const [wx, wz] = ctx.project.toLocal(WELL.lon, WELL.lat)
  const fw = mul(G, frame(wx, 0, wz, WELL.bearing - 90))
  buildWell(b, fw)

  // 园内其余楼：灰瓦坡顶矮房；随组的两栋平移到换算后的中心
  // 竹林避让框：各栋矮房外接矩形外扩 3 m（只用于竹林撒点避让，不是替换区）
  const bambooAvoid = []
  for (const h of HOUSES) {
    const bd = nearestBuilding(ctx, h.lon, h.lat)
    if (!bd) continue
    let pts = bd.p
    if (h.follow) {
      const [cx, cz] = centroid(pts)
      const [nx, nz] = toWorld(cx, cz)
      pts = pts.map(([x, z]) => [x + nx - cx, z + nz - cz])
    }
    addPitchedHouse(b, pts, {
      eaveH: 4.6,
      ridgeH: 2.4,
      overhang: 0.9,
      wallColor: h.wall === "timber" ? L.timber : L.plaster
    })
    const r = minAreaRect(pts)
    bambooAvoid.push(rectPolygon(r.cx, r.cz, r.w + 6, r.d + 6, r.bearing))
  }

  // 九孔桥：局部 X 沿桥长（指向南端）
  const [bx, bz] = ctx.project.toLocal(BRIDGE.lon, BRIDGE.lat)
  const fb = frame(bx, 0, bz, BRIDGE.bearing - 90)
  buildBridge(b, fb)

  // 驳岸
  buildBank(b, bank)

  /* ---- 步行路径（世界坐标） ---- */
  const wp = new Vector3()
  const xz = (m, x, z) => {
    wp.set(x, 0, z).applyMatrix4(m)
    return [wp.x, wp.z]
  }
  const rel = (pts) => pts.map(([dx, dz]) => [gx + dx, gz + dz])
  const walkways = Object.values(PATHS).map((p) => ({
    points: rel(p.points),
    y: PARK_Y,
    width: p.width,
    closed: Boolean(p.closed),
    density: p.density
  }))
  // 崇丽阁台基环（阁坐标系含放大，真实尺寸换算到世界坐标；圆角半径按真实米）
  const tw = TERRACE_WALK
  walkways.push({
    points: roundedLoop({
      x0: -tw.half,
      x1: tw.half,
      z0: -tw.half,
      z1: tw.half,
      r: tw.r
    }).map(([x, z]) => xz(fc, x, z)),
    y: CHONGLI_BASE.h * S,
    width: tw.width,
    closed: true,
    density: tw.density
  })
  // 薛涛井环：24 边形
  walkways.push({
    points: Array.from({ length: 24 }, (_, k) => {
      const a = (k / 24) * Math.PI * 2
      return xz(fw, Math.cos(a) * WELL_WALK.r, Math.sin(a) * WELL_WALK.r)
    }),
    y: PARK_Y,
    width: WELL_WALK.width,
    closed: true,
    density: WELL_WALK.density
  })
  // 九孔桥桥顶两侧边道
  for (const s2 of [-1, 1]) {
    walkways.push({
      points: [
        xz(fb, -DECK_WALK.x, s2 * DECK_WALK.z),
        xz(fb, DECK_WALK.x, s2 * DECK_WALK.z)
      ],
      y: DECK_TOP,
      width: DECK_WALK.width,
      closed: false,
      density: DECK_WALK.density
    })
  }

  // 竹林：避开建筑（外扩约 4～8 m）、崇丽阁台基与前庭、薛涛井小广场与步行路径
  const [cwx, cwz] = toWorld(cl.cx, cl.cz)
  const [wwx, wwz] = toWorld(wx, wz)
  const worldRect = (r, pad) => {
    const [cx, cz] = toWorld(r.cx, r.cz)
    return rectPolygon(cx, cz, r.w * S + 2 * pad, r.d * S + 2 * pad, r.bearing)
  }
  const blockPolys = [
    worldRect(zj, 5),
    worldRect(ys, 5),
    ...hjRects.map((r) => worldRect(r, 5)),
    ...bambooAvoid
  ]
  const obstacles = [
    (x, z) => Math.hypot(x - cwx, z - cwz) < 30, // 崇丽阁台基与前庭
    (x, z) => Math.hypot(x - wwx, z - wwz) < 20, // 薛涛井与红墙
    ...blockPolys.map((p) => (x, z) => pointInPolygon(x, z, p))
  ]
  plantBamboo(b, park, bank, lake, obstacles, walkways, [cwx, cwz])

  const meshes = []
  const g = b.bake()
  if (g) meshes.push(new Mesh(g, landmarkMaterial()))

  // 游船：崇丽阁前江湾，沿江中心线正弦往复（单独 Mesh、不投影）；
  // 漂移与掉头写法同 hejiang.js 的游船（周期、振幅不同）
  const [r0x, r0z] = ctx.project.toLocal(...RIVER[0])
  const [r1x, r1z] = ctx.project.toLocal(...RIVER[1])
  const len = Math.hypot(r1x - r0x, r1z - r0z)
  const ux = (r1x - r0x) / len
  const uz = (r1z - r0z) / len
  const riverBearing = Math.atan2(ux, -uz) / DEG
  const cx = (r0x + r1x) / 2
  const cz = (r0z + r1z) / 2
  const bb = new ColorBuilder()
  addBoat(bb, frame(0, 0, 0, riverBearing - 90), { length: BOAT.length })
  const boat = new Mesh(bb.bake(), landmarkMaterial())
  boat.userData.animated = true
  const boatY = RIVER_Y - 0.35
  boat.position.set(cx, boatY, cz)
  meshes.push(boat)

  const bridgeZone = rectPolygon(
    bx,
    bz,
    2 * (archLayout().half + RAMP) + 4,
    BRIDGE_W + 4,
    BRIDGE.bearing
  )

  return {
    meshes,
    zones: [park, bridgeZone],
    markerHeight: top,
    walkways,
    update(t) {
      const w = (2 * Math.PI) / BOAT.period
      const off = BOAT.amp * Math.sin(w * t)
      boat.position.set(cx + ux * off, boatY, cz + uz * off)
      const dir = Math.tanh(6 * Math.cos(w * t))
      boat.rotation.y = (Math.PI * (1 - dir)) / 2
    }
  }
}

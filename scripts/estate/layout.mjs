/**
 * 楼盘沙盘「澜岸云境」（虚构楼盘）：编号与布局的唯一来源
 * ----------------------------------------------------------
 * 这里定下所有可点选对象的编号、位置、层数和户数，之后的模拟数据、设计稿、三维场景
 * 都只引用这里的编号。运行：node scripts/estate/layout.mjs
 * 写出（均为生成文件，不要手改）：
 *   src/views/estate/data/layout.json   页面用的布局
 *   docs/design/estate/devices.json     build-3d-visual-dashboard 设备清单
 *
 * 坐标：平面米，x 向东、y 向北，原点 = 地块中心；three.js 里 x = x、z = -y。
 * 地块（虚构，示意成都锦江滨水新城）：300 × 210 m = 6.3 万 ㎡（约 94.5 亩）
 *   北：锦澜大道（主干道）  南：滨河路 + 河岸公园 + 锦澜河
 *   西：云岸路 + 小学     东：岸南路 + 地铁口 + 商业综合体 + 社区医院
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

const SITE = { w: 300, d: 210 }
const STOREY = 3.0 // 层高（m），沙盘按真实高度做

/** 产品类型：层高以上的"计容效率"用来估算计容建面 */
const KINDS = {
  tower: { name: "高层", eff: 0.85, perFloor: 4 },
  terrace: { name: "洋房", eff: 0.9, perFloor: 4 },
  villa: { name: "联排", eff: 0.9, perFloor: 0 }
}

/** 户型：每种产品的户型表（面积为建筑面积 ㎡，均为设定值） */
const UNIT_TYPES = {
  tower: [
    { name: "三室两厅两卫", area: 118 },
    { name: "四室两厅两卫", area: 143 },
    { name: "四室两厅三卫", area: 168 }
  ],
  terrace: [
    { name: "三室两厅两卫", area: 125 },
    { name: "四室两厅三卫", area: 150 },
    { name: "带花园跃层", area: 186 }
  ],
  villa: [
    { name: "五室三厅四卫", area: 268 },
    { name: "六室四厅五卫", area: 312 }
  ]
}

// 楼栋：[编号序号, 类型, 中心x, 中心y, 面宽, 进深, 层数, 户/栋(联排用), 景观与提示标签]
// 位置按定稿反投影校正（scripts/estate/fit_camera.py）：定稿里的布局近似左右对称，
// 高层外侧 ±89 m、内侧 ±43 m；洋房内列 ±78 m、外列 ±115 m；联排 ±57 m、±89 m。
const B = [
  // 北排高层：板式、长边东西向、朝南，兼作北侧大道的"屏障"，也让阴影落在北面
  [1, "tower", -89, 73, 34, 20, 32, 0, ["中庭景观", "临主路"]],
  [2, "tower", -43, 67, 34, 20, 23, 0, ["景观轴", "临主路"]],
  [3, "tower", 43, 67, 34, 20, 23, 0, ["景观轴", "临主路"]],
  [4, "tower", 89, 73, 34, 20, 32, 0, ["中庭景观", "临主路"]],
  // 洋房：两排，围着中央景观湖；7 层（6 + 1 跃）
  [5, "terrace", -112, 36, 33, 15, 7, 0, ["中庭景观"]],
  [6, "terrace", -79, 36, 33, 15, 7, 0, ["景观轴", "近湖"]],
  [7, "terrace", -112, -6, 33, 15, 7, 0, ["中庭景观"]],
  [8, "terrace", -79, -6, 33, 15, 7, 0, ["湖景"]],
  [9, "terrace", 79, 36, 33, 15, 7, 0, ["景观轴", "近湖"]],
  [10, "terrace", 112, 36, 33, 15, 7, 0, ["中庭景观"]],
  [11, "terrace", 79, -6, 33, 15, 7, 0, ["湖景"]],
  [12, "terrace", 112, -6, 33, 15, 7, 0, ["中庭景观"]],
  // 南排联排：3 层，每栋 4 户，临滨河路
  [13, "villa", -91, -72, 30, 13, 3, 4, ["临滨河路", "河岸公园景观"]],
  [14, "villa", -57, -72, 30, 13, 3, 4, ["临滨河路", "河岸公园景观"]],
  [15, "villa", 57, -72, 30, 13, 3, 4, ["临滨河路", "河岸公园景观"]],
  [16, "villa", 91, -72, 30, 13, 3, 4, ["临滨河路", "河岸公园景观"]]
]

const pad = (n) => String(n).padStart(2, "0")

const buildings = B.map(
  ([no, kind, cx, cy, w, d, floors, villaUnits, tags]) => {
    const K = KINDS[kind]
    const units = kind === "villa" ? villaUnits : floors * K.perFloor
    return {
      id: `B${pad(no)}`,
      no,
      name: `${no} 栋`,
      kind,
      kindName: K.name,
      cx,
      cy,
      w,
      d,
      floors,
      storeyH: STOREY,
      // 屋顶设备间和女儿墙给 1.5 m
      height: kind === "tower" ? floors * STOREY + 6 : floors * STOREY + 1.5,
      units,
      unitTypes: UNIT_TYPES[kind],
      // 朝南：长边东西向、正面朝南；联排门朝北、花园朝南
      facing: "坐北朝南",
      tags
    }
  }
)

/**
 * 配套与景观：layer 决定"配套 / 景观图层"里归哪一类
 * edu 教育 shop 商业 traffic 交通 club 会所运动 scenic 景观 med 医疗
 */
const A = [
  // 小区内
  [
    "CL01",
    "社区会所",
    "club",
    "building",
    0,
    -62,
    40,
    22,
    2,
    "2 层会所：室内恒温泳池、健身房、亲子空间、业主活动厅"
  ],
  [
    "SW01",
    "室外泳池",
    "club",
    "pool",
    0,
    -86,
    28,
    12,
    0,
    "景观泳池，临会所，夏季开放"
  ],
  [
    "KG01",
    "社区幼儿园",
    "edu",
    "building",
    -134,
    -78,
    22,
    14,
    3,
    "3 层幼儿园，带户外操场，开发商配建"
  ],
  [
    "SH01",
    "底商街",
    "shop",
    "building",
    142,
    0,
    14,
    120,
    2,
    "沿岸南路 2 层社区商业街：超市、餐饮、药房、洗衣"
  ],
  [
    "PM01",
    "物业服务中心",
    "traffic",
    "building",
    -24,
    95,
    14,
    10,
    1,
    "主入口旁 1 层物业服务中心，24 小时管家"
  ],
  // 湖按设计稿放大（概念图里湖偏大、近圆）：80 × 56 m，约 3 500 ㎡
  [
    "LK01",
    "中央景观湖",
    "scenic",
    "lake",
    0,
    -12,
    78,
    66,
    0,
    "约 3 700 ㎡ 景观湖，环湖步道，景观轴的终点"
  ],
  [
    "AX01",
    "景观轴",
    "scenic",
    "axis",
    0,
    58,
    24,
    84,
    0,
    "主入口到景观湖的中轴，林荫 + 跌水，北高南低"
  ],
  [
    "TR01",
    "环湖步道",
    "club",
    "track",
    0,
    -12,
    88,
    76,
    0,
    "环湖慢跑道，约 250 m，夜间有地灯"
  ],
  // 儿童乐园与运动场的左右位置按设计稿对调：乐园在西、运动场在东
  [
    "PL01",
    "儿童乐园",
    "club",
    "playground",
    -80,
    -38,
    24,
    18,
    0,
    "分龄儿童游乐场，橡胶地面"
  ],
  [
    "SP01",
    "运动场",
    "club",
    "court",
    80,
    -38,
    24,
    16,
    0,
    "篮球 + 羽毛球场，夜间照明"
  ],
  // 出入口
  [
    "E01",
    "主入口",
    "traffic",
    "gate",
    0,
    105,
    20,
    6,
    0,
    "北侧主入口，面向锦澜大道，人车分流"
  ],
  [
    "E02",
    "东次入口",
    "traffic",
    "gate",
    150,
    -72,
    6,
    14,
    0,
    "东侧次入口，通地铁口和商业"
  ],
  [
    "G01",
    "车库入口 1",
    "traffic",
    "garage",
    -60,
    105,
    14,
    6,
    0,
    "北侧地下车库入口"
  ],
  [
    "G02",
    "车库入口 2",
    "traffic",
    "garage",
    60,
    105,
    14,
    6,
    0,
    "北侧地下车库入口"
  ],
  // 周边（地块外）
  [
    "SC01",
    "九年一贯制学校",
    "edu",
    "building",
    -205,
    45,
    44,
    64,
    4,
    "步行约 3 分钟（示意）"
  ],
  [
    "MT01",
    "地铁站 A 口",
    "traffic",
    "building",
    182,
    82,
    12,
    8,
    1,
    "步行约 3 分钟（示意，线路不指代真实线路）"
  ],
  [
    "ML01",
    "商业综合体",
    "shop",
    "building",
    205,
    20,
    44,
    54,
    3,
    "3 层购物中心，步行约 5 分钟（示意）"
  ],
  [
    "HP01",
    "社区医院",
    "med",
    "building",
    192,
    -58,
    28,
    28,
    4,
    "步行约 4 分钟（示意）"
  ],
  [
    "PK01",
    "河岸公园",
    "scenic",
    "park",
    0,
    -131,
    300,
    22,
    0,
    "滨河带状公园 + 骑行道，沿河 1.2 km"
  ],
  [
    "RV01",
    "锦澜河",
    "scenic",
    "river",
    0,
    -160,
    460,
    36,
    0,
    "滨水景观河道，宽约 36 m"
  ]
]

const amenities = A.map(
  ([id, name, layer, shape, cx, cy, w, d, floors, desc]) => ({
    id,
    name,
    layer,
    shape,
    cx,
    cy,
    w,
    d,
    floors,
    height: floors ? floors * STOREY + 1.0 : 0,
    desc,
    // 地块外的对象不计入楼盘指标
    outside: ["SC01", "MT01", "ML01", "HP01", "PK01", "RV01"].includes(id)
  })
)

/** 周边道路（中心线 + 宽度），r 为代号，页面只用来铺路面和标线 */
const roads = [
  { id: "R01", name: "锦澜大道", cx: 0, cy: 127, w: 460, d: 40, lanes: 6 },
  { id: "R02", name: "滨河路", cx: 0, cy: -112, w: 460, d: 16, lanes: 2 },
  { id: "R03", name: "云岸路", cx: -160, cy: 0, w: 12, d: 240, lanes: 2 },
  { id: "R04", name: "岸南路", cx: 162, cy: 0, w: 20, d: 240, lanes: 4 }
]

/** 配套 / 景观图层：页面底部切换条的分类 */
const layers = [
  { id: "edu", name: "教育", ids: ["KG01", "SC01"] },
  { id: "shop", name: "商业", ids: ["SH01", "ML01"] },
  {
    id: "traffic",
    name: "交通",
    ids: ["MT01", "E01", "E02", "G01", "G02", "PM01"]
  },
  {
    id: "club",
    name: "会所运动",
    ids: ["CL01", "SW01", "TR01", "PL01", "SP01"]
  },
  { id: "scenic", name: "景观", ids: ["LK01", "AX01", "PK01", "RV01"] },
  { id: "med", name: "医疗", ids: ["HP01"] }
]

// ---------- 派生指标：全部从明细算出，不手写汇总 ----------
const inSite = amenities.filter((a) => !a.outside)
const footprint =
  buildings.reduce((s, b) => s + b.w * b.d, 0) +
  inSite
    .filter((a) => a.shape === "building")
    .reduce((s, a) => s + a.w * a.d, 0)
const gfa =
  buildings.reduce((s, b) => s + b.w * b.d * b.floors * KINDS[b.kind].eff, 0) +
  inSite
    .filter((a) => a.shape === "building")
    .reduce((s, a) => s + a.w * a.d * a.floors, 0)
const siteArea = SITE.w * SITE.d
const units = buildings.reduce((s, b) => s + b.units, 0)

const totals = {
  siteArea,
  siteMu: +(siteArea / 666.667).toFixed(1),
  gfa: Math.round(gfa / 100) * 100,
  far: +(gfa / siteArea).toFixed(2),
  density: +(footprint / siteArea).toFixed(3),
  // 绿地率是设定值（湖面、环道、景观轴、庭院合计），不是几何计算结果
  greenRate: 0.38,
  buildings: buildings.length,
  units,
  // 地下车位按 1 : 1.3 配
  parking: Math.round((units * 1.3) / 10) * 10,
  maxFloors: Math.max(...buildings.map((b) => b.floors)),
  byKind: Object.fromEntries(
    Object.keys(KINDS).map((k) => [
      k,
      {
        name: KINDS[k].name,
        buildings: buildings.filter((b) => b.kind === k).length,
        units: buildings
          .filter((b) => b.kind === k)
          .reduce((s, b) => s + b.units, 0)
      }
    ])
  )
}

const layout = {
  name: "澜岸云境",
  slogan: "湖居改善 · 轴线人居",
  note: "虚构楼盘，示意成都锦江滨水新城，不对应真实地块",
  site: SITE,
  storeyH: STOREY,
  // 沙盘底座：椭圆，中心和半轴（平面米），按定稿概念图反算（东西约 570 m、南北约 370 m）
  base: { cx: 10, cy: -6, rx: 285, ry: 208 },
  buildings,
  amenities,
  roads,
  layers,
  totals
}

// ---------- 写文件 ----------
const outLayout = join(ROOT, "src", "views", "estate", "data", "layout.json")
mkdirSync(dirname(outLayout), { recursive: true })
writeFileSync(outLayout, JSON.stringify(layout, null, 1) + "\n")

const devices = [
  ...buildings.map((b) => ({
    id: b.id,
    name: `${b.name}（${b.kindName} ${b.floors}F）`,
    kind: b.kind
  })),
  ...amenities.map((a) => ({ id: a.id, name: a.name, kind: a.shape }))
]
const outDevices = join(ROOT, "docs", "design", "estate", "devices.json")
mkdirSync(dirname(outDevices), { recursive: true })
writeFileSync(outDevices, JSON.stringify(devices, null, 1) + "\n")

console.log(
  `楼栋 ${buildings.length}（高层 ${totals.byKind.tower.buildings} / 洋房 ${totals.byKind.terrace.buildings} / 联排 ${totals.byKind.villa.buildings}），` +
    `户数 ${units}，计容建面 ${totals.gfa} ㎡，容积率 ${totals.far}，建筑密度 ${(totals.density * 100).toFixed(1)}%，` +
    `车位 ${totals.parking}，设备 ${devices.length}`
)

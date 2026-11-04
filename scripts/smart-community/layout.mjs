/**
 * 智慧社区（虚构 松岚苑）：设施编号与平面布局的唯一来源
 * ----------------------------------------------------------
 * 阶段 3 的产物：所有模型节点名、测点、事件、文档只用这里的编号指代设施。
 *
 * 2026-11-04 起三维场景直接复用 /estate（澜岸云境）的 Blender 楼栋、地面、树、水和灯光，所以这里的坐标系就是 /estate 的：
 *   平面米，x 向东、y 向北，原点在地块中心；three.js 里 X = x、Z = −y、Y 向上（和 /estate 的 toWorld 一致）。
 *   16 栋住宅 B01–B16、会所 / 幼儿园 / 底商 / 小房子的位置和尺寸都从 src/views/estate/data/layout.json 读，
 *   不在这里重复写；社区的配套编号对应 /estate 的模型：PM-01 = CL01（会所，屋顶是机库）、KG-01 = KG01、
 *   SH-01 = SH01、EL-01 = PM01（主入口旁的小房子当配电房）。
 *   旧版（定稿 final.png 的程序化沙盘，440 × 310 m、楼竖向夸张 1.8×）的坐标全部作废。
 * 点状设施（大门、充电区、盲区、消防登高面）是我在 /estate 的地面上选的空地 / 楼间夹缝，选址依据见各行注释。
 * 只改这个脚本，不手改产物。
 *
 * 用法：node scripts/smart-community/layout.mjs
 *   写出 src/views/smart-community/data/layout.json（页面用）和 docs/design/smart-community/devices.json（设备清单）
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const DOCS = join(ROOT, "docs", "design", "smart-community")
const DATA = join(ROOT, "src", "views", "smart-community", "data")
const ESTATE = join(ROOT, "src", "views", "estate")
const estate = JSON.parse(readFileSync(join(ESTATE, "data", "layout.json")))
const foot = JSON.parse(
  readFileSync(join(ESTATE, "scene", "img2", "footprints.json"))
)

/** 地块范围（平面米）：四条路围出来的内侧（云岸路 x = −160、岸南路 x = 162、锦澜大道 y = 127、滨河路 y = −112） */
export const SITE = {
  x0: -154,
  x1: 152,
  y0: -104,
  y1: 107,
  w: 306,
  h: 211,
  name: "松岚苑",
  fictional: true
}
/** 沙盘竖向不夸张：/estate 的楼就是真实高度 */
export const V_SCALE = 1

/** 配套建筑：[社区编号, 名称, kind, /estate 里的模型编号]；位置 / 尺寸 / 层数从 /estate 读 */
const AMENITY = [
  ["PM-01", "物业服务中心（含监控室、屋顶机库）", "property", "CL01"],
  ["KG-01", "幼儿园", "kindergarten", "KG01"],
  ["SH-01", "底商", "shop", "SH01"],
  ["EL-01", "配电房", "utility", "PM01"]
]

/**
 * 点状设施：[编号, 名称, kind, x, y, 宽, 进深]（宽 / 进深只有盲区用，是地面标注框的大小）
 * 大门：北主入口 / 东次入口取 /estate 的 E01 / E02；西人行门开在云岸路一侧（/estate 没有，加一个）。
 * 主机位从南往北看、俯角约 52°，前排的楼会挡住它北边 20–60 m 的地面（洋房挡 20 m、塔楼挡 60–75 m），
 * 所以充电区、盲区都选在主机位看得见的地方：湖两岸的林荫带、景观轴、塔楼之间的夹缝（沿南北向的窄沟，视线能进去）。
 * 盲区（项目书 3.3：视场边缘 / 地形背阻 / 建筑阴影自动标盲区）：塔楼夹缝（建筑阴影）、湖岸林荫带（树冠遮挡）。
 */
const POINTS = [
  ["GT-01", "北主入口", "gate", 3, 114],
  ["GT-02", "东次入口", "gate", 148, -72],
  ["GT-03", "西人行门", "gate", -152, 14],
  ["PK-01", "地下车库出入口 1", "garage", -60, 105],
  ["PK-02", "地下车库出入口 2", "garage", 60, 105],
  ["CH-01", "电动车集中充电区 1", "charge", -52, -36],
  ["CH-02", "电动车集中充电区 2", "charge", 52, -36],
  ["CH-03", "电动车集中充电区 3", "charge", -108, -42],
  ["FA-01", "消防登高面 B03", "fireAccess", 43, 52],
  ["FA-02", "消防登高面 B06", "fireAccess", -79, 24],
  ["FA-03", "消防登高面 B08", "fireAccess", -79, -19],
  ["FA-04", "消防登高面 B11", "fireAccess", 79, -19],
  ["BS-01", "盲区 B01–B02 夹缝", "blind", -66, 66, 12, 20],
  ["BS-02", "盲区 B03–B04 夹缝", "blind", 66, 66, 12, 20],
  ["BS-03", "盲区 湖西林荫带", "blind", -54, 12, 22, 26],
  ["BS-04", "盲区 湖东林荫带", "blind", 54, 12, 22, 26],
  ["BS-05", "盲区 景观轴林荫带", "blind", 0, 46, 16, 26],
  ["BS-06", "盲区 湖西南岸树荫", "blind", -44, -24, 20, 20]
]

/** 无人机与地面设备（三机分工见项目书 2.2）；机库在物业中心（会所）屋顶，起降点 = 屋顶中心 */
const AIR = [
  [
    "UAV-01",
    "一号机 · 主侦查机",
    "droneScout",
    { sixAxis: true, sensors: "4K 可见光 + 640×512 红外" }
  ],
  [
    "UAV-02",
    "二号机 · 中继通信机",
    "droneRelay",
    { sensors: "2.4G / 5.8G 双频中继" }
  ],
  [
    "UAV-03",
    "三号机 · 补盲探查机",
    "droneBlind",
    { sensors: "广角相机 + 近距红外 + 激光测距" }
  ],
  ["HG-01", "屋顶机库", "hangar", { on: "PM-01" }],
  ["GS-01", "地面站（监控室）", "groundStation", { in: "PM-01" }]
]

/** 消防环路：地块内侧的一圈，沿四条边的内缘 */
const FR_LOOP = [
  [-142, -93],
  [138, -93],
  [138, 96],
  [-142, 96],
  [-142, -93]
]

export function buildLayout() {
  const roofTop = (id) =>
    Math.max(
      ...foot.footprints
        .filter((f) => f.id === id || f.id.startsWith(`${id}_`))
        .map((f) => f.top)
    )
  const buildings = [
    ...estate.buildings.map((b) => ({
      id: b.id,
      name: b.name,
      kind: b.kind,
      kindName: b.kindName,
      cx: b.cx,
      cy: b.cy,
      w: b.w,
      d: b.d,
      floors: b.floors,
      h: b.height,
      units: b.units
    })),
    ...AMENITY.map(([id, name, kind, model]) => {
      const a = estate.amenities.find((x) => x.id === model)
      return {
        id,
        name,
        kind,
        model,
        cx: a.cx,
        cy: a.cy,
        w: a.w,
        d: a.d,
        floors: a.floors,
        // 物业中心取会所屋顶板（CL01_roof，不含天窗）的顶面高度（机库停机坪就铺在上面），其余取 /estate 的楼高
        h:
          id === "PM-01"
            ? Number(roofTop(`${model}_roof`).toFixed(1))
            : a.height,
        units: 0
      }
    })
  ]
  const points = POINTS.map(([id, name, kind, x, y, w, d]) => ({
    id,
    name,
    kind,
    x,
    y,
    ...(w ? { w, d } : {})
  }))
  const air = AIR.map(([id, name, kind, extra]) => ({
    id,
    name,
    kind,
    ...extra
  }))
  const pm = buildings.find((b) => b.id === "PM-01")
  return {
    site: SITE,
    vScale: V_SCALE,
    // 沙盘底座：/estate 的椭圆
    base: { ...estate.base, depth: 30 },
    buildings,
    points,
    air,
    // 起降点：PM-01（会所）屋顶中心，roof = 屋顶板顶面高度（m）
    hangar: { id: "HG-01", x: pm.cx, y: pm.cy, roof: pm.h },
    fireLane: { id: "FR-01", name: "消防环路", path: FR_LOOP, width: 5 },
    // 汇总值从明细算出，不手写
    totals: {
      households: buildings.reduce((s, b) => s + b.units, 0),
      residentialBuildings: estate.buildings.length,
      blindZones: points.filter((p) => p.kind === "blind").length
    }
  }
}

export function buildDevices(layout) {
  return [
    ...layout.buildings.map((b) => ({
      id: b.id,
      name: b.name,
      kind: b.kind,
      node: b.model ?? b.id
    })),
    ...layout.points.map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      node: p.id
    })),
    ...layout.air.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      node: a.id
    })),
    {
      id: layout.fireLane.id,
      name: layout.fireLane.name,
      kind: "fireLane",
      node: layout.fireLane.id
    }
  ]
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split("/").pop())
) {
  const layout = buildLayout()
  const devices = buildDevices(layout)
  const ids = devices.map((d) => d.id)
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (dup.length) throw new Error(`设备编号重复：${dup.join("、")}`)
  mkdirSync(DATA, { recursive: true })
  mkdirSync(DOCS, { recursive: true })
  writeFileSync(join(DATA, "layout.json"), JSON.stringify(layout, null, 2))
  writeFileSync(join(DOCS, "layout.json"), JSON.stringify(layout, null, 2))
  writeFileSync(join(DOCS, "devices.json"), JSON.stringify(devices, null, 2))
  console.log(
    `设备 ${devices.length} 个（住宅 ${layout.totals.residentialBuildings} 栋 / ${layout.totals.households} 户 / 盲区 ${layout.totals.blindZones} 处），编号无重复`
  )
}

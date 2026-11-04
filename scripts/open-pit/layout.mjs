/**
 * 青原露天矿：设备与设施编号（唯一来源）
 * ----------------------------------------------------------
 * 这里只定编号、数量、归属和所属线路，坐标等设计稿定稿、相机标定后再反投影补进来。
 * 页面、仿真器、模拟数据、设计稿都只用这里的编号指代设备，模型节点名 = 编号。
 *
 * 数量的来源分两类（字段 src）：
 *   public ：公开资料里有依据的数量（100 台无人矿卡、3 套边坡雷达、118 台 GNSS、23 套地下水位、
 *             9 套爆破振动、3 套土压力、4 套渗水、12 个 5G 基站、2 个换电线路等），不得随意改；
 *   demo   ：演示用的假设（电铲台数、破碎站、卸载点、辅助车辆等），公开资料里没有。
 *
 * 用法：node scripts/open-pit/layout.mjs
 *       写出 src/views/open-pit/data/layout.json 与 docs/design/open-pit/devices.json
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const pad = (n, w = 2) => String(n).padStart(w, "0")
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1))

const devices = []
/** 登记一台设备；group 是页面上的分组，src 标明数量来源 */
const add = (id, name, kind, group, src, extra = {}) =>
  devices.push({ id, name, kind, group, node: id, src, ...extra })

// ---------- 场地与采坑 ----------
add("PIT-3", "第三采区采坑", "pit", "site", "public", {
  note: "在采采区；一、二采区已采完"
})
add("OF-01", "办公生活区", "building", "site", "demo")
add("WT-01", "疏干水处理站", "plant", "site", "demo", {
  note: "矿坑疏干水加压送电厂作循环水"
})
add("PP-01", "坑口电厂", "plant", "site", "public", {
  note: "煤电一体化：封闭皮带送煤，灰渣返排内排土场"
})
add("CY-01", "封闭煤场", "yard", "site", "public", {
  note: "全封闭预应力桁架，525 m × 160 m × 52.7 m"
})

// ---------- 采装 ----------
// 电铲：前 5 台剥离、后 2 台采煤，型号 WK-20（20 m³）；设计稿概念图里画了 7 台，按设计稿定
range(7, (i) =>
  add(
    `ES-${pad(i)}`,
    `${i <= 5 ? "剥离" : "采煤"}电铲 ${pad(i)}`,
    "shovel",
    "loading",
    "demo",
    {
      model: "WK-20",
      bucketM3: 20,
      work: i <= 5 ? "overburden" : "coal"
    }
  )
)
add("BW-01", "剥离轮斗挖掘机", "bucketWheel", "loading", "demo", {
  note: "全连续剥离，经排土皮带送内排土场"
})
range(3, (i) =>
  add(`DR-${pad(i)}`, `穿孔钻机 ${pad(i)}`, "drill", "loading", "demo")
)
range(2, (i) =>
  add(`BL-${pad(i)}`, `爆破区 ${pad(i)}`, "blastZone", "loading", "demo")
)

// ---------- 破碎与皮带（煤流） ----------
add("CR-01", "半移动破碎站", "crusher", "coal", "demo")
add("CR-02", "自移式破碎机", "crusher", "coal", "demo")
add("BC-01", "端帮皮带", "belt", "coal", "demo", { from: "CR-01", to: "BC-02" })
add("BC-02", "地面输煤皮带（封闭走廊）", "belt", "coal", "public", {
  from: "BC-01",
  to: "PP-01"
})
add("BC-03", "排土皮带", "belt", "coal", "demo", { from: "BW-01", to: "DP-I" })

// ---------- 排土场与卸载点 ----------
add("DP-W", "西排土场", "dump", "dump", "public")
add("DP-I", "内排土场", "dump", "dump", "public", {
  note: "电厂灰渣返排回填；表面覆盖腐殖土复垦"
})
range(4, (i) =>
  add(`UL-W${pad(i)}`, `西排卸载点 ${pad(i)}`, "unload", "dump", "demo", {
    dump: "DP-W"
  })
)
range(4, (i) =>
  add(`UL-I${pad(i)}`, `内排卸载点 ${pad(i)}`, "unload", "dump", "demo", {
    dump: "DP-I"
  })
)
add("PV-01", "排土场光伏", "solar", "energy", "public", {
  note: "为换电站供绿电"
})

// ---------- 运输线路（几何设计稿后再定） ----------
const routes = [
  { id: "R-P1", name: "坑内主斜坡道", from: "pit", to: "trunk" },
  { id: "R-T1", name: "端帮干线", from: "trunk", to: "split" },
  { id: "R-W1", name: "西排土场线", from: "split", to: "DP-W" },
  { id: "R-I1", name: "内排土场线", from: "split", to: "DP-I" },
  { id: "R-C1", name: "破碎站 1 线", from: "split", to: "CR-01" },
  { id: "R-C2", name: "破碎站 2 线", from: "split", to: "CR-02" },
  { id: "R-S1", name: "换电联络线", from: "trunk", to: "SW-01" }
]
routes.forEach((r) =>
  add(r.id, r.name, "route", "road", "demo", { from: r.from, to: r.to })
)

// ---------- 换电与能源 ----------
add("SW-01", "换电站 1", "swapStation", "energy", "demo", {
  swapMin: 6,
  bays: 4
})
add("SW-02", "换电站 2", "swapStation", "energy", "demo", {
  swapMin: 6,
  bays: 4
})
add("CH-01", "充电区", "charger", "energy", "demo", { note: "离线电池组充电" })
add("SS-01", "采场变电站", "substation", "energy", "demo")

// ---------- 无人矿卡编组（100 台，公开） ----------
// 编组为演示假设：A/B 剥离，C/D 运煤，E 机动；台数按电铲能力和运距在仿真里调过（见 sim/simulator.js）
const fleets = [
  {
    id: "FL-A",
    name: "剥离 · 西排线",
    n: 34,
    work: "overburden",
    dump: "DP-W",
    loaders: ["ES-01", "ES-02", "ES-03"]
  },
  {
    id: "FL-B",
    name: "剥离 · 内排线",
    n: 26,
    work: "overburden",
    dump: "DP-I",
    loaders: ["ES-04", "ES-05"]
  },
  {
    id: "FL-C",
    name: "运煤 · 破碎站 1",
    n: 13,
    work: "coal",
    crusher: "CR-01",
    loaders: ["ES-06"]
  },
  {
    id: "FL-D",
    name: "运煤 · 破碎站 2",
    n: 8,
    work: "coal",
    crusher: "CR-02",
    loaders: ["ES-07"]
  },
  { id: "FL-E", name: "机动编组", n: 19, work: "swing" }
]
let tk = 0
fleets.forEach((f) => {
  f.trucks = range(f.n, () => `TK-${pad(++tk, 3)}`)
  f.trucks.forEach((id) =>
    add(id, `无人矿卡 ${id.slice(3)}`, "truck", "truck", "public", {
      fleet: f.id,
      payloadT: 90,
      batteryKwh: 564,
      cab: false
    })
  )
})

// ---------- 辅助车辆（有人驾驶，演示混行避让） ----------
range(3, (i) =>
  add(`WC-${pad(i)}`, `洒水车 ${pad(i)}`, "sprinkler", "support", "demo")
)
range(4, (i) =>
  add(`BD-${pad(i)}`, `推土机 ${pad(i)}`, "dozer", "support", "demo")
)
range(4, (i) =>
  add(`CV-${pad(i)}`, `指挥巡检车 ${pad(i)}`, "patrol", "support", "demo")
)

// ---------- 边坡与水文监测（数量均来自公开招标） ----------
range(3, (i) =>
  add(`SR-${pad(i)}`, `边坡雷达 ${pad(i)}`, "slopeRadar", "monitor", "public")
)
range(118, (i) =>
  add(
    `GN-${pad(i, 3)}`,
    `GNSS 位移站 ${pad(i, 3)}`,
    "gnss",
    "monitor",
    "public"
  )
)
range(23, (i) =>
  add(
    `GW-${pad(i)}`,
    `地下水位监测 ${pad(i)}`,
    "groundwater",
    "monitor",
    "public"
  )
)
range(9, (i) =>
  add(
    `BV-${pad(i)}`,
    `爆破振动监测 ${pad(i)}`,
    "blastVibration",
    "monitor",
    "public"
  )
)
range(3, (i) =>
  add(
    `EP-${pad(i)}`,
    `土压力监测 ${pad(i)}`,
    "earthPressure",
    "monitor",
    "public"
  )
)
range(4, (i) =>
  add(`SP-${pad(i)}`, `渗水监测 ${pad(i)}`, "seepage", "monitor", "public")
)

// ---------- 通信与调度 ----------
range(12, (i) =>
  add(
    `BS-${pad(i)}`,
    `移动 5G 基站 ${pad(i)}`,
    "baseStation",
    "comms",
    "public"
  )
)
add("CC-01", "现场调度中心", "controlRoom", "comms", "demo")
add("DC-01", "云端调度平台", "cloud", "comms", "public", {
  note: "距采场约 6 km，下达编组计划、路线规划和任务分配"
})

// ---------- 校验与输出 ----------
const ids = devices.map((d) => d.id)
const dup = ids.filter((id, i) => ids.indexOf(id) !== i)
if (dup.length) throw new Error(`编号重复：${[...new Set(dup)].join(", ")}`)

const counts = {}
devices.forEach((d) => (counts[d.kind] = (counts[d.kind] || 0) + 1))
const layout = {
  name: "青原露天矿",
  design: {
    capacityMtYear: 3500,
    trucks: 100,
    payloadT: 90,
    batteryKwh: 564,
    swapMin: 6
  },
  fleets,
  routes,
  counts,
  devices
}

const outLayout = join(ROOT, "src", "views", "open-pit", "data", "layout.json")
const outDevices = join(ROOT, "docs", "design", "open-pit", "devices.json")
mkdirSync(dirname(outLayout), { recursive: true })
mkdirSync(dirname(outDevices), { recursive: true })
writeFileSync(outLayout, JSON.stringify(layout, null, 2) + "\n")
writeFileSync(
  outDevices,
  JSON.stringify(
    devices.map(({ id, name, kind, group, node, src }) => ({
      id,
      name,
      kind,
      group,
      node,
      src
    })),
    null,
    2
  ) + "\n"
)
console.log(
  `设备共 ${devices.length} 台（public ${devices.filter((d) => d.src === "public").length}，demo ${devices.filter((d) => d.src === "demo").length}）`
)
console.log(counts)

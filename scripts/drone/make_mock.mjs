#!/usr/bin/env node
/*
 * 生成 /drone 设计阶段用的模拟数据快照（docs/design/drone/mock/）
 * ----------------------------------------------------------
 * 直接调用页面用的仿真器 src/views/drone/sim/simulator.js，所以设计稿上的数字
 * 和页面运行时完全一致。输出：
 *   points.json        测点定义（<设备编号>.<量>，PARK.* 为全园汇总）
 *   snapshots.json     13:40–14:40 每分钟一份快照（共 61 份），格式见 skill 的
 *                      references/data-consistency.md
 *   rules.json         口径规则（汇总 = 明细之和、比值、过期判定）
 *   design-moment.json 设计稿画的那一刻（14:03）的整屏状态：机场、无人机、
 *                      计划、事件、KPI、近 7 天统计、航线与布局
 *   design-moment.js   同上，包成 window.DM，给设计稿合成页直接引入
 *   day-summary.json   当天全天的统计（写 04-data-spec.md 用）
 * 生成后跑：node <skill>/scripts/data-check.mjs docs/design/drone/mock
 *
 * 用法：node scripts/drone/make_mock.mjs [日期 YYYY-MM-DD] [设计时刻 HH:MM]
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href)
const { simulateDay, stateAt, weekCounts, dayStartOf, ROUTE_MIN } = await imp(
  "src/views/drone/sim/simulator.js"
)
const { DOCKS, DRONES, ROUTES, SCHEDULE, TARGETS, ZONES, PARK, NO_FLY } =
  await imp("src/views/drone/data/layout.js")
const catalog = await imp("src/views/drone/data/catalog.js")

const SEED = "linjiang"
const DATE = process.argv[2] || "2026-10-19"
const MOMENT = process.argv[3] || "14:03"
const OUT = join(ROOT, "docs", "design", "drone", "mock")
mkdirSync(OUT, { recursive: true })

const MIN = 60e3
const day0 = dayStartOf(DATE)
const hm = (s) =>
  day0 + Number(s.slice(0, 2)) * 60 * MIN + Number(s.slice(3, 5)) * MIN
/** 时间戳 → 北京时间 ISO 字符串（带 +08:00） */
const iso = (t) =>
  new Date(t + 8 * 3600e3)
    .toISOString()
    .replace("Z", "+08:00")
    .replace(".000", "")
const r2 = (v) => Math.round(v * 100) / 100

const day = simulateDay({ seed: SEED, date: DATE, story: true })

// ---------------------------------------------------------------- 测点定义

const points = []
const P = (id, device, name, unit, kind, min, max) =>
  points.push({
    id,
    device,
    name,
    unit,
    kind,
    ...(min !== undefined ? { min, max } : {})
  })
for (const id of Object.keys(DOCKS)) {
  P(`${id}.state`, id, "机场状态", "", "state")
  P(`${id}.lid`, id, "舱盖", "", "state")
  P(`${id}.cabinTemp`, id, "舱内温度", "℃", "analog", -20, 60)
  P(`${id}.cabinHum`, id, "舱内湿度", "%RH", "analog", 0, 100)
  P(`${id}.wind`, id, "风速（10 min 平均）", "m/s", "analog", 0, 40)
  P(`${id}.gust`, id, "阵风（3 s 最大）", "m/s", "analog", 0, 50)
  P(`${id}.windLevel`, id, "风级", "级", "state")
  P(`${id}.windDir`, id, "风向（估算）", "°", "analog", 0, 360)
  P(`${id}.rain`, id, "雨量等级", "", "state")
  P(`${id}.temp`, id, "环境温度", "℃", "analog", -40, 60)
  P(`${id}.humidity`, id, "环境湿度", "%RH", "analog", 0, 100)
  P(`${id}.canFly`, id, "能否起飞", "", "state")
  P(`${id}.sorties`, id, "今日架次", "架次", "counter", 0, 100)
}
for (const id of Object.keys(DRONES)) {
  P(`${id}.state`, id, "无人机状态", "", "state")
  P(`${id}.x`, id, "位置 x（园区坐标）", "m", "analog", -200, 600)
  P(`${id}.y`, id, "位置 y（园区坐标）", "m", "analog", -800, 300)
  P(`${id}.altRel`, id, "相对起飞点高度", "m", "analog", -50, 500)
  P(`${id}.speed`, id, "水平速度", "m/s", "analog", 0, 25)
  P(`${id}.heading`, id, "航向", "°", "analog", 0, 360)
  P(`${id}.battery`, id, "电量", "%", "analog", 0, 100)
  P(`${id}.remainMin`, id, "剩余航时", "min", "analog", 0, 60)
  P(`${id}.cam`, id, "相机模式", "", "state")
  P(`${id}.rtk`, id, "RTK 状态", "", "state")
  P(`${id}.progress`, id, "任务进度", "%", "analog", 0, 100)
  P(`${id}.flightMin`, id, "今日飞行时长", "min", "counter", 0, 1440)
  P(`${id}.distanceKm`, id, "今日飞行里程", "km", "counter", 0, 500)
}
const KPI = [
  ["sorties", "今日架次", "架次", "counter"],
  ["flightMin", "今日飞行时长", "min", "counter"],
  ["distanceKm", "今日巡检里程", "km", "counter"],
  ["planDone", "已完成计划", "趟", "counter"],
  ["planMissed", "漏巡计划", "趟", "counter"],
  ["planCheck", "已结束计划（完成 + 漏巡）", "趟", "counter"],
  ["planRate", "计划完成率", "", "analog"],
  ["coveredTargets", "已巡对象", "个", "counter"],
  ["coverTotal", "计划巡检对象", "个", "analog"],
  ["coverage", "巡检覆盖率", "", "analog"],
  ["eventTotal", "今日事件", "条", "counter"],
  ["pending", "待确认", "条", "analog"],
  ["dispatched", "已派单", "条", "analog"],
  ["handling", "处置中", "条", "analog"],
  ["reviewing", "待复核", "条", "analog"],
  ["inProgress", "处置中（含已派单、待复核）", "条", "analog"],
  ["closed", "已办结", "条", "counter"],
  ["falseAlarm", "误报", "条", "counter"],
  ["valid", "有效事件（总数 − 误报）", "条", "analog"],
  ["disposalRate", "处置率", "", "analog"],
  ["major", "重大", "条", "counter"],
  ["serious", "较大", "条", "counter"],
  ["general", "一般", "条", "counter"]
]
for (const [k, name, unit, kind] of KPI)
  P(
    `PARK.${k}`,
    "PARK",
    name,
    unit,
    kind,
    ...(unit === "" ? [0, 1] : [0, 100000])
  )

// ---------------------------------------------------------------- 口径规则

const docksIds = Object.keys(DOCKS)
const droneIds = Object.keys(DRONES)
const rules = [
  {
    type: "sum",
    target: "PARK.sorties",
    of: docksIds.map((d) => `${d}.sorties`)
  },
  {
    type: "sum",
    target: "PARK.flightMin",
    of: droneIds.map((d) => `${d}.flightMin`)
  },
  {
    type: "sum",
    target: "PARK.distanceKm",
    of: droneIds.map((d) => `${d}.distanceKm`)
  },
  {
    type: "sum",
    target: "PARK.planCheck",
    of: ["PARK.planDone", "PARK.planMissed"]
  },
  {
    type: "ratio",
    target: "PARK.planRate",
    num: "PARK.planDone",
    den: "PARK.planCheck"
  },
  {
    type: "ratio",
    target: "PARK.coverage",
    num: "PARK.coveredTargets",
    den: "PARK.coverTotal"
  },
  {
    type: "sum",
    target: "PARK.inProgress",
    of: ["PARK.dispatched", "PARK.handling", "PARK.reviewing"]
  },
  {
    type: "sum",
    target: "PARK.valid",
    of: ["PARK.pending", "PARK.inProgress", "PARK.closed"]
  },
  {
    type: "sum",
    target: "PARK.eventTotal",
    of: ["PARK.valid", "PARK.falseAlarm"]
  },
  {
    type: "sum",
    target: "PARK.eventTotal",
    of: ["PARK.major", "PARK.serious", "PARK.general"]
  },
  {
    type: "ratio",
    target: "PARK.disposalRate",
    num: "PARK.closed",
    den: "PARK.valid"
  },
  { type: "stale", maxAgeSec: 60 }
]

// ---------------------------------------------------------------- 快照

/** 一刻的状态 → {测点: {v, q, verifiedAt}}（changedAt 在下面按前后快照补） */
function flatten(s) {
  const out = {}
  const put = (id, v, q, seen) => (out[id] = { v, q, verifiedAt: iso(seen) })
  for (const d of Object.values(s.docks)) {
    const q = d.q
    put(`${d.id}.state`, d.state, q, d.lastSeen)
    put(`${d.id}.lid`, d.lid, q, d.lastSeen)
    put(`${d.id}.cabinTemp`, r2(d.cabinTemp), q, d.lastSeen)
    put(`${d.id}.cabinHum`, r2(d.cabinHum), q, d.lastSeen)
    put(`${d.id}.wind`, r2(d.wind), q, d.lastSeen)
    put(`${d.id}.gust`, r2(d.gust), q, d.lastSeen)
    put(`${d.id}.windLevel`, d.windLevel, q, d.lastSeen)
    put(`${d.id}.windDir`, Math.round(d.windDir), q, d.lastSeen)
    put(`${d.id}.rain`, d.rain, q, d.lastSeen)
    put(`${d.id}.temp`, r2(d.temp), q, d.lastSeen)
    put(`${d.id}.humidity`, r2(d.humidity), q, d.lastSeen)
    // 能否起飞由平台判断：离线时平台按"不可起飞"处理，值本身是平台算的，质量为 good
    put(`${d.id}.canFly`, d.canFly, "good", s.t)
    put(`${d.id}.sorties`, d.sorties, q, d.lastSeen)
  }
  for (const u of Object.values(s.drones)) {
    const q = u.q
    put(`${u.id}.state`, u.state, q, u.lastSeen)
    put(`${u.id}.x`, r2(u.x), u.posQ, u.lastSeen)
    put(`${u.id}.y`, r2(u.y), u.posQ, u.lastSeen)
    put(`${u.id}.altRel`, r2(u.altRel), q, u.lastSeen)
    put(`${u.id}.speed`, r2(u.speed), q, u.lastSeen)
    put(`${u.id}.heading`, Math.round(u.heading), q, u.lastSeen)
    put(`${u.id}.battery`, r2(u.battery), q, u.lastSeen)
    put(`${u.id}.remainMin`, r2(u.remainMin), q, u.lastSeen)
    put(`${u.id}.cam`, u.cam, q, u.lastSeen)
    put(`${u.id}.rtk`, u.rtk, q, u.lastSeen)
    put(`${u.id}.progress`, u.progress, q, u.lastSeen)
    put(`${u.id}.flightMin`, r2(u.flightMin), q, u.lastSeen)
    put(`${u.id}.distanceKm`, r2(u.distanceKm), q, u.lastSeen)
  }
  // 全园汇总：从上面（已取整的）明细再加一遍，保证"汇总 = 明细之和"严格成立
  const k = s.kpi
  const sumOf = (ids) => ids.reduce((a, id) => a + out[id].v, 0)
  const kv = {
    sorties: sumOf(docksIds.map((d) => `${d}.sorties`)),
    flightMin: sumOf(droneIds.map((d) => `${d}.flightMin`)),
    distanceKm: sumOf(droneIds.map((d) => `${d}.distanceKm`)),
    planDone: k.planDone,
    planMissed: k.planMissed,
    planCheck: k.planDone + k.planMissed,
    planRate:
      k.planDone + k.planMissed ? k.planDone / (k.planDone + k.planMissed) : 1,
    coveredTargets: k.coveredTargets,
    coverTotal: k.coverTotal,
    coverage: k.coveredTargets / k.coverTotal,
    eventTotal: k.eventTotal,
    pending: k.pending,
    dispatched: k.dispatched,
    handling: k.handling,
    reviewing: k.reviewing,
    inProgress: k.inProgress,
    closed: k.closed,
    falseAlarm: k.falseAlarm,
    valid: k.valid,
    disposalRate: k.valid ? k.closed / k.valid : 1,
    major: k.major,
    serious: k.serious,
    general: k.general
  }
  for (const [key, v] of Object.entries(kv)) put(`PARK.${key}`, v, "good", s.t)
  return out
}

const snapshots = []
let prev = null
for (let t = hm("13:40"); t <= hm("14:40"); t += MIN) {
  const s = stateAt(day, t)
  const values = flatten(s)
  for (const [id, x] of Object.entries(values)) {
    const p = prev?.[id]
    // 数值没变就沿用上一次的变化时间；变了就记为这次收到它的时刻
    x.changedAt = p && p.v === x.v ? p.changedAt : x.verifiedAt
  }
  snapshots.push({ t: iso(t), values })
  prev = values
}

// ---------------------------------------------------------------- 设计时刻

const tm = hm(MOMENT)
const moment = stateAt(day, tm)
const week = weekCounts({ seed: SEED, date: DATE, upto: moment })
const design = {
  t: iso(tm),
  date: DATE,
  seed: SEED,
  note: "设计稿画的那一刻：1# 机场阵风停飞、3# 机场离线、2# 无人机悬停监视重大气体泄漏（待确认）、4# 无人机在飞",
  park: PARK,
  zones: ZONES,
  docksMeta: DOCKS,
  dronesMeta: DRONES,
  targets: TARGETS,
  noFly: NO_FLY,
  routes: Object.fromEntries(
    Object.entries(ROUTES).map(([id, r]) => [
      id,
      { ...r, schedule: SCHEDULE[id], minutes: +ROUTE_MIN[id].toFixed(1) }
    ])
  ),
  catalog: {
    levels: catalog.LEVELS,
    eventTypes: catalog.EVENT_TYPES,
    eventStatus: catalog.EVENT_STATUS,
    dockState: catalog.DOCK_STATE,
    droneState: catalog.DRONE_STATE,
    planStatus: catalog.PLAN_STATUS,
    rainLevel: catalog.RAIN_LEVEL,
    compliance: catalog.COMPLIANCE,
    limits: catalog.LIMITS
  },
  state: moment,
  week,
  // 在飞无人机最近 3 分钟的航迹（画尾迹用），每 5 s 一点
  trails: Object.fromEntries(
    Object.values(moment.drones)
      .filter((u) => u.state !== "docked")
      .map((u) => {
        const pts = []
        for (let t = tm - 3 * MIN; t <= tm; t += 5e3) {
          const s = stateAt(day, t).drones[u.id]
          if (s.state !== "docked") pts.push([r2(s.x), r2(s.y), r2(s.z)])
        }
        return [u.id, pts]
      })
  )
}

// ---------------------------------------------------------------- 全天统计

const end = stateAt(day, day.dayEnd - 1000)
const inAir = [0, 0, 0, 0, 0]
for (let t = hm("07:00"); t < hm("19:00"); t += MIN)
  inAir[
    Object.values(stateAt(day, t).drones).filter((u) => u.state !== "docked")
      .length
  ]++
const summary = {
  date: DATE,
  seed: SEED,
  kpiEndOfDay: end.kpi,
  routeMinutes: Object.fromEntries(
    Object.entries(ROUTE_MIN).map(([k, v]) => [k, +v.toFixed(1)])
  ),
  inAirMinutes0700to1900: {
    0: inAir[0],
    1: inAir[1],
    2: inAir[2],
    3: inAir[3],
    4: inAir[4]
  },
  postponed: end.plan
    .filter((p) => p.delayMin > 0)
    .map((p) => ({ id: p.id, delayMin: p.delayMin })),
  story: day.events
    .filter((e) => e.story)
    .map((e) => ({
      id: e.id,
      type: e.type,
      level: e.level,
      reading: e.reading,
      history: e.history.map((h) => ({ t: iso(h.t), s: h.s }))
    })),
  outages: Object.fromEntries(
    Object.entries(day.net.outages).map(([k, v]) => [
      k,
      v.map(([a, b]) => [iso(a), iso(b)])
    ])
  ),
  eventsByType: end.events.reduce(
    (m, e) => ((m[e.type] = (m[e.type] || 0) + 1), m),
    {}
  ),
  week: week.map((d) => ({ date: d.date, total: d.total }))
}

const write = (f, o) =>
  writeFileSync(
    join(OUT, f),
    JSON.stringify(o, null, f === "snapshots.json" ? 0 : 2) + "\n"
  )
write("points.json", points)
write("snapshots.json", snapshots)
write("rules.json", rules)
write("design-moment.json", design)
// 设计稿合成页（design/src/drafts.html）用 <script> 直接引入，免得 file:// 下 fetch 被拦
writeFileSync(
  join(OUT, "design-moment.js"),
  `window.DM = ${JSON.stringify(design)}
`
)
write("day-summary.json", summary)
console.log(`${points.length} 个测点 × ${snapshots.length} 份快照 → ${OUT}`)
console.log(
  `设计时刻 ${MOMENT}：事件 ${moment.events.length} 条（待确认 ${moment.kpi.pending}），在飞 ${Object.values(moment.drones).filter((u) => u.state !== "docked").length} 架`
)

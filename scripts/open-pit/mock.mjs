/**
 * 青原露天矿：模拟数据快照
 * ----------------------------------------------------------
 * 用页面同一份仿真器（src/views/open-pit/sim/simulator.js），在设计稿时刻前后取一小时，
 * 每 2 分钟一份快照，写成 build-3d-visual-dashboard 的数据格式（docs/design/open-pit/mock/）：
 *   points.json 测点定义、snapshots.json 31 份快照、rules.json 口径规则、
 *   window.json 时段与预置异常、design.json 设计稿面板要用的明细与曲线。
 *
 * 预置异常（设计稿要画出来）：边坡 SR-02 位移速率二级预警；TK-037 / TK-081 故障停运；
 * BS-07 基站离线导致 GN-064..069 数据过期；GW-11 水位读数漂移（质量不确定）；TK-052 避让有人巡检车。
 *
 * 用法：node scripts/open-pit/mock.mjs   之后跑
 *       node ~/src/build-3d-visual-dashboard/scripts/data-check.mjs docs/design/open-pit/mock
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  DESIGN_DATE,
  DESIGN_T,
  GROUP_NAME,
  PHASE_NAME,
  SHOVEL_STATE,
  createPitSim,
  msForBeijing
} from "../../src/views/open-pit/sim/simulator.js"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const OUT = join(ROOT, "docs", "design", "open-pit", "mock")
const layout = JSON.parse(
  readFileSync(
    join(ROOT, "src", "views", "open-pit", "data", "layout.json"),
    "utf8"
  )
)
const sim = createPitSim(layout)
const MIN = 60000
const STEP = 2 * MIN
const COUNT = 31
const T0 = msForBeijing(DESIGN_DATE, 20) // 窗口 20:00–21:00，设计稿时刻 20:30 在中间
const pad = (n, w = 2) => String(n).padStart(w, "0")
const iso = (ms) => new Date(ms).toISOString()
const hhmm = (ms) => {
  const d = new Date(ms + 8 * 3600e3)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
const r1 = (x) => Math.round(x * 10) / 10
const r2 = (x) => Math.round(x * 100) / 100

// ---------- 测点定义 ----------
const points = []
const point = (id, name, unit, kind, min, max) =>
  points.push({
    id,
    device: id.split(".")[0],
    name,
    unit,
    kind,
    ...(min != null ? { min } : {}),
    ...(max != null ? { max } : {})
  })
const trucks = layout.devices.filter((d) => d.kind === "truck")
const shovels = layout.devices.filter((d) => d.kind === "shovel")
const SINK_IDS = ["DP-W", "DP-I", "CR-01", "CR-02"]
const GROUPS = ["run", "load", "queue", "swap", "idle", "fault"] // 对应 GROUP_NAME 顺序
const GROUP_KEY = ["运行", "装卸", "排队", "换电", "待命", "故障"]

// 全矿汇总
point("PIT.todayCoalT", "今日运煤量", "t", "counter", 0)
point("PIT.todayStripT", "今日剥离量", "t", "counter", 0)
point("PIT.todayTotalT", "今日煤岩运量", "t", "counter", 0)
point("PIT.todayLoads", "今日装运趟数", "趟", "counter", 0)
point("PIT.ytdCoalWt", "年累运煤量", "万吨", "counter", 0)
point("PIT.ytdStripWt", "年累剥离量", "万吨", "counter", 0)
point("PIT.ytdTotalWt", "年累煤岩运量", "万吨", "counter", 0)
GROUPS.forEach((g, i) =>
  point(`PIT.fleet.${g}`, `车队·${GROUP_KEY[i]}`, "台", "analog", 0, 100)
)
point("PIT.fleet.online", "在线车辆", "台", "analog", 0, 100)
point("PIT.fleet.total", "车辆总数", "台", "analog", 0, 100)
point("PIT.attendance", "出勤率", "比例", "analog", 0, 1)
point("PIT.swapsToday", "今日换电次数", "次", "counter", 0)
// 车辆
trucks.forEach((t) => {
  point(`${t.id}.state`, `${t.name} 状态`, "状态码", "state", 0, 10)
  point(`${t.id}.soc`, `${t.name} 电量`, "%", "analog", 0, 100)
  point(`${t.id}.loadsToday`, `${t.name} 今日趟数`, "趟", "counter", 0)
  point(`${t.id}.tonsToday`, `${t.name} 今日运量`, "t", "counter", 0)
})
// 电铲、破碎站、排土场
shovels.forEach((s) => {
  point(`${s.id}.state`, `${s.name} 状态`, "状态码", "state", 0, 4)
  point(`${s.id}.queue`, `${s.name} 排队`, "台", "analog", 0, 100)
  point(
    `${s.id}.loadsToday`,
    `${s.name} 今日装车（已装完）`,
    "趟",
    "counter",
    0
  )
})
SINK_IDS.forEach((id) => {
  point(`${id}.tonsToday`, `${id} 今日卸载`, "t", "counter", 0)
  point(`${id}.queue`, `${id} 排队`, "台", "analog", 0, 100)
})
// 换电与能源
;["SW-01", "SW-02"].forEach((id) => {
  point(`${id}.busy`, `${id} 在换`, "台", "analog", 0, 4)
  point(`${id}.queue`, `${id} 排队`, "台", "analog", 0, 100)
})
point("CH-01.full", "满电备用电池", "包", "analog", 0, 100)
point("CH-01.charging", "充电中电池", "包", "analog", 0, 100)
point("CH-01.kw", "充电功率", "kW", "analog", 0)
point("CH-01.kwhToday", "今日充电量", "kWh", "counter", 0)
point("PV-01.kw", "光伏功率", "kW", "analog", 0)
point("PV-01.kwhToday", "今日发电量", "kWh", "counter", 0)
point("PV-01.usedKwhToday", "今日光伏充电量", "kWh", "counter", 0)
point("PIT.greenRatio", "绿电占比", "比例", "analog", 0, 1)
// 煤流
point("CY-01.t", "煤场库存", "t", "analog", 0)
point("CY-01.cap", "煤场容量", "t", "analog", 0)
point("CY-01.ratio", "煤场充盈率", "比例", "analog", 0, 1)
point("BC-02.tph", "走廊到煤量", "t/h", "analog", 0)
point("PP-01.burnTph", "电厂耗煤", "t/h", "analog", 0)
// 监测
;["SR-01", "SR-02", "SR-03"].forEach((id) => {
  point(`${id}.velMmH`, `${id} 位移速率`, "mm/h", "analog", 0)
  point(`${id}.level`, `${id} 预警等级`, "级", "state", 0, 3)
})
for (let i = 1; i <= 118; i++) {
  point(`GN-${pad(i, 3)}.disp`, `GN-${pad(i, 3)} 累计位移`, "mm", "analog")
  point(`GN-${pad(i, 3)}.vel`, `GN-${pad(i, 3)} 位移速率`, "mm/h", "analog", 0)
}
for (let i = 1; i <= 23; i++)
  point(`GW-${pad(i)}.level`, `GW-${pad(i)} 水位埋深`, "m", "analog", 0)
for (let i = 1; i <= 9; i++)
  point(`BV-${pad(i)}.ppv`, `BV-${pad(i)} 峰值振速`, "mm/s", "analog", 0)
for (let i = 1; i <= 12; i++) {
  point(`BS-${pad(i)}.online`, `BS-${pad(i)} 在线`, "0/1", "state", 0, 1)
  point(`BS-${pad(i)}.upMbps`, `BS-${pad(i)} 上行速率`, "Mbps", "analog", 0)
}

// ---------- 快照 ----------
const prev = new Map()
const snapshots = []
const bsOff = sim.monitors(DESIGN_T).script.bsOff
const frozen = sim.monitors(msForBeijing(DESIGN_DATE, 0) + bsOff.from * 1000)
for (let k = 0; k < COUNT; k++) {
  const ms = T0 + k * STEP
  const s = sim.at(ms)
  const m = sim.monitors(ms)
  const values = {}
  const put = (id, v, o = {}) => {
    const last = prev.get(id)
    const changedAt =
      o.changedAt ??
      (last == null ? ms - 3600e3 : last.v !== v ? ms - 60e3 : last.changedAt)
    prev.set(id, { v, changedAt })
    values[id] = {
      v,
      q: o.q || "good",
      changedAt: iso(changedAt),
      verifiedAt: iso(o.verifiedAt ?? ms - 1000)
    }
  }
  // 汇总值从明细算出：卸载量取各卸载点的四舍五入值再求和
  const sinkT = Object.fromEntries(s.sinks.map((x) => [x.id, r1(x.tons)]))
  const coalT = r1(sinkT["CR-01"] + sinkT["CR-02"])
  const stripT = r1(sinkT["DP-W"] + sinkT["DP-I"])
  put("PIT.todayCoalT", coalT)
  put("PIT.todayStripT", stripT)
  put("PIT.todayTotalT", r1(coalT + stripT))
  put("PIT.todayLoads", s.today.loads)
  const yc = r1(s.ytd.coal)
  const ys = r1(s.ytd.strip)
  put("PIT.ytdCoalWt", yc)
  put("PIT.ytdStripWt", ys)
  put("PIT.ytdTotalWt", r1(yc + ys))
  GROUPS.forEach((g, i) => put(`PIT.fleet.${g}`, s.counts[i]))
  const online = s.counts.reduce((a, b) => a + b, 0) - s.counts[5]
  put("PIT.fleet.online", online)
  put(
    "PIT.fleet.total",
    s.counts.reduce((a, b) => a + b, 0)
  )
  put("PIT.attendance", online / s.trucks.length)
  put("PIT.swapsToday", s.today.swaps)
  s.trucks.forEach((t) => {
    put(`${t.id}.state`, t.phase)
    put(`${t.id}.soc`, r1(t.soc))
    put(`${t.id}.loadsToday`, t.loads)
    put(`${t.id}.tonsToday`, r1(t.tons))
  })
  s.shovels.forEach((x) => {
    put(`${x.id}.state`, x.state)
    put(`${x.id}.queue`, x.queue)
    put(`${x.id}.loadsToday`, x.loads)
  })
  s.sinks.forEach((x) => {
    put(`${x.id}.tonsToday`, sinkT[x.id])
    put(`${x.id}.queue`, x.queue)
  })
  s.stations.forEach((x) => {
    put(`${x.id}.busy`, x.busy)
    put(`${x.id}.queue`, x.queue)
  })
  put("CH-01.full", s.pool.full)
  put("CH-01.charging", s.pool.charging)
  put("CH-01.kw", Math.round(s.energy.chgKw))
  put("CH-01.kwhToday", r1(s.energy.chgKwh))
  put("PV-01.kw", Math.round(s.energy.pvKw))
  put("PV-01.kwhToday", r1(s.energy.pvKwh))
  put("PV-01.usedKwhToday", r1(s.energy.pvUsedKwh))
  put("PIT.greenRatio", s.energy.pvUsedKwh / Math.max(1, s.energy.chgKwh))
  put("CY-01.t", Math.round(s.yard.t))
  put("CY-01.cap", s.yard.cap)
  put("CY-01.ratio", Math.round(s.yard.t) / s.yard.cap)
  put("BC-02.tph", Math.round(s.yard.beltTph))
  put("PP-01.burnTph", Math.round(s.yard.burnTph))
  m.radar.forEach((r) => {
    put(`${r.id}.velMmH`, r2(r.velMmH))
    put(`${r.id}.level`, r.level)
  })
  m.gnss.forEach((g, i) => {
    const n = i + 1
    // BS-07 离线期间，它覆盖的 GNSS 站数据不再更新：值停在离线那一刻，质量先变不确定再变坏
    if (
      bsOff.sites.includes(n) &&
      ms >= msForBeijing(DESIGN_DATE, 0) + bsOff.from * 1000
    ) {
      const from = msForBeijing(DESIGN_DATE, 0) + bsOff.from * 1000
      const f = frozen.gnss[i]
      const q = ms - from > 600e3 ? "bad" : "uncertain"
      put(`${g.id}.disp`, r2(f.disp), { q, changedAt: from, verifiedAt: from })
      put(`${g.id}.vel`, r2(f.vel), { q, changedAt: from, verifiedAt: from })
    } else {
      put(`${g.id}.disp`, r2(g.disp))
      put(`${g.id}.vel`, r2(g.vel))
    }
  })
  m.gw.forEach((g, i) => {
    const drift =
      g.id === "GW-11" &&
      ms >= msForBeijing(DESIGN_DATE, 20 + 20 / 60) &&
      ms < msForBeijing(DESIGN_DATE, 20 + 45 / 60)
    put(
      `${g.id}.level`,
      r2(g.levelM + (drift ? 0.6 : 0)),
      drift ? { q: "uncertain" } : {}
    )
  })
  m.bv.forEach((b) => put(`${b.id}.ppv`, b.ppv))
  m.bs.forEach((b) => {
    put(`${b.id}.online`, b.online ? 1 : 0)
    put(`${b.id}.upMbps`, b.upMbps)
  })
  snapshots.push({ t: iso(ms), values })
}

// ---------- 口径规则 ----------
const rules = [
  {
    type: "sum",
    target: "PIT.todayCoalT",
    of: ["CR-01.tonsToday", "CR-02.tonsToday"]
  },
  {
    type: "sum",
    target: "PIT.todayStripT",
    of: ["DP-W.tonsToday", "DP-I.tonsToday"]
  },
  {
    type: "sum",
    target: "PIT.todayTotalT",
    of: ["PIT.todayCoalT", "PIT.todayStripT"]
  },
  // 各车今日运量之和 = 全矿运量（单车值四舍五入到 0.1 t，留 1e-4 的相对误差）
  {
    type: "sum",
    target: "PIT.todayTotalT",
    of: trucks.map((t) => `${t.id}.tonsToday`),
    tol: 1e-4
  },
  {
    type: "sum",
    target: "PIT.todayLoads",
    of: trucks.map((t) => `${t.id}.loadsToday`)
  },
  {
    type: "sum",
    target: "PIT.ytdTotalWt",
    of: ["PIT.ytdCoalWt", "PIT.ytdStripWt"]
  },
  {
    type: "sum",
    target: "PIT.fleet.online",
    of: GROUPS.filter((g) => g !== "fault").map((g) => `PIT.fleet.${g}`)
  },
  {
    type: "sum",
    target: "PIT.fleet.total",
    of: GROUPS.map((g) => `PIT.fleet.${g}`)
  },
  {
    type: "ratio",
    target: "PIT.attendance",
    num: "PIT.fleet.online",
    den: "PIT.fleet.total"
  },
  {
    type: "ratio",
    target: "PIT.greenRatio",
    num: "PV-01.usedKwhToday",
    den: "CH-01.kwhToday",
    tol: 1e-3
  },
  { type: "ratio", target: "CY-01.ratio", num: "CY-01.t", den: "CY-01.cap" },
  { type: "stale", maxAgeSec: 600 }
]

// ---------- 时段与预置异常 ----------
const events = sim.eventsBetween(T0, T0 + (COUNT - 1) * STEP)
const win = {
  date: DESIGN_DATE,
  from: "20:00",
  to: "21:00",
  stepMin: 2,
  designAt: "20:30",
  seed: "按日期播种（simulator.js 的 rng），同一天任何时刻可还原",
  abnormal: {
    alarm:
      "SR-02 北帮位移速率二级预警（19:42–23:30，20:30 约 1.4 mm/h，GN-071..075 升高）",
    fault:
      "TK-037 电池温度偏高故障（20:10–20:58）、TK-081 激光雷达脏污（19:50–21:00）",
    stale:
      "BS-07 基站离线（19:55–21:20），GN-064..069 数据过期（≥10 min 后质量变坏）",
    uncertain: "GW-11 水位读数漂移（20:20–20:45，质量不确定）",
    avoid: "TK-052 避让有人驾驶巡检车 CV-02（20:25）"
  },
  events: events.map((e) => ({
    id: e.id,
    kind: e.kind,
    title: e.title,
    level: e.level,
    target: e.target,
    from: hhmm(e.from),
    to: hhmm(e.to),
    desc: e.desc
  }))
}

// ---------- 设计稿用的明细与曲线 ----------
const D = sim.at(DESIGN_T)
const M = sim.monitors(DESIGN_T)
const dayStart = msForBeijing(DESIGN_DATE, 0)
const at = (h) => sim.at(Math.min(DESIGN_T, dayStart + h * 3600e3))
const hourly = []
for (let h = 0; h <= 20; h++) {
  const a = at(h),
    b = at(h + 1)
  hourly.push({
    h,
    coalT: r1(b.today.coalT - a.today.coalT),
    stripT: r1(b.today.stripT - a.today.stripT),
    swaps: b.today.swaps - a.today.swaps
  })
}
const pvCurve = []
for (let h = 6; h <= 18; h += 0.5)
  pvCurve.push({ h, kw: Math.round(sim.at(dayStart + h * 3600e3).energy.pvKw) })
const sr02Spark = []
for (let min = -360; min <= 0; min += 15)
  sr02Spark.push({
    min,
    v: r2(sim.monitors(DESIGN_T + min * MIN).radar[1].velMmH)
  })
// 底部时间条：过去 6 小时车队六类状态台数（每 15 min 一点）
const fleetTimeline = []
for (let min = -360; min <= 0; min += 15) {
  const x = sim.at(DESIGN_T + min * MIN)
  fleetTimeline.push({ min, counts: x.counts })
}
const fleetRows = layout.fleets.map((f) => {
  const ts = D.trucks.filter((t) => t.fleet === f.id)
  const counts = new Array(6).fill(0)
  ts.forEach((t) => counts[t.group]++)
  return {
    id: f.id,
    name: f.name,
    n: f.n,
    work: f.work,
    loaders: f.loaders || [],
    counts: Object.fromEntries(GROUPS.map((g, i) => [g, counts[i]])),
    avgSoc: r1(ts.reduce((a, t) => a + t.soc, 0) / ts.length),
    loadsToday: ts.reduce((a, t) => a + t.loads, 0),
    tonsToday: r1(ts.reduce((a, t) => a + t.tons, 0))
  }
})
const notable = D.trucks
  .filter((t) => t.phase === 10 || t.soc < 32 || t.qpos > 1)
  .sort((a, b) => (b.phase === 10) - (a.phase === 10) || a.soc - b.soc)
  .slice(0, 10)
  .map((t) => ({
    id: t.id,
    fleet: t.fleet,
    state: PHASE_NAME[t.phase],
    soc: r1(t.soc),
    loadsToday: t.loads
  }))
const topGnss = [...M.gnss]
  .sort((a, b) => b.vel - a.vel)
  .slice(0, 6)
  .map((g) => ({
    id: g.id,
    sector: g.sector,
    velMmH: r2(g.vel),
    dispMm: r1(g.disp)
  }))
const design = {
  t: iso(DESIGN_T),
  clock: `${DESIGN_DATE} 20:30`,
  kpi: {
    todayWt: r2(D.today.totalT / 1e4),
    coalWt: r2(D.today.coalT / 1e4),
    stripWt: r2(D.today.stripT / 1e4),
    ytdWt: r1(D.ytd.total),
    ytdCoalWt: r1(D.ytd.coal),
    ytdStripWt: r1(D.ytd.strip),
    attendance: r1(D.attendance),
    loads: D.today.loads,
    swaps: D.today.swaps,
    greenRatio: r1((D.energy.pvUsedKwh / Math.max(1, D.energy.chgKwh)) * 100),
    pvKwh: Math.round(D.energy.pvKwh),
    chgKwh: Math.round(D.energy.chgKwh),
    km: Math.round(D.today.km),
    planWt: null
  },
  groups: Object.fromEntries(GROUP_KEY.map((n, i) => [n, D.counts[i]])),
  phases: Object.fromEntries(PHASE_NAME.map((n, i) => [n, D.phaseCounts[i]])),
  fleets: fleetRows,
  hourly,
  fleetTimeline,
  shovels: D.shovels.map((x) => ({
    id: x.id,
    fleet: x.fleet,
    state: SHOVEL_STATE[x.state],
    queue: x.queue,
    loads: x.loads
  })),
  sinks: D.sinks.map((x) => ({
    id: x.id,
    tonsWt: r2(x.tons / 1e4),
    queue: x.queue
  })),
  stations: D.stations,
  pool: D.pool,
  energy: {
    pvKw: Math.round(D.energy.pvKw),
    chgKw: Math.round(D.energy.chgKw),
    pvCurve
  },
  yard: {
    t: Math.round(D.yard.t),
    cap: D.yard.cap,
    ratio: r1((D.yard.t / D.yard.cap) * 100),
    beltTph: Math.round(D.yard.beltTph),
    burnTph: Math.round(D.yard.burnTph)
  },
  slope: {
    radar: M.radar.map((r) => ({
      id: r.id,
      velMmH: r2(r.velMmH),
      level: r.level,
      dispMax: r1(r.dispMax)
    })),
    topGnss,
    sr02Spark
  },
  groundwater: {
    minM: r2(Math.min(...M.gw.map((g) => g.levelM))),
    maxM: r2(Math.max(...M.gw.map((g) => g.levelM)))
  },
  comms: {
    online: M.bs.filter((b) => b.online).length,
    total: 12,
    avgUpMbps: Math.round(
      M.bs.filter((b) => b.online).reduce((a, b) => a + b.upMbps, 0) /
        M.bs.filter((b) => b.online).length
    ),
    bs: M.bs
  },
  notableTrucks: notable,
  events: sim.eventsBetween(DESIGN_T - 4 * 3600e3, DESIGN_T).map((e) => ({
    id: e.id,
    kind: e.kind,
    title: e.title,
    level: e.level,
    target: e.target,
    from: hhmm(e.from),
    to: hhmm(e.to),
    active: e.from <= DESIGN_T && e.to >= DESIGN_T,
    desc: e.desc
  }))
}

mkdirSync(OUT, { recursive: true })
const w = (name, data) =>
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 1) + "\n")
w("points.json", points)
w("snapshots.json", snapshots)
w("rules.json", rules)
w("window.json", win)
w("design.json", design)
// 设计稿 HTML 用 file:// 打开，不能 fetch json，所以另存成 data.js
const SRC = join(ROOT, "docs", "design", "open-pit", "design", "src")
mkdirSync(SRC, { recursive: true })
writeFileSync(
  join(SRC, "data.js"),
  "// 由 scripts/open-pit/mock.mjs 生成，不要手改\nwindow.DESIGN = " +
    JSON.stringify(design) +
    "\n"
)
console.log(
  `测点 ${points.length}，快照 ${snapshots.length}，规则 ${rules.length}，事件 ${win.events.length}`
)
console.log("设计时刻 KPI", design.kpi, "状态", design.groups)

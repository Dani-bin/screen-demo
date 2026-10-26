/**
 * 带式输送机孪生：模拟数据快照
 * ----------------------------------------------------------
 * 用页面同一份仿真器（src/views/smart-conveyor/sim/simulator.js）和测点层（telemetry.js），
 * 在一个固定时段里每 2 分钟取一份快照，写成 build-3d-visual-dashboard 的数据格式（docs/design/smart-conveyor/mock/）：
 *   points.json 测点定义、snapshots.json 31 份快照（1 小时）、rules.json 口径规则、
 *   window.json 时段、事件、劣化过程和设计时刻；design.json 设计稿面板要用的曲线和明细（沿线温度、听诊、X 光、频谱、24 h 趋势）
 *
 * 时段自动挑选：2026-10-18 起 21 天、09:00–21:00 开头的小时里，挑出同时有
 * 平台预警（劣化 ≥ 三级）、突发告警、数据过期（UWB 基站离线 / 光纤主机断线）、质量不确定（低电量 / 镜头脏污）的一小时，
 * 有保护停机、劣化托辊装了温速传感器的优先。设计稿要画这几种异常态。
 *
 * 用法：node scripts/smart-conveyor/mock.mjs   之后跑
 *       node ~/src/build-3d-visual-dashboard/scripts/data-check.mjs docs/design/smart-conveyor/mock
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  beijing,
  createConveyorSim,
  msForBeijing
} from "../../src/views/smart-conveyor/sim/simulator.js"
import {
  definePoints,
  readPoints
} from "../../src/views/smart-conveyor/sim/telemetry.js"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const OUT = join(ROOT, "docs", "design", "smart-conveyor", "mock")
const layout = JSON.parse(
  readFileSync(
    join(ROOT, "src", "views", "smart-conveyor", "data", "layout.json"),
    "utf8"
  )
)
const sim = createConveyorSim(layout)
const points = definePoints(layout)
const MIN = 60000
const STEP = 2 * MIN
const COUNT = 31
const QUALITY = ["battery", "camDirty"]
const STALE = ["uwbOff", "comm"]

const iso = (ms) => new Date(ms).toISOString()
const bjText = (ms) => {
  const b = beijing(ms)
  return `${b.date} ${String(b.h).padStart(2, "0")}:${String(b.m).padStart(2, "0")}`
}

/** 挑时段 */
function pickWindow() {
  let best = null
  for (let d = 0; d < 21; d++) {
    const date = new Date(Date.UTC(2026, 9, 18 + d)).toISOString().slice(0, 10)
    for (let h = 9; h <= 21.5; h += 0.5) {
      const t0 = msForBeijing(date, h)
      const t1 = t0 + (COUNT - 1) * STEP
      const evs = sim.eventsBetween(t0, t1)
      const stale = evs.find(
        (e) =>
          STALE.includes(e.kind) &&
          e.at > t0 + 5 * MIN &&
          e.at < t1 - 8 * MIN &&
          e.end - e.at > 3 * MIN
      )
      const unc = evs.find(
        (e) =>
          QUALITY.includes(e.kind) &&
          e.at < t1 - 4 * MIN &&
          e.end > t0 + 4 * MIN
      )
      const inst = evs.filter((e) => !e.quality && e.at > t0 && e.at < t1)
      if (!stale || !unc || inst.length < 2) continue
      const mid = sim.at(t0 + 30 * MIN)
      if (mid.belts.BC02.v < 0.05) continue
      const warn = mid.tracks.filter((tr) => tr.s >= 0.35)
      if (!warn.length) continue
      const score =
        inst.length +
        (evs.some((e) => e.kind === "trip" && e.at > t0 && e.at < t1 - 10 * MIN)
          ? 6
          : 0) +
        (warn.some((tr) => tr.sensor) ? 3 : 0) +
        (warn.some((tr) => tr.s >= 0.7) ? 2 : 0) +
        (warn.some((tr) => tr.kind === "idlerBearing") ? 2 : 0) +
        (stale.kind === "comm" ? 1 : 0)
      if (!best || score > best.score) best = { date, h, t0, t1, score, stale }
    }
  }
  if (!best) throw new Error("21 天内没找到满足条件的时段")
  return best
}

const win = pickWindow()
const times = Array.from({ length: COUNT }, (_, k) => win.t0 + k * STEP)

// 快照
const snapshots = times.map((ms) => {
  const vals = readPoints(sim, points, ms)
  const values = {}
  for (const [id, x] of Object.entries(vals))
    values[id] = {
      v: x.v,
      q: x.q,
      changedAt: iso(x.changedAt),
      verifiedAt: iso(x.verifiedAt)
    }
  return { t: iso(ms), values }
})

// 口径规则：汇总值都从明细算出
const ids = (pred) => points.filter(pred).map((p) => p.id)
const rules = [
  { type: "sum", target: "MINE.outputToday", of: ["BC02-SC.tonsToday"] },
  {
    type: "equal",
    points: ["BC02-SC.tonsToday", "BC01-SC.tonsToday"],
    tol: 0.01
  },
  {
    type: "sum",
    target: "MINE.powerTotal",
    of: ids((p) => p.id.match(/^BC0\d-M\d\.power$/))
  },
  ...layout.belts.map((b) => ({
    type: "sum",
    target: `${b.id}.power`,
    of: ids((p) => p.id.startsWith(`${b.id}-M`) && p.id.endsWith(".power"))
  })),
  {
    type: "sum",
    target: "MINE.energyToday",
    of: layout.belts.map((b) => `${b.id}.energyToday`)
  },
  { type: "sum", target: "MINE.regenToday", of: ["BC04.regenToday"] },
  {
    type: "ratio",
    target: "MINE.kwhPerTon",
    num: "MINE.energyToday",
    den: "MINE.outputToday"
  },
  {
    type: "sum",
    target: "MINE.inventory",
    of: layout.bunkers.map((m) => `${m.id}.tons`)
  },
  {
    type: "sum",
    target: "MINE.beltsRunning",
    of: layout.belts.map((b) => `${b.id}.running`)
  },
  {
    type: "sum",
    target: "MINE.peopleUnderground",
    of: ["BC02", "BC03", "BC04", "BC05", "BC06", "WF12301", "WF12305"].map(
      (a) => `${a}.people`
    )
  },
  {
    type: "sum",
    target: "MINE.alarm.total",
    of: ["person", "machine", "material", "env"].map((k) => `MINE.alarm.${k}`)
  },
  {
    type: "sum",
    target: "MINE.alarm.total",
    of: ["l1", "l2", "l3", "l4"].map((k) => `MINE.alarm.${k}`)
  },
  {
    type: "sum",
    target: "MINE.dev.total",
    of: ["normal", "attention", "warning", "fault"].map((k) => `MINE.dev.${k}`)
  },
  // 过期：data-check 只支持一个全局阈值，取最宽的无线类 25 min；PLC 10 s、光纤 / UWB 30 s 由测点层自己判定（见 04 文档）
  { type: "stale", maxAgeSec: 1500 }
]

// 设计时刻：时段里同时在发生的告警种类最多、且数据过期正在发生的那一刻
let designAt = times[15]
let bestN = -1
for (const ms of times) {
  const al = sim.alarmsAt(ms)
  const kinds = new Set(al.map((a) => a.kind))
  const n =
    kinds.size +
    (al.some((a) => STALE.includes(a.kind)) ? 5 : 0) +
    (al.some((a) => a.predictive) ? 3 : 0)
  if (n > bestN) [bestN, designAt] = [n, ms]
}

// 时段说明
const evs = sim.eventsBetween(win.t0, win.t1)
const window = {
  date: win.date,
  from: bjText(win.t0),
  to: bjText(win.t1),
  designAt: bjText(designAt),
  designAtIso: iso(designAt),
  snapshots: COUNT,
  stepMin: 2,
  points: points.length,
  events: evs.map((e) => ({
    id: e.id,
    kind: e.kind,
    title: e.title,
    level: ["一级", "二级", "三级", "四级"][e.level],
    dim: e.dim,
    device: e.device,
    quality: e.quality,
    from: bjText(e.at),
    to: bjText(e.end)
  })),
  tracks: sim.tracksAt(designAt).map((tr) => ({
    id: tr.id,
    kind: tr.kind,
    name: tr.name,
    where: tr.where,
    device: tr.device,
    sensor: tr.sensor || null,
    severity: Math.round(sim.severity(tr, designAt) * 100) / 100,
    onset: bjText(tr.t0),
    warn: bjText(tr.tWarn),
    alarm: bjText(tr.tAlarm),
    fix: bjText(tr.tFix)
  }))
}

// 设计稿要用的曲线和明细（只取设计时刻）
const s = sim.at(designAt)
const down = (arr, k) =>
  Array.from(
    { length: Math.ceil(arr.length / k) },
    (_, i) => Math.round(arr[i * k] * 10) / 10
  )
const hourly = []
const d0 = msForBeijing(beijing(designAt).date, 0)
for (let ms = d0; ms <= designAt; ms += 30 * MIN) {
  const x = sim.at(ms)
  hourly.push({
    t: bjText(ms).slice(11),
    flow: Math.round(x.kpi.flowNow),
    power: Math.round(x.kpi.powerTotal),
    output: Math.round(x.kpi.outputToday),
    kwhPerTon: Math.round(x.kpi.kwhPerTon * 100) / 100,
    MC01: Math.round(x.bunkers.MC01.level * 1000) / 10,
    MC02: Math.round(x.bunkers.MC02.level * 1000) / 10,
    MC03: Math.round(x.bunkers.MC03.level * 1000) / 10
  })
}
const worst = window.tracks
  .filter((tr) => tr.kind === "motorBearing" || tr.kind === "reducerGear")
  .sort((a, b) => b.severity - a.severity)[0]
const specDev = worst ? worst.device : "BC02-M1"
const spec = sim.spectrum(specDev, designAt)
const design = {
  at: bjText(designAt),
  kpi: s.kpi,
  belts: Object.fromEntries(
    Object.entries(s.belts).map(([k, b]) => [
      k,
      {
        state: b.stateName,
        v: b.v,
        load: b.load,
        power: b.power,
        fill: b.fill,
        deviation: b.deviation
      }
    ])
  ),
  bunkers: s.bunkers,
  faces: s.faces,
  alarms: s.alarms.map((a) => ({
    title: a.title,
    level: a.level,
    dim: a.dim,
    device: a.device,
    belt: a.belt,
    chainage: a.chainage,
    status: a.status,
    at: bjText(a.at),
    predictive: !!a.predictive
  })),
  maint: s.maint.map((w) => ({
    id: w.id,
    belt: w.belt,
    title: w.title,
    from: bjText(w.start),
    to: bjText(w.end),
    crew: w.crew
  })),
  people: s.people.map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    area: p.area,
    chainage: p.chainage ?? null
  })),
  robots: s.robots,
  dts: Object.fromEntries(
    ["BC02", "BC03", "BC04", "BC05"].map((b) => [
      b,
      { step: 2, T: down(sim.dts(b, designAt), 2) }
    ])
  ),
  das: Object.fromEntries(
    ["BC02", "BC03"].map((b) => {
      const a = sim.das(b, designAt)
      return [
        b,
        {
          pitch: a.pitch,
          score: Array.from(a.score, (x) => Math.round(x * 100) / 100),
          found: a.found
        }
      ]
    })
  ),
  xray: Object.fromEntries(
    ["BC02", "BC03"].map((b) => [b, sim.xray(b, designAt)])
  ),
  spectrum: {
    device: specDev,
    f1: spec.f1,
    bpfo: spec.bpfo,
    gmf: spec.gmf,
    vel: down(spec.vel, 1),
    env: down(spec.env, 1),
    df: spec.df
  },
  profile: Object.fromEntries(
    layout.belts.map((b) => [
      b.id,
      { step: 10, kgPerM: down(sim.profile(b.id, designAt, 10), 1) }
    ])
  ),
  hourly
}

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, "points.json"), JSON.stringify(points, null, 1))
writeFileSync(join(OUT, "snapshots.json"), JSON.stringify(snapshots))
writeFileSync(join(OUT, "rules.json"), JSON.stringify(rules, null, 1))
writeFileSync(join(OUT, "window.json"), JSON.stringify(window, null, 1))
writeFileSync(join(OUT, "design.json"), JSON.stringify(design))
console.log(
  `时段 ${window.from} – ${window.to}（${COUNT} 份快照，${points.length} 个测点），设计时刻 ${window.designAt}`
)
console.log("事件：")
for (const e of window.events)
  console.log(
    `  ${e.from.slice(11)}–${e.to.slice(11)} ${e.level} ${e.title}（${e.device}${e.quality ? "，" + e.quality : ""}）`
  )
console.log("劣化过程：")
for (const tr of window.tracks)
  console.log(
    `  ${tr.where} ${tr.name} s=${tr.severity}${tr.sensor ? "（有温速传感器）" : ""} 预警 ${tr.warn} 消缺 ${tr.fix}`
  )

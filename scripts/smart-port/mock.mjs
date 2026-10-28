/**
 * 智慧港口：模拟数据快照
 * ----------------------------------------------------------
 * 用页面同一份仿真器（src/views/smart-port/sim/simulator.js）在一个固定时段里每 2 分钟取一份快照，
 * 写成 build-3d-visual-dashboard 的数据格式（docs/design/smart-port/mock/）：
 *   points.json 测点定义、snapshots.json 31 份快照（1 小时）、rules.json 口径规则、window.json 时段与事件
 * 时段自动挑选：2026-10-12 起 21 天、08:00–18:00 开头的小时（不跨零点）里，挑出同时有岸桥故障（告警）、
 * AGV 定位中断（不确定 → 过期）、至少 3 条船在泊作业的一小时，有风速仪读数异常的优先。设计稿要画这几种异常态。
 *
 * 用法：node scripts/smart-port/mock.mjs   之后跑
 *       node ~/src/build-3d-visual-dashboard/scripts/data-check.mjs docs/design/smart-port/mock
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  beijing,
  createPortSim,
  msForBeijing
} from "../../src/views/smart-port/sim/simulator.js"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const OUT = join(ROOT, "docs", "design", "smart-port", "mock")
const layout = JSON.parse(
  readFileSync(
    join(ROOT, "src", "views", "smart-port", "data", "layout.json"),
    "utf8"
  )
)
const sim = createPortSim(layout)
const MIN = 60000
const STEP = 2 * MIN
const COUNT = 31
/** AGV 定位超过 2 分钟没更新算过期（与仿真里"定位信号中断"的描述一致） */
const STALE_SEC = 120

const AT_QUAY = ["moored", "working", "finishing"]

/**
 * 找一个满足条件的小时：岸桥故障（告警，要在时段中间、能画出"处置中"）和 AGV 定位中断必须有，
 * 至少 3 条船在泊作业；同时还有风速仪读数异常的优先（多一种"不确定"质量）。
 * AGV 定位中断本身就带两种质量：中断后 2 分钟内是 uncertain，超过 2 分钟是 bad（过期）。
 */
function pickWindow() {
  let best = null
  for (let d = 0; d < 21; d++) {
    const date = new Date(Date.UTC(2026, 9, 12 + d)).toISOString().slice(0, 10)
    for (let h = 8; h <= 17; h++) {
      const t0 = msForBeijing(date, h)
      const t1 = t0 + (COUNT - 1) * STEP
      const evs = sim.eventsAt(t1).filter((e) => e.at < t1 && e.end > t0)
      const qf = evs.find(
        (e) =>
          e.kind === "qcFault" && e.at > t0 + 5 * MIN && e.at < t1 - 25 * MIN
      )
      // 定位中断要在时段里开始，并且持续超过 2 分钟（才会变成过期）
      const lost = evs.find(
        (e) =>
          e.kind === "agvSignal" &&
          e.at > t0 &&
          e.at < t1 - 6 * MIN &&
          e.end - e.at > 6 * MIN
      )
      if (!qf || !lost) continue
      const s0 = sim.at(t0)
      const berthed = s0.vessels.filter((v) => AT_QUAY.includes(v.stage)).length
      if (berthed < 3) continue
      const score =
        berthed +
        (evs.some((e) => e.kind === "sensor") ? 10 : 0) +
        (evs.some((e) => e.kind === "delay") ? 3 : 0)
      if (!best || score > best.score) best = { date, h, t0, t1, evs, score }
    }
  }
  if (!best)
    throw new Error("21 天内没找到同时出现岸桥故障和 AGV 定位中断的小时")
  return best
}

/** 测点定义：id = <对象编号>.<量> */
function definePoints(s0, vessels) {
  const P = []
  const add = (id, device, name, unit, kind, min, max) =>
    P.push({
      id,
      device,
      name,
      unit,
      kind,
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {})
    })
  add("PORT.movesToday", "PORT", "今日作业量", "自然箱", "counter", 0)
  add("PORT.teuToday", "PORT", "今日吞吐量", "TEU", "counter", 0)
  add("PORT.qcHours", "PORT", "今日岸桥作业时长合计", "h", "counter", 0)
  add("PORT.qcTph", "PORT", "岸桥平均台时量", "自然箱/h", "analog", 0, 80)
  add("PORT.vesselsAtBerth", "PORT", "在泊作业船舶", "艘", "analog", 0, 7)
  add("PORT.vesselRate", "PORT", "平均船时效率", "自然箱/h", "analog", 0, 400)
  for (const k of ["total", "work", "idle", "fault", "maint"])
    add(`PORT.qc.${k}`, "PORT", `岸桥 ${k}`, "台", "analog", 0, 28)
  for (const k of ["total", "work", "idle", "fault"])
    add(`PORT.rmg.${k}`, "PORT", `轨道吊 ${k}`, "台", "analog", 0, 121)
  for (const k of ["total", "laden", "empty", "queue", "idle", "swap", "fault"])
    add(`PORT.agv.${k}`, "PORT", `AGV ${k}`, "台", "analog", 0, 145)
  add("PORT.yardTeu", "PORT", "堆场在场箱量", "TEU", "analog", 0)
  add("PORT.yardCap", "PORT", "堆场容量", "TEU", "analog", 0)
  add("PORT.yardFill", "PORT", "堆场利用率", "", "analog", 0, 1)
  add("PORT.alarmsActive", "PORT", "未结束告警", "条", "analog", 0)
  for (const c of s0.cranes) {
    add(`${c.id}.state`, c.id, "作业状态", "", "state")
    add(`${c.id}.vessel`, c.id, "作业船舶", "", "state")
    add(`${c.id}.rate`, c.id, "当前效率", "自然箱/h", "analog", 0, 80)
    add(`${c.id}.movesToday`, c.id, "今日作业量", "自然箱", "counter", 0)
    add(`${c.id}.teuToday`, c.id, "今日 TEU", "TEU", "counter", 0)
    add(`${c.id}.hoursToday`, c.id, "今日作业时长", "h", "counter", 0, 24)
    add(`${c.id}.tph`, c.id, "今日台时量", "自然箱/h", "analog", 0, 80)
    add(`${c.id}.wind`, c.id, "风速", "m/s", "analog", 0, 40)
  }
  for (const b of s0.blocks) {
    add(`${b.id}.teu`, b.id, "在场箱量", "TEU", "analog", 0, b.cap)
    add(`${b.id}.cap`, b.id, "箱区容量", "TEU", "analog", 0)
    for (const r of b.rmg) add(`${r.id}.state`, r.id, "作业状态", "", "state")
  }
  for (const a of s0.agvs) {
    add(`${a.id}.state`, a.id, "状态", "", "state")
    add(`${a.id}.soc`, a.id, "电量", "%", "analog", 0, 100)
  }
  for (const s of s0.swaps) {
    add(`${s.id}.swapping`, s.id, "换电中", "台", "analog", 0, 16)
    add(`${s.id}.queue`, s.id, "往返 / 排队", "台", "analog", 0, 145)
    add(`${s.id}.swapsToday`, s.id, "今日换电次数", "次", "counter", 0)
  }
  add("MET-01.wind", "MET-01", "风速（10 分钟平均）", "m/s", "analog", 0, 40)
  add("MET-01.gust", "MET-01", "阵风", "m/s", "analog", 0, 50)
  add("MET-01.dir", "MET-01", "风向", "°", "analog", 0, 360)
  add("MET-01.tide", "MET-01", "潮位", "m", "analog", -1, 6)
  for (const v of vessels) {
    add(`${v.id}.stage`, v.id, `${v.name} 作业阶段`, "", "state")
    add(
      `${v.id}.done`,
      v.id,
      `${v.name} 已完成`,
      "自然箱",
      "counter",
      0,
      v.moves
    )
    add(`${v.id}.moves`, v.id, `${v.name} 计划箱量`, "自然箱", "analog", 0)
    add(
      `${v.id}.rate`,
      v.id,
      `${v.name} 船时效率`,
      "自然箱/h",
      "analog",
      0,
      400
    )
  }
  return P
}

/** 一份快照的原始数值（不含质量和时间） */
function readValues(s, vessels) {
  const V = {}
  const k = s.kpi
  V["PORT.movesToday"] = k.movesToday
  V["PORT.teuToday"] = k.teuToday
  V["PORT.qcHours"] = +s.cranes.reduce((n, c) => n + c.hoursToday, 0).toFixed(4)
  V["PORT.qcTph"] = +(k.movesToday / V["PORT.qcHours"]).toFixed(4)
  V["PORT.vesselsAtBerth"] = k.vesselsAtBerth
  V["PORT.vesselRate"] = +k.vesselRate.toFixed(2)
  for (const key of ["total", "work", "idle", "fault", "maint"])
    V[`PORT.qc.${key}`] = k.qc[key]
  for (const key of ["total", "work", "idle", "fault"])
    V[`PORT.rmg.${key}`] = k.rmg[key]
  for (const key of [
    "total",
    "laden",
    "empty",
    "queue",
    "idle",
    "swap",
    "fault"
  ])
    V[`PORT.agv.${key}`] = k.agv[key]
  V["PORT.yardTeu"] = k.yardTeu
  V["PORT.yardCap"] = k.yardCap
  V["PORT.yardFill"] = +(k.yardTeu / k.yardCap).toFixed(6)
  V["PORT.alarmsActive"] = k.alarmsActive
  for (const c of s.cranes) {
    V[`${c.id}.state`] = c.state
    V[`${c.id}.vessel`] = c.vessel || "—"
    V[`${c.id}.rate`] = +c.rate.toFixed(1)
    V[`${c.id}.movesToday`] = c.movesToday
    V[`${c.id}.teuToday`] = c.teuToday
    V[`${c.id}.hoursToday`] = +c.hoursToday.toFixed(4)
    V[`${c.id}.tph`] = +c.tph.toFixed(1)
    V[`${c.id}.wind`] = +c.wind.toFixed(1)
  }
  for (const b of s.blocks) {
    V[`${b.id}.teu`] = b.teu
    V[`${b.id}.cap`] = b.cap
    for (const r of b.rmg) V[`${r.id}.state`] = r.state
  }
  for (const a of s.agvs) {
    V[`${a.id}.state`] = a.state
    V[`${a.id}.soc`] = Math.round(a.soc)
  }
  for (const st of s.swaps) {
    V[`${st.id}.swapping`] = st.swapping
    V[`${st.id}.queue`] = st.queue
    V[`${st.id}.swapsToday`] = st.swapsToday
  }
  V["MET-01.wind"] = +s.met.wind.toFixed(1)
  V["MET-01.gust"] = +s.met.gust.toFixed(1)
  V["MET-01.dir"] = Math.round(s.met.dir)
  V["MET-01.tide"] = +s.met.tide.toFixed(2)
  for (const v0 of vessels) {
    const v = s.vessels.find((x) => x.id === v0.id)
    V[`${v0.id}.stage`] = v.stage
    V[`${v0.id}.done`] = v.done
    V[`${v0.id}.moves`] = v.moves
    V[`${v0.id}.rate`] = +v.rate.toFixed(1)
  }
  return V
}

const win = pickWindow()
const s0 = sim.at(win.t0)
const s1 = sim.at(win.t1)
// 快照只收这一小时里始终在泊的船（每个快照必须包含全部测点）
const vessels = s0.vessels.filter(
  (v) => AT_QUAY.includes(v.stage) && s1.vessels.some((x) => x.id === v.id)
)
const points = definePoints(s0, vessels)

const iso = (ms) => new Date(ms).toISOString()
const last = new Map()
const snapshots = []
for (let i = 0; i < COUNT; i++) {
  const t = win.t0 + i * STEP
  const s = sim.at(t)
  const raw = readValues(s, vessels)
  // 质量：定位中断的 AGV 读数冻结在中断那一刻，超过 2 分钟质量为 bad；风速仪异常的岸桥风速为 uncertain
  const lost = new Map(
    s.events
      .filter((e) => e.kind === "agvSignal" && e.status !== "resolved")
      .map((e) => [e.target, e])
  )
  const odd = new Set(
    s.events
      .filter((e) => e.kind === "sensor" && e.status !== "resolved")
      .map((e) => e.target)
  )
  const values = {}
  for (const p of points) {
    let v = raw[p.id]
    let q = "good"
    let verifiedAt = t
    const prev = last.get(p.id)
    const lostEv = lost.get(p.device)
    if (lostEv) {
      // 最后一次验证 = 中断开始；数值保持中断前最后一次读到的
      verifiedAt = Math.max(
        lostEv.at,
        prev ? Date.parse(prev.verifiedAt) : lostEv.at
      )
      verifiedAt = Math.min(verifiedAt, t)
      if (prev) v = prev.v
      q = (t - verifiedAt) / 1000 > STALE_SEC ? "bad" : "uncertain"
    }
    if (odd.has(p.device) && p.id.endsWith(".wind")) q = "uncertain"
    const changedAt = !prev
      ? t - 60000
      : prev.v !== v
        ? t
        : Date.parse(prev.changedAt)
    const rec = {
      v,
      q,
      changedAt: iso(Math.min(changedAt, verifiedAt)),
      verifiedAt: iso(verifiedAt)
    }
    values[p.id] = rec
    last.set(p.id, rec)
  }
  snapshots.push({ t: iso(t), values })
}

// 口径规则：汇总值 = 明细之和，比值从汇总算，不平均百分比
const ids = (re) => points.filter((p) => re.test(p.id)).map((p) => p.id)
const rules = [
  { type: "sum", target: "PORT.movesToday", of: ids(/^QC\d+\.movesToday$/) },
  { type: "sum", target: "PORT.teuToday", of: ids(/^QC\d+\.teuToday$/) },
  {
    type: "sum",
    target: "PORT.qcHours",
    of: ids(/^QC\d+\.hoursToday$/),
    tol: 1e-3
  },
  {
    type: "ratio",
    target: "PORT.qcTph",
    num: "PORT.movesToday",
    den: "PORT.qcHours",
    tol: 1e-3
  },
  {
    type: "sum",
    target: "PORT.qc.total",
    of: ["PORT.qc.work", "PORT.qc.idle", "PORT.qc.fault", "PORT.qc.maint"]
  },
  {
    type: "sum",
    target: "PORT.rmg.total",
    of: ["PORT.rmg.work", "PORT.rmg.idle", "PORT.rmg.fault"]
  },
  {
    type: "sum",
    target: "PORT.agv.total",
    of: [
      "PORT.agv.laden",
      "PORT.agv.empty",
      "PORT.agv.queue",
      "PORT.agv.idle",
      "PORT.agv.swap",
      "PORT.agv.fault"
    ]
  },
  { type: "sum", target: "PORT.yardTeu", of: ids(/^Y\d+\.teu$/) },
  { type: "sum", target: "PORT.yardCap", of: ids(/^Y\d+\.cap$/) },
  {
    type: "ratio",
    target: "PORT.yardFill",
    num: "PORT.yardTeu",
    den: "PORT.yardCap",
    tol: 1e-5
  },
  { type: "stale", maxAgeSec: STALE_SEC }
]

const fmt = (ms) => beijing(ms).hm
const windowInfo = {
  date: win.date,
  from: fmt(win.t0),
  to: fmt(win.t1),
  stepMin: STEP / MIN,
  seed: "航次按 航线 + 周次 播种，日事件按日期播种（simulator.js 的 rng）",
  vessels: vessels.map((v) => ({
    id: v.id,
    name: v.name,
    cls: v.clsName,
    berths: v.berths,
    moves: v.moves
  })),
  events: win.evs
    .sort((a, b) => a.at - b.at)
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      title: e.title,
      level: e.level,
      target: e.target,
      from: fmt(e.at),
      to: fmt(e.end),
      desc: e.desc
    }))
}

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, "points.json"), JSON.stringify(points, null, 1) + "\n")
writeFileSync(join(OUT, "snapshots.json"), JSON.stringify(snapshots) + "\n")
writeFileSync(join(OUT, "rules.json"), JSON.stringify(rules, null, 1) + "\n")
writeFileSync(
  join(OUT, "window.json"),
  JSON.stringify(windowInfo, null, 1) + "\n"
)
console.log(
  `时段 ${win.date} ${windowInfo.from}–${windowInfo.to}，测点 ${points.length} 个，快照 ${snapshots.length} 份`
)
for (const e of windowInfo.events)
  console.log(`  ${e.from}–${e.to} ${e.title} ${e.target} ${e.desc}`)

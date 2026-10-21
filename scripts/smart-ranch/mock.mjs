/**
 * 智慧牧场：模拟数据快照
 * ----------------------------------------------------------
 * 用页面同一份仿真器（src/views/smart-ranch/sim/simulator.js）在一个固定时段里每分钟取一份快照，
 * 写成 build-3d-visual-dashboard 的数据格式（docs/design/smart-ranch/mock/）：
 *   points.json 测点定义、snapshots.json 61 份快照（1 小时）、rules.json 口径规则
 * 时段自动挑选：从 2026-07-24 起逐小时往后找，直到这一小时里同时出现
 * 越界、饮水点水位低、头羊项圈离线（数据过期）和流量读数不确定，设计稿要画这几种异常态。
 *
 * 用法：node scripts/smart-ranch/mock.mjs   之后跑
 *       node ~/.claude/skills/build-3d-visual-dashboard/scripts/data-check.mjs docs/design/smart-ranch/mock
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  createRanchSim,
  msForDemo
} from "../../src/views/smart-ranch/sim/simulator.js"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const OUT = join(ROOT, "docs", "design", "smart-ranch", "mock")
const layout = JSON.parse(
  readFileSync(
    join(ROOT, "src", "views", "smart-ranch", "data", "layout.json"),
    "utf8"
  )
)
const sim = createRanchSim(layout)

/** 测点定义：id = <对象编号>.<量> */
function definePoints(s0) {
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
  add("RANCH.head", "RANCH", "存栏总数", "头只", "analog", 0)
  add("RANCH.sheepHead", "RANCH", "羊存栏", "只", "analog", 0)
  add("RANCH.cattleHead", "RANCH", "牛存栏", "头", "analog", 0)
  add("RANCH.su", "RANCH", "实际载畜量", "羊单位", "analog", 0)
  add("RANCH.capacity", "RANCH", "合理载畜量", "羊单位", "analog", 0)
  add("RANCH.loadRatio", "RANCH", "载畜比（实际 ÷ 合理）", "", "analog", 0, 3)
  add("RANCH.balance", "RANCH", "草畜平衡指数", "%", "analog", -100, 200)
  add("RANCH.ndvi", "RANCH", "草场 NDVI（面积加权）", "", "analog", -0.2, 1)
  add("RANCH.collarsTotal", "RANCH", "项圈总数", "个", "analog", 0)
  add("RANCH.collarsOnline", "RANCH", "在线项圈", "个", "analog", 0)
  add("RANCH.onlineRate", "RANCH", "项圈在线率", "", "analog", 0, 1)
  add("RANCH.supplied", "RANCH", "今日供水", "m³", "counter", 0)
  add("RANCH.alarmsActive", "RANCH", "未结束告警", "条", "analog", 0)
  for (const u of s0.units) {
    add(`${u.id}.su`, u.id, "实际载畜量", "羊单位", "analog", 0)
    add(`${u.id}.capacity`, u.id, "合理载畜量", "羊单位", "analog", 0)
    add(`${u.id}.balance`, u.id, "草畜平衡指数", "%", "analog", -100, 200)
    add(`${u.id}.grazing`, u.id, "当前放牧分区", "", "state")
  }
  for (const p of s0.paddocks) {
    add(`${p.id}.status`, p.id, "分区状态", "", "state")
    add(`${p.id}.ndvi`, p.id, "NDVI（当月，真实）", "", "analog", -0.2, 1)
    add(`${p.id}.forage`, p.id, "可食草量（示意）", "kg/亩", "analog", 0, 400)
    add(`${p.id}.restDays`, p.id, "休牧天数", "天", "analog", 0, 200)
  }
  for (const h of s0.herds) {
    add(
      `${h.id}.head`,
      h.id,
      "头数",
      h.kind === "sheep" ? "只" : "头",
      "analog",
      0
    )
    add(`${h.id}.x`, h.id, "群中心 x", "m", "analog", -6000, 6000)
    add(`${h.id}.y`, h.id, "群中心 y", "m", "analog", -5000, 5000)
    add(`${h.id}.walkKm`, h.id, "今日行走", "km", "counter", 0, 30)
    add(`${h.id}.collarsOnline`, h.id, "在线项圈", "个", "analog", 0)
  }
  for (const w of s0.water) {
    add(`${w.id}.level`, w.id, "水罐液位", "%", "analog", 0, 100)
    add(`${w.id}.supplied`, w.id, "今日供水", "m³", "counter", 0)
    add(`${w.id}.pump`, w.id, "提水泵", "", "state")
  }
  // 头羊项圈（21 个）：在线状态与上报
  for (const h of s0.herds.filter((x) => x.kind === "sheep"))
    for (const c of h.leads)
      add(`${c.id}.online`, c.id, "项圈在线", "", "state")
  return P
}

/** 把仿真状态转成 {测点: {v, q, changedAt, verifiedAt}}；changedAt 按上一份快照判断是否变化 */
function toValues(s, ms, prev) {
  const iso = (m) => new Date(m).toISOString()
  const vals = {}
  const put = (id, v, q = "good", verifiedMs = ms) => {
    const old = prev?.[id]
    const changedAt =
      old && old.v === v ? old.changedAt : iso(Math.min(verifiedMs, ms))
    vals[id] = {
      v,
      q,
      changedAt: changedAt > iso(verifiedMs) ? iso(verifiedMs) : changedAt,
      verifiedAt: iso(verifiedMs)
    }
  }
  const r = s.ranch
  // 汇总值都从明细算，保证 rules.json 成立
  const sheepHead = s.herds
    .filter((h) => h.kind === "sheep")
    .reduce((a, h) => a + h.head, 0)
  const cattleHead = s.herds
    .filter((h) => h.kind === "cattle")
    .reduce((a, h) => a + h.head, 0)
  const su = s.units.reduce((a, u) => a + u.su, 0)
  const cap = +s.units.reduce((a, u) => a + u.capacity, 0).toFixed(1)
  put("RANCH.head", sheepHead + cattleHead)
  put("RANCH.sheepHead", sheepHead)
  put("RANCH.cattleHead", cattleHead)
  put("RANCH.su", su)
  put("RANCH.capacity", cap)
  put("RANCH.loadRatio", su / cap)
  put("RANCH.balance", r.balance)
  put("RANCH.ndvi", r.ndvi)

  // 每群在线项圈：头羊 3 个减去离线的；牛群 = 头数减去离线的
  const offline = new Set(s.collars.stale.map((c) => c.id))
  const herdOnline = {}
  for (const h of s.herds) {
    const ids =
      h.kind === "sheep"
        ? h.leads.map((c) => c.id)
        : Array.from({ length: h.head }, (_, i) => sim.collarId(h.id, i))
    herdOnline[h.id] = ids.filter((id) => !offline.has(id)).length
  }
  const online = Object.values(herdOnline).reduce((a, b) => a + b, 0)
  put("RANCH.collarsTotal", sim.totalCollars)
  put("RANCH.collarsOnline", online)
  put("RANCH.onlineRate", online / sim.totalCollars)
  const supplied = +s.water.reduce((a, w) => a + w.supplied, 0).toFixed(2)
  put("RANCH.alarmsActive", s.events.active.length)

  for (const u of s.units) {
    put(`${u.id}.su`, u.su)
    put(`${u.id}.capacity`, u.capacity)
    put(`${u.id}.balance`, u.balance)
    put(`${u.id}.grazing`, u.grazing)
  }
  for (const p of s.paddocks) {
    put(`${p.id}.status`, p.status)
    // NDVI 是月合成值，最后验证时间取当月合成里最后一景的日期（这里按当天 0 点记，足够早于快照）
    put(`${p.id}.ndvi`, p.ndvi)
    put(`${p.id}.forage`, p.forage)
    put(`${p.id}.restDays`, p.restDays)
  }
  for (const h of s.herds) {
    // 位置按项圈上报间隔验证：羊 10 分钟、牛 15 分钟一报
    const step = (h.kind === "sheep" ? 10 : 15) * 60000
    const ver = Math.floor(ms / step) * step
    put(`${h.id}.head`, h.head)
    put(`${h.id}.x`, h.pos[0], "good", ver)
    put(`${h.id}.y`, h.pos[1], "good", ver)
    put(`${h.id}.walkKm`, h.walkKm, "good", ver)
    put(`${h.id}.collarsOnline`, herdOnline[h.id])
    if (h.kind === "sheep")
      for (const c of h.leads) {
        const st = s.collars.stale.find((x) => x.id === c.id)
        // 离线项圈：最后一次上报在 2 小时以前，质量 bad
        if (st)
          put(`${c.id}.online`, "offline", "bad", ms - st.lastSeenSec * 1000)
        else put(`${c.id}.online`, "online", "good", ver)
      }
  }
  for (const w of s.water) {
    put(
      `${w.id}.level`,
      w.level,
      w.flowQuality === "uncertain" ? "uncertain" : "good"
    )
    put(`${w.id}.supplied`, w.supplied, w.flowQuality)
    put(`${w.id}.pump`, w.pump)
  }
  put("RANCH.supplied", supplied)
  return vals
}

function rules(s0) {
  const R = []
  const sheep = s0.herds
    .filter((h) => h.kind === "sheep")
    .map((h) => `${h.id}.head`)
  const cattle = s0.herds
    .filter((h) => h.kind === "cattle")
    .map((h) => `${h.id}.head`)
  R.push({ type: "sum", target: "RANCH.sheepHead", of: sheep })
  R.push({ type: "sum", target: "RANCH.cattleHead", of: cattle })
  R.push({
    type: "sum",
    target: "RANCH.head",
    of: ["RANCH.sheepHead", "RANCH.cattleHead"]
  })
  R.push({
    type: "sum",
    target: "RANCH.su",
    of: s0.units.map((u) => `${u.id}.su`)
  })
  R.push({
    type: "sum",
    target: "RANCH.capacity",
    of: s0.units.map((u) => `${u.id}.capacity`),
    tol: 1e-4
  })
  R.push({
    type: "ratio",
    target: "RANCH.loadRatio",
    num: "RANCH.su",
    den: "RANCH.capacity"
  })
  R.push({
    type: "sum",
    target: "RANCH.collarsOnline",
    of: s0.herds.map((h) => `${h.id}.collarsOnline`)
  })
  R.push({
    type: "ratio",
    target: "RANCH.onlineRate",
    num: "RANCH.collarsOnline",
    den: "RANCH.collarsTotal"
  })
  R.push({
    type: "sum",
    target: "RANCH.supplied",
    of: s0.water.map((w) => `${w.id}.supplied`),
    tol: 1e-3
  })
  // 项圈 2 小时没上报算过期；位置每 10–15 分钟验证一次，留余量取 1 小时
  R.push({ type: "stale", maxAgeSec: 3600 })
  return R
}

/** 找一个包含全部异常态的小时 */
function pickWindow() {
  for (let d = 23; d < 62; d++) {
    const date = new Date(Date.UTC(2026, 6, 1 + d)).toISOString().slice(0, 10)
    for (let h = 9; h < 17; h++) {
      const kinds = new Set()
      for (let m = 0; m <= 60; m += 5) {
        const s = sim.at(msForDemo(date, h + m / 60))
        for (const e of s.events.active) {
          if (e.kind === "offline" && /^CL-00(0\d|1\d|2[01])$/.test(e.target))
            kinds.add("leadOffline")
          else kinds.add(e.kind)
        }
        if (s.water.some((w) => w.flowQuality === "uncertain"))
          kinds.add("uncertain")
      }
      if (
        ["fence", "water", "leadOffline", "uncertain"].every((k) =>
          kinds.has(k)
        )
      )
        return { date, h }
    }
  }
  throw new Error("没找到同时包含全部异常态的时段")
}

const { date, h } = pickWindow()
const start = msForDemo(date, h)
const s0 = sim.at(start)
const points = definePoints(s0)
const snapshots = []
let prev = null
for (let k = 0; k <= 60; k++) {
  const ms = start + k * 60000
  const values = toValues(sim.at(ms), ms, prev)
  snapshots.push({ ms, values })
  prev = values
}
// 时间戳整体平移到大屏设定的北京时间（2026-07/08）：快照时间、changedAt、verifiedAt 加同样的偏移
const shift =
  Date.parse(`${date}T${String(h).padStart(2, "0")}:00:00+08:00`) - start
const moved = (iso) => new Date(Date.parse(iso) + shift).toISOString()
for (const snap of snapshots) {
  snap.t = new Date(snap.ms + shift).toISOString()
  delete snap.ms
  for (const [id, x] of Object.entries(snap.values))
    snap.values[id] = {
      ...x,
      changedAt: moved(x.changedAt),
      verifiedAt: moved(x.verifiedAt)
    }
}
for (const snap of snapshots) {
  const { t, values } = snap
  delete snap.values
  snap.t = t
  snap.values = values
}

// 记下这一小时里出现过的事件，写进 04-data-spec.md
const events = new Map()
for (let k = 0; k <= 60; k += 1)
  for (const e of sim.at(start + k * 60000).events.active) events.set(e.id, e)

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, "points.json"), JSON.stringify(points, null, 1))
writeFileSync(join(OUT, "snapshots.json"), JSON.stringify(snapshots))
writeFileSync(join(OUT, "rules.json"), JSON.stringify(rules(s0), null, 1))
writeFileSync(
  join(OUT, "window.json"),
  JSON.stringify(
    {
      date,
      from: `${String(h).padStart(2, "0")}:00`,
      to: `${String(h + 1).padStart(2, "0")}:00`,
      seed: "按日期字符串播种（simulator.js 的 rng）",
      events: [...events.values()].map((e) => ({
        id: e.id,
        kind: e.kind,
        title: e.title,
        level: e.level,
        target: e.target,
        herder: e.herder,
        from: hm(e.start),
        to: hm(e.end)
      }))
    },
    null,
    1
  )
)
console.log(
  `时段 ${date} ${h}:00–${h + 1}:00；测点 ${points.length} 个，快照 ${snapshots.length} 份；事件 ${events.size} 个`
)

function hm(hours) {
  const m = Math.round(hours * 60)
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

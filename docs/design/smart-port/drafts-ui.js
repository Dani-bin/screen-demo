/*
 * 智慧港口 设计稿：面板、标签、镜头（docs/design/smart-port/drafts-source.html 用）
 * ----------------------------------------------------------
 * 三套方向：
 *   a 海图·日间（全景型）：白色实底面板 + 墨线 + 海图图框刻度；左船舶、右设备
 *   b 夜班·钠灯冷白（设备重点型）：镜头压低拉近作业岸桥，右侧大表格是作业路协同（岸桥 → AGV → 箱区）
 *   c 晨雾·蓝灰 + 安全橙（流程型）：单船作业跟踪，橙色只给被跟踪的船和为它服务的设备，底部按流程串起来
 * 面板数字全部取自仿真状态 state（simulator.js 的 at()），汇总值也是从明细算出来的，不写死。
 */
import { QC_RECORD } from "/src/views/smart-port/sim/simulator.js"

/**
 * 每个方向的时刻与镜头。时刻取模拟数据快照那一小时（2026-10-24 16:00–17:00）里的 16:34：
 * QC13 岸桥故障刚报（待处置），AGV068 定位已中断 12 分钟（数据过期），两种异常态都能画出来。
 */
export const VIEWS = {
  a: {
    date: "2026-10-24",
    time: "16:34",
    camera: { target: [1330, 230], dist: 3050, yaw: -52, pitch: 38, fov: 30 }
  },
  // 夜班方向取当晚 23:04：Y55 海侧轨道吊故障（处置中）、AGV064 刚故障停车，3 条船 17 台岸桥在作业
  b: {
    date: "2026-10-25",
    time: "23:04",
    camera: { target: [1720, 230], dist: 1650, yaw: -40, pitch: 30, fov: 34 }
  },
  c: {
    date: "2026-10-24",
    time: "16:34",
    camera: { target: [1430, 60], dist: 1150, yaw: -58, pitch: 24, fov: 32 },
    track: "VLCS"
  },
  // 定稿 A 全息孪生：镜头取 07-camera.json 的拟合结果（scripts/smart-port/fit_camera.py）
  holo: {
    date: "2026-10-24",
    time: "16:34",
    camera: {
      target: [1143.3, 100.8],
      dist: 4213.7,
      yaw: -20.76,
      pitch: 54.28,
      fov: 17.66
    }
  }
}

const fmt = (n, d = 0) =>
  Number(n).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  })
const hm = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(11, 16)
const DIRS = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"]
const dirName = (deg) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
const STATE_CN = { work: "作业", idle: "待机", fault: "故障", maint: "检修" }
const EV_STATUS = { pending: "待处置", handling: "处置中", resolved: "已恢复" }
const LEVEL_CN = { major: "重要", minor: "一般" }
const STAGE_CN = {
  anchor: "锚地待泊",
  berthing: "靠泊中",
  moored: "系泊",
  working: "作业中",
  finishing: "完工绑扎",
  departing: "离泊",
  planned: "计划"
}

/** 主告警：最新一条未结束的重要告警（岸桥故障优先），附三维特效位置 fx 和告警卡锚点 anchor */
export function pickAlarm(state, layout) {
  const open = state.events.filter((e) => e.status !== "resolved")
  const e =
    open.find((x) => x.kind === "qcFault") ||
    open.find((x) => x.level === "major") ||
    open[0]
  if (!e) return null
  let fx = null
  let anchor = null
  const c = state.cranes.find((x) => x.id === e.target)
  if (c) {
    fx = {
      u: c.u,
      v: (layout.qcRail.sea + layout.qcRail.land) / 2,
      r: 34,
      h: 130
    }
    anchor = { u: c.u, v: 21, y: 92 }
  }
  // 轨道吊故障：特效放在箱区海侧端（海侧吊作业的位置）
  const rm = /^(Y\d+)-([SL])$/.exec(e.target || "")
  if (rm) {
    const b = layout.blocks.find((x) => x.id === rm[1])
    const v = rm[2] === "S" ? b.v0 + 30 : b.v1 - 20
    fx = { u: b.u, v, r: 30, h: 110 }
    anchor = { u: b.u, v, y: 40 }
  }
  return { event: e, fx, anchor }
}

/** 今日逐小时作业量（自然箱）：用仿真器在每个整点取今日累计再差分 */
function hourly(sim, ms) {
  const s = sim.at(ms)
  const d0 = s.clock.dayStart
  const H = Math.floor((ms - d0) / 3600000)
  const cum = [0]
  for (let h = 1; h <= H; h++) cum.push(sim.at(d0 + h * 3600000).kpi.movesToday)
  cum.push(s.kpi.movesToday)
  return cum.slice(1).map((x, i) => x - cum[i])
}

const atQuay = (v) => ["moored", "working", "finishing"].includes(v.stage)

/* ---------------- 共用小组件 ---------------- */

function kpiStrip(state) {
  const k = state.kpi
  const items = [
    ["今日吞吐量", fmt(k.teuToday), "TEU"],
    ["今日作业量", fmt(k.movesToday), "自然箱"],
    ["在泊作业船", k.vesselsAtBerth, "艘"],
    ["平均船时效率", fmt(k.vesselRate, 1), "自然箱/h"],
    [
      "岸桥平均台时量",
      fmt(k.qcTph, 1),
      "自然箱/h",
      `单机纪录 ${QC_RECORD.single}`
    ],
    ["未结束告警", k.alarmsActive, "条", null, k.alarmsActive > 0]
  ]
  return `<div class="kpis">${items
    .map(
      ([name, v, unit, note, warn]) => `<div class="kpi ${warn ? "warn" : ""}">
        <div class="kpi-name">${name}</div>
        <div class="kpi-val"><b>${v}</b><i>${unit}</i></div>
        ${note ? `<div class="kpi-note">${note}</div>` : ""}
      </div>`
    )
    .join("")}</div>`
}

function header(state, title, sub) {
  const m = state.met
  return `<header class="hd">
    <div class="hd-title"><h1>${title}</h1><p>${sub}</p></div>
    <div class="hd-right">
      <div class="hd-met"><span>风速</span><b>${fmt(m.wind, 1)}</b><i>m/s</i><em>${dirName(m.dir)}风 · 阵风 ${fmt(m.gust, 1)}</em></div>
      <div class="hd-met"><span>潮位</span><b>${fmt(m.tide, 2)}</b><i>m</i></div>
      <div class="hd-clock"><b>${state.clock.hm}</b><span>${state.clock.date} ${state.clock.week}</span></div>
    </div>
  </header>`
}

/** 在泊船舶：每船一行，卸 / 装两段进度条（船形图标走在进度条上） */
function vesselList(state, { compact = false, track } = {}) {
  const vs = state.vessels.filter(
    (v) => atQuay(v) || v.stage === "berthing" || v.stage === "anchor"
  )
  return vs
    .map((v) => {
      const disP = v.dis ? v.disDone / v.dis : 1
      const loadP = v.load ? v.loadDone / v.load : 1
      const all = v.done / v.moves
      const cranes = v.lines
        .filter((l) => l.working)
        .map((l) => l.crane)
        .filter(Boolean)
      const late = v.delayMin >= 30
      const etd = v.depart
      return `<div class="vs ${track === v.id ? "tracked" : ""} ${late ? "late" : ""}">
        <div class="vs-head">
          <div class="vs-name"><b>${v.name}</b><span>${v.voyage}</span><em class="cls">${v.clsName}</em></div>
          <div class="vs-berth">${v.berths.join(" · ")}</div>
        </div>
        <div class="vs-bars">
          <div class="bar dis"><label>卸</label><div class="track"><s style="width:${disP * 100}%"></s></div><span>${fmt(v.disDone)}/${fmt(v.dis)}</span></div>
          <div class="bar load"><label>装</label><div class="track"><s style="width:${loadP * 100}%"></s></div><span>${fmt(v.loadDone)}/${fmt(v.load)}</span></div>
        </div>
        ${
          compact
            ? ""
            : `<div class="vs-foot">
          <span>${STAGE_CN[v.stage]} · ${Math.round(all * 100)}%</span>
          <span>船时 <b>${v.rate ? fmt(v.rate, 0) : "—"}</b></span>
          <span>岸桥 <b>${cranes.length}</b></span>
          <span class="${late ? "bad" : ""}">离泊 ${hm(etd)}${late ? ` · 晚 ${v.delayMin}′` : ""}</span>
        </div>`
        }
      </div>`
    })
    .join("")
}

/** 靠离泊计划甘特：横轴时间（前 6 h → 后 18 h），纵轴岸线位置（B01 在上） */
function berthGantt(sim, state, layout, w = 380, h = 190) {
  const now = state.t
  const t0 = now - 6 * 3600000
  const t1 = now + 18 * 3600000
  const list = sim.schedule(t0, t1)
  const q1 = layout.quay.u1
  const X = (t) => ((t - t0) / (t1 - t0)) * (w - 34) + 30
  const Y = (u) => (u / q1) * (h - 22) + 4
  let svg = `<svg class="gantt" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
  for (const b of layout.berths) {
    svg += `<line x1="30" x2="${w - 4}" y1="${Y(b.u0)}" y2="${Y(b.u0)}" class="g-grid"/>`
    svg += `<text x="2" y="${Y((b.u0 + b.u1) / 2) + 4}" class="g-axis">${b.id}</text>`
  }
  for (let k = -6; k <= 18; k += 6) {
    const x = X(now + k * 3600000)
    svg += `<text x="${x}" y="${h - 4}" class="g-axis" text-anchor="middle">${hm(now + k * 3600000)}</text>`
  }
  for (const c of list) {
    const a = X(Math.max(t0, c.tb))
    const b = X(Math.min(t1, c.depart))
    const plan = X(Math.min(t1, c.planEnd))
    const y0 = Y(c.u0)
    const y1 = Y(c.u1)
    const cls = c.depart < now ? "done" : c.tb <= now ? "now" : "plan"
    svg += `<rect x="${a}" y="${y0 + 1}" width="${Math.max(2, Math.min(plan, b) - a)}" height="${y1 - y0 - 2}" rx="2" class="g-${cls}"/>`
    if (c.delayMin >= 30 && b > plan)
      svg += `<rect x="${plan}" y="${y0 + 1}" width="${b - plan}" height="${y1 - y0 - 2}" class="g-late"/>`
    if (b - a > 54)
      svg += `<text x="${a + 4}" y="${(y0 + y1) / 2 + 4}" class="g-label">${c.name}</text>`
  }
  svg += `<line x1="${X(now)}" x2="${X(now)}" y1="0" y2="${h - 16}" class="g-now"/></svg>`
  return svg
}

/** 今日逐小时作业量柱状图 */
function hourlyBars(hours, w = 380, h = 120) {
  const max = Math.max(...hours, 1)
  const bw = (w - 30) / 24
  let svg = `<svg class="bars" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
  for (let i = 0; i < 24; i++) {
    const v = hours[i]
    const x = 26 + i * bw
    if (v !== undefined) {
      const bh = (v / max) * (h - 26)
      svg += `<rect x="${x + 1}" y="${h - 16 - bh}" width="${bw - 2}" height="${bh}" class="${i === hours.length - 1 ? "b-now" : "b-bar"}"/>`
    } else
      svg += `<rect x="${x + 1}" y="${h - 18}" width="${bw - 2}" height="2" class="b-empty"/>`
    if (i % 6 === 0)
      svg += `<text x="${x}" y="${h - 3}" class="g-axis">${String(i).padStart(2, "0")}</text>`
  }
  svg += `<text x="0" y="12" class="g-axis">${fmt(max)}</text></svg>`
  return svg
}

/** 设备运行状态：岸桥 / 轨道吊 / AGV 分段条 */
function equipStatus(state) {
  const k = state.kpi
  const rows = [
    [
      "岸桥",
      k.qc.total,
      [
        ["作业", k.qc.work, "work"],
        ["待机", k.qc.idle, "idle"],
        ["故障", k.qc.fault, "fault"],
        ["检修", k.qc.maint, "maint"]
      ]
    ],
    [
      "轨道吊",
      k.rmg.total,
      [
        ["作业", k.rmg.work, "work"],
        ["待机", k.rmg.idle, "idle"],
        ["故障", k.rmg.fault, "fault"]
      ]
    ],
    [
      "AGV",
      k.agv.total,
      [
        ["重载", k.agv.laden, "work"],
        ["空驶", k.agv.empty, "work2"],
        ["排队", k.agv.queue, "queue"],
        ["空闲", k.agv.idle, "idle"],
        ["换电", k.agv.swap, "swap"],
        ["故障", k.agv.fault, "fault"]
      ]
    ]
  ]
  return rows
    .map(
      ([name, total, parts]) => `<div class="eq">
      <div class="eq-head"><b>${name}</b><span>${total} 台</span></div>
      <div class="seg">${parts.map(([, n, c]) => (n ? `<i class="s-${c}" style="flex:${n}"></i>` : "")).join("")}</div>
      <div class="eq-legend">${parts.map(([l, n, c]) => `<span><i class="s-${c}"></i>${l} <b>${n}</b></span>`).join("")}</div>
    </div>`
    )
    .join("")
}

/** 作业路协同：每台在作业 / 故障的岸桥一行；最慢的一路标出原因 */
function lines(state, { limit = 12, track } = {}) {
  const vById = new Map(state.vessels.map((v) => [v.id, v]))
  const agvBy = new Map()
  for (const a of state.agvs)
    if (a.crane) agvBy.set(a.crane, (agvBy.get(a.crane) || 0) + 1)
  const rmgFault = new Set(
    state.blocks.flatMap((b) =>
      b.rmg.filter((r) => r.state === "fault").map((r) => r.id)
    )
  )
  const rows = state.cranes.filter(
    (c) => c.state === "work" || c.state === "fault"
  )
  const max = 45
  return `<table class="lines"><thead><tr><th>岸桥</th><th>船舶</th><th>当前效率</th><th>剩余</th><th>AGV</th><th>箱区</th></tr></thead><tbody>${rows
    .slice(0, limit)
    .map((c) => {
      const v = vById.get(c.vessel)
      const why =
        c.state === "fault"
          ? "岸桥故障"
          : rmgFault.has(`${c.target}-S`)
            ? "轨道吊故障"
            : c.rate < 31
              ? "效率偏低"
              : ""
      return `<tr class="${c.state} ${track && c.vessel === track ? "tracked" : ""}">
        <td><b>${c.id}</b></td>
        <td>${v ? v.name : "—"}</td>
        <td><div class="rate"><s style="width:${Math.min(1, c.rate / max) * 100}%"></s><span>${c.state === "fault" ? "停机" : fmt(c.rate, 0)}</span></div></td>
        <td>${fmt(c.remain)}</td>
        <td>${agvBy.get(c.id) || 0}</td>
        <td>${c.target || "—"}${why ? `<em>${why}</em>` : ""}</td>
      </tr>`
    })
    .join("")}</tbody></table>`
}

/** AGV 电量分布（25% 换电线）+ 换电站 */
function agvPanel(state) {
  const bins = new Array(10).fill(0)
  for (const a of state.agvs) bins[Math.min(9, Math.floor(a.soc / 10))]++
  const max = Math.max(...bins, 1)
  const w = 380
  const h = 96
  const bw = (w - 20) / 10
  let svg = `<svg class="soc" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
  bins.forEach((n, i) => {
    const bh = (n / max) * (h - 30)
    svg += `<rect x="${10 + i * bw + 2}" y="${h - 18 - bh}" width="${bw - 4}" height="${bh}" class="${i < 3 ? "soc-low" : "soc-bar"}"/>`
    svg += `<text x="${10 + i * bw + bw / 2}" y="${h - 4}" class="g-axis" text-anchor="middle">${i * 10}</text>`
    if (n)
      svg += `<text x="${10 + i * bw + bw / 2}" y="${h - 22 - bh}" class="g-val" text-anchor="middle">${n}</text>`
  })
  svg += `<line x1="${10 + 2.5 * bw}" x2="${10 + 2.5 * bw}" y1="6" y2="${h - 16}" class="g-now"/><text x="${10 + 2.5 * bw + 4}" y="14" class="g-axis">换电线 25%</text></svg>`
  const st = state.swaps
    .map(
      (s) =>
        `<div class="swap"><b>${s.id}</b><span>换电中 <i>${s.swapping}</i></span><span>往返 <i>${s.queue}</i></span><span>满电 <i>${s.full}</i></span><span>今日 <i>${s.swapsToday}</i> 次</span></div>`
    )
    .join("")
  return svg + st
}

/** 告警与事件列表 */
function events(state, limit = 6) {
  return `<div class="evs">${state.events
    .slice(0, limit)
    .map(
      (e) => `<div class="ev ${e.level} ${e.status}">
        <i class="dot"></i>
        <div class="ev-main"><b>${e.title}</b><span>${e.target} · ${e.desc}</span></div>
        <div class="ev-side"><em>${EV_STATUS[e.status]}</em><span>${hm(e.at)}</span></div>
      </div>`
    )
    .join("")}</div>`
}

const panel = (title, body, extra = "") =>
  `<section class="pn ${extra}"><h3><span>${title}</span></h3><div class="pn-body">${body}</div></section>`

/* ---------------- 三套方向 ---------------- */

export function buildUi(dir, state, layout, alarm, sim, ms, track) {
  const hours = hourly(sim, ms)
  const sub = "上海洋山深水港 · 四期全自动化集装箱码头"
  if (dir === "a") {
    return `${header(state, "洋山四期 · 智慧港口生产指挥", sub)}
      ${kpiStrip(state)}
      <aside class="side left">
        ${panel("在泊船舶", vesselList(state))}
        ${panel("靠离泊计划 · 24 h", berthGantt(sim, state, layout))}
        ${panel("今日作业量 · 逐小时", hourlyBars(hours))}
      </aside>
      <aside class="side right">
        ${panel("设备运行", equipStatus(state))}
        ${panel("作业路协同", lines(state, { limit: 8 }))}
        ${panel("告警与事件", events(state, 5))}
      </aside>
      ${legend()}
      <div class="frame-ticks"></div>`
  }
  if (dir === "b") {
    return `${header(state, "洋山四期 · 夜班生产调度", sub)}
      ${kpiStrip(state)}
      <aside class="side left narrow">
        ${panel("在泊船舶", vesselList(state, { compact: true }))}
        ${panel("今日作业量", hourlyBars(hours, 340, 110))}
        ${panel("告警与事件", events(state, 4))}
      </aside>
      <aside class="side right wide">
        ${panel("作业路协同 · 岸桥 → AGV → 箱区", lines(state, { limit: 12 }))}
        ${panel("设备运行", equipStatus(state))}
        ${panel("AGV 电量与换电", agvPanel(state))}
      </aside>
      ${legend()}`
  }
  // c：单船作业跟踪
  const v =
    state.vessels.find((x) => x.id === track) || state.vessels.find(atQuay)
  return `${header(state, "洋山四期 · 单船作业跟踪", sub)}
    ${kpiStrip(state)}
    <aside class="side left">
      ${panel(`跟踪船舶 · ${v.name}`, trackedShip(v, state))}
      ${panel("在泊船舶", vesselList(state, { compact: true, track: v.id }))}
    </aside>
    <aside class="side right">
      ${panel("为它服务的作业路", lines(state, { limit: 8, track: v.id }))}
      ${panel("告警与事件", events(state, 4))}
      ${panel("靠离泊计划 · 24 h", berthGantt(sim, state, layout, 380, 150))}
    </aside>
    ${flowStrip(v, state)}
    <button class="exit-track">退出跟踪</button>`
}

/** 跟踪船舶详情：进度环 + 逐路（贝段）完成情况 */
function trackedShip(v, state) {
  const p = v.done / v.moves
  const r = 46
  const C = 2 * Math.PI * r
  const ring = `<svg width="120" height="120" viewBox="0 0 120 120" class="ring"><circle cx="60" cy="60" r="${r}" class="ring-bg"/><circle cx="60" cy="60" r="${r}" class="ring-fg" stroke-dasharray="${C * p} ${C}" transform="rotate(-90 60 60)"/><text x="60" y="58" text-anchor="middle" class="ring-val">${Math.round(p * 100)}%</text><text x="60" y="78" text-anchor="middle" class="ring-sub">已完成</text></svg>`
  const info = `<div class="ts-info">
    <div><span>船型</span><b>${v.clsName} · ${fmt(v.teuClass)} TEU 级</b></div>
    <div><span>航线</span><b>${v.route}</b></div>
    <div><span>泊位</span><b>${v.berths.join(" · ")}</b></div>
    <div><span>靠泊</span><b>${hm(v.tb)}</b><span>计划离泊</span><b>${hm(v.planEnd)}</b></div>
    <div><span>船时效率</span><b>${fmt(v.rate, 0)} 自然箱/h</b></div>
  </div>`
  const bays = v.lines
    .map((l, i) => {
      const f = l.total ? l.done / l.total : 0
      return `<div class="bay ${l.working ? "on" : ""}"><span>第 ${i + 1} 路 · ${l.crane || "—"}</span><div class="track"><s style="width:${f * 100}%"></s></div><b>${fmt(l.done)}/${fmt(l.total)}</b></div>`
    })
    .join("")
  return `<div class="ts">${ring}${info}</div><div class="ts-sub">按作业路（贝段）· 先卸后装</div>${bays}`
}

/** 底部流程条：船 → 岸桥 → AGV → 箱区（数字都是被跟踪船的） */
function flowStrip(v, state) {
  const cranes = v.lines
    .filter((l) => l.working)
    .map((l) => l.crane)
    .filter(Boolean)
  const agvs = state.agvs.filter((a) => a.vessel === v.id)
  const blocks = [
    ...new Set(
      state.cranes.filter((c) => cranes.includes(c.id)).map((c) => c.target)
    )
  ]
  const laden = agvs.filter((a) => a.state === "laden").length
  const steps = [
    [
      "船舶",
      v.name,
      `卸 ${fmt(v.disDone)}/${fmt(v.dis)} · 装 ${fmt(v.loadDone)}/${fmt(v.load)}`
    ],
    ["岸桥", `${cranes.length} 台`, cranes.join(" ")],
    ["AGV", `${agvs.length} 台`, `重载 ${laden} · 空驶 ${agvs.length - laden}`],
    ["箱区", `${blocks.length} 个`, blocks.join(" ")]
  ]
  return `<div class="flow">${steps
    .map(
      ([k, v1, sub], i) =>
        `${i ? '<i class="arrow"></i>' : ""}<div class="step"><span>${k}</span><b>${v1}</b><em>${sub}</em></div>`
    )
    .join("")}</div>`
}

function legend() {
  return `<div class="legend">
    <span><i class="s-work"></i>作业</span><span><i class="s-idle"></i>待机</span><span><i class="s-fault"></i>故障</span>
    <span><i class="s-maint"></i>检修</span><span><i class="s-swap"></i>换电</span><span><i class="s-stale"></i>数据过期</span>
    <div class="tabs"><b>总览</b><span>船舶作业</span><span>设备协同</span></div>
  </div>`
}

/* ---------------- 三维标签 ---------------- */

/** 泊位号、船名牌、岸桥编号、主告警卡、定位中断的 AGV */
export function placeLabels(el, scene, state, layout, alarm, dir, track) {
  const out = []
  const TOP = 6.9
  const at = (u, v, y, html, cls = "") => {
    const p = scene.project(u, v, y)
    if (!p || p.x < 0 || p.x > 1920 || p.y < 0 || p.y > 1080) return
    out.push(
      `<div class="lb ${cls}" style="left:${p.x.toFixed(1)}px;top:${p.y.toFixed(1)}px">${html}</div>`
    )
  }
  for (const b of layout.berths)
    at((b.u0 + b.u1) / 2, -2, TOP, `<b>${b.id}</b>`, "berth")
  for (const v of state.vessels) {
    if (!["moored", "working", "finishing", "berthing"].includes(v.stage))
      continue
    const p = v.done / v.moves
    at(
      (v.u0 + v.u1) / 2,
      -(v.beam + 8),
      34,
      `<b>${v.name}</b><span>${v.clsName} · ${Math.round(p * 100)}%</span><i style="width:${p * 100}%"></i>`,
      `ship ${track === v.id ? "tracked" : ""}`
    )
  }
  if (dir !== "a")
    for (const c of state.cranes)
      if (
        c.state === "work" &&
        (dir === "b" ||
          state.vessels.find((v) => v.id === c.vessel)?.id === track)
      )
        at(c.u, 21, 92, `${c.id}<span>${Math.round(c.rate)}</span>`, "crane")
  if (alarm?.anchor) {
    // 告警卡：锚在设备顶上；超出两侧栏之间的区域时水平推回来，并画一条引线连回设备
    const e = alarm.event
    const p = scene.project(alarm.anchor.u, alarm.anchor.v, alarm.anchor.y)
    if (p) {
      const SIDE = { a: [434, 1486], b: [396, 1426], c: [434, 1486] }[dir]
      const half = 140
      const x = Math.min(
        SIDE[1] - half - 16,
        Math.max(SIDE[0] + half + 16, p.x)
      )
      const y = Math.max(200, p.y - 60)
      out.push(
        `<svg class="lead" width="1920" height="1080"><line x1="${p.x}" y1="${p.y}" x2="${x}" y2="${y}"/><circle cx="${p.x}" cy="${p.y}" r="4"/></svg>`
      )
      out.push(
        `<div class="lb alarm" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px"><div class="al-card"><em>${LEVEL_CN[e.level]}</em><b>${e.title}</b><span>${e.target} · ${e.desc}</span><span>${hm(e.at)} · ${EV_STATUS[e.status]} · ${e.team}</span></div></div>`
      )
    }
  }
  // 定位中断的 AGV：停在最后已知位置，标"定位中断 xx 分钟"
  for (const a of state.agvs.filter((x) => x.signalLost)) {
    const e = state.events.find(
      (x) => x.kind === "agvSignal" && x.target === a.id
    )
    const pose = scene.lastPoses?.find((p) => p.id === a.id)
    if (pose)
      at(
        pose.u,
        pose.v,
        10,
        `<b>${a.id}</b><span>定位中断 ${Math.round((state.t - e.at) / 60000)} 分钟</span>`,
        "stale"
      )
  }
  el.innerHTML = out.join("")
}

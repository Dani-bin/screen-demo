/*
 * 智慧港口 设计稿 v1（A 全息孪生 · 深海科技蓝）：整屏面板
 * ----------------------------------------------------------
 * 中央是 Figma 生成的概念图（concept.png，只定风格与氛围，布局以真实码头为准，见 README 冲突清单）；
 * 面板数字全部来自仿真器 simulator.js 在 2026-10-24 16:34 的状态（模拟数据快照那一小时），汇总值从明细算。
 * 图表按 dataviz 的规则：单系列一种颜色、状态色只表示状态并配文字、不用双轴、刻度和网格退后。
 */
import {
  createPortSim,
  msForBeijing,
  QC_RECORD,
  SHIP_CLASSES
} from "/src/views/smart-port/sim/simulator.js"
import layout from "/src/views/smart-port/data/layout.json"
import site from "/src/views/smart-port/data/site.json"

const H = 3600000
const D = 24 * H
const fmt = (n, d = 0) =>
  Number(n).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  })
const hm = (ms) => new Date(ms + 8 * H).toISOString().slice(11, 16)
const pct = (x) => `${Math.round(x * 100)}%`
const DIRS = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"]
const dirName = (deg) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
const EV_STATUS = { pending: "待处置", handling: "处置中", resolved: "已恢复" }
const KIND_CN = {
  qcFault: "岸桥故障",
  rmgFault: "轨道吊故障",
  agvFault: "AGV 故障",
  agvSignal: "定位中断",
  reefer: "冷箱温度",
  wind: "阵风",
  dg: "危险品",
  sensor: "传感器",
  delay: "船舶延误"
}
const STAGE_CN = {
  anchor: "锚地待泊",
  berthing: "靠泊中",
  moored: "系泊",
  working: "作业中",
  finishing: "完工绑扎",
  departing: "离泊"
}

/* ---------------- 小图标（SVG，细线） ---------------- */
const ICON = {
  ship: '<svg viewBox="0 0 24 24"><path d="M3 15h18l-2.5 4h-13zM6 15V9h12v6M9 9V5h4v4" /></svg>',
  crane:
    '<svg viewBox="0 0 24 24"><path d="M5 21V8M10 21V8M3 8h19M5 8l5-5 9 5M18 8v5M16 13h4" /></svg>',
  agv: '<svg viewBox="0 0 24 24"><rect x="3" y="10" width="18" height="6" /><path d="M7 16v2M17 16v2M6 10V7h12v3" /></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M13 3L5 13h6l-1 8 8-10h-6z" /></svg>',
  alert:
    '<svg viewBox="0 0 24 24"><path d="M12 3l10 18H2zM12 10v5M12 18v.5" /></svg>',
  wind: '<svg viewBox="0 0 24 24"><path d="M3 9h12a3 3 0 1 0-3-3M3 15h16a3 3 0 1 1-3 3" /></svg>',
  tide: '<svg viewBox="0 0 24 24"><path d="M2 14c3 0 3-2 6-2s3 2 6 2 3-2 6-2M2 19c3 0 3-2 6-2s3 2 6 2 3-2 6-2M12 3v6" /></svg>',
  search:
    '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l6 6" /></svg>',
  layers:
    '<svg viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" /></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="2.5" /></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z" /></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.5-7-12a7 7 0 1 1 14 0c0 5.5-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></svg>'
}

/* ---------------- 数据准备 ---------------- */

export function prepare() {
  const sim = createPortSim(layout)
  const ms = msForBeijing("2026-10-24", 16 + 34 / 60)
  const state = sim.at(ms)
  const yday = sim.at(ms - D)
  const d0 = state.clock.dayStart
  // 今日逐小时作业量：整点累计差分
  const cum = [0]
  for (let h = 1; h <= Math.floor((ms - d0) / H); h++)
    cum.push(sim.at(d0 + h * H).kpi.movesToday)
  cum.push(state.kpi.movesToday)
  const hourly = cum.slice(1).map((x, i) => x - cum[i])
  // 吞吐量走势（每小时累计 TEU）做指标卡的迷你线
  const teuCum = []
  for (let h = 1; h <= Math.floor((ms - d0) / H); h++)
    teuCum.push(sim.at(d0 + h * H).kpi.teuToday)
  teuCum.push(state.kpi.teuToday)
  // 本周航次（周一 00:00 起）按船型
  const dow = (new Date(d0 + 8 * H).getUTCDay() + 6) % 7
  const w0 = d0 - dow * D
  const week = sim
    .schedule(w0, w0 + 7 * D)
    .filter((c) => c.planStart >= w0 && c.planStart < w0 + 7 * D)
  const byClass = Object.keys(SHIP_CLASSES).map((k) => ({
    k,
    name: SHIP_CLASSES[k].name,
    n: week.filter((c) => c.cls === k).length
  }))
  const schedule = sim.schedule(ms - 6 * H, ms + 18 * H)
  return { sim, ms, state, yday, hourly, teuCum, byClass, week, schedule }
}

/* ---------------- 组件 ---------------- */

/** 面板：双层边框（外壳 + 内芯）+ 切角 + 角标；标题带英文副标 */
const panel = (title, en, body, { extra = "", tools = "" } = {}) => `
  <section class="pn ${extra}">
    <header class="pn-h"><i class="pn-mark"></i><h3>${title}</h3><span class="pn-en">${en}</span>${tools}</header>
    <div class="pn-b">${body}</div>
    <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
  </section>`

/** 迷你折线（单系列，主色细线 + 末端点） */
function spark(vals, w = 120, h = 30) {
  if (vals.length < 2) return ""
  const max = Math.max(...vals)
  const min = Math.min(...vals)
  const X = (i) => (i / (vals.length - 1)) * (w - 4) + 2
  const Y = (v) => h - 3 - ((v - min) / (max - min || 1)) * (h - 6)
  const pts = vals
    .map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`)
    .join(" ")
  const last = vals.length - 1
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <polyline points="${pts}" /><polygon points="2,${h} ${pts} ${X(last)},${h}" class="spark-fill"/>
    <circle cx="${X(last)}" cy="${Y(vals[last])}" r="3" /></svg>`
}

function header(d) {
  const m = d.state.met
  const nav = ["综合态势", "船舶作业", "设备协同", "堆场闸口", "安全告警"]
  return `<header class="hd">
    <div class="hd-l">
      <div class="logo"><svg viewBox="0 0 40 40"><path d="M6 28h28l-4 6H10zM10 28V16h20v12M16 16V8h8v8" /></svg></div>
      <div class="hd-title">
        <h1>洋山四期 · 智慧港口数字孪生</h1>
        <p>YANGSHAN PHASE IV · AUTOMATED CONTAINER TERMINAL · DIGITAL TWIN</p>
      </div>
    </div>
    <nav class="hd-nav">${nav.map((n, i) => `<a class="${i === 0 ? "on" : ""}">${n}</a>`).join("")}</nav>
    <div class="hd-r">
      <label class="search">${ICON.search}<span>搜索船名 / 设备编号 / 箱号</span></label>
      <div class="hd-met">${ICON.wind}<b>${fmt(m.wind, 1)}</b><i>m/s</i><em>${dirName(m.dir)}风 · 阵风 ${fmt(m.gust, 1)}</em></div>
      <div class="hd-met">${ICON.tide}<b>${fmt(m.tide, 2)}</b><i>m</i><em>潮位</em></div>
      <div class="hd-clock"><b>${d.state.clock.hms}</b><span>${d.state.clock.date} ${d.state.clock.week}</span></div>
      <div class="hd-user">${ICON.user}</div>
    </div>
  </header>`
}

/** 顶部指标条：数值 + 较昨日同时刻 + 迷你走势 */
function kpis(d) {
  const k = d.state.kpi
  const y = d.yday.kpi
  const delta = (a, b) => {
    const r = b ? (a - b) / b : 0
    return `<span class="dl ${r >= 0 ? "up" : "dn"}">${r >= 0 ? "▲" : "▼"} ${Math.abs(r * 100).toFixed(1)}%</span>`
  }
  const items = [
    {
      name: "今日吞吐量",
      v: fmt(k.teuToday),
      u: "TEU",
      note: `较昨日同时刻 ${delta(k.teuToday, y.teuToday)}`,
      spark: d.teuCum
    },
    {
      name: "今日作业量",
      v: fmt(k.movesToday),
      u: "自然箱",
      note: `较昨日同时刻 ${delta(k.movesToday, y.movesToday)}`,
      spark: d.hourly
    },
    {
      name: "在泊作业船",
      v: k.vesselsAtBerth,
      u: "艘",
      note: `锚地待泊 ${k.vesselsAnchor} 艘 · 泊位 7 个`
    },
    {
      name: "平均船时效率",
      v: fmt(k.vesselRate, 1),
      u: "自然箱/h",
      note: `在泊船舶按作业小时加权`
    },
    {
      name: "岸桥平均台时量",
      v: fmt(k.qcTph, 1),
      u: "自然箱/h",
      note: `单机纪录 ${QC_RECORD.single}（${QC_RECORD.year} 年）`
    },
    {
      name: "未结束告警",
      v: k.alarmsActive,
      u: "条",
      note: `今日累计 ${d.state.events.filter((e) => e.at >= d.state.clock.dayStart).length} 条`,
      warn: true
    }
  ]
  return `<div class="kpis">${items
    .map(
      (it) => `<div class="kpi ${it.warn && it.v > 0 ? "warn" : ""}">
        <div class="kpi-name">${it.name}</div>
        <div class="kpi-row"><b>${it.v}</b><i>${it.u}</i>${it.spark ? spark(it.spark) : ""}</div>
        <div class="kpi-note">${it.note}</div>
      </div>`
    )
    .join("")}</div>`
}

/** 在泊船舶：卸 / 装两段进度，船形游标，计划离泊 */
function vessels(d) {
  const vs = d.state.vessels.filter((v) =>
    ["moored", "working", "finishing", "berthing", "anchor"].includes(v.stage)
  )
  return vs
    .map((v) => {
      const dp = v.dis ? v.disDone / v.dis : 1
      const lp = v.load ? v.loadDone / v.load : 1
      const cranes = v.lines.filter((l) => l.working).length
      return `<div class="vs ${v.delayMin >= 30 ? "late" : ""}">
        <div class="vs-h">${ICON.ship}<b>${v.name}</b><span class="code">${v.voyage}</span><em class="tag">${v.clsName}</em>
          <span class="vs-b">${v.berths.join("·")}</span></div>
        <div class="vs-bar"><label>卸</label><div class="tr"><s style="width:${dp * 100}%"></s><i style="left:${dp * 100}%"></i></div><span>${fmt(v.disDone)}<small>/${fmt(v.dis)}</small></span></div>
        <div class="vs-bar load"><label>装</label><div class="tr"><s style="width:${lp * 100}%"></s><i style="left:${lp * 100}%"></i></div><span>${fmt(v.loadDone)}<small>/${fmt(v.load)}</small></span></div>
        <div class="vs-f"><span>${STAGE_CN[v.stage]} <b>${pct(v.done / v.moves)}</b></span><span>船时 <b>${v.rate ? fmt(v.rate) : "—"}</b></span><span>岸桥 <b>${cranes}</b></span><span>离泊 <b>${hm(v.depart)}</b></span></div>
      </div>`
    })
    .join("")
}

/** 靠离泊甘特：横轴前 6 h → 后 18 h，纵轴岸线（B01 在上） */
function gantt(d, w = 412, h = 112) {
  const now = d.ms
  const t0 = now - 6 * H
  const t1 = now + 18 * H
  const q1 = layout.quay.u1
  const X = (t) => 30 + ((t - t0) / (t1 - t0)) * (w - 36)
  const Y = (u) => 4 + (u / q1) * (h - 22)
  let s = `<svg class="gantt" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
  for (const b of layout.berths) {
    s += `<line x1="30" x2="${w - 4}" y1="${Y(b.u0)}" y2="${Y(b.u0)}" class="grid"/><text x="2" y="${Y((b.u0 + b.u1) / 2) + 4}" class="ax">${b.id}</text>`
  }
  for (let k = -6; k <= 18; k += 6)
    s += `<text x="${X(now + k * H)}" y="${h - 3}" class="ax" text-anchor="middle">${hm(now + k * H)}</text>`
  for (const c of d.schedule) {
    const a = X(Math.max(t0, c.tb))
    const b = X(Math.min(t1, c.depart))
    const p = X(Math.min(t1, c.planEnd))
    const y0 = Y(c.u0) + 1.5
    const y1 = Y(c.u1) - 1.5
    const cls = c.depart < now ? "g-done" : c.tb <= now ? "g-now" : "g-plan"
    s += `<rect x="${a}" y="${y0}" width="${Math.max(3, Math.min(b, p) - a)}" height="${y1 - y0}" class="${cls}"/>`
    if (c.delayMin >= 30)
      s += `<rect x="${p}" y="${y0}" width="${Math.max(2, b - p)}" height="${y1 - y0}" class="g-late"/>`
    if (b - a > 60)
      s += `<text x="${a + 5}" y="${(y0 + y1) / 2 + 4}" class="g-lb">${c.name}</text>`
  }
  s += `<line x1="${X(now)}" x2="${X(now)}" y1="0" y2="${h - 15}" class="g-cur"/><text x="${X(now) + 4}" y="10" class="g-curt">现在</text></svg>`
  return (
    s +
    `<div class="lg"><span><i class="sw g-now"></i>作业中</span><span><i class="sw g-plan"></i>计划</span><span><i class="sw g-done"></i>已离泊</span><span><i class="sw g-late"></i>延误</span></div>`
  )
}

/** 今日 24 h 作业量柱（单系列；当前小时用强调色） */
function hourlyBars(d, w = 412, h = 80) {
  const vals = d.hourly
  const max = Math.max(...vals, 1)
  const bw = (w - 30) / 24
  let s = `<svg class="bars" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
  for (const f of [0.5, 1])
    s += `<line x1="26" x2="${w}" y1="${h - 16 - f * (h - 30)}" y2="${h - 16 - f * (h - 30)}" class="grid"/><text x="0" y="${h - 12 - f * (h - 30)}" class="ax">${fmt(max * f)}</text>`
  for (let i = 0; i < 24; i++) {
    const x = 28 + i * bw
    if (vals[i] === undefined) {
      s += `<rect x="${x + 1}" y="${h - 18}" width="${bw - 2}" height="2" class="b-fut"/>`
    } else {
      const bh = Math.max(2, (vals[i] / max) * (h - 30))
      s += `<path d="M${x + 1},${h - 16} v${-(bh - 2)} q0,-2 2,-2 h${bw - 6} q2,0 2,2 v${bh - 2} z" class="${i === vals.length - 1 ? "b-now" : "b-bar"}"/>`
    }
    if (i % 4 === 0)
      s += `<text x="${x + bw / 2}" y="${h - 3}" class="ax" text-anchor="middle">${String(i).padStart(2, "0")}</text>`
  }
  return s + `</svg>`
}

/** 本周航次按船型（单系列横条 + 数字） */
function weekClasses(d) {
  const max = Math.max(...d.byClass.map((x) => x.n), 1)
  return `<div class="hb">${d.byClass
    .map(
      (x) =>
        `<div class="hb-r"><span>${x.name}</span><div class="hb-t"><s style="width:${(x.n / max) * 100}%"></s></div><b>${x.n}</b><em>航次</em></div>`
    )
    .join(
      ""
    )}</div><div class="sub">本周计划 ${d.week.length} 个航次 · 周泊位计划</div>`
}

/** 设备运行：三个环（作业占比）+ 状态明细 */
function equip(d) {
  const k = d.state.kpi
  const ring = (name, icon, total, parts) => {
    const r = 30
    const C = 2 * Math.PI * r
    let off = 0
    const segs = parts
      .filter((p) => p.n > 0)
      .map((p) => {
        const len = (p.n / total) * C
        const seg = `<circle cx="44" cy="44" r="${r}" class="rg ${p.c}" stroke-dasharray="${Math.max(0, len - 2)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 44 44)"/>`
        off += len
        return seg
      })
      .join("")
    const work = parts[0].n
    return `<div class="eq">
      <svg width="80" height="80" viewBox="0 0 88 88"><circle cx="44" cy="44" r="${r}" class="rg-bg"/>${segs}
        <text x="44" y="44" text-anchor="middle" class="rg-v">${Math.round((work / total) * 100)}<tspan class="rg-u">%</tspan></text>
        <text x="44" y="60" text-anchor="middle" class="rg-l">作业率</text></svg>
      <div class="eq-i"><div class="eq-n">${icon}<b>${name}</b><span>${total} 台</span></div>
        ${parts.map((p) => `<div class="eq-p"><i class="dot ${p.c}"></i>${p.l}<b>${p.n}</b></div>`).join("")}</div>
    </div>`
  }
  return `<div class="eqs">
    ${ring("岸桥", ICON.crane, k.qc.total, [
      { l: "作业", n: k.qc.work, c: "st-work" },
      { l: "待机", n: k.qc.idle, c: "st-idle" },
      { l: "故障", n: k.qc.fault, c: "st-fault" },
      { l: "检修", n: k.qc.maint, c: "st-maint" }
    ])}
    ${ring("轨道吊", ICON.crane, k.rmg.total, [
      { l: "作业", n: k.rmg.work, c: "st-work" },
      { l: "待机", n: k.rmg.idle, c: "st-idle" },
      { l: "故障", n: k.rmg.fault, c: "st-fault" }
    ])}
    ${ring("AGV", ICON.agv, k.agv.total, [
      { l: "作业", n: k.agv.laden + k.agv.empty + k.agv.queue, c: "st-work" },
      { l: "空闲", n: k.agv.idle, c: "st-idle" },
      { l: "换电", n: k.agv.swap, c: "st-swap" },
      { l: "故障", n: k.agv.fault, c: "st-fault" }
    ])}
  </div>`
}

/** 作业路协同：岸桥 → AGV → 箱区，一路一行；瓶颈原因标签 */
function lines(d, limit = 7) {
  const s = d.state
  const vById = new Map(s.vessels.map((v) => [v.id, v]))
  const agvN = new Map()
  for (const a of s.agvs)
    if (a.crane) agvN.set(a.crane, (agvN.get(a.crane) || 0) + 1)
  const rmgFault = new Set(
    s.blocks.flatMap((b) =>
      b.rmg.filter((r) => r.state === "fault").map((r) => r.id)
    )
  )
  const rows = s.cranes
    .filter((c) => c.state === "work" || c.state === "fault")
    .slice(0, limit)
  return `<table class="tbl"><thead><tr><th>岸桥</th><th>船舶</th><th>当前效率 · 自然箱/h</th><th>剩余</th><th>AGV</th><th>箱区</th></tr></thead><tbody>${rows
    .map((c) => {
      const v = vById.get(c.vessel)
      const why =
        c.state === "fault"
          ? ["岸桥故障", "fault"]
          : rmgFault.has(`${c.target}-S`)
            ? ["轨道吊故障", "fault"]
            : c.rate < 31
              ? ["效率偏低", "warn"]
              : null
      return `<tr class="${c.state}"><td><span class="code">${c.id}</span></td><td>${v ? v.name : "—"}</td>
        <td><div class="rt"><s style="width:${Math.min(1, c.rate / 45) * 100}%"></s></div><b>${c.state === "fault" ? "停机" : fmt(c.rate)}</b></td>
        <td class="num">${fmt(c.remain)}</td><td class="num">${agvN.get(c.id) || 0}</td>
        <td><span class="code">${c.target || "—"}</span>${why ? `<em class="badge ${why[1]}">${why[0]}</em>` : ""}</td></tr>`
    })
    .join("")}</tbody></table>`
}

/** AGV 电量分布（单系列，25% 以下用告警色并标"换电线"）+ 换电站 */
function agv(d, w = 412, h = 74) {
  const bins = new Array(10).fill(0)
  for (const a of d.state.agvs) bins[Math.min(9, Math.floor(a.soc / 10))]++
  const max = Math.max(...bins, 1)
  const bw = (w - 16) / 10
  let s = `<svg class="bars" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
  bins.forEach((n, i) => {
    const bh = Math.max(2, (n / max) * (h - 34))
    const x = 8 + i * bw
    s += `<path d="M${x + 3},${h - 16} v${-(bh - 2)} q0,-2 2,-2 h${bw - 10} q2,0 2,2 v${bh - 2} z" class="${i < 3 ? "b-low" : "b-bar"}"/>`
    s += `<text x="${x + bw / 2}" y="${h - 20 - bh}" class="val" text-anchor="middle">${n}</text>`
    s += `<text x="${x + bw / 2}" y="${h - 3}" class="ax" text-anchor="middle">${i * 10}</text>`
  })
  s += `<line x1="${8 + 2.5 * bw}" x2="${8 + 2.5 * bw}" y1="4" y2="${h - 15}" class="g-cur warn"/><text x="${8 + 2.5 * bw - 4}" y="12" class="ax" text-anchor="end">换电线 25%</text></svg>`
  const st = d.state.swaps
    .map(
      (x) =>
        `<div class="sw-st">${ICON.bolt}<b>${x.id}</b><span>换电中 <i>${x.swapping}</i></span><span>往返 <i>${x.queue}</i></span><span>满电电池 <i>${x.full}</i></span><span>今日换电 <i>${x.swapsToday}</i> 次</span></div>`
    )
    .join("")
  return s + st
}

/** 告警与事件：带处置按钮；底部按类型的今日统计 */
function events(d, limit = 2) {
  const s = d.state
  const list = s.events
    .slice(0, limit)
    .map(
      (e) => `<div class="ev ${e.level} ${e.status}">
      <i class="ev-ic">${ICON.alert}</i>
      <div class="ev-m"><div><b>${e.title}</b><span class="code">${e.target}</span></div><span>${e.desc}</span></div>
      <div class="ev-s"><em class="st-${e.status}">${EV_STATUS[e.status]}</em><span>${hm(e.at)}</span>
        ${e.status === "pending" ? `<div class="ev-btn"><a>定位</a><a class="pri">派单</a></div>` : ""}</div>
    </div>`
    )
    .join("")
  // 今日按类型统计：列表上方一行小标签（数字从当天事件明细数出来）
  const today = s.events.filter((e) => e.at >= s.clock.dayStart)
  const by = {}
  for (const e of today) by[e.kind] = (by[e.kind] || 0) + 1
  const chips = Object.entries(by)
    .sort((x, y) => y[1] - x[1])
    .map(([k, n]) => `<span>${KIND_CN[k] || k}<b>${n}</b></span>`)
    .join("")
  const stat = `<div class="ev-chips"><em>今日 ${today.length} 条</em>${chips}</div>`
  return stat + list
}

/** 底部：图层 / 视角工具条 + 今日事件时间轴 */
function toolbar(d) {
  const s = d.state
  const d0 = s.clock.dayStart
  const X = (t) => ((t - d0) / D) * 100
  const ticks = s.events
    .filter((e) => e.at >= d0)
    .map((e) => `<i class="tk ${e.level}" style="left:${X(e.at)}%"></i>`)
    .join("")
  const layers = ["船舶", "岸桥", "AGV 光迹", "作业路光带", "箱区热度", "告警"]
  return `<div class="tb">
    <div class="tb-g">${ICON.layers}<span class="tb-t">图层</span>${layers.map((l, i) => `<a class="${i < 4 || i === 5 ? "on" : ""}">${l}</a>`).join("")}</div>
    <div class="tb-g">${ICON.eye}<span class="tb-t">视角</span><a class="on">总览</a><a>泊位</a><a>箱区</a><a>单船跟踪</a></div>
    <div class="tb-g tour">${ICON.play}<span>自动巡游中 · 3/9</span></div>
    <div class="tl"><div class="tl-bar"><s style="width:${X(s.t)}%"></s>${ticks}<b style="left:${X(s.t)}%"></b></div>
      <div class="tl-ax">${[0, 6, 12, 18, 24].map((h) => `<span style="left:${(h / 24) * 100}%">${String(h).padStart(2, "0")}:00</span>`).join("")}</div></div>
  </div>`
}

/** 小地图：真实码头面轮廓（OSM）+ 泊位刻度 + 当前视野框；不标经纬度、比例尺 */
function minimap() {
  const T = site.terminal
  const u0 = -150
  const u1 = 3050
  const v0 = -300
  const v1 = 760
  const w = 220
  const h = (w * (v1 - v0)) / (u1 - u0)
  const X = (u) => ((u - u0) / (u1 - u0)) * w
  const Y = (v) => ((v1 - v) / (v1 - v0)) * h
  const poly = T.map(([u, v]) => `${X(u).toFixed(1)},${Y(v).toFixed(1)}`).join(
    " "
  )
  const blocks = layout.blocks
    .map(
      (b) =>
        `<rect x="${X(b.u - 14)}" y="${Y(b.v1)}" width="${X(b.u + 14) - X(b.u - 14)}" height="${Y(b.v0) - Y(b.v1)}"/>`
    )
    .join("")
  return `<div class="mm"><div class="mm-h">码头全景<span>MINIMAP</span></div><svg width="${w}" height="${h + 6}" viewBox="0 0 ${w} ${h + 6}">
    <polygon points="${poly}" class="mm-t"/><g class="mm-b">${blocks}</g>
    <line x1="${X(0)}" x2="${X(layout.quay.u1)}" y1="${Y(-2)}" y2="${Y(-2)}" class="mm-q"/>
    <rect x="${X(700)}" y="${Y(560)}" width="${X(1900) - X(700)}" height="${Y(-120) - Y(560)}" class="mm-v"/></svg></div>`
}

/** 叠在概念图上的标签（位置按概念图里的画面手工对位，实现阶段改为三维投影） */
function sceneLabels(d) {
  const s = d.state
  const vs = s.vessels.filter((v) =>
    ["moored", "working", "finishing"].includes(v.stage)
  )
  const byCls = (c) => vs.find((v) => v.cls === c)
  // 概念图里从西往东：超大型、大型、大型（画面里的第三条）、支线
  const plates = [
    [byCls("ULCV"), 640, 806, 520, 870],
    [byCls("VLCS"), 1080, 604, 1050, 660],
    [byCls("PPX"), 1250, 500, 1400, 520]
  ]
  let out = ""
  for (const [v, x, y, ax, ay] of plates) {
    if (!v) continue
    out += `<svg class="lead"><line x1="${x}" y1="${y + 30}" x2="${ax}" y2="${ay}"/><circle cx="${ax}" cy="${ay}" r="3"/></svg>
      <div class="plate" style="left:${x}px;top:${y}px"><div class="pl-h">${ICON.ship}<b>${v.name}</b><em>${v.clsName}</em></div>
      <div class="pl-r"><span>进度</span><b>${pct(v.done / v.moves)}</b><span>船时</span><b>${fmt(v.rate)}</b></div><i style="width:${(v.done / v.moves) * 100}%"></i></div>`
  }
  // 为长澜云帆服务的岸桥编号（画面里第二条船上方的一排）
  const qc = s.cranes
    .filter((c) => c.vessel === byCls("VLCS")?.id && c.state === "work")
    .slice(0, 5)
  const qcPos = [
    [1012, 470],
    [1080, 448],
    [1150, 428],
    [1222, 408],
    [1294, 388]
  ]
  qc.forEach(
    (c, i) =>
      (out += `<div class="qc-tag" style="left:${qcPos[i][0]}px;top:${qcPos[i][1]}px"><span class="code">${c.id}</span><b>${fmt(c.rate)}</b></div>`)
  )
  // 主告警（QC13 岸桥故障）：卡片 + 引线连到概念图里的红色光柱
  const e = s.events.find(
    (x) => x.kind === "qcFault" && x.status !== "resolved"
  )
  if (e) {
    out += `<svg class="lead al"><line x1="836" y1="388" x2="962" y2="520"/><circle cx="962" cy="520" r="4"/></svg>
      <div class="al-card" style="left:600px;top:282px"><div class="al-h">${ICON.alert}<b>${e.title}</b><em>重要</em></div>
      <div class="al-b"><span class="code">${e.target}</span> · ${e.desc}</div>
      <div class="al-f"><span>${hm(e.at)} · ${EV_STATUS[e.status]} · ${e.team}</span><a>派单</a></div></div>`
  }
  // 数据过期：AGV068 定位中断
  const lost = s.events.find(
    (x) => x.kind === "agvSignal" && x.status !== "resolved"
  )
  if (lost)
    out += `<div class="stale" style="left:560px;top:596px"><i></i><span class="code">${lost.target}</span>定位中断 ${Math.round((s.t - lost.at) / 60000)} 分钟 · 数据过期</div>`
  // 泊位刻度：沿概念图里的岸线
  // 岸线：概念图里岸桥脚下那条线（按 1920 宽换算）
  const quay = [
    [170, 850],
    [1790, 300]
  ]
  layout.berths.forEach((b, i) => {
    const t = (i + 0.5) / layout.berths.length
    const x = quay[0][0] + (quay[1][0] - quay[0][0]) * t
    const y = quay[0][1] + (quay[1][1] - quay[0][1]) * t
    if (x > 450 && x < 1460)
      out += `<div class="berth" style="left:${x}px;top:${y}px">${b.id}</div>`
  })
  return (
    out +
    `<div class="live"><i></i>数字孪生 · 实时<span class="code">LIVE · 1 s</span></div>`
  )
}

export function render(d) {
  return `${header(d)}
    ${kpis(d)}
    <aside class="col left">
      ${panel("在泊船舶", "VESSELS AT BERTH", vessels(d), { extra: "grow-0" })}
      ${panel("靠离泊计划 · 24 h", "BERTH SCHEDULE", gantt(d))}
      ${panel("今日作业量 · 逐小时", "HOURLY MOVES", hourlyBars(d))}
      ${panel("本周航次 · 船型", "WEEKLY CALLS", weekClasses(d), { extra: "fill" })}
    </aside>
    <aside class="col right">
      ${panel("设备运行", "EQUIPMENT", equip(d))}
      ${panel("作业路协同", "QC → AGV → YARD", lines(d), { tools: '<span class="pn-tool">按效率 ▾</span>' })}
      ${panel("AGV 电量与换电", "AGV & BATTERY SWAP", agv(d))}
      ${panel("告警与事件", "ALERTS", events(d), { extra: "fill", tools: '<span class="pn-tool">全部 ▾</span>' })}
    </aside>
    ${minimap()}
    ${toolbar(d)}
    ${sceneLabels(d)}`
}

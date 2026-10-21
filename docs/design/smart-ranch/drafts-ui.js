/*
 * 智慧牧场 设计稿面板与标注（三个方向共用数据，版式各不相同）
 * ----------------------------------------------------------
 *   a 晴空牧场：浮动白色磨砂卡片，顶部一排指标卡，底部图层 / 月份条
 *   b 墨绿遥感：两侧贴边的满高深色面板（1 px 细线、不发光），顶栏内嵌指标，地图边缘带经纬刻度感的比例尺
 *   c 金色牧歌：电影感，标题居中衬线体，两侧窄栏，底部"今日作息"时间轴
 * 数字全部来自仿真状态（simulator.at），汇总值从明细算，和 mock/ 快照同一份逻辑。
 */

/** 各方向的时刻与镜头。镜头 yaw = 0 时从东南岸往西北看，河谷横贯画面 */
export const VIEWS = {
  a: {
    date: "2026-07-25",
    time: "13:58",
    camera: {
      target: [150, 100],
      dist: 28500,
      yaw: -5,
      pitch: 40,
      fov: 27,
      shift: [0, 70]
    },
    // v2 版式：顶部多了功能导航、底部多了一排卡片，沙盘再小一点、往上提
    cameraV2: {
      target: [150, 100],
      dist: 31500,
      yaw: -5,
      pitch: 42,
      fov: 27,
      shift: [-30, -24]
    },
    trailHerd: "CH-03",
    next: null
  },
  b: {
    date: "2026-07-25",
    time: "13:58",
    camera: {
      target: [0, 100],
      dist: 26500,
      yaw: 0,
      pitch: 56,
      fov: 27,
      shift: [0, 30]
    },
    trailHerd: "CH-03",
    next: null
  },
  c: {
    date: "2026-07-18",
    time: "18:40",
    camera: {
      target: [-200, 200],
      dist: 27000,
      yaw: 8,
      pitch: 31,
      fov: 27,
      shift: [0, 110]
    },
    trailHerd: null,
    next: null
  }
}

/** 选当前联动的告警：越界 > 离群 > 饮水点 > 其它；给出位置和所在分区 */
export function pickAlarm(state, layout) {
  const order = ["fence", "stray", "water", "offline", "battery"]
  const ev = [...state.events.active].sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)
  )[0]
  if (!ev) return null
  let pos = null
  let paddock = null
  if (ev.kind === "fence") {
    const h = state.herds.find((x) => x.id === ev.herd)
    pos = h.cows[ev.cow]
    paddock = h.paddock
  } else if (ev.kind === "stray") {
    const h = state.herds.find((x) => x.id === ev.herd)
    pos = h.leads.find((l) => l.id === ev.target).pos
    paddock = h.paddock
    // 离群：从羊群中心拉一条虚线到这只头羊
    return { ...ev, pos, paddock, from: h.pos }
  } else if (ev.kind === "water") {
    pos = layout.water.find((w) => w.id === ev.target).pos
  } else {
    const h = state.herds.find((x) => x.id === ev.herd)
    pos = h.pos
    paddock = h.paddock
  }
  return { ...ev, pos, paddock }
}

// ---------------- 数据整理 ----------------

export const fmt = (v, d = 0) =>
  Number(v).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  })
export const sign = (v, d = 1) =>
  (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v), d)
export const hm = (h) => {
  const m = Math.round(h * 60)
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}
export const STAGE = {
  pending: "待处理",
  dispatched: "已派单",
  handling: "处理中",
  resolved: "已解决"
}
export const LEVEL = { urgent: "紧急", major: "重要", minor: "一般" }
export const ACT = { graze: "采食", drink: "饮水", rest: "夜宿" }
export const KIND_ICON = {
  fence: "越",
  stray: "离",
  water: "水",
  battery: "电",
  offline: "断"
}

export function derive(state, layout) {
  const r = state.ranch
  const months = layout.ndvi.months
  const area = layout.paddocks.reduce((s, p) => s + p.areaMu, 0)
  // 全场逐月 NDVI：按分区面积加权（真实数据）
  const series = (year) =>
    months.map(
      (_, i) =>
        layout.paddocks.reduce((s, p) => s + p.areaMu * p.ndvi[year][i], 0) /
        area
    )
  const ndvi26 = series("2026")
  const ndvi25 = series("2025")
  // 转场提醒：在牧分区剩余天数最少的单元，给出下一块分区（按 1→2→3→4 轮转）
  const byId = new Map(state.paddocks.map((p) => [p.id, p]))
  const transfers = state.units
    .map((u) => {
      const cur = byId.get(u.grazing)
      const k = Number(u.grazing.split("-")[1])
      const next = byId.get(`${u.id}-${(k % 4) + 1}`)
      return { unit: u.id, herd: u.herd, cur, next }
    })
    .sort((a, b) => a.cur.remainDays - b.cur.remainDays)
  const events = [...state.events.today].sort((a, b) => b.start - a.start)
  const open = events.filter((e) => e.stage !== "resolved")
  return { r, months, ndvi26, ndvi25, transfers, events, open, byId }
}

// ---------------- 小图表（SVG） ----------------

/** 半圆仪表：草畜平衡指数，−20%…+30%，≤ 10% 区段为绿色；当前值用弧上的圆点标出 */
export function gauge(value, c) {
  const W = 220
  const H = 128
  const cx = W / 2
  const cy = 112
  const R = 92
  const lo = -20
  const hi = 30
  const ang = (v) => Math.PI * (1 - (v - lo) / (hi - lo))
  const arc = (a0, a1, r) => {
    const p0 = [cx + r * Math.cos(a0), cy - r * Math.sin(a0)]
    const p1 = [cx + r * Math.cos(a1), cy - r * Math.sin(a1)]
    return `M${p0[0]},${p0[1]} A${r},${r} 0 0 1 ${p1[0]},${p1[1]}`
  }
  const a = ang(Math.max(lo, Math.min(hi, value)))
  const dot = [cx + R * Math.cos(a), cy - R * Math.sin(a)]
  const t10 = [
    cx + (R + 16) * Math.cos(ang(10)),
    cy - (R + 16) * Math.sin(ang(10))
  ]
  return `<svg viewBox="0 0 ${W} ${H}" class="gauge">
    <path d="${arc(Math.PI, ang(10), R)}" stroke="${c.ok}" stroke-width="12" fill="none" stroke-linecap="round"/>
    <path d="${arc(ang(10), 0, R)}" stroke="${c.bad}" stroke-width="12" fill="none" stroke-linecap="round" opacity="0.85"/>
    <circle cx="${dot[0]}" cy="${dot[1]}" r="10" fill="${c.paper}" stroke="${c.ink}" stroke-width="3"/>
    <text x="${t10[0]}" y="${t10[1]}" class="g-tick" text-anchor="middle">10%</text>
  </svg>`
}

/** 各单元实际载畜量与合理载畜量对比（横条） */
export function unitBars(units, c) {
  const max = Math.max(...units.map((u) => Math.max(u.su, u.capacity))) * 1.05
  return `<div class="ubars">${units
    .map((u) => {
      const over = u.balance > 10
      return `<div class="ub-row${over ? " over" : ""}">
        <span class="ub-id">${u.id}</span>
        <span class="ub-track">
          <i class="ub-cap" style="width:${(u.capacity / max) * 100}%"></i>
          <i class="ub-su" style="width:${(u.su / max) * 100}%;background:${over ? c.bad : c.ok}"></i>
        </span>
        <span class="ub-val">${sign(u.balance)}%</span>
      </div>`
    })
    .join("")}</div>`
}

/** 逐月 NDVI 折线：2026 实线、2025 虚线，当前月份高亮 */
export function ndviChart(d, month, c, w = 352, h = 128) {
  const pad = [30, 10, 22, 12]
  const xs = (i) => pad[0] + (i / (d.months.length - 1)) * (w - pad[0] - pad[1])
  const lo = 0.1
  const hi = 0.8
  const ys = (v) => pad[3] + (1 - (v - lo) / (hi - lo)) * (h - pad[2] - pad[3])
  const line = (arr) =>
    arr
      .map((v, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`)
      .join(" ")
  const area = `${line(d.ndvi26)} L${xs(d.months.length - 1)},${h - pad[2]} L${xs(0)},${h - pad[2]} Z`
  const mi = d.months.indexOf(month)
  return `<svg viewBox="0 0 ${w} ${h}" class="chart">
    <defs><linearGradient id="g-ndvi-${c.id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${c.accent}" stop-opacity="0.35"/><stop offset="1" stop-color="${c.accent}" stop-opacity="0"/></linearGradient></defs>
    ${[0.2, 0.4, 0.6, 0.8].map((v) => `<line x1="${pad[0]}" x2="${w - pad[1]}" y1="${ys(v)}" y2="${ys(v)}" class="grid"/><text x="${pad[0] - 6}" y="${ys(v) + 4}" class="tick" text-anchor="end">${v.toFixed(1)}</text>`).join("")}
    <path d="${area}" fill="url(#g-ndvi-${c.id})"/>
    <path d="${line(d.ndvi25)}" fill="none" stroke="${c.muted}" stroke-width="1.6" stroke-dasharray="4 4"/>
    <path d="${line(d.ndvi26)}" fill="none" stroke="${c.accent}" stroke-width="2.4"/>
    ${d.months.map((m, i) => `<text x="${xs(i)}" y="${h - 5}" class="tick${i === mi ? " on" : ""}" text-anchor="middle">${m}月</text>`).join("")}
    <circle cx="${xs(mi)}" cy="${ys(d.ndvi26[mi])}" r="5" fill="${c.accent}" stroke="${c.paper}" stroke-width="2"/>
  </svg>`
}

/** 轮牧状态分段条 */
function statusBar(p, c) {
  const tot = p.grazing + p.resting + p.ready
  const seg = (n, col, label) =>
    `<i style="flex:${n};background:${col}" title="${label}"></i>`
  return `<div class="sbar">${seg(p.grazing, c.accent, "放牧中")}${seg(p.resting, c.rest, "休牧恢复")}${seg(p.ready, c.ok, "待牧")}</div>
    <div class="slegend">
      <span><b style="background:${c.accent}"></b>放牧中 <em>${p.grazing}</em></span>
      <span><b style="background:${c.rest}"></b>休牧恢复 <em>${p.resting}</em></span>
      <span><b style="background:${c.ok}"></b>待牧 <em>${p.ready}</em></span>
      <span class="tot">共 ${tot} 块</span>
    </div>`
}

/** 告警处理进度 */
export function stepper(stage) {
  const steps = ["pending", "dispatched", "handling", "resolved"]
  const k = steps.indexOf(stage)
  return `<div class="stepper">${steps
    .map(
      (s, i) =>
        `<span class="${i < k ? "done" : i === k ? "now" : ""}">${STAGE[s]}</span>`
    )
    .join("<i></i>")}</div>`
}

export function alarmText(a, layout) {
  if (!a) return { what: "", where: "" }
  if (a.kind === "fence")
    return {
      what: `${a.target} 越过电子围栏，进入河岸禁牧保护带`,
      where: `${a.paddock} 北侧 · ${layout.reserve.id}`
    }
  if (a.kind === "stray")
    return {
      what: `头羊项圈 ${a.target} 离开 ${a.herd} 羊群超过 1 km`,
      where: `${a.paddock} · 最后定位 ${hm(a.start + 0.05)}`
    }
  if (a.kind === "water")
    return { what: `${a.target} 水罐液位低于 20%，提水泵故障`, where: a.target }
  return { what: `${a.target} ${a.title}`, where: a.herd }
}

export const card = (title, body, cls = "", extra = "") =>
  `<section class="card ${cls}"><header><h3>${title}</h3>${extra}</header>${body}</section>`

// ---------------- 三个方向 ----------------

export const PALETTE = {
  a: {
    id: "a",
    ok: "#2f8f4e",
    bad: "#e5484d",
    ink: "#1f3a2b",
    accent: "#2b7bd6",
    muted: "#93a5b5",
    paper: "#ffffff",
    rest: "#c4d3c6"
  },
  b: {
    id: "b",
    ok: "#3f7d5a",
    bad: "#ff6b3d",
    ink: "#f3eedf",
    accent: "#c6f25b",
    muted: "#6f8a7b",
    paper: "#0b1511",
    rest: "#2c4337"
  },
  c: {
    id: "c",
    ok: "#9fb35a",
    bad: "#f0502e",
    ink: "#fff1d6",
    accent: "#e6b54a",
    muted: "#a28a6a",
    paper: "#2b2416",
    rest: "#5a4c33"
  }
}

export function header(dir, state) {
  const t = state.t
  const w = state.weather
  const titles = {
    a: ["莫日格勒河示范牧场", "智慧放牧 · 草畜平衡与畜群监管"],
    b: [
      "莫日格勒河示范牧场 · 智慧放牧监管平台",
      "SENTINEL-2 L2A · 10 m · 2026 放牧季"
    ],
    c: ["莫日格勒河 · 傍晚归牧", "呼伦贝尔 · 陈巴尔虎旗 · 示范牧场"]
  }[dir]
  return `<header class="top">
    <div class="brand"><i class="logo"></i><div><h1>${titles[0]}</h1><p>${titles[1]}</p></div></div>
    <div class="clock"><b>${t.hms}</b><span>${t.date} ${t.week}</span><span>${w.sky} ${w.temp}℃ · ${w.wind}</span></div>
  </header>`
}

function kpis(d, state) {
  const r = d.r
  const online = state.collars.online
  const items = [
    [
      "存栏",
      fmt(r.head),
      "头只",
      `羊 ${fmt(r.sheepHead)} · 牛 ${fmt(r.cattleHead)}`
    ],
    [
      "草畜平衡指数",
      sign(r.balance),
      "%",
      r.balance <= 10 ? "≤ 10% 不过牧" : "超载",
      r.balance <= 10 ? "ok" : "bad"
    ],
    [
      "草场 NDVI",
      r.ndvi.toFixed(2),
      "",
      `同比 ${sign(r.ndvi - r.ndviLastYear, 2)}`
    ],
    [
      "项圈在线",
      `${online}`,
      `/ ${state.collars.total}`,
      `低电量 ${state.collars.lowBattery}`
    ],
    [
      "今日告警",
      `${d.events.length}`,
      "条",
      `未结束 ${d.open.length}`,
      d.open.length ? "bad" : ""
    ]
  ]
  return `<div class="kpis">${items
    .map(
      ([k, v, u, sub, cls = ""]) =>
        `<div class="kpi ${cls}"><span class="k">${k}</span><b>${v}<small>${u}</small></b><span class="sub">${sub}</span></div>`
    )
    .join("")}</div>`
}

function balanceCard(d, state, c) {
  const r = d.r
  return card(
    "草畜平衡",
    `<div class="bal">
      <div class="bal-g">${gauge(r.balance, c)}<div class="bal-v"><b>${sign(r.balance)}%</b><span>草畜平衡指数</span></div></div>
      <div class="bal-n"><div><span>实际载畜</span><b>${fmt(r.su)}</b><small>羊单位</small></div>
      <div><span>合理载畜</span><b>${fmt(r.capacity)}</b><small>羊单位</small></div>
      <div><span>超载单元</span><b class="badv">${state.units.filter((u) => u.balance > 10).length}</b><small>个（> 10%）</small></div></div>
    </div>${unitBars(state.units, c)}`,
    "balance",
    `<span class="hint">1 牛 = 5 羊单位</span>`
  )
}

function rotationCard(d, state, c, n = 3) {
  return card(
    "轮牧与转场",
    `${statusBar(state.ranch.paddocks, c)}
    <ul class="transfer">${d.transfers
      .slice(0, n)
      .map(
        (
          t
        ) => `<li><b>${t.unit}</b><span class="tr-cur">${t.cur.id} 剩 <em>${t.cur.remainDays.toFixed(1)}</em> 天</span>
        <i class="arrow">→</i><span class="tr-next">${t.next.id} · ${t.next.status === "ready" ? "待牧" : "休牧 " + t.next.restDays.toFixed(0) + " 天"} · 可食 ${t.next.forage.toFixed(0)} kg/亩</span></li>`
      )
      .join("")}</ul>`,
    "rotation"
  )
}

function ndviCard(d, state, c, w, h) {
  return card(
    "草场长势",
    `${ndviChart(d, state.t.month, c, w, h)}<div class="legend-line"><span><i class="solid"></i>2026 年</span><span><i class="dash"></i>2025 年同期</span><span class="src">Sentinel-2 真实 NDVI · 分区面积加权</span></div>`,
    "ndvi"
  )
}

function alarmCard(a, layout, c, cls = "") {
  if (!a) return ""
  const t = alarmText(a, layout)
  // 近景概念图（Figma AI 生成，建模参照）：告警联动时镜头飞到事发处看到的样子
  return `<section class="card alarm ${cls}">
    <header><h3><i class="dot"></i>${a.title}</h3><span class="lv">${LEVEL[a.level]}</span></header>
    <figure class="closeup"><img src="./design/closeup-${c.id}.png" alt=""/><figcaption>联动近景 · ${a.kind === "stray" ? "离群头羊" : a.target}</figcaption></figure>
    <p class="what">${t.what}</p>
    <dl><dt>位置</dt><dd>${t.where}</dd><dt>发生</dt><dd>${hm(a.start)}</dd><dt>派给</dt><dd>放牧员 ${a.herder}</dd></dl>
    ${stepper(a.stage)}
  </section>`
}

function eventsCard(d, n = 5) {
  return card(
    "告警事件",
    `<ul class="events">${d.events
      .slice(0, n)
      .map(
        (e) =>
          `<li class="lv-${e.level}${e.stage === "resolved" ? " done" : ""}"><i>${KIND_ICON[e.kind]}</i><span class="ev-t">${e.title}</span><span class="ev-o">${e.target}</span><span class="ev-h">${hm(e.start)}</span><span class="ev-s">${STAGE[e.stage]}</span></li>`
      )
      .join("")}</ul>`,
    "events",
    `<span class="hint">今日 ${d.events.length} 条</span>`
  )
}

function herdsCard(state, n = 10) {
  return card(
    "畜群动态",
    `<table class="herds"><thead><tr><th>畜群</th><th>头数</th><th>分区</th><th>状态</th><th>今日行走</th></tr></thead><tbody>${state.herds
      .slice(0, n)
      .map(
        (h) =>
          `<tr><td><i class="hk ${h.kind}"></i>${h.id}</td><td>${fmt(h.head)}</td><td>${h.paddock}</td><td>${ACT[h.activity]}</td><td>${h.walkKm.toFixed(1)} km</td></tr>`
      )
      .join("")}</tbody></table>`,
    "herds"
  )
}

function waterCard(state) {
  return card(
    "饮水点",
    `<div class="wgrid">${state.water
      .map((w) => {
        const bad = w.pump === "fault" || w.level < 20
        return `<div class="wp${bad ? " bad" : ""}"><span class="wl"><i style="height:${w.level}%"></i></span><b>${w.id.slice(3)}</b><span>${w.level.toFixed(0)}%</span></div>`
      })
      .join("")}</div>`,
    "water",
    `<span class="hint">今日供水 ${state.ranch.suppliedM3.toFixed(1)} m³</span>`
  )
}

function layerBar(state, dir) {
  const months = [4, 5, 6, 7, 8, 9, 10]
  return `<div class="layerbar">
    <div class="chips"><span class="on">草场长势</span><span>轮牧状态</span><span>畜群定位</span></div>
    <div class="months">${months.map((m) => `<span class="${m === state.t.month ? "on" : ""}">${m}月</span>`).join("")}</div>
    <div class="ramp"><i></i><span>NDVI 0.2</span><span>0.5</span><span>0.8</span></div>
    ${dir === "b" ? "" : ""}
  </div>`
}

/** 今日作息时间轴（c 方向）：出牧 → 饮水 → 归牧，标出当前时刻和已发生的告警 */
function dayline(state, d) {
  const x = (h) => ((h - 4) / 18) * 100
  const now = state.t.hours
  const marks = [
    [5.5, "出牧"],
    [8.5, "采食"],
    [11.5, "饮水"],
    [15, "午后采食"],
    [20, "归牧夜宿"]
  ]
  return `<div class="dayline">
    <div class="dl-track"><i class="dl-done" style="width:${x(now)}%"></i>
      ${marks.map(([h, t]) => `<span class="dl-m" style="left:${x(h)}%"><b></b>${hm(h)} ${t}</span>`).join("")}
      ${d.events.map((e) => `<em class="dl-ev lv-${e.level}" style="left:${x(e.start)}%"></em>`).join("")}
      <span class="dl-now" style="left:${x(now)}%">${state.t.hm}</span>
    </div>
  </div>`
}

/** 归牧进度（c 方向）：每个羊群离营地多远 */
function homingCard(state, layout) {
  const homes = new Map(layout.homesteads.map((h) => [h.unit, h.pos]))
  const rows = state.herds
    .filter((h) => h.kind === "sheep")
    .map((h) => {
      const p = homes.get(h.unit)
      const km = Math.hypot(h.pos[0] - p[0], h.pos[1] - p[1]) / 1000
      return { h, km }
    })
  return card(
    "羊群归牧",
    `<ul class="homing">${rows
      .map(
        ({ h, km }) =>
          `<li><b>${h.id}</b><span class="hm-bar"><i style="width:${Math.max(4, 100 - km * 45)}%"></i></span><span>${km.toFixed(1)} km</span><span class="hm-n">${fmt(h.head)} 只</span></li>`
      )
      .join("")}</ul>`,
    "homing",
    `<span class="hint">20:00 前回营地</span>`
  )
}

export function buildUi(dir, state, layout, alarm) {
  const d = derive(state, layout)
  const c = PALETTE[dir]
  if (dir === "a") {
    return `${header(dir, state)}${kpis(d, state)}
      <aside class="col left">${balanceCard(d, state, c)}${rotationCard(d, state, c)}${ndviCard(d, state, c, 352, 104)}${waterCard(state)}</aside>
      <aside class="col right">${alarmCard(alarm, layout, c)}${eventsCard(d, 3)}${herdsCard(state)}</aside>
      ${layerBar(state, dir)}`
  }
  if (dir === "b") {
    return `${header(dir, state)}<div class="kbar">${kpis(d, state)}</div>
      <aside class="col left">${balanceCard(d, state, c)}${rotationCard(d, state, c, 4)}${ndviCard(d, state, c, 388, 132)}${waterCard(state)}</aside>
      <aside class="col right">${alarmCard(alarm, layout, c)}${eventsCard(d, 4)}${herdsCard(state)}</aside>
      ${layerBar(state, dir)}<div class="mapmeta"><span>沙盘 12 × 8 km · 竖向放大 2.2 倍</span><span>影像 Sentinel-2 L2A 2026-07 合成 · 地形 Copernicus GLO-30</span></div>`
  }
  return `${header(dir, state)}${kpis(d, state)}
    <aside class="col left">${balanceCard(d, state, c)}${ndviCard(d, state, c, 300, 118)}</aside>
    <aside class="col right">${alarmCard(alarm, layout, c)}${homingCard(state, layout)}</aside>
    ${dayline(state, d)}`
}

// ---------------- 场景标注 ----------------

/** 把畜群徽标、场部、饮水点、告警标注按三维位置摆到画面上 */
export function placeLabels(el, scene, state, layout, alarm, dir) {
  const html = []
  const put = (X, Y, lift, inner, cls) => {
    const p = scene.project(X, Y, lift)
    if (p.behind) return
    html.push(
      `<div class="lb ${cls}" style="left:${p.x.toFixed(1)}px;top:${p.y.toFixed(1)}px">${inner}</div>`
    )
  }
  // 饮水点：小圆点 + 液位环；告警的饮水点标红
  for (const w of state.water) {
    const lw = layout.water.find((x) => x.id === w.id)
    const bad = w.pump === "fault" || w.level < 20
    put(
      lw.pos[0],
      lw.pos[1],
      6,
      `<i style="--lv:${w.level}%"></i>${bad ? `<span>${w.id}</span>` : ""}`,
      `wp${bad ? " bad" : ""}`
    )
  }
  // 营地
  for (const h of layout.homesteads) put(h.pos[0], h.pos[1], 4, "<i></i>", "hh")
  // A v2：中继基站、摄像头点位
  if (document.body.classList.contains("v2")) {
    for (const b of layout.stations) put(b.pos[0], b.pos[1], 20, `<i></i><span>${b.id}</span>`, "bs")
    for (const cam of layout.cameras.filter((c) => c.at.startsWith("WP"))) {
      const w = layout.water.find((x) => x.id === cam.at)
      put(w.pos[0] + 90, w.pos[1] + 60, 8, "<i></i>", "cam")
    }
  }
  // 场部
  const hq = layout.hq
  put(hq.pos[0], hq.pos[1], 30, `<span>场部 HQ-01</span>`, "hq")
  // 畜群徽标（竖向引线落到群中心）
  for (const h of state.herds) {
    const warn = alarm && alarm.herd === h.id
    put(
      h.pos[0],
      h.pos[1],
      0,
      `<div class="pill"><i class="hk ${h.kind}"></i><b>${h.id}</b><span>${fmt(h.head)}</span></div><em></em>`,
      `herd${warn ? " warn" : ""}`
    )
  }
  // 告警标注：卡片放在沙盘上方的空白处（各方向的高度不同），竖向引线连到告警位置
  if (alarm) {
    const t = alarmText(alarm, layout)
    const p = scene.project(alarm.pos[0], alarm.pos[1], 0)
    const top = document.body.classList.contains("v2") ? 160 : { a: 150, b: 96, c: 214 }[dir]
    const x = Math.min(Math.max(p.x, 600), document.body.classList.contains("v2") ? 1230 : 1320)
    html.push(`<div class="lb alarm" style="left:${x}px;top:${top}px">
      <div class="callout"><b>${alarm.title}</b><span>${t.what}</span><small>${hm(alarm.start)} · ${STAGE[alarm.stage]} · ${alarm.herder}</small></div></div>
      <svg class="leader" width="1920" height="1080"><polyline points="${x},${top + 92} ${x},${top + 112} ${p.x},${p.y - 14}" /><circle cx="${p.x}" cy="${p.y}" r="4"/></svg>`)
  }
  // 指北针与比例尺：北方向在沙盘坐标里是 (sinθ, cosθ)
  const th = layout.sandbox.theta
  const o = scene.project(0, 0, 0)
  const nn = scene.project(Math.sin(th) * 1000, Math.cos(th) * 1000, 0)
  const deg = (Math.atan2(nn.x - o.x, -(nn.y - o.y)) * 180) / Math.PI
  const s0 = scene.project(-5800, -3800, 0)
  const s1 = scene.project(-3800, -3800, 0)
  html.push(
    `<div class="north" style="--deg:${deg.toFixed(1)}deg"><i></i><span>北</span></div>`
  )
  html.push(
    `<div class="scale" style="left:${s0.x}px;top:${s0.y + 28}px;width:${s1.x - s0.x}px"><i></i><span>2 km</span></div>`
  )
  el.innerHTML = html.join("")
}

/*
 * 智慧牧场 设计稿 A v2（晴空牧场 · 加功能入口与多类数据）
 * ----------------------------------------------------------
 * 用户选了 A 的风格，但觉得"功能太少、数据单一"。v2 在 A 的白色磨砂卡片风格上：
 *   - 功能入口：顶部功能导航 + 搜索、地图右侧工具条（图层 / 视角 / 巡游 / 测距）、告警卡片的处置按钮
 *   - 数据种类：指标卡带走势小图、分区长势矩阵、7 天转场甘特、气象 24 h、告警统计（类型环图 + 24 h 分布）、
 *     生产作业进度 + 称重日增重、存栏结构、饮水点 + 24 h 供水、设备在线
 * 数字全部来自仿真器（同 drafts-ui.js），逐时序列按同一天的各整点调用 sim.at 取。
 */
import { NDVI_RAMP } from "/src/views/smart-ranch/scene/theme.js"

import {
  ACT,
  alarmText,
  card,
  derive,
  fmt,
  gauge,
  hm,
  KIND_ICON,
  LEVEL,
  ndviChart,
  PALETTE,
  sign,
  STAGE,
  stepper,
  unitBars
} from "./drafts-ui.js"

const C = PALETTE.a
const KIND_NAME = { fence: "越界", stray: "离群", water: "饮水点", battery: "低电量", offline: "离线" }
const KIND_COLOR = { fence: "#e5484d", stray: "#f08c2e", water: "#2b7bd6", battery: "#c9a227", offline: "#93a5b5" }

/** NDVI → 色带颜色（和地表着色器同一条色带） */
function rampColor(v) {
  const hexs = NDVI_RAMP.map(([x, h]) => [x, [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))])
  if (v <= hexs[0][0]) return `rgb(${hexs[0][1]})`
  for (let i = 1; i < hexs.length; i++) {
    const [x0, c0] = hexs[i - 1]
    const [x1, c1] = hexs[i]
    if (v <= x1) {
      const t = (v - x0) / (x1 - x0)
      return `rgb(${c0.map((c, k) => Math.round(c + (c1[k] - c) * t))})`
    }
  }
  return `rgb(${hexs[hexs.length - 1][1]})`
}

/** 小折线（走势），values 等距铺满 w */
function spark(values, w = 64, h = 22, color = C.accent, fill = true) {
  if (!values.length) return ""
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  const pts = values.map((v, i) => [(i / Math.max(values.length - 1, 1)) * w, h - 2 - ((v - lo) / span) * (h - 4)])
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    ${fill ? `<path d="${line} L${w},${h} L0,${h} Z" fill="${color}" opacity="0.14"/>` : ""}
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.6"/>
    <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="2.4" fill="${color}"/></svg>`
}

/** 环图 */
function donut(parts, r = 34, w = 12) {
  const tot = parts.reduce((s, p) => s + p.v, 0) || 1
  let a = -Math.PI / 2
  const segs = parts
    .filter((p) => p.v > 0)
    .map((p) => {
      const a1 = a + (p.v / tot) * Math.PI * 2
      const large = a1 - a > Math.PI ? 1 : 0
      const d = `M${r + w + r * Math.cos(a)},${r + w + r * Math.sin(a)} A${r},${r} 0 ${large} 1 ${r + w + r * Math.cos(a1 - 0.0001)},${r + w + r * Math.sin(a1 - 0.0001)}`
      a = a1
      return `<path d="${d}" stroke="${p.c}" stroke-width="${w}" fill="none"/>`
    })
  const S = (r + w) * 2
  return `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" class="donut"><circle cx="${r + w}" cy="${r + w}" r="${r}" stroke="rgba(31,58,43,0.08)" stroke-width="${w}" fill="none"/>${segs.join("")}</svg>`
}

/** 同一天各整点的仿真快照（走势小图、24 h 曲线用） */
function hourly(sim, ms, state) {
  const now = state.t.hours
  const out = []
  for (let h = 0; h <= Math.floor(now); h++) out.push(sim.at(ms - (now - h) * 3600000))
  out.push(state)
  return out
}

// ---------------- 顶栏 ----------------

function topbar(state, d, hours) {
  const r = d.r
  const t = state.t
  const w = state.weather
  const kpi = (k, v, u, sub, sp, cls = "") =>
    `<div class="kpi ${cls}"><span class="k">${k}</span><div class="kv"><b>${v}<small>${u}</small></b>${sp}</div><span class="sub">${sub}</span></div>`
  const ndviM = d.ndvi26.slice(0, d.months.indexOf(t.month) + 1)
  const alarmsByHour = Array.from({ length: Math.floor(t.hours) + 1 }, (_, h) => d.events.filter((e) => Math.floor(e.start) === h).length)
  return `<header class="top">
      <div class="brand"><i class="logo"></i><div><h1>莫日格勒河示范牧场</h1><p>智慧放牧 · 草畜平衡与畜群监管平台</p></div></div>
      <div class="clock"><b>${t.hms}</b><span>${t.date} ${t.week}</span><span class="cw">${w.sky} ${w.temp}℃ · ${w.wind}</span></div>
    </header>
    <div class="kpis">
      ${kpi("存栏", fmt(r.head), "头只", `羊 ${fmt(r.sheepHead)} · 牛 ${fmt(r.cattleHead)}`, `<span class="kmix"><i style="flex:${r.sheepHead}"></i><i style="flex:${r.cattleHead * 5}"></i></span>`)}
      ${kpi("草畜平衡指数", sign(r.balance), "%", "≤ 10% 不过牧", spark(state.units.map((u) => u.balance), 64, 22, C.ok, false), "ok")}
      ${kpi("草场 NDVI", r.ndvi.toFixed(2), "", `同比 ${sign(r.ndvi - r.ndviLastYear, 2)}`, spark(ndviM, 64, 22, C.ok))}
      ${kpi("羊群日均行走", r.avgWalkKm.toFixed(1), "km", "调研常值 6–9 km/天", spark(hours.map((s) => s.ranch.avgWalkKm)))}
      ${kpi("项圈在线", `${state.collars.online}`, `/ ${state.collars.total}`, `低电量 ${state.collars.lowBattery}`, spark(hours.map((s) => s.collars.online), 64, 22, C.accent, false))}
      ${kpi("今日告警", `${d.events.length}`, "条", `未结束 ${d.open.length}`, spark(alarmsByHour, 64, 22, C.bad), d.open.length ? "bad" : "")}
    </div>
    <nav class="tabs">
      ${["综合态势", "草场长势", "轮牧管理", "畜群定位", "饮水设备", "生产作业", "视频监控"].map((n, i) => `<span class="${i ? "" : "on"}">${n}</span>`).join("")}
      <label class="search"><i></i>搜索畜群 / 项圈 / 分区编号</label>
    </nav>`
}

// ---------------- 左栏 ----------------

function balanceCard(d, state) {
  const r = d.r
  return card(
    "草畜平衡",
    `<div class="bal2">
      <div class="bal-g">${gauge(r.balance, C)}<div class="bal-v"><b>${sign(r.balance)}%</b><span>草畜平衡指数</span></div></div>
      <div class="bal-n">
        <div><span>实际载畜</span><b>${fmt(r.su)}</b><small>羊单位</small></div>
        <div><span>合理载畜</span><b>${fmt(r.capacity)}</b><small>羊单位</small></div>
        <div><span>超载单元</span><b class="badv">${state.units.filter((u) => u.balance > 10).length}</b><small>个 · &gt; 10%</small></div>
      </div>
    </div>${unitBars(state.units, C)}`,
    "balance",
    `<span class="hint">1 牛 = 5 羊单位 · 日食干草 1.8 kg</span>`
  )
}

function ndviCard(d, state, layout) {
  const mi = d.months.indexOf(state.t.month)
  const byId = new Map(state.paddocks.map((p) => [p.id, p]))
  const rows = layout.units
    .map(
      (u) => `<div class="mx-row"><span>${u.id}</span>${u.paddocks
        .map((id) => {
          const p = byId.get(id)
          const ring = p.status === "grazing" ? " grazing" : p.status === "resting" ? " resting" : ""
          return `<i class="mx-cell${ring}" style="background:${rampColor(p.ndvi)}" title="${id}"></i>`
        })
        .join("")}</div>`
    )
    .join("")
  return card(
    "草场长势",
    `<div class="ndvi2">
      <div class="ndvi2-chart">${ndviChart(d, state.t.month, C, 250, 116)}
        <div class="legend-line"><span><i class="solid"></i>2026</span><span><i class="dash"></i>2025 同期</span></div></div>
      <div class="mx"><div class="mx-h"><span></span><span>1</span><span>2</span><span>3</span><span>4</span></div>${rows}
        <div class="mx-k"><i class="g"></i>在牧 <i class="r"></i>休牧</div></div>
    </div>
    <p class="note">${state.t.month} 月全场 NDVI ${d.ndvi26[mi].toFixed(2)}，比 2025 年同期 ${sign(d.ndvi26[mi] - d.ndvi25[mi], 2)} · Sentinel-2 真实数据</p>`,
    "ndvi",
    `<span class="hint">分区矩阵：10 单元 × 4 分区</span>`
  )
}

function rotationCard(d, state) {
  const p = state.ranch.paddocks
  const days = 7
  const rows = state.units
    .map((u) => {
      const t = d.transfers.find((x) => x.unit === u.id)
      const rem = Math.min(t.cur.remainDays, days)
      const soon = t.cur.remainDays < 2
      return `<div class="gt-row"><span class="gt-id">${u.id}</span><span class="gt-track">
        <i class="gt-cur${soon ? " soon" : ""}" style="width:${(rem / days) * 100}%"></i>
        ${t.cur.remainDays < days ? `<i class="gt-next" style="left:${(rem / days) * 100}%;width:${100 - (rem / days) * 100}%"></i><em style="left:${(rem / days) * 100}%">${t.next.id.split("-")[1]}</em>` : ""}
      </span></div>`
    })
    .join("")
  return card(
    "轮牧计划",
    `<div class="rot2">
      <div class="rot-d">${donut([
        { v: p.grazing, c: C.accent },
        { v: p.resting, c: "#c4d3c6" },
        { v: p.ready, c: C.ok }
      ])}<div class="rot-c"><b>${p.grazing + p.resting + p.ready}</b><span>分区</span></div>
        <ul class="rot-l"><li><i style="background:${C.accent}"></i>放牧中 <b>${p.grazing}</b></li><li><i style="background:#c4d3c6"></i>休牧恢复 <b>${p.resting}</b></li><li><i style="background:${C.ok}"></i>待牧 <b>${p.ready}</b></li></ul></div>
      <div class="gantt"><div class="gt-axis"><span></span>${Array.from({ length: days + 1 }, (_, k) => `<b style="left:${(k / days) * 100}%">${k ? `+${k}` : "今"}</b>`).join("")}</div>${rows}</div>
    </div>`,
    "rotation",
    `<span class="hint">未来 7 天转场 · 数字为下一块分区</span>`
  )
}

function weatherCard(state) {
  const w = state.weather
  const W = 250
  const H = 70
  const now = state.t.hours
  const tlo = Math.min(...w.hourly.map((x) => x.temp)) - 1
  const thi = Math.max(...w.hourly.map((x) => x.temp)) + 1
  const xs = (h) => 6 + (h / 23) * (W - 12)
  const ys = (v) => 6 + (1 - (v - tlo) / (thi - tlo)) * (H - 24)
  const line = w.hourly.map((x, i) => `${i ? "L" : "M"}${xs(x.h).toFixed(1)},${ys(x.temp).toFixed(1)}`).join(" ")
  const bars = w.hourly.map((x) => `<rect x="${xs(x.h) - 3}" y="${H - 14 - (x.rain / 100) * 26}" width="6" height="${(x.rain / 100) * 26}" fill="#2b7bd6" opacity="0.35"/>`).join("")
  return card(
    "牧区气象",
    `<div class="wx2">
      <div class="wx-now"><b>${w.temp}<small>℃</small></b><span>${w.sky} · ${w.wind}</span><span>今日 ${w.lo}–${w.hi}℃</span></div>
      <svg viewBox="0 0 ${W} ${H}" class="wx-chart">${bars}<path d="${line}" fill="none" stroke="#f08c2e" stroke-width="2"/>
        <line x1="${xs(now)}" x2="${xs(now)}" y1="2" y2="${H - 14}" stroke="${C.ink}" stroke-dasharray="2 3" opacity="0.5"/>
        ${[0, 6, 12, 18, 23].map((h) => `<text x="${xs(h)}" y="${H - 2}" class="tick" text-anchor="middle">${h}时</text>`).join("")}</svg>
    </div>
    <div class="wx-next">${w.next.map((n) => `<span><b>${n.date}</b><i>${n.sky}</i><em>${n.lo}–${n.hi}℃</em></span>`).join("")}<span class="rain"><i></i>柱：降水概率</span></div>`,
    "weather"
  )
}

// ---------------- 右栏 ----------------

function alarmCard(a, layout) {
  if (!a) return ""
  const t = alarmText(a, layout)
  return `<section class="card alarm">
    <header><h3><i class="dot"></i>${a.title}</h3><span class="lv">${LEVEL[a.level]}</span></header>
    <figure class="closeup"><img src="./design/closeup-a.png" alt=""/><figcaption>联动近景 · ${a.target}</figcaption><span class="live">LIVE · CAM</span></figure>
    <p class="what">${t.what}</p>
    <dl><dt>位置</dt><dd>${t.where}</dd><dt>发生</dt><dd>${hm(a.start)}</dd><dt>派给</dt><dd>放牧员 ${a.herder}</dd><dt>距离</dt><dd>放牧员 1.2 km · 约 6 分钟</dd></dl>
    ${stepper(a.stage)}
    <div class="acts"><span class="pri">查看视频</span><span>轨迹回放</span><span>电话放牧员</span><span>关闭告警</span></div>
  </section>`
}

function alarmStats(d, state) {
  const kinds = ["fence", "stray", "water", "battery", "offline"]
  const cnt = Object.fromEntries(kinds.map((k) => [k, d.events.filter((e) => e.kind === k).length]))
  const hours = Array.from({ length: 24 }, (_, h) => d.events.filter((e) => Math.floor(e.start) === h).length)
  const max = Math.max(...hours, 1)
  const now = Math.floor(state.t.hours)
  return card(
    "告警统计",
    `<div class="ast">
      <div class="ast-d">${donut(kinds.map((k) => ({ v: cnt[k], c: KIND_COLOR[k] })), 28, 10)}<div class="ast-c"><b>${d.events.length}</b><span>今日</span></div></div>
      <ul class="ast-l">${kinds.map((k) => `<li><i style="background:${KIND_COLOR[k]}"></i>${KIND_NAME[k]}<b>${cnt[k]}</b></li>`).join("")}</ul>
      <div class="ast-h">${hours.map((n, h) => `<i class="${h > now ? "fut" : ""}" style="height:${(n / max) * 100}%"></i>`).join("")}
        <div class="ast-x"><span>0时</span><span>6</span><span>12</span><span>18</span><span>24</span></div></div>
    </div>
    <ul class="events mini">${d.events
      .slice(0, 2)
      .map(
        (e) => `<li class="lv-${e.level}${e.stage === "resolved" ? " done" : ""}"><i>${KIND_ICON[e.kind]}</i><span class="ev-t">${e.title}</span><span class="ev-o">${e.target}</span><span class="ev-h">${hm(e.start)}</span><span class="ev-s">${STAGE[e.stage]}</span></li>`
      )
      .join("")}</ul>`,
    "astats"
  )
}

function herdsCard(state) {
  return card(
    "畜群动态",
    `<table class="herds"><thead><tr><th>畜群</th><th>头数</th><th>分区</th><th>状态</th><th>今日行走</th><th>在线</th></tr></thead><tbody>${state.herds
      .map((h) => {
        const n = h.kind === "sheep" ? 3 : h.head
        const off = state.collars.stale.filter((c) => c.herd === h.id).length
        return `<tr><td><i class="hk ${h.kind}"></i>${h.id}</td><td>${fmt(h.head)}</td><td>${h.paddock}</td><td><em class="act ${h.activity}">${ACT[h.activity]}</em></td><td>${h.walkKm.toFixed(1)} km</td><td>${n - off}/${n}</td></tr>`
      })
      .join("")}</tbody></table>`,
    "herds",
    `<span class="hint">羊按群（头羊项圈）· 牛到单头</span>`
  )
}

function opsCard(state) {
  const w = state.weigh
  const st = { done: "已完成", doing: "进行中", todo: "未开始" }
  return card(
    "生产作业",
    `<ul class="ops">${state.ops
      .map((o) => {
        const pct = o.total ? (o.done / o.total) * 100 : 0
        const val = o.unit ? `${fmt(o.done)} / ${fmt(o.total)} ${o.unit}` : st[o.state]
        return `<li class="${o.state}"><span class="op-n">${o.name}</span><span class="op-d">${o.from}–${o.to}</span><span class="op-b"><i style="width:${o.state === "done" ? 100 : pct}%"></i></span><span class="op-v">${val}</span></li>`
      })
      .join("")}</ul>
    <div class="weigh"><div><span>称重通道 WS-01 · 羔羊日增重</span><b>${w.lamb[w.lamb.length - 1]}<small>g/天</small></b><em>今日过秤 ${w.count} 只</em></div>${spark(w.lamb, 150, 34, C.ok)}</div>`,
    "ops"
  )
}

/** 称重通道 WS-01：近 7 天羔羊、育肥牛的平均日增重 */
function weighCard(state) {
  const w = state.weigh
  const last = (a) => a[a.length - 1]
  return card(
    "称重日增重",
    `<div class="wg">
      <div class="wg-i"><span>羔羊</span><b>${last(w.lamb)}<small>g/天</small></b>${spark(w.lamb, 110, 30, C.ok)}</div>
      <div class="wg-i"><span>育肥牛</span><b>${last(w.steer).toFixed(2)}<small>kg/天</small></b>${spark(w.steer, 110, 30, "#c08a5a")}</div>
    </div>
    <div class="wg-x">${w.days.map((d) => `<span>${d}</span>`).join("")}</div>`,
    "weighcard",
    `<span class="hint">称重通道 WS-01 · 今日过秤 ${w.count} 只</span>`
  )
}

/** 视频监控：场部与饮水点的 360° 摄像头（画面为近景概念图裁切，示意） */
function videoCard(state, layout, alarm) {
  const t = state.t.hms
  const cams = [
    { id: "CAM-01", at: "场部 HQ-01", img: "a", pos: "18% 22%" },
    { id: "CAM-08", at: alarm?.kind === "fence" ? "越界现场 · U10-1" : "饮水点 WP-14", img: "b", pos: "70% 30%", alarm: alarm?.kind === "fence" },
    { id: "CAM-05", at: "饮水点 WP-05", img: "a", pos: "50% 62%" },
    { id: "CAM-06", at: "饮水点 WP-08", img: "b", pos: "28% 70%" }
  ]
  return card(
    "视频监控",
    `<div class="vids">${cams
      .map(
        (c) => `<figure class="vid${c.alarm ? " al" : ""}"><img src="./design/closeup-${c.img}.png" style="object-position:${c.pos}" alt=""/>
          <figcaption><b>${c.id}</b>${c.at}</figcaption><span class="rec">● ${t}</span></figure>`
      )
      .join("")}</div>`,
    "video",
    `<span class="hint">在线 ${layout.cameras.length}/${layout.cameras.length} · 画面为示意</span>`
  )
}

// ---------------- 底部 ----------------

function stockCard(state) {
  const s = state.stock
  const bar = (parts, total) =>
    `<div class="stk-bar">${parts.map((p) => `<i style="flex:${p.v};background:${p.c}" title="${p.n}"></i>`).join("")}</div>
     <div class="stk-l">${parts.map((p) => `<span><b style="background:${p.c}"></b>${p.n} <em>${fmt(p.v)}</em></span>`).join("")}<span class="tot">${fmt(total)}</span></div>`
  const sheep = [
    { n: "基础母羊", v: s.sheep.ewe, c: "#2f8f4e" },
    { n: "种公羊", v: s.sheep.ram, c: "#1f3a2b" },
    { n: "育成羊", v: s.sheep.young, c: "#7fbf7a" },
    { n: "当年羔羊", v: s.sheep.lamb, c: "#c9e3b5" }
  ]
  const cattle = [
    { n: "基础母牛", v: s.cattle.cow, c: "#8a5a3a" },
    { n: "种公牛", v: s.cattle.bull, c: "#4a2f1f" },
    { n: "育肥牛", v: s.cattle.steer, c: "#c08a5a" },
    { n: "犊牛", v: s.cattle.calf, c: "#e8c9a6" }
  ]
  return card(
    "存栏结构",
    `<div class="stk"><span class="stk-k">羊</span>${bar(sheep, sheep.reduce((a, p) => a + p.v, 0))}</div>
     <div class="stk"><span class="stk-k">牛</span>${bar(cattle, cattle.reduce((a, p) => a + p.v, 0))}</div>`,
    "stock",
    `<span class="hint">冬羔配种 ${fmt(state.ops.find((o) => o.id === "breed").done)} / ${fmt(state.ops.find((o) => o.id === "breed").total)} 只母羊</span>`
  )
}

function waterDock(state, hours) {
  const sup = hours.map((s) => s.ranch.suppliedM3)
  return card(
    "饮水点",
    `<div class="wd">
      <div class="wgrid">${state.water
        .map((w) => {
          const bad = w.pump === "fault" || w.level < 20
          return `<div class="wp${bad ? " bad" : ""}"><span class="wl"><i style="height:${w.level}%"></i></span><b>${w.id.slice(3)}</b></div>`
        })
        .join("")}</div>
      <div class="wd-s"><span>供水</span><b>${state.ranch.suppliedM3.toFixed(1)}<small>m³</small></b>${spark(sup, 92, 26)}</div>
    </div>`,
    "water",
    `<span class="hint">液位低于 20% 告警</span>`
  )
}

function deviceCard(state, layout) {
  const pumps = state.water.reduce((a, w) => ((a[w.pump] = (a[w.pump] || 0) + 1), a), {})
  const tile = (n, v, sub, cls = "") => `<div class="dv ${cls}"><span>${n}</span><b>${v}</b><em>${sub}</em></div>`
  return card(
    "设备在线",
    `<div class="dvs">
      ${tile("项圈", `${state.collars.online}/${state.collars.total}`, `低电 ${state.collars.lowBattery} · 离线 ${state.collars.total - state.collars.online}`)}
      ${tile("中继基站", `${layout.stations.length}/${layout.stations.length}`, "太阳能 · LoRa")}
      ${tile("摄像头", `${layout.cameras.length}/${layout.cameras.length}`, "360° 全景")}
      ${tile("提水泵", `${(pumps.run || 0) + (pumps.stop || 0)}/${state.water.length}`, `运行 ${pumps.run || 0} · 故障 ${pumps.fault || 0}`, pumps.fault ? "bad" : "")}
    </div>`,
    "devices"
  )
}

function mapTools(state) {
  const months = [4, 5, 6, 7, 8, 9, 10]
  return `<div class="maptools">
      <div class="mt-g"><span class="mt-k">图层</span><span class="on">长势</span><span>轮牧</span><span>畜群</span><span>设备</span><span>热力</span></div>
      <div class="mt-g"><span class="mt-k">视角</span><span class="on">全景</span><span>巡游</span><span>二维</span></div>
      <div class="mt-g"><span class="mt-k">工具</span><span>测距</span><span>圈选</span></div>
    </div>
    <div class="monthbar"><span class="mb-k">长势月份</span>${months.map((m) => `<span class="${m === state.t.month ? "on" : ""}">${m}月</span>`).join("")}
      <span class="play">▶ 播放</span><div class="ramp"><i></i><span>NDVI 0.2</span><span>0.5</span><span>0.8</span></div></div>`
}

export function buildUiA2(state, layout, alarm, sim, ms) {
  const d = derive(state, layout)
  const hours = hourly(sim, ms, state)
  return `${topbar(state, d, hours)}
    <aside class="col left">${balanceCard(d, state)}${ndviCard(d, state, layout)}${rotationCard(d, state)}${weatherCard(state)}${weighCard(state)}</aside>
    <aside class="col right">${alarmCard(alarm, layout)}${alarmStats(d, state)}${herdsCard(state)}${videoCard(state, layout, alarm)}</aside>
    <div class="dock">${stockCard(state)}${opsCard(state)}${waterDock(state, hours)}${deviceCard(state, layout)}</div>
    ${mapTools(state)}`
}

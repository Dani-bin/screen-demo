/*
 * 智慧牧场 页面共用的格式化与数据整理（面板组件用）
 * 和设计稿 docs/design/smart-ranch/drafts-ui.js 的 derive 一致：汇总值从明细算
 */
import { NDVI_RAMP } from "./scene/theme.js"

export const fmt = (v, d = 0) =>
  Number(v).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  })

/** 带正负号（负号用全角减号，和设计稿一致） */
export const sign = (v, d = 1) =>
  (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v), d)

/** 小时（带小数）→ HH:MM */
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
export const KIND_NAME = {
  fence: "越界",
  stray: "离群",
  water: "饮水点",
  battery: "低电量",
  offline: "离线"
}
export const KIND_COLOR = {
  fence: "#e5484d",
  stray: "#f08c2e",
  water: "#2b7bd6",
  battery: "#c9a227",
  offline: "#93a5b5"
}

/** 配色（晴空牧场） */
export const PAL = {
  ok: "#2f8f4e",
  bad: "#e5484d",
  ink: "#1f3a2b",
  accent: "#2b7bd6",
  muted: "#93a5b5",
  paper: "#ffffff",
  rest: "#c4d3c6",
  orange: "#f08c2e"
}

/** NDVI → 色带颜色（和地表着色器同一条色带） */
export function rampColor(v) {
  const stops = NDVI_RAMP.map(([x, h]) => [
    x,
    [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  ])
  if (v <= stops[0][0]) return `rgb(${stops[0][1]})`
  for (let i = 1; i < stops.length; i++) {
    const [x0, c0] = stops[i - 1]
    const [x1, c1] = stops[i]
    if (v <= x1) {
      const t = (v - x0) / (x1 - x0)
      return `rgb(${c0.map((c, k) => Math.round(c + (c1[k] - c) * t))})`
    }
  }
  return `rgb(${stops[stops.length - 1][1]})`
}

/** 全场逐月 NDVI（按分区面积加权，真实数据） */
export function ndviSeries(layout) {
  const area = layout.paddocks.reduce((s, p) => s + p.areaMu, 0)
  const series = (year) =>
    layout.ndvi.months.map(
      (_, i) =>
        layout.paddocks.reduce((s, p) => s + p.areaMu * p.ndvi[year][i], 0) /
        area
    )
  return {
    months: layout.ndvi.months,
    y26: series("2026"),
    y25: series("2025")
  }
}

/** 转场：每个单元当前分区剩余天数和下一块分区（按 1→2→3→4 轮转），剩余天数少的排前 */
export function transfers(state) {
  const byId = new Map(state.paddocks.map((p) => [p.id, p]))
  return state.units
    .map((u) => {
      const cur = byId.get(u.grazing)
      const k = Number(u.grazing.split("-")[1])
      const next = byId.get(`${u.id}-${(k % 4) + 1}`)
      return { unit: u.id, herd: u.herd, cur, next }
    })
    .sort((a, b) => a.cur.remainDays - b.cur.remainDays)
}

/** 当前要联动的告警：越界 > 离群 > 饮水点 > 其它；给出位置和所在分区 */
export function pickAlarm(state, layout, events = state.events.active) {
  const order = ["fence", "stray", "water", "offline", "battery"]
  const ev = [...events].sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.start - a.start
  )[0]
  return ev ? locateEvent(ev, state, layout) : null
}

/** 事件 → 位置（沙盘坐标）、所在分区、离群时羊群中心 */
export function locateEvent(ev, state, layout) {
  const h = state.herds.find((x) => x.id === ev.herd)
  if (ev.kind === "fence" && h)
    return { ...ev, pos: h.cows[ev.cow], paddock: h.paddock }
  if (ev.kind === "stray" && h) {
    const lead = h.leads.find((l) => l.id === ev.target)
    return { ...ev, pos: lead.pos, paddock: h.paddock, from: h.pos }
  }
  if (ev.kind === "water")
    return { ...ev, pos: layout.water.find((w) => w.id === ev.target).pos }
  return { ...ev, pos: h ? h.pos : [0, 0], paddock: h?.paddock }
}

/** 告警的文字描述 */
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
    return {
      what: `${a.target} 水罐液位低于 20%，提水泵故障`,
      where: a.target
    }
  if (a.kind === "battery")
    return { what: `${a.target} 电量低于 15%，请安排换电`, where: a.herd }
  return { what: `${a.target} 超过 2 小时未上报`, where: a.herd }
}

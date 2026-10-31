/**
 * 楼盘沙盘：销售数据与小工具
 * ----------------------------------------------------------
 * 销售数据来自 data/sales.json（scripts/estate/mock.mjs 生成，7 天的逐栋快照，取最后一天）。
 * 全盘汇总值从各栋明细算出，口径和 docs/design/estate/mock/rules.json 一致：
 * 去化率 = 已售 ÷ 总户数（按户数加权，不是各栋去化率的平均）。
 */
import sales from "./data/sales.json"

export const STATE_NAME = { open: "可售", hot: "热销", out: "售罄" }

/** 销售状态分档：去化 ≥ 50% 热销，≥ 95% 售罄，其余可售 */
export const stateOf = (rate) =>
  rate >= 0.95 ? "out" : rate >= 0.5 ? "hot" : "open"

const LAST = sales.days.length - 1

/** 某栋最新的销售情况 */
export function saleOf(id) {
  const b = sales.buildings[id]
  if (!b) return null
  const sold = b.sold[LAST]
  const reserved = b.reserved[LAST]
  const rate = sold / b.units
  return {
    units: b.units,
    sold,
    reserved,
    open: b.units - sold - reserved,
    rate,
    state: stateOf(rate)
  }
}

/** 全盘汇总：从各栋明细算 */
export function totalSales() {
  let units = 0
  let sold = 0
  let reserved = 0
  for (const id of Object.keys(sales.buildings)) {
    const s = saleOf(id)
    units += s.units
    sold += s.sold
    reserved += s.reserved
  }
  return { units, sold, reserved, rate: sold / units, at: sales.at }
}

/** 各销售状态的栋数（图例用） */
export function stateCounts() {
  const c = { open: 0, hot: 0, out: 0 }
  for (const id of Object.keys(sales.buildings)) c[saleOf(id).state]++
  return c
}

/** 千分位 */
export const fmt = (n) => n.toLocaleString("en-US")

const WEEK = "日一二三四五六"
/** 日期的中文显示 */
export function dateLabel(month, day, year = 2026) {
  const w = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return `${month} 月 ${day} 日 周${WEEK[w]}`
}

/**
 * 解析 ?at=2026-10-30T18:00 这类时刻：返回 { month, day, hour }；解析不了返回默认
 */
export function parseAt(s, fallback = { month: 10, day: 30, hour: 18 }) {
  const m = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s ?? "")
  if (!m) return fallback
  return { month: +m[2], day: +m[3], hour: +m[4] + +m[5] / 60 }
}

/*
 * 无人机巡检监控平台 · 页面小工具（各页面独立维护，不和其他页面共享）
 */

/**
 * 设计稿 px → rem（页面按 amfe-flexible 的 1rem = 屏宽 / 10 等比缩放，设计稿宽 1920）。
 * 模板里的内联样式不经过 postcss-pxtorem，需要手动换算
 */
export const rem = (px) => `${px / 192}rem`

export const pad = (n) => String(n).padStart(2, "0")

/** 时间戳 → 北京时间 HH:mm(:ss)（园区在东八区，和浏览器所在时区无关） */
export function hms(t, sec = true) {
  const d = new Date(t + 8 * 3600e3)
  return (
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` +
    (sec ? `:${pad(d.getUTCSeconds())}` : "")
  )
}

/** 时间戳 → 北京时间日期 YYYY-MM-DD */
export const dateOf = (t) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10)

/** 星期几（北京时间） */
export const weekday = (t) =>
  "日一二三四五六"[new Date(t + 8 * 3600e3).getUTCDay()]

/** 秒数 → mm:ss */
export const mmss = (s) =>
  `${pad(Math.floor(Math.max(0, s) / 60))}:${pad(Math.floor(Math.max(0, s) % 60))}`

/** 风向（来向，度）→ 汉字方位 */
export const compass = (deg) =>
  ["北", "东北", "东", "东南", "南", "西南", "西", "西北"][
    Math.round(deg / 45) % 8
  ]

/** 百分比整数 */
export const pct = (x) => Math.round(x * 100)

/** 千分位：52000 → "52,000" */
export const thousands = (n) => Number(n).toLocaleString("en-US")

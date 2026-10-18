/*
 * 智能矿山 页面小工具（各页面独立维护）
 */

/** 千分位：12345 → "12,345" */
export const fmt = (n, digits = 0) =>
  Number(n).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })

/**
 * 设计稿 px → rem（页面按 amfe-flexible 的 1rem = 屏宽 / 10 等比缩放，设计稿宽 1920）。
 * 模板里的内联样式不经过 postcss-pxtorem，需要手动换算
 */
export const rem = (px) => `${px / 192}rem`

/** 状态 → 颜色 / 文字 */
export const STATUS = {
  ok: { c: "#3ddc97", t: "正常" },
  warn: { c: "#ffcf3a", t: "预警" },
  alarm: { c: "#ff4d5a", t: "报警" },
  info: { c: "#4c9dff", t: "提示" }
}

/*
 * 智慧充电站 页面小工具
 */

/** 千分位整数：12345 → "12,345" */
export const fmt = (n, digits = 0) =>
  Number(n).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })

/** 百分比：0.789 → "78.9" */
export const pct = (k, digits = 1) => (k * 100).toFixed(digits)

/**
 * 设计稿 px → rem（页面按 amfe-flexible 的 1rem = 屏宽 / 10 等比缩放，设计稿宽 1920）。
 * 模板里的内联样式不经过 postcss-pxtorem，需要手动换算
 */
export const rem = (px) => `${px / 192}rem`

/**
 * 24 小时曲线 → SVG path。xs / ys 为坐标换算函数，values 为等间隔采样（i / step 小时）
 */
export function linePath(values, xs, ys, from = 0, to = values.length - 1) {
  let d = ""
  for (let i = from; i <= to; i++)
    d += `${i === from ? "M" : "L"}${xs(i).toFixed(1)},${ys(values[i]).toFixed(1)}`
  return d
}

/*
 * 面板共用的格式化小工具
 */

/** 千分位 + 固定小数位 */
export const fmt = (n, d = 0) =>
  Number(n).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  })

/** 比例 → 百分数 */
export const pct = (r, d = 0) => fmt(r * 100, d)

/** 告警级别文字 */
export const LV = { 1: "一级", 2: "二级", 3: "三级", 4: "四级" }

/**
 * 图表悬停的小工具（手写 SVG 图表共用）
 * 舞台是整体 transform: scale 缩放的，鼠标的 offsetX 不可靠，这里用 SVG 的屏幕矩形换算回 viewBox 坐标。
 */

/** 鼠标事件在所在 SVG 里的横坐标（viewBox 坐标系，宽度为 W） */
export function svgX(e, W) {
  const svg = e.currentTarget.closest("svg")
  const r = svg.getBoundingClientRect()
  return ((e.clientX - r.left) / r.width) * W
}

/** 千分位整数，用于提示框里的吨数 */
export const int = (x) => Math.round(x).toLocaleString("en-US")

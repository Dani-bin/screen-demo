/*
 * 老家沙盘 页面小工具（各页面独立维护）
 */

/**
 * 设计稿 px → rem（页面按 amfe-flexible 的 1rem = 屏宽 / 10 等比缩放，设计稿宽 1920）。
 * 模板里的内联样式不经过 postcss-pxtorem，需要手动换算
 */
export const rem = (px) => `${px / 192}rem`

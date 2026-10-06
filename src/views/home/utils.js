/*
 * 首页公共小工具：预览图地址、主题色透明度、序号补零
 */

/**
 * 预览图地址：demos.js 里写相对 public/ 的路径，这里拼上 BASE_URL
 * （生产环境部署在 /bi/ 下）；以 / 或 http(s) 开头的地址原样使用
 */
export const previewUrl = (src) => {
  if (!src) return ""
  if (/^(\/|https?:)/.test(src)) return src
  return `${import.meta.env.BASE_URL}${src}`
}

/**
 * 十六进制主题色转 rgba。
 * 用透明度代替 CSS color-mix()：大屏终端的浏览器内核可能较旧，不一定支持 color-mix
 */
export const alpha = (hex, a) => {
  const v = hex.replace("#", "")
  const n = parseInt(v.length === 3 ? v.replace(/./g, "$&$&") : v, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

/** 两位补零：1 → "01"，用于序号与时钟 */
export const pad2 = (n) => String(n).padStart(2, "0")

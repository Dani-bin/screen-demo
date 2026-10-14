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

/** 筛选标签里「全部」的取值 */
export const ALL = "全部"

/**
 * 按 category 生成筛选标签：首项为「全部」，其余按首次出现的顺序排列，各带数量
 * @returns {{ name: string, count: number }[]}
 */
export const categoriesOf = (demos) => {
  const counts = new Map()
  for (const d of demos)
    counts.set(d.category, (counts.get(d.category) || 0) + 1)
  return [
    { name: ALL, count: demos.length },
    ...[...counts].map(([name, count]) => ({ name, count }))
  ]
}

/** 按分类与关键词过滤（关键词匹配名称、英文名、副标题、简介、标签，不区分大小写） */
export const filterDemos = (demos, category, keyword = "") => {
  const kw = keyword.trim().toLowerCase()
  return demos.filter((d) => {
    if (category !== ALL && d.category !== category) return false
    if (!kw) return true
    return [d.name, d.en, d.subTitle, d.desc, ...d.tags]
      .join(" ")
      .toLowerCase()
      .includes(kw)
  })
}

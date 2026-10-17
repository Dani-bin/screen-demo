/*
 * 候诊大厅 · 页面小工具（不依赖 Vue / three.js）
 */

const pad = (n) => String(n).padStart(2, "0")

/** 毫秒时间戳 → "09:42" */
export const hm = (t) => {
  const d = new Date(t)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 毫秒时间戳 → "09:42:18" */
export const hms = (t) => `${hm(t)}:${pad(new Date(t).getSeconds())}`

/** 时长（毫秒）→ "06:31"（分:秒，超过 1 小时也只按分钟累计） */
export const mmss = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

/** 就诊超过这个时长（毫秒）提醒 */
export const OVERTIME = 15 * 60 * 1000

/** 叫号词：念号码和诊室，不念脱敏后的名字（"张*明"念出来不自然） */
export const callText = (no, room) => `请 ${no} 号，到 ${room} 诊室就诊`

/*
 * 院内导航 · 页面小工具（不依赖 Vue / three.js）
 */

/** 分步提示 → 导视图标名（与设计稿 draft.py 的 step_icon 一致） */
export function stepIcon(s) {
  if (s.kind === "escalator" || s.kind === "elevator") return s.kind
  if (s.kind === "stair") return "stairs"
  if (s.kind === "start") return "start"
  if (s.kind === "end") return "end"
  if (s.kind === "hint") {
    // "中庭扶梯在右手边"这类提示：用对应交通设施的图标
    if (s.text.includes("扶梯")) return "escalator"
    if (s.text.includes("电梯")) return "elevator"
    if (s.text.includes("楼梯")) return "stairs"
  }
  if (s.text.startsWith("左转") || s.text.includes("后左转")) return "left"
  if (s.text.startsWith("右转") || s.text.includes("后右转")) return "right"
  return "straight"
}

/** 秒 → 约几分钟（最少 1 分钟） */
export const minutes = (sec) => Math.max(1, Math.ceil(sec / 60))

/** 把"乘中庭扶梯上到 3F（到 2F 后掉头换乘）"拆成主句和括号里的补充 */
export function splitNote(text) {
  const i = text.indexOf("（")
  if (i < 0 || !text.endsWith("）")) return [text, ""]
  return [text.slice(0, i), text.slice(i + 1, -1)]
}

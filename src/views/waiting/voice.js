/*
 * 候诊大厅 · 叫号提示音 + 语音播报（浏览器自带，不依赖外部服务）
 * ----------------------------------------------------------
 * 浏览器不允许页面自己出声：必须在用户点击（开启语音）时先 unlock() 一次，
 * 之后 announce() 才有声音。默认静音，由页面右上角的开关控制。
 */
let ctx = null

/** 在用户手势里调用：创建 / 恢复 AudioContext */
export function unlock() {
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return
  if (!ctx) ctx = new AC()
  if (ctx.state === "suspended") ctx.resume()
}

/** "叮——咚" 两声（E5 → C5，正弦波 + 指数衰减） */
function chime() {
  if (!ctx) return
  const t = ctx.currentTime
  for (const [f, d] of [
    [659.25, 0],
    [523.25, 0.34]
  ]) {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = "sine"
    o.frequency.value = f
    g.gain.setValueAtTime(0.0001, t + d)
    g.gain.exponentialRampToValueAtTime(0.32, t + d + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 1.2)
    o.connect(g).connect(ctx.destination)
    o.start(t + d)
    o.stop(t + d + 1.3)
  }
}

/** 中文语音念一句；优先选系统里的中文嗓音 */
function speak(text) {
  const ss = window.speechSynthesis
  if (!ss) return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = "zh-CN"
  u.rate = 0.92
  const v = ss.getVoices().find((x) => x.lang && x.lang.startsWith("zh"))
  if (v) u.voice = v
  ss.speak(u)
}

/** 叫号：先提示音，再念叫号词 */
export function announce(text) {
  chime()
  setTimeout(() => speak(text), 900)
}

/** 关掉语音时清掉还没念完的句子 */
export function silence() {
  window.speechSynthesis?.cancel()
}

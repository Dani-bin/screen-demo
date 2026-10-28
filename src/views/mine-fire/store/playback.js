/*
 * 演练回放时钟：把真实时间换算成剧本秒 s（0–960 循环）
 * ----------------------------------------------------------
 * 演练剧本按真实节奏要 16 分钟，展示时按段变速：平稳段快放，确认 → 喷放的 30 s 倒计时按 1× 实时放，
 * 一轮约 5 分钟。深链 ?at=14:06:18 钉在某一刻（截图比对用）；?speed=1 全程实时。
 */
import { CYCLE } from "../sim/simulator.js"

/** 默认变速曲线：剧本秒 → 倍速 */
function autoSpeed(s) {
  if (s < 95) return 6 // 正常监测、温度缓升
  if (s < 228) return 3 // 一级预警 → 二次信号
  if (s < 292) return 1 // 火灾确认 → 30 s 倒计时 → 喷放，按实时
  if (s < 420) return 2 // 喷放后、撤离前段
  if (s < 900) return 6 // 撤离、复燃监测
  return 3 // 复位
}

/**
 * @param {object} o
 * @param {number|null} o.pinned 钉住的剧本秒（null = 播放）
 * @param {number} [o.start] 不钉住时从哪一秒开始播
 * @param {number|null} [o.speed] 固定倍速（null = 按 autoSpeed 变速）
 */
export function createPlayback({
  pinned = null,
  start = 60,
  speed = null
} = {}) {
  const s = ref(pinned ?? start)
  const playing = ref(pinned === null)
  const fixed = ref(speed)
  let raf = 0
  let last = 0

  function loop(now) {
    raf = requestAnimationFrame(loop)
    if (!last) last = now
    // 切到后台再回来时一帧最多推进 0.25 s，不跳过剧本节点
    const dt = Math.min(0.25, (now - last) / 1000)
    last = now
    if (!playing.value) return
    const k = fixed.value || autoSpeed(s.value)
    s.value = (s.value + dt * k) % CYCLE
  }

  return {
    s,
    playing,
    speed: computed(() => fixed.value || autoSpeed(s.value)),
    start() {
      last = 0
      raf = requestAnimationFrame(loop)
    },
    stop() {
      cancelAnimationFrame(raf)
    },
    toggle() {
      playing.value = !playing.value
    },
    /** 跳到某一秒（暂停与否不变） */
    seek(t) {
      s.value = ((t % CYCLE) + CYCLE) % CYCLE
    },
    restart() {
      s.value = start
      playing.value = true
    },
    setSpeed(v) {
      fixed.value = v
    }
  }
}

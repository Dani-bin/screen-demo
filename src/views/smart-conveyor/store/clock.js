/*
 * 统一时间游标：整屏的面板、三维都从同一个时刻派生
 * ----------------------------------------------------------
 * - 实时：跟随北京时间（Date.now）
 * - 钉住：?at=2026-10-30T21:20 把仿真时钟钉在某一刻（定稿那一刻，截图比对用），面板数字不再变化；
 *   三维的带面滚动、涟漪仍按真实流逝的时间动（只影响画面，不影响数字）
 * - 回放：seek(t) 跳到某一刻，play() 按 60 倍速前进；goLive() 回到实时
 * state 每秒按当前时刻从仿真器算一次（sim.at 约 1–3 ms，缓存段已算好时更快）
 */
export function createClock(sim, { pinned = null } = {}) {
  const live = ref(pinned == null)
  const playing = ref(false)
  const cursor = ref(pinned ?? Date.now())
  const state = shallowRef(sim.at(cursor.value))
  let fixed = pinned
  let flowFrom = performance.now()

  /** 三维用的连续时刻 */
  function now() {
    if (live.value && fixed == null) return Date.now()
    if (fixed != null) return fixed + (performance.now() - flowFrom)
    if (playing.value)
      return cursor.value + Math.min(1000, performance.now() - flowFrom) * 60
    return cursor.value
  }

  function tick() {
    if (fixed != null) cursor.value = fixed
    else if (live.value) cursor.value = Date.now()
    else if (playing.value) cursor.value += 60000
    flowFrom = performance.now()
    state.value = sim.at(cursor.value)
  }

  const timer = setInterval(tick, 1000)

  return {
    live,
    playing,
    cursor,
    state,
    now,
    tick,
    /** 钉住某一刻（截图钩子用） */
    pin(t) {
      fixed = t
      live.value = false
      tick()
    },
    seek(t) {
      fixed = null
      live.value = false
      cursor.value = t
      tick()
    },
    play() {
      playing.value = true
    },
    pause() {
      playing.value = false
    },
    goLive() {
      fixed = null
      playing.value = false
      live.value = true
      tick()
    },
    dispose() {
      clearInterval(timer)
    }
  }
}

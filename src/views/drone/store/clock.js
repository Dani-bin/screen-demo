/*
 * 统一时间游标 + 仿真管理
 * ----------------------------------------------------------
 * 整屏（面板、三维、机载画面、标签）都从 state（stateAt(day, t) 的结果）派生：
 *   - 实时：t 跟着真实时钟走（北京时间），每秒刷新一次 state；
 *   - 回放：拖动时间轴把 t 拨到今天任意时刻；"播放"按 60 倍速往前走，追上现在后回到实时。
 * 跨过零点时自动换一天重新仿真。用户在页面上的操作（派机复核 / 派单 / 判误报）记成
 * actions，整天按操作重新仿真一遍（约 0.1 s），之后的过程就按操作改写。
 *
 * fixed：开发 / 截图时把时钟钉在某一刻（如设计稿那一刻 2026-10-19 14:03），不随真实时间走。
 */

import { shallowRef, ref, computed } from "vue"
import {
  simulateDay,
  stateAt,
  weekCounts,
  dayStartOf
} from "../sim/simulator.js"
import { dateOf } from "../utils.js"

const SEED = "linjiang"

export function createClock({ fixed = null } = {}) {
  // 钉住时"现在"固定为 pinned，否则就是真实时钟
  const frozen = ref(!!fixed)
  const pinned = ref(fixed || 0)
  const nowFn = () => (frozen.value ? pinned.value : Date.now())
  const live = ref(true)
  const cursor = ref(nowFn()) // 当前显示的时刻
  const playing = ref(false)
  const actions = []
  let day = null
  const state = shallowRef(null)
  const week = shallowRef(null)
  const version = ref(0) // 每次重新仿真 +1，三维据此重建航迹

  function ensureDay(t) {
    const date = dateOf(t)
    if (!day || day.date !== date) {
      day = simulateDay({
        seed: SEED,
        date,
        story: true,
        actions: actions.filter((a) => dateOf(a.t) === date)
      })
      week.value = null
      version.value++
    }
    return day
  }

  function refresh() {
    const now = nowFn()
    if (live.value) cursor.value = now
    else if (cursor.value > now) {
      cursor.value = now
      live.value = true
      playing.value = false
    }
    const d = ensureDay(cursor.value)
    state.value = stateAt(d, cursor.value)
    // 近 7 天统计要多仿真 6 整天（约 0.5 s），放到首屏之后再算
    if (!week.value && live.value)
      setTimeout(
        () =>
          (week.value = weekCounts({
            seed: SEED,
            date: d.date,
            upto: state.value
          })),
        0
      )
    else if (week.value)
      week.value = [
        ...week.value.slice(0, 6),
        {
          ...week.value[6],
          counts: countTypes(state.value.events),
          total: state.value.events.length
        }
      ]
  }

  function countTypes(events) {
    const c = {}
    for (const e of events) c[e.type] = (c[e.type] || 0) + 1
    return c
  }

  let timer = setInterval(refresh, 1000)
  let playTimer = null
  refresh()

  return {
    state,
    week,
    cursor,
    live,
    playing,
    version,
    get day() {
      return day
    },
    now: nowFn,
    dayStart: computed(() => dayStartOf(dateOf(cursor.value))),
    /** 拨到今天某一刻（回放）；t ≥ 现在时回到实时 */
    seek(t) {
      const now = nowFn()
      if (t >= now - 1000) return this.goLive()
      live.value = false
      cursor.value = Math.max(dayStartOf(dateOf(now)), t)
      refresh()
    },
    goLive() {
      live.value = true
      this.pause()
      refresh()
    },
    /** 回放播放：60 倍速，每 100 ms 前进 6 s */
    play() {
      if (live.value) return
      playing.value = true
      clearInterval(playTimer)
      playTimer = setInterval(() => {
        cursor.value += 6000
        refresh()
        if (live.value) this.pause()
      }, 100)
    },
    pause() {
      playing.value = false
      clearInterval(playTimer)
    },
    /** 用户操作：只在实时状态下有效，重新仿真当天 */
    act(type, eventId) {
      if (!live.value) return
      actions.push({ t: nowFn(), type, eventId })
      day = null
      refresh()
    },
    /** 截图 / 调试：把"现在"钉在某一刻 */
    pin(t) {
      frozen.value = true
      pinned.value = t
      live.value = true
      day = null
      refresh()
    },
    dispose() {
      clearInterval(timer)
      clearInterval(playTimer)
      timer = null
    }
  }
}

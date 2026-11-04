/**
 * 仿真时钟：页面上"现在是几点"。
 * ----------------------------------------------------------
 * 展会式的页面没有真实时钟可跟（事件和飞行都是 2026-11-04 这一天的剧本），所以自己走：
 *   loop    默认。在走失搜寻那一小时（17:50–18:36）里循环，一遍约 4 分钟，开场很快就能看到三机会合；
 *   story   点了底部的某个剧情：从该剧情开始时刻播放，到点自动回到 loop；
 *   free    点了底部时间线：从点的时刻往后走（想看全天别的时段）；
 *   pinned  ?at=18:06（定稿的一刻）：钉住不走；同时给 ?speed=N 就从该时刻起按 N 走。
 * 速度用"仿真秒 / 真实秒"：loop 12，story 15。
 * 深链：?at=18:06 或 ?at=2026-11-04T18:06；?speed=12；?story=PT 直接进某个剧情。
 */
import { ref } from "vue"
import { hm, STORIES } from "../sim/simulator.js"

export const LOOP = [hm("17:50"), hm("18:36")]
const LOOP_SPEED = 12
const STORY_SPEED = 15

/** 深链里的时刻："18:06" / "2026-11-04T18:06" / "18:06:30" → 分钟 */
function parseAt(v) {
  if (!v) return null
  const s = v.includes("T") ? v.split("T")[1] : v
  return /^\d{1,2}:\d{2}/.test(s) ? hm(s.replace(/[+Z].*$/, "")) : null
}

export function createClock(search = "") {
  const q = new URLSearchParams(search)
  const at = parseAt(q.get("at"))
  const speedQ = q.get("speed") != null ? Number(q.get("speed")) : null

  const t = ref(at ?? LOOP[0])
  const mode = ref(at != null ? (speedQ ? "free" : "pinned") : "loop")
  const story = ref(null) // 当前剧情的 key
  let speed = speedQ ?? LOOP_SPEED // 仿真秒 / 真实秒
  let storyEnd = 0
  let onStoryEnd = null

  /** 推进 dt 真实秒，返回当前时刻（分钟） */
  function advance(dt) {
    if (mode.value === "pinned") return t.value
    t.value += (dt * speed) / 60
    if (mode.value === "loop" && t.value > LOOP[1]) t.value = LOOP[0]
    if (mode.value === "free" && t.value >= 1440) t.value -= 1440
    if (mode.value === "story" && t.value >= storyEnd) {
      const cb = onStoryEnd
      stopStory()
      cb?.()
    }
    return t.value
  }

  /** 播放某个剧情；结束时调 done（自动导览用它接下一段） */
  function startStory(key, done) {
    const s = STORIES.find((x) => x.key === key)
    if (!s) return
    story.value = key
    mode.value = "story"
    speed = STORY_SPEED
    t.value = hm(s.t)
    storyEnd = hm(s.t) + s.dur
    onStoryEnd = done ?? null
  }

  /** 退出剧情，回到循环 */
  function stopStory() {
    story.value = null
    onStoryEnd = null
    mode.value = "loop"
    speed = LOOP_SPEED
    t.value = LOOP[0]
  }

  /** 跳到某时刻往后走；spd 是仿真秒 / 真实秒（缺省 12；录抖音视频的"时间快进"镜头用更大的值） */
  function scrub(min, spd = LOOP_SPEED) {
    story.value = null
    onStoryEnd = null
    mode.value = "free"
    speed = spd
    t.value = min
  }

  return {
    t,
    mode,
    story,
    advance,
    startStory,
    stopStory,
    scrub,
    parseAt,
    initialStory: q.get("story")
  }
}

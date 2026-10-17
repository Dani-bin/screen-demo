<!--
  候诊大厅大屏（××医院 门诊医技综合楼 2F · 内科候诊区，与 /hospital 是同一家虚构医院、同一层楼）
  三维展示 8 间诊室的候诊状态：每间诊室上方三色状态柱（待诊 / 复诊 / 过诊），柱顶标签；
  自动轮播各诊室（每间 8 秒 → 全景 10 秒），新叫号时插播：镜头飞到被叫诊室 6 秒、诊室橙色高亮；
  叫号条常驻显示最近一次叫号，可开语音播报（默认静音）。数据来自 sim/simulator.js（纯模拟）。
  设计稿：docs/design/waiting/13-style-e-candy.png（叫号瞬间）、15-style-e-candy-tour.png（轮播推近）。
  URL 参数：?room=216 锁定看某间诊室（不自动恢复轮播）、?tour=0 只看全景、?voice=1 打开语音开关
-->
<template>
  <div class="waiting" @pointerdown="touch">
    <header class="top">
      <div class="info">
        <p>门诊医技综合楼 2F</p>
        <span>{{ snap.session }} · 8 个诊室</span>
      </div>
      <h1>
        <i class="beads"
          ><b v-for="c in BEADS" :key="c" :style="{ background: c }"></b
        ></i>
        ××医院 · 内科候诊区
        <i class="beads"
          ><b v-for="c in BEADS" :key="c" :style="{ background: c }"></b
        ></i>
      </h1>
      <div class="right">
        <button class="voice" :class="{ on: voiceOn }" @click="toggleVoice">
          <SpeakerIcon :muted="!voiceOn" />
          {{ voiceOn ? "语音已开启" : "语音已关闭" }}
        </button>
        <span class="date">{{ dateText }}</span>
        <b class="clock">{{ hms(snap.now) }}</b>
      </div>
    </header>

    <OverviewCard :totals="snap.totals" :trend="snap.trend" :now="snap.now" />
    <RoomList
      :rooms="snap.rooms"
      :now="snap.now"
      :focus-no="labelFocus"
      @pick="lock"
    />
    <CallBanner
      :call="lastCall"
      :room="lastCall ? roomByNo[lastCall.room] : null"
    />

    <!-- 中央三维场景 + 状态柱顶标签（DOM，跟随三维锚点） -->
    <div ref="stage" class="stage">
      <canvas ref="canvas"></canvas>
      <div class="labels">
        <template v-for="a in anchors" :key="a.no">
          <div
            v-if="roomByNo[a.no]"
            class="label"
            :class="labelClass(roomByNo[a.no])"
            :style="{ left: `${a.x}px`, top: `${a.y}px` }"
            @click="lock(a.no)"
          >
            <span v-if="roomByNo[a.no].state === 'calling'" class="chip"
              >叫号中</span
            >
            <template
              v-if="a.no === labelFocus && roomByNo[a.no].state !== 'calling'"
            >
              <p class="t">
                <b>{{ a.no }}</b
                ><small>{{ roomByNo[a.no].short }}</small>
              </p>
              <p class="s">
                {{
                  roomByNo[a.no].state === "consulting"
                    ? `就诊中 ${mmss(snap.now - roomByNo[a.no].startAt)}`
                    : "等待叫号"
                }}
              </p>
              <p class="c">
                待<b>{{ roomByNo[a.no].waiting.length }}</b
                >复<b>{{ roomByNo[a.no].recheck.length }}</b
                >过<b>{{ roomByNo[a.no].missed.length }}</b>
              </p>
            </template>
            <template v-else>
              <b class="n">{{ a.no }}</b>
              <p class="c3">
                <i class="w">{{ roomByNo[a.no].waiting.length }}</i>
                <i class="r">{{ roomByNo[a.no].recheck.length }}</i>
                <i class="m">{{ roomByNo[a.no].missed.length }}</i>
              </p>
            </template>
          </div>
        </template>
      </div>
      <!-- 图例：竖排放在右上角（全景时那里是西侧辅助用房的上空，没有状态柱） -->
      <div v-show="tour.mode === 'overview'" class="legend">
        <span><i class="m"></i>过诊</span>
        <span><i class="r"></i>复诊</span>
        <span><i class="w"></i>待诊</span>
        <span><i class="c"></i>叫号中</span>
        <em>柱高 = 人数</em>
      </div>
      <!-- 推近（轮播 / 插播 / 锁定）时显示：点了解除锁定、拉回全景，30 秒无操作再恢复自动轮播 -->
      <button
        v-show="tour.mode !== 'overview'"
        class="overview-btn"
        :class="{ locked: tour.mode === 'lock' }"
        @click="showOverview"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        {{ tour.mode === "lock" ? "解除锁定 · 看全景" : "看全景" }}
      </button>
    </div>

    <RecentCalls :calls="snap.calls.slice(0, 4)" />
    <MissedBoard :items="snap.missedBoard" />
    <RoomDetail
      v-if="detailRoom"
      :room="detailRoom"
      :now="snap.now"
      :session="snap.session"
      :mode="tour.manual && tour.mode === 'overview' ? 'free' : tour.mode"
      :index="
        tour.mode === 'tour' ? tour.index : ROOM_NOS.indexOf(detailRoom.no)
      "
      :total="ROOM_NOS.length"
      :remain="Math.max(0, Math.ceil((tour.until - snap.now) / 1000))"
    />

    <!-- scene-loading：首页预览截图脚本据此判断场景是否就绪 -->
    <div v-if="loading" class="loading scene-loading">正在布置候诊大厅…</div>
  </div>
</template>

<script setup>
  import OverviewCard from "./components/OverviewCard.vue"
  import RoomList from "./components/RoomList.vue"
  import CallBanner from "./components/CallBanner.vue"
  import RecentCalls from "./components/RecentCalls.vue"
  import MissedBoard from "./components/MissedBoard.vue"
  import RoomDetail from "./components/RoomDetail.vue"
  import SpeakerIcon from "./components/SpeakerIcon.vue"
  import { WaitingScene } from "./scene/WaitingScene"
  import { THEME } from "./scene/theme"
  import { createSimulator } from "./sim/simulator"
  import { ROOMS } from "./data/rooms"
  import { callText, hms, mmss } from "./utils"
  import { announce, silence, unlock } from "./voice"

  const ROOM_NOS = ROOMS.map((r) => r.no)
  const OVERVIEW = ROOM_NOS.length // 轮播序列：0–7 各诊室，8 = 全景
  const T = THEME.tour
  const BEADS = ["#FFE27A", "#9EE6C0", "#9CCBFF", "#FFA8A0"]

  const stage = ref(null)
  const canvas = ref(null)
  const loading = ref(true)
  const anchors = shallowRef([])
  const voiceOn = ref(false)

  // ---------- 模拟器：每 0.5 秒推进到真实时刻，取一份快照
  const sim = createSimulator({ now: Date.now() })
  const snap = shallowRef(sim.snapshot())
  const roomByNo = computed(() =>
    Object.fromEntries(snap.value.rooms.map((r) => [r.no, r]))
  )
  const lastCall = computed(() => snap.value.calls[0] || null)
  let scene = null

  // ---------- 轮播：mode = tour（逐间 8 秒）/ overview（全景 10 秒）/ call（叫号插播 6 秒）/ lock（手动锁定）
  const tour = reactive({
    mode: "tour",
    index: 0,
    until: 0,
    resume: 0,
    room: null,
    manual: false // 全景是用户点按钮拉回来的（不被叫号打断，30 秒无操作才恢复轮播）
  })

  function step(i) {
    tour.manual = false
    tour.index = i
    tour.mode = i === OVERVIEW ? "overview" : "tour"
    tour.room = i === OVERVIEW ? null : ROOM_NOS[i]
    tour.until = Date.now() + (i === OVERVIEW ? T.overview : T.room)
    scene?.focus(tour.room)
  }
  function advance() {
    if (tour.mode === "call" || tour.mode === "lock")
      step((tour.resume + 1) % (OVERVIEW + 1))
    else step((tour.index + 1) % (OVERVIEW + 1))
  }
  /** 新叫号（第 1 次呼叫）：插播，镜头飞到被叫诊室；结束后接着原来的轮播往下走 */
  function onCall(room) {
    if (tour.mode === "lock" || tour.manual || callsBlocked) return
    if (tour.mode !== "call") tour.resume = tour.index
    tour.mode = "call"
    tour.room = room
    tour.until = Date.now() + T.call
    scene?.focus(room)
  }
  /** 点诊室（列表行、标签、三维里的诊室）：锁定看这间，30 秒无操作恢复轮播 */
  function lock(no) {
    if (tour.mode !== "lock" && tour.mode !== "call") tour.resume = tour.index
    tour.mode = "lock"
    tour.manual = false
    tour.room = no
    tour.until = Date.now() + T.idle
    scene?.focus(no)
  }
  function touch() {
    if ((tour.mode === "lock" || tour.manual) && Number.isFinite(tour.until))
      tour.until = Date.now() + T.idle
  }
  /** 解除锁定、拉回全景：停在全景，30 秒无操作后从第一间诊室重新开始轮播 */
  function showOverview() {
    tour.mode = "overview"
    tour.index = OVERVIEW
    tour.room = null
    tour.manual = true
    tour.until = Date.now() + T.idle
    scene?.focus(null)
  }

  // 标签 / 列表高亮的诊室；右栏显示的诊室（全景时显示最近叫号的诊室）
  const labelFocus = computed(() =>
    tour.mode === "overview" ? null : tour.room
  )
  const detailRoom = computed(() => {
    const no = tour.room || lastCall.value?.room || ROOM_NOS[0]
    return roomByNo.value[no]
  })

  function labelClass(r) {
    if (r.state === "calling") return "called"
    return r.no === labelFocus.value ? "focus" : ""
  }

  // ---------- 语音：默认静音；打开时在点击里解锁音频
  function toggleVoice() {
    voiceOn.value = !voiceOn.value
    if (voiceOn.value) unlock()
    else silence()
  }
  sim.on((evt) => {
    if (evt.type !== "call") return
    // 标签页挂起后补算出来的旧叫号不插播、不播报
    if (Date.now() - evt.at > 3000) return
    if (evt.n === 1) onCall(evt.room)
    if (voiceOn.value) announce(callText(evt.no, evt.room))
  })

  // ---------- 时钟 + 推进
  const dateText = computed(() => {
    const d = new Date(snap.value.now)
    return `${d.getMonth() + 1}月${d.getDate()}日 周${"日一二三四五六"[d.getDay()]}`
  })
  function update() {
    const now = Date.now()
    sim.tick(now)
    snap.value = sim.snapshot()
    scene?.setData(snap.value)
    if (now >= tour.until) advance()
  }
  const timer = setInterval(update, 500)

  // ---------- 录屏接口（只在开发模式暴露）：抖音视频的录屏脚本 docs/design/waiting/douyin/ 靠它编排镜头
  // blockCalls(true) 后新叫号不再插播（镜头不被随机叫号抢走），叫号条、三维高亮照常更新
  let callsBlocked = false
  if (import.meta.env.DEV)
    window.__waitingPage = {
      sim,
      tour,
      step,
      lock,
      showOverview,
      update,
      OVERVIEW,
      ROOM_NOS,
      blockCalls: (on = true) => (callsBlocked = on)
    }

  onMounted(() => {
    const q = new URLSearchParams(location.hash.split("?")[1] || "")
    scene = new WaitingScene({
      canvas: canvas.value,
      container: stage.value,
      onAnchors: (a) => (anchors.value = a),
      onPick: (no) => lock(no)
    })
    scene.setData(snap.value)
    if (ROOM_NOS.includes(q.get("room"))) {
      lock(q.get("room"))
      tour.until = Infinity
    } else if (q.get("tour") === "0") {
      step(OVERVIEW)
      tour.until = Infinity
    } else {
      // 开屏先看全景 4 秒，再从第一间诊室开始轮播
      step(OVERVIEW)
      tour.until = Date.now() + 4000
    }
    if (q.get("voice") === "1") voiceOn.value = true
    // 人物模型加载完再撤掉遮罩（首页预览截图脚本等的就是这个）
    scene.ready.then(() => requestAnimationFrame(() => (loading.value = false)))
  })

  onBeforeUnmount(() => {
    clearInterval(timer)
    if (window.__waitingPage?.sim === sim) delete window.__waitingPage
    silence()
    scene?.dispose()
  })
</script>

<style lang="scss" scoped>
  @use "./styles/candy" as *;

  .waiting {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    color: $ink;
    font-family: "Source Han Sans CN", sans-serif;
    // 浅紫底 + 几团柔和的彩色光斑（与设计稿一致）
    background: radial-gradient(
        circle at 6% 92%,
        rgba(255, 199, 232, 0.6),
        transparent 26%
      ),
      radial-gradient(
        circle at 94% 6%,
        rgba(184, 230, 255, 0.6),
        transparent 28%
      ),
      radial-gradient(
        circle at 76% 98%,
        rgba(255, 233, 168, 0.5),
        transparent 22%
      ),
      linear-gradient(#ece6ff, #e4dcfd);
  }

  // ---------- 顶栏
  .top {
    position: absolute;
    left: 40px;
    right: 40px;
    top: 0;
    height: 84px;
    .info {
      position: absolute;
      left: 0;
      top: 32px;
      p {
        font-size: 17px;
      }
      span {
        display: block;
        margin-top: 2px;
        font-size: 14px;
        color: $sub;
      }
    }
    h1 {
      position: absolute;
      left: 610px;
      top: 11px;
      width: 620px;
      height: 62px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 40px;
      border: 3px solid $ink;
      border-radius: 31px;
      background: $brand;
      box-shadow: 5px 5px 0 $ink;
      color: #fff;
      font-family: $title;
      font-size: 32px;
      font-weight: normal;
    }
    .beads {
      display: flex;
      gap: 4px;
      b {
        width: 12px;
        height: 12px;
        border: 1.5px solid $ink;
        border-radius: 50%;
      }
    }
    .right {
      position: absolute;
      right: 0;
      top: 26px;
      display: flex;
      align-items: center;
      gap: 18px;
    }
    .voice {
      height: 34px;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 14px 0 10px;
      border: 2px solid $ink;
      border-radius: 17px;
      background: #fff;
      color: $faint;
      font-size: 14px;
      cursor: pointer;
      svg {
        width: 22px;
        height: 22px;
      }
      &.on {
        color: $brand;
      }
    }
    .date {
      font-size: 16px;
      color: $sub;
    }
    .clock {
      font-family: $num;
      font-weight: normal;
      font-size: 34px;
    }
  }

  // ---------- 三维舞台
  .stage {
    position: absolute;
    left: 430px;
    top: 204px;
    width: 1060px;
    height: 666px;
    overflow: hidden; // 推近时标签不要飘到两侧面板上
    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
  }
  .labels {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .label {
    position: absolute;
    min-width: 66px;
    padding: 4px 8px 5px;
    transform: translate(-50%, calc(-100% - 8px));
    border: 2.2px solid $ink;
    border-radius: 12px;
    background: #fff;
    box-shadow: 3px 3px 0 $ink;
    text-align: center;
    pointer-events: auto;
    cursor: pointer;
    // 底下的小三角，指向状态柱
    &::after {
      content: "";
      position: absolute;
      left: 50%;
      bottom: -8px;
      width: 12px;
      height: 12px;
      transform: translateX(-50%) rotate(45deg);
      background: inherit;
      border-right: 2.2px solid $ink;
      border-bottom: 2.2px solid $ink;
    }
    .n {
      display: block;
      font-family: $num;
      font-weight: normal;
      font-size: 19px;
      line-height: 1.1;
    }
    .c3 {
      display: flex;
      justify-content: center;
      gap: 12px;
      margin-top: 2px;
      i {
        position: relative;
        font-style: normal;
        font-family: $num;
        font-size: 14px;
        & + i::before {
          content: "";
          position: absolute;
          left: -7.5px;
          top: 50%;
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: $faint;
        }
      }
      .w {
        color: $wait;
      }
      .r {
        color: $recheck;
      }
      .m {
        color: $missed;
      }
    }
    .chip {
      position: absolute;
      left: 50%;
      top: -32px;
      transform: translateX(-50%);
      height: 24px;
      padding: 0 10px;
      border: 2px solid $ink;
      border-radius: 12px;
      background: $call-deep;
      color: #fff;
      font-size: 14px;
      line-height: 20px;
      white-space: nowrap;
    }
    &.called {
      min-width: 80px;
      background: $call;
      color: #fff;
      .n {
        font-size: 21px;
      }
      .c3 i {
        color: #fff;
        & + i::before {
          background: #fff;
        }
      }
    }
    &.focus {
      min-width: 124px;
      padding: 7px 12px 8px;
      text-align: left;
      background: $brand;
      color: #fff;
      box-shadow: 4px 4px 0 $ink;
      .t {
        display: flex;
        align-items: baseline;
        gap: 6px;
        b {
          font-family: $num;
          font-weight: normal;
          font-size: 24px;
          line-height: 1;
        }
        small {
          font-size: 13px;
          color: $brand-sub;
          white-space: nowrap;
        }
      }
      .s {
        margin-top: 4px;
        font-size: 13px;
        color: $brand-sub;
        white-space: nowrap;
      }
      .c {
        margin-top: 4px;
        font-size: 12px;
        color: $brand-sub;
        white-space: nowrap;
        b {
          margin: 0 8px 0 3px;
          font-family: $num;
          font-weight: normal;
          font-size: 16px;
          color: #fff;
        }
      }
    }
  }
  .legend {
    position: absolute;
    right: 16px;
    top: 12px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 10px 12px;
    border: 2px solid $ink;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.85);
    pointer-events: none;
    span {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: $sub;
      i {
        width: 10px;
        height: 10px;
        border: 1.5px solid $ink;
        &.w {
          background: $wait;
        }
        &.r {
          background: $recheck;
        }
        &.m {
          background: $missed;
        }
        &.c {
          background: $call;
        }
      }
    }
    em {
      font-style: normal;
      font-size: 11px;
      color: $faint;
    }
  }

  .overview-btn {
    position: absolute;
    right: 16px;
    top: 12px;
    height: 40px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px 0 12px;
    border: 2.5px solid $ink;
    border-radius: 20px;
    background: #fff;
    box-shadow: 3px 3px 0 $ink;
    color: $brand;
    font-size: 15px;
    cursor: pointer;
    svg {
      width: 18px;
      height: 18px;
    }
    // 锁定时更醒目：品牌紫底白字
    &.locked {
      background: $brand;
      color: #fff;
    }
    &:active {
      transform: translate(2px, 2px);
      box-shadow: 1px 1px 0 $ink;
    }
  }

  .loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: #ece6ff;
    font-size: 20px;
    color: $sub;
  }
</style>

<!--
  无人机巡检监控平台（临江化工园区 · 虚构）大屏
  ----------------------------------------------------------
  还原基准：docs/design/drone/design/final.png（方向 A · 黄昏沙盘）。页面只负责布局与数据转接：
    - 三维：./scene（不依赖 Vue），加载 public/drone/park.glb + fleet.glb，主机位 = 定稿标定相机
    - 数据：./sim/simulator.js 按真实时钟仿真整天（4 机场 × 4 无人机、49 趟计划、AI 事件与处置），
      ./store/clock.js 统一时间游标（实时 / 回放），整屏都从 state = stateAt(day, t) 派生
    - 交互：选中设备（详情 + 模型缩略图）、跟随无人机、点事件飞到事发点、事件派单 / 复核 / 误报、
      拖动时间轴回放；30 s 无操作自动巡游（?tour=0 关闭）
  深链：?t=2026-10-19T14:03 把时钟钉在某一刻（设计稿那一刻，截图比对用）。
  建模脚本 scripts/blender/drone/；场地布局 scripts/drone/plan_site.py；设计文档 docs/design/drone/。
-->
<template>
  <div
    ref="pageRef"
    class="drone-page"
    @pointerdown="touch"
    @wheel="touch"
    @keydown="touch"
  >
    <canvas ref="canvasRef" class="scene"></canvas>
    <!-- 暗角遮罩外包一层整屏容器，在机载窗口处挖洞：机载画面画在画布里、在遮罩下面，不挖洞会被压暗 -->
    <div class="vignette-wrap">
      <div class="vignette" :class="{ hide: sceneMode !== 'home' }"></div>
    </div>

    <SceneTags
      v-if="ready && state"
      :scene="scene"
      :state="state"
      :zones="sceneMode === 'home'"
      @pick="pick"
    />

    <template v-if="state">
      <DroneHead
        :state="state"
        :cursor="clock.cursor.value"
        :live="clock.live.value"
        @live="clock.goLive()"
      />
      <KpiStrip :state="state" @events="locate(state.events[0])" />
      <AlarmBanner
        v-if="alarm"
        :alarm="alarm"
        :remain="alarmRemain"
        @locate="locate"
      />
      <FleetPanel :state="state" :selected="selected" @pick="pick" />
      <PlanPanel
        :state="state"
        :cursor="clock.cursor.value"
        :day-start="clock.dayStart.value"
        @seek="seekTrip"
      />
      <EventPanel
        :state="state"
        :thumbs="thumbs"
        :live="clock.live.value"
        @locate="locate"
        @act="act"
      />
      <WeekPanel :state="state" :week="clock.week.value" />
      <PovPanel
        ref="povRef"
        :drone="povDrone"
        :events="state.events"
        :mode="povMode"
        :follow="!!following || !povPick"
        @mode="setPovMode"
      />
      <TimelineBar
        :state="state"
        :cursor="clock.cursor.value"
        :now="clock.now()"
        :day-start="clock.dayStart.value"
        :live="clock.live.value"
        :playing="clock.playing.value"
        @seek="seek"
        @play="clock.play()"
        @pause="clock.pause()"
      />
      <DeviceDetail
        v-if="selected"
        :id="selected"
        :state="state"
        :thumb="detailThumb"
        :following="!!following"
        @close="pick(null)"
        @follow="toggleFollow"
      />
      <div v-if="touring" class="tour">无人值守巡游中 · 任意操作退出</div>
    </template>

    <div v-if="!ready" class="loading scene-loading">
      {{ error || "园区模型加载中…" }}
    </div>
  </div>
</template>

<script setup>
  import DroneHead from "./components/DroneHead.vue"
  import KpiStrip from "./components/KpiStrip.vue"
  import AlarmBanner from "./components/AlarmBanner.vue"
  import FleetPanel from "./components/FleetPanel.vue"
  import PlanPanel from "./components/PlanPanel.vue"
  import EventPanel from "./components/EventPanel.vue"
  import WeekPanel from "./components/WeekPanel.vue"
  import PovPanel from "./components/PovPanel.vue"
  import TimelineBar from "./components/TimelineBar.vue"
  import SceneTags from "./components/SceneTags.vue"
  import DeviceDetail from "./components/DeviceDetail.vue"
  import { DroneScene } from "./scene/DroneScene.js"
  import { createClock } from "./store/clock.js"
  import { installDashboardHooks } from "./dev/hooks.js"
  import { LIMITS } from "./data/catalog.js"
  import { DOCKS, DRONES } from "./data/layout.js"
  import devices from "./data/devices.json"

  // 设计稿画的那一刻（docs/design/drone/04-data-spec.md）
  const DESIGN_T = Date.parse("2026-10-19T14:03:00+08:00")

  const route = useRoute()
  const pinned = route.query.t ? Date.parse(`${route.query.t}:00+08:00`) : null
  const clock = createClock({ fixed: Number.isFinite(pinned) ? pinned : null })
  const state = computed(() => clock.state.value)

  const pageRef = ref(null)
  const canvasRef = ref(null)
  const povRef = ref(null)
  const ready = ref(false)
  const error = ref("")
  const sceneMode = ref("home")
  const selected = ref(null)
  const detailThumb = ref(null)
  const following = ref(null)
  const thumbs = reactive({})
  let scene = null

  // ---------------------------------------------------------------- 时间：给三维的连续时刻
  // 实时：真实时钟（钉住时就是那一刻）；回放暂停：游标；回放播放：游标 + 60 倍速插值（游标每 100 ms 跳 6 s）
  let cursorAt = performance.now()
  watch(clock.cursor, () => (cursorAt = performance.now()))
  function sceneTime() {
    if (clock.live.value) return clock.now()
    if (clock.playing.value)
      return (
        clock.cursor.value + Math.min(100, performance.now() - cursorAt) * 60
      )
    return clock.cursor.value
  }

  // ---------------------------------------------------------------- 告警
  const alarm = computed(
    () =>
      state.value?.events.find(
        (e) => e.status === "pending" && e.level === "major"
      ) || null
  )
  const alarmRemain = computed(() =>
    alarm.value
      ? LIMITS[alarm.value.level].confirm -
        (state.value.t - alarm.value.detectedAt) / 1000
      : 0
  )

  // ---------------------------------------------------------------- 机载画面：看哪一架
  const povPick = ref(null) // 用户点过的无人机
  const povUserMode = ref(null)
  const povDrone = computed(() => {
    const ds = state.value.drones
    if (following.value) return ds[following.value]
    if (povPick.value) return ds[povPick.value]
    // 默认：正在监视重大事件的那架 → 任一架在飞的 → 2# 无人机
    const mon =
      alarm.value && Object.values(ds).find((u) => u.eventId === alarm.value.id)
    return (
      mon || Object.values(ds).find((u) => u.state !== "docked") || ds["UAV-02"]
    )
  })
  // 相机模式：默认跟着无人机（夜间 / 测温悬停 / 红外类事件监视时是红外），用户切过就按用户的
  const povMode = computed(
    () =>
      povUserMode.value ||
      (scene?.poses?.[povDrone.value.dock]?.drone.cam ?? povDrone.value.cam)
  )
  function setPovMode(m) {
    povUserMode.value = m
  }
  watch(
    () => povDrone.value?.id,
    () => (povUserMode.value = null)
  )
  watch([povDrone, povMode, () => povRef.value?.frame], () => {
    if (scene && povRef.value?.frame)
      scene.pov.setTarget({
        drone: povDrone.value.id,
        el: povRef.value.frame,
        mode: povMode.value
      })
  })

  // ---------------------------------------------------------------- 数据 → 三维；新事件截缩略图
  // 队列每次按当前状态重排：只留当前这一天还没截的事件，顺序同事件流（最新在前），屏上那几条最先截。
  // 原先只往队尾追加：页面先按今天加载、再钉到别的日期（回放 / 截图钩子）时，旧日期的几十个事件排在前面，
  // 模型变复杂后每张更慢，屏上的缩略图迟迟出不来（比对第 44 轮发现）
  let thumbQueue = []
  watch(state, (s) => {
    if (!scene || !ready.value || !s) return
    scene.setData(clock.day, s)
    thumbQueue = s.events.filter((e) => !thumbs[e.id])
  })
  function pumpThumbs() {
    if (scene && ready.value && thumbQueue.length) {
      const e = thumbQueue.shift()
      thumbs[e.id] = scene.pov.snapshot(e)
    }
  }

  // ---------------------------------------------------------------- 交互
  /** 选中：机场 / 无人机 / 巡检对象（null = 取消）；机场飞过去看，无人机切换机载画面 */
  function pick(id) {
    touch()
    selected.value = id
    scene?.select(id)
    detailThumb.value = id && scene ? scene.pov.deviceThumb(id) : null
    if (!id) return
    if (DRONES[id]) povPick.value = id
    else if (DOCKS[id]) {
      povPick.value = DOCKS[id].drone
      const k = DOCKS[id]
      scene.flyTo([k.x, k.y, k.roof], { dist: 170, pitch: 34 })
    }
  }
  /** 定位事件：镜头飞到事发点，选中对象，机载画面切到发现它的无人机 */
  function locate(e) {
    if (!e || !scene) return
    touch()
    following.value = null
    scene.flyTo([e.x, e.y, 0], { dist: 300, pitch: 30 })
    // 单罐、单台设备直接选中；线状对象（管廊、周界）也有根节点
    selected.value = scene.devices.has(e.target) ? e.target : null
    scene.select(selected.value)
    detailThumb.value = selected.value
      ? scene.pov.deviceThumb(selected.value)
      : null
    if (state.value.drones[e.drone]?.state !== "docked") povPick.value = e.drone
  }
  function toggleFollow(id) {
    if (following.value === id) {
      following.value = null
      scene.flyHome()
    } else {
      following.value = id
      scene.followDrone(id)
    }
  }
  function seek(t) {
    touch()
    clock.seek(t)
  }
  /** 点计划条：回放到那趟起飞后 1 min，跟随那架无人机 */
  function seekTrip(p) {
    clock.seek(p.startedAt + 60e3)
    const d = DOCKS[p.dock].drone
    following.value = d
    scene?.followDrone(d)
  }
  function act(type, id) {
    touch()
    clock.act(type, id)
  }

  // ---------------------------------------------------------------- 无人值守巡游
  const tourOn = route.query.tour !== "0" && !pinned
  const touring = ref(false)
  let lastInput = performance.now()
  let tourStep = 0
  let tourAt = 0
  let tourFrozen = false
  function touch() {
    lastInput = performance.now()
    if (touring.value) {
      touring.value = false
      following.value = null
    }
  }
  function tourTick() {
    if (!tourOn || tourFrozen || !scene || !ready.value) return
    const now = performance.now()
    if (!touring.value) {
      if (now - lastInput > 30e3 && !selected.value) {
        touring.value = true
        tourStep = 0
        tourAt = 0
      } else return
    }
    if (now < tourAt) return
    const s = state.value
    const steps = [
      () => {
        following.value = null
        scene.flyHome()
      },
      () => {
        const u = Object.values(s.drones).find((x) => x.state !== "docked")
        if (!u) return false
        following.value = u.id
        scene.followDrone(u.id)
      },
      () => {
        const e = s.events.find(
          (x) => x.status !== "closed" && x.status !== "false"
        )
        if (!e) return false
        following.value = null
        scene.flyTo([e.x, e.y, 0], { dist: 300, pitch: 30 })
      }
    ]
    const dur = [14e3, 16e3, 10e3]
    const k = tourStep % steps.length
    const ok = steps[k]() !== false
    tourAt = now + (ok ? dur[k] : 0)
    tourStep++
  }

  // ---------------------------------------------------------------- 启动
  let hooks = null
  let timer = 0
  onMounted(async () => {
    scene = new DroneScene(canvasRef.value, {
      getTime: sceneTime,
      onPick: (id) => pick(id)
    })
    hooks = installDashboardHooks({
      scene,
      panels: () => [
        ...pageRef.value.querySelectorAll(
          ".panel, .head, .kpis, .banner, .pov-wrap, .tline, .tags, .tour"
        )
      ],
      states: {
        // 设计稿那一刻：钉住时钟、回到主机位、清掉选中和跟随
        design: () => {
          clock.pin(DESIGN_T)
          following.value = null
          pick(null)
          povPick.value = null
          scene.setView("home")
        },
        latest: () => clock.goLive()
      },
      onFreeze: (on) => (tourFrozen = on)
    })
    // 开发模式：时钟也挂到 window 上，方便验证回放 / 暂停（生产构建不挂）
    if (import.meta.env.DEV) window.__droneClock = clock
    try {
      await scene.load(import.meta.env.BASE_URL, devices)
    } catch (e) {
      error.value = `加载失败：${e.message}`
      throw e
    }
    ready.value = true
    scene.setData(clock.day, state.value)
    for (const e of state.value.events) thumbQueue.push(e)
    await nextTick()
    if (povRef.value?.frame)
      scene.pov.setTarget({
        drone: povDrone.value.id,
        el: povRef.value.frame,
        mode: povMode.value
      })
    timer = setInterval(() => {
      sceneMode.value = scene.mode
      pumpThumbs()
      tourTick()
    }, 120)
    await document.fonts.ready
    hooks.markReady()
  })
  onBeforeUnmount(() => {
    clearInterval(timer)
    hooks?.uninstall()
    clock.dispose()
    scene?.dispose()
  })
</script>

<style lang="scss">
  /* 整页共享的变量与基础样式（不加 scoped：子组件共用 .panel / .ph / .chip 等类） */
  .drone-page {
    --bg: #060b16;
    --panel: rgba(9, 18, 36, 0.78);
    --panel-2: rgba(20, 36, 64, 0.6);
    --line: rgba(120, 170, 230, 0.16);
    --text: #e3ecf8;
    --sub: #8ea3bf;
    --dim: #55657c;
    --ok: #36e3d8;
    --run: #4fb6ff;
    --warn: #ffb020;
    --off: #6b778a;
    --major: #ff4d4f;
    --serious: #ff8a3d;
    --general: #ffd23f;
    --accent: #36e3d8;
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    color: var(--text);
    font-family: "Source Han Sans CN", sans-serif;
    font-size: 14px;
    user-select: none;
    .num {
      font-family: "DIN", sans-serif;
      font-variant-numeric: tabular-nums;
    }
    .ttl {
      font-family: "Alimama ShuHeiTi", sans-serif;
    }
    .panel {
      position: absolute;
      z-index: 4;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 4px;
      backdrop-filter: blur(6px);
    }
    .ph {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      padding: 12px 16px 8px;
      h3 {
        font-family: "Alimama ShuHeiTi", sans-serif;
        font-weight: normal;
        font-size: 18px;
        letter-spacing: 1px;
        &::before {
          content: "";
          display: inline-block;
          width: 4px;
          height: 14px;
          margin-right: 8px;
          background: var(--accent);
          vertical-align: -1px;
        }
      }
      .meta {
        color: var(--sub);
        font-size: 12px;
      }
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 20px;
      padding: 0 7px;
      border-radius: 3px;
      font-size: 12px;
      line-height: 20px;
      white-space: nowrap;
      .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        display: inline-block;
      }
    }
    .lv {
      font-size: 11px;
      height: 18px;
      line-height: 18px;
      padding: 0 5px;
      border-radius: 2px;
      color: #111;
      &.major {
        background: var(--major);
        color: #fff;
      }
      &.serious {
        background: var(--serious);
      }
      &.general {
        background: var(--general);
      }
    }
    .st {
      font-size: 11px;
      padding: 0 5px;
      height: 18px;
      line-height: 18px;
      border-radius: 2px;
      border: 1px solid var(--line);
      color: var(--sub);
      &.pending {
        border-color: var(--major);
        color: var(--major);
      }
      &.false {
        color: var(--dim);
        text-decoration: line-through;
      }
    }
  }
</style>

<style lang="scss" scoped>
  .scene {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  /* 定稿的沙盘边缘：场景框内椭圆暗角，框外整片底色（镜头离开主机位后淡出成全屏三维） */
  // 整屏容器（按设计稿 1920×1080 定尺寸，跟着 rem 等比缩放），clip-path 在机载窗口
  // （PovPanel 的取景框：左 1046、上 690、432×243）处挖一个矩形洞；第 27 轮比对发现
  // 遮罩的 box-shadow 盖住了机载画面沙盘框以下的约 70 px，右上角也被径向暗角压暗
  .vignette-wrap {
    position: absolute;
    left: 0;
    top: 0;
    width: 1920px;
    height: 1080px;
    pointer-events: none;
    z-index: 2;
    clip-path: polygon(
      evenodd,
      0 0,
      100% 0,
      100% 100%,
      0 100%,
      0 0,
      54.4792% 63.8889%,
      54.4792% 86.3889%,
      76.9792% 86.3889%,
      76.9792% 63.8889%,
      54.4792% 63.8889%
    );
  }
  .vignette {
    position: absolute;
    left: 410px;
    top: 116px;
    width: 1120px;
    height: 747px;
    background: radial-gradient(
      ellipse 58% 60% at 50% 52%,
      transparent 72%,
      #060b16 100%
    );
    box-shadow: 0 0 0 3000px #060b16;
    pointer-events: none;
    transition: opacity 0.8s;
    z-index: 2;
    &.hide {
      opacity: 0;
    }
  }
  .loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 20px;
    color: var(--sub);
    background: rgba(6, 11, 22, 0.85);
    z-index: 10;
  }
  .tour {
    position: absolute;
    right: 28px;
    top: 84px;
    font-size: 12px;
    color: var(--sub);
    z-index: 5;
  }
</style>

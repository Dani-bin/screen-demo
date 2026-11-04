<!--
  智慧社区 · 无人机空中巡防指挥中心（虚构小区「松岚苑」· 暖光实体沙盘 + 三机联动）
  ----------------------------------------------------------
  还原基准：docs/design/smart-community/design/final.png。页面只负责面板与交互的转接：
    - 三维：./scene/CommunityScene.js（不依赖 Vue），主机位 = 定稿反求的相机（data/camera.json）
    - 数据：./sim/simulator.js（2026-11-04 这一天的全部状态都是时刻 t 的纯函数），./data/layout.json（编号与布局，
      scripts/smart-community/layout.mjs 生成）
    - 面板：./components（定稿 HTML 面板的移植），样式 ./styles/community.no-convert.css
  版面：画布铺满窗口，面板放在按 1920×1080 居中缩放的"舞台"里；三维投影中心按同一个缩放和原点换算。
  交互：底部五个剧情（走失搜寻 / 周界入侵 / 热源异常 / 消防通道 / 外立面）点一个就跳过去播放并飞镜头；
  自动导览（45 秒无人操作自动开始，依次播五个剧情）；点底部时间线跳到全天任一时刻；视角切换（俯瞰 / 跟随无人机 / 机库）；
  点楼栋、楼栋圆牌、充电区、盲区、无人机出信息卡；左栏点某架机 = 跟随；右栏点事件 = 镜头飞过去。
  深链：?at=18:06 钉住时刻（定稿的一刻）；?speed=12 从该时刻起按倍速走；?tour=0 关闭自动导览；?story=PT 直接进某个剧情；
  ?select=B08 选中；?q=low|mid|high 画质；?ui=0 隐藏面板（只看三维）。
-->
<template>
  <div ref="pageRef" class="community-page" @pointerdown="onActivity">
    <canvas ref="canvasRef" class="scene"></canvas>
    <!-- 无人机俯视图符号（左栏三机卡片的小图标用） -->
    <svg width="0" height="0" style="position: absolute" aria-hidden="true">
      <defs>
        <symbol id="drone6" viewBox="-30 -30 60 60">
          <g stroke="currentColor" stroke-width="2.2" fill="none">
            <path
              d="M0 0 L22 0 M0 0 L11 19 M0 0 L-11 19 M0 0 L-22 0 M0 0 L-11 -19 M0 0 L11 -19"
            />
            <circle
              v-for="a in 6"
              :key="a"
              :cx="22 * Math.cos(((a - 1) * Math.PI) / 3)"
              :cy="22 * Math.sin(((a - 1) * Math.PI) / 3)"
              r="8"
              fill="currentColor"
              fill-opacity="0.25"
            />
          </g>
          <circle
            r="7"
            fill="#1a1510"
            stroke="currentColor"
            stroke-width="2.4"
          />
          <circle r="2.4" fill="currentColor" />
        </symbol>
        <symbol id="drone4" viewBox="-30 -30 60 60">
          <g stroke="currentColor" stroke-width="2.2" fill="none">
            <path d="M-16 -16 L16 16 M16 -16 L-16 16" />
            <circle
              cx="16"
              cy="16"
              r="9"
              fill="currentColor"
              fill-opacity="0.25"
            />
            <circle
              cx="-16"
              cy="16"
              r="9"
              fill="currentColor"
              fill-opacity="0.25"
            />
            <circle
              cx="16"
              cy="-16"
              r="9"
              fill="currentColor"
              fill-opacity="0.25"
            />
            <circle
              cx="-16"
              cy="-16"
              r="9"
              fill="currentColor"
              fill-opacity="0.25"
            />
          </g>
          <circle
            r="7"
            fill="#1a1510"
            stroke="currentColor"
            stroke-width="2.4"
          />
          <circle r="2.4" fill="currentColor" />
        </symbol>
      </defs>
    </svg>

    <div v-if="!ready" class="loading scene-loading">
      <div class="bar"><i :style="{ width: progress * 100 + '%' }"></i></div>
      <span>松岚苑沙盘加载中…</span>
    </div>

    <div v-show="q.ui !== '0'" ref="stageRef" class="stage" :style="stageStyle">
      <template v-if="ready && snap">
        <TagLayer
          ref="tagRef"
          :snap="snap"
          :selected="selectedId"
          @pick="onPick"
        />
        <TopBar :snap="snap" />
        <FleetPanel :snap="snap" @pick="onPickDrone" />
        <LinkPanel :snap="snap" :chart="charts.link" />
        <BatteryPanel :snap="snap" :chart="charts.batt" />
        <MissionPanel :snap="snap" />
        <EventsPanel :snap="snap" @pick="onPickEvent" />
        <OrdersPanel :snap="snap" />
        <BottomBar
          :snap="snap"
          :active-story="activeStoryKey"
          :touring="touring"
          :view="view"
          @story="onStory"
          @tour="toggleTour"
          @scrub="onScrub"
          @view="setView"
        />
        <PovWindows ref="povRef" />
        <InfoCard
          :snap="snap"
          :id="selectedId"
          @close="clearSelection"
          @focus="focusSelected"
        />
        <div v-if="caption" class="card caption">
          <div class="hd">
            <b>{{ caption.idx }}</b
            >{{ caption.name }}
            <span class="dots"
              ><i
                v-for="s in STORIES"
                :key="s.key"
                :class="{ on: s.key === clock.story.value }"
              ></i
            ></span>
          </div>
          <p>{{ caption.text }}</p>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
  import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    shallowRef
  } from "vue"
  import layout from "./data/layout.json"
  import { createSim, STORIES } from "./sim/simulator.js"
  import { createClock } from "./store/clock.js"
  import { CommunityScene } from "./scene/CommunityScene.js"
  import { Director } from "./scene/tour.js"
  import TopBar from "./components/TopBar.vue"
  import FleetPanel from "./components/FleetPanel.vue"
  import LinkPanel from "./components/LinkPanel.vue"
  import BatteryPanel from "./components/BatteryPanel.vue"
  import MissionPanel from "./components/MissionPanel.vue"
  import EventsPanel from "./components/EventsPanel.vue"
  import OrdersPanel from "./components/OrdersPanel.vue"
  import BottomBar from "./components/BottomBar.vue"
  import TagLayer from "./components/TagLayer.vue"
  import PovWindows from "./components/PovWindows.vue"
  import InfoCard from "./components/InfoCard.vue"
  import "./styles/community.no-convert.css"

  const q = Object.fromEntries(
    new URLSearchParams(location.hash.split("?")[1] ?? "")
  )
  const sim = createSim(layout)
  const clock = createClock(location.hash.split("?")[1] ?? "")

  const pageRef = ref(null)
  const canvasRef = ref(null)
  const stageRef = ref(null)
  const tagRef = ref(null)
  const povRef = ref(null)
  const stageStyle = ref({})
  const ready = ref(false)
  const progress = ref(0)
  const snap = shallowRef(sim.at(clock.t.value))
  const charts = shallowRef(buildCharts(snap.value))
  const selectedId = ref(null)
  const view = ref("home")
  const touring = ref(false)
  let scene = null
  let director = null
  let idleTimer = null
  let lastPanel = 0
  let lastChart = 0
  let tourIdx = 0

  // ---------------------------------------------------------------- 图表数据：窗口 = 现在 ± 30 分钟，61 个点

  /** 链路图取"在飞的、信号最吃紧的一架"（三号机钻进树荫时最明显），都不在飞就看三号机 */
  function buildCharts(s) {
    const t0 = s.t - 30
    const mk = (id) => sim.series(id, t0, t0 + 60, 61)
    const flying = s.drones.filter((d) => d.airborne && d.id !== "UAV-02")
    const pick = flying.sort((a, b) => a.rssi58 - b.rssi58)[0]?.id ?? "UAV-03"
    return {
      link: {
        id: pick,
        t0,
        r58: mk(`${pick}.rssi58`),
        r24: mk(`${pick}.rssi24`)
      },
      batt: {
        t0,
        batt: Object.fromEntries(
          ["UAV-01", "UAV-02", "UAV-03"].map((id) => [id, mk(`${id}.batt`)])
        )
      }
    }
  }

  // ---------------------------------------------------------------- 舞台缩放

  function layoutStage() {
    const w = window.innerWidth
    const h = window.innerHeight
    const u = Math.min(w / 1920, h / 1080)
    stageStyle.value = {
      transform: `translate(${(w - 1920 * u) / 2}px, ${(h - 1080 * u) / 2}px) scale(${u})`
    }
  }

  // ---------------------------------------------------------------- 选中、视角、剧情、导览

  function clearSelection() {
    selectedId.value = null
    scene?.select(null)
  }

  function select(id) {
    selectedId.value = id
    scene.select(id)
  }

  /** 点三维里的对象 / 圆牌 */
  function onPick(id) {
    stopTour()
    bumpIdle()
    if (!id) {
      clearSelection()
      return
    }
    select(id)
  }

  /** 点左栏的无人机：选中并跟随（不在飞就飞去机库） */
  function onPickDrone(id) {
    stopTour()
    bumpIdle()
    select(id)
    const d = snap.value.drones.find((x) => x.id === id)
    if (d.airborne) setView(id)
    else setView("hangar")
  }

  /** 点右栏的事件：镜头飞到事件位置，选中对应设施 */
  function onPickEvent(e) {
    stopTour()
    bumpIdle()
    view.value = "home"
    scene.flyToPlan(e.focus[0], e.focus[1], {
      dist: 300,
      polar: 52,
      azimuth: -10
    })
    if (
      layout.buildings.some((b) => b.id === e.zone) ||
      layout.points.some((p) => p.id === e.zone)
    )
      select(e.zone)
  }

  function focusSelected() {
    const id = selectedId.value
    if (!id) return
    if (id.startsWith("UAV")) return onPickDrone(id)
    const b = layout.buildings.find((x) => x.id === id)
    const p = layout.points.find((x) => x.id === id)
    const o = b ?? { cx: p.x, cy: p.y }
    scene.flyToPlan(o.cx ?? p.x, o.cy ?? p.y, {
      dist: b ? 260 : 190,
      polar: 52,
      azimuth: -8
    })
  }

  /** 视角：俯瞰（定稿机位）/ 跟随某架无人机 / 机库 */
  function setView(key) {
    stopTour()
    bumpIdle()
    view.value = key
    if (key === "home") scene.goHome()
    else if (key === "hangar")
      scene.flyToPlan(layout.hangar.x, layout.hangar.y, {
        dist: 170,
        polar: 55,
        azimuth: 12,
        h: layout.hangar.roof
      })
    else scene.follow(key)
  }

  /** 点底栏的剧情：跳过去播放 */
  function onStory(key) {
    stopTour()
    bumpIdle()
    playStory(key)
  }

  function playStory(key, done) {
    clearSelection()
    view.value = "home"
    director.start(key)
    clock.startStory(key, () => {
      director.stop()
      scene.goHome()
      done?.()
    })
    director.update(clock.t.value)
  }

  /** 底栏高亮的剧情：正在播放的；没在播放时，当前有任务在进行就高亮该类型（设计时刻是走失搜寻） */
  const activeStoryKey = computed(
    () =>
      clock.story.value ??
      (snap.value.mission.live ? snap.value.mission.type : null)
  )

  const caption = computed(() => {
    const k = clock.story.value
    if (!k) return null
    const i = STORIES.findIndex((s) => s.key === k)
    return {
      idx: `${i + 1} / ${STORIES.length}`,
      name: STORIES[i].name,
      text: STORIES[i].text
    }
  })

  /** 自动导览：依次播五个剧情，播完回到第一个，直到有人操作 */
  function toggleTour() {
    // 导览按钮只做切换：正在导览就停（连当前剧情一起退出），否则开始；不能先走 bumpIdle，免得它先把导览停了、点击又重新开始
    clearTimeout(idleTimer)
    if (touring.value) {
      stopTour(true)
      bumpIdle()
      return
    }
    touring.value = true
    tourIdx = 0
    runTour()
  }
  function runTour() {
    if (!touring.value) return
    const s = STORIES[tourIdx % STORIES.length]
    tourIdx++
    playStory(s.key, () => touring.value && setTimeout(runTour, 600))
  }
  function stopTour(andStory = false) {
    if (!touring.value) return
    touring.value = false
    if (andStory && clock.story.value) {
      director.stop()
      clock.stopStory()
      scene.goHome()
    }
  }

  function onScrub(min) {
    stopTour()
    bumpIdle()
    director.stop()
    clock.scrub(min)
  }

  /** 45 秒没人操作就自动导览；有人操作就重新计时 */
  /** 任何点击都重新计 45 秒空闲；导览中不动它（要停导览得点导览按钮或操作画面 / 面板上的具体对象） */
  function onActivity() {
    if (!touring.value) bumpIdle()
  }

  function bumpIdle() {
    clearTimeout(idleTimer)
    if (touring.value) return // 导览中不计时；停了才重新计
    if (q.tour === "0" || !ready.value) return
    idleTimer = setTimeout(() => !touring.value && toggleTour(), 45000)
  }

  // ---------------------------------------------------------------- 每帧：面板跟着三维走

  /** 场景每帧向页面要快照：推进仿真时钟 */
  function frame(dt) {
    const t = clock.advance(dt)
    director?.update(t)
    return sim.at(t)
  }

  function onFrame(s, sn) {
    const now = performance.now()
    // 面板 5 Hz；图表 1 Hz（窗口随时间滑动）
    if (now - lastPanel > 200) {
      lastPanel = now
      snap.value = sn
      if (now - lastChart > 1000) {
        lastChart = now
        charts.value = buildCharts(sn)
      }
    }
    // 标签、圆牌位置每帧按三维投影摆放
    const { u, ox, oy } = s.stage()
    const toStage = (p) => ({
      x: (p.x - ox) / u,
      y: (p.y - oy) / u,
      visible: p.visible
    })
    tagRef.value?.update(s, toStage)
    // 无人机视角窗：场景渲染，页面只摆窗框和识别框
    povRef.value?.set(s.povState ?? {})
  }

  // ---------------------------------------------------------------- 生命周期

  onMounted(async () => {
    layoutStage()
    window.addEventListener("resize", layoutStage)
    scene = new CommunityScene(canvasRef.value, {
      sim,
      frame,
      onPick,
      onFrame,
      onProgress: (p) => (progress.value = p)
    })
    scene.onUser = () => {
      stopTour()
      view.value = "home"
      bumpIdle()
    }
    director = new Director(scene)
    if (import.meta.env.DEV) {
      window.__communityScene = scene
      window.__communityClock = clock
      window.__communitySim = sim
      installHooks()
    }
    await scene.ready
    ready.value = true
    await nextTick()
    scene.setPovElements(() => ({
      vis: povRef.value?.visRef,
      ir: povRef.value?.irRef
    }))
    if (q.select) select(q.select)
    const story = clock.initialStory
    if (story && STORIES.some((s) => s.key === story)) playStory(story)
    bumpIdle()
    if (window.__dashboard) window.__dashboard.ready = true
  })

  onBeforeUnmount(() => {
    window.removeEventListener("resize", layoutStage)
    clearTimeout(idleTimer)
    touring.value = false
    scene?.dispose()
    if (import.meta.env.DEV) {
      delete window.__communityScene
      delete window.__communityClock
      delete window.__communitySim
      delete window.__dashboard
    }
  })

  /**
   * 开发模式测试钩子：给 scripts/capture.mjs 固定画面用（契约见 build-3d-visual-dashboard 的 hooks.js）。
   * 数据状态 design = 定稿那一刻：2026-11-04 18:06，时钟钉住，镜头在主机位，不选中。
   */
  function installHooks() {
    window.__dashboard = {
      ready: false,
      views: ["home"],
      states: ["design"],
      setView(name) {
        if (name === "home") {
          scene._tween = null
          scene._follow = null
          scene.camera.position.copy(scene.home.position)
          scene.controls.target.copy(scene.home.target)
          scene.controls.update()
        }
      },
      async setState(name) {
        if (name !== "design") throw new Error(`未定义的数据状态 ${name}`)
        stopTour()
        clearTimeout(idleTimer)
        director.stop()
        clock.stopStory()
        clock.t.value = 18 * 60 + 6
        clock.mode.value = "pinned"
        clearSelection()
        window.__dashboard.setView("home")
        // 等几帧，让场景用新时刻刷新一次快照（冻结之后就不再刷新了）
        await new Promise((r) => setTimeout(r, 400))
      },
      freeze(on = true) {
        scene.setFrozen(on)
        if (on) {
          stopTour()
          clearTimeout(idleTimer)
        }
      },
      hidePanels(on = true) {
        if (stageRef.value) stageRef.value.style.visibility = on ? "hidden" : ""
      },
      renderIdMask: () => {
        throw new Error("社区页面没有实现 ID 图")
      },
      stats: () => scene.stats()
    }
  }
</script>

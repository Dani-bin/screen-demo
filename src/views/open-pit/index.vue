<!--
  青原露天矿 · 无人矿卡运输调度大屏（虚构矿山，真实地形与公开资料做依据）
  ----------------------------------------------------------
  还原基准：docs/design/open-pit/design/final.png（风格 A 全息透视 · 煤能青蓝）。页面只负责面板、数据状态与交互的转接：
    - 三维：./scene/PitScene.js（不依赖 Vue，接口见文件头），画布铺满窗口、在最底层；总览视角用 ./scene/plate.js 的设计稿底图（在三维画布下面）
    - 数据：./sim/simulator.js 按北京时间仿真车队 / 电铲 / 排卸 / 换电 / 能源 / 边坡监测；
      ./store/derive.js 把仿真结果整理成面板数据（纯函数），./store/board.js 是响应式数据层与页面状态（inject("board")）
    - 面板：./components（定稿 HTML 面板的移植），样式 ./styles/open-pit.no-convert.css（px 不转 rem）
  版面：画布铺满窗口，面板放在 1920 × 1080 的"舞台"里按 min(宽/1920, 高/1080) 等比缩放并居中；
  三维投影中心按舞台位置换算（stageBox），窗口比 16:9 宽或扁时侧栏仍完整、沙盘与面板仍然对齐。
  交互：顶栏页签 / 控制台按钮切视角；单车列表、编组、电铲、事件、标签点选；三维里点选同步回面板；
  图表悬停看数值；自动导览（无操作 45 秒自动开启，任何点击暂停）。
  深链：?at=2026-10-30T20:30 把时钟钉在设计稿那一刻（北京时间，设计时刻默认选中 TK-037）；?tour=0 关闭自动导览、?tour=1 开机就开启导览；
  ?ui=1 只留面板（不建三维、不画标签，和设计稿的 --ui 截图比对排版）；?scene=classic 用旧的程序化场景（默认是 Blender 全景模型场景）；?plate=0（旧场景下）总览也用实时三维；?select=TK-037 选中某个编号；?q=low|mid|high 画质。
  dev 构建会暴露 window.__pitScene / window.__pitBoard，方便在控制台调试。
-->
<template>
  <div class="open-pit-page" :class="{ ui }">
    <!-- 总览底图（设计稿场景图 + 实时叠加）在三维画布下面；离开总览时三维画布淡入盖住它 -->
    <canvas v-if="!ui" ref="plateRef" class="pit-canvas pit-plate"></canvas>
    <canvas v-if="!ui" ref="canvasRef" class="pit-canvas"></canvas>
    <div
      :ref="(el) => (board.stageEl.value = el)"
      class="stage"
      :style="stageStyle"
    >
      <div class="shade">
        <i class="xl"></i><i class="xr"></i><i class="xt"></i><i class="xb"></i>
      </div>
      <template v-if="ready">
        <SceneTags v-if="!ui" :project="projectToStage" />
        <TopBar />
        <KpiStrip />
        <FleetGroups />
        <TruckList />
        <HourlyChart />
        <ShovelPanel />
        <SwapEnergy />
        <SlopePanel />
        <CommsEvents />
        <DetailCard />
        <ConsolePanel />
        <FleetTimeline />
        <Tip />
      </template>
    </div>
    <div v-if="!ready" class="loading">
      <div>
        {{ layout.name }} · 正在推演车队
        <small>QINGYUAN OPEN-PIT</small>
      </div>
    </div>
  </div>
</template>

<script setup>
  import "./styles/open-pit.no-convert.css"
  import GlbScene from "./scene/GlbScene.js"
  import PitScene from "./scene/PitScene.js"
  import layout from "./data/layout.json"
  import { createBoard } from "./store/board.js"
  import TopBar from "./components/TopBar.vue"
  import KpiStrip from "./components/KpiStrip.vue"
  import FleetGroups from "./components/FleetGroups.vue"
  import TruckList from "./components/TruckList.vue"
  import HourlyChart from "./components/HourlyChart.vue"
  import ShovelPanel from "./components/ShovelPanel.vue"
  import SwapEnergy from "./components/SwapEnergy.vue"
  import SlopePanel from "./components/SlopePanel.vue"
  import CommsEvents from "./components/CommsEvents.vue"
  import DetailCard from "./components/DetailCard.vue"
  import ConsolePanel from "./components/ConsolePanel.vue"
  import FleetTimeline from "./components/FleetTimeline.vue"
  import SceneTags from "./components/SceneTags.vue"
  import Tip from "./components/Tip.vue"

  const route = useRoute()
  const q = route.query
  const ui = q.ui === "1"

  // ?at=2026-10-30T20:30：按北京时间钉死时钟（只算一次，不再前进）
  const parsed = q.at ? Date.parse(`${q.at}+08:00`) : NaN
  const board = createBoard(layout, {
    pinned: Number.isFinite(parsed) ? parsed : null,
    autoTour: q.tour !== "0",
    select: q.select || null
  })
  provide("board", board)

  const canvasRef = ref(null)
  const plateRef = ref(null)
  const ready = ref(false)
  const stageStyle = ref({})
  let scene = null
  let disposed = false

  // ---------------------------------------------------------------- 舞台缩放

  /** 舞台（1920 × 1080 设计稿）在窗口里的矩形（CSS 像素）：等比缩放、居中 */
  function stageBox() {
    const w = window.innerWidth
    const h = window.innerHeight
    const u = Math.min(w / 1920, h / 1080)
    return {
      x: (w - 1920 * u) / 2,
      y: (h - 1080 * u) / 2,
      w: 1920 * u,
      h: 1080 * u
    }
  }

  function layoutStage() {
    const b = stageBox()
    stageStyle.value = {
      transform: `translate(${b.x}px, ${b.y}px) scale(${b.w / 1920})`
    }
  }

  function onResize() {
    layoutStage()
    scene?.resize()
  }

  /** 场景锚点 → 舞台设计像素；场景返回 null 或看不到（在相机背后 / 被裁掉）就不显示标签 */
  function projectToStage(id) {
    const p = scene?.project(id)
    if (!p || !p.visible) return null
    const b = stageBox()
    const u = b.w / 1920
    return { x: (p.x - b.x) / u, y: (p.y - b.y) / u }
  }

  // ---------------------------------------------------------------- 输入与可见性

  /** 任何点击 / 滚轮 / 按键：交给 board 暂停导览并重新计 45 秒 */
  function onInput(e) {
    board.noteActivity(e)
  }
  function onVisible() {
    scene?.setFrozen(document.hidden)
  }

  // ---------------------------------------------------------------- 生命周期

  onMounted(async () => {
    layoutStage()
    window.addEventListener("resize", onResize)
    for (const t of ["pointerdown", "wheel", "keydown"])
      window.addEventListener(t, onInput, { capture: true, passive: true })
    document.addEventListener("visibilitychange", onVisible)

    // 先让加载遮罩画出来，再做第一次仿真积分（要几百毫秒，今天的年累要往前积 7 天）
    await nextTick()
    await new Promise((r) => setTimeout(r, 30))
    if (disposed) return
    board.start()

    if (!ui) {
      // 默认：Blender 全景模型场景（public/open-pit/pit.glb，用户 2026-11-03 要求换上看实际效果）；
      // ?scene=classic 用旧的程序化场景（总览是设计稿底图 + 实时叠加，?plate=0 再退回纯三维）
      const SceneClass = q.scene === "classic" ? PitScene : GlbScene
      const sc = new SceneClass(canvasRef.value, {
        stageBox,
        plateCanvas: plateRef.value,
        noPlate: q.plate === "0",
        onSelect: board.onSceneSelect,
        onView: board.onSceneView,
        onTour: board.onSceneTour,
        quality: ["low", "mid", "high"].includes(q.q) ? q.q : undefined
      })
      scene = sc
      // 场景要等资源加载完（ready）才能 select / focus；加载失败也让面板先出来，只是没有三维
      try {
        await sc.ready
      } catch (err) {
        console.error("[open-pit] 三维场景加载失败", err)
        sc.dispose?.()
        scene = null
      }
      if (disposed) return
      if (scene) {
        board.bindScene(scene)
        // ?tour=1：打开页面就开启自动导览（设计稿画的是导览开着的状态，截图比对用）
        if (q.tour === "1" && !board.tour.on) board.toggleTour()
        if (import.meta.env.DEV) window.__pitScene = scene
      }
    }
    if (import.meta.env.DEV) window.__pitBoard = board
    ready.value = true
  })

  onBeforeUnmount(() => {
    disposed = true
    board.stop()
    window.removeEventListener("resize", onResize)
    for (const t of ["pointerdown", "wheel", "keydown"])
      window.removeEventListener(t, onInput, { capture: true })
    document.removeEventListener("visibilitychange", onVisible)
    scene?.dispose()
    scene = null
    if (import.meta.env.DEV) {
      delete window.__pitScene
      delete window.__pitBoard
    }
  })
</script>

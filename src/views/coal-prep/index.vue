<!--
  井上地面输送系统 · 带式输送机安全孪生（虚构 · 青峰煤矿 · 103 原煤上仓带式输送机）
  ----------------------------------------------------------
  还原基准：docs/design/coal-prep/design/final.png（v3：A 黄昏写实航拍 · 钢蓝安全橙，103 机头驱动部特写）。
  页面只负责布局与数据转接：
    - 三维：./scene/HeadScene.js（Blender 脚本建模的 public/coal-prep/conveyor.glb + Cycles 光照图），主机位 = 定稿概念图反求的相机
    - 数据：./sim/simulator.js 跟随北京时间仿真；./store/board.js 从快照派生面板数字（与设计稿 data.js 同口径）
    - 面板：./components（定稿 HTML 面板的移植，样式 ./styles/board.no-convert.css）
  版面：舞台固定 1920 × 1080 设计像素，按窗口 transform: scale 等比缩放并居中（不走 rem），
  三维标签的内联坐标与样式表尺寸都是设计像素。
  深链：?at=2026-10-27T18:40 把时钟钉在定稿那一刻（截图比对用）。
-->
<template>
  <div ref="pageRef" class="coal-page">
    <div
      class="backdrop"
      :style="{ backgroundImage: `url(${BASE}coal-prep/backdrop.webp)` }"
    ></div>
    <div class="stage" :style="stageStyle">
      <div class="scene"><canvas ref="canvasRef"></canvas></div>
      <div v-if="msg" class="scene-msg">{{ msg }}</div>
      <template v-if="d">
        <TopBar :s="d.s" />
        <LeftColumn :d="d" :selected="selected" @pick="onPick" />
        <RightColumn :d="d" @alarm="onAlarm" />
        <SceneOverlay
          :d="d"
          :anchors="anchors"
          :layers="layers"
          :selected="selected"
          :moved="moved"
          @pick="onPick"
          @alarm="onAlarm"
          @layer="toggleLayer"
          @home="goHome"
        />
        <LineMap :d="d" />
        <BottomCharts :d="d" />
      </template>
    </div>
  </div>
</template>

<script setup>
  import { markRaw } from "vue"
  import "./styles/board.no-convert.css"
  import TopBar from "./components/TopBar.vue"
  import LeftColumn from "./components/LeftColumn.vue"
  import RightColumn from "./components/RightColumn.vue"
  import SceneOverlay from "./components/SceneOverlay.vue"
  import LineMap from "./components/LineMap.vue"
  import BottomCharts from "./components/BottomCharts.vue"
  import { createSimulator, DESIGN_T } from "./sim/simulator.js"
  import { deriveBoard } from "./store/board.js"
  import { HeadScene } from "./scene/HeadScene.js"
  import { installDashboardHooks } from "./dev/hooks.js"

  const BASE = import.meta.env.BASE_URL
  const route = useRoute()
  const pageRef = ref(null)
  const canvasRef = ref(null)
  const msg = ref("三维模型加载中…")

  /* ---------------- 时钟与数据：每秒取一次快照 ---------------- */
  const sim = createSimulator()
  // ?at= 钉住时钟（不走动）；否则跟随北京时间
  const pinned = ref(
    route.query.at ? Date.parse(`${route.query.at}:00+08:00`) : null
  )
  const now = () =>
    pinned.value != null && !Number.isNaN(pinned.value)
      ? pinned.value
      : Date.now()
  const d = shallowRef(null)
  function tick() {
    d.value = markRaw(deriveBoard(sim.at(now())))
    sceneRef.value?.setState(d.value)
  }

  /* ---------------- 舞台：1920 × 1080，等比缩放居中 ---------------- */
  const viewport = ref({ w: window.innerWidth, h: window.innerHeight })
  const scale = computed(() =>
    Math.min(viewport.value.w / 1920, viewport.value.h / 1080)
  )
  const stageStyle = computed(() => ({
    left: `${(viewport.value.w - 1920 * scale.value) / 2}px`,
    top: `${(viewport.value.h - 1080 * scale.value) / 2}px`,
    transform: `scale(${scale.value})`
  }))
  function onResize() {
    viewport.value = { w: window.innerWidth, h: window.innerHeight }
    nextTick(() => sceneRef.value?.resize())
  }

  /* ---------------- 三维、标签、选中 ---------------- */
  const sceneRef = shallowRef(null)
  const anchors = shallowRef({})
  const moved = ref(false)
  const selected = ref(null)
  const layers = reactive({
    sensors: true,
    dts: true,
    idlers: true,
    robot: true,
    people: false,
    alarm: true
  })
  let raf = 0
  // 标签跟着三维投影走：每帧取一次锚点（相机被拖动时标签同步移动）
  function trackAnchors() {
    raf = requestAnimationFrame(trackAnchors)
    const sc = sceneRef.value
    if (!sc?.model) return
    anchors.value = sc.anchors()
    moved.value = !!sc.userMoved
  }
  function onPick(id) {
    selected.value = selected.value === id ? null : id
    sceneRef.value?.select(selected.value)
  }
  /** 点平台预警（告警列表 / 场景卡片）：镜头沿皮带飞到劣化托辊组旁边 */
  function onAlarm(a) {
    if (a && !a.platform) return
    sceneRef.value?.flyTo("hot")
  }
  function toggleLayer(key) {
    layers[key] = !layers[key]
    sceneRef.value?.setLayer(key, layers[key])
  }
  function goHome() {
    sceneRef.value?.flyTo("home")
  }

  let timer = 0
  let hooks = null
  onMounted(async () => {
    window.addEventListener("resize", onResize)
    tick()
    timer = setInterval(tick, 1000)
    raf = requestAnimationFrame(trackAnchors)
    const sc = new HeadScene(canvasRef.value, {
      onPick,
      scale: () => scale.value
    })
    sceneRef.value = markRaw(sc)
    sc.setState(d.value)
    // 开发模式下暴露场景实例，便于在控制台里调试
    if (import.meta.env.DEV) window.__coalScene = sc
    hooks = installDashboardHooks({
      scene: sc,
      panels: () => [
        ...pageRef.value.querySelectorAll(
          ".top, .col, .scene-ui, .linemap, .bottom"
        )
      ],
      states: {
        // 定稿那一刻（2026-10-27 18:40）
        design: () => {
          pinned.value = DESIGN_T
          selected.value = null
          sc.select(null)
          sc.goHome()
          tick()
        },
        latest: () => {
          pinned.value = null
          tick()
        }
      }
    })
    try {
      await sc.ready
      msg.value = ""
      for (const k of Object.keys(layers)) sc.setLayer(k, layers[k])
    } catch (e) {
      // 图片加载失败时 e 是 DOM 事件（没有 message），把出错的地址显示出来
      msg.value = `三维模型加载失败：${e?.message || e?.target?.src || e}`
      throw e
    }
    await document.fonts.ready
    hooks.markReady()
  })
  onBeforeUnmount(() => {
    window.removeEventListener("resize", onResize)
    clearInterval(timer)
    cancelAnimationFrame(raf)
    hooks?.uninstall()
    if (import.meta.env.DEV) delete window.__coalScene
    sceneRef.value?.dispose()
  })
</script>

<!--
  矿井智能防灭火与应急避灾大屏（青崖煤矿 2# 煤层：企业名是虚构的，巷网照用户提供的真实矿井 CAD 避灾路线图）
  ----------------------------------------------------------
  还原基准：docs/design/mine-fire/design/final.png（A 透视巷网 · 应急指挥）。布局以 CAD 为准（data/plan.json，
  scripts/mine-fire/plan.py 生成），概念图只定风格、镜头和特效。页面只负责布局与数据转接：
    - 三维：./scene（不依赖 Vue），程序化巷网沙盘，主机位 = 定稿概念图反求的相机（data/camera.json）
    - 数据：./sim/simulator.js 火情演练剧本（16 分钟一轮，状态只由剧本秒 s 决定），./store/playback.js 按段变速回放
    - 面板：./components（定稿 HTML 面板的移植，样式 ./styles/board.scss）
  版面：定稿是 1920 × 1080 的固定构图。画布铺满窗口，面板放在按 16:9 居中的"舞台"里（rem 缩放），
  三维投影中心按舞台位置换算（scene 的 origin 选项）。
  深链：?at=14:06:18 钉在定稿那一刻；?start=14:03:40 从某一刻开始播放；?tour=0 关掉自动镜头；?speed=1 全程实时；
  ?tab=fire 打开页签。
-->
<template>
  <div ref="pageRef" class="mine-fire-page">
    <canvas ref="canvasRef" class="scene"></canvas>
    <div class="stage" :style="stageStyle">
      <div class="vignette"></div>
      <div class="scan"></div>
      <template v-if="ready && st">
        <SceneTags
          v-if="sceneRef"
          :scene="sceneRef"
          :st="st"
          :sim="sim"
          :unit="designUnit"
          :origin="stageOrigin"
          @select="onSelect"
          @refuge="onRefuge"
        />
        <SceneOverlay
          :st="st"
          :view="view"
          :layers="layers"
          :playing="pb.playing.value"
          :speed="pb.speed.value"
          @view="onView"
          @layer="toggleLayer"
          @toggle="pb.toggle()"
          @restart="pb.restart()"
        />
        <PageHeader :st="st" :tab="tab" @tab="onTab" />
        <LeftColumn :st="st" :selected="selected" @select="onSelect" />
        <RightColumn :st="st" @locate="onView('ds04')" @refuge="onRefuge" />
        <BottomStrip :st="st" :trend="trend" />
      </template>
    </div>
    <div v-if="!ready && !error" class="scene-loading">正在加载三维巷网…</div>
    <div v-if="error" class="scene-error">{{ error }}</div>
  </div>
</template>

<script setup>
  import { MineFireScene } from "./scene/MineFireScene.js"
  import { createMineFireSim, KEY, DESIGN_S } from "./sim/simulator.js"
  import { createPlayback } from "./store/playback.js"
  import { installDashboardHooks } from "./dev/hooks.js"
  import { CHAMBERS } from "./data/site.js"
  import plan from "./data/plan.json"
  import PageHeader from "./components/PageHeader.vue"
  import LeftColumn from "./components/LeftColumn.vue"
  import RightColumn from "./components/RightColumn.vue"
  import BottomStrip from "./components/BottomStrip.vue"
  import SceneOverlay from "./components/SceneOverlay.vue"
  import SceneTags from "./components/SceneTags.vue"
  import "./styles/board.scss"
  import "./styles/page.scss"

  const route = useRoute()

  /** ?at=14:06:18 → 剧本秒 */
  function parseAt(v) {
    if (!v) return null
    const [h, m, s = 0] = String(v).split(":").map(Number)
    const t = h * 3600 + m * 60 + s - 14 * 3600
    return Number.isFinite(t) && t >= 0 ? t : null
  }
  const pinned = parseAt(route.query.at)
  const autoCam = route.query.tour !== "0" && pinned === null

  const sim = createMineFireSim(plan)
  const pb = createPlayback({
    pinned,
    // 不钉住时默认从 14:01:00 开始播（约 8 s 后出现一级预警）
    start: parseAt(route.query.start) ?? 60,
    speed: route.query.speed ? Number(route.query.speed) : null
  })

  const pageRef = ref(null)
  const canvasRef = ref(null)
  const ready = ref(false)
  const error = ref("")
  const tab = ref(String(route.query.tab || "overview"))
  const view = ref("home")
  const selected = ref(null)
  // 三维场景是普通类实例，不能让 Vue 做深层响应
  const sceneRef = shallowRef(null)

  /* ---------------- 面板数据：剧本每走 1 秒重算一次 ---------------- */
  const st = shallowRef(sim.at(pb.s.value))
  const trend = shallowRef(sim.trend(pb.s.value))
  let lastSec = -1
  watch(
    pb.s,
    (s) => {
      sceneRef.value?.setTime(s)
      const sec = Math.floor(s)
      if (sec === lastSec) return
      lastSec = sec
      st.value = sim.at(sec)
      trend.value = sim.trend(sec)
    },
    { immediate: true }
  )
  watch(st, (v) => {
    if (sceneRef.value && ready.value) sceneRef.value.setState(v)
    autoCamera(v)
  })

  /* ---------------- 舞台：16:9，按窗口居中 ---------------- */
  const viewport = ref({ w: 1920, h: 1080 })
  /**
   * 页面缩放（同 /smart-ranch、/smart-conveyor）：rem = min(宽, 高 × 16 / 9) / 10，窗口偏扁时整体按高度缩小，
   * 侧栏不被裁；离开页面时还原成按宽度（amfe-flexible 的规则）
   */
  function fitRem() {
    const el = document.documentElement
    viewport.value = { w: el.clientWidth, h: el.clientHeight }
    const sw = Math.min(el.clientWidth, (el.clientHeight * 16) / 9)
    el.style.fontSize = `${sw / 10}px`
  }
  const stageBox = computed(() => {
    const { w: vw, h: vh } = viewport.value
    const sw = Math.min(vw, (vh * 16) / 9)
    const sh = (sw * 9) / 16
    return { x: (vw - sw) / 2, y: (vh - sh) / 2, w: sw, h: sh }
  })
  const stageStyle = computed(() => ({
    left: `${stageBox.value.x}px`,
    top: `${stageBox.value.y}px`
  }))
  /** 1 设计稿像素对应多少 CSS 像素 */
  const designUnit = () => stageBox.value.w / 1920
  const stageOrigin = () => [stageBox.value.x, stageBox.value.y]
  function onResize() {
    fitRem()
    sceneRef.value?.resize()
  }

  /* ---------------- 图层 / 视角 / 页签 ---------------- */
  const layers = reactive({
    tubes: true,
    airflow: true,
    people: true,
    sensors: true,
    routes: true
  })
  function toggleLayer(k) {
    layers[k] = !layers[k]
    sceneRef.value?.setLayer(k, layers[k])
  }
  function onView(k) {
    view.value = k
    userTouched()
    sceneRef.value?.flyToView(k)
  }
  /** 页签 → 默认三维焦点（面板内容各页签共用，定稿只画了综合态势） */
  function onTab(k) {
    tab.value = k
    userTouched()
    const go = {
      overview: "home",
      chambers: "hub",
      fire: "ds04",
      routes: "home",
      ops: "DS-03",
      replay: "home"
    }[k]
    if (k === "routes" && !layers.routes) toggleLayer("routes")
    // 历史回放：从剧本开头重放一遍
    if (k === "replay") pb.restart()
    view.value = ["home", "hub", "ds04"].includes(go) ? go : ""
    sceneRef.value?.flyToView(go)
  }
  function onSelect(id) {
    selected.value = id
    userTouched()
    view.value = id === "DS-04" ? "ds04" : ""
    sceneRef.value?.flyToView(id === "DS-04" ? "ds04" : id)
  }
  function onRefuge(id) {
    userTouched()
    view.value = id === "RC-01" ? "refuge" : ""
    const sc = sceneRef.value
    if (sc) sc.flyTo(sc.props.refuges[id].center.clone(), 7000)
  }

  /* ---------------- 自动镜头：确认火灾时飞到火点，喷放后回全景；用户操作后 30 s 内不打扰 ---------------- */
  let lastTouch = -Infinity
  let autoAt = null // 自动镜头当前所在：null / "fire"
  function userTouched() {
    lastTouch = performance.now()
  }
  function autoCamera(v) {
    const sc = sceneRef.value
    if (!autoCam || !sc || performance.now() - lastTouch < 30000) return
    const inFire = v.s >= KEY.confirm && v.s < KEY.feedback + 30
    if (inFire && autoAt !== "fire") {
      autoAt = "fire"
      view.value = "ds04"
      sc.flyToView("ds04")
    } else if (!inFire && autoAt === "fire") {
      autoAt = null
      view.value = "home"
      sc.flyHome()
    }
  }

  /* ---------------- 挂载 ---------------- */
  let hooks = null
  onMounted(async () => {
    fitRem()
    window.addEventListener("resize", onResize)
    for (const ev of ["pointerdown", "wheel", "keydown"])
      window.addEventListener(ev, userTouched, { passive: true })
    try {
      const sc = new MineFireScene(canvasRef.value, {
        plan,
        chambers: CHAMBERS,
        sim,
        unit: designUnit,
        origin: stageOrigin,
        onPick: (hit) => {
          if (!hit) return
          if (hit.kind === "chamber") onSelect(hit.id)
          if (hit.kind === "refuge") onRefuge(hit.id)
        },
        onUserCamera: () => {
          userTouched()
          view.value = ""
        }
      })
      sceneRef.value = markRaw(sc)
      sc.setTime(pb.s.value)
      sc.setState(st.value)
    } catch (e) {
      error.value = `三维初始化失败：${e.message}`
      throw e
    }
    const sc = sceneRef.value
    hooks = installDashboardHooks({
      scene: sc,
      // 截图冻结画面时停掉回放
      onFreeze: (on) => (pb.playing.value = !on && pinned === null),
      panels: () => [
        ...pageRef.value.querySelectorAll(".pn, .hd, .tags, .overlay")
      ],
      states: {
        design: () => {
          pb.playing.value = false
          pb.seek(DESIGN_S)
          view.value = "home"
          sc.setView("home")
        },
        latest: () => {
          pb.playing.value = true
        }
      }
    })
    if (import.meta.env.DEV)
      window.__mineFirePage = {
        pb,
        sim,
        st: () => st.value,
        onTab,
        onView,
        toggleLayer,
        layers
      }
    pb.start()
    ready.value = true
    if (route.query.tab) onTab(tab.value)
    await nextTick()
    await document.fonts.ready
    hooks.markReady()
  })

  onBeforeUnmount(() => {
    pb.stop()
    window.removeEventListener("resize", onResize)
    for (const ev of ["pointerdown", "wheel", "keydown"])
      window.removeEventListener(ev, userTouched)
    hooks?.uninstall()
    sceneRef.value?.dispose()
    // 还原成 amfe-flexible 的按宽度缩放
    document.documentElement.style.fontSize = `${document.documentElement.clientWidth / 10}px`
  })
</script>

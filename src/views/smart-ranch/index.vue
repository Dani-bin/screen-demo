<!--
  智慧牧场 · 草畜平衡与畜群监管平台（莫日格勒河示范牧场，呼伦贝尔陈巴尔虎旗）
  ----------------------------------------------------------
  页面只负责布局与数据转接：
    - 三维沙盘：./scene（不依赖 Vue）。地形 Copernicus GLO-30、影像与逐月 NDVI Sentinel-2 都是真实数据
      （public/smart-ranch/，scripts/smart-ranch/prepare.py 生成）；牧场本身（轮牧分区、营地、饮水点、畜群）是虚构的
    - 运行数据：./sim/simulator.js，大屏设定在 2026 年 7–8 月放牧期、时刻跟北京时间走，每秒刷新
  交互：自动巡游（有人操作就停，空闲 45 秒恢复）、新告警自动联动（镜头飞到事发处 15 秒）、
  点地图 / 畜群徽标 / 表格行选中对象、功能导航切图层和镜头、搜索编号、长势月份播放、测距。
  链接参数：?tab=overview|grass|rotation|herds|devices|ops|video、?tour=0 关闭巡游、
  ?focus=SF-04（打开就飞到某个编号）、?at=2026-07-25T13:58（仿真从这一刻开始走）
  定稿：docs/design/smart-ranch/design/final.png
-->
<template>
  <div ref="pageRef" class="ranch-page">
    <div ref="stageRef" class="stage"></div>

    <SceneLabels
      v-if="state && anchors"
      :a="anchors"
      :state="state"
      :layout="layout"
      :alarm="alarm"
      :selected="sel?.type === 'herd' ? sel.id : ''"
      :devices="showDevices"
      :measure="measure"
      @herd="(id) => select({ type: 'herd', id })"
      @water="(id) => select({ type: 'water', id })"
      @hq="select({ type: 'hq', id: 'HQ-01' })"
      @alarm="focusAlarm()"
    />

    <template v-if="state">
      <RanchHead
        :state="state"
        :layout="layout"
        :hourly="hourly"
        :events="events"
        :tab="tab"
        :on-search="search"
        @tab="setTab"
      />

      <aside ref="leftRef" class="col left">
        <BalanceCard
          :state="state"
          @unit="(id) => select({ type: 'unit', id })"
        />
        <NdviCard
          :state="state"
          :layout="layout"
          :month="Math.round(month)"
          @paddock="(id) => select({ type: 'paddock', id })"
        />
        <RotationCard
          :state="state"
          @unit="(id) => select({ type: 'unit', id })"
        />
        <WeatherCard :state="state" />
        <WeighCard :state="state" />
      </aside>

      <aside ref="rightRef" class="col right">
        <AlarmCard
          :alarm="alarm"
          :layout="layout"
          :img="IMG[0]"
          @act="alarmAct"
        />
        <AlarmStats :events="events" :now="state.t.hours" @event="linkEvent" />
        <HerdsCard
          :state="state"
          :selected="sel?.type === 'herd' ? sel.id : ''"
          @herd="(id) => select({ type: 'herd', id })"
        />
        <VideoCard
          :state="state"
          :layout="layout"
          :alarm="alarm"
          :imgs="IMG"
          :focus="videoFocus"
        />
      </aside>

      <div class="dock">
        <StockCard :state="state" />
        <OpsCard :state="state" />
        <WaterCard
          :state="state"
          :supplied="hourly.supplied"
          @water="(id) => select({ type: 'water', id })"
        />
        <DeviceCard :state="state" :layout="layout" />
      </div>
    </template>

    <MapTools
      v-if="ready"
      :layer="layer"
      :herds="showHerds"
      :devices="showDevices"
      :view="viewKey"
      :touring="touring"
      :measuring="measuring"
      :month="month"
      :playing="playing"
      @layer="setLayer"
      @view="setViewKey"
      @tool="useTool"
      @month="(m) => setMonth(m, true)"
      @play="playMonths"
    />

    <DetailPopup
      v-if="state && sel"
      :sel="sel"
      :state="state"
      :layout="layout"
      @close="clearSel"
    />

    <Transition name="fade">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </Transition>

    <div class="credit">
      地形 Copernicus GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and
      Space GmbH 2014-2018 · 影像与 NDVI：Contains modified Copernicus Sentinel
      data 2025–2026 · 牧场布局与运行数据为演示 · 拖动旋转、滚轮缩放、点选查看
    </div>

    <div v-if="loading" class="scene-loading">真实地形与卫星影像加载中…</div>
    <div v-if="error" class="scene-error">{{ error }}</div>
  </div>
</template>

<script setup>
  import gsap from "gsap"

  import layout from "./data/layout.json"
  import { RanchScene } from "./scene/RanchScene.js"
  import { THEMES } from "./scene/theme.js"
  import { createRanchSim, inPolygon, msForDemo } from "./sim/simulator.js"
  import { locateEvent, pickAlarm } from "./utils.js"
  import RanchHead from "./components/RanchHead.vue"
  import SceneLabels from "./components/SceneLabels.vue"
  import MapTools from "./components/MapTools.vue"
  import DetailPopup from "./components/DetailPopup.vue"
  import BalanceCard from "./components/cards/BalanceCard.vue"
  import NdviCard from "./components/cards/NdviCard.vue"
  import RotationCard from "./components/cards/RotationCard.vue"
  import WeatherCard from "./components/cards/WeatherCard.vue"
  import WeighCard from "./components/cards/WeighCard.vue"
  import AlarmCard from "./components/cards/AlarmCard.vue"
  import AlarmStats from "./components/cards/AlarmStats.vue"
  import HerdsCard from "./components/cards/HerdsCard.vue"
  import VideoCard from "./components/cards/VideoCard.vue"
  import StockCard from "./components/cards/StockCard.vue"
  import OpsCard from "./components/cards/OpsCard.vue"
  import WaterCard from "./components/cards/WaterCard.vue"
  import DeviceCard from "./components/cards/DeviceCard.vue"

  const route = useRoute()
  const THEME = THEMES.a

  /**
   * 页面缩放。全站由 amfe-flexible 按宽度设 rem（1rem = 视口宽 / 10），
   * 本页两侧栏的卡片排满到底，而浏览器窗口去掉标签栏、地址栏后通常比 16:9 扁，按宽缩放会把左栏底部挤出屏幕。
   * 所以本页改成按宽、高取小：rem = min(宽, 高 × 16 / 9) / 10，窗口偏扁时界面整体按高度缩小、两侧栏贴边。
   * amfe-flexible 的 resize 监听先注册，本页的后注册、后执行，覆盖它的结果；离开页面时还原成按宽度。
   */
  function fitRem() {
    const el = document.documentElement
    const w = Math.min(el.clientWidth, (el.clientHeight * 16) / 9)
    el.style.fontSize = `${w / 10}px`
  }
  /** 1 设计稿像素对应多少 CSS 像素（场景标注锚点、镜头偏移按它换算） */
  const designUnit = () =>
    parseFloat(document.documentElement.style.fontSize) / 192

  /*
   * 侧栏兜底：两侧栏的卡片排满到底，文字行高按整像素取整，不同缩放下会多出几像素；
   * 浏览器设了最小字号（部分中文版 Chrome 是 12px）时多得更多。装不下时整栏等比缩小，
   * 保证最后一张卡不被屏幕底边裁掉；装得下时不做任何处理。
   */
  const leftRef = ref(null)
  const rightRef = ref(null)
  function fitColumn(col) {
    if (!col) return
    const st = col.style
    st.transform = st.height = st.bottom = ""
    const avail = col.clientHeight
    const last = col.lastElementChild
    // 最后一张卡平时伸展填满剩余高度，量内容的自然高度时先不让它伸展
    last.style.flexGrow = "0"
    const need = col.scrollHeight
    last.style.flexGrow = ""
    // 1 px 以内的取整误差不处理，免得 1920 × 1080 下也被缩放、和定稿错开半像素
    if (need <= avail + 1) return
    st.bottom = "auto"
    st.height = `${need}px`
    st.transform = `scale(${avail / need})`
  }
  let fitFrame = 0
  function fitColumns() {
    cancelAnimationFrame(fitFrame)
    fitFrame = requestAnimationFrame(() => {
      fitColumn(leftRef.value)
      fitColumn(rightRef.value)
    })
  }
  // 窗口缩放、卡片内容变化（告警出现 / 消失）都会改变高度，统一由 ResizeObserver 触发
  const colObserver = new ResizeObserver(fitColumns)
  watch([leftRef, rightRef], (cols) => {
    colObserver.disconnect()
    for (const c of cols)
      if (c) for (const el of [c, ...c.children]) colObserver.observe(el)
  })
  const BASE = import.meta.env.BASE_URL
  /** 告警卡片、视频监控用的近景画面（Figma AI 概念图，示意） */
  const IMG = [
    `${BASE}smart-ranch/closeup-a.webp`,
    `${BASE}smart-ranch/closeup-b.webp`
  ]
  /** 全景镜头：和定稿同一个机位（docs/design/smart-ranch/drafts-ui.js 的 cameraV2） */
  const OVERVIEW = {
    target: [150, 100],
    dist: 31500,
    yaw: -5,
    pitch: 42,
    fov: 27,
    shift: [-30, -24]
  }
  const close = (pos, dist, pitch = 38) => ({
    target: pos,
    dist,
    yaw: -5,
    pitch,
    shift: [-30, -24]
  })
  /** 巡游：全景停 14 秒 → 一个畜群近景 9 秒 → 回全景，依次轮换畜群 */
  const TOUR_OVERVIEW = 14
  const TOUR_HERD = 9
  /** 用户操作后多久恢复巡游、告警联动停留多久（秒） */
  const IDLE = 45
  const LINK_HOLD = 15

  const pageRef = ref(null)
  const stageRef = ref(null)
  const loading = ref(true)
  const error = ref("")
  const ready = ref(false)

  /**
   * 仿真时钟：默认就是现在；?at=2026-07-25T13:58 把仿真固定从这一刻开始走（设计稿比对、演示截图用）
   */
  const AT = String(route.query.at || "").match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})$/
  )
  const T_START = Date.now()
  const T_AT = AT ? msForDemo(AT[1], Number(AT[2]) + Number(AT[3]) / 60) : 0
  /** 仿真时钟的拨动量（毫秒）：只有开发模式的录屏接口 seek 会改它，平时恒为 0 */
  let skew = 0
  const now = () => (AT ? T_AT + (Date.now() - T_START) : Date.now()) + skew

  const sim = createRanchSim(layout)
  /** 面板数据：整份替换，不需要深层响应 */
  const state = shallowRef(sim.at(now()))
  const hourly = shallowRef({ walk: [], online: [], supplied: [] })
  const anchors = shallowRef(null)

  const tab = ref("overview")
  const layer = ref("ndvi")
  const showHerds = ref(false)
  const showDevices = ref(false)
  const viewKey = ref("overview")
  const touring = ref(false)
  const month = ref(state.value.t.month)
  const playing = ref(false)
  /** 选中的对象：{ type: herd | paddock | water | unit | hq, id } */
  const sel = ref(null)
  /** 正在联动的告警编号；手动关闭的告警 */
  const linked = ref("")
  const dismissed = reactive(new Set())
  const replay = ref("")
  const videoFocus = ref("")
  const toast = ref("")
  const measuring = ref(false)
  const measure = ref(null)
  let measurePts = []
  let heat = []

  let scene = null
  let timer = 0
  let tourToken = 0
  let idleTimer = 0
  let linkTimer = 0
  let alive = true

  /** 今日已发生的事件（新的在前） */
  const events = computed(() =>
    [...state.value.events.today].sort((a, b) => b.start - a.start)
  )
  /** 告警卡片 / 标注显示的告警：正在联动的那条，否则按严重程度挑一条未关闭的 */
  const alarm = computed(() => {
    const st = state.value
    const active = st.events.active.filter((e) => !dismissed.has(e.id))
    const hit = active.find((e) => e.id === linked.value)
    return hit ? locateEvent(hit, st, layout) : pickAlarm(st, layout, active)
  })

  function say(text, ms = 2600) {
    toast.value = text
    clearTimeout(say.t)
    say.t = setTimeout(() => (toast.value = ""), ms)
  }

  // ---------------- 仿真刷新 ----------------

  const seen = new Set()
  function tick(first = false) {
    const st = sim.at(now())
    state.value = st
    // 新告警：刚发生（3 分钟内）的自动联动；页面刚打开时已经在进行的不抢镜头
    for (const e of st.events.active) {
      if (seen.has(e.id)) continue
      seen.add(e.id)
      if (
        !first &&
        st.t.hours - e.start < 0.05 &&
        ["fence", "stray", "water"].includes(e.kind)
      )
        linkEvent(e)
    }
    if (scene) scene.update(st, sceneOpts())
  }

  /** 今日逐时序列（走势小图）：每 5 分钟重算一次 */
  function refreshHourly() {
    const ms = now()
    const h0 = state.value.t.hours
    const snaps = []
    for (let h = 0; h <= Math.floor(h0); h++)
      snaps.push(sim.at(ms - (h0 - h) * 3600000))
    snaps.push(state.value)
    hourly.value = {
      walk: snaps.map((s) => s.ranch.avgWalkKm),
      online: snaps.map((s) => s.collars.online),
      supplied: snaps.map((s) => s.ranch.suppliedM3)
    }
    // 放牧热力：今天各畜群每 10 分钟的位置，按羊单位加权
    heat = []
    for (const h of state.value.herds)
      for (const p of sim.track(h.id, ms, 24, 10))
        heat.push([p[0], p[1], h.su / 700])
  }

  /** 告警畜群的今日轨迹（和定稿一致：告警联动时画出事畜群近 6 小时的走向） */
  function alarmTrail(ms) {
    const h = alarm.value?.herd
    if (!h || sel.value?.id === h) return []
    return [
      {
        id: `alarm-${h}`,
        points: sim.track(h, ms, 6, 2),
        color: THEME.lines.grazing,
        width: 3
      }
    ]
  }

  /** 场景参数：告警、轨迹、图层、选中高亮 */
  function sceneOpts() {
    const ms = now()
    const trails = []
    if (showHerds.value)
      for (const h of state.value.herds)
        trails.push({
          id: h.id,
          points: sim.track(h.id, ms, 6, 10),
          color: h.kind === "sheep" ? "#ffffff" : "#c08a5a",
          width: 2
        })
    if (sel.value?.type === "herd")
      trails.push({
        id: `sel-${sel.value.id}`,
        points: sim.track(sel.value.id, ms, 6, 2),
        color: THEME.lines.grazing,
        width: 3
      })
    if (replay.value)
      trails.push({
        id: `replay-${replay.value}`,
        points: sim.track(replay.value, ms, 2, 2),
        color: THEME.alarm,
        width: 3.5
      })
    if (measurePts.length === 2)
      trails.push({
        id: "measure",
        points: measurePts,
        color: "#1f3a2b",
        width: 2.5
      })
    return {
      alarm: alarm.value,
      trails: alarmTrail(ms).concat(trails),
      layer: layer.value,
      heat: layer.value === "heat" ? heat : null,
      stations: showDevices.value,
      highlight: sel.value?.type === "paddock" ? sel.value.id : null
    }
  }

  // ---------------- 镜头：巡游、联动 ----------------

  /** 等待 sec 秒；巡游被打断（token 变了）就返回 false */
  function wait(sec, my) {
    return new Promise((resolve) => {
      const end = performance.now() + sec * 1000
      const step = () => {
        if (my !== tourToken || !alive) return resolve(false)
        if (performance.now() >= end) return resolve(true)
        setTimeout(step, 200)
      }
      step()
    })
  }

  /** 畜群近景：约 1 km，牛羊换成单体模型、营地和饮水点看得清 */
  const herdView = (h) => close(h.pos, h.kind === "sheep" ? 1000 : 1150, 34)

  async function runTour() {
    if (!scene || route.query.tour === "0") return
    const my = ++tourToken
    touring.value = true
    let i = 0
    while (my === tourToken && alive) {
      viewKey.value = "overview"
      if (sel.value?.type === "herd") sel.value = null
      await scene.flyTo(OVERVIEW, 2.6)
      if (!(await wait(TOUR_OVERVIEW, my))) return
      const h = state.value.herds[i++ % state.value.herds.length]
      sel.value = { type: "herd", id: h.id }
      viewKey.value = "close"
      await scene.flyTo(herdView(h), 2.8)
      if (!(await wait(TOUR_HERD, my))) return
    }
  }

  function stopTour() {
    tourToken++
    touring.value = false
  }

  /** 有人操作：停巡游，空闲 IDLE 秒后恢复 */
  function userActed() {
    stopTour()
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (!linked.value) {
        sel.value = null
        runTour()
      }
    }, IDLE * 1000)
  }

  /** 告警联动：镜头飞到事发处停 LINK_HOLD 秒，然后回到巡游 */
  function linkEvent(e) {
    if (!scene) return
    const a = locateEvent(e, state.value, layout)
    linked.value = e.id
    stopTour()
    clearTimeout(idleTimer)
    viewKey.value = "close"
    sel.value =
      a.herd && e.kind !== "water"
        ? { type: "herd", id: a.herd }
        : { type: "water", id: e.target }
    scene.flyTo(close(a.pos, 1300, 32), 2.6)
    clearTimeout(linkTimer)
    linkTimer = setTimeout(() => {
      linked.value = ""
      replay.value = ""
      sel.value = null
      runTour()
    }, LINK_HOLD * 1000)
  }

  function focusAlarm() {
    if (alarm.value) linkEvent(alarm.value)
  }

  /** 告警卡片的处置按钮 */
  function alarmAct(k) {
    const a = alarm.value
    if (!a) return
    if (k === "video") {
      videoFocus.value = "CAM-08"
      say("正在调取现场摄像头 CAM-08 画面（演示画面为示意）")
      setTimeout(() => (videoFocus.value = ""), 6000)
    } else if (k === "replay") {
      replay.value = a.herd || ""
      if (!a.herd) return say("饮水点告警没有轨迹可回放")
      linkEvent(a)
      say(`回放 ${a.herd} 近 2 小时轨迹`)
    } else if (k === "call") say(`已呼叫放牧员 ${a.herder}（演示）`)
    else if (k === "close") {
      dismissed.add(a.id)
      if (linked.value === a.id) linked.value = ""
      say(`已关闭告警 ${a.title} · ${a.target}`)
    }
    tick()
  }

  // ---------------- 选中、搜索、测距 ----------------

  function viewFor(s) {
    const st = state.value
    if (s.type === "herd") return herdView(st.herds.find((h) => h.id === s.id))
    if (s.type === "paddock")
      return close(layout.paddocks.find((p) => p.id === s.id).center, 4800, 40)
    if (s.type === "water")
      return close(layout.water.find((w) => w.id === s.id).pos, 750, 32)
    if (s.type === "unit")
      return close(layout.units.find((u) => u.id === s.id).label, 6500, 40)
    return close(layout.hq.pos, 900, 32)
  }

  function select(s, fly = true) {
    userActed()
    sel.value = s
    viewKey.value = "close"
    if (fly && scene) scene.flyTo(viewFor(s), 2.2)
    tick()
  }

  function clearSel() {
    sel.value = null
    tick()
  }

  /** 点到地面：测距 > 畜群（300 m 内）> 饮水点（150 m 内）> 分区 */
  function onPick({ X, Y }) {
    userActed()
    if (measuring.value) {
      measurePts = measurePts.length === 2 ? [[X, Y]] : [...measurePts, [X, Y]]
      if (measurePts.length === 2) {
        const [a, b] = measurePts
        const km = Math.hypot(b[0] - a[0], b[1] - a[1]) / 1000
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        measure.value = {
          ...scene.project(m[0], m[1], 10),
          km: km.toFixed(2),
          X: m[0],
          Y: m[1]
        }
      } else measure.value = null
      return tick()
    }
    const st = state.value
    const near = (p, r) => Math.hypot(p[0] - X, p[1] - Y) < r
    const h = st.herds.find((x) => near(x.pos, 300))
    if (h) return select({ type: "herd", id: h.id })
    const w = layout.water.find((x) => near(x.pos, 150))
    if (w) return select({ type: "water", id: w.id })
    const p = layout.paddocks.find((x) => inPolygon([X, Y], x.polygon))
    if (p) return select({ type: "paddock", id: p.id }, false)
    clearSel()
  }

  /** 搜索编号：畜群 / 单头牛 / 项圈 / 分区 / 单元 / 饮水点 / 场部 */
  function search(q) {
    const id = q.toUpperCase().replace(/\s+/g, "")
    const st = state.value
    if (st.herds.some((h) => h.id === id))
      return select({ type: "herd", id }), true
    const cow = id.match(/^(CH-\d{2})-\d{3}$/)
    if (cow && st.herds.some((h) => h.id === cow[1]))
      return select({ type: "herd", id: cow[1] }), true
    if (/^CL-\d{4}$/.test(id))
      for (const h of sim.herds) {
        const n = h.kind === "sheep" ? 3 : h.head
        for (let k = 0; k < n; k++)
          if (sim.collarId(h.id, k) === id)
            return select({ type: "herd", id: h.id }), true
      }
    if (layout.paddocks.some((p) => p.id === id))
      return select({ type: "paddock", id }), true
    if (layout.units.some((u) => u.id === id))
      return select({ type: "unit", id }), true
    if (layout.water.some((w) => w.id === id))
      return select({ type: "water", id }), true
    if (id === "HQ-01" || id === "HQ")
      return select({ type: "hq", id: "HQ-01" }), true
    say(
      `没有找到"${q}"，可输入 SF-03、CH-01-023、CL-0010、U03-2、WP-09 这类编号`
    )
    return false
  }

  // ---------------- 图层、视角、月份、功能导航 ----------------

  function setLayer(k) {
    if (k === "herds") showHerds.value = !showHerds.value
    else if (k === "devices") showDevices.value = !showDevices.value
    else {
      layer.value = k
      // 轮牧 / 热力图层下长势色带淡下去，免得颜色打架
      gsap.to(scene.surface.material.uniforms.uNdviMix, {
        value: k === "ndvi" ? THEME.ndviMix : 0.1,
        duration: 0.6
      })
    }
    tick()
  }

  function setViewKey(k) {
    if (k === "tour") {
      if (touring.value) return userActed()
      clearTimeout(idleTimer)
      return runTour()
    }
    userActed()
    viewKey.value = k
    if (k === "overview") scene.flyTo(OVERVIEW, 2.2)
    else if (k === "top")
      scene.flyTo({ ...OVERVIEW, pitch: 88, yaw: 0, dist: 27000 }, 2.2)
  }

  function useTool(k) {
    if (k === "measure") {
      measuring.value = !measuring.value
      measurePts = []
      measure.value = null
      say(measuring.value ? "测距：在沙盘上依次点两个点" : "已退出测距")
      tick()
    } else if (k === "reset") {
      userActed()
      sel.value = null
      measuring.value = false
      measurePts = []
      measure.value = null
      viewKey.value = "overview"
      scene.flyTo(OVERVIEW, 2.2)
      tick()
    }
  }

  /** 长势月份：地表色带在两个月之间平滑过渡 */
  function setMonth(m, user = false) {
    if (user) {
      playMonths.tl?.kill()
      playing.value = false
    }
    const proxy = { m: month.value }
    gsap.to(proxy, {
      m,
      duration: 0.8,
      onUpdate: () => {
        month.value = proxy.m
        scene?.setMonth(proxy.m)
      }
    })
  }

  /** 播放 4–10 月长势，结束后回到当月 */
  function playMonths() {
    if (playing.value) {
      playMonths.tl?.kill()
      playing.value = false
      return setMonth(state.value.t.month)
    }
    playing.value = true
    const proxy = { m: 4 }
    playMonths.tl = gsap.timeline({
      onComplete: () => ((playing.value = false), setMonth(state.value.t.month))
    })
    playMonths.tl
      .to(proxy, {
        m: 4,
        duration: 0.01,
        onUpdate: () => ((month.value = proxy.m), scene.setMonth(proxy.m))
      })
      .to(proxy, {
        m: 10,
        duration: 8,
        ease: "none",
        onUpdate: () => ((month.value = proxy.m), scene.setMonth(proxy.m))
      })
      .to({}, { duration: 1.5 })
  }

  /** 功能导航：切图层和镜头 */
  function setTab(k) {
    tab.value = k
    showHerds.value = k === "herds"
    showDevices.value = k === "devices"
    if (layer.value !== (k === "rotation" ? "rotation" : "ndvi"))
      setLayer(k === "rotation" ? "rotation" : "ndvi")
    if (k === "overview") {
      sel.value = null
      clearTimeout(idleTimer)
      runTour()
    } else {
      userActed()
      if (k === "ops") select({ type: "hq", id: "HQ-01" })
      else if (k === "video") {
        videoFocus.value = "CAM-08"
        if (alarm.value) linkEvent(alarm.value)
        else select({ type: "water", id: "WP-14" })
      } else {
        sel.value = null
        viewKey.value = "overview"
        scene.flyTo(OVERVIEW, 2.2)
      }
      if (k === "grass") playMonths()
    }
    tick()
  }

  // ---------------- 生命周期 ----------------

  function hasWebGL() {
    const c = document.createElement("canvas")
    const gl = c.getContext("webgl2")
    gl?.getExtension("WEBGL_lose_context")?.loseContext()
    return Boolean(gl)
  }

  function onResize() {
    fitRem()
    scene?.resize()
  }
  /** 从往返缓存恢复时 amfe-flexible 会重设 rem，这里再覆盖一次 */
  function onPageShow(e) {
    if (e.persisted) onResize()
  }

  /*
   * 开发模式的录屏接口（抖音视频分镜 docs/design/smart-ranch/douyin/shots.mjs 用，生产构建里没有）：
   * seek 把仿真时钟拨到某一时刻、tick 立刻刷新一次，分镜分开录也能接在同一条时间轴上
   */
  if (import.meta.env.DEV)
    window.__ranchPage = {
      now,
      sim,
      seek: (ms) => (skew += ms - now()),
      tick: () => tick(),
      setMonth,
      setTab,
      select
    }

  onMounted(async () => {
    fitRem()
    window.addEventListener("resize", onResize)
    window.addEventListener("pageshow", onPageShow)
    // 仿真先跑起来：面板不依赖三维，WebGL 不可用时照常显示
    tick(true)
    refreshHourly()
    timer = setInterval(() => {
      tick()
      if (Math.floor(Date.now() / 1000) % 300 === 0) refreshHourly()
    }, 1000)
    if (!hasWebGL()) {
      error.value = "当前浏览器不支持三维展示（需要 WebGL 2）"
      loading.value = false
      return
    }
    await nextTick()
    try {
      const s = new RanchScene(stageRef.value, {
        layout,
        theme: THEME,
        baseUrl: BASE,
        unit: designUnit
      })
      await s.load()
      if (!alive) return s.dispose()
      scene = s
      // 开场：从更远处缓缓推到全景
      s.setView({ ...OVERVIEW, dist: OVERVIEW.dist * 1.35, pitch: 50 })
      s.setMonth(month.value)
      s.startLive(state.value, {
        onAnchors: (a) => (anchors.value = a),
        onPick,
        onUser: userActed
      })
      tick()
      ready.value = true
      loading.value = false
      // 开发环境把场景挂到 window 上（截图脚本、调试用）
      if (import.meta.env.DEV) window.__ranchScene = s
      await s.flyTo(OVERVIEW, 3)
      const t = route.query.tab
      if (route.query.focus) search(String(route.query.focus))
      else if (t && t !== "overview") setTab(String(t))
      else runTour()
    } catch (err) {
      console.error(err)
      error.value = "地形数据加载失败"
      loading.value = false
    }
  })

  onUnmounted(() => {
    alive = false
    tourToken++
    clearInterval(timer)
    clearTimeout(idleTimer)
    clearTimeout(linkTimer)
    playMonths.tl?.kill()
    window.removeEventListener("resize", onResize)
    window.removeEventListener("pageshow", onPageShow)
    colObserver.disconnect()
    cancelAnimationFrame(fitFrame)
    scene?.dispose()
    scene = null
    // 还原成全站的按宽度缩放（amfe-flexible 的算法）
    const el = document.documentElement
    el.style.fontSize = `${el.clientWidth / 10}px`
  })
</script>

<style lang="scss">
  /*
   * 页面级样式（不加 scoped，统一挂在 .ranch-page 下，各卡片组件直接用这些类名）。
   * 尺寸按 1920 × 1080 设计稿写 px，构建时转成 rem 随屏幕缩放。和定稿 design/final.png 对应。
   */
  .ranch-page {
    --ink: #1f3a2b;
    --sub: #5c6f66;
    --line: rgba(31, 58, 43, 0.12);
    --accent: #2b7bd6;
    --ok: #2f8f4e;
    --bad: #e5484d;
    --card: rgba(255, 255, 255, 0.74);
    --num: "DIN", "Source Han Sans CN", sans-serif;

    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    font-family: "Source Han Sans CN", sans-serif;
    // Tailwind 基础样式把 html 行高设成 1.5，定稿是按浏览器默认行高排的
    line-height: normal;
    color: var(--ink);
    background: linear-gradient(180deg, #bcd6ec 0%, #dfe9f1 46%, #eef2ec 100%);
    user-select: none;

    h1,
    h3,
    p,
    ul,
    dl,
    dd,
    figure {
      margin: 0;
      padding: 0;
    }
    ul {
      list-style: none;
    }

    .stage {
      position: absolute;
      inset: 0;
    }

    .labels {
      position: absolute;
      inset: 0;
      pointer-events: none;
      .lb {
        position: absolute;
        pointer-events: auto;
        cursor: pointer;
      }
    }

    /* ---------- 顶栏 ---------- */
    .top {
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 22px 30px 0;
      pointer-events: none;
    }
    .brand {
      display: flex;
      gap: 14px;
      align-items: center;
      h1 {
        font:
          30px/1.1 "Alimama ShuHeiTi",
          sans-serif;
        letter-spacing: 1px;
      }
      p {
        margin-top: 6px;
        font-size: 14px;
        color: var(--sub);
        letter-spacing: 2px;
      }
    }
    .logo {
      width: 42px;
      height: 42px;
      border-radius: 12px;
      background: radial-gradient(
          circle at 50% 120%,
          var(--ok) 0 55%,
          transparent 56%
        ),
        radial-gradient(circle at 70% 30%, #f6c453 0 16%, transparent 17%),
        var(--accent);
    }
    .clock {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
      font-size: 14px;
      color: var(--sub);
      b {
        font: 30px/1 var(--num);
        color: var(--ink);
        letter-spacing: 1px;
      }
      .cw {
        font-size: 13px;
        color: #c0661c;
      }
    }
    .glass {
      background: var(--card);
      border: 1px solid rgba(255, 255, 255, 0.8);
      box-shadow: 0 8px 24px rgba(40, 70, 60, 0.12);
      backdrop-filter: blur(14px) saturate(1.2);
    }
    .kpis {
      position: absolute;
      left: 456px;
      right: 300px;
      top: 14px;
      display: flex;
      gap: 8px;
    }
    .kpi {
      flex: 1;
      height: 80px;
      padding: 7px 12px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      border-radius: 14px;
      @extend .glass;
      .k {
        font-size: 12px;
        color: var(--sub);
      }
      .kv {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 6px;
        white-space: nowrap;
      }
      b {
        font: 24px/1.05 var(--num);
        small {
          font:
            11px "Source Han Sans CN",
            sans-serif;
          margin-left: 2px;
          color: var(--sub);
        }
      }
      .sub {
        font-size: 11px;
        color: var(--sub);
        white-space: nowrap;
      }
      .spark {
        margin-bottom: 3px;
      }
      &.ok b {
        color: var(--ok);
      }
      &.bad b {
        color: var(--bad);
      }
    }
    .kmix {
      display: flex;
      width: 56px;
      height: 8px;
      margin-bottom: 7px;
      border-radius: 4px;
      overflow: hidden;
      gap: 1px;
      i:first-child {
        background: #7fbf7a;
      }
      i:last-child {
        background: #c08a5a;
      }
    }
    .tabs {
      position: absolute;
      left: 456px;
      right: 456px;
      top: 102px;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 5px;
      border-radius: 12px;
      font-size: 14px;
      @extend .glass;
      span {
        padding: 5px 13px;
        border-radius: 8px;
        color: var(--sub);
        cursor: pointer;
        &.on {
          color: #fff;
          background: var(--accent);
        }
      }
      .search {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 12px;
        border-radius: 8px;
        background: rgba(31, 58, 43, 0.06);
        i {
          width: 11px;
          height: 11px;
          border: 2px solid var(--sub);
          border-radius: 50%;
        }
        input {
          width: 150px;
          border: 0;
          outline: 0;
          font-size: 12px;
          color: var(--ink);
          background: transparent;
          &::placeholder {
            color: var(--sub);
          }
        }
        &.miss {
          box-shadow: inset 0 0 0 1px var(--bad);
        }
      }
    }

    /* ---------- 两侧栏、卡片 ---------- */
    .col {
      position: absolute;
      top: 102px;
      bottom: 18px;
      width: 412px;
      display: flex;
      flex-direction: column;
      gap: 9px;
      &.left {
        left: 24px;
        // 装不下时整栏等比缩小（fitColumn），贴着左上角缩
        transform-origin: left top;
      }
      &.right {
        right: 24px;
        transform-origin: right top;
      }
      > .card {
        flex-shrink: 0;
      }
      > .card:last-child {
        flex: 1 0 auto;
      }
    }
    .card {
      padding: 10px 14px;
      border-radius: 14px;
      @extend .glass;
      > header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 6px;
      }
      h3 {
        font:
          16px "Alimama ShuHeiTi",
          sans-serif;
        letter-spacing: 1px;
      }
      .hint {
        font-size: 11px;
        color: var(--sub);
      }
    }
    .chart {
      display: block;
      width: 100%;
      .grid {
        stroke: var(--line);
      }
      .tick {
        font: 11px var(--num);
        fill: var(--sub);
        &.on {
          fill: var(--ink);
          font-weight: bold;
        }
      }
    }
    .legend-line {
      display: flex;
      gap: 14px;
      font-size: 11px;
      color: var(--sub);
      margin-top: 4px;
      i {
        display: inline-block;
        width: 16px;
        height: 0;
        margin-right: 4px;
        vertical-align: middle;
        border-top: 2px solid var(--accent);
        &.dash {
          border-top: 2px dashed var(--sub);
        }
      }
    }
    .dn-v {
      font: 20px var(--num);
    }
    .dn-k {
      font-size: 10px;
      color: var(--sub);
    }

    /* 草畜平衡 */
    .bal2 {
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .bal-g {
      position: relative;
      width: 150px;
      .gauge {
        display: block;
        width: 150px;
      }
      .g-tick {
        font: 11px var(--num);
        fill: var(--sub);
      }
    }
    .bal-v {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 4px;
      text-align: center;
      b {
        display: block;
        font: 22px/1 var(--num);
      }
      span {
        font-size: 11px;
        color: var(--sub);
      }
    }
    .bal-n {
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex: 1;
      div {
        display: flex;
        align-items: baseline;
        gap: 6px;
        font-size: 12px;
        color: var(--sub);
      }
      span {
        width: 52px;
      }
      b {
        font: 18px var(--num);
        color: var(--ink);
      }
      .badv {
        color: var(--bad);
      }
    }
    .ubars {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 3px 14px;
      margin-top: 4px;
    }
    .ub-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      cursor: pointer;
      &.over .ub-val {
        color: var(--bad);
      }
      &.over .ub-su {
        background: var(--bad);
      }
    }
    .ub-id {
      width: 26px;
      font-family: var(--num);
      color: var(--sub);
    }
    .ub-track {
      position: relative;
      flex: 1;
      height: 6px;
      border-radius: 4px;
      background: var(--line);
      i {
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        border-radius: 4px;
      }
    }
    .ub-cap {
      border-right: 2px solid var(--ink);
      border-radius: 0 !important;
      z-index: 2;
    }
    .ub-su {
      opacity: 0.85;
      background: var(--ok);
    }
    .ub-val {
      width: 44px;
      text-align: right;
      font-family: var(--num);
    }

    /* 长势 + 分区矩阵 */
    .ndvi2 {
      display: flex;
      gap: 10px;
    }
    .ndvi2-chart {
      width: 250px;
    }
    .mx {
      flex: 1;
      font: 10px var(--num);
      color: var(--sub);
    }
    .mx-h,
    .mx-row {
      display: grid;
      grid-template-columns: 24px repeat(4, 1fr);
      gap: 2px;
      align-items: center;
    }
    .mx-h span {
      text-align: center;
    }
    .mx-row {
      margin-top: 2px;
    }
    .mx-cell {
      height: 9px;
      border-radius: 2px;
      cursor: pointer;
      &.grazing {
        box-shadow: 0 0 0 1.5px var(--accent);
      }
      &.resting {
        background-image: repeating-linear-gradient(
          45deg,
          rgba(255, 255, 255, 0.55) 0 2px,
          transparent 2px 4px
        ) !important;
      }
    }
    .mx-k {
      margin-top: 4px;
      display: flex;
      gap: 4px;
      align-items: center;
      i {
        width: 10px;
        height: 7px;
        border-radius: 2px;
        background: #55a03c;
        &.g {
          box-shadow: 0 0 0 1.5px var(--accent);
        }
        &.r {
          background: repeating-linear-gradient(
            45deg,
            rgba(255, 255, 255, 0.7) 0 2px,
            #55a03c 2px 4px
          );
        }
      }
    }
    .note {
      margin-top: 4px;
      font-size: 11px;
      color: var(--sub);
    }

    /* 轮牧计划 */
    .rot2 {
      display: flex;
      gap: 12px;
    }
    .rot-d {
      width: 92px;
    }
    .rot-l {
      margin-top: 6px;
      font-size: 11px;
      color: var(--sub);
      li {
        display: flex;
        align-items: center;
        gap: 4px;
        line-height: 1.6;
      }
      i {
        width: 8px;
        height: 8px;
        border-radius: 2px;
      }
      b {
        margin-left: auto;
        font-family: var(--num);
        color: var(--ink);
      }
    }
    .gantt {
      flex: 1;
      font: 10px var(--num);
      color: var(--sub);
    }
    .gt-axis {
      position: relative;
      height: 14px;
      margin-left: 30px;
      b {
        position: absolute;
        transform: translateX(-50%);
        font-weight: normal;
      }
    }
    .gt-row {
      display: flex;
      align-items: center;
      height: 15px;
      cursor: pointer;
    }
    .gt-id {
      width: 30px;
    }
    .gt-track {
      position: relative;
      flex: 1;
      height: 8px;
      border-radius: 4px;
      background: rgba(31, 58, 43, 0.06);
      i {
        position: absolute;
        top: 0;
        bottom: 0;
        border-radius: 4px;
      }
      em {
        position: absolute;
        top: -1px;
        transform: translateX(-50%);
        width: 12px;
        height: 10px;
        border-radius: 3px;
        font: normal 9px/10px var(--num);
        text-align: center;
        color: #fff;
        background: var(--ok);
      }
    }
    .gt-cur {
      left: 0;
      background: var(--accent);
      &.soon {
        background: #f08c2e;
      }
    }
    .gt-next {
      background: rgba(47, 143, 78, 0.45);
    }

    /* 气象 */
    .wx2 {
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .wx-now {
      display: flex;
      flex-direction: column;
      width: 120px;
      font-size: 11px;
      color: var(--sub);
      b {
        font: 30px var(--num);
        color: #f08c2e;
      }
      small {
        font-size: 14px;
      }
    }
    .wx-chart {
      width: 250px;
      .tick {
        font: 9px var(--num);
        fill: var(--sub);
      }
    }
    .wx-next {
      display: flex;
      gap: 8px;
      margin-top: 4px;
      font-size: 11px;
      color: var(--sub);
      span {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 3px 10px;
        border-radius: 6px;
        line-height: 1.35;
        background: rgba(31, 58, 43, 0.05);
      }
      i {
        font-style: normal;
      }
      b,
      em {
        font: normal 11px var(--num);
        color: var(--ink);
      }
      .rain {
        flex-direction: row;
        gap: 4px;
        align-self: flex-end;
        margin-left: auto;
        padding: 0;
        background: none;
        i {
          width: 8px;
          height: 8px;
          background: rgba(43, 123, 214, 0.4);
        }
      }
    }

    /* 称重 */
    .card.weighcard {
      // 左栏五张卡在 1920 × 1080 下比可用高度多 3 px，从最后这张卡的底边距里扣，上面四张卡位置不动
      padding-bottom: 7px;
    }
    .wg {
      display: flex;
      gap: 12px;
    }
    .wg-i {
      flex: 1;
      display: grid;
      grid-template-columns: auto 1fr;
      align-items: end;
      column-gap: 8px;
      font-size: 11px;
      color: var(--sub);
      span,
      b {
        grid-column: 1;
      }
      b {
        font: 20px var(--num);
        color: var(--ink);
        small {
          font: 10px "Source Han Sans CN";
          margin-left: 2px;
          color: var(--sub);
        }
      }
      .spark {
        grid-column: 2;
        grid-row: 1 / 3;
        justify-self: end;
      }
    }

    /* 告警联动 */
    .card.alarm {
      border-left: 4px solid var(--bad);
      h3 {
        color: var(--bad);
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--bad);
        box-shadow: 0 0 0 4px rgba(229, 72, 77, 0.2);
        animation: ranch-blink 1.2s infinite;
      }
      .lv {
        padding: 1px 8px;
        border-radius: 10px;
        font-size: 12px;
        color: #fff;
        background: var(--bad);
        &.major {
          background: #f08c2e;
        }
        &.minor {
          background: #93a5b5;
        }
      }
      .what {
        font-size: 13px;
        line-height: 1.5;
      }
      dl {
        display: grid;
        grid-template-columns: 34px 1fr 34px 1fr;
        gap: 4px 6px;
        margin: 4px 0 6px;
        font-size: 12px;
      }
      dt {
        color: var(--sub);
      }
      &.calm {
        border-left-color: var(--ok);
        h3 {
          color: var(--ink);
        }
      }
    }
    .closeup {
      position: relative;
      margin: 0 0 8px;
      border-radius: 8px;
      overflow: hidden;
      img {
        display: block;
        width: 100%;
        height: 104px;
        object-fit: cover;
      }
      figcaption {
        position: absolute;
        left: 8px;
        bottom: 6px;
        padding: 1px 8px;
        border-radius: 6px;
        font-size: 11px;
        color: #fff;
        background: rgba(0, 0, 0, 0.45);
      }
      .live {
        position: absolute;
        right: 8px;
        top: 6px;
        padding: 1px 6px;
        border-radius: 4px;
        font: 10px var(--num);
        color: #fff;
        background: rgba(229, 72, 77, 0.9);
      }
      &.calm-img img {
        height: 150px;
      }
    }
    .stepper {
      display: flex;
      align-items: center;
      font-size: 12px;
      color: var(--sub);
      i {
        flex: 1;
        height: 1px;
        margin: 0 6px;
        background: var(--line);
      }
      .done {
        color: var(--ok);
      }
      .now {
        padding: 2px 8px;
        border-radius: 10px;
        color: #fff;
        background: var(--bad);
      }
    }
    .acts {
      display: flex;
      gap: 6px;
      margin-top: 8px;
      span {
        flex: 1;
        padding: 4px 0;
        border-radius: 7px;
        font-size: 12px;
        text-align: center;
        background: rgba(31, 58, 43, 0.07);
        cursor: pointer;
        &:hover {
          background: rgba(31, 58, 43, 0.12);
        }
        &.pri {
          color: #fff;
          background: var(--bad);
        }
      }
    }

    /* 告警统计、事件 */
    .ast {
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .ast-l {
      width: 82px;
      font-size: 11px;
      color: var(--sub);
      li {
        display: flex;
        align-items: center;
        gap: 4px;
        line-height: 1.55;
      }
      i {
        width: 8px;
        height: 8px;
        border-radius: 2px;
      }
      b {
        margin-left: auto;
        font-family: var(--num);
        color: var(--ink);
      }
    }
    .ast-h {
      position: relative;
      flex: 1;
      height: 62px;
      display: flex;
      align-items: flex-end;
      gap: 2px;
      padding-bottom: 14px;
      i {
        flex: 1;
        min-height: 2px;
        border-radius: 2px 2px 0 0;
        background: #e5484d;
        opacity: 0.75;
        &.fut {
          background: rgba(31, 58, 43, 0.08);
        }
      }
    }
    .ast-x {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      justify-content: space-between;
      font: 9px var(--num);
      color: var(--sub);
    }
    .events li {
      display: grid;
      grid-template-columns: 22px 1fr 80px 40px 44px;
      align-items: center;
      gap: 6px;
      padding: 4px 0;
      border-top: 1px solid var(--line);
      font-size: 12px;
      cursor: pointer;
      i {
        width: 20px;
        height: 20px;
        border-radius: 6px;
        font: normal 12px/20px "Source Han Sans CN";
        text-align: center;
        color: #fff;
        background: var(--sub);
      }
      &.lv-urgent i {
        background: var(--bad);
      }
      &.lv-major i {
        background: #f08c2e;
      }
      &.done {
        opacity: 0.55;
      }
    }
    .ev-o,
    .ev-h {
      font-family: var(--num);
      color: var(--sub);
    }
    .ev-s {
      text-align: right;
    }

    /* 畜群 */
    table.herds {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      th {
        text-align: left;
        font-weight: normal;
        color: var(--sub);
        padding-bottom: 4px;
      }
      td {
        padding: 2px 0;
        border-top: 1px solid var(--line);
        font-family: var(--num);
      }
      tr {
        cursor: pointer;
      }
      tr.sel td {
        background: rgba(43, 123, 214, 0.1);
      }
    }
    .hk {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 6px;
      background: #fff;
      box-shadow: 0 0 0 1px var(--sub);
      &.cattle {
        background: #6b4228;
      }
    }
    .act {
      font-style: normal;
      padding: 0 6px;
      border-radius: 6px;
      font-size: 11px;
      background: rgba(47, 143, 78, 0.12);
      color: var(--ok);
      &.drink {
        background: rgba(43, 123, 214, 0.12);
        color: var(--accent);
      }
      &.rest {
        background: rgba(31, 58, 43, 0.08);
        color: var(--sub);
      }
    }

    /* 视频 */
    .card.video {
      display: flex;
      flex-direction: column;
    }
    .vids {
      flex: 1;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .vid {
      position: relative;
      // 画面格子随右栏剩余高度伸缩：有告警时告警卡变高，视频格子让出高度
      min-height: 52px;
      border-radius: 8px;
      overflow: hidden;
      background: #1f3a2b;
      img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        transform: scale(1.8);
      }
      figcaption {
        position: absolute;
        left: 6px;
        bottom: 4px;
        display: flex;
        gap: 5px;
        font-size: 10px;
        color: #fff;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
        b {
          font: 10px var(--num);
        }
      }
      .rec {
        position: absolute;
        right: 6px;
        top: 4px;
        font: 9px var(--num);
        color: #fff;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
      }
      &.al {
        box-shadow: inset 0 0 0 2px var(--bad);
      }
      &.on {
        box-shadow: inset 0 0 0 3px var(--accent);
      }
    }

    /* ---------- 底部 ---------- */
    .dock {
      position: absolute;
      left: 456px;
      right: 456px;
      bottom: 18px;
      display: grid;
      grid-template-columns: 1.1fr 1.15fr 1fr 0.85fr;
      gap: 9px;
      .card {
        min-height: 132px;
      }
    }
    .stk {
      display: flex;
      flex-wrap: wrap;
      gap: 0 6px;
      margin-top: 4px;
    }
    .stk-k {
      flex-basis: 16px;
      font-size: 12px;
      color: var(--sub);
    }
    .stk-bar {
      flex: 1 1 calc(100% - 24px);
      display: flex;
      gap: 1px;
      height: 10px;
      border-radius: 5px;
      overflow: hidden;
    }
    .stk-l {
      flex-basis: 100%;
      display: flex;
      flex-wrap: wrap;
      gap: 2px 8px;
      margin: 3px 0 2px 22px;
      font-size: 10px;
      color: var(--sub);
      b {
        display: inline-block;
        width: 7px;
        height: 7px;
        margin-right: 3px;
        border-radius: 2px;
      }
      em {
        font: normal 11px var(--num);
        color: var(--ink);
      }
      .tot {
        margin-left: auto;
        font: 12px var(--num);
        color: var(--ink);
      }
    }
    .ops li {
      display: grid;
      grid-template-columns: 54px 1fr 92px;
      align-items: center;
      gap: 6px;
      padding: 2px 0;
      font-size: 11px;
      &.todo {
        opacity: 0.55;
      }
      &.done .op-b i {
        background: var(--ok);
      }
    }
    .op-v {
      white-space: nowrap;
      font-family: var(--num);
      color: var(--sub);
      text-align: right;
    }
    .op-b {
      height: 6px;
      border-radius: 3px;
      background: rgba(31, 58, 43, 0.07);
      i {
        display: block;
        height: 100%;
        border-radius: 3px;
        background: var(--accent);
      }
    }
    .wd {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .wgrid {
      display: grid;
      grid-template-columns: repeat(8, 1fr);
      gap: 2px 3px;
    }
    .wp {
      display: flex;
      flex-direction: column;
      align-items: center;
      font-size: 10px;
      color: var(--sub);
      cursor: pointer;
      b {
        font: 10px var(--num);
        color: var(--ink);
      }
      &.bad b {
        color: var(--bad);
      }
      &.bad .wl i {
        background: var(--bad);
      }
    }
    .wl {
      position: relative;
      width: 10px;
      height: 22px;
      border-radius: 4px;
      background: var(--line);
      overflow: hidden;
      margin-bottom: 2px;
      i {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        background: var(--accent);
      }
    }
    .wd-s {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: var(--sub);
      b {
        font: 20px var(--num);
        color: var(--ink);
      }
      small {
        font: 11px "Source Han Sans CN";
        margin-left: 2px;
        color: var(--sub);
      }
    }
    .dvs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 5px;
    }
    .dv {
      display: flex;
      flex-direction: column;
      padding: 5px 8px;
      border-radius: 8px;
      background: rgba(31, 58, 43, 0.05);
      font-size: 11px;
      color: var(--sub);
      b {
        font: 15px var(--num);
        color: var(--ink);
      }
      em {
        font-style: normal;
        font-size: 10px;
        white-space: nowrap;
      }
      &.bad b {
        color: var(--bad);
      }
    }

    /* ---------- 地图工具条、月份条 ---------- */
    .maptools {
      position: absolute;
      right: 458px;
      top: 158px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .mt-g {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 5px;
      border-radius: 12px;
      font-size: 12px;
      text-align: center;
      @extend .glass;
      span {
        padding: 4px 9px;
        border-radius: 8px;
        color: var(--sub);
        cursor: pointer;
        &.on {
          color: #fff;
          background: var(--accent);
        }
      }
      .mt-k {
        padding: 2px 0;
        font-size: 10px;
        opacity: 0.8;
        cursor: default;
      }
    }
    .monthbar {
      position: absolute;
      left: 50%;
      bottom: 186px;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 10px;
      border-radius: 12px;
      font-size: 12px;
      white-space: nowrap;
      @extend .glass;
      span {
        padding: 3px 7px;
        border-radius: 7px;
        font-family: var(--num);
        color: var(--sub);
        cursor: pointer;
        &.on {
          color: #fff;
          background: var(--accent);
        }
      }
      .mb-k {
        font: 11px "Source Han Sans CN";
        cursor: default;
      }
      .play {
        font-family: "Source Han Sans CN";
        color: var(--accent);
      }
    }
    .ramp {
      position: relative;
      display: flex;
      justify-content: space-between;
      width: 150px;
      margin-left: 8px;
      padding-top: 12px;
      font: 11px var(--num);
      color: var(--sub);
      i {
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        height: 8px;
        border-radius: 4px;
        background: linear-gradient(
          90deg,
          #8a6a3a,
          #c2a560 25%,
          #d9d27a 48%,
          #9cc45a 65%,
          #55a03c 80%,
          #1f6b25
        );
      }
    }

    /* ---------- 场景标注 ---------- */
    .lb.wp {
      transform: translate(-50%, -50%);
      i {
        display: block;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: conic-gradient(
          var(--accent) var(--lv),
          rgba(255, 255, 255, 0.5) 0
        );
        box-shadow: 0 0 0 2px #fff;
      }
      span {
        position: absolute;
        left: 20px;
        top: -3px;
        padding: 1px 6px;
        border-radius: 6px;
        font: 11px var(--num);
        color: var(--ink);
        background: rgba(255, 255, 255, 0.85);
        white-space: nowrap;
      }
      &.bad {
        i {
          width: 16px;
          height: 16px;
          background: conic-gradient(
            var(--bad) var(--lv),
            rgba(255, 255, 255, 0.6) 0
          );
        }
        span {
          color: #fff;
          background: var(--bad);
        }
      }
    }
    .lb.hh {
      transform: translate(-50%, -50%);
      i {
        display: block;
        width: 9px;
        height: 9px;
        background: #f08c2e;
        border: 2px solid #fff;
        transform: rotate(45deg);
      }
      span {
        position: absolute;
        left: 14px;
        top: -4px;
        font: 10px var(--num);
        color: #8a4a12;
        white-space: nowrap;
      }
    }
    .lb.hq {
      transform: translate(-50%, -100%);
      span {
        display: block;
        padding: 3px 10px;
        border-radius: 8px;
        font-size: 13px;
        color: #fff;
        background: var(--ink);
        white-space: nowrap;
      }
    }
    .lb.bs {
      transform: translate(-50%, -100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      font: 10px var(--num);
      color: #5b3f8f;
      i {
        width: 0;
        height: 0;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-bottom: 13px solid #8a5cd6;
      }
      span {
        padding: 0 4px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.85);
      }
    }
    .lb.cam {
      transform: translate(-50%, -50%);
      i {
        display: block;
        width: 10px;
        height: 8px;
        border-radius: 2px;
        background: #1f3a2b;
        box-shadow: 0 0 0 1.5px #fff;
      }
    }
    .lb.herd {
      transform: translate(-50%, -100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      .pill {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 9px 3px 7px;
        border-radius: 12px;
        font-size: 12px;
        white-space: nowrap;
        background: rgba(255, 255, 255, 0.9);
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
        b {
          font: 13px var(--num);
        }
        span {
          font: 12px var(--num);
          color: var(--sub);
        }
        .hk {
          margin: 0;
        }
      }
      em {
        width: 1px;
        height: 34px;
        background: rgba(255, 255, 255, 0.9);
      }
      &.sel .pill {
        color: #fff;
        background: var(--accent);
        span {
          color: #fff;
        }
      }
      &.warn .pill {
        color: #fff;
        background: var(--bad);
        span {
          color: #fff;
        }
      }
    }
    .lb.alarm {
      transform: translateX(-50%);
      .callout {
        width: 268px;
        min-height: 92px;
        padding: 10px 12px;
        border-radius: 10px;
        color: #fff;
        background: var(--bad);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
        b {
          display: block;
          font:
            15px "Alimama ShuHeiTi",
            sans-serif;
        }
        span {
          display: block;
          margin: 4px 0;
          font-size: 12px;
          line-height: 1.45;
        }
        small {
          font: 12px var(--num);
          opacity: 0.85;
        }
      }
    }
    .lb.measure {
      transform: translate(-50%, -130%);
      span {
        padding: 2px 8px;
        border-radius: 6px;
        font: 13px var(--num);
        color: #fff;
        background: var(--ink);
      }
    }
    svg.leader {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
      pointer-events: none;
      polyline {
        fill: none;
        stroke: var(--bad);
        stroke-width: 1.6;
      }
      circle {
        fill: var(--bad);
      }
    }
    .north {
      position: absolute;
      right: 520px;
      bottom: 214px;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      @extend .glass;
      i {
        position: absolute;
        left: 50%;
        top: 6px;
        bottom: 6px;
        width: 0;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-bottom: 32px solid var(--bad);
        transform: translateX(-50%) rotate(var(--deg));
        transform-origin: 50% 50%;
      }
      span {
        position: absolute;
        left: 50%;
        top: -18px;
        transform: translateX(-50%);
        font-size: 12px;
      }
    }
    .scale {
      position: absolute;
      font: 11px var(--num);
      color: var(--sub);
      i {
        display: block;
        height: 6px;
        border: 1.5px solid currentColor;
        border-top: 0;
      }
    }

    /* ---------- 详情、提示、加载 ---------- */
    .detail {
      position: absolute;
      left: 470px;
      top: 160px;
      width: 300px;
      padding: 12px 14px;
      border-radius: 14px;
      @extend .glass;
      header {
        display: flex;
        align-items: baseline;
        gap: 8px;
        margin-bottom: 8px;
        b {
          font:
            18px "Alimama ShuHeiTi",
            sans-serif;
        }
        span {
          font-size: 11px;
          color: var(--sub);
        }
        .x {
          margin-left: auto;
          font-style: normal;
          font-size: 18px;
          color: var(--sub);
          cursor: pointer;
        }
      }
      dl {
        display: grid;
        grid-template-columns: 64px 1fr;
        gap: 5px 8px;
        font-size: 12px;
      }
      dt {
        color: var(--sub);
      }
      dd.bad {
        color: var(--bad);
      }
    }
    .toast {
      position: absolute;
      left: 50%;
      top: 170px;
      transform: translateX(-50%);
      padding: 8px 18px;
      border-radius: 10px;
      font-size: 14px;
      color: #fff;
      background: rgba(31, 58, 43, 0.86);
      z-index: 5;
    }
    .credit {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 3px;
      text-align: center;
      font-size: 9px;
      color: rgba(31, 58, 43, 0.5);
      pointer-events: none;
    }
    .scene-loading,
    .scene-error {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      padding: 14px 26px;
      border-radius: 12px;
      font-size: 16px;
      @extend .glass;
    }
    .scene-error {
      color: var(--bad);
    }
    .fade-enter-active,
    .fade-leave-active {
      transition: opacity 0.3s;
    }
    .fade-enter-from,
    .fade-leave-to {
      opacity: 0;
    }
  }

  @keyframes ranch-blink {
    50% {
      opacity: 0.35;
    }
  }
</style>

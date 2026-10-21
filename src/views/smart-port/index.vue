<!--
  智慧港口 · 洋山四期全自动化集装箱码头 数字孪生（定稿：docs/design/smart-port/design/final.png，A 全息孪生 · 深海科技蓝）
  ----------------------------------------------------------
  页面只负责布局与数据转接：
    - 三维码头：./scene（不依赖 Vue）。周边海面、岛屿是 Sentinel-2 / Copernicus 公开数据，码头面轮廓、大桥是 OSM；
      码头本体（7 泊位、28 岸桥、61 箱区 121 轨道吊、145 AGV）按公开参数程序化建模，布局约 ±10 m
    - 运行数据：./sim/simulator.js（周泊位计划 + 作业路积分 + 岸桥分配 + AGV 调度），跟随北京时间，每秒刷新
  交互：自动巡游（总览 → 各条作业船 → 设备协同；有人操作就停，空闲 30 秒恢复）、新的重要告警自动联动（镜头飞过去停 6 秒）、
  点船 / 在泊船舶列表进入单船跟踪、点岸桥 / 作业路飞过去、功能导航切镜头、图层开关、搜索编号、小地图点选。
  链接参数：?tab=overview|vessel|equip|yard|alarm、?tour=0 关闭巡游、?track=<航次编号> 打开就跟踪、
  ?at=2026-10-24T16:34（仿真从这一刻开始走，设计稿比对用）
-->
<template>
  <div ref="pageRef" class="port-page">
    <div ref="stageRef" class="stage"></div>
    <div class="vignette"></div>
    <div class="scan"></div>

    <SceneLabels
      v-if="state && anchors"
      :a="anchors"
      :state="state"
      :alarm="layers.alarm ? alarm : null"
      :alarm-at="alarmAt"
      :track="track"
      :crane-tags="craneTags"
      :bounds="bounds"
      :unit="unit"
      :show="layers"
      @vessel="startTrack"
      @crane="focusCrane"
      @alarm="focusEvent"
      @dispatch="dispatch"
    />

    <template v-if="state">
      <PortHead :state="state" :tab="tab" @tab="setTab" @search="search" />
      <KpiStrip
        :state="state"
        :yday="yday"
        :hourly="hourly"
        :teu-cum="teuCum"
      />

      <aside ref="leftRef" class="col left">
        <TrackCard v-if="trackV" :state="state" :v="trackV" @exit="stopTrack" />
        <template v-else>
          <VesselsCard :state="state" :track="track" @vessel="startTrack" />
          <GanttCard
            :now="state.t"
            :layout="layout"
            :schedule="schedule"
            @vessel="startTrack"
          />
        </template>
        <HourlyCard :hourly="hourly" />
        <WeekCard :by-class="byClass" />
      </aside>

      <aside ref="rightRef" class="col right">
        <EquipCard :state="state" @kind="setTab(kindTab($event))" />
        <LinesCard
          :state="state"
          :selected="selCrane"
          :track="track"
          @crane="focusCrane"
        />
        <AgvCard :state="state" />
        <AlarmCard
          :state="state"
          :limit="2"
          @event="focusEvent"
          @dispatch="dispatch"
        />
      </aside>

      <MiniMap :layout="layout" :site="site" :view="viewNow" @goto="gotoUV" />
      <MapTools
        :state="state"
        :layers="layers"
        :view="viewKey"
        :touring="touring"
        :tour-step="tourStep"
        @layer="toggleLayer"
        @view="setView"
        @tour="toggleTour"
      />
      <div v-if="toast" class="toast">{{ toast }}</div>
    </template>

    <div v-if="loading" class="scene-loading"><i></i>正在加载码头三维场景…</div>
    <div v-if="error" class="scene-error">{{ error }}</div>
  </div>
</template>

<script setup>
  import layout from "./data/layout.json"
  import site from "./data/site.json"
  import context from "./data/context.json"
  import { PortScene } from "./scene/PortScene.js"
  import { THEMES } from "./scene/theme.js"
  import { createPortSim, msForBeijing, SHIP_CLASSES } from "./sim/simulator.js"
  import PortHead from "./components/PortHead.vue"
  import KpiStrip from "./components/KpiStrip.vue"
  import SceneLabels from "./components/SceneLabels.vue"
  import MiniMap from "./components/MiniMap.vue"
  import MapTools from "./components/MapTools.vue"
  import VesselsCard from "./components/cards/VesselsCard.vue"
  import GanttCard from "./components/cards/GanttCard.vue"
  import HourlyCard from "./components/cards/HourlyCard.vue"
  import WeekCard from "./components/cards/WeekCard.vue"
  import EquipCard from "./components/cards/EquipCard.vue"
  import LinesCard from "./components/cards/LinesCard.vue"
  import AgvCard from "./components/cards/AgvCard.vue"
  import AlarmCard from "./components/cards/AlarmCard.vue"
  import TrackCard from "./components/cards/TrackCard.vue"
  import "./panels.scss"

  const route = useRoute()
  const THEME = THEMES.holo
  const H = 3600000
  const D = 24 * H

  /** 总览镜头：按定稿概念图拟合（docs/design/smart-port/07-camera.json） */
  const OVERVIEW = {
    target: [1154.3, 70.7],
    dist: 6550.8,
    yaw: -26.47,
    pitch: 40,
    fov: 12
  }
  /** 各类近景镜头 */
  const shipView = (v) => ({
    target: [(v.u0 + v.u1) / 2, 30],
    dist: 980,
    yaw: -26,
    pitch: 34,
    fov: 30
  })
  const craneView = (u) => ({
    target: [u, 40],
    dist: 460,
    yaw: -30,
    pitch: 30,
    fov: 32
  })
  const equipView = (u) => ({
    target: [u, 110],
    dist: 760,
    yaw: -34,
    pitch: 40,
    fov: 32
  })
  const YARD = { target: [1300, 330], dist: 1700, yaw: -18, pitch: 50, fov: 26 }
  /** 巡游：总览停 12 秒 → 每条作业船 8 秒 → 设备协同 8 秒；用户操作后 30 秒恢复；告警联动停 6 秒 */
  const TOUR_OVERVIEW = 12
  const TOUR_STEP = 8
  const IDLE = 30
  const LINK_HOLD = 6

  /*
   * 页面缩放：全站 amfe-flexible 按宽度设 rem；浏览器窗口通常比 16:9 扁，按宽缩放会把侧栏底部挤出屏幕，
   * 所以本页按宽、高取小：rem = min(宽, 高 × 16 / 9) / 10（同 /smart-ranch）。离开页面时还原。
   */
  function fitRem() {
    const el = document.documentElement
    const w = Math.min(el.clientWidth, (el.clientHeight * 16) / 9)
    el.style.fontSize = `${w / 10}px`
  }
  const unit = ref(1)
  const pageRef = ref(null)
  const stageRef = ref(null)
  const leftRef = ref(null)
  const rightRef = ref(null)

  /** 侧栏兜底：装不下时整栏等比缩小，保证最后一张卡不被裁（同 /smart-ranch） */
  function fitColumn(col) {
    if (!col) return
    const st = col.style
    st.transform = st.height = st.bottom = ""
    const avail = col.clientHeight
    const last = col.lastElementChild
    last.style.flexGrow = "0"
    const need = col.scrollHeight
    last.style.flexGrow = ""
    if (need <= avail + 1) return
    st.bottom = "auto"
    st.height = `${need}px`
    st.transform = `scale(${avail / need})`
    st.transformOrigin = "top"
  }
  let fitFrame = 0
  function fitColumns() {
    cancelAnimationFrame(fitFrame)
    fitFrame = requestAnimationFrame(() => {
      fitColumn(leftRef.value)
      fitColumn(rightRef.value)
    })
  }
  const colObserver = new ResizeObserver(fitColumns)
  watch([leftRef, rightRef], (cols) => {
    colObserver.disconnect()
    for (const c of cols)
      if (c) for (const el of [c, ...c.children]) colObserver.observe(el)
  })

  /* ---------------- 仿真时钟与数据 ---------------- */
  const AT = String(route.query.at || "").match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})$/
  )
  const T_START = Date.now()
  const AT_MS = AT ? msForBeijing(AT[1], +AT[2] + +AT[3] / 60) : null
  const now = () => (AT_MS ? AT_MS + (Date.now() - T_START) : Date.now())

  const sim = createPortSim(layout)
  const state = shallowRef(null)
  const yday = shallowRef(null)
  const hourly = shallowRef([])
  const teuCum = shallowRef([])
  const schedule = shallowRef([])
  const byClass = shallowRef([])
  const loading = ref(true)
  const error = ref("")

  /** 每分钟：昨日同时刻、逐小时作业量、TEU 走势、甘特；每小时：本周船型 */
  let lastMinute = -1
  let lastHour = -1
  function slowData(ms, s) {
    const m = Math.floor(ms / 60000)
    if (m === lastMinute) return
    lastMinute = m
    yday.value = sim.at(ms - D).kpi
    const d0 = s.clock.dayStart
    const cum = [0]
    const teu = []
    for (let h = 1; h <= Math.floor((ms - d0) / H); h++) {
      const k = sim.at(d0 + h * H).kpi
      cum.push(k.movesToday)
      teu.push(k.teuToday)
    }
    cum.push(s.kpi.movesToday)
    teu.push(s.kpi.teuToday)
    hourly.value = cum.slice(1).map((x, i) => x - cum[i])
    teuCum.value = teu
    schedule.value = sim.schedule(ms - 6 * H, ms + 18 * H)
    const hr = Math.floor(ms / H)
    if (hr !== lastHour) {
      lastHour = hr
      const dow = (new Date(d0 + 8 * H).getUTCDay() + 6) % 7
      const w0 = d0 - dow * D
      const week = sim
        .schedule(w0, w0 + 7 * D)
        .filter((c) => c.planStart >= w0 && c.planStart < w0 + 7 * D)
      byClass.value = Object.keys(SHIP_CLASSES).map((k) => ({
        k,
        name: SHIP_CLASSES[k].name,
        n: week.filter((c) => c.cls === k).length
      }))
    }
  }

  /** 主告警：最新一条未结束的重要告警（岸桥故障优先） */
  const alarm = computed(() => {
    const s = state.value
    if (!s) return null
    const open = s.events.filter((e) => e.status !== "resolved")
    return (
      open.find((x) => x.kind === "qcFault") ||
      open.find((x) => x.level === "major") ||
      null
    )
  })
  /** 告警对应的三维位置（u, v, 高度） */
  function eventAnchor(e) {
    const s = state.value
    const c = s.cranes.find((x) => x.id === e.target)
    // 岸桥告警的光柱高 210 m（竖向夸张后约 320 m，总览里约 190 px，和定稿一致）
    if (c) return { u: c.u, v: 21, y: 92, fx: { u: c.u, v: 21, r: 36, h: 210 } }
    const rm = /^(Y\d+)-([SL])$/.exec(e.target || "")
    if (rm) {
      const b = layout.blocks.find((x) => x.id === rm[1])
      const v = rm[2] === "S" ? b.v0 + 30 : b.v1 - 20
      return { u: b.u, v, y: 40, fx: { u: b.u, v, r: 30, h: 110 } }
    }
    const blk = layout.blocks.find((x) => x.id === e.target)
    if (blk)
      return {
        u: blk.u,
        v: (blk.v0 + blk.v1) / 2,
        y: 30,
        fx: { u: blk.u, v: (blk.v0 + blk.v1) / 2, r: 40, h: 110 }
      }
    const ves = s.vessels.find((x) => x.id === e.target)
    if (ves)
      return { u: (ves.u0 + ves.u1) / 2, v: -ves.beam / 2, y: 40, fx: null }
    const agv = sim.agvPoses(s.t).find((x) => x.id === e.target)
    if (agv)
      return {
        u: agv.u,
        v: agv.v,
        y: 10,
        fx: { u: agv.u, v: agv.v, r: 16, h: 60 }
      }
    if (e.target === "DG-01") {
      const d = layout.special[0]
      return {
        u: (d.u0 + d.u1) / 2,
        v: (d.v0 + d.v1) / 2,
        y: 20,
        fx: { u: (d.u0 + d.u1) / 2, v: (d.v0 + d.v1) / 2, r: 50, h: 100 }
      }
    }
    return null
  }

  /* ---------------- 三维与交互状态 ---------------- */
  let scene = null
  const anchors = shallowRef(null)
  const alarmAt = shallowRef(null)
  const track = ref(String(route.query.track || ""))
  const trackV = computed(() =>
    track.value && state.value
      ? state.value.vessels.find((v) => v.id === track.value)
      : null
  )
  const selCrane = ref("")
  const tab = ref(String(route.query.tab || "overview"))
  const viewKey = ref("overview")
  const viewNow = shallowRef(OVERVIEW)
  /** 图层（和定稿一致）：船舶、岸桥、AGV 光迹、作业路光带、箱区热度（默认关）、告警 */
  const layers = reactive({
    ships: true,
    cranes: true,
    trails: true,
    ribbons: true,
    heat: false,
    alarm: true
  })
  const toast = ref("")
  const touring = ref(route.query.tour !== "0")
  const tourIndex = ref(0)
  const tourStep = ref("")
  let idleSince = 0
  let tourTimer = 0
  let linkUntil = 0
  const seenEvents = new Set()

  /** 两侧栏内边（屏幕像素）：标签和告警卡不压到栏上 */
  const bounds = computed(() => ({
    left: 462 * unit.value,
    right: 1458 * unit.value,
    top: 270 * unit.value
  }))
  /**
   * 岸桥编号牌给哪条船的岸桥：跟踪某条船时给它；近景（距离 < 1600 m）给所有在作业的；
   * 总览时只给"在作业岸桥最多的那条船"（定稿里总览标的是长澜云帆的 QC14–QC18），全标会挤成一片
   */
  const craneTags = computed(() => {
    if (track.value) return track.value
    if (viewNow.value.dist < 1600) return "*"
    const n = new Map()
    for (const c of state.value?.cranes || [])
      if (c.state !== "idle" && c.vessel)
        n.set(c.vessel, (n.get(c.vessel) || 0) + 1)
    let best = ""
    for (const [id, k] of n) if (!best || k > n.get(best)) best = id
    return best
  })

  function fly(view, sec = 2.2) {
    viewNow.value = { ...view }
    scene?.flyTo(view, sec)
  }
  /** 用户操作：停巡游，30 秒后恢复 */
  function onUser() {
    idleSince = Date.now()
    tourStep.value = ""
  }

  function setTab(key) {
    tab.value = key
    onUser()
    const s = state.value
    if (key === "overview") return setView("overview")
    viewKey.value = key === "vessel" ? "berth" : key === "yard" ? "yard" : ""
    if (key === "vessel") {
      const v = s.vessels
        .filter((x) => x.stage === "working")
        .sort((a, b) => b.moves - b.done - (a.moves - a.done))[0]
      if (v) fly(shipView(v))
    } else if (key === "equip") fly(equipView(layout.quay.u1 * 0.55))
    else if (key === "yard") fly(YARD)
    else if (key === "alarm" && alarm.value) focusEvent(alarm.value)
  }
  const kindTab = (k) => (k === "rmg" ? "yard" : "equip")

  function setView(key) {
    viewKey.value = key
    onUser()
    if (key === "overview") {
      stopTrack()
      fly(OVERVIEW, 2.4)
    } else if (key === "berth") {
      const v = state.value.vessels.find((x) => x.stage === "working")
      if (v) fly(shipView(v))
    } else if (key === "yard") fly(YARD)
    else if (key === "track") {
      const v = state.value.vessels.find((x) => x.stage === "working")
      if (v) startTrack(v.id)
    }
  }

  function startTrack(id) {
    const v = state.value?.vessels.find((x) => x.id === id)
    if (!v) return
    onUser()
    track.value = id
    viewKey.value = "track"
    fly(shipView(v))
  }
  function stopTrack() {
    track.value = ""
  }

  function focusCrane(id) {
    const c = state.value?.cranes.find((x) => x.id === id)
    if (!c) return
    onUser()
    selCrane.value = id
    fly(craneView(c.u))
  }
  function focusEvent(e) {
    const a = eventAnchor(e)
    if (!a) return
    onUser()
    fly({ target: [a.u, a.v], dist: 520, yaw: -28, pitch: 34, fov: 32 })
  }
  function gotoUV([u, v]) {
    onUser()
    fly({
      ...viewNow.value,
      target: [u, v],
      dist: Math.min(viewNow.value.dist, 1400)
    })
  }
  function dispatch(e) {
    toast.value = `已派单：${e.title}（${e.target}）→ ${e.team}`
    setTimeout(() => (toast.value = ""), 3000)
  }
  function toggleLayer(key) {
    layers[key] = !layers[key]
  }
  function toggleTour() {
    touring.value = !touring.value
    if (touring.value) idleSince = 0
  }
  /** 搜索：航次 / 船名、岸桥 QCxx、箱区 Yxx、AGVxxx */
  function search(q) {
    if (!q || !state.value) return
    const s = state.value
    const Q = q.toUpperCase()
    const v = s.vessels.find(
      (x) => x.name.includes(q) || x.id.toUpperCase() === Q
    )
    if (v) return startTrack(v.id)
    if (/^QC\d+$/.test(Q)) return focusCrane(`QC${Q.slice(2).padStart(2, "0")}`)
    const b = layout.blocks.find(
      (x) => x.id === `Y${Q.replace(/^Y/, "").padStart(2, "0")}`
    )
    if (/^Y\d+/.test(Q) && b) {
      onUser()
      return fly({
        target: [b.u, (b.v0 + b.v1) / 2],
        dist: 620,
        yaw: -24,
        pitch: 42,
        fov: 32
      })
    }
    if (/^AGV\d+$/.test(Q)) {
      const id = `AGV${Q.slice(3).padStart(3, "0")}`
      const p = sim.agvPoses(s.t).find((x) => x.id === id)
      if (p) {
        onUser()
        return fly({
          target: [p.u, p.v],
          dist: 360,
          yaw: -30,
          pitch: 36,
          fov: 32
        })
      }
    }
    toast.value = `没有找到"${q}"`
    setTimeout(() => (toast.value = ""), 2500)
  }

  /** 巡游一步：总览 → 每条作业船 → 设备协同 → 总览 */
  function tourTick() {
    const s = state.value
    if (!s || !touring.value || track.value) return
    if (idleSince && Date.now() - idleSince < IDLE * 1000) return
    if (Date.now() < linkUntil) return
    idleSince = 0
    const ships = s.vessels.filter((v) => v.stage === "working")
    const steps = [{ name: "总览", view: OVERVIEW, sec: TOUR_OVERVIEW }]
    for (const v of ships)
      steps.push({ name: v.name, view: shipView(v), sec: TOUR_STEP })
    steps.push({
      name: "设备协同",
      view: equipView(layout.quay.u1 * 0.55),
      sec: TOUR_STEP
    })
    const i = tourIndex.value % steps.length
    const st = steps[i]
    tourStep.value = `${st.name} · ${i + 1}/${steps.length}`
    viewKey.value = i === 0 ? "overview" : "berth"
    fly(st.view, i === 0 ? 2.6 : 2.2)
    tourIndex.value = i + 1
    clearTimeout(tourTimer)
    tourTimer = setTimeout(tourTick, st.sec * 1000)
  }

  /** 新的重要告警：镜头飞过去停 6 秒（用户正在操作时不打断） */
  function linkNewAlarms(s) {
    for (const e of s.events) {
      if (seenEvents.has(e.id)) continue
      seenEvents.add(e.id)
      // 页面刚打开时已有的告警、几秒前就发生的（切回标签页补出来的）不联动
      if (!scene || s.t - e.at > 8000 || e.level !== "major") continue
      if (idleSince && Date.now() - idleSince < IDLE * 1000) continue
      const a = eventAnchor(e)
      if (!a) continue
      linkUntil = Date.now() + LINK_HOLD * 1000
      fly({ target: [a.u, a.v], dist: 520, yaw: -28, pitch: 34, fov: 32 }, 1.8)
      clearTimeout(tourTimer)
      tourTimer = setTimeout(tourTick, LINK_HOLD * 1000)
    }
  }

  /** 每秒一份仿真状态 */
  function tick() {
    const ms = now()
    const s = sim.at(ms)
    state.value = s
    slowData(ms, s)
    if (scene) {
      const a = alarm.value ? eventAnchor(alarm.value) : null
      scene.setState(s, {
        track: track.value,
        alarm: layers.alarm ? a?.fx : null
      })
      linkNewAlarms(s)
    }
  }

  /** 场景标签锚点：约 20 帧 / 秒 */
  let labelRaf = 0
  let lastLabel = 0
  function labelLoop(t) {
    labelRaf = requestAnimationFrame(labelLoop)
    if (!scene || t - lastLabel < 48) return
    lastLabel = t
    anchors.value = scene.anchors()
    const a = alarm.value ? eventAnchor(alarm.value) : null
    alarmAt.value = a ? scene.project(a.u, a.v, a.y) : null
  }

  // 图层开关 → 场景对象显隐
  watch(
    () => ({ ...layers }),
    (l) => {
      if (!scene) return
      for (const rec of scene.ships.values())
        rec.g.visible = l.ships && rec.g.visible
      scene.setCranesVisible(l.cranes)
      if (scene.trails) scene.trails.lines.visible = l.trails
      if (scene.lanes) scene.lanes.mesh.visible = l.trails
      if (scene.ribbons) scene.ribbons.group.visible = l.ribbons
      scene.setYardHeat(l.heat)
      if (!l.alarm) scene.setAlarm(null)
    }
  )
  // 跟踪某条船时镜头跟着它（船在靠离泊时会移动）
  watch(trackV, (v, old) => {
    if (
      v &&
      old &&
      v.id === old.id &&
      (v.stage === "berthing" || v.stage === "departing")
    )
      fly(shipView(v), 1)
    if (track.value && !v) stopTrack()
  })

  let secTimer = 0
  let tourBoot = 0
  onMounted(async () => {
    fitRem()
    unit.value = parseFloat(document.documentElement.style.fontSize) / 192
    const onResize = () => {
      fitRem()
      unit.value = parseFloat(document.documentElement.style.fontSize) / 192
      fitColumns()
    }
    window.addEventListener("resize", onResize)
    pageRef.value.__onResize = onResize
    try {
      tick()
      scene = new PortScene(stageRef.value, {
        layout,
        site,
        context,
        theme: THEME,
        baseUrl: import.meta.env.BASE_URL
      })
      await scene.load()
      scene.setView(OVERVIEW)
      scene.startLive({
        sim,
        now,
        onUser,
        onPick: ({ type, id }) =>
          type === "crane" ? focusCrane(id) : startTrack(id)
      })
      tick()
      for (const e of state.value.events) seenEvents.add(e.id)
      loading.value = false
      labelRaf = requestAnimationFrame(labelLoop)
      secTimer = setInterval(tick, 1000)
      // 打开时带参数：直接切到某个标签页或跟踪某条船；否则开始巡游
      if (track.value) startTrack(track.value)
      else if (tab.value !== "overview") setTab(tab.value)
      if (touring.value) tourBoot = setTimeout(tourTick, TOUR_OVERVIEW * 1000)
      if (import.meta.env.DEV)
        window.__smartPortScene = { current: scene, sim, state }
    } catch (e) {
      console.error(e)
      error.value = `三维场景加载失败：${e.message || e}`
      loading.value = false
    }
  })

  onBeforeUnmount(() => {
    clearInterval(secTimer)
    clearTimeout(tourTimer)
    clearTimeout(tourBoot)
    cancelAnimationFrame(labelRaf)
    cancelAnimationFrame(fitFrame)
    colObserver.disconnect()
    window.removeEventListener("resize", pageRef.value?.__onResize)
    scene?.dispose()
    scene = null
    // 还原全站按宽度缩放的根字号（amfe-flexible 的规则）
    document.documentElement.style.fontSize = `${document.documentElement.clientWidth / 10}px`
    if (import.meta.env.DEV) delete window.__smartPortScene
  })
</script>

<style lang="scss" scoped>
  .port-page {
    position: fixed;
    inset: 0;
    overflow: hidden;
    /* Tailwind preflight 把全局行高设成 1.5；定稿按浏览器默认行高画，这里还原，否则两侧栏装不下要整栏缩小 */
    line-height: normal;
    /* 全站 body 设了灰度抗锯齿（-webkit-font-smoothing: antialiased），macOS 上字会细一档；定稿按默认渲染，这里还原 */
    -webkit-font-smoothing: auto;
    -moz-osx-font-smoothing: auto;
    text-rendering: auto;
    background: radial-gradient(ellipse at 50% 60%, #061a33 0%, var(--bg) 70%);
    font-family: var(--font-body);
    color: var(--text-2);
  }
  .stage {
    position: absolute;
    inset: 0;
    :deep(canvas) {
      display: block;
      width: 100% !important;
      height: 100% !important;
    }
  }
  .toast {
    position: absolute;
    left: 50%;
    top: 280px;
    transform: translateX(-50%);
    padding: 8px 18px;
    font-size: 14px;
    color: var(--text);
    background: rgba(3, 14, 30, 0.9);
    border: 1px solid var(--hair-strong);
    box-shadow: var(--glow-soft);
    z-index: 5;
  }
  .scene-loading,
  .scene-error {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    align-content: center;
    gap: 14px;
    font-size: 18px;
    color: var(--text);
    background: var(--bg);
    z-index: 9;
  }
  .scene-loading i {
    width: 46px;
    height: 46px;
    border: 3px solid var(--hair);
    border-top-color: var(--brand);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  .scene-error {
    color: #ff6b81;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>

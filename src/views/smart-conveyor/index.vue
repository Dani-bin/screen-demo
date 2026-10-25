<!--
  带式输送机安全预警与集控孪生大屏（虚构 · 青岚煤矿主煤流）
  ----------------------------------------------------------
  还原基准：docs/design/smart-conveyor/design/final.png（A 透视矿脉 · 琥珀能流）。页面只负责布局与数据转接：
    - 三维：./scene（不依赖 Vue），程序化剖面沙盘，主机位 = 定稿概念图反求的相机（data/camera.json）
    - 数据：./sim/simulator.js 按北京时间仿真主煤流（6 条皮带、3 个煤仓、两工作面、告警与劣化），
      ./store/clock.js 统一时间游标，./store/board.js 从 state = sim.at(t) 派生面板数据
    - 面板：./components（定稿 HTML 面板的移植，样式 ./styles/board.scss）
  版面：定稿是 1920 × 1080 的固定构图。画布铺满窗口，面板放在按 16:9 居中的"舞台"里（rem 缩放），
  三维投影中心按舞台位置换算（scene 的 origin 选项），窗口比 16:9 宽或高时沙盘和面板仍然对齐。
  深链：?at=2026-10-30T21:20 把时钟钉在定稿那一刻（截图比对用）。
-->
<template>
  <div ref="pageRef" class="conveyor-page">
    <canvas ref="canvasRef" class="scene"></canvas>
    <div
      class="stage"
      :class="{ scripting: !!scen.run.key }"
      :style="stageStyle"
    >
      <div class="vignette"></div>
      <div class="grain"></div>
      <template v-if="ready && f && w">
        <PageHeader :s="f.s" :now="f.ms" :tab="tab" @tab="onTab" />
        <KpiStrip :f="f" />
        <!-- 智能看板（定稿） -->
        <template v-if="tab === 'board'">
          <div class="col left">
            <Production :f="f" :w="w" />
            <BeltTable :f="f" :selected="selected" @pick="onPick" />
            <Bunkers :f="f" @pick="onPick" />
            <Energy :f="f" />
            <Standard />
          </div>
          <div class="col right">
            <Dims :f="f" :w="w" />
            <AlarmList :f="f" :w="w" @pick="onAlarm" />
            <Predict :f="f" :w="w" />
            <Sensing :f="f" :w="w" />
            <Patrol :f="f" />
          </div>
        </template>
        <!-- 运行中心：集控 + 选中皮带的实时监测 -->
        <template v-else-if="tab === 'run'">
          <div class="col left run">
            <FlowDiagram :f="f" :selected="runBelt" @pick="onPick" />
            <ControlOps
              :f="f"
              :ctl="control.ctl"
              :selected="runBelt"
              @ask="onAsk"
              @reset="control.reset()"
            />
            <StateBands :f="f" :w="w" :ctl="control.ctl" />
            <OpLog :w="w" :ctl="control.ctl" />
          </div>
          <div class="col right run">
            <BeltParams :f="f" :id="runBelt" @pick="onPick" />
            <DriveUnits :f="f" :id="runBelt" @diag="onDiag" />
            <Protections :f="f" :id="runBelt" />
            <AiVideo :f="f" :id="runBelt" />
          </div>
        </template>
        <!-- 预警中心：人机料环 -->
        <template v-else-if="tab === 'alarm'">
          <div class="col left alarm">
            <PersonPanel :f="f" :w="w" />
            <MachinePanel :f="f" :w="w" @pick="onAlarm" />
            <MaterialPanel :w="w" />
            <EnvPanel :w="w" />
          </div>
          <div class="col right alarm">
            <LevelSummary :f="f" :w="w" />
            <AlarmCards :f="f" @pick="onAlarm" />
            <AlarmTrend :w="w" />
            <DynThreshold :f="f" :w="w" />
          </div>
        </template>
        <!-- 诊断中心：劣化设备 + 多手段诊断 -->
        <template v-else-if="tab === 'diag'">
          <div class="col left diag">
            <DegradeList
              :f="f"
              :w="w"
              :selected="diagTr?.id"
              @select="onDiagSelect"
            />
            <TrendChart :f="f" :tr="diagTr" />
            <RulPanel :f="f" :w="w" :tr="diagTr" />
          </div>
          <div class="col right diag">
            <Spectrum :f="f" :tr="diagTr" :device="diagDevice" />
            <DasPanel :f="f" :tr="diagTr" />
            <DtsPanel :w="w" :tr="diagTr" />
            <XrayPanel :w="w" />
          </div>
        </template>
        <!-- 运维中心：检修计划 + 预测性维护 -->
        <template v-else-if="tab === 'ops'">
          <div class="col left ops">
            <NightPlan :w="w" @locate="onLocate" />
            <Decisions :f="f" :w="w" />
            <Spares :w="w" />
          </div>
          <div class="col right ops">
            <Robots :f="f" :w="w" @follow="onFollow" />
            <Lifecycle :w="w" />
            <PdmEffect :w="w" />
          </div>
        </template>
        <SceneTags
          v-if="!level"
          :scene="scene"
          :quiet="scriptCards.some((c) => c.kind === 'compare')"
          :f="f"
          :w="w"
          @pick="onPick"
          @alarm="onBeamCard"
        />
        <DetailTags v-else :scene="scene" :f="f" :w="w" @pick="onDetailTag" />
        <!-- 下钻路径：全链 › 单条皮带 › 部件 -->
        <div v-if="level" class="crumb">
          <a @click="toOverview"><Ic name="back" />全链剖面</a>
          <i>›</i>
          <a
            :class="{ on: level === 'belt' }"
            @click="level !== 'belt' && toBelt()"
            >{{ crumb.belt }}<em>{{ crumb.where }}</em></a
          >
          <template v-if="level !== 'belt'">
            <i>›</i><a class="on">{{ crumb.part }}</a>
          </template>
          <span class="code">{{ crumb.hint }}</span>
        </div>
        <div v-else class="scene-tools">
          <span class="code">VIEW / 全链剖面 · 竖向 ×5</span>
          <div>
            <a
              v-for="l in LAYERS"
              :key="l.key"
              :class="{ on: layers[l.key] }"
              @click="toggleLayer(l.key)"
              >{{ l.name }}</a
            >
            <a v-if="!atHome" class="home" @click="goHome">回到全景</a>
          </div>
        </div>
        <ChainStrip
          v-if="tab === 'board' || tab === 'run'"
          :f="f"
          :w="w"
          :selected="selected"
          @pick="onPick"
        />
        <AlarmTimeline
          v-else-if="tab === 'alarm'"
          :f="f"
          :w="w"
          @pick="onAlarm"
        />
        <TempStrip v-else-if="tab === 'diag'" :w="w" @pick="onPick" />
        <Gantt v-else-if="tab === 'ops'" :w="w" @locate="onLocate" />
        <!-- 人工干预横条 -->
        <div v-if="control.ctl.active" class="manual-bar">
          <b>人工干预中</b
          ><span>集控操作覆盖仿真数据 · {{ control.ctl.log[0]?.text }}</span
          ><a @click="control.reset()">恢复自动</a>
        </div>
        <Timeline
          :f="f"
          :w="w"
          :live="isLive && !scen.run.key"
          :script="scen.run.key"
          @seek="onSeek"
          @live="onLive"
          @script="startScript"
        />
        <ScriptOverlay
          v-if="scen.run.key"
          :run="scen.run"
          :steps="scen.steps()"
          :cards="scriptCards"
          :now="f.ms"
          @pause="scen.pause()"
          @resume="scen.resume()"
          @stop="scen.stop()"
          @seek="scen.seek($event)"
        />
      </template>
    </div>
    <ConfirmDialog :ask="ask" @confirm="onConfirm" @cancel="ask = null" />
    <!-- 手机竖屏：提示横屏（整屏仍按 16:9 等比缩小显示，可关掉） -->
    <div v-if="showRotate" class="rotate-hint">
      <span>横屏或用电脑打开，效果更好</span>
      <a @click="rotateDismissed = true">知道了</a>
    </div>
    <div v-if="!ready" class="loading scene-loading">
      {{ error || "主煤流沙盘加载中…" }}
    </div>
  </div>
</template>

<script setup>
  import { ConveyorScene } from "./scene/ConveyorScene.js"
  import { chainageToPoint } from "./scene/section.js"
  import { createConveyorSim } from "./sim/simulator.js"
  import { createClock } from "./store/clock.js"
  import { createBoard, slowKey } from "./store/board.js"
  import { installDashboardHooks } from "./dev/hooks.js"
  import layout from "./data/layout.json"
  import PageHeader from "./components/PageHeader.vue"
  import KpiStrip from "./components/KpiStrip.vue"
  import SceneTags from "./components/SceneTags.vue"
  import ChainStrip from "./components/ChainStrip.vue"
  import Timeline from "./components/Timeline.vue"
  import Production from "./components/board/Production.vue"
  import BeltTable from "./components/board/BeltTable.vue"
  import Bunkers from "./components/board/Bunkers.vue"
  import Energy from "./components/board/Energy.vue"
  import Standard from "./components/board/Standard.vue"
  import Dims from "./components/board/Dims.vue"
  import AlarmList from "./components/board/AlarmList.vue"
  import Predict from "./components/board/Predict.vue"
  import Sensing from "./components/board/Sensing.vue"
  import Patrol from "./components/board/Patrol.vue"
  import FlowDiagram from "./components/run/FlowDiagram.vue"
  import ControlOps from "./components/run/ControlOps.vue"
  import StateBands from "./components/run/StateBands.vue"
  import OpLog from "./components/run/OpLog.vue"
  import BeltParams from "./components/run/BeltParams.vue"
  import DriveUnits from "./components/run/DriveUnits.vue"
  import Protections from "./components/run/Protections.vue"
  import AiVideo from "./components/run/AiVideo.vue"
  import PersonPanel from "./components/alarm/PersonPanel.vue"
  import MachinePanel from "./components/alarm/MachinePanel.vue"
  import MaterialPanel from "./components/alarm/MaterialPanel.vue"
  import EnvPanel from "./components/alarm/EnvPanel.vue"
  import LevelSummary from "./components/alarm/LevelSummary.vue"
  import AlarmCards from "./components/alarm/AlarmCards.vue"
  import AlarmTrend from "./components/alarm/AlarmTrend.vue"
  import DynThreshold from "./components/alarm/DynThreshold.vue"
  import AlarmTimeline from "./components/alarm/AlarmTimeline.vue"
  import DegradeList from "./components/diag/DegradeList.vue"
  import TrendChart from "./components/diag/TrendChart.vue"
  import RulPanel from "./components/diag/RulPanel.vue"
  import Spectrum from "./components/diag/Spectrum.vue"
  import DasPanel from "./components/diag/DasPanel.vue"
  import DtsPanel from "./components/diag/DtsPanel.vue"
  import XrayPanel from "./components/diag/XrayPanel.vue"
  import TempStrip from "./components/diag/TempStrip.vue"
  import NightPlan from "./components/ops/NightPlan.vue"
  import Decisions from "./components/ops/Decisions.vue"
  import Spares from "./components/ops/Spares.vue"
  import Robots from "./components/ops/Robots.vue"
  import Lifecycle from "./components/ops/Lifecycle.vue"
  import PdmEffect from "./components/ops/PdmEffect.vue"
  import Gantt from "./components/ops/Gantt.vue"
  import ConfirmDialog from "./components/ConfirmDialog.vue"
  import DetailTags from "./components/DetailTags.vue"
  import Ic from "./components/Ic.vue"
  import ScriptOverlay from "./components/ScriptOverlay.vue"
  import { createScenarios } from "./store/scenarios.js"
  import { createControl, MODES } from "./store/control.js"
  import "./styles/board.scss"
  import "./styles/tabs.scss"
  import "./styles/alarm.scss"
  import "./styles/diag.scss"
  import "./styles/ops.scss"
  import "./styles/script.scss"
  import "./styles/page.scss"

  // 定稿画的那一刻（docs/design/smart-conveyor/04-data-spec.md）
  const DESIGN_T = Date.parse("2026-10-30T21:20:00+08:00")

  const route = useRoute()
  const pinned = route.query.at
    ? Date.parse(`${route.query.at}:00+08:00`)
    : null
  const sim = createConveyorSim(layout)
  const clock = createClock(sim, {
    pinned: Number.isFinite(pinned) ? pinned : null
  })
  const board = createBoard(sim, layout)
  // 集控本地操作层：覆盖在仿真状态上（见 store/control.js）
  const control = createControl(layout)
  // 故障剧本：播放时把时钟钉到剧本时刻，再叠加剧本事件（见 store/scenarios.js）
  const scen = createScenarios({
    sim,
    layout,
    onTime: (t) => clock.pin(t),
    onStep: onScriptStep,
    onEnd: onScriptEnd
  })
  const scriptCards = computed(() => {
    void scen.run.tick
    return scen.cards()
  })
  // 面板里需要按设备取读数的（摄像机、频谱等）直接拿仿真器
  provide("sim", sim)
  /** 时间轴的"现在 / 回放"：跟随实时，或停在深链钉住的那一刻（定稿时刻），都算"现在" */
  const isLive = computed(
    () =>
      clock.live.value ||
      (Number.isFinite(pinned) && clock.cursor.value === pinned)
  )

  const pageRef = ref(null)
  const canvasRef = ref(null)
  const ready = ref(false)
  const error = ref("")
  const tab = ref(route.query.tab || "board")
  const selected = ref(null)
  /** 运行中心看的皮带：选中的皮带，没选默认主斜井 */
  const runBelt = computed(() =>
    selected.value && selected.value.startsWith("BC") ? selected.value : "BC02"
  )
  const atHome = ref(true)
  // 三维场景是普通类实例，不能让 Vue 做深层响应
  const sceneRef = shallowRef(null)
  const scene = computed(() => sceneRef.value)

  /* ---------------- 面板数据：快的每秒、慢的 10 秒一档 ---------------- */
  // 显示用状态 = 仿真状态叠加集控覆盖（ctl 变化时立即重算，不等下一秒）
  const view = computed(() => scen.apply(control.apply(clock.state.value)))
  const f = shallowRef(null)
  const w = shallowRef(null)
  let wKey = null
  watch(
    view,
    (s) => {
      if (!s) return
      f.value = board.fast(s)
      const k = slowKey(s.t)
      if (k !== wKey) {
        wKey = k
        w.value = board.slow(s.t)
        sceneRef.value?.setSlow(w.value)
      }
      if (sceneRef.value && ready.value) sceneRef.value.setState(s)
    },
    { immediate: true }
  )

  /* ---------------- 舞台：16:9，按窗口居中 ---------------- */
  const viewport = ref({ w: 1920, h: 1080 })
  /**
   * 页面缩放（同 /smart-ranch）：rem = min(宽, 高 × 16 / 9) / 10，窗口偏扁时整体按高度缩小，侧栏不被裁；
   * 离开页面时还原成按宽度（amfe-flexible 的规则）
   */
  function fitRem() {
    const el = document.documentElement
    viewport.value = { w: el.clientWidth, h: el.clientHeight }
    const sw = Math.min(el.clientWidth, (el.clientHeight * 16) / 9)
    el.style.fontSize = `${sw / 10}px`
  }
  /** 舞台（1920 × 1080 设计稿）在窗口里的位置与尺寸（CSS 像素） */
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

  function onResize() {
    fitRem()
    sceneRef.value?.resize()
  }

  /* ---------------- 图层开关 ---------------- */
  const LAYERS = [
    { key: "coal", name: "煤流" },
    { key: "sensors", name: "传感器" },
    { key: "dts", name: "光纤测温" },
    { key: "people", name: "人员" },
    { key: "robots", name: "机器人" }
  ]
  const layers = reactive({
    coal: true,
    sensors: true,
    dts: true,
    people: false,
    robots: false
  })
  function toggleLayer(k) {
    layers[k] = !layers[k]
    sceneRef.value?.setLayer(k, layers[k])
  }

  /* ---------------- 交互 ---------------- */
  /** 用户切页签：切到这个页签的默认三维焦点（剧本里切页签不走这里） */
  function onTab(k) {
    tab.value = k
    defaultView(k)
  }
  /**
   * 各页签的默认焦点（05-requirement：看板 = 全链；运行 = 选中皮带；预警 = 告警最多的皮带；
   * 诊断 = 劣化最重的设备；运维 = 今夜检修位置）
   */
  function defaultView(k) {
    const s = f.value?.s
    if (!s || scen.run.key) return
    if (k === "board") return toOverview()
    if (k === "run") {
      const id = runBelt.value
      const L = layout.belts.find((b) => b.id === id).L
      const tr = s.tracks.find(
        (t) => t.belt === id && t.kind === "idlerBearing"
      )
      return enterBelt(id, tr ? tr.chainage : Math.max(40, L - 60))
    }
    if (k === "alarm") {
      toOverview(false)
      const n = {}
      for (const a of s.alarms) if (a.belt) n[a.belt] = (n[a.belt] || 0) + 1
      const top = Object.entries(n).sort((a, b) => b[1] - a[1])[0]
      if (top) flyOverview(top[0])
      return
    }
    if (k === "diag") {
      const tr = diagTr.value
      if (tr) return enterPart(tr)
      return toOverview()
    }
    if (k === "ops") {
      const wo =
        (w.value?.tonight || []).find((x) => x.track) || w.value?.tonight[0]
      if (wo) return enterBelt(wo.belt, wo.chainage)
      return toOverview()
    }
  }

  /* ---------------- 三级下钻 ---------------- */
  // level：null = 全链剖面；"belt" = 单条皮带；"idler" / "drive" = 部件
  const level = ref(null)
  const levelInfo = ref({})
  const crumb = computed(() => {
    const i = levelInfo.value
    const b = layout.belts.find((x) => x.id === i.belt)
    if (!b) return {}
    return {
      belt: `${b.id} ${b.short}`,
      where: ` · ${Math.round(i.center ?? 0).toLocaleString("en-US")} m`,
      part:
        level.value === "idler"
          ? `${i.track?.where?.replace(/^\S+ /, "") || "托辊组"} 特写`
          : `${i.motor || ""} 驱动部拆解`,
      hint:
        level.value === "belt"
          ? "拖动旋转 · 滚轮缩放 · 点发热托辊 / 驱动部看部件"
          : "自动旋转 · 拖动查看"
    }
  })
  function enterBelt(id, center) {
    const sc = sceneRef.value
    if (!sc) return
    selected.value = id
    sc.enterDetail("belt", { belt: id, center })
    level.value = "belt"
    levelInfo.value = { belt: id, center: sc.detail.center }
    atHome.value = false
  }
  /** 部件：托辊劣化 → 托辊特写；其余（电机 / 减速机 / 滚筒）→ 驱动部拆解 */
  function enterPart(tr) {
    const sc = sceneRef.value
    if (!sc || !tr) return
    selected.value = tr.belt
    if (tr.kind === "idlerBearing") {
      sc.enterDetail("idler", { belt: tr.belt, track: tr })
      level.value = "idler"
      levelInfo.value = { belt: tr.belt, center: tr.chainage, track: tr }
    } else enterDrive(tr.belt, tr.device.replace(/-(R|DP)(\d)$/, "-M$2"), tr)
    atHome.value = false
  }
  function enterDrive(belt, motor, tr = null) {
    const sc = sceneRef.value
    const b = layout.belts.find((x) => x.id === belt)
    const m = b.drives.some((d) => d.id === motor) ? motor : b.drives[0].id
    const track =
      tr ||
      f.value.s.tracks.find(
        (t) => t.belt === belt && /-(M|R|DP)\d$/.test(t.device)
      ) ||
      null
    sc.enterDetail("drive", { belt, motor: m, track })
    level.value = "drive"
    levelInfo.value = { belt, center: b.L, motor: m, track }
    atHome.value = false
  }
  /** 面包屑：回到单条皮带（部件所在位置） */
  function toBelt() {
    const i = levelInfo.value
    const b = layout.belts.find((x) => x.id === i.belt)
    enterBelt(i.belt, level.value === "drive" ? b.L - 40 : i.center)
  }
  /** 回到全链剖面（fly = false 时只退出下钻、不飞回主机位） */
  function toOverview(fly = true) {
    const sc = sceneRef.value
    if (level.value) sc?.exitDetail()
    level.value = null
    levelInfo.value = {}
    if (fly) goHome()
  }
  /** 总览里飞到皮带 / 煤仓 */
  function flyOverview(id) {
    const sc = sceneRef.value
    if (!sc) return
    if (level.value) toOverview(false)
    selected.value = id
    if (id.startsWith("BC")) sc.flyToBelt(id)
    else if (id.startsWith("MC")) sc.flyToBunker(id)
    atHome.value = false
  }

  /** 面板 / 标签 / 一张图里点皮带或煤仓：飞过去并选中；运行中心里点皮带直接看这条皮带 */
  function onPick(id) {
    if (!id) return
    if (tab.value === "run" && id.startsWith("BC") && !scen.run.key) {
      selected.value = id
      return defaultView("run")
    }
    flyOverview(id)
  }
  /** 三维里点中：同一条皮带再点一次进入单条皮带（点哪进哪）；下钻里点发热托辊 / 驱动部进入部件 */
  function onScenePick(hit) {
    if (hit.detail) {
      if (hit.detail.kind === "idler") {
        const tr = f.value.s.tracks.find((t) => t.id === hit.detail.track)
        if (tr) enterPart(tr)
      } else if (hit.detail.kind === "drive") enterDrive(levelInfo.value.belt)
      return
    }
    if (
      hit.id.startsWith("BC") &&
      selected.value === hit.id &&
      hit.chainage != null
    )
      return enterBelt(hit.id, hit.chainage)
    flyOverview(hit.id)
  }
  /** 下钻标签：劣化托辊 → 特写；驱动部 → 拆解 */
  function onDetailTag(t) {
    if (t.kind === "fault") {
      const tr = f.value.s.tracks.find((x) => x.id === t.id)
      if (tr) enterPart(tr)
    } else if (t.kind === "drive") enterDrive(levelInfo.value.belt)
  }
  /** 点告警（列表、时间线）：总览里飞到告警位置 */
  function onAlarm(a) {
    const sc = sceneRef.value
    if (!sc) return
    if (level.value) toOverview(false)
    const p = sc.beacons.anchor(a.id)
    if (!p) return
    selected.value = a.belt || null
    sc.flyTo(p, 900)
    atHome.value = false
  }
  /** 三维里的告警卡：直接下钻到告警位置那一段皮带 */
  function onBeamCard(a) {
    if (a.belt && a.chainage != null) enterBelt(a.belt, a.chainage)
  }
  /** 驱动部一行 → 诊断中心看这台设备（有劣化过程就选中它） */
  function onDiag(id) {
    diagDevice.value = id
    const tr = f.value.s.tracks.find((t) => t.device === id)
    if (tr) diagTrackId.value = tr.id
    tab.value = "diag"
    const belt = id.split("-")[0]
    if (tr) enterPart(tr)
    else enterDrive(belt, id.replace(/-(R|DP)(\d)$/, "-M$2"))
  }
  const diagDevice = ref(null)
  const diagTrackId = ref(null)
  /** 诊断中心看的劣化过程：选中的，没有就取最严重的 */
  const diagTr = computed(() => {
    const tracks = f.value?.s.tracks || []
    return (
      tracks.find((t) => t.id === diagTrackId.value) ||
      [...tracks].sort((a, b) => b.s - a.s)[0] ||
      null
    )
  })
  function onDiagSelect(id) {
    diagTrackId.value = id
    diagDevice.value = null
    if (diagTr.value) enterPart(diagTr.value)
  }

  /** 检修任务 → 三维飞到检修位置 */
  function onLocate(x) {
    const sc = sceneRef.value
    if (!sc || !x.belt || x.chainage == null) return
    if (tab.value === "ops") return enterBelt(x.belt, x.chainage)
    if (level.value) toOverview(false)
    selected.value = x.belt
    sc.flyTo(chainageToPoint(x.belt, x.chainage), 900)
    atHome.value = false
  }
  /** 机器人 → 三维飞到它当前所在位置（吊轨机器人沿所巡皮带，机器狗在地面栈桥） */
  function onFollow(r) {
    const sc = sceneRef.value
    const belt = { RB01: "BC02", RB02: "BC03", DOG01: "BC01" }[r.id]
    if (!sc || !belt) return
    if (belt !== "BC01") return enterBelt(belt, Math.max(30, r.x.pos))
    if (level.value) toOverview(false)
    selected.value = belt
    sc.flyTo(chainageToPoint(belt, Math.max(0, r.x.pos)), 800)
    atHome.value = false
  }

  /* ---------------- 集控操作：先确认，再执行 ---------------- */
  const ask = ref(null)
  const short = (id) => layout.belts.find((b) => b.id === id).short
  function onAsk(a) {
    const ms = f.value.ms
    const C = {
      start: {
        title: "一键启动",
        text: "按逆煤流顺序逐台起车：每台先发起车预警（语音 + 沿线声光），软启动到速后再起下一台。",
        affects: control.affects("start"),
        run: () => control.startAll(ms)
      },
      stop: {
        title: "一键停止",
        text: "按顺煤流顺序逐台停车：先停工作面侧，每台等上游拉空后再停下一台。",
        affects: control.affects("stop"),
        danger: true,
        run: () => control.stopAll(ms)
      },
      estop: {
        title: `急停 · ${a.id ? short(a.id) : ""}`,
        text: "立即停车并保持闭锁；往这条皮带上卸煤的上游皮带同时闭锁停车。复位前需现场确认。",
        affects: a.id ? control.affects("estop", a.id) : [],
        danger: true,
        yes: "确认急停",
        run: () => control.estop(a.id, ms)
      },
      mode: {
        title: `切换到${MODES.find((m) => m.key === a.mode)?.name}模式`,
        text:
          a.mode === "maint"
            ? "检修模式：全线挂牌闭锁，保护旁路，禁止任何起车操作。"
            : a.mode === "local"
              ? "就地模式：允许在现场 / 本屏手动设定单台带速，集控自动调速暂停。"
              : "集控模式：恢复集中自动控制。",
        affects: control.affects("mode"),
        danger: a.mode === "maint",
        run: () => control.setMode(a.mode, ms)
      },
      balance: {
        title: `料流均衡调速 · ${a.on ? "开" : "关"}`,
        text: a.on
          ? "按沿线煤量自动调整带速：料多快转、料少慢转、无料待机。"
          : "关闭后运行中的皮带回到额定带速，空载功率上升、节电率归零。",
        affects: control.affects("balance"),
        run: () => control.setBalance(a.on, ms)
      },
      speed: {
        title: `手动带速 · ${a.id ? short(a.id) : ""} → ${a.v?.toFixed(1)} m/s`,
        text: "就地模式下手动设定带速，5 分钟无操作恢复自动。",
        affects: a.id ? [short(a.id)] : [],
        run: () => control.setManualV(a.id, a.v, ms)
      }
    }[a.op]
    if (C) ask.value = C
  }
  function onConfirm() {
    ask.value?.run()
    ask.value = null
  }

  function goHome() {
    selected.value = null
    if (level.value) {
      sceneRef.value?.exitDetail()
      level.value = null
      levelInfo.value = {}
    }
    sceneRef.value?.flyHome()
    atHome.value = true
  }
  /** 时间轴回放：不超过现在 */
  function onSeek(t) {
    clock.seek(Math.min(t, Date.now()))
  }
  function onLive() {
    scen.stop(true)
    clock.goLive()
  }

  /* ---------------- 空闲自动巡游（?tour=0 关闭） ---------------- */
  // 看板页 45 s 没人操作：按煤流顺序逐个飞过皮带和煤仓，每站 8 s，回全景后循环；一有操作就停
  const TOUR_IDLE = 45000
  const TOUR_STOPS = [
    "home",
    "BC05",
    "BC04",
    "MC01",
    "BC03",
    "MC02",
    "BC02",
    "MC03"
  ]
  const tourOn = route.query.tour !== "0"
  let lastInput = performance.now()
  let touring = false
  let tourIdx = 0
  let tourFrozen = false
  let tourTimer = 0
  function onUserInput() {
    lastInput = performance.now()
    touring = false
  }
  function tourTick() {
    if (!tourOn || tourFrozen || !ready.value) return
    const idle = performance.now() - lastInput > TOUR_IDLE
    const allowed =
      tab.value === "board" &&
      !scen.run.key &&
      !ask.value &&
      !control.ctl.active
    if (!idle || !allowed) {
      touring = false
      return
    }
    if (!touring) {
      touring = true
      tourIdx = 0
    }
    const id = TOUR_STOPS[tourIdx++ % TOUR_STOPS.length]
    if (id === "home") toOverview()
    else flyOverview(id)
  }

  /* ---------------- 手机竖屏提示 ---------------- */
  const rotateDismissed = ref(false)
  const showRotate = computed(
    () =>
      !rotateDismissed.value &&
      viewport.value.h > viewport.value.w &&
      viewport.value.w < 900
  )

  /* ---------------- 故障剧本 ---------------- */
  function startScript(key) {
    if (!f.value) return
    control.reset()
    scen.start(key, f.value.ms)
  }
  /** 剧本进入新一步：切页签、选中、镜头 */
  function onScriptStep(step) {
    const sc = sceneRef.value
    if (step.tab) tab.value = step.tab
    if (step.select) selected.value = step.select
    if (!sc || !step.fly) return
    if (level.value) toOverview(false)
    if (step.fly === "home") {
      sc.flyHome()
      atHome.value = true
    } else {
      sc.flyTo(chainageToPoint(step.fly.belt, step.fly.chainage), step.fly.dist)
      atHome.value = false
    }
  }
  /** 剧本结束：回到实时（深链钉住的回到那一刻），镜头回全景 */
  function onScriptEnd() {
    sceneRef.value?.setMarker("intruder", null)
    if (Number.isFinite(pinned)) clock.pin(pinned)
    else clock.goLive()
    goHome()
  }
  // 剧本里的临时标记（越界的巡检工）跟着剧本进度走
  watch(
    () => scen.run.el,
    () => {
      const m = scen.marker()
      const sc = sceneRef.value
      if (!sc) return
      if (!m) return sc.setMarker("intruder", null)
      const p = chainageToPoint(m.belt, m.chainage).clone()
      p.z += m.side
      sc.setMarker("intruder", p)
    }
  )

  let hooks = null
  onMounted(async () => {
    fitRem()
    window.addEventListener("resize", onResize)
    for (const ev of ["pointerdown", "wheel", "keydown"])
      window.addEventListener(ev, onUserInput, { passive: true })
    tourTimer = setInterval(tourTick, 8000)
    try {
      const sc = new ConveyorScene(canvasRef.value, {
        sim,
        layout,
        getTime: () => clock.now(),
        unit: designUnit,
        origin: () => [stageBox.value.x, stageBox.value.y],
        onPick: (hit) => (hit ? onScenePick(hit) : null)
      })
      // 拖动镜头后出现"回到全景"
      sc.controls.addEventListener("start", () => (atHome.value = false))
      sceneRef.value = markRaw(sc)
      sc.setSlow(w.value)
    } catch (e) {
      error.value = `三维初始化失败：${e.message}`
      throw e
    }
    const sc = sceneRef.value
    hooks = installDashboardHooks({
      scene: sc,
      // 截图冻结画面时停掉自动巡游
      onFreeze: (on) => (tourFrozen = on),
      panels: () => [
        ...pageRef.value.querySelectorAll(
          ".pn, .hd, .kpis, .tg, .tg-ln, .beam-card, .stale-pin, .scene-tools, .crumb, .dtag, .cs, .tl"
        )
      ],
      states: {
        design: () => {
          clock.pin(DESIGN_T)
          selected.value = null
          atHome.value = true
          sc.setView("home")
        },
        latest: () => clock.goLive()
      }
    })
    sc.setState(view.value)
    ready.value = true
    // 深链：?tab=… 打开页签的默认焦点；?script=idler|tear|intrude 直接播剧本
    if (route.query.tab) defaultView(tab.value)
    if (route.query.script) startScript(String(route.query.script))
    await nextTick()
    await document.fonts.ready
    hooks.markReady()
  })
  onBeforeUnmount(() => {
    window.removeEventListener("resize", onResize)
    for (const ev of ["pointerdown", "wheel", "keydown"])
      window.removeEventListener(ev, onUserInput)
    clearInterval(tourTimer)
    scen.stop(true)
    hooks?.uninstall()
    clock.dispose()
    sceneRef.value?.dispose()
    // 还原成 amfe-flexible 的按宽度缩放
    document.documentElement.style.fontSize = `${document.documentElement.clientWidth / 10}px`
  })
</script>

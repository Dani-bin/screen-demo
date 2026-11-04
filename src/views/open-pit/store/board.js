/**
 * 青原露天矿：页面数据层与页面状态（Vue 响应式，面板组件都通过 inject("board") 取用）
 * ----------------------------------------------------------
 * 时钟：默认跟随真实时间，每秒刷一次「快数据」（sim.at + sim.monitors + 事件）；
 *       ?at=2026-10-30T20:30（北京时间）把时钟钉死在那一刻，只算一次，不再前进（截图比对用）。
 * 慢数据（分时运量、光伏曲线、边坡走势、车队时间条、异常车辆名单）每 10 秒重算一次，结构见 derive.js。
 * 页面状态：selection（选中的卡车 / 设备编号）、activeTab、activeView、tour（自动导览）、fleetFilter、提示框。
 * 三维场景由 index.vue 创建后用 bindScene 交给这里；所有对场景的调用（select / focus / setTour / setState）都收口在这个文件，
 * 面板组件只调 board 的方法，不直接碰场景。
 * 这个文件的 ref / computed 等 Vue API 靠 unplugin-auto-import 全局注入，不手写 import。
 */
import { DESIGN_T, createPitSim } from "../sim/simulator.js"
import { TOUR } from "../scene/PitScene.js"
import {
  buildFast,
  buildSlow,
  detailOf,
  fleetNotable,
  isKnownId
} from "./derive.js"

/** 顶栏五个页签：键、名称、点击后飞到的视角 */
export const TABS = [
  { key: "overview", name: "总览", view: "overview" },
  { key: "transport", name: "运输调度", view: "fleet" },
  { key: "slope", name: "边坡安全", view: "slope" },
  { key: "mining", name: "采装与爆破", view: "shovel" },
  { key: "energy", name: "能源与环保", view: "swap" }
]
/** 场景控制台六个按钮：视角键与名称 */
export const VIEW_BUTTONS = [
  { key: "overview", name: "总览" },
  { key: "fleet", name: "车队" },
  { key: "swap", name: "换电站" },
  { key: "shovel", name: "电铲装车" },
  { key: "slope", name: "边坡雷达" },
  { key: "yard", name: "煤场电厂" }
]
export const VIEW_NAME = Object.fromEntries(
  VIEW_BUTTONS.map((b) => [b.key, b.name])
)
/** 视角 → 页签：导览自动切视角时，页签和面板重点跟着走；煤场电厂归在「能源与环保」 */
const VIEW_TAB = {
  overview: "overview",
  fleet: "transport",
  slope: "slope",
  shovel: "mining",
  swap: "energy",
  yard: "energy"
}
/** 页签 → 要加亮边框的面板 */
const TAB_CARDS = {
  overview: [],
  transport: ["fleet", "trucks", "timeline"],
  slope: ["slope", "kpiSlope"],
  mining: ["shovel"],
  energy: ["swap", "kpiSwap"]
}

/** 无操作多久后自动开启导览（毫秒） */
const IDLE_MS = 45000

/**
 * @param {object} layout data/layout.json
 * @param {object} [opts]
 * @param {number|null} [opts.pinned] 钉死的时刻（毫秒）；null 跟随真实时间
 * @param {boolean} [opts.autoTour] 是否允许 45 秒无操作后自动导览（?tour=0 关闭）
 * @param {string|null} [opts.select] 初始选中的编号（?select=）
 */
export function createBoard(layout, opts = {}) {
  const { pinned = null, autoTour = true, select: initSelect = null } = opts
  const sim = markRaw(createPitSim(layout))

  // ---- 数据 ----
  const fast = shallowRef(null)
  const slow = shallowRef(null)

  // ---- 页面状态 ----
  const selection = ref(null)
  const fleetFilter = ref(null)
  const activeTab = ref("overview")
  const activeView = ref("overview")
  const tour = reactive({
    on: false,
    view: "overview",
    next: TOUR[1]?.view ?? "fleet",
    left: TOUR[0]?.dwell ?? 10,
    dwell: TOUR[0]?.dwell ?? 10
  })
  const stageEl = shallowRef(null)
  const tip = reactive({ on: false, x: 0, y: 0, title: "", rows: [] })

  let scene = null
  let slowKey = null
  let dataTimer = 0
  let tourTimer = 0
  let idleTimer = 0
  // 场景回调过 onTour 之后，倒计时和换站都听场景的；没有回调（接口桩）时页面自己兜底循环显示
  let sceneTours = false

  // ---------------------------------------------------------------- 数据刷新

  function refresh(ms) {
    const f = buildFast(sim, layout, ms)
    fast.value = f
    const key = Math.floor(ms / 10000)
    if (key !== slowKey) {
      slowKey = key
      slow.value = buildSlow(sim, ms)
    }
    pushState()
  }

  /** 把当前仿真状态和监测量喂给场景（场景自己在两次之间外推卡车位置，监测量画边坡热区和基站灯） */
  function pushState() {
    const f = fast.value
    if (!scene || !f) return
    scene.setState(f.s, f.m)
  }

  function start() {
    refresh(pinned ?? Date.now())
    // 设计时刻且没有手动选择时，默认选中 TK-037（设计稿里的详情卡）
    if (initSelect) selection.value = initSelect
    else if (pinned != null && Math.abs(pinned - DESIGN_T) < 60000)
      selection.value = "TK-037"
    if (pinned == null) dataTimer = setInterval(() => refresh(Date.now()), 1000)
    tourTimer = setInterval(tickTour, 1000)
    armIdle()
  }

  function stop() {
    clearInterval(dataTimer)
    clearInterval(tourTimer)
    clearTimeout(idleTimer)
  }

  // ---------------------------------------------------------------- 场景对接

  function bindScene(sc) {
    scene = sc
    if (selection.value) scene.select(selection.value)
    pushState()
  }

  /** 场景里点选了卡车 / 设备（null = 点空白） */
  function onSceneSelect(id) {
    selection.value = id || null
  }

  /** 场景相机视角变了（导览自动切换、或我们自己调 focus 后场景回调） */
  function onSceneView(view) {
    activeView.value = view
    activeTab.value = VIEW_TAB[view] ?? activeTab.value
  }

  /** 场景的导览状态回调：当前站、下一站、本站剩余秒数、是否开着 */
  function onSceneTour(info) {
    sceneTours = true
    tour.on = !!info.on
    tour.view = info.view
    tour.next = info.next
    tour.left = Math.max(0, Math.ceil(info.left))
    tour.dwell = TOUR.find((t) => t.view === info.view)?.dwell ?? tour.dwell
  }

  // ---------------------------------------------------------------- 交互

  /** 选中卡车 / 设备（null 取消）：同步给场景（高亮 + 相机轻推） */
  function select(id) {
    selection.value = id || null
    scene?.select(id || null)
  }

  /** 事件 / 标签点选：只有布局里有的编号才选（BS-xx 之类的泛指不选） */
  function selectIfKnown(id) {
    if (isKnownId(layout, id)) select(id)
  }

  /** 相机飞到某个视角；页签和面板重点跟着视角走 */
  function focus(view) {
    onSceneView(view)
    scene?.focus(view)
  }

  /** 点顶栏页签：切页签、飞到它的视角、对应面板加亮 */
  function setTab(key) {
    const tab = TABS.find((t) => t.key === key)
    if (!tab) return
    activeTab.value = key
    focus(tab.view)
  }

  /** 点编组行：单车列表只看这个编组（再点一次取消），相机飞到车队视角 */
  function pickFleet(id) {
    fleetFilter.value = fleetFilter.value === id ? null : id
    if (fleetFilter.value) focus("fleet")
  }

  /** 面板 id 是否因当前页签而加亮 */
  function isHl(card) {
    return TAB_CARDS[activeTab.value]?.includes(card) ?? false
  }

  // ---------------------------------------------------------------- 自动导览

  function setTour(on) {
    tour.on = on
    scene?.setTour(on)
    if (on && !sceneTours) {
      // 没有场景回调时，从当前视角所在的站开始数
      const i = Math.max(
        0,
        TOUR.findIndex((t) => t.view === activeView.value)
      )
      setStop(i)
    }
  }

  function toggleTour() {
    setTour(!tour.on)
    armIdle()
  }

  /** 兜底显示：第 i 站，下一站，剩余秒数 */
  function setStop(i) {
    const cur = TOUR[i % TOUR.length]
    tour.view = cur.view
    tour.next = TOUR[(i + 1) % TOUR.length].view
    tour.dwell = cur.dwell
    tour.left = cur.dwell
  }

  function tickTour() {
    // 场景在回调 onTour（每秒和换站时），倒计时和换站都听场景的
    if (!tour.on || sceneTours) return
    // 没有回调（接口桩）时页面自己倒计时、循环显示
    if (tour.left > 0) tour.left -= 1
    if (tour.left <= 0) {
      const i = TOUR.findIndex((t) => t.view === tour.next)
      setStop(i < 0 ? 0 : i)
    }
  }

  /**
   * 任何点击 / 滚轮 / 按键：暂停导览并重新计 45 秒；点导览开关本身不暂停（它自己处理）。
   * 计满后自动开启导览，先取消选中（导览会把镜头带走）。
   */
  function noteActivity(e) {
    const onToggle = e?.target?.closest?.(".tour-toggle")
    if (!onToggle && tour.on) setTour(false)
    armIdle()
  }

  function armIdle() {
    clearTimeout(idleTimer)
    if (!autoTour) return
    idleTimer = setTimeout(() => {
      if (tour.on) return
      select(null)
      setTour(true)
    }, IDLE_MS)
  }

  // ---------------------------------------------------------------- 提示框（图表悬停）

  /** 在鼠标位置显示提示；坐标换算成舞台的设计像素 */
  function showTip(e, title, rows = []) {
    const el = stageEl.value
    if (!el) return
    const r = el.getBoundingClientRect()
    const k = r.width / 1920 || 1
    tip.x = (e.clientX - r.left) / k
    tip.y = (e.clientY - r.top) / k
    tip.title = title
    tip.rows = rows
    tip.on = true
  }
  function hideTip() {
    tip.on = false
  }

  // ---------------------------------------------------------------- 派生

  const detail = computed(() =>
    detailOf(selection.value, fast.value, layout, sim.ROUTES)
  )
  /** 单车列表的车辆编号：选了编组就看该编组，否则取全矿异常 / 低电量优先名单（10 秒更新一次） */
  const truckIds = computed(() => {
    if (!fast.value) return []
    if (fleetFilter.value) return fleetNotable(fast.value, fleetFilter.value)
    return slow.value?.notableIds ?? []
  })
  /** 是否跟随真实时间（false = 被 ?at= 钉死） */
  const live = pinned == null

  return {
    sim,
    layout: markRaw(layout),
    live,
    fast,
    slow,
    selection,
    fleetFilter,
    activeTab,
    activeView,
    tour,
    tip,
    stageEl,
    detail,
    truckIds,
    start,
    stop,
    bindScene,
    onSceneSelect,
    onSceneView,
    onSceneTour,
    select,
    selectIfKnown,
    focus,
    setTab,
    pickFleet,
    isHl,
    toggleTour,
    noteActivity,
    showTip,
    hideTip
  }
}

/*
 * 三段故障剧本（虚实双生预演）
 * ----------------------------------------------------------
 * 剧本是页面上的脚本，不改仿真器。每段剧本定义：
 *   time(el)    剧本第 el 秒对应的仿真时刻（页面把时钟钉到这一刻，面板 / 三维都跟着走）
 *   apply(s,el) 在仿真状态上叠加剧本事件（告警、停机、闭锁、重新起车）
 *   steps       字幕与镜头（第几秒、说什么、飞到哪、切到哪个页签）
 *   cards(el)   场景里的说明卡（"如果不处理"对照、撕裂长度、告警推送、视频回放、派单…）
 *   marker(el)  三维里的临时标记（越界的巡检工）
 * 1. 托辊劣化提前预警：直接快进仿真器里真实的劣化过程（劣化开始 → 三级 → 二级 → 当晚检修 → 关闭），
 *    最后对照"如果不处理"——这是平台与集控的根本区别：平台提前几天预警，集控只能在卡死那一刻跳闸
 * 2. 纵撕急停：BC04 机尾受料点，AI 识别锚杆 → 激光纵撕 → 停机 → 上游闭锁 → 推送 / 回放 / 派单
 * 3. 人员越界闭锁：BC02 机头，UWB 电子围栏 + AI 视频报警 → 软停闭锁 → 撤离 → 复位 → 逆煤流起车
 */
import { ST, ST_NAME, beijing } from "../sim/simulator.js"

const MIN = 60000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const pad2 = (n) => String(n).padStart(2, "0")
const hm = (ms) => {
  const b = beijing(ms)
  return `${pad2(b.h)}:${pad2(b.m)}`
}
const md = (ms) => {
  const b = beijing(ms)
  return `${Number(b.date.slice(5, 7))}/${Number(b.date.slice(8, 10))}`
}
/** 分段线性插值：pts = [[x, y], …] */
function lerpPts(pts, x) {
  if (x <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++)
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1]
      const [x1, y1] = pts[i]
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1)
    }
  return pts[pts.length - 1][1]
}
const clamp01 = (x) => Math.max(0, Math.min(1, x))

/** 改一条皮带的状态（带速、运量、功率按比例跟着变） */
function setBelt(out, id, state, vk) {
  const st = out.belts[id]
  const v = st.v * vk
  out.belts[id] = {
    ...st,
    state,
    stateName: ST_NAME[state],
    v,
    flowOut: vk > 0.05 ? st.flowOut * vk : 0,
    power: vk > 0.05 ? st.power * (0.45 + 0.55 * vk) : 0
  }
}
/** 皮带变了之后重算 KPI */
function fixKpi(out) {
  const bs = Object.values(out.belts)
  out.kpi = {
    ...out.kpi,
    powerTotal: bs.reduce((a, x) => a + x.power, 0),
    flowNow: out.belts.BC02.flowOut,
    beltsRunning: bs.filter((x) => x.v > 0.05).length
  }
}
const clone = (s) => ({ ...s, belts: { ...s.belts }, alarms: [...s.alarms] })

/* ================================================================ 1. 托辊劣化提前预警 */
function idlerScript(sim, layout, now) {
  const isIdler = (t) => t.kind === "idlerBearing"
  // 选正在劣化最重的托辊；没有就取近 30 天最近一次
  const cur = sim
    .tracksAt(now)
    .filter(isIdler)
    .sort((a, b) => sim.severity(b, now) - sim.severity(a, now))[0]
  const tr =
    cur ||
    sim
      .tracksBetween(now - 30 * DAY, now)
      .filter(isIdler)
      .sort((a, b) => b.tFix - a.tFix)[0]
  if (!tr) return null
  const wo = sim
    .nightPlan(beijing(tr.tFix).date)
    .find((x) => x.track === tr.id) || {
    start: tr.tFix - 50 * MIN,
    end: tr.tFix,
    crew: 3
  }
  // 剧本秒 → 仿真时刻：劣化开始前 2 h 起，到检修完成后 20 min 止
  const K = [
    [0, tr.t0 - 2 * HOUR],
    [10, tr.t0 + 10 * HOUR],
    [24, tr.tWarn],
    [38, tr.tAlarm],
    [52, wo.start],
    [60, wo.end + 20 * MIN],
    [84, wo.end + 20 * MIN]
  ]
  const lead = (wo.start - tr.tWarn) / DAY
  const belt = layout.belts.find((b) => b.id === tr.belt)
  return {
    key: "idler",
    name: "托辊劣化提前预警",
    dur: 84,
    track: tr,
    /** 预热：剧本要跨好几天，先把这些天的仿真段算好，播放时不卡 */
    warm: () => {
      const ts = []
      for (let t = K[0][1]; t <= K[K.length - 1][1]; t += 12 * HOUR) ts.push(t)
      ts.push(K[K.length - 1][1])
      return ts
    },
    time: (el) => lerpPts(K, el),
    steps: [
      {
        at: 0,
        text: `${md(tr.t0)} · ${tr.where} 轴承开始劣化，光纤听诊已捕捉到微弱异响；集控画面上一切正常`,
        fly: { belt: tr.belt, chainage: tr.chainage, dist: 1500 },
        tab: "board",
        select: tr.belt
      },
      {
        at: 10,
        text: "听诊评分逐日上升，测温还没有明显变化 —— 点式温度保护此时“看不见”"
      },
      {
        at: 24,
        text: `${md(tr.tWarn)} ${hm(tr.tWarn)} · 测温热点抬头，平台发出三级预警：比计划检修早 ${lead.toFixed(1)} 天`
      },
      {
        at: 38,
        text: `${md(tr.tAlarm)} ${hm(tr.tAlarm)} · 严重度 70 %，二级预警，自动派单到零点班`
      },
      {
        at: 52,
        text: `${md(wo.start)} ${hm(wo.start)} · 零点班挂牌闭锁 ${belt.short}，${wo.crew} 人更换托辊`
      },
      { at: 60, text: "更换完成，告警关闭 · 全程没有一次非计划停机" },
      {
        at: 66,
        text: "如果不处理：严重度继续上升 → 轴承卡死 → 摩擦升温 → 烟雾 / 超温保护跳闸，集控只能事后停车",
        fly: "home"
      }
    ],
    apply: (s) => s,
    cards: (el) =>
      el >= 66
        ? [
            {
              kind: "compare",
              lead,
              where: tr.where,
              fixMin: Math.round((wo.end - wo.start) / MIN),
              // 非计划停机：抢修 3.5 h（演示假设）× 主斜井平均运量
              downH: 3.5,
              tons: Math.round(3.5 * 1500)
            }
          ]
        : [],
    marker: () => null
  }
}

/* ================================================================ 2. 纵撕急停 */
function tearScript(sim, layout, now) {
  const B = "BC04"
  const ch = layout.belts.find((b) => b.id === B).loads[0].at + 14 // 受料点下游
  const cam = "BC04-CAM02"
  const T0 = now
  const at = (el) => T0 + el * 1000
  return {
    key: "tear",
    name: "纵撕急停",
    dur: 40,
    warm: () => [T0, T0 + 40000],
    time: at,
    steps: [
      {
        at: 0,
        text: "BC04 一采区运输上山 · 机尾受料点：BC05 转载落煤，AI 摄像机持续识别",
        fly: { belt: B, chainage: ch + 120, dist: 1500 },
        tab: "run",
        select: B
      },
      { at: 5, text: "AI 视频识别到落煤里夹带锚杆（异物）· 置信度 96 %" },
      { at: 7, text: "2 秒后激光纵撕检测：输送带底面出现纵向划痕" },
      {
        at: 7.6,
        text: "输出停机信号：BC04 保护停机，撕裂停在 6.2 m，没有扩展到 18 m"
      },
      {
        at: 10,
        text: "联锁：BC05 闭锁停车，12301 综采面闭锁停机；BC06 掘进顺槽同时闭锁"
      },
      { at: 15, text: "告警推送：调度室、机电区队长、跟班队长同时收到" },
      { at: 22, text: "视频回放：锚杆进入受料点 → 划破带面的全过程" },
      { at: 30, text: "处置派单：更换受损带段 · 冷粘修补，预计 2.5 h 恢复" }
    ],
    apply: (s, el) => {
      if (el < 5) return s
      const out = clone(s)
      out.alarms.unshift({
        id: "SC-RIP-FG",
        kind: "foreign",
        dim: "material",
        level: 2,
        sense: "视频",
        title: "异物 · 锚杆",
        belt: B,
        device: cam,
        chainage: ch,
        at: at(5),
        status: el < 15 ? "未处理" : "处理中",
        source: "平台"
      })
      if (el >= 7) {
        out.alarms.unshift({
          id: "SC-RIP-TR",
          kind: "tear",
          dim: "machine",
          level: 0,
          sense: "图像",
          title: "纵向撕裂 · 激光检测",
          belt: B,
          device: "BC04-LT1",
          chainage: ch + 10,
          at: at(7),
          status: el < 30 ? "未处理" : "处理中",
          source: "集控"
        })
      }
      if (el >= 7.6) {
        setBelt(out, B, ST.FAULT, clamp01(1 - (el - 7.6) / 2.5))
        out.belts[B].protection = "TR"
        out.belts[B].tripTitle = "纵向撕裂保护动作"
      }
      if (el >= 8.5) {
        const k = clamp01(1 - (el - 8.5) / 2)
        setBelt(out, "BC05", ST.LOCK, k)
        setBelt(out, "BC06", ST.LOCK, k)
      }
      if (el >= 10)
        out.faces = {
          ...out.faces,
          WF12301: { ...out.faces.WF12301, output: 0, phase: "stop" }
        }
      fixKpi(out)
      return out
    },
    cards: (el) => {
      const c = []
      if (el >= 7)
        c.push({
          kind: "tear",
          len: Math.min(6.2, Math.max(0.3, (el - 7) * 2.6)),
          limit: 18
        })
      if (el >= 15)
        c.push({
          kind: "push",
          to: ["调度室 王建国", "机电区队长 刘志强", "跟班队长 陈国栋"]
        })
      if (el >= 22) c.push({ kind: "video", cam, hit: "纵向撕裂", at: at(7) })
      if (el >= 30)
        c.push({
          kind: "order",
          id: "WO-RIP",
          title: "BC04 受料点 带面冷粘修补",
          crew: 4,
          hours: 2.5
        })
      return c
    },
    marker: () => null
  }
}

/* ================================================================ 3. 人员越界闭锁 */
function intrudeScript(sim, layout, now) {
  const B = "BC02"
  const L = layout.belts.find((b) => b.id === B).L
  const T0 = now
  const at = (el) => T0 + el * 1000
  return {
    key: "intrude",
    name: "人员越界闭锁",
    dur: 30,
    warm: () => [T0, T0 + 30000],
    time: at,
    steps: [
      {
        at: 0,
        text: "BC02 主斜井机头 · 驱动部运行中，机头危险区设有 UWB 电子围栏",
        fly: { belt: B, chainage: L - 80, dist: 1100 },
        tab: "run",
        select: B
      },
      { at: 2.5, text: "一名巡检工抄近路，走向机头危险区" },
      { at: 5.5, text: "UWB 电子围栏 + AI 视频 2.4 秒内报警：人员越界" },
      {
        at: 6.5,
        text: "声光报警，BC02 软停；GM03 / GM04 给煤机闭锁，上游由井底煤仓缓冲"
      },
      { at: 13, text: "人员撤离危险区，现场确认安全" },
      { at: 17, text: "集控复位，逆煤流重新起车：起车预警 → 软启动 → 运行" },
      { at: 26, text: "恢复生产 · 主斜井停车约 20 秒，未发生人身伤害" }
    ],
    apply: (s, el) => {
      if (el < 5.5) return s
      const out = clone(s)
      if (el < 17)
        out.alarms.unshift({
          id: "SC-INT",
          kind: "intrude",
          dim: "person",
          level: 0,
          sense: "位置",
          title: "人员越界 · 机头危险区",
          belt: B,
          device: "BC02-CAM01",
          chainage: L - 40,
          at: at(5.5),
          status: el < 9 ? "未处理" : "处理中",
          source: "平台"
        })
      if (el >= 6.5 && el < 17)
        setBelt(out, B, ST.LOCK, clamp01(1 - (el - 6.5) / 4))
      else if (el >= 17 && el < 21) setBelt(out, B, ST.WARN, 0)
      else if (el >= 21 && el < 26)
        setBelt(out, B, ST.START, clamp01((el - 21) / 5))
      if (el >= 6.5 && el < 26)
        out.feeders = {
          ...out.feeders,
          GM03: { ...out.feeders.GM03, on: false, rate: 0 },
          GM04: { ...out.feeders.GM04, on: false, rate: 0 }
        }
      fixKpi(out)
      return out
    },
    cards: (el) =>
      el >= 5.5 && el < 26
        ? [
            {
              kind: "intrude",
              latency: 2.4,
              uwb: "UWB008",
              cam: "BC02-CAM01",
              at: at(5.5)
            }
          ]
        : [],
    // 巡检工：2.5–6 s 从人行道走进危险区，13–16 s 退出
    marker: (el) => {
      if (el < 2.5 || el > 16) return null
      const k = el < 6 ? (el - 2.5) / 3.5 : el < 13 ? 1 : 1 - (el - 13) / 3
      return { belt: B, chainage: L - 160 + 120 * k, side: 36 }
    }
  }
}

const SCRIPTS = { idler: idlerScript, tear: tearScript, intrude: intrudeScript }
export const SCRIPT_LIST = [
  { key: "idler", name: "托辊劣化预警" },
  { key: "tear", name: "纵撕急停" },
  { key: "intrude", name: "人员越界闭锁" }
]

/**
 * 剧本播放器
 * @param {object} o
 * @param {object} o.sim
 * @param {object} o.layout
 * @param {(t: number) => void} o.onTime 每次推进时把时钟钉到剧本时刻
 * @param {(step: object) => void} o.onStep 进入新一步（镜头、页签）
 * @param {() => void} o.onEnd 播完 / 退出
 */
export function createScenarios({ sim, layout, onTime, onStep, onEnd }) {
  const run = reactive({
    key: null,
    name: "",
    el: 0, // 每帧更新（进度条、字幕用）
    tick: 0, // 每 0.2 s 更新一次的 el（状态覆盖、说明卡用，避免每帧重算整屏）
    dur: 0,
    paused: false,
    loading: 0, // 预热进度 0…1（0 = 不在预热）
    step: -1
  })
  let def = null
  let t0 = 0 // 播放开始（扣除暂停）的 performance.now
  let pausedAt = 0
  let raf = 0
  let lastPush = 0

  function frame(ts) {
    raf = requestAnimationFrame(frame)
    if (!def || run.paused || run.loading) return
    const el = Math.min(def.dur, (ts - t0) / 1000)
    run.el = el
    // 字幕 / 镜头
    let k = -1
    def.steps.forEach((s, i) => {
      if (el >= s.at) k = i
    })
    if (k !== run.step) {
      run.step = k
      if (k >= 0) onStep(def.steps[k])
    }
    // 时钟和状态覆盖最多 5 次 / 秒
    if (ts - lastPush > 200 || el >= def.dur) {
      lastPush = ts
      run.tick = el
      onTime(def.time(el))
    }
    if (el >= def.dur) stop()
  }

  /** 预热：分批算好剧本会用到的仿真段（每批之间让出主线程） */
  function warm(ts, done) {
    let i = 0
    const next = () => {
      if (!def) return
      const t = performance.now()
      while (i < ts.length && performance.now() - t < 40) sim.at(ts[i++])
      run.loading = Math.max(0.01, i / ts.length)
      if (i < ts.length) setTimeout(next, 0)
      else done()
    }
    next()
  }

  function start(key, nowMs) {
    stop(true)
    def = SCRIPTS[key]?.(sim, layout, nowMs)
    if (!def) return false
    Object.assign(run, {
      key,
      name: def.name,
      el: 0,
      tick: 0,
      dur: def.dur,
      paused: false,
      loading: 0.01,
      step: -1
    })
    warm(def.warm(), () => {
      run.loading = 0
      t0 = performance.now()
      onTime(def.time(0))
      raf = requestAnimationFrame(frame)
    })
    return true
  }
  function stop(silent = false) {
    cancelAnimationFrame(raf)
    const was = !!def
    def = null
    Object.assign(run, {
      key: null,
      name: "",
      el: 0,
      tick: 0,
      dur: 0,
      paused: false,
      loading: 0,
      step: -1
    })
    if (was && !silent) onEnd()
  }
  function pause() {
    if (!def || run.paused) return
    run.paused = true
    pausedAt = performance.now()
  }
  function resume() {
    if (!def || !run.paused) return
    t0 += performance.now() - pausedAt
    run.paused = false
  }
  /** 拖动进度条 */
  function seek(el) {
    if (!def) return
    el = Math.max(0, Math.min(def.dur - 0.01, el))
    t0 = (run.paused ? pausedAt : performance.now()) - el * 1000
    run.el = el
    run.tick = el
    run.step = -2 // 下一帧重新触发当前步（镜头 / 页签）
    onTime(def.time(el))
  }

  return {
    run,
    start,
    stop,
    pause,
    resume,
    seek,
    /** 叠加剧本事件 */
    apply: (s) => (def && !run.loading ? def.apply(s, run.tick) : s),
    cards: () => (def && !run.loading ? def.cards(run.tick) : []),
    marker: () => (def && !run.loading ? def.marker(run.el) : null),
    steps: () => (def ? def.steps : []),
    def: () => def
  }
}

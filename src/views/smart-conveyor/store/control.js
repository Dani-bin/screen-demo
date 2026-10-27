/*
 * 集控本地操作层（不改仿真器）
 * ----------------------------------------------------------
 * 仿真器是"时刻 → 状态"的纯函数，集控操作只在页面上叠一层覆盖：apply(s) 把操作后的皮带状态、带速、运量、功率、
 * 告警套到仿真状态上，面板和三维都用覆盖后的状态。规则和真实集控一致：
 *   - 一键启动：逆煤流（地面栈桥 → 主斜井 → 大巷 → 上山 → 顺槽），每台"起车预警 → 软启动 → 运行"，上一台到速才起下一台
 *   - 一键停止：顺煤流（顺槽 → 上山 → 大巷 → 主斜井 → 栈桥），每台等上游拉空（演示里压缩成几秒）再停
 *   - 急停：这一台立即保护停机；直接往它上面卸煤的皮带闭锁（煤仓之间有缓冲，不往仓上游传）
 *   - 模式：集控 / 就地（可手动设带速）/ 检修（全线挂牌闭锁）
 *   - 料流均衡：关掉后运行中的皮带回到额定带速，节电率归零、功率上升
 * 操作后进入"人工干预中"，5 分钟没有操作或点"恢复自动"就回到仿真状态。
 * 时间用 performance.now()（操作动画按真实流逝的时间走，和仿真时刻无关）。
 */
import { ST, ST_NAME } from "../sim/simulator.js"

/** 演示里的节奏（秒）：预警、软启动、等上游拉空 */
const T_WARN = 5
const T_RAMP = 6
const T_DRAIN = 5
/** 人工干预无操作多久后自动恢复（毫秒） */
const IDLE_MS = 5 * 60 * 1000

export const MODES = [
  { key: "auto", name: "集控" },
  { key: "local", name: "就地" },
  { key: "maint", name: "检修" }
]

export function createControl(layout) {
  const belts = layout.belts
  const byId = Object.fromEntries(belts.map((b) => [b.id, b]))
  // 逆煤流起车顺序（layout.startOrder：BC01 → BC06），顺煤流停车反过来；BC05 / BC06 同时
  const startOrder = layout.startOrder
  const stopOrder = [...startOrder].reverse()
  /** 直接往 id 上卸煤的皮带（急停闭锁对象） */
  const feedersOf = (id) => belts.filter((b) => b.to === id).map((b) => b.id)

  const ctl = reactive({
    active: false, // 人工干预中
    mode: "auto",
    balance: true, // 料流均衡调速
    seq: null, // { kind: "start" | "stop", t0 }
    estop: {}, // 皮带 → 急停时刻
    manualV: {}, // 就地模式手动带速（m/s）
    lastOp: 0,
    log: [] // 操作记录 { at: 仿真时刻, text }
  })

  // 起停序列的快进倍数：页面上恒为 1；只有开发模式的录屏接口（index.vue 的 window.__conveyorPage）会改，
  // 让抖音视频几秒内演完逐台起车
  let tempo = 1
  function setTempo(k) {
    tempo = k > 0 ? k : 1
  }

  function touch(text, simMs) {
    ctl.active = true
    ctl.lastOp = performance.now()
    ctl.log.unshift({ at: simMs, text })
    ctl.log.splice(12)
  }

  /** 每台皮带在起停序列里的时间表：返回 { [id]: { from, to } }，from / to 是相对 t0 的秒 */
  function schedule(kind) {
    const out = {}
    let t = 0
    const order = kind === "start" ? startOrder : stopOrder
    // BC05、BC06 都卸到 BC04 上：起车时同一步、停车时同一步
    const groups = []
    for (const id of order) {
      const g = groups[groups.length - 1]
      if (
        g &&
        (id === "BC06" || id === "BC05") &&
        g.some((x) => x === "BC05" || x === "BC06")
      )
        g.push(id)
      else groups.push([id])
    }
    for (const g of groups) {
      const dur = kind === "start" ? T_WARN + T_RAMP : T_DRAIN
      for (const id of g) out[id] = { from: t, to: t + dur }
      t += dur
    }
    return out
  }

  /**
   * 把操作覆盖到仿真状态上
   * @param {object} s sim.at(t)
   * @returns {object} 覆盖后的状态（未干预时原样返回）
   */
  function apply(s) {
    if (!ctl.active) return s
    const now = performance.now()
    if (now - ctl.lastOp > IDLE_MS) {
      reset()
      return s
    }
    const out = { ...s, belts: { ...s.belts }, alarms: [...s.alarms] }
    const sched = ctl.seq ? schedule(ctl.seq.kind) : null
    const el = ctl.seq ? ((now - ctl.seq.t0) / 1000) * tempo : 0
    const locked = new Set()
    for (const id of Object.keys(ctl.estop)) {
      // 急停皮带的上游逐级闭锁（只沿皮带往上传，煤仓有缓冲）
      const stack = feedersOf(id)
      while (stack.length) {
        const f = stack.pop()
        locked.add(f)
        stack.push(...feedersOf(f))
      }
    }
    for (const b of belts) {
      const id = b.id
      const st0 = s.belts[id]
      let state = st0.state
      let v = st0.v
      // 运行中的目标带速：料流均衡开着就按仿真（料多快转、料少慢转），关掉回到额定；就地模式可手动设定
      const running = st0.v > 0.05
      let vRun = ctl.balance ? (running ? st0.v : b.v * 0.6) : b.v
      if (ctl.mode === "local" && ctl.manualV[id] != null)
        vRun = ctl.manualV[id]

      if (ctl.mode === "maint") {
        state = ST.MAINT
        v = 0
      } else if (ctl.estop[id] != null) {
        state = ST.FAULT
        v = 0
      } else if (locked.has(id)) {
        state = ST.LOCK
        v = 0
      } else if (sched) {
        const w = sched[id]
        if (ctl.seq.kind === "start") {
          if (el < w.from) [state, v] = [ST.STOP, 0]
          else if (el < w.from + T_WARN) [state, v] = [ST.WARN, 0]
          else if (el < w.to)
            [state, v] = [ST.START, (vRun * (el - w.from - T_WARN)) / T_RAMP]
          else [state, v] = [ST.RUN, vRun]
        } else {
          // 停车：到点后 2 s 减速到 0
          if (el < w.from) [state, v] = [ST.RUN, vRun]
          else if (el < w.from + 2)
            [state, v] = [ST.RUN, vRun * (1 - (el - w.from) / 2)]
          else [state, v] = [ST.STOP, 0]
        }
      } else if (running) {
        v = vRun
        state = ST.RUN
      }
      // 运量 / 功率 / 装载率按带速换算（同样的煤量，带速快装载率低、空载功率高）
      const k = st0.v > 0.05 ? v / st0.v : 0
      const flowOut = v > 0.05 ? (st0.v > 0.05 ? st0.flowOut : 0) : 0
      const power =
        v > 0.05
          ? st0.v > 0.05
            ? st0.power * (0.45 + 0.55 * k)
            : b.power * 0.18 * (v / b.v)
          : 0
      const fill =
        v > 0.05 && st0.v > 0.05 ? st0.fill / Math.max(0.2, k) : st0.fill
      out.belts[id] = {
        ...st0,
        state,
        stateName: ST_NAME[state],
        v,
        flowOut,
        power,
        fill,
        protection: ctl.estop[id] != null ? "ES" : st0.protection,
        manual: true
      }
      // 急停告警（一级 · 机），在告警列表和三维里出现
      if (ctl.estop[id] != null)
        out.alarms.unshift({
          id: `CTL-ES-${id}`,
          kind: "trip",
          dim: "machine",
          level: 0,
          sense: "速度",
          title: `${b.short} 集控急停`,
          belt: id,
          chainage: Math.round(b.L * 0.5),
          at: ctl.estop[id],
          status: "人工干预",
          source: "集控"
        })
    }
    // KPI 跟着变
    const bs = Object.values(out.belts)
    const powerTotal = bs.reduce((a, x) => a + x.power, 0)
    out.kpi = {
      ...s.kpi,
      powerTotal,
      flowNow: out.belts.BC02.flowOut,
      beltsRunning: bs.filter((x) => x.v > 0.05).length,
      savingRate: ctl.balance ? s.kpi.savingRate : 0
    }
    out.manual = true
    return out
  }

  /* ---------------- 操作（都由确认框调用） ---------------- */
  function startAll(simMs) {
    ctl.estop = {}
    if (ctl.mode === "maint") ctl.mode = "auto"
    ctl.seq = { kind: "start", t0: performance.now() }
    touch("一键启动（逆煤流）", simMs)
  }
  function stopAll(simMs) {
    ctl.seq = { kind: "stop", t0: performance.now() }
    touch("一键停止（顺煤流）", simMs)
  }
  function estop(id, simMs) {
    ctl.estop = { ...ctl.estop, [id]: simMs }
    touch(`${byId[id].short} 急停`, simMs)
  }
  function setMode(mode, simMs) {
    ctl.mode = mode
    if (mode !== "local") ctl.manualV = {}
    touch(`切换到${MODES.find((m) => m.key === mode).name}模式`, simMs)
  }
  function setBalance(on, simMs) {
    ctl.balance = on
    touch(`料流均衡调速${on ? "开" : "关"}`, simMs)
  }
  function setManualV(id, v, simMs) {
    ctl.manualV = { ...ctl.manualV, [id]: v }
    touch(`${byId[id].short} 手动带速 ${v.toFixed(1)} m/s`, simMs)
  }
  function reset() {
    Object.assign(ctl, {
      active: false,
      mode: "auto",
      balance: true,
      seq: null,
      estop: {},
      manualV: {}
    })
  }

  /** 操作会影响哪些皮带（确认框里写清楚） */
  function affects(op, id) {
    if (op === "start") return startOrder.map((x) => byId[x].short)
    if (op === "stop") return stopOrder.map((x) => byId[x].short)
    if (op === "estop") {
      const up = []
      const stack = feedersOf(id)
      while (stack.length) {
        const f = stack.pop()
        up.push(byId[f].short)
        stack.push(...feedersOf(f))
      }
      return [byId[id].short, ...up.map((x) => `${x}（闭锁）`)]
    }
    return belts.map((b) => b.short)
  }

  return {
    ctl,
    apply,
    startAll,
    stopAll,
    estop,
    setMode,
    setBalance,
    setManualV,
    reset,
    affects,
    setTempo,
    startOrder,
    stopOrder
  }
}

/*
 * 智能看板的面板数据：全部从仿真器派生（汇总值从明细算，屏上不写死数字）
 * ----------------------------------------------------------
 * 定稿 v1.js 的 prepare() 搬到这里，按刷新频率拆成两份：
 *   - fast(s)：每秒，只用当前状态 s = sim.at(t)
 *   - slow(t)：每 10 秒（或时钟跳变时），今日曲线、事件、沿线煤量、光纤测温 / 听诊、X 光、检修计划
 * 两份都是普通对象，页面放进 shallowRef，面板组件只读。
 */
import { ST, beijing, msForBeijing, shiftAt } from "../sim/simulator.js"

const MIN = 60000
const HOUR = 3600000
const DAY = 24 * HOUR

/** 煤流顺序上的光纤测温皮带（地面栈桥、掘进顺槽没有敷设） */
export const DTS_BELTS = ["BC02", "BC03", "BC04", "BC05"]

export function createBoard(sim, layout) {
  // 计划日产 = 设计年产 ÷ 工作日
  const planDay = (layout.mine.capacityMt * 1e6) / layout.mine.workDays
  const uwbDevices = layout.devices.filter((d) => d.kind === "uwb")
  const idlerSensors = layout.devices.filter((d) => d.kind === "idlerSensor")
  const envDevices = layout.devices.filter((d) => d.kind === "env")
  // 设备健康统计的对象：皮带 6 + 电机 + 减速机 + 传动滚筒
  const monitored = layout.devices.filter((d) =>
    ["belt", "motor", "reducer", "drivePulley"].includes(d.kind)
  )
  // 今日运量曲线按 15 分钟一点缓存（过去的点不会再变）
  const seriesCache = new Map()
  const flowAt = (t) => {
    if (!seriesCache.has(t)) seriesCache.set(t, sim.at(t).kpi.flowNow)
    return seriesCache.get(t)
  }

  /** 今夜（或正在进行的）零点班检修计划 */
  function tonight(ms) {
    const { date, h } = beijing(ms)
    const next = beijing(msForBeijing(date, 24 + 1)).date
    return h >= 8 ? sim.nightPlan(next) : sim.nightPlan(date)
  }

  function slow(ms) {
    const { date } = beijing(ms)
    const d0 = msForBeijing(date, 0)
    const series = []
    for (let t = d0; t <= ms; t += 15 * MIN) series.push({ t, v: flowAt(t) })
    series.push({ t: ms, v: sim.at(ms).kpi.flowNow })
    const today = sim.eventsBetween(d0, ms)
    const closed = today.filter((e) => e.end <= ms).sort((a, b) => b.at - a.at)
    const profile = Object.fromEntries(
      layout.belts.map((b) => [b.id, sim.profile(b.id, ms, 10)])
    )
    const dts = Object.fromEntries(DTS_BELTS.map((id) => [id, sim.dts(id, ms)]))
    // 今日各皮带的状态时段（1 分钟一采样，相邻同状态合并）：运行时序图用
    const bands = Object.fromEntries(
      layout.belts.map((b) => {
        const out = []
        for (let t = d0; t <= ms; t += MIN) {
          const st = sim.chAt(`st:${b.id}`, t, true)
          const last = out[out.length - 1]
          if (last && last.st === st) last.t1 = t + MIN
          else out.push({ st, t0: t, t1: t + MIN })
        }
        if (out.length) out[out.length - 1].t1 = ms
        return [b.id, out]
      })
    )
    const shift = shiftAt(ms)
    // 近 30 天事件（告警趋势）与各环境分站读数（环境类测点本来就 10 s 级刷新）
    const events30 = sim.eventsBetween(d0 - 29 * DAY, ms)
    const env = envDevices.map((d) => ({ ...d, r: sim.envReading(d.id, ms) }))
    return {
      ms,
      d0,
      series,
      today,
      closed,
      profile,
      dts,
      bands,
      events30,
      env,
      das: sim.das("BC03", ms),
      xr: sim.xray("BC02", ms),
      tonight: tonight(ms),
      shiftTons: sim.cumBetween("sc:BC02", msForBeijing(date, shift.start), ms)
    }
  }

  function fast(s) {
    const ms = s.t
    const people = {}
    for (const p of s.people) people[p.area] = (people[p.area] || 0) + 1
    // 设备健康：取该设备（皮带取其托辊）上最严重的劣化过程
    const health = { normal: 0, attention: 0, warning: 0, fault: 0 }
    for (const d of monitored) {
      let sev = 0
      for (const tr of s.tracks)
        if (
          tr.device === d.id ||
          (d.kind === "belt" && tr.belt === d.id && tr.kind === "idlerBearing")
        )
          sev = Math.max(sev, tr.s)
      health[
        d.kind === "belt" && s.belts[d.id].state === ST.FAULT
          ? "fault"
          : sev >= 0.7
            ? "warning"
            : sev >= 0.35
              ? "attention"
              : "normal"
      ]++
    }
    return {
      s,
      ms,
      planDay,
      people,
      health,
      monitored: monitored.length,
      idlerSensors,
      uwb: uwbDevices.map((d) => sim.uwbReading(d.id, ms, s.people)),
      shift: shiftAt(ms)
    }
  }

  return { fast, slow, planDay }
}

/** 10 秒一档：同一档内复用 slow()，时钟跳变（回放、剧本）立即重算 */
export const slowKey = (ms) => Math.floor(ms / 10000)
export { DAY, HOUR, MIN }

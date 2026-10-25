/*
 * 诊断中心的派生计算：劣化过程的读数趋势、剩余寿命
 * ----------------------------------------------------------
 * 仿真器里劣化严重度 s(t) = ((t − t0) / (tFix − t0))^1.8（tFix = 计划消缺时刻，s = 1）。
 * 读数和 s 的关系与仿真器的读数函数一致（motorReading / idlerReading / reducerReading / pulleyReading）：
 *   电机轴承：振动 ≈ 1.1 + 1.4·带速比 + 4.5·s（mm/s）
 *   托辊轴承：温度 ≈ 环境 + 2.5·带速比 + 30·s^1.3（°C）
 *   减速机齿面：振动 ≈ 1.8 + 1.6·带速比 + 5·s；滚筒包胶 / 润滑：温度 ≈ 基础 + 25·s
 * 趋势按这套关系逐小时生成（不去回算 7 天的整段仿真），三级 / 二级预警线就是 s = 0.35 / 0.7 处的读数。
 * 剩余寿命：放任不管时 s 继续按同一曲线增长，到 s = 1.3（卡死 / 抱死）视为失效。
 */
const HOUR = 3600000

/** 每类劣化看哪个读数 */
export const METRIC = {
  idlerBearing: { name: "托辊温度", u: "°C", base: 24, k: 30, pow: 1.3 },
  motorBearing: { name: "轴承振动", u: "mm/s", base: 2.1, k: 4.5, pow: 1 },
  reducerGear: { name: "减速机振动", u: "mm/s", base: 2.9, k: 5, pow: 1 },
  pulleyLagging: { name: "滚筒轴承温度", u: "°C", base: 31, k: 25, pow: 1 },
  reducerOil: { name: "减速机油温", u: "°C", base: 52, k: 25, pow: 1 }
}

/** 严重度 → 读数 */
export const valueAt = (kind, s) => {
  const m = METRIC[kind]
  return m.base + m.k * Math.pow(Math.max(0, s), m.pow)
}

/** 固定种子的小波动（同一设备同一小时总是同一个值） */
function wobble(key, t) {
  let h = 2166136261
  const str = key + Math.floor(t / HOUR)
  for (let i = 0; i < str.length; i++)
    h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return ((h >>> 0) / 4294967296 - 0.5) * 2
}

/**
 * 某劣化过程最近 days 天的逐小时读数
 * @returns {{ pts: {t:number,v:number}[], warn: number, alarm: number, metric: object }}
 */
export function trendOf(sim, tr, ms, days = 7) {
  const m = METRIC[tr.kind]
  const pts = []
  for (let t = ms - days * 24 * HOUR; t <= ms; t += HOUR) {
    const s = t < tr.t0 ? 0 : sim.severity(tr, t)
    // 夜班停车时读数回落（托辊温度、振动都和运行有关）
    const h = new Date(t + 8 * HOUR).getUTCHours()
    const run = h >= 8 ? 1 : 0.55
    const v =
      valueAt(tr.kind, s) * (0.86 + 0.14 * run) + wobble(tr.id, t) * m.k * 0.025
    pts.push({ t, v })
  }
  return {
    pts,
    warn: valueAt(tr.kind, 0.35),
    alarm: valueAt(tr.kind, 0.7),
    metric: m
  }
}

/**
 * 剩余寿命：放任不管时到 s = 1.3 的时刻；置信区间 ±18 %（劣化指数 1.6–2.0 的范围）
 */
export function rulOf(tr, ms) {
  const span = tr.tFix - tr.t0
  const at = (p) => tr.t0 + span * Math.pow(1.3, 1 / p)
  const tFail = at(1.8)
  const lo = at(1.6)
  const hi = at(2.0)
  const day = 24 * HOUR
  return {
    tFail,
    days: Math.max(0, (tFail - ms) / day),
    lo: Math.max(0, (Math.min(lo, hi) - ms) / day),
    hi: Math.max(0, (Math.max(lo, hi) - ms) / day),
    // 计划消缺比失效提前多少天
    margin: (tFail - tr.tFix) / day
  }
}

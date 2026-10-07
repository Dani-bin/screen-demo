/*
 * 智慧充电站 运行仿真
 * ----------------------------------------------------------
 * 纯 JS、无 Vue 依赖。按真实时刻生成：
 *   - 能源曲线：光伏出力、储能「谷充峰放」、充电负荷基线（24 小时曲线，用于趋势图与当日累计）
 *   - 每把枪的会话：车辆进站 → 充电（SOC 上升、功率随 SOC 回落）→ 充满 → 离站
 *   - 告警：开局一组固定告警 + 运行中偶发的枪温告警（随后恢复）
 *
 * 车辆会话是「演示加速」的：一次充电几分钟就走完，让大屏上始终有车进出；
 * 时钟、电价时段、能源曲线则按真实时刻走。
 *
 * 用法：
 *   const sim = new Simulator({ onGun, onEvent })
 *   sim.start()            // 每秒 tick 一次
 *   sim.snapshot()         // 面板取数（建议每 5 秒取一次）
 *   sim.dispose()
 */

import {
  CO2_FACTOR,
  PERIODS,
  PILES,
  PRICE,
  SERVICE_FEE,
  STATION
} from "../data/station"

// ---------------------------------------------------------------- 随机数（带种子，结果可复现）

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------- 24 小时曲线（单位 kW，t 为小时 0..24）

/** 关键点之间做平滑插值 */
function smoothInterp(keys, t) {
  for (let i = 0; i < keys.length - 1; i++) {
    const [a, va] = keys[i]
    const [b, vb] = keys[i + 1]
    if (t >= a && t <= b) {
      const k = (t - a) / (b - a)
      return va + (vb - va) * k * k * (3 - 2 * k)
    }
  }
  return keys[keys.length - 1][1]
}

/**
 * 充电负荷基线：夜间网约车谷时补能、早高峰、午间平稳、晚高峰。
 * 实际负荷 = 各枪功率之和，仿真会让在充车辆数向这条线靠拢
 */
const LOAD_KEYS = [
  [0, 2880],
  [2, 2410],
  [4, 1530],
  [6, 1350],
  [7, 2060],
  [8.5, 3170],
  [10, 3260],
  [11.5, 3490],
  [12.5, 3620],
  [14, 2970],
  [16, 3380],
  [17.5, 5060],
  [18.7, 5700],
  [19.5, 6060],
  [20.5, 5410],
  [22, 3820],
  [23, 3380],
  [24, 2940]
]
export const loadCurve = (t) => smoothInterp(LOAD_KEYS, t)

/** 光伏出力：日出 6:36、日落 18:36，正弦形，天气系数 0.88（多云间晴） */
export function pvCurve(t) {
  if (t < 6.6 || t > 18.6) return 0
  const k = Math.pow(Math.sin(((t - 6.6) / 12) * Math.PI), 1.5)
  return STATION.pvKwp * 0.88 * k * (1 - 0.06 * Math.sin(t * 5.3))
}

/** 当前电价时段 */
export function periodAt(t) {
  const p = PERIODS.find(([a, b]) => t >= a && t < b)
  return p ? p[2] : "valley"
}

/**
 * 储能计划功率（正为放电、负为充电）：谷时满功率充，峰 / 尖时放电，平时段午间吸收光伏。
 * 实际功率还要受 SOC 上下限约束，见 essStep
 */
function essPlan(t) {
  const p = periodAt(t)
  if (p === "valley") return -600
  if (p === "sharp") return 900
  if (p === "peak") return 800
  if (t >= 12 && t < 15) return -300
  return 0
}

/** 按 SOC 上下限修正储能功率，返回 [实际功率, 新 SOC]；dtH 为时长（小时） */
function essStep(t, soc, dtH) {
  let kw = essPlan(t)
  if (kw < 0 && soc >= 0.95) kw = 0
  if (kw > 0 && soc <= 0.12) kw = 0
  const next = Math.min(1, Math.max(0, soc - (kw * dtH) / STATION.essKwh))
  return [kw, next]
}

const hoursOf = (d) =>
  d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600

// ---------------------------------------------------------------- 仿真器

const PLATE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"
// 车型（与 cars.glb 的 car_<车型> 对应）及权重：特斯拉 Model 3、大众朗逸、日产轩逸、宝马 X6M
const CAR_KINDS = [
  ["sedan", 30],
  ["lavida", 25],
  ["sylphy", 20],
  ["suv", 25]
]
// 车漆分布：白、银、黑占多数
const PAINTS = [
  ["white", 26],
  ["silver", 20],
  ["black", 18],
  ["graphite", 16],
  ["blue", 12],
  ["red", 8]
]

/** 按权重抽取：list 为 [取值, 权重]，权重合计 100，u 为 [0, 1) 的随机数 */
function pickWeighted(list, u) {
  let x = u * 100
  for (const [v, w] of list) {
    x -= w
    if (x <= 0) return v
  }
  return list[0][0]
}

/** 一次 tick 的时长（秒）与 SOC 加速倍数：快充每秒约涨 0.5%，一次充电约 2~3 分钟 */
const TICK = 1
const SOC_RATE = { fast: 0.0045, super: 0.011 }

export class Simulator {
  /**
   * @param {object} opts
   * @param {(gun) => void} [opts.onGun]   某把枪状态变化（三维场景据此摆车、改颜色）
   * @param {(ev) => void} [opts.onEvent]  事件（进站、开始充电、充满、离站、告警），用于滚动条
   * @param {number} [opts.seed]
   */
  constructor({ onGun, onEvent, seed = 20261006 } = {}) {
    this.rand = mulberry32(seed)
    this.onGun = onGun || (() => {})
    this.onEvent = onEvent || (() => {})
    this.timer = null

    /** 所有枪：id、所属桩、类型、状态、车辆、SOC、功率 */
    this.guns = []
    for (const pile of PILES) {
      for (const id of pile.guns) {
        this.guns.push({
          id,
          pile: pile.id,
          type: pile.type,
          status: "idle",
          car: null,
          soc: 0,
          target: 0,
          power: 0,
          energy: 0,
          startedAt: null
        })
      }
    }
    this.gunMap = new Map(this.guns.map((g) => [g.id, g]))

    // 开局固定的异常：B17 南枪故障（绝缘检测异常）、B26 离线（通讯中断）
    this.setStatus("B17_S", "fault")
    this.setStatus("B26_N", "offline")
    this.setStatus("B26_S", "offline")
    this.gunMap.get("B17_S").car = this.newCar()
    this.gunMap.get("B26_N").car = this.newCar()

    this.alarms = this.initialAlarms()
    this.orders = []
    this.events = []
    this.live = { energy: 0, revenue: 0, orders: 0 } // 开页以后实时累加的部分

    // 按今天 0 点起的曲线积分出当日累计与储能 SOC
    this.integrateToday()

    // 让在充车辆数接近此刻的负荷基线
    this.fillToTarget(true)
  }

  // ---------------- 公共接口

  start() {
    this.timer = setInterval(() => this.tick(), TICK * 1000)
  }

  dispose() {
    clearInterval(this.timer)
    this.timer = null
  }

  /** 面板所需的全部数据（纯对象，可直接交给 Vue） */
  snapshot() {
    const now = new Date()
    const t = hoursOf(now)
    const period = periodAt(t)
    const pv = Math.round(pvCurve(t))
    const charging = this.guns.filter((g) => g.status === "charging")
    const load = Math.round(charging.reduce((s, g) => s + g.power, 0))
    const ess = Math.round(this.essKw)
    const station = STATION.stationLoadKw
    const grid = Math.max(0, load + station - pv - ess)
    const supply = pv + Math.max(0, ess) + grid

    // 桩级状态：故障 / 离线优先，其次任一枪在充即「在用」
    const pileStatus = (pile) => {
      const gs = pile.guns.map((id) => this.gunMap.get(id))
      if (gs.some((g) => g.status === "offline")) return "offline"
      if (gs.some((g) => g.status === "fault")) return "fault"
      if (gs.some((g) => g.status === "charging" || g.status === "full"))
        return "charging"
      return "idle"
    }
    const piles = PILES.map((p) => ({ ...p, status: pileStatus(p) }))
    const inUse = (type) =>
      piles.filter((p) => p.type === type && p.status === "charging").length
    const abnormal = piles.filter(
      (p) => p.status === "fault" || p.status === "offline"
    ).length
    const idle = piles.filter((p) => p.status === "idle").length

    const energyToday = this.base.energy + this.live.energy
    const pvToday = this.base.pv
    return {
      time: now,
      period,
      price: PRICE[period].fee,
      serviceFee: SERVICE_FEE,
      power: { pv, ess, grid, load, station, total: load + station },
      mix:
        supply > 0
          ? {
              pv: pv / supply,
              ess: Math.max(0, ess) / supply,
              grid: grid / supply
            }
          : { pv: 0, ess: 0, grid: 0 },
      today: {
        energy: Math.round(energyToday),
        revenue: Math.round(this.base.revenue + this.live.revenue),
        serviceFee: Math.round(energyToday * SERVICE_FEE),
        orders: Math.round(this.base.orders + this.live.orders),
        carbon: (pvToday * CO2_FACTOR) / 1000
      },
      pv: {
        power: pv,
        kwp: STATION.pvKwp,
        ratio: pv / STATION.pvKwp,
        today: Math.round(pvToday),
        peak: Math.round(this.base.pvPeak),
        peakAt: this.base.pvPeakAt
      },
      ess: {
        power: ess,
        soc: this.essSoc,
        capacity: STATION.essKwh / 1000,
        available: (STATION.essKwh * this.essSoc) / 1000,
        mode: ess > 0 ? "放电" : ess < 0 ? "充电" : "待机",
        strategy: "谷充峰放",
        cycles: 412,
        soh: 0.978,
        temp: 26.4 + Math.sin(t) * 0.6
      },
      piles: {
        total: PILES.length,
        online:
          PILES.length - piles.filter((p) => p.status === "offline").length,
        superInUse: inUse("super"),
        superTotal: PILES.filter((p) => p.type === "super").length,
        fastInUse: inUse("fast"),
        fastTotal: PILES.filter((p) => p.type === "fast").length,
        idle,
        abnormal,
        list: piles
      },
      alarms: this.alarms.slice(0, 6),
      alarmCount: ["紧急", "重要", "一般", "提示"].map(
        (lv) =>
          this.alarms.filter((a) => a.level === lv && a.state !== "已处理")
            .length
      ),
      orders: this.orders.slice(0, 6),
      events: this.events.slice(0, 1)
    }
  }

  /** 24 小时趋势（15 分钟一个点）：已过去部分为模型值，之后为预测 */
  trend() {
    const out = { t: [], pv: [], ess: [], grid: [], load: [] }
    let soc = 0.22
    for (let i = 0; i <= 96; i++) {
      const t = i / 4
      const [kw, next] = essStep(t, soc, 0.25)
      soc = next
      const pv = pvCurve(t)
      const load = loadCurve(t)
      out.t.push(t)
      out.pv.push(Math.round(pv))
      out.ess.push(Math.round(kw))
      out.load.push(Math.round(load))
      out.grid.push(
        Math.round(Math.max(0, load + STATION.stationLoadKw - pv - kw))
      )
    }
    return out
  }

  /** 光伏今日 / 昨日曲线（昨日按天气系数略低生成） */
  pvTrend() {
    const today = []
    const yesterday = []
    for (let i = 0; i <= 96; i++) {
      const t = i / 4
      today.push(Math.round(pvCurve(t)))
      yesterday.push(Math.round(pvCurve(t) * (0.86 + 0.08 * Math.sin(t * 2.1))))
    }
    return { today, yesterday }
  }

  gun(id) {
    return this.gunMap.get(id)
  }

  // ---------------- 内部

  setStatus(id, status) {
    const g = this.gunMap.get(id)
    g.status = status
    if (status !== "charging") g.power = 0
  }

  newCar() {
    const r = this.rand
    const kind = pickWeighted(CAR_KINDS, r())
    const paint = pickWeighted(PAINTS, r())
    const L = () => PLATE_LETTERS[Math.floor(r() * PLATE_LETTERS.length)]
    const plate = `川${r() < 0.85 ? "A" : L()}·${r() < 0.6 ? "D" : "F"}${L()}***${Math.floor(r() * 10)}`
    return { kind, paint, plate }
  }

  initialAlarms() {
    const d = new Date()
    const at = (minAgo) => {
      const x = new Date(d.getTime() - minAgo * 60000)
      return x.toTimeString().slice(0, 8)
    }
    return [
      {
        time: at(4),
        level: "紧急",
        content: "B17 绝缘检测异常，已停用",
        state: "未处理"
      },
      {
        time: at(11),
        level: "重要",
        content: "B07 枪头温度 62℃，已降功率",
        state: "处理中"
      },
      { time: at(25), level: "重要", content: "B26 通讯中断", state: "未处理" },
      {
        time: at(42),
        level: "一般",
        content: "光伏逆变器 3 效率偏低",
        state: "已处理"
      },
      {
        time: at(58),
        level: "一般",
        content: "储能柜 4 电芯温差偏大",
        state: "已处理"
      },
      {
        time: at(76),
        level: "提示",
        content: "A03 例行巡检完成",
        state: "已处理"
      }
    ]
  }

  /** 从今天 0 点积分到此刻：当日充电量、营收、订单、光伏发电、储能 SOC、光伏峰值 */
  integrateToday() {
    const t1 = hoursOf(new Date())
    const step = 1 / 60
    let energy = 0
    let revenue = 0
    let pv = 0
    let soc = 0.22
    let pvPeak = 0
    let pvPeakAt = "--:--"
    for (let t = 0; t < t1; t += step) {
      const load = loadCurve(t)
      const p = pvCurve(t)
      energy += load * step
      revenue += load * step * (PRICE[periodAt(t)].fee + SERVICE_FEE)
      pv += p * step
      if (p > pvPeak) {
        pvPeak = p
        const h = Math.floor(t)
        pvPeakAt = `${String(h).padStart(2, "0")}:${String(Math.floor((t - h) * 60)).padStart(2, "0")}`
      }
      soc = essStep(t, soc, step)[1]
    }
    this.base = { energy, revenue, orders: energy / 31.2, pv, pvPeak, pvPeakAt }
    this.essSoc = soc
    this.essKw = essStep(t1, soc, 0)[0]
  }

  /** 此刻目标在充枪数：超充按 380 kW、快充按 95 kW 的平均功率折算负荷基线 */
  targetActive() {
    const t = hoursOf(new Date())
    const load = loadCurve(t)
    const superActive = Math.min(4, Math.round(load / 1400))
    return {
      super: superActive,
      fast: Math.max(0, Math.round((load - superActive * 380) / 95))
    }
  }

  /** 补足到目标在充数；init=true 时直接以随机进度开始充电（开页时站里已有车） */
  fillToTarget(init = false) {
    const target = this.targetActive()
    for (const type of ["super", "fast"]) {
      const busy = this.guns.filter(
        (g) =>
          g.type === type &&
          g.status !== "idle" &&
          g.status !== "fault" &&
          g.status !== "offline"
      ).length
      let need = target[type] - busy
      const free = this.guns.filter(
        (g) => g.type === type && g.status === "idle" && !g.car
      )
      while (need > 0 && free.length) {
        const g = free.splice(Math.floor(this.rand() * free.length), 1)[0]
        if (init) {
          g.car = this.newCar()
          g.status = "charging"
          g.soc = 0.25 + this.rand() * 0.55
          g.target = 0.9 + this.rand() * 0.1
          g.startedAt = Date.now() - this.rand() * 20 * 60000
          g.energy = 10 + this.rand() * 40
          g.power = this.powerOf(g)
        } else {
          this.arrive(g)
          return // 运行中每次只进一辆，节奏更自然
        }
        need--
      }
    }
  }

  /** 功率随 SOC 回落：80% 以下接近满功率，之后线性降到 30% */
  powerOf(g) {
    const max = g.type === "super" ? 480 : 118
    const k = g.soc < 0.8 ? 1 : 1 - ((g.soc - 0.8) / 0.2) * 0.7
    return max * k * (0.85 + this.rand() * 0.15)
  }

  arrive(g) {
    g.car = this.newCar()
    g.status = "arriving"
    g.soc = 0.12 + this.rand() * 0.3
    g.target = 0.85 + this.rand() * 0.15
    this.onGun(g)
    this.emit("arrive", g)
    // 进站动画约 3 秒后插枪开始充电
    setTimeout(() => {
      if (g.status !== "arriving") return
      g.status = "charging"
      g.startedAt = Date.now()
      g.energy = 0
      g.power = this.powerOf(g)
      this.onGun(g)
      this.emit("start", g)
    }, 3200)
  }

  finish(g) {
    g.status = "full"
    g.power = 0
    this.onGun(g)
    this.emit("finish", g)
    const minutes = Math.max(
      8,
      Math.round((Date.now() - g.startedAt) / 60000 + 18 + this.rand() * 20)
    )
    const kwh = g.energy + 20 + this.rand() * 25
    const fee = kwh * (PRICE[periodAt(hoursOf(new Date()))].fee + SERVICE_FEE)
    this.orders.unshift({
      time: new Date().toTimeString().slice(0, 5),
      gun: g.id,
      plate: g.car.plate,
      kwh: kwh.toFixed(1),
      minutes,
      state: "已完成"
    })
    this.orders.length = Math.min(this.orders.length, 20)
    this.live.orders += 1
    this.live.revenue += fee
    // 充满后停留几秒再驶离
    setTimeout(
      () => {
        g.status = "leaving"
        this.onGun(g)
        this.emit("leave", g)
        setTimeout(() => {
          g.status = "idle"
          g.car = null
          g.soc = 0
          this.onGun(g)
        }, 3000)
      },
      2500 + this.rand() * 2500
    )
  }

  emit(type, g) {
    const ev = {
      type,
      gun: g.id,
      pile: g.pile,
      plate: g.car?.plate || "",
      time: new Date().toTimeString().slice(0, 8)
    }
    this.events.unshift(ev)
    this.events.length = Math.min(this.events.length, 20)
    if (type === "start") {
      this.orders.unshift({
        time: ev.time.slice(0, 5),
        gun: g.id,
        plate: ev.plate,
        kwh: "—",
        minutes: 0,
        state: "充电中"
      })
      this.orders.length = Math.min(this.orders.length, 20)
    }
    this.onEvent(ev)
  }

  tick() {
    const t = hoursOf(new Date())
    // 储能：按真实时间推进（每秒）
    const [kw, soc] = essStep(t, this.essSoc, TICK / 3600)
    this.essKw = kw
    this.essSoc = soc

    for (const g of this.guns) {
      if (g.status !== "charging") continue
      g.soc = Math.min(1, g.soc + SOC_RATE[g.type] * (0.7 + this.rand() * 0.6))
      g.power = this.powerOf(g)
      // 能量按演示加速折算：SOC 每涨 1% 约等于 0.75 kWh
      g.energy += SOC_RATE[g.type] * 75
      this.live.energy += (g.power * TICK) / 3600
      if (g.soc >= g.target) this.finish(g)
    }

    // 进站节奏：每秒有一定概率补一辆车
    if (this.rand() < 0.35) this.fillToTarget(false)

    // 偶发：随机一把在充的快充枪枪温偏高告警，20 秒后恢复
    if (this.rand() < 0.004) {
      const cands = this.guns.filter(
        (g) => g.status === "charging" && g.type === "fast"
      )
      const g = cands[Math.floor(this.rand() * cands.length)]
      if (g) {
        const temp = 60 + Math.floor(this.rand() * 6)
        const alarm = {
          time: new Date().toTimeString().slice(0, 8),
          level: "重要",
          content: `${g.pile} 枪头温度 ${temp}℃，已降功率`,
          state: "处理中"
        }
        this.alarms.unshift(alarm)
        this.alarms.length = Math.min(this.alarms.length, 12)
        setTimeout(() => {
          alarm.state = "已处理"
        }, 20000)
      }
    }
  }
}

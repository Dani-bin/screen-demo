/*
 * 综合能源补给站 运行仿真
 * ----------------------------------------------------------
 * 纯 JS、无 Vue 依赖。按真实时刻生成：
 *   - 各类补给的小时车流（加油小车、CNG 小车、LNG 重卡、重卡充电、换电），用于趋势图与今日累计；
 *   - 补给车次：按当前小时的车流率随机发车（泊松过程），交给三维场景演示车辆进出；
 *     场景接住了才计数，保证面板数字和画面上的车对得上；
 *   - 10 个重卡超充位的会话：进站 → 充电（SOC 上升、功率随 SOC 回落）→ 离站，偶发枪温过高降功率；
 *   - 油气库存（加油扣减油罐、LNG 低于 35% 时槽车补液）、换电站电池仓、光伏、安全监测、告警。
 *
 * 充电会话是「演示加速」的：一次充电几分钟就走完，让画面上始终有重卡进出；其余车流按真实车流率。
 *
 * 用法：
 *   const sim = new Simulator({ onBay, onTrip })
 *   sim.start()        // 每秒 tick 一次
 *   sim.snapshot()     // 面板取数
 *   sim.trend()        // 24 小时补给车次
 *   sim.dispose()
 * 回调：
 *   onBay(bay)               某个超充位状态变化（三维里换描边颜色、重卡进出）
 *   onTrip({ kind, ... }) → boolean   发起一次补给车次；返回 false 表示场景没接住（车道占满），不计数
 */

import { PILE_IDS, STATION } from "../data/station"

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

// ---------------------------------------------------------------- 小时车流率（辆 / 小时，t 为小时 0..24）

/**
 * 各类补给的车流曲线（示范设定）：
 *   fuel 加油小车：早晚高峰明显；cng CNG 小车（出租车）：全天较平、凌晨交班有小峰；
 *   lng LNG 重卡、charge 重卡充电：国道货运，夜间也不少，午后最高；swap 乘用车换电：跟随通勤
 */
const RATE_KEYS = {
  fuel: [
    [0, 14],
    [3, 8],
    [6, 22],
    [8, 78],
    [9.5, 66],
    [12, 62],
    [14, 58],
    [17, 82],
    [18.5, 96],
    [20, 64],
    [22, 34],
    [24, 16]
  ],
  cng: [
    [0, 12],
    [3, 18],
    [5, 10],
    [8, 20],
    [12, 16],
    [16, 22],
    [19, 18],
    [24, 12]
  ],
  lng: [
    [0, 22],
    [4, 16],
    [7, 24],
    [10, 30],
    [14, 34],
    [17, 30],
    [20, 26],
    [24, 22]
  ],
  charge: [
    [0, 7],
    [4, 5],
    [7, 6],
    [10, 8],
    [14, 9],
    [17, 8],
    [20, 8],
    [24, 7]
  ],
  swap: [
    [0, 2],
    [5, 1],
    [7.5, 8],
    [9, 6],
    [12, 5],
    [17.5, 9],
    [19, 7],
    [22, 4],
    [24, 2]
  ]
}
export const rateAt = (kind, t) => smoothInterp(RATE_KEYS[kind], t)

/** 光伏出力（kW）：日出 6:36、日落 18:36，正弦形，天气系数 0.85 */
export function pvCurve(t) {
  if (t < 6.6 || t > 18.6) return 0
  const k = Math.pow(Math.sin(((t - 6.6) / 12) * Math.PI), 1.5)
  return STATION.pvKwp * 0.85 * k * (1 - 0.05 * Math.sin(t * 5.3))
}

/** 每车次的补给量与单价（示范设定） */
const PER = {
  fuel: 42, // L / 车
  cng: 12, // m³ / 车
  lng: 180, // kg / 车
  swapKwh: 45 // kWh / 次
}
const PRICE = { fuel: 7.86, cng: 3.95, lng: 5.2, charge: 1.35, swap: 1.6 }

const hoursOf = (d) =>
  d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
const hhmm = (d) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`

/** 车牌：省份简称 + 字母 + 5 位（新能源重卡 6 位，末位 D / F） */
const PROVINCES = "川渝陕黔云甘鄂湘"
const PLATE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"

// ---------------------------------------------------------------- 仿真器

export class Simulator {
  constructor({ onBay, onTrip } = {}) {
    this.onBay = onBay || (() => {})
    this.onTrip = onTrip || (() => true)
    const now = new Date()
    // 种子按日期取：同一天刷新页面，开局数据一致
    const daySeed =
      now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate()
    this.rand = mulberry32(daySeed)
    this.dayRand = mulberry32(daySeed + 7)

    // ---------- 今日累计：页面打开前的部分按车流曲线积分（带日内随机波动）
    const t = hoursOf(now)
    this.hourly = {}
    for (const k of Object.keys(RATE_KEYS)) {
      this.hourly[k] = Array.from({ length: 24 }, (_, h) => {
        const base = (rateAt(k, h) + rateAt(k, h + 1)) / 2
        return base * (0.85 + this.dayRand() * 0.3)
      })
    }
    const sofar = (k) => {
      let s = 0
      for (let h = 0; h < Math.floor(t); h++) s += this.hourly[k][h]
      return Math.round(s + this.hourly[k][Math.floor(t)] * (t % 1))
    }
    this.count = {
      fuel: sofar("fuel"),
      cng: sofar("cng"),
      lng: sofar("lng"),
      charge: sofar("charge"),
      swap: sofar("swap")
    }
    // 充电电量：已完成会话按每次 260 kWh 估算，之后按各位实时功率积分
    this.chargeKwh = this.count.charge * 260
    // 光伏今日发电：按出力曲线积分（6 分钟步长）
    let pv = 0
    for (let x = 0; x < t; x += 0.1) pv += pvCurve(x) * 0.1
    this.pvKwh = pv

    // ---------- 库存
    const r = this.rand
    this.tanks = {
      g92: 0.6 + r() * 0.15,
      g95: 0.5 + r() * 0.12,
      d0a: 0.65 + r() * 0.12,
      d0b: 0.28 + r() * 0.05
    }
    this.lng = 0.58 + r() * 0.08 // LNG 储罐液位
    this.lngFilling = false
    this.cngMpa = 21 + r() * 2
    this.lel = 1.5
    this.lngMpa = 0.42
    this.lngTemp = -152

    // ---------- 换电站电池仓
    this.swapFull = 8
    this.swapCharging = 4
    this.swapAvgMin = 3.3 + r() * 0.3

    // ---------- 告警（最近 6 条）
    this.alarms = []
    this._seedAlarms(now)

    // ---------- 重卡超充位：开局 6~7 个在充，C07 枪温高降功率
    this.bays = PILE_IDS.map((id, i) => ({
      id,
      status: "idle",
      soc: 0,
      target: 0,
      kw: 0,
      plate: "",
      start: null,
      wait: 10 + i * 9 + r() * 30, // 空闲倒计时（秒）
      timer: 0,
      derate: 0 // 降功率剩余秒数（> 0 时状态为 fault）
    }))
    const busy = [0, 1, 3, 4, 6, 7, 8]
    for (const i of busy) {
      const b = this.bays[i]
      this._beginSession(b, now, true)
      b.soc = 0.3 + r() * 0.55
    }
    this.bays[6].derate = 90
    this.bays[6].status = "fault"
    this.trips = 0
  }

  // ================================================================ 生命周期

  start() {
    this.timer = setInterval(() => this.tick(1), 1000)
    for (const b of this.bays) this.onBay(b)
  }

  dispose() {
    clearInterval(this.timer)
  }

  // ================================================================ 推进

  tick(dt) {
    const now = new Date()
    const t = hoursOf(now)
    const r = this.rand

    // 补给车次：按当前车流率的泊松过程发车
    for (const kind of ["fuel", "cng", "lng", "swap"]) {
      const p = (rateAt(kind, t) / 3600) * dt
      if (r() < p) this._trip(kind, now)
    }

    // 重卡超充位
    for (const b of this.bays) this._bayStep(b, dt, now, t)

    // 换电站：充电中的电池约 40 秒充满一块（演示加速）
    if (this.swapCharging > 0 && r() < dt / 40) {
      this.swapCharging--
      this.swapFull++
    }

    // LNG：低于 35% 呼叫槽车补液，补到 88% 停止
    if (!this.lngFilling && this.lng < 0.35) {
      if (this.onTrip({ kind: "tanker" }) !== false) {
        this.lngFilling = true
        this._alarm(now, "作业", "LNG 槽车卸车作业中，罐区限行")
      }
    }
    if (this.lngFilling) {
      this.lng += dt * 0.0016
      if (this.lng >= 0.88) {
        this.lngFilling = false
        this.onTrip({ kind: "tankerDone" })
        this._alarm(now, "提示", "LNG 卸车完成，储罐液位 88%")
      }
    }
    // CNG 储气压力：售气缓慢下降，压缩机启动后回升
    this.cngMpa += this.cngMpa < 19 ? 0.08 * dt : -0.004 * dt
    // 安全监测：小幅随机游走
    this.lel = Math.min(4, Math.max(0, this.lel + (r() - 0.5) * 0.3))
    this.lngMpa = Math.min(
      0.48,
      Math.max(0.38, this.lngMpa + (r() - 0.5) * 0.004)
    )
    this.lngTemp = Math.min(
      -150,
      Math.max(-154, this.lngTemp + (r() - 0.5) * 0.08)
    )
    this.pvKwh += (pvCurve(t) * dt) / 3600
  }

  /** 发起一次补给车次（场景接住才计数并扣库存） */
  _trip(kind, now) {
    const plate = this._plate(kind === "lng")
    const ok = this.onTrip({ kind, plate })
    if (ok === false) return
    this.trips++
    this.count[kind]++
    const r = this.rand
    if (kind === "fuel") {
      const u = r()
      const key = u < 0.55 ? "g92" : u < 0.75 ? "g95" : u < 0.88 ? "d0a" : "d0b"
      this.tanks[key] = Math.max(0.08, this.tanks[key] - PER.fuel / 30000)
      // 柴油 2 号罐低液位：记一条补货提示（只记一次）
      if (key === "d0b" && this.tanks.d0b < 0.25 && !this._d0bWarned) {
        this._d0bWarned = true
        this._alarm(now, "一般", "0# 柴油 2 号罐液位低于 25%，已下单补货")
      }
    } else if (kind === "lng") {
      this.lng = Math.max(0.05, this.lng - PER.lng / 25500)
    } else if (kind === "cng") {
      this.cngMpa -= 0.15
    } else if (kind === "swap") {
      if (this.swapFull > 0) {
        this.swapFull--
        this.swapCharging++
      }
    }
  }

  _plate(truck) {
    const r = this.rand
    const p = PROVINCES[Math.floor(r() * PROVINCES.length)]
    const l = PLATE_LETTERS[Math.floor(r() * PLATE_LETTERS.length)]
    let n = ""
    for (let i = 0; i < 5; i++) n += Math.floor(r() * 10)
    return truck ? `${p}${l}·${n}` : `${p}${l}·${n}`
  }

  // ---------------------------------------------------------------- 超充会话

  _beginSession(b, now, instant = false) {
    const r = this.rand
    b.status = instant ? "charging" : "arriving"
    b.soc = 0.12 + r() * 0.3
    b.target = 0.86 + r() * 0.1
    b.plate = `${PROVINCES[Math.floor(r() * 4)]}${PLATE_LETTERS[Math.floor(r() * PLATE_LETTERS.length)]}·${Math.floor(r() * 9e4 + 1e4)}D`
    b.start = now
    b.timer = instant ? 0 : 45 // 进站行驶 + 倒车入位的时长（与场景的车辆动画大致一致）
    // 充满所需的演示时长：150~300 秒
    b.rate = (b.target - b.soc) / (150 + r() * 150)
  }

  _bayStep(b, dt, now, t) {
    const r = this.rand
    if (b.derate > 0) {
      b.derate -= dt
      if (b.derate <= 0 && b.status === "fault") {
        b.status = "charging"
        this.onBay(b)
      }
    }
    switch (b.status) {
      case "idle": {
        b.kw = 0
        b.wait -= dt * (rateAt("charge", t) / 7)
        if (b.wait <= 0) {
          this._beginSession(b, now)
          this.onBay(b)
        }
        break
      }
      case "arriving": {
        b.timer -= dt
        if (b.timer <= 0) {
          b.status = "charging"
          this.onBay(b)
        }
        break
      }
      case "charging":
      case "fault": {
        // 功率：SOC 70% 前满功率，之后线性回落到 30%；降功率时减半
        const k = b.soc < 0.7 ? 1 : 1 - ((b.soc - 0.7) / 0.3) * 0.7
        b.kw =
          STATION.chargerKw * k * (0.94 + r() * 0.06) * (b.derate > 0 ? 0.5 : 1)
        b.soc = Math.min(1, b.soc + b.rate * dt * (b.derate > 0 ? 0.5 : 1))
        this.chargeKwh += ((b.kw * dt) / 3600) * 6 // 演示加速：电量按加速后的时长折算
        // 偶发：枪温过高，降功率 60~90 秒
        if (b.status === "charging" && r() < dt / 1500) {
          b.derate = 60 + r() * 30
          b.status = "fault"
          this._alarm(
            now,
            "重要",
            `${b.id} 枪头温度 ${Math.round(66 + r() * 6)}°C，已自动降功率`
          )
          this.onBay(b)
        }
        if (b.soc >= b.target) {
          b.status = "leaving"
          b.timer = 10
          b.kw = 0
          this.count.charge++
          this.onBay(b)
        }
        break
      }
      case "leaving": {
        b.timer -= dt
        if (b.timer <= 0) {
          b.status = "idle"
          b.plate = ""
          b.wait = 25 + r() * 70
          this.onBay(b)
        }
        break
      }
    }
  }

  // ---------------------------------------------------------------- 告警

  _alarm(now, level, text) {
    this.alarms.unshift({ time: hhmm(now), level, text })
    this.alarms.length = Math.min(this.alarms.length, 6)
  }

  _seedAlarms(now) {
    const ago = (min) => new Date(now.getTime() - min * 60000)
    const seed = [
      [74, "提示", "换电站 7 号仓电池温度偏高，已处理"],
      [51, "一般", "0# 柴油 2 号罐液位低于 30%，已下单补货"],
      [23, "作业", "CNG 压缩机例行巡检完成"],
      [6, "重要", "C07 枪头温度 68°C，已自动降功率"]
    ]
    for (const [m, level, text] of seed) this._alarm(ago(m), level, text)
  }

  // ================================================================ 面板取数

  snapshot() {
    const now = new Date()
    const t = hoursOf(now)
    const c = this.count
    const fuelL = c.fuel * PER.fuel
    const lngKg = c.lng * PER.lng
    const cngM3 = c.cng * PER.cng
    const swapKwh = c.swap * PER.swapKwh
    const revenue =
      fuelL * PRICE.fuel +
      cngM3 * PRICE.cng +
      lngKg * PRICE.lng +
      this.chargeKwh * PRICE.charge +
      swapKwh * PRICE.swap
    const chargeKw = this.bays.reduce((s, b) => s + b.kw, 0)
    const pvKw = pvCurve(t)
    const load =
      (chargeKw + this.swapCharging * 60 + 110 - pvKw) /
      (2 * STATION.transformerKva * 0.9)
    const charging = this.bays.filter((b) =>
      ["charging", "fault"].includes(b.status)
    ).length
    const faults = this.bays.filter((b) => b.status === "fault").length
    const safeDays = Math.floor(
      (now - new Date(STATION.safeDaysFrom)) / 86400000
    )
    return {
      time: now,
      today: {
        vehicles: c.fuel + c.cng + c.lng + c.charge + c.swap,
        trucks: c.lng + c.charge,
        revenue,
        fuelL,
        gasT: (lngKg + cngM3 * 0.72) / 1000,
        lngKg,
        cngM3,
        chargeKwh: this.chargeKwh,
        swapKwh,
        count: { ...c }
      },
      inventory: {
        tanks: STATION.oilTanks.map((tk) => ({
          ...tk,
          level: this.tanks[tk.key]
        })),
        lng: this.lng,
        lngFilling: this.lngFilling,
        cngMpa: this.cngMpa
      },
      safety: {
        lel: this.lel,
        lngMpa: this.lngMpa,
        lngTemp: this.lngTemp,
        grounding: true,
        video: [32, 32],
        safeDays
      },
      bays: this.bays.map((b) => ({ ...b })),
      charge: {
        kw: chargeKw,
        charging,
        faults,
        util: charging / this.bays.length
      },
      swap: {
        today: c.swap,
        full: this.swapFull,
        charging: this.swapCharging,
        slots: STATION.swapSlots,
        avgMin: this.swapAvgMin
      },
      pv: { kw: pvKw, kwh: this.pvKwh, kwp: STATION.pvKwp },
      transformerLoad: Math.min(0.98, Math.max(0.05, load)),
      alarms: this.alarms.slice(),
      alarmCount: this.alarms.filter((a) => a.level === "重要").length
    }
  }

  /**
   * 24 小时补给车次：过去的整点用当日曲线，当前小时按已过比例，之后为预测值。
   * 返回 { hours: 24, series: { fuel, gas, charge, swap }, now }
   */
  trend() {
    const t = hoursOf(new Date())
    const h = this.hourly
    const series = {
      fuel: h.fuel.map((v) => Math.round(v)),
      gas: h.fuel.map((_, i) => Math.round(h.cng[i] + h.lng[i])),
      charge: h.charge.map((v) => Math.round(v)),
      swap: h.swap.map((v) => Math.round(v))
    }
    return { series, now: t }
  }
}

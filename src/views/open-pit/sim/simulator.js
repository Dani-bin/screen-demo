/**
 * 青原露天矿：运输与调度仿真器（页面、模拟数据、设计稿共用的唯一数据源）
 * ----------------------------------------------------------
 * 按北京时间的自然日（00:00 → 24:00）积分，步长 10 s；每一天由日期播种，同一天任何时刻都能还原。
 * 为避免午夜突变，从前一天 22:00 起预热 2 小时，只从 00:00 起记账。
 *
 * 业务：100 台纯电无人矿卡分五队，从电铲装车 → 重载运行 → 卸到排土场 / 破碎站 → 空载返回，
 *       电量低于 SWAP_SOC 时去换电站（6 min / 次，电池池有限，旧电池充电约 1 h）。
 *       电铲一次只装一辆，会有交接班、爆破、移位、故障；破碎站一次只卸一辆，煤经皮带走廊送坑口电厂 / 封闭煤场。
 *       另外模拟：光伏、边坡位移（GNSS + 雷达分区）、地下水位、爆破振动、5G 基站。
 * 公开依据的数字（100 台、90 t、564 kWh、6 min 换电、8.5 kWh/km ≈ 满电 60 km）来自 docs/design/open-pit/02-research.md；
 * 电铲台数、运距、编组、破碎站能力等是演示假设。
 *
 * 用法：
 *   const sim = createPitSim(layout)          // layout 来自 data/layout.json
 *   const s = sim.at(Date.now())              // 当前时刻的完整状态
 *   sim.eventsBetween(t0, t1)                 // 时间段内的事件
 *   sim.DESIGN_T                              // 设计稿时刻（毫秒）
 */

// ---------- 常量与参数（集中在这里调） ----------
const DT = 10 // 积分步长 s
const DAY_SEC = 86400
const FRAMES = DAY_SEC / DT + 1
const WARMUP = 7200 // 预热 s
const CAP_KWH = 564 // 单块电池容量
const KWH_LOADED = 8.5 // 重载能耗 kWh/km（满电拉载 90 t 约 60 km）
const KWH_EMPTY = 4.6 // 空载能耗 kWh/km
const IDLE_KW = 3 // 待机功耗
const SWAP_SOC = 28 // 低于此电量去换电
const SWAP_SEC = 360 // 一次换电 6 min
const BAYS = 4 // 每个换电站的工位
const SPARE_PACKS = 40 // 备用电池包数量
const CHARGE_KW = 450 // 单包充电功率
const PV_KWP = 18000 // 光伏装机（演示值）
const YARD_CAP_T = 350000 // 封闭煤场容量（演示值）
const BELT_DELAY = 126 // 皮带走廊输送时间 126 步 = 21 min
const SHIFT_AT = [0, 28800, 57600] // 交接班时刻 s（夜 / 白 / 中班各 8 h）
const SHIFT_PAUSE = 720 // 交接班电铲暂停 s
const BLAST = [42000, 44100] // 每天爆破窗口 11:40–12:15（ES-01 / ES-02 暂停）
const START_Y = Date.UTC(2026, 0, 1) // 年累起点
const YTD_BASE = { date: "2026-10-26", coal: 1125, strip: 1885 } // 截至 10-26 的年累（万吨，公开）

/**
 * 四条运输线各自的运距（沿盘山路，含坑内斜坡道）与平均速度，m 与 m/s。
 * 运距比直线距离长得多：坑深约 150 m，坡道要盘旋 6–8 km 才出坑；重载上坡平均约 15 km/h，空载约 26 km/h。
 * 台数和运距按「日运量约 15 万吨、煤占 37%」调过（公开的是「日运量超 10 万吨、年累煤岩煤占约 37%」）。
 */
export const ROUTES = {
  "FL-A": {
    sink: "DP-W",
    kind: "strip",
    haul: 12600,
    vL: 4.2,
    vE: 7.2,
    swapM: 1900
  },
  "FL-B": {
    sink: "DP-I",
    kind: "strip",
    haul: 10600,
    vL: 4.4,
    vE: 7.2,
    swapM: 1500
  },
  "FL-C": {
    sink: "CR-01",
    kind: "coal",
    haul: 7400,
    vL: 3.9,
    vE: 7.2,
    swapM: 1100
  },
  "FL-D": {
    sink: "CR-02",
    kind: "coal",
    haul: 3000,
    vL: 4.0,
    vE: 7.2,
    swapM: 2600
  }
}
const SINKS = {
  "DP-W": { spots: 4, tph: 0 },
  "DP-I": { spots: 4, tph: 0 },
  "CR-01": { spots: 1, tph: 1800 },
  "CR-02": { spots: 1, tph: 3000 }
}

export const PHASE = {
  EMPTY: 0,
  QUEUE_LOAD: 1,
  LOAD: 2,
  HAUL: 3,
  QUEUE_UNLOAD: 4,
  UNLOAD: 5,
  TO_SWAP: 6,
  QUEUE_SWAP: 7,
  SWAP: 8,
  IDLE: 9,
  FAULT: 10
}
export const PHASE_NAME = [
  "空载返回",
  "排队等装",
  "装载中",
  "重载运行",
  "排队待卸",
  "卸载中",
  "前往换电",
  "排队换电",
  "换电中",
  "待命",
  "故障"
]
/** 屏上的六类状态，对应各 PHASE */
export const GROUP_OF = [0, 2, 1, 0, 2, 1, 3, 3, 3, 4, 5]
export const GROUP_NAME = ["运行", "装卸", "排队", "换电", "待命", "故障"]
export const SHOVEL_STATE = ["装车中", "待车", "移位", "暂停", "故障"]

// ---------- 时间与随机数 ----------
export function beijing(ms) {
  const d = new Date(ms + 8 * 3600e3)
  return {
    date: d.toISOString().slice(0, 10),
    h: d.getUTCHours(),
    m: d.getUTCMinutes(),
    s: d.getUTCSeconds(),
    sec: d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds()
  }
}
/** 北京时间 date 当天 hour（可为小数）对应的毫秒时间戳 */
export function msForBeijing(date, hour) {
  const [y, mo, da] = date.split("-").map(Number)
  return Date.UTC(y, mo - 1, da) - 8 * 3600e3 + hour * 3600e3
}
const dayStartMs = (date) => msForBeijing(date, 0)

function hashStr(str) {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return (h ^ (h >>> 16)) >>> 0
}
function rng(seed) {
  let a = hashStr(seed)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const normal = (r) =>
  Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())
const clamp = (x, a, b) => Math.min(b, Math.max(a, x))
const pad = (n, w = 2) => String(n).padStart(w, "0")

/** 设计稿时刻：2026-10-30 20:30（夜间，边坡二级预警中、TK-037 故障中、BS-07 离线、GW-11 漂移） */
export const DESIGN_DATE = "2026-10-30"
export const DESIGN_T = msForBeijing(DESIGN_DATE, 20.5)

/** 脚本化的事件（只在设计稿那一天，保证设计稿要画的异常态都在场） */
const SCRIPT = {
  [DESIGN_DATE]: {
    truckFault: [
      {
        id: "TK-037",
        at: 20 * 3600 + 10 * 60,
        dur: 48 * 60,
        why: "电池温度偏高"
      },
      {
        id: "TK-081",
        at: 19 * 3600 + 50 * 60,
        dur: 70 * 60,
        why: "激光雷达脏污，感知自检未通过"
      }
    ],
    slopeWarn: {
      sector: "SR-02",
      sites: [71, 72, 73, 74, 75],
      from: 19 * 3600 + 42 * 60,
      to: 23 * 3600 + 30 * 60,
      peak: 1.6
    },
    bsOff: {
      id: "BS-07",
      sites: [64, 65, 66, 67, 68, 69],
      from: 19 * 3600 + 55 * 60,
      to: 21 * 3600 + 20 * 60
    },
    gwDrift: {
      id: "GW-11",
      from: 20 * 3600 + 20 * 60,
      to: 20 * 3600 + 45 * 60
    },
    avoid: { truck: "TK-052", other: "CV-02", at: 20 * 3600 + 25 * 60 }
  }
}

// ---------- 太阳高度（光伏用） ----------
function sinSunElev(ms) {
  const d = new Date(ms)
  const n =
    (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
      Date.UTC(d.getUTCFullYear(), 0, 0)) /
    86400e3
  const decl =
    ((23.44 * Math.PI) / 180) * Math.sin((2 * Math.PI * (284 + n)) / 365)
  const lat = (48.58 * Math.PI) / 180
  const utcH =
    d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600
  const solarH = utcH + 119.7 / 15 // 真太阳时（忽略时差方程）
  const ha = ((solarH - 12) * 15 * Math.PI) / 180
  return (
    Math.sin(lat) * Math.sin(decl) +
    Math.cos(lat) * Math.cos(decl) * Math.cos(ha)
  )
}

// ---------- 一天的积分 ----------
function buildDay(layout, date) {
  const R = rng(`open-pit:${date}`)
  const script = SCRIPT[date] || null
  const segMs = dayStartMs(date)

  // 设备
  const fleets = layout.fleets
  const nT = fleets.reduce((n, f) => n + f.n, 0)
  const trucks = []
  fleets.forEach((f) =>
    f.trucks.forEach((id) => {
      const idx = trucks.length
      trucks.push({
        id,
        idx,
        fleet: f.id,
        route: f.id === "FL-E" ? "FL-A" : f.id,
        phase: PHASE.EMPTY,
        s: 0,
        soc: 0,
        load: 0,
        timer: 0,
        loads: 0,
        tons: 0,
        speedK: clamp(1 + 0.06 * normal(R), 0.88, 1.12),
        resume: PHASE.EMPTY,
        sink: null,
        station: null,
        loader: null,
        fault: null,
        kwh: 0,
        km: 0
      })
    })
  )
  const shovelIds = layout.devices
    .filter((d) => d.kind === "shovel")
    .map((d) => d.id)
  const shovels = shovelIds.map((id) => {
    const fleet = fleets.find((f) => f.loaders && f.loaders.includes(id)).id
    const reloc = (2 + 20 * R()) * 3600
    return {
      id,
      fleet,
      queue: [],
      busy: -1,
      cool: 0,
      loads: 0,
      tons: 0,
      state: 1,
      relocAt: reloc,
      relocDur: (25 + 8 * normal(R)) * 60,
      faultAt: R() < 0.35 ? (1 + 21 * R()) * 3600 : -1,
      faultDur: (25 + 30 * R()) * 60
    }
  })
  const sinks = Object.fromEntries(
    Object.entries(SINKS).map(([id, c]) => [
      id,
      { id, ...c, busy: [], queue: [], tons: 0, loads: 0 }
    ])
  )
  const stations = [
    { id: "SW-01", busy: [], queue: [], swaps: 0 },
    { id: "SW-02", busy: [], queue: [], swaps: 0 }
  ]
  const pool = { full: SPARE_PACKS - 4, charging: [] } // 4 包已在充电
  for (let i = 0; i < 4; i++) pool.charging.push(-WARMUP + (600 + 900 * i))

  // 日初状态：预热从 -2 h 起，卡车分散在整条线上
  trucks.forEach((tk) => {
    const u = R()
    tk.soc = 38 + 58 * R()
    if (u < 0.45) {
      tk.phase = PHASE.EMPTY
      tk.s = R() * ROUTES[tk.route].haul
    } else if (u < 0.85) {
      tk.phase = PHASE.HAUL
      tk.load = 90
      tk.sink = ROUTES[tk.route].sink
      tk.s = R() * ROUTES[tk.route].haul
    } else {
      tk.phase = PHASE.EMPTY
      tk.s = 0
    }
  })

  // 日内计划：卡车故障、边坡 / 通信 / 水位事件
  const faults = []
  const nFault = 4 + Math.floor(3 * R())
  for (let i = 0; i < nFault; i++)
    faults.push({
      at: (1.5 + 21 * R()) * 3600,
      dur: (20 + 60 * R()) * 60,
      idx: Math.floor(R() * nT),
      why: [
        "电池温度偏高",
        "制动气压异常",
        "线控转向自检失败",
        "激光雷达脏污",
        "驱动电机过温"
      ][Math.floor(R() * 5)],
      done: false
    })
  if (script)
    script.truckFault.forEach((f) =>
      faults.push({
        at: f.at,
        dur: f.dur,
        idx: trucks.findIndex((t) => t.id === f.id),
        why: f.why,
        done: false
      })
    )
  faults.sort((a, b) => a.at - b.at)

  // 记账
  const F = {
    phase: new Uint8Array(FRAMES * nT),
    s: new Float32Array(FRAMES * nT),
    soc: new Float32Array(FRAMES * nT),
    loads: new Uint16Array(FRAMES * nT),
    tons: new Float32Array(FRAMES * nT),
    route: new Uint8Array(FRAMES * nT),
    rs: new Uint8Array(FRAMES * nT), // 故障前的相位（故障车停在原地，三维里要知道它在往哪个方向走）
    ld: new Uint8Array(FRAMES * nT), // 对应电铲在 shovels 里的序号（空载 = 目标电铲，其余 = 装车的电铲）
    qpos: new Uint8Array(FRAMES * nT),
    shState: new Uint8Array(FRAMES * shovels.length),
    shLoads: new Uint16Array(FRAMES * shovels.length),
    shQueue: new Uint8Array(FRAMES * shovels.length),
    cumCoal: new Float64Array(FRAMES),
    cumStrip: new Float64Array(FRAMES),
    sinkT: Object.fromEntries(
      Object.keys(SINKS).map((k) => [k, new Float64Array(FRAMES)])
    ),
    sinkQ: Object.fromEntries(
      Object.keys(SINKS).map((k) => [k, new Uint8Array(FRAMES)])
    ),
    swapQ: new Uint8Array(FRAMES * 2),
    swapBusy: new Uint8Array(FRAMES * 2),
    swaps: new Uint16Array(FRAMES),
    poolFull: new Uint8Array(FRAMES),
    poolChg: new Uint8Array(FRAMES),
    pvKw: new Float32Array(FRAMES),
    chgKw: new Float32Array(FRAMES),
    pvUsedKwh: new Float64Array(FRAMES),
    pvKwh: new Float64Array(FRAMES),
    chgKwh: new Float64Array(FRAMES),
    tractKwh: new Float64Array(FRAMES),
    yard: new Float32Array(FRAMES),
    belt: new Float32Array(FRAMES),
    burn: new Float32Array(FRAMES),
    kmCum: new Float64Array(FRAMES)
  }
  const events = []
  const ev = (kind, title, level, target, fromS, toS, desc) =>
    events.push({
      id: `${date.replace(/-/g, "")}-${pad(events.length + 1, 3)}`,
      kind,
      title,
      level,
      target,
      fromS,
      toS,
      desc
    })

  // 煤场与电厂
  let yard = 215000 + 60000 * (R() - 0.5)
  const beltBuf = new Float64Array(BELT_DELAY) // 皮带上的煤（按步滚动）
  let beltPtr = 0
  let cumCoal = 0,
    cumStrip = 0,
    swaps = 0,
    pvKwh = 0,
    chgKwh = 0,
    pvUsed = 0,
    tractKwh = 0,
    kmCum = 0
  const cloud = 0.55 + 0.45 * R()
  const trainAt = [28800 + 1800, 54000, 79200] // 三列外运装车 08:30 / 15:00 / 22:00，各 90 min

  const queuedLoad = (route) => {
    const f = fleets.find((x) => x.id === route)
    return f.loaders.reduce((n, id) => {
      const s = shovels.find((x) => x.id === id)
      return n + s.queue.length + (s.busy >= 0 ? 1 : 0)
    }, 0)
  }
  const pickShovel = (route) => {
    const f = fleets.find((x) => x.id === route)
    let best = null
    f.loaders.forEach((id) => {
      const s = shovels.find((x) => x.id === id)
      // 队列 + 正在装的 + 已派出还在路上的；移位 / 暂停 / 故障的电铲尽量不派
      const enRoute = trucks.filter(
        (t) => t.phase === PHASE.EMPTY && t.nextLoader === id
      ).length
      const w =
        s.queue.length +
        (s.busy >= 0 ? 1 : 0) +
        enRoute +
        (s.state >= 2 ? 6 : 0)
      if (!best || w < best.w) best = { s, w }
    })
    return best.s
  }
  const chooseRoute = (tk) => {
    if (tk.fleet !== "FL-E") return tk.fleet
    let best = "FL-A",
      bw = Infinity
    for (const r of Object.keys(ROUTES)) {
      const f = fleets.find((x) => x.id === r)
      const w = queuedLoad(r) / f.loaders.length
      if (w < bw) {
        bw = w
        best = r
      }
    }
    return best
  }
  // 当日计划运量（t）：调度按计划进度放车。机动编组每一趟出发前按「超前多少」随机决定待命：
  // 正好在计划线上时一半待命，落后 5% 以上全部出车，超前 5% 以上全部待命，其余编组不受影响
  const dailyPlan = 152000 + 18000 * R()
  const startEmpty = (tk, t) => {
    tk.route = chooseRoute(tk)
    const behind =
      t < 3600 ? 0.1 : 1 - (cumCoal + cumStrip) / (dailyPlan * (t / DAY_SEC))
    const idleP = clamp(0.5 - 10 * behind, 0, 1)
    if (
      tk.fleet === "FL-E" &&
      (R() < idleP ||
        queuedLoad(tk.route) /
          fleets.find((x) => x.id === tk.route).loaders.length >=
          2.5)
    ) {
      tk.phase = PHASE.IDLE
      tk.timer = 480 + 240 * R()
      return
    }
    tk.phase = PHASE.EMPTY
    tk.s = 0
    // 调度在出发时就下发目标电铲：三维里卡车要沿那台电铲对应的路线回去
    tk.nextLoader = pickShovel(tk.route).id
  }
  const joinLoadQueue = (tk) => {
    // 目标电铲故障时才改派
    const want = shovels.find((x) => x.id === tk.nextLoader)
    const s = want && want.state !== 4 ? want : pickShovel(tk.route)
    s.queue.push(tk.idx)
    tk.loader = s.id
    tk.phase = PHASE.QUEUE_LOAD
    tk.s = 0
  }
  const dequeue = (arr, idx) => {
    const i = arr.indexOf(idx)
    if (i >= 0) arr.splice(i, 1)
  }
  // 滚动写入
  const record = (f) => {
    const o = f * nT
    for (let i = 0; i < nT; i++) {
      const tk = trucks[i]
      F.phase[o + i] = tk.phase
      F.s[o + i] = tk.s
      F.soc[o + i] = tk.soc
      F.loads[o + i] = tk.loads
      F.tons[o + i] = tk.tons
      F.route[o + i] = ["FL-A", "FL-B", "FL-C", "FL-D"].indexOf(tk.route)
      const lid = tk.phase === PHASE.EMPTY ? tk.nextLoader : tk.loader
      F.ld[o + i] = Math.max(0, shovelIds.indexOf(lid))
      F.rs[o + i] = tk.resume
    }
    // 队列里的位次
    const mark = (arr) =>
      arr.forEach((idx, p) => {
        F.qpos[o + idx] = Math.min(255, p + 1)
      })
    for (let i = 0; i < nT; i++) F.qpos[o + i] = 0
    shovels.forEach((s) => mark(s.queue))
    Object.values(sinks).forEach((s) => mark(s.queue))
    stations.forEach((s) => mark(s.queue))
    shovels.forEach((s, j) => {
      F.shState[f * shovels.length + j] = s.state
      F.shLoads[f * shovels.length + j] = s.loads
      F.shQueue[f * shovels.length + j] = Math.min(255, s.queue.length)
    })
    F.cumCoal[f] = cumCoal
    F.cumStrip[f] = cumStrip
    Object.entries(sinks).forEach(([id, s]) => {
      F.sinkT[id][f] = s.tons
      F.sinkQ[id][f] = Math.min(255, s.queue.length)
    })
    stations.forEach((s, j) => {
      F.swapQ[f * 2 + j] = Math.min(255, s.queue.length)
      F.swapBusy[f * 2 + j] = s.busy.length
    })
    F.swaps[f] = swaps
    F.poolFull[f] = pool.full
    F.poolChg[f] = pool.charging.length
    F.pvKwh[f] = pvKwh
    F.chgKwh[f] = chgKwh
    F.pvUsedKwh[f] = pvUsed
    F.tractKwh[f] = tractKwh
    F.kmCum[f] = kmCum
    F.yard[f] = yard
  }

  // 记录日内预热后清零的计数
  const resetCounters = () => {
    trucks.forEach((tk) => {
      tk.loads = 0
      tk.tons = 0
      tk.kwh = 0
      tk.km = 0
    })
    shovels.forEach((s) => {
      s.loads = 0
      s.tons = 0
    })
    Object.values(sinks).forEach((s) => {
      s.tons = 0
      s.loads = 0
    })
    cumCoal = 0
    cumStrip = 0
    swaps = 0
    pvKwh = 0
    chgKwh = 0
    pvUsed = 0
    tractKwh = 0
    kmCum = 0
    stations.forEach((s) => (s.swaps = 0))
  }

  // 主循环：从 -WARMUP 起，t >= 0 才写入
  const total = Math.round((DAY_SEC + WARMUP) / DT)
  for (let step = 0; step <= total; step++) {
    const t = -WARMUP + step * DT // 当日 0 点起的秒
    if (step === 0)
      trucks.forEach((tk) => {
        if (tk.phase === PHASE.EMPTY) tk.nextLoader = pickShovel(tk.route).id
        else tk.loader = pickShovel(tk.route).id
      })
    if (t === 0) resetCounters()

    // 1) 电铲：交接班、爆破、移位、故障 → 状态
    shovels.forEach((s) => {
      const shift = SHIFT_AT.some((a) => t >= a && t < a + SHIFT_PAUSE)
      const blast =
        (s.id === "ES-01" || s.id === "ES-02") && t >= BLAST[0] && t < BLAST[1]
      const reloc = t >= s.relocAt && t < s.relocAt + s.relocDur
      const fault =
        s.faultAt >= 0 && t >= s.faultAt && t < s.faultAt + s.faultDur
      let st = s.busy >= 0 ? 0 : 1
      if (fault) st = 4
      else if (reloc) st = 2
      else if (shift || blast) st = 3
      s.state = st
      if (fault && s.faultAt <= t && t < s.faultAt + DT && t >= 0)
        ev(
          "shovelFault",
          `${s.id} 电铲故障停机`,
          "major",
          s.id,
          s.faultAt,
          s.faultAt + s.faultDur,
          "液压系统压力异常，维修中，装车线转到其他电铲"
        )
      if (s.cool > 0) s.cool -= DT
      // 开始装车
      if (st <= 1 && s.busy < 0 && s.cool <= 0 && s.queue.length) {
        const idx = s.queue.shift()
        const tk = trucks[idx]
        s.busy = idx
        tk.phase = PHASE.LOAD
        tk.timer = clamp(210 + 40 * normal(R), 140, 330)
        s.state = 0
      }
    })

    // 2) 卡车
    trucks.forEach((tk) => {
      const rt = ROUTES[tk.route]
      // 故障触发（只在空载 / 重载行驶、排队等装、待命时触发）
      for (const fl of faults) {
        if (!fl.done && fl.idx === tk.idx && t >= fl.at) {
          if (
            [PHASE.EMPTY, PHASE.HAUL, PHASE.QUEUE_LOAD, PHASE.IDLE].includes(
              tk.phase
            )
          ) {
            fl.done = true
            tk.resume = tk.phase === PHASE.QUEUE_LOAD ? PHASE.EMPTY : tk.phase
            if (tk.phase === PHASE.QUEUE_LOAD) {
              dequeue(shovels.find((x) => x.id === tk.loader).queue, tk.idx)
              tk.s = rt.haul
            }
            tk.phase = PHASE.FAULT
            tk.timer = fl.dur
            if (t >= 0)
              ev(
                "truckFault",
                `${tk.id} 故障停运`,
                "major",
                tk.id,
                t,
                t + fl.dur,
                fl.why
              )
          }
        }
      }
      switch (tk.phase) {
        case PHASE.EMPTY: {
          const v = rt.vE * tk.speedK
          const ds = v * DT
          tk.s += ds
          tk.soc -= ((KWH_EMPTY * ds) / 1000 / CAP_KWH) * 100
          tk.kwh += (KWH_EMPTY * ds) / 1000
          tk.km += ds / 1000
          if (t >= 0) {
            tractKwh += (KWH_EMPTY * ds) / 1000
            kmCum += ds / 1000
          }
          if (tk.s >= rt.haul) joinLoadQueue(tk)
          break
        }
        case PHASE.QUEUE_LOAD:
        case PHASE.QUEUE_UNLOAD:
        case PHASE.QUEUE_SWAP:
        case PHASE.IDLE:
          tk.soc -= ((IDLE_KW * DT) / 3600 / CAP_KWH) * 100
          if (tk.phase === PHASE.IDLE) {
            tk.timer -= DT
            if (tk.timer <= 0) startEmpty(tk, t)
          }
          break
        case PHASE.LOAD: {
          tk.timer -= DT
          tk.soc -= ((IDLE_KW * DT) / 3600 / CAP_KWH) * 100
          if (tk.timer <= 0) {
            const s = shovels.find((x) => x.id === tk.loader)
            tk.load = 90 * (0.96 + 0.06 * R())
            s.busy = -1
            s.cool = 20
            s.loads++
            s.tons += tk.load
            tk.sink = rt.sink
            tk.phase = PHASE.HAUL
            tk.s = 0
          }
          break
        }
        case PHASE.HAUL: {
          const v = rt.vL * tk.speedK
          const ds = v * DT
          tk.s += ds
          tk.soc -= ((KWH_LOADED * ds) / 1000 / CAP_KWH) * 100
          tk.kwh += (KWH_LOADED * ds) / 1000
          tk.km += ds / 1000
          if (t >= 0) {
            tractKwh += (KWH_LOADED * ds) / 1000
            kmCum += ds / 1000
          }
          if (tk.s >= rt.haul) {
            const sk = sinks[tk.sink]
            if (sk.busy.length < sk.spots) {
              sk.busy.push(tk.idx)
              tk.phase = PHASE.UNLOAD
              tk.timer = sk.tph ? tk.load / (sk.tph / 3600) + 20 : 80 + 25 * R()
            } else {
              sk.queue.push(tk.idx)
              tk.phase = PHASE.QUEUE_UNLOAD
            }
          }
          break
        }
        case PHASE.UNLOAD: {
          tk.timer -= DT
          tk.soc -= ((IDLE_KW * DT) / 3600 / CAP_KWH) * 100
          if (tk.timer <= 0) {
            const sk = sinks[tk.sink]
            dequeue(sk.busy, tk.idx)
            sk.tons += tk.load
            sk.loads++
            tk.loads++
            tk.tons += tk.load
            if (rt.kind === "coal") {
              cumCoal += tk.load
              beltBuf[beltPtr] += tk.load
            } else cumStrip += tk.load
            tk.load = 0
            if (tk.soc < SWAP_SOC) {
              tk.phase = PHASE.TO_SWAP
              tk.s = 0
            } else startEmpty(tk, t)
          }
          break
        }
        case PHASE.TO_SWAP: {
          const v = rt.vE * tk.speedK
          const ds = v * DT
          tk.s += ds
          tk.soc -= ((KWH_EMPTY * ds) / 1000 / CAP_KWH) * 100
          tk.kwh += (KWH_EMPTY * ds) / 1000
          tk.km += ds / 1000
          if (t >= 0) {
            tractKwh += (KWH_EMPTY * ds) / 1000
            kmCum += ds / 1000
          }
          if (tk.s >= rt.swapM) {
            const st =
              stations[
                stations[0].queue.length + stations[0].busy.length <=
                stations[1].queue.length + stations[1].busy.length
                  ? 0
                  : 1
              ]
            st.queue.push(tk.idx)
            tk.station = st.id
            tk.phase = PHASE.QUEUE_SWAP
            tk.s = 0
          }
          break
        }
        case PHASE.SWAP:
          tk.timer -= DT
          if (tk.timer <= 0) {
            const st = stations.find((x) => x.id === tk.station)
            dequeue(st.busy, tk.idx)
            tk.soc = 96 + 3.5 * R()
            startEmpty(tk, t)
          }
          break
        case PHASE.FAULT:
          tk.timer -= DT
          if (tk.timer <= 0) {
            if (tk.resume === PHASE.HAUL) tk.phase = PHASE.HAUL
            else if (tk.resume === PHASE.IDLE) startEmpty(tk, t)
            else {
              tk.phase = PHASE.EMPTY
            }
          }
          break
      }
    })

    // 3) 破碎站 / 排土场：有空位就放队首进去卸
    Object.values(sinks).forEach((sk) => {
      while (sk.busy.length < sk.spots && sk.queue.length) {
        const idx = sk.queue.shift()
        const tk = trucks[idx]
        sk.busy.push(idx)
        tk.phase = PHASE.UNLOAD
        tk.timer = sk.tph ? tk.load / (sk.tph / 3600) + 20 : 80 + 25 * R()
      }
    })

    // 4) 换电站：有空工位 + 有满电电池就开始换
    stations.forEach((st) => {
      while (st.busy.length < BAYS && st.queue.length && pool.full > 0) {
        const idx = st.queue.shift()
        const tk = trucks[idx]
        st.busy.push(idx)
        tk.phase = PHASE.SWAP
        tk.timer = SWAP_SEC + 20 * normal(R)
        pool.full--
        // 旧电池进入充电，充满约需 (98 - soc)% × 容量 / 充电功率
        pool.charging.push(
          t + ((((98 - tk.soc) / 100) * CAP_KWH) / CHARGE_KW) * 3600
        )
        st.swaps++
        if (t >= 0) swaps++
      }
    })
    for (let i = pool.charging.length - 1; i >= 0; i--)
      if (pool.charging[i] <= t) {
        pool.charging.splice(i, 1)
        pool.full++
      }

    // 5) 煤流：皮带走廊 → 煤场 / 电厂
    const inflow = beltBuf[(beltPtr + 1) % BELT_DELAY] // 已走完全程的煤
    beltBuf[(beltPtr + 1) % BELT_DELAY] = 0
    beltPtr = (beltPtr + 1) % BELT_DELAY
    const hour = (((t % DAY_SEC) + DAY_SEC) % DAY_SEC) / 3600
    const burnTph =
      1400 + 130 * Math.sin(((hour - 14) / 24) * 2 * Math.PI) + 30 * normal(R)
    const trainTph = trainAt.some((a) => t >= a && t < a + 5400) ? 3000 : 0
    yard = clamp(
      yard + inflow - ((burnTph + trainTph) * DT) / 3600,
      0,
      YARD_CAP_T
    )

    // 6) 能源：光伏与充电
    const ms = segMs + t * 1000
    const sinEl = sinSunElev(ms)
    const pvKw =
      PV_KWP *
      0.86 *
      Math.pow(Math.max(0, sinEl), 1.15) *
      clamp(cloud + 0.08 * Math.sin(t / 900), 0.3, 1)
    const chgKw = pool.charging.length * CHARGE_KW + 260 // 260 kW 站内辅助
    if (t >= 0) {
      pvKwh += (pvKw * DT) / 3600
      chgKwh += (chgKw * DT) / 3600
      pvUsed += (Math.min(pvKw, chgKw) * DT) / 3600
    }

    // 7) 写帧（t = 0 起，帧 f 对应 t = f * DT）
    if (t >= 0) {
      const f = t / DT
      record(f)
      F.pvKw[f] = pvKw
      F.chgKw[f] = chgKw
      F.belt[f] = (inflow * 3600) / DT
      F.burn[f] = burnTph + trainTph
    }
  }

  // 日内事件：换电排队 ≥ 4、电池池见底、爆破
  ev(
    "blast",
    "爆破作业",
    "info",
    "BL-01",
    BLAST[0],
    BLAST[1],
    "ES-01 / ES-02 暂停，周边卡车避让，振动监测 9 点同步记录"
  )
  scanRuns(
    F.swapQ,
    2,
    (j) => `SW-0${j + 1}`,
    4,
    (from, to, id) =>
      ev(
        "swapQueue",
        `${id} 换电站排队 ≥ 4 辆`,
        "minor",
        id,
        from * DT,
        to * DT,
        "车队电量集中偏低，建议错峰换电"
      )
  )
  let lowFrom = -1
  for (let f = 0; f < FRAMES; f++) {
    const low = F.poolFull[f] <= 2
    if (low && lowFrom < 0) lowFrom = f
    if ((!low || f === FRAMES - 1) && lowFrom >= 0) {
      ev(
        "poolLow",
        "备用电池包不足",
        "minor",
        "CH-01",
        lowFrom * DT,
        f * DT,
        "满电备用电池 ≤ 2 包，换电可能排队"
      )
      lowFrom = -1
    }
  }
  // 边坡 / 通信 / 水位 / 避让：脚本化或随机
  if (script) {
    const sw = script.slopeWarn,
      bs = script.bsOff,
      gw = script.gwDrift,
      av = script.avoid
    ev(
      "slopeWarn",
      `北帮位移速率二级预警（${sw.sector}）`,
      "major",
      sw.sector,
      sw.from,
      sw.to,
      "GN-071..075 位移速率超过 1 mm/h，已限速并封闭对应台阶道路"
    )
    ev(
      "commOff",
      `${bs.id} 基站离线`,
      "minor",
      bs.id,
      bs.from,
      bs.to,
      "覆盖的 GNSS 位移站数据停止更新，车辆切换到相邻基站"
    )
    ev(
      "sensorDrift",
      `${gw.id} 水位读数漂移`,
      "info",
      gw.id,
      gw.from,
      gw.to,
      "读数偏离相邻井 0.6 m，待复核"
    )
    ev(
      "avoid",
      `${av.truck} 避让 ${av.other}`,
      "info",
      av.truck,
      av.at,
      av.at + 90,
      "无人矿卡识别到有人驾驶的巡检车，主动减速让行"
    )
  } else {
    if (R() < 0.4) {
      const at = (3 + 17 * R()) * 3600
      ev(
        "slopeWarn",
        "边坡位移速率一级预警",
        "minor",
        `SR-0${1 + Math.floor(R() * 3)}`,
        at,
        at + (40 + 80 * R()) * 60,
        "位移速率短时升高，持续观测"
      )
    }
    if (R() < 0.35) {
      const at = (2 + 19 * R()) * 3600
      ev(
        "commOff",
        `BS-${pad(1 + Math.floor(R() * 12))} 基站闪断`,
        "minor",
        "BS-xx",
        at,
        at + 600,
        "覆盖区内车辆短时切换基站"
      )
    }
  }
  events.sort((a, b) => a.fromS - b.fromS)

  return { F, events, trucks, shovels, nT, segMs, script, cloud, date }
}

/** 序列 arr 在帧 f 之前 n 步（含 f）的平均 */
function avgBack(arr, f, n) {
  const a = Math.max(0, f - n + 1)
  let sum = 0
  for (let i = a; i <= f; i++) sum += arr[i]
  return sum / (f - a + 1)
}

/** 扫描一个 (帧 × 列) 的序列，找出值 ≥ 阈值的连续区间 */
function scanRuns(arr, cols, nameOf, thr, cb) {
  for (let j = 0; j < cols; j++) {
    let from = -1
    for (let f = 0; f < FRAMES; f++) {
      const hot = arr[f * cols + j] >= thr
      if (hot && from < 0) from = f
      if ((!hot || f === FRAMES - 1) && from >= 0) {
        cb(from, f, nameOf(j))
        from = -1
      }
    }
  }
}

// ---------- 边坡 / 水位 / 爆破 / 通信（解析式，不积分） ----------
function slopeModel(layout, date, script) {
  const rate = [] // 各 GNSS 站的基线速率 mm/h
  const base = []
  const r0 = rng("slope-base")
  for (let i = 0; i < 118; i++) {
    const west = i >= 80,
      east = i >= 40 && i < 80
    rate.push(
      (west ? 0.012 : east ? 0.03 : 0.02) * (0.5 + r0()) +
        (r0() < 0.06 ? 0.05 : 0)
    )
    base.push(r0() * 40 - 8)
  }
  const days = (dayStartMs(date) - START_Y) / 86400e3
  return {
    sector: (i) => (i < 40 ? "SR-01" : i < 80 ? "SR-02" : "SR-03"),
    // 站 i（0 起）在当日 t 秒的累计位移 mm 与速率 mm/h
    at(i, t) {
      let extraRate = 0,
        extraDisp = 0
      if (script && script.slopeWarn.sites.includes(i + 1)) {
        const w = script.slopeWarn
        const f = (x) => clamp((x - w.from) / (w.to - w.from), 0, 1)
        const shape = (u) => Math.sin(Math.PI * Math.sqrt(Math.min(u, 1))) // 先快后慢：峰值在 25% 处，之后缓慢回落
        extraRate =
          t >= w.from && t <= w.to
            ? w.peak * shape(f(t)) * (0.75 + 0.05 * ((i + 1) % 5))
            : 0
        // 位移 = 速率积分（梯形近似，步长 5 min）
        for (let x = w.from; x < Math.min(t, w.to); x += 300)
          extraDisp +=
            (w.peak * shape(f(x)) * (0.75 + 0.05 * ((i + 1) % 5)) * 300) / 3600
      }
      const wob = 0.004 * Math.sin(t / 5400 + i)
      return {
        disp: base[i] + (days * 24 + t / 3600) * rate[i] + extraDisp,
        vel: Math.max(0, rate[i] + wob + extraRate)
      }
    }
  }
}

function groundwaterAt(i, date, t) {
  const R = rng(`gw:${i}`)
  const lvl = 9 + 0.35 * i + 1.2 * R()
  const trend = -0.01 * ((dayStartMs(date) - START_Y) / 86400e3 / 30) // 长期缓降（疏干）
  return lvl + trend + 0.03 * Math.sin(t / 7200 + i)
}

// ---------- 对外接口 ----------
export function createPitSim(layout) {
  const cache = new Map()
  // 每天的总运量单独缓存：年累要把之前每天加起来，而逐帧数据（十几 MB）只留最近 3 天，
  // 不然每次 at() 都要把前几天重新积分一遍（一天约 0.4 s）
  const totals = new Map()
  const day = (date) => {
    if (!cache.has(date)) {
      const D = buildDay(layout, date)
      cache.set(date, D)
      totals.set(date, {
        coal: D.F.cumCoal[FRAMES - 1],
        strip: D.F.cumStrip[FRAMES - 1]
      })
      if (cache.size > 3) cache.delete(cache.keys().next().value)
    }
    return cache.get(date)
  }
  const dayTotals = (date) => {
    if (!totals.has(date)) day(date)
    return totals.get(date)
  }
  const slopes = new Map()
  const slopeOf = (date) => {
    if (!slopes.has(date))
      slopes.set(date, slopeModel(layout, date, SCRIPT[date]))
    return slopes.get(date)
  }
  const fleetIds = layout.fleets.map((f) => f.id)

  function at(ms) {
    const bj = beijing(ms)
    const D = day(bj.date)
    const { F, nT, trucks, shovels } = D
    const tSec = (ms - D.segMs) / 1000
    const f = clamp(Math.floor(tSec / DT), 0, FRAMES - 1)
    const f2 = Math.min(FRAMES - 1, f + 1)
    const a = clamp((tSec - f * DT) / DT, 0, 1)
    const o = f * nT
    const out = {
      t: ms,
      date: bj.date,
      sec: bj.sec,
      frame: f,
      trucks: [],
      counts: new Array(6).fill(0),
      phaseCounts: new Array(11).fill(0)
    }

    // 卡车
    for (let i = 0; i < nT; i++) {
      const ph = F.phase[o + i]
      let s = F.s[o + i]
      // 行驶中的卡车在两帧之间插值位置
      if (
        [PHASE.EMPTY, PHASE.HAUL, PHASE.TO_SWAP].includes(ph) &&
        F.phase[f2 * nT + i] === ph
      )
        s += (F.s[f2 * nT + i] - s) * a
      const soc = F.soc[o + i] + (F.soc[f2 * nT + i] - F.soc[o + i]) * a
      out.trucks.push({
        id: trucks[i].id,
        fleet: trucks[i].fleet,
        route: fleetIds[F.route[o + i]] || "FL-A",
        phase: ph,
        s,
        soc,
        loads: F.loads[o + i],
        tons: F.tons[o + i],
        qpos: F.qpos[o + i],
        loader: shovels[F.ld[o + i]].id,
        resume: F.rs[o + i],
        group: GROUP_OF[ph],
        loaded:
          ph === PHASE.HAUL || ph === PHASE.QUEUE_UNLOAD || ph === PHASE.UNLOAD
      })
      out.counts[GROUP_OF[ph]]++
      out.phaseCounts[ph]++
    }
    const n = shovels.length
    out.shovels = shovels.map((s, j) => ({
      id: s.id,
      fleet: s.fleet,
      state: F.shState[f * n + j],
      loads: F.shLoads[f * n + j],
      queue: F.shQueue[f * n + j],
      tons: F.shLoads[f * n + j] * 90
    }))
    out.sinks = Object.keys(SINKS).map((id) => ({
      id,
      tons: F.sinkT[id][f],
      queue: F.sinkQ[id][f]
    }))
    out.stations = [0, 1].map((j) => ({
      id: `SW-0${j + 1}`,
      queue: F.swapQ[f * 2 + j],
      busy: F.swapBusy[f * 2 + j]
    }))
    out.pool = { full: F.poolFull[f], charging: F.poolChg[f] }

    // 汇总
    const coalT = F.cumCoal[f],
      stripT = F.cumStrip[f]
    const loadsT = out.trucks.reduce((s, t) => s + t.loads, 0)
    const ytd = ytdAt(bj.date, coalT, stripT)
    out.today = {
      coalT,
      stripT,
      totalT: coalT + stripT,
      loads: loadsT,
      swaps: F.swaps[f],
      km: F.kmCum[f],
      tractKwh: F.tractKwh[f]
    }
    out.ytd = ytd
    out.attendance = ((nT - out.counts[5]) / nT) * 100
    out.energy = {
      pvKw: F.pvKw[f],
      chgKw: F.chgKw[f],
      pvKwh: F.pvKwh[f],
      chgKwh: F.chgKwh[f],
      pvUsedKwh: F.pvUsedKwh[f]
    }
    out.yard = {
      t: F.yard[f],
      cap: YARD_CAP_T,
      // 煤是成批落到皮带上的，瞬时值忽高忽低，屏上取前 5 分钟（30 步）的平均
      beltTph: avgBack(F.belt, f, 30),
      burnTph: F.burn[f]
    }
    return out
  }

  /** 年累（万吨）：截至 2026-10-26 的公开值 + 之后每天的仿真总量 + 当天已完成的 */
  function ytdAt(date, coalT, stripT) {
    let coal = YTD_BASE.coal * 1e4,
      strip = YTD_BASE.strip * 1e4
    const base = dayStartMs(YTD_BASE.date)
    const cur = dayStartMs(date)
    for (let d = base + 86400e3; d < cur; d += 86400e3) {
      const ds = beijing(d + 3600e3).date
      const t = dayTotals(ds)
      coal += t.coal
      strip += t.strip
    }
    return {
      coal: (coal + coalT) / 1e4,
      strip: (strip + stripT) / 1e4,
      total: (coal + strip + coalT + stripT) / 1e4
    }
  }

  /** 时间段内的事件（毫秒），跨日则逐日取 */
  function eventsBetween(t0, t1) {
    const out = []
    for (let d = dayStartMs(beijing(t0).date); d <= t1; d += 86400e3) {
      const D = day(beijing(d + 3600e3).date)
      D.events.forEach((e) => {
        const from = d + e.fromS * 1000,
          to = d + e.toS * 1000
        if (to >= t0 && from <= t1) out.push({ ...e, from, to })
      })
    }
    return out.sort((a, b) => a.from - b.from)
  }

  /** 监测量：GNSS / 雷达 / 水位 / 爆破振动 / 基站，按北京时间 ms */
  function monitors(ms) {
    const bj = beijing(ms)
    const D = day(bj.date)
    const sl = slopeOf(bj.date)
    const t = bj.sec
    const gnss = []
    for (let i = 0; i < 118; i++)
      gnss.push({
        id: `GN-${pad(i + 1, 3)}`,
        sector: sl.sector(i),
        ...sl.at(i, t)
      })
    const radar = ["SR-01", "SR-02", "SR-03"].map((id) => {
      const mine = gnss.filter((g) => g.sector === id)
      const v = Math.max(...mine.map((g) => g.vel)) * 0.92
      return {
        id,
        velMmH: v,
        level: v >= 3 ? 3 : v >= 1 ? 2 : v >= 0.3 ? 1 : 0,
        dispMax: Math.max(...mine.map((g) => g.disp))
      }
    })
    const gw = Array.from({ length: 23 }, (_, i) => ({
      id: `GW-${pad(i + 1)}`,
      levelM: groundwaterAt(i, bj.date, t)
    }))
    // 爆破振动：只在爆破后 30 min 内有读数
    const blastNow = t >= BLAST[0] && t < BLAST[0] + 1800
    const bv = Array.from({ length: 9 }, (_, i) => {
      const dist = 420 + 160 * i
      return {
        id: `BV-${pad(i + 1)}`,
        ppv: blastNow ? Math.round(2200 * Math.pow(dist, -1.2) * 100) / 100 : 0,
        distM: dist
      }
    })
    // 基站：脚本里有离线的那个站标记离线
    const R = rng(`bs:${bj.date}:${Math.floor(t / 600)}`)
    const bs = Array.from({ length: 12 }, (_, i) => {
      const id = `BS-${pad(i + 1)}`
      const off =
        D.script &&
        D.script.bsOff &&
        D.script.bsOff.id === id &&
        t >= D.script.bsOff.from &&
        t < D.script.bsOff.to
      return {
        id,
        online: !off,
        upMbps: off ? 0 : Math.round(520 + 420 * R()),
        terminals: off ? 0 : Math.round(6 + 6 * R())
      }
    })
    return { gnss, radar, gw, bv, bs, script: D.script }
  }

  return {
    at,
    eventsBetween,
    monitors,
    DESIGN_T,
    DT,
    FRAMES,
    ROUTES,
    SINKS,
    YARD_CAP_T,
    CAP_KWH,
    day
  }
}

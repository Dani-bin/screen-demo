/*
 * 无人机机场自动巡检 · 全天仿真
 * ----------------------------------------------------------
 * 纯 JS，不依赖 Vue / three / DOM。页面和 scripts/drone/make_mock.mjs 共用。
 *
 * 一次 simulateDay() 把某一天 00:00–24:00 整天按 1 秒步长算完，得到：
 *   - 每个机场的状态变化（空闲 / 作业准备 / 作业中 / 返航降落 / 散热 / 充电中）
 *   - 每架无人机的飞行（分段轨迹：起飞、转场、巡检、悬停、复核、返航、降落）
 *     和电量关键帧
 *   - 每趟计划的状态变化（待执行 → 执行中 → 已完成，或顺延 / 漏巡）
 *   - AI 识别出的事件和它们的处置过程（虚拟值班员按时限做决定）
 * 之后 stateAt(day, t) 取任意时刻的整屏状态：只露出 t 之前发生的事，
 * 所以回放拖到哪一刻，整屏就是哪一刻。
 *
 * 可复现：所有随机数都来自 rngFor(种子, 日期, 用途…)，同一个种子 + 日期
 * 结果完全一样；每个随机用途有自己的子序列，改一处剧情不会打乱别处。
 *
 * 剧情（story = true 时，页面对"今天"打开）：每天 14:00 前后固定上演一段，
 * 让任何时候回放到下午都能看到异常态（也是设计稿画的那一刻）：
 *   13:56–14:12  1# 机场阵风超限（最大 13.5 m/s）→ 14:00 罐区巡检顺延，
 *                风降到 10 m/s 以下持续 10 min 后 14:30 才起飞（顺延 30 min）
 *   13:58:30–14:09:10  3# 机场网络中断：6 s 后标"数据延迟"，60 s 后判离线
 *   13:59–14:09  2# 无人机 RTK 降为浮点解（位置质量"不确定"）
 *   14:00 装置区巡检第一个悬停点（2# 芳烃装置），14:01:44，激光甲烷读数 52000 ppm·m
 *                （≥ 1 LEL·m，重大）→ 无人机原地悬停监视 5 min、切红外 →
 *                值班员确认 → 派单 → 处置 → 复核 → 办结
 *
 * 数据质量：机场每 2 s、无人机每 1 s 上报一次（心跳）。超过 6 s 没收到标
 * "数据延迟"（质量 uncertain），超过 60 s 判离线（质量 bad），显示的数值
 * 停在最后一次收到的那一刻。
 *
 * 用法：
 *   const day = simulateDay({ seed: "linjiang", date: "2026-10-19", story: true })
 *   const s = stateAt(day, Date.now())   // 整屏状态（纯对象）
 *   const week = weekCounts({ seed, date, upto: s })  // 近 7 天按类型的事件数
 */

import {
  DOCKS,
  DRONES,
  NO_FLY,
  ROUTES,
  SCHEDULE,
  STORY_LEAK,
  TARGETS
} from "../data/layout.js"
import {
  EVENT_TYPES,
  LIMITS,
  NIGHT_PERIMETER_FACTOR,
  RATES
} from "../data/catalog.js"

// ---------------------------------------------------------------- 常量

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
/** 园区所在时区（北京时间），日期边界按它算 */
export const TZ = "+08:00"

/**
 * 速度（m/s）：转场 8、巡检 3（场地只有约 600 × 780 m，近距离逐点巡检）、
 * 赶赴复核 10；爬升 4、下降 3
 */
const SPEED = { transit: 8, inspect: 3, divert: 10, climb: 4, descend: 3 }
/** 作业准备：开舱 15 s + 自检 / 桨叶检测，接到任务约 45 s 后离开停机坪 */
const PREP = 45 * SEC
const LID_MOVE = 15 * SEC
/** 降落后关舱 */
const LAND_CLOSE = 20 * SEC
/** 散热时长范围（电池温度高时先制冷再充电） */
const COOL = [180, 360]
/** 飞行耗电（%/min，标称 54 min 续航留出余量），实际按起飞时风速上浮 */
const DRAIN = 1.75
/** 充电速度（%/min，15 % → 95 % 约 27 min），充到 95 % 停 */
const CHARGE = 3
const FULL = 95
/** 起飞判定：预计耗电 + 25 % 余量；复核赶赴最低也要 30 % */
const RESERVE = 25
const MIN_LAUNCH = 30
/** 阵风 ≥ 12 m/s 停飞；降到 10 m/s 以下持续 10 min 才恢复 */
const GUST_STOP = 12
const GUST_RESUME = 10
const RESUME_HOLD = 10 * MIN
/** 因天气 / 离线顺延时每 10 min 复查一次，超过 60 min 记漏巡 */
const RECHECK_WX = 10 * MIN
const RECHECK_BUSY = 1 * MIN
const POSTPONE_MAX = 60 * MIN
/** 心跳间隔与数据质量阈值 */
const BEAT = { dock: 2 * SEC, drone: 1 * SEC }
const DELAY_AFTER = 6 * SEC
const OFFLINE_AFTER = 60 * SEC
/** 复核：悬停监视时长；重大事件由发现它的无人机原地监视的时长 */
const REVIEW_HOLD = 180 * SEC
const MONITOR_MAJOR = 300 * SEC
/** 天气采样步长 */
const WX_STEP = 10 * SEC

/** 这些对象类型悬停时后半段切红外测温 */
const IR_KINDS = new Set([
  "tank",
  "sphere",
  "unit",
  "utility",
  "warehouse",
  "piperack"
])

// ---------------------------------------------------------------- 随机数

function hashStr(s) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 按用途取一条独立的随机序列 */
const rngFor = (...keys) => mulberry32(hashStr(keys.join("|")))
const uni = (r, a, b) => a + (b - a) * r()

/** 一维平滑噪声（-1 ~ 1），x 每增加 1 换一个格点 */
function noise(key, x) {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  const a = rngFor(key, i)() * 2 - 1
  const b = rngFor(key, i + 1)() * 2 - 1
  return a * (1 - u) + b * u
}

// ---------------------------------------------------------------- 几何

const dist2 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])
const dist3 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
const lerp = (a, b, k) => a + (b - a) * k
/** 航向：正北为 0°，顺时针 */
const headingOf = (a, b) =>
  ((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI + 360) % 360

/** 直线穿过火炬禁飞柱时，在禁飞圆外侧加一个绕行点 */
function detour(a, b) {
  for (const z of NO_FLY) {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy || 1
    const k = Math.max(
      0,
      Math.min(1, ((z.x - a[0]) * dx + (z.y - a[1]) * dy) / len2)
    )
    const px = a[0] + dx * k
    const py = a[1] + dy * k
    const d = Math.hypot(px - z.x, py - z.y)
    if (d < z.r) {
      // 沿"圆心 → 最近点"方向推到圆外 60 m（最近点就是圆心时取线段的法向）
      let nx = px - z.x
      let ny = py - z.y
      if (Math.hypot(nx, ny) < 1) [nx, ny] = [-dy, dx]
      const n = Math.hypot(nx, ny)
      return [
        [
          z.x + (nx / n) * (z.r + 60),
          z.y + (ny / n) * (z.r + 60),
          Math.max(a[2], b[2])
        ]
      ]
    }
  }
  return []
}

// ---------------------------------------------------------------- 时间

/** 某天 00:00（北京时间）的毫秒时间戳 */
export const dayStartOf = (date) => Date.parse(`${date}T00:00:00${TZ}`)
const at = (dayStart, hhmm) => {
  const [h, m, s = 0] = hhmm.split(":").map(Number)
  return dayStart + h * HOUR + m * MIN + s * SEC
}
/** 时间戳 → 北京时间的小时数（含小数） */
const hourOf = (t, dayStart) => (t - dayStart) / HOUR

// ---------------------------------------------------------------- 天气

/**
 * 每个机场的小气象站：风速（10 分钟平均）、阵风（3 秒最大）、风向（估算）、
 * 雨量等级、环境温湿度。按 10 s 采样预先算好整天，并按"阵风 ≥ 12 停飞、
 * 降到 10 以下持续 10 min 才恢复"的规则算出每一刻能不能飞。
 */
function makeWeather(seed, date, dayStart, story) {
  const r = rngFor(seed, date, "wx")
  const base = uni(r, 2, 4.5) // 当天的平均风（m/s）
  const dirBase = uni(r, 0, 360)
  const tmin = uni(r, 11, 15)
  const tmax = tmin + uni(r, 7, 11)
  // 约 12 % 的日子有一段小雨，其中一半夹着 30 min 中雨（会停飞）
  const rainy = !story && r() < 0.12
  const rainFrom = dayStart + uni(r, 5, 13) * HOUR
  const rainTo = rainFrom + uni(r, 0.8, 2.5) * HOUR
  const heavy = r() < 0.5
  const heavyFrom = rainFrom + (rainTo - rainFrom) * 0.4
  const heavyTo = heavyFrom + 30 * MIN
  const factor = { "DK-01": 1.15, "DK-02": 0.95, "DK-03": 1.05, "DK-04": 1 } // 1# 机场在江边，风大一些

  // 剧情：1# 机场 13:40–14:35 的阵风过程（HH:MM → m/s），见文件头
  const storyGust = [
    ["13:40", 7],
    ["13:52", 11],
    ["13:57", 12.6],
    ["14:00", 13.5],
    ["14:06", 13.2],
    ["14:11", 12.2],
    ["14:13", 11],
    ["14:16", 9.6],
    ["14:22", 8.4],
    ["14:35", 7]
  ].map(([hm, v]) => [at(dayStart, hm), v])
  const storyAt = (t) => {
    if (t < storyGust[0][0] || t > storyGust.at(-1)[0]) return 0
    for (let i = 1; i < storyGust.length; i++)
      if (t <= storyGust[i][0]) {
        const [t0, v0] = storyGust[i - 1]
        const [t1, v1] = storyGust[i]
        return lerp(v0, v1, (t - t0) / (t1 - t0))
      }
    return 0
  }

  const n = (24 * HOUR) / WX_STEP + 1
  const docks = {}
  for (const id of Object.keys(DOCKS)) {
    const wind = new Float32Array(n)
    const gust = new Float32Array(n)
    const block = new Uint8Array(n) // 0 可飞，1 阵风，2 降雨
    let grounded = false
    let calmSince = null
    for (let i = 0; i < n; i++) {
      const t = dayStart + i * WX_STEP
      const h = hourOf(t, dayStart)
      // 午后风大：日变化系数 0.75–1.2
      const diurnal = 0.75 + 0.45 * Math.exp(-(((h - 14.5) / 4) ** 2))
      const slow = noise(`${seed}|${date}|${id}|w`, (t - dayStart) / (10 * MIN))
      let w = base * diurnal * factor[id] * (1 + 0.25 * slow)
      let g =
        w *
        (1.35 + 0.15 * noise(`${seed}|${date}|${id}|g`, (t - dayStart) / MIN))
      if (story && id === "DK-01") {
        const sg = storyAt(t)
        if (sg > g) {
          g = sg
          w = sg / 1.4
        }
      }
      wind[i] = w
      gust[i] = g
      // 停飞 / 恢复的滞回：≥ 12 立即停飞；< 10 持续 10 min 才恢复
      if (g >= GUST_STOP) {
        grounded = true
        calmSince = null
      } else if (grounded) {
        if (g < GUST_RESUME) {
          if (calmSince === null) calmSince = t
          if (t - calmSince >= RESUME_HOLD) grounded = false
        } else calmSince = null
      }
      const rain = rainLevelAt(t)
      block[i] = grounded ? 1 : rain >= 2 ? 2 : 0
    }
    docks[id] = { wind, gust, block }
  }

  function rainLevelAt(t) {
    if (!rainy || t < rainFrom || t > rainTo) return 0
    return heavy && t >= heavyFrom && t <= heavyTo ? 2 : 1
  }

  const idx = (t) =>
    Math.max(0, Math.min(n - 1, Math.round((t - dayStart) / WX_STEP)))
  return {
    /** 某机场某时刻的气象读数 */
    at(id, t) {
      const d = docks[id]
      const i = idx(t)
      const h = hourOf(t, dayStart)
      const temp =
        tmin +
        (tmax - tmin) * (0.5 - 0.5 * Math.cos((2 * Math.PI * (h - 3)) / 24))
      const rain = rainLevelAt(t)
      const hum = 85 - ((temp - tmin) / (tmax - tmin)) * 35 + (rain ? 10 : 0)
      const dir =
        (dirBase +
          25 * noise(`${seed}|${date}|${id}|d`, (t - dayStart) / (30 * MIN)) +
          360) %
        360
      return {
        wind: d.wind[i],
        gust: d.gust[i],
        windDir: dir,
        rain,
        temp,
        humidity: Math.min(98, hum),
        block: d.block[i]
      }
    },
    /** 能不能起飞：null 表示可以，否则返回原因 */
    blockReason(id, t) {
      const b = docks[id].block[idx(t)]
      return b === 1 ? "阵风超限" : b === 2 ? "降雨" : null
    }
  }
}

// ---------------------------------------------------------------- 网络

/** 网络中断时段（剧情：3# 机场 13:58:30–14:09:10） */
function makeNetwork(dayStart, story) {
  const outages = { "DK-01": [], "DK-02": [], "DK-03": [], "DK-04": [] }
  if (story)
    outages["DK-03"].push([at(dayStart, "13:58:30"), at(dayStart, "14:09:10")])
  // 每台设备的心跳相位不同，避免所有设备在同一毫秒上报
  const phase = (id) => (hashStr(id) % 1000) * 1
  return {
    online: (dock, t) => !outages[dock].some(([a, b]) => t >= a && t < b),
    /** 最后一次收到心跳的时刻（≤ t） */
    lastBeat(dock, t, kind) {
      const o = outages[dock].find(([a, b]) => t >= a && t < b)
      const until = o ? o[0] : t
      const step = BEAT[kind]
      const p = phase(kind === "dock" ? dock : DOCKS[dock].drone) % step
      return Math.floor((until - p) / step) * step + p
    },
    outages
  }
}

// ---------------------------------------------------------------- 航迹

/**
 * 飞行 = 一串分段：{t0, t1, a, b, mode, heading, wp?, targets?, cont?, eventId?}
 * a / b 为 [x, y, z(离地)]，段内匀速直线；悬停段 a = b。
 */
function makeTrack(t0, start) {
  const segs = []
  let t = t0
  let p = start
  let heading = 0
  return {
    segs,
    get t() {
      return t
    },
    get p() {
      return p
    },
    move(b, speed, mode, extra = {}) {
      const len = dist3(p, b)
      const dt = Math.max(1 * SEC, (len / speed) * SEC)
      if (dist2(p, b) > 0.5) heading = headingOf(p, b)
      segs.push({ t0: t, t1: t + dt, a: p, b, mode, heading, ...extra })
      t += dt
      p = b
    },
    /** 带禁飞柱绕行的移动 */
    go(b, speed, mode, extra = {}) {
      for (const via of detour(p, b)) this.move(via, speed, mode, extra)
      this.move(b, speed, mode, extra)
    },
    hold(ms, mode, extra = {}) {
      segs.push({ t0: t, t1: t + ms, a: p, b: p, mode, heading, ...extra })
      t += ms
    }
  }
}

/** 计划航线的整段飞行（从起飞那一刻开始） */
function routeTrack(routeId, t0) {
  const route = ROUTES[routeId]
  const d = DOCKS[route.dock]
  const wps = route.wps
  const tr = makeTrack(t0, [d.x, d.y, d.roof])
  tr.move([d.x, d.y, wps[0][2]], SPEED.climb, "takeoff")
  wps.forEach(([x, y, z, hover, targets], i) => {
    tr.go(
      [x, y, z],
      i === 0 ? SPEED.transit : SPEED.inspect,
      i === 0 ? "transit" : "inspect",
      { wp: i }
    )
    if (hover > 0) tr.hold(hover * SEC, "hover", { wp: i, targets })
  })
  tr.go([d.x, d.y, wps.at(-1)[2]], SPEED.transit, "return")
  tr.move([d.x, d.y, d.roof], SPEED.descend, "landing")
  return tr.segs
}

/** 观察某点用的高度：装置区塔器最高约 101 m，取 130 m；其余 50 m */
const watchAlt = (target) => (TARGETS[target]?.kind === "unit" ? 130 : 50)

/** 从机场起飞去复核：爬升 → 赶赴 → 悬停监视 → 返航 → 降落 */
function reviewTrack(dockId, t0, point, eventId, target) {
  const d = DOCKS[dockId]
  const z = watchAlt(target)
  const tr = makeTrack(t0, [d.x, d.y, d.roof])
  tr.move([d.x, d.y, z], SPEED.climb, "takeoff")
  tr.go([point[0], point[1], z], SPEED.divert, "divert")
  tr.hold(REVIEW_HOLD, "monitor", { eventId, targets: [target], review: true })
  tr.go([d.x, d.y, z], SPEED.divert, "return")
  tr.move([d.x, d.y, d.roof], SPEED.descend, "landing")
  return tr.segs
}

const segAt = (segs, t) => {
  for (let i = 0; i < segs.length; i++) if (t < segs[i].t1) return i
  return segs.length - 1
}
const posOn = (seg, t) => {
  const k =
    seg.t1 > seg.t0
      ? Math.max(0, Math.min(1, (t - seg.t0) / (seg.t1 - seg.t0)))
      : 1
  return [
    lerp(seg.a[0], seg.b[0], k),
    lerp(seg.a[1], seg.b[1], k),
    lerp(seg.a[2], seg.b[2], k)
  ]
}

/** 在 t 时刻把当前段切开，插入 extra 段，后面的段整体顺延 */
function insertAt(flight, t, build) {
  const segs = flight.segs
  const i = segAt(segs, t)
  const seg = segs[i]
  const p = posOn(seg, t)
  const head = { ...seg, t1: t, b: p }
  const tail = { ...seg, t0: t, a: p, cont: true }
  const tr = makeTrack(t, p)
  build(tr, p)
  const dt = tr.t - t
  const rest = [tail, ...segs.slice(i + 1)].map((s) => ({
    ...s,
    t0: s.t0 + dt,
    t1: s.t1 + dt
  }))
  flight.segs = [...segs.slice(0, i), head, ...tr.segs, ...rest]
  flight.landAt = flight.segs.at(-1).t1
}

/** 在 t 时刻放弃剩余航线，直接返航（电量不够断点续飞时） */
function returnFrom(flight, t, build) {
  const segs = flight.segs
  const i = segAt(segs, t)
  const p = posOn(segs[i], t)
  const d = DOCKS[flight.dock]
  const tr = makeTrack(t, p)
  build(tr, p)
  tr.go([d.x, d.y, tr.p[2]], SPEED.transit, "return")
  tr.move([d.x, d.y, d.roof], SPEED.descend, "landing")
  flight.segs = [...segs.slice(0, i), { ...segs[i], t1: t, b: p }, ...tr.segs]
  flight.landAt = flight.segs.at(-1).t1
  flight.partial = true
}

/** 截至 t 飞过的距离（m，三维） */
function flownDistance(flight, t) {
  let s = 0
  for (const seg of flight.segs) {
    if (t <= seg.t0) break
    s += dist3(seg.a, t >= seg.t1 ? seg.b : posOn(seg, t))
  }
  return s
}

/** 各航线的标称飞行时长（min），用于起飞前判断电量够不够 */
export const ROUTE_MIN = Object.fromEntries(
  Object.keys(ROUTES).map((id) => {
    const segs = routeTrack(id, 0)
    return [id, segs.at(-1).t1 / MIN]
  })
)

// ---------------------------------------------------------------- 事件

/** 一次悬停拍照时 AI 报出的事件（不含剧情事件） */
function drawEvents(rand, seg, droneId, t0, dayStart) {
  const out = []
  const h = hourOf(t0, dayStart)
  const night = h >= 19 || h < 6
  const payload = DRONES[droneId].payload
  const kinds = new Map()
  for (const id of seg.targets) {
    const k = TARGETS[id].kind
    if (!kinds.has(k)) kinds.set(k, [])
    kinds.get(k).push(id)
  }
  for (const [kind, ids] of kinds) {
    for (const [type, p] of Object.entries(RATES[kind] || {})) {
      const need = EVENT_TYPES[type].need
      if (need && !payload.includes(need)) continue
      const prob =
        type === "perimeter" && night ? p * NIGHT_PERIMETER_FACTOR : p
      if (rand() >= prob) continue
      const target = ids[Math.floor(rand() * ids.length)]
      const dur = seg.t1 - seg.t0
      out.push({
        type,
        target,
        t:
          t0 +
          Math.min(
            dur - 2 * SEC,
            5 * SEC + rand() * Math.max(0, dur - 10 * SEC)
          ),
        night
      })
    }
  }
  return out
}

/** 事件点：对象范围内的随机位置（线状对象取航点附近的一段） */
function eventPoint(rand, target, near) {
  const tg = TARGETS[target]
  if (tg.line) {
    const [[x0, y0], [x1, y1]] = tg.line
    const dx = x1 - x0
    const dy = y1 - y0
    const len = Math.hypot(dx, dy)
    const k0 = Math.max(
      0,
      Math.min(1, ((near[0] - x0) * dx + (near[1] - y0) * dy) / (len * len))
    )
    const k = Math.max(0, Math.min(1, k0 + ((rand() - 0.5) * 300) / len))
    return [x0 + dx * k, y0 + dy * k]
  }
  if (tg.kind === "tank" || tg.kind === "sphere") {
    const a = rand() * Math.PI * 2
    return [tg.x + Math.cos(a) * tg.r, tg.y + Math.sin(a) * tg.r]
  }
  const a = rand() * Math.PI * 2
  const d = tg.r * 0.8 * Math.sqrt(rand())
  return [tg.x + Math.cos(a) * d, tg.y + Math.sin(a) * d]
}

/** 读数与等级（阈值见 catalog.js 头部注释和 02-research.md） */
function gradeEvent(rand, type, target, night) {
  const kind = TARGETS[target].kind
  switch (type) {
    case "fire":
      return { level: "major", reading: Math.round(uni(rand, 180, 520)) }
    case "gas": {
      // 净读数 500 ppm·m 起报；5000 较大；50000（1 LEL·m）重大
      const v = Math.round(500 * 10 ** (rand() ** 1.8 * 2.1))
      return {
        level: v >= 50000 ? "major" : v >= 5000 ? "serious" : "general",
        reading: v
      }
    }
    case "temp": {
      if (kind === "sphere")
        return { level: "serious", reading: -Math.round(uni(rand, 10, 25)) } // 液化烃冷点
      const dt = Math.round(10 + 24 * rand() ** 2)
      return {
        level: dt >= 30 ? "major" : dt >= 20 ? "serious" : "general",
        reading: dt
      }
    }
    case "insulation":
      return { level: "general", reading: Math.round(uni(rand, 50, 85)) }
    case "leak":
      return {
        level: kind === "tank" || kind === "sphere" ? "serious" : "general",
        reading: null
      }
    case "hotwork":
      return {
        level:
          kind === "tank" || kind === "sphere" || night ? "major" : "serious",
        reading: null
      }
    case "intrusion":
    case "perimeter":
      return { level: "serious", reading: null }
    case "parking":
      return {
        level: kind === "loading" ? "serious" : "general",
        reading: Math.round(uni(rand, 10, 45))
      }
    default:
      return { level: "general", reading: null }
  }
}

/** 真事件的 AI 置信度偏高，误报偏低（两者有重叠，值班员要看图判断） */
const confOf = (rand, isFalse) =>
  +(isFalse ? uni(rand, 0.55, 0.86) : 0.72 + 0.25 * rand() ** 0.7).toFixed(2)

// ---------------------------------------------------------------- 全天仿真

/**
 * @param {object} o
 * @param {string} [o.seed] 随机种子
 * @param {string} o.date 北京时间日期 YYYY-MM-DD
 * @param {boolean} [o.story] 是否上演 14:00 的剧情（页面对"今天"打开）
 * @param {Array<{t: number, type: "review"|"confirm"|"false", eventId: string}>} [o.actions]
 *   用户在页面上的操作（派无人机复核 / 派单 / 判误报），会改写之后的过程
 */
export function simulateDay({
  seed = "linjiang",
  date,
  story = false,
  actions = []
}) {
  const dayStart = dayStartOf(date)
  const dayEnd = dayStart + 24 * HOUR
  const wx = makeWeather(seed, date, dayStart, story)
  const net = makeNetwork(dayStart, story)

  // ---- 计划
  const plan = []
  for (const [route, times] of Object.entries(SCHEDULE))
    for (const hm of times) {
      const t = at(dayStart, hm)
      plan.push({
        id: `${route}@${hm}`,
        route,
        dock: ROUTES[route].dock,
        plannedAt: t,
        nextCheck: t,
        history: [{ t: dayStart, s: "pending" }],
        status: "pending",
        reason: null
      })
    }
  plan.sort((a, b) => a.plannedAt - b.plannedAt)
  const setPlan = (p, t, s, reason = null) => {
    p.status = s
    p.reason = reason
    p.history.push({ t, s, reason })
  }

  // ---- 机场与无人机
  const docks = {}
  const drones = {}
  for (const [id, d] of Object.entries(DOCKS)) {
    docks[id] = {
      id,
      state: "idle",
      history: [{ t: dayStart, s: "idle" }],
      until: 0,
      plans: plan.filter((p) => p.dock === id),
      nextCheck: dayStart
    }
    drones[d.drone] = {
      id: d.drone,
      dock: id,
      flights: [],
      flight: null,
      bk: [{ t: dayStart, v: FULL }],
      rate: 0
    }
  }
  const setDock = (d, t, s) => {
    d.state = s
    d.history.push({ t, s })
  }
  /** 电量：关键帧之间按当前速率线性变化（飞行耗电 / 充电） */
  const battery = (u, t) => {
    const k = u.bk.at(-1)
    return Math.max(0, Math.min(FULL, k.v + (u.rate * (t - k.t)) / MIN))
  }
  const setRate = (u, t, rate) => {
    u.bk.push({ t, v: battery(u, t) })
    u.rate = rate
  }

  // ---- 事件与处置队列
  const events = []
  const queue = [] // {at, run}
  const later = (t, run) => {
    queue.push({ at: t, run })
    queue.sort((a, b) => a.at - b.at)
  }
  const status = (e, t, s) => {
    e.status = s
    e.history.push({ t, s })
  }
  let evtNo = 0

  // 起飞：机场进入作业准备，45 s 后离开停机坪
  function launch(dock, t, kind, ref, segsAt) {
    const u = drones[DOCKS[dock.id].drone]
    setDock(dock, t, "prep")
    const takeoff = t + PREP
    const w = wx.at(dock.id, t).wind
    const flight = {
      id: kind === "plan" ? ref.id : `RV-${ref.id}`,
      kind,
      route: kind === "plan" ? ref.route : null,
      plan: kind === "plan" ? ref : null,
      eventId: kind === "review" ? ref.id : null,
      dock: dock.id,
      drone: u.id,
      prepAt: t,
      takeoffAt: takeoff,
      segs: segsAt(takeoff),
      // 起飞时风越大越费电
      drain: DRAIN * (1 + 0.03 * Math.max(0, w - 4)),
      // 夜间计划全程红外
      night: hourOf(t, dayStart) >= 19 || hourOf(t, dayStart) < 6,
      entered: -1
    }
    flight.landAt = flight.segs.at(-1).t1
    dock.pending = flight
    u.flights.push(flight)
    // 接到任务就停止充电
    setRate(u, t, 0)
    if (kind === "plan") setPlan(ref, t, "running")
    return flight
  }

  // 找最近的可用无人机去复核：舱内可起飞的，或在飞且电量够绕一趟的
  function requestReview(e, t) {
    if (e.review || e.status !== "pending") return
    const point = [e.x, e.y]
    let best = null
    for (const dock of Object.values(docks)) {
      const u = drones[DOCKS[dock.id].drone]
      const dd = DOCKS[dock.id]
      if (!net.online(dock.id, t)) continue
      const z = watchAlt(e.target)
      if (!u.flight && (dock.state === "idle" || dock.state === "charging")) {
        if (wx.blockReason(dock.id, t)) continue
        const there = dist2([dd.x, dd.y], point)
        const needMin =
          ((2 * there) / SPEED.divert + REVIEW_HOLD / SEC) / 60 + 2
        if (battery(u, t) < Math.max(MIN_LAUNCH, needMin * DRAIN + RESERVE))
          continue
        const eta =
          PREP / SEC + (z - dd.roof) / SPEED.climb + there / SPEED.divert
        if (!best || eta < best.eta) best = { eta, dock, u, inAir: false }
      } else if (u.flight && u.flight.kind === "plan" && !u.flight.diverted) {
        const seg = u.flight.segs[segAt(u.flight.segs, t)]
        if (
          seg.mode === "takeoff" ||
          seg.mode === "landing" ||
          seg.mode === "return"
        )
          continue
        const p = posOn(seg, t)
        const there = dist2(p, point)
        const home = dist2(point, [dd.x, dd.y])
        const needMin =
          ((there + home) / SPEED.divert + REVIEW_HOLD / SEC) / 60 + 1
        if (battery(u, t) - needMin * u.flight.drain < RESERVE) continue
        const eta = there / SPEED.divert
        if (!best || eta < best.eta) best = { eta, dock, u, inAir: true }
      }
    }
    if (!best) {
      // 没有可用的无人机：值班员只能看抓拍判断，3–6 min 后决定
      e.review = { none: true, requestedAt: t }
      const r = rngFor(seed, date, e.id, "noreview")
      later(t + uni(r, 3, 6) * MIN, (tt) => decide(e, tt))
      return
    }
    e.review = { requestedAt: t, drone: best.u.id, dock: best.dock.id }
    if (best.inAir) {
      const f = best.u.flight
      f.diverted = true
      e.review.sortie = f.id
      const z = watchAlt(e.target)
      const visit = (tr) => {
        tr.go([point[0], point[1], z], SPEED.divert, "divert")
        tr.hold(REVIEW_HOLD, "monitor", {
          eventId: e.id,
          targets: [e.target],
          review: true
        })
      }
      // 先试"复核完回到断点继续飞"（断点续飞）；电量不够飞完剩下的航线，就从复核点直接返航
      const trial = { ...f, segs: f.segs.slice() }
      insertAt(trial, t, (tr, p) => {
        visit(tr)
        tr.go(p, SPEED.divert, "transit")
      })
      const endBattery =
        battery(best.u, t) - ((trial.landAt - t) / MIN) * f.drain
      if (endBattery >= 15) {
        f.segs = trial.segs
        f.landAt = trial.landAt
      } else returnFrom(f, t, visit)
    } else {
      const f = launch(best.dock, t, "review", e, (t0) =>
        reviewTrack(best.dock.id, t0, point, e.id, e.target)
      )
      e.review.sortie = f.id
    }
  }

  // 值班员决定：误报关闭，或确认并派单，随后按时限推进处置
  function decide(e, t) {
    if (e.status !== "pending") return
    if (e.isFalse) return status(e, t, "false")
    status(e, t, "dispatched")
    const r = rngFor(seed, date, e.id, "flow")
    // 处置时长（min）：重大当班处置完，较大、一般大多在半天内办结（假设）
    const handleMin = {
      major: [20, 60],
      serious: [30, 150],
      general: [40, 240]
    }[e.level]
    const t1 = t + uni(r, 2, 10) * MIN
    const t2 = t1 + uni(r, ...handleMin) * MIN
    const t3 = t2 + uni(r, 10, 40) * MIN
    later(t1, (tt) => status(e, tt, "handling"))
    later(t2, (tt) => status(e, tt, "reviewing"))
    if (r() < 0.05) {
      // 复核不通过，退回重新处置
      const t4 = t3 + uni(r, 20, 60) * MIN
      later(t3, (tt) => status(e, tt, "handling"))
      later(t4, (tt) => status(e, tt, "reviewing"))
      later(t4 + uni(r, 10, 30) * MIN, (tt) => status(e, tt, "closed"))
    } else later(t3, (tt) => status(e, tt, "closed"))
  }

  // 新事件：登记、决定要不要复核、安排值班员何时处理
  function addEvent(spec, flight, seg, t, rand) {
    const id = `SJ${date.replaceAll("-", "")}-${String(++evtNo).padStart(4, "0")}`
    const isFalse = spec.isFalse ?? rand() < EVENT_TYPES[spec.type].fa
    const grade = spec.level
      ? spec
      : gradeEvent(rand, spec.type, spec.target, spec.night)
    const [x, y] = spec.point || eventPoint(rand, spec.target, seg.a)
    const tg = TARGETS[spec.target]
    const e = {
      id,
      type: spec.type,
      level: grade.level,
      reading: grade.reading,
      conf: spec.conf ?? confOf(rand, isFalse),
      isFalse,
      target: spec.target,
      zone: tg.zone,
      unit: tg.unit,
      x,
      y,
      detectedAt: t,
      drone: flight.drone,
      dock: flight.dock,
      sortie: flight.id,
      cam: EVENT_TYPES[spec.type].cam,
      // 重大事件联动消防站 / 气防站
      linked: grade.level === "major" ? ["FS-1"] : [],
      history: [{ t, s: "pending" }],
      status: "pending",
      review: null,
      story: !!spec.story
    }
    events.push(e)
    const r = rngFor(seed, date, id, "op")
    if (e.level === "major") {
      // 重大：发现它的无人机原地悬停监视（电量够的话），值班员看实时画面确认
      const u = drones[flight.drone]
      const left =
        battery(u, t) -
        ((flight.landAt - t) / MIN + MONITOR_MAJOR / MIN) * flight.drain
      if (left >= 15 && !flight.diverted) {
        insertAt(flight, t, (tr) =>
          tr.hold(MONITOR_MAJOR, "monitor", {
            eventId: id,
            targets: [e.target]
          })
        )
        e.review = {
          drone: flight.drone,
          dock: flight.dock,
          sortie: flight.id,
          requestedAt: t,
          self: true
        }
      }
      later(t + (spec.decideAfter ?? uni(r, 40, 100)) * SEC, (tt) =>
        decide(e, tt)
      )
      return e
    }
    const needReview =
      (e.level === "serious" && (e.conf < 0.85 || r() < 0.3)) ||
      (e.level === "general" && e.conf < 0.66 && r() < 0.5)
    if (needReview)
      later(t + uni(r, 20, 60) * SEC, (tt) => requestReview(e, tt))
    else {
      const base = { serious: [60, 240], general: [120, 720] }[e.level]
      // 约 8 % 的事件值班员没及时处理，会超时督办
      const slow = r() < 0.08 ? 2.5 : 1
      later(t + uni(r, ...base) * slow * SEC, (tt) => decide(e, tt))
    }
    return e
  }

  // 用户操作：按时间排进处置队列（同一时刻比虚拟值班员优先）
  for (const a of actions)
    later(a.t, (tt) => {
      const e = events.find((x) => x.id === a.eventId)
      if (!e || e.status !== "pending") return
      if (a.type === "review") requestReview(e, tt)
      else if (a.type === "false") status(e, tt, "false")
      else if (a.type === "confirm") {
        e.isFalse = false
        decide(e, tt)
      }
    })

  // 剧情事件的参数
  const STORY_SORTIE = "RT-21@14:00"
  const STORY_WP = 0

  // ---- 1 秒步长跑整天
  for (let t = dayStart; t < dayEnd; t += SEC) {
    // 处置队列
    while (queue.length && queue[0].at <= t) queue.shift().run(t)

    for (const dock of Object.values(docks)) {
      const u = drones[DOCKS[dock.id].drone]
      // -- 状态推进
      if (dock.state === "prep" && t >= dock.pending.takeoffAt) {
        const f = dock.pending
        dock.pending = null
        u.flight = f
        setRate(u, t, -f.drain)
        setDock(dock, t, "working")
      }
      if (u.flight) {
        const f = u.flight
        // 进入新的分段：悬停拍照时出事件
        for (
          let i = f.entered + 1;
          i < f.segs.length && f.segs[i].t0 <= t;
          i++
        ) {
          f.entered = i
          const seg = f.segs[i]
          if (seg.mode !== "hover" || seg.cont || !seg.targets?.length) continue
          const rand = rngFor(seed, date, f.id, "wp", seg.wp, f.kind)
          // 事件到发现的那一刻才登记（编号按发现先后排）
          if (story && f.id === STORY_SORTIE && seg.wp === STORY_WP) {
            const spec = {
              type: "gas",
              target: "U-2",
              level: "major",
              reading: 52000,
              conf: 0.91,
              isFalse: false,
              point: [STORY_LEAK.x, STORY_LEAK.y],
              decideAfter: 90,
              story: true
            }
            // 到点悬停 9 s 后 AI 识别出泄漏：14:01:35 到点 → 14:01:44 发现（定稿 14:03 时确认倒计时剩 44 s）
            later(Math.round(seg.t0 / SEC) * SEC + 9 * SEC, (tt) =>
              addEvent(spec, f, seg, tt, rand)
            )
            continue
          }
          for (const spec of drawEvents(rand, seg, f.drone, seg.t0, dayStart))
            later(Math.round(spec.t / SEC) * SEC, (tt) =>
              addEvent(spec, f, seg, tt, rand)
            )
        }
        // 复核悬停结束：值班员看回传画面后决定
        for (const seg of f.segs)
          if (seg.review && !seg.done && t >= seg.t1) {
            seg.done = true
            const e = events.find((x) => x.id === seg.eventId)
            if (e) {
              e.review.doneAt = t
              later(
                t + uni(rngFor(seed, date, e.id, "rv"), 20, 60) * SEC,
                (tt) => decide(e, tt)
              )
            }
          }
        const landSeg = f.segs.at(-1)
        if (dock.state === "working" && t >= landSeg.t0 - LID_MOVE)
          setDock(dock, t, "landing")
        if (t >= f.landAt) {
          // 落地：记一笔电量，飞行结束
          setRate(u, t, 0)
          u.flight = null
          dock.until = t + LAND_CLOSE
          if (f.plan) setPlan(f.plan, t, f.partial ? "partial" : "done")
          f.landed = true
        }
      }
      if (dock.state === "landing" && !u.flight && t >= dock.until) {
        setDock(dock, t, "cooling")
        dock.until =
          t + uni(rngFor(seed, date, dock.id, "cool", t), ...COOL) * SEC
      }
      if (dock.state === "cooling" && t >= dock.until) {
        if (battery(u, t) < FULL) {
          setDock(dock, t, "charging")
          setRate(u, t, CHARGE)
        } else setDock(dock, t, "idle")
      }
      if (dock.state === "charging" && battery(u, t) >= FULL) {
        setRate(u, t, 0)
        u.bk.at(-1).v = FULL
        setDock(dock, t, "idle")
      }

      // -- 计划任务：到点检查能不能飞（只在本机场最早的检查时刻到了才扫一遍）
      if (t < dock.nextCheck) continue
      const open = dock.plans.filter(
        (x) => x.status === "pending" || x.status === "postponed"
      )
      dock.nextCheck = open.length
        ? Math.min(...open.map((x) => x.nextCheck))
        : Infinity
      const p = open.find((x) => x.nextCheck <= t)
      if (!p) continue
      dock.nextCheck = t + SEC // 处理完这一趟，下一秒再看有没有别的到点任务
      const online = net.online(dock.id, t)
      const wxBlock = wx.blockReason(dock.id, t)
      const need = ROUTE_MIN[p.route] * DRAIN + RESERVE
      let reason = null
      let recheck = RECHECK_WX
      if (!online) reason = "机场离线"
      else if (wxBlock) reason = wxBlock
      else if (u.flight || dock.state === "prep") {
        reason = u.flight?.kind === "review" ? "执行复核任务" : "机场作业中"
        recheck = RECHECK_BUSY
      } else if (dock.state === "landing" || dock.state === "cooling") {
        reason = "散热中"
        recheck = RECHECK_BUSY
      } else if (battery(u, t) < need) {
        reason = "等待充电"
        recheck = RECHECK_BUSY
      }
      if (!reason) {
        launch(dock, t, "plan", p, (t0) => routeTrack(p.route, t0))
        continue
      }
      if (t - p.plannedAt >= POSTPONE_MAX) setPlan(p, t, "missed", reason)
      else if (p.status !== "postponed" || p.reason !== reason)
        setPlan(p, t, "postponed", reason)
      p.nextCheck = t + recheck
    }
  }
  for (const u of Object.values(drones)) setRate(u, dayEnd, u.rate)

  return {
    seed,
    date,
    story,
    dayStart,
    dayEnd,
    wx,
    net,
    plan,
    docks,
    drones,
    events
  }
}

// ---------------------------------------------------------------- 取某一刻的状态

const lastAt = (hist, t) => {
  let h = hist[0]
  for (const x of hist) {
    if (x.t > t) break
    h = x
  }
  return h
}

function batteryAt(u, t) {
  const bk = u.bk
  let i = 0
  while (i + 1 < bk.length && bk[i + 1].t <= t) i++
  const a = bk[i]
  const b = bk[i + 1]
  if (!b) return a.v
  return lerp(a.v, b.v, (t - a.t) / (b.t - a.t || 1))
}

/** 舱盖：作业准备前 15 s 打开，起飞 20 s 后关上；降落前 15 s 打开，落地 20 s 后关上 */
function lidAt(dockState, f, t) {
  if (dockState === "prep") return t - f.prepAt < LID_MOVE ? "opening" : "open"
  if (f && t >= f.takeoffAt && t < f.takeoffAt + LAND_CLOSE) return "closing"
  if (dockState === "landing") {
    const land = f?.segs.at(-1)
    if (f && t < land.t0) return "opening"
    if (f && t >= f.landAt) return "closing"
    return "open"
  }
  return "closed"
}

/** 飞机所在的飞行（含作业准备阶段） */
const flightAt = (u, t) =>
  u.flights.find((f) => t >= f.prepAt && t < f.landAt + LAND_CLOSE) || null

/** 机场与无人机的"真实"状态（不考虑网络） */
function rawDevice(day, dockId, t) {
  const dk = day.docks[dockId]
  const u = day.drones[DOCKS[dockId].drone]
  const state = lastAt(dk.history, t).s
  const f =
    flightAt(u, t) ||
    (state === "prep"
      ? u.flights.find((x) => x.prepAt <= t && x.takeoffAt > t)
      : null)
  const w = day.wx.at(dockId, t)
  const block = day.wx.blockReason(dockId, t)
  const bat = batteryAt(u, t)
  const cr = rngFor(day.seed, day.date, dockId, "cabin")
  const cabinTemp =
    24 +
    1.5 *
      noise(
        `${day.seed}|${day.date}|${dockId}|ct`,
        (t - day.dayStart) / (20 * MIN)
      ) +
    (state === "charging" ? 2 : 0) +
    cr() * 0.5
  const cabinHum =
    45 +
    5 *
      noise(
        `${day.seed}|${day.date}|${dockId}|ch`,
        (t - day.dayStart) / (30 * MIN)
      )

  // 无人机
  let drone = {
    state: "docked",
    x: DOCKS[dockId].x,
    y: DOCKS[dockId].y,
    z: DOCKS[dockId].roof,
    speed: 0,
    vspeed: 0,
    heading: 0,
    cam: "visible",
    gimbalPitch: -90,
    sortie: null,
    route: null,
    progress: 0,
    mode: null,
    eventId: null
  }
  if (f && t >= f.takeoffAt && t < f.landAt) {
    const i = segAt(f.segs, t)
    const seg = f.segs[i]
    const p = posOn(seg, t)
    const dt = (seg.t1 - seg.t0) / SEC
    const hspeed = dt > 0 ? dist2(seg.a, seg.b) / dt : 0
    const vspeed = dt > 0 ? (seg.b[2] - seg.a[2]) / dt : 0
    const mode =
      seg.mode === "hover" || seg.mode === "monitor" ? seg.mode : seg.mode
    // 相机：夜间全程红外；悬停测温对象的后半段、红外类事件的监视段切红外
    let cam = f.night ? "ir" : "visible"
    const tg = seg.targets?.[0] && TARGETS[seg.targets[0]]
    if (
      seg.mode === "hover" &&
      tg &&
      IR_KINDS.has(tg.kind) &&
      t - seg.t0 > (seg.t1 - seg.t0) / 2
    )
      cam = "ir"
    if (seg.mode === "monitor") {
      const e = day.events.find((x) => x.id === seg.eventId)
      if (e?.cam === "ir") cam = "ir"
    }
    drone = {
      state: {
        takeoff: "takeoff",
        transit: "transit",
        inspect: "inspect",
        hover: "hover",
        monitor: "monitor",
        divert: "divert",
        return: "return",
        landing: "landing"
      }[mode],
      x: p[0],
      y: p[1],
      z: p[2],
      speed: hspeed,
      vspeed,
      heading: seg.heading,
      cam,
      // 云台：悬停 / 监视时俯视对象约 −50°，巡检 −35°，转场平视 −15°
      gimbalPitch:
        seg.mode === "hover" || seg.mode === "monitor"
          ? -50
          : seg.mode === "inspect"
            ? -35
            : -15,
      sortie: f.id,
      kind: f.kind,
      route: f.route,
      progress: Math.round(
        ((t - f.takeoffAt) / (f.landAt - f.takeoffAt)) * 100
      ),
      eventId: seg.eventId || (f.kind === "review" ? f.eventId : null),
      targets: seg.targets || null
    }
  }
  const rtkFloat =
    day.story &&
    dockId === "DK-02" &&
    t >= at(day.dayStart, "13:59") &&
    t < at(day.dayStart, "14:09") &&
    drone.state !== "docked"
  return {
    state,
    lid: lidAt(state, f, t),
    battery: bat,
    charging: state === "charging",
    cabinTemp,
    cabinHum,
    wind: w.wind,
    gust: w.gust,
    windDir: w.windDir,
    rain: w.rain,
    temp: w.temp,
    humidity: w.humidity,
    block,
    drone: {
      ...drone,
      battery: bat,
      rtk: rtkFloat ? "float" : "fixed",
      remainMin: Math.max(0, (bat - 10) / DRAIN)
    }
  }
}

// ---------------------------------------------------------------- 给三维用的轻量接口

/**
 * 某机场在 t 时刻的机场状态、舱盖和无人机位姿（三维每帧调用；不考虑网络中断，
 * 画面上的飞机始终按真实轨迹动，数据面板才按心跳显示"延迟 / 离线"）
 * @returns {{dockState, lid, drone: {state, x, y, z, heading, gimbalPitch, cam, sortie, kind, route, eventId, targets, battery}}}
 */
export function poseAt(day, dockId, t) {
  const r = rawDevice(day, dockId, t)
  return { dockState: r.state, lid: r.lid, drone: r.drone }
}

/** 某架无人机 t 时刻所在的这趟飞行（含作业准备与落地后关舱），没有则为 null */
export function currentFlight(day, droneId, t) {
  return flightAt(day.drones[droneId], t)
}

/** 飞行航迹上 t 时刻的点 [x, y, z]（t 超出范围时取首尾） */
export function pointOnFlight(flight, t) {
  const segs = flight.segs
  if (t <= segs[0].t0) return [...segs[0].a]
  return posOn(segs[segAt(segs, t)], t)
}

/** 截至 t 的计数（架次、飞行时长、里程、覆盖对象） */
function countsAt(day, dockId, t) {
  const u = day.drones[DOCKS[dockId].drone]
  let sorties = 0
  let planSorties = 0
  let reviewSorties = 0
  let flightMs = 0
  let dist = 0
  const covered = new Set()
  for (const f of u.flights) {
    if (f.takeoffAt > t) continue
    sorties++
    if (f.kind === "plan") planSorties++
    else reviewSorties++
    flightMs += Math.min(t, f.landAt) - f.takeoffAt
    dist += flownDistance(f, t)
    for (const s of f.segs)
      if (s.mode === "hover" && s.t0 <= t && s.targets)
        s.targets.forEach((x) => covered.add(x))
  }
  return {
    sorties,
    planSorties,
    reviewSorties,
    flightMin: flightMs / MIN,
    distanceKm: dist / 1000,
    covered
  }
}

/** 风速 → 风级（GB/T 28591） */
export function beaufort(v) {
  const edges = [
    0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7
  ]
  let n = 0
  while (n < edges.length && v >= edges[n]) n++
  return n
}

/**
 * 整屏状态。网络中断的机场，数值停在最后一次心跳那一刻，并带上数据质量。
 * @returns 纯对象，可以直接放进 Vue 的 ref
 */
export function stateAt(day, t) {
  t = Math.max(day.dayStart, Math.min(day.dayEnd - SEC, t))
  const docks = {}
  const drones = {}
  let covered = new Set()
  for (const dockId of Object.keys(DOCKS)) {
    const seen = day.net.lastBeat(dockId, t, "dock")
    const raw = rawDevice(day, dockId, seen)
    const age = t - seen
    const q =
      age > OFFLINE_AFTER ? "bad" : age > DELAY_AFTER ? "uncertain" : "good"
    const c = countsAt(day, dockId, seen)
    c.covered.forEach((x) => covered.add(x))
    const online = day.net.online(dockId, t)
    const f = flightAt(day.drones[DOCKS[dockId].drone], seen)
    docks[dockId] = {
      id: dockId,
      state: raw.state,
      lid: raw.lid,
      charging: raw.charging,
      cabinTemp: raw.cabinTemp,
      cabinHum: raw.cabinHum,
      wind: raw.wind,
      gust: raw.gust,
      windLevel: beaufort(raw.wind),
      windDir: raw.windDir,
      rain: raw.rain,
      temp: raw.temp,
      humidity: raw.humidity,
      // 能否起飞：天气、离线、电量都算进去
      canFly:
        !raw.block &&
        online &&
        raw.drone.state === "docked" &&
        raw.battery >= MIN_LAUNCH,
      blockReason: !online
        ? "机场离线"
        : raw.block ||
          (raw.drone.state !== "docked"
            ? "无人机在外作业"
            : raw.battery < MIN_LAUNCH
              ? "电量不足"
              : null),
      online,
      lastSeen: seen,
      age: age / SEC,
      q,
      task: f ? f.id : null,
      sorties: c.sorties,
      planSorties: c.planSorties,
      reviewSorties: c.reviewSorties
    }
    // 无人机：在飞时按 1 s 心跳；在舱内时跟着机场一起离线
    const droneId = DOCKS[dockId].drone
    let dseen = day.net.lastBeat(dockId, t, "drone")
    if (!online) dseen = seen
    const rd = dseen === seen ? raw.drone : rawDevice(day, dockId, dseen).drone
    const dage = t - dseen
    const dc = dseen === seen ? c : countsAt(day, dockId, dseen)
    drones[droneId] = {
      id: droneId,
      dock: dockId,
      ...rd,
      altRel: rd.z - DOCKS[dockId].roof,
      flightMin: dc.flightMin,
      distanceKm: dc.distanceKm,
      lastSeen: dseen,
      age: dage / SEC,
      q:
        dage > OFFLINE_AFTER
          ? "bad"
          : dage > DELAY_AFTER
            ? "uncertain"
            : "good",
      // RTK 浮点解时位置质量"不确定"
      posQ:
        rd.rtk === "float"
          ? "uncertain"
          : dage > OFFLINE_AFTER
            ? "bad"
            : dage > DELAY_AFTER
              ? "uncertain"
              : "good"
    }
  }

  // 计划
  const plan = day.plan.map((p) => {
    const h = lastAt(p.history, t)
    const f = Object.values(day.drones)
      .flatMap((u) => u.flights)
      .find((x) => x.plan === p && x.prepAt <= t)
    const postponedFrom = p.history.find((x) => x.s === "postponed" && x.t <= t)
    return {
      id: p.id,
      route: p.route,
      dock: p.dock,
      plannedAt: p.plannedAt,
      status: h.s,
      reason: h.reason || null,
      startedAt: f && f.takeoffAt <= t ? f.takeoffAt : null,
      endedAt: f && f.landAt <= t ? f.landAt : null,
      // 实际起飞比计划晚了多少分钟（顺延）
      delayMin:
        f && postponedFrom
          ? Math.round((f.prepAt - p.plannedAt) / MIN)
          : postponedFrom
            ? Math.round((t - p.plannedAt) / MIN)
            : 0
    }
  })

  // 事件：只露出 t 之前发现的，状态取 t 时刻
  const events = day.events
    .filter((e) => e.detectedAt <= t)
    .map((e) => {
      const history = e.history.filter((h) => h.t <= t)
      const s = history.at(-1).s
      const dispatched = history.find((h) => h.s === "dispatched")
      const lim = LIMITS[e.level]
      const overdue =
        (s === "pending" && t - e.detectedAt > lim.confirm * SEC) ||
        (dispatched && s !== "closed" && t - dispatched.t > lim.close * SEC)
      return {
        id: e.id,
        type: e.type,
        level: e.level,
        reading: e.reading,
        conf: e.conf,
        target: e.target,
        zone: e.zone,
        unit: e.unit,
        x: e.x,
        y: e.y,
        detectedAt: e.detectedAt,
        drone: e.drone,
        dock: e.dock,
        sortie: e.sortie,
        cam: e.cam,
        linked: e.linked,
        status: s,
        history,
        overdue: !!overdue,
        review:
          e.review && e.review.requestedAt <= t
            ? {
                ...e.review,
                doneAt: e.review.doneAt <= t ? e.review.doneAt : null
              }
            : null,
        story: e.story
      }
    })
    .reverse() // 最新的在前

  // KPI：从各设备的计数和事件明细算出来，不写死
  const dockList = Object.values(docks)
  const droneList = Object.values(drones)
  const sum = (arr, k) => arr.reduce((s, x) => s + x[k], 0)
  const cnt = (s) => events.filter((e) => e.status === s).length
  const plannedTargets = new Set(
    Object.values(ROUTES).flatMap((r) => r.wps.flatMap((w) => w[4]))
  )
  const pending = cnt("pending")
  const dispatched = cnt("dispatched")
  const handling = cnt("handling")
  const reviewing = cnt("reviewing")
  const closed = cnt("closed")
  const falseN = cnt("false")
  const inProgress = dispatched + handling + reviewing
  const done = plan.filter(
    (p) => p.status === "done" || p.status === "partial"
  ).length
  const missed = plan.filter((p) => p.status === "missed").length
  const kpi = {
    sorties: sum(dockList, "sorties"),
    planSorties: sum(dockList, "planSorties"),
    reviewSorties: sum(dockList, "reviewSorties"),
    flightMin: sum(droneList, "flightMin"),
    distanceKm: sum(droneList, "distanceKm"),
    planTotal: plan.length,
    planDone: done,
    planMissed: missed,
    planPostponed: plan.filter((p) => p.status === "postponed").length,
    planRunning: plan.filter((p) => p.status === "running").length,
    // 计划完成率 = 已完成 ÷（已完成 + 漏巡）：还没到点、正在执行或顺延中的不进分母
    planRate: done + missed ? done / (done + missed) : 1,
    coveredTargets: [...covered].filter((x) => plannedTargets.has(x)).length,
    coverTotal: plannedTargets.size,
    coverage: 0,
    eventTotal: events.length,
    pending,
    dispatched,
    handling,
    reviewing,
    inProgress,
    closed,
    falseAlarm: falseN,
    valid: pending + inProgress + closed,
    // 处置率 = 已办结 ÷（总数 − 误报）；误报率 = 误报 ÷（已确认 + 误报）
    disposalRate: 0,
    falseRate: 0,
    major: events.filter((e) => e.level === "major").length,
    serious: events.filter((e) => e.level === "serious").length,
    general: events.filter((e) => e.level === "general").length,
    overdue: events.filter((e) => e.overdue).length
  }
  kpi.coverage = kpi.coveredTargets / kpi.coverTotal
  kpi.disposalRate = kpi.valid ? kpi.closed / kpi.valid : 1
  kpi.falseRate =
    inProgress + closed + falseN ? falseN / (inProgress + closed + falseN) : 0

  return { t, date: day.date, docks, drones, plan, events, kpi }
}

// ---------------------------------------------------------------- 近 7 天

const dayCache = new Map()

/** 某天按类型的事件数（整天；用于近 7 天统计，不含剧情） */
export function dayTypeCounts(seed, date) {
  const key = `${seed}|${date}`
  if (!dayCache.has(key)) {
    const d = simulateDay({ seed, date, story: false })
    const counts = {}
    for (const e of d.events) counts[e.type] = (counts[e.type] || 0) + 1
    dayCache.set(key, { date, counts, total: d.events.length })
  }
  return dayCache.get(key)
}

/** 前一天的日期字符串 */
export function shiftDate(date, days) {
  const t = dayStartOf(date) + days * 24 * HOUR + 12 * HOUR
  return new Date(t + 8 * HOUR).toISOString().slice(0, 10)
}

/**
 * 近 7 天（前 6 天整天 + 今天截至 t）按类型的事件数。
 * @param {ReturnType<typeof stateAt>} upto 今天的整屏状态
 */
export function weekCounts({ seed = "linjiang", date, upto }) {
  const days = []
  for (let i = 6; i >= 1; i--)
    days.push(dayTypeCounts(seed, shiftDate(date, -i)))
  const counts = {}
  for (const e of upto.events) counts[e.type] = (counts[e.type] || 0) + 1
  days.push({ date, counts, total: upto.events.length, today: true })
  return days
}

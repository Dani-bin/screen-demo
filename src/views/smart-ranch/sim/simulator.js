/*
 * 智慧牧场 运行仿真（演示数据）
 * ----------------------------------------------------------
 * 牧场是虚构的（莫日格勒河示范牧场），地形、影像、逐月 NDVI 是真实数据（见 layout.json）。
 *
 * 时间：大屏设定在 2026 年夏秋放牧期。把真实日期映射到 2026-07-01 … 2026-08-31 的某一天
 * （按一年中的第几天对 62 取余），时刻用真实的北京时间，所以一天里的节奏和墙上的钟一致。
 *
 * 规则（数字来源见 docs/design/smart-ranch/02-research.md，标"假设"的是演示取值）：
 *   - 羊单位：1 只成年绵羊 = 1，1 头牛 = 5；每羊单位日食干草 1.8 kg
 *   - 产草量（干重，kg/亩）= K × (NDVI − 0.15)，K 按"全场草畜平衡指数约 +5%"标定（假设，示意）
 *   - 合理载畜量 = Σ 分区面积 × 产草量 × 利用率 50% ÷ (1.8 kg × 暖季 183 天)
 *   - 草畜平衡指数 =（实际载畜量 − 合理载畜量）÷ 合理载畜量 × 100%，≤ 10% 为不过牧
 *   - 划区轮牧：每个单元 4 个分区依次放牧，一季轮 3 遍，每遍每块的放牧天数按该块的产草量分配
 *   - 羊群：05:30 出牧 → 上午在分区里采食 → 11:30–12:30 到饮水点 → 下午采食 → 20:00 回营地夜宿
 *   - 牛群：白天采食，中午饮水，夜里在饮水点附近卧息；每头牛都戴项圈，位置 = 群中心 + 各自的偏移
 *   - 告警：每 10 分钟一个时段，按日期和时段播种决定是否出事件（越界、离群、饮水点低水位、
 *     项圈低电量、项圈离线），事件持续 8–25 分钟，经历 待处理 → 已派单 → 处理中 → 已解决
 * 同一时刻算出的数据都一样（按日期播种的伪随机数），刷新页面不会跳变。
 *
 * 用法：const sim = createRanchSim(layout); const s = sim.at(Date.now())
 */

const TZ = "Asia/Shanghai"
/** 大屏设定的季节：2026 年 7–8 月 */
const SEASON_START = Date.UTC(2026, 6, 1)
const SEASON_DAYS = 62
/** 暖季放牧开始（春季休牧结束后）与暖季天数 */
const GRAZE_START = Date.UTC(2026, 4, 20)
const WARM_DAYS = 183
const DAY_MS = 86400000

/** 羊单位换算与日食量 */
const SU_CATTLE = 5
const DAILY_HAY = 1.8
/** 草场利用率、一季轮牧遍数 */
const USE_RATE = 0.5
const PASSES = 3
/** 全场目标草畜平衡指数（用来标定产草量系数 K，示意） */
const TARGET_INDEX = 0.05

/** 存栏：7 个羊群、3 个牛群（03-scope.md） */
const FLOCK_HEADS = [780, 820, 760, 700, 850, 740, 750]
const HERD_HEADS = [120, 140, 120]
/** 存栏结构比例（假设）：羊群 = 基础母羊 / 种公羊 / 育成羊 / 当年羔羊；牛群 = 基础母牛 / 种公牛 / 育肥牛 / 犊牛 */
const SHEEP_MIX = { ewe: 0.68, ram: 0.02, young: 0.11 }
const CATTLE_MIX = { cow: 0.55, bull: 0.02, steer: 0.12 }
/** 冬春舍饲期补饲的储草目标（t）：7300 羊单位 × 1.8 kg × 约 150 天 ≈ 2000 t（假设） */
const HAY_TARGET = 2000

/** 每个单元的载畜压力系数（相对合理载畜量），让各单元有高有低：U03、U06 偏高 */
const PRESSURE = [1.02, 0.96, 1.16, 1.0, 0.94, 1.13, 0.98, 1.07, 0.95, 1.03]

/** 项圈：头羊每群 3 个；牛每头 1 个（上报间隔羊 10 分钟、牛 15 分钟，见 mock.mjs 的验证时间） */
const LEAD_COLLARS = 3
/** 离线判定：超过 2 小时没有上报 */
const STALE_SEC = 7200

/** 饮水：夏季每只羊 5 L/天、每头牛 40 L/天（假设）；水罐容量 m³ */
const DRINK_L = { sheep: 5, cattle: 40 }
const TANK_M3 = { sheep: 12, cattle: 20 }

const fmtParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
})

/** 真实时刻 → 大屏设定的日期（2026-07/08）+ 北京时间的时刻 */
export function demoTime(ms = Date.now()) {
  const p = Object.fromEntries(
    fmtParts.formatToParts(new Date(ms)).map((x) => [x.type, x.value])
  )
  const realDay = Date.UTC(+p.year, +p.month - 1, +p.day)
  const doy = Math.round((realDay - Date.UTC(+p.year, 0, 1)) / DAY_MS)
  const dayStart = SEASON_START + (doy % SEASON_DAYS) * DAY_MS
  const d = new Date(dayStart)
  const hours = +p.hour + +p.minute / 60 + +p.second / 3600
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][
    d.getUTCDay()
  ]
  return {
    date: d.toISOString().slice(0, 10),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    week,
    hours,
    hm: `${p.hour}:${p.minute}`,
    hms: `${p.hour}:${p.minute}:${p.second}`,
    /** 暖季放牧第几天（从 0 起，含小数） */
    seasonDay: (dayStart - GRAZE_START) / DAY_MS + hours / 24,
    dayKey: d.toISOString().slice(0, 10)
  }
}

/**
 * 反过来：给定大屏日期（2026-07-01…08-31）和北京时间的时刻，返回一个映射到它的真实时间戳。
 * 模拟数据快照、设计稿要固定在某个时刻时用。
 */
export function msForDemo(dateStr, hours) {
  const idx = Math.round(
    (Date.parse(dateStr + "T00:00:00Z") - SEASON_START) / DAY_MS
  )
  // 2026 年里一年中的第几天对 62 取余等于 idx 的第一天；北京时间 = UTC + 8
  const realDay = Date.UTC(2026, 0, 1) + idx * DAY_MS
  return realDay + hours * 3600000 - 8 * 3600000
}

/** 按字符串播种的伪随机数 */
function rng(seed) {
  let a = 0
  for (const ch of String(seed))
    a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) >>> 0) + 1
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const smooth = (x) => x * x * (3 - 2 * x)
const clamp = (x, a, b) => Math.min(b, Math.max(a, x))
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

/** 点是否在多边形内（射线法） */
export function inPolygon(p, poly) {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (
      yi > p[1] !== yj > p[1] &&
      p[0] < xi + ((p[1] - yi) * (xj - xi)) / (yj - yi)
    )
      hit = !hit
  }
  return hit
}

/** 多边形内随机取一点（拒绝采样），离边界至少 margin 米：用"往中心收缩"近似 */
function randomIn(poly, center, rand, margin = 120) {
  let xs = poly.map((p) => p[0])
  let ys = poly.map((p) => p[1])
  const box = [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys)
  ]
  for (let k = 0; k < 60; k++) {
    const p = [
      box[0] + (box[2] - box[0]) * rand(),
      box[1] + (box[3] - box[1]) * rand()
    ]
    if (!inPolygon(p, poly)) continue
    // 往中心挪 margin，避免贴着围栏
    const d = dist(p, center)
    const q = d > margin ? lerp2(p, center, margin / d) : center
    if (inPolygon(q, poly)) return q
  }
  return center.slice()
}

/** 点到折线（多边形边）的最近点 */
function nearestOnPolygon(p, poly) {
  let best = null
  let bd = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const abx = b[0] - a[0]
    const aby = b[1] - a[1]
    const t = clamp(
      ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) /
        (abx * abx + aby * aby || 1),
      0,
      1
    )
    const q = [a[0] + abx * t, a[1] + aby * t]
    const d = dist(p, q)
    if (d < bd) {
      bd = d
      best = q
    }
  }
  return best
}

/** 按时刻表（[时刻, 点]）插值位置，段内用平滑曲线，并叠加采食时的左右游走 */
function followPlan(plan, hours, wobble, seed) {
  let i = 0
  while (i < plan.length - 1 && hours > plan[i + 1][0]) i++
  if (hours <= plan[0][0]) return plan[0][1].slice()
  if (i >= plan.length - 1) return plan[plan.length - 1][1].slice()
  const [t0, a] = plan[i]
  const [t1, b] = plan[i + 1]
  const k = smooth(clamp((hours - t0) / (t1 - t0), 0, 1))
  const p = lerp2(a, b, k)
  if (!wobble) return p
  // 垂直于前进方向的游走：几个不同周期的正弦叠加，幅度在段中间最大
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const env = Math.sin(Math.PI * k)
  const w =
    wobble *
    env *
    (Math.sin(hours * 5.1 + seed) * 0.6 +
      Math.sin(hours * 13.7 + seed * 2.3) * 0.4)
  return [p[0] + nx * w, p[1] + ny * w]
}

/**
 * 创建仿真。layout 是 prepare.py 生成的 layout.json
 */
export function createRanchSim(layout) {
  const paddocks = new Map(layout.paddocks.map((p) => [p.id, p]))
  const units = layout.units
  const water = layout.water
  const reserve = layout.reserve.polygons
  const homes = new Map(layout.homesteads.map((h) => [h.unit, h]))
  const curMonthIdx = (m) => layout.ndvi.months.indexOf(m)

  // ---------- 产草量标定 ----------
  // 用 7 月（盛草期）的 2026 年真实 NDVI 算每块分区的"产草潜力"，再按目标草畜平衡指数定系数 K
  const julIdx = curMonthIdx(7)
  const ndviOf = (p, year, idx) => p.ndvi[year][idx]
  const potential = (p) =>
    p.areaMu * Math.max(ndviOf(p, "2026", julIdx) - 0.15, 0.05)

  // 各单元的实际载畜量（羊单位）：羊群 = 头数，牛群 = 头数 × 5
  const herds = units.map((u, i) => {
    const sheep = u.kind === "sheep"
    const idx = sheep ? i : i - FLOCK_HEADS.length
    const head = sheep ? FLOCK_HEADS[idx] : HERD_HEADS[idx]
    // 结构：按比例取整，最后一类（羔羊 / 犊牛）拿余数，保证合计等于头数
    const mix = sheep ? SHEEP_MIX : CATTLE_MIX
    const comp = {}
    let rest = head
    for (const [k, r] of Object.entries(mix)) {
      comp[k] = Math.round(head * r)
      rest -= comp[k]
    }
    comp[sheep ? "lamb" : "calf"] = rest
    return {
      id: sheep
        ? `SF-${String(idx + 1).padStart(2, "0")}`
        : `CH-${String(idx + 1).padStart(2, "0")}`,
      unit: u.id,
      kind: u.kind,
      head,
      comp,
      su: sheep ? head : head * SU_CATTLE
    }
  })
  const totalSU = herds.reduce((s, h) => s + h.su, 0)
  // 每个单元的合理载畜量 = 实际载畜量 ÷ 压力系数；全场按目标指数整体缩放
  const rawCap = herds.map((h, i) => h.su / PRESSURE[i])
  const capScale =
    totalSU / (1 + TARGET_INDEX) / rawCap.reduce((s, c) => s + c, 0)
  const unitCap = rawCap.map((c) => c * capScale)
  // 由单元合理载畜量反推 K：合理载畜量 = Σ 面积 × K × (NDVI − 0.15) × 利用率 ÷ (1.8 × 183)
  const unitPot = units.map((u) =>
    u.paddocks.reduce((s, id) => s + potential(paddocks.get(id)), 0)
  )
  const Ks = units.map(
    (u, i) => (unitCap[i] * DAILY_HAY * WARM_DAYS) / (unitPot[i] * USE_RATE)
  )
  /** 分区产草量（干重 kg/亩）：月份按真实 NDVI 变化 */
  const yieldOf = (p, unitIdx, month, year = "2026") =>
    Ks[unitIdx] * Math.max(ndviOf(p, year, curMonthIdx(month)) - 0.15, 0.05)

  // ---------- 轮牧日程 ----------
  // 每个单元一季轮 3 遍，每遍每块分区的放牧天数 ∝ 该块的产草潜力；各单元起点错开
  const rotation = units.map((u, i) => {
    const herd = herds[i]
    const days = u.paddocks.map((id) => {
      const p = paddocks.get(id)
      const cap = (potential(p) * Ks[i] * USE_RATE) / (herd.su * DAILY_HAY)
      return cap / PASSES
    })
    const cycle = days.reduce((s, d) => s + d, 0)
    const phase = rng(`phase-${u.id}`)() * cycle
    return { days, cycle, phase }
  })

  /** 某单元在暖季第 sd 天的轮牧状态 */
  function rotationAt(i, sd) {
    const r = rotation[i]
    const t = (((sd + r.phase) % r.cycle) + r.cycle) % r.cycle
    let acc = 0
    let cur = 0
    for (let k = 0; k < 4; k++) {
      if (t < acc + r.days[k]) {
        cur = k
        break
      }
      acc += r.days[k]
    }
    const grazed = t - acc
    // 其它分区距离上次放牧结束过了多少天
    const rest = r.days.map((_, k) => {
      if (k === cur) return 0
      let end = 0
      for (let j = 0; j <= k; j++) end += r.days[j]
      let ago = t - end
      if (ago < 0) ago += r.cycle
      return ago
    })
    return { cur, grazed, remain: r.days[cur] - grazed, rest, days: r.days }
  }

  // ---------- 每天的行程（按日期缓存） ----------
  const dayCache = new Map()
  function dayPlan(dayKey, sd0) {
    if (dayCache.has(dayKey)) return dayCache.get(dayKey)
    const plans = herds.map((h, i) => {
      const u = units[i]
      const rot = rotationAt(i, sd0 + 0.5)
      const pad = paddocks.get(u.paddocks[rot.cur])
      const rand = rng(`${dayKey}-${h.id}`)
      // 本单元的饮水点里离当前分区最近的那个
      const wps = water.filter((w) => w.unit === u.id)
      const wp = wps.reduce((a, b) =>
        dist(a.pos, pad.center) <= dist(b.pos, pad.center) ? a : b
      )
      const A = randomIn(pad.polygon, pad.center, rand)
      const B = randomIn(pad.polygon, pad.center, rand)
      const C = randomIn(pad.polygon, pad.center, rand)
      const W = [
        wp.pos[0] + (rand() - 0.5) * 60,
        wp.pos[1] + (rand() - 0.5) * 60
      ]
      let plan
      if (h.kind === "sheep") {
        const home = homes.get(u.id).pos
        plan = [
          [5.5, home],
          [8.5, A],
          [11.5, W],
          [12.5, W],
          [15.0, B],
          [18.0, C],
          [20.0, home]
        ]
      } else {
        // 牛群夜里在饮水点附近卧息，白天在分区里采食
        const night = randomIn(pad.polygon, lerp2(pad.center, W, 0.6), rand, 60)
        plan = [
          [4.5, night],
          [8.0, A],
          [11.5, W],
          [13.0, W],
          [16.0, B],
          [19.5, C],
          [21.5, night]
        ]
      }
      return {
        herd: h,
        unitIdx: i,
        paddock: pad.id,
        rot,
        plan,
        wp: wp.id,
        seed: rand() * 100
      }
    })
    // 今日累计行走：按 5 分钟采样累加
    for (const pl of plans) {
      const cum = [0]
      let prev = followPlan(pl.plan, 0, 0, pl.seed)
      for (let k = 1; k <= 288; k++) {
        const hh = k / 12
        const p = herdCenter(pl, hh)
        cum.push(cum[k - 1] + dist(prev, p))
        prev = p
      }
      pl.cumWalk = cum
    }
    const v = { plans, events: dayEvents(dayKey, plans) }
    dayCache.set(dayKey, v)
    if (dayCache.size > 4) dayCache.delete(dayCache.keys().next().value)
    return v
  }

  /** 点是否在河岸禁牧保护带里 */
  const inReserve = (p) => reserve.some((poly) => inPolygon(p, poly))

  /** 落进保护带的点沿着到 toward 的方向拉回来（正常放牧不会越界，越界只由告警事件制造） */
  function keepOut(p, toward) {
    if (!inReserve(p)) return p
    for (let k = 1; k <= 20; k++) {
      const q = lerp2(p, toward, k / 20)
      if (!inReserve(q)) return lerp2(p, toward, Math.min(1, k / 20 + 0.03))
    }
    return toward.slice()
  }

  /** 畜群中心位置（采食时左右游走，让一天的行走距离接近调研的 6–9 km） */
  function herdCenter(pl, hours) {
    const grazing = pl.herd.kind === "sheep" ? 260 : 240
    return keepOut(
      followPlan(pl.plan, hours, grazing, pl.seed),
      paddocks.get(pl.paddock).center
    )
  }

  /** 今日截至 hours 的行走距离（km） */
  function walked(pl, hours) {
    const k = clamp(hours * 12, 0, 288)
    const i = Math.floor(k)
    const f = k - i
    const a = pl.cumWalk[i]
    const b = pl.cumWalk[Math.min(i + 1, 288)]
    return (a + (b - a) * f) / 1000
  }

  // ---------- 告警事件 ----------
  const SLOT_MIN = 10
  const EVENT_KINDS = [
    { kind: "fence", level: "urgent", title: "电子围栏越界", weight: 3 },
    { kind: "stray", level: "urgent", title: "头羊离群", weight: 2 },
    { kind: "water", level: "major", title: "饮水点水位低", weight: 2 },
    { kind: "battery", level: "minor", title: "项圈电量低", weight: 1 },
    { kind: "offline", level: "minor", title: "项圈离线", weight: 1 }
  ]

  /** 一天的事件表：每 10 分钟一个时段，6:00–22:00 之间约三成时段出一个事件（全天约 30 条，大半是电量 / 离线这类一般告警之外的演示事件） */
  function dayEvents(dayKey, plans) {
    const list = []
    const total = EVENT_KINDS.reduce((s, k) => s + k.weight, 0)
    for (let slot = 36; slot < 132; slot++) {
      const r = rng(`${dayKey}-ev-${slot}`)
      if (r() > 0.3) continue
      let pick = r() * total
      const tpl = EVENT_KINDS.find((k) => (pick -= k.weight) < 0)
      const start = (slot * SLOT_MIN + r() * 4) / 60
      const dur = (8 + r() * 17) / 60
      const ev = {
        ...tpl,
        id: `${dayKey.replace(/-/g, "")}-${String(slot).padStart(3, "0")}`,
        start,
        end: start + dur
      }
      // 目标对象
      const cattle = plans.filter((p) => p.herd.kind === "cattle")
      const sheep = plans.filter((p) => p.herd.kind === "sheep")
      if (ev.kind === "fence") {
        const pl = cattle[Math.floor(r() * cattle.length)]
        ev.herd = pl.herd.id
        ev.cow = Math.floor(r() * pl.herd.head)
        ev.target = `${pl.herd.id}-${String(ev.cow + 1).padStart(3, "0")}`
      } else if (ev.kind === "stray") {
        const pl = sheep[Math.floor(r() * sheep.length)]
        ev.herd = pl.herd.id
        ev.lead = Math.floor(r() * LEAD_COLLARS)
        ev.target = collarId(pl.herd.id, ev.lead)
        ev.angle = r() * Math.PI * 2
      } else if (ev.kind === "water") {
        const w = water[Math.floor(r() * water.length)]
        ev.target = w.id
        ev.end = start + (20 + r() * 25) / 60
      } else {
        const pl = plans[Math.floor(r() * plans.length)]
        ev.herd = pl.herd.id
        const n = pl.herd.kind === "sheep" ? LEAD_COLLARS : pl.herd.head
        ev.target = collarId(pl.herd.id, Math.floor(r() * n))
      }
      // 派单给本单元的放牧员
      const pl = plans.find((p) => p.herd.id === ev.herd)
      const unitIdx = pl
        ? pl.unitIdx
        : units.findIndex(
            (u) => u.id === water.find((w) => w.id === ev.target)?.unit
          )
      ev.herder = `HD-${String(unitIdx + 1).padStart(2, "0")}`
      list.push(ev)
    }
    return list
  }

  /** 项圈编号：头羊 CL-0001…0021（每群 3 个），牛 CL-0022 起按牛群、序号排 */
  const collarBase = new Map()
  {
    let n = 1
    for (const h of herds) {
      collarBase.set(h.id, n)
      n += h.kind === "sheep" ? LEAD_COLLARS : h.head
    }
  }
  function collarId(herdId, k) {
    return `CL-${String(collarBase.get(herdId) + k).padStart(4, "0")}`
  }
  const totalCollars = herds.reduce(
    (s, h) => s + (h.kind === "sheep" ? LEAD_COLLARS : h.head),
    0
  )

  /** 事件在某时刻的处理状态 */
  function eventStage(ev, hours) {
    const k = (hours - ev.start) / (ev.end - ev.start)
    if (k < 0.2) return "pending"
    if (k < 0.45) return "dispatched"
    if (k < 1) return "handling"
    return "resolved"
  }

  // ---------- 单头牛的偏移 ----------
  function cowOffset(herdId, i, hours, spread) {
    const r = rng(`${herdId}-cow-${i}`)
    const rad = spread * Math.sqrt(r())
    const ang = r() * Math.PI * 2
    const w = 0.15 + r() * 0.3
    const ph = r() * 10
    return [
      Math.cos(ang) * rad + Math.sin(hours * w * 6 + ph) * 25,
      Math.sin(ang) * rad + Math.cos(hours * w * 5 + ph) * 25
    ]
  }

  /** 牛群的散开程度：采食时 220 m，卧息时 60 m */
  function herdSpread(hours) {
    const day =
      smooth(clamp((hours - 5) / 2, 0, 1)) *
      smooth(clamp((21 - hours) / 2, 0, 1))
    const noon = 1 - 0.6 * Math.exp(-(((hours - 12.2) / 0.8) ** 2))
    return 60 + 160 * day * noon
  }

  // ---------- 饮水点 ----------
  /** 水罐液位（%）：白天光伏泵补水，饮水时段被畜群喝下去；故障事件时泵停 */
  function waterState(w, hours, events, plans) {
    const kind = units.find((u) => u.id === w.unit).kind
    const pl = plans.find((p) => p.wp === w.id)
    const tank = TANK_M3[kind]
    const r = rng(`wp-${w.id}`)
    const base = 70 + r() * 20
    // 饮水量：本饮水点有畜群在用时，11:30–13:00 集中饮水
    const daily = pl ? (pl.herd.head * DRINK_L[kind]) / 1000 : 0
    const drinkShare = (h) => clamp((h - 11.3) / 1.6, 0, 1)
    const fault = events.find(
      (e) =>
        e.kind === "water" &&
        e.target === w.id &&
        hours >= e.start &&
        hours < e.end + 0.5
    )
    // 泵：8:00–18:00 日照时段工作，故障时停；补水速度按液位回升到基准
    const pumpOn = hours >= 8 && hours < 18 && !fault
    let level = base - ((drinkShare(hours) * daily * 100) / tank) * 0.55
    if (hours > 12.9 && pumpOn)
      level += Math.min((hours - 12.9) * 9, base - level + 0)
    if (fault) level = Math.min(level, 18 - (hours - fault.start) * 6)
    level = clamp(level, 4, 98)
    return {
      id: w.id,
      unit: w.unit,
      level: +level.toFixed(1),
      supplied: +(daily * drinkShare(hours)).toFixed(2),
      pump: fault ? "fault" : pumpOn ? "run" : "stop",
      solarKw: pumpOn
        ? +(1.2 + 0.8 * Math.sin(((hours - 8) / 10) * Math.PI)).toFixed(2)
        : 0,
      // 流量计偶发读数不确定（演示"质量不确定"）
      flowQuality:
        rng(`${w.id}-q-${Math.floor(hours * 2)}`)() < 0.04
          ? "uncertain"
          : "good"
    }
  }

  // ---------- 天气（示意） ----------
  /** 某天的天况：日最低 12–16 ℃、最高 24–30 ℃（假设），14 时最热；午后阵雨概率、风按日期播种 */
  function dayWeather(dayKey) {
    const r = rng(`${dayKey}-wx`)
    const lo = 12 + r() * 4
    const hi = 24 + r() * 6
    const sky = ["晴", "晴", "晴间多云", "多云"][Math.floor(r() * 4)]
    const dir = ["东南风", "南风", "西南风", "西北风"][Math.floor(r() * 4)]
    const wind = 2 + Math.floor(r() * 3)
    const shower = r() < 0.35 ? 30 + r() * 50 : 5 + r() * 10 // 午后阵雨的峰值概率（%）
    // 5 时最低、14 时最高、23 时回落
    const temp = (h) =>
      lo + (hi - lo) * Math.sin(clamp((h - 5) / 18, 0, 1) * Math.PI) ** 1.2
    const rain = (h) => shower * Math.exp(-(((h - 15.5) / 2.2) ** 2))
    return { sky, lo, hi, dir, wind, temp, rain }
  }
  function weather(t) {
    const w = dayWeather(t.dayKey)
    const next = [1, 2, 3].map((k) => {
      const d = new Date(Date.parse(t.dayKey) + k * DAY_MS)
        .toISOString()
        .slice(0, 10)
      const x = dayWeather(d)
      return {
        date: d.slice(5),
        sky: x.sky,
        lo: Math.round(x.lo),
        hi: Math.round(x.hi)
      }
    })
    return {
      sky: w.sky,
      temp: Math.round(w.temp(t.hours)),
      lo: Math.round(w.lo),
      hi: Math.round(w.hi),
      wind: `${w.dir} ${w.wind} 级`,
      hourly: Array.from({ length: 24 }, (_, h) => ({
        h,
        temp: +w.temp(h).toFixed(1),
        rain: Math.round(w.rain(h))
      })),
      next
    }
  }

  // ---------- 生产作业（示意，节点见 02 调研的季节日历） ----------
  /** 某天的作业进度：剪毛 6 月、药浴 7 月上旬按群排期、冬羔配种 7/20 起、打草 8/10 起、秋防 9 月起 */
  function operations(t) {
    const day = Date.parse(t.dayKey) + t.hours * 3600000
    const at = (m, d) => Date.UTC(2026, m - 1, d)
    const prog = (a, b) => clamp((day - a) / (b - a), 0, 1)
    const flocks = herds.filter((h) => h.kind === "sheep")
    const ewes = flocks.reduce((s, h) => s + h.comp.ewe, 0)
    // 药浴：7/2 起每两天一群，当天 10 点前后完成
    const dipped = flocks.filter(
      (h, i) => day >= at(7, 2 + i * 2) + 10 * 3600000
    ).length
    const mated = Math.round(ewes * smooth(prog(at(7, 20), at(9, 15))))
    const hay = Math.round(HAY_TARGET * prog(at(8, 10), at(9, 10)))
    const state = (p) => (p >= 1 ? "done" : p > 0 ? "doing" : "todo")
    return [
      {
        id: "shear",
        name: "剪毛",
        from: "06-15",
        to: "06-30",
        done: 1,
        total: 1,
        unit: "",
        state: state(prog(at(6, 15), at(6, 30)))
      },
      {
        id: "dip",
        name: "药浴（羊）",
        from: "07-02",
        to: "07-14",
        done: dipped,
        total: flocks.length,
        unit: "群",
        state: dipped >= flocks.length ? "done" : dipped > 0 ? "doing" : "todo"
      },
      {
        id: "breed",
        name: "冬羔配种",
        from: "07-20",
        to: "09-15",
        done: mated,
        total: ewes,
        unit: "只",
        state: state(prog(at(7, 20), at(9, 15)))
      },
      {
        id: "hay",
        name: "打草储草",
        from: "08-10",
        to: "09-10",
        done: hay,
        total: HAY_TARGET,
        unit: "t",
        state: state(prog(at(8, 10), at(9, 10)))
      },
      {
        id: "vacc",
        name: "秋季防疫",
        from: "09-01",
        to: "10-20",
        done: 0,
        total: 1,
        unit: "",
        state: state(prog(at(9, 1), at(10, 20)))
      }
    ]
  }

  /** 称重通道 WS-01 近 7 天的平均日增重（羔羊 g/天，育肥牛 kg/天，假设），按日期播种 */
  function weighing(t) {
    const days = Array.from({ length: 7 }, (_, k) =>
      new Date(Date.parse(t.dayKey) - (6 - k) * DAY_MS)
        .toISOString()
        .slice(0, 10)
    )
    const lamb = days.map((d) => Math.round(142 + rng(`${d}-wl`)() * 22))
    const steer = days.map((d) => +(0.78 + rng(`${d}-wc`)() * 0.2).toFixed(2))
    // 今天已过称重通道的头数：8–17 时陆续通过
    const count = Math.round(260 * clamp((t.hours - 8) / 9, 0, 1))
    return { days: days.map((d) => d.slice(5)), lamb, steer, count }
  }

  // ---------- 某时刻的完整状态 ----------
  function at(ms = Date.now()) {
    const t = demoTime(ms)
    const sd0 = Math.floor(t.seasonDay - t.hours / 24)
    const { plans, events } = dayPlan(t.dayKey, sd0)
    const hours = t.hours
    const month = t.month

    // 分区状态
    const paddockState = []
    const unitState = units.map((u, i) => {
      const rot = rotationAt(i, t.seasonDay)
      let cap = 0
      u.paddocks.forEach((id, k) => {
        const p = paddocks.get(id)
        const y = yieldOf(p, i, month)
        const cur = k === rot.cur
        // 存草比例：放牧期间按天数下降到 70%；休牧后 40 天内恢复到 100%
        const ratio = cur
          ? 1 - 0.3 * (rot.grazed / rot.days[k])
          : Math.min(1, 0.7 + (0.3 * rot.rest[k]) / 40)
        const status = cur ? "grazing" : ratio >= 0.97 ? "ready" : "resting"
        cap += (p.areaMu * y * USE_RATE) / (DAILY_HAY * WARM_DAYS)
        paddockState.push({
          id,
          unit: u.id,
          status,
          ndvi: ndviOf(p, "2026", curMonthIdx(month)),
          ndviLastYear: ndviOf(p, "2025", curMonthIdx(month)),
          forage: +(y * ratio).toFixed(1),
          grazedDays: cur ? +rot.grazed.toFixed(1) : 0,
          remainDays: cur ? +rot.remain.toFixed(1) : null,
          restDays: cur ? 0 : +rot.rest[k].toFixed(1),
          herd: cur ? herds[i].id : null
        })
      })
      const su = herds[i].su
      return {
        id: u.id,
        kind: u.kind,
        herd: herds[i].id,
        su,
        capacity: +cap.toFixed(1),
        balance: +(((su - cap) / cap) * 100).toFixed(1),
        grazing: u.paddocks[rot.cur]
      }
    })

    // 当前时刻的事件
    const active = events
      .filter((e) => hours >= e.start && hours < e.end)
      .map((e) => ({ ...e, stage: eventStage(e, hours) }))
    const today = events
      .filter((e) => hours >= e.start)
      .map((e) => ({ ...e, stage: eventStage(e, hours) }))

    // 畜群与项圈
    const herdState = plans.map((pl) => {
      const h = pl.herd
      const center = herdCenter(pl, hours)
      const s = {
        id: h.id,
        unit: units[pl.unitIdx].id,
        kind: h.kind,
        head: h.head,
        su: h.su,
        paddock: pl.paddock,
        pos: center.map((v) => +v.toFixed(1)),
        walkKm: +walked(pl, hours).toFixed(2),
        activity:
          hours < (h.kind === "sheep" ? 5.5 : 4.5) ||
          hours >= (h.kind === "sheep" ? 20 : 21.5)
            ? "rest"
            : hours >= 11.5 && hours < 12.6
              ? "drink"
              : "graze"
      }
      if (h.kind === "sheep") {
        // 头羊项圈在羊群中心附近；离群事件时那只头羊往外走 1–1.6 km
        s.leads = Array.from({ length: LEAD_COLLARS }, (_, k) => {
          const off = cowOffset(h.id, k, hours, 50)
          let p = [center[0] + off[0], center[1] + off[1]]
          const ev = active.find(
            (e) => e.kind === "stray" && e.target === collarId(h.id, k)
          )
          if (ev) {
            const k2 = smooth(
              clamp((hours - ev.start) / ((ev.end - ev.start) * 0.5), 0, 1)
            )
            const back = smooth(
              clamp(((hours - ev.start) / (ev.end - ev.start)) * 2 - 1.2, 0, 1)
            )
            const d = 1300 * k2 * (1 - back)
            p = [p[0] + Math.cos(ev.angle) * d, p[1] + Math.sin(ev.angle) * d]
          }
          return { id: collarId(h.id, k), pos: p.map((v) => +v.toFixed(1)) }
        })
      } else {
        // 每头牛的位置；越界事件里那头牛走进河岸保护带
        const spread = herdSpread(hours)
        s.cows = Array.from({ length: h.head }, (_, i) => {
          const off = cowOffset(h.id, i, hours, spread)
          let p = [center[0] + off[0], center[1] + off[1]]
          const ev = active.find(
            (e) => e.kind === "fence" && e.herd === h.id && e.cow === i
          )
          if (!ev) p = keepOut(p, center)
          if (ev) {
            const goal = nearestOnPolygon(
              p,
              reserve.reduce((a, b) =>
                dist(nearestOnPolygon(p, a), p) <=
                dist(nearestOnPolygon(p, b), p)
                  ? a
                  : b
              )
            )
            // 越过保护带边界再往里走 60 m
            const dir = [goal[0] - p[0], goal[1] - p[1]]
            const len = Math.hypot(...dir) || 1
            const inside = [
              goal[0] + (dir[0] / len) * 60,
              goal[1] + (dir[1] / len) * 60
            ]
            const go = smooth(
              clamp((hours - ev.start) / ((ev.end - ev.start) * 0.35), 0, 1)
            )
            const back = smooth(
              clamp(
                ((hours - ev.start) / (ev.end - ev.start) - 0.6) / 0.4,
                0,
                1
              )
            )
            p = lerp2(p, inside, go * (1 - back))
          }
          return p.map((v) => +v.toFixed(1))
        })
      }
      return s
    })

    // 项圈电量与上报：离线事件的项圈从事件开始起不再上报（演示里把最后上报时间往前推 2 小时）
    const collars = {
      total: totalCollars,
      online: totalCollars,
      lowBattery: 0,
      stale: []
    }
    for (const e of active) {
      if (e.kind === "offline") {
        collars.online -= 1
        collars.stale.push({
          id: e.target,
          herd: e.herd,
          lastSeenSec: STALE_SEC + (hours - e.start) * 3600
        })
      }
      if (e.kind === "battery") collars.lowBattery += 1
    }
    // 常态：每天固定有几个项圈电量偏低（按日期播种）
    collars.lowBattery += 2 + Math.floor(rng(`${t.dayKey}-bat`)() * 3)

    const waterState_ = water.map((w) => waterState(w, hours, events, plans))

    // 全场汇总（都从明细算）
    const capacity = unitState.reduce((s, u) => s + u.capacity, 0)
    const su = unitState.reduce((s, u) => s + u.su, 0)
    const sheepHead = herdState
      .filter((h) => h.kind === "sheep")
      .reduce((s, h) => s + h.head, 0)
    const cattleHead = herdState
      .filter((h) => h.kind === "cattle")
      .reduce((s, h) => s + h.head, 0)
    const areaMu = layout.paddocks.reduce((s, p) => s + p.areaMu, 0)
    const ndviNow =
      layout.paddocks.reduce(
        (s, p) => s + p.areaMu * ndviOf(p, "2026", curMonthIdx(month)),
        0
      ) / areaMu
    const ndviLast =
      layout.paddocks.reduce(
        (s, p) => s + p.areaMu * ndviOf(p, "2025", curMonthIdx(month)),
        0
      ) / areaMu

    // 存栏结构：各畜群明细相加
    const stock = {
      sheep: { ewe: 0, ram: 0, young: 0, lamb: 0 },
      cattle: { cow: 0, bull: 0, steer: 0, calf: 0 }
    }
    for (const h of herds)
      for (const [k, v] of Object.entries(h.comp)) stock[h.kind][k] += v

    return {
      t,
      weather: weather(t),
      stock,
      ops: operations(t),
      weigh: weighing(t),
      ranch: {
        areaMu,
        sheepHead,
        cattleHead,
        head: sheepHead + cattleHead,
        su,
        capacity: +capacity.toFixed(1),
        balance: +(((su - capacity) / capacity) * 100).toFixed(1),
        ndvi: +ndviNow.toFixed(3),
        ndviLastYear: +ndviLast.toFixed(3),
        paddocks: {
          grazing: paddockState.filter((p) => p.status === "grazing").length,
          resting: paddockState.filter((p) => p.status === "resting").length,
          ready: paddockState.filter((p) => p.status === "ready").length
        },
        avgWalkKm: +(
          herdState
            .filter((h) => h.kind === "sheep")
            .reduce((s, h) => s + h.walkKm, 0) /
          herdState.filter((h) => h.kind === "sheep").length
        ).toFixed(2),
        suppliedM3: +waterState_.reduce((s, w) => s + w.supplied, 0).toFixed(2)
      },
      units: unitState,
      paddocks: paddockState,
      herds: herdState,
      collars,
      water: waterState_,
      events: { active, today }
    }
  }

  /** 某畜群当天截至 ms 的行走轨迹（群中心），往前 hoursBack 小时，每 step 分钟一个点 */
  function track(herdId, ms, hoursBack = 6, stepMin = 5) {
    const t = demoTime(ms)
    const sd0 = Math.floor(t.seasonDay - t.hours / 24)
    const pl = dayPlan(t.dayKey, sd0).plans.find((p) => p.herd.id === herdId)
    if (!pl) return []
    const pts = []
    for (
      let h = Math.max(0, t.hours - hoursBack);
      h <= t.hours;
      h += stepMin / 60
    )
      pts.push(herdCenter(pl, h).map((v) => +v.toFixed(1)))
    pts.push(herdCenter(pl, t.hours).map((v) => +v.toFixed(1)))
    return pts
  }

  return { at, track, herds, units, rotation, totalCollars, collarId, demoTime }
}

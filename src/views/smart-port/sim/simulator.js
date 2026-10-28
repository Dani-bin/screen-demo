/*
 * 智慧港口（洋山四期全自动化码头）运行仿真（演示数据）
 * ----------------------------------------------------------
 * 码头名称、岸线、泊位、箱区、设备数量是公开数据（layout.json，来源见 docs/design/smart-port/02-research.md）；
 * 船名、航线、箱量、设备状态、告警全部是模拟的。
 *
 * 时间：跟随真实的北京时间，码头 24 小时作业。
 *
 * 规则（标"假设"的是演示取值）：
 *   - 船期按"周泊位计划"排：每条航线每周固定时段、固定岸段靠泊（班轮码头的常见做法），
 *     每周 33 个航次（超大型 6、大型 8、中型 9、支线 10），日均约 8900 自然箱、1.5 万 TEU，
 *     折合年吞吐约 560 万 TEU，在四期设计能力（初期 400 万、远期 630 万 TEU）以内
 *   - 每个航次的到港偏差（−1 … +0.75 h）、箱量、各作业路效率按"航线 + 周次"播种；同一航次每次算出来都一样；
 *     计划离泊按本航次箱量和名义效率排，晚到、故障会让实际离泊晚于计划
 *   - 一条船按配载拆成若干"作业路"（每路 1 台岸桥），进度按 10 分钟时段积分：
 *     名义台时量 31–35 自然箱/h（假设），每个时段有 ±12% 波动；岸桥故障时该路停摆，
 *     该路目标箱区的海侧轨道吊故障时效率降到 75%
 *   - 先卸后装：卸船箱量占 42–58%
 *   - 岸桥共轨不能互相穿越：每个时刻按作业路位置做动态规划，给每路挑一台岸桥，
 *     使岸桥离驻车位的总距离最小，相邻岸桥中心至少隔 30 m；空闲岸桥停在两侧作业岸桥之间
 *   - AGV：每路按往返时间配 4–7 台（汇合哈希分配，作业路增减时尽量不换车）；
 *     电量按锯齿曲线下降，低于 25% 去换电站，换电往返约 12 分钟（换电本身约 6 分钟，见 02 调研）
 *   - 告警：岸桥故障来自作业路（按航次播种），其余（轨道吊故障、AGV 故障、AGV 定位中断、
 *     冷箱温度偏离、阵风预警、危险品箱堆存将超时、风速仪读数异常）按日期播种；
 *     船舶预计延误由仿真结果推出（实际完工晚于计划离泊 30 分钟以上）
 *
 * 用法：const sim = createPortSim(layout); const s = sim.at(Date.now()); const poses = sim.agvPoses(Date.now())
 */

const TZ = "Asia/Shanghai"
const MIN = 60000
const HOUR = 3600000
const DAY = 86400000
const WEEK = 7 * DAY
/** 周计划的起点：2026-01-05 00:00 北京时间（周一） */
const EPOCH = Date.UTC(2026, 0, 4, 16)
/** 进度积分的时段长度 */
const SLOT = 10 * MIN

/**
 * 船型（假设，按常见船级取值）：
 * loa 船长 m、beam 型宽 m、moves 每航次装卸自然箱区间、lines 作业路（岸桥）数、weekly 每周航次数
 */
export const SHIP_CLASSES = {
  ULCV: {
    name: "超大型",
    teu: 24000,
    loa: 400,
    beam: 61,
    moves: [3600, 4200],
    lines: 6,
    weekly: 6,
    bigOnly: true
  },
  VLCS: {
    name: "大型",
    teu: 14000,
    loa: 366,
    beam: 51,
    moves: [2250, 2650],
    lines: 5,
    weekly: 8
  },
  PPX: {
    name: "中型",
    teu: 8500,
    loa: 335,
    beam: 43,
    moves: [1350, 1650],
    lines: 4,
    weekly: 9
  },
  FDR: {
    name: "支线",
    teu: 2500,
    loa: 210,
    beam: 32,
    moves: [520, 680],
    lines: 2,
    weekly: 10
  }
}
/** 每路名义台时量（自然箱/h，假设）；四期公开纪录：2022 年桥吊平均 58.28、单机 63.88 */
const LINE_RATE = [31, 35]
export const QC_RECORD = { avg: 58.28, single: 63.88, year: 2022 }
/** 靠泊后到开工、完工到离泊、靠离泊航行（小时，假设） */
const PREP_H = 0.75
const LASH_H = 0.75
const SAIL_H = 0.5
/** 周计划给每个航次预留的岸线时间：计划靠泊前 0.5 h（靠泊航行）起，按最坏情况（晚到 0.75 h、箱量取上限、
 *  作业路最不均衡、效率取下限、一次 45 分钟故障）算到离泊驶离，保证同一岸段前后两船不会重叠 */
const RESERVE_BEFORE = 0.5 * HOUR
const ARRIVE_DEV = [-1, 0.75]
const LINE_IMBALANCE = 0.05
/** 计划离泊：一条船的完工由最慢的作业路决定，所以按"每路箱量 + 4% 余量、31.5 自然箱/h"
 *  再加 15 分钟开工错峰来排；晚到、故障、轨道吊停机、阵风才会让实际离泊晚于计划 */
const PLAN_RATE = 31.5
const PLAN_MARGIN = 1.04
const PLAN_STAGGER_H = 0.25
/** 相邻两船之间的最小间隔（米，含系缆） */
const SHIP_GAP = 40
/** 同一时刻最多同时开工的作业路（28 台岸桥里留 2 台机动 / 检修） */
const MAX_LINES = 26

/** AGV：车速 m/s（约 18 km/h，假设）、岸桥下交接、箱区支架交接（秒） */
const AGV_SPEED = 5
const QC_HANDOVER = 75
const BLOCK_HANDOVER = 45
/** AGV 电量：低于 25% 去换电（假设）；满电续航 7–9 小时；换电往返 12 分钟 */
const SOC_LOW = 25
const SOC_PERIOD_H = [7, 9]
const SWAP_MIN = 12

/** 风速阈值（m/s）：15 黄色预警，20 停机锚定（02 调研，规格书惯例） */
export const WIND_WARN = 15
export const WIND_STOP = 20

/** 航线（虚构）：代码、名称、船公司、船名前缀；船名不对应任何真实船舶 */
const ROUTES = [
  { code: "EU1", name: "远东—北欧", carrier: "瀚洋航运", prefix: "瀚洋" },
  { code: "EU2", name: "远东—地中海", carrier: "瀚洋航运", prefix: "瀚洋" },
  { code: "PA1", name: "跨太平洋—美西", carrier: "海川航运", prefix: "海川" },
  { code: "PA2", name: "跨太平洋—美东", carrier: "海川航运", prefix: "海川" },
  { code: "ME1", name: "远东—中东", carrier: "星港联运", prefix: "星港" },
  { code: "AF1", name: "远东—西非", carrier: "星港联运", prefix: "星港" },
  { code: "AU1", name: "远东—澳新", carrier: "明舟海运", prefix: "明舟" },
  { code: "SA1", name: "远东—南美西", carrier: "明舟海运", prefix: "明舟" },
  { code: "SE1", name: "东南亚环线", carrier: "长澜航运", prefix: "长澜" },
  { code: "SE2", name: "东南亚—印度", carrier: "长澜航运", prefix: "长澜" },
  { code: "JK1", name: "日韩快航", carrier: "东屿航运", prefix: "东屿" },
  { code: "FD1", name: "长江支线", carrier: "沪舟驳运", prefix: "沪舟" }
]
const SHIP_NAMES = [
  "天枢",
  "天璇",
  "天玑",
  "天权",
  "玉衡",
  "开阳",
  "摇光",
  "启明",
  "长庚",
  "北辰",
  "南极",
  "织女",
  "牵牛",
  "河鼓",
  "轩辕",
  "太微",
  "紫微",
  "天市",
  "角宿",
  "心宿",
  "参宿",
  "毕宿",
  "昴宿",
  "井宿",
  "鬼宿",
  "柳宿",
  "星宿",
  "张宿",
  "翼宿",
  "轸宿",
  "海鹏",
  "云帆",
  "长风",
  "远图",
  "鲲鹏",
  "沧澜",
  "怀远",
  "致远",
  "定远",
  "安澜"
]

/** 故障描述（演示） */
const QC_FAULTS = [
  "起升变频器过温",
  "小车定位编码器偏差",
  "吊具着箱信号丢失",
  "大车纠偏超限",
  "中转平台锁销检测异常"
]
const RMG_FAULTS = [
  "大车同步偏差超限",
  "吊具伸缩故障",
  "防摇控制器报警",
  "堆场扫描仪离线"
]
const AGV_FAULTS = [
  "激光雷达遮挡",
  "磁钉定位丢失",
  "驱动器过流",
  "顶升机构超时"
]

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

/** 真实时刻 → 北京时间的日期、时刻 */
export function beijing(ms = Date.now()) {
  const p = Object.fromEntries(
    fmtParts.formatToParts(new Date(ms)).map((x) => [x.type, x.value])
  )
  const date = `${p.year}-${p.month}-${p.day}`
  const dayStart = Date.UTC(+p.year, +p.month - 1, +p.day) - 8 * HOUR
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][
    new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).getUTCDay()
  ]
  return {
    date,
    week,
    dayStart,
    hours: (ms - dayStart) / HOUR,
    hm: `${p.hour}:${p.minute}`,
    hms: `${p.hour}:${p.minute}:${p.second}`
  }
}

/** 北京时间的日期 + 时刻（小时）→ 时间戳；模拟数据快照、设计稿要固定在某个时刻时用 */
export function msForBeijing(dateStr, hours) {
  const [y, m, d] = dateStr.split("-").map(Number)
  return Date.UTC(y, m - 1, d) - 8 * HOUR + hours * HOUR
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
/** 一次性的哈希随机数（0–1） */
const hash01 = (seed) => rng(seed)()
const clamp = (x, a, b) => Math.min(b, Math.max(a, x))
const lerp = (a, b, t) => a + (b - a) * t
const frac = (x) => x - Math.floor(x)

/* ---------------- 周泊位计划 ---------------- */

/**
 * 排一周的泊位计划：每个航次占用一段岸线 [u0, u0 + 船长] 和一段时间。
 * 依次放置，岸线和时间都不能和已排的航次冲突（时间按周循环），同时开工的作业路不超过 MAX_LINES。
 * 结果只取决于固定种子和 layout，每次都一样。
 */
function buildWeeklyPlan(layout) {
  const rand = rng("yangshan-iv-weekly-plan-v1")
  const quay0 = layout.quay.u0 + 15
  const quay1 = layout.quay.u1 - 15
  // 1.8 万 TEU 以上（20 万吨级）的超大型船只能靠 B02–B06（02 调研：2#–6# 泊位获批减载靠泊）
  const big0 = layout.berths[1].u0
  const big1 = layout.berths[5].u1

  const list = []
  for (const [cls, def] of Object.entries(SHIP_CLASSES))
    for (let i = 0; i < def.weekly; i++) list.push(cls)
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }

  const placed = []
  // 时间按周循环：比较时把已排航次平移 -1 / 0 / +1 周
  const SHIFTS = [-WEEK, 0, WEEK]
  const overlapT = (a0, a1, b0, b1) =>
    SHIFTS.some((sh) => a0 < b1 + sh && b0 + sh < a1)
  /** 时间窗 [r0, r1] 内同时开工的作业路峰值（扫描线） */
  const peakLines = (r0, r1, add) => {
    const ev = []
    for (const p of placed)
      for (const sh of SHIFTS) {
        const a0 = Math.max(r0, p.r0 + sh)
        const a1 = Math.min(r1, p.r1 + sh)
        if (a0 < a1) ev.push([a0, p.lines], [a1, -p.lines])
      }
    ev.sort((x, y) => x[0] - y[0] || x[1] - y[1])
    let cur = 0
    let peak = 0
    for (const [, d] of ev) peak = Math.max(peak, (cur += d))
    return peak + add
  }
  const services = []
  const routeUse = {}
  // 每个航次的目标时刻沿一周均布；先排大船（岸段限制多），再排小船
  const order = list.map((cls, i) => ({
    cls,
    i,
    t: ((i + 0.5) * WEEK) / list.length + (rand() - 0.5) * 3 * HOUR
  }))
  const size = { ULCV: 0, VLCS: 1, PPX: 2, FDR: 3 }
  order.sort((x, y) => size[x.cls] - size[y.cls] || x.i - y.i)
  order.forEach(({ cls, i, t: t0 }) => {
    const def = SHIP_CLASSES[cls]
    const movesAvg = (def.moves[0] + def.moves[1]) / 2
    const planDur =
      (PREP_H +
        PLAN_STAGGER_H +
        (movesAvg * PLAN_MARGIN) / (def.lines * PLAN_RATE) +
        LASH_H) *
      HOUR
    const worstWork =
      (def.moves[1] * (1 + LINE_IMBALANCE)) / (def.lines * LINE_RATE[0]) + 0.75
    const reserve =
      (ARRIVE_DEV[1] + PREP_H + worstWork + LASH_H + SAIL_H + 0.25) * HOUR
    const lo = def.bigOnly ? big0 : quay0
    const hi = (def.bigOnly ? big1 : quay1) - def.loa
    const prefer = lerp(lo, hi, rand())
    let pick = null
    let t = t0
    // 目标时刻排不下就前后交替挪 1 小时：0, +1, −1, +2, −2 …
    for (let k = 0; k < 97 && pick === null; k++) {
      t = t0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * HOUR
      const r0 = t - RESERVE_BEFORE
      const r1 = t + reserve
      if (peakLines(r0, r1, def.lines) > MAX_LINES) continue
      let best = null
      for (let u0 = lo; u0 <= hi; u0 += 10) {
        const free = placed.every(
          (p) =>
            !overlapT(r0, r1, p.r0, p.r1) ||
            u0 + def.loa + SHIP_GAP <= p.u0 ||
            p.u1 + SHIP_GAP <= u0
        )
        if (
          free &&
          (best === null || Math.abs(u0 - prefer) < Math.abs(best - prefer))
        )
          best = u0
      }
      pick = best
    }
    if (pick === null) throw new Error(`周计划排不下第 ${i} 个航次（${cls}）`)
    const start = ((t % WEEK) + WEEK) % WEEK
    placed.push({
      u0: pick,
      u1: pick + def.loa,
      r0: start - RESERVE_BEFORE,
      r1: start + reserve,
      lines: def.lines
    })
    // 航线：大船走远洋线，支线船走近洋 / 支线
    const pool = def.bigOnly
      ? ROUTES.slice(0, 8)
      : cls === "FDR"
        ? ROUTES.slice(8)
        : ROUTES
    const route = pool[Math.floor(rand() * pool.length)]
    routeUse[route.code] = (routeUse[route.code] || 0) + 1
    services.push({
      code: `${route.code}-${routeUse[route.code]}`,
      route,
      cls,
      u0: pick,
      start,
      planDur,
      // 同一航线每周轮换一条船；船名 = 船公司前缀 + 星名
      fleet: Array.from(
        { length: 5 },
        (_, k) =>
          `${route.prefix}${SHIP_NAMES[Math.floor(hash01(`${route.code}${i}${k}`) * SHIP_NAMES.length)]}`
      ),
      bowEast: rand() < 0.5
    })
  })
  return services
}

/* ---------------- 岸桥分配 ---------------- */

/**
 * 给按 u 排好序的作业路挑岸桥（动态规划）：
 * 岸桥编号随 u 递增且不能互相穿越；相邻岸桥中心至少隔 minGap；作业路之间要给中间的空闲岸桥留位置；
 * 检修中的岸桥不能派。目标：岸桥离驻车位的总距离最小。返回每路的岸桥下标（0 起），排不下返回 null。
 */
function assignCranes(xs, homes, minGap, u0, u1, blocked) {
  const n = xs.length
  const C = homes.length
  if (n === 0) return []
  if (n > C) return null
  const INF = 1e18
  const dp = Array.from({ length: n }, () => new Float64Array(C).fill(INF))
  const from = Array.from({ length: n }, () => new Int16Array(C).fill(-1))
  for (let c = 0; c < C; c++)
    if (!blocked.has(c) && c * minGap <= xs[0] - u0)
      dp[0][c] = Math.abs(homes[c] - xs[0])
  for (let m = 1; m < n; m++)
    for (let c = 1; c < C; c++) {
      if (blocked.has(c)) continue
      const cost = Math.abs(homes[c] - xs[m])
      for (let p = 0; p < c; p++) {
        if (dp[m - 1][p] >= INF || (c - p) * minGap > xs[m] - xs[m - 1])
          continue
        const v = dp[m - 1][p] + cost
        if (v < dp[m][c]) {
          dp[m][c] = v
          from[m][c] = p
        }
      }
    }
  let best = -1
  for (let c = 0; c < C; c++)
    if (
      dp[n - 1][c] < INF &&
      (C - 1 - c) * minGap <= u1 - xs[n - 1] &&
      (best < 0 || dp[n - 1][c] < dp[n - 1][best])
    )
      best = c
  if (best < 0) return null
  const out = new Array(n)
  for (let m = n - 1; m >= 0; m--) {
    out[m] = best
    best = from[m][best]
  }
  return out
}

/** 已知作业岸桥的位置，把空闲岸桥放到驻车位附近、夹在两侧作业岸桥之间 */
function placeIdle(fixed, homes, minGap, u0, u1) {
  const C = homes.length
  const pos = new Array(C)
  const work = [...fixed.entries()].sort((a, b) => a[0] - b[0])
  for (let c = 0; c < C; c++) {
    if (fixed.has(c)) {
      pos[c] = fixed.get(c)
      continue
    }
    let lo = u0 + c * minGap
    let hi = u1 - (C - 1 - c) * minGap
    for (const [k, x] of work) {
      if (k < c) lo = Math.max(lo, x + (c - k) * minGap)
      if (k > c) {
        hi = Math.min(hi, x - (k - c) * minGap)
        break
      }
    }
    pos[c] = lo <= hi ? clamp(homes[c], lo, hi) : (lo + hi) / 2
  }
  return pos
}

/* ---------------- 仿真主体 ---------------- */

export function createPortSim(layout) {
  const services = buildWeeklyPlan(layout)
  const homes = layout.cranes.map((c) => c.home)
  const craneIds = layout.cranes.map((c) => c.id)
  const QU0 = layout.quay.u0 + 15
  const QU1 = layout.quay.u1 - 15
  const minGap = layout.qcRail.minGap
  const blocks = layout.blocks
  const blockById = Object.fromEntries(blocks.map((b) => [b.id, b]))
  const rmgIds = blocks.flatMap((b) => b.rmg.map((s) => `${b.id}-${s}`))
  const agvIds = Array.from(
    { length: layout.agvs },
    (_, i) => `AGV${String(i + 1).padStart(3, "0")}`
  )
  const lanes = layout.agvLanes
  const vQc = (layout.bands.backreach[0] + layout.bands.backreach[1]) / 2
  const vEx = (layout.bands.seaTransfer[0] + layout.bands.seaTransfer[1]) / 2
  const vBuf = (layout.bands.buffer[0] + layout.bands.buffer[1]) / 2

  /* ---------- 日事件（按日期播种） ---------- */
  const dayCache = new Map()
  function dayEvents(dayStart) {
    if (dayCache.has(dayStart)) return dayCache.get(dayStart)
    const key = beijing(dayStart + HOUR).date
    const r = rng(`day:${key}`)
    const ev = []
    let n = 0
    const add = (e) =>
      ev.push({
        id: `${key.replace(/-/g, "")}-${String(++n).padStart(3, "0")}`,
        ...e
      })
    const at = (h0 = 0, h1 = 24) => dayStart + lerp(h0, h1, r()) * HOUR
    for (let i = 0; i < 4; i++) {
      const t0 = at()
      add({
        kind: "rmgFault",
        level: "major",
        title: "轨道吊故障",
        target: rmgIds[Math.floor(r() * rmgIds.length)],
        at: t0,
        end: t0 + lerp(20, 55, r()) * MIN,
        desc: RMG_FAULTS[Math.floor(r() * RMG_FAULTS.length)],
        team: "设备维修二班"
      })
    }
    for (let i = 0; i < 6; i++) {
      const t0 = at()
      add({
        kind: "agvFault",
        level: "minor",
        title: "AGV 故障停车",
        target: agvIds[Math.floor(r() * agvIds.length)],
        at: t0,
        end: t0 + lerp(12, 35, r()) * MIN,
        desc: AGV_FAULTS[Math.floor(r() * AGV_FAULTS.length)],
        team: "AGV 运维组"
      })
    }
    for (let i = 0; i < 3; i++) {
      const t0 = at()
      add({
        kind: "agvSignal",
        level: "minor",
        title: "AGV 定位信号中断",
        target: agvIds[Math.floor(r() * agvIds.length)],
        at: t0,
        end: t0 + lerp(6, 18, r()) * MIN,
        desc: "车载定位数据超过 2 分钟未更新",
        team: "AGV 运维组"
      })
    }
    const reefers = blocks.filter((b) => b.reefer)
    for (let i = 0; i < 3; i++) {
      const t0 = at()
      const b = reefers[Math.floor(r() * reefers.length)]
      add({
        kind: "reefer",
        level: "minor",
        title: "冷箱温度偏离",
        target: b.id,
        at: t0,
        end: t0 + lerp(15, 40, r()) * MIN,
        desc: `设定 −18 ℃，回风 −${(13 + r() * 2).toFixed(1)} ℃`,
        team: "冷箱监控岗"
      })
    }
    if (r() < 0.3) {
      const t0 = at(10, 18)
      add({
        kind: "wind",
        level: "major",
        title: "阵风预警",
        target: "MET-01",
        at: t0,
        end: t0 + lerp(30, 50, r()) * MIN,
        peak: lerp(15.6, 17.8, r()),
        desc: `阵风超过 ${WIND_WARN} m/s，岸桥减速作业`,
        team: "调度中心"
      })
    }
    {
      const t0 = at(6, 20)
      add({
        kind: "dg",
        level: "minor",
        title: "危险品箱堆存将超 72 h",
        target: "DG-01",
        at: t0,
        end: t0 + lerp(60, 120, r()) * MIN,
        desc: "3 类危险品箱 1 个，剩余 2 小时",
        team: "危险品管理岗"
      })
    }
    for (let i = 0; i < 2; i++) {
      const t0 = at()
      add({
        kind: "sensor",
        level: "minor",
        title: "风速仪读数异常",
        target: craneIds[Math.floor(r() * craneIds.length)],
        at: t0,
        end: t0 + lerp(10, 25, r()) * MIN,
        desc: "读数跳变，质量标记为不确定",
        team: "设备维修一班"
      })
    }
    // 计划检修：每天 1 台岸桥 09:00–15:00（不派活），轮流停在轨道东西两端的检修位，不占作业船位
    const maint = {
      crane: r() < 0.5 ? 0 : craneIds.length - 1,
      from: dayStart + 9 * HOUR,
      to: dayStart + 15 * HOUR
    }
    const base = { wind: lerp(4, 9, r()), dir: r() * 360, phase: r() * 6.28 }
    const out = { events: ev, maint, base }
    dayCache.set(dayStart, out)
    return out
  }
  const dayStartOf = (ms) => beijing(ms).dayStart
  /** 当前时刻有效的检修岸桥下标集合 */
  function maintAt(ms) {
    const d = dayEvents(dayStartOf(ms))
    return ms >= d.maint.from && ms < d.maint.to
      ? new Set([d.maint.crane])
      : new Set()
  }
  /** 轨道吊故障区间（跨日查询前后各一天） */
  function rmgFaultAt(rmgId, ms) {
    const ds = dayStartOf(ms)
    for (const d of [ds - DAY, ds])
      for (const e of dayEvents(d).events)
        if (
          e.kind === "rmgFault" &&
          e.target === rmgId &&
          ms >= e.at &&
          ms < e.end
        )
          return e
    return null
  }

  /* ---------- 航次 ---------- */
  const callCache = new Map()
  function makeCall(svc, w) {
    const id = `${svc.code}.${w}`
    if (callCache.has(id)) return callCache.get(id)
    const r = rng(`call:${id}`)
    const def = SHIP_CLASSES[svc.cls]
    const planStart = EPOCH + w * WEEK + svc.start
    // 到港偏差 −1 … +1 h：早到在锚地等到计划时刻，晚到顺延
    const eta = planStart + lerp(ARRIVE_DEV[0], ARRIVE_DEV[1], r()) * HOUR
    const tb = Math.max(eta, planStart)
    const moves = Math.round(lerp(def.moves[0], def.moves[1], r()) / 10) * 10
    const planEnd =
      planStart +
      (PREP_H +
        PLAN_STAGGER_H +
        (moves * PLAN_MARGIN) / (def.lines * PLAN_RATE) +
        LASH_H) *
        HOUR
    const dis = Math.round((moves * lerp(0.42, 0.58, r())) / 10) * 10
    const teuPerBox = lerp(1.6, 1.85, r())
    const workStart = tb + PREP_H * HOUR
    // 作业路：沿船长均布（首尾各留约 8–10% 不作业）；每路分到的箱量按权重
    const k = def.lines
    const weights = Array.from({ length: k }, () =>
      lerp(1 - LINE_IMBALANCE, 1 + LINE_IMBALANCE, r())
    )
    const wsum = weights.reduce((a, b) => a + b, 0)
    let left = moves
    const lines = weights.map((wt, i) => {
      const total = i === k - 1 ? left : Math.round((moves * wt) / wsum)
      left -= total
      const u = svc.u0 + def.loa * lerp(0.1, 0.92, (i + 0.5) / k)
      const fault =
        r() < 0.06
          ? (() => {
              const f0 =
                workStart + lerp(0.15, 0.7, r()) * (moves / (k * 33)) * HOUR
              return {
                at: f0,
                end: f0 + lerp(20, 45, r()) * MIN,
                desc: QC_FAULTS[Math.floor(r() * QC_FAULTS.length)]
              }
            })()
          : null
      return {
        id: `${id}#${i + 1}`,
        idx: i,
        u,
        total,
        dis: Math.round((total * dis) / moves),
        rate: lerp(LINE_RATE[0], LINE_RATE[1], r()),
        start: workStart + lerp(0, 15, r()) * MIN,
        fault
      }
    })
    const call = {
      id,
      svc,
      cls: svc.cls,
      def,
      name: svc.fleet[((w % 5) + 5) % 5],
      voyage: `${String(2600 + (w % 100)).padStart(4, "0")}${svc.bowEast ? "E" : "W"}`,
      u0: svc.u0,
      u1: svc.u0 + def.loa,
      bowEast: svc.bowEast,
      planStart,
      planEnd,
      eta,
      tb,
      workStart,
      moves,
      dis,
      teuPerBox,
      lines
    }
    // 逐路积分出完工时间
    for (const ln of lines) integrateLine(call, ln)
    call.workEnd = Math.max(...lines.map((l) => l.end))
    call.depart = call.workEnd + LASH_H * HOUR
    call.gone = call.depart + SAIL_H * HOUR
    call.delayMin = Math.max(0, Math.round((call.depart - planEnd) / MIN))
    callCache.set(id, call)
    return call
  }

  /** 作业路在第 s 个时段（绝对编号）的效率系数 */
  function slotFactor(call, ln, s) {
    const t0 = s * SLOT
    const t1 = t0 + SLOT
    let f = 1 + (hash01(`${ln.id}:${s}`) - 0.5) * 0.24
    if (ln.fault) {
      const ov = Math.max(
        0,
        Math.min(t1, ln.fault.end) - Math.max(t0, ln.fault.at)
      )
      f *= 1 - ov / SLOT
    }
    // 目标箱区的海侧轨道吊故障：这一路效率降到 75%
    const tb = lineTarget(ln, (t0 + t1) / 2)
    if (rmgFaultAt(`${tb}-S`, (t0 + t1) / 2)) f *= 0.75
    // 阵风预警时岸桥减速到 85%
    if (windEventAt((t0 + t1) / 2)) f *= 0.85
    return f
  }

  /** 逐时段积分：cum[i] = 第 s0+i 个时段开始时已完成的箱量；end = 完工时刻 */
  function integrateLine(call, ln) {
    const s0 = Math.floor(ln.start / SLOT)
    const cum = [0]
    let done = 0
    let s = s0
    let end = null
    while (end === null && s < s0 + 600) {
      const t0 = Math.max(s * SLOT, ln.start)
      const t1 = (s + 1) * SLOT
      const rate = (ln.rate * slotFactor(call, ln, s)) / HOUR // 箱 / 毫秒
      const add = rate * (t1 - t0)
      if (done + add >= ln.total) {
        end = rate > 0 ? t0 + (ln.total - done) / rate : t1
        done = ln.total
      } else done += add
      cum.push(done)
      s++
    }
    ln.s0 = s0
    ln.cum = cum
    ln.end = end ?? s * SLOT
  }

  /** 作业路在时刻 ms 已完成的箱量 */
  function lineDone(ln, ms) {
    if (ms <= ln.start) return 0
    if (ms >= ln.end) return ln.total
    const i = Math.floor(ms / SLOT) - ln.s0
    const a = ln.cum[i]
    const b = ln.cum[i + 1] ?? ln.total
    const t0 = Math.max((ln.s0 + i) * SLOT, ln.start)
    const t1 = (ln.s0 + i + 1) * SLOT
    return a + ((b - a) * (ms - t0)) / (t1 - t0)
  }

  /** 作业路当前对应的目标箱区：约 50 分钟换一次（堆场计划），选在作业路两侧 600 m 内 */
  function lineTarget(ln, ms) {
    const k = Math.floor((ms - ln.start) / (50 * MIN))
    const near = blocks.filter((b) => Math.abs(b.u - ln.u) < 600)
    const pool = near.length ? near : blocks
    return pool[Math.floor(hash01(`${ln.id}:tgt:${k}`) * pool.length)].id
  }

  /** 阵风事件（当天或前一天跨过来的） */
  function windEventAt(ms) {
    const ds = dayStartOf(ms)
    for (const d of [ds - DAY, ds])
      for (const e of dayEvents(d).events)
        if (e.kind === "wind" && ms >= e.at && ms < e.end) return e
    return null
  }

  /** 与时刻 ms 相关的航次（前后各一周的计划里取，包括锚地待泊、靠离泊中的） */
  function callsNear(ms, before = 2 * DAY, after = 2 * DAY) {
    const w = Math.floor((ms - EPOCH) / WEEK)
    const out = []
    for (let k = w - 1; k <= w + 1; k++)
      for (const svc of services) {
        const c = makeCall(svc, k)
        if (c.gone >= ms - before && c.planStart - 3 * HOUR <= ms + after)
          out.push(c)
      }
    return out.sort((a, b) => a.planStart - b.planStart)
  }

  /** 船在时刻 ms 的阶段：anchor 锚地待泊 / berthing 靠泊中 / working 作业中 / finishing 完工绑扎 / departing 离泊 */
  function stageOf(c, ms) {
    if (ms >= c.gone) return "gone"
    if (ms >= c.depart) return "departing"
    if (ms >= c.workEnd) return "finishing"
    if (ms >= c.tb) return ms >= c.workStart ? "working" : "moored"
    if (ms >= c.tb - SAIL_H * HOUR) return "berthing"
    if (ms >= c.eta - 3 * HOUR) return "anchor"
    return "planned"
  }

  /* ---------- 某一时刻的作业路与岸桥 ---------- */
  const craneCache = new Map()
  /** 时刻 ms 正在作业的路（开工未完工），以及岸桥分配与位置 */
  function cranesAt(ms) {
    const key = Math.round(ms / 1000)
    if (craneCache.has(key)) return craneCache.get(key)
    const active = []
    for (const c of callsNear(ms, HOUR, 0))
      for (const ln of c.lines)
        if (ms >= ln.start && ms < ln.end) active.push({ c, ln })
    active.sort((a, b) => a.ln.u - b.ln.u)
    const blocked = maintAt(ms)
    let pick = assignCranes(
      active.map((a) => a.ln.u),
      homes,
      minGap,
      QU0,
      QU1,
      blocked
    )
    if (!pick) {
      // 排不下时退而求其次：忽略间距，按顺序依次给（极少出现）
      pick = active.map((_, i) => Math.min(homes.length - 1, i))
    }
    const fixed = new Map()
    const lineOf = new Map()
    pick.forEach((ci, m) => {
      fixed.set(ci, active[m].ln.u)
      lineOf.set(ci, active[m])
    })
    const pos = placeIdle(fixed, homes, minGap, QU0, QU1)
    const out = { active, pos, lineOf, blocked }
    if (craneCache.size > 4000) craneCache.clear()
    craneCache.set(key, out)
    return out
  }

  /* ---------- 今日累计（按时段积分，结果缓存） ---------- */
  /**
   * 作业路在某个时段里归属哪台岸桥：固定取"时段起点与开工时刻较晚者"那一刻的分配。
   * 这样当前时段走到一半和走完时用的是同一台岸桥，累计量只增不减（data-check 的 counter 检查）。
   */
  function craneOfLine(ln, t0) {
    const { lineOf } = cranesAt(Math.max(t0, ln.start))
    for (const [ci, a] of lineOf) if (a.ln === ln) return ci
    return -1
  }
  /** 时段 [t0, t1) 内在作业的路 */
  function linesIn(t0, t1) {
    const out = []
    for (const c of callsNear(t0, HOUR, SLOT))
      for (const ln of c.lines)
        if (ln.start < t1 && ln.end > t0) out.push({ c, ln })
    return out
  }
  const slotStatCache = new Map()
  /** 第 s 个时段（到 tEnd 为止，缺省整个时段）里每台岸桥的作业箱量、TEU、作业时长（小时） */
  function slotStats(s, tEnd) {
    const full = tEnd === undefined
    if (full && slotStatCache.has(s)) return slotStatCache.get(s)
    const t0 = s * SLOT
    const t1 = full ? t0 + SLOT : tEnd
    const moves = new Float64Array(homes.length)
    const teu = new Float64Array(homes.length)
    const hours = new Float64Array(homes.length)
    for (const { c, ln } of linesIn(t0, t0 + SLOT)) {
      if (ln.start >= t1) continue
      const ci = craneOfLine(ln, t0)
      if (ci < 0) continue
      const m = lineDone(ln, t1) - lineDone(ln, t0)
      moves[ci] += m
      teu[ci] += m * c.teuPerBox
      hours[ci] +=
        Math.max(0, Math.min(t1, ln.end) - Math.max(t0, ln.start)) / HOUR
    }
    const out = { moves, teu, hours }
    if (full) {
      if (slotStatCache.size > 3000) slotStatCache.clear()
      slotStatCache.set(s, out)
    }
    return out
  }

  /** 从当天 00:00 到 ms 每台岸桥的累计箱量、TEU、作业小时 */
  function craneToday(ms) {
    const ds = dayStartOf(ms)
    const s0 = Math.floor(ds / SLOT)
    const s1 = Math.floor(ms / SLOT)
    const C = homes.length
    const moves = new Float64Array(C)
    const teu = new Float64Array(C)
    const hours = new Float64Array(C)
    const addIn = (st) => {
      for (let i = 0; i < C; i++) {
        moves[i] += st.moves[i]
        teu[i] += st.teu[i]
        hours[i] += st.hours[i]
      }
    }
    for (let s = s0; s < s1; s++) addIn(slotStats(s))
    // 当前时段只算到 ms
    if (ms > s1 * SLOT) addIn(slotStats(s1, ms))
    return { moves, teu, hours }
  }

  /* ---------- 事件 ---------- */
  /** 当天（及前一天跨过来的）全部事件，含岸桥故障、船舶延误；status 按时刻 ms 计算（按秒缓存：页面每帧都要用） */
  const evCache = new Map()
  function eventsAt(ms) {
    const key = Math.floor(ms / 1000)
    if (evCache.has(key)) return evCache.get(key)
    const out = eventsAtRaw(ms)
    if (evCache.size > 600) evCache.clear()
    evCache.set(key, out)
    return out
  }
  function eventsAtRaw(ms) {
    const ds = dayStartOf(ms)
    const list = []
    for (const d of [ds - DAY, ds]) list.push(...dayEvents(d).events)
    // 岸桥故障：来自作业路；岸桥编号取故障开始时刻服务这一路的那台
    for (const c of callsNear(ms, DAY, 0))
      for (const ln of c.lines) {
        if (!ln.fault) continue
        const { lineOf } = cranesAt(ln.fault.at + 1000)
        let crane = null
        for (const [ci, a] of lineOf) if (a.ln === ln) crane = craneIds[ci]
        list.push({
          id: `QC-${ln.id}`,
          kind: "qcFault",
          level: "major",
          title: "岸桥故障停机",
          target: crane || "QC",
          vessel: c.id,
          at: ln.fault.at,
          end: ln.fault.end,
          desc: ln.fault.desc,
          team: "设备维修一班"
        })
      }
    // 船舶预计延误：实际离泊晚于计划 30 分钟以上，在作业过半时由调度预判发出
    for (const c of callsNear(ms, DAY, 0))
      if (c.delayMin >= 30) {
        const at = c.workStart + 0.6 * (c.workEnd - c.workStart)
        list.push({
          id: `DLY-${c.id}`,
          kind: "delay",
          level: "major",
          title: "船舶预计延误离泊",
          target: c.id,
          at,
          end: c.depart,
          desc: `${c.name} 预计晚 ${c.delayMin} 分钟离泊`,
          team: "船舶调度岗"
        })
      }
    return list
      .filter((e) => e.at <= ms && e.end > ds - 6 * HOUR)
      .map((e) => ({
        ...e,
        // 处置流程：前 3 分钟待处置 → 处置中 → 结束后已恢复
        status:
          ms >= e.end
            ? "resolved"
            : ms - e.at < 3 * MIN
              ? "pending"
              : "handling"
      }))
      .sort((a, b) => b.at - a.at)
  }
  const activeEvent = (list, kind, target) =>
    list.find(
      (e) => e.kind === kind && e.target === target && e.status !== "resolved"
    )

  /* ---------- AGV ---------- */
  // 每台 AGV 的电量锯齿：周期 7–9 h、相位固定
  const agvSoc = agvIds.map((id) => ({
    period: lerp(SOC_PERIOD_H[0], SOC_PERIOD_H[1], hash01(`${id}:p`)) * HOUR,
    phase: hash01(`${id}:ph`)
  }))
  /** 电量与换电状态：SOC 从 100 线性降到 25，降到底就去换电 12 分钟 */
  function socOf(i, ms) {
    const { period, phase } = agvSoc[i]
    const x = frac(ms / period + phase)
    const swapFrac = (SWAP_MIN * MIN) / period
    if (x < swapFrac)
      return {
        soc: lerp(SOC_LOW, 100, x / swapFrac),
        swapping: true,
        swapPhase: x / swapFrac
      }
    return {
      soc: 100 - (100 - SOC_LOW) * ((x - swapFrac) / (1 - swapFrac)),
      swapping: false
    }
  }
  // 每条作业路对 AGV 的偏好排序（汇合哈希），按需缓存
  const prefCache = new Map()
  function prefs(lineId) {
    if (!prefCache.has(lineId)) {
      const order = agvIds
        .map((id, i) => [hash01(`${lineId}|${id}`), i])
        .sort((a, b) => a[0] - b[0])
        .map((x) => x[1])
      prefCache.set(lineId, order)
      if (prefCache.size > 2000) prefCache.delete(prefCache.keys().next().value)
    }
    return prefCache.get(lineId)
  }

  /** 一条作业路的 AGV 往返：时长（秒）、需要的车数 */
  function cycleOf(ln, ms) {
    const b = blockById[lineTarget(ln, ms)]
    const dist = Math.abs(b.u - ln.u) + 2 * (vEx - vQc) + 40
    const travel = dist / AGV_SPEED
    const T = 2 * travel + QC_HANDOVER + BLOCK_HANDOVER
    // 洋山四期约每台岸桥配 5 台 AGV（145 ÷ 28）：按往返时间算出的最少车数再多配 2 台作缓冲
    const need = clamp(Math.ceil((T * ln.rate) / 3600) + 2, 4, 7)
    return { block: b, T, travel, need }
  }

  /** 时刻 ms 每台 AGV 的状态与任务 */
  function agvsAt(ms) {
    const { lineOf } = cranesAt(ms)
    const evs = eventsAt(ms)
    const faultOf = new Map()
    const signalOf = new Map()
    for (const e of evs) {
      if (e.status === "resolved") continue
      if (e.kind === "agvFault") faultOf.set(e.target, e)
      if (e.kind === "agvSignal") signalOf.set(e.target, e)
    }
    const state = agvIds.map((id, i) => {
      const s = socOf(i, ms)
      return {
        id,
        i,
        soc: s.soc,
        swapping: s.swapping,
        swapPhase: s.swapPhase,
        fault: faultOf.get(id) || null,
        signal: signalOf.get(id) || null
      }
    })
    // 可派的车：没在换电、没故障
    const free = new Set(
      state.filter((a) => !a.swapping && !a.fault).map((a) => a.i)
    )
    const lines = [...lineOf.entries()].sort((a, b) =>
      a[1].ln.id.localeCompare(b[1].ln.id)
    )
    const tasks = new Map()
    for (const [ci, { c, ln }] of lines) {
      const cyc = cycleOf(ln, ms)
      const members = []
      for (const i of prefs(ln.id)) {
        if (members.length >= cyc.need) break
        if (free.has(i)) {
          members.push(i)
          free.delete(i)
        }
      }
      // 先卸后装：已完成箱量没到卸船量时是卸船（重载从岸桥去箱区），之后是装船
      const mode = lineDone(ln, ms) < ln.dis ? "discharge" : "load"
      members.forEach((i, k) =>
        tasks.set(i, {
          crane: ci,
          call: c,
          ln,
          k,
          n: members.length,
          cyc,
          mode
        })
      )
    }
    let idleSlot = 0
    for (const a of state) {
      const tk = tasks.get(a.i)
      if (a.fault) a.state = "fault"
      else if (a.swapping) a.state = "swap"
      else if (!tk) {
        a.state = "idle"
        a.park = idleSlot++
      } else if (tk.ln.fault && ms >= tk.ln.fault.at && ms < tk.ln.fault.end) {
        // 岸桥故障停机：这一路的 AGV 停在岸桥下排队，不再往返
        a.task = tk
        a.phaseSec = 0
        a.state = "queue"
      } else {
        a.task = tk
        // 往返相位：交接 @岸桥 → 去箱区 → 交接 @箱区 → 回岸桥
        const { T, travel } = tk.cyc
        const x = frac(((ms - tk.ln.start) / 1000 + (tk.k * T) / tk.n) / T) * T
        a.phaseSec = x
        const laden =
          tk.mode === "discharge"
            ? x >= QC_HANDOVER && x < QC_HANDOVER + travel
            : x >= QC_HANDOVER + travel + BLOCK_HANDOVER
        a.state = x < QC_HANDOVER ? "queue" : laden ? "laden" : "empty"
      }
    }
    return { state, lineOf }
  }

  /** 事件开始前 1 秒那一刻的位置（故障停车、定位中断用），按事件编号缓存 */
  const frozenCache = new Map()
  function frozenPose(a, ev) {
    const key = `${ev.id}|${a.i}`
    if (!frozenCache.has(key)) {
      const prev = agvsAt(ev.at - 1000).state[a.i]
      const ok = prev.state !== "fault" && !prev.signal
      frozenCache.set(
        key,
        ok
          ? agvPose(prev, ev.at - 1000)
          : { u: layout.quay.u1 / 2, v: vBuf, h: Math.PI / 2 }
      )
      if (frozenCache.size > 400)
        frozenCache.delete(frozenCache.keys().next().value)
    }
    return frozenCache.get(key)
  }

  /** AGV 在平面上的位置（u, v）与朝向（弧度，0 = 沿 +u）；页面再换算成三维坐标并做平滑 */
  function agvPose(a, ms) {
    // 定位中断：系统里只有中断前最后一次上报的位置，大屏显示的就是它（车其实还在走）
    if (a.signal && ms > a.signal.at)
      return { ...frozenPose(a, a.signal), frozen: true }
    // 故障停车：停在故障发生时的位置
    if (a.state === "fault" && a.fault) return frozenPose(a, a.fault)
    if (a.state === "swap") {
      const st = layout.swapStations[a.i % layout.swapStations.length]
      const slot = Math.floor(a.i / layout.swapStations.length) % st.slots
      const u = lerp(st.u0 + 2, st.u1 - 2, (slot + 0.5) / st.slots)
      return { u, v: (st.v0 + st.v1) / 2, h: Math.PI / 2 }
    }
    if (a.state === "idle" || a.state === "fault" || !a.task) {
      // 缓冲带垂直停车（间距 4.5 m），从码头中部向两侧排
      const k = a.park ?? a.i
      const u =
        layout.quay.u1 / 2 +
        (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 9 +
        (a.i % 2) * 4.5
      return { u: clamp(u, 20, layout.quay.u1 - 20), v: vBuf, h: Math.PI / 2 }
    }
    const { ln, cyc, k, n } = a.task
    const x = a.phaseSec
    const uq = ln.u + (k - (n - 1) / 2) * 6
    const ub = cyc.block.u + ((a.i % 3) - 1) * 9
    const dir = Math.sign(ub - uq) || 1
    // 去箱区用陆侧几条车道，回岸桥用海侧几条（单向循环，避免对向）
    const laneGo = lanes[lanes.length - 1 - (a.i % 3)]
    const laneBack = lanes[a.i % 3]
    const path = (pts, t) => {
      // 沿折线按长度插值
      let L = 0
      const seg = []
      for (let j = 1; j < pts.length; j++) {
        const d = Math.hypot(
          pts[j][0] - pts[j - 1][0],
          pts[j][1] - pts[j - 1][1]
        )
        seg.push(d)
        L += d
      }
      let s = clamp(t, 0, 1) * L
      for (let j = 0; j < seg.length; j++) {
        if (s <= seg[j] || j === seg.length - 1) {
          const f = seg[j] ? s / seg[j] : 0
          const [u0, v0] = pts[j]
          const [u1, v1] = pts[j + 1]
          return {
            u: lerp(u0, u1, f),
            v: lerp(v0, v1, f),
            h: Math.atan2(v1 - v0, u1 - u0)
          }
        }
        s -= seg[j]
      }
      return { u: pts[0][0], v: pts[0][1], h: 0 }
    }
    const { travel } = cyc
    if (x < QC_HANDOVER) return { u: uq, v: vQc, h: Math.PI / 2 }
    if (x < QC_HANDOVER + travel)
      return path(
        [
          [uq, vQc],
          [uq + dir * 12, laneGo],
          [ub - dir * 12, laneGo],
          [ub, vEx]
        ],
        (x - QC_HANDOVER) / travel
      )
    if (x < QC_HANDOVER + travel + BLOCK_HANDOVER)
      return { u: ub, v: vEx, h: Math.PI / 2 }
    return path(
      [
        [ub, vEx],
        [ub - dir * 12, laneBack],
        [uq + dir * 12, laneBack],
        [uq, vQc]
      ],
      (x - QC_HANDOVER - travel - BLOCK_HANDOVER) / travel
    )
  }

  /* ---------- 气象 ---------- */
  function metAt(ms) {
    const ds = dayStartOf(ms)
    const { base } = dayEvents(ds)
    const h = (ms - ds) / HOUR
    // 午后海风略大 + 10 分钟一档的阵性波动 + 阵风事件
    let wind =
      base.wind +
      1.6 * Math.sin(((h - 9) / 24) * 2 * Math.PI) +
      (hash01(`wind:${Math.floor(ms / SLOT)}`) - 0.5) * 1.6
    const gustEv = windEventAt(ms)
    if (gustEv) {
      const x = (ms - gustEv.at) / (gustEv.end - gustEv.at)
      wind = Math.max(wind, lerp(wind, gustEv.peak, Math.sin(Math.PI * x)))
    }
    wind = clamp(wind, 0.5, 30)
    const gust = wind * (1.25 + hash01(`gust:${Math.floor(ms / MIN)}`) * 0.15)
    const dir = (base.dir + 20 * Math.sin(h / 4)) % 360
    // 潮位（理论最低潮面起算，米）：半日潮为主，振幅按长江口外量级取（假设）；不涉及水深
    const t = ms / HOUR
    const tide =
      2.1 +
      1.6 * Math.cos(((t - 3.2) / 12.42) * 2 * Math.PI) +
      0.25 * Math.cos(((t - 7) / 24.84) * 2 * Math.PI)
    return { wind, gust, dir, tide, gustEvent: gustEv }
  }

  /* ---------- 箱区 ---------- */
  function blocksAt(ms, lineOf) {
    const targeted = new Map()
    for (const [, { ln }] of lineOf) {
      const b = lineTarget(ln, ms)
      targeted.set(b, (targeted.get(b) || 0) + 1)
    }
    return blocks.map((b) => {
      // 堆存率：按周、按日慢变化（进口箱提走、出口箱集港），落在 45–92%
      const ph = hash01(`${b.id}:ph`) * 6.28
      const fill = clamp(
        lerp(0.55, 0.82, hash01(`${b.id}:base`)) +
          0.06 * Math.sin((ms / WEEK) * 6.28 + ph) +
          0.03 * Math.sin((ms / DAY) * 6.28 + ph * 2),
        0.45,
        0.92
      )
      const teu = Math.round(b.capTeu * fill)
      const rmg = b.rmg.map((side) => {
        const id = `${b.id}-${side}`
        const f = rmgFaultAt(id, ms)
        let state
        if (f) state = "fault"
        else if (side === "S") state = targeted.has(b.id) ? "work" : "idle"
        // 陆侧吊：给外集卡收发箱，每 10 分钟一档，约 45% 的时间在作业
        else
          state =
            hash01(`${id}:${Math.floor(ms / SLOT)}`) < 0.45 ? "work" : "idle"
        return { id, side, state, fault: f }
      })
      return {
        id: b.id,
        fill,
        teu,
        cap: b.capTeu,
        reefer: b.reefer,
        rmg,
        agvLines: targeted.get(b.id) || 0
      }
    })
  }

  /* ---------- 对外：某一时刻的完整状态 ---------- */
  function at(ms = Date.now()) {
    const clock = beijing(ms)
    const { active, pos, lineOf, blocked } = cranesAt(ms)
    const evs = eventsAt(ms)
    const met = metAt(ms)
    const today = craneToday(ms)

    // 船舶
    const vessels = []
    for (const c of callsNear(ms, 0, 24 * HOUR)) {
      const stage = stageOf(c, ms)
      if (stage === "gone") continue
      const done = c.lines.reduce((n, ln) => n + lineDone(ln, ms), 0)
      const disDone = c.lines.reduce(
        (n, ln) => n + Math.min(ln.dis, lineDone(ln, ms)),
        0
      )
      const workH = Math.max(0, Math.min(ms, c.workEnd) - c.workStart) / HOUR
      const craneOfLine = new Map()
      for (const [ci, a] of lineOf)
        if (a.c === c) craneOfLine.set(a.ln.idx, craneIds[ci])
      vessels.push({
        id: c.id,
        name: c.name,
        voyage: c.voyage,
        route: c.svc.route.name,
        carrier: c.svc.route.carrier,
        cls: c.cls,
        clsName: c.def.name,
        teuClass: c.def.teu,
        loa: c.def.loa,
        beam: c.def.beam,
        u0: c.u0,
        u1: c.u1,
        bowEast: c.bowEast,
        berths: layout.berths
          .filter((b) => b.u1 > c.u0 && b.u0 < c.u1)
          .map((b) => b.id),
        stage,
        planStart: c.planStart,
        planEnd: c.planEnd,
        eta: c.eta,
        tb: c.tb,
        workStart: c.workStart,
        workEnd: c.workEnd,
        depart: c.depart,
        delayMin: c.delayMin,
        moves: c.moves,
        dis: c.dis,
        load: c.moves - c.dis,
        done: Math.round(done),
        disDone: Math.round(disDone),
        loadDone: Math.round(done - disDone),
        teu: Math.round(c.moves * c.teuPerBox),
        // 船时效率：从开工计到当前（自然箱/h）
        rate: workH > 0.2 ? done / workH : 0,
        lines: c.lines.map((ln) => ({
          id: ln.id,
          u: ln.u,
          total: ln.total,
          done: Math.round(lineDone(ln, ms)),
          crane: craneOfLine.get(ln.idx) || null,
          working: ms >= ln.start && ms < ln.end,
          fault:
            ln.fault && ms >= ln.fault.at && ms < ln.fault.end ? ln.fault : null
        }))
      })
    }

    // 岸桥
    const cranes = craneIds.map((id, ci) => {
      const a = lineOf.get(ci)
      const fault =
        a && a.ln.fault && ms >= a.ln.fault.at && ms < a.ln.fault.end
      const sensor = activeEvent(evs, "sensor", id)
      const state = blocked.has(ci)
        ? "maint"
        : !a
          ? "idle"
          : fault
            ? "fault"
            : "work"
      const s = Math.floor(ms / SLOT)
      const rate = state === "work" ? a.ln.rate * slotFactor(a.c, a.ln, s) : 0
      return {
        id,
        u: pos[ci],
        state,
        vessel: a ? a.c.id : null,
        line: a ? a.ln.id : null,
        rate,
        remain: a ? Math.round(a.ln.total - lineDone(a.ln, ms)) : 0,
        movesToday: Math.round(today.moves[ci]),
        teuToday: Math.round(today.teu[ci]),
        hoursToday: today.hours[ci],
        // 台时量：今日作业箱量 ÷ 今日作业小时
        tph: today.hours[ci] > 0.3 ? today.moves[ci] / today.hours[ci] : 0,
        wind: met.wind * (1.08 + (hash01(`${id}:wf`) - 0.5) * 0.08),
        windQ: sensor ? "uncertain" : "good",
        target: a ? lineTarget(a.ln, ms) : null
      }
    })

    // AGV
    const ag = agvsAt(ms)
    const agvs = ag.state.map((a) => ({
      id: a.id,
      state: a.state,
      soc: a.soc,
      crane: a.task ? craneIds[a.task.crane] : null,
      block: a.task ? a.task.cyc.block.id : null,
      vessel: a.task ? a.task.call.id : null,
      signalLost: !!a.signal
    }))

    // 换电站：正在换电 / 往返的车按下标分到两站
    const swaps = layout.swapStations.map((st, k) => {
      const here = ag.state.filter(
        (a) => a.state === "swap" && a.i % layout.swapStations.length === k
      )
      const inStation = here.filter(
        (a) => a.swapPhase > 0.25 && a.swapPhase < 0.75
      )
      // 今日换电次数：按每台车的锯齿周期数出来
      const ds = clock.dayStart
      let n = 0
      agvSoc.forEach((p, i) => {
        if (i % layout.swapStations.length !== k) return
        n += Math.max(
          0,
          Math.floor(ms / p.period + p.phase) -
            Math.floor(ds / p.period + p.phase)
        )
      })
      return {
        id: st.id,
        swapping: inStation.length,
        queue: here.length - inStation.length,
        // 满电电池：16 个充电位里正在充的按 2 小时充满推算（假设）
        full: clamp(
          st.slots - Math.round(n % 7) - inStation.length,
          4,
          st.slots
        ),
        swapsToday: n
      }
    })

    const blockState = blocksAt(ms, lineOf)

    // 汇总（全部从明细算）
    const count = (arr, key, val) => arr.filter((x) => x[key] === val).length
    const rmgAll = blockState.flatMap((b) => b.rmg)
    const working = vessels.filter((v) =>
      ["moored", "working", "finishing"].includes(v.stage)
    )
    const movesToday = cranes.reduce((n, c) => n + c.movesToday, 0)
    const teuToday = cranes.reduce((n, c) => n + c.teuToday, 0)
    const hoursToday = cranes.reduce((n, c) => n + c.hoursToday, 0)
    const kpi = {
      movesToday,
      teuToday,
      vesselsAtBerth: working.length,
      vesselsAnchor: count(vessels, "stage", "anchor"),
      qc: {
        total: cranes.length,
        work: count(cranes, "state", "work"),
        idle: count(cranes, "state", "idle"),
        fault: count(cranes, "state", "fault"),
        maint: count(cranes, "state", "maint")
      },
      rmg: {
        total: rmgAll.length,
        work: count(rmgAll, "state", "work"),
        idle: count(rmgAll, "state", "idle"),
        fault: count(rmgAll, "state", "fault")
      },
      agv: {
        total: agvs.length,
        laden: count(agvs, "state", "laden"),
        empty: count(agvs, "state", "empty"),
        queue: count(agvs, "state", "queue"),
        idle: count(agvs, "state", "idle"),
        swap: count(agvs, "state", "swap"),
        fault: count(agvs, "state", "fault")
      },
      yardTeu: blockState.reduce((n, b) => n + b.teu, 0),
      yardCap: blockState.reduce((n, b) => n + b.cap, 0),
      // 岸桥平均台时量：今日全部作业箱量 ÷ 全部作业小时（不是各台台时量的平均）
      qcTph: hoursToday > 0 ? movesToday / hoursToday : 0,
      // 平均船时效率：在泊作业船的船时效率按作业小时加权
      vesselRate: (() => {
        let m = 0
        let h = 0
        for (const v of working) {
          const hh = Math.max(0, Math.min(ms, v.workEnd) - v.workStart) / HOUR
          if (hh > 0.2) {
            m += v.done
            h += hh
          }
        }
        return h > 0 ? m / h : 0
      })(),
      alarmsActive: evs.filter((e) => e.status !== "resolved").length
    }
    kpi.yardFill = kpi.yardTeu / kpi.yardCap

    return {
      t: ms,
      clock,
      vessels,
      cranes,
      agvs,
      swaps,
      blocks: blockState,
      met,
      kpi,
      events: evs,
      activeLines: active.length
    }
  }

  /** 全部 AGV 的位置（页面每帧调用；状态按秒缓存） */
  function agvPoses(ms = Date.now()) {
    const { state } = agvsAt(ms)
    return state.map((a) => ({ id: a.id, state: a.state, ...agvPose(a, ms) }))
  }

  /** 泊位计划（甘特）：时间窗内的全部航次 */
  function schedule(from, to) {
    return callsNear(from, 0, to - from)
      .filter((c) => c.gone > from && c.planStart < to)
      .map((c) => ({
        id: c.id,
        name: c.name,
        voyage: c.voyage,
        cls: c.cls,
        clsName: c.def.name,
        route: c.svc.route.name,
        u0: c.u0,
        u1: c.u1,
        planStart: c.planStart,
        planEnd: c.planEnd,
        tb: c.tb,
        depart: c.depart,
        delayMin: c.delayMin,
        moves: c.moves
      }))
  }

  return { at, agvPoses, schedule, services, eventsAt, beijing }
}

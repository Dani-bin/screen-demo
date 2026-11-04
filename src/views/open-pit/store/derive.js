/**
 * 青原露天矿：面板数据派生（纯函数，不依赖 Vue，Node 里也能跑，方便和设计稿的 design.json 对账）
 * ----------------------------------------------------------
 * 把仿真器的原始状态整理成面板直接渲染的结构。结构沿用 docs/design/open-pit/mock/design.json，
 * 装配逻辑移植自 scripts/open-pit/mock.mjs 的「设计稿用的明细与曲线」一段，
 * 所以设计时刻（2026-10-30 20:30）算出来的数字和设计稿完全一致。
 *   buildFast(sim, layout, ms)   每秒一次的快数据：指标、编组、电铲、换电、边坡、通信、事件……
 *   buildSlow(sim, ms)           每 10 秒一次的慢数据：分时运量、光伏曲线、边坡速率走势、车队时间条、异常车辆名单
 *   detailOf(id, fast, layout)   选中详情卡的内容（卡车 / 电铲 / 雷达 / 基站 / 卸载点等）
 * 屏上的数字一律从这里的结果派生，汇总值（运量、台数、年累）都是从明细加出来的。
 */
import {
  GROUP_NAME,
  PHASE,
  PHASE_NAME,
  SHOVEL_STATE,
  beijing,
  msForBeijing
} from "../sim/simulator.js"

const MIN = 60000
export const pad = (n, w = 2) => String(n).padStart(w, "0")
export const r1 = (x) => Math.round(x * 10) / 10
export const r2 = (x) => Math.round(x * 100) / 100
export const f1 = (x) => r1(x).toFixed(1)
export const f2 = (x) => r2(x).toFixed(2)

/** 北京时间 HH:MM */
export function hhmm(ms) {
  const d = new Date(ms + 8 * 3600e3)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** 车辆六类状态：键、名称、图表标记色（颜色已用 dataviz 校验，见 tokens） */
export const ST = [
  { k: "run", n: "运行", c: "var(--c-run)" },
  { k: "load", n: "装卸", c: "var(--c-load)" },
  { k: "queue", n: "排队", c: "var(--c-queue)" },
  { k: "swap", n: "换电", c: "var(--c-swap)" },
  { k: "idle", n: "待命", c: "var(--c-idle)" },
  { k: "fault", n: "故障", c: "var(--c-fault)" }
]
/** 状态名 → 色（单车列表、详情卡的状态方块；故障用状态红） */
export const STATE_COLOR = {
  运行: "var(--c-run)",
  装卸: "var(--c-load)",
  排队: "var(--c-queue)",
  换电: "var(--c-swap)",
  待命: "var(--c-idle)",
  故障: "var(--fault)"
}
/** 细分状态 → 六类（和仿真器的 GROUP_OF 同义，这里按名字给单车列表用） */
export const GROUP_BY_STATE = {
  空载返回: "运行",
  重载运行: "运行",
  装载中: "装卸",
  卸载中: "装卸",
  排队等装: "排队",
  排队待卸: "排队",
  前往换电: "换电",
  排队换电: "换电",
  换电中: "换电",
  待命: "待命",
  故障: "故障"
}
export const SECTOR_NAME = {
  "SR-01": "西北帮",
  "SR-02": "北帮",
  "SR-03": "东北帮"
}
export const LEVEL_NAME = ["正常", "一级关注", "二级预警", "三级告警"]
export const LEVEL_COLOR = [
  "var(--ok)",
  "var(--neon-amber)",
  "var(--warn)",
  "var(--fault)"
]
export const SHOVEL_COLOR = {
  装车中: "var(--c-run)",
  待车: "var(--c-idle)",
  移位: "var(--neon-amber)",
  暂停: "var(--neon-amber)",
  故障: "var(--fault)"
}
export const SINK_NAME = {
  "CR-01": "破碎站 1",
  "CR-02": "破碎站 2",
  "DP-W": "西排土场",
  "DP-I": "内排土场"
}

/** 卸载点：CR 开头是破碎站（煤），DP 开头是排土场（剥离） */
const isCoalSink = (id) => id.startsWith("CR")

/**
 * 每秒一次的快数据（sim.at + sim.monitors + 近 4 小时事件）
 * @returns {object} 结构见文件头；.s / .m 是仿真器原始结果，场景和详情卡也用
 */
export function buildFast(sim, layout, ms) {
  const s = sim.at(ms)
  const m = sim.monitors(ms)
  const bj = beijing(ms)
  const dayStart = msForBeijing(bj.date, 0)

  // ---- 事件：近 4 小时，最近的在前；「异常」= 此刻仍在持续的事件（含提示级） ----
  const events = sim
    .eventsBetween(ms - 4 * 3600e3, ms)
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      title: e.title,
      level: e.level,
      target: e.target,
      fromMs: e.from,
      from: hhmm(e.from),
      to: hhmm(e.to),
      active: e.from <= ms && e.to >= ms,
      desc: e.desc
    }))
    .sort((a, b) => b.fromMs - a.fromMs)
  const alarmN = events.filter((e) => e.active).length

  // ---- 车队：六类状态台数，汇总来自明细 ----
  const nT = s.trucks.length
  const groups = GROUP_NAME.map((name, i) => ({
    key: ST[i].k,
    name,
    n: s.counts[i]
  }))
  const faultN = s.counts[5]
  const onlineN = nT - faultN

  // ---- 卸载点：运量由卸载点明细加出来 ----
  const sinks = s.sinks.map((x) => ({
    id: x.id,
    tons: x.tons,
    tonsWt: r2(x.tons / 1e4),
    queue: x.queue
  }))
  const coalT = sinks
    .filter((x) => isCoalSink(x.id))
    .reduce((a, x) => a + x.tons, 0)
  const stripT = sinks
    .filter((x) => !isCoalSink(x.id))
    .reduce((a, x) => a + x.tons, 0)
  const bays = (id) => layout.devices.find((d) => d.id === id)?.bays ?? 4
  const stations = s.stations.map((x) => ({ ...x, bays: bays(x.id) }))

  const ytdCoal = s.ytd.coal
  const ytdStrip = s.ytd.strip
  const kpi = {
    todayWt: r2((coalT + stripT) / 1e4),
    coalWt: r2(coalT / 1e4),
    stripWt: r2(stripT / 1e4),
    coalPct: (coalT / (coalT + stripT || 1)) * 100,
    ytdWt: r1(ytdCoal + ytdStrip),
    ytdCoalWt: r1(ytdCoal),
    ytdStripWt: r1(ytdStrip),
    attendance: r1((onlineN / nT) * 100),
    trucksN: nT,
    onlineN,
    faultN,
    loads: s.today.loads,
    swaps: s.today.swaps,
    swapMin: layout.design.swapMin,
    queueSum: stations.reduce((a, x) => a + x.queue, 0),
    poolFull: s.pool.full
  }

  // ---- 五个编组 ----
  const byId = new Map()
  s.trucks.forEach((t) => byId.set(t.id, t))
  const fleets = layout.fleets.map((f) => {
    const ts = s.trucks.filter((t) => t.fleet === f.id)
    const counts = {}
    ST.forEach((x) => (counts[x.k] = 0))
    ts.forEach((t) => counts[ST[t.group].k]++)
    return {
      id: f.id,
      name: f.name,
      n: ts.length,
      counts,
      avgSoc: r1(ts.reduce((a, t) => a + t.soc, 0) / ts.length),
      loadsToday: ts.reduce((a, t) => a + t.loads, 0),
      tonsToday: r1(ts.reduce((a, t) => a + t.tons, 0))
    }
  })

  // ---- 电铲 ----
  const shovels = s.shovels.map((x) => ({
    id: x.id,
    fleet: x.fleet,
    state: SHOVEL_STATE[x.state],
    queue: x.queue,
    loads: x.loads,
    tons: x.tons
  }))

  // ---- 能源、煤流 ----
  const energy = {
    pvKw: Math.round(s.energy.pvKw),
    chgKw: Math.round(s.energy.chgKw),
    pvKwh: Math.round(s.energy.pvKwh),
    chgKwh: Math.round(s.energy.chgKwh),
    greenRatio: r1((s.energy.pvUsedKwh / Math.max(1, s.energy.chgKwh)) * 100)
  }
  const yard = {
    t: Math.round(s.yard.t),
    cap: s.yard.cap,
    ratio: r1((s.yard.t / s.yard.cap) * 100),
    beltTph: Math.round(s.yard.beltTph),
    burnTph: Math.round(s.yard.burnTph)
  }

  // ---- 边坡与水文 ----
  const radar = m.radar.map((r) => ({
    id: r.id,
    velMmH: r2(r.velMmH),
    level: r.level,
    dispMax: r1(r.dispMax)
  }))
  // 最需要关注的雷达：先比预警等级，再比速率
  const topRadar = [...radar].sort(
    (a, b) => b.level - a.level || b.velMmH - a.velMmH
  )[0]
  const topGnss = [...m.gnss]
    .sort((a, b) => b.vel - a.vel)
    .slice(0, 6)
    .map((g) => ({
      id: g.id,
      sector: g.sector,
      velMmH: r2(g.vel),
      dispMm: r1(g.disp)
    }))
  // 基站离线 → 它覆盖的 GNSS 站数据过期（只有脚本日有离线基站，覆盖范围来自脚本）
  const offBs = m.bs.find((b) => !b.online)
  const bsOff = m.script?.bsOff
  const stale = offBs
    ? {
        bsId: offBs.id,
        sites:
          bsOff && bsOff.id === offBs.id
            ? `GN-${pad(Math.min(...bsOff.sites), 3)}…${pad(Math.max(...bsOff.sites), 3)}`
            : null,
        minutesAgo: bsOff
          ? Math.max(0, Math.round((ms - (dayStart + bsOff.from * 1000)) / MIN))
          : null
      }
    : null
  // 水位读数漂移：脚本里的 GW 在漂移窗口内标「待复核」
  const gd = m.script?.gwDrift
  const gwDrift = gd && bj.sec >= gd.from && bj.sec < gd.to ? gd.id : null
  const gwLevels = m.gw.map((g) => g.levelM)
  const groundwater = {
    n: m.gw.length,
    minM: r2(Math.min(...gwLevels)),
    maxM: r2(Math.max(...gwLevels)),
    drift: gwDrift
  }

  // ---- 通信 ----
  const online = m.bs.filter((b) => b.online)
  const comms = {
    online: online.length,
    total: m.bs.length,
    avgUpMbps: Math.round(
      online.reduce((a, b) => a + b.upMbps, 0) / (online.length || 1)
    ),
    bs: m.bs
  }

  return {
    ms,
    s,
    m,
    byId,
    clock: {
      time: `${pad(bj.h)}:${pad(bj.m)}:${pad(bj.s)}`,
      date: `${bj.date}  周${"日一二三四五六"[new Date(ms + 8 * 3600e3).getUTCDay()]}  北京时间`
    },
    alarmN,
    events,
    kpi,
    groups,
    fleets,
    shovels,
    sinks,
    stations,
    pool: s.pool,
    energy,
    yard,
    slope: {
      radar,
      topRadar,
      topGnss,
      stale,
      groundwater,
      pointN: m.gnss.length + m.radar.length
    },
    comms
  }
}

/**
 * 每 10 秒一次的慢数据：曲线和名单，重算一次要多次调用 sim.at
 * ms 之前的曲线只取到 ms（跟随真实时间时就是「今天到现在」）。
 */
export function buildSlow(sim, ms) {
  const bj = beijing(ms)
  const dayStart = msForBeijing(bj.date, 0)

  // 分时运量：每小时的增量；最后一格是当前小时已过的部分
  const snaps = []
  for (let h = 0; h <= bj.h + 1; h++)
    snaps.push(sim.at(Math.min(ms, dayStart + h * 3600e3)))
  const hourly = []
  for (let h = 0; h <= bj.h; h++) {
    const a = snaps[h].today
    const b = snaps[h + 1].today
    hourly.push({
      h,
      coalT: r1(b.coalT - a.coalT),
      stripT: r1(b.stripT - a.stripT),
      swaps: b.swaps - a.swaps
    })
  }

  // 光伏曲线：整天的出力（5–21 点每 0.5 h 取样），再裁到「有出力的时段前后各留一点」，至少 6–18 点
  const raw = []
  for (let h = 5; h <= 21; h += 0.5)
    raw.push({
      h,
      kw: Math.round(sim.at(dayStart + h * 3600e3).energy.pvKw)
    })
  const lit = raw.filter((p) => p.kw > 0)
  const lo = Math.min(6, lit.length ? lit[0].h - 0.5 : 6)
  const hi = Math.max(18, lit.length ? lit[lit.length - 1].h + 0.5 : 18)
  const pvCurve = raw.filter((p) => p.h >= lo && p.h <= hi)

  // 最需要关注的雷达近 6 小时速率走势（每 15 min 一点）
  const mNow = sim.monitors(ms)
  const topIdx = [...mNow.radar.keys()].sort(
    (a, b) =>
      mNow.radar[b].level - mNow.radar[a].level ||
      mNow.radar[b].velMmH - mNow.radar[a].velMmH
  )[0]
  const spark = []
  for (let min = -360; min <= 0; min += 15)
    spark.push({
      min,
      v: r2(sim.monitors(ms + min * MIN).radar[topIdx].velMmH)
    })
  const sparkRadar = {
    id: mNow.radar[topIdx].id,
    points: spark
  }

  // 车队状态时间条：过去 6 小时六类状态台数（每 15 min 一点）
  const fleetTimeline = []
  for (let min = -360; min <= 0; min += 15)
    fleetTimeline.push({ min, counts: sim.at(ms + min * MIN).counts })

  // 单车列表的名单：故障、低电量（< 32%）或排队第 2 位以后的车；故障在前、电量低的在前，取 10 台
  // snaps 的最后一格就是 ms 此刻的完整状态
  const notableIds = snaps[bj.h + 1].trucks
    .filter((t) => t.phase === PHASE.FAULT || t.soc < 32 || t.qpos > 1)
    .sort(
      (a, b) =>
        (b.phase === PHASE.FAULT) - (a.phase === PHASE.FAULT) || a.soc - b.soc
    )
    .slice(0, 10)
    .map((t) => t.id)

  return { ms, hourly, pvCurve, sparkRadar, fleetTimeline, notableIds }
}

/** 单车列表 / 详情用的一行（取整规则同设计稿：电量保留一位小数） */
export function truckRow(t) {
  return {
    id: t.id,
    fleet: t.fleet,
    state: PHASE_NAME[t.phase],
    soc: r1(t.soc),
    loadsToday: t.loads,
    tons: r1(t.tons),
    phase: t.phase,
    group: t.group
  }
}

/** 某编组的单车名单（点选编组行时单车列表用）：故障在前，其余按电量从低到高，取 10 台 */
export function fleetNotable(fast, fleetId, n = 10) {
  return fast.s.trucks
    .filter((t) => t.fleet === fleetId)
    .sort(
      (a, b) =>
        (b.phase === PHASE.FAULT) - (a.phase === PHASE.FAULT) || a.soc - b.soc
    )
    .slice(0, n)
    .map((t) => t.id)
}

/** 卡车当前动作的一句话说明（详情卡「动作」行） */
function truckAction(t, routes) {
  const sink = SINK_NAME[routes[t.route]?.sink] || ""
  switch (t.phase) {
    case PHASE.EMPTY:
      return "空载返回装载区"
    case PHASE.QUEUE_LOAD:
      return `排队等装 · 第 ${t.qpos || 1} 位`
    case PHASE.LOAD:
      return "电铲装车中"
    case PHASE.HAUL:
      return `重载驶往${sink}`
    case PHASE.QUEUE_UNLOAD:
      return `排队待卸 · ${sink} 第 ${t.qpos || 1} 位`
    case PHASE.UNLOAD:
      return `${sink}卸载中`
    case PHASE.TO_SWAP:
      return "前往换电站"
    case PHASE.QUEUE_SWAP:
      return `换电站排队 · 第 ${t.qpos || 1} 位`
    case PHASE.SWAP:
      return "换电中"
    case PHASE.IDLE:
      return "待命区待命"
    default:
      return ""
  }
}

/** 编号是不是布局里的设备（卡车、电铲、雷达、基站……）：事件点选、标签点选前先过这一关 */
export function isKnownId(layout, id) {
  return !!id && layout.devices.some((d) => d.id === id)
}

/**
 * 选中详情卡的内容。rows 里每一行：
 *   { k: 标签, v: 文本 }                 普通行
 *   { k, v, sq: 色 }                     带状态色方块的行（color 可选，整行文字也染色）
 *   { k, bar: 百分比, v }                 进度条 + 数值
 *   { k, v, sub }                        主值 + 次要说明
 * tone：fault / warn / ok / info，决定边框和「已选」徽标的颜色
 */
export function detailOf(id, fast, layout, routes) {
  if (!id || !fast) return null
  const dev = layout.devices.find((d) => d.id === id)
  const name = dev?.name || id

  // ---- 卡车 ----
  const t = fast.byId.get(id)
  if (t) {
    const fl = layout.fleets.find((f) => f.id === t.fleet)
    const row = truckRow(t)
    const fault = t.phase === PHASE.FAULT
    // 故障原因 / 开始时间取该车最近的故障事件
    const ev = fast.events.find(
      (e) => e.target === id && e.kind === "truckFault"
    )
    const grp = ST[t.group]
    const rows = [
      { k: "编组", v: `${fl.id} · ${fl.name}` },
      fault
        ? {
            k: "状态",
            v: `故障停运${ev ? ` · ${ev.from} 起` : ""}`,
            sq: "var(--fault)",
            color: "var(--fault)"
          }
        : { k: "状态", v: row.state, sq: STATE_COLOR[grp.n] },
      fault
        ? { k: "原因", v: ev ? ev.desc : "自检未通过" }
        : { k: "动作", v: truckAction(t, routes) },
      {
        k: "电量",
        bar: row.soc,
        // 低电量（< 32%，和单车列表的橙色阈值一致）用橙色
        barColor: row.soc < 32 ? "var(--warn)" : "var(--c-run)",
        v: `${Math.round(row.soc)}%`
      },
      {
        k: "今日趟数",
        // 设计稿的详情卡这一行只有趟数，今日运量在编组卡的「今日趟数」旁和分时运量里看
        v: String(row.loadsToday)
      }
    ]
    return {
      kind: "truck",
      id,
      title: id,
      tone: fault ? "fault" : row.soc < 32 ? "warn" : "info",
      rows
    }
  }

  // ---- 电铲 ----
  const sh = fast.shovels.find((x) => x.id === id)
  if (sh) {
    const fl = layout.fleets.find((f) => f.id === sh.fleet)
    return {
      kind: "shovel",
      id,
      title: id,
      sub: name,
      tone: sh.state === "故障" ? "fault" : "info",
      rows: [
        { k: "编组", v: `${fl.id} · ${fl.name}` },
        { k: "状态", v: sh.state, sq: SHOVEL_COLOR[sh.state] },
        { k: "排队", v: `${sh.queue} 台` },
        { k: "今日装车", v: String(sh.loads), sub: `${Math.round(sh.tons)} t` }
      ]
    }
  }

  // ---- 卸载点：破碎站 / 排土场 ----
  const sk = fast.sinks.find((x) => x.id === id)
  if (sk) {
    return {
      kind: "sink",
      id,
      title: id,
      sub: SINK_NAME[id],
      tone: "info",
      rows: [
        { k: "类型", v: isCoalSink(id) ? "破碎站（煤）" : "排土场（剥离）" },
        { k: "今日卸载", v: `${f2(sk.tonsWt)} 万吨` },
        { k: "排队", v: `${sk.queue} 台` }
      ]
    }
  }

  // ---- 换电站 ----
  const sw = fast.stations.find((x) => x.id === id)
  if (sw) {
    return {
      kind: "station",
      id,
      title: id,
      sub: name,
      tone: "info",
      rows: [
        { k: "工位", v: `${sw.busy} / ${sw.bays} 在换` },
        { k: "排队", v: `${sw.queue} 辆` },
        { k: "满电备用", v: `${fast.pool.full} 包` },
        { k: "换电用时", v: `${fast.kpi.swapMin} min / 次` }
      ]
    }
  }

  // ---- 边坡雷达 ----
  const rd = fast.slope.radar.find((x) => x.id === id)
  if (rd) {
    return {
      kind: "radar",
      id,
      title: id,
      sub: `${SECTOR_NAME[id]}雷达`,
      tone: rd.level >= 3 ? "fault" : rd.level >= 1 ? "warn" : "ok",
      rows: [
        {
          k: "预警",
          v: LEVEL_NAME[rd.level],
          sq: LEVEL_COLOR[rd.level],
          color: LEVEL_COLOR[rd.level]
        },
        { k: "位移速率", v: `${f2(rd.velMmH)} mm/h` },
        { k: "最大累计", v: `${f1(rd.dispMax)} mm` }
      ]
    }
  }

  // ---- 5G 基站 ----
  const bs = fast.comms.bs.find((x) => x.id === id)
  if (bs) {
    return {
      kind: "bs",
      id,
      title: id,
      sub: name,
      tone: bs.online ? "ok" : "warn",
      rows: [
        {
          k: "状态",
          v: bs.online ? "在线" : "离线",
          sq: bs.online ? "var(--ok)" : "var(--offline)",
          color: bs.online ? null : "var(--offline)"
        },
        { k: "上行", v: bs.online ? `${bs.upMbps} Mbps` : "—" },
        { k: "接入终端", v: bs.online ? `${bs.terminals} 台` : "—" }
      ]
    }
  }

  // ---- 地下水位 ----
  const gw = fast.m.gw.find((x) => x.id === id)
  if (gw) {
    const drift = fast.slope.groundwater.drift === id
    return {
      kind: "gw",
      id,
      title: id,
      sub: name,
      tone: drift ? "warn" : "ok",
      rows: [
        { k: "水位埋深", v: `${f1(gw.levelM + (drift ? 0.6 : 0))} m` },
        {
          k: "读数",
          v: drift ? "漂移 · 待复核" : "正常",
          sq: drift ? "var(--neon-amber)" : "var(--ok)"
        }
      ]
    }
  }

  // ---- 煤流：煤场 / 电厂 / 皮带 ----
  if (id === "CY-01")
    return {
      kind: "yard",
      id,
      title: id,
      sub: name,
      tone: "info",
      rows: [
        { k: "库存", v: `${Math.round(fast.yard.t / 1000)} kt` },
        {
          k: "充盈率",
          bar: fast.yard.ratio,
          barColor: "var(--c-coal)",
          v: `${f1(fast.yard.ratio)}%`
        },
        { k: "到煤", v: `${fast.yard.beltTph} t/h` }
      ]
    }
  if (id === "PP-01" || id === "BC-02")
    return {
      kind: "coal",
      id,
      title: id,
      sub: name,
      tone: "info",
      rows: [
        {
          k: id === "PP-01" ? "耗煤" : "到煤量",
          v: `${id === "PP-01" ? fast.yard.burnTph : fast.yard.beltTph} t/h`
        },
        { k: "煤场库存", v: `${f1(fast.yard.ratio)}%` }
      ]
    }

  // ---- 其余设备：只给名称与说明 ----
  if (dev)
    return {
      kind: dev.kind,
      id,
      title: id,
      sub: name,
      tone: "info",
      // 名称由详情卡根据 sub 补在第一行，这里只给说明（没有说明就给编号）
      rows: [dev.note ? { k: "说明", v: dev.note } : { k: "编号", v: id }]
    }
  return null
}

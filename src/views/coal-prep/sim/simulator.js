/*
 * 井上地面输送系统仿真器（虚构 · 青峰煤矿，主角 103 原煤上仓带式输送机）
 * ----------------------------------------------------------
 * 跟随北京时间运行，给出任意时刻 t 的原始量快照 at(t)：
 *   - 班次：00:00–08:00 检修班停机，08:00–24:00 两个生产班；运量按"日内曲线 + 小噪声"
 *   - 驱动部温振、光纤测温、托辊状态、跑偏、机器人、人员、告警事件
 *   - 第 5 组上托辊（6 m，主机位画面里）的轴承劣化按 7 天一个周期演进：听诊异响 → 三级 → 二级 → 检修班更换
 * 设计时刻 DESIGN_T（2026-10-27 18:40，定稿画的那一刻）的所有数值与设计稿 data.js 完全一致：
 *   连续量写成"定稿值 + (噪声(t) − 噪声(DESIGN_T))"，所以 ?at= 钉在那一刻时噪声项为 0。
 * 汇总数（功率合计、健康指数、计数……）不在这里算，由 store/board.js 从快照派生。
 */

/** 定稿那一刻（北京时间） */
export const DESIGN_T = Date.parse("2026-10-27T18:40:00+08:00")
const HOUR = 3600e3
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/** 北京时间的日期与时分秒 */
export function beijing(t) {
  const d = new Date(t + 8 * HOUR)
  const pad = (n) => String(n).padStart(2, "0")
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    md: `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    hms: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    week: "日一二三四五六"[d.getUTCDay()]
  }
}

/** 当天北京时间 00:00 的时间戳 */
const dayStart = (t) => Math.floor((t + 8 * HOUR) / DAY) * DAY - 8 * HOUR

/**
 * 平滑噪声：几条不同周期的正弦叠加，相位由 key 决定（固定种子，可复现）
 * @param {number} t 毫秒
 * @param {number} key 不同测点用不同的 key
 * @param {number} periodMin 主周期（分钟）
 */
function wave(t, key, periodMin = 7) {
  const s = t / 60e3
  const p = (k) => (Math.sin(key * 12.9898 + k * 78.233) * 43758.5453) % 1
  return (
    0.55 * Math.sin((2 * Math.PI * s) / periodMin + 6.28 * p(1)) +
    0.3 * Math.sin((2 * Math.PI * s) / (periodMin * 0.37) + 6.28 * p(2)) +
    0.15 * Math.sin((2 * Math.PI * s) / (periodMin * 3.1) + 6.28 * p(3))
  )
}
/** 以定稿时刻为零点的噪声：t = DESIGN_T 时恰好为 0 */
const dn = (t, key, amp, period) =>
  amp * (wave(t, key, period) - wave(DESIGN_T, key, period))

// ---------------- 静态参数（与设计稿 data.js 一致） ----------------
export const FOCUS = {
  id: "103",
  name: "原煤上仓带式输送机",
  width: 1400,
  beltType: "ST1600 钢丝绳芯",
  len: 248,
  angle: 14,
  vRated: 3.15,
  cap: 1000,
  motorRated: 315,
  idlerPitch: 1.2,
  idlerDia: 133
}

/** 地面 8 条皮带：额定运量与相对 103 的运量比例（健康指数为诊断模型输出） */
const BELTS = [
  { id: "101", name: "主斜井", cap: 1000, k: 1, health: 96 },
  { id: "102", name: "筛分给料", cap: 1000, k: 1, health: 94 },
  { id: "103", name: "原煤上仓", cap: 1000, k: 1, health: null },
  { id: "104", name: "入洗", cap: 900, k: 760 / 846, health: 93 },
  { id: "105", name: "精煤上仓", cap: 600, k: 456 / 846, health: 88 },
  { id: "106", name: "中煤上仓", cap: 600, k: 114 / 846, health: 97 },
  { id: "107", name: "矸石上仓", cap: 600, k: 152 / 846, health: 95 },
  { id: "108", name: "快速装车", cap: 4500, k: null, health: 92 }
]

/** 103 逐小时平均运量 t/h（日内曲线；00–08 检修） */
/** 每天起车时刻（分钟）：检修班结束后交接、巡检 10 min */
const START_MIN = 8 * 60 + 10

const FLOW_HOURLY = [
  0, 0, 0, 0, 0, 0, 0, 0, 702, 812, 836, 798, 744, 810, 852, 868, 790, 826, 864,
  846, 838, 852, 820, 806
]

/** 驱动部测点：定稿值（温度 ℃、振动烈度 mm/s、功率 kW） */
const DRIVE = [
  { id: "M1", name: "1# 电机", temp: 68, vib: 2.1, kw: 252 },
  { id: "M2", name: "2# 电机", temp: 66, vib: 1.9, kw: 246 },
  { id: "G1", name: "1# 减速机", temp: 72, vib: 2.6 },
  { id: "G2", name: "2# 减速机", temp: 74, vib: 3.2 },
  { id: "D1", name: "驱动滚筒轴承", temp: 54, vib: 1.4 }
]

/**
 * 劣化托辊组：一个周期内的关键时刻（相对周期起点 = 2026-10-24 21:06）。
 * 定稿原来写的是第 35 组（42 m），但概念图把热点画在机头后第 5 组附近；2026-10-28 用户决定热点放在主机位画面里，
 * 改成第 5 组（5.8 m，面板按 组号 × 1.2 显示 6 m）
 */
const T0 = Date.parse("2026-10-24T21:06:00+08:00")
const IDLER_STORY = {
  group: 5,
  start: 0, // 听诊异响
  l3: Date.parse("2026-10-26T09:40:00+08:00") - T0,
  l2: Date.parse("2026-10-27T18:12:00+08:00") - T0,
  fix: Date.parse("2026-10-28T08:00:00+08:00") - T0, // 检修班更换
  trip: Date.parse("2026-10-30T09:30:00+08:00") - T0 // 按温升外推的超温保护跳闸时刻
}
/** 另外两组轻度异常托辊（长期存在，评分慢慢起伏） */
const OTHER_IDLERS = [
  { group: 118, level: 3, rpm: 441, score: 58, note: "听诊异响" },
  { group: 162, level: 4, rpm: 402, score: 31, note: "转速偏低" }
]

/** 每天固定时刻发生的事件（告警），时刻为北京时间当天的分钟数 */
const DAILY_EVENTS = [
  {
    id: "A3",
    dim: "料",
    level: 3,
    min: 18 * 60 + 31,
    ttl: 45,
    title: "103 受料点大块煤 > 300 mm",
    src: "AI 视频",
    place: "103 · 236 m"
  },
  {
    id: "A4",
    dim: "人",
    level: 3,
    min: 17 * 60 + 56,
    ttl: 120,
    done: 14,
    title: "机头驱动区电子围栏闯入",
    src: "UWB · 检修人员已报备",
    place: "103 · 机头"
  },
  {
    id: "A5",
    dim: "机",
    level: 4,
    min: 18 * 60 + 29,
    ttl: 40,
    offline: true,
    title: "105 温振传感器通讯中断",
    src: "VT-105-03 · 离线",
    place: "105 · 机头"
  }
]

/**
 * 仿真器：at(t) 返回 t 时刻的原始量快照（纯函数，同一 t 结果相同）
 */
export function createSimulator() {
  /**
   * t 时刻的瞬时运量（检修班为 0）= 小时均值 − 18 + 小噪声
   * （定稿：18 点小时均值 864 t/h，18:40 瞬时 846 t/h；给煤有间歇，瞬时值略低于小时均值）
   */
  function flowAt(t) {
    const b = beijing(t)
    const base = FLOW_HOURLY[b.hour]
    if (!base || b.hour * 60 + b.minute < START_MIN) return 0
    return Math.max(0, Math.round(base - 18 + dn(t, 1, 14, 5)))
  }

  /** 今日 103 累计运量：已走完的整小时按小时均值，当前小时按已过去的分钟数 */
  function flowToday(t) {
    const b = beijing(t)
    const mins = b.hour * 60 + b.minute
    return FLOW_HOURLY.reduce(
      (acc, v, h) => acc + v * Math.max(0, Math.min(1, (mins - h * 60) / 60)),
      0
    )
  }

  /** 劣化故事在当前周期里的位置：返回周期起点与相对时间 */
  function storyClock(t) {
    const k = Math.floor((t - T0) / WEEK)
    const start = T0 + k * WEEK
    return { start, rel: t - start }
  }

  /** 劣化托辊组的状态（函数名沿用 idler35，页面各处都按它取组号） */
  function idler35(t) {
    const { start, rel } = storyClock(t)
    const S = IDLER_STORY
    const replaced = rel >= S.fix
    // 劣化程度 s：0（刚出现异响）→ 1（外推的跳闸时刻），按 1.8 次方加速
    const s = replaced ? 0 : Math.min(1, Math.max(0, rel / S.trip)) ** 1.8
    const sD = ((DESIGN_T - T0) / S.trip) ** 1.8
    const level = replaced ? 0 : rel >= S.l2 ? 2 : rel >= S.l3 ? 3 : 4
    const md = (ms) =>
      beijing(start + ms).md + " " + beijing(start + ms).hms.slice(0, 5)
    return {
      group: S.group,
      level,
      s,
      // 定稿时：热点本身温升 6.3 ℃，加上机头驱动部偏暖（6 m 处约 0.8 ℃），峰值 19.8 ℃、差温约 +7.1 ℃；听诊 86 分、转速 418 r/min
      hotExcess: replaced ? 0 : 6.3 * (s / sD),
      score: replaced ? 0 : Math.round(Math.min(99, 86 * (s / sD) ** 0.6)),
      rpm: replaced ? 452 : Math.round(452 - 34 * (s / sD)),
      steps: [
        { t: md(0), label: "听诊异响", level: 4 },
        { t: md(S.l3), label: "三级预警", level: 3 },
        { t: md(S.l2), label: "二级预警", level: 2 },
        { t: md(S.fix), label: "检修班更换", level: 0 }
      ],
      firstWarn: start,
      protectTrip: start + S.trip,
      escalatedAt:
        level === 2 ? start + S.l2 : level === 3 ? start + S.l3 : start,
      replaced
    }
  }

  /**
   * 吊轨机器人：每天 09 / 13 / 17 点各巡检一趟（0.5 m/s 往返）；二级预警后 18:39:51 从机头出发前往热点复核
   * （定稿时刻 18:40 在 4.5 m，正好是概念图里机器人挂在机头上方的位置；热点在 6 m，18:40:03 到达）
   */
  function robotAt(t, id35) {
    const day = dayStart(t)
    const L = FOCUS.len
    const v = 0.5
    const minsSince = (h, m = 0, s = 0) =>
      (t - (day + h * HOUR + m * 60e3 + s * 1e3)) / 1e3
    // 热点复核任务：出发 → 到达后停 10 分钟 → 返回
    if (id35.level === 2) {
      const hotAt = Math.round(id35.group * FOCUS.idlerPitch)
      const dt = minsSince(18, 39, 51)
      const go = hotAt / v
      if (dt >= 0 && dt < go * 2 + 600) {
        const at =
          dt < go
            ? dt * v
            : dt < go + 600
              ? hotAt
              : Math.max(0, hotAt - (dt - go - 600) * v)
        return {
          at,
          target: hotAt,
          task: `前往第 ${id35.group} 组红外复核`,
          moving: dt < go || dt > go + 600
        }
      }
    }
    for (const h of [9, 13, 17]) {
      const dt = minsSince(h)
      const dur = (2 * L) / v
      if (dt >= 0 && dt < dur) {
        const at = dt < dur / 2 ? dt * v : L - (dt - dur / 2) * v
        return {
          at,
          target: dt < dur / 2 ? L : 0,
          task: "例行巡检",
          moving: true
        }
      }
    }
    return { at: 0, target: 0, task: "充电待命", moving: false }
  }

  /** t 时刻的快照 */
  function at(t) {
    const b = beijing(t)
    // 检修班 00:00–08:00 停机；早班交接、开机前巡检 10 min，08:10 起车（定稿 18:40 时今日运行 10.5 h）
    const running = b.hour * 60 + b.minute >= START_MIN
    const flow = flowAt(t)
    const v = running ? FOCUS.vRated : 0
    const id35 = idler35(t)

    // 环境温度：日内起伏（定稿时刻栈桥内约 12.6 ℃）
    const ambient =
      12.6 +
      3.5 *
        (Math.sin(((b.hour + b.minute / 60 - 9) / 24) * 2 * Math.PI) -
          Math.sin(((18 + 40 / 60 - 9) / 24) * 2 * Math.PI))

    // 驱动部：运行时为定稿值 + 噪声；停机时向环境温度回落、振动为 0
    const drive = DRIVE.map((d, i) => {
      if (!running)
        return {
          ...d,
          temp: Math.round(ambient + 8),
          vib: 0,
          kw: d.kw ? 0 : undefined
        }
      return {
        ...d,
        temp: Math.round(d.temp + dn(t, 10 + i, 1.2, 9)),
        vib: Math.max(0.3, +(d.vib + dn(t, 20 + i, 0.12, 3)).toFixed(1)),
        kw: d.kw ? Math.round(d.kw + dn(t, 30 + i, 6, 4)) : undefined
      }
    })

    // 光纤测温：基线 + 小起伏 + 劣化托辊组热点 + 机头驱动部偏暖；0 m = 机头
    const hotAt = Math.round(id35.group * FOCUS.idlerPitch)
    const dts = []
    for (let x = 0; x <= FOCUS.len; x++) {
      const ripple = 0.35 * Math.sin(x / 7.3) + 0.22 * Math.sin(x / 2.1 + 1.3)
      const hot =
        id35.hotExcess * Math.exp(-((x - hotAt) ** 2) / (2 * 2.4 ** 2))
      const nearDrive = running && x < 14 ? 1.4 * (1 - x / 14) : 0
      dts.push(ambient + ripple + hot + nearDrive)
    }

    // 托辊异常组
    const issues = []
    if (id35.level)
      issues.push({
        group: id35.group,
        level: id35.level,
        rpm: running ? id35.rpm : 0,
        score: id35.score,
        note: id35.level === 4 ? "听诊异响" : "轴承劣化"
      })
    for (const o of OTHER_IDLERS)
      issues.push({
        ...o,
        rpm: running ? o.rpm : 0,
        score: Math.round(o.score + dn(t, 40 + o.group, 3, 30))
      })

    // 跑偏（mm）：机头 / 中部 / 机尾
    const sway = [
      {
        at: 5,
        name: "机头",
        mm: running ? Math.round(-6 + dn(t, 51, 3, 2)) : 0
      },
      {
        at: 124,
        name: "中部",
        mm: running ? Math.round(11 + dn(t, 52, 4, 2)) : 0
      },
      {
        at: 240,
        name: "机尾",
        mm: running ? Math.round(18 + dn(t, 53, 5, 2)) : 0
      }
    ]

    // 告警：劣化托辊组（平台预警）、G2 振动（≥ 2.8 mm/s）、每日事件
    const alarms = []
    if (id35.level) {
      alarms.push({
        id: "A1",
        dim: "机",
        level: id35.level,
        platform: true,
        title: `103 第 ${id35.group} 组上托辊 ${id35.level === 4 ? "听诊异响" : "轴承劣化"}`,
        src: id35.level === 4 ? "光纤听诊" : "光纤测温 + 听诊",
        place: `103 · ${hotAt} m`,
        time: beijing(id35.escalatedAt).hms.slice(0, 5),
        status: id35.level === 2 ? "已派单" : "跟踪中"
      })
    }
    const g2 = drive.find((d) => d.id === "G2")
    if (g2.vib >= 2.8)
      alarms.push({
        id: "A2",
        dim: "机",
        level: 3,
        title: "103 2# 减速机振动烈度偏高",
        src: "温振 VT-103-04",
        place: "103 · 机头驱动",
        time: "18:26",
        status: "待处理"
      })
    const mins = b.hour * 60 + b.minute
    for (const e of DAILY_EVENTS) {
      if (mins < e.min || mins > e.min + e.ttl) continue
      const handled = e.done != null && mins >= e.min + e.done
      alarms.push({
        ...e,
        src: e.offline ? `${e.src} ${mins - e.min} min` : e.src,
        time: `${String(Math.floor(e.min / 60)).padStart(2, "0")}:${String(e.min % 60).padStart(2, "0")}`,
        status: handled ? "已处理" : "待处理"
      })
    }
    // 告警排序（同定稿）：平台预警置顶 → 级别高的在前（离线排最后）→ 未处理在前 → 时间先后
    const rank = (a) => (a.offline ? 5 : a.level)
    alarms.sort(
      (a, c) =>
        (c.platform ? 1 : 0) - (a.platform ? 1 : 0) ||
        rank(a) - rank(c) ||
        (a.status === "已处理") - (c.status === "已处理") ||
        a.time.localeCompare(c.time)
    )

    // 地面其余皮带：运量按 103 的比例；108 装车按列车作业（定稿时 3 950 t/h）
    const belts = BELTS.map((x) => ({
      ...x,
      flow:
        x.k == null
          ? running
            ? Math.round(3950 + dn(t, 60, 40, 3))
            : 0
          : Math.round(flow * x.k),
      offline: alarms.some((a) => a.offline && a.place.startsWith(x.id))
    }))

    return {
      t,
      time: b,
      mine: "青峰煤矿",
      shift:
        b.hour < 8
          ? { name: "检修班", range: "00:00–08:00" }
          : b.hour < 16
            ? { name: "早班", range: "08:00–16:00" }
            : { name: "中班", range: "16:00–24:00" },
      running,
      weather: {
        temp: Math.round(ambient - 4.6),
        wind: "西北风",
        windSpeed: +(3.2 + dn(t, 70, 0.4, 11)).toFixed(1)
      },
      safeDays: 1286 + Math.floor((dayStart(t) - dayStart(DESIGN_T)) / DAY),
      focus: {
        ...FOCUS,
        v,
        flow,
        runHoursToday: Math.max(0, (b.hour * 60 + b.minute - START_MIN) / 60)
      },
      flowToday: flowToday(t),
      flowHourly: FLOW_HOURLY,
      drive,
      isoZones: [1.4, 2.8, 4.5],
      dts,
      dtsRule: { fixed: 45, diff: 6 },
      issues,
      idler35: id35,
      tear: { at: 236, todayTears: 0, scars: 2, lastScar: "17:12" },
      sway,
      swayWarn: 35,
      swayTrip: 70,
      xray: { joints: 3, broken: 2, maxElong: 3, lastScan: "06:40" },
      foreign: {
        bigLump:
          mins >= 18 * 60 + 31
            ? 3
            : mins >= 14 * 60
              ? 2
              : mins >= 9 * 60
                ? 1
                : 0,
        bolt: 0
      },
      protections: [
        "跑偏",
        "打滑",
        "堆煤",
        "撕裂",
        "烟雾",
        "超温",
        "急停",
        "张力"
      ],
      // 平台已预警、保护未动作的格子
      protectionMarks:
        id35.level && id35.level <= 3
          ? [{ belt: "103", item: "超温", state: "platform" }]
          : [],
      belts,
      robot: {
        id: "RB01",
        type: "吊轨巡检机器人",
        battery: 0.82,
        patrols:
          mins >= 17 * 60 + 17
            ? 3
            : mins >= 13 * 60 + 17
              ? 2
              : mins >= 9 * 60 + 17
                ? 1
                : 0,
        found: 2,
        ...robotAt(t, id35)
      },
      people: {
        inGallery: running ? 2 : 4,
        fenceToday: mins >= 17 * 60 + 56 ? 1 : 0
      },
      alarms,
      alarmsToday: { 人: 2, 机: 9, 料: 5, 环: 1 }
    }
  }

  return { at }
}

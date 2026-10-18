/*
 * 智能矿山 运行仿真（演示数据）
 * ----------------------------------------------------------
 * 跟随真实时钟，按矿区当地时间（美国山地时区）推算：
 *   - 生产：两个生产班（07:00–15:00、15:00–23:00）割煤，夜班检修；日产约 1 万 t，月计划 26 万 t
 *   - 综采：采煤机沿 182 架液压支架往返，一刀约 4 分钟（演示加速）；工作面每天推进 9.6 m
 *   - 瓦斯：回风隅角 T1 随割煤升高，接近 0.8% 预警线；其他测点按比例浮动
 * 同一时刻算出的数据都一样（按日期播种的伪随机数），刷新页面不会跳变。
 */

const TZ = "America/Denver"
/** 安全生产起算日（到 2026-10-17 为 1286 天） */
const SAFE_FROM = Date.UTC(2023, 3, 10)
/** 采煤机单程时长（秒，演示加速；实际约 40 分钟） */
const PASS_SEC = 240
const SHIELDS = 182
/** 日产（t）与月计划（t） */
const DAILY = 10050
const MONTH_PLAN = 260000
/** 工作面：今日 0 点时的累计推进（m）与日进度 */
const ADVANCED_AT = { date: "2026-10-17", m: 1968 }
const DAILY_ADVANCE = 9.6
const PANEL_LEN = 3400

const fmtParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  weekday: "short"
})

/** 当地时间各部分 */
export function localTime(ms = Date.now()) {
  const p = Object.fromEntries(
    fmtParts.formatToParts(new Date(ms)).map((x) => [x.type, x.value])
  )
  const h = Number(p.hour)
  const m = Number(p.minute)
  const s = Number(p.second)
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hm: `${p.hour}:${p.minute}`,
    week: {
      Mon: "周一",
      Tue: "周二",
      Wed: "周三",
      Thu: "周四",
      Fri: "周五",
      Sat: "周六",
      Sun: "周日"
    }[p.weekday],
    hours: h + m / 60 + s / 3600
  }
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

/** 一天里截至 hours 时的产量占全天比例：两个生产班匀速，夜班检修不出煤 */
function shiftShare(hours) {
  const prod = (a, b) => Math.max(0, Math.min(hours, b) - a)
  return (prod(7, 15) + prod(15, 23)) / 16
}

/** 是否在生产班 */
const cutting = (hours) => hours >= 7 && hours < 23

/** 回风隅角瓦斯（%）：割煤时逐步升高、检修时回落，叠加慢变起伏 */
function t1At(hours, dayKey) {
  const r = rng(`t1-${dayKey}-${Math.floor(hours * 4)}`)
  const sinceStart = cutting(hours) ? hours - (hours >= 15 ? 15 : 7) : 0
  const build = cutting(hours) ? Math.min(1, sinceStart / 2.8) : 0
  const v =
    0.4 + 0.46 * build + 0.04 * Math.sin(hours * 1.7) + (r() - 0.5) * 0.03
  return Math.min(0.95, Math.max(0.3, v))
}

/** 前 n 天的日期字符串（当地） */
function daysBefore(date, n) {
  const [y, m, d] = date.split("-").map(Number)
  const t = Date.UTC(y, m - 1, d) - n * 86400000
  return new Date(t).toISOString().slice(0, 10)
}

export class Simulator {
  constructor() {
    this.t0 = performance.now()
  }

  start() {}

  dispose() {}

  /** 工作面状态（场景每帧调用）：采煤机位置 0 = 机头（运输顺槽）… 1 = 机尾 */
  face() {
    const lt = localTime()
    if (!cutting(lt.hours)) return { shearer: 0.06, dir: 0 }
    const s = (Date.now() / 1000 / PASS_SEC) % 2
    return { shearer: 0.04 + 0.92 * (s < 1 ? s : 2 - s), dir: s < 1 ? 1 : -1 }
  }

  snapshot() {
    const now = Date.now()
    const lt = localTime(now)
    const r = rng(`${lt.date}-${Math.floor(now / 3000)}`)
    const jitter = (v, k) => v + (r() - 0.5) * 2 * k
    const on = cutting(lt.hours)

    // ---------- 生产
    const dayTotal = (date) =>
      Math.round(DAILY * (0.88 + 0.22 * rng(`day-${date}`)()))
    const today = Math.round(dayTotal(lt.date) * shiftShare(lt.hours))
    const week = Array.from({ length: 6 }, (_, i) => {
      const d = daysBefore(lt.date, 6 - i)
      return { label: d.slice(5), value: dayTotal(d) }
    })
    week.push({ label: "今日", value: today, partial: true })
    let month = today
    for (let i = 1; i < lt.day; i++) month += dayTotal(daysBefore(lt.date, i))
    const yesterday = dayTotal(daysBefore(lt.date, 1))
    const lastMonthPace = 1.08 // 上月同期进度（演示）

    // ---------- 综采
    const f = this.face()
    const days = (Date.parse(lt.date) - Date.parse(ADVANCED_AT.date)) / 86400000
    const advanced = Math.min(
      PANEL_LEN,
      ADVANCED_AT.m +
        days * DAILY_ADVANCE +
        DAILY_ADVANCE * shiftShare(lt.hours)
    )
    const flowRate = on
      ? Math.round(jitter(1820, 60))
      : Math.round(jitter(60, 40))

    // ---------- 瓦斯
    const t1 = t1At(lt.hours, lt.date)
    const level = (v, warn, alarm) =>
      v >= alarm ? "alarm" : v >= warn ? "warn" : "ok"
    const t1Series = Array.from({ length: 24 }, (_, i) => {
      let h = lt.hours - (23 - i)
      let day = lt.date
      if (h < 0) {
        h += 24
        day = daysBefore(lt.date, 1)
      }
      return t1At(h, day)
    })
    t1Series[23] = t1
    const gas = {
      t1: { v: t1, st: level(t1, 0.8, 1.0) },
      t0: { v: t1 * 0.44, st: "ok" },
      t2: { v: t1 * 0.6, st: "ok" },
      co: { v: Math.round(jitter(on ? 6 : 4, 1)), st: "ok" },
      temp: { v: jitter(21.4, 0.2), st: "ok" },
      series: t1Series,
      seriesStart: Math.floor(lt.hours) - 23
    }

    // ---------- 告警（今日已发生的）
    const events = [
      {
        at: 2 + 8 / 60,
        lv: "ok",
        text: "Deer Creek 主扇例行倒机",
        state: "完成"
      },
      {
        at: 6.25,
        lv: "ok",
        text: "主平硐 2# 皮带跑偏保护动作",
        state: "已恢复"
      },
      {
        at: 7 + 40 / 60,
        lv: "info",
        text: "17 号钻场抽采负压下降至 13 kPa",
        state: "已处理"
      },
      {
        at: 8 + 57 / 60,
        lv: "warn",
        text: "LW-B07 运输顺槽掘进面粉尘 6.8 mg/m³",
        state: "已通知"
      },
      {
        at: 13 + 20 / 60,
        lv: "info",
        text: "Union Pacific 运煤列车到站装车",
        state: "进行中"
      },
      {
        at: 16 + 5 / 60,
        lv: "warn",
        text: "LW-B05 机尾 172# 支架压力偏高",
        state: "已处理"
      }
    ].filter((e) => e.at <= lt.hours)
    if (gas.t1.st !== "ok")
      events.push({
        at: lt.hours,
        lv: "warn",
        text: `LW-B05 回风隅角瓦斯 ${t1.toFixed(2)}%，接近断电值`,
        state: "处置中"
      })
    const alarms = events
      .sort((a, b) => b.at - a.at)
      .map((e) => ({
        ...e,
        time: `${String(Math.floor(e.at)).padStart(2, "0")}:${String(Math.floor((e.at % 1) * 60)).padStart(2, "0")}`
      }))

    const loaded = lt.hours >= 13.5 ? 11400 : 0
    return {
      time: lt,
      safeDays: Math.floor((now - SAFE_FROM) / 86400000),
      shift:
        lt.hours >= 7 && lt.hours < 15
          ? "早班"
          : lt.hours >= 15 && lt.hours < 23
            ? "中班"
            : "夜班（检修）",
      production: {
        yesterday,
        today,
        month,
        monthPlan: MONTH_PLAN,
        planDone: month / MONTH_PLAN,
        vsLastMonth: month / (MONTH_PLAN * (lt.day / 31) * lastMonthPace) - 1,
        week
      },
      flow: {
        face: flowRate,
        belt: on ? Math.round(jitter(flowRate, 30)) : flowRate,
        wash: Math.round(jitter(1650, 40)),
        trains: loaded ? 1 : 0,
        loaded,
        rawPile: jitter(3.6, 0.02),
        cleanPile: jitter(4.2 - loaded / 1e5, 0.02),
        refuseLeft: 38
      },
      face: {
        id: "LW-B05",
        advanced,
        panelLen: PANEL_LEN,
        todayAdvance: DAILY_ADVANCE * shiftShare(lt.hours),
        height: 3.6,
        shields: SHIELDS,
        shearerAt: Math.round(1 + f.shearer * (SHIELDS - 1)),
        shearerDir: f.dir,
        speed: on ? jitter(8.2, 0.3) : 0,
        cutting: on
      },
      gas,
      drainage: {
        wells: 85,
        pumping: 62,
        pure: jitter(32.6, 0.6),
        concentration: jitter(41, 0.8),
        flares: 2
      },
      vent: {
        intake: Math.round(jitter(12900, 30)),
        ret: Math.round(jitter(12600, 30)),
        pressure: jitter(2.84, 0.02),
        faceAir: Math.round(jitter(2850, 20)),
        effective: jitter(91.2, 0.2)
      },
      people: {
        total: on ? 46 : 31,
        areas: on
          ? [
              ["综采工作面", 18],
              ["掘进工作面", 11],
              ["大巷运输", 7],
              ["机电硐室", 6],
              ["其他区域", 4]
            ]
          : [
              ["综采工作面", 12],
              ["掘进工作面", 6],
              ["大巷运输", 4],
              ["机电硐室", 6],
              ["其他区域", 3]
            ]
      },
      succession: [
        {
          name: "LW-B05 回采",
          v: advanced / PANEL_LEN,
          unit: "%",
          color: "#ff9a3d"
        },
        { name: "LW-B06 顺槽", v: 1, unit: "% 贯通", color: "#36e0ff" },
        { name: "LW-B07 掘进", v: 0.38, unit: "%", color: "#4c9dff" },
        { name: "LW-B08 设计", v: 0.15, unit: "%", color: "#8ea6c8" }
      ],
      alarms,
      sensorsOnline: { total: 412, rate: 0.993 }
    }
  }
}

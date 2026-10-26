/*
 * 带式输送机安全预警与集控孪生：运行仿真（演示数据）
 * ----------------------------------------------------------
 * 矿井、皮带参数和设备编号来自 layout.json（scripts/smart-conveyor/layout.mjs 生成，虚构的青岚煤矿）；
 * 全部运行数据、告警、劣化过程都是模拟的。规则来源见 docs/design/smart-conveyor/02-research.md、04-data-spec.md。
 *
 * 时间：跟随真实的北京时间。三八制：00:00–08:00 检修班（零点班），08:00–24:00 两个生产班。
 *
 * 煤流（按 10 s 步长积分，一天一段缓存）：
 *   - 缓存段从当天 06:00 到次日 06:00。06:00 时全系统已停车、皮带上没有煤、煤仓放到夜间目标煤位、温度回到环境温度，
 *     所以每段都能从一个确定的初始状态算起，段与段之间无缝衔接，任意时刻只要"种子 + 时刻"就能还原
 *   - 07:40 集控一键启动：逆煤流 BC01 → BC06 逐台起车（起车预警 30 s + 软启动），08:00 起综采面开始割煤
 *   - 输送带上的煤按"带面坐标"记账：t 时刻里程 x 处的煤，是带面走过 x − x0 那一刻在受料点 x0 装上去的，
 *     所以变速、停车、多点受料都能精确算出沿线分布、卸载量和带上存煤量，质量守恒
 *   - 料流均衡调速："料多快转、料少慢转、无料待机"：带速按来煤量取，使带面装载率约 85%，限加减速；
 *     生产班里 10 分钟没煤且带上空了就待机，有来煤时先起下游
 *   - 煤仓把系统分成三段：给煤机按"来煤前馈 + 煤位反馈"出煤，把煤位稳在设定值；煤位 ≥ 95% 时上游闭锁停车；
 *     24:00 停产后夜间把煤仓放到目标煤位再停，地面原煤仓由选煤厂取煤（范围外，按煤位取煤）
 *   - 联锁：下游停车（故障、闭锁）时上游皮带立即闭锁停车，工作面闭锁停机；故障复位后逆煤流重新起车
 *   - 功率 = (摩擦阻力 + 物料提升阻力) × 带速 / 效率；下运皮带重载时发电回馈；
 *     电机绕组、轴承、减速机油温按一阶惯性跟随负载
 *
 * 告警与劣化（按日期 / 时段播种，与煤流积分无关的部分是解析式，任意时刻可算）：
 *   - 劣化过程（平台预警）：托辊轴承、电机轴承、减速机齿轮、滚筒包胶，按 3 天一个时段播种，持续 4–9 天，
 *     严重度 s 从 0 涨到 1；s ≥ 0.35 平台三级预警、s ≥ 0.7 二级预警并派工单，在某个夜里检修更换后归零
 *   - 突发事件：人员越界、未戴安全帽、跑偏、异物、大块、堵料、物料超温、粉尘、CO、传感器低电量 / 离线、镜头脏污、
 *     光纤主机通讯中断，以及集控保护停机（一级），按 10 分钟时段播种
 *
 * 用法：const sim = createConveyorSim(layout); const s = sim.at(Date.now())
 */

const TZ_OFF = 8 * 3600000
const MIN = 60000
const HOUR = 3600000
const DAY = 86400000
/** 积分步长（s）与一段缓存的步数（24 h） */
export const DT = 10
const STEPS = 8640
const G = 9.81

/** 皮带状态 */
export const ST = {
  STOP: 0, // 停车
  WARN: 1, // 起车预警
  START: 2, // 软启动
  RUN: 3, // 运行
  STANDBY: 4, // 无料待机
  LOCK: 5, // 闭锁停车（下游停车或煤仓满）
  FAULT: 6, // 保护停机
  MAINT: 7 // 检修挂牌
}
export const ST_NAME = [
  "停车",
  "起车预警",
  "启动中",
  "运行",
  "待机",
  "闭锁",
  "保护停机",
  "检修"
]

/** 告警分级（晨帆界面按一到四级汇总） */
export const LEVELS = ["一级", "二级", "三级", "四级"]
/** 四维 */
export const DIMS = { person: "人", machine: "机", material: "料", env: "环" }

/* ---------------- 时间 ---------------- */

/** 北京时间分解 */
export function beijing(ms = Date.now()) {
  const d = new Date(ms + TZ_OFF)
  return {
    date: d.toISOString().slice(0, 10),
    h: d.getUTCHours(),
    m: d.getUTCMinutes(),
    s: d.getUTCSeconds(),
    hours: d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600,
    dow: d.getUTCDay()
  }
}

/** 北京日期 + 小时 → 时间戳 */
export function msForBeijing(dateStr, hours = 0) {
  return Date.parse(dateStr + "T00:00:00Z") - TZ_OFF + hours * HOUR
}

/** 缓存段编号：北京日期（从 1970-01-01 起的天数），段从该日 06:00 开始 */
const segOf = (ms) => Math.floor((ms + TZ_OFF - 6 * HOUR) / DAY)
const segStart = (c) => c * DAY - TZ_OFF + 6 * HOUR
const dateOfSeg = (c) => new Date(c * DAY).toISOString().slice(0, 10)

/** 当前班次 */
export function shiftAt(ms) {
  const h = beijing(ms).h
  if (h < 8) return { id: "night", name: "零点班", kind: "maint", start: 0 }
  if (h < 16) return { id: "day", name: "八点班", kind: "prod", start: 8 }
  return { id: "eve", name: "四点班", kind: "prod", start: 16 }
}

/* ---------------- 随机数（固定种子） ---------------- */

function hashStr(s) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32：同样的 key 永远给出同样的序列 */
export function rng(...keys) {
  let a = hashStr(keys.join("|"))
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 单个确定的 [0,1) 随机数 */
const rand1 = (...keys) => rng(...keys)()

/** 平滑噪声：整数格点上取随机值，中间余弦插值，返回 −1…1 */
function smooth(key, x) {
  const i = Math.floor(x)
  const f = x - i
  const a = rand1(key, i) * 2 - 1
  const b = rand1(key, i + 1) * 2 - 1
  const k = (1 - Math.cos(f * Math.PI)) / 2
  return a + (b - a) * k
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length]

/* ---------------- 仿真器 ---------------- */

export function createConveyorSim(layout) {
  const belts = layout.belts
  const beltById = Object.fromEntries(belts.map((b) => [b.id, b]))
  const devById = Object.fromEntries(layout.devices.map((d) => [d.id, d]))
  const bunkers = Object.fromEntries(layout.bunkers.map((m) => [m.id, m]))
  const feeders = layout.feeders
  const faces = Object.fromEntries(layout.faces.map((f) => [f.id, f]))
  const devsOf = (belt, kind) =>
    layout.devices.filter((d) => d.belt === belt && d.kind === kind)

  // 每条皮带预先算好积分要用的常量
  for (const b of belts) {
    const sinD = b.lift / b.L
    b._sin = sinD
    b._cos = Math.sqrt(1 - sinD * sinD)
    b._qFull = b.Q / (3.6 * b.v) // 额定装载 kg/m
    b._motors = b.drives.map((d) => d.id)
    b._pulleys = ["DP1", "DP2"].map((p) => `${b.id}-${p}`)
    b._sc = devById[`${b.id}-SC`] || null
  }

  /* ---------- 环境温度（°C） ---------- */

  /** 地面气温：季节 + 昼夜 */
  function surfaceTemp(ms) {
    const bj = beijing(ms)
    const doy =
      (Date.parse(bj.date) - Date.parse(bj.date.slice(0, 4) + "-01-01")) / DAY
    return (
      10 +
      12 * Math.cos((2 * Math.PI * (doy - 200)) / 365) +
      5 * Math.sin((2 * Math.PI * (bj.hours - 9)) / 24) +
      1.5 * smooth("air", ms / (3 * HOUR))
    )
  }
  /** 各皮带巷道的环境温度：井下随埋深略升，主斜井驱动在地面机房 */
  const ROAD_T = { BC02: 17, BC03: 22, BC04: 21, BC05: 24, BC06: 23 }
  function ambient(beltId, ms, atDrive = false) {
    if (beltId === "BC01") return surfaceTemp(ms)
    if (beltId === "BC02" && atDrive) return 16 + 0.25 * (surfaceTemp(ms) - 10)
    return ROAD_T[beltId] + 0.4 * smooth("amb" + beltId, ms / (2 * HOUR))
  }

  /* ---------- 劣化过程（平台预警的来源） ---------- */

  const TRACK_SLOT = 3 * DAY
  const TRACK_EPOCH = Date.UTC(2026, 0, 1) - TZ_OFF
  const TRACK_KINDS = [
    {
      kind: "idlerBearing",
      w: 0.45,
      name: "托辊轴承劣化",
      dim: "machine",
      sense: "振动"
    },
    {
      kind: "motorBearing",
      w: 0.2,
      name: "电机轴承外圈故障",
      dim: "machine",
      sense: "振动"
    },
    {
      kind: "reducerGear",
      w: 0.15,
      name: "减速机齿面点蚀",
      dim: "machine",
      sense: "振动"
    },
    {
      kind: "pulleyLagging",
      w: 0.1,
      name: "传动滚筒包胶磨损",
      dim: "machine",
      sense: "温度"
    },
    {
      kind: "reducerOil",
      w: 0.1,
      name: "减速机润滑不良",
      dim: "machine",
      sense: "温度"
    }
  ]
  const trackCache = new Map()
  /** 第 k 个 3 天时段里新出现的劣化过程 */
  function tracksOfSlot(k) {
    if (trackCache.has(k)) return trackCache.get(k)
    const r = rng("track", k)
    const n = r() < 0.6 ? 2 : 1
    const out = []
    for (let j = 0; j < n; j++) {
      let x = r()
      const def = TRACK_KINDS.find((d) => (x -= d.w) < 0) || TRACK_KINDS[0]
      const t0 = TRACK_EPOCH + k * TRACK_SLOT + r() * TRACK_SLOT
      // 在 4–9 天后的某个夜里（02:00–05:00）检修消缺
      const fixDate = beijing(t0 + (4 + r() * 5) * DAY).date
      const tFix = msForBeijing(fixDate, 2 + r() * 3)
      const tr = { id: `TR${k}-${j}`, ...def, t0, tFix }
      if (def.kind === "idlerBearing") {
        const b = pick(r, ["BC02", "BC03", "BC03", "BC04", "BC05"])
        const bl = beltById[b]
        tr.belt = b
        const sensors = layout.devices.filter(
          (d) => d.kind === "idlerSensor" && d.belt === b
        )
        if (sensors.length && r() < 0.4) {
          // 落在装了温速传感器的托辊上：点式传感器和光纤都能看到
          const sn = pick(r, sensors)
          tr.set = sn.set
          tr.roll = sn.roll
          tr.sensor = sn.id
        } else {
          tr.set = 20 + Math.floor(r() * (bl.carryCount - 40))
          tr.roll = pick(r, ["L", "C", "R"])
        }
        tr.chainage = Math.round(tr.set * bl.carry * 10) / 10
        tr.device = `${b}#${tr.set}${tr.roll}`
        tr.where = `${bl.short} 第 ${tr.set} 组${{ L: "左", C: "中", R: "右" }[tr.roll]}辊`
      } else if (def.kind === "pulleyLagging") {
        const b = pick(r, ["BC02", "BC03", "BC04", "BC05"])
        tr.belt = b
        tr.device = `${b}-DP1`
        tr.where = devById[tr.device].name
        tr.chainage = devById[tr.device].chainage
      } else {
        const b = pick(r, ["BC02", "BC02", "BC03", "BC04", "BC05"])
        const n2 = beltById[b].drives.length
        const m = 1 + Math.floor(r() * n2)
        tr.belt = b
        tr.device = def.kind === "motorBearing" ? `${b}-M${m}` : `${b}-R${m}`
        tr.end = def.kind === "motorBearing" ? pick(r, ["DE", "NDE"]) : null
        tr.where =
          devById[tr.device].name +
          (tr.end ? (tr.end === "DE" ? "驱动端" : "非驱动端") : "")
        tr.chainage = devById[tr.device].chainage
      }
      // 严重度 s(t) = ((t − t0) / (tFix − t0))^1.8；三级 / 二级预警的时刻由阈值反推
      const span = tr.tFix - tr.t0
      tr.tWarn = tr.t0 + span * Math.pow(0.35, 1 / 1.8)
      tr.tAlarm = tr.t0 + span * Math.pow(0.7, 1 / 1.8)
      out.push(tr)
    }
    trackCache.set(k, out)
    return out
  }
  /** t 时刻还在进行（未消缺）的劣化过程 */
  function tracksAt(ms) {
    const k = Math.floor((ms - TRACK_EPOCH) / TRACK_SLOT)
    const out = []
    for (let j = k - 4; j <= k; j++)
      for (const tr of tracksOfSlot(j))
        if (ms >= tr.t0 && ms < tr.tFix) out.push(tr)
    return out
  }
  /** 一段时间内出现过的劣化过程（含已消缺） */
  function tracksBetween(ms0, ms1) {
    const k0 = Math.floor((ms0 - TRACK_EPOCH) / TRACK_SLOT) - 4
    const k1 = Math.floor((ms1 - TRACK_EPOCH) / TRACK_SLOT)
    const out = []
    for (let j = k0; j <= k1; j++)
      for (const tr of tracksOfSlot(j))
        if (tr.t0 < ms1 && tr.tFix > ms0) out.push(tr)
    return out
  }
  const severity = (tr, ms) =>
    ms < tr.t0 || ms >= tr.tFix
      ? 0
      : Math.pow((ms - tr.t0) / (tr.tFix - tr.t0), 1.8)
  /** 某设备（或某个托辊）当前的最大劣化严重度 */
  function deviceSeverity(id, ms, kind) {
    let s = 0
    for (const tr of tracksAt(ms))
      if (tr.device === id && (!kind || tr.kind === kind))
        s = Math.max(s, severity(tr, ms))
    return s
  }

  /* ---------- 每晚的检修计划（零点班 00:00–07:40） ---------- */

  const nightCache = new Map()
  /** 某日夜里的检修任务：劣化消缺 + 例行点检 / 调偏 / 清扫 */
  function nightPlan(dateStr) {
    if (nightCache.has(dateStr)) return nightCache.get(dateStr)
    const r = rng("night", dateStr)
    const t00 = msForBeijing(dateStr, 0)
    const tasks = []
    // 1) 当夜要消缺的劣化过程
    for (const tr of tracksBetween(t00, t00 + 8 * HOUR))
      if (tr.tFix >= t00 && tr.tFix < t00 + 8 * HOUR) {
        const dur =
          tr.kind === "idlerBearing"
            ? 50
            : tr.kind === "motorBearing"
              ? 140
              : 110
        tasks.push({
          id: `WO-${tr.id}`,
          belt: tr.belt,
          title: `${tr.where} ${
            {
              idlerBearing: "更换托辊",
              motorBearing: "更换轴承",
              reducerGear: "减速机检修",
              pulleyLagging: "滚筒包胶修复",
              reducerOil: "换油、清洗冷却器"
            }[tr.kind]
          }`,
          start: tr.tFix - dur * MIN,
          end: tr.tFix,
          crew: tr.kind === "idlerBearing" ? 3 : 5,
          chainage: tr.chainage,
          track: tr.id,
          lock: true
        })
      }
    // 2) 例行任务：每条皮带都有点检，另外随机 2–3 项
    const routine = [
      ["输送带调偏、清扫器调整", 60, 3],
      ["机头卸载滚筒清理积煤", 45, 2],
      ["拉紧装置、制动器检查", 50, 2],
      ["沿线急停闭锁试验", 40, 2],
      ["托辊巡检、更换异响托辊", 70, 4],
      ["X 光检测装置标定", 35, 2]
    ]
    const nRoutine = 2 + (r() < 0.5 ? 1 : 0)
    for (let i = 0; i < nRoutine; i++) {
      const [title, dur, crew] = pick(r, routine)
      const b = pick(r, ["BC02", "BC03", "BC04", "BC05", "BC01"])
      const start = t00 + (1.5 + r() * 4.5) * HOUR
      tasks.push({
        id: `WO-${dateStr.slice(5).replace("-", "")}-${i + 1}`,
        belt: b,
        title,
        start,
        end: Math.min(start + dur * MIN, t00 + 7.5 * HOUR),
        crew,
        chainage: Math.round(r() * beltById[b].L),
        lock: true
      })
    }
    tasks.sort((a, b) => a.start - b.start)
    nightCache.set(dateStr, tasks)
    return tasks
  }

  /* ---------- 工作面出煤计划 ---------- */

  const FACE_STOPS = [
    "采煤机截割电机过温",
    "刮板输送机断链处理",
    "端头支架拉架困难",
    "煤壁片帮处理",
    "转载机破碎机堵塞",
    "乳化液泵站压力低"
  ]

  /**
   * 综采面：一刀 = 斜切进刀 10–14 min（出煤 30–40%）+ 割煤 30–40 min（满负荷 × 速度系数）+ 端头 5–8 min（约 15%）；
   * 每刀约有 18% 概率插一次 6–28 min 的停机；交接班 15:50–16:15 不割煤
   */
  function planLongwall(dateStr) {
    const f = faces.WF12301
    const r = rng("longwall", dateStr)
    const t00 = msForBeijing(dateStr, 0)
    const phases = []
    for (const [h0, h1] of [
      [8.25, 15.83],
      [16.25, 23.83]
    ]) {
      let t = t00 + h0 * HOUR
      const end = t00 + h1 * HOUR
      let dir = r() < 0.5 ? 1 : -1
      while (t < end) {
        if (r() < 0.18) {
          const d = (6 + r() * 22) * MIN
          phases.push({
            kind: "stop",
            t0: t,
            t1: Math.min(t + d, end),
            out: 0,
            reason: pick(r, FACE_STOPS)
          })
          t += d
          continue
        }
        const sp = 0.88 + r() * 0.16
        const seq = [
          ["sump", (10 + r() * 4) * MIN, 0.3 + r() * 0.1],
          ["cut", (30 + r() * 10) * MIN, sp],
          ["end", (5 + r() * 3) * MIN, 0.15]
        ]
        for (const [kind, d, k] of seq) {
          if (t >= end) break
          phases.push({
            kind,
            t0: t,
            t1: Math.min(t + d, end),
            out: f.peak * k,
            dir
          })
          t += d
        }
        dir = -dir
      }
    }
    return phases
  }

  /** 掘进面：割煤 22–28 min（300–380 t/h）+ 支护 30–40 min */
  function planHeading(dateStr) {
    const r = rng("heading", dateStr)
    const t00 = msForBeijing(dateStr, 0)
    const phases = []
    for (const [h0, h1] of [
      [8.4, 15.7],
      [16.4, 23.7]
    ]) {
      let t = t00 + h0 * HOUR
      const end = t00 + h1 * HOUR
      while (t < end) {
        const c = (22 + r() * 6) * MIN
        phases.push({
          kind: "cut",
          t0: t,
          t1: Math.min(t + c, end),
          out: 300 + r() * 80
        })
        t += c
        const s = (30 + r() * 10 + (r() < 0.12 ? 25 : 0)) * MIN
        phases.push({
          kind: "support",
          t0: t,
          t1: Math.min(t + s, end),
          out: 0
        })
        t += s
      }
    }
    return phases
  }

  /* ---------- 突发事件（按 10 分钟时段播种） ---------- */

  const EV_DEFS = [
    // dim 四维、lvl 级别（0 = 一级）、sense 六感、p 每时段概率（生产班 / 检修班）
    {
      kind: "intrude",
      dim: "person",
      lvl: 1,
      sense: "视频",
      p: [0.012, 0.006],
      title: "人员越界（机头危险区）",
      dur: [1, 4],
      dev: "head"
    },
    {
      kind: "helmet",
      dim: "person",
      lvl: 2,
      sense: "视频",
      p: [0.012, 0.012],
      title: "未佩戴安全帽",
      dur: [2, 6],
      dev: "anyCam"
    },
    {
      kind: "fence",
      dim: "person",
      lvl: 2,
      sense: "位置",
      p: [0.01, 0.02],
      title: "人员进入皮带危险区域（UWB）",
      dur: [2, 8],
      dev: "uwb"
    },
    {
      kind: "deviation",
      dim: "machine",
      lvl: 2,
      sense: "视频",
      p: [0.03, 0],
      title: "输送带跑偏",
      dur: [5, 20],
      dev: "lineCam"
    },
    {
      kind: "slipWarn",
      dim: "machine",
      lvl: 2,
      sense: "速度",
      p: [0.006, 0],
      title: "传动滚筒打滑预警",
      dur: [2, 5],
      dev: "belt"
    },
    {
      kind: "foreign",
      dim: "material",
      lvl: 1,
      sense: "图像",
      p: [0.018, 0],
      title: "输送带异物（锚杆 / 铁器）",
      dur: [1, 3],
      dev: "tailCam"
    },
    {
      kind: "bigLump",
      dim: "material",
      lvl: 2,
      sense: "图像",
      p: [0.028, 0],
      title: "大块煤",
      dur: [1, 2],
      dev: "tailCam"
    },
    {
      kind: "blockage",
      dim: "material",
      lvl: 1,
      sense: "视频",
      p: [0.004, 0],
      title: "转载点堵料",
      dur: [5, 12],
      dev: "head"
    },
    {
      kind: "hotMat",
      dim: "material",
      lvl: 1,
      sense: "温度",
      p: [0.002, 0],
      title: "物料超温（已联动喷淋）",
      dur: [3, 8],
      dev: "ir"
    },
    {
      kind: "dust",
      dim: "env",
      lvl: 2,
      sense: "图像",
      p: [0.02, 0.004],
      title: "粉尘浓度超限（已联动喷雾）",
      dur: [4, 12],
      dev: "env"
    },
    {
      kind: "co",
      dim: "env",
      lvl: 1,
      sense: "温度",
      p: [0.003, 0.002],
      title: "CO 浓度升高",
      dur: [10, 25],
      dev: "env"
    },
    {
      kind: "battery",
      dim: "machine",
      lvl: 3,
      sense: "振动",
      p: [0.006, 0.004],
      title: "无线温振传感器电量低",
      dur: [120, 480],
      dev: "idler",
      quality: "uncertain"
    },
    {
      kind: "uwbOff",
      dim: "person",
      lvl: 3,
      sense: "位置",
      p: [0.007, 0.007],
      title: "UWB 定位基站离线",
      dur: [6, 25],
      dev: "uwb",
      quality: "stale"
    },
    {
      kind: "camDirty",
      dim: "machine",
      lvl: 3,
      sense: "视频",
      p: [0.008, 0.004],
      title: "摄像机镜头脏污（识别置信度下降）",
      dur: [20, 60],
      dev: "anyCam",
      quality: "uncertain"
    },
    {
      kind: "comm",
      dim: "machine",
      lvl: 2,
      sense: "温度",
      p: [0.002, 0.002],
      title: "光纤测温主机通讯中断",
      dur: [4, 15],
      dev: "dts",
      quality: "stale"
    },
    {
      kind: "trip",
      dim: "machine",
      lvl: 0,
      sense: "速度",
      p: [0.0045, 0],
      title: "保护停机",
      dur: [6, 20],
      dev: "trip"
    }
  ]
  const TRIP_PROT = [
    ["PX", "跑偏保护动作"],
    ["DM", "堆煤保护动作"],
    ["ES", "沿线急停（误拉）"],
    ["SL", "打滑保护动作"],
    ["SM", "烟雾保护误动作"]
  ]

  const eventCache = new Map()
  /** 一段缓存（06:00 → 次日 06:00）里的突发事件 */
  function eventsOfSeg(c) {
    if (eventCache.has(c)) return eventCache.get(c)
    const t0 = segStart(c)
    const out = []
    const beltsUnder = ["BC02", "BC03", "BC04", "BC05", "BC06"]
    for (let k = 0; k < 144; k++) {
      const ts = t0 + k * 10 * MIN
      const h = beijing(ts).hours
      const prod = h >= 8.3 && h < 23.7
      const r = rng("ev", c, k)
      for (const def of EV_DEFS) {
        const p = def.p[prod ? 0 : 1]
        if (!(r() < p)) continue
        const at = ts + r() * 10 * MIN
        const dur = (def.dur[0] + r() * (def.dur[1] - def.dur[0])) * MIN
        const ev = {
          id: `EV${c}-${k}-${def.kind}`,
          kind: def.kind,
          dim: def.dim,
          level: def.lvl,
          sense: def.sense,
          title: def.title,
          at,
          end: at + dur,
          quality: def.quality || null
        }
        const belt = pick(r, beltsUnder)
        ev.belt = belt
        if (def.dev === "head") ev.device = `${belt}-CAM01`
        else if (def.dev === "tailCam")
          ev.device = `${pick(r, ["BC03", "BC04", "BC05"])}-CAM02`
        else if (def.dev === "lineCam" || def.dev === "anyCam") {
          const cams = devsOf(belt, "camera")
          ev.device =
            def.dev === "lineCam" && cams.length > 2
              ? pick(r, cams.slice(2)).id
              : pick(r, cams).id
        } else if (def.dev === "uwb")
          ev.device = pick(
            r,
            layout.devices.filter((d) => d.kind === "uwb" && d.belt === belt)
          ).id
        else if (def.dev === "env") ev.device = pick(r, devsOf(belt, "env")).id
        else if (def.dev === "ir")
          ev.device = `${pick(r, ["BC02", "BC03", "BC04"])}-IR2`
        else if (def.dev === "idler")
          ev.device = pick(
            r,
            layout.devices.filter((d) => d.kind === "idlerSensor")
          ).id
        else if (def.dev === "dts")
          ev.device = `${pick(r, ["BC02", "BC03", "BC04", "BC05"])}-DTS`
        else if (def.dev === "trip") {
          const [code, name] = pick(r, TRIP_PROT)
          ev.belt = pick(r, ["BC03", "BC04", "BC04", "BC05", "BC05", "BC02"])
          const prots = layout.devices.filter(
            (d) => d.belt === ev.belt && d.id.startsWith(`${ev.belt}-${code}`)
          )
          ev.device = pick(r, prots).id
          ev.title = `${beltById[ev.belt].short} ${name}`
          ev.prot = code
        } else ev.device = belt
        const dv = devById[ev.device]
        ev.belt = dv?.belt || ev.belt
        ev.chainage = dv && typeof dv.chainage === "number" ? dv.chainage : null
        if (def.kind === "deviation") ev.value = Math.round(50 + r() * 35) // mm
        if (def.kind === "co") ev.value = Math.round(26 + r() * 14) // ppm
        if (def.kind === "dust") ev.value = Math.round(12 + r() * 10) // mg/m³
        // 处置时间线：确认 1–4 min 后"处理中"，结束时"已处理"
        ev.ackAt = Math.min(ev.end, at + (1 + r() * 3) * MIN)
        out.push(ev)
      }
    }
    // 同一皮带的保护停机不叠加
    const trips = out
      .filter((e) => e.kind === "trip")
      .sort((a, b) => a.at - b.at)
    for (let i = 1; i < trips.length; i++)
      if (
        trips[i].belt === trips[i - 1].belt &&
        trips[i].at < trips[i - 1].end + 20 * MIN
      )
        trips[i].drop = true
    const res = out.filter((e) => !e.drop).sort((a, b) => a.at - b.at)
    eventCache.set(c, res)
    return res
  }

  /* ---------- 煤流积分（一段 = 06:00 → 次日 06:00） ---------- */

  const segCache = new Map()
  const SEG_KEEP = 4

  function computeSeg(c) {
    const date = dateOfSeg(c)
    const next = dateOfSeg(c + 1)
    const t0 = segStart(c)
    const lw = planLongwall(date)
    const hd = planHeading(date)
    const events = eventsOfSeg(c)
    const trips = events.filter((e) => e.kind === "trip")
    const maint = [...nightPlan(date), ...nightPlan(next)]

    // 计划出煤（未考虑联锁）：预先展开成逐步数组，带 ±6% 的平滑波动
    function expand(phases, key) {
      const arr = new Float32Array(STEPS + 61)
      for (const p of phases) {
        const i0 = Math.max(0, Math.ceil((p.t0 - t0) / (DT * 1000)))
        const i1 = Math.min(arr.length, Math.ceil((p.t1 - t0) / (DT * 1000)))
        for (let i = i0; i < i1; i++)
          arr[i] = p.out * (1 + 0.06 * smooth(key, (t0 / 1000 + i * DT) / 120))
      }
      return arr
    }
    const planA = expand(lw, "fo" + date)
    const planB = expand(hd, "fb" + date)
    /** 未来 10 分钟内是否有计划出煤 */
    const ahead = (arr, i) => {
      for (let k = 0; k <= 60; k += 3) if (arr[i + k] > 0) return true
      return false
    }

    const N = STEPS + 1
    const ch = {}
    const F32 = (n) => (ch[n] = new Float32Array(N))
    const F64 = (n) => (ch[n] = new Float64Array(N))
    const U8 = (n) => (ch[n] = new Uint8Array(N))

    // 皮带运行状态
    const S = {}
    for (const b of belts) {
      S[b.id] = {
        st: ST.STOP,
        v: 0,
        timer: 0,
        idle: 0,
        qEma: 0,
        streams: b.loads.map((ld) => ({
          from: ld.from,
          x0: ld.at,
          q: 0,
          cum: F64(`in:${b.id}:${ld.from}`)
        })),
        sArr: F64(`s:${b.id}`),
        vArr: F32(`v:${b.id}`),
        stArr: U8(`st:${b.id}`),
        mArr: F32(`M:${b.id}`),
        outArr: F32(`out:${b.id}`),
        pArr: F32(`P:${b.id}`),
        eArr: F64(`E:${b.id}`),
        rArr: F64(`R:${b.id}`),
        ebArr: F64(`Eb:${b.id}`),
        runArr: F64(`run:${b.id}`),
        cumOut: 0,
        temps: b.drives.map((d, m) => ({
          tw: F32(`tw:${d.id}`),
          tde: F32(`tde:${d.id}`),
          tnde: F32(`tnde:${d.id}`),
          oil: F32(`oil:${b.id}-R${m + 1}`)
        })),
        ptemps: b._pulleys.map((p) => F32(`tp:${p}`))
      }
      if (b._sc) S[b.id].scArr = F64(`sc:${b.id}`)
    }
    const lv = {}
    for (const id of Object.keys(bunkers)) lv[id] = F32(`lv:${id}`)
    for (const f of feeders) F32(`q:${f.id}`)
    F32("draw")
    F32("fa")
    F32("fb")
    F64("FA")
    F64("FB")

    // 初始状态：煤仓在夜间目标煤位
    const NIGHT_LV = { MC01: 0.2, MC02: 0.2, MC03: 0.3 }
    const SP_LV = { MC01: 0.45, MC02: 0.4 }
    const level = { ...NIGHT_LV }
    const fq = Object.fromEntries(feeders.map((f) => [f.id, 0]))
    const inEma = { MC01: 0, MC02: 0 }

    /** t 时刻某条皮带是否在检修挂牌 / 保护停机 */
    const inMaint = (id, t) =>
      maint.some((w) => w.lock && w.belt === id && t >= w.start && t < w.end)
    const tripOf = (id, t) =>
      trips.find((e) => e.belt === id && t >= e.at && t < e.end)

    /** 带面坐标 u 处在 stream 上累计装了多少煤（kg），在 sArr 上二分插值 */
    function cumAtU(sArr, cum, i, u) {
      if (u <= sArr[0]) return 0
      if (u >= sArr[i]) return cum[i]
      let lo = 0
      let hi = i
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (sArr[mid] <= u) lo = mid
        else hi = mid
      }
      const ds = sArr[hi] - sArr[lo]
      const f = ds > 0 ? (u - sArr[lo]) / ds : 1
      return cum[lo] + (cum[hi] - cum[lo]) * f
    }

    const order = layout.startOrder // 下游 → 上游
    const startT = msForBeijing(date, 7 + 40 / 60)
    const prodEnd = msForBeijing(next, 0)

    for (let i = 0; i <= STEPS; i++) {
      const t = t0 + i * DT * 1000
      const prodWin = t >= startT && t < prodEnd // 07:40–24:00：生产时段（含起车）
      const night = t >= prodEnd

      // 1) 下游能否接煤、需求
      const busy = (id) =>
        S[id].st !== ST.STOP && S[id].st !== ST.STANDBY && S[id].st !== ST.MAINT
      const hasCoal = (id) => S[id].mArr[Math.max(i - 1, 0)] > 0.05
      const feedWant = (bk) =>
        prodWin ? level[bk] > 0.25 : level[bk] > NIGHT_LV[bk] + 1e-6
      const demand = {
        BC05: (prodWin && ahead(planA, i)) || hasCoal("BC05"),
        BC06: (prodWin && ahead(planB, i)) || hasCoal("BC06")
      }
      demand.BC04 =
        demand.BC05 ||
        demand.BC06 ||
        busy("BC05") ||
        busy("BC06") ||
        hasCoal("BC04")
      demand.BC03 = feedWant("MC01") || hasCoal("BC03")
      demand.BC02 = feedWant("MC02") || hasCoal("BC02")
      demand.BC01 = demand.BC02 || busy("BC02") || hasCoal("BC01")
      // 07:40 一键启动：生产时段内全线保持运行（料少慢转），只有长时间无料才待机
      const forced = t >= startT && t < startT + 30 * MIN

      // 2) 状态机（下游先算，上游看到的是下游的新状态）
      for (const id of order) {
        const b = beltById[id]
        const s = S[id]
        const trip = tripOf(id, t)
        const want = forced || demand[id]
        // 下游能否接煤：煤仓没满，或下游皮带在运行（下游的新状态已在本步先算出）
        const acceptNow =
          id === "BC01"
            ? level.MC03 < 0.95
            : id === "BC02"
              ? S.BC01.st === ST.RUN
              : id === "BC03"
                ? level.MC02 < 0.95
                : id === "BC04"
                  ? level.MC01 < 0.95
                  : S.BC04.st === ST.RUN
        if (trip) {
          s.st = ST.FAULT
        } else if (
          inMaint(id, t) &&
          (s.st === ST.STOP || s.st === ST.MAINT || s.st === ST.STANDBY)
        ) {
          s.st = ST.MAINT
        } else if (
          (s.st === ST.RUN || s.st === ST.START || s.st === ST.WARN) &&
          !acceptNow
        ) {
          s.st = ST.LOCK
        } else if (s.st === ST.FAULT || s.st === ST.MAINT || s.st === ST.LOCK) {
          // 故障复位 / 检修结束 / 闭锁解除：有需求就重新起车，否则回到停车（闭锁且下游未恢复时保持闭锁）
          if (want && acceptNow) {
            s.st = ST.WARN
            s.timer = 30
          } else if (s.st !== ST.LOCK) s.st = prodWin ? ST.STANDBY : ST.STOP
        } else if (s.st === ST.STOP || s.st === ST.STANDBY) {
          if (want && acceptNow) {
            s.st = ST.WARN
            s.timer = prodWin && !forced ? 20 : 30
          }
        } else if (s.st === ST.WARN) {
          s.timer -= DT
          if (s.timer <= 0) s.st = ST.START
        } else if (s.st === ST.START) {
          if (s.v >= b.vMin - 1e-6) s.st = ST.RUN
        } else if (s.st === ST.RUN) {
          const empty = s.mArr[Math.max(i - 1, 0)] < 0.05 && s.qEma < b.Q * 0.01
          s.idle = want || !empty ? 0 : s.idle + DT
          const limit = prodWin ? 600 : 60
          if (s.idle >= limit) s.st = prodWin ? ST.STANDBY : ST.STOP
        }
        // 下游不在运行时，上游闭锁的皮带回到可起车状态（等下游起来）
        if (s.st === ST.LOCK && !trip && acceptNow && !want)
          s.st = prodWin ? ST.STANDBY : ST.STOP
      }

      // 3) 带速
      const feedCmd = {}
      for (const bk of ["MC01", "MC02"]) {
        const m = bunkers[bk]
        const lvl = level[bk]
        let q
        if (prodWin)
          q = lvl < 0.25 ? 0 : inEma[bk] + ((lvl - SP_LV[bk]) * m.cap) / 0.25
        else
          q = Math.min(
            0.85 * 2 * feeders.find((f) => f.bunker === bk).qMax,
            ((lvl - NIGHT_LV[bk]) * m.cap * 3600) / DT
          )
        feedCmd[bk] = clamp(
          q,
          0,
          feeders.filter((f) => f.bunker === bk).reduce((a, f) => a + f.qMax, 0)
        )
      }
      for (const id of order) {
        const b = beltById[id]
        const s = S[id]
        let target = 0
        if (s.st === ST.RUN) {
          const qRef =
            id === "BC03" ? feedCmd.MC01 : id === "BC02" ? feedCmd.MC02 : s.qEma
          target = clamp(qRef / (3.6 * 0.85 * b._qFull), b.vMin, b.v)
          s.v = s.v + clamp(target - s.v, -0.5, 0.5)
        } else if (s.st === ST.START) {
          s.v = Math.min(b.vMin, s.v + 0.05 * DT)
        } else {
          s.v = Math.max(0, s.v - 0.3 * DT)
        }
      }

      // 4) 煤流：上游 → 下游
      const running = (id) => S[id].st === ST.RUN && S[id].v > 0
      const faOut =
        running("BC05") && S.BC05.v >= beltById.BC05.vMin - 1e-6 ? planA[i] : 0
      const fbOut =
        running("BC06") && S.BC06.v >= beltById.BC06.vMin - 1e-6 ? planB[i] : 0
      ch.fa[i] = faOut
      ch.fb[i] = fbOut
      if (i > 0) {
        ch.FA[i] = ch.FA[i - 1] + (faOut * DT) / 3600
        ch.FB[i] = ch.FB[i - 1] + (fbOut * DT) / 3600
      }
      const inflow = { WF12301: faOut, WF12305: fbOut }
      for (const f of feeders) {
        const bk = f.bunker
        const on = running(f.belt) && feedCmd[bk] > 0
        const share = feeders.filter((x) => x.bunker === bk)
        // 来煤少时只开一台给煤机
        const one = feedCmd[bk] < 0.55 * f.qMax
        const q = on
          ? one
            ? f === share[0]
              ? feedCmd[bk]
              : 0
            : feedCmd[bk] / share.length
          : 0
        fq[f.id] = q
        ch[`q:${f.id}`][i] = q
        inflow[f.id] = q
      }
      const outflow = {}
      for (const id of [...order].reverse()) {
        // 上游 → 下游：BC06, BC05, BC04, BC03, BC02, BC01
        const b = beltById[id]
        const s = S[id]
        // 积分带面位移
        s.sArr[i] = i === 0 ? 0 : s.sArr[i - 1] + s.v * DT
        let qin = 0
        for (const st of s.streams) {
          const q =
            id === "BC04" || id === "BC01"
              ? outflow[st.from] || 0
              : inflow[st.from] || 0
          st.q = s.v > 0 ? q : 0
          st.cum[i] = i === 0 ? 0 : st.cum[i - 1] + (st.q * 1000 * DT) / 3600
          qin += st.q
        }
        s.qEma += (qin - s.qEma) * (DT / 60)
        // 卸载：机头里程 L 处
        let cumOut = 0
        let mass = 0
        for (const st of s.streams) {
          const co = cumAtU(s.sArr, st.cum, i, s.sArr[i] - (b.L - st.x0))
          cumOut += co
          mass += st.cum[i] - co
        }
        const out = i === 0 ? 0 : ((cumOut - s.cumOut) / 1000) * (3600 / DT)
        s.cumOut = cumOut
        outflow[id] = Math.max(0, out)
        s.outArr[i] = outflow[id]
        s.mArr[i] = mass / 1000
        // 皮带秤
        if (s.scArr) {
          const xs = b._sc.chainage
          let c2 = 0
          for (const st of s.streams)
            if (xs >= st.x0)
              c2 += cumAtU(s.sArr, st.cum, i, s.sArr[i] - (xs - st.x0))
          s.scArr[i] = c2 / 1000
        }
      }

      // 5) 煤仓
      const dh = DT / 3600
      inEma.MC01 += (outflow.BC04 - inEma.MC01) * (DT / 600)
      inEma.MC02 += (outflow.BC03 - inEma.MC02) * (DT / 600)
      level.MC01 = clamp(
        level.MC01 +
          ((outflow.BC04 - fq.GM01 - fq.GM02) * dh) / bunkers.MC01.cap,
        0,
        1
      )
      level.MC02 = clamp(
        level.MC02 +
          ((outflow.BC03 - fq.GM03 - fq.GM04) * dh) / bunkers.MC02.cap,
        0,
        1
      )
      // 地面原煤仓：选煤厂 06:00–24:00 按煤位取煤，夜里取到 30% 为止
      const capS = bunkers.MC03.cap
      let draw
      if (!night)
        draw =
          level.MC03 < 0.15
            ? 0
            : clamp(1500 + ((level.MC03 - 0.55) * capS) / 2, 600, 2600)
      else draw = Math.min(2400, ((level.MC03 - NIGHT_LV.MC03) * capS) / dh)
      draw = Math.max(
        0,
        Math.min(draw, outflow.BC01 + (level.MC03 * capS) / dh)
      )
      level.MC03 = clamp(level.MC03 + ((outflow.BC01 - draw) * dh) / capS, 0, 1)
      if (night && Math.abs(level.MC03 - NIGHT_LV.MC03) < 1e-9)
        level.MC03 = NIGHT_LV.MC03
      ch.draw[i] = draw
      for (const bk of Object.keys(lv)) lv[bk][i] = level[bk]

      // 6) 功率、电量、温度
      for (const id of order) {
        const b = beltById[id]
        const s = S[id]
        s.vArr[i] = s.v
        s.stArr[i] = s.st
        const M = s.mArr[i] * 1000
        const v = s.v
        let pe = 0
        let pb = 0
        if (v > 0) {
          const F = G * (b.f * (b.m0 * b.L + M) * b._cos + M * b._sin) * 1.05
          const acc = s.st === ST.START ? (b.m0 * b.L + M) * 0.05 * v : 0
          const pm = (F * v + acc) / 1000
          pe = pm > 0 ? pm / 0.92 : pm * 0.9
          pe += b.drives.length * 0.015 * b.drives[0].kW // 空载损耗
          // 不调速的基准：同样的来煤按额定带速运行
          const Mb = (M * v) / b.v
          const Fb = G * (b.f * (b.m0 * b.L + Mb) * b._cos + Mb * b._sin) * 1.05
          const pbm = (Fb * b.v) / 1000
          pb =
            (pbm > 0 ? pbm / 0.92 : pbm * 0.9) +
            b.drives.length * 0.015 * b.drives[0].kW
        }
        s.pArr[i] = pe
        if (i > 0) {
          s.eArr[i] = s.eArr[i - 1] + (Math.max(pe, 0) * DT) / 3600
          s.rArr[i] = s.rArr[i - 1] + (Math.max(-pe, 0) * DT) / 3600
          s.ebArr[i] = s.ebArr[i - 1] + (Math.max(pb, 0) * DT) / 3600
          s.runArr[i] = s.runArr[i - 1] + (v > 0 ? DT : 0)
        }
        // 温度：一阶惯性
        const nM = b.drives.length
        const p = v > 0 ? Math.abs(pe) / (nM * b.drives[0].kW) : 0
        const vr = v / b.v
        const amb = ambient(id, t, true)
        const k = (tau) => 1 - Math.exp(-DT / (tau * 60))
        b.drives.forEach((d, m) => {
          const T = s.temps[m]
          const prev = (arr) => (i === 0 ? amb : arr[i - 1])
          const sDE = bearingSev(d.id, t, "DE")
          const sNDE = bearingSev(d.id, t, "NDE")
          const sevO = deviceSeverity(`${id}-R${m + 1}`, t, "reducerOil")
          const sevG = deviceSeverity(`${id}-R${m + 1}`, t, "reducerGear")
          const on = v > 0
          const tw = amb + (on ? 8 + 72 * p * p : 0)
          const tb = amb + (on ? 10 + 14 * vr + 6 * p : 0)
          const to =
            amb +
            (on ? 14 + 26 * p + 6 * vr : 0) +
            (on ? 14 * sevO + 5 * sevG : 0)
          T.tw[i] = prev(T.tw) + (tw - prev(T.tw)) * k(35)
          T.tde[i] =
            prev(T.tde) + (tb + (on ? 22 * sDE : 0) - prev(T.tde)) * k(25)
          T.tnde[i] =
            prev(T.tnde) +
            (tb - 3 + (on ? 22 * sNDE : 0) - prev(T.tnde)) * k(25)
          T.oil[i] = prev(T.oil) + (to - prev(T.oil)) * k(60)
        })
        b._pulleys.forEach((pid, j) => {
          const arr = s.ptemps[j]
          const prev = i === 0 ? amb : arr[i - 1]
          const sevL = deviceSeverity(pid, t, "pulleyLagging")
          const target = amb + (v > 0 ? 6 + 12 * vr + 10 * sevL : 0)
          arr[i] = prev + (target - prev) * k(30)
        })
      }
    }
    return { c, date, t0, ch, lw, hd, events, maint }
  }

  function seg(c) {
    let s = segCache.get(c)
    if (!s) {
      s = computeSeg(c)
      segCache.set(c, s)
      if (segCache.size > SEG_KEEP)
        segCache.delete(segCache.keys().next().value)
    }
    return s
  }

  /** 取通道值：步与步之间线性插值（状态取前一步） */
  function chAt(name, ms, step = false) {
    const c = segOf(ms)
    const sg = seg(c)
    const x = (ms - sg.t0) / (DT * 1000)
    const i = Math.min(Math.floor(x), STEPS - 1)
    const arr = sg.ch[name]
    if (!arr) return undefined
    if (step) return arr[i]
    const f = x - i
    return arr[i] + (arr[i + 1] - arr[i]) * f
  }
  /** 累计量从 ms0 到 ms1 的增量（可跨段） */
  function cumBetween(name, ms0, ms1) {
    let sum = 0
    let a = ms0
    while (a < ms1) {
      const c = segOf(a)
      const end = Math.min(ms1, segStart(c + 1) - 1)
      sum += chAt(name, end) - chAt(name, a)
      a = segStart(c + 1)
    }
    return sum
  }
  const todayStart = (ms) => msForBeijing(beijing(ms).date, 0)

  /* ---------- 单台设备读数（at() 和测点层共用，任意时刻可算） ---------- */

  /** 电机轴承劣化对两端的影响：故障端满额，另一端约三分之一 */
  function bearingSev(motorId, ms, end) {
    let s = 0
    for (const tr of tracksAt(ms))
      if (tr.device === motorId && tr.kind === "motorBearing")
        s = Math.max(s, severity(tr, ms) * (tr.end === end ? 1 : 0.35))
    return s
  }
  const nz = (key, ms, amp = 0.04) => 1 + amp * smooth(key, ms / (2 * MIN))

  function motorReading(id, ms) {
    const d = devById[id]
    const b = beltById[d.belt]
    const v = chAt(`v:${b.id}`, ms)
    const P = chAt(`P:${b.id}`, ms) / b.drives.length
    const run = v > 0.05
    const vr = v / b.v
    const sDE = bearingSev(id, ms, "DE")
    const sNDE = bearingSev(id, ms, "NDE")
    return {
      id,
      kW: d.kW,
      power: P,
      current: run
        ? (Math.abs(P) * 1000) / (Math.sqrt(3) * d.kV * 1000 * 0.86) +
          (0.12 * d.kW) / d.kV / 1.732
        : 0,
      tWinding: chAt(`tw:${id}`, ms),
      tDE: chAt(`tde:${id}`, ms),
      tNDE: chAt(`tnde:${id}`, ms),
      vibDE: run ? (1.1 + 1.4 * vr + 4.5 * sDE) * nz("vd" + id, ms) : 0.05,
      vibNDE: run ? (0.9 + 1.2 * vr + 4.5 * sNDE) * nz("vn" + id, ms) : 0.05,
      envelope: run
        ? (0.25 + 0.15 * vr + 6 * Math.max(sDE, sNDE) ** 2) * nz("ge" + id, ms)
        : 0.02
    }
  }

  function reducerReading(id, ms) {
    const d = devById[id]
    const b = beltById[d.belt]
    const v = chAt(`v:${b.id}`, ms)
    const run = v > 0.05
    const oil = chAt(`oil:${id}`, ms)
    const sG = deviceSeverity(id, ms, "reducerGear")
    return {
      id,
      tOil: oil,
      tIn: oil + (run ? 5 + 3 * sG : 0),
      tOut: oil + (run ? 2 : 0),
      vib: run ? (1.8 + 1.6 * (v / b.v) + 5 * sG) * nz("rv" + id, ms) : 0.05
    }
  }

  function pulleyReading(id, ms) {
    const b = beltById[devById[id].belt]
    const v = chAt(`v:${b.id}`, ms)
    return {
      id,
      tBearing: chAt(`tp:${id}`, ms),
      vib:
        v > 0.05
          ? (1.2 + 1.2 * (v / b.v) + 2 * deviceSeverity(id, ms)) *
            nz("pv" + id, ms)
          : 0.05
    }
  }

  /** 托辊温速传感器：辊径 159 mm；装在劣化中的托辊上时温度升高、转速下降（卡阻） */
  function idlerReading(id, ms) {
    const d = devById[id]
    const b = beltById[d.belt]
    const v = chAt(`v:${b.id}`, ms)
    const s = deviceSeverity(`${b.id}#${d.set}${d.roll}`, ms, "idlerBearing")
    const amb = ambient(b.id, ms)
    return {
      id,
      temp:
        amb +
        (v > 0.05 ? 2.5 * (v / b.v) + 30 * s ** 1.3 : 0) +
        0.4 * smooth("it" + id, ms / (7 * MIN)),
      rpm:
        v > 0.05
          ? (v / (Math.PI * 0.159)) *
            60 *
            (1 - 0.35 * s ** 2) *
            nz("ir" + id, ms, 0.01)
          : 0
    }
  }

  /** 环境监测：CO、甲烷、粉尘、温度、湿度 */
  function envReading(id, ms) {
    const d = devById[id]
    const b = beltById[d.belt]
    const v = chAt(`v:${b.id}`, ms)
    const evs = alarmsAt(ms).filter((e) => e.device === id)
    const co = evs.find((e) => e.kind === "co")
    const dust = evs.find((e) => e.kind === "dust")
    const nearHead = d.chainage > b.L - 50
    return {
      id,
      co: co
        ? co.value
        : 2.5 + 1.2 * Math.abs(smooth("co" + id, ms / (20 * MIN))),
      ch4:
        (b.id === "BC05" || b.id === "BC06" ? 0.08 : 0.03) +
        0.02 * Math.abs(smooth("ch" + id, ms / (30 * MIN))),
      dust: dust
        ? dust.value
        : (v > 0.05 ? (nearHead ? 6 : 4) : 1.2) +
          1.2 * Math.abs(smooth("du" + id, ms / (6 * MIN))),
      temp:
        ambient(b.id, ms) +
        (nearHead && v > 0.05 ? 1.5 : 0) +
        0.3 * smooth("te" + id, ms / (15 * MIN)),
      rh: (b.id === "BC01" ? 55 : 84) + 5 * smooth("rh" + id, ms / (90 * MIN))
    }
  }

  /** 摄像机：在线 / 镜头脏污（识别置信度下降） */
  function cameraReading(id, ms) {
    const dirty = alarmsAt(ms).find(
      (e) => e.device === id && e.kind === "camDirty"
    )
    return {
      id,
      state: dirty ? "dirty" : "online",
      conf: dirty
        ? 58 + 8 * smooth("cf" + id, ms / MIN)
        : 95 + 2 * smooth("cf" + id, ms / MIN)
    }
  }

  /* ---------- 巡检机器人 ---------- */

  /**
   * 吊轨机器人：每 2 h 一趟（00:20 起），从机头安全屋出发巡到机尾，每 100 m 停 20 s 拍可见光 / 红外 / 拾音，
   * 再全速返回充电；机器狗白天每 3 h 绕地面栈桥和驱动机房一圈
   */
  function robotAt(id, ms) {
    const d = devById[id]
    const [a, z] = d.chainage
    const bj = beijing(ms)
    const day0 = msForBeijing(bj.date, 0)
    const dog = d.kind === "robotDog"
    const sp = dog ? 1.2 : d.speed
    const len = z - a
    const nStop = Math.floor(len / 100)
    const outDur = (len / sp + nStop * 20) * 1000
    const backDur = ((len / sp) * 1000) / (dog ? 1 : 1.6)
    const starts = dog
      ? [9.25, 12.25, 15.25, 18.25, 21.25]
      : Array.from({ length: 12 }, (_, k) => 0.33 + 2 * k)
    let mission = null
    for (const h of starts) {
      const m0 = day0 + h * HOUR
      if (ms >= m0 && ms < m0 + outDur + backDur) mission = { m0, h }
    }
    if (!mission) {
      // 充电中：上一趟结束后每分钟充 2.5%
      return {
        id,
        state: "charging",
        stateName: "充电",
        pos: z,
        battery: Math.min(100, 70 + ((ms % (2 * HOUR)) / MIN) * 2.5),
        mission: null
      }
    }
    const tm = ms - mission.m0
    const used = Math.min(30, (tm / MIN) * 0.55)
    if (tm < outDur) {
      // 走一段（100 m）停 20 s
      const leg = (100 / sp + 20) * 1000
      const k = Math.floor(tm / leg)
      const inLeg = tm - k * leg
      const moving = inLeg < (100 / sp) * 1000
      const dist = Math.min(len, k * 100 + (moving ? (inLeg / 1000) * sp : 100))
      return {
        id,
        state: moving ? "patrol" : "inspect",
        stateName: moving ? "巡检中" : "定点检测",
        pos: Math.round((z - dist) * 10) / 10,
        battery: 100 - used,
        mission: { start: mission.m0, point: k + 1, points: nStop }
      }
    }
    const back = (tm - outDur) / backDur
    return {
      id,
      state: "return",
      stateName: "返航",
      pos: Math.round((a + back * len) * 10) / 10,
      battery: 100 - used,
      mission: { start: mission.m0 }
    }
  }

  /* ---------- 人员（UWB） ---------- */

  const SURNAMES =
    "王李张刘陈杨赵黄周吴徐孙胡朱高林何郭马罗梁宋郑谢韩唐冯于董萧程曹袁邓许傅沈曾彭吕苏卢蒋蔡贾丁魏薛叶阎余潘杜戴夏钟汪田任姜范方石姚谭廖邹熊金陆郝孔白崔康毛邱秦江史顾侯邵孟龙万段雷钱汤尹黎易常武乔贺赖龚文"
  const GIVEN = [
    "建国",
    "志强",
    "海军",
    "卫东",
    "明亮",
    "晓峰",
    "国庆",
    "红兵",
    "永刚",
    "俊杰",
    "立新",
    "文斌",
    "德胜",
    "春生",
    "学军",
    "振华",
    "铁柱",
    "宏伟",
    "大勇",
    "长江",
    "子豪",
    "浩然",
    "鹏飞",
    "伟",
    "磊",
    "强",
    "军",
    "斌",
    "勇",
    "涛"
  ]
  const personName = (r) =>
    SURNAMES[Math.floor(r() * SURNAMES.length)] + pick(r, GIVEN)
  const crewCache = new Map()
  /** 一个班的人员安排：巡检工沿皮带往返；检修班按检修任务到点作业；工作面人员只计数 */
  function crewOf(dateStr, shiftId) {
    const key = dateStr + shiftId
    if (crewCache.has(key)) return crewCache.get(key)
    const r = rng("crew", key)
    const list = []
    let n = 0
    const tag = () => `UT${String(1000 + Math.floor(r() * 9000))}`
    const patrols =
      shiftId === "night"
        ? { BC02: 1, BC03: 1 }
        : { BC02: 1, BC03: 2, BC04: 1, BC05: 2, BC06: 1 }
    for (const [belt, k] of Object.entries(patrols))
      for (let j = 0; j < k; j++)
        list.push({
          id: tag(),
          name: personName(r),
          role: "巡检工",
          belt,
          mode: "patrol",
          phase: r(),
          seq: n++
        })
    if (shiftId === "night") {
      for (const w of nightPlan(dateStr))
        for (let j = 0; j < w.crew; j++)
          list.push({
            id: tag(),
            name: personName(r),
            role: j === 0 ? "检修班长" : "机电检修工",
            belt: w.belt,
            mode: "task",
            task: w.id,
            start: w.start - 15 * MIN,
            end: w.end + 15 * MIN,
            at: w.chainage,
            off: (r() - 0.5) * 16,
            seq: n++
          })
    } else {
      for (let j = 0; j < 14; j++)
        list.push({
          id: tag(),
          name: personName(r),
          role: j < 2 ? "综采班长" : "综采工",
          area: "WF12301",
          mode: "face",
          seq: n++
        })
      for (let j = 0; j < 6; j++)
        list.push({
          id: tag(),
          name: personName(r),
          role: "掘进工",
          area: "WF12305",
          mode: "face",
          seq: n++
        })
    }
    crewCache.set(key, list)
    return list
  }

  /** t 时刻在井下皮带区域和工作面的人员（含位置：皮带 + 里程） */
  function peopleAt(ms) {
    const bj = beijing(ms)
    const sh = shiftAt(ms)
    const out = []
    for (const p of crewOf(bj.date, sh.id)) {
      if (p.mode === "patrol") {
        const L = beltById[p.belt].L
        const per = (2 * L) / 0.9
        const x = ((ms / 1000 / per + p.phase) % 1) * 2
        out.push({
          ...p,
          area: p.belt,
          chainage: Math.round((x < 1 ? x : 2 - x) * L * 10) / 10
        })
      } else if (p.mode === "task") {
        if (ms >= p.start && ms < p.end)
          out.push({
            ...p,
            area: p.belt,
            chainage: clamp(p.at + p.off, 0, beltById[p.belt].L)
          })
      } else out.push({ ...p })
    }
    return out
  }

  /** UWB 基站：离线时读数冻结（过期） */
  function uwbReading(id, ms, people) {
    const d = devById[id]
    const off = alarmsAt(ms).find((e) => e.device === id && e.kind === "uwbOff")
    const list = people || peopleAt(off ? off.at : ms)
    const tags = list.filter(
      (p) => p.area === d.belt && Math.abs(p.chainage - d.chainage) <= 100
    ).length
    return { id, online: !off, tags, offSince: off ? off.at : null }
  }

  /* ---------- 对外：某时刻的完整状态 ---------- */

  function at(ms) {
    const bj = beijing(ms)
    const c = segOf(ms)
    const sg = seg(c)
    const d0 = todayStart(ms)
    const out = {
      t: ms,
      bj,
      shift: shiftAt(ms),
      belts: {},
      bunkers: {},
      feeders: {},
      faces: {}
    }
    const alarms = alarmsAt(ms)

    let powerTotal = 0
    for (const b of belts) {
      const id = b.id
      const st = chAt(`st:${id}`, ms, true)
      const v = chAt(`v:${id}`, ms)
      const P = chAt(`P:${id}`, ms)
      powerTotal += P
      const evs = alarms.filter((e) => e.belt === id)
      const trip = evs.find((e) => e.kind === "trip")
      const dev = evs.find((e) => e.kind === "deviation")
      const M = chAt(`M:${id}`, ms)
      const full = (b._qFull * b.L) / 1000
      out.belts[id] = {
        id,
        state: st,
        stateName: ST_NAME[st],
        v,
        load: M, // 带上存煤 t
        fill: M / full, // 平均装载率
        flowOut: chAt(`out:${id}`, ms), // 机头卸载量 t/h
        power: P,
        motors: b._motors.map((m) => motorReading(m, ms)),
        reducers: b._motors.map((m, k) =>
          reducerReading(`${id}-R${k + 1}`, ms)
        ),
        pulleys: b._pulleys.map((p) => pulleyReading(p, ms)),
        energyToday: cumBetween(`E:${id}`, d0, ms),
        regenToday: cumBetween(`R:${id}`, d0, ms),
        baseToday: cumBetween(`Eb:${id}`, d0, ms),
        runHoursToday: cumBetween(`run:${id}`, d0, ms) / 3600,
        tension:
          (b.B * 0.11 + Math.max(b.lift, 0) * 0.35) *
          (1 + 0.25 * Math.min(M / full, 1.2)) *
          (v > 0.05 ? 1 : 0.8),
        slip:
          v > 0.05
            ? 0.15 +
              0.1 * Math.min(M / full, 1.2) +
              (evs.some((e) => e.kind === "slipWarn") ? 2.4 : 0)
            : 0,
        deviation: dev
          ? dev.value
          : v > 0.05
            ? Math.abs(8 + 10 * smooth("dv" + id, ms / (5 * MIN)))
            : 0,
        protection: trip ? trip.prot : null,
        tripTitle: trip ? trip.title : null,
        maint: sg.maint.filter(
          (w) => w.belt === id && ms >= w.start && ms < w.end
        )
      }
      if (b._sc) {
        out.belts[id].scaleToday = cumBetween(`sc:${id}`, d0, ms)
        out.belts[id].scaleFlow =
          v > 0
            ? Math.max(
                0,
                (chAt(`sc:${id}`, ms + 5000) - chAt(`sc:${id}`, ms - 5000)) *
                  360
              )
            : 0
      }
      if (b.telescopic) {
        // 伸缩带当前长度：参考长度按推进速度随日期变化（30 天一循环，避免长度跑出范围）
        const days =
          ((((ms - msForBeijing("2026-10-01")) / DAY) % 30) + 30) % 30
        out.belts[id].length =
          Math.round((b.L - b.telescopic.advance * (days - 15)) * 10) / 10
      }
    }
    for (const id of Object.keys(bunkers)) {
      const m = bunkers[id]
      const l = chAt(`lv:${id}`, ms)
      out.bunkers[id] = { id, level: l, tons: l * m.cap, cap: m.cap }
    }
    out.draw = chAt("draw", ms)
    for (const f of feeders) {
      const q = chAt(`q:${f.id}`, ms)
      out.feeders[f.id] = { id: f.id, rate: q, on: q > 1 }
    }
    const phaseAt = (phases) =>
      phases.find((p) => ms >= p.t0 && ms < p.t1) || null
    const lwPh = phaseAt(sg.lw)
    const lwToday = bj.h >= 6 ? sg.lw : planLongwall(bj.date)
    out.faces.WF12301 = {
      id: "WF12301",
      output: chAt("fa", ms),
      phase: lwPh ? lwPh.kind : "idle",
      reason: lwPh && lwPh.kind === "stop" ? lwPh.reason : null,
      cutsToday: lwToday.filter((p) => p.kind === "cut" && p.t1 <= ms).length,
      shearer:
        lwPh && lwPh.kind === "cut"
          ? lwPh.dir > 0
            ? (ms - lwPh.t0) / (lwPh.t1 - lwPh.t0)
            : 1 - (ms - lwPh.t0) / (lwPh.t1 - lwPh.t0)
          : null,
      tonsToday: cumBetween("FA", d0, ms)
    }
    const hdPh = phaseAt(sg.hd)
    out.faces.WF12305 = {
      id: "WF12305",
      output: chAt("fb", ms),
      phase: hdPh ? hdPh.kind : "idle",
      tonsToday: cumBetween("FB", d0, ms)
    }

    out.people = peopleAt(ms)
    out.robots = Object.fromEntries(
      ["RB01", "RB02", "DOG01"].map((r) => [r, robotAt(r, ms)])
    )

    // 汇总（都从明细算出）
    const bs = Object.values(out.belts)
    const energy = bs.reduce((a, b) => a + b.energyToday, 0)
    const base = bs.reduce((a, b) => a + b.baseToday, 0)
    const output = out.belts.BC02.scaleToday
    out.kpi = {
      outputToday: output,
      flowNow: out.belts.BC02.scaleFlow,
      beltsRunning: bs.filter((b) => b.v > 0.05).length,
      powerTotal,
      energyToday: energy,
      regenToday: bs.reduce((a, b) => a + b.regenToday, 0),
      kwhPerTon: output > 1 ? energy / output : 0,
      savingRate: base > 1 ? 1 - energy / base : 0,
      inventory: Object.values(out.bunkers).reduce((a, m) => a + m.tons, 0),
      peopleUnderground: out.people.length,
      safeDays: Math.floor((ms - msForBeijing(layout.mine.safeSince)) / DAY)
    }
    out.tracks = tracksAt(ms).map((tr) => {
      const s = severity(tr, ms)
      return {
        ...tr,
        s,
        stage: s >= 0.7 ? "二级预警" : s >= 0.35 ? "三级预警" : "劣化观察"
      }
    })
    out.alarms = alarms
    out.maint = sg.maint.filter(
      (w) => ms >= w.start - 30 * MIN && ms < w.end + 30 * MIN
    )
    return out
  }

  /** t 时刻未结束的告警（突发事件 + 达到预警阈值的劣化过程） */
  function alarmsAt(ms) {
    const c = segOf(ms)
    const list = []
    for (const e of [...eventsOfSeg(c - 1), ...eventsOfSeg(c)])
      if (ms >= e.at && ms < e.end)
        list.push({
          ...e,
          status: ms >= e.ackAt ? "处理中" : "未处理",
          source: e.kind === "trip" ? "集控" : "平台"
        })
    for (const tr of tracksAt(ms)) {
      const s = severity(tr, ms)
      if (s < 0.35) continue
      list.push({
        id: `AL-${tr.id}`,
        kind: tr.kind,
        dim: tr.dim,
        level: s >= 0.7 ? 1 : 2,
        sense: tr.sense,
        title: `${tr.where} ${tr.name}`,
        belt: tr.belt,
        device: tr.device,
        chainage: tr.chainage,
        at: s >= 0.7 ? tr.tAlarm : tr.tWarn,
        end: tr.tFix,
        status: s >= 0.7 ? "已派单" : "待确认",
        source: "平台预警",
        track: tr.id,
        predictive: true
      })
    }
    return list.sort((a, b) => a.level - b.level || b.at - a.at)
  }

  /** 一段时间内发生过的事件（告警列表、趋势用） */
  function eventsBetween(ms0, ms1) {
    const out = []
    for (let c = segOf(ms0); c <= segOf(ms1); c++)
      for (const e of eventsOfSeg(c)) if (e.at < ms1 && e.end > ms0) out.push(e)
    return out
  }

  /** 沿线煤量分布：每 step 米一个值，单位 kg/m */
  function profile(beltId, ms, step = 5) {
    const b = beltById[beltId]
    const sg = seg(segOf(ms))
    const x = (ms - sg.t0) / (DT * 1000)
    const i = Math.min(Math.floor(x), STEPS - 1)
    const sArr = sg.ch[`s:${beltId}`]
    const sNow = sArr[i] + (sArr[i + 1] - sArr[i]) * (x - i)
    const n = Math.floor(b.L / step) + 1
    const res = new Float32Array(n)
    for (const ld of b.loads) {
      const cum = sg.ch[`in:${beltId}:${ld.from}`]
      for (let j = 0; j < n; j++) {
        const xm = j * step
        if (xm < ld.at) continue
        const u = sNow - (xm - ld.at)
        if (u <= 0 || u > sNow) continue
        // 找到装载这段带面的那一步，密度 = 该步装的煤 / 该步带面位移
        let lo = 0
        let hi = i + 1
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1
          if (sArr[mid] <= u) lo = mid
          else hi = mid
        }
        const ds = sArr[hi] - sArr[lo]
        if (ds > 0) res[j] += (cum[hi] - cum[lo]) / ds
      }
    }
    return res
  }

  /** 带面走过的距离（m），三维里输送带纹理滚动用 */
  function beltTravel(beltId, ms) {
    return chAt(`s:${beltId}`, ms) + segOf(ms) * 1e5
  }

  /** 光纤测温沿线温度（每米一个值） */
  function dts(beltId, ms) {
    const b = beltById[beltId]
    const n = Math.floor(b.L) + 1
    const T = new Float32Array(n)
    const v = chAt(`v:${beltId}`, ms)
    const amb = ambient(beltId, ms)
    const hot = tracksAt(ms).filter(
      (tr) =>
        tr.belt === beltId &&
        (tr.kind === "idlerBearing" || tr.kind === "pulleyLagging")
    )
    const evHot = eventsOfSeg(segOf(ms)).filter(
      (e) =>
        e.belt === beltId && e.kind === "hotMat" && ms >= e.at && ms < e.end
    )
    for (let x = 0; x < n; x++) {
      let t =
        amb +
        0.5 * smooth("dts" + beltId, x / 37) +
        0.25 * smooth("dtsT" + beltId, x / 7 + ms / (10 * MIN))
      if (x > b.L - 40) t += (v > 0 ? 3.5 : 1) * ((x - (b.L - 40)) / 40) // 驱动部发热
      if (x < 40 && v > 0) t += 0.8 // 受料点
      for (const tr of hot) {
        const s = severity(tr, ms)
        const dx = x - tr.chainage
        t +=
          Math.pow(s, 1.5) * 24 * Math.exp(-(dx * dx) / 2.2) * (v > 0 ? 1 : 0.5)
      }
      for (const e of evHot) {
        const dx = x - (e.chainage || b.L)
        t += 18 * Math.exp(-(dx * dx) / 30)
      }
      T[x] = t
    }
    return T
  }

  /** 光纤听诊：每 6 m 一个分区的异响评分 0–1，和识别出的故障类型 */
  function das(beltId, ms) {
    const b = beltById[beltId]
    const pitch = 6
    const n = Math.ceil(b.L / pitch)
    const score = new Float32Array(n)
    const v = chAt(`v:${beltId}`, ms)
    for (let k = 0; k < n; k++)
      score[k] =
        v > 0.05
          ? 0.06 +
            0.05 * Math.abs(smooth("das" + beltId, k / 3 + ms / (5 * MIN)))
          : 0.02
    const found = []
    for (const tr of tracksAt(ms)) {
      if (tr.belt !== beltId || tr.kind !== "idlerBearing") continue
      const s = severity(tr, ms)
      const k = Math.floor(tr.chainage / pitch)
      if (v > 0.05) score[k] = Math.max(score[k], 0.1 + 0.85 * Math.pow(s, 0.8))
      if (score[k] >= 0.3)
        found.push({
          zone: k,
          chainage: tr.chainage,
          score: score[k],
          type: s > 0.6 ? "轴承异响（严重）" : "轴承异响",
          where: tr.where,
          track: tr.id
        })
    }
    return { pitch, score, found }
  }

  /** 振动频谱（诊断中心）：0–1000 Hz 400 条谱线的速度谱，和 0–200 Hz 包络谱 */
  function spectrum(deviceId, ms) {
    const d = devById[deviceId]
    const b = beltById[d.belt]
    const v = chAt(`v:${b.id}`, ms)
    const rpm = v > 0.05 ? (1490 * v) / b.v : 0
    const f1 = rpm / 60
    const sev = deviceSeverity(deviceId, ms)
    const r = rng("spec", deviceId, Math.floor(ms / MIN))
    const vel = new Float32Array(400)
    const env = new Float32Array(200)
    const bpfo = f1 * 3.58
    const gmf = f1 * 23
    const peak = (arr, df, f, a, w = 1.2) => {
      for (let k = 0; k < arr.length; k++)
        arr[k] += a * Math.exp(-Math.pow((k * df - f) / w, 2))
    }
    for (let k = 0; k < 400; k++) vel[k] = 0.02 + 0.03 * r()
    for (let k = 0; k < 200; k++) env[k] = 0.005 + 0.01 * r()
    if (f1 > 0) {
      peak(vel, 2.5, f1, 1.1)
      peak(vel, 2.5, 2 * f1, 0.45)
      peak(vel, 2.5, gmf, d.kind === "reducer" ? 0.6 + 1.6 * sev : 0.1)
      peak(vel, 2.5, gmf - f1, d.kind === "reducer" ? 0.5 * sev : 0)
      peak(vel, 2.5, gmf + f1, d.kind === "reducer" ? 0.5 * sev : 0)
      for (let h = 1; h <= 4; h++)
        peak(
          env,
          1,
          h * bpfo,
          ((d.kind === "motor" ? 0.9 : 0.2) * sev * sev) / h,
          0.9
        )
    }
    return { f1, bpfo, gmf, rpm, vel, env, df: { vel: 2.5, env: 1 } }
  }

  /** X 光钢丝绳芯检测结果：接头伸长、断丝、锈蚀（随日期缓慢发展） */
  function xray(beltId, ms) {
    const b = beltById[beltId]
    const r = rng("xray", beltId)
    const loop = 2 * b.L + (b.telescopic ? b.telescopic.storage * 2 : 30)
    const nSplice = Math.max(4, Math.round(loop / 250))
    const cords = Math.round((b.B - 60) / 12)
    const days = (ms - msForBeijing("2026-09-01")) / DAY
    const splices = []
    for (let k = 0; k < nSplice; k++)
      splices.push({
        id: `J${String(k + 1).padStart(2, "0")}`,
        pos: Math.round((k + 0.3 + r() * 0.4) * (loop / nSplice)),
        elong:
          Math.round((2 + r() * 6 + Math.max(0, days) * 0.02 * r()) * 10) / 10
      })
    const damages = []
    const nd = 4 + Math.floor(r() * 5)
    for (let k = 0; k < nd; k++) {
      const type = pick(r, ["断丝", "断丝", "锈蚀", "接头抽动", "钢丝绳芯扰动"])
      const c0 = Math.floor(r() * cords)
      const w =
        type === "断丝"
          ? 1 + Math.floor(r() * 3 + Math.max(0, days) * 0.01 * r())
          : 1 + Math.floor(r() * 4)
      damages.push({
        id: `D${k + 1}`,
        type,
        pos: Math.round(r() * loop),
        cords: [c0, Math.min(cords - 1, c0 + w - 1)],
        level: w >= 3 ? "重" : w === 2 ? "中" : "轻"
      })
    }
    const lastScan = msForBeijing(
      beijing(ms).date,
      beijing(ms).h >= 16 ? 16.5 : beijing(ms).h >= 8 ? 8.5 : -7.5
    )
    return {
      belt: beltId,
      loop: Math.round(loop),
      cords,
      splices,
      damages,
      lastScan
    }
  }

  return {
    layout,
    at,
    motorReading,
    reducerReading,
    pulleyReading,
    idlerReading,
    envReading,
    cameraReading,
    uwbReading,
    robotAt,
    peopleAt,
    alarmsAt,
    eventsBetween,
    tracksAt,
    tracksBetween,
    severity,
    nightPlan,
    profile,
    beltTravel,
    dts,
    das,
    spectrum,
    xray,
    chAt,
    cumBetween,
    surfaceTemp,
    ambient
  }
}

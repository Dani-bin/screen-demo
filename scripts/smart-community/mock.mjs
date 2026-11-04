/**
 * 智慧社区（松岚苑）：设计阶段的模拟数据快照
 * ----------------------------------------------------------
 * 写成 build-3d-visual-dashboard 的数据格式（docs/design/smart-community/mock/）：
 *   points.json 测点定义、snapshots.json 61 份快照（17:36–18:36，每分钟一份）、rules.json 口径规则、
 *   window.json 时段与预置异常、design.json 设计稿要用的整屏数字（取设计时刻 18:06 的快照和当天事件表）
 * 设计时刻 2026-11-04 18:06：老人走失搜寻进行中，一号机锁定疑似目标，三号机抵近核验并因 5.8G 衰减切到 2.4G，
 * 充电区 CH-02 温度越限待确认，消防通道占用待确认，CH-03 的热像数据已过期。
 * 数字全部由这里的事件表和轨迹函数算出，汇总值不手写；固定种子，可复现。
 * 注意：这只是设计阶段的数据，页面实现后改由页面的仿真器（sim/simulator.js）生成同格式快照。
 *
 * 用法：node scripts/smart-community/mock.mjs   之后跑
 *       node ~/src/build-3d-visual-dashboard/scripts/data-check.mjs docs/design/smart-community/mock
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { buildLayout } from "./layout.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const OUT = join(ROOT, "docs", "design", "smart-community", "mock")
const DATE = "2026-11-04"
const COUNT = 61 // 17:36–18:36，每分钟一份
const START_MIN = 17 * 60 + 36
const DESIGN_I = 30 // 设计时刻 18:06 对应的快照下标
const STALE_SEC = 1800 // 热像数据超过 30 分钟没被无人机重新扫过算过期

/** 固定种子随机数（mulberry32），保证每次生成一样 */
function rng(seed) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = rng(20261104)
const noise = (amp) => (rand() - 0.5) * 2 * amp
const r1 = (x) => Math.round(x * 10) / 10

const pad = (n) => String(n).padStart(2, "0")
const hm = (s) => {
  const [h, m] = s.split(":").map(Number)
  return h * 60 + m
}
const iso = (minOfDay, sec = 0) =>
  `${DATE}T${pad(Math.floor(minOfDay / 60))}:${pad(minOfDay % 60)}:${pad(sec)}+08:00`
const clock = (minOfDay) =>
  `${pad(Math.floor(minOfDay / 60))}:${pad(minOfDay % 60)}`

// ---------------------------------------------------------------- 当天事件表
// 状态：pending 待确认 / dispatched 已派单 / processing 处置中 / review 待复核 / closed 已办结 / false 误报
const STATUS_TEXT = {
  pending: "待确认",
  dispatched: "已派单",
  processing: "处置中",
  review: "待复核",
  closed: "已办结",
  false: "误报"
}
const TYPE_TEXT = {
  PT: "周界入侵",
  TH: "热源异常",
  FP: "消防通道占用",
  FC: "外立面隐患",
  SR: "走失搜寻"
}
/** steps：[时刻, 状态]，第一项是创建时刻 */
const EVENTS = [
  {
    id: "EV-0401",
    type: "PT",
    title: "西围墙有人翻越",
    zone: "GT-03",
    by: "UAV-01",
    steps: [
      ["02:12", "pending"],
      ["02:13", "dispatched"],
      ["02:16", "processing"],
      ["02:31", "closed"]
    ]
  },
  {
    id: "EV-0402",
    type: "PT",
    title: "东围墙疑似热源（野猫，已过滤）",
    zone: "GT-02",
    by: "UAV-01",
    steps: [
      ["02:40", "pending"],
      ["02:42", "false"]
    ]
  },
  {
    id: "EV-0403",
    type: "FP",
    title: "消防环路北段车辆占用",
    zone: "FR-01",
    by: "UAV-01",
    steps: [
      ["06:30", "pending"],
      ["06:31", "dispatched"],
      ["07:05", "closed"]
    ]
  },
  {
    id: "EV-0404",
    type: "FC",
    title: "B03 外立面空鼓",
    zone: "B03",
    by: "UAV-03",
    steps: [
      ["09:10", "pending"],
      ["09:12", "dispatched"],
      ["14:00", "processing"],
      ["16:30", "review"]
    ]
  },
  {
    id: "EV-0405",
    type: "FC",
    title: "B07 屋顶堆物",
    zone: "B07",
    by: "UAV-03",
    steps: [
      ["10:05", "pending"],
      ["10:07", "dispatched"],
      ["11:40", "closed"]
    ]
  },
  {
    id: "EV-0406",
    type: "TH",
    title: "CH-01 充电区温度偏高",
    zone: "CH-01",
    by: "UAV-01",
    steps: [
      ["11:30", "pending"],
      ["11:32", "dispatched"],
      ["11:48", "closed"]
    ]
  },
  {
    id: "EV-0407",
    type: "FP",
    title: "消防环路东段车辆占用",
    zone: "FR-01",
    by: "UAV-01",
    steps: [
      ["15:00", "pending"],
      ["15:01", "dispatched"],
      ["15:40", "closed"]
    ]
  },
  {
    id: "EV-0408",
    type: "FP",
    title: "FA-03 消防登高面被占用",
    zone: "FA-03",
    by: "UAV-01",
    steps: [
      ["15:02", "pending"],
      ["15:04", "dispatched"],
      ["15:07", "processing"],
      ["16:50", "review"]
    ]
  },
  {
    id: "EV-0409",
    type: "FC",
    title: "B11 外墙渗漏",
    zone: "B11",
    by: "UAV-03",
    steps: [
      ["16:05", "pending"],
      ["16:06", "dispatched"]
    ]
  },
  {
    id: "EV-0410",
    type: "TH",
    title: "CH-03 充电区温度偏高",
    zone: "CH-03",
    by: "UAV-01",
    steps: [
      ["17:20", "pending"],
      ["17:22", "dispatched"],
      ["17:40", "closed"]
    ]
  },
  {
    id: "EV-0411",
    type: "SR",
    title: "走失老人搜寻（78 岁，灰色外套）",
    zone: "BS-04",
    by: "UAV-01 / 02 / 03",
    steps: [
      ["17:52", "pending"],
      ["17:54", "processing"],
      ["18:14", "review"],
      ["18:30", "closed"]
    ]
  },
  {
    id: "EV-0412",
    type: "TH",
    title: "CH-02 充电区温度异常",
    zone: "CH-02",
    by: "UAV-01",
    steps: [["18:01", "pending"]]
  },
  {
    id: "EV-0413",
    type: "FP",
    title: "消防环路南段车辆占用",
    zone: "FR-01",
    by: "UAV-01",
    steps: [["18:03", "pending"]]
  }
]
/** 事件在某分钟的状态；还没创建返回 null */
function statusAt(ev, min) {
  let s = null
  for (const [t, st] of ev.steps) if (hm(t) <= min) s = st
  return s
}

// ---------------------------------------------------------------- 三机轨迹（按快照下标 i，i=0 是 17:36）
// 任务状态：0 待命 1 起飞 2 扫描 3 核验 4 中继悬停 5 返航 6 追踪
const TASK_TEXT = ["待命", "起飞", "扫描", "核验", "中继悬停", "返航", "追踪"]
/** 每架机的任务时间表：[起始下标, 任务] */
const PLAN = {
  "UAV-01": [
    [0, 0],
    [17, 1],
    [18, 2],
    [28, 3],
    [33, 6],
    [48, 5],
    [54, 0]
  ],
  "UAV-02": [
    [0, 0],
    [16, 1],
    [17, 4],
    [52, 5],
    [56, 0]
  ],
  "UAV-03": [
    [0, 0],
    [18, 1],
    [19, 2],
    [26, 3],
    [43, 5],
    [48, 0]
  ]
}
/** 空中每分钟耗电 %，地面充电 +1.2 %/min */
const DRAIN = { "UAV-01": 2.5, "UAV-02": 1.0, "UAV-03": 3.2 }
const taskAt = (id, i) => PLAN[id].filter(([s]) => s <= i).at(-1)[1]
const airborne = (task) => task !== 0

/** 逐分钟算电量（起飞后按耗电率减，落地后充电） */
function batteryTrack(id) {
  const out = []
  let b = 100
  for (let i = 0; i < COUNT; i++) {
    const task = taskAt(id, i)
    if (i > 0) b = airborne(task) ? b - DRAIN[id] : Math.min(100, b + 1.2)
    out.push(r1(b))
  }
  return out
}
const BATT = Object.fromEntries(
  Object.keys(PLAN).map((id) => [id, batteryTrack(id)])
)

/** 三号机在 18:05–18:09（i=29..33）进入楼栋夹缝，5.8G 衰减、切到 2.4G 备用链路 */
const inDip = (i) => i >= 28 && i <= 33
const onBackup = (i) => i >= 29 && i <= 33

const ALT = {
  "UAV-01": [0, 0, 78, 62, 62, 0],
  "UAV-02": [0, 110],
  "UAV-03": [0, 18]
}
function altAt(id, i, task) {
  if (!airborne(task)) return 0
  if (id === "UAV-02") return r1(110 + noise(1.5))
  if (id === "UAV-03") return r1((task === 5 ? 40 : 18) + noise(2))
  return r1((task === 2 ? 78 : task === 5 ? 90 : 62) + noise(3)) // 一号机扫描 78 m，核验 / 追踪压低到 62 m
}
function spdAt(id, task) {
  if (!airborne(task)) return 0
  const base = { 0: 0, 1: 4, 2: 9, 3: 3.2, 4: 0.4, 5: 8, 6: 5 }[task]
  return r1(Math.max(0, base + noise(task === 4 ? 0.2 : 0.8)))
}

// ---------------------------------------------------------------- 其它轨迹
const BLIND_CHECK = {
  "BS-02": 20,
  "BS-01": 23,
  "BS-03": 26,
  "BS-04": 28,
  "BS-05": 36,
  "BS-06": 40
}
const blindChecked = (i) =>
  Object.values(BLIND_CHECK).filter((k) => k <= i).length
/** 搜寻目标：28 疑似（可见光被遮挡 + 红外异常热源），33 确认（补盲机核验 + 多源融合，误差 ≤ ±1.5 m） */
function target(i) {
  if (i < 28) return { status: 0, conf: 0, err: 0 }
  if (i < 33)
    return {
      status: 1,
      conf: [0.78, 0.81, 0.84, 0.86, 0.89][i - 28],
      err: [4.2, 3.1, 2.4, 2.0, 1.7][i - 28]
    }
  return { status: 2, conf: 0.93, err: 1.2 }
}
const coverage = (i) => (i < 18 ? 0 : Math.min(100, r1(6.3 * (i - 18))))
/** 充电区温度：CH-02 从 17:46 起升温，18:01 越过 60 ℃ 预警线（项目书的红外阈值筛选，阈值为演示假设）；CH-03 测一次后无人机没再扫过 */
function chTemp(id, i) {
  if (id === "CH-01") return r1(36 + noise(1.2))
  if (id === "CH-03") return 35
  if (i <= 10) return r1(41 + noise(0.4))
  if (i <= 25) return r1(41 + 1.4 * (i - 10) + noise(0.3))
  return r1(62 + 1.2 * (i - 25) + noise(0.3))
}

// ---------------------------------------------------------------- 测点定义
const layout = buildLayout()
const points = []
const P = (id, device, name, unit, kind, min, max) =>
  points.push({
    id,
    device,
    name,
    unit,
    kind,
    ...(min !== undefined ? { min, max } : {})
  })
for (const id of Object.keys(PLAN)) {
  P(`${id}.batt`, id, "电量", "%", "analog", 0, 100)
  P(`${id}.alt`, id, "飞行高度", "m", "analog", 0, 200)
  P(`${id}.spd`, id, "地速", "m/s", "analog", 0, 20)
  P(
    `${id}.task`,
    id,
    "任务状态（0 待命 1 起飞 2 扫描 3 核验 4 中继悬停 5 返航 6 追踪）",
    "",
    "state",
    0,
    6
  )
  P(
    `${id}.link`,
    id,
    "当前链路（0 为 5.8G 主链路，1 为 2.4G 备用）",
    "",
    "state",
    0,
    1
  )
  P(`${id}.rssi58`, id, "5.8G 信号强度", "dBm", "analog", -100, -30)
  P(`${id}.rssi24`, id, "2.4G 信号强度", "dBm", "analog", -100, -30)
  P(`${id}.lat`, id, "链路延迟", "ms", "analog", 0, 200)
}
for (const id of ["CH-01", "CH-02", "CH-03"])
  P(`${id}.temp`, id, "红外最高温度", "℃", "analog", 0, 120)
for (const k of [
  "total",
  "pending",
  "dispatched",
  "processing",
  "review",
  "closed",
  "false",
  "done",
  "PT",
  "TH",
  "FP",
  "FC",
  "SR"
])
  P(`events.${k}`, "GS-01", `今日事件·${k}`, "件", "analog", 0, 99)
P("events.doneRate", "GS-01", "事件处置率", "", "analog", 0, 1)
P("blind.total", "GS-01", "盲区总数", "处", "analog", 0, 20)
P("blind.checked", "GS-01", "已核验盲区", "处", "analog", 0, 20)
P("blind.rate", "GS-01", "盲区核验率", "", "analog", 0, 1)
P(
  "target.status",
  "UAV-01",
  "搜寻目标状态（0 无 1 疑似 2 确认）",
  "",
  "state",
  0,
  2
)
P("target.conf", "UAV-01", "目标置信度（阈值 0.7）", "", "analog", 0, 1)
P("target.err", "UAV-01", "融合定位误差", "m", "analog", 0, 20)
P("coverage.pct", "GS-01", "本次搜寻区域覆盖率", "%", "counter", 0, 100)
P("sorties.done", "GS-01", "今日已完成架次", "架次", "counter")
P("flight.min", "GS-01", "今日累计飞行", "分钟", "counter")
P("env.wind", "GS-01", "风速", "m/s", "analog", 0, 30)
P("env.temp", "GS-01", "气温", "℃", "analog", -20, 50)

// ---------------------------------------------------------------- 快照
/** 记录每个测点的变化时刻：值和上一份不同时才更新 changedAt */
const last = new Map()
const snapshots = []
let sorties = 12
let flightMin = 386
for (let i = 0; i < COUNT; i++) {
  const min = START_MIN + i
  const t = iso(min)
  const vals = {}
  const put = (id, v, q = "good", verifiedAt = t) => {
    const prev = last.get(id)
    const changedAt = prev && prev.v === v ? prev.changedAt : t
    last.set(id, { v, changedAt })
    vals[id] = {
      v,
      q,
      changedAt: changedAt > verifiedAt ? verifiedAt : changedAt,
      verifiedAt
    }
  }

  let flying = 0
  for (const id of Object.keys(PLAN)) {
    const task = taskAt(id, i)
    const prevTask = i > 0 ? taskAt(id, i - 1) : task
    if (airborne(task)) flying++
    if (i > 0 && airborne(prevTask) && !airborne(task)) sorties++ // 落地算一个架次
    const dip = id === "UAV-03" && inDip(i)
    const backup = id === "UAV-03" && onBackup(i)
    put(`${id}.batt`, BATT[id][i])
    put(`${id}.alt`, altAt(id, i, task))
    put(`${id}.spd`, spdAt(id, task))
    put(`${id}.task`, task)
    put(`${id}.link`, backup ? 1 : 0)
    // 切换那一分钟（i=28、29）5.8G 读数在跳，质量不确定
    put(
      `${id}.rssi58`,
      dip
        ? -84 + (i - 28) * 0 + Math.round(noise(2))
        : Math.round(
            { "UAV-01": -58, "UAV-02": -52, "UAV-03": -66 }[id] + noise(3)
          ),
      id === "UAV-03" && (i === 28 || i === 29) ? "uncertain" : "good"
    )
    put(
      `${id}.rssi24`,
      Math.round(
        { "UAV-01": -62, "UAV-02": -58, "UAV-03": dip ? -71 : -64 }[id] +
          noise(2)
      )
    )
    put(
      `${id}.lat`,
      Math.round(
        (dip ? 44 : { "UAV-01": 21, "UAV-02": 18, "UAV-03": 24 }[id]) + noise(3)
      )
    )
  }
  flightMin += flying

  // 热像温度：CH-03 在 17:20 被无人机扫过一次后就没再测，超过 30 分钟质量降为 uncertain（过期）
  put("CH-01.temp", chTemp("CH-01", i))
  put("CH-02.temp", chTemp("CH-02", i))
  const age3 = (Date.parse(t) - Date.parse(iso(hm("17:20")))) / 1000
  put(
    "CH-03.temp",
    35,
    age3 > STALE_SEC ? "uncertain" : "good",
    iso(hm("17:20"))
  )

  // 事件计数：全部从事件表数出来
  const cnt = {
    total: 0,
    pending: 0,
    dispatched: 0,
    processing: 0,
    review: 0,
    closed: 0,
    false: 0,
    PT: 0,
    TH: 0,
    FP: 0,
    FC: 0,
    SR: 0
  }
  for (const ev of EVENTS) {
    const s = statusAt(ev, min)
    if (!s) continue
    cnt.total++
    cnt[s]++
    cnt[ev.type]++
  }
  for (const k of Object.keys(cnt)) put(`events.${k}`, cnt[k])
  put("events.done", cnt.closed + cnt.false)
  put("events.doneRate", (cnt.closed + cnt.false) / cnt.total)

  put("blind.total", layout.totals.blindZones)
  put("blind.checked", blindChecked(i))
  put("blind.rate", blindChecked(i) / layout.totals.blindZones)
  const tg = target(i)
  put("target.status", tg.status)
  put("target.conf", tg.conf)
  put("target.err", tg.err)
  put("coverage.pct", coverage(i))
  put("sorties.done", sorties)
  put("flight.min", flightMin)
  put("env.wind", r1(2.8 + noise(0.5)))
  put("env.temp", r1(14.2 - i * 0.02))

  snapshots.push({ t, values: vals })
}

// ---------------------------------------------------------------- 口径规则
const rules = [
  // 事件总数 = 各状态之和，也 = 各类型之和（两个口径互相核对）
  {
    type: "sum",
    target: "events.total",
    of: [
      "pending",
      "dispatched",
      "processing",
      "review",
      "closed",
      "false"
    ].map((k) => `events.${k}`)
  },
  {
    type: "sum",
    target: "events.total",
    of: ["PT", "TH", "FP", "FC", "SR"].map((k) => `events.${k}`)
  },
  // 已处置 = 已办结 + 误报；处置率 = 已处置 / 总数（不平均各类的百分比）
  { type: "sum", target: "events.done", of: ["events.closed", "events.false"] },
  {
    type: "ratio",
    target: "events.doneRate",
    num: "events.done",
    den: "events.total"
  },
  {
    type: "ratio",
    target: "blind.rate",
    num: "blind.checked",
    den: "blind.total"
  },
  // 热像数据超过 30 分钟没被重新扫描，质量不能是 good
  { type: "stale", maxAgeSec: STALE_SEC }
]

// ---------------------------------------------------------------- 设计稿用的整屏数字
const dv = snapshots[DESIGN_I].values
const v = (id) => dv[id].v
const designMin = START_MIN + DESIGN_I
const drones = Object.keys(PLAN).map((id) => ({
  id,
  name: layout.air.find((a) => a.id === id).name,
  batt: v(`${id}.batt`),
  alt: v(`${id}.alt`),
  spd: v(`${id}.spd`),
  task: v(`${id}.task`),
  taskText: TASK_TEXT[v(`${id}.task`)],
  link: v(`${id}.link`) ? "2.4G 备用" : "5.8G 主链路",
  rssi58: v(`${id}.rssi58`),
  rssi24: v(`${id}.rssi24`),
  lat: v(`${id}.lat`)
}))
const eventList = EVENTS.map((e) => {
  const s = statusAt(e, designMin)
  return (
    s && {
      id: e.id,
      type: e.type,
      typeText: TYPE_TEXT[e.type],
      title: e.title,
      zone: e.zone,
      by: e.by,
      created: e.steps[0][0],
      status: s,
      statusText: STATUS_TEXT[s],
      at: e.steps.filter(([t]) => hm(t) <= designMin).at(-1)[0]
    }
  )
})
  .filter(Boolean)
  .reverse()
const series = (id) => snapshots.map((s) => s.values[id].v)
const design = {
  moment: iso(designMin),
  momentText: "2026-11-04 18:06",
  community: {
    name: layout.site.name,
    buildings: layout.buildings.length,
    households: layout.totals.households,
    blindZones: layout.totals.blindZones
  },
  drones,
  events: eventList,
  counts: Object.fromEntries(
    [
      "total",
      "pending",
      "dispatched",
      "processing",
      "review",
      "closed",
      "false",
      "done",
      "PT",
      "TH",
      "FP",
      "FC",
      "SR"
    ].map((k) => [k, v(`events.${k}`)])
  ),
  doneRate: v("events.doneRate"),
  blind: {
    total: v("blind.total"),
    checked: v("blind.checked"),
    rate: v("blind.rate"),
    checks: BLIND_CHECK
  },
  target: {
    status: v("target.status"),
    conf: v("target.conf"),
    err: v("target.err")
  },
  coverage: v("coverage.pct"),
  sorties: v("sorties.done"),
  flightMin: v("flight.min"),
  thermal: Object.fromEntries(
    ["CH-01", "CH-02", "CH-03"].map((id) => [
      id,
      {
        temp: v(`${id}.temp`),
        q: dv[`${id}.temp`].q,
        verifiedAt: dv[`${id}.temp`].verifiedAt.slice(11, 16)
      }
    ])
  ),
  env: { wind: v("env.wind"), temp: v("env.temp") },
  series: {
    minutes: snapshots.map((s) => s.t.slice(11, 16)),
    batt: Object.fromEntries(
      Object.keys(PLAN).map((id) => [id, series(`${id}.batt`)])
    ),
    ch02: series("CH-02.temp"),
    rssi58_03: series("UAV-03.rssi58"),
    rssi24_03: series("UAV-03.rssi24")
  }
}

const windowInfo = {
  date: DATE,
  start: snapshots[0].t,
  end: snapshots.at(-1).t,
  designMoment: design.moment,
  presetAnomalies: [
    {
      kind: "告警",
      at: "18:01",
      what: "CH-02 充电区红外温度越过 60 ℃（预警线，演示假设），设计时刻 68.0 ℃ 待确认"
    },
    {
      kind: "数据过期",
      at: "17:51 起",
      what: "CH-03 热像数据停在 17:20，超过 30 分钟没被无人机重新扫描，质量 uncertain"
    },
    {
      kind: "质量不确定",
      at: "18:04–18:05",
      what: "UAV-03 的 5.8G 读数在进入楼栋夹缝时跳动，18:05 自动切到 2.4G 备用链路，18:10 切回"
    },
    {
      kind: "目标疑似→确认",
      at: "18:04 / 18:09",
      what: "BS-04 夹缝内可见光被遮挡 + 红外异常热源 → 疑似；三号机抵近核验后确认，融合定位误差 1.2 m"
    },
    {
      kind: "低电量补位",
      at: "18:17",
      what: "UAV-03 电量降到 23 %（低于 25 % 补位线），18:19 自动返航，一号机补位盲区核验"
    }
  ],
  eventTable: EVENTS.map((e) => ({ id: e.id, type: e.type, steps: e.steps }))
}

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, "points.json"), JSON.stringify(points, null, 2))
writeFileSync(join(OUT, "snapshots.json"), JSON.stringify(snapshots))
writeFileSync(join(OUT, "rules.json"), JSON.stringify(rules, null, 2))
writeFileSync(join(OUT, "window.json"), JSON.stringify(windowInfo, null, 2))
writeFileSync(join(OUT, "design.json"), JSON.stringify(design, null, 2))
// 设计稿合成页用 file:// 直接打开，数据以脚本形式引入（不需要开发服务器）
writeFileSync(
  join(ROOT, "docs", "design", "smart-community", "design", "src", "data.js"),
  `window.DESIGN = ${JSON.stringify(design)}\n`
)
console.log(
  `测点 ${points.length} 个，快照 ${snapshots.length} 份；设计时刻 ${design.momentText}：事件 ${design.counts.total} 件（待确认 ${design.counts.pending} / 处置率 ${(design.doneRate * 100).toFixed(1)} %）`
)

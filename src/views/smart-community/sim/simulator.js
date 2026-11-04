/**
 * 智慧社区（松岚苑）：无人机空中巡防仿真（页面、模拟数据、设计稿数字的唯一来源）
 * ----------------------------------------------------------
 * 一天（2026-11-04）里的全部状态都是时刻 t（北京时间，当天第几分钟，可带小数）的纯函数：
 *   - 三机的飞行任务（架次）：起降、航点、任务状态、耗电；
 *   - 5 类事件的状态流（待确认 → 已派单 → 处置中 → 待复核 → 已办结 / 误报）；
 *   - 走失搜寻的盲区核验、目标疑似 → 确认、融合误差收敛；
 *   - 充电区红外温度、链路切换、环境。
 * 设计时刻 DESIGN_T = 18:06：连续量（高度、速度、信号、温度、风速）写成"设计值 + (噪声(t) − 噪声(DESIGN_T))"，
 * 所以 ?at=18:06 能还原出定稿 final.png 上的每个数字；累计量（架次、飞行分钟、事件数）从架次表和事件表数出来，
 * 不手写：已完成 12 架次、累计飞行 428 分钟、事件 13 件都是数出来的。
 * 项目书的指标（识别阈值 0.7、融合定位 ≤ ±1.5 m、延迟 ≤ 50 ms、单机续航）落在 DRAIN、TARGET、LINK 这几张表里。
 *
 * 公共接口（createSim(layout) 返回）：
 *   at(t)                 整份快照（见下方 snapshot 注释）
 *   series(id, t0, t1, n) 图表用的时间序列，id 如 "UAV-01.batt"、"UAV-03.rssi58"、"CH-02.temp"
 *   EVENTS / STORIES / hm / clock / DESIGN_T
 */

// ---------------------------------------------------------------- 时间工具
/** "HH:MM" 或 "HH:MM:SS" → 当天第几分钟（小数） */
export const hm = (s) => {
  const [h, m, sec = 0] = s.split(":").map(Number)
  return h * 60 + m + sec / 60
}
const pad = (n) => String(n).padStart(2, "0")
/** 分钟 → "HH:MM" */
export const clock = (t) =>
  `${pad(Math.floor(t / 60) % 24)}:${pad(Math.floor(t) % 60)}`
/** 分钟 → "HH:MM:SS" */
export const clockSec = (t) => `${clock(t)}:${pad(Math.floor((t % 1) * 60))}`
export const DESIGN_T = hm("18:06")

const clamp = (x, a, b) => Math.min(b, Math.max(a, x))
const lerp = (a, b, k) => a + (b - a) * k
const smooth = (a, b, x) => {
  const k = clamp((x - a) / (b - a), 0, 1)
  return k * k * (3 - 2 * k)
}
/** 平滑确定性噪声（−1…1），同一个 seed 的曲线是固定的 */
const sn = (t, seed) =>
  0.55 * Math.sin(t * 1.7 + seed * 1.3) +
  0.3 * Math.sin(t * 0.63 + seed * 2.1) +
  0.15 * Math.sin(t * 4.1 + seed * 0.7)

/** 字符串 → 稳定的非负整数（给事件编号派生固定的小数用） */
const hash = (str) =>
  [...str].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

// ---------------------------------------------------------------- 文案
export const STATUS_TEXT = {
  pending: "待确认",
  dispatched: "已派单",
  processing: "处置中",
  review: "待复核",
  closed: "已办结",
  false: "误报"
}
export const TYPE_TEXT = {
  PT: "周界入侵",
  TH: "热源异常",
  FP: "消防通道占用",
  FC: "外立面隐患",
  SR: "走失搜寻"
}
export const TASK_TEXT = [
  "待命",
  "起飞",
  "扫描",
  "核验",
  "中继悬停",
  "返航",
  "追踪"
]
export const ROLE = {
  "UAV-01": "主侦查机",
  "UAV-02": "中继机",
  "UAV-03": "补盲机"
}

// ---------------------------------------------------------------- 当天事件表
/**
 * 事件：steps = [[时刻, 状态], …]，第一项是创建；zone 是编号（楼栋 / 设施）；
 * focus 是 3D 里标记事件位置用的平面点（缺省取 zone 的位置）；mission 是出动的架次组名。
 */
export const EVENTS = [
  {
    id: "EV-0401",
    type: "PT",
    title: "西围墙有人翻越",
    zone: "GT-03",
    by: "UAV-01",
    focus: [-150, 14],
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
    focus: [146, -72],
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
    focus: [0, 96],
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
    focus: [138, 0],
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
    priority: "urgent",
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
    focus: [0, -93],
    steps: [["18:03", "pending"]]
  }
]

// ---------------------------------------------------------------- 飞行架次
/** 任务码：0 待命 1 起飞 2 扫描 3 核验 4 中继悬停 5 返航 6 追踪 */
/** 每分钟耗电 %（项目书：一号机续航 ≥ 40 min；中继机长续航；补盲机高机动、耗电最快）。落地后 10 %/min 快速换电 */
const DRAIN = { "UAV-01": 2.5, "UAV-02": 1.0, "UAV-03": 3.2 }
const CHARGE = 30
/** 机库在物业中心（会所）屋顶：起降点高度 = 屋顶板顶面（真实高度），三机在停机坪上沿东西方向并排停（间距 13 m） */
const PAD_SLOT = { "UAV-01": -13, "UAV-02": 0, "UAV-03": 13 }

/** 围绕一点转圈的航点（追踪用）：t0 起每 step 分钟一个点 */
function orbit(t0, t1, cx, cy, z, r, task, step = 1.5) {
  const out = []
  const n = Math.round((t1 - t0) / step)
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.6
    out.push([
      clock(t0 + i * step) + ":" + pad(Math.round(((t0 + i * step) % 1) * 60)),
      cx + r * Math.cos(a),
      cy + r * Math.sin(a),
      z,
      task
    ])
  }
  return out
}

/**
 * 架次表：航点 [时刻, x, y, 真实高度 z（m）, 任务码]，起点和终点是机库（HG）。
 * 起飞时刻 = 第一个航点，落地时刻 = 最后一个航点；累计飞行分钟、完成架次都从这里数。
 * 时刻按设计时刻 18:06 反推：UAV-02 17:51、UAV-01 17:52、UAV-03 17:53 起飞，
 * 到 18:06 分别飞了 15 / 14 / 13 分钟 → 电量 85 / 65 / 58.4 %，当天此前已完成 12 架次、累计飞行 386 分钟。
 *
 * 坐标是 /estate 沙盘的平面米（x 向东、y 向北，原点在地块中心，见 scripts/smart-community/layout.mjs）。
 * 航点高度 z 写成"机库屋顶以上多少米"（A(z)，数字沿用旧版：旧机库在 3 层物业楼顶，高 10.8 m），换到会所屋顶后整体平移，
 * 所以每个时刻"高度（距机库）"读数不变；塔楼最高 96 m，一号机 / 二号机巡航高度在 100 m 以上，三号机才钻塔楼夹缝和树荫。
 * 位置取自布局里的设施编号（pos），不写死数字：盲区、充电区、大门换位置时航线跟着走。
 */
function buildSorties(HG, padZ, pos) {
  const H = (t, task) => [t, HG[0], HG[1], padZ, task]
  /** 旧版航点高度（以旧机库屋顶 10.8 m 为基准）→ 现在的绝对高度 */
  const A = (z) => z - 10.8 + padZ
  const at = (id, dx = 0, dy = 0) => [pos(id).x + dx, pos(id).y + dy]
  /** 返航前经过的点：机库南侧上空 */
  const BACK = [HG[0], HG[1] + 25]
  const S = []
  const add = (drone, event, pts) =>
    S.push({ drone, event, pts: pts.map(([t, ...r]) => [hm(t), ...r]) })

  // ---- 二号机（中继，长续航）：每次巡检它先升空搭链路，最后降落；悬停在行动区和机库之间的高空
  add("UAV-02", "PT", [
    H("02:09", 1),
    ["02:10", BACK[0], BACK[1], A(60), 1],
    ["02:12", -95, 12, A(90), 4],
    ["02:46", -95, 12, A(90), 4],
    ["02:47", BACK[0], BACK[1], A(50), 5],
    H("02:50", 0)
  ])
  add("UAV-02", "FC", [
    H("09:07", 1),
    ["09:08", -20, -40, A(70), 1],
    ["09:10", 30, 10, A(100), 4],
    ["10:06", 30, 10, A(100), 4],
    ["10:07", BACK[0], BACK[1], A(40), 5],
    H("10:10", 0)
  ])
  add("UAV-02", "FP", [
    H("14:55", 1),
    ["14:56", 40, -40, A(75), 1],
    ["14:58", 95, -10, A(100), 4],
    ["15:41", 95, -10, A(100), 4],
    ["15:42", BACK[0], BACK[1], A(40), 5],
    H("15:45", 0)
  ])
  add("UAV-02", "SR", [
    H("17:51", 1),
    ["17:52", 0, -40, A(60), 1],
    ["17:53", 0, 0, A(119.3), 4],
    ["18:28", 0, 0, A(119.3), 5],
    ["18:31", BACK[0], BACK[1], A(40), 5],
    H("18:32", 0)
  ])

  // ---- 一号机（主侦查，六轴，续航约 40 min）
  add("UAV-01", "PT", [
    H("02:10", 1),
    ["02:11", -60, -30, A(60), 2],
    ["02:12:30", -140, 14, A(60), 2],
    ["02:14", -150, 14, A(32), 3],
    ["02:16", -150, 14, A(32), 3],
    ["02:22", -146, 14, A(40), 6],
    ["02:30", -146, 14, A(40), 6],
    ["02:31", BACK[0], BACK[1], A(40), 5],
    H("02:34", 0)
  ])
  add("UAV-01", "FP", [
    H("06:28", 1),
    ["06:29", -60, -30, A(60), 2],
    ["06:31", -130, 90, A(60), 2],
    ["06:33", 0, 96, A(55), 3],
    ["06:42", 0, 96, A(55), 3],
    ["06:50", 136, 80, A(60), 2],
    ["06:58", BACK[0], BACK[1], A(50), 5],
    H("07:02", 0)
  ])
  add("UAV-01", "FC", [
    H("09:08", 1),
    ["09:09", 0, -20, A(70), 2],
    ["09:12", 35, 28, A(100), 2],
    ["09:20", 35, 26, A(100), 3],
    ["09:28", 35, 26, A(100), 3],
    ["09:30", 20, -10, A(70), 5],
    H("09:34", 0)
  ])
  add("UAV-01", "TH", [
    H("11:28", 1),
    ["11:29", ...at("CH-01", 0, -10), A(40), 3],
    ["11:44", ...at("CH-01", 0, -10), A(40), 3],
    ["11:46", -60, -30, A(60), 2],
    ["11:55", BACK[0], BACK[1], A(40), 5],
    H("12:00", 0)
  ])
  add("UAV-01", "FP", [
    H("14:58", 1),
    ["14:59", 60, -70, A(60), 2],
    ["15:02", 138, 0, A(60), 3],
    ["15:14", 138, 0, A(60), 3],
    ["15:16", 138, -60, A(50), 2],
    ["15:25", BACK[0], BACK[1], A(40), 5],
    H("15:30", 0)
  ])
  add("UAV-01", "TH", [
    H("17:18", 1),
    ["17:19", 30, -50, A(50), 2],
    ["17:20", ...at("CH-03", 0, -10), A(35), 3],
    ["17:30", ...at("CH-03", 0, -10), A(35), 5],
    ["17:32", BACK[0], BACK[1], A(40), 5],
    H("17:34", 0)
  ])
  // 走失搜寻：先大范围扫描（顺带发现 CH-02 升温、环路南段占用），18:04 锁定疑似目标，18:09 起追踪
  const bs4 = pos("BS-04")
  add("UAV-01", "SR", [
    H("17:52", 1),
    ["17:54", -120, -60, A(90), 2],
    ["17:56:30", -120, 92, A(90), 2],
    ["17:58:30", -20, 92, A(90), 2],
    ["18:00", -30, -40, A(90), 2],
    ["18:01", 100, -45, A(90), 2],
    ["18:02:30", 138, -20, A(90), 2],
    ["18:04", bs4.x - 30, bs4.y, A(71.7), 3],
    ["18:09", bs4.x - 30, bs4.y, A(71.7), 3],
    ...orbit(hm("18:09"), hm("18:24"), bs4.x, bs4.y, A(71.7), 30, 6).slice(1),
    ["18:28", BACK[0], BACK[1], A(50), 5],
    H("18:30", 0)
  ])

  // ---- 三号机（补盲，四轴，近距离抵近，耗电最快）
  add("UAV-03", "FC", [
    H("09:08", 1),
    ["09:10", 20, 30, A(50), 2],
    ["09:13", 43, 42, A(40), 3],
    ["09:27", 43, 42, A(40), 3],
    ["09:28", 20, 0, A(40), 5],
    H("09:32", 0)
  ])
  add("UAV-03", "FC", [
    H("10:03", 1),
    ["10:05", -112, -8, A(40), 3],
    ["10:20", -112, -8, A(40), 3],
    ["10:21", -60, -30, A(40), 5],
    H("10:25", 0)
  ])
  add("UAV-03", "FC", [
    H("16:03", 1),
    ["16:05", 79, -30, A(25), 3],
    ["16:20", 79, -30, A(25), 3],
    ["16:21", 30, -60, A(25), 5],
    H("16:25", 0)
  ])
  // 走失搜寻：逐个补扫盲区，18:03 进入 BS-04 湖东林荫带（5.8G 衰减，18:05 切 2.4G），18:19 电量低返航
  add("UAV-03", "SR", [
    H("17:53", 1),
    ["17:54", BACK[0], BACK[1], A(45), 1],
    ["17:55", ...at("BS-02"), A(30), 2],
    ["17:56", ...at("BS-02"), A(30), 2],
    ["17:58", ...at("BS-01"), A(30), 2],
    ["17:59", ...at("BS-01"), A(30), 2],
    ["18:00:30", ...at("BS-03"), A(30), 2],
    ["18:02", ...at("BS-03"), A(30), 3],
    ["18:03", ...at("BS-04", -12, 6), A(40), 3],
    ["18:04", ...at("BS-04", -4, 4), A(31), 3],
    ["18:06", ...at("BS-04", 0, 5), A(29.3), 3],
    ["18:09", ...at("BS-04", 0, 5), A(29.3), 3],
    ["18:11", ...at("BS-05"), A(36), 2],
    ["18:12", ...at("BS-05"), A(36), 2],
    ["18:13:30", 60, -10, A(35), 2],
    ["18:15", ...at("BS-06"), A(36), 2],
    ["18:16", ...at("BS-06"), A(36), 2],
    ["18:19", ...at("BS-06"), A(36), 5],
    ["18:22", BACK[0], BACK[1], A(40), 5],
    H("18:24", 0)
  ])
  return S
}

/** 三次样条（Hermite）插值：保持航点之间"悬停段"不漂移（相邻两点相同的一侧切线取 0） */
function samplePath(pts, t) {
  let i = 0
  while (i < pts.length - 2 && t > pts[i + 1][0]) i++
  const p0 = pts[i - 1],
    p1 = pts[i],
    p2 = pts[i + 1],
    p3 = pts[i + 2]
  const dt = p2[0] - p1[0] || 1
  const k = clamp((t - p1[0]) / dt, 0, 1)
  const same = (a, b) =>
    a && b && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
  const out = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const a = p1[c + 1],
      b = p2[c + 1]
    // 端点和悬停点的切线为 0，其余按前后邻点的差
    const m1 =
      !p0 || same(p0, p1) || same(p1, p2)
        ? 0
        : ((b - p0[c + 1]) / (p2[0] - p0[0])) * dt
    const m2 =
      !p3 || same(p2, p3) || same(p1, p2)
        ? 0
        : ((p3[c + 1] - a) / (p3[0] - p1[0])) * dt
    const k2 = k * k,
      k3 = k2 * k
    out[c] =
      (2 * k3 - 3 * k2 + 1) * a +
      (k3 - 2 * k2 + k) * m1 +
      (-2 * k3 + 3 * k2) * b +
      (k3 - k2) * m2
  }
  return out
}

// ---------------------------------------------------------------- 仿真
export function createSim(layout) {
  const byId = new Map()
  for (const b of layout.buildings) byId.set(b.id, { x: b.cx, y: b.cy, h: b.h })
  for (const p of layout.points) byId.set(p.id, { x: p.x, y: p.y, h: 0 })
  const pos = (id) => byId.get(id)
  const pm = layout.buildings.find((b) => b.id === "PM-01")
  const PAD_Z = pm.h // 屋顶停机坪（真实高度 m）
  const HG = [pm.cx, pm.cy]
  const SORTIES = buildSorties(HG, PAD_Z, pos)
  const byDrone = (id) =>
    SORTIES.filter((s) => s.drone === id).sort(
      (a, b) => a.pts[0][0] - b.pts[0][0]
    )
  const DRONES = ["UAV-01", "UAV-02", "UAV-03"]
  const SORT_BY = Object.fromEntries(DRONES.map((id) => [id, byDrone(id)]))
  const t0Of = (s) => s.pts[0][0]
  const t1Of = (s) => s.pts.at(-1)[0]
  const activeSortie = (id, t) =>
    SORT_BY[id].find((s) => t >= t0Of(s) && t <= t1Of(s))

  // ---- 设计值（定稿 final.png 的数字），用来校准连续量
  const D = {
    alt: { "UAV-01": 60.9, "UAV-02": 108.5, "UAV-03": 18.5 },
    spd: { "UAV-01": 3.7, "UAV-02": 0.4, "UAV-03": 3.5 },
    rssi58: { "UAV-01": -58, "UAV-02": -54, "UAV-03": -84 },
    rssi24: { "UAV-01": -63, "UAV-02": -59, "UAV-03": -69 },
    lat: { "UAV-01": 21, "UAV-02": 16, "UAV-03": 44 },
    ch01: 36.1,
    ch02: 68.2,
    wind: 2.9,
    temp: 13.6
  }
  /** 校准：返回 fn(t) + (设计值 − fn(DESIGN_T))，使设计时刻读数等于设计值 */
  const calib = (fn, design) => {
    const off = design - fn(DESIGN_T)
    return (t) => fn(t) + off
  }

  // ---- 位姿与任务
  const SEED = { "UAV-01": 1, "UAV-02": 2, "UAV-03": 3 }
  function pose(id, t) {
    const s = activeSortie(id, t)
    if (!s)
      return {
        x: HG[0] + PAD_SLOT[id],
        y: HG[1],
        z: PAD_Z,
        task: 0,
        airborne: false,
        sortie: null
      }
    const [x, y, z] = samplePath(s.pts, t)
    let task = s.pts[0][4]
    for (const p of s.pts) if (p[0] <= t) task = p[4]
    return { x, y, z, task, airborne: true, sortie: s }
  }
  /** 机头朝向（弧度，平面内从 +x 逆时针）：用 3 秒前后的位置差 */
  function heading(id, t) {
    const a = pose(id, t - 0.025),
      b = pose(id, t + 0.025)
    const dx = b.x - a.x,
      dy = b.y - a.y
    return Math.hypot(dx, dy) < 0.05 ? null : Math.atan2(dy, dx)
  }

  /** 电量：起飞后按耗电率降，落地后快速换电；当天 0 点是满电 */
  function battery(id, t) {
    let b = 100
    let last = 0
    for (const s of SORT_BY[id]) {
      const a = t0Of(s),
        e = t1Of(s)
      b = Math.min(100, b + CHARGE * Math.max(0, Math.min(t, a) - last)) // 两次出动之间换电
      if (t < a) return b
      const used = DRAIN[id] * (Math.min(t, e) - a)
      if (t <= e) return Math.max(0, 100 - used)
      b = Math.max(0, 100 - DRAIN[id] * (e - a))
      last = e
    }
    return Math.min(100, b + CHARGE * Math.max(0, t - last))
  }

  // ---- 链路：三号机 18:05 钻进湖东林荫带（BS-04，树冠遮挡），5.8G 衰减，自动切 2.4G 备用，18:10 切回
  const DIP = [hm("18:04"), hm("18:10")]
  const onBackup = (id, t) => id === "UAV-03" && t >= hm("18:05") && t < DIP[1]
  const dipK = (id, t) =>
    id === "UAV-03"
      ? smooth(DIP[0], DIP[0] + 0.5, t) * (1 - smooth(DIP[1] - 0.5, DIP[1], t))
      : 0
  const BASE = {
    rssi58: { "UAV-01": -58, "UAV-02": -54, "UAV-03": -66 },
    rssi24: { "UAV-01": -63, "UAV-02": -59, "UAV-03": -64 },
    lat: { "UAV-01": 21, "UAV-02": 16, "UAV-03": 24 }
  }
  const rssi58 = Object.fromEntries(
    DRONES.map((id) => [
      id,
      calib(
        (t) => BASE.rssi58[id] + dipK(id, t) * -18 + 2.4 * sn(t, SEED[id]),
        D.rssi58[id]
      )
    ])
  )
  const rssi24 = Object.fromEntries(
    DRONES.map((id) => [
      id,
      calib(
        (t) => BASE.rssi24[id] + dipK(id, t) * -6 + 1.6 * sn(t, SEED[id] + 5),
        D.rssi24[id]
      )
    ])
  )
  const lat = Object.fromEntries(
    DRONES.map((id) => [
      id,
      calib(
        (t) => BASE.lat[id] + dipK(id, t) * 20 + 2.2 * sn(t, SEED[id] + 9),
        D.lat[id]
      )
    ])
  )
  // 显示用的高度、地速（位置动画和显示值分开：显示值按任务状态给典型值，设计时刻校准到定稿）
  const SPD_BASE = [0, 4, 9, 3.2, 0.4, 8, 5]
  const altRaw = (id, t) => Math.max(0, pose(id, t).z - PAD_Z)
  const altOff = Object.fromEntries(
    DRONES.map((id) => [id, D.alt[id] - altRaw(id, DESIGN_T)])
  )
  const spdFn = Object.fromEntries(
    DRONES.map((id) => [
      id,
      calib(
        (t) => SPD_BASE[pose(id, t).task] + 0.5 * sn(t, SEED[id] + 3),
        D.spd[id]
      )
    ])
  )

  /** 信号读数：停机坪上取地面值，离地 12 m 内平滑过渡到空中值（图上不会出现起飞瞬间的竖直跳变） */
  const sig = (id, t, fn, ground) => {
    const k = smooth(0, 12, Math.max(0, pose(id, t).z - PAD_Z))
    return lerp(ground, fn(t), k)
  }

  // ---- 事件
  const evAt = (ev, t) => {
    let s = null,
      at = null
    for (const [ts, st] of ev.steps)
      if (hm(ts) <= t) {
        s = st
        at = ts
      }
    return s && { status: s, at }
  }
  function events(t) {
    return EVENTS.map((e) => {
      const cur = evAt(e, t)
      if (!cur) return null
      const f = e.focus ?? [pos(e.zone).x, pos(e.zone).y]
      return {
        id: e.id,
        type: e.type,
        typeText: TYPE_TEXT[e.type],
        title: e.title,
        zone: e.zone,
        by: e.by,
        priority: e.priority ?? "normal",
        created: e.steps[0][0],
        status: cur.status,
        statusText: STATUS_TEXT[cur.status],
        at: cur.at,
        focus: f
      }
    })
      .filter(Boolean)
      .reverse() // 新的在前
  }
  function counts(list) {
    const c = {
      total: list.length,
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
    for (const e of list) {
      c[e.status]++
      c[e.type]++
    }
    c.done = c.closed + c.false
    return c
  }

  // ---- 走失搜寻：盲区核验、目标疑似 → 确认、融合误差
  const BLIND_CHECK = {
    "BS-02": hm("17:56"),
    "BS-01": hm("17:59"),
    "BS-03": hm("18:02"),
    "BS-04": hm("18:04"),
    "BS-05": hm("18:12"),
    "BS-06": hm("18:16")
  }
  const SR_T0 = hm("17:54")
  // 目标：18:04 疑似（可见光被树冠遮挡 + 红外异常热源），18:09 确认；(时刻, 置信度, 误差 m)
  const TARGET = [
    [hm("18:04"), 0.78, 4.2],
    [hm("18:05"), 0.81, 3.1],
    [hm("18:06"), 0.84, 2.4],
    [hm("18:07"), 0.86, 2.0],
    [hm("18:08"), 0.89, 1.7],
    [hm("18:09"), 0.93, 1.2]
  ]
  /** 误差收敛的各个观测时刻（任务卡的小图）：过去的是实测，之后的是预测 */
  const marks = (t) =>
    TARGET.filter((_, i) => [0, 1, 2, 5].includes(i)).map(([ts, , err]) => ({
      clock: clock(ts),
      err,
      past: t >= ts
    }))
  function target(t) {
    if (t < TARGET[0][0]) return { status: 0, conf: 0, err: 0 }
    let i = 0
    while (i < TARGET.length - 2 && t > TARGET[i + 1][0]) i++
    const a = TARGET[i],
      b = TARGET[i + 1]
    const k = clamp((t - a[0]) / (b[0] - a[0]), 0, 1)
    const conf = t >= TARGET.at(-1)[0] ? 0.93 : lerp(a[1], b[1], k)
    const err = t >= TARGET.at(-1)[0] ? 1.2 : lerp(a[2], b[2], k)
    return { status: t >= hm("18:09") ? 2 : 1, conf, err, ...pos("BS-04") }
  }
  const coverage = (t) => (t < SR_T0 ? 0 : Math.min(100, 6.3 * (t - SR_T0)))

  // ---- 充电区红外温度：CH-02 17:46 起升温，18:01 越 60 ℃ 预警线、18:16 越 80 ℃ 告警线；CH-03 的探头 17:20 后失联
  const WARN_T = 60,
    ALARM_T = 80
  const ch02Raw = (t) =>
    t <= hm("17:46")
      ? 41
      : t <= hm("18:01")
        ? 41 + 1.4 * (t - hm("17:46"))
        : 62 + 1.2 * (t - hm("18:01"))
  const ch02 = calib((t) => ch02Raw(t) + 0.3 * sn(t, 11), D.ch02)
  // CH-01 11:30 因为 EV-0406 升温到 62 ℃ 又降下来
  const ch01Raw = (t) =>
    36 +
    26 *
      Math.exp(-(((t - hm("11:30")) / 6) ** 2)) *
      (t < hm("11:30") ? 1 : Math.exp(-(t - hm("11:30")) / 8))
  const ch01 = calib((t) => ch01Raw(t) + 1.0 * sn(t, 12), D.ch01)
  const CH03_LAST = hm("17:20")
  const STALE_MIN = 30

  const env = {
    wind: calib((t) => 2.8 + 0.5 * sn(t, 21), D.wind),
    temp: calib(
      (t) =>
        8 +
        6.5 * Math.sin(((t - 360) / 1440) * Math.PI * 2 * 0.9) +
        0.1 * sn(t, 22),
      D.temp
    )
  }

  // ---- 累计量：从架次表数出来
  const sorties = (t) => SORTIES.filter((s) => t1Of(s) <= t).length
  const flightMin = (t) =>
    SORTIES.reduce((m, s) => m + clamp(t - t0Of(s), 0, t1Of(s) - t0Of(s)), 0)

  // ---- 本次任务（任务卡）：取最近一个出动中的事件，没有就取最近办结的
  const SR_STEPS = [
    ["发现", hm("17:54")],
    ["补盲", hm("18:02")],
    ["核验", hm("18:04")],
    ["定位", hm("18:09")]
  ]
  function mission(t, evList) {
    // 事件对应的出动窗口：架次组里同类型事件的并集
    const windows = EVENTS.map((e) => {
      const ss = SORTIES.filter(
        (s) => s.event === e.type && Math.abs(t0Of(s) - hm(e.steps[0][0])) < 12
      )
      return ss.length
        ? { e, a: Math.min(...ss.map(t0Of)), b: Math.max(...ss.map(t1Of)) }
        : null
    }).filter(Boolean)
    const live = windows.find((w) => t >= w.a && t <= w.b)
    const pick = live ?? windows.filter((w) => w.b < t).at(-1) ?? windows[0]
    const e = pick.e
    const cur = evList.find((x) => x.id === e.id)
    const isSR = e.type === "SR"
    const steps = (
      isSR
        ? SR_STEPS
        : [
            ["发现", pick.a + 1],
            ["核验", pick.a + 3],
            ["派单", hm(e.steps[1]?.[0] ?? e.steps[0][0])],
            ["复核", pick.b - 1]
          ]
    ).map(([name, ts], i, arr) => {
      const done = t >= (arr[i + 1]?.[1] ?? Infinity)
      const now = t >= ts && !done
      return {
        name,
        state:
          !live && t > pick.b ? "done" : done ? "done" : now ? "now" : "todo"
      }
    })
    const elapsed = clamp(t - hm(e.steps[0][0]), 0, 999)
    return {
      id: e.id,
      type: e.type,
      title: e.title,
      urgent: e.priority === "urgent",
      live: !!live,
      startedAt: e.steps[0][0],
      elapsedMin: Math.floor(elapsed),
      status: cur?.status ?? null,
      steps,
      isSR,
      // 非走失类任务的识别置信度和融合误差：由事件编号哈出一个固定值（置信度 ≥ 0.7 阈值，误差 ≤ ±1.5 m）
      kpi: {
        conf: 0.86 + (hash(e.id) % 9) / 100,
        err: 0.9 + (hash(e.id) % 6) / 10
      },
      sub: isSR
        ? "78 岁，灰色外套 · 17:52 家属报警"
        : `${TYPE_TEXT[e.type]} · ${e.zone} · ${e.steps[0][0]} 发现`,
      focus: e.focus ?? [pos(e.zone).x, pos(e.zone).y]
    }
  }

  /** 事件的时间轴上的小标记（底栏用）：只要创建时刻和当前状态 */
  const stages = (t) => ({
    sr: SR_STEPS.map(([n, ts]) => ({ name: n, at: ts })),
    blindChecks: Object.entries(BLIND_CHECK).map(([id, ts]) => ({
      id,
      at: ts,
      checked: t >= ts
    }))
  })

  // ---- 系统日志（链路切换、低电量补位）：给面板上的提示和滚动条用
  const SYS_LOG = [
    {
      at: hm("18:04"),
      text: "UAV-03 进入 BS-04 湖东林荫带，树冠遮挡使 5.8G 信号衰减到 −84 dBm"
    },
    {
      at: hm("18:05"),
      text: "UAV-03 自动切换 2.4G 备用链路，经二号机中继，延迟 44 ms"
    },
    { at: hm("18:09"), text: "目标确认：融合定位误差 1.2 m，推送给保安与家属" },
    { at: hm("18:10"), text: "UAV-03 链路恢复 5.8G" },
    { at: hm("18:17"), text: "UAV-03 电量 23 %，低于 25 % 补位线" },
    { at: hm("18:19"), text: "UAV-03 自动返航，一号机补位盲区核验" }
  ]

  /**
   * 关注点：无人机视角窗盯的地方。有走失目标就是它；否则取"在飞无人机 70 m 以内的、未办结的事件"。
   * 返回 {kind, x, y, label（可见光识别框的字）, irLabel（红外框的字）, note}，没有就是 null。
   */
  function focusOf(t, evs, drones, th) {
    const tg = target(t)
    if (tg.status > 0)
      return {
        kind: "SR",
        x: tg.x,
        y: tg.y,
        label: `${tg.status === 2 ? "确认" : "疑似"} ${tg.conf.toFixed(2)}`,
        irLabel: "热源 36.8 ℃",
        note: "人体热源 · 非猫狗"
      }
    const fly = drones.filter((d) => d.airborne)
    for (const e of evs) {
      if (
        !["pending", "dispatched", "processing"].includes(e.status) ||
        !["PT", "TH", "FP", "FC"].includes(e.type)
      )
        continue
      const p = { x: e.focus[0], y: e.focus[1] }
      if (!fly.some((d) => Math.hypot(d.x - p.x, d.y - p.y) < 70)) continue
      const conf = (0.86 + (hash(e.id) % 9) / 100).toFixed(2)
      if (e.type === "PT")
        return {
          kind: "PT",
          ...p,
          label: `人员 ${conf}`,
          irLabel: "热源 36.5 ℃",
          note: "人体热源 · 非猫狗"
        }
      if (e.type === "TH")
        return {
          kind: "TH",
          ...p,
          label: "充电柜",
          irLabel: `热源 ${th[e.zone]?.temp.toFixed(1) ?? "—"} ℃`,
          note: "电池温升"
        }
      if (e.type === "FP")
        return {
          kind: "FP",
          ...p,
          label: `车辆 ${conf}`,
          irLabel: "引擎余热 38 ℃",
          note: "占用消防通道"
        }
      return {
        kind: "FC",
        ...p,
        label: `空鼓 ${conf}`,
        irLabel: "渗水冷区 9.5 ℃",
        note: "外立面巡检"
      }
    }
    return null
  }

  /**
   * 整份快照
   * drones[]：{id, name, role, x, y, z（真实高度 m）, heading, airborne, task, taskText, batt, alt（离屋顶 m）, spd, link,
   *           linkText, rssi58, rssi24, lat, q（5.8G 读数质量）}
   * events[] / counts / doneRate；blind{total, checked, rate, zones[]}；target{status, conf, err, x, y}；
   * coverage；sorties；flightMin；thermal{CH-01.., q, verifiedAt, level}；env；mission；sysLog；links（链路拓扑）
   */
  function at(t) {
    const evs = events(t)
    const c = counts(evs)
    const drones = DRONES.map((id) => {
      const p = pose(id, t)
      const backup = onBackup(id, t)
      const alt = p.airborne
        ? Math.max(0, altRaw(id, t) + altOff[id] * (p.airborne ? 1 : 0))
        : 0
      return {
        id,
        name: {
          "UAV-01": "一号机 · 主侦查机",
          "UAV-02": "二号机 · 中继通信机",
          "UAV-03": "三号机 · 补盲探查机"
        }[id],
        role: ROLE[id],
        x: p.x,
        y: p.y,
        z: p.z,
        heading: heading(id, t),
        airborne: p.airborne,
        task: p.task,
        taskText: TASK_TEXT[p.task],
        batt: battery(id, t),
        alt: p.airborne ? alt : 0,
        spd: p.airborne ? Math.max(0, spdFn[id](t)) : 0,
        link: backup ? 1 : 0,
        linkText: backup ? "2.4G 备用" : "5.8G 主链路",
        rssi58: sig(id, t, rssi58[id], -60),
        rssi24: sig(id, t, rssi24[id], -62),
        lat: sig(id, t, lat[id], 20),
        q58:
          id === "UAV-03" && t >= hm("18:04") && t < hm("18:06")
            ? "uncertain"
            : "good"
      }
    })
    const checked = Object.values(BLIND_CHECK).filter((ts) => t >= ts).length
    const ch03Age = t - CH03_LAST
    const level = (v) => (v >= ALARM_T ? "alarm" : v >= WARN_T ? "warn" : "ok")
    const th = {
      "CH-01": { temp: ch01(t), q: "good", verifiedAt: clock(t) },
      "CH-02": { temp: ch02(t), q: "good", verifiedAt: clock(t) },
      "CH-03": {
        temp: 35,
        q: t >= CH03_LAST && ch03Age > STALE_MIN ? "uncertain" : "good",
        verifiedAt: t >= CH03_LAST ? clock(CH03_LAST) : clock(t)
      }
    }
    for (const k of Object.keys(th))
      th[k].level = th[k].q === "good" ? level(th[k].temp) : "stale"
    const links = []
    const relay = drones[1]
    if (relay.airborne) {
      for (const d of [drones[0], drones[2]])
        if (d.airborne)
          links.push({
            from: "UAV-02",
            to: d.id,
            band: d.link ? "2.4G" : "5.8G"
          })
    }
    const ms = mission(t, evs)
    const focus = focusOf(t, evs, drones, th)
    return {
      t,
      clock: clock(t),
      clockSec: clockSec(t),
      // 走失搜寻在进行（或刚结束）时才显示盲区标注，其余时段沙盘上不画
      focus,
      search: { active: coverage(t) > 0 || (ms.isSR && ms.live) },
      drones,
      events: evs,
      counts: c,
      doneRate: c.total ? c.done / c.total : 0,
      blind: {
        total: layout.totals.blindZones,
        checked,
        rate: checked / layout.totals.blindZones,
        zones: Object.entries(BLIND_CHECK).map(([id, ts]) => ({
          id,
          checked: t >= ts,
          at: clock(ts)
        }))
      },
      target: { ...target(t), marks: marks(t) },
      coverage: coverage(t),
      sorties: sorties(t),
      flightMin: flightMin(t),
      thermal: th,
      env: { wind: env.wind(t), temp: env.temp(t) },
      mission: ms,
      sysLog: SYS_LOG.filter((l) => l.at <= t)
        .map((l) => ({ ...l, clock: clock(l.at) }))
        .reverse(),
      links,
      stages: stages(t)
    }
  }

  /** 图表序列：n 个等间隔采样，id 形如 "UAV-01.batt"、"UAV-03.rssi58"、"UAV-03.rssi24"、"CH-02.temp" */
  function series(id, t0, t1, n) {
    const [k, f] = id.split(".")
    return Array.from({ length: n }, (_, i) => {
      const t = lerp(t0, t1, i / (n - 1))
      if (f === "batt") return battery(k, t)
      if (f === "rssi58") return sig(k, t, rssi58[k], -60)
      if (f === "rssi24") return sig(k, t, rssi24[k], -62)
      if (f === "temp")
        return k === "CH-02" ? ch02(t) : k === "CH-01" ? ch01(t) : 35
      if (f === "err") return target(t).err
      return 0
    })
  }

  /** 某架机最近 back 分钟的航迹（n 个点，从旧到新），只算位姿，每帧调用也便宜；落地的时段停在机库 */
  function trail(id, t, back, n) {
    return Array.from({ length: n }, (_, i) => {
      const p = pose(id, t - back * (1 - i / (n - 1)))
      return [p.x, p.y, p.z, p.airborne]
    })
  }

  return {
    at,
    series,
    trail,
    pos,
    sortiesList: SORTIES,
    padZ: PAD_Z,
    hangar: HG,
    thresholds: { warn: WARN_T, alarm: ALARM_T, lowBatt: 25 }
  }
}

/** 五个剧情（点底部导览条跳过去）：开始时刻、播放多少分钟、镜头看哪里（平面点和距离倍数） */
export const STORIES = [
  {
    key: "SR",
    name: "走失搜寻",
    t: "17:55",
    dur: 16,
    text: "家属报警后，一号机扫全区，三号机逐个补扫盲区，BS-04 湖东林荫带里发现疑似目标，三号机抵近核验。"
  },
  {
    key: "PT",
    name: "周界入侵",
    t: "02:10",
    dur: 14,
    text: "夜间沿围墙红外巡航，发现翻越围墙的热源，可见光核验后锁定并追踪，保安到场。"
  },
  {
    key: "TH",
    name: "热源异常",
    t: "11:28",
    dur: 16,
    text: "充电区 CH-01 红外测温偏高，一号机悬停复测，派单后现场处置办结。"
  },
  {
    key: "FP",
    name: "消防通道",
    t: "06:28",
    dur: 12,
    text: "清晨巡检消防环路北段，识别占用车辆并定位，车牌自动打码，生成工单。"
  },
  {
    key: "FC",
    name: "外立面",
    t: "09:08",
    dur: 18,
    text: "三号机抵近 B03 外立面，红外和激光测距发现空鼓，二号机中继，一号机在高处配合。"
  }
]

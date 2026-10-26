/**
 * 带式输送机孪生：矿井布局与设备编号（唯一来源）
 * ----------------------------------------------------------
 * 矿井是虚构的「青岚煤矿」（年产 800 万 t 的井工矿），主煤流参数参考科瑞森公开案例（docs/design/smart-conveyor/02-research.md）。
 * 本脚本是全部对象编号、皮带参数和平面位置的唯一来源，输出：
 *   - src/views/smart-conveyor/data/layout.json   页面、仿真器、三维场景用（生成文件，不要手改）
 *   - docs/design/smart-conveyor/devices.json      设备清单（编号即三维模型节点名）
 *
 * 坐标：x 向东、y 向北、z 为标高（m）。原点在主斜井井口，井口地面标高 +1200 m。
 * 里程（chainage）：沿皮带从机尾（受料端，0）量到机头（卸载端，L），单位 m。
 * 煤流方向：机尾 → 机头。皮带编号沿逆煤流方向排（BC01 最下游），一键启动时 BC01 先起。
 *
 * 用法：node scripts/smart-conveyor/layout.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const OUT_PAGE = join(ROOT, "src", "views", "smart-conveyor", "data")
const OUT_DOC = join(ROOT, "docs", "design", "smart-conveyor")

/* ---------------- 几何工具 ---------------- */

/** 折线总长与各段累计长度 */
function measure(path) {
  const cum = [0]
  for (let i = 1; i < path.length; i++) {
    const [ax, ay, az] = path[i - 1]
    const [bx, by, bz] = path[i]
    cum.push(cum[i - 1] + Math.hypot(bx - ax, by - ay, bz - az))
  }
  return cum
}

/**
 * 按里程取折线上的点，并沿水平法向偏移 side 米（正值 = 面向煤流方向的右侧）
 * 返回保留 1 位小数的 [x, y, z]
 */
function pointAt(path, cum, s, side = 0, up = 0) {
  const L = cum[cum.length - 1]
  const t = Math.min(Math.max(s, 0), L)
  let i = 1
  while (i < cum.length - 1 && cum[i] < t) i++
  const [ax, ay, az] = path[i - 1]
  const [bx, by, bz] = path[i]
  const seg = cum[i] - cum[i - 1] || 1
  const k = (t - cum[i - 1]) / seg
  const dx = bx - ax
  const dy = by - ay
  const h = Math.hypot(dx, dy) || 1
  // 面向前进方向的右手法向：(dy, -dx)
  const nx = dy / h
  const ny = -dx / h
  const r1 = (v) => Math.round(v * 10) / 10
  return [
    r1(ax + dx * k + nx * side),
    r1(ay + dy * k + ny * side),
    r1(az + (bz - az) * k + up)
  ]
}

/* ---------------- 矿井概况 ---------------- */

const MINE = {
  name: "青岚煤矿",
  fictional: true,
  capacityMt: 8.0, // 设计生产能力，Mt/a
  workDays: 330,
  // 三八制：0–8 检修班，8–16 早班生产，16–24 中班生产（假设，见 02 调研）
  shifts: [
    { id: "night", name: "零点班", start: 0, end: 8, kind: "maint" },
    { id: "day", name: "八点班", start: 8, end: 16, kind: "prod" },
    { id: "eve", name: "四点班", start: 16, end: 24, kind: "prod" }
  ],
  surfaceZ: 1200,
  seam: { name: "3 号煤", thickness: 4.5, density: 1.35 },
  safeSince: "2023-03-18" // 安全生产起算日（演示）
}

/* ---------------- 皮带 ---------------- */

/**
 * 皮带参数（演示取值，参考科瑞森案例和常见设计）：
 *   B 带宽 mm、v 额定带速 m/s、vMin 变频最低带速、Q 额定运量 t/h、belt 输送带型号
 *   drives 驱动电机（kW、kV），全部变频；m0 每米运动部件质量（上下输送带 + 托辊转动部分）kg/m
 *   f 模拟摩擦系数；carry / ret 承载 / 回程托辊组间距 m
 *   loads 受料点：from 来料对象、at 里程；to 卸载去向
 */
const BELTS = [
  {
    id: "BC01",
    name: "地面栈桥带式输送机",
    short: "地面栈桥",
    area: "surface",
    B: 1600,
    v: 4.0,
    vMin: 1.2,
    Q: 3000,
    belt: "ST1600 钢丝绳芯",
    steelCord: true,
    drives: [
      { kW: 400, kV: 10 },
      { kW: 400, kV: 10 }
    ],
    m0: 180,
    f: 0.028,
    carry: 1.2,
    ret: 3.0,
    takeUp: "重锤拉紧",
    path: [
      [0, 18, 1196],
      [178, 224, 1244]
    ],
    loads: [{ from: "BC02", at: 4 }],
    to: "MC03",
    roadway: { kind: "gallery", name: "地面栈桥", w: 7, h: 4 }
  },
  {
    id: "BC02",
    name: "主斜井带式输送机",
    short: "主斜井",
    area: "incline",
    B: 1600,
    v: 5.0,
    vMin: 1.5,
    Q: 3000,
    belt: "ST4500 钢丝绳芯",
    steelCord: true,
    drives: [
      { kW: 1400, kV: 10 },
      { kW: 1400, kV: 10 },
      { kW: 1400, kV: 10 },
      { kW: 1400, kV: 10 }
    ],
    m0: 210,
    f: 0.025,
    carry: 1.2,
    ret: 3.0,
    takeUp: "液压自动拉紧",
    brake: "盘式可控制动",
    backstop: true,
    path: [
      [0, -1466, 813],
      [0, 0, 1200],
      [0, 22, 1203]
    ],
    loads: [
      { from: "GM03", at: 10 },
      { from: "GM04", at: 18 }
    ],
    to: "BC01",
    roadway: { kind: "incline", name: "主斜井", w: 5.2, h: 4.2 }
  },
  {
    id: "BC03",
    name: "主运输大巷带式输送机",
    short: "主运输大巷",
    area: "main",
    B: 1600,
    v: 4.5,
    vMin: 1.2,
    Q: 3000,
    belt: "ST2500 钢丝绳芯",
    steelCord: true,
    curve: "平面转弯 R1500 m（长距离曲线输送机）",
    drives: [
      { kW: 630, kV: 3.3 },
      { kW: 630, kV: 3.3 },
      { kW: 630, kV: 3.3 }
    ],
    m0: 170,
    f: 0.025,
    carry: 1.2,
    ret: 3.0,
    takeUp: "液压自动拉紧",
    path: [
      [-2876, -1700, 851],
      [-1650, -1700, 855],
      [-1330, -1680, 856],
      [-1030, -1610, 857],
      [-760, -1530, 858],
      [-420, -1470, 859],
      [-8, -1452, 861]
    ],
    loads: [
      { from: "GM01", at: 10 },
      { from: "GM02", at: 18 }
    ],
    to: "MC02",
    roadway: { kind: "main", name: "主运输大巷", w: 5.4, h: 4.3 }
  },
  {
    id: "BC04",
    name: "一采区运输上山带式输送机（下运）",
    short: "一采区运输上山",
    area: "district",
    downhill: true,
    B: 1400,
    v: 4.0,
    vMin: 1.2,
    Q: 2500,
    belt: "ST2000 钢丝绳芯",
    steelCord: true,
    drives: [
      { kW: 560, kV: 3.3 },
      { kW: 560, kV: 3.3 },
      { kW: 560, kV: 3.3 }
    ],
    m0: 150,
    f: 0.025,
    carry: 1.2,
    ret: 3.0,
    takeUp: "液压自动拉紧",
    brake: "液压软制动 + 防超速",
    path: [
      [-3005, -4, 1101],
      [-2972, -420, 1048],
      [-2862, -1696, 887]
    ],
    loads: [
      { from: "BC05", at: 6 },
      { from: "BC06", at: 420 }
    ],
    to: "MC01",
    roadway: { kind: "district", name: "一采区运输上山", w: 5.0, h: 3.9 }
  },
  {
    id: "BC05",
    name: "12301 运输顺槽可伸缩带式输送机",
    short: "12301 运输顺槽",
    area: "gate",
    telescopic: { storage: 100, lMax: 3200, advance: 12.8 },
    B: 1400,
    v: 4.0,
    vMin: 1.0,
    Q: 2500,
    belt: "PVG 2500S 整芯阻燃",
    steelCord: false,
    drives: [
      { kW: 400, kV: 1.14 },
      { kW: 400, kV: 1.14 },
      { kW: 400, kV: 1.14 }
    ],
    m0: 135,
    f: 0.027,
    carry: 1.5,
    ret: 3.0,
    takeUp: "储带仓 + 自动张紧绞车",
    path: [
      [-5378, 44, 1118],
      [-3015, 18, 1104]
    ],
    loads: [{ from: "WF12301", at: 4 }],
    to: "BC04",
    roadway: { kind: "gate", name: "12301 运输顺槽", w: 5.4, h: 3.7 }
  },
  {
    id: "BC06",
    name: "12305 掘进顺槽带式输送机",
    short: "12305 掘进顺槽",
    area: "gate",
    telescopic: { storage: 50, lMax: 2400, advance: -14 },
    B: 1000,
    v: 2.5,
    vMin: 0.8,
    Q: 400,
    belt: "PVG 1000S 整芯阻燃",
    steelCord: false,
    drives: [
      { kW: 75, kV: 1.14 },
      { kW: 75, kV: 1.14 }
    ],
    m0: 60,
    f: 0.03,
    carry: 1.5,
    ret: 3.0,
    takeUp: "自动张紧绞车",
    path: [
      [-3828, -405, 1061],
      [-2978, -414, 1050]
    ],
    loads: [{ from: "WF12305", at: 4 }],
    to: "BC04",
    roadway: {
      kind: "devGate",
      name: "12305 运输顺槽（掘进中）",
      w: 4.8,
      h: 3.4
    }
  }
]

/* ---------------- 煤仓、给煤机、工作面 ---------------- */

const BUNKERS = [
  {
    id: "MC01",
    name: "一采区煤仓",
    d: 8,
    h: 30,
    cap: 1500,
    at: [-2862, -1700],
    zBottom: 856,
    feeders: ["GM01", "GM02"],
    from: "BC04",
    to: "BC03"
  },
  {
    id: "MC02",
    name: "井底煤仓",
    d: 10,
    h: 35,
    cap: 2500,
    at: [0, -1452],
    zBottom: 822,
    feeders: ["GM03", "GM04"],
    from: "BC03",
    to: "BC02"
  },
  {
    id: "MC03",
    name: "地面原煤仓",
    d: 22,
    h: 42,
    cap: 12000,
    at: [188, 234],
    zBottom: 1202,
    feeders: [],
    from: "BC01",
    to: "选煤厂"
  }
]

const FEEDERS = [
  {
    id: "GM01",
    name: "1 号甲带给煤机",
    bunker: "MC01",
    belt: "BC03",
    at: 10,
    qMax: 1600
  },
  {
    id: "GM02",
    name: "2 号甲带给煤机",
    bunker: "MC01",
    belt: "BC03",
    at: 18,
    qMax: 1600
  },
  {
    id: "GM03",
    name: "3 号甲带给煤机",
    bunker: "MC02",
    belt: "BC02",
    at: 10,
    qMax: 1800
  },
  {
    id: "GM04",
    name: "4 号甲带给煤机",
    bunker: "MC02",
    belt: "BC02",
    at: 18,
    qMax: 1800
  }
]

/**
 * 工作面（煤源）。综采面推进时运输顺槽皮带缩短；掘进面推进时掘进皮带延长。
 * x 为当前（参考日）工作面位置，仿真器按日期推算。
 */
const FACES = [
  {
    id: "WF12301",
    name: "12301 综采工作面",
    kind: "longwall",
    belt: "BC05",
    faceLength: 300,
    x: -5408,
    y0: 40,
    y1: 340,
    z: 1120,
    setupX: -5985, // 开切眼位置（采空区西界）
    stopX: -3260, // 停采线
    cut: 0.8, // 截深 m
    height: 4.5,
    supports: 175,
    equipment: ["采煤机", "刮板输送机", "转载机", "破碎机", "液压支架 175 架"],
    peak: 2400 // 割煤时的峰值产能 t/h
  },
  {
    id: "WF12305",
    name: "12305 掘进工作面",
    kind: "development",
    belt: "BC06",
    x: -3832,
    y: -405,
    z: 1061,
    equipment: ["掘锚一体机", "桥式转载机"],
    peak: 380
  }
]

/* ---------------- 巷道（三维场景的上下文，不承载皮带的巷道也列出） ---------------- */

const EXTRA_ROADWAYS = [
  {
    id: "RW-FX",
    name: "副斜井",
    kind: "incline",
    w: 5.0,
    h: 4.0,
    path: [
      [60, -1440, 820],
      [60, 0, 1200]
    ]
  },
  {
    id: "RW-FY",
    name: "辅助运输大巷",
    kind: "main",
    w: 5.4,
    h: 4.3,
    path: [
      [-2830, -1645, 851],
      [-1650, -1645, 855],
      [-1300, -1620, 856],
      [-760, -1470, 858],
      [-420, -1420, 859],
      [60, -1440, 820]
    ]
  },
  {
    id: "RW-HF",
    name: "回风大巷",
    kind: "main",
    w: 5.0,
    h: 4.0,
    path: [
      [-2830, -1765, 849],
      [-1650, -1765, 853],
      [-760, -1590, 856],
      [-300, -1540, 858],
      [140, -1520, 860],
      [140, -40, 1200]
    ]
  },
  {
    id: "RW-12301H",
    name: "12301 回风顺槽",
    kind: "gate",
    w: 5.0,
    h: 3.6,
    path: [
      [-5408, 340, 1121],
      [-3080, 330, 1106],
      [-3080, 60, 1104]
    ]
  },
  {
    id: "RW-FS",
    name: "一采区轨道上山",
    kind: "district",
    w: 5.0,
    h: 3.9,
    path: [
      [-3065, -4, 1101],
      [-3032, -420, 1048],
      [-2922, -1645, 887]
    ]
  },
  {
    id: "RW-12305H",
    name: "12305 回风顺槽（掘进中）",
    kind: "devGate",
    w: 4.6,
    h: 3.3,
    path: [
      [-3780, -205, 1063],
      [-3040, -214, 1052]
    ]
  }
]

/* ---------------- 设备生成 ---------------- */

const devices = []
/** 往设备清单里加一条；pos 由所在皮带里程换算 */
function add(d) {
  if (devices.some((x) => x.id === d.id)) throw new Error("编号重复：" + d.id)
  devices.push({ node: d.id, ...d })
}

const pad = (n, w = 2) => String(n).padStart(w, "0")

for (const b of BELTS) {
  const cum = measure(b.path)
  const L = cum[cum.length - 1]
  b.L = Math.round(L * 10) / 10
  const z0 = b.path[0][2]
  const z1 = b.path[b.path.length - 1][2]
  b.lift = Math.round((z1 - z0) * 10) / 10
  b.angle = Math.round(((Math.asin((z1 - z0) / L) * 180) / Math.PI) * 100) / 100
  b.power = b.drives.reduce((s, d) => s + d.kW, 0)
  b.carryCount = Math.floor(L / b.carry)
  b.returnCount = Math.floor(L / b.ret)
  const at = (s, side = 0, up = 0) => pointAt(b.path, cum, s, side, up)
  const base = { belt: b.id }

  add({ id: b.id, name: b.name, kind: "belt", ...base, chainage: [0, b.L] })

  // 驱动部：电机、减速机、变频器挂在传动滚筒上；三驱 = DP1 双驱 + DP2 单驱
  // 驱动分配：四驱 = DP1、DP2 各两台；三驱 = DP1 两台 + DP2 一台；两驱 = 各一台
  const dp =
    b.drives.length === 4
      ? ["DP1", "DP1", "DP2", "DP2"]
      : b.drives.length === 3
        ? ["DP1", "DP1", "DP2"]
        : ["DP1", "DP2"]
  const dpS = { DP1: L - 6, DP2: L - 12 }
  b.drives.forEach((d, i) => {
    const n = i + 1
    const side = i % 2 === 0 ? 4.5 : -4.5
    const s = dpS[dp[i]]
    d.id = `${b.id}-M${n}`
    d.pulley = `${b.id}-${dp[i]}`
    add({
      id: `${b.id}-M${n}`,
      name: `${b.short} ${n} 号电机`,
      kind: "motor",
      ...base,
      kW: d.kW,
      kV: d.kV,
      chainage: s,
      pos: at(s, side * 1.6)
    })
    add({
      id: `${b.id}-R${n}`,
      name: `${b.short} ${n} 号减速机`,
      kind: "reducer",
      ...base,
      chainage: s,
      pos: at(s, side)
    })
    add({
      id: `${b.id}-VF${n}`,
      name: `${b.short} ${n} 号变频器`,
      kind: "vfd",
      ...base,
      chainage: L - 30,
      pos: at(L - 30, 6 + i * 1.2)
    })
  })
  add({
    id: `${b.id}-DP1`,
    name: `${b.short} 1 号传动滚筒`,
    kind: "drivePulley",
    ...base,
    chainage: dpS.DP1,
    pos: at(dpS.DP1)
  })
  add({
    id: `${b.id}-DP2`,
    name: `${b.short} 2 号传动滚筒`,
    kind: "drivePulley",
    ...base,
    chainage: dpS.DP2,
    pos: at(dpS.DP2)
  })
  add({
    id: `${b.id}-HP`,
    name: `${b.short} 机头卸载滚筒`,
    kind: "headPulley",
    ...base,
    chainage: L,
    pos: at(L)
  })
  add({
    id: `${b.id}-TP`,
    name: `${b.short} 机尾滚筒`,
    kind: "tailPulley",
    ...base,
    chainage: 0,
    pos: at(0)
  })
  add({
    id: `${b.id}-BP1`,
    name: `${b.short} 1 号改向滚筒`,
    kind: "bendPulley",
    ...base,
    chainage: L - 16,
    pos: at(L - 16)
  })
  const tuS = b.telescopic ? L - 60 : L - 40
  add({
    id: `${b.id}-TU`,
    name: `${b.short} ${b.takeUp}`,
    kind: "takeUp",
    ...base,
    chainage: tuS,
    pos: at(tuS)
  })
  if (b.brake)
    add({
      id: `${b.id}-BK`,
      name: `${b.short} ${b.brake}`,
      kind: "brake",
      ...base,
      chainage: L - 9,
      pos: at(L - 9, 3)
    })
  if (b.backstop)
    add({
      id: `${b.id}-BS`,
      name: `${b.short} 逆止器`,
      kind: "backstop",
      ...base,
      chainage: dpS.DP1,
      pos: at(dpS.DP1, -3)
    })
  if (b.telescopic)
    add({
      id: `${b.id}-ST`,
      name: `${b.short} 储带仓`,
      kind: "storage",
      ...base,
      chainage: L - 70,
      pos: at(L - 70)
    })

  // 八大保护（集控侧）：跑偏成对、急停每 100 m、烟雾、超温洒水、张力、速度（打滑）、堆煤、撕裂
  const px = [12, ...range(300, L - 30, 300), L - 25]
  px.forEach((s, i) =>
    add({
      id: `${b.id}-PX${pad(i + 1)}`,
      name: `${b.short} 跑偏保护 ${i + 1}`,
      kind: "protDeviation",
      ...base,
      chainage: Math.round(s),
      pos: at(s, 1.2)
    })
  )
  const es = range(50, L, 100)
  es.forEach((s, i) =>
    add({
      id: `${b.id}-ES${pad(i + 1, 3)}`,
      name: `${b.short} 沿线急停 ${i + 1}`,
      kind: "protEstop",
      ...base,
      chainage: Math.round(s),
      pos: at(s, -1.4, 1.2)
    })
  )
  add({
    id: `${b.id}-SM`,
    name: `${b.short} 烟雾保护`,
    kind: "protSmoke",
    ...base,
    chainage: Math.round(L - 20),
    pos: at(L - 20, 0, 3)
  })
  add({
    id: `${b.id}-TS`,
    name: `${b.short} 超温洒水保护`,
    kind: "protTemp",
    ...base,
    chainage: Math.round(dpS.DP1),
    pos: at(dpS.DP1, 0, 2.2)
  })
  add({
    id: `${b.id}-TN`,
    name: `${b.short} 张力下降保护`,
    kind: "protTension",
    ...base,
    chainage: Math.round(tuS),
    pos: at(tuS, 1)
  })
  add({
    id: `${b.id}-SL`,
    name: `${b.short} 速度（打滑）保护`,
    kind: "protSlip",
    ...base,
    chainage: 2,
    pos: at(2, 1)
  })
  add({
    id: `${b.id}-DM`,
    name: `${b.short} 堆煤保护`,
    kind: "protPile",
    ...base,
    chainage: Math.round(L - 1),
    pos: at(L - 1, 0, 2)
  })
  add({
    id: `${b.id}-TR`,
    name: `${b.short} 撕裂保护`,
    kind: "protTear",
    ...base,
    chainage: 30,
    pos: at(30, 0, -0.6)
  })

  // 晨帆检测（平台侧）
  b.loads.forEach((ld, i) => {
    const s = ld.at + 14
    add({
      id: `${b.id}-LT${i + 1}`,
      name: `${b.short} 激光纵撕检测 ${i + 1}`,
      kind: "tearLaser",
      ...base,
      chainage: s,
      pos: at(s, 0, -0.8)
    })
  })
  if (b.id === "BC02" || b.id === "BC03") {
    const s = L - 120
    add({
      id: `${b.id}-XR`,
      name: `${b.short} X 光钢丝绳芯检测`,
      kind: "xray",
      ...base,
      chainage: Math.round(s),
      pos: at(s, 0, -0.9)
    })
  }
  // AI 摄像机：机头（堵料 / 人员越界）、机尾（异物 / 大块）、沿线（跑偏 / 撕边），每 400 m 一台
  const cams = [
    { s: L - 8, use: "堵料 · 人员越界", type: "透尘摄像机" },
    { s: 26, use: "异物 · 大块 · 料流", type: "自清洁摄像机" },
    ...range(400, L - 100, 400).map((s) => ({
      s,
      use: "跑偏 · 撕边",
      type: "抗振防抖摄像机"
    }))
  ]
  cams.forEach((c, i) =>
    add({
      id: `${b.id}-CAM${pad(i + 1)}`,
      name: `${b.short} 摄像机 ${i + 1}（${c.use}）`,
      kind: "camera",
      use: c.use,
      model: c.type,
      ...base,
      chainage: Math.round(c.s),
      pos: at(c.s, -1.8, 2.6)
    })
  )
  // 红外热像仪：驱动部、机头卸料（物料超温，联动喷淋）
  add({
    id: `${b.id}-IR1`,
    name: `${b.short} 驱动部热像仪`,
    kind: "thermal",
    ...base,
    chainage: Math.round(dpS.DP2),
    pos: at(dpS.DP2, -6, 3)
  })
  add({
    id: `${b.id}-IR2`,
    name: `${b.short} 机头物料热像仪`,
    kind: "thermal",
    ...base,
    chainage: Math.round(L - 4),
    pos: at(L - 4, 2, 3)
  })
  add({
    id: `${b.id}-SPR`,
    name: `${b.short} 机头喷淋`,
    kind: "sprinkler",
    ...base,
    chainage: Math.round(L - 3),
    pos: at(L - 3, 0, 2.4)
  })
  // 料流检测：主皮带用双目视觉，短皮带用毫米波雷达；皮带秤只装在主斜井（产量计量）和地面栈桥（核对）
  const flowS = Math.max(...b.loads.map((l) => l.at)) + 30
  add({
    id: `${b.id}-FL`,
    name: `${b.short} ${b.B >= 1400 ? "双目视觉料流检测" : "毫米波雷达料流检测"}`,
    kind: "flowMeter",
    ...base,
    chainage: Math.round(flowS),
    pos: at(flowS, 0, 2.2)
  })
  if (b.id === "BC01" || b.id === "BC02") {
    const s = b.id === "BC02" ? L - 60 : 80
    add({
      id: `${b.id}-SC`,
      name: `${b.short} 电子皮带秤`,
      kind: "beltScale",
      ...base,
      chainage: Math.round(s),
      pos: at(s, 0, -0.5)
    })
  }
  // 托辊温速传感器（无线）：只装在三条主力皮带上，均匀布点，左 / 右辊交替
  const isStep = { BC02: 62, BC03: 95, BC04: 85 }[b.id]
  if (isStep) {
    range(40, L - 40, isStep).forEach((s, i) => {
      const set = Math.round(s / b.carry)
      const roll = i % 2 === 0 ? "L" : "R"
      add({
        id: `${b.id}-IS${pad(i + 1)}`,
        name: `${b.short} 托辊温速 ${i + 1}（第 ${set} 组${roll === "L" ? "左" : "右"}辊）`,
        kind: "idlerSensor",
        ...base,
        set,
        roll,
        chainage: Math.round(set * b.carry * 10) / 10,
        pos: at(set * b.carry, roll === "L" ? -0.7 : 0.7)
      })
    })
  }
  // 分布式光纤：测温 DTS（四条井下主力皮带）、听诊 DAS（主斜井、大巷）
  if (["BC02", "BC03", "BC04", "BC05"].includes(b.id))
    add({
      id: `${b.id}-DTS`,
      name: `${b.short} 分布式光纤测温`,
      kind: "dts",
      ...base,
      chainage: [0, b.L],
      resolution: 1
    })
  if (["BC02", "BC03"].includes(b.id))
    add({
      id: `${b.id}-DAS`,
      name: `${b.short} 光纤听诊`,
      kind: "das",
      ...base,
      chainage: [0, b.L],
      pitch: 6
    })
  // 环境监测站：机头、机尾，沿线约每 900 m 一处
  const envS = [L - 15, ...range(900, L - 300, 900), 15]
  envS.forEach((s, i) =>
    add({
      id: `${b.id}-EN${pad(i + 1)}`,
      name: `${b.short} 环境监测 ${i + 1}`,
      kind: "env",
      ...base,
      chainage: Math.round(s),
      pos: at(s, -2.2, 3)
    })
  )

  // 巷道
  b.roadway = { id: `RW-${b.id}`, ...b.roadway, path: b.path }
}

// 巡检机器人：主斜井、大巷各一台吊轨机器人；地面一台四足机器狗
add({
  id: "RB01",
  name: "主斜井吊轨巡检机器人",
  kind: "robotRail",
  belt: "BC02",
  chainage: [20, Math.round(BELTS[1].L - 20)],
  speed: 0.8
})
add({
  id: "RB02",
  name: "主运输大巷吊轨巡检机器人",
  kind: "robotRail",
  belt: "BC03",
  chainage: [20, Math.round(BELTS[2].L - 20)],
  speed: 1.0
})
add({
  id: "DOG01",
  name: "地面四足巡检机器狗",
  kind: "robotDog",
  belt: "BC01",
  chainage: [0, Math.round(BELTS[0].L)]
})

for (const m of BUNKERS)
  add({
    id: m.id,
    name: m.name,
    kind: "bunker",
    cap: m.cap,
    pos: [m.at[0], m.at[1], m.zBottom]
  })
for (const f of FEEDERS)
  add({
    id: f.id,
    name: f.name,
    kind: "feeder",
    belt: f.belt,
    bunker: f.bunker,
    chainage: f.at
  })
for (const w of FACES)
  add({
    id: w.id,
    name: w.name,
    kind: w.kind === "longwall" ? "longwall" : "devFace",
    belt: w.belt
  })

// UWB 定位基站：沿全部有人员通行的巷道每 200 m 一个
let uwb = 0
for (const b of BELTS) {
  if (b.area === "surface") continue
  const cum = measure(b.path)
  const L = cum[cum.length - 1]
  for (const s of range(0, L, 200)) {
    uwb++
    add({
      id: `UWB${pad(uwb, 3)}`,
      name: `${b.short} UWB 基站`,
      kind: "uwb",
      belt: b.id,
      chainage: Math.round(s),
      pos: pointAt(b.path, cum, s, 2.4, 3.2)
    })
  }
}

// 地面建筑与集控中心
const SURFACE = [
  {
    id: "JK01",
    name: "集控中心",
    kind: "controlRoom",
    at: [-70, 120],
    size: [36, 22, 14]
  },
  {
    id: "DRV-BC02",
    name: "主斜井驱动机房",
    kind: "driveHouse",
    at: [0, 4],
    size: [26, 34, 16]
  },
  {
    id: "ZZ-BC01",
    name: "转载点",
    kind: "transfer",
    at: [0, 22],
    size: [12, 12, 18]
  },
  {
    id: "XMC",
    name: "选煤厂（范围外）",
    kind: "plant",
    at: [300, 300],
    size: [80, 50, 32]
  }
]
for (const s of SURFACE)
  add({
    id: s.id,
    name: s.name,
    kind: s.kind,
    pos: [s.at[0], s.at[1], MINE.surfaceZ]
  })

/* ---------------- 输出 ---------------- */

function range(a, b, step) {
  const out = []
  for (let s = a; s < b; s += step) out.push(s)
  return out
}

const layout = {
  generatedBy: "scripts/smart-conveyor/layout.mjs",
  mine: MINE,
  belts: BELTS,
  // 逆煤流启动顺序（顺煤流停车反过来）
  startOrder: ["BC01", "BC02", "BC03", "BC04", "BC05", "BC06"],
  bunkers: BUNKERS,
  feeders: FEEDERS,
  faces: FACES,
  roadways: [...BELTS.map((b) => b.roadway), ...EXTRA_ROADWAYS],
  surface: SURFACE,
  devices
}

mkdirSync(OUT_PAGE, { recursive: true })
mkdirSync(OUT_DOC, { recursive: true })
writeFileSync(join(OUT_PAGE, "layout.json"), JSON.stringify(layout))
writeFileSync(join(OUT_DOC, "devices.json"), JSON.stringify(devices, null, 1))

// 摘要
const byKind = {}
for (const d of devices) byKind[d.kind] = (byKind[d.kind] || 0) + 1
console.log("皮带：")
for (const b of BELTS)
  console.log(
    `  ${b.id} ${b.short.padEnd(10, "　")} L=${b.L} m  提升 ${b.lift} m  ${b.angle}°  ${b.B} mm  ${b.v} m/s  ${b.Q} t/h  ${b.drives.length}×${b.drives[0].kW} kW  承载托辊 ${b.carryCount} 组`
  )
console.log(`设备 ${devices.length} 台：`, byKind)

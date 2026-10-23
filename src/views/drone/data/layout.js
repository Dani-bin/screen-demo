/*
 * 临江化工园区（虚构）· 场地布局
 * ----------------------------------------------------------
 * 片区、巡检对象、机场位置、航线航点。位置全部来自定稿反投影的 site.js
 * （scripts/drone/plan_site.py 生成，编号见 docs/design/drone/devices.json），
 * 这里只按编号整理成仿真和页面要用的结构，并定义航线。
 *
 * 坐标系 = 定稿相机的标定坐标系：原点在原料罐区 6 座浮顶罐罐顶中心网格的中心，
 * x 向东、y 向北，单位 m；z 为离地高度（AGL）。场地约东西 600 m × 南北 780 m，
 * 南侧临江（y < -577 是江面）。
 */

import SITE from "./site.js"

const P = SITE.park
const r1 = (v) => Math.round(v * 10) / 10

/** 园区范围（轴对齐外框） */
export const PARK = {
  name: "临江化工园区",
  x0: P.x0,
  x1: P.x1,
  y0: P.y0,
  y1: P.y1,
  w: P.w,
  h: P.d
}

/** 四个片区（矩形 [x0, y0, x1, y1]），每个片区由一个机场负责 */
const ZONE_DOCK = { Z1: "DK-01", Z2: "DK-02", Z3: "DK-03", Z4: "DK-04" }
/**
 * 片区名在地面上的锚点（文字上沿中点，场地坐标）：由定稿合成页 drafts.html 的锚点（AI 图像素）
 * 换算到定稿像素、再按标定相机反投影到地面得到（比对第 44 轮，评审指出片区文字位置偏）
 */
const ZONE_LABEL = {
  Z1: [24.3, -507.1],
  Z2: [218.6, -491.6],
  Z3: [404.3, -551.4],
  Z4: [324.0, 323.5]
}

export const ZONES = Object.fromEntries(
  Object.entries(SITE.zones).map(([id, z]) => [
    id,
    { name: z.name, rect: z.rect, dock: ZONE_DOCK[id], label: ZONE_LABEL[id] }
  ])
)

/**
 * 机场：位置、所在建筑屋顶高度（roof，m，0 = 地面机场）和配套无人机。
 * 无人机的"相对高度"按起飞点（机场所在平面）算，所以屋顶机场要扣掉 roof。
 * DK-02 在装置区控制楼屋顶，DK-04 在指挥中心屋顶。
 */
const DOCK_META = {
  "DK-01": { name: "1# 机场", zone: "Z1", drone: "UAV-01" },
  "DK-02": { name: "2# 机场", zone: "Z2", drone: "UAV-02" },
  "DK-03": { name: "3# 机场", zone: "Z3", drone: "UAV-03" },
  "DK-04": { name: "4# 机场", zone: "Z4", drone: "UAV-04" }
}
export const DOCKS = Object.fromEntries(
  Object.entries(DOCK_META).map(([id, m]) => {
    const d = SITE.docks[id]
    return [id, { ...m, x: r1(d.x), y: r1(d.y), roof: d.z }]
  })
)

/** 无人机：载荷决定能识别哪些事件（ch4 = 激光甲烷遥测，只有 1#、2# 挂） */
export const DRONES = {
  "UAV-01": {
    name: "1# 无人机",
    dock: "DK-01",
    payload: ["wide", "zoom", "ir", "laser", "ch4"],
    reg: "UAS38271046"
  },
  "UAV-02": {
    name: "2# 无人机",
    dock: "DK-02",
    payload: ["wide", "zoom", "ir", "laser", "ch4"],
    reg: "UAS38271053"
  },
  "UAV-03": {
    name: "3# 无人机",
    dock: "DK-03",
    payload: ["wide", "zoom", "ir", "laser"],
    reg: "UAS38271061"
  },
  "UAV-04": {
    name: "4# 无人机",
    dock: "DK-04",
    payload: ["wide", "zoom", "ir", "laser"],
    reg: "UAS38271078"
  }
}

// ---------------------------------------------------------------- 巡检对象

/**
 * 巡检对象：编号 → {名称, 类型, 片区, 位置, 半径, 责任部门}。
 * kind 决定可能出现的事件类型（见 catalog.js 的 RATES）；
 * r 为对象的大致半径（m），事件点在对象范围内随机偏移；线状对象带 line。
 */
export const TARGETS = {}

function target(id, name, kind, zone, x, y, r, unit, extra = {}) {
  TARGETS[id] = {
    id,
    name,
    kind,
    zone,
    x: r1(x),
    y: r1(y),
    r: r1(r),
    unit,
    ...extra
  }
}
const building = (id) => SITE.buildings.find((b) => b.id === id)
const avg = (arr, k) => arr.reduce((s, x) => s + x[k], 0) / arr.length

SITE.tanks.forEach((t) => {
  const n = t.id.slice(-1)
  const label =
    t.group === "TF-1" ? `原料罐区 ${n}# 浮顶罐` : `成品罐区 ${n}# 固定顶罐`
  target(t.id, label, "tank", "Z1", t.x, t.y, t.d / 2, "储运部", {
    group: t.group,
    d: t.d,
    h: t.h
  })
})
SITE.spheres.forEach((s) => {
  target(
    s.id,
    `液化烃球罐区 ${s.id.slice(-1)}# 球罐`,
    "sphere",
    "Z1",
    s.x,
    s.y,
    s.d / 2,
    "储运部",
    {
      group: "SP-1",
      d: s.d
    }
  )
})
const ld = building("LD-1")
target("LD-1", "汽车装卸站", "loading", "Z1", ld.cx, ld.cy, ld.w / 2, "储运部")
const berth = SITE.jetty.berth
target(
  "JT-1",
  "液体化工码头",
  "jetty",
  "Z1",
  (berth[0][0] + berth[1][0]) / 2,
  (berth[0][1] + berth[1][1]) / 2,
  45,
  "储运部"
)
const UNIT_NAME = {
  "U-1": ["1# 裂解装置", "裂解车间"],
  "U-2": ["2# 芳烃装置", "芳烃车间"],
  "U-3": ["3# 聚烯烃装置", "聚烯烃车间"]
}
SITE.units.forEach((u) => {
  const [cx, cy, w, d] = u.block
  target(
    u.id,
    UNIT_NAME[u.id][0],
    "unit",
    "Z2",
    cx,
    cy,
    Math.min(w, d) / 2,
    UNIT_NAME[u.id][1],
    { w, d }
  )
})
const rack = SITE.pipeRacks.find((p) => p.id === "PR-1")
target(
  "PR-1",
  "园区公共主管廊",
  "piperack",
  "Z2",
  avg(
    rack.pts.map(([x, y]) => ({ x, y })),
    "x"
  ),
  avg(
    rack.pts.map(([x, y]) => ({ x, y })),
    "y"
  ),
  300,
  "管廊管理所",
  {
    line: [rack.pts[0], rack.pts.at(-1)],
    pts: rack.pts
  }
)
const ss = SITE.lots["SS-1"]
target("SS-1", "总变电站", "utility", "Z3", ss[0], ss[1], 50, "公用工程部")
target(
  "CW-1",
  "循环水场",
  "utility",
  "Z3",
  avg(SITE.coolingTowers, "x"),
  avg(SITE.coolingTowers, "y"),
  45,
  "公用工程部"
)
target(
  "AS-1",
  "空分装置",
  "utility",
  "Z3",
  avg(SITE.coldBoxes, "x"),
  avg(SITE.coldBoxes, "y"),
  25,
  "公用工程部"
)
target(
  "WW-1",
  "污水处理场",
  "utility",
  "Z3",
  avg(SITE.basins, "x"),
  avg(SITE.basins, "y"),
  60,
  "公用工程部"
)
target(
  "HW-1",
  "危废仓库",
  "warehouse",
  "Z3",
  SITE.hazWaste.cx,
  SITE.hazWaste.cy,
  15,
  "公用工程部"
)
target(
  "FL-1",
  "高架火炬",
  "flare",
  "Z3",
  SITE.flare.x,
  SITE.flare.y,
  6,
  "公用工程部",
  { h: SITE.flare.h, noFly: 60 }
)
const cc = building("CC-1")
target(
  "CC-1",
  "园区指挥中心",
  "office",
  "Z4",
  cc.cx,
  cc.cy,
  cc.w / 2,
  "园区管委会"
)
const fs = building("FS-1")
target(
  "FS-1",
  "特勤消防站 + 气防站",
  "office",
  "Z4",
  fs.cx,
  fs.cy,
  fs.w / 2,
  "园区消防"
)
const pk = SITE.lots["PK-1"]
target(
  "PK-1",
  "危化品车辆专用停车场",
  "parking",
  "Z4",
  pk[0],
  pk[1],
  35,
  "物流管理部"
)
const wh = building("WH-1")
target(
  "WH-1",
  "危化品仓库",
  "warehouse",
  "Z4",
  wh.cx,
  wh.cy,
  wh.w / 2,
  "物流管理部"
)
const GATE_NAME = {
  "G-1": "综合卡口",
  "G-2": "危化品专用卡口",
  "G-3": "普通卡口",
  "G-4": "应急卡口"
}
for (const [g, [x, y]] of Object.entries(SITE.gates))
  target(
    g,
    GATE_NAME[g],
    "gate",
    x > P.x1 - 5 ? "Z3" : x < P.x0 + 5 ? "Z1" : "Z4",
    x,
    y,
    10,
    "园区安保中心"
  )
const PM = {
  "PM-N": [
    "周界围网北段",
    "Z4",
    [
      [P.x0, P.y1],
      [P.x1, P.y1]
    ]
  ],
  "PM-E": [
    "周界围网东段",
    "Z3",
    [
      [P.x1, P.y1],
      [P.x1, P.y0]
    ]
  ],
  "PM-S": [
    "周界围网南段",
    "Z2",
    [
      [P.x1, P.y0],
      [P.x0, P.y0]
    ]
  ],
  "PM-W": [
    "周界围网西段",
    "Z1",
    [
      [P.x0, P.y0],
      [P.x0, P.y1]
    ]
  ]
}
for (const [id, [name, zone, line]] of Object.entries(PM)) {
  const len = Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1])
  target(
    id,
    name,
    "perimeter",
    zone,
    (line[0][0] + line[1][0]) / 2,
    (line[0][1] + line[1][1]) / 2,
    len / 2,
    "园区安保中心",
    { line }
  )
}

/** 火炬禁飞柱：航线规划和复核飞行都要绕开（场地小，半径取 60 m） */
export const NO_FLY = [
  {
    id: "FL-1",
    x: TARGETS["FL-1"].x,
    y: TARGETS["FL-1"].y,
    r: 60,
    // 画面上的示意柱按定稿画：半径约 18 m、顶圈 148 m（定稿 AI 图上半径 46 px，按标定相机换算）；
    // r 是航线规划用的禁飞半径，两者不同，见 11-review-report.md 遗留问题
    markR: 18,
    markH: 148
  }
]

/** 剧情事件（2# 芳烃装置气体泄漏）的位置 */
export const STORY_LEAK = {
  x: r1(SITE.storyLeak[0]),
  y: r1(SITE.storyLeak[1]),
  z: SITE.storyLeak[2]
}

// ---------------------------------------------------------------- 航线

/**
 * 航点：[x, y, 离地高度 z, 悬停秒数, 观察对象[]]。
 * 有观察对象的航点会悬停拍照（可见光 / 红外 / 甲烷读数），AI 在这里出事件。
 * 第一段（机场 → 首个航点）和最后一段（末航点 → 机场）按转场速度飞，
 * 中间各段按巡检速度飞（见 simulator.js 的 SPEED）。
 * 高度：罐区 45 m（罐高 13–17 m），装置区 130 m（塔器最高约 101 m），
 * 公用工程 50–70 m（冷箱约 49 m），周界与物流区 35–40 m。
 * 航点都在罐 / 塔的侧上方，不从正上方掠过易燃易爆设备。
 */
const L = STORY_LEAK
export const ROUTES = {
  "RT-11": {
    name: "罐区例行巡检",
    dock: "DK-01",
    wps: [
      [60, -230, 45, 0, []],
      [55, -200, 45, 90, ["TK-204", "TK-208", "TK-203", "TK-207"]],
      [-65, -200, 45, 90, ["TK-201", "TK-205", "TK-202", "TK-206"]],
      [-80, -15, 45, 90, ["TK-101", "TK-104"]],
      [0, 80, 45, 90, ["TK-101", "TK-102", "TK-103"]],
      [80, 15, 45, 90, ["TK-103", "TK-106", "TK-102", "TK-105"]],
      [0, -65, 45, 90, ["TK-104", "TK-105", "TK-106"]],
      [-90, -320, 30, 60, ["PR-1"]],
      [60, -295, 30, 60, ["PR-1"]]
    ]
  },
  "RT-12": {
    name: "球罐区 · 装卸站 · 码头",
    dock: "DK-01",
    wps: [
      [-75, -400, 40, 90, ["SP-101", "SP-104"]],
      [-25, -345, 40, 90, ["SP-101", "SP-102", "SP-103"]],
      [25, -400, 40, 90, ["SP-103", "SP-106"]],
      [-25, -455, 40, 60, ["SP-104", "SP-105", "SP-106"]],
      [-25, -510, 35, 90, ["LD-1"]],
      [100, -560, 35, 0, []],
      [120, -635, 35, 90, ["JT-1"]],
      [60, -672, 35, 60, ["JT-1"]],
      [160, -680, 35, 60, ["JT-1"]]
    ]
  },
  "RT-21": {
    name: "装置区例行巡检",
    dock: "DK-02",
    wps: [
      // 第一个悬停点就是 2# 芳烃装置：剧情事件在这里被发现（simulator.js 的 STORY_WP = 0），
      // 发现后原地悬停监视。位置由定稿反推：图上显示的"高度 118 m"是相对起飞点（机场顶约 12 m），
      // 绝对高度 130 m；UAV-02 的像素在 130 m 高度上落在泄漏点正南约 240 m，从这里看泄漏点俯角约 27°，
      // 正是定稿机载画面斜看装置区的构图，也在安全距离外、不压在泄漏点头顶
      // （比对第 26 轮，原为泄漏点西 40 m、南 20 m）
      [L.x - 3, L.y - 240, 130, 90, ["U-2"]],
      [355, -300, 130, 90, ["U-2"]],
      [355, -120, 130, 90, ["U-2"]],
      [180, -95, 130, 90, ["U-3"]],
      [85, -140, 130, 90, ["U-1"]],
      [85, -330, 130, 90, ["U-1"]],
      [165, -380, 130, 90, ["U-1", "U-3"]]
    ]
  },
  "RT-22": {
    name: "主管廊全线",
    dock: "DK-02",
    wps: [
      [470, -280, 30, 40, ["PR-1"]],
      [380, -280, 30, 40, ["PR-1"]],
      [280, -285, 30, 40, ["PR-1"]],
      [180, -290, 30, 40, ["PR-1"]],
      [80, -300, 30, 40, ["PR-1"]],
      [-20, -315, 30, 40, ["PR-1"]],
      [-90, -335, 30, 40, ["PR-1"]],
      [110, -560, 30, 60, ["PR-1"]]
    ]
  },
  "RT-31": {
    name: "公用工程巡检",
    dock: "DK-03",
    wps: [
      [400, -20, 60, 90, ["SS-1"]],
      [445, -120, 60, 90, ["SS-1"]],
      [430, -265, 60, 90, ["CW-1"]],
      [360, -405, 70, 90, ["AS-1"]],
      [445, -425, 70, 90, ["HW-1", "AS-1"]],
      [395, -470, 50, 90, ["WW-1"]],
      [470, -385, 50, 60, ["WW-1"]]
    ]
  },
  "RT-32": {
    name: "东段 · 南段周界",
    dock: "DK-03",
    wps: [
      [490, 230, 40, 0, []],
      [490, 100, 40, 60, ["PM-E"]],
      [495, -290, 40, 60, ["PM-E", "G-3"]],
      [490, -420, 40, 0, []],
      [400, -560, 40, 60, ["PM-S"]],
      [200, -560, 40, 60, ["PM-S"]],
      [0, -560, 40, 60, ["PM-S"]],
      [-90, -560, 40, 0, []]
    ]
  },
  "RT-41": {
    name: "物流区 · 北侧卡口",
    dock: "DK-04",
    wps: [
      [142, 235, 35, 60, ["G-1"]],
      [323, 235, 35, 60, ["G-2"]],
      [347, 205, 35, 90, ["PK-1"]],
      [347, 100, 35, 60, ["PK-1"]],
      [414, 120, 35, 90, ["WH-1"]],
      [470, 200, 35, 60, ["WH-1"]]
    ]
  },
  "RT-42": {
    name: "北段 · 西段周界",
    dock: "DK-04",
    wps: [
      [490, 238, 40, 60, ["PM-N"]],
      [200, 245, 40, 0, []],
      [-95, 238, 40, 60, ["PM-N"]],
      [-105, 0, 40, 60, ["PM-W"]],
      // 西门 G-4 悬停 30 s（下一段挪到西南角后变长，缩短这里的悬停，14:03 时正好在西南角悬停拍照）
      [-105, -261, 40, 30, ["PM-W", "G-4"]],
      // 西南角：定稿里 UAV-04 的像素（AI 图 70, 600）在 40 m 高度上反推落在这里（南围栏外约 50 m）；
      // 原先 (-105, -520) 投影在左面板底下，标签也被截断（比对第 33 轮）
      [-50, -586, 40, 60, ["PM-W"]]
    ]
  }
}

/**
 * 每日计划时刻表（北京时间 HH:MM）。白天每个机场大约每小时一趟（飞约 12–20 min，
 * 落地散热 + 充电约 20 min），这样同一时刻通常有 1–3 架在飞；装置区按"两重点
 * 一重大部位 ≤ 1 h"每小时一趟，罐区 2 h 一趟，周界含夜间红外。频次高于调研里
 * 化工园区案例的 6 架次 / 天，取的是"每台每天 12 架次以上"的高强度用法
 * （02-research.md），是为了满足需求里"同时 1–3 架在飞"。
 * 四个机场错开起飞（1#、2# 整点，3# 每时 20 分，4# 每时 50 分），避免扎堆。
 */
export const SCHEDULE = {
  "RT-11": ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"],
  "RT-12": ["07:00", "09:00", "11:00", "13:00", "15:00", "17:00"],
  "RT-21": [
    "08:00",
    "09:00",
    "10:00",
    "11:00",
    "12:00",
    "13:00",
    "14:00",
    "15:00",
    "16:00",
    "17:00",
    "18:00"
  ],
  "RT-22": ["07:00", "19:00"],
  "RT-31": ["08:20", "10:20", "12:20", "14:20", "16:20"],
  "RT-32": ["07:20", "09:20", "11:20", "13:20", "15:20", "17:20", "21:00"],
  "RT-41": ["08:50", "10:50", "12:50", "14:50", "16:50"],
  "RT-42": ["07:50", "09:50", "11:50", "13:50", "15:50", "17:50", "22:00"]
}

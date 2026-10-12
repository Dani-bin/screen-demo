/*
 * 综合能源补给站 车辆行驶路线
 * ----------------------------------------------------------
 * 路线按规划米坐标 (u 沿路, v 向场内) 手工给出关键点，换算成 three.js 坐标 [x, z]
 * （x = 110 - u，z = 40 - v）后由场景用 Catmull-Rom 曲线连成平滑路径。
 * 关键点对照规划图 docs/design/energy/plan-v2.png 与 scripts/energy/draw_plan.py 里的道路、加油岛、车位。
 *
 * 门前国道（双向六车道）：靠场地一侧 v -14.5 ~ -4 为南行三车道（向 +u 行驶），对侧为北行三车道。
 * 站内流线（v2，按设计稿布局）：
 *   小车  中部入口进站 → 加油加气罩棚 / 换电站 → 西端出口驶出
 *   重卡  东端入口进站 → LNG 罩棚加气 / 车位前通道倒车入超充位 → 中部出口驶出
 * 每条路线里 stop 标记的点是停车点（加油、换电、加气），hold 表示停下后等场景放行（LNG 卸车）。
 */

export const P = (u, v) => [110 - u, 40 - v]

/** 车道中心线的 v 坐标（与 scripts/blender/energy/layout.py 的 LANES_V 一致） */
export const LANE = {
  sNear: -5.75,
  sMid: -9.25,
  sFar: -12.75,
  nNear: -19.25,
  nMid: -22.75,
  nFar: -26.25
}

/** 门前国道两端（u）：车辆在这里出现 / 消失（场景按 outline.json 里各车道被沙盘截断的实际范围替换） */
export const ROAD_U = [0, 230]

// ---------------------------------------------------------------- 小车

/** 小车进站：南行近侧车道 → 中部入口右转，驶上斜坡道 */
const CAR_IN = [
  ["START", LANE.sNear],
  [124, LANE.sNear],
  [138, -4.6],
  [147, -0.5],
  [153, 4]
]

/** 小车出站：沿罩棚西侧回场道驶向西端出口，汇入南行近侧车道 */
const carExit = (v) => [
  [205, v],
  [209.5, Math.max(10, v - 6)],
  [210, 7],
  [214, 2.5],
  [220, -2.2],
  [228, LANE.sNear],
  ["END", LANE.sNear]
]

/** 加油岛中心（u）：两排各 3 岛，沿路方向排开 */
export const FUEL_ISLAND_U = [172.5, 185, 197.5]

/**
 * 加油 / CNG 小车：从斜坡道拐进加油岛之间的车道 lane，前轴停在 stopU（车身对着加油机），
 * 驶出罩棚后从西端出口离站
 */
export function carFuelRoute(lane, stopU) {
  return [
    ...CAR_IN,
    [157, 9],
    [161, (lane + 9) / 2 + 2],
    [168, lane],
    [stopU, lane, "stop"],
    ...carExit(lane)
  ]
}

/** 换电小车：沿斜坡道开到罩棚北侧，由东口驶入换电通道停车换电，西口驶出后沿罩棚北侧通道离站 */
export function carSwapRoute() {
  return [
    ...CAR_IN,
    [157, 10],
    [160, 24],
    [161.5, 35],
    [165, 41.5],
    [174.5, 41.5, "stop"],
    [182, 41.5],
    [186, 36],
    [192, 33.5],
    [203, 33.5],
    [208.5, 28],
    ...carExit(20).slice(1)
  ]
}

// ---------------------------------------------------------------- 重卡

/** 重卡进站：南行近侧车道 → 东端入口右转，驶上斜坡道到车位前通道东端 */
const TRUCK_IN = [
  ["START", LANE.sNear],
  [24, -2],
  [36, 6],
  [46, 14],
  [54, 22]
]

/** 重卡出站：经中部出口道（u 128 ~ 144）驶出，汇入南行近侧车道 */
const TRUCK_OUT = [
  [137, 8],
  [139.5, 2],
  [145, -3],
  [154, LANE.sNear],
  ["END", LANE.sNear]
]

/** LNG 加气重卡：从通道东端绕过箱变，进加气岛一侧的车道 lane，牵引车停在加气机旁（整车落在罩棚下） */
export function truckLngRoute(lane) {
  return [
    ...TRUCK_IN,
    [62, 24.5],
    [74, lane + 2.5],
    [86, lane],
    [118, lane, "stop"],
    [128, lane],
    [134.5, lane - 2.5],
    ...TRUCK_OUT
  ]
}

/** LNG 槽车：开上斜坡道停在储罐区西侧卸车，卸完沿车位前通道从中部出口离站 */
export function tankerRoute() {
  return [
    ...TRUCK_IN.slice(0, 4),
    [40, 11],
    [44.5, 18, "hold"],
    [50, 25],
    [60, 30.5],
    [126, 30],
    [134, 26],
    ...TRUCK_OUT
  ]
}

/** 第 i 个超充位的中心 u（垂直式一排，每位宽 6.4 m，从 u 70 起） */
const bayU = (i) => 73.2 + 6.4 * i

/** 倒车入位时越过车位的距离（挂车后轴组要先完全越过车位，倒车时挂车才能领先沿曲线拐进车位） */
const OVERSHOOT = 25

/**
 * 电动重卡（牵引车 + 厢式挂车）进超充位，倒车入位、车头朝通道：
 *   forward  沿车位前通道（v 31.5）开过车位，前轴停在车位以西 OVERSHOOT 米
 *   reverse  倒车：先沿通道直退（挂车在前），再以 8 m 半径拐进车位，前轴停在车位前沿内 2.5 m；
 *            段末停住，仿真结束充电后放行。
 * 路线点都是牵引车前轴位置；挂车后轴组沿同一条曲线走在前面（vehicles.js 的倒车模型）
 */
export function truckChargeIn(i) {
  const u = bayU(i)
  const A = u + OVERSHOOT
  const arc = []
  for (let k = 1; k < 6; k++) {
    const a = (k / 6) * (Math.PI / 2)
    arc.push([u + 8 - 8 * Math.sin(a), 39.5 - 8 * Math.cos(a)])
  }
  return {
    forward: [...TRUCK_IN, [60, 30], [70, 31.5], [A, 31.5]],
    reverse: [[A, 31.5], [u + 8, 31.5], ...arc, [u, 39.5], [u, 41.5]]
  }
}

/** 离开超充位：车头朝通道直接驶出，左转沿通道（v 28）开到中部出口道离站 */
export function truckChargeOut(i) {
  const u = bayU(i)
  return [
    [u, 41.5],
    [u, 36],
    [u + 3, 31],
    [u + 9, 28.5],
    [Math.max(u + 14, 128), 28.5],
    [Math.max(u + 18, 135), 24],
    ...TRUCK_OUT
  ]
}

/** 倒车入位后牵引车驾驶室后方（充电口）的规划坐标：充电线从终端连到这里 */
export function truckChargePort(i) {
  return [bayU(i) - 1.35, 44]
}

// ---------------------------------------------------------------- 停车场 / 车道占用

/**
 * 停车场里常驻的车辆（设计稿里停车场是停满的）：[u, v, 朝向]，朝向 1 为车头朝 +v（员工车位，车头朝办公楼），
 * -1 为车头朝 -v（私家车位，车头朝路）
 */
export const PARKED = [
  ...[0, 1, 2, 3, 4, 5].map((i) => [215.3 + 2.6 * i, 30.6, 1]),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => [213.3 + 2.6 * i, 16.4, -1])
]

/** 车道占用：每条车道同一时间只放一辆车（避免画面上车辆穿插） */
export const FUEL_LANES = [12.5, 20] // 加油：前排加油岛两侧
export const CNG_LANES = [20, 27.5] // CNG：后排东侧两岛（CNG）两侧
export const LNG_LANES = [13, 20.85]

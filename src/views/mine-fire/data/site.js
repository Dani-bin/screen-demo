/*
 * /mine-fire 静态配置：硐室、防护分区、装置、探测器、阈值、避难硐室
 * ----------------------------------------------------------
 * 口径与定稿一致（docs/design/mine-fire/design/src/data.js）：
 *   - 设备：全氟己酮方案的柜内无储压装置（每个开关柜 / 空压机 / 启动柜内一台），电缆沟用悬挂式（假设）
 *   - 联动与阈值：霄云规格书第五、六章（单一类型只预警；两类复合确认 → 断电闭锁、关防火阀、30 s 延时喷放）
 *   - 数量全部是演示数据；硐室位置在 plan.json（CAD 没标，按定稿假设）
 */

// 阈值（霄云规格书表 5）
export const TH = {
  dts: { warn: 60, alarm: 120, unit: "℃" },
  co: { warn: 20, alarm: 24, unit: "ppm" },
  temp: { alarm: 34, unit: "℃" }
}

// 探测器类型
export const SENSOR_TYPES = [
  { key: "dts", name: "光纤测温", prefix: "DTS" },
  { key: "smoke", name: "烟雾", prefix: "SM" },
  { key: "co", name: "一氧化碳", prefix: "CO" },
  { key: "flame", name: "火焰", prefix: "FL" },
  { key: "temp", name: "温度", prefix: "TP" }
]

/*
 * 四个受监控硐室：zones = 防护分区及柜内装置台数；sensors = 各类探测器数量；
 * base = 平时读数（光纤最高温、CO、环境温度），仿真在其上加小幅波动
 */
export const CHAMBERS = [
  {
    id: "DS-01",
    name: "空压机站",
    loc: "井底车场",
    size: [18.4, 8],
    zones: [
      { name: "空压机区", units: 3 },
      { name: "配电区", units: 4 }
    ],
    sensors: { dts: 1, smoke: 3, co: 2, flame: 3, temp: 2 },
    fiber: 60,
    base: { dts: 31.2, co: 1, temp: 24.6 }
  },
  {
    id: "DS-02",
    name: "主排水泵房",
    loc: "井底车场",
    size: [36, 6],
    zones: [
      { name: "水泵启动区", units: 6 },
      { name: "配电区", units: 2 }
    ],
    sensors: { dts: 1, smoke: 3, co: 2, flame: 2, temp: 2 },
    fiber: 80,
    base: { dts: 28.6, co: 0, temp: 22.1 }
  },
  {
    id: "DS-03",
    name: "井下主变电所",
    loc: "井底车场",
    size: [52, 7],
    zones: [
      { name: "高防开关区", units: 12 },
      { name: "低压开关区", units: 10 },
      { name: "变压器区", units: 2 },
      { name: "电缆沟", units: 4 }
    ],
    sensors: { dts: 2, smoke: 5, co: 4, flame: 2, temp: 2 },
    fiber: 160,
    base: { dts: 36.8, co: 1, temp: 26.3 }
  },
  {
    id: "DS-04",
    name: "一盘区变电所",
    loc: "主运输大巷西侧",
    size: [44, 6],
    zones: [
      { name: "高防开关区", units: 6 },
      { name: "低压开关区", units: 7 },
      { name: "变压器区", units: 2 },
      { name: "电缆沟", units: 4 }
    ],
    sensors: { dts: 1, smoke: 4, co: 3, flame: 2, temp: 2 },
    fiber: 120,
    base: { dts: 41, co: 2, temp: 26 }
  }
]

// 常驻异常：DS-03 一台装置启动回路故障、DS-02 一台 CO 离线（与剧本无关，始终存在）
export const FAULT_UNIT = {
  id: "MF-03-G09",
  ds: "DS-03",
  zone: "高防开关区",
  note: "启动回路电阻偏高"
}
export const OFFLINE_SENSOR = {
  id: "CO-02-02",
  ds: "DS-02",
  type: "co",
  last: "13:52:06"
}

// 永久避难硐室环境（CAD 标注额定 100 人）
export const REFUGE_ENV = {
  "RC-01": { o2: 20.8, co: 0, air: 0.55, temp: 22.4 },
  "RC-02": { o2: 20.9, co: 0, air: 0.54, temp: 21.7 }
}

// 近 6 日预警记录（按类型）；当天的由仿真按剧本累加
export const WARN_HISTORY = [
  { day: "10-21", heat: 1, co: 1, smoke: 0, fire: 0 },
  { day: "10-22", heat: 0, co: 0, smoke: 0, fire: 0 },
  { day: "10-23", heat: 0, co: 0, smoke: 1, fire: 0 },
  { day: "10-24", heat: 1, co: 2, smoke: 0, fire: 0 },
  { day: "10-25", heat: 1, co: 0, smoke: 0, fire: 0 },
  { day: "10-26", heat: 0, co: 0, smoke: 0, fire: 0 }
]
// 当天剧本之前已有的预警：08:40 爆破炮烟导致 CO 预警一次
export const TODAY_BEFORE = { day: "10-27", heat: 0, co: 1, smoke: 0, fire: 0 }

export const DATE = {
  date: "2026-10-27",
  week: "星期二",
  shift: "早班 08:00–16:00"
}
// 井下在岗总人数（人员定位系统）
export const UNDERGROUND = 186

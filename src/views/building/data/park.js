/*
 * 数字楼宇 园区级（成都金融城双子塔 · 天府国际金融中心）面板数据
 * ----------------------------------------------------------
 * 楼栋名称、层数、高度来自 ./parkData.js（OSM）；入驻率、能耗、安防、设备、告警等运营指标均为演示数据。
 */
import { PARK_BUILDINGS } from "./parkData"

/** 各楼栋入驻率（%）与入驻企业（家），演示数据 */
const OCCUPANCY = {
  tower_S: [96, 118],
  tower_N: [94, 98],
  ifc_1: [92, 26],
  ifc_2: [88, 17],
  ifc_3: [85, 15],
  ifc_4: [90, 24],
  ifc_5: [87, 14],
  ifc_6: [83, 12],
  ifc_8: [76, 4],
  ifc_9: [72, 3],
  hall: [71, 0]
}

/** 楼栋状态：会议中心屋面冷却塔振动告警（与告警列表一致），其余正常 */
export const BUILDING_STATUS = { hall: "alarm" }

/** 楼栋一览（按高度、编号排序） */
export const BUILDING_LIST = PARK_BUILDINGS.map((b) => ({
  ...b,
  occupancy: OCCUPANCY[b.key]?.[0] ?? 80,
  tenants: OCCUPANCY[b.key]?.[1] ?? 0,
  status: BUILDING_STATUS[b.key] || "ok"
}))

/** 园区概况 */
export const PARK_SUMMARY = {
  name: "成都金融城双子塔园区",
  address: "交子大道 · 天府大道北段 · 金融城片区",
  buildings: PARK_BUILDINGS.length,
  floorArea: 38.6, // 万 m²
  occupancy: 92.4,
  tenants: BUILDING_LIST.reduce((s, b) => s + b.tenants, 0),
  staff: 1.58, // 万人
  parking: 2860
}

/** 今日逐时能耗（kWh），演示数据：夜间基荷 + 白天空调与办公负荷 */
export const ENERGY_TODAY = Array.from({ length: 24 }, (_, h) =>
  Math.round(
    900 +
      1400 * Math.exp(-((h - 14) ** 2) / 30) +
      (h > 8 && h < 19 ? 600 : 0) +
      ((h * 37) % 11) * 12
  )
)

/** 园区安防（演示数据） */
export const SECURITY = [
  { label: "摄像头在线", value: "1,284", unit: "/1,302", tone: "green" },
  { label: "门禁通行", value: "18,640", unit: "人次" },
  { label: "访客预约", value: 326, unit: "人" },
  { label: "车辆进出", value: "3,912", unit: "辆" },
  { label: "巡更完成", value: 96, unit: "%", tone: "cyan" },
  { label: "周界告警", value: 0, unit: "起", tone: "green" }
]

/** 园区设备（台，演示数据） */
export const DEVICES = [
  { name: "暖通空调", value: 4120, color: "#2f9bff" },
  { name: "电梯扶梯", value: 86, color: "#ffc65a" },
  { name: "给排水", value: 1960, color: "#3ddc97" },
  { name: "消防设施", value: 9830, color: "#ff6b5b" },
  { name: "照明配电", value: 7410, color: "#a77bff" }
]

/** 园区告警（演示数据）：level 1 紧急 / 2 重要 / 3 一般；key 为告警所在楼栋，点击可定位 */
export const PARK_ALARMS = [
  {
    time: "16:21",
    level: 1,
    key: "tower_N",
    place: "北塔 B2 配电房",
    text: "低压柜 3# 出线温度过高"
  },
  {
    time: "16:05",
    level: 2,
    key: "hall",
    place: "会议中心 屋面",
    text: "冷却塔 2# 风机振动偏大"
  },
  {
    time: "15:48",
    level: 3,
    key: "tower_S",
    place: "南塔 27F",
    text: "烟感探测器电量低"
  },
  {
    time: "15:30",
    level: 3,
    key: "tower_S",
    place: "南塔 B1 车库",
    text: "地下车库 CO 浓度偏高"
  }
]

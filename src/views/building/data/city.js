/*
 * 数字楼宇 城市级（成都高新区）面板数据
 * ----------------------------------------------------------
 * 真实数据（街道边界与面积、双子塔与高层楼宇的高度 / 层数）来自 ./mapData.js，由脚本从 OSM 生成；
 * 本文件只放没有公开来源的运营类指标——接入楼宇数、资产、告警等，均为演示数据（不是真实统计），
 * 数值按「高新区南区金融城一带楼宇最密」的常识大致配比。
 */
import { STREETS, PARK, TOWERS } from "./mapData"

/** 各街道接入平台的楼宇数（栋，演示数据） */
const STREET_BUILDINGS = {
  桂溪街道: 186,
  中和街道: 74,
  石羊街道: 92,
  肖家河街道: 38,
  芳草街街道: 45
}

/** 地图柱子 / 立牌数据：街道锚点 + 接入楼宇数 */
export const STREET_BARS = STREETS.map((s) => ({
  name: s.name,
  enName: s.enName,
  zone: s.zone,
  area: s.area,
  center: s.center,
  value: STREET_BUILDINGS[s.name] || 0
}))

/** 区域概况（高新区南区）：面积按街道边界计算（真实），其余为演示数据 */
const byArea = [...STREETS].sort((a, b) => b.area - a.area)
export const ZONE_OVERVIEW = {
  area: Math.round(STREETS.reduce((sum, s) => sum + s.area, 0) * 10) / 10,
  // 面积旁边列两个街道：园区所在的街道 + 面积最大的街道（两者相同时取第二大）
  highlights: [
    { ...STREETS.find((s) => s.name === PARK.street), note: "园区所在" },
    { ...byArea.find((s) => s.name !== PARK.street), note: "面积最大" }
  ],
  streets: STREETS.length,
  buildings: Object.values(STREET_BUILDINGS).reduce((a, b) => a + b, 0),
  parks: 9,
  // 超高层：OSM 有高度记录的 100 m 以上楼宇 + 双子塔两栋
  towers: TOWERS.length + PARK.towers.length,
  enterprises: 7180
}

/** 高层楼宇排行：双子塔 + OSM 的 100 m 以上楼宇（真实高度），取前 8 */
export const TOWER_RANK = [
  ...PARK.towers.map((t) => ({ ...t, park: true })),
  ...TOWERS
]
  .sort((a, b) => b.height - a.height)
  .slice(0, 8)

/** 接入楼宇业态构成（栋，演示数据；合计与 STREET_BUILDINGS 一致） */
export const BUILDING_MIX = [
  { name: "商务办公", value: 196, color: "#2f9bff" },
  { name: "产业研发", value: 116, color: "#2de2e6" },
  { name: "商业综合", value: 59, color: "#ffc65a" },
  { name: "公寓酒店", value: 38, color: "#a77bff" },
  { name: "公共配套", value: 26, color: "#3ddc97" }
]

/** 园区：双子塔（塔楼高度 / 层数为 OSM 真实值，其余为演示数据） */
export const PARK_INFO = {
  ...PARK,
  address: "高新区交子大道 · 金融城",
  floorArea: 38.6, // 万 m²
  occupancy: 92.4, // 入驻率 %
  tenants: 216, // 入驻企业
  staff: 15800, // 日均在岗人数
  energyToday: 41.2 // 今日能耗 MWh
}

/** 资产概览（全区接入楼宇，演示数据） */
export const ASSET_OVERVIEW = {
  total: 286540,
  online: 97.6,
  categories: [
    { name: "暖通空调", value: 48210, color: "#2f9bff" },
    { name: "安防监控", value: 63980, color: "#2de2e6" },
    { name: "消防设施", value: 71460, color: "#ff6b5b" },
    { name: "电梯扶梯", value: 3260, color: "#ffc65a" },
    { name: "给排水", value: 22870, color: "#3ddc97" },
    { name: "照明配电", value: 76760, color: "#a77bff" }
  ]
}

/**
 * 实时告警（演示数据）：level 1 紧急 / 2 重要 / 3 一般。
 * 只挂在本演示的园区（双子塔）和匿名楼宇上，不给其他真实楼宇编造故障
 */
export const ALARMS = [
  {
    time: "15:42",
    level: 1,
    place: "双子塔北塔 B2 配电房",
    text: "低压柜 3# 出线温度过高"
  },
  {
    time: "15:36",
    level: 2,
    place: "桂溪街道 · 接入楼宇 G-017",
    text: "新风机组过滤网压差报警"
  },
  {
    time: "15:21",
    level: 3,
    place: "双子塔南塔 27F",
    text: "烟感探测器电量低"
  },
  {
    time: "15:08",
    level: 2,
    place: "石羊街道 · 接入楼宇 S-042",
    text: "集水井液位超高"
  },
  { time: "14:55", level: 3, place: "双子塔南塔 32F", text: "门禁读卡器离线" },
  {
    time: "14:37",
    level: 3,
    place: "中和街道 · 接入楼宇 Z-021",
    text: "照明回路电流异常"
  }
]

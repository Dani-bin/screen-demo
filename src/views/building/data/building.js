/*
 * 数字楼宇 楼宇级（成都金融城双子塔 南塔 / 北塔）面板与楼层数据
 * ----------------------------------------------------------
 * 真实的只有塔高 218 m、地上 58 层、椭圆平面与斜切屋顶（OSM，见 ./parkData.js 的 PARK_TOWERS）；
 * 地下层数、业态、入驻企业、电梯、资产、能耗、人员等全部是演示数据（按固定种子生成，每次打开一致）。
 */
import { PARK_TOWERS } from "./parkData"

/** 固定种子的伪随机数（演示数据可复现） */
function seeded(seed) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

/** 两座塔的档案（演示数据），key 与园区级 bld_<key> 一致 */
const PROFILE = {
  tower_S: {
    short: "南塔",
    area: 16.8, // 万 m²
    tenants: 118,
    staff: 8420,
    occupancy: 96.1,
    elevators: [24, 4], // 客梯、货梯
    seed: 7
  },
  tower_N: {
    short: "北塔",
    area: 16.5,
    tenants: 98,
    staff: 7360,
    occupancy: 94.3,
    elevators: [24, 4],
    seed: 13
  }
}

/** 地下层数（演示）：B1 车库、B2 配电 / 冷冻机房、B3 水泵房 / 消防水池 */
export const BASEMENT_LEVELS = 3
/** 裙楼（大堂 + 商业）层数 */
export const PODIUM_LEVELS = 4
/** 设备 / 避难层：新风机组、换热站 */
const PLANT_FLOORS = { 18: "新风机组", 36: "换热站", 54: "冷却水泵" }

/** 写字楼租户（虚构的通用名称，不对应真实企业） */
const TENANTS = [
  "金融科技中心",
  "证券营业部",
  "基金管理",
  "律师事务所",
  "会计师事务所",
  "保险区域总部",
  "银行西南分行",
  "联合办公",
  "咨询公司",
  "数据服务中心",
  "信托公司",
  "投资控股"
]

/**
 * 某座塔的楼层表（自下而上：B3…B1、1F…58F），每层：
 *   key 显示名（"B2" / "32F"）、index 楼层序号（B3 = -3，1F = 1）、kind 类型、name 业态 / 租户、
 *   occupancy 入驻率（%，设备层 / 地下为 null）、staff 在岗人数、alarm 告警文字（无则 null）
 */
export function towerFloors(key) {
  const p = PROFILE[key] || PROFILE.tower_S
  const rnd = seeded(p.seed)
  const levels = PARK_TOWERS[key]?.levels || 58
  const out = []
  const BASE = { 3: "水泵房 · 消防水池", 2: "配电房 · 冷冻机房", 1: "地下车库" }
  for (let b = BASEMENT_LEVELS; b >= 1; b--) {
    out.push({
      key: `B${b}`,
      index: -b,
      kind: "basement",
      name: BASE[b],
      occupancy: null,
      staff: Math.round(rnd() * 12),
      alarm: key === "tower_S" && b === 2 ? "低压柜 3# 出线温度过高" : null
    })
  }
  for (let f = 1; f <= levels; f++) {
    let kind = "office"
    let name
    if (f <= 2) {
      kind = "lobby"
      name = "入口大堂"
    } else if (f <= PODIUM_LEVELS) {
      kind = "lobby"
      name = "商业裙楼"
    } else if (PLANT_FLOORS[f]) {
      kind = "plant"
      name = `设备层 · ${PLANT_FLOORS[f]}`
    } else if (f >= levels - 1) {
      kind = "sky"
      name = "空中会所"
    } else {
      name = TENANTS[Math.floor(rnd() * TENANTS.length)]
    }
    // 入驻率：办公层 60～100%，高区略低；裙楼与会所按经营满座率给
    let occupancy = null
    if (kind === "office")
      occupancy = Math.round(Math.min(100, 62 + rnd() * 40 - (f > 45 ? 8 : 0)))
    else if (kind !== "plant") occupancy = Math.round(70 + rnd() * 25)
    if (key === "tower_S" && f === 32) {
      name = "金融科技中心"
      occupancy = 98
    }
    out.push({
      key: `${f}F`,
      index: f,
      kind,
      name,
      occupancy,
      staff:
        occupancy == null
          ? Math.round(rnd() * 6)
          : Math.round((occupancy / 100) * (kind === "lobby" ? 260 : 190)),
      alarm:
        key === "tower_S" && f === 27
          ? "烟感探测器电量低"
          : key === "tower_N" && f === 41
            ? "风机盘管漏水"
            : null
    })
  }
  return out
}

/** 楼宇档案（左上） */
export function towerProfile(key) {
  const p = PROFILE[key] || PROFILE.tower_S
  const t = PARK_TOWERS[key] || {}
  return {
    key,
    name: `成都金融城双子塔 · ${p.short}`,
    short: p.short,
    height: t.height || 218,
    levels: t.levels || 58,
    basement: BASEMENT_LEVELS,
    area: p.area,
    tenants: p.tenants,
    staff: p.staff,
    occupancy: p.occupancy,
    elevators: p.elevators
  }
}

/** 楼宇资产分类（件，演示数据） */
export function towerAssets(key) {
  const k = key === "tower_N" ? 0.93 : 1
  return [
    { name: "暖通空调", value: Math.round(2140 * k), color: "#2f9bff" },
    { name: "安防监控", value: Math.round(1980 * k), color: "#2de2e6" },
    { name: "消防设施", value: Math.round(5120 * k), color: "#ff5a64" },
    { name: "电梯扶梯", value: 28, color: "#ffc65a" },
    { name: "给排水", value: Math.round(860 * k), color: "#3ddc97" },
    { name: "照明配电", value: Math.round(3940 * k), color: "#a77bff" }
  ]
}

/**
 * 电梯初始状态（P 客梯 / F 货梯）：run 运行、idle 待机、repair 检修、fault 故障；
 * 页面上运行 / 待机会定时随机切换，检修与故障保持不变
 */
export function towerElevators(key) {
  const p = PROFILE[key] || PROFILE.tower_S
  const rnd = seeded(p.seed + 100)
  const list = []
  for (let i = 1; i <= p.elevators[0]; i++)
    list.push({ id: `P${String(i).padStart(2, "0")}`, state: "run" })
  for (let i = 1; i <= p.elevators[1]; i++)
    list.push({ id: `F${String(i).padStart(2, "0")}`, state: "run" })
  list.forEach((e) => {
    e.state = rnd() < 0.22 ? "idle" : "run"
    // 运行中的电梯所在楼层，界面上显示
    e.floor = 1 + Math.floor(rnd() * 58)
  })
  // 固定一部检修、一部故障（与告警列表呼应）
  list[key === "tower_N" ? 6 : 9].state = "repair"
  list[key === "tower_N" ? 17 : 21].state = "fault"
  return list
}

/** 分项能耗（今日 MWh，演示数据） */
export function towerEnergy(key) {
  const k = key === "tower_N" ? 0.92 : 1
  return [
    { name: "空调", value: +(8.6 * k).toFixed(1), color: "#2f9bff" },
    { name: "照明插座", value: +(5.1 * k).toFixed(1), color: "#ffc65a" },
    { name: "动力", value: +(3.2 * k).toFixed(1), color: "#3ddc97" },
    { name: "特殊用电", value: +(1.4 * k).toFixed(1), color: "#a77bff" }
  ]
}

/** 今日逐时在岗人数（演示数据）：早 9 点进楼、午间小降、晚 6 点后离楼 */
export function towerStaffCurve(key) {
  const p = PROFILE[key] || PROFILE.tower_S
  return Array.from({ length: 24 }, (_, h) => {
    const day =
      1 / (1 + Math.exp(-(h - 8.6) * 2.2)) -
      1 / (1 + Math.exp(-(h - 18.6) * 1.6))
    const lunch = h === 12 ? 0.9 : 1
    return Math.round(p.staff * (0.03 + 0.97 * day * lunch))
  })
}

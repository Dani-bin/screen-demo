/*
 * 智慧充电站 静态配置
 * ----------------------------------------------------------
 * 与三维模型（scripts/blender/charging/layout.py）一一对应：桩号、车位、设备数量必须一致，
 * 三维场景按这些编号去 GLB 里找对象（pile_B01、bay_B01_N……）。
 * 运行数据全部由 sim/simulator.js 仿真生成，这里只放「不会变」的设定。
 */

export const STATION = {
  name: "光储充超充站智慧运营平台",
  // 设备规模（示范设定）
  pvKwp: 600, // 光伏装机
  essKwh: 2000, // 储能容量
  essKw: 1000, // 储能额定功率
  stationLoadKw: 40 // 站用电（服务楼、照明、监控）
}

/** 分时电价时段（示范设定，非某地真实政策）：[开始小时, 结束小时, 时段] */
export const PERIODS = [
  [0, 7, "valley"],
  [7, 10, "flat"],
  [10, 12, "peak"],
  [12, 17, "flat"],
  [17, 19, "peak"],
  [19, 21, "sharp"],
  [21, 23, "peak"],
  [23, 24, "valley"]
]

/** 各时段电费（元/kWh）与中文名、配色 */
export const PRICE = {
  valley: { name: "谷", fee: 0.32, color: "#34e07a" },
  flat: { name: "平", fee: 0.68, color: "#8aa0bd" },
  peak: { name: "峰", fee: 1.05, color: "#ff9f43" },
  sharp: { name: "尖", fee: 1.25, color: "#ff3b47" }
}

/** 服务费（元/kWh） */
export const SERVICE_FEE = 0.6

/** 全国电网平均排放因子（kgCO₂/kWh，生态环境部 2023 年公布的 2022 年度值） */
export const CO2_FACTOR = 0.5703

/**
 * 充电桩清单：快充 B01–B30（双枪，南北各一个车位 _N / _S），超充 A01–A04（单枪）。
 * gun.id 即车位后缀，三维里对应 bay_<gun.id>
 */
export const PILES = [
  ...Array.from({ length: 30 }, (_, i) => {
    const id = `B${String(i + 1).padStart(2, "0")}`
    return { id, type: "fast", maxKw: 160, guns: [`${id}_N`, `${id}_S`] }
  }),
  ...Array.from({ length: 4 }, (_, i) => {
    const id = `A${String(i + 1).padStart(2, "0")}`
    return { id, type: "super", maxKw: 600, guns: [id] }
  })
]

/** 设备状态面板的设备清单（数量与模型一致） */
export const DEVICES = [
  { key: "pile", name: "充电桩", icon: "PlugZap", total: 34 },
  { key: "ess", name: "储能柜", icon: "BatteryCharging", total: 6 },
  { key: "inverter", name: "光伏逆变器", icon: "SunMedium", total: 6 },
  { key: "transformer", name: "箱式变压器", icon: "Zap", total: 2 },
  { key: "switchgear", name: "配电柜", icon: "Server", total: 6 },
  { key: "camera", name: "视频监控", icon: "Cctv", total: 24 }
]

/**
 * 场景里用到的 Sketchfab 外部模型（经 scripts/blender/charging/vendor.py 减面、换材质后并入 GLB）。
 * CC BY 与 CC BY-NC-SA 都要求署名，页面右下角列出作者，悬停可看完整出处。
 * CC BY-NC-SA 的两款车禁止商用：本项目是非商业演示，转商用前必须替换。
 */
export const MODEL_CREDITS = [
  {
    title: "Tesla Model 3",
    author: "David_Holiday",
    license: "CC BY 4.0",
    url: "https://sketchfab.com/3d-models/tesla-model-3-123c10f376ec4f18b93c73afc382808b"
  },
  {
    title: "Low Poly BMW X6M Competition",
    author: "SharkyStudios",
    license: "CC BY 4.0",
    url: "https://sketchfab.com/3d-models/low-poly-bmw-x6m-competition-dbc45a151624413aac9a378b570ddd02"
  },
  {
    title: "EV Charging Station",
    author: "np-dev",
    license: "CC BY 4.0",
    url: "https://sketchfab.com/3d-models/ev-charging-station-d89eab4c0ffe440db1d126a050e9a0c9"
  },
  {
    title: "2020 Volkswagen e-Lavida PHEV",
    author: "Ddiaz Design",
    license: "CC BY-NC-SA 4.0",
    url: "https://sketchfab.com/3d-models/2020-volkswagen-e-lavida-phev-b7e2c4af0c8241f4905c7b81e88e7c5d"
  },
  {
    title: "2018 Nissan Sylphy EV Zero Emission",
    author: "Ddiaz Design",
    license: "CC BY-NC-SA 4.0",
    url: "https://sketchfab.com/3d-models/2018-nissan-sylphy-ev-zero-emission-593973027771487fb2f1f41d2933c688"
  }
]

/*
 * 综合能源补给站 静态配置
 * ----------------------------------------------------------
 * 与三维模型（scripts/blender/energy/layout.py）一一对应：超充终端编号 C01–C10、加油机 / 加气机数量必须一致，
 * 三维场景按这些编号去 GLB 里找对象（pile_C01、bay_C01……）。
 * 运行数据全部由 sim/simulator.js 仿真生成，这里只放「不会变」的设定（规模均为演示设定）。
 */

export const STATION = {
  name: "综合能源补给站智慧运营平台",
  pvKwp: 420, // 罩棚 + 重卡车棚光伏装机
  chargerKw: 480, // 单台重卡液冷超充终端最大功率
  swapSlots: 13, // 换电站电池仓位
  lngTankM3: 60, // LNG 储罐
  oilTanks: [
    // 埋地油罐：名称、容量（m³）
    { key: "g92", name: "92# 汽油", cap: 30 },
    { key: "g95", name: "95# 汽油", cap: 30 },
    { key: "d0a", name: "0# 柴油 1", cap: 30 },
    { key: "d0b", name: "0# 柴油 2", cap: 30 }
  ],
  cngMaxMpa: 25, // CNG 储气井额定压力
  transformerKva: 2500, // 单台箱变容量（共 2 台）
  safeDaysFrom: "2025-08-20" // 安全运行天数起算日
}

/** 重卡超充终端编号（三维对象 pile_<id> / bay_<id>） */
export const PILE_IDS = Array.from(
  { length: 10 },
  (_, i) => `C${String(i + 1).padStart(2, "0")}`
)

/** 补给类型：面板配色与图例（与三维材质的灯带颜色一致） */
export const KINDS = {
  fuel: { name: "加油", color: "#ff9a3d" },
  gas: { name: "加气", color: "#b48cff" },
  charge: { name: "充电", color: "#3ddc97" },
  swap: { name: "换电", color: "#2de2e6" }
}

/** 设备状态面板的设备清单（数量与模型一致） */
export const DEVICES = [
  { key: "dispenser", name: "加油机", total: 8 },
  { key: "lng", name: "LNG 加气机", total: 4 },
  { key: "cng", name: "CNG 加气机", total: 4 },
  { key: "charger", name: "重卡超充终端", total: 10 },
  { key: "swap", name: "换电站", total: 1 },
  { key: "transformer", name: "箱式变压器", total: 2 },
  { key: "inverter", name: "光伏逆变器", total: 6 },
  { key: "pump", name: "LNG 泵撬", total: 1 }
]

/**
 * 场景里用到的 Sketchfab 外部模型（经 scripts/blender/energy/vendor.py 减面、换材质后并入 vehicles.glb）。
 * 全部为 CC BY 4.0（允许商用，要求署名）：页面右下角列出作者，悬停可看完整出处。
 * 两款小车与 /charging 共用本地模型文件（models/charging/vendor/）
 */
export const MODEL_CREDITS = [
  {
    title: "MAN TGX 2010 V8 – High-Detail Semi-Truck",
    author: "DevPoly3D",
    license: "CC BY 4.0",
    url: "https://sketchfab.com/3d-models/man-tgx-2010-v8-high-detail-semi-truck-34ce748d9a4b4de7b035cfe5cb97f5d1"
  },
  {
    title: "Mercedes-Benz Actros MP4 2016",
    author: "szymonpasterczyk734",
    license: "CC BY 4.0",
    url: "https://sketchfab.com/3d-models/mercedes-benz-actros-mp4-2016-314722c6a2f9471c99289d4ae55ef232"
  },
  {
    title: "Semi Trailer",
    author: "NoblecatSoft",
    license: "CC BY 4.0",
    url: "https://sketchfab.com/3d-models/semi-trailer-f507a422e9344e76934c5fbf06eb81d7"
  },
  {
    title: "Gas Tanker",
    author: "Unknown Canadian",
    license: "CC BY 4.0",
    url: "https://sketchfab.com/3d-models/gas-tanker-055c6431cdaa440f85e2ac588c4a5ea8"
  },
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
  }
]

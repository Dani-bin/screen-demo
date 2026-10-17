/*
 * 候诊大厅 三维场景的配色与尺寸
 * ----------------------------------------------------------
 * 以设计稿 docs/design/waiting/13-style-e-candy.png（E 缤纷等距插画）为准：
 * 奶油色地砖、白墙浅蓝踢脚、诊室按科室铺糖果色地面、蓝色连排椅、大头卡通小人；
 * 诊室上方的三色状态柱（待诊 / 复诊 / 过诊）带深色描边；橙色只表示"叫号"，紫色是轮播中的诊室。
 * 场景只定风格；房间、墙、家具、座椅的位置都按 CAD（data/plan.json）来。
 */
export const THEME = {
  wallH: 1.4, // 诊室前墙 / 隔墙剖切高度（矮一点，镜头才看得见室内）
  extH: 2.6, // 外墙高度（带窗）
  sill: 0.9, // 窗台
  head: 2.25, // 窗顶
  slab: 0.7, // 楼板厚（圆角厚边，像一块玩具底座）
  colH: 2.1, // 结构柱高度
  furnH: 0.75, // 桌面 / 柜台高度
  unit: 0.24, // 状态柱：每人多高（米）
  colBase: 2.85, // 状态柱底离地高度（外墙顶之上）
  modelSeat: 0.34, // Blender 人物按 Q 版小椅子建模时的座面高（scripts/blender/waiting/people.py 的 SEAT）
  personScale: 0.45 / 0.34, // 放大到真实座面 0.45 m：腿短、头大，全景时也认得出

  colors: {
    floor: "#FFF4E2", // 公共区地砖
    tileLine: "#F1E2C8",
    slabSide: "#E9DCC6",
    slabEdge: "#D9C8AC",
    wall: "#FFFFFF",
    skirt: "#9CC3F5", // 墙脚浅蓝条
    wallTop: "#F4F1FF",
    column: "#FFFFFF",
    columnBand: "#9CC3F5",
    glass: "#BFE3FF",
    wood: "#F2C994", // 桌面
    door: "#E8A864",
    doorWin: "#9CCBFF",
    furn: "#FFFFFF",
    counterBand: "#9CC3F5",
    seat: "#5E7FE6", // 连排椅
    seatFrame: "#B9C2D6",
    chair: "#6F8EF0",
    bed: "#7DB4F7",
    bedFrame: "#FFFFFF",
    monitor: "#2E3150",
    screen: "#8FD3FF",
    pot: "#FFFFFF",
    leaf: "#4CC777",
    leaf2: "#2FAE60",
    aux: "#EEE8FA", // 辅助用房地面
    stair: "#FBE7B5",
    wc: "#CFEFF3",
    rail: "#BFE3FF",
    // 状态色（与面板一致）
    wait: "#3B82F6",
    recheck: "#A855F7",
    missed: "#F43F5E",
    outline: "#231942",
    brand: "#6C5CE7",
    call: "#FF7A00",
    callFloor: "#FFC68C"
  },

  // 相机：正交，从北往南斜上方看（东侧的 213 在画面左边）
  camera: { elevation: 40, padding: 1.02, focusHalfW: 11.5 },

  // 轮播节奏（毫秒）
  tour: { room: 8000, overview: 10000, call: 6000, idle: 30000, fly: 1400 }
}

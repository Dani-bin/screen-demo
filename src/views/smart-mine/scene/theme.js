/*
 * 智能矿山（West Elk 煤矿）三维场景的配色、镜头与各专题的显示方式
 * ----------------------------------------------------------
 * 镜头参数：tx / ty = 目标点局部坐标（米，x 向东、y 向北），lift = 目标点相对地表的升降（米），
 * az = 镜头相对目标点的方位（从北顺时针），pitch = 俯角，dist = 距离；与设计稿 docs/design/smart-mine/scene.js 一致
 */

/** 竖向放大：原始落差约 970 m / 12 km，放大 1.35 倍山体更立体又不失真 */
export const EXAG = 1.35

/** 航拍影像拍摄时的太阳方向（夏季上午，东南，高度角约 55°）：地表补光与影像里的阴影一致 */
export const SUN = { az: 140, el: 55 }

/** 显示时煤层最少加粗到这么厚（米），否则全景下不到一个像素 */
export const SEAM_MIN = 16

export const COLORS = {
  background: ["#14304f", "#0a1a30", "#030912"],
  haze: "#7f9cc0",
  intake: "#38c8ff",
  ret: "#ff6a5a",
  incline: "#ffd23a",
  old: "#7d8aa0",
  goaf: "#8c7fb8",
  goafOld: "#6d6a86",
  active: "#ff9a3d",
  face: "#ff7a2a",
  ready: "#53e8f0",
  well: "#c6ff5a",
  ok: "#3ddc97",
  warn: "#ffcf3a",
  alarm: "#ff4d5a",
  person: "#9fd8ff"
}

/** 辉光：只让巷道、工作面、钻孔等发光体泛光，地表影像不泛光 */
export const BLOOM = { strength: 0.55, radius: 0.5, threshold: 0.92 }

/**
 * 专题：block 用哪块地形（overview 全景 / closeup 工业广场近景），mode 默认显示方式
 * （surface 地表实景 / ghost 透视井下 / section 剖切），overlay 地表上的采区投影，flow 巷道风流动画是否加强
 */
export const VIEWS = {
  overview: {
    block: "overview",
    mode: "surface",
    overlay: 1,
    cam: { tx: 350, ty: -200, lift: 0, az: 50, pitch: 34, dist: 27500 }
  },
  underground: {
    block: "overview",
    mode: "ghost",
    overlay: 0,
    cam: { tx: 2300, ty: -2700, lift: -300, az: 35, pitch: 42, dist: 13500 }
  },
  plant: {
    block: "closeup",
    mode: "surface",
    overlay: 0,
    // 俯角 46°：无头 Chrome 用 GPU 截这个角度会卡住，截图时加 CHROME_FLAGS="--use-angle=swiftshader"
    cam: { tx: 620, ty: 2150, lift: 0, az: 12, pitch: 46, dist: 3400 }
  },
  ventilation: {
    block: "overview",
    mode: "ghost",
    overlay: 0,
    flow: 1,
    cam: { tx: 1300, ty: -2400, lift: -350, az: 58, pitch: 46, dist: 9800 }
  },
  production: {
    block: "overview",
    mode: "surface",
    overlay: 1,
    cam: { tx: 1300, ty: -400, lift: 0, az: 28, pitch: 36, dist: 21000 }
  }
}

/** 剖切：沿在采工作面中线（东西向）切开，镜头从北面看切面 */
export const SECTION_CAM = { az: 8, pitch: 28, dist: 5400, lift: 220 }

/** 镜头限制：全景按公里尺度、近景按百米尺度 */
export const CONTROL_LIMITS = {
  overview: { minDistance: 3000, maxDistance: 42000 },
  closeup: { minDistance: 500, maxDistance: 7000 }
}

/** 空闲多久（秒）后镜头开始缓慢摆动，摆幅（度）与周期（秒） */
export const SWAY = { idle: 25, amp: 6, period: 80 }

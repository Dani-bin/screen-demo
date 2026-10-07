/*
 * 智慧充电站 三维场景主题常量
 * ----------------------------------------------------------
 * 颜色与设计稿 / Blender 材质一致；坐标为 three.js 世界坐标（x 东、y 上、z 南，单位米）。
 * Blender 坐标 (bx, by, bz) 导出后为 (bx, bz, -by)，下面的路径都已换算。
 */

/** 桩 / 车位状态色：充电中绿、空闲蓝、故障红、离线灰；arriving / full / leaving 沿用相近色 */
export const STATUS_COLOR = {
  charging: 0x34e07a,
  idle: 0x2f9bff,
  fault: 0xff3b47,
  offline: 0x5d6876,
  arriving: 0x2de2e6,
  full: 0x34e07a,
  leaving: 0x2f9bff
}

/** 自发光强度：与 Blender 导出的 emissive_strength 同量级，离线压暗 */
export const STATUS_INTENSITY = { offline: 0.3, default: 1.25 }

/** 车漆颜色（与 scripts/blender/charging/palette.py 的 M_paint_* 一致）；cars.glb 里车漆统一叫 M_car_paint，运行时换成这些颜色 */
export const PAINT_COLOR = {
  black: 0x16191e,
  graphite: 0x3a414b,
  silver: 0xa7afb8,
  white: 0xe9edf1,
  blue: 0x2c4f7a,
  red: 0x7a2a30
}

export const THEME = {
  // 快充状态图标：挂在雨棚南檐口外（layout.py 的 CANOPY_W = 11.2 → 中线以南 5.6 m），略低于檐口
  badge: { eaveY: 5.2, eaveZ: 6.4, fast: 1.25 },
  background: 0x040a15,
  /**
   * 场站在画面里的目标区域（设计稿 1920×1080 的像素坐标）：左右各让出 440px 面板、
   * 底部让出 200px 通栏，场站居中落在这个框里
   */
  fit: { x: 450, y: 80, w: 1020, h: 790 },
  /** 正交相机方位：从西南上方俯瞰，与 Blender 预览、设计稿一致（度） */
  camera: { azimuth: -128, elevation: 36 },
  /** 场地范围（three 坐标）：x -48..30，z -36..28（Blender y 36..-28） */
  site: { x0: -48, x1: 30, z0: -36, z1: 28, base: 3.2, corner: 6 },
  /**
   * 发光与辉光（对照设计稿：灯带是清晰的细线，光晕只是淡淡一层）
   * bloom：辉光强度 / 半径 / 阈值（亮度超过阈值的部分才会泛光）
   * edgeTop / edgeBottom：沙盘顶边、底边细灯带的自发光强度
   * emissiveScale：其余自发光（楼宇轮廓、围栏、雨棚灯带等）相对 Blender 强度的倍数
   * edgeColor / wallWash / floorHalo：侧壁底部泛光、地面轮廓光晕的颜色与不透明度；pool：沙盘下方大片光晕
   */
  glow: {
    bloom: { strength: 0.32, radius: 0.2, threshold: 1.2 },
    edgeTop: 1.9,
    edgeBottom: 1.4,
    emissiveScale: 0.22,
    edgeColor: 0x2a7fff,
    wallWash: 0.55,
    floorHalo: 0.42,
    pool: 0.28
  },
  /** 空闲时镜头左右缓慢摆动的幅度（度）与周期（秒）；人工操作后多少秒恢复 */
  sway: { amp: 14, period: 48, idle: 15 },
  /** 车辆进出站的滑行距离（米）与时长（秒） */
  drive: { dist: 7.5, dur: 3 }
}

/**
 * 能量流动路径（地面流光）：颜色与面板一致。
 * 电网（箱变）→ 母线 → 各雨棚 / 超充；储能 → 母线；光伏（雨棚）→ 储能
 */
export const FLOWS = [
  // 电网：箱变 1 南侧 → 沿能源区南侧向西 → 快充区东侧主通道南下
  {
    color: 0xff9f43,
    pts: [
      [13, -29.6],
      [13, -25.6],
      [-12.6, -25.6],
      [-12.6, 19.6]
    ]
  },
  // 电网 → 超充桩岛北侧
  {
    color: 0xff9f43,
    pts: [
      [-12.6, 1.8],
      [16.2, 1.8]
    ]
  },
  // 储能 → 母线
  {
    color: 0x34e07a,
    pts: [
      [2.6, -29.4],
      [2.6, -25.6]
    ]
  },
  // 光伏：三排雨棚东端 → 母线
  {
    color: 0xf5c242,
    pts: [
      [-15.2, -24],
      [-12.6, -24]
    ]
  },
  {
    color: 0xf5c242,
    pts: [
      [-15.2, -6],
      [-12.6, -6]
    ]
  },
  {
    color: 0xf5c242,
    pts: [
      [-15.2, 12],
      [-12.6, 12]
    ]
  }
]

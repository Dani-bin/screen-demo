/*
 * 综合能源补给站 三维场景主题常量
 * ----------------------------------------------------------
 * 坐标为 three.js 世界坐标：x 沿门前道路（北端为 +x）、y 向上、z 指向道路一侧，单位米。
 * 规划米坐标 (u 沿路向南, v 向场内) 换算：x = 110 - u，z = 40 - v（见 scripts/blender/energy/layout.py）。
 */

/** 超充位状态色：充电中绿、空闲蓝、告警红；进站 / 离站沿用相近色 */
export const STATUS_COLOR = {
  charging: 0x34e07a,
  idle: 0x2f9bff,
  fault: 0xff3b47,
  arriving: 0x2de2e6,
  leaving: 0x2f9bff
}

/** 状态描边 / 桩灯的自发光强度 */
export const STATUS_INTENSITY = 1.25

/** 车漆颜色：小车与重卡驾驶室分别抽取 */
export const CAR_PAINTS = [
  0xe9edf1, 0xa7afb8, 0x16191e, 0x3a414b, 0x2c4f7a, 0x7a2a30
]
export const TRUCK_PAINTS = [
  0xe9edf1, 0x2c5d9e, 0xb8352f, 0x2f8f5b, 0xd9a420, 0xe9edf1
]
/** 停车场常驻车辆：设计稿里多是白、银、黑、深灰 */
export const PARKED_PAINTS = [
  0xe9edf1, 0xe9edf1, 0xc4cad1, 0xa7afb8, 0x16191e, 0x3a414b
]
/** 厢式挂车车厢：以白色为主，少量浅灰、蓝、橙 */
export const TRAILER_PAINTS = [
  0xeef1f4, 0xeef1f4, 0xeef1f4, 0xc9d0d8, 0x2c5d9e, 0xd9822b
]

export const THEME = {
  background: 0x040a15,
  /**
   * 正交相机方位（度，Blender 约定：0 为 +x，逆时针）与俯角：由设计稿 01-ai-overview.png 标定
   * （罩棚屋面、车位前沿等矩形反求，误差约 3 px）——从门前国道一侧、偏东端斜上方看，
   * 小车区在左、重卡区在右，国道在前景
   */
  camera: { azimuth: -47.06, elevation: 23.66 },
  /**
   * 画面映射：世界坐标 anchor（场站中部地面一点）落在设计稿 1920×1080 的像素 at 处，scale 为像素 / 米。
   * 设计稿 01 在整屏效果图里放在 left 412、top 82、宽 1096（drafts-source.html），按同样的位置换算
   */
  view: { anchor: [-8.03, 0, 27.28], at: [960.0, 390.25], scale: 5.9435 },
  /**
   * 页面上在设计稿映射基础上再平移的像素（设计稿 1920 宽）：场站整体下移一点，上方标签离顶栏远些、
   * 下方空白少些。与设计稿叠图对比时用 capture.mjs --design-frame 把它归零
   */
  viewShift: [0, 28],
  /** 雾：远山与村庄按深度隐入夜色（镜头距目标 500 m）；颜色与强度对照设计稿实测 */
  fog: { near: 520, far: 720, color: 0x0e1b2c }, // 雾色比背景略亮略蓝：远山在设计稿里是深蓝灰（约 14,24,37），不是纯黑
  base: 4.0, // 沙盘底座厚度（与 layout.py 的 BASE_DEPTH 一致）
  glow: {
    bloom: { strength: 0.42, radius: 0.22, threshold: 1.0 },
    emissiveScale: 0.3, // Blender 自发光强度在 three 里整体压低的倍数
    edge: 2.2, // 沙盘顶边灯带
    pool: 0.16, // 沙盘下方大片蓝色光晕
    edgeColor: 0x2a7fff,
    wallWash: 0.7, // 侧壁底部向上渐隐的蓝光
    floorHalo: 0.5, // 底座周围地面的一圈光晕
    /** 单独给绝对自发光强度的材质（设计稿里最亮的几样） */
    override: {
      M_light_cool: 0.9, // 罩棚棚底整片灯面（再亮辉光会把整个罩棚糊成白团，盖住檐口彩色灯带）
      M_led_canopy: 1.8, // 加油加气罩棚青蓝色檐口（再亮辉光会把整片站坪染成青色，设计稿站坪是暖白）
      M_led_fuel: 3.0, // 加油机顶部橙色灯带
      M_led_lng: 4.0, // LNG 罩棚紫色檐口
      M_led_green: 2.6, // 重卡车棚绿色灯带
      M_led_swap: 2.8,
      M_light_warm: 3.0, // 路灯灯头
      M_window: 1.3, // 办公楼窗带
      M_store: 0.75, // 便利店橱窗（暖光玻璃；再亮会泛白过曝，设计稿一层是暖光）
      M_leaf_lit: 0.35, // 树下有投光的树：叶片微微泛暖黄
      M_house_light: 2.2 // 远山村庄窗光
    }
  },
  /**
   * 光伏板的天光反射：夜景里光伏板映着天空泛蓝（设计稿实测约 60,83,121），
   * 实时环境反射太弱，用一层均匀的蓝色自发光近似：[颜色, 强度]
   */
  pvSheen: [0x527199, 0.68],
  /** 不受雾影响的材质：远山村庄的窗光要在夜色里透出来 */
  noFog: ["M_house_light"],
  /** 地面（烘焙贴图）：显示亮度、湿润反光的粗糙度与环境反射强度 */
  ground: { intensity: 0.95, roughness: 0.32, env: 0.55 },
  /**
   * 罩棚 / 车棚下的实时面光：[灯面对象名, 强度]。只为照亮棚下的加油机、立柱与车辆——
   * 它在湿润（低粗糙度）地面上的高光会把整片站坪刷白，所以强度压得很低（对照设计稿实测）
   */
  canopyLights: [
    ["canopy_fuel_light", 1.5],
    ["canopy_lng_light", 1.5],
    ["carport_light", 1.2]
  ],
  /** 空闲时镜头左右缓慢摆动的幅度（度）与周期（秒）；人工操作后多少秒恢复 */
  sway: { amp: 6, period: 56, idle: 15 }, // 摆幅过大时两端会转到左右面板下面
  /** 车速（m/s）：门前国道、站内；加减速度（m/s²） */
  drive: { road: 12, site: 5.5, acc: 2.2, dec: 3.0 }
}

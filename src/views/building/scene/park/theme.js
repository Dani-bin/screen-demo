/*
 * 园区级三维场景 主题常量
 * ----------------------------------------------------------
 * 坐标：three.js 世界坐标（x 东、y 上、z 南，单位米），原点为双子塔两楼中点；
 * 由 Blender（x 东、y 北、z 上）导出时换算：three (x, y, z) = blender (x, z, -y)。
 */

export const THEME = {
  background: 0x020a1c,
  /**
   * 相机：方位角 / 俯角与 Blender 预览一致（scripts/blender/park/preview.py：azimuth -25°、elevation 35°，从东南偏东俯瞰）。
   * 塔身左右两条金色描边按这个方位角放在轮廓处（buildings.py 的 _silhouette_ends），改方位角要同步改那里并重新导出。
   * 透视相机用小视场角近似设计稿的等轴测；target 为园区中部偏东（three 坐标），抬高 55 m 让画面整体下移、塔顶不顶到面包屑。
   * fit：沙盘投影后在画面里占的宽度比例。真实园区约 500 × 810 m，取景太远细节读不出来，
   * 所以让沙盘两端稍微伸到两侧面板下面（画布两侧压了暗色渐变，见 ParkLevel.vue 的 .stage::after）
   */
  camera: {
    azimuth: -25,
    elevation: 35,
    fov: 24,
    target: [140, 55, 10],
    fit: 0.66
  },
  /** 交互：方位角可在初始值 ±35° 内转动；空闲多少秒后缓慢回到初始视角 */
  orbit: { azimuthRange: 35, minPolar: 30, maxPolar: 68, idle: 12 },
  /**
   * 自发光强度：按材质名重设（Blender 里按 Eevee 调的值在 three 里偏亮）。
   * 原则：只有「真正的光源」超过辉光阈值——通明的窗、路灯头、地灯头、金色轮廓；
   * 沙盘描边、车道线只做细线，不泛光。窗灯贴图分四档亮度（见 scripts/blender/park/palette.py），
   * 强度放大后只有通明档与零星亮窗会泛光，其余楼层保持暗、微亮
   */
  emissive: {
    M_tower_gold: 1.3,
    M_tower_crown: 0.5,
    M_roof_edge: 0.22,
    M_slab_edge: 0.8,
    M_lane_cyan: 0.25,
    M_lamp_head: 2.4,
    M_bollard_head: 2.0,
    M_lobby: 0.9,
    M_hall_glass: 1.0,
    M_tower_glass: 1.6,
    M_pebble_glass: 1.5
  },
  /** 烘焙地面提亮倍数：烘焙时已压暗环境光、加强路灯 / 地灯，这里只轻微提亮，保留明暗对比 */
  groundGain: 1.4,
  /**
   * 树：颜色来自顶点色（体积明暗已烘在里面）；每棵树再乘一个实例色：
   * 个体亮度差 jitter，以及按到路灯 / 地灯的距离算出的暖色受光（sigma 为影响半径，米）
   */
  tree: {
    // 整体提亮：顶点色按白天的叶色给，夜景里只靠天光照不亮
    base: 1.7,
    jitter: 0.16,
    warm: [1.0, 0.62, 0.18],
    lamp: { sigma: 11, gain: 1.1 },
    bollard: { sigma: 5, gain: 0.6 }
  },
  /** 楼体底部的暖色泛光（地灯、大堂灯照亮墙根）：颜色、强度、衰减高度（米） */
  wash: { color: [1.0, 0.62, 0.32], strength: 0.2, height: 9 },
  /** 夜雾：指数雾密度，远处楼与沙盘边缘略微融进夜色，增加纵深 */
  fog: 0.00022,
  bloom: { strength: 0.42, radius: 0.32, threshold: 0.92 },
  exposure: 1.0,
  /** 高亮色：塔楼金色，其余楼栋青色 */
  highlight: { tower: 0xffc65a, other: 0x37e4ff },
  /** 车流：车距（米 / 车道）、车速范围（米 / 秒） */
  traffic: { spacing: 34, speed: [9, 15] }
}

/**
 * 智慧社区沙盘：主题与常量
 * ----------------------------------------------------------
 * 三维场景直接复用 /estate（澜岸云境）的 Blender 楼栋、地面、树、水和灯光（见 CommunityScene.js），
 * 所以坐标系就是 /estate 的：平面米，x 向东、y 向北，原点在地块中心；three.js 里 X = x、Z = −y、Y 向上。
 * 沙盘竖向不夸张（V = 1）：楼是真实高度，无人机高度也是真实高度。
 * 主机位（data/camera.json）是 /estate 定稿机位沿视线拉近后的结果，让 16 栋楼落在两侧栏之间。
 */
import cam from "../data/camera.json"

/** 竖向倍数（保留这个常量让无人机、信息层的代码不用改） */
export const V = 1
/** 平面原点偏移：和 /estate 一样不偏移 */
export const CX = 0
export const CY = 0

export const THEME = {
  camera: cam.three,
  designSize: [1920, 1080],

  // 成都经纬度和设计日（北京时间）
  site: { lat: 30.67, lon: 104.07, tz: 8 },
  month: 11,
  day: 4,

  color: {
    ivory: 0xe9e2d0,
    gold: 0xc9a86a,
    goldHi: 0xffd27a,
    warn: 0xe8b04a,
    alarm: 0xff5a5f,
    stale: 0x8f8372,
    // 三机身份色（dataviz 校验过的 #3987e5 / #199e70 / #9085e9）与场景里发光用的提亮版
    uav: ["#3987e5", "#199e70", "#9085e9"],
    uavGlow: ["#7cc0ff", "#4ee0a8", "#b9b0ff"]
  },

  // 无人机在沙盘上的显示尺寸（含旋翼的总宽，m）：真实约 0.6–1 m，沙盘里放大约 30 倍才在 1920 屏上有 70–85 px 宽；
  // 停在会所屋顶时三架只隔 13 m，所以落地后缩到 landedScale 倍（drones.js）
  droneSpan: { "UAV-01": 24, "UAV-02": 20, "UAV-03": 18 },
  landedScale: 0.5
}

/** 平面坐标 (x, y) + 高度 → three.js 世界坐标 */
export const toWorld = (x, y, h = 0) => [x - CX, h, -(y - CY)]

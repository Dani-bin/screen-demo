/**
 * 楼盘沙盘：主题与常量
 * ----------------------------------------------------------
 * 还原基准：docs/design/estate/design/final.png（风格 A 展厅暖光 · 象牙白实体沙盘）。
 * 主机位来自 data/camera.json（定稿反求，固定视场角 28°），不要手调。
 * 坐标：布局用平面米（x 向东、y 向北，原点在地块中心），three.js 里 x = x、z = -y，y 向上。
 */
import cam from "../data/camera.json"

export const THEME = {
  // 主机位（three.js 坐标）和定稿画面尺寸；焦距按定稿像素算，随舞台缩放
  camera: cam.three,
  designSize: [1920, 1080],
  fov: cam.fovDeg,

  // 沙盘底座：椭圆（定稿概念图里东西约 570 m、南北约 370 m），中心和半轴（平面米），厚度 30 m
  base: { cx: 10, cy: -6, rx: 285, ry: 208, depth: 30 },

  // 成都经纬度和设计日（北京时间），太阳位置由它们算出
  site: { lat: 30.67, lon: 104.07, tz: 8 },
  designAt: "2026-10-30T18:00:00+08:00",

  // 颜色
  color: {
    ivory: 0xe9e2d0,
    gold: 0xc9a86a,
    goldHi: 0xffd27a,
    lake: 0x3f96d4
  },
  // 销售状态（楼栋插牌、信息卡）
  sale: { open: 0xe9e2d0, hot: 0xe8b04a, out: 0x7e7a72 },

  // 相机限制（相对主机位）：沙盘可以环绕、缩放，但不能钻到底座下面
  controls: {
    minDistance: 110,
    maxDistance: 1250,
    minPolar: (12 * Math.PI) / 180,
    maxPolar: (74 * Math.PI) / 180
  },

  // 整体压暗系数：灯光（太阳、半球、补光、展厅主光）乘它；窗光、灯池、水面是自发光，不受它影响，所以暗下来之后它们更跳
  dim: 0.7,

  // 窗灯、路灯、LED 的点亮曲线：太阳高度角（度）低于 onFrom 开始亮，低于 onFull 全亮
  lights: { onFrom: 9, onFull: -2 }
}

/** 平面坐标 (x, y) → three.js 世界坐标 */
export const toWorld = (x, y, h = 0) => [x, h, -y]

/*
 * 带式输送机孪生 · 三维主题
 * ----------------------------------------------------------
 * 颜色全部取自定稿的设计令牌（docs/design/smart-conveyor/design/src/tokens.no-convert.css），界面和三维共用一套状态色。
 * 主机位 = 从定稿概念图反求的相机（data/camera.json，scripts/smart-conveyor/fit_camera.py），不要手调。
 */
import camera from "../data/camera.json"

export const TOKENS = {
  bg: "#05070b",
  coal: "#ffb23e",
  coal2: "#ff8a1f",
  data: "#3de0ff",
  predict: "#a78bfa",
  ok: "#34d399",
  l1: "#f43f5e",
  l2: "#fb923c",
  l3: "#facc15",
  l4: "#60a5fa",
  off: "#5b6577"
}

/** 告警级别（0 = 一级）→ 颜色 */
export const LEVEL_COLOR = [TOKENS.l1, TOKENS.l2, TOKENS.l3, TOKENS.l4]

export const THEME = {
  background: TOKENS.bg,
  exposure: 1.0,
  // 远景雾：只压暗块的远端（左端离镜头远），不压近处
  fog: { color: "#05070b", near: 5200, far: 14000 },
  bloom: { strength: 0.55, radius: 0.2, threshold: 0.92 },
  camera,
  // 定稿里概念图在整屏中的位置（设计稿像素），用于把投影中心对到那块区域
  imageCenter: [
    camera.place.x + (camera.image[0] / 2) * camera.scale,
    camera.place.y + (camera.image[1] / 2) * camera.scale
  ],
  // 设计稿像素下的焦距
  focalDesign: camera.focalPx * camera.scale,
  strata: {
    base: "#3c3e43", // 岩层底色（石墨，偏暖一点的深灰岩石）
    band: "#5a5d63", // 浅一点的岩层带
    seam: "#151618", // 煤层（更暗）
    line: "#8cc4dc", // 岩层分界线、等高线（冷灰青）
    edge: "#9fdcf0", // 块边缘高光
    opacity: 0.72 // 烟色玻璃：先画块，巷道和皮带画在上面，不被压暗
  },
  tunnel: { rim: TOKENS.data, opacity: 0.015, rimStrength: 0.25, radius: 22 },
  belt: {
    radius: 10, // 煤流光管半径（示意尺度，m）
    coal: TOKENS.coal,
    hot: "#ffc870",
    idle: "#2a1d0c",
    fault: TOKENS.l1,
    glow: 3.4 // 满载时的自发光强度（> 1 才进辉光）
  },
  surface: {
    ground: "#8a8c90",
    building: "#3e444c",
    edge: TOKENS.data,
    lamp: "#ffd9a0"
  }
}

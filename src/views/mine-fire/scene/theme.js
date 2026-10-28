/*
 * /mine-fire 三维主题：颜色取自定稿令牌（docs/design/mine-fire/design/src/tokens.no-convert.css），
 * 主机位取自定稿概念图反求的相机（data/camera.json）。
 * 尺度：平面 1 单位 = 1 米；煤层顶面 y = 0。全矿 8 km 见方，巷道、硐室按"看得见"放大显示（见 size）。
 */
import camera from "../data/camera.json"

export const THEME = {
  background: "#020a16",
  exposure: 1.0,
  // 辉光只给真实光源和发光边（阈值以上）
  bloom: { strength: 0.42, radius: 0.4, threshold: 0.95 },

  // 主机位（定稿概念图反求）：透视 20°，正南看正北
  camera,
  focalDesign: camera.focalDesign,
  imageCenter: camera.imageCenter,

  color: {
    brand: "#2bd9fe",
    route: "#39f08a",
    fire: "#ff3b30",
    warn: "#facc15",
    ok: "#34d399",
    fault: "#fb923c",
    off: "#5b6577",
    rock: "#11171e",
    rockHi: "#2d343c",
    edge: "#9fd8ff",
    // 三维玻璃管用的青色：概念图里的管道比面板主色 #2bd9fe 偏蓝白，单独取一档（比对 ΔE 后定）
    tube: "#5cc8ff"
  },

  // 显示尺寸（米）：真实巷道宽约 5 m，在 6 km 的画面里看不见，按概念图放大
  size: {
    seamThick: 180, // 煤层板厚
    tubeH: 36, // 走廊高
    tubeW: (lanes) => 40 + lanes * 16, // 走廊宽：随并行巷道数加宽
    sink: 8, // 走廊下沉进煤层的深度
    panelTube: 24, // 工作面顺槽宽
    chamber: [380, 170, 200], // 硐室玻璃房 长 × 宽 × 高（真实 44 × 6 m，按概念图放大约 8×）
    refuge: [420, 88], // 避难硐室胶囊 长 × 半径
    shaftR: 40,
    shaftH: 1000,
    person: 5.5 // 人员光点像素直径（CSS 像素）
  }
}

/** 平面坐标 [e, n] → three.js 位置（x = e，z = -n） */
export function toXZ(p) {
  return [p[0], -p[1]]
}

/*
 * 智慧牧场 三维沙盘主题
 * ----------------------------------------------------------
 * 三个设计方向（docs/design/smart-ranch/02-research.md「三个风格方向」）：
 *   a 晴空牧场：白天写实，浅色天空底，沙盘薄侧壁 + 接触阴影
 *   b 墨绿遥感：深色克制，影像压暗降饱和，沙盘四边羽化进暗色背景，不发光
 *   c 金色牧歌：黄昏低光，掠射光放大缓丘，实心底座画草皮 / 黑钙土 / 黄土三层
 * 颜色都写 sRGB 十六进制，着色器里按线性空间混合。
 */

/*
 * fog 的 near / far 是相机到观察点距离的倍数（镜头拉远拉近时雾的观感不变），max 为最大浓度
 */

/** 长势色带：NDVI → 颜色（褐 → 黄 → 绿），7 月草场 NDVI 多在 0.6–0.8，色带要覆盖到 0.85 才拉得开 */
export const NDVI_RAMP = [
  [0.2, "#8a6a3a"],
  [0.35, "#c2a560"],
  [0.5, "#d9d27a"],
  [0.6, "#9cc45a"],
  [0.7, "#55a03c"],
  [0.82, "#1f6b25"]
]

export const THEMES = {
  a: {
    name: "晴空牧场",
    // 竖向放大：沙盘高差约 270 m / 12 km，放大后缓丘才看得出来
    exag: 2.4,
    // 太阳（方位角从北顺时针、高度角）：上午东南方，和影像本身的光照方向一致
    sun: { az: 135, el: 42, color: "#fff6e8", intensity: 1.05 },
    ambient: { sky: "#dbe8f5", ground: "#c9c2a8", intensity: 0.62 },
    // 牧场外：降饱和、压暗
    outside: { desat: 0.55, dim: 0.18 },
    ndviMix: 0.45,
    fog: { color: "#dfe9f1", near: 1.0, far: 1.9, max: 0.45 },
    edge: {
      kind: "wall",
      top: "#6d7a4a",
      soil: "#5a4632",
      loess: "#c9b48a",
      depth: 160,
      feather: 0
    },
    shadow: { color: "#3b4a3a", opacity: 0.28 },
    exposure: 1.0,
    lines: {
      paddock: "rgba(255,255,255,0.78)",
      grazing: "#2b7bd6",
      next: "#2b7bd6",
      hatch: "rgba(255,255,255,0.35)",
      reserve: "rgba(43,123,214,0.55)",
      text: "rgba(255,255,255,0.92)",
      textShadow: "rgba(20,40,30,0.75)"
    },
    animal: { sheep: "#ffffff", cattle: "#4a2f1f", alarm: "#e5484d" },
    alarm: "#e5484d"
  },
  b: {
    name: "墨绿遥感",
    exag: 2.2,
    sun: { az: 135, el: 38, color: "#e8f0e6", intensity: 0.9 },
    ambient: { sky: "#6d8b7a", ground: "#2a3a30", intensity: 0.45 },
    outside: { desat: 0.8, dim: 0.55 },
    ndviMix: 0.5,
    fog: { color: "#0b1511", near: 0.95, far: 1.6, max: 0.85 },
    edge: { kind: "feather", feather: 0.06, depth: 0 },
    shadow: null,
    exposure: 0.92,
    lines: {
      paddock: "rgba(243,238,223,0.45)",
      grazing: "#c6f25b",
      next: "#c6f25b",
      hatch: "rgba(243,238,223,0.22)",
      reserve: "rgba(93,179,172,0.55)",
      text: "rgba(243,238,223,0.9)",
      textShadow: "rgba(0,0,0,0.8)"
    },
    animal: { sheep: "#f3eedf", cattle: "#ffd9a0", alarm: "#ff6b3d" },
    alarm: "#ff6b3d"
  },
  c: {
    name: "金色牧歌",
    exag: 2.6,
    // 黄昏：西北方低太阳（夏季日落方位约 305°），掠射光把缓丘的起伏拉出来
    sun: { az: 300, el: 11, color: "#ffc27a", intensity: 1.35 },
    ambient: { sky: "#8c88a6", ground: "#6b5a3a", intensity: 0.42 },
    outside: { desat: 0.35, dim: 0.28 },
    ndviMix: 0.4,
    fog: { color: "#e9b98a", near: 0.9, far: 1.8, max: 0.55 },
    edge: {
      kind: "wall",
      top: "#4d5a2a",
      soil: "#3a2a1d",
      loess: "#b8925c",
      depth: 220,
      feather: 0
    },
    shadow: { color: "#2a2016", opacity: 0.4 },
    exposure: 1.0,
    lines: {
      paddock: "rgba(255,236,200,0.6)",
      grazing: "#e6b54a",
      next: "#e6b54a",
      hatch: "rgba(255,236,200,0.28)",
      reserve: "rgba(93,179,172,0.6)",
      text: "rgba(255,240,215,0.95)",
      textShadow: "rgba(40,25,10,0.8)"
    },
    animal: { sheep: "#fff4e0", cattle: "#3b2414", alarm: "#f0502e" },
    alarm: "#f0502e"
  }
}

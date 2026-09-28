/*
 * 缤纷插画风 视觉与相机参数
 * ----------------------------------------------------------
 * 调色、改尺寸、调光照、改巡览节奏只改这一个文件。
 * 颜色为 sRGB 十六进制，长度单位为米，角度单位为度。
 */
export const THEME = {
  /* ---- 环境 ---- */
  background: "#f6f3ec",
  ground: "#efe9dd",
  park: "#9bd45e",
  water: "#3ec6df",
  waterRoughness: 0.35,

  /* ---- 道路：[路面宽, 路缘宽]，路缘略宽垫在路面下面 ---- */
  roadSurface: "#ffffff",
  roadCurb: "#d9d2c3",
  roadWidths: { a: [18, 24], b: [12, 16], c: [8, 11], d: [5, 7] },
  riverWidth: 48,

  /* ---- 建筑 ---- */
  lowMax: 24, // 低于此高度为矮楼
  glassMin: 55, // 不低于此高度为玻璃高楼
  lowPalette: [
    "#f5e7cf",
    "#f7dcc4",
    "#eef0ee",
    "#e2ecf4",
    "#f4e3d6",
    "#efe6d2"
  ],
  midPalette: ["#e6ebef", "#dbe7f2", "#f0e5d1", "#e9eef2"],
  glassBottom: "#3d86d0",
  glassTop: "#8fd0f2",
  glassGradientMin: 60, // 玻璃渐变至少按 60m 拉开
  roofLighten: 0.3,
  glassRoofLighten: 0.35,
  buildingRoughness: 0.7,
  /* 窗格：着色器按世界坐标绘制，stepY 竖向格距、stepX 横向格距、gap 为格内留白比例 */
  window: { stepY: 3.6, stepX: 3.4, gapY: 0.3, gapX: 0.28 },
  highlight: "#ff7a45",

  /* ---- 树木 ---- */
  tree: {
    greens: ["#6cc04a", "#86cc5a", "#4fae4a", "#9ad25c"],
    yellow: "#f5c842",
    yellowRatio: 0.22,
    trunk: "#9a6b3f",
    parkAreaPerTree: 900, // 公园包围盒每 900 ㎡ 一棵（按包围盒面积计，实际密度更高）
    parkMaxPerPolygon: 400,
    riverStep: 34, // 河岸每 34m 一棵
    riverOffset: 34, // 距河中心线 34m
    crownMin: 7,
    crownVar: 5,
    trunkMin: 5,
    trunkVar: 3,
    seed: 2026
  },

  /* ---- 光照 ---- */
  light: {
    hemiSky: "#ffffff",
    hemiGround: "#d8dcc8",
    hemiIntensity: 1.45,
    sun: "#fff6e6",
    sunIntensity: 2.6,
    sunPosition: [-1400, 2600, 1800],
    shadowMapSize: 4096,
    shadowBox: {
      left: -3000,
      right: 3400,
      top: 3000,
      bottom: -2800,
      near: 100,
      far: 9000
    }
  },

  /* ---- 景点标注 ---- */
  /* labelLift：标签锚点在落点球心上方的高度（米）：取普通球半径，锚点即球顶；标签再由 CSS 固定上抬 40px */
  marker: { color: "#ff7a45", radius: 12, mainRadius: 18, labelLift: 12 },

  /* ---- 相机与巡览 ---- */
  camera: {
    fov: 30,
    /*
     * near 取 20 而非 1：24 位深度缓冲在总览距离（约 5.4 km）下，
     * near=1 的深度分辨率约 1.7 m，地面/绿地/水面/道路以 0.1 m 间隔叠放会闪烁；
     * near=20 时分辨率约 0.09 m。相机最近距离 300 m、俯仰 ≥20°，
     * 永远不会有物体落在 20 m 内，所以不会被裁掉。
     */
    near: 20,
    far: 30000,
    overview: { p: [-1400, 3300, 3400], t: [450, 0, -420] },
    pitchMin: 20, // 俯仰角限制（度，0 为平视）
    pitchMax: 80,
    radiusMin: 300,
    radiusMax: 6000,
    bounds: { x: [-2100, 2900], z: [-2400, 2000] } // 注视点可移动范围
  },
  tour: { fly: 2, hold: 8, idle: 15, drift: 0.004 }, // 秒；drift 为停靠时环绕速度（弧度/秒）

  /* ---- 渲染 ---- */
  maxPixelRatio: 1.5,
  exposure: 1.12
}

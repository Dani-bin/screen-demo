/*
 * 三维场景的视觉常量（色值来自定稿令牌 docs/design/coal-prep/design/src/tokens.no-convert.css）
 * ----------------------------------------------------------
 * 模型来自 Blender 脚本 scripts/blender/coal_prep/（public/coal-prep/conveyor.glb），尺寸与 layout.py 一致。
 * 坐标（three.js，单位 m）：X 沿皮带指向机头（1# 驱动滚筒轴线 X = 0），Y 向上，Z 指向巡检通道一侧（镜头所在侧）；
 * 驱动部在 Z 负方向。Blender (x, y, z) ↔ three.js (x, z, −y)。里程 m（0 = 机头）对应 X = −m。
 */
import camera from "../data/camera.json"

export const TOKENS = {
  bg: "#070b12",
  brand: "#38bdf8",
  flow: "#f97316",
  platform: "#a78bfa",
  ok: "#22c55e",
  l3: "#facc15",
  l2: "#fb923c",
  l1: "#ef4444",
  l4: "#60a5fa",
  off: "#64748b"
}

export const LEVEL_COLOR = {
  1: TOKENS.l1,
  2: TOKENS.l2,
  3: TOKENS.l3,
  4: TOKENS.l4
}

/**
 * 主机位：按定稿构图摆的透视相机（scripts/coal-prep/compose_camera.py）。纯标定解（calibrate.py，残差 9.7 px）贴着皮带高度、
 * 煤面只剩一条边，2026-10-28 用户决定按定稿构图重摆：相机抬到约 3 m、往后拉，让长段满载皮带从左上方伸进画面。
 * 设计稿只显示裁掉顶部 70 px 后的 1536 × 794，页面用 setViewOffset 做同样的裁切。
 */
export const CAMERA = {
  ...camera.three,
  image: camera.image,
  cropTop: 70
}

/** 皮带与机头几何（与 layout.py 一致） */
export const BELT = {
  v: 3.15, // 额定带速
  len: 248, // 全长
  pitch: 1.2, // 上托辊组间距
  firstIdler: 1.0, // 第 1 组托辊离机头的距离
  p1: { x: 0, y: 1.4, r: 0.45 }, // 1# 驱动滚筒
  p2: { x: -1.7, y: 0.52, r: 0.41 }, // 2# 驱动滚筒
  carryY: 1.4 // 标准段承载面高度（托辊组上方）
}

/** 托辊组 g 的里程（第 1 组离机头 1.0 m） */
export const idlerMileage = (g) => BELT.firstIdler + (g - 1) * BELT.pitch

/**
 * 光照图（scripts/blender/coal_prep/bake.py）：WebP 里存 sqrt(irradiance / 4)，
 * 按 sRGB 解码约等于平方，再乘 intensity 还原 irradiance（three.js 的漫反射还要 × 1/π，所以乘 π）
 */
export const LIGHTMAP = {
  files: { lm_hero: "lm_hero.webp", lm_struct: "lm_struct.webp" },
  intensity: 4 * Math.PI * 0.85 * 1.3,
  // 各图集的额外增益：结构图集（栈桥、走道、护栏，画面左半）提亮，设计稿是左亮右暗（第 9 轮评审：明暗方向反了）
  // 驱动部（主角图集，画面右半）压暗一些（第 10 轮评审：左右明暗仍是反的）
  gain: { lm_hero: 0.5, lm_struct: 1.6 },
  // 烘焙件上实时灯的直射漫反射只留 20 %：实时灯没有阴影，原样叠加会把光照图里的阴影、暗角冲淡（第 6 轮评审：像平光）；
  // 高光照常保留，金属边缘仍有反光
  directDiffuse: 0.2
}

/** 黄昏光：太阳方位 118°（驱动侧偏机尾）、高度角 4°；天空中段偏蓝、地平线上方是暖橙（第 4 轮比对：原来的品红中段让整屏偏紫） */
export const SKY = {
  zenith: "#16224a",
  mid: "#33476f",
  glow: "#b06a4c", // 第 6 轮评审：天空粉橙太亮太饱和，压暗一档
  horizon: "#ff8a3d",
  sunAz: 118,
  sunEl: 4
}

/** 温度 → 光纤色带颜色（深青 → 青 → 橙，超过均值 + 6 ℃ 紫）；低端不能太暗，否则主机位下色带看不出来 */
export function tempColor(THREE, t, mean, out) {
  const c = out || new THREE.Color()
  if (t > mean + 6) return c.set(TOKENS.platform)
  const k = Math.max(0, Math.min(1, (t - (mean - 2)) / 8))
  const a = new THREE.Color("#126f8c")
  const b = new THREE.Color("#22b8d8")
  const d = new THREE.Color(TOKENS.flow)
  return k < 0.5 ? c.copy(a).lerp(b, k * 2) : c.copy(b).lerp(d, (k - 0.5) * 2)
}

/*
 * 老家沙盘 场景参数
 * ----------------------------------------------------------
 * 镜头参数与 Blender 效果图（scripts/blender/hometown/preview.py、beauty.render_effects）一致，
 * 网页画面因此能和设计稿 08 / 09 / 10 对上。
 * Blender 场地坐标 (x, y, z) → three.js (x, z, -y)。
 */

const DEG = Math.PI / 180

/** Blender 相机：50 mm 镜头（36 mm 胶片宽）在 16:9 画面下的竖向视场角 */
const vfov = (lens) => (2 * Math.atan(((18 / lens) * 9) / 16)) / DEG

export const THEME = {
  /** 全景：目标点 (4, 2, 4)、方位 -96°、俯角 38°、距离 560 m（Blender 坐标） */
  overview: {
    target: [4, 4, -2],
    azimuth: -96,
    elevation: 38,
    dist: 560,
    fov: vfov(50)
  },
  /** 我家近景：站在地坝里、离正立面约 12 m，眼高 1.6 m，13 mm 广角（beauty.render_effects） */
  home: { dist: 12, eye: 1.6, side: -0.5, aim: -3, lookUp: 5.5, fov: vfov(13) },
  /** 开场俯视：从正上方看整张卫星图 */
  top: { height: 760 },
  /** 太阳：真方位 290°、高度角 11°（盛夏傍晚），场地 +y = 真方位 76.2° */
  sun: { azimuth: 290, elevation: 11, upAzimuth: 76.2 },
  dusk: {
    sun: 0xffc690,
    sunIntensity: 3.2,
    sky: 0xb8c4d8,
    groundLight: 0x6b5a48,
    hemi: 1.6,
    // AgX 会把白墙压成灰色，曝光抬高一些（地面贴图不参与色调映射，不受影响）
    exposure: 1.45,
    bloom: [0.28, 0.5, 0.88]
  },
  night: {
    sun: 0x8fa6ff,
    sunIntensity: 0.25,
    sky: 0x2a3550,
    groundLight: 0x0b0f18,
    hemi: 0.35,
    exposure: 1.05,
    bloom: [0.75, 0.5, 0.55]
  },
  /** 夜里亮灯的人家比例（按户随机） */
  litRatio: 0.65,
  /** 回家路线发光颜色 */
  route: 0xffcf7a,
  DEG
}

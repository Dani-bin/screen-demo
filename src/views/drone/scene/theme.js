/*
 * 无人机巡检监控平台 · 三维视觉常量
 * ----------------------------------------------------------
 * 还原基准：docs/design/drone/design/final.png（方向 A · 黄昏沙盘）。
 * 主机位直接用标定结果（data/camera.json 的 three 块，来自 docs/design/drone/07-camera.json），不要手调；
 * 调色顺序：先材质和灯光，最后才动曝光。辉光只给真实光源（阈值约 1.15）。
 *
 * 坐标：模型是 Blender 导出的 glTF，three.js 里 (X, Y, Z) = (x, z, -y)，
 * 其中 x 东、y 北、z 上是 site.js 的场地坐标（米）。
 */
import camera from "../data/camera.json"

/** 场地坐标 (x 东, y 北, z 上) → three.js 坐标 */
export const w2t = (x, y, z = 0) => [x, z, -y]

export const THEME = {
  canvas: { width: 1920, height: 1080 },
  // 主机位 = 标定结果（透视，竖直视场角约 23°，相机在场地正南约 1.9 km、高约 470 m）
  camera: camera.three,
  // 定稿里中央沙盘的位置（设计稿 px）：画布全屏，外圈用 CSS 暗角遮罩压暗，复现定稿的沙盘边缘
  sceneBox: { x: 410, y: 116, w: 1120, h: 747 },
  background: "#060b16",
  exposure: 1.15,

  /**
   * 天空：标定相机的视野顶边在真地平线以下约 6°（AI 图把远景压扁了），
   * 画面上能看到的"天空"按方向算全在地平线下 8–10°。所以天空按视线高度角在这个窄范围里取色：
   * 远山脊线（约 -9.6°）附近橙色，往上过渡到紫、深蓝；其他机位（更平的视线）上方是夜空蓝。
   */
  sky: {
    stops: [
      [-12.0, "#8e6a6a"],
      [-9.5, "#b88a82"],
      [-8.9, "#9e6e74"],
      [-8.2, "#4e3c5c"],
      [-6.5, "#221e3c"],
      [20.0, "#0a0d1f"]
    ],
    // 图上太阳的位置（定稿 px），天空里的落日光晕按这个像素反推方向
    sunPx: [465, 163],
    sunGlow: "#ffb067"
  },
  // 远景淡入夜色（相机离园区约 1.9–2.7 km，近处不受影响）
  fog: { color: "#3d3747", near: 2200, far: 5200 },
  // 夕阳：方位取图上太阳的方位，高度角取 +18°（图上的太阳像素在标定相机里低于地平线，照不亮场景；
  // 再低的话 100 m 的塔会拖出五六百米的影子，把地面压成一片黑条）
  sun: { color: "#ffdcc0", intensity: 2.6, elevationDeg: 18 },
  // 天光地面色由暖褐改为中性灰：装置区、公用工程的竖直面整体偏红、蓝色通道偏低（比对第 14 轮）
  // 天空色少一点蓝：暖色夕阳叠偏蓝紫的天光，公用工程的塔身、地坪偏品红（B > G），定稿是暖灰（比对第 25 轮，原 #b3b3d6）
  hemi: { sky: "#b8b4cc", ground: "#4e4e58", intensity: 1.25 },
  fill: { color: "#5a6fd8", intensity: 0.35 },
  envIntensity: 0.7,
  shadow: { size: 4096, center: [198, -148], half: 520 },
  bloom: { threshold: 1.15, strength: 0.45, radius: 0.3 },

  /**
   * 按材质名覆盖（Blender 里的材质名 M_*）：emissive 为自发光强度，其余字段直接赋给材质。
   * 钠灯、窗、火炬亮度高于辉光阈值，其余材质不发光。
   */
  materials: {
    M_lamp_sodium: { emissive: 6.0 },
    // 装置区钠灯：第 15 轮试过降到 4.0，装置区反而更暗更偏离定稿（定稿里装置区布满暖光），当时保持 8.0；
    // 第 37 轮起每盏灯另有光晕点（lights.js）负责"布满暖光"，灯头本身 8.0 再叠光晕偏亮（装置区色差 5.8），
    // 第 43 轮降到 4.0 时模型恰好换了一版（Blender 细节返工中），装置区反而偏暗（6.6），先恢复 8.0，模型定型后再调
    M_lamp_unit: { emissive: 8.0 },
    // 钢结构调亮、偏中性：装置区亮度原先几乎全靠橙色灯光，整体偏红（比对第 16 轮）
    M_steel_dark: { color: "#717a85" },
    M_steel_rust: { color: "#7c7266" },
    M_flame: { emissive: 14.0 },
    M_aviation_red: { emissive: 6.0 },
    M_window_lit: { emissive: 2.2 },
    M_glass_windows: { emissive: 1.4, metalness: 0.4, roughness: 0.15 },
    M_dock_led: { emissive: 4.0 },
    M_drone_led: { emissive: 6.0 },
    M_drone_led_g: { emissive: 6.0 },
    // 江面：暗灰紫底色（定稿约 RGB 75/64/63，比对第 9 轮从 #3a3944 调暗），靠天光照亮
    // 粗糙度不能太低：夕阳在左侧低空，太光滑时左侧江面的镜面高光经辉光放大会糊掉半个罐区
    // 第 39 轮：加波纹法线贴图（ripple，见 water.js）后改成较光滑的深色水面：天光在波纹上碎成反光，
    // 原先的哑光平面（粗糙度 0.7、#333646）被评审批"不像水"。ripple.repeat 是贴图在江面 UV 上的重复次数
    // （江面 5500 × 3000 m，约 16 m 一块），scale 是法线强度
    M_water: {
      color: "#232633",
      metalness: 0.0,
      roughness: 0.32,
      envMapIntensity: 1.0,
      // sky：假天光反射（water.js waterShading），low / high 为地平线附近 / 高处的天色，gain 为强度
      ripple: {
        // 第 41 轮 repeat 340×190、scale 0.35 时纹理像鹅卵石；第 42 轮调细调弱，天色按浏览器里实测的江面均色选
        repeat: [520, 290],
        scale: 0.18,
        sky: { low: "#e0b090", high: "#9a8a84", gain: 2.0 }
      }
    },
    // 远山：定稿里地平线下是灰紫色的远景雾霭（比对第 8 轮）
    M_hill: { color: "#6a6378" },
    // 远处农田：定稿里偏灰偏暗（比对第 17 轮：原 #9a9890 偏黄偏亮）。
    // 视线和地面只有约 10° 夹角，菲涅耳反射让夕阳的镜面高光占了农田亮度的大头、整片偏橙褐，
    // 换成底色基本不起作用；压低高光强度、提亮偏冷的底色（比对第 23 轮；第 31 轮再偏紫一点：
    // UAV-02 的标签移出这块区域后，田野均色偏黄）
    M_fields: { color: "#a49ad4", specularIntensity: 0.6 },
    // 远处的河：映着落日天光，带一点自发光才能在黄昏里显亮（比对第 19 轮）
    // 河面只比农田高 0.1 m，离相机约 2.5 km，深度精度不够会被农田盖掉，用多边形偏移让河面稳定压在上面（第 20 轮）
    M_far_water: {
      emissive: 0.35,
      roughness: 0.25,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -16
    },
    // 园区草地：橄榄绿偏黄，定稿黄昏下偏灰（比对第 18 轮）；
    // 第 21 轮修好导出精度后草地不再被农田盖住，#3c4038 显得太暗，公用工程整体偏暗偏品红，调亮一档（比对第 24 轮）
    M_grass: { color: "#545a48" },
    // 污水池水面：定稿里是浅蓝灰色（比对第 13 轮）
    M_basin_water: { color: "#7d8a98", metalness: 0.1, roughness: 0.35 },
    M_column: { envMapIntensity: 1.2 },
    M_steel_silver: { envMapIntensity: 1.1 },
    M_tank_white: { envMapIntensity: 0.6 }
  },
  // 不接收阴影的材质：江面上船和栈桥的硬影又黑又紫，定稿里水面没有投影（评审意见，比对第 39 轮）
  noReceive: ["M_water"],
  // 不投影的材质（地面、水面只接收阴影）
  noCast: [
    // 树不投影：夕阳高度角低，满园行道树的长影会把地面压成一片黑条
    "M_tree",
    "M_trunk",
    "M_fields",
    "M_water",
    "M_grass",
    "M_asphalt",
    "M_concrete",
    "M_rock",
    "M_hill"
  ],

  /**
   * 机载相机：竖直视场角 16°（变焦镜头的中焦段）。定稿机载画面是斜看装置区的近景，
   * 34° 广角时塔器、管廊只占画面一小块（比对第 28 轮）
   */
  pov: { fov: 16 },

  /**
   * 红外伪彩的"温度"（0 冷 – 1 热），按材质名取，没列出的用 default。
   * 红外模式渲染机载画面时把材质临时换成这个灰度（以自发光为主、带一点受光），后处理再映射成铁红色：
   * 定稿里塔器、管廊、钢结构是橙黄色（热），地坪、绿化偏紫（冷），水面、远处最冷。
   * 按可见光亮度映射的话，被夕阳照亮的地坪反而最热（比对第 28 轮）。
   */
  thermal: {
    default: 0.4,
    M_flame: 1.0,
    M_lamp_sodium: 0.95,
    M_lamp_unit: 0.95,
    M_aviation_red: 0.85,
    M_window_lit: 0.7,
    M_pipe_yellow: 0.88,
    M_column: 0.84,
    M_steel_silver: 0.8,
    M_steel_dark: 0.78,
    M_transformer: 0.78,
    M_steel_rust: 0.74,
    M_tank_white: 0.52,
    M_tank_ring: 0.52,
    M_tank_roof: 0.48,
    M_roof_grey: 0.5,
    M_wall_light: 0.48,
    M_wall_dark: 0.46,
    M_canopy_roof: 0.48,
    M_glass_windows: 0.42,
    M_asphalt: 0.42,
    M_concrete: 0.36,
    M_basin_water: 0.32,
    M_rock: 0.3,
    M_grass: 0.26,
    M_trunk: 0.26,
    M_tree: 0.24,
    M_fields: 0.24,
    M_hill: 0.2,
    M_water: 0.12,
    M_far_water: 0.12
  },

  selectColor: "#36e3d8",
  // 无人机模型放大倍数（真实约 0.6 m 轴距，跟随视角里放大一点更醒目）
  droneScale: 3,
  // 叠加层颜色（与定稿一致）
  overlay: {
    route: "#36e3d8",
    trail: "#36e3d8",
    major: "#ff4d4f",
    serious: "#ff8a3d",
    general: "#ffd23f",
    noFly: "#ff4d4f"
  }
}

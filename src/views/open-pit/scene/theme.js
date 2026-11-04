/**
 * 场景主题：颜色、相机视角、设备放大倍数
 * 颜色对应 docs/design/open-pit/design/src/tokens.css：三维里是自发光，用比图表标记色更亮的霓虹版；
 * 状态色（正常 / 告警 / 故障 / 离线）和面板一套。
 */
export const THEME = {
  designSize: [1920, 1080],
  fov: 28,
  bg: 0x050a12,

  cyan: 0x22d3ee,
  amber: 0xfbbf24,
  ok: 0x34d399,
  warn: 0xfb923c,
  fault: 0xf43f5e,
  offline: 0x64748b,

  /** 卡车六类状态的车身色（运行 / 装卸 / 排队 / 换电 / 待命 / 故障），和面板图例同序同色相 */
  truckGroup: [0x22d3ee, 0xfbbf24, 0x6d94ff, 0xff7ab8, 0x64748b, 0xf43f5e],

  /** 设备放大倍数：露天矿 6 km 宽，真实尺寸的设备在总览里只有几个像素，放大到看得见（同 /smart-ranch 的做法） */
  scale: {
    truck: 11,
    shovel: 10,
    crusher: 6,
    tower: 2.8,
    station: 3.2,
    radar: 6,
    solar: 2
  },

  /**
   * 相机视角：以 target（世界 x 东 / y 北，米）为中心的球坐标。
   * dist 米，pitch 俯角（度，0 平视，90 俯视），yaw 方位（度，0 = 相机在目标正南看向北，正值向东转）。
   */
  views: {
    // 取景：坑落在两侧栏之间偏左，电厂 / 煤场 / 输煤走廊在右下，都在两侧栏之间（电厂已按设计稿往坑边收近，见 prepare.py 的 PLANT_SHIFT）
    overview: { target: [900, -420], dist: 9000, pitch: 36, yaw: 0 },
    fleet: { target: [200, 100], dist: 7600, pitch: 46, yaw: -18 },
    swap: { target: [750, -2200], dist: 2500, pitch: 30, yaw: 20 },
    shovel: { target: [-100, -500], dist: 3600, pitch: 52, yaw: 8 },
    slope: { target: [-100, 1500], dist: 4600, pitch: 26, yaw: 0 },
    yard: { target: [2100, -2300], dist: 5200, pitch: 32, yaw: -24 }
  }
}

/*
 * 智慧港口 三维主题（三套设计方向）
 * ----------------------------------------------------------
 * 方向来自视觉调研（docs/design/smart-port/02-research.md）：
 *   a 海图·日间：像一张会动的总平面图，浅海图色，白色岸桥，墨色线条
 *   b 夜班·钠灯冷白：22 点夜班，高杆钠灯暖色光池 + 岸桥下冷白 LED，海面近黑
 *   c 晨雾·蓝灰 + 安全橙：清晨低角度太阳、长影，远处岛屿被雾吃掉，橙色只给被跟踪的船和设备
 *   holo 全息孪生 · 深海科技蓝（定稿 design/final.png）：深蓝实体 + 青色发光描边、AGV 光迹、作业路光带、扫描海面
 * a / b / c 是第一轮被否的三个方向，留着给设计稿源码复现；页面用 holo。
 * 颜色用十六进制写，场景里统一按 sRGB 解释；色调映射统一 Neutral，只在输出时做一次。
 * 定稿面板的色值在 docs/design/smart-port/design/src/tokens.no-convert.css，场景里用到的同名色保持一致。
 */

export const THEMES = {
  a: {
    key: "a",
    name: "海图·日间",
    // 背景（天空 / 远海）渐变，三维画布透明时由页面 CSS 画，这里给 fog 用
    sky: ["#eef4f5", "#d6e6ea"],
    fog: { color: "#e3edef", near: 5000, far: 16000 },
    exposure: 1.0,
    sun: { azimuth: 215, elevation: 48, color: "#fffaf2", intensity: 3.1 },
    hemi: { sky: "#e8f1f5", ground: "#aeb8bc", intensity: 0.85 },
    shadow: true,
    ao: { radius: 7, thickness: 3, blend: 0.95 },
    sea: { base: "#cfe4e9", far: "#dcebee", ripple: 0.035, foam: "#ffffff" },
    land: {
      tint: "#cdbf86",
      mix: 0.55,
      sat: 0.35,
      gain: 1.08,
      hill: "#b9b783"
    },
    ground: {
      concrete: "#eceeeb",
      apron: "#e6e9e7",
      agv: "#e1e5e4",
      yard: "#dde1df",
      pad: "#d3d8d7",
      road: "#ccd2d2",
      line: "#ffffff",
      lineDark: "#9aa6ab",
      rail: "#7d8a90",
      mark: "#1b2a33",
      zebra: "#f4da48",
      edge: "#b9c2c4",
      wall: "#c4cccd",
      // 夜景光池（白天不用）
      pool: null
    },
    crane: {
      frame: "#f2f4f4",
      dark: "#3a4950",
      machine: "#dfe4e6",
      accent: "#1b2a33",
      cable: "#56656c"
    },
    rmg: { frame: "#e9ecec", dark: "#46545b", trolley: "#cfd6d8" },
    agv: { body: "#2f3d45", top: "#55666e", laden: "#1f4fa3" },
    containers: [
      "#c9493b",
      "#2f6fa3",
      "#d8dcdd",
      "#5f8b6f",
      "#d79a4a",
      "#8e9aa1"
    ],
    reefer: "#eef1f2",
    accent: "#1f4fa3",
    ship: {
      hull: "#2b3a42",
      band: "#a54a3e",
      deck: "#c5cbce",
      house: "#f3f5f5",
      funnel: "#3a4950"
    },
    building: {
      wall: "#e7eaea",
      roof: "#cfd6d7",
      glass: "#9db3bd",
      tower: "#f1f3f3"
    },
    bridge: { deck: "#d9dedf", pier: "#bfc7c9" },
    status: {
      work: "#1f4fa3",
      idle: "#9aa6ab",
      fault: "#e0362c",
      maint: "#f4da48",
      swap: "#c545c3",
      stale: "#b0b8bb"
    },
    lights: false,
    bloom: null
  },

  b: {
    key: "b",
    name: "夜班·钠灯冷白",
    sky: ["#0d1517", "#060b0c"],
    fog: { color: "#0a1214", near: 3500, far: 12000 },
    exposure: 1.3,
    sun: { azimuth: 150, elevation: 35, color: "#8fa6c8", intensity: 0.28 },
    hemi: { sky: "#3a5068", ground: "#0c1012", intensity: 0.22 },
    shadow: false,
    sea: { base: "#0a1416", far: "#0c1719", ripple: 0.06, foam: "#2a3a3e" },
    land: { tint: "#2a3436", mix: 0.8, sat: 0.1, gain: 0.5, hill: "#141c1d" },
    ground: {
      // 夜景材质用正常的反照率（混凝土中灰），暗是因为环境光弱，光池才能把地面照亮
      concrete: "#8b9193",
      apron: "#868c8e",
      agv: "#7c8386",
      yard: "#757c7f",
      pad: "#6f7679",
      road: "#646b6e",
      line: "#c7cdd0",
      lineDark: "#9aa2a6",
      rail: "#a3abaf",
      mark: "#e6eef7",
      zebra: "#d9a441",
      edge: "#5d6467",
      wall: "#5a6164",
      // 高杆钠灯光池（暖）与岸桥下 LED（冷白）
      pool: { sodium: "#ffa63d", led: "#e6eef7", gain: 1.0 }
    },
    crane: {
      frame: "#d3d9dc",
      dark: "#3f484c",
      machine: "#aab3b7",
      accent: "#ffa63d",
      cable: "#5c666a"
    },
    rmg: { frame: "#c3cacd", dark: "#3c4549", trolley: "#9aa4a8" },
    agv: { body: "#5d6a70", top: "#7d8a90", laden: "#ffa63d" },
    containers: [
      "#8a4a3e",
      "#3f6283",
      "#a3a9ab",
      "#4f7a5e",
      "#b07a3c",
      "#6f7a80"
    ],
    reefer: "#d5dadc",
    accent: "#ffa63d",
    ship: {
      hull: "#3a464c",
      band: "#6a2e26",
      deck: "#8b9497",
      house: "#d9dfe2",
      funnel: "#3f484c"
    },
    building: {
      wall: "#7d8589",
      roof: "#5c6468",
      glass: "#ffc27a",
      tower: "#9aa3a7"
    },
    bridge: { deck: "#7a8286", pier: "#5c6468" },
    status: {
      work: "#ffa63d",
      idle: "#66727a",
      fault: "#ff3b30",
      maint: "#b5e655",
      swap: "#b5e655",
      stale: "#4c565b"
    },
    lights: true,
    bloom: { strength: 0.55, radius: 0.5, threshold: 1.15 }
  },

  c: {
    key: "c",
    name: "晨雾·蓝灰 + 安全橙",
    sky: ["#d9e0e4", "#c3cdd3"],
    fog: { color: "#cfd8de", near: 1200, far: 7200 },
    exposure: 1.02,
    // 清晨 6:30 的太阳：东偏南、高度角 8°，长影
    sun: { azimuth: 100, elevation: 9, color: "#ffd2a8", intensity: 2.2 },
    hemi: { sky: "#dfe6ea", ground: "#8c989f", intensity: 0.85 },
    shadow: true,
    ao: { radius: 6, thickness: 3, blend: 0.85 },
    sea: { base: "#8fa3ae", far: "#b9c6cd", ripple: 0.05, foam: "#d7dfe3" },
    land: { tint: "#a9b2b7", mix: 0.7, sat: 0.15, gain: 0.9, hill: "#8f9ba1" },
    ground: {
      concrete: "#b9c1c5",
      apron: "#b3bbbf",
      agv: "#aeb6ba",
      yard: "#a9b2b7",
      pad: "#a2abb0",
      road: "#9ea7ac",
      line: "#e6ebed",
      lineDark: "#8a959b",
      rail: "#6d7a82",
      mark: "#26323a",
      zebra: "#ff5a1f",
      edge: "#97a1a6",
      wall: "#949ea3",
      pool: null
    },
    crane: {
      frame: "#e4e9eb",
      dark: "#3f4b52",
      machine: "#c8d0d4",
      accent: "#26323a",
      cable: "#5a666d"
    },
    rmg: { frame: "#d6dcdf", dark: "#46525a", trolley: "#b9c2c6" },
    agv: { body: "#3f4b52", top: "#5e6a71", laden: "#3f6e8c" },
    containers: ["#7d8b94", "#98a4ab", "#b4bdc2", "#8a979e"],
    reefer: "#dfe5e8",
    accent: "#ff5a1f",
    ship: {
      hull: "#34424a",
      band: "#6c4a42",
      deck: "#a7b1b6",
      house: "#e9eef0",
      funnel: "#3f4b52"
    },
    building: {
      wall: "#c6cdd0",
      roof: "#aab3b7",
      glass: "#8ea3ad",
      tower: "#d7dde0"
    },
    bridge: { deck: "#b8c0c4", pier: "#a2abb0" },
    status: {
      work: "#3f6e8c",
      idle: "#98a4ab",
      fault: "#c8102e",
      maint: "#f2b38b",
      swap: "#3f6e8c",
      stale: "#b4bdc2"
    },
    lights: false,
    bloom: null
  },

  holo: {
    key: "holo",
    name: "全息孪生 · 深海科技蓝",
    sky: ["#061326", "#030a16"],
    // rel：雾的起止距离是"镜头到注视点距离"的倍数（总览在 6.5 km 外，近景几百米，远近镜头的纵深衰减一致）。
    // 0.92–1.9：注视点以近不起雾，往后的箱区、陆域逐渐沉进暗色（定稿越远越暗；第 25 轮比对从 0.9–3.3 收紧）
    fog: { color: "#030a16", near: 0.92, far: 1.9, rel: true },
    exposure: 0.8,
    // 竖向夸张：岸桥、船、箱堆、建筑拉高 1.52 倍（scripts/smart-port/fit_camera.py 按定稿里岸桥牌的高度拟合）
    vScale: 1.52,
    // 微弱月光 + 天光：只让实体有体积感，亮的全是发光线条和灯
    sun: { azimuth: 200, elevation: 40, color: "#6f9ad6", intensity: 0.5 },
    hemi: { sky: "#1c3a66", ground: "#040a14", intensity: 0.55 },
    shadow: false,
    // 全息：描边线条颜色（乘以亮度系数后超过辉光阈值）
    holo: {
      edge: "#19e3ff",
      edgeGain: 2.2,
      // 岸桥描边亮度：岸桥线条密，总览里叠在一起经辉光会糊成一团，只略高于辉光阈值（第 12 轮比对）
      craneGain: 1.5,
      // 岸桥描边色：定稿里岸桥是偏浅、饱和度低一些的天蓝，霓虹青太刺眼（第 21 轮比对）
      craneEdge: "#6fd3ff",
      // 岸桥杆件：半透明 + 一点蓝色自发光（定稿里岸桥的面是半透明的）
      craneFace: { opacity: 0.72, emissive: "#0d3a6a", intensity: 1.0 },
      edgeDim: 0.45, // 箱堆等大量物体的描边亮度（相对岸桥）
      // 箱区箱体自发光（底色 × stackFill）：定稿里箱区是深蓝箱体 + 亮棱线，箱体本身不能太亮（第 13 轮比对从 0.35 降下来）
      stackFill: 0.2,
      // 箱堆棱线用偏蓝的青：定稿里箱区整体是蓝色，霓虹青只留给岸桥、光带（第 6 轮比对的色相调整）
      stackEdge: "#5a8fe0",
      // 船上甲板箱：概念图里是发亮的半透明蓝
      deck: ["#1a5fa8", "#2272c4", "#1b66b5", "#2a7fd1"],
      deckEdge: 0.9,
      fault: "#ff3b5c",
      gold: "#ffc53d",
      trail: "#19e3ff",
      ribbon: "#19e3ff",
      grid: "#19e3ff"
    },
    sea: {
      base: "#020c1a",
      far: "#05142a",
      ripple: 0.05,
      foam: "#19e3ff",
      // 海面网格亮度（第 20 轮从 0.55 降下来：定稿里网格很淡）
      grid: 0.3
    },
    land: { tint: "#0b1d36", mix: 0.85, sat: 0.1, gain: 0.45, hill: "#0a1a30" },
    ground: {
      concrete: "#0a1a33",
      apron: "#0c1f3b",
      agv: "#0a1c36",
      yard: "#0b1f3c",
      pad: "#0e2647",
      road: "#081730",
      line: "#19e3ff",
      lineDark: "#14708f",
      rail: "#2fa9d6",
      mark: "#19e3ff",
      zebra: "#ffc53d",
      edge: "#123a63",
      wall: "#0d2442",
      // 灯光池：高杆灯偏暖金、岸桥 LED 青白（海面倒影用同一张图）
      pool: { sodium: "#ffc53d", led: "#8ff1ff", gain: 0.6 },
      // 码头面贴图同时当自发光贴图用：标线亮、底色暗
      emissive: 1.5
    },
    crane: {
      frame: "#0d2a4d",
      dark: "#081a33",
      machine: "#103361",
      accent: "#ffc53d",
      cable: "#1a6f99"
    },
    rmg: { frame: "#0d2a4d", dark: "#081a33", trolley: "#103361" },
    agv: { body: "#0f2f57", top: "#16437a", laden: "#ffc53d" },
    // 箱体：低饱和的灰蓝（定稿箱区亮部平均色相约 226°、饱和度约 0.23；第 26 轮比对从饱和深蓝改过来）
    containers: ["#2a3654", "#2f3d5f", "#35456a", "#26314d", "#3a4b72"],
    reefer: "#4a5f86",
    accent: "#ffc53d",
    ship: {
      // 船壳深海军蓝（纯黑在总览里像剪纸）、水线带暗红
      hull: "#14305a",
      band: "#7a2233",
      deck: "#0e2647",
      // 上层建筑：定稿里是浅色船楼 + 暖色窗灯（全场少数的暖色点之一）
      house: "#b9c7d8",
      funnel: "#0b223f"
    },
    building: {
      wall: "#0c2140",
      roof: "#0a1a33",
      glass: "#19e3ff",
      tower: "#0f2a4d"
    },
    bridge: { deck: "#0b1f3a", pier: "#081830" },
    status: {
      work: "#19e3ff",
      idle: "#34506f",
      fault: "#ff3b5c",
      maint: "#ffb020",
      swap: "#7180ff",
      stale: "#5b6b82"
    },
    lights: true,
    bloom: { strength: 0.85, radius: 0.55, threshold: 1.15 }
  }
}

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
    /*
     * 各数据区域静态阴影的正交范围与朝向由 shadow.js 的 computeCityShadow 在城市建好后按区域实算
     * （包住该区域的楼栋、通用树真实树冠、景点与落点球及其影子落地深度，并绕光轴转到 texel 最小的角度），
     * 这里只给平面与深度方向的外扩余量（米）
     */
    shadowMargin: 8,
    /*
     * 正交阴影相机深度线性，bias × (far − near) ≈ 沿光线方向的米数；
     * 这里直接给米数，由 computeCityShadow 按实际深度区间换算成 bias：
     * 0.52 m 足以消除阴影痤疮，又不会让矮楼阴影与墙根脱开（漂浮感）。
     * normalBias 沿法线偏移（米），处理掠射角的条纹
     */
    shadowBiasMeters: 0.52,
    shadowNormalBias: 1
  },

  /* ---- 景点精细模型配色（依据实景照片，略提饱和度贴近插画风） ---- */
  landmark: {
    roof: "#4A5361", // 古建灰瓦（偏蓝石板灰）
    roofRidge: "#3A414C", // 正脊、垂脊
    glaze: "#E8B838", // 金黄琉璃瓦 / 宝顶
    gold: "#D9A93C", // 贴金、神鸟金盘
    column: "#B8352B", // 红柱 / 红木
    lattice: "#8E2A22", // 深红花格门窗
    ochreWall: "#D9A640", // 赭黄院墙
    redWall: "#A33A2E", // 寺院红墙
    marble: "#EFEAE0", // 汉白玉 / 浅石栏杆
    granite: "#B9B6AE", // 台基花岗岩
    brick: "#6B7076", // 青砖
    plaster: "#EDE6D6", // 白灰墙
    timber: "#5A4A3C", // 深木格栅
    iron: "#3A3C40", // 铸铁
    pagodaRed: "#8A2E26", // 塔身暗红
    pandaBlack: "#1E1E22",
    pandaWhite: "#F4F4F0",
    lantern: "#D8352A",
    stonePave: "#CFCAC0", // 广场石材铺装
    glass: "#6FA7D6",
    beige: "#E6D6A6"
  },

  /* ---- 景点人流（插画式放大：真人约 1.7 m，到站 300～1050 m 外只有几个像素） ---- */
  crowd: {
    max: 240, // 全城同时活跃的人数上限
    // 小人身高（米）。到站机位 600～720 m、俯角约 40°：3 m 时只有 6～8 px 高，只是彩色小点；
    // 4 m 时约 8～11 px，头、身、腿分得开。再高（4.5 m）巷道边上的人头会碰到宽窄巷子的
    // 檐口（檐高 4～6 m）与人民公园茶廊的廊檐，且比门檐还高、显得像巨人，故取 4 m
    height: 4,
    // 行走速度区间（米/秒）：真人 1.1～1.8 m/s 按身高放大（约 × 4 / 1.7）。
    // crowd.js 一个步态周期（左右各迈一步）前进 0.9 × 身高，故步态频率
    // = v / (0.9 h) ≈ 0.75～1.2 次/秒（约 1.5～2.4 步/秒），与真人步频相当
    speed: [2.7, 4.3],
    perMeter: 0.04, // 每米路径的人数（density = 1 时）
    fade: 0.6, // 淡入淡出时长（秒）
    turn: 0.4, // 折返转身时长（秒）
    shirts: [
      "#E8553D",
      "#F2A93B",
      "#3F8FD6",
      "#5FB36A",
      "#F4F1EA",
      "#8E6FD1",
      "#E27AA6",
      "#2E3440"
    ],
    pants: ["#2F3A4A", "#4A4F57", "#6B5A48", "#3C5A7A"],
    skin: ["#F2D3B3", "#E8C29C", "#D9AE86"],
    hair: ["#1E1E22", "#3A2A20", "#5A4030"]
  },

  /* ---- 景点标注 ---- */
  /*
   * labelLift：标签锚点在落点球心上方的高度（米）：取普通球半径，锚点即球顶；
   * 标签再由 CSS 变量 --lead 上抬（默认 40px，见 index.vue 的 .city-label），
   * 当前站标签压到顶栏时场景缩短 --lead 把标签往下压（见 markers.js 的 avoidLabels）
   */
  /*
   * 落点标注：小球悬在景点模型上方，细竖线连到模型顶，像一枚定位针。
   * 早期落点球半径 12～18 m、直接坐在楼顶，景点换成精细模型后会盖住亭顶、熊猫、塔尖，
   * 因此改为小球（普通 4 m、主景点 5 m）悬在 markerHeight + hover 处（球心），
   * 竖线从 markerHeight + stemGap 画到球底，标签在球顶上方 labelLift 米。
   */
  marker: {
    color: "#ff7a45",
    radius: 4,
    mainRadius: 5,
    hover: 14, // 球心离底座（景点 markerHeight）的高度
    stemRadius: 0.25,
    stemGap: 1, // 竖线底端离底座的空隙，免得插进模型顶
    labelLift: 4 // 标签锚点离球顶的高度
  },

  /* ---- 相机与巡览 ---- */
  camera: {
    fov: 30,
    /*
     * near 取 20 而非 1：24 位深度缓冲在总览距离（8.2 km）下，
     * near=1 的深度分辨率约 4 m，地面/绿地/水面/道路以 0.1 m 间隔叠放会闪烁；
     * near=20 时分辨率约 0.2 m（6 km 时约 0.11 m），叠放次序由 materials.js 的 polygonOffset 固定。
     * 相机最近距离 300 m、俯仰 ≥20°，
     * 永远不会有物体落在 20 m 内，所以不会被裁掉。
     * far 30 km：在总览距离（8200 m）、俯仰 20° 时画面上缘视线的视深约 31 km，
     * 超出 far 的只有画面最上沿约 7 px（在顶栏下），不必加大。
     * 这两个值适用于总览距离以内；人工缩放拉得更远时（最远 radiusMax），
     * CityScene._updateClip 以总览距离为基准把 near 按距离平方、far 按距离同比放大
     */
    near: 20,
    far: 30000,
    /*
     * 总览机位：从东偏北（方位 76°，注视点 → 相机、自北顺时针）俯仰 26.5°、距离 8200 m
     * 斜看全城，p 由 t + 8200 ×（sin 方位 · cos 俯仰，sin 俯仰，−cos 方位 · cos 俯仰）算出（保留 1 位小数），
     * 画面朝西偏南（指北针约 256°）：杜甫草堂在画面上部，望江楼、合江亭、太古里、IFS、熊猫塔在近处，
     * 文殊院在右栏下方。1920×1080 下 11 个定位针与标签（按当前站的大号标签算）都落在两侧面板、顶栏、
     * 底部导航、左下提示与右下罗盘之外，离遮挡物最近约 17 px（文殊院离右栏下沿），
     * 标签两两不相压（最近的宽窄巷子与人民公园相距约 8 px）；熊猫塔 339 m 的塔身整根在底部导航之上。
     * 取舍：西扩后 11 站东西跨约 6.4 km（杜甫草堂 → 熊猫塔），按遮挡框网格搜索，6000 m 内任何方位都放不下；
     * 7000～7500 m 只有俯仰 20°～25° 的东偏南侧低机位勉强放下，但宽窄巷子与人民公园标签互压、
     * 画面约 25%～48% 是数据范围外的空地；原西北侧（方位 296°）到 9000 m 仍是成都 IFS 与太古里标签互压。
     * 东侧看、8000 m、俯仰 29° 标签离遮挡物更远（约 25 px），但熊猫塔中段与观光塔楼压在底部导航上，
     * 因此取 8200 m（整城铺满画面，数据范围外的空地约 9%）。
     * 从东侧看时成都 IFS 的定位针球在 IFS 塔楼背后、武侯祠的球在一栋 67 m 楼背后（8 km 外球只有 1～2 px，
     * 标签与引线照常显示）；逆光实测不明显（太阳方位约 218°，在视线左前方约 38°、高度约 49°）。
     * 上一版（10 站）：p [-4311.5, 2816.8, -2372.4]、t [450, 0, -50]（方位 296°、俯仰 28°、6000 m）
     */
    overview: { p: [7100.5, 3658.8, -1255.3], t: [-20, 0, 520] },
    pitchMin: 20, // 俯仰角限制（度，0 为平视）
    pitchMax: 80,
    radiusMin: 300,
    // 人工缩放的最远距离：约为总览距离（8200 m）的 2 倍，拉到最远时整城约占画面一半，能看到城区外围。
    // 超过总览距离后近 / 远裁剪面随距离放大（CityScene._updateClip），深度精度与总览时相同；
    // 区域静态阴影由 shadow.js 按区域范围实算，与相机距离无关
    radiusMax: 16000
    // 注视点可移动范围不在这里配置：CityScene 按 chengdu.json 的 meta.bbox 与 meta.enclaves
    // （拉数范围，比各自的 clip 四周各内缩 300 m）换算成局部坐标矩形，数据范围变了自动跟随
  },
  tour: { fly: 2, hold: 8, idle: 15, drift: 0.004 }, // 秒；drift 为停靠时环绕速度（弧度/秒）

  /* ---- 渲染 ---- */
  maxPixelRatio: 1.5,
  exposure: 1.12
}

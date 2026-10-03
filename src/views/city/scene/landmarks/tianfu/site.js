/*
 * 天府广场 · 场地公共部分
 * ----------------------------------------------------------
 * 职责：两套坐标系（广场局部系、设计系）、铺装高度 PAVE、北侧组团地坪 NORTH_Y、广场与北侧组团共用的颜色表 C、
 * 通用小函数（平面三角化、铺面、分色棱柱等；竖直侧墙用 kit/shapes.js 的 sideWalls，
 * 圆周点用 kit/footprint.js 的 circlePolygon）。各分区模块（ground / sunbird / westEye / eastEye /
 * north / statue / science / neighbors 等）都从这里取坐标与颜色，不各自换算。
 *
 * 两套坐标（设计文档第 1 节、调研报告第 1 节；世界 X 东、Z 南、Y 上，单位米）：
 * - 广场局部系：原点在 OSM「天府广场」面的包围盒中心（SQUARE.lon / lat）、铺装顶面以下的地面，
 *   X 向东、Z 向南、正南北不旋转。只剩设计系原点换算还用它（北侧组团用自己的 OSM 点位，见 north.js）。
 * - 设计系 (u, v)：原点在太极大圆圆心，u 沿广场东西轴向东、v 沿南北轴向南，方位角 −1.5°
 *   （东端偏北）。原点在广场局部系的 (2.3, −10.0)。后续任务的广场构件一律在设计系里写，
 *   用 designFrame 换到世界；路径、替换区、地面洞等世界坐标点用 site.toWorld(u, v)。
 *
 * 后续任务：
 * - Task 4～6 按报告 6.9「主要颜色」往 C 里补新颜色（Task 4 已补鱼眼水池与雕塑一组，Task 5 补东鱼眼下沉广场一组，
 *   Task 6 补北缘喷泉与国旗台、凤鸟路灯、南侧构筑物、林带四组）。
 * - Task 7 已按照片改好 C 里的北侧组团（毛主席像、两者之间的广场、科技馆）一组；成都博物馆、四川省图书馆的颜色
 *   放在 neighbors.js 自己的表里，不受这里影响。
 */
import { Matrix4, Quaternion, ShapeUtils, Vector2, Vector3 } from "three"
import { frame } from "../kit/builder.js"
import { cylinder, fromTriangles, sideWalls } from "../kit/shapes.js"

const DEG = Math.PI / 180

/* ---------------- 广场局部系与铺装 ---------------- */

// 广场：OSM 天府广场面包围盒中心（广场局部系原点）
export const SQUARE = {
  lon: 104.0632899,
  lat: 30.6597912
}
// 铺装顶面高度：只需盖住道路（路面最高 0.9 m）；实景广场与人行道齐平（报告 3.2），
// 这里只保留盖住路面所需的高差，外沿是与铺装同色的直边（ground.js）。广场构件的高度都从这个顶面往上算
export const PAVE = 1.5

/* ---------------- 设计系 ---------------- */

// 设计系原点（太极大圆圆心）在广场局部系里的位置
export const DESIGN_ORIGIN = { x: 2.3, z: -10.0 }
// 设计系方位角（度）：u 轴指向方位 88.5°，即东端偏北 1.5°；含义同 kit/builder.js 的 frame
export const DESIGN_BEARING = -1.5

// 设计系 → 广场局部系的旋转系数。必须与 frame(…, DESIGN_BEARING) 的旋转矩阵完全一致：
// frame 用 makeRotationY(−bearing·DEG)，θ = 1.5°，矩阵把局部 (u, 0, v) 变成
// (cosθ·u + sinθ·v, 0, −sinθ·u + cosθ·v)，这里取同一个 θ 算 cos、sin
const THETA = -DESIGN_BEARING * DEG
const COS = Math.cos(THETA) // ≈ 0.99966
const SIN = Math.sin(THETA) // ≈ 0.02618

/**
 * 设计系的坐标系矩阵：原点在太极圆心、铺装以下的地面（y = 0），局部 +X 为 u、+Z 为 v。
 * 写法同设计文档：frame(qx + 2.3, 0, qz − 10.0, −1.5)。构件高度仍从 PAVE 算。
 * @param {number} qx 广场局部系原点的世界 x（project.toLocal(SQUARE.lon, SQUARE.lat)）
 * @param {number} qz 广场局部系原点的世界 z
 * @returns {Matrix4}
 */
export function designFrame(qx, qz) {
  return frame(qx + DESIGN_ORIGIN.x, 0, qz + DESIGN_ORIGIN.z, DESIGN_BEARING)
}

/**
 * 设计系点 → 广场局部系 [x, z]（相对广场局部原点）：
 *   x =  2.3 + 0.99966·u + 0.02618·v
 *   z = −10.0 − 0.02618·u + 0.99966·v
 * 旋转方向与 designFrame（即 frame 的 makeRotationY）一致：+u 向东略偏北（z 减小），
 * +v 向南略偏东（x 增大）。系数取精确的 cos 1.5°、sin 1.5°，上式里的五位小数只是示意。
 */
export function designToSquare(u, v) {
  return [
    COS * u + SIN * v + DESIGN_ORIGIN.x,
    -SIN * u + COS * v + DESIGN_ORIGIN.z
  ]
}

/* ---------------- 场地对象 ---------------- */

/**
 * 场地对象：各分区模块共用的上下文与坐标换算。
 * @param {object} ctx 景点构建上下文 { project, buildings, spot, … }
 * @returns {{
 *   project, buildings, spot,
 *   qx: number, qz: number,   广场局部系原点的世界坐标
 *   square: Matrix4,          广场局部系（旧件用）：frame(qx, 0, qz, 0)
 *   design: Matrix4,          设计系（新件用）：designFrame(qx, qz)
 *   toWorld: (u, v) => [x, z],      设计系点 → 世界 [x, z]，供 walkways、zones、groundHoles
 *   toWorldPts: (pts) => [x, z][]   同上，批量换一组 [u, v]
 * }}
 */
export function createSite(ctx) {
  const { project, buildings, spot } = ctx
  const [qx, qz] = project.toLocal(SQUARE.lon, SQUARE.lat)
  // 世界 = 广场局部原点 + 设计系换到广场局部系的偏移。乘加顺序照 Vector3.applyMatrix4（先旋转、后平移），
  // 结果与 designFrame 矩阵作用于 (u, 0, v)、或 local(site.design, u, y, v) 的平移量逐位相同
  const tx = qx + DESIGN_ORIGIN.x
  const tz = qz + DESIGN_ORIGIN.z
  const toWorld = (u, v) => [COS * u + SIN * v + tx, -SIN * u + COS * v + tz]
  return {
    project,
    buildings,
    spot,
    qx,
    qz,
    square: frame(qx, 0, qz, 0),
    design: designFrame(qx, qz),
    toWorld,
    toWorldPts: (pts) => pts.map(([u, v]) => toWorld(u, v))
  }
}

/* ---------------- 布局常量（多个分区共用） ---------------- */

/**
 * 东西林带内侧的南北步道（设计系，报告 3.2：步道 u ±99～±111、约 11 m 宽；6.7：路径 u ≈ ±105）：
 * 人流走中间 4 m，v −78 → 73，每米人数系数 density 1。trees.js 据此建步行路径并让开树冠，
 * furniture.js 据此摆两侧路灯。北端离北缘灯杆（v −83）5 m；南端停在南侧两条草带（v 77.5 起，
 * 东带伸到 u 111、西带到 u −113）以北 4.5 m
 */
export const BELT_PATH = { u: 105, width: 4, v0: -78, v1: 73, density: 1 }

/**
 * 北侧组团地坪（north.js、statue.js、science.js 共用）：像与科技馆之间广场铺装的顶面，也是 OSM 高度的起算面。
 * 比城市地面（GROUND_Y −0.5）高 1.5 m、比道路面最高处（0.9）略高，免得哪段路面压上来；
 * 广场南侧的天府广场铺装是 PAVE 1.5，这里低 0.5 m，中间隔着一条道路，看不出高差。
 * 放在这里而不放 north.js：statue.js、science.js 都要用，north.js 又要导入它们，放 north.js 会循环导入
 */
export const NORTH_Y = 1.0

/* ---------------- 颜色表（广场与北侧组团） ---------------- */

export const C = {
  // 地面（报告 6.9；Esri 实测浅鱼 RGB(190,179,161)、深鱼 RGB(128,115,98)，见报告 3.2）
  pave: "#D8D0C2", // 浅色外板与浅色阳鱼（同色：大圆北半看不出边界）
  yin: "#776E64", // 深色阴鱼
  lamp: "#3C3A38", // S 线上的深色地灯带（照片 c16）
  grass: "#7DB653", // 广场草坪
  flowerRed: "#C8372D", // 草坪外圈花带红底（照片 c22、c18）
  // 花带里的黄色祥云块：照片 c22 黄花中位色约 #E1C740；报告 6.9 的 #F2C230 饱和度高，
  // 在红底上显得刺眼，取两者之间略降饱和的 #E6C547
  flowerYellow: "#E6C547",
  // 太阳神鸟盘（报告 6.2、6.9；照片 old2、c13）
  sunGold: "#E2B54A", // 金色盘面、旋纹光芒
  sunGoldDeep: "#C08A2E", // 细金环、太阳外缘环（比盘面深一档，俯视才分得开）
  sunRed: "#D8532F", // 红橙色太阳
  sunSilver: "#D9DCE0", // 银鸟、盘沿不锈钢包边
  discSide: "#24221F", // 鼓座黑色石材侧面
  discRing: "#4A443E", // 鼓座外一圈深色环
  // 鱼眼水池与雕塑（报告 6.3、6.9；照片 c29 取色：外池壁灰绿 RGB(125,131,122)、内池壁深绿 RGB(66,76,73)、
  // 盘沿 RGB(197,197,194)、白杆 RGB(236,241,238)，均为背光面，这里各提亮一档）。Task 5 东鱼眼共用
  water: "#5E9AA3", // 水面
  marbleLight: "#8C978E", // 外池壁：浅灰绿大理石
  marbleDark: "#3F4E48", // 内池壁：深绿大理石
  bronze: "#2E3A33", // 雕塑柱身：深青铜色
  tray: "#5E8F80", // 雕塑托盘：青绿色（新浪 2007-01-09「浅绿色圆盘」）
  trayRim: "#CDD0CB", // 托盘外沿的浅色包边
  sculptGold: "#D9AE4A", // 金龙飘带、柱身金箍
  goldPattern: "#A9873F", // 托盘底面的金色回纹、云纹带（金纹嵌在青绿底上，远看比纯金暗一档）
  sculptPole: "#ECEFEB", // 托盘上的白杆
  // 东鱼眼下沉广场（报告 6.4、6.9；照片 c00、c07、c09～c12、c25～c27 取色，背光面提亮一档）
  relief: "#B5624F", // 坑壁上部 2.4 m 红褐色浮雕带（报告 6.9）
  reliefShade: "#A85A48", // 浮雕带隔段的暗一档：相邻两段交替，读出浮雕起伏
  fascia: "#E2DFD8", // 浮雕带下沿的浅色檐口线（c07、c11）
  soffit: "#C9C6BF", // 店面上方的浅灰吊顶
  shopGlass: ["#3E5560", "#4A6670", "#35474F"], // 地下一层店面玻璃，相邻店铺轮换
  shopSign: ["#23282E", "#2B4269", "#23282E", "#5C2E2C"], // 店招带：深灰为主，夹蓝、红店招（c00、c12）
  shopColumn: "#CBA45C", // 店面前一排黄色圆柱（c11、c12）
  pitFloor: "#C8C2B7", // 坑底与放射步道：浅灰石材（c27；卫星图上中心与步道同色）
  skyGlass: "#6E9EA3", // 采光顶玻璃（报告 6.9）
  railGlass: "#7F9F99", // 玻璃栏板：比采光玻璃灰绿一档（c00、c26）
  rail: "#2F4A3E", // 深绿栏杆扶手（报告 6.9）
  glassFrame: "#D3D8D6", // 玻璃雨棚的浅色竖框
  pavilionGlass: "#8DB9BC", // A、B 玻璃亭：浅青绿玻璃（c27、c10）
  pavilionRoof: "#DADDDA", // 玻璃亭顶板
  metroSign: "#2C4466", // 地铁口蓝灰色立牌（c11、c27）
  stairStone: "#BFB8AD", // 大台阶石材
  columnGreen: "#2F5242", // 东鱼眼柱身：墨绿底（c00、c09，比西鱼眼的青铜色更绿）
  // 北缘喷泉池、国旗台（Task 6；报告 3.2、6.5，照片 c19、old3，影像 e_flag、g_flag）
  jet: "#F4FAFF", // 喷泉水柱（动画 Mesh，沿用旧条形喷泉的颜色）
  poolRim: "#7C8279", // 喷泉池沿：灰绿花岗岩（c19 池沿中位色提亮一档）
  poolWall: "#646A62", // 池内隔墙：比池沿暗一档，俯视时隔格分得开
  hedge: "#3F7B3B", // 池北连续绿篱（代替 old3 里那排灌木球）
  flagStage: "#D6A69C", // 国旗台：粉红色石材（报告 6.5，e_flag、g_flag）
  flagPole: "#DCDFE2", // 不锈钢旗杆
  flagRed: "#D8262C", // 国旗、北缘灯杆上的小红旗
  // 凤鸟路灯（c15、c19、old3）
  lampPole: "#5E625F", // 灯杆与弯臂：深灰金属
  lampBulb: "#F4F1E4", // 火炬形白色灯罩
  // 南侧构筑物（报告 3.2「南缘」「东侧玻璃构筑物」）
  canopy: "#F7F6F2", // 「天书」雨棚：白色（影像里是广场上最亮的一块，比铺装 #D8D0C2 亮得多）
  canopyGlass: "#5E8088", // 雨棚下的玻璃围护：深青，衬出上面的白色屋面（浅色玻璃与白屋面、浅铺装糊成一片）
  canopySeam: "#4B4E50", // 雨棚书脊上的深灰缝：两片书页的分界，俯视读出「摊开的书」
  stairDark: "#4A4F53", // 东入口下沉楼梯口深处（暗面，读出往下走）
  slopeWall: "#A7A196", // 东南构筑物草坡的石材挡墙
  channel: "#55585A", // 草坡里嵌的硬质槽带：深灰（影像里是暗色凹槽，不是浅色凸条）
  whiteGlass: "#E6EDEF", // 白色斜玻璃：东南构筑物那块、东入口斜罩
  // 东西林带（报告 3.2「东西林带」：乔木密植）
  forestFloor: "#4A7A3A", // 林下草地：深绿，比广场草坪暗得多，树冠之间露出的地面也读成林下
  // 林带乔木树冠：取城市通用树（theme.tree.greens）里偏深的两种，再加两种更深的，林带读成一片深绿
  forest: ["#4FAE4A", "#5DA846", "#3F9443", "#6CC04A"],
  // 北侧组团（Task 7；报告 2.2、6.8、6.9，照片 c15、c21、c22，影像 e_statue、g_statue）
  // 像与科技馆之间的广场：Google 影像里是浅色石材，比广场外板略灰；分格线暗一档
  northPave: "#D3CBBE",
  northGrid: "#B3AA9D",
  // 毛主席像组团
  pedestal: "#8A3F35", // 深红花岗岩台座（报告 6.9）；像两侧缺口里的斜面、斜坡边的挡墙同色
  statueBase: "#9B4A3E", // 像的红色基座（OSM salmon；c15 里比台座亮一档）
  statue: "#F2EFE7", // 白色大理石立像
  slopeGrass: "#5E9447", // 两侧草坡（影像里是深绿色，比广场草坪暗）
  // 阶梯花坡每级的立面：橙红。报告 6.9 的橙 #E8742A 在 1.2 m 高的立面上连成一道道亮条，
  // 比照片 c15（整片红花）跳得多，取红、橙之间的 #D2512E，花坡整体读成红橙色（c21、用户航拍）
  flowerRise: "#D2512E",
  flowerWhite: "#F3EFE6", // 花坡台面上的白色图案（c15 红底白纹）
  railing: "#C5C9C9", // 台座顶上一圈矮栏（c15：浅灰金属栏杆）
  roofGrey: "#8E8C87", // SE 餐厅、科技馆屋面（Google 影像：灰色）
  // 四川科技馆（报告 6.8、6.9）
  sciWall: "#E6D6AA", // 米黄墙与塔身
  sciRed: "#A9563E", // 塔顶 1.2 m 压顶、柱廊横梁、两翼腰线、檐口：赭红
  sciColumn: "#B9705C", // 柱身：赭红
  sciWhite: "#F1EEE6", // 柱头、柱础、楼顶招牌的白色框架与英文底板
  sciGlass: "#2E3A4A", // 柱间深色玻璃、SE 餐厅北墙店面
  sciWindow: "#56606C", // 立面窗
  sciVault: "#6C7B83", // 内院大厅的拱顶（影像：深灰蓝的玻璃金属顶）
  sign: "#D8352A" // 楼顶红字与英文条
}

/* ---------------- 通用小函数 ---------------- */

/**
 * 由三角形列表建几何体：tris 为 [[p, q, r], ...]，每个点 [x, y, z]，法线按面计算（kit fromTriangles）。
 * 楔形雨棚、旗面这类手拼的几块面用它，比平铺坐标数组好读
 */
export const triMesh = (tris) => fromTriangles(tris.flat(2))

/** 设计系轴向矩形 [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]（不重复首点；北缘水池、雨棚、挖口等用） */
export const rectUV = (u0, u1, v0, v1) => [
  [u0, v0],
  [u1, v0],
  [u1, v1],
  [u0, v1]
]

/**
 * 两点之间的圆柱（a、c 为父坐标系 [x, y, z]），用于雕像手臂、灯臂等斜杆。
 * opts 默认 8 段、封顶（雕像手臂沿用）；细小的灯臂可传 { segments: 3, caps: false } 省三角形
 */
export function strut(
  b,
  parent,
  a,
  c,
  r0,
  r1,
  color,
  { segments = 8, caps = true } = {}
) {
  const dir = new Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2])
  const len = dir.length()
  const q = new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    dir.normalize()
  )
  const m = new Matrix4().compose(new Vector3(...a), q, new Vector3(1, 1, 1))
  b.add(
    cylinder(r0, r1, len, { segments, caps }),
    color,
    parent.clone().multiply(m)
  )
}

/* ---------------- 平面三角化（地面、神鸟盘、西鱼眼共用） ---------------- */

/**
 * 去掉相邻的重复点（含末点与首点重合）：几段弧线首尾拼接时接点会出现两次，
 * earcut 遇到零长度边容易漏三角形
 * @param {Array<[number, number]>} poly
 * @returns {Array<[number, number]>} 新数组
 */
export function cleanRing(poly, eps = 1e-6) {
  const out = []
  for (const p of poly) {
    const q = out[out.length - 1]
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p)
  }
  while (
    out.length > 1 &&
    Math.hypot(
      out[0][0] - out[out.length - 1][0],
      out[0][1] - out[out.length - 1][1]
    ) <= eps
  ) {
    out.pop()
  }
  return out
}

/**
 * 平面多边形（可带洞）三角化：three 的 ShapeUtils（earcut），外轮廓、洞的绕向任意。
 * 点为 [x, z]（本景点里一般是设计系 [u, v]）；洞须在外轮廓内、彼此不相交。
 * @returns {Array<Array<[number, number]>>} 三角形数组 [[a, b, c], ...]（绕向未定，写入时由 pushUp 调整）
 */
export function triangulate(outer, holes = []) {
  const rings = [cleanRing(outer), ...holes.map((h) => cleanRing(h))]
  const verts = rings.flat()
  const v2 = (ring) => ring.map(([x, z]) => new Vector2(x, z))
  const faces = ShapeUtils.triangulateShape(
    v2(rings[0]),
    rings.slice(1).map(v2)
  )
  return faces.map(([i, j, k]) => [verts[i], verts[j], verts[k]])
}

/**
 * 把一个三角形写进平铺坐标数组 pos，绕向调成法线朝上（y 分量 > 0）。
 * 点为 [x, z]，高度由 yAt(x, z) 给出（水平面传常数函数，神鸟盘倾斜顶面传平面方程）。
 * 法线 y 分量 = (b − a).z·(c − a).x − (b − a).x·(c − a).z，为负时交换 b、c
 */
export function pushUp(pos, [a, b, c], yAt) {
  const cr = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1])
  const [p, q] = cr >= 0 ? [b, c] : [c, b]
  for (const [x, z] of [a, p, q]) pos.push(x, yAt(x, z), z)
}

/** 平面多边形（可带洞）铺成朝上的面，高度由 yAt(x, z) 给出（常数函数即水平面，平面方程即斜面） */
export function addSurface(b, f, outer, holes, yAt, color) {
  const pos = []
  for (const t of triangulate(outer, holes)) pushUp(pos, t, yAt)
  b.add(fromTriangles(pos), color, f)
}

/** 实心棱柱：竖直侧墙一种颜色、顶面另一种颜色（extrudePolygon 只有一种颜色；屋面与墙面分色时用这个） */
export function addPrism(b, f, outer, holes, y0, y1, wallColor, topColor) {
  b.add(sideWalls(outer, y0, y1), wallColor, f)
  for (const h of holes) b.add(sideWalls(h, y0, y1, true), wallColor, f)
  addSurface(b, f, outer, holes, () => y1, topColor)
}

/*
 * 天府熊猫塔（原四川广播电视塔，高 339 m，成华区猛追湾府河边）
 * ----------------------------------------------------------
 * 构成（自下而上，尺寸依 OSM 按施工论文画的 3D 分件与资料照片）：
 *   1. 基台：63 × 63 m 方台、高 10.2 m，西南角（朝「成都 339」一侧）斜切；
 *      顶面一圈露天环形平台，中间是环形观赏水池；四周绿色护坡；东南角两道斜向大台阶；
 *   2. 四根白色斜撑：离塔心 42 m 的地面脚点向塔身收拢，约 55 m 高处并入塔身的「四条腿」；
 *   3. 悬盘（下塔楼，第一只「盖碗」）：暗红镜面玻璃扁锥台（底径 54），中部一道白色环带，
 *      上有两道环板；悬在四根斜撑之间，底下透空、下面就是环形水池；
 *   4. 塔身：八边形白色芯筒 + 与斜撑同方位的四条腿（自下而上收细），
 *      朝西南（机位）一面贴深色玻璃观光电梯井；
 *   5. 上塔楼（第二只「盖碗」，主视觉）：下部三道白色开敞平台 + 暗红近褐倒锥台幕墙，
 *      四条腿在其下方「四臂张开」，尖端直抵塔楼最宽处的白色室外观光平台（四角各一个玻璃挑台）；
 *      其上浅灰锥形顶盖、白色短筒；
 *   6. 塔顶：白色方筒 + 方平台 + 分四段收细的钢桅杆（直径按插画加粗 ×2），
 *      三处分段节点做成小球（照片里桅杆上的节点），顶部 20 m 红白相间警示色；
 *   7. 南侧广场：铺装地坪、几棵树，以及一只约 12 m 高的低多边形坐姿熊猫雕塑。
 *      **熊猫是插画装饰，真实的塔上与塔下都没有熊猫实体**（熊猫只出现在塔名与灯光秀里），
 *      界面文案不得把它说成真实构件。
 * 返回 walkways：猛追湾滨河步道（塔西北、府河东南岸）、基台顶环形平台、
 * 南侧广场上绕熊猫一圈与沿基台南侧的一段步道。
 *
 * 方位：OSM 四个斜撑脚（way 1346091170 / 1346091172 / 1346091182 / 1346091184）与
 * 基台（way 459158599）四边中点实测都在 343°、73°、163°、253°（误差约 1°，OSM roof:direction 一致）。
 * 设计文档初稿写的「17° / 107°」把逆时针 17° 当成了顺时针方位角，这里按 OSM 实测取这四个方位。
 * 局部坐标系 F 的 −Z 指向 343°（北斜撑），于是 +X → 73°（东）、+Z → 163°（南）、−X → 253°（西），
 * 四根斜撑与四条腿正好落在 ±X、±Z 四个轴上；下文注释里的 (u, v) 即 F 的局部 (x, z)。
 *
 * 尺度：塔本身已是全城最高点，不做放大；只把钢桅杆加粗一倍，否则远景里看不见。
 * 「成都 339」裙楼、339 OFFICE B 座、C 座不属于本模块，保持通用楼不动（B 座紧贴基台东侧北半段，
 * 那一段不做护坡；339 裙楼东北角贴着西斜撑脚）。
 */
import { BackSide, CylinderGeometry, Mesh } from "three"
import { THEME } from "../theme.js"
import { GROUND_Y } from "../terrain.js"
import {
  ColorBuilder,
  flatMaterial,
  frame,
  landmarkMaterial,
  local
} from "./kit/builder.js"
import { circlePolygon, findBuilding } from "./kit/footprint.js"
import {
  annulus,
  box,
  cylinder,
  extrudePolygon,
  fromTriangles,
  prism,
  sphere
} from "./kit/shapes.js"
import { addPanda, addTree } from "./kit/figures.js"

const L = THEME.landmark

/* ---------------- 定位 ---------------- */

// 局部坐标系 −Z 的方位（北斜撑方向），见文件头「方位」
const AXIS_BEARING = 343

/* ---------------- 基台 ---------------- */

// 半边长：OSM 基台四边中点离塔心 31.3～31.7 m（资料 63 × 63 m）
const BASE_HALF = 31.5
// 基台顶：OSM height 10.2（资料 15.4 m 含四周下沉层）
const BASE_H = 10.2
// 西南角斜切：OSM 基台轮廓在此是一条 45° 斜边，两端离角点约 15.5 m
const CHAMFER = 15.5
// 护坡：从基台边缘向外 SKIRT_RUN 米坡降到地面；坡顶比台顶低 1.2 m，露出一圈白色檐口
const SKIRT_RUN = 8
const SKIRT_TOP = 9.0
// 台顶四周白色女儿墙（高、厚、离外沿的内收量）
const PARAPET = { h: 1.0, w: 0.5, inset: 0.25 }
// 东南角两道斜向大台阶（OSM 1346420812 / 1346420813）：沿东南对角线（方位 118°）向外下行，
// 两道分列对角线两侧 x 米；z 为沿对角线离塔心的距离：顶部平台 z0～z1，踏步 z1～z2
const FLIGHT = { x: 10.8, width: 5, z0: 31, z1: 36.5, z2: 55.5, steps: 10 }

// 基台轮廓（局部 [u, v]）：西北 → 东北 → 东南 → 西南斜切两端
const BASE_POLY = [
  [-BASE_HALF, -BASE_HALF],
  [BASE_HALF, -BASE_HALF],
  [BASE_HALF, BASE_HALF],
  [-BASE_HALF + CHAMFER, BASE_HALF],
  [-BASE_HALF, BASE_HALF - CHAMFER]
]
// 护坡沿线（开放折线）：北面止于 u = 29（B 座西墙在 u ≈ 30.5 处向北延伸），
// 经西北角、西面、斜切、南面、东南角，东面止于 v = −8（B 座南缘在 v ≈ −11）
const SKIRT_LINE = [
  [29, -BASE_HALF],
  BASE_POLY[0],
  BASE_POLY[4],
  BASE_POLY[3],
  BASE_POLY[2],
  [BASE_HALF, -8]
]

// 环形水池（台顶）：水面内外半径、池沿宽与高、水面离台顶的高度
const POOL = { rIn: 16, rOut: 24, rim: 0.6, rimH: 0.7, water: 0.4 }

/* ---------------- 塔身 ---------------- */

// 八边形芯筒：边心距 6（宽 12），从台顶到上塔楼内部
const CORE = { apothem: 6, y1: 241 }
// 四条腿（截面：切向宽 w、径向从芯筒内 rIn 到外缘 rOut），自下而上收细
const LEG = { y1: 196, rIn: 5.5, rOut0: 10.5, rOut1: 8, w0: 6, w1: 5 }
// 四根斜撑：地面脚点离塔心 footR（轴线），沿直线升到 midY 高、离塔心 midR 处，
// 再沿同一直线延伸到 endY 埋进腿与芯筒（两者在约 55 m 处连成一体）；
// t 为水平截面的径向厚度（板厚 4 m、倾角约 30° 换算），w0 → w1 为切向宽。
// footR 取 39.7：外表面 footR + t/2 ≈ 42 m，与 OSM 斜撑脚外缘（离塔心约 42 m）对齐
const BRACE = {
  footR: 39.7,
  midY: 50.5,
  midR: 10.5,
  endY: 57,
  t: 4.7,
  w0: 6.4,
  w1: 5.6
}
// 四臂张开：腿顶沿外撇斜线伸到上塔楼最宽处，尖端收窄（OSM 193～223 m、半径 7 → 18.4，
// 照片里尖端直抵塔楼顶沿，高度按照片比例取到 235 m）
const ARM = {
  y0: 193,
  y1: 235,
  rIn0: 5.5,
  rOut0: 8.1,
  rIn1: 17,
  rOut1: 19.6,
  w0: 5,
  w1: 1
}
// 观光电梯井：贴在朝西南（机位）的斜面上，宽 3、外凸 1.2，从台顶直通上塔楼底
const LIFT = { y1: 216, w: 3, d: 1.2 }

// 悬盘（下塔楼）：扁锥台 r0 → r1（OSM 21.65～35.9 m、外半径 27），band 处一道白色环带；
// 上面锥形屋面、两道环板（OSM 40.7～41.7 m r 14.5；47.7～48.2 m r 10.5）和中间的深色内筒
const POD1 = {
  y0: 21.65,
  y1: 35.9,
  r0: 27,
  r1: 20,
  band: 28.4,
  bandH: 0.8,
  soffitR: 6.5,
  roofY: 36.5,
  roofH: 2.8,
  roofR: 14.2,
  plate1: [40.7, 1.0, 14.6],
  plate2: [47.7, 0.5, 10.8],
  drum: [36, 48.2, 9.2]
}

// 上塔楼：下部深色内筒 + 三道白色开敞平台（资料「下两层是没有外墙的微波天线平台」），
// 暗红倒锥台 cone（上宽下窄，分三段略向外鼓，像碗），最宽处白色室外观光平台 deck（挑出约 1.5 m），
// 其上浅灰锥形顶盖 lid、白色短筒 drum（高度按照片比例，总高约 46 m 与资料一致）。
// 标高说明：资料里的「218 m 室外观光层」以进塔平台（基台顶 +10.2 m）为零点，绝对高度约 228 m；
// 这里按照片比例把观光平台放在塔楼最宽处 234 m（与四臂尖端同高）
const POD2 = {
  drum: [198, 214, 9.5],
  rings: [200.5, 205, 209.5],
  ringR: 12.2,
  ringH: 1.2,
  cone: [214, 234, 11.5, 18],
  // 倒锥台外鼓量（米）：半径 = 线性值 + bulge · sin(π·t)，t 为段内高度比例
  bulge: 0.6,
  coneSegs: 3,
  lines: [218.5, 223.5, 228.5],
  deck: [234, 0.9, 19.6],
  rail: [234.9, 1.1, 19.4],
  lid: [234.9, 240.4, 18.4, 11.5],
  lidBand: 237,
  topRing: [240.4, 0.8, 12],
  top: [241.2, 246.2, 7.5],
  topCap: [245.8, 0.6, 8.3]
}

// 塔顶白色方筒 + 方平台（OSM 边长 4.2 / 6.7，这里取 5 / 7）
const SHAFT = { y0: 246.2, y1: 267, side: 5 }
const TOP_DECK = { y: 267, h: 0.6, side: 7 }
// 钢桅杆分段 [底, 顶, 底边长, 顶边长]：OSM 边长 1.8 → 1.1，插画加粗 ×2
const MAST = [
  [267.6, 296.2, 3.6, 3.4],
  [296.2, 309.2, 2.6, 2.5],
  [309.2, 321.7, 2.2, 2.1],
  [321.7, 337, 2.0, 1.6]
]
// 桅杆节点小球 [高度, 半径]：前三个在分段处（照片里的三个节点），最后一个在避雷针下
const MAST_NODES = [
  [296.2, 2.7],
  [309.2, 2.3],
  [321.7, 2.1],
  [334.5, 1.8]
]
const MAST_TOP = 339
// 顶部 20 m 红白相间警示色，每段 4 m（自下而上 红、白、红、白、红）
const WARN = { y0: 319, band: 4 }

/* ---------------- 南侧广场与熊猫 ---------------- */

// 广场铺装顶面（与其他景点一致，铺装不低于 1.0 m，免得与路面错层）
const PLAZA_Y = 1.0
// 广场轮廓（局部 [u, v]）：北缘、西北缘伸到护坡底下 2 m（坡脚在 39.5，37.5 处护坡面高 1.9 m，
// 盖住铺装边，不留小沟），西离 339 裙楼东缘约 2 m，
// 东南离猛追湾街（城市主干道，路缘半宽 12 m）约 2.5 m 以上
const PLAZA = [
  [-12, 37.5],
  [37.5, 37.5],
  [37.5, 20],
  [54, 22],
  [58, 34],
  [52, 48],
  [34, 62],
  [16, 76],
  [-4, 86],
  [-16, 80],
  [-10.3, 62]
]
// 熊猫雕塑（插画装饰）：位置 (u, v)、身高（坐姿，脚底到耳尖）、面朝方位（朝机位）、底座
const PANDA = {
  u: 12,
  v: 57,
  height: 12,
  facing: 215,
  plinthR: 5.6,
  plinthH: 1.1
}
// 广场树 [u, v, 树冠半径]：避开步行路径与熊猫
const TREES = [
  [-5, 72, 3.6],
  [5, 80, 3.4],
  [29, 58, 3.0],
  [50, 40, 3.0],
  [-8, 55, 3.2]
]

/* ---------------- 步行路径 ---------------- */

// 猛追湾滨河步道：城市河道带（中心线两侧各 24 m）东南边外约 4.5 m，
// 由河道中心线向东南偏移 28.5 m 得到，逐米核对过不落水、不进楼；地面高度 GROUND_Y
const RIVER_WALK = {
  lonlat: [
    [104.093269, 30.665465],
    [104.092895, 30.665407],
    [104.092389, 30.66538],
    [104.091905, 30.665242],
    [104.091539, 30.665033],
    [104.091124, 30.66485],
    [104.090974, 30.664664],
    [104.090848, 30.664434],
    [104.090773, 30.664321]
  ],
  width: 4,
  density: 2.2
}
// 基台顶环形平台：水池外沿（24.6）与斜撑内表面之间（斜撑在人头高度 14.55 m 处离塔心约 28.7 m）；
// 头顶是悬盘底（21.65 m）
const RING_WALK = { r: 26.6, n: 28, width: 1.8, density: 3 }
// 广场：绕熊猫一圈（底座半径 5.6）
const PANDA_WALK = { r: 10.5, n: 20, width: 2, density: 3 }
// 广场：沿基台南面护坡脚的一段（北让南斜撑脚，东端止于绕熊猫环之前，两条路不重叠）
const PLAZA_WALK = { v: 45, u0: -10, u1: 7, width: 3, density: 3 }

/* ---------------- 配色 ---------------- */

const C = {
  deck: "#E4DFD4", // 基台本体与台顶（浅暖灰石材）
  parapet: "#F7F6F1", // 台顶女儿墙（亮白，远看勾出基台轮廓）
  skirt: "#8CCB5A", // 护坡草坡
  poolRim: L.marble,
  pool: "#6ED3E8", // 环形水池水面
  white: "#F4F4F0", // 白色结构：斜撑、腿、四臂、环板
  core: "#DCE1E4", // 八边形芯筒（比腿略灰，显出竖向肋）
  lift: "#2F3A40", // 观光电梯井深色玻璃
  pod1Low: "#8A2E3A", // 悬盘暗红镜面玻璃（下半）
  pod1High: "#9B3845", // 悬盘上半略亮，模拟镜面反光
  soffit: "#EFEEE9", // 悬盘底面
  podRoof: "#D5D9DC", // 悬盘锥形屋面、上塔楼顶盖（浅灰）
  drum: "#454C54", // 开敞平台后面的深色内筒
  // 上塔楼暗红近褐幕墙：设计值 #5B2430 在光照下近乎黑褐，远景认不出「红盖碗」，
  // 同色相提高饱和度与明度
  pod2: "#6E2232",
  pod2Line: "#7C3A46", // 上塔楼楼层线
  lidBand: "#C8442E", // 顶盖上的一道红色细带
  rail: "#DDE3E6", // 观光平台栏杆
  balcony: "#BFE3EE", // 四角玻璃挑台
  mast: "#9CA3AB", // 银灰钢桅杆
  node: "#C9CED3", // 桅杆节点小球
  warnRed: "#D8433A",
  warnWhite: "#F4F4F0",
  mark: "#9AA2A8", // 方筒上的竖向刻字色块
  step: "#D9D4C9", // 台阶
  plaza: L.stonePave, // 广场铺装
  plinth: L.marble, // 熊猫底座
  plinthTrim: "#A7AAAF" // 底座顶沿
}

/* ---------------- 几何小工具 ---------------- */

/**
 * 三角形绕向朝外：对平铺三角形坐标数组 pos 逐个检查面法线（右手定则），
 * 若 outward(三角形中心, 法线) 为假就交换后两个顶点。
 * 材质双面，绕向本不影响着色；但主体 Mesh 的阴影只画背光面（shadowSide = BackSide，
 * 避免高塔白色立面上的自阴影条纹），绕向必须与真实朝外方向一致。
 */
function orient(pos, outward) {
  for (let k = 0; k < pos.length; k += 9) {
    const ax = pos[k + 3] - pos[k]
    const ay = pos[k + 4] - pos[k + 1]
    const az = pos[k + 5] - pos[k + 2]
    const bx = pos[k + 6] - pos[k]
    const by = pos[k + 7] - pos[k + 1]
    const bz = pos[k + 8] - pos[k + 2]
    const n = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]
    const c = [0, 1, 2].map(
      (j) => (pos[k + j] + pos[k + 3 + j] + pos[k + 6 + j]) / 3
    )
    if (!outward(c, n)) {
      for (let j = 0; j < 3; j++) {
        const t = pos[k + 3 + j]
        pos[k + 3 + j] = pos[k + 6 + j]
        pos[k + 6 + j] = t
      }
    }
  }
  return pos
}

/**
 * 由底面、顶面各 4 个角点围成的六面体（斜撑、腿、四臂、台阶挡墙用），不含底面。
 * 角点 [x, y, z]：底面 0..3 与顶面 4..7 一一对应、绕向一致；各面法线统一朝外（背离体心）。
 */
function hexa(p) {
  const [a, b, c, d, e, f, g, h] = p
  const pos = []
  const quad = (p0, p1, p2, p3) =>
    pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3)
  quad(e, f, g, h)
  quad(a, b, f, e)
  quad(b, c, g, f)
  quad(c, d, h, g)
  quad(d, a, e, h)
  const o = [0, 1, 2].map((j) => p.reduce((sum, q) => sum + q[j], 0) / 8)
  return fromTriangles(
    orient(
      pos,
      (ct, n) =>
        [0, 1, 2].reduce((sum, j) => sum + n[j] * (ct[j] - o[j]), 0) > 0
    )
  )
}

/**
 * 沿局部 +Z 方向伸出的「刀片」：底面在 y0（径向 zi0～zo0、切向宽 w0），
 * 顶面在 y1（径向 zi1～zo1、切向宽 w1）。腿、斜撑、四臂都用它，再绕 Y 轴转到四个方向。
 */
function blade(y0, zi0, zo0, w0, y1, zi1, zo1, w1) {
  const a = w0 / 2
  const b = w1 / 2
  return hexa([
    [-a, y0, zi0],
    [a, y0, zi0],
    [a, y0, zo0],
    [-a, y0, zo0],
    [-b, y1, zi1],
    [b, y1, zi1],
    [b, y1, zo1],
    [-b, y1, zo1]
  ])
}

/**
 * 上下都封口的圆柱 / 圆台（悬空的环板、平台用），底在 y = 0。
 * kit 的 cylinder(caps) 只封顶：悬空构件缺了朝下的底面，阴影贴图里就没有它（会漏光）
 */
function closedCylinder(rBottom, rTop, h, segments = 32) {
  const g = new CylinderGeometry(rTop, rBottom, h, segments, 1, false)
  g.translate(0, h / 2, 0)
  return g
}

/** 实心圆环（池沿）：内外两道竖壁 + 顶面，底在 y = 0 */
function addRingSolid(b, parent, rIn, rOut, h, color, segments = 32) {
  b.add(cylinder(rOut, rOut, h, { segments }), color, parent)
  b.add(cylinder(rIn, rIn, h, { segments }), color, parent)
  b.add(annulus(rIn, rOut, segments), color, local(parent, 0, h, 0))
}

/**
 * 凸多边形外扩（d > 0）/ 内收（d < 0）：各边沿外法向平移 d，角点取相邻两边的斜接点。
 * 多边形须以原点为内点（本模块的基台轮廓以塔心为中心）。
 */
function offsetPolygon(pts, d) {
  const n = pts.length
  const normals = pts.map((p, i) => edgeNormal(p, pts[(i + 1) % n]))
  return pts.map(([x, z], i) => {
    const n1 = normals[(i + n - 1) % n]
    const n2 = normals[i]
    const k = d / (1 + n1[0] * n2[0] + n1[1] * n2[1])
    return [x + (n1[0] + n2[0]) * k, z + (n1[1] + n2[1]) * k]
  })
}

/** 线段 a → b 的单位法向，取背离原点（塔心）的一侧 */
function edgeNormal(a, b) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  let nx = (b[1] - a[1]) / len
  let nz = -(b[0] - a[0]) / len
  if (nx * (a[0] + b[0]) + nz * (a[1] + b[1]) < 0) {
    nx = -nx
    nz = -nz
  }
  return [nx, nz]
}

/**
 * 护坡：沿基台边缘的开放折线 line（局部 [u, v]），从坡顶 top（基台边缘）
 * 向外 run 米坡降到 bottom（地面）。折点处外缘取斜接点，两端各补一个竖直三角形封口。
 */
function skirtGeometry(line, top, bottom, run) {
  const segN = []
  for (let i = 0; i < line.length - 1; i++) {
    segN.push(edgeNormal(line[i], line[i + 1]))
  }
  const outer = line.map(([x, z], i) => {
    const n1 = segN[Math.max(0, i - 1)]
    const n2 = segN[Math.min(segN.length - 1, i)]
    const k = run / (1 + n1[0] * n2[0] + n1[1] * n2[1])
    return [x + (n1[0] + n2[0]) * k, z + (n1[1] + n2[1]) * k]
  })
  const T = (p) => [p[0], top, p[1]]
  const B = (p) => [p[0], bottom, p[1]]
  // 坡面：法线朝上（朝外上方）
  const pos = []
  for (let i = 0; i < line.length - 1; i++) {
    const a = T(line[i])
    const c = B(outer[i + 1])
    pos.push(...a, ...T(line[i + 1]), ...c, ...a, ...c, ...B(outer[i]))
  }
  orient(pos, (c, n) => n[1] > 0)
  // 封口：法线沿折线端头方向朝外
  const last = line.length - 1
  for (const [i, j] of [
    [0, 1],
    [last, last - 1]
  ]) {
    const cap = [...T(line[i]), ...B(line[i]), ...B(outer[i])]
    const dx = line[i][0] - line[j][0]
    const dz = line[i][1] - line[j][1]
    pos.push(...orient(cap, (c, n) => n[0] * dx + n[2] * dz > 0))
  }
  return fromTriangles(pos)
}

/** 父坐标系里的局部 [u, v] → 世界 [x, z]（parent 只含平移与绕 Y 旋转） */
function toWorld(parent, u, v) {
  const e = parent.elements
  return [e[12] + e[0] * u + e[8] * v, e[14] + e[2] * u + e[10] * v]
}

/* ---------------- 基台 ---------------- */

/** 基台本体、台顶女儿墙、护坡、环形水池、东南角大台阶 */
function addBase(b, F) {
  b.add(extrudePolygon(BASE_POLY, [], GROUND_Y, BASE_H), C.deck, F)
  b.add(skirtGeometry(SKIRT_LINE, SKIRT_TOP, GROUND_Y, SKIRT_RUN), C.skirt, F)

  // 女儿墙：沿内收 inset 的轮廓，东南两道台阶的顶口处断开（台阶从这里下到广场）。
  // 台阶在东面占 v ∈ [12.2, 20.3]、南面占 u ∈ [12.2, 20.3]（由 FLIGHT 的对角线位置算得）
  const q = offsetPolygon(BASE_POLY, -PARAPET.inset)
  const e = BASE_HALF - PARAPET.inset
  const gapA = 12.2
  const gapB = 20.3
  const runs = [
    // 东面台阶口 → 东南角 → 南面台阶口
    [[e, gapB], q[2], [gapB, e]],
    // 南面台阶口 → 西南斜切 → 西北角 → 东北角 → 东面台阶口
    [[gapA, e], q[3], q[4], q[0], q[1], [e, gapA]]
  ]
  for (const run of runs) {
    for (let i = 0; i < run.length - 1; i++) {
      const [x0, z0] = run[i]
      const [x1, z1] = run[i + 1]
      const len = Math.hypot(x1 - x0, z1 - z0)
      const yaw = Math.atan2(-(z1 - z0), x1 - x0)
      // 每段多伸出半个墙厚，转角处两段互相搭接不露缝
      b.add(
        box(len + PARAPET.w, PARAPET.h, PARAPET.w),
        C.parapet,
        local(F, (x0 + x1) / 2, BASE_H, (z0 + z1) / 2, yaw)
      )
    }
  }

  // 环形水池：内外池沿 + 水面
  const pool = local(F, 0, BASE_H, 0)
  addRingSolid(b, pool, POOL.rIn - POOL.rim, POOL.rIn, POOL.rimH, C.poolRim)
  addRingSolid(b, pool, POOL.rOut, POOL.rOut + POOL.rim, POOL.rimH, C.poolRim)
  b.add(
    annulus(POOL.rIn, POOL.rOut),
    C.pool,
    local(F, 0, BASE_H + POOL.water, 0)
  )

  addFlights(b, F)
}

/**
 * 东南角两道斜向大台阶：坐标系 S 的 +Z 沿东南对角线（方位 118°）向外。
 * 每道：顶部平台（比台顶低 0.25 m，与台顶不共面，免得远景闪烁）+ 10 级踏步下到广场，
 * 两侧白色挡墙随踏步斜降。
 */
function addFlights(b, F) {
  const S = local(F, 0, 0, 0, Math.PI / 4)
  const f = FLIGHT
  const rise = (BASE_H - PLAZA_Y) / (f.steps + 1)
  const run = (f.z2 - f.z1) / f.steps
  for (const side of [-1, 1]) {
    const x = side * f.x
    b.add(
      box(f.width, BASE_H - 0.25 - GROUND_Y, f.z1 - f.z0),
      C.deck,
      local(S, x, GROUND_Y, (f.z0 + f.z1) / 2)
    )
    for (let k = 0; k < f.steps; k++) {
      const top = BASE_H - (k + 1) * rise
      b.add(
        box(f.width, top - GROUND_Y, run),
        C.step,
        local(S, x, GROUND_Y, f.z1 + (k + 0.5) * run)
      )
    }
    // 挡墙：平台段顶在台顶 + 1 m；踏步段顶面从台顶 + 0.8 m 斜降到广场 + 1.4 m
    for (const s of [-1, 1]) {
      const wx = x + s * (f.width / 2 + 0.3)
      const wall = (z0, z1, y0, y1) =>
        hexa([
          [wx - 0.3, GROUND_Y, z0],
          [wx + 0.3, GROUND_Y, z0],
          [wx + 0.3, GROUND_Y, z1],
          [wx - 0.3, GROUND_Y, z1],
          [wx - 0.3, y0, z0],
          [wx + 0.3, y0, z0],
          [wx + 0.3, y1, z1],
          [wx - 0.3, y1, z1]
        ])
      b.add(wall(f.z0, f.z1, BASE_H + 1, BASE_H + 1), C.parapet, S)
      b.add(wall(f.z1, f.z2, BASE_H + 0.8, PLAZA_Y + 1.4), C.parapet, S)
    }
  }
}

/* ---------------- 塔身与悬盘 ---------------- */

/** 八边形芯筒、四条腿、四根斜撑、四臂、观光电梯井 */
function addShaft(b, F) {
  const coreR = CORE.apothem / Math.cos(Math.PI / 8)
  b.add(
    prism(8, coreR, coreR, CORE.y1 - BASE_H, { top: false }),
    C.core,
    local(F, 0, BASE_H, 0)
  )
  const br = BRACE
  // 斜撑轴线：地面 (footR, GROUND_Y) → (midR, midY)，延长到 endY
  const slope = (br.footR - br.midR) / (br.midY - GROUND_Y)
  const rEnd = br.footR - slope * (br.endY - GROUND_Y)
  const legLen = LEG.y1 - BASE_H
  for (let k = 0; k < 4; k++) {
    const m = local(F, 0, 0, 0, (k * Math.PI) / 2)
    b.add(
      blade(
        BASE_H,
        LEG.rIn,
        LEG.rOut0,
        LEG.w0,
        LEG.y1,
        LEG.rIn,
        LEG.rOut1,
        LEG.w1
      ),
      C.white,
      m
    )
    b.add(
      blade(
        GROUND_Y,
        br.footR - br.t / 2,
        br.footR + br.t / 2,
        br.w0,
        br.endY,
        rEnd - br.t / 2,
        rEnd + br.t / 2,
        br.w1
      ),
      C.white,
      m
    )
    // 四臂：腿顶（外缘按腿的收分算到 ARM.y0）→ 尖端
    const legOut =
      LEG.rOut0 + ((LEG.rOut1 - LEG.rOut0) * (ARM.y0 - BASE_H)) / legLen
    b.add(
      blade(
        ARM.y0,
        ARM.rIn0,
        Math.min(legOut, ARM.rOut0),
        ARM.w0,
        ARM.y1,
        ARM.rIn1,
        ARM.rOut1,
        ARM.w1
      ),
      C.white,
      m
    )
  }
  // 观光电梯井：朝西南（方位 208°）的斜面，即局部 (−1, 1)/√2 方向，嵌进芯筒 0.2 m
  const out = CORE.apothem + LIFT.d / 2 - 0.2
  b.add(
    box(LIFT.w, LIFT.y1 - BASE_H, LIFT.d),
    C.lift,
    local(F, -out * Math.SQRT1_2, BASE_H, out * Math.SQRT1_2, -Math.PI / 4)
  )
}

/** 悬盘（第一只「盖碗」）：底面、两段暗红锥面夹一道白环、顶沿、锥形屋面、内筒与两道环板 */
function addLowerPod(b, F) {
  const p = POD1
  const rAt = (y) => p.r0 + ((p.r1 - p.r0) * (y - p.y0)) / (p.y1 - p.y0)
  const seg = { segments: 32 }
  // 底面朝下：从塔下仰视可见，也在阴影贴图里挡住下面的环形水池与台顶
  b.add(annulus(p.soffitR, p.r0, 32, true), C.soffit, local(F, 0, p.y0, 0))
  const y1 = p.band
  const y2 = p.band + p.bandH
  b.add(
    cylinder(p.r0, rAt(y1), y1 - p.y0, seg),
    C.pod1Low,
    local(F, 0, p.y0, 0)
  )
  b.add(
    cylinder(rAt(y1) + 0.15, rAt(y2) + 0.15, p.bandH, seg),
    C.white,
    local(F, 0, y1, 0)
  )
  b.add(cylinder(rAt(y2), p.r1, p.y1 - y2, seg), C.pod1High, local(F, 0, y2, 0))
  b.add(
    closedCylinder(p.r1 + 0.4, p.r1 + 0.4, 0.6),
    C.white,
    local(F, 0, p.y1, 0)
  )
  const [d0, d1, dr] = p.drum
  b.add(cylinder(dr, dr, d1 - d0, seg), C.drum, local(F, 0, d0, 0))
  b.add(
    cylinder(p.r1, p.roofR, p.roofH, { segments: 32, caps: true }),
    C.podRoof,
    local(F, 0, p.roofY, 0)
  )
  for (const [y, h, r] of [p.plate1, p.plate2]) {
    b.add(closedCylinder(r, r, h), C.white, local(F, 0, y, 0))
  }
}

/**
 * 上塔楼（第二只「盖碗」）：深色内筒 + 三道白色开敞平台 + 暗红倒锥台（分段略外鼓成碗形，三道楼层线）
 * + 最宽处白色观光平台、栏杆与四角玻璃挑台 + 浅灰锥形顶盖（一道红带）+ 白色短筒。
 * 悬空的平台、环板一律上下封口（closedCylinder），阴影贴图里才有朝下的背光面
 */
function addUpperPod(b, F) {
  const p = POD2
  const seg = { segments: 32 }
  const capped = { segments: 32, caps: true }
  const [d0, d1, dr] = p.drum
  b.add(cylinder(dr, dr, d1 - d0, seg), C.drum, local(F, 0, d0, 0))
  for (const y of p.rings) {
    b.add(closedCylinder(p.ringR, p.ringR, p.ringH), C.white, local(F, 0, y, 0))
  }
  const [c0, c1, cr0, cr1] = p.cone
  // 碗形轮廓：线性收分上叠加 bulge · sin(π·t) 的外鼓，两端仍是 cr0 / cr1
  const rAt = (y) => {
    const t = (y - c0) / (c1 - c0)
    return cr0 + (cr1 - cr0) * t + p.bulge * Math.sin(Math.PI * t)
  }
  for (let i = 0; i < p.coneSegs; i++) {
    const ya = c0 + ((c1 - c0) * i) / p.coneSegs
    const yb = c0 + ((c1 - c0) * (i + 1)) / p.coneSegs
    b.add(cylinder(rAt(ya), rAt(yb), yb - ya, seg), C.pod2, local(F, 0, ya, 0))
  }
  for (const y of p.lines) {
    b.add(
      cylinder(rAt(y) + 0.12, rAt(y + 0.45) + 0.12, 0.45, seg),
      C.pod2Line,
      local(F, 0, y, 0)
    )
  }
  const [dy, dh, drr] = p.deck
  b.add(closedCylinder(drr, drr, dh), C.white, local(F, 0, dy, 0))
  const [ry, rh, rr] = p.rail
  b.add(cylinder(rr, rr, rh, seg), C.rail, local(F, 0, ry, 0))
  // 四角玻璃挑台（资料：218 m 室外观光层四角各一个透明玻璃挑台），朝四个对角方向
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2
    b.add(
      box(3.2, 2.6, 2.4, { bottom: true }),
      C.balcony,
      local(F, Math.sin(a) * 20.3, dy + dh, Math.cos(a) * 20.3, a)
    )
  }
  const [l0, l1, lr0, lr1] = p.lid
  b.add(cylinder(lr0, lr1, l1 - l0, capped), C.podRoof, local(F, 0, l0, 0))
  const lidR = (y) => lr0 + ((lr1 - lr0) * (y - l0)) / (l1 - l0)
  b.add(
    cylinder(lidR(p.lidBand) + 0.1, lidR(p.lidBand + 0.6) + 0.1, 0.6, seg),
    C.lidBand,
    local(F, 0, p.lidBand, 0)
  )
  for (const [y, h, r] of [p.topRing, p.topCap]) {
    b.add(closedCylinder(r, r, h), C.white, local(F, 0, y, 0))
  }
  const [t0, t1, tr] = p.top
  b.add(cylinder(tr, tr, t1 - t0, capped), C.white, local(F, 0, t0, 0))
}

/** 塔顶：白色方筒（四面竖向刻字色块）、方平台、分段钢桅杆、节点小球、警示色、避雷针 */
function addTop(b, F) {
  const s = SHAFT
  b.add(box(s.side, s.y1 - s.y0, s.side), C.white, local(F, 0, s.y0, 0))
  // 照片里方筒四面各有两列竖排刻字，远看是细长灰块
  for (let k = 0; k < 4; k++) {
    const m = local(F, 0, 0, 0, (k * Math.PI) / 2)
    for (const x of [-1.1, 1.1]) {
      b.add(
        box(0.7, 14, 0.12),
        C.mark,
        local(m, x, s.y0 + 3.5, s.side / 2 + 0.03)
      )
    }
  }
  const d = TOP_DECK
  b.add(
    box(d.side, d.h, d.side, { bottom: true }),
    C.podRoof,
    local(F, 0, d.y, 0)
  )

  // 桅杆：每段在警示色分界处再切开，按所在色带着色（方截面，外接半径 = 边长 / √2）
  const bandColor = (y) =>
    y < WARN.y0
      ? C.mast
      : Math.floor((y - WARN.y0) / WARN.band) % 2 === 0
        ? C.warnRed
        : C.warnWhite
  for (const [y0, y1, s0, s1] of MAST) {
    const ys = [y0]
    for (let y = WARN.y0; y < MAST_TOP; y += WARN.band) {
      if (y > y0 && y < y1) ys.push(y)
    }
    ys.push(y1)
    for (let i = 0; i < ys.length - 1; i++) {
      const a = ys[i]
      const c = ys[i + 1]
      const sa = s0 + ((s1 - s0) * (a - y0)) / (y1 - y0)
      const sc = s0 + ((s1 - s0) * (c - y0)) / (y1 - y0)
      b.add(
        prism(4, sa / Math.SQRT2, sc / Math.SQRT2, c - a),
        bandColor((a + c) / 2),
        local(F, 0, a, 0)
      )
    }
  }
  // 节点小球：压扁的球（竖向 0.55 倍），球心在节点高度
  for (const [y, r] of MAST_NODES) {
    b.add(sphere(r, 12, 6), C.node, local(F, 0, y - r * 0.55, 0, 0, 1, 0.55, 1))
  }
  const last = MAST[MAST.length - 1]
  b.add(
    cylinder(0.5, 0.06, MAST_TOP - last[1], { segments: 6 }),
    bandColor(MAST_TOP - 1),
    local(F, 0, last[1], 0)
  )
}

/* ---------------- 入口 ---------------- */

export function build(ctx) {
  const { buildings, project, spot } = ctx
  const b = new ColorBuilder()
  const pb = new ColorBuilder() // 熊猫单独一批（平面着色材质）
  const F = frame(spot.x, 0, spot.z, AXIS_BEARING)

  addBase(b, F)
  addShaft(b, F)
  addLowerPod(b, F)
  addUpperPod(b, F)
  addTop(b, F)

  // 南侧广场铺装
  b.add(extrudePolygon(PLAZA, [], GROUND_Y, PLAZA_Y), C.plaza, F)
  // 熊猫雕塑底座与熊猫（面朝机位方向）
  const [px, pz] = toWorld(F, PANDA.u, PANDA.v)
  const plinthTop = PLAZA_Y + PANDA.plinthH
  b.add(
    cylinder(PANDA.plinthR, PANDA.plinthR - 0.2, plinthTop - GROUND_Y, {
      segments: 20,
      caps: true
    }),
    C.plinth,
    local(null, px, GROUND_Y, pz)
  )
  b.add(
    annulus(PANDA.plinthR - 0.9, PANDA.plinthR - 0.2, 20),
    C.plinthTrim,
    local(null, px, plinthTop + 0.12, pz)
  )
  addPanda(pb, frame(px, plinthTop, pz, PANDA.facing + 180), {
    height: PANDA.height,
    pose: "sit"
  })

  // 广场树（按位置固定朝向，打散棱面）
  const greens = THEME.tree.greens
  TREES.forEach(([u, v, r], i) => {
    const [x, z] = toWorld(F, u, v)
    addTree(b, x, PLAZA_Y, z, {
      r,
      color: greens[i % greens.length],
      yaw: i * 1.3
    })
  })

  const meshes = []
  const g = b.bake()
  if (g) {
    const mat = landmarkMaterial()
    // 阴影贴图只画背光面，避免 339 m 高的白色塔身、斜撑在向阳面上出现自阴影条纹（做法同 IFS）。
    // 前提：挡光的构件都要有背光面——自建体块绕向已统一朝外（orient），悬空的底面朝下、
    // 平台与环板上下封口（annulus down / closedCylinder）；贴地的单层面（护坡、水面、铺装顶）不挡光，无妨
    mat.shadowSide = BackSide
    meshes.push(new Mesh(g, mat))
  }
  const pg = pb.bake()
  if (pg) meshes.push(new Mesh(pg, flatMaterial()))

  // 替换区：OSM「天府熊猫塔」整块挤出体（100 × 78、高 339）；查不到时按塔心 45 m 圆
  const ti = findBuilding(buildings, "天府熊猫塔", {
    near: [spot.x, spot.z],
    maxDist: 120
  })
  const zones = [
    ti >= 0 ? buildings[ti].p : circlePolygon(spot.x, spot.z, 45, 24)
  ]

  const walkways = [
    {
      points: RIVER_WALK.lonlat.map(([lon, lat]) => project.toLocal(lon, lat)),
      y: GROUND_Y,
      width: RIVER_WALK.width,
      closed: false,
      density: RIVER_WALK.density
    },
    {
      points: circlePolygon(...toWorld(F, 0, 0), RING_WALK.r, RING_WALK.n),
      y: BASE_H,
      width: RING_WALK.width,
      closed: true,
      density: RING_WALK.density
    },
    {
      points: circlePolygon(
        ...toWorld(F, PANDA.u, PANDA.v),
        PANDA_WALK.r,
        PANDA_WALK.n
      ),
      y: PLAZA_Y,
      width: PANDA_WALK.width,
      closed: true,
      density: PANDA_WALK.density
    },
    {
      points: [
        toWorld(F, PLAZA_WALK.u0, PLAZA_WALK.v),
        toWorld(F, PLAZA_WALK.u1, PLAZA_WALK.v)
      ],
      y: PLAZA_Y,
      width: PLAZA_WALK.width,
      closed: false,
      density: PLAZA_WALK.density
    }
  ]

  return {
    meshes,
    zones,
    // 定位针悬在塔尖上方；注视点随之抬到 169.5 m（塔身中部）
    markerHeight: MAST_TOP,
    walkways
  }
}

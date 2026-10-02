/*
 * 熊猫基地 · 南大门、熊猫铜像、南门广场草坪与喷泉、入园行道树
 * ----------------------------------------------------------
 * 规格：设计文档 4.4（南大门）、4.5（入园主路、熊猫铜像）、4.3「南门广场」，照片见文档第 2 节
 * （pb_southgate01～03、gate_crop、pb_statue_gold）。
 *
 * 南大门（插画放大：整体 ×1.25，平面 + 高度，绕 OSM 面积形心 site.ctx.spot 放大）：
 *   门的局部轴：u 沿长轴（方位 61°）、v 沿进深（方位 151°，朝广场为正）、h 向上，原点在面积形心、
 *   门前铺装顶 PAVE_Y。下面的 GATE 常量都是**真实尺寸**（×1.25 前），由 buildGate 里的矩阵 M 整体放大；
 *   kit 的 frame(…, 331) 局部 +X 指向 61°、+Z 指向 151°，局部 (x, y, z) 正好是 (u, h, v)。
 *   自西南向东北依次是：黑色名牌座（后面是平顶后翼）→ 自名牌座顶升起的波浪白带与其下的主拱（门洞）
 *   → 立在主拱右肩的熊猫头环（环内两块逗号形眼斑，环顶左耳横卧圆筒、右肩半圆小耳）→ 右小拱
 *   → 右端平顶亭；白带、头环、小拱与下方拱线之间是一排竖向赭红木格栅。
 *   门洞：主拱净宽 8 × 1.25 = 10 m、净高 5.5 × 1.25 ≈ 6.9 m（> 小人头顶净空 4.35 m），
 *   门洞中点由 gatePassage() 给出，第 1 条步行路径从这里穿过。
 * 门洞地面（地面批，PAVE_Y）：从广场北缘铺到入园主路 entry 的起点，见 buildForecourt。
 *   颜色与广场相同（C.plaza，读成一整片门前广场），只有 entry 路面（C.road）颜色不同；
 *   与两者都只对边、不重叠（同高共面，与 entry 重叠会闪烁，与广场重叠也是多余的共面三角形）。
 * 门东侧补地：园界与广场东北臂之间有一条两边都不管的空档，露出城市地面（−0.5）成坑，
 *   用同色铺装补平，见 buildEastFill。
 * 熊猫铜像（插画放大 ×2.2）：三层同心圆花坛 + 金色「蛋形」母熊猫怀抱幼崽，面朝东南的大门；
 *   脸前留一条视线走廊（占用栅格 F_WALK），后续种树种竹不进。
 * 南门广场：OSM 的 5 块草坪内环与喷泉池从广场挖洞（site.plazaHoles），洞里的草坪、池沿、池水在这里画。
 */
import {
  CircleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  IcosahedronGeometry,
  Matrix4,
  Path,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3
} from "three"
import { THEME } from "../../theme.js"
import { GROUND_Y } from "../../terrain.js"
import { frame, local } from "../kit/builder.js"
import { addTree } from "../kit/figures.js"
import { circlePolygon, distToSegment, insetPolygon } from "../kit/footprint.js"
import { box, extrudePolygon, fromTriangles } from "../kit/shapes.js"
import { ROADS, roadEndCap } from "./ground.js"
import { C, F_PAVE, F_TREE, F_WALK, LAWN_Y, PAVE_Y } from "./site.js"

const L = THEME.landmark
const DEG = Math.PI / 180

/* ---------------- 南大门：坐标系与放大 ---------------- */

const S = 1.25 // 南大门插画放大系数（平面 + 高度）
// frame 方位：局部 −Z 指向 331°，于是 +X → 61°（u）、+Z → 151°（v，朝广场）
const FRAME_BEARING = 331
// u、v 轴的世界方向 [x, z]（X 东、Z 南；方位 b 的方向为 (sin b, −cos b)）
const U = [Math.sin(61 * DEG), -Math.cos(61 * DEG)]
const V = [Math.sin(151 * DEG), -Math.cos(151 * DEG)]
// 门体下沿：各构件从城市地面 GROUND_Y 立起（真实尺寸，放大后正好落到 GROUND_Y），
// 门背后是 0.85 的林下草地，从 PAVE_Y 立起会在草地上悬空一道缝
const SINK = (GROUND_Y - PAVE_Y) / S

/* 南大门构件（真实尺寸，米；u、v、h 见文件头） */
const GATE = {
  // 黑色名牌座：朝广场一面一道白色字带（「成都大熊猫繁育研究基地」，宽 w、高 h、底高 y，
  // 左右居中）与一块白色熊猫标志（边长 s，中心 u、底高 y），照片 pb_southgate02
  sign: {
    u0: -15,
    u1: -7,
    v0: 0.5,
    v1: 5.5,
    h: 3.2,
    text: { w: 6.6, h: 0.5, y: 1.0 },
    logo: { u: -12.8, y: 1.8, s: 0.9 }
  },
  // 后翼平顶房（OSM 门体轮廓伸向园内的一块；外观无照片，做白墙平顶）
  wing: { u0: -15.2, u1: -3.4, v0: -10.9, v1: 0, h: 4.0 },
  // 波浪白带：截面宽（v 向）6、厚 0.6；中线高度按 smoothstep 从名牌座顶升到头环左肩：
  // 起点平（贴名牌座顶 3.2），中段最陡（约 20°），到头环处又放平，同照片里的「浪」；
  // u −2 处顶面约 7.5（文档值）。末端 u 5.0 藏在头环环带与左耳圆筒后面
  band: {
    u0: -15,
    u1: 5,
    mid0: 3.5,
    mid1: 8.6,
    thick: 0.6,
    v0: 0,
    v1: 6,
    n: 16
  },
  // 主拱：拱跨 u −2.2～+7.0（外沿），带厚 0.6；内沿（净空）左脚 −1.6、右脚 6.4（净宽 8），
  // 拱顶 u 3.4、净高 5.5。左右各是四分之一椭圆，右半窄（右腿近乎竖直、左腿长弧斜升，同照片），
  // 拱顶对准门洞中线（OSM 门洞 footway 在 u ≈ 3.4），头环左下沿恰好贴着内拱线
  arch: {
    uL: -1.6,
    uc: 3.4,
    uR: 6.4,
    top: 5.5,
    thick: 0.6,
    v0: 0,
    v1: 6,
    n: 8
  },
  // 熊猫头环：椭圆环外沿半轴 3.3（u）× 3.5（h）、环带宽 0.8、厚（v 向）1.6，前面与白带前沿齐平。
  // 环心高取 6.85（文档 7.0）：左耳顶离门前铺装 10.48 × 1.25 = 13.1 m（即文档「耳顶 10.5 × 1.25」，
  // 世界高度 PAVE_Y + 13.1 = 14.1，由 buildGate 返回作定位针底座），照片里耳顶又略高于环顶，
  // 环顶只能压到 10.35
  ring: { u: 7.5, h: 6.85, a: 3.3, b: 3.5, w: 0.8, v0: 4.4, v1: 6.0, n: 24 },
  // 左耳：横卧圆筒（轴沿 v），圆心落在环外沿左上方（u 5.3 处外沿高 9.46），顶 10.48。
  // 长取 6（文档 3）：与白带同宽，正好把白带末端封住；照片 pb_southgate01 里耳筒也几乎通长
  earL: { u: 5.3, h: 9.48, r: 1.0, v0: 0, v1: 6, n: 10 },
  // 右耳：半圆小片，圆心在环外沿 u 10.3 处（外沿高 8.7）、沿外法向朝外。
  // 文档写高 9.9（耳顶 10.9 高过头环），照片 gate_crop / pb_southgate01 里右耳明显低于环顶，按照片取
  earR: { u: 10.3, r: 1.0, v0: 4.4, v1: 6.0, n: 6 },
  // 眼斑：逗号形，贴在格栅前（格栅前面 v 4.725），尾巴向外下斜。文档约 1.6 × 2.4；
  // 照片里左眼斑比右眼斑大一圈，取 2.0 × 2.7 与 1.6 × 2.3（平均略大，近景才认得出）
  eyes: [
    { u: 6.3, h: 6.75, w: 2.0, hgt: 2.7, mirror: false },
    { u: 8.95, h: 6.45, w: 1.6, hgt: 2.3, mirror: true }
  ],
  eyeV: [4.75, 5.15],
  // 背板：头环与右小拱里、格栅后面的一块暗一档的平板（照片里环内、拱内都是浅灰底，不透空）。
  // 放在 v 4.42，比头环背面（4.4）略靠前，轮廓外扩 0.1 m 埋进环带 / 拱带，前后都看不到板边
  panelV: 4.42,
  // 右小拱：外沿 u 10.5～16.5、立在亭顶（3.2）上、拱顶 5.6，带厚 0.6
  smallArch: {
    u0: 10.5,
    u1: 16.5,
    base: 3.2,
    top: 5.6,
    thick: 0.6,
    v0: 0,
    v1: 6,
    n: 5
  },
  // 右端平顶亭：u 14～24.7 为售票 / 安检亭（玻璃立面 + 细柱 + 出挑 over 的白色平顶板，板厚 slab）。
  // 照片里亭子往左一直接到主拱右腿边（右小拱底下是一段带深色展示窗的白墙），
  // 所以白墙段 u 10～uGlass 补齐，右小拱的左脚才有处落。
  // window：白墙正面的深色展示窗（宽、高、底高，左右居中）；glassEnd：玻璃盒东端离亭端的内收，
  // glassInset：玻璃盒前后离亭边的内收；columns：前檐细柱的 u 位置，边长 col、离前沿 colInset
  pavilion: {
    u0: 10,
    uGlass: 14,
    u1: 24.7,
    v0: 0,
    v1: 5.8,
    h: 3.2,
    slab: 0.35,
    over: 0.5,
    window: { w: 3.0, h: 2.2, y: 0.4 },
    glassEnd: 0.5,
    glassInset: 0.5,
    columns: [16.6, 20.2, 23.8],
    col: 0.3,
    colInset: 0.25
  },
  // 竖向格栅：每 0.9 m 一根 0.12 × 0.25 的赭红木条，立在 v 4.6 的平面上（白带前沿后 1.4 m），
  // 正好落在头环的进深（4.4～6.0）里：木条上端埋进环带，前有眼斑、后有背板
  slats: { u0: -14.55, u1: 16.5, step: 0.9, w: 0.12, d: 0.25, v: 4.6 }
}
// 贴在立面上的色块（字带、标志、展示窗）厚度（真实尺寸）
const PLATE = 0.06

/*
 * 门前地面的范围（放大后米数，门坐标 u）：南边沿广场北缘从 uWest 铺到 uEast（都要落在那条广场边上，
 * 否则 buildForecourt 会警告），北边沿门体后沿从 uWest 铺到 uGateEast（门体东端 30.9 外再让 0.6）
 */
const FORECOURT = { uWest: -20, uEast: 30, uGateEast: 31.5 }

// 逗号形眼斑轮廓（归一化：宽约 0.8、高约 1.32，圆头在右上、尾巴向左下弯），逆时针
const COMMA = [
  [0.42, 0.18],
  [0.36, 0.48],
  [0.12, 0.66],
  [-0.14, 0.62],
  [-0.32, 0.4],
  [-0.38, 0.05],
  [-0.36, -0.35],
  [-0.24, -0.66],
  [-0.1, -0.52],
  [0.02, -0.22],
  [0.22, -0.05]
]

/* ---------------- 南门广场（OSM relation 16672648 的内环，局部坐标） ---------------- */

// 5 块草坪内环（way 1222196289 / 287 / 286 / 288 / 284），都在广场轮廓内、离广场边 ≥ 2.3 m
const PLAZA_LAWNS = [
  [
    [7390.4, -8533.0],
    [7397.4, -8531.0],
    [7403.0, -8535.1],
    [7402.7, -8536.1]
  ],
  [
    [7429.2, -8535.2],
    [7426.5, -8527.5],
    [7434.4, -8524.1],
    [7437.6, -8537.2],
    [7432.3, -8537.2]
  ],
  [
    [7445.7, -8540.2],
    [7444.2, -8533.6],
    [7445.0, -8531.0],
    [7450.7, -8528.7],
    [7457.5, -8540.0],
    [7455.9, -8544.4]
  ],
  [
    [7416.8, -8496.2],
    [7423.0, -8497.0],
    [7434.5, -8500.7],
    [7435.4, -8503.5],
    [7431.8, -8508.7],
    [7427.7, -8506.6],
    [7421.0, -8502.1],
    [7417.0, -8498.5]
  ],
  [
    [7494.6, -8568.3],
    [7497.7, -8565.5],
    [7510.4, -8571.3],
    [7511.4, -8582.3],
    [7510.1, -8583.7]
  ]
]
// 喷泉池（way 1222196285，136 ㎡，季节性水池）
const FOUNTAIN = [
  [7471.6, -8549.3],
  [7474.3, -8544.9],
  [7479.3, -8543.3],
  [7483.6, -8545.0],
  [7485.8, -8549.6],
  [7484.6, -8554.3],
  [7481.3, -8556.9],
  [7476.4, -8556.0],
  [7472.9, -8552.2]
]
const PLAZA_LAWN_Y = PAVE_Y + 0.12 // 草坪略高出铺装，侧面露出一道绿边
const FOUNTAIN_RIM = { w: 0.45, top: PAVE_Y + 0.35 } // 白色池沿：宽、顶高
const FOUNTAIN_WATER_Y = PAVE_Y + 0.15 // 池水面：盖住城市水面层画在 0.3 的同一池水

/* ---------------- 熊猫铜像（插画放大 ×2.2） ---------------- */

const STATUE = {
  at: [7390, -8701], // OSM node 13543467545
  facing: 150, // 面朝东南，正对南大门
  // 三层同心圆花坛 [半径, 顶面比林下草地高, 花色]：外圈红、中圈粉、内圈红；
  // 各层侧面是一圈白色花盆
  beds: [
    [9.5, 0.4, C.flowerRed],
    [7.5, 0.8, C.flowerPink],
    [5.5, 1.2, C.flowerRed]
  ],
  bedSegs: 18,
  // 母熊猫「蛋形」头身一体：三轴半轴、中心（离内圈顶）、向后仰角
  body: { r: [3.6, 4.6, 3.2], y: 4.3, z: -0.3, lean: 15 },
  // 怀中幼崽头：贴在母熊猫胸前右下沿、半个头探出母熊猫轮廓（同照片）；放在脸正中会读成猪鼻子
  cub: { r: [1.5, 1.3, 1.25], at: [2.3, -1.0], out: 0.6 },
  // 视线走廊：自铜像中心、方位 from～to（度）、半径 r 的扇形（每 step 度一个弧点）。
  // 到站机位方位约 125°、近景 120°～150°，这片扇形里的树冠会挡住铜像的脸
  view: { from: 115, to: 160, r: 40, step: 5 }
}

/* ---------------- 入园主路两侧的大叶樟 ---------------- */

// [沿 entry 的比例 t（0 为起点 [7447, −8617]）, 侧（+1 东、−1 西）, 离路中线, 树冠半径]：
// 西侧只种前半段（后半段西边紧挨并行步道 entrySide）；东侧避开博物馆 A 的西角（t ≈ 0.23 处离路中线 16 m），
// 也不种在铜像东南方 40 m 以内：机位从东南偏东看过来，那里的树冠会挡住铜像的脸
const CAMPHORS = [
  [0.12, -1, 7, 8],
  [0.38, -1, 7, 7.5],
  [0.02, 1, 7.5, 7],
  [0.55, 1, 7.5, 8]
]

/* ---------------- 几何小工具 ---------------- */

/** 门的局部 (u, v) → 世界 [x, z]；k 为尺度（真实尺寸用 S，已是放大后米数用 1） */
function uvToXZ(spot, u, v, k = S) {
  return [
    spot.x + k * (u * U[0] + v * V[0]),
    spot.z + k * (u * U[1] + v * V[1])
  ]
}

/** 世界 [x, z] → 门的局部 (u, v)（放大后的米数）；U、V 为正交单位向量 */
function xzToUV(spot, x, z) {
  const dx = x - spot.x
  const dz = z - spot.z
  return [dx * U[0] + dz * U[1], dx * V[0] + dz * V[1]]
}

/**
 * 竖直板：(u, h) 平面上的轮廓（可带洞）沿进深 v 从 v0 挤出到 v1，含前后两面与侧面。
 * ExtrudeGeometry 沿 +Z 挤出，门坐标系的 +Z 就是 v，不用再转。
 */
function slab(outline, v0, v1, holes = []) {
  const shape = new Shape(outline.map(([u, h]) => new Vector2(u, h)))
  for (const hole of holes) {
    shape.holes.push(new Path(hole.map(([u, h]) => new Vector2(u, h))))
  }
  const g = new ExtrudeGeometry(shape, {
    depth: v1 - v0,
    bevelEnabled: false,
    curveSegments: 1
  })
  g.translate(0, 0, v0)
  return g
}

/**
 * 不对称拱线：自左脚 (uL, 0) 经拱顶 (uc, top) 到右脚 (uR, 0)，左右两半各是四分之一椭圆
 * （半轴 uc − uL / uR − uc × top），每半 n 段，共 2n + 1 点
 */
function archCurve(uL, uc, uR, top, n) {
  const pts = []
  for (let i = 0; i <= 2 * n; i++) {
    const phi = Math.PI * (1 - i / (2 * n)) // π（左脚）→ 0（右脚）
    const c = Math.cos(phi)
    const a = c < 0 ? uc - uL : uR - uc
    pts.push([uc + a * c, top * Math.sin(phi)])
  }
  return pts
}

/** 椭圆环上 n 点（逆时针），中心 (u, h)、半轴 a × b */
function ellipse(u, h, a, b, n) {
  return Array.from({ length: n }, (_, k) => {
    const t = (k / n) * Math.PI * 2
    return [u + a * Math.cos(t), h + b * Math.sin(t)]
  })
}

/**
 * 入园主路 entry（ROADS 里的一条两点直路）：起点 p0、单位方向 dir（向北偏西）、
 * 东侧单位法向 east（即 ribbon 的左手法向 (−dz, dx)）、长 len；ROADS 里没有 entry 时报错
 */
function entryAxis() {
  const road = ROADS.find((r) => r.id === "entry")
  if (!road) throw new Error("熊猫基地：ROADS 里缺入园主路 entry")
  const [p0, p1] = road.pts
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
  const dir = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len]
  return { road, p0, dir, east: [-dir[1], dir[0]], len }
}

/** 竖向木条（4 个侧面，上下端埋进白带 / 拱 / 地面），list 为 [u, h0, h1]，全部合成一个几何体 */
function slatBars(list, w, d, v) {
  const pos = []
  const quad = (a, b, c, e) => pos.push(...a, ...b, ...c, ...a, ...c, ...e)
  for (const [u, h0, h1] of list) {
    const x0 = u - w / 2
    const x1 = u + w / 2
    const z0 = v - d / 2
    const z1 = v + d / 2
    quad([x0, h0, z1], [x1, h0, z1], [x1, h1, z1], [x0, h1, z1])
    quad([x1, h0, z0], [x0, h0, z0], [x0, h1, z0], [x1, h1, z0])
    quad([x1, h0, z1], [x1, h0, z0], [x1, h1, z0], [x1, h1, z1])
    quad([x0, h0, z0], [x0, h0, z1], [x0, h1, z1], [x0, h1, z0])
  }
  return fromTriangles(pos)
}

/* ---------------- 南大门 ---------------- */

/** 波浪白带中线高度（真实尺寸）：smoothstep 从 mid0 升到 mid1 */
function bandMid(u) {
  const { u0, u1, mid0, mid1 } = GATE.band
  const t = Math.min(1, Math.max(0, (u - u0) / (u1 - u0)))
  return mid0 + (mid1 - mid0) * t * t * (3 - 2 * t)
}

/** 主拱外沿（拱背）在 u 处的高度；u 在拱外返回 null */
function archBack(u) {
  const { uL, uc, uR, top, thick } = GATE.arch
  const a = u < uc ? uc - uL + thick : uR - uc + thick
  const x = (u - uc) / a
  if (Math.abs(x) >= 1) return null
  return (top + thick) * Math.sqrt(1 - x * x)
}

/** 右小拱内沿在 u 处的高度；u 在内沿之外返回 null */
function smallArchInner(u) {
  const { u0, u1, base, top, thick } = GATE.smallArch
  const uc = (u0 + u1) / 2
  const a = (u1 - u0) / 2 - thick
  const x = (u - uc) / a
  if (Math.abs(x) >= 1) return null
  return base + (top - base - thick) * Math.sqrt(1 - x * x)
}

/**
 * 头环在 u 处、格栅木条上端该到的高度（真实尺寸）；u 在环外返回 null。
 * 环内（内椭圆范围）到内椭圆上沿；环带两侧（内椭圆之外、外椭圆之内）到外椭圆下沿，
 * 木条不会从白色环带上面戳出来。调用方再上加 0.1 m 埋进环带
 */
function ringSlatTop(u) {
  const { u: cu, h, a, b, w } = GATE.ring
  const xo = (u - cu) / a
  if (Math.abs(xo) >= 1) return null
  const xi = (u - cu) / (a - w)
  if (Math.abs(xi) < 1) return h + (b - w) * Math.sqrt(1 - xi * xi)
  return h - b * Math.sqrt(1 - xo * xo)
}

/** 背板：(u, h) 轮廓的单层平板放在 v = panelV（材质双面，一层就够） */
function backPanel(outline) {
  const pg = new ShapeGeometry(
    new Shape(outline.map(([u, h]) => new Vector2(u, h)))
  )
  pg.translate(0, 0, GATE.panelV)
  return pg
}

/** 名牌座（字带、熊猫标志）与后翼平顶房 */
function addSignAndWing(b, M) {
  const { sign: sg, wing: wg } = GATE
  const cu = (sg.u0 + sg.u1) / 2
  b.add(
    box(sg.u1 - sg.u0, sg.h - SINK, sg.v1 - sg.v0),
    C.gateSign,
    local(M, cu, SINK, (sg.v0 + sg.v1) / 2)
  )
  b.add(
    box(sg.text.w, sg.text.h, PLATE),
    C.gateWhite,
    local(M, cu, sg.text.y, sg.v1)
  )
  b.add(
    box(sg.logo.s, sg.logo.s, PLATE),
    C.gateWhite,
    local(M, sg.logo.u, sg.logo.y, sg.v1)
  )
  b.add(
    box(wg.u1 - wg.u0, wg.h - SINK, wg.v1 - wg.v0),
    C.gateWhite,
    local(M, (wg.u0 + wg.u1) / 2, SINK, (wg.v0 + wg.v1) / 2)
  )
}

/** 波浪白带与主拱 */
function addBandAndArch(b, M) {
  // 波浪白带：上沿自左向右、下沿自右向左围成一条弯板
  const bd = GATE.band
  const top = []
  const bottom = []
  for (let i = 0; i <= bd.n; i++) {
    const u = bd.u0 + ((bd.u1 - bd.u0) * i) / bd.n
    const m = bandMid(u)
    top.push([u, m + bd.thick / 2])
    bottom.push([u, m - bd.thick / 2])
  }
  b.add(slab([...top, ...bottom.reverse()], bd.v0, bd.v1), C.gateWhite, M)

  // 主拱：拱背（外沿）自左脚到右脚、两腿向下伸到城市地面，再沿内拱线（净空）回到左脚
  const ar = GATE.arch
  const outer = archCurve(
    ar.uL - ar.thick,
    ar.uc,
    ar.uR + ar.thick,
    ar.top + ar.thick,
    ar.n
  )
  const inner = archCurve(ar.uL, ar.uc, ar.uR, ar.top, ar.n).reverse()
  b.add(
    slab(
      [
        [ar.uL - ar.thick, SINK],
        ...outer,
        [ar.uR + ar.thick, SINK],
        [ar.uR, SINK],
        ...inner,
        [ar.uL, SINK]
      ],
      ar.v0,
      ar.v1
    ),
    C.gateWhite,
    M
  )
}

/**
 * 熊猫头环：环带、环内背板、左耳圆筒、右耳半圆、两块逗号形眼斑
 * @returns {number} 左耳顶的真实高度（离门前铺装）
 */
function addHeadRing(b, M) {
  const { ring: rg, earL: el, earR: er } = GATE
  // 环带：外椭圆挖掉内椭圆
  b.add(
    slab(ellipse(rg.u, rg.h, rg.a, rg.b, rg.n), rg.v0, rg.v1, [
      ellipse(rg.u, rg.h, rg.a - rg.w, rg.b - rg.w, rg.n)
    ]),
    C.gateWhite,
    M
  )
  // 环内背板：内椭圆外扩 0.1 m（板边埋进环带）
  b.add(
    backPanel(ellipse(rg.u, rg.h, rg.a - rg.w + 0.1, rg.b - rg.w + 0.1, rg.n)),
    C.gateShade,
    M
  )
  // 左耳：横卧圆筒（CylinderGeometry 轴沿 Y，绕 X 转 90° 后沿 v）
  const ear = new CylinderGeometry(el.r, el.r, el.v1 - el.v0, el.n, 1, false)
  ear.rotateX(Math.PI / 2)
  ear.translate(el.u, el.h, (el.v0 + el.v1) / 2)
  b.add(ear, C.gateWhite, M)
  // 右耳：半圆小片，圆心在环外沿上，朝外法向张开
  const t = Math.acos((er.u - rg.u) / rg.a) // 椭圆参数角
  const ch = rg.h + rg.b * Math.sin(t)
  // 椭圆外法向 (cos t / a, sin t / b) 的方向角
  const nAng = Math.atan2(Math.sin(t) / rg.b, Math.cos(t) / rg.a)
  const half = []
  for (let k = 0; k <= er.n; k++) {
    const a = nAng - Math.PI / 2 + (k / er.n) * Math.PI
    half.push([er.u + er.r * Math.cos(a), ch + er.r * Math.sin(a)])
  }
  b.add(slab(half, er.v0, er.v1), C.gateWhite, M)
  // 眼斑：逗号形轮廓按大小缩放，右眼斑左右镜像（改点坐标、不用负缩放矩阵）
  for (const e of GATE.eyes) {
    let pts = COMMA.map(([x, y]) => [
      e.u + (e.mirror ? -x : x) * (e.w / 0.8),
      e.h + y * (e.hgt / 1.32)
    ])
    if (e.mirror) pts = pts.reverse() // 镜像后恢复逆时针
    b.add(slab(pts, GATE.eyeV[0], GATE.eyeV[1]), C.gateWhite, M)
  }
  return el.h + el.r
}

/** 右小拱与拱内背板：外拱线、内拱线都立在亭顶上，脚下埋进亭顶板 0.2 m */
function addSmallArch(b, M) {
  const sa = GATE.smallArch
  const uc = (sa.u0 + sa.u1) / 2
  const lift = (pts) => pts.map(([u, h]) => [u, h + sa.base])
  const sOuter = lift(archCurve(sa.u0, uc, sa.u1, sa.top - sa.base, sa.n))
  const sInner = lift(
    archCurve(
      sa.u0 + sa.thick,
      uc,
      sa.u1 - sa.thick,
      sa.top - sa.base - sa.thick,
      sa.n
    )
  ).reverse()
  const foot = sa.base - 0.2
  b.add(
    slab(
      [
        [sa.u0, foot],
        ...sOuter,
        [sa.u1, foot],
        [sa.u1 - sa.thick, foot],
        ...sInner,
        [sa.u0 + sa.thick, foot]
      ],
      sa.v0,
      sa.v1
    ),
    C.gateWhite,
    M
  )
  // 拱内背板：内拱线外扩 0.1 m，底边落在亭顶
  b.add(
    backPanel(
      lift(
        archCurve(
          sa.u0 + sa.thick - 0.1,
          uc,
          sa.u1 - sa.thick + 0.1,
          sa.top - sa.base - sa.thick + 0.1,
          sa.n
        )
      )
    ),
    C.gateShade,
    M
  )
}

/** 右端平顶亭：白墙段（深色展示窗）+ 玻璃售票亭 + 细柱 + 出挑的白色平顶板 */
function addPavilion(b, M) {
  const pv = GATE.pavilion
  const roofBot = pv.h - pv.slab
  const depth = pv.v1 - pv.v0
  const cv = (pv.v0 + pv.v1) / 2
  const wallU = (pv.u0 + pv.uGlass) / 2
  b.add(
    box(pv.uGlass - pv.u0, roofBot - SINK, depth),
    C.gateWhite,
    local(M, wallU, SINK, cv)
  )
  b.add(
    box(pv.window.w, pv.window.h, PLATE),
    C.windowBand,
    local(M, wallU, pv.window.y, pv.v1)
  )
  const glassU1 = pv.u1 - pv.glassEnd
  b.add(
    box(glassU1 - pv.uGlass, roofBot - SINK, depth - 2 * pv.glassInset),
    L.glass,
    local(M, (pv.uGlass + glassU1) / 2, SINK, cv)
  )
  for (const u of pv.columns) {
    b.add(
      box(pv.col, roofBot - SINK, pv.col),
      C.gateWhite,
      local(M, u, SINK, pv.v1 - pv.colInset)
    )
  }
  // 平顶板只向东、南、北三面出挑：西端紧贴头环下的格栅，不往那边伸
  b.add(
    box(pv.u1 - pv.u0 + pv.over, pv.slab, depth + 2 * pv.over, {
      bottom: true
    }),
    C.gateWhite,
    local(M, (pv.u0 + pv.u1 + pv.over) / 2, roofBot, cv)
  )
}

/** 木条上端该到的高度（真实尺寸）：白带底 / 头环（见 ringSlatTop）/ 右小拱内沿；都不在时返回 null */
function slatTopAt(u) {
  if (u <= GATE.band.u1) return bandMid(u) - GATE.band.thick / 2
  return ringSlatTop(u) ?? smallArchInner(u)
}

/**
 * 竖向格栅。上端取木条两侧边（u ± w/2）上 slatTopAt 的较大值，再上加 0.1 m 埋进白带 / 环带 / 拱带
 * （环带两侧、拱脚一带轮廓很陡，只按木条中线取高，一侧角会露缝）。
 * 下端取名牌座顶 / 地面 / 亭顶（各下沉 0.1 m）；主拱范围内落在拱背上，取两侧边拱背的较小值
 * 再下沉半个拱带厚：拱背是 8 段折线、弦在解析椭圆里面，拱脚一带又很陡，只下沉 0.1 m 时
 * 木条一侧会悬空约 0.27 m
 */
function addSlats(b, M) {
  const { slats: sl, sign: sg, arch: ar, pavilion: pv } = GATE
  const edges = (u) => [u - sl.w / 2, u + sl.w / 2]
  const bars = []
  for (let u = sl.u0; u <= sl.u1 + 1e-6; u += sl.step) {
    const tops = edges(u)
      .map(slatTopAt)
      .filter((h) => h !== null)
    if (tops.length < 2) continue
    const hi = Math.max(...tops)
    // 下端：名牌座顶；主拱范围内落在拱背上（门洞净空里不会有木条）；
    // 名牌座与主拱之间、主拱右腿与亭子之间落地
    const backs = edges(u).map(archBack)
    const onArch = u >= sg.u1 && backs.every((h) => h !== null)
    let lo = 0
    if (u < sg.u1) lo = sg.h
    else if (onArch) lo = Math.min(...backs)
    else if (u >= pv.u0) lo = pv.h
    if (hi - lo < 0.3) continue
    const sink = onArch ? ar.thick / 2 : 0.1
    bars.push([u, lo - sink, hi + 0.1])
  }
  b.add(slatBars(bars, sl.w, sl.d, sl.v), C.gateSlat, M)
}

/**
 * 南大门几何（真实尺寸，局部 (u, h, v)），全部用放大矩阵 M 加进主体批。
 * @returns {number} 左耳顶的真实高度（离门前铺装，核对定位针用）
 */
function addGateBody(b, M) {
  addSignAndWing(b, M)
  addBandAndArch(b, M)
  const earTop = addHeadRing(b, M)
  addSmallArch(b, M)
  addPavilion(b, M)
  addSlats(b, M)
  return earTop
}

/**
 * 离门前最近的广场边（取门洞前方 12 m 处的点来找）：{ e0, e1, i0, i1 }，端点及其在 site.plaza 里的下标
 */
function plazaEdgeNearGate(site) {
  const { spot } = site.ctx
  const plaza = site.plaza
  const probe = uvToXZ(spot, 4.25, 12, 1)
  let best = null
  let bestD = Infinity
  for (let i = 0; i < plaza.length; i++) {
    const j = (i + 1) % plaza.length
    const d = distToSegment(probe[0], probe[1], plaza[i], plaza[j])
    if (d < bestD) {
      bestD = d
      best = { e0: plaza[i], e1: plaza[j], i0: i, i1: j }
    }
  }
  return best
}

/**
 * 门洞地面（地面批）：一整块 PAVE_Y 铺装，覆盖门前空地、门洞与门后通道。
 *   南边：沿广场北缘（离门最近的那条广场边）从 FORECOURT.uWest 到 uEast，与广场对边、不重叠；
 *   中段：门前整条立面宽，门洞内宽同主拱净宽（放大后 u −2～+8）；
 *   北边：收窄到 entry 路面的起端封口（roadEndCap，已含渲染外延），与它对边、不重叠。
 * @returns {Array<[number, number]>} 地面轮廓（世界坐标）
 */
function buildForecourt(site) {
  const { spot } = site.ctx
  const { e0, e1 } = plazaEdgeNearGate(site)
  // 广场边所在直线上、门坐标 u = target 的点（与广场边严格共线，两块铺装只对边）。
  // 直线是外推的：target 落到广场边线段之外时，地面会伸进广场转角之外的空地，开发期警告
  const [u0] = xzToUV(spot, ...e0)
  const [u1] = xzToUV(spot, ...e1)
  const onEdge = (target) => {
    const s = (target - u0) / (u1 - u0)
    const p = [e0[0] + (e1[0] - e0[0]) * s, e0[1] + (e1[1] - e0[1]) * s]
    const off = distToSegment(p[0], p[1], e0, e1)
    if (off > 0.5) {
      console.warn(
        `熊猫基地：门前地面端点 u ${target} 落在广场北缘之外 ${off.toFixed(1)} m，可能与广场错位`
      )
    }
    return p
  }
  // entry 起端封口：按门坐标 u 从大到小排（多边形沿门后沿自东向西绕回）
  const cap = roadEndCap(entryAxis().road, "start").sort(
    (p, q) => xzToUV(spot, ...q)[0] - xzToUV(spot, ...p)[0]
  )
  const ar = GATE.arch
  const fc = FORECOURT
  const poly = [
    onEdge(fc.uWest),
    onEdge(fc.uEast),
    uvToXZ(spot, fc.uGateEast, 0, 1),
    uvToXZ(spot, ar.uR * S, 0, 1),
    cap[0],
    cap[1],
    uvToXZ(spot, ar.uL * S, 0, 1),
    uvToXZ(spot, fc.uWest, 0, 1)
  ]
  site.gb.add(extrudePolygon(poly, [], GROUND_Y, PAVE_Y), C.plaza)
  site.grid.fillPoly(poly, F_PAVE)
  return poly
}

/**
 * 门东侧补地（地面批，PAVE_Y、广场同色、打 F_PAVE）：园界在门东端外折向东北
 * （park 顶点约 (7502, −8591) → (7498, −8598) → (7534, −8627)），广场东北臂的北缘
 * （plaza 顶点约 (7498, −8589) → (7501, −8584) → (7525, −8605)）离它 8～12 m，
 * 中间一条约 27 × 12 m 的空档两边都不管，露出城市地面（−0.5），夹在广场（1.0）与林下草地（0.85）之间成坑。
 * 补地沿广场边用广场的原顶点（只对边不重叠），沿园界用园界的原顶点（草地低 0.15，搭边也无妨），
 * 东头在广场臂尖 (7525, −8605) 处沿门坐标 u 收到园界上。离门体东端（放大后 u 30.9）≥ 2 m。
 * 顶点按坐标关系取（数据重拉后下标会变）；形状与预期不符时只警告、不补。
 * @returns {Array<[number, number]>|null} 补地轮廓（世界坐标）
 */
function buildEastFill(site) {
  const { spot } = site.ctx
  const plaza = site.plaza
  const park = site.park
  const { e0, e1, i0, i1 } = plazaEdgeNearGate(site)
  const ue = (p) => xzToUV(spot, ...p)[0]
  const ve = (p) => xzToUV(spot, ...p)[1]
  // 广场边东端点 pE，及其往广场东北臂方向（背离西端点）的下两个顶点
  const [iE, iW] = ue(e0) > ue(e1) ? [i0, i1] : [i1, i0]
  const n = plaza.length
  const step = (iE - iW + n) % n === 1 ? 1 : -1
  const at = (poly, i) => poly[(i + poly.length) % poly.length]
  const pE = plaza[iE]
  const pArm1 = at(plaza, iE + step)
  const pArm2 = at(plaza, iE + 2 * step)
  // 园界上离 pE 最近的顶点 q0（门东端外的折点），再往园内一侧（门坐标 v 变小）走两个顶点
  const dist = (p) => Math.hypot(p[0] - pE[0], p[1] - pE[1])
  let k = 0
  for (let i = 1; i < park.length; i++) if (dist(park[i]) < dist(park[k])) k = i
  const dirK = ve(at(park, k + 1)) < ve(at(park, k - 1)) ? 1 : -1
  const q0 = park[k]
  const q1 = at(park, k + dirK)
  const q2 = at(park, k + 2 * dirK)
  // 东头收口：q1 → q2 这段园界上、门坐标 u 与广场臂尖 pArm2 相同的点
  const s = (ue(pArm2) - ue(q1)) / (ue(q2) - ue(q1))
  const gateEast = GATE.pavilion.u1 * S
  if (!(dist(q0) < 8 && s > 0 && s < 1 && ue(q1) > gateEast + 2)) {
    console.warn("熊猫基地：门东侧园界 / 广场顶点与预期不符，未补地")
    return null
  }
  const qEnd = [q1[0] + (q2[0] - q1[0]) * s, q1[1] + (q2[1] - q1[1]) * s]
  const poly = [pE, q0, q1, qEnd, pArm2, pArm1]
  site.gb.add(extrudePolygon(poly, [], GROUND_Y, PAVE_Y), C.plaza)
  site.grid.fillPoly(poly, F_PAVE)
  return poly
}

/**
 * 门洞中点（世界 [x, z]）：主拱拱顶下、进深中间。第 1 条步行路径从广场经这里穿门，
 * 再接 entry 起点 [7447, −8617]；路径两侧离拱腿内沿 ≥ 3 m，头顶净空 ≥ 6.3 m
 */
export function gatePassage(spot) {
  const ar = GATE.arch
  return uvToXZ(spot, ar.uc, (ar.v0 + ar.v1) / 2)
}

/* ---------------- 南门广场：草坪与喷泉 ---------------- */

function buildPlazaDetails(site) {
  for (const poly of PLAZA_LAWNS) {
    site.plazaHoles.push(poly)
    site.gb.add(extrudePolygon(poly, [], GROUND_Y, PLAZA_LAWN_Y), C.lawnOpen)
  }
  site.plazaHoles.push(FOUNTAIN)
  const water = insetPolygon(FOUNTAIN, FOUNTAIN_RIM.w)
  site.gb.add(
    extrudePolygon(FOUNTAIN, [water], GROUND_Y, FOUNTAIN_RIM.top),
    C.gateWhite
  )
  site.gb.add(
    extrudePolygon(water, [], PAVE_Y - 0.1, FOUNTAIN_WATER_Y),
    THEME.water
  )
}

/* ---------------- 熊猫铜像 ---------------- */

const Z_AXIS = new Vector3(0, 0, 1)
const X_AXIS = new Vector3(1, 0, 0)

/**
 * 椭球（半轴 r）前表面（+Z 一侧）上 (x, y) 处的点与外法向；lift 为沿法向的外移量
 */
function onFront(r, x, y, lift = 0) {
  const [a, b, c] = r
  const z =
    c * Math.sqrt(Math.max(0, 1 - (x * x) / (a * a) - (y * y) / (b * b)))
  const n = new Vector3(x / (a * a), y / (b * b), z / (c * c)).normalize()
  return { p: new Vector3(x, y, z).addScaledVector(n, lift), n }
}

/** 在 parent 里摆一个压扁的二十面体：中心 p、薄轴朝 n、在切面内转 roll、三轴半轴 r */
function blob(b, parent, p, n, r, roll, color, detail = 0) {
  const q = new Quaternion()
    .setFromUnitVectors(Z_AXIS, n)
    .multiply(new Quaternion().setFromAxisAngle(Z_AXIS, roll))
  const m = new Matrix4().compose(p, q, new Vector3(...r))
  b.add(new IcosahedronGeometry(1, detail), color, parent.clone().multiply(m))
}

/**
 * 熊猫铜像：三层花坛 + 母熊猫（蛋形头身、黑褐耳、凹陷眼斑与金色眼珠、胸前一道暗色臂弯）
 * + 怀中幼崽（头、小耳、眼斑）。全身金色，暗部 bronzeDark。局部 +Z 为脸（面朝 STATUE.facing）
 */
function addStatue(site) {
  const b = site.b
  const st = STATUE
  const [x, z] = st.at
  for (const [r, rise, color] of st.beds) {
    const topY = LAWN_Y + rise
    // 侧面：白色花盆一圈（不封顶），顶面：花色圆片
    b.add(
      new CylinderGeometry(r, r, topY - GROUND_Y, st.bedSegs, 1, true),
      C.gateWhite,
      local(null, x, (topY + GROUND_Y) / 2, z)
    )
    const disc = new CircleGeometry(r, st.bedSegs)
    disc.rotateX(-Math.PI / 2)
    b.add(disc, color, local(null, x, topY, z))
  }
  const outerR = st.beds[0][0]
  site.solid(circlePolygon(x, z, outerR, st.bedSegs))
  // 视线走廊：铜像脸前的扇形打 F_WALK（语义同步行路径外扩带：树冠、竹丛不进），
  // 后续种树种竹（vegetation）会避开，到站机位与近景都看得到铜像的脸
  const vw = st.view
  const corridor = [[x, z]]
  for (let bDeg = vw.from; bDeg <= vw.to + 1e-6; bDeg += vw.step) {
    corridor.push([
      x + vw.r * Math.sin(bDeg * DEG),
      z - vw.r * Math.cos(bDeg * DEG)
    ])
  }
  site.grid.fillPoly(corridor, F_WALK)

  const base = LAWN_Y + st.beds[st.beds.length - 1][1]
  const F = frame(x, base, z, st.facing + 180)
  const bd = st.body
  // 蛋形身体坐标系 E：先平移到身体中心，再向后仰（绕 X 轴负转，顶部倒向 −Z 背后）
  const E = F.clone().multiply(
    new Matrix4().compose(
      new Vector3(0, bd.y, bd.z),
      new Quaternion().setFromAxisAngle(X_AXIS, -bd.lean * DEG),
      new Vector3(1, 1, 1)
    )
  )
  b.add(
    new IcosahedronGeometry(1, 1),
    C.bronze,
    E.clone().multiply(new Matrix4().makeScale(...bd.r))
  )
  for (const sx of [-1, 1]) {
    // 耳朵：头顶两侧的黑褐小扁球
    blob(
      b,
      E,
      new Vector3(sx * 2.1, 3.75, -0.4),
      Z_AXIS,
      [0.85, 0.8, 0.4],
      sx * 20 * DEG,
      C.bronzeDark
    )
    // 眼斑：略陷进脸面的暗色扁球，外眼角下垂；眼珠是浮在眼斑内下侧的金色小球
    const eye = onFront(bd.r, sx * 1.4, 1.75, -0.08)
    blob(b, E, eye.p, eye.n, [1.05, 1.35, 0.3], sx * 25 * DEG, C.bronzeDark)
    const ball = onFront(bd.r, sx * 1.2, 1.6, 0.14)
    blob(b, E, ball.p, ball.n, [0.34, 0.34, 0.26], 0, C.bronze)
  }
  // 蛋身左下的暗色臂弯（照片里那道「笑纹」）：自左上向右下斜，伸到幼崽下巴底下
  const arm = onFront(bd.r, -0.9, -2.5, -0.08)
  blob(b, E, arm.p, arm.n, [2.0, 0.36, 0.3], -22 * DEG, C.bronzeDark)

  // 幼崽：头贴在母熊猫胸前右下，朝外略探出
  const cb = st.cub
  const at = onFront(bd.r, cb.at[0], cb.at[1], cb.out)
  const Cm = E.clone().multiply(
    new Matrix4().compose(
      at.p,
      new Quaternion().setFromUnitVectors(Z_AXIS, at.n),
      new Vector3(1, 1, 1)
    )
  )
  b.add(
    new IcosahedronGeometry(1, 1),
    C.bronze,
    Cm.clone().multiply(new Matrix4().makeScale(...cb.r))
  )
  for (const sx of [-1, 1]) {
    // 小耳在头顶两侧，眼斑分得开、偏上（挤在一起会像鼻孔）
    blob(
      b,
      Cm,
      new Vector3(sx * 1.0, 1.0, -0.15),
      Z_AXIS,
      [0.42, 0.42, 0.22],
      0,
      C.bronzeDark
    )
    const e = onFront(cb.r, sx * 0.62, 0.35, -0.03)
    blob(b, Cm, e.p, e.n, [0.28, 0.36, 0.14], sx * 25 * DEG, C.bronzeDark)
  }
}

/* ---------------- 入园主路行道树 ---------------- */

function plantCamphors(site) {
  const { p0, dir, east, len } = entryAxis()
  const greens = [...C.forest, ...THEME.tree.greens]
  CAMPHORS.forEach(([t, side, off, r], i) => {
    const x = p0[0] + dir[0] * len * t + side * east[0] * off
    const z = p0[1] + dir[1] * len * t + side * east[1] * off
    // 干高取 0.85 r（比默认 0.75 r 高）：树冠下沿离草地 0.65 r，冠缘探到路面上空时
    // 仍高过小人头顶净空（路面 PAVE_Y + 4.35）
    addTree(site.b, x, LAWN_Y, z, {
      r,
      color: greens[i % greens.length],
      trunkH: 0.85 * r,
      yaw: i * 1.7,
      detail: 1
    })
    site.grid.disk(x, z, r, F_TREE)
  })
}

/* ---------------- 入口 ---------------- */

/**
 * 南大门、门洞地面、门东侧补地、南门广场草坪与喷泉、熊猫铜像、入园行道树。在 buildPaths 之后调用。
 * @returns {{ earTop: number }} 左耳顶的世界高度（PAVE_Y + 10.48 × 1.25 ≈ 14.1），即定位针底座
 */
export function buildGate(site) {
  const { spot } = site.ctx
  const M = local(
    frame(spot.x, PAVE_Y, spot.z, FRAME_BEARING),
    0,
    0,
    0,
    0,
    S,
    S,
    S
  )
  const earTrue = addGateBody(site.b, M)

  // 南大门、东端岗亭 686460743 按设计尺寸建模、不用 OSM 轮廓：先把这两栋楼标记为已取用，
  // 别处按坐标取轮廓时不会误拿到它们
  site.footprintNear(spot.x, spot.z, 6)
  site.footprintNear(7496.6, -8594.4, 6)
  // 占用栅格：后翼、白带两段（门洞左右）都登记为实体；门洞通道不登记
  const g = GATE
  const rect = (u0, u1, v0, v1) => [
    uvToXZ(spot, u0, v0),
    uvToXZ(spot, u1, v0),
    uvToXZ(spot, u1, v1),
    uvToXZ(spot, u0, v1)
  ]
  site.solid(rect(g.wing.u0, g.wing.u1, g.wing.v0, g.wing.v1))
  site.solid(rect(g.band.u0, g.arch.uL, g.band.v0, g.band.v1))
  site.solid(rect(g.arch.uR, g.pavilion.u1, g.band.v0, g.band.v1))

  buildForecourt(site)
  buildEastFill(site)
  buildPlazaDetails(site)
  addStatue(site)
  plantCamphors(site)
  return { earTop: PAVE_Y + S * earTrue }
}

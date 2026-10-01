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
 * 门洞地面（地面批，PAVE_Y，与广场同色）：从广场北缘铺到入园主路 entry 的起点，
 *   与广场、entry 都只对边、不重叠（同高共面、颜色不同，重叠会闪烁），见 buildForecourt。
 * 熊猫铜像（插画放大 ×2.2）：三层同心圆花坛 + 金色「蛋形」母熊猫怀抱幼崽，面朝东南的大门。
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
import { circlePolygon, distToSegment } from "../kit/footprint.js"
import { box, extrudePolygon, fromTriangles } from "../kit/shapes.js"
import { ROAD_END_EXT, ROADS } from "./ground.js"
import { C, F_PAVE, F_TREE, LAWN_Y, PAVE_Y } from "./site.js"

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
  // 黑色名牌座：朝广场一面一道白色字带（「成都大熊猫繁育研究基地」）与一块白色熊猫标志
  sign: { u0: -15, u1: -7, v0: 0.5, v1: 5.5, h: 3.2 },
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
  // 环心高取 6.85（文档 7.0）：左耳顶离门前铺装 10.48 × 1.25 = 13.1 m（即文档「耳顶 10.5 × 1.25」、
  // index.js 的 MARKER_HEIGHT），照片里耳顶又略高于环顶，环顶只能压到 10.35
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
  // 右端平顶亭：u 14～24.7 为售票 / 安检亭（玻璃立面 + 细柱 + 出挑 0.5 的白色平顶板）。
  // 照片里亭子往左一直接到主拱右腿边（右小拱底下是一段带深色展示窗的白墙），
  // 所以白墙段 u 10～14 补齐，右小拱的左脚才有处落
  pavilion: {
    u0: 10,
    uGlass: 14,
    u1: 24.7,
    v0: 0,
    v1: 5.8,
    h: 3.2,
    slab: 0.35,
    over: 0.5
  },
  // 竖向格栅：每 0.9 m 一根 0.12 × 0.25 的赭红木条，立在 v 4.6 的平面上（白带前沿后 1.4 m），
  // 正好落在头环的进深（4.4～6.0）里：木条上端埋进环带，前有眼斑、后有背板
  slats: { u0: -14.55, u1: 16.5, step: 0.9, w: 0.12, d: 0.25, v: 4.6 }
}

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
  cub: { r: [1.5, 1.3, 1.25], at: [2.3, -1.0], out: 0.6 }
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
 * 多边形向内收 d 米（各边平移、角点取相邻两边交点），适用于凸多边形（喷泉池近圆）。
 * 按带符号面积判断绕向，保证总是向内。
 */
function insetPolygon(poly, d) {
  const n = poly.length
  let area = 0
  for (let i = 0; i < n; i++) {
    const [x0, z0] = poly[i]
    const [x1, z1] = poly[(i + 1) % n]
    area += x0 * z1 - x1 * z0
  }
  const s = area > 0 ? 1 : -1
  // 各边的单位内法向
  const nor = poly.map((p, i) => {
    const q = poly[(i + 1) % n]
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
    return [(-s * (q[1] - p[1])) / l, (s * (q[0] - p[0])) / l]
  })
  return poly.map(([x, z], i) => {
    const a = nor[(i - 1 + n) % n]
    const b = nor[i]
    const k = d / (1 + a[0] * b[0] + a[1] * b[1])
    return [x + (a[0] + b[0]) * k, z + (a[1] + b[1]) * k]
  })
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

/** 头环外沿上半在 u 处的高度；u 在环外返回 null */
function ringTop(u) {
  const { u: cu, h, a, b } = GATE.ring
  const x = (u - cu) / a
  if (Math.abs(x) >= 1) return null
  return h + b * Math.sqrt(1 - x * x)
}

/**
 * 南大门几何（真实尺寸，局部 (u, h, v)），全部用放大矩阵 M 加进主体批。
 * 返回左耳顶的真实高度（核对定位针用）。
 */
function addGateBody(b, M) {
  const g = GATE
  const white = C.gateWhite
  // 背板：(u, h) 轮廓的单层平板放在 v = panelV（材质双面，一层就够）
  const panel = (outline) => {
    const pg = new ShapeGeometry(
      new Shape(outline.map(([u, h]) => new Vector2(u, h)))
    )
    pg.translate(0, 0, g.panelV)
    return pg
  }

  // 名牌座 + 字带 + 熊猫标志
  const sg = g.sign
  b.add(
    box(sg.u1 - sg.u0, sg.h - SINK, sg.v1 - sg.v0),
    C.gateSign,
    local(M, (sg.u0 + sg.u1) / 2, SINK, (sg.v0 + sg.v1) / 2)
  )
  b.add(box(6.6, 0.5, 0.06), white, local(M, (sg.u0 + sg.u1) / 2, 1.0, sg.v1))
  b.add(box(0.9, 0.9, 0.06), white, local(M, -12.8, 1.8, sg.v1))
  // 后翼平顶房
  const wg = g.wing
  b.add(
    box(wg.u1 - wg.u0, wg.h - SINK, wg.v1 - wg.v0),
    white,
    local(M, (wg.u0 + wg.u1) / 2, SINK, (wg.v0 + wg.v1) / 2)
  )

  // 波浪白带：上沿自左向右、下沿自右向左围成一条弯板
  const bd = g.band
  const top = []
  const bottom = []
  for (let i = 0; i <= bd.n; i++) {
    const u = bd.u0 + ((bd.u1 - bd.u0) * i) / bd.n
    const m = bandMid(u)
    top.push([u, m + bd.thick / 2])
    bottom.push([u, m - bd.thick / 2])
  }
  b.add(slab([...top, ...bottom.reverse()], bd.v0, bd.v1), white, M)

  // 主拱：拱背（外沿）自左脚到右脚、两腿向下伸到城市地面，再沿内拱线（净空）回到左脚
  const ar = g.arch
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
    white,
    M
  )

  // 熊猫头环：外椭圆挖掉内椭圆
  const rg = g.ring
  b.add(
    slab(ellipse(rg.u, rg.h, rg.a, rg.b, rg.n), rg.v0, rg.v1, [
      ellipse(rg.u, rg.h, rg.a - rg.w, rg.b - rg.w, rg.n)
    ]),
    white,
    M
  )
  // 环内背板：内椭圆外扩 0.1 m（板边埋进环带）
  b.add(
    panel(ellipse(rg.u, rg.h, rg.a - rg.w + 0.1, rg.b - rg.w + 0.1, rg.n)),
    C.gateShade,
    M
  )
  // 左耳：横卧圆筒（CylinderGeometry 轴沿 Y，绕 X 转 90° 后沿 v）
  const el = g.earL
  const ear = new CylinderGeometry(el.r, el.r, el.v1 - el.v0, el.n, 1, false)
  ear.rotateX(Math.PI / 2)
  ear.translate(el.u, el.h, (el.v0 + el.v1) / 2)
  b.add(ear, white, M)
  // 右耳：半圆小片，圆心在环外沿上，朝外法向张开
  const er = g.earR
  const t = Math.acos((er.u - rg.u) / rg.a) // 椭圆参数角
  const ch = rg.h + rg.b * Math.sin(t)
  // 椭圆外法向 (cos t / a, sin t / b) 的方向角
  const nAng = Math.atan2(Math.sin(t) / rg.b, Math.cos(t) / rg.a)
  const half = []
  for (let k = 0; k <= er.n; k++) {
    const a = nAng - Math.PI / 2 + (k / er.n) * Math.PI
    half.push([er.u + er.r * Math.cos(a), ch + er.r * Math.sin(a)])
  }
  b.add(slab(half, er.v0, er.v1), white, M)

  // 眼斑：逗号形轮廓按大小缩放，右眼斑左右镜像（改点坐标、不用负缩放矩阵）
  for (const e of g.eyes) {
    let pts = COMMA.map(([x, y]) => [
      e.u + (e.mirror ? -x : x) * (e.w / 0.8),
      e.h + y * (e.hgt / 1.32)
    ])
    if (e.mirror) pts = pts.reverse() // 镜像后恢复逆时针
    b.add(slab(pts, g.eyeV[0], g.eyeV[1]), white, M)
  }

  // 右小拱：外拱线、内拱线都立在亭顶上，脚下埋进亭顶板 0.2 m
  const sa = g.smallArch
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
    white,
    M
  )
  // 小拱里的背板：内拱线外扩 0.1 m，底边落在亭顶
  b.add(
    panel(
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

  // 右端平顶亭：白墙段（深色展示窗）+ 玻璃售票亭 + 细柱 + 出挑的白色平顶板
  const pv = g.pavilion
  const roofBot = pv.h - pv.slab
  const depth = pv.v1 - pv.v0
  b.add(
    box(pv.uGlass - pv.u0, roofBot - SINK, depth),
    white,
    local(M, (pv.u0 + pv.uGlass) / 2, SINK, depth / 2)
  )
  b.add(
    box(3.0, 2.2, 0.06),
    C.windowBand,
    local(M, (pv.u0 + pv.uGlass) / 2, 0.4, pv.v1)
  )
  b.add(
    box(pv.u1 - 0.5 - pv.uGlass, roofBot - SINK, depth - 1),
    L.glass,
    local(M, (pv.uGlass + pv.u1 - 0.5) / 2, SINK, depth / 2)
  )
  for (const u of [16.6, 20.2, 23.8]) {
    b.add(box(0.3, roofBot - SINK, 0.3), white, local(M, u, SINK, pv.v1 - 0.25))
  }
  // 平顶板只向东、南、北三面出挑：西端紧贴头环下的格栅，不往那边伸
  b.add(
    box(pv.u1 - pv.u0 + pv.over, pv.slab, depth + 2 * pv.over, {
      bottom: true
    }),
    white,
    local(M, (pv.u0 + pv.u1 + pv.over) / 2, roofBot, depth / 2)
  )

  // 竖向格栅：每根木条的上端取白带底 / 头环外沿 / 右小拱内沿，下端取名牌座顶 / 地面 / 拱背 / 亭顶
  const sl = g.slats
  const bars = []
  for (let u = sl.u0; u <= sl.u1 + 1e-6; u += sl.step) {
    let hi = null
    if (u <= bd.u1) hi = bandMid(u) - bd.thick / 2
    else if (ringTop(u) !== null) hi = ringTop(u)
    else hi = smallArchInner(u)
    if (hi === null) continue
    // 下端：名牌座顶；主拱范围内落在拱背上（门洞净空里不会有木条）；
    // 名牌座与主拱之间、主拱右腿与亭子之间落地
    let lo = 0
    if (u < sg.u1) lo = sg.h
    else if (archBack(u) !== null) lo = archBack(u)
    else if (u >= pv.u0) lo = pv.h
    if (hi - lo < 0.3) continue
    // 上下各埋进 0.1 m，接缝处不漏光
    bars.push([u, lo - 0.1, hi + 0.1])
  }
  b.add(slatBars(bars, sl.w, sl.d, sl.v), C.gateSlat, M)

  return el.h + el.r
}

/**
 * 门洞地面（地面批）：一整块 PAVE_Y 铺装，覆盖门前空地、门洞与门后通道。
 *   南边：沿广场北缘（离门最近的那条广场边所在直线）与广场对边，不重叠；
 *   中段：门前整条立面宽（放大后 u −20～+31.5），门洞内宽同主拱净宽（u −2～+8）；
 *   北边：收窄到 entry 路面的起端封口（entry 渲染时自 [7447, −8617] 往外延 ROAD_END_EXT），
 *   与它对边、不重叠。地面与广场同色（读成一整片门前广场），与 entry 路面颜色不同。
 * @returns {Array<[number, number]>} 地面轮廓（世界坐标）
 */
function buildForecourt(site) {
  const { spot } = site.ctx
  const plaza = site.plaza
  // 离门前最近的广场边（取门洞前方 12 m 处的点来找）
  const probe = uvToXZ(spot, 4.25, 12, 1)
  let e0 = null
  let e1 = null
  let best = Infinity
  for (let i = 0; i < plaza.length; i++) {
    const a = plaza[i]
    const c = plaza[(i + 1) % plaza.length]
    const d = distToSegment(probe[0], probe[1], a, c)
    if (d < best) {
      best = d
      e0 = a
      e1 = c
    }
  }
  // 广场边所在直线上、门坐标 u = target 的点（与广场边严格共线，两块铺装只对边）
  const [u0] = xzToUV(spot, ...e0)
  const [u1] = xzToUV(spot, ...e1)
  const onEdge = (target) => {
    const s = (target - u0) / (u1 - u0)
    return [e0[0] + (e1[0] - e0[0]) * s, e0[1] + (e1[1] - e0[1]) * s]
  }
  // entry 起端封口的两个角点（算法同 ground.js 的 roadRibbon：起点沿首段反方向外延后左右各偏半宽）
  const entry = ROADS.find((r) => r.id === "entry")
  const [p0, p1] = entry.pts
  const dx = p1[0] - p0[0]
  const dz = p1[1] - p0[1]
  const l = Math.hypot(dx, dz)
  const sx = p0[0] - (dx / l) * ROAD_END_EXT
  const sz = p0[1] - (dz / l) * ROAD_END_EXT
  const nx = (-dz / l) * (entry.w / 2)
  const nz = (dx / l) * (entry.w / 2)
  let capA = [sx + nx, sz + nz]
  let capB = [sx - nx, sz - nz]
  // capA 取 u 较大的一端（多边形按 u 递减方向绕回）
  if (xzToUV(spot, ...capA)[0] < xzToUV(spot, ...capB)[0]) {
    ;[capA, capB] = [capB, capA]
  }
  const ar = GATE.arch
  const poly = [
    onEdge(-20),
    onEdge(31.5),
    uvToXZ(spot, 31.5, 0, 1),
    uvToXZ(spot, ar.uR * S, 0, 1),
    capA,
    capB,
    uvToXZ(spot, ar.uL * S, 0, 1),
    uvToXZ(spot, -20, 0, 1)
  ]
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
  const entry = ROADS.find((r) => r.id === "entry")
  const [p0, p1] = entry.pts
  const dx = p1[0] - p0[0]
  const dz = p1[1] - p0[1]
  const l = Math.hypot(dx, dz)
  // 东侧单位向量：entry 向北偏西走，左手法向 (−dz, dx) 指向东
  const ex = -dz / l
  const ez = dx / l
  const greens = [...C.forest, ...THEME.tree.greens]
  CAMPHORS.forEach(([t, side, off, r], i) => {
    const x = p0[0] + dx * t + side * ex * off
    const z = p0[1] + dz * t + side * ez * off
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
 * 南大门、门洞地面、南门广场草坪与喷泉、熊猫铜像、入园行道树。在 buildPaths 之后调用。
 * @returns {{ earTop: number }} 左耳顶的世界高度（定位针核对用）
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
  buildPlazaDetails(site)
  addStatue(site)
  plantCamphors(site)
  return { earTop: PAVE_Y + S * earTrue }
}

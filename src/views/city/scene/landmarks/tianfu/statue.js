/*
 * 天府广场 · 北侧组团：毛主席像组团
 * ----------------------------------------------------------
 * 职责：像下的台座、矮栏、SE 餐厅、两侧斜坡与后部台阶、正面阶梯花坡、基座与白色立像（设计第 4 节、报告 2.2 与 6.8）。
 * 由 north.js 的 buildNorth 调用；替换区、门前广场与路径在 north.js。
 * 轮廓全部取 OpenStreetMap（报告 2.2）：building w1532678567（转正后 75 × 56.9；报告 2.2 的 75.9 × 58.1
 * 是未扣 0.92° 的包围盒）及其 building:part——
 * - 深红花岗岩台座 w1303862402（转正后 46.4 × 28.4，报告的 46.5 × 29.1 同样是包围盒；高 8.1，前宽后窄的「工」字形）；
 * - 正面阶梯花坡 w1532678571（75 × 15.4，高 6，坡向南）；
 * - 两侧斜坡 w1332560650 / w1532678572（高 8.1，坡向东 / 西）；后部台阶 w1532678573 / 74（高 7，坡向北）；
 * - SE 餐厅 w1062135760（36 × 9，高 8.1）；像的基座 w1532678569（5.4 见方，8.1 → 15.2）；
 *   立像 w1532678570（4.8 见方，15.2 → 27.46）。
 * 坐标：像组团系 S——原点在立像中心，方位角 −0.92°（轮廓各边实测 0.88°～0.95°，东端偏北），
 * +X 向东（略偏北）、+Z 向南（正面）。多边形是 OSM 轮廓换到 S 系后取到 0.1 m。
 * 高度从组团地坪 NORTH_Y 起算（site.js），外墙从城市地面 GROUND_Y 立起。
 */
import { local } from "../kit/builder.js"
import { insetPolygon } from "../kit/footprint.js"
import {
  box,
  cylinder,
  extrudePolygon,
  fromTriangles,
  sideWalls,
  sphere
} from "../kit/shapes.js"
import { GROUND_Y } from "../../terrain.js"
import { C } from "./colors.js"
import { NORTH_Y } from "./site.js"
import { addInlay, addPrism, addSurface, rectUV, strut } from "./surface.js"

/* ---------------- 尺寸与定位（像组团系 S） ---------------- */

// 原点：立像中心（OSM w1532678570 的中心点）；方位角取 OSM 轮廓的实际朝向
export const STATUE = { lon: 104.0633079, lat: 30.6612661, bearing: -0.92 }

// 组团外轮廓（w1532678567）：东西 x −37～38，南北从后缘 z −24.5 到南沿 z 32.4（贴道路）；
// 后缘中部凹进去的一段是 SE 餐厅北墙
export const CLUSTER = { x0: -37.0, x1: 38.0, z0: -24.5, z1: 32.4 }
// SE 餐厅（w1062135760）：台座后面 36 × 9，顶面与台座齐平（8.1）；北墙临广场
export const RESTAURANT = { x0: -17.3, x1: 18.7, z0: -19.5, z1: -10.5 }

// 深红台座（w1303862402，高 8.1）是前宽后窄的「工」字形：
// 前段 x −22.7～23.7、z 7.5～17.9（46.4 × 10.4）；中段 x −12.9～13.5、z −1.1～7.5（26.4 × 8.6，像立在这里）；
// 后段与餐厅同宽（36 m），从餐厅南墙 z −10.5 到 z −5.6，中段与后段之间两道斜边
const PED = {
  front: [-22.7, 23.7],
  mid: [-12.9, 13.5],
  zFront: [7.5, 17.9],
  zMid: -1.1
}
// 台座后段两道斜边的南端：也是后部台阶的高端、斜坡与台阶分界斜边的起点
const CHAMFER_Z = -5.6
const PEDESTAL = [
  [PED.mid[0], PED.zMid],
  [PED.mid[0], PED.zFront[0]],
  [PED.front[0], PED.zFront[0]],
  [PED.front[0], PED.zFront[1]],
  [PED.front[1], PED.zFront[1]],
  [PED.front[1], PED.zFront[0]],
  [PED.mid[1], PED.zFront[0]],
  [PED.mid[1], PED.zMid],
  [RESTAURANT.x1, CHAMFER_Z],
  [RESTAURANT.x1, RESTAURANT.z1],
  [RESTAURANT.x0, RESTAURANT.z1],
  [RESTAURANT.x0, CHAMFER_Z]
]
const PEDESTAL_H = 8.1
// 矮栏：沿台座边内收 0.25 m、高 0.9（c15：台座顶上一圈浅灰栏杆）；
// 后沿（与 SE 餐厅屋面相接的一段）不设，所以从后沿西端开始、绕一圈到后沿东端
const RAIL = { inset: 0.25, h: 0.9 }

// 两侧斜坡（OSM roof:shape=skillion）：一个平面从内侧高边（8.1）斜到外侧低边（0）。
// 内侧高边在台座中段两侧缺口的内沿（中段东西边），外侧低边在组团轮廓东西边。
// 缺口里那一段（台座前段以北）在 Google 影像里是红褐色斜面，前段北墙在上面投下三角形影子；
// 前段以外到外沿才是草坡（影像里深绿色）。两段同一个平面，按台座前段东西边分成两块上色
const SLOPES = [
  { high: PED.mid[1], low: CLUSTER.x1, front: PED.front[1] }, // 东坡
  { high: PED.mid[0], low: CLUSTER.x0, front: PED.front[0] } // 西坡
]
// 后部台阶（w1532678573 / 74，坡向北）：组团后缘的 0 升到台座后段斜边南端的 7
const BACK = { z0: CLUSTER.z0, z1: CHAMFER_Z, h: 7 }
// 斜坡与后部台阶的分界（报告 2.2 轮廓里的斜边）：从台座后段斜边南端到组团后角
const BACK_HIPS = [
  [
    [RESTAURANT.x1, CHAMFER_Z],
    [CLUSTER.x1, CLUSTER.z0]
  ],
  [
    [RESTAURANT.x0, CHAMFER_Z],
    [CLUSTER.x0, CLUSTER.z0]
  ]
]

// 西缘矮台：OSM 绿地 #137（像组团下面那块）的西边比组团轮廓宽出约 1 m（S 系 x ≈ −38.0），
// 不盖住就会在西坡脚外露出一条 0.2 m 高的亮绿边（48 m²）。沿西沿铺一条 1.3 m 宽、顶面 NORTH_Y 的矮台，
// 顶面同门前广场的浅色铺装（Esri 影像上这里是浅灰人行道），超出 OSM 轮廓 1.3 m，在轮廓误差以内。
// 东沿外没有绿地露出，仍用挡墙
const WEST_KERB = { w: 1.3 }

// 正面阶梯花坡（w1532678571）：梯形，北沿贴台座前段南墙、南沿贴道路（组团南沿），
// 从 6 m 分 5 级降到路面，每级高 1.2、进深 2.9
const FLOWER = {
  z0: PED.zFront[1],
  z1: CLUSTER.z1,
  wN: PED.front,
  wS: [CLUSTER.x0, CLUSTER.x1]
}
const FLOWER_TOP = 6
const FLOWER_TIERS = 5
// 花坡图案：每级台面中线上一排菱形（白、黄两色逐级交替，奇数级错开半格），
// 用 surface.js 的 addInlay 挖洞铺回，与台面共面共边不闪
const DIAMOND = { spacing: 5.2, hx: 1.3, hz: 0.95, margin: 2 }

// 像的基座（w1532678569，5.4 见方，8.1 → 15.2）与白色立像（w1532678570，15.2 → 27.46，立像高 12.26）
const STATUE_BASE = { w: 5.4, top: 15.2, cap: 0.5 }

/* ---------------- 小工具 ---------------- */

/**
 * 竖直墙条：沿 a → c 立一块四边形，底在 y0，顶高取两端点各自的 y（斜面边上的挡墙、矮栏），写进 pos。
 * 法线约定：三角形按（a 底、c 底、c 顶）（a 底、c 顶、a 顶）绕，法线水平朝 a → c 方向的 (−dz, dx)，
 * 即沿 a → c 走时的右手边（俯视、北在上）：a → c 朝东时法线朝南（+Z），朝北时法线朝东（+X）。
 * 东西两侧镜像的墙若端点顺序照抄，有一侧会朝反，所以挡墙一律用 pushWallToward 按可见一侧定向
 */
function pushWall(pos, [ax, az, ay], [cx, cz, cy], y0 = GROUND_Y) {
  // 一端顶高等于墙底时那一半是零面积三角形，不写（墙就成了三角形）
  if (cy > y0) pos.push(ax, y0, az, cx, y0, cz, cx, cy, cz)
  if (ay > y0) pos.push(ax, y0, az, cx, cy, cz, ax, ay, az)
}

/** 同 pushWall，但按可见一侧定向：必要时对调两端，让法线指向 toward 点 [x, z] 那一侧 */
function pushWallToward(pos, a, c, toward, y0 = GROUND_Y) {
  // 法线 (−dz, dx) 与「a → toward」同向时保持端点顺序，否则对调
  const side =
    -(c[1] - a[1]) * (toward[0] - a[0]) + (c[0] - a[0]) * (toward[1] - a[1])
  if (side >= 0) pushWall(pos, a, c, y0)
  else pushWall(pos, c, a, y0)
}

/** 斜坡平面高度：内侧高边 high 处 8.1、外侧低边 low 处 0（相对 NORTH_Y） */
const slopeAt = (s) => (x) =>
  NORTH_Y + (PEDESTAL_H * (s.low - x)) / (s.low - s.high)

/** 后部台阶平面高度：z0 处 0、z1 处 7（相对 NORTH_Y） */
const backAt = (z) => NORTH_Y + (BACK.h * (z - BACK.z0)) / (BACK.z1 - BACK.z0)

/** 线段 a → c 上 x 坐标为 x 的点的 z（斜边与 x = 常数的交点） */
const zOnLine = ([a, c], x) =>
  a[1] + ((c[1] - a[1]) * (x - a[0])) / (c[0] - a[0])

/* ---------------- 斜坡、花坡、立像 ---------------- */

/**
 * 两侧斜坡、后部台阶、边上的挡墙与西缘矮台。
 * 斜坡按 OSM 的单坡屋面（skillion）理解：内侧高边 8.1 → 外沿 0 一个平面，
 * 台座前段两侧的竖墙在坡上露出 0～3.4 m（c21：草坡后面露出红墙）；
 * 后部台阶比相邻斜坡高 0～0.6 m，分界斜边上补一道挡墙。挡墙都按露出的一侧定向（pushWallToward）
 */
function buildSlopes(b, f) {
  const walls = []
  SLOPES.forEach((s, i) => {
    const y = slopeAt(s)
    const hip = BACK_HIPS[i]
    // 前段边线与后部斜边的交点：缺口段与草坡段在这里分开
    const zc = zOnLine(hip, s.front)
    // 缺口段：台座中段侧边、前段北墙、前段边线、后部斜边、台座后段斜边围成（红褐色斜面）
    const notch = [
      [s.high, PED.zMid],
      [s.high, PED.zFront[0]],
      [s.front, PED.zFront[0]],
      [s.front, zc],
      hip[0]
    ]
    addSurface(b, f, notch, [], (x) => y(x), C.pedestal)
    // 草坡段：前段边线到组团外沿；南边是花坡的斜边，北边是后部台阶的斜边
    const grass = [
      [s.front, FLOWER.z0],
      [s.low, FLOWER.z1],
      [s.low, BACK.z0],
      [s.front, zc]
    ]
    addSurface(b, f, grass, [], (x) => y(x), C.slopeGrass)
    // 后部台阶：台座后段斜边端点、组团后角、餐厅侧墙脚围成的三角形，坡向北
    const back = [hip[0], [hip[0][0], BACK.z0], hip[1]]
    addSurface(b, f, back, [], (x, z) => backAt(z), C.stairStone)
    // 挡墙（法线朝露出的一侧）：
    // - 组团外沿坡脚（顶 NORTH_Y），朝外；西沿外有矮台 WEST_KERB 顶着，不用挡墙（见下）
    if (s.low > 0) {
      pushWallToward(
        walls,
        [s.low, BACK.z0, NORTH_Y],
        [s.low, FLOWER.z1, NORTH_Y],
        [s.low + 1, 0]
      )
    }
    // - 斜坡与台阶的分界：台阶一侧更高，墙顶随台阶，露在斜坡一侧（取坡脚外沿上的一点）
    pushWallToward(
      walls,
      [hip[0][0], hip[0][1], backAt(hip[0][1])],
      [hip[1][0], hip[1][1], NORTH_Y],
      [s.low, 0]
    )
    // - 台阶临广场凹口的一侧（台阶西 / 东边在餐厅北墙以北露出来的一段）：露向凹口；
    //   墙底从 NORTH_Y 起，下面是门前广场的侧墙，不重复
    pushWallToward(
      walls,
      [hip[0][0], BACK.z0, NORTH_Y],
      [hip[0][0], RESTAURANT.z0, backAt(RESTAURANT.z0)],
      [0, (BACK.z0 + RESTAURANT.z0) / 2],
      NORTH_Y
    )
  })
  b.add(fromTriangles(walls), C.pedestal, f)
  // 西缘矮台：外沿侧墙代替西坡脚的挡墙，顶面盖住坡脚外那条城市绿地
  const k = WEST_KERB
  addPrism(
    b,
    f,
    rectUV(CLUSTER.x0 - k.w, CLUSTER.x0, CLUSTER.z0, CLUSTER.z1),
    [],
    GROUND_Y,
    NORTH_Y,
    C.pedestal,
    C.northPave
  )
}

/**
 * 正面阶梯花坡：5 级梯形台，每级台面红色、立面橙红（照片 c21 的红橙色，用户航拍「红橙色阶梯花坛」），
 * 台面中线上一排白 / 黄菱形图案（c15 的红底白纹、c22 的黄花）。
 * 两条斜边与两侧草坡相接；每级都比相邻草坡高，斜边上的台侧墙露出来（立面色）
 */
function buildFlowerSlope(b, f) {
  const d = (FLOWER.z1 - FLOWER.z0) / FLOWER_TIERS
  const rise = FLOWER_TOP / FLOWER_TIERS
  // 斜边上 z 处的东西两端
  const t = (z) => (z - FLOWER.z0) / (FLOWER.z1 - FLOWER.z0)
  const xW = (z) => FLOWER.wN[0] + (FLOWER.wS[0] - FLOWER.wN[0]) * t(z)
  const xE = (z) => FLOWER.wN[1] + (FLOWER.wS[1] - FLOWER.wN[1]) * t(z)
  const xc = (FLOWER.wN[0] + FLOWER.wN[1]) / 2
  for (let k = 0; k < FLOWER_TIERS; k++) {
    const z0 = FLOWER.z0 + d * k
    const z1 = z0 + d
    const top = NORTH_Y + FLOWER_TOP - rise * k
    const tier = [
      [xW(z0), z0],
      [xE(z0), z0],
      [xE(z1), z1],
      [xW(z1), z1]
    ]
    // 菱形：中心在台面中线，按北沿（较窄的一边）留出 margin，奇数级错开半格
    const zm = (z0 + z1) / 2
    const half = (xE(z0) - xW(z0)) / 2 - DIAMOND.margin - DIAMOND.hx
    const shift = k % 2 ? DIAMOND.spacing / 2 : 0
    const diamonds = []
    for (let n = -20; n <= 20; n++) {
      const off = n * DIAMOND.spacing + shift
      if (Math.abs(off) > half) continue
      const x = xc + off
      diamonds.push([
        [x - DIAMOND.hx, zm],
        [x, zm - DIAMOND.hz],
        [x + DIAMOND.hx, zm],
        [x, zm + DIAMOND.hz]
      ])
    }
    b.add(sideWalls(tier, GROUND_Y, top), C.flowerRise, f)
    // 红色台面把菱形当洞，菱形再铺回去（偶数级白、奇数级黄）
    const pattern = k % 2 ? C.flowerYellow : C.flowerWhite
    addInlay(b, f, tier, diamonds, top, C.flowerRed, pattern)
  }
}

/**
 * 白色立像（高 12.26，面朝南即局部 +Z）：照片 c15、old1——长大衣下摆外扩，右手上扬过头，左手垂在身侧略向后。
 * 面朝南时像的右手在西边（局部 −X）。s 为像底（基座顶面）坐标系
 */
function buildFigure(b, s) {
  const c = C.statue
  b.add(box(4.6, 0.45, 4.6), c, s) // 像底座板（OSM 立像轮廓 4.8 见方）
  b.add(
    cylinder(2.0, 1.4, 4.6, { segments: 12, caps: true }),
    c,
    local(s, 0, 0.45, 0)
  )
  b.add(
    cylinder(1.4, 1.2, 3.6, { segments: 12, caps: true }),
    c,
    local(s, 0, 5.05, 0)
  )
  b.add(box(3.2, 0.9, 1.9), c, local(s, 0, 8.25, 0)) // 肩
  b.add(
    cylinder(0.45, 0.45, 0.6, { segments: 8, caps: true }),
    c,
    local(s, 0, 9.1, 0)
  )
  b.add(sphere(0.78, 10, 7), c, local(s, 0, 10.35, 0.05)) // 头顶 11.13
  // 右臂：肩 → 肘 → 上扬的手，手顶到 12.26（OSM 像顶 27.46 − 基座顶 15.2）
  strut(b, s, [-1.45, 8.8, 0], [-2.2, 10.4, 0.7], 0.45, 0.38, c)
  strut(b, s, [-2.2, 10.4, 0.7], [-2.35, 11.85, 1.05], 0.38, 0.32, c)
  b.add(sphere(0.42, 6, 4), c, local(s, -2.35, 11.84, 1.05))
  // 左臂：垂在身侧、手略向后
  strut(b, s, [1.45, 8.8, 0], [1.65, 6.0, -0.65], 0.45, 0.36, c)
}

/* ---------------- 入口 ---------------- */

/**
 * 毛主席像组团：台座与矮栏、SE 餐厅、两侧斜坡与后部台阶、正面花坡、基座与立像。
 * @param {ColorBuilder} b 静态件
 * @param {Matrix4} f 像组团系 S（north.js 由 STATUE 建）
 */
export function buildStatue(b, f) {
  const top = NORTH_Y + PEDESTAL_H
  // 深红花岗岩台座（报告 6.9 #8A3F35）：顶面也是红色石材（影像）
  b.add(extrudePolygon(PEDESTAL, [], GROUND_Y, top), C.pedestal, f)
  // 矮栏：台座轮廓内收后从后沿西端起、绕到后沿东端（去掉与餐厅相接的后沿）
  const ring = insetPolygon(PEDESTAL, RAIL.inset)
  const start = PEDESTAL.findIndex(
    ([x, z]) => x === RESTAURANT.x0 && z === RESTAURANT.z1
  )
  if (start < 0) throw new Error("台座轮廓里找不到后沿西端（餐厅西南角）")
  const line = [...ring.slice(start), ...ring.slice(0, start)]
  const rail = []
  for (let i = 0; i + 1 < line.length; i++) {
    pushWall(
      rail,
      [line[i][0], line[i][1], top + RAIL.h],
      [line[i + 1][0], line[i + 1][1], top + RAIL.h],
      top
    )
  }
  b.add(fromTriangles(rail), C.railing, f)

  // SE 餐厅：红石墙、灰色屋面（Google 影像）；北墙一条深色玻璃店面临广场
  const r = RESTAURANT
  addPrism(
    b,
    f,
    rectUV(r.x0, r.x1, r.z0, r.z1),
    [],
    GROUND_Y,
    top,
    C.pedestal,
    C.roofGrey
  )
  // 北墙店面：两端各留 1.5 m 墙垛，法线朝 −Z（广场一侧）
  const glass = []
  const shop = { x: (r.x0 + r.x1) / 2, w: r.x1 - r.x0 - 3, y: NORTH_Y + 0.4 }
  const sy = shop.y + 6.4
  pushWall(
    glass,
    [shop.x + shop.w / 2, r.z0 - 0.06, sy],
    [shop.x - shop.w / 2, r.z0 - 0.06, sy],
    shop.y
  )
  b.add(fromTriangles(glass), C.sciGlass, f)

  buildSlopes(b, f)
  buildFlowerSlope(b, f)

  // 像的红色基座：7.1 m 高，顶上一道略宽的压檐
  const bw = STATUE_BASE.w
  const bh = STATUE_BASE.top - PEDESTAL_H
  b.add(box(bw, bh - STATUE_BASE.cap, bw), C.statueBase, local(f, 0, top, 0))
  b.add(
    box(bw + 0.5, STATUE_BASE.cap, bw + 0.5),
    C.statueBase,
    local(f, 0, NORTH_Y + STATUE_BASE.top - STATUE_BASE.cap, 0)
  )
  buildFigure(b, local(f, 0, NORTH_Y + STATUE_BASE.top, 0))
}

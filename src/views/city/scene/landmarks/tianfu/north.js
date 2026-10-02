/*
 * 天府广场 · 北侧组团：毛主席像、四川科技馆、两者之间的广场
 * ----------------------------------------------------------
 * 职责：道路以北的三处构件，以及科技馆前的南北轴线路径（设计第 4 节、报告 2.2 与 6.8）。
 * 轮廓全部取 OpenStreetMap（报告 2.2）：
 * - 毛主席像组团：building w1532678567（转正后 75 × 56.9；报告 2.2 的 75.9 × 58.1 是未扣 0.92° 的包围盒）及其 building:part——
 *   深红花岗岩台座 w1303862402（46.5 × 29.1，高 8.1，前宽后窄的「工」字形）、
 *   正面阶梯花坡 w1532678571（75 × 15.4，高 6，坡向南）、两侧斜坡 w1332560650 / w1532678572
 *   （高 8.1，坡向东 / 西）、后部台阶 w1532678573 / 74（高 7，坡向北）、
 *   SE 餐厅 w1062135760（36 × 9，高 8.1）、像的基座 w1532678569（5.4 见方，8.1 → 15.2）、
 *   立像 w1532678570（4.8 见方，15.2 → 27.46）。
 * - 四川科技馆：主体 r21034011（142.2 × 104.4，高 30.75，中间有内院）、前楼 w1395649617
 *   （125.9 × 25.4，30.75 → 38）、4 座塔 w1532678575～78（约 7 × 9，高 40）。
 * - 两者之间的广场：OSM 步行区 w1189709154 加科技馆门前一段，铺装上有 10 m 见方的深色分格线（Google 影像）。
 *
 * 坐标：两处各用自己的 OSM 点位作原点、按各自 OSM 轮廓的实际朝向摆放（不用广场设计系）：
 * - 像组团系 S：原点在立像中心，方位角 −0.92°（轮廓各边实测 0.88°～0.95°，东端偏北）；
 * - 科技馆系 M：原点在正立面中点（OSM 楼顶招牌点 n13970973053），方位角 −1.39°。
 * 两系都是 +X 向东（略偏北）、+Z 向南（正面）。下面的多边形是 OSM 轮廓换到各自坐标系后取到 0.1 m。
 * 高度：组团地坪 NORTH_Y（两者之间广场铺装的顶面）是 OSM 高度的起算面，外墙一律从城市地面 GROUND_Y 立起，不悬空。
 *
 * 与旧模型的差别（报告 5）：像下的三级浅色台基改成深红台座 + 阶梯花坡 + 两侧斜坡；
 * 科技馆加高到 30.75 / 38 / 40，去掉砖红塔楼，换成米黄塔身 + 赭红压顶、10 根赭红柱、横梁与窗带、屋顶红字。
 * 南北轴线原先走在城市地面上（校验脚本只认景点自己的三角形，2805 个支撑坏点），现在走在本文件的广场铺装上。
 */
import { Matrix4, Vector3 } from "three"
import { frame, local } from "../kit/builder.js"
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
import { C, pushUp, rectUV, strut, triangulate } from "./site.js"

/* ---------------- 组团地坪 ---------------- */

// 组团地坪：像与科技馆之间广场铺装的顶面，也是 OSM 高度的起算面。
// 比城市地面（GROUND_Y −0.5）高 1.5 m、比道路面最高处（0.9）略高，免得哪段路面压上来；
// 广场南侧的天府广场铺装是 PAVE 1.5，这里低 0.5 m，中间隔着一条道路，看不出高差
const NORTH_Y = 1.0

/* ---------------- 毛主席像组团（像组团系 S） ---------------- */

// 原点：立像中心（OSM w1532678570 的中心点）；方位角取 OSM 轮廓的实际朝向
const STATUE = { lon: 104.0633079, lat: 30.6612661, bearing: -0.92 }

// 深红台座（w1303862402，高 8.1）：前段 46.4 × 10.4、中段 26.4 × 8.6（像立在中段）、
// 后段 36 × 4.9，中段与后段之间两道斜边
const PEDESTAL = [
  [-12.9, -1.1],
  [-12.9, 7.5],
  [-22.7, 7.5],
  [-22.7, 17.9],
  [23.7, 17.9],
  [23.7, 7.5],
  [13.5, 7.5],
  [13.5, -1.1],
  [18.7, -5.6],
  [18.7, -10.5],
  [-17.3, -10.5],
  [-17.3, -5.6]
]
const PEDESTAL_H = 8.1
// 矮栏：沿台座边内收 0.25 m、高 0.9（c15：台座顶上一圈浅灰栏杆）；
// 后沿（与 SE 餐厅屋面相接的一段）不设，所以从后沿西端开始、绕一圈到后沿东端
const RAIL = { inset: 0.25, h: 0.9 }

// SE 餐厅（w1062135760）：台座后面 36 × 9，顶面与台座齐平（8.1）；北墙临广场
const RESTAURANT = { x0: -17.3, x1: 18.7, z0: -19.5, z1: -10.5 }

// 两侧斜坡（OSM roof:shape=skillion）：一个平面从内侧高边（8.1）斜到外侧低边（0）。
// 内侧高边在台座中段两侧缺口的内沿 x = 13.5 / −12.9，外侧低边在组团轮廓 x = 38 / −37。
// 缺口里那一段（台座前段以北）在 Google 影像里是红褐色斜面，前段北墙在上面投下三角形影子；
// 前段以外到外沿才是草坡（影像里深绿色）。两段同一个平面，按 x = ±前段边线分成两块上色
const SLOPES = [
  { high: 13.5, low: 38.0, front: 23.7 }, // 东坡
  { high: -12.9, low: -37.0, front: -22.7 } // 西坡
]
// 后部台阶（w1532678573 / 74，坡向北）：组团后缘（z −24.5）的 0 升到台座后段斜边端点（z −5.6）的 7
const BACK = { z0: -24.5, z1: -5.6, h: 7 }
// 斜坡与后部台阶的分界（报告 2.2 轮廓里的斜边）：从台座后段斜边端点到组团后角
const BACK_HIPS = [
  [
    [18.7, -5.6],
    [38.0, -24.5]
  ],
  [
    [-17.3, -5.6],
    [-37.0, -24.5]
  ]
]

// 正面阶梯花坡（w1532678571）：梯形，北沿贴台座前段（z 17.9，x −22.7～23.7）、
// 南沿贴道路（z 32.4，x −37～38），从 6 m 分 5 级降到路面，每级高 1.2、进深 2.9
const FLOWER = { z0: 17.9, z1: 32.4, wN: [-22.7, 23.7], wS: [-37.0, 38.0] }
const FLOWER_TOP = 6
const FLOWER_TIERS = 5
// 花坡图案：每级台面中线上一排菱形（白、黄两色逐级交替，奇数级错开半格）。
// 菱形当作台面的洞三角化，再用同一组顶点铺回去，共面共边不闪（做法同 ground.js 的祥云块）
const DIAMOND = { spacing: 5.2, hx: 1.3, hz: 0.95, margin: 2 }

// 像的基座（w1532678569，5.4 见方，8.1 → 15.2）与白色立像（w1532678570，15.2 → 27.46，立像高 12.26）
const STATUE_BASE = { w: 5.4, top: 15.2, cap: 0.5 }

// 组团外轮廓（w1532678567）向外 1.5 m 作替换区：盖住几何数据里像下那座无名楼（h 15.1）
const CLUSTER_ZONE = rectUV(-38.5, 39.5, -26, 34)

/* ---------------- 像与科技馆之间的广场（像组团系 S） ---------------- */

// 广场铺装：南沿贴组团后缘（中部凹进去贴 SE 餐厅北墙），北沿一直铺到科技馆柱廊后墙（M 系 z −5.2，
// 换到 S 系约 −88.5～−89.0）以内 0.2～0.7 m，正门前的柱廊地面也由它提供；
// 伸进科技馆墙内的部分被楼体盖住。东西宽 92 m（OSM 步行区约 97 m，两侧各让开 2～3 m 的楼）
const PLAZA = [
  [-46, -24.5],
  [-17.3, -24.5],
  [-17.3, -19.5],
  [18.7, -19.5],
  [18.7, -24.5],
  [46, -24.5],
  [46, -89.2],
  [-46, -89.2]
]
// 分格线（Google 影像）：南北向 7 道、东西向 4 道，间距 10 m、宽 1.2，中线 x = 1.2 对着科技馆正门
const GRID = {
  xs: [-28.8, -18.8, -8.8, 1.2, 11.2, 21.2, 31.2],
  zs: [-69.6, -59.6, -49.6, -39.6],
  w: 1.2
}
const PLAZA_ZONE = rectUV(-47, 47, -89.2, -24.5)

// 科技馆前南北轴线：沿分格中线，南端离 SE 餐厅北墙 7 m，北端离柱廊前沿约 5.5 m
const AXIS = { x: 1.2, z0: -26.5, z1: -78, width: 8, density: 1.5 }

/* ---------------- 四川科技馆（科技馆系 M） ---------------- */

// 原点：正立面中点（OSM 楼顶招牌点 n13970973053，正好在前楼南墙中点上）
const SCIENCE = { lon: 104.0633096, lat: 30.6620219, bearing: -1.39 }
const SCI_H = { body: 30.75, front: 38, tower: 40, cap: 1.2 }

// 主体（r21034011 外环，高 30.75）：前部一条 141.6 × 22.5 横贯东西，后部 112 × 78.8；
// 南墙在 4 座塔处各让出一个槽（塔填进去），两内塔之间退后 5.2 m 成柱廊
const SCI_BODY = [
  [-70.9, 0],
  [-70.9, -22.5],
  [-55.9, -22.5],
  [-55.9, -101.3],
  [56.2, -101.3],
  [56.2, -22.5],
  [70.7, -22.5],
  [70.7, 0],
  [61.3, 0],
  [61.3, -7.0],
  [55.0, -7.0],
  [55.0, 0],
  [36.7, 0],
  [36.7, -7.0],
  [29.7, -7.0],
  [29.7, -5.2],
  [-29.7, -5.2],
  [-29.7, -7.0],
  [-36.1, -7.0],
  [-36.1, 0],
  [-54.4, 0],
  [-54.4, -7.0],
  [-61.5, -7.0],
  [-61.5, 0]
]
// 内院（r21034011 内环）：南沿就是前楼北墙
const SCI_COURT = rectUV(-41.9, 44.0, -79.3, -22.5)
// 前楼（w1395649617，30.75 → 38）：东西两端各有 1～1.5 m 退后 5.2 m；同样在塔处让槽
const SCI_FRONT = [
  [-62.6, -22.5],
  [-62.6, -5.2],
  [-61.5, -5.2],
  [-61.5, -7.0],
  [-54.4, -7.0],
  [-54.4, 0],
  [-36.1, 0],
  [-36.1, -7.0],
  [-29.7, -7.0],
  [-29.7, 0],
  [29.7, 0],
  [29.7, -7.0],
  [36.7, -7.0],
  [36.7, 0],
  [55.0, 0],
  [55.0, -7.0],
  [61.3, -7.0],
  [61.3, -5.2],
  [62.8, -5.2],
  [62.8, -22.5]
]
// 4 座塔（w1532678575～78）：x 区间，南北都是 z 2.0 → −7.0（比立面凸出 2 m）
const SCI_TOWERS = [
  [-61.5, -54.4],
  [-36.1, -29.7],
  [29.7, 36.7],
  [55.0, 61.3]
]
const TOWER_Z = [2.0, -7.0]
// 柱廊（报告 6.8；照片 c21、c22 数得 10 根柱、9 开间）：两内塔之间 59.4 m，
// 10 根 2.2 m 见方的柱，柱心从 −26.6 到 26.6 等距（间距 5.91，净开间 3.71），柱前面与立面平；
// 柱高 24（含 0.8 柱础、1.0 柱头）
const COLONNADE = {
  x0: -26.6,
  x1: 26.6,
  n: 10,
  size: 2.2,
  h: 24,
  base: 0.8,
  cap: 1.0
}
// 柱廊后墙（主体南墙退后处）
const PORTICO_Z = -5.2
// 窗带与线脚高度（照片 c15、c21：赭红横梁与两翼的赭红腰线同高，横梁以上一排窗，顶上赭红檐口）
const BEAM = { y: 24, h: 2.2 }
const CORNICE_H = 1.2
const BAND = { y: 28.6, h: 4.6 } // 横梁以上那排窗（柱廊 9 个，两翼各 3 个）
const FLOOR_ROWS = [2.6, 8.3, 14.0, 19.7] // 腰线以下四层窗的窗底
// 内院：OSM 只标了环形主体；Google 影像里院子被一层低屋面盖住，中间一座南北向的大拱顶
// （宽约 35.5、长约 45）。高度没有资料，取低屋面 14、拱顶再高 9（都低于主体 30.75）
const COURT_ROOF = 14
const VAULT = { x: 1.4, hw: 17.6, z0: -24, z1: -68, rise: 9, seg: 8 }

// 楼顶招牌（c15、old1）：5 个红色书法大字各约 6 m，每字一个白色方框架；下面一行红色英文。
// 立在前楼屋面靠南沿（z −2.4），字心间距 7.2
const SIGN = { z: -2.4, pitch: 7.2, frame: [6.4, 6.8], bar: 0.35, base: 0.5 }
// 笔画：每字在 6 × 6.4 的格子里用几根扁方条拼出大致字形（不追求真字形，读出「一排红字」即可）。
// 坐标为格内 [x, y]（x 以字心为 0，y 从框底算起）
const GLYPHS = [
  // 四
  [
    [
      [-2.5, 5.6],
      [2.6, 5.7]
    ],
    [
      [-2.5, 5.6],
      [-2.6, 0.8]
    ],
    [
      [2.6, 5.7],
      [2.5, 0.8]
    ],
    [
      [-2.6, 0.8],
      [2.5, 0.8]
    ],
    [
      [-0.8, 5.5],
      [-1.5, 2.6]
    ],
    [
      [0.8, 5.5],
      [1.8, 2.6]
    ]
  ],
  // 川
  [
    [
      [-1.9, 6.0],
      [-2.4, 0.6]
    ],
    [
      [0.0, 5.4],
      [0.0, 1.4]
    ],
    [
      [2.1, 6.2],
      [2.1, 0.3]
    ]
  ],
  // 科
  [
    [
      [-0.9, 6.0],
      [-2.6, 5.2]
    ],
    [
      [-2.8, 4.2],
      [-0.4, 4.3]
    ],
    [
      [-1.6, 5.4],
      [-1.6, 0.3]
    ],
    [
      [-1.7, 3.9],
      [-2.9, 1.8]
    ],
    [
      [0.5, 4.6],
      [1.3, 3.6]
    ],
    [
      [0.1, 2.2],
      [2.9, 2.7]
    ],
    [
      [2.1, 6.1],
      [2.1, 0.3]
    ]
  ],
  // 技
  [
    [
      [-2.8, 4.4],
      [-0.8, 4.6]
    ],
    [
      [-1.8, 6.0],
      [-1.8, 0.7]
    ],
    [
      [-2.8, 2.0],
      [-0.8, 3.0]
    ],
    [
      [0.0, 4.9],
      [2.9, 4.9]
    ],
    [
      [1.45, 6.1],
      [1.45, 3.5]
    ],
    [
      [0.3, 3.3],
      [2.6, 3.2]
    ],
    [
      [2.6, 3.2],
      [0.2, 0.4]
    ],
    [
      [1.0, 2.2],
      [2.9, 0.3]
    ]
  ],
  // 馆
  [
    [
      [-1.9, 6.0],
      [-2.9, 4.2]
    ],
    [
      [-2.4, 3.8],
      [-2.4, 0.6]
    ],
    [
      [-2.4, 0.6],
      [-1.3, 1.4]
    ],
    [
      [-0.5, 5.2],
      [2.9, 5.2]
    ],
    [
      [1.2, 6.2],
      [1.2, 5.2]
    ],
    [
      [0.2, 4.2],
      [0.2, 0.3]
    ],
    [
      [0.2, 4.2],
      [2.4, 4.2]
    ],
    [
      [2.4, 4.2],
      [2.4, 0.3]
    ],
    [
      [0.2, 2.3],
      [2.4, 2.3]
    ],
    [
      [0.2, 0.3],
      [2.6, 0.3]
    ]
  ]
]
const STROKE = { w: 0.75, d: 0.4 }
// 英文条「SICHUAN SCIENCE AND TECHNOLOGY MUSEUM」：每个单词一根红条，长度按字母数（每字母 0.92 m）
const ENGLISH = { words: [7, 7, 3, 10, 6], letter: 0.92, gap: 1.0, h: 0.9 }

// 替换区：科技馆轮廓（含 OSM 博物馆面背后那块 5 m 的凸出）外扩 1.5 m
const SCI_ZONE = rectUV(-72.5, 72.5, -103, 3.5)

/* ---------------- 通用小函数 ---------------- */

/** 局部坐标系 f 里的一组点 [x, z] → 世界 [x, z]（替换区、步行路径用） */
function worldPts(f, pts) {
  const v = new Vector3()
  return pts.map(([x, z]) => {
    v.set(x, 0, z).applyMatrix4(f)
    return [v.x, v.z]
  })
}

/** 平面多边形（可带洞）铺成朝上的面，高度由 yAt(x, z) 给出（常数函数即水平面，平面方程即斜面） */
function addSurface(b, f, outer, holes, yAt, color) {
  const pos = []
  for (const t of triangulate(outer, holes)) pushUp(pos, t, yAt)
  b.add(fromTriangles(pos), color, f)
}

/** 实心棱柱：竖直侧墙一种颜色、顶面另一种颜色（extrudePolygon 只有一种颜色；屋面与墙面分色时用这个） */
function addPrism(b, f, outer, holes, y0, y1, wallColor, topColor) {
  b.add(sideWalls(outer, y0, y1), wallColor, f)
  for (const h of holes) b.add(sideWalls(h, y0, y1, true), wallColor, f)
  addSurface(b, f, outer, holes, () => y1, topColor)
}

/** 竖直墙条：沿 a → c 立一块四边形，底在 y0，顶高取两端点各自的 y（斜面边上的挡墙），写进 pos */
function pushWall(pos, [ax, az, ay], [cx, cz, cy], y0 = GROUND_Y) {
  pos.push(ax, y0, az, cx, y0, cz, cx, cy, cz)
  pos.push(ax, y0, az, cx, cy, cz, ax, ay, az)
}

/**
 * 南 / 北立面（z = zf）上排窗：xs 为窗中心、ys 为窗底，写进 pos。
 * dir = 1（默认）为南立面，法线朝 +Z；−1 为北立面：x 两端对调，绕向反过来，法线朝 −Z
 */
function frontWindows(pos, xs, ys, w, h, zf, dir = 1) {
  for (const y of ys) {
    for (const x of xs) {
      const x0 = x - (dir * w) / 2
      const x1 = x + (dir * w) / 2
      pos.push(x0, y, zf, x1, y, zf, x1, y + h, zf)
      pos.push(x0, y, zf, x1, y + h, zf, x0, y + h, zf)
    }
  }
}

/**
 * 东西立面（x = xf）上排窗：zs 为窗中心、ys 为窗底，写进 pos。
 * dir = 1 为东立面（法线朝 +X），−1 为西立面：沿 z 减小方向绕时法线朝 +X
 */
function sideWindows(pos, zs, ys, w, h, xf, dir) {
  for (const y of ys) {
    for (const z of zs) {
      const za = z + (dir * w) / 2
      const zb = z - (dir * w) / 2
      pos.push(xf, y, za, xf, y, zb, xf, y + h, zb)
      pos.push(xf, y, za, xf, y + h, zb, xf, y + h, za)
    }
  }
}

/** 等距取 n 个数：a → c（含两端） */
const spread = (a, c, n) =>
  Array.from({ length: n }, (_, i) => a + ((c - a) * i) / (n - 1))

/* ---------------- 毛主席像组团 ---------------- */

/** 斜坡平面高度：内侧高边 high 处 8.1、外侧低边 low 处 0（相对 NORTH_Y） */
const slopeAt = (s) => (x) =>
  NORTH_Y + (PEDESTAL_H * (s.low - x)) / (s.low - s.high)

/** 后部台阶平面高度：z0 处 0、z1 处 7（相对 NORTH_Y） */
const backAt = (z) => NORTH_Y + (BACK.h * (z - BACK.z0)) / (BACK.z1 - BACK.z0)

/** 线段 a → c 上 x 坐标为 x 的点的 z（斜边与 x = 常数的交点） */
const zOnLine = ([a, c], x) =>
  a[1] + ((c[1] - a[1]) * (x - a[0])) / (c[0] - a[0])

/**
 * 两侧斜坡、后部台阶及其边上的挡墙。
 * 斜坡按 OSM 的单坡屋面（skillion）理解：内侧高边 8.1 → 外沿 0 一个平面，
 * 台座前段两侧的竖墙在坡上露出 0～3.4 m（c21：草坡后面露出红墙）；
 * 后部台阶比相邻斜坡高 0～0.6 m，分界斜边上补一道挡墙
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
      [s.high, -1.1],
      [s.high, 7.5],
      [s.front, 7.5],
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
    // 挡墙：组团外沿（坡脚 NORTH_Y）、斜坡与台阶的分界（台阶一侧更高，墙顶随台阶）、
    // 台阶临广场凹口的一侧（台阶西 / 东边在餐厅北墙以北露出来的一段）
    pushWall(walls, [s.low, BACK.z0, NORTH_Y], [s.low, FLOWER.z1, NORTH_Y])
    pushWall(
      walls,
      [hip[0][0], hip[0][1], backAt(hip[0][1])],
      [hip[1][0], hip[1][1], NORTH_Y]
    )
    pushWall(
      walls,
      [hip[0][0], BACK.z0, NORTH_Y],
      [hip[0][0], RESTAURANT.z0, backAt(RESTAURANT.z0)]
    )
  })
  b.add(fromTriangles(walls), C.pedestal, f)
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
    const flat = () => top
    b.add(sideWalls(tier, GROUND_Y, top), C.flowerRise, f)
    addSurface(b, f, tier, diamonds, flat, C.flowerRed)
    const pattern = k % 2 ? C.flowerYellow : C.flowerWhite
    const pos = []
    for (const dm of diamonds) {
      for (const tri of triangulate(dm)) pushUp(pos, tri, flat)
    }
    if (pos.length) b.add(fromTriangles(pos), pattern, f)
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

/** 毛主席像组团：台座与矮栏、SE 餐厅、两侧斜坡与后部台阶、正面花坡、基座与立像 */
function buildStatue(b, f) {
  const top = NORTH_Y + PEDESTAL_H
  // 深红花岗岩台座（报告 6.9 #8A3F35）：顶面也是红色石材（影像）
  b.add(extrudePolygon(PEDESTAL, [], GROUND_Y, top), C.pedestal, f)
  // 矮栏：台座轮廓内收后从后沿西端起、绕到后沿东端（去掉与餐厅相接的后沿）
  const ring = insetPolygon(PEDESTAL, RAIL.inset)
  const start = PEDESTAL.findIndex(([x, z]) => x === -17.3 && z === -10.5)
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
  frontWindows(glass, [shop.x], [shop.y], shop.w, 6.4, r.z0 - 0.06, -1)
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

/* ---------------- 像与科技馆之间的广场 ---------------- */

/**
 * 广场铺装：外轮廓 PLAZA，分格线范围挖成洞，洞里再铺深色格框与浅色格心（三者共面共边，不闪）。
 * 侧墙从城市地面立到 NORTH_Y
 */
function buildPlaza(b, f) {
  const hw = GRID.w / 2
  const gx0 = GRID.xs[0] - hw
  const gx1 = GRID.xs[GRID.xs.length - 1] + hw
  const gz0 = GRID.zs[0] - hw
  const gz1 = GRID.zs[GRID.zs.length - 1] + hw
  const gridRect = rectUV(gx0, gx1, gz0, gz1)
  const flat = () => NORTH_Y
  b.add(sideWalls(PLAZA, GROUND_Y, NORTH_Y), C.northPave, f)
  addSurface(b, f, PLAZA, [gridRect], flat, C.northPave)
  // 格心：相邻两道线之间（线宽以外）
  const cells = []
  for (let i = 0; i + 1 < GRID.xs.length; i++) {
    for (let j = 0; j + 1 < GRID.zs.length; j++) {
      cells.push(
        rectUV(
          GRID.xs[i] + hw,
          GRID.xs[i + 1] - hw,
          GRID.zs[j] + hw,
          GRID.zs[j + 1] - hw
        )
      )
    }
  }
  addSurface(b, f, gridRect, cells, flat, C.northGrid)
  const pos = []
  for (const cell of cells) {
    for (const tri of triangulate(cell)) pushUp(pos, tri, flat)
  }
  b.add(fromTriangles(pos), C.northPave, f)
}

/* ---------------- 四川科技馆 ---------------- */

/** 招牌笔画：父坐标系里 (x0, y0) → (x1, y1) 的一根扁方条，立在 z 平面上（宽 w、厚 d），两端各伸出半个笔宽 */
function addStroke(b, f, [x0, y0], [x1, y1], z, color) {
  const len = Math.hypot(x1 - x0, y1 - y0)
  const m = new Matrix4().makeRotationZ(Math.atan2(y1 - y0, x1 - x0))
  m.setPosition((x0 + x1) / 2, (y0 + y1) / 2, z)
  // 斜放的笔画底面会转到侧面，所以保留底面
  const g = box(len + STROKE.w, STROKE.w, STROKE.d, { bottom: true })
  g.translate(0, -STROKE.w / 2, 0)
  b.add(g, color, f.clone().multiply(m))
}

/** 楼顶招牌：白色底梁、英文条（白底红字条）、5 个白色方框架与红色大字 */
function buildSign(b, f) {
  const y0 = NORTH_Y + SCI_H.front
  const z = SIGN.z
  const [fw, fh] = SIGN.frame
  const span = SIGN.pitch * 4 + fw
  b.add(box(span, SIGN.base, 1.2), C.sciWhite, local(f, 0, y0, z))
  // 英文条：白色底板上 5 根红条（单词），总长按字母数 + 词间距
  const eb = y0 + SIGN.base
  b.add(box(span, 1.5, 0.3), C.sciWhite, local(f, 0, eb, z + 0.45))
  const lens = ENGLISH.words.map((n) => n * ENGLISH.letter)
  const total =
    lens.reduce((s, l) => s + l, 0) + ENGLISH.gap * (lens.length - 1)
  let x = -total / 2
  for (const l of lens) {
    b.add(
      box(l, ENGLISH.h, 0.15),
      C.sign,
      local(f, x + l / 2, eb + 0.3, z + 0.67)
    )
    x += l + ENGLISH.gap
  }
  // 方框架与大字
  const fy = eb + 1.5 + 0.2
  GLYPHS.forEach((strokes, i) => {
    const cx = (i - 2) * SIGN.pitch
    const t = SIGN.bar
    const fm = local(f, cx, fy, z)
    b.add(box(fw, t, t), C.sciWhite, fm)
    b.add(box(fw, t, t), C.sciWhite, local(fm, 0, fh - t, 0))
    for (const s of [-1, 1]) {
      b.add(
        box(t, fh - 2 * t, t),
        C.sciWhite,
        local(fm, (s * (fw - t)) / 2, t, 0)
      )
    }
    for (const [p, q] of strokes) {
      addStroke(
        b,
        f,
        [cx + p[0], fy + p[1] + 0.1],
        [cx + q[0], fy + q[1] + 0.1],
        z + 0.4,
        C.sign
      )
    }
  })
}

/**
 * 四川科技馆：主体（内院上有低屋面与拱顶）、前楼、4 座塔、柱廊、窗、赭红线脚、楼顶招牌。
 * f 原点在正立面中点、局部 +Z 朝南（正门）。墙米黄（#E6D6AA），屋面灰（Google 影像）
 */
function buildScience(b, f) {
  const Y = (h) => NORTH_Y + h
  // 主体与前楼
  addPrism(
    b,
    f,
    SCI_BODY,
    [SCI_COURT],
    GROUND_Y,
    Y(SCI_H.body),
    C.sciWall,
    C.roofGrey
  )
  b.add(sideWalls(SCI_FRONT, Y(SCI_H.body), Y(SCI_H.front)), C.sciWall, f)
  addSurface(b, f, SCI_FRONT, [], () => Y(SCI_H.front), C.roofGrey)
  // 柱廊上方的檐墙：两内塔之间、柱廊后墙以南，24 → 30.75，底面就是柱廊顶棚（保留底面）
  const [tx0, tx1] = [SCI_TOWERS[1][1], SCI_TOWERS[2][0]]
  b.add(
    box(tx1 - tx0, SCI_H.body - BEAM.y, -PORTICO_Z, { bottom: true }),
    C.sciWall,
    local(f, (tx0 + tx1) / 2, Y(BEAM.y), PORTICO_Z / 2)
  )

  // 内院：低屋面 + 南北向拱顶（半椭圆截面，seg 段）
  const court = SCI_COURT
  addSurface(b, f, court, [], () => Y(COURT_ROOF), C.roofGrey)
  const vault = []
  const arc = (k) => {
    const a = (Math.PI * k) / VAULT.seg
    return [
      VAULT.x + VAULT.hw * Math.cos(a),
      Y(COURT_ROOF) + VAULT.rise * Math.sin(a)
    ]
  }
  const yr = Y(COURT_ROOF)
  for (let k = 0; k < VAULT.seg; k++) {
    const [xa, ya] = arc(k)
    const [xb, yb] = arc(k + 1)
    // a / b 为这一段拱面的东 / 西两条母线，0 / 1 为南 / 北端
    const [a0, a1] = [
      [xa, ya, VAULT.z0],
      [xa, ya, VAULT.z1]
    ]
    const [b0, b1] = [
      [xb, yb, VAULT.z0],
      [xb, yb, VAULT.z1]
    ]
    // 拱面：从东往西绕，法线朝外上方
    vault.push(...a0, ...a1, ...b1, ...a0, ...b1, ...b0)
    // 南北两端的半椭圆封面：南端（z0）法线朝 +Z、北端（z1）朝 −Z
    vault.push(VAULT.x, yr, VAULT.z0, ...a0, ...b0)
    vault.push(VAULT.x, yr, VAULT.z1, ...b1, ...a1)
  }
  b.add(fromTriangles(vault), C.sciVault, f)

  // 4 座塔：米黄塔身到 38.8，顶上 1.2 m 赭红压顶（四周各挑出 0.3），去掉旧模型的砖红塔楼
  const tz = (TOWER_Z[0] + TOWER_Z[1]) / 2
  const td = TOWER_Z[0] - TOWER_Z[1]
  for (const [x0, x1] of SCI_TOWERS) {
    const w = x1 - x0
    const xm = (x0 + x1) / 2
    const body = Y(SCI_H.tower - SCI_H.cap) - GROUND_Y
    b.add(box(w, body, td), C.sciWall, local(f, xm, GROUND_Y, tz))
    b.add(
      box(w + 0.6, SCI_H.cap, td + 0.6),
      C.sciRed,
      local(f, xm, Y(SCI_H.tower - SCI_H.cap), tz)
    )
  }

  // 柱廊：10 根赭红方柱，白色柱础、柱头；柱前面与立面平（z 0）
  const cols = spread(COLONNADE.x0, COLONNADE.x1, COLONNADE.n)
  const cs = COLONNADE.size
  const shaft = COLONNADE.h - COLONNADE.base - COLONNADE.cap
  for (const x of cols) {
    const m = local(f, x, Y(0), -cs / 2)
    b.add(box(cs + 0.4, COLONNADE.base, cs + 0.4), C.sciWhite, m)
    b.add(box(cs, shaft, cs), C.sciColumn, local(m, 0, COLONNADE.base, 0))
    b.add(
      box(cs + 0.5, COLONNADE.cap, cs + 0.5),
      C.sciWhite,
      local(m, 0, COLONNADE.base + shaft, 0)
    )
  }
  // 柱间深色玻璃：贴在柱廊后墙上，每个开间一块
  const bays = cols.slice(1).map((x, i) => (x + cols[i]) / 2)
  const bayW = cols[1] - cols[0] - cs - 0.5
  const glass = []
  frontWindows(glass, bays, [Y(0.6)], bayW, 21.9, PORTICO_Z + 0.06)
  b.add(fromTriangles(glass), C.sciGlass, f)

  // 窗：柱廊上方一排 9 个；两内外塔之间的两翼各 4 层 × 3 + 顶排 3；最外两端低翼 5 层 × 2；
  // 侧立面（外端低翼东西墙、后部主体东西墙）5 层窗
  const win = []
  frontWindows(win, bays, [Y(BAND.y)], 3.0, BAND.h, 0.06)
  const wings = [
    [SCI_TOWERS[0][1], SCI_TOWERS[1][0]],
    [SCI_TOWERS[2][1], SCI_TOWERS[3][0]]
  ]
  for (const [x0, x1] of wings) {
    const xm = (x0 + x1) / 2
    const xs = [xm - 5.6, xm, xm + 5.6]
    frontWindows(win, xs, FLOOR_ROWS.map(Y), 3.2, 3.4, 0.06)
    frontWindows(win, xs, [Y(BAND.y)], 3.2, BAND.h, 0.06)
  }
  const ends = [
    [SCI_BODY[0][0], SCI_TOWERS[0][0]],
    [SCI_TOWERS[3][1], SCI_BODY[7][0]]
  ]
  const endRows = [...FLOOR_ROWS, 24.8].map(Y)
  for (const [x0, x1] of ends) {
    const xm = (x0 + x1) / 2
    frontWindows(win, [xm - 2.3, xm + 2.3], endRows, 2.6, 3.0, 0.06)
  }
  const endZs = spread(-3.5, -19, 4)
  sideWindows(win, endZs, endRows, 2.6, 3.0, SCI_BODY[0][0] - 0.06, -1)
  sideWindows(win, endZs, endRows, 2.6, 3.0, SCI_BODY[7][0] + 0.06, 1)
  const rearZs = spread(-26, -98, 13)
  sideWindows(win, rearZs, endRows, 2.8, 3.0, SCI_BODY[2][0] - 0.06, -1)
  sideWindows(win, rearZs, endRows, 2.8, 3.0, SCI_BODY[5][0] + 0.06, 1)
  b.add(fromTriangles(win), C.sciWindow, f)

  // 赭红线脚（c15、c21）：柱廊横梁、两翼腰线（同高）、前楼与主体顶上的檐口
  const red = (w, h, d, x, y, z) =>
    b.add(box(w, h, d), C.sciRed, local(f, x, y, z))
  red(tx1 - tx0, BEAM.h, 0.6, (tx0 + tx1) / 2, Y(BEAM.y), 0.3)
  for (const [x0, x1] of wings)
    red(x1 - x0, 1.4, 0.5, (x0 + x1) / 2, Y(24.4), 0.25)
  const ch = CORNICE_H
  // 前楼南沿（两外塔外侧之间；外端退后的一小段不挑）与东西两端
  const [fx0, fx1] = [SCI_TOWERS[0][0], SCI_TOWERS[3][1]]
  red(fx1 - fx0, ch, 0.6, (fx0 + fx1) / 2, Y(SCI_H.front - ch), 0.3)
  red(0.6, ch, 17.3, SCI_FRONT[0][0] - 0.3, Y(SCI_H.front - ch), -13.85)
  red(0.6, ch, 17.3, SCI_FRONT[19][0] + 0.3, Y(SCI_H.front - ch), -13.85)
  // 主体：两端低翼南沿与外侧墙、后部东西墙、北墙
  const yb = Y(SCI_H.body - ch)
  for (const [x0, x1] of ends) red(x1 - x0, ch, 0.6, (x0 + x1) / 2, yb, 0.3)
  red(0.6, ch, 22.5, SCI_BODY[0][0] - 0.3, yb, -11.25)
  red(0.6, ch, 22.5, SCI_BODY[7][0] + 0.3, yb, -11.25)
  const [rz0, rz1] = [SCI_BODY[2][1], SCI_BODY[3][1]]
  red(0.6, ch, rz0 - rz1, SCI_BODY[2][0] - 0.3, yb, (rz0 + rz1) / 2)
  red(0.6, ch, rz0 - rz1, SCI_BODY[5][0] + 0.3, yb, (rz0 + rz1) / 2)
  const [bx0, bx1] = [SCI_BODY[3][0], SCI_BODY[4][0]]
  red(bx1 - bx0 + 1.2, ch, 0.6, (bx0 + bx1) / 2, yb, rz1 - 0.3)

  buildSign(b, f)
}

/* ---------------- 入口 ---------------- */

/**
 * 建毛主席像组团、两者之间的广场与四川科技馆（顺序：像 → 广场 → 科技馆）。
 * @param {ColorBuilder} b 静态件
 * @param {object} site 场地对象（site.js 的 createSite），用到 site.project
 * @returns {{ zones: Array, walkways: Array }} 替换区（像组团、广场、科技馆）与科技馆前轴线路径（世界坐标）
 */
export function buildNorth(b, site) {
  const { project } = site
  const [sx, sz] = project.toLocal(STATUE.lon, STATUE.lat)
  const fs = frame(sx, 0, sz, STATUE.bearing)
  const [mx, mz] = project.toLocal(SCIENCE.lon, SCIENCE.lat)
  const fm = frame(mx, 0, mz, SCIENCE.bearing)

  buildStatue(b, fs)
  buildPlaza(b, fs)
  buildScience(b, fm)

  const zones = [
    worldPts(fs, CLUSTER_ZONE),
    worldPts(fs, PLAZA_ZONE),
    worldPts(fm, SCI_ZONE)
  ]
  const walkways = [
    {
      // 科技馆前南北轴线：走在广场铺装顶面 NORTH_Y 上
      points: worldPts(fs, [
        [AXIS.x, AXIS.z0],
        [AXIS.x, AXIS.z1]
      ]),
      y: NORTH_Y,
      width: AXIS.width,
      closed: false,
      density: AXIS.density
    }
  ]
  return { zones, walkways }
}

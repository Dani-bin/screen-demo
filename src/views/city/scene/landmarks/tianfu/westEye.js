/*
 * 天府广场 · 西鱼眼「长江龙」
 * ----------------------------------------------------------
 * 依据：设计文档第 3 节「西鱼眼」；调研报告 3.2（影像量测）、4.2（新浪 2007-07-30：高 10.8 m、龙长 58 m；
 * 景观中国 31583：托盘直径 18 m；新浪 2007-01-09：浅绿色圆盘）、6.3（构件尺寸）、6.9（颜色）；
 * 照片 c29（近景：托盘、白杆、扁平金龙带、内外两圈绿色大理石池壁）、c17（从西往东看的全貌）、c16；
 * 影像 e_weye、g21_weye（深色石盘、池外沿、托盘俯视）。
 * 中心在设计系 (−44.9, −0.75)（报告 3.2）。深色盘整块落在浅色阳鱼里：盘缘离西小圆圆心 (−37.35, 0)
 * 最远 34.6 m，S 线地灯带内沿在 37.1 m，不相碰。
 * 全部在「鱼眼坐标系」里写：设计系平移到鱼眼中心，x 沿 u（东）、z 沿 v（南），y 仍从地面算，
 * 高度一律写成 PAVE + 离铺装的高度。
 *
 * 构成（半径、高度单位米，高度从铺装顶面 PAVE 算）：
 * - 深色石盘：半径 27，与铺装齐平（报告 3.2「与路面齐平」），石材同阴鱼。铺装在这里由 ground.js 按
 *   WEST_EYE_CUT 挖口，盘面用同一组顶点铺回去，两边共边、不共面，不闪烁；
 * - 外池壁：浅灰绿大理石，外半径 18.9、厚 0.6、高 0.6；外环水面高 0.35；
 * - 内池壁：深绿大理石，外半径 9.8、厚 0.5、高 1.0；内池水面高 0.8（柱子立在内池里，c29）；
 * - 柱身：深青铜色，直径 1.7，从内池水面到托盘底，上中下三道金箍（顶上一道是 c29 里柱头的金色回纹带）；
 * - 托盘：直径 18，盘面 5.6，浅色包边，底面是倒锥面：外缘一圈金色回纹带、近柱处一圈金色云纹带（c29）；
 * - 白杆：5.6～9.6；
 * - 金龙：宽 1.8 的扁带从内池水面起，在托盘下绕柱身约 3/4 圈，绕出托盘外缘，再向内绕到白杆顶，
 *   全程约 1.15 圈，龙首顶端 10.8。
 * 池内约 3 圈螺旋暗纹不做（计划 Task 4：省预算）。
 *
 * 与报告 6.3 不同的两处（按照片 c29、c17 量取；两张照片里托盘与柱子、龙首在同一深度，可直接比像素）：
 * - 柱径：报告写 3.2；c29 柱宽 81 px、托盘宽 907 px，c17 为 80 / 860 px，按托盘 18 m 折算柱径 1.6～1.7 m，取 1.7。
 *   3.2 m 的柱子在 18 m 的托盘下显得粗笨，与照片不符；
 * - 托盘底：报告写盘底 4.6；c29 以龙首顶 10.8 m 定比例（50 px/m），托盘底面与柱子相接处比盘沿低约 1.7 m，
 *   c17 约 1.6 m，所以底面做成倒锥：外缘 5.3、到柱子处 4.0。盘面 5.6、白杆顶 9.6 与照片吻合。
 *
 * 金龙路径（c17 从西往东拍，左北右南，方向可定）：龙尾在西南侧低处入水，贴着柱子外侧经西、北、东绕行、
 * 在托盘下逐渐升高，于东南—南侧从盘沿外绕上盘面，再向内收到白杆顶、龙首停在西侧朝北。俯视顺时针上升
 * （c29 同样如此：近端飘带都往左走）。龙带用 kit 的 sweepBar 扫出：截面竖直（宽 1.8 在竖直方向，
 * 厚 0.3 在径向），照片里飘带在托盘下、盘沿外都是宽面朝外，平视、斜俯视都看得到宽面。
 *
 * 三角形（实测）：深色盘 96、池壁与水面 704、柱与金箍 128、托盘 520、白杆 36、龙带 376、龙首 72，
 * 共 1,932；另 ground.js 挖口多出 50，本件合计 1,982（设计第 5 节上限 3,200）。
 */
import { BufferAttribute, BufferGeometry, Matrix4, RingGeometry } from "three"
import { local } from "../kit/builder.js"
import { circlePolygon } from "../kit/footprint.js"
import { box, cylinder, fromTriangles, sweepBar } from "../kit/shapes.js"
import { C, PAVE, pushUp, ringPoints, triangulate } from "./site.js"

const DEG = Math.PI / 180

/* ---------------- 尺寸 ---------------- */

/** 西鱼眼中心（设计系，报告 3.2：Esri 拟合残差 0.11 m） */
export const WEST_EYE = { u: -44.9, v: -0.75 }
// 深色石盘、外池壁、外环水面的圆周分段：48 段（7.5° 一段，半径 27 时弦长 3.5 m）
const SEG = 48
// 深色石盘半径（报告 3.2）
const DISC_R = 27
/**
 * 铺装挖口：深色石盘的 48 边形（设计系）。index.js 把它交给 buildGround 的 cuts，
 * 盘面也用这同一组顶点铺，挖口与盘缘逐点重合，没有缝
 */
export const WEST_EYE_CUT = circlePolygon(WEST_EYE.u, WEST_EYE.v, DISC_R, SEG)
// 外池壁：外半径 18.9（报告 3.2 残差 0.09 m）、厚 0.6、高 0.6；外环水面高 0.35（报告 6.3）
const OUTER = { r: 18.9, t: 0.6, h: 0.6 }
const WATER_OUT = 0.35
// 内池壁：外半径 9.8、厚 0.5、高 1.0（报告 6.3）；内池水面 0.8。40 段（9° 一段）
const INNER = { r: 9.8, t: 0.5, h: 1.0, seg: 40 }
const WATER_IN = 0.8
// 池壁、水面相接处互相插进 5 cm，避免俯视时露出缝
const TUCK = 0.05
// 柱身：直径 1.7（见文件头），16 段；金箍比柱身粗 5 cm
const COLUMN = { r: 0.85, seg: 16 }
const HOOP_R = COLUMN.r + 0.05
// 三道金箍 [底, 顶]（离铺装）：水面处一道、中段一道细箍、柱头一道 0.7 m 高的回纹带（c29）
const HOOPS = [
  [WATER_IN - 0.05, 1.1],
  [2.2, 2.4],
  [3.3, 4.05]
]
// 托盘剖面 [半径, 离铺装高度]：从盘面中心向外、沿盘沿下折、再沿底面倒锥回到柱子（末点收进柱身 5 cm），
// 每段配一个颜色。托盘直径 18、盘面 5.6（报告 6.3）；底面高度按照片（见文件头）
const TRAY_TOP = 5.6
const TRAY = [
  { p: [0, TRAY_TOP], color: C.tray }, // 盘面
  { p: [9, TRAY_TOP], color: C.trayRim }, // 盘沿浅色包边，高 0.3
  { p: [9, 5.3], color: C.tray }, // 包边下一圈青绿
  { p: [8.4, 5.2], color: C.goldPattern }, // 外缘金色回纹带
  { p: [7.6, 5.05], color: C.tray }, // 底面
  { p: [4.4, 4.5], color: C.goldPattern }, // 近柱金色云纹带
  { p: [2.0, 4.1], color: C.tray }, // 柱边一圈底面
  { p: [COLUMN.r - 0.05, 4.0] }
]
// 托盘圆周分段：40 段（盘沿弦长 1.4 m，平滑法线下看不出折面，只在轮廓上略有棱角）
const TRAY_SEG = 40
// 白杆：盘面 5.6 到 9.6（报告 6.3），直径 0.56（c29 约 28 px），12 段带顶盖
const POLE = { r: 0.28, y1: 9.6, seg: 12 }

/*
 * 金龙飘带：截面竖直，宽 1.8（报告 6.3「宽 1.6～2.0」）、厚 0.3。
 * 中线关键点 [方位角°, 半径, 中线离铺装高度]；方位角从东（+u）起向南（+v）转，即俯视顺时针，
 * 360° 以上表示第二圈。中线高度 ± 0.9 是带子的上下沿。
 * - 135°～350°：龙尾在西南入水（下沿低于内池水面），贴柱外侧半径 7～8 m 绕行，在托盘下逐渐升高；
 *   托盘底面在半径 8 m 处高约 5.15，这一段带子上沿 ≤ 4.1；
 * - 395°～430°：半径放大到 9.9～10.1，从盘沿（半径 9）外侧升过盘面高度；
 * - 465°～545°：下沿高过盘面后向内收，到白杆旁（半径 1.6）时上沿 10.8，接龙首（报告 4.2：雕塑高 10.8）。
 * 龙带与托盘最近处约 0.5 m（盘沿外侧），全长约 59 m（报告 4.2「龙长 58 m」）。
 */
const DRAGON = {
  thick: 0.3,
  half: 0.9,
  keys: [
    [135, 7.0, 0.5],
    [180, 7.2, 0.9],
    [240, 7.5, 1.5],
    [300, 7.8, 2.3],
    [350, 8.1, 3.2],
    [395, 9.9, 4.3],
    [430, 10.1, 5.8],
    [465, 8.9, 7.3],
    [500, 5.2, 8.5],
    [525, 2.8, 9.4],
    [545, 1.6, 9.9]
  ],
  // 沿中线取点：相邻两点弦长 ≤ 0.9 m、转角 ≤ 12°
  chord: 0.9,
  maxStep: 12 * DEG
}

/*
 * 龙首：几个块体拼成，读成「金色龙首」即可（计划 Task 4）。
 * 龙首坐标系：原点在龙带末端中线，+x 沿龙带前进方向（水平），+y 向上，+z 为水平侧向。
 * 每块 [长, 高, 宽, 中心 x, y, z, 俯仰°, 偏航°]：长沿 +x；俯仰正值抬头，偏航绕竖轴转。
 * 最高处是眉骨顶，离龙带中线 0.9，即离铺装 9.9 + 0.9 = 10.8（与龙带末端上沿齐平）。
 */
const HEAD_PARTS = [
  [1.5, 1.3, 0.8, 0.55, 0.1, 0, 0, 0], // 头颅：接住龙带末端（带高 1.8、颅高 1.3）
  [1.4, 0.45, 0.6, 1.75, 0.25, 0, 6, 0], // 上颚（长吻，略上扬）
  [1.2, 0.25, 0.5, 1.5, -0.35, 0, -15, 0], // 下颚（张口）
  [0.6, 0.3, 0.95, 1.0, 0.75, 0, 0, 0], // 眉骨
  // 双角：从头顶向后上方斜掠（俯仰取负值，后端抬起），两角略向外张；后端顶面离中线 0.86
  [1.8, 0.16, 0.16, -0.35, 0.45, 0.25, -22, 12],
  [1.8, 0.16, 0.16, -0.35, 0.45, -0.25, -22, -12]
]

/* ---------------- 步行路径 ---------------- */

// 绕水池一圈：半径 22.5、宽 3（走在深色盘上，内沿 21 离外池壁 18.9 有 2.1 m，外沿 24 离盘缘 27 有 3 m；
// 盘面与铺装齐平，盘缘不算障碍）。设计第 6 节「绕西鱼眼水池环，半径 20～24」
const WALK = { r: 22.5, width: 3, density: 1.5, n: 48 }

/* ---------------- 小工具 ---------------- */

/** 水平圆环面（法线朝上）：three 的 RingGeometry 转到水平面，顶点方位角与 circlePolygon、kit cylinder 同一组 */
function ring(r0, r1, seg) {
  const g = new RingGeometry(r0, r1, seg, 1)
  g.rotateX(-Math.PI / 2)
  return g
}

/**
 * 旋转体的一段：剖面线段 p0 → p1（[半径, 高]）绕竖轴转一圈，seg 段。
 * 法线沿圆周平滑、剖面折点处不平滑：本段法向取剖面方向 (dr, dy) 逆时针转 90° 得到的 (−dy, dr)。
 * 剖面按「盘面中心 → 盘沿 → 底面 → 柱子」走，这个法向朝外（盘面朝上、盘沿朝外、底面朝下）。
 * 三角形绕向按法向校正：双面材质靠绕向判断正反面来翻法线，阴影只画背光面，绕向错了底面就不投影。
 * @returns {BufferGeometry} 带平滑法线的非索引几何体
 */
function revolveBand([r0, y0], [r1, y1], seg) {
  const l = Math.hypot(r1 - r0, y1 - y0)
  const nr = -(y1 - y0) / l
  const ny = (r1 - r0) / l
  const pos = []
  const nor = []
  const vert = (r, y, a) => [Math.cos(a) * r, y, Math.sin(a) * r]
  const norm = (a) => [Math.cos(a) * nr, ny, Math.sin(a) * nr]
  // 三个顶点 [点, 法线]：几何法线 (B − A) × (C − A) 与 A 处法线反向时交换 B、C
  const tri = (A, B, Cc) => {
    const u = [0, 1, 2].map((i) => B[0][i] - A[0][i])
    const w = [0, 1, 2].map((i) => Cc[0][i] - A[0][i])
    const cx = u[1] * w[2] - u[2] * w[1]
    const cy = u[2] * w[0] - u[0] * w[2]
    const cz = u[0] * w[1] - u[1] * w[0]
    const n = A[1]
    const list =
      cx * n[0] + cy * n[1] + cz * n[2] >= 0 ? [A, B, Cc] : [A, Cc, B]
    for (const [p, q] of list) {
      pos.push(...p)
      nor.push(...q)
    }
  }
  for (let k = 0; k < seg; k++) {
    const a = (k / seg) * Math.PI * 2
    const c = ((k + 1) / seg) * Math.PI * 2
    const A0 = [vert(r0, y0, a), norm(a)]
    const C0 = [vert(r0, y0, c), norm(c)]
    const A1 = [vert(r1, y1, a), norm(a)]
    const C1 = [vert(r1, y1, c), norm(c)]
    // 每段四边形拆两个三角形；半径为 0 的一端收成一点（盘面中心），只剩一个
    if (r0 > 0) tri(A0, A1, C0)
    if (r1 > 0) tri(C0, A1, C1)
  }
  const g = new BufferGeometry()
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3))
  return g
}

/**
 * 关键点之间的三次埃尔米特插值：各点斜率取前后两点的差商（端点取单侧），
 * 半径、高度随方位角平滑变化，转过关键点时不出折角
 * @param {number[]} xs 方位角（递增）
 * @param {number[]} ys 对应的值
 * @returns {(x: number) => number}
 */
function hermite(xs, ys) {
  const n = xs.length
  const m = xs.map((_, i) => {
    const a = Math.max(0, i - 1)
    const c = Math.min(n - 1, i + 1)
    return (ys[c] - ys[a]) / (xs[c] - xs[a])
  })
  return (x) => {
    let i = 0
    while (i < n - 2 && x > xs[i + 1]) i++
    const h = xs[i + 1] - xs[i]
    const t = (x - xs[i]) / h
    const t2 = t * t
    const t3 = t2 * t
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h * m[i + 1]
    )
  }
}

/**
 * 金龙中线（鱼眼坐标系 [x, y, z]，y 含 PAVE）：按 DRAGON.keys 插值，
 * 步长按弦长 ≤ chord、转角 ≤ maxStep 取，末点正好落在最后一个关键点上
 */
function dragonLine() {
  const ks = DRAGON.keys
  const as = ks.map((k) => k[0] * DEG)
  const rAt = hermite(
    as,
    ks.map((k) => k[1])
  )
  const yAt = hermite(
    as,
    ks.map((k) => k[2])
  )
  const at = (a) => {
    const r = rAt(a)
    return [Math.cos(a) * r, PAVE + yAt(a), Math.sin(a) * r]
  }
  const end = as[as.length - 1]
  const pts = []
  for (let a = as[0]; ; ) {
    pts.push(at(a))
    if (a >= end) break
    a = Math.min(end, a + Math.min(DRAGON.maxStep, DRAGON.chord / rAt(a)))
  }
  return pts
}

/**
 * 龙首：在龙带末端按前进方向摆几个块体。
 * @param {Matrix4} f 鱼眼坐标系
 * @param {number[][]} line 龙带中线（取末两点定前进方向）
 */
function addDragonHead(b, f, line) {
  const [px, py, pz] = line[line.length - 1]
  const [qx, , qz] = line[line.length - 2]
  // local() 的偏航把局部 +x 转到 (cos θ, 0, −sin θ)，要对准前进方向 (dx, dz) 就取 θ = atan2(−dz, dx)
  const head = local(f, px, py, pz, Math.atan2(-(pz - qz), px - qx))
  for (const [len, h, w, x, y, z, pitch, yaw] of HEAD_PARTS) {
    // 块体以 (x, y, z) 为中心：box 底在 y = 0，先下移半高；再俯仰（绕 z）、偏航（绕 y）
    const g = box(len, h, w, { bottom: true })
    g.translate(0, -h / 2, 0)
    const m = new Matrix4()
      .makeRotationY(yaw * DEG)
      .multiply(new Matrix4().makeRotationZ(pitch * DEG))
    m.setPosition(x, y, z)
    b.add(g, C.sculptGold, head.clone().multiply(m))
  }
}

/* ---------------- 入口 ---------------- */

/**
 * 建西鱼眼：深色石盘、内外池壁与水面、雕塑（柱身、托盘、白杆、金龙）。
 * 铺装上的口子由调用方把 WEST_EYE_CUT 交给 buildGround 的 cuts。
 * @param {ColorBuilder} b 静态件
 * @param {object} site 场地对象（site.js 的 createSite），用 site.design、site.toWorldPts
 * @returns {{ walkways: Array }} 绕水池一圈的步行路径（世界坐标）
 */
export function buildWestEye(b, site) {
  // 鱼眼坐标系：设计系平移到鱼眼中心
  const f = local(site.design, WEST_EYE.u, 0, WEST_EYE.v)
  const at = (y) => local(f, 0, y, 0)

  // 深色石盘：设计系里铺（外圈就是挖口的那组顶点），内圈收进外池壁 5 cm
  const disc = []
  const inner = circlePolygon(WEST_EYE.u, WEST_EYE.v, OUTER.r - TUCK, SEG)
  for (const t of triangulate(WEST_EYE_CUT, [inner])) {
    pushUp(disc, t, () => PAVE)
  }
  b.add(fromTriangles(disc), C.yin, site.design)

  // 外池壁：外侧面从铺装立起，内侧面从水面下 5 cm 起，顶面一圈
  const outIn = OUTER.r - OUTER.t
  b.add(
    cylinder(OUTER.r, OUTER.r, OUTER.h, { segments: SEG }),
    C.marbleLight,
    at(PAVE)
  )
  b.add(
    cylinder(outIn, outIn, OUTER.h - WATER_OUT + TUCK, { segments: SEG }),
    C.marbleLight,
    at(PAVE + WATER_OUT - TUCK)
  )
  b.add(ring(outIn, OUTER.r, SEG), C.marbleLight, at(PAVE + OUTER.h))
  // 外环水面：从内池壁外侧到外池壁内侧，两头各插进壁里 5 cm
  b.add(ring(INNER.r - TUCK, outIn + TUCK, SEG), C.water, at(PAVE + WATER_OUT))

  // 内池壁：外侧面从外环水面下起，内侧面从内池水面下起
  const inIn = INNER.r - INNER.t
  b.add(
    cylinder(INNER.r, INNER.r, INNER.h - WATER_OUT + TUCK, {
      segments: INNER.seg
    }),
    C.marbleDark,
    at(PAVE + WATER_OUT - TUCK)
  )
  b.add(
    cylinder(inIn, inIn, INNER.h - WATER_IN + TUCK, { segments: INNER.seg }),
    C.marbleDark,
    at(PAVE + WATER_IN - TUCK)
  )
  b.add(ring(inIn, INNER.r, INNER.seg), C.marbleDark, at(PAVE + INNER.h))
  // 内池水面：从柱身到内池壁
  b.add(
    ring(COLUMN.r - TUCK, inIn + TUCK, INNER.seg),
    C.water,
    at(PAVE + WATER_IN)
  )

  // 柱身：从内池水面下到托盘底面里（托盘在柱边高 4.0），开口圆柱（两头都看不见）
  const colTop = TRAY[TRAY.length - 1].p[1] + 0.1
  b.add(
    cylinder(COLUMN.r, COLUMN.r, colTop - WATER_IN + TUCK, {
      segments: COLUMN.seg
    }),
    C.bronze,
    at(PAVE + WATER_IN - TUCK)
  )
  for (const [y0, y1] of HOOPS) {
    b.add(
      cylinder(HOOP_R, HOOP_R, y1 - y0, { segments: COLUMN.seg }),
      C.sculptGold,
      at(PAVE + y0)
    )
  }

  // 托盘：剖面逐段旋转，每段一个颜色
  for (let i = 0; i + 1 < TRAY.length; i++) {
    const [r0, y0] = TRAY[i].p
    const [r1, y1] = TRAY[i + 1].p
    b.add(
      revolveBand([r0, PAVE + y0], [r1, PAVE + y1], TRAY_SEG),
      TRAY[i].color,
      f
    )
  }

  // 白杆：立在盘面上，带顶盖
  b.add(
    cylinder(POLE.r, POLE.r, POLE.y1 - TRAY_TOP, {
      segments: POLE.seg,
      caps: true
    }),
    C.sculptPole,
    at(PAVE + TRAY_TOP)
  )

  // 金龙：竖直截面的扁带（sweepBar 的「宽」是水平径向厚度、「高」是竖直带宽，中线上下各 0.9）+ 龙首
  const line = dragonLine()
  b.add(
    sweepBar(line, DRAGON.thick, DRAGON.half, { sink: DRAGON.half }),
    C.sculptGold,
    f
  )
  addDragonHead(b, f, line)

  return {
    walkways: [
      {
        points: site.toWorldPts(
          ringPoints(WEST_EYE.u, WEST_EYE.v, WALK.r, WALK.n)
        ),
        y: PAVE,
        width: WALK.width,
        closed: true,
        density: WALK.density
      }
    ]
  }
}

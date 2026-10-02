/*
 * 天府广场 · 鱼眼雕塑共用件（西鱼眼「长江龙」、东鱼眼「黄河龙」）
 * ----------------------------------------------------------
 * 两座鱼眼雕塑是同一套做法（调研报告 4.2：底色青铜、云龙纹贴金箔；照片 c29、c00、c09）：
 * 柱身 + 旋转体托盘 + 白杆 + 绕柱盘升的金色扁带龙，脚下一圈水池。这里放两处共用的几何函数：
 * - pushTri（与 sub / dot / cross）：按法线校正绕向写入三角形（托盘旋转体、东鱼眼坑壁共用）；
 * - addPool：圆池（池壁两侧面、壁顶、水面），西鱼眼内外两圈池、东鱼眼圆池共用；
 * - revolveBand / addRevolved：剖面绕竖轴旋转的托盘（逐段配色）；
 * - hermite / dragonLine / addDragon：金龙飘带中线插值、扁带与龙首。
 * 水面、池壁顶面这类水平圆环面用 kit/shapes.js 的 annulus（与天府熊猫塔共用）。
 * 坐标一律在「鱼眼坐标系」里：原点在鱼眼中心（y 仍从地面算），x 沿设计系 u（东）、z 沿 v（南）。
 * 方位角从东（+x）起向南（+z）转，即俯视顺时针，360° 以上表示第二圈。
 * 从 westEye.js 原样抽出（Task 5）。
 */
import { BufferAttribute, BufferGeometry, Matrix4 } from "three"
import { local } from "../kit/builder.js"
import { annulus, box, cylinder, sweepBar } from "../kit/shapes.js"
import { C } from "./site.js"

const DEG = Math.PI / 180

/** 池壁、水面相接处互相插进的深度（5 cm）：俯视时接缝处不露出缝隙 */
export const TUCK = 0.05

/*
 * 龙首：几个块体拼成，读成「金色龙首」即可（计划 Task 4）。
 * 龙首坐标系：原点在龙带末端中线，+x 沿龙带前进方向（水平），+y 向上，+z 为水平侧向。
 * 每块 [长, 高, 宽, 中心 x, y, z, 俯仰°, 偏航°]：长沿 +x；俯仰正值抬头，偏航绕竖轴转。
 * 最高处是眉骨顶，离龙带中线 0.9：龙带末端中线高 h 时，雕塑顶 = h + 0.9。
 */
export const DRAGON_HEAD = [
  [1.5, 1.3, 0.8, 0.55, 0.1, 0, 0, 0], // 头颅：接住龙带末端（带高 1.8、颅高 1.3）
  [1.4, 0.45, 0.6, 1.75, 0.25, 0, 6, 0], // 上颚（长吻，略上扬）
  [1.2, 0.25, 0.5, 1.5, -0.35, 0, -15, 0], // 下颚（张口）
  // 眉骨：中心 x 0.98，前脸比头颅前脸（x = 1.3）退进 2 cm，两块不再共面重叠（Task 5 审查）
  [0.6, 0.3, 0.95, 0.98, 0.75, 0, 0, 0],
  // 双角：从头顶向后上方斜掠（俯仰取负值，后端抬起），两角略向外张；后端顶面离中线 0.86
  [1.8, 0.16, 0.16, -0.35, 0.45, 0.25, -22, 12],
  [1.8, 0.16, 0.16, -0.35, 0.45, -0.25, -22, -12]
]
/** 龙首最高处（眉骨顶）离龙带末端中线的高度，见 DRAGON_HEAD */
export const DRAGON_HEAD_TOP = 0.9

/* ---------------- 小工具：按法线校正绕向 ---------------- */

/** 三维向量相减 a − b */
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
/** 三维向量点积 */
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
/** 三维向量叉积 a × b */
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]

/**
 * 按法线校正绕向，把一个三角形写进平铺数组 pos / nor：三个顶点各为 [点, 法线]，
 * 几何法线 (B − A) × (C − A) 与 A 处法线反向时交换 B、C。
 * 双面材质靠绕向判断正反面来翻法线，阴影只画背光面：绕向与法线不一致时，底面不投影、背面发黑
 */
export function pushTri(pos, nor, A, B, Cc) {
  const n = cross(sub(B[0], A[0]), sub(Cc[0], A[0]))
  const list = dot(n, A[1]) >= 0 ? [A, B, Cc] : [A, Cc, B]
  for (const [p, q] of list) {
    pos.push(...p)
    nor.push(...q)
  }
}

/* ---------------- 水池 ---------------- */

/**
 * 圆池：池壁外侧面、内侧面、壁顶环面、池内水面（西鱼眼内外两圈池、东鱼眼圆池共用）。
 * - 外侧面从池外地面起；池外也是水（西鱼眼内池泡在外环水里）时从池外水面下 TUCK 起；
 * - 内侧面从池内水面下 TUCK 起到壁顶，水面从 inner − TUCK 铺到壁内侧 + TUCK，两头各插进壁里。
 * 各项高度都是离基准 base 的高度，算式与 Task 4 西鱼眼的写法逐项相同，西鱼眼几何逐位不变。
 * @param {Matrix4} f 鱼眼坐标系
 * @param {{ r: number, t: number, h: number, water: number, inner: number, outside?: number,
 *   seg: number, wall: string, top?: string }} pool
 *   r 池壁外半径、t 壁厚、h 壁顶高、water 池内水面高、inner 水面内沿半径（柱身或里面一圈池壁的外半径）、
 *   outside 池外水面高（池外是地面时不传）、seg 圆周分段、wall / top 池壁侧面 / 壁顶颜色
 * @param {number} base 高度基准（西鱼眼是铺装顶面 PAVE，东鱼眼是坑底）
 */
export function addPool(b, f, pool, base) {
  const { r, t, h, water, inner, outside, seg, wall, top = wall } = pool
  const at = (y) => local(f, 0, y, 0)
  const rIn = r - t
  if (outside === undefined) {
    b.add(cylinder(r, r, h, { segments: seg }), wall, at(base))
  } else {
    b.add(
      cylinder(r, r, h - outside + TUCK, { segments: seg }),
      wall,
      at(base + outside - TUCK)
    )
  }
  b.add(
    cylinder(rIn, rIn, h - water + TUCK, { segments: seg }),
    wall,
    at(base + water - TUCK)
  )
  b.add(annulus(rIn, r, seg), top, at(base + h))
  b.add(annulus(inner - TUCK, rIn + TUCK, seg), C.water, at(base + water))
}

/* ---------------- 旋转体 ---------------- */

/**
 * 旋转体的一段：剖面线段 p0 → p1（[半径, 高]）绕竖轴转一圈，seg 段。
 * 法线沿圆周平滑、剖面折点处不平滑：本段法向取剖面方向 (dr, dy) 逆时针转 90° 得到的 (−dy, dr)。
 * 剖面按「盘面中心 → 盘沿 → 底面 → 柱子」走，这个法向朝外（盘面朝上、盘沿朝外、底面朝下）。
 * 三角形绕向按法向校正（pushTri）。
 * @returns {BufferGeometry} 带平滑法线的非索引几何体
 */
export function revolveBand([r0, y0], [r1, y1], seg) {
  const l = Math.hypot(r1 - r0, y1 - y0)
  const nr = -(y1 - y0) / l
  const ny = (r1 - r0) / l
  const pos = []
  const nor = []
  const vert = (r, y, a) => [Math.cos(a) * r, y, Math.sin(a) * r]
  const norm = (a) => [Math.cos(a) * nr, ny, Math.sin(a) * nr]
  const tri = (A, B, Cc) => pushTri(pos, nor, A, B, Cc)
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
 * 按剖面逐段旋转出一个托盘：profile 为 [{ p: [半径, 离基准高度], color }]，
 * 第 i 段（p[i] → p[i + 1]）用 profile[i].color，最后一个点只给位置。
 * @param {Matrix4} f 鱼眼坐标系
 * @param {number} base 高度基准（西鱼眼是铺装顶面 PAVE，东鱼眼是坑底）
 */
export function addRevolved(b, f, profile, seg, base) {
  for (let i = 0; i + 1 < profile.length; i++) {
    const [r0, y0] = profile[i].p
    const [r1, y1] = profile[i + 1].p
    b.add(
      revolveBand([r0, base + y0], [r1, base + y1], seg),
      profile[i].color,
      f
    )
  }
}

/* ---------------- 金龙 ---------------- */

/**
 * 关键点之间的三次埃尔米特插值：各点斜率取前后两点的差商（端点取单侧），
 * 半径、高度随方位角平滑变化，转过关键点时不出折角
 * @param {number[]} xs 方位角（递增）
 * @param {number[]} ys 对应的值
 * @returns {(x: number) => number}
 */
export function hermite(xs, ys) {
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
 * 金龙中线（鱼眼坐标系 [x, y, z]，y = base + 关键点高度）：按 dragon.keys 插值，
 * 步长按弦长 ≤ chord、转角 ≤ maxStep 取，末点正好落在最后一个关键点上
 * @param {{ keys: number[][], chord: number, maxStep: number }} dragon
 *   keys 为 [方位角°, 半径, 中线离基准高度]
 * @param {number} base 高度基准
 */
export function dragonLine(dragon, base) {
  const ks = dragon.keys
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
    return [Math.cos(a) * r, base + yAt(a), Math.sin(a) * r]
  }
  const end = as[as.length - 1]
  const pts = []
  for (let a = as[0]; ; ) {
    pts.push(at(a))
    if (a >= end) break
    a = Math.min(end, a + Math.min(dragon.maxStep, dragon.chord / rAt(a)))
  }
  return pts
}

/**
 * 龙首：在龙带末端按前进方向摆 DRAGON_HEAD 的几个块体。
 * @param {Matrix4} f 鱼眼坐标系
 * @param {number[][]} line 龙带中线（取末两点定前进方向）
 */
export function addDragonHead(b, f, line) {
  const [px, py, pz] = line[line.length - 1]
  const [qx, , qz] = line[line.length - 2]
  // local() 的偏航把局部 +x 转到 (cos θ, 0, −sin θ)，要对准前进方向 (dx, dz) 就取 θ = atan2(−dz, dx)
  const head = local(f, px, py, pz, Math.atan2(-(pz - qz), px - qx))
  for (const [len, h, w, x, y, z, pitch, yaw] of DRAGON_HEAD) {
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

/**
 * 金龙：竖直截面的扁带（kit 的 sweepBar：「宽」是水平径向厚度 thick，「高」是竖直带宽，
 * 中线上下各 half）+ 龙首。照片里飘带宽面朝外，平视、斜俯视都看得到宽面。
 * 扁带补底面：低机位近看悬空的下沿不露槽；阴影只画背光面，悬空段的底面朝下、背对太阳，照样投影。
 * @param {Matrix4} f 鱼眼坐标系
 * @param {{ keys: number[][], chord: number, maxStep: number, thick: number, half: number }} dragon
 * @param {number} base 高度基准
 * @returns {number[][]} 龙带中线
 */
export function addDragon(b, f, dragon, base) {
  const line = dragonLine(dragon, base)
  b.add(
    sweepBar(line, dragon.thick, dragon.half, {
      sink: dragon.half,
      bottom: true
    }),
    C.sculptGold,
    f
  )
  addDragonHead(b, f, line)
  return line
}

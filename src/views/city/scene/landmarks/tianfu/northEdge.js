/*
 * 天府广场 · 北缘：两条音乐喷泉池（含水柱动画件）、池北红色花带与连续绿篱、国旗台与旗杆
 * ----------------------------------------------------------
 * 依据：设计文档第 3 节「北缘」；调研报告 0（结论第 4 条）、3.2（北侧两池 |u| 24.5～101.5、v −76.5～−66；
 * 国旗台 u −4.3～5.2、v −78.5～−70.3；池北约 4 m 宽花带加一排灌木球）、4.1（照片 c19 北侧音乐喷泉，
 * 水柱约 3～5 m、成扇形喷开；old3 西北角池北那排灌木球）、4.2（景观中国 31539：两池以中轴对称、
 * 共 1500 多个喷头）、6.5（池沿 0.6 m 宽、0.6 m 高，池内每 10 m 一道隔墙，水柱 2 排、高 2.5～4.5 m；
 * 旗台粉红色约 9.5 × 8.2，旗杆约 20 m）；附录 B 的 flag_platform.pole（旗杆在 (1.0, −74.3)）；影像 e_flag、g_flag。
 * 全部在设计系 (u, v) 里写，b.add 时乘 site.design。两池以中轴对称：西池取东池的 u 区间取负
 * （只镜像点位，不用负缩放矩阵，ColorBuilder 不收镜像矩阵）。
 *
 * 构成（高度从铺装顶面 PAVE 算）：
 * - 喷泉池：池沿 0.6 宽、0.6 高（矩形环挤出，含内侧壁）；水面 0.45，高于铺装，所以铺装不必挖口
 *   （ground.js 文件头的约定：水面高于 PAVE ≥ 0.15 时不挖）。池内 7 道隔墙把每池分成 8 格
 *   （池内净长 75.8 m / 8 ≈ 9.5 m，即报告的「每 10 m 一道」），墙顶高出水面 0.1。
 * - 水柱（动画 Mesh）：每格 2 排、每排一组 5 根扇形水柱（c19）：中间一根直立 4.5 m，两侧各两根
 *   向东西斜出 16°、32°，长 3.6、3.0 m（竖高 3.46、2.54 m，都在报告 6.5 的 2.5～4.5 m 内）。每根是 6 段细圆锥（底半径 0.2、尖顶），
 *   底在 y = 0；index.js 把整个 Mesh 抬到水面 POOL_WATER，update 里只改 scale.y（同旧做法），
 *   斜水柱随之变陡变缓，读成水柱起落。2 池 × 8 格 × 2 排 × 5 根 = 160 根。
 * - 池北：红色花带 v −80.5～−76.5（4 m 宽，紧贴池北沿，高同草坪 0.15），带上一条连续绿篱
 *   （1.4 m 宽、0.9 m 高，代替 old3 里那排灌木球：报告 6.10 的精简项「灌木球改成连续绿篱」）。
 *   OSM 的两条北侧花带（w1395271423 / 24，v −78.5～−73）与影像量得的池子（v −76.5～−66）重叠，
 *   按影像把花带放在池北。花带不嵌黄色祥云：影像与 c19 里这一条是成片红花加绿篱。
 * - 国旗台：粉红色两级台。下级即报告 3.2 的范围，9.5 × 8.2 × 0.45；上级 5 × 4.2 × 0.3，以旗杆为中心。
 *   旗杆顶离铺装 20 m（无资料，估计值，报告 7），杆顶金色尖顶；红旗 3.6 × 2.4，分 4 段起伏、向东飘
 *   （材质双面，旗面单层）。
 *
 * 三角形（实测）：池沿 2 × 24、水面 2 × 2、隔墙 14 × 10，花带 2 × 10、绿篱 2 × 10，国旗台 20、旗杆 22、
 * 红旗 8，静态共 282（北缘静态上限 1,000，花带绿篱 40 计入「绿篱与花带」）；水柱 960（上限 1,200）。
 */
import { Matrix4 } from "three"
import { local } from "../kit/builder.js"
import { box, cylinder, extrudePolygon, fromTriangles } from "../kit/shapes.js"
import { LAWN_TOP, flatTris } from "./ground.js"
import { C, PAVE, rectUV, triangulate } from "./site.js"

const DEG = Math.PI / 180

/* ---------------- 尺寸 ---------------- */

/** 北侧东池（西池取 u 的负区间）：u 24.5～101.5、v −76.5～−66（报告 3.2） */
export const POOL = { u0: 24.5, u1: 101.5, v0: -76.5, v1: -66 }
// 池沿宽 0.6、高 0.6（报告 6.5）
const RIM_W = 0.6
const RIM_H = 0.6
/** 池水面高度（世界 y）：比池沿顶低 0.15（c19 里水面几乎齐沿）。index.js 把水柱 Mesh 整体抬到这里 */
export const POOL_WATER = PAVE + 0.45
// 每池 8 格（7 道隔墙）；隔墙厚 0.4，顶高出水面 0.1，下沿没进水里 0.2（墙底面被剔掉，藏在水下）
const BAYS = 8
const WALL = { t: 0.4, top: POOL_WATER + 0.1, h: 0.3 }
// 两排水柱离池中线 ±2.4 m（池内净宽 9.3 m）
const JET_ROW_OFF = 2.4
// 一组扇形水柱：[斜角（度，正值向东）, 长度, 喷头离组中心的 u 向偏移]
const FAN = [
  [0, 4.5, 0],
  [16, 3.6, 0.5],
  [-16, 3.6, -0.5],
  [32, 3.0, 1.0],
  [-32, 3.0, -1.0]
]
// 水柱圆锥：底半径 0.2、6 段（每根 6 个三角形，尖顶不出退化三角形）
const JET_R = 0.2
const JET_SEG = 6

// 池北红色花带：v −80.5～池北沿，u 与池同长
const BAND = { v0: -80.5, v1: POOL.v0 }
// 连续绿篱：压在花带北半，v −80.3～−78.9、高 0.9；两端各比花带收进 1 m
const HEDGE = { v0: -80.3, v1: -78.9, h: 0.9, inset: 1 }

/** 国旗台下级（报告 3.2）：u −4.3～5.2、v −78.5～−70.3，高 0.45 */
export const FLAG_STAGE = { u0: -4.3, u1: 5.2, v0: -78.5, v1: -70.3, h: 0.45 }
/** 旗杆位置（附录 B 的 flag_platform.pole） */
export const FLAG_POLE = { u: 1.0, v: -74.3 }
// 国旗台上级：5 × 4.2 × 0.3，以旗杆为中心
const STAGE_TOP = { w: 5, d: 4.2, h: 0.3 }
// 旗杆：杆顶离铺装 20 m（估计值）；底半径 0.16、顶 0.09，8 段；杆顶金色尖顶高 0.5
const POLE = { h: 20, r0: 0.16, r1: 0.09, seg: 8, tip: 0.5 }
// 红旗 3.6 × 2.4（3 : 2），上沿离杆顶 0.4，离杆 0.12 m 起；分 4 段，沿 v 起伏、越往外摆幅越大
const FLAG = {
  w: 3.6,
  h: 2.4,
  top: POLE.h - 0.4,
  gap: 0.12,
  segs: 4,
  wave: 0.25
}

/** 东池 / 西池的 u 区间：s = 1 为东池，s = −1 为西池（取负后两端换序，保持 u0 < u1） */
const poolSpan = (s) => (s > 0 ? [POOL.u0, POOL.u1] : [-POOL.u1, -POOL.u0])

/* ---------------- 喷泉池与水柱 ---------------- */

/** 一组扇形水柱（底在水面 y = 0）：直立的居中，斜的绕 v 轴向东西倾，喷头沿 u 稍稍错开 */
function addFan(jets, f, uc, v) {
  for (const [deg, len, du] of FAN) {
    // makeRotationZ(−θ) 把 +y 转向 +x（设计系 +u）：θ > 0 向东斜。矩阵 = 设计系 × 平移 × 倾斜
    const m = new Matrix4()
      .makeRotationZ(-deg * DEG)
      .setPosition(uc + du, 0, v)
      .premultiply(f)
    jets.add(cylinder(JET_R, 0, len, { segments: JET_SEG }), C.jet, m)
  }
}

/** 两个喷泉池：池沿、水面、隔墙（静态），每格两组扇形水柱（动画件） */
function buildPools(b, jets, f) {
  const vMid = (POOL.v0 + POOL.v1) / 2
  const innerD = POOL.v1 - POOL.v0 - 2 * RIM_W
  for (const s of [-1, 1]) {
    const [u0, u1] = poolSpan(s)
    const iu0 = u0 + RIM_W
    const iu1 = u1 - RIM_W
    const inner = rectUV(iu0, iu1, POOL.v0 + RIM_W, POOL.v1 - RIM_W)
    // 池沿：矩形环挤出（顶面 + 内外侧壁）
    b.add(
      extrudePolygon(
        rectUV(u0, u1, POOL.v0, POOL.v1),
        [inner],
        PAVE,
        PAVE + RIM_H
      ),
      C.poolRim,
      f
    )
    // 水面：边缘贴在池沿内壁 0.45 / 0.6 的高度上（池沿高 0.6、水面 0.45）
    b.add(flatTris(triangulate(inner), POOL_WATER), C.water, f)
    // 隔墙：两端顶在池沿内壁上
    const bay = (iu1 - iu0) / BAYS
    for (let k = 1; k < BAYS; k++) {
      b.add(
        box(WALL.t, WALL.h, innerD),
        C.poolWall,
        local(f, iu0 + k * bay, WALL.top - WALL.h, vMid)
      )
    }
    // 水柱：每格居中，两排
    for (let k = 0; k < BAYS; k++) {
      const uc = iu0 + (k + 0.5) * bay
      for (const dv of [-JET_ROW_OFF, JET_ROW_OFF])
        addFan(jets, f, uc, vMid + dv)
    }
  }
}

/* ---------------- 池北花带与绿篱 ---------------- */

function buildBandAndHedge(b, f) {
  for (const s of [-1, 1]) {
    const [u0, u1] = poolSpan(s)
    // 红色花带：竖直挤出（顶面 + 侧墙），与草坪花带同高同色
    b.add(
      extrudePolygon(rectUV(u0, u1, BAND.v0, BAND.v1), [], PAVE, LAWN_TOP),
      C.flowerRed,
      f
    )
    // 连续绿篱：一条长方体，立在花带顶面上
    b.add(
      box(u1 - u0 - 2 * HEDGE.inset, HEDGE.h, HEDGE.v1 - HEDGE.v0),
      C.hedge,
      local(f, (u0 + u1) / 2, LAWN_TOP, (HEDGE.v0 + HEDGE.v1) / 2)
    )
  }
}

/* ---------------- 国旗台、旗杆与红旗 ---------------- */

function buildFlag(b, f) {
  const S = FLAG_STAGE
  const { u, v } = FLAG_POLE
  // 两级台：下级照报告范围，上级以旗杆为中心
  b.add(
    box(S.u1 - S.u0, S.h, S.v1 - S.v0),
    C.flagStage,
    local(f, (S.u0 + S.u1) / 2, PAVE, (S.v0 + S.v1) / 2)
  )
  b.add(
    box(STAGE_TOP.w, STAGE_TOP.h, STAGE_TOP.d),
    C.flagStage,
    local(f, u, PAVE + S.h, v)
  )
  // 旗杆：从上级台面立到 PAVE + 20，杆顶接金色尖顶
  const base = PAVE + S.h + STAGE_TOP.h
  b.add(
    cylinder(POLE.r0, POLE.r1, PAVE + POLE.h - base, { segments: POLE.seg }),
    C.flagPole,
    local(f, u, base, v)
  )
  b.add(
    cylinder(POLE.r1 + 0.05, 0, POLE.tip, { segments: 6 }),
    C.sculptGold,
    local(f, u, PAVE + POLE.h, v)
  )
  // 红旗：沿 +u 飘出的竖直条带，每段一个四边形（两个三角形），各段外沿沿 v 摆动
  const y1 = PAVE + FLAG.top
  const y0 = y1 - FLAG.h
  const pts = Array.from({ length: FLAG.segs + 1 }, (_, i) => {
    const t = i / FLAG.segs
    return [
      u + FLAG.gap + t * FLAG.w,
      v + FLAG.wave * t * Math.sin(t * Math.PI * 1.5)
    ]
  })
  const pos = []
  for (let i = 0; i < FLAG.segs; i++) {
    const [ua, va] = pts[i]
    const [ub, vb] = pts[i + 1]
    pos.push(ua, y0, va, ub, y0, vb, ub, y1, vb)
    pos.push(ua, y0, va, ub, y1, vb, ua, y1, va)
  }
  b.add(fromTriangles(pos), C.flagRed, f)
}

/* ---------------- 入口 ---------------- */

/**
 * 北缘：两个喷泉池（水柱进 jets）、池北花带与绿篱、国旗台。
 * @param {ColorBuilder} b 静态件
 * @param {ColorBuilder} jets 喷泉水柱（index.js 单独建成动画 Mesh，抬到 POOL_WATER）
 * @param {object} site 场地对象（site.js 的 createSite），用 site.design
 */
export function buildNorthEdge(b, jets, site) {
  const f = site.design
  buildPools(b, jets, f)
  buildBandAndHedge(b, f)
  buildFlag(b, f)
}

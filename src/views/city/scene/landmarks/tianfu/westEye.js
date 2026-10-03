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
 * - 金龙：宽 1.8 的扁带从内池水面下起，在托盘下绕柱身约 3/4 圈，绕出托盘外缘，再向内绕到白杆顶，
 *   全程约 1.15 圈，龙首顶端 10.8。
 * 池内约 3 圈螺旋暗纹不做（计划 Task 4：省预算）。
 *
 * 与报告 6.3 不同的两处（按照片 c29、c17 量取；两张照片里托盘与柱子、龙首在同一深度，可直接比像素）：
 * - 柱径：报告写 3.2；c29 柱宽 81 px、托盘宽 907 px，c17 为 80 / 860 px，按托盘 18 m 折算柱径 1.6～1.7 m，取 1.7。
 *   3.2 m 的柱子在 18 m 的托盘下显得粗笨，与照片不符；
 * - 托盘底：报告写盘底 4.6；c29 以龙首顶 10.8 m 定比例（50 px/m），托盘底面与柱子相接处比盘沿低约 1.7 m，
 *   c17 约 1.6 m，所以底面做成倒锥：外缘 5.3、到柱子处 4.0。盘面 5.6、白杆顶 9.6 与照片吻合。
 *
 * 金龙路径（c17 从西往东拍，左北右南，方向可定）：龙尾在西南侧没入内池水下，在托盘下、半径 7～8 m 处
 * 绕柱经西、北、东绕行、逐渐升高，于东南—南侧从盘沿外绕上盘面，再向内收到白杆顶、龙首停在西侧朝北。俯视顺时针上升
 * （c29 同样如此：近端飘带都往左走）。龙带用 kit 的 sweepBar 扫出：截面竖直（宽 1.8 在竖直方向，
 * 厚 0.3 在径向），照片里飘带在托盘下、盘沿外都是宽面朝外，平视、斜俯视都看得到宽面；
 * 带底面（低机位近看托盘下的龙带不露槽，悬空段也照常画进阴影贴图）。
 * 托盘旋转体、金龙扁带与龙首的做法与东鱼眼共用，放在 sculpture.js（Task 5 抽出）。
 *
 * 三角形（实测）：深色盘 96、池壁与水面 704、柱与金箍 128、托盘 520、白杆 36、龙带 500（含底面 124）、
 * 龙首 72，共 2,056；另 ground.js 挖口多出 50，本件合计 2,106（设计第 5 节上限 3,200）。
 */
import { local } from "../kit/builder.js"
import { circlePolygon } from "../kit/footprint.js"
import { cylinder, fromTriangles } from "../kit/shapes.js"
import { C } from "./colors.js"
import { PAVE } from "./site.js"
import { pushUp, triangulate } from "./surface.js"
import { TUCK, addDragon, addPool, addRevolved } from "./sculpture.js"

const DEG = Math.PI / 180

/* ---------------- 尺寸 ---------------- */

/** 西鱼眼中心（设计系，报告 3.2：Esri 拟合残差 0.11 m） */
const WEST_EYE = { u: -44.9, v: -0.75 }
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
// 池壁、水面相接处互相插进 5 cm（sculpture.js 的 TUCK），避免俯视时露出缝
// 柱身：直径 1.7（见文件头），16 段；金箍比柱身粗 5 cm
const COLUMN = { r: 0.85, seg: 16 }
const HOOP_R = COLUMN.r + 0.05
// 三道金箍 [底, 顶]（离铺装）：水面处一道、中段一道细箍、柱头一道 0.75 m 高的回纹带（c29）
const HOOPS = [
  [WATER_IN - 0.05, 1.1],
  [2.2, 2.4],
  [3.3, 4.05]
]
// 托盘剖面 [半径, 离铺装高度]：从盘面中心向外、沿盘沿下折、再沿底面倒锥回到柱子（末点收进柱身 5 cm），
// 每段配一个颜色。托盘直径 18、盘面 5.6（报告 6.3）；包边高度、金纹带位置与底面高度在 c29 里量取
// （50 px/m，见文件头）
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
 * - 135°～350°：龙尾在西南从内池水下起（起点中线 −0.2，上沿 0.7 低于水面 0.8，端头封口整块在水下），
 *   在托盘下、半径 7～8 m 处绕柱逐渐升高；托盘底面在半径 8 m 处高约 5.15，这一段带子上沿 ≤ 4.1；
 * - 395°～430°：半径放大到 9.9～10.1，从盘沿（半径 9）外侧升过盘面高度；
 * - 465°～545°：下沿高过盘面后向内收，到白杆旁（半径 1.6）时上沿 10.8，接龙首（报告 4.2：雕塑高 10.8）。
 * 龙带与托盘最近处约 0.5 m，在盘沿上方（约半径 9.3、离铺装 6.0 处），全长约 59 m（报告 4.2「龙长 58 m」）。
 */
const DRAGON = {
  thick: 0.3,
  half: 0.9,
  keys: [
    [135, 7.0, -0.2],
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

// 龙首：sculpture.js 的 DRAGON_HEAD（东鱼眼共用），眉骨顶离龙带末端中线 0.9（DRAGON_HEAD_TOP），
// 即离铺装 9.9 + 0.9 = 10.8（与龙带末端上沿齐平）

/* ---------------- 步行路径 ---------------- */

// 绕水池一圈：半径 22.5、宽 3（走在深色盘上，内沿 21 离外池壁 18.9 有 2.1 m，外沿 24 离盘缘 27 有 3 m；
// 盘面与铺装齐平，盘缘不算障碍）。设计第 6 节「绕西鱼眼水池环，半径 20～24」
const WALK = { r: 22.5, width: 3, density: 1.5, n: 48 }

/* ---------------- 各部分 ---------------- */

/**
 * 深色石盘与内外两圈池子：石盘、外池壁、外环水面、内池壁、内池水面
 * @param {Matrix4} f 鱼眼坐标系
 */
function buildDiscAndPools(b, site, f) {
  // 深色石盘：设计系里铺（外圈就是挖口的那组顶点），内圈收进外池壁 5 cm
  const disc = []
  const inner = circlePolygon(WEST_EYE.u, WEST_EYE.v, OUTER.r - TUCK, SEG)
  for (const t of triangulate(WEST_EYE_CUT, [inner])) {
    pushUp(disc, t, () => PAVE)
  }
  b.add(fromTriangles(disc), C.yin, site.design)

  // 外环池：外池壁外侧面从铺装立起，内侧面从外环水面下 5 cm 起，壁顶一圈；
  // 外环水面从内池壁外侧铺到外池壁内侧，两头各插进壁里 5 cm
  addPool(
    b,
    f,
    {
      r: OUTER.r,
      t: OUTER.t,
      h: OUTER.h,
      water: WATER_OUT,
      inner: INNER.r,
      seg: SEG,
      wall: C.marbleLight
    },
    PAVE
  )
  // 内池：泡在外环水里，内池壁外侧面从外环水面下起；内池水面从柱身铺到内池壁
  addPool(
    b,
    f,
    {
      r: INNER.r,
      t: INNER.t,
      h: INNER.h,
      water: WATER_IN,
      inner: COLUMN.r,
      outside: WATER_OUT,
      seg: INNER.seg,
      wall: C.marbleDark
    },
    PAVE
  )
}

/**
 * 雕塑本体：柱身与三道金箍、托盘、白杆（金龙另由 sculpture.js 的 addDragon 建）
 * @param {Matrix4} f 鱼眼坐标系
 */
function buildSculpture(b, f) {
  const at = (y) => local(f, 0, y, 0)

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
  addRevolved(b, f, TRAY, TRAY_SEG, PAVE)

  // 白杆：立在盘面上，带顶盖
  b.add(
    cylinder(POLE.r, POLE.r, POLE.y1 - TRAY_TOP, {
      segments: POLE.seg,
      caps: true
    }),
    C.sculptPole,
    at(PAVE + TRAY_TOP)
  )
}

/* ---------------- 入口 ---------------- */

/**
 * 建西鱼眼：深色石盘与池子 → 雕塑本体（柱身、托盘、白杆）→ 金龙。
 * 调用顺序决定合批后的顶点顺序，不要随意调换。
 * 铺装上的口子由调用方把 WEST_EYE_CUT 交给 buildGround 的 cuts。
 * @param {ColorBuilder} b 静态件
 * @param {object} site 场地对象（site.js 的 createSite），用 site.design、site.toWorldPts
 * @returns {{ walkways: Array }} 绕水池一圈的步行路径（世界坐标）
 */
export function buildWestEye(b, site) {
  // 鱼眼坐标系：设计系平移到鱼眼中心
  const f = local(site.design, WEST_EYE.u, 0, WEST_EYE.v)
  buildDiscAndPools(b, site, f)
  buildSculpture(b, f)
  // 金龙：竖直截面的扁带（中线上下各 0.9，带底面）+ 龙首，做法见 sculpture.js 的 addDragon
  addDragon(b, f, DRAGON, PAVE)

  return {
    walkways: [
      {
        points: site.toWorldPts(
          circlePolygon(WEST_EYE.u, WEST_EYE.v, WALK.r, WALK.n)
        ),
        y: PAVE,
        width: WALK.width,
        closed: true,
        density: WALK.density
      }
    ]
  }
}

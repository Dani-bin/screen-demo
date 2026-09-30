/*
 * 合江亭 · 安顺廊桥
 * ----------------------------------------------------------
 * 府河与南河在此交汇为锦江。本景点包含三部分：
 *   1. 合江亭：两座六角重檐攒尖亭连体（共用中间两根柱，共 10 柱），
 *      金黄琉璃瓦、红柱，坐在 3.5 m 高的花岗岩台基上，汉白玉栏杆、两道台阶；
 *   2. 安顺廊桥（按用户提供的黄昏正侧面、夜景斜侧照片细化）：全长 81、桥体宽 14，
 *      浅灰白石桥体，三孔大石拱、拱间桥墩各开一个圆形泄洪孔，拱腹与孔壁为暖琥珀色
 *      （照片里拱洞内的橙色灯光，插画化为固有色）；桥面中段高、两端各低一级（斜坡相接）；
 *      圆孔下桥墩前后各立一只石雕镇水兽（共 4 只）。桥上木廊一律橙金琉璃瓦、金色屋脊，
 *      红柱红额枋（金线）之间是米白花格窗：中部主楼两层、重檐歇山顶（最宽最高），
 *      二层外一圈白石栏杆；两端楼阁坐在下层桥面上，底层腰檐围出平台，台上一座方亭、
 *      陡峭的四角攒尖顶加宝顶；其间两段单层长廊，比楼阁低一截；
 *   3. 锦江上一艘游船（红船身、黄顶棚），沿河中心线来回缓慢漂移（单独 Mesh、不投影）。
 * 另在亭子与桥头的陆地上补几棵低多边形树。
 * 返回 walkways（步行路径，人群系统到站时生成行人）：亭子一侧的南河北岸步道、
 * 廊桥两段长廊外的桥面边道、合江亭台基上绕双亭的一圈环路。游船在河面上动，路径一律不下水。
 *
 * 定位：OSM 数据里合江亭没有名称、安顺廊桥不在建筑数据中（桥不是 building），
 * 先按名称查楼，查不到时按设计坐标与朝向放置（见 PAVILION / BRIDGE 常量）。
 *
 * 插画式放大：合江亭真实体量（台基 22 × 14、亭高约 15 m）在能与廊桥同框的镜头里
 * 只有约 100 像素宽，认不出连体双亭。因此亭子一组（台基、栏杆、台阶、花坛、双亭）
 * 整体按 PAV_SCALE = 1.6 倍同比放大，与纪念碑 1.6 倍、千佛塔 1.4 倍、熊猫 20 m 一致；
 * 下面的尺寸常量都写真实尺寸，放大只在坐标系上做一次。廊桥、游船、邻楼不放大。
 * 放大后的台基若仍以 OSM 亭心为中心，两个前角会伸进两江约 12 m，
 * 故整组向陆地（西北）平移 PAV_SHIFT，前角入水不超过约 4 m（与放大前相当，视作驳岸）。
 */
import {
  BufferAttribute,
  BufferGeometry,
  ExtrudeGeometry,
  Mesh,
  Path,
  Shape,
  Vector3
} from "three"
import { THEME } from "../theme.js"
import { GROUND_Y } from "../terrain.js"
import { ColorBuilder, frame, landmarkMaterial, local } from "./kit/builder.js"
import {
  centroid,
  findBuilding,
  minAreaRect,
  rectPolygon
} from "./kit/footprint.js"
import { box, sphere, sweepBar } from "./kit/shapes.js"
import {
  finial,
  hipRidges,
  hipRoof,
  pyramidRidges,
  pyramidRoof,
  roofHeight
} from "./kit/roofs.js"
import {
  addBalustrade,
  addColumns,
  addPavilion,
  addPlatform,
  clamp,
  eaveDrop
} from "./kit/parts.js"
import { addBoat, addTree } from "./kit/figures.js"
import { roundedLoop } from "./kit/walkways.js"

const L = THEME.landmark

/* ---------------- 定位常量 ---------------- */

// 合江亭：OSM 亭子轮廓（无名称）中心与长轴方位（约 14 × 8 m，长轴约 70°）
const PAVILION = { name: "合江亭", lon: 104.08119, lat: 30.64533, bearing: 70 }
// 安顺廊桥：OSM 桥轮廓中心；长轴 19°（与此段锦江河道垂直）。
// OSM 桥心比数据里的河面中线偏北约 10 m：桥体整体沿长轴南移 10 m，两端才都落在岸上
const BRIDGE = {
  name: "安顺廊桥",
  lon: 104.0834,
  lat: 30.64425,
  bearing: 19,
  shift: -10
}
// 锦江中心线上两点（OSM rivers：两江交汇点 → 廊桥下游），游船沿此方向漂移
const RIVER = [
  [104.08159, 30.64484],
  [104.08469, 30.64388]
]
// 游船：漂移中心离交汇点的距离、振幅、周期（秒）
const BOAT = { from: 95, amp: 60, period: 60, length: 14 }
const RIVER_Y = 0.35 // 河面高度（roads.js 的河流水面）

/* ---------------- 合江亭尺寸 ---------------- */

const TERRACE = { w: 22, d: 14, h: 3.5 } // 花岗岩台基（局部 X 沿长轴）
const PAV_R = 4.1 // 单亭外接半径：连体总长 4·r·cos30° ≈ 14.2、宽 2r = 8.2
// 插画式放大，真实尺寸见常量（原因见文件头）
const PAV_SCALE = 1.6
// 放大后整组在亭子坐标系里的平移（米）：沿长轴 −2、向陆地（-Z，西北）14。
// Node 按水面多边形与河道带宽核对过：台基前角入水约 3.95 m（放大前为 3.9 m）
const PAV_SHIFT = [-2, -14]

/* ---------------- 安顺廊桥尺寸 ---------------- */

// 桥面分两级（照片：中段桥面高，两端楼阁所在的桥面低一级，栏杆斜着跌落）：
// 中段上层桥面 DECK_H，|x| ≥ STEP[1] 的两端为下层桥面 DECK_LOW，STEP 区间内斜坡相接。
// 下层桥面与改版前的桥面同高，引坡不变；中段抬高是为了放下更大的石拱——
// 照片里石桥体与桥上木廊差不多一样高，原来 8.5 m 的桥体被 15 m 高的木廊压成一条薄边
const DECK_H = 10.4
const DECK_LOW = 8.5
const STEP = [29.2, 31.2]
const BRIDGE_LEN = 81
const BRIDGE_D = 14 // 桥体宽
// 三孔石拱：x 为拱心沿桥位置，R 为半径，c 为圆心高度（在地面以下，拱为略扁的弧券）。
// 按照片比例：中孔跨 23.1、矢高 8.8，边孔跨 18.5、矢高 7.0，桥墩只剩约 4 m，
// 边孔外侧起拱点 ±34（此处河面宽约 ±38，桥头实体段仍立在水里、贴着驳岸）
const ARCHES = [
  { x: -24.8, R: 9.6, c: -2.6 },
  { x: 0, R: 12, c: -3.2 },
  { x: 24.8, R: 9.6, c: -2.6 }
]
// 拱间桥墩上的圆形泄洪孔：在两券之间的三角墙里，券石外缘与拱券石外缘相距约 0.15 m
const HOLES = [
  { x: -13.57, y: 5.2, r: 2.5 },
  { x: 13.57, y: 5.2, r: 2.5 }
]
const ARCH_RING = 0.75 // 拱券石宽（半径方向）
const RAMP = { len: 16, w: 11, footH: 0.8 } // 桥头引坡（从下层桥面起坡）
const COPING = 0.5 // 桥面压面石厚度：石桥体只挤出到桥面 − COPING，桥面顶面归压面石

// 廊桥配色（照片：浅灰白石桥体、拱洞内暖橙灯光、橙金琉璃瓦、红柱米白花格窗、白石栏杆）。
// 红柱、金色屋脊、白石栏杆沿用 THEME.landmark 的 column / glaze / marble，下面是新增色
const BR = {
  stone: "#D8D4CA", // 桥体与引坡的浅灰白石（比合江亭台基的花岗岩浅一档）
  glow: "#F6AA50", // 拱腹、圆孔内壁：暖琥珀色，插画化的「亮灯」效果（普通漫反射材质）
  tile: "#E2A03E", // 橙金琉璃瓦：照片黄昏偏橙铜、夜里金黄，取两者之间
  ridge: L.glaze, // 屋脊、翼角、宝顶：比瓦面更亮的金黄
  screen: "#F2EAD7", // 米白花格窗底色
  mullion: L.lattice, // 花格窗棂、裙板：深红
  beast: "#9A9486" // 石雕镇水兽、券顶兽面：比桥体深的旧石色
}

/* ---------------- 步行路径（人群用，见 crowd.js） ---------------- */

// 台基环路：亭子组坐标系 fs 的局部坐标（真实尺寸，放大在坐标系上）里的圆角矩形，
// 夹在双亭台座与台基栏杆（放大后高 1.6 m）之间。六角台座的尖角正对长边，
// 尖角处净宽只剩约 1 m，故可走宽度取 0.5 m（世界米）：身体高度上离栏杆顶 ≥ 0.86 m
// （身体半径，4 m 身高）；路面 = 台基顶（TERRACE.h × PAV_SCALE）
const TERRACE_WALK = { x: 9.3, z: 5.78, r: 1.2, width: 0.5, density: 3.5 }
// 廊桥桥面：木廊芯体是实心的，只能走柱列与桥面石栏之间的边道（上层桥面）。
// 两段单层长廊柱线 z = ±3.5、檐口只伸到 z = ±4.65（檐下沿离桥面约 4.26 m，
// 比小人头顶 4.35 m 低，故檐口须离边道内沿 ≥ 头部半径 0.48 m）；中部主楼端柱在 x = ±9，
// 其腰檐伸到 x = ±10.5，但在边道上方离桥面 ≥ 4.99 m，小人从檐下走过。
// 故边道取桥坐标系 |x| ∈ [10.2, 27]、z = ±5.6，四段各自走到端点折返；
// x1 = 27 离斜坡段（STEP）还有 2 m。可走宽 0.8。Node 按三角形求交沿路径每 0.5 m
// 核对过：腿 / 身体 / 头三个高度带的最小水平净距 0.67 / 1.13 / 0.55 m
// （需 0.58 / 0.8 / 0.48），头顶净高 ≥ 4.99 m。路面 = 上层压面石顶 DECK_H
const DECK_WALK = { x0: 10.2, x1: 27, z: 5.6, width: 0.8, density: 4 }
// 河岸步道：亭子西北、南河北岸的空地（城市地面平面 GROUND_Y = −0.5），离水边约 4 m，
// 从上游一路走到台基西侧；fp 局部坐标（未放大），按水面、河道带、邻楼与通用树核对过
const RIVERSIDE = {
  points: [
    [-115, -124.3],
    [-100, -106.7],
    [-70, -71.5],
    [-45, -42],
    [-22.5, -16]
  ],
  width: 2.4,
  density: 3.5
}

// 亭西北侧那栋无名小楼的轮廓中心（OSM 顶点平均点，经纬度）
const NEIGHBOUR = { lon: 104.08076, lat: 30.645537 }

/* ---------------- 合江亭 ---------------- */

/**
 * 一段台阶：从台基边（父坐标系 z = zEdge，向 -Z 方向下行）落到地面，
 * 两侧沿踏步口斜放一道汉白玉栏板。x 为台阶中线。
 */
function addFlight(b, parent, x, zEdge, width, h) {
  // 绕 Y 转 π：局部 +Z 指向父坐标系的 -Z（向外下行）
  const m = local(parent, x, 0, zEdge, Math.PI)
  const n = Math.max(2, Math.round(h / 0.29))
  const rise = h / n
  const tread = 0.34
  for (let k = 1; k < n; k++) {
    b.add(
      box(width, h - k * rise, tread),
      L.granite,
      local(m, 0, 0, (k - 0.5) * tread)
    )
  }
  const run = (n - 1) * tread
  for (const sx of [-1, 1]) {
    const px = sx * (width / 2 + 0.18)
    // 栏板底边沿踏步口斜线（顶端伸进台基栏杆、底端落到第一级），高 1 m
    b.add(
      sweepBar(
        [
          [px, h + 0.05, -0.3],
          [px, rise + 0.05, run]
        ],
        0.3,
        1.0,
        { sink: 0.6 }
      ),
      L.marble,
      m
    )
    // 栏板下端的抱鼓石
    b.add(box(0.4, 1.3, 0.8), L.marble, local(m, px, 0, run + 0.2))
  }
}

/**
 * 合江亭：花岗岩台基 + 汉白玉栏杆 + 两道台阶（朝陆地一侧的长边，左右各一道，
 * 中间夹一方花坛，与照片中两侧登台的形制一致）+ 连体双亭。
 * @param {Matrix4} f 亭子坐标系：局部 X 沿长轴，-Z 朝陆地（西北）；可含等比放大
 * @returns {number} 宝顶最高点（f 的局部米数，未乘放大倍数）
 */
function buildPavilion(b, f) {
  const { w, d, h } = TERRACE
  addPlatform(b, f, { w, d, h, steps: "none", color: L.granite })
  // 台基中部一道深色腰线，打破大面花岗岩
  b.add(box(w + 0.3, 0.3, d + 0.3), L.brick, local(f, 0, h * 0.35, 0))

  // 台阶：-Z 长边上左右两道，宽 3.4
  const sw = 3.4
  const sx = 5.6
  for (const s of [-1, 1]) addFlight(b, f, s * sx, -d / 2, sw, h)
  // 两道台阶之间的花坛
  b.add(
    box(sx * 2 - sw - 1.2, 1.1, 3.2),
    L.granite,
    local(f, 0, 0, -d / 2 - 1.6)
  )
  b.add(
    box(sx * 2 - sw - 1.6, 0.3, 2.8),
    THEME.tree.greens[2],
    local(f, 0, 1.1, -d / 2 - 1.6)
  )

  // 台基顶栏杆：在台阶口留出缺口
  const ex = w / 2 - 0.35
  const ez = d / 2 - 0.35
  const gap0 = sx - sw / 2 - 0.2
  const gap1 = sx + sw / 2 + 0.2
  const rail = { closed: false, h: 1.0, y: h, postSpacing: 1.8 }
  addBalustrade(b, f, {
    ...rail,
    points: [
      [-gap1, -ez],
      [-ex, -ez],
      [-ex, ez],
      [ex, ez],
      [ex, -ez],
      [gap1, -ez]
    ]
  })
  addBalustrade(b, f, {
    ...rail,
    points: [
      [-gap0, -ez],
      [gap0, -ez]
    ]
  })

  // 连体双亭：沿局部 X 排列，每座绕 Y 转 π/2 后边 5 朝 +X、边 2 朝 -X；
  // 中心相距 2·r·cos30° 即共用一条边（两根柱），openEdges [2, 5] 让共用边与外侧入口都不设坐凳
  const a = PAV_R * Math.cos(Math.PI / 6)
  let top = 0
  for (const s of [-1, 1]) {
    const t = addPavilion(b, local(f, s * a, h, 0, Math.PI / 2), {
      sides: 6,
      radius: PAV_R,
      colH: 4.2,
      platformH: 0.45,
      roofH: 4,
      roofColor: L.glaze,
      openEdges: [2, 5]
    })
    top = Math.max(top, t)
  }
  return h + top
}

/* ---------------- 安顺廊桥：石桥体 ---------------- */

/** 拱的起拱点半宽（圆与地面 y = 0 的交点）与两端角度 */
function archSpan(R, c) {
  const hw = Math.sqrt(R * R - c * c)
  return { hw, a0: Math.atan2(-c, -hw), a1: Math.atan2(-c, hw) }
}

/**
 * 石桥体：立面轮廓（X 沿桥、Y 向上）挖出三孔拱与两个圆孔后沿 Z 挤出 depth，
 * 拱腹、孔壁由挤出自动生成。顶面分两级：中段 |x| ≤ STEP[0] 高 top，
 * 两端 |x| ≥ STEP[1] 高 low，其间斜坡。底在 y = 0、Z 居中。
 */
function bridgeBody(len, depth, top, low) {
  const s = new Shape()
  s.moveTo(-len / 2, 0)
  for (const a of ARCHES) {
    const { hw, a0, a1 } = archSpan(a.R, a.c)
    s.lineTo(a.x - hw, 0)
    // 从左起拱点顺时针经拱顶到右起拱点
    s.absarc(a.x, a.c, a.R, a0, a1, true)
  }
  s.lineTo(len / 2, 0)
  s.lineTo(len / 2, low)
  s.lineTo(STEP[1], low)
  s.lineTo(STEP[0], top)
  s.lineTo(-STEP[0], top)
  s.lineTo(-STEP[1], low)
  s.lineTo(-len / 2, low)
  s.closePath()
  for (const o of HOLES) {
    const p = new Path()
    p.absarc(o.x, o.y, o.r, 0, Math.PI * 2, false)
    s.holes.push(p)
  }
  const g = new ExtrudeGeometry(s, {
    depth,
    bevelEnabled: false,
    curveSegments: 10
  })
  g.translate(0, 0, -depth / 2)
  return g
}

/**
 * 把石桥体按三角形拆成「其余」与「拱腹 / 孔壁」两份，分别上色（照片里拱洞内壁是暖橙色）。
 * 判据：面法线水平（|nz| 小）且指向某个拱 / 孔的圆心，三角形中心离圆心约一个半径。
 * 端墙、顶面、拱脚之间的底面法线都不指向圆心，不会被误判。
 * @param {BufferGeometry} g ExtrudeGeometry（非索引、面法线），用后释放
 * @param {Array<{x: number, y: number, r: number}>} circles 拱与孔（立面坐标）
 * @returns {BufferGeometry[]} [其余, 拱腹]
 */
function splitSoffit(g, circles) {
  const p = g.attributes.position.array
  const n = g.attributes.normal.array
  const out = [
    { pos: [], nor: [] },
    { pos: [], nor: [] }
  ]
  for (let k = 0; k < p.length; k += 9) {
    const cx = (p[k] + p[k + 3] + p[k + 6]) / 3
    const cy = (p[k + 1] + p[k + 4] + p[k + 7]) / 3
    const nx = n[k] + n[k + 3] + n[k + 6]
    const ny = n[k + 1] + n[k + 4] + n[k + 7]
    const nl = Math.hypot(nx, ny, n[k + 2] + n[k + 5] + n[k + 8]) || 1
    const soffit =
      Math.hypot(nx, ny) / nl > 0.95 &&
      circles.some((c) => {
        const dx = cx - c.x
        const dy = cy - c.y
        const d = Math.hypot(dx, dy) || 1
        return Math.abs(d - c.r) < 0.5 && (nx * dx + ny * dy) / (nl * d) < -0.8
      })
    const o = out[soffit ? 1 : 0]
    for (let j = 0; j < 9; j++) {
      o.pos.push(p[k + j])
      o.nor.push(n[k + j])
    }
  }
  g.dispose()
  return out.map(({ pos, nor }) => {
    const r = new BufferGeometry()
    r.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3))
    r.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3))
    return r
  })
}

/** 拱券石：半径 r0 → r1 的一段圆环（圆心 (x, c)，截到 y = 0），挤出 depth */
function archRing(x, c, r0, r1, depth) {
  const inner = archSpan(r0, c)
  const outer = archSpan(r1, c)
  const s = new Shape()
  s.moveTo(x - outer.hw, 0)
  s.absarc(x, c, r1, outer.a0, outer.a1, true)
  s.lineTo(x + inner.hw, 0)
  s.absarc(x, c, r0, inner.a1, inner.a0, false)
  s.closePath()
  const g = new ExtrudeGeometry(s, {
    depth,
    bevelEnabled: false,
    curveSegments: 10
  })
  g.translate(0, 0, -depth / 2)
  return g
}

/** 圆孔券石：整圆环，挤出 depth */
function holeRing(x, y, r0, r1, depth) {
  const s = new Shape()
  s.absarc(x, y, r1, 0, Math.PI * 2, false)
  const p = new Path()
  p.absarc(x, y, r0, 0, Math.PI * 2, true)
  s.holes.push(p)
  const g = new ExtrudeGeometry(s, {
    depth,
    bevelEnabled: false,
    curveSegments: 10
  })
  g.translate(0, 0, -depth / 2)
  return g
}

/** 桥头引坡：立面为梯形（桥面高 → 坡脚高 footH），沿 Z 挤出宽 w；局部 +X 向外 */
function rampGeometry(len, w, H, footH) {
  const s = new Shape()
  s.moveTo(0, 0)
  s.lineTo(len, 0)
  s.lineTo(len, footH)
  s.lineTo(0, H)
  s.closePath()
  const g = new ExtrudeGeometry(s, { depth: w, bevelEnabled: false })
  g.translate(0, 0, -w / 2)
  return g
}

/**
 * 斜坡段石栏：从 (x0, y0) 落到 (x1, y1)（父坐标系，z 固定），截面同 addBalustrade：
 * 寻杖扶手、栏板、地栿三道斜条；两端望柱由相邻的平段栏杆提供
 */
function slopeRail(b, parent, x0, y0, x1, y1, z, h) {
  const bar = (dy, w, bh) =>
    b.add(
      sweepBar(
        [
          [x0, y0 + dy, z],
          [x1, y1 + dy, z]
        ],
        w,
        bh
      ),
      L.marble,
      parent
    )
  bar(h * 0.8, 0.16, 0.12)
  bar(h * 0.15, 0.08, h * 0.55)
  bar(0, 0.2, 0.12)
}

/**
 * 石雕镇水兽（照片 2：伏卧昂首、鬃毛蓬起的狮形兽）：低多边形球体与方块拼成——
 * 横卧的身子、隆起的后臀、颈后一圈鬃毛、昂起的大头与方吻、向前平伸的两只前爪、
 * 臀后上卷的尾巴。局部 +X 为兽头朝向，底在 y = 0，身长约 2.6·s、高约 1.65·s
 */
function addBeast(b, m, s) {
  const c = BR.beast
  // 缩放球：底在 (x, y, z)，尺寸 sx × sy × sz（均为 s 的倍数）
  const ball = (x, y, z, sx, sy, sz) =>
    b.add(
      sphere(0.5, 6, 4),
      c,
      local(m, x * s, y * s, z * s, 0, sx * s, sy * s, sz * s)
    )
  ball(-0.05, 0.1, 0, 2.0, 0.9, 1.0) // 身
  ball(-0.6, 0, 0, 0.9, 1.0, 1.2) // 后臀
  ball(0.6, 0.45, 0, 0.5, 1.1, 1.2) // 颈后鬃毛
  ball(0.9, 0.8, 0, 0.8, 0.8, 0.8) // 头
  b.add(box(0.36 * s, 0.34 * s, 0.46 * s), c, local(m, 1.35 * s, 0.98 * s, 0))
  for (const sz of [-1, 1]) {
    // 前爪：贴地向前平伸
    b.add(
      box(0.75 * s, 0.28 * s, 0.28 * s),
      c,
      local(m, 0.95 * s, 0, sz * 0.26 * s)
    )
  }
  b.add(
    sweepBar(
      [
        [-1.0 * s, 0.7 * s, 0],
        [-1.25 * s, 1.15 * s, 0],
        [-1.0 * s, 1.5 * s, 0]
      ],
      0.3 * s,
      0.3 * s
    ),
    c,
    m
  )
}

/* ---------------- 安顺廊桥：木廊 ---------------- */

/**
 * 屋面上色：瓦面橙金；同一几何体下移 drop 再画一层红色，从檐下仰视看到的是红色椽望
 * （照片 2 的檐下）。drop 小于封檐板厚度，檐口处红层藏在金色封檐板后面，只露一道细红边
 */
function addTiles(b, g, m, drop = 0.06) {
  b.add(g, BR.tile, m)
  b.add(g, L.column, local(m, 0, -drop, 0))
}

/** 柱顶一圈额枋（矩形 w × d 的柱线上），底在 y；t 为枋厚 */
function beamRing(b, parent, w, d, y, bh, color, t = 0.35) {
  for (const sz of [-1, 1]) {
    b.add(box(w + t, bh, t), color, local(parent, 0, y, (sz * d) / 2))
  }
  for (const sx of [-1, 1]) {
    b.add(box(t, bh, d), color, local(parent, (sx * w) / 2, y, 0))
  }
}

/**
 * 一层木构：一圈红柱 + 米白花格芯体（深红裙板、腰串与竖棂）+ 红额枋外贴一道金线。
 * w × d 为柱网（芯体各边内缩 0.6 m），底在 y。竖棂是贯通芯体的细长盒子，
 * 一个盒子同时画出前后（或两端）两个立面上的同一根窗棂。
 * @param {object} o { w, d, h, y = 0, spacing = 3.2 柱距, pitch = 1.1 竖棂间距 }
 */
function addStorey(b, parent, o) {
  const { w, d, h, y = 0, spacing = 3.2, pitch = 1.1 } = o
  addColumns(b, parent, { w, d, h, y, spacing, radius: 0.28 })
  const cw = w - 1.2
  const cd = d - 1.2
  b.add(box(cw, h, cd), BR.screen, local(parent, 0, y, 0))
  const skin = 0.06 // 裙板、窗棂比芯体各面凸出 0.03 m
  const dado = Math.min(0.9, h * 0.2)
  const beamH = 0.5
  b.add(box(cw + skin, dado, cd + skin), BR.mullion, local(parent, 0, y, 0))
  // 腰串：窗扇（裙板以上、额枋以下）中部一道横棂
  const mid = y + dado + (h - dado - beamH) * 0.5
  b.add(box(cw + skin, 0.12, cd + skin), BR.mullion, local(parent, 0, mid, 0))
  const nx = Math.max(2, Math.round(cw / pitch))
  for (let i = 1; i < nx; i++) {
    const x = -cw / 2 + (i * cw) / nx
    b.add(
      box(0.1, h - dado, cd + skin),
      BR.mullion,
      local(parent, x, y + dado, 0)
    )
  }
  const nz = Math.max(2, Math.round(cd / pitch))
  for (let j = 1; j < nz; j++) {
    const z = -cd / 2 + (j * cd) / nz
    b.add(
      box(cw + skin, h - dado, 0.1),
      BR.mullion,
      local(parent, 0, y + dado, z)
    )
  }
  beamRing(b, parent, w, d, y + h - beamH, beamH, L.column)
  // 额枋外侧的金线：比额枋厚 0.04，只露出外表面的一条
  beamRing(b, parent, w, d, y + h - beamH * 0.6, 0.08, L.gold, 0.39)
}

/**
 * 翼角脊饰：四个檐角尖端各加一截沿戗脊方向向外上翘的金色短条（套兽的抽象）。
 * (±ex, ±ez) 为檐角水平位置、rx 为正脊半长（戗脊从 (±rx, 0) 伸向檐角）、
 * yTip 为檐角高度，均在屋面坐标系 m 里
 */
function cornerHooks(b, m, ex, ez, rx, yTip, len) {
  const hl = Math.hypot(ex - rx, ez)
  const ux = (ex - rx) / hl
  const uz = ez / hl
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx * ex
      const pz = sz * ez
      const dx = sx * ux * len
      const dz = sz * uz * len
      b.add(
        sweepBar(
          [
            [px - dx * 0.6, yTip - len * 0.2, pz - dz * 0.6],
            [px + dx * 0.4, yTip + len * 0.5, pz + dz * 0.4]
          ],
          0.2,
          0.2,
          { sink: 0.05 }
        ),
        BR.ridge,
        m
      )
    }
  }
}

/**
 * 腰檐：柱网 w × d 的柱顶（高 y）一圈截断的四坡檐（橙金瓦、金脊），柱线外 0.35 m 处
 * 檐面正好等于 y。正脊比例按 innerHalfW 取，让檐的内缘刚好缩进上层芯体（或平台）里被盖住。
 * @param {object} o { pent 出檐, pentH = 1.5, tMax = 0.5, curl = 0.3, innerHalfW }
 * @returns {{ hx: number, hz: number, yIn: number }} 内缘半长、半深与内缘中段高度
 */
function addPent(b, parent, w, d, y, o) {
  const { pent, pentH = 1.5, tMax = 0.5, curl = 0.3, innerHalfW } = o
  const ex = w / 2 + pent
  const ez = d / 2 + pent
  const ridge = clamp(
    (innerHalfW - ex * (1 - tMax)) / ((w / 2) * tMax),
    0.2,
    0.9
  )
  const po = { overhang: pent, curl, ridge, tMax, ridges: false }
  const y0 = y - eaveDrop(d / 2, pent, pentH, 1.5, 0.35)
  const m = local(parent, 0, y0, 0)
  addTiles(b, hipRoof(w, d, pentH, po), m)
  b.add(hipRidges(w, d, pentH, po), BR.ridge, m)
  return {
    hx: ex * (1 - tMax) + ((ridge * w) / 2) * tMax,
    hz: ez * (1 - tMax),
    yIn: y0 + roofHeight(0, tMax, pentH, 0)
  }
}

/** 矩形一圈白石栏杆（平座栏杆，半长 hx、半深 hz），底在 y */
function whiteRail(b, parent, hx, hz, y, h = 0.9) {
  addBalustrade(b, parent, {
    points: [
      [-hx, -hz],
      [hx, -hz],
      [hx, hz],
      [-hx, hz]
    ],
    closed: true,
    y,
    h,
    postSpacing: 1.8,
    color: L.marble
  })
}

/**
 * 歇山顶（中部主楼上檐）：下段为截到 tb 的四坡檐（带翼角），上段两坡顺着前后坡面的曲面
 * 公式继续升到正脊，并沿 X 伸到下段内缘（|x| 超过戗脊处取 s = ±1，与下段内缘严丝合缝）；
 * 两端内收 0.35 m 立三角形山花（红底、金色博风板）；下段内缘围出的开口用一圈矮箱封住，
 * 露出的顶边即金色围脊。屋面坐标系 m：檐口 y = 0（未起翘处），w × d 为檐柱柱网。
 * @param {object} o { h, overhang, curl, ridge, tb = 0.5 }
 * @param {number} coreTop 柱顶在 m 里的高度（封口矮箱从这里起）
 * @returns {number} 最高点（鸱吻顶）在 m 里的高度
 */
function addXieshan(b, m, w, d, o, coreTop) {
  const { h, overhang, curl, ridge, tb = 0.5 } = o
  const ro = { overhang, curl, ridge, tMax: tb, ridges: false }
  addTiles(b, hipRoof(w, d, h, ro), m)
  b.add(hipRidges(w, d, h, ro), BR.ridge, m)
  const ex = w / 2 + overhang
  const ez = d / 2 + overhang
  const rx = (ridge * w) / 2
  const hx = ex * (1 - tb) + rx * tb // 下段端坡内缘所在的 x
  const hz = ez * (1 - tb)
  const y0 = roofHeight(0, tb, h, curl) // 下段内缘中段高度
  cornerHooks(b, m, ex, ez, rx, curl * h, 1.3)

  // 封口矮箱：下半截红（檐下看得见的部分），顶上一圈金色围脊
  const capH = 0.25
  b.add(
    box(2 * hx + 0.2, y0 - capH - coreTop, 2 * hz + 0.2),
    L.column,
    local(m, 0, coreTop, 0)
  )
  b.add(
    box(2 * hx + 0.2, capH + 0.05, 2 * hz + 0.2),
    BR.ridge,
    local(m, 0, y0 - capH, 0)
  )

  // 上段两坡：索引网格算平滑法线（与 kit 坡面一致），b.add 内部再转非索引
  const lift = 0.04 // 比下段内缘略高，免得两层瓦面在接缝处重合闪烁
  const hAt = (x, t) => {
    const s = Math.min(1, Math.abs(x) / (ex * (1 - t) + rx * t))
    return roofHeight(s, t, h, curl) + lift
  }
  const segX = 10
  const segT = 5
  const tAt = (j) => tb + ((1 - tb) * j) / segT
  const cols = segX + 1
  for (const sz of [-1, 1]) {
    const pos = []
    for (let j = 0; j <= segT; j++) {
      const t = tAt(j)
      for (let i = 0; i <= segX; i++) {
        const x = -hx + (2 * hx * i) / segX
        pos.push(x, hAt(x, t), sz * ez * (1 - t))
      }
    }
    const index = []
    for (let j = 0; j < segT; j++) {
      for (let i = 0; i < segX; i++) {
        const a = j * cols + i
        // 前坡（sz = 1）按 a→b→c 绕向时法线朝上朝外；后坡反过来
        if (sz > 0)
          index.push(a, a + 1, a + cols + 1, a, a + cols + 1, a + cols)
        else index.push(a, a + cols + 1, a + 1, a, a + cols, a + cols + 1)
      }
    }
    const g = new BufferGeometry()
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3))
    g.setIndex(index)
    g.computeVertexNormals()
    b.add(g, BR.tile, m)
    // 上段檐口的封檐板（与下段内缘的 lift 缝隙一起盖住）
    const fa = []
    for (let i = 0; i < segX; i++) {
      const x0 = -hx + (2 * hx * i) / segX
      const x1 = -hx + (2 * hx * (i + 1)) / segX
      const z = sz * hz
      const ya = hAt(x0, tb)
      const yb = hAt(x1, tb)
      fa.push(x0, ya, z, x1, yb, z, x1, yb - 0.14, z)
      fa.push(x0, ya, z, x1, yb - 0.14, z, x0, ya - 0.14, z)
    }
    const fg = new BufferGeometry()
    fg.setAttribute("position", new BufferAttribute(new Float32Array(fa), 3))
    fg.computeVertexNormals()
    b.add(fg, BR.tile, m)
  }

  // 山花：x = ±xg 的竖直多边形，上沿贴着上段坡面，下沿落在围脊顶；以下沿中点为扇心
  const xg = hx - 0.35
  const yb = y0 + 0.05
  for (const sx of [-1, 1]) {
    const edge = []
    for (let j = 0; j <= segT; j++) edge.push([-ez * (1 - tAt(j)), tAt(j)])
    for (let j = segT - 1; j >= 0; j--) edge.push([ez * (1 - tAt(j)), tAt(j)])
    const poly = [
      [-hz, yb],
      ...edge.map(([z, t]) => [z, hAt(xg, t) - 0.05]),
      [hz, yb]
    ]
    const pg = []
    for (let k = 0; k < poly.length - 1; k++) {
      pg.push(sx * xg, yb, 0)
      pg.push(sx * xg, poly[k][1], poly[k][0])
      pg.push(sx * xg, poly[k + 1][1], poly[k + 1][0])
    }
    const g = new BufferGeometry()
    g.setAttribute("position", new BufferAttribute(new Float32Array(pg), 3))
    g.computeVertexNormals()
    b.add(g, L.column, m)
    // 博风板：沿上段坡面两端的山面边缘压一道金条
    b.add(
      sweepBar(
        edge.map(([z, t]) => [sx * hx, hAt(hx, t), z]),
        0.22,
        0.2,
        { sink: 0.14 }
      ),
      BR.ridge,
      m
    )
  }

  // 正脊 + 两端鸱吻（竖块 + 向内卷的弯条）
  const top = h + lift
  b.add(box(2 * hx + 0.3, 0.45, 0.36), BR.ridge, local(m, 0, top - 0.12, 0))
  for (const sx of [-1, 1]) {
    b.add(box(0.5, 1.1, 0.4), BR.ridge, local(m, sx * (hx - 0.1), top - 0.1, 0))
    b.add(
      sweepBar(
        [
          [sx * (hx + 0.05), top + 0.8, 0],
          [sx * (hx - 0.2), top + 1.35, 0],
          [sx * (hx - 0.6), top + 1.25, 0]
        ],
        0.3,
        0.22
      ),
      BR.ridge,
      m
    )
  }
  return top + 1.4
}

/**
 * 安顺廊桥：石桥体（三拱两孔、两级桥面）+ 拱券石 + 券顶兽面 + 镇水兽 + 桥面压面石与石栏
 * + 两端引坡 + 桥上木廊（中部主楼、两段长廊、两端楼阁）。
 * @param {Matrix4} f 桥坐标系：局部 X 沿桥长（指向北端），原点在桥心地面
 * @returns {number} 木廊最高点 y（桥坐标系）
 */
function buildBridge(b, f) {
  const D = BRIDGE_D
  const TU = DECK_H - COPING // 石桥体中段顶面
  const TL = DECK_LOW - COPING // 石桥体两端顶面
  // 桥体顶面比桥面低一个压面石厚度，避免与压面石顶面重合闪烁；拱腹、孔壁另着暖琥珀色
  const circles = [
    ...ARCHES.map((a) => ({ x: a.x, y: a.c, r: a.R })),
    ...HOLES.map((o) => ({ x: o.x, y: o.y, r: o.r }))
  ]
  const [body, soffit] = splitSoffit(bridgeBody(BRIDGE_LEN, D, TU, TL), circles)
  b.add(body, BR.stone, f)
  b.add(soffit, BR.glow, f)
  // 拱券石与圆孔券石：前后两个立面各一圈，凸出墙面 0.15 m，内缘略伸进洞口盖住接缝；
  // 每个拱顶压一块兽面券顶石（照片里是浮雕兽头，这里抽象成略深的花岗岩方块）
  for (const z of [-D / 2, D / 2]) {
    const fz = local(f, 0, 0, z)
    for (const a of ARCHES) {
      b.add(archRing(a.x, a.c, a.R - 0.08, a.R + ARCH_RING, 0.3), L.marble, fz)
      b.add(
        box(0.8, 0.95, 0.45),
        L.granite,
        local(fz, a.x, a.c + a.R - 0.08, Math.sign(z) * 0.08)
      )
    }
    for (const o of HOLES) {
      b.add(holeRing(o.x, o.y, o.r - 0.08, o.r + 0.55, 0.3), L.marble, fz)
    }
  }
  // 镇水兽：两个圆孔下的桥墩前后各一座石台（下层方台立在水里 + 上层须弥座），
  // 台上一只伏兽、兽头朝桥心（照片 2），按插画式略放大到身长约 3.1 m
  for (const o of HOLES) {
    for (const sz of [-1, 1]) {
      const pm = local(f, o.x, 0, sz * (D / 2 + 1.35))
      b.add(box(3.4, 3.3, 2.5), L.granite, local(pm, 0, -0.4, 0))
      b.add(box(3.0, 0.5, 1.9), L.granite, local(pm, 0, 2.9, 0))
      addBeast(b, local(pm, 0, 3.4, 0, o.x > 0 ? Math.PI : 0), 1.2)
    }
  }

  // 桥面压面石：上层一段、两端下层各一段，斜坡段用斜条（顶面随坡跌落）
  b.add(box(2 * STEP[0], COPING, D + 0.5), L.marble, local(f, 0, TU, 0))
  const lowEnd = BRIDGE_LEN / 2 + 0.25
  for (const sx of [-1, 1]) {
    b.add(
      box(lowEnd - STEP[1], COPING, D + 0.5),
      L.marble,
      local(f, (sx * (lowEnd + STEP[1])) / 2, TL, 0)
    )
    b.add(
      sweepBar(
        [
          [sx * STEP[0], TU, 0],
          [sx * STEP[1], TL, 0]
        ],
        D + 0.5,
        COPING
      ),
      L.marble,
      f
    )
  }
  // 桥面两侧石栏：上层平段 + 斜坡段 + 下层平段；桥两端的短横栏把桥面石栏
  // （z = ±(D/2 − 0.2)）接到引坡栏板（z = ±(RAMP.w/2 − 0.15)），不留缺口
  const zb = D / 2 - 0.2
  const rail = { closed: false, h: 1.1, postSpacing: 2.6 }
  for (const sz of [-1, 1]) {
    addBalustrade(b, f, {
      ...rail,
      y: DECK_H,
      points: [
        [-STEP[0], sz * zb],
        [STEP[0], sz * zb]
      ]
    })
    for (const sx of [-1, 1]) {
      slopeRail(
        b,
        f,
        sx * STEP[0],
        DECK_H,
        sx * STEP[1],
        DECK_LOW,
        sz * zb,
        1.1
      )
      addBalustrade(b, f, {
        ...rail,
        y: DECK_LOW,
        points: [
          [sx * STEP[1], sz * zb],
          [sx * (BRIDGE_LEN / 2 - 0.3), sz * zb]
        ]
      })
      addBalustrade(b, f, {
        ...rail,
        y: DECK_LOW,
        points: [
          [sx * (BRIDGE_LEN / 2 - 0.15), sz * zb],
          [sx * (BRIDGE_LEN / 2 - 0.15), sz * (RAMP.w / 2 - 0.15)]
        ]
      })
    }
  }
  // 两端引坡（从下层桥面起坡）：绕 Y 转 π 做南端（不用镜像）
  for (const yaw of [0, Math.PI]) {
    const m = local(f, 0, 0, 0, yaw)
    const x0 = BRIDGE_LEN / 2
    b.add(
      rampGeometry(RAMP.len, RAMP.w, DECK_LOW, RAMP.footH),
      BR.stone,
      local(m, x0, 0, 0)
    )
    for (const sz of [-1, 1]) {
      const z = sz * (RAMP.w / 2 - 0.15)
      b.add(
        sweepBar(
          [
            [x0 - 0.2, DECK_LOW, z],
            [x0 + RAMP.len, RAMP.footH, z]
          ],
          0.3,
          1.0,
          { sink: 0.3 }
        ),
        L.marble,
        m
      )
    }
  }

  // ---- 桥上木廊 ----
  const deck = local(f, 0, DECK_H, 0)
  // 中部主楼（上层桥面、两层）：底层 18 × 9，腰檐上一圈白石平座栏杆；
  // 二层四面各内收 0.6 m，上覆重檐的上檐——歇山顶，全桥最宽最高
  const G = { w: 18, d: 9, h: 4.8 }
  const U = { w: 16.8, d: 7.8, h: 3.8 }
  addStorey(b, deck, { ...G, spacing: 3 })
  addPent(b, deck, G.w, G.d, G.h, {
    pent: 1.5,
    pentH: 1.6,
    curl: 0.35,
    innerHalfW: (U.w - 1.2) / 2 - 0.15
  })
  whiteRail(b, deck, G.w / 2 + 0.05, G.d / 2 + 0.05, G.h)
  addStorey(b, deck, { ...U, y: G.h, spacing: 2.8, pitch: 1.4 })
  const xs = { h: 5, overhang: 2, curl: 0.5, ridge: 0.62 }
  const uTop = G.h + U.h
  const yr = uTop - eaveDrop(U.d / 2, xs.overhang, xs.h, 1.5, 0.5)
  let top = yr + addXieshan(b, local(deck, 0, yr, 0), U.w, U.d, xs, uTop - yr)

  // 两段单层长廊（上层桥面，x 从主楼端柱 9 到斜坡起点 STEP[0]）：四坡顶，比楼阁低一截
  const gw = STEP[0] - G.w / 2
  const gx = (STEP[0] + G.w / 2) / 2
  const gRoof = { overhang: 1.15, curl: 0.35, ridge: 0.9, ridges: false }
  const gH = 4.5
  const gRoofH = 2.4
  for (const sx of [-1, 1]) {
    const gc = local(deck, sx * gx, 0, 0)
    addStorey(b, gc, { w: gw, d: 7, h: gH, spacing: 3.4 })
    // 主楼芯体（|x| ≤ 8.4）与长廊芯体（|x| ≥ 9.6）之间的缝用一段芯体补上
    b.add(box(1.4, gH, 5.8), BR.screen, local(deck, sx * (G.w / 2), 0, 0))
    const m = local(
      gc,
      0,
      gH - eaveDrop(3.5, gRoof.overhang, gRoofH, 1.5, 0.5),
      0
    )
    addTiles(b, hipRoof(gw, 7, gRoofH, gRoof), m)
    b.add(hipRidges(gw, 7, gRoofH, gRoof), BR.ridge, m)
  }

  // 两端楼阁（下层桥面，x 从斜坡终点 STEP[1] 起 9 × 9）：底层腰檐围出一圈平台、白石栏杆，
  // 台上一座 5.2 m 见方的小亭，陡峭的四角攒尖顶、翼角高翘、顶立宝顶
  const E = { w: 9, d: 9, h: 4.6 }
  const ex = STEP[1] + E.w / 2
  const T = { a: 5.2, h: 3.2 } // 台上方亭：边长、柱高
  const pyr = { overhang: 1.4, curl: 0.5, ridges: false }
  const pyrH = 4.4
  const pr = (T.a / 2) * Math.SQRT2 // 方亭柱网外接圆半径
  for (const sx of [-1, 1]) {
    const e = local(f, sx * ex, DECK_LOW, 0)
    addStorey(b, e, { ...E, spacing: 3 })
    const pi = addPent(b, e, E.w, E.d, E.h, {
      pent: 1.4,
      tMax: 0.4,
      innerHalfW: 0
    })
    // 平台：盖住腰檐内缘围出的开口，顶面比内缘高 0.08
    const yT = pi.yIn + 0.08
    b.add(
      box(2 * pi.hx + 0.3, yT - E.h, 2 * pi.hz + 0.3),
      BR.stone,
      local(e, 0, E.h, 0)
    )
    whiteRail(b, e, pi.hx - 0.1, pi.hz - 0.1, yT)
    addStorey(b, e, { w: T.a, d: T.a, h: T.h, y: yT, spacing: 2.6, pitch: 1.3 })
    // 攒尖顶：边心处出檐 = 外接圆出檐 × cos45°
    const edgeO = pyr.overhang * Math.SQRT1_2
    const yp = yT + T.h - eaveDrop(T.a / 2, edgeO, pyrH, 1.5, 0.35)
    const pm = local(e, 0, yp, 0)
    addTiles(b, pyramidRoof(4, pr, pyrH, pyr), pm)
    b.add(pyramidRidges(4, pr, pyrH, pyr), BR.ridge, pm)
    const ce = (pr + pyr.overhang) * Math.SQRT1_2
    cornerHooks(b, pm, ce, ce, 0, pyr.curl * pyrH, 1.1)
    b.add(finial(1.4), BR.ridge, local(pm, 0, pyrH - 0.15, 0))
    top = Math.max(top, DECK_LOW - DECK_H + yp + pyrH + 1.25)
  }
  return DECK_H + top
}

/* ---------------- 定位 ---------------- */

/**
 * 先按名称在 OSM 建筑里查（取最小外接矩形的中心与长轴）；查不到时用设计坐标。
 * @returns {{ x: number, z: number, bearing: number, found: boolean }}
 */
function locate(ctx, spec) {
  const [x, z] = ctx.project.toLocal(spec.lon, spec.lat)
  const i = findBuilding(ctx.buildings, spec.name, {
    near: [x, z],
    maxDist: 150
  })
  if (i >= 0) {
    const r = minAreaRect(ctx.buildings[i].p)
    return { x: r.cx, z: r.cz, bearing: r.bearing, found: true }
  }
  return { x, z, bearing: spec.bearing, found: false }
}

/**
 * 【有意偏离 OSM】亭西北侧约 40 m 的一栋无名小楼（24 × 6 m）：OSM 高度 22.8 m，
 * 在亭子旁立成一堵高墙，与照片 hj_7097（亭子台基旁是一栋两层白色平顶小楼）不符。
 * 只按固定坐标匹配这一栋（顶点平均点离 NEIGHBOUR 不超过 5 m），改建为 7 m 高的白墙平顶小楼。
 * @returns {Array} 替换区（最小外接矩形外扩 1 m）；没找到这栋楼时为空
 */
function lowerNeighbour(b, ctx) {
  const [nx, nz] = ctx.project.toLocal(NEIGHBOUR.lon, NEIGHBOUR.lat)
  const bd = ctx.buildings.find((it) => {
    if (!it.p || it.p.length < 3) return false
    const [x, z] = centroid(it.p)
    return Math.hypot(x - nx, z - nz) <= 5
  })
  if (!bd) return []
  const r = minAreaRect(bd.p)
  const f = frame(r.cx, 0, r.cz, r.bearing - 90)
  b.add(box(r.w, 7, r.d), L.plaster, f)
  b.add(box(r.w + 0.3, 0.5, r.d + 0.3), L.granite, local(f, 0, 7, 0))
  return [rectPolygon(r.cx, r.cz, r.w + 2, r.d + 2, r.bearing)]
}

/* ---------------- 入口 ---------------- */

export function build(ctx) {
  const b = new ColorBuilder()
  const DEG = Math.PI / 180

  // 合江亭：局部 X 沿长轴（frame 的 +X 指向 bearing + 90°，故传 bearing − 90）
  const pav = locate(ctx, PAVILION)
  const fp = frame(pav.x, 0, pav.z, pav.bearing - 90)
  // 亭子一组：平移到陆地一侧后等比放大 PAV_SCALE（buildPavilion 内部仍按真实尺寸）
  const S = PAV_SCALE
  const fs = local(fp, PAV_SHIFT[0], 0, PAV_SHIFT[1], 0, S, S, S)
  const pavTop = buildPavilion(b, fs) * S
  const pavC = new Vector3().applyMatrix4(fs) // 放大后亭子组中心（世界坐标）
  const neighbourZones = lowerNeighbour(b, ctx)

  // 安顺廊桥：局部 X 沿桥长；查不到时沿长轴平移 shift 米，让两端落在岸上
  const br = locate(ctx, BRIDGE)
  const shift = br.found ? 0 : BRIDGE.shift
  const bx = br.x + Math.sin(br.bearing * DEG) * shift
  const bz = br.z - Math.cos(br.bearing * DEG) * shift
  const fb = frame(bx, 0, bz, br.bearing - 90)
  buildBridge(b, fb)

  // 陆地上的树：亭子西北侧空地与桥头两岸（偏移量在各自坐标系里，已避开水面）
  const greens = THEME.tree.greens
  const p = new Vector3()
  const treeAt = (m, x, z, s, k) => {
    // 局部 (x, 0, z) 经 frame 矩阵换成世界坐标
    p.set(x, 0, z).applyMatrix4(m)
    addTree(b, p.x, 0, p.z, {
      r: s,
      color: k === 4 ? THEME.tree.yellow : greens[k % 4]
    })
  }
  // 亭子旁的树（fp 局部坐标，未放大）：放大后的台基占 x −19.6～15.6、z −31.6～−2.8，
  // 这几棵都在台基与台阶外 ≥ 0.8 m、不落水、离楼 ≥ 8 m（Node 核对）
  const PAV_TREES = [
    [-17, -36, 3.8],
    [16, -30, 4],
    [-5, -40, 4.2],
    [8, -40, 3.6]
  ]
  PAV_TREES.forEach(([x, z, s], k) => treeAt(fp, x, z, s, k))
  const BRIDGE_TREES = [
    [46, -12, 4.5],
    [46, 12, 4.5],
    [50, -22, 5],
    [-50, -13, 5],
    [-50, 13, 5],
    [-60, -22, 5.5],
    [-60, 24, 5]
  ]
  BRIDGE_TREES.forEach(([x, z, s], k) => treeAt(fb, x, z, s, k + 1))

  const meshes = []
  const g = b.bake()
  if (g) meshes.push(new Mesh(g, landmarkMaterial()))

  // 游船：单独一个 Mesh，改 position 做漂移、改 rotation 让船头朝行进方向（注册表据 animated 关闭投影）
  const [r0x, r0z] = ctx.project.toLocal(...RIVER[0])
  const [r1x, r1z] = ctx.project.toLocal(...RIVER[1])
  const len = Math.hypot(r1x - r0x, r1z - r0z)
  const ux = (r1x - r0x) / len
  const uz = (r1z - r0z) / len
  const riverBearing = Math.atan2(ux, -uz) / DEG
  const cx = r0x + ux * BOAT.from
  const cz = r0z + uz * BOAT.from
  const bb = new ColorBuilder()
  // 船长沿局部 X、船头朝下游
  addBoat(bb, frame(0, 0, 0, riverBearing - 90), { length: BOAT.length })
  const boat = new Mesh(bb.bake(), landmarkMaterial())
  boat.userData.animated = true
  // 船底略沉入水面以下（船舷高 0.1 × 船长）
  const boatY = RIVER_Y - 0.35
  boat.position.set(cx, boatY, cz)
  meshes.push(boat)

  // 步行路径（世界坐标）：局部点经各自坐标系矩阵换算（fs 含放大）
  const wp = new Vector3()
  const xz = (m, x, z) => {
    wp.set(x, 0, z).applyMatrix4(m)
    return [wp.x, wp.z]
  }
  // 台基环路：亭子组局部坐标里的圆角矩形（四角圆弧，不出现急转），再换到世界坐标
  const tw = TERRACE_WALK
  const ring = roundedLoop({
    x0: -tw.x,
    x1: tw.x,
    z0: -tw.z,
    z1: tw.z,
    r: tw.r
  }).map(([x, z]) => xz(fs, x, z))
  const walkways = [
    {
      points: RIVERSIDE.points.map(([x, z]) => xz(fp, x, z)),
      y: GROUND_Y,
      width: RIVERSIDE.width,
      closed: false,
      density: RIVERSIDE.density
    },
    // 廊桥边道：南北两段长廊 × 东西两侧
    ...[-1, 1].flatMap((sx) =>
      [-1, 1].map((sz) => ({
        points: [
          xz(fb, sx * DECK_WALK.x0, sz * DECK_WALK.z),
          xz(fb, sx * DECK_WALK.x1, sz * DECK_WALK.z)
        ],
        y: DECK_H,
        width: DECK_WALK.width,
        closed: false,
        density: DECK_WALK.density
      }))
    ),
    {
      points: ring,
      y: TERRACE.h * S,
      width: tw.width,
      closed: true,
      density: tw.density
    }
  ]

  const zones = [
    rectPolygon(
      pavC.x,
      pavC.z,
      (TERRACE.w + 6) * S,
      (TERRACE.d + 12) * S,
      pav.bearing
    ),
    rectPolygon(bx, bz, BRIDGE_LEN + 2 * RAMP.len + 4, 18, br.bearing),
    ...neighbourZones
  ]

  return {
    meshes,
    zones,
    markerHeight: pavTop,
    walkways,
    update(t) {
      // 正弦往复：周期 60 s、振幅 60 m，端点处自然减速
      const w = (2 * Math.PI) / BOAT.period
      const off = BOAT.amp * Math.sin(w * t)
      boat.position.set(cx + ux * off, boatY, cz + uz * off)
      // 船头朝行进方向：速度 ∝ cos(wt)，顺流为正（几何体船头朝下游）。
      // 用 tanh 把速度符号平滑成 ±1，端点减速时原地掉头（约 ±3 s 内转完 180°）
      const dir = Math.tanh(6 * Math.cos(w * t))
      boat.rotation.y = (Math.PI * (1 - dir)) / 2
    }
  }
}

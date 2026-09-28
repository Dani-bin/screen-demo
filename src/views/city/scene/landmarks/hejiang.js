/*
 * 合江亭 · 安顺廊桥
 * ----------------------------------------------------------
 * 府河与南河在此交汇为锦江。本景点包含三部分：
 *   1. 合江亭：两座六角重檐攒尖亭连体（共用中间两根柱，共 10 柱），
 *      金黄琉璃瓦、红柱，坐在 3.5 m 高的花岗岩台基上，汉白玉栏杆、两道台阶；
 *   2. 安顺廊桥：全长 81、桥体宽 14，三孔半圆石拱、拱间桥墩各开一个圆形泄洪孔，
 *      桥面上两层红柱木廊、灰瓦歇山顶，中部与两端楼阁高出一层；
 *   3. 锦江上一艘游船（红船身、黄顶棚），沿河中心线来回缓慢漂移（单独 Mesh、不投影）。
 * 另在亭子与桥头的陆地上补几棵低多边形树。
 *
 * 定位：OSM 数据里合江亭没有名称、安顺廊桥不在建筑数据中（桥不是 building），
 * 先按名称查楼，查不到时按设计坐标与朝向放置（见 PAVILION / BRIDGE 常量）。
 */
import { ExtrudeGeometry, Mesh, Path, Shape, Vector3 } from "three"
import { THEME } from "../theme.js"
import { ColorBuilder, frame, landmarkMaterial, local } from "./kit/builder.js"
import {
  centroid,
  findBuilding,
  minAreaRect,
  rectPolygon
} from "./kit/footprint.js"
import { box, sweepBar } from "./kit/shapes.js"
import { hipRidges, hipRoof } from "./kit/roofs.js"
import {
  addBalustrade,
  addColumns,
  addPavilion,
  addPlatform,
  eaveDrop
} from "./kit/parts.js"
import { addBoat, addTree } from "./kit/figures.js"

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

/* ---------------- 安顺廊桥尺寸 ---------------- */

const DECK_H = 8.5 // 桥面（石桥体顶）高度
const BRIDGE_LEN = 81
const BRIDGE_D = 14 // 桥体宽
// 三孔石拱：x 为拱心沿桥位置，R 为半径，c 为圆心高度（略低于地面，水面上近乎半圆）
const ARCHES = [
  { x: -22.8, R: 6.8, c: -0.8 },
  { x: 0, R: 8, c: -1 },
  { x: 22.8, R: 6.8, c: -0.8 }
]
// 拱间桥墩上的圆形泄洪孔
const HOLES = [
  { x: -12, y: 3.1, r: 2.4 },
  { x: 12, y: 3.1, r: 2.4 }
]
const RAMP = { len: 16, w: 11, footH: 0.8 } // 桥头引坡
const COPING = 0.5 // 桥面压面石厚度：石桥体只挤出到 DECK_H − COPING，桥面顶面归压面石

// 亭西北侧那栋无名小楼的轮廓中心（OSM 顶点平均点，经纬度）
const NEIGHBOUR = { lon: 104.08076, lat: 30.645537 }

/* ---------------- 通用小工具 ---------------- */

/** 柱顶一圈额枋（矩形 w × d 的柱线上），底在 y */
function beamRing(b, parent, w, d, y, bh, color) {
  const t = 0.35
  for (const sz of [-1, 1]) {
    b.add(box(w + t, bh, t), color, local(parent, 0, y, (sz * d) / 2))
  }
  for (const sx of [-1, 1]) {
    b.add(box(t, bh, d), color, local(parent, (sx * w) / 2, y, 0))
  }
}

/** 矩形一圈矮栏板（平座栏杆），沿柱线外 0.05 m，底在 y */
function railRing(b, parent, w, d, y, h, color) {
  const t = 0.12
  for (const sz of [-1, 1]) {
    b.add(box(w + 0.1, h, t), color, local(parent, 0, y, sz * (d / 2 + 0.05)))
  }
  for (const sx of [-1, 1]) {
    b.add(box(t, h, d), color, local(parent, sx * (w / 2 + 0.05), y, 0))
  }
}

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
 * @param {Matrix4} f 亭子坐标系：局部 X 沿长轴，-Z 朝陆地（西北）
 * @returns {number} 宝顶最高点（米）
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

/* ---------------- 安顺廊桥 ---------------- */

/** 拱的起拱点半宽（圆与地面 y = 0 的交点）与两端角度 */
function archSpan(R, c) {
  const hw = Math.sqrt(R * R - c * c)
  return { hw, a0: Math.atan2(-c, -hw), a1: Math.atan2(-c, hw) }
}

/**
 * 石桥体：立面轮廓（X 沿桥、Y 向上）挖出三孔拱与两个圆孔后沿 Z 挤出 depth，
 * 拱腹、孔壁由挤出自动生成。底在 y = 0、Z 居中。
 */
function bridgeBody(len, depth, H) {
  const s = new Shape()
  s.moveTo(-len / 2, 0)
  for (const a of ARCHES) {
    const { hw, a0, a1 } = archSpan(a.R, a.c)
    s.lineTo(a.x - hw, 0)
    // 从左起拱点顺时针经拱顶到右起拱点
    s.absarc(a.x, a.c, a.R, a0, a1, true)
  }
  s.lineTo(len / 2, 0)
  s.lineTo(len / 2, H)
  s.lineTo(-len / 2, H)
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
 * 木廊楼阁：每层一圈红柱 + 深红花格芯体 + 额枋；二层起下方挑一圈腰檐（截断的四坡顶）
 * 与平座栏杆；顶部灰瓦歇山顶。w × d 为柱网（w ≥ d，屋脊沿 X），底在 y = 0。
 * @param {object} o { w, d, floors: 各层高, roofH, overhang, ridge, pent 腰檐出檐 }
 * @returns {number} 屋脊最高点 y
 */
function addGallery(b, parent, o) {
  const { w, d, floors, roofH, overhang, ridge = 0.5, pent = 1.2 } = o
  const pentH = 1.5
  const tMax = 0.5
  // 腰檐内缘半宽：hz = (d/2 + pent)·(1 − tMax)，hx 另加屋脊段；
  // 取屋脊比例让内缘刚好缩在芯体以内，芯体能把腰檐的内圈开口盖住
  const coreW = w - 1.2
  const coreD = d - 1.2
  const pentRidge = Math.min(
    0.9,
    Math.max(
      0.2,
      (coreW / 2 - 0.15 - (w / 2 + pent) * (1 - tMax)) / ((w / 2) * tMax)
    )
  )
  const po = {
    overhang: pent,
    curl: 0.3,
    ridge: pentRidge,
    tMax,
    ridges: false
  }
  let y = 0
  floors.forEach((h, i) => {
    if (i > 0) {
      // 腰檐：柱线外 0.35 m 处屋面正好等于楼面高度
      const m = local(parent, 0, y - eaveDrop(d / 2, pent, pentH, 1.5, 0.35), 0)
      b.add(hipRoof(w, d, pentH, po), L.roof, m)
      b.add(hipRidges(w, d, pentH, po), L.roofRidge, m)
      railRing(b, parent, w, d, y, 0.9, L.column)
    }
    addColumns(b, parent, { w, d, h, y, spacing: 3.2, radius: 0.28 })
    b.add(box(coreW, h, coreD), L.lattice, local(parent, 0, y, 0))
    beamRing(b, parent, w, d, y + h - 0.45, 0.45, L.lattice)
    y += h
  })
  const ro = { overhang, curl: 0.38, ridge, ridges: false }
  const yr = y - eaveDrop(d / 2, overhang, roofH, 1.5, 0.5)
  const m = local(parent, 0, yr, 0)
  b.add(hipRoof(w, d, roofH, ro), L.roof, m)
  b.add(hipRidges(w, d, roofH, ro), L.roofRidge, m)
  return yr + roofH * 1.1
}

/**
 * 安顺廊桥：石桥体（三拱两孔）+ 拱券石 + 桥面檐口线与石栏 + 两端引坡 + 桥上木廊楼阁。
 * @param {Matrix4} f 桥坐标系：局部 X 沿桥长（指向北端），原点在桥心地面
 */
function buildBridge(b, f) {
  const H = DECK_H
  const D = BRIDGE_D
  // 桥体顶面比桥面低一个压面石厚度，避免与压面石顶面重合闪烁
  b.add(bridgeBody(BRIDGE_LEN, D, H - COPING), L.granite, f)
  // 拱券石与圆孔券石：前后两个立面各一圈，凸出墙面 0.15 m，内缘略伸进洞口盖住接缝
  for (const z of [-D / 2, D / 2]) {
    const fz = local(f, 0, 0, z)
    for (const a of ARCHES) {
      b.add(archRing(a.x, a.c, a.R - 0.08, a.R + 0.8, 0.3), L.marble, fz)
    }
    for (const o of HOLES) {
      b.add(holeRing(o.x, o.y, o.r - 0.08, o.r + 0.55, 0.3), L.marble, fz)
    }
  }
  // 桥面檐口线（压面石）
  b.add(
    box(BRIDGE_LEN + 0.5, COPING, D + 0.5),
    L.marble,
    local(f, 0, H - COPING, 0)
  )
  // 桥面两侧石栏
  for (const sz of [-1, 1]) {
    addBalustrade(b, f, {
      points: [
        [-BRIDGE_LEN / 2 + 0.3, sz * (D / 2 - 0.2)],
        [BRIDGE_LEN / 2 - 0.3, sz * (D / 2 - 0.2)]
      ],
      closed: false,
      y: H,
      h: 1.1,
      postSpacing: 2.6
    })
  }
  // 桥两端的短横栏：把桥面石栏（z = ±(D/2 − 0.2)）接到引坡栏板（z = ±(RAMP.w/2 − 0.15)），不留缺口
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addBalustrade(b, f, {
        points: [
          [sx * (BRIDGE_LEN / 2 - 0.15), sz * (D / 2 - 0.2)],
          [sx * (BRIDGE_LEN / 2 - 0.15), sz * (RAMP.w / 2 - 0.15)]
        ],
        closed: false,
        y: H,
        h: 1.1,
        postSpacing: 2.6
      })
    }
  }
  // 两端引坡：绕 Y 转 π 做南端（不用镜像）
  for (const yaw of [0, Math.PI]) {
    const m = local(f, 0, 0, 0, yaw)
    const x0 = BRIDGE_LEN / 2
    b.add(
      rampGeometry(RAMP.len, RAMP.w, H, RAMP.footH),
      L.granite,
      local(m, x0, 0, 0)
    )
    for (const sz of [-1, 1]) {
      const z = sz * (RAMP.w / 2 - 0.15)
      b.add(
        sweepBar(
          [
            [x0 - 0.2, H, z],
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

  // 桥上木廊：中部楼阁（三层）+ 两端楼阁（三层）+ 其间两段两层长廊
  const deck = local(f, 0, H, 0)
  let top = 0
  top = Math.max(
    top,
    addGallery(b, deck, {
      w: 14,
      d: 9,
      floors: [3.8, 3.4, 3.0],
      roofH: 4.4,
      overhang: 1.8,
      ridge: 0.5,
      pent: 1.4
    })
  )
  for (const s of [-1, 1]) {
    top = Math.max(
      top,
      addGallery(b, local(deck, s * 34.5, 0, 0), {
        w: 10,
        d: 9,
        floors: [3.8, 3.4, 3.0],
        roofH: 3.9,
        overhang: 1.6,
        ridge: 0.45,
        pent: 1.3
      })
    )
    addGallery(b, local(deck, s * 18.75, 0, 0), {
      w: 25.5,
      d: 7,
      floors: [3.8, 3.2],
      roofH: 2.9,
      overhang: 1.3,
      ridge: 0.85,
      pent: 1.1
    })
  }
  return H + top
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
  const pavTop = buildPavilion(b, fp)
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
  const PAV_TREES = [
    [-15, -4, 3.8],
    [-12, -15, 4.2],
    [-6, -20, 3.6],
    [-22, -12, 4.5]
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

  const zones = [
    rectPolygon(pav.x, pav.z, TERRACE.w + 6, TERRACE.d + 12, pav.bearing),
    rectPolygon(bx, bz, BRIDGE_LEN + 2 * RAMP.len + 4, 18, br.bearing),
    ...neighbourZones
  ]

  return {
    meshes,
    zones,
    markerHeight: pavTop,
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

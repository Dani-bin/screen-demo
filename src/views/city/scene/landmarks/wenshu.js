/*
 * 文殊院精细模型：中轴殿堂 + 文殊阁 + 千佛和平塔 + 赭黄院墙 + 院内古树
 * ----------------------------------------------------------
 * 寺院中轴约 37°（从山门指向文殊阁），山门朝西南。
 * 各殿按 OSM 名称就近查楼（重名很多，一律以站点为中心、400 m 内取最近），
 * 用最小外接矩形定位、定朝向；查不到时退回下方 FALLBACK 里记录的轮廓。
 *
 * 为方便布置院墙、铺装与树，另建一个「中轴坐标系」：
 *   原点在山门中心，u 沿中轴指向文殊阁，v 垂直中轴指向东南（中轴方位 + 90°）；
 *   对应 frame(山门, 中轴方位) 的局部坐标 x = v、z = -u（局部 +Z 即西南正面）。
 * 院墙范围按 OSM 数据定：前墙过山门中线，东墙让开东侧小路，
 * 西墙包住西侧僧寮，北墙在院内最北的楼之后，西北角斜切让开院外的通用高楼。
 * 院内其余 OSM 楼（僧寮、廊房、客堂等）一律改成灰瓦坡顶的寺院附属房；
 * 跨在院墙上的低层楼也一并替换，院墙在它们处断开、由房子本身接上。
 *
 * 另返回 walkways（步行路径，人群系统到站时在上面生成行人）：
 * 中轴甬道（被殿身与踏步分成几段）、东院（玉佛殿、祖堂、三圣殿围合的小院）环路、
 * 东侧空院环路、千佛和平塔塔周路（放大后的石台外）。
 */
import { FrontSide, Mesh } from "three"
import { ColorBuilder, frame, landmarkMaterial, local } from "./kit/builder.js"
import {
  bearingDiff,
  buildingsInZones,
  distToSegment,
  findBuilding,
  minAreaRect,
  polygonArea,
  rectFrame,
  rectPolygon
} from "./kit/footprint.js"
import {
  box,
  cylinder,
  fromTriangles,
  polygonVertex,
  prism,
  sphere
} from "./kit/shapes.js"
import { gableRoof, hipRidges, hipRoof, roofHeight } from "./kit/roofs.js"
import {
  addBalustrade,
  addColumns,
  addHall,
  addPagoda,
  addPitchedHouse,
  addPlatform,
  clamp,
  eaveDrop
} from "./kit/parts.js"
import { addTree } from "./kit/figures.js"
import { mulberry32, pointInPolygon } from "../utils.js"

const DEG = Math.PI / 180
// 按名称查楼的搜索半径（米）
const NEAR = 400
// 院内铺装顶面高度：盖住道路面（道路最高 0.9 m）
const PAVE = 1.0
// 院墙：墙身高（铺装面以上）、厚；俯视时院墙是最显眼的轮廓线，比真实略高略厚
const WALL_H = 6.5
const WALL_T = 1.6
// 中轴方位缺省值（山门或文殊阁查不到时用）
const AXIS_BEARING = 37.4
// 院墙范围（中轴坐标系，米）：u 从山门中线到文殊阁后（u1 运行时改为院内楼最北端 + 1.5），
// v 从西侧僧寮外到东侧小路内
const COMPOUND = { u0: 0, u1: 216, v0: -56, v1: 112 }
// 西北角斜切：院外 #7520（31 m 通用楼）西侧斜边伸进院角，斜切线与该斜边平行、
// 相距约 3 m，从西墙 (u0, v0) 斜到 (u1, v) 后接北墙
const CHAMFER = { u0: 206, u1: 218, v: 2.5 }
// 跨在院墙上、需一并替换成附属房的楼：高度上限（更高的留给通用层）
const STRADDLE_MAX_H = 20
// 千佛和平塔插画式放大倍数（真实通高 21 m；放大后约 29 m，为院内最高，远景可辨）
const PAGODA_SCALE = 1.4
// 山门前的前院铺装（盖住山门台阶与两侧附属房的前半截）
const FORECOURT = { u0: -10.5, v0: -40, v1: 34 }

/*
 * 步行路径（人群用，见 crowd.js）。坐标为中轴坐标 (u, v)，按当前 OSM 数据逐点核对过：
 * 不进殿、附属房、树下草地与塔台，离墙、柱、栏杆 ≥ 0.5 m（小人身体半径约 0.6 m）。
 */
// 中轴甬道：顶面 = 铺装 + 0.15；各殿（含前后踏步）两端再留 0.9 m，
// 余下长度 ≥ 5 m 的空当各成一段（走到端点折返）
const AXIS_WALK = { margin: 0.9, minLen: 5, width: 4, density: 3 }
// 东院：玉佛殿、祖堂与南面三圣殿围出的小院（u 95～111、v 49～71），院内一圈圆角环路
const EAST_COURT = { u0: 97.4, u1: 109, v0: 51.4, v1: 68.4, r: 3, density: 3 }
// 东侧空院：祖堂以东、文殊阁以南的大片铺装院（院中两棵古树被环路围住），圆角环路
const EAST_YARD = { u0: 131, u1: 186, v0: 48, v1: 86, r: 7, density: 3.5 }
// 塔周路：塔心半径 11 m 的圆弧（石台放大后外接半径 9.1 m）。塔台南侧（+v）紧贴一栋
// 廊房，无法绕满一圈，圆弧从廊房东端绕过塔的北、西、南（正面踏步）到廊房西端，
// 两端折返；角度从 +u 起、向 +v 量（度）
const PAGODA_WALK = { r: 11, from: 140, to: 395, step: 15, density: 3.5 }
const WALK_W = 1.4 // 环路、塔周路的可走宽度

// 本景点专用色（kit 配色表里没有的）：
// 院内红砂石铺地（照片里院子是偏红的砂石板）、文殊阁额枋青绿彩画、树下草地
const PAVE_COLOR = "#CDB29C"
const TEAL = "#3F8F87"
const LAWN = "#8CC45E"

/*
 * 中轴殿堂与钟鼓楼。fb 为 OSM 查不到时的回退轮廓：[经度, 纬度, 长, 宽, 长边方位]
 * （取自当前 OSM 数据的最小外接矩形）。side 为 true 的殿长边平行中轴，
 * 位于东院两侧、面向东院中线（中轴方位 + 270°，即西北）。
 * 大雄宝殿：OSM 高 16.2 m，历史资料殿身高 10.56 m；这里台基 1.6 + 柱高 9 ≈ 10.6 m，
 * 加屋顶后总高约 16.5 m，与 OSM 一致。
 */
const HALLS = [
  {
    // 照片 ws_9366：山门为单檐悬山顶
    name: "山门（天王殿）",
    fb: [104.06948, 30.67718, 16.5, 11.6, 127],
    wallH: 5.2,
    roof: "gable",
    steps: "both"
  },
  {
    name: "三大士殿",
    fb: [104.06968, 30.67736, 23.0, 14.8, 128],
    wallH: 6,
    steps: "both"
  },
  {
    name: "大雄宝殿",
    fb: [104.06987, 30.67757, 23.3, 18.4, 127],
    platformH: 1.6,
    wallH: 9,
    roofH: 5.6,
    steps: "both",
    main: true
  },
  {
    name: "说法堂",
    fb: [104.07005, 30.67778, 20.7, 18.5, 126],
    wallH: 5.5,
    steps: "both"
  },
  {
    name: "藏经楼",
    fb: [104.07027, 30.67806, 29.8, 24.9, 128],
    platformH: 1.5,
    wallH: 7.5
  },
  { name: "玉佛殿", fb: [104.07053, 30.67747, 21.9, 13.8, 125], wallH: 5.5 },
  {
    name: "圆通殿",
    fb: [104.07063, 30.67729, 22.4, 16.6, 34],
    wallH: 5.5,
    side: true
  },
  { name: "祖堂", fb: [104.07072, 30.67772, 22.0, 13.8, 125], wallH: 5 },
  {
    name: "三圣殿",
    fb: [104.07083, 30.67753, 27.2, 13.7, 35],
    wallH: 5.5,
    side: true
  },
  {
    name: "钟楼",
    fb: [104.06974, 30.67714, 10.7, 8.9, 130],
    wallH: 4.5,
    double: true
  },
  {
    name: "鼓楼",
    fb: [104.06946, 30.67733, 10.7, 8.9, 127],
    wallH: 4.5,
    double: true
  }
]
const SHANMEN = "山门（天王殿）"
const WENSHU_GE = { name: "文殊阁", fb: [104.07072, 30.67858, 50.8, 24.6, 117] }
// 千佛和平塔 OSM 点位
const PAGODA = { name: "千佛和平塔", lon: 104.07025, lat: 30.6771 }

/* ---------------- 轮廓查找 ---------------- */

/**
 * 按名称就近查楼并取最小外接矩形；查不到时按回退轮廓建矩形。
 * @returns {{ rect, index: number, points: Array|null }}
 */
function locate(ctx, name, fb) {
  const { buildings, spot, project } = ctx
  const i = findBuilding(buildings, name, {
    near: [spot.x, spot.z],
    maxDist: NEAR
  })
  if (i >= 0) {
    const points = buildings[i].p
    return { rect: minAreaRect(points), index: i, points }
  }
  const [cx, cz] = project.toLocal(fb[0], fb[1])
  return {
    rect: { cx, cz, w: fb[2], d: fb[3], bearing: fb[4] },
    index: -1,
    points: null
  }
}

/* ---------------- 文殊阁：三层重檐楼阁 ---------------- */

/**
 * 多层重檐楼阁：台基 + 首层檐柱 + 每层一圈截断腰檐（四角起翘），逐层略收，
 * 顶层完整歇山顶。每层檐下一道青绿彩画额枋、正背面一道花格门窗色带，
 * 二、三层正面立一排红柱（檐廊）。
 * @param {object} o { w, d, platformH, stories: 各层露出高度数组 }
 * @returns {number} 整体高度（局部坐标）
 */
function addLouge(b, parent, L, o) {
  const { w, d, platformH = 1.5, stories = [5.6, 3.9, 3.6] } = o
  const curl = 0.38
  const ridge = 0.6
  // 截断位置：0.36 时上层比下层每边收进约 1.5 m，远看是层层叠起的腰檐
  const tMax = 0.36
  addPlatform(b, parent, { w, d, h: platformH, steps: "front" })
  const inset = clamp(0.1 * Math.min(w, d), 0.5, 1.5)
  let cw = w - 2 * inset
  let cd = d - 2 * inset
  // y：本层可见地面；base：本层墙体实际起点（上层墙下半截藏在下层檐下）
  let y = platformH
  let base = platformH
  let top = 0
  stories.forEach((h, i) => {
    const last = i === stories.length - 1
    top = y + h
    if (i === 0) {
      // 首层：檐柱一周 + 内缩墙体 + 正面整面花格门窗
      addColumns(b, parent, { w: cw, d: cd, h, y, spacing: 3.6 })
      const ww = cw - 1.6
      const wd = cd - 1.6
      b.add(box(ww, h, wd), L.redWall, local(parent, 0, y, 0))
      b.add(
        box(ww * 0.9, h * 0.7, 0.1),
        L.lattice,
        local(parent, 0, y, wd / 2 + 0.05)
      )
    } else {
      // 上层：红木墙体（从下层柱顶起）+ 正背面花格门窗 + 正面檐廊红柱
      b.add(box(cw, top - base, cd), L.column, local(parent, 0, base, 0))
      for (const sz of [-1, 1]) {
        b.add(
          box(cw * 0.9, h * 0.62, 0.1),
          L.lattice,
          local(parent, 0, y + 0.3, sz * (cd / 2 + 0.05))
        )
      }
      const n = Math.max(2, Math.round(cw / 4.5))
      for (let k = 0; k <= n; k++) {
        const x = -cw / 2 + (k * cw) / n
        b.add(
          cylinder(0.3, 0.27, h),
          L.column,
          local(parent, x, y, cd / 2 + 0.45)
        )
      }
    }
    // 檐下青绿彩画额枋（一圈），高 0.7 m
    const bh = 0.7
    for (const sz of [-1, 1]) {
      b.add(
        box(cw + 1.1, bh, 0.25),
        TEAL,
        local(parent, 0, top - bh, sz * (cd / 2 + 0.55))
      )
    }
    for (const sx of [-1, 1]) {
      b.add(
        box(0.25, bh, cd + 1.1),
        TEAL,
        local(parent, sx * (cw / 2 + 0.55), top - bh, 0)
      )
    }

    const roofH = cd * (last ? 0.3 : 0.4)
    const ov = clamp(0.16 * cd, 0.8, 3)
    const ro = { overhang: ov, curl, ridge, ridges: false }
    const yr = top - eaveDrop(cd / 2, ov, roofH, 1.5, 0.5)
    const m = local(parent, 0, yr, 0)
    if (last) {
      b.add(hipRoof(cw, cd, roofH, ro), L.roof, m)
      const rg = hipRidges(cw, cd, roofH, ro)
      rg.computeBoundingBox()
      top = yr + rg.boundingBox.max.y
      b.add(rg, L.roofRidge, m)
      return
    }
    // 腰檐：截断成一圈；下一层的柱网取檐内缘（再外扩 0.2 m 盖住缝）
    const lower = { ...ro, tMax }
    b.add(hipRoof(cw, cd, roofH, lower), L.roof, m)
    b.add(hipRidges(cw, cd, roofH, lower), L.roofRidge, m)
    const ex = cw / 2 + ov
    const ez = cd / 2 + ov
    const hx = ex * (1 - tMax) + ((ridge * cw) / 2) * tMax
    const hz = ez * (1 - tMax)
    base = top
    y = yr + roofHeight(0, tMax, roofH, 0)
    cw = 2 * hx + 0.4
    cd = 2 * hz + 0.4
  })
  return top
}

/* ---------------- 千佛和平塔 ---------------- */

/**
 * 千佛和平塔：六角石台（前面开口、一圈石栏）+ 雕花须弥座 + 两圈莲瓣的莲花座
 * + 六角十一层塔（暗红塔身嵌金色佛像、铸铁翘檐、贴金塔刹）。
 * parent 的 +Z 为正面（西南）。局部总高 21 m（真实通高），放置时整体放大见 PAGODA_SCALE。
 * @returns {number} 塔刹尖高度（局部坐标）
 */
function addPeacePagoda(b, parent, L) {
  const total = 21
  // 六角石台
  const tr = 6.5
  const th = 0.9
  b.add(prism(6, tr, tr, th), L.granite, parent)
  // 正面两级踏步（边 5 正对 +Z，边心距 = r·cos30°）
  const ap = tr * Math.cos(Math.PI / 6)
  b.add(box(3, th * 0.66, 0.5), L.granite, local(parent, 0, 0, ap + 0.25))
  b.add(box(3, th * 0.33, 0.5), L.granite, local(parent, 0, 0, ap + 0.75))
  // 石栏：沿台边一周，正面那条边（边 5：顶点 5 → 0）留口
  const pts = Array.from({ length: 6 }, (_, k) => polygonVertex(6, 6.1, k))
  addBalustrade(b, parent, {
    points: pts,
    closed: false,
    h: 1.0,
    y: th,
    postSpacing: 1.7,
    color: L.marble
  })
  // 须弥座：略收分的六角石座 + 顶部一圈压面石；中间一道凸出的深色束腰表示雕花带
  const py = th
  b.add(prism(6, 3.7, 3.5, 1.6), L.granite, local(parent, 0, py, 0))
  b.add(prism(6, 3.72, 3.72, 0.5), L.brick, local(parent, 0, py + 0.55, 0))
  b.add(prism(6, 3.95, 3.95, 0.22), L.marble, local(parent, 0, py + 1.6, 0))
  // 莲花座：实心座身 + 外圈 12 瓣、内圈 10 瓣（压扁的球），照片里是一圈圈鼓起的莲瓣
  const ly = py + 1.82
  b.add(
    cylinder(2.7, 2.3, 1.2, { segments: 12, caps: true }),
    L.marble,
    local(parent, 0, ly, 0)
  )
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2
    b.add(
      sphere(0.85, 6, 4),
      L.marble,
      local(parent, 2.75 * Math.sin(a), ly - 0.1, 2.75 * Math.cos(a), a, 1, 0.8)
    )
  }
  for (let k = 0; k < 10; k++) {
    const a = ((k + 0.5) / 10) * Math.PI * 2
    b.add(
      sphere(0.7, 6, 4),
      L.marble,
      local(parent, 2.1 * Math.sin(a), ly + 0.6, 2.1 * Math.cos(a), a, 1, 0.8)
    )
  }
  // 塔身从莲花座顶的托盘起
  const sy = ly + 1.5
  b.add(
    cylinder(2.0, 1.9, 0.25, { segments: 12, caps: true }),
    L.marble,
    local(parent, 0, sy - 0.2, 0)
  )
  const top = addPagoda(b, local(parent, 0, sy, 0), {
    sides: 6,
    tiers: 11,
    height: total - sy,
    baseRadius: 1.6,
    topRadius: 0.95
  })
  return sy + top
}

/* ---------------- 院墙 ---------------- */

/**
 * 一段院墙：赭黄墙身 + 灰瓦墙帽（小双坡顶），从 (x0, z0) 到 (x1, z1)（parent 局部坐标）。
 * 墙身从地面起（院墙跨在铺装边缘上，下面不能留缝）。
 */
function addWallRun(b, parent, L, x0, z0, x1, z1) {
  const len = Math.hypot(x1 - x0, z1 - z0)
  if (len < 0.5) return
  // 局部 X 沿墙：绕 Y 转 θ 后 (1,0,0) → (cos θ, 0, -sin θ)
  const yaw = Math.atan2(-(z1 - z0), x1 - x0)
  const m = local(parent, (x0 + x1) / 2, 0, (z0 + z1) / 2, yaw)
  const h = PAVE + WALL_H
  b.add(box(len, h, WALL_T), L.ochreWall, m)
  // 墙脚一道浅灰勒脚：只高出院外地面 0.6 m，赭黄墙面尽量多露出来
  b.add(box(len + 0.02, 0.6, WALL_T + 0.06), L.granite, m)
  const cap = { overhang: 0.2, segS: 2, segT: 2 }
  b.add(gableRoof(len, WALL_T, 0.45, cap), L.roof, local(m, 0, h, 0))
}

/* ---------------- 树 ---------------- */

/**
 * 在院内空地撒树：按网格取候选点，只留院墙折线内、离墙 ≥ 6 m 的点，
 * 避开所有楼（外接矩形外扩树冠半径）、塔台与中轴甬道，再按最小间距挑出至多 maxN 棵。
 * @param {Array<[number, number]>} poly 院墙折线（中轴坐标 [u, v]）
 * @param {Array} obstacles [{ cx, cz, w, d, bearing }] 世界坐标矩形
 * @param {number} pagodaR 塔台避让半径（米）
 * @returns {Array<{ x, z, r, trunk, color }>}
 */
function scatterTrees(axis, poly, obstacles, pagodaPos, pagodaR, greens, maxN) {
  const rand = mulberry32(5105)
  const cands = []
  const us = poly.map((p) => p[0])
  const vs = poly.map((p) => p[1])
  const [uMin, uMax] = [Math.min(...us), Math.max(...us)]
  const [vMin, vMax] = [Math.min(...vs), Math.max(...vs)]
  for (let u = uMin + 6; u <= uMax - 6; u += 5) {
    for (let v = vMin + 6; v <= vMax - 6; v += 5) {
      // 中轴甬道两侧 12 m 内不种树（保持轴线殿堂一眼可见）
      if (Math.abs(v) < 12) continue
      const r = 4.2 + rand() * 2.2
      const ju = u + (rand() - 0.5) * 3
      const jv = v + (rand() - 0.5) * 3
      // 必须在院墙折线内，且离每段墙 ≥ 6 m（西北斜切角也不越墙）
      if (!pointInPolygon(ju, jv, poly)) continue
      const nearWall = poly.some(
        (p, i) => distToSegment(ju, jv, p, poly[(i + 1) % poly.length]) < 6
      )
      if (nearWall) continue
      const [x, z] = axis.toWorld(ju, jv)
      if (Math.hypot(x - pagodaPos[0], z - pagodaPos[1]) < pagodaR + r) continue
      const blocked = obstacles.some((o) => {
        const b = o.bearing * DEG
        const dx = x - o.cx
        const dz = z - o.cz
        // 投影到矩形长边（bearing 方向）与短边
        const pu = dx * Math.sin(b) - dz * Math.cos(b)
        const pv = dx * Math.cos(b) + dz * Math.sin(b)
        const out = Math.max(Math.abs(pu) - o.w / 2, Math.abs(pv) - o.d / 2)
        return out < r * 0.75 + 1
      })
      if (!blocked) cands.push({ x, z, r, key: rand() })
    }
  }
  cands.sort((a, c) => a.key - c.key)
  const picked = []
  for (const c of cands) {
    if (picked.length >= maxN) break
    if (picked.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 15)) continue
    picked.push({
      ...c,
      trunk: 5 + rand() * 2.5,
      color: greens[Math.floor(rand() * greens.length)]
    })
  }
  return picked
}

/** 一棵低多边形大树：树下圆形草地（加进地面批 gb）+ kit 的低多边形树（树冠略拉高） */
function addBigTree(b, gb, t, trunkColor) {
  gb.add(prism(8, t.r * 0.9, t.r * 0.9, 0.15), LAWN, frame(t.x, PAVE, t.z))
  addTree(b, t.x, PAVE, t.z, {
    r: t.r,
    // 树冠中心在铺装以上 t.trunk + 0.9 r（与原先一致）
    trunkH: t.trunk - 0.05 * t.r,
    trunkR: 0.55,
    trunkColor,
    color: t.color,
    yaw: t.key * Math.PI * 2
  })
}

/* ---------------- 院落辅助 ---------------- */

/**
 * 水平多边形面（只有朝上的顶面），高 y；points 为 parent 局部 [x, z]。
 * 以顶点平均点为扇心三角化（院墙折线是星形多边形，扇形剖分不会越界）。
 */
function flatPolygon(points, y) {
  const n = points.length
  const cx = points.reduce((a, p) => a + p[0], 0) / n
  const cz = points.reduce((a, p) => a + p[1], 0) / n
  const pos = []
  for (let i = 0; i < n; i++) {
    const [x0, z0] = points[i]
    const [x1, z1] = points[(i + 1) % n]
    // 从上往下看（-Y 方向）逆时针 = 法线朝上：叉积 y 分量 > 0 时交换顶点顺序
    const cross = (x0 - cx) * (z1 - cz) - (z0 - cz) * (x1 - cx)
    if (cross > 0) pos.push(cx, y, cz, x1, y, z1, x0, y, z0)
    else pos.push(cx, y, cz, x0, y, z0, x1, y, z1)
  }
  return fromTriangles(pos)
}

/**
 * 合并首尾相接的同向附属房：方位差 ≤ 3°、横向错位 ≤ 2.5 m、进深差 ≤ 3 m、
 * 两端间隙 < 1.5 m 的两块矩形合成一块（OSM 常把一排连续的廊房切成几段，
 * 分开盖顶会出现一串山墙缺口）。
 * @param {Array<{ rect }>} items
 * @returns {Array<{ rect, merged: boolean }>}
 */
function mergeRuns(items) {
  const list = items.map((it) => ({ ...it, merged: false }))
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i].rect
        const b = list[j].rect
        if (bearingDiff(a.bearing, b.bearing, 180) > 3) continue
        if (Math.abs(a.d - b.d) > 3) continue
        const br = a.bearing * DEG
        const ux = Math.sin(br)
        const uz = -Math.cos(br)
        const dx = b.cx - a.cx
        const dz = b.cz - a.cz
        const along = dx * ux + dz * uz
        const lateral = -dx * uz + dz * ux
        if (Math.abs(lateral) > 2.5) continue
        if (Math.abs(along) - (a.w + b.w) / 2 >= 1.5) continue
        // 合并：沿长边取两者的并，横向取两者的并
        const lo = Math.min(-a.w / 2, along - b.w / 2)
        const hi = Math.max(a.w / 2, along + b.w / 2)
        const lLo = Math.min(-a.d / 2, lateral - b.d / 2)
        const lHi = Math.max(a.d / 2, lateral + b.d / 2)
        const mA = (lo + hi) / 2
        const mL = (lLo + lHi) / 2
        list[i] = {
          rect: {
            cx: a.cx + mA * ux - mL * uz,
            cz: a.cz + mA * uz + mL * ux,
            w: hi - lo,
            d: lHi - lLo,
            bearing: a.bearing
          },
          merged: true
        }
        list.splice(j, 1)
        changed = true
        break outer
      }
    }
  }
  return list
}

/**
 * 院墙段在建筑处断开：polygons 里跨过这段墙线（两侧各伸出 0.3 m 以上）的轮廓，
 * 按其沿墙方向的投影范围（两端各内缩 0.3 m，墙头藏进房子墙里）挖掉。
 * @param {[number, number]} a 墙段起点（中轴坐标 [u, v]）
 * @param {[number, number]} b 墙段终点
 * @param {Array<Array<[number, number]>>} polygons 中轴坐标轮廓
 * @returns {Array<[number, number]>} 保留的区间 [t0, t1]（沿墙距离，米）
 */
function wallPieces(a, b, polygons) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const tu = (b[0] - a[0]) / len
  const tv = (b[1] - a[1]) / len
  const gaps = []
  for (const poly of polygons) {
    const t = poly.map(([u, v]) => (u - a[0]) * tu + (v - a[1]) * tv)
    const n = poly.map(([u, v]) => -(u - a[0]) * tv + (v - a[1]) * tu)
    if (Math.min(...n) > -0.3 || Math.max(...n) < 0.3) continue
    const g0 = Math.max(0, Math.min(...t) + 0.3)
    const g1 = Math.min(len, Math.max(...t) - 0.3)
    if (g1 > g0) gaps.push([g0, g1])
  }
  gaps.sort((p, q) => p[0] - q[0])
  const out = []
  let t = 0
  for (const [g0, g1] of gaps) {
    if (g0 > t) out.push([t, g0])
    t = Math.max(t, g1)
  }
  if (t < len) out.push([t, len])
  return out
}

/* ---------------- 步行路径 ---------------- */

/**
 * 圆角矩形环路（中轴坐标）：四角各用 4 段圆弧（每段转 22.5°），不出现急转。
 * @returns {Array<[number, number]>} 闭合折线顶点 [u, v]（首尾不重复）
 */
function roundedLoop({ u0, u1, v0, v1, r }) {
  const pts = []
  // 四个圆角的圆心与起始角（角度从 +u 向 +v 量），逆 u→v 方向依次绕行
  const corners = [
    [u1 - r, v0 + r, -90],
    [u1 - r, v1 - r, 0],
    [u0 + r, v1 - r, 90],
    [u0 + r, v0 + r, 180]
  ]
  for (const [cu, cv, a0] of corners) {
    for (let k = 0; k <= 4; k++) {
      const a = ((a0 + k * 22.5) * Math.PI) / 180
      pts.push([cu + r * Math.cos(a), cv + r * Math.sin(a)])
    }
  }
  return pts
}

/**
 * 中轴甬道分段：从甬道全长里扣掉各殿（含踏步）占去的区间，余下的空当即步行段。
 * @param {Array<[number, number]>} blocked 各殿占去的 [u 起, u 止]
 * @param {number} u0 甬道起点
 * @param {number} u1 甬道终点
 * @returns {Array<[number, number]>} 步行段 [u 起, u 止]
 */
function axisGaps(blocked, u0, u1) {
  const spans = blocked
    .map(([a, e]) => [a - AXIS_WALK.margin, e + AXIS_WALK.margin])
    .sort((p, q) => p[0] - q[0])
  const out = []
  let t = u0
  for (const [a, e] of spans) {
    if (a - t >= AXIS_WALK.minLen) out.push([t, a])
    t = Math.max(t, e)
  }
  if (u1 - t >= AXIS_WALK.minLen) out.push([t, u1])
  return out
}

/** addPlatform 的踏步水平长度（级数 round(h / 0.3)，踏步深 0.35，见 parts.js） */
function stepRun(h) {
  return (Math.max(1, Math.round(h / 0.3)) - 1) * 0.35
}

/* ---------------- 主函数 ---------------- */

/**
 * @param {{ project, buildings, theme, spot }} ctx
 * @returns {{ meshes: Mesh[], zones: Array, markerHeight: number }}
 */
export function build(ctx) {
  const { buildings, theme } = ctx
  const L = theme.landmark
  const b = new ColorBuilder()
  // 地面批：大片水平铺装、甬道、草地单独成一个 Mesh（单面材质），
  // 阴影贴图里不画它的朝天面，避免大平面自阴影出现波纹（shadow acne）
  const gb = new ColorBuilder()
  const used = new Set()
  const obstacles = []
  // 已建成的楼（中轴坐标轮廓），院墙在它们处断开
  const builtPolys = []

  // 中轴坐标系：山门中心为原点，方位取山门 → 文殊阁
  const shanHall = HALLS.find((h) => h.name === SHANMEN)
  const shan = locate(ctx, SHANMEN, shanHall.fb)
  const ge = locate(ctx, WENSHU_GE.name, WENSHU_GE.fb)
  const ox = shan.rect.cx
  const oz = shan.rect.cz
  let axisBearing = Math.atan2(ge.rect.cx - ox, -(ge.rect.cz - oz)) / DEG
  if (!Number.isFinite(axisBearing)) axisBearing = AXIS_BEARING
  const ab = axisBearing * DEG
  const axis = {
    frame: frame(ox, 0, oz, axisBearing),
    // 中轴坐标 (u, v) → 世界 [x, z]
    toWorld: (u, v) => [
      ox + u * Math.sin(ab) + v * Math.cos(ab),
      oz - u * Math.cos(ab) + v * Math.sin(ab)
    ],
    // 世界 [x, z] → 中轴坐标 [u, v]
    toAxis: (x, z) => [
      (x - ox) * Math.sin(ab) - (z - oz) * Math.cos(ab),
      (x - ox) * Math.cos(ab) + (z - oz) * Math.sin(ab)
    ]
  }
  const front = axisBearing + 180
  const A = axis.frame
  const toAxisPoly = (pts) => pts.map(([x, z]) => axis.toAxis(x, z))
  const rectPts = (r) => rectPolygon(r.cx, r.cz, r.w, r.d, r.bearing)

  /* ---- 院墙折线与替换区 ---- */
  const c = { ...COMPOUND }
  // 院墙折线（中轴坐标 [u, v]）：西墙 → 西北斜切 → 北墙 → 东墙 → 前墙
  const outline = () => [
    [c.u0, c.v0],
    [CHAMFER.u0, c.v0],
    [CHAMFER.u1, CHAMFER.v],
    [c.u1, CHAMFER.v],
    [c.u1, c.v1],
    [c.u0, c.v1]
  ]
  const worldPoly = (uv) => uv.map(([u, v]) => axis.toWorld(u, v))
  const zoneRect = (u0, u1, v0, v1) => {
    const [cx, cz] = axis.toWorld((u0 + u1) / 2, (v0 + v1) / 2)
    return rectPolygon(cx, cz, u1 - u0, v1 - v0, axisBearing)
  }
  const forecourtZone = zoneRect(
    FORECOURT.u0,
    c.u0 + 0.5,
    FORECOURT.v0,
    FORECOURT.v1
  )
  // 北墙：取院内被替换的楼最北端 + 1.5 m（不让任何一栋伸出墙外）
  const inside = buildingsInZones(buildings, [worldPoly(outline())])
  let maxU = -Infinity
  for (const i of inside) {
    for (const [u] of toAxisPoly(buildings[i].p)) maxU = Math.max(maxU, u)
  }
  if (Number.isFinite(maxU)) c.u1 = Math.max(CHAMFER.u1 + 1, maxU + 1.5)
  const poly = outline()
  const zones = [worldPoly(poly), forecourtZone]
  // 跨在四面直墙上的低层楼（如东墙上的 #1682）：单独加一个替换区，改建成附属房
  const straightRuns = [
    [poly[0], poly[1]],
    [poly[3], poly[4]],
    [poly[4], poly[5]],
    [poly[5], poly[0]]
  ]
  buildings.forEach((bd) => {
    if (!bd.p || bd.p.length < 3 || (bd.h || 0) > STRADDLE_MAX_H) return
    // 先按距山门的距离粗筛（院子对角线约 300 m）
    if (Math.hypot(bd.p[0][0] - ox, bd.p[0][1] - oz) > 400) return
    const uv = toAxisPoly(bd.p)
    const cu = uv.reduce((s0, p) => s0 + p[0], 0) / uv.length
    const cv = uv.reduce((s0, p) => s0 + p[1], 0) / uv.length
    if (pointInPolygon(cu, cv, poly)) return
    // 山门前院里的（#394、#1662）已由前院替换区覆盖
    const inFore =
      cu > FORECOURT.u0 &&
      cu < c.u0 + 0.5 &&
      cv > FORECOURT.v0 &&
      cv < FORECOURT.v1
    if (inFore) return
    const cross = straightRuns.some(([a, e]) => {
      const vertical = Math.abs(a[1] - e[1]) < 1e-6
      // 沿墙坐标与垂直墙坐标
      const k = vertical ? 1 : 0
      const line = vertical ? a[1] : a[0]
      const lo = Math.min(a[1 - k], e[1 - k])
      const hi = Math.max(a[1 - k], e[1 - k])
      const across = uv.map((p) => p[k] - line)
      const alongC = vertical ? cu : cv
      return (
        Math.min(...across) < -0.3 &&
        Math.max(...across) > 0.3 &&
        alongC > lo &&
        alongC < hi
      )
    })
    if (cross) {
      const r = minAreaRect(bd.p)
      zones.push(rectPolygon(r.cx, r.cz, r.w + 1, r.d + 1, r.bearing))
    }
  })

  /* ---- 铺装：院内红砂石 + 中轴甬道 + 山门前院 ---- */
  gb.add(
    flatPolygon(
      poly.map(([u, v]) => [v, -u]),
      PAVE
    ),
    PAVE_COLOR,
    A
  )
  gb.add(
    box(FORECOURT.v1 - FORECOURT.v0, PAVE, -FORECOURT.u0 + 1),
    PAVE_COLOR,
    local(A, (FORECOURT.v0 + FORECOURT.v1) / 2, 0, (-FORECOURT.u0 - 1) / 2)
  )
  // 中轴甬道：高出铺装 0.15 m（贴面离底面过近会闪烁）
  const pathEnd = CHAMFER.u0 - 2
  gb.add(
    box(7, 0.15, pathEnd - FORECOURT.u0 - 1),
    L.granite,
    local(A, 0, PAVE, -(pathEnd + FORECOURT.u0 + 1) / 2)
  )

  /* ---- 中轴殿堂、东院殿堂、钟鼓楼 ---- */
  let markerHeight = 0
  // 压在中轴甬道上的殿（含前后踏步）沿中轴占去的区间，供步行路径分段
  const axisBlocked = []
  // 殿轮廓投影到中轴坐标；轮廓跨过中轴线（v 范围含 0）即压在甬道上。
  // 前踏步在 -u 一侧（殿正面朝山门），steps 为 both 时后踏步在 +u 一侧
  const blockAxis = (rect, platformH, steps) => {
    const uv = toAxisPoly(rectPts(rect))
    const vs = uv.map((p) => p[1])
    if (Math.min(...vs) > -1 || Math.max(...vs) < 1) return
    const us = uv.map((p) => p[0])
    const run = stepRun(platformH)
    axisBlocked.push([
      Math.min(...us) - run,
      Math.max(...us) + (steps === "both" ? run : 0)
    ])
  }
  for (const hall of HALLS) {
    const loc = hall.name === SHANMEN ? shan : locate(ctx, hall.name, hall.fb)
    const { rect } = loc
    if (loc.index >= 0) used.add(loc.index)
    const fb = hall.side ? axisBearing + 270 : front
    const top = addHall(b, rectFrame(rect, PAVE, fb), {
      w: rect.w,
      d: rect.d,
      wallH: hall.wallH,
      platformH: hall.platformH ?? 1.2,
      roof: hall.roof ?? "hip",
      roofH: hall.roofH,
      double: hall.double,
      spacing: 4,
      steps: hall.steps ?? "front"
    })
    obstacles.push(rect)
    if (!hall.side) {
      blockAxis(rect, hall.platformH ?? 1.2, hall.steps ?? "front")
    }
    // 山门等跨墙的殿：院墙在其轮廓处断开
    builtPolys.push(toAxisPoly(loc.points ?? rectPts(rect)))
    if (hall.main) markerHeight = PAVE + top
  }

  /* ---- 文殊阁：三层重檐楼阁 ---- */
  if (ge.index >= 0) used.add(ge.index)
  addLouge(b, rectFrame(ge.rect, PAVE, front), L, {
    w: ge.rect.w,
    d: ge.rect.d,
    platformH: 1.5
  })
  obstacles.push(ge.rect)
  blockAxis(ge.rect, 1.5, "front")

  /* ---- 千佛和平塔（插画式放大，真实通高 21 m） ---- */
  const pi = findBuilding(buildings, PAGODA.name, {
    near: [ctx.spot.x, ctx.spot.z],
    maxDist: NEAR
  })
  if (pi >= 0) used.add(pi)
  const pagodaPos = ctx.project.toLocal(PAGODA.lon, PAGODA.lat)
  const S = PAGODA_SCALE
  addPeacePagoda(
    b,
    local(
      frame(pagodaPos[0], PAVE, pagodaPos[1], axisBearing),
      0,
      0,
      0,
      0,
      S,
      S,
      S
    ),
    L
  )

  /* ---- 院内其余楼：灰瓦坡顶附属房 ---- */
  const rest = []
  for (const i of buildingsInZones(buildings, zones)) {
    if (used.has(i)) continue
    const pts = buildings[i].p
    const rect = minAreaRect(pts)
    // 近矩形的块才参与首尾合并；凹形轮廓交给 addPitchedHouse 自行切分
    const rectLike = polygonArea(pts) / (rect.w * rect.d) >= 0.85
    if (rectLike) rest.push({ rect, pts })
    else rest.push({ rect, pts, keep: true })
  }
  const houses = [
    ...rest.filter((h) => h.keep),
    ...mergeRuns(rest.filter((h) => !h.keep))
  ]
  for (const h of houses) {
    const { rect } = h
    // 合并过的用合并矩形做墙与屋顶；未合并的保留原轮廓
    const pts = h.merged || !h.pts ? rectPts(rect) : h.pts
    // 进深 < 6 m 的窄条（碑廊、连廊）做成低矮廊子；其余统一檐高 5 m
    // （OSM 高度多为错标，窄长廊房标到 20 多米）
    const narrow = rect.d < 6
    addPitchedHouse(b, pts, {
      eaveH: narrow ? 3.5 : 5,
      ridgeH: narrow ? 1.2 : clamp(0.28 * rect.d, 1.8, 3),
      overhang: 0.5,
      y: PAVE,
      rect: h.merged ? rect : undefined,
      // 附属房用更深的木色红，让中轴殿堂与塔更突出
      wallColor: L.lattice
    })
    obstacles.push(rect)
    builtPolys.push(toAxisPoly(pts))
  }

  /* ---- 院墙：沿折线一周，在山门、跨墙附属房处断开 ---- */
  // 中轴坐标 (u, v) → 轴坐标系局部 (x = v, z = -u)
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k]
    const e = poly[(k + 1) % poly.length]
    const len = Math.hypot(e[0] - a[0], e[1] - a[1])
    for (const [t0, t1] of wallPieces(a, e, builtPolys)) {
      const p0 = [
        a[0] + ((e[0] - a[0]) * t0) / len,
        a[1] + ((e[1] - a[1]) * t0) / len
      ]
      const p1 = [
        a[0] + ((e[0] - a[0]) * t1) / len,
        a[1] + ((e[1] - a[1]) * t1) / len
      ]
      addWallRun(b, A, L, p0[1], -p0[0], p1[1], -p1[0])
    }
  }

  /* ---- 院内古树 ---- */
  const trees = scatterTrees(
    axis,
    poly,
    obstacles,
    pagodaPos,
    9 * S,
    theme.tree.greens,
    18
  )
  for (const t of trees) addBigTree(b, gb, t, theme.tree.trunk)

  const meshes = []
  const g = b.bake()
  if (g) meshes.push(new Mesh(g, landmarkMaterial()))
  const gg = gb.bake()
  if (gg) {
    const mat = landmarkMaterial()
    mat.side = FrontSide
    meshes.push(new Mesh(gg, mat))
  }
  /* ---- 步行路径（世界坐标） ---- */
  const toWorldPts = (uv) => uv.map(([u, v]) => axis.toWorld(u, v))
  const walkways = []
  // 中轴甬道各段（甬道顶面比铺装高 0.15）
  for (const [u0, u1] of axisGaps(axisBlocked, FORECOURT.u0 + 1, pathEnd)) {
    walkways.push({
      points: toWorldPts([
        [u0, 0],
        [u1, 0]
      ]),
      y: PAVE + 0.15,
      width: AXIS_WALK.width,
      closed: false,
      density: AXIS_WALK.density
    })
  }
  // 东院环路、东侧空院环路（铺装面）
  for (const loop of [EAST_COURT, EAST_YARD]) {
    walkways.push({
      points: toWorldPts(roundedLoop(loop)),
      y: PAVE,
      width: WALK_W,
      closed: true,
      density: loop.density
    })
  }
  // 塔周路：圆弧（塔心在中轴坐标里的位置由世界坐标换算）
  const [pu, pv] = axis.toAxis(pagodaPos[0], pagodaPos[1])
  const arc = []
  const { r, from, to, step } = PAGODA_WALK
  for (let a = from; a <= to + 1e-6; a += step) {
    const t = (a * Math.PI) / 180
    arc.push([pu + r * Math.cos(t), pv + r * Math.sin(t)])
  }
  walkways.push({
    points: toWorldPts(arc),
    y: PAVE,
    width: WALK_W,
    closed: false,
    density: PAGODA_WALK.density
  })

  return { meshes, zones, markerHeight, walkways }
}

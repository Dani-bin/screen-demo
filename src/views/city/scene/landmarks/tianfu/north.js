/*
 * 天府广场 · 北侧组团：毛主席像、四川科技馆
 * ----------------------------------------------------------
 * 职责：道路以北、正南北布置的两处构件，以及科技馆前的南北轴线路径。定位依据（OpenStreetMap）：
 * - 毛主席像：building:part「毛主席像」（min_height 15.2、height 27.46，
 *   即台基 8.1 + 基座 7.1 + 像身 12.3），立在一座无名三级台基楼（h 15.1）上；
 * - 四川科技馆：tourism=museum 面（不是 building，几何数据里没有），包围盒 142 × 110，
 *   正门朝南；像在科技馆正门以南约 80 m（OSM 实测），并非紧贴门前。
 * 两者各用自己的 OSM 点位作原点（局部 X 东、Z 南、不旋转），不用广场局部系或设计系。
 * 本次拆分（Task 2）只搬家，几何与拆分前逐位一致。
 *
 * 后续任务：Task 7 按设计第 4 节、报告 2.2 与 6.8 重做本文件——毛主席像改深红台座、
 * 正面阶梯花坡与两侧草坡；科技馆改高度、去掉砖红塔楼，换成 10 根赭红柱、横梁与窗带。
 * 替换区跟着新轮廓改；南北轴线路径若受影响一并改。
 */
import { frame, local } from "../kit/builder.js"
import { rectPolygon } from "../kit/footprint.js"
import { box, cylinder, sphere } from "../kit/shapes.js"
import { addPlatform } from "../kit/parts.js"
import { GROUND_Y } from "../../terrain.js"
import { C, offsetPoints, strut } from "./site.js"

/* ---------------- 尺寸与定位 ---------------- */

// 毛主席像（OSM 点位）与三级台基（台基大小取像下那座无名台基楼的轮廓 76 × 56）
const STATUE = { lon: 104.0633079, lat: 30.6612661 }
const STATUE_TIERS = [
  [72, 52],
  [50, 36],
  [28, 20]
]
const TIER_H = 2.7 // 三级共 8.1
const PEDESTAL_H = 7.1

// 四川科技馆：OSM tourism=museum 面包围盒（142 × 110，正南北，正门朝南）
const SCIENCE = { lon: 104.0633057, lat: 30.6624898, w: 142.2, d: 110.3 }

// 科技馆前南北轴线（毛主席像北侧、科技馆正门以南的空地，直接露出 terrain 地面）：
// 由科技馆正门前 5 m 走到像的台基北沿外 7 m，x 相对像中心
const AXIS = { z0: -75, z1: -33, width: 8, density: 1.5, y: GROUND_Y }

/* ---------------- 毛主席像 ---------------- */

/**
 * 三级浅色台基（共 8.1 m）+ 红褐基座 7.1 m + 白色立像 12.3 m，面朝正南（局部 +Z）。
 * 立像用几个几何体组合：外扩的大衣下摆、身体、肩、头、上扬的右手、背在身后的左手。
 */
function buildStatue(b, f) {
  let y = 0
  STATUE_TIERS.forEach(([w, d], i) => {
    addPlatform(b, local(f, 0, y, 0), {
      w,
      d,
      h: TIER_H,
      steps: "front",
      color: C.tier
    })
    // 第一、二级台面南侧两块绿篱花坛
    if (i < 2) {
      const nw = STATUE_TIERS[i + 1][0]
      const bw = (w - nw) / 2 - 4
      for (const sx of [-1, 1]) {
        b.add(
          box(bw, 0.5, d * 0.4),
          C.lawn,
          local(f, sx * (nw / 2 + 2 + bw / 2), y + TIER_H, d * 0.18)
        )
      }
    }
    y += TIER_H
  })
  // 红褐基座：主体 + 顶部压檐
  b.add(box(8, PEDESTAL_H - 0.8, 8), C.pedestal, local(f, 0, y, 0))
  b.add(box(9, 0.8, 9), C.pedestal, local(f, 0, y + PEDESTAL_H - 0.8, 0))
  y += PEDESTAL_H

  // 立像（局部 +Z 为正面；面朝南时像的右手在局部 -X 一侧）
  const s = local(f, 0, y, 0)
  b.add(cylinder(1.75, 1.25, 4.4, { segments: 12, caps: true }), C.statue, s)
  b.add(
    cylinder(1.25, 1.1, 3.8, { segments: 12, caps: true }),
    C.statue,
    local(s, 0, 4.4, 0)
  )
  b.add(box(3.0, 0.9, 1.7), C.statue, local(s, 0, 7.6, 0))
  b.add(
    cylinder(0.42, 0.42, 0.6, { segments: 8, caps: true }),
    C.statue,
    local(s, 0, 8.4, 0)
  )
  b.add(sphere(0.72, 12, 9), C.statue, local(s, 0, 8.85, 0.05))
  // 右臂：肩 → 肘 → 上扬的手
  strut(b, s, [-1.35, 8.2, 0], [-2.05, 9.9, 0.7], 0.42, 0.36, C.statue)
  strut(b, s, [-2.05, 9.9, 0.7], [-2.2, 11.8, 1.0], 0.36, 0.3, C.statue)
  b.add(sphere(0.42, 8, 6), C.statue, local(s, -2.2, 11.5, 1.0))
  // 左臂：垂下背到身后
  strut(b, s, [1.35, 8.2, 0], [1.55, 5.6, -0.6], 0.42, 0.34, C.statue)
}

/* ---------------- 四川科技馆 ---------------- */

/**
 * 米黄墙、砖红线脚与转角塔楼、中部通高深色玻璃柱廊、楼顶红色招牌。
 * f 原点在 OSM 包围盒中心、局部 +Z 朝南（正门）。
 * 平面：前部 142 × 28 的正立面体量 + 后部 112 × 83 的主体（与 OSM 轮廓一致）。
 */
function buildScience(b, f) {
  const hd = SCIENCE.d / 2
  const z0 = hd - 28 // 前部体量北缘
  const z1 = hd // 正立面
  const dz = z1 - z0
  const zc = (z0 + z1) / 2
  // 后部主体与屋面
  b.add(box(112, 27, z0 + hd), C.sciWall, local(f, 0, 0, (z0 - hd) / 2))
  b.add(box(108, 0.8, z0 + hd - 4), "#D6C594", local(f, 0, 27, (z0 - hd) / 2))

  // 正立面分段（|x| 区间、高度、类型）：两端低翼、外侧塔楼、墙段、内侧塔楼
  const parts = [
    { x0: 63, x1: 71.1, h: 17, kind: "wing" },
    { x0: 53, x1: 63, h: 30, kind: "tower" },
    { x0: 37, x1: 53, h: 24, kind: "wall" },
    { x0: 27, x1: 37, h: 30, kind: "tower" }
  ]
  for (const sx of [-1, 1]) {
    for (const p of parts) {
      const w = p.x1 - p.x0
      const x = (sx * (p.x0 + p.x1)) / 2
      b.add(box(w, p.h, dz), C.sciWall, local(f, x, 0, zc))
      // 窗带：深色横条，每层一条
      const rows = p.kind === "wing" ? [3, 8.5] : [3, 8.5, 14, 19.5]
      if (p.kind === "tower") rows.push(25)
      for (const y of rows) {
        b.add(box(w - 2.4, 2.3, 0.2), C.sciWindow, local(f, x, y, z1 + 0.05))
      }
      if (p.kind === "tower") {
        // 塔顶砖红压顶
        b.add(box(w + 0.8, 1.6, dz + 0.8), C.sciRed, local(f, x, p.h, zc))
      } else {
        // 顶部砖红檐口：只在正立面一条（屋面保持米黄）
        b.add(box(w, 1.0, 0.6), C.sciRed, local(f, x, p.h - 1, z1 + 0.3))
      }
    }
  }
  // 中部柱廊：米黄墙体 + 通高深色玻璃 + 8 根方柱（柱头砖红）
  b.add(box(54, 24, dz), C.sciWall, local(f, 0, 0, zc))
  b.add(box(52, 21, 0.2), C.sciGlass, local(f, 0, 0.5, z1 + 0.05))
  for (let i = 0; i < 8; i++) {
    const x = -24.5 + i * 7
    b.add(box(2.2, 21, 1.6), C.sciWall, local(f, x, 0, z1 + 0.8))
    b.add(box(2.6, 1.2, 2.0), C.sciRed, local(f, x, 20.2, z1 + 0.8))
  }
  // 两道通长砖红线脚：檐口下与柱头处（正立面 |x| ≤ 63）
  b.add(box(126, 1.2, 0.5), C.sciRed, local(f, 0, 22.4, z1 + 0.25))
  // 下道线脚只画在两侧（|x| ≥ 27），不横穿中部通高玻璃柱廊
  for (const sx of [-1, 1]) {
    b.add(box(36, 0.6, 0.5), C.sciRed, local(f, sx * 45, 16.2, z1 + 0.25))
  }

  // 楼顶招牌：五块红色字牌（四川科技馆）+ 下方白色英文条
  const sz = z1 - 5
  b.add(box(44, 1.4, 0.5), "#F2EEE4", local(f, 0, 24, sz))
  for (let i = 0; i < 5; i++) {
    b.add(box(5.8, 5.8, 0.5), C.sign, local(f, -16 + i * 8, 25.6, sz))
  }
}

/* ---------------- 入口 ---------------- */

/**
 * 建毛主席像与四川科技馆（顺序与拆分前一致：先像、后科技馆）。
 * @param {ColorBuilder} b 静态件
 * @param {object} site 场地对象（site.js 的 createSite），用到 site.project
 * @returns {{ zones: Array, walkways: Array }} 两处替换区与科技馆前轴线路径（世界坐标）
 */
export function buildNorth(b, site) {
  const { project } = site
  const zones = []

  // 毛主席像（替换像下那座无名台基楼）
  const [sx, sz] = project.toLocal(STATUE.lon, STATUE.lat)
  buildStatue(b, frame(sx, 0, sz, 0))
  zones.push(rectPolygon(sx + 1.5, sz + 4.5, 80, 62, 90))

  // 四川科技馆
  const [cx, cz] = project.toLocal(SCIENCE.lon, SCIENCE.lat)
  buildScience(b, frame(cx, 0, cz, 0))
  zones.push(rectPolygon(cx, cz, SCIENCE.w + 2, SCIENCE.d + 2, 90))

  const walkways = [
    {
      // 轴线相对毛主席像中心：北端在科技馆正门前，南端在像的台基北沿外
      points: offsetPoints(
        [
          [0, AXIS.z0],
          [0, AXIS.z1]
        ],
        sx,
        sz
      ),
      y: AXIS.y,
      width: AXIS.width,
      closed: false,
      density: AXIS.density
    }
  ]
  return { zones, walkways }
}

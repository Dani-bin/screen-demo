/*
 * 天府广场 · 第 1 站（build 入口）
 * ----------------------------------------------------------
 * 设计文档：docs/superpowers/specs/2026-10-02-city-tianfu-redo-design.md；
 * 实施计划：docs/superpowers/plans/2026-10-02-city-tianfu-redo.md。
 * 本文件只做组装：建场地对象、依次调用各分区、汇总替换区与步行路径、烘焙材质与 Mesh、水柱动画。
 * 分区按文件拆开：
 * - site.js：坐标系（广场局部系、设计系 designFrame / toWorld）、PAVE、颜色表、通用小函数；
 * - ground.js：浅色外板、太极阴鱼与 S 线地灯带、草坪与花带（Task 3）；
 * - sunbird.js：太阳神鸟盘（Task 3），定位针挂在盘顶；
 * - north.js：毛主席像、四川科技馆（Task 7 按照片修正）；
 * - neighbors.js：成都博物馆、四川省图书馆（几何冻结，不再改）。
 * 调用顺序决定合批后的顶点顺序，也就决定几何哈希：地面 → 神鸟盘 → 北侧组团 → 周边地标，不要随意调换。
 *
 * 后续任务在这里接入新文件：
 * - Task 4：westEye.js，西鱼眼深色盘的口子经 buildGround 的 cuts 挖（见 ground.js 文件头）；
 * - Task 5：eastEye.js，坑口同样进 cuts，并返回 groundHoles（下沉广场坑口，世界坐标，用 site.toWorldPts）；
 * - Task 6：北缘喷泉、图腾柱、路灯、构筑物与树；北缘喷泉水柱加进下面的 jets，自动成为第 2 个 Mesh；
 * - Task 8：步行路径重排（或拆出 walkways.js），替换下面的临时路径。
 * 预算：景点合计 ≤ 30,000 三角形、Mesh ≤ 3（设计第 5 节）。
 */
import { BackSide, Mesh } from "three"
import { ColorBuilder, landmarkMaterial } from "../kit/builder.js"
import { PAVE, createSite, ringPoints } from "./site.js"
import { buildGround } from "./ground.js"
import { SUNBIRD, buildSunbird } from "./sunbird.js"
import { buildNorth } from "./north.js"
import { buildNeighbors } from "./neighbors.js"

// 喷泉水柱动画 Mesh 的底面高度（水面）：旧条形喷泉的水面 PAVE + 0.4，Task 6 建北缘喷泉池时按池水面改
const JET_BASE = PAVE + 0.4

/*
 * 替换区：OSM 广场面（ground.js 的 SQUARE_OUTLINE）在设计系里的范围 u −147.5～146、v −84～104，
 * 四边各外扩 2 m，随设计系转 −1.5°（东端偏北）
 */
const SQUARE_ZONE = [
  [-149.5, -86],
  [148, -86],
  [148, 106],
  [-149.5, 106]
]

/*
 * 临时步行路径（设计系；Task 8 按设计第 6 节重排）。都走在铺装顶面 PAVE 上：
 * 外板、阴鱼、地灯带三者共面，横穿 S 线不起伏。
 * - 绕神鸟盘一圈：半径 12、宽 3（内沿 10.5，离盘外深色环 9.15 有 1.35 m，深色环只高 0.15，
 *   不算障碍；离鼓座侧面 ≥ 3.25 m）；
 * - 南北中轴，在神鸟盘处断开：北段 v −62 → −12.3（北端离 Task 6 的旗台 v −70.3 还有 8 m），
 *   南段 v 11.7 → 98（南端离广场南沿 v 104 有 6 m）；两段内端正好落在绕盘环的中线上。
 *   中轴宽 6（|u| ≤ 3），两侧最近的草坪在 |u| ≥ 24。
 */
const RING = { r: 12, width: 3, density: 2 }
const AXIS = { width: 6, density: 1.5 }
const AXIS_SEGMENTS = [
  [
    [0, -62],
    [0, SUNBIRD.v - RING.r]
  ],
  [
    [0, SUNBIRD.v + RING.r],
    [0, 98]
  ]
]

/** 临时步行路径：设计系 → 世界坐标 */
function squareWalkways(site) {
  return [
    {
      points: site.toWorldPts(ringPoints(SUNBIRD.u, SUNBIRD.v, RING.r, 32)),
      y: PAVE,
      width: RING.width,
      closed: true,
      density: RING.density
    },
    ...AXIS_SEGMENTS.map((pts) => ({
      points: site.toWorldPts(pts),
      y: PAVE,
      width: AXIS.width,
      closed: false,
      density: AXIS.density
    }))
  ]
}

export function build(ctx) {
  const site = createSite(ctx)
  const b = new ColorBuilder()
  // 喷泉水柱（单独成动画 Mesh）：旧条形喷泉已删，Task 6 的北缘喷泉水柱加进来之前为空
  const jets = new ColorBuilder()

  // 广场：地面（铺装、太极、草坪花带）→ 太阳神鸟盘（返回盘顶北缘高度，作定位针底座）
  buildGround(b, site)
  const sunbird = buildSunbird(b, site)
  // 北侧组团、周边地标：各自返回替换区与步行路径（世界坐标）
  const parts = [buildNorth(b, site), buildNeighbors(b, site)]
  const zones = [site.toWorldPts(SQUARE_ZONE), ...parts.flatMap((p) => p.zones)]
  const walkways = [
    ...squareWalkways(site),
    ...parts.flatMap((p) => p.walkways || [])
  ]

  const mat = landmarkMaterial()
  // 本景点全由封闭体块组成：阴影贴图只画背光面（与通用楼一致），
  // 避免双面材质在大面积铺装上出现自阴影条纹
  mat.shadowSide = BackSide
  const meshes = [new Mesh(b.bake(), mat)]
  // 喷泉水柱：有水柱时才建这个 Mesh（空合批 bake 得到 null，不能拿来建 Mesh）；
  // 整体抬到水面高度，update 里只改 scale.y
  let jetMesh = null
  if (jets.triangles > 0) {
    jetMesh = new Mesh(jets.bake(), landmarkMaterial())
    jetMesh.position.y = JET_BASE
    jetMesh.userData.animated = true
    meshes.push(jetMesh)
  }

  return {
    meshes,
    zones,
    // 落点在神鸟盘中心（cityData.js），定位针底座取盘顶最高处——北缘：
    // PAVE 1.5 + 盘心 1.25 + 7.25·tan 5° ≈ 3.38（sunbird.js 的 SUNBIRD_TOP）
    markerHeight: sunbird.top,
    walkways,
    update(t) {
      if (jetMesh) jetMesh.scale.y = 1 + 0.18 * Math.sin(t * 2.2)
    }
  }
}

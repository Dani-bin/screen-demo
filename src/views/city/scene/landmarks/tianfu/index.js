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
 * - westEye.js：西鱼眼「长江龙」（Task 4），深色盘的口子经 buildGround 的 cuts 挖（WEST_EYE_CUT）；
 * - eastEye.js：东鱼眼「黄河龙」下沉广场（Task 5），坑口同样进 cuts（EAST_EYE_CUT），
 *   并返回城市地面洞 groundHoles（坑口外扩 0.5 m，世界坐标）；
 * - sculpture.js：两座鱼眼雕塑共用的托盘旋转体、金龙扁带与龙首；
 * - northEdge.js：北缘两条喷泉池（水柱进 jets，成第 2 个 Mesh）、池北花带与绿篱、国旗台（Task 6）；
 * - furniture.js：图腾柱 4 根、凤鸟路灯 12 盏（Task 6）；
 * - structures.js：「天书」雨棚、东入口下沉楼梯口（铺装挖口 EAST_ENTRY_CUT）、东南构筑物（Task 6）；
 * - trees.js：东西林带与南缘行道树，返回林带内侧两条南北步道（Task 6）；
 * - north.js：北侧组团入口（Task 7）——门前广场、替换区、科技馆前轴线；
 *   statue.js：毛主席像组团（台座、斜坡、花坡、立像）；science.js：四川科技馆（体块、柱廊、窗、线脚、招牌）；
 * - neighbors.js：成都博物馆、四川省图书馆（几何冻结，不再改）。
 * 调用顺序决定合批后的顶点顺序，也就决定几何哈希：地面 → 神鸟盘 → 西鱼眼 → 东鱼眼 → 北缘 → 图腾柱与路灯
 * → 构筑物 → 林带 → 北侧组团 → 周边地标，不要随意调换。
 *
 * 后续任务在这里接入新文件：
 * - Task 8：步行路径重排（或拆出 walkways.js），替换下面的临时路径。
 * 预算：景点合计 ≤ 30,000 三角形、Mesh ≤ 3（设计第 5 节）。Mesh 现为 2：静态件 + 北缘水柱动画件。
 */
import { BackSide, Mesh } from "three"
import { ColorBuilder, landmarkMaterial } from "../kit/builder.js"
import { circlePolygon } from "../kit/footprint.js"
import { PAVE, createSite, rectUV } from "./site.js"
import { SQUARE_OUTLINE, buildGround } from "./ground.js"
import { SUNBIRD, buildSunbird } from "./sunbird.js"
import { WEST_EYE_CUT, buildWestEye } from "./westEye.js"
import { EAST_EYE_CUT, buildEastEye } from "./eastEye.js"
import { POOL_WATER, buildNorthEdge } from "./northEdge.js"
import { buildFurniture } from "./furniture.js"
import { EAST_ENTRY_CUT, buildStructures } from "./structures.js"
import { buildTrees } from "./trees.js"
import { buildNorth } from "./north.js"
import { buildNeighbors } from "./neighbors.js"

// 喷泉水柱动画 Mesh 的底面高度：北缘喷泉池水面（northEdge.js 的 POOL_WATER = PAVE + 0.45）
const JET_BASE = POOL_WATER

/*
 * 替换区：OSM 广场面（ground.js 的 SQUARE_OUTLINE）在设计系里的包围盒（u −147.5～146、v −84～104）
 * 四边各外扩 2 m，随设计系转 −1.5°（东端偏北）。由轮廓算出，轮廓改了替换区跟着变
 */
const ZONE_PAD = 2
const SQUARE_ZONE = (() => {
  const us = SQUARE_OUTLINE.map((p) => p[0])
  const vs = SQUARE_OUTLINE.map((p) => p[1])
  return rectUV(
    Math.min(...us) - ZONE_PAD,
    Math.max(...us) + ZONE_PAD,
    Math.min(...vs) - ZONE_PAD,
    Math.max(...vs) + ZONE_PAD
  )
})()

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
      points: site.toWorldPts(circlePolygon(SUNBIRD.u, SUNBIRD.v, RING.r, 32)),
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
  // 喷泉水柱（单独成动画 Mesh）：北缘两池的扇形水柱（northEdge.js）
  const jets = new ColorBuilder()

  // 广场：地面（铺装、太极、草坪花带；铺装在西鱼眼深色盘、东鱼眼坑口、东入口楼梯口处挖口）→ 太阳神鸟盘
  // （返回盘顶北缘高度，作定位针底座）→ 西鱼眼（返回绕池步行环）→ 东鱼眼下沉广场（返回坑底环、坑口外环与
  // 城市地面洞）→ 北缘喷泉池与国旗台 → 图腾柱与凤鸟路灯 → 雨棚、东入口、东南构筑物 → 林带（返回林带内侧步道）
  buildGround(b, site, { cuts: [WEST_EYE_CUT, EAST_EYE_CUT, EAST_ENTRY_CUT] })
  const sunbird = buildSunbird(b, site)
  const westEye = buildWestEye(b, site)
  const eastEye = buildEastEye(b, site)
  buildNorthEdge(b, jets, site)
  buildFurniture(b, site)
  buildStructures(b, site)
  const trees = buildTrees(b, site)
  // 北侧组团、周边地标：各自返回替换区与步行路径（世界坐标）
  const parts = [buildNorth(b, site), buildNeighbors(b, site)]
  const zones = [site.toWorldPts(SQUARE_ZONE), ...parts.flatMap((p) => p.zones)]
  const walkways = [
    ...squareWalkways(site),
    ...westEye.walkways,
    ...eastEye.walkways,
    ...trees.walkways,
    ...parts.flatMap((p) => p.walkways || [])
  ]

  const mat = landmarkMaterial()
  // 阴影贴图只画背光面（与通用楼一致）：铺装、草坪、水面这类朝上的大片单层面若双面画进阴影贴图，
  // 会在自身上出现自阴影条纹。悬空构件（鱼眼托盘、金龙扁带等）都有朝下的底面，照样投影；
  // 下沉广场的坑壁、坑口栏杆法线朝里，西南侧背对太阳，影子落进坑里（见 eastEye.js）
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
    // 城市地面洞：下沉广场坑底（PAVE − 6 ≈ −4.5）低于城市地面（−0.5），坑口处挖空
    groundHoles: eastEye.groundHoles,
    update(t) {
      if (jetMesh) jetMesh.scale.y = 1 + 0.18 * Math.sin(t * 2.2)
    }
  }
}

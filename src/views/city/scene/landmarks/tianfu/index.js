/*
 * 天府广场 · 第 1 站（build 入口）
 * ----------------------------------------------------------
 * 设计文档：docs/superpowers/specs/2026-10-02-city-tianfu-redo-design.md；
 * 实施计划：docs/superpowers/plans/2026-10-02-city-tianfu-redo.md。
 * 本文件只做组装：建场地对象、依次调用各分区、汇总替换区与步行路径、烘焙材质与 Mesh、水柱动画。
 * 分区按文件拆开：
 * - site.js：坐标系（广场局部系、设计系 designFrame / toWorld）、PAVE、颜色表、通用小函数；
 * - square.js：旧广场部分（铺装、分界带、金盘、下沉广场、喷泉、草坪、图腾柱），后续任务逐块替换；
 * - north.js：毛主席像、四川科技馆（Task 7 按照片修正）；
 * - neighbors.js：成都博物馆、四川省图书馆（几何冻结，不再改）。
 * 调用顺序决定合批后的顶点顺序，也就决定几何哈希：广场 → 北侧组团 → 周边地标，不要随意调换。
 *
 * 后续任务在这里接入新文件：
 * - Task 3：ground.js（太极铺装、草坪花带）、sunbird.js（太阳神鸟盘），定位针高度改取盘顶；
 * - Task 4：westEye.js；Task 5：eastEye.js，并返回 groundHoles（下沉广场坑口，世界坐标，用 site.toWorld）；
 * - Task 6：北缘喷泉、图腾柱、路灯、构筑物与树，北缘喷泉水柱沿用下面的动画 Mesh；
 * - Task 8：步行路径重排（或拆出 walkways.js）。
 * 预算：景点合计 ≤ 30,000 三角形、Mesh ≤ 3（设计第 5 节）。
 */
import { BackSide, Mesh } from "three"
import { ColorBuilder, landmarkMaterial } from "../kit/builder.js"
import { PAVE, createSite } from "./site.js"
import { WATER_TOP, buildSquare } from "./square.js"
import { buildNorth } from "./north.js"
import { buildNeighbors } from "./neighbors.js"

export function build(ctx) {
  const site = createSite(ctx)
  const b = new ColorBuilder()
  const jets = new ColorBuilder()

  // 各分区：静态件进 b，喷泉水柱进 jets；各自返回替换区与步行路径（世界坐标）
  const parts = [
    buildSquare(b, jets, site),
    buildNorth(b, site),
    buildNeighbors(b, site)
  ]
  const zones = parts.flatMap((p) => p.zones)
  const walkways = parts.flatMap((p) => p.walkways || [])

  const mat = landmarkMaterial()
  // 本景点全由封闭体块组成：阴影贴图只画背光面（与通用楼一致），
  // 避免双面材质在大面积铺装上出现自阴影条纹
  mat.shadowSide = BackSide
  const mesh = new Mesh(b.bake(), mat)
  // 喷泉水柱：单独一个动画 Mesh，整体抬到水面高度，update 里只改 scale.y
  const jetMesh = new Mesh(jets.bake(), landmarkMaterial())
  jetMesh.position.y = WATER_TOP
  jetMesh.userData.animated = true

  return {
    meshes: [mesh, jetMesh],
    zones,
    // 落点球坐在广场中心金盘上（盘厚 0.3 + 纹样 0.15）
    markerHeight: PAVE + 0.45,
    walkways,
    update(t) {
      jetMesh.scale.y = 1 + 0.18 * Math.sin(t * 2.2)
    }
  }
}

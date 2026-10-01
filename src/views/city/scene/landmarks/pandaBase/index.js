/*
 * 熊猫基地（成都大熊猫繁育研究基地）· 第 12 站
 * ----------------------------------------------------------
 * 设计文档：docs/superpowers/specs/2026-10-01-city-panda-base-design.md（坐标、尺寸、配色以它为准）。
 * 园区在主城区数据东北约 5 km 外的飞地数据里（chengdu.json 的 meta.enclaves）。
 * 按分区拆文件：site 场地公共部分、ground 地面、gate 南大门与铜像、halls 博物馆等建筑、
 * lake 天鹅湖、enclosures 熊猫别墅与产房、walkways 步行路径、vegetation 树竹。
 * 预算：≤ 4 万三角形、2 个 Mesh（主体 DoubleSide + 地面批 FrontSide），熊猫并入主体批。
 */
import { FrontSide, Mesh } from "three"
import { landmarkMaterial } from "../kit/builder.js"
import { createSite } from "./site.js"
import { buildLawn, buildPaths, buildPlaza } from "./ground.js"

// 定位针底座高度：南大门熊猫头左耳顶（真实约 10.5 m × 1.25 插画放大）
const MARKER_HEIGHT = 13.1

export function build(ctx) {
  const site = createSite(ctx)
  buildPaths(site)
  const walkways = []
  // 各分区在这里加构件，并登记草地要挖的洞（site.addYard、site.lawnHoles）与
  // 广场要挖的洞（site.plazaHoles）；骨架阶段还没有分区，后续任务往这里加
  // 草地和广场最后挤出：此时所有洞都已登记完整
  buildLawn(site)
  buildPlaza(site)

  const meshes = []
  const g = site.b.bake()
  if (g) meshes.push(new Mesh(g, landmarkMaterial()))
  const gg = site.gb.bake()
  if (gg) {
    const mat = landmarkMaterial()
    mat.side = FrontSide
    meshes.push(new Mesh(gg, mat))
  }
  return { meshes, zones: site.zones, markerHeight: MARKER_HEIGHT, walkways }
}

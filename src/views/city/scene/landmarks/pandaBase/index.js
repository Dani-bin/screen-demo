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
import { buildGate } from "./gate.js"
import { buildHalls } from "./halls.js"
import { buildLake } from "./lake.js"
import { buildEnclosures } from "./enclosures.js"

export function build(ctx) {
  const site = createSite(ctx)
  buildPaths(site)
  // earTop：南大门熊猫头左耳顶的世界高度（门前铺装 PAVE_Y + 真实 10.48 m × 1.25 插画放大 ≈ 14.1），
  // 作定位针底座（同其他景点：markerHeight 取模型顶的世界 y）
  const { earTop } = buildGate(site)
  // 到站机位要按定位针底座抬高（site.cameraPos），熊猫朝向、视线保护都用它
  site.markerHeight = earTop
  buildHalls(site)
  buildLake(site)
  buildEnclosures(site)
  const walkways = []
  // 各分区在这里加构件，并登记草地要挖的洞（site.addYard、site.lawnHoles）与
  // 广场要挖的洞（site.plazaHoles）；后续分区按既定构建顺序往这里加
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
  return { meshes, zones: site.zones, markerHeight: earTop, walkways }
}

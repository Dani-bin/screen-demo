/*
 * 共享材质
 * ----------------------------------------------------------
 * 地面 / 绿地 / 水系 / 道路 / 树木 / 标注 共用的材质集中创建，
 * 场景释放时统一 dispose。建筑材质带自定义着色器，在 buildings.js 里单独创建。
 */
import { MeshStandardMaterial } from "three"

export function createMaterials(theme) {
  const m = {
    ground: new MeshStandardMaterial({ color: theme.ground, roughness: 1 }),
    park: new MeshStandardMaterial({ color: theme.park, roughness: 1 }),
    water: new MeshStandardMaterial({
      color: theme.water,
      roughness: theme.waterRoughness,
      metalness: 0.05
    }),
    roadSurface: new MeshStandardMaterial({
      color: theme.roadSurface,
      roughness: 1
    }),
    roadCurb: new MeshStandardMaterial({ color: theme.roadCurb, roughness: 1 }),
    trunk: new MeshStandardMaterial({ color: theme.tree.trunk, roughness: 1 }),
    // 树冠逐棵着色用 instanceColor，基色必须为白，否则会被乘暗
    foliage: new MeshStandardMaterial({
      color: "#ffffff",
      roughness: 0.9,
      flatShading: true
    }),
    marker: new MeshStandardMaterial({
      color: theme.marker.color,
      roughness: 0.4
    }),
    highlight: new MeshStandardMaterial({
      color: theme.highlight,
      emissive: theme.highlight,
      emissiveIntensity: 0.35,
      roughness: 0.6,
      // 高亮体与原楼体共面，用多边形偏移压在前面避免闪烁
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    })
  }
  m.dispose = () => {
    Object.values(m).forEach(
      (v) => v && typeof v.dispose === "function" && v.dispose()
    )
  }
  return m
}

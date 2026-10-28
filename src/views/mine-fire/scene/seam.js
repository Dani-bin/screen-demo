/*
 * 煤层板：CAD 井田边界挤出的厚板（顶面岩纹 + 坐标网，侧面岩层条带）+ 边界发光虚线
 */
import * as THREE from "three"
import { THEME } from "./theme.js"
import { seamTopMaterial, seamSideMaterial, dashMaterial } from "./materials.js"
import { planToXZ, ribbon } from "./geom.js"

export function buildSeam(plan) {
  const c = THEME.color
  const thick = THEME.size.seamThick
  const group = new THREE.Group()

  // 形状在 (e, n) 平面里；绕 x 轴转 -90° 后 (e, n, z) → (e, z, -n)，挤出方向变成向上
  const shape = new THREE.Shape(
    plan.boundary.map(([e, n]) => new THREE.Vector2(e, n))
  )
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thick,
    bevelEnabled: false,
    curveSegments: 1
  })
  g.rotateX(-Math.PI / 2)
  g.translate(0, -thick, 0)
  const top = seamTopMaterial(c)
  const side = seamSideMaterial(c, thick)
  // ExtrudeGeometry 的材质组：0 = 上下两个盖面，1 = 侧面
  const mesh = new THREE.Mesh(g, [top, side])
  mesh.renderOrder = 0
  group.add(mesh)

  // 边界虚线：贴在顶面上方一点
  const edge = new THREE.Mesh(
    ribbon(planToXZ(plan.boundary), 26, 1.5, true),
    dashMaterial(c.edge, { dash: 90, gap: 55, glow: 2.0 })
  )
  edge.renderOrder = 2
  group.add(edge)

  return {
    group,
    /** 火点照亮煤层：位置 + 强度 */
    setFire(x, z, k) {
      top.uniforms.uFire.value.set(x, 0, z, k)
    }
  }
}

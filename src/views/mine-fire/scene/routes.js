/*
 * 避灾路线：贴在大巷顶上的一串流动 V 形箭头（R1 向北到副井井底车场，R2 向南到 RC-01）
 * 撤离开始（应急广播）才显示，复位后收起；图层开关也能关。
 */
import * as THREE from "three"
import { THEME } from "./theme.js"
import { chevronMaterial } from "./materials.js"
import { planToXZ, ribbon } from "./geom.js"

export function buildRoutes(plan) {
  const S = THEME.size
  const group = new THREE.Group()
  const mats = []
  const lines = {}
  for (const r of plan.routes) {
    const pts = planToXZ(r.pts)
    const m = chevronMaterial(THEME.color.route)
    const mesh = new THREE.Mesh(ribbon(pts, 120, S.tubeH - S.sink + 4), m)
    mesh.renderOrder = 10
    group.add(mesh)
    mats.push(m)
    lines[r.id] = pts
  }
  let target = 0
  let k = 0
  return {
    group,
    lines,
    setOn(on) {
      target = on ? 1 : 0
    },
    tick(dt, t) {
      // 显隐淡入淡出
      k += (target - k) * Math.min(1, dt * 3)
      for (const m of mats) {
        m.uniforms.uTime.value = t
        m.uniforms.uOn.value = k
      }
      group.visible = k > 0.01
    }
  }
}

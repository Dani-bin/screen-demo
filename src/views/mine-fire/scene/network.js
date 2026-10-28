/*
 * 巷网：大巷走廊（每组平行大巷一条玻璃走廊，内部按并行条数排灯带）+ 工作面（顺槽 + 切眼 + 煤面）
 */
import * as THREE from "three"
import { THEME } from "./theme.js"
import { glassMaterial } from "./materials.js"
import { planToXZ, sweepBox, ribbon, along, lengthOf } from "./geom.js"

/** 沿折线按间距排灯：返回 [x, z] 列表（lateral 为横向偏移，米） */
function lampsAlong(pts, spacing, lateral) {
  const L = lengthOf(pts)
  const out = []
  for (let d = spacing / 2; d < L; d += spacing) {
    const q = along(pts, d)
    // 横向偏移：切向转 90°
    out.push([q.x - q.tz * lateral, q.z + q.tx * lateral])
  }
  return out
}

export function buildNetwork(plan) {
  const S = THEME.size
  const group = new THREE.Group()
  const glass = glassMaterial({
    color: THEME.color.tube,
    opacity: 0.2,
    edge: 1.1,
    ribs: 1e6
  })
  const lampPts = []
  const y0 = -S.sink

  // ---------- 大巷走廊
  const corridors = {}
  const floorMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.025, 0.08, 0.16),
    transparent: true,
    opacity: 0.75,
    depthWrite: false
  })
  for (const c of plan.corridors) {
    const pts = planToXZ(c.pts)
    const w = S.tubeW(c.lanes)
    const mesh = new THREE.Mesh(sweepBox(pts, w, S.tubeH, y0, false), glass)
    mesh.renderOrder = 5
    group.add(mesh)
    corridors[c.id] = { pts, w, lanes: c.lanes }
    // 走廊底部一条淡青色光带：让玻璃管读成"亮着的通道"，而不是两条棱线
    const floor = new THREE.Mesh(ribbon(pts, w * 0.72, y0 + 1.5), floorMat)
    floor.renderOrder = 4
    group.add(floor)
    // 走廊中线一列等距灯（并行几条由走廊宽度体现；多列灯在远处会糊成随机亮斑）
    lampPts.push(...lampsAlong(pts, 80, 0))
  }

  // ---------- 工作面：两条顺槽 + 远端切眼 + 中间煤面
  const coalMat = new THREE.MeshBasicMaterial({ color: "#06090d" })
  const panelGlass = glassMaterial({
    color: THEME.color.tube,
    opacity: 0.15,
    edge: 1.0,
    ribs: 1e6
  })
  const panels = {}
  for (const p of plan.panels) {
    const [[e0, n0], [e1, n1]] = p.rect
    const alongE = Math.abs(e1 - e0) > Math.abs(n1 - n0)
    // 顺槽沿长边；切眼在远离大巷的一端
    const sides = alongE
      ? [
          [
            [e0, n0],
            [e1, n0]
          ],
          [
            [e0, n1],
            [e1, n1]
          ]
        ]
      : [
          [
            [e0, n0],
            [e0, n1]
          ],
          [
            [e1, n0],
            [e1, n1]
          ]
        ]
    const face = alongE
      ? [
          [e1, n0],
          [e1, n1]
        ]
      : [
          [e0, n1],
          [e1, n1]
        ]
    // 切眼两端各缩进半个管宽，不和两条顺槽在拐角叠在一起（叠加的玻璃棱边会过曝成白点）
    const inset = S.panelTube / 2
    const faceIn = alongE
      ? [
          [e1, n0 + Math.sign(n1 - n0) * inset],
          [e1, n1 - Math.sign(n1 - n0) * inset]
        ]
      : [
          [e0 + Math.sign(e1 - e0) * inset, n1],
          [e1 - Math.sign(e1 - e0) * inset, n1]
        ]
    for (const l of [...sides, faceIn]) {
      const pts = planToXZ(l)
      const m = new THREE.Mesh(
        sweepBox(pts, S.panelTube, S.tubeH * 0.75, y0, false),
        panelGlass
      )
      m.renderOrder = 5
      group.add(m)
      // 切眼上不排灯，拐角就不会有一团灯光
      if (l !== faceIn) lampPts.push(...lampsAlong(pts, 110, 0))
    }
    // 煤面：两条顺槽之间的暗色矩形，略低于顶面
    const w = Math.abs(e1 - e0)
    const h = Math.abs(n1 - n0)
    const coal = new THREE.Mesh(new THREE.PlaneGeometry(w, h), coalMat)
    coal.rotation.x = -Math.PI / 2
    coal.position.set((e0 + e1) / 2, 0.6, -(n0 + n1) / 2)
    group.add(coal)
    panels[p.id] = { face: planToXZ(face) }
  }

  // ---------- 灯：一个实例网格画全部（HDR 颜色，亮度过阈值会泛光）
  const lampGeo = new THREE.BoxGeometry(9, 3, 9)
  const lampMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.7, 0.9, 1.05)
  })
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, lampPts.length)
  const m4 = new THREE.Matrix4()
  lampPts.forEach(([x, z], i) => {
    m4.makeTranslation(x, y0 + S.tubeH * 0.42, z)
    lamps.setMatrixAt(i, m4)
  })
  lamps.renderOrder = 4
  group.add(lamps)

  return {
    group,
    corridors,
    panels,
    tick(t) {
      glass.uniforms.uTime.value = t
    }
  }
}

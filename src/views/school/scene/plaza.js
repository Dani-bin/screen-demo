/*
 * 中轴景观广场建模
 * ----------------------------------------------------------
 * 矩形景观水池 + 中央喷泉雕塑 + 两端圆池，依据俯拍实景照片还原。
 * 水柱做成半透明细柱，在渲染循环里轻微起伏，避免画面完全静止。
 */
import { BoxGeometry, CylinderGeometry, Group, Mesh } from "three"
import { PLAZA } from "./layout"
import { rectGround } from "./geometry"

export function createPlaza(materials) {
  const group = new Group()
  const { x, z, poolW, poolD, roundPoolOffset } = PLAZA

  // 池沿：必须做成中空的四条边框，若用一个实心 Box，
  // 水面平面会整个埋在体块内部，画面上只剩一块石板
  const RIM = 0.6
  const RIM_H = 0.85
  const rimSpecs = [
    [poolW / 2 - RIM / 2, 0, RIM, poolD],
    [-(poolW / 2 - RIM / 2), 0, RIM, poolD],
    [0, poolD / 2 - RIM / 2, poolW, RIM],
    [0, -(poolD / 2 - RIM / 2), poolW, RIM]
  ]
  rimSpecs.forEach(([rx, rz, rw, rd]) => {
    const rim = new Mesh(new BoxGeometry(rw, RIM_H, rd), materials.stone)
    rim.position.set(rx, RIM_H / 2, rz)
    rim.castShadow = true
    rim.receiveShadow = true
    group.add(rim)
  })
  // 水面略低于池沿顶面，形成下沉的水体
  group.add(
    rectGround(poolW - RIM * 2, poolD - RIM * 2, materials.water, 0, 0.62, 0)
  )

  // 两端圆池
  ;[-roundPoolOffset, roundPoolOffset].forEach((dz) => {
    const ring = new Mesh(
      new CylinderGeometry(4.2, 4.2, 0.8, 28),
      materials.stone
    )
    ring.position.set(0, 0.4, dz)
    ring.castShadow = true
    group.add(ring)

    const surface = new Mesh(
      new CylinderGeometry(3.6, 3.6, 0.1, 28),
      materials.water
    )
    surface.position.set(0, 0.78, dz)
    group.add(surface)
  })

  // 中央喷泉雕塑
  const column = new Mesh(
    new CylinderGeometry(0.55, 1.5, 3.4, 12),
    materials.trim
  )
  column.position.y = 2.1
  column.castShadow = true
  group.add(column)

  const bowl = new Mesh(new CylinderGeometry(2.3, 1.5, 0.5, 16), materials.trim)
  bowl.position.y = 3.9
  bowl.castShadow = true
  group.add(bowl)

  // 水柱：交给渲染循环做上下起伏
  const jets = []
  for (let i = 0; i < 6; i++) {
    const jet = new Mesh(
      new CylinderGeometry(0.1, 0.16, 2.6, 6),
      materials.waterJet
    )
    const angle = (Math.PI * 2 * i) / 6
    jet.position.set(Math.cos(angle) * 2.1, 5.2, Math.sin(angle) * 2.1)
    jet.rotation.z = Math.cos(angle) * 0.22
    jet.rotation.x = -Math.sin(angle) * 0.22
    jets.push(jet)
    group.add(jet)
  }

  group.position.set(x, 0, z)
  group.userData.stop = 1
  return { group, jets }
}

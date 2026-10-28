/*
 * 风流（图层）：青色细粒子沿大巷流动，表示新鲜风流向（假设：从井底车场沿主大巷向南、沿东翼大巷向东、
 * 沿西翼大巷向西、沿二盘区北延巷向北；待矿方通风系统图确认）。只做示意，粒子要少、要暗：
 * 多了会在走廊里闪成一片亮斑，盖过灯和人员（评审 1 指出的"闪烁噪点"）。
 */
import * as THREE from "three"
import { THEME } from "./theme.js"
import { along, lengthOf, softTexture } from "./geom.js"

const N = 220
const SPEED = 110 // 显示速度（米 / 秒），真实风速约 2–4 m/s，放大才看得出流向

export function buildAirflow(network) {
  const S = THEME.size
  // 参与的走廊（按 plan.json 里折线的方向就是假设的风向）
  const ids = ["C-N", "C-E", "C-W", "C-2N"]
  const lines = ids.map((id) => network.corridors[id]).filter(Boolean)
  const lens = lines.map((l) => lengthOf(l.pts))
  const total = lens.reduce((a, b) => a + b, 0)
  // 按长度分配粒子
  const parts = []
  for (let i = 0; i < N; i++) {
    let r = (i / N) * total
    let k = 0
    while (k < lens.length - 1 && r > lens[k]) r -= lens[k++]
    parts.push({
      line: k,
      d0: Math.random() * lens[k],
      lat: (Math.random() - 0.5) * lines[k].w * 0.6
    })
  }
  const pos = new Float32Array(N * 3)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
  const mat = new THREE.PointsMaterial({
    map: softTexture(32),
    color: new THREE.Color(0.25, 0.75, 1.0),
    size: 3,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  const points = new THREE.Points(geo, mat)
  points.renderOrder = 9
  points.frustumCulled = false
  const y = -S.sink + S.tubeH * 0.65

  return {
    points,
    tick(t, dpr) {
      mat.size = 2.4 * dpr
      parts.forEach((p, i) => {
        const L = lens[p.line]
        const d = (p.d0 + t * SPEED) % L
        const q = along(lines[p.line].pts, d)
        pos[i * 3] = q.x - q.tz * p.lat
        pos[i * 3 + 1] = y
        pos[i * 3 + 2] = q.z + q.tx * p.lat
      })
      geo.attributes.position.needsUpdate = true
    }
  }
}

/**
 * 社区自己的小道具（/estate 的沙盘里没有的）：电动车充电棚、会所屋顶机库的停机坪、西人行门。
 * ----------------------------------------------------------
 * 楼栋、地面、树、水、路灯都是 /estate 的（CommunityScene 继承 RestoredScene），这里只补社区独有的几样，
 * 尺寸按 /estate 的比例（楼宽 30–34 m、会所屋顶 41.6 × 17 m）取，不再是旧版放大过的程序化沙盘的尺寸。
 */
import * as THREE from "three"
import layout from "../data/layout.json"
import { CX, CY } from "./theme.js"

const W = (x, y, h = 0) => new THREE.Vector3(x - CX, h, -(y - CY))
const stdMat = (color, o = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o })

/** 简单可复现的随机数 */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 电动车集中充电棚：顶棚 + 四根柱 + 棚下灯带（随温度变色）+ 一排电动车 + 拾取用的不可见体块 */
export function buildSheds() {
  const out = {}
  const roofM = stdMat(0x9db3ba, { roughness: 0.45, metalness: 0.3 })
  const r = rng(99)
  for (const p of layout.points.filter((q) => q.kind === "charge")) {
    const g = new THREE.Group()
    g.name = p.id
    g.position.copy(W(p.x, p.y))
    const H = 4.2
    // 地面铺一块浅灰水泥板，盖住底下的树和草，棚子才看得清
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(18, 0.3, 9.5),
      stdMat(0xb9b3a6, { roughness: 0.9 })
    )
    slab.position.y = 0.6
    g.add(slab)
    const roof = new THREE.Mesh(new THREE.BoxGeometry(16, 0.5, 7.5), roofM)
    roof.position.y = H
    g.add(roof)
    const postM = stdMat(0x6a6358)
    for (const [x, z] of [
      [-7.4, -3],
      [7.4, -3],
      [-7.4, 3],
      [7.4, 3]
    ]) {
      const pst = new THREE.Mesh(new THREE.BoxGeometry(0.4, H, 0.4), postM)
      pst.position.set(x, H / 2, z)
      g.add(pst)
    }
    // 棚下灯带（会随温度变色）和一排电动车
    const glow = new THREE.MeshBasicMaterial({
      color: 0xf3ebdd,
      transparent: true,
      opacity: 0.9
    })
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(13.5, 5), glow)
    strip.rotation.x = Math.PI / 2
    strip.position.y = H - 0.35
    g.add(strip)
    for (let i = 0; i < 9; i++) {
      const bike = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 1.1, 1.9),
        stdMat([0xd8d2c4, 0x7aa0c4, 0xc67a5a, 0x6f8f6a][Math.floor(r() * 4)])
      )
      bike.position.set(-6.4 + i * 1.6, 1.4, -0.3 + (r() - 0.5) * 0.5)
      g.add(bike)
    }
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(19, H + 4, 10.5),
      new THREE.MeshBasicMaterial({ visible: false })
    )
    hull.position.y = (H + 4) / 2
    hull.userData.id = p.id
    g.add(hull)
    out[p.id] = { group: g, glow, hull, roofY: H }
  }
  return out
}

/**
 * 机库停机坪：铺在物业中心（/estate 的会所 CL01）的屋顶板上，三个起降位沿东西方向并排（间距 13 m，
 * 和仿真器的 PAD_SLOT 一致），每个位置一圈发光环；起降点高度 = layout.hangar.roof。
 */
export function buildHangar() {
  const hg = layout.hangar
  const g = new THREE.Group()
  g.name = "HG-01"
  g.position.copy(W(hg.x, hg.y, hg.roof))
  const PW = 36
  const PD = 11
  const c = document.createElement("canvas")
  c.width = 1152
  c.height = 352
  const x = c.getContext("2d")
  x.fillStyle = "#cfc7b3"
  x.fillRect(0, 0, c.width, c.height)
  x.strokeStyle = "#8a7a58"
  x.lineWidth = 8
  x.strokeRect(8, 8, c.width - 16, c.height - 16)
  x.strokeStyle = "#2a2018"
  x.fillStyle = "#2a2018"
  x.lineWidth = 9
  x.font = "bold 120px DIN, sans-serif"
  x.textAlign = "center"
  x.textBaseline = "middle"
  for (const dx of [-13, 0, 13]) {
    const px = c.width / 2 + (dx / PW) * c.width
    x.beginPath()
    x.arc(px, c.height / 2, 108, 0, 7)
    x.stroke()
    x.fillText("H", px, c.height / 2 + 6)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const side = stdMat(0xcfc7b3)
  // 板厚 0.6 m，盖住屋顶天窗（顶面 +0.5 m）
  const pad = new THREE.Mesh(new THREE.BoxGeometry(PW, 0.6, PD), [
    side,
    side,
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }),
    side,
    side,
    side
  ])
  pad.position.y = 0.3
  g.add(pad)
  // 每个起降位一圈发光环：地面站"待命"的标识
  for (const dx of [-13, 0, 13]) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(5.2, 5.8, 40),
      new THREE.MeshBasicMaterial({
        color: 0xf3ebdd,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.set(dx, 0.75, 0)
    g.add(ring)
  }
  return g
}

/** 西人行门（/estate 没有）：两根门柱 + 横梁 + 两盏暖灯，立在云岸路一侧的地块边界上 */
export function buildGates() {
  const g = new THREE.Group()
  g.name = "gates"
  const post = stdMat(0xd8d0c0, { roughness: 0.6 })
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe0a8 })
  const gt = layout.points.find((p) => p.id === "GT-03")
  const gate = new THREE.Group()
  gate.position.copy(W(gt.x, gt.y))
  // 门沿南北向（x 为定值），两根门柱相距 6 m
  for (const dz of [-3.2, 3.2]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 4.6, 1.2), post)
    p.position.set(0, 2.3, dz)
    gate.add(p)
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), lampMat)
    lamp.position.set(0, 5.1, dz)
    gate.add(lamp)
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 7.6), post)
  beam.position.set(0, 4.3, 0)
  gate.add(beam)
  g.add(gate)
  g.userData.lampMat = lampMat
  return g
}

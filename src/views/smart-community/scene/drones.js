/**
 * 三架无人机：模型（六轴 / 四轴，旋翼会转）、发光航迹、到地面的竖线与落点、二号机到另两架的链路线、视场投影。
 * ----------------------------------------------------------
 * 位置和状态都来自仿真快照（sim/simulator.js 的 at(t)），航迹用 sim.trail 只算位姿采样。
 * 高度 = 真实高度（V = 1，不夸张）+ 一小段停机坪抬升。无人机比真实尺寸放大约 20 倍（THEME.droneSpan），才能在 /estate 的沙盘上看清。
 */
import * as THREE from "three"
import { Line2 } from "three/addons/lines/Line2.js"
import { LineGeometry } from "three/addons/lines/LineGeometry.js"
import { LineMaterial } from "three/addons/lines/LineMaterial.js"
import { CX, CY, THEME, V } from "./theme.js"

const IDS = ["UAV-01", "UAV-02", "UAV-03"]
const toW = (x, y, z) => new THREE.Vector3(x - CX, z * V + 1.2, -(y - CY))

/** 柔光斑纹理（中心亮、边缘渐隐），tint 是 css 颜色 */
function glowTexture(tint) {
  const c = document.createElement("canvas")
  c.width = c.height = 128
  const g = c.getContext("2d")
  const gr = g.createRadialGradient(64, 64, 2, 64, 64, 62)
  gr.addColorStop(0, tint)
  gr.addColorStop(0.35, tint.replace("1)", "0.35)"))
  gr.addColorStop(1, tint.replace("1)", "0)"))
  g.fillStyle = gr
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

/** 无人机模型（轴距约 1，之后整体缩放）：机身 + 臂 + 旋翼盘 + 发光环 */
function makeDroneModel(sixAxis, glowHex) {
  const g = new THREE.Group()
  const dark = new THREE.MeshStandardMaterial({
    color: 0x1c1814,
    roughness: 0.5,
    metalness: 0.4
  })
  const glow = new THREE.Color(glowHex)
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.13, 0.07, 16),
    dark
  )
  g.add(body)
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.118, 0.013, 6, 24),
    new THREE.MeshBasicMaterial({ color: glow })
  )
  ring.rotation.x = Math.PI / 2
  ring.position.y = 0.036
  g.add(ring)
  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  )
  led.position.y = 0.05
  g.add(led)
  const n = sixAxis ? 6 : 4
  const rotors = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (sixAxis ? 0 : Math.PI / 4)
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.02, 0.03), dark)
    arm.position.set(Math.cos(a) * 0.19, 0, -Math.sin(a) * 0.19)
    arm.rotation.y = a
    g.add(arm)
    const rot = new THREE.Group()
    rot.position.set(Math.cos(a) * 0.38, 0.03, -Math.sin(a) * 0.38)
    const r = sixAxis ? 0.135 : 0.16
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(r, 20),
      new THREE.MeshBasicMaterial({
        color: glow,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    )
    disc.rotation.x = -Math.PI / 2
    rot.add(disc)
    const edge = new THREE.Mesh(
      new THREE.RingGeometry(r * 0.94, r, 24),
      new THREE.MeshBasicMaterial({
        color: glow,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    )
    edge.rotation.x = -Math.PI / 2
    rot.add(edge)
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(r * 1.9, 0.006, 0.02),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.55
      })
    )
    blade.position.y = 0.005
    rot.add(blade)
    g.add(rot)
    rotors.push(blade)
  }
  return { group: g, rotors }
}

export class Fleet {
  /** @param {THREE.Scene} scene @param {object} sim createSim 的返回 */
  constructor(scene, sim) {
    this.sim = sim
    this.lineMats = []
    this.drones = {}
    this.links = {}
    const root = new THREE.Group()
    root.name = "fleet"
    scene.add(root)
    this.root = root

    IDS.forEach((id, i) => {
      const hex = THEME.color.uavGlow[i]
      const css = `rgba(${new THREE.Color(hex)
        .toArray()
        .map((v) => Math.round(v * 255))
        .join(",")},1)`
      const model = makeDroneModel(id === "UAV-01", hex)
      const holder = new THREE.Group()
      holder.name = id
      const span = THEME.droneSpan[id]
      model.group.scale.setScalar(span)
      holder.add(model.group)
      // 柔光晕：大而淡，让无人机在象牙白楼群上也醒目（辉光只给真实光源，这里是装饰性的光斑，量很小）
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture(css),
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      )
      halo.scale.setScalar(span * 1.7)
      holder.add(halo)
      // 拾取用的不可见球
      const hit = new THREE.Mesh(
        new THREE.SphereGeometry(span * 0.75, 8, 6),
        new THREE.MeshBasicMaterial({ visible: false })
      )
      hit.userData.id = id
      holder.add(hit)
      root.add(holder)

      // 航迹：最近 4 分钟，亮度从旧到新渐强（加色混合，黑色即透明）
      const trailGeo = new LineGeometry()
      const N = 120
      const pos = new Float32Array(N * 3)
      const col = new Float32Array(N * 3)
      trailGeo.setPositions(pos)
      trailGeo.setColors(col)
      const trailMat = new LineMaterial({
        linewidth: 3,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
      const trail = new Line2(trailGeo, trailMat)
      trail.frustumCulled = false
      root.add(trail)
      this.lineMats.push(trailMat)

      // 到地面的竖线（虚线）和地面落点光斑
      const legGeo = new LineGeometry()
      legGeo.setPositions([0, 0, 0, 0, 1, 0])
      const legMat = new LineMaterial({
        linewidth: 1.4,
        color: new THREE.Color(hex),
        dashed: true,
        dashSize: 4,
        gapSize: 4,
        transparent: true,
        opacity: 0.7,
        depthWrite: false
      })
      const leg = new Line2(legGeo, legMat)
      leg.computeLineDistances()
      leg.frustumCulled = false
      root.add(leg)
      this.lineMats.push(legMat)
      const spot = new THREE.Mesh(
        new THREE.CircleGeometry(1, 24),
        new THREE.MeshBasicMaterial({
          map: glowTexture(css),
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      )
      spot.rotation.x = -Math.PI / 2
      root.add(spot)
      // 视场投影（核验 / 追踪 / 扫描时）：地面上一块淡淡的圆
      const fov = new THREE.Mesh(
        new THREE.CircleGeometry(1, 36),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(hex),
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      )
      fov.rotation.x = -Math.PI / 2
      root.add(fov)

      this.drones[id] = {
        holder,
        model,
        halo,
        trailGeo,
        trail,
        N,
        leg,
        legGeo,
        spot,
        fov,
        hit,
        span
      }
    })

    // 二号机到一号机 / 三号机的链路线：5.8G 实线（蓝），2.4G 虚线（琥珀）
    for (const to of ["UAV-01", "UAV-03"]) {
      const geo = new LineGeometry()
      geo.setPositions([0, 0, 0, 0, 1, 0])
      const mat = new LineMaterial({
        linewidth: 2.2,
        color: new THREE.Color(0x7cc0ff),
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        dashed: false,
        dashSize: 7,
        gapSize: 5
      })
      const line = new Line2(geo, mat)
      line.frustumCulled = false
      root.add(line)
      this.lineMats.push(mat)
      this.links[to] = { line, geo, mat }
    }
    this.t = 0
  }

  /** 每帧更新：snap = sim.at(t)，dt 秒（旋翼转速用） */
  update(snap, dt) {
    const sim = this.sim
    this.t += dt
    const byId = Object.fromEntries(snap.drones.map((d) => [d.id, d]))
    for (const id of IDS) {
      const d = byId[id]
      const o = this.drones[id]
      const p = toW(d.x, d.y, d.z)
      o.holder.position.copy(p)
      // 在空中按显示尺寸画，停在屋顶时缩小（三个起降位只隔 13 m）
      o.holder.scale.setScalar(d.airborne ? 1 : THEME.landedScale)
      // 机头朝向：悬停时保持上次的朝向
      if (d.heading != null) o.holder.rotation.y = d.heading
      // 旋翼：飞行时转得快，停机坪上不转
      const spin = d.airborne ? 38 : 0
      for (const b of o.model.rotors) b.rotation.y += spin * dt
      o.halo.material.opacity = d.airborne ? 0.55 : 0.2

      // 航迹：只在飞行时显示
      const tr = sim.trail(id, snap.t, 7, o.N)
      const pos = []
      const col = []
      const c = new THREE.Color(THEME.color.uavGlow[IDS.indexOf(id)])
      tr.forEach(([x, y, z], i) => {
        const w = toW(x, y, z)
        pos.push(w.x, w.y, w.z)
        const k = Math.pow(i / (o.N - 1), 1.6) * (d.airborne ? 1 : 0)
        col.push(c.r * k, c.g * k, c.b * k)
      })
      o.trailGeo.setPositions(pos)
      o.trailGeo.setColors(col)
      o.trail.visible = d.airborne

      // 竖线与落点
      o.leg.visible = d.airborne
      o.spot.visible = d.airborne
      if (d.airborne) {
        o.legGeo.setPositions([p.x, 1, p.z, p.x, p.y, p.z])
        o.leg.computeLineDistances()
        o.spot.position.set(p.x, 0.9, p.z)
        o.spot.scale.setScalar(o.span * 0.55)
      }
      // 视场投影：核验 / 追踪时更大更亮，扫描时中等，其余不画
      const watching =
        d.airborne && (d.task === 3 || d.task === 6 || d.task === 2)
      o.fov.visible = watching && id !== "UAV-02"
      if (o.fov.visible) {
        o.fov.position.set(p.x, 0.8, p.z)
        o.fov.scale.setScalar(6 + d.alt * (d.task === 2 ? 0.45 : 0.3))
        o.fov.material.opacity = d.task === 2 ? 0.1 : 0.2
      }
    }

    // 链路线：二号机在空中才有；跟着对方的当前链路换色换线型
    const relay = byId["UAV-02"]
    for (const to of ["UAV-01", "UAV-03"]) {
      const l = this.links[to]
      const peer = byId[to]
      const on = relay.airborne && peer.airborne
      l.line.visible = on
      if (!on) continue
      const a = toW(relay.x, relay.y, relay.z),
        b = toW(peer.x, peer.y, peer.z)
      l.geo.setPositions([a.x, a.y, a.z, b.x, b.y, b.z])
      const backup = peer.link === 1
      l.mat.color.set(backup ? 0xe8b04a : 0x7cc0ff)
      l.mat.dashed = backup
      l.mat.linewidth = backup ? 2.6 : 2
      if (backup) l.line.computeLineDistances()
      l.mat.needsUpdate = true
    }
  }

  resize(w, h) {
    for (const m of this.lineMats) m.resolution.set(w, h)
  }

  /** 拾取用的不可见球 */
  hits() {
    return Object.values(this.drones).map((o) => o.hit)
  }

  /** 某架机的世界位置（相机跟随用） */
  worldPos(id) {
    return this.drones[id].holder.position
  }
}

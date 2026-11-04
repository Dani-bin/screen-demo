/**
 * 沙盘上的信息层：盲区标注、疑似 / 确认目标的脉冲环、充电区热源光柱、事件落点、消防通道占用、隐私禁拍区。
 * ----------------------------------------------------------
 * 都是贴在地面（或楼体立面）上的平面和光柱，状态由仿真快照决定，每帧 update(snap, time)。
 * 颜色规则同 tokens.css：疑似 / 预警 = 琥珀，告警 = 红，过期 = 灰，已核验 = 香槟金。
 */
import * as THREE from "three"
import layout from "../data/layout.json"
import { CX, CY, V } from "./theme.js"

const W = (x, y, h = 0) => new THREE.Vector3(x - CX, h, -(y - CY))
const COL = {
  warn: 0xe8b04a,
  alarm: 0xff5a5f,
  stale: 0x8f8372,
  gold: 0xc9a86a,
  goldHi: 0xffd27a,
  ivory: 0xf3ebdd
}

/** 斜纹 + 虚线边框的贴图 */
function hatchTexture(css, border = true) {
  const c = document.createElement("canvas")
  c.width = 256
  c.height = 160
  const g = c.getContext("2d")
  g.fillStyle = css.replace("1)", "0.16)")
  g.fillRect(0, 0, 256, 160)
  g.strokeStyle = css.replace("1)", "0.6)")
  g.lineWidth = 5
  for (let x = -160; x < 300; x += 22) {
    g.beginPath()
    g.moveTo(x, 160)
    g.lineTo(x + 160, 0)
    g.stroke()
  }
  if (border) {
    g.strokeStyle = css
    g.lineWidth = 8
    g.setLineDash([22, 14])
    g.strokeRect(5, 5, 246, 150)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
/** 禁拍区贴图：深色半透明底（像打了马赛克）+ 象牙色斜纹 + 虚线框；用正常混合，亮墙面和草地上都看得出来 */
function maskTexture() {
  const c = document.createElement("canvas")
  c.width = 256
  c.height = 160
  const g = c.getContext("2d")
  g.fillStyle = "rgba(24,19,14,0.5)"
  g.fillRect(0, 0, 256, 160)
  g.strokeStyle = "rgba(243,235,221,0.9)"
  g.lineWidth = 6
  for (let x = -160; x < 300; x += 24) {
    g.beginPath()
    g.moveTo(x, 160)
    g.lineTo(x + 160, 0)
    g.stroke()
  }
  g.strokeStyle = "rgba(243,235,221,1)"
  g.lineWidth = 8
  g.setLineDash([22, 14])
  g.strokeRect(5, 5, 246, 150)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
/** 同心脉冲环贴图 */
function ringTexture(css) {
  const c = document.createElement("canvas")
  c.width = c.height = 256
  const g = c.getContext("2d")
  const gr = g.createRadialGradient(128, 128, 20, 128, 128, 126)
  gr.addColorStop(0, css.replace("1)", "0.28)"))
  gr.addColorStop(0.5, css.replace("1)", "0.1)"))
  gr.addColorStop(1, css.replace("1)", "0)"))
  g.fillStyle = gr
  g.fillRect(0, 0, 256, 256)
  g.strokeStyle = css
  g.lineWidth = 7
  g.beginPath()
  g.arc(128, 128, 96, 0, 7)
  g.stroke()
  g.strokeStyle = css.replace("1)", "0.5)")
  g.lineWidth = 3
  g.beginPath()
  g.arc(128, 128, 120, 0, 7)
  g.stroke()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
const css = (hex) =>
  `rgba(${new THREE.Color(hex)
    .toArray()
    .map((v) => Math.round(v * 255))
    .join(",")},1)`

/** 贴地平面 */
function flat(w, d, map, opacity = 1) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  )
  m.rotation.x = -Math.PI / 2
  m.renderOrder = 2
  return m
}
/** 光柱：圆锥侧面，下亮上淡 */
function beam(radius, height, hex) {
  const c = document.createElement("canvas")
  c.width = 4
  c.height = 64
  const g = c.getContext("2d")
  const gr = g.createLinearGradient(0, 64, 0, 0)
  gr.addColorStop(0, css(hex).replace("1)", "0.7)"))
  gr.addColorStop(1, css(hex).replace("1)", "0)"))
  g.fillStyle = gr
  g.fillRect(0, 0, 4, 64)
  const map = new THREE.CanvasTexture(c)
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.55, radius, height, 20, 1, true),
    new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  )
  m.position.y = height / 2
  m.renderOrder = 3
  return m
}

export class Overlay {
  constructor(scene) {
    this.root = new THREE.Group()
    this.root.name = "overlay"
    scene.add(this.root)
    this.pulse = []
    this.hits = [] // 拾取用的不可见体块（盲区），建标注时往里加
    this.tex = {
      warn: hatchTexture(css(COL.warn)),
      gold: hatchTexture(css(COL.gold)),
      mask: maskTexture(),
      ringWarn: ringTexture(css(COL.warn)),
      ringAlarm: ringTexture(css(COL.alarm)),
      ringGold: ringTexture(css(COL.goldHi)),
      ringStale: ringTexture(css(COL.stale))
    }
    this._buildBlind()
    this._buildTarget()
    this._buildHeat()
    this._buildPrivacy()
    this._events = new Map()
  }

  // ---- 盲区标注：未核验 = 琥珀斜纹虚线框；已核验 = 香槟金淡斜纹
  _buildBlind() {
    this.blind = {}
    for (const p of layout.points.filter((q) => q.kind === "blind")) {
      const m = flat(p.w ?? 24, p.d ?? 16, this.tex.warn, 0.9)
      m.position.copy(W(p.x, p.y, 0.9))
      this.root.add(m)
      const hit = new THREE.Mesh(
        new THREE.BoxGeometry((p.w ?? 24) + 2, 26, (p.d ?? 16) + 2),
        new THREE.MeshBasicMaterial({ visible: false })
      )
      hit.position.copy(W(p.x, p.y, 13))
      hit.userData.id = p.id
      this.root.add(hit)
      this.hits.push(hit)
      this.blind[p.id] = { mesh: m, checked: null }
    }
  }

  // ---- 搜寻目标：BS-04 内，疑似 = 琥珀脉冲环，确认 = 金色环 + 光柱
  _buildTarget() {
    const g = new THREE.Group()
    const ringA = flat(34, 34, this.tex.ringWarn)
    const ringB = flat(34, 34, this.tex.ringWarn)
    ringA.position.y = ringB.position.y = 1.3
    const bm = beam(4, 46, COL.warn)
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(1.2, 10, 8),
      new THREE.MeshBasicMaterial({ color: COL.goldHi })
    )
    dot.position.y = 1.6
    g.add(ringA, ringB, bm, dot)
    g.visible = false
    this.root.add(g)
    this.target = { g, ringA, ringB, beam: bm, dot }
  }

  // ---- 充电区热源：地面光斑 + 光柱，颜色随温度等级（预警琥珀 / 告警红 / 过期灰）
  _buildHeat() {
    this.heat = {}
    for (const p of layout.points.filter((q) => q.kind === "charge")) {
      const g = new THREE.Group()
      g.position.copy(W(p.x, p.y))
      const ring = flat(28, 28, this.tex.ringWarn)
      ring.position.y = 1.2
      const bm = beam(4.5, 38, COL.warn)
      g.add(ring, bm)
      g.visible = false
      this.root.add(g)
      this.heat[p.id] = { g, ring, beam: bm, level: null }
    }
  }

  // ---- 隐私禁拍区：幼儿园地面 + B07 / B08 的南立面（对着中央湖景的住宅，窗户朝南）
  _buildPrivacy() {
    const g = new THREE.Group()
    g.name = "privacy"
    const kg = layout.buildings.find((b) => b.id === "KG-01")
    const f = flat(kg.w + 6, kg.d + 6, this.tex.mask, 0.95)
    f.material.blending = THREE.NormalBlending
    f.position.copy(W(kg.cx, kg.cy, 1.0))
    g.add(f)
    for (const id of ["B07", "B08"]) {
      const b = layout.buildings.find((x) => x.id === id)
      const h = b.h * V * 0.4
      const wall = new THREE.Mesh(
        new THREE.PlaneGeometry(b.w * 0.9, h),
        new THREE.MeshBasicMaterial({
          map: this.tex.mask,
          transparent: true,
          opacity: 0.95,
          depthWrite: false
        })
      )
      wall.position.copy(W(b.cx, b.cy - b.d / 2 - 1.6, h / 2 + 3))
      wall.renderOrder = 2
      g.add(wall)
    }
    this.root.add(g)
    this.privacy = g
  }

  /** 事件落点：每个未办结事件一个标记（占用车辆用虚线框 + 小车，其余用脉冲环 + 光柱） */
  _eventMarker(ev) {
    const g = new THREE.Group()
    const hex = ev.priority === "urgent" ? COL.alarm : COL.warn
    const ring = flat(
      26,
      26,
      ev.priority === "urgent" ? this.tex.ringAlarm : this.tex.ringWarn
    )
    ring.position.y = 1.4
    g.add(ring)
    if (ev.type === "FP") {
      const rect = flat(16, 6, this.tex.warn, 0.95)
      rect.position.y = 1.2
      g.add(rect)
      const car = new THREE.Mesh(
        new THREE.BoxGeometry(4.6, 1.5 * V, 2.2),
        new THREE.MeshStandardMaterial({ color: 0xc9864a, roughness: 0.6 })
      )
      car.position.y = 0.75 * V
      car.castShadow = true
      g.add(car)
    } else if (ev.type === "PT") {
      const man = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.55, 1.5, 4, 8),
        new THREE.MeshBasicMaterial({ color: COL.goldHi })
      )
      man.position.y = 1.9
      g.add(man)
    }
    g.add(beam(3.2, 30, hex))
    g.position.copy(W(ev.focus[0], ev.focus[1]))
    this.root.add(g)
    return { g, ring }
  }

  /** 每帧更新。snap = sim.at(t)，time = 秒（脉冲相位用） */
  update(snap, time) {
    // 盲区（搜寻不在进行时整组隐藏）
    for (const z of snap.blind.zones) {
      const b = this.blind[z.id]
      b.mesh.visible = snap.search.active
      if (b.checked !== z.checked) {
        b.checked = z.checked
        b.mesh.material.map = z.checked ? this.tex.gold : this.tex.warn
        b.mesh.material.opacity = z.checked ? 0.55 : 0.9
        b.mesh.material.needsUpdate = true
      }
    }
    // 搜寻目标
    const tg = snap.target
    const T = this.target
    T.g.visible = tg.status > 0
    if (tg.status > 0) {
      T.g.position.copy(W(tg.x, tg.y))
      const k = (time * 0.9) % 1
      T.ringA.scale.setScalar(0.55 + k * 0.7)
      T.ringA.material.opacity = (1 - k) * 0.95
      T.ringB.scale.setScalar(0.55 + ((k + 0.5) % 1) * 0.7)
      T.ringB.material.opacity = (1 - ((k + 0.5) % 1)) * 0.95
      const confirmed = tg.status === 2
      const tex = confirmed ? this.tex.ringGold : this.tex.ringWarn
      if (T.ringA.material.map !== tex) {
        T.ringA.material.map = T.ringB.material.map = tex
        T.ringA.material.needsUpdate = T.ringB.material.needsUpdate = true
      }
      T.beam.visible = confirmed
      T.dot.material.color.setHex(confirmed ? COL.goldHi : COL.warn)
    }
    // 充电区热源
    for (const [id, h] of Object.entries(this.heat)) {
      const th = snap.thermal[id]
      const lv = th.level
      const show = lv === "warn" || lv === "alarm" || lv === "stale"
      h.g.visible = show
      if (!show) continue
      if (h.level !== lv) {
        h.level = lv
        const tex =
          lv === "alarm"
            ? this.tex.ringAlarm
            : lv === "stale"
              ? this.tex.ringStale
              : this.tex.ringWarn
        h.ring.material.map = tex
        h.ring.material.needsUpdate = true
        h.beam.material.map?.dispose?.()
        h.g.remove(h.beam)
        h.beam = beam(
          4.5,
          38,
          lv === "alarm" ? COL.alarm : lv === "stale" ? COL.stale : COL.warn
        )
        h.g.add(h.beam)
      }
      h.beam.visible = lv !== "stale"
      const k = 0.5 + 0.5 * Math.sin(time * (lv === "alarm" ? 5 : 3))
      h.ring.scale.setScalar(0.85 + 0.25 * k)
      h.beam.material.opacity = 0.55 + 0.35 * k
    }
    // 事件落点：未办结的事件（走失搜寻和热源由上面单独画，不重复）
    const live = snap.events.filter(
      (e) =>
        ["pending", "dispatched", "processing", "review"].includes(e.status) &&
        e.type !== "SR" &&
        e.type !== "TH" &&
        e.type !== "FC"
    )
    const keep = new Set(live.map((e) => e.id))
    for (const [id, m] of this._events)
      if (!keep.has(id)) {
        this.root.remove(m.g)
        this._events.delete(id)
      }
    for (const e of live) {
      let m = this._events.get(e.id)
      if (!m) {
        m = this._eventMarker(e)
        this._events.set(e.id, m)
      }
      m.ring.scale.setScalar(
        0.8 + 0.3 * (0.5 + 0.5 * Math.sin(time * 3 + e.focus[0]))
      )
    }
  }
}

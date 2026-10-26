/*
 * 全链剖面里的光纤测温（「光纤测温」图层）
 * ----------------------------------------------------------
 * - 敷设了测温光纤的井下皮带（慢数据 w.dts 里有哪几条就画哪几条），在煤流光管的前下方（朝镜头一侧）
 *   画一根细光纤，每段按温度着色：常温青色 → 越热越偏琥珀，超过温差线（全线均温 + 10 °C）紫色。
 *   和诊断中心的全线温度条同一套色相；温度条里最冷的一档是深青色，总览里深青色在暗处看不见，所以常温一律用亮青色
 * - 仿真里的热点很窄（σ 约 1 m），总览一段光纤十来米才一个像素，直接取样会漏掉；
 *   所以每段取前后 HALF m 内的最高温，热点在屏上至少有一小截
 * - 超过温差线的地方再放一个紫色热点标记（亮点 + 一圈朝镜头扩散的环）
 * - 10 s 随慢数据更新一次颜色和热点
 */
import * as THREE from "three"
import { TOKENS } from "./theme.js"
import { BELTS, pathAt, normalOf } from "./section.js"

const STEP = 5 // 每 5 m 一圈光纤截面
const HALF = 20 // 每圈取前后 20 m 内的最高温
const RADIUS = 3.6 // 光纤管半径（剖面坐标）
const RADIAL = 6
const COOL = new THREE.Color(TOKENS.data)
const WARM = new THREE.Color(TOKENS.coal)
const HOT = new THREE.Color(TOKENS.predict)

/**
 * 总览光纤的颜色：k = 温度在 [全线最低, 温差线] 里的位置；前一半青色，后一半青 → 琥珀，超过温差线紫色。
 * 亮度：常温压暗一点（只是一根细线），越热越亮，紫色进辉光
 */
function fiberColor(v, lo, avg, out) {
  if (v > avg + 10) return out.copy(HOT).multiplyScalar(2.6)
  const k = Math.max(0, Math.min(1, (v - lo) / (avg + 10 - lo)))
  const w = Math.max(0, k - 0.5) * 2
  return out
    .copy(COOL)
    .lerp(WARM, w)
    .multiplyScalar(0.75 + 0.9 * w)
}

/** 光纤所在的位置：皮带中心沿截面朝下 8、往镜头一侧 22（煤流光管的前下方，从斜上方看不被光管挡住） */
function fiberPoint(belt, chainage) {
  const { pos, tan } = pathAt(belt, chainage / BELTS[belt].L)
  return pos.addScaledVector(normalOf(tan), -8).add(new THREE.Vector3(0, 0, 22))
}

/** 一条皮带的光纤管：按里程每 STEP m 一圈，颜色属性每次更新时重填 */
function buildFiber(id) {
  const L = BELTS[id].L
  const n = Math.ceil(L / STEP)
  const pts = []
  for (let i = 0; i <= n; i++) pts.push(fiberPoint(id, Math.min(L, i * STEP)))
  // 管子沿弧长均匀取 n 段，和上面按里程均匀取样一一对应（剖面路径的弧长和里程成正比）
  const geo = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(pts),
    n,
    RADIUS,
    RADIAL,
    false
  )
  const col = new Float32Array(geo.attributes.position.count * 3)
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3))
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
  )
  return { id, n, mesh, col }
}

export class DtsLayer {
  constructor(scene) {
    // group：总览容器（下钻时随总览隐藏）；layer：图层开关
    this.group = new THREE.Group()
    this.layer = new THREE.Group()
    this.group.add(this.layer)
    scene.add(this.group)
    this.fibers = new Map() // 皮带 → 光纤管（第一次收到它的测温数据时再建）
    this.spots = new THREE.Group()
    this.layer.add(this.spots)
    this.dotGeo = new THREE.SphereGeometry(5, 12, 10)
    this.ringGeo = new THREE.RingGeometry(0.86, 1, 48)
    this.dotMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(TOKENS.predict).multiplyScalar(2.6),
      toneMapped: false
    })
    this.ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(TOKENS.predict).multiplyScalar(1.4),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    })
  }

  setVisible(on) {
    this.layer.visible = on
  }

  /** 慢数据（10 s 一次）：w.dts[皮带] = 每米温度（Float32Array） */
  update(w) {
    const c = new THREE.Color()
    this.spots.clear()
    for (const [id, T] of Object.entries(w?.dts || {})) {
      if (!BELTS[id] || !T?.length) continue
      let f = this.fibers.get(id)
      if (!f) {
        f = buildFiber(id)
        this.fibers.set(id, f)
        this.layer.add(f.mesh)
      }
      let sum = 0
      let lo = Infinity
      for (const v of T) {
        sum += v
        if (v < lo) lo = v
      }
      const avg = sum / T.length
      // 每圈的显示温度 = 前后 HALF m 内的最高温；一圈 RADIAL + 1 个顶点同色
      const per = RADIAL + 1
      for (let i = 0; i <= f.n; i++) {
        const x = Math.min(T.length - 1, i * STEP)
        let v = -Infinity
        const b = Math.min(T.length - 1, x + HALF)
        for (let k = Math.max(0, x - HALF); k <= b; k++) if (T[k] > v) v = T[k]
        fiberColor(v, lo, avg, c)
        for (let j = 0; j < per; j++) c.toArray(f.col, (i * per + j) * 3)
      }
      f.mesh.geometry.attributes.color.needsUpdate = true

      // 热点：超过温差线的每一连续段取最高点，放一个紫色标记
      let best = null
      for (let x = 0; x <= T.length; x++) {
        const hot = x < T.length && T[x] > avg + 10
        if (hot && (!best || T[x] > best.v)) best = { x, v: T[x] }
        if (!hot && best) {
          const p = fiberPoint(id, best.x)
          const dot = new THREE.Mesh(this.dotGeo, this.dotMat)
          const ring = new THREE.Mesh(this.ringGeo, this.ringMat)
          dot.position.copy(p)
          ring.position.copy(p)
          ring.userData.ring = true
          this.spots.add(dot, ring)
          best = null
        }
      }
    }
  }

  /** 每帧：热点环朝镜头扩散、渐隐（所有环同相，共用一个材质） */
  tick(t, camera) {
    if (!this.layer.visible || !this.group.visible) return
    const k = (t * 0.6) % 1
    this.ringMat.opacity = (1 - k) * 0.85
    for (const r of this.spots.children) {
      if (!r.userData.ring) continue
      r.quaternion.copy(camera.quaternion)
      r.scale.setScalar(10 + 34 * k)
    }
  }
}

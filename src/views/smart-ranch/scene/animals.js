/*
 * 智慧牧场 牛羊（远景是点，拉近换成单体低模）
 * ----------------------------------------------------------
 * 羊按群管理（只有头羊戴项圈），群里每只羊的位置 = 群中心 + 固定的随机偏移 × 散开程度
 * （采食约 70 m、饮水 40 m、夜宿 22 m）；牛每头都有项圈，位置直接取仿真里的单头坐标。
 * 仿真每秒给一份状态，这里在前后两份之间按时间插值，画面连续不跳。
 *
 * 远近切换：相机到观察点的距离 < NEAR_IN 时显示单体模型、隐藏点；> NEAR_OUT 时反过来，中间淡入淡出。
 */
import * as THREE from "three"

import { cowGeometry, propMaterial, sheepGeometry } from "./props.js"

const NEAR_IN = 3600
const NEAR_OUT = 6500
/** 拉近后单体模型的放大倍数（真实尺寸在 1 km 视野里太小，适当放大便于辨认） */
const MODEL_SCALE = 2.2

const POINT_VERT = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  uniform float uScale;
  uniform float uDpr;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = size * uDpr * clamp(uScale / -mv.z, 1.0, 5.0);
  }
`
const POINT_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vColor, smoothstep(0.5, 0.32, d) * uOpacity);
    #include <colorspace_fragment>
  }
`

/** 按字符串播种的伪随机数 */
function rng(seed) {
  let a = 0
  for (const ch of String(seed))
    a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) >>> 0) + 1
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const gauss = (r) =>
  Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r())
const SPREAD = { graze: 70, drink: 40, rest: 22 }

export class Animals {
  /** host：RanchScene（提供 heightAt / theme）；state：第一份仿真状态，用来确定数量 */
  constructor(host, state) {
    this.host = host
    this.group = new THREE.Group()
    const a = host.theme.animal
    // 每只羊的固定偏移（单位半径），一群一组
    this.flocks = state.herds
      .filter((h) => h.kind === "sheep")
      .map((h) => {
        const r = rng(h.id)
        const offs = Array.from({ length: h.head }, () => {
          const ang = r() * Math.PI * 2
          const rad = Math.abs(gauss(r))
          return [
            Math.cos(ang) * rad * 1.3,
            Math.sin(ang) * rad * 0.8,
            r() * Math.PI * 2
          ]
        })
        return { id: h.id, offs }
      })
    this.cattle = state.herds
      .filter((h) => h.kind === "cattle")
      .map((h) => ({ id: h.id, head: h.head }))
    this.nSheep = this.flocks.reduce((s, f) => s + f.offs.length, 0)
    this.nLead = this.flocks.length * 3
    this.nCow = this.cattle.reduce((s, c) => s + c.head, 0)
    const n = this.nSheep + this.nLead + this.nCow

    // 远景：一个 Points，羊、头羊、牛依次排
    const geo = new THREE.BufferGeometry()
    this.pos = new Float32Array(n * 3)
    const col = new Float32Array(n * 3)
    const size = new Float32Array(n)
    const c = new THREE.Color()
    for (let i = 0; i < n; i++) {
      const isCow = i >= this.nSheep + this.nLead
      const isLead = !isCow && i >= this.nSheep
      c.set(isCow ? a.cattle : a.sheep).convertSRGBToLinear()
      col.set([c.r, c.g, c.b], i * 3)
      size[i] = isCow ? 3.4 : isLead ? 4.2 : 2.2
    }
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3))
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3))
    geo.setAttribute("size", new THREE.BufferAttribute(size, 1))
    this.colors = col
    this.sizes = size
    this.pointMat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uScale: { value: 9000 },
        uDpr: { value: host.renderer.getPixelRatio() },
        uOpacity: { value: 1 }
      }
    })
    this.points = new THREE.Points(geo, this.pointMat)
    this.points.frustumCulled = false
    this.points.renderOrder = 2
    this.group.add(this.points)

    // 近景：单体模型
    const mat = propMaterial()
    this.sheepMesh = new THREE.InstancedMesh(
      sheepGeometry(),
      mat,
      this.nSheep + this.nLead
    )
    this.cowMesh = new THREE.InstancedMesh(cowGeometry(), mat, this.nCow)
    for (const m of [this.sheepMesh, this.cowMesh]) {
      m.frustumCulled = false
      m.visible = false
      this.group.add(m)
    }
    this.prev = state
    this.next = state
    this.t0 = performance.now()
    this.dt = 1000
    this.alarmCow = null
    this.heading = new Float32Array(this.nCow)
  }

  /** 收到新的一份仿真状态：从当前插值位置开始，往新状态走 */
  push(state, alarm) {
    this.prev = this.next
    this.next = state
    const now = performance.now()
    this.dt = Math.max(200, now - this.t0)
    this.t0 = now
    // 越界的那头牛点变红、放大
    const id = alarm?.kind === "fence" ? alarm.target : null
    if (id !== this.alarmCow) {
      this.alarmCow = id
      this.recolor()
    }
  }

  recolor() {
    const a = this.host.theme.animal
    const c = new THREE.Color()
    let i = this.nSheep + this.nLead
    for (const h of this.next.herds.filter((x) => x.kind === "cattle")) {
      for (let k = 0; k < h.head; k++, i++) {
        const hit =
          `${h.id}-${String(k + 1).padStart(3, "0")}` === this.alarmCow
        c.set(hit ? a.alarm : a.cattle).convertSRGBToLinear()
        this.colors.set([c.r, c.g, c.b], i * 3)
        this.sizes[i] = hit ? 7 : 3.4
      }
    }
    this.points.geometry.attributes.color.needsUpdate = true
    this.points.geometry.attributes.size.needsUpdate = true
    // 近景模型：越界那头牛整体染成告警色（顶点色 × 实例色）
    const white = new THREE.Color(1, 1, 1)
    const red = new THREE.Color(a.alarm)
      .convertSRGBToLinear()
      .multiplyScalar(1.6)
    let ci = 0
    for (const h of this.next.herds.filter((x) => x.kind === "cattle"))
      for (let k = 0; k < h.head; k++, ci++) {
        const hit =
          `${h.id}-${String(k + 1).padStart(3, "0")}` === this.alarmCow
        this.cowMesh.setColorAt(ci, hit ? red : white)
      }
    if (this.cowMesh.instanceColor)
      this.cowMesh.instanceColor.needsUpdate = true
  }

  /** 每帧：插值位置、更新点和（近景时）模型；camDist 为相机到观察点的距离 */
  update(camDist) {
    const host = this.host
    const k = Math.min(1, (performance.now() - this.t0) / this.dt)
    const lerp = (a, b) => a + (b - a) * k
    const near = THREE.MathUtils.smoothstep(camDist, NEAR_IN, NEAR_OUT)
    this.pointMat.uniforms.uOpacity.value = near
    const showModels = near < 0.99
    this.points.visible = near > 0.01
    this.sheepMesh.visible = showModels
    this.cowMesh.visible = showModels

    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const sc = new THREE.Vector3(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE)
    const v = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    let i = 0
    let si = 0
    const herdsA = new Map(this.prev.herds.map((h) => [h.id, h]))
    for (const f of this.flocks) {
      const a = herdsA.get(f.id)
      const b = this.next.herds.find((h) => h.id === f.id)
      const cx = lerp(a.pos[0], b.pos[0])
      const cy = lerp(a.pos[1], b.pos[1])
      const spread = lerp(SPREAD[a.activity], SPREAD[b.activity])
      for (const [ox, oy, rot] of f.offs) {
        const X = cx + ox * spread
        const Y = cy + oy * spread
        const h = host.heightAt(X, Y, 1)
        this.pos[i * 3] = X
        this.pos[i * 3 + 1] = h
        this.pos[i * 3 + 2] = -Y
        if (showModels) {
          v.set(X, h - host.theme.exag * 1 + 0.2, -Y)
          q.setFromAxisAngle(up, rot)
          m4.compose(v, q, sc)
          this.sheepMesh.setMatrixAt(si++, m4)
        }
        i++
      }
    }
    // 头羊项圈
    for (const f of this.flocks) {
      const a = herdsA.get(f.id)
      const b = this.next.herds.find((h) => h.id === f.id)
      for (let l = 0; l < 3; l++) {
        const X = lerp(a.leads[l].pos[0], b.leads[l].pos[0])
        const Y = lerp(a.leads[l].pos[1], b.leads[l].pos[1])
        const h = host.heightAt(X, Y, 2)
        this.pos.set([X, h, -Y], i * 3)
        if (showModels) {
          v.set(X, h - host.theme.exag * 2 + 0.2, -Y)
          q.setFromAxisAngle(up, l * 2.1)
          m4.compose(v, q, sc)
          this.sheepMesh.setMatrixAt(si++, m4)
        }
        i++
      }
    }
    // 牛：朝向按移动方向
    let ci = 0
    for (const c of this.cattle) {
      const a = herdsA.get(c.id)
      const b = this.next.herds.find((h) => h.id === c.id)
      for (let n = 0; n < c.head; n++) {
        const pa = a.cows[n]
        const pb = b.cows[n]
        const X = lerp(pa[0], pb[0])
        const Y = lerp(pa[1], pb[1])
        const h = host.heightAt(X, Y, 1.5)
        this.pos.set([X, h, -Y], i * 3)
        if (showModels) {
          const dx = pb[0] - pa[0]
          const dy = pb[1] - pa[1]
          if (dx * dx + dy * dy > 0.01) this.heading[ci] = Math.atan2(dy, dx)
          v.set(X, h - host.theme.exag * 1.5 + 0.2, -Y)
          q.setFromAxisAngle(up, this.heading[ci])
          m4.compose(v, q, sc)
          this.cowMesh.setMatrixAt(ci, m4)
        }
        ci++
        i++
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true
    if (showModels) {
      this.sheepMesh.instanceMatrix.needsUpdate = true
      this.cowMesh.instanceMatrix.needsUpdate = true
    }
  }

  dispose() {
    this.points.geometry.dispose()
    this.pointMat.dispose()
    this.sheepMesh.dispose()
    this.cowMesh.dispose()
  }
}

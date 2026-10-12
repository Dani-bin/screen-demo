/*
 * 综合能源补给站 画面效果（对照设计稿还原夜景质感）
 * ----------------------------------------------------------
 * - WetStreaks  湿路面倒影：每个光源（路灯灯头、罩棚彩色檐口、价格立柱……）在地面上拉出一条朝向镜头的光带。
 *               湿沥青上的灯光倒影总是沿「光源脚下 → 观察者」方向延伸，正交相机方向固定，所以每帧只需转一个角度。
 *               所有光带共用一个 InstancedMesh（实例颜色 = 光色 × 强度），几十条也只有一次绘制。
 * - baseGlow    沙盘底座沿真实外轮廓的蓝色底光：侧壁底部向上渐隐的泛光 + 地面一圈向外渐隐的光晕
 * - vehicleLights 车辆前大灯 / 尾灯光点、车前地面光斑、车底接触阴影（地面是烘焙贴图，不接收实时阴影）
 */
import * as THREE from "three"

import { fadeTexture, glowTexture } from "./sprites"

// ---------------------------------------------------------------- 贴图

let streakTex = null

/** 倒影光带贴图：沿长度方向从光源脚下（v=0）最亮向远端渐隐，横向是柔和的高斯形 */
function streakTexture() {
  if (streakTex) return streakTex
  const w = 64
  const h = 256
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  const g = c.getContext("2d")
  const img = g.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1) // 0 = 光源脚下
    const along = Math.pow(1 - t, 1.6) * (0.35 + 0.65 * Math.exp(-t * 6))
    for (let x = 0; x < w; x++) {
      const s = (x / (w - 1)) * 2 - 1
      const across = Math.exp(-s * s * 5)
      const v = Math.round(255 * along * across)
      const i = (y * w + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  streakTex = new THREE.CanvasTexture(c)
  streakTex.colorSpace = THREE.SRGBColorSpace
  return streakTex
}

// ---------------------------------------------------------------- 湿路面倒影

export class WetStreaks {
  /**
   * sources：[{ pos: Vector3（光源位置）, color: hex, k: 强度, width, length }]
   */
  constructor(sources) {
    const geo = new THREE.PlaneGeometry(1, 1)
    geo.rotateX(-Math.PI / 2) // 平铺在地面：局部 x 为宽、z 为长
    geo.translate(0, 0, 0.5) // 原点放在光带近端（光源脚下）
    // UV：v=0 在近端
    const uv = geo.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i))
    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshBasicMaterial({
        map: streakTexture(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false
      }),
      sources.length
    )
    this.mesh.renderOrder = 2
    this.mesh.frustumCulled = false
    this.sources = sources
    const col = new THREE.Color()
    sources.forEach((s, i) => {
      col.setHex(s.color).multiplyScalar(s.k)
      this.mesh.setColorAt(i, col)
    })
    this.mesh.instanceColor.needsUpdate = true
    this._m = new THREE.Matrix4()
    this._q = new THREE.Quaternion()
    this._p = new THREE.Vector3()
    this._s = new THREE.Vector3()
    this._yaw = null
  }

  /** 按相机水平方向转动所有光带（方向变化很小时跳过） */
  update(camera, target) {
    const dx = camera.position.x - target.x
    const dz = camera.position.z - target.z
    const yaw = Math.atan2(dx, dz)
    if (this._yaw !== null && Math.abs(yaw - this._yaw) < 0.002) return
    this._yaw = yaw
    this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    this.sources.forEach((s, i) => {
      this._p.set(s.pos.x, 0.08, s.pos.z)
      this._s.set(s.width, 1, s.length)
      this._m.compose(this._p, this._q, this._s)
      this.mesh.setMatrixAt(i, this._m)
    })
    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}

// ---------------------------------------------------------------- 底座光

/**
 * 沿闭合轮廓（three 坐标 [x, *, z]）生成一圈光带：内圈外扩 grow0、高 y0，外圈外扩 grow1、高 y1。
 * 外扩相同、高度不同 → 贴在侧壁上的竖直光带；高度相同、外扩不同 → 地面一圈光晕
 */
export function outlineStrip(outline, grow0, grow1, y0, y1, color, opacity) {
  const n = outline.length
  // 外法线：取相邻点切线的垂直方向，并用「指向轮廓中心的反方向」校正朝外
  let cx = 0
  let cz = 0
  for (const p of outline) {
    cx += p[0] / n
    cz += p[2] / n
  }
  const pos = []
  const uv = []
  const idx = []
  for (let i = 0; i <= n; i++) {
    const p = outline[i % n]
    const a = outline[(i - 1 + n) % n]
    const b = outline[(i + 1) % n]
    let nx = b[2] - a[2]
    let nz = -(b[0] - a[0])
    const L = Math.hypot(nx, nz) || 1
    nx /= L
    nz /= L
    if (nx * (p[0] - cx) + nz * (p[2] - cz) < 0) {
      nx = -nx
      nz = -nz
    }
    const u = i / n
    pos.push(
      p[0] + nx * grow0,
      y0,
      p[2] + nz * grow0,
      p[0] + nx * grow1,
      y1,
      p[2] + nz * grow1
    )
    uv.push(u, 0, u, 1)
    if (i < n) {
      const k = i * 2
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  return new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color,
      map: fadeTexture(),
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    })
  )
}

// ---------------------------------------------------------------- 车灯与车底阴影

const lightMats = {}

function lightMat(key, rgb, opacity = 1) {
  if (!lightMats[key]) {
    lightMats[key] = new THREE.SpriteMaterial({
      map: glowTexture(rgb),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity
    })
  }
  return lightMats[key]
}

let coneMat = null
let shadowMat = null
const planeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)

/** 车前地面光斑（暖白，加色） */
function cone(len, wid, x) {
  if (!coneMat) {
    coneMat = new THREE.MeshBasicMaterial({
      map: glowTexture("255,236,200"),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.55
    })
  }
  const m = new THREE.Mesh(planeGeo, coneMat)
  m.scale.set(len, 1, wid)
  m.position.set(x + len / 2 - 0.5, 0.07, 0)
  m.renderOrder = 1
  return m
}

/** 车底接触阴影：径向渐变的半透明黑色贴片 */
export function contactShadow(len, wid) {
  if (!shadowMat) {
    shadowMat = new THREE.MeshBasicMaterial({
      map: glowTexture("0,0,0"),
      transparent: true,
      depthWrite: false,
      opacity: 0.9
    })
  }
  const m = new THREE.Mesh(planeGeo, shadowMat)
  m.scale.set(len * 1.25, 1, wid * 1.5)
  m.position.y = 0.06
  m.renderOrder = -1
  return m
}

/**
 * 给车辆部件挂车灯：front / rear 为部件局部包围盒（Box3），
 * head：前大灯 + 地面光斑（牵引车 / 小车）；tail：尾灯（小车 / 挂车）
 */
export function vehicleLights(
  part,
  box,
  { head = false, tail = false, truck = false } = {}
) {
  const hw = (box.max.z - box.min.z) / 2
  if (head) {
    const y = truck ? 1.25 : 0.7
    for (const s of [-1, 1]) {
      const sp = new THREE.Sprite(lightMat("head", "255,246,225"))
      sp.position.set(box.max.x + 0.05, y, s * (hw - 0.35))
      sp.scale.setScalar(truck ? 1.6 : 1.2)
      part.add(sp)
    }
    part.add(cone(truck ? 13 : 9, truck ? 6 : 4.4, box.max.x))
  }
  if (tail) {
    for (const s of [-1, 1]) {
      const sp = new THREE.Sprite(lightMat("tail", "255,40,50", 0.9))
      sp.position.set(box.min.x - 0.05, truck ? 1.0 : 0.85, s * (hw - 0.3))
      sp.scale.setScalar(0.9)
      part.add(sp)
    }
  }
}

export function disposeEffects() {
  for (const m of Object.values(lightMats)) m.dispose()
  coneMat?.dispose()
  shadowMat?.dispose()
  streakTex?.dispose()
  streakTex = null
}

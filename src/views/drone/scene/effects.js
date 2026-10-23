/*
 * 无人机巡检监控平台 · 环境动效（只表达场景本身的状态，不承载业务数据）
 * ----------------------------------------------------------
 *   - 冷却塔白汽：循环水场 4 座冷却塔顶上的白色蒸汽（定稿里很显眼），缓慢上升、顺着风向飘散
 * 相位一律由仿真时刻派生（tick 收到的 t），回放暂停 / 冻结时停在那一刻。
 *
 * 白汽用一个 Points 粒子系统画（每团一个点，大小、透明度逐点给）：原先 56 个 Sprite 每个一次 draw call，
 * 主画面和机载画面各画一遍（比对第 32 轮性能统计）。点的像素大小按当前相机的视场角和渲染目标高度换算，
 * 和 Sprite 一样表示世界尺寸（米）。
 */
import * as THREE from "three"
import { w2t } from "./theme.js"
import SITE from "../data/site.js"

const PER_TOWER = 14 // 每座冷却塔的白汽团数

/** 柔边圆点贴图（中心实、边缘透明） */
function softTexture() {
  const c = document.createElement("canvas")
  c.width = c.height = 64
  const g = c.getContext("2d")
  const grd = g.createRadialGradient(32, 32, 1, 32, 32, 32)
  grd.addColorStop(0, "rgba(255,255,255,0.9)")
  grd.addColorStop(0.5, "rgba(255,255,255,0.45)")
  grd.addColorStop(1, "rgba(255,255,255,0)")
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const VERT = `
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // aSize 是世界尺寸（米），换算成像素：uScale = 渲染目标高度 / (2·tan(竖直视场角 / 2))
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`
const FRAG = `
  uniform sampler2D map;
  uniform vec3 color;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(color, texture2D(map, gl_PointCoord).a * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`

export class Effects {
  constructor(scene) {
    this.group = new THREE.Group()
    this.group.name = "EFFECTS"
    scene.add(this.group)
    this.tex = softTexture()
    // 每团白汽的出发点、相位和随机种子（相位沿高度错开）
    this.puffs = []
    for (const tw of SITE.coolingTowers)
      for (let i = 0; i < PER_TOWER; i++)
        this.puffs.push({
          x: tw.x,
          y: tw.y,
          z: tw.h,
          r: tw.dTop / 2,
          phase: i / PER_TOWER,
          seed: Math.random()
        })
    const n = this.puffs.length
    const geo = new THREE.BufferGeometry()
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(n * 3), 3)
    )
    geo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(n), 1))
    geo.setAttribute(
      "aAlpha",
      new THREE.BufferAttribute(new Float32Array(n), 1)
    )
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: this.tex },
        // 米灰色：定稿里白汽被暖光染过、半透明，近乎纯白时在暗场里最抢眼（评审意见，比对第 36 轮，原 #f2ece6）
        color: { value: new THREE.Color(0xb9ab9c) },
        uScale: { value: 1 }
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false
    })
    this.points = new THREE.Points(geo, this.mat)
    // 白汽一直在动，包围球每帧都会变：不做视锥裁剪（总共一次 draw call）
    this.points.frustumCulled = false
    const size = new THREE.Vector2()
    // 每次绘制前按当前相机（主画面 / 机载画面 / 缩略图）和渲染目标换算点的像素大小
    this.points.onBeforeRender = (renderer, _scene, camera) => {
      const rt = renderer.getRenderTarget()
      const h = rt ? rt.height : renderer.getDrawingBufferSize(size).y
      const fov = camera.isPerspectiveCamera ? camera.fov : 30
      this.mat.uniforms.uScale.value = h / (2 * Math.tan((fov * Math.PI) / 360))
    }
    this.group.add(this.points)
  }

  /** t：仿真时刻（毫秒）。风从西南吹来（与气象站估算的风向一致），白汽往东北飘 */
  tick(t) {
    const sec = (t || 0) / 1000
    const geo = this.points.geometry
    const pos = geo.attributes.position
    const sz = geo.attributes.aSize
    const al = geo.attributes.aAlpha
    this.puffs.forEach((u, i) => {
      const k = (sec / 9 + u.phase) % 1 // 9 s 一个循环：从塔口升起 → 变大变淡
      const rise = k * 34
      const drift = k * k * 22
      pos.setXYZ(
        i,
        ...w2t(
          u.x + drift * 0.7 + Math.sin(u.seed * 30) * 2,
          u.y + drift * 0.7 + Math.cos(u.seed * 20) * 2,
          u.z + 2 + rise
        )
      )
      sz.setX(i, u.r * 1.1 + k * 18)
      al.setX(
        i,
        0.3 * Math.sin(Math.PI * Math.min(1, k * 1.15)) * (1 - k * 0.5)
      )
    })
    pos.needsUpdate = sz.needsUpdate = al.needsUpdate = true
  }

  dispose() {
    this.points.geometry.dispose()
    this.mat.dispose()
    this.tex.dispose()
  }
}

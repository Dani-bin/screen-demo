/*
 * 无人机巡检监控平台 · 机载画面（第二相机）
 * ----------------------------------------------------------
 * 定稿右下的"机载画面"窗：跟随 / 选中的那架无人机的实时视角。
 *   - 相机放在机身下方的云台处：悬停监视时对准事件点，否则按航向 + 云台俯角往前下方看；
 *   - 先渲染到离屏纹理，再用全屏四边形画回主画布上机载窗口所在的那块区域（视口 + 剪裁，不回读像素）；
 *   - 红外模式：渲染前把各材质临时换成按材质名给定"温度"的灰度材质（THEME.thermal：塔器、管线、
 *     钢结构热，地坪、绿化冷，水面最冷），后处理把灰度映射成铁红伪彩（冷 → 深紫，热 → 橙黄），加传感器噪点；
 *   - 气体泄漏的气羽只放在机载相机能看到的图层（1）上：红外里是深紫色冷羽，可见光里是淡白雾。
 * snapshot() 给事件流截缩略图（从对象旁边斜看一眼，读回成 dataURL，只在新事件出现时调一次）。
 */
import * as THREE from "three"
import { THEME, w2t } from "./theme.js"
import { DOCKS } from "../data/layout.js"

const DEG = Math.PI / 180
const POV_LAYER = 1

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`
const FRAG = `varying vec2 vUv; uniform sampler2D tScene; uniform float uIR; uniform float uTime;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  vec3 ironbow(float t){
    vec3 c0 = vec3(0.01, 0.0, 0.05), c1 = vec3(0.16, 0.02, 0.40), c2 = vec3(0.52, 0.05, 0.56),
         c3 = vec3(0.88, 0.22, 0.30), c4 = vec3(1.0, 0.58, 0.10), c5 = vec3(1.0, 0.96, 0.72);
    if (t < 0.2) return mix(c0, c1, t / 0.2);
    if (t < 0.42) return mix(c1, c2, (t - 0.2) / 0.22);
    if (t < 0.62) return mix(c2, c3, (t - 0.42) / 0.2);
    if (t < 0.82) return mix(c3, c4, (t - 0.62) / 0.2);
    return mix(c4, c5, (t - 0.82) / 0.18);
  }
  void main(){
    vec3 col = texture2D(tScene, vUv).rgb;
    if (uIR > 0.5) {
      // 红外模式下场景已换成灰度"温度"材质，亮度就是温度
      float heat = dot(col, vec3(0.30, 0.59, 0.11));
      heat += (hash(vUv * vec2(640.0, 512.0) + uTime) - 0.5) * 0.035;
      col = pow(ironbow(clamp(heat, 0.0, 1.0)), vec3(2.2));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`

/** 柔边圆点贴图（气羽用） */
function puffTexture() {
  const c = document.createElement("canvas")
  c.width = c.height = 64
  const g = c.getContext("2d")
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32)
  grd.addColorStop(0, "rgba(255,255,255,1)")
  grd.addColorStop(1, "rgba(255,255,255,0)")
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export class Pov {
  constructor(host) {
    this.host = host
    this.cam = new THREE.PerspectiveCamera(THEME.pov.fov, 16 / 9, 1, 6000)
    // 红外"温度"材质：原材质 → 灰度 Lambert 材质（按需生成、缓存）。
    // 天空球（半径 12 km）在机载相机的远裁剪面（6 km）以外，机载画面里本来就看不到天空，不用换
    this.thermal = new Map()
    this.cam.layers.enable(POV_LAYER)
    this.rt = new THREE.WebGLRenderTarget(16, 9, {
      type: THREE.HalfFloatType,
      samples: 4
    })
    this.quadScene = new THREE.Scene()
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.rt.texture },
        uIR: { value: 1 },
        uTime: { value: 0 }
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false
    })
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat))
    this.target = null // {drone, el, mode}
    this.time = 0
    // 气羽：一团柔边粒子，只在机载相机里可见。
    // 不做深度测试：泄漏点在装置框架、管廊中间，斜看时气羽会被挡在后面；
    // 定稿里它作为"AI 识别到的气羽"浮在画面上（比对第 29 轮）
    this.plume = new THREE.Group()
    this.puffs = []
    const tex = puffTexture()
    for (let i = 0; i < 40; i++) {
      const m = new THREE.SpriteMaterial({
        map: tex,
        color: 0x2a0d4a,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        depthTest: false,
        fog: false
      })
      const s = new THREE.Sprite(m)
      s.layers.set(POV_LAYER)
      s.userData.seed = Math.random()
      this.plume.add(s)
      this.puffs.push(s)
    }
    this.plume.visible = false
    host.scene.add(this.plume)
  }

  /**
   * 设定机载窗口：drone 为无人机编号，el 为窗口 DOM 元素（取它在画布上的位置），mode 为 visible / ir。
   * 传 null 关闭（不再渲染第二相机）。
   */
  setTarget(t) {
    this.target = t
  }

  _pose(droneId) {
    const h = this.host
    const dockId = Object.keys(DOCKS).find((k) => DOCKS[k].drone === droneId)
    return h.poses?.[dockId]?.drone
      ? { ...h.poses[dockId].drone, dock: dockId }
      : null
  }

  /** 机载相机摆位：返回是否有画面 */
  _place(cam, d) {
    const h = this.host
    if (d.state === "docked") {
      // 舱内：机场舱盖相机往前平视
      const k = DOCKS[d.dock]
      cam.position.set(...w2t(k.x, k.y - 1.2, k.roof + 1.6))
      cam.lookAt(...w2t(k.x, k.y + 60, k.roof + 6))
      return true
    }
    cam.position.set(...w2t(d.x, d.y, d.z - 0.6))
    const e = d.eventId && h.state?.events.find((x) => x.id === d.eventId)
    if (e) cam.lookAt(...w2t(e.x, e.y, 6))
    else {
      const hd = d.heading * DEG
      const p = d.gimbalPitch * DEG
      const dir = [
        Math.sin(hd) * Math.cos(p),
        Math.cos(hd) * Math.cos(p),
        Math.sin(p)
      ]
      cam.lookAt(
        ...w2t(d.x + dir[0] * 100, d.y + dir[1] * 100, d.z + dir[2] * 100)
      )
    }
    return true
  }

  /** 每帧：渲染到离屏纹理，再画回主画布上机载窗口那块区域 */
  render() {
    const t = this.target
    const h = this.host
    if (!t || !t.el || !h.drones) return
    const d = this._pose(t.drone)
    if (!d) return
    const cr = h.canvas.getBoundingClientRect()
    const r = t.el.getBoundingClientRect()
    const x = r.left - cr.left
    const y = cr.bottom - r.bottom
    if (r.width < 4 || r.height < 4) return
    const dpr = h.renderer.getPixelRatio()
    const W = Math.round(r.width * dpr)
    const H = Math.round(r.height * dpr)
    if (this.rt.width !== W || this.rt.height !== H) this.rt.setSize(W, H)
    this.cam.aspect = r.width / r.height
    this.cam.updateProjectionMatrix()
    this._place(this.cam, d)
    // 气羽飘散、传感器噪点的相位跟仿真时刻走（回放暂停时画面也停住）
    this.time = (h._lastT || 0) / 1000
    this._plume(d, t.mode)
    const ren = h.renderer
    const overlaysVisible = h.overlays.group.visible
    h.overlays.group.visible = false
    h.skyMesh.position.copy(this.cam.position)
    const swapped = t.mode === "ir" ? this._toThermal() : null
    ren.setRenderTarget(this.rt)
    ren.render(h.scene, this.cam)
    ren.setRenderTarget(null)
    if (swapped) this._restore(swapped)
    h.overlays.group.visible = overlaysVisible
    h.skyMesh.position.copy(h.camera.position)
    this.mat.uniforms.uIR.value = t.mode === "ir" ? 1 : 0
    this.mat.uniforms.uTime.value = this.time
    const auto = ren.autoClear
    ren.autoClear = false
    ren.setViewport(x, y, r.width, r.height)
    ren.setScissor(x, y, r.width, r.height)
    ren.setScissorTest(true)
    ren.render(this.quadScene, this.quadCam)
    ren.setScissorTest(false)
    ren.setViewport(0, 0, cr.width, cr.height)
    ren.autoClear = auto
  }

  /**
   * 原材质对应的红外"温度"材质：自发光 0.8 h 打底，再带 0.35 h 的受光（场景灯光下约 +0.15 h – +0.4 h），
   * 迎光的塔身到橙黄—白、阴影里偏红，保留体积感（受光 0.1 h 时整片停在红橙、层次太平，比对第 29 轮）
   */
  _thermalOf(m) {
    let t = this.thermal.get(m)
    if (!t) {
      const h = THEME.thermal[m.name] ?? THEME.thermal.default
      t = new THREE.MeshLambertMaterial({
        name: m.name,
        color: new THREE.Color(h * 0.35, h * 0.35, h * 0.35),
        emissive: new THREE.Color(h * 0.8, h * 0.8, h * 0.8),
        side: m.side
      })
      this.thermal.set(m, t)
    }
    return t
  }

  /** 把园区、机场、无人机的网格换成"温度"材质，返回换下来的原材质（叠加层组在机载渲染时本就隐藏，跳过） */
  _toThermal() {
    const h = this.host
    const saved = []
    const walk = (o) => {
      if (o === h.overlays.group || o === h.skyMesh) return
      if (o.isMesh && !o.material.isShaderMaterial) {
        saved.push([o, o.material])
        o.material = Array.isArray(o.material)
          ? o.material.map((m) => this._thermalOf(m))
          : this._thermalOf(o.material)
      }
      for (const c of o.children) walk(c)
    }
    walk(h.scene)
    return saved
  }

  _restore(saved) {
    for (const [o, m] of saved) o.material = m
  }

  /** 监视气体泄漏时显示气羽（顺风飘散，循环）；红外下深紫（冷），可见光下淡白 */
  _plume(d, mode, ev = null) {
    const e =
      ev ||
      (d.eventId && this.host.state?.events.find((x) => x.id === d.eventId))
    const on = !!e && e.type === "gas"
    this.plume.visible = on
    if (!on) return
    // 从泄漏点出发、顺风（西南风）往东横向铺开，越远越大越淡；定稿里气羽贴着管廊高度横着飘，
    // 宽度约占机载画面的一半（比对第 30 轮：原先只往上飘、团小，偏在准星右上方）
    for (const s of this.puffs) {
      const k = (this.time * 0.12 + s.userData.seed) % 1
      const spread = 3 + k * 26
      s.position.set(
        ...w2t(
          e.x + k * 55 + Math.sin(s.userData.seed * 40) * spread * 0.35,
          e.y + k * 10 + Math.cos(s.userData.seed * 30) * spread * 0.35,
          7 + k * 9
        )
      )
      s.scale.setScalar(6 + k * 24)
      s.material.color.set(mode === "ir" ? 0x1e0838 : 0xd9dde2)
      // 红外下更浓：定稿里气羽是一股醒目的深紫黑色冷羽（比对第 29 轮由 0.6 调到 0.85）；
      // 扩散到末端仍留约 35 % 的浓度，大团才看得见（第 30 轮）
      s.material.opacity = (mode === "ir" ? 0.85 : 0.25) * (1 - 0.65 * k)
    }
  }

  /**
   * 事件缩略图：从对象斜上方 45° 看一眼，读回成 dataURL（w×h px）。红外类事件用伪彩。
   */
  snapshot(e, w = 168, h = 112) {
    const host = this.host
    if (!host.drones) return null
    const rt = new THREE.WebGLRenderTarget(w * 2, h * 2, {
      type: THREE.HalfFloatType
    })
    const out = new THREE.WebGLRenderTarget(w * 2, h * 2)
    // 读回的是 8 位像素：让着色器输出 sRGB，画到 canvas 上颜色才对
    out.texture.colorSpace = THREE.SRGBColorSpace
    const cam = new THREE.PerspectiveCamera(40, w / h, 1, 3000)
    cam.layers.enable(POV_LAYER)
    if (e._cam) {
      // 设备缩略图：直接给定 three.js 坐标的机位
      cam.position.set(...e._cam)
      cam.lookAt(...e._look)
    } else {
      const dist = 70
      // 气体泄漏对准气羽中段（往东 18 m），整股气羽都在画面里
      const cx = e.type === "gas" ? e.x + 18 : e.x
      cam.position.set(...w2t(cx - dist * 0.35, e.y - dist * 0.7, dist * 0.75))
      cam.lookAt(...w2t(cx, e.y, e.type === "gas" ? 8 : 4))
    }
    const ren = host.renderer
    const ov = host.overlays.group.visible
    host.overlays.group.visible = false
    host.skyMesh.position.copy(cam.position)
    // 气体泄漏的抓拍带上气羽
    const plumeWas = this.plume.visible
    if (e.type === "gas") this._plume({ eventId: e.id }, e.cam, e)
    const swapped = e.cam === "ir" ? this._toThermal() : null
    ren.setRenderTarget(rt)
    ren.render(host.scene, cam)
    if (swapped) this._restore(swapped)
    this.mat.uniforms.tScene.value = rt.texture
    this.mat.uniforms.uIR.value = e.cam === "ir" ? 1 : 0
    ren.setRenderTarget(out)
    ren.render(this.quadScene, this.quadCam)
    const buf = new Uint8Array(w * 2 * h * 2 * 4)
    ren.readRenderTargetPixels(out, 0, 0, w * 2, h * 2, buf)
    ren.setRenderTarget(null)
    this.mat.uniforms.tScene.value = this.rt.texture
    this.plume.visible = plumeWas
    host.overlays.group.visible = ov
    host.skyMesh.position.copy(host.camera.position)
    rt.dispose()
    out.dispose()
    const cv = document.createElement("canvas")
    cv.width = w * 2
    cv.height = h * 2
    const ctx = cv.getContext("2d")
    const img = ctx.createImageData(w * 2, h * 2)
    for (let y = 0; y < h * 2; y++)
      img.data.set(
        buf.subarray((h * 2 - 1 - y) * w * 2 * 4, (h * 2 - y) * w * 2 * 4),
        y * w * 2 * 4
      )
    ctx.putImageData(img, 0, 0)
    return cv.toDataURL("image/jpeg", 0.82)
  }

  /** 设备详情里的模型缩略图：按设备包围盒从东南斜上方取景（可见光） */
  deviceThumb(id, w = 200, h = 120) {
    const host = this.host
    const root = host.devices.get(id)
    if (!root) return null
    const box = new THREE.Box3().setFromObject(root)
    const c = box.getCenter(new THREE.Vector3())
    const size = Math.max(box.getSize(new THREE.Vector3()).length(), 2)
    const fake = { x: c.x, y: -c.z, cam: "visible", type: "thumb", id: "thumb" }
    const dist = size * 1.1
    const shot = {
      ...fake,
      _cam: [c.x + dist * 0.55, c.y + dist * 0.55, c.z + dist * 0.6],
      _look: [c.x, c.y, c.z]
    }
    return this.snapshot(shot, w, h)
  }

  dispose() {
    this.rt.dispose()
    this.mat.dispose()
    for (const t of this.thermal.values()) t.dispose()
  }
}

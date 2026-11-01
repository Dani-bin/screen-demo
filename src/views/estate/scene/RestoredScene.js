/**
 * 还原版场景（img2threejs 还原设计稿 docs/design/estate/design/v1.png）
 * ----------------------------------------------------------
 * 对外接口和 EstateScene（程序化实时版）/ PhotoScene（离线渲染照片版）一致，index.vue / tour.js / PinLayer 不用改：
 *   ready / onPick / onFrame / onProgress / onInteract / onTime，hour / touring / frozen，
 *   select / setLayer / goHome / flyToPlan / setTime / tweenTime / intro / setFrozen / dispose，
 *   stage / projectPlan / headingDeg / topOf / info（面板每帧靠它们跟着画面走）
 *
 * 内容（scene/img2/）：
 *   - createEstateModel.ts   规格生成的部件树：底座、楼栋（节点名 = 楼号）、屋顶构件、水系、周边白模…
 *   - extras.js              地面贴图（设计稿按评审机位反投影）、窗、壁柱、树（位置颜色取自设计稿）、路灯、车
 *   - look.js                光、接触阴影、水面高光、辉光 + 镜头后处理
 * 构图：设计稿 v1.png 里 AI 场景图（1536×864）放在 96 px 边距内、放大 1.125 倍，所以舞台里的相机比"铺满"更退一点，
 *   投影中心在舞台 (960, 582)。窗口比例不同时，沙盘和面板仍然对齐（做法同实时版 / /smart-conveyor）。
 * 时间：设计时刻 18:00 就是评审用的那个画面；白天 / 夜里按"小时"在几档灯光参数之间插值
 *   （地面是设计稿烘焙光，只能整体调亮度；窗光、路灯、树冠自发光、辉光、背景单独调）。
 */
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { LineSegments2 } from "three/addons/lines/LineSegments2.js"
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js"
import { LineMaterial } from "three/addons/lines/LineMaterial.js"
import { THEME } from "./theme.js"
import { backdropTexture } from "./lens.js"
import camRef from "./img2/camera-ref.json"
import foot from "./img2/footprints.json"
import river from "./img2/river.json"
import { createObjectModel } from "./img2/createEstateModel.ts"
import { buildExtras, litMaterials, BL_WINDOW_EMIS } from "./img2/extras.js"
import {
  setupLights,
  addContactShadows,
  addWaterSparkle,
  createComposer
} from "./img2/look.js"

const BASE = import.meta.env.BASE_URL
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const clamp01 = (v) => Math.max(0, Math.min(1, v))
const smooth = (t) => t * t * (3 - 2 * t)
const nextFrame = () => new Promise((r) => setTimeout(r, 16))

/** 设计稿 v1：AI 场景图（1536×864）放在 (96, 96)、放大 1.125 倍；评审机位 fov 28° 对应 864 px 高 */
const SCENE_K = 1.125
const SCENE_OY = 96
const FOC_REF = 864 / 2 / Math.tan((camRef.fovDeg * Math.PI) / 360) // 评审图里的焦距（像素）
const FOCAL_DESIGN = FOC_REF * SCENE_K // 舞台（1920×1080 设计像素）里的焦距
const PRINCIPAL_Y = SCENE_OY + (864 / 2) * SCENE_K // 投影中心在舞台里的纵坐标（582）

/**
 * 灯光参数档（按小时插值）：18:00 附近就是评审用的那个画面（全部 1.0）。
 * ground：地面贴图亮度（贴图是 18:00 的烘焙光）；win / lamp：窗光、路灯；tree：树冠自发光；
 * hemi / sun：半球光、主光强度；bloom：辉光强度；bg：背景亮度；cool：夜里整体偏冷的程度
 */
const KEYS = [
  {
    h: 9,
    ground: 1.85,
    win: 0.12,
    lamp: 0.05,
    tree: 0.62,
    hemi: 1.6,
    sun: 3.0,
    sunWarm: 0.0,
    bloom: 0.08,
    bg: 1.1,
    cool: 0
  },
  {
    h: 16,
    ground: 1.4,
    win: 0.45,
    lamp: 0.35,
    tree: 0.46,
    hemi: 1.25,
    sun: 2.3,
    sunWarm: 0.5,
    bloom: 0.18,
    bg: 0.95,
    cool: 0
  },
  {
    h: 18.2,
    ground: 1.0,
    win: 1.0,
    lamp: 1.0,
    tree: 0.34,
    hemi: 1.0,
    sun: 1.6,
    sunWarm: 1.0,
    bloom: 0.32,
    bg: 0.8,
    cool: 0
  },
  {
    h: 21.5,
    ground: 0.42,
    win: 1.5,
    lamp: 1.6,
    tree: 0.1,
    hemi: 0.42,
    sun: 0.3,
    sunWarm: 0.3,
    bloom: 0.62,
    bg: 0.45,
    cool: 1
  }
]

function lookAt(hour) {
  const h = Math.min(KEYS[KEYS.length - 1].h, Math.max(KEYS[0].h, hour))
  let i = 0
  while (i < KEYS.length - 2 && h > KEYS[i + 1].h) i++
  const a = KEYS[i]
  const b = KEYS[i + 1]
  const t = smooth(clamp01((h - a.h) / (b.h - a.h)))
  const out = {}
  for (const k of Object.keys(a))
    if (k !== "h") out[k] = a[k] + (b[k] - a[k]) * t
  return out
}

/** 部件 id → 布局里的楼栋 / 配套编号（楼栋的屋顶冠、核心筒、商业体的扶梯盒…都算它的一部分）；周边白模不可点 */
function layoutIdOf(id) {
  if (/^ctx_/.test(id)) return null
  const m = id.match(/^(B\d+|CL01|ML01|SC01|KG01|PM01|MT01|HP01|E01|SH01)/)
  return m ? m[1] : null
}

function haloTexture() {
  const c = document.createElement("canvas")
  c.width = c.height = 128
  const g = c.getContext("2d")
  const gr = g.createRadialGradient(64, 64, 6, 64, 64, 62)
  gr.addColorStop(0, "rgba(255,210,122,0.9)")
  gr.addColorStop(0.55, "rgba(255,210,122,0.35)")
  gr.addColorStop(1, "rgba(255,210,122,0)")
  g.fillStyle = gr
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

export class RestoredScene {
  constructor(canvas, o) {
    this.canvas = canvas
    this.layout = o.layout
    this.onPick = o.onPick ?? (() => {})
    this.onFrame = o.onFrame ?? (() => {})
    this.onProgress = o.onProgress ?? (() => {})
    this.onInteract = null
    this.onTime = null
    this.month = o.month ?? 10
    this.day = o.day ?? 30
    this.hour = o.hour ?? 18
    this.frozen = false
    this.selected = null
    this.layerId = null
    this.touring = false
    this._tween = null
    this._timeTween = null
    this._outlines = new Map()
    this._halos = new Map()
    this._shown = new Set()
    this._layerShown = []
    this._size = { w: 1, h: 1 }
    this.clockT = 0
    this.ready = this._init()
  }

  // ================================================================ 初始化

  async _init() {
    const { canvas } = this
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: "high-performance"
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    // 色调映射由后处理最后的 OutputPass 统一做一次（Neutral），渲染器本身不做
    renderer.toneMapping = THREE.NoToneMapping
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    // 太阳不动（时间只调强度和颜色），阴影图只渲一次
    renderer.shadowMap.autoUpdate = false
    renderer.info.autoReset = false
    this.renderer = renderer

    const scene = new THREE.Scene()
    try {
      // 展厅背景：设计稿四周的虚化展厅（中间压暗，沙盘盖住）
      const bg = await new THREE.TextureLoader().loadAsync(
        `${BASE}estate/showroom.webp`
      )
      bg.colorSpace = THREE.SRGBColorSpace
      scene.background = bg
    } catch {
      scene.background = backdropTexture()
    }
    this.scene = scene
    this.onProgress(0.05)
    await nextFrame()

    // 部件树（生成器）→ 以部件编号命名节点 → 受光材质
    const root = createObjectModel({ castShadow: true, receiveShadow: true })
    scene.add(root)
    const rt = root.userData.sculptRuntime
    for (const [id, node] of Object.entries(rt.nodes)) node.name = id
    for (const [id, mesh] of Object.entries(rt.meshes)) {
      mesh.name = `${id}_mesh`
      mesh.userData.id = layoutIdOf(id)
    }
    this.rt = rt
    this.mats = litMaterials(rt)
    this.onProgress(0.3)
    await nextFrame()

    // 手写实例：地面贴图、窗、树、灯、车
    const { group, hidden, handles } = await buildExtras({
      baseUrl: BASE,
      runtime: rt
    })
    for (const id of hidden) if (rt.meshes[id]) rt.meshes[id].visible = false
    root.add(group)
    this.handles = handles
    this.onProgress(0.7)
    await nextFrame()

    const groundInfo = await (
      await fetch(`${BASE}estate/img2/ground_info.json`)
    ).json()
    scene.add(addContactShadows(groundInfo))
    this.sparkle = addWaterSparkle(rt)
    scene.add(this.sparkle)
    const lights = setupLights(scene)
    this.hemi = lights.hemi
    this.sun = lights.sun

    // 拾取：只有"有楼栋编号"的可见网格
    this.pickables = Object.values(rt.meshes).filter(
      (m) => m.userData.id && m.visible
    )
    this.raycaster = new THREE.Raycaster()

    // 相机：评审机位（和设计稿同取景），近远面收紧让深度更准（景深靠它）
    const cam = new THREE.PerspectiveCamera(THEME.fov, 16 / 9, 120, 2600)
    this.camera = cam
    this.home = {
      position: new THREE.Vector3(...camRef.three.position),
      target: new THREE.Vector3(...camRef.three.target)
    }
    this.baseCenter = new THREE.Vector3(foot.base.cx, 0, -foot.base.cy)
    const focus = this.home.position.distanceTo(this.home.target)
    const post = createComposer({
      renderer,
      scene,
      camera: cam,
      width: 4,
      height: 4,
      focus
    })
    this.composer = post.composer
    this.bloom = post.bloom
    this.lens = post.lens

    const controls = new OrbitControls(cam, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = THEME.controls.minDistance
    controls.maxDistance = THEME.controls.maxDistance
    controls.minPolarAngle = THEME.controls.minPolar
    controls.maxPolarAngle = THEME.controls.maxPolar
    controls.screenSpacePanning = false
    controls.zoomSpeed = 0.8
    this.controls = controls
    this._applyHome()
    controls.addEventListener("start", () => {
      this._tween = null
      this.onInteract?.()
    })

    // 点选 / 悬停
    this._down = null
    canvas.addEventListener(
      "pointerdown",
      (e) => (this._down = [e.clientX, e.clientY, performance.now()])
    )
    canvas.addEventListener("pointerup", (e) => {
      const d = this._down
      this._down = null
      if (!d) return
      if (
        Math.hypot(e.clientX - d[0], e.clientY - d[1]) < 5 &&
        performance.now() - d[2] < 500
      ) {
        this.onPick(this.pick(e.clientX, e.clientY))
      }
    })
    let lastMove = 0
    canvas.addEventListener("pointermove", (e) => {
      const n = performance.now()
      if (n - lastMove < 90 || e.buttons) return
      lastMove = n
      canvas.style.cursor = this.pick(e.clientX, e.clientY) ? "pointer" : ""
    })
    canvas.addEventListener("wheel", () => this.onInteract?.(), {
      passive: true
    })

    this._ro = new ResizeObserver(() => this.resize())
    this._ro.observe(canvas)
    this.resize()
    this.applyLight()
    renderer.shadowMap.needsUpdate = true
    this.clock = new THREE.Timer()
    this._fps = { frames: 0, last: performance.now(), value: 0 }
    renderer.setAnimationLoop(() => this._frame())
    this.onProgress(1)
  }

  // ================================================================ 光照与时间

  setTime(hour) {
    this.hour = hour
    this.applyLight()
  }

  applyLight() {
    if (!this.handles) return
    const k = lookAt(this.hour)
    this.light = k
    // 地面（烘焙光）整体亮度
    this.handles.ground.color.setScalar(k.ground)
    // 窗光、路灯头：材质色乘数 × 每个实例自己的颜色
    this.handles.facadeGain.value = k.win
    // Blender 楼栋的窗玻璃：自发光贴图 × 强度（白天暗、夜里亮）
    for (const m of this.handles.blWindow ?? [])
      m.emissiveIntensity = BL_WINDOW_EMIS * k.win
    // Blender 楼栋的墙面 / 屋面：自发光跟着天光走（和生成器楼体材质一样）
    for (const m of this.handles.blSurface ?? [])
      m.emissiveIntensity = Math.min(1.2, Math.max(0.3, k.hemi))
    this.handles.lampHeads.color.set("#ffd9a0").multiplyScalar(2.2 * k.lamp)
    this.handles.crownEmis.value = k.tree
    // 楼体自带的自发光（沙盘楼体里有灯）：商业体暖光内芯跟着窗光走，其余墙体 / 白模跟着天光走（夜里暗下去）
    const daylight = Math.min(1.2, Math.max(0.3, k.hemi))
    for (const [id, m] of Object.entries(this.mats)) {
      if (m.userData.baseEmis === undefined)
        m.userData.baseEmis = m.emissiveIntensity
      const f = id === "mat_mall_core" ? 0.3 + 0.7 * k.win : daylight
      m.emissiveIntensity = m.userData.baseEmis * f
    }
    this.hemi.intensity = k.hemi
    this.sun.intensity = k.sun
    // 主光：白天偏白，傍晚偏暖，夜里偏冷
    this.sun.color
      .set(0xffffff)
      .lerp(new THREE.Color(0xffe0b8), k.sunWarm)
      .lerp(new THREE.Color(0x9fb0e0), k.cool * 0.6)
    this.hemi.color.set(0xfff6ec).lerp(new THREE.Color(0xa9b8e8), k.cool * 0.7)
    this.scene.backgroundIntensity = k.bg
    this.bloom.strength = k.bloom
    this.lens.uniforms.warm.value.set(
      1.03 - 0.1 * k.cool,
      1.0,
      0.94 + 0.2 * k.cool
    )
  }

  /** 平滑地把时间拨到某个时刻（导览"一天光影"用） */
  tweenTime(to, ms = 6000, onDone) {
    this._timeTween = { from: this.hour, to, t0: performance.now(), ms, onDone }
  }

  // ================================================================ 版面

  /** 舞台缩放（CSS 像素 / 设计像素）与舞台左上角 */
  stage() {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    const u = Math.min(w / THEME.designSize[0], h / THEME.designSize[1])
    return {
      u,
      ox: (w - THEME.designSize[0] * u) / 2,
      oy: (h - THEME.designSize[1] * u) / 2,
      w,
      h
    }
  }

  resize() {
    const { u, ox, oy, w, h } = this.stage()
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    const pr = this.renderer.getPixelRatio()
    this.lens.uniforms.resolution.value.set(w * pr, h * pr)
    this.lens.uniforms.maxBlur.value = 9 * pr
    this.lens.uniforms.tiltAmount.value = 4 * pr
    const [dw, dh] = THEME.designSize
    const cam = this.camera
    cam.aspect = w / h
    cam.fov = (2 * Math.atan(h / 2 / (FOCAL_DESIGN * u)) * 180) / Math.PI
    // 投影中心：舞台中心再往下 (PRINCIPAL_Y − 540) 个设计像素（设计稿里场景图的中心在 y = 582）
    cam.setViewOffset(
      w,
      h,
      w / 2 - ox - (dw / 2) * u,
      h / 2 - oy - (dh / 2) * u - (PRINCIPAL_Y - dh / 2) * u,
      w,
      h
    )
    cam.updateProjectionMatrix()
    for (const m of this._lineMats ?? []) m.resolution.set(w, h)
    this._size = { w, h }
  }

  // ================================================================ 镜头

  _applyHome() {
    this.camera.position.copy(this.home.position)
    this.controls.target.copy(this.home.target)
    this.camera.lookAt(this.home.target)
    this.controls.update()
  }

  /** 飞到某个目标：相机在目标点的球面坐标上，azimuth 0 = 从正南往北看，正值向东绕 */
  flyToPlan(x, y, o = {}) {
    const { dist = 260, polar = 37, azimuth = 0, duration = 1.6, h = 0 } = o
    const target = new THREE.Vector3(x, h, -y)
    const p = (polar * Math.PI) / 180
    const a = (azimuth * Math.PI) / 180
    const pos = target
      .clone()
      .add(
        new THREE.Vector3(
          Math.sin(a) * Math.sin(p) * dist,
          Math.cos(p) * dist,
          Math.cos(a) * Math.sin(p) * dist
        )
      )
    this._flyTo(pos, target, duration)
  }

  _flyTo(pos, target, duration = 1.6) {
    this._tween = {
      from: {
        pos: this.camera.position.clone(),
        target: this.controls.target.clone()
      },
      to: { pos, target },
      t0: performance.now(),
      ms: duration * 1000
    }
  }

  headingDeg() {
    this._dir = this._dir ?? new THREE.Vector3()
    this.camera.getWorldDirection(this._dir)
    return (Math.atan2(this._dir.x, -this._dir.z) * 180) / Math.PI
  }

  /** 开场：从更高更远、偏一个角度的位置飞到定稿机位 */
  intro(duration = 3.2) {
    const h = this.home
    const dir = h.position.clone().sub(h.target)
    const start = h.target
      .clone()
      .add(
        dir
          .multiplyScalar(1.45)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.75)
      )
    start.y = h.position.y * 1.2
    this.camera.position.copy(start)
    this.controls.target.copy(h.target)
    this._flyTo(h.position.clone(), h.target.clone(), duration)
  }

  goHome(duration = 1.6) {
    this.deselect()
    this.setLayer(null)
    this._flyTo(this.home.position.clone(), this.home.target.clone(), duration)
  }

  /** 逐区比对用的 ID 图：还原版没有做（评审用 scripts/estate/img2/ 的实验页），保持接口兼容 */
  renderIdMask() {
    return { png: null, map: {} }
  }

  // ================================================================ 选中、图层

  /** 平面点（含高度）→ 画布 CSS 像素；visible = 在画面内且在相机前面 */
  projectPlan(x, y, h = 0) {
    const v = new THREE.Vector3(x, h, -y).project(this.camera)
    const { w, h: ch } = this._size
    return {
      x: (v.x * 0.5 + 0.5) * w,
      y: (-v.y * 0.5 + 0.5) * ch,
      visible: v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15
    }
  }

  /** 对象在平面上的外框：楼栋 / 配套用布局里的 cx、cy、w、d */
  info(id) {
    return (
      this.layout.buildings.find((b) => b.id === id) ??
      this.layout.amenities.find((a) => a.id === id) ??
      null
    )
  }

  /** 对象屋顶 / 顶部高度（标签、引线锚点用）：取还原模型里实际的体积，没有就用布局值 */
  topOf(id) {
    const tops = foot.footprints
      .filter((f) => f.id === id || f.id.startsWith(`${id}_s`))
      .map((f) => f.top)
    if (tops.length) return Math.max(...tops)
    return this.info(id)?.height ?? 0
  }

  pick(clientX, clientY) {
    if (!this.pickables) return null
    const r = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0]
    return hit?.object.userData.id ?? null
  }

  /** 轮廓线：楼体用立体边线，没有三维体量的对象（湖、河、步道、水池……）用地面外框 */
  _outline(id) {
    if (this._outlines.has(id)) return this._outlines.get(id)
    const mat = new LineMaterial({
      color: THEME.color.goldHi,
      linewidth: 2.6,
      transparent: true,
      opacity: 0.95,
      depthTest: false
    })
    this._lineMats = this._lineMats ?? []
    this._lineMats.push(mat)
    if (this._size) mat.resolution.set(this._size.w, this._size.h)
    const pos = []
    const bodies = this.pickables.filter((m) => m.userData.id === id)
    if (bodies.length) {
      const v = new THREE.Vector3()
      for (const m of bodies) {
        m.updateWorldMatrix(true, false)
        const e = new THREE.EdgesGeometry(m.geometry, 25)
        const p = e.attributes.position
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld)
          pos.push(v.x, v.y, v.z)
        }
        e.dispose()
      }
    } else {
      for (const ring of this._planOutline(id)) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]
          const b = ring[(i + 1) % ring.length]
          pos.push(a[0], 1.0, -a[1], b[0], 1.0, -b[1])
        }
      }
    }
    const geo = new LineSegmentsGeometry()
    geo.setPositions(pos.length ? pos : [0, 0, 0, 0, 0, 0])
    const line = new LineSegments2(geo, mat)
    line.renderOrder = 20
    line.visible = false
    this.scene.add(line)
    this._outlines.set(id, line)
    return line
  }

  /** 没有三维楼体的对象的地面外框（平面米） */
  _planOutline(id) {
    const a = this.info(id)
    if (!a) return []
    const ellipse = (cx, cy, rx, ry, n = 72) =>
      Array.from({ length: n }, (_, i) => [
        cx + rx * Math.cos((i / n) * Math.PI * 2),
        cy + ry * Math.sin((i / n) * Math.PI * 2)
      ])
    if (id === "LK01") return [ellipse(a.cx, a.cy, a.w / 2 + 1, a.d / 2 + 1)]
    if (id === "TR01")
      return [
        ellipse(
          this.info("LK01").cx,
          this.info("LK01").cy,
          a.w / 2 + 6,
          a.d / 2 + 6
        )
      ]
    if (id === "RV01") {
      // 用实测的北岸 / 南缘曲线
      const cols = river.columns
      return [
        [
          ...cols.map((c) => [c[0], c[1]]),
          ...cols.map((c) => [c[0], c[2]]).reverse()
        ]
      ]
    }
    const w = a.w / 2
    const d = a.d / 2
    return [
      [
        [a.cx - w, a.cy - d],
        [a.cx + w, a.cy - d],
        [a.cx + w, a.cy + d],
        [a.cx - w, a.cy + d]
      ]
    ]
  }

  _halo(id) {
    if (this._halos.has(id)) return this._halos.get(id)
    const a = this.info(id)
    this._haloTex = this._haloTex ?? haloTexture()
    const mat = new THREE.MeshBasicMaterial({
      map: this._haloTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.4
    })
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
    m.rotation.x = -Math.PI / 2
    m.scale.set(
      Math.min((a.w ?? 20) + 22, 140),
      Math.min((a.d ?? 20) + 22, 140),
      1
    )
    m.position.set(a.cx, 1.1, -a.cy)
    m.renderOrder = 4
    m.visible = false
    this.scene.add(m)
    this._halos.set(id, m)
    return m
  }

  _show(id, on) {
    this._outline(id).visible = on
    this._halo(id).visible = on
    if (on) this._shown.add(id)
    else this._shown.delete(id)
  }

  select(id, o = {}) {
    if (this.selected) this._show(this.selected, false)
    this.selected = id
    if (!id) return
    this._show(id, true)
    const a = this.info(id)
    if (!a || o.fly === false) return
    const tall = (this.topOf(id) ?? 0) > 40
    this.flyToPlan(a.cx, a.cy, {
      dist: tall ? 330 : 230,
      polar: 42,
      azimuth: o.azimuth ?? 0,
      h: Math.min(this.topOf(id) * 0.35, 20),
      duration: o.duration ?? 1.5
    })
  }

  deselect() {
    this.select(null)
  }

  /** 配套 / 景观图层：这一类对象的外框和光斑点亮，镜头飞到能装下它们的位置 */
  setLayer(layerId, o = {}) {
    for (const id of this._layerShown)
      if (id !== this.selected) this._show(id, false)
    this._layerShown = []
    this.layerId = layerId
    if (!layerId) return
    const layer = this.layout.layers.find((l) => l.id === layerId)
    if (!layer) return
    const members = layer.ids.map((id) => this.info(id)).filter(Boolean)
    for (const m of members) {
      this._show(m.id, true)
      this._layerShown.push(m.id)
    }
    if (o.fly === false) return
    // 只框住小区及周边近处的对象；河、公园这类很长的不参与取景
    const near = members.filter((m) => m.w < 200)
    let minx = Infinity
    let maxx = -Infinity
    let miny = Infinity
    let maxy = -Infinity
    for (const m of near) {
      minx = Math.min(minx, m.cx - m.w / 2)
      maxx = Math.max(maxx, m.cx + m.w / 2)
      miny = Math.min(miny, m.cy - m.d / 2)
      maxy = Math.max(maxy, m.cy + m.d / 2)
    }
    const cx = (minx + maxx) / 2
    const cy = (miny + maxy) / 2
    const span = Math.max(maxx - minx, (maxy - miny) * 1.6, 60)
    this.flyToPlan(cx, cy, {
      dist: Math.min(900, 150 + span * 1.25),
      polar: 44,
      duration: 1.6
    })
  }

  // ================================================================ 帧循环

  _frame() {
    this.clock.update()
    const dt = Math.min(0.1, this.clock.getDelta())
    if (!this.frozen) {
      this.clockT += dt
      this.sparkle.userData.material.uniforms.uTime.value = this.clockT
      // 选中 / 图层光斑呼吸
      const k = 0.32 + 0.12 * Math.sin(this.clockT * 2.4)
      for (const id of this._shown) this._halos.get(id).material.opacity = k
      const tw = this._tween
      if (tw) {
        const t = Math.min(1, (performance.now() - tw.t0) / tw.ms)
        const e = ease(t)
        this.camera.position.lerpVectors(tw.from.pos, tw.to.pos, e)
        this.controls.target.lerpVectors(tw.from.target, tw.to.target, e)
        if (t >= 1) this._tween = null
      }
      const tt = this._timeTween
      if (tt) {
        const t = Math.min(1, (performance.now() - tt.t0) / tt.ms)
        this.setTime(tt.from + (tt.to - tt.from) * ease(t))
        this.onTime?.(this.hour)
        if (t >= 1) {
          this._timeTween = null
          tt.onDone?.()
        }
      }
      this._clampControls()
      this.controls.update()
    }
    // 景深对焦在视线目标上；颗粒每帧换一个种子
    this.lens.uniforms.focus.value = this.camera.position.distanceTo(
      this.controls.target
    )
    this.lens.uniforms.time.value = (this.clockT * 37) % 1000
    this.renderer.info.reset()
    this.composer.render()
    this.onFrame(this)
    const f = this._fps
    f.frames++
    const now = performance.now()
    if (now - f.last > 1000) {
      f.value = (f.frames * 1000) / (now - f.last)
      f.frames = 0
      f.last = now
    }
  }

  /** 视线目标不出底座，相机不钻进地面 */
  _clampControls() {
    const t = this.controls.target
    const dx = t.x - this.baseCenter.x
    const dz = t.z - this.baseCenter.z
    const k = Math.hypot(dx / (foot.base.rx * 0.8), dz / (foot.base.ry * 0.78))
    if (k > 1) {
      t.x = this.baseCenter.x + dx / k
      t.z = this.baseCenter.z + dz / k
    }
    t.y = Math.min(60, Math.max(0, t.y))
    if (this.camera.position.y < 14) this.camera.position.y = 14
  }

  stats() {
    const i = this.renderer.info
    return {
      fps: Math.round(this._fps.value),
      calls: i.render.calls,
      triangles: i.render.triangles,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
      mode: "restored"
    }
  }

  setFrozen(on) {
    this.frozen = on
  }

  dispose() {
    this._ro?.disconnect()
    this.renderer?.setAnimationLoop(null)
    this.controls?.dispose()
    this.composer?.dispose()
    this.renderer?.dispose()
  }
}

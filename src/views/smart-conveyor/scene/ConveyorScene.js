/*
 * 带式输送机孪生 · 三维场景（不依赖 Vue）
 * ----------------------------------------------------------
 * 负责：
 *   - 渲染管线：Neutral 色调映射（只在输出阶段做一次）、辉光（阈值以上的发光体才会泛光）、DPR ≤ 2
 *   - 主机位 = 从定稿概念图反求的透视相机（data/camera.json）。整屏画布比概念图大，
 *     用 setViewOffset 把投影中心对到定稿里概念图的中心，焦距按"设计稿像素 → CSS 像素"换算，
 *     这样不管窗口多大、多扁，剖面沙盘都落在定稿里那块区域
 *   - 地层块（strata.js）、皮带与巷道（belts.js）、煤仓 / 工作面 / 地面（props.js）、告警光柱（beacons.js）
 *   - 每秒 setState：沿线煤量、煤位、采煤机、告警；每帧：带面滚动、涟漪、镜头缓动
 *   - 拾取（皮带、煤仓）、三维点 → 屏幕坐标（场景标签用）、截图钩子要的 views / setView / setFrozen / stats
 * 坐标：x 沿块长边（左 = 工作面），y 向上，z 朝镜头（块正面 z = 0）；见 section.js。
 */
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js"
import { THEME } from "./theme.js"
import { SECTION, BELTS, beltPath, pathAt } from "./section.js"
import { buildStrata } from "./strata.js"
import { Belts } from "./belts.js"
import { Props } from "./props.js"
import { Beacons } from "./beacons.js"
import { BeltDetail } from "./detail/belt.js"
import { IdlerPart, DrivePart } from "./detail/parts.js"

export class ConveyorScene {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} o
   * @param {object} o.sim 仿真器（createConveyorSim）
   * @param {object} o.layout layout.json
   * @param {() => number} o.getTime 当前显示的时刻（毫秒）
   * @param {() => number} o.unit 1 设计稿像素对应多少 CSS 像素
   * @param {() => number[]} [o.origin] 设计稿（1920 × 1080 舞台）左上角在画布里的位置（CSS 像素）；
   *   画布铺满窗口、舞台按 16:9 居中时两者不重合
   * @param {(hit: object|null) => void} [o.onPick] 总览里点中皮带 { id, chainage } / 煤仓 { id }；
   *   下钻里点中劣化托辊 { detail: { kind: "idler", track } } / 驱动部 { detail: { kind: "drive" } }
   */
  constructor(canvas, { sim, layout, getTime, unit, origin, onPick }) {
    this.canvas = canvas
    this.sim = sim
    this.getTime = getTime
    this.unit = unit
    this.layout = layout
    this.origin = origin || (() => [0, 0])
    this.onPick = onPick || (() => {})
    this.frozen = false
    this.state = null
    this.mode = "home"
    this.views = { home: true }

    const r = (this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance"
    }))
    r.toneMapping = THREE.NeutralToneMapping
    r.toneMappingExposure = THEME.exposure
    r.outputColorSpace = THREE.SRGBColorSpace
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    r.info.autoReset = false

    const scene = (this.scene = new THREE.Scene())
    scene.background = new THREE.Color(THEME.background)
    scene.fog = new THREE.Fog(THEME.fog.color, THEME.fog.near, THEME.fog.far)

    // ---------- 相机：主机位 = 标定结果
    const c = THEME.camera
    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 20, 30000)
    this.home = {
      position: new THREE.Vector3().fromArray(c.position),
      target: new THREE.Vector3().fromArray(c.target),
      up: new THREE.Vector3().fromArray(c.up)
    }
    this.controls = new OrbitControls(this.camera, canvas)
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.08,
      minDistance: 300,
      maxDistance: 12000,
      maxPolarAngle: Math.PI * 0.49
    })
    this.controls.enabled = true
    // 用户开始拖动 / 缩放：离开主机位，交给 OrbitControls
    this.controls.addEventListener("start", () => {
      this._tween = null
      this.mode = "free"
    })
    this._applyHome()

    // ---------- 灯光：冷色天光 + 微弱主光（形体主要靠自发光和边缘光）
    scene.add(new THREE.HemisphereLight("#9fb6cc", "#0b0d12", 0.7))
    // 冷色月光：从镜头这侧斜上方打下来，照亮地表顶面和地面建筑
    const key = new THREE.DirectionalLight("#d6e4ff", 1.8)
    key.position.set(c.position[0] - 1500, 5000, 4000)
    scene.add(key)

    // ---------- 场景内容
    const block = SECTION.block
    const seamY = SECTION.face[0][1]
    // 先画皮带 / 巷道 / 道具（不透明、发光），地层块是半透明的，最后画在它们上面
    this.belts = new Belts(scene, layout)
    this.props = new Props(scene)
    this.beacons = new Beacons(scene)
    this.strata = buildStrata(block, seamY)
    scene.add(this.strata.group)

    // ---------- 后处理：辉光 → 输出（色调映射 + sRGB）
    const rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4
    })
    this.composer = new EffectComposer(r, rt)
    this.composer.addPass(new RenderPass(scene, this.camera))
    // 清洗：个别像素是 NaN / 无穷大（退化三角面的法线等）时，辉光的多级模糊会把它扩散到全屏、整张变黑，
    // 所以进辉光之前把这类像素置零（同 /drone）
    this.composer.addPass(
      new ShaderPass({
        uniforms: { tDiffuse: { value: null } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
          void main(){ vec4 c = texture2D(tDiffuse, vUv);
            if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
            gl_FragColor = clamp(c, 0.0, 64.0); }`
      })
    )
    const b = THEME.bloom
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(256, 256),
      b.strength,
      b.radius,
      b.threshold
    )
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    // ---------- 拾取
    this.raycaster = new THREE.Raycaster()
    this._down = null
    this._onDown = (e) => (this._down = [e.clientX, e.clientY])
    this._onUp = (e) => {
      if (!this._down) return
      const moved = Math.hypot(
        e.clientX - this._down[0],
        e.clientY - this._down[1]
      )
      this._down = null
      if (moved < 5) this.onPick(this.pick(e.clientX, e.clientY))
      else this.mode = "free"
    }
    canvas.addEventListener("pointerdown", this._onDown)
    canvas.addEventListener("pointerup", this._onUp)

    this._onResize = () => this.resize()
    window.addEventListener("resize", this._onResize)
    this.resize()
    this.clock = new THREE.Clock()
    this._fps = { frames: 0, last: performance.now(), value: 0 }
    r.setAnimationLoop(() => this._frame())
  }

  _applyHome() {
    const h = this.home
    this.camera.position.copy(h.position)
    this.camera.up.copy(h.up)
    this.camera.lookAt(h.target)
    this.controls.target.copy(h.target)
    this.camera.updateMatrixWorld()
  }

  /** 画布尺寸、视场、投影中心：按定稿里概念图的位置换算 */
  resize() {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    const u = this.unit()
    const f = THEME.focalDesign * u // CSS 像素下的焦距
    const cam = this.camera
    cam.aspect = w / h
    cam.fov = (2 * Math.atan(h / 2 / f) * 180) / Math.PI
    const [cx, cy] = THEME.imageCenter
    const [ox, oy] = this.origin()
    cam.setViewOffset(w, h, w / 2 - ox - cx * u, h / 2 - oy - cy * u, w, h)
    cam.updateProjectionMatrix()
  }

  /** 仿真状态（每秒一次） */
  setState(s) {
    this.state = s
    if (this.detail) this.detail.update(s, this.slow || {})
    const ms = s.t
    this.belts.setState(this.sim, s, ms)
    this.props.setState(s)
    this.beacons.setAlarms(
      s.alarms.map((a) => ({ ...a, severity: a.predictive ? 1 : 0 }))
    )
  }

  _frame() {
    // 切到后台再回来时 getDelta 会很大，限一帧最多 0.1 s
    const dt = Math.min(0.1, this.clock.getDelta())
    const t = this.clock.elapsedTime
    if (!this.frozen) {
      if (this.detail) this.detail.tick(dt, t)
      else {
        this.belts.tick(dt, t)
        this.props.face.fade(this.camera.position)
        this.beacons.tick(t, this.camera)
      }
      this._tweenTick(dt)
      if (this.mode !== "home") this.controls.update()
    }
    this.renderer.info.reset()
    this.composer.render()
    const f = this._fps
    f.frames++
    const now = performance.now()
    if (now - f.last > 1000) {
      f.value = (f.frames * 1000) / (now - f.last)
      f.frames = 0
      f.last = now
    }
  }

  // ================================================================ 镜头

  setView(name) {
    if (name === "home") {
      this._tween = null
      this.mode = "home"
      this._applyHome()
    }
  }

  /** 飞到某个点：镜头保持主机位的朝向，拉近到 dist */
  flyTo(point, dist = 1400) {
    const dir = this.home.position.clone().sub(this.home.target).normalize()
    const to = {
      position: point.clone().addScaledVector(dir, dist),
      target: point.clone()
    }
    this._tween = {
      from: {
        position: this.camera.position.clone(),
        target: this.controls.target.clone()
      },
      to,
      k: 0
    }
    this.mode = "fly"
  }

  /** 飞到一条皮带的中段 */
  flyToBelt(id) {
    const { pos } = pathAt(id, 0.5)
    this.flyTo(pos, Math.max(900, beltPath(id).len * 0.9))
  }

  /** 飞到一个煤仓（井下煤仓看仓体中部，地面原煤仓看仓顶） */
  flyToBunker(id) {
    const b = SECTION.bunkers[id]
    const p = b
      ? new THREE.Vector3(b.x, (b.top + b.bottom) / 2, b.z)
      : this.props.surface.siloTop
    this.flyTo(p.clone(), 900)
  }

  /**
   * 剧本用的临时标记（人员越界剧本里的巡检工）：发光人形 + 地面圆环；pos = null 时隐藏
   * @param {string} key
   * @param {THREE.Vector3|null} pos
   * @param {string} [color]
   */
  setMarker(key, pos, color = "#ffd166") {
    this.markers = this.markers || {}
    let m = this.markers[key]
    if (!m) {
      m = new THREE.Group()
      // 画在半透明岩块之后（transparent + 不写深度），不被岩块压暗
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(2.2),
        transparent: true,
        depthWrite: false,
        toneMapped: false
      })
      // 示意尺度：人形放大到几十米才看得见
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(9, 26, 4, 10), mat)
      body.position.y = 22
      const head = new THREE.Mesh(new THREE.SphereGeometry(8, 12, 10), mat)
      head.position.y = 50
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(26, 30, 40),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(color).multiplyScalar(1.6),
          transparent: true,
          opacity: 0.8,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false
        })
      )
      ring.rotation.x = -Math.PI / 2
      m.add(body, head, ring)
      m.scale.setScalar(1.6)
      for (const o of m.children) o.renderOrder = 9
      this.scene.add(m)
      this.markers[key] = m
    }
    m.visible = !!pos
    if (pos) m.position.copy(pos)
  }

  /**
   * 图层开关：coal 煤流光管、sensors 沿线传感器光点；
   * dts / people / robots 的三维表现在对应图层做好之前先只记状态
   */
  setLayer(key, on) {
    this.layers = { ...(this.layers || {}), [key]: on }
    if (key === "coal")
      for (const it of Object.values(this.belts.items)) it.ribbon.visible = on
    if (key === "sensors") this.belts.sensors.visible = on
  }

  flyHome() {
    this._tween = {
      from: {
        position: this.camera.position.clone(),
        target: this.controls.target.clone()
      },
      to: {
        position: this.home.position.clone(),
        target: this.home.target.clone()
      },
      k: 0,
      home: true
    }
    this.mode = "fly"
  }

  _tweenTick(dt) {
    const tw = this._tween
    if (!tw) return
    tw.k = Math.min(1, tw.k + dt / 1.4)
    const e = tw.k < 0.5 ? 4 * tw.k ** 3 : 1 - (-2 * tw.k + 2) ** 3 / 2
    this.camera.position.lerpVectors(tw.from.position, tw.to.position, e)
    this.controls.target.lerpVectors(tw.from.target, tw.to.target, e)
    this.camera.up.copy(this.home.up)
    this.camera.lookAt(this.controls.target)
    if (tw.k >= 1) {
      this._tween = null
      if (tw.home) {
        this.mode = "home"
        this._applyHome()
      }
    }
  }

  // ================================================================ 拾取 / 投影

  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect()
    const v = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    )
    this.raycaster.setFromCamera(v, this.camera)
    if (this.detail) {
      const d = this.detail.pick(this.raycaster)
      return d ? { detail: d } : null
    }
    const targets = [
      ...Object.values(this.belts.items).map((it) => it.ribbon),
      ...Object.values(this.props.bunkers).map((b) => b.group)
    ]
    const hit = this.raycaster.intersectObjects(targets, true)[0]
    if (!hit) return null
    for (let o = hit.object; o; o = o.parent) {
      const id = o.userData.pick
      if (!id) continue
      if (!BELTS[id]) return { id }
      // 点中皮带：找路径上离命中点最近的点，换算成真实里程
      const { pts, cum, len } = beltPath(id)
      let best = 0
      let bd = Infinity
      pts.forEach((p, i) => {
        const d = p.distanceToSquared(hit.point)
        if (d < bd) [bd, best] = [d, i]
      })
      return { id, chainage: (cum[best] / len) * BELTS[id].L }
    }
    return null
  }

  /** 三维点 → 画布内 CSS 像素；在镜头背后返回 null */
  project(p) {
    const v = p.clone().project(this.camera)
    if (v.z > 1) return null
    return [
      ((v.x + 1) / 2) * this.canvas.clientWidth,
      ((1 - v.y) / 2) * this.canvas.clientHeight
    ]
  }

  /** 三维点 → 设计稿像素（相对舞台左上角，1920 × 1080）；在镜头背后返回 null */
  toDesign(p) {
    const c = this.project(p)
    if (!c) return null
    const u = this.unit()
    const [ox, oy] = this.origin()
    return [(c[0] - ox) / u, (c[1] - oy) / u]
  }

  /**
   * 场景标签的锚点：在候选三维点里挑主机位下投影离定稿标注像素最近的那个，
   * 这样主机位下标签和定稿对得上，镜头动了标签也跟着物体走
   * @param {{belt?: string, bunker?: string, face?: boolean, surface?: string}} spec
   *   候选：皮带路径 / 煤仓轴线 / 工作面 / 地面设施（section.json 的 surface 键）上方的竖线
   * @param {number[]} px 定稿里的位置（设计稿像素）
   */
  anchorNear(spec, px) {
    const pts = []
    if (spec.belt)
      for (let i = 0; i <= 200; i++) pts.push(pathAt(spec.belt, i / 200).pos)
    if (spec.bunker) {
      const b = SECTION.bunkers[spec.bunker]
      for (let i = 0; i <= 40; i++)
        pts.push(
          new THREE.Vector3(b.x, b.bottom + ((b.top - b.bottom) * i) / 40, b.z)
        )
    }
    if (spec.surface) {
      const p = SECTION.surface[spec.surface]
      const H = SECTION.block.H
      for (let i = 0; i <= 40; i++)
        pts.push(new THREE.Vector3(p[0], H + i * 10, p[2]))
    }
    if (spec.face) {
      const [a, b] = SECTION.face.map((p) => new THREE.Vector3(...p))
      for (let i = 0; i <= 40; i++) pts.push(a.clone().lerp(b, i / 40))
    }
    // 用主机位的相机投影（当前镜头可能已经被拖动过）
    const cam = this.camera.clone()
    cam.position.copy(this.home.position)
    cam.up.copy(this.home.up)
    cam.lookAt(this.home.target)
    cam.updateMatrixWorld()
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    const u = this.unit()
    const [ox, oy] = this.origin()
    let best = null
    let bd = Infinity
    for (const p of pts) {
      const v = p.clone().project(cam)
      const x = (((v.x + 1) / 2) * w - ox) / u
      const y = (((1 - v.y) / 2) * h - oy) / u
      const d = Math.hypot(x - px[0], y - px[1])
      if (d < bd) [bd, best] = [d, p]
    }
    return best
  }

  /** 场景标签的锚点（三维） */
  anchors() {
    const a = {}
    for (const id of Object.keys(SECTION.belts)) a[id] = pathAt(id, 0.5).pos
    for (const [id, k] of Object.entries(this.props.bunkers)) a[id] = k.top
    a.WF12301 = new THREE.Vector3(...SECTION.face[0]).lerp(
      new THREE.Vector3(...SECTION.face[1]),
      0.5
    )
    a.DRV = this.props.surface.drive
    a.MC03 = this.props.surface.siloTop
    return a
  }

  // ================================================================ 下钻（第 2 / 3 级）

  /**
   * 进入下钻：总览隐藏，换成真实尺度的局部模型
   * @param {"belt"|"idler"|"drive"} level
   * @param {object} o belt：{ belt, center }；idler：{ belt, track }；drive：{ belt, motor, track }
   */
  enterDetail(level, o) {
    this._disposeDetail()
    const b = BELTS[o.belt]
    let d
    if (level === "belt")
      d = new BeltDetail({
        layout: this.layout,
        belt: o.belt,
        center: o.center
      })
    else if (level === "idler") d = new IdlerPart({ belt: b, track: o.track })
    else d = new DrivePart({ belt: b, motor: o.motor, track: o.track })
    this.detail = d
    this.level = level
    this.scene.add(d.group)
    for (const g of this._overview()) g.visible = false
    this.scene.fog = null
    if (this.state) d.update(this.state, this.slow || {})
    // 镜头：从前上方斜看；部件特写慢慢自转
    const cam = this.camera
    cam.near = level === "belt" ? 0.1 : 0.02
    cam.far = 3000
    const f = d.focus()
    const off =
      level === "belt"
        ? d.camOffset()
        : level === "idler"
          ? new THREE.Vector3(1.9, 1.25, 2.7)
          : new THREE.Vector3(6, 3.6, 9)
    this._tween = null
    this.mode = "free"
    cam.position.copy(f).add(off)
    cam.up.set(0, 1, 0)
    this.controls.target.copy(f)
    cam.lookAt(f)
    Object.assign(this.controls, {
      minDistance: level === "belt" ? 2.5 : 0.5,
      maxDistance: level === "belt" ? 60 : 14,
      maxPolarAngle: Math.PI * 0.62,
      autoRotate: level !== "belt",
      autoRotateSpeed: 0.6
    })
    this.resize()
  }

  /** 退出下钻，回到全链剖面主机位 */
  exitDetail() {
    if (!this.detail) return
    this._disposeDetail()
    for (const g of this._overview()) g.visible = true
    this.scene.fog = new THREE.Fog(
      THEME.fog.color,
      THEME.fog.near,
      THEME.fog.far
    )
    this.camera.near = 20
    this.camera.far = 30000
    Object.assign(this.controls, {
      minDistance: 300,
      maxDistance: 12000,
      maxPolarAngle: Math.PI * 0.49,
      autoRotate: false
    })
    this.setView("home")
    this.resize()
  }

  _disposeDetail() {
    if (!this.detail) return
    this.scene.remove(this.detail.group)
    this.detail.dispose()
    this.detail = null
    this.level = null
  }

  /** 总览里的所有东西（下钻时隐藏） */
  _overview() {
    return [
      this.belts.group,
      this.props.group,
      this.beacons.group,
      this.strata.group,
      ...Object.values(this.markers || {})
    ]
  }

  /** 慢数据（10 s 一档：沿线煤量、光纤测温）给下钻模型用 */
  setSlow(w) {
    this.slow = w
    if (this.detail && this.state) this.detail.update(this.state, w)
  }

  setFrozen(on) {
    this.frozen = on
    if (on) this.setView("home")
  }

  /**
   * 设备 ID 图（开发模式截图钩子用，比对轮廓 IoU / 中心偏差）：
   * 地层块、两个井下煤仓、综采工作面各一种纯色，其余隐藏；后画的盖住先画的（关深度测试，按 renderOrder），
   * 这样井下的煤仓、工作面不会被半透明岩块挡住，和定稿里看到的一样
   * @returns {Promise<{png: string, map: Record<string, number[]>} | null>}
   */
  async renderIdMask() {
    if (this.detail) return null
    const r = this.renderer
    const size = r.getDrawingBufferSize(new THREE.Vector2())
    const rt = new THREE.WebGLRenderTarget(size.x, size.y)
    const groups = {
      block: [this.strata.block, this.strata.top],
      face: [this.props.face.group],
      MC01: [this.props.bunkers.MC01.group],
      MC02: [this.props.bunkers.MC02.group]
    }
    const map = {}
    const owner = new Map() // 网格 → [材质, 绘制顺序]
    Object.entries(groups).forEach(([id, objs], i) => {
      const n = i + 1
      const rgb = [(n & 63) * 4, ((n >> 6) & 63) * 4, 128]
      map[id] = rgb
      const m = new THREE.MeshBasicMaterial({
        fog: false,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide
      })
      m.color.setRGB(
        rgb[0] / 255,
        rgb[1] / 255,
        rgb[2] / 255,
        THREE.LinearSRGBColorSpace
      )
      for (const g of objs)
        g.traverse((o) => o.isMesh && owner.set(o, [m, i * 10]))
    })
    const saved = []
    const bg = this.scene.background
    const fog = this.scene.fog
    const tm = r.toneMapping
    const clearColor = r.getClearColor(new THREE.Color())
    const clearAlpha = r.getClearAlpha()
    const buf = new Uint8Array(size.x * size.y * 4)
    try {
      this.scene.traverse((o) => {
        if (!o.isMesh && !o.isLine && !o.isPoints) return
        saved.push([o, o.material, o.visible, o.renderOrder])
        const own = owner.get(o)
        if (own) {
          o.material = own[0]
          o.renderOrder = own[1]
        } else o.visible = false
      })
      this.scene.background = null
      this.scene.fog = null
      r.toneMapping = THREE.NoToneMapping
      r.setRenderTarget(rt)
      r.setClearColor(0x000000, 1)
      r.clear()
      r.render(this.scene, this.camera)
      r.readRenderTargetPixels(rt, 0, 0, size.x, size.y, buf)
    } finally {
      // 不论成功与否都还原场景
      r.setRenderTarget(null)
      r.setClearColor(clearColor, clearAlpha)
      r.toneMapping = tm
      this.scene.background = bg
      this.scene.fog = fog
      for (const [o, m, v, ro] of saved) {
        o.material = m
        o.visible = v
        o.renderOrder = ro
      }
      for (const [m] of new Set(owner.values())) m.dispose()
      rt.dispose()
    }
    // WebGL 读回的像素上下颠倒，翻转后画到 canvas 导出 PNG
    const cv = document.createElement("canvas")
    cv.width = size.x
    cv.height = size.y
    const ctx = cv.getContext("2d")
    const img = ctx.createImageData(size.x, size.y)
    for (let y = 0; y < size.y; y++)
      img.data.set(
        buf.subarray((size.y - 1 - y) * size.x * 4, (size.y - y) * size.x * 4),
        y * size.x * 4
      )
    ctx.putImageData(img, 0, 0)
    return { png: cv.toDataURL("image/png"), map }
  }

  stats() {
    const i = this.renderer.info
    return {
      fps: Math.round(this._fps.value),
      calls: i.render.calls,
      triangles: i.render.triangles,
      geometries: i.memory.geometries,
      textures: i.memory.textures
    }
  }

  dispose() {
    this.renderer.setAnimationLoop(null)
    window.removeEventListener("resize", this._onResize)
    this.canvas.removeEventListener("pointerdown", this._onDown)
    this.canvas.removeEventListener("pointerup", this._onUp)
    this.controls.dispose()
    this.scene.traverse((o) => {
      o.geometry?.dispose?.()
      const m = o.material
      for (const x of Array.isArray(m) ? m : m ? [m] : []) {
        for (const v of Object.values(x.uniforms || {})) v.value?.dispose?.()
        x.dispose?.()
      }
    })
    this.composer.dispose?.()
    this.renderer.dispose()
  }
}

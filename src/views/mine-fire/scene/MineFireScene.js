/*
 * 矿井智能防灭火与应急避灾 · 三维场景（不依赖 Vue）
 * ----------------------------------------------------------
 * 负责：
 *   - 渲染管线：Neutral 色调映射（只在输出阶段做一次）、辉光（阈值以上的发光体才泛光）、DPR ≤ 2
 *   - 主机位 = 定稿概念图反求的透视相机（data/camera.json）。画布铺满窗口、面板在 16:9 舞台里，
 *     用 setViewOffset 把投影中心对到定稿里概念图的中心，焦距按"设计稿像素 → CSS 像素"换算
 *   - 内容：煤层板（seam.js）、巷网（network.js）、井筒 / 硐室 / 避难硐室（props.js）、
 *     火点特效（fx.js）、避灾路线（routes.js）、人员（people.js）、风流（airflow.js）
 *   - setState(state)：仿真面板状态（硐室状态、火点、路线开关）；setTime(s)：人员位置按剧本秒更新
 *   - 镜头：home / 飞到某点（保持主机位朝向拉近）；拾取硐室与避难硐室；三维点 → 屏幕坐标（场景标签用）
 * 坐标：x = 向东（米），z = 向南，y 向上；煤层顶面 y = 0。
 */
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js"
import { THEME } from "./theme.js"
import { buildSeam } from "./seam.js"
import { buildNetwork } from "./network.js"
import { buildProps } from "./props.js"
import { buildFireFx } from "./fx.js"
import { buildRoutes } from "./routes.js"
import { buildPeople } from "./people.js"
import { buildAirflow } from "./airflow.js"

export class MineFireScene {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} o
   * @param {object} o.plan plan.json
   * @param {object[]} o.chambers 硐室配置（data/site.js 的 CHAMBERS）
   * @param {object} o.sim 仿真器（createMineFireSim）
   * @param {() => number} o.unit 1 设计稿像素对应多少 CSS 像素
   * @param {() => number[]} o.origin 设计稿舞台左上角在画布里的位置（CSS 像素）
   * @param {(hit: {kind: string, id: string}|null) => void} [o.onPick]
   * @param {() => void} [o.onUserCamera] 用户拖动 / 缩放镜头（页面据此暂停自动镜头）
   */
  constructor(
    canvas,
    { plan, chambers, sim, unit, origin, onPick, onUserCamera }
  ) {
    this.canvas = canvas
    this.plan = plan
    this.sim = sim
    this.unit = unit
    this.origin = origin
    this.onPick = onPick || (() => {})
    this.onUserCamera = onUserCamera || (() => {})
    this.frozen = false
    this._frameFns = new Set()
    this.mode = "home"
    this.s = 0
    this.state = null

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

    // ---------- 相机：主机位 = 标定结果
    const c = THEME.camera
    this.camera = new THREE.PerspectiveCamera(c.fovDeg, 16 / 9, 50, 80000)
    this.home = {
      position: new THREE.Vector3().fromArray(c.position),
      target: new THREE.Vector3().fromArray(c.target),
      up: new THREE.Vector3().fromArray(c.up)
    }
    this.controls = new OrbitControls(this.camera, canvas)
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.08,
      minDistance: 600,
      maxDistance: 40000,
      maxPolarAngle: Math.PI * 0.47,
      screenSpacePanning: false
    })
    this.controls.addEventListener("start", () => {
      this._tween = null
      this.mode = "free"
      this.onUserCamera()
    })
    this._applyHome()

    // ---------- 灯光：冷色天光 + 斜上方主光（柜体、侧面用，其余靠自发光）
    scene.add(new THREE.HemisphereLight("#9fc4e6", "#05080c", 0.9))
    const key = new THREE.DirectionalLight("#d6e8ff", 1.4)
    key.position.set(-3000, 8000, 6000)
    scene.add(key)

    // ---------- 场景内容（不透明的先画，玻璃 / 粒子按 renderOrder 后画）
    this.seam = buildSeam(plan)
    this.network = buildNetwork(plan)
    this.props = buildProps(plan, chambers)
    const ds04 = this.props.chambers["DS-04"]
    this.fx = buildFireFx(
      new THREE.Vector3(ds04.center.x, -THEME.size.sink, ds04.center.z),
      THEME.size.chamber[2]
    )
    this.routes = buildRoutes(plan)
    this.people = buildPeople(sim.count)
    this.airflow = buildAirflow(this.network)
    scene.add(
      this.seam.group,
      this.network.group,
      this.props.group,
      this.fx.group,
      this.routes.group,
      this.people.points,
      this.airflow.points
    )
    this.layers = {
      tubes: true,
      airflow: true,
      people: true,
      sensors: true,
      routes: true
    }

    // ---------- 后处理：清洗 → 辉光 → 输出（色调映射 + sRGB）
    const rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4
    })
    this.composer = new EffectComposer(r, rt)
    this.composer.addPass(new RenderPass(scene, this.camera))
    // 个别像素是 NaN / 无穷大时，辉光的多级模糊会把它扩散到全屏，进辉光之前置零（同 /drone、/smart-conveyor）
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
    this._onDown = (e) => (this._down = [e.clientX, e.clientY])
    this._onUp = (e) => {
      if (!this._down) return
      const moved = Math.hypot(
        e.clientX - this._down[0],
        e.clientY - this._down[1]
      )
      this._down = null
      if (moved < 5) this.onPick(this.pick(e.clientX, e.clientY))
    }
    canvas.addEventListener("pointerdown", this._onDown)
    canvas.addEventListener("pointerup", this._onUp)

    this._onResize = () => this.resize()
    window.addEventListener("resize", this._onResize)
    this.resize()
    this.clock = new THREE.Clock()
    this._fps = { frames: 0, last: performance.now(), value: 0 }
    this.views = { home: true, hub: true, ds04: true, refuge: true }
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

  /** 画布尺寸、视场、投影中心：按定稿里概念图的位置换算（同 /smart-conveyor） */
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
    // 粒子尺寸换算：世界尺寸 × pxScale / 深度 = 像素
    this.pxScale =
      (h / 2 / Math.tan((cam.fov * Math.PI) / 360)) *
      this.renderer.getPixelRatio()
  }

  /** 仿真面板状态（每次剧本时刻变化时） */
  setState(st) {
    this.state = st
    for (const ch of st.chambers) this.props.chambers[ch.id]?.setState(ch.state)
    this.fx.setState(st.scene)
    this.routes.setOn(st.scene.routes && this.layers.routes)
    const ds = this.props.chambers["DS-04"].center
    const k = st.scene.ds04 === "fire" ? 1 : st.scene.ds04 === "warn" ? 0.35 : 0
    this.seam.setFire(ds.x, ds.z, k)
  }

  /** 剧本秒（人员位置每帧跟着它） */
  setTime(s) {
    this.s = s
  }

  _frame() {
    // 切到后台再回来时 getDelta 会很大，限一帧最多 0.1 s
    const dt = Math.min(0.1, this.clock.getDelta())
    const t = this.clock.elapsedTime
    const dpr = this.renderer.getPixelRatio()
    if (!this.frozen) {
      this.network.tick(t)
      this.props.tick(t, this.state)
      this.fx.tick(dt, t, this.pxScale || 1000)
      this.routes.tick(dt, t)
      if (this.layers.people) this.people.update(this.sim, this.s, dpr)
      if (this.layers.airflow) this.airflow.tick(t, dpr)
      this._tweenTick(dt)
      if (this.mode !== "home") this.controls.update()
    }
    this.renderer.info.reset()
    this.composer.render()
    // 每帧回调（场景标签跟随锚点用）
    for (const fn of this._frameFns) fn()
    const f = this._fps
    f.frames++
    const now = performance.now()
    if (now - f.last > 1000) {
      f.value = (f.frames * 1000) / (now - f.last)
      f.frames = 0
      f.last = now
    }
  }

  /** 订阅每帧回调（渲染之后调用），返回取消订阅的函数 */
  addFrameListener(fn) {
    this._frameFns.add(fn)
    return () => this._frameFns.delete(fn)
  }

  // ================================================================ 镜头

  /** 命名视角：home 主机位；hub 井底车场；ds04 一盘区变电所；refuge 南避难硐室 */
  setView(name) {
    if (name === "home") {
      this._tween = null
      this.mode = "home"
      this._applyHome()
      return
    }
    this.flyToView(name)
  }

  flyToView(name) {
    if (name === "home") return this.flyHome()
    const ch = this.props.chambers
    // 拉近的距离按"硐室占画面约三分之一"取（主机位约 17.8 km）
    if (name === "hub") return this.flyTo(new THREE.Vector3(10, 0, -110), 7200)
    if (name === "ds04")
      return this.flyTo(
        ch["DS-04"].center.clone().add(new THREE.Vector3(80, 0, 260)),
        6400
      )
    if (name === "refuge")
      return this.flyTo(this.props.refuges["RC-01"].center.clone(), 7000)
    const c = ch[name]
    if (c) return this.flyTo(c.center.clone(), 6400)
  }

  /** 飞到某个点：镜头保持主机位的朝向，拉近到 dist */
  flyTo(point, dist) {
    const dir = this.home.position.clone().sub(this.home.target).normalize()
    this._tween = {
      from: {
        position: this.camera.position.clone(),
        target: this.controls.target.clone()
      },
      to: {
        position: point.clone().addScaledVector(dir, dist),
        target: point.clone()
      },
      k: 0
    }
    this.mode = "fly"
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
    tw.k = Math.min(1, tw.k + dt / 1.6)
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
      } else this.mode = "free"
    }
  }

  /** 是否在主机位（没有被拖动、没在飞） */
  get atHome() {
    return this.mode === "home"
  }

  // ================================================================ 图层

  /** tubes 巷道 / airflow 风流 / people 人员 / sensors 传感器（硐室柜列灯）/ routes 避灾路线 */
  setLayer(key, on) {
    this.layers[key] = on
    if (key === "tubes") this.network.group.visible = on
    if (key === "airflow") this.airflow.points.visible = on
    if (key === "people") this.people.points.visible = on
    if (key === "sensors")
      for (const ch of Object.values(this.props.chambers)) ch.lamp.visible = on
    if (key === "routes") this.routes.setOn(on && !!this.state?.scene.routes)
  }

  // ================================================================ 拾取 / 投影

  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect()
    const v = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    )
    this.raycaster.setFromCamera(v, this.camera)
    const hit = this.raycaster.intersectObjects(this.props.pick, false)[0]
    return hit ? { ...hit.object.userData } : null
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

  /** 三维点按主机位投影（场景标签用它算"定稿位置 - 主机位投影"的偏移）；画布尺寸变了才重建主机位相机 */
  projectHome(p) {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (!this._homeCam || this._homeKey !== `${w}x${h}x${this.camera.fov}`) {
      const c = this.camera.clone()
      c.position.copy(this.home.position)
      c.up.copy(this.home.up)
      c.lookAt(this.home.target)
      c.updateMatrixWorld()
      c.updateProjectionMatrix()
      this._homeCam = c
      this._homeKey = `${w}x${h}x${this.camera.fov}`
    }
    const v = p.clone().project(this._homeCam)
    if (v.z > 1) return null
    return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h]
  }

  /** 场景标签的三维锚点 */
  anchors() {
    const p = this.props
    const routes = this.routes.lines
    const mid = (pts, k) => {
      // 路线上按比例取一点（标签位置）
      const i = Math.min(
        pts.length - 1,
        Math.max(0, Math.round(k * (pts.length - 1)))
      )
      return new THREE.Vector3(pts[i][0], THEME.size.tubeH, pts[i][1])
    }
    return {
      shafts: p.shafts,
      chambers: Object.fromEntries(
        Object.entries(p.chambers).map(([id, c]) => [id, c.top])
      ),
      chamberCenter: Object.fromEntries(
        Object.entries(p.chambers).map(([id, c]) => [id, c.center])
      ),
      refuges: Object.fromEntries(
        Object.entries(p.refuges).map(([id, r]) => [id, r.top])
      ),
      fire: p.chambers["DS-04"].top.clone(),
      routes: { R1: mid(routes.R1, 0.35), R2: mid(routes.R2, 0.5) },
      zones: this.plan.zones.map((z) => ({
        name: z.name,
        p: new THREE.Vector3(z.at[0], 0, -z.at[1])
      })),
      lost: this.people.lost
    }
  }

  // ================================================================ 截图钩子

  setFrozen(on) {
    this.frozen = on
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
      if (Array.isArray(m)) m.forEach((x) => x.dispose())
      else m?.dispose?.()
    })
    this.composer.dispose?.()
    this.renderer.dispose()
  }
}

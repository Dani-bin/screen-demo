/*
 * 智能矿山（West Elk 煤矿）三维场景
 * ----------------------------------------------------------
 * 不依赖 Vue。地形全部来自真实数据（public/smart-mine/：USGS 3DEP 高程 + NAIP 航拍，由 scripts/smart-mine/prepare.py 导出），
 * 井下布置是示意（data/layout.json）。两块地形：
 *   overview 全景 12 × 10 km（10 m 网格、4096 px 影像），closeup 工业广场近景 3 × 2 km（2 m 网格、0.5 m 影像，首次进入时加载）。
 * 显示方式（mode）：surface 地表实景 / ghost 地表半透明露出井下 / section 沿在采工作面剖切。
 *
 * 回调：
 *   onAnchors({ key: { x, y, visible } })  标注锚点的设计稿坐标（1920 宽），每帧
 *   onBusy(bool)                         正在加载近景数据
 */
import * as THREE from "three"
import gsap from "gsap"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js"
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js"
import LAYOUT from "../data/layout.json"
import { BLOOM, CONTROL_LIMITS, EXAG, SECTION_CAM, SWAY, VIEWS } from "./theme"
import {
  HeightGrid,
  W,
  backgroundTexture,
  buildFloor,
  buildSection,
  buildTerrain,
  buildWalls,
  loadHeights,
  overlayTexture,
  seamB,
  setTerrainLook
} from "./terrain"
import { Underground } from "./underground"

const DESIGN_W = 1920
const DEG = Math.PI / 180

/** 各显示方式对应的外观目标值 */
const LOOKS = {
  surface: { ghost: 0, under: 0, section: 0 },
  ghost: { ghost: 1, under: 1, section: 0 },
  // 剖切时地表同时透视：越过切面顶部能看到切面后方（南侧）的工作面与巷道
  section: { ghost: 1, under: 1, section: 1 }
}

export class MineScene {
  constructor({ canvas, container, sim, baseUrl, onAnchors, onBusy }) {
    this.canvas = canvas
    this.container = container
    this.sim = sim
    this.baseUrl = baseUrl
    this.onAnchors = onAnchors || (() => {})
    this.onBusy = onBusy || (() => {})
    this.L = LAYOUT
    this.disposed = false
    this.blocks = {}
    this.view = "overview"
    this.mode = "surface"
    /** 当前外观（gsap 补间这些值，每帧应用） */
    this.look = { ghost: 0, overlay: 1, under: 0, section: 0, flow: 0 }

    // ---------- 渲染器（Neutral 色调映射：保住航拍影像的颜色）
    const r = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance"
    })
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    r.toneMapping = THREE.NeutralToneMapping
    this.renderer = r

    this.scene = new THREE.Scene()
    this.bgTex = backgroundTexture()
    this.scene.background = this.bgTex

    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 50, 200000)
    this.controls = new OrbitControls(this.camera, canvas)
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.08,
      rotateSpeed: 0.5,
      zoomSpeed: 0.8,
      minPolarAngle: 12 * DEG,
      maxPolarAngle: 78 * DEG,
      screenSpacePanning: false
    })
    this.lastInteract = -1e9
    this.controls.addEventListener("start", () => {
      this.lastInteract = performance.now()
      this.fly?.kill()
      this.fly = null
    })
    this.controls.addEventListener(
      "end",
      () => (this.lastInteract = performance.now())
    )

    // ---------- 后处理：辉光（离屏目标开 4 倍 MSAA）
    const rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4
    })
    this.composer = new EffectComposer(r, rt)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(256, 256),
      BLOOM.strength,
      BLOOM.radius,
      BLOOM.threshold
    )
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    // 剖切面：保留 y ≤ cutY 的一半（法线朝南 = +Z，distance = z + cutY ≥ 0）
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
    this.lineRes = new THREE.Vector2(DESIGN_W, 1080)

    this.resizeObserver = new ResizeObserver(() => this._resize())
    this.resizeObserver.observe(container)
    this.timer = new THREE.Timer()
    if (import.meta.env.DEV) window.__smartMineScene = this
    this._loop = this._loop.bind(this)
  }

  // ================================================================ 加载

  async load() {
    const L = this.L
    const block = await this._loadBlock("overview", L.overview, [0, 0])
    if (this.disposed) return
    // 井下只建在全景上
    this.under = new Underground(L, block.grid, this.lineRes)
    block.group.add(this.under.group)
    this.under.setFade(0)
    Object.assign(block.anchors, this.under.anchors)
    // 剖切面：沿在采工作面中线
    const act = L.panels.find((p) => p.status === "active")
    this.cutY = (act.rect[1] + act.rect[3]) / 2
    const bleeder = L.roadways.find((r) => r.kind === "bleeder").pts[0][0]
    this.section = buildSection(L, block.grid, this.cutY, {
      panel: [act.rect[0], act.face_x, act.rect[2]],
      roads: [330, bleeder]
    })
    this.section.visible = false
    block.group.add(this.section)
    this._sectionAnchors(block, act)

    this._showBlock("overview")
    this._resize()
    this._jumpTo(this._viewCam("overview"))
    this.frameId = requestAnimationFrame(this._loop)
  }

  /** 读一块地形：高程 PNG + 影像 → 地表、侧壁、地台、地面设施锚点 */
  async _loadBlock(name, spec, center) {
    const L = this.L
    const tl = new THREE.TextureLoader()
    const [h, tex] = await Promise.all([
      loadHeights(`${this.baseUrl}smart-mine/${name}_h.png`, L.heightCode),
      tl.loadAsync(`${this.baseUrl}smart-mine/${name}.webp`)
    ])
    const grid = new HeightGrid(
      h.data,
      h.nx,
      h.ny,
      spec.step,
      center[0],
      center[1]
    )
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    const group = new THREE.Group()
    const overlay = name === "overview" ? overlayTexture(L, grid) : null
    const terrain = buildTerrain(L, grid, tex, overlay)
    group.add(terrain)
    const walls = buildWalls(L, grid)
    group.add(walls.group)
    const floor = buildFloor(grid)
    group.add(floor)
    group.visible = false
    this.scene.add(group)

    // 地面设施锚点（只取落在本块范围里的）
    const anchors = {}
    for (const [key, s] of Object.entries(L.sites)) {
      const [x, y] = s.pos
      if (
        Math.abs(x - grid.cx) > grid.w / 2 ||
        Math.abs(y - grid.cy) > grid.h / 2
      )
        continue
      anchors[key] = W(L, x, y, grid.z(x, y) + 12)
    }
    if (name === "overview") {
      const act = L.panels.find((p) => p.status === "active")
      const fy = (act.rect[1] + act.rect[3]) / 2
      anchors.face = W(L, act.face_x, fy, grid.z(act.face_x, fy) + 20)
      anchors.wells = W(L, 2900, -2150, grid.z(2900, -2150) + 30)
    }
    anchors.n0 = W(L, grid.cx, grid.cy, L.blockBase)
    anchors.n1 = W(L, grid.cx, grid.cy + 1000, L.blockBase)

    const block = {
      name,
      grid,
      group,
      terrain,
      walls,
      floor,
      tex,
      overlay,
      anchors
    }
    this.blocks[name] = block
    return block
  }

  /** 剖切面上的标注点：工作面、采空区上方的垮落 / 裂隙带、大巷与联络巷断面、三层煤 */
  _sectionAnchors(block, act) {
    const L = this.L
    const y = this.cutY
    const on = (x, dz = 0) => W(L, x, y, seamB(L, x, y) + dz)
    const dzOf = (k) => L.seams.find((s) => s.key === k).base
    const bleeder = L.roadways.find((r) => r.kind === "bleeder").pts[0][0]
    const sx = act.face_x - 1000
    Object.assign(block.anchors, {
      secFace: on(act.face_x, 20),
      secGoaf: on((act.face_x + act.rect[2]) / 2, 110),
      secMains: on(330, 20),
      secBleeder: on(bleeder, 20),
      secB: on(sx, 4),
      secE: on(sx, dzOf("E") + 2),
      // F 煤与 E 煤只差 28 m，标签错开放在更西边
      secF: on(sx - 900, dzOf("F") + 2)
    })
  }

  // ================================================================ 专题与显示方式

  /** 专题镜头：目标点 + 方位 / 俯角 / 距离 */
  _viewCam(name) {
    const v = VIEWS[name]
    const b = this.blocks[v.block]
    const c = v.cam
    return {
      target: W(this.L, c.tx, c.ty, b.grid.z(c.tx, c.ty) + c.lift),
      az: c.az,
      pitch: c.pitch,
      dist: c.dist,
      shiftY: c.shiftY ?? { overview: -0.05, plant: 0.03 }[name] ?? 0
    }
  }

  _sectionCam() {
    const act = this.L.panels.find((p) => p.status === "active")
    const x = act.face_x + 500
    return {
      target: W(
        this.L,
        x,
        this.cutY,
        seamB(this.L, x, this.cutY) + SECTION_CAM.lift
      ),
      az: SECTION_CAM.az,
      pitch: SECTION_CAM.pitch,
      dist: SECTION_CAM.dist,
      shiftY: 0
    }
  }

  /** 切换专题（底部标签）：必要时先加载 / 换地形块，再飞到专题镜头 */
  async setView(name) {
    const v = VIEWS[name]
    if (!v || !this.blocks.overview) return
    this.view = name
    this.lastInteract = -1e9
    if (!this.blocks[v.block]) {
      this.onBusy(true)
      try {
        await this._loadBlock(v.block, this.L.closeup, this.L.closeup.center)
      } finally {
        this.onBusy(false)
      }
      if (this.disposed || this.view !== name) return
    }
    const switching = this.current !== v.block
    if (switching) await this._fade(0)
    if (this.view !== name) return
    this._showBlock(v.block)
    this.setMode(v.mode, { instant: switching, fly: false })
    gsap.to(this.look, {
      overlay: v.overlay,
      flow: v.flow ?? 0,
      duration: switching ? 0 : 1
    })
    const cam = this._viewCam(name)
    if (switching) {
      // 换块时从稍远、偏一点的位置飞进来
      this._jumpTo({ ...cam, dist: cam.dist * 1.35, az: cam.az + 18 })
      this._fade(1)
    }
    this._flyTo(cam, switching ? 2.2 : 1.8)
  }

  /** 显示方式：surface / ghost / section（剖切只在全景上有） */
  setMode(mode, { instant = false, fly = true } = {}) {
    if (this.current !== "overview" && mode !== "surface") mode = "surface"
    const prev = this.mode
    this.mode = mode
    const t = LOOKS[mode]
    const d = instant ? 0 : 1.2
    gsap.killTweensOf(this.look, "ghost,under,section")
    gsap.to(this.look, {
      ghost: t.ghost,
      under: t.under,
      section: t.section,
      duration: d,
      ease: "power2.inOut"
    })
    if (!fly) return
    if (mode === "section") this._flyTo(this._sectionCam(), 2)
    else if (prev === "section") this._flyTo(this._viewCam(this.view), 1.8)
  }

  /** 复位：回到当前专题（或剖切）的默认镜头 */
  resetCamera() {
    this.lastInteract = -1e9
    this._flyTo(
      this.mode === "section" ? this._sectionCam() : this._viewCam(this.view),
      1.4
    )
  }

  _showBlock(name) {
    this.current = name
    for (const [k, b] of Object.entries(this.blocks))
      b.group.visible = k === name
    const lim = CONTROL_LIMITS[name]
    Object.assign(this.controls, lim)
  }

  _fade(to) {
    return new Promise((resolve) => {
      gsap.to(this.canvas, { opacity: to, duration: 0.35, onComplete: resolve })
    })
  }

  // ================================================================ 镜头

  _pose() {
    const off = this.camera.position.clone().sub(this.controls.target)
    const dist = off.length()
    return {
      target: this.controls.target.clone(),
      dist,
      pitch: Math.asin(THREE.MathUtils.clamp(off.y / dist, -1, 1)) / DEG,
      az: Math.atan2(off.x, -off.z) / DEG,
      shiftY: this.shiftY ?? 0
    }
  }

  _apply(p) {
    const a = p.az * DEG
    const e = p.pitch * DEG
    const dir = new THREE.Vector3(
      Math.sin(a) * Math.cos(e),
      Math.sin(e),
      -Math.cos(a) * Math.cos(e)
    )
    this.controls.target.copy(p.target)
    this.camera.position.copy(p.target).addScaledVector(dir, p.dist)
    this.camera.lookAt(p.target)
    if (p.shiftY !== this.shiftY) {
      this.shiftY = p.shiftY
      this._viewOffset()
    }
  }

  _jumpTo(p) {
    this.fly?.kill()
    this.fly = null
    this.home = p
    this._apply(p)
  }

  /** 补间飞到目标镜头（方位走近的一边） */
  _flyTo(p, duration) {
    this.fly?.kill()
    this.home = p
    const s = this._pose()
    let az = p.az
    while (az - s.az > 180) az -= 360
    while (az - s.az < -180) az += 360
    const st = { k: 0 }
    const t0 = s.target.clone()
    this.controls.enabled = false
    this.fly = gsap.to(st, {
      k: 1,
      duration,
      ease: "power2.inOut",
      onUpdate: () => {
        const k = st.k
        // 距离按对数插值，远近切换时速度均匀
        this._apply({
          target: t0.clone().lerp(p.target, k),
          az: s.az + (az - s.az) * k,
          pitch: s.pitch + (p.pitch - s.pitch) * k,
          dist: Math.exp(
            Math.log(s.dist) + (Math.log(p.dist) - Math.log(s.dist)) * k
          ),
          shiftY: s.shiftY + (p.shiftY - s.shiftY) * k
        })
      },
      onComplete: () => {
        this.fly = null
        this.controls.enabled = true
      }
    })
  }

  /** 空闲时镜头在默认视角附近缓慢左右摆动 */
  _sway(dt, time) {
    if (this.fly || !this.home) return
    const idle = (performance.now() - this.lastInteract) / 1000
    if (idle < SWAY.idle) return
    const k = 1 - Math.exp(-dt * 0.6)
    const s = this._pose()
    const goalAz =
      this.home.az + SWAY.amp * Math.sin((time / SWAY.period) * Math.PI * 2)
    let dAz = goalAz - s.az
    while (dAz > 180) dAz -= 360
    while (dAz < -180) dAz += 360
    this._apply({
      target: s.target.lerp(this.home.target, k),
      az: s.az + dAz * k,
      pitch: s.pitch + (this.home.pitch - s.pitch) * k,
      dist: s.dist + (this.home.dist - s.dist) * k,
      shiftY: s.shiftY + (this.home.shiftY - s.shiftY) * k
    })
  }

  /** 构图平移：画面中心往上 / 往下挪，给顶栏和底部标签留位置 */
  _viewOffset() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    if (this.shiftY) this.camera.setViewOffset(w, h, 0, -this.shiftY * h, w, h)
    else this.camera.clearViewOffset()
  }

  _resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this._viewOffset()
    this.designScale = w / DESIGN_W
    this.under?.setResolution(w, h)
  }

  // ================================================================ 每帧

  /** 外观补间值 → 材质 */
  _applyLook() {
    const b = this.blocks[this.current]
    if (!b) return
    const lk = this.look
    const ghost = this.current === "overview" ? lk.ghost : 0
    setTerrainLook(
      b.terrain,
      ghost,
      (b.overlay ? lk.overlay : 0) * (1 - ghost) * (1 - lk.section)
    )
    if (this.under && this.current === "overview") {
      this.under.setFade(lk.under)
      this.under.setFlowBoost(lk.flow)
    }
    // 剖切：裁剪面从北边缘扫到工作面中线，剖面跟着走
    const sec = this.current === "overview" ? lk.section : 0
    if (sec > 0.001) {
      const g = b.grid
      const yc = g.cy + g.h / 2 + 10 - (g.cy + g.h / 2 + 10 - this.cutY) * sec
      this.clipPlane.constant = yc
      this.renderer.clippingPlanes = [this.clipPlane]
      this.section.visible = true
      this._moveSection(yc)
    } else if (this.renderer.clippingPlanes.length) {
      this.renderer.clippingPlanes = []
      this.section.visible = false
    }
  }

  /** 剖切面移到 y = yc：更新每列的 y、地表高与地层坐标 */
  _moveSection(yc) {
    if (this._secY === yc) return
    this._secY = yc
    const g = this.blocks.overview.grid
    const geo = this.section.geometry
    const pos = geo.attributes.position
    const real = geo.attributes.aReal
    const surf = geo.attributes.aSurf
    const base = this.L.blockBase
    for (let c = 0; c < pos.count / 2; c++) {
      const x = real.getX(c * 2)
      const top = g.z(x, yc)
      pos.setXYZ(c * 2, x, (top - base) * EXAG, -yc)
      pos.setZ(c * 2 + 1, -yc)
      real.setXYZ(c * 2, x, yc, top)
      real.setY(c * 2 + 1, yc)
      surf.setX(c * 2, top)
      surf.setX(c * 2 + 1, top)
    }
    pos.needsUpdate = true
    real.needsUpdate = true
    surf.needsUpdate = true
    geo.computeBoundingSphere()
  }

  _loop() {
    if (this.disposed) return
    this.frameId = requestAnimationFrame(this._loop)
    this.timer.update()
    const dt = Math.min(this.timer.getDelta(), 0.1)
    const t = this.timer.getElapsed()

    this._sway(dt, t)
    if (!this.fly) this.controls.update()
    this._applyLook()
    const b = this.blocks[this.current]
    if (b) {
      const u = b.terrain.material.uniforms
      u.uHazeNear.value =
        this.camera.position.distanceTo(this.controls.target) * 0.9
      u.uHazeK.value = this.current === "closeup" ? 0.00005 : 0.00004
    }
    if (this.current === "overview") {
      this.under?.update(dt, t, this.sim?.face?.())
      if (this.section?.visible) this.section.material.uniforms.uTime.value = t
    }
    this.composer.render()

    if (this.designScale > 0 && b) {
      const w = this.container.clientWidth
      const h = this.container.clientHeight
      const out = {}
      const v = new THREE.Vector3()
      for (const [k, p] of Object.entries(b.anchors)) {
        v.copy(p).project(this.camera)
        const x = ((v.x + 1) / 2) * w
        const y = ((1 - v.y) / 2) * h
        out[k] = {
          x: x / this.designScale,
          y: y / this.designScale,
          visible: v.z < 1 && x > -40 && x < w + 40 && y > -40 && y < h + 40
        }
      }
      this.onAnchors(out)
    }
  }

  // ================================================================ 释放

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frameId)
    this.fly?.kill()
    gsap.killTweensOf(this.look)
    gsap.killTweensOf(this.canvas)
    this.resizeObserver.disconnect()
    this.controls.dispose()
    this.scene.traverse((o) => {
      o.geometry?.dispose()
      const mats = Array.isArray(o.material)
        ? o.material
        : o.material
          ? [o.material]
          : []
      for (const m of mats) {
        for (const u of Object.values(m.uniforms || {}))
          if (u.value?.isTexture) u.value.dispose()
        m.map?.dispose()
        m.dispose()
      }
    })
    for (const b of Object.values(this.blocks)) {
      b.tex.dispose()
      b.overlay?.dispose()
    }
    this.bgTex.dispose()
    this.composer.dispose()
    this.renderer.dispose()
  }
}

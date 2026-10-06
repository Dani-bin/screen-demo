/*
 * 智慧充电站 三维场景
 * ----------------------------------------------------------
 * 加载 Blender 导出的 public/charging/station.glb（场站）与 cars.glb（车辆预制），
 * 用仿真器（sim/simulator.js）的状态驱动：车位描边与桩灯颜色、桩顶悬浮图标、
 * 车辆进出站、充电线、故障告警波纹、出入口抬杆；另画地面能量流光与沙盘底部光晕。
 *
 * 不依赖 Vue。生命周期：new ChargingScene(opts) → await load() → 自动渲染 → dispose()
 * 回调：
 *   onPick({ pile, x, y } | null)  点击桩 / 车位（x、y 为设计稿坐标，供浮窗定位）
 *   onAnchors({ pv, ess, grid, piles })  四个能量节点锚点的设计稿坐标（每帧）
 */
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js"
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"

import {
  FLOWS,
  PAINT_COLOR,
  STATUS_COLOR,
  STATUS_INTENSITY,
  THEME
} from "./theme"
import { applyPvSheen } from "./pvSheen"
import {
  badgeTexture,
  disposeTextures,
  fadeTexture,
  flowTexture,
  glowTexture
} from "./sprites"

const DEG = Math.PI / 180
/** 设计稿宽度：页面用 rem 等比缩放，场景里也按 实际宽 / 1920 换算 */
const DESIGN_W = 1920

const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2)

export class ChargingScene {
  constructor({ canvas, container, sim, baseUrl, onPick, onAnchors }) {
    this.canvas = canvas
    this.container = container
    this.sim = sim
    this.baseUrl = baseUrl
    this.onPick = onPick || (() => {})
    this.onAnchors = onAnchors || (() => {})
    this.disposed = false
    this.anims = [] // 进行中的补间动画：{ update(dt) → 完成时返回 true }

    // ---------- 渲染器
    const r = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance"
    })
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    // Neutral 色调映射：高亮处不像 ACES 那样褪成白色，状态色（绿 / 蓝 / 红）在辉光里仍保持色相
    r.toneMapping = THREE.NeutralToneMapping
    r.toneMappingExposure = 1.2
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFShadowMap
    this.renderer = r

    // ---------- 场景、环境光
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(THEME.background)
    // 低强度室内环境贴图：给车漆、光伏板、玻璃一点反射，不抬亮暗场
    const pmrem = new THREE.PMREMGenerator(r)
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    scene.environment = this.envMap
    scene.environmentIntensity = 0.3
    this.scene = scene

    scene.add(new THREE.HemisphereLight(0xa8c4f4, 0x1a2230, 1.0))
    const sun = new THREE.DirectionalLight(0xd6e4ff, 1.4)
    sun.position.set(-40, 70, -30)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    Object.assign(sun.shadow.camera, {
      left: -60,
      right: 60,
      top: 50,
      bottom: -50,
      near: 1,
      far: 200
    })
    sun.shadow.bias = -0.0004
    sun.shadow.camera.updateProjectionMatrix()
    scene.add(sun)
    const fill = new THREE.DirectionalLight(0x5f86ff, 0.3)
    fill.position.set(40, 30, 40)
    scene.add(fill)
    this.sun = sun

    // ---------- 正交相机 + 控制器
    const { site } = THEME
    this.center = new THREE.Vector3(
      (site.x0 + site.x1) / 2,
      0,
      (site.z0 + site.z1) / 2
    )
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1000)
    this.controls = new OrbitControls(this.camera, canvas)
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.08,
      rotateSpeed: 0.5,
      minPolarAngle: 30 * DEG,
      maxPolarAngle: 72 * DEG,
      minZoom: 0.7,
      maxZoom: 4,
      screenSpacePanning: true
    })
    this.controls.target.copy(this.center)
    this.homeSpherical = new THREE.Spherical(
      240,
      (90 - THEME.camera.elevation) * DEG,
      this._azimuthToTheta(THEME.camera.azimuth)
    )
    this._placeCamera(this.homeSpherical)
    this.lastInteract = -1e9
    this.controls.addEventListener("start", () => {
      this.lastInteract = performance.now()
      this.userControl = true
    })
    this.controls.addEventListener("end", () => {
      this.lastInteract = performance.now()
    })

    // ---------- 后处理：辉光
    // 后处理会绕开画布自带的抗锯齿，这里给离屏渲染目标开 4 倍 MSAA，边缘才不会发虚、起锯齿
    const rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4
    })
    this.composer = new EffectComposer(r, rt)
    this.composer.addPass(new RenderPass(scene, this.camera))
    const { bloom } = THEME.glow
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(256, 256),
      bloom.strength,
      bloom.radius,
      bloom.threshold
    )
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    // ---------- 交互：点击拾取桩 / 车位
    this.raycaster = new THREE.Raycaster()
    this._downAt = null
    this._onDown = (e) => (this._downAt = [e.clientX, e.clientY])
    this._onUp = (e) => this._pick(e)
    canvas.addEventListener("pointerdown", this._onDown)
    canvas.addEventListener("pointerup", this._onUp)

    this._onResize = () => this._resize()
    this.resizeObserver = new ResizeObserver(this._onResize)
    this.resizeObserver.observe(container)
    this._resize()

    this.timer = new THREE.Timer()
    // 开发环境挂到 window 上，便于在控制台排查（生产构建不暴露）
    if (import.meta.env.DEV) window.__chargingScene = this
    this._loop = this._loop.bind(this)
  }

  // ================================================================ 加载

  async load() {
    const loader = new GLTFLoader()
    const [station, cars, groundBake] = await Promise.all([
      loader.loadAsync(`${this.baseUrl}charging/station.glb`),
      loader.loadAsync(`${this.baseUrl}charging/cars.glb`),
      new THREE.TextureLoader().loadAsync(
        `${this.baseUrl}charging/ground_bake.webp`
      )
    ])
    if (this.disposed) return
    this.station = station.scene
    this.carPrefabs = cars.scene
    this.scene.add(this.station)

    // 材质被许多网格共享，调整强度时每份材质只处理一次，否则会被反复相乘
    const seen = new Set()
    this.station.traverse((o) => {
      if (!o.isMesh) return
      let m = o.material
      const emissive =
        m.emissive && m.emissiveIntensity > 0 && m.emissive.getHex() !== 0
      if (emissive && /^base_led_(top|bottom)$/.test(o.name)) {
        // 沙盘边缘细灯带：顶边、底边各一份材质，强度单独设定（THEME.glow）
        m = o.material = m.clone()
        m.emissiveIntensity =
          o.name === "base_led_top" ? THEME.glow.edgeTop : THEME.glow.edgeBottom
        seen.add(m)
      } else if (emissive && !seen.has(m)) {
        // Blender 里按 Eevee 调的自发光强度（4~8）在 three 里偏亮，统一按比例压低，保留色相不过曝成白
        m.emissiveIntensity *= THEME.glow.emissiveScale
        seen.add(m)
      }
      // 发光件、玻璃不投影；其余投影 + 接收
      o.castShadow = !emissive && !m.transparent
      o.receiveShadow = true
      if (m.transparent) m.depthWrite = false
    })
    // 车漆：每款车只导出一份，车漆材质 M_car_paint 按漆色克隆（每种颜色一份，所有车共享）
    this.paints = {}
    this.carPrefabs.traverse((o) => {
      if (!o.isMesh) return
      o.castShadow = true
      if (o.material.name === "M_car_paint" && !this.paints.white) {
        for (const [k, c] of Object.entries(PAINT_COLOR)) {
          const m = o.material.clone()
          m.color.setHex(c)
          this.paints[k] = m
        }
      }
    })

    // 贴图各向异性过滤：俯视角度下地面、光伏板等斜着看的贴图保持清晰
    const aniso = this.renderer.capabilities.getMaxAnisotropy()
    for (const root of [this.station, this.carPrefabs]) {
      root.traverse((o) => {
        if (!o.isMesh) return
        for (const v of Object.values(o.material))
          if (v && v.isTexture) v.anisotropy = aniso
      })
    }

    this._applyGroundBake(groundBake, aniso)

    // 光伏板：正交相机下平面反射处处相同，叠加按世界坐标计算的反光带（见 pvSheen.js）
    const pvMats = new Set()
    this.station.traverse((o) => {
      if (o.isMesh && o.material.name === "M_pv") pvMats.add(o.material)
    })
    this.pvSheen = [...pvMats].map((m) => applyPvSheen(m))

    this._collect()
    this._buildDecor()
    this._initStatus()
    this.frameId = requestAnimationFrame(this._loop)
  }

  /**
   * 地面换成 Cycles 烘焙的光照贴图（scripts/blender/charging/bake.py）：
   * 雨棚光斑、灯带溢光、建筑与树的软阴影都已「画」在贴图里，用无光照材质直接显示，
   * 走第二套 UV（导出时的 Lightmap UV，three 里是 channel 1）
   */
  _applyGroundBake(tex, aniso) {
    tex.flipY = false // 与 glTF 的 UV 原点约定一致
    tex.colorSpace = THREE.SRGBColorSpace
    tex.channel = 1
    tex.anisotropy = aniso
    this.groundBake = tex
    const ground = this.station.getObjectByName("ground")
    ground?.traverse((o) => {
      if (o.isMesh && o.material.name === "M_asphalt") {
        o.material = new THREE.MeshBasicMaterial({ map: tex })
        o.receiveShadow = false
      }
    })
  }

  /** 按命名约定收集需要驱动的对象：桩、车位、闸杆、能量节点锚点 */
  _collect() {
    const s = this.station
    this.piles = new Map() // pileId → { root, status(Mesh), badge(Sprite), top(Vector3) }
    this.bays = new Map() // gunId → { mesh, center, heading, pile }
    for (const pile of this.sim.guns.reduce(
      (acc, g) => (acc.includes(g.pile) ? acc : [...acc, g.pile]),
      []
    )) {
      const root = s.getObjectByName(`pile_${pile}`)
      if (!root) continue
      const status = s.getObjectByName(`pile_${pile}_status`)
      // 每根桩的状态灯材质独立一份，才能各自变色
      status?.traverse((o) => {
        if (o.isMesh) o.material = o.material.clone()
      })
      const top = new THREE.Box3().setFromObject(root).max.y
      const pos = root.getWorldPosition(new THREE.Vector3())
      this.piles.set(pile, { root, status, pos, top })
    }
    for (const g of this.sim.guns) {
      const mesh = s.getObjectByName(`bay_${g.id}`)
      if (!mesh) continue
      mesh.material = mesh.material.clone()
      const box = new THREE.Box3().setFromObject(mesh)
      const center = box.getCenter(new THREE.Vector3())
      center.y = 0
      // 车头朝向桩：从车位中心指向桩
      const pile = this.piles.get(g.pile)
      const dir = pile.pos.clone().sub(center).setY(0).normalize()
      // 双枪快充桩在桩岛中线上，车位中心到桩的方向即垂直于桩岛；超充终端在车位一侧，只取主轴
      if (Math.abs(dir.x) > Math.abs(dir.z)) dir.set(Math.sign(dir.x), 0, 0)
      else dir.set(0, 0, Math.sign(dir.z))
      this.bays.set(g.id, {
        mesh,
        center,
        dir,
        pile,
        car: null,
        cable: null,
        alarm: null
      })
    }
    this.gates = {
      in: s.getObjectByName("gate_in_arm"),
      out: s.getObjectByName("gate_out_arm")
    }
    for (const arm of Object.values(this.gates)) {
      if (!arm) continue
      arm.userData.base = arm.quaternion.clone()
      arm.userData.lift = 0
      arm.userData.sign = this._liftSign(arm)
    }
    // 能量节点锚点（世界坐标）
    const topOf = (name, dy = 0.5) => {
      const o = s.getObjectByName(name)
      if (!o) return this.center.clone()
      const b = new THREE.Box3().setFromObject(o)
      const c = b.getCenter(new THREE.Vector3())
      c.y = b.max.y + dy
      return c
    }
    const essA = topOf("ess_03")
    const essB = topOf("ess_04")
    this.anchorPoints = {
      pv: topOf("canopy_F1_pv"),
      ess: essA.add(essB).multiplyScalar(0.5),
      grid: topOf("transformer_01"),
      piles: topOf("pile_A02", 0.8)
    }
  }

  /** 闸杆抬起方向：试转一下，看杆端是否升高（导出后局部轴向与 Blender 不同，运行时判断最稳） */
  _liftSign(arm) {
    const tip = new THREE.Vector3(3, 0, 0)
    const q = arm.userData.base
      .clone()
      .multiply(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.5)
      )
    const up = tip.clone().applyQuaternion(q).y
    const base = tip.clone().applyQuaternion(arm.userData.base).y
    return up > base ? 1 : -1
  }

  /**
   * 沿沙盘圆角矩形轮廓的一圈渐隐光带（加色混合）：
   * 内圈外扩 grow0 米、高 y0，外圈外扩 grow1 米、高 y1；内圈最亮，向外圈渐隐。
   * 外扩相同、高度不同 → 贴在侧壁上的竖直光带；高度相同、外扩不同 → 地面上的一圈光晕
   */
  _edgeStrip(grow0, grow1, y0, y1) {
    const { x0, x1, z0, z1, corner: c } = THEME.site
    // 四个圆角的圆心与起始角（three 的 xz 平面，逆时针一圈）
    const arcs = [
      [x1 - c, z1 - c, 0],
      [x0 + c, z1 - c, 0.5 * Math.PI],
      [x0 + c, z0 + c, Math.PI],
      [x1 - c, z0 + c, 1.5 * Math.PI]
    ]
    const SEG = 12
    const pos = []
    const uv = []
    const ring = []
    for (const [cx, cz, a0] of arcs) {
      for (let i = 0; i <= SEG; i++) {
        const a = a0 + (i / SEG) * 0.5 * Math.PI
        ring.push([cx, cz, Math.cos(a), Math.sin(a)])
      }
    }
    ring.push(ring[0])
    ring.forEach(([cx, cz, dx, dz], i) => {
      const u = i / (ring.length - 1)
      pos.push(cx + dx * (c + grow0), y0, cz + dz * (c + grow0))
      pos.push(cx + dx * (c + grow1), y1, cz + dz * (c + grow1))
      uv.push(u, 0, u, 1)
    })
    const index = []
    for (let i = 0; i < ring.length - 1; i++) {
      const a = i * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
    geo.setIndex(index)
    return new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: THEME.glow.edgeColor,
        map: fadeTexture(),
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      })
    )
  }

  /** 场景装饰：沙盘下方光晕与网格、地面能量流光、桩顶图标 */
  _buildDecor() {
    const { site } = THEME
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 120),
      new THREE.MeshBasicMaterial({
        map: glowTexture("40,140,240"),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: THEME.glow.pool
      })
    )
    glow.rotation.x = -Math.PI / 2
    glow.position.set(this.center.x, -site.base - 0.8, this.center.z)
    this.scene.add(glow)
    // 设计稿的底座：侧壁底部打出蓝光向上渐隐，地面上沿轮廓一圈柔和光晕
    const wash = this._edgeStrip(0.04, 0.04, -site.base, -site.base + 1.8)
    const halo = this._edgeStrip(0.1, 9, -site.base - 0.78, -site.base - 0.78)
    wash.material.opacity = THEME.glow.wallWash
    halo.material.opacity = THEME.glow.floorHalo
    this.scene.add(wash, halo)
    const grid = new THREE.GridHelper(400, 100, 0x1b4a76, 0x10305a)
    grid.material.transparent = true
    grid.material.opacity = 0.28
    grid.position.set(this.center.x, -site.base - 0.9, this.center.z)
    this.scene.add(grid)
    this.decor = [glow, grid]

    // 地面能量流光：沿路径的扁平飘带，贴流光条纹并滚动
    const tex = flowTexture()
    tex.repeat.set(1, 1)
    this.flowTex = tex
    for (const f of FLOWS) {
      const mesh = this._ribbon(f.pts, 0.42, f.color, tex)
      this.scene.add(mesh)
      this.decor.push(mesh)
    }

    // 状态图标：快充挂在雨棚南檐口（朝镜头一侧）下方，不压住屋面光伏；超充浮在光环之上
    for (const [id, p] of this.piles) {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: badgeTexture(STATUS_COLOR.idle, "bolt"),
          depthTest: false,
          transparent: true
        })
      )
      const fast = id.startsWith("B")
      if (fast) {
        // 檐口在桩岛中线以南 CANOPY_W / 2（Blender 的 -y 即 three 的 +z）
        sp.position.set(p.pos.x, THEME.badge.eaveY, p.pos.z + THEME.badge.eaveZ)
      } else {
        sp.position.set(p.pos.x, p.top + 1.3, p.pos.z)
      }
      sp.scale.setScalar(fast ? THEME.badge.fast : 2.2)
      sp.renderOrder = 10
      this.scene.add(sp)
      p.badge = sp
    }
  }

  /** 折线 → 地面飘带网格（u 坐标按米累计，4 米一个流光周期） */
  _ribbon(pts, width, color, tex) {
    const pos = []
    const uv = []
    const idx = []
    let dist = 0
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i]
      const prev = pts[Math.max(0, i - 1)]
      const next = pts[Math.min(pts.length - 1, i + 1)]
      const dx = next[0] - prev[0]
      const dz = next[1] - prev[1]
      const len = Math.hypot(dx, dz) || 1
      const nx = (-dz / len) * (width / 2)
      const nz = (dx / len) * (width / 2)
      if (i > 0) dist += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1])
      pos.push(x + nx, 0.07, z + nz, x - nx, 0.07, z - nz)
      uv.push(-dist / 4, 0, -dist / 4, 1)
      if (i > 0) {
        const a = (i - 1) * 2
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
    geo.setIndex(idx)
    const mat = new THREE.MeshBasicMaterial({
      color,
      map: tex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    })
    // 底色：一条常亮的暗线，流光在其上滚动
    const mesh = new THREE.Mesh(geo, mat)
    const base = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.22,
        depthWrite: false
      })
    )
    mesh.add(base)
    return mesh
  }

  // ================================================================ 状态同步

  _initStatus() {
    for (const g of this.sim.guns) this.updateGun(g, true)
  }

  /** 某把枪状态变化：车位描边、桩灯与图标、车辆、充电线、告警波纹 */
  updateGun(g, instant = false) {
    const bay = this.bays.get(g.id)
    if (!bay) return
    this._tint(bay.mesh, g.status)
    this._updatePile(g.pile)

    // 车辆：有车且尚未摆放 → 摆放（进站时从通道滑入）；驶离 → 滑出后移除
    if (g.car && !bay.car && g.status !== "leaving") {
      bay.car = this._spawnCar(g.car, bay, instant || g.status !== "arriving")
    }
    if (g.status === "leaving" && bay.car) {
      this._driveOut(bay)
      this._gate("out")
    }
    if (g.status === "arriving") this._gate("in")
    if (g.status === "idle" && bay.car) {
      this.scene.remove(bay.car)
      bay.car = null
    }

    // 充电线：只在充电中显示
    if (g.status === "charging" && !bay.cable && bay.car)
      bay.cable = this._cable(bay)
    if (g.status !== "charging" && bay.cable) {
      this.scene.remove(bay.cable)
      bay.cable.geometry.dispose()
      bay.cable = null
    }

    // 告警波纹：故障时显示
    if (g.status === "fault" && !bay.alarm) bay.alarm = this._alarm(bay.center)
    if (g.status !== "fault" && bay.alarm) {
      this.scene.remove(bay.alarm)
      bay.alarm = null
    }
  }

  /** 桩级状态（故障 / 离线优先，其次任一枪在充）→ 状态灯颜色 + 顶部图标 */
  _updatePile(pileId) {
    const p = this.piles.get(pileId)
    if (!p) return
    const guns = this.sim.guns.filter((g) => g.pile === pileId)
    let st = "idle"
    if (guns.some((g) => g.status === "offline")) st = "offline"
    else if (guns.some((g) => g.status === "fault")) st = "fault"
    else if (
      guns.some((g) => ["charging", "full", "arriving"].includes(g.status))
    )
      st = "charging"
    if (p.state === st) return
    p.state = st
    p.status?.traverse((o) => o.isMesh && this._tint(o, st))
    const glyph = st === "fault" ? "warn" : st === "offline" ? "off" : "bolt"
    p.badge.material.map = badgeTexture(STATUS_COLOR[st], glyph)
    p.badge.material.needsUpdate = true
  }

  _tint(mesh, status) {
    const c = STATUS_COLOR[status] ?? STATUS_COLOR.idle
    const m = mesh.material
    m.color.setHex(c)
    if (m.emissive) {
      m.emissive.setHex(c)
      m.emissiveIntensity =
        status === "offline"
          ? STATUS_INTENSITY.offline
          : STATUS_INTENSITY.default
    }
  }

  /** 摆一辆车（克隆预制，共享几何与材质）；animate 时从通道一侧滑入车位 */
  _spawnCar(car, bay, instant) {
    const prefab =
      this.carPrefabs.getObjectByName(`car_${car.kind}`) ||
      this.carPrefabs.children[0]
    const obj = prefab.clone()
    const paint = this.paints[car.paint] || this.paints.white
    obj.traverse((o) => {
      if (o.isMesh && o.material.name === "M_car_paint") o.material = paint
    })
    obj.position.copy(bay.center)
    obj.rotation.set(0, Math.atan2(-bay.dir.z, bay.dir.x), 0)
    // 地面是烘焙贴图、不接收实时阴影，车底补一块柔和的接触阴影
    obj.add(this._carShadow())
    this.scene.add(obj)
    if (!instant) {
      const from = bay.center
        .clone()
        .addScaledVector(bay.dir, -THEME.drive.dist)
      this._tween(THEME.drive.dur, (k) =>
        obj.position.lerpVectors(from, bay.center, easeInOut(k))
      )
    }
    return obj
  }

  /** 车底接触阴影：径向渐变的半透明黑色贴片（所有车共享几何与材质） */
  _carShadow() {
    if (!this._shadowGeo) {
      this._shadowGeo = new THREE.PlaneGeometry(5.6, 2.6)
      this._shadowGeo.rotateX(-Math.PI / 2)
      this._shadowMat = new THREE.MeshBasicMaterial({
        map: glowTexture("0,0,0"),
        transparent: true,
        depthWrite: false,
        opacity: 0.95
      })
    }
    const m = new THREE.Mesh(this._shadowGeo, this._shadowMat)
    m.position.y = 0.04
    m.renderOrder = -1
    return m
  }

  _driveOut(bay) {
    const obj = bay.car
    bay.car = null
    const to = bay.center.clone().addScaledVector(bay.dir, -THEME.drive.dist)
    const from = obj.position.clone()
    this._tween(
      THEME.drive.dur,
      (k) => obj.position.lerpVectors(from, to, easeInOut(k)),
      () => this.scene.remove(obj)
    )
  }

  /** 充电线：桩侧枪座 → 车头充电口，下垂曲线，发光 */
  _cable(bay) {
    const p = bay.pile.pos
    const start = new THREE.Vector3(p.x, 1.15, p.z).addScaledVector(
      bay.dir,
      -0.3
    )
    const side = new THREE.Vector3(-bay.dir.z, 0, bay.dir.x)
    const end = bay.center
      .clone()
      .addScaledVector(bay.dir, 2.25)
      .addScaledVector(side, 0.55)
      .setY(0.85)
    const mid = start.clone().lerp(end, 0.5)
    mid.y = Math.min(start.y, end.y) - 0.5
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end)
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 20, 0.04, 6),
      this._cableMat ||
        (this._cableMat = new THREE.MeshStandardMaterial({
          color: 0x34e07a,
          emissive: 0x34e07a,
          emissiveIntensity: 3
        }))
    )
    this.scene.add(mesh)
    return mesh
  }

  /** 故障告警：三道向外扩散的红色圆环 + 中心红色光晕 */
  _alarm(center) {
    const g = new THREE.Group()
    g.position.copy(center).setY(0.08)
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 7),
      new THREE.MeshBasicMaterial({
        map: glowTexture("255,59,71"),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    )
    glow.rotation.x = -Math.PI / 2
    g.add(glow)
    g.userData.rings = []
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.0, 1.12, 64),
        new THREE.MeshBasicMaterial({
          color: 0xff3b47,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide
        })
      )
      ring.rotation.x = -Math.PI / 2
      ring.userData.phase = i / 3
      g.add(ring)
      g.userData.rings.push(ring)
    }
    this.scene.add(g)
    this.alarms = this.alarms || new Set()
    this.alarms.add(g)
    return g
  }

  /** 出入口抬杆：抬起 → 停 2 秒 → 落下 */
  _gate(which) {
    const arm = this.gates[which]
    if (!arm || arm.userData.busy) return
    arm.userData.busy = true
    const set = (k) => {
      const q = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        arm.userData.sign * k * 82 * DEG
      )
      arm.quaternion.copy(arm.userData.base).multiply(q)
    }
    this._tween(
      0.9,
      (k) => set(easeInOut(k)),
      () => {
        setTimeout(() => {
          this._tween(
            1.1,
            (k) => set(1 - easeInOut(k)),
            () => (arm.userData.busy = false)
          )
        }, 2000)
      }
    )
  }

  _tween(dur, step, done) {
    let t = 0
    this.anims.push({
      update: (dt) => {
        t = Math.min(dur, t + dt)
        step(t / dur)
        if (t >= dur) {
          done?.()
          return true
        }
        return false
      }
    })
  }

  // ================================================================ 相机

  /** 设计稿方位角（Blender：0 为东，逆时针）→ three 球坐标 theta（绕 y 轴，从 +z 起） */
  _azimuthToTheta(az) {
    const x = Math.cos(az * DEG)
    const z = -Math.sin(az * DEG)
    return Math.atan2(x, z)
  }

  _placeCamera(sph) {
    const off = new THREE.Vector3().setFromSpherical(sph)
    this.camera.position.copy(this.controls.target).add(off)
    this.camera.lookAt(this.controls.target)
  }

  /**
   * 正交视锥：让沙盘（含底座厚度与设备高度）落进设计稿的目标框（THEME.fit），
   * 视锥不对称，场站因此能避开左右面板居中。窗口比例变化时按设计稿宽度等比缩放
   */
  _fitFrustum() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    const s = w / DESIGN_W
    const Hd = h / s // 设计稿坐标下的画面高
    const { site, fit } = THEME
    const cam = this.camera
    // 用初始视角计算一次包围范围（之后旋转 / 缩放都基于这个视锥）
    const probe = new THREE.OrthographicCamera()
    probe.position
      .copy(this.center)
      .add(new THREE.Vector3().setFromSpherical(this.homeSpherical))
    probe.lookAt(this.center)
    probe.updateMatrixWorld()
    const inv = probe.matrixWorldInverse
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const x of [site.x0, site.x1])
      for (const z of [site.z0, site.z1])
        for (const y of [-site.base, 6]) {
          const v = new THREE.Vector3(x, y, z).applyMatrix4(inv)
          minX = Math.min(minX, v.x)
          maxX = Math.max(maxX, v.x)
          minY = Math.min(minY, v.y)
          maxY = Math.max(maxY, v.y)
        }
    const scale = Math.max((maxX - minX) / fit.w, (maxY - minY) / fit.h)
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const fx = fit.x + fit.w / 2
    const fy = fit.y + fit.h / 2
    cam.left = cx - fx * scale
    cam.right = cx + (DESIGN_W - fx) * scale
    cam.top = cy + fy * scale
    cam.bottom = cy - (Hd - fy) * scale
    cam.near = 1
    cam.far = 1000
    cam.updateProjectionMatrix()
    this.designScale = s
  }

  _resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.bloom.resolution.set(w, h)
    this._fitFrustum()
  }

  /** 空闲时：镜头回到主视角附近并缓慢左右摆动；人工操作后 THEME.sway.idle 秒内不干预 */
  _autoCamera(dt, time) {
    const idle = (performance.now() - this.lastInteract) / 1000
    if (idle < THEME.sway.idle) return
    const c = this.controls
    const k = 1 - Math.exp(-dt * 0.8)
    const sph = new THREE.Spherical().setFromVector3(
      this.camera.position.clone().sub(c.target)
    )
    const swayTheta =
      this.homeSpherical.theta +
      THEME.sway.amp * DEG * Math.sin((time / THEME.sway.period) * Math.PI * 2)
    sph.theta += (swayTheta - sph.theta) * k
    sph.phi += (this.homeSpherical.phi - sph.phi) * k
    c.target.lerp(this.center, k)
    this.camera.zoom += (1 - this.camera.zoom) * k
    this.camera.updateProjectionMatrix()
    this._placeCamera(sph)
  }

  // ================================================================ 交互

  _pick(e) {
    if (!this._downAt || !this.station) return
    const moved = Math.hypot(
      e.clientX - this._downAt[0],
      e.clientY - this._downAt[1]
    )
    this._downAt = null
    if (moved > 5) return // 拖拽旋转，不算点击
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const hits = this.raycaster.intersectObject(this.station, true)
    for (const h of hits) {
      let o = h.object
      while (o) {
        const m = o.name.match(/^(?:pile|bay)_([AB]\d\d)/)
        if (m) {
          this.selected = m[1]
          this.onPick({
            pile: m[1],
            ...this._toDesign(
              this.piles.get(m[1]).pos.clone().setY(this.piles.get(m[1]).top)
            )
          })
          return
        }
        o = o.parent
      }
    }
    this.selected = null
    this.onPick(null)
  }

  /** 世界坐标 → 设计稿坐标（1920 宽） */
  _toDesign(v) {
    const p = v.clone().project(this.camera)
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    return {
      x: (((p.x + 1) / 2) * w) / this.designScale,
      y: (((1 - p.y) / 2) * h) / this.designScale
    }
  }

  // ================================================================ 渲染循环

  _loop() {
    if (this.disposed) return
    this.frameId = requestAnimationFrame(this._loop)
    this.timer.update()
    const dt = Math.min(this.timer.getDelta(), 0.1)
    const time = this.timer.getElapsed()
    for (const u of this.pvSheen || []) u.uTime.value = time

    this._autoCamera(dt, time)
    this.controls.update()

    this.anims = this.anims.filter((a) => !a.update(dt))
    if (this.flowTex)
      this.flowTex.offset.x = (this.flowTex.offset.x + dt * 0.45) % 1
    if (this._cableMat)
      this._cableMat.emissiveIntensity = 2.2 + Math.sin(time * 4) * 0.8
    for (const g of this.alarms || []) {
      if (!g.parent) {
        this.alarms.delete(g)
        continue
      }
      for (const ring of g.userData.rings) {
        const k = (time * 0.6 + ring.userData.phase) % 1
        ring.scale.setScalar(1 + k * 2.6)
        ring.material.opacity = 1 - k
      }
    }
    // 桩顶图标轻微上下浮动
    for (const p of this.piles?.values() || []) {
      if (p.badge) p.badge.position.y += Math.sin(time * 2 + p.pos.x) * 0.002
    }

    this.composer.render()

    // 容器尺寸为 0（标签页隐藏、尚未布局）时缩放比为 0，换算会得到 NaN，跳过本帧
    if (this.anchorPoints && this.designScale > 0) {
      const out = {}
      for (const [k, v] of Object.entries(this.anchorPoints))
        out[k] = this._toDesign(v)
      this.onAnchors(out)
    }
  }

  // ================================================================ 释放

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frameId)
    this.resizeObserver?.disconnect()
    this.canvas.removeEventListener("pointerdown", this._onDown)
    this.canvas.removeEventListener("pointerup", this._onUp)
    this.controls.dispose()
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose()
      const mats = Array.isArray(o.material)
        ? o.material
        : o.material
          ? [o.material]
          : []
      for (const m of mats) {
        for (const v of Object.values(m)) if (v && v.isTexture) v.dispose()
        m.dispose()
      }
    })
    this.carPrefabs?.traverse((o) => o.geometry?.dispose())
    for (const m of Object.values(this.paints || {})) m.dispose()
    disposeTextures()
    this.envMap?.dispose()
    this.sun.shadow.map?.dispose()
    this.composer.dispose()
    this.renderer.dispose()
  }
}

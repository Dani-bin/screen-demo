/**
 * 青原露天矿：三维场景（无 Vue 依赖）
 * ----------------------------------------------------------
 * 页面外壳只依赖下面这些公开方法（接口说明见各方法注释）；场景内部字段页面不要碰。
 *
 * 坐标：project() 返回画布左上角起算的 CSS 像素；页面自己减去舞台原点、除以舞台缩放得到舞台坐标。
 * 视角键 VIEWS：overview 总览 / fleet 车队 / swap 换电站 / shovel 电铲装车 / slope 边坡雷达 / yard 煤场电厂。
 * 画面：18 × 13.5 km 的真实地形（Sentinel-2 影像压暗调蓝）+ 自建的采坑碗，设备放大到看得见，
 * 卡车按仿真状态沿路线行驶（见 trucks.js），道路、皮带上有流动的光点。
 */
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"

import layout from "../data/layout.json"
import { ROUTES as SIM_ROUTES, SHOVEL_STATE } from "../sim/simulator.js"
import {
  edged,
  makeBarn,
  makeBucketWheel,
  makeChimney,
  makeCoolingTower,
  makeCrusher,
  makeMast,
  makeOfficeBlocks,
  makePlantBlocks,
  makeRadarTower,
  makeShovel,
  makeSolarField,
  makeSteam,
  makeSwapStation
} from "./props.js"
import { buildRibbon } from "./roads.js"
import { buildTerrain } from "./terrain.js"
import { THEME } from "./theme.js"
import { Trucks } from "./trucks.js"
import { PlateLayer } from "./plate.js"
import { TOUR, VIEWS } from "./tour.js"
import { buildRoutes, loadWorld, Route, toV3, VS, world } from "./world.js"

export { TOUR, VIEWS }

const BASE = import.meta.env.BASE_URL
const SC = THEME.scale
const clamp01 = (x, a, b) => Math.min(b, Math.max(a, x))
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const yawToRotY = (yaw) => Math.atan2(Math.cos(yaw), -Math.sin(yaw))

/** 设备锚点的高度补偿（米，已含放大倍数，让标签落在设备顶上） */
const ANCHOR_UP = {
  shovel: 26 * SC.shovel,
  crusher: 22 * SC.crusher,
  plant: 150,
  barn: 80,
  belt: 60,
  swap: 40,
  radar: 56 * SC.radar,
  dump: 100,
  bw: 70 * 5.5,
  default: 60
}

/**
 * 三维场景。
 * 接口：ready / setState / focus / select / setTour / setFrozen / project / resize / dispose
 */
export default class PitScene {
  /**
   * @param {HTMLCanvasElement} canvas 铺满窗口的画布
   * @param {object} options
   * @param {() => {x:number,y:number,w:number,h:number}} options.stageBox 舞台在窗口里的矩形（像素），场景据此决定取景中心
   * @param {(id: string|null) => void} [options.onSelect] 在三维里点选了卡车 / 设备（null 表示点空白取消）
   * @param {(view: string) => void} [options.onView] 相机视角变了（导览自动切换时通知页面高亮控制台按钮）
   * @param {(info: {view:string, next:string, left:number, on:boolean}) => void} [options.onTour] 导览状态
   * @param {"low"|"mid"|"high"} [options.quality]
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas
    this.options = options
    this.state = null
    this.prev = null
    this.prevById = null
    this.stateWall = 0
    this.monitors = null
    this.selected = null
    this.view = "overview"
    this.tourOn = false
    this.tourI = 0
    this.tourLeft = TOUR[0].dwell
    this._tourSec = -1
    this.frozen = false
    this._tween = null
    this._anchors = new Map()
    this._shovels = new Map()
    this.plate = null // 总览底图层（options.plateCanvas 给了才有）
    this.plateK = 0 // 底图显示程度 0–1：1 = 总览底图完全盖住三维
    this._last = performance.now()
    this.time = 0
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
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.toneMappingExposure = 1.15
    renderer.setClearColor(THEME.bg, 1)
    this.renderer = renderer

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(THEME.bg)
    this.scene = scene
    const cam = new THREE.PerspectiveCamera(THEME.fov, 16 / 9, 40, 90000)
    this.camera = cam

    scene.add(new THREE.HemisphereLight(0x8fb7ff, 0x0a1420, 1.0))
    const sun = new THREE.DirectionalLight(0xcfe8ff, 1.2)
    sun.position.set(2500, 4500, -2200)
    scene.add(sun)

    this.grid = await loadWorld(BASE)
    this.routes = buildRoutes()

    // 地形
    this.terrain = buildTerrain(this.grid)
    scene.add(this.terrain)

    // 坑底暖光池跟着坑底的设备走
    const floorIds = ["ES-06", "ES-07", "CR-02"]
    floorIds.forEach((id, i) => {
      const p = world.positions[id]
      this.terrain.material.uniforms.uPool.value[i].set(p.x, -p.y)
    })

    this._buildRoads()
    this._buildEquipment()
    this._buildPlant()
    this._buildMonitoring()
    this._buildSelection()

    // 卡车
    this.trucks = new Trucks(
      layout.devices.filter((d) => d.kind === "truck"),
      this.routes,
      this.grid,
      SIM_ROUTES
    )
    scene.add(this.trucks.group())

    // 总览底图：设计稿的场景图 + 实时叠加（?plate=0 关掉，退回纯三维）
    if (this.options.plateCanvas && !this.options.noPlate) {
      try {
        this.plate = new PlateLayer(this.options.plateCanvas, {
          stageBox: this.options.stageBox,
          simRoutes: SIM_ROUTES,
          trucks: layout.devices.filter((d) => d.kind === "truck")
        })
        await this.plate.load(BASE)
        this.plateK = this.view === "overview" ? 1 : 0
      } catch (err) {
        console.warn("[open-pit] 总览底图不可用，退回三维总览", err)
        this.plate = null
      }
    }

    // 后期：渲染 → 辉光 → 输出（色调映射只在最后做一次）
    const composer = new EffectComposer(
      renderer,
      new THREE.WebGLRenderTarget(4, 4, {
        type: THREE.HalfFloatType,
        samples: 0
      })
    )
    composer.addPass(new RenderPass(scene, cam))
    const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.45, 0.5, 0.75)
    const setSize = bloom.setSize.bind(bloom)
    bloom.setSize = (w, h) => setSize(Math.ceil(w / 2), Math.ceil(h / 2)) // 辉光本来就是模糊的光晕，半分辨率足够
    composer.addPass(bloom)
    composer.addPass(new OutputPass())
    this.composer = composer
    this.bloom = bloom

    // 相机控制：只转和缩放，不平移（构图由视角预设决定）
    const controls = new OrbitControls(cam, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.enablePan = false
    controls.minDistance = 700
    controls.maxDistance = 24000
    controls.maxPolarAngle = THREE.MathUtils.degToRad(86)
    controls.minPolarAngle = THREE.MathUtils.degToRad(8)
    controls.rotateSpeed = 0.55
    controls.addEventListener("start", () => this._interaction())
    this.controls = controls
    this._applyView("overview", false)

    this._bindPointer()
    this.resize()
    this._last = performance.now()
    this._raf = requestAnimationFrame(this._loop)
  }

  // ================================================================ 搭建

  _ground(x, y) {
    return this.grid.height(x, y) * VS
  }

  /** 径向渐隐的白色光斑贴图（暖光池用，颜色由材质的 color 决定），只建一次 */
  _glow() {
    if (this._glowTex) return this._glowTex
    const cv = document.createElement("canvas")
    cv.width = cv.height = 128
    const c = cv.getContext("2d")
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, "rgba(255,255,255,1)")
    g.addColorStop(0.45, "rgba(255,255,255,0.35)")
    g.addColorStop(1, "rgba(255,255,255,0)")
    c.fillStyle = g
    c.fillRect(0, 0, 128, 128)
    this._glowTex = new THREE.CanvasTexture(cv)
    return this._glowTex
  }

  /** 把物体放到世界 (x, y)，落在地面上，并按 yaw（世界朝向角）转 */
  _place(obj, x, y, yaw = 0, up = 0) {
    obj.position.set(x, this._ground(x, y) + up, -y)
    obj.rotation.y = yawToRotY(yaw)
    this.scene.add(obj)
    return obj
  }

  _anchor(id, x, y, up) {
    this._anchors.set(id, { x, y, up })
  }

  _buildRoads() {
    this.roadMeshes = []
    for (const [id, r] of Object.entries(this.routes)) {
      const mesh = buildRibbon(r, this.grid, {
        width: 30,
        lift: 14,
        color: THEME.cyan,
        speed: 16,
        dash: 460,
        opacity: 0.9
      })
      mesh.name = `road_${id}`
      this.scene.add(mesh)
      this.roadMeshes.push(mesh)
    }
    // 输煤走廊：架空的琥珀色带，光点流向电厂
    const belt = new Route(world.belt)
    this.belt = belt
    const bm = buildRibbon(belt, this.grid, {
      width: 56,
      lift: 120,
      color: THEME.amber,
      speed: 22,
      dash: 300,
      opacity: 1
    })
    this.scene.add(bm)
    this.roadMeshes.push(bm)
    // 走廊本体：细长的暗盒子，沿折线一段一段铺
    const tube = new THREE.Group()
    for (let i = 0; i < belt.pts.length - 1; i++) {
      const [x0, y0] = belt.pts[i]
      const [x1, y1] = belt.pts[i + 1]
      const len = Math.hypot(x1 - x0, y1 - y0)
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(len, 30, 44),
        new THREE.MeshStandardMaterial({
          color: 0x1d3b55,
          roughness: 0.5,
          metalness: 0.4,
          transparent: true,
          opacity: 0.85
        })
      )
      const cx = (x0 + x1) / 2
      const cy = (y0 + y1) / 2
      m.position.set(cx, this._ground(cx, cy) + 108, -cy)
      // 盒子长边沿 x：绕 three 的 y 轴转 θ，x 轴落到 (cosθ, 0, -sinθ)，正好是世界方向 (cosθ, sinθ) 在 (x, z=-y) 里的样子
      m.rotation.y = Math.atan2(y1 - y0, x1 - x0)
      tube.add(edged(m))
    }
    this.scene.add(tube)
    this._anchor(
      "BC-02",
      belt.atMeters(belt.len * 0.62).x,
      belt.atMeters(belt.len * 0.62).y,
      ANCHOR_UP.belt
    )
  }

  _buildEquipment() {
    const P = world.positions
    // 电铲 7 台：朝坑壁（朝向坑中心）
    const [pcx, pcy] = world.pit.center
    this.shovelObjs = []
    for (let i = 1; i <= 7; i++) {
      const id = `ES-0${i}`
      const p = P[id]
      const s = makeShovel()
      s.group.scale.setScalar(SC.shovel)
      const yaw = Math.atan2(pcy - p.y, pcx - p.x) + (i % 2 ? 0.5 : -0.5)
      this._place(s.group, p.x, p.y, yaw)
      this._anchor(id, p.x, p.y, ANCHOR_UP.shovel)
      this._shovels.set(id, s)
      // 地面青色圆环 + 暖色光池（装车时亮），设计稿里每台电铲脚下都有
      const gy = this._ground(p.x, p.y)
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.93, 1, 48),
        new THREE.MeshBasicMaterial({
          color: THEME.cyan,
          transparent: true,
          opacity: 0.8,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      )
      ring.rotation.x = -Math.PI / 2
      ring.scale.setScalar(150)
      ring.position.set(p.x, gy + 16, -p.y)
      const pool = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: this._glow(),
          color: THEME.amber,
          transparent: true,
          opacity: 0.2,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      )
      pool.rotation.x = -Math.PI / 2
      pool.scale.setScalar(520)
      pool.position.set(p.x, gy + 14, -p.y)
      this.scene.add(ring, pool)
      this.shovelObjs.push({ id, ...s, phase: i * 1.7, pool })
    }
    // 轮斗挖掘机：北帮
    const bw = makeBucketWheel()
    bw.group.scale.setScalar(5.5)
    this._place(
      bw.group,
      P["BW-01"].x,
      P["BW-01"].y,
      Math.atan2(pcy - P["BW-01"].y, pcx - P["BW-01"].x)
    )
    this.bw = bw
    this._anchor("BW-01", P["BW-01"].x, P["BW-01"].y, ANCHOR_UP.bw)
    // 破碎站：CR-01 半移动破碎站（坑东南缘，大），CR-02 自移式破碎机（坑底，小）
    const c1 = makeCrusher()
    c1.scale.setScalar(SC.crusher)
    this._place(c1, P["CR-01"].x, P["CR-01"].y, -0.6)
    this._anchor("CR-01", P["CR-01"].x, P["CR-01"].y, ANCHOR_UP.crusher)
    const c2 = makeCrusher()
    c2.scale.setScalar(SC.crusher * 0.7)
    this._place(c2, P["CR-02"].x, P["CR-02"].y, 0.4)
    this._anchor("CR-02", P["CR-02"].x, P["CR-02"].y, ANCHOR_UP.crusher)
    // 换电站
    this.swapObjs = []
    for (const id of ["SW-01", "SW-02"]) {
      const g = makeSwapStation()
      g.scale.setScalar(SC.station)
      this._place(g, P[id].x, P[id].y, 0)
      this._anchor(id, P[id].x, P[id].y, ANCHOR_UP.swap)
      this.swapObjs.push(g)
    }
    // 办公生活区
    const of = makeOfficeBlocks()
    of.scale.setScalar(1.2)
    this._place(of, P["OF-01"].x - 220, P["OF-01"].y - 100, 0)
    // 排土场锚点
    this._anchor("DP-W", P["DP-W"].x + 600, P["DP-W"].y, ANCHOR_UP.dump)
    this._anchor("DP-I", P["DP-I"].x, P["DP-I"].y, ANCHOR_UP.dump)
    // 光伏板场：西排土场顶面
    const pv = P["PV-01"]
    this.solar = makeSolarField(
      this.grid,
      pv.x,
      pv.y,
      11,
      15,
      80,
      60,
      pv.rot,
      VS
    )
    this.scene.add(this.solar)
    this._anchor("PV-01", pv.x, pv.y, ANCHOR_UP.dump)
  }

  _buildPlant() {
    const P = world.positions
    // 电厂：2 座冷却塔 + 2 根烟囱 + 厂房群
    this.steam = []
    for (const id of ["PP-01-T1", "PP-01-T2"]) {
      const t = makeCoolingTower()
      t.scale.setScalar(SC.tower)
      this._place(t, P[id].x, P[id].y, 0)
      const st = makeSteam()
      st.position.set(
        P[id].x,
        this._ground(P[id].x, P[id].y) + 130 * SC.tower,
        -P[id].y
      )
      this.scene.add(st)
      this.steam.push({ pts: st, base: st.position.clone() })
    }
    for (const id of ["PP-01-C1", "PP-01-C2"]) {
      const c = makeChimney()
      c.scale.setScalar(2.2)
      this._place(c, P[id].x, P[id].y, 0)
    }
    const blocks = makePlantBlocks()
    blocks.scale.setScalar(2.2)
    this._place(blocks, P["PP-01"].x, P["PP-01"].y, 0)
    this._anchor("PP-01", P["PP-01-T1"].x, P["PP-01-T1"].y, ANCHOR_UP.plant)
    // 封闭煤场：长轴朝东北
    const cy = P["CY-01"]
    const barn = makeBarn(cy.length * 1.5, cy.width * 1.6)
    this._place(barn, cy.x, cy.y, THREE.MathUtils.degToRad(cy.heading))
    // 长轴默认沿 three 的 z，要让它沿 heading：group 绕 y 转 yawToRotY(heading)，该函数把「前向」对到朝向，长轴就是前向 ✓
    this._anchor("CY-01", cy.x, cy.y, ANCHOR_UP.barn)
  }

  _buildMonitoring() {
    const P = world.positions
    this.radars = []
    for (const id of ["SR-01", "SR-02", "SR-03"]) {
      const t = makeRadarTower()
      t.scale.setScalar(SC.radar)
      this._place(t, P[id].x, P[id].y, 0)
      this._anchor(id, P[id].x, P[id].y, ANCHOR_UP.radar)
      // 扫描环：从塔脚向坑里扩散的地面光环
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.92, 1, 48),
        new THREE.MeshBasicMaterial({
          color: THEME.cyan,
          transparent: true,
          opacity: 0.6,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.set(P[id].x, this._ground(P[id].x, P[id].y) + 20, -P[id].y)
      this.scene.add(ring)
      this.radars.push({ id, tower: t, ring, phase: Math.random() })
    }
    // 5G 基站：绕坑和电厂散布 12 个
    this.masts = []
    const [cx, cy] = world.pit.center
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + 0.2
      const r = 3700 + (k % 3) * 650
      let x = cx + Math.cos(a) * r * 1.15
      let y = cy + Math.sin(a) * r * 0.9
      if (k === 5) [x, y] = [P["PP-01"].x - 500, P["PP-01"].y + 400]
      const m = makeMast()
      m.scale.setScalar(3.2)
      this._place(m, x, y, 0)
      this.masts.push(m)
    }
  }

  _buildSelection() {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending
      })
    )
    ring.rotation.x = -Math.PI / 2
    ring.renderOrder = 20
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(6, 6, 900, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      })
    )
    beam.position.y = 450
    const g = new THREE.Group()
    g.add(ring, beam)
    g.visible = false
    this.scene.add(g)
    this.sel = { group: g, ring, beam }
  }

  // ================================================================ 公开接口

  /**
   * 把仿真状态喂给场景：sim.at(ms) 的返回值；monitors 是 sim.monitors(ms) 的返回值（边坡预警热区和基站灯用，可省略）。
   * 一秒一次即可，场景在两次之间外推卡车位置。
   */
  setState(state, monitors) {
    if (this.state && state.t !== this.state.t) {
      this.prev = this.state
      this.prevById = new Map(this.prev.trucks.map((t) => [t.id, t]))
    }
    this.state = state
    this.plate?.setFaults(
      new Set(state.trucks.filter((t) => t.group === 5).map((t) => t.id))
    )
    this.stateWall = performance.now()
    if (monitors) this.monitors = monitors
  }

  /** 相机飞到某个视角 */
  focus(view, { duration = 1.8 } = {}) {
    if (!world || !THEME.views[view]) return
    // 从底图总览出发：三维相机先定到总览位姿，再飞向目标（底图淡出的同时三维从总览位置飞过去）
    if (this.plate && this.plateK > 0.5 && this.view === "overview")
      this._applyView("overview", false)
    this.view = view
    this._applyView(view, true, duration)
    this.options.onView?.(view)
  }

  /** 选中卡车 / 设备：高亮 + 光柱，null 取消 */
  select(id) {
    this.selected = id
    this.plate?.select(id)
    this.sel.group.visible = !!id
  }

  /** 开关自动导览 */
  setTour(on) {
    this.tourOn = on
    if (on) {
      this.tourI = Math.max(
        0,
        TOUR.findIndex((t) => t.view === this.view)
      )
      this.tourLeft = TOUR[this.tourI].dwell
    }
    this._notifyTour()
  }

  /** 暂停 / 恢复渲染（页面切到后台或打开遮罩时用） */
  setFrozen(on = true) {
    this.frozen = on
  }

  /** 锚点的屏幕位置（画布 CSS 像素）；看不到时 visible 为 false；找不到锚点返回 null */
  project(id) {
    if (this.plate && this.plateK > 0.02) {
      return this.plateK > 0.98 ? this.plate.project(id) : null
    }
    const p = this._anchorPos(id)
    if (!p || !this.camera) return null
    const v = p.clone().project(this.camera)
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    return {
      x: (v.x * 0.5 + 0.5) * w,
      y: (-v.y * 0.5 + 0.5) * h,
      visible:
        v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05
    }
  }

  _anchorPos(id) {
    if (id.startsWith("TK-")) return this.trucks?.positionOf(id) ?? null
    const a = this._anchors.get(id)
    if (!a) return null
    return toV3(a.x, a.y, 0).setY(this._ground(a.x, a.y) + a.up)
  }

  resize() {
    this.plate?.resize()
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    if (!w || !h) return
    const box = this.options.stageBox?.() ?? { x: 0, y: 0, w, h }
    const [dw, dh] = THEME.designSize
    const u = box.w / dw
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    // 设计稿相机的焦距（设计像素）→ 当前舞台缩放下的 CSS 像素
    const focal = dh / 2 / Math.tan((THEME.fov * Math.PI) / 360)
    const cam = this.camera
    cam.aspect = w / h
    cam.fov = (2 * Math.atan(h / 2 / (focal * u)) * 180) / Math.PI
    cam.setViewOffset(
      w,
      h,
      w / 2 - box.x - (dw / 2) * u,
      h / 2 - box.y - (dh / 2) * u,
      w,
      h
    )
    cam.updateProjectionMatrix()
  }

  dispose() {
    cancelAnimationFrame(this._raf)
    this.plate?.dispose()
    this.canvas.removeEventListener("pointerdown", this._pd)
    this.canvas.removeEventListener("pointerup", this._pu)
    this.controls?.dispose()
    this.composer?.dispose()
    this.renderer?.dispose()
    this.scene?.traverse((o) => {
      o.geometry?.dispose?.()
      const m = o.material
      if (Array.isArray(m)) m.forEach((x) => x.dispose?.())
      else m?.dispose?.()
    })
  }

  // ================================================================ 相机与导览

  _viewPose(view) {
    const v = THEME.views[view]
    const [tx, ty] = v.target
    const target = new THREE.Vector3(tx, this._ground(tx, ty) * 0.5, -ty)
    const pitch = THREE.MathUtils.degToRad(v.pitch)
    const yaw = THREE.MathUtils.degToRad(v.yaw)
    // 相机在目标正南（z 正方向）偏 yaw
    const off = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch)
    ).multiplyScalar(v.dist)
    return { target, position: target.clone().add(off) }
  }

  _applyView(view, animate, duration = 1.8) {
    const pose = this._viewPose(view)
    if (!animate) {
      this.camera.position.copy(pose.position)
      this.controls.target.copy(pose.target)
      this.camera.lookAt(pose.target)
      this.controls.update()
      return
    }
    this._tween = {
      t: 0,
      dur: duration,
      p0: this.camera.position.clone(),
      p1: pose.position,
      t0: this.controls.target.clone(),
      t1: pose.target
    }
  }

  _interaction() {
    this._tween = null
    this.options.onInteract?.()
  }

  _notifyTour() {
    const next = TOUR[(this.tourI + 1) % TOUR.length].view
    this.options.onTour?.({
      view: TOUR[this.tourI].view,
      next,
      left: Math.ceil(this.tourLeft),
      on: this.tourOn
    })
  }

  // ================================================================ 点选

  _bindPointer() {
    let down = null
    this._pd = (e) =>
      (down = { x: e.clientX, y: e.clientY, t: performance.now() })
    this._pu = (e) => {
      if (!down) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      const dt = performance.now() - down.t
      down = null
      if (moved > 5 || dt > 450) return
      const id = this._pick(e.clientX, e.clientY)
      this.options.onSelect?.(id)
    }
    this.canvas.addEventListener("pointerdown", this._pd)
    this.canvas.addEventListener("pointerup", this._pu)
  }

  /** 点选：先看卡车（实例），再看设备锚点（屏幕距离最近且在 40 px 内） */
  _pick(cx, cy) {
    if (this.plate && this.plateK > 0.5) return this.plate.pick(cx, cy)
    const rect = this.canvas.getBoundingClientRect()
    const mx = cx - rect.left
    const my = cy - rect.top
    let best = null
    let bd = 34
    const consider = (id) => {
      const p = this.project(id)
      if (!p || !p.visible) return
      const d = Math.hypot(p.x - mx, p.y - my)
      if (d < bd) {
        bd = d
        best = id
      }
    }
    if (this.trucks) for (const t of this.trucks.list) consider(t.id)
    for (const id of this._anchors.keys()) {
      if (id.startsWith("BC") || id.startsWith("DP") || id === "PV-01") continue
      consider(id)
    }
    return best
  }

  // ================================================================ 帧循环

  _loop = () => {
    this._raf = requestAnimationFrame(this._loop)
    if (this.frozen || !this.renderer) return
    const now = performance.now()
    const dt = Math.min((now - this._last) / 1000, 0.1)
    this._last = now
    this.time += dt
    this._update(dt)
    this.controls.update()
    if (this.plateK < 0.999) this.composer.render()
  }

  _update(dt) {
    const t = this.time
    this.terrain.material.uniforms.uTime.value = t
    for (const r of this.roadMeshes) r.material.uniforms.uTime.value = t

    // 相机补间
    const tw = this._tween
    if (tw) {
      tw.t = Math.min(1, tw.t + dt / tw.dur)
      const k = ease(tw.t)
      this.camera.position.lerpVectors(tw.p0, tw.p1, k)
      this.controls.target.lerpVectors(tw.t0, tw.t1, k)
      if (tw.t >= 1) this._tween = null
    }

    // 总览底图：目标视角是总览且相机补间结束 → 淡入底图；否则淡出，露出三维
    if (this.plate) {
      const want = this.view === "overview" && !this._tween ? 1 : 0
      const step = dt / (want ? 0.7 : 0.5)
      this.plateK += clamp01(want - this.plateK, -step, step)
      this.canvas.style.opacity = String(1 - this.plateK)
      this.controls.enabled = this.plateK < 0.5
      if (this.plateK > 0.001)
        this.plate.draw(t, {
          state: this.state,
          prev: this.prev,
          prevById: this.prevById,
          stateWall: this.stateWall,
          monitors: this.monitors
        })
    }

    // 导览
    if (this.tourOn && !this._tween) {
      this.tourLeft -= dt
      if (Math.ceil(this.tourLeft) !== this._tourSec) {
        this._tourSec = Math.ceil(this.tourLeft)
        this._notifyTour()
      }
      if (this.tourLeft <= 0) {
        this.tourI = (this.tourI + 1) % TOUR.length
        this.tourLeft = TOUR[this.tourI].dwell
        this.view = TOUR[this.tourI].view
        this._applyView(this.view, true, 2.2)
        this.options.onView?.(this.view)
        this._notifyTour()
      }
    }

    const st = this.state
    if (st) {
      this.trucks.update(
        st,
        this.prev,
        this.prevById,
        (performance.now() - this.stateWall) / 1000,
        this.selected
      )
      // 电铲：装车时摆臂，其余缓慢待机
      for (const s of this.shovelObjs) {
        const sh = st.shovels.find((x) => x.id === s.id)
        const working = sh && SHOVEL_STATE[sh.state] === "装车中"
        const sw = working
          ? Math.sin(t * 1.6 + s.phase) * 0.12
          : Math.sin(t * 0.3 + s.phase) * 0.02
        s.boom.rotation.x = -0.78 + sw
        s.stick.rotation.x = 0.78 - sw * 0.6
        s.pool.material.opacity = working ? 0.55 : 0.12
      }
      // 换电站工位灯：在换的亮
      this.swapObjs.forEach((g, i) => {
        const busy = st.stations[i]?.busy ?? 0
        g.userData.bays.forEach(
          (m, k) => (m.material.emissiveIntensity = k < busy ? 1.8 : 0.18)
        )
      })
    }
    this.bw.wheel.rotation.x += dt * 0.6

    // 雷达扫描环：从塔脚向坑里扩散；预警的雷达变橙、加快
    const warn = this._warnSector()
    for (const r of this.radars) {
      const hot = warn && warn.id === r.id
      r.phase = (r.phase + dt * (hot ? 0.55 : 0.2)) % 1
      const rad = 70 + r.phase * 520
      r.ring.scale.set(rad, rad, 1)
      r.ring.material.opacity = (1 - r.phase) * (hot ? 0.9 : 0.4)
      r.ring.material.color.setHex(hot ? THEME.warn : THEME.cyan)
      r.tower.userData.beacon.material.emissive.setHex(
        hot ? THEME.warn : THEME.cyan
      )
    }
    const u = this.terrain.material.uniforms
    if (warn) {
      u.uWarn.value.set(warn.x, -warn.y, 850)
      u.uWarnK.value = THREE.MathUtils.lerp(u.uWarnK.value, 1, 0.08)
    } else u.uWarnK.value = THREE.MathUtils.lerp(u.uWarnK.value, 0, 0.08)

    // 基站灯：离线的变灰
    if (this.monitors) {
      this.monitors.bs.forEach((b, i) => {
        const m = this.masts[i]
        if (m)
          m.userData.lamp.material.emissive.setHex(
            b.online ? THEME.ok : THEME.offline
          )
      })
    }

    // 蒸汽
    for (const s of this.steam) {
      const pos = s.pts.geometry.attributes.position
      const seed = s.pts.geometry.attributes.seed
      for (let i = 0; i < pos.count; i++) {
        const k = (t * 0.045 + seed.getX(i)) % 1
        pos.setXYZ(
          i,
          s.base.x + Math.sin(seed.getX(i) * 40 + t * 0.4) * 30 * k,
          s.base.y + k * 520,
          s.base.z + Math.cos(seed.getX(i) * 31) * 30 * k
        )
      }
      pos.needsUpdate = true
      s.pts.material.opacity = 0.5
    }

    // 选中：光环 + 光柱跟随
    if (this.selected) {
      const p = this._anchorPos(this.selected)
      if (p) {
        const g = this.sel.group
        const base = p.clone()
        base.y = this._ground(p.x, -p.z) + 6
        g.position.copy(base)
        const s = this.selected.startsWith("TK-") ? 150 : 260
        this.sel.ring.scale.set(
          s * (1 + 0.1 * Math.sin(t * 4)),
          s * (1 + 0.1 * Math.sin(t * 4)),
          1
        )
        const bad = this.selected === "TK-037" || this._isFault(this.selected)
        this.sel.ring.material.color.setHex(bad ? THEME.fault : THEME.cyan)
        this.sel.beam.material.color.setHex(bad ? THEME.fault : THEME.cyan)
        g.visible = true
      } else this.sel.group.visible = false
    }
  }

  _isFault(id) {
    const t = this.state?.trucks.find((x) => x.id === id)
    return t?.group === 5
  }

  /** 当前最严重的边坡预警：{ id, x, y }，热区中心在雷达前方（朝坑中心）约 450 m；没有预警返回 null */
  _warnSector() {
    if (!this.monitors) return null
    const bad = this.monitors.radar
      .filter((r) => r.level >= 2)
      .sort((a, b) => b.level - a.level)[0]
    if (!bad) return null
    const p = world.positions[bad.id]
    const [cx, cy] = world.pit.center
    const d = Math.hypot(cx - p.x, cy - p.y) || 1
    return {
      id: bad.id,
      x: p.x + ((cx - p.x) / d) * 450,
      y: p.y + ((cy - p.y) / d) * 450
    }
  }
}

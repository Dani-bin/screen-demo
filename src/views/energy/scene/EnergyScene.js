/*
 * 综合能源补给站 三维场景
 * ----------------------------------------------------------
 * 加载 Blender 导出的 public/energy/station.glb（场站）与 vehicles.glb（车辆预制），
 * 用仿真器（sim/simulator.js）驱动：
 *   - 重卡超充位：描边与桩灯颜色、桩顶图标、电动重卡进出（倒车入位）、充电线、降功率告警波纹；
 *   - 补给车次：加油 / CNG 小车进罩棚停车加油、换电小车穿过换电站、LNG 重卡加气、LNG 槽车卸车；
 *   - 门前国道车流、停车场常驻车辆；罩棚 / 车棚 / 路灯的地面光斑，沙盘下方光晕；
 *   - 开场「现状航拍 → 规划」动画（intro.js），可随时重播。
 *
 * 不依赖 Vue。生命周期：new EnergyScene(opts) → await load() → playIntro() → dispose()
 * 回调：
 *   onPick({ id, x, y } | null)   点击超充位 / 终端（x、y 为设计稿坐标，供浮窗定位）
 *   onAnchors({ fuel, swap, ... })  各设施标签锚点的设计稿坐标（每帧）
 *   onIntro(playing)               开场动画开始 / 结束（页面据此隐藏 / 显示面板）
 */
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js"
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js"

import {
  CAR_PAINTS,
  PARKED_PAINTS,
  TRAILER_PAINTS,
  STATUS_COLOR,
  STATUS_INTENSITY,
  THEME,
  TRUCK_PAINTS
} from "./theme"
import { badgeTexture, disposeTextures, glowTexture } from "./sprites"
import { Trip, Vehicle, makeCurve, nearestS, rigOf } from "./vehicles"
import { PlanIntro } from "./intro"
import {
  WetStreaks,
  contactShadow,
  disposeEffects,
  outlineStrip,
  vehicleLights
} from "./effects"
import OUTLINE from "../data/outline.json"
import {
  CNG_LANES,
  FUEL_LANES,
  LANE,
  LNG_LANES,
  P,
  PARKED,
  FUEL_ISLAND_U,
  ROAD_U,
  carFuelRoute,
  carSwapRoute,
  tankerRoute,
  truckChargeIn,
  truckChargeOut,
  truckChargePort,
  truckLngRoute
} from "../data/paths"
import { PILE_IDS } from "../data/station"

const DEG = Math.PI / 180
/** 设计稿宽度：页面用 rem 等比缩放，场景里也按 实际宽 / 1920 换算 */
const DESIGN_W = 1920
/** 标签锚点（Blender 里的 anchor_<key> 空对象） */
const ANCHORS = [
  "fuel",
  "swap",
  "office",
  "lng",
  "charge",
  "power",
  "tank",
  "cng"
]
/** 门前国道上同时存在的车流上限（不含进出站车辆） */
const TRAFFIC_MAX = 18
/** 补给停车时长（秒）：加油、CNG、换电、LNG */
const STOP_WAIT = { fuel: 16, cng: 14, swap: 18, lng: 22 }

export class EnergyScene {
  constructor({ canvas, container, sim, baseUrl, onPick, onAnchors, onIntro }) {
    this.canvas = canvas
    this.container = container
    this.sim = sim
    this.baseUrl = baseUrl
    this.onPick = onPick || (() => {})
    this.onAnchors = onAnchors || (() => {})
    this.onIntro = onIntro || (() => {})
    this.disposed = false
    this.trips = new Set()
    this.lanes = new Map() // 车道占用：key → Trip
    this.rand = Math.random

    // ---------- 渲染器
    const r = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance"
    })
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    // Neutral 色调映射：灯带颜色在辉光里保持色相（ACES 会把高亮褪成白色）
    r.toneMapping = THREE.NeutralToneMapping
    r.toneMappingExposure = 1.0
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFShadowMap
    this.renderer = r

    // ---------- 场景、环境光
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(THEME.background)
    // 远山与村庄按到镜头的距离隐入夜色（正交相机下按视线方向的深度计算）
    scene.fog = new THREE.Fog(THEME.fog.color, THEME.fog.near, THEME.fog.far)
    const pmrem = new THREE.PMREMGenerator(r)
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    scene.environment = this.envMap
    scene.environmentIntensity = 0.3
    this.scene = scene

    // 地面是烘焙贴图（不受实时光照），环境光只照设备、建筑与车辆：压低一些，让罩棚下的面光与灯带成为主光
    scene.add(new THREE.HemisphereLight(0x9fbcf0, 0x141b26, 0.75))
    // 月光：从场地西北上方打下来（场地西侧是山林），覆盖整个沙盘的阴影范围
    const sun = new THREE.DirectionalLight(0xd6e4ff, 1.0)
    sun.position.set(60, 110, -90)
    sun.castShadow = true
    sun.shadow.mapSize.set(4096, 4096)
    Object.assign(sun.shadow.camera, {
      left: -170,
      right: 170,
      top: 120,
      bottom: -120,
      near: 1,
      far: 400
    })
    sun.shadow.bias = -0.0005
    sun.shadow.normalBias = 0.05
    sun.shadow.camera.updateProjectionMatrix()
    scene.add(sun)
    const fill = new THREE.DirectionalLight(0x5f86ff, 0.3)
    fill.position.set(-80, 50, 90)
    scene.add(fill)
    this.sun = sun

    // ---------- 正交相机 + 控制器（场站中心在 load 后按模型包围盒确定）
    this.center = new THREE.Vector3()
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2000)
    this.controls = new OrbitControls(this.camera, canvas)
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.08,
      rotateSpeed: 0.5,
      minPolarAngle: 20 * DEG,
      maxPolarAngle: 72 * DEG,
      minZoom: 0.7,
      maxZoom: 5,
      screenSpacePanning: true
    })
    this.homeSpherical = new THREE.Spherical(
      500,
      (90 - THEME.camera.elevation) * DEG,
      this._azimuthToTheta(THEME.camera.azimuth)
    )
    this.lastInteract = -1e9
    this.controls.addEventListener(
      "start",
      () => (this.lastInteract = performance.now())
    )
    this.controls.addEventListener(
      "end",
      () => (this.lastInteract = performance.now())
    )

    // ---------- 后处理：辉光（离屏渲染目标开 4 倍 MSAA，后处理下边缘不发虚）
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

    // ---------- 交互：点击拾取超充位 / 终端
    this.raycaster = new THREE.Raycaster()
    this._downAt = null
    this._onDown = (e) => (this._downAt = [e.clientX, e.clientY])
    this._onUp = (e) => this._pick(e)
    canvas.addEventListener("pointerdown", this._onDown)
    canvas.addEventListener("pointerup", this._onUp)

    this._onResize = () => this._resize()
    this.resizeObserver = new ResizeObserver(this._onResize)
    this.resizeObserver.observe(container)

    this.timer = new THREE.Timer()
    // 开发环境挂到 window 上，便于在控制台排查（生产构建不暴露）
    if (import.meta.env.DEV) window.__energyScene = this
    this._loop = this._loop.bind(this)
  }

  // ================================================================ 加载

  async load() {
    const loader = new GLTFLoader()
    const tl = new THREE.TextureLoader()
    const [station, vehicles, aerialTex, groundBake] = await Promise.all([
      loader.loadAsync(`${this.baseUrl}energy/station.glb`),
      loader.loadAsync(`${this.baseUrl}energy/vehicles.glb`),
      tl.loadAsync(`${this.baseUrl}energy/site.webp`),
      tl.loadAsync(`${this.baseUrl}energy/ground_bake.webp`)
    ])
    if (this.disposed) return
    aerialTex.colorSpace = THREE.SRGBColorSpace
    this.aerialTex = aerialTex
    this.station = station.scene
    this.scene.add(this.station)
    this._prepareMaterials()
    this._applyGroundBake(groundBake)
    this._canopyLights()
    this._collect()
    this._instancify()
    this._prepareVehicles(vehicles.scene)

    // 场站中心：按沙盘外轮廓（outline.json）确定——模型包围盒还含着后方远山，会把中心拉离场站，
    // 开场俯视镜头就会偏到航拍底图外面去
    this.box = new THREE.Box3().setFromPoints(
      OUTLINE.outline.map(([x, , z]) => new THREE.Vector3(x, 0, z))
    )
    this.box.max.y = 12
    this.box.getCenter(this.center)
    this.center.y = 0
    this.controls.target.copy(this.center)
    this._placeCamera(this.homeSpherical)
    this._resize()

    this._buildDecor()
    this._initBays()
    this._parkCars()
    this.frameId = requestAnimationFrame(this._loop)
  }

  /** 材质：自发光强度整体压低（材质被许多网格共享，每份只处理一次）、阴影、各向异性 */
  _prepareMaterials() {
    const seen = new Set()
    const aniso = this.renderer.capabilities.getMaxAnisotropy()
    this.station.traverse((o) => {
      if (!o.isMesh) return
      const m = o.material
      const emissive =
        m.emissive && m.emissiveIntensity > 0 && m.emissive.getHex() !== 0
      if (!seen.has(m)) {
        seen.add(m)
        if (emissive)
          m.emissiveIntensity *=
            m.name === "M_led_edge"
              ? THEME.glow.edge / 5
              : THEME.glow.emissiveScale
        for (const v of Object.values(m))
          if (v && v.isTexture) v.anisotropy = aniso
        if (m.transparent) m.depthWrite = false
      }
      o.castShadow = !emissive && !m.transparent
      o.receiveShadow = true
    })
    // 设计稿里最亮的几样发光件（棚底灯面、罩棚彩色檐口、车棚灯带）单独给绝对强度，保证在辉光里清楚地亮起来
    for (const m of seen) {
      const v = THEME.glow.override[m.name]
      if (v !== undefined) m.emissiveIntensity = v
      if (THEME.noFog.includes(m.name)) m.fog = false
      if (m.name === "M_pv") {
        m.emissive.setHex(THEME.pvSheen[0])
        m.emissiveIntensity = THEME.pvSheen[1]
      }
    }
  }

  /**
   * 地面换成 Cycles 烘焙贴图（scripts/blender/energy/bake.py，走第二套 UV：channel 1）：
   * 罩棚下的亮白站坪、路灯光斑、树下投光、软阴影都已「画」在贴图里。用黑色基色 + 贴图作自发光，
   * 再给一点低粗糙度的环境反射，做出设计稿里湿润路面的光泽；灯光倒影由 WetStreaks 叠加
   */
  _applyGroundBake(tex) {
    tex.flipY = false // 与 glTF 的 UV 原点约定一致
    tex.colorSpace = THREE.SRGBColorSpace
    tex.channel = 1
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    this.groundBake = tex
    this.groundMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: tex,
      emissiveIntensity: THEME.ground.intensity,
      roughness: THEME.ground.roughness,
      metalness: 0,
      envMapIntensity: THEME.ground.env
    })
    this.station.getObjectByName("ground")?.traverse((o) => {
      if (!o.isMesh) return
      o.material = this.groundMat
      o.receiveShadow = false
      o.castShadow = false
    })
  }

  /**
   * 罩棚 / 车棚下的实时面光（RectAreaLight）：照亮棚下的加油机、立柱和车辆（地面已在烘焙里亮了）
   */
  _canopyLights() {
    RectAreaLightUniformsLib.init()
    this.areaLights = []
    for (const [name, intensity] of THEME.canopyLights) {
      const o = this.station.getObjectByName(name)
      if (!o) continue
      const b = new THREE.Box3().setFromObject(o)
      const c = b.getCenter(new THREE.Vector3())
      const sz = b.getSize(new THREE.Vector3())
      // 设计稿里罩棚下是暖白光
      const li = new THREE.RectAreaLight(0xffd2a8, intensity, sz.x, sz.z)
      li.position.set(c.x, b.min.y - 0.1, c.z)
      li.lookAt(c.x, 0, c.z)
      this.scene.add(li)
      this.areaLights.push(li)
    }
  }

  /** 按命名约定收集需要驱动的对象：超充终端、超充位、标签锚点、灯具位置 */
  _collect() {
    const s = this.station
    this.piles = new Map() // id → { root, status, pos, top, badge }
    this.bays = new Map() // id → { mesh, center, trip, cable, alarm }
    for (const id of PILE_IDS) {
      const root = s.getObjectByName(`pile_${id}`)
      if (!root) continue
      const status = s.getObjectByName(`pile_${id}_status`)
      // 每台终端的状态灯材质独立一份，才能各自变色
      status?.traverse((o) => {
        if (o.isMesh) o.material = o.material.clone()
      })
      const pos = root.getWorldPosition(new THREE.Vector3())
      const top = new THREE.Box3().setFromObject(root).max.y
      this.piles.set(id, { root, status, pos, top })
      const mesh = s.getObjectByName(`bay_${id}`)
      if (mesh) {
        mesh.traverse((o) => {
          if (o.isMesh) o.material = o.material.clone()
        })
        const center = new THREE.Box3()
          .setFromObject(mesh)
          .getCenter(new THREE.Vector3())
        center.y = 0
        this.bays.set(id, {
          mesh,
          center,
          trip: null,
          cable: null,
          alarm: null,
          pile: this.piles.get(id)
        })
      }
    }
    this.anchorPoints = {}
    for (const k of ANCHORS) {
      const o = s.getObjectByName(`anchor_${k}`)
      if (o) this.anchorPoints[k] = o.getWorldPosition(new THREE.Vector3())
    }
    // 路灯灯头位置（湿路面倒影用）：单臂灯头在立杆 +x 方向 1.2 m、高 6.8 m；隔离带双臂灯两个灯头在局部 ±z 2.2 m、高 9.8 m
    this.lampPoints = []
    s.traverse((o) => {
      if (!/^lamp_/.test(o.name)) return
      const q = o.getWorldQuaternion(new THREE.Quaternion())
      const base = o.getWorldPosition(new THREE.Vector3())
      const heads = /^lamp_mid/.test(o.name)
        ? [new THREE.Vector3(0, 9.8, 2.2), new THREE.Vector3(0, 9.8, -2.2)]
        : [new THREE.Vector3(1.2, 6.8, 0)]
      for (const h of heads)
        this.lampPoints.push(base.clone().add(h.applyQuaternion(q)))
    })
    // 门前国道各车道被沙盘截断后的实际范围（Blender 生成的 outline.json）→ 车辆出现 / 消失的位置；
    // 进出站的车都走南行近侧车道
    this.laneSpan = OUTLINE.lanes || {}
    this.roadU = this.laneSpan.sNear?.slice(1) || ROAD_U
  }

  /**
   * 重复件合并成 InstancedMesh：山林、行道树、灌木、路灯各几十上百棵，逐个绘制会有上千次 draw call。
   * 只合并顶层名字匹配的装饰件；超充终端、加油机等要按名字驱动的对象保持独立
   */
  _instancify() {
    const groups = new Map() // geometry.uuid + material.uuid → { geo, mat, matrices }
    const remove = []
    this.station.updateMatrixWorld(true)
    for (const top of this.station.children) {
      if (!/^(forest_|tree_|hedge_|lamp_|house_|rock_)/.test(top.name)) continue
      top.traverse((o) => {
        if (!o.isMesh) return
        const key = o.geometry.uuid + o.material.uuid
        if (!groups.has(key))
          groups.set(key, { geo: o.geometry, mat: o.material, matrices: [] })
        groups.get(key).matrices.push(o.matrixWorld.clone())
      })
      remove.push(top)
    }
    for (const o of remove) this.station.remove(o)
    // 合并后的实例按类别挂到 4 个分组下，开场动画按组「长出来」
    const holders = {}
    for (const { geo, mat, matrices } of groups.values()) {
      const im = new THREE.InstancedMesh(geo, mat, matrices.length)
      matrices.forEach((m, i) => im.setMatrixAt(i, m))
      im.castShadow = true
      im.receiveShadow = true
      im.computeBoundingSphere()
      const cat =
        mat.name === "M_light_warm" || mat.name === "M_steel"
          ? "lamps"
          : "green"
      if (!holders[cat]) {
        holders[cat] = new THREE.Group()
        holders[cat].name = `inst_${cat}`
        this.station.add(holders[cat])
      }
      holders[cat].add(im)
    }
  }

  /** 车辆预制：按名字取出，车漆材质按颜色各克隆一份（所有同色车共享） */
  _prepareVehicles(root) {
    this.prefabs = {}
    for (const name of [
      "car_sedan",
      "car_suv",
      "truck_tractor",
      "truck_tractor_b",
      "trailer_box",
      "trailer_tank"
    ]) {
      const o = root.getObjectByName(name)
      if (!o) continue
      o.position.set(0, 0, 0)
      o.rotation.set(0, 0, 0)
      o.traverse((m) => {
        if (m.isMesh) m.castShadow = true
      })
      this.prefabs[name] = o
    }
    this.paints = new Map() // "car-0xffffff" → material
    this.vehicleGroup = new THREE.Group()
    this.scene.add(this.vehicleGroup)
  }

  _paint(base, color) {
    const key = `${base.name}-${color}`
    if (!this.paints.has(key)) {
      const m = base.clone()
      m.color.setHex(color)
      this.paints.set(key, m)
    }
    return this.paints.get(key)
  }

  /**
   * 克隆一辆车：car / tractor / semi_box / semi_tank；牵引车在 MAN / 奔驰两款里随机。
   * paints：小车车漆调色板（停车场用偏素的颜色）
   */
  _vehicle(type, lit = true, paints = CAR_PAINTS) {
    const pick = (list) => list[Math.floor(this.rand() * list.length)]
    const clone = (name, paintName, palette) => {
      const src = this.prefabs[name]
      const o = src.clone()
      const color = pick(palette)
      o.traverse((m) => {
        if (m.isMesh && m.material.name === paintName)
          m.material = this._paint(m.material, color)
      })
      this.vehicleGroup.add(o)
      return o
    }
    if (type === "car") {
      const name = this.rand() < 0.6 ? "car_sedan" : "car_suv"
      const o = clone(name, "M_car_paint", paints)
      this._dress(o, name, { head: lit, tail: lit })
      return new Vehicle("car", [o], [rigOf(o, "car")])
    }
    const tractors = ["truck_tractor", "truck_tractor_b"].filter(
      (n) => this.prefabs[n]
    )
    const cabName = pick(tractors)
    const cab = clone(cabName, "M_truck_paint", TRUCK_PAINTS)
    const cabRig = rigOf(cab, "tractor")
    this._dress(cab, cabName, {
      head: lit,
      tail: type === "tractor",
      truck: true
    })
    if (type === "tractor") return new Vehicle("tractor", [cab], [cabRig])
    const trailerName = type === "semi_tank" ? "trailer_tank" : "trailer_box"
    const trailer = clone(trailerName, "M_truck_paint", TRAILER_PAINTS)
    this._dress(trailer, trailerName, { tail: true, truck: true })
    return new Vehicle(
      "semi",
      [cab, trailer],
      [cabRig, rigOf(trailer, "trailer")]
    )
  }

  /** 车辆部件挂上车灯与车底接触阴影（包围盒按预制缓存） */
  _dress(part, name, opts) {
    if (!this.prefabBox) this.prefabBox = {}
    const box = (this.prefabBox[name] ||= new THREE.Box3().setFromObject(
      this.prefabs[name]
    ))
    vehicleLights(part, box, opts)
    const shadow = contactShadow(box.max.x - box.min.x, box.max.z - box.min.z)
    shadow.position.x = (box.max.x + box.min.x) / 2
    part.add(shadow)
  }

  _removeVehicle(v) {
    for (const p of v.parts) this.vehicleGroup.remove(p)
  }

  // ================================================================ 路线与行程

  /**
   * 路线关键点 → 行程的一段：[u, v, flag] 换算成 three 坐标连成曲线；
   * "START" / "END" 换成道路两端；flag 为 stop（停 wait 秒）或 hold（停到放行）
   */
  _leg(list, wait = 0, opts = {}) {
    const [u0, u1] = this.roadU
    const pts = list.map(([u, v]) =>
      P(u === "START" ? u0 : u === "END" ? u1 : u, v)
    )
    const curve = makeCurve(pts)
    const stops = []
    list.forEach(([, , flag], i) => {
      if (flag === "stop" || flag === "hold")
        stops.push({ s: nearestS(curve, pts[i]), wait, hold: flag === "hold" })
    })
    return { curve, stops, ...opts }
  }

  _startTrip(vehicle, legs, opts = {}) {
    const trip = new Trip(vehicle, legs, {
      ...opts,
      onDone: (t) => {
        this._removeVehicle(t.v)
        this.trips.delete(t)
        opts.onDone?.(t)
      }
    })
    this.trips.add(trip)
    return trip
  }

  /** 仿真器发起的补给车次；车道占满时返回 false（仿真器据此不计数） */
  handleTrip({ kind }) {
    if (!this.station || this.introPlaying) return false
    const free = (lanes) =>
      lanes.filter(
        (l) => !this.lanes.has(`${kind === "lng" ? "lng" : "car"}-${l}`)
      )
    if (kind === "fuel" || kind === "cng") {
      const lanes = free(kind === "fuel" ? [...FUEL_LANES, 27.5] : CNG_LANES)
      if (!lanes.length) return false
      const lane = lanes[Math.floor(this.rand() * lanes.length)]
      const key = `car-${lane}`
      // 停在哪个岛：CNG 只在后排东侧两岛；加油在前排三岛，走最北车道时用后排西岛
      const isl =
        kind === "cng"
          ? FUEL_ISLAND_U.slice(0, 2)
          : lane > 25
            ? FUEL_ISLAND_U.slice(2)
            : FUEL_ISLAND_U
      const stopU = isl[Math.floor(this.rand() * isl.length)] + 3.8
      const trip = this._startTrip(
        this._vehicle("car"),
        [this._leg(carFuelRoute(lane, stopU), STOP_WAIT[kind])],
        {
          onDone: () => this.lanes.delete(key)
        }
      )
      this.lanes.set(key, trip)
      return true
    }
    if (kind === "swap") {
      if (this.lanes.has("swap")) return false
      const trip = this._startTrip(
        this._vehicle("car"),
        [this._leg(carSwapRoute(), STOP_WAIT.swap)],
        {
          onDone: () => this.lanes.delete("swap")
        }
      )
      this.lanes.set("swap", trip)
      return true
    }
    if (kind === "lng") {
      const lanes = free(LNG_LANES)
      if (!lanes.length) return false
      const lane = lanes[Math.floor(this.rand() * lanes.length)]
      const key = `lng-${lane}`
      const trip = this._startTrip(
        this._vehicle("semi_box"),
        [this._leg(truckLngRoute(lane), STOP_WAIT.lng)],
        {
          onDone: () => this.lanes.delete(key)
        }
      )
      this.lanes.set(key, trip)
      return true
    }
    if (kind === "tanker") {
      if (this.tanker) return false
      this.tanker = this._startTrip(
        this._vehicle("semi_tank"),
        [this._leg(tankerRoute())],
        {
          onDone: () => (this.tanker = null)
        }
      )
      return true
    }
    if (kind === "tankerDone") {
      this.tanker?.release()
      return true
    }
    return false
  }

  /** 门前国道车流：六条车道各自按随机间隔发车，小车居多 */
  _traffic(dt) {
    if (!this.trafficTimers)
      this.trafficTimers = {
        sNear: 2,
        sMid: 4,
        sFar: 6,
        nNear: 1,
        nMid: 3,
        nFar: 5
      }
    for (const lane of Object.keys(this.trafficTimers)) {
      this.trafficTimers[lane] -= dt
      if (this.trafficTimers[lane] > 0) continue
      this.trafficTimers[lane] = 5 + this.rand() * 10
      const road = [...this.trips].filter((t) => t.road).length
      if (road >= TRAFFIC_MAX) continue
      const [u0, u1] = this.laneSpan[lane]?.slice(1) || this.roadU
      const south = lane[0] === "s"
      const v = LANE[lane]
      const list = south
        ? [
            [u0, v],
            [(u0 + u1) / 2, v],
            [u1, v]
          ]
        : [
            [u1, v],
            [(u0 + u1) / 2, v],
            [u0, v]
          ]
      const type =
        this.rand() < 0.68
          ? "car"
          : this.rand() < 0.75
            ? "semi_box"
            : "semi_tank"
      const trip = this._startTrip(this._vehicle(type), [this._leg(list)])
      trip.road = true
      // 国道上直接以巡航速度出现
      trip.v.speed = THEME.drive.road
    }
  }

  /** 停车场常驻车辆（员工车位车头朝办公楼、私家车位车头朝路） */
  _parkCars() {
    for (const [u, v, dir] of PARKED) {
      const veh = this._vehicle("car", false, PARKED_PAINTS)
      const c = makeCurve([P(u, v - 3 * dir), P(u, v + 1.5 * dir)])
      veh.place(c, c.len)
    }
  }

  // ================================================================ 超充位状态

  _initBays() {
    for (const b of this.sim.bays) this.updateBay(b, true)
  }

  /** 某个超充位状态变化：描边、桩灯与图标、牵引车进出、充电线、降功率告警 */
  updateBay(b, instant = false) {
    const bay = this.bays.get(b.id)
    if (!bay) return
    const st = b.status
    this._tint(bay.mesh, st)
    const pile = bay.pile
    pile.status?.traverse(
      (o) =>
        o.isMesh &&
        this._tint(o, st === "arriving" || st === "leaving" ? "idle" : st)
    )
    if (pile.badge) {
      pile.badge.material.map = badgeTexture(
        STATUS_COLOR[st] ?? STATUS_COLOR.idle,
        st === "fault" ? "warn" : "bolt"
      )
      pile.badge.material.needsUpdate = true
    }
    const i = PILE_IDS.indexOf(b.id)
    // 进站：从国道驶入，沿车位前通道开过车位后倒车入位（挂车领先拐进车位）；开局已在充的直接摆在车位里（倒车段末尾）
    if (
      (st === "arriving" ||
        ((st === "charging" || st === "fault") && instant)) &&
      !bay.trip
    ) {
      const route = truckChargeIn(i)
      const legs = [
        this._leg(route.forward),
        this._leg(route.reverse, 0, { reverse: true, hold: true }),
        this._leg(truckChargeOut(i))
      ]
      const settled = st !== "arriving"
      bay.trip = this._startTrip(this._vehicle("semi_box"), legs, {
        fadeIn: !settled,
        startLeg: settled ? 1 : 0,
        startS: settled ? legs[1].curve.len : 0,
        onDone: (t) => {
          if (bay.trip === t) bay.trip = null
        }
      })
    }
    if (st === "leaving" && bay.trip) {
      bay.trip.release()
      bay.trip = null
    }
    // 充电线：充电中 / 降功率时显示
    const plugged = st === "charging" || st === "fault"
    if (plugged && !bay.cable) bay.cable = this._cable(bay, i)
    if (!plugged && bay.cable) {
      this.vehicleGroup.remove(bay.cable)
      bay.cable.geometry.dispose()
      bay.cable = null
    }
    if (st === "fault" && !bay.alarm) bay.alarm = this._alarm(bay.center)
    if (st !== "fault" && bay.alarm) {
      this.vehicleGroup.remove(bay.alarm)
      this.alarms.delete(bay.alarm)
      bay.alarm = null
    }
  }

  _tint(obj, status) {
    const c = STATUS_COLOR[status] ?? STATUS_COLOR.idle
    obj.traverse((o) => {
      if (!o.isMesh) return
      o.material.color.setHex(c)
      if (o.material.emissive) {
        o.material.emissive.setHex(c)
        o.material.emissiveIntensity = STATUS_INTENSITY
      }
    })
  }

  /** 充电线：终端枪座 → 倒车入位后驾驶室后方的充电口（车身侧面），下垂曲线，发光 */
  _cable(bay, i) {
    const p = bay.pile.pos
    const [hx, hz] = P(...truckChargePort(i))
    const dir = new THREE.Vector3(p.x - hx, 0, p.z - hz).normalize()
    const side = new THREE.Vector3(-dir.z, 0, dir.x)
    const start = new THREE.Vector3(p.x, 1.0, p.z)
      .addScaledVector(dir, -0.5)
      .addScaledVector(side, 0.4)
    const end = new THREE.Vector3(hx, 1.2, hz).addScaledVector(side, 1.3)
    const mid = start.clone().lerp(end, 0.5)
    mid.y = 0.35
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.QuadraticBezierCurve3(start, mid, end),
        20,
        0.06,
        6
      ),
      this._cableMat ||
        (this._cableMat = new THREE.MeshStandardMaterial({
          color: 0x34e07a,
          emissive: 0x34e07a,
          emissiveIntensity: 3
        }))
    )
    // 挂在车辆分组下：开场动画期间随车辆一起隐藏（否则会浮在航拍底图上）
    this.vehicleGroup.add(mesh)
    return mesh
  }

  /** 降功率告警：三道向外扩散的红色圆环 + 中心红色光晕 */
  _alarm(center) {
    const g = new THREE.Group()
    g.position.copy(center).setY(0.12)
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
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
        new THREE.RingGeometry(2.0, 2.25, 64),
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
    this.vehicleGroup.add(g)
    this.alarms = this.alarms || new Set()
    this.alarms.add(g)
    return g
  }

  // ================================================================ 装饰

  /** 沙盘下方光晕与网格、罩棚 / 车棚 / 路灯地面光斑、终端顶部状态图标 */
  _buildDecor() {
    const size = this.box.getSize(new THREE.Vector3())
    const base = THEME.base
    // 沙盘下方淡淡一层蓝色光晕 + 网格
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(size.x * 1.25, size.z * 1.5),
      new THREE.MeshBasicMaterial({
        map: glowTexture("40,140,240"),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: THEME.glow.pool
      })
    )
    pool.rotation.x = -Math.PI / 2
    pool.position.set(this.center.x, -base - 0.8, this.center.z)
    const grid = new THREE.GridHelper(900, 150, 0x1b4a76, 0x10305a)
    grid.material.transparent = true
    grid.material.opacity = 0.2
    grid.position.set(this.center.x, -base - 0.9, this.center.z)
    // 设计稿的底座：侧壁底部打出蓝光向上渐隐，地面上沿真实外轮廓一圈光晕
    const { edgeColor, wallWash, floorHalo } = THEME.glow
    const wash = outlineStrip(
      OUTLINE.outline,
      0.06,
      0.06,
      -base,
      -base + 2.6,
      edgeColor,
      wallWash
    )
    const halo = outlineStrip(
      OUTLINE.outline,
      0.2,
      16,
      -base - 0.78,
      -base - 0.78,
      edgeColor,
      floorHalo
    )
    this.scene.add(pool, grid, wash, halo)

    // 湿路面倒影：路灯、罩棚彩色檐口、价格立柱、换电站通道口
    const src = []
    for (const p of this.lampPoints)
      src.push({
        pos: p,
        color: 0xffd9a6,
        k: 0.55,
        width: 1.4,
        length: p.y * 1.6
      })
    for (const [name, color] of [
      ["canopy_fuel_led", 0x36b8ff],
      ["canopy_lng_led", 0xb07cff],
      ["carport_led", 0x34e07a]
    ]) {
      const o = this.station.getObjectByName(name)
      if (!o) continue
      const b = new THREE.Box3().setFromObject(o)
      // 沿檐口四边每 3 m 一条（正交相机下只有朝镜头一侧明显，其余几条被罩棚挡住也无妨）
      const edges = [
        [b.min.x, b.max.x, b.min.z, b.min.z],
        [b.min.x, b.max.x, b.max.z, b.max.z],
        [b.min.x, b.min.x, b.min.z, b.max.z],
        [b.max.x, b.max.x, b.min.z, b.max.z]
      ]
      for (const [x0, x1, z0, z1] of edges) {
        const L = Math.hypot(x1 - x0, z1 - z0)
        for (let t = 1.5; t < L; t += 3) {
          const k = t / L
          src.push({
            pos: new THREE.Vector3(
              x0 + (x1 - x0) * k,
              b.min.y,
              z0 + (z1 - z0) * k
            ),
            color,
            k: 0.4,
            width: 2.2,
            length: 9
          })
        }
      }
    }
    this.station.traverse((o) => {
      if (/^totem_/.test(o.name)) {
        const p = o.getWorldPosition(new THREE.Vector3())
        src.push({ pos: p, color: 0x4ab8ff, k: 0.5, width: 2.4, length: 14 })
      }
    })
    this.streaks = new WetStreaks(src)
    this.scene.add(this.streaks.mesh)

    // 终端顶部状态图标（悬浮、略随时间浮动）
    for (const [, p] of this.piles) {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: badgeTexture(STATUS_COLOR.idle, "bolt"),
          depthTest: false,
          transparent: true
        })
      )
      sp.position.set(p.pos.x, p.top + 1.4, p.pos.z)
      sp.scale.setScalar(2.0)
      sp.renderOrder = 10
      this.scene.add(sp)
      p.badge = sp
    }
  }

  // ================================================================ 开场动画

  /** 播放「现状航拍 → 规划」开场动画（可重播） */
  playIntro() {
    if (!this.station) return
    this.intro?.finish()
    this.introPlaying = true
    this.vehicleGroup.visible = false
    for (const p of this.piles.values()) if (p.badge) p.badge.visible = false
    this.introT = 0
    this.intro = new PlanIntro({
      scene: this.scene,
      station: this.station,
      aerialTex: this.aerialTex,
      setView: (k) => {
        this.introK = k
        this._setIntroView(k)
      }
    })
    this.onIntro(true)
  }

  /**
   * 开场镜头：k=0 正俯视、门前国道横在画面下方（整条场站横向铺开）、场站居中 → k=1 主视角。
   * 俯视段用居中的对称视锥（开场时面板隐藏，不必给面板让位），随 k 过渡到设计稿标定的不对称视锥，
   * 方位角同时从「正对国道」转到设计稿的斜视角
   */
  _setIntroView(k) {
    const sph = this.homeSpherical.clone()
    sph.phi = 1 * DEG + (sph.phi - 1 * DEG) * k
    const t0 = this._azimuthToTheta(-90)
    let dt = sph.theta - t0
    dt = Math.atan2(Math.sin(dt), Math.cos(dt)) // 走最短的旋转方向
    sph.theta = t0 + dt * k
    this.controls.target.copy(this.center)
    const f = this.frustumHome
    if (f) {
      // 对称视锥：宽高与主视角相同，中心对准场站中心
      const cam = this.camera
      const w = f.right - f.left
      const h = f.top - f.bottom
      cam.left = -w / 2 + (f.left + w / 2) * k
      cam.right = cam.left + w
      cam.top = h / 2 + (f.top - h / 2) * k
      cam.bottom = cam.top - h
    }
    this.camera.zoom = 1.05 - 0.05 * k
    this.camera.updateProjectionMatrix()
    this._placeCamera(sph)
  }

  _endIntro() {
    this.intro.finish()
    this.intro = null
    this.introPlaying = false
    this.vehicleGroup.visible = true
    for (const p of this.piles.values()) if (p.badge) p.badge.visible = true
    this.lastInteract = performance.now() - THEME.sway.idle * 1000
    this.onIntro(false)
  }

  // ================================================================ 相机

  /** 方位角（Blender 约定：0 为 +x，逆时针）→ three 球坐标 theta（绕 y 轴，从 +z 起） */
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
   * 正交视锥：按设计稿标定的映射（THEME.view）摆放画面——锚点 anchor 落在设计稿像素 at，比例 scale 像素/米，
   * 于是三维场景与设计稿 01-ai-overview.png（在整屏效果图里的位置）逐像素对齐。视锥不对称，场站避开左右面板。
   * 窗口比例变化时按设计稿宽度等比缩放
   */
  _fitFrustum() {
    if (!this.box) return
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    const s = w / DESIGN_W
    const Hd = h / s
    const { anchor, scale } = THEME.view
    // 设计稿映射 + 页面平移（viewShift，叠图对比时 designFrame 置真归零）
    const shift = this.designFrame ? [0, 0] : THEME.viewShift
    const at = [THEME.view.at[0] + shift[0], THEME.view.at[1] + shift[1]]
    const probe = new THREE.OrthographicCamera()
    probe.position
      .copy(this.center)
      .add(new THREE.Vector3().setFromSpherical(this.homeSpherical))
    probe.lookAt(this.center)
    probe.updateMatrixWorld()
    const a = new THREE.Vector3(...anchor).applyMatrix4(
      probe.matrixWorldInverse
    )
    const k = 1 / scale // 米 / 设计稿像素
    const cam = this.camera
    cam.left = a.x - at[0] * k
    cam.right = cam.left + DESIGN_W * k
    cam.top = a.y + at[1] * k
    cam.bottom = cam.top - Hd * k
    cam.near = 1
    cam.far = 2000
    cam.updateProjectionMatrix()
    this.frustumHome = {
      left: cam.left,
      right: cam.right,
      top: cam.top,
      bottom: cam.bottom
    }
    this.designScale = s
    if (this.introPlaying) this._setIntroView(this.introK ?? 0)
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
    if (!this._downAt || !this.station || this.introPlaying) return
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
        const m = o.name.match(/^(?:pile|bay)_(C\d\d)/)
        if (m) {
          const p = this.piles.get(m[1])
          this.onPick({
            id: m[1],
            ...this._toDesign(p.pos.clone().setY(p.top))
          })
          return
        }
        o = o.parent
      }
    }
    this.onPick(null)
  }

  /** 某台超充终端顶部在画面上的设计稿坐标（面板点选、详情浮窗跟随用） */
  locate(id) {
    const p = this.piles?.get(id)
    return p ? this._toDesign(p.pos.clone().setY(p.top)) : null
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

    if (this.intro) {
      this.introT += dt
      if (this.intro.update(this.introT)) this._endIntro()
    } else {
      this._autoCamera(dt, time)
      this.controls.update()
      this._traffic(dt)
    }
    for (const t of [...this.trips]) t.update(dt)
    this.streaks?.update(this.camera, this.controls.target)

    if (this._cableMat)
      this._cableMat.emissiveIntensity = 2.2 + Math.sin(time * 4) * 0.8
    for (const g of this.alarms || []) {
      for (const ring of g.userData.rings) {
        const k = (time * 0.6 + ring.userData.phase) % 1
        ring.scale.setScalar(1 + k * 2.4)
        ring.material.opacity = 1 - k
      }
    }
    for (const p of this.piles?.values() || []) {
      if (p.badge)
        p.badge.position.y = p.top + 1.4 + Math.sin(time * 2 + p.pos.x) * 0.2
    }

    this.composer.render()

    // 容器尺寸为 0（标签页隐藏、尚未布局）时缩放比为 0，换算会得到 NaN，跳过本帧
    if (this.designScale > 0 && !this.introPlaying) {
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
    this.intro?.finish()
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
    for (const m of this.paints?.values() || []) m.dispose()
    this.aerialTex?.dispose()
    this.streaks?.dispose()
    disposeEffects()
    disposeTextures()
    this.envMap?.dispose()
    this.sun.shadow.map?.dispose()
    this.composer.dispose()
    this.renderer.dispose()
  }
}

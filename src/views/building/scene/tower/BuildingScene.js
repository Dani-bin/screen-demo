/*
 * 楼宇级三维场景：成都金融城双子塔（南塔 / 北塔）全息剖切
 * ----------------------------------------------------------
 * 设计稿：docs/design/building/02-ai-building.png、12-draft-building.png
 * 设计稿是写实剖切模型，全部程序化生成（不需要 Blender / GLB），楼层构件见 floorKit.js：
 *   - 塔身：真实椭圆平面（OSM，data/parkData.js 的 PARK_TOWERS）+ 向上收分 + 斜切屋顶；整栋一张物理材质蓝玻璃幕墙
 *     （夜空环境反射 + 轮廓菲涅尔），玻璃后每层是混凝土楼板、铝合金竖梃、吊顶灯盘、办公桌椅与亮着的屏幕，亮灯区按入驻率分布
 *   - 核心筒：青色电梯井光柱（不做深度测试，透出整栋楼），轿厢光点上下跑
 *   - 裙楼 1～4F：暖金色大堂玻璃 + 大堂家具，屋顶与广场各一圈树
 *   - 地下 B1～B3：石材圆台基座正面挖一个方形剖口（从广场一直切到底），露出车库、配电房、水泵房；告警设备红色波纹
 *   - 选中楼层像抽屉一样向画面右侧抽出（金色围合，层高撑高、家具正常尺寸），塔身里该层隐藏、玻璃挖空
 * 竖向比例：真实塔高 218 m、平面约 52 × 44 m，细高比 4.2，按真实比例放进画面中部会像一根针；
 * 设计稿塔身高宽比约 2.7，所以标准层层高按 2.2 m 示意（真实 3.76 m），裙楼、地下层另给层高（见下方常量）。
 *
 * 模式（setMode）：section 楼层剖切 / facade 透视外立面 / mep 机电系统 / heat 人员热力，切换时各项亮度平滑过渡。
 * 交互：悬浮楼层 → onHover({ key, x, y })；点击 → onPick(key)；select(key) 抽出该层。
 */
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js"
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js"
import {
  CSS2DRenderer,
  CSS2DObject
} from "three/examples/jsm/renderers/CSS2DRenderer.js"
import { createNightEnvironment } from "../park/env"
import {
  clipHalfPlane,
  insetPoly,
  loftGeometry,
  loopSegments,
  majorAxisAngle,
  prismGeometry
} from "./geometry"
import { coreMaterial, drawerGlassMaterial, riserMaterial } from "./shaders"
import {
  buildFloor,
  glassMaterial,
  lightsMaterial,
  solidMaterial
} from "./floorKit"

const DEG = Math.PI / 180

/** 竖向尺度（米，示意比例，见文件头） */
const FLOOR = 2.2 // 塔楼标准层（设计稿塔身高宽比约 2.7）
const PODIUM_FLOOR = 4.6 // 裙楼（设计稿裙楼约为塔身高度的 15%）
const BASE_FLOOR = 13 // 地下层（比真实层高大，剖口里的机房才看得清）
const TAPER = 0.14 // 塔顶相对底部收分
const PODIUM_SCALE = 1.42 // 裙楼平面相对塔楼放大
const BASE_SCALE = 2.25 // 底座半径 = 塔楼平面最大半径 × BASE_SCALE（设计稿底座直径约为塔身宽 2.3 倍）
const NOTCH_HALF = 0.68 // 地下剖口半宽（× 底座半径）
const NOTCH_FRONT = 0.26 // 剖口正面离轴心的距离（× 底座半径），正对相机
const ROOM_D = 20 // 剖口往里能看到的机房进深（米）

/** 各模式下的亮度参数（切换时逐帧插值过去） */
const MODES = {
  // glass 玻璃不透明度、edge 玻璃轮廓光、self 室内家具自发光、light 灯盘亮度、core 核心筒光柱、riser 立管、heat 热力着色、plant 设备层着色
  section: {
    glass: 0.3,
    edge: 1.2,
    self: 0.25,
    light: 1,
    core: 1.15,
    riser: 0,
    heat: 0,
    plant: 0
  },
  facade: {
    glass: 0.7,
    edge: 0.6,
    self: 0.18,
    light: 0.75,
    core: 0.3,
    riser: 0,
    heat: 0,
    plant: 0
  },
  mep: {
    glass: 0.15,
    edge: 0.25,
    self: 0.06,
    light: 0.12,
    core: 1.3,
    riser: 1,
    heat: 0,
    plant: 1
  },
  heat: {
    glass: 0.18,
    edge: 0.25,
    self: 0.08,
    light: 1,
    core: 0.25,
    riser: 0,
    heat: 1,
    plant: 0
  }
}

/** 热力色带：蓝 → 青 → 黄 → 红（与楼层导航面板的热力图例一致） */
const HEAT_STOPS = [
  [0, new THREE.Color(0.1, 0.35, 1.0)],
  [0.4, new THREE.Color(0.1, 0.9, 0.95)],
  [0.75, new THREE.Color(1.0, 0.85, 0.25)],
  [1, new THREE.Color(1.0, 0.25, 0.2)]
]
function heatColor(t, out) {
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [t1, c1] = HEAT_STOPS[i]
    const [t0, c0] = HEAT_STOPS[i - 1]
    if (t <= t1) return out.copy(c0).lerp(c1, (t - t0) / (t1 - t0))
  }
  return out.copy(HEAT_STOPS[HEAT_STOPS.length - 1][1])
}

/** 机电立管：给水（蓝）、强电（紫）、新风（绿）、消防（红） */
const RISERS = [
  { color: [0.2, 0.55, 1.0], speed: 0.35 },
  { color: [0.7, 0.45, 1.0], speed: 0.6 },
  { color: [0.2, 1.0, 0.55], speed: 0.25 },
  { color: [1.0, 0.3, 0.3], speed: 0.45 }
]

export class BuildingScene {
  /**
   * @param {Object} o
   * @param {HTMLCanvasElement} o.canvas
   * @param {HTMLElement} o.container 画布容器（尺寸来源）
   * @param {HTMLElement} o.labelLayer CSS2D 标签层
   * @param {Object} o.tower PARK_TOWERS[key]：{ footprint, height, levels, roof }
   * @param {Array} o.floors data/building.js 的 towerFloors(key)
   * @param {Function} o.onHover ({ key, x, y } | null)
   * @param {Function} o.onPick (key)
   */
  constructor(o) {
    Object.assign(this, {
      canvas: o.canvas,
      container: o.container,
      tower: o.tower,
      floors: o.floors,
      onHover: o.onHover,
      onPick: o.onPick
    })
    this.floorMap = new Map(this.floors.map((f) => [f.key, f]))
    this.levels = this.tower.levels
    this.disposed = false
    this.clock = new THREE.Clock()
    this.mode = "section"
    this.cur = { ...MODES.section }
    this.selected = null
    this.drawerT = 0

    const r = (this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: "high-performance"
    }))
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    r.outputColorSpace = THREE.SRGBColorSpace
    r.toneMapping = THREE.NeutralToneMapping

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x020a1c)
    this.envRT = createNightEnvironment(r)
    this.scene.environment = this.envRT.texture
    this.scene.add(new THREE.HemisphereLight(0x6f94d6, 0x0b1426, 1.2))
    const moon = new THREE.DirectionalLight(0xa9c2ff, 0.9)
    moon.position.set(-200, 300, 150)
    this.scene.add(moon)

    this.camera = new THREE.PerspectiveCamera(26, 1, 1, 5000)
    this.controls = new OrbitControls(this.camera, this.canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.enablePan = false
    this.controls.minPolarAngle = 55 * DEG
    this.controls.maxPolarAngle = 92 * DEG
    this.controls.addEventListener(
      "start",
      () => (this.lastInteract = Infinity)
    )
    this.controls.addEventListener(
      "end",
      () => (this.lastInteract = this.clock.elapsedTime)
    )
    this.lastInteract = 0

    this.labelRenderer = new CSS2DRenderer({ element: o.labelLayer })
    this.composer = new EffectComposer(r)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(256, 256),
      0.35,
      0.4,
      0.8
    )
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this._build()

    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()
    this._onMove = this._onMove.bind(this)
    this._onLeave = () => this._setHover(null)
    this._onClick = this._onClick.bind(this)
    this._onDown = (e) => (this.downAt = [e.clientX, e.clientY])
    this.canvas.addEventListener("pointermove", this._onMove)
    this.canvas.addEventListener("pointerleave", this._onLeave)
    this.canvas.addEventListener("pointerdown", this._onDown)
    this.canvas.addEventListener("click", this._onClick)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.container)
    this.resize()
    this._fitCamera()
    this._loop = this._loop.bind(this)
    this.frameId = requestAnimationFrame(this._loop)
  }

  // ================================================================ 楼层换算

  /** 楼层底面高度（地下层为负） */
  floorBottom(index) {
    if (index < 0) return index * BASE_FLOOR
    if (index <= 4) return (index - 1) * PODIUM_FLOOR
    return this.podiumH + (index - 5) * FLOOR
  }

  floorHeight(index) {
    return index < 0 ? BASE_FLOOR : index <= 4 ? PODIUM_FLOOR : FLOOR
  }

  /** 世界高度 → 楼层 key */
  floorAtY(y) {
    if (y < 0) {
      const b = Math.min(3, Math.ceil(-y / BASE_FLOOR) || 1)
      return `B${b}`
    }
    if (y < this.podiumH) return `${Math.floor(y / PODIUM_FLOOR) + 1}F`
    const f = 5 + Math.floor((y - this.podiumH) / FLOOR)
    return `${Math.min(f, this.levels)}F`
  }

  /** 塔身在高度 y 的平面（收分 + 斜屋顶裁剪） */
  towerPolyAt(y) {
    const k = 1 - TAPER * Math.pow(Math.max(0, y) / this.H, 1.7)
    const poly = this.foot.map(([x, z]) => [x * k, z * k])
    // 斜屋顶：沿下坡方向投影越大顶越低；该高度上「顶高 ≥ y」的部分保留
    // 顶高按未收分的平面算（与外壳放样一致），收分后的平面上界线要同比缩放
    const limit = this.roofLo + ((this.H - y) * this.roofSpan) / this.roofRise
    return clipHalfPlane(poly, this.roofDir, limit * k)
  }

  // ================================================================ 构建

  _build() {
    const t = this.tower
    this.foot = t.footprint
    this.podiumH = 4 * PODIUM_FLOOR
    // 屋顶高差按层高比例缩放（真实 18 m ÷ 3.76 m 层高 ≈ 4.8 层）
    this.roofRise = ((t.roof?.height || 18) / (t.height / t.levels)) * FLOOR
    this.H = this.podiumH + (this.levels - 4) * FLOOR + this.roofRise
    // 下坡方向：OSM 罗盘角（0 北、90 东）→ three 的 (x 东, z 南)
    const d = (t.roof?.direction ?? 90) * DEG
    this.roofDir = [Math.sin(d), -Math.cos(d)]
    const proj = this.foot.map(
      ([x, z]) => x * this.roofDir[0] + z * this.roofDir[1]
    )
    this.roofLo = Math.min(...proj)
    this.roofSpan = Math.max(...proj) - this.roofLo
    this.radius = Math.max(...this.foot.map(([x, z]) => Math.hypot(x, z)))
    this.axis = majorAxisAngle(this.foot)

    // 相机方位：让屋顶下坡方向朝画面右侧（设计稿屋顶左高右低），再转 18° 看到侧面
    // 相机前向 f 满足 f × up = 下坡方向 → f = (d.z, -d.x)
    const fx = this.roofDir[1]
    const fz = -this.roofDir[0]
    const turn = 18 * DEG
    this.viewDir = new THREE.Vector3(
      fx * Math.cos(turn) - fz * Math.sin(turn),
      0,
      fx * Math.sin(turn) + fz * Math.cos(turn)
    ).normalize()
    // 抽屉方向：画面右侧（与相机前向垂直）
    this.drawerDir = new THREE.Vector3(-this.viewDir.z, 0, this.viewDir.x)

    this.root = new THREE.Group()
    this.scene.add(this.root)
    // 楼层构件共用：核心筒尺寸、实体材质（顶点色 + 自发光）、每层的组
    const cd = this._coreDims()
    this.coreRect = { w: cd.w, d: cd.d, axis: this.axis }
    this.solidMat = solidMaterial()
    this.floorGroups = new Map()
    this._buildBase()
    this._buildBasement()
    this._buildPodium()
    this._buildTower()
    this._buildCore()
    this._buildRoof()
    this._buildLabels()
  }

  /**
   * 底座（设计稿 02-ai-building.png）：直径约为塔身 2.3 倍的深色石材圆台，正面挖出一个方形剖口露出地下机房；
   * 下面一块略大的深色镜面圆盘，外缘一圈细青光
   */
  _buildBase() {
    const R = (this.baseR = this.radius * BASE_SCALE)
    const depth = (this.baseDepth = 3 * BASE_FLOOR)
    const yBot = -depth
    // 剖口：|l| < half 且 f > c 的部分挖掉（l 沿画面横向、f 朝相机，见 _lf）
    const half = NOTCH_HALF * R
    const c = NOTCH_FRONT * R
    this.room = { R, c, back: c - ROOM_D, half }
    const camAng = Math.atan2(-this.viewDir.x, -this.viewDir.z)
    this.camAng = camAng
    const gap = 2 * Math.asin(NOTCH_HALF)
    // 外墙：石材贴图（横向砌缝 + 错缝竖缝），剖口那段弧留空
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(
        R,
        R,
        depth,
        160,
        1,
        true,
        camAng + gap / 2,
        Math.PI * 2 - gap
      ),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: stoneTexture(),
        // 石块贴图同时当自发光：夜景里背光那一侧也能读出砌块
        emissive: 0xffffff,
        emissiveIntensity: 0.22,
        roughness: 0.85,
        metalness: 0.1,
        side: THREE.DoubleSide
      })
    )
    wall.material.map.repeat.set(18, 1)
    wall.material.emissiveMap = wall.material.map
    wall.position.y = yBot / 2
    this.root.add(wall)
    this.hitTargets = [wall]
    // 地面广场：剖口上方同样挖开（设计稿的剖口从广场一直切到底），由三块拼成：
    // 剖口正面以内的部分 + 剖口左右两侧伸到前缘的两块
    const circle = []
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * Math.PI * 2
      circle.push([Math.cos(a) * (R + 0.3), Math.sin(a) * (R + 0.3)])
    }
    const F = [-this.viewDir.x, -this.viewDir.z]
    const L = [this.drawerDir.x, this.drawerDir.z]
    const front = clipHalfPlane(circle, [-F[0], -F[1]], -c)
    const pieces = [
      clipHalfPlane(circle, F, c),
      clipHalfPlane(front, [-L[0], -L[1]], -half),
      clipHalfPlane(front, L, -half)
    ]
    const deckMat = new THREE.MeshStandardMaterial({
      color: 0x3a4452,
      roughness: 0.75,
      metalness: 0.2
    })
    for (const poly of pieces)
      if (poly.length >= 3)
        this.root.add(new THREE.Mesh(prismGeometry(poly, -1.0, 0), deckMat))
    // 广场边缘一圈暖色小地灯
    const lampPts = []
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2
      lampPts.push(Math.sin(a) * (R - 1.2), 0.15, Math.cos(a) * (R - 1.2))
    }
    const lg = new THREE.BufferGeometry()
    lg.setAttribute("position", new THREE.Float32BufferAttribute(lampPts, 3))
    this.root.add(
      new THREE.Points(
        lg,
        new THREE.PointsMaterial({
          size: 3,
          sizeAttenuation: false,
          color: new THREE.Color(1.4, 1.0, 0.6),
          map: dotTexture(),
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      )
    )
    // 底部平台：比圆台大一圈的深色镜面圆盘 + 外缘细青光环
    const R2 = R + 7
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(R2, R2 + 0.6, 1.6, 160),
      new THREE.MeshStandardMaterial({
        color: 0x0a1424,
        roughness: 0.8,
        metalness: 0.2
      })
    )
    plate.position.y = yBot - 0.8
    this.root.add(plate)
    const ring = (rad, tube, y, c, k) => {
      const m = new THREE.Mesh(
        new THREE.TorusGeometry(rad, tube, 8, 200),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(c).multiplyScalar(k)
        })
      )
      m.rotation.x = Math.PI / 2
      m.position.y = y
      this.root.add(m)
    }
    ring(R2 + 0.35, 0.28, yBot - 0.05, 0x3fc8ff, 1.5)
    ring(R2 + 0.8, 0.12, yBot - 1.4, 0x2f7dff, 0.9)
    // 平台下方淡淡的蓝色辉光
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(R2 + 30, 64),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uR: { value: R2 } },
        vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
        fragmentShader: `uniform float uR; varying vec2 vP; void main(){ float d = length(vP) - uR; float a = d < 0.0 ? 0.0 : exp(-d / 9.0) * 0.06; gl_FragColor = vec4(vec3(0.12,0.45,1.0) * a, 1.0);} `
      })
    )
    glow.rotation.x = -Math.PI / 2
    glow.position.y = yBot - 1.7
    this.root.add(glow)
  }

  /** 剖切坐标 → 世界 xz：l 沿画面横向（右为正），f 朝相机 */
  _lf(l, f) {
    return [
      this.drawerDir.x * l - this.viewDir.x * f,
      this.drawerDir.z * l - this.viewDir.z * f
    ]
  }

  /** 竖直四边形（两端点为剖切坐标），双面 */
  _quad(l0, f0, l1, f1, y0, y1, mat) {
    const [x0, z0] = this._lf(l0, f0)
    const [x1, z1] = this._lf(l1, f1)
    const g = new THREE.BufferGeometry()
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [
          x0,
          y0,
          z0,
          x1,
          y0,
          z1,
          x1,
          y1,
          z1,
          x0,
          y0,
          z0,
          x1,
          y1,
          z1,
          x0,
          y1,
          z0
        ],
        3
      )
    )
    g.computeVertexNormals()
    const m = new THREE.Mesh(g, mat)
    this.root.add(m)
    return m
  }

  /**
   * 地下 B1～B3 剖口：剖口两侧是石材的剖切面，里面每层一排机房（地面、顶灯、隔墙、后墙），
   * 剖切面上每层一圈描边（选中 / 悬浮 / 告警时变色）
   */
  _buildBasement() {
    const { R, c, back, half } = this.room
    const depth = this.baseDepth
    const F = [-this.viewDir.x, -this.viewDir.z]
    const L = [this.drawerDir.x, this.drawerDir.z]
    // 机房平面 = 圆 ∩ { back ≤ f ≤ c, |l| ≤ half }
    const circle = []
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * Math.PI * 2
      circle.push([Math.cos(a) * (R - 0.4), Math.sin(a) * (R - 0.4)])
    }
    let roomPoly = clipHalfPlane(circle, F, c)
    roomPoly = clipHalfPlane(roomPoly, [-F[0], -F[1]], -back)
    roomPoly = clipHalfPlane(roomPoly, L, half)
    roomPoly = clipHalfPlane(roomPoly, [-L[0], -L[1]], half)
    const cutMat = new THREE.MeshStandardMaterial({
      color: 0x55606e,
      roughness: 0.9,
      side: THREE.DoubleSide
    })
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x8a95a3,
      roughness: 0.85,
      side: THREE.DoubleSide
    })
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x6b7684,
      roughness: 0.7,
      side: THREE.DoubleSide
    })
    // 剖口两侧的剖切面（从剖口正面到圆柱外表面）与后墙
    const fOut = Math.sqrt(R * R - half * half)
    for (const l of [-half, half])
      this._quad(l, c, l, fOut, -depth, -0.01, cutMat)
    this._quad(-half, back, half, back, -depth, 0, wallMat)
    // 隔墙：每层分左中右三间
    for (const k of [-0.36, 0.3])
      this._quad(k * half, back, k * half, c, -depth, 0, wallMat)
    this.baseArcs = new Map()
    for (let b = 1; b <= 3; b++) {
      const yb = -b * BASE_FLOOR
      // 本层地面（0.8 厚，剖口上露出楼板厚边）
      this.root.add(
        new THREE.Mesh(prismGeometry(roomPoly, yb - 0.8, yb), floorMat)
      )
      // 吊顶灯盘：每间两排冷白灯
      for (const [l0, l1] of [
        [-0.96, -0.4],
        [-0.32, 0.26],
        [0.34, 0.96]
      ])
        for (const ff of [0.3, 0.7]) {
          const lamp = new THREE.Mesh(
            new THREE.BoxGeometry(1, 0.15, 0.7),
            new THREE.MeshBasicMaterial({
              color: new THREE.Color(0.62, 0.68, 0.76) // 低于辉光阈值，灯盘不泛光
            })
          )
          const [x, z] = this._lf(
            ((l0 + l1) / 2) * half,
            back + (c - back) * ff
          )
          lamp.position.set(x, yb + BASE_FLOOR - 0.95, z)
          lamp.scale.x = (l1 - l0) * half * 0.85
          lamp.rotation.y = Math.atan2(-this.drawerDir.z, this.drawerDir.x)
          this.root.add(lamp)
        }
      // 每间一盏点光源
      for (const l of [-0.68, -0.03, 0.65]) {
        const light = new THREE.PointLight(0xe6eeff, 150, 26, 1.8)
        const [x, z] = this._lf(l * half, (c + back) / 2 + 2)
        light.position.set(x, yb + BASE_FLOOR - 1.6, z)
        this.root.add(light)
      }
      // 剖口正面的楼层描边
      const pts = []
      for (const [l0, y0, l1, y1] of [
        [-half, yb, half, yb],
        [-half, yb + BASE_FLOOR - 0.05, half, yb + BASE_FLOOR - 0.05],
        [-half, yb, -half, yb + BASE_FLOOR],
        [half, yb, half, yb + BASE_FLOOR]
      ]) {
        const [xa, za] = this._lf(l0, c + 0.05)
        const [xb, zb] = this._lf(l1, c + 0.05)
        pts.push(xa, y0, za, xb, y1, zb)
      }
      const arc = new THREE.LineSegments(
        new THREE.BufferGeometry().setAttribute(
          "position",
          new THREE.Float32BufferAttribute(pts, 3)
        ),
        new THREE.LineBasicMaterial({
          color: 0x2de2e6,
          transparent: true,
          opacity: 0.35
        })
      )
      this.root.add(arc)
      this.baseArcs.set(`B${b}`, arc)
    }
    // 拾取用的不可见体：鼠标指向剖口里的机房时能选中 B1～B3
    const roomHit = new THREE.Mesh(
      prismGeometry(roomPoly, -depth, -0.05),
      new THREE.MeshBasicMaterial({ visible: false })
    )
    this.root.add(roomHit)
    this.hitTargets.push(roomHit)
    this._buildEquipment()
  }

  /**
   * 地下设备（设计稿：蓝色机组 + 管道 + 一排带绿灯的配电柜）：
   * B1 车库（左中两间停车、右间新风机组）、B2 冷水机组 + 配电柜（告警柜红色波纹）、B3 水泵房 + 水箱
   */
  _buildEquipment() {
    const { c, back, half } = this.room
    const mid = (c + back) / 2
    const mat = (color, emissive = 0x000000, ei = 0, metal = 0.5) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.4,
        metalness: metal,
        emissive,
        emissiveIntensity: ei
      })
    const box = (w, h, d, m) =>
      new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
    const rotY = Math.atan2(-this.drawerDir.z, this.drawerDir.x)
    // 设备尺寸随层高放大（层高按 10 m 设计的摆放，层高加大后设备同比放大，机房不显空）
    const K = BASE_FLOOR / 10
    const place = (obj, l, f, y, scaled = true) => {
      const [x, z] = this._lf(l, f)
      obj.position.set(x, y, z)
      if (scaled) obj.scale.setScalar(K)
      obj.rotation.y += rotY
      this.root.add(obj)
      return obj
    }
    const blue = mat(0x2f6fd6, 0x0d3aa0, 0.35)
    const steel = mat(0xa9b8cc, 0x000000, 0, 0.75)
    const cabinet = mat(0xc9d0d8, 0x000000, 0, 0.3)
    const green = mat(0x000000, 0x30ff90, 4)
    /** 冷水机组：蓝色机身 + 两个筒体 + 顶上一根管道 */
    const chiller = (l, f, y) => {
      place(box(6.2, 2.6, 3.4, blue), l, f, y + 1.3 * K)
      for (const dz of [-0.9, 0.9]) {
        const t = new THREE.Mesh(
          new THREE.CylinderGeometry(0.75, 0.75, 6.4, 16),
          blue
        )
        t.rotation.z = Math.PI / 2
        place(t, l, f + dz, y + 3.1 * K)
      }
    }
    /** 配电柜：浅灰柜体 + 柜门上的指示灯 */
    const cab = (l, f, y, alarm) => {
      const m = alarm ? mat(0x7a2a30, 0xff2030, 0.6) : cabinet
      const o = place(box(1.6, 3.6, 1.2, m), l, f, y + 1.8 * K)
      place(
        box(0.9, 0.14, 0.06, alarm ? mat(0x000000, 0xff3040, 4) : green),
        l,
        f + 0.63 * K,
        y + 2.9 * K
      )
      place(
        box(0.9, 0.14, 0.06, alarm ? mat(0x000000, 0xff3040, 4) : green),
        l,
        f + 0.63 * K,
        y + 2.4 * K
      )
      return o
    }
    /** 顶棚管道（沿画面横向） */
    const pipe = (l0, l1, f, y, r, m) => {
      const t = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, Math.abs(l1 - l0), 12),
        m
      )
      t.rotation.z = Math.PI / 2
      place(t, (l0 + l1) / 2, f, y, false)
    }
    // ---- B1：左、中两间车库，右间新风机组
    const y1 = -BASE_FLOOR
    const carColors = [
      0x8a96a8, 0x3b4a63, 0xb8c0cc, 0x7a2e2e, 0x2d3a4a, 0xd0d4da
    ]
    for (let i = 0; i < 12; i++) {
      const l = -half * 0.92 + (i / 11) * half * 1.12
      for (const [f, k] of [
        [mid + 4, 0],
        [mid - 4.5, 1]
      ]) {
        if ((i + k * 2) % 5 === 4) continue
        place(
          box(
            2.0,
            1.4,
            4.4,
            mat(carColors[(i * 5 + k * 3) % carColors.length], 0, 0, 0.6)
          ),
          l,
          f,
          y1 + 0.7 * K
        )
      }
    }
    chiller(0.55 * half, mid - 2, y1)
    chiller(0.82 * half, mid - 2, y1)
    pipe(0.38 * half, 0.98 * half, mid + 4, y1 + BASE_FLOOR - 1.6, 0.4, steel)
    // ---- B2：左间三台冷水机组 + 管道，中、右间一排配电柜（中间一台告警）
    const y2 = -2 * BASE_FLOOR
    for (const l of [-0.88, -0.66, -0.44]) chiller(l * half, mid, y2)
    pipe(
      -0.98 * half,
      -0.38 * half,
      mid - 4.5,
      y2 + BASE_FLOOR - 1.8,
      0.45,
      steel
    )
    pipe(
      -0.98 * half,
      -0.38 * half,
      mid + 4.5,
      y2 + BASE_FLOOR - 1.4,
      0.3,
      mat(0x3ddc97, 0x0a5030, 0.4)
    )
    const alarmOn = !!this.floorMap.get("B2")?.alarm
    for (let i = 0; i < 14; i++) {
      const l = (-0.26 + i * 0.085) * half
      if (Math.abs(l - 0.3 * half) < 1.6) continue
      const alarm = alarmOn && i === 5
      const o = cab(l, back + 2.2, y2, alarm)
      if (alarm)
        this._alarmAt(
          new THREE.Vector3(o.position.x, y2 + 0.08, o.position.z),
          "B2"
        )
      if (i % 3 === 0 && i > 6) cab(l, mid + 3, y2, false)
    }
    // ---- B3：一排卧式水泵 + 管道 + 两个水箱
    const y3 = -3 * BASE_FLOOR
    for (let i = 0; i < 8; i++) {
      const pump = new THREE.Mesh(
        new THREE.CylinderGeometry(0.8, 0.8, 2.6, 16),
        blue
      )
      pump.rotation.z = Math.PI / 2
      place(pump, (-0.9 + i * 0.13) * half, mid, y3 + 1.0 * K)
      const riser = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.25, BASE_FLOOR - 2.5, 8),
        steel
      )
      place(
        riser,
        (-0.9 + i * 0.13) * half,
        mid - 1.2,
        y3 + (BASE_FLOOR - 2.5) / 2 + 1,
        false
      )
    }
    pipe(
      -0.95 * half,
      0.1 * half,
      mid - 1.2,
      y3 + BASE_FLOOR - 1.4,
      0.45,
      steel
    )
    for (const l of [0.5, 0.8])
      place(
        box(6, 4.6, 6, mat(0x7d8a99, 0, 0, 0.3)),
        l * half,
        mid - 1,
        y3 + 2.3 * K
      )
  }

  /** 告警波纹：设备脚下一圈向外扩散的红环 + 红色点光源 */
  _alarmAt(pos, key) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff3040,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
    const rings = []
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), mat.clone())
      m.rotation.x = -Math.PI / 2
      m.position.copy(pos)
      this.root.add(m)
      rings.push(m)
    }
    const light = new THREE.PointLight(0xff2a3a, 300, 14, 1.8)
    light.position.copy(pos).setY(pos.y + 2.5)
    this.root.add(light)
    this.alarms = (this.alarms || []).concat([{ rings, light, key }])
  }

  /** 裙楼：暖金色玻璃 + 楼板 + 屋顶花园 */
  _buildPodium() {
    const poly = this.foot.map(([x, z]) => [x * PODIUM_SCALE, z * PODIUM_SCALE])
    this.podiumPoly = poly
    // 玻璃幕墙（暖色室内透出来，设计稿裙楼是一圈金黄的大堂玻璃）
    const rings = [0, this.podiumH].map((y) => poly.map(([x, z]) => [x, y, z]))
    this.podiumGlass = glassMaterial(0x2a1806, [0.95, 0.58, 0.18])
    this.podiumGlass.opacity = 0.16
    const shell = new THREE.Mesh(loftGeometry(rings), this.podiumGlass)
    shell.renderOrder = 2
    this.root.add(shell)
    this.podiumShell = shell
    this.hitTargets.push(shell)
    // 1～4F 楼层
    for (let f = 1; f <= 4; f++) this._addFloor(f, poly, PODIUM_FLOOR)
    // 大堂暖光：照亮屋顶花园、广场和底座
    const warm = new THREE.PointLight(0xffb060, 900, this.baseR * 1.3, 1.5)
    warm.position.set(0, this.podiumH * 0.4, 0)
    this.root.add(warm)
    // 屋面：深色混凝土 + 一圈银色檐口
    const roof = new THREE.Mesh(
      prismGeometry(poly, this.podiumH - 0.1, this.podiumH + 0.5),
      new THREE.MeshStandardMaterial({ color: 0x3a434f, roughness: 0.8 })
    )
    this.root.add(roof)
    const rim = new THREE.Mesh(
      loftGeometry(
        [this.podiumH + 0.1, this.podiumH + 0.9].map((y) =>
          insetPoly(poly, -0.3).map(([x, z]) => [x, y, z])
        )
      ),
      new THREE.MeshStandardMaterial({
        color: 0xc8ced6,
        roughness: 0.4,
        metalness: 0.5,
        side: THREE.DoubleSide
      })
    )
    this.root.add(rim)
    const ringPts = this.foot.map(([x, z]) => [
      x * (1 + PODIUM_SCALE) * 0.5,
      z * (1 + PODIUM_SCALE) * 0.5
    ])
    const leaf = new THREE.MeshStandardMaterial({
      color: 0x2f7a3a,
      roughness: 0.8,
      emissive: 0x0b2a12,
      emissiveIntensity: 0.6
    })
    const trunk = new THREE.MeshStandardMaterial({ color: 0x3a2a1c })
    const crown = new THREE.IcosahedronGeometry(1.5, 1)
    const stem = new THREE.CylinderGeometry(0.15, 0.2, 1.6, 6)
    let acc = 0
    for (let i = 0; i < ringPts.length; i++) {
      const a = ringPts[i]
      const b = ringPts[(i + 1) % ringPts.length]
      acc += Math.hypot(b[0] - a[0], b[1] - a[1])
      if (acc < 7) continue
      acc = 0
      const t = new THREE.Mesh(crown, leaf)
      t.position.set(a[0], this.podiumH + 2.6, a[1])
      t.scale.setScalar(0.8 + ((i * 37) % 10) / 20)
      const st = new THREE.Mesh(stem, trunk)
      st.position.set(a[0], this.podiumH + 1.4, a[1])
      this.root.add(t, st)
    }
    // 广场上的树（设计稿裙楼外围广场有一圈树）：裙楼外沿与底座边缘之间，剖口上方空着
    const { R, c, half } = this.room
    const rnd = mulberry(23)
    for (let i = 0; i < 40; i++) {
      const ang = (i / 40) * Math.PI * 2 + rnd() * 0.08
      const rad =
        this.radius * PODIUM_SCALE +
        4 +
        rnd() * (R - this.radius * PODIUM_SCALE - 7)
      const x = Math.sin(ang) * rad
      const z = Math.cos(ang) * rad
      // 换到剖切坐标判断是否落在剖口上方
      const l = x * this.drawerDir.x + z * this.drawerDir.z
      const fc = -(x * this.viewDir.x + z * this.viewDir.z)
      if (fc > c - 2 && Math.abs(l) < half + 2) continue
      const k = 0.75 + rnd() * 0.5
      const t = new THREE.Mesh(crown, leaf)
      t.position.set(x, 2.2 * k, z)
      t.scale.setScalar(k)
      const st = new THREE.Mesh(stem, trunk)
      st.position.set(x, 0.8 * k, z)
      st.scale.setScalar(k)
      this.root.add(t, st)
    }
  }

  /**
   * 一层楼（solid + lights）挂到 this.floorGroups，供抽屉隐藏、模式着色
   * @param {number} index 楼层号
   * @param {Array} poly 平面
   * @param {number} height 层高
   */
  /** 在岗密度 0..1：按办公层在岗人数的最小～最大值归一（热力着色用） */
  _heatOf(f) {
    if (!this._staffRange) {
      const st = this.floors
        .filter((x) => x.occupancy != null)
        .map((x) => x.staff)
      this._staffRange = [Math.min(...st), Math.max(...st)]
    }
    const [lo, hi] = this._staffRange
    return f.occupancy == null ? 0 : (f.staff - lo) / Math.max(1, hi - lo)
  }

  _addFloor(index, poly, height) {
    const f = this.floorMap.get(`${index}F`)
    if (!f || poly.length < 3) return
    const { solid, lights } = buildFloor({
      poly,
      height,
      core: this.coreRect,
      floor: f,
      seed: index * 97 + (this.tower.levels || 0),
      // 塔身隔层一条亮层线；裙楼每层都亮
      edgeK: index <= 4 || index % 2 === 1 ? 1 : 0.25
    })
    const g = new THREE.Group()
    g.position.y = this.floorBottom(index)
    g.add(new THREE.Mesh(solid, this.solidMat))
    const lm = lightsMaterial()
    g.add(new THREE.Mesh(lights, lm))
    // 人员热力：楼板上一层按在岗密度着色的半透明光面（灯盘在天花上，从斜上方看不见，热力要画在地面）
    let heatMat = null
    if (f.occupancy != null) {
      heatMat = new THREE.MeshBasicMaterial({
        color: heatColor(this._heatOf(f), new THREE.Color()),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
      const plate = new THREE.Mesh(
        prismGeometry(insetPoly(poly, 0.4), 0.03, 0.06),
        heatMat
      )
      plate.visible = false
      heatMat.userData.mesh = plate
      g.add(plate)
    }
    this.root.add(g)
    this.floorGroups.set(index, {
      group: g,
      lightsMat: lm,
      heatMat,
      floor: f,
      heat: this._heatOf(f)
    })
  }

  /** 塔身：整栋一张玻璃幕墙 + 每层写实楼层 + 外立面传感器光点 */
  _buildTower() {
    const y0 = this.podiumH
    const n = 40
    const rings = []
    const proj = this.foot.map(
      ([x, z]) => x * this.roofDir[0] + z * this.roofDir[1]
    )
    const tops = proj.map(
      (p) => this.H - (this.roofRise * (p - this.roofLo)) / this.roofSpan
    )
    for (let k = 0; k <= n; k++) {
      rings.push(
        this.foot.map(([x, z], i) => {
          const y = y0 + ((tops[i] - y0) * k) / n
          const s = 1 - TAPER * Math.pow(y / this.H, 1.7)
          return [x * s, y, z * s]
        })
      )
    }
    this.towerGlass = glassMaterial()
    this.towerShell = new THREE.Mesh(loftGeometry(rings), this.towerGlass)
    this.towerShell.renderOrder = 2
    this.root.add(this.towerShell)
    this.hitTargets.push(this.towerShell)
    this.roofTops = { rings: rings[n] }
    // 告警楼层（最多两层）：玻璃红色呼吸
    const alarms = this.floors
      .filter((f) => f.alarm && f.index >= 5)
      .slice(0, 2)
    alarms.forEach((f, i) => {
      const y = this.floorBottom(f.index)
      this.towerGlass.userData.u.uAlarm.value[i].set(y, y + FLOOR, 1)
    })
    for (let f = 5; f <= this.levels; f++) {
      const y = this.floorBottom(f)
      this._addFloor(
        f,
        insetPoly(this.towerPolyAt(y + FLOOR * 0.5), 0.35),
        FLOOR
      )
    }

    // 外立面上零星的传感器光点（设计稿塔身上几颗蓝 / 绿光点）
    const dots = []
    const cols = []
    const rnd = mulberry(5)
    for (let i = 0; i < 9; i++) {
      const y = y0 + 10 + rnd() * (this.H - y0 - 30)
      const poly = this.towerPolyAt(y)
      const p = poly[Math.floor(rnd() * poly.length)]
      dots.push(p[0] * 1.01, y, p[1] * 1.01)
      const green = i === 2
      cols.push(0.2, green ? 1 : 0.6, green ? 0.4 : 1)
    }
    const dg = new THREE.BufferGeometry()
    dg.setAttribute("position", new THREE.Float32BufferAttribute(dots, 3))
    dg.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3))
    this.sensorDots = new THREE.Points(
      dg,
      new THREE.PointsMaterial({
        size: 9,
        sizeAttenuation: false,
        vertexColors: true,
        map: dotTexture(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    )
    this.root.add(this.sensorDots)
  }

  /** 核心筒尺寸：沿平面主轴放置的矩形，约占平面长、短轴的 16%（设计稿里是细细一道光柱） */
  _coreDims() {
    let maxA = 0
    let maxB = 0
    const ca = Math.cos(this.axis)
    const sa = Math.sin(this.axis)
    for (const [x, z] of this.foot) {
      maxA = Math.max(maxA, Math.abs(x * ca + z * sa))
      maxB = Math.max(maxB, Math.abs(-x * sa + z * ca))
    }
    return { w: maxA * 2 * 0.16, d: maxB * 2 * 0.17, ca, sa }
  }

  /** 核心筒光柱 + 机电立管 */
  _buildCore() {
    const { w, d, ca, sa } = this._coreDims()
    // 核心筒从地面起（地下剖切面里不出现光柱，免得把机房照成一片白）
    // 从裙楼顶起（不做深度测试，往下伸会压在裙楼和地下机房前面）
    const y0 = this.podiumH
    const y1 = this.H - this.roofRise - 2
    const size = new THREE.Vector3(w, y1 - y0, d)
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(w, y1 - y0, d),
      coreMaterial(size, [y0, y1])
    )
    core.position.y = (y0 + y1) / 2
    core.rotation.y = -this.axis
    // 每层楼板都是实心的，会把核心筒切成一段段；核心筒光柱不做深度测试、最后画（设计稿里它是透出整栋楼的一道光）
    core.material.depthTest = false
    core.renderOrder = 5
    this.root.add(core)
    this.core = core
    this.coreRect = { w, d, axis: this.axis }
    // 立管：贴着核心筒四角
    this.risers = RISERS.map((r, i) => {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.45, y1 - y0, 8),
        riserMaterial(new THREE.Vector3(...r.color), r.speed)
      )
      const sx = (i % 2 ? 1 : -1) * (w / 2 + 1.2)
      const sz = (i < 2 ? 1 : -1) * (d / 2 + 1.2)
      m.position.set(sx * ca - sz * sa, (y0 + y1) / 2, sx * sa + sz * ca)
      this.root.add(m)
      return m
    })
  }

  /** 屋顶：深色斜屋面 + 发光檐口 + 冷却塔 / 擦窗机 */
  _buildRoof() {
    const top = this.roofTops.rings
    const poly = top.map(([x, , z]) => [x, z])
    const ys = top.map((p) => p[1])
    const cap = new THREE.Mesh(
      prismGeometry(poly, Math.min(...ys) - 0.6, ys),
      new THREE.MeshPhysicalMaterial({
        color: 0x3f7fc8,
        roughness: 0.08,
        metalness: 0.2,
        transparent: true,
        opacity: 0.45,
        envMapIntensity: 1.8,
        depthWrite: false
      })
    )
    this.root.add(cap)
    const rim = []
    for (let i = 0; i < top.length; i++) {
      const a = top[i]
      const b = top[(i + 1) % top.length]
      rim.push(...a, ...b)
    }
    const rg = new THREE.BufferGeometry()
    rg.setAttribute("position", new THREE.Float32BufferAttribute(rim, 3))
    this.root.add(
      new THREE.LineSegments(
        rg,
        new THREE.LineBasicMaterial({ color: new THREE.Color(0.7, 0.95, 1.4) })
      )
    )
    // 屋面设备：放在高侧（下坡方向反面），顶高按斜面算
    const metal = new THREE.MeshStandardMaterial({
      color: 0x5a6a80,
      metalness: 0.6,
      roughness: 0.4,
      emissive: 0x0a2040,
      emissiveIntensity: 0.5
    })
    const s = 1 - TAPER
    const topAt = (x, z) => {
      const p = (x * this.roofDir[0] + z * this.roofDir[1]) / s
      return this.H - (this.roofRise * (p - this.roofLo)) / this.roofSpan
    }
    for (const [ox, oz] of [
      [-0.35, 0.15],
      [-0.25, -0.2],
      [-0.05, 0.0]
    ]) {
      const x = (ox * this.roofDir[0] - oz * this.roofDir[1]) * this.radius * s
      const z = (ox * this.roofDir[1] + oz * this.roofDir[0]) * this.radius * s
      const m = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 4), metal)
      m.position.set(x, topAt(x, z) + 0.6, z)
      this.root.add(m)
    }
    this.roofAnchor = new THREE.Vector3(0, this.H + 6, 0)
  }

  /** CSS2D 标签（样式在 BuildingLevel.vue 的 .bd-label） */
  _label(html, cls, pos) {
    const el = document.createElement("div")
    el.className = `bd-label ${cls}`
    el.innerHTML = html
    const obj = new CSS2DObject(el)
    obj.position.copy(pos)
    this.root.add(obj)
    return obj
  }

  _buildLabels() {
    const side = (y, k = 1) => {
      // 塔身左侧（画面左边）外沿：沿抽屉反方向找轮廓点
      const poly = y < this.podiumH ? this.podiumPoly : this.towerPolyAt(y)
      let best = poly[0]
      let bd = Infinity
      for (const p of poly) {
        const v = p[0] * this.drawerDir.x + p[1] * this.drawerDir.z
        if (v < bd) {
          bd = v
          best = p
        }
      }
      return new THREE.Vector3(best[0] * k, y, best[1] * k)
    }
    this.labels = []
    this.labels.push(
      this._label("屋顶 · 冷却塔 / 擦窗机", "cyan top", this.roofAnchor)
    )
    for (const f of this.floors) {
      if (f.kind === "plant" && f.index === 18) {
        const y = this.floorBottom(f.index) + FLOOR / 2
        this.labels.push(
          this._label(
            `${f.key} ${f.name.replace("设备层 · ", "")}`,
            "cyan left",
            side(y)
          )
        )
      }
      if (f.alarm && f.index > 0) {
        const y = this.floorBottom(f.index) + FLOOR / 2
        this.labels.push(
          this._label(`${f.key} · ${f.alarm}`, "red left", side(y))
        )
      }
      if (f.alarm && f.index < 0 && this.alarms?.length) {
        const a = this.alarms.find((x) => x.key === f.key)
        if (a)
          this.labels.push(
            this._label(
              `${f.key} ${f.name.split(" · ")[0]} · ${f.alarm.replace(/出线温度过高/, "过温")}`,
              "red right",
              // 放在剖切面右端外侧，不压住机房
              new THREE.Vector3(
                ...(([x, z]) => [x, 0, z])(
                  this._lf(this.room.half, this.room.c)
                )
              ).setY(this.floorBottom(f.index) + BASE_FLOOR * 0.5)
            )
          )
      }
    }
    this.labels.push(
      this._label("1–4F 大堂 · 商业裙楼", "cyan left", side(this.podiumH * 0.6))
    )
    // 选中楼层的标签：挂在抽屉外端，跟随抽屉移动
    this.selLabel = this._label("", "gold", new THREE.Vector3())
    this.selLabel.visible = false
  }

  // ================================================================ 选中楼层：抽屉

  /** 选中楼层（key 或 null）：地上层抽屉抽出，地下层描边高亮 */
  select(key) {
    if (key === this.selected) return
    this.selected = key
    const f = key ? this.floorMap.get(key) : null
    this.baseArcs.forEach((arc, k) => {
      arc.material.color.set(
        k === key ? 0xffc65a : this.floorMap.get(k)?.alarm ? 0xff4050 : 0x2de2e6
      )
      arc.material.opacity = k === key ? 1 : 0.35
    })
    // 旧抽屉收回后再换新的：直接替换（收回动画会让切换显得拖沓）
    if (this.drawer) {
      this.root.remove(this.drawer)
      disposeTree(this.drawer)
      this.drawer = null
    }
    this.drawerT = 0
    this._setGap(-99, 0)
    if (!f) {
      this.selLabel.visible = false
      return
    }
    const occ = f.occupancy != null ? ` 入驻率 ${f.occupancy}%` : ""
    this.selLabel.element.innerHTML = `${f.key} · ${f.name}${occ}`
    this.selLabel.visible = true
    if (f.index < 0) {
      // 标签放在该层剖切面右端
      const [x, z] = this._lf(this.room.half * 0.95, this.room.c)
      this.selLabel.position.set(
        x,
        this.floorBottom(f.index) + BASE_FLOOR * 0.6,
        z
      )
      return
    }
    this.drawer = this._makeDrawer(f)
    this.root.add(this.drawer)
    this.drawerFloor = f.index
  }

  _makeDrawer(f) {
    const y = this.floorBottom(f.index)
    const realH = this.floorHeight(f.index)
    // 抽屉层高撑到 2.6 倍（以该层为中心上下撑开），家具保持正常尺寸：整栋楼的画面里真实层高只有十来个像素
    const h = Math.max(realH * 2.6, 6)
    const poly =
      f.index <= 4
        ? this.podiumPoly
        : insetPoly(this.towerPolyAt(y + realH * 0.5), 0.35)
    const g = new THREE.Group()
    g.position.y = y - (h - realH) / 2
    const { solid, lights } = buildFloor({
      poly,
      height: h,
      core: this.coreRect,
      floor: f,
      seed: f.index * 97 + 1,
      ceiling: true
    })
    g.add(new THREE.Mesh(solid, this.solidMat))
    g.add(
      new THREE.Mesh(
        lights,
        new THREE.MeshBasicMaterial({ vertexColors: true })
      )
    )
    // 金色玻璃围合
    const wallRings = [0, h].map((yy) =>
      insetPoly(poly, -0.25).map(([x, z]) => [x, yy, z])
    )
    this.drawerGlass = drawerGlassMaterial()
    g.add(new THREE.Mesh(loftGeometry(wallRings), this.drawerGlass))
    // 上下金边
    const edge = new THREE.LineBasicMaterial({
      color: new THREE.Color(1.6, 1.15, 0.45)
    })
    for (const yy of [0.02, h - 0.02]) {
      const lg = new THREE.BufferGeometry()
      lg.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          loopSegments(insetPoly(poly, -0.3), yy),
          3
        )
      )
      g.add(new THREE.LineSegments(lg, edge))
    }
    // 暖光照亮室内与下方塔身
    const light = new THREE.PointLight(0xffc070, 500, this.radius * 2.4, 1.5)
    light.position.y = h * 0.75
    g.add(light)
    // 标签锚点：抽屉外端（抽出方向上最远的轮廓点）
    let far = poly[0]
    for (const p of poly)
      if (
        p[0] * this.drawerDir.x + p[1] * this.drawerDir.z >
        far[0] * this.drawerDir.x + far[1] * this.drawerDir.z
      )
        far = p
    this.drawerTip = new THREE.Vector3(far[0], h + 1.2, far[1])
    return g
  }

  /** 抽出的楼层：塔身里那层的玻璃挖空、楼层组隐藏 */
  _setGap(floor, amt) {
    const on = amt > 0.02 && floor > -99
    const y = on ? this.floorBottom(floor) : 0
    const h = on ? this.floorHeight(floor) : 0
    for (const m of [this.towerGlass, this.podiumGlass])
      m.userData.u.uGap.value.set(y - 0.05, y + h + 0.05, on ? 1 : 0)
    this.floorGroups.forEach(
      (fg, idx) => (fg.group.visible = !(on && idx === floor))
    )
  }

  // ================================================================ 模式 / 交互

  setMode(mode) {
    if (MODES[mode]) this.mode = mode
  }

  _setHover(key) {
    if (key === this.hovered) return
    this.hovered = key
    const f = key ? this.floorMap.get(key) : null
    for (const m of [this.towerGlass, this.podiumGlass]) {
      if (f && f.index > 0) {
        const y = this.floorBottom(f.index)
        m.userData.u.uHover.value.set(y, y + this.floorHeight(f.index), 1)
      } else m.userData.u.uHover.value.set(0, -1, 0)
    }
    this.baseArcs.forEach((arc, k) => {
      if (k === this.selected) return
      arc.material.opacity = k === key ? 0.9 : 0.35
    })
    this.canvas.style.cursor = key ? "pointer" : ""
    if (!key) this.onHover?.(null)
  }

  _pick(e) {
    const rect = this.canvas.getBoundingClientRect()
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObjects(this.hitTargets, false)[0]
    if (!hit) return null
    // 抽出的楼层本身也能点中：命中点落在抽屉层高度范围内
    return {
      key: this.floorAtY(hit.point.y),
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    }
  }

  _onMove(e) {
    const p = this._pick(e)
    this._setHover(p?.key || null)
    if (p) this.onHover?.(p)
  }

  _onClick(e) {
    if (
      this.downAt &&
      Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]) > 5
    )
      return
    const p = this._pick(e)
    if (p) this.onPick?.(p.key)
  }

  /** 标签 / 抽屉锚点在画布上的像素位置（给 Vue 浮层用） */
  screenPos(v) {
    const p = v.clone().project(this.camera)
    const rect = this.canvas.getBoundingClientRect()
    return { x: ((p.x + 1) / 2) * rect.width, y: ((1 - p.y) / 2) * rect.height }
  }

  // ================================================================ 相机 / 渲染

  _fitCamera() {
    const bottom = -this.baseDepth - 2
    const top = this.H + 8
    const hgt = top - bottom
    const fov = this.camera.fov * DEG
    // 整栋楼（含基座）占画面高度约 74%；视点略高于楼的中点，让楼整体下移、塔顶避开顶栏与视图切换
    const dist = (hgt * 0.5) / Math.tan(fov / 2) / 0.7
    const elev = 10 * DEG
    const target = new THREE.Vector3(0, bottom + hgt * 0.53, 0)
    const pos = target
      .clone()
      .addScaledVector(this.viewDir, -dist * Math.cos(elev))
      .setY(target.y + dist * Math.sin(elev))
    this.camera.position.copy(pos)
    this.controls.target.copy(target)
    this.controls.minDistance = dist * 0.45
    this.controls.maxDistance = dist * 1.3
    const az = Math.atan2(pos.x - target.x, pos.z - target.z)
    this.controls.minAzimuthAngle = az - 70 * DEG
    this.controls.maxAzimuthAngle = az + 70 * DEG
    this.controls.update()
    this.home = { position: pos.clone(), target: target.clone() }
  }

  resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.labelRenderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  _returnHome(dt) {
    if (!this.home || this.clock.elapsedTime - this.lastInteract < 12) return
    const k = 1 - Math.exp(-dt * 0.8)
    this.camera.position.lerp(this.home.position, k)
    this.controls.target.lerp(this.home.target, k)
  }

  _loop() {
    if (this.disposed) return
    const dt = Math.min(this.clock.getDelta(), 0.1)
    const t = this.clock.elapsedTime
    // 模式参数插值
    const goal = MODES[this.mode]
    const k = 1 - Math.exp(-dt * 5)
    for (const key in goal) this.cur[key] += (goal[key] - this.cur[key]) * k
    const c = this.cur
    for (const m of [this.towerGlass, this.podiumGlass]) {
      m.userData.u.uTime.value = t
      m.userData.u.uEdgeK.value = c.edge
    }
    this.towerGlass.opacity = c.glass
    this.podiumGlass.opacity = c.glass * 0.8
    this.solidMat.userData.self.value = c.self
    // 每层灯盘颜色：白光 → 热力色（按在岗密度）→ 设备层绿，乘灯盘亮度
    const white = this._tmpWhite || (this._tmpWhite = new THREE.Color(1, 1, 1))
    const hc = this._tmpHeat || (this._tmpHeat = new THREE.Color())
    this.floorGroups.forEach((fg) => {
      const col = fg.lightsMat.color
      col.copy(white).lerp(heatColor(fg.heat, hc), c.heat)
      if (fg.floor.kind === "plant")
        col.lerp(hc.setRGB(0.25, 1.0, 0.55), c.plant)
      col.multiplyScalar(
        c.light + (fg.floor.kind === "plant" ? c.plant * 0.9 : 0)
      )
      if (fg.heatMat) {
        fg.heatMat.opacity = c.heat * 0.55
        fg.heatMat.userData.mesh.visible = c.heat > 0.02
      }
    })
    this.core.material.uniforms.uCore.value = c.core
    this.core.material.uniforms.uTime.value = t
    for (const r of this.risers) {
      r.material.uniforms.uAmt.value = c.riser
      r.material.uniforms.uTime.value = t
      r.visible = c.riser > 0.02
    }
    // 抽屉：0 → 1 缓动抽出
    if (this.drawer) {
      this.drawerT = Math.min(1, this.drawerT + dt * 1.6)
      const e = 1 - Math.pow(1 - this.drawerT, 3)
      const out = this.radius * 1.1 * e
      this.drawer.position.x = this.drawerDir.x * out
      this.drawer.position.z = this.drawerDir.z * out
      this.drawerGlass.uniforms.uTime.value = t
      this.drawerGlass.uniforms.uAmt.value = Math.min(1, this.drawerT * 2)
      this._setGap(this.drawerFloor, e)
      this.selLabel.position.copy(this.drawerTip).add(this.drawer.position)
    }
    // 告警波纹：两圈错开半个周期向外扩散
    for (const a of this.alarms || [])
      a.rings.forEach((ring, i) => {
        const p = (t * 0.6 + i * 0.5) % 1
        ring.scale.setScalar(1 + p * 5)
        ring.material.opacity = (1 - p) * 0.9
        a.light.intensity = 220 + 120 * Math.sin(t * 5)
      })
    this._returnHome(dt)
    this.controls.update()
    this.composer.render()
    this.labelRenderer.render(this.scene, this.camera)
    this.frameId = requestAnimationFrame(this._loop)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frameId)
    this.resizeObserver.disconnect()
    this.canvas.removeEventListener("pointermove", this._onMove)
    this.canvas.removeEventListener("pointerleave", this._onLeave)
    this.canvas.removeEventListener("pointerdown", this._onDown)
    this.canvas.removeEventListener("click", this._onClick)
    this.controls.dispose()
    disposeTree(this.scene)
    // CSS2D 标签的 DOM 不随场景释放，手动移除
    this.labelRenderer.domElement.innerHTML = ""
    this.envRT.dispose()
    this.composer.dispose()
    this.renderer.dispose()
  }
}

/** 释放一棵对象树里的几何与材质 */
function disposeTree(root) {
  root.traverse((o) => {
    o.geometry?.dispose()
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
}

/** 固定种子伪随机 */
function mulberry(seed) {
  let s = seed
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 圆形柔光点贴图（传感器光点用） */
function dotTexture() {
  const c = document.createElement("canvas")
  c.width = c.height = 64
  const g = c.getContext("2d")
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, "rgba(255,255,255,1)")
  grd.addColorStop(0.3, "rgba(255,255,255,0.8)")
  grd.addColorStop(1, "rgba(255,255,255,0)")
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

/** 底座石材贴图：深灰石块，横向砌缝 + 上下错缝的竖缝，每块明暗略有差别 */
function stoneTexture() {
  const c = document.createElement("canvas")
  c.width = 256
  c.height = 256
  const g = c.getContext("2d")
  const rows = 4
  const cols = 3
  const rnd = mulberry(11)
  g.fillStyle = "#1c222b" // 砌缝
  g.fillRect(0, 0, 256, 256)
  for (let r = 0; r < rows; r++)
    for (let k = -1; k < cols; k++) {
      const x = (k + (r % 2) * 0.5) * (256 / cols)
      const v = 84 + rnd() * 30
      g.fillStyle = `rgb(${v},${v + 4},${v + 10})`
      g.fillRect(x + 2, r * 64 + 2, 256 / cols - 4, 60)
    }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  return tex
}

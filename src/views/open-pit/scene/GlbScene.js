/**
 * 青原露天矿：Blender 全景模型场景（无 Vue 依赖）
 * ----------------------------------------------------------
 * 接口和 PitScene.js 一致（页面外壳只依赖这些公开方法）：ready / setState / focus / select / setTour / setFrozen / project / resize / dispose。
 * 内容：public/open-pit/pit.glb（scripts/blender/open_pit 建模并烘焙：十级台阶的坑、两座排土场、7 台电铲、破碎站、电厂、煤场……），
 * 卡车沿 data/pit3d.json 里的三维路线跑（glbTrucks.js），预警热区 / 雷达环 / 电铲工作灯 / 蒸汽 / 选中环是这里叠加的实时效果。
 * 坐标：模型和 pit3d.json 是 Blender 世界（x 东 / y 北 / z 上，米），three 里是 (x, z, -y)。
 * 相机：总览视角就是设计稿的相机（俯角 / 视场角 / 距离在 pit3d.camera），投影的主点按设计稿里场景图在舞台中的位置偏移，
 * 所以总览画面和设计稿像素对得上；其余视角围绕各设备。
 */
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"

import layout from "../data/layout.json"
import pit3d from "../data/pit3d.json"
import { ROUTES as SIM_ROUTES, SHOVEL_STATE } from "../sim/simulator.js"
import { GlbTrucks, Route3 } from "./glbTrucks.js"
import { TOUR, VIEWS } from "./tour.js"
import { THEME } from "./theme.js"

export { TOUR, VIEWS }

const BASE = import.meta.env.BASE_URL
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
/** Blender 世界 (x 东, y 北, z 上) → three (x, y 上, z 南) */
const T = (x, y, z = 0) => new THREE.Vector3(x, z, -y)
const A = pit3d.anchors // 标签锚点：从设计稿相机看过去正好落在设计稿的标签点上（scripts/blender/open_pit/routes.py）
const B = pit3d.bases // 设备底座：选中光环、雷达扫描环放在这里

/**
 * 设计稿里场景图在 1920 × 1080 舞台中的位置（scripts/open-pit/plate.py 的 STAGE）：左 −110、上 92、宽 1720、高 968，
 * 场景图 1536 × 864 → 放大 1.12 倍。设计稿相机的垂直视场角是 pit3d.camera.vfov（对应场景图高度 864 像素），
 * 所以舞台里的焦距 = 432 / tan(vfov / 2) × 1.12，场景图中心（相机瞄准点）在舞台的 (750, 576)。
 */
const STAGE_K = 1.12
const FOCAL = (432 / Math.tan((pit3d.camera.vfov * Math.PI) / 360)) * STAGE_K
const PP = { x: -110 + 768 * STAGE_K, y: 92 + 432 * STAGE_K } // 主点（舞台设计像素）

/** 各视角：target 世界 (x, y, z)，dist 米，pitch 俯角（度），yaw 方位（度，0 = 相机在目标正南，正值向东转） */
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
export const GLB_VIEWS = {
  overview: {
    target: [0, 0, 0],
    dist: pit3d.camera.dist,
    pitch: pit3d.camera.pitch,
    yaw: 0
  },
  fleet: {
    target: [pit3d.center[0], pit3d.center[1], -pit3d.depth / 2],
    dist: 2300,
    pitch: 46,
    yaw: -18
  },
  swap: { target: mid(A["SW-01"], A["SW-02"]), dist: 900, pitch: 30, yaw: 20 },
  shovel: { target: A["ES-06"], dist: 800, pitch: 50, yaw: 8 },
  slope: {
    target: [A["SR-02"][0], A["SR-02"][1] - 250, -30],
    dist: 1400,
    pitch: 26,
    yaw: 0
  },
  yard: { target: mid(A["CY-01"], A["PP-01"]), dist: 1500, pitch: 32, yaw: -24 }
}

/** 材质名 → 自发光材质（页面里用 MeshBasicMaterial 显示，颜色 × 强度，超过 1 的部分被辉光扩散） */
const GLOW_MATS = new Set([
  "op_road",
  "op_road_edge",
  "op_edge",
  "op_grid",
  "op_cyan",
  "op_amber",
  "op_red",
  "op_glass",
  "op_signal",
  "op_water"
])

export default class GlbScene {
  /**
   * @param {HTMLCanvasElement} canvas 铺满窗口的画布
   * @param {object} options 同 PitScene（stageBox / onSelect / onView / onTour / quality）
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
    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 20, 60000)

    scene.add(new THREE.HemisphereLight(0x8fb7ff, 0x0a1420, 1.0))
    const sun = new THREE.DirectionalLight(0xcfe8ff, 0.8)
    sun.position.set(2500, 4500, -2200)
    scene.add(sun)

    // 模型
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    const gltf = await loader.loadAsync(`${BASE}open-pit/pit.glb`)
    this._prepareModel(gltf.scene)
    scene.add(gltf.scene)
    this.model = gltf.scene

    // 路线（世界坐标，页面里按电铲编号取）
    this.routes = Object.fromEntries(
      Object.entries(pit3d.routes).map(([k, pts]) => [k, new Route3(pts)])
    )

    // 卡车：用模型里的 truck_template（烘进缩放，前向转到 +z）
    this.trucks = new GlbTrucks(
      layout.devices.filter((d) => d.kind === "truck"),
      this.routes,
      SIM_ROUTES,
      this._truckParts(gltf.scene),
      pit3d
    )
    scene.add(this.trucks.group())

    this._buildEffects()

    // 后期：渲染 → 辉光 → 输出（色调映射只在最后做一次）
    const composer = new EffectComposer(
      renderer,
      new THREE.WebGLRenderTarget(4, 4, {
        type: THREE.HalfFloatType,
        samples: 0
      })
    )
    composer.addPass(new RenderPass(scene, this.camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.3, 0.5, 0.78)
    const setSize = bloom.setSize.bind(bloom)
    bloom.setSize = (w, h) => setSize(Math.ceil(w / 2), Math.ceil(h / 2)) // 辉光本来就是模糊的光晕，半分辨率足够
    composer.addPass(bloom)
    composer.addPass(new OutputPass())
    this.composer = composer
    this.bloom = bloom

    // 相机控制：只转和缩放，不平移（构图由视角预设决定）
    const controls = new OrbitControls(this.camera, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.enablePan = false
    controls.minDistance = 250
    controls.maxDistance = 14000
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

  /** 材质整理：烘焙贴图的表面改成不受光照的贴图材质，发光材质改成 MeshBasicMaterial，设备保持标准材质但压低金属度 */
  _prepareModel(root) {
    const cache = new Map()
    const conv = (m) => {
      if (cache.has(m)) return cache.get(m)
      let r = m
      if (m.name.startsWith("dual_")) {
        r = this._dualMaterial(m)
      } else if (m.name.startsWith("baked_")) {
        r = new THREE.MeshBasicMaterial({ map: m.map })
        if (m.map) m.map.anisotropy = 8
        if (m.name === "baked_design") this._addGrain(r)
      } else if (GLOW_MATS.has(m.name)) {
        r = new THREE.MeshBasicMaterial({
          color: m.emissive.clone().multiplyScalar(m.emissiveIntensity),
          toneMapped: true
        })
      } else if (m.isMeshStandardMaterial) {
        m.metalness = Math.min(m.metalness, 0.25)
      }
      r.name = m.name
      cache.set(m, r)
      return r
    }
    root.traverse((o) => {
      if (!o.isMesh) return
      o.material = Array.isArray(o.material)
        ? o.material.map(conv)
        : conv(o.material)
    })
    // 冷却塔和煤场拱棚：设计稿里是被灯光照亮的浅蓝白（第 13 轮评审：发暗、看不出来），只给这几个物体换成自带微光的材质
    const lit = {
      op_concrete: new THREE.MeshStandardMaterial({
        color: 0x7a9bb4,
        roughness: 0.7,
        emissive: 0x1d5a78,
        emissiveIntensity: 0.55,
        side: THREE.DoubleSide // 冷却塔是单层壳，从塔口能看到内壁
      }),
      op_white: new THREE.MeshStandardMaterial({
        color: 0xa9c3d4,
        roughness: 0.5,
        emissive: 0x3a7fa0,
        emissiveIntensity: 0.6
      })
    }
    // 输煤走廊（BC-02、BC-02-1 …）也换成同样的微光白：设计稿里是一条亮的白管
    const litIds = ["PP-01-T1", "PP-01-T2", "CY-01"]
    root.traverse((o) => {
      if (/^BC-02(-\d+)?$/.test(o.name)) litIds.push(o.name)
    })
    for (const id of litIds) {
      root.getObjectByName(id)?.traverse((o) => {
        if (!o.isMesh) return
        const swap = (m) => lit[m.name] ?? m
        o.material = Array.isArray(o.material)
          ? o.material.map(swap)
          : swap(o.material)
      })
    }
    // 换电站和场站建筑：白屋顶 / 混凝土墙在半球光 + 主光下亮成一块浅蓝（第 17 轮对比：SW-02 一带亮度 67 vs 设计稿 46），
    // 设计稿里这些是暗色建筑、只有窗和灯带亮，换成压暗的夜景材质
    const night = {
      op_white: new THREE.MeshStandardMaterial({
        color: 0x3a4a56,
        roughness: 0.6
      }),
      op_concrete: new THREE.MeshStandardMaterial({
        color: 0x26343f,
        roughness: 0.8
      }),
      // 换电工位 / 窗：设计稿里是暗楼里透出的灯光，不是整面发亮的浅青玻璃
      op_glass: new THREE.MeshBasicMaterial({ color: 0x3f7f92 })
    }
    for (const id of [
      "SW-01",
      "SW-02",
      "CC-01",
      "OF-01",
      "SS-01",
      "CH-01",
      "WT-01"
    ]) {
      root.getObjectByName(id)?.traverse((o) => {
        if (!o.isMesh) return
        const swap = (m) => night[m.name] ?? m
        o.material = Array.isArray(o.material)
          ? o.material.map(swap)
          : swap(o.material)
      })
    }
    // 台阶 / 排土场已经投影了设计稿（scripts/blender/open_pit/project.py），设计稿里画着台阶亮线和运输道路；
    // 总览时再叠我们自己的道路边线 / 沿口线就成了两套线，所以这些线只在镜头拉近时淡入（_update）
    this.lineMats = []
    root.traverse((o) => {
      if (!o.isMesh) return
      for (const m of [o.material].flat()) {
        if (
          ["op_road", "op_road_edge", "op_edge", "op_edge_dump"].includes(
            m.name
          ) &&
          !this.lineMats.includes(m)
        ) {
          m.transparent = true
          this.lineMats.push(m)
        }
      }
    })
    // 移动 5G 基站：12 台共用一份网格和信标材质（op_signal），每台复制一份信标材质，才能单独按在线 / 离线改色
    this.masts = []
    for (let i = 1; i <= 12; i++) {
      const id = `BS-${String(i).padStart(2, "0")}`
      const node = root.getObjectByName(id)
      if (!node) continue
      const mats = []
      node.traverse((o) => {
        if (!o.isMesh) return
        const own = (m) => {
          if (m.name !== "op_signal") return m
          const c = m.clone()
          mats.push(c)
          return c
        }
        o.material = Array.isArray(o.material)
          ? o.material.map(own)
          : own(o.material)
      })
      this.masts.push({ id, mats, base: mats[0]?.color.clone() })
    }
  }

  /** 冷却塔烟羽：每个粒子按年龄变大变淡（自定义点精灵着色器：PointsMaterial 只能整体一个大小） */
  _makePlume(count) {
    const g = new THREE.BufferGeometry()
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(count * 3), 3)
    )
    g.setAttribute("age", new THREE.BufferAttribute(new Float32Array(count), 1))
    const seed = new Float32Array(count * 3)
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random()
    g.setAttribute("seed", new THREE.BufferAttribute(seed, 3))
    const pts = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: {
          uTex: { value: this._glow() },
          uScale: { value: 1 }
        },
        vertexShader: /* glsl */ `
          attribute float age;
          varying float vA;
          uniform float uScale;
          void main() {
            vA = age;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            // 粒子世界尺寸从 35 m 长到 120 m，按透视缩放
            gl_PointSize = mix(35.0, 120.0, age) * uScale / -mv.z;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uTex;
          varying float vA;
          void main() {
            float m = texture2D(uTex, gl_PointCoord).r;
            float a = smoothstep(0.0, 0.1, vA) * pow(1.0 - vA, 1.6) * 0.22;
            gl_FragColor = vec4(vec3(0.8, 0.9, 0.95) * m, m * a);
          }`,
        transparent: true,
        depthWrite: false
      })
    )
    pts.frustumCulled = false
    return pts
  }

  /**
   * 台阶 / 排土场的双贴图材质（scripts/blender/open_pit/project.py 的 apply_dual）：
   * map = 程序化烘焙的岩石（和几何对得上），emissiveMap = 设计稿投影（第二套 UV），顶点色 r = 投影权重（设计稿相机看得见 × 正对）。
   * 按每个像素到相机的距离混合：2200 m 以外全用设计稿（总览 3.5 km 就是设计稿本身），700 m 以内全用程序化岩石——
   * 近景里设计稿画的台阶线和实际几何错位、分辨率也不够，会出拖影和重影（第 17 轮评审）
   */
  _dualMaterial(m) {
    if (m.map) m.map.anisotropy = 8
    if (m.emissiveMap) m.emissiveMap.anisotropy = 8
    return new THREE.ShaderMaterial({
      uniforms: {
        mProc: { value: m.map },
        mDesign: { value: m.emissiveMap ?? m.map },
        uCam: { value: this.camera.position },
        uNear: { value: 700 },
        uFar: { value: 2200 }
      },
      vertexShader: /* glsl */ `
        attribute vec2 uv1;
        attribute vec4 color;
        varying vec2 vUv0;
        varying vec2 vUv1;
        varying float vW;
        varying vec3 vWorld;
        void main() {
          vUv0 = uv;
          vUv1 = uv1;
          vW = color.r;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D mProc;
        uniform sampler2D mDesign;
        uniform vec3 uCam;
        uniform float uNear;
        uniform float uFar;
        varying vec2 vUv0;
        varying vec2 vUv1;
        varying float vW;
        varying vec3 vWorld;
        void main() {
          vec3 a = texture2D(mProc, vUv0).rgb;
          vec3 b = texture2D(mDesign, vUv1).rgb;
          float far = smoothstep(uNear, uFar, distance(uCam, vWorld));
          gl_FragColor = vec4(mix(a, b, clamp(vW, 0.0, 1.0) * far), 1.0);
        }`
    })
  }

  /**
   * 设计稿投影贴图（坑底和坑外地表）只有 1536 × 864 的分辨率，近景里放大后一片糊（第 15 轮评审）：
   * 按世界坐标叠三层值噪声（约 1.2 / 3 / 9 m）调制明暗，离相机 600 m 内满强度、2200 m 外消失，总览不受影响
   */
  _addGrain(mat) {
    const cam = this.camera
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uCam = { value: cam.position }
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vW;")
        .replace(
          "#include <project_vertex>",
          "#include <project_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;"
        )
      sh.fragmentShader = sh.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          varying vec3 vW;
          uniform vec3 uCam;
          float gH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float gN(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(gH(i), gH(i + vec2(1.0, 0.0)), f.x), mix(gH(i + vec2(0.0, 1.0)), gH(i + vec2(1.0)), f.x), f.y);
          }`
        )
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          {
            float k = 1.0 - smoothstep(600.0, 2200.0, distance(uCam, vW));
            float n = gN(vW.xz / 1.2) * 0.2 + gN(vW.xz / 3.0) * 0.45 + gN(vW.xz / 9.0) * 0.35;
            diffuseColor.rgb *= mix(1.0, 0.62 + 0.76 * n, k);
          }`
        )
    }
  }

  /** truck_template → 实例化用的部件列表：几何烘进节点缩放和朝向（Blender 前向 +Y → glTF 的 -Z，转到 +z），白色车斗标为 body */
  _truckParts(root) {
    const tpl = root.getObjectByName("truck_template")
    const parts = []
    if (!tpl) return parts
    tpl.updateWorldMatrix(true, true)
    tpl.traverse((o) => {
      if (!o.isMesh) return
      const geo = o.geometry.clone()
      const m = o.matrixWorld.clone()
      m.elements[12] = m.elements[13] = m.elements[14] = 0 // 去掉平移（模板放在地面以下）
      geo.applyMatrix4(m)
      geo.rotateY(Math.PI)
      parts.push({
        geometry: geo,
        // 车斗（白色件）实例色表示状态；第 17 轮：原来是不受光照的纯色，总览里每辆车是一块平涂的白（评审：「白骰子」），
        // 改成受光的米白：顶面亮、侧面暗，像设计稿里有体积的矿卡；其余件保持模型材质
        material:
          o.material.name === "op_white"
            ? new THREE.MeshStandardMaterial({
                color: 0xc9d3d8,
                roughness: 0.55,
                metalness: 0.1,
                // 只靠夜景灯光车身太暗（总览里几乎看不见），加一层灰色自发光托底，顶面再由主光提亮
                emissive: 0x8e9ca4,
                emissiveIntensity: 1
              })
            : o.material,
        body: o.material.name === "op_white",
        cargo: o.material.name === "op_cargo", // 货堆（重载时显示）
        lamp: o.material.name === "op_headlamp" // 车灯（行驶时点亮）
      })
    })
    tpl.parent.remove(tpl)
    return parts
  }

  // ================================================================ 叠加效果

  /** 径向渐隐的白色光斑贴图（暖光池 / 预警热区用，颜色由材质的 color 决定） */
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

  _addGlowPlane(color, x, y, z, size, opacity) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this._glow(),
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    )
    m.rotation.x = -Math.PI / 2
    m.scale.setScalar(size)
    m.position.copy(T(x, y, z))
    this.scene.add(m)
    return m
  }

  _ring(color, opacity) {
    const r = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 48),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    )
    r.rotation.x = -Math.PI / 2
    this.scene.add(r)
    return r
  }

  _buildEffects() {
    // 电铲脚下的暖光池（装车时亮）
    this.shovelFx = []
    for (let i = 1; i <= 7; i++) {
      const id = `ES-0${i}`
      const [x, y, z] = B[id]
      // 第 13 轮评审：光池太大太黄，设计稿里只是电铲脚下一小片暖光（缩到约 1/3）
      const pool = this._addGlowPlane(THEME.amber, x, y, z + 4, 130, 0.2)
      this.shovelFx.push({ id, pool, phase: i * 1.7 })
    }
    // 边坡雷达：扫描环从塔脚向坑里扩散
    this.radars = ["SR-01", "SR-02", "SR-03"].map((id) => {
      const [x, y, z] = B[id]
      const ring = this._ring(THEME.cyan, 0.6)
      ring.position.copy(T(x, y, z + 6))
      // 塔顶的橙环：设计稿里预警雷达是塔顶一个小圆环（半径约 22 px），不是地面上的大椭圆
      const top = this._ring(THEME.warn, 0)
      top.rotation.x = 0 // 竖直放，正对总览相机看上去是圆
      top.position.copy(T(A[id][0], A[id][1], A[id][2]))
      return { id, ring, top, phase: Math.random() }
    })
    // 离线基站脚下的红色光斑（平时透明，离线时闪）
    for (const m of this.masts) {
      const [x, y, z] = B[m.id]
      m.pool = this._addGlowPlane(THEME.fault, x, y, z + 3, 90, 0)
    }
    // 边坡预警热区：设计稿 .heat 椭圆反投影到北帮台阶上的位置和大小（pit3d.heat），沿坑沿方向拉长
    const hz = pit3d.heat
    this.heat = this._addGlowPlane(
      0xe2566e,
      hz.center[0],
      hz.center[1],
      hz.center[2] + 12,
      1,
      0
    )
    this.heat.scale.set(hz.w, hz.d, 1)
    // 第 15 轮评审：热区是一块边缘生硬的品红椭圆——水平的光斑平面和斜的台阶面相交，埋进岩壁的部分被深度测试截掉成硬边；
    // 不做深度测试，整块按径向渐隐叠上去，颜色也降了饱和
    this.heat.material.depthTest = false
    this.heat.renderOrder = 5
    // 电厂冷却塔的蒸汽：从塔口（塔高 200 m，scripts/blender/open_pit/equip.py 的 cooling_tower）升起的烟羽
    this.steam = ["PP-01-T1", "PP-01-T2"].map((id) => {
      const [x, y, z] = A[id]
      const pts = this._makePlume(90)
      pts.position.copy(T(x, y, z + 198))
      this.scene.add(pts)
      return pts
    })
    // 选中：光环 + 光柱
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
      new THREE.CylinderGeometry(2.5, 2.5, 160, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      })
    )
    beam.position.y = 80
    const g = new THREE.Group()
    g.add(ring, beam)
    g.visible = false
    this.scene.add(g)
    this.sel = { group: g, ring, beam }
  }

  // ================================================================ 公开接口

  /**
   * 把仿真状态喂给场景：sim.at(ms) 的返回值；monitors 是 sim.monitors(ms) 的返回值（边坡预警热区用，可省略）。
   * 一秒一次即可，场景在两次之间外推卡车位置。
   */
  setState(state, monitors) {
    if (this.state && state.t !== this.state.t) {
      this.prev = this.state
      this.prevById = new Map(this.prev.trucks.map((t) => [t.id, t]))
    }
    this.state = state
    this.stateWall = performance.now()
    if (monitors) this.monitors = monitors
  }

  /** 相机飞到某个视角 */
  focus(view, { duration = 1.8 } = {}) {
    if (!this.model || !GLB_VIEWS[view]) return
    this.view = view
    this._applyView(view, true, duration)
    this.options.onView?.(view)
  }

  /** 选中卡车 / 设备：高亮 + 光柱，null 取消 */
  select(id) {
    this.selected = id
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
    const a = A[id]
    if (!a) return null
    return T(a[0], a[1], a[2])
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    if (!w || !h) return
    const box = this.options.stageBox?.() ?? { x: 0, y: 0, w, h }
    const u = box.w / 1920
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    // 设计稿相机的焦距（舞台设计像素）→ 当前舞台缩放下的 CSS 像素；主点移到设计稿里场景图中心所在的舞台位置
    const cam = this.camera
    cam.aspect = w / h
    cam.fov = (2 * Math.atan(h / 2 / (FOCAL * u)) * 180) / Math.PI
    cam.setViewOffset(
      w,
      h,
      w / 2 - box.x - PP.x * u,
      h / 2 - box.y - PP.y * u,
      w,
      h
    )
    cam.updateProjectionMatrix()
    // 烟羽粒子的透视缩放：深度 1 m 处每米多少个设备像素（焦距 = FOCAL × u CSS 像素）
    const px = FOCAL * u * this.renderer.getPixelRatio()
    for (const pts of this.steam ?? []) pts.material.uniforms.uScale.value = px
  }

  dispose() {
    cancelAnimationFrame(this._raf)
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
    const v = GLB_VIEWS[view]
    const target = T(v.target[0], v.target[1], v.target[2])
    const pitch = THREE.MathUtils.degToRad(v.pitch)
    const yaw = THREE.MathUtils.degToRad(v.yaw)
    // 相机在目标正南（three 的 +z）偏 yaw
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
      this.options.onSelect?.(this._pick(e.clientX, e.clientY))
    }
    this.canvas.addEventListener("pointerdown", this._pd)
    this.canvas.addEventListener("pointerup", this._pu)
  }

  /** 点选：先看卡车（实例），再看设备锚点（屏幕距离最近且在 34 px 内） */
  _pick(cx, cy) {
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
    for (const id of Object.keys(A)) {
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
    this.composer.render()
  }

  _update(dt) {
    const t = this.time

    // 相机补间
    const tw = this._tween
    if (tw) {
      tw.t = Math.min(1, tw.t + dt / tw.dur)
      const k = ease(tw.t)
      this.camera.position.lerpVectors(tw.p0, tw.p1, k)
      this.controls.target.lerpVectors(tw.t0, tw.t1, k)
      if (tw.t >= 1) this._tween = null
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
      // 电铲脚下的光池：装车时亮
      for (const s of this.shovelFx) {
        const sh = st.shovels.find((x) => x.id === s.id)
        const working = sh && SHOVEL_STATE[sh.state] === "装车中"
        s.pool.material.opacity = working
          ? 0.32 + 0.08 * Math.sin(t * 2.4 + s.phase)
          : 0.06
      }
    }

    // 雷达扫描环：从塔脚向坑里扩散；预警的雷达变橙、加快
    const warn = this._warnSector()
    for (const r of this.radars) {
      const hot = warn && warn.id === r.id
      r.phase = (r.phase + dt * (hot ? 0.55 : 0.2)) % 1
      const rad = 15 + r.phase * 70
      r.ring.scale.set(rad, rad, 1)
      r.ring.material.opacity = (1 - r.phase) * (hot ? 0.6 : 0.25)
      r.ring.material.color.setHex(hot ? THEME.warn : THEME.cyan)
      const tr = 34 * (1 + 0.08 * Math.sin(t * 3.2))
      r.top.scale.set(tr, tr, 1)
      r.top.material.opacity = hot ? 0.9 : 0
    }
    // 预警热区：随预警强弱淡入淡出，带脉动
    const target = warn ? 0.36 * (0.8 + 0.2 * Math.sin(t * 3.2)) : 0
    this.heat.material.opacity = THREE.MathUtils.lerp(
      this.heat.material.opacity,
      target,
      0.08
    )

    // 道路边线 / 沿口线：离目标 3000 m 以外（总览 3500 m）完全隐藏，1700 m 以内全显
    const camD = this.camera.position.distanceTo(this.controls.target)
    const lineK = 1 - THREE.MathUtils.smoothstep(camD, 1700, 3000)
    for (const m of this.lineMats) {
      m.opacity = lineK
      m.visible = lineK > 0.01
    }

    // 5G 基站信标：在线是青色慢闪，离线（monitors.bs 的 online = false）变红快闪，脚下红光斑
    const bsById = new Map((this.monitors?.bs ?? []).map((b) => [b.id, b]))
    for (const m of this.masts) {
      const off = bsById.get(m.id)?.online === false
      const blink = off
        ? Math.sin(t * 6) > 0
          ? 1
          : 0.15
        : 0.75 + 0.25 * Math.sin(t * 1.6 + m.id.charCodeAt(4))
      for (const mat of m.mats) {
        if (off) mat.color.setHex(THEME.fault).multiplyScalar(2.2 * blink)
        else mat.color.copy(m.base).multiplyScalar(blink)
      }
      m.pool.material.opacity = off ? 0.35 * blink : 0
    }

    // 蒸汽：每个粒子有自己的年龄（0 塔口 → 1 消散），越往上越散、越大、越淡，整体顺风往东北飘。
    // 坐标是相对塔口的局部坐标（Points 本身放在塔口；第 19 轮之前这里又加了一遍塔口坐标，烟羽飘到了塔外几百米的半空）
    for (const pts of this.steam) {
      const g = pts.geometry
      const pos = g.attributes.position
      const age = g.attributes.age
      const sd = g.attributes.seed
      for (let i = 0; i < pos.count; i++) {
        const k = (t * 0.03 + sd.getX(i)) % 1
        const a = sd.getY(i) * Math.PI * 2
        // 烟羽宽度和塔口（直径约 80 m）相当、往上升约 1.3 个塔高：设计稿里是一缕一缕的白汽（第一版宽到 500 m，糊成一大团白云）
        const rad = (14 + 50 * k) * Math.sqrt(sd.getZ(i))
        const drift = 120 * Math.pow(k, 1.3)
        pos.setXYZ(
          i,
          Math.cos(a) * rad + drift * 0.8,
          k * 260,
          Math.sin(a) * rad - drift * 0.45
        )
        age.setX(i, k)
      }
      pos.needsUpdate = true
      age.needsUpdate = true
    }

    // 选中：光环 + 光柱跟随
    if (this.selected) {
      const p = this._anchorPos(this.selected)
      if (p) {
        const g = this.sel.group
        // 卡车的锚点在车顶（+14 m），设备的光环放在底座上
        const b = B[this.selected]
        if (b) g.position.copy(T(b[0], b[1], b[2] + 3))
        else
          g.position.set(
            p.x,
            p.y - (this.selected.startsWith("TK-") ? 14 : 0) + 3,
            p.z
          )
        const s = this.selected.startsWith("TK-") ? 60 : 130
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

  /** 选中的东西是否在故障：故障卡车（第 5 组）或离线的 5G 基站 */
  _isFault(id) {
    if (id.startsWith("BS-"))
      return this.monitors?.bs.find((b) => b.id === id)?.online === false
    const t = this.state?.trucks.find((x) => x.id === id)
    return t?.group === 5
  }

  /** 当前最严重的边坡预警：{ id }；没有预警返回 null */
  _warnSector() {
    if (!this.monitors) return null
    const bad = this.monitors.radar
      .filter((r) => r.level >= 2)
      .sort((a, b) => b.level - a.level)[0]
    return bad ? { id: bad.id } : null
  }
}

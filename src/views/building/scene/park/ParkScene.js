/*
 * 园区级三维场景：成都金融城双子塔 · 天府国际金融中心
 * ----------------------------------------------------------
 * 模型：public/building/park.glb（Blender 脚本 scripts/blender/park/ 按 OSM 布局建模导出），
 *       public/building/park_ground.webp（Cycles 烘焙的地面光照，见 bake.py）。
 * 还原设计稿质感的三件事：
 *   1. 地面直接显示烘焙图（路灯光斑、楼体溢光、树影都在图里），不再实时打光
 *   2. 玻璃 / 金属用程序化夜景环境贴图做反射（env.js），窗灯与描边自发光 + 辉光
 *   3. 车流、状态点、告警波纹、数据飞线这些动态元素在 three.js 里补（traffic.js、markers.js）
 * 交互：悬浮楼栋高亮、点击楼栋（或标签）选中并回调 onPick(key)；拖动旋转 / 滚轮缩放，空闲后回到初始视角。
 * 不依赖 Vue。
 */
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js"
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js"
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js"
import { THEME } from "./theme"
import { createNightEnvironment } from "./env"
import { Traffic } from "./traffic"
import { Markers, createHighlightShell } from "./markers"
import { createPathLights } from "./pathLights"
import { createWater } from "./water"

const DEG = Math.PI / 180

/**
 * 楼体墙根的暖色泛光：地灯、大堂灯把墙脚照亮，越往上越暗。
 * 往 PBR 材质的自发光里叠一项随世界高度指数衰减的暖色（onBeforeCompile 注入）
 */
function addFacadeWash(material) {
  const { color, strength, height } = THEME.wash
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWash = {
      value: new THREE.Color(...color).multiplyScalar(strength)
    }
    shader.uniforms.uWashH = { value: height }
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "varying float vWashY;\nvoid main() {")
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvWashY = (modelMatrix * vec4(transformed, 1.0)).y;"
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "void main() {",
        "varying float vWashY;\nuniform vec3 uWash;\nuniform float uWashH;\nvoid main() {"
      )
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += uWash * exp(-max(vWashY, 0.0) / uWashH);"
      )
  }
  material.needsUpdate = true
}

export class ParkScene {
  /**
   * @param {Object} o
   * @param {HTMLCanvasElement} o.canvas
   * @param {HTMLElement} o.container 画布容器（尺寸来源）
   * @param {HTMLElement} o.labelLayer CSS2D 标签层
   * @param {string} o.baseUrl import.meta.env.BASE_URL
   * @param {Array} o.buildings PARK_BUILDINGS
   * @param {Array} o.roads PARK_ROADS
   * @param {Array} o.paths PARK_PATHS（园内步道，地灯沿线布置）
   * @param {Array} o.waters PARK_WATERS（水面轮廓，叠实时反光水面）
   * @param {Object} o.bounds PARK_BOUNDS
   * @param {Object} o.status 楼栋状态 { key: "ok" | "alarm" }
   * @param {Function} o.onPick (key|null)
   * @param {Function} o.onHover (key|null)
   */
  constructor(o) {
    Object.assign(this, {
      canvas: o.canvas,
      container: o.container,
      baseUrl: o.baseUrl,
      info: new Map(o.buildings.map((b) => [b.key, b])),
      roads: o.roads,
      paths: o.paths || [],
      waters: o.waters || [],
      bounds: o.bounds,
      status: o.status || {},
      onPick: o.onPick,
      onHover: o.onHover
    })
    this.disposed = false
    this.clock = new THREE.Clock()
    this.selected = null
    this.hovered = null

    const r = (this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: "high-performance"
    }))
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    r.outputColorSpace = THREE.SRGBColorSpace
    r.toneMapping = THREE.NeutralToneMapping
    r.toneMappingExposure = THEME.exposure

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(THEME.background)
    this.scene.fog = new THREE.FogExp2(THEME.background, THEME.fog)
    this.envRT = createNightEnvironment(r)
    this.scene.environment = this.envRT.texture

    // 灯光：只照楼体与树（地面是烘焙图）。冷色天光 + 西北上方的月光
    this.scene.add(new THREE.HemisphereLight(0x6f94d6, 0x0b1426, 2.2))
    const moon = new THREE.DirectionalLight(0xa9c2ff, 1.8)
    moon.position.set(-300, 500, -200)
    this.scene.add(moon)

    const { fov } = THEME.camera
    this.camera = new THREE.PerspectiveCamera(fov, 1, 10, 20000)
    this.controls = new OrbitControls(this.camera, this.canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.enablePan = false
    this.controls.minPolarAngle = THEME.orbit.minPolar * DEG
    this.controls.maxPolarAngle = THEME.orbit.maxPolar * DEG
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
    const { strength, radius, threshold } = THEME.bloom
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(256, 256),
      strength,
      radius,
      threshold
    )
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()
    this._onMove = this._onMove.bind(this)
    this._onClick = this._onClick.bind(this)
    this._onDown = (e) => (this.downAt = [e.clientX, e.clientY])
    this.canvas.addEventListener("pointermove", this._onMove)
    this.canvas.addEventListener("pointerdown", this._onDown)
    this.canvas.addEventListener("click", this._onClick)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.container)
    this.resize()
    this._loop = this._loop.bind(this)
  }

  // ================================================================ 加载

  async load() {
    const [gltf, groundTex] = await Promise.all([
      new GLTFLoader().loadAsync(`${this.baseUrl}building/park.glb`),
      new THREE.TextureLoader().loadAsync(
        `${this.baseUrl}building/park_ground.webp`
      )
    ])
    if (this.disposed) return
    this.park = gltf.scene
    this.scene.add(this.park)
    this._prepareMaterials(groundTex)
    this._tintTrees()
    this._collectBuildings()

    this.traffic = new Traffic(this.roads, THEME.traffic)
    this.traffic.meshes.forEach((m) => this.scene.add(m))
    this.markers = new Markers({
      buildings: this.buildings,
      status: this.status,
      onLabelClick: (key) => this.select(key)
    })
    this.scene.add(this.markers.group)
    this.pathLights = createPathLights(this.paths)
    this.scene.add(this.pathLights)
    this.water = createWater(this.waters, this._waterLights())
    this.scene.add(this.water.group)
    this._underGlow()
    this.resize()
    this._fitCamera()
    this.frameId = requestAnimationFrame(this._loop)
  }

  /** 材质：地面换烘焙图、自发光强度按材质名重设、贴图各向异性 */
  _prepareMaterials(groundTex) {
    const aniso = this.renderer.capabilities.getMaxAnisotropy()
    groundTex.flipY = false // 与 glTF 的 UV 原点约定一致
    groundTex.colorSpace = THREE.SRGBColorSpace
    groundTex.channel = 1 // 第二套 UV（Blender 里的 Lightmap）
    groundTex.anisotropy = aniso
    this.groundTex = groundTex
    const groundMat = new THREE.MeshBasicMaterial({
      map: groundTex,
      color: new THREE.Color().setScalar(THEME.groundGain)
    })
    const ground = this.park.getObjectByName("ground")
    ground?.traverse((o) => {
      if (o.isMesh) o.material = groundMat
    })

    const seen = new Set()
    this.park.traverse((o) => {
      if (!o.isMesh || o.material === groundMat) return
      const m = o.material
      if (seen.has(m)) return
      seen.add(m)
      const k = THEME.emissive[m.name]
      if (k != null) m.emissiveIntensity = k
      for (const v of Object.values(m))
        if (v && v.isTexture) v.anisotropy = aniso
      // 玻璃与金属壳吃环境反射；树不要反射（否则发灰），颜色全靠顶点色 + 实例色（_tintTrees）
      if (m.name === "M_tree") {
        m.envMapIntensity = 0.08
        m.roughness = 0.9
      } else if (m.name === "M_tower_glass") {
        // 塔楼玻璃：加强环境反射，让塔身读成设计稿里的蓝色玻璃，金色只留在轮廓线上
        m.envMapIntensity = 1.6
        addFacadeWash(m)
      } else if (m.name === "M_pebble_glass") {
        addFacadeWash(m)
      } else if (m.name === "M_slab") {
        // 沙盘侧面：深色金属，环境反射太强会泛出一大片青蓝
        m.envMapIntensity = 0.25
      } else if (m.name === "M_tower_roof") {
        // 塔楼斜屋面朝东南倾斜，会把西北方的月光镜面反射进相机，变成一块发白的椭圆；
        // 改成深色粗糙面，屋顶只留金色檐口线
        m.color.setHex(0x080c14)
        m.roughness = 0.95
        m.metalness = 0.05
        m.envMapIntensity = 0.2
      } else if (m.name === "M_roof_edge") {
        // 鹅卵石楼圆弧檐口：银白铝板。环境反射是夜空的深蓝，反射太强会整圈发蓝，压低后靠自发光读成白边
        m.envMapIntensity = 0.6
      } else if (m.name === "M_hall_shell") {
        // 会议中心金属壳：环境反射会把夜空的蓝色整片映上去（穹顶读成一块蓝），压低反射与金属度；
        // 改用底色贴图当微弱自发光（泛光照亮的铝板），读出设计稿的银灰肋条与中央深色天窗。
        // 穹顶朝天，自发光不能高，也不加墙根泛光，否则会过曝成一块白
        m.envMapIntensity = 0.3
        m.roughness = 0.5
        m.metalness = 0.3
        m.emissiveMap = m.map
        m.emissive.setRGB(1, 1, 1)
        m.emissiveIntensity = 0.2
      }
    })
  }

  /**
   * 树的实例色：个体亮度差 + 靠近路灯 / 地灯的树被照成暖色。
   * 实时渲染里几百盏点光源算不起，按距离直接把受光「画」进每棵树的实例色（InstancedMesh.instanceColor）
   */
  _tintTrees() {
    this.park.updateMatrixWorld(true)
    const lights = []
    const p = new THREE.Vector3()
    const m4 = new THREE.Matrix4()
    this.park.traverse((o) => {
      if (!o.isInstancedMesh) return
      const kind =
        o.material.name === "M_lamp_head"
          ? THEME.tree.lamp
          : o.material.name === "M_bollard_head"
            ? THEME.tree.bollard
            : null
      if (!kind) return
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m4)
        p.setFromMatrixPosition(m4).applyMatrix4(o.matrixWorld)
        lights.push([p.x, p.z, kind])
      }
    })
    const { base, jitter, warm } = THEME.tree
    const c = new THREE.Color()
    let seed = 7
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    this.park.traverse((o) => {
      if (!o.isInstancedMesh || o.material.name !== "M_tree") return
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m4)
        p.setFromMatrixPosition(m4).applyMatrix4(o.matrixWorld)
        let w = 0
        for (const [x, z, k] of lights) {
          const d2 = (x - p.x) ** 2 + (z - p.z) ** 2
          if (d2 < 9 * k.sigma * k.sigma)
            w += k.gain * Math.exp(-d2 / (2 * k.sigma * k.sigma))
        }
        w = Math.min(1.2, w)
        const b = base * (1 + (rnd() * 2 - 1) * jitter)
        c.setRGB(
          b * (1 + w * warm[0]),
          b * (1 + w * warm[1]),
          b * (1 + w * warm[2])
        )
        o.setColorAt(i, c)
      }
      o.instanceColor.needsUpdate = true
    })
  }

  /**
   * 会映进湖面的光源（倒影位置、光带半宽、颜色 × 强度），见 water.js：
   * 路灯 / 庭院灯 / 地灯取各自 InstancedMesh 灯头几何的中心再乘实例矩阵；双子塔取大堂与塔身两处
   */
  _waterLights() {
    const KIND = {
      M_lamp_head: {
        width: 0.7,
        color: new THREE.Color(1.0, 0.68, 0.36).multiplyScalar(0.95)
      },
      M_bollard_head: {
        width: 0.35,
        color: new THREE.Color(1.0, 0.72, 0.42).multiplyScalar(0.45)
      }
    }
    const lights = []
    const m4 = new THREE.Matrix4()
    this.park.updateMatrixWorld(true)
    this.park.traverse((o) => {
      const kind = o.isInstancedMesh && KIND[o.material.name]
      if (!kind) return
      o.geometry.computeBoundingBox()
      const head = o.geometry.boundingBox.getCenter(new THREE.Vector3())
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m4)
        const position = head
          .clone()
          .applyMatrix4(m4)
          .applyMatrix4(o.matrixWorld)
        lights.push({ position, ...kind })
      }
    })
    // 塔楼：暖色大堂 + 银白塔身（窗灯与格栅），倒影是又宽又长的一片
    for (const key of ["tower_N", "tower_S"]) {
      const b = this.buildings.get(key)
      if (!b) continue
      const c = b.box.getCenter(new THREE.Vector3())
      lights.push({
        position: new THREE.Vector3(c.x, 7, c.z),
        width: 7,
        color: new THREE.Color(1.0, 0.7, 0.38).multiplyScalar(0.55)
      })
      lights.push({
        position: new THREE.Vector3(c.x, 60, c.z),
        width: 8,
        color: new THREE.Color(0.55, 0.6, 0.7).multiplyScalar(0.35)
      })
    }
    return lights
  }

  /** 楼栋：bld_<key> 对象 + 包围盒 */
  _collectBuildings() {
    this.buildings = new Map()
    this.pickables = []
    for (const [key, info] of this.info) {
      const obj = this.park.getObjectByName(`bld_${key}`)
      if (!obj) continue
      const box = new THREE.Box3().setFromObject(obj)
      this.buildings.set(key, { obj, box, info })
      obj.traverse((o) => {
        if (o.isMesh) {
          o.userData.buildingKey = key
          this.pickables.push(o)
        }
      })
    }
  }

  /** 沙盘底部蓝色光晕：沙盘下方一张比底座大一圈的发光面（设计稿「悬浮」感） */
  _underGlow() {
    const { x0, x1, z0, z1 } = this.bounds
    const w = x1 - x0
    const h = z1 - z0
    const pad = 70
    const geo = new THREE.PlaneGeometry(w + pad * 2, h + pad * 2)
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uSize: { value: new THREE.Vector2(w, h) },
        uPad: { value: pad },
        uColor: { value: new THREE.Color(0x1d6bff) }
      },
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() {
          vP = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec2 uSize;
        uniform float uPad;
        uniform vec3 uColor;
        varying vec2 vP;
        void main() {
          // 到底座矩形边缘的距离（圆角矩形 SDF），向外指数衰减
          vec2 q = abs(vP) - uSize * 0.5 + 22.0;
          float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 22.0;
          // 只在底座外缘一圈发光：底座正下方被底座挡住，远离边缘迅速衰减
          float a = d < 0.0 ? 0.0 : exp(-d / (uPad * 0.25)) * 0.16;
          gl_FragColor = vec4(uColor, a);
        }`
    })
    const glow = new THREE.Mesh(geo, mat)
    glow.rotation.x = -Math.PI / 2
    glow.position.set((x0 + x1) / 2, -17, (z0 + z1) / 2)
    glow.renderOrder = -1
    this.scene.add(glow)
    this.glow = glow
  }

  // ================================================================ 相机

  /** 按方位角 / 俯角摆相机，再二分距离让沙盘在画面里占 fit 比例的宽度 */
  _fitCamera() {
    const { azimuth, elevation, target, fit } = THEME.camera
    const az = azimuth * DEG
    const el = elevation * DEG
    // Blender 方位角（x 东、y 北）→ three（x 东、z 南）
    const dir = new THREE.Vector3(
      Math.cos(az) * Math.cos(el),
      Math.sin(el),
      -Math.sin(az) * Math.cos(el)
    )
    const t = new THREE.Vector3(...target)
    const { x0, x1, z0, z1 } = this.bounds
    const corners = []
    for (const x of [x0, x1])
      for (const z of [z0, z1])
        for (const y of [-16, 0]) corners.push(new THREE.Vector3(x, y, z))
    const cam = this.camera
    const span = (dist) => {
      cam.position.copy(t).addScaledVector(dir, dist)
      cam.lookAt(t)
      cam.updateMatrixWorld()
      let minX = Infinity
      let maxX = -Infinity
      for (const c of corners) {
        const p = c.clone().project(cam)
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
      }
      return (maxX - minX) / 2
    }
    let lo = 200
    let hi = 20000
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (span(mid) > fit) lo = mid
      else hi = mid
    }
    span(hi)
    this.home = { position: cam.position.clone(), target: t.clone() }
    this.controls.target.copy(t)
    this.controls.minDistance = hi * 0.45
    this.controls.maxDistance = hi * 1.4
    // 方位角限制在初始值 ±azimuthRange
    const homeAz = Math.atan2(dir.x, dir.z)
    this.controls.minAzimuthAngle = homeAz - THEME.orbit.azimuthRange * DEG
    this.controls.maxAzimuthAngle = homeAz + THEME.orbit.azimuthRange * DEG
    this.controls.update()
  }

  /** 空闲一段时间后，相机缓慢回到初始视角 */
  _returnHome(dt) {
    if (!this.home) return
    if (this.clock.elapsedTime - this.lastInteract < THEME.orbit.idle) return
    const k = 1 - Math.exp(-dt * 0.8)
    this.camera.position.lerp(this.home.position, k)
    this.controls.target.lerp(this.home.target, k)
  }

  // ================================================================ 交互

  _pick(e) {
    const rect = this.canvas.getBoundingClientRect()
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0]
    return hit?.object.userData.buildingKey || null
  }

  _onMove(e) {
    if (!this.buildings) return
    const key = this._pick(e)
    if (key === this.hovered) return
    if (this.hovered && this.hovered !== this.selected)
      this._setHighlight(this.hovered, 0)
    this.hovered = key
    if (key && key !== this.selected) this._setHighlight(key, 0.55)
    this.canvas.style.cursor = key ? "pointer" : ""
    this.onHover?.(key)
  }

  _onClick(e) {
    // 拖动旋转后松手不算点击
    if (
      this.downAt &&
      Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]) > 5
    )
      return
    if (!this.buildings) return
    this.select(this._pick(e))
  }

  /** 选中楼栋（null 取消选中） */
  select(key) {
    if (this.selected === key) return
    if (this.selected) this._setHighlight(this.selected, 0)
    this.selected = key
    if (key) this._setHighlight(key, 1)
    this.onPick?.(key)
  }

  _setHighlight(key, strength) {
    const b = this.buildings.get(key)
    if (!b) return
    if (!b.shell) {
      b.shell = createHighlightShell(
        b.obj,
        b.info.kind === "tower" ? THEME.highlight.tower : THEME.highlight.other
      )
      this.scene.add(b.shell)
    }
    b.shell.userData.material.uniforms.uStrength.value = strength
    b.shell.visible = strength > 0
    this.markers?.setActive(key, strength > 0)
  }

  /** 楼栋标签锚点在屏幕上的位置（给 Vue 的浮层卡片定位），画布内像素 */
  screenPos(key) {
    const b = this.buildings?.get(key)
    if (!b) return null
    const c = b.box.getCenter(new THREE.Vector3())
    c.y = b.box.max.y
    c.project(this.camera)
    return {
      x: (c.x * 0.5 + 0.5) * this.width,
      y: (-c.y * 0.5 + 0.5) * this.height
    }
  }

  // ================================================================ 循环

  resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.width = w
    this.height = h
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.bloom.setSize(w / 2, h / 2)
    this.labelRenderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    // 地灯点精灵的像素尺寸换算：设备像素高度 / (2·tan(fov/2))
    if (this.pathLights) {
      this.pathLights.material.uniforms.uScale.value =
        (h * this.renderer.getPixelRatio()) /
        (2 * Math.tan((this.camera.fov * DEG) / 2))
    }
    if (this.home) this._fitCamera()
  }

  _loop() {
    if (this.disposed) return
    const dt = Math.min(this.clock.getDelta(), 0.1)
    this.traffic?.update(dt)
    this.markers?.update(dt)
    if (this.pathLights) this.pathLights.material.uniforms.uTime.value += dt
    this.water?.update(dt)
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
    this.canvas.removeEventListener("pointerdown", this._onDown)
    this.canvas.removeEventListener("click", this._onClick)
    this.controls.dispose()
    this.traffic?.dispose()
    this.markers?.dispose()
    this.scene.traverse((o) => {
      if (o.isMesh || o.isSprite || o.isPoints) {
        o.geometry?.dispose()
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        for (const m of mats) {
          for (const v of Object.values(m)) if (v && v.isTexture) v.dispose()
          m.dispose()
        }
      }
    })
    this.envRT.dispose()
    this.composer.dispose()
    this.renderer.dispose()
  }
}

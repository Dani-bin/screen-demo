/*
 * 房间级三维场景：会议室剖切近景（设计稿 docs/design/building/04-ai-room.png、14-draft-room.png）
 * ----------------------------------------------------------
 *   - 房间壳体与家具：Blender 建模 + Cycles 烘焙（scripts/blender/tower/room.py → public/building/room.glb），MeshBasicMaterial 显示
 *   - 资产设备 dev_<编号>：带原材质导出，这里用实时光照（环境反射 + 灯光），可悬浮 / 点选 / 按分类筛选；
 *     每个设备头顶一根细线 + 圆形图标 + 名称标签（CSS2D），选中金色描边，告警红色
 *   - 半透明吊顶：深色网格面，透出吊顶内的空调、风管、喷淋管（设计稿的「透视吊顶」）
 *   - 窗外城市夜景、楼体下方几层幕墙、会议大屏画面：Canvas 程序贴图
 * 坐标：three (x, y, z) = Blender (x, z, -y)；房间 x ∈ [-6, 6]，z ∈ [-3.6, 3.6]（z 负为后墙），吊顶 y = 3。
 * 交互：悬浮设备 → onHover({ id, x, y } | null)；点击 → onPick(id | null)；select(id)、setCategory(cat)。
 */
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js"
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js"
import {
  CSS2DObject,
  CSS2DRenderer
} from "three/examples/jsm/renderers/CSS2DRenderer.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { createNightEnvironment } from "../park/env"

const DEG = Math.PI / 180
const CEIL = 3.0
const W = 12
const D = 7.2
const CR = 2.5 // 左前角圆角半径（与 room.py 一致）

/** 图标（24 × 24 线稿 SVG，stroke 用 currentColor） */
const ICONS = {
  snow: '<path d="M12 2v20M4 7l16 10M20 7L4 17M9 4l3 2 3-2M9 20l3-2 3 2"/>',
  flame:
    '<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-1 3-3 4-4 6-1-2-1-3-1-5-3 3-5 6-5 9 0 4 3 7 7 7z"/>',
  drop: '<path d="M12 3c3 5 6 8 6 12a6 6 0 0 1-12 0c0-4 3-7 6-12z"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10c1 1 1 2 1 3h6c0-1 0-2 1-3a6 6 0 0 0-4-10z"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0"/><circle cx="12" cy="20" r="1"/>',
  camera:
    '<path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/>',
  card: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6"/><circle cx="12" cy="17" r="1"/>',
  screen:
    '<rect x="2" y="4" width="20" height="13" rx="1"/><path d="M8 21h8M12 17v4"/>',
  thermo:
    '<path d="M10 4a2 2 0 0 1 4 0v10a4 4 0 1 1-4 0z"/><path d="M12 9v7"/>',
  plug: '<path d="M8 2v6M16 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
  switch:
    '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 7h4M10 12h4M10 17h4"/>'
}

/** 多部件设备的图标落点（three 的 x、z）：喷淋头是 4 个喷头一组，包围盒中心会和感烟探测器的图标挤在一起，取第一个喷头 */
const PIN_AT = {
  "SP-3205-01": [0.7, -0.8],
  // 会议大屏：标签放在屏幕左上角前方、压低一些，避开空调 AC-02 的图标
  "DS-3205-01": [0.1, -3.0, 2.55]
}

const COL = {
  cyan: new THREE.Color(0.2, 0.8, 1.0),
  gold: new THREE.Color(1.0, 0.72, 0.25),
  red: new THREE.Color(1.0, 0.25, 0.3)
}

export class RoomScene {
  /**
   * @param {Object} o
   * @param {HTMLCanvasElement} o.canvas
   * @param {HTMLElement} o.container
   * @param {HTMLElement} o.labelLayer
   * @param {Object} o.data data/room.js 的 roomDetail()
   * @param {string} o.modelUrl public/building/room.glb
   */
  constructor(o) {
    this.canvas = o.canvas
    this.container = o.container
    this.onHover = o.onHover
    this.onPick = o.onPick
    this.data = o.data
    this.selected = null
    this.hovered = null
    this.cat = "all"
    this.clock = new THREE.Clock()

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
    // 设备是实时光照：一盏柔和的半球光 + 从右前上方打来的主光 + 吊顶里一盏补光（照亮吊顶内的空调和风管）
    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x1a2230, 1.6))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(6, 10, 8)
    this.scene.add(key)
    const fill = new THREE.PointLight(0xbfd8ff, 18, 14, 1.4)
    fill.position.set(0, CEIL + 2.2, 1)
    this.scene.add(fill)

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 600)
    this.controls = new OrbitControls(this.camera, this.canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.enablePan = false
    this.controls.minPolarAngle = 45 * DEG
    this.controls.maxPolarAngle = 84 * DEG
    this.controls.minAzimuthAngle = -20 * DEG
    this.controls.maxAzimuthAngle = 75 * DEG

    this.labelRenderer = new CSS2DRenderer({ element: o.labelLayer })
    this.composer = new EffectComposer(
      r,
      new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        samples: 4
      })
    )
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.composer.addPass(
      new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.3, 0.9)
    )
    this.composer.addPass(new OutputPass())

    this._buildBackdrop()
    this._buildFacadeBelow()
    this._buildCeiling()

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
    this.ready = this._load(o.modelUrl)
  }

  // ================================================================ 加载

  async _load(url) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    const gltf = await loader.loadAsync(url)
    if (this.disposed) return
    const root = gltf.scene
    this.devices = new Map()
    const byModel = new Map(this.data.assets.map((a) => [a.model, a]))
    const nodes = []
    root.traverse((n) => nodes.push(n))
    for (const n of nodes) {
      if (n.name === "room" || n.name === "room_v") {
        // 烘焙部分：贴图 / 顶点色直接显示，不参与实时光照
        n.traverse((m) => {
          if (!m.isMesh) return
          const map = m.material.map || null
          if (map) map.anisotropy = 8
          m.material = new THREE.MeshBasicMaterial(
            map ? { map } : { vertexColors: true }
          )
        })
      } else if (n.name === "glass") {
        n.traverse((m) => {
          if (!m.isMesh) return
          m.material = new THREE.MeshPhysicalMaterial({
            color: 0x8fb4e0,
            metalness: 0,
            roughness: 0.05,
            transparent: true,
            opacity: 0.16,
            envMapIntensity: 1.2,
            side: THREE.DoubleSide,
            depthWrite: false
          })
          m.renderOrder = 3
        })
      } else if (n.name.startsWith("dev_")) {
        const asset = byModel.get(n.name.slice(4))
        if (!asset) continue
        // 每个设备一份独立材质（悬浮 / 选中 / 筛选时单独改自发光与透明度）
        const mats = []
        n.traverse((m) => {
          if (!m.isMesh) return
          const src = m.material
          const keepEmit = src.emissive && src.emissive.getHSL({}).l > 0.05
          m.material = src.clone()
          m.material.userData.baseEmissive = m.material.emissive.clone()
          m.material.userData.baseIntensity = keepEmit
            ? 1
            : m.material.emissiveIntensity
          m.material.transparent = true
          m.userData.assetId = asset.id
          mats.push(m.material)
        })
        this.devices.set(asset.id, { node: n, asset, mats })
      }
    }
    this.scene.add(root)
    this.model = root
    this._buildScreen()
    this._buildPins()
    this.hitTargets = []
    this.devices.forEach((d) =>
      d.node.traverse((m) => m.isMesh && this.hitTargets.push(m))
    )
    this._applyState(true)
  }

  // ================================================================ 背景与环境

  /** 窗外城市夜景：左侧到后方一段圆柱面，Canvas 画楼群剪影与灯窗，两端渐隐 */
  _buildBackdrop() {
    const c = document.createElement("canvas")
    c.width = 2048
    c.height = 512
    const g = c.getContext("2d")
    const sky = g.createLinearGradient(0, 0, 0, 512)
    sky.addColorStop(0, "#020815")
    sky.addColorStop(0.6, "#06173a")
    sky.addColorStop(1, "#0b2350")
    g.fillStyle = sky
    g.fillRect(0, 0, 2048, 512)
    const rnd = mulberry(11)
    // 三层楼群：远层矮而密、近层高而稀，越近越亮
    for (const [n, hmax, base, alpha] of [
      [140, 160, 420, 0.5],
      [90, 260, 470, 0.75],
      [50, 340, 512, 1]
    ]) {
      for (let i = 0; i < n; i++) {
        const w = 14 + rnd() * 46
        const x = rnd() * 2048
        const h = 40 + rnd() * hmax
        g.fillStyle = `rgba(6,14,32,${alpha})`
        g.fillRect(x, base - h, w, h)
        for (let wy = base - h + 6; wy < base - 4; wy += 7)
          for (let wx = x + 3; wx < x + w - 3; wx += 5) {
            if (rnd() > 0.42) continue
            const warm = rnd() < 0.6
            g.fillStyle = warm
              ? `rgba(255,${180 + rnd() * 50},${110 + rnd() * 40},${alpha * (0.5 + rnd() * 0.5)})`
              : `rgba(150,${190 + rnd() * 40},255,${alpha * (0.4 + rnd() * 0.5)})`
            g.fillRect(wx, wy, 2, 3)
          }
      }
    }
    // 一座发光的塔（设计稿窗外的地标塔）
    const tx = 560
    const tg = g.createLinearGradient(tx - 20, 0, tx + 20, 0)
    tg.addColorStop(0, "rgba(90,170,255,0)")
    tg.addColorStop(0.5, "rgba(140,210,255,0.95)")
    tg.addColorStop(1, "rgba(90,170,255,0)")
    g.fillStyle = tg
    g.beginPath()
    g.moveTo(tx, 40)
    g.lineTo(tx + 18, 512)
    g.lineTo(tx - 18, 512)
    g.closePath()
    g.fill()
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    // 圆柱面：以房间为圆心、半径 46 m，覆盖左侧到左后方（相机在右前方，看出去的方向）
    const geo = new THREE.CylinderGeometry(
      46,
      46,
      40,
      64,
      1,
      true,
      -Math.PI * 0.8,
      Math.PI * 0.5
    )
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      uniforms: { uMap: { value: tex } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      // 两端、上下渐隐到页面背景色
      fragmentShader: `uniform sampler2D uMap; varying vec2 vUv;
        void main(){ vec4 c = texture2D(uMap, vec2(1.0 - vUv.x, vUv.y));
          float a = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.6, vUv.x) * smoothstep(0.0, 0.3, vUv.y) * smoothstep(0.95, 0.6, vUv.y);
          gl_FragColor = vec4(c.rgb, a * 0.75); }`
    })
    const m = new THREE.Mesh(geo, mat)
    m.position.set(0, -12, 0)
    m.renderOrder = -1
    this.scene.add(m)
  }

  /** 楼体下方几层：沿左侧与圆角外立面往下的深色玻璃幕墙 + 零星灯窗，向下渐隐（设计稿房间下方的塔身） */
  _buildFacadeBelow() {
    // 只取外立面（左侧 + 圆角 + 前沿）：从左后角开始到右前角
    const pts = outlinePath()
    const rings = [-0.45, -16].map((y) => pts.map(([x, z]) => [x, y, z]))
    const geo = loft(rings)
    // 深色玻璃 + 每 3.8 m 一层、每 1.5 m 一格，按哈希点亮约一半窗格（暖白为主）；向下渐隐到背景
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; varying float vY; void main(){ vUv = uv; vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv; varying float vY;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main(){
          float fl = -vY / 3.8;
          vec2 cell = vec2(floor(vUv.x / 0.9), floor(fl));
          vec2 f = vec2(fract(vUv.x / 0.9), fract(fl));
          // 窗带只占层高中间 45%（上下是楼板与窗槛），竖梃每 1.5 m 一根
          float win = step(0.06, f.x) * step(f.x, 0.94) * step(0.3, f.y) * step(f.y, 0.75);
          float lit = step(h(cell), 0.32);
          vec3 warm = mix(vec3(1.0, 0.75, 0.45), vec3(0.75, 0.88, 1.0), step(0.8, h(cell + 7.3)));
          vec3 col = vec3(0.015, 0.035, 0.08) + win * (lit * warm * (0.07 + 0.1 * h(cell + 1.7)) + (1.0 - lit) * vec3(0.02, 0.05, 0.12));
          float a = smoothstep(-16.0, -2.0, vY);
          gl_FragColor = vec4(col, 0.95 * a);
        }`
    })
    this.scene.add(new THREE.Mesh(geo, mat))
    // 楼板外沿一道亮青色边
    const edge = new THREE.Mesh(
      loft(
        [-0.47, -0.4].map((y) => pts.map(([x, z]) => [x * 1.002, y, z * 1.002]))
      ),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.4, 1.0, 1.6),
        side: THREE.DoubleSide
      })
    )
    this.scene.add(edge)
  }

  /** 半透明吊顶：深色面板 + 0.6 m 网格线，透出吊顶内设备（设计稿的「透视吊顶」） */
  _buildCeiling() {
    const shape = new THREE.Shape(
      outlinePath(true).map(([x, z]) => new THREE.Vector2(x, -z))
    )
    const geo = new THREE.ShapeGeometry(shape)
    geo.rotateX(-Math.PI / 2)
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vP;
        float line(float t){ float fw = fwidth(t); return 1.0 - smoothstep(0.0, fw * 1.5, abs(fract(t + 0.5) - 0.5)); }
        void main(){
          float g = max(line(vP.x / 0.6), line(vP.z / 0.6));
          vec3 col = mix(vec3(0.03, 0.07, 0.14), vec3(0.35, 0.75, 1.0), g);
          gl_FragColor = vec4(col, 0.1 + g * 0.35);
        }`
    })
    const m = new THREE.Mesh(geo, mat)
    m.position.y = CEIL + 0.005
    m.renderOrder = 4
    this.scene.add(m)
    // 吊顶边缘一圈细亮线
    const pts = outlinePath(true).map(
      ([x, z]) => new THREE.Vector3(x, CEIL + 0.01, z)
    )
    pts.push(pts[0].clone())
    this.scene.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: new THREE.Color(0.4, 0.85, 1.3),
          transparent: true,
          opacity: 0.8
        })
      )
    )
  }

  /** 会议大屏画面：城市夜景 Canvas 贴在屏幕前 1 cm（与 room.py 的屏幕位置一致） */
  _buildScreen() {
    const c = document.createElement("canvas")
    c.width = 512
    c.height = 288
    const g = c.getContext("2d")
    const grd = g.createLinearGradient(0, 0, 0, 288)
    grd.addColorStop(0, "#071a46")
    grd.addColorStop(1, "#0f3d8f")
    g.fillStyle = grd
    g.fillRect(0, 0, 512, 288)
    const rnd = mulberry(23)
    for (let i = 0; i < 70; i++) {
      const w = 8 + rnd() * 26
      const x = rnd() * 512
      const h = 30 + rnd() * 170 * (1 - Math.abs(x - 256) / 400)
      g.fillStyle = `rgba(${40 + rnd() * 40},${120 + rnd() * 80},255,${0.5 + rnd() * 0.4})`
      g.fillRect(x, 230 - h, w, h)
    }
    g.fillStyle = "rgba(90,170,255,0.25)"
    g.fillRect(0, 232, 512, 56)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1.84, 1.02),
      new THREE.MeshBasicMaterial({ map: tex, color: 0xb0c4ff })
    )
    m.position.set(1.0, 1.55, -(D / 2 - 0.162))
    this.scene.add(m)
  }

  // ================================================================ 设备图标

  _buildPins() {
    this.pins = new Map()
    const box = new THREE.Box3()
    const stagger = [0, 0.35, 0.15, 0.5]
    let i = 0
    let w = 0
    this.devices.forEach((d, id) => {
      box.setFromObject(d.node)
      const c = box.getCenter(new THREE.Vector3())
      const top = box.max.y
      // 吊顶设备：图标在吊顶上方；墙面设备：图标在设备正上方、离墙 0.3 m
      const at = PIN_AT[d.asset.model]
      if (at) c.set(at[0], c.y, at[1])
      const ceiling = c.y > CEIL - 0.3
      const pinY = at?.[2]
      const anchor = ceiling
        ? new THREE.Vector3(c.x, CEIL + 1.0 + stagger[i++ % 4], c.z)
        : pinY
          ? new THREE.Vector3(c.x, pinY, c.z)
          : new THREE.Vector3(
              c.x - (c.x > W / 2 - 0.2 ? 0.35 : 0),
              // 墙面设备扎堆（温湿度、灯控、插座、门禁）：图标高度错开
              top + 0.4 + [0, 0.5, 0.25, 0.75][w++ % 4],
              c.z + (c.z < -D / 2 + 0.3 ? 0.35 : 0)
            )
      const start = new THREE.Vector3(c.x, top, c.z)
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([start, anchor]),
        new THREE.LineBasicMaterial({
          color: COL.cyan,
          transparent: true,
          opacity: 0.7,
          depthWrite: false
        })
      )
      this.scene.add(line)
      const el = document.createElement("div")
      el.className = "rm-pin"
      const a = d.asset
      el.innerHTML = `${a.hideLabel ? "" : `<div class="tag">${a.short}${a.level === "warn" ? ` · <em>${a.status}</em>` : ` <em>${a.reading}</em>`}</div>`}<i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[a.icon] || ""}</svg></i>`
      el.addEventListener("click", (e) => {
        e.stopPropagation()
        this.onPick?.(id)
      })
      el.addEventListener("mouseenter", () => this._setHover(id))
      el.addEventListener("mouseleave", () => this._setHover(null))
      const obj = new CSS2DObject(el)
      obj.position.copy(anchor)
      this.scene.add(obj)
      // 选中描边：设备包围盒外扩 4 cm 的 12 条棱
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(
          new THREE.BoxGeometry(
            box.max.x - box.min.x + 0.08,
            box.max.y - box.min.y + 0.08,
            box.max.z - box.min.z + 0.08
          )
        ),
        new THREE.LineBasicMaterial({
          color: COL.gold.clone().multiplyScalar(1.6),
          transparent: true,
          opacity: 0,
          depthTest: false
        })
      )
      outline.position.copy(c)
      outline.renderOrder = 8
      this.scene.add(outline)
      this.pins.set(id, { el, obj, line, outline })
    })
  }

  // ================================================================ 状态

  select(id) {
    this.selected = id
    this._applyState()
  }

  setCategory(cat) {
    this.cat = cat
    this._applyState()
  }

  /** 按选中 / 悬浮 / 分类刷新设备的自发光、透明度和图标样式 */
  _applyState() {
    if (!this.devices) return
    this.devices.forEach((d, id) => {
      const a = d.asset
      const inCat = this.cat === "all" || a.cat === this.cat
      const sel = id === this.selected
      const hov = id === this.hovered
      const tint = sel
        ? COL.gold
        : a.level === "warn"
          ? COL.red
          : hov
            ? COL.cyan
            : null
      for (const m of d.mats) {
        m.opacity = inCat ? 1 : 0.18
        m.depthWrite = inCat
        if (tint) {
          m.emissive.copy(tint)
          m.emissiveIntensity = sel ? 0.16 : hov ? 0.22 : 0.2
        } else {
          m.emissive.copy(m.userData.baseEmissive)
          m.emissiveIntensity = m.userData.baseIntensity
        }
      }
      const p = this.pins?.get(id)
      if (!p) return
      p.el.classList.toggle("sel", sel)
      p.el.classList.toggle("hov", hov && !sel)
      p.el.classList.toggle("warn", a.level === "warn" && !sel)
      p.el.classList.toggle("dim", !inCat)
      p.obj.visible = inCat
      p.line.visible = inCat
      p.line.material.color.copy(
        sel ? COL.gold : a.level === "warn" ? COL.red : COL.cyan
      )
      p.outline.material.opacity = sel ? 1 : hov ? 0.6 : 0
      p.outline.material.color
        .copy(sel ? COL.gold : COL.cyan)
        .multiplyScalar(1.6)
    })
  }

  _setHover(id) {
    if (id === this.hovered) return
    this.hovered = id
    this.canvas.style.cursor = id ? "pointer" : ""
    if (!id) this.onHover?.(null)
    this._applyState()
  }

  _pick(e) {
    if (!this.hitTargets) return null
    const rect = this.canvas.getBoundingClientRect()
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.hitTargets, false)
    // 被筛掉（半透明）的设备不可点
    const hit = hits.find((h) => {
      const d = this.devices.get(h.object.userData.assetId)
      return this.cat === "all" || d.asset.cat === this.cat
    })
    if (!hit) return null
    return {
      id: hit.object.userData.assetId,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    }
  }

  _onMove(e) {
    const p = this._pick(e)
    this._setHover(p?.id || null)
    if (p) this.onHover?.(p)
  }

  _onClick(e) {
    if (
      this.downAt &&
      Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]) > 5
    )
      return
    const p = this._pick(e)
    this.onPick?.(p ? p.id : null)
  }

  // ================================================================ 相机 / 渲染

  /** 设计稿视角：从右前上方看进房间（后墙大屏在画面中间偏右，左侧是玻璃幕墙与窗外城市） */
  _fitCamera() {
    const target = new THREE.Vector3(0.6, 1.9, -0.6)
    const fov = this.camera.fov * DEG
    // 房间宽 12 m 占画面中间约 52%（两侧是面板）；仰角低（略高于吊顶往里看），吊顶与室内都看得见
    const dist = (W * 0.5) / Math.tan(fov / 2) / 0.52 / this.camera.aspect + 3
    const az = 30 * DEG
    const el = 20 * DEG
    this.camera.position.set(
      target.x + dist * Math.cos(el) * Math.sin(az),
      target.y + dist * Math.sin(el),
      target.z + dist * Math.cos(el) * Math.cos(az)
    )
    this.controls.target.copy(target)
    this.controls.minDistance = dist * 0.45
    this.controls.maxDistance = dist * 1.3
    this.controls.update()
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

  _loop() {
    if (this.disposed) return
    const t = this.clock.getElapsedTime()
    // 告警设备（感烟探测器电量低）：红色自发光呼吸
    if (this.devices)
      this.devices.forEach((d, id) => {
        if (d.asset.level !== "warn" || id === this.selected) return
        const k = 0.15 + 0.2 * (0.5 + 0.5 * Math.sin(t * 4))
        for (const m of d.mats) m.emissiveIntensity = k
      })
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
    this.scene.traverse((o) => {
      o.geometry?.dispose()
      const mats = Array.isArray(o.material)
        ? o.material
        : o.material
          ? [o.material]
          : []
      for (const m of mats) {
        for (const v of Object.values(m)) if (v && v.isTexture) v.dispose()
        m.uniforms?.uMap?.value?.dispose()
        m.dispose()
      }
    })
    this.labelRenderer.domElement.innerHTML = ""
    this.envRT.dispose()
    this.composer.dispose()
    this.renderer.dispose()
  }
}

/**
 * 房间轮廓（three 的 x、z；与 room.py 的 outline 一致）。
 * full=false：只取外立面一段（左后角 → 左侧 → 左前圆角 → 前沿 → 右前角），给楼体下方的幕墙用；full=true：闭合的整圈
 */
function outlinePath(full = false) {
  const x0 = -W / 2
  const x1 = W / 2
  const zf = D / 2 // 前沿（three z 正为前方）
  const zb = -D / 2
  const pts = full
    ? [
        [x1, zf],
        [x1, zb],
        [x0, zb]
      ]
    : [[x0, zb]]
  pts.push([x0, zf - CR])
  const cx = x0 + CR
  const cz = zf - CR
  for (let k = 1; k < 15; k++) {
    const t = Math.PI + (k / 15) * (Math.PI / 2)
    pts.push([cx + CR * Math.cos(t), cz - CR * Math.sin(t)])
  }
  pts.push([x0 + CR, zf])
  if (!full) pts.push([x1, zf])
  return pts
}

/** 开放折线放样（每圈点数相同），uv.x 为沿线累计长度 */
function loft(rings) {
  const n = rings[0].length
  const us = [0]
  for (let i = 1; i < n; i++) {
    const a = rings[0][i - 1]
    const b = rings[0][i]
    us.push(us[i - 1] + Math.hypot(b[0] - a[0], b[2] - a[2]))
  }
  const pos = []
  const uv = []
  for (const ring of rings)
    for (let i = 0; i < n; i++) {
      pos.push(...ring[i])
      uv.push(us[i], ring[i][1])
    }
  const idx = []
  for (let k = 0; k < rings.length - 1; k++)
    for (let i = 0; i < n - 1; i++) {
      const a = k * n + i
      idx.push(a, a + 1, a + n + 1, a, a + n + 1, a + n)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

function mulberry(seed) {
  let s = seed
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

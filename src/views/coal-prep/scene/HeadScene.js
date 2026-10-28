/*
 * 103 机头三维场景（不依赖 Vue）
 * ----------------------------------------------------------
 * - 模型：public/coal-prep/conveyor.glb（Blender 脚本建模，见 scripts/blender/coal_prep/），
 *   静态件按 extras.lightmap 挂 Cycles 烘焙的光照图（UV channel 1）；会动的件用实时光照 + 天空环境图
 * - 主机位：定稿概念图反求的相机（theme.CAMERA），画布只显示概念图裁掉顶部 70 px 后的部分（setViewOffset）
 * - 数据驱动（setState 每秒一次）：带速 → 输送带 / 煤贴图滚动、两只驱动滚筒转速、落煤粒子；
 *   光纤测温 → 纵梁上的色带；机器人里程 → RB01 位置；劣化托辊组 → 平台预警光圈
 * - 标签：anchors() 返回各部件在设计稿场景框（1024 × 529）里的像素位置，页面据此摆 DOM 标签
 * - 拾取：点电机 / 减速机 / 轴承座 → onPick(设备编号)，选中件描一层青色自发光
 * 渲染：Neutral 色调映射只在 OutputPass 做一次；辉光只给灯具（阈值 1）。
 */
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import {
  BELT,
  CAMERA,
  LEVEL_COLOR,
  LIGHTMAP,
  SKY,
  TOKENS,
  idlerMileage,
  tempColor
} from "./theme.js"

const BASE = import.meta.env.BASE_URL
const DEG = Math.PI / 180
/** 设计稿里场景框的尺寸（设计像素） */
export const SCENE_BOX = { w: 1024, h: 529 }
/** 可拾取的设备（GLB 根节点名） */
const PICKABLE = ["BC103-M1", "BC103-M2", "BC103-G1", "BC103-G2", "BC103-D1"]

export class HeadScene {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} o
   * @param {(id: string|null) => void} [o.onPick]
   * @param {() => number} [o.scale] 舞台缩放系数（舞台用 transform: scale 缩放，画布的 CSS 尺寸不变，渲染分辨率要跟着放大）
   */
  constructor(canvas, { onPick, scale } = {}) {
    this.canvas = canvas
    this.onPick = onPick || (() => {})
    this.scaleFn = scale || (() => 1)
    this.state = null
    this.frozen = false
    this.layers = {
      sensors: true,
      dts: true,
      idlers: true,
      robot: true,
      alarm: true
    }
    this.selected = null

    const r = (this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance"
    }))
    r.setPixelRatio(Math.min(2, window.devicePixelRatio))
    r.outputColorSpace = THREE.SRGBColorSpace
    // 色调映射交给 OutputPass（只做一次）
    r.toneMapping = THREE.NeutralToneMapping
    r.toneMappingExposure = 1.6 // 第 7 轮评审：整体比定稿暗约 20 %；第 12 轮配合场地灯 / 图集增益回调

    const scene = (this.scene = new THREE.Scene())
    this.camera = new THREE.PerspectiveCamera(
      CAMERA.fov,
      CAMERA.image[0] / CAMERA.image[1],
      0.1,
      4000
    )
    this.home = {
      position: new THREE.Vector3(...CAMERA.position),
      target: new THREE.Vector3(...CAMERA.target),
      up: new THREE.Vector3(...CAMERA.up)
    }
    // 标定相机的目标点在 30 m 外；控制器的旋转中心放在机头附近，拖动时绕驱动部转
    this.pivot = new THREE.Vector3(-2, 1.4, 0)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = 2.5
    this.controls.maxDistance = 30
    this.controls.maxPolarAngle = 88 * DEG
    this.controls.addEventListener("start", () => (this.userMoved = true))
    this.goHome()

    this._buildSky()
    this._buildLights()
    this._buildEffects()

    // 后处理：渲染 → 辉光（只给灯具）→ 输出（色调映射 + sRGB）
    this.composer = new EffectComposer(
      r,
      new THREE.WebGLRenderTarget(1, 1, {
        samples: 4,
        type: THREE.HalfFloatType
      })
    )
    this.composer.addPass(new RenderPass(scene, this.camera))
    // GTAO：托辊、滚筒、驱动部这些没烘焙的件和结构之间的接触暗部（第 5 轮评审：物体像飘在空中）
    this.gtao = new GTAOPass(scene, this.camera, 1, 1)
    this.gtao.output = GTAOPass.OUTPUT.Default
    this.gtao.blendIntensity = 1
    this.gtao.updateGtaoMaterial({
      radius: 0.8,
      distanceExponent: 1.4,
      thickness: 0.6,
      scale: 1.0,
      samples: 16
    })
    this.gtao.updatePdMaterial({
      lumaPhi: 10,
      depthPhi: 2,
      normalPhi: 3,
      radius: 4,
      rings: 2,
      samples: 16
    })
    this.composer.addPass(this.gtao)
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(512, 256),
      0.5,
      0.35,
      1.0
    )
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.clock = new THREE.Clock()
    this.ready = this._load()
    this._onClick = (e) => this._pick(e)
    canvas.addEventListener("click", this._onClick)
    this._onVis = () => this.clock.getDelta()
    document.addEventListener("visibilitychange", this._onVis)
    this.resize()
    this._loop = this._loop.bind(this)
    this._raf = requestAnimationFrame(this._loop)
  }

  /* ---------------- 天空、灯光 ---------------- */

  /** 天空：按视线高度从地平线橙到天顶深蓝，太阳方位附近更亮；同一份天空生成环境图给金属反射 */
  _buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uZenith: { value: new THREE.Color(SKY.zenith) },
        uMid: { value: new THREE.Color(SKY.mid) },
        uGlow: { value: new THREE.Color(SKY.glow) },
        uHorizon: { value: new THREE.Color(SKY.horizon) },
        uSun: { value: this._sunDir() }
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 uZenith, uMid, uGlow, uHorizon, uSun; varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
        float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int k = 0; k < 5; k++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
        void main(){
          float h = clamp(vDir.y, -0.2, 1.0);
          float sun = pow(max(dot(normalize(vec3(vDir.x, 0.0, vDir.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0), 3.0);
          vec3 c = mix(uHorizon, uGlow, smoothstep(0.0, 0.018, h));
          c = mix(c, uMid, smoothstep(0.015, 0.06, h));
          c = mix(c, uZenith, smoothstep(0.08, 0.3, h));
          // 太阳一侧的地平线更亮更橙
          c += uHorizon * sun * (1.0 - smoothstep(0.0, 0.08, h)) * 0.7;
          // 黄昏云带：横向拉长的 fbm 噪声，只在地平线上方 2°–25° 一段；
          // 云底被夕阳照成暖橙（越靠近地平线、越朝太阳越暖），云顶是暗蓝灰（第 5 轮评审：天空太平）
          vec2 uv = vec2(atan(vDir.z, vDir.x) * 2.2, h * 26.0);
          float cl = smoothstep(0.48, 0.78, fbm(uv * vec2(1.0, 1.0) + vec2(0.0, 3.1)));
          cl *= smoothstep(0.03, 0.08, h) * (1.0 - smoothstep(0.22, 0.42, h));
          vec3 cloud = mix(vec3(0.16, 0.17, 0.26), uGlow * 1.25 + uHorizon * 0.25 * sun, 1.0 - smoothstep(0.04, 0.2, h));
          c = mix(c, cloud, cl * 0.75);
          // 地平线以下：远处厂区的暗色
          c = mix(c, vec3(0.03, 0.03, 0.04), smoothstep(0.0, -0.08, h));
          gl_FragColor = vec4(c, 1.0);
        }`
    })
    const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), mat)
    sky.frustumCulled = false
    this.scene.add(sky)
    // 环境图：只有天空的场景生成 PMREM
    const pm = new THREE.PMREMGenerator(this.renderer)
    const envScene = new THREE.Scene()
    envScene.add(
      new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat.clone())
    )
    this.scene.environment = pm.fromScene(envScene, 0.02).texture
    this.scene.environmentIntensity = 0.6
    pm.dispose()
  }

  _sunDir() {
    // Blender 方位 az（从 +x 向 +y）→ three.js：x = cos az，z = −sin az
    const az = SKY.sunAz * DEG
    const el = SKY.sunEl * DEG
    return new THREE.Vector3(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      -Math.cos(el) * Math.sin(az)
    )
  }

  /** 实时光：给会动的件（皮带、煤、滚筒、托辊、机器人）照明；静态件的光照主要来自光照图 */
  _buildLights() {
    const s = this.scene
    // 半球光用中性灰（偏蓝的天光会把降低金属度后的灰钢染成紫色）
    s.add(new THREE.HemisphereLight("#9aa6c4", "#34363c", 0.45))
    // 夕阳：从驱动侧偏机尾、低角度照来，给驱动部和筒仓勾暖色轮廓
    const sun = new THREE.DirectionalLight("#ffbe8c", 0.9)
    sun.position.copy(this._sunDir().multiplyScalar(80))
    s.add(sun)
    // 天光补光：从镜头一侧打过来的冷色光，让背光的远景筒仓和结构正面可读
    const fill = new THREE.DirectionalLight("#9db4e6", 0.85) // 冷色补光：设计稿暗部有一层紫蓝天光（第 9 轮评审：整片发棕）
    fill.position.set(60, 30, 70)
    s.add(fill)
    // 场地投光灯（Blender lights.py 的 L_yard_L / L_yard_R）：照亮栈桥下方的地面和桁架
    for (const [x, y, z, e] of [
      [-16, -5, 7.5, 60],
      [2.5, -1.2, -5.2, 40],
      // 栈桥左下方的场地灯：定稿左下是被灯照亮的地面和下层钢结构（第 9 轮评审：左下一片黑、明暗方向反了）
      [-7, -4.5, 7, 200]
    ]) {
      // 场地灯颜色偏白一些（纯橙会让整屏又偏棕）
      const p = new THREE.PointLight("#ffdcb8", e, 26, 1.5)
      p.position.set(x, y, z)
      s.add(p)
    }
    // 栈桥灯（与 Blender lights.py 的面光同位置）：镜头附近 4 盏暖白点光
    for (const x of [-0.5, -3, -9, -15]) {
      // 偏白的暖光（整屏不要偏棕）；机头那盏正对驱动部，压到 3，否则电机上的条状高光像霓虹（第 11 轮评审）
      const p = new THREE.PointLight("#ffe8d2", x > -1 ? 3 : 8, 12, 1.6)
      p.position.set(x, x < -4 ? 3.34 : 4.42, -0.4)
      s.add(p)
    }
  }

  /* ---------------- 模型 ---------------- */

  async _load() {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    const texLoader = new THREE.TextureLoader()
    const [gltf, ...lms] = await Promise.all([
      loader.loadAsync(`${BASE}coal-prep/conveyor.glb`),
      ...Object.values(LIGHTMAP.files).map((f) =>
        texLoader.loadAsync(`${BASE}coal-prep/${f}`)
      )
    ])
    const lmByName = {}
    Object.keys(LIGHTMAP.files).forEach((k, i) => {
      const t = lms[i]
      t.flipY = false
      t.channel = 1
      t.colorSpace = THREE.SRGBColorSpace
      lmByName[k] = t
    })
    const root = (this.model = gltf.scene)
    this.scene.add(root)

    // 静态件挂光照图：按（原材质, 图集）克隆一份材质，避免影响没烘焙的同材质物体
    const cache = new Map()
    root.traverse((o) => {
      if (!o.isMesh) return
      // 多材质物体导出成"父节点 + 每个材质一个子网格"，extras 在父节点上
      const key = o.userData.lightmap ?? o.parent?.userData.lightmap
      const lm = lmByName[key]
      if (!lm) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      const out = mats.map((m) => {
        const ck = `${m.uuid}|${key}`
        if (!cache.has(ck)) {
          const c = m.clone()
          c.lightMap = lm
          c.lightMapIntensity = LIGHTMAP.intensity * (LIGHTMAP.gain[key] ?? 1)
          c.onBeforeCompile = (sh) => {
            sh.fragmentShader = sh.fragmentShader.replace(
              "#include <lights_fragment_end>",
              `#include <lights_fragment_end>
              reflectedLight.directDiffuse *= ${LIGHTMAP.directDiffuse.toFixed(2)};`
            )
          }
          c.customProgramCacheKey = () => "baked"
          cache.set(ck, c)
        }
        return cache.get(ck)
      })
      o.material = Array.isArray(o.material) ? out : out[0]
    })

    // 按名字找要驱动的节点（找不到直接报错，避免静默失效）
    const need = (n) => {
      const o = root.getObjectByName(n)
      if (!o) throw new Error(`模型里找不到节点 ${n}`)
      return o
    }
    this.p1 = need("BC103-P1")
    this.p2 = need("BC103-P2")
    // 滚筒端板：镀锌件在近处灯下太亮，成了画面中央一块浅灰圆盘；定稿里滚筒端部是深色钢件
    const drumEnd = new Map()
    for (const p of [this.p1, this.p2])
      p.traverse((o) => {
        if (!o.isMesh || o.material.name !== "M_galv") return
        if (!drumEnd.has(o.material))
          drumEnd.set(
            o.material,
            Object.assign(o.material.clone(), {
              color: new THREE.Color("#3e434a"),
              metalness: 0.5,
              roughness: 0.45
            })
          )
        o.material = drumEnd.get(o.material)
      })
    this.robot = need("RB01")
    this.robotY = this.robot.position.y
    this.robotZ = this.robot.position.z
    this.devices = Object.fromEntries(PICKABLE.map((id) => [id, need(id)]))

    // 输送带、煤：克隆材质，贴图按带速滚动
    const belt = need("BC103-belt")
    belt.material = belt.material.clone()
    this.beltMap = belt.material.map
    const coal = need("BC103-coal")
    coal.material = coal.material.clone()
    this.coalMap = coal.material.map
    // 煤面起伏：同一张贴图当凹凸贴图（随带速一起滚动），亮块处鼓起、带高光（评审：煤像一张平铺的毯子）
    coal.material.bumpMap = this.coalMap
    coal.material.bumpScale = 1.6
    coal.material.roughness = 0.5 // 粗糙度太低会像揉皱的锡箔（第 9 轮评审），太高又像灰色碎石（第 10 轮）
    coal.material.metalness = 0.2
    coal.material.color.setScalar(0.55) // 贴图乘暗：近黑的块煤
    for (const t of [this.beltMap, this.coalMap]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.needsUpdate = true
    }

    // 光纤测温条：248 × 1 的温度色贴图（UV 的 u = 里程 / 248）
    const fiber = need("BC103-fiber")
    this.dtsData = new Uint8Array(248 * 4)
    this.dtsTex = new THREE.DataTexture(this.dtsData, 248, 1, THREE.RGBAFormat)
    this.dtsTex.colorSpace = THREE.SRGBColorSpace
    this.dtsTex.magFilter = THREE.LinearFilter
    fiber.material = new THREE.MeshBasicMaterial({
      map: this.dtsTex,
      toneMapped: false
    })
    this.fiber = fiber
    this._buildLayers()

    // 灯具发光面：亮度超过辉光阈值
    root.traverse((o) => {
      if (!o.isMesh) return
      const m = o.material
      if (m?.name === "M_lamp") {
        m.emissiveIntensity = 8
        m.toneMapped = false
      }
      // 远处厂区灯点：太亮会像一片星空（第 6 轮评审）
      if (m?.name === "M_window") m.emissiveIntensity = 1.6
      // 远景混凝土筒仓：暮色里被厂区泛光照着，加一点自发光（同一张贴图）让轮廓和明暗可读
      if (m?.name === "M_concrete" && !m.userData.lit) {
        m.emissive = new THREE.Color("#b4b9c2")
        m.emissiveMap = m.map
        m.emissiveIntensity = 0.32
        m.userData.lit = true
      }
    })
    // 传感器白盒（图层"测点"）
    this.sensors = []
    root.traverse((o) => {
      if (/^VT-103|^ES-103/.test(o.name)) this.sensors.push(o)
    })

    // 拾取用：设备编号 ← 网格
    this.pickMeshes = []
    for (const [id, node] of Object.entries(this.devices)) {
      node.traverse((o) => {
        if (o.isMesh) {
          o.userData.device = id
          this.pickMeshes.push(o)
        }
      })
    }
    if (this.state) this.setState(this.state)
    return true
  }

  /** 平台预警光圈、落煤粒子 */
  _buildEffects() {
    // 劣化托辊组的平台预警：两圈扩散环 + 中心发光点（位置在 setState 里按组号摆）
    const g = (this.hot = new THREE.Group())
    const ringGeo = new THREE.RingGeometry(0.55, 0.62, 48)
    this.rings = [0, 1].map(() => {
      const m = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(TOKENS.platform).multiplyScalar(2),
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false
        })
      )
      m.rotation.y = Math.PI / 2 // 环面竖立、垂直于皮带走向
      g.add(m)
      return m
    })
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 16, 8),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(TOKENS.l2).multiplyScalar(3),
        toneMapped: false
      })
    )
    g.add(core)
    g.visible = false
    this.scene.add(g)

    // 落煤：从 1# 滚筒前方抛出、落进头部漏斗的煤块。用实例化的不规则小块（二十面体压扁 + 随机大小 / 朝向），
    // 原来的方形点精灵在近景里像像素点（第 5 轮评审）
    const N = 220
    this.coalSeed = Array.from({ length: N }, (_, i) => ({
      t: i / N,
      z: (Math.sin(i * 12.9) * 0.5 + 0.5 - 0.5) * 0.9,
      k: 0.7 + ((i * 7919) % 100) / 300,
      s: 0.012 + ((i * 2671) % 100) / 4000, // 块径 1.2–3.7 cm（评审：再大就像几十厘米的石块）
      r: new THREE.Euler(i * 1.3, i * 2.1, i * 0.7)
    }))
    const chunk = new THREE.IcosahedronGeometry(1, 0)
    chunk.scale(1, 0.7, 0.85)
    this.falling = new THREE.InstancedMesh(
      chunk,
      new THREE.MeshStandardMaterial({
        color: "#1d1c1b",
        roughness: 0.35,
        metalness: 0.3,
        flatShading: true
      }),
      N
    )
    this.falling.frustumCulled = false
    this.scene.add(this.falling)
  }

  /**
   * 图层的三维表现（模型里只有 3 cm 宽的光纤条，主机位下看不出来，所以另外画）：
   * - 光纤测温：沿近侧纵梁的发光色带（11 cm 高，颜色 × 2 进辉光），贴图和模型光纤共用温度贴图
   * - 托辊健康：每组托辊近侧立架顶上一颗状态灯（正常绿、异常按等级着色并放大）
   * - 人员：巡检通道上的检修人员（UWB 定位标签 + 安全帽），人数取仿真的栈桥内人员
   */
  _buildLayers() {
    const len = 110 - 0.6 // 模型从机头后 0.6 m 建到 110 m
    const band = new THREE.PlaneGeometry(len, 0.11)
    // 平面默认 u 从左（机尾端 x = −110）到右（x = −0.6）；换成 u = 里程 / 248
    const uv = band.attributes.uv
    for (let i = 0; i < uv.count; i++)
      uv.setX(i, (0.6 + (1 - uv.getX(i)) * len) / 248)
    this.dtsBand = new THREE.Mesh(
      band,
      new THREE.MeshBasicMaterial({
        map: this.dtsTex,
        color: new THREE.Color(2, 2, 2),
        toneMapped: false
      })
    )
    // 近侧纵梁外侧（Blender y = −0.95 − 0.035），略往镜头一侧让开模型里的光纤条
    this.dtsBand.position.set(-0.6 - len / 2, 1.015, 1.0)
    this.scene.add(this.dtsBand)

    // 托辊状态灯：实例化小球，位置在近侧立架顶（Blender y = −0.95、z ≈ 1.66）
    const n = Math.floor(110 / BELT.pitch)
    this.idlerMarks = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.045, 12, 8),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      n
    )
    this.idlerMarks.userData.n = n
    this.scene.add(this.idlerMarks)

    // 人员：胶囊身体 + 橙色安全帽 + 胸前 UWB 标签的青色光圈
    this.people = new THREE.Group()
    const body = new THREE.MeshStandardMaterial({
      color: "#2d5fa8",
      roughness: 0.7
    })
    const hat = new THREE.MeshStandardMaterial({
      color: "#f97316",
      roughness: 0.4
    })
    const tag = new THREE.MeshBasicMaterial({
      color: new THREE.Color(TOKENS.brand).multiplyScalar(2),
      toneMapped: false,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    })
    // 巡检通道中线（Blender y = −1.6 → three z = 1.6），地面高 0.6
    for (const m of [6.5, 15, 27, 48]) {
      const g = new THREE.Group()
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.9, 4, 12), body)
      b.position.y = 0.65
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 8), hat)
      h.position.y = 1.42
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.42, 32), tag)
      ring.rotation.x = -Math.PI / 2
      ring.position.y = 0.03
      g.add(b, h, ring)
      g.position.set(-m, 0.6, 1.6)
      g.userData.ring = ring
      this.people.add(g)
    }
    this.scene.add(this.people)
  }

  /* ---------------- 数据 ---------------- */

  /** 每秒一次：仿真快照 + 派生值（board） */
  setState(st) {
    this.state = st
    if (!this.model) return
    const s = st.s
    // 光纤测温色带
    const c = new THREE.Color()
    for (let m = 0; m < 248; m++) {
      tempColor(THREE, s.dts[m], st.dts.refMean, c)
      this.dtsData[m * 4] = Math.round(c.r * 255)
      this.dtsData[m * 4 + 1] = Math.round(c.g * 255)
      this.dtsData[m * 4 + 2] = Math.round(c.b * 255)
      this.dtsData[m * 4 + 3] = 255
    }
    this.dtsTex.needsUpdate = true
    // 托辊状态灯：正常组小而暗的绿灯（不抢画面），异常组按等级着色、放大、进辉光
    const marks = this.idlerMarks
    const issueLv = new Map(st.issues.map((i) => [i.group, i.level]))
    const m4 = new THREE.Matrix4()
    const col = new THREE.Color()
    for (let g = 1; g <= marks.userData.n; g++) {
      const l = issueLv.get(g)
      const k = l ? 1.4 : 0.7
      m4.makeScale(k, k, k).setPosition(-idlerMileage(g), 1.7, 0.95)
      marks.setMatrixAt(g - 1, m4)
      col.set(l ? LEVEL_COLOR[l] : TOKENS.ok).multiplyScalar(l ? 1.3 : 0.75)
      marks.setColorAt(g - 1, col)
    }
    marks.instanceMatrix.needsUpdate = true
    marks.instanceColor.needsUpdate = true
    // 人员：按栈桥内人数显示前几位
    this.people.children.forEach(
      (p, i) => (p.visible = i < (s.people?.inGallery ?? 0))
    )
    // 平台预警光圈：放在劣化托辊组的位置（模型只建到 110 m）
    const lv = s.idler35.level
    if (lv && lv <= 3) {
      const x = -idlerMileage(s.idler35.group)
      this.hot.position.set(x, BELT.carryY + 0.25, 0)
      this.hot.visible = this.layers.alarm
    } else this.hot.visible = false
    this.robotTarget = s.robot.at
  }

  setLayer(key, on) {
    this.layers[key] = on
    if (!this.model) return
    if (key === "dts") this.fiber.visible = this.dtsBand.visible = on
    if (key === "idlers") this.idlerMarks.visible = on
    if (key === "people") this.people.visible = on
    if (key === "robot") this.robot.visible = on
    if (key === "sensors") for (const o of this.sensors) o.visible = on
    if (key === "alarm") this.hot.visible = on && !!this.state?.s.idler35.level
  }

  /** 选中设备：青色自发光描一层（材质先克隆，避免同材质的其他设备一起亮） */
  select(id) {
    if (this.selected) this._tint(this.selected, false)
    this.selected = id && this.devices?.[id] ? id : null
    if (this.selected) this._tint(this.selected, true)
  }

  _tint(id, on) {
    this.devices[id].traverse((o) => {
      if (!o.isMesh) return
      if (!o.userData.baseMat) {
        o.userData.baseMat = o.material
        o.userData.hiMat = o.material.clone()
        o.userData.hiMat.emissive = new THREE.Color(TOKENS.brand)
        o.userData.hiMat.emissiveIntensity = 0.35
      }
      o.material = on ? o.userData.hiMat : o.userData.baseMat
    })
  }

  _pick(e) {
    if (!this.pickMeshes) return
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, this.camera)
    const hit = ray.intersectObjects(this.pickMeshes, false)[0]
    this.onPick(hit ? hit.object.userData.device : null)
  }

  /* ---------------- 标签锚点 ---------------- */

  /** 各部件锚点（three.js 坐标），投影到设计稿场景框像素；home 是同一批锚点在主机位下的位置（页面据此把标签摆到定稿位置） */
  anchors() {
    const pts = {
      // 电机锚在机壳顶部（轴线 + 半径 0.48）；M1 在 1# 驱动组后上方的抬高平台上（layout.py 的 G1_X / G1_Z）
      M1: [-1.15, 2.55, -3.3],
      M2: [0, 1.9, -3.3],
      G2: [0, 1.4, -1.72],
      D1: [0, 1.62, 0.98],
      chute: [0.9, 0.7, 0.85],
      estop: [-3.0, 1.35, 1.08],
      fiber: [-7, 1.02, 0.99],
      hot: this.hot.visible ? this.hot.position.toArray() : null,
      robot: this.robot
        ? [
            this.robot.position.x,
            this.robot.position.y - 0.6,
            this.robot.position.z
          ]
        : null
    }
    const out = this._project(pts, this.camera)
    // 主机位投影只算一次（相机投影参数在 resize 里定好以后）
    if (!this._homeAnchors && this.model) {
      const cam = this.camera.clone()
      cam.position.copy(this.home.position)
      cam.up.copy(this.home.up)
      cam.lookAt(this.home.target)
      cam.updateMatrixWorld()
      this._homeAnchors = this._project(pts, cam)
    }
    out.home = this._homeAnchors || {}
    // 平台预警热点出了画面（镜头拖走 / 飞走时）就钉在画面边缘，off 标记给页面画箭头
    const h = out.hot
    if (h && !(h.visible && h.x > 0 && h.x < SCENE_BOX.w && h.y > 0)) {
      Object.assign(h, {
        x: Math.max(26, Math.min(SCENE_BOX.w - 26, h.x)),
        y: Math.max(70, Math.min(SCENE_BOX.h - 60, h.y)),
        visible: true,
        off: true
      })
    }
    return out
  }

  /** 世界点 → 设计稿场景框像素 */
  _project(pts, camera) {
    const out = {}
    const v = new THREE.Vector3()
    for (const [k, p] of Object.entries(pts)) {
      if (!p) continue
      v.set(...p).project(camera)
      out[k] = {
        x: ((v.x + 1) / 2) * SCENE_BOX.w,
        y: ((1 - v.y) / 2) * SCENE_BOX.h,
        visible: v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2
      }
    }
    return out
  }

  /* ---------------- 视角 ---------------- */

  /** 主机位：立即切回标定相机（截图比对、钩子用） */
  goHome() {
    this.fly = null
    const c = this.camera
    c.position.copy(this.home.position)
    c.up.copy(this.home.up)
    // 控制器的目标点取在标定视线上、离相机约 6 m 处，主机位的朝向不变
    const dir = this.home.target.clone().sub(this.home.position).normalize()
    this.controls.target.copy(
      this.home.position.clone().addScaledVector(dir, 6.2)
    )
    c.lookAt(this.home.target)
    this.controls.update()
    this.userMoved = false
  }

  /**
   * 镜头飞行：home = 回到主机位；hot = 沿皮带飞到平台预警托辊组旁边（巡检通道上方往回看）
   * 用 1.6 s 的缓动插值相机位置与控制器目标点
   */
  flyTo(name) {
    const c = this.camera
    let pos
    let tgt
    if (name === "hot" && this.hot.visible) {
      const x = this.hot.position.x
      pos = new THREE.Vector3(x + 7.5, 2.9, 3.4)
      tgt = new THREE.Vector3(x, BELT.carryY, 0)
      this.userMoved = true
    } else {
      const dir = this.home.target.clone().sub(this.home.position).normalize()
      pos = this.home.position.clone()
      tgt = this.home.position.clone().addScaledVector(dir, 6.2)
      this.userMoved = false
    }
    c.up.copy(this.home.up)
    this.fly = {
      t: 0,
      p0: c.position.clone(),
      t0: this.controls.target.clone(),
      p1: pos,
      t1: tgt,
      home: name !== "hot"
    }
  }

  setFrozen(on) {
    this.frozen = on
  }

  resize() {
    const w = this.canvas.clientWidth || 1
    const h = this.canvas.clientHeight || 1
    this.renderer.setPixelRatio(
      Math.min(2.5, window.devicePixelRatio * this.scaleFn())
    )
    this.renderer.setSize(w, h, false)
    // 合成器的像素比只在构造时取一次，舞台缩放变了要同步，否则后期各通道按旧分辨率渲染
    this.composer?.setPixelRatio(this.renderer.getPixelRatio())
    this.composer?.setSize(w, h)
    // 画布对应概念图裁掉顶部 70 px 后的区域（与设计稿场景框一致）
    const [iw, ih] = CAMERA.image
    this.camera.aspect = iw / ih
    this.camera.setViewOffset(
      iw,
      ih,
      0,
      CAMERA.cropTop,
      iw,
      ih - CAMERA.cropTop
    )
    this.camera.updateProjectionMatrix()
  }

  /* ---------------- 动画 ---------------- */

  _loop() {
    this._raf = requestAnimationFrame(this._loop)
    const dt = Math.min(0.1, this.clock.getDelta())
    if (document.hidden) return
    const st = this.state
    const run = !this.frozen && st && this.model
    if (run) {
      const s = st.s
      const v = s.focus.v
      // 输送带 / 煤贴图沿 u 方向滚动（u = 米 / 2、x / 1.2）；滚筒转速 ω = v / r
      this.beltMap.offset.x -= (v * dt) / 2
      this.coalMap.offset.x -= (v * dt) / 1.2
      this.p1.rotation.z -= (v / BELT.p1.r) * dt
      this.p2.rotation.z -= (v / BELT.p2.r) * dt
      // 机器人沿吊轨平滑移动到当前里程
      const x = -(this.robotTarget ?? 0)
      this.robot.position.x += (x - this.robot.position.x) * Math.min(1, dt * 2)
      // 落煤：沿抛物线从滚筒前上方落进漏斗；停机时隐藏
      this.falling.visible = v > 0 && s.focus.flow > 0
      if (this.falling.visible) {
        const m4 = (this._m4 ||= new THREE.Matrix4())
        const q = (this._q ||= new THREE.Quaternion())
        const p = (this._p ||= new THREE.Vector3())
        const sc = (this._sc ||= new THREE.Vector3())
        this.coalSeed.forEach((c, i) => {
          c.t = (c.t + dt * 1.6 * c.k) % 1
          const t = c.t
          p.set(
            0.35 + t * 0.55 * c.k,
            // 从滚筒前方中部抛出（不是滚筒顶）：煤流主要落进漏斗，不会成团挡在滚筒正面（第 8 轮评审）
            BELT.p1.y + 0.05 - 4.9 * (t * 0.62) ** 2 - t * 0.4,
            c.z * (1 - t * 0.4)
          )
          c.r.x += dt * 3 * c.k // 下落时翻滚
          q.setFromEuler(c.r)
          m4.compose(p, q, sc.setScalar(c.s))
          this.falling.setMatrixAt(i, m4)
        })
        this.falling.instanceMatrix.needsUpdate = true
      }
      // 平台预警光圈：两圈交替扩散
      const T = performance.now() / 1000
      this.rings.forEach((m, i) => {
        const k = (T * 0.6 + i * 0.5) % 1
        m.scale.setScalar(0.35 + k * 0.75) // 热点在主机位近处（6 m），光圈不能太大
        m.material.opacity = (1 - k) * 0.9
      })
    }
    if (this.fly) {
      const f = this.fly
      f.t = Math.min(1, f.t + dt / 1.6)
      const k = f.t < 0.5 ? 2 * f.t * f.t : 1 - (-2 * f.t + 2) ** 2 / 2
      this.camera.position.lerpVectors(f.p0, f.p1, k)
      this.controls.target.lerpVectors(f.t0, f.t1, k)
      if (f.t >= 1) {
        // 回到主机位时精确对齐标定相机（含滚转）
        if (f.home) this.goHome()
        this.fly = null
      }
    }
    this.controls.update()
    this.composer.render()
  }

  stats() {
    const i = this.renderer.info
    return {
      calls: i.render.calls,
      triangles: i.render.triangles,
      textures: i.memory.textures,
      geometries: i.memory.geometries
    }
  }

  dispose() {
    cancelAnimationFrame(this._raf)
    this.canvas.removeEventListener("click", this._onClick)
    document.removeEventListener("visibilitychange", this._onVis)
    this.controls.dispose()
    this.scene.traverse((o) => {
      o.geometry?.dispose()
      const ms = Array.isArray(o.material)
        ? o.material
        : o.material
          ? [o.material]
          : []
      for (const m of ms) {
        for (const k of [
          "map",
          "lightMap",
          "emissiveMap",
          "normalMap",
          "roughnessMap",
          "metalnessMap"
        ])
          m[k]?.dispose()
        m.dispose()
      }
    })
    this.scene.environment?.dispose()
    this.composer.dispose()
    this.renderer.dispose()
  }
}

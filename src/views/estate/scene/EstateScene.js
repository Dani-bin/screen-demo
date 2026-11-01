/**
 * 楼盘沙盘主场景（不依赖 Vue）
 * ----------------------------------------------------------
 * 还原基准：docs/design/estate/design/final.png。圆形底座上的实体沙盘质感：象牙白楼体、模型树、蓝色亚克力水面，
 * 展厅暖光 + 一天的太阳光影，移轴景深让画面有"微缩"的味道。
 *
 * 版面：画布铺满窗口，面板在按 1920×1080 居中缩放的"舞台"里；投影中心按舞台位置换算，
 * 窗口比 16:9 宽或高时，沙盘和面板仍然对齐（做法同 /smart-conveyor）。
 *
 * 公共接口：
 *   ready               Promise，场景建好后 resolve
 *   setTime(hour)       设一天里的时刻（北京时间，小时，可带小数）
 *   select(id)          选中楼栋 / 配套并飞过去；select(null) 取消
 *   setLayer(layerId)   配套 / 景观图层；setLayer(null) 取消
 *   goHome()            回到定稿机位
 *   flyToPlan(x, y, o)  飞到平面某点
 *   projectPlan(x,y,h)  平面点 → 画布 CSS 像素
 *   onFrame / onPick    回调
 */
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { Lens, backdropTexture } from "./lens.js"
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"
import { LineSegments2 } from "three/addons/lines/LineSegments2.js"
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js"
import { LineMaterial } from "three/addons/lines/LineMaterial.js"
import { THEME } from "./theme.js"
import { lightAt } from "./sun.js"
import { lakeOutline, riverBanks } from "./shapes.js"
import {
  contextBlocks,
  paintGround,
  paintContactShadows,
  buildGroundMesh,
  buildFloor
} from "./ground.js"
import { buildWater } from "./water.js"
import { buildBuildings } from "./buildings.js"
import { loadModels, loadGroundAo } from "./models.js"
import { buildTrees, buildLamps, buildCars } from "./props.js"

// 阶段之间让出主线程，让加载进度能刷新；用定时器而不是 rAF，页面在后台时也不会卡住
/**
 * 画质档（?q=low|mid|high，默认 mid）：
 *   mid  环境反射 + 关键光软阴影 + 景深镜头；接触阴影烘焙在地面贴图里，不开实时 GTAO
 *   high 在 mid 上再开全分辨率实时 GTAO（楼体、树冠之间的环境光遮蔽），慢机器会掉到 20 fps 以下
 *   low  去掉环境反射和关键光阴影
 */
function quality() {
  const q = new URLSearchParams(location.hash.split("?")[1] ?? "")
  const level = q.get("q") ?? "mid"
  const fx = new Set((q.get("fx") ?? "").split(","))
  return {
    env: level !== "low" && !fx.has("noenv"),
    keyShadow: level !== "low" && !fx.has("noks"),
    gtao: level === "high" && !fx.has("nogtao") ? 1 : 0,
    lens: !fx.has("nolens")
  }
}

const nextFrame = () => new Promise((r) => setTimeout(r, 16))
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** 选中时脚下的光斑：中心亮、边缘渐隐的金色 */
function haloTexture() {
  const c = document.createElement("canvas")
  c.width = c.height = 128
  const g = c.getContext("2d")
  const gr = g.createRadialGradient(64, 64, 6, 64, 64, 62)
  gr.addColorStop(0, "rgba(255,210,122,0.9)")
  gr.addColorStop(0.55, "rgba(255,210,122,0.35)")
  gr.addColorStop(1, "rgba(255,210,122,0)")
  g.fillStyle = gr
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

export class EstateScene {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} o layout（layout.json）、hour 初始时刻、month / day 日期、
   *   onPick(id | null)、onFrame(scene)、onProgress(0–1)
   */
  constructor(canvas, o) {
    this.canvas = canvas
    this.layout = o.layout
    this.onPick = o.onPick ?? (() => {})
    this.onFrame = o.onFrame ?? (() => {})
    this.onProgress = o.onProgress ?? (() => {})
    this.month = o.month ?? 10
    this.day = o.day ?? 30
    this.hour = o.hour ?? 18
    this.frozen = false
    this.selected = null
    this.layerId = null
    this.touring = false
    this._tween = null
    this._timeTween = null
    this._outlines = new Map()
    this._halos = new Map()
    this._shown = new Set()
    this.clockT = 0
    this.ready = this._init()
  }

  // ================================================================ 初始化

  async _init() {
    const { canvas, layout } = this
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: "high-performance"
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.toneMappingExposure = 1.12
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    // 楼和树都是静止的，只有太阳动（拖时间、导览的一天光影）时才需要重画阴影图，见 applyLight
    renderer.shadowMap.autoUpdate = false
    renderer.info.autoReset = false
    this.renderer = renderer

    this.q = quality()
    const scene = new THREE.Scene()
    try {
      // 展厅背景：定稿概念图四周的虚化展厅（中间压暗，沙盘盖住），public/estate/showroom.webp
      const bgTex = await new THREE.TextureLoader().loadAsync(
        `${import.meta.env.BASE_URL}estate/showroom.webp`
      )
      bgTex.colorSpace = THREE.SRGBColorSpace
      scene.background = bgTex
    } catch {
      scene.background = backdropTexture()
    }
    this.scene = scene
    // 环境光：一个小房间的环境贴图，给窗玻璃、水面、金属边提供柔和的反射和间接光
    if (this.q.env) {
      const pmrem = new THREE.PMREMGenerator(renderer)
      // 不设 scene.environment：那会让上万棵树和整张地面的每个像素都去采样环境贴图，很贵。
      // 只给窗玻璃（楼体）和金边挂 envMap，见下面建好楼体之后
      this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
      pmrem.dispose()
    }

    // 近远面收紧：深度精度更好，GTAO 和景深都靠它
    const cam = new THREE.PerspectiveCamera(THEME.fov, 16 / 9, 60, 2600)
    this.camera = cam
    this.home = {
      position: new THREE.Vector3(...THEME.camera.position),
      target: new THREE.Vector3(...THEME.camera.target)
    }

    // 灯光：一个太阳（带阴影）+ 半球光 + 一盏很弱的对面补光，保留暗部的形体
    const sun = new THREE.DirectionalLight(0xffffff, 2)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    const sc = sun.shadow.camera
    sc.left = -310
    sc.right = 310
    sc.top = 230
    sc.bottom = -230
    sc.near = 10
    sc.far = 1600
    sun.shadow.bias = -0.0005
    sun.shadow.normalBias = 0.6
    sun.shadow.radius = 3
    scene.add(sun, sun.target)
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8)
    scene.add(hemi, new THREE.AmbientLight(0xfff4e6, 0.22))
    const fill = new THREE.DirectionalLight(0xffe2bd, 0.28)
    scene.add(fill, fill.target)
    // 展厅主光：固定从南偏西的高处照下来，不带阴影。实体沙盘是被展厅灯光照亮的，
    // 太阳只负责"一天里的阴影和色温变化"，所以黄昏时沙盘也不会黑下去
    const key = new THREE.DirectionalLight(0xffe6c6, 1.4)
    key.castShadow = this.q.keyShadow
    key.shadow.mapSize.set(2048, 2048)
    Object.assign(key.shadow.camera, {
      left: -310,
      right: 310,
      top: 240,
      bottom: -240,
      near: 10,
      far: 1600
    })
    key.shadow.bias = -0.0006
    key.shadow.normalBias = 0.6
    key.shadow.radius = 4
    scene.add(key, key.target)
    this.key = key
    this.sun = sun
    this.hemi = hemi
    this.fill = fill
    const bc = new THREE.Vector3(THEME.base.cx, 0, -THEME.base.cy)
    sun.target.position.copy(bc)
    fill.target.position.copy(bc)
    key.target.position.copy(bc)
    key.position.copy(bc).add(new THREE.Vector3(-240, 520, 360))
    this.baseCenter = bc

    // 后处理：渲染 → 辉光 → 移轴 → 输出（色调映射只在最后做一次）
    const depthTexture = new THREE.DepthTexture(4, 4)
    const target = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      // 乒乓缓冲不带 MSAA：每个通道写完都要解析一次，后处理链很贵；抗锯齿改在镜头通道里做边缘平滑
      samples: 0,
      depthTexture
    })
    const composer = new EffectComposer(renderer, target)
    composer.addPass(new RenderPass(scene, cam))
    // 环境光遮蔽：楼脚、树下、水边的柔和暗部，实体沙盘质感的关键
    const gtao = new GTAOPass(scene, cam, 4, 4)
    gtao.output = GTAOPass.OUTPUT.Default
    gtao.blendIntensity = 1.0
    gtao.updateGtaoMaterial({
      radius: 9,
      distanceExponent: 1.4,
      thickness: 6,
      scale: 1.25,
      samples: 12
    })
    gtao.updatePdMaterial({
      lumaPhi: 10,
      depthPhi: 2,
      normalPhi: 3,
      radius: 5,
      rings: 2,
      samples: 12
    })
    gtao.enabled = this.q.gtao > 0
    composer.addPass(gtao)
    const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.32, 0.6, 1.0)
    // 辉光本来就是模糊的光晕，按半分辨率算（成本是全分辨率的约四分之一）
    const bloomSetSize = bloom.setSize.bind(bloom)
    bloom.setSize = (w, h) => bloomSetSize(Math.ceil(w / 2), Math.ceil(h / 2))
    composer.addPass(bloom)
    const lens = new ShaderPass(Lens)
    // 景深用的深度图：开了 GTAO 用它自己的，否则用主渲染目标带的深度贴图
    const lensRender = lens.render.bind(lens)
    lens.render = (renderer, writeBuffer, readBuffer, dt, mask) => {
      lens.uniforms.tDepth.value =
        gtao.enabled || !readBuffer.depthTexture
          ? gtao.depthTexture
          : readBuffer.depthTexture
      lensRender(renderer, writeBuffer, readBuffer, dt, mask)
    }
    lens.uniforms.near.value = cam.near
    lens.uniforms.far.value = cam.far
    lens.enabled = this.q.lens
    composer.addPass(lens)
    composer.addPass(new OutputPass())
    this.composer = composer
    this.gtao = gtao
    this.bloom = bloom
    this.lens = lens

    this.onProgress(0.05)
    await nextFrame()

    // 地面、周边白模
    const blocks = contextBlocks(layout)
    const { canvas: gcv, mask } = paintGround(layout, blocks)
    // 地面 AO：Blender 烘的"天空被楼挡住多少"，相乘到地面画布上，楼脚、楼间自然发暗
    const groundAo = await loadGroundAo()
    if (groundAo) {
      const gctx = gcv.getContext("2d")
      gctx.save()
      gctx.globalCompositeOperation = "multiply"
      gctx.drawImage(groundAo, 0, 0, gcv.width, gcv.height)
      gctx.restore()
    }
    const ground = buildGroundMesh(gcv, renderer)
    scene.add(ground.group, buildFloor())
    this.gold = ground.gold
    this.onProgress(0.3)
    await nextFrame()

    // 水
    this.water = buildWater(layout)
    scene.add(this.water.group)

    // 楼体（Blender 模型，读不到就退回程序化盒子楼）
    const models = await loadModels()
    this.buildings = buildBuildings(layout, blocks, models.buildings)
    scene.add(this.buildings.group)
    if (this.envTex) {
      this.buildings.group.traverse((o) => {
        for (const m of [o.material].flat()) {
          if (
            m?.roughnessMap ||
            /^(glass|shop_glass|rail)/.test(m?.name ?? "")
          ) {
            m.envMap = this.envTex
            m.envMapIntensity = 0.55
          }
        }
      })
      this.gold.envMap = this.envTex
      this.gold.envMapIntensity = 0.35
    }
    this.onProgress(0.55)
    await nextFrame()

    // 树、灯、车
    const trees = buildTrees(layout, mask, models.trees)
    this.treeCount = trees.count
    paintContactShadows(gcv, trees.spots)
    ground.texture.needsUpdate = true
    scene.add(trees.group)
    this.lamps = buildLamps(layout)
    scene.add(this.lamps.group)
    this.cars = buildCars(layout)
    scene.add(this.cars.group)
    this.onProgress(0.8)
    await nextFrame()

    // 相机控制
    const controls = new OrbitControls(cam, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = THEME.controls.minDistance
    controls.maxDistance = THEME.controls.maxDistance
    controls.minPolarAngle = THEME.controls.minPolar
    controls.maxPolarAngle = THEME.controls.maxPolar
    controls.screenSpacePanning = false
    controls.zoomSpeed = 0.8
    this.controls = controls
    this._applyHome()
    controls.addEventListener("start", () => {
      this._tween = null
      this.onInteract?.()
    })

    // 拾取
    this.raycaster = new THREE.Raycaster()
    this._down = null
    canvas.addEventListener(
      "pointerdown",
      (e) => (this._down = [e.clientX, e.clientY, performance.now()])
    )
    canvas.addEventListener("pointerup", (e) => {
      const d = this._down
      this._down = null
      if (!d) return
      if (
        Math.hypot(e.clientX - d[0], e.clientY - d[1]) < 5 &&
        performance.now() - d[2] < 500
      ) {
        this.onPick(this.pick(e.clientX, e.clientY))
      }
    })
    let lastMove = 0
    canvas.addEventListener("pointermove", (e) => {
      const n = performance.now()
      if (n - lastMove < 90 || e.buttons) return
      lastMove = n
      canvas.style.cursor = this.pick(e.clientX, e.clientY) ? "pointer" : ""
    })
    canvas.addEventListener("wheel", () => this.onInteract?.(), {
      passive: true
    })

    this._ro = new ResizeObserver(() => this.resize())
    this._ro.observe(canvas)
    this.resize()

    this.applyLight()
    this.clock = new THREE.Timer()
    this._fps = { frames: 0, last: performance.now(), value: 0 }
    renderer.setAnimationLoop(() => this._frame())
    this.onProgress(1)
  }

  // ================================================================ 光照与时间

  setTime(hour) {
    this.hour = hour
    this.applyLight()
  }

  /** 把当前时刻的光照参数用到所有灯、材质上 */
  applyLight() {
    if (!this.sun) return
    const l = lightAt(this.month, this.day, this.hour)
    this.light = l
    const dist = 800
    this.sun.position.copy(this.baseCenter).addScaledVector(l.dir, dist)
    this.sun.color.copy(l.sunColor)
    this.sun.intensity = l.sunIntensity * THEME.dim
    this.sun.castShadow = l.sunIntensity > 0.05
    this.renderer.shadowMap.needsUpdate = true
    this.hemi.color.copy(l.hemiSky)
    this.hemi.groundColor.copy(l.hemiGround)
    // 半球光少压一点：树和楼的影子里要还有一点环境光，不然阴影成了黑洞
    this.hemi.intensity = l.hemiIntensity * (THEME.dim + 0.3)
    // 补光从太阳的对面斜着打，夜里转成冷色
    this.fill.position
      .copy(this.baseCenter)
      .add(new THREE.Vector3(-l.dir.x * 300, 360, -l.dir.z * 300))
    this.fill.color.set(0xffe2bd).lerp(new THREE.Color(0x7d8fc4), l.night)
    this.fill.intensity = (0.22 + 0.1 * l.night) * THEME.dim
    this.key.intensity = 2.5 * (1 - 0.6 * l.night) * THEME.dim
    this.key.color.set(0xffe6c6).lerp(new THREE.Color(0x9fb0e0), l.night * 0.6)
    this.buildings.setLit(l.lit)
    this.lamps.setLit(l.lit)
    this.cars.setLit(l.lit)
    this.gold.emissiveIntensity = 0.03 + 0.18 * l.lit
    // 背景：夜里压暗；辉光夜里更明显
    this.scene.backgroundIntensity = 0.62 - 0.3 * l.night
    this.bloom.strength = 0.28 + 0.25 * l.lit
  }

  /**
   * 导出给 Blender 离线渲染的数据（scripts/estate/export_for_blender.mjs 调用）：
   * 地面底图（重新画一张，不含树脚阴影和地面 AO，那些让 Cycles 自己算）、周边楼，
   * 以及按名字收集的实例化网格（树冠 / 树干 / 灌木 / 路灯 / 车）的矩阵和颜色。
   * 矩阵是 three.js 世界坐标（y 向上，z = -y），Blender 那边再换轴。
   */
  exportForBlender() {
    const { canvas } = paintGround(this.layout, contextBlocks(this.layout))
    const instances = {}
    this.scene.traverse((o) => {
      if (!o.isInstancedMesh || !o.name) return
      instances[o.name] = {
        count: o.count,
        matrix: Array.from(o.instanceMatrix.array.slice(0, o.count * 16)),
        color: o.instanceColor
          ? Array.from(o.instanceColor.array.slice(0, o.count * 3))
          : null
      }
    })
    return { albedo: canvas.toDataURL("image/png"), instances }
  }

  /** 平滑地把时间拨到某个时刻（导览"一天光影"用） */
  tweenTime(to, ms = 6000, onDone) {
    this._timeTween = { from: this.hour, to, t0: performance.now(), ms, onDone }
  }

  // ================================================================ 版面

  /** 舞台缩放（CSS 像素 / 设计像素）与舞台左上角 */
  stage() {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    const u = Math.min(w / THEME.designSize[0], h / THEME.designSize[1])
    return {
      u,
      ox: (w - THEME.designSize[0] * u) / 2,
      oy: (h - THEME.designSize[1] * u) / 2,
      w,
      h
    }
  }

  resize() {
    const { u, ox, oy, w, h } = this.stage()
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    const pr = this.renderer.getPixelRatio()
    const gs = this.q.gtao || 1
    this.gtao.setSize(Math.round(w * pr * gs), Math.round(h * pr * gs))
    this.lens.uniforms.resolution.value.set(w * pr, h * pr)
    this.lens.uniforms.maxBlur.value = 7 * pr
    this.lens.uniforms.tiltAmount.value = 2.5 * pr
    const [dw, dh] = THEME.designSize
    // 定稿相机的焦距（设计像素）→ 当前舞台缩放下的 CSS 像素
    const focal = dh / 2 / Math.tan((THEME.fov * Math.PI) / 360)
    const cam = this.camera
    cam.aspect = w / h
    cam.fov = (2 * Math.atan(h / 2 / (focal * u)) * 180) / Math.PI
    cam.setViewOffset(
      w,
      h,
      w / 2 - ox - (dw / 2) * u,
      h / 2 - oy - (dh / 2) * u,
      w,
      h
    )
    cam.updateProjectionMatrix()
    for (const m of this._lineMats ?? []) m.resolution.set(w, h)
    this._size = { w, h }
  }

  // ================================================================ 镜头

  _applyHome() {
    this.camera.position.copy(this.home.position)
    this.controls.target.copy(this.home.target)
    this.camera.lookAt(this.home.target)
    this.controls.update()
  }

  /**
   * 飞到某个目标：相机在目标点的球面坐标上，azimuth 0 = 从正南往北看，正值向东绕。
   * @param {object} o dist 距离、polar 离竖直方向的角度（度）、azimuth（度）、duration（秒）
   */
  flyToPlan(x, y, o = {}) {
    const { dist = 260, polar = 37, azimuth = 0, duration = 1.6, h = 0 } = o
    const target = new THREE.Vector3(x, h, -y)
    const p = (polar * Math.PI) / 180
    const a = (azimuth * Math.PI) / 180
    const pos = target
      .clone()
      .add(
        new THREE.Vector3(
          Math.sin(a) * Math.sin(p) * dist,
          Math.cos(p) * dist,
          Math.cos(a) * Math.sin(p) * dist
        )
      )
    this._flyTo(pos, target, duration)
  }

  _flyTo(pos, target, duration = 1.6) {
    this._tween = {
      from: {
        pos: this.camera.position.clone(),
        target: this.controls.target.clone()
      },
      to: { pos, target },
      t0: performance.now(),
      ms: duration * 1000
    }
  }

  /** 相机朝向在地面上的方位角（度，从正北顺时针），指北针用 */
  headingDeg() {
    this._dir = this._dir ?? new THREE.Vector3()
    this.camera.getWorldDirection(this._dir)
    return (Math.atan2(this._dir.x, -this._dir.z) * 180) / Math.PI
  }

  /** 开场：从更高更远、偏一个角度的位置飞到定稿机位 */
  intro(duration = 3.2) {
    const h = this.home
    const dir = h.position.clone().sub(h.target)
    const start = h.target
      .clone()
      .add(
        dir
          .multiplyScalar(1.45)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.75)
      )
    start.y = h.position.y * 1.2
    this.camera.position.copy(start)
    this.controls.target.copy(h.target)
    this._flyTo(h.position.clone(), h.target.clone(), duration)
  }

  /**
   * 按编号渲染纯色 ID 图（楼栋 / 配套，其余全黑），给逐区比对算 IoU 和中心偏差用。
   * 直接渲到画布上读出来，然后恢复；返回 { png, map }，map: 编号 → [r, g, b]
   */
  renderIdMask() {
    const keep = []
    this.scene.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh || o.isLine2)
        keep.push([o, o.visible, o.material])
    })
    const bg = this.scene.background
    const bgi = this.scene.backgroundIntensity
    const map = {}
    const ids = [...this.buildings.objects.keys()]
    const colors = new Map()
    ids.forEach((id, i) => {
      const c = [
        ((i + 1) * 37) % 256,
        ((i + 1) * 91) % 256,
        ((i + 1) * 151) % 256
      ]
      map[id] = c
      colors.set(
        id,
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255),
          toneMapped: false
        })
      )
    })
    const black = new THREE.MeshBasicMaterial({
      color: 0x000000,
      toneMapped: false
    })
    this.scene.background = new THREE.Color(0x000000)
    for (const [o] of keep) {
      const id = o.userData?.id
      if (id && colors.has(id))
        o.material = o.material.length
          ? o.material.map(() => colors.get(id))
          : colors.get(id)
      else if (o.isLine2) o.visible = false
      else o.material = o.material.length ? o.material.map(() => black) : black
    }
    const tm = this.renderer.toneMapping
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.render(this.scene, this.camera)
    const png = this.canvas.toDataURL("image/png")
    this.renderer.toneMapping = tm
    for (const [o, v, m] of keep) {
      o.visible = v
      o.material = m
    }
    this.scene.background = bg
    this.scene.backgroundIntensity = bgi
    return { png, map }
  }

  goHome(duration = 1.6) {
    this.deselect()
    this.setLayer(null)
    this._flyTo(this.home.position.clone(), this.home.target.clone(), duration)
  }

  // ================================================================ 选中、图层

  /** 平面点（含高度）→ 画布 CSS 像素；visible = 在画面内且在相机前面 */
  projectPlan(x, y, h = 0) {
    const v = new THREE.Vector3(x, h, -y).project(this.camera)
    const { w, h: ch } = this._size ?? { w: 1, h: 1 }
    return {
      x: (v.x * 0.5 + 0.5) * w,
      y: (-v.y * 0.5 + 0.5) * ch,
      visible: v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15
    }
  }

  /** 对象在平面上的外框：楼栋 / 配套用布局里的 cx、cy、w、d */
  info(id) {
    return (
      this.layout.buildings.find((b) => b.id === id) ??
      this.layout.amenities.find((a) => a.id === id) ??
      null
    )
  }

  /** 对象屋顶 / 顶部高度，标签、引线锚点用 */
  topOf(id) {
    const o = this.buildings.objects.get(id)
    if (o) return o.height
    const a = this.info(id)
    return a?.height ?? 0
  }

  pick(clientX, clientY) {
    if (!this.buildings) return null
    const r = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const hit = this.raycaster.intersectObjects(
      this.buildings.pickables,
      false
    )[0]
    return hit?.object.userData.id ?? null
  }

  /** 轮廓线：楼体用立体边线（子对象），其余用地面外框 */
  _outline(id) {
    if (this._outlines.has(id)) return this._outlines.get(id)
    const mat = new LineMaterial({
      color: THEME.color.goldHi,
      linewidth: 2.6,
      transparent: true,
      opacity: 0.95,
      depthTest: false
    })
    this._lineMats = this._lineMats ?? []
    this._lineMats.push(mat)
    if (this._size) mat.resolution.set(this._size.w, this._size.h)
    const geo = new LineSegmentsGeometry()
    const pos = []
    const obj = this.buildings.objects.get(id)
    let holder = this.scene
    if (obj) {
      obj.group.updateMatrixWorld(true)
      const inv = new THREE.Matrix4().copy(obj.group.matrixWorld).invert()
      for (const m of obj.bodies ?? [obj.body]) {
        const e = new THREE.EdgesGeometry(m.geometry, 25)
        const mtx = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)
        const p = e.attributes.position
        const v = new THREE.Vector3()
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i).applyMatrix4(mtx)
          pos.push(v.x, v.y, v.z)
        }
        e.dispose()
      }
      holder = obj.group
    } else {
      for (const ring of this._planOutline(id)) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]
          const b = ring[(i + 1) % ring.length]
          pos.push(a[0], 0.9, -a[1], b[0], 0.9, -b[1])
        }
      }
    }
    geo.setPositions(pos)
    const line = new LineSegments2(geo, mat)
    line.renderOrder = 20
    line.visible = false
    holder.add(line)
    this._outlines.set(id, line)
    return line
  }

  /** 没有三维楼体的对象（湖、轴线、步道、水池、河、公园……）的地面外框 */
  _planOutline(id) {
    const a = this.info(id)
    if (!a) return []
    if (id === "LK01") return [lakeOutline(a, 1, 1.6)]
    if (id === "TR01") return [lakeOutline(this.info("LK01"), 1, 5.4)]
    if (id === "RV01") {
      const rb = riverBanks(a, -280, 300, 8)
      return [[...rb.top, ...rb.bottom.slice().reverse()]]
    }
    const w = a.w / 2
    const d = a.d / 2
    return [
      [
        [a.cx - w, a.cy - d],
        [a.cx + w, a.cy - d],
        [a.cx + w, a.cy + d],
        [a.cx - w, a.cy + d]
      ]
    ]
  }

  _halo(id) {
    if (this._halos.has(id)) return this._halos.get(id)
    const a = this.info(id)
    this._haloTex = this._haloTex ?? haloTexture()
    const mat = new THREE.MeshBasicMaterial({
      map: this._haloTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.4
    })
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
    m.rotation.x = -Math.PI / 2
    const w = a.w ?? 20
    const d = a.d ?? 20
    m.scale.set(Math.min(w + 22, 140), Math.min(d + 22, 140), 1)
    m.position.set(a.cx, 0.8, -a.cy)
    m.renderOrder = 4
    m.visible = false
    this.scene.add(m)
    this._halos.set(id, m)
    return m
  }

  _show(id, on) {
    const l = this._outline(id)
    l.visible = on
    const h = this._halo(id)
    h.visible = on
    if (on) this._shown.add(id)
    else this._shown.delete(id)
  }

  select(id, o = {}) {
    if (this.selected) this._show(this.selected, false)
    this.selected = id
    if (!id) return
    this._show(id, true)
    const a = this.info(id)
    if (!a || o.fly === false) return
    const tall = (this.topOf(id) ?? 0) > 40
    this.flyToPlan(a.cx, a.cy, {
      dist: tall ? 330 : 230,
      polar: 42,
      azimuth: o.azimuth ?? 0,
      h: Math.min(this.topOf(id) * 0.35, 20),
      duration: o.duration ?? 1.5
    })
  }

  deselect() {
    this.select(null)
  }

  /** 配套 / 景观图层：这一类对象的外框和光斑点亮，镜头飞到能装下它们的位置 */
  setLayer(layerId, o = {}) {
    for (const id of this._layerShown ?? [])
      if (id !== this.selected) this._show(id, false)
    this._layerShown = []
    this.layerId = layerId
    if (!layerId) return
    const layer = this.layout.layers.find((l) => l.id === layerId)
    if (!layer) return
    const members = layer.ids.map((id) => this.info(id)).filter(Boolean)
    for (const m of members) {
      this._show(m.id, true)
      this._layerShown.push(m.id)
    }
    if (o.fly === false) return
    // 只框住小区及周边近处的对象；河、公园这类很长的不参与取景
    const near = members.filter((m) => m.w < 200)
    let minx = Infinity
    let maxx = -Infinity
    let miny = Infinity
    let maxy = -Infinity
    for (const m of near) {
      minx = Math.min(minx, m.cx - m.w / 2)
      maxx = Math.max(maxx, m.cx + m.w / 2)
      miny = Math.min(miny, m.cy - m.d / 2)
      maxy = Math.max(maxy, m.cy + m.d / 2)
    }
    const cx = (minx + maxx) / 2
    const cy = (miny + maxy) / 2
    const span = Math.max(maxx - minx, (maxy - miny) * 1.6, 60)
    this.flyToPlan(cx, cy, {
      dist: Math.min(900, 150 + span * 1.25),
      polar: 44,
      duration: 1.6
    })
  }

  // ================================================================ 帧循环

  _frame() {
    this.clock.update()
    const dt = Math.min(0.1, this.clock.getDelta())
    if (!this.frozen) {
      this.clockT += dt
      this.water.update(this.clockT, this.light, this.camera.position)
      this.cars.update(this.clockT)
      // 选中 / 图层光斑呼吸
      const k = 0.32 + 0.12 * Math.sin(this.clockT * 2.4)
      for (const id of this._shown) this._halos.get(id).material.opacity = k
      // 镜头动画
      const tw = this._tween
      if (tw) {
        const t = Math.min(1, (performance.now() - tw.t0) / tw.ms)
        const e = ease(t)
        this.camera.position.lerpVectors(tw.from.pos, tw.to.pos, e)
        this.controls.target.lerpVectors(tw.from.target, tw.to.target, e)
        if (t >= 1) this._tween = null
      }
      // 时间动画
      const tt = this._timeTween
      if (tt) {
        const t = Math.min(1, (performance.now() - tt.t0) / tt.ms)
        this.setTime(tt.from + (tt.to - tt.from) * ease(t))
        this.onTime?.(this.hour)
        if (t >= 1) {
          this._timeTween = null
          tt.onDone?.()
        }
      }
      this._clampControls()
      this.controls.update()
    } else {
      this.water.update(this.clockT, this.light, this.camera.position)
    }
    // 景深对焦在视线目标上；颗粒每帧换一个种子
    this.lens.uniforms.focus.value = this.camera.position.distanceTo(
      this.controls.target
    )
    this.lens.uniforms.time.value = (this.clockT * 37) % 1000
    this.renderer.info.reset()
    this.composer.render()
    this.onFrame(this)
    const f = this._fps
    f.frames++
    const now = performance.now()
    if (now - f.last > 1000) {
      f.value = (f.frames * 1000) / (now - f.last)
      f.frames = 0
      f.last = now
    }
  }

  /** 视线目标不出底座，相机不钻进地面 */
  _clampControls() {
    const t = this.controls.target
    const dx = t.x - this.baseCenter.x
    const dz = t.z - this.baseCenter.z
    // 视线目标限制在底座椭圆内侧（东西 ±230、南北 ±150）
    const k = Math.hypot(dx / 230, dz / 150)
    if (k > 1) {
      t.x = this.baseCenter.x + dx / k
      t.z = this.baseCenter.z + dz / k
    }
    t.y = Math.min(60, Math.max(0, t.y))
    if (this.camera.position.y < 14) this.camera.position.y = 14
  }

  stats() {
    const i = this.renderer.info
    return {
      fps: Math.round(this._fps.value),
      calls: i.render.calls,
      triangles: i.render.triangles,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
      trees: this.treeCount
    }
  }

  setFrozen(on) {
    this.frozen = on
  }

  dispose() {
    this._ro?.disconnect()
    this.renderer?.setAnimationLoop(null)
    this.controls?.dispose()
    this.composer?.dispose()
    this.renderer?.dispose()
  }
}

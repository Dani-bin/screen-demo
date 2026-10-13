/*
 * 老家沙盘 三维场景
 * ----------------------------------------------------------
 * 加载 Blender 导出的 public/hometown/village.glb（地面、房屋、树、电线杆），地面换成正交俯视渲染贴图
 * （ground_dusk / ground_night.webp，稻株、田埂草、影子都画在贴图里），再叠加：
 *   - 发光的回家路线 + 沿路线慢慢走回家的光点；我家厨房烟囱的炊烟
 *   - 傍晚 / 夜晚切换：太阳、天光、地面贴图、背景、窗灯（按户随机）、红灯笼、辉光一起过渡
 *   - 开场"卫星图 → 沙盘"动画（intro.js）
 *   - 全景 ↔ 我家近景（照片机位）镜头切换
 *
 * 不依赖 Vue。生命周期：new HometownScene(opts) → await load() → playIntro() → dispose()
 * 回调：
 *   onAnchors({ nodes, home })  标注锚点的设计稿坐标（1920 宽，每帧）
 *   onIntro(playing)                           开场动画开始 / 结束
 */
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js"
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js"
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js"
import { HorizontalTiltShiftShader } from "three/examples/jsm/shaders/HorizontalTiltShiftShader.js"
import { VerticalTiltShiftShader } from "three/examples/jsm/shaders/VerticalTiltShiftShader.js"

import SITE from "../data/site.json"
import { THEME } from "./theme"
import { Backdrop } from "./backdrop"
import { HomeIntro } from "./intro"

const { DEG } = THEME
const DESIGN_W = 1920
const lerp = (a, b, k) => a + (b - a) * k
const smooth = (k) => k * k * (3 - 2 * k)

/** 我家的局部坐标（houses.py：x 向右、正立面 y = -5、台基高 0.45、层高 3.1）→ three.js 世界坐标 */
function homePoint(lx, ly, lz) {
  const [cx, cy, cz] = SITE.home.pos
  const f = SITE.home.face
  // Blender：房屋对象绕 z 转了 f + 90°，局部 -y 指向正面法线 n = (cos f, sin f)，
  // 局部 +x = (-sin f, cos f)（面对房子时的右手方向）
  const nx = Math.cos(f)
  const ny = Math.sin(f)
  const rx = -Math.sin(f)
  const ry = Math.cos(f)
  const bx = cx + rx * lx - nx * ly
  const by = -cz + ry * lx - ny * ly // site.json 已是 three 坐标，z = -y
  return new THREE.Vector3(bx, cy + lz, -by)
}

export class HometownScene {
  constructor({ canvas, container, baseUrl, onAnchors, onIntro }) {
    this.canvas = canvas
    this.container = container
    this.baseUrl = baseUrl
    this.onAnchors = onAnchors || (() => {})
    this.onIntro = onIntro || (() => {})
    this.disposed = false
    this.night = 0 // 当前昼夜混合（0 傍晚、1 夜晚）
    this.nightTarget = 0
    this.view = "overview"

    // ---------- 渲染器
    const r = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance"
    })
    // 大屏 1920 宽已经足够清晰；像素比封顶 1.5，避免 4K 下帧率掉到个位数
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    r.toneMapping = THREE.AgXToneMapping
    r.toneMappingExposure = THEME.dusk.exposure
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFShadowMap
    // 场景是静止的（房屋、树都不动）：阴影图只在需要时重画（开场"长高"期间每帧画）
    r.shadowMap.autoUpdate = false
    this.shadowDirty = true
    this.renderer = r

    const scene = new THREE.Scene()
    this.scene = scene
    this.camera = new THREE.PerspectiveCamera(
      THEME.overview.fov,
      16 / 9,
      1,
      3000
    )
    scene.add(this.camera)
    this.backdrop = new Backdrop(this.camera)

    // ---------- 光：天光 + 太阳（真实方位：盛夏傍晚西北偏西、低角度）
    this.hemi = new THREE.HemisphereLight(
      THEME.dusk.sky,
      THEME.dusk.groundLight,
      THEME.dusk.hemi
    )
    scene.add(this.hemi)
    const { azimuth, elevation, upAzimuth } = THEME.sun
    const a = (azimuth - upAzimuth) * DEG
    const e = elevation * DEG
    // 场地坐标里太阳方向 (sin a cos e, cos a cos e, sin e) → three (x, z, -y)
    this.sunDir = new THREE.Vector3(
      Math.sin(a) * Math.cos(e),
      Math.sin(e) + 0.12, // 实时光稍微抬高一点，免得影子拉得太长盖住半个沙盘
      -Math.cos(a) * Math.cos(e)
    ).normalize()
    const sun = new THREE.DirectionalLight(
      THEME.dusk.sun,
      THEME.dusk.sunIntensity
    )
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    Object.assign(sun.shadow.camera, {
      left: -170,
      right: 170,
      top: 170,
      bottom: -170,
      near: 1,
      far: 900
    })
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.04
    sun.shadow.camera.updateProjectionMatrix()
    sun.position.copy(this.sunDir).multiplyScalar(400)
    scene.add(sun, sun.target)
    this.sun = sun
    // 我家门口的暖灯（夜里照亮台阶和门廊）
    this.doorLight = new THREE.PointLight(0xffb066, 0, 16, 1.6)
    this.doorLight.position.copy(homePoint(0, -5.6, 2.9))
    scene.add(this.doorLight)

    // ---------- 镜头控制
    this.controls = new OrbitControls(this.camera, canvas)
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.08,
      rotateSpeed: 0.5,
      minDistance: 8,
      maxDistance: 900,
      minPolarAngle: 8 * DEG,
      maxPolarAngle: 82 * DEG,
      screenSpacePanning: true
    })
    this.controls.enabled = false
    this.lastInteract = -1e9
    this.controls.addEventListener(
      "start",
      () => (this.lastInteract = performance.now())
    )
    this.controls.addEventListener(
      "end",
      () => (this.lastInteract = performance.now())
    )

    // ---------- 后处理：辉光 + 移轴模糊（上下虚、中间实，微缩模型感）
    const rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4
    })
    this.composer = new EffectComposer(r, rt)
    this.composer.addPass(new RenderPass(scene, this.camera))
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(256, 256),
      ...THEME.dusk.bloom
    )
    this.composer.addPass(this.bloom)
    this.tiltH = new ShaderPass(HorizontalTiltShiftShader)
    this.tiltV = new ShaderPass(VerticalTiltShiftShader)
    for (const p of [this.tiltH, this.tiltV]) {
      p.uniforms.r.value = 0.42 // 清晰带的中心（屏幕高度比例，自下往上）
      this.composer.addPass(p)
    }
    this.composer.addPass(new OutputPass())
    this.tilt = 1

    this._onResize = () => this._resize()
    this.resizeObserver = new ResizeObserver(this._onResize)
    this.resizeObserver.observe(container)
    this.timer = new THREE.Timer()
    if (import.meta.env.DEV) window.__hometownScene = this
    this._loop = this._loop.bind(this)
  }

  // ================================================================ 加载

  async load() {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    const tl = new THREE.TextureLoader()
    const base = `${this.baseUrl}hometown/`
    // 开发时模型 / 贴图经常重新导出，加时间戳绕过浏览器缓存
    const v = import.meta.env.DEV ? `?v=${Date.now()}` : ""
    const [gltf, dusk, night, sat] = await Promise.all([
      loader.loadAsync(`${base}village.glb${v}`),
      tl.loadAsync(`${base}ground_dusk.webp${v}`),
      tl.loadAsync(`${base}ground_night.webp${v}`),
      tl.loadAsync(`${base}satellite.webp${v}`)
    ])
    if (this.disposed) return
    sat.colorSpace = THREE.SRGBColorSpace
    this.satTex = sat
    this.village = gltf.scene
    this.scene.add(this.village)
    this._prepareGround(dusk, night)
    this._prepareObjects()
    this._buildRoute()
    this._buildSmoke()

    this._applyNight(0) // 初始傍晚：窗灯、灯笼、路线亮度归位
    this._placeOverview()
    this._resize()
    this.frameId = requestAnimationFrame(this._loop)
  }

  /**
   * 地面：除沙盘侧面的紫红土（G_soil）以外，所有地块材质换成正交俯视贴图（第二套 UV），
   * 傍晚 / 夜晚两张贴图在着色器里按 uNight 混合
   */
  _prepareGround(dusk, night) {
    const aniso = this.renderer.capabilities.getMaxAnisotropy()
    for (const t of [dusk, night]) {
      t.flipY = false
      t.colorSpace = THREE.SRGBColorSpace
      t.channel = 1
      t.anisotropy = aniso
    }
    this.uNight = { value: 0 }
    // 贴图在 Blender 里已经过 AgX 色调映射，这里不再映射一次
    const mat = new THREE.MeshBasicMaterial({ map: dusk, toneMapped: false })
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.tNightMap = { value: night }
      sh.uniforms.uNight = this.uNight
      sh.fragmentShader = sh.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform sampler2D tNightMap;\nuniform float uNight;"
        )
        .replace(
          "#include <map_fragment>",
          `#ifdef USE_MAP
            vec4 sampledDiffuseColor = mix(texture2D(map, vMapUv), texture2D(tNightMap, vMapUv), uNight);
            diffuseColor *= sampledDiffuseColor;
          #endif`
        )
    }
    this.groundMat = mat
    this.groundTex = [dusk, night]
    this.village.getObjectByName("ground")?.traverse((o) => {
      if (!o.isMesh) return
      if (o.material.name !== "G_soil") o.material = mat
      o.castShadow = false
      o.receiveShadow = false
    })
  }

  /**
   * 房屋 / 树 / 水面：阴影；每户的立面材质克隆一份（夜里按户随机亮灯）；
   * 我家的窗玻璃、红灯笼单独收集（夜里点亮）
   */
  _prepareObjects() {
    const aniso = this.renderer.capabilities.getMaxAnisotropy()
    this.litWalls = [] // { mat, on }
    this.glowMats = { glass: [], lantern: [] }
    let seed = 11
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const seen = new Set()
    for (const top of this.village.children) {
      const isHouse = /^(house_|home)/.test(top.name)
      const clones = new Map()
      const lit = rand() < THEME.litRatio
      top.traverse((o) => {
        if (!o.isMesh) return
        o.castShadow = !/^(ground|pond_water|wires)/.test(top.name)
        o.receiveShadow = isHouse
        let m = o.material
        if (!seen.has(m)) {
          seen.add(m)
          for (const v of Object.values(m))
            if (v && v.isTexture) v.anisotropy = aniso
        }
        // 带窗洞遮罩的立面：每户一份，白天不发光
        if (isHouse && m.emissiveMap && /^W_/.test(m.name)) {
          if (!clones.has(m)) {
            const c = m.clone()
            c.emissive.set(0xffb45a)
            c.emissiveIntensity = 0
            clones.set(m, c)
            this.litWalls.push({ mat: c, on: lit })
          }
          o.material = clones.get(m)
        }
        if (m.name === "H_glass") this.glowMats.glass.push(m)
        if (m.name === "D_lantern") this.glowMats.lantern.push(m)
      })
      if (top.name === "pond_water") {
        top.traverse((o) => {
          if (o.isMesh)
            o.material = new THREE.MeshStandardMaterial({
              color: 0x46655c,
              roughness: 0.12,
              metalness: 0.2,
              transparent: true,
              opacity: 0.88
            })
        })
      }
    }
    for (const m of this.glowMats.glass) m.emissive.set(0xffb866)
    for (const m of this.glowMats.lantern) m.emissive.set(0xff4a2a)
  }

  /** 回家路线：贴地发光管 + 一颗沿路线往复走的光点 */
  _buildRoute() {
    const pts = SITE.route.map(([x, y, z]) => new THREE.Vector3(x, y + 0.45, z))
    this.routeCurve = new THREE.CatmullRomCurve3(pts, false, "centripetal")
    const geo = new THREE.TubeGeometry(this.routeCurve, 400, 0.42, 8, false)
    // 颜色放大到 1 以上（HDR），辉光才会把它"点亮"成设计稿里那条暖黄光带
    this.routeMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(THEME.route).multiplyScalar(2.2),
      toneMapped: false,
      transparent: true,
      opacity: 0.9
    })
    this.routeMesh = new THREE.Mesh(geo, this.routeMat)
    this.routeMesh.renderOrder = 2
    this.village.add(this.routeMesh)
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 16, 12),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xfff1c8).multiplyScalar(4),
        toneMapped: false
      })
    )
    this.walker = dot
    this.village.add(dot)
    this.routeLen = this.routeCurve.getLength()
  }

  /** 炊烟：我家后排厨房烟囱上方一串慢慢升起、变大、变淡的软圆片 */
  _buildSmoke() {
    const c = document.createElement("canvas")
    c.width = c.height = 64
    const g = c.getContext("2d")
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    rg.addColorStop(0, "rgba(255,255,255,0.9)")
    rg.addColorStop(1, "rgba(255,255,255,0)")
    g.fillStyle = rg
    g.fillRect(0, 0, 64, 64)
    this.smokeTex = new THREE.CanvasTexture(c)
    // 烟囱：houses.py 里偏屋右后角（局部 x = 4.6、y = 5.6），顶高约 4.5 m
    this.smokeBase = homePoint(4.6, 5.6, 4.6)
    this.smoke = []
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.smokeTex,
          color: 0xe8e2da,
          transparent: true,
          depthWrite: false,
          opacity: 0
        })
      )
      s.userData.phase = i / 14
      this.village.add(s)
      this.smoke.push(s)
    }
  }

  // ================================================================ 镜头

  _overviewPose() {
    const o = THEME.overview
    const az = o.azimuth * DEG
    const el = o.elevation * DEG
    // Blender 方向 (cos az cos el, sin az cos el, sin el) → three (x, z, -y)
    const d = new THREE.Vector3(
      Math.cos(az) * Math.cos(el),
      Math.sin(el),
      -Math.sin(az) * Math.cos(el)
    )
    const target = new THREE.Vector3(...o.target)
    return {
      target,
      pos: target.clone().addScaledVector(d, o.dist),
      fov: o.fov
    }
  }

  /** 与 Blender preview.home_view 相同：距离 / 横移 / 看点都相对房屋中心（不是正立面） */
  _homePose() {
    const h = THEME.home
    const pos = homePoint(-h.side, -h.dist, h.eye)
    const target = homePoint(-h.aim, 0, h.lookUp)
    return { target, pos, fov: h.fov }
  }

  _topPose() {
    const o = this._overviewPose()
    const target = new THREE.Vector3(o.target.x, 0, o.target.z)
    // 正上方，略微偏向全景机位一侧，镜头"上方"与卫星图上方一致
    const pos = target.clone().add(new THREE.Vector3(0, THEME.top.height, 0.5))
    return { target, pos, fov: THEME.overview.fov }
  }

  _applyPose(p) {
    this.camera.position.copy(p.pos)
    this.controls.target.copy(p.target)
    if (Math.abs(this.camera.fov - p.fov) > 1e-3) {
      this.camera.fov = p.fov
      this.camera.updateProjectionMatrix()
      this.backdrop.fit(this.camera)
    }
    this.camera.lookAt(p.target)
  }

  _placeOverview() {
    this._applyPose(this._overviewPose())
    this.controls.update()
  }

  /** 两个位姿之间插值：目标点 / 机位按球坐标绕目标插值，转场不会穿过地面 */
  _blendPose(a, b, k) {
    const target = a.target.clone().lerp(b.target, k)
    const pos = a.pos.clone().lerp(b.pos, k)
    // 全景 ↔ 近景时中途抬高一点，从高处"落"进地坝，不贴地掠过房子和树
    if (Math.abs(a.fov - b.fov) > 1) pos.y += Math.sin(Math.PI * k) * 30
    return { target, pos, fov: lerp(a.fov, b.fov, k) }
  }

  /** 切换镜头：overview 全景、home 我家近景（照片机位） */
  setView(view, dur = 2.4) {
    if (!this.village) return
    this.view = view
    const from = {
      pos: this.camera.position.clone(),
      target: this.controls.target.clone(),
      fov: this.camera.fov
    }
    const to = view === "home" ? this._homePose() : this._overviewPose()
    this.tween = {
      from,
      to,
      t: 0,
      dur,
      tilt0: this.tilt,
      tilt1: view === "home" ? 0 : 1
    }
    this.controls.enabled = false
  }

  // ================================================================ 昼夜

  setNight(on) {
    this.nightTarget = on ? 1 : 0
  }

  _applyNight(k) {
    const D = THEME.dusk
    const N = THEME.night
    const c = (a, b) => new THREE.Color(a).lerp(new THREE.Color(b), k)
    this.sun.color.copy(c(D.sun, N.sun))
    this.sun.intensity = lerp(D.sunIntensity, N.sunIntensity, k)
    this.hemi.color.copy(c(D.sky, N.sky))
    this.hemi.groundColor.copy(c(D.groundLight, N.groundLight))
    this.hemi.intensity = lerp(D.hemi, N.hemi, k)
    this.renderer.toneMappingExposure = lerp(D.exposure, N.exposure, k)
    this.bloom.strength = lerp(D.bloom[0], N.bloom[0], k)
    this.bloom.radius = lerp(D.bloom[1], N.bloom[1], k)
    this.bloom.threshold = lerp(D.bloom[2], N.bloom[2], k)
    this.uNight.value = k
    this.backdrop.setNight(k)
    for (const w of this.litWalls) w.mat.emissiveIntensity = w.on ? 2.4 * k : 0
    for (const m of this.glowMats.glass) m.emissiveIntensity = 1.6 * k
    for (const m of this.glowMats.lantern) m.emissiveIntensity = 0.4 + 5 * k
    this.doorLight.intensity = 60 * k
    this.routeMat.color.set(THEME.route).multiplyScalar(2.2 - 0.6 * k)
  }

  // ================================================================ 开场

  playIntro() {
    if (!this.village) return
    this.intro?.finish()
    this.tween = null
    this.view = "overview"
    const top = this._topPose()
    const over = this._overviewPose()
    this.intro = new HomeIntro({
      scene: this.scene,
      village: this.village,
      satTex: this.satTex,
      setView: (k) => this._applyPose(this._blendPose(top, over, smooth(k)))
    })
    this.introT = 0
    this.controls.enabled = false
    this.onIntro(true)
  }

  skipIntro() {
    if (!this.intro) return
    this.intro.finish()
    this.shadowDirty = true
    this.intro = null
    this.controls.enabled = true
    this.controls.update()
    this.onIntro(false)
  }

  // ================================================================ 每帧

  _resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.backdrop.fit(this.camera)
    this.tiltH.uniforms.h.value = 1 / w
    this.tiltV.uniforms.v.value = 1 / h
    this.size = [w, h]
  }

  _loop() {
    this.frameId = requestAnimationFrame(this._loop)
    this.timer.update()
    const raw = this.timer.getDelta()
    const dt = Math.min(raw, 0.1)
    const t = this.timer.getElapsed()

    if (this.intro) {
      this.introT += Math.min(raw, 0.3) // 开场按真实时间走，帧率低时也不拖长
      if (this.intro.update(this.introT)) this.skipIntro()
    } else if (this.tween) {
      const tw = this.tween
      tw.t += dt
      const k = smooth(Math.min(1, tw.t / tw.dur))
      this._applyPose(this._blendPose(tw.from, tw.to, k))
      this.tilt = lerp(tw.tilt0, tw.tilt1, k)
      if (tw.t >= tw.dur) {
        this.tween = null
        this.controls.enabled = true
        this.controls.update()
      }
    } else {
      this.controls.update()
    }

    // 昼夜过渡（约 1.5 秒）
    if (this.night !== this.nightTarget) {
      const s = Math.sign(this.nightTarget - this.night)
      this.night = Math.min(1, Math.max(0, this.night + s * dt * 0.7))
      this._applyNight(smooth(this.night))
    }

    // 移轴模糊：全景时上下虚，近景关闭
    const blur = 2.2 * this.tilt
    this.tiltH.uniforms.h.value = blur / (this.size?.[0] || 1920)
    this.tiltV.uniforms.v.value = blur / (this.size?.[1] || 1080)
    this.tiltH.enabled = this.tiltV.enabled = this.tilt > 0.02

    // 光点沿回家路线走（约 40 秒一趟，走到家门口停一下再从路口出发）
    const u = (t % 46) / 40
    this.walker.position.copy(this.routeCurve.getPointAt(Math.min(1, u)))
    this.walker.visible = !this.intro
    // 炊烟：傍晚最浓，夜里淡一些
    const smokeK = 1 - 0.5 * this.night
    for (const s of this.smoke) {
      const p = (t * 0.06 + s.userData.phase) % 1
      s.position.set(
        this.smokeBase.x + Math.sin(p * 5 + s.userData.phase * 9) * 0.8 + p * 4,
        this.smokeBase.y + p * 14,
        this.smokeBase.z - p * 2
      )
      const sc = 1.2 + p * 5
      s.scale.set(sc, sc, 1)
      s.material.opacity =
        Math.sin(Math.PI * p) * 0.35 * smokeK * (this.intro ? 0 : 1)
    }

    if (this.intro || this.shadowDirty) {
      this.renderer.shadowMap.needsUpdate = true
      this.shadowDirty = false
    }
    this.composer.render()
    this._emitAnchors()
  }

  /** 屏幕坐标 → 设计稿坐标（页面按 1920 宽等比缩放） */
  _project(v) {
    const p = v.clone().project(this.camera)
    if (p.z > 1) return null
    const [w, h] = this.size
    const s = DESIGN_W / w
    return [((p.x + 1) / 2) * w * s, ((1 - p.y) / 2) * h * s]
  }

  _emitAnchors() {
    if (!this.size || this.intro) return this.onAnchors(null)
    const v3 = (a) => new THREE.Vector3(...a)
    const out = {
      view: this.view,
      moving: !!this.tween,
      nodes: SITE.nodes.map((i) =>
        this._project(v3(SITE.route[i]).add(new THREE.Vector3(0, 0.6, 0)))
      ),
      home: this._project(homePoint(0, 0, 13))
    }
    this.onAnchors(out)
  }

  // ================================================================ 释放

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frameId)
    this.resizeObserver.disconnect()
    this.intro?.finish()
    this.controls.dispose()
    this.backdrop.dispose()
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose()
      const ms = o.material
        ? Array.isArray(o.material)
          ? o.material
          : [o.material]
        : []
      for (const m of ms) {
        for (const v of Object.values(m)) if (v && v.isTexture) v.dispose()
        m.dispose()
      }
    })
    this.groundTex?.forEach((t) => t.dispose())
    this.satTex?.dispose()
    this.smokeTex?.dispose()
    this.composer.dispose()
    this.renderer.dispose()
    if (window.__hometownScene === this) delete window.__hometownScene
  }
}

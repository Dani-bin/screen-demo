/*
 * 三维校园场景总装
 * ----------------------------------------------------------
 * 本模块不依赖 Vue，可独立运行与调试；Vue 组件只负责挂载、
 * 传入数据、接收回调。这样三维逻辑与界面逻辑互不牵扯。
 *
 * 生命周期：new SchoolScene(...) -> 自动开始渲染 -> dispose() 释放。
 */
import {
  ACESFilmicToneMapping,
  Clock,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  PerspectiveCamera,
  PCFSoftShadowMap,
  Scene,
  SRGBColorSpace,
  WebGLRenderer
} from "three"
import { createMaterials } from "./materials"
import { createBuildings, createWalls } from "./buildings"
import {
  createCampusProps,
  createClockTower,
  createGate,
  createOctagonHall
} from "./landmarks"
import { createPlayground } from "./playground"
import { createPlaza } from "./plaza"
import { createVegetation } from "./vegetation"
import { CameraTour } from "./cameraTour"
import { createPicker } from "./picking"
import { rectGround } from "./geometry"
import { CAMPUS, PLAZA } from "./layout"

/* ---- 光照参数：集中在此，调整画面明暗只改这几个值 ---- */
const HEMI_INTENSITY = 1.15
const SUN_INTENSITY = 3.3
const TONE_EXPOSURE = 1.0

/** 设备像素比上限：大屏常为高分屏，不设限会让填充率吃紧 */
const MAX_PIXEL_RATIO = 1.5

export class SchoolScene {
  /**
   * @param {object} options
   * @param {HTMLCanvasElement} options.canvas
   * @param {HTMLElement} options.container 用于测量渲染尺寸
   * @param {Array} options.landmarks
   * @param {Function} options.onStopChange
   * @param {Function} options.onPlayingChange
   */
  constructor(options) {
    this.canvas = options.canvas
    this.container = options.container
    this.landmarks = options.landmarks
    this.visible = true
    this.disposed = false

    this._initRenderer()
    this._initScene()
    this._buildCampus()
    this._initTour(options)
    this._initEvents()

    this.clock = new Clock()
    this._loop = this._loop.bind(this)
    this.frameId = requestAnimationFrame(this._loop)
  }

  _initRenderer() {
    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: true
    })
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO)
    )
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFSoftShadowMap
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = TONE_EXPOSURE
    this._resize()
  }

  _initScene() {
    this.scene = new Scene()
    this.scene.background = new Color("#CBDDEA")
    this.scene.fog = new Fog("#CBDDEA", 380, 900)

    const { width, height } = this._size()
    this.camera = new PerspectiveCamera(42, width / height, 0.5, 900)
    this.camera.position.set(-92, 140, 185)

    // 上午十点左右的日光：半球光给天地色，平行光投影
    this.scene.add(new HemisphereLight("#BFD6E6", "#6E6552", HEMI_INTENSITY))
    const sun = new DirectionalLight("#FFF1DC", SUN_INTENSITY)
    sun.position.set(-92, 120, 72)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    const cam = sun.shadow.camera
    // 阴影正交范围要覆盖整个用地（130 × 152），小了会出现阴影被截断的硬边
    cam.left = -115
    cam.right = 115
    cam.top = 125
    cam.bottom = -125
    cam.near = 10
    cam.far = 420
    sun.shadow.bias = -0.0008
    this.scene.add(sun)
    this.scene.add(sun.target)
    this.sun = sun
  }

  _buildCampus() {
    this.materials = createMaterials()
    this.root = new Group()
    this.scene.add(this.root)

    const m = this.materials

    // 校外环境与校园绿地底盘
    this.root.add(rectGround(600, 600, m.ground, 0, -0.35, 0))
    this.root.add(
      rectGround(
        CAMPUS.width,
        CAMPUS.depth,
        m.grass,
        CAMPUS.centerX,
        -0.15,
        CAMPUS.centerZ
      )
    )
    // 中轴广场：北段米黄铺装（水景所在），南段橙色活动场地
    const { paving, activity } = PLAZA
    this.root.add(
      rectGround(paving.w, paving.d, m.paving, paving.x, 0.02, paving.z)
    )
    this.root.add(
      rectGround(
        activity.w,
        activity.d,
        m.forecourt,
        activity.x,
        0.02,
        activity.z
      )
    )

    this.root.add(createPlayground(m))

    const plaza = createPlaza(m)
    this.jets = plaza.jets
    this.root.add(plaza.group)

    this.root.add(createBuildings(m))
    this.root.add(createClockTower(m))
    this.root.add(createOctagonHall(m))
    this.root.add(createGate(m))
    this.root.add(createWalls(m))
    this.root.add(createVegetation(m))
    this.root.add(createCampusProps(m))
  }

  _initTour(options) {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches

    this.tour = new CameraTour({
      camera: this.camera,
      domElement: this.canvas,
      landmarks: this.landmarks,
      onStopChange: options.onStopChange,
      onPlayingChange: options.onPlayingChange,
      reduceMotion
    })
    this.tour.gotoStop(0, false)
  }

  _initEvents() {
    this.pick = createPicker(this.canvas, this.camera, this.root)

    this._onClick = (e) => {
      const stop = this.pick(e)
      if (stop !== null) this.tour.gotoStop(stop, true)
    }
    this.canvas.addEventListener("click", this._onClick)

    // 页面切到后台时停渲染，避免大屏长时间挂起仍空耗 GPU
    this._onVisibility = () => {
      this.visible = !document.hidden
    }
    document.addEventListener("visibilitychange", this._onVisibility)

    this._onResize = () => this._resize()
    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(this._onResize)
      this.resizeObserver.observe(this.container)
    } else {
      window.addEventListener("resize", this._onResize)
    }
  }

  _size() {
    const rect = this.container.getBoundingClientRect()
    return {
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height))
    }
  }

  _resize() {
    const { width, height } = this._size()
    this.renderer.setSize(width, height, false)
    if (this.camera) {
      this.camera.aspect = width / height
      this.camera.updateProjectionMatrix()
    }
  }

  /** 供外部（导览栏按钮）调用 */
  gotoStop(index) {
    this.tour.gotoStop(index, true)
  }

  _loop() {
    if (this.disposed) return
    this.frameId = requestAnimationFrame(this._loop)
    if (!this.visible) return

    const dt = Math.min(this.clock.getDelta(), 0.05)

    // 喷泉水柱轻微起伏
    const t = this.clock.elapsedTime
    this.jets.forEach((jet, i) => {
      jet.scale.y = 1 + Math.sin(t * 3 + i) * 0.14
    })

    this.tour.update(dt)
    this.renderer.render(this.scene, this.camera)
  }

  /** 释放全部资源，页面卸载时必须调用 */
  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frameId)

    this.canvas.removeEventListener("click", this._onClick)
    document.removeEventListener("visibilitychange", this._onVisibility)
    if (this.resizeObserver) this.resizeObserver.disconnect()
    else window.removeEventListener("resize", this._onResize)

    this.tour.dispose()

    // 递归释放几何体；材质由 materials.dispose 统一处理
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose()
    })
    this.materials.dispose()
    this.renderer.dispose()
  }
}

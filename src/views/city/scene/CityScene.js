/*
 * 三维城市场景总装
 * ----------------------------------------------------------
 * 本模块不依赖 Vue，可独立运行与调试；Vue 组件只负责挂载、
 * 传入数据、接收回调。
 *
 * 生命周期：new CityScene(...) -> 自动开始渲染 -> dispose() 释放。
 */
import {
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Timer,
  WebGLRenderer
} from "three"
import {
  CSS2DObject,
  CSS2DRenderer
} from "three/examples/jsm/renderers/CSS2DRenderer.js"
import { THEME } from "./theme.js"
import { createProjection } from "./projection.js"
import { createMaterials } from "./materials.js"
import { createTerrain } from "./terrain.js"
import { createRivers, createRoads } from "./roads.js"
import { createBuildings, createHighlight } from "./buildings.js"
import { createTrees } from "./trees.js"
import { createMarkers } from "./markers.js"
import { CameraTour } from "./cameraTour.js"
import { createPicker } from "./picking.js"
import { polygonCenter } from "./utils.js"

const DEG = Math.PI / 180

export class CityScene {
  /**
   * @param {object} options
   * @param {HTMLCanvasElement} options.canvas
   * @param {HTMLElement} options.labelLayer CSS2D 标签容器（铺满场景、pointer-events: none）
   * @param {HTMLElement} options.container 用于测量渲染尺寸
   * @param {object} options.geometry 预处理几何数据
   * @param {Array} options.spots 景点数组（含 lon / lat / cam.offset）
   * @param {Function} options.onStopChange 停靠站变化 (index)
   * @param {Function} options.onPlayingChange 巡览状态变化 (playing)
   * @param {Function} options.onViewChange 视角变化 ({ heading, scaleMeters })
   */
  constructor(options) {
    this.canvas = options.canvas
    this.labelLayer = options.labelLayer
    this.container = options.container
    this.geometry = options.geometry
    this.theme = THEME
    this.visible = true
    this.disposed = false
    this.onViewChange = options.onViewChange || (() => {})
    this.lastView = { heading: NaN, scaleMeters: NaN }

    this.project = createProjection(this.geometry.meta.origin)
    // 景点补上局部坐标
    this.spots = options.spots.map((s) => {
      const [x, z] = this.project.toLocal(s.lon, s.lat)
      return { ...s, x, z }
    })

    this._initRenderer()
    this._initScene()
    this._buildCity()
    this._initTour(options)
    this._initEvents()

    // three r186 起 Clock 已弃用，改用 Timer：每帧先 update(时间戳) 再取 delta
    this.timer = new Timer()
    this._loop = this._loop.bind(this)
    this.frameId = requestAnimationFrame(this._loop)
  }

  _initRenderer() {
    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true })
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, this.theme.maxPixelRatio)
    )
    this.renderer.shadowMap.enabled = true
    // r186 起 PCFSoftShadowMap 已移除（会回退并告警），PCFShadowMap 即为柔化阴影
    this.renderer.shadowMap.type = PCFShadowMap
    this.renderer.outputColorSpace = SRGBColorSpace
    // Neutral 比 ACES 更保色，缤纷配色不会被压灰
    this.renderer.toneMapping = NeutralToneMapping
    this.renderer.toneMappingExposure = this.theme.exposure

    this.labelRenderer = new CSS2DRenderer({ element: this.labelLayer })
    this._resize()
  }

  _initScene() {
    const t = this.theme
    this.scene = new Scene()
    this.scene.background = new Color(t.background)

    const { width, height } = this._size()
    this.camera = new PerspectiveCamera(
      t.camera.fov,
      width / height,
      t.camera.near,
      t.camera.far
    )

    const L = t.light
    this.scene.add(
      new HemisphereLight(L.hemiSky, L.hemiGround, L.hemiIntensity)
    )
    const sun = new DirectionalLight(L.sun, L.sunIntensity)
    sun.position.set(...L.sunPosition)
    sun.castShadow = true
    sun.shadow.mapSize.set(L.shadowMapSize, L.shadowMapSize)
    // 阴影正交范围要覆盖整个城区，小了会出现阴影被截断的硬边；改完范围要刷新投影矩阵
    Object.assign(sun.shadow.camera, L.shadowBox)
    sun.shadow.camera.updateProjectionMatrix()
    sun.shadow.bias = -0.0005
    sun.shadow.normalBias = 1.5
    this.scene.add(sun)
    this.scene.add(sun.target)
  }

  _buildCity() {
    const d = this.geometry
    this.materials = createMaterials(this.theme)
    this.root = new Group()
    this.scene.add(this.root)

    this.root.add(createTerrain(d, this.materials))
    this.root.add(createRivers(d.rivers, this.materials, this.theme))
    this.root.add(createRoads(d.roads, this.materials, this.theme))

    this.buildings = createBuildings(d.buildings, this.theme)
    this.root.add(this.buildings.mesh)

    this.trees = createTrees(d, this.materials, this.theme)
    this.root.add(this.trees.group)

    this.markers = createMarkers(this.spots, this.materials, this.theme)
    this.root.add(this.markers.group)

    this.highlight = null
    this.bubble = null
  }

  _initTour(options) {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
    // 每站机位：景点落点 + 偏移，注视景点落点
    const stops = this.spots.map((s) => ({
      p: [s.x + s.cam.offset[0], s.cam.offset[1], s.z + s.cam.offset[2]],
      t: [s.x, 0, s.z]
    }))
    this.tour = new CameraTour({
      camera: this.camera,
      domElement: this.canvas,
      stops,
      overview: this.theme.camera.overview,
      limits: this.theme.camera,
      timing: this.theme.tour,
      onStopChange: (index) => {
        this.markers.setActive(index)
        if (options.onStopChange) options.onStopChange(index)
      },
      onPlayingChange: options.onPlayingChange,
      reduceMotion
    })
    this.tour.gotoStop(0, false)
  }

  _initEvents() {
    this.pick = createPicker(
      this.canvas,
      this.camera,
      this.buildings.mesh,
      this.buildings.faceToBuilding
    )

    // 区分点击与拖拽：按下与抬起位置相距超过 6px 视为拖拽，不触发拾取
    this._downAt = null
    this._onDown = (e) => {
      // 只认主键（左键 / 单指），右键与中键不触发拾取
      if (e.button !== 0) return
      this._downAt = [e.clientX, e.clientY]
    }
    this._onUp = (e) => {
      if (!this._downAt) return
      const moved = Math.hypot(
        e.clientX - this._downAt[0],
        e.clientY - this._downAt[1]
      )
      this._downAt = null
      if (moved > 6) return
      this.selectBuilding(this.pick(e))
    }
    this.canvas.addEventListener("pointerdown", this._onDown)
    this.canvas.addEventListener("pointerup", this._onUp)

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

  /** 选中楼体：高亮 + 气泡；传 null 取消 */
  selectBuilding(index) {
    if (this.highlight) {
      this.root.remove(this.highlight)
      this.highlight.geometry.dispose()
      this.highlight = null
    }
    if (this.bubble) {
      this.root.remove(this.bubble)
      this.bubble.element.remove()
      this.bubble = null
    }
    if (index === null || index === undefined) return

    const b = this.geometry.buildings[index]
    this.highlight = createHighlight(b, this.materials)
    if (this.highlight) this.root.add(this.highlight)

    const [cx, cz] = polygonCenter(b.p)
    // 楼名来自 OSM 外部数据，用 textContent 写入，杜绝 HTML 注入
    const el = document.createElement("div")
    el.className = "city-bubble"
    const name = document.createElement("b")
    name.textContent = b.n || "建筑"
    const height = document.createElement("span")
    height.textContent = `约 ${Math.round(b.h)} 米`
    el.append(name, height)
    this.bubble = new CSS2DObject(el)
    // CSS2DRenderer 每帧写内联 transform，页面 CSS 的 translate 会被覆盖；用 center 让气泡底边中点对准锚点
    this.bubble.center.set(0.5, 1)
    this.bubble.position.set(cx, b.h + 12, cz)
    this.root.add(this.bubble)
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
    this.labelRenderer.setSize(width, height)
    if (this.camera) {
      this.camera.aspect = width / height
      this.camera.updateProjectionMatrix()
    }
  }

  /* ---- 供页面调用的接口 ---- */
  gotoStop(index) {
    this.tour.gotoStop(index, true)
  }
  gotoOverview() {
    this.tour.gotoOverview()
  }
  zoomIn() {
    this.tour.zoom(0.8)
  }
  zoomOut() {
    this.tour.zoom(1.25)
  }
  setPlaying(value) {
    this.tour.setPlaying(value)
  }

  /** 视角变化时通知页面（指北针与比例尺），变化很小则不通知 */
  _emitView() {
    const heading = this.tour.getHeading()
    const { height } = this._size()
    // 注视点处 100px 对应的米数
    const metersPerPx =
      (2 * this.tour.getDistance() * Math.tan((this.camera.fov / 2) * DEG)) /
      height
    const scaleMeters = Math.round(metersPerPx * 100)
    const last = this.lastView
    if (
      Math.abs(heading - last.heading) < 0.5 &&
      Math.abs(scaleMeters - last.scaleMeters) < scaleMeters * 0.01
    )
      return
    this.lastView = { heading, scaleMeters }
    this.onViewChange(this.lastView)
  }

  _loop(timestamp) {
    if (this.disposed) return
    this.frameId = requestAnimationFrame(this._loop)
    if (!this.visible) return

    // 后台期间不 update，切回前台第一帧 delta 会很大，夹到 50ms 防止镜头跳变
    this.timer.update(timestamp)
    const dt = Math.min(this.timer.getDelta(), 0.05)
    this.tour.update(dt)
    this._emitView()
    this.renderer.render(this.scene, this.camera)
    this.labelRenderer.render(this.scene, this.camera)
  }

  /** 释放全部资源，页面卸载时必须调用 */
  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frameId)

    this.canvas.removeEventListener("pointerdown", this._onDown)
    this.canvas.removeEventListener("pointerup", this._onUp)
    document.removeEventListener("visibilitychange", this._onVisibility)
    if (this.resizeObserver) this.resizeObserver.disconnect()
    else window.removeEventListener("resize", this._onResize)

    this.selectBuilding(null)
    this.tour.dispose()
    this.markers.dispose()
    this.trees.dispose()
    this.buildings.dispose()
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose()
    })
    this.materials.dispose()
    this.timer.dispose()
    this.renderer.dispose()
  }
}

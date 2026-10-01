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
import { LABEL_LEAD, createMarkers } from "./markers.js"
import { CameraTour } from "./cameraTour.js"
import { createPicker } from "./picking.js"
import { nearestRegion, polygonCenter } from "./utils.js"
import { createLandmarks } from "./landmarks/index.js"
import { createCrowd } from "./crowd.js"
import {
  STOP_SHADOW_RADIUS,
  applyCityShadow,
  applyStopShadow,
  computeCityShadow
} from "./shadow.js"

const DEG = Math.PI / 180

export class CityScene {
  /**
   * @param {object} options
   * @param {HTMLCanvasElement} options.canvas
   * @param {HTMLElement} options.labelLayer CSS2D 标签容器（铺满场景、pointer-events: none）
   * @param {HTMLElement} options.container 用于测量渲染尺寸
   * @param {object} options.geometry 预处理几何数据
   * @param {Array} options.spots 景点数组（含 lon / lat / cam.offset，可选 cam.look）
   * @param {number} [options.startStop=0] 起始停靠站索引，越界时取 0
   * @param {Function} options.onStopChange 停靠站变化 (index)
   * @param {Function} options.onPlayingChange 巡览状态变化 (playing)
   * @param {Function} options.onViewChange 视角变化 ({ heading, scaleMeters })
   * @param {number} [options.labelSafeTop=0] 顶部保留带高度（设计稿 px）：景点标签框顶进入这一带时
   *   避让（当前站标签先下压、压不下再隐藏，其余隐藏，见 markers.js 的 avoidLabels）；0 为不避让顶部栏
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
    this.labelSafeTop = options.labelSafeTop || 0
    this.lastView = { heading: NaN, scaleMeters: NaN }
    // 减少动态：巡览跳过飞行动画、景点人群原地站立
    this.reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches

    // 构造中途失败（如 WebGL 上下文创建失败、数据异常）时，
    // 已创建的 GPU 资源与事件监听要先释放再抛出，由页面显示降级提示
    try {
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

      // three r186 起 Clock 已弃用，改用 Timer：每帧先 update(时间戳) 再取 delta。
      // connect(document) 让 Timer 在页面切回前台时重置，后台期间不累计时间
      this.timer = new Timer()
      this.timer.connect(document)
      this._loop = this._loop.bind(this)
      this.frameId = requestAnimationFrame(this._loop)
    } catch (err) {
      this.dispose()
      throw err
    }
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
    // 总览机位到注视点的距离（约 8200 m）：theme.camera 的 near / far 按这个距离取值，
    // 人工缩放拉到比它更远时，裁剪面以它为基准放大（见 _updateClip）
    const ov = t.camera.overview
    this.clipBaseDistance = Math.hypot(
      ov.p[0] - ov.t[0],
      ov.p[1] - ov.t[1],
      ov.p[2] - ov.t[2]
    )

    const L = t.light
    this.scene.add(
      new HemisphereLight(L.hemiSky, L.hemiGround, L.hemiIntensity)
    )
    // 保留太阳光引用：释放时要调用 sun.dispose() 回收阴影贴图
    const sun = new DirectionalLight(L.sun, L.sunIntensity)
    this.sun = sun
    sun.castShadow = true
    sun.shadow.mapSize.set(L.shadowMapSize, L.shadowMapSize)
    // 整城阴影范围要等全部投影物建完才能算，在 _buildCity 末尾设置
    this.shadowFitted = false
    this.scene.add(sun)
    // 平行光朝向 target；target 需在场景中才会更新 matrixWorld，否则阴影方向不对
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

    // 景点精细模型先建：它的替换区决定哪些通用楼不再画（excluded）。
    // 单个景点构建失败只跳过该景点（见 landmarks/index.js）
    this.landmarks = createLandmarks({
      geometry: d,
      spots: this.spots,
      theme: this.theme,
      project: this.project
    })
    this.root.add(this.landmarks.group)
    this.elapsed = 0 // 景点动画用的累计秒数

    // 景点人流：全城一套实例网格，飞抵站点时在该站步行路径上生成，离站淡出。
    // 挂在 root 而不是景点组下：射线拾取只查景点组，点到行人不会误触发飞往景点
    this.crowd = createCrowd(this.theme, { reduceMotion: this.reduceMotion })
    this.root.add(this.crowd.group)

    this.buildings = createBuildings(
      d.buildings,
      this.theme,
      this.landmarks.excluded
    )
    this.root.add(this.buildings.mesh)

    // 通用树避开景点模型：用景点注册表生成的占用网格（模型三角形投影 + 替换区）
    this.trees = createTrees(
      d,
      this.materials,
      this.theme,
      this.landmarks.occupancy
    )
    this.root.add(this.trees.group)

    // 景点模型给了底座高度（markerHeight > 0）就直接用；否则按楼栋估算：
    // 落点压在楼上时，落点球放到楼顶，避免被楼体吞没。
    // 估算只看仍在画的楼，已被景点替换的楼不画，球不能悬在看不见的楼顶上
    const excluded = this.landmarks.excluded
    this.markers = createMarkers(
      this.spots,
      this.materials,
      this.theme,
      excluded.size
        ? d.buildings.filter((b, i) => !excluded.has(i))
        : d.buildings,
      this.landmarks.markerHeights
    )
    this.root.add(this.markers.group)

    // 每块数据区域（主城区 + 各飞地）一张静态阴影：全部投影物建完后，对每块区域各实算一次
    // 正交范围、朝向与偏移（shadow.js 的 computeCityShadow）——楼栋轮廓、通用树的真实树冠、
    // 景点模型与落点球的 Mesh，含影子落到地面的深度。
    // 区域相距数公里，合成一张会把阴影框撑大约一倍、主城区阴影糊一倍，所以各算各的，
    // 每块只拟合自己的投影物（主城区约 8.0 km，与加飞地前一致；熊猫基地飞地约 4 km）。
    // 投影物按「离哪块区域的 clip 最近」归类（nearestRegion）：主城区的公园面不按 clip 裁剪，
    // 树会撒到 clip 外约 170 m，严格按 clip 内筛选会丢掉它们的阴影。
    // 初始为主城区的静态阴影；停靠站点时由 _fitShadow 收紧，离站 / 回总览 / 拉远时由
    // _resetShadow 恢复注视点所在区域的静态阴影
    const meta = d.meta
    this.regionClips = [meta.clip, ...(meta.enclaves || []).map((e) => e.clip)]
    this._regionOf = (x, z) => nearestRegion(x, z, this.regionClips)
    this.regionShadows = this.regionClips.map((_, i) =>
      computeCityShadow(
        {
          buildings: d.buildings,
          trees: this.trees.layout,
          objects: [this.landmarks.group, this.markers.group],
          within: (x, z) => this._regionOf(x, z) === i
        },
        this.theme.light
      )
    )
    this.shadowRegion = 0
    applyCityShadow(this.sun, this.theme.light, this.regionShadows[0])

    this.highlight = null
    this.bubble = null

    // 场景静态、太阳固定：阴影只绘制一次，之后每帧跳过阴影通道。
    // 选中楼体的高亮体不投射阴影，选中 / 取消时也无需重绘阴影。
    // 景点动画件（游船、喷泉）一律不投影（landmarks/index.js 的阴影约定），
    // 所以动画不需要逐帧重绘阴影；只有阴影范围切换（_fitShadow / _resetShadow）时重绘一次
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.shadowMap.needsUpdate = true
  }

  _initTour(options) {
    const reduceMotion = this.reduceMotion
    // 每站机位：景点落点 + 偏移，注视景点落点。
    // 高层地标的落点球在楼顶，注视点仍在地面会把球挤到画面顶部；
    // 注视点与相机一起抬高底座高度的一半，让地标（楼体 + 落点球）居中。
    // 注视点还可按 cam.look（[dx, dz] 米）水平平移：景点由相距较远的两处组成时
    // （人民公园的纪念碑与鹤鸣茶社、合江亭与安顺廊桥），对准两者之间才能同框。
    // 依赖 markers.bases，因此必须在 _buildCity 之后调用
    const stops = this.spots.map((s, i) => {
      const lift = this.markers.bases[i] * 0.5
      const off = s.cam.offset
      const [lx, lz] = s.cam.look || [0, 0]
      const tx = s.x + lx
      const tz = s.z + lz
      return {
        p: [tx + off[0], off[1] + lift, tz + off[2]],
        t: [tx, lift, tz]
      }
    })
    // 注视点可移动范围 = 各块拉数范围换成局部坐标的矩形：主城区 meta.bbox 与各飞地 meta.enclaves[].bbox
    // （[南, 西, 北, 东] 纬经度）。道路 / 河流按 bbox 外扩 300 m 裁剪（clip），楼栋落在 bbox 附近，
    // 注视点不出这些矩形，镜头就不会停在数据边缘外的空地上；
    // 人工操作时夹到离注视点最近的一块，飞行途中不夹取（见 CameraTour.apply）
    const meta = this.geometry.meta
    const bounds = [meta, ...(meta.enclaves || [])].map(({ bbox }) => {
      const [south, west, north, east] = bbox
      const [x0, z1] = this.project.toLocal(west, south)
      const [x1, z0] = this.project.toLocal(east, north)
      return { x: [x0, x1], z: [z0, z1] }
    })
    this.tour = new CameraTour({
      camera: this.camera,
      domElement: this.canvas,
      stops,
      overview: this.theme.camera.overview,
      limits: { ...this.theme.camera, bounds },
      timing: this.theme.tour,
      onStopChange: (index) => {
        this.markers.setActive(index)
        // 离站飞往下一站：先恢复整城阴影，飞行途中沿途楼体照常有影；飞抵后再收紧
        this._resetShadow()
        // 离站：上一站的行人淡出回收
        this.crowd.hide()
        if (options.onStopChange) options.onStopChange(index)
      },
      // 飞抵站点：阴影收紧到站点周围，景点细部阴影清晰；
      // 在该站步行路径上生成行人（种子固定，每次到站画面一致）
      onArrive: (index) => {
        const s = this.spots[index]
        this._fitShadow([s.x, 0, s.z], STOP_SHADOW_RADIUS)
        this.crowd.show(
          this.landmarks.walkwaysBySpot[index] || [],
          1000 + index
        )
      },
      onPlayingChange: (playing) => {
        // 巡览恢复时清掉人工选中的楼体，避免气泡跟着镜头飘到下一站
        if (playing) this.selectBuilding(null)
        if (options.onPlayingChange) options.onPlayingChange(playing)
      },
      reduceMotion
    })
    // 起始站由深链接 ?spot=N 指定；非整数或越界时回到第 0 站
    const start = options.startStop
    const startStop =
      Number.isInteger(start) && start >= 0 && start < stops.length ? start : 0
    this.tour.gotoStop(startStop, false)
  }

  _initEvents() {
    this.pick = createPicker(
      this.canvas,
      this.camera,
      this.buildings.mesh,
      this.buildings.faceToBuilding,
      this.landmarks
    )

    // 区分点击与拖拽：按下与抬起位置相距超过 6px 视为拖拽，不触发拾取
    // 记录按下的指针编号，只有同一指针抬起才算点击（多指触摸时互不干扰）
    this._downAt = null
    this._onDown = (e) => {
      // 只认主键（左键 / 单指），右键与中键不触发拾取
      if (e.button !== 0) return
      this._downAt = { x: e.clientX, y: e.clientY, id: e.pointerId }
    }
    this._onUp = (e) => {
      if (!this._downAt || e.pointerId !== this._downAt.id) return
      const moved = Math.hypot(
        e.clientX - this._downAt.x,
        e.clientY - this._downAt.y
      )
      this._downAt = null
      if (moved > 6) return
      const hit = this.pick(e)
      // 点中景点模型：飞往该景点（gotoStop 内会清除楼体选中并暂停巡览）
      if (hit && hit.spot !== undefined) this.gotoStop(hit.spot)
      else this.selectBuilding(hit ? hit.building : null)
    }
    // 指针被系统取消（触摸被手势打断等）时作废本次按下，避免之后误判为点击
    this._onCancel = (e) => {
      if (this._downAt && e.pointerId === this._downAt.id) this._downAt = null
    }
    this.canvas.addEventListener("pointerdown", this._onDown)
    this.canvas.addEventListener("pointerup", this._onUp)
    this.canvas.addEventListener("pointercancel", this._onCancel)

    // GPU 重置后上下文恢复：three.js 会重建 GPU 资源，但静态阴影需要重绘一次
    this._onContextRestored = () => {
      this.renderer.shadowMap.needsUpdate = true
    }
    this.canvas.addEventListener(
      "webglcontextrestored",
      this._onContextRestored
    )

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
    // 缓存尺寸，每帧的比例尺计算直接读缓存，避免逐帧 getBoundingClientRect 触发布局
    this.width = width
    this.height = height
    // 视口宽度同样缓存，供比例尺把设计稿 px 换算成屏幕 px
    this.viewportWidth = document.documentElement.clientWidth
    this.renderer.setSize(width, height, false)
    this.labelRenderer.setSize(width, height)
    if (this.camera) {
      this.camera.aspect = width / height
      this.camera.updateProjectionMatrix()
    }
  }

  /* ---- 供页面调用的接口 ---- */
  /* 手动飞往景点 / 总览时先取消选中楼体，避免气泡留在原地而镜头已飞走 */
  gotoStop(index) {
    this.selectBuilding(null)
    this.tour.gotoStop(index, true)
  }
  gotoOverview() {
    this.selectBuilding(null)
    this._resetShadow()
    // 总览尺度下小人看不见，淡出回收
    this.crowd.hide()
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

  /**
   * 阴影收紧到 center 周围 ±R 米（见 shadow.js），并重绘一次静态阴影。
   * 代价：停留期间离站点 R 以外的楼没有阴影；站点机位视野基本落在 R 以内，
   * 人工拉远、或滚轮缩放把注视点带离站点，视野超出收紧范围时由 _loop 调用 _resetShadow，
   * 恢复注视点所在区域的静态阴影
   */
  _fitShadow(center, R) {
    applyStopShadow(this.sun, this.theme.light, center, R)
    this.shadowFitted = true
    this.shadowCenter = center
    this.renderer.shadowMap.needsUpdate = true
  }

  /**
   * 恢复注视点（this.tour.target）所在区域的静态阴影（computeCityShadow 的范围与偏移、theme.light 的太阳位置）。
   * 已是该区域的静态阴影时直接返回，避免无谓重绘，所以 _loop 可以逐帧调用：
   * 注视点飞行途中换了区域、松弛滑回飞地、跨区滚轮缩放时，借此只切换一次
   */
  _resetShadow() {
    const t = this.tour.target
    const region = this._regionOf(t.x, t.z)
    if (!this.shadowFitted && region === this.shadowRegion) return
    applyCityShadow(this.sun, this.theme.light, this.regionShadows[region])
    this.shadowRegion = region
    this.shadowFitted = false
    this.renderer.shadowMap.needsUpdate = true
  }

  /**
   * 按相机距离调整裁剪面。透视深度缓冲在距离 d 处的分辨率约为 d² / (near × 2^24)：
   * 总览距离以内沿用 theme.camera 的 near / far；拉得更远时 near 按距离平方放大，
   * 注视点处的分辨率保持总览时的约 0.2 m，地面 / 绿地 / 水面 / 道路的错层不会闪烁；
   * far 按距离同比放大，远处地面不会被提前裁掉。
   * 拉到最远（theme.camera.radiusMax）时 near 也只有百米级，而俯仰 ≥ 20° 时相机离地至少为距离的 0.34 倍
   * （数千米），不会裁到楼顶。只在比例明显变化时重算投影矩阵
   */
  _updateClip() {
    const c = this.theme.camera
    const ratio = Math.max(1, this.tour.getDistance() / this.clipBaseDistance)
    const near = c.near * ratio * ratio
    if (Math.abs(near - this.camera.near) < this.camera.near * 0.01) return
    this.camera.near = near
    this.camera.far = c.far * ratio
    this.camera.updateProjectionMatrix()
  }

  /** 视角变化时通知页面（指北针与比例尺），变化很小则不通知 */
  _emitView() {
    const heading = this.tour.getHeading()
    // 注视点处每个屏幕像素对应的米数
    const metersPerPx =
      (2 * this.tour.getDistance() * Math.tan((this.camera.fov / 2) * DEG)) /
      this.height
    // 比例尺条在设计稿里宽 100px，但构建时被 pxtorem 换成 rem（rootValue 192），
    // 运行时 amfe-flexible 令 1rem = 视口宽 / 10，实际屏幕宽度 = 100 × 视口宽 / 1920。
    // 这里按实际屏幕像素换算，比例尺数字才与条长一致
    const designPx = 100 * (this.viewportWidth / 1920)
    const scaleMeters = Math.round(metersPerPx * designPx)
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

    this.timer.update(timestamp)
    // 上限 0.25 s 只防卡顿后镜头跳变：低帧率机器上 0.05 的上限会让巡览按真实时间的几分之一播放；
    // 下限 0 防止时间戳回退得到负值
    const dt = Math.max(0, Math.min(this.timer.getDelta(), 0.25))
    this.tour.update(dt)
    this._updateClip()
    // 停靠时人工拉远、或滚轮缩放把注视点带离站点，视野超出收紧范围：
    // 恢复注视点所在区域的静态阴影（各区域规则相同）。
    // 视野粗估为「注视点离收紧中心的水平距离 + 相机距离」；恢复后不会因拉近而重新收紧，只在下一次飞抵站点时收紧；
    // 因此各站机位距离加注视点平移（cam.look）必须小于 1.5 倍半径，否则一飞抵就会被这里立即恢复。
    // 未收紧时每帧调用 _resetShadow：注视点所在区域没变就直接返回（几次比较），
    // 跨区飞行途中、松弛滑回飞地、跨区缩放让注视点换了区域时才切换一次静态阴影
    if (this.shadowFitted) {
      const t = this.tour.target
      const [cx, , cz] = this.shadowCenter
      const reach = Math.hypot(t.x - cx, t.z - cz) + this.tour.getDistance()
      if (reach > STOP_SHADOW_RADIUS * 1.5) this._resetShadow()
    } else {
      this._resetShadow()
    }
    this.elapsed += dt
    this.landmarks.update(this.elapsed)
    this.crowd.update(dt)
    this._emitView()
    this.renderer.render(this.scene, this.camera)
    this.labelRenderer.render(this.scene, this.camera)
    this._avoidLabels()
  }

  /**
   * 景点标签避让顶部栏与互相避让（规则见 markers.js 的 avoidLabels），须在 labelRenderer.render 之后调用。
   * 保留带与引线长度是设计稿 px，构建时被 pxtorem 换成 rem、运行时 1rem = 视口宽 / 10，
   * 这里与比例尺同样按视口宽 / 1920 换算成屏幕 px。
   * 未设顶部保留带（labelSafeTop 为 0）时只做标签之间的避让
   */
  _avoidLabels() {
    const k = this.viewportWidth / 1920
    this.markers.avoidLabels(
      this.camera,
      this.width,
      this.height,
      this.labelSafeTop ? this.labelSafeTop * k : -Infinity,
      LABEL_LEAD * k
    )
  }

  /**
   * 释放全部资源，页面卸载时必须调用。
   * 构造中途失败时也会调用，因此每项资源都可能不存在，逐项判空。
   */
  dispose() {
    this.disposed = true
    if (this.frameId) cancelAnimationFrame(this.frameId)

    const canvas = this.canvas
    if (canvas && this._onDown) {
      canvas.removeEventListener("pointerdown", this._onDown)
      canvas.removeEventListener("pointerup", this._onUp)
      canvas.removeEventListener("pointercancel", this._onCancel)
    }
    if (canvas && this._onContextRestored) {
      canvas.removeEventListener(
        "webglcontextrestored",
        this._onContextRestored
      )
    }
    if (this._onVisibility) {
      document.removeEventListener("visibilitychange", this._onVisibility)
    }
    if (this.resizeObserver) this.resizeObserver.disconnect()
    else if (this._onResize)
      window.removeEventListener("resize", this._onResize)

    if (this.root) this.selectBuilding(null)
    this.tour?.dispose()
    this.landmarks?.dispose()
    this.crowd?.dispose()
    this.markers?.dispose()
    this.trees?.dispose()
    this.buildings?.dispose()
    this.scene?.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose()
    })
    this.materials?.dispose()
    this.timer?.dispose()
    // 释放阴影贴图（渲染目标），再释放渲染器并主动丢弃 WebGL 上下文：
    // 浏览器同时存活的上下文数量有限，反复进出页面不释放会挤掉旧上下文
    this.sun?.dispose()
    this.renderer?.dispose()
    this.renderer?.forceContextLoss()
  }
}

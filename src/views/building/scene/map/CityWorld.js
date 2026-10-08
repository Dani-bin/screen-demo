/*
 * 数字楼宇 · 城市级三维地图（成都高新区）
 * ----------------------------------------------------------
 * 实现方式移植自射阳应急大屏首页的 Map3DScene（mini3d 框架，源自开源 ThreeMaps）：
 *   GeoJSON → 墨卡托投影 → 挤出几何体；渐变顶面 + 流光侧壁 + 外轮廓流光 + 光柱立牌 + 光圈底座 + 旋转光环
 * 本场景在此基础上改为：
 *   - 焦点：高新区南区 5 个街道，柱子为各街道接入楼宇数（西区远在 20 km 外，城市级不展示）
 *   - 背景：成都区县面，按到地图中心的距离径向淡出，只给出周边的行政区脉络
 *   - 园区：成都金融城双子塔——金色光柱 + 焦点标记 + 可点击的园区卡片，是进入下一级（园区）的入口
 *   - 楼宇：高新区内 100 m 以上的真实高层楼宇做细光柱，悬浮显示名称与高度，并与园区之间连飞线
 *
 * 坐标约定（与原框架一致）：
 *   地图组 mapGroup 绕 x 轴转 -90°，组内局部坐标为投影后的 (x, -y, 高度)；
 *   世界坐标 = (x, 高度, y)，即 y（投影后向南为正）对应世界 z。
 */
import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  PointsMaterial,
  QuadraticBezierCurve3,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  TubeGeometry,
  Vector3
} from "three"
import gsap from "gsap"
import {
  BaseMap,
  ExtrudeMap,
  Focus,
  GradientShader,
  InteractionManager,
  Label3d,
  Line,
  Mini3d,
  Particles,
  Plane,
  emptyObject,
  geoMercator
} from "./mini3d"
import labelIcon from "./texture/label-icon.png"

/** 柱子颜色：c1 → c2 为柱身渐变，glow 为辉光 */
const BAR_COLORS = { c1: 0x50bbfe, c2: 0x77fbf5, glow: 0x77fbf5 }
/** 园区（双子塔）强调色：金色，与蓝青色的街道柱子拉开 */
const PARK_COLOR = 0xffc65a
/** 高层楼宇细光柱颜色 */
const TOWER_COLORS = { c1: 0x9fdcff, c2: 0xffffff }

/**
 * 给材质注入「按到中心的距离径向淡出」：背景底图只留地图周边一圈，外面渐隐到透明。
 * 判定用的是几何体局部坐标的 xy（地图组内的投影平面）。
 * @param {import("three").Material} material 需 transparent: true
 * @param {number} inner 开始变淡的半径
 * @param {number} outer 完全透明的半径
 */
function radialFade(material, inner, outer) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFadeInner = { value: inner }
    shader.uniforms.uFadeOuter = { value: outer }
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "varying vec2 vFadePos;\nvoid main() {")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvFadePos = transformed.xy;"
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "void main() {",
        "varying vec2 vFadePos;\nuniform float uFadeInner;\nuniform float uFadeOuter;\nvoid main() {"
      )
      .replace(
        "#include <dithering_fragment>",
        "#include <dithering_fragment>\ngl_FragColor.a *= 1.0 - smoothstep(uFadeInner, uFadeOuter, length(vFadePos));"
      )
  }
}

/**
 * @typedef {Object} CityWorldOptions
 * @property {Array}  streets   街道 [{ name, enName, center:[lng,lat], value }]
 * @property {string} barUnit   立牌数值单位
 * @property {number} labelLimit 立牌数量上限（其余街道只显示平贴名称）
 * @property {Object} park      园区 { name, enName, center, towers:[{ height, levels }] }
 * @property {Array}  towers    高层楼宇 [{ name, height, center }]
 * @property {Array}  neighbors 周边区县标签 [{ name, center, blur }]
 * @property {Object} mapConfig 投影参数（scripts/build-building-geo.mjs 生成）
 * @property {Object} camera    { start, end, target }
 * @property {Function} onHover      (街道名|null) 街道顶面悬浮
 * @property {Function} onHoverTower (楼宇|null) 高层楼宇悬浮
 * @property {Function} onPickPark   点击园区
 * @property {Function} onPlayComplete 入场动画结束
 */
export class CityWorld extends Mini3d {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./assets').Assets} assets
   * @param {CityWorldOptions} options
   */
  constructor(canvas, assets, options = {}) {
    const opts = Object.assign(
      {
        fogColor: 0x07162c,
        streets: [],
        barUnit: "栋",
        labelLimit: 5,
        barHeight: 2.4,
        barLabelLift: 0.2,
        barLabelScale: 0.0147,
        flatNameScale: 0.016,
        flatNameOffset: 0.42,
        // 悬浮高亮：在青色渐变底上提亮（原来的深海军蓝压暗了整块街道，像没选中）
        hoverColor: 0xffffff,
        hoverOpacity: 0.9,
        hoverEmissive: 0x3fdcff,
        hoverEmissiveIntensity: 0.55,
        park: null,
        towers: [],
        neighbors: [],
        mapConfig: null,
        camera: {}
      },
      options
    )
    // 透明画布：叠在页面的底座光环图上
    super(canvas, { alpha: true })
    this.options = opts
    this.cameraConfig = Object.assign(
      {
        start: [-13.77, 12.99, 39.28],
        end: [-0.14, 12.5, 19.5],
        target: [0, 0, 4.2]
      },
      opts.camera
    )
    const { mapConfig } = opts
    this.geoProjectionCenter = mapConfig.geoProjectionCenter
    this.geoProjectionScale = mapConfig.geoProjectionScale
    this.mapWidth = mapConfig.projectedWidth
    // 地图挤出厚度
    this.depth = 0.5
    const [, minLat, , maxLat] = mapConfig.bbox
    // 大标题放在南区南缘下方（朝向相机一侧）
    this.mapFocusLabelInfo = {
      name: "成都高新区 · 南区",
      enName: "CHENGDU HI-TECH ZONE · SOUTH",
      center: [
        mapConfig.geoProjectionCenter[0],
        minLat - (maxLat - minLat) * 0.06
      ]
    }
    this.played = false
    this.scene.fog = new Fog(opts.fogColor, 1, 50)

    const cam = this.camera.instance
    cam.position.set(...this.cameraConfig.start)
    cam.near = 1
    cam.far = 10000
    cam.updateProjectionMatrix()
    this.camera.controls.target.set(...this.cameraConfig.target)
    // 相机固定：立牌防重叠依赖固定视角
    this.camera.controls.enabled = false
    this.camera.controls.update()
    this.interactionManager = new InteractionManager(
      this.renderer.instance,
      cam,
      this.canvas
    )

    this.assets = assets
    this.initEnvironment()
    this.init()
  }

  init() {
    // CSS3D 标签组：与地图组同样绕 x 轴转 -90°，标签位置直接用地图局部坐标
    this.labelGroup = new Group()
    this.label3d = new Label3d(this)
    this.labelGroup.rotation.x = -Math.PI / 2
    this.scene.add(this.labelGroup)
    this.eventElement = []
    this.otherLabel = []
    this.barObjects = null

    this.createRotateBorder()
    this.createLabel()
    this.createMap()
    this.createEvent()
    this.createStroke()
    this.createPark()
    this.createTowers()
    this.createParticles()
    this.createTimeline()
  }

  /* ---------------- 入场动画 ---------------- */

  createTimeline() {
    const tl = gsap.timeline({
      // 所有子动画都结束后再做立牌防重叠，此时 DOM 矩形才是最终位置
      onComplete: () => this.resolveLabelOverlaps()
    })
    tl.pause()
    this.animateTl = tl
    tl.addLabel("focusMap", 1.5)
    tl.addLabel("focusMapOpacity", 2)
    tl.addLabel("bar", 3)
    tl.addLabel("park", 3.6)
    const [ex, ey, ez] = this.cameraConfig.end
    tl.to(this.camera.instance.position, {
      duration: 2,
      x: ex,
      y: ey,
      z: ez,
      ease: "circ.out"
    })
    tl.to(
      this.focusMapGroup.position,
      { duration: 1, x: 0, y: 0, z: 0 },
      "focusMap"
    )
    tl.to(
      this.focusMapGroup.scale,
      { duration: 1, x: 1, y: 1, z: 1, ease: "circ.out" },
      "focusMap"
    )
    tl.to(
      this.focusMapTopMaterial,
      { duration: 1, opacity: 1, ease: "circ.out" },
      "focusMapOpacity"
    )
    tl.to(
      this.focusMapSideMaterial,
      {
        duration: 1,
        opacity: 1,
        ease: "circ.out",
        onComplete: () => {
          this.focusMapSideMaterial.transparent = false
        }
      },
      "focusMapOpacity"
    )
    this.otherLabel.forEach((item, index) => {
      const element = item.element.querySelector(".other-label")
      tl.to(
        element,
        {
          duration: 1,
          delay: 0.1 * index,
          translateY: 0,
          opacity: 1,
          ease: "circ.out"
        },
        "focusMapOpacity"
      )
    })
    tl.to(
      this.mapLineMaterial,
      { duration: 0.5, delay: 0.3, opacity: 1 },
      "focusMapOpacity"
    )
    tl.to(
      this.rotateBorder1.scale,
      { delay: 0.3, duration: 1, x: 1, y: 1, z: 1, ease: "circ.out" },
      "focusMapOpacity"
    )
    tl.to(
      this.rotateBorder2.scale,
      { duration: 1, delay: 0.5, x: 1, y: 1, z: 1, ease: "circ.out" },
      "focusMapOpacity"
    )
    this.addBarTweens(tl)
    this.addParkTweens(tl)
  }

  /** 柱子 / 立牌 / 光圈 / 平贴名称的入场动画 */
  addBarTweens(tl) {
    const { bars, labels, quans, tags } = this.barObjects
    bars.forEach((item, index) => {
      tl.to(
        item.scale,
        { duration: 1, delay: 0.1 * index, x: 1, y: 1, z: 1, ease: "circ.out" },
        "bar"
      )
      tl.to(
        item.material,
        { duration: 1, delay: 0.1 * index, opacity: 1, ease: "circ.out" },
        "bar"
      )
    })
    labels.forEach((item, index) => {
      const element = item.element.querySelector(".provinces-label-wrap")
      const number = item.element.querySelector(".number .value")
      const numberVal = Number(number.innerText)
      const numberAnimate = { score: 0 }
      tl.to(
        element,
        {
          duration: 1,
          delay: 0.2 * index,
          translateY: 0,
          opacity: 1,
          ease: "circ.out"
        },
        "bar"
      )
      tl.to(
        numberAnimate,
        {
          duration: 1,
          delay: 0.2 * index,
          score: numberVal,
          onUpdate: () => {
            number.innerText = numberAnimate.score.toFixed(0)
          }
        },
        "bar"
      )
    })
    quans.forEach((item, index) => {
      tl.to(
        item.children[0].scale,
        { duration: 1, delay: 0.1 * index, x: 1, y: 1, z: 1, ease: "circ.out" },
        "bar"
      )
      tl.to(
        item.children[1].scale,
        { duration: 1, delay: 0.1 * index, x: 1, y: 1, z: 1, ease: "circ.out" },
        "bar"
      )
    })
    tags.forEach((item, index) => {
      const element = item.element.querySelector(".other-label")
      tl.to(
        element,
        {
          duration: 1,
          delay: 0.05 * index,
          translateY: 0,
          opacity: 1,
          ease: "circ.out"
        },
        "bar"
      )
    })
  }

  /** 园区光柱升起、楼宇细光柱依次长出、园区卡片浮现、飞线出现 */
  addParkTweens(tl) {
    const { beam, focus, label } = this.parkObjects
    tl.to(beam.scale, { duration: 1.2, y: 1, ease: "circ.out" }, "park")
    tl.to(this.twinGroup.scale, { duration: 1, y: 1, ease: "circ.out" }, "park")
    tl.to(
      focus.scale,
      { duration: 1, x: 0.7, y: 0.7, z: 0.7, ease: "circ.out" },
      "park"
    )
    this.towerObjects.pillars.forEach((pillar, index) => {
      tl.to(
        pillar.scale,
        { duration: 0.8, delay: 0.06 * index, z: 1, ease: "circ.out" },
        "park"
      )
    })
    const card = label.element.querySelector(".park-label-wrap")
    tl.to(
      card,
      { duration: 1, delay: 0.4, translateY: 0, opacity: 1, ease: "circ.out" },
      "park"
    )
    tl.call(
      () => {
        this.flyLineGroup.visible = true
        this.played = true
        this.options.onPlayComplete && this.options.onPlayComplete()
      },
      null,
      "park+=1.2"
    )
  }

  play() {
    this.time.resume()
    this.animateTl.timeScale(1)
    this.animateTl.play()
  }

  /* ---------------- 环境 ---------------- */

  initEnvironment() {
    this.scene.add(new AmbientLight(0xffffff, 5))
    const directionalLight = new DirectionalLight(0xffffff, 5)
    directionalLight.position.set(-30, 6, -8)
    this.scene.add(directionalLight)
    // 两盏青色点光，给立体地图侧壁打出冷色反光
    ;[
      { intensity: 800, x: -9, y: 3, z: -3 },
      { intensity: 200, x: 0, y: 2, z: 5 }
    ].forEach(({ intensity, x, y, z }) => {
      const light = new PointLight(0x1d5e5e, intensity, 10000)
      light.position.set(x, y, z)
      this.scene.add(light)
    })
  }

  /* ---------------- 地图本体 ---------------- */

  createMap() {
    const mapGroup = new Group()
    const focusMapGroup = new Group()
    this.focusMapGroup = focusMapGroup
    this.mapGroup = mapGroup
    const { background, backgroundLine } = this.createBackground()
    background.setParent(mapGroup)
    backgroundLine.setParent(mapGroup)
    const { map, mapTop, mapLine } = this.createFocusMap()
    map.setParent(focusMapGroup)
    mapTop.setParent(focusMapGroup)
    mapLine.setParent(focusMapGroup)
    // 入场前压扁在地面上，时间线里再弹起来。
    // 不能压到 0：挤出体的顶面、底面和上面那层可悬浮顶面会重合在同一平面上互相抢深度（z-fighting），
    // 相机飞入时整块地图闪烁、出现黑色裂片；保留 6% 的厚度，各层之间就有足够的深度差
    focusMapGroup.position.set(0, 0, -0.01)
    focusMapGroup.scale.set(1, 1, 0.06)
    mapGroup.add(focusMapGroup)
    mapGroup.rotation.x = -Math.PI / 2
    mapGroup.position.set(0, 0.2, 0)
    this.scene.add(mapGroup)
    this.createBars(this.options.streets)
  }

  /** 背景：成都区县面 + 区县描边，径向淡出 */
  createBackground() {
    const data = this.assets.instance.getResource("background")
    const projection = {
      geoProjectionCenter: this.geoProjectionCenter,
      geoProjectionScale: this.geoProjectionScale
    }
    const bgMaterial = new MeshLambertMaterial({
      color: new Color("#10294a"),
      transparent: true,
      opacity: 0.85,
      depthWrite: false
    })
    radialFade(bgMaterial, 9, 17)
    const background = new BaseMap(this, {
      ...projection,
      data,
      merge: true,
      material: bgMaterial,
      renderOrder: 2
    })
    const lineMaterial = new LineBasicMaterial({
      color: 0x3f82cd,
      transparent: true,
      opacity: 0.7,
      depthWrite: false
    })
    radialFade(lineMaterial, 9, 17)
    const backgroundLine = new Line(this, {
      ...projection,
      data,
      material: lineMaterial,
      renderOrder: 3
    })
    backgroundLine.lineGroup.position.z += 0.01
    return { background, backgroundLine }
  }

  /** 焦点：高新区街道立体地图（挤出体 + 可悬浮的顶面 + 白色街道分界线） */
  createFocusMap() {
    const mapJsonData = this.assets.instance.getResource("mapJson")
    const projection = {
      geoProjectionCenter: this.geoProjectionCenter,
      geoProjectionScale: this.geoProjectionScale
    }
    const [topMaterial, sideMaterial] = this.createFocusMaterial()
    this.focusMapTopMaterial = topMaterial
    this.focusMapSideMaterial = sideMaterial
    const map = new ExtrudeMap(this, {
      ...projection,
      position: new Vector3(0, 0, 0.11),
      data: mapJsonData,
      depth: this.depth,
      topFaceMaterial: topMaterial,
      sideMaterial,
      renderOrder: 9
    })
    // 顶面：沿 x 方向青色渐变的半透明面，悬浮时整块换成高亮材质
    // 可悬浮顶面：盖在挤出体顶面上方，往相机方向偏一点深度（polygonOffset），压扁时也不会和挤出体顶面打架
    const faceMaterial = new MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4
    })
    new GradientShader(faceMaterial, {
      uColor1: 0x12bbe0,
      uColor2: 0x0094b5,
      size: this.mapWidth
    })
    this.defaultMaterial = faceMaterial
    this.defaultLightMaterial = faceMaterial.clone()
    this.defaultLightMaterial.color = new Color(this.options.hoverColor)
    this.defaultLightMaterial.opacity = this.options.hoverOpacity
    this.defaultLightMaterial.emissive = new Color(this.options.hoverEmissive)
    this.defaultLightMaterial.emissiveIntensity =
      this.options.hoverEmissiveIntensity
    // clone 不带 onBeforeCompile，渐变要重新挂一次
    new GradientShader(this.defaultLightMaterial, {
      uColor1: 0x12bbe0,
      uColor2: 0x0094b5,
      size: this.mapWidth
    })
    const mapTop = new BaseMap(this, {
      ...projection,
      position: new Vector3(0, 0, this.depth + 0.22),
      data: mapJsonData,
      material: faceMaterial,
      renderOrder: 2
    })
    mapTop.mapGroup.children.forEach((group) => {
      group.children.forEach((mesh) => {
        if (mesh.type === "Mesh") this.eventElement.push(mesh)
      })
    })
    this.mapLineMaterial = new LineBasicMaterial({
      color: 0xffffff,
      opacity: 0,
      transparent: true,
      fog: false
    })
    const mapLine = new Line(this, {
      ...projection,
      data: mapJsonData,
      material: this.mapLineMaterial,
      renderOrder: 3
    })
    mapLine.lineGroup.position.z += this.depth + 0.23
    return { map, mapTop, mapLine }
  }

  /** 挤出体材质：顶面沿 x 渐变，侧壁贴流光纹理并持续向上滚动 */
  createFocusMaterial() {
    const width = this.mapWidth.toFixed(2)
    const injectHead = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        "void main() {",
        "varying vec3 vPosition;\nvoid main() {\n  vPosition = position;"
      )
      shader.fragmentShader = shader.fragmentShader.replace(
        "void main() {",
        "varying vec3 vPosition;\nuniform vec3 uColor1;\nuniform vec3 uColor2;\nvoid main() {"
      )
    }
    const topMaterial = new MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      fog: false,
      side: DoubleSide
    })
    topMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uColor1 = { value: new Color(0x2a6e92) }
      shader.uniforms.uColor2 = { value: new Color(0x102736) }
      injectHead(shader)
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        /* glsl */ `
        #ifdef OPAQUE
        diffuseColor.a = 1.0;
        #endif
        vec3 gradient = mix(uColor1, uColor2, vPosition.x / ${width});
        outgoingLight = outgoingLight * gradient;
        // 挤出体的顶面再压暗一半，主要靠上面那层可悬浮的顶面出色
        if (vPosition.z > 0.3) diffuseColor.a *= 0.5;
        gl_FragColor = vec4(outgoingLight, diffuseColor.a);
        `
      )
    }
    const sideMap = this.assets.instance.getResource("side")
    sideMap.wrapS = RepeatWrapping
    sideMap.wrapT = RepeatWrapping
    sideMap.repeat.set(1, 1.5)
    sideMap.offset.y += 0.065
    const sideMaterial = new MeshStandardMaterial({
      color: 0xffffff,
      map: sideMap,
      fog: false,
      opacity: 0,
      side: DoubleSide
    })
    this.time.on("tick", () => {
      sideMap.offset.y += 0.005
    })
    sideMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uColor1 = { value: new Color(0x2a6e92) }
      shader.uniforms.uColor2 = { value: new Color(0x2a6e92) }
      injectHead(shader)
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        /* glsl */ `
        #ifdef OPAQUE
        diffuseColor.a = 1.0;
        #endif
        vec3 gradient = mix(uColor1, uColor2, vPosition.z / 1.2);
        outgoingLight = outgoingLight * gradient;
        gl_FragColor = vec4(outgoingLight, diffuseColor.a);
        `
      )
    }
    return [topMaterial, sideMaterial]
  }

  /** 高新区外轮廓流光 */
  createStroke() {
    const texture = this.assets.instance.getResource("pathLine2")
    texture.wrapS = texture.wrapT = RepeatWrapping
    texture.repeat.set(2, 1)
    const pathLine = new Line(this, {
      geoProjectionCenter: this.geoProjectionCenter,
      geoProjectionScale: this.geoProjectionScale,
      position: new Vector3(0, 0, this.depth + 0.24),
      data: this.assets.instance.getResource("mapStroke"),
      material: new MeshBasicMaterial({
        color: 0x2bc4dc,
        map: texture,
        alphaMap: texture,
        fog: false,
        transparent: true,
        opacity: 1,
        blending: AdditiveBlending
      }),
      type: "Line3",
      renderOrder: 22,
      tubeRadius: 0.03
    })
    this.focusMapGroup.add(pathLine.lineGroup)
    this.time.on("tick", () => {
      texture.offset.x += 0.005
    })
  }

  /** 旋转光环：地图底下两圈反向转动的贴图 */
  createRotateBorder() {
    const max = 12
    const make = (map, width, opacity, speed, y) => {
      const plane = new Plane(this, {
        width,
        needRotate: true,
        rotateSpeed: speed,
        material: new MeshBasicMaterial({
          map,
          color: 0x48afff,
          transparent: true,
          opacity,
          side: DoubleSide,
          depthWrite: false,
          blending: AdditiveBlending
        }),
        position: new Vector3(0, y, 0)
      })
      plane.instance.rotation.x = -Math.PI / 2
      plane.instance.renderOrder = 6
      plane.instance.scale.set(0, 0, 0)
      plane.setParent(this.scene)
      return plane.instance
    }
    const res = this.assets.instance
    this.rotateBorder1 = make(
      res.getResource("rotationBorder1"),
      max * 1.178,
      0.2,
      0.001,
      0.28
    )
    this.rotateBorder2 = make(
      res.getResource("rotationBorder2"),
      max * 1.116,
      0.4,
      -0.004,
      0.3
    )
  }

  createParticles() {
    const particles = new Particles(this, {
      num: 10,
      range: 30,
      dir: "up",
      speed: 0.05,
      material: new PointsMaterial({
        map: Particles.createTexture(),
        size: 1,
        color: 0x00eeee,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
        vertexColors: true,
        blending: AdditiveBlending,
        sizeAttenuation: true
      })
    })
    const group = new Group()
    group.rotation.x = -Math.PI / 2
    this.scene.add(group)
    particles.setParent(group)
  }

  /* ---------------- 街道柱子 / 立牌 ---------------- */

  /**
   * 每个街道一根光柱（高度按接入楼宇数），数值最高的前 labelLimit 个带立牌，
   * 没有立牌的街道把名称平贴在地图表面（有立牌的立牌上已有名称，再贴一遍在北部小街道上会挤成一团）
   */
  createBars(data) {
    const { labelLimit, barHeight } = this.options
    const sorted = [...data].sort((a, b) => b.value - a.value)
    const barGroup = new Group()
    barGroup.rotation.x = -Math.PI / 2
    const quanGroup = new Group()
    this.barObjects = {
      group: barGroup,
      quanGroup,
      bars: [],
      labels: [],
      quans: [],
      tags: []
    }
    const max = sorted.length ? sorted[0].value : 1
    sorted.forEach((item, index) => {
      const geoHeight = barHeight * (item.value / max)
      const material = new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthTest: false,
        fog: false
      })
      new GradientShader(material, {
        uColor1: BAR_COLORS.c1,
        uColor2: BAR_COLORS.c2,
        size: geoHeight,
        dir: "y"
      })
      const geo = new BoxGeometry(0.07, 0.07, geoHeight)
      geo.translate(0, 0, geoHeight / 2)
      const bar = new Mesh(geo, material)
      bar.renderOrder = 5
      const [x, y] = this.geoProjection(item.center)
      bar.position.set(x, -y, this.depth + 0.45)
      bar.scale.set(1, 1, 0)
      bar.userData = { ...item }
      bar.add(...this.createHuiguang(geoHeight, BAR_COLORS.glow))
      barGroup.add(bar)
      this.barObjects.bars.push(bar)
      this.barObjects.quans.push(
        this.createQuan(new Vector3(x, this.depth + 0.44, y), quanGroup)
      )
      if (index < labelLimit) {
        this.barObjects.labels.push(
          this.createBarLabel(
            item,
            index,
            new Vector3(
              x,
              -y,
              this.depth + this.options.barLabelLift + geoHeight
            )
          )
        )
      }
    })
    sorted.slice(labelLimit).forEach((item) => {
      this.barObjects.tags.push(this.createFlatName(item))
    })
    this.scene.add(barGroup)
    this.scene.add(quanGroup)
  }

  createBarLabel(data, index, position) {
    const label = this.label3d.create("", "provinces-label", false)
    label.init(
      `<div class="provinces-label">
        <div class="provinces-label-wrap">
          <div class="number"><span class="value">${data.value}</span><span class="unit">${this.options.barUnit}</span></div>
          <div class="name">
            <span class="zh">${data.name}</span>
            <span class="en">${(data.enName || "").toUpperCase()}</span>
          </div>
          <div class="no">${index + 1}</div>
        </div>
      </div>`,
      position
    )
    this.label3d.setLabelStyle(label, this.options.barLabelScale, "x")
    label.userData.baseScale = this.options.barLabelScale
    label.setParent(this.labelGroup)
    return label
  }

  /** 平贴在地图表面的街道名称（不竖起来，随地图平面透视） */
  createFlatName(data) {
    const label = this.label3d.create("", "town-name", false)
    const [x, y] = this.geoProjection(data.center)
    label.init(
      `<div class="other-label">${data.name}</div>`,
      // 柱子与光圈都在街道锚点上，名称沿南北方向挪开一段（flatNameOffset 正值向南、负值向北），别压在光圈上
      new Vector3(x, -y - this.options.flatNameOffset, this.depth + 0.3)
    )
    label.userData.baseScale = this.options.flatNameScale
    this.label3d.setLabelStyle(label, this.options.flatNameScale, "x", 0)
    label.setParent(this.labelGroup)
    return label
  }

  /** 柱子三片交叉的辉光面 */
  createHuiguang(h, color) {
    const geometry = new PlaneGeometry(0.3, h)
    geometry.translate(0, h / 2, 0)
    const texture = this.assets.instance.getResource("huiguang")
    texture.colorSpace = SRGBColorSpace
    texture.wrapS = RepeatWrapping
    texture.wrapT = RepeatWrapping
    const material = new MeshBasicMaterial({
      color,
      map: texture,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending
    })
    const mesh = new Mesh(geometry, material)
    mesh.renderOrder = 10
    mesh.rotateX(Math.PI / 2)
    const mesh2 = mesh.clone()
    const mesh3 = mesh.clone()
    mesh2.rotateY((Math.PI / 180) * 60)
    mesh3.rotateY((Math.PI / 180) * 120)
    return [mesh, mesh2, mesh3]
  }

  /** 柱子底座光圈：两层贴图，外圈持续旋转 */
  createQuan(position, parent, size = 0.5, color = 0xffffff) {
    const res = this.assets.instance
    const geometry = new PlaneGeometry(size, size)
    const make = (map) => {
      const mesh = new Mesh(
        geometry,
        new MeshBasicMaterial({
          color,
          map,
          alphaMap: map,
          transparent: true,
          depthTest: false,
          fog: false,
          blending: AdditiveBlending
        })
      )
      mesh.renderOrder = 6
      mesh.rotateX(-Math.PI / 2)
      mesh.position.copy(position)
      mesh.scale.set(0, 0, 0)
      return mesh
    }
    const mesh1 = make(res.getResource("guangquan1"))
    const mesh2 = make(res.getResource("guangquan2"))
    mesh2.position.y -= 0.001
    const group = new Group()
    group.add(mesh1, mesh2)
    parent.add(group)
    this.time.on("tick", () => {
      mesh1.rotation.z += 0.05
    })
    return group
  }

  /* ---------------- 园区：成都金融城双子塔 ---------------- */

  createPark() {
    const { park } = this.options
    const [x, y] = this.geoProjection(park.center)
    const top = this.depth + 0.45
    const group = new Group()
    this.scene.add(group)

    // 金色光柱：开口圆柱，自下而上从实到虚
    const beamHeight = 3.6
    const beamGeo = new CylinderGeometry(0.09, 0.09, beamHeight, 32, 1, true)
    beamGeo.translate(0, beamHeight / 2, 0)
    const beam = new Mesh(
      beamGeo,
      new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color(PARK_COLOR) },
          uHeight: { value: beamHeight }
        },
        vertexShader: /* glsl */ `
          varying float vH;
          void main() {
            vH = position.y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uHeight;
          varying float vH;
          void main() {
            float t = clamp(vH / uHeight, 0.0, 1.0);
            gl_FragColor = vec4(uColor, pow(1.0 - t, 1.6) * 0.9);
          }`,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending
      })
    )
    beam.renderOrder = 30
    beam.position.set(x, top, y)
    beam.scale.y = 0
    group.add(beam)

    // 两塔缩影：两根并排的实心细柱（南北塔相距约 60 m，地图上放大成可辨认的间距）
    const twinGroup = new Group()
    const towerH = 0.95
    const twinMat = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      depthTest: false
    })
    new GradientShader(twinMat, {
      uColor1: 0xffb23e,
      uColor2: 0xfff4d6,
      size: towerH,
      dir: "y"
    })
    ;[-0.055, 0.055].forEach((dz) => {
      const g = new BoxGeometry(0.07, towerH, 0.07)
      g.translate(0, towerH / 2, 0)
      const m = new Mesh(g, twinMat)
      m.renderOrder = 31
      m.position.set(x, top, y + dz)
      twinGroup.add(m)
    })
    twinGroup.scale.y = 0.001
    group.add(twinGroup)
    this.twinGroup = twinGroup

    // 焦点标记（多层贴图旋转 + 呼吸扩散），金色
    const focusGroup = new Group()
    focusGroup.rotation.x = -Math.PI / 2
    const focus = new Focus(this, { color1: PARK_COLOR, color2: 0xfff1c9 })
    focus.position.set(x, -y, top - 0.01)
    focus.scale.setScalar(0)
    focusGroup.add(focus)
    this.scene.add(focusGroup)
    this.parkFocus = focus

    // 园区卡片（CSS3D），可点击：进入园区
    const label = this.label3d.create("", "park-label", false)
    const t0 = park.towers[0]
    label.init(
      `<div class="park-label-wrap">
        <div class="park-label-card">
          <div class="park-label-tag">重点园区</div>
          <div class="park-label-name">${park.name}</div>
          <div class="park-label-en">${park.enName}</div>
          <div class="park-label-meta">
            <span><b>${t0.height}</b>m</span>
            <span><b>${t0.levels}</b>层</span>
            <span><b>${park.towers.length}</b>栋塔楼</span>
          </div>
          <div class="park-label-enter">进入园区 <i>›</i></div>
        </div>
      </div>`,
      // 挂在光柱顶端：南边紧挨着桂溪街道的立牌，放低了会压住
      new Vector3(x, -y, top + beamHeight * 0.92)
    )
    this.label3d.setLabelStyle(label, 0.011, "x", Math.PI / 2, "auto")
    label.userData.baseScale = 0.011
    label.element.addEventListener("click", () => this.options.onPickPark?.())
    label.setParent(this.labelGroup)

    // 光柱也可点：给一根更粗的不可见拾取柱，比细光柱好点中
    const hit = new Mesh(
      new CylinderGeometry(0.25, 0.25, 1.4, 8),
      new MeshBasicMaterial({ visible: false })
    )
    hit.position.set(x, top + 0.7, y)
    group.add(hit)
    this.interactionManager.add(hit)
    hit.addEventListener("click", () => this.options.onPickPark?.())
    hit.addEventListener(
      "mouseover",
      () => (document.body.style.cursor = "pointer")
    )
    hit.addEventListener(
      "mouseout",
      () => (document.body.style.cursor = "default")
    )

    this.parkObjects = { beam, focus, label, x, y }
  }

  /* ---------------- 高层楼宇细光柱 + 飞线 ---------------- */

  createTowers() {
    const { towers, park } = this.options
    const group = new Group()
    group.rotation.x = -Math.PI / 2
    this.scene.add(group)
    this.towerObjects = { group, pillars: [] }
    // 高度按双子塔 218 m 归一：最高的细光柱约为园区塔楼缩影的 0.9 倍
    const ref = park.towers[0].height
    towers.forEach((tower) => {
      const h = 0.85 * (tower.height / ref)
      const material = new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        fog: false
      })
      new GradientShader(material, {
        uColor1: TOWER_COLORS.c1,
        uColor2: TOWER_COLORS.c2,
        size: h,
        dir: "y"
      })
      const geo = new BoxGeometry(0.035, 0.035, h)
      geo.translate(0, 0, h / 2)
      const pillar = new Mesh(geo, material)
      pillar.renderOrder = 24
      const [x, y] = this.geoProjection(tower.center)
      pillar.position.set(x, -y, this.depth + 0.45)
      pillar.scale.z = 0
      group.add(pillar)
      this.towerObjects.pillars.push(pillar)

      // 拾取：不可见的粗柱
      const hit = new Mesh(
        new BoxGeometry(0.16, 0.16, h + 0.1),
        new MeshBasicMaterial({ visible: false })
      )
      hit.geometry.translate(0, 0, (h + 0.1) / 2)
      hit.position.copy(pillar.position)
      hit.userData = { tower, top: this.depth + 0.45 + h }
      group.add(hit)
      this.interactionManager.add(hit)
      hit.addEventListener("mouseover", () => {
        document.body.style.cursor = "pointer"
        material.color.set(0xffe9a8)
        this.options.onHoverTower?.(tower, hit.userData.top)
      })
      hit.addEventListener("mouseout", () => {
        document.body.style.cursor = "default"
        material.color.set(0xffffff)
        this.options.onHoverTower?.(null)
      })
    })
    this.createFlyLines()
  }

  /** 园区 → 各高层楼宇的飞线：表示楼宇已接入同一平台 */
  createFlyLines() {
    const { towers } = this.options
    this.flyLineGroup = new Group()
    this.flyLineGroup.visible = false
    this.scene.add(this.flyLineGroup)
    const texture = this.assets.instance.getResource("mapFlyline")
    texture.wrapS = texture.wrapT = RepeatWrapping
    texture.repeat.set(0.5, 2)
    const material = new MeshBasicMaterial({
      map: texture,
      color: 0x3fd8ff,
      transparent: true,
      fog: false,
      opacity: 1,
      depthTest: false,
      blending: AdditiveBlending
    })
    this.time.on("tick", () => {
      texture.offset.x -= 0.006
    })
    const { x: px, y: py } = this.parkObjects
    const start = new Vector3(px, -py, 0)
    towers.forEach((tower) => {
      const [x, y] = this.geoProjection(tower.center)
      const end = new Vector3(x, -y, 0)
      // 楼宇都在园区附近，弧高按距离给，近的弧低一些
      const mid = start.clone().add(end).multiplyScalar(0.5)
      mid.setZ(0.4 + start.distanceTo(end) * 0.6)
      const curve = new QuadraticBezierCurve3(start, mid, end)
      const mesh = new Mesh(
        new TubeGeometry(curve, 32, 0.012, 2, false),
        material
      )
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set(0, this.depth + 0.45, 0)
      mesh.renderOrder = 21
      this.flyLineGroup.add(mesh)
    })
  }

  /* ---------------- 标签 ---------------- */

  /** 周边区县标签 / 高新区大标题 */
  createLabel() {
    const { neighbors } = this.options
    neighbors.forEach((item) => {
      const label = this.label3d.create(
        "",
        `china-label${item.blur ? " blur" : ""}`,
        false
      )
      const [x, y] = this.geoProjection(item.center)
      label.init(
        `<div class="other-label"><img class="label-icon" src="${labelIcon}">${item.name}</div>`,
        new Vector3(x, -y, 0.4)
      )
      this.label3d.setLabelStyle(label, 0.02, "x")
      label.setParent(this.labelGroup)
      this.otherLabel.push(label)
    })
    const info = this.mapFocusLabelInfo
    const label = this.label3d.create("", "map-label", false)
    const [x, y] = this.geoProjection(info.center)
    label.init(
      // 中文标题拆出「·」单独排：标题字间距大，「·」两边再带空格会显得很空
      `<div class="other-label"><span class="title">${info.name
        .split("·")
        .map((t) => t.trim())
        .join('<i class="dot">·</i>')}</span><span>${info.enName}</span></div>`,
      new Vector3(x, -y, 0.4)
    )
    this.label3d.setLabelStyle(label, 0.015, "x")
    label.setParent(this.labelGroup)
    // 大标题立在地图上，再向后仰一点朝向屏幕：完全竖直时相机从斜上方俯视、字被压扁；
    // 完全正对相机（入场动画结束后的固定机位）又不像立在地图上。取两者之间：
    // 从竖直姿态向「正对相机」的姿态转过 TITLE_TILT 的比例（0 = 竖直，1 = 正对屏幕）
    const TITLE_TILT = 0.1
    this.labelGroup.updateMatrixWorld(true)
    const upright = label.quaternion.clone()
    label.lookAt(new Vector3(...this.cameraConfig.end))
    label.quaternion.copy(upright.slerp(label.quaternion, TITLE_TILT))
    this.otherLabel.push(label)
  }

  /** 街道顶面悬浮高亮 */
  createEvent() {
    const paint = (mesh, material) =>
      mesh.traverse((obj) => {
        if (obj.isMesh) obj.material = material
      })
    const { onHover } = this.options
    this.eventElement.forEach((mesh) => {
      this.interactionManager.add(mesh)
      mesh.addEventListener("mouseover", (event) => {
        paint(event.target.parent, this.defaultLightMaterial)
        onHover && onHover(event.target.parent.userData.name)
      })
      mesh.addEventListener("mouseout", (event) => {
        paint(event.target.parent, this.defaultMaterial)
        onHover && onHover(null)
      })
    })
  }

  /**
   * 立牌防重叠：柱子越高立牌越往北投影，靠北的街道容易被南边高柱子的立牌压住。
   * 按屏幕矩形检测两两重叠，排名靠后的那块先翻到柱子左侧，翻过去还重叠再小步上抬。
   * 依赖 CSS3D 已渲染出的 DOM 矩形，需在入场动画全部结束、相机到位后调用。
   */
  resolveLabelOverlaps() {
    if (!this.barObjects) return
    const labels = this.barObjects.labels
    const wraps = labels.map((l) =>
      l.element.querySelector(".provinces-label-wrap")
    )
    const flipped = new Set()
    for (let iter = 0; iter < 30; iter++) {
      this.updateLabelScales()
      this.scene.updateMatrixWorld()
      this.label3d.update()
      const rects = wraps.map((w) => w.getBoundingClientRect())
      let moved = false
      for (let i = 0; i < labels.length && !moved; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const a = rects[i]
          const b = rects[j]
          if (!a.width || !b.width) continue
          const overlap = !(
            a.right < b.left ||
            b.right < a.left ||
            a.bottom < b.top ||
            b.bottom < a.top
          )
          if (!overlap) continue
          if (!flipped.has(labels[j])) {
            flipped.add(labels[j])
            wraps[j].style.transform = "translate(-50%, 0)"
          } else {
            labels[j].position.z += 0.2
          }
          moved = true
          break
        }
      }
      if (!moved) break
    }
  }

  /* ---------------- 工具 ---------------- */

  geoProjection(lngLat) {
    return geoMercator()
      .center(this.geoProjectionCenter)
      .scale(this.geoProjectionScale)
      .translate([0, 0])(lngLat)
  }

  /**
   * 经纬度 + 高度 → 画布内像素坐标，供 DOM 弹窗定位
   * @param {number[]} lngLat
   * @param {number} [z] 地图局部坐标系的高度
   */
  toScreen(lngLat, z = this.depth + 0.7) {
    const [x, y] = this.geoProjection(lngLat)
    const v = new Vector3(x, -y, z)
    this.labelGroup.localToWorld(v)
    v.project(this.camera.instance)
    return {
      x: (v.x * 0.5 + 0.5) * this.sizes.width,
      y: (-v.y * 0.5 + 0.5) * this.sizes.height
    }
  }

  /**
   * 立牌等大：CSS3D 标签会随透视近大远小，这里按「标签到相机距离 / 视点到相机距离」放大，抵消透视缩放
   */
  updateLabelScales() {
    if (!this.barObjects) return
    const cam = this.camera.instance
    const ref = cam.position.distanceTo(this.camera.controls.target) || 1
    const pos = new Vector3()
    const apply = (label) => {
      label.getWorldPosition(pos)
      label.scale.setScalar(
        (label.userData.baseScale * pos.distanceTo(cam.position)) / ref
      )
    }
    this.barObjects.labels.forEach(apply)
    this.barObjects.tags.forEach(apply)
    if (this.parkObjects) apply(this.parkObjects.label)
  }

  update() {
    super.update()
    this.updateLabelScales()
    this.interactionManager && this.interactionManager.update()
  }

  destroy() {
    this.animateTl && this.animateTl.kill()
    this.parkFocus && this.parkFocus.destroy()
    this.interactionManager && this.interactionManager.dispose()
    this.label3d && this.label3d.destroy()
    if (this.barObjects) {
      emptyObject(this.barObjects.group)
      emptyObject(this.barObjects.quanGroup)
    }
    document.body.style.cursor = "default"
    super.destroy()
  }
}

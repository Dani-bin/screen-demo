/*
 * 智慧牧场 三维沙盘（不依赖 Vue）
 * ----------------------------------------------------------
 * 真实地形 + Sentinel-2 影像的 12 × 8 km 沙盘，叠轮牧分区、保护带、营地 / 饮水点 / 场部 / 基站、牛羊、告警。
 * 页面（index.vue）和设计稿（docs/design/smart-ranch/drafts-source.html）共用。
 *
 * 设计稿（静态一帧）：
 *   const s = new RanchScene(el, { layout, theme: THEMES.a, baseUrl })
 *   await s.load()
 *   s.setState(state, { alarm, trail })   // 仿真状态 → 叠加图层、畜群点、告警
 *   s.setView({ target: [X, Y], dist, yaw, pitch, shift })
 *   s.render()
 * 页面（实时）：
 *   s.startLive(state, { onAnchors, onPick, onUser })   // 开渲染循环、轨道控制、牛羊插值
 *   s.update(state, { alarm, trail, layer, highlight })  // 每秒一份仿真状态
 *   s.flyTo(view, 秒)                                     // 镜头补间
 *
 * 坐标：沙盘坐标 (X 沿河谷指向东北, Y 跨河谷指向西北)，three.js 里 x = X，z = −Y，
 * y = (海拔 − 基准) × 竖向放大（主题里的 exag）。
 */
import gsap from "gsap"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { Line2 } from "three/examples/jsm/lines/Line2.js"
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js"
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js"

import { Animals } from "./animals.js"
import { drawMask, drawOverlay } from "./overlay.js"
import {
  homesteadGeometry,
  hqGeometry,
  propMaterial,
  stationGeometry,
  waterPointGeometry
} from "./props.js"
import {
  buildShadow,
  buildSurface,
  buildWalls,
  loadHeights,
  monthWeights,
  sunVector
} from "./terrain.js"

/** 营地、场部、饮水点、基站的显示放大倍数 */
const PROP_SCALE = 3

/**
 * 设计稿宽度：标注锚点、镜头偏移都按 1920 × 1080 设计稿的像素给出。
 * 默认 1 设计像素 = 画布宽 / 1920 实际像素；页面按宽高取小缩放时用构造参数 unit 传入实际比例
 */
const DESIGN_W = 1920

/** 按字符串播种的伪随机数（羊群点云的形状每次都一样） */
function rng(seed) {
  let a = 0
  for (const ch of String(seed))
    a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) >>> 0) + 1
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 正态分布随机数（Box–Muller） */
function gauss(r) {
  return Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r())
}

const POINT_VERT = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  uniform float uScale;
  uniform float uDpr;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // 全景时保持最小像素尺寸，拉近后按距离放大
    gl_PointSize = size * uDpr * clamp(uScale / -mv.z, 1.0, 5.0);
  }
`
const POINT_FRAG = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vColor, smoothstep(0.5, 0.32, d));
    #include <colorspace_fragment>
  }
`

const BEAM_VERT = /* glsl */ `
  varying float vH;
  void main() {
    vH = uv.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const BEAM_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vH;
  void main() {
    // 底部最亮，往上淡出
    gl_FragColor = vec4(uColor, pow(1.0 - vH, 1.6) * uOpacity);
    #include <colorspace_fragment>
  }
`

export class RanchScene {
  /**
   * @param {HTMLElement} container 画布容器
   * @param {object} opts.unit 可选：返回「1 设计像素 = 多少 CSS 像素」的函数，
   *   不给时按容器宽度 / 1920 算（设计稿页面固定 1920 宽）
   */
  constructor(container, { layout, theme, baseUrl = "/", unit = null }) {
    this.el = container
    this.unitFn = unit
    this.layout = layout
    this.theme = theme
    this.base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/"
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.setClearColor(0x000000, 0)
    container.appendChild(this.renderer.domElement)
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(28, 1, 50, 80000)
    this.view = {
      target: [0, 0],
      dist: 15000,
      yaw: 0,
      pitch: 38,
      shift: [0, 0]
    }
    /** 设计稿用：每次 setState 重建的牛羊点、告警、轨迹 */
    this.dynamic = new THREE.Group()
    /** 页面用：告警、轨迹（按需重建） */
    this.fx = new THREE.Group()
    this.scene.add(this.dynamic, this.fx)
    this.overlayOpts = {}
    this.resize()
  }

  /** 读高程和贴图，搭好静态部分（地表、侧壁、阴影、设施、灯光） */
  async load() {
    const L = this.layout
    const loader = new THREE.TextureLoader()
    const tex = (name, srgb) =>
      loader.loadAsync(this.base + "smart-ranch/" + name).then((t) => {
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
        t.anisotropy = 8
        return t
      })
    const [field, imagery, ndviA, ndviB] = await Promise.all([
      loadHeights(this.base + "smart-ranch/terrain_h.png", L),
      tex("imagery.webp", true),
      tex("ndvi_a.png", false),
      tex("ndvi_b.png", false)
    ])
    this.field = field
    this.overlayCanvas = document.createElement("canvas")
    const overlay = new THREE.CanvasTexture(this.overlayCanvas)
    overlay.colorSpace = THREE.SRGBColorSpace
    overlay.anisotropy = 8
    const mask = new THREE.CanvasTexture(drawMask(L))
    mask.colorSpace = THREE.NoColorSpace
    this.tex = { imagery, ndviA, ndviB, overlay, mask }

    const { mesh, base } = buildSurface(field, this.tex, this.theme, L)
    this.surface = mesh
    this.hBase = base
    this.scene.add(mesh)
    if (this.theme.edge.kind === "wall")
      this.scene.add(buildWalls(field, this.theme, L, base))
    if (this.theme.shadow) this.scene.add(buildShadow(this.theme, L))
    this.addLights()
    this.addProps()
  }

  /** 设施用的灯光（地表是自定义着色器，自己算光照） */
  addLights() {
    const t = this.theme
    const hemi = new THREE.HemisphereLight(t.ambient.sky, t.ambient.ground, 1.6)
    const sun = new THREE.DirectionalLight(t.sun.color, 2.2 * t.sun.intensity)
    sun.position.copy(
      sunVector(t.sun, this.layout.sandbox.theta).multiplyScalar(10000)
    )
    this.scene.add(hemi, sun)
  }

  /** 营地、场部、饮水点、基站：真实尺寸放在地面上，沿河谷方向摆正 */
  addProps() {
    const L = this.layout
    const mat = propMaterial()
    const place = (geo, items, yaw = 0) => {
      const mesh = new THREE.InstancedMesh(geo, mat, items.length)
      const m4 = new THREE.Matrix4()
      const q = new THREE.Quaternion()
      // 设施放大 PROP_SCALE 倍：真实尺寸在 1 km 视野里只有几个像素（地形本身也竖向放大了）
      const s = new THREE.Vector3(PROP_SCALE, PROP_SCALE, PROP_SCALE)
      items.forEach((it, i) => {
        const r = rng(it.id)
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + (r() - 0.5) * 0.3)
        m4.compose(this.world(it.pos[0], it.pos[1], 0), q, s)
        mesh.setMatrixAt(i, m4)
      })
      mesh.frustumCulled = false
      this.scene.add(mesh)
      return mesh
    }
    this.props = {
      homes: place(homesteadGeometry(), L.homesteads),
      hq: place(hqGeometry(), [L.hq]),
      water: place(waterPointGeometry(), L.water),
      stations: place(stationGeometry(), L.stations)
    }
  }

  /** 沙盘坐标处的场景高度（lift 为额外抬高的真实米数） */
  heightAt(X, Y, lift = 0) {
    return (this.field.z(X, Y) - this.hBase + lift) * this.theme.exag
  }

  world(X, Y, lift = 0) {
    return new THREE.Vector3(X, this.heightAt(X, Y, lift), -Y)
  }

  /** 长势月份（4–10，可带小数） */
  setMonth(m) {
    this.month = m
    const w = monthWeights(m)
    this.surface.material.uniforms.uWA.value.copy(w.a)
    this.surface.material.uniforms.uWB.value.copy(w.b)
  }

  /** 长势图层强度（0 关闭） */
  setNdviMix(v) {
    this.surface.material.uniforms.uNdviMix.value = v
  }

  /** 重画地表叠加图层（围栏、斜纹、文字、选中 / 告警分区、热力） */
  redrawOverlay(state, opts) {
    drawOverlay(this.layout, state, this.theme, {
      canvas: this.overlayCanvas,
      ...opts
    })
    this.tex.overlay.needsUpdate = true
  }

  // ---------------- 设计稿：静态一帧 ----------------

  /**
   * 仿真状态 → 叠加图层、畜群点、告警（设计稿用）
   * opts.alarm：{ kind, pos: [X, Y] }；opts.trail：轨迹点 [[X, Y], ...]；opts.next：下一块转场分区；opts.month：长势月份
   */
  setState(state, opts = {}) {
    this.redrawOverlay(state, {
      next: opts.next,
      alarmPaddock: opts.alarmPaddock,
      unitLabels: opts.unitLabels,
      remainBadges: opts.remainBadges
    })
    if (opts.month) this.setMonth(opts.month)
    this.dynamic.clear()
    this.dynamic.add(this.buildAnimals(state, opts))
    if (opts.trail?.length > 1) this.dynamic.add(this.buildTrail(opts.trail))
    if (opts.alarm)
      for (const o of this.buildAlarm(opts.alarm)) this.dynamic.add(o)
  }

  /** 羊群（每群一团点云 + 头羊）、牛（每头一个点）——设计稿的静态版本 */
  buildAnimals(state, opts) {
    const pos = []
    const col = []
    const size = []
    const c = new THREE.Color()
    const push = (X, Y, color, s, lift = 2) => {
      const p = this.world(X, Y, lift)
      pos.push(p.x, p.y, p.z)
      c.set(color).convertSRGBToLinear()
      col.push(c.r, c.g, c.b)
      size.push(s)
    }
    const a = this.theme.animal
    const alarmCow = opts.alarm?.kind === "fence" ? opts.alarm.target : null
    for (const h of state.herds) {
      if (h.kind === "sheep") {
        // 羊群点云：采食时散开约 70 m，饮水时聚拢，夜宿时挤在营地圈里
        const spread =
          h.activity === "graze" ? 70 : h.activity === "drink" ? 40 : 22
        const r = rng(h.id)
        for (let i = 0; i < 260; i++) {
          const ang = r() * Math.PI * 2
          const rad = Math.abs(gauss(r)) * spread
          push(
            h.pos[0] + Math.cos(ang) * rad * 1.3,
            h.pos[1] + Math.sin(ang) * rad * 0.8,
            a.sheep,
            2.2
          )
        }
        for (const l of h.leads) push(l.pos[0], l.pos[1], a.sheep, 4.2, 4)
      } else {
        h.cows.forEach((p, i) => {
          const id = `${h.id}-${String(i + 1).padStart(3, "0")}`
          if (id === alarmCow) push(p[0], p[1], a.alarm, 7, 4)
          else push(p[0], p[1], a.cattle, 3.4)
        })
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3))
    geo.setAttribute("size", new THREE.Float32BufferAttribute(size, 1))
    const mat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uScale: { value: 9000 },
        uDpr: { value: this.renderer.getPixelRatio() }
      }
    })
    const pts = new THREE.Points(geo, mat)
    pts.renderOrder = 2
    return pts
  }

  // ---------------- 轨迹、告警 ----------------

  /** 畜群轨迹：贴地的粗线 */
  buildTrail(points, color = this.theme.lines.grazing, width = 3) {
    const flat = []
    for (const [X, Y] of points) {
      const p = this.world(X, Y, 6)
      flat.push(p.x, p.y, p.z)
    }
    const geo = new LineGeometry()
    geo.setPositions(flat)
    const mat = new LineMaterial({
      color: new THREE.Color(color),
      linewidth: width,
      transparent: true,
      opacity: 0.95,
      depthTest: false
    })
    mat.resolution.set(this.width, this.height)
    const line = new Line2(geo, mat)
    line.computeLineDistances()
    line.renderOrder = 3
    return line
  }

  /** 告警：光柱 + 地面扩散环；越界时把被越过的那段保护带边界升起光墙；离群时画羊群到头羊的虚线 */
  buildAlarm(alarm) {
    const out = []
    const color = new THREE.Color(this.theme.alarm)
    const [X, Y] = alarm.pos
    const ground = this.heightAt(X, Y)
    const beamMat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: color }, uOpacity: { value: 0.9 } }
    })
    const beamH = 900
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(22, 22, beamH, 24, 1, true),
      beamMat
    )
    beam.position.set(X, ground + beamH / 2, -Y)
    beam.name = "beam"
    out.push(beam)
    // 地面环：两圈，外圈更淡；实时模式下外圈会循环扩散
    for (const [r0, r1, op, name] of [
      [70, 100, 0.85, "ring"],
      [190, 215, 0.4, "wave"]
    ]) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r0, r1, 64),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: op,
          depthWrite: false,
          depthTest: false
        })
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.set(X, ground + 8, -Y)
      ring.renderOrder = 4
      ring.name = name
      out.push(ring)
    }
    if (alarm.kind === "fence") out.push(this.buildFenceGlow(alarm.pos, color))
    if (alarm.kind === "stray" && alarm.from) {
      const pts = []
      for (let k = 0; k <= 24; k++) {
        const t = k / 24
        const p = this.world(
          alarm.from[0] + (X - alarm.from[0]) * t,
          alarm.from[1] + (Y - alarm.from[1]) * t,
          8
        )
        pts.push(p.x, p.y, p.z)
      }
      const geo = new LineGeometry()
      geo.setPositions(pts)
      const mat = new LineMaterial({
        color,
        linewidth: 2.5,
        dashed: true,
        dashSize: 60,
        gapSize: 40,
        depthTest: false
      })
      mat.resolution.set(this.width, this.height)
      const line = new Line2(geo, mat)
      line.computeLineDistances()
      line.renderOrder = 4
      out.push(line)
    }
    return out
  }

  /** 越界处那段保护带边界（前后各约 350 m）升起一道渐隐光墙 */
  buildFenceGlow(p, color) {
    let best = null
    for (const poly of this.layout.reserve.polygons)
      poly.forEach((q, i) => {
        const d = Math.hypot(q[0] - p[0], q[1] - p[1])
        if (!best || d < best.d) best = { poly, i, d }
      })
    const { poly, i } = best
    const n = poly.length
    const seg = [poly[i]]
    for (const dir of [1, -1]) {
      let acc = 0
      let k = i
      while (acc < 350) {
        const k2 = (k + dir + n) % n
        acc += Math.hypot(poly[k2][0] - poly[k][0], poly[k2][1] - poly[k][1])
        k = k2
        if (dir > 0) seg.push(poly[k])
        else seg.unshift(poly[k])
      }
    }
    const H = 80
    const pos = []
    const uv = []
    const index = []
    seg.forEach(([X, Y], k) => {
      const g = this.heightAt(X, Y, 1)
      pos.push(X, g, -Y, X, g + H, -Y)
      uv.push(k / (seg.length - 1), 0, k / (seg.length - 1), 1)
      if (k) {
        const a = (k - 1) * 2
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
    geo.setIndex(index)
    const mat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: color }, uOpacity: { value: 1.0 } }
    })
    const wall = new THREE.Mesh(geo, mat)
    wall.renderOrder = 3
    wall.name = "fence"
    return wall
  }

  // ---------------- 镜头 ----------------

  /** 视图参数 → 相机位置与观察点（世界坐标） */
  viewPose(v) {
    const { target, dist, yaw, pitch } = { ...this.view, ...v }
    const t = this.world(target[0], target[1])
    const yr = THREE.MathUtils.degToRad(yaw)
    const pr = THREE.MathUtils.degToRad(pitch)
    const pos = new THREE.Vector3(
      t.x + Math.sin(yr) * Math.cos(pr) * dist,
      t.y + Math.sin(pr) * dist,
      t.z + Math.cos(yr) * Math.cos(pr) * dist
    )
    return { pos, target: t }
  }

  /**
   * 镜头：绕 target（沙盘坐标）的球坐标。yaw = 0 时从东南岸（沙盘 −Y 方向）往西北看，
   * 正值往东北转；pitch 为俯角（度）；shift 为画面平移（设计稿像素，给两侧面板让位）
   */
  setView(v) {
    Object.assign(this.view, v)
    if (v.fov) this.camera.fov = v.fov
    const { pos, target } = this.viewPose(v)
    this.camera.position.copy(pos)
    this.camera.lookAt(target)
    if (this.controls) this.controls.target.copy(target)
    this.applyShift()
    this.updateFog()
  }

  /** 镜头补间到某个视图（秒），返回 Promise */
  flyTo(v, duration = 2.2) {
    Object.assign(this.view, v)
    const { pos, target } = this.viewPose(v)
    const from = {
      p: this.camera.position.clone(),
      t: this.controls ? this.controls.target.clone() : target.clone()
    }
    const st = { k: 0 }
    this.flyTween?.kill()
    return new Promise((resolve) => {
      this.flyTween = gsap.to(st, {
        k: 1,
        duration,
        ease: "power2.inOut",
        onUpdate: () => {
          this.camera.position.lerpVectors(from.p, pos, st.k)
          const t = from.t.clone().lerp(target, st.k)
          if (this.controls) this.controls.target.copy(t)
          this.camera.lookAt(t)
        },
        onComplete: resolve
      })
    })
  }

  /** 雾按到观察点的距离缩放，远边才有空气透视，近处保持清楚 */
  updateFog() {
    const f = this.theme.fog
    const target = this.controls
      ? this.controls.target
      : this.world(this.view.target[0], this.view.target[1])
    const dist = this.camera.position.distanceTo(target)
    this.camDist = dist
    const u = this.surface.material.uniforms.uFog.value
    u.set(f.near * dist, f.far * dist, f.max)
    this.scene.traverse((o) => {
      if (o !== this.surface && o.material?.uniforms?.uFog)
        o.material.uniforms.uFog.value.copy(u)
    })
    // 近景草地细节：拉近时淡入
    this.surface.material.uniforms.uDetail.value =
      1 - THREE.MathUtils.smoothstep(dist, 2500, 7000)
  }

  applyShift() {
    const [sx, sy] = this.view.shift || [0, 0]
    // shift 按设计稿像素给，换算到实际画布像素
    const k = this.unit
    if (sx || sy)
      this.camera.setViewOffset(
        this.width,
        this.height,
        -sx * k,
        -sy * k,
        this.width,
        this.height
      )
    else this.camera.clearViewOffset()
    this.camera.updateProjectionMatrix()
  }

  /** 沙盘坐标 → 容器内像素 */
  project(X, Y, lift = 0) {
    const p = this.world(X, Y, lift).project(this.camera)
    return {
      x: (p.x * 0.5 + 0.5) * this.width,
      y: (-p.y * 0.5 + 0.5) * this.height,
      behind: p.z > 1
    }
  }

  resize() {
    this.width = this.el.clientWidth || 1920
    this.height = this.el.clientHeight || 1080
    // 1 设计像素对应的画布像素
    this.unit = this.unitFn?.() || this.width / DESIGN_W
    this.renderer.setSize(this.width, this.height, false)
    this.renderer.domElement.style.width = "100%"
    this.renderer.domElement.style.height = "100%"
    this.camera.aspect = this.width / this.height
    if (this.surface) this.applyShift()
    this.scene.traverse((o) =>
      o.material?.resolution?.set(this.width, this.height)
    )
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }

  // ---------------- 页面：实时模式 ----------------

  /**
   * 开启实时模式：轨道控制、牛羊插值、渲染循环。
   * cb.onAnchors(a)：每帧回调标注锚点（设计稿坐标）；cb.onPick(hit)：点到地面（沙盘坐标）；cb.onUser()：用户拖动 / 缩放
   */
  startLive(state, cb = {}) {
    this.cb = cb
    this.animals = new Animals(this, state)
    this.scene.add(this.animals.group)
    const c = new OrbitControls(this.camera, this.renderer.domElement)
    c.enableDamping = true
    c.dampingFactor = 0.08
    c.minDistance = 700
    c.maxDistance = 42000
    c.maxPolarAngle = THREE.MathUtils.degToRad(76)
    c.target.copy(this.world(this.view.target[0], this.view.target[1]))
    c.addEventListener("start", () => {
      this.flyTween?.kill()
      cb.onUser?.()
    })
    this.controls = c
    // 点选：按下和抬起位置几乎不变才算点击（拖动旋转不算）
    const el = this.renderer.domElement
    let down = null
    el.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]))
    el.addEventListener("pointerup", (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4)
        return
      const hit = this.pick(e)
      if (hit) cb.onPick?.(hit)
    })
    this.state = state
    this.running = true
    this.t0 = performance.now()
    this.tPrev = this.t0
    this.loop = this.loop.bind(this)
    this.frame = requestAnimationFrame(this.loop)
    // 切到后台停渲染，回来接着跑
    this.onVis = () => {
      if (document.hidden) cancelAnimationFrame(this.frame)
      else if (this.running) this.frame = requestAnimationFrame(this.loop)
    }
    document.addEventListener("visibilitychange", this.onVis)
  }

  /** 屏幕点 → 沙盘坐标（射线打地表） */
  pick(e) {
    const r = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1
    )
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, this.camera)
    const hit = ray.intersectObject(this.surface, false)[0]
    if (!hit) return null
    return { X: hit.point.x, Y: -hit.point.z }
  }

  /**
   * 每秒一份仿真状态：牛羊插值目标、告警、轨迹、叠加图层
   * opts：{ alarm, trail, trails, layer, highlight, heat }
   */
  update(state, opts = {}) {
    this.state = state
    this.lastOpts = opts
    this.alarmPos = opts.alarm?.pos || null
    this.animals?.push(state, opts.alarm)
    // 告警效果：告警对象变化或越界那头牛在动时重建
    const key = opts.alarm
      ? `${opts.alarm.id}|${opts.alarm.pos.map((v) => Math.round(v / 10)).join(",")}`
      : ""
    if (key !== this.alarmKey) {
      this.alarmKey = key
      for (const o of [...this.fx.children].filter(
        (o) => o.userData.kind === "alarm"
      ))
        this.fx.remove(o)
      if (opts.alarm)
        for (const o of this.buildAlarm(opts.alarm)) {
          o.userData.kind = "alarm"
          this.fx.add(o)
        }
    }
    // 轨迹
    const trailKey = (opts.trails || [])
      .map((t) => `${t.id}:${t.points.length}`)
      .join("|")
    if (trailKey !== this.trailKey) {
      this.trailKey = trailKey
      for (const o of [...this.fx.children].filter(
        (o) => o.userData.kind === "trail"
      ))
        this.fx.remove(o)
      for (const t of opts.trails || []) {
        if (t.points.length < 2) continue
        const line = this.buildTrail(t.points, t.color, t.width)
        line.userData.kind = "trail"
        this.fx.add(line)
      }
    }
    // 叠加图层：参数变了才重画（剩余天数等文字一分钟变一次）
    const ov = {
      next: opts.next,
      highlight: opts.highlight,
      layer: opts.layer,
      heat: opts.heat,
      stations: opts.stations,
      near: (this.camDist || 1e9) < 6000,
      minute: Math.floor(state.t.hours * 60)
    }
    const ovKey = JSON.stringify({ ...ov, heat: !!ov.heat })
    if (ovKey !== this.ovKey) {
      this.ovKey = ovKey
      this.redrawOverlay(state, ov)
    }
  }

  /** 渲染循环：控制阻尼、牛羊插值、告警动效、标注锚点 */
  loop() {
    if (!this.running) return
    this.frame = requestAnimationFrame(this.loop)
    const nowMs = performance.now()
    const dt = Math.min((nowMs - this.tPrev) / 1000, 0.1)
    this.tPrev = nowMs
    this.controls.update()
    this.updateFog()
    this.animals?.update(this.camDist)
    // 镜头跨过 6 km 时切换叠加图层的近 / 远两种画法
    const near = this.camDist < 6000
    if (this.state && near !== this.wasNear) {
      this.wasNear = near
      if (this.lastOpts) this.update(this.state, this.lastOpts)
    }
    // 告警外圈循环扩散、光柱呼吸
    const t = (nowMs - this.t0) / 1000
    // 告警效果按镜头距离缩放：全景时醒目，拉近后不至于占满画面
    const ks = THREE.MathUtils.clamp(this.camDist / 20000, 0.12, 1)
    for (const o of this.fx.children) {
      if (o.name === "wave") {
        const k = (t % 2) / 2
        o.scale.setScalar((0.6 + k * 1.4) * ks)
        o.material.opacity = 0.6 * (1 - k)
      } else if (o.name === "ring") o.scale.setScalar(ks)
      else if (o.name === "beam") {
        o.scale.set(ks, 1, ks)
        o.material.uniforms.uOpacity.value = 0.7 + 0.25 * Math.sin(t * 3)
      } else if (o.name === "fence")
        o.material.uniforms.uOpacity.value = 0.65 + 0.35 * Math.sin(t * 4)
    }
    this.cb.onFrame?.(dt)
    this.render()
    this.cb.onAnchors?.(this.anchors())
  }

  /** 标注锚点（设计稿坐标）：畜群、饮水点、营地、场部、基站、告警、指北针、比例尺 */
  anchors() {
    const s = this.state
    const k = 1 / this.unit
    const P = (X, Y, lift) => {
      const p = this.project(X, Y, lift)
      return { x: p.x * k, y: p.y * k, hide: p.behind }
    }
    const L = this.layout
    const th = L.sandbox.theta
    const lerpPos = (id) => {
      const a = this.animals
      if (!a) return s.herds.find((h) => h.id === id).pos
      const kk = Math.min(1, (performance.now() - a.t0) / a.dt)
      const pa = a.prev.herds.find((h) => h.id === id).pos
      const pb = a.next.herds.find((h) => h.id === id).pos
      return [pa[0] + (pb[0] - pa[0]) * kk, pa[1] + (pb[1] - pa[1]) * kk]
    }
    return {
      herds: s.herds.map((h) => {
        const p = lerpPos(h.id)
        return { id: h.id, ...P(p[0], p[1], 0) }
      }),
      water: L.water.map((w) => ({ id: w.id, ...P(w.pos[0], w.pos[1], 6) })),
      homes: L.homesteads.map((h) => ({
        id: h.id,
        ...P(h.pos[0], h.pos[1], 4)
      })),
      hq: P(L.hq.pos[0], L.hq.pos[1], 30),
      stations: L.stations.map((b) => ({
        id: b.id,
        ...P(b.pos[0], b.pos[1], 20)
      })),
      cams: L.cameras
        .filter((c) => c.at.startsWith("WP"))
        .map((c) => {
          const w = L.water.find((x) => x.id === c.at)
          return { id: c.id, ...P(w.pos[0] + 90, w.pos[1] + 60, 8) }
        }),
      alarm: this.alarmPos ? P(this.alarmPos[0], this.alarmPos[1], 0) : null,
      n0: P(0, 0, 0),
      n1: P(Math.sin(th) * 1000, Math.cos(th) * 1000, 0),
      s0: P(-5800, -3800, 0),
      s1: P(-3800, -3800, 0),
      camDist: this.camDist,
      // 画布尺寸（设计像素）：告警引线的 SVG 按它铺满
      vw: this.width * k,
      vh: this.height * k
    }
  }

  dispose() {
    this.running = false
    cancelAnimationFrame(this.frame)
    document.removeEventListener("visibilitychange", this.onVis)
    this.flyTween?.kill()
    this.controls?.dispose()
    this.animals?.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

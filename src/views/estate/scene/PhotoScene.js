/**
 * 照片模式场景：画面是 Blender Cycles 离线渲染好的图（scripts/blender/estate/photo.py），不跑三维
 * ----------------------------------------------------------
 * 对外接口和 EstateScene（实时三维版）一致，index.vue / tour.js / PinLayer 不用改：
 *   ready / onPick / onFrame / onProgress / onInteract / onTime，hour / touring，
 *   select / setLayer / goHome / flyToPlan / setTime / tweenTime / intro / dispose，
 *   stage / projectPlan / headingDeg / topOf（面板每帧靠它们跟着画面走）
 * 画面来源（public/estate/photo/，清单 manifest.json）：
 *   - 视图：主视图 home（4 档光照）、8 个近景（日 / 黄昏两档）；每个视图有自己的相机，投影按它算，所以插牌能对上
 *   - 光照：按"小时"在相邻两档之间交叉淡入淡出（拖时间条就是一天的光影）
 *   - 环绕：主视图的目标点周围每 30° 一张黄昏图，在画面上横向拖动即可转，相邻两帧交叉淡入淡出
 *   - 点楼：主视图有一张楼栋 ID 遮罩（平涂色），点哪栋读哪栋；其它视图用楼体外框投影后的多边形判断
 *   - 选中 / 图层高亮：主视图用遮罩抠出楼的轮廓发光，其它视图画投影后的外框
 * 相机与投影：manifest 里的相机是 three.js 坐标（x, y 向上, z = -平面 y），视场角竖直 28°，宽高比 16:9，
 * 画面铺满 1920×1080 的"舞台"，窗口比例不同时居中、四周留深色。
 */
const BASE = `${import.meta.env.BASE_URL}estate/photo/`
const W = 1920
const H = 1080
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
const clamp01 = (v) => Math.max(0, Math.min(1, v))
const v3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ],
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1
    return [a[0] / l, a[1] / l, a[2] / l]
  },
  lerp: (a, b, t) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ]
}

export class PhotoScene {
  constructor(canvas, opts) {
    this.canvas = canvas
    this.ctx = canvas.getContext("2d")
    this.layout = opts.layout
    this.onPick = opts.onPick
    this.onFrame = opts.onFrame
    this.onProgress = opts.onProgress ?? (() => {})
    this.onInteract = null
    this.onTime = null
    this.hour = opts.hour
    this.month = opts.month
    this.day = opts.day
    this.touring = false
    this.frozen = false
    this.selected = null
    this.layerId = null
    this._shown = new Set()
    this._layerShown = []
    this._timeTween = null
    this._tween = null
    this._imgs = new Map()
    this._glow = new Map()
    this._viewId = "home"
    this._orbitAz = 0
    this._trans = null // 视图切换的交叉淡入淡出 { t0, ms, prev }
    this._camTween = null // 相机插值（插牌在切换时跟着滑）
    this._cam = null
    this._introT0 = 0
    this._raf = 0
    this._size = { w: 1, h: 1 }
    this.ready = this._init()
  }

  // ================================================================ 载入

  async _init() {
    const m = await (await fetch(`${BASE}manifest.json`)).json()
    this.manifest = m
    this.onProgress(0.1)
    // 主视图四档光照先到（时间条要用），再读遮罩
    const first = ["dusk", "day", "golden", "night"]
    for (let i = 0; i < first.length; i++) {
      await this._load(`home_${first[i]}`)
      this.onProgress(0.1 + 0.6 * ((i + 1) / first.length))
    }
    await this._loadMask()
    this.onProgress(0.95)
    this._cam = this._viewCam("home")
    this._bindEvents()
    this.resize()
    this._raf = requestAnimationFrame((t) => this._frame(t))
    this.onProgress(1)
    // 其余的图在空闲时慢慢预读：近景 → 环绕
    this._prefetch()
  }

  _load(name) {
    let e = this._imgs.get(name)
    if (e) return e.promise
    const img = new Image()
    e = { img, ok: false, promise: null }
    e.promise = new Promise((resolve) => {
      img.onload = () => {
        e.ok = true
        resolve(img)
      }
      img.onerror = () => resolve(null)
      img.src = `${BASE}${name}.webp`
    })
    this._imgs.set(name, e)
    return e.promise
  }

  /** 已经读好的图；没有就触发读取并返回 null */
  _get(name) {
    const e = this._imgs.get(name)
    if (e?.ok) return e.img
    this._load(name)
    return null
  }

  async _loadMask() {
    const img = await new Promise((resolve) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => resolve(null)
      i.src = `${BASE}mask_home.png`
    })
    if (!img) return
    const c = document.createElement("canvas")
    c.width = W
    c.height = H
    const g = c.getContext("2d", { willReadFrequently: true })
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, W, H).data
    // 只存 R 通道的编码：R = (序号 + 1) × 8
    const code = new Uint8Array(W * H)
    for (let i = 0; i < W * H; i++) code[i] = Math.round(d[i * 4] / 8)
    this._mask = code
    this._maskCanvas = c
    // 编码 → 楼栋 / 配套编号
    this._codeToId = {}
    for (const [id, rgb] of Object.entries(this.manifest.maskColors ?? {}))
      this._codeToId[Math.round(rgb[0] / 8)] = id
  }

  _prefetch() {
    const names = []
    for (const [vid, v] of Object.entries(this.manifest.views)) {
      if (vid === "home") continue
      for (const l of v.lightings) names.push(`${vid}_${l}`)
    }
    for (let i = 1; i < this.manifest.orbit.frames.length; i++)
      names.push(`orbit_${i}`)
    let k = 0
    const step = () => {
      if (this._disposed || k >= names.length) return
      this._load(names[k++]).then(() => setTimeout(step, 250))
    }
    setTimeout(step, 1500)
  }

  // ================================================================ 版面

  stage() {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    const u = Math.min(w / W, h / H)
    return { u, ox: (w - W * u) / 2, oy: (h - H * u) / 2, w, h }
  }

  resize() {
    const { w, h } = this.stage()
    if (!w || !h) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this._size = { w, h }
  }

  // ================================================================ 相机与投影

  /** 视图的相机（three.js 坐标）；orbit 按当前方位角算 */
  _viewCam(viewId, az = this._orbitAz) {
    const m = this.manifest
    if (viewId === "orbit") {
      const f0 = m.orbit.frames[0].camera
      const t = f0.target
      const off = v3.sub(f0.position, t)
      const d = Math.hypot(off[0], off[1], off[2])
      const polar = Math.acos(off[1] / d)
      const a = (az * Math.PI) / 180
      return {
        pos: [
          t[0] + Math.sin(a) * Math.sin(polar) * d,
          t[1] + Math.cos(polar) * d,
          t[2] + Math.cos(a) * Math.sin(polar) * d
        ],
        tgt: [...t],
        fov: f0.fov
      }
    }
    const c = m.views[viewId].camera
    return { pos: [...c.position], tgt: [...c.target], fov: c.fov }
  }

  /** 平面点（含高度）→ 画布 CSS 像素；visible = 在画面内且在相机前面 */
  projectPlan(x, y, h = 0) {
    const cam = this._cam
    const { u, ox, oy } = this.stage()
    if (!cam) return { x: 0, y: 0, visible: false }
    const f = v3.norm(v3.sub(cam.tgt, cam.pos))
    const r = v3.norm(v3.cross(f, [0, 1, 0]))
    const up = v3.cross(r, f)
    const d = v3.sub([x, h, -y], cam.pos)
    const zc = v3.dot(d, f)
    const th = Math.tan((cam.fov * Math.PI) / 360)
    const xn = v3.dot(d, r) / (zc * th * (W / H))
    const yn = v3.dot(d, up) / (zc * th)
    return {
      x: ox + (xn * 0.5 + 0.5) * W * u,
      y: oy + (-yn * 0.5 + 0.5) * H * u,
      visible: zc > 0 && Math.abs(xn) < 1.15 && Math.abs(yn) < 1.15,
      z: zc
    }
  }

  headingDeg() {
    const cam = this._cam
    if (!cam) return 0
    const f = v3.sub(cam.tgt, cam.pos)
    return (Math.atan2(f[0], -f[2]) * 180) / Math.PI
  }

  info(id) {
    return (
      this.layout.buildings.find((b) => b.id === id) ??
      this.layout.amenities.find((a) => a.id === id) ??
      null
    )
  }

  topOf(id) {
    return this.info(id)?.height ?? 0
  }

  // ================================================================ 视图切换

  get view() {
    return this._viewId
  }

  /** 切到某个视图（交叉淡入淡出，相机同时插值，插牌跟着滑） */
  _goView(id, seconds = 1.4) {
    if (this._viewId === id && id !== "orbit") return
    const prev = { viewId: this._viewId, az: this._orbitAz, hour: this.hour }
    this._camTween = {
      from: this._cam,
      to: null,
      t0: performance.now(),
      ms: seconds * 1000
    }
    this._viewId = id
    this._camTween.to = this._viewCam(id)
    this._trans = { t0: performance.now(), ms: seconds * 1000, prev }
  }

  goHome(seconds = 1.6) {
    this.deselect()
    this.setLayer(null, { fly: false })
    this._orbitAz = 0
    this._goView("home", seconds)
  }

  _applyHome() {
    this._viewId = "home"
    this._orbitAz = 0
    this._trans = null
    this._camTween = null
    this._cam = this._viewCam("home")
  }

  /** 飞到平面某点：落到最近的预渲染近景（远景参数 → 主视图） */
  flyToPlan(x, y, o = {}) {
    if ((o.dist ?? 260) >= 450) return this._goView("home", o.duration ?? 1.6)
    let best = null
    for (const [vid, v] of Object.entries(this.manifest.views)) {
      if (vid === "home") continue
      const d = Math.hypot(v.focus[0] - x, v.focus[1] - y)
      if (!best || d < best.d) best = { vid, d }
    }
    this._goView(best && best.d < 120 ? best.vid : "home", o.duration ?? 1.6)
  }

  /** 选中某对象时该切到哪个视图：对象投影在画面中央且最近的那个 */
  _bestViewFor(a) {
    const here = this._viewId
    const score = (vid) => {
      const cam = this._viewCam(vid)
      const keep = this._cam
      this._cam = cam
      const p = this.projectPlan(a.cx, a.cy, this.topOf(a.id) * 0.4)
      this._cam = keep
      if (!p.visible) return Infinity
      const { u, ox, oy } = this.stage()
      const nx = (p.x - ox) / (W * u) - 0.5
      const ny = (p.y - oy) / (H * u) - 0.5
      return Math.hypot(nx, ny)
    }
    let best = { vid: "home", s: score("home") + 0.25 } // 主视图略占便宜：能不切就不切
    for (const vid of Object.keys(this.manifest.views)) {
      if (vid === "home") continue
      const s = score(vid)
      if (s < best.s) best = { vid, s }
    }
    return here === "orbit" ? "orbit" : best.vid
  }

  // ================================================================ 选中、图层

  select(id, o = {}) {
    if (this.selected) this._shown.delete(this.selected)
    this.selected = id
    if (!id) return
    this._shown.add(id)
    const a = this.info(id)
    if (!a || o.fly === false) return
    const vid = this._bestViewFor(a)
    if (vid !== this._viewId) this._goView(vid, o.duration ?? 1.4)
  }

  deselect() {
    this.select(null)
  }

  setLayer(layerId, o = {}) {
    for (const id of this._layerShown)
      if (id !== this.selected) this._shown.delete(id)
    this._layerShown = []
    this.layerId = layerId
    if (!layerId) return
    const layer = this.layout.layers.find((l) => l.id === layerId)
    if (!layer) return
    for (const id of layer.ids) {
      this._shown.add(id)
      this._layerShown.push(id)
    }
    if (o.fly === false) return
    if (this.manifest.views[layerId]) this._goView(layerId, 1.6)
    else this._goView("home", 1.6)
  }

  // ================================================================ 时间

  setTime(h) {
    this.hour = h
  }

  tweenTime(to, ms, onDone) {
    this._timeTween = { from: this.hour, to, t0: performance.now(), ms, onDone }
  }

  /** 某小时在某视图上用哪两档光照：[[光照档, 权重], …]，第一个权重恒为 1（打底），第二个是叠上去的透明度 */
  _lightMix(viewId, hour) {
    const have =
      viewId === "orbit"
        ? [this.manifest.orbit.lighting]
        : this.manifest.views[viewId].lightings
    const key = this.manifest.lightings
      .filter((l) => have.includes(l.id))
      .sort((a, b) => a.hour - b.hour)
    if (key.length === 1 || hour <= key[0].hour) return [[key[0].id, 1]]
    const last = key[key.length - 1]
    if (hour >= last.hour) return [[last.id, 1]]
    for (let i = 0; i < key.length - 1; i++) {
      const a = key[i]
      const b = key[i + 1]
      if (hour >= a.hour && hour <= b.hour) {
        const t = (hour - a.hour) / (b.hour - a.hour)
        return [
          [a.id, 1],
          [b.id, t]
        ]
      }
    }
    return [[last.id, 1]]
  }

  // ================================================================ 开场

  intro() {
    this._introT0 = performance.now()
  }

  setFrozen(on) {
    this.frozen = on
    if (on) {
      this._tween = null
      this._timeTween = null
    }
  }

  // ================================================================ 交互

  _bindEvents() {
    const c = this.canvas
    let down = null
    let last = null
    this._onDown = (e) => {
      down = { x: e.clientX, y: e.clientY, moved: false, az: this._orbitAz }
      last = { x: e.clientX, t: performance.now() }
      this._vel = 0
      c.setPointerCapture?.(e.pointerId)
      this.onInteract?.()
    }
    this._onMove = (e) => {
      if (!down) {
        if (this._mask || this.manifest) this._hover(e)
        return
      }
      const dx = e.clientX - down.x
      if (!down.moved && Math.abs(dx) > 6) {
        down.moved = true
        // 开始拖动：进入环绕（从当前视图的方位算起，主视图 = 0°）
        if (this._viewId !== "orbit") {
          this._orbitAz = 0
          this._goView("orbit", 0.01)
          down.az = this._orbitAz
        }
      }
      if (down.moved) {
        this._dragging = true
        const u = this.stage().u
        this._orbitAz = (((down.az - dx / (u * 5)) % 360) + 360) % 360
        this._cam = this._viewCam("orbit")
        const now = performance.now()
        this._vel = ((last.x - e.clientX) / Math.max(1, now - last.t)) * 16
        last = { x: e.clientX, t: now }
      }
    }
    this._onUp = (e) => {
      if (!down) return
      const moved = down.moved
      down = null
      this._dragging = false
      c.releasePointerCapture?.(e.pointerId)
      if (moved) {
        this._inertia = true
        return
      }
      this.onPick?.(this._pickAt(e.clientX, e.clientY))
    }
    c.addEventListener("pointerdown", this._onDown)
    c.addEventListener("pointermove", this._onMove)
    c.addEventListener("pointerup", this._onUp)
    c.addEventListener("pointercancel", this._onUp)
  }

  _hover(e) {
    const id = this._pickAt(e.clientX, e.clientY)
    this.canvas.style.cursor = id ? "pointer" : ""
  }

  /** 屏幕点 → 楼栋 / 配套编号。主视图读遮罩；其它视图用楼体外框的投影多边形 */
  _pickAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect()
    const { u, ox, oy } = this.stage()
    const px = clientX - r.left
    const py = clientY - r.top
    if (this._viewId === "home" && !this._trans && this._mask) {
      const ix = Math.floor((px - ox) / u)
      const iy = Math.floor((py - oy) / u)
      if (ix < 0 || iy < 0 || ix >= W || iy >= H) return null
      return this._codeToId[this._mask[iy * W + ix]] ?? null
    }
    let best = null
    for (const b of this.layout.buildings) {
      const poly = this._boxHull(b)
      if (poly && this._inside(poly, px, py)) {
        const z = this.projectPlan(b.cx, b.cy, 0).z
        if (!best || z < best.z) best = { id: b.id, z }
      }
    }
    return best?.id ?? null
  }

  /** 楼体外框（底面 4 角 + 顶面 4 角）投影后的凸包，点击判断用；对象在相机后面返回 null */
  _boxHull(a) {
    const pts = []
    const h = a.height ?? 10
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1]
    ]) {
      for (const z of [0, h]) {
        const p = this.projectPlan(
          a.cx + (sx * a.w) / 2,
          a.cy + (sy * a.d) / 2,
          z
        )
        if (p.z <= 0) return null
        pts.push([p.x, p.y])
      }
    }
    return this._hull(pts)
  }

  _hull(pts) {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
    const cross = (o, a, b) =>
      (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    const lo = []
    for (const p of pts) {
      while (
        lo.length >= 2 &&
        cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0
      )
        lo.pop()
      lo.push(p)
    }
    const up = []
    for (const p of pts.reverse()) {
      while (
        up.length >= 2 &&
        cross(up[up.length - 2], up[up.length - 1], p) <= 0
      )
        up.pop()
      up.push(p)
    }
    return lo.slice(0, -1).concat(up.slice(0, -1))
  }

  _inside(poly, x, y) {
    let c = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]
      const [xj, yj] = poly[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
        c = !c
    }
    return c
  }

  // ================================================================ 绘制

  /** 画一个视图（可能由两档光照叠成），alpha 是整体透明度，scale 绕画面中心缩放 */
  _drawView(viewId, hour, az, alpha, scale) {
    const { u, ox, oy } = this.stage()
    const g = this.ctx
    const x = ox + (W * u * (1 - scale)) / 2
    const y = oy + (H * u * (1 - scale)) / 2
    const dw = W * u * scale
    const dh = H * u * scale
    const draw = (name, a) => {
      const img = this._get(name)
      if (!img || a <= 0.002) return false
      g.globalAlpha = a
      g.drawImage(img, x, y, dw, dh)
      return true
    }
    if (viewId === "orbit") {
      const n = this.manifest.orbit.frames.length
      const step = 360 / n
      const i0 = Math.floor(az / step) % n
      const i1 = (i0 + 1) % n
      const t = (az - i0 * step) / step
      const nm = (i) => (i === 0 ? "home_dusk" : `orbit_${i}`)
      if (!draw(nm(i0), alpha)) draw("home_dusk", alpha)
      // 相邻两帧机位差 30°，整段线性叠加会一直重影：只在两帧中段（0.3~0.7）淡入，
      // 两头基本是单帧；停下后由 _frame 吸附到最近一帧
      const k = ease(clamp01((t - 0.3) / 0.4))
      if (k > 0.002) draw(nm(i1), alpha * k)
    } else {
      const mix = this._lightMix(viewId, hour)
      let drew = false
      for (const [lid, w] of mix)
        drew = draw(`${viewId}_${lid}`, alpha * w) || drew
      // 近景的图还没读到：先拿主视图垫着，别闪黑
      if (!drew)
        for (const [lid, w] of this._lightMix("home", hour))
          draw(`home_${lid}`, alpha * w)
    }
    g.globalAlpha = 1
  }

  /** 选中 / 图层高亮：主视图用遮罩抠出楼的轮廓发光；其它视图和非楼对象画投影后的外框 */
  _drawHighlights(now) {
    if (!this._shown.size) return
    const g = this.ctx
    const { u, ox, oy } = this.stage()
    const pulse = 0.55 + 0.25 * Math.sin(now / 380)
    for (const id of this._shown) {
      const a = this.info(id)
      if (!a) continue
      const isSel = id === this.selected
      if (
        this._viewId === "home" &&
        !this._trans &&
        this._mask &&
        this._codeOf(id)
      ) {
        const gl = this._glowCanvas(id)
        if (gl) {
          g.globalAlpha = isSel ? 0.95 : pulse
          g.drawImage(gl, ox, oy, W * u, H * u)
          g.globalAlpha = 1
        }
        continue
      }
      this._strokeFootprint(g, a, isSel ? 1 : pulse)
    }
  }

  _codeOf(id) {
    for (const [c, i] of Object.entries(this._codeToId))
      if (i === id) return Number(c)
    return 0
  }

  /** 某栋楼的发光轮廓图（整幅 1920×1080，缓存） */
  _glowCanvas(id) {
    if (this._glow.has(id)) return this._glow.get(id)
    const code = this._codeOf(id)
    const m = this._mask
    let x0 = W
    let x1 = -1
    let y0 = H
    let y1 = -1
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (m[y * W + x] === code) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
    if (x1 < 0) {
      this._glow.set(id, null)
      return null
    }
    const c = document.createElement("canvas")
    c.width = W
    c.height = H
    const g = c.getContext("2d")
    const img = g.createImageData(W, H)
    const d = img.data
    for (let y = Math.max(1, y0 - 1); y <= Math.min(H - 2, y1 + 1); y++) {
      for (let x = Math.max(1, x0 - 1); x <= Math.min(W - 2, x1 + 1); x++) {
        const i = y * W + x
        const inside = m[i] === code
        const edge =
          inside &&
          (m[i - 1] !== code ||
            m[i + 1] !== code ||
            m[i - W] !== code ||
            m[i + W] !== code)
        if (edge) {
          d[i * 4] = 255
          d[i * 4 + 1] = 210
          d[i * 4 + 2] = 122
          d[i * 4 + 3] = 255
        } else if (inside) {
          d[i * 4] = 255
          d[i * 4 + 1] = 210
          d[i * 4 + 2] = 122
          d[i * 4 + 3] = 34
        }
      }
    }
    g.putImageData(img, 0, 0)
    // 轮廓再糊一层当光晕
    const o = document.createElement("canvas")
    o.width = W
    o.height = H
    const og = o.getContext("2d")
    og.filter = "blur(7px)"
    og.drawImage(c, 0, 0)
    og.filter = "none"
    og.globalAlpha = 0.8
    og.drawImage(c, 0, 0)
    this._glow.set(id, o)
    return o
  }

  /** 投影后的外框：楼栋画立体线框，湖 / 步道画椭圆，其它画地面矩形 */
  _strokeFootprint(g, a, alpha) {
    g.save()
    g.lineWidth = 2.4
    g.strokeStyle = `rgba(255,210,122,${alpha})`
    g.shadowColor = "rgba(255,210,122,.9)"
    g.shadowBlur = 10
    g.fillStyle = `rgba(255,210,122,${alpha * 0.14})`
    const P = (x, y, z) => {
      const p = this.projectPlan(x, y, z)
      return p.z > 0 ? [p.x, p.y] : null
    }
    const poly = (pts, fill) => {
      if (pts.some((p) => !p)) return
      g.beginPath()
      pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])))
      g.closePath()
      if (fill) g.fill()
      g.stroke()
    }
    const hw = a.w / 2
    const hd = a.d / 2
    if (a.shape === "lake" || a.shape === "track") {
      const pts = []
      for (let i = 0; i < 48; i++) {
        const t = (i / 48) * Math.PI * 2
        pts.push(P(a.cx + Math.cos(t) * hw, a.cy + Math.sin(t) * hd, 0.5))
      }
      poly(pts, true)
    } else if (a.shape === "building" || a.id.startsWith("B")) {
      const h = a.height ?? 10
      const ring = (z) => [
        P(a.cx - hw, a.cy - hd, z),
        P(a.cx + hw, a.cy - hd, z),
        P(a.cx + hw, a.cy + hd, z),
        P(a.cx - hw, a.cy + hd, z)
      ]
      poly(ring(0), false)
      poly(ring(h), true)
      for (let i = 0; i < 4; i++) {
        const b = ring(0)[i]
        const t = ring(h)[i]
        if (b && t) {
          g.beginPath()
          g.moveTo(b[0], b[1])
          g.lineTo(t[0], t[1])
          g.stroke()
        }
      }
    } else {
      poly(
        [
          P(a.cx - hw, a.cy - hd, 0.5),
          P(a.cx + hw, a.cy - hd, 0.5),
          P(a.cx + hw, a.cy + hd, 0.5),
          P(a.cx - hw, a.cy + hd, 0.5)
        ],
        true
      )
    }
    g.restore()
  }

  // ================================================================ 帧循环

  _frame(now) {
    if (this._disposed) return
    this._raf = requestAnimationFrame((t) => this._frame(t))
    const { w, h } = this.stage()
    if (w !== this._size.w || h !== this._size.h) this.resize()
    // 时间动画
    const tt = this._timeTween
    if (tt) {
      const k = clamp01((now - tt.t0) / tt.ms)
      this.hour = tt.from + (tt.to - tt.from) * ease(k)
      this.onTime?.(this.hour)
      if (k >= 1) {
        this._timeTween = null
        tt.onDone?.()
      }
    }
    // 环绕惯性
    if (this._inertia && this._viewId === "orbit") {
      this._vel *= 0.93
      this._orbitAz = (((this._orbitAz + this._vel) % 360) + 360) % 360
      this._cam = this._viewCam("orbit")
      if (Math.abs(this._vel) < 0.3) this._inertia = false
    }
    // 没在拖、惯性也停了：吸附到最近的一帧（环绕只有 12 张图，停在两帧之间会重影）
    if (this._viewId === "orbit" && !this._inertia && !this._dragging) {
      const step = 360 / this.manifest.orbit.frames.length
      const target = Math.round(this._orbitAz / step) * step
      const d = target - this._orbitAz
      if (Math.abs(d) > 0.05) {
        this._orbitAz = (((this._orbitAz + d * 0.15) % 360) + 360) % 360
        this._cam = this._viewCam("orbit")
      } else if (d !== 0) {
        this._orbitAz = ((target % 360) + 360) % 360
        this._cam = this._viewCam("orbit")
      }
    }
    // 相机插值
    const ct = this._camTween
    if (ct) {
      const k = ease(clamp01((now - ct.t0) / ct.ms))
      this._cam = {
        pos: v3.lerp(ct.from.pos, ct.to.pos, k),
        tgt: v3.lerp(ct.from.tgt, ct.to.tgt, k),
        fov: ct.to.fov
      }
      if (k >= 1) this._camTween = null
    } else if (this._viewId !== "orbit") {
      this._cam = this._viewCam(this._viewId)
    }
    // 画面
    const g = this.ctx
    g.globalAlpha = 1
    g.fillStyle = "#0f0a07"
    g.fillRect(0, 0, w, h)
    const tr = this._trans
    if (tr) {
      const k = clamp01((now - tr.t0) / tr.ms)
      const e = ease(k)
      this._drawView(tr.prev.viewId, this.hour, tr.prev.az, 1, 1 + 0.04 * e)
      this._drawView(this._viewId, this.hour, this._orbitAz, e, 0.96 + 0.04 * e)
      if (k >= 1) this._trans = null
    } else {
      this._drawView(this._viewId, this.hour, this._orbitAz, 1, 1)
    }
    this._drawHighlights(now)
    // 开场淡入
    if (this._introT0) {
      const k = clamp01((now - this._introT0) / 1000)
      if (k < 1) {
        g.fillStyle = `rgba(15,10,7,${1 - ease(k)})`
        g.fillRect(0, 0, w, h)
      } else this._introT0 = 0
    }
    this.onFrame?.(this)
  }

  // ================================================================ 开发期钩子、清理

  /** 供 capture.mjs 的 --id-mask 用：返回遮罩图和编号表 */
  async renderIdMask() {
    return {
      png: this._maskCanvas?.toDataURL("image/png"),
      map: this.manifest.maskColors
    }
  }

  stats() {
    return {
      fps: 60,
      calls: 0,
      triangles: 0,
      geometries: 0,
      textures: this._imgs.size,
      mode: "photo"
    }
  }

  dispose() {
    this._disposed = true
    cancelAnimationFrame(this._raf)
    const c = this.canvas
    c.removeEventListener("pointerdown", this._onDown)
    c.removeEventListener("pointermove", this._onMove)
    c.removeEventListener("pointerup", this._onUp)
    c.removeEventListener("pointercancel", this._onUp)
    this._imgs.clear()
    this._glow.clear()
  }
}

/*
 * 相机巡览与轨道控制
 * ----------------------------------------------------------
 * 大屏多数时间无人值守，因此默认自动巡览：按景点依次停靠，
 * 每站停留若干秒并通知外部切换介绍面板。
 * 一旦有人操作（拖拽 / 滚轮 / 点击 / 工具栏）立即暂停，空闲一段时间后自动恢复。
 *
 * 轨道控制自行实现：只需要「绕注视点旋转 + 缩放」，与巡览状态机共用同一套球坐标。
 * 滚轮以光标所指处为中心缩放（与地图 App 一致），可放大到画面任意位置，而不只是当前景点。
 * 注视点被限制在数据范围内，俯仰与距离也有夹取，避免转到地底或飞出城区。
 */
import { Plane, Raycaster, Spherical, Vector2, Vector3 } from "three"

const DEG = Math.PI / 180
// 大角度转向放慢：方位差超过 SLOW_TURN_FROM 时，飞行时长按「方位差 / SLOW_TURN_FROM」放大，
// 最多 × SLOW_TURN_MAX。easeInOutCubic 中点斜率为 3，峰值角速度 = 3 × 方位差 / 时长：
// timing.fly 固定 2 s 时，10 站版总览 → 第 0 站的 118° 转向峰值约 177°/s，大屏上显得甩；
// 放大 1.31 倍（约 2.6 s）后约 135°/s。11 站版总览（theme.js）→ 第 0 站约 102°，约 2.26 s。
// 方位差不超过 90° 的飞行时长不变
const SLOW_TURN_FROM = 90 * DEG
const SLOW_TURN_MAX = 1.6
// 跨区域飞行（主城区 ↔ 飞地，起点与终点注视点分属不同的范围矩形）：
// 时长按 √(位移 / LONG_FLY_FROM) 放大（LONG_FLY_FROM 只是归一化的基准距离，不是触发阈值），
// 与大角度转向系数取较大者，最多 × LONG_FLY_MAX；并在半程把相机拉高（见 _flyTo 的 flyHop）。
// 主城区内的任何飞行（巡览与导航栏手动点站，哪怕两站相距超过 5 km）都不属于跨区域，时长与路线不变。
// 例：杜甫草堂 → 熊猫基地约 13.9 km，× 1.67 约 3.3 s；熊猫基地 → 天府广场约 11.4 km，约 3.0 s
const LONG_FLY_FROM = 5000
const LONG_FLY_MAX = 2.5

/** easeInOutCubic：起步与收尾都平缓，避免大屏上镜头生硬 */
function easeInOutCubic(k) {
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
}

/** 线性插值 */
function lerp(a, b, k) {
  return a + (b - a) * k
}

/**
 * 景点到站机位：注视点 = 落点 (spot.x, spot.z) + cam.look（[dx, dz] 米，缺省不平移），
 * 相机 = 注视点 + cam.offset；两者一起抬高底座高度 base 的一半，高层地标（楼体 + 落点球）在画面里居中。
 * CityScene._initTour（各站机位）与熊猫基地 site.cameraPos（熊猫朝向、视线保护按到站相机算）共用这一份，
 * 改机位算法只改这里，两处不会算出不同的相机
 * @param {{ x: number, z: number, cam: { offset: number[], look?: number[] } }} spot 景点（已含局部 x / z）
 * @param {number} base 落点球底座高度（米，markers.bases[i]；熊猫基地即其 markerHeight）
 * @returns {{ p: number[], t: number[] }} p 相机位置、t 注视点（世界坐标 [x, y, z]）
 */
export function stopPose(spot, base) {
  const lift = base * 0.5
  const off = spot.cam.offset
  const [lx, lz] = spot.cam.look || [0, 0]
  const tx = spot.x + lx
  const tz = spot.z + lz
  return {
    p: [tx + off[0], off[1] + lift, tz + off[2]],
    t: [tx, lift, tz]
  }
}

/**
 * 找出矩形数组里离 (x, z) 最近的一块（点在某块内时距离为 0，多块都满足时取靠前的）。
 * 结果写进 out：index 为该块下标，(x, z) 为点夹到该块内的位置，gap 为点到该块的距离（米）。
 * 与 utils.js 的 nearestRegion 算法相同，但有意分开：这里的矩形是各区域的 bbox（注视点可移动范围，
 * 比数据实际铺到的 clip 每边内缩 300 m，镜头不停到数据边缘的空地上），且要夹取后的点与距离；
 * nearestRegion 用 clip 给投影物、落点归区，是静态阴影的热路径，只返回下标（说明见其注释）
 * @param {Array<{x: number[], z: number[]}>} rects
 * @param {{index: number, x: number, z: number, gap: number}} [out] 复用的结果对象
 */
function nearestRect(x, z, rects, out = {}) {
  out.index = -1
  out.x = x
  out.z = z
  let best = Infinity
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]
    const cx = Math.max(r.x[0], Math.min(r.x[1], x))
    const cz = Math.max(r.z[0], Math.min(r.z[1], z))
    const d = (cx - x) ** 2 + (cz - z) ** 2
    if (d < best) {
      best = d
      out.index = i
      out.x = cx
      out.z = cz
    }
  }
  out.gap = best === Infinity ? 0 : Math.sqrt(best)
  return out
}

// clampToRects 与 _stopFlying 共用的临时结果，避免每帧新建对象
const NEAR = { index: -1, x: 0, z: 0, gap: 0 }

/**
 * 把 (x, z) 夹回矩形数组：先找最近的一块 c 与到它的距离 g。
 * g ≤ slack 时原样保留（允许暂时停在范围外 slack 米以内）；否则沿 c → 点 的方向
 * 收回到离 c 为 slack 米处（slack 为 0 即硬夹到矩形边缘）。结果写回 out。
 * @param {Array<{x: number[], z: number[]}>} rects
 * @param {number} [slack] 允许超出范围的距离（米）
 */
function clampToRects(x, z, rects, out, slack = 0) {
  const n = nearestRect(x, z, rects, NEAR)
  if (n.gap <= slack) {
    out.x = x
    out.z = z
    return
  }
  const k = slack / n.gap
  out.x = n.x + (x - n.x) * k
  out.z = n.z + (z - n.z) * k
}

export class CameraTour {
  /**
   * @param {object} options
   * @param {THREE.PerspectiveCamera} options.camera
   * @param {HTMLElement} options.domElement 接收鼠标事件的元素
   * @param {Array<{p:number[], t:number[]}>} options.stops 各站机位：p 相机位置、t 注视点
   * @param {{p:number[], t:number[]}} options.overview 总览机位
   * @param {object} options.limits theme.camera（pitchMin/Max、radiusMin/Max）加 bounds：
   *   注视点可移动的矩形数组 [{ x: [min, max], z: [min, max] }, …]（主城区 + 各飞地），由 CityScene 按数据范围算出
   * @param {object} options.timing theme.tour（fly / hold / idle / drift，秒）
   * @param {Function} options.onStopChange 停靠点变化回调，参数为索引
   * @param {Function} options.onPlayingChange 巡览播放状态变化回调
   * @param {Function} [options.onArrive] 飞抵景点站回调，参数为索引（被人工打断的飞行不触发，飞回总览也不触发）
   * @param {boolean} options.reduceMotion 是否跳过飞行动画
   */
  constructor(options) {
    this.camera = options.camera
    this.dom = options.domElement
    this.stops = options.stops
    this.overview = options.overview
    this.limits = options.limits
    this.timing = options.timing
    this.onStopChange = options.onStopChange || (() => {})
    this.onPlayingChange = options.onPlayingChange || (() => {})
    this.onArrive = options.onArrive || (() => {})
    this.reduceMotion = Boolean(options.reduceMotion)

    this.target = new Vector3()
    this.spherical = new Spherical()
    // 滚轮缩放求光标落点用的临时对象，复用以免每次滚轮都新建
    this.raycaster = new Raycaster()
    this.ndc = new Vector2()
    this.anchorPlane = new Plane(new Vector3(0, 1, 0), 0)
    this.anchor = new Vector3()

    this.current = -1
    this.playing = true
    this.flying = false
    this.flyProgress = 0
    // 是否已抵达当前站：飞行途中被人工打断时为 false，恢复巡览会重飞当前站而不是跳过它
    this.arrived = false
    // 当前飞行的目的地是否为景点站（飞回总览不算抵达任何站）
    this.flyingToStop = false
    this.holdElapsed = 0
    this.idleElapsed = 0
    this.dragging = false
    this.pointerId = null // 正在拖拽的指针，只跟踪一个，忽略多指 / 其他指针
    this.lastX = 0
    this.lastY = 0

    // 飞行起止：注视点 + 相机相对注视点的球坐标偏移
    this.flyFrom = { target: new Vector3(), s: new Spherical() }
    this.flyTo = { target: new Vector3(), s: new Spherical() }
    this.flyDTheta = 0 // 方位角走最短弧的增量，范围 [-π, π]
    this.flyDuration = this.timing.fly // 本次飞行时长（秒），大角度转向时放大（见 _flyTo）
    this.flyHop = 0 // 本次飞行半程的相机距离抬升量（米），只有跨区域飞行非 0（见 _flyTo）
    // 注视点允许暂时停在范围外多远（米）：人工打断跨区域飞行时，注视点可能正悬在两块区域之间的
    // 空白地面，直接硬夹会在一帧内把画面拽回几公里；改为以打断时的距离为初值、随时间衰减
    // （见 _stopFlying 与 update），镜头平滑滑回数据区。以光标为锚的滚轮缩放把注视点带出范围时同理（见 zoom）。
    // 飞行中与新飞行开始时为 0
    this.slack = 0

    // 初始机位：总览
    this._jumpTo(this.overview)
    this._bindEvents()
  }

  _bindEvents() {
    this._onPointerDown = (e) => {
      // 只响应主键（左键 / 单指），且同一时间只跟踪一个指针
      if (e.button !== 0 || this.dragging) return
      this.dragging = true
      this.pointerId = e.pointerId
      this.lastX = e.clientX
      this.lastY = e.clientY
      this.dom.setPointerCapture(e.pointerId)
      this.pause()
    }
    this._onPointerMove = (e) => {
      if (!this.dragging || e.pointerId !== this.pointerId) return
      this.spherical.theta -= (e.clientX - this.lastX) * 0.005
      this.spherical.phi -= (e.clientY - this.lastY) * 0.005
      this.lastX = e.clientX
      this.lastY = e.clientY
      this._stopFlying()
      this.apply()
    }
    // 抬起、取消（系统手势 / 触摸被打断）、丢失捕获都结束拖拽，
    // 否则 pointerup 丢失时 dragging 会一直为 true，巡览永远不会恢复
    this._onPointerUp = (e) => {
      if (!this.dragging || e.pointerId !== this.pointerId) return
      this.dragging = false
      this.pointerId = null
      try {
        this.dom.releasePointerCapture(e.pointerId)
      } catch {
        // 指针已释放，忽略
      }
    }
    this._onWheel = (e) => {
      e.preventDefault()
      // 触控板会连续发大量小增量事件，按增量缩放避免一扫就拉到底。
      // deltaMode：0 像素、1 行、2 页，统一换算成像素再夹取单次幅度
      let dy = e.deltaY
      if (e.deltaMode === 1) dy *= 16
      else if (e.deltaMode === 2) {
        dy *= (typeof window !== "undefined" && window.innerHeight) || 800
      }
      dy = Math.max(-100, Math.min(100, dy))
      this.zoom(Math.exp(dy * 0.0015), this._pointerAnchor(e))
    }
    // 屏蔽右键菜单：大屏上右键误触不应弹出浏览器菜单
    this._onContextMenu = (e) => e.preventDefault()

    this.dom.addEventListener("pointerdown", this._onPointerDown)
    this.dom.addEventListener("pointermove", this._onPointerMove)
    this.dom.addEventListener("pointerup", this._onPointerUp)
    this.dom.addEventListener("pointercancel", this._onPointerUp)
    this.dom.addEventListener("lostpointercapture", this._onPointerUp)
    this.dom.addEventListener("wheel", this._onWheel, { passive: false })
    this.dom.addEventListener("contextmenu", this._onContextMenu)
  }

  /** 直接跳到某机位（不飞行） */
  _jumpTo(stop) {
    this.target.set(stop.t[0], stop.t[1], stop.t[2])
    this.spherical.setFromVector3(
      new Vector3(stop.p[0], stop.p[1], stop.p[2]).sub(this.target)
    )
    this.apply()
  }

  /**
   * 人工操作打断飞行（拖拽、缩放）：结束飞行，并把此刻注视点到最近范围矩形的距离记为 slack。
   * 跨区域飞行飞越空白地面时被打断，注视点离最近的矩形可能有数公里，
   * 若按 slack = 0 硬夹，下一帧画面会瞬间跳回；记下距离后，当帧 apply 不会移动注视点，
   * 之后由 update 逐帧衰减 slack，注视点平滑滑回范围内
   */
  _stopFlying() {
    if (!this.flying) return
    this.slack = nearestRect(
      this.target.x,
      this.target.z,
      this.limits.bounds,
      NEAR
    ).gap
    this.flying = false
  }

  /**
   * 把球坐标写回相机，并做俯仰、距离、注视点范围的夹取。
   * 注视点只在非飞行时夹取（夹到离它最近的那块范围矩形，允许暂时超出 slack 米，见 _stopFlying）：
   * 飞行（巡览、复位、点导航）的起止点都在数据范围内，
   * 途中跨越主城区与飞地之间的空白地面时不能被拽回最近的区域
   */
  apply() {
    const s = this.spherical
    const L = this.limits
    // phi 是与 +Y 的夹角：俯仰 pitch = 90° - phi
    s.phi = Math.max(
      (90 - L.pitchMax) * DEG,
      Math.min((90 - L.pitchMin) * DEG, s.phi)
    )
    s.radius = Math.max(L.radiusMin, Math.min(L.radiusMax, s.radius))
    if (!this.flying) {
      clampToRects(
        this.target.x,
        this.target.z,
        L.bounds,
        this.target,
        this.slack
      )
    }
    this.camera.position
      .copy(this.target)
      .add(new Vector3().setFromSpherical(s))
    this.camera.lookAt(this.target)
  }

  /**
   * 光标所指处在「注视点高度水平面」上的世界坐标，作为滚轮缩放的不动点；视线不与该平面相交时返回 null。
   * 取注视点高度而不是地面：高层地标站的注视点抬高了底座的一半（见 CityScene._initTour），
   * 不动点与注视点同高，缩放时注视点只在水平方向移动，高度保持不变
   */
  _pointerAnchor(e) {
    const rect = this.dom.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    this.ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )
    // 同一帧内可能连续收到多个滚轮事件（触控板），apply() 之后相机矩阵要等渲染时才更新，这里先手动更新
    this.camera.updateMatrixWorld()
    this.raycaster.setFromCamera(this.ndc, this.camera)
    this.anchorPlane.constant = -this.target.y
    return this.raycaster.ray.intersectPlane(this.anchorPlane, this.anchor)
  }

  /**
   * 缩放：factor > 1 拉远，< 1 拉近；属于人工操作，会暂停巡览。
   * 传 anchor（滚轮时为光标落点，见 _pointerAnchor）则以它为不动点：相机与注视点一起按同一比例
   * 朝 anchor 收拢 / 远离，视线方向不变，anchor 在屏幕上的位置也就不变；
   * 不传（工具栏按钮）则以注视点即画面中心缩放。
   * 比例按夹取后的距离算，距离已到上下限时注视点也不再移动。
   * 以 anchor 缩放把注视点带出范围、且最近的区域换成了另一块（在两区之间的空白处缩放）时，
   * 超出的距离计入 slack（同打断飞行，见 _stopFlying），由 update 衰减、画面平滑滑进那块区域；
   * 仍归同一块区域时照旧当帧硬夹回它的边缘
   */
  zoom(factor, anchor) {
    const s = this.spherical
    const L = this.limits
    const from = s.radius
    s.radius = Math.max(L.radiusMin, Math.min(L.radiusMax, from * factor))
    const moved = anchor && from > 0
    // 缩放前注视点归哪块区域（最近的矩形），用来判断缩放后是否跨到了另一块
    const fromIndex = moved
      ? nearestRect(this.target.x, this.target.z, L.bounds, NEAR).index
      : -1
    if (moved) {
      const k = s.radius / from
      this.target.x = anchor.x + (this.target.x - anchor.x) * k
      this.target.z = anchor.z + (this.target.z - anchor.z) * k
    }
    this._stopFlying()
    if (moved) {
      // 跨区缩放：主城区东北角拉到最远、光标指向两区之间 20 km 外的空白处时，最近的矩形变成飞地，
      // apply 按 slack 硬夹会在一帧内把画面拽进飞地（实测跳约 2.1 km）。此时令 slack 至少为超出的距离：
      // 当帧 apply 不移动注视点，之后由 update 逐帧衰减 slack、画面滑进飞地。
      // 只对跨区这样做：在同一区域的外缘（如主城区东缘拉远后光标指向画面上沿持续向内滚）照旧硬夹，
      // 否则连续滚动时注视点会一路跑出数据范围数公里、松手才弹回；
      // 注视点仍在矩形内时 gap 为 0，矩形内的缩放与改动前逐位一致。
      // 拖拽只改方位与俯仰、不移动注视点，工具栏缩放（不传 anchor）也不移动注视点，都不需要这样处理
      const near = nearestRect(this.target.x, this.target.z, L.bounds, NEAR)
      if (near.index !== fromIndex) this.slack = Math.max(this.slack, near.gap)
    }
    this.pause()
    this.apply()
  }

  /** 暂停巡览，进入人工接管 */
  pause() {
    if (this.playing) this.onPlayingChange(false)
    this.playing = false
    this.idleElapsed = 0
  }

  /**
   * 恢复巡览：已抵达当前站则推进到下一站；
   * 若上一次飞行被人工打断（未抵达），则重飞当前站，避免跳过它。
   */
  resume() {
    // 已在播放时重复调用不做任何事，否则会平白跳过一站
    if (this.playing) return
    this.playing = true
    this.onPlayingChange(true)
    const current = Math.max(this.current, 0)
    const next = this.arrived ? current + 1 : current
    this.gotoStop(next % this.stops.length, false)
  }

  /** 外部开关巡览（工具栏按钮） */
  setPlaying(value) {
    if (value) this.resume()
    else this.pause()
  }

  /**
   * 开始向某机位飞行。
   * 直角坐标插值在方位差接近 180° 时会让偏移向量穿过零点、镜头甩动并掠过头顶，
   * 改为球坐标插值并走最短弧：注视点直线插值，方位角沿最短方向转，俯仰与距离线性过渡。
   */
  _flyTo(stop) {
    this.holdElapsed = 0
    // 新飞行（含跳过动画的直接跳转）开始：上一次打断留下的容差作废，飞行结束后按硬夹取
    this.slack = 0
    if (this.reduceMotion) {
      this._jumpTo(stop)
      this.flying = false
      if (this.flyingToStop) this._arrive()
      return
    }
    const offset = new Vector3()
    this.flyFrom.target.copy(this.target)
    this.flyFrom.s.setFromVector3(
      offset.copy(this.camera.position).sub(this.target)
    )
    // 终点注视点夹进范围矩形（飞行途中不夹取，落点必须在范围内，否则抵达后会被拽走）。
    // 相机相对注视点的偏移取自原机位（p − t），等价于把 stop.p 与 stop.t 平移同一个夹取量，
    // 抵达后的构图不变；现有各站与总览都在范围内，夹取量为 0，行为不变
    offset.set(
      stop.p[0] - stop.t[0],
      stop.p[1] - stop.t[1],
      stop.p[2] - stop.t[2]
    )
    const toNear = nearestRect(stop.t[0], stop.t[2], this.limits.bounds)
    this.flyTo.target.set(toNear.x, stop.t[1], toNear.z)
    this.flyTo.s.setFromVector3(offset)
    // 方位差归一化到 [-π, π]，保证走最短弧
    const d = this.flyTo.s.theta - this.flyFrom.s.theta
    this.flyDTheta = Math.atan2(Math.sin(d), Math.cos(d))
    // 大角度转向按方位差拉长飞行时间（见 SLOW_TURN_FROM）
    const turn = Math.abs(this.flyDTheta)
    const turnK =
      turn > SLOW_TURN_FROM ? Math.min(SLOW_TURN_MAX, turn / SLOW_TURN_FROM) : 1
    // 跨区域飞行（起点与终点注视点最近的范围矩形不是同一块）按注视点水平位移拉长时间，
    // 并在半程拉高（见 LONG_FLY_FROM）：相机距离在线性插值之外叠加 flyHop · sin(π · 缓动进度)，
    // 半程距离至少为位移的一半，既看得到飞越的过程，又不会贴地掠过空白地面。
    // 按区域而不是按距离判定：主城区内有 7 对站相距超过 5 km，它们的飞行（含导航栏手动点站）必须不变
    const travel = Math.hypot(
      this.flyTo.target.x - this.flyFrom.target.x,
      this.flyTo.target.z - this.flyFrom.target.z
    )
    const fromNear = nearestRect(
      this.flyFrom.target.x,
      this.flyFrom.target.z,
      this.limits.bounds
    )
    const long = fromNear.index !== toNear.index
    const farK = long ? Math.max(1, Math.sqrt(travel / LONG_FLY_FROM)) : 1
    this.flyDuration =
      this.timing.fly * Math.min(LONG_FLY_MAX, Math.max(turnK, farK))
    this.flyHop = long
      ? Math.max(
          0,
          travel / 2 - (this.flyFrom.s.radius + this.flyTo.s.radius) / 2
        )
      : 0
    this.flyProgress = 0
    this.flying = true
  }

  /** 标记已抵达当前站并通知外部 */
  _arrive() {
    this.arrived = true
    this.onArrive(this.current)
  }

  /**
   * 飞往某个景点机位。
   * @param {number} index 景点索引
   * @param {boolean} manual 是否由人工触发（人工触发会暂停巡览）
   */
  gotoStop(index, manual) {
    this.current = index
    this.arrived = false
    this.flyingToStop = true
    this.onStopChange(index)
    this._flyTo(this.stops[index])
    if (manual) this.pause()
  }

  /** 飞回总览机位（人工操作，不改变当前站，也不改变抵达状态） */
  gotoOverview() {
    this.flyingToStop = false
    this._flyTo(this.overview)
    this.pause()
  }

  /** 视线方位角（度，0 为朝北，顺时针为正），供指北针使用 */
  getHeading() {
    return -this.spherical.theta / DEG
  }

  /** 相机到注视点的距离（米），供比例尺使用 */
  getDistance() {
    return this.spherical.radius
  }

  /** 每帧推进，dt 单位为秒 */
  update(dt) {
    if (this.flying) {
      this.flyProgress += dt / this.flyDuration
      const k = Math.min(1, this.flyProgress)
      const e = easeInOutCubic(k)
      const from = this.flyFrom
      const to = this.flyTo
      this.target.lerpVectors(from.target, to.target, e)
      this.spherical.theta = from.s.theta + this.flyDTheta * e
      this.spherical.phi = lerp(from.s.phi, to.s.phi, e)
      this.spherical.radius =
        lerp(from.s.radius, to.s.radius, e) +
        this.flyHop * Math.sin(Math.PI * e)
      this.apply()
      if (k >= 1) {
        this.flying = false
        if (this.flyingToStop) this._arrive()
      }
      return
    }

    // 人工打断跨区域飞行、或滚轮缩放把注视点带出范围后，注视点可能还停在范围外的空白地面（见 _stopFlying、zoom）：
    // 容差按指数衰减（约 0.6 s 衰减 95%）并重新夹取，即使巡览已暂停，画面也会平滑滑回数据区；
    // 低于 1 m 时直接归零，收尾那一下夹取不到 1 m，看不出来
    if (this.slack > 0) {
      this.slack = this.slack < 1 ? 0 : this.slack * Math.exp(-dt * 5)
      this.apply()
    }

    if (this.playing) {
      this.holdElapsed += dt
      // 停靠期间极缓慢环绕，让画面不完全静止
      this.spherical.theta += dt * this.timing.drift
      this.apply()
      if (this.holdElapsed > this.timing.hold) {
        this.gotoStop((this.current + 1) % this.stops.length, false)
      }
      return
    }

    this.idleElapsed += dt
    if (this.idleElapsed > this.timing.idle && !this.dragging) this.resume()
  }

  dispose() {
    this.dom.removeEventListener("pointerdown", this._onPointerDown)
    this.dom.removeEventListener("pointermove", this._onPointerMove)
    this.dom.removeEventListener("pointerup", this._onPointerUp)
    this.dom.removeEventListener("pointercancel", this._onPointerUp)
    this.dom.removeEventListener("lostpointercapture", this._onPointerUp)
    this.dom.removeEventListener("wheel", this._onWheel)
    this.dom.removeEventListener("contextmenu", this._onContextMenu)
  }
}

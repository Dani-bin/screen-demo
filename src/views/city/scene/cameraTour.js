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
// 长距离飞行（主城区 ↔ 飞地）：注视点水平位移超过 LONG_FLY_FROM（米）时，
// 时长按 √(位移 / LONG_FLY_FROM) 放大，与大角度转向系数取较大者，最多 × LONG_FLY_MAX；
// 并在半程把相机拉高（见 _flyTo 的 flyHop）。主城区内各站相距 ≤ 约 4.7 km，不受影响。
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
 * 把 (x, z) 夹到矩形数组里离它最近的一块（已在某块内时原样返回），结果写回 out。
 * @param {Array<{x: number[], z: number[]}>} rects
 */
function clampToRects(x, z, rects, out) {
  let best = Infinity
  for (const r of rects) {
    const cx = Math.max(r.x[0], Math.min(r.x[1], x))
    const cz = Math.max(r.z[0], Math.min(r.z[1], z))
    const d = (cx - x) ** 2 + (cz - z) ** 2
    if (d < best) {
      best = d
      out.x = cx
      out.z = cz
    }
  }
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
    this.flyHop = 0 // 本次飞行半程的相机距离抬升量（米），只有长距离飞行非 0（见 _flyTo）

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
      this.flying = false
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
   * 把球坐标写回相机，并做俯仰、距离、注视点范围的夹取。
   * 注视点只在非飞行时夹取（夹到离它最近的那块范围矩形）：飞行（巡览、复位、点导航）的
   * 起止点都在数据范围内，途中跨越主城区与飞地之间的空白地面时不能被拽回最近的区域
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
      clampToRects(this.target.x, this.target.z, L.bounds, this.target)
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
   * 比例按夹取后的距离算，距离已到上下限时注视点也不再移动
   */
  zoom(factor, anchor) {
    const s = this.spherical
    const L = this.limits
    const from = s.radius
    s.radius = Math.max(L.radiusMin, Math.min(L.radiusMax, from * factor))
    if (anchor && from > 0) {
      const k = s.radius / from
      this.target.x = anchor.x + (this.target.x - anchor.x) * k
      this.target.z = anchor.z + (this.target.z - anchor.z) * k
    }
    this.flying = false
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
    this.flyTo.target.set(stop.t[0], stop.t[1], stop.t[2])
    this.flyTo.s.setFromVector3(
      offset.set(stop.p[0], stop.p[1], stop.p[2]).sub(this.flyTo.target)
    )
    // 方位差归一化到 [-π, π]，保证走最短弧
    const d = this.flyTo.s.theta - this.flyFrom.s.theta
    this.flyDTheta = Math.atan2(Math.sin(d), Math.cos(d))
    // 大角度转向按方位差拉长飞行时间（见 SLOW_TURN_FROM）
    const turn = Math.abs(this.flyDTheta)
    const turnK =
      turn > SLOW_TURN_FROM ? Math.min(SLOW_TURN_MAX, turn / SLOW_TURN_FROM) : 1
    // 长距离飞行按注视点水平位移拉长时间，并在半程拉高（见 LONG_FLY_FROM）：
    // 相机距离在线性插值之外叠加 flyHop · sin(π · 缓动进度)，半程距离至少为位移的一半，
    // 既看得到飞越的过程，又不会贴地掠过空白地面
    const travel = Math.hypot(
      this.flyTo.target.x - this.flyFrom.target.x,
      this.flyTo.target.z - this.flyFrom.target.z
    )
    const long = travel > LONG_FLY_FROM
    const farK = long ? Math.sqrt(travel / LONG_FLY_FROM) : 1
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

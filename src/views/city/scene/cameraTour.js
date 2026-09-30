/*
 * 相机巡览与轨道控制
 * ----------------------------------------------------------
 * 大屏多数时间无人值守，因此默认自动巡览：按景点依次停靠，
 * 每站停留若干秒并通知外部切换介绍面板。
 * 一旦有人操作（拖拽 / 滚轮 / 点击 / 工具栏）立即暂停，空闲一段时间后自动恢复。
 *
 * 轨道控制自行实现：只需要「绕注视点旋转 + 缩放」，与巡览状态机共用同一套球坐标。
 * 注视点被限制在数据范围内，俯仰与距离也有夹取，避免转到地底或飞出城区。
 */
import { Spherical, Vector3 } from "three"

const DEG = Math.PI / 180

/** easeInOutCubic：起步与收尾都平缓，避免大屏上镜头生硬 */
function easeInOutCubic(k) {
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
}

/** 线性插值 */
function lerp(a, b, k) {
  return a + (b - a) * k
}

export class CameraTour {
  /**
   * @param {object} options
   * @param {THREE.PerspectiveCamera} options.camera
   * @param {HTMLElement} options.domElement 接收鼠标事件的元素
   * @param {Array<{p:number[], t:number[]}>} options.stops 各站机位：p 相机位置、t 注视点
   * @param {{p:number[], t:number[]}} options.overview 总览机位
   * @param {object} options.limits theme.camera（pitchMin/Max、radiusMin/Max）加 bounds：
   *   注视点范围 { x: [min, max], z: [min, max] }，由 CityScene 按数据范围算出
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
      this.zoom(Math.exp(dy * 0.0015))
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

  /** 把球坐标写回相机，并做俯仰、距离、注视点范围的夹取 */
  apply() {
    const s = this.spherical
    const L = this.limits
    // phi 是与 +Y 的夹角：俯仰 pitch = 90° - phi
    s.phi = Math.max(
      (90 - L.pitchMax) * DEG,
      Math.min((90 - L.pitchMin) * DEG, s.phi)
    )
    s.radius = Math.max(L.radiusMin, Math.min(L.radiusMax, s.radius))
    this.target.x = Math.max(
      L.bounds.x[0],
      Math.min(L.bounds.x[1], this.target.x)
    )
    this.target.z = Math.max(
      L.bounds.z[0],
      Math.min(L.bounds.z[1], this.target.z)
    )
    this.camera.position
      .copy(this.target)
      .add(new Vector3().setFromSpherical(s))
    this.camera.lookAt(this.target)
  }

  /** 缩放：factor > 1 拉远，< 1 拉近；属于人工操作，会暂停巡览 */
  zoom(factor) {
    this.spherical.radius *= factor
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
      this.flyProgress += dt / this.timing.fly
      const k = Math.min(1, this.flyProgress)
      const e = easeInOutCubic(k)
      const from = this.flyFrom
      const to = this.flyTo
      this.target.lerpVectors(from.target, to.target, e)
      this.spherical.theta = from.s.theta + this.flyDTheta * e
      this.spherical.phi = lerp(from.s.phi, to.s.phi, e)
      this.spherical.radius = lerp(from.s.radius, to.s.radius, e)
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

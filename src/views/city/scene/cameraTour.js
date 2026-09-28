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

export class CameraTour {
  /**
   * @param {object} options
   * @param {THREE.PerspectiveCamera} options.camera
   * @param {HTMLElement} options.domElement 接收鼠标事件的元素
   * @param {Array<{p:number[], t:number[]}>} options.stops 各站机位：p 相机位置、t 注视点
   * @param {{p:number[], t:number[]}} options.overview 总览机位
   * @param {object} options.limits theme.camera（pitchMin/Max、radiusMin/Max、bounds）
   * @param {object} options.timing theme.tour（fly / hold / idle / drift，秒）
   * @param {Function} options.onStopChange 停靠点变化回调，参数为索引
   * @param {Function} options.onPlayingChange 巡览播放状态变化回调
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
    this.reduceMotion = Boolean(options.reduceMotion)

    this.target = new Vector3()
    this.spherical = new Spherical()

    this.current = -1
    this.playing = true
    this.flying = false
    this.flyProgress = 0
    this.holdElapsed = 0
    this.idleElapsed = 0
    this.dragging = false
    this.lastX = 0
    this.lastY = 0

    this.flyFrom = { position: new Vector3(), target: new Vector3() }
    this.flyTo = { position: new Vector3(), target: new Vector3() }

    // 初始机位：总览
    this._jumpTo(this.overview)
    this._bindEvents()
  }

  _bindEvents() {
    this._onPointerDown = (e) => {
      this.dragging = true
      this.lastX = e.clientX
      this.lastY = e.clientY
      this.dom.setPointerCapture(e.pointerId)
      this.pause()
    }
    this._onPointerMove = (e) => {
      if (!this.dragging) return
      this.spherical.theta -= (e.clientX - this.lastX) * 0.005
      this.spherical.phi -= (e.clientY - this.lastY) * 0.005
      this.lastX = e.clientX
      this.lastY = e.clientY
      this.flying = false
      this.apply()
    }
    this._onPointerUp = (e) => {
      this.dragging = false
      try {
        this.dom.releasePointerCapture(e.pointerId)
      } catch {
        // 指针已释放，忽略
      }
    }
    this._onWheel = (e) => {
      e.preventDefault()
      this.zoom(1 + Math.sign(e.deltaY) * 0.09)
    }

    this.dom.addEventListener("pointerdown", this._onPointerDown)
    this.dom.addEventListener("pointermove", this._onPointerMove)
    this.dom.addEventListener("pointerup", this._onPointerUp)
    this.dom.addEventListener("wheel", this._onWheel, { passive: false })
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

  /** 恢复巡览，并推进到下一站 */
  resume() {
    this.playing = true
    this.onPlayingChange(true)
    this.gotoStop((this.current + 1) % this.stops.length, false)
  }

  /** 外部开关巡览（工具栏按钮） */
  setPlaying(value) {
    if (value) this.resume()
    else this.pause()
  }

  /** 开始向某机位飞行 */
  _flyTo(stop) {
    this.flyFrom.position.copy(this.camera.position)
    this.flyFrom.target.copy(this.target)
    this.flyTo.position.set(stop.p[0], stop.p[1], stop.p[2])
    this.flyTo.target.set(stop.t[0], stop.t[1], stop.t[2])
    if (this.reduceMotion) {
      this._jumpTo(stop)
      this.flying = false
    } else {
      this.flyProgress = 0
      this.flying = true
    }
    this.holdElapsed = 0
  }

  /**
   * 飞往某个景点机位。
   * @param {number} index 景点索引
   * @param {boolean} manual 是否由人工触发（人工触发会暂停巡览）
   */
  gotoStop(index, manual) {
    this.current = index
    this.onStopChange(index)
    this._flyTo(this.stops[index])
    if (manual) this.pause()
  }

  /** 飞回总览机位（人工操作，不改变当前站） */
  gotoOverview() {
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
      const position = this.flyFrom.position
        .clone()
        .lerp(this.flyTo.position, e)
      this.target.copy(this.flyFrom.target.clone().lerp(this.flyTo.target, e))
      this.spherical.setFromVector3(position.sub(this.target))
      this.apply()
      if (k >= 1) this.flying = false
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
    this.dom.removeEventListener("wheel", this._onWheel)
  }
}

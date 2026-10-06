/*
 * 相机巡览与轨道控制
 * ----------------------------------------------------------
 * 大屏多数时间无人值守，因此默认自动巡览：按预设机位依次停靠，
 * 每站停留若干秒并通知外部切换介绍面板。
 * 一旦有人操作（拖拽 / 滚轮 / 点击建筑）立即暂停，
 * 空闲一段时间后自动恢复。
 *
 * 轨道控制自行实现而非引入 OrbitControls：
 * 只需要「绕注视点旋转 + 缩放」两种行为，自写约五十行，
 * 省掉一份 examples/jsm 依赖，也便于和巡览状态机共用同一套球坐标。
 */
import { Spherical, Vector3 } from "three"

/** 相机飞行时长（秒） */
const FLY_DURATION = 2.6
/** 每站停留时长（秒） */
const HOLD_DURATION = 6.4
/** 人工操作后多久无动作自动恢复巡览（秒） */
const IDLE_RESUME = 15
/** 俯仰角限制：防止转到地平线以下看到地底 */
const PHI_MIN = 0.24
const PHI_MAX = 1.5
/** 观察距离限制 */
const RADIUS_MIN = 16
const RADIUS_MAX = 320

/** easeInOutCubic：起步与收尾都平缓，避免大屏上镜头生硬 */
function easeInOutCubic(k) {
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
}

export class CameraTour {
  /**
   * @param {object} options
   * @param {THREE.PerspectiveCamera} options.camera
   * @param {HTMLElement} options.domElement 接收鼠标事件的元素
   * @param {Array} options.landmarks 地标数组，取其中的 cam 机位
   * @param {Function} options.onStopChange 停靠点变化回调，参数为索引
   * @param {Function} options.onPlayingChange 巡览播放状态变化回调
   * @param {boolean} options.reduceMotion 是否跳过飞行动画
   */
  constructor(options) {
    this.camera = options.camera
    this.dom = options.domElement
    this.landmarks = options.landmarks
    this.onStopChange = options.onStopChange || (() => {})
    this.onPlayingChange = options.onPlayingChange || (() => {})
    this.reduceMotion = Boolean(options.reduceMotion)

    this.target = new Vector3()
    this.spherical = new Spherical()

    this.current = 0
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
      this.spherical.radius *= 1 + Math.sign(e.deltaY) * 0.09
      this.flying = false
      this.pause()
      this.apply()
    }

    this.dom.addEventListener("pointerdown", this._onPointerDown)
    this.dom.addEventListener("pointermove", this._onPointerMove)
    this.dom.addEventListener("pointerup", this._onPointerUp)
    this.dom.addEventListener("wheel", this._onWheel, { passive: false })
  }

  /** 把球坐标写回相机，并做俯仰与距离的夹取 */
  apply() {
    const s = this.spherical
    s.phi = Math.max(PHI_MIN, Math.min(PHI_MAX, s.phi))
    s.radius = Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, s.radius))
    this.camera.position
      .copy(this.target)
      .add(new Vector3().setFromSpherical(s))
    this.camera.lookAt(this.target)
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
    this.gotoStop((this.current + 1) % this.landmarks.length, false)
  }

  /**
   * 飞往某个地标机位。
   * @param {number} index 地标索引
   * @param {boolean} manual 是否由人工触发（人工触发会暂停巡览）
   */
  gotoStop(index, manual) {
    this.current = index
    this.onStopChange(index)

    const cam = this.landmarks[index].cam
    this.flyFrom.position.copy(this.camera.position)
    this.flyFrom.target.copy(this.target)
    this.flyTo.position.set(cam.p[0], cam.p[1], cam.p[2])
    this.flyTo.target.set(cam.t[0], cam.t[1], cam.t[2])

    if (this.reduceMotion) {
      this.target.copy(this.flyTo.target)
      this.spherical.setFromVector3(
        this.flyTo.position.clone().sub(this.flyTo.target)
      )
      this.apply()
      this.flying = false
    } else {
      this.flyProgress = 0
      this.flying = true
    }

    this.holdElapsed = 0
    if (manual) this.pause()
  }

  /** 每帧推进，dt 单位为秒 */
  update(dt) {
    if (this.flying) {
      this.flyProgress += dt / FLY_DURATION
      const k = Math.min(1, this.flyProgress)
      const e = easeInOutCubic(k)
      const position = this.flyFrom.position
        .clone()
        .lerp(this.flyTo.position, e)
      this.target.copy(this.flyFrom.target.clone().lerp(this.flyTo.target, e))
      this.spherical.setFromVector3(position.clone().sub(this.target))
      this.apply()
      if (k >= 1) this.flying = false
      return
    }

    if (this.playing) {
      this.holdElapsed += dt
      // 停靠期间极缓慢环绕，让画面不完全静止
      this.spherical.theta += dt * 0.005
      this.apply()
      if (this.holdElapsed > HOLD_DURATION) {
        this.gotoStop((this.current + 1) % this.landmarks.length, false)
      }
      return
    }

    this.idleElapsed += dt
    if (this.idleElapsed > IDLE_RESUME && !this.dragging) this.resume()
  }

  dispose() {
    this.dom.removeEventListener("pointerdown", this._onPointerDown)
    this.dom.removeEventListener("pointermove", this._onPointerMove)
    this.dom.removeEventListener("pointerup", this._onPointerUp)
    this.dom.removeEventListener("wheel", this._onWheel)
  }
}

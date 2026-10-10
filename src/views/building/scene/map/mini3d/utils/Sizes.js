import { EventEmitter } from "./EventEmitter"

/**
 * 画布尺寸管理
 * 画布父元素的尺寸随 rem（amfe-flexible 在 resize 后改根字号）变化，
 * 只监听 window resize 会读到旧尺寸，所以这里用 ResizeObserver 直接观察画布父元素。
 */
export class Sizes extends EventEmitter {
  constructor({ canvas }) {
    super()
    this.canvas = canvas
    this.pixelRatio = 2
    this.init()
    this.onResize = () => {
      const w = this.width
      const h = this.height
      this.init()
      if (w !== this.width || h !== this.height) {
        this.emit("resize")
      }
    }
    if (typeof ResizeObserver !== "undefined" && canvas.parentNode) {
      this.observer = new ResizeObserver(this.onResize)
      this.observer.observe(canvas.parentNode)
    } else {
      window.addEventListener("resize", this.onResize)
    }
  }
  init() {
    this.width = this.canvas.parentNode.offsetWidth
    this.height = this.canvas.parentNode.offsetHeight
    this.pixelRatio = this.pixelRatio || Math.min(window.devicePixelRatio, 2)
  }
  destroy() {
    this.off("resize")
    if (this.observer) {
      this.observer.disconnect()
    } else {
      window.removeEventListener("resize", this.onResize)
    }
  }
}

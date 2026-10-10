import { AxesHelper, Scene, Mesh } from "three"
import { EventEmitter, Sizes, Time } from "../utils"
import { Renderer } from "./Renderer"
import { Camera } from "./Camera"

export { Camera, Renderer }

export class Mini3d extends EventEmitter {
  constructor(canvas, config = {}) {
    super()
    const defaultConfig = {
      isOrthographic: false,
      // 透明画布：叠在页面背景上使用
      alpha: false
    }
    this.config = Object.assign({}, defaultConfig, config)
    this.canvas = canvas
    this.scene = new Scene()
    this.sizes = new Sizes(this)
    this.time = new Time(this)
    this.camera = new Camera(this, {
      isOrthographic: this.config.isOrthographic
    })
    this.renderer = new Renderer(this)
    this.sizes.on("resize", () => {
      this.resize()
    })
    this.time.on("tick", (delta) => {
      this.update(delta)
    })
  }
  /**
   * 设置 AxesHelper
   * @param {number} size 尺寸
   */
  setAxesHelper(size = 250) {
    if (!size) {
      return false
    }
    const axes = new AxesHelper(size)
    this.scene.add(axes)
  }
  resize() {
    this.camera.resize()
    this.renderer.resize()
  }
  update(delta) {
    this.camera.update(delta)
    this.renderer.update(delta)
  }
  /**
   * 销毁
   */
  destroy() {
    this.sizes.destroy()
    this.time.destroy()
    this.camera.destroy()
    this.renderer.destroy()
    this.scene.traverse((child) => {
      if (child instanceof Mesh) {
        child.geometry.dispose()
        for (const key in child.material) {
          const value = child.material[key]
          if (value && typeof value.dispose === "function") {
            value.dispose()
          }
        }
      }
    })
    if (this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas)
    }
  }
}

import { WebGLRenderer } from "three"

export class Renderer {
  constructor({
    canvas,
    sizes,
    scene,
    camera,
    config = {},
    postprocessing = false,
    composer = null
  }) {
    this.canvas = canvas
    this.sizes = sizes
    this.scene = scene
    this.camera = camera
    this.config = config
    this.postprocessing = postprocessing
    this.composer = composer
    this.setInstance()
  }
  setInstance() {
    const alpha = !!this.config.alpha
    this.instance = new WebGLRenderer({
      alpha,
      antialias: true,
      canvas: this.canvas
    })
    if (alpha) {
      this.instance.setClearColor(0x000000, 0)
    }
    this.instance.setSize(this.sizes.width, this.sizes.height)
    this.instance.setPixelRatio(this.sizes.pixelRatio)
  }
  resize() {
    this.instance.setSize(this.sizes.width, this.sizes.height)
    this.instance.setPixelRatio(this.sizes.pixelRatio)
  }
  update() {
    if (this.postprocessing && this.composer) {
      this.composer.render()
    } else {
      this.instance.render(this.scene, this.camera.instance)
    }
  }
  destroy() {
    this.instance.dispose()
    this.instance.forceContextLoss()
  }
}

import {
  PointsMaterial,
  AdditiveBlending,
  BufferGeometry,
  BufferAttribute,
  Points,
  CanvasTexture
} from "three"

/**
 * 上升粒子
 */
export class Particles {
  constructor({ time }, config = {}) {
    this.instance = null
    this.time = time
    this.enable = true
    this.config = Object.assign(
      {
        num: 100,
        range: 500,
        speed: 0.01,
        renderOrder: 99,
        dir: "up",
        material: new PointsMaterial({
          map: Particles.createTexture(),
          size: 20,
          color: 0xffffff,
          transparent: true,
          opacity: 1.0,
          depthTest: false,
          vertexColors: true,
          blending: AdditiveBlending,
          sizeAttenuation: true
        })
      },
      config
    )
    this.create()
  }
  create() {
    const { range, dir, material, num, renderOrder } = this.config
    const position = []
    const colors = []
    const velocities = []
    for (let i = 0; i < num; i++) {
      position.push(
        Math.random() * range - range / 2,
        Math.random() * range - range / 2,
        Math.random() * range - range / 2
      )
      const dirVec = dir === "up" ? 1 : -1
      velocities.push(
        Math.random() * dirVec,
        (0.1 + Math.random()) * dirVec,
        0.1 + Math.random() * dirVec
      )
      const color = material.color.clone()
      const hsl = {}
      color.getHSL(hsl)
      color.setHSL(hsl.h, hsl.s, hsl.l * Math.random())
      colors.push(color.r, color.g, color.b)
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(position), 3)
    )
    geometry.setAttribute(
      "velocities",
      new BufferAttribute(new Float32Array(velocities), 3)
    )
    geometry.setAttribute(
      "color",
      new BufferAttribute(new Float32Array(colors), 3)
    )
    this.instance = new Points(geometry, material)
    this.instance.renderOrder = renderOrder
  }
  static createTexture() {
    const canvas = document.createElement("canvas")
    canvas.width = 1024
    canvas.height = 1024
    const context = canvas.getContext("2d")
    const gradient = context.createRadialGradient(512, 512, 0, 512, 512, 512)
    gradient.addColorStop(0, "rgba(255,255,255,1)")
    gradient.addColorStop(1, "rgba(255,255,255,0)")
    context.fillStyle = gradient
    context.fillRect(0, 0, 1024, 1024)
    return new CanvasTexture(canvas)
  }
  update(delta, elapsedTime) {
    if (!this.instance) return false
    const { range, speed, dir } = this.config
    const dirVec = dir === "up" ? 1 : -1
    const position = this.instance.geometry.getAttribute("position")
    const velocities = this.instance.geometry.getAttribute("velocities")
    const count = position.count
    for (let i = 0; i < count; i++) {
      let posX = position.getX(i)
      let posZ = position.getZ(i)
      const velX = velocities.getX(i)
      posX += Math.sin(velX * elapsedTime) * delta
      posZ += speed * dirVec
      if (posZ > range / 2 && dirVec === 1) {
        posZ = -range / 2
      }
      if (posZ < -range / 2 && dirVec === -1) {
        posZ = range / 2
      }
      position.setX(i, posX)
      position.setZ(i, posZ)
    }
    position.needsUpdate = true
  }
  setParent(parent) {
    parent.add(this.instance)
    this.time.on("tick", (delta, elapsedTime) => {
      if (this.enable) {
        this.update(delta, elapsedTime)
      }
    })
  }
}

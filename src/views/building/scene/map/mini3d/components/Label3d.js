import {
  CSS3DObject,
  CSS3DSprite,
  CSS3DRenderer
} from "three/examples/jsm/renderers/CSS3DRenderer.js"
import { uuid } from "../utils/utils"

/**
 * CSS3D 标签管理：在 canvas 旁叠一层 CSS3DRenderer，标签为真实 DOM，跟随场景变换
 */
export class Label3d {
  constructor({ scene, camera, time, sizes, canvas }) {
    this.scene = scene
    this.camera = camera
    this.time = time
    this.sizes = sizes
    this.canvas = canvas
    this.parent = null
    const { width, height } = this.sizes
    const css3dRender = new CSS3DRenderer()
    this.css3dRender = css3dRender
    css3dRender.setSize(width, height)
    css3dRender.domElement.style.position = "absolute"
    css3dRender.domElement.style.left = "0px"
    css3dRender.domElement.style.top = "0px"
    css3dRender.domElement.style.pointerEvents = "none"
    css3dRender.domElement.className = "label3d-" + uuid()
    this.canvas.parentNode.appendChild(css3dRender.domElement)
    this.onTick = () => this.update()
    this.onResize = () => this.resize()
    this.time.on("tick", this.onTick)
    this.sizes.on("resize", this.onResize)
  }
  create(content = "", className = "", isSprite = false) {
    const tag = document.createElement("div")
    tag.innerHTML = content
    tag.className = className
    tag.style.visibility = "hidden"
    tag.style.position = "absolute"
    if (!className) {
      tag.style.padding = "10px"
      tag.style.color = "#fff"
      tag.style.fontSize = "12px"
      tag.style.textAlign = "center"
      tag.style.background = "rgba(0,0,0,0.6)"
      tag.style.borderRadius = "4px"
    }
    const label = isSprite ? new CSS3DSprite(tag) : new CSS3DObject(tag)
    label.init = (html, position) => {
      label.element.innerHTML = html
      label.element.style.visibility = "visible"
      label.position.copy(position)
    }
    label.hide = () => {
      label.element.style.visibility = "hidden"
    }
    label.scaleHide = () => {
      label.element.classList.add("scale-hidden")
    }
    label.show = () => {
      label.element.style.visibility = "visible"
      label.element.classList.remove("scale-hidden")
    }
    label.setParent = (parent) => {
      label.parentGroup = parent
      parent.add(label)
    }
    label.remove = () => {
      if (label.parentGroup) {
        label.parentGroup.remove(label)
        label.parentGroup = null
      }
    }
    return label
  }
  setLabelStyle(
    label,
    scale = 0.1,
    axis = "x",
    axisRotation = Math.PI / 2,
    pointerEvents = "none"
  ) {
    label.element.style.pointerEvents = pointerEvents
    label.scale.set(scale, scale, scale)
    label.rotation[axis] = axisRotation
  }
  setRenderLevel(zIndex) {
    this.css3dRender.domElement.style.zIndex = zIndex
  }
  update() {
    this.css3dRender.render(this.scene, this.camera.instance)
  }
  destroy() {
    this.time.off("tick", this.onTick)
    this.sizes.off("resize", this.onResize)
    if (this.css3dRender) {
      const domElement = this.css3dRender.domElement
      if (domElement.parentNode) {
        domElement.parentNode.removeChild(domElement)
      }
    }
  }
  resize() {
    const { width, height } = this.sizes
    this.css3dRender.setSize(width, height)
  }
}

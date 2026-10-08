import {
  Object3D,
  MeshBasicMaterial,
  DoubleSide,
  AdditiveBlending,
  PlaneGeometry,
  Mesh,
  Color
} from "three"
import gsap from "gsap"
import { emptyObject } from "../utils/GC"

/**
 * 焦点标记：多张贴图平面叠加，gsap 驱动旋转 / 扩散呼吸
 */
export class Focus extends Object3D {
  constructor(self, config) {
    super()
    this.config = Object.assign(
      {
        color1: 0xfcc957,
        color2: 0xffffff
      },
      config
    )
    this.assets = { instance: self.assets.instance }
    this.gsapObjects = []
    this.animateElements = {}
    this.init()
  }
  init() {
    const color = this.config.color1
    const geometry = new PlaneGeometry(1.5, 1.5, 1)
    const barGeometry = new PlaneGeometry(1, 3, 1)
    barGeometry.translate(0, 1, 0)
    const material = new MeshBasicMaterial({
      color,
      transparent: true,
      fog: false,
      side: DoubleSide,
      depthWrite: false
    })
    const focusArrowsMaterial = material.clone()
    focusArrowsMaterial.map = this.assets.instance.getResource("focusArrows")
    const focusBarMaterial = material.clone()
    focusBarMaterial.map = this.assets.instance.getResource("focusBar")
    const focusBgMaterial = material.clone()
    focusBgMaterial.map = this.assets.instance.getResource("focusBg")
    const focusMidQuanMaterial = material.clone()
    focusMidQuanMaterial.color = new Color(this.config.color2)
    focusMidQuanMaterial.map = this.assets.instance.getResource("focusMidQuan")
    const focusMoveBgMaterial = material.clone()
    focusMoveBgMaterial.map = this.assets.instance.getResource("focusMoveBg")
    focusMoveBgMaterial.blending = AdditiveBlending
    const focusArrows = new Mesh(geometry, focusArrowsMaterial)
    const focusBar1 = new Mesh(barGeometry, focusBarMaterial)
    focusBar1.rotation.x = Math.PI / 2
    const focusBar2 = focusBar1.clone()
    focusBar2.rotation.y = Math.PI / 2
    const focusBg = new Mesh(geometry, focusBgMaterial)
    const focusMidQuan = new Mesh(geometry, focusMidQuanMaterial)
    const focusMoveBg = new Mesh(geometry, focusMoveBgMaterial)

    const groupElement = [
      focusMidQuan,
      focusBg,
      focusArrows,
      focusMoveBg,
      focusBar1,
      focusBar2
    ]
    groupElement.forEach((element) => {
      element.renderOrder = 99
    })
    this.add(...groupElement)
    focusMoveBg.scale.setScalar(0)
    this.animateElements = { focusMidQuan, focusArrows, focusMoveBg }
    this.startAnimate()
  }
  startAnimate() {
    const quanTween = gsap.to(this.animateElements.focusMidQuan.rotation, {
      z: 2 * Math.PI,
      duration: 8,
      repeat: -1,
      ease: "none"
    })
    const focusArrowsTween = gsap.to(
      this.animateElements.focusArrows.rotation,
      {
        z: 2 * Math.PI,
        duration: 5,
        repeat: -1,
        ease: "none"
      }
    )
    const focusMoveBgTween = gsap.to(this.animateElements.focusMoveBg.scale, {
      x: 1.5,
      y: 1.5,
      z: 1.5,
      duration: 2.5,
      repeat: -1,
      ease: "none"
    })
    const focusMoveBgMaterialTween = gsap.to(
      this.animateElements.focusMoveBg.material,
      {
        opacity: 0,
        duration: 2.5,
        repeat: -1,
        ease: "none"
      }
    )
    this.gsapObjects = [
      quanTween,
      focusArrowsTween,
      focusMoveBgTween,
      focusMoveBgMaterialTween
    ]
  }
  pausedAnimate() {
    this.gsapObjects.forEach((element) => {
      element.paused = true
    })
  }
  destroy() {
    this.gsapObjects.forEach((element) => {
      element.kill()
    })
    emptyObject(this)
  }
}

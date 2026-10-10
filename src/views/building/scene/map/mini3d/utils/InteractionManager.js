import { Raycaster, Vector2 } from "three"

/**
 * 交互管理器（替代 three.interactive 的最小实现）
 * 通过 Raycaster 拾取已注册的对象，并在对象上派发 DOM 风格事件：
 *   mouseover / mouseout（每帧 update 时计算）
 *   mousedown / mouseup / click（指针事件触发时计算）
 * 监听方式与 three 的 EventDispatcher 一致：object.addEventListener("mouseover", (ev) => ev.target ...)
 */
export class InteractionManager {
  constructor(renderer, camera, domElement) {
    this.renderer = renderer
    this.camera = camera
    this.domElement = domElement
    this.raycaster = new Raycaster()
    this.pointer = new Vector2(-2, -2)
    this.pointerInside = false
    this.objects = []
    this.hovered = new Set()

    this.onPointerMove = (event) => {
      this.updatePointer(event)
      this.pointerInside = true
    }
    this.onPointerLeave = () => {
      this.pointerInside = false
      this.pointer.set(-2, -2)
    }
    this.onPointerDown = (event) =>
      this.dispatchPointerEvent("mousedown", event)
    this.onPointerUp = (event) => this.dispatchPointerEvent("mouseup", event)
    this.onClick = (event) => this.dispatchPointerEvent("click", event)

    domElement.addEventListener("pointermove", this.onPointerMove)
    domElement.addEventListener("pointerleave", this.onPointerLeave)
    domElement.addEventListener("pointerdown", this.onPointerDown)
    domElement.addEventListener("pointerup", this.onPointerUp)
    domElement.addEventListener("click", this.onClick)
  }
  updatePointer(event) {
    const rect = this.domElement.getBoundingClientRect()
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    )
  }
  add(object) {
    if (!this.objects.includes(object)) {
      this.objects.push(object)
    }
  }
  remove(object) {
    this.objects = this.objects.filter((o) => o !== object)
    this.hovered.delete(object)
  }
  /** 对象自身及其所有父级都可见才参与拾取 */
  isVisible(object) {
    let node = object
    while (node) {
      if (!node.visible) return false
      node = node.parent
    }
    return true
  }
  intersect() {
    if (!this.pointerInside || !this.objects.length) return []
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const visible = this.objects.filter((o) => this.isVisible(o))
    return this.raycaster.intersectObjects(visible, false)
  }
  update() {
    const hits = this.intersect()
    const now = new Set(hits.map((hit) => hit.object))
    this.hovered.forEach((object) => {
      if (!now.has(object)) {
        object.dispatchEvent({ type: "mouseout" })
      }
    })
    now.forEach((object) => {
      if (!this.hovered.has(object)) {
        object.dispatchEvent({ type: "mouseover" })
      }
    })
    this.hovered = now
  }
  dispatchPointerEvent(type, originalEvent) {
    this.updatePointer(originalEvent)
    this.pointerInside = true
    this.intersect().forEach((hit) => {
      hit.object.dispatchEvent({ type, originalEvent, intersection: hit })
    })
  }
  dispose() {
    const el = this.domElement
    el.removeEventListener("pointermove", this.onPointerMove)
    el.removeEventListener("pointerleave", this.onPointerLeave)
    el.removeEventListener("pointerdown", this.onPointerDown)
    el.removeEventListener("pointerup", this.onPointerUp)
    el.removeEventListener("click", this.onClick)
    this.objects = []
    this.hovered.clear()
  }
}

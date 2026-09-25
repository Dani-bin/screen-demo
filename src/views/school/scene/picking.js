/*
 * 射线拾取
 * ----------------------------------------------------------
 * 点击三维场景时，沿鼠标方向投射射线，向上回溯命中对象的父级，
 * 找到第一个带 userData.stop 的分组 —— 即该建筑对应的地标索引。
 */
import { Raycaster, Vector2 } from "three"

/**
 * @param {HTMLCanvasElement} canvas
 * @param {THREE.Camera} camera
 * @param {THREE.Object3D} root 场景根分组
 * @returns {(event: PointerEvent) => number|null} 返回命中的地标索引
 */
export function createPicker(canvas, camera, root) {
  const raycaster = new Raycaster()
  const pointer = new Vector2()

  return function pick(event) {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)

    const hits = raycaster.intersectObjects(root.children, true)
    for (const hit of hits) {
      let node = hit.object
      while (node && node !== root) {
        if (typeof node.userData.stop === "number") return node.userData.stop
        node = node.parent
      }
    }
    return null
  }
}

/*
 * 楼体射线拾取
 * ----------------------------------------------------------
 * 全部楼栋合并在一个 Mesh 里，射线命中后拿到三角形序号 faceIndex，
 * 通过 faceToBuilding 表换算回楼栋索引。
 */
import { Raycaster, Vector2 } from "three"

/**
 * @param {HTMLCanvasElement} canvas
 * @param {THREE.Camera} camera
 * @param {THREE.Mesh} mesh 合并后的建筑 Mesh
 * @param {Int32Array} faceToBuilding 三角形 → 楼栋索引
 * @returns {(event: MouseEvent) => number|null} 返回命中的楼栋索引
 */
export function createPicker(canvas, camera, mesh, faceToBuilding) {
  const raycaster = new Raycaster()
  const pointer = new Vector2()

  return function pick(event) {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObject(mesh, false)[0]
    if (!hit || hit.faceIndex == null) return null
    return faceToBuilding[hit.faceIndex]
  }
}

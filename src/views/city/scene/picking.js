/*
 * 楼体 / 景点射线拾取
 * ----------------------------------------------------------
 * 全部通用楼栋合并在一个 Mesh 里，射线命中后拿到三角形序号 faceIndex，
 * 通过 faceToBuilding 表换算回楼栋索引。
 * 景点精细模型各自是独立 Mesh，通过 pickables（Mesh → 景点索引）换算回景点。
 * 两者都命中时取离相机更近的一个，避免隔着前景楼点中后面的景点（或反之）。
 */
import { Raycaster, Vector2 } from "three"

/**
 * @param {HTMLCanvasElement} canvas
 * @param {THREE.Camera} camera
 * @param {THREE.Mesh} mesh 合并后的建筑 Mesh
 * @param {Int32Array} faceToBuilding 三角形 → 楼栋索引
 * @param {{ group: THREE.Group, pickables: Map }} [landmarks] 景点模型组与 Mesh → 景点索引表
 * @returns {(event: MouseEvent) => ({ spot: number } | { building: number } | null)}
 *   命中景点返回 { spot }，命中通用楼返回 { building }，都未命中返回 null
 */
export function createPicker(canvas, camera, mesh, faceToBuilding, landmarks) {
  const raycaster = new Raycaster()
  const pointer = new Vector2()

  /** 命中物体沿父级向上查找所属景点（景点模块可能返回带子节点的 Mesh） */
  function spotOf(obj) {
    for (let o = obj; o; o = o.parent) {
      if (landmarks.pickables.has(o)) return landmarks.pickables.get(o)
    }
    return null
  }

  return function pick(event) {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)

    let spotHit = null
    if (landmarks && landmarks.pickables.size) {
      // intersectObject 结果按距离升序，取第一个属于景点的命中
      for (const h of raycaster.intersectObject(landmarks.group, true)) {
        const spot = spotOf(h.object)
        if (spot !== null) {
          spotHit = { spot, distance: h.distance }
          break
        }
      }
    }

    const hit = raycaster.intersectObject(mesh, false)[0]
    const buildingHit =
      hit && hit.faceIndex != null
        ? { building: faceToBuilding[hit.faceIndex], distance: hit.distance }
        : null

    if (spotHit && (!buildingHit || spotHit.distance <= buildingHit.distance))
      return { spot: spotHit.spot }
    if (buildingHit) return { building: buildingHit.building }
    return null
  }
}

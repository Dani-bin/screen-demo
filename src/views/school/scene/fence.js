/*
 * 铁艺围栏建模
 * ----------------------------------------------------------
 * 校园周界除正大门外全部是铁栅栏，形制依据校门实拍照片：
 * 低矮清水砖基座 + 等距红砖立柱（带白色柱帽）+ 柱间黑色铁艺栅栏。
 *
 * 周长五百余米，竖栅上千根，全部走 InstancedMesh：
 * 每种构件只占一次 draw call，否则大屏帧率会被拖垮。
 */
import { BoxGeometry, Euler, Group, Mesh, Quaternion, Vector3 } from "three"
import { buildInstancedMesh } from "./geometry"

/** 围栏各部位尺寸（米） */
const FENCE = {
  baseHeight: 0.75,
  baseThickness: 0.45,
  pierSize: 0.72,
  pierHeight: 2.3,
  capHeight: 0.2,
  /** 立柱间距的目标值，实际会按每段长度等分取整 */
  pierSpacing: 4.5,
  /** 竖栅顶面高度与间距 */
  barTop: 2.2,
  barSpacing: 0.2,
  barSize: 0.055,
  /** 上下横档高度 */
  railLow: 0.95,
  railHigh: 2.05
}

/**
 * 建一段段铁艺围栏。
 * @param {object} materials 共享材质
 * @param {Array<{x:number,z:number,length:number,rotY:number}>} segments
 *        每段的中心点、长度与绕 Y 的转角（转角使段长方向对齐局部 +X）
 */
export function createFence(materials, segments) {
  const group = new Group()
  const piers = []
  const caps = []
  const rails = []
  const bars = []
  const unit = new Vector3(1, 1, 1)

  segments.forEach(({ x, z, length, rotY }) => {
    const quat = new Quaternion().setFromEuler(new Euler(0, rotY, 0))
    const axis = new Vector3(1, 0, 0).applyQuaternion(quat)
    const at = (offset) =>
      new Vector3(x + axis.x * offset, 0, z + axis.z * offset)

    // 连续砖砌基座
    const base = new Mesh(
      new BoxGeometry(length, FENCE.baseHeight, FENCE.baseThickness),
      materials.brickDeep
    )
    base.position.set(x, FENCE.baseHeight / 2, z)
    base.rotation.y = rotY
    base.castShadow = true
    base.receiveShadow = true
    group.add(base)

    // 立柱：按段长等分，两端各一根
    const bayCount = Math.max(1, Math.round(length / FENCE.pierSpacing))
    const bayLength = length / bayCount
    for (let i = 0; i <= bayCount; i++) {
      const p = at(-length / 2 + bayLength * i)
      piers.push({
        position: new Vector3(p.x, FENCE.pierHeight / 2, p.z),
        quat,
        scale: unit
      })
      caps.push({
        position: new Vector3(p.x, FENCE.pierHeight + FENCE.capHeight / 2, p.z),
        quat,
        scale: unit
      })
    }

    // 每个开间内的栅栏
    const clear = bayLength - FENCE.pierSize
    if (clear <= 0.2) return
    for (let i = 0; i < bayCount; i++) {
      const center = -length / 2 + bayLength * (i + 0.5)
      const c = at(center)

      ;[FENCE.railLow, FENCE.railHigh].forEach((y) => {
        rails.push({
          position: new Vector3(c.x, y, c.z),
          quat,
          scale: new Vector3(clear, 1, 1)
        })
      })

      const barCount = Math.max(2, Math.round(clear / FENCE.barSpacing))
      const barHeight = FENCE.barTop - FENCE.baseHeight
      for (let b = 0; b <= barCount; b++) {
        const p = at(center - clear / 2 + (clear * b) / barCount)
        bars.push({
          position: new Vector3(p.x, FENCE.baseHeight + barHeight / 2, p.z),
          quat,
          scale: new Vector3(1, barHeight, 1)
        })
      }
    }
  })

  group.add(
    buildInstancedMesh(
      new BoxGeometry(FENCE.pierSize, FENCE.pierHeight, FENCE.pierSize),
      materials.brickDeep,
      piers
    )
  )
  group.add(
    buildInstancedMesh(
      new BoxGeometry(
        FENCE.pierSize + 0.18,
        FENCE.capHeight,
        FENCE.pierSize + 0.18
      ),
      materials.trim,
      caps
    )
  )
  group.add(
    buildInstancedMesh(new BoxGeometry(1, 0.08, 0.07), materials.iron, rails)
  )
  group.add(
    buildInstancedMesh(
      new BoxGeometry(FENCE.barSize, 1, FENCE.barSize),
      materials.iron,
      bars
    )
  )

  return group
}

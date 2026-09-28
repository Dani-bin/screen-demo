/*
 * 低多边形树木
 * ----------------------------------------------------------
 * 树冠 = 二十面体（细分 1 次）压扁拉高，树干 = 六棱柱。
 * 公园内按面积随机撒点，河岸两侧沿中心线成排种植。
 * 全部走 InstancedMesh：几千棵树只占两次 draw call。
 * 随机数用固定种子，每次刷新树的位置与颜色一致。
 */
import {
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3
} from "three"
import { mulberry32, pointInPolygon, polygonBounds } from "./utils.js"

/**
 * 生成树的落点 [[x, z], ...]
 * @param {object} data 几何数据（parks / rivers）
 * @param {object} theme
 * @param {Function} rand 返回 [0,1) 的随机函数
 */
export function scatterTrees(data, theme, rand) {
  const t = theme.tree
  const points = []

  for (const poly of data.parks) {
    if (!poly || poly.length < 3) continue
    const { minX, maxX, minZ, maxZ } = polygonBounds(poly)
    const area = (maxX - minX) * (maxZ - minZ)
    const count = Math.min(
      t.parkMaxPerPolygon,
      Math.floor(area / t.parkAreaPerTree)
    )
    // 包围盒内随机取点，落在多边形内的才要；最多尝试 4 倍次数
    for (
      let placed = 0, tries = 0;
      placed < count && tries < count * 4;
      tries++
    ) {
      const x = minX + rand() * (maxX - minX)
      const z = minZ + rand() * (maxZ - minZ)
      if (pointInPolygon(x, z, poly)) {
        points.push([x, z])
        placed++
      }
    }
  }

  for (const line of data.rivers) {
    for (let i = 0; i < line.length - 1; i++) {
      const [x1, z1] = line[i]
      const [x2, z2] = line[i + 1]
      const len = Math.hypot(x2 - x1, z2 - z1)
      if (len < 1e-6) continue
      const nx = -(z2 - z1) / len
      const nz = (x2 - x1) / len
      for (let d = 0; d < len; d += t.riverStep) {
        const k = d / len
        const x = x1 + (x2 - x1) * k
        const z = z1 + (z2 - z1) * k
        points.push([x + nx * t.riverOffset, z + nz * t.riverOffset])
        points.push([x - nx * t.riverOffset, z - nz * t.riverOffset])
      }
    }
  }
  return points
}

/**
 * @returns {{ group: Group, dispose: Function }}
 */
export function createTrees(data, materials, theme) {
  const t = theme.tree
  const rand = mulberry32(t.seed)
  const points = scatterTrees(data, theme, rand)

  const crownGeo = new IcosahedronGeometry(1, 1)
  const trunkGeo = new CylinderGeometry(0.9, 1.2, 1, 6)
  const crown = new InstancedMesh(crownGeo, materials.foliage, points.length)
  const trunk = new InstancedMesh(trunkGeo, materials.trunk, points.length)

  const greens = t.greens.map((c) => new Color(c))
  const yellow = new Color(t.yellow)
  const m = new Matrix4()
  const q = new Quaternion()
  const s = new Vector3()
  const p = new Vector3()

  points.forEach(([x, z], i) => {
    const size = t.crownMin + rand() * t.crownVar
    const height = t.trunkMin + rand() * t.trunkVar
    m.compose(
      p.set(x, height + size * 0.7, z),
      q,
      s.set(size, size * 1.15, size)
    )
    crown.setMatrixAt(i, m)
    crown.setColorAt(
      i,
      rand() < t.yellowRatio
        ? yellow
        : greens[Math.floor(rand() * greens.length)]
    )
    m.compose(p.set(x, height / 2, z), q, s.set(1, height, 1))
    trunk.setMatrixAt(i, m)
  })
  crown.castShadow = true
  trunk.castShadow = true

  const group = new Group()
  group.add(crown, trunk)
  return {
    group,
    count: points.length,
    dispose() {
      crownGeo.dispose()
      trunkGeo.dispose()
    }
  }
}

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
 * 障碍物网格索引：把多边形按包围盒登记到均匀网格里，
 * 查询时只看点所在的那一格，避免对几千栋楼逐个做点在多边形内判断。
 * @param {Array} polygons 多边形数组 [[[x, z], ...], ...]
 * @param {number} cellSize 网格边长（米）
 * @returns {{ contains: (x: number, z: number) => boolean }}
 */
export function createObstacleIndex(polygons, cellSize = 100) {
  const cells = new Map()
  for (const poly of polygons) {
    if (!poly || poly.length < 3) continue
    // 包围盒只算一次，查询时先用它粗筛
    const b = polygonBounds(poly)
    const entry = { poly, b }
    const ix0 = Math.floor(b.minX / cellSize)
    const ix1 = Math.floor(b.maxX / cellSize)
    const iz0 = Math.floor(b.minZ / cellSize)
    const iz1 = Math.floor(b.maxZ / cellSize)
    // 包围盒覆盖到的每一格都登记一份引用
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const key = `${ix},${iz}`
        let list = cells.get(key)
        if (!list) cells.set(key, (list = []))
        list.push(entry)
      }
    }
  }
  return {
    contains(x, z) {
      const list = cells.get(
        `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`
      )
      if (!list) return false
      return list.some(
        ({ poly, b }) =>
          x >= b.minX &&
          x <= b.maxX &&
          z >= b.minZ &&
          z <= b.maxZ &&
          pointInPolygon(x, z, poly)
      )
    }
  }
}

/**
 * 生成树的落点 [[x, z], ...]
 * @param {object} data 几何数据（parks / rivers，可选 buildings / water 用于避让）
 * @param {object} theme
 * @param {Function} rand 返回 [0,1) 的随机函数
 */
export function scatterTrees(data, theme, rand) {
  const t = theme.tree
  const points = []
  // 河岸树按固定距离离中心线排布，河面宽窄不一，部分会落进水面或临河楼体；
  // 公园与楼体在 OSM 中也有重叠，统一剔除。
  const obstacles = createObstacleIndex([
    ...(data.buildings || []).map((b) => b.p),
    ...(data.water || [])
  ])

  for (const poly of data.parks) {
    if (!poly || poly.length < 3) continue
    const { minX, maxX, minZ, maxZ } = polygonBounds(poly)
    const area = (maxX - minX) * (maxZ - minZ)
    const count = Math.min(
      t.parkMaxPerPolygon,
      Math.floor(area / t.parkAreaPerTree)
    )
    // 包围盒内随机取点，落在多边形内且不压楼、不落水的才要；
    // 被剔除的点也算一次失败尝试，最多尝试 4 倍次数
    for (
      let placed = 0, tries = 0;
      placed < count && tries < count * 4;
      tries++
    ) {
      const x = minX + rand() * (maxX - minX)
      const z = minZ + rand() * (maxZ - minZ)
      if (pointInPolygon(x, z, poly) && !obstacles.contains(x, z)) {
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
        // 河两侧各一棵，落进楼体或水面的直接跳过
        for (const side of [1, -1]) {
          const tx = x + nx * t.riverOffset * side
          const tz = z + nz * t.riverOffset * side
          if (!obstacles.contains(tx, tz)) points.push([tx, tz])
        }
      }
    }
  }
  return points
}

/**
 * @returns {{ group: Group, count: number, dispose: Function }}
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

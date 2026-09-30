/*
 * 低多边形树木
 * ----------------------------------------------------------
 * 树冠 = 二十面体（细分 1 次）竖向拉长 1.15 倍，树干 = 六棱柱（外形尺寸见 treeShape）。
 * 公园内按面积随机撒点，河岸两侧沿中心线成排种植。
 * 全部走 InstancedMesh：几千棵树只占两次 draw call。
 * 随机数用固定种子，每次刷新树的位置与颜色一致；且按元素几何 / 树位置派生，
 * 与数据列表顺序无关（见 scatterTrees、layoutTrees）。
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
import {
  hashInts,
  mulberry32,
  pointInPolygon,
  polygonBounds,
  shapeSeed
} from "./utils.js"

// 树冠随机朝向的旋转轴（竖直向上）
const Y_AXIS = new Vector3(0, 1, 0)

// 树冠外形（均为树冠尺寸 size 的倍数）：单位二十面体水平缩放 size、竖向缩放 1.15·size，
// 中心放在树干顶之上 0.95·size 处，冠底 = 树干高 − 0.2·size，树干能露出来
const CROWN_STRETCH = 1.15
const CROWN_LIFT = 0.95

/**
 * 单棵通用树的外形尺寸（米）。树的造型、整城阴影范围（shadow.js）、
 * 步行路径走廊（landmarks/index.js）都从这里取，改造型时三处自动一致。
 * @param {number} size 树冠水平半径（layoutTrees 的 size）
 * @param {number} height 树干高（layoutTrees 的 height）
 * @returns {{ radius: number, halfHeight: number, centerY: number,
 *   bottom: number, top: number, boundRadius: number }}
 *   radius 树冠水平半径；halfHeight 竖向半轴；centerY 树冠中心高度；
 *   bottom / top 冠底 / 树顶高度；boundRadius 以树冠中心为球心、包住整个树冠的球半径
 *   （二十面体顶点都在单位球面上，缩放后落在半轴 size、1.15·size 的椭球面上）
 */
export function treeShape(size, height) {
  const halfHeight = size * CROWN_STRETCH
  const centerY = height + size * CROWN_LIFT
  return {
    radius: size,
    halfHeight,
    centerY,
    bottom: centerY - halfHeight,
    top: centerY + halfHeight,
    boundRadius: Math.max(size, halfHeight)
  }
}

/**
 * 通用树外形的上限：theme.tree 里最大的树冠配最高的树干（radius、top 都取到最大）。
 * @param {object} t theme.tree
 */
export function treeShapeMax(t) {
  return treeShape(t.crownMin + t.crownVar, t.trunkMin + t.trunkVar)
}

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

// 各用途的子种子标签：与全局 seed 混合后再哈希，保证「公园撒点」与「单棵树外观」
// 两类随机流互不相关（同一个坐标不会在两处取到同一串随机数）
const SALT_PARK = 0x5041524b // "PARK"
const SALT_TREE = 0x54524545 // "TREE"

/**
 * 生成树的落点 [[x, z], ...]
 * 与数据顺序无关：每个公园多边形用自己的随机流（种子 = 全局 seed 与该多边形顶点的
 * 稳定哈希，见 utils.shapeSeed），河岸树按固定步长沿中心线排布、本身不用随机数。
 * 因此数据里插入 / 删除 / 重排元素时，只有变动元素自身的树会变，其余树位置不动。
 * @param {object} data 几何数据（parks / rivers，可选 buildings / water 用于避让）
 * @param {object} theme
 * @param {{ has: (x: number, z: number) => boolean }} [blocked] 额外的占用网格
 *   （景点模型与步行路径走廊，见 landmarks/index.js 的 buildOccupancy），落在其中的候选点跳过
 */
export function scatterTrees(data, theme, blocked = null) {
  const t = theme.tree
  const points = []
  // 河岸树按固定距离离中心线排布，河面宽窄不一，部分会落进水面或临河楼体；
  // 公园与楼体在 OSM 中也有重叠，统一剔除。
  const obstacles = createObstacleIndex([
    ...(data.buildings || []).map((b) => b.p),
    ...(data.water || [])
  ])
  // 景点精细模型不在 OSM 楼里（或已替换掉原楼），另用占用网格避让：
  // 否则亭心、碑台、茶社屋顶会长出通用树，模型被树冠淹没
  const free = (x, z) => !obstacles.contains(x, z) && !blocked?.has(x, z)

  for (const poly of data.parks) {
    if (!poly || poly.length < 3) continue
    // 每个公园一条独立随机流：种子只取决于它自己的几何
    const rand = mulberry32(shapeSeed(t.seed ^ SALT_PARK, poly))
    const { minX, maxX, minZ, maxZ } = polygonBounds(poly)
    const area = (maxX - minX) * (maxZ - minZ)
    const count = Math.min(
      t.parkMaxPerPolygon,
      Math.floor(area / t.parkAreaPerTree)
    )
    // 包围盒内随机取点，落在多边形内且不压楼、不落水、不压景点模型的才要；
    // 被剔除的点也算一次失败尝试，最多尝试 4 倍次数
    for (
      let placed = 0, tries = 0;
      placed < count && tries < count * 4;
      tries++
    ) {
      const x = minX + rand() * (maxX - minX)
      const z = minZ + rand() * (maxZ - minZ)
      if (pointInPolygon(x, z, poly) && free(x, z)) {
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
        // 河两侧各一棵，落进楼体、水面或景点模型的直接跳过
        for (const side of [1, -1]) {
          const tx = x + nx * t.riverOffset * side
          const tz = z + nz * t.riverOffset * side
          if (free(tx, tz)) points.push([tx, tz])
        }
      }
    }
  }
  return points
}

/**
 * 树的完整布局：落点 + 每棵树的尺寸、朝向、颜色。
 * 单棵树的外观用由「该树位置（取整到分米）与 seed」派生的随机流，
 * 与它在列表里的次序无关（旧实现全城共用一条随机流，前面多一棵树后面全部变样）。
 * 人流校验脚本也直接调用本函数取树冠尺寸，保证与线上一致。
 * @param {object} data 几何数据
 * @param {object} theme
 * @param {{ has: (x: number, z: number) => boolean }} [blocked] 见 scatterTrees
 * @returns {Array<{ x: number, z: number, size: number, height: number,
 *   yaw: number, isYellow: boolean, greenIndex: number }>}
 *   size 为树冠水平半径（米），height 为树干高（米），yaw 为绕竖轴转角（弧度），
 *   isYellow 为黄树，否则 greenIndex 为 theme.tree.greens 的下标；外形尺寸由 treeShape 换算
 */
export function layoutTrees(data, theme, blocked = null) {
  const t = theme.tree
  return scatterTrees(data, theme, blocked).map(([x, z]) => {
    const rand = mulberry32(
      hashInts(t.seed ^ SALT_TREE, Math.round(x * 10), Math.round(z * 10))
    )
    // 取数顺序固定：尺寸、树干高、朝向、是否黄树、绿色下标
    const size = t.crownMin + rand() * t.crownVar
    const height = t.trunkMin + rand() * t.trunkVar
    const yaw = rand() * Math.PI * 2
    const isYellow = rand() < t.yellowRatio
    const greenIndex = Math.floor(rand() * t.greens.length)
    return { x, z, size, height, yaw, isYellow, greenIndex }
  })
}

/**
 * @param {object} data 几何数据
 * @param {object} materials createMaterials 的结果（foliage / trunk）
 * @param {object} theme
 * @param {{ has: (x: number, z: number) => boolean }} [blocked] 景点占用网格，见 scatterTrees
 * @returns {{ group: Group, count: number, layout: Array, dispose: Function }}
 *   layout 为 layoutTrees 的结果（每棵树的位置与尺寸），供整城阴影按真实树冠求范围
 */
export function createTrees(data, materials, theme, blocked = null) {
  const t = theme.tree
  const trees = layoutTrees(data, theme, blocked)

  const crownGeo = new IcosahedronGeometry(1, 1)
  const trunkGeo = new CylinderGeometry(0.9, 1.2, 1, 6)
  const crown = new InstancedMesh(crownGeo, materials.foliage, trees.length)
  const trunk = new InstancedMesh(trunkGeo, materials.trunk, trees.length)

  const greens = t.greens.map((c) => new Color(c))
  const yellow = new Color(t.yellow)
  const m = new Matrix4()
  const q = new Quaternion()
  const identity = new Quaternion() // 树干是六棱柱，不旋转
  const s = new Vector3()
  const p = new Vector3()

  trees.forEach(({ x, z, size, height, yaw, isYellow, greenIndex }, i) => {
    // 每棵树绕竖轴随机转一个角度，避免平面着色的棱面整齐重复
    q.setFromAxisAngle(Y_AXIS, yaw)
    // 树冠按 treeShape 摆放：冠底 = height − 0.2·size，离地 2.6～6.6 m，树干能露出来
    const c = treeShape(size, height)
    m.compose(
      p.set(x, c.centerY, z),
      q,
      s.set(c.radius, c.halfHeight, c.radius)
    )
    crown.setMatrixAt(i, m)
    crown.setColorAt(i, isYellow ? yellow : greens[greenIndex])
    m.compose(p.set(x, height / 2, z), identity, s.set(1, height, 1))
    trunk.setMatrixAt(i, m)
  })
  crown.castShadow = true
  // 树干大多藏在树冠的阴影里，不投影可让阴影通道少处理约 13 万个三角形
  trunk.castShadow = false

  const group = new Group()
  group.add(crown, trunk)
  return {
    group,
    count: trees.length,
    layout: trees,
    dispose() {
      crownGeo.dispose()
      trunkGeo.dispose()
      // 释放 instanceMatrix / instanceColor 对应的 GPU 缓冲
      crown.dispose()
      trunk.dispose()
    }
  }
}

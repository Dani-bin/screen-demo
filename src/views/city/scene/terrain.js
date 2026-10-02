/*
 * 地面、绿地面、水系面
 * ----------------------------------------------------------
 * 多边形用 ShapeGeometry 三角化后平铺在略高于地面的高度上，
 * 同类合并成一个 Mesh。数据坐标 [x, z] 对应 Shape 的 (x, -z)：
 * Shape 在 XY 平面，绕 X 轴转 -90° 后 y 轴映射到 -z。
 *
 * 景点挖洞：景点可返回 groundHoles（世界坐标多边形，见 landmarks/index.js 的契约），
 * 例如天府广场东鱼眼的下沉广场，坑底比城市地面还低。景点建完后调用方把全部洞交给
 * createTerrain 返回对象的 setGroundHoles：地面平面换成带洞的 Shape，
 * 压在洞上的绿地、水面多边形也一并处理（规则见 planCuts），否则它们会像盖子一样挡住坑。
 * 没有洞时什么都不动，几何与加入挖洞前逐位一致。
 */
import {
  BufferGeometry,
  Group,
  Mesh,
  Path,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  Vector2
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { pointInPolygon, polygonBounds } from "./utils.js"

// 地面平面边长（米，以原点为中心）：远大于城市数据范围（约 6.2 × 7.5 km，见 meta.clip），
// 数据扩范围时无需跟着改。
// 由 30 km 加大到 120 km：人工缩放拉到最远（theme.camera.radiusMax 16 km）时，
// 30 km 的平面边缘会在画面上部（顶栏下方）露出一道接缝；
// 最远、俯仰 20° 时远裁剪面（CityScene._updateClip，约 58 km）以内能看到的地面离原点不到 57 km，
// 边长 120 km（±60 km）可整片铺满。平面只有 2 个三角形，加大没有额外开销
const GROUND_SIZE = 120000

/**
 * 地面平面高度（米）。略低于 0，给绿地 0.2、水面 0.3、道路 0.5+ 留出错层；
 * 景点里直接露出地面的步行区（天府广场轴线、IFS 前场、太古里街巷等）
 * 的落脚高度都引用这个常量，改动时人流路径会随之同步。
 */
export const GROUND_Y = -0.5

/**
 * 城市水面层高度（米）：OSM 水面多边形平铺在这个高度。景点在城市水面上布置构件
 * （驳岸、浮在水面的天鹅等）时引用这个常量，与水面层保持同高。
 */
export const WATER_Y = 0.3

// 绿地层高度（米）：错开地面与水面，避免共面闪烁
const PARK_Y = 0.2

/** 把 [[x, z], ...] 转成 Shape */
export function polygonToShape(points) {
  return new Shape(points.map(([x, z]) => new Vector2(x, -z)))
}

/** 把 [[x, z], ...] 转成 Path，作 Shape 的洞（坐标映射同 polygonToShape） */
function polygonToPath(points) {
  return new Path(points.map(([x, z]) => new Vector2(x, -z)))
}

/**
 * 一组多边形 → 合并后的平面几何体（y 为平铺高度）。
 * 少于 3 个点的多边形跳过；没有有效多边形时返回 null。
 * @param {Array} polygons 世界坐标多边形 [[x, z], ...][]
 * @param {number} y 平铺高度
 * @param {Map<number, Array|null>} [cuts] planCuts 的结果：下标 → 要挖的洞（null 表示整块跳过）；
 *   不在其中的多边形照常三角化，与不传 cuts 时逐位一致
 */
export function buildFlatPolygons(polygons, y, cuts = null) {
  const geos = []
  polygons.forEach((p, i) => {
    if (!p || p.length < 3) return
    const holes = cuts?.get(i)
    if (holes === null) return // 整块跳过（落在洞内或跨过洞的边界，见 planCuts）
    const shape = polygonToShape(p)
    if (holes) shape.holes.push(...holes.map(polygonToPath))
    const g = new ShapeGeometry(shape)
    g.rotateX(-Math.PI / 2)
    g.translate(0, y, 0)
    geos.push(g)
  })
  if (!geos.length) return null
  const merged = mergeGeometries(geos)
  geos.forEach((g) => g.dispose())
  return merged
}

/* ---------------- 景点挖洞 ---------------- */

/** 有向面积的两倍符号：点 c 在有向线段 a→b 的哪一侧（0 为共线） */
function orient(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

/** 已知 c 与线段 a-b 共线时，c 是否落在线段上（含端点） */
function onSegment(a, b, c) {
  return (
    Math.min(a[0], b[0]) <= c[0] &&
    c[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= c[1] &&
    c[1] <= Math.max(a[1], b[1])
  )
}

/** 线段 a-b 与 c-d 是否相交（含端点相接、共线重叠） */
function segmentsMeet(a, b, c, d) {
  const d1 = orient(c, d, a)
  const d2 = orient(c, d, b)
  const d3 = orient(a, b, c)
  const d4 = orient(a, b, d)
  if (d1 * d2 < 0 && d3 * d4 < 0) return true // 严格交叉
  return (
    (d1 === 0 && onSegment(c, d, a)) ||
    (d2 === 0 && onSegment(c, d, b)) ||
    (d3 === 0 && onSegment(a, b, c)) ||
    (d4 === 0 && onSegment(a, b, d))
  )
}

/** 两个包围盒是否重叠（含相接） */
function boundsOverlap(p, q) {
  return (
    p.minX <= q.maxX && q.minX <= p.maxX && p.minZ <= q.maxZ && q.minZ <= p.maxZ
  )
}

/** 两个多边形的边是否有任何相交或相接；只比对落在对方包围盒里的边 */
function edgesMeet(poly, hole, hb) {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]
    const b = poly[i]
    // 边的包围盒碰不到洞的包围盒，就不可能与洞的任何一条边相交
    if (
      Math.max(a[0], b[0]) < hb.minX ||
      Math.min(a[0], b[0]) > hb.maxX ||
      Math.max(a[1], b[1]) < hb.minZ ||
      Math.min(a[1], b[1]) > hb.maxZ
    )
      continue
    for (let k = 0, m = hole.length - 1; k < hole.length; m = k++) {
      if (segmentsMeet(a, b, hole[m], hole[k])) return true
    }
  }
  return false
}

/**
 * 绿地 / 水面多边形与洞的关系，决定怎么处理（结果交给 buildFlatPolygons）：
 * - 洞整个落在多边形内：给多边形加 Shape 洞，精确挖空。
 *   大块的 OSM 面（例如覆盖整个天府广场、坑口落在其中的那块绿地面）靠这一条保住洞外的部分；
 * - 多边形整个落在洞内，或两者边界相交 / 相接：整块跳过。
 *   Shape 的洞必须严格在轮廓内，边界相交时三角化会出错，精确裁剪又要引入多边形布尔运算库，不值得：
 *   洞是景点自己的坑，四周由景点铺装覆盖（铺装高于绿地、水面层），落在坑里或跨过坑沿的
 *   多半是景点范围内的小块草坪、水池，景点会自己重建，整块去掉看不出来；
 *   代价是一大块面若恰好跨过坑沿会整块消失，景点加洞时应实测（返回值列出被跳过的下标）；
 * - 不相交：不处理。
 * 约定洞之间互不重叠（同一多边形里的多个洞重叠时三角化同样会出错）。
 * @param {Array} polygons 绿地或水面多边形 [[x, z], ...][]
 * @param {Array} holes 洞（世界坐标多边形）
 * @returns {Map<number, Array|null>} 碰到洞的多边形下标 → 要挖的洞（null 表示整块跳过）
 */
function planCuts(polygons, holes) {
  const boxes = holes.map(polygonBounds)
  const cuts = new Map()
  polygons.forEach((poly, i) => {
    if (!poly || poly.length < 3) return
    const pb = polygonBounds(poly)
    const inner = []
    for (let h = 0; h < holes.length; h++) {
      const hole = holes[h]
      if (!boundsOverlap(pb, boxes[h])) continue
      // 边界相交或相接：整块跳过
      if (edgesMeet(poly, hole, boxes[h])) {
        cuts.set(i, null)
        return
      }
      // 边界不相交时，任取一个顶点即可判断包含关系
      if (pointInPolygon(hole[0][0], hole[0][1], poly)) inner.push(hole)
      else if (pointInPolygon(poly[0][0], poly[0][1], hole)) {
        cuts.set(i, null) // 整个落在洞内
        return
      }
    }
    if (inner.length) cuts.set(i, inner)
  })
  return cuts
}

/**
 * 城市地面几何：无洞时为原来的 PlaneGeometry；有洞时用带洞的 Shape 三角化同样大小的正方形。
 * 两者都在 XY 平面、法线 +Z（ShapeGeometry 正面朝 +Z），由 Mesh 绕 X 轴转 -90° 后朝上；
 * 洞的 [x, z] 按 polygonToShape 同一映射换成 (x, -z)，转动后正好落回世界坐标 (x, z)。
 * 带洞时三角形是从洞边连到四个远角的细长三角形（共「洞的总点数 + 2 × 洞数 + 2」个，
 * 一个 64 边形的洞为 68 个），与原平面一样跨越整片地面，开销可以忽略
 */
function groundGeometry(holes) {
  if (!holes.length) return new PlaneGeometry(GROUND_SIZE, GROUND_SIZE)
  const h = GROUND_SIZE / 2
  const shape = new Shape([
    new Vector2(-h, -h),
    new Vector2(h, -h),
    new Vector2(h, h),
    new Vector2(-h, h)
  ])
  shape.holes.push(...holes.map(polygonToPath))
  return new ShapeGeometry(shape)
}

/** 换掉 Mesh 的几何体并释放旧的；新几何为 null 时换成空几何（该层不再画任何东西） */
function replaceGeometry(mesh, geometry) {
  const old = mesh.geometry
  mesh.geometry = geometry || new BufferGeometry()
  old.dispose()
}

/**
 * @param {object} data 几何数据（parks / water）
 * @param {object} materials createMaterials() 的结果
 * @returns {Group & { setGroundHoles: (holes: Array) => object }}
 *   地面组；setGroundHoles 见函数内注释
 */
export function createTerrain(data, materials) {
  const group = new Group()

  const ground = new Mesh(
    new PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    materials.ground
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = GROUND_Y
  ground.receiveShadow = true
  group.add(ground)

  // 绿地 0.2、水面 0.3：错开高度避免共面闪烁。
  // 记下每层的多边形与 Mesh，挖洞时按需重建该层
  const layers = [
    { key: "parks", polygons: data.parks || [], y: PARK_Y, mat: "park" },
    { key: "water", polygons: data.water || [], y: WATER_Y, mat: "water" }
  ]
  for (const layer of layers) {
    layer.cut = false // 当前几何是否已按洞处理过
    layer.mesh = null
    const geo = buildFlatPolygons(layer.polygons, layer.y)
    if (!geo) continue
    const m = new Mesh(geo, materials[layer.mat])
    m.receiveShadow = true
    group.add(m)
    layer.mesh = m
  }

  // 地面当前是否带洞
  let holed = false

  /**
   * 设置城市地面的洞（景点建完后调用一次；再次调用以新的一组为准）。
   * 地面换成带洞的几何（Mesh 本身、朝向、高度、receiveShadow 都不变）；
   * 绿地、水面层只在有多边形碰到洞时才重建，处理规则见 planCuts。
   * 没有洞、且之前也没挖过洞时什么都不动：地面仍是原来那个 PlaneGeometry，逐位不变。
   * @param {Array<Array<number[]>>} holes 世界坐标多边形 [[x, z], ...][]，少于 3 个点的忽略
   * @returns {{ parks: { cut: number[], skipped: number[] }, water: { cut: number[], skipped: number[] } }}
   *   各层挖了洞 / 整块跳过的多边形下标，供景点实测洞口范围内有哪些 OSM 面
   */
  group.setGroundHoles = (holes) => {
    const list = (holes || []).filter((h) => Array.isArray(h) && h.length >= 3)
    const report = {}
    for (const layer of layers) report[layer.key] = { cut: [], skipped: [] }
    if (!list.length && !holed) return report
    holed = list.length > 0
    replaceGeometry(ground, groundGeometry(list))
    for (const layer of layers) {
      if (!layer.mesh) continue // 该层本来就没有多边形
      const cuts = planCuts(layer.polygons, list)
      for (const [i, inner] of cuts) {
        report[layer.key][inner ? "cut" : "skipped"].push(i)
      }
      // 没有多边形碰到洞、且之前也没处理过：几何不动
      if (!cuts.size && !layer.cut) continue
      layer.cut = cuts.size > 0
      replaceGeometry(
        layer.mesh,
        buildFlatPolygons(layer.polygons, layer.y, cuts)
      )
    }
    return report
  }
  return group
}

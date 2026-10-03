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
 * 洞先查自交（utils.js 的 selfIntersects），带洞的三角化再做面积自检（triangulateChecked），
 * 坏洞不会悄悄弄坏全城地面。
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
import {
  pointInPolygon,
  polygonBounds,
  segmentsCross,
  selfIntersects
} from "./utils.js"

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
 *   不在其中的多边形照常三角化，与不传 cuts 时逐位一致。
 *   挖洞后面积自检不过的多边形整块跳过并告警，同时在 cuts 里改记为 null，调用方据此出报告
 * @param {string} [name] 图层名，只用于告警文字
 */
export function buildFlatPolygons(polygons, y, cuts = null, name = "平面层") {
  const geos = []
  polygons.forEach((p, i) => {
    if (!p || p.length < 3) return
    const holes = cuts?.get(i)
    if (holes === null) return // 整块跳过（落在洞内或贴着、跨过洞的边界，见 planCuts）
    const shape = polygonToShape(p)
    let g
    if (holes) {
      shape.holes.push(...holes.map(polygonToPath))
      const r = triangulateChecked(shape, ringArea(p), holes)
      if (!r.geometry) {
        // 面积对不上（多边形本身自交、几个洞互相重叠等）：宁可整块不画，也不画出错的几何
        console.warn(
          `${name}第 ${i} 块多边形挖洞后三角化面积偏差 ${formatArea(r.deviation)} m²，已整块跳过`
        )
        cuts.set(i, null)
        return
      }
      g = r.geometry
    } else g = new ShapeGeometry(shape)
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

// 「相接」的距离容差（米）：洞与多边形的边相距不到 1 cm 即视为相接（整块跳过，见 planCuts）。
// OSM 坐标保留到 0.1 m，景点的洞多是浮点算出的圆；数学上贴在边上的点，浮点上总会偏开一点点，
// 只认「恰好共线」会漏判：洞在内侧贴边时判成不相交，绿地照样盖住坑；在外侧贴边时误挖洞，几何溢出
const TOUCH_EPS = 0.01
// 三角化面积自检的容差（平方米）：至少 1 m²；洞很大时放宽到挖掉面积的 1e-6。
// 正常情况下偏差只有浮点求和误差（远小于 1 m²，见 ringArea），出错时偏差是整块洞的量级
const AREA_TOL = 1
const AREA_REL_TOL = 1e-6

/** 点 p 到线段 a-b 的距离 */
function pointSegmentDistance(p, a, b) {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const l2 = dx * dx + dz * dz
  const t = l2
    ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2))
    : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz)
}

/** 线段 a-b 与 c-d 的最近距离：严格交叉时为 0，否则必在某个端点到另一条线段之间取得 */
function segmentGap(a, b, c, d) {
  if (segmentsCross(a, b, c, d)) return 0
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b)
  )
}

/** 两个包围盒是否重叠（含相接，并各向外放宽 pad） */
function boundsOverlap(p, q, pad = 0) {
  return (
    p.minX - pad <= q.maxX &&
    q.minX - pad <= p.maxX &&
    p.minZ - pad <= q.maxZ &&
    q.minZ - pad <= p.maxZ
  )
}

/**
 * 两个多边形的边是否相交或相接（相距不到 TOUCH_EPS）；
 * 只比对包围盒（放宽 TOUCH_EPS）碰得到洞的那些边
 */
function edgesNear(poly, hole, hb) {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]
    const b = poly[i]
    if (
      Math.max(a[0], b[0]) < hb.minX - TOUCH_EPS ||
      Math.min(a[0], b[0]) > hb.maxX + TOUCH_EPS ||
      Math.max(a[1], b[1]) < hb.minZ - TOUCH_EPS ||
      Math.min(a[1], b[1]) > hb.maxZ + TOUCH_EPS
    )
      continue
    for (let k = 0, m = hole.length - 1; k < hole.length; m = k++) {
      if (segmentGap(a, b, hole[m], hole[k]) < TOUCH_EPS) return true
    }
  }
  return false
}

/**
 * 绿地 / 水面多边形与洞的关系，决定怎么处理（结果交给 buildFlatPolygons）：
 * - 洞的全部顶点都在多边形内、且两者的边相距都不小于 1 cm（TOUCH_EPS）：给多边形加 Shape 洞，精确挖空。
 *   大块的 OSM 面（例如覆盖整个天府广场、坑口落在其中的那块绿地面）靠这一条保住洞外的部分；
 * - 其余碰到洞的情况一律整块跳过：边相交或相距不到 1 cm；洞的顶点部分在内、部分在外；
 *   多边形有顶点落在洞内（含整个落在洞内）。
 *   Shape 的洞必须严格在轮廓内，贴边、跨边时三角化会出错，精确裁剪又要引入多边形布尔运算库，不值得：
 *   洞是景点自己的坑，四周由景点铺装覆盖（铺装高于绿地、水面层），落在坑里或贴着、跨过坑沿的
 *   多半是景点范围内的小块草坪、水池，景点会自己重建，整块去掉看不出来；
 *   代价是一大块面若恰好跨过坑沿会整块消失，景点加洞时应实测（返回值列出被跳过的下标）；
 * - 不相交：不处理。
 * 包含关系逐个顶点判断而不是只取一个点：边相距 ≥ 1 cm 时理论上全在内或全在外，
 * 逐点检查是为了浮点误判时宁可跳过，也不挖出溢出轮廓的洞。
 * 约定洞之间互不重叠；万一重叠，buildFlatPolygons 的面积自检会把该多边形整块跳过。
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
      if (!boundsOverlap(pb, boxes[h], TOUCH_EPS)) continue
      // 洞的顶点有几个落在多边形内
      let inside = 0
      for (const [x, z] of hole) if (pointInPolygon(x, z, poly)) inside++
      const skip =
        // 边相交或相接
        edgesNear(poly, hole, boxes[h]) ||
        // 洞部分在内、部分在外
        (inside > 0 && inside < hole.length) ||
        // 洞不在多边形内，但多边形有顶点落在洞内（整个落在洞内）
        (inside === 0 && poly.some(([x, z]) => pointInPolygon(x, z, hole)))
      if (skip) {
        cuts.set(i, null)
        return
      }
      if (inside === hole.length) inner.push(hole)
    }
    if (inner.length) cuts.set(i, inner)
  })
  return cuts
}

/**
 * 多边形面积（绝对值）。坐标先按 Math.fround 取到 Float32 精度：几何体的顶点就是这么存的，
 * 面积自检拿 Float32 顶点算出的三角形面积和与它比，这样取整误差不会被当成偏差
 * （离原点数公里时单个顶点的取整误差约 1e-4 m，周长一长就可能累积到 1 m² 量级）
 */
function ringArea(points) {
  let s = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    s +=
      Math.fround(points[j][0]) * Math.fround(points[i][1]) -
      Math.fround(points[i][0]) * Math.fround(points[j][1])
  }
  return Math.abs(s) / 2
}

/** 几何体全部三角形在 XY 平面上的面积和（Shape 三角化后、转到水平之前调用） */
function geometryArea(geometry) {
  const pos = geometry.attributes.position.array
  const idx = geometry.index?.array
  const n = idx ? idx.length : pos.length / 3
  let s = 0
  for (let t = 0; t + 2 < n; t += 3) {
    const a = (idx ? idx[t] : t) * 3
    const b = (idx ? idx[t + 1] : t + 1) * 3
    const c = (idx ? idx[t + 2] : t + 2) * 3
    s += Math.abs(
      (pos[b] - pos[a]) * (pos[c + 1] - pos[a + 1]) -
        (pos[b + 1] - pos[a + 1]) * (pos[c] - pos[a])
    )
  }
  return s / 2
}

/** 面积偏差写进告警：坐标非法时偏差为 NaN */
function formatArea(v) {
  return Number.isFinite(v) ? v.toFixed(1) : "无法计算"
}

/**
 * 带洞 Shape 三角化并做面积自检：三角形面积和应等于「轮廓面积 − 洞面积和」。
 * 洞互相重叠、越出轮廓、坐标非法时，三角化会多出或缺掉一块，面积就对不上
 * （8 字形自交时两瓣面积正负抵消，查不出来，由 selfIntersects 另查）。
 * @param {Shape} shape 已加好洞的 Shape
 * @param {number} outerArea 轮廓面积
 * @param {Array} holes 洞（[[x, z], ...][]，用来算洞面积）
 * @returns {{ geometry: ShapeGeometry|null, deviation: number }} 自检不过时 geometry 为 null（已释放）
 */
function triangulateChecked(shape, outerArea, holes) {
  const removed = holes.reduce((s, h) => s + ringArea(h), 0)
  let geometry
  try {
    geometry = new ShapeGeometry(shape)
  } catch {
    return { geometry: null, deviation: NaN }
  }
  const deviation = Math.abs(geometryArea(geometry) - (outerArea - removed))
  // 写成「不满足 ≤」而不是「>」：坐标含 NaN 时偏差为 NaN，同样判为不过
  if (!(deviation <= Math.max(AREA_TOL, removed * AREA_REL_TOL))) {
    geometry.dispose()
    geometry = null
  }
  return { geometry, deviation }
}

/**
 * 带洞的城市地面：用带洞的 Shape 三角化与原 PlaneGeometry 同样大小的正方形，并做面积自检。
 * 两者都在 XY 平面、法线 +Z（ShapeGeometry 正面朝 +Z），由 Mesh 绕 X 轴转 -90° 后朝上；
 * 洞的 [x, z] 按 polygonToShape 同一映射换成 (x, -z)，转动后正好落回世界坐标 (x, z)。
 * 三角形是从洞边连到四个远角的细长三角形（共「洞的总点数 + 2 × 洞数 + 2」个，
 * 一个 64 边形的洞为 68 个），与原平面一样跨越整片地面，开销可以忽略
 * @returns {{ geometry: ShapeGeometry|null, deviation: number }} 见 triangulateChecked
 */
function holedGround(holes) {
  const h = GROUND_SIZE / 2
  const shape = new Shape([
    new Vector2(-h, -h),
    new Vector2(h, -h),
    new Vector2(h, h),
    new Vector2(-h, h)
  ])
  shape.holes.push(...holes.map(polygonToPath))
  return triangulateChecked(shape, GROUND_SIZE * GROUND_SIZE, holes)
}

/**
 * 换掉 Mesh 的几何体并释放旧的。
 * 新几何为 null（整层多边形都被跳过）时换成空几何并隐藏该 Mesh：旧几何照样释放，渲染时直接略过
 */
function replaceGeometry(mesh, geometry) {
  const old = mesh.geometry
  mesh.geometry = geometry || new BufferGeometry()
  mesh.visible = Boolean(geometry)
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
    {
      key: "parks",
      name: "绿地层",
      polygons: data.parks || [],
      y: PARK_Y,
      mat: "park"
    },
    {
      key: "water",
      name: "水面层",
      polygons: data.water || [],
      y: WATER_Y,
      mat: "water"
    }
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
   * 有洞自交，或地面面积自检不过（洞重叠、越出 ±GROUND_SIZE/2 或坐标非法）时 console.error，
   * 整组洞作废：地面退回整块 PlaneGeometry，绿地、水面也不挖，保证全城地面完好。
   * @param {Array<Array<number[]>>} holes 世界坐标多边形 [[x, z], ...][]，少于 3 个点的忽略
   * @returns {{ parks: { cut: number[], skipped: number[] }, water: { cut: number[], skipped: number[] } }}
   *   各层挖了洞 / 整块跳过的多边形下标，供景点实测洞口范围内有哪些 OSM 面
   */
  group.setGroundHoles = (holes) => {
    let list = (holes || []).filter((h) => Array.isArray(h) && h.length >= 3)
    const report = {}
    for (const layer of layers) report[layer.key] = { cut: [], skipped: [] }
    let holedGeo = null
    if (list.length) {
      // 先查自交（utils.js 的 selfIntersects），再三角化并做面积自检。自交的洞面积自检查不出来：
      // 8 字形两瓣的有向面积正负抵消，三角化面积照样对得上，实际却一瓣没挖、一瓣重叠成两层。
      // 洞只有几十个点，逐对比较的开销可以忽略
      const crossed = list.findIndex(selfIntersects)
      let reason = ""
      if (crossed >= 0) reason = `第 ${crossed + 1} 个洞自交`
      else {
        const r = holedGround(list)
        holedGeo = r.geometry
        if (!holedGeo) {
          reason =
            `三角化面积偏差 ${formatArea(r.deviation)} m²` +
            "（洞可能互相重叠、越出地面范围或坐标非法）"
        }
      }
      if (reason) {
        console.error(
          `城市地面挖洞失败：${list.length} 个洞中${reason}，已退回整块地面、不挖洞`
        )
        list = []
      }
    }
    if (!list.length && !holed) return report
    holed = list.length > 0
    replaceGeometry(
      ground,
      holedGeo || new PlaneGeometry(GROUND_SIZE, GROUND_SIZE)
    )
    for (const layer of layers) {
      if (!layer.mesh) continue // 该层本来就没有多边形
      const cuts = planCuts(layer.polygons, list)
      // 没有多边形碰到洞、且之前也没处理过：几何不动
      if (!cuts.size && !layer.cut) continue
      layer.cut = cuts.size > 0
      replaceGeometry(
        layer.mesh,
        buildFlatPolygons(layer.polygons, layer.y, cuts, layer.name)
      )
      // 重建之后再出报告：面积自检不过的多边形已在 cuts 里改记为整块跳过
      for (const [i, inner] of cuts) {
        report[layer.key][inner ? "cut" : "skipped"].push(i)
      }
    }
    return report
  }
  return group
}

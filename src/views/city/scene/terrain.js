/*
 * 地面、绿地面、水系面
 * ----------------------------------------------------------
 * 多边形用 ShapeGeometry 三角化后平铺在略高于地面的高度上，
 * 同类合并成一个 Mesh。数据坐标 [x, z] 对应 Shape 的 (x, -z)：
 * Shape 在 XY 平面，绕 X 轴转 -90° 后 y 轴映射到 -z。
 */
import {
  Group,
  Mesh,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  Vector2
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"

const GROUND_SIZE = 30000

/**
 * 地面平面高度（米）。略低于 0，给绿地 0.2、水面 0.3、道路 0.5+ 留出错层；
 * 景点里直接露出地面的步行区（天府广场轴线、IFS 前场、太古里街巷等）
 * 的落脚高度都引用这个常量，改动时人流路径会随之同步。
 */
export const GROUND_Y = -0.5

/** 把 [[x, z], ...] 转成 Shape */
export function polygonToShape(points) {
  return new Shape(points.map(([x, z]) => new Vector2(x, -z)))
}

/**
 * 一组多边形 → 合并后的平面几何体（y 为平铺高度）。
 * 少于 3 个点的多边形跳过；没有有效多边形时返回 null。
 */
export function buildFlatPolygons(polygons, y) {
  const geos = []
  for (const p of polygons) {
    if (!p || p.length < 3) continue
    const g = new ShapeGeometry(polygonToShape(p))
    g.rotateX(-Math.PI / 2)
    g.translate(0, y, 0)
    geos.push(g)
  }
  if (!geos.length) return null
  const merged = mergeGeometries(geos)
  geos.forEach((g) => g.dispose())
  return merged
}

/**
 * @param {object} data 几何数据（parks / water）
 * @param {object} materials createMaterials() 的结果
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

  // 绿地 0.2、水面 0.3：错开高度避免共面闪烁
  const parks = buildFlatPolygons(data.parks, 0.2)
  if (parks) {
    const m = new Mesh(parks, materials.park)
    m.receiveShadow = true
    group.add(m)
  }
  const water = buildFlatPolygons(data.water, 0.3)
  if (water) {
    const m = new Mesh(water, materials.water)
    m.receiveShadow = true
    group.add(m)
  }
  return group
}

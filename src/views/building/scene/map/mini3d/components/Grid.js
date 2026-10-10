import {
  Mesh,
  DoubleSide,
  Vector2,
  Vector3,
  Shape,
  ShapeGeometry,
  MeshBasicMaterial,
  GridHelper,
  Group,
  BufferGeometry,
  BufferAttribute,
  PointsMaterial,
  Points,
  NormalBlending
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"

/**
 * 网格底座：GridHelper + 交点处的小十字 + 点阵
 */
export class Grid {
  constructor({ scene, time }, options) {
    this.scene = scene
    this.time = time
    this.instance = null
    const defaultOptions = {
      position: new Vector3(0, 0, 0),
      gridSize: 100,
      gridDivision: 20,
      gridColor: 0x28373a,
      shapeSize: 1,
      shapeColor: 0x8e9b9e,
      pointSize: 0.2,
      pointColor: 0x28373a,
      pointLayout: {
        row: 200,
        col: 200
      },
      pointBlending: NormalBlending
    }
    this.options = Object.assign({}, defaultOptions, options)
    this.init()
  }
  init() {
    const group = new Group()
    group.name = "Grid"
    const grid = this.createGridHelp()
    const shapes = this.createShapes()
    const points = this.createPoint()
    group.add(grid, shapes, points)
    group.position.copy(this.options.position)
    this.instance = group
    this.scene.add(group)
  }
  createShapes() {
    const { gridSize, gridDivision, shapeSize, shapeColor } = this.options
    const shapeSpace = gridSize / gridDivision
    const range = gridSize / 2
    const shapeMaterial = new MeshBasicMaterial({
      color: shapeColor,
      side: DoubleSide
    })
    const shapeGeometrys = []
    for (let i = 0; i < gridDivision + 1; i++) {
      for (let j = 0; j < gridDivision + 1; j++) {
        const shapeGeometry = this.createPlus(shapeSize)
        shapeGeometry.translate(
          -range + i * shapeSpace,
          -range + j * shapeSpace,
          0
        )
        shapeGeometrys.push(shapeGeometry)
      }
    }
    const geometry = mergeGeometries(shapeGeometrys)
    const shapeMesh = new Mesh(geometry, shapeMaterial)
    shapeMesh.renderOrder = -1
    shapeMesh.rotateX(-Math.PI / 2)
    shapeMesh.position.y += 0.01
    return shapeMesh
  }
  createGridHelp() {
    const { gridSize, gridDivision, gridColor } = this.options
    return new GridHelper(gridSize, gridDivision, gridColor, gridColor)
  }
  createPoint() {
    const { gridSize, pointSize, pointColor, pointBlending, pointLayout } =
      this.options
    const rows = pointLayout.row
    const cols = pointLayout.col
    const positions = new Float32Array(rows * cols * 3)
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const x = (i / (rows - 1)) * gridSize - gridSize / 2
        const y = 0
        const z = (j / (cols - 1)) * gridSize - gridSize / 2
        const index = (i * cols + j) * 3
        positions[index] = x
        positions[index + 1] = y
        positions[index + 2] = z
      }
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new BufferAttribute(positions, 3))
    const material = new PointsMaterial({
      size: pointSize,
      sizeAttenuation: true,
      color: pointColor,
      blending: pointBlending
    })
    return new Points(geometry, material)
  }
  createPlus(shapeSize = 50) {
    const w = shapeSize / 6 / 3
    const h = shapeSize / 3
    const points = [
      new Vector2(-h, -w),
      new Vector2(-w, -w),
      new Vector2(-w, -h),
      new Vector2(w, -h),
      new Vector2(w, -h),
      new Vector2(w, -w),
      new Vector2(h, -w),
      new Vector2(h, w),
      new Vector2(w, w),
      new Vector2(w, h),
      new Vector2(-w, h),
      new Vector2(-w, w),
      new Vector2(-h, w)
    ]
    const shape = new Shape(points)
    return new ShapeGeometry(shape, 24)
  }
}

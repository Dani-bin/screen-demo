/*
 * 顶点色合批器与 frame 变换工具
 * ----------------------------------------------------------
 * 一个景点由成百上千个小构件组成（柱、墙、屋面、栏杆……），
 * 每个构件单独做 Mesh 会产生大量 draw call。这里把构件的颜色写进顶点色，
 * 全部合并成一个几何体，一个景点只占一次 draw call。
 *
 * 坐标约定：世界 X 向东、Z 向南、Y 向上，单位米。
 * 方位角 bearing 为相对正北的顺时针角度；frame 的局部 -Z 指向 bearing 方向，
 * 局部 +Z 是「正面」。换算：yaw = -bearing × π/180。
 */
import {
  BufferAttribute,
  Color,
  DoubleSide,
  Euler,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"

const DEG = Math.PI / 180

// 合批只保留这三个属性：mergeGeometries 要求所有部件属性一致
const KEEP = new Set(["position", "normal", "color"])

export class ColorBuilder {
  constructor() {
    this.parts = []
    this._triangles = 0
  }

  /**
   * 加入一个构件。geometry 的所有权移交给合批器：内部复制一份再释放原件，
   * 因此同一个模板几何体可以用不同 matrix 反复 add（原件不会被改动）。
   * @param {BufferGeometry} geometry 构件几何体（局部坐标）
   * @param {string|number|Color} color 构件颜色（sRGB，与 Color.set 相同，内部转线性值）
   * @param {Matrix4} [matrix] 局部 → 世界变换，法线随之变换
   * @returns {ColorBuilder} this，便于链式调用
   */
  add(geometry, color, matrix) {
    // 非索引化：每个三角形独立顶点，合并后三角形 k 即顶点 3k..3k+2
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone()
    geometry.dispose()
    // 缺法线时按面计算（非索引几何体即为平面法线）；自带平滑法线的保持不变
    if (!g.attributes.normal) g.computeVertexNormals()
    for (const name of Object.keys(g.attributes)) {
      if (!KEEP.has(name)) g.deleteAttribute(name)
    }
    g.clearGroups()
    g.morphAttributes = {}
    if (matrix) g.applyMatrix4(matrix)

    const c = color instanceof Color ? color : new Color(color)
    const count = g.attributes.position.count
    const col = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      col[i * 3] = c.r
      col[i * 3 + 1] = c.g
      col[i * 3 + 2] = c.b
    }
    g.setAttribute("color", new BufferAttribute(col, 3))

    this.parts.push(g)
    this._triangles += count / 3
    return this
  }

  /** 已加入的三角形总数 */
  get triangles() {
    return this._triangles
  }

  /**
   * 合并全部构件为一个几何体（只含 position / normal / color），并释放各构件。
   * 调用后合批器清空，可继续复用。
   * @returns {BufferGeometry|null} 没有任何构件时返回 null
   */
  bake() {
    if (!this.parts.length) return null
    const merged = mergeGeometries(this.parts)
    this.parts.forEach((g) => g.dispose())
    this.parts = []
    this._triangles = 0
    merged.computeBoundingBox()
    merged.computeBoundingSphere()
    return merged
  }
}

/**
 * 景点坐标系：先平移到 (cx, y, cz)，再绕 Y 轴旋转 -bearing。
 * 局部 -Z 指向 bearing 方向（bearing 90° 时局部 -Z 指向正东），+Z 为正面。
 * @returns {Matrix4}
 */
export function frame(cx, y, cz, bearingDeg = 0) {
  const m = new Matrix4().makeRotationY(-bearingDeg * DEG)
  m.setPosition(cx, y, cz)
  return m
}

// local() 复用的临时对象
const _pos = new Vector3()
const _quat = new Quaternion()
const _scale = new Vector3()
const _euler = new Euler()

/**
 * 在父坐标系里摆放构件：parent × 平移(x, y, z) × 绕 Y 旋转(yawRad) × 缩放。
 * yawRad 为弧度，逆时针（从上往下看）为正，与 three.js 的 rotation.y 相同。
 * @returns {Matrix4} 新矩阵（parent 不变）
 */
export function local(parent, x, y, z, yawRad = 0, sx = 1, sy = 1, sz = 1) {
  const m = new Matrix4().compose(
    _pos.set(x, y, z),
    _quat.setFromEuler(_euler.set(0, yawRad, 0)),
    _scale.set(sx, sy, sz)
  )
  return parent ? m.premultiply(parent) : m
}

/**
 * 景点通用材质：顶点色、双面（屋面是单层曲面，从檐下仰视也要可见）。
 * 双面材质下 three.js 会按正反面翻转法线，檐下背光面照样有明暗。
 */
export function landmarkMaterial() {
  return new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.75,
    metalness: 0.05,
    side: DoubleSide
  })
}

/** 低多边形平面着色材质（熊猫专用：棱面分明的折纸感） */
export function flatMaterial() {
  return new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.75,
    metalness: 0.05,
    side: DoubleSide,
    flatShading: true
  })
}

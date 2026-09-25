/*
 * 几何工具
 * ----------------------------------------------------------
 * 场地、跑道、屋顶等都要反复构造同类几何体，集中在这里，
 * 避免各建模模块各写一份。
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  LineLoop,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  Vector3
} from "three"

/**
 * 四坡屋顶（庑殿顶）几何：4 个檐角 + 2 个脊点共 8 个顶点，脊线沿长边。
 * 采用非索引顶点 + computeVertexNormals，得到每个坡面独立的平法线。
 * 材质需设 DoubleSide —— 着色器会按正反面自动翻转法线，
 * 这样无需纠结三角形绕序，坡面在任何角度受光都正确。
 */
export function hipRoofGeometry(w, d, h) {
  const hw = w / 2
  const hd = d / 2
  const alongX = w >= d
  const inset = alongX ? hd : hw
  const ridgeA = alongX ? [-hw + inset, h, 0] : [0, h, -hd + inset]
  const ridgeB = alongX ? [hw - inset, h, 0] : [0, h, hd - inset]
  const eave = [
    [-hw, 0, -hd],
    [hw, 0, -hd],
    [hw, 0, hd],
    [-hw, 0, hd]
  ]
  const tris = [
    [eave[0], eave[1], ridgeB],
    [eave[0], ridgeB, ridgeA],
    [eave[1], eave[2], ridgeB],
    [eave[2], eave[3], ridgeA],
    [eave[2], ridgeA, ridgeB],
    [eave[3], eave[0], ridgeA]
  ]
  const positions = []
  tris.forEach((tri) => {
    tri.forEach((v) => positions.push(v[0], v[1], v[2]))
  })
  const geo = new BufferGeometry()
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  return geo
}

/**
 * 田径场轮廓（跑道形）：两条直道 + 两端半圆。
 * 在 XY 平面构造，配合 groundFromShape 转为水平地面片。
 */
export function stadiumShape(halfW, halfL) {
  const r = halfW
  const straight = Math.max(0.1, halfL - r)
  const seg = 28
  const s = new Shape()
  s.moveTo(r, -straight)
  s.lineTo(r, straight)
  for (let i = 1; i <= seg; i++) {
    const t = (Math.PI * i) / seg
    s.lineTo(r * Math.cos(t), straight + r * Math.sin(t))
  }
  s.lineTo(-r, -straight)
  for (let i = 1; i <= seg; i++) {
    const t = Math.PI + (Math.PI * i) / seg
    s.lineTo(r * Math.cos(t), -straight + r * Math.sin(t))
  }
  return s
}

/**
 * 跑道内场中按 Z 区间裁出的一块区域，左右边界随跑道内圈的弧段自动收窄。
 * 用它来铺草皮与硬地球场，可以严丝合缝贴住跑道内圈，
 * 而不会像矩形那样在两端弧段处戳到跑道上。
 *
 * 注意 groundFromShape 会把形状的 y 映射成世界的 -z，故这里按 (x, -z) 出点。
 */
export function innerFieldShape(halfW, halfL, zMin, zMax, seg = 28) {
  const straight = Math.max(0.1, halfL - halfW)
  const widthAt = (z) => {
    const over = Math.abs(z) - straight
    if (over <= 0) return halfW
    const remain = halfW * halfW - over * over
    return remain > 0 ? Math.sqrt(remain) : 0
  }

  const samples = []
  for (let i = 0; i <= seg; i++) {
    const z = zMin + ((zMax - zMin) * i) / seg
    samples.push({ w: widthAt(z), y: -z })
  }

  const shape = new Shape()
  shape.moveTo(samples[0].w, samples[0].y)
  samples.forEach((p) => shape.lineTo(p.w, p.y))
  for (let i = samples.length - 1; i >= 0; i--) {
    shape.lineTo(-samples[i].w, samples[i].y)
  }
  shape.closePath()
  return shape
}

/** 同样的跑道形轮廓，但直接给出世界坐标点，用于画分道线 */
export function stadiumPoints(halfW, halfL, y) {
  const r = halfW
  const straight = Math.max(0.1, halfL - r)
  const seg = 40
  const pts = [new Vector3(r, y, -straight), new Vector3(r, y, straight)]
  for (let i = 1; i <= seg; i++) {
    const t = (Math.PI * i) / seg
    pts.push(new Vector3(r * Math.cos(t), y, straight + r * Math.sin(t)))
  }
  pts.push(new Vector3(-r, y, -straight))
  for (let i = 1; i <= seg; i++) {
    const t = Math.PI + (Math.PI * i) / seg
    pts.push(new Vector3(r * Math.cos(t), y, -straight + r * Math.sin(t)))
  }
  return pts
}

/**
 * 把 XY 平面的 Shape 转成水平地面片。
 * rotateX(-90°) 同时把形状的 +Z 法线转成 +Y（朝上），受光才正确。
 */
export function groundFromShape(shape, material, y = 0) {
  const geo = new ShapeGeometry(shape, 24)
  geo.rotateX(-Math.PI / 2)
  const mesh = new Mesh(geo, material)
  mesh.position.y = y
  mesh.receiveShadow = true
  return mesh
}

/** 水平矩形地面片 */
export function rectGround(w, d, material, x, y, z) {
  const geo = new PlaneGeometry(w, d)
  geo.rotateX(-Math.PI / 2)
  const mesh = new Mesh(geo, material)
  mesh.position.set(x, y, z)
  mesh.receiveShadow = true
  return mesh
}

/** 闭合折线，用于球场划线 */
export function lineLoop(points, material) {
  return new LineLoop(new BufferGeometry().setFromPoints(points), material)
}

/** 水平圆周点位 */
export function circlePoints(cx, cz, r, y, seg = 48) {
  const pts = []
  for (let i = 0; i < seg; i++) {
    const t = (Math.PI * 2 * i) / seg
    pts.push(new Vector3(cx + r * Math.cos(t), y, cz + r * Math.sin(t)))
  }
  return pts
}

/** 水平矩形四角点位 */
export function rectPoints(cx, cz, w, d, y) {
  const hw = w / 2
  const hd = d / 2
  return [
    new Vector3(cx - hw, y, cz - hd),
    new Vector3(cx + hw, y, cz - hd),
    new Vector3(cx + hw, y, cz + hd),
    new Vector3(cx - hw, y, cz + hd)
  ]
}

/**
 * 把一组变换写进一个 InstancedMesh。
 * 铁艺门扇、围栏竖栅这类构件数量成百上千，逐个建 Mesh 会让 draw call 爆掉，
 * 统一走实例化后每种构件只占一次 draw call。
 *
 * @param {THREE.BufferGeometry} geometry 单个构件的几何体
 * @param {THREE.Material} material 共享材质
 * @param {Array<{position: Vector3, quat: Quaternion, scale: Vector3}>} items
 */
export function buildInstancedMesh(geometry, material, items) {
  const mesh = new InstancedMesh(geometry, material, items.length)
  const matrix = new Matrix4()
  items.forEach((item, i) => {
    matrix.compose(item.position, item.quat, item.scale)
    mesh.setMatrixAt(i, matrix)
    // item.color 可选：instanceColor 会与材质自身颜色相乘，
    // 因此用到它的材质基色要设为白色。树木靠它做到每棵绿色都不一样。
    if (item.color) mesh.setColorAt(i, item.color)
  })
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.castShadow = true
  return mesh
}

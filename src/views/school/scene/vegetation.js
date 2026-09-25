/*
 * 绿化建模
 * ----------------------------------------------------------
 * 百科称校园为「园林化」环境，树木数量不少。
 *
 * 真实感的取舍：照片级树木需要带 alpha 叶片卡的外部模型，与本项目
 * 「零素材依赖」的前提冲突；游戏常用的交叉 billboard 贴图树在俯视
 * 全景机位下会露出交叉平面，也不可用。因此走程序化几何，
 * 靠三件事把观感从「一个球加一根棍」拉上来：
 *
 *  1. 树冠由多个带随机起伏的不规则球体叠成，轮廓不再是完美圆球；
 *  2. 逐棵随机种类、高矮、胖瘦、旋转与倾斜；
 *  3. 逐棵颜色不同（instanceColor），形成深浅交错的绿色层次。
 *
 * 全部走 InstancedMesh：树冠三种变体 + 针叶 + 树干共五次 draw call，
 * 这是大屏长时间常驻运行时帧率的关键。
 *
 * 所有随机量都由下标推导（见 rand），不用 Math.random()，
 * 保证每次刷新布局与配色完全一致，便于和设计稿比对。
 */
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Quaternion,
  Vector3
} from "three"
import { buildInstancedMesh } from "./geometry"
import { BUILDINGS, FIELD, GATE, OCTAGON } from "./layout"

/** 树木与实体之间保留的最小净距（米） */
const CLEARANCE = 1.5

/** 由整数下标推出 0..1 的伪随机数，同一下标每次结果一致 */
function rand(i, salt) {
  const v = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453
  return v - Math.floor(v)
}

/**
 * 带随机起伏的树冠几何体。
 * 在正二十面体上沿法向随机推拉顶点，破掉完美球面；
 * 竖向略压扁，更接近阔叶树的冠形。
 */
function createCanopyGeometry(seed) {
  const geo = new IcosahedronGeometry(1, 1)
  const pos = geo.attributes.position
  const v = new Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const noise = rand(i, seed)
    v.multiplyScalar(0.72 + noise * 0.5)
    pos.setXYZ(i, v.x, v.y * 0.88, v.z)
  }
  geo.computeVertexNormals()
  return geo
}

/** 带起伏的针叶树冠：在圆锥上做同样的顶点扰动 */
function createConiferGeometry() {
  const geo = new ConeGeometry(1, 2.6, 9, 3)
  const pos = geo.attributes.position
  const v = new Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const noise = rand(i, 7)
    const k = 0.85 + noise * 0.3
    pos.setXYZ(i, v.x * k, v.y, v.z * k)
  }
  geo.computeVertexNormals()
  return geo
}

/* ---------------- 位置生成与避让 ---------------- */

/** 是否落在某栋楼的占地范围内 */
function isInsideBuilding(x, z) {
  return BUILDINGS.some(
    (b) =>
      Math.abs(x - b.x) < b.w / 2 + CLEARANCE &&
      Math.abs(z - b.z) < b.d / 2 + CLEARANCE
  )
}

/** 是否落在八边形单体的占地范围内 */
function isInsideOctagon(x, z) {
  return (
    Math.hypot(x - OCTAGON.x, z - OCTAGON.z) < OCTAGON.radius + CLEARANCE + 1
  )
}

/**
 * 是否落在运动场（跑道外轮廓）之内。
 * 跑道两端是半圆，边界宽度随 Z 收窄，不能按矩形判断。
 */
function isOnTrack(x, z) {
  const { x: fx, z: fz, trackOuterHalfW, trackOuterHalfL } = FIELD
  const straight = trackOuterHalfL - trackOuterHalfW
  const over = Math.abs(z - fz) - straight
  const halfWidth =
    over <= 0
      ? trackOuterHalfW
      : Math.sqrt(Math.max(0, trackOuterHalfW * trackOuterHalfW - over * over))
  return halfWidth > 0 && Math.abs(x - fx) < halfWidth + CLEARANCE
}

/** 是否落在入口梯形前广场内（铺装场地，不应长树） */
function isInForecourt(x, z) {
  const { x: gateX, z: gateZ, forecourt } = GATE
  const { depthToStreet, splay } = forecourt
  if (z < gateZ - 1 || z > gateZ + depthToStreet + 1) return false
  const ratio = (z - gateZ) / depthToStreet
  const halfSpan = 15 + splay * ratio
  return Math.abs(x - gateX) < halfSpan + 2
}

/** 生成全部树木位置：中轴对植 + 围栏内侧行道树 + 草坪零散绿化 */
function collectTreeSpots() {
  const spots = []

  // 中轴广场两侧对植（广场东西边界约 x=-14 与 x=8）
  for (let z = -16; z <= 58; z += 7.5) {
    spots.push([-15, z], [7, z])
  }
  // 围栏内侧行道树（落在楼栋退距留出的绿化带上）
  for (let x = -58; x <= 58; x += 8) {
    spots.push([x, -71], [x, 71])
  }
  for (let z = -64; z <= 64; z += 8) {
    spots.push([-60, z], [60, z])
  }
  // 楼群之间与草坪上的零散绿化
  const scattered = [
    [-15, -10],
    [-38, -8],
    [-18, 8],
    [-15, 36],
    [-40, 32],
    [-20, 62],
    [-52, 68],
    [-14, -46],
    [-14, -60],
    [-48, -62]
  ]
  scattered.forEach((p) => spots.push(p))

  /* 行道树按固定间距批量排布，必然会有若干棵落进楼体、跑道或前广场里，
     这里统一剔除。缺口留着即可 —— 本来就不该在这些位置种树。 */
  return spots.filter(
    ([x, z]) =>
      !isInsideBuilding(x, z) &&
      !isInsideOctagon(x, z) &&
      !isOnTrack(x, z) &&
      !isInForecourt(x, z)
  )
}

/* ---------------- 树种定义 ---------------- */

/**
 * 树冠团簇的相对布置：每项为 [横向偏移, 高度, 半径]，均以「树冠基准尺寸」为单位。
 * 主团簇居中偏上，另外几团错落分布，叠出不规则的冠形。
 */
const BROADLEAF_CLUSTERS = [
  [0, 1.0, 1.0],
  [0.62, 0.72, 0.66],
  [-0.58, 0.8, 0.6],
  [0.12, 1.42, 0.58]
]
const SMALL_CLUSTERS = [
  [0, 1.0, 1.0],
  [0.5, 0.74, 0.62]
]

/** 树冠绿色梯度，逐棵从中取一档再做微扰 */
const LEAF_TONES = ["#4E7A42", "#5B8B4C", "#436B39", "#67965A", "#3B5F33"]

export function createVegetation(materials) {
  const group = new Group()
  const spots = collectTreeSpots()

  // 三种树冠变体，轮流分配给不同的树，避免整片校园的树一模一样
  const canopyGeometries = [
    createCanopyGeometry(1),
    createCanopyGeometry(2),
    createCanopyGeometry(3)
  ]
  const canopyBuckets = [[], [], []]
  const coniferItems = []
  const trunkItems = []

  const noRotation = new Quaternion()
  const tone = new Color()

  spots.forEach(([x, z], i) => {
    // 逐棵的高矮胖瘦、种类、色调、朝向
    const size = 0.85 + rand(i, 1) * 0.5
    const slim = 0.88 + rand(i, 2) * 0.3
    const spin = rand(i, 3) * Math.PI * 2
    const variant = Math.floor(rand(i, 4) * 3) % 3
    const kind = rand(i, 5)
    const isConifer = kind < 0.18
    const isSmall = !isConifer && kind > 0.82

    const spinQuat = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      spin
    )

    // 逐棵绿色：取一档色再按亮度微扰，形成深浅交错
    tone.set(LEAF_TONES[Math.floor(rand(i, 6) * LEAF_TONES.length)])
    const shade = 0.86 + rand(i, 7) * 0.28
    const color = tone.clone().multiplyScalar(shade)

    if (isConifer) {
      const trunkHeight = 1.5 * size
      trunkItems.push({
        position: new Vector3(x, trunkHeight / 2, z),
        quat: spinQuat,
        scale: new Vector3(0.7 * size, trunkHeight, 0.7 * size)
      })
      const crownRadius = 1.9 * size * slim
      const crownHeight = 2.6 * size * (1.1 + rand(i, 8) * 0.35)
      coniferItems.push({
        position: new Vector3(x, trunkHeight + crownHeight / 2 - 0.3, z),
        quat: spinQuat,
        scale: new Vector3(crownRadius, crownHeight / 2.6, crownRadius),
        // 必须带 color：leaf 材质基色是白色，不给颜色就会渲染成白树
        color
      })
      return
    }

    const clusters = isSmall ? SMALL_CLUSTERS : BROADLEAF_CLUSTERS
    const base = (isSmall ? 1.5 : 2.2) * size
    const trunkHeight = (isSmall ? 1.7 : 2.9) * size

    trunkItems.push({
      position: new Vector3(x, trunkHeight / 2, z),
      quat: spinQuat,
      scale: new Vector3(size, trunkHeight, size)
    })

    clusters.forEach(([offset, height, radius], c) => {
      // 每团再各自抖一点，同一棵树的几团也不对称
      const jitter = rand(i * 7 + c, 9) - 0.5
      const angle = spin + c * 2.1
      const r = base * radius * (0.92 + rand(i * 7 + c, 10) * 0.2)
      canopyBuckets[(variant + c) % 3].push({
        position: new Vector3(
          x + Math.cos(angle) * base * offset,
          trunkHeight + base * height * 0.55 + jitter * 0.3,
          z + Math.sin(angle) * base * offset
        ),
        quat: spinQuat,
        scale: new Vector3(r * slim, r * (0.9 + jitter * 0.2), r * slim),
        color
      })
    })
  })

  // 树干：细端在上的锥台，比等径圆柱更像树
  const trunkGeometry = new CylinderGeometry(0.16, 0.26, 1, 6)
  group.add(buildInstancedMesh(trunkGeometry, materials.trunk, trunkItems))

  canopyGeometries.forEach((geo, k) => {
    if (canopyBuckets[k].length) {
      group.add(buildInstancedMesh(geo, materials.leaf, canopyBuckets[k]))
    }
  })
  if (coniferItems.length) {
    group.add(
      buildInstancedMesh(createConiferGeometry(), materials.leaf, coniferItems)
    )
  }

  return group
}

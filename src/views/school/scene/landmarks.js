/*
 * 标志性单体建模
 * ----------------------------------------------------------
 * 钟楼、八边形报告厅、南校门三处是校园最具识别度的元素，
 * 单独按实拍照片精建，不走通用楼栋流程。
 */
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Euler,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Path,
  PlaneGeometry,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector3
} from "three"
import { createFence } from "./fence"
import { buildInstancedMesh, groundFromShape } from "./geometry"
import { CLOCK_TOWER, GATE, OCTAGON } from "./layout"

/**
 * 白色八角钟楼：红砖塔身 + 白色八角钟亭 + 尖顶 + 四面钟盘。
 * 立于主教学楼北横楼中轴，正对中轴水池（依据实拍照片）。
 */
export function createClockTower(materials) {
  const group = new Group()
  const { x, z, base, shaftH } = CLOCK_TOWER

  const shaft = new Mesh(new BoxGeometry(base, shaftH, base), materials.brick)
  shaft.position.y = shaftH / 2
  shaft.castShadow = true
  group.add(shaft)

  const shaftTrim = new Mesh(
    new BoxGeometry(base + 1, 0.9, base + 1),
    materials.trim
  )
  shaftTrim.position.y = shaftH + 0.3
  shaftTrim.castShadow = true
  group.add(shaftTrim)

  // 八角钟亭
  const belfry = new Mesh(
    new CylinderGeometry(3.5, 3.9, 6.2, 8),
    materials.trim
  )
  belfry.position.y = shaftH + 3.9
  belfry.castShadow = true
  group.add(belfry)

  // 尖顶与避雷针
  const spire = new Mesh(new ConeGeometry(3.6, 6.4, 8), materials.trim)
  spire.position.y = shaftH + 10.2
  spire.castShadow = true
  group.add(spire)

  const pin = new Mesh(new CylinderGeometry(0.07, 0.07, 3, 6), materials.trim)
  pin.position.y = shaftH + 14.8
  group.add(pin)

  // 四面钟盘：塔身四个方向各一面，带一根指针示意
  const half = base / 2 + 0.15
  const faces = [
    [0, half],
    [half, 0],
    [0, -half],
    [-half, 0]
  ]
  faces.forEach(([fx, fz]) => {
    const dial = new Mesh(
      new CylinderGeometry(1.75, 1.75, 0.22, 24),
      materials.clockFace
    )
    dial.rotation.x = Math.PI / 2
    if (fx !== 0) dial.rotation.z = Math.PI / 2
    dial.position.set(fx, 22.5, fz)
    group.add(dial)

    const hand = new Mesh(new BoxGeometry(0.16, 1.25, 0.1), materials.roof)
    hand.position.set(fx * 1.03, 23.05, fz * 1.03)
    group.add(hand)
  })

  group.position.set(x, 0, z)
  group.userData.stop = 2
  return group
}

/**
 * 八边形单体（罗马议事厅·名称待确认）：
 * 八边形体量 + 八坡攒尖顶，是校园里造型最特殊的一栋。
 */
export function createOctagonHall(materials) {
  const group = new Group()
  const { x, z, radius, floors } = OCTAGON
  // 层高与教学楼取齐，贴图的长宽比才不会被竖向拉长
  const bodyHeight = floors * 3.9

  const base = new Mesh(
    new CylinderGeometry(radius + 0.6, radius + 0.6, 1.1, 8),
    materials.stone
  )
  base.position.y = 0.55
  base.castShadow = true
  base.receiveShadow = true
  group.add(base)

  /* CylinderGeometry 的侧面 UV 是绕整圈走 0..1（不像 BoxGeometry 每个面各自
     0..1），因此必须按整个周长换算开间数。此前误传单条边宽，结果 3 个开间被
     摊到 8 个面共 73 米周长上，窗户被横向拉伸了八倍。 */
  const perimeter = 8 * 2 * radius * Math.sin(Math.PI / 8)
  const floorHeight = bodyHeight / floors

  // 首层同样是连续拱廊（过道），与教学楼一致；以上才开拱窗
  const ground = new Mesh(
    new CylinderGeometry(radius, radius, floorHeight, 8),
    materials.getArcade(perimeter)
  )
  ground.position.y = 1.1 + floorHeight / 2
  ground.castShadow = true
  ground.receiveShadow = true
  group.add(ground)

  const upperFloors = floors - 1
  if (upperFloors > 0) {
    const upperHeight = upperFloors * floorHeight
    const upper = new Mesh(
      new CylinderGeometry(radius, radius, upperHeight, 8),
      materials.getFacade(perimeter, upperFloors)
    )
    upper.position.y = 1.1 + floorHeight + upperHeight / 2
    upper.castShadow = true
    upper.receiveShadow = true
    group.add(upper)
  }

  const cornice = new Mesh(
    new CylinderGeometry(radius + 1, radius + 1, 0.8, 8),
    materials.trim
  )
  cornice.position.y = 1.1 + bodyHeight + 0.4
  cornice.castShadow = true
  group.add(cornice)

  const roof = new Mesh(new ConeGeometry(radius + 1.2, 6.6, 8), materials.roof)
  roof.position.y = 1.1 + bodyHeight + 4.1
  roof.castShadow = true
  group.add(roof)

  const tip = new Mesh(new SphereGeometry(0.75, 12, 10), materials.trim)
  tip.position.y = 1.1 + bodyHeight + 7.8
  group.add(tip)

  group.position.set(x, 0, z)
  group.userData.stop = OCTAGON.stop
  return group
}

/**
 * 门洞轮廓：下部竖直、上部半圆的「门」字形。
 * 既用作墙体上的开口（Path），也用作白色拱圈的外轮廓（Shape）。
 */
function makePortal(cx, width, spring, bottom, Ctor) {
  const half = width / 2
  const path = new Ctor()
  path.moveTo(cx - half, bottom)
  path.lineTo(cx - half, spring)
  for (let i = 1; i <= 20; i++) {
    const t = Math.PI - (Math.PI * i) / 20
    path.lineTo(cx + half * Math.cos(t), spring + half * Math.sin(t))
  }
  path.lineTo(cx + half, bottom)
  path.closePath()
  return path
}

/**
 * 收集一扇铁艺门的竖栅与横档变换。
 * 所有门扇的构件最终合并进两个 InstancedMesh，避免上百个独立 draw call。
 */
function collectIronLeaf(bars, rails, leaf) {
  const { width, height, x, y, z, rotY } = leaf
  const count = Math.max(3, Math.round(width / 0.42))
  const euler = new Euler(0, rotY, 0)
  const quat = new Quaternion().setFromEuler(euler)
  const axis = new Vector3(1, 0, 0).applyQuaternion(quat)

  for (let i = 0; i <= count; i++) {
    const offset = -width / 2 + (width * i) / count
    bars.push({
      position: new Vector3(
        x + axis.x * offset,
        y + height / 2,
        z + axis.z * offset
      ),
      quat,
      scale: new Vector3(1, height, 1)
    })
  }
  ;[0.3, height - 0.3].forEach((railY) => {
    rails.push({
      position: new Vector3(x, y + railY, z),
      quat,
      scale: new Vector3(width, 1, 1)
    })
  })
}

/** 门体总半宽：由各分段推出，供梯形斜边定位 */
function gateHalfWidth() {
  return Math.max(...GATE.blocks.map((b) => b.cx + b.width / 2))
}

/**
 * 入口梯形的两条斜边（局部坐标，原点在门体中心、+Z 朝街道）。
 * 每条给出中点、长度与绕 Y 的转角；转角使体块的局部 +X 沿斜边方向，
 * 同时让局部 +Z 指向广场内侧 —— 校名牌正是靠这一点朝向门前的人。
 */
function forecourtEdges() {
  const { forecourt } = GATE
  const half = gateHalfWidth()
  const { depthToStreet, splay } = forecourt
  const length = Math.hypot(splay, depthToStreet)
  return [1, -1].map((side) => {
    const x0 = side * half
    const x1 = side * (half + splay)
    const dirX = (x1 - x0) / length
    const dirZ = depthToStreet / length
    return {
      side,
      midX: (x0 + x1) / 2,
      midZ: depthToStreet / 2,
      length,
      rotY: Math.atan2(-dirZ, dirX)
    }
  })
}

/**
 * 入口梯形广场：两条斜边矮墙 + 梯形铺装。
 * 大门在上底、街道在下底，斜边把门前空间收成一个内凹的前广场。
 */
function createForecourt(materials) {
  const group = new Group()
  const { forecourt } = GATE
  const half = gateHalfWidth()
  const { depthToStreet, splay } = forecourt

  // 梯形铺装。groundFromShape 会把形状的 y 映射成世界的 -z，
  // 所以这里按 (x, -z) 给点。
  const paving = new Shape()
  paving.moveTo(-half, 0)
  paving.lineTo(half, 0)
  paving.lineTo(half + splay, -depthToStreet)
  paving.lineTo(-(half + splay), -depthToStreet)
  paving.closePath()
  group.add(groundFromShape(paving, materials.forecourt, 0.03))

  // 两条斜边与周界一致，做成铁艺围栏（右侧斜边上的校名牌墙另行叠加）
  group.add(
    createFence(
      materials,
      forecourtEdges().map((edge) => ({
        x: edge.midX,
        z: edge.midZ,
        length: edge.length,
        rotY: edge.rotY
      }))
    )
  )

  return group
}

/**
 * 校名牌（依据校名牌近照还原）：
 * 嵌在入口梯形右侧斜边的红砖墙上，面朝广场内侧；
 * 红砖墙上一圈白色石材外框，框内是深灰绿石材拼板，校名阴刻其上。
 */
function createGateSign(materials) {
  const group = new Group()
  const { sign } = GATE
  const {
    alongEdge,
    wallWidth,
    wallHeight,
    wallDepth,
    frameWidth,
    frameHeight,
    panelWidth,
    panelHeight
  } = sign

  // 红砖墙体：比斜边矮墙更高更厚，把那一段斜边完全包住
  const wall = new Mesh(
    new BoxGeometry(wallWidth, wallHeight, wallDepth),
    materials.brickDeep
  )
  wall.position.y = wallHeight / 2
  wall.castShadow = true
  wall.receiveShadow = true
  group.add(wall)

  const coping = new Mesh(
    new BoxGeometry(wallWidth + 0.4, 0.3, wallDepth + 0.3),
    materials.trim
  )
  coping.position.y = wallHeight + 0.15
  coping.castShadow = true
  group.add(coping)

  const panelY = wallHeight / 2 + 0.1

  const frame = new Mesh(
    new BoxGeometry(frameWidth, frameHeight, 0.18),
    materials.trim
  )
  frame.position.set(0, panelY, wallDepth / 2 + 0.09)
  frame.castShadow = true
  group.add(frame)

  // 深色石板：校名贴图只贴在朝向广场（局部 +Z）的一面
  const stone = materials.stone
  const panel = new Mesh(new BoxGeometry(panelWidth, panelHeight, 0.12), [
    stone,
    stone,
    stone,
    stone,
    materials.sign,
    stone
  ])
  panel.position.set(0, panelY, wallDepth / 2 + 0.2)
  group.add(panel)

  // 定位到右侧斜边上：局部 +X 沿斜边、局部 +Z 朝广场内侧
  const edge = forecourtEdges().find((e) => e.side === 1)
  const t = alongEdge - 0.5
  const dirX = Math.cos(edge.rotY)
  const dirZ = -Math.sin(edge.rotY)
  group.position.set(
    edge.midX + dirX * edge.length * t,
    0,
    edge.midZ + dirZ * edge.length * t
  )
  group.rotation.y = edge.rotY
  return group
}

/**
 * 南校门：依据校门正面实拍照片还原的三段式体量。
 * 中央主门高大、两侧次门较低，各段砖墙上挖出拱券开口，
 * 开口外圈套白色拱圈与壁柱，墙脚为灰色石材勒脚，顶部为白色檐口；
 * 主拱内是对开敞开的铁艺门扇，次拱内为固定铁栅。
 */
export function createGate(materials) {
  const group = new Group()
  const { x, z, depth, baseHeight, trimWidth, blocks } = GATE

  const bars = []
  const rails = []

  blocks.forEach((block) => {
    const { cx, width, height, cornice, arch } = block

    // 砖墙体：矩形挖去拱券开口
    const shape = new Shape()
    shape.moveTo(cx - width / 2, 0)
    shape.lineTo(cx + width / 2, 0)
    shape.lineTo(cx + width / 2, height)
    shape.lineTo(cx - width / 2, height)
    shape.closePath()
    shape.holes.push(makePortal(cx, arch.width, arch.spring, 0, Path))

    const wallGeo = new ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: false
    })
    wallGeo.translate(0, 0, -depth / 2)
    const wall = new Mesh(wallGeo, materials.brickDeep)
    wall.castShadow = true
    wall.receiveShadow = true
    group.add(wall)

    // 石材勒脚：只出现在拱券两侧的实墙墩上，不能横穿门洞
    const pierWidth = (width - arch.width) / 2
    ;[-1, 1].forEach((side) => {
      const pierCx = cx + side * (arch.width / 2 + pierWidth / 2)
      const base = new Mesh(
        new BoxGeometry(pierWidth + 0.14, baseHeight, depth + 0.3),
        materials.stone
      )
      base.position.set(pierCx, baseHeight / 2, 0)
      base.castShadow = true
      base.receiveShadow = true
      group.add(base)
    })

    // 白色拱圈与壁柱：大一圈的门洞轮廓减去门洞本身，立在勒脚之上
    const trimShape = makePortal(
      cx,
      arch.width + trimWidth * 2,
      arch.spring,
      baseHeight,
      Shape
    )
    trimShape.holes.push(
      makePortal(cx, arch.width, arch.spring, baseHeight, Path)
    )
    const trimGeo = new ExtrudeGeometry(trimShape, {
      depth: depth + 0.5,
      bevelEnabled: false
    })
    trimGeo.translate(0, 0, -(depth + 0.5) / 2)
    const trimMesh = new Mesh(trimGeo, materials.trim)
    trimMesh.castShadow = true
    group.add(trimMesh)

    // 白色檐口
    const corniceMesh = new Mesh(
      new BoxGeometry(width + 1.3, cornice, depth + 1.2),
      materials.trim
    )
    corniceMesh.position.set(cx, height + cornice / 2, 0)
    corniceMesh.castShadow = true
    group.add(corniceMesh)

    // 主门檐口之上再叠一道收分的压顶，还原照片里的阶梯状檐部
    if (block.key === "center") {
      const attic = new Mesh(
        new BoxGeometry(width + 0.6, 0.55, depth + 0.7),
        materials.trim
      )
      attic.position.set(cx, height + cornice + 0.275, 0)
      attic.castShadow = true
      group.add(attic)
    }

    if (block.key === "center") {
      // 主拱：对开门扇向校内敞开，贴着门墩，不遮挡透视
      const leafWidth = 3.6
      const leafHeight = 5.5
      const swing = 1.4
      ;[-1, 1].forEach((side) => {
        const hinge = cx + side * (arch.width / 2)
        const rotY = -side * swing
        const quat = new Quaternion().setFromEuler(new Euler(0, rotY, 0))
        const axis = new Vector3(side, 0, 0).applyQuaternion(quat)
        collectIronLeaf(bars, rails, {
          width: leafWidth,
          height: leafHeight,
          x: hinge + (axis.x * leafWidth) / 2,
          y: 0,
          z: (axis.z * leafWidth) / 2,
          rotY
        })
      })
    } else {
      // 次拱：固定铁栅填满竖直段，上方半圆留空作气窗
      collectIronLeaf(bars, rails, {
        width: arch.width - 0.25,
        height: arch.spring - 0.2,
        x: cx,
        y: 0,
        z: 0,
        rotY: 0
      })
    }
  })

  group.add(
    buildInstancedMesh(new BoxGeometry(0.07, 1, 0.07), materials.iron, bars)
  )
  group.add(
    buildInstancedMesh(new BoxGeometry(1, 0.13, 0.1), materials.iron, rails)
  )

  group.add(createForecourt(materials))
  group.add(createGateSign(materials))

  group.position.set(x, 0, z)
  group.userData.stop = GATE.stop
  return group
}

/** 旗杆与校训景观石（依据实拍照片中的刻字景观石） */
export function createCampusProps(materials) {
  const group = new Group()

  const pole = new Mesh(new CylinderGeometry(0.16, 0.2, 14, 8), materials.trim)
  pole.position.set(6, 7, -12)
  pole.castShadow = true
  group.add(pole)

  const flag = new Mesh(new PlaneGeometry(3.6, 2.4), materials.flag)
  flag.position.set(7.9, 12.6, -12)
  group.add(flag)

  const rock = new Mesh(new DodecahedronGeometry(2.1, 0), materials.rock)
  rock.position.set(-17, 1.5, 38)
  rock.scale.set(1, 0.85, 0.7)
  rock.rotation.y = 0.6
  rock.castShadow = true
  group.add(rock)

  return group
}

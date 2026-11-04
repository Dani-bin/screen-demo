/**
 * 设备的程序化模型（真实尺寸，米）。放大倍数在 PitScene 里按 THEME.scale 加。
 * 风格 A：暗钢蓝机体 + 青色棱线，工作部位（铲斗、卸料口）用琥珀自发光；都朝 +z 为前。
 */
import * as THREE from "three"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"

import { THEME } from "./theme.js"

const steel = (c = 0x1f3a52, o = {}) =>
  new THREE.MeshStandardMaterial({
    color: c,
    roughness: 0.55,
    metalness: 0.45,
    ...o
  })
const glow = (c, i = 1.4) =>
  new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: c,
    emissiveIntensity: i
  })

/** 给网格加一圈青色棱线，全息线框感的来源 */
export function edged(mesh, color = THEME.cyan, opacity = 0.55) {
  const line = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, 25),
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false
    })
  )
  mesh.add(line)
  return mesh
}

function box(w, h, d, mat, x = 0, y = 0, z = 0, lines = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y, z)
  return lines ? edged(m) : m
}

// ============================================================ 卡车（实例化）

/** 无人矿卡：取消驾驶室的方头纯电卡车。顶点色编码明暗，实例色上状态色 */
export function truckGeometry() {
  const part = (g, shade, x, y, z) => {
    g.translate(x, y, z)
    const n = g.attributes.position.count
    const c = new Float32Array(n * 3).fill(shade)
    g.setAttribute("color", new THREE.BufferAttribute(c, 3))
    return g
  }
  const wheel = (x, z) => {
    const g = new THREE.CylinderGeometry(1.9, 1.9, 1.3, 10)
    g.rotateZ(Math.PI / 2)
    return part(g, 0.28, x, 1.9, z)
  }
  const parts = [
    part(new THREE.BoxGeometry(4.6, 1.1, 9.4), 0.55, 0, 1.6, 0), // 底盘
    part(new THREE.BoxGeometry(5.0, 2.8, 6.6), 0.95, 0, 3.4, -0.9), // 车斗
    part(new THREE.BoxGeometry(4.2, 1.6, 1.8), 0.78, 0, 2.9, 4.2), // 前部感知舱（无驾驶室）
    part(new THREE.BoxGeometry(3.6, 0.35, 0.5), 1.0, 0, 3.9, 5.1), // 前灯带
    wheel(-2.6, 3.1),
    wheel(2.6, 3.1),
    wheel(-2.6, -3.0),
    wheel(2.6, -3.0)
  ]
  return mergeGeometries(
    parts.map((g) => g.toNonIndexed()),
    false
  )
}

// ============================================================ 采装

/** 电铲 WK-20：履带底盘 + 机房 + 斜臂 + 斗杆 + 铲斗。返回 { group, boom, stick } 供动画摆臂 */
export function makeShovel() {
  const g = new THREE.Group()
  g.add(box(12, 3, 15, steel(0x17293a), 0, 1.5, 0))
  g.add(box(10.5, 6.5, 11, steel(0x24455f), 0, 6.2, -0.5))
  g.add(box(6, 4, 3, steel(0x1b3347), 0, 9.5, -5.5)) // 配重
  g.add(box(3.2, 3, 3.5, glow(THEME.cyan, 0.5), 3.4, 10.2, 3, false)) // 司机室
  const boom = new THREE.Group()
  boom.position.set(0, 8, 4.5)
  boom.rotation.x = -0.78
  boom.add(box(1.8, 1.8, 24, steel(0x2b5578), 0, 0, 12))
  const stick = new THREE.Group()
  stick.position.set(0, 0, 24)
  stick.rotation.x = 0.78
  stick.add(box(1.1, 11, 1.1, steel(0x2b5578), 0, -5.5, 0))
  const bucket = box(5.2, 3.4, 5, glow(THEME.amber, 1.2), 0, -12, 1.5, false)
  stick.add(bucket)
  boom.add(stick)
  g.add(boom)
  return { group: g, boom, stick }
}

/** 轮斗挖掘机：剥离用的全连续设备，大轮盘 + 长臂 + 皮带架 */
export function makeBucketWheel() {
  const g = new THREE.Group()
  g.add(box(16, 4, 20, steel(0x17293a), 0, 2, 0))
  g.add(box(10, 8, 12, steel(0x24455f), 0, 8, 0))
  const arm = box(3, 3, 55, steel(0x2b5578), 0, 14, 30)
  arm.rotation.x = -0.12
  g.add(arm)
  const wheel = new THREE.Mesh(
    new THREE.TorusGeometry(9, 1.3, 8, 24),
    glow(THEME.amber, 0.9)
  )
  wheel.position.set(0, 12, 58)
  wheel.rotation.y = Math.PI / 2
  g.add(wheel)
  const back = box(3, 3, 40, steel(0x2b5578), 0, 14, -26)
  g.add(back)
  return { group: g, wheel }
}

/** 破碎站：框架 + 受料斗 + 出料皮带（半移动破碎站大，自移式小） */
export function makeCrusher() {
  const g = new THREE.Group()
  g.add(box(22, 7, 18, steel(0x1d3b55), 0, 3.5, 0))
  const hopper = new THREE.Mesh(
    new THREE.CylinderGeometry(11, 5, 7, 4, 1, true),
    steel(0x2b5578, { side: THREE.DoubleSide })
  )
  hopper.rotation.y = Math.PI / 4
  hopper.position.set(0, 10.5, 0)
  g.add(edged(hopper))
  g.add(box(3, 3, 30, glow(THEME.amber, 0.8), 0, 6, 22, false))
  g.add(box(2.5, 2.5, 14, steel(0x2b5578), 0, 11, 20))
  return g
}

// ============================================================ 煤流与电厂

/** 封闭煤场：长条拱顶，半透明白青 */
export function makeBarn(length = 525, width = 160) {
  const r = width / 2
  const geo = new THREE.CylinderGeometry(r, r, length, 28, 1, true, 0, Math.PI)
  geo.rotateZ(Math.PI / 2) // 圆柱轴从 y 转到 x
  geo.rotateY(Math.PI / 2) // 再转到沿 z（长轴朝 +z）
  const mat = new THREE.MeshStandardMaterial({
    color: 0x9fb6c0,
    roughness: 0.4,
    metalness: 0.2,
    transparent: true,
    opacity: 1,
    emissive: 0x2a8ea6,
    emissiveIntensity: 0.15,
    side: THREE.DoubleSide
  })
  const m = new THREE.Mesh(geo, mat)
  m.scale.y = 0.62 // 实际高 52.7 m
  const g = new THREE.Group()
  g.add(edged(m, THEME.cyan, 0.45))
  // 拱肋：沿长度每 40 m 一圈半圆，棱线模式下圆柱面太光滑画不出来
  const ribPts = []
  const n = 28
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI
    ribPts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r * 0.62, 0))
  }
  const ribGeo = new THREE.BufferGeometry().setFromPoints(ribPts)
  const ribMat = new THREE.LineBasicMaterial({
    color: THEME.cyan,
    transparent: true,
    opacity: 0.75
  })
  for (let z = -length / 2 + 20; z <= length / 2 - 20; z += 40) {
    const rib = new THREE.Line(ribGeo, ribMat)
    rib.position.z = z
    g.add(rib)
  }
  g.add(box(width * 0.98, 1, length, steel(0x0a1420), 0, 0.5, 0, false))
  return g
}

/** 双曲线冷却塔 */
export function makeCoolingTower() {
  const pts = [
    [52, 0],
    [47, 18],
    [38, 50],
    [31, 82],
    [30, 104],
    [33, 118]
  ].map(([r, y]) => new THREE.Vector2(r, y))
  const geo = new THREE.LatheGeometry(pts, 36)
  const mat = new THREE.MeshStandardMaterial({
    color: 0x3a5668,
    roughness: 0.5,
    emissive: 0x16627a,
    emissiveIntensity: 0.3,
    side: THREE.DoubleSide
  })
  return edged(new THREE.Mesh(geo, mat), THEME.cyan, 0.4)
}

/** 烟囱：红白相间的色带 */
export function makeChimney() {
  const g = new THREE.Group()
  const bands = 6
  for (let i = 0; i < bands; i++) {
    const h = 150 / bands
    const r0 = 7 - (i * 3) / bands
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(r0 - 0.5, r0, h, 14),
      steel(i % 2 ? 0xd9e6ee : 0xe0534b, {
        emissive: i % 2 ? 0x223344 : 0x4a1410,
        emissiveIntensity: 0.5
      })
    )
    m.position.y = h * i + h / 2
    g.add(m)
  }
  return g
}

/** 厂房群：汽机房、锅炉房、办公楼等几个大盒子 */
export function makePlantBlocks() {
  const g = new THREE.Group()
  const mat = steel(0x24455f)
  for (const [w, h, d, x, z] of [
    [150, 28, 60, 0, 0],
    [60, 60, 60, -110, 10],
    [50, 34, 90, 100, 20],
    [70, 16, 44, 20, -80],
    [40, 20, 40, -40, 90]
  ])
    g.add(box(w, h, d, mat, x, h / 2, z))
  return g
}

/** 蒸汽：一小簇上升渐隐的圆点，由 PitScene 每帧更新 */
export function makeSteam(count = 40) {
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(count * 3)
  const seed = new Float32Array(count)
  for (let i = 0; i < count; i++) seed[i] = Math.random()
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
  geo.setAttribute("seed", new THREE.BufferAttribute(seed, 1))
  const cv = document.createElement("canvas")
  cv.width = cv.height = 64
  const c = cv.getContext("2d")
  const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32)
  gr.addColorStop(0, "rgba(255,255,255,0.9)")
  gr.addColorStop(1, "rgba(255,255,255,0)")
  c.fillStyle = gr
  c.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(cv)
  const mat = new THREE.PointsMaterial({
    map: tex,
    size: 170,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    color: 0xcfe6ee
  })
  const pts = new THREE.Points(geo, mat)
  pts.frustumCulled = false
  return pts
}

// ============================================================ 换电 / 能源 / 监测

/** 换电站：低矮厂房 + 四个工位，工位条灯颜色由状态驱动 */
export function makeSwapStation() {
  const g = new THREE.Group()
  // 机体和屋顶带一点自发光，夜里也看得出是一栋建筑
  // 不透明的深色机体 + 青色棱线，窗和工位条是亮的
  const body = (c, e) => steel(c, { emissive: e, emissiveIntensity: 0.6 })
  g.add(box(70, 16, 34, body(0x1b3a54, 0x0b2a40), 0, 8, 0))
  g.add(box(74, 2, 38, body(0x2b5578, 0x123d5c), 0, 16.5, 0))
  const bays = []
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(11, 1.2, 1.6),
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xff7ab8,
        emissiveIntensity: 0.25
      })
    )
    m.position.set(-24 + i * 16, 9, 17.4)
    g.add(m)
    bays.push(m)
  }
  g.userData.bays = bays
  return g
}

/** 边坡雷达塔：锥形桁架 + 抛物面天线 + 信标 */
export function makeRadarTower() {
  const g = new THREE.Group()
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 3.2, 44, 4, 5, true),
    new THREE.MeshBasicMaterial({
      color: THEME.cyan,
      wireframe: true,
      transparent: true,
      opacity: 0.8
    })
  )
  mast.position.y = 22
  g.add(mast)
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    steel(0x9fc6d6, { side: THREE.DoubleSide })
  )
  dish.rotation.x = Math.PI / 2
  dish.position.set(0, 46, 2)
  g.add(dish)
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 8, 8),
    glow(THEME.cyan, 2)
  )
  beacon.position.y = 50
  g.add(beacon)
  g.userData.beacon = beacon
  return g
}

/** 5G 基站：细杆 + 状态灯 */
export function makeMast() {
  const g = new THREE.Group()
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.9, 34, 6),
    steel(0x9fc6d6)
  )
  pole.position.y = 17
  g.add(pole)
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(1.8, 8, 8),
    glow(THEME.ok, 2)
  )
  lamp.position.y = 36
  g.add(lamp)
  g.userData.lamp = lamp
  return g
}

/** 光伏板场：实例化的深蓝平板，沿排土场顶面成行排布，高度跟地面走 */
export function makeSolarField(grid, cx, cy, rows, cols, dx, dy, rot, VS) {
  const geo = new THREE.BoxGeometry(66, 2, 42)
  const mat = new THREE.MeshStandardMaterial({
    color: 0x0f2a52,
    roughness: 0.25,
    metalness: 0.6,
    emissive: 0x2a6fd0,
    emissiveIntensity: 0.9
  })
  const mesh = new THREE.InstancedMesh(geo, mat, rows * cols)
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const euler = new THREE.Euler(-0.35, rot, 0)
  q.setFromEuler(euler)
  let k = 0
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const lx = (col - (cols - 1) / 2) * dx
      const ly = (r - (rows - 1) / 2) * dy
      const x = cx + lx * c - ly * s
      const y = cy + lx * s + ly * c
      m4.compose(
        new THREE.Vector3(x, grid.height(x, y) * VS + 6, -y),
        q,
        new THREE.Vector3(1, 1, 1)
      )
      mesh.setMatrixAt(k++, m4)
    }
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.frustumCulled = false
  return mesh
}

/** 办公生活区：一小片规整的盒子 */
export function makeOfficeBlocks() {
  const g = new THREE.Group()
  const mat = steel(0x24455f)
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 3; j++)
      g.add(box(60, 14 + ((i * 3 + j) % 3) * 5, 28, mat, i * 85, 8, j * 70))
  return g
}

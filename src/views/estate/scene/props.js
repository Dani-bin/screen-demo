/**
 * 沙盘小品：模型树、行道树、路灯、车流
 * ----------------------------------------------------------
 * 树是实体沙盘最有辨识度的东西：分层的多色树团，深绿 / 黄绿 / 少量橙叶，成团摆放，留出开阔草坪。
 * 全部实例化：几千棵树、上百盏灯、上百辆车都只有几个 draw call。
 * 平面坐标 x 向东、y 向北；three.js 里 z = -y。
 */
import * as THREE from "three"
import { ellipseK, isLawn, rng } from "./ground.js"

// ---------------------------------------------------------------- 树

/** 值噪声：让树团成片出现，而不是均匀撒点 */
function makeNoise(seed) {
  const r = rng(seed)
  const N = 64
  const grid = Array.from({ length: N * N }, () => r())
  const at = (i, j) => grid[(((j % N) + N) % N) * N + (((i % N) + N) % N)]
  return (x, y) => {
    const i = Math.floor(x)
    const j = Math.floor(y)
    const fx = x - i
    const fy = y - j
    const sx = fx * fx * (3 - 2 * fx)
    const sy = fy * fy * (3 - 2 * fy)
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx
    return a + (b - a) * sy
  }
}

const TREE_COLORS = [
  [0x3b6a3a, 0.18],
  [0x4a7a42, 0.18],
  [0x6f9a45, 0.2],
  [0x93ab4a, 0.16],
  [0xa09a45, 0.1],
  [0x5b8250, 0.08],
  [0xc27a38, 0.06],
  [0xd9a043, 0.04]
]

function pickColor(rnd) {
  let t = rnd()
  for (const [c, p] of TREE_COLORS) {
    if ((t -= p) <= 0) return c
  }
  return TREE_COLORS[0][0]
}

/** 一个略带起伏的球：沙盘树团的毛茸茸轮廓 */
function crownGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1)
  const pos = g.attributes.position
  const v = new THREE.Vector3()
  const r = rng(3)
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const k = 1 + (r() - 0.5) * 0.22
    v.multiplyScalar(k)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  shadeByHeight(g)
  return g
}

/** 顶点色：树冠顶部亮、底部暗（像实体沙盘里被顶光照出来的毛球），和实例颜色相乘 */
function shadeByHeight(g) {
  const pos = g.attributes.position
  g.computeBoundingBox()
  const { min, max } = g.boundingBox
  const cols = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - min.y) / (max.y - min.y || 1)
    const k = 0.42 + 0.7 * t * t * (3 - 2 * t)
    cols[i * 3] = k
    cols[i * 3 + 1] = k
    cols[i * 3 + 2] = k * 0.96
  }
  g.setAttribute("color", new THREE.BufferAttribute(cols, 3))
}

/**
 * 种树
 * @param mask 地面遮罩（草地 = 1）
 * @param geos Blender 做的树冠几何 { broad: [a, b, c], cone }（可选，缺了就用程序化的球和锥）
 * @returns {{group: THREE.Group, count: number}}
 */
export function buildTrees(layout, mask, geos = null) {
  const group = new THREE.Group()
  group.name = "trees"
  const rnd = rng(4242)
  const noise = makeNoise(9)
  const { base } = layout
  const site = layout.site
  const inSite = (x, y) => Math.abs(x) < site.w / 2 && Math.abs(y) < site.d / 2

  const spots = []
  const cell = 4
  const hash = new Map()
  const key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`
  const free = (x, y, d) => {
    const cx = Math.floor(x / cell)
    const cy = Math.floor(y / cell)
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const arr = hash.get(`${cx + i},${cy + j}`)
        if (!arr) continue
        for (const p of arr)
          if (Math.hypot(p[0] - x, p[1] - y) < Math.max(d, p[2])) return false
      }
    }
    return true
  }
  const add = (x, y, d, scale = 1) => {
    spots.push([x, y, scale])
    const k = key(x, y)
    if (!hash.has(k)) hash.set(k, [])
    hash.get(k).push([x, y, d])
  }

  // 行道树：沿道路两侧人行道，间距均匀
  const street = (x0, y0, x1, y1, n) => {
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const x = x0 + (x1 - x0) * t
      const y = y0 + (y1 - y0) * t
      // 只种在底座椭圆内（留 10 m 边），否则会悬在半空
      if (ellipseK(base, x, y, 10) > 1) continue
      add(x, y, 5, 0.72)
    }
  }
  street(-250, 108.5, 270, 108.5, 38)
  street(-250, 145.5, 270, 145.5, 38)
  street(-250, -118.5, 270, -118.5, 38)
  street(-164.8, -150, -164.8, 130, 20)
  street(-155.2, -150, -155.2, 100, 18)
  street(153.2, -140, 153.2, 140, 20)

  // 其余：随机撒点 + 噪声成团，只落在草地上
  for (let n = 0; n < 90000 && spots.length < 8200; n++) {
    const x = base.cx + (rnd() * 2 - 1) * (base.rx - 8)
    const y = base.cy + (rnd() * 2 - 1) * (base.ry - 8)
    if (ellipseK(base, x, y, 9) > 1) continue
    if (!isLawn(mask, x, y)) continue
    const inside = inSite(x, y)
    // 小区内留开阔草坪：密度低一些；公园、河岸、周边成片密一些
    const nz = noise(x * 0.045 + 3, y * 0.045 + 7)
    const dens =
      0.62 *
      (inside
        ? 0.12 + 0.6 * Math.max(0, nz - 0.5)
        : 0.35 + 0.65 * Math.max(0, nz - 0.3))
    if (rnd() > dens) continue
    const d = inside ? 4.4 : 5.0
    if (!free(x, y, d)) continue
    add(x, y, d, 0.85 + rnd() * 0.4)
  }

  // 树冠几何：有 Blender 做的几种蓬松树冠就用它们（面少、径向法线、顶点色），没有就退回程序化的球和锥
  const crownGeos = geos?.broad ?? [crownGeometry()]
  const coneGeo =
    geos?.cone ??
    (() => {
      const g = new THREE.ConeGeometry(1, 2.4, 8)
      shadeByHeight(g)
      return g
    })()
  // 三种阔叶树冠的占比：最圆润的少一点，两种轻的多一点
  const pickVariant = () => {
    if (crownGeos.length < 3) return 0
    const t = rnd()
    return t < 0.4 ? 0 : t < 0.6 ? 1 : 2
  }
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 1, 5)
  const crownMat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    vertexColors: true
  })
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6a4c })

  const shadowSpots = [] // 接触阴影：[x, y, 半径]
  const balls = []
  const cones = []
  for (const s of spots) (rnd() < 0.12 ? cones : balls).push(s)

  const ballsBy = crownGeos.map(() => [])
  for (const s of balls) ballsBy[pickVariant()].push(s)
  const crownMeshes = crownGeos.map(
    (g, vi) => new THREE.InstancedMesh(g, crownMat, ballsBy[vi].length)
  )
  // 第二层树冠：更小、更高、更亮，叠在主冠上，轮廓不再是一个圆盘
  const crown2Meshes = crownGeos.map(
    (g, vi) => new THREE.InstancedMesh(g, crownMat, ballsBy[vi].length)
  )
  const conifers = new THREE.InstancedMesh(coneGeo, crownMat, cones.length)
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length)
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const col = new THREE.Color()
  let ti = 0
  ballsBy.forEach((arr, vi) =>
    arr.forEach(([x, y, sc], i) => {
      const r = (1.9 + rnd() * 1.6) * sc
      const trunkH = 2.7 * sc
      shadowSpots.push([x, y, r * 1.5])
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28)
      m4.compose(
        new THREE.Vector3(x, trunkH + r * 0.95, -y),
        q,
        new THREE.Vector3(r, r * (0.85 + rnd() * 0.2), r)
      )
      const cc = pickColor(rnd)
      crownMeshes[vi].setMatrixAt(i, m4)
      crownMeshes[vi].setColorAt(i, col.setHex(cc))
      m4.compose(
        new THREE.Vector3(
          x + (rnd() - 0.5) * r * 0.5,
          trunkH + r * 1.55,
          -y + (rnd() - 0.5) * r * 0.5
        ),
        q,
        new THREE.Vector3(r * 0.62, r * 0.56, r * 0.62)
      )
      crown2Meshes[vi].setMatrixAt(i, m4)
      crown2Meshes[vi].setColorAt(i, col.setHex(cc).multiplyScalar(1.18))
      m4.compose(
        new THREE.Vector3(x, trunkH / 2, -y),
        q,
        new THREE.Vector3(1, trunkH, 1)
      )
      trunks.setMatrixAt(ti++, m4)
    })
  )
  cones.forEach(([x, y, sc], i) => {
    const r = (1.4 + rnd() * 0.9) * sc
    const h = (5 + rnd() * 3) * sc
    shadowSpots.push([x, y, r * 1.3])
    m4.compose(
      new THREE.Vector3(x, 2 + h / 2, -y),
      q.identity(),
      new THREE.Vector3(r, h / 2.4, r)
    )
    conifers.setMatrixAt(i, m4)
    conifers.setColorAt(i, col.setHex(rnd() > 0.3 ? 0x24502f : 0x3a6b3c))
    m4.compose(new THREE.Vector3(x, 1, -y), q, new THREE.Vector3(1, 2, 1))
    trunks.setMatrixAt(ti++, m4)
  })
  // 灌木层：矮而密的小团，撒在草地上（不投影，省性能），树下、楼脚、路边多一层绿
  const shrubSpots = []
  const sh = new Map()
  for (let n = 0; n < 70000 && shrubSpots.length < 3000; n++) {
    const x = base.cx + (rnd() * 2 - 1) * (base.rx - 8)
    const y = base.cy + (rnd() * 2 - 1) * (base.ry - 8)
    if (ellipseK(base, x, y, 9) > 1 || !isLawn(mask, x, y)) continue
    const k = `${Math.floor(x / 2.4)},${Math.floor(y / 2.4)}`
    if (sh.has(k)) continue
    sh.set(k, 1)
    shrubSpots.push([x, y])
  }
  const shrubs = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    crownMat,
    shrubSpots.length
  )
  const SHRUB = [0x4a7a3c, 0x6f9a45, 0x8aa33c, 0xa59a3a, 0x3a6a40]
  shrubSpots.forEach(([x, y], i) => {
    const r = 0.9 + rnd() * 0.9
    shadowSpots.push([x, y, r * 1.5])
    m4.compose(
      new THREE.Vector3(x, r * 0.55, -y),
      q.identity(),
      new THREE.Vector3(r, r * 0.7, r)
    )
    shrubs.setMatrixAt(i, m4)
    shrubs.setColorAt(i, col.setHex(SHRUB[(rnd() * SHRUB.length) | 0]))
  })
  shrubs.receiveShadow = false
  shrubs.instanceMatrix.needsUpdate = true
  if (shrubs.instanceColor) shrubs.instanceColor.needsUpdate = true
  group.add(shrubs)
  for (const m of [...crownMeshes, ...crown2Meshes, conifers, trunks]) {
    m.castShadow = true
    // 树不接收阴影：接触阴影已经烘焙进地面，树丛是屏幕上过度绘制最多的地方，省掉阴影采样
    m.receiveShadow = false
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    group.add(m)
  }
  return { group, count: spots.length, spots: shadowSpots }
}

// ---------------------------------------------------------------- 路灯

/** 路灯位置：景观轴两侧、环湖步道、横向步道、北侧大道人行道 */
function lampSpots(layout) {
  const out = []
  const ax = layout.amenities.find((a) => a.id === "AX01")
  for (let y = ax.cy - ax.d / 2 + 6; y < ax.cy + ax.d / 2 - 2; y += 12) {
    out.push([-10.2, y], [10.2, y])
  }
  const lake = layout.amenities.find((a) => a.id === "LK01")
  for (let i = 0; i < 18; i++) {
    const t = (i / 18) * Math.PI * 2
    out.push([
      lake.cx + Math.cos(t) * (lake.w / 2 + 8.2),
      lake.cy + Math.sin(t) * (lake.d / 2 + 8.2)
    ])
  }
  for (let x = -130; x <= 130; x += 15) {
    if (Math.abs(x) > 50) out.push([x, 17.4])
  }
  for (let x = -230; x <= 250; x += 18) {
    for (const y of [108.8, 145.2])
      if (ellipseK(layout.base, x, y, 8) <= 1) out.push([x, y])
  }
  for (let x = -110; x <= 110; x += 20) out.push([x, -49])
  return out
}

/** 路灯：灯杆 + 灯头，灯头夜里发光（做 HDR 颜色，辉光才抓得住） */
export function buildLamps(layout) {
  const group = new THREE.Group()
  group.name = "lamps"
  const spots = lampSpots(layout)
  const poles = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.14, 0.2, 4.4, 5),
    new THREE.MeshStandardMaterial({ color: 0x2a2623, roughness: 0.6 }),
    spots.length
  )
  const headMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xffd9a0).multiplyScalar(0.5),
    toneMapped: false
  })
  const heads = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.62, 8, 6),
    headMat,
    spots.length
  )
  const m4 = new THREE.Matrix4()
  spots.forEach(([x, y], i) => {
    m4.makeTranslation(x, 2.2, -y)
    poles.setMatrixAt(i, m4)
    m4.makeTranslation(x, 4.7, -y)
    heads.setMatrixAt(i, m4)
  })
  poles.castShadow = true
  group.add(poles, heads)

  // 路灯在地面上的暖色光池：贴地的加色圆片，亮度随夜色（白天几乎看不见，黄昏起一圈圈亮起来）
  const pc = document.createElement("canvas")
  pc.width = pc.height = 128
  const pg = pc.getContext("2d")
  const grad = pg.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, "rgba(255,214,150,0.95)")
  grad.addColorStop(0.35, "rgba(255,190,110,0.45)")
  grad.addColorStop(1, "rgba(255,170,90,0)")
  pg.fillStyle = grad
  pg.fillRect(0, 0, 128, 128)
  const poolTex = new THREE.CanvasTexture(pc)
  poolTex.colorSpace = THREE.SRGBColorSpace
  const poolMat = new THREE.MeshBasicMaterial({
    map: poolTex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.08,
    toneMapped: false
  })
  const pools = new THREE.InstancedMesh(
    new THREE.CircleGeometry(8.5, 24).rotateX(-Math.PI / 2),
    poolMat,
    spots.length
  )
  spots.forEach(([x, y], i) => {
    m4.makeTranslation(x, 0.55, -y)
    pools.setMatrixAt(i, m4)
  })
  pools.renderOrder = 2
  group.add(pools)

  // 草坪里的地灯：树丛和步道之间一粒粒暖色小光点，夜里 / 黄昏亮起
  const ul = []
  const r = rng(808)
  const lk = layout.amenities.find((a) => a.id === "LK01")
  for (let n = 0; n < 4000 && ul.length < 150; n++) {
    const x = (r() * 2 - 1) * (layout.site.w / 2 - 6)
    const y = (r() * 2 - 1) * (layout.site.d / 2 - 6)
    // 不落在湖里（湖面上飘白点像灰尘）
    if (
      lk &&
      ((x - lk.cx) / (lk.w / 2 + 6)) ** 2 +
        ((y - lk.cy) / (lk.d / 2 + 6)) ** 2 <
        1
    )
      continue
    ul.push([x, y])
  }
  const upMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xffd9a0).multiplyScalar(0.6),
    toneMapped: false
  })
  const ups = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.3, 6, 4),
    upMat,
    ul.length
  )
  ul.forEach(([x, y], i) => {
    m4.makeTranslation(x, 0.7, -y)
    ups.setMatrixAt(i, m4)
  })
  group.add(ups)
  const dayCol = new THREE.Color(0xffd9a0).multiplyScalar(0.45)
  const nightCol = new THREE.Color(0xffd9a0).multiplyScalar(3.2)
  const upDay = new THREE.Color(0xffd9a0).multiplyScalar(0.6)
  const upNight = new THREE.Color(0xffc98a).multiplyScalar(1.7)
  const setLit = (v) => {
    headMat.color.copy(dayCol).lerp(nightCol, v)
    upMat.color.copy(upDay).lerp(upNight, v)
    poolMat.opacity = 0.08 + 0.55 * v
  }
  return { group, setLit }
}

// ---------------------------------------------------------------- 车流

/**
 * 四条道路上的车流：沿车道匀速走，到头循环；靠右行驶。
 * 车身 + 车顶两个实例化网格，车头白灯、车尾红灯夜里发亮。
 */
export function buildCars(layout) {
  const group = new THREE.Group()
  group.name = "cars"
  const { base } = layout
  // 车道取在底座椭圆内（留 12 m 边）
  const rxl = base.rx - 12
  const ryl = base.ry - 12
  /** 车道：沿 x（horizontal）或沿 y 的一条线，dir = +1 / -1，范围取在底座圆内 */
  const lanes = []
  const addH = (y, dir, n) => {
    const half = rxl * Math.sqrt(Math.max(0, 1 - ((y - base.cy) / ryl) ** 2))
    lanes.push({ h: true, c: y, dir, a: base.cx - half, b: base.cx + half, n })
  }
  const addV = (x, dir, n) => {
    const half = ryl * Math.sqrt(Math.max(0, 1 - ((x - base.cx) / rxl) ** 2))
    lanes.push({ h: false, c: x, dir, a: base.cy - half, b: base.cy + half, n })
  }
  // 北侧大道：东行在南半幅、西行在北半幅
  for (const y of [112.5, 116.5, 120.5]) addH(y, 1, 8)
  for (const y of [133.5, 137.5, 141.5]) addH(y, -1, 8)
  addH(-115, 1, 5)
  addH(-109, -1, 5)
  addV(-157, 1, 4)
  addV(-163, -1, 4)
  for (const x of [165.5, 169]) addV(x, 1, 4)
  for (const x of [158.5, 155]) addV(x, -1, 4)

  const total = lanes.reduce((s, l) => s + l.n, 0)
  const rnd = rng(31)
  const palette = [
    0xf2efe8, 0xd8d6d0, 0x2b2b2d, 0x9fa3a8, 0xa83a2e, 0x2f4f78, 0xe0e0e0,
    0xbfa46a
  ]
  const cars = []
  for (const l of lanes) {
    const len = l.b - l.a
    for (let i = 0; i < l.n; i++) {
      cars.push({
        l,
        s: rnd() * len,
        v: 7 + rnd() * 5,
        len,
        color: palette[(rnd() * palette.length) | 0]
      })
    }
  }
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.45,
    metalness: 0.2
  })
  const body = new THREE.InstancedMesh(
    new THREE.BoxGeometry(4.6, 1.25, 1.9),
    bodyMat,
    total
  )
  const cabin = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2.4, 0.9, 1.7),
    bodyMat,
    total
  )
  const headMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xfff2cf).multiplyScalar(0.8),
    toneMapped: false
  })
  const tailMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xff3a2a).multiplyScalar(0.8),
    toneMapped: false
  })
  const heads = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.3, 0.35, 1.5),
    headMat,
    total
  )
  const tails = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.3, 0.35, 1.5),
    tailMat,
    total
  )
  const col = new THREE.Color()
  cars.forEach((c, i) => {
    body.setColorAt(i, col.setHex(c.color))
    cabin.setColorAt(i, col.setHex(c.color).multiplyScalar(0.85))
  })
  group.add(body, cabin, heads, tails)

  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const place = (mesh, i, x, y, z, yaw, dx = 0) => {
    // dx：沿车身前进方向的偏移
    q.setFromAxisAngle(up, yaw)
    const off = new THREE.Vector3(dx, 0, 0).applyQuaternion(q)
    m4.compose(
      new THREE.Vector3(x + off.x, y, z + off.z),
      q,
      new THREE.Vector3(1, 1, 1)
    )
    mesh.setMatrixAt(i, m4)
  }
  const update = (t) => {
    cars.forEach((c, i) => {
      const l = c.l
      const s = (c.s + c.v * t) % c.len
      const p = l.dir > 0 ? l.a + s : l.b - s
      // 车身朝 +x 建模；沿 x 行驶时朝向 ±x，沿 y 行驶时朝向 ∓z（三维里 z = -y）
      let x
      let z
      let yaw
      if (l.h) {
        x = p
        z = -l.c
        yaw = l.dir > 0 ? 0 : Math.PI
      } else {
        x = l.c
        z = -p
        yaw = l.dir > 0 ? Math.PI / 2 : -Math.PI / 2
      }
      place(body, i, x, 0.9, z, yaw)
      place(cabin, i, x, 1.9, z, yaw, -0.2)
      place(heads, i, x, 0.95, z, yaw, 2.3)
      place(tails, i, x, 0.95, z, yaw, -2.3)
    })
    for (const m of [body, cabin, heads, tails])
      m.instanceMatrix.needsUpdate = true
  }
  update(0)
  const setLit = (v) => {
    headMat.color.set(0xfff2cf).multiplyScalar(0.8 + 2.4 * v)
    tailMat.color.set(0xff3a2a).multiplyScalar(0.8 + 1.4 * v)
  }
  return { group, update, setLit, count: total }
}

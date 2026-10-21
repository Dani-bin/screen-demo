/*
 * 智慧牧场 近景道具（程序化 three.js 低模，造型参照 docs/design/smart-ranch/design/closeup-a.png）
 * ----------------------------------------------------------
 *   营地 HH：白墙蓝铁皮顶的平房、木桩铁丝网羊圈、圆草垛、小光伏板
 *   场部 HQ：两栋平房、储草棚、称重通道、药浴池、大羊圈
 *   饮水点 WP：镀锌圆水罐、长条水槽、立杆光伏提水板
 *   中继基站 BS：立杆 + 光伏板 + 天线
 *   牛羊：单体低模，InstancedMesh 批量画（拉近时替换远景的点）
 * 尺寸都是真实米数（不乘地形的竖向放大），每个设施合并成一个网格（顶点色），绘制调用少。
 * 局部坐标：x 向右、y 向上、z 向前（朝向由调用方旋转）。
 */
import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"

const C = {
  wall: "#f3f1ea",
  roof: "#2f6fd6",
  roofDark: "#25579f",
  wood: "#8a6a48",
  woodDark: "#6b5136",
  hay: "#cdb46a",
  hayDark: "#b39a52",
  steel: "#b9c2c8",
  steelDark: "#8d979e",
  water: "#4d86a8",
  solar: "#1f3550",
  frame: "#c9ced2",
  dirt: "#a28f6e",
  door: "#5a6b7a",
  window: "#9fc3dd"
}

/** 带顶点色的几何体（合并前每块先上色、摆位） */
function part(geo, color, m) {
  // 合并要求统一为非索引几何（Extrude / Shape 本来就是非索引的）
  const g = geo.index ? geo.toNonIndexed() : geo
  const c = new THREE.Color(color).convertSRGBToLinear()
  const n = g.attributes.position.count
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3)
  g.setAttribute("color", new THREE.BufferAttribute(col, 3))
  if (m) g.applyMatrix4(m)
  g.deleteAttribute("uv")
  return g
}

const M = (x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
    new THREE.Vector3(sx, sy, sz)
  )

const box = (w, h, d, color, x, y, z, ry = 0) =>
  part(new THREE.BoxGeometry(w, h, d), color, M(x, y + h / 2, z, ry))

/** 双坡屋顶：宽 w（沿 x）、进深 d、檐高 h0、屋脊高 h1 */
function gableRoof(w, d, h0, h1, color, x = 0, z = 0) {
  const s = new THREE.Shape()
  s.moveTo(-d / 2 - 0.4, h0)
  s.lineTo(0, h1)
  s.lineTo(d / 2 + 0.4, h0)
  s.lineTo(d / 2 + 0.4, h0 - 0.2)
  s.lineTo(0, h1 - 0.2)
  s.lineTo(-d / 2 - 0.4, h0 - 0.2)
  const g = new THREE.ExtrudeGeometry(s, {
    depth: w + 0.8,
    bevelEnabled: false
  })
  g.translate(0, 0, -(w + 0.8) / 2)
  g.rotateY(Math.PI / 2)
  return part(g, color, M(x, 0, z))
}

/** 平房：墙体 + 门窗 + 双坡蓝顶 */
function house(w, d, x = 0, z = 0) {
  const h0 = 3.1
  const parts = [
    box(w, h0, d, C.wall, x, 0, z),
    gableRoof(w, d, h0, h0 + 1.6, C.roof, x, z)
  ]
  // 山墙三角
  const tri = new THREE.Shape()
  tri.moveTo(-d / 2, 0)
  tri.lineTo(0, 1.6)
  tri.lineTo(d / 2, 0)
  for (const sx of [-1, 1]) {
    const g = new THREE.ShapeGeometry(tri)
    g.rotateY((Math.PI / 2) * sx)
    parts.push(part(g, C.wall, M(x + (sx * w) / 2, h0, z)))
  }
  // 门、窗（贴在正面 +z）
  parts.push(box(1.0, 2.0, 0.08, C.door, x - w * 0.3, 0, z + d / 2 + 0.02))
  for (const wx of [-0.05, 0.25])
    parts.push(box(1.2, 0.9, 0.08, C.window, x + w * wx, 1.2, z + d / 2 + 0.02))
  return parts
}

/** 木桩铁丝网围栏：矩形 w × d，柱距 3 m，留一个门口 */
function pen(w, d, x = 0, z = 0) {
  const parts = []
  const corners = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2]
  ]
  for (let k = 0; k < 4; k++) {
    const [ax, az] = corners[k]
    const [bx, bz] = corners[(k + 1) % 4]
    const len = Math.hypot(bx - ax, bz - az)
    const ang = Math.atan2(bz - az, bx - ax)
    const n = Math.max(2, Math.round(len / 3))
    for (let i = 0; i <= n; i++) {
      const t = i / n
      // 正面中间留 4 m 门口
      if (k === 2 && Math.abs(t - 0.5) * len < 2) continue
      parts.push(
        box(
          0.14,
          1.3,
          0.14,
          C.woodDark,
          x + ax + (bx - ax) * t,
          0,
          z + az + (bz - az) * t
        )
      )
    }
    for (const y of [0.55, 1.1]) {
      const g = part(
        new THREE.BoxGeometry(len, 0.06, 0.06),
        C.wood,
        M(x + (ax + bx) / 2, y, z + (az + bz) / 2, -ang)
      )
      parts.push(g)
    }
  }
  return parts
}

/** 圆草垛 */
function hay(r, x = 0, z = 0) {
  const g = new THREE.CylinderGeometry(r, r * 1.05, r * 0.9, 16)
  const top = new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)
  return [
    part(g, C.hay, M(x, r * 0.45, z)),
    part(top, C.hayDark, M(x, r * 0.9, z, 0, 1, 0.55, 1))
  ]
}

/** 光伏板：宽 w、高 h，朝南倾斜 35° */
function solar(w, h, x = 0, z = 0, ry = 0, y = 1.2) {
  const g = new THREE.BoxGeometry(w, 0.06, h)
  const m = new THREE.Matrix4()
    .makeTranslation(x, y, z)
    .multiply(new THREE.Matrix4().makeRotationY(ry))
    .multiply(new THREE.Matrix4().makeRotationX(-0.6))
  const parts = [part(g, C.solar, m)]
  parts.push(box(0.08, y, 0.08, C.frame, x, 0, z))
  return parts
}

/** 牧户营地：平房 + 羊圈 + 草垛 + 光伏 */
export function homesteadGeometry() {
  const parts = [
    ...house(11, 7, -16, -10),
    ...pen(30, 20, 10, 2),
    ...hay(2.6, -24, 6),
    ...hay(2.2, -19, 9),
    ...solar(3.2, 2, -27, -10, 0.2),
    ...solar(3.2, 2, -27, -6, 0.2)
  ]
  return mergeGeometries(parts)
}

/** 合作社场部：两栋平房、储草棚、称重通道、药浴池、大羊圈 */
export function hqGeometry() {
  const parts = [
    ...house(18, 8, -30, -22),
    ...house(12, 7, -6, -24),
    // 储草棚：钢架 + 蓝色单坡顶
    box(24, 0.25, 12, C.roofDark, 22, 5.2, -22),
    ...[-11, 0, 11].flatMap((dx) => [
      box(0.3, 5.2, 0.3, C.steelDark, 22 + dx, 0, -27.5),
      box(0.3, 5.2, 0.3, C.steelDark, 22 + dx, 0, -16.5)
    ]),
    ...hay(2.4, 16, -22),
    ...hay(2.4, 21.5, -22),
    ...hay(2.4, 27, -22),
    // 称重通道：窄长围栏 + 称台
    box(14, 0.3, 2.2, C.steelDark, -14, 0, 8),
    ...[-1.2, 1.2].map((dz) => box(14, 1.2, 0.1, C.steel, -14, 0.3, 8 + dz)),
    // 药浴池：长条水池
    box(10, 0.5, 2.4, C.steelDark, 8, 0, 8),
    box(9.4, 0.06, 1.8, C.water, 8, 0.48, 8),
    ...pen(44, 26, 4, 30)
  ]
  return mergeGeometries(parts)
}

/** 饮水点：镀锌圆水罐 + 长条水槽 + 立杆光伏提水板 */
export function waterPointGeometry() {
  const tank = new THREE.CylinderGeometry(2.6, 2.6, 2.0, 24, 1, true)
  const rim = new THREE.TorusGeometry(2.6, 0.08, 6, 24)
  rim.rotateX(Math.PI / 2)
  const parts = [
    part(tank, C.steel, M(0, 1.0, 0)),
    part(rim, C.steelDark, M(0, 2.0, 0)),
    part(
      new THREE.CircleGeometry(2.55, 24).rotateX(-Math.PI / 2),
      C.water,
      M(0, 1.7, 0)
    ),
    box(6.5, 0.6, 0.9, C.steelDark, 5.2, 0, 0.4),
    box(6.2, 0.04, 0.6, C.water, 5.2, 0.56, 0.4),
    ...solar(2.4, 1.6, -3.6, 1.8, 0, 3.2)
  ]
  return mergeGeometries(parts)
}

/** 中继基站：12 m 立杆 + 光伏板 + 天线 */
export function stationGeometry() {
  const parts = [
    part(new THREE.CylinderGeometry(0.18, 0.28, 12, 8), C.frame, M(0, 6, 0)),
    part(
      new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6),
      C.steelDark,
      M(0, 13.2, 0)
    ),
    box(1.6, 0.06, 1.0, C.solar, 0.9, 8, 0),
    box(0.5, 0.8, 0.4, C.wall, -0.4, 6, 0)
  ]
  return mergeGeometries(parts)
}

/** 羊：椭球身子 + 头 + 四条细腿（约 1.2 m 长） */
export function sheepGeometry() {
  const body = new THREE.SphereGeometry(0.5, 10, 7)
  body.scale(1.25, 0.75, 0.75)
  const head = new THREE.SphereGeometry(0.2, 8, 6)
  const parts = [
    part(body, "#f4f1e8", M(0, 0.78, 0)),
    part(head, "#e9e2d2", M(0.62, 0.95, 0, 0, 1.2, 1, 0.9))
  ]
  for (const [lx, lz] of [
    [0.35, 0.18],
    [0.35, -0.18],
    [-0.35, 0.18],
    [-0.35, -0.18]
  ])
    parts.push(
      part(
        new THREE.CylinderGeometry(0.05, 0.05, 0.5, 5),
        "#5b5248",
        M(lx, 0.25, lz)
      )
    )
  return mergeGeometries(parts)
}

/** 牛：方身子 + 头 + 四条腿（约 2.2 m 长），白色花斑用顶点色画在背上 */
export function cowGeometry() {
  const parts = [
    box(2.0, 0.9, 0.85, "#8a4a2a", 0, 0.75, 0),
    box(0.9, 0.06, 0.6, "#f2ece2", -0.2, 1.65, 0.05),
    box(0.5, 0.5, 0.45, "#f2ece2", 1.15, 1.1, 0),
    box(0.25, 0.25, 0.3, "#d9c9b5", 1.42, 0.95, 0)
  ]
  for (const [lx, lz] of [
    [0.7, 0.3],
    [0.7, -0.3],
    [-0.7, 0.3],
    [-0.7, -0.3]
  ])
    parts.push(box(0.16, 0.75, 0.16, "#5a3220", lx, 0, lz))
  return mergeGeometries(parts)
}

/** 顶点色材质（道具共用）：带一点半球光，和地表的光照方向一致 */
export function propMaterial() {
  return new THREE.MeshLambertMaterial({ vertexColors: true })
}

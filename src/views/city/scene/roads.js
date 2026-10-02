/*
 * 折线 → 带状面：道路与河流
 * ----------------------------------------------------------
 * three.js 的线宽固定 1px，大屏上看不见，因此把每段折线挤成宽度为 width 的平面带。
 * 每段两端各取法向偏移 ±width/2 得到 4 个点、2 个三角形；不做拐角斜接，
 * 段间外侧缺口由每个折点上的圆形接头补齐：在折线的每个顶点（含两端点）
 * 放一个半径 width/2 的 8 边形扇面，端点处的圆盘同时也把相邻两条道路的衔接处补平。
 * 所有面都是水平的，法线直接写 (0, 1, 0)，不依赖三角形绕序计算。
 *
 * 道路分四档，每档两层：略宽的路缘垫在下面、白色路面铺在上面。
 */
import { BufferGeometry, Float32BufferAttribute, Group, Mesh } from "three"

// 圆形接头的分段数
const JOINT_SEGMENTS = 8
// 预先算好单位圆上的各分段点，所有接头共用
const JOINT_CIRCLE = Array.from({ length: JOINT_SEGMENTS + 1 }, (_, k) => {
  const a = (k / JOINT_SEGMENTS) * Math.PI * 2
  return [Math.cos(a), Math.sin(a)]
})

/**
 * @param {Array<Array<[number, number]>>} lines 折线数组，每条为 [[x, z], ...]
 * @param {number} width 带宽（米）
 * @param {number} y 平铺高度
 * @returns {BufferGeometry|null}
 */
export function ribbonGeometry(lines, width, y) {
  const pos = []
  const half = width / 2
  // 追加一个三角形（输入均为 [x, z]，高度统一为 y）
  const tri = (a, b, c) => {
    pos.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1])
  }
  for (const pts of lines) {
    if (!pts || pts.length < 2) continue
    // 段：每段一个矩形（两个三角形）
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i]
      const [x2, z2] = pts[i + 1]
      const dx = x2 - x1
      const dz = z2 - z1
      const len = Math.hypot(dx, dz)
      if (len < 1e-6) continue
      const nx = (-dz / len) * half
      const nz = (dx / len) * half
      const l1 = [x1 + nx, z1 + nz]
      const l2 = [x2 + nx, z2 + nz]
      const r1 = [x1 - nx, z1 - nz]
      const r2 = [x2 - nx, z2 - nz]
      // 左上-右上-右下，左上-右下-左下（从上往下看逆时针，面朝 +Y）
      tri(l1, l2, r2)
      tri(l1, r2, r1)
    }
    // 接头：每个顶点一个圆盘扇面。
    // Y 轴朝上时，角度递增的 (c, p_k, p_k+1) 从上往下看是顺时针（面朝 -Y），
    // 所以按 (c, p_k+1, p_k) 输出，使扇面朝上。
    for (const [cx, cz] of pts) {
      const c = [cx, cz]
      for (let k = 0; k < JOINT_SEGMENTS; k++) {
        const [cos0, sin0] = JOINT_CIRCLE[k]
        const [cos1, sin1] = JOINT_CIRCLE[k + 1]
        tri(
          c,
          [cx + cos1 * half, cz + sin1 * half],
          [cx + cos0 * half, cz + sin0 * half]
        )
      }
    }
  }
  if (!pos.length) return null
  const g = new BufferGeometry()
  g.setAttribute("position", new Float32BufferAttribute(pos, 3))
  // 全部是水平面，法线统一朝上
  const normals = new Float32Array(pos.length)
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1
  g.setAttribute("normal", new Float32BufferAttribute(normals, 3))
  return g
}

function addRibbon(group, lines, width, y, material) {
  const g = ribbonGeometry(lines, width, y)
  if (!g) return
  const m = new Mesh(g, material)
  m.receiveShadow = true
  group.add(m)
}

/**
 * 道路：按 a/b/c/d 四档分别合并，路缘在 y=0.5，路面按档次 0.6–0.9 递增（主干道盖在支路上）。
 */
export function createRoads(roads, materials, theme) {
  const group = new Group()
  const order = ["d", "c", "b", "a"]
  order.forEach((cls, i) => {
    const lines = roads.filter((r) => r.c === cls).map((r) => r.p)
    const [surface, curb] = theme.roadWidths[cls]
    addRibbon(group, lines, curb, 0.5, materials.roadCurb)
    addRibbon(group, lines, surface, 0.6 + i * 0.1, materials.roadSurface)
  })
  return group
}

/** 河流中心线挤成水面带 */
export function createRivers(rivers, materials, theme) {
  const group = new Group()
  addRibbon(group, rivers, theme.riverWidth, 0.35, materials.water)
  return group
}

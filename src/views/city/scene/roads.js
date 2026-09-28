/*
 * 折线 → 带状面：道路与河流
 * ----------------------------------------------------------
 * three.js 的线宽固定 1px，大屏上看不见，因此把每段折线挤成宽度为 width 的平面带。
 * 每段两端各取法向偏移 ±width/2 得到 4 个点、2 个三角形；不做拐角斜接，
 * 相邻段在拐角处略有重叠，俯视角度下不可察觉。
 *
 * 道路分四档，每档两层：略宽的路缘垫在下面、白色路面铺在上面。
 */
import { BufferGeometry, Float32BufferAttribute, Group, Mesh } from "three"

/**
 * @param {Array<Array<[number, number]>>} lines 折线数组，每条为 [[x, z], ...]
 * @param {number} width 带宽（米）
 * @param {number} y 平铺高度
 * @returns {BufferGeometry|null}
 */
export function ribbonGeometry(lines, width, y) {
  const pos = []
  const half = width / 2
  for (const pts of lines) {
    if (!pts || pts.length < 2) continue
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i]
      const [x2, z2] = pts[i + 1]
      const dx = x2 - x1
      const dz = z2 - z1
      const len = Math.hypot(dx, dz)
      if (len < 1e-6) continue
      const nx = (-dz / len) * half
      const nz = (dx / len) * half
      // 两个三角形：左上-右上-右下，左上-右下-左下（从上往下看逆时针，法线朝上）
      pos.push(
        x1 + nx,
        y,
        z1 + nz,
        x2 + nx,
        y,
        z2 + nz,
        x2 - nx,
        y,
        z2 - nz,
        x1 + nx,
        y,
        z1 + nz,
        x2 - nx,
        y,
        z2 - nz,
        x1 - nx,
        y,
        z1 - nz
      )
    }
  }
  if (!pos.length) return null
  const g = new BufferGeometry()
  g.setAttribute("position", new Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
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

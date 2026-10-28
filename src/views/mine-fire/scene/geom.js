/*
 * 几何工具：沿折线扫出方截面走廊、平铺带状面（边界虚线、箭头带用）
 * 输入都是 three.js 水平坐标 [x, z]；高度单独给。
 */
import * as THREE from "three"

/** 平面坐标折线 [[e, n], ...] → three.js 水平坐标 [[x, z], ...] */
export function planToXZ(pts) {
  return pts.map((p) => [p[0], -p[1]])
}

/**
 * 每个顶点的斜接偏移方向（单位法线 × 斜接系数），用于等宽扫掠
 * @returns {{ nx: number, nz: number, k: number }[]}
 */
function miters(pts) {
  const out = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[i]
    const c = pts[Math.min(pts.length - 1, i + 1)]
    // 前后两段的切向
    let t1 = [b[0] - a[0], b[1] - a[1]]
    let t2 = [c[0] - b[0], c[1] - b[1]]
    const l1 = Math.hypot(...t1) || 1
    const l2 = Math.hypot(...t2) || 1
    t1 = [t1[0] / l1, t1[1] / l1]
    t2 = [t2[0] / l2, t2[1] / l2]
    if (i === 0) t1 = t2
    if (i === pts.length - 1) t2 = t1
    const t = [t1[0] + t2[0], t1[1] + t2[1]]
    const lt = Math.hypot(...t) || 1
    // 左手法线（x, z 平面里切向转 90°）
    const n = [-t[1] / lt, t[0] / lt]
    const n1 = [-t1[1], t1[0]]
    const k = 1 / Math.max(0.35, n[0] * n1[0] + n[1] * n1[1])
    out.push({ nx: n[0], nz: n[1], k })
  }
  return out
}

/**
 * 沿折线扫出方截面走廊（两侧面 + 顶面 + 两端封口，不要底面）
 * 顶点属性：uv.x = 沿线距离（米），uv.y = 面内横向 0–1（着色器用它画棱边发光），face = 0 顶 / 1 侧 / 2 端
 */
export function sweepBox(pts, width, height, y0, caps = true) {
  const m = miters(pts)
  const half = width / 2
  const pos = []
  const uv = []
  const face = []
  const idx = []
  // 累计长度
  const dist = [0]
  for (let i = 1; i < pts.length; i++)
    dist.push(
      dist[i - 1] +
        Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    )

  // 截面四个角（左下、左上、右上、右下）
  const corner = (i, side, top) => {
    const s = side * half * m[i].k
    return [
      pts[i][0] + m[i].nx * s,
      y0 + (top ? height : 0),
      pts[i][1] + m[i].nz * s
    ]
  }
  // 一条长面：a、b 是截面角的取法，沿线铺四边形
  const strip = (cornA, cornB, f) => {
    const base = pos.length / 3
    for (let i = 0; i < pts.length; i++) {
      pos.push(...cornA(i), ...cornB(i))
      uv.push(dist[i], 0, dist[i], 1)
      face.push(f, f)
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  strip(
    (i) => corner(i, 1, true),
    (i) => corner(i, -1, true),
    0
  ) // 顶面
  strip(
    (i) => corner(i, 1, false),
    (i) => corner(i, 1, true),
    1
  ) // 左侧面
  strip(
    (i) => corner(i, -1, true),
    (i) => corner(i, -1, false),
    1
  ) // 右侧面
  // 两端封口（走廊、工作面不封：几条在交汇处叠在一起的端盖会过曝成白点）
  for (const i of caps ? [0, pts.length - 1] : []) {
    const base = pos.length / 3
    const c = [
      corner(i, 1, false),
      corner(i, 1, true),
      corner(i, -1, true),
      corner(i, -1, false)
    ]
    c.forEach((p, j) => {
      pos.push(...p)
      uv.push(j === 0 || j === 1 ? 0 : 1, j === 1 || j === 2 ? 1 : 0)
      face.push(2)
    })
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute("face", new THREE.Float32BufferAttribute(face, 1))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/**
 * 平铺带状面：沿折线、宽 width、高度 y；uv.x = 沿线距离（米），uv.y = 横向 0–1
 * closed = true 时首尾相接（边界）
 */
export function ribbon(pts, width, y, closed = false) {
  const p = closed ? [...pts, pts[0]] : pts
  const m = miters(p)
  const pos = []
  const uv = []
  const idx = []
  let d = 0
  for (let i = 0; i < p.length; i++) {
    if (i) d += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])
    const s = (width / 2) * m[i].k
    pos.push(p[i][0] + m[i].nx * s, y, p[i][1] + m[i].nz * s)
    pos.push(p[i][0] - m[i].nx * s, y, p[i][1] - m[i].nz * s)
    uv.push(d, 0, d, 1)
    if (i < p.length - 1) {
      const a = i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

/** 折线上按距离取点和切向（three.js 水平坐标） */
export function along(pts, d) {
  let left = Math.max(0, d)
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (left <= seg || i === pts.length - 1) {
      const k = seg ? Math.min(1, left / seg) : 0
      return {
        x: a[0] + (b[0] - a[0]) * k,
        z: a[1] + (b[1] - a[1]) * k,
        tx: seg ? (b[0] - a[0]) / seg : 1,
        tz: seg ? (b[1] - a[1]) / seg : 0
      }
    }
    left -= seg
  }
  return { x: pts[0][0], z: pts[0][1], tx: 1, tz: 0 }
}

export function lengthOf(pts) {
  let L = 0
  for (let i = 1; i < pts.length; i++)
    L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return L
}

/** 画布生成的圆形柔光贴图（光点、光晕、烟雾粒子用） */
export function softTexture(size = 64, hard = 0.0) {
  const c = document.createElement("canvas")
  c.width = c.height = size
  const g = c.getContext("2d")
  const r = size / 2
  const grad = g.createRadialGradient(r, r, 0, r, r, r)
  grad.addColorStop(0, "rgba(255,255,255,1)")
  grad.addColorStop(Math.min(0.9, 0.25 + hard), "rgba(255,255,255,0.75)")
  grad.addColorStop(1, "rgba(255,255,255,0)")
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

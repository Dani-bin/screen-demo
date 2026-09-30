/*
 * 太阳阴影范围：整城 / 按站点收紧
 * ----------------------------------------------------------
 * 整城一张 4096 阴影贴图覆盖约 6.2 km，每个 texel 约 1.5 m（范围由 computeCityShadow
 * 按城市数据实算），景点的柱子、檐下、栏杆阴影仍会糊掉。巡览停靠某站时，
 * 把阴影正交相机收紧到站点周围 ±R 米（R = 1000 时约 0.5 m/texel），
 * 回总览 / 离站时恢复整城范围。
 * 代价：停靠期间离站点 R 以外的楼没有阴影（站点机位视野基本落在 R 以内）。
 *
 * 两个函数只改太阳与阴影相机参数，调用方负责置 renderer.shadowMap.needsUpdate = true。
 * CityScene 与 lab 预览页共用，保证预览截图与线上停靠时一致。
 */
import { Vector3 } from "three"

/** 停靠站点时的阴影半径（米） */
export const STOP_SHADOW_RADIUS = 1000

// 太阳到收紧中心的距离（米）：远大于 1.5R，保证光源在全部投影物之上
const SUN_DISTANCE = 2000

// 阴影相机默认的 up（three 的 Object3D.DEFAULT_UP）：停靠站点时恢复，保持与改动前一致
const DEFAULT_UP = new Vector3(0, 1, 0)

// 预筛凸包候选点用的 8 个方向（每 45° 一个，按角度递增）
const OCTA_DIRS = Array.from({ length: 8 }, (_, k) => [
  Math.cos((k * Math.PI) / 4),
  Math.sin((k * Math.PI) / 4)
])

/**
 * 二维凸包（Akl–Toussaint 预筛 + Andrew 单调链），返回逆时针顶点 [[a, b], ...]。
 * 整城有十几万个投影点，直接排序要上百毫秒；先取 8 个方向上的最远点围成凸八边形，
 * 严格落在八边形内的点不可能是凸包顶点，筛掉后只剩几百个候选点再排序。
 * @param {number[]} as 各点第一坐标
 * @param {number[]} bs 各点第二坐标
 */
function convexHull(as, bs) {
  const n = as.length
  const octa = OCTA_DIRS.map(([dx, dy]) => {
    let best = 0
    let bestV = -Infinity
    for (let i = 0; i < n; i++) {
      const val = as[i] * dx + bs[i] * dy
      if (val > bestV) {
        bestV = val
        best = i
      }
    }
    return [as[best], bs[best]]
  })
  const candidates = []
  for (let i = 0; i < n; i++) {
    const a = as[i]
    const b = bs[i]
    let inside = true
    for (let k = 0; k < 8; k++) {
      const [x0, y0] = octa[k]
      const [x1, y1] = octa[(k + 1) % 8]
      // 八边形逆时针：点在每条边左侧（叉积 > 0）才算严格在内
      if ((x1 - x0) * (b - y0) - (y1 - y0) * (a - x0) <= 0) {
        inside = false
        break
      }
    }
    if (!inside) candidates.push([a, b])
  }
  const pts = candidates.sort((p, q) => p[0] - q[0] || p[1] - q[1])
  if (pts.length < 3) return pts
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower = []
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    )
      lower.pop()
    lower.push(p)
  }
  const upper = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    )
      upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/**
 * 由城市数据算整城阴影相机：覆盖全部投影物的最紧正交范围，并绕光轴转到 texel 最小的朝向。
 *
 * - 投影物：楼栋（轮廓顶点取楼底与楼顶两个高度）+ 公园与河流中心线（通用树所在，
 *   高度取树顶上限）。平行光下投影物与它的影子落在光源视空间的同一 (x, y) 处，
 *   包住投影物即包住全部影子；远处空旷地面只接收不投影，不必覆盖。
 * - 朝向：默认 up = (0, 1, 0) 时光源视空间的轴与城市街网斜交，包围盒有大片空角。
 *   在垂直光线的平面里对投影点求凸包，按 0.5° 步长扫描旋转角，取 max(宽, 高) 最小者
 *   （贴图是正方形，texel 由长边决定），得到阴影相机的 up 向量。
 * - 深度：near / far 取投影点沿光线方向的实际区间；bias 按 light.shadowBiasMeters
 *   换算（正交深度线性，bias × (far − near) ≈ 沿光线的米数），范围变了偏移量仍一致。
 * 数据范围变化（如南扩）时自动适应，不用手改常量。
 * @param {object} geometry 城市几何数据（buildings / parks / rivers）
 * @param {object} theme THEME（取 light 与 tree）
 * @returns {{ up: number[], left: number, right: number, top: number,
 *   bottom: number, near: number, far: number, bias: number }}
 */
export function computeCityShadow(geometry, theme) {
  const light = theme.light
  const t = theme.tree
  const sunPos = new Vector3(...light.sunPosition)
  const dist = sunPos.length()
  // 与 lookAt 相同的基：w 指向太阳，u = up × w（右），v = w × u（上）
  const w = sunPos.clone().normalize()
  const u = new Vector3().crossVectors(DEFAULT_UP, w).normalize()
  const v = new Vector3().crossVectors(w, u)
  // 投影点在垂直光线平面上的坐标（a 沿 u、b 沿 v），分两个数组存，省去十几万个小数组
  const as = []
  const bs = []
  let dMin = Infinity
  let dMax = -Infinity
  const add = (x, y, z) => {
    as.push(x * u.x + y * u.y + z * u.z)
    bs.push(x * v.x + y * v.y + z * v.z)
    const d = dist - (x * w.x + y * w.y + z * w.z) // 到太阳所在平面的距离
    if (d < dMin) dMin = d
    if (d > dMax) dMax = d
  }
  for (const b of geometry.buildings || []) {
    for (const [x, z] of b.p) {
      add(x, 0, z)
      add(x, b.h, z)
    }
  }
  // 通用树树顶上限：树干最高 + 树冠中心 0.95·size + 竖向半轴 1.15·size
  const treeTop = t.trunkMin + t.trunkVar + 2.1 * (t.crownMin + t.crownVar)
  for (const line of [...(geometry.parks || []), ...(geometry.rivers || [])]) {
    for (const [x, z] of line) {
      add(x, 0, z)
      add(x, treeTop, z)
    }
  }
  if (!as.length) throw new Error("城市数据为空，无法计算阴影范围")

  const hull = convexHull(as, bs)
  const extent = (c, s) => {
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (const [a, b] of hull) {
      const x = a * c + b * s
      const y = b * c - a * s
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    return { x0, x1, y0, y1 }
  }
  // 正方形贴图转 90° 只是宽高互换，扫 [0°, 90°) 即可
  let best = null
  for (let deg = 0; deg < 90; deg += 0.5) {
    const r = (deg * Math.PI) / 180
    const e = extent(Math.cos(r), Math.sin(r))
    const size = Math.max(e.x1 - e.x0, e.y1 - e.y0)
    if (!best || size < best.size) best = { r, e, size }
  }
  const c = Math.cos(best.r)
  const s = Math.sin(best.r)
  // 旋转后的相机 y 轴（世界坐标）作为 up：lookAt 得到的 x 轴 = c·u + s·v，y 轴 = −s·u + c·v，
  // 与上面 extent 里的 (x, y) 定义一致
  const up = u.clone().multiplyScalar(-s).addScaledVector(v, c)
  const m = light.shadowMargin
  const near = dMin - m
  const far = dMax + m
  return {
    up: up.toArray(),
    left: best.e.x0 - m,
    right: best.e.x1 + m,
    bottom: best.e.y0 - m,
    top: best.e.y1 + m,
    near,
    far,
    bias: -light.shadowBiasMeters / (far - near)
  }
}

/**
 * 整城阴影：太阳在 light.sunPosition、朝向原点，范围、朝向与偏移取 computeCityShadow 的结果。
 * @param {THREE.DirectionalLight} sun
 * @param {object} light THEME.light
 * @param {object} box computeCityShadow(geometry, THEME) 的返回值
 */
export function applyCityShadow(sun, light, box) {
  sun.position.set(...light.sunPosition)
  sun.target.position.set(0, 0, 0)
  // 阴影正交范围要覆盖整个城区，小了会出现阴影被截断的硬边；
  // up 决定阴影相机绕光轴的转角（three 在 updateMatrices 里 lookAt 时使用）
  const cam = sun.shadow.camera
  cam.up.fromArray(box.up)
  cam.left = box.left
  cam.right = box.right
  cam.top = box.top
  cam.bottom = box.bottom
  cam.near = box.near
  cam.far = box.far
  cam.updateProjectionMatrix()
  // 偏移量见 theme.light.shadowBiasMeters / shadowNormalBias 的注释
  sun.shadow.bias = box.bias
  sun.shadow.normalBias = light.shadowNormalBias
}

/**
 * 按站点收紧阴影：光照方向不变，太阳沿该方向放在 center 上方 SUN_DISTANCE 米处，
 * 正交范围 ±radius，深度范围 SUN_DISTANCE ± 1.5·radius（覆盖高楼与其投影落点）。
 * @param {THREE.DirectionalLight} sun
 * @param {object} light THEME.light（取 sunPosition 作为光照方向）
 * @param {number[]} center 收紧中心 [x, y, z]
 * @param {number} [radius=STOP_SHADOW_RADIUS]
 */
export function applyStopShadow(
  sun,
  light,
  center,
  radius = STOP_SHADOW_RADIUS
) {
  const dir = new Vector3(...light.sunPosition).normalize()
  const c = new Vector3(...center)
  sun.position.copy(c).addScaledVector(dir, SUN_DISTANCE)
  sun.target.position.copy(c)
  // 整城阴影会旋转阴影相机（computeCityShadow 的 up）；站点范围是正方形、以站点为中心，
  // 恢复默认 up，保持停靠画面与改动前一致
  sun.shadow.camera.up.copy(DEFAULT_UP)
  Object.assign(sun.shadow.camera, {
    left: -radius,
    right: radius,
    top: radius,
    bottom: -radius,
    near: SUN_DISTANCE - radius * 1.5,
    far: SUN_DISTANCE + radius * 1.5
  })
  sun.shadow.camera.updateProjectionMatrix()
  // 正交深度线性：深度范围 3R 米，bias × 3R ≈ 0.15 m 沿光线的偏移；
  // texel 约 2R/4096 米（R = 1000 时约 0.5 m），法线偏移取 0.15 m 足以消除条纹又不漏光
  sun.shadow.bias = -0.15 / (radius * 3)
  sun.shadow.normalBias = 0.15
}

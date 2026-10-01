/*
 * 太阳阴影范围：整城 / 按站点收紧
 * ----------------------------------------------------------
 * 整城一张 4096 阴影贴图覆盖全部投影物：正交范围与朝向由 computeCityShadow 按城市
 * 建好后的真实投影物实算，texel = 正方形边长 / 4096，随数据范围变化（米级），
 * 景点的柱子、檐下、栏杆阴影仍会糊掉。巡览停靠某站时，
 * 把阴影正交相机收紧到站点周围 ±R 米（R = 1000 时约 0.5 m/texel），
 * 回总览 / 离站时恢复整城范围。
 * 代价：停靠期间离站点 R 以外的楼没有阴影（站点机位视野基本落在 R 以内）。
 *
 * 两个 apply 函数只改太阳与阴影相机参数，调用方负责置 renderer.shadowMap.needsUpdate = true。
 * CityScene 与 lab 预览页共用，保证预览截图与线上停靠时一致。
 */
import { Box3, Vector3 } from "three"
import { GROUND_Y } from "./terrain.js"
import { treeShape } from "./trees.js"

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
// 半径 r 的圆的外切正八边形，顶点离圆心 r / cos(22.5°)：树冠包围球投到光源平面是圆，
// 用这 8 个顶点代替整个圆参与凸包，保证圆完整落在凸包内
const OCTA_CIRCUMSCRIBE = 1 / Math.cos(Math.PI / 8)

// 包围盒的 8 个角点：下标 k 的第 0 / 1 / 2 位分别决定 x / y / z 取 min（0）还是 max（1）
const BOX_CORNERS = Array.from({ length: 8 }, (_, k) => [
  k & 1,
  (k >> 1) & 1,
  (k >> 2) & 1
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
 * 由城市建好后的投影物算整城阴影相机：覆盖全部投影物与其影子落点的最紧正交范围，
 * 并绕光轴转到 texel 最小的朝向。须在楼栋、通用树、景点、落点球都建完之后调用。
 *
 * - 投影物（凡 castShadow 的都要包住，漏掉的会在范围边缘被截出硬边）：
 *   · 楼栋：轮廓顶点取楼底（y = 0）与楼顶两个高度；
 *   · 通用树：每棵树真实树冠的包围球（trees.js 的 treeShape，含位置、尺寸与树干高），
 *     投到光源平面是圆，用外切八边形参与凸包；
 *   · 其余对象（景点模型、落点球）：遍历 castShadow 的 Mesh，取各自局部包围盒的 8 个角点
 *     换到世界坐标——逐个 Mesh 取，不取整个景点组的包围盒：十个景点散在全城，
 *     整组包围盒的顶角（高 339 m 的熊猫塔决定盒高）会把范围撑大很多。
 *   平行光下投影物与它的影子落在光源视空间的同一 (x, y) 处，包住投影物即在平面方向包住全部影子；
 *   远处空旷地面只接收不投影，不必覆盖。
 * - 朝向：默认 up = (0, 1, 0) 时光源视空间的轴与城市街网斜交，包围盒有大片空角。
 *   在垂直光线的平面里对投影点求凸包，按 0.5° 步长扫描旋转角，取 max(宽, 高) 最小者
 *   （贴图是正方形，texel 由长边决定），得到阴影相机的 up 向量。
 * - 深度：near 取投影物最靠近太阳处；far 取影子落到地面（y = GROUND_Y）处的最大深度——
 *   点 (x, y, z) 沿光线落到地面要再走 (y − GROUND_Y) / w.y 米（w 为指向太阳的单位向量），
 *   落点比投影点本身更深。far 只算到投影点的话，城边高楼的影子尖会超出 far，被当成受光截掉。
 *   bias 按 light.shadowBiasMeters 换算（正交深度线性，bias × (far − near) ≈ 沿光线的米数），
 *   范围变了偏移量仍一致。
 * 平面方向与深度方向都再外扩 light.shadowMargin 米，吸收浮点误差与 PCF 取样的邻近 texel。
 * 数据范围变化（如南扩）、新增城边景点时自动适应，不用手改常量。
 * @param {object} casters
 * @param {Array} [casters.buildings] 楼栋 [{ p: [[x, z], ...], h }]（geometry.buildings；
 *   含被景点替换、不再画的楼也无妨，只会更保守）
 * @param {Array} [casters.trees] 通用树布局（trees.js 的 layoutTrees，即 createTrees().layout）
 * @param {THREE.Object3D[]} [casters.objects] 其余投影物的根节点（景点组、落点球组）；
 *   不要传通用树或合并楼栋的 Mesh（整城一个包围盒，会把范围撑到最大）
 * @param {(x: number, z: number) => boolean} [casters.within] 只计入落在该区域内的投影物
 *   （楼按首个轮廓点、树按树根、Mesh 按包围盒中心判断）；缺省全部计入
 * @param {object} light THEME.light
 * @returns {{ up: number[], left: number, right: number, top: number,
 *   bottom: number, near: number, far: number, bias: number }}
 */
export function computeCityShadow(
  { buildings = [], trees = [], objects = [], within = null },
  light
) {
  const sunPos = new Vector3(...light.sunPosition)
  const dist = sunPos.length()
  // 与 lookAt 相同的基：w 指向太阳，u = up × w（右），v = w × u（上）
  const w = sunPos.clone().normalize()
  const u = new Vector3().crossVectors(DEFAULT_UP, w).normalize()
  const v = new Vector3().crossVectors(w, u)
  // 影子落地深度 = 投影点深度 + (y − GROUND_Y) / w.y，对位置是线性函数 const + p·g，
  // g = ŷ / w.y − w，|g| = √(1 / w.y² − 1)（太阳天顶角的正切）。
  // 半径 r 的球上各点落地深度的最大值 = 球心落地深度 + r·|g|
  const landSlope = Math.sqrt(1 / (w.y * w.y) - 1)
  // 投影点在垂直光线平面上的坐标（a 沿 u、b 沿 v），分两个数组存，省去十几万个小数组
  const as = []
  const bs = []
  let dMin = Infinity
  let dMax = -Infinity
  /**
   * 登记一个投影物：r = 0 为点，r > 0 为以 (x, y, z) 为心、半径 r 的球
   */
  const add = (x, y, z, r = 0) => {
    const a = x * u.x + y * u.y + z * u.z
    const b = x * v.x + y * v.y + z * v.z
    if (r > 0) {
      const rr = r * OCTA_CIRCUMSCRIBE
      for (const [dx, dy] of OCTA_DIRS) {
        as.push(a + dx * rr)
        bs.push(b + dy * rr)
      }
    } else {
      as.push(a)
      bs.push(b)
    }
    const d = dist - (x * w.x + y * w.y + z * w.z) // 到太阳所在平面的距离
    if (d - r < dMin) dMin = d - r
    // 影子落地处的深度（投影物在地面以下时取其自身深度）
    const land = d + Math.max(0, (y - GROUND_Y) / w.y + r * landSlope)
    const deepest = Math.max(d + r, land)
    if (deepest > dMax) dMax = deepest
  }
  for (const b of buildings) {
    if (!b.p) continue
    // 区域过滤：楼按首个轮廓点判断，整栋进出
    if (within && !within(b.p[0][0], b.p[0][1])) continue
    for (const [x, z] of b.p) {
      add(x, 0, z)
      add(x, b.h, z)
    }
  }
  for (const { x, z, size, height } of trees) {
    // 区域过滤：树按树根位置判断
    if (within && !within(x, z)) continue
    const c = treeShape(size, height)
    add(x, c.centerY, z, c.boundRadius)
  }
  const box = new Box3()
  const p = new Vector3()
  for (const root of objects) {
    // 模型刚建好、尚未渲染过，先更新世界矩阵（含祖先）
    root.updateWorldMatrix(true, true)
    root.traverse((obj) => {
      if (!obj.castShadow || !obj.geometry) return
      // 与 Box3.expandByObject 相同：InstancedMesh 等自带 boundingBox（已含全部实例），
      // 普通 Mesh 用几何体的包围盒；均为对象局部坐标
      if (obj.boundingBox !== undefined) {
        if (obj.boundingBox === null) obj.computeBoundingBox()
        box.copy(obj.boundingBox)
      } else {
        if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox()
        box.copy(obj.geometry.boundingBox)
      }
      if (box.isEmpty()) return
      // 区域过滤按包围盒中心的世界坐标判断（景点模型、定位针各自整块进出）
      if (within) {
        box.getCenter(p).applyMatrix4(obj.matrixWorld)
        if (!within(p.x, p.z)) return
      }
      // 局部包围盒的 8 个角点换到世界坐标：几何体在角点的凸包内，凸包投影后仍包住它
      for (const [i, j, k] of BOX_CORNERS) {
        p.set(
          i ? box.max.x : box.min.x,
          j ? box.max.y : box.min.y,
          k ? box.max.z : box.min.z
        ).applyMatrix4(obj.matrixWorld)
        add(p.x, p.y, p.z)
      }
    })
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
 * @param {object} box computeCityShadow 的返回值
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

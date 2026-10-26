/*
 * 剖面示意布局：皮带里程 → 三维位置
 * ----------------------------------------------------------
 * data/section.json 是从定稿概念图反投影出来的剖面布局（scripts/smart-conveyor/fit_camera.py），
 * 坐标就是 three.js 的：x 沿块长边（左 = 工作面，右 = 地面原煤仓），y 向上，z 朝镜头（块正面 z = 0）。
 * 剖面是示意，不按真实比例：真实长度、里程一律用 layout.json；三维里一条皮带的位置按"里程 / 真实长度"的比例
 * 落到它在剖面里的折线上（折角处做圆角，带面看起来是连续的）。
 */
import * as THREE from "three"
import section from "../data/section.json"
import layout from "../data/layout.json"

export const SECTION = section
/** 主斜井地面斜廊长度（示意尺度）：驱动机房按它的顶端摆放（props.js） */
export const GALLERY = 130
export const BELTS = Object.fromEntries(layout.belts.map((b) => [b.id, b]))

/** 折线圆角：每个折角用二次贝塞尔过渡，半径不超过两侧线段的 1/3 */
function fillet(points, radius = 70, steps = 8) {
  const P = points.map((p) => new THREE.Vector3(...p))
  if (P.length < 3) return P
  const out = [P[0]]
  for (let i = 1; i < P.length - 1; i++) {
    const a = P[i - 1]
    const b = P[i]
    const c = P[i + 1]
    const r = Math.min(radius, a.distanceTo(b) / 3, b.distanceTo(c) / 3)
    const p0 = b.clone().add(a.clone().sub(b).setLength(r))
    const p2 = b.clone().add(c.clone().sub(b).setLength(r))
    for (let k = 0; k <= steps; k++) {
      const t = k / steps
      const q = p0
        .clone()
        .multiplyScalar((1 - t) * (1 - t))
        .add(b.clone().multiplyScalar(2 * t * (1 - t)))
        .add(p2.clone().multiplyScalar(t * t))
      out.push(q)
    }
  }
  out.push(P[P.length - 1])
  // 去掉重合的相邻点（圆角首尾和原折点重合时会出现），否则管道法线算出 NaN，辉光会把它扩散成整屏黑
  return out.filter((p, i) => i === 0 || p.distanceTo(out[i - 1]) > 0.5)
}

/** 一条皮带在剖面里的路径：点列、累计长度、总长 */
const PATHS = {}
export function beltPath(id) {
  if (PATHS[id]) return PATHS[id]
  const raw = section.belts[id].map((p) => [...p])
  // 主斜井：定稿里斜井露出地面后还有一段斜廊，升进驱动机房；沿最后一段的坡度往上延长
  if (id === "BC02") {
    const [a, b] = raw.slice(-2)
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const len = Math.hypot(...d)
    raw.push(d.map((v, i) => b[i] + (v / len) * GALLERY))
  }
  const pts = fillet(raw)
  const cum = [0]
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]))
  PATHS[id] = { pts, cum, len: cum[cum.length - 1] }
  return PATHS[id]
}

/** 剖面路径上按比例 f（0 = 机尾，1 = 机头）取点和切线 */
export function pathAt(id, f) {
  const { pts, cum, len } = beltPath(id)
  const d = Math.min(Math.max(f, 0), 1) * len
  let i = 1
  while (i < cum.length - 1 && cum[i] < d) i++
  const seg = cum[i] - cum[i - 1] || 1
  const k = (d - cum[i - 1]) / seg
  const pos = pts[i - 1].clone().lerp(pts[i], k)
  const tan = pts[i]
    .clone()
    .sub(pts[i - 1])
    .normalize()
  return { pos, tan }
}

/** 真实里程（m）→ 剖面位置 */
export function chainageToPoint(id, chainage) {
  return pathAt(id, chainage / BELTS[id].L).pos
}

/** 带面的横向（水平、垂直于走向）；竖直段退化时用 z 轴 */
export function sideOf(tan) {
  const s = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0))
  if (s.lengthSq() < 1e-4) s.set(0, 0, 1)
  return s.normalize()
}

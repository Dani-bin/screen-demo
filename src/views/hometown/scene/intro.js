/*
 * 老家沙盘 开场动画："卫星图 → 沙盘"
 * ----------------------------------------------------------
 * 呼应用户最早在卫星截图上的标注：先看到那张卫星图，红线描出老家的范围、蓝线描出回家的路，
 * 然后整块地"长"成三维沙盘，镜头从正上方倾斜到全景。时间线（秒）：
 *   0.0–1.0  正上方俯视，卫星图淡入（略带老照片的暖黄）
 *   0.8–2.6  红线沿沙盘轮廓逐段描出
 *   2.2–3.8  蓝线沿回家路线逐段描出
 *   3.8–6.4  沙盘从平地长高（村子整体 scale.y 0 → 1），卫星图与标线渐隐
 *   4.2–8.4  镜头从俯视倾斜到全景
 */
import * as THREE from "three"

import SITE from "../data/site.json"

export const INTRO_DUR = 8.6
const clamp01 = (x) => Math.min(1, Math.max(0, x))
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)
const span = (t, a, b) => clamp01((t - a) / (b - a))

/** 沿折线的飘带（宽 w 米，贴在高度 y 上），返回 [网格, 索引总数] 以便按比例描出 */
function ribbon(pts, w, y, color) {
  const pos = []
  const idx = []
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const dx = b[0] - a[0]
    const dz = b[2] - a[2]
    const L = Math.hypot(dx, dz) || 1
    pos.push(
      p[0] - (dz / L) * w,
      y,
      p[2] + (dx / L) * w,
      p[0] + (dz / L) * w,
      y,
      p[2] - (dx / L) * w
    )
    if (i > 0) {
      const k = (i - 1) * 2
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  const m = new THREE.Mesh(
    g,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      toneMapped: false
    })
  )
  m.renderOrder = 5
  return [m, idx.length]
}

export class HomeIntro {
  /**
   * ctx：{ scene, village, satTex, setView(k) }
   *   village：整个沙盘（地面、房屋、树）的根节点，开场时压扁再长高
   *   setView(k)：k = 0 正上方俯视、1 全景，由场景实现镜头插值
   */
  constructor(ctx) {
    this.ctx = ctx
    this.group = new THREE.Group()
    ctx.scene.add(this.group)
    this._satellite()
    const slab = [...SITE.slab, SITE.slab[0]]
    ;[this.red, this.redN] = ribbon(slab, 0.9, 0.6, 0xff3b30)
    // 回家路线：从公路路口描到家门口
    ;[this.blue, this.blueN] = ribbon(SITE.route, 0.9, 0.7, 0x2f8cff)
    this.group.add(this.red, this.blue)
    this.baseScale = ctx.village.scale.y
    this.update(0)
  }

  /** 卫星图平面：四角取自 site.json（截图像素 → 米），带一点暖黄的旧照片色调 */
  _satellite() {
    const [tl, tr, br, bl] = SITE.satellite
    const y = 0.4
    const g = new THREE.BufferGeometry()
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [tl[0], y, tl[2], tr[0], y, tr[2], br[0], y, br[2], bl[0], y, bl[2]],
        3
      )
    )
    g.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2)
    )
    g.setIndex([0, 3, 1, 1, 3, 2])
    this.sat = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        map: this.ctx.satTex,
        color: 0xfff0d8,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide
      })
    )
    this.sat.renderOrder = 4
    this.group.add(this.sat)
  }

  /** 推进到 t 秒，返回是否结束 */
  update(t) {
    const fade = 1 - span(t, 4.2, 6.2)
    this.sat.material.opacity = span(t, 0, 1) * fade
    this.sat.visible = this.sat.material.opacity > 0.001
    const r = ease(span(t, 0.8, 2.6))
    this.red.geometry.setDrawRange(0, Math.floor((this.redN * r) / 6) * 6)
    this.red.material.opacity = fade
    const b = ease(span(t, 2.2, 3.8))
    this.blue.geometry.setDrawRange(0, Math.floor((this.blueN * b) / 6) * 6)
    this.blue.material.opacity = fade
    const g = ease(span(t, 3.8, 6.4))
    this.ctx.village.scale.y = this.baseScale * Math.max(0.002, g)
    this.ctx.setView(ease(span(t, 4.2, 8.4)))
    return t >= INTRO_DUR
  }

  finish() {
    this.ctx.village.scale.y = this.baseScale
    this.ctx.setView(1)
    this.ctx.scene.remove(this.group)
    this.group.traverse((o) => {
      o.geometry?.dispose()
      o.material?.dispose()
    })
  }
}

/*
 * 综合能源补给站 开场「现状航拍 → 规划」动画
 * ----------------------------------------------------------
 * 时间线（秒）：
 *   0.0–0.8  俯视镜头，卫星底图（假定场址截图）淡入
 *   0.6–2.4  用地红线逐段描出
 *   2.0–4.2  各功能分区色块与名称依次出现（对应规划草图 plan-v1.png）
 *   4.2–7.6  场站设施从地面「长」出来（由北向南扫过），底图与分区色块渐隐
 *   4.6–8.4  镜头从俯视缓缓倾斜到主视角
 * 底图贴在 y=0.3 的平面上，盖住所有贴地图层；高出地面的对象先压扁（scale.y≈0），随时间线长回原高。
 */
import * as THREE from "three"

import PLAN from "../data/plan.json"
import { labelTexture } from "./sprites"

const DUR = 8.6
const clamp01 = (x) => Math.min(1, Math.max(0, x))
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)
/** 在 [a, b] 区间内的归一化进度 */
const span = (t, a, b) => clamp01((t - a) / (b - a))

/** 贴地对象（不压扁）：合并后的地面（烘焙贴图）、导向箭头、车位描边、预留储能虚线框 */
const FLAT = /^(ground|lane_arrows|bay_C\d\d|ess_reserved)$/

export class PlanIntro {
  /**
   * ctx：{ scene, station, aerialTex, setView(k), onDone }
   *   setView(k)：k=0 俯视、k=1 主视角，由场景实现镜头插值
   */
  constructor(ctx) {
    this.ctx = ctx
    this.t = 0
    this.group = new THREE.Group()
    ctx.scene.add(this.group)
    this._buildAerial()
    this._buildOutline()
    this._buildZones()
    this._collectRisers()
    this.update(0)
  }

  _buildAerial() {
    const [tl, tr, br, bl] = PLAN.aerial
    const g = new THREE.BufferGeometry()
    const y = 0.3
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [tl[0], y, tl[1], tr[0], y, tr[1], br[0], y, br[1], bl[0], y, bl[1]],
        3
      )
    )
    g.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2)
    )
    g.setIndex([0, 3, 1, 1, 3, 2])
    this.aerial = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        map: this.ctx.aerialTex,
        transparent: true,
        side: THREE.DoubleSide
      })
    )
    this.aerial.renderOrder = 1
    this.group.add(this.aerial)
  }

  /** 红线：沿场地轮廓的 1.4 m 宽飘带，按索引数逐段显示 */
  _buildOutline() {
    const pts = [...PLAN.site, PLAN.site[0]]
    const pos = []
    const idx = []
    const w = 0.7
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      const a = pts[Math.max(0, i - 1)]
      const b = pts[Math.min(pts.length - 1, i + 1)]
      const dx = b[0] - a[0]
      const dz = b[1] - a[1]
      const L = Math.hypot(dx, dz) || 1
      pos.push(
        p[0] - (dz / L) * w,
        0.36,
        p[1] + (dx / L) * w,
        p[0] + (dz / L) * w,
        0.36,
        p[1] - (dx / L) * w
      )
      if (i > 0) {
        const k = (i - 1) * 2
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    this.outlineCount = idx.length
    this.outline = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        color: 0xff3b3b,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    )
    this.outline.renderOrder = 3
    this.group.add(this.outline)
  }

  /** 分区色块 + 描边 + 名称标签 */
  _buildZones() {
    this.zones = PLAN.zones.map((z, i) => {
      const shape = new THREE.Shape(
        z.pts.map(([x, zz]) => new THREE.Vector2(x, -zz))
      )
      const geo = new THREE.ShapeGeometry(shape)
      geo.rotateX(-Math.PI / 2)
      const fill = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: z.color,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide
        })
      )
      fill.position.y = 0.34
      fill.renderOrder = 2
      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(
          z.pts.map(([x, zz]) => new THREE.Vector3(x, 0.38, zz))
        ),
        new THREE.LineBasicMaterial({
          color: z.color,
          transparent: true,
          opacity: 0
        })
      )
      line.renderOrder = 3
      const { texture, aspect } = labelTexture(z.name, z.color)
      const label = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          opacity: 0,
          depthTest: false
        })
      )
      const cx = z.pts.reduce((s, p) => s + p[0], 0) / z.pts.length
      const cz = z.pts.reduce((s, p) => s + p[1], 0) / z.pts.length
      const h =
        z.key === "charge" ||
        z.key === "fuel" ||
        z.key === "lng" ||
        z.key === "office"
          ? 7
          : 5
      label.scale.set(h * aspect, h, 1)
      label.position.set(cx, 10, cz)
      label.renderOrder = 12
      this.group.add(fill, line, label)
      return { fill, line, label, delay: i * 0.18 }
    })
  }

  /** 需要「长出来」的对象：station 的顶层子节点里不贴地的那些，按 x 由北（+x）向南排出延迟 */
  _collectRisers() {
    const xs = []
    this.risers = []
    for (const o of this.ctx.station.children) {
      if (FLAT.test(o.name)) continue
      const box = new THREE.Box3().setFromObject(o)
      // 没有几何的空对象（anchor_* 标签锚点）包围盒为空，中心是 NaN：混进来会让所有延迟变成 NaN，
      // 设施的 scale 跟着变 NaN（整段「长出来」期间不可见，结束时才突然出现）
      if (box.isEmpty()) continue
      const x = (box.min.x + box.max.x) / 2
      xs.push(x)
      this.risers.push({ o, x, scale: o.scale.y })
    }
    const x0 = Math.max(...xs)
    const x1 = Math.min(...xs)
    for (const r of this.risers) r.delay = ((x0 - r.x) / (x0 - x1 || 1)) * 1.8
  }

  /** 推进到 t 秒；返回是否结束 */
  update(t) {
    this.t = t
    this.aerial.material.opacity = span(t, 0, 0.8) * (1 - span(t, 5.0, 7.0))
    this.aerial.visible = this.aerial.material.opacity > 0.001
    // 红线：逐段描出，之后随底图一起淡出
    const k = ease(span(t, 0.6, 2.4))
    this.outline.geometry.setDrawRange(
      0,
      Math.floor((this.outlineCount * k) / 6) * 6
    )
    this.outline.material.opacity = 1 - span(t, 6.4, 7.8)
    for (const z of this.zones) {
      const a = ease(span(t, 2.0 + z.delay, 2.6 + z.delay))
      const out = span(t, 6.2, 7.6)
      z.fill.material.opacity = 0.55 * a * (1 - out)
      z.line.material.opacity = a * (1 - out)
      z.label.material.opacity = a * (1 - span(t, 6.6, 7.6))
      z.label.position.y = 10 + (1 - a) * 3
    }
    for (const r of this.risers) {
      const g = ease(span(t, 4.2 + r.delay, 5.6 + r.delay))
      r.o.scale.y = r.scale * Math.max(0.001, g)
    }
    this.ctx.setView(ease(span(t, 4.6, 8.4)))
    return t >= DUR
  }

  /** 立即结束：所有对象恢复原高，移除动画用的辅助物体 */
  finish() {
    for (const r of this.risers) r.o.scale.y = r.scale
    this.ctx.setView(1)
    this.ctx.scene.remove(this.group)
    this.group.traverse((o) => {
      o.geometry?.dispose()
      o.material?.dispose()
    })
  }
}

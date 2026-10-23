/*
 * 无人机巡检监控平台 · 三维叠加层（数据驱动，不烘焙进模型）
 * ----------------------------------------------------------
 * 与定稿（design/final.png）一致的几类叠加：
 *   - 航线：在飞无人机这一趟的航迹，已飞段实线、未飞段虚线（青色，线宽按屏幕像素）
 *   - 尾迹：最近 3 分钟的轨迹，渐隐光带（叠加混合，越靠近飞机越亮）
 *   - 事件：待确认 / 督办的重大、较大事件 → 地面三圈扩散光圈 + 竖直光柱；
 *           正在被悬停监视的事件 → 无人机到地面的视野锥；其余未办结事件 → 等级色小圆点
 *   - 火炬禁飞柱：半透明红色圆柱 + 上下虚线圈
 * update() 每秒随数据刷新一次（重建几何），tick() 每帧只做动画。
 */
import * as THREE from "three"
import { Line2 } from "three/addons/lines/Line2.js"
import { LineMaterial } from "three/addons/lines/LineMaterial.js"
import { LineGeometry } from "three/addons/lines/LineGeometry.js"
import { THEME, w2t } from "./theme.js"
import { currentFlight, pointOnFlight } from "../sim/simulator.js"
import { NO_FLY, TARGETS } from "../data/layout.js"

const C = THEME.overlay
const TRAIL_MS = 3 * 60 * 1000

/** 竖直渐变的光柱材质（底部亮、顶部透明，叠加混合） */
function beamMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uPulse: { value: 1 }
    },
    vertexShader: `varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying float vY; uniform vec3 uColor; uniform float uPulse;
      void main(){ float a = pow(1.0 - vY, 1.6) * 0.85 * uPulse; gl_FragColor = vec4(uColor * a * 1.6, a); }`
  })
}

export class Overlays {
  constructor(scene, host) {
    this.host = host
    this.group = new THREE.Group()
    this.group.name = "OVERLAYS"
    scene.add(this.group)
    this.res = new THREE.Vector2(1920, 1080)
    this.routes = new THREE.Group()
    this.events = new THREE.Group()
    this.group.add(this.routes, this.events)
    this.ripples = []
    this.time = 0
    this._noFly()
  }

  resize(w, h) {
    this.res.set(w, h)
    this.group.traverse(
      (o) => o.material?.isLineMaterial && o.material.resolution.set(w, h)
    )
  }

  _line(
    pts,
    {
      color,
      width = 2,
      dashed = false,
      opacity = 0.9,
      additive = false,
      vertexColors = null
    }
  ) {
    const g = new LineGeometry()
    g.setPositions(pts.flatMap((p) => w2t(p[0], p[1], p[2])))
    if (vertexColors) g.setColors(vertexColors)
    const m = new LineMaterial({
      color: vertexColors ? 0xffffff : color,
      linewidth: width,
      dashed,
      dashSize: 6,
      gapSize: 5,
      transparent: true,
      opacity,
      depthWrite: false,
      vertexColors: !!vertexColors,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      worldUnits: false
    })
    m.resolution.copy(this.res)
    const l = new Line2(g, m)
    if (dashed) l.computeLineDistances()
    l.renderOrder = 5
    return l
  }

  _clear(group) {
    for (const o of [...group.children]) {
      group.remove(o)
      o.traverse((c) => {
        c.geometry?.dispose()
        ;[].concat(c.material || []).forEach((m) => m.dispose())
      })
    }
  }

  /** 每秒：按当前数据重建航线、尾迹、事件标记 */
  update(day, state, t) {
    if (!day || !state) return
    this._clear(this.routes)
    this._clear(this.events)
    this.ripples = []
    // ---- 航线与尾迹
    for (const u of Object.values(state.drones)) {
      const f = currentFlight(day, u.id, t)
      if (!f || t < f.takeoffAt || t > f.landAt) continue
      const pts = [f.segs[0].a, ...f.segs.map((s) => s.b)]
      const cur = pointOnFlight(f, t)
      // 已飞段：所有终点早于 t 的分段 + 当前点
      const done = [f.segs[0].a]
      for (const s of f.segs) {
        if (s.t1 <= t) done.push(s.b)
        else break
      }
      done.push(cur)
      const rest = [cur, ...f.segs.filter((s) => s.t1 > t).map((s) => s.b)]
      const color = f.kind === "review" ? C.serious : C.route
      if (done.length > 1)
        this.routes.add(this._line(done, { color, width: 2, opacity: 0.9 }))
      if (rest.length > 1)
        this.routes.add(
          this._line(rest, { color, width: 1.5, dashed: true, opacity: 0.7 })
        )
      // 尾迹：最近 3 分钟，每 4 s 一个点，颜色从透明（黑）渐变到亮青（叠加混合下黑 = 透明）
      const trail = []
      const cols = []
      const tc = new THREE.Color(C.trail)
      const t0 = Math.max(f.takeoffAt, t - TRAIL_MS)
      for (let k = t0; k <= t; k += 4000) {
        trail.push(pointOnFlight(f, k))
        const a = (k - t0) / (t - t0 || 1)
        cols.push(tc.r * a * a, tc.g * a * a, tc.b * a * a)
      }
      trail.push(cur)
      cols.push(tc.r, tc.g, tc.b)
      if (trail.length > 2)
        this.routes.add(
          this._line(trail, {
            width: 7,
            additive: true,
            opacity: 0.55,
            vertexColors: cols
          })
        )
      void pts
    }
    // ---- 事件
    for (const e of state.events) {
      if (e.status === "closed" || e.status === "false") continue
      const hot =
        (e.status === "pending" || e.overdue) &&
        (e.level === "major" || e.level === "serious")
      const col = C[e.level]
      if (hot) {
        for (let i = 0; i < 3; i++) {
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.86, 1, 64),
            new THREE.MeshBasicMaterial({
              color: col,
              transparent: true,
              opacity: 0.6,
              depthWrite: false,
              side: THREE.DoubleSide,
              blending: THREE.AdditiveBlending,
              fog: false
            })
          )
          ring.rotation.x = -Math.PI / 2
          ring.position.set(...w2t(e.x, e.y, 0.6))
          ring.userData.phase = i / 3
          ring.userData.max = e.level === "major" ? 46 : 30
          this.events.add(ring)
          this.ripples.push(ring)
        }
        // 光柱：半径 1.3 m、高 100 m（定稿里约 6 px 宽、168 px 高）。原先半径 2.2 m、高 140 m，
        // 加上辉光显得过粗，而且一直顶到 130 m 高的无人机旁边（评审意见，比对第 36 轮）
        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(1.3, 1.3, 100, 16, 1, true),
          beamMaterial(col)
        )
        beam.position.set(...w2t(e.x, e.y, 50))
        beam.userData.beam = true
        this.events.add(beam)
        // 发现它的无人机正在悬停监视：画视野锥（无人机 → 地面上的扫描圆）
        const u = Object.values(state.drones).find(
          (d) => d.eventId === e.id && d.state === "monitor"
        )
        if (u) {
          const top = new THREE.Vector3(...w2t(u.x, u.y, u.z))
          const base = new THREE.Vector3(...w2t(e.x, e.y, 0.5))
          const h = top.distanceTo(base)
          const cone = new THREE.Mesh(
            new THREE.ConeGeometry(22, h, 32, 1, true),
            new THREE.MeshBasicMaterial({
              color: col,
              transparent: true,
              opacity: 0.05,
              depthWrite: false,
              side: THREE.DoubleSide,
              blending: THREE.AdditiveBlending,
              fog: false
            })
          )
          cone.position.copy(top).add(base).multiplyScalar(0.5)
          cone.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, -1, 0),
            base.clone().sub(top).normalize()
          )
          this.events.add(cone)
          const disc = new THREE.Mesh(
            new THREE.CircleGeometry(22, 48),
            new THREE.MeshBasicMaterial({
              color: col,
              transparent: true,
              opacity: 0.18,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
              fog: false
            })
          )
          disc.rotation.x = -Math.PI / 2
          disc.position.copy(base)
          this.events.add(disc)
        }
      } else {
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(3.2, 12, 8),
          new THREE.MeshBasicMaterial({ color: col, fog: false })
        )
        // 未办结的普通事件画在所属设施的中心（定稿合成页按设施锚点画圆点）；找不到设施时用事件点
        const tg = TARGETS[e.target]
        dot.position.set(...w2t(tg ? tg.x : e.x, tg ? tg.y : e.y, 3.5))
        this.events.add(dot)
      }
    }
  }

  /**
   * 火炬禁飞柱：上下两道虚线圈 + 东西两侧各一条竖直虚线（定稿的画法）。
   * 不画半透明圆柱面：圆柱罩住公用工程右半边，整片被染红（比对第 21 轮，红色通道高出 11–20）。
   * 竖线放在正东、正西：主机位在园区正南，这两处正好是柱子的左右轮廓。
   */
  _noFly() {
    for (const nf of NO_FLY) {
      // 示意柱尺寸按定稿（markR / markH），不是规划半径 r
      const z = { x: nf.x, y: nf.y, r: nf.markR ?? nf.r }
      const h = nf.markH ?? 160
      for (const sx of [-1, 1]) {
        this.group.add(
          this._line(
            [
              [z.x + sx * z.r, z.y, 0.5],
              [z.x + sx * z.r, z.y, h]
            ],
            { color: C.noFly, width: 1.2, dashed: true, opacity: 0.55 }
          )
        )
      }
      // 地面圈淡红填充（定稿 fill-opacity 0.12；示意柱只有约 18 m 粗，不会把公用工程染红）
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(z.r, 48),
        new THREE.MeshBasicMaterial({
          color: C.noFly,
          transparent: true,
          opacity: 0.12,
          depthWrite: false,
          fog: false
        })
      )
      disc.rotation.x = -Math.PI / 2
      disc.position.set(...w2t(z.x, z.y, 0.6))
      this.group.add(disc)
      for (const hz of [0.5, h]) {
        const pts = []
        for (let k = 0; k <= 64; k++) {
          const a = (k / 64) * Math.PI * 2
          pts.push([z.x + z.r * Math.cos(a), z.y + z.r * Math.sin(a), hz])
        }
        this.group.add(
          this._line(pts, {
            color: C.noFly,
            width: 1.2,
            dashed: true,
            opacity: 0.55
          })
        )
      }
    }
  }

  /** 每帧：光圈扩散、光柱脉冲的相位由仿真时刻派生（1.2 s 一个周期），回放暂停 / 冻结时停住 */
  tick(dt, t) {
    this.time = (t || 0) / 1000
    const ph = this.time / 1.2
    for (const r of this.ripples) {
      const k = (ph + r.userData.phase) % 1
      const sc = 6 + k * r.userData.max
      r.scale.set(sc, sc, sc)
      r.material.opacity = 0.75 * (1 - k)
    }
    for (const o of this.events.children)
      if (o.userData.beam)
        o.material.uniforms.uPulse.value =
          0.75 + 0.25 * Math.sin(ph * Math.PI * 2)
  }

  dispose() {
    this._clear(this.group)
  }
}

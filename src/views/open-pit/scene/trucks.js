/**
 * 100 台无人矿卡：一个实例化网格（车身）+ 一个实例化网格（货物）+ 一组尾迹线。
 * 位置完全由仿真状态决定：每辆车有「对应电铲」，沿那台电铲的路线走；
 *   空载 / 重载按 s / 运距 映射到路线的 0–1；排队按队位沿路排；换电、待命、故障各有落点。
 * 仿真一秒一更，场景用上一帧到这一帧的速度外推，让车辆连续移动。
 */
import * as THREE from "three"

import { PHASE } from "../sim/simulator.js"
import { truckGeometry } from "./props.js"
import { THEME } from "./theme.js"
import { VS, world } from "./world.js"

const SC = THEME.scale.truck
const WHITE = new THREE.Color(0xe8f6ff)
const QGAP = 150 // 排队时车间距 m（车放大 9 倍后约 95 m 长）
const TRAIL = 5 // 尾迹段数
const TRAIL_STEP = 75 // 每段 m
// 货物色比车身暗一档：车身是霓虹状态色，货物只是车斗里的料堆（煤 = 暗金，剥离物 = 暗紫，和图表图例同色相）
const CARGO = { coal: 0x9a6d00, strip: 0x6a55a8 }
// 故障车停靠点允许的世界范围 m：坑的东北侧，落在总览画面里、不被左右侧栏盖住，也避开坑底几台电铲的标签堆（设计稿里 TK-037 也在东北坑沿）
const FAULT_BOX = { x: [700, 2600], y: [300, 1800] }

/** 世界朝向角（+x 为 0，逆时针，世界 y 向北）→ 绕 three y 轴的角（前向 +z） */
const yawToRotY = (yaw) => Math.atan2(Math.cos(yaw), -Math.sin(yaw))

export class Trucks {
  /**
   * @param {Array} list layout.json 里的卡车 [{id, fleet}]
   * @param {Object<string, Route>} routes 按电铲编号
   * @param {Grid} grid
   * @param {Object} simRoutes 仿真里各编组的运距，{ "FL-A": { haul, swapM, kind }, ... }
   */
  constructor(list, routes, grid, simRoutes) {
    this.list = list
    this.routes = routes
    this.grid = grid
    this.simRoutes = simRoutes
    this.n = list.length
    this.index = new Map(list.map((t, i) => [t.id, i]))
    this.pos = list.map(() => new THREE.Vector3())

    const geo = truckGeometry()
    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true }),
      this.n
    )
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.n * 3),
      3
    )
    this.mesh.frustumCulled = false
    this.mesh.name = "trucks"

    this.cargo = new THREE.InstancedMesh(
      new THREE.BoxGeometry(4.3, 1.5, 5.8).translate(0, 5.4, -0.9),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      this.n
    )
    this.cargo.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.n * 3),
      3
    )
    this.cargo.frustumCulled = false

    // 车灯：车头一条很亮的灯带（颜色超过 1，辉光会把它扩成光点），只给在路上跑的车亮
    this.lamps = new THREE.InstancedMesh(
      new THREE.BoxGeometry(3.4, 1.0, 0.8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 2.0, 2.2) }),
      this.n
    )
    this.lamps.frustumCulled = false
    this._lampOff = new THREE.Matrix4().makeTranslation(0, 3.7, 5.4)
    this._m2 = new THREE.Matrix4()
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0)

    // 尾迹：每辆车 TRAIL 段，叠加混合，颜色随段号渐隐
    const tv = this.n * TRAIL * 2
    this.trailPos = new Float32Array(tv * 3)
    this.trailCol = new Float32Array(tv * 3)
    const tg = new THREE.BufferGeometry()
    tg.setAttribute("position", new THREE.BufferAttribute(this.trailPos, 3))
    tg.setAttribute("color", new THREE.BufferAttribute(this.trailCol, 3))
    this.trails = new THREE.LineSegments(
      tg,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    this.trails.frustumCulled = false

    // 换电站与待命区（世界坐标）
    this.stations = ["SW-01", "SW-02"].map((id) => world.positions[id])
    const sw = this.stations[0]
    this.park = { x: sw.x - 700, y: sw.y + 40 } // 待命区：换电站西侧、坑沿外，贴着地面，不悬在画面下方
    this._m = new THREE.Matrix4()
    this._q = new THREE.Quaternion()
    this._e = new THREE.Euler()
    this._s = new THREE.Vector3()
    this._p = new THREE.Vector3()
    this._c = new THREE.Color()
    this._tmp = {}
    this._tmp2 = {}
    this._faultCache = new Map()
  }

  group() {
    const g = new THREE.Group()
    g.add(this.mesh, this.cargo, this.lamps, this.trails)
    return g
  }

  _ground(x, y) {
    return this.grid.height(x, y) * VS
  }

  /** 某辆车在当前状态下的世界位置与朝向：返回 {x, y, yaw, moving, back(f→)} */
  _place(t, s) {
    const R = this.routes[t.loader] || this.routes["ES-01"]
    const sim = this.simRoutes[t.route] || this.simRoutes["FL-A"]
    const H = sim.haul
    const out = this._tmp
    const len = R.len
    const qpos = Math.max(1, t.qpos || 1)
    const ph = t.phase
    out.moving = false
    out.dir = 1 // 沿路线方向（+1 顺路线，-1 逆路线）
    out.f = 0
    switch (ph) {
      case PHASE.EMPTY: {
        const u = Math.min(1, s / H)
        out.f = 1 - u
        out.dir = -1
        out.moving = true
        R.at(out.f, out)
        // 刚换完电出来：从换电站平滑接到路线（电量 ≥ 94 % 且刚出发）
        if (t.soc > 94 && u < 0.07) {
          const st = this.stations[this._hash(t.id) & 1]
          const k = u / 0.07
          const kk = k * k * (3 - 2 * k)
          out.x = st.x + (out.x - st.x) * kk
          out.y = st.y + (out.y - st.y) * kk
        }
        break
      }
      case PHASE.QUEUE_LOAD:
        out.f = Math.min(1, (qpos * QGAP) / len + 0.004)
        out.dir = -1
        R.at(out.f, out)
        break
      case PHASE.LOAD:
        out.f = 0.006
        R.at(out.f, out)
        // 靠在电铲侧面
        out.x += Math.sin(out.yaw) * 55
        out.y -= Math.cos(out.yaw) * 55
        break
      case PHASE.HAUL:
        out.f = Math.min(1, s / H)
        out.moving = true
        R.at(out.f, out)
        break
      case PHASE.QUEUE_UNLOAD:
        out.f = Math.max(0, 1 - (qpos * QGAP) / len)
        R.at(out.f, out)
        break
      case PHASE.UNLOAD:
        out.f = 1
        R.at(out.f, out)
        break
      case PHASE.TO_SWAP: {
        R.at(1, out)
        const st = this.stations[this._hash(t.id) & 1]
        const k = Math.min(1, s / sim.swapM)
        const dx = st.x - out.x
        const dy = st.y - out.y
        out.x += dx * k
        out.y += dy * k
        out.yaw = Math.atan2(dy, dx)
        out.moving = true
        out.f = 1
        out.dir = 1
        break
      }
      case PHASE.QUEUE_SWAP: {
        const st = this.stations[this._hash(t.id) & 1]
        out.x = st.x - 70 * qpos - 90
        out.y = st.y - 20
        out.yaw = 0
        break
      }
      case PHASE.SWAP: {
        const st = this.stations[this._hash(t.id) & 1]
        const bay = this._hash(t.id) % 4
        out.x = st.x - 24 * 2.2 + bay * 16 * 2.2
        out.y = st.y - 60
        out.yaw = Math.PI / 2
        break
      }
      case PHASE.IDLE: {
        const k = this.index.get(t.id)
        out.x = this.park.x + (k % 10) * 130
        out.y = this.park.y - Math.floor(k / 10) * 110
        out.yaw = 0
        break
      }
      case PHASE.FAULT: {
        // 停在故障时的位置：故障前在重载行驶就沿 HAUL 的位置，否则按空载
        const u = Math.min(1, s / H)
        out.f = t.resume === PHASE.HAUL ? u : 1 - u
        out.dir = t.resume === PHASE.HAUL ? 1 : -1
        // 螺旋路线绕坑一圈，故障点可能落在被侧栏盖住的西半圈（标签和故障环都看不见）：
        // 在离原进度最近、且落在总览可见范围内的路段上找停靠点（演示取舍，只挪几百米）
        out.f = this._faultFraction(t, R, out.f)
        R.at(out.f, out)
        // 靠边停
        out.x += Math.sin(out.yaw) * 40
        out.y -= Math.cos(out.yaw) * 40
        break
      }
      default:
        R.at(0, out)
    }
    return out
  }

  /**
   * 故障车的停靠进度：沿路线在 FAULT_BOX 范围内，取离原进度最近的一点。
   * 结果按 编号 + 电铲 + 原进度 缓存，同一次故障期间位置固定。
   */
  _faultFraction(t, R, f0) {
    const key = `${t.id}|${t.loader}|${f0.toFixed(2)}`
    const hit = this._faultCache.get(key)
    if (hit != null) return hit
    let best = f0
    let bestD = Infinity
    const p = this._tmp2
    for (let f = 0.04; f <= 0.96; f += 0.01) {
      R.at(f, p)
      if (p.x < FAULT_BOX.x[0] || p.x > FAULT_BOX.x[1]) continue
      if (p.y < FAULT_BOX.y[0] || p.y > FAULT_BOX.y[1]) continue
      const d = Math.abs(f - f0)
      if (d < bestD) {
        bestD = d
        best = f
      }
    }
    this._faultCache.set(key, best)
    return best
  }

  _hash(id) {
    let h = 0
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
    return Math.abs(h)
  }

  /**
   * 每帧更新。
   * @param {object} cur 当前仿真状态（sim.at）
   * @param {object|null} prev 上一次的状态
   * @param {Map|null} prevById prev.trucks 按编号建的表（状态变化时建一次，不要每帧建）
   * @param {number} dt 距离 cur 已过去的秒数（外推用）
   * @param {string|null} selected 选中的卡车编号
   */
  update(cur, prev, prevById, dt, selected) {
    const span = prev ? Math.max(0.001, (cur.t - prev.t) / 1000) : 1
    const m4 = this._m
    const colors = this.mesh.instanceColor.array
    const cc = this.cargo.instanceColor.array
    let tv = 0
    for (let i = 0; i < this.n; i++) {
      const t = cur.trucks[i]
      // 行驶中的车用相邻两次状态的速度外推（相位没变才外推）
      let s = t.s
      const p = prevById?.get(t.id)
      if (
        p &&
        p.phase === t.phase &&
        [PHASE.EMPTY, PHASE.HAUL, PHASE.TO_SWAP].includes(t.phase) &&
        span > 0
      )
        s += ((t.s - p.s) / span) * Math.min(dt, 1.2)
      const out = this._place(t, s)
      const gy = this._ground(out.x, out.y)
      const rot = yawToRotY(out.yaw + (out.dir === -1 ? Math.PI : 0))
      this._e.set(0, rot, 0)
      this._q.setFromEuler(this._e)
      const px = out.x
      const pz = -out.y
      m4.compose(this._p.set(px, gy + 5, pz), this._q, this._s.set(SC, SC, SC))
      this.mesh.setMatrixAt(i, m4)
      // 车灯：在路上行驶、排队、装卸时亮；待命、故障、换电时灭
      const lit = ![
        PHASE.IDLE,
        PHASE.FAULT,
        PHASE.SWAP,
        PHASE.QUEUE_SWAP
      ].includes(t.phase)
      this.lamps.setMatrixAt(
        i,
        lit ? this._m2.multiplyMatrices(m4, this._lampOff) : this._zero
      )
      this.pos[i].set(px, gy + 5 + 8 * SC, pz)

      // 车身色：六类状态；选中的提亮
      // 车身偏白（运行 / 装卸 / 排队 / 换电的状态色往白里掺 55 %，仍分得出来但不再杂乱），
      // 故障 / 待命 / 选中保持强色
      const col = this._c.setHex(THEME.truckGroup[t.group])
      if (t.id === selected) col.multiplyScalar(1.8)
      else if (t.phase === PHASE.FAULT) col.multiplyScalar(1.3)
      else if (t.phase !== PHASE.IDLE) col.lerp(WHITE, 0.55)
      colors[i * 3] = col.r
      colors[i * 3 + 1] = col.g
      colors[i * 3 + 2] = col.b

      // 货物：重载时才显示，颜色按运的是煤还是剥离物
      const loaded =
        t.loaded || (t.phase === PHASE.FAULT && t.resume === PHASE.HAUL)
      const kind = this.simRoutes[t.route]?.kind === "coal" ? "coal" : "strip"
      m4.compose(
        this._p.set(px, gy + 5, pz),
        this._q,
        loaded ? this._s.set(SC, SC, SC) : this._s.set(0, 0, 0)
      )
      this.cargo.setMatrixAt(i, m4)
      const cg = this._c.setHex(CARGO[kind])
      cc[i * 3] = cg.r
      cc[i * 3 + 1] = cg.g
      cc[i * 3 + 2] = cg.b

      // 尾迹：只给在路上跑的车，沿路线向后取点
      const R = this.routes[t.loader] || this.routes["ES-01"]
      const tc = this._c.setHex(THEME.truckGroup[t.group])
      for (let k = 0; k < TRAIL; k++) {
        const a = tv * 2
        const fade = 1 - k / TRAIL
        for (let e = 0; e < 2; e++) {
          const back = (k + e) * TRAIL_STEP
          const f2 = out.dir === 1 ? out.f - back / R.len : out.f + back / R.len
          let x = out.x
          let y = out.y
          if (out.moving) {
            R.at(Math.max(0, Math.min(1, f2)), this._tmp2)
            x = this._tmp2.x
            y = this._tmp2.y
          }
          const v = (a + e) * 3
          this.trailPos[v] = x
          this.trailPos[v + 1] = this._ground(x, y) + 5 + 3 * SC
          this.trailPos[v + 2] = -y
          const w = out.moving ? fade * (e ? 0.7 : 1) * 0.9 : 0
          this.trailCol[v] = tc.r * w
          this.trailCol[v + 1] = tc.g * w
          this.trailCol[v + 2] = tc.b * w
        }
        tv++
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor.needsUpdate = true
    this.cargo.instanceMatrix.needsUpdate = true
    this.lamps.instanceMatrix.needsUpdate = true
    this.cargo.instanceColor.needsUpdate = true
    this.trails.geometry.attributes.position.needsUpdate = true
    this.trails.geometry.attributes.color.needsUpdate = true
  }

  /** 卡车编号 → 当前 three 位置（带车顶高度），没有返回 null */
  positionOf(id) {
    const i = this.index.get(id)
    return i == null ? null : this.pos[i]
  }
}

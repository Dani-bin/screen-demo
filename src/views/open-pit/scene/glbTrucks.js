/**
 * Blender 模型场景里的 100 台无人矿卡（GlbScene 用）。
 * ----------------------------------------------------------
 * 车身是 Blender 里建的 truck_template（GLB 里按材质拆成几个网格），每个网格一个 InstancedMesh 共用实例矩阵，
 * 白色车斗那一块用实例色表示状态；货物、车灯光斑、尾迹另做。
 * 位置完全由仿真状态决定：每辆车有「对应电铲」，沿那台电铲的路线（data/pit3d.json，世界坐标 x 东 / y 北 / z 上）走：
 *   空载 / 重载按 s / 运距 映射到路线的 0–1；排队按队位沿路排；换电、待命、故障各有落点。
 * 仿真一秒一更，场景用上一帧到这一帧的速度外推，让车辆连续移动。规则和旧场景 trucks.js 的 _place 一一对应。
 */
import * as THREE from "three"

import { PHASE } from "../sim/simulator.js"
import { THEME } from "./theme.js"

const WHITE = new THREE.Color(0xe8f6ff)
const QGAP = 120 // 排队时车间距 m
const TRAIL = 5 // 尾迹段数
const TRAIL_STEP = 60 // 每段 m
// 货物色压暗、降饱和：总览里车身只有十几像素，饱和的紫色货物比白色车身还显眼（第 14 轮自查）
const CARGO = { coal: 0x4a3a1c, strip: 0x3c3a4c }

/** 世界朝向角（+x 为 0，逆时针，世界 y 向北）→ 绕 three y 轴的角（前向 +z） */
const yawToRotY = (yaw) => Math.atan2(Math.cos(yaw), -Math.sin(yaw))

/** 折线（世界 x, y, z）：弧长参数化，f ∈ [0, 1] 取点和朝向 */
export class Route3 {
  constructor(pts) {
    this.pts = pts
    this.cum = [0]
    for (let i = 1; i < pts.length; i++)
      this.cum.push(
        this.cum[i - 1] +
          Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
      )
    this.len = this.cum[this.cum.length - 1] || 1
  }

  at(f, out) {
    const d = Math.min(1, Math.max(0, f)) * this.len
    let lo = 0
    let hi = this.pts.length - 1
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1
      if (this.cum[m] <= d) lo = m
      else hi = m
    }
    const a = this.pts[lo]
    const b = this.pts[hi]
    const seg = this.cum[hi] - this.cum[lo] || 1
    const t = (d - this.cum[lo]) / seg
    out.x = a[0] + (b[0] - a[0]) * t
    out.y = a[1] + (b[1] - a[1]) * t
    out.z = a[2] + (b[2] - a[2]) * t
    out.yaw = Math.atan2(b[1] - a[1], b[0] - a[0])
    out.grade = (b[2] - a[2]) / seg // 沿路线前进方向的坡度（斜坡上车身跟着仰俯）
    return out
  }
}

export class GlbTrucks {
  /**
   * @param {Array} list layout.json 里的卡车 [{id, fleet}]
   * @param {Object<string, Route3>} routes 按电铲编号
   * @param {Object} simRoutes 仿真里各编组的运距，{ "FL-A": { haul, swapM, kind }, ... }
   * @param {Array<{geometry, material, body:boolean}>} parts 车身模型的各部分（已烘进缩放，前向 +z）
   * @param {object} pit3d data/pit3d.json（设备锚点、故障车停靠点）
   */
  constructor(list, routes, simRoutes, parts, pit3d) {
    this.list = list
    this.routes = routes
    this.simRoutes = simRoutes
    this.n = list.length
    this.index = new Map(list.map((t, i) => [t.id, i]))
    this.pos = list.map(() => new THREE.Vector3())
    this.faultSpots = pit3d.faultSpots
    this.stations = ["SW-01", "SW-02"].map((id) => {
      const [x, y, z] = pit3d.anchors[id]
      return { x, y, z }
    })
    // 待命区：坑外平地上 5 列 × 4 排（pit3d.park，routes.py 的 park_origin 保证不在坑里）；
    // 原来按全部 100 台车的序号铺成 10 × 10、630 m 宽的一片，有一部分伸到坑上空，车悬在半空
    const pk = pit3d.park ?? [
      this.stations[0].x - 520,
      this.stations[0].y + 140,
      0
    ]
    this.park = { x: pk[0], y: pk[1], z: pk[2] }
    // 卸载点 → 两座换电站的行驶路线（pit3d.swapPaths）：坑底卸载的车先沿运输路线出坑，再沿坑沿绕过去
    this.swapPaths = Object.fromEntries(
      Object.entries(pit3d.swapPaths ?? {}).map(([k, v]) => [
        k,
        v.map((pts) => new Route3(pts))
      ])
    )

    // 2026-11-03 起车模（scripts/blender/open_pit/truck/）自带货堆和车灯两个部件；旧车模没有时退回下面的方块
    const cargoPart = parts.find((p) => p.cargo)
    const lampPart = parts.find((p) => p.lamp)
    this.parts = parts
      .filter((p) => !p.cargo && !p.lamp)
      .map((p) => {
        const mesh = new THREE.InstancedMesh(p.geometry, p.material, this.n)
        mesh.frustumCulled = false
        if (p.body)
          mesh.instanceColor = new THREE.InstancedBufferAttribute(
            new Float32Array(this.n * 3),
            3
          )
        return { mesh, body: p.body }
      })

    this.cargo = new THREE.InstancedMesh(
      // 货物堆在车斗上：新车模用它自己的货堆部件；旧的 cli 矿卡（车斗顶面高 6.3 m、中心在后 0.8 m，× 2.4 倍）用方块
      cargoPart?.geometry ??
        new THREE.BoxGeometry(17.3, 3.8, 18.2).translate(0, 16.6, -1.9),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      this.n
    )
    this.cargo.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.n * 3),
      3
    )
    this.cargo.frustumCulled = false

    // 车灯光斑：车头一小块很亮的灯（颜色超过 1，辉光会把它扩成光点），只给在路上跑的车亮
    this.lamps = new THREE.InstancedMesh(
      lampPart?.geometry ?? new THREE.BoxGeometry(15, 2.4, 1.6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.8, 3.0) }),
      this.n
    )
    this.lamps.frustumCulled = false
    // 车灯位置：新车模的车灯部件自带位置；旧车模的灯带在高 3.9 m、前端 6.35 m（× 2.4）
    this._lampOff = lampPart
      ? new THREE.Matrix4()
      : new THREE.Matrix4().makeTranslation(0, 9.4, 15.6)
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

    this._m = new THREE.Matrix4()
    this._q = new THREE.Quaternion()
    this._e = new THREE.Euler()
    // 第 17 轮缩到 0.85 后第 15 轮评审说车太小太暗（和上一轮「太亮像白骰子」相反），回到原大小，靠受光材质分出体积
    this._s = new THREE.Vector3(1, 1, 1)
    this._zeroS = new THREE.Vector3(0, 0, 0)
    this._p = new THREE.Vector3()
    this._c = new THREE.Color()
    this._tmp = {}
    this._tmp2 = {}
  }

  group() {
    const g = new THREE.Group()
    g.add(...this.parts.map((p) => p.mesh), this.cargo, this.lamps, this.trails)
    return g
  }

  _hash(id) {
    let h = 0
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
    return Math.abs(h)
  }

  /** 某辆车在当前状态下的世界位置与朝向：out = {x, y, z, yaw, moving, dir, f} */
  _place(t, s) {
    const R = this.routes[t.loader] || this.routes["ES-01"]
    const sim = this.simRoutes[t.route] || this.simRoutes["FL-A"]
    const H = sim.haul
    const out = this._tmp
    const len = R.len
    const qpos = Math.max(1, t.qpos || 1)
    out.moving = false
    out.path = null // 不是沿自己的运输路线走时（去换电站），尾迹沿这条路线取
    out.grade = 0 // 不在路线上的落点（换电站、待命区）是平地
    out.dir = 1 // 沿路线方向（+1 顺路线，-1 逆路线）
    out.f = 0
    switch (t.phase) {
      case PHASE.EMPTY: {
        const u = Math.min(1, s / H)
        out.f = 1 - u
        out.dir = -1
        out.moving = true
        R.at(out.f, out)
        // 刚换完电出来（电量 ≥ 94 % 且刚出发）：沿去换电站的路线倒着开回卸载点（原来是直线插值，坑底卸载的车会从半空飞过坑）
        const sp = this.swapPaths[t.loader]?.[this._hash(t.id) & 1]
        if (t.soc > 94 && u < 0.05) {
          if (sp) {
            out.f = 1 - u / 0.05
            out.path = sp
            sp.at(out.f, out)
          } else {
            const st = this.stations[this._hash(t.id) & 1]
            const k = u / 0.05
            const kk = k * k * (3 - 2 * k)
            out.x = st.x + (out.x - st.x) * kk
            out.y = st.y + (out.y - st.y) * kk
            out.z = st.z + 1 + (out.z - st.z - 1) * kk
          }
        }
        break
      }
      case PHASE.QUEUE_LOAD:
        out.f = Math.min(1, (qpos * QGAP) / len + 0.004)
        out.dir = -1
        R.at(out.f, out)
        break
      case PHASE.LOAD:
        // 停在电铲后面 55 m 的路上（原来往侧面横移 70 m，平台只有约 33 m 宽，车不是悬在陡坎外就是埋进岩壁）
        out.f = Math.min(1, 55 / len)
        R.at(out.f, out)
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
        const k = Math.min(1, s / sim.swapM)
        const sp = this.swapPaths[t.loader]?.[this._hash(t.id) & 1]
        out.moving = true
        out.dir = 1
        if (sp) {
          out.f = k
          out.path = sp
          sp.at(k, out)
          break
        }
        R.at(1, out)
        const st = this.stations[this._hash(t.id) & 1]
        const dx = st.x - out.x
        const dy = st.y - 60 - out.y
        out.x += dx * k
        out.y += dy * k
        out.z = out.z + (st.z + 1 - out.z) * k
        out.yaw = Math.atan2(dy, dx)
        out.f = 1
        break
      }
      case PHASE.QUEUE_SWAP: {
        // 沿去换电站的路线往回排队（原来往西排成一列，排长了会伸到坑上空）
        const sp = this.swapPaths[t.loader]?.[this._hash(t.id) & 1]
        if (sp) {
          out.f = Math.max(0, 1 - (60 * qpos + 90) / sp.len)
          sp.at(out.f, out)
          break
        }
        const st = this.stations[this._hash(t.id) & 1]
        out.x = st.x - 60 * qpos - 90
        out.y = st.y - 60
        out.z = st.z + 1
        out.yaw = 0
        break
      }
      case PHASE.SWAP: {
        const st = this.stations[this._hash(t.id) & 1]
        const bay = this._hash(t.id) % 3
        out.x = st.x - 36 + bay * 36
        out.y = st.y - 52
        out.z = st.z + 1
        out.yaw = Math.PI / 2
        break
      }
      case PHASE.IDLE: {
        const k = this.index.get(t.id) % 20
        out.x = this.park.x + (k % 5) * 70
        out.y = this.park.y - Math.floor(k / 5) * 60
        out.z = this.park.z + 1
        out.yaw = 0
        break
      }
      case PHASE.FAULT: {
        const spot = this.faultSpots[t.id]
        if (spot) {
          out.x = spot[0]
          out.y = spot[1]
          out.z = spot[2] + 1
          out.yaw = 0
        } else {
          // 没有指定停靠点的故障车：停在故障时的位置（重载行驶沿 HAUL 的位置，否则按空载）
          const u = Math.min(1, s / H)
          out.f = t.resume === PHASE.HAUL ? u : 1 - u
          out.dir = t.resume === PHASE.HAUL ? 1 : -1
          R.at(out.f, out)
        }
        break
      }
      default:
        R.at(0, out)
    }
    return out
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
      const rot = yawToRotY(out.yaw + (out.dir === -1 ? Math.PI : 0))
      // 车头朝 +z：绕自身 x 轴转负角是车头抬起；逆路线行驶时坡度反号（斜坡约 14 %，原来车身是平的、半截埋进坡里）
      this._e.set(-Math.atan((out.grade || 0) * out.dir), rot, 0, "YXZ")
      this._q.setFromEuler(this._e)
      m4.compose(this._p.set(out.x, out.z, -out.y), this._q, this._s)
      for (const part of this.parts) part.mesh.setMatrixAt(i, m4)
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
      this.pos[i].set(out.x, out.z + 14, -out.y)

      // 车斗色：六类状态；偏白（状态色往白里掺 55 %，仍分得出来但不杂乱），故障 / 待命 / 选中保持强色
      const col = this._c.setHex(THEME.truckGroup[t.group])
      if (t.id === selected) col.multiplyScalar(1.8)
      else if (t.phase === PHASE.FAULT) col.multiplyScalar(1.3)
      // 第 13 轮评审：大部分车在排队 / 换电，掺白 55 % 后一片淡紫；车身改成白灰（掺 88 %），状态只留一点色调
      else if (t.phase !== PHASE.IDLE) col.lerp(WHITE, 0.88)
      for (const part of this.parts) {
        if (!part.body) continue
        const arr = part.mesh.instanceColor.array
        arr[i * 3] = col.r
        arr[i * 3 + 1] = col.g
        arr[i * 3 + 2] = col.b
      }

      // 货物：重载时才显示，颜色按运的是煤还是剥离物
      const loaded =
        t.loaded || (t.phase === PHASE.FAULT && t.resume === PHASE.HAUL)
      const kind = this.simRoutes[t.route]?.kind === "coal" ? "coal" : "strip"
      m4.compose(this._p, this._q, loaded ? this._s : this._zeroS)
      this.cargo.setMatrixAt(i, m4)
      const cg = this._c.setHex(CARGO[kind])
      cc[i * 3] = cg.r
      cc[i * 3 + 1] = cg.g
      cc[i * 3 + 2] = cg.b

      // 尾迹：只给在路上跑的车，沿路线向后取点
      const R = out.path || this.routes[t.loader] || this.routes["ES-01"]
      const tc = this._c.setHex(THEME.truckGroup[t.group])
      for (let k = 0; k < TRAIL; k++) {
        const a = tv * 2
        const fade = 1 - k / TRAIL
        for (let e = 0; e < 2; e++) {
          const back = (k + e) * TRAIL_STEP
          const f2 = out.dir === 1 ? out.f - back / R.len : out.f + back / R.len
          let x = out.x
          let y = out.y
          let z = out.z
          if (out.moving) {
            R.at(f2, this._tmp2)
            x = this._tmp2.x
            y = this._tmp2.y
            z = this._tmp2.z
          }
          const v = (a + e) * 3
          this.trailPos[v] = x
          this.trailPos[v + 1] = z + 8
          this.trailPos[v + 2] = -y
          const w = out.moving ? fade * (e ? 0.7 : 1) * 0.5 : 0
          this.trailCol[v] = tc.r * w
          this.trailCol[v + 1] = tc.g * w
          this.trailCol[v + 2] = tc.b * w
        }
        tv++
      }
    }
    for (const part of this.parts) {
      part.mesh.instanceMatrix.needsUpdate = true
      if (part.body) part.mesh.instanceColor.needsUpdate = true
    }
    this.cargo.instanceMatrix.needsUpdate = true
    this.cargo.instanceColor.needsUpdate = true
    this.lamps.instanceMatrix.needsUpdate = true
    this.trails.geometry.attributes.position.needsUpdate = true
    this.trails.geometry.attributes.color.needsUpdate = true
  }

  /** 卡车编号 → 当前 three 位置（带车顶高度），没有返回 null */
  positionOf(id) {
    const i = this.index.get(id)
    return i == null ? null : this.pos[i]
  }
}

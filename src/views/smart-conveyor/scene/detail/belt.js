/*
 * 第 2 级：单条皮带的局部模型（真实尺度）
 * ----------------------------------------------------------
 * 以里程 center 为中心、前后 half 米的一段：
 *   - 半剖巷道（只留后半边和底板，镜头从剖开的一侧看进去），顶灯
 *   - 机架（立柱每 3 m、纵梁）、承载托辊组（三节槽形 35°，间距按 layout.carry）、回程托辊（间距 layout.ret）
 *   - 槽形输送带 + 回程带；煤块按带速移动、按沿线煤量疏密
 *   - 光纤测温：贴在后侧纵梁上的发光色带，每米一个颜色（sim.dts）
 *   - 急停拉绳和急停开关、跑偏开关、托辊温速传感器、摄像机（含视锥）、环境监测分站
 *   - 吊轨机器人（轨道 + 机器人当前位置）、沿线人员
 *   - 正在劣化的托辊：发热着色 + 光晕 + 听诊声波圈
 *   - 窗口包含机头时画驱动部（滚筒 + 电机 / 减速机），点它进入第 3 级
 * 局部坐标：x = 里程 − center（沿走向），y 向上，z 朝镜头；整组按皮带倾角绕 z 轴转。
 * 每秒 update(s, w)；每帧 tick(dt, t)；labels() 给页面投影 DOM 标签；pick() 拾取托辊 / 驱动部。
 */
import * as THREE from "three"
import { TOKENS, LEVEL_COLOR } from "../theme.js"
import {
  DETAIL_ORIGIN,
  mats,
  rockMaterial,
  ROLLER_R,
  label,
  tempColor
} from "./common.js"

const DEG = Math.PI / 180
const TROUGH = 35 * DEG

/** 沿 z 轴的托辊几何（托辊轴线垂直于走向） */
function rollerZ(len) {
  const g = new THREE.CylinderGeometry(ROLLER_R, ROLLER_R, len, 14, 1)
  g.rotateX(Math.PI / 2)
  return g
}

/** 沿 x 方向挤出一个横截面（z, y 点列），得到一条长条网格 */
function extrudeX(profile, x0, x1, segs = 1) {
  const pos = []
  const idx = []
  const n = profile.length
  for (let j = 0; j <= segs; j++) {
    const x = x0 + ((x1 - x0) * j) / segs
    for (const [z, y] of profile) pos.push(x, y, z)
  }
  for (let j = 0; j < segs; j++)
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i
      const b = a + n
      idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

export class BeltDetail {
  /**
   * @param {object} o
   * @param {object} o.layout layout.json
   * @param {string} o.belt 皮带编号
   * @param {number} o.center 中心里程（m）
   * @param {number} [o.half] 半窗口长度（m）
   */
  constructor({ layout, belt, center, half = 60 }) {
    const b = layout.belts.find((x) => x.id === belt)
    this.b = b
    this.layout = layout
    this.center = Math.max(0, Math.min(b.L, center))
    this.c0 = Math.max(0, this.center - half)
    this.c1 = Math.min(b.L, this.center + half)
    const x0 = this.c0 - this.center
    const x1 = this.c1 - this.center
    this.x0 = x0
    this.x1 = x1
    const M = (this.m = mats())
    const root = (this.group = new THREE.Group())
    root.position.copy(DETAIL_ORIGIN)
    // 倾斜：主斜井上运、上山下运，整组绕 z 轴转（剖面里看得出坡度）
    const tilt = new THREE.Group()
    tilt.rotation.z = (b.angle || 0) * DEG
    root.add(tilt)
    this.tilt = tilt

    // ---------- 尺寸
    const B = b.B / 1000 // 带宽
    const rw = b.roadway?.w || 5.2
    const rh = b.roadway?.h || 4
    const r = rw / 2
    const hw = Math.max(1.2, rh - r) // 直墙高
    const zc = -0.55 // 输送机中心（靠后帮，人行道在前侧）
    const yc = 1.05 // 中托辊顶面高度
    const lc = 0.38 * B // 中托辊长
    const lw = 0.38 * B // 边托辊长
    Object.assign(this, { B, rw, rh, zc, yc, lc, lw })

    // ---------- 巷道（只留后半边 + 全宽底板）
    const prof = []
    prof.push([r, 0], [-r, 0], [-r, hw])
    for (let a = 180; a >= 70; a -= 10)
      prof.push([r * Math.cos(a * DEG), hw + r * Math.sin(a * DEG)])
    const tunnel = new THREE.Mesh(
      extrudeX(prof, x0 - 2, x1 + 2),
      rockMaterial()
    )
    tilt.add(tunnel)

    // ---------- 顶灯（每 8 m 一盏发光体；中心附近几盏真点光源）
    const lampGeo = new THREE.BoxGeometry(0.5, 0.06, 0.16)
    for (let x = Math.ceil(x0 / 8) * 8; x <= x1; x += 8) {
      const l = new THREE.Mesh(lampGeo, M.lamp)
      l.position.set(x, rh - 0.25, 0.1)
      tilt.add(l)
      if (Math.abs(x) <= 32) {
        const pl = new THREE.PointLight("#ffd9a8", 40, 22, 1.2)
        pl.position.set(x, rh - 0.5, 0.4)
        tilt.add(pl)
      }
    }

    // 巷道里的整体补光（冷色天光 + 暖色地光），只在下钻时存在
    tilt.add(new THREE.HemisphereLight("#9db8d6", "#3a2a18", 1.4))

    // ---------- 机架：纵梁 + 立柱（每 3 m）
    const len = x1 - x0
    const stringerGeo = new THREE.BoxGeometry(len, 0.14, 0.08)
    for (const side of [-1, 1]) {
      const s = new THREE.Mesh(stringerGeo, M.steelDark)
      s.position.set((x0 + x1) / 2, yc - 0.32, zc + side * (B / 2 + 0.22))
      tilt.add(s)
    }
    const legGeo = new THREE.BoxGeometry(0.08, yc - 0.3, 0.08)
    legGeo.translate(0, (yc - 0.3) / 2, 0)
    const nLeg = Math.floor(len / 3) + 1
    const legs = new THREE.InstancedMesh(legGeo, M.steelDark, nLeg * 2)
    const mm = new THREE.Matrix4()
    let k = 0
    for (let i = 0; i < nLeg; i++)
      for (const side of [-1, 1]) {
        mm.makeTranslation(x0 + i * 3, 0, zc + side * (B / 2 + 0.22))
        legs.setMatrixAt(k++, mm)
      }
    tilt.add(legs)

    // ---------- 承载托辊组：中托辊 + 两边托辊（35°），托架
    const carry = b.carry || 1.2
    const sets = []
    for (let c = Math.ceil(this.c0 / carry) * carry; c <= this.c1; c += carry)
      sets.push(c)
    this.sets = sets
    const nS = sets.length
    const cGeo = rollerZ(lc)
    const wGeo = rollerZ(lw)
    const rollers = new THREE.InstancedMesh(cGeo, M.roller, nS)
    const wingsL = new THREE.InstancedMesh(wGeo, M.roller, nS)
    const wingsR = new THREE.InstancedMesh(wGeo, M.roller, nS)
    const bracket = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.06, 0.06, B + 0.34),
      M.paint,
      nS
    )
    const q = new THREE.Quaternion()
    const qL = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      TROUGH
    )
    const qR = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      -TROUGH
    )
    const one = new THREE.Vector3(1, 1, 1)
    // 边托辊中心（z 偏移、y 抬高）
    const wz = lc / 2 + (lw / 2) * Math.cos(TROUGH) + 0.02
    const wy = (lw / 2) * Math.sin(TROUGH)
    this.rollerPos = (set, roll) => {
      const x = set * carry - this.center
      if (roll === "C") return new THREE.Vector3(x, yc - ROLLER_R, zc)
      const s = roll === "L" ? 1 : -1 // L 在镜头一侧（+z）
      return new THREE.Vector3(x, yc - ROLLER_R + wy, zc + s * wz)
    }
    sets.forEach((c, i) => {
      const x = c - this.center
      mm.compose(new THREE.Vector3(x, yc - ROLLER_R, zc), q, one)
      rollers.setMatrixAt(i, mm)
      mm.compose(new THREE.Vector3(x, yc - ROLLER_R + wy, zc + wz), qR, one)
      wingsL.setMatrixAt(i, mm)
      mm.compose(new THREE.Vector3(x, yc - ROLLER_R + wy, zc - wz), qL, one)
      wingsR.setMatrixAt(i, mm)
      mm.makeTranslation(x, yc - 0.24, zc)
      bracket.setMatrixAt(i, mm)
    })
    tilt.add(rollers, wingsL, wingsR, bracket)
    this.rollerMeshes = [rollers, wingsL, wingsR]

    // ---------- 回程托辊
    const ret = b.ret || 3
    const rets = []
    for (let c = Math.ceil(this.c0 / ret) * ret; c <= this.c1; c += ret)
      rets.push(c)
    const retM = new THREE.InstancedMesh(
      rollerZ(B + 0.1),
      M.roller,
      rets.length
    )
    rets.forEach((c, i) => {
      mm.makeTranslation(c - this.center, 0.3, zc)
      retM.setMatrixAt(i, mm)
    })
    tilt.add(retM)

    // ---------- 输送带：槽形承载段 + 平的回程段
    const t = 0.025 // 带面比托辊顶面高一点（带厚 + 间隙）
    // 带面截面：中段平、两翼按托辊的 35° 槽角上翘（翼长 = 边托辊长 + 余量），整体比托辊顶面高 t，
    // 两翼坡度必须和边托辊一致，否则边托辊外端会从带面里戳出来
    const wing = lw + 0.1
    const beltProf = [
      [zc - lc / 2 - wing * Math.cos(TROUGH), yc + t + wing * Math.sin(TROUGH)],
      [zc - lc / 2, yc + t],
      [zc + lc / 2, yc + t],
      [zc + lc / 2 + wing * Math.cos(TROUGH), yc + t + wing * Math.sin(TROUGH)]
    ]
    const carryBelt = new THREE.Mesh(extrudeX(beltProf, x0, x1), M.rubber)
    carryBelt.material.side = THREE.DoubleSide
    tilt.add(carryBelt)
    const retBelt = new THREE.Mesh(
      extrudeX(
        [
          [zc - B / 2, 0.3 + ROLLER_R + 0.01],
          [zc + B / 2, 0.3 + ROLLER_R + 0.01]
        ],
        x0,
        x1
      ),
      M.rubber
    )
    tilt.add(retBelt)

    // ---------- 煤：实例化的煤块，按带速沿 x 移动（循环），按沿线煤量疏密
    const N = Math.round(len * 9)
    const lumpGeo = new THREE.DodecahedronGeometry(1, 0)
    this.lumps = new THREE.InstancedMesh(lumpGeo, M.coal, N)
    let seed = 11
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280
    this.lumpData = Array.from({ length: N }, () => {
      const across = (rnd() - 0.5) * 2 // −1…1
      return {
        u: rnd(),
        across,
        s: 0.035 + 0.09 * rnd() ** 2,
        rot: rnd() * 6,
        keep: rnd()
      }
    })
    this.lumps.frustumCulled = false
    tilt.add(this.lumps)
    this.travel = 0
    this.v = 0
    this.vTarget = 0
    this.density = new Float32Array(Math.ceil(len) + 1).fill(0.5)

    // ---------- 光纤测温色带（后侧纵梁上，每米 2 个顶点，颜色每 10 s 更新）
    const nm = Math.ceil(len) + 1
    const dPos = []
    const dIdx = []
    for (let i = 0; i < nm; i++) {
      const x = x0 + i
      dPos.push(
        x,
        yc - 0.26,
        zc - B / 2 - 0.27,
        x,
        yc - 0.16,
        zc - B / 2 - 0.27
      )
      if (i) dIdx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i)
    }
    const dGeo = new THREE.BufferGeometry()
    dGeo.setAttribute("position", new THREE.Float32BufferAttribute(dPos, 3))
    dGeo.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(new Float32Array(nm * 6).fill(0.3), 3)
    )
    dGeo.setIndex(dIdx)
    this.dts = new THREE.Mesh(
      dGeo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        toneMapped: false
      })
    )
    tilt.add(this.dts)

    // ---------- 急停拉绳（人行道侧）+ 急停开关、跑偏开关
    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, len, 6),
      M.yellow
    )
    cord.rotation.z = Math.PI / 2
    cord.position.set((x0 + x1) / 2, yc + 0.18, zc + B / 2 + 0.42)
    tilt.add(cord)
    const devIn = (kind) =>
      layout.devices.filter(
        (d) =>
          d.belt === belt &&
          d.kind === kind &&
          typeof d.chainage === "number" &&
          d.chainage >= this.c0 &&
          d.chainage <= this.c1
      )
    this.labelList = []
    for (const d of devIn("protEstop")) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.24, 0.12),
        M.yellow
      )
      box.position.set(d.chainage - this.center, yc + 0.1, zc + B / 2 + 0.42)
      tilt.add(box)
      this.labelList.push(label(d.id, box, "estop", { name: "急停开关" }))
    }
    for (const d of devIn("protDeviation"))
      for (const side of [-1, 1]) {
        const sw = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10),
          M.paint
        )
        sw.position.set(
          d.chainage - this.center,
          yc + 0.22,
          zc + side * (B / 2 + 0.12)
        )
        tilt.add(sw)
        if (side > 0)
          this.labelList.push(label(d.id, sw, "dev", { name: "跑偏开关" }))
      }
    // 托辊温速传感器
    for (const d of devIn("idlerSensor")) {
      const p = this.rollerPos(d.set, d.roll)
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.1), M.cyan)
      box.position
        .copy(p)
        .add(
          new THREE.Vector3(
            0,
            -0.12,
            d.roll === "L" ? 0.3 : d.roll === "R" ? -0.3 : 0
          )
        )
      tilt.add(box)
      this.labelList.push(label(d.id, box, "idler", { name: "托辊温速" }))
    }
    // 摄像机 + 视锥
    for (const d of devIn("camera")) {
      const g = new THREE.Group()
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.16, 0.16),
        M.steel
      )
      const lens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.06, 12),
        M.cyan
      )
      lens.rotation.z = Math.PI / 2
      lens.position.x = -0.18
      g.add(body, lens)
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(1.6, 4.5, 24, 1, true),
        new THREE.MeshBasicMaterial({
          color: TOKENS.data,
          transparent: true,
          opacity: 0.06,
          depthWrite: false,
          side: THREE.DoubleSide
        })
      )
      cone.rotation.z = -Math.PI / 2 - 0.45
      cone.position.set(-2.1, -1.0, 0)
      g.add(cone)
      g.position.set(d.chainage - this.center, rh - 0.6, zc + 0.2)
      tilt.add(g)
      this.labelList.push(label(d.id, g, "camera", { name: d.use }))
    }
    // X 光钢丝绳芯检测箱：骑在承载段和回程段外面的门形箱体（射线源在上、探测板在回程带下）
    for (const d of devIn("xray")) {
      const g = new THREE.Group()
      const box = new THREE.MeshStandardMaterial({
        color: "#7d8791",
        roughness: 0.5,
        metalness: 0.4
      })
      const w = B + 0.7
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, w), box)
      top.position.y = yc + 0.85
      const bot = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, w), box)
      bot.position.y = 0.12
      g.add(top, bot)
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.9, yc + 0.85, 0.12),
          box
        )
        post.position.set(0, (yc + 0.85) / 2, side * (w / 2))
        g.add(post)
      }
      // 射线扇面（淡青，横跨带宽）
      const fanW = new THREE.Mesh(
        new THREE.PlaneGeometry(B, yc + 0.6),
        new THREE.MeshBasicMaterial({
          color: TOKENS.data,
          transparent: true,
          opacity: 0.08,
          depthWrite: false,
          side: THREE.DoubleSide
        })
      )
      fanW.rotation.y = Math.PI / 2
      fanW.position.y = (yc + 0.6) / 2 + 0.2
      g.add(fanW)
      g.position.set(d.chainage - this.center, 0, zc)
      tilt.add(g)
      this.labelList.push(
        label(d.id, top, "xray", { name: "X 光钢丝绳芯检测" })
      )
    }
    // 纵撕激光：受料点下游、回程带下的激光发射器 + 一道红色扫描线
    for (const d of devIn("tearLaser")) {
      const g = new THREE.Group()
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(0.25, 0.14, 0.2),
        M.steel
      )
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(0.01, 0.005, B),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color("#ff3355").multiplyScalar(2.5),
          toneMapped: false
        })
      )
      beam.position.y = 0.32 + ROLLER_R
      g.add(head, beam)
      g.position.set(d.chainage - this.center, 0.12, zc)
      head.position.y = 0
      tilt.add(g)
      this.labelList.push(label(d.id, head, "laser", { name: "激光纵撕检测" }))
    }
    // 环境监测分站（后帮墙上）
    for (const d of devIn("env")) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.46, 0.14),
        M.steelDark
      )
      box.position.set(d.chainage - this.center, 1.7, -r + 0.12)
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.12), M.cyan)
      scr.position.set(0, 0.08, 0.075)
      box.add(scr)
      tilt.add(box)
      this.labelList.push(label(d.id, box, "env", { name: "环境监测" }))
    }

    // ---------- 吊轨机器人：轨道 + 机器人
    const rail = layout.devices.find(
      (d) => d.kind === "robotRail" && d.belt === belt
    )
    this.robot = null
    if (rail) {
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(len, 0.14, 0.1),
        M.steel
      )
      beam.position.set((x0 + x1) / 2, rh - 0.55, 0.75)
      tilt.add(beam)
      const rb = new THREE.Group()
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.42, 0.34),
        new THREE.MeshStandardMaterial({
          color: "#d9dde2",
          roughness: 0.4,
          metalness: 0.3
        })
      )
      body.position.y = -0.35
      const eye = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.08, 0.22),
        M.cyan
      )
      eye.position.set(-0.31, -0.35, 0)
      rb.add(body, eye)
      rb.position.set(0, rh - 0.55, 0.75)
      tilt.add(rb)
      this.robot = { id: rail.id, g: rb }
      this.labelList.push(
        label(rail.id, rb, "robot", { name: "吊轨巡检机器人" })
      )
    }

    // ---------- 驱动部（窗口包含机头时）
    this.drive = null
    if (b.L - this.c1 < 1) {
      const g = new THREE.Group()
      const xh = b.L - this.center
      const pulley = new THREE.Mesh(
        new THREE.CylinderGeometry(0.62, 0.62, B + 0.2, 28),
        M.steelDark
      )
      pulley.rotation.x = Math.PI / 2
      pulley.position.set(xh, yc + 0.2, zc)
      g.add(pulley)
      b.drives.forEach((dv, i) => {
        const m = new THREE.Mesh(
          new THREE.CylinderGeometry(0.42, 0.42, 1.3, 20),
          new THREE.MeshStandardMaterial({
            color: "#2f6e8f",
            roughness: 0.5,
            metalness: 0.5
          })
        )
        m.rotation.x = Math.PI / 2
        m.position.set(xh - 3 - i * 2.2, 0.6, zc + B / 2 + 1.6)
        const red = new THREE.Mesh(
          new THREE.BoxGeometry(1.0, 0.9, 0.9),
          M.paint
        )
        red.position.set(xh - 3 - i * 2.2, 0.55, zc + B / 2 + 0.6)
        g.add(m, red)
      })
      tilt.add(g)
      this.drive = g
      this.labelList.push(
        label("DRIVE", pulley, "drive", { name: "驱动部 · 点击拆解查看" })
      )
    }

    // ---------- 劣化托辊：发热着色 + 光晕 + 声波圈（每秒按仿真更新）
    this.faults = new Map() // track id → { mesh, halo, rings, tr }
    this.people = new Map()
    this.rings = []
  }

  /** 每秒：带速、沿线煤量、测温色带、机器人、人员、劣化托辊 */
  update(s, w) {
    const id = this.b.id
    const st = s.belts[id]
    this.vTarget = st.v
    // 沿线煤量（w.profile 每 10 m 一个 kg/m）→ 窗口内每米的装载 0…1
    const prof = w.profile?.[id]
    const qFull = this.b.Q / (3.6 * this.b.v)
    if (prof)
      for (let i = 0; i < this.density.length; i++) {
        const c = this.c0 + i
        const v = prof[Math.min(prof.length - 1, Math.floor(c / 10))] || 0
        this.density[i] = Math.min(1, v / qFull)
      }
    // 光纤测温色带
    const T = w.dts?.[id]
    if (T) {
      let sum = 0
      let lo = Infinity
      for (const v of T) {
        sum += v
        if (v < lo) lo = v
      }
      const avg = sum / T.length
      const col = this.dts.geometry.attributes.color
      const c = new THREE.Color()
      for (let i = 0; i * 2 < col.count; i++) {
        const v = T[Math.min(T.length - 1, Math.round(this.c0 + i))]
        tempColor(v, lo, avg, c).multiplyScalar(2.4)
        col.setXYZ(2 * i, c.r, c.g, c.b)
        col.setXYZ(2 * i + 1, c.r, c.g, c.b)
      }
      col.needsUpdate = true
      this.dts.visible = true
    } else this.dts.visible = false
    // 吊轨机器人
    if (this.robot) {
      const r = s.robots[this.robot.id]
      const x = r.pos - this.center
      this.robot.g.visible = x >= this.x0 && x <= this.x1
      this.robot.g.position.x = Math.max(this.x0, Math.min(this.x1, x))
      this.robot.state = r
    }
    // 人员（沿人行道）
    const seen = new Set()
    for (const p of s.people) {
      if (p.belt !== id || p.chainage == null) continue
      const x = p.chainage - this.center
      if (x < this.x0 || x > this.x1) continue
      seen.add(p.id)
      let g = this.people.get(p.id)
      if (!g) {
        g = new THREE.Group()
        const suit = new THREE.MeshStandardMaterial({
          color: "#1f3a5f",
          roughness: 0.8
        })
        const refl = new THREE.MeshBasicMaterial({
          color: new THREE.Color("#ffb23e").multiplyScalar(1.6),
          toneMapped: false
        })
        const body = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.2, 0.9, 4, 10),
          suit
        )
        body.position.y = 0.75
        const band = new THREE.Mesh(
          new THREE.CylinderGeometry(0.21, 0.21, 0.06, 12),
          refl
        )
        band.position.y = 0.9
        const head = new THREE.Mesh(
          new THREE.SphereGeometry(0.14, 12, 10),
          new THREE.MeshStandardMaterial({ color: "#f2c200", roughness: 0.4 })
        )
        head.position.y = 1.55
        const lamp = new THREE.Mesh(
          new THREE.SphereGeometry(0.04, 8, 6),
          new THREE.MeshBasicMaterial({
            color: new THREE.Color("#fff3c4").multiplyScalar(3),
            toneMapped: false
          })
        )
        lamp.position.set(-0.13, 1.58, 0)
        g.add(body, band, head, lamp)
        this.tilt.add(g)
        this.people.set(p.id, g)
        this.labelList.push(
          label(p.id, g, "person", { name: `${p.role} ${p.name}` })
        )
      }
      g.position.set(x, 0, 1.5)
    }
    for (const [pid, g] of this.people)
      if (!seen.has(pid)) {
        this.tilt.remove(g)
        this.people.delete(pid)
        this.labelList = this.labelList.filter((l) => l.id !== pid)
      }
    // 劣化托辊
    const live = new Set()
    for (const tr of s.tracks) {
      if (tr.kind !== "idlerBearing" || tr.belt !== id) continue
      if (tr.chainage < this.c0 || tr.chainage > this.c1) continue
      live.add(tr.id)
      let f = this.faults.get(tr.id)
      if (!f) {
        const len = tr.roll === "C" ? this.lc : this.lw
        const mat = new THREE.MeshStandardMaterial({
          color: "#a0a8b0",
          roughness: 0.35,
          metalness: 0.8,
          emissive: TOKENS.coal2,
          emissiveIntensity: 0
        })
        const mesh = new THREE.Mesh(rollerZ(len + 0.004), mat)
        mesh.scale.set(1.04, 1.04, 1)
        const p = this.rollerPos(tr.set, tr.roll)
        mesh.position.copy(p)
        if (tr.roll !== "C")
          mesh.rotation.x = tr.roll === "L" ? -TROUGH : TROUGH
        const halo = new THREE.Mesh(
          new THREE.SphereGeometry(0.5, 16, 12),
          new THREE.MeshBasicMaterial({
            color: TOKENS.predict,
            transparent: true,
            opacity: 0.18,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false
          })
        )
        halo.position.copy(p)
        const rings = []
        for (let i = 0; i < 3; i++) {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(1, 0.012, 6, 48),
            new THREE.MeshBasicMaterial({
              color: new THREE.Color(TOKENS.predict).multiplyScalar(1.8),
              transparent: true,
              depthWrite: false,
              toneMapped: false
            })
          )
          ring.position.copy(p)
          ring.rotation.y = Math.PI / 2
          ring.userData.phase = i / 3
          rings.push(ring)
          this.tilt.add(ring)
        }
        mesh.userData.pick = { kind: "idler", track: tr.id }
        this.tilt.add(mesh, halo)
        f = { mesh, halo, rings, tr }
        this.faults.set(tr.id, f)
        this.labelList.push(label(tr.id, mesh, "fault", { name: tr.where }))
      }
      f.tr = tr
      // 严重度 → 发热颜色（琥珀 → 红）
      const sev = tr.s
      f.mesh.material.emissive.set(sev >= 0.7 ? LEVEL_COLOR[1] : TOKENS.coal2)
      f.mesh.material.emissiveIntensity = 0.4 + 2.2 * sev
      f.halo.scale.setScalar(0.6 + 1.2 * sev)
      f.halo.material.color.set(sev >= 0.7 ? LEVEL_COLOR[1] : TOKENS.predict)
    }
    for (const [tid, f] of this.faults)
      if (!live.has(tid)) {
        this.tilt.remove(f.mesh, f.halo, ...f.rings)
        this.faults.delete(tid)
        this.labelList = this.labelList.filter((l) => l.id !== tid)
      }
  }

  /** 每帧：带速缓动、煤块移动、声波圈扩散 */
  tick(dt, t) {
    this.v += (this.vTarget - this.v) * (1 - Math.exp(-dt * 3))
    this.travel += this.v * dt
    const len = this.x1 - this.x0
    const mm = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const sc = new THREE.Vector3()
    const p = new THREE.Vector3()
    const { zc, yc, lc } = this
    this.lumpData.forEach((d, i) => {
      const x = this.x0 + ((d.u * len + this.travel) % len)
      const dens =
        this.density[
          Math.max(
            0,
            Math.min(this.density.length - 1, Math.round(x - this.x0))
          )
        ]
      // 装载率决定这一处显示多少煤块（keep 小于装载率才显示）
      const show = d.keep < dens * 1.1
      const s = show ? d.s : 0.0001
      // 煤堆截面：中间高、两边低（槽形里的抛物线堆）
      const a = d.across * (lc / 2 + 0.25)
      const h = 0.03 + 0.2 * dens * (1 - d.across * d.across)
      p.set(x, yc + h + Math.abs(a) * 0.35, zc + a)
      e.set(d.rot, d.rot * 1.7, d.rot * 0.6)
      q.setFromEuler(e)
      sc.set(s, s * 0.75, s)
      mm.compose(p, q, sc)
      this.lumps.setMatrixAt(i, mm)
    })
    this.lumps.instanceMatrix.needsUpdate = true
    for (const f of this.faults.values()) {
      const sev = f.tr.s
      for (const r of f.rings) {
        const k = (t * 0.6 + r.userData.phase) % 1
        r.scale.setScalar(0.2 + 1.6 * k)
        r.material.opacity = (1 - k) * Math.min(1, sev * 1.3)
      }
      f.halo.material.opacity = 0.12 + 0.08 * Math.sin(t * 3)
    }
  }

  /** 镜头默认看的点（世界坐标） */
  focus() {
    return this.tilt.localToWorld(new THREE.Vector3(0, 1.1, this.zc))
  }

  /** 默认机位相对焦点的偏移：前上方斜看，跟着皮带倾角转（斜井、上山里镜头也顺着坡） */
  camOffset() {
    return new THREE.Vector3(6.5, 3.4, 8.5).applyAxisAngle(
      new THREE.Vector3(0, 0, 1),
      this.tilt.rotation.z
    )
  }

  /** DOM 标签：返回 [{ id, kind, name, pos(世界坐标) }] */
  labels() {
    return this.labelList.map((l) => ({
      ...l,
      pos: l.pos.getWorldPosition
        ? l.pos.getWorldPosition(new THREE.Vector3())
        : l.pos
    }))
  }

  /** 拾取：劣化托辊 → 托辊特写；驱动部 → 驱动部拆解 */
  pick(raycaster) {
    const targets = [...[...this.faults.values()].map((f) => f.mesh)]
    if (this.drive) targets.push(this.drive)
    const hit = raycaster.intersectObjects(targets, true)[0]
    if (!hit) return null
    for (let o = hit.object; o; o = o.parent) {
      if (o.userData.pick) return o.userData.pick
      if (o === this.drive) return { kind: "drive" }
    }
    return null
  }

  dispose() {
    this.group.traverse((o) => {
      o.geometry?.dispose?.()
      const m = o.material
      for (const x of Array.isArray(m) ? m : m ? [m] : []) x.dispose?.()
    })
  }
}

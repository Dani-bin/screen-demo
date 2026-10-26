/*
 * 第 3 级：部件特写（真实尺度）
 * ----------------------------------------------------------
 * IdlerPart：一组槽形托辊（中 + 两边）+ 托架 + 一段输送带。劣化的那只托辊：
 *   表面温度沿轴向渐变（轴承端最热）、发热光晕、听诊声波圈；轴承从辊端拆出（外圈 / 滚珠 / 内圈），外圈上一道剥落痕
 * DrivePart：一套驱动（电机 → 联轴器 → 减速机 → 传动滚筒）在底座上，进入时沿轴向拆开（爆炸图），
 *   劣化部位（电机轴承驱动端 / 非驱动端、减速机、滚筒）发光；各部件挂读数标签
 * 两者都提供 update(s) / tick(dt, t) / labels() / focus() / dispose()，用法和 BeltDetail 一样。
 */
import * as THREE from "three"
import { TOKENS, LEVEL_COLOR } from "../theme.js"
import { DETAIL_ORIGIN, mats, ROLLER_R, label } from "./common.js"

const DEG = Math.PI / 180

/* ================================================================ 托辊组特写 */
export class IdlerPart {
  /**
   * @param {object} o
   * @param {object} o.belt layout 里的皮带
   * @param {object} o.track 劣化过程（sim 的 track，含 set / roll）
   */
  constructor({ belt, track }) {
    this.track = track
    this.belt = belt
    const M = (this.m = mats())
    const g = (this.group = new THREE.Group())
    g.position.copy(DETAIL_ORIGIN)
    const B = belt.B / 1000
    const lc = 0.38 * B
    const lw = 0.38 * B
    const T = 35 * DEG
    const wz = lc / 2 + (lw / 2) * Math.cos(T) + 0.02
    const wy = (lw / 2) * Math.sin(T)
    const roll = track.roll || "C"

    // 托辊表面温度：轴向渐变（中间凉、两端轴承处热），劣化端更热
    this.heatMat = new THREE.ShaderMaterial({
      uniforms: {
        uSev: { value: track.s },
        uTime: { value: 0 },
        uHot: { value: new THREE.Color(LEVEL_COLOR[1]) },
        uWarm: { value: new THREE.Color(TOKENS.coal) }
      },
      vertexShader: `varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normalize(normalMatrix*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform float uSev, uTime; uniform vec3 uHot, uWarm; varying vec2 vUv; varying vec3 vN;
        void main(){
          // vUv.y 是轴向 0…1（圆柱的 v），劣化轴承在 v = 1 一端
          float end = smoothstep(0.35, 1.0, vUv.y);
          float k = clamp(uSev * (0.35 + 0.9 * end), 0.0, 1.2);
          vec3 metal = vec3(0.55, 0.58, 0.62) * (0.45 + 0.55 * max(0.0, vN.y));
          vec3 hot = mix(uWarm, uHot, smoothstep(0.5, 1.0, k)) * (1.2 + 1.6 * k);
          float pulse = 0.85 + 0.15 * sin(uTime * 4.0);
          gl_FragColor = vec4(mix(metal, hot * pulse, smoothstep(0.1, 0.8, k)), 1.0);
          #include <colorspace_fragment>
        }`
    })
    const rollerAt = (r) => {
      const len = r === "C" ? lc : lw
      const geo = new THREE.CylinderGeometry(ROLLER_R, ROLLER_R, len, 32, 1)
      geo.rotateX(Math.PI / 2)
      const mesh = new THREE.Mesh(geo, r === roll ? this.heatMat : M.roller)
      if (r === "C") mesh.position.set(0, 0, 0)
      else {
        const s = r === "L" ? 1 : -1
        mesh.position.set(0, wy, s * wz)
        mesh.rotation.x = -s * T
      }
      return mesh
    }
    this.rollers = { C: rollerAt("C"), L: rollerAt("L"), R: rollerAt("R") }
    g.add(this.rollers.C, this.rollers.L, this.rollers.R)
    // 托架（槽形 U 架）
    const bracket = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.07, B + 0.4),
      M.paint
    )
    bracket.position.y = -0.18
    g.add(bracket)
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.42, 0.07),
        M.paint
      )
      post.position.set(0, 0.03, s * (B / 2 + 0.18))
      g.add(post)
    }
    // 一小段输送带（半透明，看得到下面的托辊）
    const beltMat = new THREE.MeshStandardMaterial({
      color: "#16181b",
      roughness: 0.9,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false
    })
    // 带面截面：两翼按 35° 槽角（和边托辊一致），比托辊顶面高 2.5 cm
    const wing = lw + 0.1
    const top = ROLLER_R + 0.025
    const prof = [
      [-lc / 2 - wing * Math.cos(T), top + wing * Math.sin(T)],
      [-lc / 2, top],
      [lc / 2, top],
      [lc / 2 + wing * Math.cos(T), top + wing * Math.sin(T)]
    ]
    const shape = new THREE.BufferGeometry()
    const pos = []
    for (const x of [-0.9, 0.9]) for (const [z, y] of prof) pos.push(x, y, z)
    shape.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    shape.setIndex([0, 4, 1, 4, 5, 1, 1, 5, 2, 5, 6, 2, 2, 6, 3, 6, 7, 3])
    shape.computeVertexNormals()
    g.add(new THREE.Mesh(shape, beltMat))

    // 劣化轴承拆出来：外圈（带剥落痕）、滚珠、内圈，沿托辊轴线移到辊端外侧
    const hotRoller = this.rollers[roll]
    const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(
      hotRoller.quaternion
    )
    const len = roll === "C" ? lc : lw
    const brg = new THREE.Group()
    const outer = new THREE.Mesh(
      new THREE.TorusGeometry(0.031, 0.008, 12, 40),
      M.steel
    )
    const inner = new THREE.Mesh(
      new THREE.TorusGeometry(0.016, 0.005, 10, 32),
      M.steel
    )
    brg.add(outer, inner)
    for (let i = 0; i < 9; i++) {
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.0065, 10, 8),
        M.roller
      )
      const a = (i / 9) * Math.PI * 2
      ball.position.set(Math.cos(a) * 0.0235, Math.sin(a) * 0.0235, 0)
      brg.add(ball)
    }
    // 外圈滚道上的剥落痕（BPFO 的来源）
    const spall = new THREE.Mesh(
      new THREE.BoxGeometry(0.008, 0.004, 0.009),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(LEVEL_COLOR[1]).multiplyScalar(2),
        toneMapped: false
      })
    )
    spall.position.set(0.023, 0.018, 0)
    brg.add(spall)
    brg.scale.setScalar(2.2) // 放大 2.2 倍便于看清
    brg.lookAt(axis)
    this.brgFrom = hotRoller.position
      .clone()
      .addScaledVector(axis, len / 2 - 0.02)
    this.brgTo = hotRoller.position
      .clone()
      .addScaledVector(axis, len / 2 + 0.28)
    brg.position.copy(this.brgFrom)
    g.add(brg)
    this.brg = brg
    // 光晕 + 声波圈（在劣化轴承端）
    this.hotEnd = hotRoller.position.clone().addScaledVector(axis, len / 2)
    this.halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 20, 16),
      new THREE.MeshBasicMaterial({
        color: LEVEL_COLOR[1],
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false
      })
    )
    this.halo.position.copy(this.hotEnd)
    g.add(this.halo)
    this.rings = []
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.004, 6, 64),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(TOKENS.predict).multiplyScalar(1.8),
          transparent: true,
          depthWrite: false,
          toneMapped: false
        })
      )
      r.position.copy(this.hotEnd)
      r.lookAt(this.hotEnd.clone().add(axis))
      r.userData.phase = i / 3
      g.add(r)
      this.rings.push(r)
    }
    // 补光：暖色点光在劣化端，冷色在对侧
    const warm = new THREE.PointLight(LEVEL_COLOR[1], 2, 3, 1.5)
    warm.position.copy(this.hotEnd).add(new THREE.Vector3(0, 0.3, 0))
    const key = new THREE.PointLight("#cfe8ff", 6, 6, 1.2)
    key.position.set(1.2, 1.4, 1.6)
    g.add(warm, key)
    this.k = 0
    this.labelList = [
      label("hot", this.halo, "fault", { name: track.where }),
      label("brg", brg, "part", { name: "轴承 6305 · 外圈剥落" })
    ]
  }
  update(s) {
    const tr = s.tracks.find((t) => t.id === this.track.id) || this.track
    this.track = tr
    this.heatMat.uniforms.uSev.value = tr.s
  }
  tick(dt, t) {
    // 进入后 1.2 s 把轴承拆出来
    this.k = Math.min(1, this.k + dt / 1.2)
    const e = 1 - (1 - this.k) ** 3
    this.brg.position.lerpVectors(this.brgFrom, this.brgTo, e)
    this.brg.rotation.z += dt * 0.6
    this.heatMat.uniforms.uTime.value = t
    for (const r of this.rings) {
      const k = (t * 0.7 + r.userData.phase) % 1
      r.scale.setScalar(0.05 + 0.45 * k)
      r.material.opacity = (1 - k) * Math.min(1, this.track.s * 1.3)
    }
    this.halo.material.opacity = 0.1 + 0.05 * Math.sin(t * 3)
  }
  focus() {
    return this.group.localToWorld(new THREE.Vector3(0, 0.12, 0))
  }
  labels() {
    return this.labelList.map((l) => ({
      ...l,
      pos: l.pos.getWorldPosition(new THREE.Vector3())
    }))
  }
  pick() {
    return null
  }
  dispose() {
    disposeAll(this.group)
  }
}

/* ================================================================ 驱动部拆解 */
export class DrivePart {
  /**
   * @param {object} o
   * @param {object} o.belt layout 里的皮带
   * @param {string} o.motor 电机编号（BC02-M1…）
   * @param {object|null} o.track 这套驱动上的劣化过程（可空）
   */
  constructor({ belt, motor, track }) {
    this.belt = belt
    this.motorId = motor
    this.track = track
    const M = (this.m = mats())
    const g = (this.group = new THREE.Group())
    g.position.copy(DETAIL_ORIGIN)
    const kW = belt.drives[0].kW
    // 尺寸按功率粗略缩放（1400 kW ≈ 直径 1.1 m）
    const k = 0.7 + 0.3 * Math.min(1, kW / 1400)
    const blue = new THREE.MeshStandardMaterial({
      color: "#2f6e8f",
      roughness: 0.45,
      metalness: 0.55
    })
    const parts = []
    const add = (obj, explodeX, key) => {
      obj.userData.home = obj.position.clone()
      obj.userData.dx = explodeX
      obj.userData.key = key
      g.add(obj)
      parts.push(obj)
      return obj
    }
    // 电机：机身 + 散热筋 + 接线盒 + 两端端盖（DE / NDE）
    const motorG = new THREE.Group()
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55 * k, 0.55 * k, 1.7 * k, 40),
      blue
    )
    body.rotation.z = Math.PI / 2
    motorG.add(body)
    for (let i = 0; i < 18; i++) {
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(1.5 * k, 0.03, 0.08),
        blue
      )
      const a = (i / 18) * Math.PI * 2
      fin.position.set(0, Math.cos(a) * 0.58 * k, Math.sin(a) * 0.58 * k)
      fin.rotation.x = a
      motorG.add(fin)
    }
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.4 * k, 0.3 * k, 0.4 * k),
      blue
    )
    box.position.set(0, 0.68 * k, 0)
    motorG.add(box)
    const capMat = new THREE.MeshStandardMaterial({
      color: "#2a5f7a",
      roughness: 0.5,
      metalness: 0.6,
      emissive: LEVEL_COLOR[1],
      emissiveIntensity: 0
    })
    const capNDE = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42 * k, 0.5 * k, 0.16, 32),
      capMat.clone()
    )
    capNDE.rotation.z = Math.PI / 2
    capNDE.position.x = -0.93 * k
    const capDE = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5 * k, 0.42 * k, 0.16, 32),
      capMat.clone()
    )
    capDE.rotation.z = Math.PI / 2
    capDE.position.x = 0.93 * k
    motorG.add(capNDE, capDE)
    motorG.position.set(-2.4 * k, 0.75 * k, 0)
    add(motorG, -1.4, "motor")
    // 联轴器
    const coup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22 * k, 0.22 * k, 0.32, 24),
      M.yellow
    )
    coup.rotation.z = Math.PI / 2
    coup.position.set(-1.1 * k, 0.75 * k, 0)
    add(coup, -0.5, "coupling")
    // 减速机
    const red = new THREE.Mesh(
      new THREE.BoxGeometry(1.3 * k, 1.2 * k, 1.1 * k),
      new THREE.MeshStandardMaterial({
        color: "#c8932e",
        roughness: 0.55,
        metalness: 0.35,
        emissive: LEVEL_COLOR[1],
        emissiveIntensity: 0
      })
    )
    red.position.set(0.15 * k, 0.75 * k, 0)
    add(red, 0.3, "reducer")
    // 传动滚筒（菱形胶面）
    const pulley = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7 * k, 0.7 * k, 1.9, 40),
      new THREE.MeshStandardMaterial({
        color: "#4a5058",
        roughness: 0.8,
        metalness: 0.2,
        emissive: LEVEL_COLOR[1],
        emissiveIntensity: 0
      })
    )
    pulley.rotation.x = Math.PI / 2
    pulley.position.set(1.9 * k, 0.95 * k, -0.6)
    add(pulley, 1.2, "pulley")
    // 底座（不动）
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(6.2 * k, 0.18, 1.6),
      M.steelDark
    )
    base.position.set(-0.3 * k, 0.09, 0)
    g.add(base)
    // 灯光
    const key = new THREE.PointLight("#d8ecff", 30, 14, 1.3)
    key.position.set(1, 4, 4)
    const rim = new THREE.PointLight(TOKENS.coal, 10, 10, 1.4)
    rim.position.set(-3, 2, -3)
    g.add(key, rim)
    this.parts = parts
    this.capDE = capDE
    this.capNDE = capNDE
    this.red = red
    this.pulley = pulley
    this.k = 0
    // oy：标签框相对锚点的竖向偏移（设计稿 px），相邻部件一上一下错开
    this.labelList = [
      label("motor", motorG, "part", { name: `${motor} 电机`, oy: -86 }),
      label("coupling", coup, "part", { name: "联轴器", oy: 56 }),
      label("reducer", red, "part", {
        name: motor.replace("-M", "-R") + " 减速机",
        oy: -86
      }),
      label("pulley", pulley, "part", { name: "传动滚筒", oy: 56 })
    ]
    this.glow()
  }
  /** 劣化部位发光：电机轴承（按 DE / NDE）、减速机、滚筒 */
  glow() {
    const tr = this.track
    const s = tr ? tr.s : 0
    this.capDE.material.emissiveIntensity =
      tr?.kind === "motorBearing" && tr.end === "DE" ? 0.5 + 2 * s : 0
    this.capNDE.material.emissiveIntensity =
      tr?.kind === "motorBearing" && tr.end === "NDE" ? 0.5 + 2 * s : 0
    this.red.material.emissiveIntensity =
      tr && (tr.kind === "reducerGear" || tr.kind === "reducerOil")
        ? 0.3 + 1.2 * s
        : 0
    this.pulley.material.emissiveIntensity =
      tr?.kind === "pulleyLagging" ? 0.3 + 1.2 * s : 0
  }
  update(s) {
    if (this.track)
      this.track = s.tracks.find((t) => t.id === this.track.id) || this.track
    this.glow()
    this.state = s
  }
  tick(dt) {
    // 进入后 1.5 s 拆开（爆炸图）
    this.k = Math.min(1, this.k + dt / 1.5)
    const e = 1 - (1 - this.k) ** 3
    for (const p of this.parts)
      p.position.x = p.userData.home.x + p.userData.dx * e
  }
  focus() {
    return this.group.localToWorld(new THREE.Vector3(-0.3, 0.8, 0))
  }
  labels() {
    return this.labelList.map((l) => ({
      ...l,
      pos: l.pos.getWorldPosition(new THREE.Vector3())
    }))
  }
  pick() {
    return null
  }
  dispose() {
    disposeAll(this.group)
  }
}

function disposeAll(g) {
  g.traverse((o) => {
    o.geometry?.dispose?.()
    const m = o.material
    for (const x of Array.isArray(m) ? m : m ? [m] : []) x.dispose?.()
  })
}

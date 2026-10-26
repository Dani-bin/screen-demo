/*
 * 全链剖面里的人员和巡检机器人（「人员」「机器人」两个图层）
 * ----------------------------------------------------------
 * - 人员：仿真 s.people 里带皮带 + 里程的（巡检工、零点班检修工）站在那条巷道底部靠镜头一侧；
 *   综采 / 掘进工作面的人员仿真只给区域，按序号排在 12301 支架排前、12305 掘进迎头（BC06 机尾）。
 *   人数随班次变化（几十人），所以每个部件一个 InstancedMesh
 * - 吊轨机器人 RB01（主斜井）/ RB02（主运输大巷）：巷道顶上一条轨道，白色机身挂在轨道下，云台青色镜头；
 *   定点检测时向下打一束扫描光锥
 * - 机器狗 DOG01：地面沿 BC01 栈桥下来回走，走动时四条腿交替摆
 * 剖面是示意尺度（6 km 长的岩块，皮带光管半径 10），真实比例的人在总览里只有一两个像素。
 * 所以人和机器人按到镜头的距离放大，屏上始终约 SIZE_PX 那么大（1080 高的屏上的像素），拉近看时不小于模型原尺寸
 */
import * as THREE from "three"
import { TOKENS } from "./theme.js"
import { SECTION, BELTS, pathAt, normalOf } from "./section.js"

const MAX_PEOPLE = 96
// 屏上大小（1080 高的屏上的像素）：人高、机器人长
const SIZE_PX = { person: 30, rail: 34, dog: 30 }
// 模型原尺寸（剖面坐标）：人高、吊轨机器人长、机器狗长
const BASE = { person: 55, rail: 36, dog: 52 }

/**
 * 让模型在屏上约 px 像素（按 1080 高计）的放大倍数：
 * 屏上像素 = 尺寸 × 焦距像素 / 距离，焦距像素 = 屏高 / 2 / tan(fov / 2)，屏高约掉了
 */
function fitScale(dist, tanHalf, px, base) {
  return Math.max(1, (((2 * px) / 1080) * tanHalf * dist) / base)
}

/** 人体各部件（单位：剖面坐标，脚底为原点、面朝 +z） */
function personParts() {
  // 总览里人在半透明岩块后面，要靠自发光才压得过岩块的那层灰
  const suit = new THREE.MeshStandardMaterial({
    color: "#4f86c6",
    roughness: 0.7,
    emissive: "#2b5689",
    emissiveIntensity: 1
  })
  const helmet = new THREE.MeshStandardMaterial({
    color: "#ffd21f",
    roughness: 0.4,
    emissive: "#8a6d00",
    emissiveIntensity: 1
  })
  const glow = (hex, k) =>
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(hex).multiplyScalar(k),
      toneMapped: false
    })
  return [
    // 躯干 + 腿：一根胶囊
    {
      geo: new THREE.CapsuleGeometry(7.5, 24, 4, 10).translate(0, 19.5, 0),
      mat: suit
    },
    // 反光带（矿工服腰间）
    {
      geo: new THREE.CylinderGeometry(7.9, 7.9, 3.2, 14).translate(0, 26, 0),
      mat: glow(TOKENS.coal, 1.6)
    },
    {
      geo: new THREE.SphereGeometry(6.2, 12, 10).translate(0, 44, 0),
      mat: suit
    },
    // 安全帽：半球
    {
      geo: new THREE.SphereGeometry(7.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)
        .scale(1, 0.85, 1)
        .translate(0, 46, 0),
      mat: helmet
    },
    // 矿灯：帽前一个亮点（进辉光，远看就是一颗颗移动的灯）
    {
      geo: new THREE.SphereGeometry(2.4, 8, 6).translate(0, 48, 7),
      mat: glow("#fff1c9", 3)
    },
    // 脚下的 UWB 定位圈
    {
      geo: new THREE.RingGeometry(10, 13, 32).rotateX(-Math.PI / 2),
      mat: new THREE.MeshBasicMaterial({
        color: new THREE.Color(TOKENS.data).multiplyScalar(1.4),
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false
      })
    }
  ]
}

/** 轨道上一点：皮带中心沿截面朝上 18（巷道顶）、往镜头一侧 16（不和煤流光管重叠） */
function railPoint(belt, chainage) {
  const { pos, tan } = pathAt(belt, chainage / BELTS[belt].L)
  const nrm = normalOf(tan)
  return {
    pos: pos.addScaledVector(nrm, 18).add(new THREE.Vector3(0, 0, 16)),
    tan,
    nrm
  }
}

/** 吊轨机器人：原点在轨道上，机身挂在原点下方（放大时仍然挂在轨道上） */
function railRobot(dev) {
  const [c0, c1] = dev.chainage
  const pts = []
  for (let i = 0; i <= 160; i++)
    pts.push(railPoint(dev.belt, c0 + ((c1 - c0) * i) / 160).pos)
  const rail = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({
      color: TOKENS.data,
      transparent: true,
      opacity: 0.5
    })
  )
  const g = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(36, 15, 15),
    new THREE.MeshStandardMaterial({
      color: "#e6e9ed",
      roughness: 0.4,
      metalness: 0.3,
      emissive: "#4a525c",
      emissiveIntensity: 1
    })
  )
  body.position.y = -12
  // 挂臂（两只行走轮架）
  const hangerGeo = new THREE.BoxGeometry(5, 5, 5)
  const steel = new THREE.MeshStandardMaterial({
    color: "#7d8791",
    metalness: 0.6
  })
  for (const x of [-11, 11]) {
    const h = new THREE.Mesh(hangerGeo, steel)
    h.position.set(x, -2.5, 0)
    g.add(h)
  }
  // 云台 + 青色镜头
  const gimbal = new THREE.Mesh(
    new THREE.SphereGeometry(5.5, 12, 10),
    new THREE.MeshStandardMaterial({ color: "#2c3036", roughness: 0.5 })
  )
  gimbal.position.y = -22
  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(2.6, 10, 8),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(TOKENS.data).multiplyScalar(2.6),
      toneMapped: false
    })
  )
  lens.position.set(0, -23, 4.5)
  // 状态灯：巡检 / 检测 / 返航绿色，充电青色
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 8, 6),
    new THREE.MeshBasicMaterial({ toneMapped: false })
  )
  lamp.position.set(-14, -3.5, 7.6)
  // 定点检测时向下的扫描光锥（开口朝下，叠加混合）
  const scan = new THREE.Mesh(
    new THREE.ConeGeometry(16, 34, 24, 1, true).translate(0, -17, 0),
    new THREE.MeshBasicMaterial({
      color: TOKENS.data,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    })
  )
  scan.position.y = -26
  scan.visible = false
  g.add(body, gimbal, lens, lamp, scan)
  return { dev, rail, g, lamp, scan, target: null }
}

/** 地面四足机器狗：身体 + 头 + 四条腿（腿绕髋关节摆），原点在脚底、面朝 +x */
function robotDog() {
  const g = new THREE.Group()
  const shell = new THREE.MeshStandardMaterial({
    color: "#e6e9ed",
    roughness: 0.45,
    metalness: 0.2,
    emissive: "#4a525c",
    emissiveIntensity: 1
  })
  const dark = new THREE.MeshStandardMaterial({
    color: "#3a4048",
    roughness: 0.6,
    emissive: "#1a1e24",
    emissiveIntensity: 1
  })
  const body = new THREE.Mesh(new THREE.BoxGeometry(40, 11, 15), shell)
  body.position.y = 22
  const head = new THREE.Mesh(new THREE.BoxGeometry(11, 9, 12), dark)
  head.position.set(23, 25, 0)
  // 头前的青色视觉模组 + 身侧灯条
  const glow = new THREE.MeshBasicMaterial({
    color: new THREE.Color(TOKENS.data).multiplyScalar(2.4),
    toneMapped: false
  })
  const eye = new THREE.Mesh(new THREE.BoxGeometry(1.5, 3, 9), glow)
  eye.position.set(28.8, 25.5, 0)
  const strip = new THREE.Mesh(new THREE.BoxGeometry(26, 1.6, 15.4), glow)
  strip.position.set(0, 24, 0)
  g.add(body, head, eye, strip)
  // 腿：髋关节在身体下沿，腿往下 17
  const legs = []
  const legGeo = new THREE.BoxGeometry(3.6, 17, 3.6).translate(0, -8.5, 0)
  for (const [x, z] of [
    [14, 6],
    [14, -6],
    [-14, 6],
    [-14, -6]
  ]) {
    const hip = new THREE.Group()
    hip.position.set(x, 17, z)
    hip.add(new THREE.Mesh(legGeo, dark))
    g.add(hip)
    legs.push(hip)
  }
  return { g, legs, target: null, moving: false }
}

export class Crew {
  constructor(scene, layout) {
    this.group = new THREE.Group()
    scene.add(this.group)
    this.people = new THREE.Group()
    this.robots = new THREE.Group()
    // 两个图层默认关（和页面的图层开关一致）
    this.people.visible = false
    this.robots.visible = false
    this.group.add(this.people, this.robots)

    // 人员：每个部件一个 InstancedMesh；at = 每人脚底位置（每秒更新），矩阵每帧按距离重算
    this.at = []
    this.parts = personParts().map(({ geo, mat }) => {
      const m = new THREE.InstancedMesh(geo, mat, MAX_PEOPLE)
      m.count = 0
      m.frustumCulled = false
      this.people.add(m)
      return m
    })

    // 工作面站位：和 props.js 里支架排一致（定稿取工作面线前 90 %、上移 50；底座底面在支架中心下 128），
    // 往镜头一侧 100 是支架前的人行道
    const [a, b0] = SECTION.face.map((p) => new THREE.Vector3(...p))
    const b = a.clone().lerp(b0, 0.9)
    this.faceA = a.clone().add(new THREE.Vector3(0, 50 - 128, 100))
    this.faceB = b.clone().add(new THREE.Vector3(0, 50 - 128, 100))

    // 吊轨机器人 + 机器狗
    this.rails = layout.devices
      .filter((d) => d.kind === "robotRail" && BELTS[d.belt])
      .map((d) => {
        const r = railRobot(d)
        this.robots.add(r.rail, r.g)
        return r
      })
    const dogDev = layout.devices.find((d) => d.kind === "robotDog")
    this.dog = dogDev ? { dev: dogDev, ...robotDog() } : null
    if (this.dog) this.robots.add(this.dog.g)
  }

  /** 图层开关：people / robots */
  setVisible(key, on) {
    if (key === "people") this.people.visible = on
    if (key === "robots") this.robots.visible = on
  }

  /** 仿真状态（每秒）：人员站位、机器人目标位置和状态 */
  setState(s) {
    // ---------- 人员
    const at = []
    const faceN = {}
    const faceI = {}
    for (const p of s.people) faceN[p.area] = (faceN[p.area] || 0) + 1
    for (const p of s.people) {
      if (p.belt && p.chainage != null && BELTS[p.belt]) {
        // 沿线人员：巷道底部（中心下 20），偏镜头一侧，不和煤流光管重叠
        const { pos } = pathAt(p.belt, p.chainage / BELTS[p.belt].L)
        at.push(pos.add(new THREE.Vector3(0, -20, 14)))
      } else if (p.area === "WF12301") {
        // 综采工作面：沿支架排前的人行道排开，前后交错一点
        const i = (faceI[p.area] = (faceI[p.area] ?? -1) + 1)
        at.push(
          this.faceA
            .clone()
            .lerp(this.faceB, (i + 0.5) / faceN[p.area])
            .add(new THREE.Vector3(0, 0, (i % 2) * 14))
        )
      } else if (p.area === "WF12305" && BELTS.BC06) {
        // 掘进工作面：BC06 机尾（迎头）附近站成一小群：沿走向 30 m 一个，前后交错（总览里不叠成一个人）
        const i = (faceI[p.area] = (faceI[p.area] ?? -1) + 1)
        const { pos } = pathAt("BC06", (8 + i * 30) / BELTS.BC06.L)
        at.push(pos.add(new THREE.Vector3(0, -20, 14 + (i % 2) * 16)))
      }
    }
    this.at = at.slice(0, MAX_PEOPLE)
    for (const part of this.parts) part.count = this.at.length

    // ---------- 吊轨机器人
    for (const r of this.rails) {
      const st = s.robots?.[r.dev.id]
      if (!st) continue
      const { pos, tan, nrm } = railPoint(r.dev.belt, st.pos)
      r.target = pos
      // 机身沿走向、顶朝截面上方（斜井里跟着倾斜）
      r.g.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(
          tan,
          nrm,
          new THREE.Vector3().crossVectors(tan, nrm)
        )
      )
      if (!r.g.userData.placed) {
        r.g.position.copy(pos)
        r.g.userData.placed = true
      }
      r.lamp.material.color
        .set(st.state === "charging" ? TOKENS.data : TOKENS.ok)
        .multiplyScalar(2.2)
      r.scan.visible = st.state === "inspect"
    }

    // ---------- 机器狗：地面，沿 BC01 栈桥下（栈桥在 driveHouse 那一排，狗走在它前面 75）
    if (this.dog) {
      const st = s.robots?.[this.dog.dev.id]
      if (st) {
        const id = this.dog.dev.belt
        const { pos } = pathAt(id, st.pos / BELTS[id].L)
        this.dog.target = new THREE.Vector3(
          pos.x,
          SECTION.block.H,
          SECTION.surface.driveHouse[2] + 75
        )
        this.dog.moving = st.state === "patrol" || st.state === "return"
        // 巡检往里程小的方向走（-x），返航往回；充电时面朝镜头
        this.dog.g.rotation.y =
          st.state === "patrol"
            ? Math.PI
            : st.state === "return"
              ? 0
              : -Math.PI / 2
        if (!this.dog.g.userData.placed) {
          this.dog.g.position.copy(this.dog.target)
          this.dog.g.userData.placed = true
        }
      }
    }
  }

  /**
   * 每帧：按到镜头的距离放大（屏上大小不变），机器人向目标平滑移动（回放 60 倍速时也不跳），
   * 狗腿摆动，扫描光锥呼吸
   */
  tick(dt, t, camera) {
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const eye = camera.position
    if (this.people.visible && this.at.length) {
      const m = new THREE.Matrix4()
      const one = new THREE.Quaternion()
      const sv = new THREE.Vector3()
      this.at.forEach((p, i) => {
        const k = fitScale(
          eye.distanceTo(p),
          tanHalf,
          SIZE_PX.person,
          BASE.person
        )
        m.compose(p, one, sv.setScalar(k))
        for (const part of this.parts) part.setMatrixAt(i, m)
      })
      for (const part of this.parts) part.instanceMatrix.needsUpdate = true
    }
    if (!this.robots.visible) return
    const k = 1 - Math.exp(-dt * 3)
    for (const r of this.rails) {
      if (r.target) r.g.position.lerp(r.target, k)
      r.g.scale.setScalar(
        fitScale(eye.distanceTo(r.g.position), tanHalf, SIZE_PX.rail, BASE.rail)
      )
      if (r.scan.visible) r.scan.material.opacity = 0.14 + 0.1 * Math.sin(t * 4)
    }
    const dog = this.dog
    if (dog?.target) {
      dog.g.position.lerp(dog.target, k)
      dog.g.scale.setScalar(
        fitScale(eye.distanceTo(dog.g.position), tanHalf, SIZE_PX.dog, BASE.dog)
      )
      dog.legs.forEach((leg, i) => {
        // 对角两条腿同相（小跑步态）
        const ph = i === 0 || i === 3 ? 0 : Math.PI
        leg.rotation.z = dog.moving ? 0.45 * Math.sin(t * 9 + ph) : 0
      })
    }
  }
}

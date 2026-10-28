/*
 * 场景道具：井筒、受监控硐室（放大的玻璃房 + 柜列）、永久避难硐室（绿色胶囊舱）
 * 硐室状态（正常 / 预警 / 火警 / 复位）改玻璃房棱边颜色和室内灯色；DS-04 的柜列按防护分区排，
 * 和面板上的"火警硐室平面"一一对应（高防 6、低压 7、变压器 2、电缆沟悬挂 4）。
 */
import * as THREE from "three"
import { THEME } from "./theme.js"
import { glassMaterial } from "./materials.js"
import { sweepBox } from "./geom.js"

const STATE_COLOR = {
  ok: THEME.color.tube,
  off: THEME.color.tube,
  fault: THEME.color.tube,
  reset: THEME.color.ok,
  warn: THEME.color.warn,
  // 起火的玻璃房用偏橙的火色（概念图里着火硐室是橙红炽亮），面板和标签仍用火警红
  fire: "#ff6a2a"
}

/** 一间硐室：玻璃房 + 地板 + 柜列 + 室内灯 */
function buildChamber(c, cfg, corridorX) {
  const S = THEME.size
  const [L, W, H] = S.chamber
  const alongX = c.axis[0] !== 0
  const g = new THREE.Group()
  const cx = c.at[0]
  const cz = -c.at[1]
  g.position.set(cx, -S.sink, cz)

  const sx = alongX ? L : W
  const sz = alongX ? W : L
  const mat = glassMaterial({
    color: STATE_COLOR.ok,
    opacity: 0.1,
    edge: 1.3,
    box: true
  })
  const box = new THREE.Mesh(new THREE.BoxGeometry(sx, H, sz), mat)
  box.position.y = H / 2
  box.renderOrder = 6
  box.userData = { kind: "chamber", id: c.id }
  g.add(box)

  // 地板：暖色室内光（概念图里硐室都透出橙黄暖光，和冷色巷道形成冷暖对比）
  const floorMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.8, 0.52, 0.2)
  })
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(sx - 6, sz - 6),
    floorMat
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = 1
  g.add(floor)

  // 柜列：沿长轴按防护分区排，分区之间留空；电缆沟（悬挂装置）沿另一侧排成一行小块
  const cab = []
  const zones = cfg.zones.filter((z) => z.name !== "电缆沟")
  const total =
    zones.reduce((s, z) => s + z.units, 0) + (zones.length - 1) * 1.6
  const pitch = (L - 30) / total
  let k = -(L - 30) / 2
  for (const z of zones) {
    const big = z.name === "变压器区"
    for (let i = 0; i < z.units; i++) {
      cab.push({ u: k + pitch / 2, w: pitch * 0.78, big, zone: z.name })
      k += pitch
    }
    k += pitch * 1.6
  }
  const trench = cfg.zones.find((z) => z.name === "电缆沟")
  const body = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: "#4a5d70" }),
    cab.length
  )
  // 柜面指示灯（HDR 暖白，喷放时换色）
  const lamp = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.9, 1.2) }),
    cab.length
  )
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const off = -W / 2 + 26 // 柜列靠一侧墙
  cab.forEach((cb, i) => {
    const h = cb.big ? 86 : 70
    const d = cb.big ? 40 : 26
    const pos = alongX
      ? new THREE.Vector3(cb.u, h / 2 + 1, off)
      : new THREE.Vector3(off, h / 2 + 1, cb.u)
    const scl = alongX
      ? new THREE.Vector3(cb.w, h, d)
      : new THREE.Vector3(d, h, cb.w)
    body.setMatrixAt(i, m4.compose(pos, q, scl))
    const lp = pos.clone()
    if (alongX) lp.z += d / 2 + 0.6
    else lp.x += d / 2 + 0.6
    lp.y = h * 0.72
    lamp.setMatrixAt(
      i,
      m4.compose(
        lp,
        q,
        alongX
          ? new THREE.Vector3(cb.w * 0.7, 16, 1)
          : new THREE.Vector3(1, 16, cb.w * 0.7)
      )
    )
  })
  g.add(body, lamp)
  if (trench) {
    const t = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 1.0) }),
      trench.units
    )
    for (let i = 0; i < trench.units; i++) {
      const u = -(L - 40) / 2 + ((L - 40) * (i + 0.5)) / trench.units
      const pos = alongX
        ? new THREE.Vector3(u, 6, W / 2 - 18)
        : new THREE.Vector3(W / 2 - 18, 6, u)
      t.setMatrixAt(i, m4.compose(pos, q, new THREE.Vector3(10, 8, 10)))
    }
    g.add(t)
  }

  // 室内灯：暖色，起火时换红并闪烁
  const light = new THREE.PointLight("#ffcf96", 4, 460, 0)
  light.position.set(0, H * 0.75, 0)
  g.add(light)

  // 硐室到大巷的连接短巷（DS-02 骑在大巷端头，不需要）
  if (corridorX !== null) {
    const pts = alongX
      ? [
          [cx, cz + (corridorX.side * W) / 2],
          [cx, corridorX.z]
        ]
      : [
          [cx + W / 2, cz],
          [corridorX.x, cz]
        ]
    const stub = new THREE.Mesh(
      sweepBox(pts, 26, S.tubeH * 0.8, -S.sink),
      glassMaterial({
        color: THEME.color.brand,
        opacity: 0.12,
        edge: 1.5,
        ribs: 40
      })
    )
    stub.renderOrder = 5
    // 连接短巷用的是世界坐标，由调用方加进场景
    g.userData.stub = stub
  }

  return {
    id: c.id,
    group: g,
    box,
    mat,
    light,
    lamp,
    floorMat,
    center: new THREE.Vector3(cx, 0, cz),
    top: new THREE.Vector3(cx, H + 14 - S.sink, cz),
    state: "ok",
    setState(st) {
      if (st === this.state) return
      this.state = st
      mat.uniforms.uColor.value.set(STATE_COLOR[st] || STATE_COLOR.ok)
      mat.uniforms.uOpacity.value =
        st === "fire" ? 0.3 : st === "warn" ? 0.14 : 0.1
      light.color.set(
        st === "fire" ? "#ff4a2a" : st === "warn" ? "#ffd24a" : "#ffcf96"
      )
      // 起火：柜面灯、地板一起变红；预警变黄
      lamp.material.color.setRGB(
        ...(st === "fire"
          ? [3.6, 1.0, 0.3]
          : st === "warn"
            ? [2.8, 2.2, 0.5]
            : [2.4, 1.9, 1.2])
      )
      // 起火时地板用 HDR 橙红自发光，看得出"房间里在烧"
      if (st === "fire") floorMat.color.setRGB(2.2, 0.55, 0.12)
      else if (st === "warn") floorMat.color.setRGB(0.7, 0.55, 0.1)
      else floorMat.color.setRGB(0.8, 0.52, 0.2)
    }
  }
}

export function buildProps(plan, chambersCfg) {
  const S = THEME.size
  const group = new THREE.Group()
  const pick = []

  // ---------- 井筒：两根竖直玻璃管 + 光环；副井（安全出口）的顶环用绿色
  const shafts = plan.shafts.map((sh) => {
    const g = new THREE.Group()
    g.position.set(sh.at[0], 0, -sh.at[1])
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(S.shaftR, S.shaftR, S.shaftH, 32, 1, true),
      glassMaterial({
        color: THEME.color.brand,
        opacity: 0.12,
        edge: 1.4,
        box: true
      })
    )
    tube.position.y = S.shaftH / 2
    tube.renderOrder = 6
    g.add(tube)
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.3, 1.3, 1.7)
    })
    for (const k of [0.04, 0.55]) {
      const r = new THREE.Mesh(
        new THREE.TorusGeometry(S.shaftR + 3, 2.6, 6, 40),
        ringMat
      )
      r.rotation.x = Math.PI / 2
      r.position.y = S.shaftH * k
      g.add(r)
    }
    // 井口：顶上一道亮环（主井、副井同色，安全出口由标签说明）
    {
      const top = new THREE.Mesh(
        new THREE.TorusGeometry(S.shaftR + 6, 4, 8, 40),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.5, 1.9) })
      )
      top.rotation.x = Math.PI / 2
      top.position.y = S.shaftH
      g.add(top)
    }
    group.add(g)
    return {
      id: sh.id,
      top: new THREE.Vector3(sh.at[0], S.shaftH + 30, -sh.at[1])
    }
  })

  // ---------- 受监控硐室
  // 连接短巷的另一端：东西向硐室连到它南 / 北边的大巷，南北向硐室连到东边的主大巷
  const link = {
    "DS-01": { x: -190 }, // 接到 DS-02 西墙
    "DS-03": { z: 0, side: 1 }, // 南墙接东翼大巷
    "DS-04": { x: -30 } // 东墙接主大巷
  }
  const chambers = {}
  for (const c of plan.chambers) {
    const cfg = chambersCfg.find((x) => x.id === c.id)
    const lk = link[c.id]
    let cor = null
    if (lk) cor = lk.x !== undefined ? { x: lk.x } : { z: lk.z, side: lk.side }
    // 东西向硐室接南北向大巷时，按南北向的写法从东墙接出去
    let ch
    if (c.id === "DS-01") {
      ch = buildChamber({ ...c, axis: [1, 0] }, cfg, null)
      const L = THEME.size.chamber[0]
      const pts = [
        [c.at[0] + L / 2, -c.at[1]],
        [lk.x, -c.at[1]]
      ]
      const stub = new THREE.Mesh(
        sweepBox(pts, 26, S.tubeH * 0.8, -S.sink),
        glassMaterial({
          color: THEME.color.brand,
          opacity: 0.12,
          edge: 1.5,
          ribs: 40
        })
      )
      stub.renderOrder = 5
      group.add(stub)
    } else {
      ch = buildChamber(c, cfg, cor)
      if (ch.group.userData.stub) group.add(ch.group.userData.stub)
    }
    group.add(ch.group)
    pick.push(ch.box)
    chambers[c.id] = ch
  }

  // ---------- 永久避难硐室：套在大巷上的绿色胶囊舱
  const refuges = {}
  for (const r of plan.refuges) {
    const [len, rad] = S.refuge
    const g = new THREE.Group()
    g.position.set(r.at[0], S.tubeH * 0.5 - S.sink, -r.at[1])
    const cap = new THREE.Mesh(
      new THREE.CapsuleGeometry(rad, len - rad * 2, 8, 24),
      glassMaterial({
        color: THEME.color.route,
        opacity: 0.2,
        edge: 1.2,
        box: true
      })
    )
    // 胶囊默认沿 y 轴：转到大巷方向
    if (r.axis[0] !== 0) cap.rotation.z = Math.PI / 2
    else cap.rotation.x = Math.PI / 2
    cap.renderOrder = 7
    cap.userData = { kind: "refuge", id: r.id }
    g.add(cap)
    // 底座 + 两端加强环：读成"舱"而不是一根绿条
    const alongX = r.axis[0] !== 0
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(
        alongX ? len * 0.86 : rad * 1.7,
        12,
        alongX ? rad * 1.7 : len * 0.86
      ),
      new THREE.MeshLambertMaterial({ color: "#2b3a36" })
    )
    base.position.y = -rad * 0.92
    g.add(base)
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.4, 1.7, 0.8)
    })
    for (const sgn of [-1, 1]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(rad * 1.02, 4, 8, 48),
        ringMat
      )
      const o = sgn * (len / 2 - rad * 0.7)
      if (alongX) {
        ring.rotation.y = Math.PI / 2
        ring.position.x = o
      } else ring.position.z = o
      g.add(ring)
    }
    // 舱内发光芯（亮绿，泛光）
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(
        r.axis[0] ? len * 0.62 : rad * 0.9,
        rad * 0.7,
        r.axis[0] ? rad * 0.9 : len * 0.62
      ),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.2, 1.0, 0.5),
        transparent: true,
        opacity: 0.8
      })
    )
    g.add(core)
    group.add(g)
    pick.push(cap)
    refuges[r.id] = {
      id: r.id,
      top: new THREE.Vector3(r.at[0], rad * 2 + 20, -r.at[1]),
      center: new THREE.Vector3(r.at[0], 0, -r.at[1])
    }
  }

  return {
    group,
    pick,
    chambers,
    refuges,
    shafts,
    tick(t, state) {
      // 起火时室内红光闪烁
      for (const ch of Object.values(chambers)) {
        if (ch.state === "fire")
          ch.light.intensity =
            5.5 + 2 * Math.sin(t * 13) * Math.sin(t * 7.3 + 1)
        else ch.light.intensity = 4
        // 预警时棱边呼吸
        // 起火时整间玻璃房发亮并闪烁；预警时棱边呼吸
        const pulse =
          ch.state === "fire"
            ? 1.7 + 0.35 * Math.sin(t * 9) * Math.sin(t * 4.1)
            : ch.state === "warn"
              ? 0.75 + 0.25 * Math.sin(t * 5)
              : 1
        ch.mat.uniforms.uIntensity.value = pulse
      }
      void state
    }
  }
}

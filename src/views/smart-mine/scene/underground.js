/*
 * 井下：煤层面、工作面（采空区 / 在采 / 待采 / 规划）、巷道风流、抽采钻孔、传感器、采煤机与人员
 * ----------------------------------------------------------
 * 布置来自 layout.json（示意，见 docs/design/smart-mine/README.md）。
 * 全部物体挂在一个组里，setFade(k) 统一淡入淡出（透视 / 剖切时显示，实景时隐藏）；
 * update(dt, t, state) 每帧推进风流、钻孔抽采、采煤机与人员的动画。
 */
import * as THREE from "three"
import { Line2 } from "three/examples/jsm/lines/Line2.js"
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js"
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js"
import { COLORS, EXAG } from "./theme"
import { W, seamB } from "./terrain"

/** 发光色：超过辉光阈值才泛光 */
const glow = (c, k = 2.2) => new THREE.Color(c).multiplyScalar(k)

/** 东翼大巷中心线 x（与 prepare.py 的 MAIN_X 一致） */
const MAIN_X = 330

// ---------------- 材质 ----------------

/** 采空区：斜向阴影线 */
function goafMaterial(color, opacity) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    clipping: true,
    uniforms: {
      uC: { value: new THREE.Color(color) },
      uA: { value: opacity },
      uFade: { value: 1 }
    },
    vertexShader: /* glsl */ `
      #include <clipping_planes_pars_vertex>
      varying vec2 vP;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vP = wp.xz;
        vec4 mvPosition = viewMatrix * wp;
        #include <clipping_planes_vertex>
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      #include <clipping_planes_pars_fragment>
      uniform vec3 uC;
      uniform float uA, uFade;
      varying vec2 vP;
      void main() {
        #include <clipping_planes_fragment>
        float s = abs(fract((vP.x + vP.y) / 70.0) - 0.5);
        float hatch = smoothstep(0.36, 0.42, s);
        gl_FragColor = vec4(uC * (0.55 + 0.6 * hatch), uA * uFade * (0.55 + 0.45 * hatch));
        #include <colorspace_fragment>
      }
    `
  })
}

/**
 * 巷道风流：沿管道长度方向滚动的亮条（tube 的 uv.x 沿路径 0 → 1）。
 * dir = +1 顺着折线方向流、-1 逆向、0 不流（已闭巷道）；speed 由专题调节
 */
function flowMaterial(color, length, dir, opacity = 1) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    clipping: true,
    uniforms: {
      uC: { value: new THREE.Color(color) },
      uLen: { value: length },
      uDir: { value: dir },
      uT: { value: 0 },
      uBoost: { value: 0 },
      uA: { value: opacity },
      uFade: { value: 1 }
    },
    vertexShader: /* glsl */ `
      #include <clipping_planes_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        #include <clipping_planes_vertex>
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      #include <clipping_planes_pars_fragment>
      uniform vec3 uC;
      uniform float uLen, uDir, uT, uBoost, uA, uFade;
      varying vec2 vUv;
      void main() {
        #include <clipping_planes_fragment>
        // 每 160 m 一节亮条，速度约 300 m/s（画面上的示意速度）；风流专题下更亮更密
        float spacing = mix(160.0, 110.0, uBoost);
        float s = vUv.x * uLen / spacing - uT * uDir * 1.9;
        float k = smoothstep(0.55, 0.95, fract(s));
        float base = mix(1.25, 0.9, uBoost);
        float bright = base + (abs(uDir) > 0.0 ? k * (1.6 + 1.4 * uBoost) : 0.0);
        gl_FragColor = vec4(uC * bright, uA * uFade);
        #include <colorspace_fragment>
      }
    `
  })
}

function fatLine(points, color, width, res, opts = {}) {
  const g = new LineGeometry()
  g.setPositions(points.flatMap((p) => [p.x, p.y, p.z]))
  const m = new LineMaterial({
    color,
    linewidth: width,
    transparent: true,
    opacity: opts.opacity ?? 1,
    dashed: Boolean(opts.dash),
    dashSize: opts.dash?.[0] ?? 1,
    gapSize: opts.dash?.[1] ?? 1,
    depthWrite: false
  })
  m.resolution.copy(res)
  const l = new Line2(g, m)
  if (opts.dash) l.computeLineDistances()
  l.renderOrder = opts.order ?? 5
  return l
}

// ---------------- 构建 ----------------

export class Underground {
  /**
   * @param L layout.json
   * @param grid 全景高程网格
   * @param res 粗线分辨率（CSS 像素，随窗口更新）
   */
  constructor(L, grid, res) {
    this.L = L
    this.grid = grid
    this.res = res
    this.group = new THREE.Group()
    /** 淡入淡出要处理的材质：[材质, 原始不透明度] */
    this.fadeList = []
    this.flowMats = []
    this.lineMats = []
    this.wellMats = []
    /** 标注锚点（世界坐标） */
    this.anchors = {}
    this.dz = Object.fromEntries(L.seams.map((s) => [s.key, s.base]))
    this.active = L.panels.find((p) => p.status === "active")

    this._seamSheet(0, "#1a2a3a", 0.42)
    this._seamSheet(this.dz.E, "#1e2c3c", 0.16)
    this._panels()
    this._roadways()
    this._development()
    this._wells()
    this._sensors()
    this._shearer()
    this._people()
    this._collectAnchors()
  }

  /** 加进组里并登记淡入淡出 */
  _add(obj, mats = [obj.material]) {
    this.group.add(obj)
    for (const m of mats) {
      if (!m) continue
      if (m.uniforms?.uFade) this.fadeList.push([m, null])
      else {
        m.transparent = true
        this.fadeList.push([m, m.opacity])
      }
      if (m.isLineMaterial) this.lineMats.push(m)
    }
    return obj
  }

  onSeam(x, y, dz = 0, up = 0) {
    return W(this.L, x, y, seamB(this.L, x, y) + dz + up)
  }

  /** 煤层面：倾斜平面上的网格，去掉高出地表或低于底面的部分 */
  _seamSheet(dz, color, opacity) {
    const { L, grid } = this
    const n = 120
    const m = Math.round((n * grid.h) / grid.w)
    const pos = []
    const ok = []
    for (let j = 0; j <= m; j++) {
      for (let i = 0; i <= n; i++) {
        const x = grid.cx - grid.w / 2 + (i / n) * grid.w
        const y = grid.cy + grid.h / 2 - (j / m) * grid.h
        const z = seamB(L, x, y) + dz
        pos.push(x, (z - L.blockBase) * EXAG, -y)
        ok.push(z < grid.z(x, y) - 25 && z > L.blockBase + 5)
      }
    }
    const idx = []
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i
        const c = a + n + 1
        if (ok[a] && ok[a + 1] && ok[c] && ok[c + 1])
          idx.push(a, c, a + 1, a + 1, c, c + 1)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    const mesh = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    )
    mesh.renderOrder = 2
    this._add(mesh)
  }

  _quad(x0, y0, x1, y1, dz, mat) {
    const pts = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1]
    ].map(([x, y]) => this.onSeam(x, y, dz))
    const g = new THREE.BufferGeometry().setFromPoints(pts)
    g.setIndex([0, 1, 2, 0, 2, 3])
    const m = new THREE.Mesh(g, mat)
    m.renderOrder = 3
    return this._add(m)
  }

  _rect(x0, y0, x1, y1, dz, color, width, opts) {
    const pts = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0]
    ].map(([x, y]) => this.onSeam(x, y, dz, 2))
    return this._add(fatLine(pts, color, width, this.res, opts))
  }

  _solid(opacity) {
    return new THREE.MeshBasicMaterial({
      color: "#0b0d10",
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  }

  _panels() {
    for (const p of this.L.panels) {
      const dz = this.dz[p.seam]
      const [x0, y0, x1, y1] = p.rect
      if (p.status === "mined") {
        const old = p.seam === "E"
        this._quad(
          x0,
          y0,
          x1,
          y1,
          dz + 1,
          goafMaterial(old ? COLORS.goafOld : COLORS.goaf, old ? 0.4 : 0.62)
        )
        this._rect(x0, y0, x1, y1, dz, old ? "#8f8aa8" : "#b8aef0", 1.6, {
          opacity: 0.8
        })
      } else if (p.status === "active") {
        // 后退式回采：切眼（东端）到工作面之间已采成采空区，工作面以西是实体煤
        this._quad(p.face_x, y0, x1, y1, dz + 1, goafMaterial("#e0892e", 0.6))
        this._quad(x0, y0, p.face_x, y1, dz + 1, this._solid(0.85))
        this._rect(x0, y0, x1, y1, dz, "#ffb347", 2.2)
        // 综采工作面：一道发光的「墙」
        const zb = seamB(this.L, p.face_x, (y0 + y1) / 2) + dz
        this.face = new THREE.Mesh(
          new THREE.BoxGeometry(14, 30 * EXAG, y1 - y0),
          new THREE.MeshBasicMaterial({ color: glow(COLORS.face, 3.2) })
        )
        this.face.position.copy(W(this.L, p.face_x, (y0 + y1) / 2, zb + 12))
        this._add(this.face)
      } else if (p.status === "ready") {
        this._quad(x0, y0, x1, y1, dz + 1, this._solid(0.7))
        this._rect(x0, y0, x1, y1, dz, COLORS.ready, 1.8)
      } else {
        this._rect(x0, y0, x1, y1, dz, COLORS.ready, 1.4, {
          dash: [60, 45],
          opacity: 0.75
        })
      }
    }
  }

  /** 一条巷道：折线 → 管道，带风流动画 */
  _tube(pts, color, radius, dir, opacity = 1) {
    let len = 0
    for (let k = 0; k < pts.length - 1; k++)
      len += pts[k].distanceTo(pts[k + 1])
    // 两点直线用 LineCurve3（CurvePath 末端有浮点误差，TubeGeometry 求切线时会取到空点）
    const curve =
      pts.length === 2
        ? new THREE.LineCurve3(pts[0], pts[1])
        : new THREE.CatmullRomCurve3(pts, false, "chordal")
    const mat = flowMaterial(color, len, dir, opacity)
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(
        curve,
        Math.max(8, Math.ceil(len / 40)),
        radius,
        8,
        false
      ),
      mat
    )
    tube.renderOrder = 6
    this.flowMats.push(mat)
    return this._add(tube)
  }

  /**
   * 巷道与风流方向：新鲜风从主平硐进来，沿大巷向南、运输顺槽向东到工作面（蓝）；
   * 乏风经回风顺槽向西、回风石门向西到 Deer Creek 回风井抽出地面（红）
   */
  _roadways() {
    const { L, grid } = this
    const color = {
      main: COLORS.intake,
      gate: "#4aa8ff",
      bleeder: COLORS.ret,
      incline: COLORS.incline,
      shaft: COLORS.ret,
      old: COLORS.old
    }
    const radius = {
      main: 22,
      incline: 18,
      shaft: 22,
      bleeder: 14,
      gate: 10,
      old: 9
    }
    for (const r of L.roadways) {
      const pts = r.pts.map(([x, y, dz]) =>
        dz === null ? W(L, x, y, grid.z(x, y) + 20) : this.onSeam(x, y, dz, 5)
      )
      let c = color[r.kind]
      let dir = r.kind === "old" ? 0 : 1
      if (r.kind === "gate" && r.name.includes("回风")) {
        c = "#ff7a5a"
        dir = -1
      }
      this._tube(pts, c, radius[r.kind], dir, r.kind === "old" ? 0.6 : 1)
      if (r.kind === "shaft") this.shaftTop = pts[1].clone()
    }
  }

  /** LW-B07 运输顺槽正在掘进：画出已掘的一段和发光的掘进头 */
  _development() {
    const p = this.L.panels.find((q) => q.id === "LW-B07")
    if (!p) return
    const y = p.rect[1] - 20
    const x1 = MAIN_X + (p.rect[2] + 40 - MAIN_X) * 0.38
    this._tube(
      [this.onSeam(MAIN_X, y, 0, 5), this.onSeam(x1, y, 0, 5)],
      "#4aa8ff",
      10,
      1
    )
    this.heading = new THREE.Mesh(
      new THREE.SphereGeometry(30, 16, 10),
      new THREE.MeshBasicMaterial({ color: glow("#7fd0ff", 2.6) })
    )
    this.heading.position.copy(this.onSeam(x1, y, 0, 5))
    this.headingXY = [x1, y]
    this._add(this.heading)
  }

  /** 抽采钻孔：从地面钻场到采空区上方的竖线，虚线向上流动表示抽采 */
  _wells() {
    const { L } = this
    const dotGeo = new THREE.SphereGeometry(18, 12, 8)
    const dotMat = new THREE.MeshBasicMaterial({
      color: glow(COLORS.well, 1.6)
    })
    for (const w of L.wells) {
      const top = W(L, w.x, w.y, w.z + 4)
      const bottom = W(L, w.x, w.y, w.bottom)
      const line = fatLine([bottom, top], COLORS.well, 1.2, this.res, {
        opacity: 0.6,
        order: 7,
        dash: [40, 30]
      })
      this._add(line)
      this.wellMats.push(line.material)
      const dot = new THREE.Mesh(dotGeo, dotMat)
      dot.position.copy(top)
      dot.renderOrder = 8
      this._add(dot)
    }
  }

  /** 传感器：在采工作面周围的瓦斯 / CO / 风速测点，黄色为预警 */
  _sensors() {
    const [x0, y0, x1, y1] = this.active.rect
    const fx = this.active.face_x
    const list = [
      // 回风隅角（工作面与回风顺槽交点）是瓦斯最容易积聚的地方
      { x: fx + 30, y: y1 + 20, s: "warn", key: "T1" },
      { x: fx - 60, y: y1 + 20, s: "ok", key: "T2" },
      { x: fx - 600, y: y1 + 20, s: "ok" },
      { x: fx + 20, y: (y0 + y1) / 2, s: "ok", key: "T0" },
      { x: fx - 60, y: y0 - 20, s: "ok" },
      { x: x0 - 40, y: y0 - 20, s: "ok" },
      { x: x0 - 140, y: y1 + 20, s: "ok" },
      { x: MAIN_X, y: -400, s: "ok" },
      { x: MAIN_X, y: 500, s: "ok" },
      { x: x1 + 40, y: y1 + 20, s: "ok" }
    ]
    const geo = {
      ok: new THREE.SphereGeometry(22, 16, 10),
      warn: new THREE.SphereGeometry(34, 16, 10)
    }
    this.sensorAnchors = {}
    this.pulses = []
    for (const q of list) {
      const m = new THREE.Mesh(
        geo[q.s],
        new THREE.MeshBasicMaterial({ color: glow(COLORS[q.s], 2.6) })
      )
      m.position.copy(this.onSeam(q.x, q.y, 0, 26))
      m.renderOrder = 9
      this._add(m)
      if (q.key) this.sensorAnchors[q.key] = m.position.clone()
      if (q.s === "warn") {
        // 预警点外圈扩散的光环
        for (let i = 0; i < 2; i++) {
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(40, 52, 40).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({
              color: glow(COLORS.warn, 1.8),
              transparent: true,
              depthWrite: false,
              side: THREE.DoubleSide
            })
          )
          ring.position.copy(m.position)
          ring.userData.phase = i / 2
          ring.renderOrder = 9
          this._add(ring)
          this.pulses.push(ring)
        }
      }
    }
  }

  /** 采煤机：沿工作面往返的亮块（机头在运输顺槽一侧 = 南，机尾在回风顺槽一侧 = 北） */
  _shearer() {
    this.faceSpan = [this.active.rect[1], this.active.rect[3]]
    this.shearer = new THREE.Mesh(
      new THREE.BoxGeometry(40, 24 * EXAG, 34),
      new THREE.MeshBasicMaterial({ color: glow("#fff1c2", 3.4) })
    )
    this._add(this.shearer)
    this._placeShearer(0.5)
  }

  _placeShearer(k) {
    const [y0, y1] = this.faceSpan
    const y = y0 + (y1 - y0) * k
    const x = this.active.face_x - 10
    this.shearer.position.copy(this.onSeam(x, y, 0, 14))
  }

  /** 井下人员：按区域撒点（工作面 18、掘进 11、大巷 7、机电硐室 6、其他 4），每帧轻微游走 */
  _people() {
    const [x0, y0, , y1] = this.active.rect
    const fx = this.active.face_x
    const rnd = mulberry32(20261017)
    const spots = []
    const add = (n, f) => {
      for (let i = 0; i < n; i++) spots.push(f(i, n))
    }
    add(18, (i, n) => [fx - 25 - rnd() * 20, y0 + ((i + 0.5) / n) * (y1 - y0)])
    if (this.headingXY)
      add(11, () => [
        this.headingXY[0] - 20 - rnd() * 160,
        this.headingXY[1] + (rnd() - 0.5) * 16
      ])
    add(7, () => [MAIN_X + (rnd() - 0.5) * 20, 800 - rnd() * 5000])
    add(6, () => [MAIN_X + 40 + rnd() * 60, 820 + rnd() * 60])
    add(4, () => [x0 - 60 - rnd() * 100, y1 + 20])
    const geo = new THREE.SphereGeometry(12, 10, 6)
    const mat = new THREE.MeshBasicMaterial({ color: glow(COLORS.person, 1.9) })
    this.people = new THREE.InstancedMesh(geo, mat, spots.length)
    this.people.renderOrder = 9
    this.peopleSpots = spots.map(([x, y]) => ({ x, y, ph: rnd() * 6.28 }))
    this._add(this.people)
    this._placePeople(0)
  }

  _placePeople(t) {
    const m = new THREE.Matrix4()
    this.peopleSpots.forEach((p, i) => {
      const x = p.x + Math.sin(t * 0.3 + p.ph) * 8
      const y = p.y + Math.cos(t * 0.23 + p.ph) * 8
      m.makeTranslation(this.onSeam(x, y, 0, 18))
      this.people.setMatrixAt(i, m)
    })
    this.people.instanceMatrix.needsUpdate = true
  }

  /** 标注锚点 */
  _collectAnchors() {
    const L = this.L
    const [, y0, , y1] = this.active.rect
    const fy = (y0 + y1) / 2
    const center = (ids) => {
      const ps = L.panels.filter((p) => ids.includes(p.id))
      return [
        ps.reduce((a, p) => a + (p.rect[0] + p.rect[2]) / 2, 0) / ps.length,
        ps.reduce((a, p) => a + (p.rect[1] + p.rect[3]) / 2, 0) / ps.length
      ]
    }
    const bl = L.roadways.find((r) => r.kind === "bleeder").pts
    Object.assign(this.anchors, {
      faceU: this.onSeam(this.active.face_x, fy, 0, 30),
      goaf: this.onSeam(...center(["LW-B02", "LW-B03"]), 0, 20),
      ready: this.onSeam(...center(["LW-B06"]), 0, 20),
      planned: this.onSeam(...center(["LW-B07", "LW-B08"]), 0, 20),
      eold: this.onSeam(...center(["LW-E02", "LW-E03"]), this.dz.E, 20),
      mains: this.onSeam(MAIN_X, -300, 0, 20),
      incline: W(L, 310, 1175, seamB(L, 310, 1175) + 110),
      bleeder: this.onSeam(bl[0][0], (bl[0][1] + bl[1][1]) / 2, 0, 20),
      ...this.sensorAnchors
    })
    if (this.heading) this.anchors.heading = this.heading.position.clone()
  }

  // ---------------- 每帧 / 显示 ----------------

  /** 统一淡入淡出（0 隐藏 … 1 显示） */
  setFade(k) {
    this._fade = k
    this.group.visible = k > 0.01
    for (const [m, base] of this.fadeList) {
      if (base === null) m.uniforms.uFade.value = k
      else m.opacity = base * k
    }
  }

  /** 风流专题：亮条更密更亮 */
  setFlowBoost(k) {
    for (const m of this.flowMats) m.uniforms.uBoost.value = k
  }

  /** 粗线分辨率随窗口变化 */
  setResolution(w, h) {
    this.res.set(w, h)
    for (const m of this.lineMats) m.resolution.set(w, h)
  }

  /**
   * @param state 仿真快照里的工作面状态 { shearer: 0–1 机头→机尾 }
   */
  update(dt, t, state) {
    if (!this.group.visible) return
    for (const m of this.flowMats) m.uniforms.uT.value = t
    for (const m of this.wellMats) m.dashOffset = -t * 60
    for (const r of this.pulses) {
      const k = (t * 0.6 + r.userData.phase) % 1
      r.scale.setScalar(1 + k * 2.2)
      r.material.opacity = (1 - k) * (this._fade ?? 1)
    }
    if (state) this._placeShearer(state.shearer)
    this.face.material.color
      .set(COLORS.face)
      .multiplyScalar(2.8 + Math.sin(t * 3) * 0.6)
    this.heading?.scale.setScalar(1 + 0.25 * Math.sin(t * 5))
    this._placePeople(t)
  }
}

/** 可复现的伪随机数 */
function mulberry32(a) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

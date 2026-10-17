/*
 * 候诊大厅 三维场景（E 缤纷等距插画风）
 * ----------------------------------------------------------
 * 全部由 data/plan.json 程序化建模（scripts/waiting/build_plan.py 从 /hospital 的 CAD 截出 2F 内科组）：
 *   - 一块带圆角厚边的楼板（像玩具底座），中庭上空挖洞并围玻璃栏杆；
 *   - 墙按 CAD 矩形挤出：诊室前墙 / 隔墙剖到 1.4 m，外墙 2.6 m 带窗；墙脚一圈浅蓝条；
 *   - 8 间诊室按科室铺糖果色地面，诊桌、医生、检查床、洗手盆按 CAD 家具位置摆放；
 *   - 候诊区连排椅按 CAD 座位排，坐着大头卡通小人（人数 ≈ 当前候诊人数）；
 *     医生、护士、患者是 Blender 建的盲盒潮玩风人物（scripts/blender/waiting/，public/waiting/people.glb），
 *     场景先建好、记下每个人的座位，人物 GLB 异步加载完再摆上去（ready 为加载完成的 Promise）；
 *   - 每间诊室上方一根三色状态柱（自下而上：待诊 / 复诊 / 过诊，柱高 = 人数），柱顶标签由页面用 DOM 画；
 *   - 叫号中的诊室：地面染暖橙、冒一道渐隐光柱、门前两圈扩散光环、门打开；轮播中的诊室描一圈紫框。
 * 视觉以设计稿 docs/design/waiting/13-style-e-candy.png 为准，布局以 CAD 为准。
 *
 * 不依赖 Vue。生命周期：new WaitingScene(opts) → setData(snapshot) / focus(no) → dispose()
 * 回调：
 *   onAnchors([{ no, x, y }])   每间诊室状态柱顶的屏幕位置（画布内 CSS 像素），镜头或柱高变化时回调
 *   onPick(no)                  点击诊室（地面或状态柱）
 */
import * as THREE from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"

import PLAN from "../data/plan.json"
import { ROOMS } from "../data/rooms.js"
import { THEME } from "./theme"

const C = THEME.colors
// people.glb 里的人物（网格名 person_<key>）：候诊人群和诊室患者在 6 种患者里轮换
const PATIENT_KEYS = ["elder", "woman", "man_mask", "teen", "auntie", "granny"]
const [RX0, RY0, RX1, RY1] = PLAN.meta.region
const CX = (RX0 + RX1) / 2
const CY = (RY0 + RY1) / 2
const DEG = Math.PI / 180
const NORTH = Math.PI // 模型默认面朝 +z（南），转半圈面朝北（镜头一侧）

/** 平面坐标（x 向东、y 向北，米）+ 离地高度 → three.js 世界坐标（y 向上，北 = -z） */
const world = (x, y, h = 0) => new THREE.Vector3(x - CX, h, -(y - CY))

const mat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({
    color,
    roughness: 0.8,
    metalness: 0,
    ...extra
  })

/** 可复现的伪随机（装饰物、小人配色、座位顺序） */
function makeRng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 平面矩形 [x0, y0, x1, y1] + 高度区间 → 圆角方块几何（已摆到世界坐标）
 * r 为圆角半径，太薄的方向自动收小，避免 RoundedBoxGeometry 翻面
 */
function slabGeo([x0, y0, x1, y1], h0, h1, r = 0.04) {
  const w = Math.abs(x1 - x0)
  const d = Math.abs(y1 - y0)
  const h = h1 - h0
  const rr = Math.max(
    0.001,
    Math.min(r, w / 2 - 0.001, d / 2 - 0.001, h / 2 - 0.001)
  )
  const g = new RoundedBoxGeometry(w, h, d, 2, rr)
  const c = world((x0 + x1) / 2, (y0 + y1) / 2, (h0 + h1) / 2)
  g.translate(c.x, c.y, c.z)
  return g
}

/** 给几何体整体刷一个顶点色（合并成一个网格时区分部件颜色） */
function paint(g, color) {
  const c = new THREE.Color(color)
  const n = g.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3)
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3))
  return g
}

/** 一个部件：几何 + 颜色 + 局部位置 / 旋转 */
function part(g, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  g.rotateX(rx)
  g.rotateY(ry)
  g.rotateZ(rz)
  g.translate(x, y, z)
  return paint(g, color)
}
const rbox = (w, h, d, r) =>
  new RoundedBoxGeometry(
    w,
    h,
    d,
    2,
    Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)
  )
/** 合并前统一成非索引几何（RoundedBox 与球、胶囊的索引方式不同） */
const merge = (parts) =>
  mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))

/** 盆栽：白盆 + 几簇叶子 */
function plantGeo(rng, s = 1) {
  const parts = [
    part(
      new THREE.CylinderGeometry(0.2 * s, 0.15 * s, 0.32 * s, 14),
      C.pot,
      0,
      0.16 * s,
      0
    )
  ]
  const n = 5
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng()
    parts.push(
      part(
        new THREE.ConeGeometry(0.11 * s, 0.6 * s, 6),
        i % 2 ? C.leaf : C.leaf2,
        Math.cos(a) * 0.09 * s,
        0.58 * s,
        Math.sin(a) * 0.09 * s,
        Math.sin(a) * 0.35,
        0,
        -Math.cos(a) * 0.35
      )
    )
  }
  parts.push(
    part(new THREE.SphereGeometry(0.16 * s, 10, 8), C.leaf, 0, 0.62 * s, 0)
  )
  return merge(parts)
}

/** 椅子（面朝 +z，靠背在 -z） */
function chairGeo(color, back = true) {
  const parts = [part(rbox(0.46, 0.08, 0.44, 0.03), color, 0, 0.45, 0)]
  if (back) parts.push(part(rbox(0.46, 0.4, 0.07, 0.03), color, 0, 0.7, -0.2))
  parts.push(
    part(
      new THREE.CylinderGeometry(0.03, 0.03, 0.42, 6),
      C.seatFrame,
      0,
      0.21,
      0
    )
  )
  parts.push(
    part(
      new THREE.CylinderGeometry(0.2, 0.2, 0.03, 12),
      C.seatFrame,
      0,
      0.02,
      0
    )
  )
  return merge(parts)
}

export class WaitingScene {
  constructor({ canvas, container, onAnchors, onPick }) {
    this.canvas = canvas
    this.container = container
    this.onAnchors = onAnchors || (() => {})
    this.onPick = onPick || (() => {})
    this.rng = makeRng(20261017)
    this.time = 0
    this.colScale = 1 // 状态柱目标高度的整体倍数（录屏时先压成 0 再长出来）
    this.last = performance.now()

    // ---------- 渲染器：透明底，页面的浅紫渐变背景透出来
    const r = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    })
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    r.setClearColor(0x000000, 0)
    r.toneMapping = THREE.NeutralToneMapping // 保住糖果色，不发灰
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFShadowMap // r18x 起 PCFSoft 已并入 PCF
    this.renderer = r

    const scene = new THREE.Scene()
    this.scene = scene

    // ---------- 光：天光 + 一盏带软阴影的主光（从镜头一侧的东北上方打过来，人脸朝光）
    scene.add(new THREE.HemisphereLight("#ffffff", "#d8cdf5", 2.1))
    const key = new THREE.DirectionalLight("#fff6ea", 1.9)
    key.position.set(16, 34, -22)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    Object.assign(key.shadow.camera, {
      left: -28,
      right: 28,
      top: 26,
      bottom: -26,
      near: 1,
      far: 90
    })
    key.shadow.bias = -0.0006
    key.shadow.normalBias = 0.02
    key.shadow.radius = 4
    scene.add(key)
    const fill = new THREE.DirectionalLight("#e3ecff", 0.55)
    fill.position.set(-20, 18, 16)
    scene.add(fill)

    this.mats = {
      wall: mat(C.wall),
      skirt: mat(C.skirt),
      column: mat(C.column),
      band: mat(C.columnBand),
      slabSide: mat(C.slabSide, { roughness: 0.9 }),
      furn: mat(C.furn),
      wood: mat(C.wood),
      door: mat(C.door),
      doorWin: mat(C.doorWin, { roughness: 0.3 }),
      seat: mat(C.seat, { roughness: 0.6 }),
      seatFrame: mat(C.seatFrame, { roughness: 0.5, metalness: 0.2 }),
      bed: mat(C.bed),
      monitor: mat(C.monitor, { roughness: 0.4 }),
      screen: mat(C.screen, { emissive: C.screen, emissiveIntensity: 0.35 }),
      glass: new THREE.MeshStandardMaterial({
        color: C.glass,
        transparent: true,
        opacity: 0.45,
        roughness: 0.1,
        depthWrite: false
      }),
      vc: new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.75
      }),
      // Blender 人物：顶点色 + 稍亮的软胶质感
      toy: new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.55
      }),
      aux: mat(C.aux),
      stair: mat(C.stair),
      wc: mat(C.wc),
      lower: mat("#E9DFF7") // 中庭洞口下面看到的 1F 地面
    }

    this.clinics = {} // no → { tile, baseColor, column, beam, rings, door, patient, center, top }
    this._buildSlab()
    this._buildRooms()
    this._buildWalls()
    this._buildColumns()
    this._buildSeats()
    this._buildFurniture()
    this._buildClinics()
    this._buildStatusColumns()
    this.ready = this._loadPeople() // 人物 GLB 加载完成（页面据此撤掉加载遮罩）

    // ---------- 正交相机：方向固定（从北往南、俯角 THEME.camera.elevation），只改取景框（中心 + 半宽）
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400)
    const el = THEME.camera.elevation * DEG
    this.camera.position.copy(
      new THREE.Vector3(0, Math.sin(el), -Math.cos(el)).multiplyScalar(160)
    )
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(0, 0, 0)
    this.camera.updateMatrixWorld()
    this.view = null // 当前取景 { cx, cy, halfW }（相机空间）
    this.goal = null // 目标取景
    this.focusNo = null

    // ---------- 拾取
    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()
    this._onClick = (e) => this._click(e)
    canvas.addEventListener("click", this._onClick)

    this._onResize = () => this._resize()
    this.resizeObserver = new ResizeObserver(this._onResize)
    this.resizeObserver.observe(container)
    this._resize()

    this._loop = this._loop.bind(this)
    this.frameId = requestAnimationFrame(this._loop)
    if (import.meta.env.DEV) window.__waitingScene = this
  }

  // ================================================================ 建筑
  _buildSlab() {
    // 楼板：范围矩形挖掉中庭上空，挤出成带圆角厚边的底座；顶面铺地砖贴图
    const s = new THREE.Shape()
    s.moveTo(RX0 - CX, RY0 - CY)
    s.lineTo(RX1 - CX, RY0 - CY)
    s.lineTo(RX1 - CX, RY1 - CY)
    s.lineTo(RX0 - CX, RY1 - CY)
    s.closePath()
    const v = PLAN.void
    if (v) {
      const hole = new THREE.Path()
      // 洞口贴着范围东边（x = 39.6）时，留 0.01 的边，免得形状自交
      const x1 = Math.min(v[2], RX1 - 0.01)
      hole.moveTo(v[0] - CX, v[1] - CY)
      hole.lineTo(v[0] - CX, v[3] - CY)
      hole.lineTo(x1 - CX, v[3] - CY)
      hole.lineTo(x1 - CX, v[1] - CY)
      hole.closePath()
      s.holes.push(hole)
    }
    const bevel = 0.18
    const g = new THREE.ExtrudeGeometry(s, {
      depth: THEME.slab,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 3,
      curveSegments: 4
    })
    g.rotateX(-Math.PI / 2)
    g.translate(0, -(THEME.slab + bevel), 0)

    // 地砖贴图：1.2 m 一块，砖缝浅一档
    const cv = document.createElement("canvas")
    cv.width = cv.height = 128
    const ctx = cv.getContext("2d")
    ctx.fillStyle = C.floor
    ctx.fillRect(0, 0, 128, 128)
    ctx.fillStyle = C.tileLine
    ctx.fillRect(0, 0, 128, 3)
    ctx.fillRect(0, 0, 3, 128)
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(1 / 1.2, 1 / 1.2)
    tex.anisotropy = 8
    this.tileTex = tex
    const top = mat("#ffffff", { map: tex, roughness: 0.75 })
    const mesh = new THREE.Mesh(g, [top, this.mats.slabSide])
    mesh.receiveShadow = true
    this.scene.add(mesh)

    if (v) {
      // 洞口下面露出一块 1F 地面，暗示下面还有一层
      const lower = new THREE.Mesh(
        slabGeo([v[0], v[1], RX1, v[3]], -4.6, -4.5, 0.01),
        this.mats.lower
      )
      this.scene.add(lower)
      // 玻璃栏杆：南、北、西三边（东边是截取范围的切口，不围）
      const glass = []
      const rail = []
      const edges = [
        [v[0], v[1], RX1, v[1]],
        [v[0], v[3], RX1, v[3]],
        [v[0], v[1], v[0], v[3]]
      ]
      for (const [x0, y0, x1, y1] of edges) {
        const box =
          x0 === x1
            ? [x0 - 0.03, y0, x0 + 0.03, y1]
            : [x0, y0 - 0.03, x1, y0 + 0.03]
        glass.push(slabGeo(box, 0.05, 1.05, 0.01))
        const rb =
          x0 === x1
            ? [x0 - 0.06, y0, x0 + 0.06, y1]
            : [x0, y0 - 0.06, x1, y0 + 0.06]
        rail.push(slabGeo(rb, 1.05, 1.13, 0.04))
      }
      this.scene.add(new THREE.Mesh(mergeGeometries(glass), this.mats.glass))
      const railMesh = new THREE.Mesh(mergeGeometries(rail), this.mats.furn)
      railMesh.castShadow = true
      this.scene.add(railMesh)
    }
  }

  _buildRooms() {
    // 房间地面：诊室按科室糖果色（每间单独材质，叫号时要染色），其余按类型
    const colorOf = Object.fromEntries(ROOMS.map((r) => [r.no, r.color]))
    const others = { aux: [], stair: [], wc: [] }
    for (const room of PLAN.rooms) {
      if (room.open) continue // 开敞候诊区就是公共地砖
      const [x0, y0, x1, y1] = room.rect
      const inset = [x0 + 0.08, y0 + 0.08, x1 - 0.08, y1 - 0.08]
      const g = slabGeo(inset, 0.0, 0.025, 0.01)
      if (colorOf[room.num]) {
        const m = mat(colorOf[room.num], {
          polygonOffset: true,
          polygonOffsetFactor: -1
        })
        const tile = new THREE.Mesh(g, m)
        tile.receiveShadow = true
        tile.userData.no = room.num
        this.scene.add(tile)
        this.clinics[room.num] = {
          room,
          tile,
          baseColor: new THREE.Color(colorOf[room.num]),
          call: 0, // 叫号高亮 0–1（动画用）
          callGoal: 0
        }
      } else {
        const k =
          room.kind === "stair" ? "stair" : room.kind === "wc" ? "wc" : "aux"
        others[k].push(g)
      }
    }
    for (const [k, list] of Object.entries(others)) {
      if (!list.length) continue
      const m = this.mats[k].clone()
      Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -1 })
      const mesh = new THREE.Mesh(mergeGeometries(list), m)
      mesh.receiveShadow = true
      this.scene.add(mesh)
    }
    // 楼梯：几道踏步条纹
    const st = PLAN.rooms.find((q) => q.kind === "stair")
    if (st) {
      const [x0, y0, x1] = st.rect
      const steps = []
      for (let i = 0; i < 12; i++) {
        const y = y0 + 0.8 + i * 0.48
        steps.push(slabGeo([x0 + 0.5, y, x0 + 3.3, y + 0.24], 0.02, 0.05, 0.01))
        steps.push(slabGeo([x0 + 3.9, y, x1 - 0.5, y + 0.24], 0.02, 0.05, 0.01))
      }
      this.scene.add(new THREE.Mesh(mergeGeometries(steps), mat("#F3D27E")))
    }
  }

  _buildWalls() {
    // 外墙（贴着南边 y = 0、西边 x = 0）高、带窗；其余剖到 wallH。墙脚加一圈浅蓝条
    const walls = []
    const skirts = []
    const isExt = (b) => b[3] <= 0.35 || b[2] <= 0.35
    for (const b of PLAN.walls) {
      const h = isExt(b) ? THEME.extH : THEME.wallH
      walls.push(slabGeo(b, 0, h, 0.05))
      const [x0, y0, x1, y1] = b
      const thin =
        x1 - x0 < y1 - y0
          ? [x0 - 0.02, y0, x1 + 0.02, y1]
          : [x0, y0 - 0.02, x1, y1 + 0.02]
      skirts.push(slabGeo(thin, 0.02, 0.18, 0.02))
    }
    // 窗洞：窗台 + 玻璃 + 窗楣
    const glass = []
    for (const [o, c, a, b] of PLAN.windows) {
      const t = 0.15
      const box = o === "h" ? [a, c - t, b, c + t] : [c - t, a, c + t, b]
      walls.push(slabGeo(box, 0, THEME.sill, 0.03))
      walls.push(slabGeo(box, THEME.head, THEME.extH, 0.03))
      const gb =
        o === "h" ? [a, c - 0.03, b, c + 0.03] : [c - 0.03, a, c + 0.03, b]
      glass.push(slabGeo(gb, THEME.sill, THEME.head, 0.01))
    }
    const wm = new THREE.Mesh(mergeGeometries(walls), this.mats.wall)
    wm.castShadow = wm.receiveShadow = true
    this.scene.add(wm)
    this.scene.add(new THREE.Mesh(mergeGeometries(skirts), this.mats.skirt))
    if (glass.length)
      this.scene.add(new THREE.Mesh(mergeGeometries(glass), this.mats.glass))

    // 门：木色门扇（门轴一侧为原点，叫号时打开）
    this.doors = {}
    for (const room of PLAN.rooms) {
      if (!room.door) continue
      const { p, w, side } = room.door
      const h = THEME.wallH - 0.04
      const leaf = new THREE.Group()
      const panel = new THREE.Mesh(
        rbox(w - 0.06, h, 0.06, 0.02),
        this.mats.door
      )
      panel.position.set((w - 0.06) / 2, h / 2, 0)
      panel.castShadow = true
      const win = new THREE.Mesh(
        rbox(0.18, 0.42, 0.07, 0.02),
        this.mats.doorWin
      )
      win.position.set((w - 0.06) * 0.7, h * 0.62, 0)
      leaf.add(panel, win)
      // 门轴：南北向墙上的门沿 x 展开，东西向墙上的门沿 y 展开
      const along = side === "N" || side === "S"
      const hinge = along
        ? world(p[0] - w / 2 + 0.03, p[1], 0)
        : world(p[0], p[1] - w / 2 + 0.03, 0)
      leaf.position.copy(hinge)
      leaf.rotation.y = along ? 0 : Math.PI / 2
      leaf.userData.base = leaf.rotation.y
      // 往房间里开：北墙上的门（南排诊室）往南（+z）转、东墙上的门往西转……
      // 绕 y 轴转 a 角时门扇方向 (1, 0, 0) → (cos a, 0, -sin a)，据此定正负
      leaf.userData.dir = { N: -1, S: 1, E: 1, W: -1 }[side]
      this.scene.add(leaf)
      this.doors[room.num || room.id] = { leaf, open: 0, goal: 0 }
    }
  }

  _buildColumns() {
    const cols = []
    const bands = []
    for (const [x, y] of PLAN.columns) {
      cols.push(
        slabGeo([x - 0.3, y - 0.3, x + 0.3, y + 0.3], 0, THEME.colH, 0.08)
      )
      bands.push(
        slabGeo([x - 0.32, y - 0.32, x + 0.32, y + 0.32], 0.25, 0.42, 0.06)
      )
      bands.push(
        slabGeo(
          [x - 0.32, y - 0.32, x + 0.32, y + 0.32],
          THEME.colH - 0.42,
          THEME.colH - 0.3,
          0.06
        )
      )
    }
    const m = new THREE.Mesh(mergeGeometries(cols), this.mats.column)
    m.castShadow = m.receiveShadow = true
    this.scene.add(m)
    this.scene.add(new THREE.Mesh(mergeGeometries(bands), this.mats.band))
  }

  _buildSeats() {
    // 连排椅：坐垫 + 靠背用实例化网格，每排一根横梁 + 两条腿；座位列表留给候诊小人
    const seats = []
    for (const row of PLAN.seatRows) {
      const [x0, y0, x1, y1] = row.rect
      const pitch = (x1 - x0) / row.n
      for (let i = 0; i < row.n; i++)
        seats.push([x0 + pitch * (i + 0.5), (y0 + y1) / 2])
    }
    this.seats = seats
    const cushion = new THREE.InstancedMesh(
      rbox(0.46, 0.09, 0.44, 0.035),
      this.mats.seat,
      seats.length
    )
    const back = new THREE.InstancedMesh(
      rbox(0.46, 0.42, 0.07, 0.03),
      this.mats.seat,
      seats.length
    )
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, NORTH, 0))
    seats.forEach(([x, y], i) => {
      const p = world(x, y, 0.45)
      m4.compose(p, q, new THREE.Vector3(1, 1, 1))
      cushion.setMatrixAt(i, m4)
      // 靠背在南侧（人面朝北、朝镜头）
      m4.compose(world(x, y - 0.2, 0.7), q, new THREE.Vector3(1, 1, 1))
      back.setMatrixAt(i, m4)
    })
    cushion.castShadow = back.castShadow = true
    this.scene.add(cushion, back)
    const frames = []
    for (const row of PLAN.seatRows) {
      const [x0, y0, x1, y1] = row.rect
      const ym = (y0 + y1) / 2
      frames.push(
        slabGeo([x0 + 0.05, ym - 0.05, x1 - 0.05, ym + 0.05], 0.32, 0.4, 0.03)
      )
      for (const x of [x0 + 0.3, x1 - 0.3])
        frames.push(
          slabGeo([x - 0.04, ym - 0.04, x + 0.04, ym + 0.04], 0, 0.36, 0.02)
        )
    }
    this.scene.add(new THREE.Mesh(mergeGeometries(frames), this.mats.seatFrame))

    // 候诊小人：按固定随机顺序占座，显示人数 = 当前候诊人数（不与名单一一对应，只表现人气）
    const order = seats.map((_, i) => i)
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    this.crowdSlots = order.map((si) => ({
      x: seats[si][0],
      y: seats[si][1],
      rot: NORTH + (this.rng() - 0.5) * 0.35,
      phase: this.rng() * 6.28
    }))
    this.crowd = [] // 人物 GLB 加载完才有
    this.crowdGoal = 0
  }

  _buildFurniture() {
    // CAD 里的其余家具：柜台、护士站、处置室柜子、卫生间隔板……挤出成圆角矮块
    const blocks = []
    const tops = []
    for (const pts of PLAN.blocks) {
      const xs = pts.map((p) => p[0])
      const ys = pts.map((p) => p[1])
      const b = [
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs),
        Math.max(...ys)
      ]
      const area = (b[2] - b[0]) * (b[3] - b[1])
      if (pts.length === 4 && area < 40) {
        blocks.push(slabGeo(b, 0, THEME.furnH, 0.06))
        // 长条柜台加一块木色台面
        if (Math.max(b[2] - b[0], b[3] - b[1]) > 2)
          tops.push(
            slabGeo(
              [b[0] - 0.05, b[1] - 0.05, b[2] + 0.05, b[3] + 0.05],
              THEME.furnH,
              THEME.furnH + 0.06,
              0.03
            )
          )
      } else {
        // 护士站这类 U 形：按多边形挤出
        const sh = new THREE.Shape(
          pts.map(([x, y]) => new THREE.Vector2(x - CX, y - CY))
        )
        const g = new THREE.ExtrudeGeometry(sh, {
          depth: THEME.furnH,
          bevelEnabled: false
        })
        g.rotateX(-Math.PI / 2)
        blocks.push(g.index ? g.toNonIndexed() : g)
      }
    }
    if (blocks.length) {
      const m = new THREE.Mesh(merge(blocks), this.mats.furn)
      m.castShadow = m.receiveShadow = true
      this.scene.add(m)
    }
    if (tops.length)
      this.scene.add(new THREE.Mesh(mergeGeometries(tops), this.mats.wood))
    // 凳子（CAD 里的圆）
    const stool = chairGeo(C.chair, false)
    for (const [x, y] of PLAN.stools) {
      const s = new THREE.Mesh(stool, this.mats.vc)
      s.position.copy(world(x, y, 0))
      s.castShadow = true
      this.scene.add(s)
    }
    // 护士：分诊台后一位（面朝北、朝二次候诊），护士站里两位（面朝南、朝柜台）
    this.nurseSlots = []
    const triage = PLAN.blocks
      .map((pts) => pts.map((p) => p[1]))
      .findIndex((ys) => Math.min(...ys) > 27 && Math.max(...ys) < 29)
    if (triage >= 0) {
      const xs = PLAN.blocks[triage].map((p) => p[0])
      this.nurseSlots.push({
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: 27.15,
        rot: NORTH
      })
    }
    for (const [x, y] of PLAN.stools.filter(([, y]) => y > 26.5 && y < 27.5))
      this.nurseSlots.push({ x, y, rot: 0 })

    // 盆栽：走廊上诊室之间、候诊区柱子边、几个角落
    const spots = [
      [10.8, 7.75],
      [18.0, 7.75],
      [25.2, 7.75],
      [32.4, 7.75],
      [8.0, 13.6],
      [8.0, 22.4],
      [29.4, 23.4],
      [11.0, 31.6],
      [28.9, 31.6],
      [38.9, 6.4],
      [38.9, 24.0]
    ]
    const plantVariants = [
      plantGeo(this.rng, 1.2),
      plantGeo(this.rng, 1.0),
      plantGeo(this.rng, 1.35)
    ]
    spots.forEach(([x, y], i) => {
      const p = new THREE.Mesh(plantVariants[i % 3], this.mats.vc)
      p.position.copy(world(x, y, 0))
      p.rotation.y = this.rng() * 6.28
      p.castShadow = true
      this.scene.add(p)
    })
  }

  _buildClinics() {
    // 诊室：诊桌 + 显示器、医生椅 + 医生、患者凳 + 患者（就诊中才出现）、检查床、洗手盆、墙角盆栽
    const docChair = chairGeo(C.chair)
    const stool = chairGeo(C.chair, false)
    const sink = merge([
      part(rbox(0.6, 0.82, 0.48, 0.05), C.furn, 0, 0.41, 0),
      part(
        new THREE.CylinderGeometry(0.18, 0.14, 0.06, 16),
        C.screen,
        0,
        0.83,
        0.02
      )
    ])
    const plant = plantGeo(this.rng, 0.9)
    for (const [no, f] of Object.entries(PLAN.clinics)) {
      const c = this.clinics[no]
      const add = (m) => {
        m.castShadow = true
        this.scene.add(m)
        return m
      }
      // 诊桌：白色桌腿 + 木色桌面
      const [dx0, dy0, dx1, dy1] = f.desk
      add(
        new THREE.Mesh(
          slabGeo(
            [dx0 + 0.05, dy0 + 0.05, dx1 - 0.05, dy1 - 0.05],
            0,
            0.7,
            0.04
          ),
          this.mats.furn
        )
      )
      add(new THREE.Mesh(slabGeo(f.desk, 0.7, 0.76, 0.03), this.mats.wood))
      // 显示器（斜放在桌子靠外墙一角，镜头看得到侧面）
      const mon = new THREE.Group()
      const body = new THREE.Mesh(
        rbox(0.5, 0.34, 0.05, 0.02),
        this.mats.monitor
      )
      body.position.y = 0.32
      const scr = new THREE.Mesh(
        rbox(0.44, 0.28, 0.01, 0.005),
        this.mats.screen
      )
      scr.position.set(0, 0.32, -0.03)
      const leg = new THREE.Mesh(
        rbox(0.06, 0.16, 0.06, 0.02),
        this.mats.monitor
      )
      leg.position.y = 0.08
      mon.add(body, scr, leg)
      mon.position.copy(world(dx0 + 0.32, (dy0 + dy1) / 2, 0.76))
      mon.rotation.y = NORTH - 0.6
      add(mon)
      // 医生：坐在桌子和外墙之间，面朝北（朝患者和门）
      const dc = add(new THREE.Mesh(docChair, this.mats.vc))
      dc.position.copy(world(f.doctor[0], f.doctor[1], 0))
      dc.rotation.y = NORTH
      c.docSlot = { x: f.doctor[0], y: f.doctor[1], rot: NORTH }
      // 患者：坐在桌子靠门一侧，面朝南（朝医生）；叫号中、等待入室时这个位子空着
      const st = add(new THREE.Mesh(stool, this.mats.vc))
      st.position.copy(world(f.patient[0], f.patient[1], 0))
      c.patSlot = { x: f.patient[0], y: f.patient[1], rot: 0 }
      // 检查床：白色床架 + 蓝色床垫 + 枕头（枕头在床头一端）
      const [bx0, by0, bx1, by1] = f.bed
      add(
        new THREE.Mesh(
          slabGeo(
            [bx0 + 0.04, by0 + 0.04, bx1 - 0.04, by1 - 0.04],
            0,
            0.48,
            0.04
          ),
          this.mats.furn
        )
      )
      add(new THREE.Mesh(slabGeo(f.bed, 0.48, 0.62, 0.06), this.mats.bed))
      const hy = f.bedHead[1] > (by0 + by1) / 2 ? by1 - 0.35 : by0 + 0.05
      add(
        new THREE.Mesh(
          slabGeo([bx0 + 0.1, hy, bx1 - 0.1, hy + 0.3], 0.62, 0.72, 0.05),
          this.mats.furn
        )
      )
      // 洗手盆、墙角盆栽（外墙内侧、检查床对面一角）
      const sk = add(new THREE.Mesh(sink, this.mats.vc))
      sk.position.copy(world(f.sink[0], f.sink[1], 0))
      const [rx0, ry0] = c.room.rect
      const pl = add(new THREE.Mesh(plant, this.mats.vc))
      pl.position.copy(world(rx0 + 0.45, ry0 + 0.55, 0))

      const [x0, y0, x1, y1] = c.room.rect
      Object.assign(c, {
        patient: null, // 人物 GLB 加载完才有
        patGoal: 1,
        center: world((x0 + x1) / 2, (y0 + y1) / 2, 0),
        door: this.doors[no]
      })
    }
  }

  _buildStatusColumns() {
    // 三色状态柱 + 深色描边（反向外壳法）+ 柱脚光盘；叫号光柱、门前光环、轮播紫框
    const seg = new THREE.BoxGeometry(0.62, 1, 0.62)
    seg.translate(0, 0.5, 0)
    const outlineMat = new THREE.MeshBasicMaterial({
      color: C.outline,
      side: THREE.BackSide
    })
    const segMats = [
      mat(C.wait, { roughness: 0.5 }),
      mat(C.recheck, { roughness: 0.5 }),
      mat(C.missed, { roughness: 0.5 })
    ]
    const discGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.05, 28)
    const discMat = new THREE.MeshBasicMaterial({
      color: C.brand,
      transparent: true,
      opacity: 0.35,
      depthWrite: false
    })
    const beamMatBase = {
      uniforms: {
        uColor: { value: new THREE.Color(C.call) },
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uHeight: { value: 9 }
      },
      vertexShader: `
        varying float vH;
        void main() {
          vH = position.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uTime;
        uniform float uOpacity;
        uniform float uHeight;
        varying float vH;
        void main() {
          float t = clamp(vH / uHeight, 0.0, 1.0);
          // 自下而上渐隐，叠一层缓慢上行的明暗波纹
          float a = pow(1.0 - t, 1.6) * uOpacity * (0.8 + 0.2 * sin(uTime * 3.0 - vH * 1.2));
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    }
    const ringGeo = new THREE.RingGeometry(0.62, 0.76, 40)
    ringGeo.rotateX(-Math.PI / 2)
    for (const [no, c] of Object.entries(this.clinics)) {
      const [x0, y0, x1, y1] = c.room.rect
      const xm = (x0 + x1) / 2
      const g = new THREE.Group()
      g.position.copy(world(xm, y0 + 0.95, THEME.colBase))
      const segs = segMats.map((m) => {
        const mesh = new THREE.Mesh(seg, m)
        const ol = new THREE.Mesh(seg, outlineMat)
        ol.scale.set(1.12, 1, 1.12)
        mesh.add(ol)
        mesh.castShadow = true
        mesh.userData.no = no
        g.add(mesh)
        return mesh
      })
      const disc = new THREE.Mesh(discGeo, discMat)
      disc.position.y = -0.04
      g.add(disc)
      this.scene.add(g)

      // 叫号光柱：覆盖整间诊室，往上渐隐
      const H = 9
      const beamGeo = new THREE.BoxGeometry(x1 - x0 - 0.3, H, y1 - y0 - 0.3)
      beamGeo.translate(0, H / 2, 0)
      const beamMat = new THREE.ShaderMaterial({
        ...beamMatBase,
        uniforms: THREE.UniformsUtils.clone(beamMatBase.uniforms)
      })
      const beam = new THREE.Mesh(beamGeo, beamMat)
      beam.position.copy(world(xm, (y0 + y1) / 2, 0.03))
      beam.visible = false
      beam.renderOrder = 2
      this.scene.add(beam)

      // 门前两圈扩散光环（走廊地面上）
      const door = c.room.door
      const rings = [0, 1].map(() => {
        const m = new THREE.Mesh(
          ringGeo,
          new THREE.MeshBasicMaterial({
            color: C.call,
            transparent: true,
            opacity: 0,
            depthWrite: false
          })
        )
        m.position.copy(world(door.p[0], door.p[1] + 0.95, 0.04))
        m.visible = false
        m.renderOrder = 3
        this.scene.add(m)
        return m
      })

      // 轮播中的诊室：地面一圈紫框
      const fr = []
      const t = 0.14
      for (const b of [
        [x0 + 0.1, y0 + 0.1, x1 - 0.1, y0 + 0.1 + t],
        [x0 + 0.1, y1 - 0.1 - t, x1 - 0.1, y1 - 0.1],
        [x0 + 0.1, y0 + 0.1, x0 + 0.1 + t, y1 - 0.1],
        [x1 - 0.1 - t, y0 + 0.1, x1 - 0.1, y1 - 0.1]
      ])
        fr.push(slabGeo(b, 0.02, 0.07, 0.02))
      const frame = new THREE.Mesh(
        mergeGeometries(fr),
        new THREE.MeshBasicMaterial({ color: C.brand })
      )
      frame.visible = false
      this.scene.add(frame)

      Object.assign(c, {
        column: g,
        segs,
        heights: [0, 0, 0],
        goals: [0, 0, 0],
        beam,
        rings,
        frame
      })
    }
  }

  // ================================================================ 人物（Blender 建模，见 scripts/blender/waiting/）
  /** 加载 people.glb，按建场景时记下的座位摆上医生、护士、诊室患者和候诊人群 */
  async _loadPeople() {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    let gltf
    try {
      gltf = await loader.loadAsync(
        `${import.meta.env.BASE_URL}waiting/people.glb`
      )
    } catch (e) {
      console.error("候诊大厅人物模型加载失败", e)
      return
    }
    if (this.disposed) return
    const geo = {}
    gltf.scene.traverse((o) => {
      if (o.isMesh) geo[o.name.replace("person_", "")] = o.geometry
    })
    // 模型按 Q 版小椅子（座面 THEME.modelSeat）建，放大到真实座面 0.45 m
    const S = THEME.personScale
    const make = (g, { x, y, rot }) => {
      const m = new THREE.Mesh(g, this.mats.toy)
      m.position.copy(world(x, y, 0))
      m.rotation.y = rot
      m.scale.setScalar(S)
      m.castShadow = true
      this.scene.add(m)
      return m
    }
    const pats = PATIENT_KEYS.map((k) => geo[k])
    // 诊室：男女医生交替；患者从第 3 种开始轮换，免得和门口候诊的第一排撞脸
    Object.values(this.clinics).forEach((c, k) => {
      make(geo[k % 2 ? "doctor_f" : "doctor_m"], c.docSlot)
      c.patient = make(pats[(k + 2) % pats.length], c.patSlot)
      c.patient.userData = { s: c.patGoal, goal: c.patGoal }
      c.patient.scale.setScalar(S * c.patGoal)
      c.patient.visible = c.patGoal > 0
    })
    for (const n of this.nurseSlots) make(geo.nurse, n)
    // 候诊人群：先全部藏起来，按 crowdGoal 逐个弹出
    this.crowd = this.crowdSlots.map((slot, i) => {
      const m = make(pats[i % pats.length], slot)
      m.visible = false
      m.scale.setScalar(0.001)
      m.userData = { s: 0, phase: slot.phase }
      return m
    })
    if (this.lastSnap) this.setData(this.lastSnap)
  }

  // ================================================================ 数据
  /** 模拟器快照 → 状态柱高度、叫号高亮、患者在不在、开门、候诊人数 */
  setData(snap) {
    if (!snap) return
    this.lastSnap = snap
    for (const r of snap.rooms) {
      const c = this.clinics[r.no]
      if (!c) continue
      c.goals = [r.waiting.length, r.recheck.length, r.missed.length].map(
        (n) => n * THEME.unit
      )
      const calling = r.state === "calling"
      c.callGoal = calling ? 1 : 0
      c.patGoal = r.state === "consulting" ? 1 : 0
      if (c.patient) c.patient.userData.goal = c.patGoal
      if (c.door) c.door.goal = calling ? 1 : 0
    }
    this.crowdGoal = Math.min(
      this.crowd.length,
      snap.totals.waiting + snap.totals.recheck
    )
  }

  /** 镜头推近某间诊室（no）或回到全景（null） */
  focus(no) {
    this.focusNo = no && this.clinics[no] ? no : null
    for (const [k, c] of Object.entries(this.clinics))
      c.frame.visible = k === this.focusNo
    this.goal = this._viewFor(this.focusNo)
  }

  // ================================================================ 相机
  /** 世界坐标 → 相机空间（x 向右、y 向上） */
  _toCam(v) {
    return v.clone().applyMatrix4(this.camera.matrixWorldInverse)
  }

  _viewFor(no) {
    if (!this.size) return null
    const [w, h] = this.size
    const aspect = w / h
    if (no) {
      // 推近：取景中心放在诊室门口一带、略高（上面框进状态柱和标签，下面露出走廊和第一排座椅），半宽固定
      const c = this.clinics[no]
      const p = this._toCam(
        c.center.clone().add(new THREE.Vector3(0, 4.8, -2.6))
      )
      return { cx: p.x, cy: p.y, halfW: THEME.camera.focusHalfW }
    }
    // 全景：楼板四角 + 柱顶以上留出标签的位置
    const pts = []
    for (const x of [RX0 - 0.3, RX1 + 0.3])
      for (const y of [RY0 - 0.3, RY1 + 0.3])
        for (const hh of [-THEME.slab - 0.2, 0.2]) pts.push(world(x, y, hh))
    for (const c of Object.values(this.clinics)) {
      const top = THEME.colBase + 14 * THEME.unit + 6 // 柱顶以上还有标签和"叫号中"小签
      pts.push(c.column.position.clone().setY(top))
    }
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const v of pts) {
      const q = this._toCam(v)
      minX = Math.min(minX, q.x)
      maxX = Math.max(maxX, q.x)
      minY = Math.min(minY, q.y)
      maxY = Math.max(maxY, q.y)
    }
    const pad = THEME.camera.padding
    const halfW =
      Math.max((maxX - minX) / 2, ((maxY - minY) / 2) * aspect) * pad
    return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, halfW }
  }

  _applyView() {
    const [w, h] = this.size
    const { cx, cy, halfW } = this.view
    const halfH = halfW * (h / w)
    Object.assign(this.camera, {
      left: cx - halfW,
      right: cx + halfW,
      top: cy + halfH,
      bottom: cy - halfH
    })
    this.camera.updateProjectionMatrix()
  }

  _resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.size = [w, h]
    this.renderer.setSize(w, h, false)
    this.goal = this._viewFor(this.focusNo)
    if (!this.view) this.view = { ...this.goal }
    this._applyView()
  }

  _click(e) {
    const rect = this.canvas.getBoundingClientRect()
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const targets = []
    for (const c of Object.values(this.clinics)) targets.push(c.tile, ...c.segs)
    const hit = this.raycaster.intersectObjects(targets, false)[0]
    if (hit) this.onPick(hit.object.userData.no)
  }

  // ================================================================ 动画
  _loop() {
    this.frameId = requestAnimationFrame(this._loop)
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    this.time += dt
    if (!this.size || !this.view) return
    const k = 1 - Math.exp(-dt * 3.2) // 取景、柱高的平滑系数
    let moving = false

    // 取景：中心和半宽一起缓动
    if (this.goal) {
      for (const key of ["cx", "cy", "halfW"]) {
        const d = this.goal[key] - this.view[key]
        if (Math.abs(d) > 1e-3) {
          this.view[key] += d * k
          moving = true
        }
      }
      if (moving) this._applyView()
    }

    for (const c of Object.values(this.clinics)) {
      // 状态柱
      let y = 0
      c.segs.forEach((m, i) => {
        const d = c.goals[i] * this.colScale - c.heights[i]
        if (Math.abs(d) > 1e-3) {
          c.heights[i] += d * k
          moving = true
        }
        const hh = Math.max(c.heights[i], 0.001)
        m.visible = c.heights[i] > 0.02
        m.scale.y = hh
        m.position.y = y
        y += m.visible ? hh : 0
      })
      c.colTop = y
      // 叫号高亮：地面染色、光柱、光环
      c.call += (c.callGoal - c.call) * Math.min(1, dt * 4)
      c.tile.material.color.lerpColors(
        c.baseColor,
        new THREE.Color(C.callFloor),
        c.call
      )
      c.beam.visible = c.call > 0.02
      c.beam.material.uniforms.uOpacity.value = 0.55 * c.call
      c.beam.material.uniforms.uTime.value = this.time
      c.rings.forEach((ring, i) => {
        ring.visible = c.call > 0.02
        const ph = (this.time * 0.7 + i * 0.5) % 1
        ring.scale.setScalar(1 + ph * 1.6)
        ring.material.opacity = (1 - ph) * 0.9 * c.call
      })
      // 患者进出诊室：缩放弹出 / 收起
      const p = c.patient
      if (!p) continue
      p.userData.s += (p.userData.goal - p.userData.s) * Math.min(1, dt * 5)
      p.visible = p.userData.s > 0.02
      p.scale.setScalar(THEME.personScale * p.userData.s)
    }
    // 门：叫号时打开，患者进门后关上
    for (const d of Object.values(this.doors)) {
      d.open += (d.goal - d.open) * Math.min(1, dt * 3)
      d.leaf.rotation.y =
        d.leaf.userData.base + d.leaf.userData.dir * d.open * 75 * DEG
    }
    // 候诊小人：前 crowdGoal 个座位有人，增减时弹出 / 收起；坐着轻微呼吸起伏
    this.crowd.forEach((m, i) => {
      const goal = i < this.crowdGoal ? 1 : 0
      const u = m.userData
      u.s += (goal - u.s) * Math.min(1, dt * 4)
      m.visible = u.s > 0.02
      if (!m.visible) return
      const b = 1 + Math.sin(this.time * 1.6 + u.phase) * 0.012
      m.scale.set(
        THEME.personScale * u.s,
        THEME.personScale * u.s * b,
        THEME.personScale * u.s
      )
    })

    this.renderer.render(this.scene, this.camera)
    if (moving || !this.anchorsAt || now - this.anchorsAt > 500)
      this._emitAnchors(now)
  }

  /** 每间诊室状态柱顶的屏幕位置（画布内 CSS 像素） */
  _emitAnchors(now) {
    this.anchorsAt = now
    const [w, h] = this.size
    const out = []
    for (const [no, c] of Object.entries(this.clinics)) {
      const v = c.column.position.clone()
      v.y += (c.colTop || 0) + 0.2
      const p = v.project(this.camera)
      out.push({ no, x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h })
    }
    this.onAnchors(out)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frameId)
    this.resizeObserver.disconnect()
    this.canvas.removeEventListener("click", this._onClick)
    const mats = new Set()
    const geos = new Set()
    this.scene.traverse((o) => {
      if (o.geometry) geos.add(o.geometry)
      if (!o.material) return
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        mats.add(m)
    })
    geos.forEach((g) => g.dispose())
    mats.forEach((m) => m.dispose())
    this.tileTex.dispose()
    this.renderer.dispose()
    if (window.__waitingScene === this) delete window.__waitingScene
  }
}

/*
 * 楼层级三维场景：标准办公层去顶俯视（设计稿 docs/design/building/03-ai-floor.png、13-draft-floor.png）
 * ----------------------------------------------------------
 *   - 楼层本体：Blender 精细建模 + Cycles 烘焙（scripts/blender/tower/detail.py → public/building/floor_S|N.glb），
 *     MeshBasicMaterial 显示（光照已烘在颜色里）
 *   - 玻璃幕墙：整圈蓝玻璃（竖梃网格）+ 顶部一圈发光边；会议室等的玻璃隔断（铝框在模型里，玻璃在这里）
 *   - 上下各两层线框楼层（爆炸剥离）：楼板轮廓、竖梃、核心筒与房间分隔线
 *   - 房间覆盖层：按类型着色的地面光面 + 轮廓光带，悬浮 / 选中高亮，告警房间红色呼吸
 *   - 四种视图（setMode）：room 房间 / device 设备点位图标 / heat 温度热力 / desk 工位占用
 * 平面数据（three.js 的 x、z，原点为塔楼形心）来自 data/floor.js（几何由 plan.py 生成，与 GLB 对齐）。
 * 交互：悬浮房间 → onHover({ room, x, y })；点击 → onPick(roomId)；select(roomId) 金色高亮；大会议室标签「进入房间」→ onEnter(roomId)。
 */
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js"
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js"
import {
  CSS2DObject,
  CSS2DRenderer
} from "three/examples/jsm/renderers/CSS2DRenderer.js"
import { loadFloorVariants } from "../tower/bakedFloors"
import { glassMaterial } from "../tower/floorKit"
import { loftGeometry } from "../tower/geometry"
import { DEVICE_TYPES } from "../../data/floor"

const DEG = Math.PI / 180
const GLASS_H = 3.5 // 幕墙玻璃高度（层高 3.8 m，顶上留一条楼板缝）
const GHOST_GAP = 10 // 上下线框楼层的间距（爆炸剥离，比层高大得多）
const LABEL_TYPES = new Set([
  "office",
  "conference",
  "meeting",
  "manager",
  "pantry",
  "machine",
  "lobby"
])

/** 各视图下房间覆盖层的不透明度 */
const MODE_FILL = { room: 1, device: 0.25, heat: 0, desk: 0.25 }

export class FloorScene {
  /**
   * @param {Object} o
   * @param {HTMLCanvasElement} o.canvas
   * @param {HTMLElement} o.container
   * @param {HTMLElement} o.labelLayer CSS2D 标签层
   * @param {Object} o.data data/floor.js 的 floorDetail()
   * @param {string} o.modelUrl 烘焙楼层 GLB
   */
  constructor(o) {
    this.canvas = o.canvas
    this.container = o.container
    this.onHover = o.onHover
    this.onPick = o.onPick
    this.onEnter = o.onEnter // 大会议室标签上的「进入房间」
    this.mode = "room"
    this.selected = null
    this.hovered = null
    this.clock = new THREE.Clock()

    const r = (this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: "high-performance"
    }))
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    r.outputColorSpace = THREE.SRGBColorSpace
    r.toneMapping = THREE.NeutralToneMapping

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x020a1c)
    this.scene.add(new THREE.HemisphereLight(0x6f94d6, 0x0b1426, 1.0))

    this.camera = new THREE.PerspectiveCamera(28, 1, 1, 2000)
    this.controls = new OrbitControls(this.camera, this.canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.enablePan = false
    this.controls.minPolarAngle = 22 * DEG
    this.controls.maxPolarAngle = 72 * DEG

    this.labelRenderer = new CSS2DRenderer({ element: o.labelLayer })
    // 后处理目标开 MSAA（默认目标不带，细线会发虚）；辉光只给真光源（门槛 0.9）
    this.composer = new EffectComposer(
      r,
      new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        samples: 4
      })
    )
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.composer.addPass(
      new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.25, 0.9)
    )
    this.composer.addPass(new OutputPass())

    this.plan = o.data.plan
    this._buildShell()
    this._buildGhosts()
    this.dyn = new THREE.Group() // 随楼层数据重建的部分（覆盖层、标签、图标、工位、热力）
    this.scene.add(this.dyn)
    this.setData(o.data)

    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()
    this._onMove = this._onMove.bind(this)
    this._onLeave = () => this._setHover(null)
    this._onClick = this._onClick.bind(this)
    this._onDown = (e) => (this.downAt = [e.clientX, e.clientY])
    this.canvas.addEventListener("pointermove", this._onMove)
    this.canvas.addEventListener("pointerleave", this._onLeave)
    this.canvas.addEventListener("pointerdown", this._onDown)
    this.canvas.addEventListener("click", this._onClick)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.container)
    this.resize()
    this._fitCamera()
    this._loop = this._loop.bind(this)
    this.frameId = requestAnimationFrame(this._loop)
    this.ready = this._loadModel(o.modelUrl)
  }

  // ================================================================ 构建

  /** 烘焙楼层模型：floor（楼板 + 墙，贴图）与 floor_v（家具，顶点色） */
  async _loadModel(url) {
    const v = await loadFloorVariants(url)
    if (this.disposed) return
    const g = new THREE.Group()
    for (const part of v.floor?.parts || [])
      g.add(new THREE.Mesh(part.geometry, part.material))
    this.scene.add(g)
    this.model = g
  }

  /** 幕墙玻璃 + 顶部发光边 + 楼板外沿光线；玻璃隔断 */
  _buildShell() {
    const P = this.plan
    const ring = P.slab
    this.glass = glassMaterial(0x1650c0, [0.008, 0.035, 0.11], {
      mull: 2.4,
      color: [0.07, 0.28, 0.55]
    })
    // 当前层幕墙要通透：前排工位隔着玻璃也要看得清，轮廓光只留一点
    this.glass.opacity = 0.07
    this.glass.userData.u.uEdgeK.value = 0.3
    const shell = new THREE.Mesh(
      loftGeometry([0, GLASS_H].map((y) => ring.map(([x, z]) => [x, y, z]))),
      this.glass
    )
    shell.renderOrder = 3
    this.scene.add(shell)
    // 顶边、底边：有厚度的发光带（设计稿楼层外圈一道亮青色的边）
    const rim = (y0, y1, color) =>
      new THREE.Mesh(
        loftGeometry(
          [y0, y1].map((y) => ring.map(([x, z]) => [x * 1.003, y, z * 1.003]))
        ),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
      )
    this.scene.add(rim(GLASS_H - 0.12, GLASS_H, new THREE.Color(0.5, 1.2, 1.8)))
    // 底边：楼板外沿一圈更宽的亮青色（设计稿楼层底部一道明显的光边）
    this.scene.add(rim(-0.45, -0.05, new THREE.Color(0.35, 0.95, 1.6)))
    // 玻璃隔断（会议室、经理室、茶水间）：铝框在模型里，这里补淡蓝玻璃
    const pos = []
    for (const [x0, z0, x1, z1] of P.glass) {
      const a = [x0, 0.08, z0]
      const b = [x1, 0.08, z1]
      const c = [x1, 2.7, z1]
      const d = [x0, 2.7, z0]
      pos.push(...a, ...b, ...c, ...a, ...c, ...d)
    }
    const pg = new THREE.BufferGeometry()
    pg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    const panes = new THREE.Mesh(
      pg,
      new THREE.MeshBasicMaterial({
        color: 0xcfe6ff,
        transparent: true,
        opacity: 0.06,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    )
    panes.renderOrder = 2
    this.scene.add(panes)
    // 玻璃隔断顶边一道细亮线（设计稿玻璃房间的边框在暗处也读得出）
    const top = []
    for (const [x0, z0, x1, z1] of P.glass) top.push(x0, 2.72, z0, x1, 2.72, z1)
    const tg = new THREE.BufferGeometry()
    tg.setAttribute("position", new THREE.Float32BufferAttribute(top, 3))
    this.scene.add(
      new THREE.LineSegments(
        tg,
        new THREE.LineBasicMaterial({
          color: new THREE.Color(0.55, 0.85, 1.2),
          transparent: true,
          opacity: 0.6,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      )
    )
  }

  /** 上下各两层线框楼层：楼板轮廓（上下两圈）、竖梃、核心筒与房间分隔线、淡淡的楼板面 */
  _buildGhosts() {
    const P = this.plan
    this.ghosts = []
    for (const k of [-2, -1, 1, 2]) {
      const g = new THREE.Group()
      const y0 = k * GHOST_GAP
      // 上方的线框层挡在当前层前面（相机在斜上方），要比下方的淡
      const fade = (Math.abs(k) === 1 ? 1 : 0.5) * (k > 0 ? 0.45 : 1)
      const line = (pts, op) => {
        const m = new THREE.LineBasicMaterial({
          color: new THREE.Color(0.25, 0.6, 1.0),
          transparent: true,
          opacity: op * fade,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
        const geo = new THREE.BufferGeometry()
        geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3))
        return new THREE.LineSegments(geo, m)
      }
      const loop = (poly, y) => {
        const out = []
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i]
          const b = poly[(i + 1) % poly.length]
          out.push(a[0], y, a[1], b[0], y, b[1])
        }
        return out
      }
      g.add(line([...loop(P.slab, 0), ...loop(P.slab, GLASS_H)], 0.85))
      // 竖梃：沿周长每 3 m 一根
      const mull = []
      let acc = 0
      for (let i = 0; i < P.slab.length; i++) {
        const a = P.slab[i]
        const b = P.slab[(i + 1) % P.slab.length]
        const L = Math.hypot(b[0] - a[0], b[1] - a[1])
        for (let t = (3 - acc) % 3; t < L; t += 3) {
          const x = a[0] + ((b[0] - a[0]) * t) / L
          const z = a[1] + ((b[1] - a[1]) * t) / L
          mull.push(x, 0, z, x, GLASS_H, z)
        }
        acc = (acc + L) % 3
      }
      g.add(line(mull, 0.18))
      // 一圈很淡的玻璃面（设计稿上下层是一道道玻璃环，不只是线）；只给下方的层，上方的层横在画面中间会蒙住当前层
      if (k < 0)
        g.add(
          new THREE.Mesh(
            loftGeometry(
              [0, GLASS_H].map((y) => P.slab.map(([x, z]) => [x, y, z]))
            ),
            new THREE.MeshBasicMaterial({
              color: new THREE.Color(0.02, 0.07, 0.16).multiplyScalar(fade),
              transparent: true,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
              side: THREE.DoubleSide
            })
          )
        )
      // 平面线：核心筒 + 房间轮廓
      const lines = [...loop(P.core, 0.02), ...loop(P.core, 2.8)]
      for (const r of P.rooms) lines.push(...loop(r.poly, 0.02))
      g.add(line(lines, 0.3))
      // 楼板面：很淡的蓝（只给下方的层，上方的层只留线）
      if (k > 0) {
        g.position.y = y0
        g.userData.base = y0
        this.scene.add(g)
        this.ghosts.push(g)
        continue
      }
      const shape = new THREE.Shape(
        P.slab.map(([x, z]) => new THREE.Vector2(x, -z))
      )
      const plate = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(0.01, 0.03, 0.07).multiplyScalar(fade),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      )
      plate.rotation.x = -Math.PI / 2
      g.add(plate)
      g.position.y = y0
      g.userData.base = y0
      this.scene.add(g)
      this.ghosts.push(g)
    }
  }

  /** 换楼层 / 首次：重建覆盖层、标签、设备图标、工位、热力 */
  setData(data) {
    this.data = data
    disposeTree(this.dyn)
    this.dyn.clear()
    for (const el of this.labels || []) el.element.remove()
    this.labels = []
    this.hitTargets = []
    this.roomViews = new Map()
    this._buildRooms()
    this._buildDevices()
    this._buildDesks()
    this._buildHeat()
    this._buildAlarm()
    this.enterT = 0 // 换层动画：线框楼层从远处收拢、覆盖层淡入
    this.setMode(this.mode)
    if (this.selected) this.select(this.selected)
  }

  /** 房间：地面着色光面（也是拾取体）+ 轮廓光带 + 标签 */
  _buildRooms() {
    for (const room of this.data.rooms) {
      const col = new THREE.Color(room.color)
      const shape = new THREE.Shape(
        room.poly.map(([x, z]) => new THREE.Vector2(x, -z))
      )
      const fillMat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
      const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), fillMat)
      fill.rotation.x = -Math.PI / 2
      fill.position.y = 0.06
      fill.userData.room = room
      this.dyn.add(fill)
      this.hitTargets.push(fill)
      // 轮廓：地面一圈 + 隔墙顶一圈（选中时金色发光）
      const edgeMat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      })
      const edge = new THREE.Group()
      edge.add(new THREE.Mesh(ribbonGeometry(room.poly, 0.08, 0.14), edgeMat))
      edge.add(new THREE.Mesh(ribbonGeometry(room.poly, 2.82, 0.1), edgeMat))
      this.dyn.add(edge)
      // 基础亮度：按类型（核心筒、卫生间等很淡）。只是一层淡淡的色调——设计稿房间的颜色像是灯光染出来的，
      // 地面材质、家具阴影都还看得见，不能整片盖住烘焙出来的地面
      const base =
        room.type === "office"
          ? 0.03
          : room.type === "lobby" || room.type === "stair"
            ? 0.015
            : 0.07
      this.roomViews.set(room.id, { room, fillMat, edgeMat, base })
      if (LABEL_TYPES.has(room.type)) this._roomLabel(room)
    }
  }

  _roomLabel(room) {
    const el = document.createElement("div")
    const lv = room.level
    el.className = `fl-label ${lv === "alarm" ? "red" : lv === "busy" ? "gold" : ""}`
    let tail = ""
    if (room.type === "office") tail = `<em class="num">${room.status}</em>`
    else if (room.type === "conference" || room.type === "meeting")
      tail = room.level === "busy" ? `<em>使用中 · ${room.people} 人</em>` : ""
    else if (room.type === "machine")
      tail = room.level === "alarm" ? "<em>· 过温</em>" : ""
    const name =
      room.type === "lobby" ? "核心筒 · 电梯 6 部" : `${room.id} ${room.name}`
    el.innerHTML = `${name}${tail}`
    // 大会议室有房间级精细模型：标签上加「进入房间」入口（标签层不接收鼠标，按钮单独打开）
    if (room.type === "conference" && this.onEnter) {
      const btn = document.createElement("button")
      btn.className = "enter"
      btn.textContent = "进入房间 ›"
      btn.addEventListener("click", (e) => {
        e.stopPropagation()
        this.onEnter(room.id)
      })
      el.appendChild(btn)
    }
    const obj = new CSS2DObject(el)
    obj.position.set(room.center[0], 3.4, room.center[1])
    this.dyn.add(obj)
    this.labels.push(obj)
  }

  /** 设备视图：吊顶高度上的发光图标（按类型着色，告警红色、离线灰色） */
  _buildDevices() {
    const g = new THREE.Group()
    const tex = {}
    for (const d of this.data.devices) {
      const key = d.alarm ? "alarm" : d.offline ? "off" : d.type
      if (!tex[key]) {
        const t = DEVICE_TYPES[d.type]
        tex[key] = iconTexture(
          d.alarm ? "#ff4d5a" : d.offline ? "#7f8a99" : t.color,
          d.alarm ? "!" : t.glyph
        )
      }
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: tex[key],
          transparent: true,
          depthWrite: false,
          depthTest: false
        })
      )
      s.position.set(d.p[0], 3.0, d.p[1])
      s.scale.setScalar(d.alarm ? 1.5 : 1.05)
      s.userData.alarm = d.alarm
      s.renderOrder = 6
      g.add(s)
      // 细立杆：图标到地面，读得出点位落在哪
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(d.p[0], 0.05, d.p[1]),
        new THREE.Vector3(d.p[0], 2.7, d.p[1])
      ])
      g.add(
        new THREE.Line(
          geo,
          new THREE.LineBasicMaterial({
            color: d.alarm ? 0xff4d5a : DEVICE_TYPES[d.type].color,
            transparent: true,
            opacity: 0.35,
            depthWrite: false
          })
        )
      )
    }
    this.deviceGroup = g
    this.dyn.add(g)
  }

  /** 工位视图：每张桌面上一块按状态着色的光块（在岗绿、预约金、空闲灰蓝） */
  _buildDesks() {
    const desks = this.data.desks
    const geo = new THREE.BoxGeometry(1.2, 0.04, 0.6)
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    })
    const m = new THREE.InstancedMesh(geo, mat, desks.length)
    const COL = {
      busy: new THREE.Color(0.25, 1.2, 0.65),
      booked: new THREE.Color(1.3, 0.85, 0.3),
      free: new THREE.Color(0.25, 0.4, 0.7)
    }
    const mtx = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    // 桌面朝向：沿工位岛切线（用相邻同岛工位的连线方向近似）
    desks.forEach((d, i) => {
      const nb = desks[i % 6 < 3 ? i + 3 : i - 3] || desks[i]
      const ang = Math.atan2(nb.p[1] - d.p[1], nb.p[0] - d.p[0])
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang + Math.PI / 2)
      mtx.compose(
        new THREE.Vector3(d.p[0], 0.8, d.p[1]),
        q,
        new THREE.Vector3(1, 1, 1)
      )
      m.setMatrixAt(i, mtx)
      m.setColorAt(i, COL[d.status])
    })
    m.renderOrder = 4
    this.deskMesh = m
    this.dyn.add(m)
  }

  /** 温度热力：每个房间按温度着色，模糊成连续的场，裁成楼板形状，贴在地面上方 */
  _buildHeat() {
    const P = this.plan
    const xs = P.slab.map((p) => p[0])
    const zs = P.slab.map((p) => p[1])
    const x0 = Math.min(...xs)
    const x1 = Math.max(...xs)
    const z0 = Math.min(...zs)
    const z1 = Math.max(...zs)
    const S = 512
    const c = document.createElement("canvas")
    c.width = c.height = S
    const g = c.getContext("2d")
    const px = (x) => ((x - x0) / (x1 - x0)) * S
    const pz = (z) => ((z - z0) / (z1 - z0)) * S
    const path = (poly) => {
      g.beginPath()
      poly.forEach(([x, z], i) =>
        i ? g.lineTo(px(x), pz(z)) : g.moveTo(px(x), pz(z))
      )
      g.closePath()
    }
    g.filter = "blur(18px)"
    // 走道 / 核心筒：平均温度
    path(P.slab)
    g.fillStyle = heatCss(24.2)
    g.fill()
    for (const r of this.data.rooms) {
      path(r.poly)
      g.fillStyle = heatCss(r.temp)
      g.fill()
    }
    // 机房告警：热点
    if (this.data.machineRack) {
      const rack = P.racks.find((r) => r.id === this.data.machineRack)
      const grd = g.createRadialGradient(
        px(rack.p[0]),
        pz(rack.p[1]),
        0,
        px(rack.p[0]),
        pz(rack.p[1]),
        40
      )
      grd.addColorStop(0, "rgba(255,40,40,1)")
      grd.addColorStop(1, "rgba(255,40,40,0)")
      g.fillStyle = grd
      g.fillRect(0, 0, S, S)
    }
    g.filter = "none"
    // 裁成楼板形状
    g.globalCompositeOperation = "destination-in"
    path(P.slab)
    g.fillStyle = "#fff"
    g.fill()
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(x1 - x0, z1 - z0),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    plane.rotation.x = -Math.PI / 2
    plane.position.set((x0 + x1) / 2, 0.1, (z0 + z1) / 2)
    plane.renderOrder = 4
    this.heatPlane = plane
    this.dyn.add(plane)
  }

  /** 机房告警机柜：脚下向外扩散的红色波纹 */
  _buildAlarm() {
    this.ripples = []
    const id = this.data.machineRack
    if (!id) return
    const rack = this.plan.racks.find((r) => r.id === id)
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1, 48),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(1.6, 0.25, 0.3),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      )
      m.rotation.x = -Math.PI / 2
      m.position.set(rack.p[0], 0.1, rack.p[1])
      this.dyn.add(m)
      this.ripples.push(m)
    }
  }

  // ================================================================ 模式 / 交互

  setMode(mode) {
    this.mode = mode
    this.deviceGroup.visible = mode === "device"
    this.deskMesh.visible = mode === "desk"
    for (const l of this.labels)
      l.element.style.opacity = mode === "room" ? 1 : 0.55
  }

  select(id) {
    this.selected = id
  }

  _setHover(id) {
    if (id === this.hovered) return
    this.hovered = id
    this.canvas.style.cursor = id ? "pointer" : ""
    if (!id) this.onHover?.(null)
  }

  _pick(e) {
    const rect = this.canvas.getBoundingClientRect()
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObjects(this.hitTargets, false)[0]
    if (!hit) return null
    return {
      room: hit.object.userData.room,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    }
  }

  _onMove(e) {
    const p = this._pick(e)
    this._setHover(p?.room.id || null)
    if (p) this.onHover?.(p)
  }

  _onClick(e) {
    if (
      this.downAt &&
      Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]) > 5
    )
      return
    const p = this._pick(e)
    this.onPick?.(p ? p.room.id : null)
  }

  // ================================================================ 相机 / 渲染

  /** 从「前方」（plan.front）斜上方 50° 看楼层中心，椭圆长轴横在画面里 */
  _fitCamera() {
    const P = this.plan
    const xs = P.slab.map((p) => p[0])
    const zs = P.slab.map((p) => p[1])
    const span = Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...zs) - Math.min(...zs)
    )
    const fov = this.camera.fov * DEG
    // 楼层宽度占画面中间约 42%（两侧是面板、右侧还有楼层条）
    const dist = (span * 0.5) / Math.tan(fov / 2) / 0.42 / this.camera.aspect
    const e = 50 * DEG
    const [fx, fz] = P.front
    const target = new THREE.Vector3(0, 0.5, 0)
    this.camera.position.set(
      fx * dist * Math.cos(e),
      dist * Math.sin(e),
      fz * dist * Math.cos(e)
    )
    this.controls.target.copy(target)
    this.controls.minDistance = dist * 0.35
    this.controls.maxDistance = dist * 1.4
    this.controls.update()
  }

  resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.labelRenderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  _loop() {
    if (this.disposed) return
    const dt = Math.min(this.clock.getDelta(), 0.1)
    const t = this.clock.elapsedTime
    // 换层动画：0 → 1
    this.enterT = Math.min(1, this.enterT + dt * 1.2)
    const e = 1 - Math.pow(1 - this.enterT, 3)
    for (const g of this.ghosts)
      g.position.y = g.userData.base * (1 + (1 - e) * 1.2)
    const k = 1 - Math.exp(-dt * 8)
    const fillK = MODE_FILL[this.mode] * e
    const pulse = 0.6 + 0.4 * Math.sin(t * 4)
    for (const v of this.roomViews.values()) {
      const { room } = v
      const sel = room.id === this.selected
      const hov = room.id === this.hovered
      const alarm = room.level === "alarm"
      let fill = v.base * fillK
      let edge = v.base * 1.6 * fillK
      if (room.level === "busy" && this.mode === "room") {
        fill = 0.1 * fillK
        edge = 0.9 * fillK
      }
      if (hov) {
        fill = Math.max(fill, 0.12)
        edge = Math.max(edge, 0.9)
      }
      if (sel) {
        fill = Math.max(fill, 0.12)
        edge = 1
      }
      // 告警：轮廓红色闪烁为主，地面只泛一点红（整片铺红会盖住机房里的机柜）
      if (alarm) {
        fill = Math.max(fill, 0.1 * pulse)
        edge = Math.max(edge, pulse)
      }
      v.fillMat.opacity += (fill - v.fillMat.opacity) * k
      v.edgeMat.opacity += (edge - v.edgeMat.opacity) * k
      // 选中金色、告警红色，其它保持类型色
      const goal = sel
        ? GOLD
        : alarm
          ? RED
          : v.colBase || (v.colBase = v.fillMat.color.clone())
      v.edgeMat.color.lerp(goal, k)
    }
    this.heatPlane.material.opacity +=
      ((this.mode === "heat" ? 0.75 : 0) - this.heatPlane.material.opacity) * k
    for (const s of this.deviceGroup.children)
      if (s.userData.alarm) s.scale.setScalar(1.2 + 0.4 * pulse)
    this.ripples.forEach((m, i) => {
      const p = (t * 0.6 + i * 0.5) % 1
      m.scale.setScalar(1 + p * 4)
      m.material.opacity = (1 - p) * 0.9
    })
    this.controls.update()
    this.composer.render()
    this.labelRenderer.render(this.scene, this.camera)
    this.frameId = requestAnimationFrame(this._loop)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frameId)
    this.resizeObserver.disconnect()
    this.canvas.removeEventListener("pointermove", this._onMove)
    this.canvas.removeEventListener("pointerleave", this._onLeave)
    this.canvas.removeEventListener("pointerdown", this._onDown)
    this.canvas.removeEventListener("click", this._onClick)
    this.controls.dispose()
    disposeTree(this.scene)
    this.labelRenderer.domElement.innerHTML = ""
    this.composer.dispose()
    this.renderer.dispose()
  }
}

const GOLD = new THREE.Color(1.6, 1.1, 0.35)
const RED = new THREE.Color(1.6, 0.2, 0.25)

/** 沿闭合多边形的一条水平光带（宽 w，y 高度），用于房间轮廓 */
function ribbonGeometry(poly, y, w) {
  const pos = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i]
    const [bx, bz] = poly[(i + 1) % n]
    const L = Math.hypot(bx - ax, bz - az)
    if (L < 1e-3) continue
    const nx = (-(bz - az) / L) * w * 0.5
    const nz = ((bx - ax) / L) * w * 0.5
    const p = [
      [ax - nx, az - nz],
      [bx - nx, bz - nz],
      [bx + nx, bz + nz],
      [ax + nx, az + nz]
    ]
    for (const idx of [0, 1, 2, 0, 2, 3]) pos.push(p[idx][0], y, p[idx][1])
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
  return g
}

/** 设备图标：发光圆点 + 白色符号（Canvas 贴图） */
function iconTexture(color, glyph) {
  const c = document.createElement("canvas")
  c.width = c.height = 96
  const g = c.getContext("2d")
  const grd = g.createRadialGradient(48, 48, 10, 48, 48, 48)
  grd.addColorStop(0, color)
  grd.addColorStop(0.45, color + "aa")
  grd.addColorStop(1, color + "00")
  g.fillStyle = grd
  g.fillRect(0, 0, 96, 96)
  g.beginPath()
  g.arc(48, 48, 22, 0, Math.PI * 2)
  g.fillStyle = "rgba(4,18,40,0.85)"
  g.fill()
  g.lineWidth = 4
  g.strokeStyle = color
  g.stroke()
  g.fillStyle = "#fff"
  g.font = "bold 26px sans-serif"
  g.textAlign = "center"
  g.textBaseline = "middle"
  g.fillText(glyph, 48, 50)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** 温度 → CSS 颜色：22°C 蓝 → 24 青 → 26 黄 → 28 红 */
function heatCss(temp) {
  const stops = [
    [22, [26, 89, 255]],
    [24, [26, 230, 242]],
    [26, [255, 217, 64]],
    [28, [255, 64, 51]]
  ]
  const t = Math.min(28, Math.max(22, temp))
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i]
    const [t0, c0] = stops[i - 1]
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0)
      const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * k))
      return `rgb(${c.join(",")})`
    }
  }
  return "rgb(255,64,51)"
}

function disposeTree(root) {
  root.traverse((o) => {
    o.geometry?.dispose()
    const mats = Array.isArray(o.material)
      ? o.material
      : o.material
        ? [o.material]
        : []
    for (const m of mats) {
      for (const v of Object.values(m)) if (v && v.isTexture) v.dispose()
      m.dispose()
    }
  })
}

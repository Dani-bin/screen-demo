/*
 * 院内导航 三维场景
 * ----------------------------------------------------------
 * 全部由 data/plan.json 程序化建模（与 CAD 平面图同一份图元，scripts/hospital/draw_plan.py 生成）：
 *   - 三层楼板按爆炸图拉开（THEME.level），墙剖到 1.5 m 高，房间按分区铺淡彩，家具挤出成矮块；
 *   - 楼梯做实心踏步，中庭扶梯按真实坡度（每层 4.5 m），电梯是贯通三层的玻璃井；
 *   - 路线：贴地的橙色带（走过的部分变淡，前方有流动的明暗），换层处用竖向 / 斜向的带子连起来；
 *   - 人员沿路线走（速度见 THEME.sim），起点绿针、终点红针，终点房间地面高亮。
 * 视觉以设计稿 docs/design/hospital/01-draft-light.png 为准；角落的柔和阴影用 GTAO。
 *
 * 不依赖 Vue。生命周期：new HospitalScene(opts) → setRoute(route) → dispose()
 * 回调：
 *   onAnchors({ floors: [{ f, x, y }], start, end })  标注锚点（画布内 CSS 像素，每次相机或路线变化时）
 *   onProgress({ edge, frac, floor, arrived })        人员进度：当前所在的路径边下标、整条路线的完成比例
 *   onPick(room)                                      点击房间地面（room 为 plan.json 里的房间）
 */
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js"
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"

import PLAN from "../data/plan.json"
import { findEdge } from "../route"
import { THEME } from "./theme"

const [W, D] = PLAN.meta.size
const C = THEME.colors
const DEG = Math.PI / 180
const ESC_Y = PLAN.escalators[0].y // [南端梯头外沿, 南梳齿板, 北梳齿板, 北端梯头外沿]

/** 平面坐标（x 向东、y 向北）+ 楼层 + 离楼面高度 → three.js 世界坐标（y 向上，北 = -z） */
export function world(x, y, f = 0, h = 0) {
  return new THREE.Vector3(x - W / 2, f * THEME.level + h, D / 2 - y)
}

/** 轴向长方体：平面矩形 [x0, y0, x1, y1]，高度 h0..h1（相对楼面） */
function boxGeo(x0, y0, x1, y1, h0, h1) {
  const g = new THREE.BoxGeometry(x1 - x0, h1 - h0, y1 - y0)
  g.translate((x0 + x1) / 2 - W / 2, (h0 + h1) / 2, D / 2 - (y0 + y1) / 2)
  return g
}

/** 平面多边形挤出：pts 为 [[x, y], …]，底 h0 顶 h1 */
function prismGeo(pts, h0, h1) {
  const shape = new THREE.Shape(
    pts.map(([x, y]) => new THREE.Vector2(x - W / 2, y - D / 2))
  )
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: h1 - h0,
    bevelEnabled: false
  })
  // 形状在 xy 平面、沿 +z 挤出；绕 x 轴转 -90° 后：形状 y → -z（北），挤出方向 → +y（上）
  g.rotateX(-Math.PI / 2)
  g.translate(0, h0, 0)
  return g
}

/** 转成无索引、只保留 position / normal，便于合并不同来源的几何（挤出几何本来就无索引，不重复转） */
function clean(g) {
  if (g.index) {
    const flat = g.toNonIndexed()
    g.dispose()
    g = flat
  }
  for (const k of Object.keys(g.attributes))
    if (k !== "position" && k !== "normal") g.deleteAttribute(k)
  return g
}

function merged(list) {
  const parts = list.map(clean)
  const g = mergeGeometries(parts)
  parts.forEach((x) => x.dispose())
  return g
}

const mat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    metalness: 0,
    ...extra
  })

export class HospitalScene {
  constructor({ canvas, container, onAnchors, onProgress, onPick }) {
    this.canvas = canvas
    this.container = container
    this.onAnchors = onAnchors || (() => {})
    this.onProgress = onProgress || (() => {})
    this.onPick = onPick || (() => {})
    this.disposed = false
    this.timer = new THREE.Timer() // 帧间隔（THREE.Clock 已弃用）
    this.time = 0
    this.timeScale = 1 // 人员模拟倍速（录屏时调快）

    // ---------- 渲染器
    const r = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance"
    })
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    r.setClearColor(THEME.bg)
    // 中性色调映射：保住设计稿里的白墙和淡彩，不发灰
    r.toneMapping = THREE.NeutralToneMapping
    r.toneMappingExposure = 1.0
    this.renderer = r

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(THEME.bg)
    this.scene = scene
    // 叠加层：路线带、人员、地图针。在 GTAO 之后单独画、永远在最上面
    // （否则 GTAO 会把悬空的竖向路线压成深褐色，路线进门洞时也会被墙挡住半截）
    this.overlay = new THREE.Scene()

    // ---------- 正交相机（从前右方斜上方看）
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2000)
    this.target = new THREE.Vector3(0, THEME.level, 0)

    // ---------- 光：天光 + 一盏无阴影的主光（层与层叠着，实时阴影会让上层把下层整片压黑，角落的暗部交给 GTAO）
    scene.add(new THREE.HemisphereLight("#ffffff", "#cfd8d5", 2.2))
    const key = new THREE.DirectionalLight("#ffffff", 1.6)
    key.position.set(60, 120, 90)
    scene.add(key)
    const fill = new THREE.DirectionalLight("#e8f1ff", 0.5)
    fill.position.set(-80, 60, -40)
    scene.add(fill)
    this.overlay.add(
      new THREE.HemisphereLight("#ffffff", "#cfd8d5", 2.2),
      key.clone()
    )

    // ---------- 材质（各层共享）
    this.mats = {
      floor: mat(C.floor),
      slabSide: mat(C.slabSide),
      wall: mat(C.wall),
      furn: mat(C.furn),
      seat: mat(C.seat),
      chair: mat(C.chair),
      stair: mat(C.stair),
      apron: mat(C.apron),
      escTruss: mat(C.escTruss, { roughness: 0.6 }),
      escStep: mat(C.escStep, { roughness: 0.5 }),
      glass: new THREE.MeshStandardMaterial({
        color: C.glass,
        transparent: true,
        opacity: 0.32,
        roughness: 0.15,
        depthWrite: false
      }),
      glassEdge: new THREE.LineBasicMaterial({ color: C.glassEdge }),
      zones: Object.fromEntries(
        Object.entries(C.zones).map(([k, v]) => [k, mat(v)])
      ),
      dest: mat(C.dest),
      hover: mat(C.hover)
    }

    this.floors = []
    this.roomTiles = []
    this._buildBuilding()
    this._buildRouteObjects()

    // ---------- 后期：GTAO 做角落和家具脚下的柔和暗部
    this.composer = new EffectComposer(
      r,
      new THREE.WebGLRenderTarget(1, 1, {
        samples: 4,
        type: THREE.HalfFloatType
      })
    )
    this.composer.addPass(new RenderPass(scene, this.camera))
    this.gtao = new GTAOPass(scene, this.camera, 1, 1)
    this.gtao.output = GTAOPass.OUTPUT.Default
    this.gtao.blendIntensity = 1.0
    this.gtao.updateGtaoMaterial({
      radius: 1.4,
      distanceExponent: 1.2,
      thickness: 1.2,
      scale: 1.1,
      samples: 16
    })
    this.gtao.updatePdMaterial({
      lumaPhi: 10,
      depthPhi: 2,
      normalPhi: 3,
      radius: 6,
      rings: 2,
      samples: 16
    })
    this.composer.addPass(this.gtao)
    const over = new RenderPass(this.overlay, this.camera)
    over.clear = false // 保留下面已经画好的建筑
    over.clearDepth = true // 只清深度：叠加层自己之间互相遮挡，但整体压在建筑上面
    this.composer.addPass(over)
    this.composer.addPass(new OutputPass())

    // ---------- 镜头控制：可拖动 / 缩放，闲置 20 秒回到总览
    this.controls = new OrbitControls(this.camera, canvas)
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.08,
      rotateSpeed: 0.5,
      minZoom: 0.7,
      maxZoom: 4,
      minPolarAngle: 20 * DEG,
      maxPolarAngle: 75 * DEG,
      screenSpacePanning: true
    })
    this.controls.addEventListener(
      "start",
      () => (this.userAt = performance.now())
    )
    this.controls.addEventListener("change", () => (this.anchorsDirty = true))
    this.userAt = 0

    // ---------- 拾取房间
    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()
    this.hovered = null
    this._onMove = (e) => this._hover(e)
    this._onClick = (e) => this._click(e)
    canvas.addEventListener("pointermove", this._onMove)
    canvas.addEventListener("click", this._onClick)

    this._onResize = () => this._resize()
    this.resizeObserver = new ResizeObserver(this._onResize)
    this.resizeObserver.observe(container)
    this._resize()
    this._homeView()

    this._loop = this._loop.bind(this)
    this.frameId = requestAnimationFrame(this._loop)
    if (import.meta.env.DEV) window.__hospitalScene = this
  }

  // ================================================================ 建筑
  _buildBuilding() {
    for (let f = 0; f < 3; f++) {
      const g = new THREE.Group()
      g.name = `floor_${f + 1}F`
      g.position.y = f * THEME.level
      this.scene.add(g)
      this.floors.push(g)
      this._buildSlab(g, f)
      this._buildTiles(g, f)
      this._buildWalls(g, f)
      this._buildFurniture(g, f)
      this._buildStairs(g, f)
      if (f > 0) this._buildRails(g, f)
      if (f === 0) this._buildAprons(g)
    }
    this._buildEscalators()
    this._buildElevators()
  }

  /** 楼板：顶面为地面色，侧面浅白；2F / 3F 在中庭处开洞 */
  _buildSlab(g, f) {
    const pad = 0.15 // 外墙半厚
    const shape = new THREE.Shape([
      new THREE.Vector2(-W / 2 - pad, -D / 2 - pad),
      new THREE.Vector2(W / 2 + pad, -D / 2 - pad),
      new THREE.Vector2(W / 2 + pad, D / 2 + pad),
      new THREE.Vector2(-W / 2 - pad, D / 2 + pad)
    ])
    if (f > 0) {
      const [x0, y0, x1, y1] = PLAN.void
      shape.holes.push(
        new THREE.Path([
          new THREE.Vector2(x0 - W / 2, y0 - D / 2),
          new THREE.Vector2(x0 - W / 2, y1 - D / 2),
          new THREE.Vector2(x1 - W / 2, y1 - D / 2),
          new THREE.Vector2(x1 - W / 2, y0 - D / 2)
        ])
      )
    }
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: THEME.slab,
      bevelEnabled: false
    })
    geo.rotateX(-Math.PI / 2)
    geo.translate(0, -THEME.slab, 0)
    // ExtrudeGeometry 的材质组：0 = 上下两个盖面，1 = 侧面
    const m = new THREE.Mesh(geo, [this.mats.floor, this.mats.slabSide])
    m.name = "slab"
    g.add(m)
  }

  /** 房间地面分区色块（每个房间一块，便于拾取和高亮）；楼梯间、卫生间也铺上 */
  _buildTiles(g, f) {
    const tile = (rect, zone, room) => {
      const [x0, y0, x1, y1] = rect
      const geo = new THREE.PlaneGeometry(x1 - x0, y1 - y0)
      geo.rotateX(-Math.PI / 2)
      const m = new THREE.Mesh(geo, this.mats.zones[zone])
      m.position.set((x0 + x1) / 2 - W / 2, 0.01, D / 2 - (y0 + y1) / 2)
      m.userData.zone = zone
      if (room) {
        m.userData.room = room
        this.roomTiles.push(m)
      }
      g.add(m)
      return m
    }
    for (const r of PLAN.rooms) {
      if (r.floor !== f || r.zone === "public") continue
      tile(r.rect, r.zone, r.dest ? r : null)
    }
    for (const s of Object.values(PLAN.stairs)) tile(s.rect, "traffic")
    for (const s of Object.values(PLAN.wc)) tile(s.rect, "wc")
  }

  /** 墙（含房间内隔断）剖到 wallH；外墙窗洞补玻璃，入口补玻璃门 */
  _buildWalls(g, f) {
    const list = PLAN.walls[f].map(([x0, y0, x1, y1]) =>
      boxGeo(x0, y0, x1, y1, 0, THEME.wallH)
    )
    const walls = new THREE.Mesh(merged(list), this.mats.wall)
    walls.name = "walls"
    g.add(walls)
    const glass = []
    for (const [, o, c, a, b] of PLAN.openings[f]) {
      const t = 0.05
      glass.push(
        o === "h"
          ? boxGeo(a, c - t, b, c + t, 0, THEME.wallH)
          : boxGeo(c - t, a, c + t, b, 0, THEME.wallH)
      )
    }
    if (glass.length) g.add(new THREE.Mesh(merged(glass), this.mats.glass))
  }

  /** 家具：多边形挤出成矮块（候诊区里的是蓝灰座椅），圆挤出成椅子 */
  _buildFurniture(g, f) {
    const rooms = PLAN.rooms.filter((r) => r.floor === f)
    const zoneAt = (x, y) => {
      const r = rooms.find(
        (q) =>
          x >= q.rect[0] && x <= q.rect[2] && y >= q.rect[1] && y <= q.rect[3]
      )
      return r ? r.zone : "public"
    }
    const furn = []
    const seats = []
    for (const pts of PLAN.furniture[f].polys) {
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length
      const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length
      const area =
        Math.abs(
          pts.reduce((s, p, i) => {
            const q = pts[(i + 1) % pts.length]
            return s + p[0] * q[1] - q[0] * p[1]
          }, 0)
        ) / 2
      if (area < 0.02) continue
      const isSeat = zoneAt(cx, cy) === "public"
      ;(isSeat ? seats : furn).push(
        prismGeo(pts, 0, isSeat ? THEME.chairH : THEME.furnH)
      )
    }
    if (furn.length) g.add(new THREE.Mesh(merged(furn), this.mats.furn))
    if (seats.length) g.add(new THREE.Mesh(merged(seats), this.mats.seat))
    const chairs = PLAN.furniture[f].chairs.map(([x, y, r]) => {
      const c = new THREE.CylinderGeometry(r, r, THEME.chairH, 12)
      c.translate(x - W / 2, THEME.chairH / 2, D / 2 - y)
      return c
    })
    if (chairs.length) g.add(new THREE.Mesh(merged(chairs), this.mats.chair))
  }

  /** 楼梯：两个梯段做成实心踏步 + 中间休息平台（顶层没有往上的梯段） */
  _buildStairs(g, f) {
    if (f === 2) return
    const parts = []
    for (const s of Object.values(PLAN.stairs)) {
      for (const fl of s.flights) {
        const [x0, y0, x1, y1] = fl.rect
        const [ux, uy] = fl.up
        const n = s.steps
        for (let i = 0; i < n; i++) {
          const h = fl.z[0] + ((fl.z[1] - fl.z[0]) * (i + 1)) / n
          // 第 i 级：沿上行方向切出一格
          if (Math.abs(uy) > 0.5) {
            const step = (y1 - y0) / n
            const a = uy < 0 ? y1 - (i + 1) * step : y0 + i * step
            parts.push(boxGeo(x0, a, x1, a + step, 0, h))
          } else {
            const step = (x1 - x0) / n
            const a = ux < 0 ? x1 - (i + 1) * step : x0 + i * step
            parts.push(boxGeo(a, y0, a + step, y1, 0, h))
          }
        }
      }
      const [x0, y0, x1, y1] = s.landing
      parts.push(boxGeo(x0, y0, x1, y1, 0, s.flights[0].z[1]))
    }
    g.add(new THREE.Mesh(merged(parts), this.mats.stair))
  }

  /** 中庭四周的玻璃栏杆（扶梯接口处断开） */
  _buildRails(g, f) {
    const [x0, y0, x1, y1] = PLAN.void
    const t = 0.04
    const H = THEME.railH
    const parts = [
      boxGeo(x0, y0, x0 + t, y1, 0, H),
      boxGeo(x1 - t, y0, x1, y1, 0, H)
    ]
    // 2F 的扶梯都在中庭北侧接口，3F 的在南侧
    const gapY = f === 1 ? y1 : y0
    const [gx0, gx1] = f === 1 ? [39.6, 46.8] : [43.4, 46.8]
    for (const yy of [y0, y1]) {
      const a = yy === y0 ? yy : yy - t
      if (yy === gapY) {
        parts.push(
          boxGeo(x0, a, gx0, a + t, 0, H),
          boxGeo(gx1, a, x1, a + t, 0, H)
        )
      } else parts.push(boxGeo(x0, a, x1, a + t, 0, H))
    }
    g.add(new THREE.Mesh(merged(parts), this.mats.glass))
  }

  /** 1F 入口外的铺地（入口外的路线和人员要有地面可踩） */
  _buildAprons(g) {
    const parts = [
      boxGeo(32.4, -6.5, 54.0, -0.15, -0.3, -0.02),
      boxGeo(38.4, D + 0.15, 51.6, D + 5.0, -0.3, -0.02),
      boxGeo(W + 0.15, 8.4, W + 5.5, 16.8, -0.3, -0.02)
    ]
    g.add(new THREE.Mesh(merged(parts), this.mats.apron))
  }

  /**
   * 中庭扶梯：每条梯按真实坡度从下层升 4.5 m（爆炸图里再往上用路线的竖向段接到上层）。
   * 挂在下端所在楼层的分组里（局部高度），楼层展开 / 收拢时跟着楼板一起动。
   */
  _buildEscalators() {
    const rise = THEME.escRise
    for (let f = 0; f < 3; f++) {
      const list = PLAN.escalators.filter((e) => e.lo === f)
      if (!list.length) continue
      const truss = []
      const steps = []
      const glass = []
      for (const e of list) {
        const x = e.x
        const hw = e.width / 2
        const south = e.lo_end === "S"
        // 下端在南侧（A / B）：南梳齿板 z=0 → 北梳齿板 z=rise；下端在北侧（C / D）反过来
        const yLo0 = south ? ESC_Y[0] : ESC_Y[3]
        const yLo1 = south ? ESC_Y[1] : ESC_Y[2]
        const yHi1 = south ? ESC_Y[2] : ESC_Y[1]
        const yHi0 = south ? ESC_Y[3] : ESC_Y[0]
        // 下梯头、上梯头平台
        truss.push(
          boxGeo(
            x - hw,
            Math.min(yLo0, yLo1),
            x + hw,
            Math.max(yLo0, yLo1),
            -0.35,
            0.04
          )
        )
        truss.push(
          boxGeo(
            x - hw,
            Math.min(yHi0, yHi1),
            x + hw,
            Math.max(yHi0, yHi1),
            rise - 0.5,
            rise + 0.04
          )
        )
        // 斜段：一块斜放的长方体（局部坐标，楼层 0 的高度）
        const p0 = world(x, yLo1, 0, 0)
        const p1 = world(x, yHi1, 0, rise)
        const dir = new THREE.Vector3().subVectors(p1, p0)
        const len = dir.length()
        const mid = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5)
        const q = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          dir.clone().normalize()
        )
        const body = new THREE.BoxGeometry(e.width, 0.5, len)
        body.translate(0, -0.25, 0)
        body.applyQuaternion(q)
        body.translate(mid.x, mid.y, mid.z)
        truss.push(body)
        // 梯级：斜段上一排小台阶
        const n = 18
        for (let i = 0; i < n; i++) {
          const c = new THREE.Vector3().lerpVectors(p0, p1, (i + 0.5) / n)
          const s = new THREE.BoxGeometry(e.width - 0.3, 0.08, (len / n) * 0.7)
          s.applyQuaternion(q)
          s.translate(c.x, c.y + 0.04, c.z)
          steps.push(s)
        }
        // 两侧玻璃扶手
        for (const sx of [-hw + 0.06, hw - 0.06]) {
          const pan = new THREE.BoxGeometry(0.05, 0.9, len)
          pan.translate(0, 0.45, 0)
          pan.applyQuaternion(q)
          pan.translate(mid.x + sx, mid.y, mid.z)
          glass.push(pan)
        }
      }
      const g = this.floors[f]
      g.add(new THREE.Mesh(merged(truss), this.mats.escTruss))
      g.add(new THREE.Mesh(merged(steps), this.mats.escStep))
      g.add(new THREE.Mesh(merged(glass), this.mats.glass))
    }
  }

  /** 电梯：贯通三层的玻璃井 + 白色边框，轿厢停在 1F。井道高度随层间距变，放在一个组里便于重建 */
  _buildElevators() {
    if (this.elevGroup) {
      this.elevGroup.traverse((o) => o.geometry && o.geometry.dispose())
      this.scene.remove(this.elevGroup)
    }
    const group = new THREE.Group()
    const top = 2 * THEME.level + THEME.wallH + 2.2
    for (const e of Object.values(PLAN.elevators)) {
      const [x0, y0, x1, y1] = e.rect
      group.add(
        new THREE.Mesh(
          boxGeo(x0, y0, x1, y1, -THEME.slab, top),
          this.mats.glass
        )
      )
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(
          new THREE.BoxGeometry(x1 - x0, top + THEME.slab, y1 - y0)
        ),
        this.mats.glassEdge
      )
      edges.position.set(
        (x0 + x1) / 2 - W / 2,
        (top - THEME.slab) / 2,
        D / 2 - (y0 + y1) / 2
      )
      group.add(edges)
      group.add(
        new THREE.Mesh(
          boxGeo(x0 + 0.35, y0 + 0.4, x1 - 0.35, y1 - 0.5, 0.05, 2.4),
          this.mats.furn
        )
      )
    }
    this.elevGroup = group
    this.scene.add(group)
  }

  /**
   * 改变爆炸图的层间距（楼层展开 / 收拢动画用，录屏的"一层一层拉开"）：
   * 楼板组上下移动、电梯井重建；route 为真时按新层间距重建路线（人员从头走）。
   */
  setLevel(level, route = true) {
    THEME.level = level
    this.floors.forEach((g, f) => (g.position.y = f * level))
    this._buildElevators()
    this.target.y = level
    this.anchorsDirty = true
    if (route && this.route) this.setRoute(this.route, this.G, this.destRoom)
  }

  // ================================================================ 路线、人员、起终点
  _buildRouteObjects() {
    // 路线带：自定义着色（aS = 沿路线的距离），走过的部分变淡，前方有流动的明暗；
    // uReveal 以后的部分不画（路线"一路长出来"的动画用，平时是个很大的数，整条都画）
    this.routeUniforms = {
      uProgress: { value: 0 },
      uReveal: { value: 1e9 },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(C.route) },
      uDone: { value: new THREE.Color(C.routeDone) }
    }
    this.routeMat = new THREE.ShaderMaterial({
      uniforms: this.routeUniforms,
      vertexShader: /* glsl */ `
        attribute float aS;
        varying float vS;
        void main() {
          vS = aS;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uProgress;
        uniform float uReveal;
        uniform float uTime;
        uniform vec3 uColor;
        uniform vec3 uDone;
        varying float vS;
        void main() {
          if (vS > uReveal) discard;
          vec3 c = uColor;
          // 前方：每 3 m 一段向前流动的亮带，提示行进方向
          float flow = smoothstep(0.55, 1.0, fract((vS - uTime * 4.0) / 3.0));
          c = mix(c, vec3(1.0, 0.82, 0.66), flow * 0.45);
          if (vS < uProgress) c = uDone;
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    })
    this.routeMesh = null

    // 人员：深色身体 + 头，脚下一圈橙色光环（远看也找得到）
    const person = new THREE.Group()
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 0.85, 4, 12),
      mat(C.person, { roughness: 0.7 })
    )
    body.position.y = 0.3 + 0.425 + 0.05
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 16, 12),
      mat(C.personHead, { roughness: 0.8 })
    )
    head.position.y = 1.62
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.85, 32),
      new THREE.MeshBasicMaterial({
        color: C.route,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.06
    person.add(body, head, ring)
    person.scale.setScalar(1.25) // 爆炸图看得远，人放大一点
    person.visible = false
    this.person = person
    this.personRing = ring
    this.overlay.add(person)

    // 地图针
    const pin = (color) => {
      const g = new THREE.Group()
      const m = mat(color, { roughness: 0.5 })
      const ball = new THREE.Mesh(new THREE.SphereGeometry(1.0, 24, 16), m)
      ball.position.y = 3.1
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.72, 2.0, 24), m)
      tip.rotation.x = Math.PI
      tip.position.y = 1.75
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 16, 12),
        mat("#ffffff")
      )
      dot.position.set(0, 3.1, 0.62)
      g.add(ball, tip, dot)
      g.visible = false
      this.overlay.add(g)
      return g
    }
    this.startPin = pin(C.start)
    this.endPin = pin(C.end)

    // 终点房间的地面高亮
    this.destTile = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      this.mats.dest
    )
    this.destTile.rotation.x = -Math.PI / 2
    this.destTile.visible = false
    this.scene.add(this.destTile)
  }

  /**
   * 设置路线：route 为 route.js planRoute() 的结果，G 为路网，destRoom 为终点房间（可空）。
   * 生成三维轨迹（人员和路线带共用），人员从起点重新走。
   */
  setRoute(route, G, destRoom = null) {
    this.route = route
    this.G = G
    this.destRoom = destRoom
    if (this.routeMesh) {
      this.overlay.remove(this.routeMesh)
      this.routeMesh.geometry.dispose()
      this.routeMesh = null
    }
    if (!route) {
      this.person.visible =
        this.startPin.visible =
        this.endPin.visible =
        this.destTile.visible =
          false
      return
    }
    this.track = this._track(route.path, G)
    this.routeMesh = new THREE.Mesh(this._ribbon(this.track), this.routeMat)
    this.routeMesh.renderOrder = -1 // 先画路线，人员和地图针压在它上面
    this.overlay.add(this.routeMesh)

    const n0 = G.nodes[route.path[0]]
    const n1 = G.nodes[route.path[route.path.length - 1]]
    this.startPin.position.copy(world(n0.x, n0.y, n0.f))
    this.endPin.position.copy(world(n1.x, n1.y, n1.f))
    this.startPin.visible = this.endPin.visible = true
    if (destRoom) {
      const [x0, y0, x1, y1] = destRoom.rect
      this.destTile.scale.set(x1 - x0 - 0.3, y1 - y0 - 0.3, 1)
      this.destTile.position.copy(
        world((x0 + x1) / 2, (y0 + y1) / 2, destRoom.floor, 0.02)
      )
      this.destTile.visible = true
    } else this.destTile.visible = false
    this.simT = 0
    this.hold = 0
    this.person.visible = true
    this.anchorsDirty = true
  }

  /** 人员从头重新走 */
  restart() {
    this.simT = 0
    this.hold = 0
  }

  /** 人员跳到路径第 at 个节点处接着走（点分步提示时用） */
  jumpTo(at) {
    if (!this.track) return
    const q = this.track.find((s) => s.edge >= at)
    this.simT = q ? q.t0 : 0
    this.hold = 0
  }

  /**
   * 路径 → 三维轨迹：[{ a, b, dur, edge }]（a / b 为世界坐标，edge 为路径边下标）。
   * 换层的走法：扶梯沿真实坡度升 4.5 m 再竖直接到上层；电梯进井道、候梯、竖直升降；楼梯沿两个梯段爬，再竖直接到上层。
   */
  _track(path, G) {
    const S = THEME.sim
    const out = []
    const seg = (a, b, dur, edge, kind) => out.push({ a, b, dur, edge, kind })
    const walk = (pts, edge) => {
      for (let i = 1; i < pts.length; i++) {
        const d = pts[i - 1].distanceTo(pts[i])
        if (d > 1e-4) seg(pts[i - 1], pts[i], d / S.walk, edge, "walk")
      }
    }
    for (let i = 1; i < path.length; i++) {
      const A = G.nodes[path[i - 1]]
      const B = G.nodes[path[i]]
      const e = findEdge(G, path[i - 1], path[i])
      const edge = i - 1
      if (e.k === "walk") {
        walk([world(A.x, A.y, A.f), world(B.x, B.y, B.f)], edge)
      } else if (e.k === "escalator") {
        const esc = PLAN.escalators.find((q) => `esc${q.id}` === e.conn)
        const south = esc.lo_end === "S"
        const yLo0 = south ? ESC_Y[0] : ESC_Y[3]
        const yLo1 = south ? ESC_Y[1] : ESC_Y[2]
        const yHi1 = south ? ESC_Y[2] : ESC_Y[1]
        const yHi0 = south ? ESC_Y[3] : ESC_Y[0]
        const lo = esc.lo
        const x = esc.x
        const up = [
          world(x, yLo0, lo),
          world(x, yLo1, lo),
          world(x, yHi1, lo, THEME.escRise),
          world(x, yHi0, lo, THEME.escRise),
          world(x, yHi0, esc.hi)
        ]
        const pts = esc.up ? up : up.slice().reverse()
        const kinds = esc.up
          ? ["walk", "esc", "walk", "lift"]
          : ["lift", "walk", "esc", "walk"]
        for (let k = 1; k < pts.length; k++) {
          const kind = kinds[k - 1]
          const dur =
            kind === "esc"
              ? S.escalator
              : kind === "lift"
                ? S.lift
                : pts[k - 1].distanceTo(pts[k]) / S.walk
          seg(pts[k - 1], pts[k], dur, edge, kind)
        }
      } else if (e.k === "elevator") {
        const el = PLAN.elevators[e.conn.replace("elev", "")]
        const [x0, y0, x1, y1] = el.rect
        const cx = (x0 + x1) / 2
        const cy = (y0 + y1) / 2
        const a = world(A.x, A.y, A.f)
        const ca = world(cx, cy, A.f)
        const cb = world(cx, cy, B.f)
        const b = world(B.x, B.y, B.f)
        seg(a, a, S.elevatorWait, edge, "wait")
        seg(a, ca, a.distanceTo(ca) / S.walk, edge, "walk")
        seg(ca, cb, S.lift * Math.abs(B.f - A.f), edge, "lift")
        seg(cb, b, cb.distanceTo(b) / S.walk, edge, "walk")
      } else if (e.k === "stair") {
        const st = PLAN.stairs[e.conn.replace("stair", "")]
        const lo = Math.min(A.f, B.f)
        const [f1, f2] = st.flights
        const ends = (fl) => {
          const [x0, y0, x1, y1] = fl.rect
          const cx = (x0 + x1) / 2
          const cy = (y0 + y1) / 2
          const hx = (x1 - x0) / 2
          const hy = (y1 - y0) / 2
          const [ux, uy] = fl.up
          return [
            [cx - ux * hx, cy - uy * hy],
            [cx + ux * hx, cy + uy * hy]
          ]
        }
        const [s1, e1] = ends(f1)
        const [s2, e2] = ends(f2)
        const [ux, uy] = f1.up
        const land = [e1[0] + ux * 0.8, e1[1] + uy * 0.8]
        const land2 = [s2[0] + ux * 0.8, s2[1] + uy * 0.8]
        const lowNode = A.f === lo ? A : B
        const highNode = A.f === lo ? B : A
        const up = [
          world(lowNode.x, lowNode.y, lo),
          world(s1[0], s1[1], lo),
          world(e1[0], e1[1], lo, f1.z[1]),
          world(land[0], land[1], lo, f1.z[1]),
          world(land2[0], land2[1], lo, f1.z[1]),
          world(s2[0], s2[1], lo, f2.z[0]),
          world(e2[0], e2[1], lo, f2.z[1]),
          world(e2[0], e2[1], lo + 1),
          world(highNode.x, highNode.y, lo + 1)
        ]
        const kinds = [
          "walk",
          "flight",
          "walk",
          "walk",
          "walk",
          "flight",
          "lift",
          "walk"
        ]
        const goingUp = B.f > A.f
        const pts = goingUp ? up : up.slice().reverse()
        const ks = goingUp ? kinds : kinds.slice().reverse()
        for (let k = 1; k < pts.length; k++) {
          const kind = ks[k - 1]
          const dur =
            kind === "flight"
              ? S.flight
              : kind === "lift"
                ? S.lift
                : pts[k - 1].distanceTo(pts[k]) / S.walk
          seg(pts[k - 1], pts[k], dur, edge, kind)
        }
      }
    }
    // 累计距离（路线带的 aS）与时间
    let s = 0
    let t = 0
    for (const q of out) {
      q.s0 = s
      q.t0 = t
      s += q.a.distanceTo(q.b)
      t += q.dur
      q.s1 = s
      q.t1 = t
    }
    this.trackLen = s
    this.trackDur = t
    return out
  }

  /** 路线带几何：每段一块 0.9 m 宽的条带（水平段平铺在地面上方，竖向段朝向相机），拐点补圆片 */
  _ribbon(track) {
    const w = 0.9
    const lift = 0.07
    const pos = []
    const sAttr = []
    const camDir = new THREE.Vector3(
      Math.sin(THEME.camera.azimuth * DEG),
      0,
      Math.cos(THEME.camera.azimuth * DEG)
    )
    const pushQuad = (a, b, side, s0, s1) => {
      const a0 = a.clone().addScaledVector(side, -w / 2)
      const a1 = a.clone().addScaledVector(side, w / 2)
      const b0 = b.clone().addScaledVector(side, -w / 2)
      const b1 = b.clone().addScaledVector(side, w / 2)
      for (const [p, s] of [
        [a0, s0],
        [b0, s1],
        [b1, s1],
        [a0, s0],
        [b1, s1],
        [a1, s0]
      ]) {
        pos.push(p.x, p.y, p.z)
        sAttr.push(s)
      }
    }
    const disc = (c, s) => {
      const n = 16
      for (let i = 0; i < n; i++) {
        const t0 = (i / n) * Math.PI * 2
        const t1 = ((i + 1) / n) * Math.PI * 2
        for (const [x, z] of [
          [0, 0],
          [Math.cos(t0) * (w / 2), Math.sin(t0) * (w / 2)],
          [Math.cos(t1) * (w / 2), Math.sin(t1) * (w / 2)]
        ]) {
          pos.push(c.x + x, c.y, c.z + z)
          sAttr.push(s)
        }
      }
    }
    for (const q of track) {
      const a = q.a.clone()
      const b = q.b.clone()
      if (a.distanceTo(b) < 1e-4) continue
      a.y += lift
      b.y += lift
      const d = new THREE.Vector3().subVectors(b, a)
      const horiz = new THREE.Vector3(d.x, 0, d.z)
      let side
      if (horiz.length() > 1e-3)
        side = new THREE.Vector3(-horiz.z, 0, horiz.x).normalize()
      else
        side = new THREE.Vector3()
          .crossVectors(camDir, new THREE.Vector3(0, 1, 0))
          .normalize()
      pushQuad(a, b, side, q.s0, q.s1)
      if (Math.abs(d.y) < 1e-3) disc(b, q.s1)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute("aS", new THREE.Float32BufferAttribute(sAttr, 1))
    return g
  }

  // ================================================================ 相机、交互
  _homeView() {
    const { azimuth, elevation } = THEME.camera
    const az = azimuth * DEG
    const el = elevation * DEG
    const dir = new THREE.Vector3(
      Math.sin(az) * Math.cos(el),
      Math.sin(el),
      Math.cos(az) * Math.cos(el)
    )
    this.homeDir = dir
    this.camera.position.copy(this.target).addScaledVector(dir, 400)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(this.target)
    this.camera.zoom = 1
    this._fit()
    this.controls.target.copy(this.target)
    this.controls.update()
  }

  /** 按画布宽高比把整栋楼（三层）装进视野 */
  _fit() {
    if (!this.size) return
    const [w, h] = this.size
    const pts = []
    for (const x of [-W / 2 - 1, W / 2 + 1])
      for (const z of [-D / 2 - 1, D / 2 + 6])
        for (const y of [-THEME.slab, 2 * THEME.level + THEME.wallH + 3])
          pts.push(new THREE.Vector3(x, y, z))
    this.camera.updateMatrixWorld()
    const inv = this.camera.matrixWorldInverse
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const p of pts) {
      const v = p.clone().applyMatrix4(inv)
      minX = Math.min(minX, v.x)
      maxX = Math.max(maxX, v.x)
      minY = Math.min(minY, v.y)
      maxY = Math.max(maxY, v.y)
    }
    const pad = THEME.camera.padding
    const halfW =
      Math.max((maxX - minX) / 2, ((maxY - minY) / 2) * (w / h)) * pad
    const halfH = halfW * (h / w)
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    Object.assign(this.camera, {
      left: cx - halfW,
      right: cx + halfW,
      top: cy + halfH,
      bottom: cy - halfH
    })
    this.camera.updateProjectionMatrix()
    this.anchorsDirty = true
  }

  _resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.size = [w, h]
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.gtao.setSize(w, h)
    this._fit()
  }

  _pick(e) {
    const r = this.canvas.getBoundingClientRect()
    this.pointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1
    )
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObjects(this.roomTiles, false)[0]
    return hit ? hit.object : null
  }

  _hover(e) {
    const tile = this._pick(e)
    if (tile === this.hovered) return
    if (this.hovered)
      this.hovered.material = this.mats.zones[this.hovered.userData.zone]
    this.hovered = tile
    if (tile) tile.material = this.mats.hover
    this.canvas.style.cursor = tile ? "pointer" : ""
  }

  _click(e) {
    const tile = this._pick(e)
    if (tile) this.onPick(tile.userData.room)
  }

  // ================================================================ 每帧
  _loop() {
    if (this.disposed) return
    this.timer.update()
    const dt = Math.min(this.timer.getDelta(), 0.1)
    this.time += dt
    this.routeUniforms.uTime.value = this.time

    // 闲置 20 秒：镜头慢慢回到总览
    if (this.userAt && performance.now() - this.userAt > 20000) {
      const want = this.target.clone().addScaledVector(this.homeDir, 400)
      this.camera.position.lerp(want, 0.04)
      this.controls.target.lerp(this.target, 0.04)
      this.camera.zoom += (1 - this.camera.zoom) * 0.04
      this.camera.updateProjectionMatrix()
      if (
        this.camera.position.distanceTo(want) < 0.5 &&
        Math.abs(this.camera.zoom - 1) < 0.01
      )
        this.userAt = 0
      this.anchorsDirty = true
    }
    this.controls.update()

    if (this.track && this.track.length) this._stepPerson(dt)

    // 地图针轻轻上下浮动
    const bob = Math.sin(this.time * 2.4) * 0.35
    this.startPin.children.forEach(
      (c, i) => (c.position.y = [3.1, 1.75, 3.1][i] + bob)
    )
    this.endPin.children.forEach(
      (c, i) => (c.position.y = [3.1, 1.75, 3.1][i] + bob)
    )

    if (this.anchorsDirty) this._emitAnchors()
    this.composer.render()
    this.frameId = requestAnimationFrame(this._loop)
  }

  _stepPerson(dt) {
    const T = this.trackDur
    if (this.simT >= T) {
      this.hold += dt
      if (this.hold > THEME.sim.arriveHold) this.restart()
    } else this.simT = Math.min(T, this.simT + dt * this.timeScale)
    const t = this.simT
    let q = this.track[this.track.length - 1]
    for (const s of this.track) {
      if (t <= s.t1) {
        q = s
        break
      }
    }
    const k = q.dur > 0 ? (t - q.t0) / q.dur : 1
    const p = new THREE.Vector3().lerpVectors(
      q.a,
      q.b,
      Math.min(Math.max(k, 0), 1)
    )
    this.person.position.copy(p)
    const dir = new THREE.Vector3(q.b.x - q.a.x, 0, q.b.z - q.a.z)
    if (dir.lengthSq() > 1e-6) this.person.rotation.y = Math.atan2(dir.x, dir.z)
    // 走路时轻微上下起伏，脚下光环呼吸
    const walking = q.kind === "walk" && t < T
    this.person.children[0].position.y =
      0.775 + (walking ? Math.abs(Math.sin(this.time * 9)) * 0.06 : 0)
    this.personRing.scale.setScalar(1 + Math.sin(this.time * 4) * 0.12)
    this.routeUniforms.uProgress.value =
      q.s0 + (q.s1 - q.s0) * Math.min(Math.max(k, 0), 1)

    const floor = Math.round(p.y / THEME.level)
    const now = performance.now()
    if (!this.progressAt || now - this.progressAt > 100) {
      this.progressAt = now
      this.onProgress({
        edge: q.edge,
        frac: t / T,
        floor,
        arrived: t >= T,
        kind: q.kind
      })
    }
  }

  /** 楼层名、起终点标签的屏幕位置（画布内 CSS 像素） */
  _emitAnchors() {
    this.anchorsDirty = false
    if (!this.size) return
    const [w, h] = this.size
    const proj = (v) => {
      const p = v.clone().project(this.camera)
      return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h }
    }
    const floors = [0, 1, 2].map((f) => ({ f, ...proj(world(0, D / 2, f, 0)) }))
    const out = { floors }
    if (this.route && this.G) {
      const n0 = this.G.nodes[this.route.path[0]]
      const n1 = this.G.nodes[this.route.path[this.route.path.length - 1]]
      out.start = proj(world(n0.x, n0.y, n0.f, 4.6))
      out.end = proj(world(n1.x, n1.y, n1.f, 4.6))
    }
    this.onAnchors(out)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frameId)
    this.resizeObserver.disconnect()
    this.canvas.removeEventListener("pointermove", this._onMove)
    this.canvas.removeEventListener("click", this._onClick)
    this.controls.dispose()
    const mats = new Set()
    for (const sc of [this.scene, this.overlay]) {
      sc.traverse((o) => {
        if (o.geometry) o.geometry.dispose()
        if (!o.material) return
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          mats.add(m)
      })
    }
    mats.forEach((m) => m.dispose())
    this.composer.dispose()
    this.renderer.dispose()
    if (window.__hospitalScene === this) delete window.__hospitalScene
  }
}

/**
 * 松岚苑沙盘主场景（不依赖 Vue）
 * ----------------------------------------------------------
 * 2026-11-04 起三维部分直接复用 /estate（澜岸云境）的还原版场景：继承 estate/scene/RestoredScene，
 * 楼栋（Blender 模型 + 窗格贴图）、地面贴图、模型树、路灯、水面、展厅背景、光照和后处理都是它的，
 * 这里只加社区独有的东西：
 *   - 物业中心（= /estate 的会所 CL01）屋顶的机库停机坪、西人行门、电动车充电棚（props.js）
 *   - 三架无人机（drones.js）和信息层（overlay.js：盲区、目标脉冲环、热源光柱、事件落点、禁拍区）
 *   - 全天的昼夜光照档位（/estate 只有 9–21:30，这里补上凌晨和清晨）
 *   - 无人机视角窗（第二个相机直接渲染进画布）、选中、拾取、跟随
 * 坐标系就是 /estate 的（见 theme.js）：平面米，x 向东、y 向北；社区的楼栋编号和 /estate 一致（B01–B16），
 * 配套对应关系 PM-01 = CL01、KG-01 = KG01、SH-01 = SH01、EL-01 = PM01（layout.json 的 model 字段）。
 *
 * 版面：画布铺满窗口，面板在按 1920×1080 居中缩放的"舞台"里（RestoredScene.resize 已经处理）。
 * 主机位是 /estate 定稿机位沿视线拉近的结果（data/camera.json），让 16 栋楼落在两侧栏之间。
 *
 * 公共接口（和旧版一致，页面不用改）：
 *   ready / frame(dt) / goHome() / flyToPlan(x, y, o) / follow(id | null) / select(id) / projectPlan(x, y, h) /
 *   projectDrone(d) / headingDeg() / onFrame(scene, snap) / onPick(id) / onUser / setPovElements(fn) / stats()
 */
import * as THREE from "three"
import {
  RestoredScene,
  KEYS as ESTATE_KEYS
} from "../../estate/scene/RestoredScene.js"
import estateLayout from "../../estate/data/layout.json"
import layout from "../data/layout.json"
import { THEME, CX, CY, V } from "./theme.js"
import { Fleet } from "./drones.js"
import { Overlay } from "./overlay.js"
import { buildSheds, buildHangar, buildGates } from "./props.js"

/**
 * 全天的灯光档位：/estate 的 9 / 16 / 18.2 / 21.5 点四档照搬，前面补凌晨（0–4:30 同夜里）和清晨（7 点，夜里和 9 点之间），
 * 后面补午夜。18 点前后就是 /estate 设计稿的那个傍晚画面。
 */
const mix = (a, b, t) => {
  const o = {}
  for (const k of Object.keys(a)) o[k] = a[k] + (b[k] - a[k]) * t
  return o
}
const NIGHT = ESTATE_KEYS[ESTATE_KEYS.length - 1]
const KEYS = [
  { ...NIGHT, h: 0 },
  { ...NIGHT, h: 4.5 },
  { ...mix(NIGHT, ESTATE_KEYS[0], 0.55), h: 7 },
  ...ESTATE_KEYS,
  { ...NIGHT, h: 24 }
]

/** 社区编号 ↔ /estate 模型编号（只有配套建筑不同名）；其余楼栋同名 */
const MODEL_OF = Object.fromEntries(
  layout.buildings.filter((b) => b.model).map((b) => [b.id, b.model])
)
const ID_OF_MODEL = Object.fromEntries(
  Object.entries(MODEL_OF).map(([id, m]) => [m, id])
)
const IS_BUILDING = new Set(layout.buildings.map((b) => b.id))
/** 社区编号 → 场景里的 /estate 部件编号 */
const estateId = (id) => MODEL_OF[id] ?? (IS_BUILDING.has(id) ? id : null)
/** 场景里被点到的对象编号 → 社区编号；周边白模、商业综合体、学校等 /estate 的景物返回 null（点了当作点空白处） */
const communityId = (eid) => {
  if (!eid) return null
  if (/^(UAV|CH|BS)/.test(eid)) return eid
  return ID_OF_MODEL[eid] ?? (IS_BUILDING.has(eid) ? eid : null)
}

/** 选中点状设施 / 无人机时脚下的光环 */
function haloTexture() {
  const c = document.createElement("canvas")
  c.width = c.height = 128
  const g = c.getContext("2d")
  g.strokeStyle = "rgba(255,210,122,0.95)"
  g.lineWidth = 5
  g.beginPath()
  g.arc(64, 64, 56, 0, 7)
  g.stroke()
  const gr = g.createRadialGradient(64, 64, 20, 64, 64, 60)
  gr.addColorStop(0, "rgba(255,210,122,0)")
  gr.addColorStop(1, "rgba(255,210,122,0.35)")
  g.fillStyle = gr
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

export class CommunityScene extends RestoredScene {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} o sim（createSim 的返回）、frame(dt) → 快照、onPick(id | null)、onFrame(scene, snap)、onProgress(0–1)
   */
  constructor(canvas, o) {
    super(canvas, {
      layout: estateLayout,
      hour: 18,
      keys: KEYS,
      onPick: o.onPick,
      onProgress: o.onProgress
    })
    this.sim = o.sim
    this.getFrame = o.frame
    // 父类每帧调 onFrame(this)；页面要的是 (scene, 快照)
    this._pageOnFrame = o.onFrame
    this.onFrame = () => this._pageOnFrame?.(this, this._snap)
    // 用户拖动 / 滚轮：停止跟随，通知页面
    this.onInteract = () => {
      this._follow = null
      this._followNext = null
      this.onUser?.()
    }
    this._follow = null
    this._followNext = null
  }

  // ================================================================ 初始化

  async _init() {
    // 父类：建好整个 /estate 的世界（楼、地面、树、灯、水、光、后处理、相机控制）并启动渲染循环
    await super._init()
    const { scene } = this

    // 主机位：拉近到让 16 栋楼落在两侧栏之间
    this.home = {
      position: new THREE.Vector3(...THEME.camera.position),
      target: new THREE.Vector3(...THEME.camera.target)
    }
    this._applyHome()

    // 社区独有的东西
    this.hangar = buildHangar()
    scene.add(this.hangar)
    const gates = buildGates()
    scene.add(gates)
    this.gateLamp = gates.userData.lampMat
    this.sheds = buildSheds()
    this.hulls = []
    for (const s of Object.values(this.sheds)) {
      scene.add(s.group)
      this.hulls.push(s.hull)
    }
    this.fleet = new Fleet(scene, this.sim)
    this.overlay = new Overlay(scene)
    this.hulls.push(...this.overlay.hits)

    // 选中点状设施 / 无人机时脚下的光环
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: haloTexture(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.9
      })
    )
    halo.rotation.x = -Math.PI / 2
    halo.position.y = 1.2
    halo.visible = false
    halo.renderOrder = 4
    scene.add(halo)
    this._ptHalo = halo

    this._initPov()
    const { w, h } = this.stage()
    this.fleet.resize(w, h)

    // 第一帧：快照 + 光照；阴影图在父类里已经标记要画一次，社区新加的东西也赶在第一次渲染之前
    const snap = this.getFrame(0)
    this._snap = snap
    this.setTime(snap.t / 60)
    this.fleet.update(snap, 0)
    this.overlay.update(snap, 0)
    this.renderer.shadowMap.needsUpdate = true
  }

  // ================================================================ 版面

  resize() {
    super.resize()
    const { w, h } = this._size ?? this.stage()
    this.fleet?.resize(w, h)
  }

  /** 无人机的屏幕位置（真实高度 z 换算，加一点停机坪上的抬升） */
  projectDrone(d) {
    return this.projectPlan(d.x, d.y, d.z * V + 1.2)
  }

  // ================================================================ 光照

  applyLight() {
    super.applyLight()
    // 西人行门的灯：夜里暖亮，白天暗
    if (this.gateLamp) {
      const lit = Math.min(1, this.light.win)
      this.gateLamp.color.set(0x6a604f).lerp(new THREE.Color(0xffe0a8), lit)
    }
  }

  // ================================================================ 镜头

  /** 飞到平面某点：父类的实现 + 停止跟随 */
  flyToPlan(x, y, o = {}) {
    this._follow = null
    this._followNext = null
    super.flyToPlan(x, y, o)
  }

  /** 回主机位（不取消选中，选中由页面管） */
  goHome(duration = 1.6) {
    this._follow = null
    this._followNext = null
    this._flyTo(this.home.position.clone(), this.home.target.clone(), duration)
  }

  /** 跟随某架无人机：先飞到它旁边，到位后目标点向它靠拢、相机保持相对位置（用户拖动即停止） */
  follow(id, dist = 230) {
    if (!id) {
      this._follow = null
      this._followNext = null
      return
    }
    const p = this.fleet.worldPos(id)
    this.flyToPlan(p.x + CX, -p.z + CY, {
      dist,
      polar: 55,
      azimuth: 15,
      h: p.y,
      duration: 1.4
    })
    this._followNext = id
  }

  // ================================================================ 选中与拾取

  /**
   * 选中：id 是楼栋 / 设施 / 无人机编号。
   * 楼栋用 /estate 的金色边线 + 光斑（不飞镜头）；点状设施和无人机脚下画一圈光环。
   */
  select(id) {
    if (this._selEstate) this._show(this._selEstate, false)
    this._selEstate = null
    this.selected = id
    this._ptTarget = null
    this._ptHalo.visible = false
    if (!id) return
    const eid = estateId(id)
    if (eid && this.pickables?.some((m) => m.userData.id === eid)) {
      this._show(eid, true)
      this._selEstate = eid
      return
    }
    const p = layout.points.find((q) => q.id === id)
    if (p) {
      this._ptTarget = {
        x: p.x,
        y: p.y,
        size:
          p.kind === "charge"
            ? 22
            : p.kind === "blind"
              ? Math.max(p.w ?? 20, p.d ?? 20) + 8
              : 16
      }
    } else if (id.startsWith("UAV")) {
      this._ptTarget = { drone: id, size: 22 }
    }
  }

  /** 拾取：无人机优先，其次充电棚 / 盲区，最后楼栋；/estate 的景物（商业综合体、周边街区…）算空白 */
  pick(clientX, clientY) {
    if (!this.pickables || !this.fleet) return null
    const r = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const rank = (o) => {
      const id = o.userData.id
      return id?.startsWith("UAV")
        ? 0
        : id?.startsWith("CH") || id?.startsWith("BS")
          ? 1
          : 2
    }
    const hit = this.raycaster
      .intersectObjects(
        [...this.fleet.hits(), ...this.hulls, ...this.pickables],
        false
      )
      .sort(
        (a, b) => rank(a.object) - rank(b.object) || a.distance - b.distance
      )[0]
    return hit ? communityId(hit.object.userData.id) : null
  }

  // ================================================================ 无人机视角（POV）

  /**
   * 页面把"可见光窗口 / 红外窗口"的 DOM 元素告诉场景；场景用第二个相机把沙盘直接渲染进画布上这两块的位置。
   * 可见光窗：直接渲染到画布区域（/estate 的渲染器没有色调映射，和主画面一致）；红外窗：先渲染进小的离屏目标，
   * 再用"亮度 → 热像调色板"的着色器画到画布区域，目标位置叠一团热源。
   */
  setPovElements(fn) {
    this._povEls = fn
  }

  _initPov() {
    this.povCam = new THREE.PerspectiveCamera(34, 276 / 170, 1, 3000)
    // /estate 的场景一次渲染约 290 万个三角面，视角窗不能每帧都重画两遍：
    // 两个窗各自渲染进离屏目标（交替、每 4 帧一次，窗口很小，约 15 fps 够用），每帧再把最新的一张贴到画布上（只是一个四边形，几乎不花钱）
    const rtOpt = { type: THREE.HalfFloatType }
    this.povVisRT = new THREE.WebGLRenderTarget(552, 340, rtOpt)
    this.povRT = new THREE.WebGLRenderTarget(552, 340, rtOpt)
    // 近远面取 −1…1：四边形在 z = 0，正好在中间（near = 0 时贴在近平面上会被裁掉）
    this.povQuadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1)
    // 可见光：目标是线性的，贴图时让 three 做 sRGB 输出转换（/estate 的渲染器没有色调映射，和主画面一致）
    this.povVisScene = new THREE.Scene()
    this.povVisScene.add(
      new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.MeshBasicMaterial({
          map: this.povVisRT.texture,
          toneMapped: false,
          depthTest: false,
          depthWrite: false
        })
      )
    )
    this.povQuadScene = new THREE.Scene()
    this.povIr = new THREE.ShaderMaterial({
      uniforms: {
        tMap: { value: this.povRT.texture },
        uHot: { value: new THREE.Vector2(0.5, 0.5) },
        uHotK: { value: 0 },
        uTime: { value: 0 }
      },
      vertexShader:
        "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: /* glsl */ `
        uniform sampler2D tMap; uniform vec2 uHot; uniform float uHotK; uniform float uTime;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        // 热像调色板（tokens.css 的 --ir-1…5）
        vec3 ironbow(float t) {
          vec3 a = vec3(0.106, 0.063, 0.22), b = vec3(0.416, 0.122, 0.478), c = vec3(0.82, 0.286, 0.184), d = vec3(0.984, 0.749, 0.227), e = vec3(1.0, 0.953, 0.769);
          if (t < 0.25) return mix(a, b, t / 0.25);
          if (t < 0.5) return mix(b, c, (t - 0.25) / 0.25);
          if (t < 0.75) return mix(c, d, (t - 0.5) / 0.25);
          return mix(d, e, (t - 0.75) / 0.25);
        }
        void main() {
          vec3 col = texture2D(tMap, vUv).rgb;
          float L = dot(col, vec3(0.299, 0.587, 0.114));
          L = 1.0 - exp(-L * 1.5);
          // 目标热源：中心最亮的一团
          float d = length((vUv - uHot) * vec2(1.62, 1.0));
          float hot = uHotK * exp(-d * d * 340.0);
          float v = clamp(L * 0.55 + hot * 0.9, 0.0, 1.0);
          v += (hash(vUv * 400.0 + uTime) - 0.5) * 0.05;
          vec3 c = ironbow(clamp(v, 0.0, 1.0));
          gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    })
    this.povQuadScene.add(
      new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.povIr)
    )
    this.povState = {}
    this._povFrame = 0
  }

  /**
   * 每帧把两个视角窗最新的画面贴到画布上（主画面每帧都整幅重画，窗口位置必须每帧补一次）。
   * 冻结（截图 / 录屏）时也要补，不然两个窗里只剩主画面。
   */
  _blitPov() {
    const els = this._povEls?.()
    if (!els?.vis || !els?.ir || !this.povState?.id) return
    const r = this.renderer
    const cr = this.canvas.getBoundingClientRect()
    const prevAuto = r.autoClear
    r.autoClear = false
    r.setRenderTarget(null)
    r.setScissorTest(true)
    for (const [el, quad] of [
      [els.vis, this.povVisScene],
      [els.ir, this.povQuadScene]
    ]) {
      const b = el.getBoundingClientRect()
      const x = b.left - cr.left
      const y = cr.height - (b.top - cr.top) - b.height
      r.setViewport(x, y, b.width, b.height)
      r.setScissor(x, y, b.width, b.height)
      r.clearDepth()
      r.render(quad, this.povQuadCam)
    }
    r.setScissorTest(false)
    r.setViewport(0, 0, cr.width, cr.height)
    r.autoClear = prevAuto
  }

  /** 画两个视角窗；返回要交给页面的状态（取景的无人机、识别框位置） */
  _renderPov(snap, time) {
    const els = this._povEls?.()
    if (!els?.vis || !els?.ir || !snap) {
      this.povState = {}
      return
    }
    // 取景的机：有关注点就用离它最近的那架（一号机 / 三号机），否则三号机在飞用三号机，再否则一号机，都不在飞就整块隐藏
    const fc = snap.focus
    const cand = ["UAV-03", "UAV-01"]
      .map((id) => snap.drones.find((x) => x.id === id))
      .filter((x) => x?.airborne)
    const d = fc
      ? cand.sort(
          (a, b) =>
            Math.hypot(a.x - fc.x, a.y - fc.y) -
            Math.hypot(b.x - fc.x, b.y - fc.y)
        )[0]
      : cand[0]
    if (!d) {
      this.povState = { id: null }
      return
    }
    const p = this.fleet.worldPos(d.id)
    const tg = fc ?? { x: 0, y: 0 }
    const tgW = new THREE.Vector3(tg.x - CX, 3, -(tg.y - CY))
    // 核验 / 追踪时盯着关注点；其余时候朝机头方向斜下方看
    const tracking = !!fc && (d.task === 3 || d.task === 6)
    const look = tracking
      ? tgW
      : p
          .clone()
          .add(
            new THREE.Vector3(
              Math.cos(d.heading ?? 0) * 60,
              -45,
              -Math.sin(d.heading ?? 0) * 60
            )
          )
    const cam = this.povCam
    cam.position.copy(p)
    cam.lookAt(look)
    cam.updateMatrixWorld()

    const cr = this.canvas.getBoundingClientRect()
    const rectOf = (el) => {
      const r = el.getBoundingClientRect()
      return {
        x: r.left - cr.left,
        y: cr.height - (r.top - cr.top) - r.height,
        w: r.width,
        h: r.height
      }
    }
    const r = this.renderer
    const prevAuto = r.autoClear
    r.autoClear = false
    r.setScissorTest(false)
    const k = this._povFrame++
    // 离屏渲染：可见光窗和红外窗交替，各 4 帧一次；第一帧两张都画（不然红外窗开头几帧是空的）
    const doVis = k === 0 || k % 4 === 0
    const doIr = k === 0 || k % 4 === 2
    for (const [on, rt, el] of [
      [doVis, this.povVisRT, els.vis],
      [doIr, this.povRT, els.ir]
    ]) {
      if (!on) continue
      const q = rectOf(el)
      cam.aspect = q.w / q.h
      cam.updateProjectionMatrix()
      r.setRenderTarget(rt)
      r.clear()
      r.render(this.scene, cam)
    }
    // 目标投影到视角相机里（识别框和热源位置）
    const ndc = tgW.clone().project(cam)
    const inView =
      tracking && Math.abs(ndc.x) < 0.9 && Math.abs(ndc.y) < 0.9 && ndc.z < 1
    this.povIr.uniforms.uHot.value.set((ndc.x + 1) / 2, (ndc.y + 1) / 2)
    this.povIr.uniforms.uHotK.value = inView ? 1 : 0
    this.povIr.uniforms.uTime.value = (time * 31) % 100
    r.setRenderTarget(null)
    r.setViewport(0, 0, cr.width, cr.height)
    r.autoClear = prevAuto
    this._blitPov()

    // 识别框：占窗口宽度的比例，随距离缩放
    const dist = p.distanceTo(tgW)
    const bw = Math.min(0.46, Math.max(0.16, (75 / Math.max(dist, 30)) * 0.5))
    const box = inView
      ? { x: (ndc.x + 1) / 2, y: 1 - (ndc.y + 1) / 2, w: bw, h: bw * 1.35 }
      : null
    this.povState = {
      id: d.id,
      vis: box,
      ir: box,
      label: fc?.label ?? "",
      temp: fc?.irLabel ?? "",
      note: fc?.note ?? ""
    }
  }

  // ================================================================ 每帧（父类渲染循环里的钩子）

  /** 渲染前：推进仿真时钟，拿快照，更新光照、无人机、信息层、充电棚灯带、光环、跟随 */
  beforeRender() {
    if (!this.fleet || this.frozen) return
    const now = performance.now()
    // 仿真时钟用真实间隔，帧率低时也不变慢；动画（旋翼、呼吸）用截断的间隔
    const dtReal = Math.min(1, (now - (this._prev ?? now)) / 1000)
    const dtAnim = Math.min(0.1, dtReal)
    this._prev = now
    const snap = this.getFrame(dtReal)
    this._snap = snap
    if (Math.abs(snap.t / 60 - this.hour) > 0.012) this.setTime(snap.t / 60)
    this.fleet.update(snap, dtAnim)
    this.overlay.update(snap, this.clockT)
    // 充电棚灯带：随温度等级变色（预警琥珀、告警红、过期灰、正常象牙）
    for (const [id, s] of Object.entries(this.sheds)) {
      const lv = snap.thermal[id].level
      s.glow.color.setHex(
        lv === "alarm"
          ? 0xff5a5f
          : lv === "warn"
            ? 0xe8b04a
            : lv === "stale"
              ? 0x8f8372
              : 0xf3ebdd
      )
    }
    // 点状设施 / 无人机的选中光环：跟着目标走、呼吸
    const t = this._ptTarget
    const halo = this._ptHalo
    halo.visible = !!t
    if (t) {
      let x = t.x
      let z = -t.y
      if (t.drone) {
        const w = this.fleet.worldPos(t.drone)
        x = w.x
        z = w.z
      }
      halo.position.set(x - CX, 1.2, z + CY)
      halo.scale.setScalar(t.size)
      halo.material.opacity = 0.65 + 0.3 * Math.sin(this.clockT * 3)
    }
    // 跟随：飞到位后目标点向无人机靠拢、相机保持相对位置
    if (!this._tween) {
      if (this._followNext) {
        this._follow = { id: this._followNext }
        this._followNext = null
      } else if (this._follow) {
        const w = this.fleet.worldPos(this._follow.id)
        const delta = w
          .clone()
          .sub(this.controls.target)
          .multiplyScalar(Math.min(1, dtAnim * 3))
        this.controls.target.add(delta)
        this.camera.position.add(delta)
      }
    }
  }

  /** 渲染后：画两个无人机视角窗（要在主画面之后，直接写在画布上） */
  afterRender() {
    if (!this.fleet) return
    if (this.frozen) this._blitPov()
    else this._renderPov(this._snap, this.clockT)
  }

  setFrozen(on) {
    super.setFrozen(on)
    if (!on) this._prev = performance.now()
  }

  stats() {
    return { ...super.stats(), mode: "community" }
  }
}

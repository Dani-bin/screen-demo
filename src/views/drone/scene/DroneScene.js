/*
 * 无人机巡检监控平台 · 三维场景（不依赖 Vue）
 * ----------------------------------------------------------
 * 负责：
 *   - 渲染管线：Neutral 色调映射（只在输出阶段做一次）、辉光（只给真实光源）、DPR ≤ 2
 *   - 主机位 = 定稿标定相机（data/camera.json），保证和定稿逐像素对齐
 *   - 黄昏天空（按视线高度角在窄范围内取色，见 theme.js）、夕阳、天光、远景雾
 *   - 加载 Blender 导出的 public/drone/park.glb（园区）和 fleet.glb（无人机预制件，克隆 4 架）
 *   - 每帧按仿真轨迹摆无人机、转桨、开合舱盖；叠加层（航线、尾迹、事件光圈 / 光柱、禁飞柱）
 *   - 机载画面（第二相机，可见光 / 红外伪彩），画在主画布上机载窗口那块区域
 *   - 拾取 / 选中高亮、飞到某处、跟随无人机、ID 图、渲染统计（截图比对用）
 *
 * 设备约定：模型里的根节点名 = devices.json 的编号；找不到直接报错，不静默跳过。
 * 坐标：site.js 的场地坐标 (x 东, y 北, z 上) → three.js (x, z, -y)，见 theme.js 的 w2t。
 */
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"
import { THEME, w2t } from "./theme.js"
import { findDeviceNode, idMaskRole } from "./deviceLookup.js"
import { Overlays } from "./overlays.js"
import { Pov } from "./pov.js"
import { Effects } from "./effects.js"
import { LampLights } from "./lights.js"
import { rippleNormalMap, waterShading } from "./water.js"

/** o 是否在 group 的子树里 */
const isUnder = (o, group) => {
  for (let p = o; p; p = p.parent) if (p === group) return true
  return false
}
import { poseAt } from "../sim/simulator.js"
import { DOCKS } from "../data/layout.js"

const DEG = Math.PI / 180
const DOCK_IDS = Object.keys(DOCKS)

export class DroneScene {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ getTime: () => number, onPick?: (id: string|null) => void }} opts
   *   getTime：当前显示的时刻（毫秒时间戳，实时 / 回放由页面决定），每帧调用
   */
  constructor(canvas, { getTime, onPick } = {}) {
    this.canvas = canvas
    this.getTime = getTime || (() => Date.now())
    this.onPick = onPick || (() => {})
    this.devices = new Map() // 编号 → 根节点
    this.tickers = new Set()
    this.frozen = false
    this.selected = null
    this.day = null
    this.state = null
    this.mode = "home" // home | fly | follow
    this._fps = { frames: 0, last: performance.now(), value: 0 }

    // ---------- 渲染器
    const r = (this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance"
    }))
    r.toneMapping = THREE.NeutralToneMapping
    r.toneMappingExposure = THEME.exposure
    r.outputColorSpace = THREE.SRGBColorSpace
    // 渲染统计按整帧累计（每帧开头清零）：一帧里有主画面、辉光后处理、机载画面好几次 render，
    // 默认每次 render 都清零，stats() 只能读到最后一次（机载画面的全屏四边形）
    r.info.autoReset = false
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFSoftShadowMap

    const scene = (this.scene = new THREE.Scene())
    scene.background = new THREE.Color(THEME.background)
    scene.fog = new THREE.Fog(THEME.fog.color, THEME.fog.near, THEME.fog.far)

    // ---------- 相机：主机位 = 标定结果
    const c = THEME.camera
    this.camera = new THREE.PerspectiveCamera(c.fov, c.aspect, 5, 14000)
    this.home = {
      position: new THREE.Vector3().fromArray(c.position),
      target: new THREE.Vector3().fromArray(c.target),
      up: new THREE.Vector3().fromArray(c.up)
    }
    this._applyHome()
    this.controls = new OrbitControls(this.camera, canvas)
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.08,
      minDistance: 30,
      maxDistance: 3200,
      maxPolarAngle: 86 * DEG
    })
    this.controls.target.copy(this.home.target)
    this.controls.enabled = true
    // OrbitControls 构造时会让相机看向它默认的目标 (0,0,0)，把标定好的朝向改掉了，这里重新套用主机位
    this._applyHome()
    this.lastInteract = -1e9
    // 真正拖动（超过 5 px，见 _onMove）才离开主机位；单击只是拾取，主机位和暗角保持不变
    this.controls.addEventListener(
      "start",
      () => (this.lastInteract = performance.now())
    )

    this._sky()
    this._lights()

    // ---------- 后处理：辉光（离屏 4× MSAA）→ 输出（色调映射 + sRGB）
    const rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4
    })
    this.composer = new EffectComposer(r, rt)
    this.composer.addPass(new RenderPass(scene, this.camera))
    // 清洗：个别像素是 NaN / 无穷大（退化三角面的法线等）时，辉光的多级模糊会把它扩散到全屏、整张变黑，
    // 所以进辉光之前把这类像素置零
    this.composer.addPass(
      new ShaderPass({
        uniforms: { tDiffuse: { value: null } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
          void main(){ vec4 c = texture2D(tDiffuse, vUv);
            if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
            gl_FragColor = clamp(c, 0.0, 64.0); }`
      })
    )
    const b = THEME.bloom
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(256, 256),
      b.strength,
      b.radius,
      b.threshold
    )
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.overlays = new Overlays(scene, this)
    this.pov = new Pov(this)
    this.effects = new Effects(scene)
    this.raycaster = new THREE.Raycaster()

    this._onResize = () => this.resize()
    window.addEventListener("resize", this._onResize)
    this._downAt = null
    this._onDown = (e) => (this._downAt = [e.clientX, e.clientY])
    this._onUp = (e) => {
      if (!this._downAt) return
      const moved = Math.hypot(
        e.clientX - this._downAt[0],
        e.clientY - this._downAt[1]
      )
      this._downAt = null
      if (moved < 5) this.onPick(this.pick(e.clientX, e.clientY))
    }
    this._onMove = (e) => {
      if (!this._downAt || !e.buttons) return
      const moved = Math.hypot(
        e.clientX - this._downAt[0],
        e.clientY - this._downAt[1]
      )
      if (moved > 5 && (this.mode === "home" || this.mode === "fly")) {
        this._tween = null
        this.mode = "free"
      }
    }
    canvas.addEventListener("pointerdown", this._onDown)
    canvas.addEventListener("pointermove", this._onMove)
    canvas.addEventListener("pointerup", this._onUp)
    this.resize()
    this.clock = new THREE.Clock()
    r.setAnimationLoop(() => this._frame())
  }

  // ================================================================ 天空 / 灯光

  /** 天空穹顶：按视线高度角取色 + 落日光晕；另用同一张天空生成环境贴图，金属件反射暖色天光 */
  _sky() {
    const stops = THEME.sky.stops
    const glsl = stops.map(([e, col], i) => {
      const cc = new THREE.Color(col)
      return `vec4(${(e * DEG).toFixed(5)}, ${cc.r.toFixed(4)}, ${cc.g.toFixed(4)}, ${cc.b.toFixed(4)})${i < stops.length - 1 ? "," : ""}`
    })
    // 图上太阳像素在主机位里的方向（天空光晕用）
    const ndc = new THREE.Vector3(
      THEME.sky.sunPx[0] / 960 - 1,
      1 - THEME.sky.sunPx[1] / 540,
      0.5
    )
    const sunSky = ndc
      .unproject(this.camera)
      .sub(this.camera.position)
      .normalize()
    this.sunSkyDir = sunSky
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uSun: { value: sunSky },
        uGlow: { value: new THREE.Color(THEME.sky.sunGlow) }
      },
      vertexShader: `varying vec3 vDir;
        void main(){ vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }`,
      fragmentShader: `varying vec3 vDir; uniform vec3 uSun; uniform vec3 uGlow;
        const vec4 S[${stops.length}] = vec4[${stops.length}](${glsl.join("")});
        void main(){
          vec3 d = normalize(vDir); float e = asin(clamp(d.y, -1.0, 1.0));
          vec3 col = S[0].yzw;
          for (int i = 1; i < ${stops.length}; i++) { float k = clamp((e - S[i-1].x) / (S[i].x - S[i-1].x), 0.0, 1.0); if (e > S[i-1].x) col = mix(S[i-1].yzw, S[i].yzw, k); }
          float g = max(dot(d, normalize(uSun)), 0.0);
          col += uGlow * (pow(g, 900.0) * 3.0 + pow(g, 60.0) * 0.45 + pow(g, 8.0) * 0.12);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`
    })
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(12000, 48, 24), mat)
    this.skyMesh.frustumCulled = false
    this.skyMesh.renderOrder = -10
    this.scene.add(this.skyMesh)
    // 环境贴图：只放天空渲染一次
    const pm = new THREE.PMREMGenerator(this.renderer)
    const envScene = new THREE.Scene()
    const sky2 = this.skyMesh.clone()
    sky2.geometry = new THREE.SphereGeometry(100, 32, 16)
    envScene.add(sky2)
    this.scene.environment = pm.fromScene(envScene, 0, 0.1, 400).texture
    this.scene.environmentIntensity = THEME.envIntensity
    pm.dispose()
  }

  _lights() {
    const s = THEME
    this.scene.add(
      new THREE.HemisphereLight(s.hemi.sky, s.hemi.ground, s.hemi.intensity)
    )
    // 夕阳方位 = 天空里太阳的方位，高度角 +8°
    const az = Math.atan2(this.sunSkyDir.z, this.sunSkyDir.x)
    const el = s.sun.elevationDeg * DEG
    const dir = new THREE.Vector3(
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az)
    )
    const [cx, cy] = s.shadow.center
    const center = new THREE.Vector3(...w2t(cx, cy, 0))
    const sun = (this.sun = new THREE.DirectionalLight(
      s.sun.color,
      s.sun.intensity
    ))
    sun.position.copy(center).addScaledVector(dir, 1500)
    sun.target.position.copy(center)
    sun.castShadow = true
    sun.shadow.mapSize.set(s.shadow.size, s.shadow.size)
    const h = s.shadow.half
    Object.assign(sun.shadow.camera, {
      left: -h,
      right: h,
      top: h,
      bottom: -h,
      near: 200,
      far: 3200
    })
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.6
    sun.shadow.camera.updateProjectionMatrix()
    this.scene.add(sun, sun.target)
    const fill = new THREE.DirectionalLight(s.fill.color, s.fill.intensity)
    fill.position.copy(center).add(new THREE.Vector3(600, 900, -600))
    this.scene.add(fill)
  }

  // ================================================================ 加载

  /**
   * 加载园区与无人机模型，登记设备。devices: devices.json（无人机条目除外，飞机是克隆出来的）
   * 找不到某台设备的节点时抛 Error("缺失设备 " + id)
   */
  async load(base, devices) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    const [park, fleet] = await Promise.all([
      loader.loadAsync(base + "drone/park.glb"),
      loader.loadAsync(base + "drone/fleet.glb")
    ])
    this.model = park.scene
    this.scene.add(park.scene)
    for (const d of devices) {
      if (d.kind === "drone") continue
      const root = findDeviceNode(park.scene, d.node || d.id)
      if (!root) throw new Error("缺失设备 " + d.id)
      root.userData.deviceId = d.id
      this.devices.set(d.id, root)
    }
    this._tuneMaterials(park.scene)
    // 机场舱盖（页面按名字开合）
    this.lids = {}
    for (const id of DOCK_IDS) {
      const L = findDeviceNode(park.scene, `${id}_lid_L`)
      const R = findDeviceNode(park.scene, `${id}_lid_R`)
      if (!L || !R) throw new Error(`缺失机场舱盖 ${id}_lid_L / _lid_R`)
      this.lids[id] = { L, R, open: 0 }
    }
    // 无人机：克隆 4 架，挂编号，桨叶单独转
    const proto = findDeviceNode(fleet.scene, "UAV")
    if (!proto) throw new Error("fleet.glb 缺少 UAV 根节点")
    this.drones = {}
    for (const id of DOCK_IDS) {
      const did = DOCKS[id].drone
      const ob = proto.clone(true)
      ob.name = did
      ob.userData.deviceId = did
      ob.scale.setScalar(THEME.droneScale)
      // 无人机不投影：放大后也只有约 2 m 见方、飞在 50–130 m 高，影子落在远处、画面里看不出；
      // 不投影的话场景里就没有会动的投影物体，阴影贴图加载后画一次即可（见 load 末尾）
      ob.traverse((o) => {
        if (o.isMesh) o.castShadow = false
      })
      const props = []
      ob.traverse(
        (o) => /UAV_prop_\d/.test(o.userData?.name || o.name) && props.push(o)
      )
      this.scene.add(ob)
      this.drones[did] = { ob, props, dock: id }
      this.devices.set(did, ob)
    }
    this._batchDevices()
    // 灯光点缀（光晕 / 路灯光池 / 江面倒影）：从模型里的灯头位置生成，见 lights.js
    this.lights = new LampLights(this.scene, this.model)
    await this.renderer.compileAsync(this.scene, this.camera)
    // 阴影是静态的（太阳、阴影相机都固定，无人机不投影；舱盖开合的影子只有 2 m 见方，忽略）：
    // 加载后画一次，之后每帧不再重画。原先每次 render 都重画，一帧里主画面、机载画面各画一遍，
    // 光阴影就占约 470 × 2 次 draw call（比对第 32 轮性能统计）
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.shadowMap.needsUpdate = true
    return park
  }

  /**
   * 静态设备按材质合批：每台设备根节点下同材质（且顶点属性一致）的零件合并成一个网格，挂回设备根节点。
   * 拾取（按祖先找设备编号）、选中高亮（遍历根节点下的网格换材质）、标签锚点（根节点位置）都不受影响。
   * 机场（舱盖要开合）、无人机（桨叶要转）不合批。三套装置各由 70–100 个零件组成，
   * 合批前主画面一帧约 345 次 draw call（比对第 32 轮性能统计）。
   */
  _batchDevices() {
    for (const [id, root] of this.devices) {
      if (/^(DK|UAV)-/.test(id)) continue
      root.updateMatrixWorld(true)
      const inv = root.matrixWorld.clone().invert()
      // 分组键：材质 + 顶点属性签名（名称、分量数、数组类型、是否归一化）+ 有无索引 + 阴影设置
      const groups = new Map()
      root.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material)) return
        if (o.children.length) return // 下面还挂着子节点的零件保持原样
        const g = o.geometry
        const attrs = Object.keys(g.attributes)
          .sort()
          .map((k) => {
            const a = g.attributes[k]
            if (a.isInterleavedBufferAttribute) return null
            return `${k}:${a.itemSize}:${a.array.constructor.name}:${a.normalized}`
          })
        if (attrs.includes(null)) return
        const key = [
          o.material.uuid,
          attrs.join(","),
          !!g.index,
          o.castShadow,
          o.receiveShadow
        ].join("|")
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(o)
      })
      for (const list of groups.values()) {
        if (list.length < 2) continue
        const m4 = new THREE.Matrix4()
        const geoms = list.map((o) =>
          o.geometry
            .clone()
            .applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld))
        )
        const merged = mergeGeometries(geoms, false)
        for (const g of geoms) g.dispose()
        if (!merged) continue // 个别不兼容的组保持原样
        const mesh = new THREE.Mesh(merged, list[0].material)
        mesh.name = `${id}_batch_${list[0].material.name}`
        mesh.castShadow = list[0].castShadow
        mesh.receiveShadow = list[0].receiveShadow
        root.add(mesh)
        // 原零件的几何体可能和别处共用（Blender 里关联复制的网格），只摘下节点、不释放几何体
        for (const o of list) o.removeFromParent()
      }
    }
  }

  /** 按材质名调自发光 / 反射；地面不投影 */
  _tuneMaterials(root) {
    // 原材质 → 调整后的材质（同一材质只处理一次；需要换成物理材质的在这里记下替换结果）
    const done = new Map()
    const tune = (m) => {
      if (done.has(m)) return done.get(m)
      const cfg = THEME.materials[m.name]
      let out = m
      if (cfg) {
        // 配了 specularIntensity 的换成 MeshPhysicalMaterial（标准材质的高光强度固定，压不下来）：
        // 只拷标准材质的字段，物理材质特有的字段保持默认
        if ("specularIntensity" in cfg && !m.isMeshPhysicalMaterial) {
          out = new THREE.MeshPhysicalMaterial()
          THREE.MeshStandardMaterial.prototype.copy.call(out, m)
          // copy 会把标准材质的 defines（只有 STANDARD）一起拷过来，不补 PHYSICAL 着色器就还按标准材质编译
          out.defines = { STANDARD: "", PHYSICAL: "" }
        }
        for (const [k, v] of Object.entries(cfg)) {
          if (k === "emissive") out.emissiveIntensity = v
          else if (k === "color") out.color.set(v)
          else if (k === "ripple") {
            // 江面波纹：程序生成的法线贴图（water.js）
            out.normalMap = rippleNormalMap()
            out.normalMap.repeat.set(...v.repeat)
            out.normalScale.set(v.scale, v.scale)
            // 去掉夕阳的镜面高光、叠假天光反射（见 water.js）
            if (v.sky) waterShading(out, v.sky)
          } else out[k] = v
        }
        out.needsUpdate = true
      }
      done.set(m, out)
      return out
    }
    root.traverse((o) => {
      if (!o.isMesh) return
      o.material = Array.isArray(o.material)
        ? o.material.map(tune)
        : tune(o.material)
      const mats = [].concat(o.material)
      o.receiveShadow = !mats.some((m) => THEME.noReceive.includes(m.name))
      o.castShadow = !mats.some((m) => THEME.noCast.includes(m.name))
    })
  }

  // ================================================================ 数据

  /** 页面每次刷新状态时调用：day = simulateDay 的结果，state = stateAt 的结果 */
  setData(day, state) {
    this.day = day
    this.state = state
    this.overlays.update(day, state, this.getTime())
  }

  // ================================================================ 相机

  _applyHome() {
    this.camera.position.copy(this.home.position)
    this.camera.up.copy(this.home.up)
    this.camera.lookAt(this.home.target)
    this.camera.fov = THEME.camera.fov
    this.camera.updateProjectionMatrix()
  }

  /** 回到定稿机位（立即生效，截图前调用） */
  setView(name = "home") {
    if (name !== "home") throw new Error(`未定义的机位 ${name}`)
    this.mode = "home"
    this.follow = null
    this._tween = null
    this._applyHome()
    this.controls.target.copy(this.home.target)
  }

  get views() {
    return { home: THEME.camera }
  }

  /**
   * 飞到某处：focus 为场地坐标 [x, y, z]，dist 为镜头距离（米），pitch 俯角（度），
   * yaw 为相对主机位方位的偏转（度）；dur 秒。飞完停在那里（free 模式），用户可以拖动。
   */
  flyTo(focus, { dist = 320, pitch = 32, yaw = 0, dur = 1.6 } = {}) {
    this.follow = null
    const tgt = new THREE.Vector3(...w2t(focus[0], focus[1], focus[2] || 0))
    const homeDir = new THREE.Vector3()
      .subVectors(this.home.position, this.home.target)
      .setY(0)
      .normalize()
    const a = Math.atan2(homeDir.z, homeDir.x) + yaw * DEG
    const p = new THREE.Vector3(
      Math.cos(a) * Math.cos(pitch * DEG),
      Math.sin(pitch * DEG),
      Math.sin(a) * Math.cos(pitch * DEG)
    )
      .multiplyScalar(dist)
      .add(tgt)
    this._startTween(p, tgt, dur)
    this.mode = "fly"
  }

  /** 回到主机位（平滑） */
  flyHome(dur = 1.6) {
    this.follow = null
    this._startTween(
      this.home.position.clone(),
      this.home.target.clone(),
      dur,
      () => this.setView("home")
    )
    this.mode = "fly"
  }

  _startTween(pos, tgt, dur, done) {
    this.camera.up.set(0, 1, 0)
    this._tween = {
      p0: this.camera.position.clone(),
      t0: this.controls.target.clone(),
      p1: pos,
      t1: tgt,
      k: 0,
      dur,
      done
    }
  }

  /** 跟随某架无人机：镜头在它后上方，平滑追随 */
  followDrone(id) {
    this.follow = id
    this._tween = null
    this.mode = "follow"
    this.camera.up.set(0, 1, 0)
  }

  // ================================================================ 拾取 / 选中

  /** 屏幕坐标拾取，返回设备编号或 null（向上找到带 deviceId 的祖先） */
  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    for (const hit of this.raycaster.intersectObjects(
      [...this.devices.values()],
      true
    )) {
      let o = hit.object
      while (o && o.userData.deviceId === undefined) o = o.parent
      if (o) return o.userData.deviceId
    }
    return null
  }

  /** 选中高亮：给该设备的材质加自发光（材质先克隆，避免共享材质把别的设备一起点亮） */
  select(id) {
    if (this.selected) this._highlight(this.devices.get(this.selected), false)
    this.selected = id && this.devices.has(id) ? id : null
    if (this.selected) this._highlight(this.devices.get(this.selected), true)
  }

  _highlight(root, on) {
    if (!root) return
    const color = new THREE.Color(THEME.selectColor)
    root.traverse((o) => {
      if (!o.isMesh) return
      if (on) {
        o.userData.baseMaterial ??= o.material
        o.material = [].concat(o.userData.baseMaterial).map((m) => {
          const c = m.clone()
          if (c.emissive) {
            c.emissive = color
            c.emissiveIntensity = 0.45
          }
          return c
        })
        if (!Array.isArray(o.userData.baseMaterial)) o.material = o.material[0]
      } else if (o.userData.baseMaterial) {
        ;[].concat(o.material).forEach((m) => m.dispose())
        o.material = o.userData.baseMaterial
      }
    })
  }

  // ================================================================ 投影

  /** 场地坐标 → 设计稿 px（1920 宽）；在相机背后时 visible = false */
  project(x, y, z = 0) {
    const v = new THREE.Vector3(...w2t(x, y, z)).project(this.camera)
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    const s = 1920 / w
    return {
      x: ((v.x + 1) / 2) * w * s,
      y: ((1 - v.y) / 2) * h * s,
      visible: v.z < 1 && v.z > -1
    }
  }

  /** 设备根节点在场地坐标里的位置（标签锚点） */
  anchorOf(id) {
    const o = this.devices.get(id)
    if (!o) return null
    const p = new THREE.Vector3()
    o.getWorldPosition(p)
    return [p.x, -p.z, p.y]
  }

  // ================================================================ 每帧

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.overlays.resize(w, h)
  }

  setFrozen(on) {
    this.frozen = on
    this.clock.getDelta()
  }

  _frame() {
    this.renderer.info.reset()
    const dt = this.frozen ? 0 : Math.min(this.clock.getDelta(), 0.1)
    const t = this.getTime()
    // 仿真时间前进了多少秒：回放暂停 / 冻结 / 钉住时为 0（动效停在那一刻），拖动回放时一次跳很多（舱盖直接到位）
    const simDt =
      this._lastT === undefined
        ? 0
        : Math.max(0, Math.min(30, (t - this._lastT) / 1000))
    this._lastT = t
    if (this.day && this.drones) this._animate(t, simDt)
    this._camera(dt)
    for (const fn of this.tickers) fn(dt)
    this.overlays.tick(simDt, t)
    this.effects.tick(t)
    this.lights?.update(this.camera)
    this.skyMesh.position.copy(this.camera.position)
    this.composer.render()
    this.pov.render(t)
    const f = this._fps
    f.frames++
    const now = performance.now()
    if (now - f.last >= 1000) {
      f.value = Math.round((f.frames * 1000) / (now - f.last))
      f.frames = 0
      f.last = now
    }
  }

  /** 按仿真轨迹摆无人机、转桨、开合舱盖（全部由仿真时刻派生，dt 是仿真时间的增量） */
  _animate(t, dt) {
    this.poses = this.poses || {}
    for (const id of DOCK_IDS) {
      const pose = poseAt(this.day, id, t)
      this.poses[id] = pose
      const dr = this.drones[DOCKS[id].drone]
      const d = pose.drone
      const inAir = d.state !== "docked"
      // 舱内待命时停在机场停机坪上（舱盖关着也看不见，但跟随 / 详情时位置是对的）
      const z = inAir
        ? d.z
        : DOCKS[id].roof + (DOCKS[id].roof ? 0.6 : 0.05) + 0.56
      dr.ob.position.set(...w2t(d.x, d.y, z))
      dr.ob.rotation.set(0, (90 - d.heading) * DEG, 0)
      dr.ob.visible = inAir || pose.lid !== "closed"
      // 桨叶转角 = 仿真时刻 × 转速（在飞约 10 圈 / s，开舱待起飞时慢转），回放暂停时自然停住
      const spin = inAir ? 60 : pose.lid === "open" ? 8 : 0
      const phase = ((t / 1000) * spin) % (Math.PI * 2)
      for (const p of dr.props)
        p.rotation.y = /[24]$/.test(p.name) ? -phase : phase
      // 舱盖：开 / 合各约 15 s，按目标角度缓动
      const L = this.lids[id]
      const target = pose.lid === "open" || pose.lid === "opening" ? 1 : 0
      L.open +=
        Math.sign(target - L.open) * Math.min(Math.abs(target - L.open), dt / 3)
      // 左扇向西翻、右扇向东翻（铰链在外侧边缘，绕南北向的轴转）
      L.L.rotation.z = L.open * 100 * DEG
      L.R.rotation.z = -L.open * 100 * DEG
    }
  }

  _camera(dt) {
    if (this._tween) {
      const tw = this._tween
      tw.k = Math.min(1, tw.k + dt / tw.dur)
      const e = tw.k < 0.5 ? 4 * tw.k ** 3 : 1 - (-2 * tw.k + 2) ** 3 / 2
      this.camera.position.lerpVectors(tw.p0, tw.p1, e)
      this.controls.target.lerpVectors(tw.t0, tw.t1, e)
      this.camera.lookAt(this.controls.target)
      if (tw.k >= 1) {
        this._tween = null
        this.mode = "free"
        tw.done?.()
      }
      return
    }
    if (this.mode === "follow" && this.follow && this.drones?.[this.follow]) {
      const ob = this.drones[this.follow].ob
      const head = ob.rotation.y
      const want = ob.position
        .clone()
        .add(new THREE.Vector3(-Math.cos(head) * 70, 38, Math.sin(head) * 70))
      const k = 1 - Math.exp(-dt * 2.2)
      this.camera.position.lerp(want, k)
      this.controls.target.lerp(ob.position, k * 1.5)
      this.camera.lookAt(this.controls.target)
      return
    }
    if (this.mode !== "home") this.controls.update()
  }

  // ================================================================ 截图 / 比对用

  /**
   * 按设备编号渲染纯色 ID 图（compare.py 算轮廓 IoU）：设备 i 的颜色 = ((n & 63) × 4, ((n >> 6) & 63) × 4, 128)，n = i + 1
   */
  async renderIdMask() {
    const r = this.renderer
    const size = r.getDrawingBufferSize(new THREE.Vector2())
    const rt = new THREE.WebGLRenderTarget(size.x, size.y)
    const map = {}
    const black = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false })
    const saved = []
    const owner = new Map()
    ;[...this.devices.keys()].forEach((id, i) => {
      const n = i + 1
      const rgb = [(n & 63) * 4, ((n >> 6) & 63) * 4, 128]
      map[id] = rgb
      const m = new THREE.MeshBasicMaterial({ fog: false })
      m.color.setRGB(
        rgb[0] / 255,
        rgb[1] / 255,
        rgb[2] / 255,
        THREE.LinearSRGBColorSpace
      )
      this.devices.get(id).traverse((o) => o.isMesh && owner.set(o, m))
    })
    const bg = this.scene.background
    const fog = this.scene.fog
    const tm = r.toneMapping
    const buf = new Uint8Array(size.x * size.y * 4)
    try {
      this.scene.traverse((o) => {
        if (!o.isMesh && !o.isLine && !o.isPoints && !o.isSprite) return
        saved.push([o, o.material, o.visible])
        if (!o.isMesh || o === this.skyMesh) {
          o.visible = false
          return
        }
        // 灯光点缀不是设备，也不该当遮挡物涂黑
        if (this.lights && isUnder(o, this.lights.group)) {
          o.visible = false
          return
        }
        const role = idMaskRole(o, owner.has(o))
        if (role === "device") o.material = owner.get(o)
        else if (role === "hide") o.visible = false
        else o.material = black
      })
      this.scene.background = null
      this.scene.fog = null
      r.toneMapping = THREE.NoToneMapping
      r.setRenderTarget(rt)
      r.setClearColor(0x000000, 1)
      r.clear()
      r.render(this.scene, this.camera)
      r.readRenderTargetPixels(rt, 0, 0, size.x, size.y, buf)
    } finally {
      r.setRenderTarget(null)
      r.toneMapping = tm
      this.scene.background = bg
      this.scene.fog = fog
      for (const [o, m, v] of saved) {
        o.material = m
        o.visible = v
      }
      for (const m of new Set(owner.values())) m.dispose()
      black.dispose()
      rt.dispose()
    }
    const cv = document.createElement("canvas")
    cv.width = size.x
    cv.height = size.y
    const ctx = cv.getContext("2d")
    const img = ctx.createImageData(size.x, size.y)
    for (let y = 0; y < size.y; y++)
      img.data.set(
        buf.subarray((size.y - 1 - y) * size.x * 4, (size.y - y) * size.x * 4),
        y * size.x * 4
      )
    ctx.putImageData(img, 0, 0)
    return { png: cv.toDataURL("image/png"), map }
  }

  stats() {
    const i = this.renderer.info
    return {
      fps: this._fps.value,
      calls: i.render.calls,
      triangles: i.render.triangles,
      geometries: i.memory.geometries,
      textures: i.memory.textures
    }
  }

  dispose() {
    this.renderer.setAnimationLoop(null)
    window.removeEventListener("resize", this._onResize)
    this.canvas.removeEventListener("pointerdown", this._onDown)
    this.canvas.removeEventListener("pointermove", this._onMove)
    this.canvas.removeEventListener("pointerup", this._onUp)
    this.controls.dispose()
    this.pov.dispose()
    this.overlays.dispose()
    this.effects.dispose()
    this.lights?.dispose()
    this.scene.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.dispose()
      for (const m of [].concat(o.material)) {
        for (const v of Object.values(m)) if (v?.isTexture) v.dispose()
        m.dispose()
      }
    })
    this.composer.dispose()
    this.renderer.dispose()
  }
}

/*
 * 智慧港口 三维码头（不依赖 Vue）
 * ----------------------------------------------------------
 * 洋山四期：海面、周边岛屿（真实地形 + Sentinel-2 影像）、码头面、7 个泊位、61 个箱区、
 * 28 台岸桥、121 台轨道吊、145 台 AGV、2 座换电站、船舶、东海大桥 / 颗珠山大桥。
 * 页面（index.vue）和设计稿（docs/design/smart-port/drafts-source.html）共用。
 *
 * 设计稿（静态一帧）：
 *   const s = new PortScene(el, { layout, site, context, theme: THEMES.holo, baseUrl })
 *   await s.load()
 *   s.setState(state, { poses, track, alarm })   // 仿真状态 → 设备位置、箱量、船舶、告警
 *   s.setView({ target: [u, v], dist, yaw, pitch, fov })
 *   s.render()
 * 页面（实时）：
 *   s.startLive({ sim, now, onPick, onUser })     // 开渲染循环：岸桥大车、AGV 逐帧平滑，光迹、光带流动
 *   s.setState(state, { track, alarm })          // 每秒一份仿真状态（AGV 位置由循环自己算）
 *   s.flyTo(view, 秒)                              // 镜头补间；用户拖拽 / 缩放时回调 onUser
 *   s.anchors()                                    // 场景标签的屏幕位置（DOM 标签层用）
 *
 * 坐标：x = u（沿岸线），z = −v（v 向陆地），y 向上（米，海面 0）。
 * 设备编号 = 对象名：岸桥是 Group（名字 QCxx），轨道吊 / AGV 是实例化网格，用 idIndex 映射编号 → 实例下标，
 * 找不到编号就报错（不静默跳过）。
 */
import gsap from "gsap"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js"
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js"
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js"

import {
  agvBody,
  ARMG,
  armgFrame,
  armgTrolley,
  BOX40,
  mastGeometry,
  shipHull,
  spreader,
  stackGeometry,
  stackMaterial,
  STS,
  stsBoom,
  stsFrame,
  stsGantryTrolley,
  stsTrolley,
  TIER_H
} from "./equipment.js"
import {
  buildContext,
  buildSea,
  buildTerminal,
  GROUND,
  PoolLight,
  TOP
} from "./ground.js"
import {
  edgeLines,
  glowColor,
  InstancedEdges,
  LaneFlow,
  RibbonLayer,
  TrailLayer
} from "./holo.js"

/** 船舶类别的甲板箱层数（满载时，假设；第 27 轮比对各加一层：总览里箱顶要接近岸桥前大梁） */
const DECK_TIERS = { ULCV: 10, VLCS: 9, PPX: 8, FDR: 6 }
/** 卸船阶段甲板箱最低降到满载的几成（岸桥逐贝作业，整船甲板不会同时卸空） */
const DECK_MIN = 0.45
/** 船靠泊时船舷离码头前沿的距离（护舷，米） */
const FENDER = 3
/** 锚地：码头南侧海面（u、v，米） */
const ANCHOR = { u: [500, 2400], v: [-2100, -1500] }

const rad = THREE.MathUtils.degToRad
const lerp = THREE.MathUtils.lerp
const smooth = (x) => x * x * (3 - 2 * x)
function hash01(s) {
  let a = 2166136261
  for (const ch of String(s)) a = Math.imul(a ^ ch.charCodeAt(0), 16777619)
  a = Math.imul(a ^ (a >>> 15), 2246822507)
  return ((a ^ (a >>> 13)) >>> 0) / 4294967296
}

export class PortScene {
  constructor(container, { layout, site, context, theme, baseUrl = "/" }) {
    this.el = container
    this.layout = layout
    this.site = site
    this.context = context
    this.theme = theme
    this.base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/"
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = theme.exposure
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.shadowMap.enabled = !!theme.shadow
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    container.appendChild(this.renderer.domElement)
    this.scene = new THREE.Scene()
    const f = theme.fog
    this.scene.fog = new THREE.Fog(new THREE.Color(f.color), f.near, f.far)
    this.camera = new THREE.PerspectiveCamera(30, 1, 5, 60000)
    this.view = {
      target: [1300, 250],
      dist: 3200,
      yaw: -20,
      pitch: 32,
      fov: 30
    }
    this.dynamic = new THREE.Group()
    this.scene.add(this.dynamic)
    // 竖向夸张：定稿概念图里岸桥、船、箱堆都比真实比例高，按主题 vScale 整体拉高（只拉竖向，平面布局仍是真实尺寸）。
    // 码头上的设备、箱堆、建筑放进 tall 组，以码头面 TOP 为基准拉高；船（dynamic 组）以水线 y = 0 为基准拉高；
    // 海面、码头地面、桥梁、岛屿不拉。三维标签的锚点高度在 project() 里按同一公式换算
    this.vk = theme.vScale || 1
    this.tall = new THREE.Group()
    this.tall.scale.y = this.vk
    this.tall.position.y = TOP * (1 - this.vk)
    this.scene.add(this.tall)
    this.dynamic.scale.y = this.vk
    this.blockById = new Map(layout.blocks.map((b) => [b.id, b]))
    this.ships = new Map()
    this.resize()
  }

  resize() {
    const w = this.el.clientWidth || 1920
    const h = this.el.clientHeight || 1080
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.composer?.setSize(w, h)
  }

  /** u / v（米）+ 高度 → 世界坐标 */
  world(u, v, y = TOP) {
    return new THREE.Vector3(u, y, -v)
  }

  async load() {
    const t = this.theme
    const L = this.layout
    // 灯光
    const hemi = new THREE.HemisphereLight(
      t.hemi.sky,
      t.hemi.ground,
      t.hemi.intensity
    )
    const sun = new THREE.DirectionalLight(t.sun.color, t.sun.intensity)
    // 太阳方位角按地理北顺时针 → (东, 北) → 岸线坐标 (u, v)：u 方位 106°，v 方位 16°
    const az = rad(t.sun.azimuth)
    const el = rad(t.sun.elevation)
    const east = Math.sin(az) * Math.cos(el)
    const north = Math.cos(az) * Math.cos(el)
    const ub = rad(L.origin.uBearing)
    const du = east * Math.sin(ub) + north * Math.cos(ub)
    const dv =
      east * Math.sin(ub - Math.PI / 2) + north * Math.cos(ub - Math.PI / 2)
    sun.position.set(1400 + du * 3000, Math.sin(el) * 3000, -(300 + dv * 3000))
    sun.target.position.set(1400, 0, -300)
    if (t.shadow) {
      sun.castShadow = true
      sun.shadow.mapSize.set(4096, 4096)
      const sc = sun.shadow.camera
      sc.left = -1700
      sc.right = 1700
      sc.top = 900
      sc.bottom = -900
      sc.near = 100
      sc.far = 8000
      sun.shadow.bias = -0.0004
      sun.shadow.normalBias = 0.6
    }
    this.scene.add(hemi, sun, sun.target)
    this.sun = sun

    // 夜景光池
    this.pool = t.lights ? new PoolLight(L, t) : null
    if (this.pool) this.pool.draw(L.cranes.map((c) => c.home))

    this.sea = buildSea(t, this.pool)
    this.scene.add(this.sea)
    this.contextMesh = await buildContext(this.context, this.base, t)
    this.scene.add(this.contextMesh)
    const terminal = buildTerminal(this.site, L, t, this.renderer)
    this.scene.add(terminal)
    this.addPoolLight(terminal.children[0].material, 0.9)

    this.buildBridges()
    this.buildBuildings()
    this.buildYard()
    this.buildArmg()
    this.buildCranes()
    this.buildAgvs()
    this.buildMasts()
    this.buildFx()
    if (t.holo) {
      // 作业路光带、AGV 光迹（光迹由页面的渲染循环逐帧推进）
      this.ribbons = new RibbonLayer({
        color: glowColor(t.holo.ribbon, t.holo.edgeGain * 0.9)
      })
      // 光迹 40 个采样点（约 10 秒）：总览里能拉出几十米长的弧线
      this.trails = new TrailLayer(L.agvs, {
        color: glowColor(t.holo.trail, t.holo.edgeGain * 0.9),
        n: 40,
        y: TOP + 1.2
      })
      // AGV 车道光流（码头前沿的"车流"底纹）
      this.lanes = new LaneFlow(L.agvLanes, {
        u0: L.quay.u0,
        u1: L.quay.u1,
        color: glowColor(t.holo.ribbon, t.holo.edgeGain * 0.7),
        y: TOP + 0.6
      })
      this.scene.add(this.ribbons.group, this.trails.lines, this.lanes.mesh)
    }

    // 后期：白天 / 晨雾开环境光遮蔽（GTAO，箱堆、岸桥脚下的接触暗部）；夜景开辉光（只给真实光源，阈值 1.15）；
    // 色调映射（Neutral）只在最后的 OutputPass 做一次
    this.composer = new EffectComposer(
      this.renderer,
      new THREE.WebGLRenderTarget(1, 1, {
        samples: 4,
        type: THREE.HalfFloatType
      })
    )
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    if (t.ao) {
      const ao = new GTAOPass(this.scene, this.camera, 1, 1)
      ao.output = GTAOPass.OUTPUT.Default
      ao.blendIntensity = t.ao.blend
      ao.updateGtaoMaterial({
        radius: t.ao.radius,
        distanceExponent: 1.4,
        thickness: t.ao.thickness,
        scale: 1.2,
        samples: 16
      })
      ao.updatePdMaterial({
        lumaPhi: 10,
        depthPhi: 2,
        normalPhi: 3,
        radius: 5,
        rings: 2,
        samples: 16
      })
      this.composer.addPass(ao)
      this.ao = ao
    }
    if (t.bloom) {
      // 辉光前先把个别 NaN / 无穷大像素清零：半浮点渲染目标会保留它们，辉光模糊会把一个坏像素扩成一大块黑
      this.composer.addPass(
        new ShaderPass({
          uniforms: { tDiffuse: { value: null } },
          vertexShader:
            "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
          fragmentShader:
            "uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0); gl_FragColor = min(c, vec4(64.0)); }"
        })
      )
    }
    if (t.bloom)
      this.composer.addPass(
        new UnrealBloomPass(
          new THREE.Vector2(1920, 1080),
          t.bloom.strength,
          t.bloom.radius,
          t.bloom.threshold
        )
      )
    this.composer.addPass(new OutputPass())
    this.resize()
  }

  /** 夜景：材质按世界坐标采样光池贴图作为自发光（光从高杆灯 / 岸桥 LED 打下来，越高越弱） */
  addPoolLight(mat, gain = 1) {
    if (!this.pool) return
    const pool = this.pool
    const prev = mat.onBeforeCompile
    // three.js 按 onBeforeCompile 的源码文本缓存着色器程序：包装后的函数文本都一样，
    // 必须把被包装的原函数也算进缓存键，否则不同材质会错用同一个程序
    const prevKey = prev ? prev.toString() : ""
    mat.customProgramCacheKey = () => "pool|" + prevKey
    mat.onBeforeCompile = (sh, r) => {
      prev?.call(mat, sh, r)
      sh.uniforms.uPool = { value: pool.texture }
      sh.uniforms.uPoolRect = {
        value: new THREE.Vector4(GROUND.u0, GROUND.u1, GROUND.v0, GROUND.v1)
      }
      sh.uniforms.uPoolGain = { value: gain }
      sh.vertexShader = sh.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vPoolW;\nvarying vec3 vPoolN;"
        )
        .replace(
          "#include <project_vertex>",
          `#include <project_vertex>
          vec4 pw = vec4(transformed, 1.0);
          vec3 pn = objectNormal;
          #ifdef USE_INSTANCING
            pw = instanceMatrix * pw;
            pn = mat3(instanceMatrix) * pn;
          #endif
          vPoolW = (modelMatrix * pw).xyz;
          vec3 pnw = mat3(modelMatrix) * pn;
          vPoolN = dot(pnw, pnw) > 1e-12 ? normalize(pnw) : vec3(0.0, 1.0, 0.0);`
        )
      sh.fragmentShader = sh.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform sampler2D uPool;\nuniform vec4 uPoolRect;\nuniform float uPoolGain;\nvarying vec3 vPoolW;\nvarying vec3 vPoolN;"
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
          vec2 puv = vec2((vPoolW.x - uPoolRect.x) / (uPoolRect.y - uPoolRect.x), (-vPoolW.z - uPoolRect.z) / (uPoolRect.w - uPoolRect.z));
          if (puv.x > 0.0 && puv.x < 1.0 && puv.y > 0.0 && puv.y < 1.0) {
            vec3 pl = texture2D(uPool, puv).rgb;
            float up = 0.35 + 0.65 * max(vPoolN.y, 0.0);
            float fall = clamp(1.15 - vPoolW.y / 60.0, 0.25, 1.0);
            totalEmissiveRadiance += diffuseColor.rgb * pl * up * fall * uPoolGain * 3.2;
          }`
        )
    }
    mat.needsUpdate = true
  }

  /* ---------------- 静态：桥、建筑、灯杆 ---------------- */

  buildBridges() {
    const t = this.theme
    const deckMat = new THREE.MeshStandardMaterial({
      color: t.bridge.deck,
      roughness: 0.85
    })
    const pierMat = new THREE.MeshStandardMaterial({
      color: t.bridge.pier,
      roughness: 0.9
    })
    this.addPoolLight(deckMat, 0.4)
    const decks = []
    const piers = []
    for (const br of this.site.bridges) {
      if (br.kind !== "deck") continue
      const P = br.pts.filter(([u, v]) => u > -9000 && v < 12000)
      for (let i = 1; i < P.length; i++) {
        const [u0, v0] = P[i - 1]
        const [u1, v1] = P[i]
        const len = Math.hypot(u1 - u0, v1 - v0)
        if (len < 1) continue
        // 引桥：落地端贴着码头面，离开陆地后抬到 14 m（假设）
        const y = this.bridgeHeight((u0 + u1) / 2, (v0 + v1) / 2)
        const g = new THREE.BoxGeometry(len, 2.2, 15.5)
        g.rotateY(Math.atan2(v1 - v0, u1 - u0))
        g.translate((u0 + u1) / 2, y, -(v0 + v1) / 2)
        decks.push(g)
        for (let s = 0; s < len; s += 70) {
          const f = s / len
          const u = lerp(u0, u1, f)
          const v = lerp(v0, v1, f)
          const py = this.bridgeHeight(u, v)
          if (py < TOP + 2) continue
          const p = new THREE.BoxGeometry(3, py, 8)
          p.rotateY(Math.atan2(v1 - v0, u1 - u0))
          p.translate(u, py / 2 - 1, -v)
          piers.push(p)
        }
      }
    }
    const merge = (arr) => {
      const g = new THREE.BufferGeometry()
      const parts = arr.map((x) => x.toNonIndexed())
      let n = 0
      for (const p of parts) n += p.attributes.position.count
      const pos = new Float32Array(n * 3)
      const nor = new Float32Array(n * 3)
      let o = 0
      for (const p of parts) {
        pos.set(p.attributes.position.array, o * 3)
        nor.set(p.attributes.normal.array, o * 3)
        o += p.attributes.position.count
      }
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3))
      g.setAttribute("normal", new THREE.BufferAttribute(nor, 3))
      return g
    }
    if (decks.length) {
      const m = new THREE.Mesh(merge(decks), deckMat)
      m.castShadow = true
      m.receiveShadow = true
      this.scene.add(m)
    }
    if (piers.length) this.scene.add(new THREE.Mesh(merge(piers), pierMat))
    // 全息：桥面两侧的金色灯带（每 30 m 一对，远看连成线；间距太大或太亮时在总览里像散落的橙色噪点）
    if (t.holo) {
      const spots = []
      for (const br of this.site.bridges) {
        if (br.kind !== "deck") continue
        const P = br.pts.filter(([u, v]) => u > -9000 && v < 12000)
        for (let i = 1; i < P.length; i++) {
          const [u0, v0] = P[i - 1]
          const [u1, v1] = P[i]
          const len = Math.hypot(u1 - u0, v1 - v0)
          const nx = -(v1 - v0) / (len || 1)
          const nv = (u1 - u0) / (len || 1)
          for (let d = 0; d < len; d += 30) {
            const u = lerp(u0, u1, d / len)
            const v = lerp(v0, v1, d / len)
            const y = this.bridgeHeight(u, v) + 1.6
            for (const sgn of [-1, 1])
              spots.push([u + nx * 8 * sgn, y, -(v + nv * 8 * sgn)])
          }
        }
      }
      const lamp = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1.6, 1.6, 1.6),
        new THREE.MeshBasicMaterial({ color: glowColor(t.holo.gold, 1.8) }),
        spots.length
      )
      const mm = new THREE.Matrix4()
      spots.forEach((p, i) =>
        lamp.setMatrixAt(i, mm.makeTranslation(p[0], p[1], p[2]))
      )
      this.scene.add(lamp)
    }
    // 颗珠山大桥：OSM 只有轮廓，取主轴做斜拉桥（两座 H 形塔，假设塔高 90 m）
    const kz = this.site.bridges.find((b) => b.name === "颗珠山大桥")
    if (kz) {
      const P = kz.pts
      const cu = P.reduce((s, p) => s + p[0], 0) / P.length
      const cv = P.reduce((s, p) => s + p[1], 0) / P.length
      let best = [0, 0, 0]
      for (const a of P)
        for (const c of P) {
          const d = Math.hypot(a[0] - c[0], a[1] - c[1])
          if (d > best[0]) best = [d, Math.atan2(c[1] - a[1], c[0] - a[0]), 0]
        }
      const [len, ang] = best
      const g = new THREE.Group()
      const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 2.6, 26), deckMat)
      deck.position.y = 32
      g.add(deck)
      for (const s of [-0.22, 0.22]) {
        for (const w of [-14, 14]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(4, 96, 4), pierMat)
          leg.position.set(s * len, 48, w)
          g.add(leg)
        }
        const cross = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 32), pierMat)
        cross.position.set(s * len, 70, 0)
        g.add(cross)
      }
      g.position.set(cu, 0, -cv)
      g.rotation.y = ang
      g.traverse((o) => (o.castShadow = true))
      this.scene.add(g)
    }
  }

  /** 东海大桥引桥高度：在码头 / 岛上贴地，离岸后抬到 14 m */
  bridgeHeight(u, v) {
    const T = this.site.terminal
    const near = Math.min(...T.map(([a, b]) => Math.hypot(a - u, b - v)))
    return lerp(
      TOP + 1.5,
      15,
      smooth(Math.min(1, Math.max(0, (near - 60) / 400)))
    )
  }

  buildBuildings() {
    const t = this.theme
    const wall = new THREE.MeshStandardMaterial({
      color: t.building.wall,
      roughness: 0.8
    })
    const roof = new THREE.MeshStandardMaterial({
      color: t.building.roof,
      roughness: 0.9
    })
    const glass = new THREE.MeshStandardMaterial({
      color: t.building.glass,
      roughness: 0.3,
      metalness: 0.2,
      emissive: t.lights
        ? new THREE.Color(t.building.glass)
        : new THREE.Color(0),
      // 全息主题的玻璃只微亮（塔楼的玻璃环带太亮时远看像一个白色月牙）
      emissiveIntensity: t.lights ? (t.holo ? 0.45 : 1.6) : 0
    })
    this.addPoolLight(wall, 0.6)
    const g = new THREE.Group()
    const cc = this.layout.landmarks.find((l) => l.id === "CC-01")
    for (const b of this.site.buildings) {
      const P = b.pts
      const cu = P.reduce((s, p) => s + p[0], 0) / P.length
      const cv = P.reduce((s, p) => s + p[1], 0) / P.length
      // 只建码头附近的（一至三期、镇区在底图上，雾里看不清）
      if (cu < -300 || cu > 3000 || cv < -50 || cv > 760) continue
      const shape = new THREE.Shape(P.map(([u, v]) => new THREE.Vector2(u, v)))
      const h =
        Math.hypot(cu - cc.u, cv - cc.v) < 60 ? 22 : 9 + hash01(b.id) * 8
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: h,
        bevelEnabled: false
      })
      // ExtrudeGeometry 在 XY 平面（x = u、y = v）沿 +z 拉伸 → 绕 x 转 −90°：(x, y, z) → (x, z, −y)，即 x = u、z = −v、沿 +y 拉伸
      geo.rotateX(-Math.PI / 2)
      geo.translate(0, TOP, 0)
      const m = new THREE.Mesh(geo, [roof, wall])
      m.castShadow = true
      m.receiveShadow = true
      g.add(m)
      // 建筑描边：箱区蓝、较暗（陆域建筑只是背景）
      if (t.holo)
        g.add(
          edgeLines(
            geo,
            glowColor(t.holo.stackEdge || t.holo.edge, t.holo.edgeGain * 0.3)
          )
        )
    }
    // 生产指挥中心塔楼（CC-01）：圆柱主楼 16 层 + 顶部指挥层（层数按报道"16 层大屏"，高度假设）
    const tower = new THREE.Group()
    tower.name = "CC-01"
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(15, 16, 64, 40),
      new THREE.MeshStandardMaterial({
        color: t.building.tower,
        roughness: 0.6
      })
    )
    body.position.y = TOP + 32
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(15.4, 15.4, 7, 40),
      glass
    )
    band.position.y = TOP + 60
    const crown = new THREE.Mesh(
      new THREE.CylinderGeometry(17.5, 15.4, 3, 40),
      roof
    )
    crown.position.y = TOP + 65
    for (let k = 0; k < 8; k++) {
      const w = new THREE.Mesh(
        new THREE.CylinderGeometry(15.2, 15.2, 1.2, 40),
        glass
      )
      w.position.y = TOP + 8 + k * 6.4
      tower.add(w)
    }
    tower.add(body, band, crown)
    tower.position.set(cc.u, 0, -cc.v)
    tower.traverse((o) => {
      o.castShadow = true
      o.receiveShadow = true
    })
    g.add(tower)
    // 换电站（长条厂房，侧面开口）与闸口雨棚
    for (const st of this.layout.swapStations) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(st.u1 - st.u0, 11, st.v1 - st.v0),
        wall
      )
      m.position.set((st.u0 + st.u1) / 2, TOP + 5.5, -(st.v0 + st.v1) / 2)
      m.name = st.id
      m.castShadow = true
      const r = new THREE.Mesh(
        new THREE.BoxGeometry(st.u1 - st.u0 + 2, 1, st.v1 - st.v0 + 2),
        roof
      )
      r.position.set(m.position.x, TOP + 11.5, m.position.z)
      g.add(m, r)
    }
    for (const id of ["GATE-E", "GATE-W"]) {
      const lm = this.layout.landmarks.find((l) => l.id === id)
      const c = new THREE.Mesh(new THREE.BoxGeometry(70, 1.4, 34), roof)
      c.position.set(lm.u, TOP + 7, -lm.v)
      c.name = id
      c.castShadow = true
      g.add(c)
      for (let k = -3; k <= 3; k++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(1, 7, 1), wall)
        p.position.set(lm.u + k * 10, TOP + 3.5, -lm.v)
        g.add(p)
      }
    }
    this.tall.add(g)
  }

  buildMasts() {
    if (!this.pool) return
    const geo = mastGeometry(this.theme)
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.7
    })
    const ms = this.pool.masts.filter((m) => m[2] > 0.5)
    const inst = new THREE.InstancedMesh(geo, mat, ms.length)
    // 灯头：夜景主题钠灯暖色；全息主题冷白蓝（定稿堆场灯杆是蓝白光，暖色灯头在总览里像散落的橙色噪点）
    const head = new THREE.InstancedMesh(
      new THREE.BoxGeometry(3.6, 0.6, 3.6),
      new THREE.MeshBasicMaterial({
        color: this.theme.holo
          ? new THREE.Color("#9fdcff").multiplyScalar(2.2)
          : new THREE.Color(this.theme.ground.pool.sodium).multiplyScalar(3.2)
      }),
      ms.length
    )
    const m = new THREE.Matrix4()
    ms.forEach(([u, v], i) => {
      m.makeTranslation(u, TOP, -v)
      inst.setMatrixAt(i, m)
      m.makeTranslation(u, TOP + 34.6, -v)
      head.setMatrixAt(i, m)
    })
    // 码头前沿的暖色低位灯（灯头发光参与辉光，光池在 PoolLight 里画）
    const fr = this.pool.front
    const front = new THREE.InstancedMesh(
      new THREE.BoxGeometry(2.4, 1.6, 2.4),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(this.theme.ground.pool.sodium).multiplyScalar(
          3.6
        )
      }),
      fr.length
    )
    fr.forEach(([u, v], i) => {
      m.makeTranslation(u, TOP + 1.6, -v)
      front.setMatrixAt(i, m)
    })
    this.tall.add(inst, head, front)
  }

  /* ---------------- 箱区 ---------------- */

  /** 箱区：每个"贝（40 尺）× 列"一个箱堆实例，高度按堆存率在 setState 里改；冷藏箱区单独一组（浅色调色板） */
  buildYard() {
    const t = this.theme
    const B = this.layout.bands
    const normal = []
    const reefer = []
    for (const b of this.layout.blocks) {
      const bays = Math.floor((b.v1 - B.yard[0] - 4) / 12.8)
      const list = b.reefer ? reefer : normal
      // 箱组：沿箱区长度方向每 3–5 个贝一组，组内高度接近，组尾那个贝放得很低（远看是一块块箱堆，不是逐箱噪点）
      let group = 0
      let left = 3 + Math.floor(hash01(`${b.id}:g0`) * 3)
      for (let k = 0; k < bays; k++) {
        const gap = left === 1 && k < bays - 1
        for (let r = 0; r < 10; r++)
          list.push({
            b,
            r,
            gap,
            gseed: hash01(`${b.id}:grp${group}`),
            u: b.u - 13.05 + r * 2.9,
            v: B.yard[0] + 2 + 6.4 + k * 12.8,
            seed: hash01(`${b.id}:${k}:${r}`)
          })
        if (--left === 0) {
          group++
          left = 3 + Math.floor(hash01(`${b.id}:g${group}`) * 3)
        }
      }
    }
    // 危险品箱区：零星几排，间距大
    const dg = this.layout.special[0]
    for (let k = 0; k < 12; k++)
      for (let r = 0; r < 6; r++)
        if (hash01(`dg${k}${r}`) < 0.55)
          normal.push({
            b: null,
            u: dg.u0 + 12 + r * 18,
            v: dg.v0 + 14 + k * 18,
            seed: hash01(`dgs${k}${r}`),
            dg: true
          })
    const makeSet = (slots, mat) => {
      const geo = stackGeometry()
      const n = slots.length
      const mesh = new THREE.InstancedMesh(geo, mat, n)
      mesh.castShadow = true
      mesh.receiveShadow = true
      geo.setAttribute(
        "aTiers",
        new THREE.InstancedBufferAttribute(new Float32Array(n), 1)
      )
      geo.setAttribute(
        "aSeed",
        new THREE.InstancedBufferAttribute(
          new Float32Array(slots.map((x) => x.seed * 1000)),
          1
        )
      )
      geo.setAttribute(
        "aHi",
        new THREE.InstancedBufferAttribute(new Float32Array(n), 1)
      )
      // 所在箱区的堆存率（热度图层用）
      geo.setAttribute(
        "aFill",
        new THREE.InstancedBufferAttribute(new Float32Array(n), 1)
      )
      this.addPoolLight(mat)
      this.tall.add(mesh)
      return { mesh, slots }
    }
    this.yardSets = [makeSet(normal, stackMaterial(t))]
    if (reefer.length)
      this.yardSets.push(
        makeSet(
          reefer,
          stackMaterial(t, {
            palette: [t.reefer, t.reefer, t.reefer, t.containers[0]]
          })
        )
      )
    this.setYardFill({})
  }

  /** 按每个箱区的堆存率重算箱堆高度（层数 0–6，均值 ≈ 6 × 堆存率） */
  setYardFill(fillById) {
    const m = new THREE.Matrix4()
    for (const { mesh, slots } of this.yardSets) {
      const tiers = mesh.geometry.attributes.aTiers
      const fills = mesh.geometry.attributes.aFill
      slots.forEach((s, i) => {
        let tr
        if (s.dg) tr = 1 + Math.floor(s.seed * 2)
        else {
          const f = fillById[s.b.id] ?? 0.68
          fills.setX(i, f)
          // 组高：最高 6 层（轨道吊起升 19.75 m，堆 6 过 7），均值按堆存率（× 1.15 补回组尾低贝），组间上下浮动
          const hg = Math.max(
            0,
            Math.min(6, Math.round(f * 6 * 1.15 + (s.gseed - 0.5) * 2.4))
          )
          if (s.gap) tr = s.seed < 0.55 ? 0 : Math.min(1, hg)
          else {
            // 组内：少数箱位低一层，两侧边列更容易低一层（台阶状轮廓）
            const edge = s.r === 0 || s.r === 9
            tr = hg - (s.seed < (edge ? 0.45 : 0.15) ? 1 : 0)
          }
          tr = Math.max(0, Math.min(6, tr))
        }
        tiers.setX(i, tr)
        // 箱长沿 v（箱区长度方向）、箱宽沿 u
        m.makeScale(BOX40.wid, Math.max(0.001, tr * TIER_H), BOX40.len)
        m.setPosition(s.u, TOP, -s.v)
        mesh.setMatrixAt(i, m)
      })
      tiers.needsUpdate = true
      fills.needsUpdate = true
      mesh.instanceMatrix.needsUpdate = true
    }
  }

  /** 箱区热度图层：箱堆按所在箱区的堆存率着色 */
  setYardHeat(on) {
    for (const { mesh } of this.yardSets)
      mesh.material.userData.heat.value = on ? 1 : 0
  }

  /** 岸桥图层：岸桥整机（含描边）显隐 */
  setCranesVisible(on) {
    for (const g of this.cranes.values()) g.visible = on
  }

  /* ---------------- 轨道吊 ---------------- */

  buildArmg() {
    const t = this.theme
    const ids = []
    for (const b of this.layout.blocks)
      for (const s of b.rmg) ids.push({ id: `${b.id}-${s}`, b, side: s })
    this.armgIds = ids
    this.armgIndex = new Map(ids.map((x, i) => [x.id, i]))
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.6,
      metalness: 0.2
    })
    this.addPoolLight(mat)
    this.armg = new THREE.InstancedMesh(armgFrame(t), mat, ids.length)
    this.armgTrolley = new THREE.InstancedMesh(armgTrolley(t), mat, ids.length)
    this.armgSpreader = new THREE.InstancedMesh(
      spreader({ crane: { dark: t.rmg.dark, machine: t.rmg.trolley } }),
      mat,
      ids.length
    )
    for (const m of [this.armg, this.armgTrolley, this.armgSpreader]) {
      m.castShadow = true
      this.tall.add(m)
    }
    if (t.holo) {
      this.armgEdges = new InstancedEdges(armgFrame(t), ids.length)
      this.armgTrolleyEdges = new InstancedEdges(armgTrolley(t), ids.length)
      this.tall.add(this.armgEdges.lines, this.armgTrolleyEdges.lines)
    }
  }

  /* ---------------- 岸桥 ---------------- */

  buildCranes() {
    const t = this.theme
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.55,
      metalness: 0.25
    })
    // 全息：杆件半透明 + 淡蓝自发光
    const face = t.holo?.craneFace
    if (face) {
      mat.transparent = true
      mat.opacity = face.opacity
      mat.emissive = new THREE.Color(face.emissive)
      mat.emissiveIntensity = face.intensity
    }
    this.addPoolLight(mat, 0.8)
    const frame = stsFrame(t)
    const boom = stsBoom(t)
    const trolley = stsTrolley(t)
    const spr = spreader(t)
    const gt = stsGantryTrolley(t)
    const rope = new THREE.MeshBasicMaterial({ color: t.crane.cable })
    this.cranes = new Map()
    for (const c of this.layout.cranes) {
      const g = new THREE.Group()
      g.name = c.id
      const f = new THREE.Mesh(frame, mat)
      const bm = new THREE.Mesh(boom, mat)
      bm.name = "boom"
      bm.position.set(0, STS.girderY + 2, STS.seaZ)
      const tr = new THREE.Mesh(trolley, mat)
      tr.name = "trolley"
      const sp = new THREE.Mesh(spr, mat)
      sp.name = "spreader"
      const ropes = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1, 0.15), rope)
      ropes.name = "ropes"
      const gtr = new THREE.Mesh(gt, mat)
      gtr.name = "gantryTrolley"
      const gsp = new THREE.Mesh(spr, mat)
      gsp.name = "gantrySpreader"
      // 状态灯：机房顶上一块（作业 / 故障 / 检修颜色），夜景发光
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(3, 1.2, 3),
        new THREE.MeshBasicMaterial({ color: t.status.idle })
      )
      lamp.name = "lamp"
      lamp.position.set(0, STS.girderY + 13, STS.backZ + 7)
      g.add(f, bm, tr, sp, ropes, gtr, gsp, lamp)
      // 夜景：主梁下的 LED 灯带（发光，参与辉光）与前大梁端部的航空障碍灯
      if (t.lights) {
        const led = new THREE.MeshBasicMaterial({
          color: new THREE.Color(t.ground.pool.led).multiplyScalar(2.4)
        })
        for (const gx of [-3.4, 3.4]) {
          const strip = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 0.25, STS.boomTipZ - STS.backZ - 6),
            led
          )
          strip.position.set(
            gx,
            STS.girderY - 0.2,
            (STS.boomTipZ + STS.backZ) / 2
          )
          g.add(strip)
        }
        const red = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshBasicMaterial({
            color: new THREE.Color("#ff3b30").multiplyScalar(3)
          })
        )
        red.position.set(0, STS.apexY + 2, -9)
        g.add(red)
      }
      g.traverse((o) => {
        if (o.isMesh && o !== lamp && o !== ropes) {
          o.castShadow = true
          o.receiveShadow = true
        }
      })
      // 全息：门框、前大梁、小车、吊具描边（每台一份材质，故障时变红）
      if (t.holo) {
        // 描边几何每类只算一次（EdgesGeometry 对上万三角形的门框很慢），28 台共用；
        // 门框用精简结构描边（细小构件只留实体不描边）
        this.craneEdges =
          this.craneEdges ||
          new Map(
            [frame, boom, trolley, spr, gt].map((geo) => [
              geo,
              new THREE.EdgesGeometry(
                geo === frame ? stsFrame(t, { lite: true }) : geo,
                20
              )
            ])
          )
        const edgeMat = new THREE.LineBasicMaterial({
          color: glowColor(
            t.holo.craneEdge || t.holo.edge,
            t.holo.craneGain ?? t.holo.edgeGain
          ),
          fog: true
        })
        const add = (geo, parent) => {
          const l = new THREE.LineSegments(this.craneEdges.get(geo), edgeMat)
          l.raycast = () => {}
          parent.add(l)
        }
        add(frame, g)
        add(boom, bm)
        add(trolley, tr)
        add(spr, sp)
        add(gt, gtr)
        add(spr, gsp)
        g.userData.edgeMat = edgeMat
      }
      g.position.set(
        c.home,
        TOP,
        -(this.layout.qcRail.sea + this.layout.qcRail.land) / 2
      )
      this.cranes.set(c.id, g)
      this.tall.add(g)
    }
  }

  /** 摆一台岸桥：大车位置、前大梁、主小车 / 吊具、门架小车（phase 0–1 是作业循环的相位） */
  poseCrane(g, { u, state, phase = 0, shipBeam = 50, deckY = 20 }) {
    g.position.x = u
    const boom = g.getObjectByName("boom")
    // 检修：前大梁仰起 80°
    boom.rotation.x = state === "maint" ? -rad(80) : 0
    const tr = g.getObjectByName("trolley")
    const sp = g.getObjectByName("spreader")
    const ropes = g.getObjectByName("ropes")
    const gtr = g.getObjectByName("gantryTrolley")
    const gsp = g.getObjectByName("gantrySpreader")
    const working = state === "work"
    // 主小车：作业时在船上方与中转平台之间往返；空闲停在陆侧门框上方
    const zShip =
      STS.seaZ +
      FENDER +
      6 +
      (shipBeam - 10) * (0.2 + 0.6 * hash01(g.name + Math.floor(phase * 7)))
    const zPlat = -8
    const p = working ? phase : 0.5
    const seg = p < 0.5 ? smooth(p * 2) : smooth((1 - p) * 2)
    const tz = working ? lerp(zPlat, zShip, seg) : -2
    tr.position.set(0, STS.girderY + 4, tz)
    // 吊具：在船上方时下到甲板箱顶，途中提到 40 m
    const down =
      working && seg > 0.85
        ? deckY + 2
        : working && seg < 0.1
          ? STS.platformY + 2
          : 40
    sp.position.set(0, down, tz)
    const top = STS.girderY + 4
    ropes.scale.set(1, top - down, 1)
    ropes.position.set(0, (top + down) / 2, tz)
    // 门架小车：中转平台 ⇄ 后伸距的 AGV
    const q = working ? (phase + 0.37) % 1 : 0.2
    const gz = lerp(-6, STS.backAgvZ, smooth(q < 0.5 ? q * 2 : (1 - q) * 2))
    gtr.position.set(0, STS.lowerY + 0.8, gz)
    gsp.position.set(
      0,
      working ? lerp(STS.platformY + 2, 4, Math.sin(q * Math.PI)) : 18,
      gz
    )
    if (g.userData.edgeMat) {
      const H = this.theme.holo
      // 故障 / 检修描边变色；待机的岸桥描边暗一些，作业中的最亮
      // 故障岸桥本体保持原色（定稿：只靠光柱、圆环和顶上的红灯标出来）；检修变黄
      const hex =
        state === "maint" ? this.theme.status.maint : H.craneEdge || H.edge
      const gain = H.craneGain ?? H.edgeGain
      g.userData.edgeMat.color.copy(
        glowColor(hex, state === "idle" ? gain * 0.55 : gain)
      )
    }
    const lamp = g.getObjectByName("lamp")
    const col = this.theme.status[state] || this.theme.status.idle
    lamp.material.color.set(col)
    if (this.theme.lights)
      lamp.material.color.multiplyScalar(state === "fault" ? 4 : 2.2)
    // 故障：顶上的状态灯放大成一个醒目的红点（定稿里故障岸桥只有顶点发红）
    lamp.scale.setScalar(state === "fault" ? 3 : 1)
  }

  /* ---------------- AGV ---------------- */

  buildAgvs() {
    const t = this.theme
    const n = this.layout.agvs
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.6
    })
    this.addPoolLight(mat)
    this.agv = new THREE.InstancedMesh(agvBody(t), mat, n)
    this.agv.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(n * 3).fill(1),
      3
    )
    // AGV 上的箱子（重载时显示）
    const geo = stackGeometry()
    const bmat = stackMaterial(t)
    this.addPoolLight(bmat)
    this.agvBox = new THREE.InstancedMesh(geo, bmat, n)
    geo.setAttribute(
      "aTiers",
      new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1)
    )
    geo.setAttribute(
      "aSeed",
      new THREE.InstancedBufferAttribute(
        new Float32Array(n).map((_, i) => hash01("agvbox" + i) * 1000),
        1
      )
    )
    geo.setAttribute(
      "aHi",
      new THREE.InstancedBufferAttribute(new Float32Array(n), 1)
    )
    this.agv.castShadow = true
    this.agvBox.castShadow = true
    this.agvIndex = new Map(
      Array.from({ length: n }, (_, i) => [
        `AGV${String(i + 1).padStart(3, "0")}`,
        i
      ])
    )
    this.tall.add(this.agv, this.agvBox)
    if (t.holo) {
      this.agvEdges = new InstancedEdges(agvBody(t), n)
      this.tall.add(this.agvEdges.lines)
    }
  }

  /* ---------------- 船舶 ---------------- */

  /** 某个航次的船（按需创建）：船体 + 甲板箱实例 */
  shipFor(v) {
    if (this.ships.has(v.id)) return this.ships.get(v.id)
    const t = this.theme
    const def = { loa: v.loa, beam: v.beam }
    this.hullCache = this.hullCache || new Map()
    if (!this.hullCache.has(v.cls)) this.hullCache.set(v.cls, shipHull(t, def))
    const hull = this.hullCache.get(v.cls)
    const g = new THREE.Group()
    g.name = v.id
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.7
    })
    // 全息：船壳带一点深海军蓝自发光（海侧船舷几乎不受光，不加的话总览里是一片纯黑）
    if (t.holo) {
      mat.emissive = new THREE.Color("#0b2140")
      mat.emissiveIntensity = 1
    }
    this.addPoolLight(mat, 0.6)
    const hm = new THREE.Mesh(hull, mat)
    hm.castShadow = true
    hm.receiveShadow = true
    g.add(hm)
    if (t.holo) {
      this.hullEdgeCache = this.hullEdgeCache || new Map()
      if (!this.hullEdgeCache.has(v.cls))
        this.hullEdgeCache.set(v.cls, new THREE.EdgesGeometry(hull, 35))
      g.add(
        new THREE.LineSegments(
          this.hullEdgeCache.get(v.cls),
          new THREE.LineBasicMaterial({
            color: glowColor(t.holo.edge, t.holo.edgeGain * 0.6),
            fog: true
          })
        )
      )
      // 驾驶台窗带：金色灯光
      const h1 = hull.userData.house[1]
      const win = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 1.4, v.beam * 0.86),
        new THREE.MeshBasicMaterial({ color: glowColor(t.holo.gold, 2.2) })
      )
      win.position.set(h1 + 0.2, hull.userData.F + (v.loa >= 360 ? 31 : 21), 0)
      g.add(win)
      // 上层建筑的窗格灯光：比船楼略大一圈的盒子，贴窗格图、加色混合。
      // 贴图底色是冷白（让船楼在暗夜里也是浅色的），窗是暖金色（参与辉光）
      const { hx, hh, hw, F: hF } = hull.userData
      const wl = new THREE.Mesh(
        new THREE.BoxGeometry(16.4, hh - 2, hw + 0.4),
        new THREE.MeshBasicMaterial({
          map: this.windowTexture(),
          color: new THREE.Color(1.6, 1.6, 1.6),
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          fog: true
        })
      )
      wl.position.set(hx, hF + hh / 2 + 1, 0)
      wl.raycast = () => {}
      g.add(wl)
    }
    // 甲板箱：贝（40 尺，13.4 m）× 列（2.5 m），避开上建和烟囱
    const F = hull.userData.F
    const rows = Math.floor((v.beam - 3) / 2.52)
    const bays = []
    for (let x = v.loa / 2 - 26; x > -v.loa / 2 + 14; x -= 13.4) {
      const [h0, h1] = hull.userData.house
      const [f0, f1] = hull.userData.funnel
      if ((x > h0 - 7 && x < h1 + 7) || (x > f0 - 7 && x < f1 + 7)) continue
      bays.push(x)
    }
    const n = bays.length * rows
    const geo = stackGeometry()
    // 全息：甲板箱用更亮的蓝和更亮的棱线（概念图里船上的箱子是发亮的半透明蓝）
    this.deckMat =
      this.deckMat ||
      (t.holo
        ? stackMaterial(t, {
            palette: t.holo.deck,
            edgeGain: t.holo.edgeGain * t.holo.deckEdge,
            fill: 1.1
          })
        : stackMaterial(t))
    const smat = this.deckMat
    if (!smat.userData.pooled) {
      this.addPoolLight(smat)
      smat.userData.pooled = true
    }
    const inst = new THREE.InstancedMesh(geo, smat, n)
    geo.setAttribute(
      "aTiers",
      new THREE.InstancedBufferAttribute(new Float32Array(n), 1)
    )
    geo.setAttribute(
      "aSeed",
      new THREE.InstancedBufferAttribute(
        new Float32Array(n).map((_, i) => hash01(v.id + i) * 1000),
        1
      )
    )
    geo.setAttribute(
      "aHi",
      new THREE.InstancedBufferAttribute(new Float32Array(n), 1)
    )
    inst.castShadow = true
    inst.receiveShadow = true
    g.add(inst)
    const rec = { g, inst, bays, rows, F, cls: v.cls }
    this.ships.set(v.id, rec)
    this.dynamic.add(g)
    return rec
  }

  /** 船楼窗格贴图（所有船共用）：冷白底色 + 12 层暖金色窗带，每层一排小窗，约七成亮着 */
  windowTexture() {
    if (this.winTex) return this.winTex
    const c = document.createElement("canvas")
    c.width = c.height = 128
    const x = c.getContext("2d")
    x.fillStyle = "#a3b5cf"
    x.fillRect(0, 0, 128, 128)
    for (let r = 0; r < 12; r++)
      for (let k = 0; k < 10; k++) {
        const on = hash01(`win${r}:${k}`)
        if (on < 0.55) continue
        const a = 0.6 + 0.4 * on
        x.fillStyle = `rgba(255,217,138,${a})`
        x.fillRect(4 + k * 12.2, 4 + r * 10.4, 7, 4)
      }
    this.winTex = new THREE.CanvasTexture(c)
    this.winTex.colorSpace = THREE.SRGBColorSpace
    this.winTex.anisotropy = 4
    return this.winTex
  }

  /** 摆一条船：位置 / 朝向按阶段插值；甲板箱层数按各作业路的进度（先卸后装） */
  poseShip(v, ms, track) {
    const rec = this.shipFor(v)
    const { g, inst, bays, rows, F } = rec
    const berth = {
      u: (v.u0 + v.u1) / 2,
      v: -(v.beam / 2 + FENDER),
      h: v.bowEast ? 0 : Math.PI
    }
    const k = hash01(v.id)
    const anchor = {
      u: lerp(ANCHOR.u[0], ANCHOR.u[1], k),
      v: lerp(ANCHOR.v[0], ANCHOR.v[1], hash01(v.id + "v")),
      h: (v.bowEast ? 0 : Math.PI) + (k - 0.5) * 0.6
    }
    let p = berth
    const SAIL = 0.5 * 3600000
    if (v.stage === "anchor" || v.stage === "planned") p = anchor
    else if (v.stage === "berthing") {
      const f = smooth(Math.min(1, Math.max(0, 1 - (v.tb - ms) / SAIL)))
      p = {
        u: lerp(anchor.u, berth.u, f),
        v: lerp(anchor.v, berth.v, f),
        h: lerp(anchor.h, berth.h, f)
      }
    } else if (v.stage === "departing") {
      const f = smooth(Math.min(1, Math.max(0, (ms - v.depart) / SAIL)))
      const away = {
        u: berth.u + (v.bowEast ? 1 : -1) * 900,
        v: -1300,
        h: berth.h
      }
      p = {
        u: lerp(berth.u, away.u, f),
        v: lerp(berth.v, away.v, f),
        h: berth.h
      }
    }
    g.position.set(p.u, 0, -p.v)
    g.rotation.y = p.h
    g.visible = true
    // 甲板箱：每个贝归最近的作业路；卸船阶段从满载降到 30%，装船阶段升到 85–100%
    const T0 = DECK_TIERS[v.cls]
    const tiers = inst.geometry.attributes.aTiers
    const hi = inst.geometry.attributes.aHi
    const m = new THREE.Matrix4()
    const disFrac = v.dis / v.moves
    bays.forEach((x, bi) => {
      // 船体局部 x → u（船首朝东时同向）
      const uAt = p.u + (v.bowEast ? x : -x)
      let line = v.lines[0]
      for (const ln of v.lines)
        if (Math.abs(ln.u - uAt) < Math.abs(line.u - uAt)) line = ln
      const pr =
        v.stage === "anchor" || v.stage === "berthing" || v.stage === "planned"
          ? 0
          : line.total
            ? line.done / line.total
            : 1
      const full = T0 * (0.85 + 0.15 * hash01(v.id + bi))
      let h
      const low = T0 * DECK_MIN
      if (pr < disFrac) h = lerp(full, low, pr / Math.max(disFrac, 1e-3))
      else h = lerp(low, full, (pr - disFrac) / Math.max(1 - disFrac, 1e-3))
      for (let r = 0; r < rows; r++) {
        const i = bi * rows + r
        // 舷侧几列略低，形成拱形轮廓
        const edge = Math.min(r, rows - 1 - r)
        const tr = Math.max(
          0,
          Math.round(
            h - (edge < 2 ? 2 - edge : 0) + (hash01(v.id + i) - 0.5) * 1.2
          )
        )
        tiers.setX(i, tr)
        hi.setX(i, track === v.id && line.working ? 1 : 0)
        m.makeScale(BOX40.len, Math.max(0.001, tr * TIER_H), BOX40.wid)
        m.setPosition(x, F, (r - (rows - 1) / 2) * 2.52)
        inst.setMatrixAt(i, m)
      }
    })
    tiers.needsUpdate = true
    hi.needsUpdate = true
    inst.instanceMatrix.needsUpdate = true
    return { deckY: F + T0 * TIER_H * 0.6 }
  }

  /* ---------------- 告警特效 ---------------- */

  buildFx() {
    const col = new THREE.Color(this.theme.status.fault)
    const glow = this.theme.lights ? 2.4 : 1
    // 四道向外扩散的细圆环（定稿：故障岸桥脚下 3–4 圈红色波纹），亮度超过辉光阈值
    const rings = [0, 1, 2, 3].map(() => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1, 96),
        new THREE.MeshBasicMaterial({
          color: col.clone().multiplyScalar(glow),
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          // 不做深度测试：岸桥脚下常被船和甲板箱挡住，圆环像 HUD 一样画在最上层
          depthTest: false,
          side: THREE.DoubleSide,
          fog: false
        })
      )
      ring.rotation.x = -Math.PI / 2
      ring.renderOrder = 10
      return ring
    })
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: col.clone().multiplyScalar(0.9) } },
        // 地面红色光晕：中心亮、向外衰减
        vertexShader:
          "varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader:
          "uniform vec3 uColor; varying vec2 vP; void main(){ float r = length(vP); gl_FragColor = vec4(uColor * pow(1.0 - r, 2.0), 1.0); }"
      })
    )
    disc.rotation.x = -Math.PI / 2
    // 光柱：亮芯 + 外层光晕，顶端渐隐；底部最亮
    const beamMat = (r, a) =>
      new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, 1, 16, 1, true),
        new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          uniforms: { uColor: { value: col.clone().multiplyScalar(glow) } },
          vertexShader:
            "varying float vH; void main(){ vH = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
          fragmentShader: `uniform vec3 uColor; varying float vH; void main(){ gl_FragColor = vec4(uColor * pow(1.0 - vH, 1.2) * ${a.toFixed(2)}, 1.0); }`
        })
      )
    // 定稿的光柱很细（芯 3–4 px），外层光晕只是一点余辉
    const beam = beamMat(1.8, 1)
    const halo = beamMat(4, 0.18)
    this.alarmFx = new THREE.Group()
    this.alarmFx.add(...rings, disc, beam, halo)
    this.alarmFx.visible = false
    this.alarmFx.userData = { rings, disc, beam, halo }
    this.tall.add(this.alarmFx)
  }

  /** 主告警：地面光晕 + 扩散圆环 + 光柱（只给一条） */
  setAlarm(alarm) {
    const fx = this.alarmFx
    if (!alarm) {
      fx.visible = false
      return
    }
    const { u, v, r = 40, h = 140 } = alarm
    // 新出现的告警（之前没有、或换了位置）：光柱从地面升起
    if (!fx.visible || fx.userData.u !== u || fx.userData.v !== v)
      fx.userData.rise0 = performance.now()
    fx.visible = true
    Object.assign(fx.userData, { r, h, u, v })
    const { rings, disc } = fx.userData
    rings.forEach((ring) => ring.position.set(u, TOP + 0.6, -v))
    this.pulseAlarm(0)
    disc.scale.setScalar(r * 1.3)
    disc.position.set(u, TOP + 0.5, -v)
    this.sizeAlarmBeam()
  }

  /**
   * 光柱高度、粗细跟着镜头距离走：总览（约 6.5 km）里是给定的高度 h，拉近时按距离缩短、变细，
   * 免得近景里一条几百米高的粗红柱横穿画面
   */
  sizeAlarmBeam(d = 6550) {
    const fx = this.alarmFx
    if (!fx?.visible || fx.userData.h === undefined) return
    const { u, v, h, beam, halo } = fx.userData
    const k = Math.min(1, d / 6550)
    // 升起：告警出现后 0.8 秒从地面冲到全高（先快后慢）
    const rise = Math.min(
      1,
      (performance.now() - (fx.userData.rise0 ?? -1e9)) / 800
    )
    // 近景里最低 150 m（夸张后约 230 m，约两台岸桥高），光柱始终冲出岸桥顶
    const hh = Math.max(150, h * k) * Math.max(0.001, 1 - Math.pow(1 - rise, 3))
    const w = Math.max(0.35, k)
    for (const b of [beam, halo]) {
      b.scale.set(w, hh, w)
      b.position.set(u, TOP + hh / 2, -v)
    }
  }

  /** 告警圆环扩散：每 2.4 秒一圈，四圈错开相位，越往外越淡 */
  pulseAlarm(sec) {
    const fx = this.alarmFx
    const r = fx.userData.r || 34
    const rings = fx.userData.rings
    rings.forEach((ring, i) => {
      const ph = (sec / 2.4 + i / rings.length) % 1
      ring.scale.setScalar(r * (0.3 + 1.3 * ph))
      ring.material.opacity = 0.95 * (1 - ph) ** 1.3
    })
  }

  /* ---------------- 状态 ---------------- */

  /** 摆 AGV：poses 为 sim.agvPoses() 的结果（实时模式下是平滑后的位置） */
  setAgvs(poses, state) {
    const t = this.theme
    const m = new THREE.Matrix4()
    {
      const q = new THREE.Quaternion()
      const s = new THREE.Vector3(1, 1, 1)
      const p = new THREE.Vector3()
      const up = new THREE.Vector3(0, 1, 0)
      const cBody = new THREE.Color()
      const byId = new Map(state.agvs.map((a) => [a.id, a]))
      for (const ps of poses) {
        const i = this.agvIndex.get(ps.id)
        if (i === undefined) throw new Error(`场景里找不到 ${ps.id}`)
        const a = byId.get(ps.id)
        q.setFromAxisAngle(up, ps.h)
        p.set(ps.u, TOP, -ps.v)
        m.compose(p, q, s)
        this.agv.setMatrixAt(i, m)
        const st = a.signalLost
          ? "stale"
          : ps.state === "fault"
            ? "fault"
            : ps.state === "swap"
              ? "swap"
              : null
        cBody.set(st ? t.status[st] : "#ffffff")
        this.agv.setColorAt(i, cBody)
        if (ps.state === "laden") {
          m.compose(
            p.set(ps.u, TOP + 1.9, -ps.v),
            q,
            new THREE.Vector3(BOX40.len, TIER_H, BOX40.wid)
          )
        } else m.makeScale(0, 0, 0)
        this.agvBox.setMatrixAt(i, m)
        if (this.agvEdges) {
          const H = t.holo
          const hex =
            st === "fault"
              ? H.fault
              : st === "stale"
                ? t.status.stale
                : st === "swap"
                  ? t.status.swap
                  : ps.state === "laden"
                    ? H.gold
                    : H.edge
          this.agvEdges.setAt(
            i,
            ps.u,
            TOP,
            -ps.v,
            ps.h,
            glowColor(hex, st === "stale" ? 1 : H.edgeGain * 0.9)
          )
        }
      }
      this.agvEdges?.commit()
      this.agv.instanceMatrix.needsUpdate = true
      this.agv.instanceColor.needsUpdate = true
      this.agvBox.instanceMatrix.needsUpdate = true
    }
  }

  /** 岸桥作业循环的相位（0–1）：约 110 秒一个循环，每台错开 */
  cranePhase(id, ms) {
    return (((ms / 1000 / 110 + hash01(id)) % 1) + 1) % 1
  }

  /**
   * 仿真状态 → 场景
   * opts.poses：sim.agvPoses(ms) 的结果；opts.track：被跟踪的航次；opts.alarm：{ u, v, r, h } 主告警位置
   */
  setState(state, opts = {}) {
    const ms = state.t
    this.lastPoses = opts.poses || this.lastPoses
    // 箱区
    this.setYardFill(
      Object.fromEntries(state.blocks.map((b) => [b.id, b.fill]))
    )
    // 船舶
    const seen = new Set()
    const deckOf = new Map()
    for (const v of state.vessels) {
      if (v.stage === "planned" || v.stage === "gone") continue
      seen.add(v.id)
      deckOf.set(v.id, { ...this.poseShip(v, ms, opts.track), beam: v.beam })
    }
    for (const [id, rec] of this.ships) rec.g.visible = seen.has(id)
    // 岸桥：记下目标位置与作业参数；实时模式下由 frame() 逐帧平滑移过去，静态（设计稿）时直接摆好
    this.craneInfo = this.craneInfo || new Map()
    for (const c of state.cranes) {
      const g = this.cranes.get(c.id)
      if (!g) throw new Error(`场景里找不到岸桥 ${c.id}`)
      const d = c.vessel ? deckOf.get(c.vessel) : null
      // deckY 换成岸桥局部高度：船按水线拉高（世界高 vk × 甲板高），岸桥按码头面拉高（世界高 TOP + vk × 局部高）
      const info = {
        u: c.u,
        state: c.state,
        shipBeam: d?.beam ?? 50,
        deckY: d ? d.deckY - TOP / this.vk : 20
      }
      const prev = this.craneInfo.get(c.id)
      info.disp = prev ? prev.disp : c.u
      this.craneInfo.set(c.id, info)
      if (!this.live) {
        info.disp = c.u
        this.poseCrane(g, { ...info, u: c.u, phase: this.cranePhase(c.id, ms) })
      }
    }
    this.state = state
    // 轨道吊
    const m = new THREE.Matrix4()
    const B = this.layout.bands
    for (const b of state.blocks) {
      const lb = this.layout.blocks.find((x) => x.id === b.id)
      for (const r of b.rmg) {
        const i = this.armgIndex.get(r.id)
        if (i === undefined) throw new Error(`场景里找不到轨道吊 ${r.id}`)
        const len = lb.v1 - B.yard[0]
        const w = hash01(r.id + Math.floor(ms / 600000))
        let v
        if (r.side === "S")
          v =
            r.state === "work"
              ? B.yard[0] + 8 + w * 50
              : B.yard[0] + len * (0.3 + w * 0.15)
        else
          v =
            r.state === "work"
              ? lb.v1 - 6 - w * 40
              : lb.v1 - len * (0.25 + w * 0.15)
        m.makeTranslation(lb.u, TOP, -v)
        this.armg.setMatrixAt(i, m)
        const tx = (w - 0.5) * 24
        m.makeTranslation(lb.u + tx, TOP + ARMG.trolleyY, -v)
        this.armgTrolley.setMatrixAt(i, m)
        m.makeTranslation(
          lb.u + tx,
          TOP + (r.state === "work" ? 6 + w * 10 : 18),
          -v
        )
        this.armgSpreader.setMatrixAt(i, m)
        if (this.armgEdges) {
          // 轨道吊用箱区的蓝、亮度压低（定稿里主角是岸桥和船，轨道吊不能比岸桥抢眼；第 22 轮比对）
          const H = this.theme.holo
          const c =
            r.state === "fault"
              ? glowColor(H.fault, H.edgeGain)
              : glowColor(
                  H.stackEdge || H.edge,
                  H.edgeGain * (r.state === "work" ? 0.6 : 0.36)
                )
          this.armgEdges.setAt(i, lb.u, TOP, -v, 0, c)
          this.armgTrolleyEdges.setAt(
            i,
            lb.u + tx,
            TOP + ARMG.trolleyY,
            -v,
            0,
            c
          )
        }
      }
    }
    this.armg.instanceMatrix.needsUpdate = true
    this.armgTrolley.instanceMatrix.needsUpdate = true
    this.armgSpreader.instanceMatrix.needsUpdate = true
    this.armgEdges?.commit()
    this.armgTrolleyEdges?.commit()
    // AGV
    if (opts.poses) this.setAgvs(opts.poses, state)
    // 作业路光带：岸桥下 → AGV 车道 → 目标箱区海侧（每台在作业的岸桥一条，岸桥或目标箱区变了才重建）
    if (this.ribbons) {
      const list = []
      for (const c of state.cranes) {
        if (c.state !== "work" || !c.target) continue
        const b = this.blockById.get(c.target)
        const dir = Math.sign(b.u - c.u) || 1
        const key = `${c.id}>${c.target}@${Math.round(c.u / 5)}`
        // 控制点：岸桥后伸距下 → 弯进车道 → 沿车道 → 弯进箱区海侧交换区（RibbonLayer 连成平滑曲线）
        // 岸桥和目标箱区离得近（< 70 m）时车道上只放一个中点，免得两个控制点交叉打结
        const near = Math.abs(b.u - c.u) < 70
        const mid = near
          ? [[(c.u + b.u) / 2, 108]]
          : [
              [c.u + dir * 30, 108],
              [b.u - dir * 30, 108]
            ]
        const pts = [[c.u, 52], [c.u, 76], ...mid, [b.u, 132], [b.u, 150]].map(
          ([u, v]) => [u, -v]
        )
        list.push({ key, pts })
      }
      this.ribbons.set(list)
    }
    // 夜景光池跟着岸桥
    if (this.pool)
      this.pool.draw(
        state.cranes.filter((c) => c.state === "work").map((c) => c.u)
      )
    this.setAlarm(opts.alarm || null)
  }

  /* ---------------- 镜头 ---------------- */

  /**
   * target：注视点 [u, v]；dist：距离（米）；yaw：0 = 从海侧正对岸线看，正值往东（+u）转；
   * pitch：俯角（度）；fov：竖直视角；shift：画面中心偏移（像素，[右, 下]）
   */
  setView(view) {
    this.view = { ...this.view, ...view }
    const { target, dist, yaw, pitch, fov, shift } = this.view
    const cam = this.camera
    cam.fov = fov
    const tp = new THREE.Vector3(target[0], TOP, -target[1])
    const y = rad(yaw)
    const pt = rad(pitch)
    // 视线水平方向：yaw = 0 时朝 +v（从海看向陆）→ 相机在 −v 侧（世界 +z）
    const dir = new THREE.Vector3(Math.sin(y), 0, Math.cos(y))
    cam.position.copy(tp).addScaledVector(dir, dist * Math.cos(pt))
    cam.position.y = TOP + dist * Math.sin(pt)
    cam.lookAt(tp)
    const w = this.el.clientWidth || 1920
    const h = this.el.clientHeight || 1080
    if (shift) cam.setViewOffset(w, h, -shift[0], -shift[1], w, h)
    else cam.clearViewOffset()
    cam.updateProjectionMatrix()
    if (this.controls) this.controls.target.copy(tp)
    this.sea.material.uniforms.uCam.value.copy(cam.position)
  }

  /** 世界点 → 屏幕像素（设计尺寸 1920 宽）；在相机背后返回 null。y 是未夸张的真实高度（米），按竖向夸张换算 */
  project(u, v, y = TOP) {
    const wy = TOP + (y - TOP) * this.vk
    const p = new THREE.Vector3(u, wy, -v).project(this.camera)
    if (p.z > 1) return null
    const w = this.el.clientWidth || 1920
    const h = this.el.clientHeight || 1080
    return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h }
  }

  /* ---------------- 实时模式 ---------------- */

  /**
   * 开渲染循环。sim：仿真器（每帧取 AGV 位置）；now()：仿真时钟（毫秒）；
   * onPick({ type, id })：点到岸桥 / 船；onUser()：用户开始拖拽或缩放（页面据此暂停巡游）
   */
  startLive({ sim, now = () => Date.now(), onPick, onUser } = {}) {
    this.live = true
    this.sim = sim
    this.now = now
    const cam = this.camera
    const controls = new OrbitControls(cam, this.renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = THREE.MathUtils.degToRad(82)
    controls.minDistance = 120
    controls.maxDistance = 9000
    controls.target.set(this.view.target[0], TOP, -this.view.target[1])
    controls.addEventListener("start", () => {
      this.tween?.kill()
      onUser?.()
    })
    this.controls = controls
    // 点击拾取：岸桥（Group 名 QCxx）、船（Group 名 = 航次编号）
    const ray = new THREE.Raycaster()
    const down = { x: 0, y: 0 }
    this.onDown = (e) => Object.assign(down, { x: e.clientX, y: e.clientY })
    this.onUp = (e) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return
      const r = this.renderer.domElement.getBoundingClientRect()
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          -((e.clientY - r.top) / r.height) * 2 + 1
        ),
        cam
      )
      const targets = [
        ...this.cranes.values(),
        ...[...this.ships.values()].filter((x) => x.g.visible).map((x) => x.g)
      ]
      const hit = ray
        .intersectObjects(targets, true)
        .find((h) => h.object.isMesh)
      if (!hit) return
      let o = hit.object
      while (o.parent && !this.cranes.has(o.name) && !this.ships.has(o.name))
        o = o.parent
      if (this.cranes.has(o.name)) onPick?.({ type: "crane", id: o.name })
      else if (this.ships.has(o.name)) onPick?.({ type: "vessel", id: o.name })
    }
    this.renderer.domElement.addEventListener("pointerdown", this.onDown)
    this.renderer.domElement.addEventListener("pointerup", this.onUp)
    this.onResize = () => this.resize()
    window.addEventListener("resize", this.onResize)
    // AGV 平滑后的位置、光迹采样计时
    this.agvDisp = new Map()
    this.trailClock = 0
    this.lastFrame = performance.now()
    const loop = () => {
      this.raf = requestAnimationFrame(loop)
      // 切到后台时浏览器会停掉 rAF；回来后按真实流逝时间推进，不补帧
      const t = performance.now()
      const dt = Math.min(0.1, (t - this.lastFrame) / 1000)
      this.lastFrame = t
      this.frame(this.now(), dt)
    }
    loop()
  }

  /** 一帧：岸桥大车平滑移动 + 小车 / 吊具循环、AGV 平滑与光迹、渲染 */
  frame(ms, dt) {
    if (this.state) {
      // 岸桥：大车约 4 m/s 移到目标船位（真实约 0.75 m/s，演示加快）
      for (const [id, info] of this.craneInfo) {
        const step = 4 * dt
        info.disp += Math.max(-step, Math.min(step, info.u - info.disp))
        this.poseCrane(this.cranes.get(id), {
          ...info,
          u: info.disp,
          phase: this.cranePhase(id, ms)
        })
      }
      // AGV：仿真给出的位置可能因换任务而跳变，显示位置以 12 m/s 上限追过去
      const raw = this.sim.agvPoses(ms)
      const out = []
      for (const p of raw) {
        let d = this.agvDisp.get(p.id)
        if (!d) d = { u: p.u, v: p.v, h: p.h }
        const du = p.u - d.u
        const dv = p.v - d.v
        const dist = Math.hypot(du, dv)
        const max = 12 * dt + 0.35 * dist * Math.min(1, dt * 8)
        if (dist <= max || dist > 600) Object.assign(d, { u: p.u, v: p.v })
        else
          Object.assign(d, {
            u: d.u + (du / dist) * max,
            v: d.v + (dv / dist) * max
          })
        // 朝向：取最短转角插值
        let dh = p.h - d.h
        dh = Math.atan2(Math.sin(dh), Math.cos(dh))
        d.h += dh * Math.min(1, dt * 6)
        this.agvDisp.set(p.id, d)
        out.push({ ...p, u: d.u, v: d.v, h: d.h })
      }
      this.setAgvs(out, this.state)
      // 光迹：每 0.25 s 采样一次；故障、换电、定位中断的车不留光迹
      this.trailClock += dt
      if (this.trails && this.trailClock > 0.25) {
        this.trailClock = 0
        const lost = new Set(
          this.state.agvs.filter((a) => a.signalLost).map((a) => a.id)
        )
        out.forEach((p) => {
          const i = this.agvIndex.get(p.id)
          if (
            p.state === "fault" ||
            p.state === "swap" ||
            p.state === "idle" ||
            lost.has(p.id)
          )
            this.trails.clear(i)
          else this.trails.push(i, p.u, -p.v)
        })
        this.trails.update()
      }
      this.lastPoses = out
      // 告警圆环扩散
      if (this.alarmFx.visible) this.pulseAlarm(ms / 1000)
    }
    this.controls?.update()
    this.sea.material.uniforms.uCam.value.copy(this.camera.position)
    this.render(ms / 1000)
  }

  /** 镜头参数 → 相机位置与注视点（与 setView 同一套公式） */
  viewToCam(view) {
    const v = { ...this.view, ...view }
    const tp = new THREE.Vector3(v.target[0], TOP, -v.target[1])
    const y = rad(v.yaw)
    const p = rad(v.pitch)
    const pos = tp
      .clone()
      .addScaledVector(
        new THREE.Vector3(Math.sin(y), 0, Math.cos(y)),
        v.dist * Math.cos(p)
      )
    pos.y = TOP + v.dist * Math.sin(p)
    return { pos, target: tp, fov: v.fov, view: v }
  }

  /** 镜头补间到 view（秒），结束后 onDone */
  flyTo(view, sec = 2.2, onDone) {
    const { pos, target, fov, view: v } = this.viewToCam(view)
    this.view = v
    this.tween?.kill()
    const cam = this.camera
    const ctl = this.controls
    const st = { t: 0 }
    const p0 = cam.position.clone()
    const t0 = ctl ? ctl.target.clone() : target.clone()
    const f0 = cam.fov
    this.tween = gsap.to(st, {
      t: 1,
      duration: sec,
      ease: "power2.inOut",
      onUpdate: () => {
        cam.position.lerpVectors(p0, pos, st.t)
        if (ctl) ctl.target.lerpVectors(t0, target, st.t)
        cam.fov = THREE.MathUtils.lerp(f0, fov, st.t)
        cam.updateProjectionMatrix()
        cam.lookAt(ctl ? ctl.target : target)
      },
      onComplete: () => onDone?.()
    })
  }

  /** 场景标签的屏幕位置（设计尺寸像素，页面再按 rem 换算） */
  anchors() {
    const st = this.state
    if (!st) return null
    const P = (u, v, y) => this.project(u, v, y)
    const ships = st.vessels
      .filter((v) =>
        ["moored", "working", "finishing", "berthing", "departing"].includes(
          v.stage
        )
      )
      .map((v) => {
        const rec = this.ships.get(v.id)
        const p = rec ? P(rec.g.position.x, -rec.g.position.z, 40) : null
        return { id: v.id, p }
      })
    const cranes = st.cranes.map((c) => ({
      id: c.id,
      p: P(this.craneInfo.get(c.id)?.disp ?? c.u, 21, 92)
    }))
    const berths = this.layout.berths.map((b) => ({
      id: b.id,
      p: P((b.u0 + b.u1) / 2, 2, TOP)
    }))
    const agvs = (this.lastPoses || []).map((a) => ({
      id: a.id,
      p: P(a.u, a.v, 10)
    }))
    const blocks = this.layout.blocks.map((b) => ({
      id: b.id,
      p: P(b.u, (b.v0 + b.v1) / 2, 20)
    }))
    return { ships, cranes, berths, agvs, blocks }
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.tween?.kill()
    this.controls?.dispose()
    window.removeEventListener("resize", this.onResize)
    this.renderer.domElement.removeEventListener("pointerdown", this.onDown)
    this.renderer.domElement.removeEventListener("pointerup", this.onUp)
    this.scene.traverse((o) => {
      o.geometry?.dispose?.()
      const ms = Array.isArray(o.material)
        ? o.material
        : o.material
          ? [o.material]
          : []
      ms.forEach((m) => {
        for (const k of Object.keys(m)) if (m[k]?.isTexture) m[k].dispose()
        m.dispose()
      })
    })
    this.composer?.dispose?.()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  render(time = 0) {
    // 雾（rel 主题）和近裁剪面跟着镜头到注视点的距离走：远景深度精度够、近景不被雾吃掉
    const cam = this.camera
    const tp = this.controls
      ? this.controls.target
      : new THREE.Vector3(this.view.target[0], TOP, -this.view.target[1])
    const d = cam.position.distanceTo(tp)
    const f = this.theme.fog
    if (f.rel) {
      this.scene.fog.near = f.near * d
      this.scene.fog.far = f.far * d
    }
    this.sea.material.uniforms.uRef.value = d
    this.sizeAlarmBeam(d)
    const near = Math.max(2, d * 0.03)
    if (Math.abs(cam.near - near) > near * 0.05) {
      cam.near = near
      cam.updateProjectionMatrix()
    }
    this.sea.material.uniforms.uTime.value = time
    this.ribbons?.tick(time)
    this.lanes?.tick(time)
    if (this.composer) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
  }
}

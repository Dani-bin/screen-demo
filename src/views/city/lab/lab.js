/*
 * 单景点预览页（开发用，不进生产构建）
 * ----------------------------------------------------------
 * 打开 /city-lab.html?landmark=kit&yaw=210&pitch=30&dist=160
 *   landmark  kit（构件样例）或景点英文键（Task 3 接入后可用）
 *   yaw       相机方位角（度，相对正北顺时针；相机位于注视点的这个方向上）
 *   pitch     俯仰角（度，0 为平视）
 *   dist      相机到注视点距离（米）
 *   y         注视点高度（米，缺省取景点 / 样例给的推荐值）
 *   focus     仅 kit：对准某件样例（hall | hall2 | twin | lhouse | pagoda | panda | pavilion | house | disc | boat | totem）
 *   shadow    city：阴影范围 / 偏移与相机 near = 20 完全照搬城市场景（景点模式默认，所见即线上效果，
 *             near = 20 时近景距离须 ≥ 300 m，验收截图按此取 dist）；
 *             tight：阴影收紧到注视点周围、相机 near = 1（kit 默认，适合近看构件造型）
 * 地面、道路、河流、光照颜色与强度与城市场景一致（阴影开启）。
 * 只渲染一帧，完成后设 window.__labReady = true（静态截图用，省 CPU）；
 * 出错时同时设 __labError（错误信息）与 __labReady，截图脚本不必干等到超时。
 */
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer
} from "three"
import { THEME } from "../scene/theme.js"
import { createProjection } from "../scene/projection.js"
import { createMaterials } from "../scene/materials.js"
import { createTerrain } from "../scene/terrain.js"
import { createRivers, createRoads } from "../scene/roads.js"
import { createBuildings } from "../scene/buildings.js"
import { polygonCenter } from "../scene/utils.js"
import { SPOTS } from "../data/cityData.js"
import { buildingsInZones } from "../scene/landmarks/kit/footprint.js"
import { buildKit } from "./kitShowcase.js"

const DEG = Math.PI / 180
const GEOMETRY_URL = "/city/chengdu.json"
// 景点英文键 → cityData.js 里的景点名
const SPOT_KEYS = {
  tianfu: "天府广场",
  taikooli: "春熙路·太古里",
  ifs: "成都 IFS",
  kuanzhai: "宽窄巷子",
  peoplesPark: "人民公园",
  wenshu: "文殊院",
  hejiang: "合江亭"
}
// 单景点模式下只画景点周围这么远的通用楼
const CONTEXT_RADIUS = 600

const params = new URLSearchParams(location.search)
const num = (key, fallback) => {
  const v = Number.parseFloat(params.get(key))
  return Number.isFinite(v) ? v : fallback
}

/* ============================================================
 * 景点构建入口（Task 3 接入点）
 * Task 3 把下面这行换成：
 *   import { buildLandmark } from "../scene/landmarks/index.js"
 * 其余代码无需改动。
 * ============================================================ */
const buildLandmark = null

/**
 * 构建预览对象。
 * @returns {{ meshes, zones, target: number[], defaultDist: number,
 *   shadowRadius: number, context: boolean, center?: number[], stats?: object }}
 *   context 为 true 时额外画景点周围、替换区外的通用楼
 */
function buildSubject(name, data, project) {
  if (name === "kit") {
    const kit = buildKit()
    const f = kit.focus[params.get("focus")]
    return {
      ...kit,
      target: f ? f.slice(0, 3) : kit.target,
      defaultDist: f ? f[3] : 160,
      shadowRadius: 110,
      shadowMode: "tight",
      context: false
    }
  }
  const spotName = SPOT_KEYS[name]
  const raw = SPOTS.find((s) => s.name === spotName)
  if (!raw) throw new Error(`未知景点键：${name}`)
  if (!buildLandmark) {
    throw new Error(
      "单景点预览需 Task 3 接入 buildLandmark，当前仅支持 landmark=kit"
    )
  }
  const [x, z] = project.toLocal(raw.lon, raw.lat)
  const spot = { ...raw, x, z }
  // ctx 与生产环境 createLandmarks 传给景点模块的完全一致；kit 工具由景点模块自行导入
  const ctx = { project, buildings: data.buildings, theme: THEME, spot }
  const r = buildLandmark(spotName, ctx)
  const triangles = r.meshes.reduce(
    (sum, m) => sum + m.geometry.attributes.position.count / 3,
    0
  )
  return {
    ...r,
    target: [x, Math.max(10, r.markerHeight * 0.4), z],
    defaultDist: 420,
    shadowRadius: CONTEXT_RADIUS,
    shadowMode: "city",
    context: true,
    center: [x, z],
    stats: { total: triangles, meshes: r.meshes.length }
  }
}

/** 景点周围 CONTEXT_RADIUS 内、且不在替换区里的通用楼 */
function contextBuildings(data, center, zones) {
  const hidden = buildingsInZones(data.buildings, zones)
  return data.buildings.filter((b, i) => {
    if (hidden.has(i) || !b.p || !b.p.length) return false
    const [bx, bz] = polygonCenter(b.p)
    return Math.hypot(bx - center[0], bz - center[1]) <= CONTEXT_RADIUS
  })
}

function createRenderer(canvas) {
  const renderer = new WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, THEME.maxPixelRatio))
  renderer.setSize(window.innerWidth, window.innerHeight, false)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = NeutralToneMapping
  renderer.toneMappingExposure = THEME.exposure
  return renderer
}

/**
 * 光照颜色、强度、方向与 CityScene 相同。阴影两种模式：
 *   city  —— 太阳位置、阴影正交范围、bias / normalBias 全部照搬 CityScene（整城一张阴影贴图）；
 *   tight —— 太阳沿同一方向对准注视点，正交范围收紧到周围 radius 米，近景阴影更实。
 */
function addLights(scene, target, radius, mode) {
  const Lt = THEME.light
  scene.add(new HemisphereLight(Lt.hemiSky, Lt.hemiGround, Lt.hemiIntensity))
  const sun = new DirectionalLight(Lt.sun, Lt.sunIntensity)
  sun.castShadow = true
  sun.shadow.mapSize.set(Lt.shadowMapSize, Lt.shadowMapSize)
  if (mode === "city") {
    // 与 CityScene._initScene 一致：太阳在 sunPosition、target 在原点
    sun.position.set(...Lt.sunPosition)
    Object.assign(sun.shadow.camera, Lt.shadowBox)
    sun.shadow.bias = Lt.shadowBias
    sun.shadow.normalBias = Lt.shadowNormalBias
  } else {
    const dir = new Vector3(...Lt.sunPosition).normalize()
    const t = new Vector3(target[0], 0, target[2])
    sun.position.copy(t).addScaledVector(dir, 2000)
    sun.target.position.copy(t)
    Object.assign(sun.shadow.camera, {
      left: -radius,
      right: radius,
      top: radius,
      bottom: -radius,
      near: 2000 - radius * 1.5,
      far: 2000 + radius * 1.5
    })
    // 深度范围约 3·radius 米：bias × 范围 ≈ 0.1 m；小构件用很小的法线偏移，避免阴影漏光
    sun.shadow.bias = -0.1 / (radius * 3)
    sun.shadow.normalBias = 0.05
  }
  sun.shadow.camera.updateProjectionMatrix()
  scene.add(sun, sun.target)
}

function placeCamera(camera, target) {
  const yaw = num("yaw", 210) * DEG
  const pitch = num("pitch", 30) * DEG
  const dist = num("dist", target.defaultDist)
  const t = new Vector3(target.x, num("y", target.y), target.z)
  // 方位角 → 水平方向：北为 -Z、东为 +X
  const h = Math.cos(pitch) * dist
  camera.position.set(
    t.x + Math.sin(yaw) * h,
    t.y + Math.sin(pitch) * dist,
    t.z - Math.cos(yaw) * h
  )
  camera.lookAt(t)
}

async function main() {
  const canvas = document.getElementById("lab")
  const info = document.getElementById("info")
  const data = await (await fetch(GEOMETRY_URL)).json()
  const project = createProjection(data.meta.origin)
  const name = params.get("landmark") || "kit"
  const subject = buildSubject(name, data, project)
  const shadowParam = params.get("shadow")
  const shadowMode =
    shadowParam === "city" || shadowParam === "tight"
      ? shadowParam
      : subject.shadowMode

  const renderer = createRenderer(canvas)
  const scene = new Scene()
  scene.background = new Color(THEME.background)
  const camera = new PerspectiveCamera(
    THEME.camera.fov,
    window.innerWidth / window.innerHeight,
    // city 模式与线上相同（near = 20，深度精度一致）；tight 模式要贴近看构件，near = 1
    shadowMode === "city" ? THEME.camera.near : 1,
    THEME.camera.far
  )

  const materials = createMaterials(THEME)
  scene.add(createTerrain(data, materials))
  scene.add(createRivers(data.rivers, materials, THEME))
  scene.add(createRoads(data.roads, materials, THEME))
  if (subject.context) {
    const near = contextBuildings(data, subject.center, subject.zones)
    scene.add(createBuildings(near, THEME).mesh)
  }
  for (const m of subject.meshes) {
    m.castShadow = true
    m.receiveShadow = true
    scene.add(m)
  }
  addLights(scene, subject.target, subject.shadowRadius, shadowMode)
  const [tx, ty, tz] = subject.target
  placeCamera(camera, { x: tx, y: ty, z: tz, defaultDist: subject.defaultDist })

  window.__labStats = subject.stats
  info.textContent = `${name}  阴影 ${shadowMode}  三角形 ${subject.stats?.total ?? "-"}`

  // 场景静态：阴影只画一次；只渲染一帧，之后不再循环
  renderer.shadowMap.autoUpdate = false
  renderer.shadowMap.needsUpdate = true
  requestAnimationFrame(() => {
    renderer.render(scene, camera)
    // 再等一帧确保画面已提交，再通知截图脚本
    requestAnimationFrame(() => {
      window.__labReady = true
    })
  })
}

main().catch((err) => {
  console.error(err)
  const info = document.getElementById("info")
  if (info) info.textContent = `预览失败：${err.message}`
  window.__labError = err.message
  // 出错也视为「就绪」，截图脚本立即截图（画面上有错误提示），不必等超时
  window.__labReady = true
})

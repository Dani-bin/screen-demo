/*
 * 单景点预览页（开发用，不进生产构建）
 * ----------------------------------------------------------
 * 打开 /city-lab.html?landmark=kit&yaw=210&pitch=30&dist=160（可加 &tx=&tz=）
 *   landmark  kit（构件样例）或景点英文键 tianfu | taikooli | ifs | kuanzhai | peoplesPark | wenshu | hejiang |
 *             wangjiang | pandaTower | wuhou | dufu
 *   yaw       相机方位角（度，相对正北顺时针；相机位于注视点的这个方向上）
 *   pitch     俯仰角（度，0 为平视）
 *   dist      相机到注视点距离（米）
 *   y         注视点高度（米，缺省取景点 / 样例给的推荐值）
 *   tx / tz   注视点水平平移（米，X 向东、Z 向南，相对景点落点 / 样例注视点），
 *             用于近看离落点较远的构件（如合江亭站的安顺廊桥、人民公园站的鹤鸣茶社）
 *   focus     仅 kit：对准某件样例（hall | hall2 | twin | lhouse | pagoda | panda | pavilion | house | disc | boat | totem | crowd）
 *   people    景点 / kit 的步行路径上默认生成人群（crowd.js，种子与线上到站一致）；people=0 关闭
 *   t         人群预先推进的模拟秒数（缺省 3，按固定 0.05 s 步长推进）：让小人散开、姿态不一；
 *             同一视角取 t=3 与 t=4 各截一张，即可对比 1 秒内的走动（位置与摆腿不同）
 *   shadow    city：阴影与相机 near = 20 完全照搬城市场景（景点模式默认，所见即线上效果，
 *             near = 20 时近景距离须 ≥ 300 m，验收截图按此取 dist）。景点模式下等同线上
 *             「巡览停靠该站」时的阴影：按站点收紧到景点周围 ±1000 m（shadow.js 的 applyStopShadow）；
 *             kit 指定 shadow=city 时没有站点，用整城阴影（applyCityShadow），范围按线上同一批投影物
 *             实算（见 cityShadowBox），texel 与深度区间与线上总览一致；
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
import { createMarkers, markerBaseHeight } from "../scene/markers.js"
import { layoutTrees } from "../scene/trees.js"
import { nearestRegion, polygonCenter } from "../scene/utils.js"
import { SPOTS } from "../data/cityData.js"
import { buildingsInZones } from "../scene/landmarks/kit/footprint.js"
import {
  applyShadowFlags,
  buildLandmark,
  createLandmarks
} from "../scene/landmarks/index.js"
import {
  STOP_SHADOW_RADIUS,
  applyCityShadow,
  applyStopShadow,
  computeCityShadow
} from "../scene/shadow.js"
import { buildKit } from "./kitShowcase.js"
import { createCrowd } from "../scene/crowd.js"

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
  hejiang: "合江亭·安顺廊桥",
  wangjiang: "望江楼",
  pandaTower: "天府熊猫塔",
  wuhou: "武侯祠·锦里",
  dufu: "杜甫草堂"
}
// 单景点模式下只画景点周围这么远的通用楼：略大于线上停靠时的阴影收紧半径
// （STOP_SHADOW_RADIUS = 1000），收紧范围内的投影物与线上一致
const CONTEXT_RADIUS = 1100
// 景点模式 shadow=tight 时的阴影半径（只用于近看细节，不作验收依据）
const TIGHT_SPOT_RADIUS = 600
// 人群预推进的固定步长（秒）：t = 3 时即 60 步
const CROWD_STEP = 0.05

const params = new URLSearchParams(location.search)
const num = (key, fallback) => {
  const v = Number.parseFloat(params.get(key))
  return Number.isFinite(v) ? v : fallback
}

/**
 * 构建预览对象。
 * @returns {{ meshes, zones, walkways, seed: number, target: number[], defaultDist: number,
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
      context: false,
      seed: 1
    }
  }
  const spotName = SPOT_KEYS[name]
  const raw = SPOTS.find((s) => s.name === spotName)
  if (!raw) throw new Error(`未知景点键：${name}`)
  const [x, z] = project.toLocal(raw.lon, raw.lat)
  const spot = { ...raw, x, z }
  // ctx 与生产环境 createLandmarks 传给景点模块的完全一致；kit 工具由景点模块自行导入
  const ctx = { project, buildings: data.buildings, theme: THEME, spot }
  const r = buildLandmark(spotName, ctx)
  // 模块可能返回带子节点的 Group：遍历全部后代 Mesh 统计三角形（有索引按索引数计）
  let triangles = 0
  for (const root of r.meshes) {
    root.traverse((m) => {
      if (!m.isMesh || !m.geometry) return
      const g = m.geometry
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3
    })
  }
  // 注视点高度与线上 CityScene._initTour 相同：落点球底座高度 × 0.5。
  // 底座取景点给的 markerHeight；为 0 时同 markers.js 按仍在画的楼估算
  const hidden = buildingsInZones(data.buildings, r.zones)
  const base =
    r.markerHeight > 0
      ? r.markerHeight
      : markerBaseHeight(
          x,
          z,
          SPOTS.indexOf(raw) === 0
            ? THEME.marker.mainRadius
            : THEME.marker.radius,
          data.buildings.filter((b, i) => !hidden.has(i))
        )
  return {
    ...r,
    target: [x, base * 0.5, z],
    // 人群种子与线上 CityScene 到站时相同（1000 + 站点索引），所见即线上
    seed: 1000 + SPOTS.indexOf(raw),
    defaultDist: 420,
    shadowRadius: TIGHT_SPOT_RADIUS,
    shadowMode: "city",
    context: true,
    center: [x, z],
    stats: { total: triangles, meshes: r.meshes.length }
  }
}

/**
 * 不画的通用楼索引：在替换区里，或离景点超过 CONTEXT_RADIUS。
 * 交给 createBuildings 的 excluded 参数而不是过滤数组：楼栋保持原始索引，
 * 按索引取的随机配色与线上一致
 */
function contextExcluded(data, center, zones) {
  const hidden = buildingsInZones(data.buildings, zones)
  data.buildings.forEach((b, i) => {
    if (hidden.has(i)) return
    if (!b.p || !b.p.length) return hidden.add(i)
    const [bx, bz] = polygonCenter(b.p)
    if (Math.hypot(bx - center[0], bz - center[1]) > CONTEXT_RADIUS) {
      hidden.add(i)
    }
  })
  return hidden
}

/**
 * 主城区的整城阴影范围：与 CityScene 主城区那张静态阴影同一批投影物——主城区的楼栋、景点模型、
 * 按景点占用网格撒的通用树（树冠尺寸与线上完全一致）、落点球——再加上预览对象自身（kit 样例）。
 * 投影物按离哪块区域最近归类（nearestRegion），只取最近区域为主城区（下标 0）的，
 * 飞地（熊猫基地）另有一张静态阴影，这里不计入。
 * 预览页不画这些景点、树与落点球，只借来求范围，算完即释放。
 * @param {object} data 城市几何数据
 * @param {object} project 投影
 * @param {object} materials createMaterials 的结果（落点球材质）
 * @param {THREE.Object3D[]} extra 预览对象自身的 Mesh
 */
function cityShadowBox(data, project, materials, extra) {
  const spots = SPOTS.map((s) => {
    const [x, z] = project.toLocal(s.lon, s.lat)
    return { ...s, x, z }
  })
  const landmarks = createLandmarks({
    geometry: data,
    spots,
    theme: THEME,
    project
  })
  // 落点球底座与 CityScene 相同：景点给了 markerHeight 就用，否则按仍在画的楼估算
  const excluded = landmarks.excluded
  const markers = createMarkers(
    spots,
    materials,
    THEME,
    data.buildings.filter((b, i) => !excluded.has(i)),
    landmarks.markerHeights
  )
  // 区域裁剪矩形：下标 0 为主城区，其后是各飞地（与 CityScene 的 regionClips 一致）
  const clips = [
    data.meta.clip,
    ...(data.meta.enclaves || []).map((e) => e.clip)
  ]
  const box = computeCityShadow(
    {
      buildings: data.buildings,
      trees: layoutTrees(data, THEME, landmarks.occupancy),
      objects: [landmarks.group, markers.group, ...extra],
      within: (x, z) => nearestRegion(x, z, clips) === 0
    },
    THEME.light
  )
  landmarks.dispose()
  markers.dispose()
  return box
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
 *   city  —— 与 CityScene 共用 shadow.js：有景点中心 center 时按站点收紧（±STOP_SHADOW_RADIUS，
 *            同线上巡览停靠该站），否则整城一张阴影贴图（cityBox 为 cityShadowBox 的结果）；
 *   tight —— 太阳沿同一方向对准注视点，正交范围收紧到周围 radius 米，近景阴影更实。
 */
function addLights(scene, target, radius, mode, center, cityBox) {
  const Lt = THEME.light
  scene.add(new HemisphereLight(Lt.hemiSky, Lt.hemiGround, Lt.hemiIntensity))
  const sun = new DirectionalLight(Lt.sun, Lt.sunIntensity)
  sun.castShadow = true
  sun.shadow.mapSize.set(Lt.shadowMapSize, Lt.shadowMapSize)
  if (mode === "city") {
    // 与 CityScene 完全一致：停靠站点时 _fitShadow 以景点落点（地面）为中心收紧
    if (center) {
      applyStopShadow(sun, Lt, [center[0], 0, center[1]], STOP_SHADOW_RADIUS)
    } else applyCityShadow(sun, Lt, cityBox)
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
    sun.shadow.camera.updateProjectionMatrix()
  }
  scene.add(sun, sun.target)
}

function placeCamera(camera, target) {
  const yaw = num("yaw", 210) * DEG
  const pitch = num("pitch", 30) * DEG
  const dist = num("dist", target.defaultDist)
  const t = new Vector3(
    target.x + num("tx", 0),
    num("y", target.y),
    target.z + num("tz", 0)
  )
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
    const excluded = contextExcluded(data, subject.center, subject.zones)
    scene.add(createBuildings(data.buildings, THEME, excluded).mesh)
  }
  for (const m of subject.meshes) {
    // 与线上注册表同一约定：动画件（userData.animated）不投影
    applyShadowFlags(m)
    scene.add(m)
  }
  // 只有「city 模式且没有站点」（kit 指定 shadow=city）用整城阴影，才需要实算整城范围
  const cityBox =
    shadowMode === "city" && !subject.center
      ? cityShadowBox(data, project, materials, subject.meshes)
      : null
  addLights(
    scene,
    subject.target,
    subject.shadowRadius,
    shadowMode,
    subject.center,
    cityBox
  )
  const [tx, ty, tz] = subject.target
  placeCamera(camera, { x: tx, y: ty, z: tz, defaultDist: subject.defaultDist })

  // 人群：显示后按固定步长预推进 t 秒（淡入 0.6 s 早已完成），首帧即「走动中」的一帧
  let people = 0
  if (params.get("people") !== "0" && subject.walkways?.length) {
    const crowd = createCrowd(THEME)
    scene.add(crowd.group)
    crowd.show(subject.walkways, subject.seed)
    const steps = Math.round(Math.max(0, num("t", 3)) / CROWD_STEP)
    for (let k = 0; k < steps; k++) crowd.update(CROWD_STEP)
    people = crowd.count
    window.__labCrowd = crowd
    subject.stats = {
      ...subject.stats,
      people,
      crowdTriangles: people * crowd.trianglesPerPerson
    }
  }

  window.__labStats = subject.stats
  info.textContent = `${name}  阴影 ${shadowMode}  三角形 ${subject.stats?.total ?? "-"}  行人 ${people}`

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

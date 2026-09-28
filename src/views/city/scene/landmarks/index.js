/*
 * 景点注册表
 * ----------------------------------------------------------
 * 景点顺序与 cityData.js 的 SPOTS 一一对应（按景点名匹配，不依赖数组下标），
 * 每个模块 build(ctx) 返回 { meshes, zones, markerHeight, update? }。
 * 单个景点构建失败只跳过该景点并打印错误，不影响城市其他部分。
 *
 * 阴影约定：城市阴影贴图是静态的（只在必要时重绘一次），因此
 * 景点动画件（游船、喷泉等）一律不投影——模块给这类 Mesh 设
 * userData.animated = true，注册表据此令其 castShadow = false（仍接收阴影）；
 * 其余 Mesh 一律投影并接收阴影。
 */
import { Group } from "three"
import { buildingsInZones } from "./kit/footprint.js"
import { build as tianfu } from "./tianfu.js"
import { build as taikooli } from "./taikooli.js"
import { build as ifs } from "./ifs.js"
import { build as kuanzhai } from "./kuanzhai.js"
import { build as peoplesPark } from "./peoplesPark.js"
import { build as wenshu } from "./wenshu.js"
import { build as hejiang } from "./hejiang.js"

/** 景点名 → 构建函数；键与 cityData.js 的 SPOTS[i].name 完全一致 */
export const LANDMARK_MODULES = {
  天府广场: tianfu,
  "春熙路·太古里": taikooli,
  "成都 IFS": ifs,
  宽窄巷子: kuanzhai,
  人民公园: peoplesPark,
  文殊院: wenshu,
  合江亭: hejiang
}

/** 空结果：模块不存在或构建失败时使用 */
function emptyResult() {
  return { meshes: [], zones: [], markerHeight: 0, update: null }
}

/** 把模块返回值规整为完整结构，缺字段或类型不对时取默认值 */
function normalize(r) {
  if (!r || typeof r !== "object") return emptyResult()
  return {
    meshes: Array.isArray(r.meshes) ? r.meshes.filter(Boolean) : [],
    zones: Array.isArray(r.zones) ? r.zones : [],
    markerHeight: r.markerHeight > 0 ? r.markerHeight : 0,
    update: typeof r.update === "function" ? r.update : null
  }
}

/**
 * 按阴影约定设置 Mesh 的投影 / 接收标志（lab 预览页也调用，保证与线上一致）。
 * 动画件（userData.animated）不投影：阴影贴图静态，投影会留下不跟随的「残影」。
 */
export function applyShadowFlags(mesh) {
  mesh.castShadow = !mesh.userData?.animated
  mesh.receiveShadow = true
}

/**
 * 构建单个景点（lab 预览页用）。
 * 模块不存在时返回空结果；构建出错直接抛出，便于预览页显示错误。
 * @param {string} name 景点名（中文，与 SPOTS 一致）
 * @param {{ project, buildings, theme, spot }} ctx spot 需已含局部 x / z
 */
export function buildLandmark(name, ctx) {
  const build = LANDMARK_MODULES[name]
  if (!build) return emptyResult()
  return normalize(build(ctx))
}

/**
 * 构建全部景点。
 * @param {object} options
 * @param {object} options.geometry 城市几何数据（用到 geometry.buildings）
 * @param {Array} options.spots 景点数组（已含局部 x / z）
 * @param {object} options.theme THEME
 * @param {object} options.project 投影（toLocal 等）
 * @returns {{
 *   group: Group,
 *   excluded: Set<number>,      被景点替换区覆盖、不再画通用楼的楼栋索引
 *   markerHeights: number[],    各景点落点球底座高度，0 表示由 markers.js 自行估算
 *   pickables: Map<Mesh, number>, Mesh → 景点索引，供射线拾取
 *   update: (t: number) => void, t 为累计秒数
 *   dispose: () => void
 * }}
 */
export function createLandmarks({ geometry, spots, theme, project }) {
  const group = new Group()
  group.name = "landmarks"
  const buildings = geometry.buildings || []
  const pickables = new Map()
  const markerHeights = []
  const zones = []
  const updaters = [] // { name, fn, broken? }

  spots.forEach((spot, i) => {
    let r = emptyResult()
    const build = LANDMARK_MODULES[spot.name]
    if (build) {
      // 失败隔离：单个景点抛错时打印错误并视为空结果，城市其余部分照常构建
      try {
        r = normalize(build({ project, buildings, theme, spot }))
      } catch (err) {
        console.error(`景点「${spot.name}」模型构建失败，已跳过`, err)
        // 构建途中可能已创建部分几何体，但未返回引用无法释放；这里只保证不再使用
        r = emptyResult()
      }
    }
    markerHeights[i] = r.markerHeight
    zones.push(...r.zones)
    for (const mesh of r.meshes) {
      applyShadowFlags(mesh)
      group.add(mesh)
      pickables.set(mesh, i)
    }
    if (r.update) updaters.push({ name: spot.name, fn: r.update })
  })

  const excluded = buildingsInZones(buildings, zones)

  return {
    group,
    excluded,
    markerHeights,
    pickables,
    update(t) {
      // 按景点顺序依次推进；动画出错时停用该景点的动画，
      // 避免每帧抛错打断渲染循环、刷屏报错
      for (const u of updaters) {
        if (u.broken) continue
        try {
          u.fn(t)
        } catch (err) {
          u.broken = true
          console.error(`景点「${u.name}」动画出错，已停用`, err)
        }
      }
    },
    dispose() {
      // 几何体与材质可能被多个 Mesh 共用，先去重再释放
      const geos = new Set()
      const mats = new Set()
      group.traverse((obj) => {
        if (obj.geometry) geos.add(obj.geometry)
        if (obj.material) {
          const list = Array.isArray(obj.material)
            ? obj.material
            : [obj.material]
          list.forEach((m) => mats.add(m))
        }
      })
      geos.forEach((g) => g.dispose())
      mats.forEach((m) => m.dispose())
      group.removeFromParent()
      group.clear()
      pickables.clear()
      updaters.length = 0
    }
  }
}

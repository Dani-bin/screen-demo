/*
 * 景点注册表
 * ----------------------------------------------------------
 * 景点顺序与 cityData.js 的 SPOTS 一一对应（按景点名匹配，不依赖数组下标），
 * 每个模块 build(ctx) 返回 { meshes, zones, markerHeight, update?, walkways? }；
 * walkways 为该景点的步行路径，到站时交给人群系统（crowd.js）生成行人。
 * 单个景点构建失败只跳过该景点并打印错误，不影响城市其他部分。
 *
 * 阴影约定：城市阴影贴图是静态的（只在必要时重绘一次），因此
 * 景点动画件（游船、喷泉等）一律不投影——模块给这类 Mesh 设
 * userData.animated = true，注册表据此令其 castShadow = false（仍接收阴影）；
 * 其余 Mesh 一律投影并接收阴影。
 *
 * 占用网格：城市通用树（trees.js）只避让 OSM 楼与水面，不认识景点模型，
 * 会从亭心、碑台、茶社屋顶里长出来。createLandmarks 把全部景点 Mesh 的
 * 三角形投影到地面，生成 4 m 网格的占用集合 occupancy，供撒树时跳过。
 * 各景点步行路径（walkways）两侧的走廊也记为占用：通用树离路径足够远，
 * 树冠碰不到行人，人流校验不再依赖通用树恰好落在哪里（见 buildOccupancy）；
 * 路面高过通用树树顶的屋顶路径不设走廊（见 createLandmarks）。
 */
import { Group, Matrix4, Vector3 } from "three"
import { buildingsInZones } from "./kit/footprint.js"
import { pointInPolygon, polygonBounds } from "../utils.js"
import { treeShapeMax } from "../trees.js"
import { build as tianfu } from "./tianfu.js"
import { build as taikooli } from "./taikooli.js"
import { build as ifs } from "./ifs.js"
import { build as kuanzhai } from "./kuanzhai.js"
import { build as peoplesPark } from "./peoplesPark.js"
import { build as wenshu } from "./wenshu.js"
import { build as hejiang } from "./hejiang.js"
import { build as wangjiang } from "./wangjiang.js"
import { build as pandaTower } from "./pandaTower.js"
import { build as wuhou } from "./wuhou.js"
import { build as dufu } from "./dufu.js"
import { build as pandaBase } from "./pandaBase/index.js"

/** 景点名 → 构建函数；键与 cityData.js 的 SPOTS[i].name 完全一致 */
export const LANDMARK_MODULES = {
  天府广场: tianfu,
  "春熙路·太古里": taikooli,
  "成都 IFS": ifs,
  宽窄巷子: kuanzhai,
  人民公园: peoplesPark,
  文殊院: wenshu,
  "合江亭·安顺廊桥": hejiang,
  望江楼: wangjiang,
  天府熊猫塔: pandaTower,
  "武侯祠·锦里": wuhou,
  杜甫草堂: dufu,
  熊猫基地: pandaBase
}

/** 空结果：模块不存在或构建失败时使用 */
function emptyResult() {
  return {
    meshes: [],
    zones: [],
    markerHeight: 0,
    update: null,
    walkways: []
  }
}

/** 把模块返回值规整为完整结构，缺字段或类型不对时取默认值 */
function normalize(r) {
  if (!r || typeof r !== "object") return emptyResult()
  return {
    meshes: Array.isArray(r.meshes) ? r.meshes.filter(Boolean) : [],
    zones: Array.isArray(r.zones) ? r.zones : [],
    markerHeight: r.markerHeight > 0 ? r.markerHeight : 0,
    update: typeof r.update === "function" ? r.update : null,
    // 步行路径（人群用，格式见 crowd.js 文件头）；只做粗筛，细节由 crowd 校验
    walkways: Array.isArray(r.walkways)
      ? r.walkways.filter((w) => w && Array.isArray(w.points))
      : []
  }
}

/**
 * 按阴影约定设置投影 / 接收标志（lab 预览页也调用，保证与线上一致）。
 * 模块返回的可能是 Mesh，也可能是带子节点的 Group，因此遍历全部后代：
 * 每个 Mesh 都接收阴影；自身或到 root 为止的任一祖先带 userData.animated 时不投影
 * ——阴影贴图静态，动画件投影会留下不跟随的「残影」。
 * @param {THREE.Object3D} root 景点模块返回的对象
 */
export function applyShadowFlags(root) {
  const visit = (obj, animatedAncestor) => {
    const animated = animatedAncestor || Boolean(obj.userData?.animated)
    if (obj.isMesh) {
      obj.castShadow = !animated
      obj.receiveShadow = true
    }
    for (const child of obj.children) visit(child, animated)
  }
  visit(root, false)
}

// 材质上可能挂贴图的属性（map、normalMap 等）：释放材质时一并释放贴图
function disposeMaterial(material, textures) {
  for (const value of Object.values(material)) {
    if (value && value.isTexture) textures.add(value)
  }
  material.dispose()
}

/* ---------------- 占用网格 ---------------- */

// 网格边长（米）：约等于通用树树冠直径的一半，4 m 精度足以贴着模型边缘种树
const OCC_CELL = 4
// 顶点高于此值的三角形才算「实体」：铺装、台基顶面（≤ 1.0 m，见速查「地面分层」）
// 不挡树，否则整片广场、巷道铺装都会被当成障碍
const OCC_MIN_Y = 1.2
// 向外膨胀的格数：通用树树冠半径 7～12 m（theme.tree.crownMin + crownVar）。
// 膨胀 3 格保证树心离模型实体至少 12 m，最大的树冠也碰不到模型；
// 只膨胀 2 格（8 m）时，鹤鸣茶社牌坊外 12.5 m 仍留有一棵树，大树冠会擦到模型
const OCC_GROW = 3
// 步行路径走廊在「路宽一半 + 通用树最大树冠半径」之外再留的余量（米）：
// 覆盖小人身体半径（校验按身体外扩 0.8 m）与树冠多面体的取整误差
const WALK_CLEAR = 1
// 格子中心到格内最远点的距离（半对角线）：按格子中心判断距离时加上它，
// 保证走廊半径以内的任何一点所在的格子都被标记（宁多勿少）
const OCC_HALF_DIAG = (OCC_CELL * Math.SQRT2) / 2
const IDENTITY = new Matrix4()

/** 点 (x, z) 到线段 a-b 的距离 */
function segmentDistance(x, z, [ax, az], [bx, bz]) {
  const dx = bx - ax
  const dz = bz - az
  const l2 = dx * dx + dz * dz
  const t = l2
    ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2))
    : 0
  return Math.hypot(x - ax - t * dx, z - az - t * dz)
}

/**
 * 由景点 Mesh 与替换区生成占用网格。
 * - Mesh：逐个三角形（按 matrixWorld 换到世界坐标）检查，任一顶点 y > OCC_MIN_Y 时，
 *   它的 XZ 包围盒覆盖到的格子记为实体格，全部实体格再统一向外膨胀 OCC_GROW 格；
 *   用包围盒而非精确光栅化：斜长三角形会多占几格，对「树别压模型」而言宁多勿少。
 * - zones：格子中心落在替换区多边形内的格子全部占用（不再膨胀，替换区本身已含余量）。
 * - corridors：步行路径走廊，离路径中线 radius 以内的点所在的格子全部占用
 *   （按格子中心距离 < radius + 半对角线判断；闭合路径含末点回到首点的一段）。
 * @param {THREE.Object3D[]} roots 景点模块返回的顶层对象（可含子节点）
 * @param {Array} zones 世界坐标多边形数组
 * @param {Array<{ points: number[][], closed: boolean, radius: number }>} [corridors]
 * @returns {{ cell: number, size: number, has: (x: number, z: number) => boolean }}
 */
export function buildOccupancy(roots, zones, corridors = []) {
  // 格子键用小整数 (ix + OFF) · 2^13 + (iz + OFF)（加偏移保证非负）：
  // 比字符串键快一个数量级，且结果 < 2^26，始终是 V8 的小整数（不装箱）。
  // OFF = 4096 格 = ±16 km：主城区数据约 ±5.5 km，熊猫基地飞地最远到约 ±11.6 km，仍在范围内
  const OFF = 1 << 12
  const key = (ix, iz) => ((ix + OFF) << 13) | (iz + OFF)
  const raw = new Set() // 未膨胀的实体格
  const cells = new Set() // 最终占用格
  const v = new Vector3()
  for (const root of roots) {
    root.updateMatrixWorld(true)
    root.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.geometry?.attributes.position) return
      const pos = mesh.geometry.attributes.position
      const index = mesh.geometry.index?.array
      const n = index ? index.length : pos.count
      // 顶点换到世界坐标，三角形逐个取用（有索引时顶点会被多次引用）；
      // 合批器烘焙出的几何体本身就是世界坐标（matrixWorld 为单位阵），直接读原数组
      let world = pos.array
      if (
        !mesh.matrixWorld.equals(IDENTITY) ||
        pos.isInterleavedBufferAttribute ||
        pos.itemSize !== 3
      ) {
        world = new Float32Array(pos.count * 3)
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
          world[i * 3] = v.x
          world[i * 3 + 1] = v.y
          world[i * 3 + 2] = v.z
        }
      }
      for (let t = 0; t + 2 < n; t += 3) {
        let minX = Infinity
        let maxX = -Infinity
        let minZ = Infinity
        let maxZ = -Infinity
        let solid = false
        for (let k = 0; k < 3; k++) {
          const i = (index ? index[t + k] : t + k) * 3
          const x = world[i]
          const z = world[i + 2]
          if (world[i + 1] > OCC_MIN_Y) solid = true
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (z < minZ) minZ = z
          if (z > maxZ) maxZ = z
        }
        if (!solid) continue
        const ix1 = Math.floor(maxX / OCC_CELL)
        const iz1 = Math.floor(maxZ / OCC_CELL)
        for (let ix = Math.floor(minX / OCC_CELL); ix <= ix1; ix++) {
          for (let iz = Math.floor(minZ / OCC_CELL); iz <= iz1; iz++) {
            raw.add(key(ix, iz))
          }
        }
      }
    })
  }
  // 实体格统一向外膨胀 OCC_GROW 格（正方形膨胀）；先去重再膨胀，
  // 比逐个三角形外扩包围盒少做绝大部分重复标记
  for (const k of raw) {
    const ix = (k >> 13) - OFF
    const iz = (k & 8191) - OFF
    for (let dx = -OCC_GROW; dx <= OCC_GROW; dx++) {
      for (let dz = -OCC_GROW; dz <= OCC_GROW; dz++) {
        cells.add(key(ix + dx, iz + dz))
      }
    }
  }
  for (const poly of zones) {
    if (!poly || poly.length < 3) continue
    const b = polygonBounds(poly)
    const ix1 = Math.floor(b.maxX / OCC_CELL)
    const iz1 = Math.floor(b.maxZ / OCC_CELL)
    for (let ix = Math.floor(b.minX / OCC_CELL); ix <= ix1; ix++) {
      for (let iz = Math.floor(b.minZ / OCC_CELL); iz <= iz1; iz++) {
        // 以格子中心判断是否在区内
        const cx = (ix + 0.5) * OCC_CELL
        const cz = (iz + 0.5) * OCC_CELL
        if (pointInPolygon(cx, cz, poly)) cells.add(key(ix, iz))
      }
    }
  }
  for (const { points, closed, radius } of corridors) {
    if (!points || points.length < 2) continue
    const reach = radius + OCC_HALF_DIAG
    const n = closed ? points.length : points.length - 1
    for (let i = 0; i < n; i++) {
      const a = points[i]
      const b = points[(i + 1) % points.length]
      // 只扫线段包围盒外扩 reach 覆盖到的格子
      const ix0 = Math.floor((Math.min(a[0], b[0]) - reach) / OCC_CELL)
      const ix1 = Math.floor((Math.max(a[0], b[0]) + reach) / OCC_CELL)
      const iz0 = Math.floor((Math.min(a[1], b[1]) - reach) / OCC_CELL)
      const iz1 = Math.floor((Math.max(a[1], b[1]) + reach) / OCC_CELL)
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const cx = (ix + 0.5) * OCC_CELL
          const cz = (iz + 0.5) * OCC_CELL
          if (segmentDistance(cx, cz, a, b) < reach) cells.add(key(ix, iz))
        }
      }
    }
  }
  return {
    cell: OCC_CELL,
    size: cells.size,
    has(x, z) {
      return cells.has(key(Math.floor(x / OCC_CELL), Math.floor(z / OCC_CELL)))
    }
  }
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
 *   walkwaysBySpot: Array[],    各景点步行路径（无则为空数组），到站时生成人群
 *   pickables: Map<Mesh, number>, Mesh → 景点索引，供射线拾取
 *   occupancy: { has(x, z) },   景点模型、替换区与步行路径走廊的占用网格，撒通用树时跳过（见 buildOccupancy）
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
  const walkwaysBySpot = []
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
    walkwaysBySpot[i] = r.walkways
    zones.push(...r.zones)
    for (const mesh of r.meshes) {
      applyShadowFlags(mesh)
      group.add(mesh)
      // 只登记模块返回的顶层对象；射线命中其子节点时，
      // picking.js 沿父级链向上查 pickables，仍能换算回景点
      pickables.set(mesh, i)
    }
    if (r.update) updaters.push({ name: spot.name, fn: r.update })
  })

  const excluded = buildingsInZones(buildings, zones)
  // 步行路径走廊：半径 = 路宽一半 + 通用树最大树冠水平半径 + 余量（树外形见 trees.js 的 treeShape），
  // 树心落在走廊外时，任何一棵通用树的树冠都碰不到路上的行人
  const { radius: crownMax, top: treeTopMax } = treeShapeMax(theme.tree)
  const corridors = walkwaysBySpot
    .flat()
    // 路面不低于通用树最高树顶（约 33 m）的架空路径（如 IFS 屋顶花园 39 m）不设走廊：
    // 地面上的树冠够不着路上的行人，清走廊只会把楼外一圈本来无碍的通用树白白删掉。
    // 比树顶低的架空路径（合江亭安顺廊桥桥面 8.5 m 等）树冠仍能伸到行人身上，照常避让；
    // 没给 y 的路径按地面处理（undefined >= 数字 为 false）
    .filter((w) => !(w.y >= treeTopMax))
    .map((w) => ({
      points: w.points,
      closed: Boolean(w.closed),
      radius: (w.width > 0 ? w.width / 2 : 0) + crownMax + WALK_CLEAR
    }))
  // 景点 Mesh 此时都在 group 里，统一生成占用网格（含动画件的初始位置）
  const occupancy = buildOccupancy(group.children, zones, corridors)

  return {
    group,
    excluded,
    markerHeights,
    walkwaysBySpot,
    pickables,
    occupancy,
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
      // 几何体、材质、贴图可能被多个 Mesh 共用，先去重再释放
      const geos = new Set()
      const mats = new Set()
      const textures = new Set()
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
      mats.forEach((m) => disposeMaterial(m, textures))
      textures.forEach((t) => t.dispose())
      group.removeFromParent()
      group.clear()
      pickables.clear()
      updaters.length = 0
    }
  }
}

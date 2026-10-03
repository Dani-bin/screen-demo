/*
 * 天府广场 · 北侧组团（入口）：毛主席像、四川科技馆、两者之间的广场
 * ----------------------------------------------------------
 * 职责：道路以北三处构件的组装（设计第 4 节、报告 2.2 与 6.8）——
 * - statue.js：毛主席像组团（台座、斜坡、花坡、基座与立像）；
 * - science.js：四川科技馆（体块、柱廊、窗、线脚、楼顶招牌）；
 * - 本文件：两者之间的门前广场、三块替换区、科技馆前的南北轴线路径，以及入口 buildNorth。
 * 组团地坪 NORTH_Y 在 site.js（三个文件共用，放这里会循环导入）。
 *
 * 坐标：两处各用自己的 OSM 点位作原点、按各自 OSM 轮廓的实际朝向摆放（不用广场设计系）：
 * - 像组团系 S：原点在立像中心，方位角 −0.92°（statue.js 的 STATUE）；
 * - 科技馆系 M：原点在正立面中点，方位角 −1.39°（science.js 的 SCIENCE）。
 * 两系都是 +X 向东（略偏北）、+Z 向南（正面）。门前广场与轴线写在 S 系里。
 *
 * 南北轴线原先走在城市地面上（校验脚本只认景点自己的三角形，2805 个支撑坏点），现在走在门前广场的铺装上。
 */
import { Vector3 } from "three"
import { frame } from "../kit/builder.js"
import { sideWalls } from "../kit/shapes.js"
import { GROUND_Y } from "../../terrain.js"
import { C, NORTH_Y, addInlay, addSurface, rectUV } from "./site.js"
import { CLUSTER, RESTAURANT, STATUE, buildStatue } from "./statue.js"
import { SCIENCE, buildScience } from "./science.js"

/* ---------------- 像与科技馆之间的广场（像组团系 S） ---------------- */

// 广场铺装：南沿贴组团后缘（中部凹进去贴 SE 餐厅北墙），北沿一直铺到科技馆柱廊后墙（M 系 z −5.2，
// 换到 S 系约 −88.5～−89.0）以内 0.2～0.7 m，正门前的柱廊地面也由它提供；
// 伸进科技馆墙内的部分被楼体盖住。东西半宽 46 m（OSM 步行区约 97 m 宽，两侧各让开 2～3 m 的楼）
const PLAZA_HW = 46
const PLAZA_N = -89.2
const PLAZA = [
  [-PLAZA_HW, CLUSTER.z0],
  [RESTAURANT.x0, CLUSTER.z0],
  [RESTAURANT.x0, RESTAURANT.z0],
  [RESTAURANT.x1, RESTAURANT.z0],
  [RESTAURANT.x1, CLUSTER.z0],
  [PLAZA_HW, CLUSTER.z0],
  [PLAZA_HW, PLAZA_N],
  [-PLAZA_HW, PLAZA_N]
]
// 分格线（Google 影像）：南北向 7 道、东西向 4 道，间距 10 m、宽 1.2，中线 x = 1.2 对着科技馆正门
const GRID = {
  xs: [-28.8, -18.8, -8.8, 1.2, 11.2, 21.2, 31.2],
  zs: [-69.6, -59.6, -49.6, -39.6],
  w: 1.2
}

// 科技馆前南北轴线：沿分格中线，南端离 SE 餐厅北墙 7 m，北端离柱廊前沿约 5.5 m
const AXIS = {
  x: GRID.xs[3],
  z0: RESTAURANT.z0 - 7,
  z1: -78,
  width: 8,
  density: 1.5
}

/* ---------------- 替换区 ---------------- */

// 外扩余量（米）
const ZONE_PAD = 1.5
// 像组团：组团外轮廓（w1532678567）四边外扩，盖住几何数据里像下那座无名楼（h 15.1）（S 系）
const CLUSTER_ZONE = rectUV(
  CLUSTER.x0 - ZONE_PAD,
  CLUSTER.x1 + ZONE_PAD,
  CLUSTER.z0 - ZONE_PAD,
  CLUSTER.z1 + ZONE_PAD
)
// 门前广场：东西各宽出 1 m，南北与铺装同（南沿接像组团的区）（S 系）
const PLAZA_ZONE = rectUV(-PLAZA_HW - 1, PLAZA_HW + 1, PLAZA_N, CLUSTER.z0)
// 科技馆：楼体轮廓（东西 −70.9～70.7、北墙 −101.3、塔前沿 2.0）外扩约 1.5～1.8 m（M 系）。
// OSM 博物馆面（tourism=museum）在北墙中段还有一块凸出到 z −106.5，那不是楼体、没有建模，不必替换
const SCI_ZONE = rectUV(-72.5, 72.5, -103, 3.5)

/* ---------------- 通用小函数 ---------------- */

/** 局部坐标系 f 里的一组点 [x, z] → 世界 [x, z]（替换区、步行路径用） */
function worldPts(f, pts) {
  const v = new Vector3()
  return pts.map(([x, z]) => {
    v.set(x, 0, z).applyMatrix4(f)
    return [v.x, v.z]
  })
}

/* ---------------- 门前广场 ---------------- */

/**
 * 广场铺装：外轮廓 PLAZA，分格线范围挖成洞，洞里再铺深色格框与浅色格心（三者共面共边，不闪）。
 * 侧墙从城市地面立到 NORTH_Y
 */
function buildPlaza(b, f) {
  const hw = GRID.w / 2
  const gx0 = GRID.xs[0] - hw
  const gx1 = GRID.xs[GRID.xs.length - 1] + hw
  const gz0 = GRID.zs[0] - hw
  const gz1 = GRID.zs[GRID.zs.length - 1] + hw
  const gridRect = rectUV(gx0, gx1, gz0, gz1)
  b.add(sideWalls(PLAZA, GROUND_Y, NORTH_Y), C.northPave, f)
  addSurface(b, f, PLAZA, [gridRect], () => NORTH_Y, C.northPave)
  // 格心：相邻两道线之间（线宽以外）
  const cells = []
  for (let i = 0; i + 1 < GRID.xs.length; i++) {
    for (let j = 0; j + 1 < GRID.zs.length; j++) {
      cells.push(
        rectUV(
          GRID.xs[i] + hw,
          GRID.xs[i + 1] - hw,
          GRID.zs[j] + hw,
          GRID.zs[j + 1] - hw
        )
      )
    }
  }
  // 深色格框把格心当洞，格心再铺回浅色
  addInlay(b, f, gridRect, cells, NORTH_Y, C.northGrid, C.northPave)
}

/* ---------------- 入口 ---------------- */

/**
 * 建毛主席像组团、两者之间的广场与四川科技馆（顺序：像 → 广场 → 科技馆，决定合批顶点顺序）。
 * @param {ColorBuilder} b 静态件
 * @param {object} site 场地对象（site.js 的 createSite），用到 site.project
 * @returns {{ zones: Array, walkways: Array }} 替换区（像组团、广场、科技馆）与科技馆前轴线路径（世界坐标）
 */
export function buildNorth(b, site) {
  const { project } = site
  const [sx, sz] = project.toLocal(STATUE.lon, STATUE.lat)
  const fs = frame(sx, 0, sz, STATUE.bearing)
  const [mx, mz] = project.toLocal(SCIENCE.lon, SCIENCE.lat)
  const fm = frame(mx, 0, mz, SCIENCE.bearing)

  buildStatue(b, fs)
  buildPlaza(b, fs)
  buildScience(b, fm)

  const zones = [
    worldPts(fs, CLUSTER_ZONE),
    worldPts(fs, PLAZA_ZONE),
    worldPts(fm, SCI_ZONE)
  ]
  const walkways = [
    {
      // 科技馆前南北轴线：走在广场铺装顶面 NORTH_Y 上
      points: worldPts(fs, [
        [AXIS.x, AXIS.z0],
        [AXIS.x, AXIS.z1]
      ]),
      y: NORTH_Y,
      width: AXIS.width,
      closed: false,
      density: AXIS.density
    }
  ]
  return { zones, walkways }
}

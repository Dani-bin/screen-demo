/*
 * 构件样例陈列（预览页 landmark=kit）
 * ----------------------------------------------------------
 * 在城市原点摆一块浅色展台，前后两排陈列 kit 的全部构件，
 * 用于检查屋面曲线、翘角、重檐、塔的收分、熊猫黑白分区等造型。
 * 每件样例单独统计三角形数，挂到 window.__labStats 供验收。
 */
import { Mesh } from "three"
import { THEME } from "../scene/theme.js"
import {
  ColorBuilder,
  flatMaterial,
  frame,
  landmarkMaterial,
  local
} from "../scene/landmarks/kit/builder.js"
import { rectPolygon } from "../scene/landmarks/kit/footprint.js"
import { box, polygonVertex } from "../scene/landmarks/kit/shapes.js"
import {
  addBalustrade,
  addHall,
  addLantern,
  addPagoda,
  addPavilion,
  addPitchedHouse
} from "../scene/landmarks/kit/parts.js"
import {
  addBoat,
  addPanda,
  addSunbirdDisc,
  addTotem
} from "../scene/landmarks/kit/figures.js"

const L = THEME.landmark
// 展台高度：盖住道路面（道路最高 0.9 m），样例都放在展台上
const PAD = 1.2

/**
 * @returns {{ meshes: Mesh[], zones: Array, target: number[], focus: object, stats: object }}
 *   focus：样例名 → [x, y, z, 推荐距离]，供 ?focus= 近景
 */
export function buildKit() {
  const b = new ColorBuilder()
  const pb = new ColorBuilder() // 熊猫单独一批（平面着色材质）
  const stats = {}
  const focus = {}
  // 记录一件样例的三角形增量
  const item = (name, pos, dist, fn) => {
    const t0 = b.triangles + pb.triangles
    fn()
    stats[name] = b.triangles + pb.triangles - t0
    focus[name] = [...pos, dist]
  }

  // 展台与水池
  b.add(box(150, PAD, 96), L.stonePave, frame(-5, 0, -3))
  b.add(box(26, 0.12, 12), THEME.water, frame(26, PAD, 22))

  /* ---- 后排：殿堂、重檐殿堂、塔、熊猫 ---- */
  item("hall", [-50, 6, -28], 60, () =>
    addHall(b, frame(-50, PAD, -28), { w: 24, d: 16, wallH: 5 })
  )
  item("hall2", [-18, 7, -28], 60, () =>
    addHall(b, frame(-18, PAD, -28), { w: 24, d: 16, wallH: 5, double: true })
  )
  item("pagoda", [12, 10, -26], 55, () => {
    // 六角石台 + 塔
    const f = frame(12, PAD, -26)
    b.add(box(9, 1, 9), L.granite, f)
    addPagoda(b, local(f, 0, 1, 0), {
      sides: 6,
      tiers: 11,
      height: 21,
      baseRadius: 2.2,
      topRadius: 1.3
    })
  })
  item("panda", [42, 6, -24], 50, () => {
    // 裙楼样块：熊猫趴在 +Z 一侧的女儿墙顶
    const f = frame(42, PAD, -30)
    b.add(box(24, 10, 12), L.beige, f)
    b.add(box(24, 0.6, 0.5), L.granite, local(f, 0, 10, 5.75))
    addPanda(pb, local(f, 0, 10.6, 6), { height: 15 })
  })

  /* ---- 前排：亭、民居、金盘、游船、图腾柱 ---- */
  item("pavilion", [-50, 5, 20], 40, () => {
    const f = frame(-50, PAD, 20)
    addPavilion(b, f, {
      sides: 6,
      radius: 4,
      colH: 3.4,
      platformH: 0.8,
      roofColor: L.glaze
    })
    // 台基边一圈汉白玉栏杆，正面（+Z 那条边）留口
    const pts = Array.from({ length: 6 }, (_, k) => polygonVertex(6, 4.8, k))
    addBalustrade(b, f, {
      points: pts,
      closed: false,
      h: 0.9,
      y: 0.8,
      postSpacing: 1.6
    })
  })
  item("house", [-26, 4, 22], 40, () => {
    addPitchedHouse(b, rectPolygon(-30, 16, 14, 8, 90), {
      eaveH: 5,
      ridgeH: 2.5,
      y: PAD,
      wallColor: L.brick
    })
    addPitchedHouse(b, rectPolygon(-22, 28, 12, 7, 60), {
      eaveH: 4.5,
      ridgeH: 2.5,
      y: PAD
    })
    // 临巷红灯笼
    for (const x of [-35, -30, -25]) {
      addLantern(b, frame(0, 0, 0), x, PAD + 3.5, 20.6, { r: 0.45 })
    }
  })
  item("disc", [2, 1, 22], 45, () =>
    addSunbirdDisc(b, frame(2, PAD, 22), { radius: 13 })
  )
  item("boat", [26, 2, 22], 30, () =>
    addBoat(b, frame(26, PAD, 22, 70), { length: 14 })
  )
  item("totem", [46, 6, 20], 35, () => {
    for (const x of [42, 46, 50])
      addTotem(b, frame(x, PAD, 20), { h: 12, r: 0.6 })
  })

  const meshes = []
  const g = b.bake()
  if (g) meshes.push(new Mesh(g, landmarkMaterial()))
  const pg = pb.bake()
  if (pg) meshes.push(new Mesh(pg, flatMaterial()))
  const total = meshes.reduce(
    (s, m) => s + m.geometry.attributes.position.count / 3,
    0
  )
  return {
    meshes,
    zones: [],
    target: [0, 8, -3],
    focus,
    stats: { ...stats, total }
  }
}

/*
 * 熊猫基地 · 步行路径（人流）
 * ----------------------------------------------------------
 * 规格：设计文档第 6 节的 11 条路径（人数 = 长 × 0.04 × density ≈ 91 人）。格式见 crowd.js 文件头：
 * { points: [[x, z], …], y, width, closed, density }，世界坐标，y 为路面顶。
 * 点列一律取 site.paths（即 ground.js 的 ROADS 原始点列，不另抄坐标）：渲染的路面两端已外延
 * 0.4 m、折点带斜接，原始端点不会落在路面边缘；高度取园路自己的 y（主路 PAVE_Y、步道 PATH_Y）。
 * 只做这 11 条：ground.js 的 ROADS 里补上的短连接路（OSM 断头路的补段 sunSouthLink、villasLink、
 * lakeWestLink，产房入口与参观平台连接段 sunEntry、moonPlatformLink）不在规格表里，不进人流；月亮产房的吊桥也不接（moonLoop 止于西桥头）。
 * 每条路径在占用栅格上登记 F_WALK（可走带外扩 1.5 m，见 WALK_CLEAR），供后面的树、竹种植
 * （vegetation）避让。
 */
import { gatePassage } from "./gate.js"
import { pathById } from "./ground.js"
import { F_WALK } from "./site.js"

/**
 * F_WALK 标记在可走带（width / 2）之外再外扩的距离（米）。
 * 这里只标「可走带 + 一小圈余量」，不是整条净空带：vegetation.js 种树时拿树冠的真实半径去测这块标记
 * （树冠离可走带边缘 ≥ 1.5 m，冠沿侵入可走带的情况另有步行路径校验兜底）；通用竹丛另用明确的距离
 * 检查，保证离可走带边缘 ≥ 4.5 m（同 wangjiang 的 BAMBOO_CLEAR 做法）；loop / villas 两侧的
 * 竹林甬道按路径偏移直接布置（竹根离中线 4.7 m，竹梢向路面上方探出，都在 4.35 m 头顶净空之上），
 * 不走这块标记。若这里取 4.5 m，会把甬道里每一丛竹都挡掉，并在每条路两侧留下 27～39 m 宽的无树带。
 */
const WALK_CLEAR = 1.5

/** 两点视为同一点的距离阈值（米）：点列拼接去重、接点查找都用它，不依赖浮点全等 */
const SAME_EPS = 0.01

/** 两个 [x, z] 点是否重合（距离 < SAME_EPS） */
const samePoint = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < SAME_EPS

/**
 * 第 1 条的广场段：广场边缘的闸口前后两点（设计文档第 6 节）；广场顶与 entry 同为 PAVE_Y，
 * 无需另取高度。两点是按当前广场轮廓（PLAZA_LL）取的，广场多边形一旦改动，
 * 必须重跑 walk 校验确认这一段仍在铺装上、没有压到草坪岛或喷泉池。
 */
const PLAZA_LEG = [
  [7503, -8551],
  [7478, -8571]
]

/**
 * 拼接多段点列：后一段的首点若与前一段的末点重合就去掉，避免出现零长线段。
 */
function joinPoints(...parts) {
  const out = []
  for (const part of parts) {
    for (const p of part) {
      const last = out[out.length - 1]
      if (last && samePoint(last, p)) continue
      out.push(p)
    }
  }
  return out
}

/**
 * 构建步行路径。
 * 副作用：每条路径都会往 site.grid 上盖 F_WALK 标记（可走带外扩 WALK_CLEAR），
 * 后面的树竹种植依赖它，所以必须在种植（vegetation）之前调用。
 * @param {object} site 场地对象（需已铺好园路：site.paths；已打好各分区的占用标记）
 * @returns {Array<{ points: number[][], y: number, width: number, closed: boolean, density: number }>}
 */
export function buildWalkways(site) {
  const ws = []
  /**
   * 登记一条路径，并在栅格上标记可走带外扩范围。
   * y 取园路自己的高度；一条路径跨主路与步道时（第 5 条）取较高者，
   * 脚底最多悬空 0.03 m，比陷进路面更不显眼，且在校验的支撑面容差 0.06 m 之内。
   */
  const add = (points, ids, width, density, closed = false) => {
    const y = Math.max(...ids.map((id) => pathById(site, id).y))
    // 点列拷一份：园路原始点列由 site.paths 持有，不让人群系统有机会改到它
    const own = points.map(([x, z]) => [x, z])
    ws.push({ points: own, y, width, closed, density })
    site.grid.stampLine(own, width / 2 + WALK_CLEAR, F_WALK, closed)
  }
  const pts = (id) => pathById(site, id).pts

  // 1 南门广场 → 闸口 → 南大门主拱（门洞中点，随 gate.js 的门洞实际位置）→ 入园主路 entry。
  // 规格里原来的 (7467, −8590) 一点就是门洞中点的草案位置，这里换成实际位置。
  // 广场段与门洞地面都在 PAVE_Y，entry 也是主路，整条路径同高
  add(
    joinPoints(PLAZA_LEG, [gatePassage(site.ctx.spot)], pts("entry")),
    ["entry"],
    3.0,
    1.8
  )
  // 2 铜像 → 博物馆北 → 湖南岸 → 7 号别墅（竹林甬道）：loop 去掉末点（7095, −9004），
  // 止于 7 号别墅路口 (7174, −8896)，其后由第 3 条接力
  add(pts("loop").slice(0, -1), ["loop"], 3.0, 0.6)
  // 3 别墅步道 7 → 5 → 4 → 3 号
  add(pts("villas"), ["villas"], 2.4, 0.8)
  // 4 太阳产房单循环参观环（闭合，点列不重复首点）
  add(pts("sunLoop"), ["sunLoop"], 2.4, 1.4, true)
  // 5 太阳产房 → 2 号别墅 → 月亮产房：sunToNo2 接 toMoon 自 (6996, −9210) 起的一段；
  // 两段在 (6996, −9210) 相接，joinPoints 去掉重复点。toMoon 的首点 (7201, −9341) 是
  // 另一头的支线起点，不属于本路径（所以从 (6996, −9210) 起取）
  const toMoon = pts("toMoon")
  const joinAt = toMoon.findIndex((p) => samePoint(p, [6996, -9210]))
  if (joinAt < 0) throw new Error("熊猫基地：toMoon 里找不到接点 (6996, −9210)")
  add(
    joinPoints(pts("sunToNo2"), toMoon.slice(joinAt)),
    ["sunToNo2", "toMoon"],
    2.4,
    0.4
  )
  // 6 月亮产房外环参观道，止于吊桥西头（不上桥：桥面另有净空，且桥头立柱离路缘很近）
  add(pts("moonLoop"), ["moonLoop"], 2.4, 1.0)
  // 7 天鹅湖西岸步道
  add(pts("lakeWest"), ["lakeWest"], 2.4, 0.5)
  // 8 天鹅湖东岸路（观光车道，行人少）
  add(pts("lakeEast"), ["lakeEast"], 3.0, 0.3)
  // 9 博物馆前路
  add(pts("museumFront"), ["museumFront"], 3.0, 0.5)
  // 10 2 号别墅参观环（开口环：首点 (6945, −9212) 与末点 (6996, −9210) 不相连）
  add(pts("no2Loop"), ["no2Loop"], 2.4, 0.5)
  // 11 1 号别墅参观道
  add(pts("no1"), ["no1"], 2.4, 0.4)

  return ws
}

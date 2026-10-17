/*
 * 院内导航 · 寻路与分步提示（scripts/hospital/nav.py 的 JS 版，两边算法保持一致）
 * ----------------------------------------------------------
 * 路网来自 data/plan.json 的 nav（由 scripts/hospital/draw_plan.py 生成）：
 *   节点：通道中线交点 / 门口 / 楼梯口 / 电梯厅 / 扶梯口 / 房间终点；边的代价统一为"秒"。
 *   竖向连接：楼梯（上下耗时不同）、电梯（任意两层直达，含候梯）、扶梯（单向）。
 * 寻路是 Dijkstra，状态 = 节点 + 来向：每转一次弯加 TURN_COST 秒，等长路线优先选拐弯少、好描述的。
 * "无障碍"模式禁用楼梯和扶梯，只走电梯。
 * 不依赖 Vue / three.js。
 */
import PLAN from "./data/plan.json"

export const FLOORS = PLAN.meta.floors // ["1F", "2F", "3F"]
export const FLOOR_TITLES = PLAN.meta.floorTitles
const TURN_COST = 4

/** 竖向连接的显示名（路网导出时只留了 conn 编号） */
const CONN_NAME = {
  stairW: "西楼梯",
  stairE: "东楼梯",
  elev1: "1号电梯",
  elev2: "2号电梯",
  escA: "中庭扶梯",
  escB: "中庭扶梯",
  escC: "中庭扶梯",
  escD: "中庭扶梯"
}

/** 由 plan.json 建图：nodes[id] = { id, f, x, y, k, name }，adj[id] = [{ to, c, e }] */
export function buildGraph() {
  const nodes = {}
  const adj = {}
  for (const n of PLAN.nav.nodes) {
    nodes[n.id] = n
    adj[n.id] = []
  }
  for (const e of PLAN.nav.edges) {
    const edge = { ...e, name: e.conn ? CONN_NAME[e.conn] : undefined }
    adj[e.a].push({ to: e.b, c: e.c, e: edge })
    if (!e.oneway) adj[e.b].push({ to: e.a, c: e.c, e: edge })
  }
  return { nodes, adj }
}

/** 全部可选起终点（房间、候诊区、卫生间、服务台 / 护士站、入口） */
export const PLACES = PLAN.places

export const findEdge = (G, a, b) => G.adj[a].find((x) => x.to === b).e

function heading(G, a, b) {
  const na = G.nodes[a]
  const nb = G.nodes[b]
  const dx = nb.x - na.x
  const dy = nb.y - na.y
  const L = Math.hypot(dx, dy)
  return L > 1e-6 ? [dx / L, dy / L] : null
}

/** 最小堆（按代价） */
class Heap {
  constructor() {
    this.a = []
  }
  push(item) {
    const a = this.a
    a.push(item)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p][0] <= a[i][0]) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop() {
    const a = this.a
    const top = a[0]
    const last = a.pop()
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l][0] < a[m][0]) m = l
        if (r < a.length && a[r][0] < a[m][0]) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
  get size() {
    return this.a.length
  }
}

/**
 * 最短路线。mode："recommend" 推荐（按总耗时）/ "accessible" 无障碍（只乘电梯）
 * 返回 { path: 节点 id 数组, cost: 实际耗时秒 }，不可达时 path 为 null
 */
export function shortest(G, src, dst, mode = "recommend") {
  const banned =
    mode === "accessible" ? new Set(["stair", "escalator"]) : new Set()
  // 状态键 = 节点 + 上一节点 + 来向（来向只用于算转弯，与上一节点一一对应，所以键里不用再带）
  const key = (u, pu) => `${u}|${pu}`
  const best = new Map([[key(src, ""), 0]])
  const prev = new Map()
  const heap = new Heap()
  heap.push([0, src, "", null])
  let final = null
  while (heap.size) {
    const [d, u, pu, hu] = heap.pop()
    if (d > (best.get(key(u, pu)) ?? Infinity)) continue
    if (u === dst) {
      final = [u, pu]
      break
    }
    for (const { to: v, c, e } of G.adj[u]) {
      if (banned.has(e.k) || v === pu) continue
      let nd = d + c
      const hv = e.k === "walk" ? heading(G, u, v) : null
      if (e.k === "walk" && hu && hv && hu[0] * hv[0] + hu[1] * hv[1] < 0.9)
        nd += TURN_COST
      const nh = hv || (e.k === "walk" ? hu : null)
      const k = key(v, u)
      if (nd < (best.get(k) ?? Infinity) - 1e-9) {
        best.set(k, nd)
        prev.set(k, [u, pu])
        heap.push([nd, v, u, nh])
      }
    }
  }
  if (!final) return { path: null, cost: Infinity }
  const path = []
  let s = final
  while (s) {
    path.push(s[0])
    s = prev.get(key(s[0], s[1]))
  }
  path.reverse()
  let cost = 0
  for (let i = 1; i < path.length; i++)
    cost += findEdge(G, path[i - 1], path[i]).c
  return { path, cost }
}

/** 把节点序列拆成"本层步行段"和"竖向换层段"；i0 / i1 为在 path 里的下标 */
export function legs(G, path) {
  const out = []
  let cur = null
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    const e = findEdge(G, a, b)
    if (e.k === "walk") {
      if (!cur) {
        cur = { kind: "walk", floor: G.nodes[a].f, nodes: [a], i0: i - 1 }
        out.push(cur)
      }
      cur.nodes.push(b)
      cur.i1 = i
    } else {
      out.push({
        kind: e.k,
        conn: e.conn,
        name: e.name,
        a,
        b,
        f0: G.nodes[a].f,
        f1: G.nodes[b].f,
        i0: i - 1,
        i1: i
      })
      cur = null
    }
  }
  return out
}

/** 步行段 → 直线段：{ u 方向, len, label 通道名, i0 起点在 path 里的下标 }，同向的相邻边合并 */
function runs(G, leg) {
  const out = []
  const { nodes } = leg
  for (let k = 1; k < nodes.length; k++) {
    const na = G.nodes[nodes[k - 1]]
    const nb = G.nodes[nodes[k]]
    const dx = nb.x - na.x
    const dy = nb.y - na.y
    const L = Math.hypot(dx, dy)
    if (L < 1e-6) continue
    const u = [dx / L, dy / L]
    const label = findEdge(G, nodes[k - 1], nodes[k]).label || null
    const last = out[out.length - 1]
    if (
      last &&
      Math.abs(last.u[0] - u[0]) < 1e-6 &&
      Math.abs(last.u[1] - u[1]) < 1e-6 &&
      (last.label === label || !label || !last.label)
    ) {
      last.len += L
      last.label = last.label || label
    } else {
      out.push({ u, len: L, label, i0: leg.i0 + k - 1 })
    }
  }
  return out
}

/** u → v 的转向（x 向东、y 向北，叉积 > 0 为左转） */
function turn(u, v) {
  const cross = u[0] * v[1] - u[1] * v[0]
  const dot = u[0] * v[0] + u[1] * v[1]
  if (dot < -0.9) return "掉头"
  if (Math.abs(cross) < 0.3) return "直行"
  return cross > 0 ? "左转" : "右转"
}

export function walkLen(G, leg) {
  let s = 0
  for (let k = 1; k < leg.nodes.length; k++) {
    const a = G.nodes[leg.nodes[k - 1]]
    const b = G.nodes[leg.nodes[k]]
    s += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return s
}

export const fmtPlace = (p) => (p.num ? `${p.name}（${p.num}）` : p.name)

/**
 * 分步提示：[{ kind, floor, text, at }]
 * kind：start / walk / hint / stair / elevator / escalator / end；at 为该步开始时在 path 里的下标（用于跟随人员进度）
 */
export function describe(G, path, placeByNode) {
  const L = legs(G, path)
  const n0 = G.nodes[path[0]]
  const nEnd = G.nodes[path[path.length - 1]]
  const start = placeByNode[path[0]] || { name: n0.name || "起点" }
  const end = placeByNode[path[path.length - 1]] || {
    name: nEnd.name || "终点"
  }
  const steps = [
    { kind: "start", floor: n0.f, text: `从 ${fmtPlace(start)} 出发`, at: 0 }
  ]
  let i = 0
  while (i < L.length) {
    const leg = L[i]
    if (leg.kind === "walk") {
      const rs = runs(G, leg)
      // 有名字、长于 3 m 的直线段才单独成句
      const main = rs
        .map((r, k) => (r.len >= 3 && r.label ? k : -1))
        .filter((k) => k >= 0)
      let prevDir = rs.length ? rs[0].u : null
      let first = true
      for (const k of main) {
        const r = rs[k]
        const t = prevDir && k > 0 ? turn(prevDir, r.u) : "直行"
        let lead
        if (first && i === 0 && (n0.k === "room" || n0.k === "door")) {
          lead = t === "左转" || t === "右转" ? `出门后${t}` : "出门"
        } else if (first && k === 0) lead = ""
        else if (t === "直行") lead = "继续"
        else lead = t
        const body = `沿${r.label}直行 ${Math.round(r.len)} 米`
        steps.push({
          kind: "walk",
          floor: leg.floor,
          text: lead ? `${lead}，${body}` : body,
          at: r.i0
        })
        prevDir = r.u
        first = false
      }
      // 段尾转进门口 / 梯口：左手边还是右手边
      const tail = main.length ? rs.slice(main[main.length - 1] + 1) : rs
      let where = "附近"
      if (tail.length && main.length) {
        const side = turn(rs[main[main.length - 1]].u, tail[0].u)
        where = { 左转: "左手边", 右转: "右手边" }[side] || "正前方"
      }
      const tailAt = tail.length ? tail[0].i0 : leg.i1
      if (i === L.length - 1) {
        steps.push({
          kind: "end",
          floor: leg.floor,
          text: `到达 ${fmtPlace(end)}，在${where}`,
          at: tailAt
        })
      } else {
        steps.push({
          kind: "hint",
          floor: leg.floor,
          text: `${L[i + 1].name}在${where}`,
          at: tailAt
        })
      }
      i += 1
    } else {
      const f0 = leg.f0
      let f1 = leg.f1
      let j = i
      // 同一部楼梯连爬两层是两条边，合成一段
      while (
        j + 1 < L.length &&
        L[j + 1].kind === leg.kind &&
        L[j + 1].conn === leg.conn
      ) {
        f1 = L[j + 1].f1
        j += 1
      }
      // 连续两段扶梯（中间只走几步）合成一句
      while (
        leg.kind === "escalator" &&
        j + 2 < L.length &&
        L[j + 1].kind === "walk" &&
        walkLen(G, L[j + 1]) < 10 &&
        L[j + 2].kind === "escalator"
      ) {
        f1 = L[j + 2].f1
        j += 2
      }
      const updown = f1 > f0 ? "上" : "下"
      let text
      if (leg.kind === "elevator") text = `乘 ${leg.name}到 ${FLOORS[f1]}`
      else if (leg.kind === "escalator") {
        const via = j > i ? `（到 ${FLOORS[L[i].f1]} 后掉头换乘）` : ""
        text = `乘中庭扶梯${updown}到 ${FLOORS[f1]}${via}`
      } else text = `走${leg.name}${updown}到 ${FLOORS[f1]}`
      steps.push({ kind: leg.kind, floor: f0, text, to: f1, at: leg.i0 })
      i = j + 1
    }
  }
  return steps
}

/** 按楼层拆出路线折线：[{ floor, pts: [[x, y], …] }]，换层处断开 */
export function routePolylines(G, path) {
  return legs(G, path)
    .filter((l) => l.kind === "walk")
    .map((l) => ({
      floor: l.floor,
      pts: l.nodes.map((n) => [G.nodes[n].x, G.nodes[n].y])
    }))
}

export function totalLength(G, path) {
  return legs(G, path)
    .filter((l) => l.kind === "walk")
    .reduce((s, l) => s + walkLen(G, l), 0)
}

/** 一次完整的路线规划：路径、耗时、分步、汇总 */
export function planRoute(G, fromNode, toNode, mode = "recommend") {
  const { path, cost } = shortest(G, fromNode, toNode, mode)
  if (!path) return null
  const placeByNode = Object.fromEntries(PLACES.map((p) => [p.node, p]))
  const L = legs(G, path)
  return {
    path,
    cost,
    mode,
    legs: L,
    steps: describe(G, path, placeByNode),
    length: totalLength(G, path),
    escalators: L.filter((l) => l.kind === "escalator").length,
    elevators: L.filter((l) => l.kind === "elevator").length,
    stairs: L.filter((l) => l.kind === "stair").length
  }
}

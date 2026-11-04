/**
 * 总览底图层：设计稿那张 AI 场景图做底，实时叠加卡车、预警、选中等（无 Vue 依赖）。
 * ----------------------------------------------------------
 * 为什么：实时三维拔不到设计稿的质感（独立评审三维只有 3 分上下），总览视角直接用设计稿的场景图，
 * 近景视角（车队 / 换电站 / 电铲 / 边坡 / 煤场电厂）仍是 PitScene 的实时三维，切换时淡入淡出。
 *
 * 坐标：底图和所有设备锚点、路线都在「场景图像素」（1536 × 864）里（data/plate.json，scripts/open-pit/plate.py 生成）；
 * 画布按舞台（1920 × 1080 设计稿）变换，底图按设计稿 drafts.html 里 .scene 的位置放（STAGE：左 −110、上 92、宽 1720、高 968）。
 * project() 返回窗口 CSS 像素，和三维场景的 project() 一致，标签层不用区分。
 *
 * 卡车位置沿每台电铲的路线（图里的环形台阶路，plate.py 内插出来）按仿真相位摆，规则和 trucks.js 的 _place 同源；
 * 图里原本画着的静止小卡车已在预处理时擦掉，所以屏上的卡车数量和状态都是仿真给的。
 */
import plate from "../data/plate.json"
import { PHASE, SHOVEL_STATE } from "../sim/simulator.js"
import { THEME } from "./theme.js"

const IMG_W = plate.image.w
const STAGE = plate.image.stage
const K = STAGE.w / IMG_W // 场景图像素 → 舞台像素（1.12）
const QGAP = 12 // 排队时车间距（场景图像素）
const hex = (n) => `#${n.toString(16).padStart(6, "0")}`
const rgb = (n, a) =>
  `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
const clamp = (x, a, b) => Math.min(b, Math.max(a, x))

/** 折线：弧长参数化，f ∈ [0, 1] 取点和单位切向 */
class Poly {
  constructor(pts) {
    this.pts = pts
    this.cum = [0]
    for (let i = 1; i < pts.length; i++)
      this.cum.push(
        this.cum[i - 1] +
          Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
      )
    this.len = this.cum[this.cum.length - 1] || 1
  }
  at(f, out) {
    const d = clamp(f, 0, 1) * this.len
    let lo = 0
    let hi = this.pts.length - 1
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1
      if (this.cum[m] <= d) lo = m
      else hi = m
    }
    const a = this.pts[lo]
    const b = this.pts[hi]
    const seg = this.cum[hi] - this.cum[lo] || 1
    const t = (d - this.cum[lo]) / seg
    out.x = a[0] + (b[0] - a[0]) * t
    out.y = a[1] + (b[1] - a[1]) * t
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    out.tx = (b[0] - a[0]) / l
    out.ty = (b[1] - a[1]) / l
    return out
  }
}

export class PlateLayer {
  /**
   * @param {HTMLCanvasElement} canvas 铺满窗口的 2D 画布（在三维画布下面）
   * @param {object} o
   * @param {() => {x:number,y:number,w:number,h:number}} o.stageBox 舞台在窗口里的矩形
   * @param {object} o.simRoutes 仿真各编组的运距 { "FL-A": { haul, swapM, kind }, ... }
   * @param {Array<{id:string}>} o.trucks 卡车清单（layout.json）
   */
  constructor(canvas, { stageBox, simRoutes, trucks }) {
    this.canvas = canvas
    this.ctx = canvas.getContext("2d")
    this.stageBox = stageBox
    this.simRoutes = simRoutes
    this.trucks = trucks
    this.routes = Object.fromEntries(
      Object.entries(plate.routes).map(([k, v]) => [k, new Poly(v)])
    )
    this.belt = new Poly(plate.belt)
    this.anchors = plate.anchors
    this.index = new Map(trucks.map((t, i) => [t.id, i]))
    this.pos = new Map() // 卡车编号 → 当前场景图坐标 {x, y}
    this.selected = null
    this.img = null
    this._tmp = {}
    this._tmp2 = {}
  }

  /** 加载底图；失败时抛错，由调用方决定是否退回纯三维 */
  load(base) {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        this.img = img
        resolve()
      }
      img.onerror = () => reject(new Error("总览底图加载失败"))
      img.src = `${base}open-pit/overview.webp`
    })
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.round(this.canvas.clientWidth * dpr)
    const h = Math.round(this.canvas.clientHeight * dpr)
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.dpr = dpr
  }

  select(id) {
    this.selected = id
  }

  // ================================================================ 坐标

  /** 场景图像素 → 窗口 CSS 像素 */
  _css(ix, iy) {
    const b = this.stageBox()
    const u = b.w / 1920
    return {
      x: b.x + (STAGE.x + ix * K) * u,
      y: b.y + (STAGE.y + iy * K) * u
    }
  }

  /** 锚点 / 卡车的屏幕位置；找不到返回 null */
  project(id) {
    const p = id.startsWith("TK-") ? this.pos.get(id) : this.anchors[id]
    if (!p) return null
    const c = this._css(
      Array.isArray(p) ? p[0] : p.x,
      Array.isArray(p) ? p[1] : p.y
    )
    return { x: c.x, y: c.y, visible: true }
  }

  /** 点选：卡车优先，其次设备锚点，34 CSS 像素内最近的 */
  pick(cx, cy) {
    let best = null
    let bd = 30
    const test = (id, ix, iy) => {
      const c = this._css(ix, iy)
      const d = Math.hypot(c.x - cx, c.y - cy)
      if (d < bd) {
        bd = d
        best = id
      }
    }
    for (const [id, p] of this.pos) test(id, p.x, p.y)
    for (const [id, p] of Object.entries(this.anchors)) {
      if (/^(BC|DP|PV|OF|WT)/.test(id)) continue
      test(id, p[0], p[1])
    }
    return best
  }

  // ================================================================ 卡车摆位

  /** 某辆车在当前仿真状态下的位置与朝向（场景图坐标）：规则和 trucks.js 的 _place 对应 */
  _place(t, s, out) {
    const R = this.routes[t.loader] || this.routes["ES-01"]
    const sim = this.simRoutes[t.route] || this.simRoutes["FL-A"]
    const H = sim.haul
    const len = R.len
    const qpos = Math.max(1, t.qpos || 1)
    out.moving = false
    out.dir = 1
    out.f = 0
    out.lit = true
    switch (t.phase) {
      case PHASE.EMPTY:
        out.f = 1 - Math.min(1, s / H)
        out.dir = -1
        out.moving = true
        R.at(out.f, out)
        break
      case PHASE.QUEUE_LOAD:
        out.f = Math.min(1, (qpos * QGAP) / len + 0.004)
        out.dir = -1
        R.at(out.f, out)
        break
      case PHASE.LOAD:
        out.f = 0.006
        R.at(out.f, out)
        out.x += out.ty * 7 // 靠在电铲侧面
        out.y -= out.tx * 7
        break
      case PHASE.HAUL:
        out.f = Math.min(1, s / H)
        out.moving = true
        R.at(out.f, out)
        break
      case PHASE.QUEUE_UNLOAD:
        out.f = Math.max(0, 1 - (qpos * QGAP) / len)
        R.at(out.f, out)
        break
      case PHASE.UNLOAD:
        out.f = 1
        R.at(out.f, out)
        break
      case PHASE.TO_SWAP: {
        R.at(1, out)
        const st = this._station(t)
        const k = Math.min(1, s / sim.swapM)
        const dx = st[0] - out.x
        const dy = st[1] + 14 - out.y
        const l = Math.hypot(dx, dy) || 1
        out.x += dx * k
        out.y += dy * k
        out.tx = dx / l
        out.ty = dy / l
        out.moving = true
        out.f = 1
        break
      }
      case PHASE.QUEUE_SWAP: {
        const st = this._station(t)
        out.x = st[0] - 16 * qpos - 36
        out.y = st[1] + 22
        out.tx = 1
        out.ty = 0
        break
      }
      case PHASE.SWAP: {
        const st = this._station(t)
        out.x = st[0] - 22 + (this._hash(t.id) % 3) * 22
        out.y = st[1] + 8
        out.tx = 0
        out.ty = 1
        out.lit = false
        break
      }
      case PHASE.IDLE: {
        // 待命区：两座换电站之间的空地，成排停着
        const k = this.index.get(t.id)
        out.x = 462 + (k % 9) * 16
        out.y = 716 + Math.floor(k / 9) * 11
        out.tx = 1
        out.ty = 0
        out.lit = false
        break
      }
      case PHASE.FAULT: {
        const spot = plate.faultSpot[t.id]
        if (spot) {
          out.x = spot[0]
          out.y = spot[1]
          out.tx = 1
          out.ty = 0
        } else {
          const u = Math.min(1, s / H)
          out.f = t.resume === PHASE.HAUL ? u : 1 - u
          R.at(out.f, out)
        }
        out.lit = false
        break
      }
      default:
        R.at(0, out)
    }
    return out
  }

  _station(t) {
    return plate.swap[this._hash(t.id) & 1 ? "SW-02" : "SW-01"]
  }

  _hash(id) {
    let h = 0
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
    return Math.abs(h)
  }

  // ================================================================ 绘制

  /**
   * 每帧绘制。
   * @param {number} time 场景累计秒数
   * @param {object} ctxState { state, prev, prevById, stateWall, monitors }
   */
  draw(time, { state, prev, prevById, stateWall, monitors }) {
    const ctx = this.ctx
    if (!this.img) return
    this.resize()
    const b = this.stageBox()
    const u = b.w / 1920
    const dpr = this.dpr
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = hex(THEME.bg)
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    // 舞台坐标
    ctx.setTransform(dpr * u, 0, 0, dpr * u, dpr * b.x, dpr * b.y)
    ctx.drawImage(this.img, STAGE.x, STAGE.y, STAGE.w, STAGE.h)
    // 之后都在场景图像素里画
    ctx.translate(STAGE.x, STAGE.y)
    ctx.scale(K, K)

    this._heat(time, monitors)
    this._belt(time)
    if (state) {
      this._shovelsAndStations(time, state)
      this._trucks(time, state, prev, prevById, stateWall)
    }
    this._radars(time, monitors)
    this._selection(time)
  }

  /** 边坡预警热区：红橙渐变椭圆，随时间脉动（设计稿 .heat） */
  _heat(time, monitors) {
    const bad = monitors?.radar?.filter((r) => r.level >= 2) ?? []
    if (!bad.length) return
    const ctx = this.ctx
    const pulse = 0.82 + 0.18 * Math.sin(time * 3.2)
    for (const r of bad) {
      const [hx, hy] =
        r.id === "SR-02"
          ? plate.heat
          : this._towardPit(this.anchors[r.id] ?? [790, 300], 90)
      ctx.save()
      ctx.translate(hx, hy)
      ctx.scale(1, 0.33)
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 152)
      g.addColorStop(0, `rgba(244,63,94,${0.55 * pulse})`)
      g.addColorStop(0.55, `rgba(251,146,60,${0.32 * pulse})`)
      g.addColorStop(1, "rgba(251,146,60,0)")
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(0, 0, 152, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  _towardPit(p, d) {
    const dx = 790 - p[0]
    const dy = 450 - p[1]
    const l = Math.hypot(dx, dy) || 1
    return [p[0] + (dx / l) * d, p[1] + (dy / l) * d]
  }

  /** 输煤走廊：沿廊道向煤场流动的亮点 */
  _belt(time) {
    const ctx = this.ctx
    const period = 64
    const off = (time * 38) % period
    ctx.save()
    ctx.globalCompositeOperation = "lighter"
    ctx.lineCap = "round"
    ctx.lineWidth = 2.2
    ctx.strokeStyle = rgb(THEME.cyan, 0.85)
    const p = this._tmp
    const q = this._tmp2
    for (let d = off; d < this.belt.len; d += period) {
      this.belt.at(d / this.belt.len, p)
      this.belt.at(Math.min(1, (d + 14) / this.belt.len), q)
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(q.x, q.y)
      ctx.stroke()
    }
    ctx.restore()
  }

  /** 电铲脚下的工作灯、换电站工位灯 */
  _shovelsAndStations(time, st) {
    const ctx = this.ctx
    ctx.save()
    ctx.globalCompositeOperation = "lighter"
    st.shovels.forEach((s, i) => {
      const a = this.anchors[s.id]
      if (!a) return
      const working = SHOVEL_STATE[s.state] === "装车中"
      const k = working ? 0.26 + 0.08 * Math.sin(time * 2.4 + i) : 0.08
      const g = ctx.createRadialGradient(a[0], a[1] + 6, 0, a[0], a[1] + 6, 30)
      g.addColorStop(0, `rgba(255,176,64,${k})`)
      g.addColorStop(1, "rgba(255,176,64,0)")
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(a[0], a[1] + 6, 30, 0, Math.PI * 2)
      ctx.fill()
    })
    ;["SW-01", "SW-02"].forEach((id, i) => {
      const a = plate.swap[id]
      const busy = st.stations[i]?.busy ?? 0
      for (let bay = 0; bay < 3; bay++) {
        const on = bay < busy
        const x = a[0] - 22 + bay * 22
        const y = a[1] + 6
        const g = ctx.createRadialGradient(x, y, 0, x, y, 11)
        g.addColorStop(0, `rgba(120,230,255,${on ? 0.8 : 0.12})`)
        g.addColorStop(1, "rgba(120,230,255,0)")
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(x, y, 11, 0, Math.PI * 2)
        ctx.fill()
      }
    })
    ctx.restore()
  }

  /** 100 台卡车：白色小车体 + 状态色条 + 车灯 + 行驶中的尾迹；按 y 排序，近的盖住远的 */
  _trucks(time, cur, prev, prevById, stateWall) {
    const dt = (performance.now() - stateWall) / 1000
    const span = prev ? Math.max(0.001, (cur.t - prev.t) / 1000) : 1
    const items = []
    for (let i = 0; i < cur.trucks.length; i++) {
      const t = cur.trucks[i]
      let s = t.s
      const p = prevById?.get(t.id)
      if (
        p &&
        p.phase === t.phase &&
        [PHASE.EMPTY, PHASE.HAUL, PHASE.TO_SWAP].includes(t.phase) &&
        span > 0
      )
        s += ((t.s - p.s) / span) * Math.min(dt, 1.2)
      const out = this._place(t, s, {})
      let pos = this.pos.get(t.id)
      if (!pos) this.pos.set(t.id, (pos = { x: 0, y: 0 }))
      pos.x = out.x
      pos.y = out.y
      items.push({ t, out })
    }
    items.sort((a, b) => a.out.y - b.out.y)
    for (const { t, out } of items) this._truck(t, out)
  }

  _truck(t, out) {
    const ctx = this.ctx
    const R = this.routes[t.loader] || this.routes["ES-01"]
    const k = 0.6 + 0.4 * (out.y / 864) // 远小近大
    const fault = t.phase === PHASE.FAULT
    const idle = t.phase === PHASE.IDLE
    const gc = THEME.truckGroup[t.group]
    const hx = out.dir === -1 ? -out.tx : out.tx
    const hy = out.dir === -1 ? -out.ty : out.ty
    const ang = Math.atan2(hy, hx)

    // 尾迹：只给在路上跑的车，沿路线向后取一小段
    if (out.moving && t.phase !== PHASE.TO_SWAP) {
      const back = 18 * k
      const f2 = out.dir === 1 ? out.f - back / R.len : out.f + back / R.len
      R.at(f2, this._tmp2)
      const g = ctx.createLinearGradient(
        out.x,
        out.y,
        this._tmp2.x,
        this._tmp2.y
      )
      g.addColorStop(0, rgb(gc, 0.4))
      g.addColorStop(1, rgb(gc, 0))
      ctx.strokeStyle = g
      ctx.lineWidth = 1.3 * k
      ctx.lineCap = "round"
      ctx.beginPath()
      ctx.moveTo(out.x, out.y)
      ctx.lineTo(this._tmp2.x, this._tmp2.y)
      ctx.stroke()
    }

    ctx.save()
    ctx.translate(out.x, out.y)
    ctx.rotate(ang)
    ctx.scale(k, k)
    // 车下的柔光（状态色）
    ctx.globalCompositeOperation = "lighter"
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 8)
    glow.addColorStop(0, rgb(gc, fault ? 0 : idle ? 0.04 : 0.1))
    glow.addColorStop(1, rgb(gc, 0))
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(0, 0, 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalCompositeOperation = "source-over"
    // 车体
    ctx.fillStyle = fault ? "#fb7185" : idle ? "#6f7f8e" : "#cfe3ee"
    ctx.beginPath()
    ctx.roundRect(-4.2, -2.3, 8.4, 4.6, 1.2)
    ctx.fill()
    // 车斗里的货物：重载时一块暗金（煤）/ 暗紫（剥离）
    const loaded = t.loaded || (fault && t.resume === PHASE.HAUL)
    if (loaded) {
      ctx.fillStyle =
        this.simRoutes[t.route]?.kind === "coal" ? "#9a6d00" : "#6a55a8"
      ctx.fillRect(-3.6, -1.6, 4.2, 3.2)
    }
    // 状态色条（车头一侧）
    ctx.fillStyle = hex(gc)
    ctx.fillRect(1.8, -2.3, 2.4, 4.6)
    ctx.restore()

    // 车灯：行驶 / 排队 / 装卸时亮
    if (out.lit && !idle) {
      const lx = out.x + hx * 5 * k
      const ly = out.y + hy * 5 * k
      ctx.save()
      ctx.globalCompositeOperation = "lighter"
      const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 4 * k)
      g.addColorStop(0, "rgba(120,215,255,0.35)")
      g.addColorStop(1, "rgba(120,215,255,0)")
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(lx, ly, 4 * k, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  /** 边坡雷达：脉冲环（预警的变橙、加快）和预警雷达尖端的静态橙环 */
  _radars(time, monitors) {
    const ctx = this.ctx
    const radars = monitors?.radar ?? []
    ctx.save()
    ctx.globalCompositeOperation = "lighter"
    for (const id of ["SR-01", "SR-02", "SR-03"]) {
      const a = this.anchors[id]
      const lv = radars.find((r) => r.id === id)?.level ?? 0
      const hot = lv >= 2
      const ph = (time * (hot ? 0.55 : 0.22) + id.charCodeAt(4) * 0.31) % 1
      const col = hot ? THEME.warn : THEME.cyan
      ctx.strokeStyle = rgb(col, (1 - ph) * (hot ? 0.55 : 0.18))
      ctx.lineWidth = hot ? 1.4 : 1
      ctx.beginPath()
      ctx.arc(a[0], a[1], 14 + ph * 34, 0, Math.PI * 2)
      ctx.stroke()
      if (hot) {
        ctx.strokeStyle = rgb(THEME.warn, 0.85)
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(a[0], a[1], 17.5, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  /** 选中：光环 + 光柱 */
  _selection(time) {
    const id = this.selected
    if (!id) return
    const p = id.startsWith("TK-") ? this.pos.get(id) : this.anchors[id]
    if (!p) return
    const x = Array.isArray(p) ? p[0] : p.x
    const y = Array.isArray(p) ? p[1] : p.y
    const ctx = this.ctx
    const bad = id === "TK-037" || this._faulted(id)
    const col = bad ? THEME.fault : THEME.cyan
    const r = (bad ? 6 : 9) + 1.2 * Math.sin(time * 4)
    ctx.save()
    ctx.globalCompositeOperation = "lighter"
    ctx.strokeStyle = rgb(col, 0.9)
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  _faulted(id) {
    return this._faultSet?.has(id)
  }

  /** PitScene 每次 setState 后告诉这里哪些卡车故障（选中光环变红） */
  setFaults(set) {
    this._faultSet = set
  }

  dispose() {
    this.img = null
  }
}

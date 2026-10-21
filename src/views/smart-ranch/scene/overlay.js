/*
 * 智慧牧场 地表叠加图层（画在 Canvas 上，作为地形着色器里的贴图）
 * ----------------------------------------------------------
 * 画布和沙盘对齐：左上角 = 沙盘 (X = -L/2, Y = +W/2)，右下角 = (L/2, -W/2)，
 * 也就是从东南岸往西北看时的正视方向，画上的文字在主镜头里是正的。
 *
 *   drawOverlay：分区细线、在牧分区强调线、下一转场分区虚线、休牧斜纹、河岸保护带斜纹、
 *                单元编号与在牧分区"剩余天数"徽标
 *   drawMask：牧场范围（分区 + 保护带）白色，其余黑色；着色器用它把牧场外压暗降饱和
 */

/** 沙盘坐标 → 画布像素 */
function mapper(layout, w, h) {
  const [L, W] = layout.sandbox.size
  return (p) => [((p[0] + L / 2) / L) * w, ((W / 2 - p[1]) / W) * h]
}

function pathPoly(ctx, pts, map) {
  ctx.beginPath()
  pts.forEach((p, i) => {
    const [x, y] = map(p)
    if (i) ctx.lineTo(x, y)
    else ctx.moveTo(x, y)
  })
  ctx.closePath()
}

/** 斜纹填充图案 */
function hatch(color, gap = 14, width = 2) {
  const c = document.createElement("canvas")
  c.width = c.height = gap
  const g = c.getContext("2d")
  g.strokeStyle = color
  g.lineWidth = width
  g.beginPath()
  // 两段对角线，平铺后接成连续斜纹
  g.moveTo(-1, gap + 1)
  g.lineTo(gap + 1, -1)
  g.moveTo(-1, 1)
  g.lineTo(1, -1)
  g.moveTo(gap - 1, gap + 1)
  g.lineTo(gap + 1, gap - 1)
  g.stroke()
  return c
}

/**
 * 叠加图层。state 是 simulator.at() 的结果；opts.size 为画布宽（高按沙盘比例）
 * opts.font 为文字字体；opts.alarmPaddock 为告警所在分区（加粗描红）
 */
export function drawOverlay(layout, state, theme, opts = {}) {
  const [L, W] = layout.sandbox.size
  const w = opts.size || 2400
  const h = Math.round((w * W) / L)
  const canvas = opts.canvas || document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  ctx.clearRect(0, 0, w, h)
  const map = mapper(layout, w, h)
  const px = w / L // 每米多少像素
  const st = new Map(state.paddocks.map((p) => [p.id, p]))
  const lines = theme.lines
  // 近景（镜头拉到 6 km 以内）：围栏线细一半，不画斜纹和大字，免得拉近后又粗又挡画面
  const near = !!opts.near
  const lw = near ? 0.45 : 1
  const font = opts.font || '"Source Han Sans CN", "PingFang SC", sans-serif'

  // 河岸保护带：斜纹 + 描边
  const rbPattern = ctx.createPattern(hatch(lines.reserve, 16, 2.5), "repeat")
  for (const poly of layout.reserve.polygons) {
    pathPoly(ctx, poly, map)
    if (!near) {
      ctx.fillStyle = rbPattern
      ctx.fill()
    }
    ctx.strokeStyle = lines.reserve
    ctx.lineWidth = 2 * lw
    ctx.stroke()
  }

  // 轮牧状态图层：按状态整块着色（放牧中 / 休牧恢复 / 待牧）
  if (opts.layer === "rotation") {
    const fill = {
      grazing: lines.grazing,
      resting: "#c4d3c6",
      ready: "#2f8f4e"
    }
    for (const p of layout.paddocks) {
      const s = st.get(p.id)
      pathPoly(ctx, p.polygon, map)
      ctx.globalAlpha = s?.status === "resting" ? 0.45 : 0.5
      ctx.fillStyle = fill[s?.status] || "#c4d3c6"
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }

  // 放牧热力图层：今天各畜群轨迹点的高斯光斑叠加（停留越久越热）
  if (opts.layer === "heat" && opts.heat?.length) {
    const r = 260 * px
    ctx.globalCompositeOperation = "lighter"
    for (const [X, Y, wgt] of opts.heat) {
      const [x, y] = map([X, Y])
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, `rgba(255,120,40,${0.1 * (wgt || 1)})`)
      g.addColorStop(1, "rgba(255,120,40,0)")
      ctx.fillStyle = g
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
    ctx.globalCompositeOperation = "source-over"
  }

  // 休牧分区：浅斜纹
  const restPattern = ctx.createPattern(hatch(lines.hatch, 22, 2), "repeat")
  for (const p of layout.paddocks) {
    const s = st.get(p.id)
    if (near || s?.status !== "resting") continue
    pathPoly(ctx, p.polygon, map)
    ctx.fillStyle = restPattern
    ctx.fill()
  }

  // 设备图层：中继基站覆盖范围（虚线圈）
  if (opts.stations) {
    ctx.setLineDash([18, 14])
    for (const b of layout.stations) {
      const [x, y] = map(b.pos)
      ctx.beginPath()
      ctx.arc(x, y, b.range * px * 0.6, 0, Math.PI * 2)
      ctx.strokeStyle = "rgba(138,92,214,0.6)"
      ctx.lineWidth = 3
      ctx.stroke()
    }
    ctx.setLineDash([])
  }

  // 营地、场部、饮水点周围被踩实的土地（画在地表上才能贴着起伏的地形；半径按放大后的设施估）
  const dirt = (pos, r, a) => {
    const [x, y] = map(pos)
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * px)
    g.addColorStop(0, `rgba(150,128,92,${a})`)
    g.addColorStop(0.7, `rgba(150,128,92,${a * 0.6})`)
    g.addColorStop(1, "rgba(150,128,92,0)")
    ctx.fillStyle = g
    ctx.fillRect(x - r * px, y - r * px, r * px * 2, r * px * 2)
  }
  for (const w of layout.water) dirt(w.pos, 45, 0.75)
  for (const h of layout.homesteads) dirt(h.pos, 90, 0.7)
  dirt(layout.hq.pos, 170, 0.75)

  // 所有分区：细线（围栏）
  ctx.lineJoin = "round"
  for (const p of layout.paddocks) {
    pathPoly(ctx, p.polygon, map)
    ctx.strokeStyle = lines.paddock
    ctx.lineWidth = 2.2 * lw
    ctx.stroke()
  }

  // 下一块要转去的分区：强调色虚线
  if (opts.next) {
    ctx.setLineDash([16, 12])
    for (const id of opts.next) {
      const p = layout.paddocks.find((q) => q.id === id)
      if (!p) continue
      pathPoly(ctx, p.polygon, map)
      ctx.strokeStyle = lines.next
      ctx.lineWidth = 4
      ctx.stroke()
    }
    ctx.setLineDash([])
  }

  // 在牧分区：强调色粗线 + 很淡的填充
  for (const p of layout.paddocks) {
    if (st.get(p.id)?.status !== "grazing") continue
    pathPoly(ctx, p.polygon, map)
    ctx.globalAlpha = 0.12
    ctx.fillStyle = lines.grazing
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = lines.grazing
    ctx.lineWidth = 5 * lw
    ctx.stroke()
  }

  // 选中的分区：强调色加粗 + 淡填充
  if (opts.highlight) {
    const p = layout.paddocks.find((q) => q.id === opts.highlight)
    if (p) {
      pathPoly(ctx, p.polygon, map)
      ctx.globalAlpha = 0.18
      ctx.fillStyle = lines.next
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.strokeStyle = "#ffffff"
      ctx.lineWidth = 9 * lw
      ctx.stroke()
      ctx.strokeStyle = lines.next
      ctx.lineWidth = 5 * lw
      ctx.stroke()
    }
  }

  // 告警所在分区：告警色粗线
  if (opts.alarmPaddock) {
    const p = layout.paddocks.find((q) => q.id === opts.alarmPaddock)
    if (p) {
      pathPoly(ctx, p.polygon, map)
      ctx.strokeStyle = theme.alarm
      ctx.lineWidth = 5
      ctx.stroke()
    }
  }

  // 文字：单元编号（画在单元外侧两块分区之间，避开饮水点）
  const text = (str, x, y, size, color, weight = 700) => {
    ctx.font = `${weight} ${size}px ${font}`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.lineWidth = Math.max(3, size / 7)
    ctx.strokeStyle = lines.textShadow
    ctx.strokeText(str, x, y)
    ctx.fillStyle = color
    ctx.fillText(str, x, y)
  }
  if (opts.unitLabels !== false && !near) {
    for (const u of layout.units) {
      const outer = layout.paddocks.filter(
        (p) => p.unit === u.id && /-(3|4)$/.test(p.id)
      )
      const cx = (outer[0].center[0] + outer[1].center[0]) / 2
      const cy = (outer[0].center[1] + outer[1].center[1]) / 2
      const [x, y] = map([cx, cy])
      text(u.id, x, y, Math.round(260 * px), lines.text)
    }
  }
  // 在牧分区的剩余可牧天数
  if (opts.remainBadges !== false && !near) {
    for (const s of state.paddocks) {
      if (s.status !== "grazing") continue
      const p = layout.paddocks.find((q) => q.id === s.id)
      const [x, y] = map(p.center)
      text(
        `剩 ${s.remainDays.toFixed(1)} 天`,
        x,
        y + 200 * px,
        Math.round(150 * px),
        lines.text,
        600
      )
    }
  }
  return canvas
}

/** 牧场范围掩膜（分区 + 保护带），着色器用来区分牧场内外 */
export function drawMask(layout, size = 1200) {
  const [L, W] = layout.sandbox.size
  const w = size
  const h = Math.round((w * W) / L)
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#000"
  ctx.fillRect(0, 0, w, h)
  const map = mapper(layout, w, h)
  ctx.fillStyle = "#fff"
  for (const p of layout.paddocks) {
    pathPoly(ctx, p.polygon, map)
    ctx.fill()
  }
  for (const poly of layout.reserve.polygons) {
    pathPoly(ctx, poly, map)
    ctx.fill()
  }
  // 分区之间的围栏缝补上，再羽化一点边缘
  ctx.filter = "blur(2px)"
  ctx.drawImage(canvas, 0, 0)
  ctx.filter = "none"
  return canvas
}

/*
 * 智慧充电站 画布贴图
 * ----------------------------------------------------------
 * 桩顶悬浮图标（闪电 / 叹号 / 叉）、地面光晕、流光条纹，全部用 Canvas 现画，不依赖图片素材。
 */
import * as THREE from "three"

const cache = new Map()

function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  draw(c.getContext("2d"), w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

const hex = (c) => `#${c.toString(16).padStart(6, "0")}`

/**
 * 桩顶状态徽标：深色圆底 + 状态色描边 + 图形。
 * glyph：bolt 闪电（充电中 / 空闲）、warn 叹号（故障）、off 叉（离线）
 */
export function badgeTexture(color, glyph) {
  const key = `${color}-${glyph}`
  if (cache.has(key)) return cache.get(key)
  const t = canvasTexture(128, 128, (g) => {
    const c = hex(color)
    g.beginPath()
    g.arc(64, 64, 50, 0, Math.PI * 2)
    g.fillStyle = "rgba(4,16,30,.92)"
    g.fill()
    g.lineWidth = 8
    g.strokeStyle = c
    g.shadowColor = c
    g.shadowBlur = 16
    g.stroke()
    g.shadowBlur = 8
    g.fillStyle = c
    g.strokeStyle = c
    if (glyph === "bolt") {
      g.beginPath()
      g.moveTo(70, 26)
      g.lineTo(42, 70)
      g.lineTo(62, 70)
      g.lineTo(56, 102)
      g.lineTo(86, 56)
      g.lineTo(66, 56)
      g.closePath()
      g.fill()
    } else if (glyph === "warn") {
      g.beginPath()
      g.moveTo(64, 30)
      g.lineTo(96, 92)
      g.lineTo(32, 92)
      g.closePath()
      g.fill()
      g.fillStyle = "#1a0306"
      g.fillRect(60, 50, 8, 24)
      g.fillRect(60, 79, 8, 8)
    } else {
      g.lineWidth = 9
      g.lineCap = "round"
      g.beginPath()
      g.moveTo(46, 46)
      g.lineTo(82, 82)
      g.moveTo(82, 46)
      g.lineTo(46, 82)
      g.stroke()
    }
  })
  cache.set(key, t)
  return t
}

/** 径向光晕（沙盘下方的蓝色光、告警波纹的填充） */
export function glowTexture(rgb = "40,150,240") {
  const key = `glow-${rgb}`
  if (cache.has(key)) return cache.get(key)
  const t = canvasTexture(256, 256, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
    grd.addColorStop(0, `rgba(${rgb},0.75)`)
    grd.addColorStop(0.45, `rgba(${rgb},0.28)`)
    grd.addColorStop(1, `rgba(${rgb},0)`)
    g.fillStyle = grd
    g.fillRect(0, 0, w, h)
  })
  cache.set(key, t)
  return t
}

/** 渐隐条：v=0 处不透明、向 v=1 二次衰减到透明（沙盘侧壁泛光、地面轮廓光晕用） */
export function fadeTexture() {
  if (cache.has("fade")) return cache.get("fade")
  const t = canvasTexture(4, 128, (g, w, h) => {
    // 画布 y 向下，而纹理 v=0 在底部：从画布底部（v=0）往上渐隐
    const grd = g.createLinearGradient(0, h, 0, 0)
    grd.addColorStop(0, "rgba(255,255,255,1)")
    grd.addColorStop(0.25, "rgba(255,255,255,0.45)")
    grd.addColorStop(0.6, "rgba(255,255,255,0.12)")
    grd.addColorStop(1, "rgba(255,255,255,0)")
    g.fillStyle = grd
    g.fillRect(0, 0, w, h)
  })
  cache.set("fade", t)
  return t
}

/** 流光条纹：沿 u 方向重复的亮段，贴在地面能量流线上，滚动 offset 形成流动 */
export function flowTexture() {
  if (cache.has("flow")) return cache.get("flow")
  const t = canvasTexture(256, 16, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, 0)
    grd.addColorStop(0, "rgba(255,255,255,0)")
    grd.addColorStop(0.55, "rgba(255,255,255,0.25)")
    grd.addColorStop(0.9, "rgba(255,255,255,1)")
    grd.addColorStop(1, "rgba(255,255,255,0)")
    g.fillStyle = grd
    g.fillRect(0, 0, w, h)
  })
  t.wrapS = THREE.RepeatWrapping
  t.colorSpace = THREE.NoColorSpace
  cache.set("flow", t)
  return t
}

export function disposeTextures() {
  for (const t of cache.values()) t.dispose()
  cache.clear()
}

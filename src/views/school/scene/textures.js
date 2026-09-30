/*
 * 程序化贴图
 * ----------------------------------------------------------
 * 所有贴图用 Canvas 现画，不依赖任何外部图片素材：
 *  - 包体不增加，无需维护图片资源；
 *  - 配色集中在本文件，调色只改这里。
 * 配色取自学校实拍照片：砖红 #A6503C、线脚白 #F7F3EC。
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three"

/** 建一张指定尺寸的离屏 canvas */
function createCanvas(w, h) {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  return c
}

/** canvas 转 three 贴图，并设置重复次数 */
function toTexture(canvas, repeatX, repeatY) {
  const t = new CanvasTexture(canvas)
  t.wrapS = RepeatWrapping
  t.wrapT = RepeatWrapping
  t.repeat.set(repeatX, repeatY)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 4
  return t
}

/** 画一片清水红砖底：砖缝 + 砖面深浅，供立面与拱廊共用 */
function paintBrick(g, w, h) {
  g.fillStyle = "#A6503C"
  g.fillRect(0, 0, w, h)

  // 砖缝：横缝每 5px 一道，竖缝逐行错缝
  g.strokeStyle = "rgba(0,0,0,.09)"
  g.lineWidth = 1
  for (let y = 0; y < h; y += 5) {
    g.beginPath()
    g.moveTo(0, y + 0.5)
    g.lineTo(w, y + 0.5)
    g.stroke()
    const offset = (y / 5) % 2 ? 0 : 10
    for (let x = offset; x < w; x += 20) {
      g.beginPath()
      g.moveTo(x + 0.5, y)
      g.lineTo(x + 0.5, y + 5)
      g.stroke()
    }
  }

  // 砖面随机深浅，避免整面纯色的塑料感
  const cols = Math.ceil(w / 20)
  const rows = Math.ceil(h / 5)
  for (let i = 0; i < cols * rows * 2; i++) {
    const tint = Math.random() > 0.5 ? "255,255,255," : "0,0,0,"
    g.fillStyle = `rgba(${tint}${(Math.random() * 0.05).toFixed(3)})`
    g.fillRect(
      Math.floor(Math.random() * cols) * 20,
      Math.floor(Math.random() * rows) * 5,
      20,
      5
    )
  }
}

/**
 * 建筑立面：一张贴图 = 一个开间（约 3m 宽 × 一层楼高），
 * 含红砖底纹 + 白色拱窗套 + 楼层腰线。按楼宽与层数重复平铺。
 */
function buildFacadeCanvas() {
  const c = createCanvas(140, 120)
  const g = c.getContext("2d")
  paintBrick(g, 140, 120)

  // 白色窗套（下方矩形 + 上方半圆拱）
  const wx = 44
  const ww = 52
  const wy = 26
  const wh = 66
  const r = ww / 2
  g.fillStyle = "#F7F3EC"
  g.beginPath()
  g.moveTo(wx - 5, wy + wh + 5)
  g.lineTo(wx - 5, wy + r)
  g.arc(wx + r, wy + r, r + 5, Math.PI, 0)
  g.lineTo(wx + ww + 5, wy + wh + 5)
  g.closePath()
  g.fill()

  // 玻璃
  g.fillStyle = "#4A5A66"
  g.beginPath()
  g.moveTo(wx, wy + wh)
  g.lineTo(wx, wy + r)
  g.arc(wx + r, wy + r, r, Math.PI, 0)
  g.lineTo(wx + ww, wy + wh)
  g.closePath()
  g.fill()

  // 窗格
  g.strokeStyle = "#F7F3EC"
  g.lineWidth = 3
  g.beginPath()
  g.moveTo(wx + r, wy)
  g.lineTo(wx + r, wy + wh)
  g.stroke()
  g.beginPath()
  g.moveTo(wx, wy + r + 14)
  g.lineTo(wx + ww, wy + r + 14)
  g.stroke()

  // 楼层腰线
  g.fillStyle = "#EDE6DA"
  g.fillRect(0, 112, 140, 8)

  return c
}

/** 画一片粗琢石材：错缝砌块 + 逐块色差，用于首层拱廊 */
function paintStone(g, w, h) {
  g.fillStyle = "#9E9789"
  g.fillRect(0, 0, w, h)

  const course = 13 // 每皮石材高度
  const block = 30 // 每块石材长度
  for (let y = 0; y < h; y += course) {
    const row = Math.floor(y / course)
    const offset = row % 2 ? -block / 2 : 0
    for (let x = offset; x < w; x += block) {
      // 由行列推出的伪随机色差，保证每次生成一致
      const shade = 150 + ((row * 29 + Math.round(x) * 17) % 26)
      g.fillStyle = `rgb(${shade}, ${shade - 5}, ${shade - 18})`
      g.fillRect(x + 1, y + 1, block - 2, course - 2)
    }
  }
  // 砌缝整体压暗一点，避免石面发平
  g.fillStyle = "rgba(60,54,46,.12)"
  g.fillRect(0, 0, w, h)
}

/**
 * 首层拱廊：一张贴图 = 一个开间。
 * 教学楼底层是灰色粗琢石材砌的连续拱廊（过道），与上部红砖形成对比，
 * 见校园内庭实拍照片。洞口内部用自上而下变亮的渐变模拟进深。
 */
function buildArcadeCanvas() {
  const c = createCanvas(140, 120)
  const g = c.getContext("2d")
  paintStone(g, 140, 120)

  const left = 37
  const right = 103
  const radius = (right - left) / 2
  const spring = 62 // 起拱点（canvas 向下为正）
  const ring = 8 // 拱圈券石厚度

  // 拱圈券石：比石墙略亮，勾出拱形轮廓
  g.fillStyle = "#B3AC9C"
  g.beginPath()
  g.moveTo(left - ring, 120)
  g.lineTo(left - ring, spring)
  g.arc(left + radius, spring, radius + ring, Math.PI, 0)
  g.lineTo(right + ring, 120)
  g.closePath()
  g.fill()
  // 券石之间的径向缝
  g.strokeStyle = "rgba(60,54,46,.3)"
  g.lineWidth = 1.2
  for (let i = 0; i <= 7; i++) {
    const t = Math.PI + (Math.PI * i) / 7
    const cx = left + radius
    g.beginPath()
    g.moveTo(cx + Math.cos(t) * radius, spring + Math.sin(t) * radius)
    g.lineTo(
      cx + Math.cos(t) * (radius + ring),
      spring + Math.sin(t) * (radius + ring)
    )
    g.stroke()
  }

  // 过道内部
  const depth = g.createLinearGradient(0, spring - radius, 0, 120)
  depth.addColorStop(0, "#191512")
  depth.addColorStop(1, "#3E352E")
  g.fillStyle = depth
  g.beginPath()
  g.moveTo(left, 120)
  g.lineTo(left, spring)
  g.arc(left + radius, spring, radius, Math.PI, 0)
  g.lineTo(right, 120)
  g.closePath()
  g.fill()

  // 廊内地面的一道浅色反光，让过道不至于糊成一块黑
  g.fillStyle = "rgba(200,190,175,.16)"
  g.fillRect(left + 4, 112, right - left - 8, 8)

  return c
}

/**
 * 上层外廊：一张贴图 = 一间教室单元（不是一个开间）。
 *
 * 实拍照片里翼楼的临院一侧是开敞连廊：砖砌立柱之间是白色栏杆，
 * 栏杆后退进去是教室门与窗。关键是「门」的密度 ——
 * 一间教室只有一扇门，配两三扇窗；早先按每个开间放一扇门，
 * 45m 长的楼一层就排出十来个门，等于十来间教室，明显不合理。
 *
 * 因此一张贴图画满一间教室：三个开间（三根立柱间距），
 * 第一间是教室门 + 门边亮子，后两间是教室窗。
 * 单元宽约 11m，贴图按「每层教室数」重复，上限 4 间。
 */
function buildCorridorCanvas() {
  const W = 360
  const H = 120
  const c = createCanvas(W, H)
  const g = c.getContext("2d")

  // 先铺砖底，立柱位置留作砖砌柱
  paintBrick(g, W, H)

  // 三个开间的水平范围（其余为砖砌立柱）
  const bays = [
    [14, 118],
    [132, 236],
    [250, 346]
  ]

  bays.forEach(([left, right]) => {
    // 廊内暗部
    const inner = g.createLinearGradient(0, 8, 0, 104)
    inner.addColorStop(0, "#241E1A")
    inner.addColorStop(1, "#453B33")
    g.fillStyle = inner
    g.fillRect(left, 6, right - left, 98)

    // 廊顶梁底的阴影
    g.fillStyle = "rgba(0,0,0,.35)"
    g.fillRect(left, 6, right - left, 5)
  })

  /* ---- 第一间：教室门 + 门边亮子 ---- */
  const doorX = bays[0][0] + 16
  g.fillStyle = "#514639"
  g.fillRect(doorX, 22, 34, 66)
  g.fillStyle = "#C9C2B2"
  g.fillRect(doorX + 3, 25, 28, 60)
  g.fillStyle = "rgba(0,0,0,.18)"
  g.fillRect(doorX + 3, 25, 28, 4)
  // 门把手
  g.fillStyle = "#6E6455"
  g.fillRect(doorX + 26, 54, 3, 6)
  // 门边亮子（小高窗）
  g.fillStyle = "#E8E1D2"
  g.fillRect(doorX + 44, 26, 34, 26)
  g.fillStyle = "#37424A"
  g.fillRect(doorX + 47, 29, 28, 20)

  /* ---- 后两间：教室窗（多格） ---- */
  ;[bays[1], bays[2]].forEach(([left, right]) => {
    const wx = left + 12
    const ww = right - left - 24
    g.fillStyle = "#E8E1D2"
    g.fillRect(wx, 24, ww, 40)
    g.fillStyle = "#37424A"
    g.fillRect(wx + 4, 28, ww - 8, 32)
    // 竖向窗棂把窗分成三格
    g.fillStyle = "#E8E1D2"
    for (let i = 1; i < 3; i++) {
      g.fillRect(wx + 4 + ((ww - 8) * i) / 3 - 1.5, 28, 3, 32)
    }
    // 一道横向窗棂
    g.fillRect(wx + 4, 41, ww - 8, 3)
  })

  /* ---- 白色栏杆：每个开间内上下横档 + 竖向栏杆条 ---- */
  bays.forEach(([left, right]) => {
    g.fillStyle = "#F2EDE4"
    g.fillRect(left, 68, right - left, 5)
    g.fillRect(left, 96, right - left, 5)
    for (let x = left + 4; x < right - 2; x += 7) {
      g.fillRect(x, 73, 2.6, 23)
    }
  })

  /* ---- 楼板边缘：整幅贯通的白色横带，压在砖柱之前 ---- */
  g.fillStyle = "#F4EFE6"
  g.fillRect(0, 104, W, 16)
  g.fillStyle = "rgba(0,0,0,.1)"
  g.fillRect(0, 118, W, 2)

  return c
}

/** 广场铺装：米黄底 + 橘红几何花纹，对应实景中轴广场 */
function buildPavingCanvas() {
  const c = createCanvas(128, 128)
  const g = c.getContext("2d")
  g.fillStyle = "#E4D6BE"
  g.fillRect(0, 0, 128, 128)
  g.strokeStyle = "rgba(190,82,56,.30)"
  g.lineWidth = 2
  g.strokeRect(8, 8, 112, 112)
  g.beginPath()
  g.moveTo(8, 8)
  g.lineTo(120, 120)
  g.moveTo(120, 8)
  g.lineTo(8, 120)
  g.stroke()
  g.strokeStyle = "rgba(0,0,0,.07)"
  g.lineWidth = 1
  g.strokeRect(0.5, 0.5, 127, 127)
  return c
}

/** 普通草地 */
function buildGrassCanvas() {
  const c = createCanvas(64, 64)
  const g = c.getContext("2d")
  g.fillStyle = "#6F9757"
  g.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 700; i++) {
    const tint = Math.random() > 0.5 ? "255,255,255," : "0,0,0,"
    g.fillStyle = `rgba(${tint}${(Math.random() * 0.08).toFixed(3)})`
    g.fillRect(Math.random() * 64, Math.random() * 64, 2, 2)
  }
  return c
}

/** 人工草皮：深浅相间的条纹，与卫星影像上的割草条纹一致 */
function buildTurfCanvas() {
  const c = createCanvas(64, 64)
  const g = c.getContext("2d")
  g.fillStyle = "#5E8F4E"
  g.fillRect(0, 0, 64, 64)
  g.fillStyle = "#6B9C58"
  g.fillRect(0, 0, 32, 64)
  for (let i = 0; i < 500; i++) {
    g.fillStyle = `rgba(255,255,255,${(Math.random() * 0.05).toFixed(3)})`
    g.fillRect(Math.random() * 64, Math.random() * 64, 2, 2)
  }
  return c
}

/**
 * 校名牌石板：深灰绿石材拼板 + 阴刻校名，依据校名牌近照还原。
 * 底板由若干块石材拼成、缝隙可见、每块色调略有差异；
 * 文字先画一层暗色偏移再压一层亮色，模拟阴刻字口的受光。
 */
function buildSignCanvas() {
  const W = 1024
  const H = 213
  const c = createCanvas(W, H)
  const g = c.getContext("2d")

  // 石材底板与拼缝：每块石材色调略有差异
  const panels = 8
  for (let i = 0; i < panels; i++) {
    const shade = 68 + ((i * 37) % 13)
    g.fillStyle = `rgb(${shade}, ${shade + 9}, ${shade + 5})`
    g.fillRect((W / panels) * i, 0, W / panels + 1, H)
  }
  g.strokeStyle = "rgba(0,0,0,.22)"
  g.lineWidth = 1
  for (let i = 1; i < panels; i++) {
    g.beginPath()
    g.moveTo((W / panels) * i + 0.5, 0)
    g.lineTo((W / panels) * i + 0.5, H)
    g.stroke()
  }
  // 石面斑驳
  for (let i = 0; i < 900; i++) {
    const tint = Math.random() > 0.5 ? "255,255,255," : "0,0,0,"
    g.fillStyle = `rgba(${tint}${(Math.random() * 0.05).toFixed(3)})`
    g.fillRect(Math.random() * W, Math.random() * H, 3, 3)
  }

  // 白色石材外框
  g.strokeStyle = "#E9E6DE"
  g.lineWidth = 14
  g.strokeRect(7, 7, W - 14, H - 14)

  // 楷体优先，比黑体更接近牌面上的书法字
  const cnFont = '"STKaiti", "KaiTi SC", "Kaiti SC", "KaiTi", "SimSun", serif'

  /** 阴刻效果：暗色字口 + 亮色受光面 */
  const engrave = (text, font, x, y, light, align = "left") => {
    g.font = font
    g.textAlign = align
    g.textBaseline = "middle"
    g.fillStyle = "rgba(0,0,0,.45)"
    g.fillText(text, x + 2, y + 2)
    g.fillStyle = light
    g.fillText(text, x, y)
  }

  // 主名 + 分校名
  engrave("成都实验小学", `700 74px ${cnFont}`, 96, 82, "#E4EAE5")
  engrave("西区分校", `700 44px ${cnFont}`, 560, 92, "#D3DAD5")

  // 英文名
  engrave(
    "Chengdu Experimental Primary School",
    "400 30px Georgia, serif",
    98,
    152,
    "#CDD5D0"
  )
  engrave("West Campus Branch", "400 23px Georgia, serif", 620, 155, "#BFC7C2")

  // 右侧落款年月（牌面上的题写日期）
  engrave(
    "二〇〇四年二月廿八",
    `400 17px ${cnFont}`,
    W - 40,
    168,
    "#B6BEB9",
    "right"
  )

  return c
}

/* 表盘配色，取自参考照片 */
const CLOCK_DARK = "#33383C" // 铁框与石缝
const CLOCK_STONE = "#F1EDE5" // 白石
const CLOCK_RED = "#CB5033" // 数字环的砖红

/**
 * 钟楼表盘（英式塔钟样式，依据参考照片还原）：
 * 方形白石框 + 四角哥特石雕花饰 + 一圈分钟方石 + 砖红数字环，
 * 环上只写 XII / III / VI / IX 四个白色罗马数字，其余八个时位用白色长条块，
 * 中心留一块白石圆盘。
 *
 * 只画静态盘面，时针分针是真实的三维物体，由场景主循环按当前时间转动。
 */
function buildClockFaceCanvas() {
  const S = 512
  const c = createCanvas(S, S)
  const g = c.getContext("2d")
  const R = S / 2

  /* 各圈半径（像素），由外向内 */
  const RING_EDGE = R - 22 // 方石圈外侧细线
  const MINUTE_OUT = R - 34 // 分钟方石外沿
  const MINUTE_IN = R - 70 // 分钟方石内沿
  const RED_OUT = R - 82 // 红环外沿
  const RED_IN = R - 148 // 红环内沿（= 中心白盘半径）
  const MARK_MID = (RED_OUT + RED_IN) / 2 // 时标与数字所在半径

  /** 极坐标转画布坐标：角度从 12 点方向起算、顺时针为正 */
  const at = (angle, radius) => [
    R + Math.sin(angle) * radius,
    R - Math.cos(angle) * radius
  ]

  /** 画一个整圆线 */
  const ring = (radius, width) => {
    g.strokeStyle = CLOCK_DARK
    g.lineWidth = width
    g.beginPath()
    g.arc(R, R, radius, 0, Math.PI * 2)
    g.stroke()
  }

  // 白石底板
  g.fillStyle = CLOCK_STONE
  g.fillRect(0, 0, S, S)

  /* 四角哥特石雕花饰：三片圆叶围一个小圆心。
     先画花饰、后画表盘各圈，圆环自然把花饰内侧压住，与照片一致。 */
  const trefoil = (cx, cy, r) => {
    g.lineWidth = 3
    g.strokeStyle = CLOCK_DARK
    g.fillStyle = CLOCK_STONE
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 - Math.PI / 2
      g.beginPath()
      g.arc(
        cx + Math.cos(a) * r * 0.6,
        cy + Math.sin(a) * r * 0.6,
        r * 0.55,
        0,
        Math.PI * 2
      )
      g.fill()
      g.stroke()
    }
    g.beginPath()
    g.arc(cx, cy, r * 0.28, 0, Math.PI * 2)
    g.fill()
    g.stroke()
  }
  const corner = S * 0.16
  ;[
    [corner, corner],
    [S - corner, corner],
    [corner, S - corner],
    [S - corner, S - corner]
  ].forEach(([cx, cy]) => trefoil(cx, cy, S * 0.115))

  // 深色方形铁框
  g.strokeStyle = CLOCK_DARK
  g.lineWidth = 16
  g.strokeRect(8, 8, S - 16, S - 16)

  /* 分钟方石圈：白石底上打 60 条径向石缝，配合内外两道圆线就成了一圈方石 */
  g.strokeStyle = CLOCK_DARK
  g.lineWidth = 2.5
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2
    g.beginPath()
    g.moveTo(...at(a, MINUTE_IN))
    g.lineTo(...at(a, MINUTE_OUT))
    g.stroke()
  }
  ring(RING_EDGE, 2.5)
  ring(MINUTE_OUT, 3)
  ring(MINUTE_IN, 3)

  // 砖红数字环：先铺满红圆，再用白石圆盘挖出中心
  g.fillStyle = CLOCK_RED
  g.beginPath()
  g.arc(R, R, RED_OUT, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = CLOCK_STONE
  g.beginPath()
  g.arc(R, R, RED_IN, 0, Math.PI * 2)
  g.fill()
  ring(RED_OUT, 3)
  ring(RED_IN, 3)

  /* 十二个时位：正点四个写白色罗马数字，其余八个用白色长条时标。
     数字与时标都是径向摆放（字底朝盘心），所以 6 点位的 VI 是倒着的 ——
     这正是英式塔钟的排法。 */
  const numerals = { 3: "III", 6: "VI", 9: "IX", 12: "XII" }
  g.font = `700 ${Math.round(R * 0.21)}px "Times New Roman", Georgia, serif`
  g.textAlign = "center"
  g.textBaseline = "middle"
  for (let h = 1; h <= 12; h++) {
    const a = (h / 12) * Math.PI * 2
    g.save()
    g.translate(...at(a, MARK_MID))
    g.rotate(a)
    g.fillStyle = CLOCK_STONE
    if (numerals[h]) {
      g.fillText(numerals[h], 0, 0)
    } else {
      const w = R * 0.055
      const len = R * 0.2
      g.fillRect(-w / 2, -len / 2, w, len)
    }
    g.restore()
  }

  return c
}

/**
 * 水池池底马赛克：蓝色小方砖 + 浅色砖缝。
 * 水体是半透明的，透出来的蓝正是这张池底贴图 ——
 * 比直接把水染成蓝色更有层次，也更贴近实景水池的做法。
 */
function buildPoolTileCanvas() {
  const S = 128
  const c = createCanvas(S, S)
  const g = c.getContext("2d")

  // 砖缝底色
  g.fillStyle = "#C3DCE2"
  g.fillRect(0, 0, S, S)

  // 8×8 块马赛克，每块在一组蓝调里随机取色，模拟窑变的深浅不匀
  const tones = ["#2F82B6", "#3893C6", "#2A6EA1", "#4BA7D0", "#215F8B"]
  const N = 8
  const step = S / N
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      g.fillStyle = tones[Math.floor(Math.random() * tones.length)]
      g.fillRect(x * step + 1, y * step + 1, step - 2, step - 2)
      // 每块左上角压一道高光，让砖面有厚度
      g.fillStyle = "rgba(255,255,255,.10)"
      g.fillRect(x * step + 1, y * step + 1, step - 2, 2)
    }
  }
  return c
}

/* canvas 只画一次，供所有材质共享 */
const facadeCanvas = buildFacadeCanvas()
const arcadeCanvas = buildArcadeCanvas()
const corridorCanvas = buildCorridorCanvas()

export function createFacadeTexture(repeatX, repeatY) {
  return toTexture(facadeCanvas, repeatX, repeatY)
}

export function createArcadeTexture(repeatX, repeatY) {
  return toTexture(arcadeCanvas, repeatX, repeatY)
}

export function createCorridorTexture(repeatX, repeatY) {
  return toTexture(corridorCanvas, repeatX, repeatY)
}

export function createPavingTexture(repeat) {
  return toTexture(buildPavingCanvas(), repeat, repeat)
}

export function createGrassTexture(repeat) {
  return toTexture(buildGrassCanvas(), repeat, repeat)
}

export function createTurfTexture(repeatX, repeatY) {
  return toTexture(buildTurfCanvas(), repeatX, repeatY)
}

export function createSignTexture() {
  return toTexture(buildSignCanvas(), 1, 1)
}

export function createPoolTileTexture(repeat) {
  return toTexture(buildPoolTileCanvas(), repeat, repeat)
}

export function createClockFaceTexture() {
  return toTexture(buildClockFaceCanvas(), 1, 1)
}

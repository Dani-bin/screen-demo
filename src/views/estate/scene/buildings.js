/**
 * 沙盘里的楼体：16 栋住宅、小区配套、周边建筑、远处白模
 * ----------------------------------------------------------
 * 楼体是象牙白的模型体块：每个立面一张窗格贴图（颜色图 + 夜里点亮的自发光图），屋顶深灰、带设备间和女儿墙。
 * 每栋是一个 Group，名字 = 布局里的编号（B01–B16、CL01…），拾取靠 body 网格上的 userData.id。
 * 平面坐标 x 向东、y 向北；three.js 里 z = -y。
 */
import * as THREE from "three"
import { rng } from "./ground.js"

const MW = 44 // 立面一个开间的贴图宽（px）
const MH = 38 // 一层的贴图高（px）

// ---------------------------------------------------------------- 立面贴图

/**
 * 画一张立面（颜色图 + 自发光图）
 * @param {object} o cols 开间数、rows 层数、style office | glass | shop | villa、litProb 亮灯率、
 *   seed 随机种子、wall 墙色、unitCols 联排每户占几个开间
 */
function facade(o) {
  const {
    cols,
    rows,
    style = "office",
    litProb = 0.78,
    seed = 1,
    wall = "#a99878",
    unitCols = 0
  } = o
  const cv = document.createElement("canvas")
  cv.width = cols * MW
  cv.height = rows * MH
  const ce = document.createElement("canvas")
  ce.width = cv.width
  ce.height = cv.height
  const g = cv.getContext("2d")
  const e = ce.getContext("2d")
  e.fillStyle = "#000"
  e.fillRect(0, 0, ce.width, ce.height)
  // 凹凸图：中灰 = 墙面，深 = 内凹（窗），浅 = 外凸（楼板、阳台、壁柱）
  const cbmp = document.createElement("canvas")
  cbmp.width = cv.width
  cbmp.height = cv.height
  const bm = cbmp.getContext("2d")
  bm.fillStyle = "#808080"
  bm.fillRect(0, 0, cbmp.width, cbmp.height)
  // 材质图：墙面粗糙、无金属；窗玻璃光滑、半金属，环境反射里能看到窗的闪光
  const corm = document.createElement("canvas")
  corm.width = cv.width
  corm.height = cv.height
  const om = corm.getContext("2d")
  om.fillStyle = "rgb(255,222,0)"
  om.fillRect(0, 0, corm.width, corm.height)
  const rnd = rng(seed)
  for (let r = 0; r < rows; r++) {
    const f = rows - 1 - r // 0 = 首层
    const y0 = r * MH
    for (let c = 0; c < cols; c++) {
      const x0 = c * MW
      g.fillStyle = wall
      g.fillRect(x0, y0, MW, MH)
      if (style === "glass") {
        // 幕墙：整个开间都是玻璃，只留窄窄的竖框和楼板边
        const gr = g.createLinearGradient(0, y0, 0, y0 + MH)
        gr.addColorStop(0, "#8fb0b8")
        gr.addColorStop(1, "#4c6c76")
        g.fillStyle = gr
        g.fillRect(x0 + 2, y0 + 3, MW - 4, MH - 7)
        bm.fillStyle = "#585858"
        bm.fillRect(x0 + 2, y0 + 3, MW - 4, MH - 7)
        om.fillStyle = "rgb(255,36,150)"
        om.fillRect(x0 + 2, y0 + 3, MW - 4, MH - 7)
        g.fillStyle = "rgba(255,255,255,0.18)"
        g.fillRect(x0 + 2, y0 + 3, MW - 4, 4)
        g.fillStyle = "#cfc8b5"
        g.fillRect(x0, y0 + MH - 4, MW, 4)
        bm.fillStyle = "#e4e4e4"
        bm.fillRect(x0, y0 + MH - 4, MW, 4)
        if (rnd() < litProb) {
          e.fillStyle = `rgba(255,${(215 + rnd() * 25) | 0},${(150 + rnd() * 40) | 0},${0.55 + rnd() * 0.4})`
          e.fillRect(x0 + 3, y0 + 4, MW - 6, MH - 9)
        }
        continue
      }
      // 纵向明暗：越靠下越暗（被树丛和邻楼遮蔽），顶部受光最亮
      g.fillStyle = `rgba(20,12,4,${(0.34 * (1 - f / Math.max(1, rows - 1))).toFixed(3)})`
      g.fillRect(x0, y0, MW, MH)
      // 楼板边（每层底部一道略深的线，显出层高）
      g.fillStyle = "#d2cab6"
      g.fillRect(x0, y0 + MH - 5, MW, 3)
      g.fillStyle = "rgba(0,0,0,0.06)"
      g.fillRect(x0, y0 + MH - 9, MW, 4)
      bm.fillStyle = "#e8e8e8"
      bm.fillRect(x0, y0 + MH - 5, MW, 3)
      // 窗：通长的大窗带，占开间约八成，相邻开间之间只留窄窄的窗间墙
      let wx = x0 + 5
      let wy = y0 + 7
      let ww = MW - 10
      let wh = MH - 17
      let lobby = false
      if (f === 0 && (style === "office" || style === "villa")) {
        // 首层：大堂 / 车库门，更宽更暗
        wx = x0 + 5
        ww = MW - 10
        wh = MH - 12
        lobby = true
      }
      if (style === "shop" && f === 0) {
        // 底商：整面橱窗，上沿一条招牌带
        g.fillStyle = "#cdbf9f"
        g.fillRect(x0, y0 + 2, MW, 8)
        wx = x0 + 4
        wy = y0 + 12
        ww = MW - 8
        wh = MH - 20
        lobby = true
      }
      const gr = g.createLinearGradient(0, wy, 0, wy + wh)
      gr.addColorStop(0, lobby ? "#46545a" : "#7d8c91")
      gr.addColorStop(1, lobby ? "#2a343a" : "#44515a")
      g.fillStyle = gr
      g.fillRect(wx, wy, ww, wh)
      bm.fillStyle = "#505050"
      bm.fillRect(wx, wy, ww, wh)
      om.fillStyle = "rgb(255,36,150)"
      om.fillRect(wx, wy, ww, wh)
      // 阳台板：窗下外凸一条
      if (!lobby && style !== "shop") {
        bm.fillStyle = "#f2f2f2"
        bm.fillRect(wx - 2, wy + wh + 1, ww + 4, 4)
        g.fillStyle = "rgba(0,0,0,0.1)"
        g.fillRect(wx - 2, wy + wh + 5, ww + 4, 2)
      }
      g.strokeStyle = "#a79e88"
      g.lineWidth = 1
      g.strokeRect(wx + 0.5, wy + 0.5, ww - 1, wh - 1)
      g.fillStyle = "rgba(60,76,84,0.55)"
      g.fillRect(wx + ww / 2, wy, 1, wh)
      if (unitCols && c % unitCols === 0) {
        g.fillStyle = "#b9b09a"
        g.fillRect(x0, y0, 2, MH)
        bm.fillStyle = "#f6f6f6"
        bm.fillRect(x0, y0, 3, MH)
      }
      const p = lobby ? 1 : litProb
      if (rnd() < p) {
        const a = 0.82 + rnd() * 0.18
        e.fillStyle = `rgba(255,${190 + ((rnd() * 40) | 0)},${105 + ((rnd() * 45) | 0)},${a})`
        e.fillRect(wx, wy, ww, wh)
      }
    }
  }
  const tex = (canvas) => {
    const t = new THREE.CanvasTexture(canvas)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    return t
  }
  const bump = new THREE.CanvasTexture(cbmp)
  bump.anisotropy = 8
  const orm = new THREE.CanvasTexture(corm)
  orm.anisotropy = 8
  return { map: tex(cv), emissive: tex(ce), bump, orm }
}

/** 一个面用的材质；所有"夜里会亮"的材质都收进 lit 列表，统一调 emissiveIntensity */
function wallMaterial(o, lit) {
  const { map, emissive, bump, orm } = facade(o)
  const m = new THREE.MeshStandardMaterial({
    map,
    bumpMap: bump,
    bumpScale: 2.2,
    emissiveMap: emissive,
    emissive: 0xffffff,
    emissiveIntensity: 0.1,
    roughness: 1,
    metalness: 1,
    roughnessMap: orm,
    metalnessMap: orm
  })
  lit.push(m)
  return m
}

// ---------------------------------------------------------------- 共用材质

function sharedMaterials() {
  return {
    roof: new THREE.MeshStandardMaterial({ color: 0xcbc5b6, roughness: 0.9 }),
    glassFacade: new THREE.MeshStandardMaterial({
      color: 0x86b4c0,
      metalness: 0.7,
      roughness: 0.12,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
      emissive: 0xffc98a,
      emissiveIntensity: 0.25
    }),
    slate: new THREE.MeshStandardMaterial({ color: 0xa79f90, roughness: 0.85 }),
    cap: new THREE.MeshStandardMaterial({ color: 0xe9e2d0, roughness: 0.75 }),
    eq: new THREE.MeshStandardMaterial({ color: 0xd6cfbb, roughness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x3a3631, roughness: 0.85 }),
    green: new THREE.MeshStandardMaterial({ color: 0x5f8a3e, roughness: 0.95 }),
    glassRoof: new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0.6,
      color: 0x6f9aa6,
      roughness: 0.2,
      metalness: 0.3
    }),
    // 屋顶边的 LED 灯带：白天是暗金，夜里亮起
    led: new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xc9a86a).multiplyScalar(0.5),
      toneMapped: false
    })
  }
}

const box = (w, h, d, mat) =>
  new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)

/** 三棱柱：联排的坡屋顶（脊线沿 x），底宽 d、高 h、长 w */
function prism(w, d, h, mat) {
  const sh = new THREE.Shape()
  sh.moveTo(-d / 2, 0)
  sh.lineTo(0, h)
  sh.lineTo(d / 2, 0)
  sh.closePath()
  const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false })
  g.translate(0, 0, -w / 2)
  g.rotateY(Math.PI / 2)
  return new THREE.Mesh(g, mat)
}

/** 屋顶：浅灰顶板 + 女儿墙 + 屋顶 LED 灯带；opts.eave 给出挑檐宽度（m） */
function addRoof(group, w, d, y, mats, opts = {}) {
  if (opts.eave) {
    const e = opts.eave
    const eave = box(w + e * 2, 0.5, d + e * 2, mats.cap)
    eave.position.y = y + 0.05
    eave.castShadow = true
    group.add(eave)
  }
  const slab = box(w + 0.4, 0.6, d + 0.4, mats.roof)
  slab.position.y = y + 0.3
  slab.castShadow = true
  slab.receiveShadow = true
  group.add(slab)
  const t = 0.55
  const h = opts.parapet ?? 0.9
  for (const [sx, sz, ww, dd] of [
    [0, d / 2, w + 0.4, t],
    [0, -d / 2, w + 0.4, t],
    [w / 2, 0, t, d],
    [-w / 2, 0, t, d]
  ]) {
    const p = box(ww, h, dd, mats.cap)
    p.position.set(sx, y + 0.6 + h / 2, sz)
    p.castShadow = true
    group.add(p)
  }
  if (opts.led !== false) {
    const k = 0.22
    for (const [sx, sz, ww, dd] of [
      [0, d / 2 + t / 2 + 0.05, w + 0.9, k],
      [0, -d / 2 - t / 2 - 0.05, w + 0.9, k],
      [w / 2 + t / 2 + 0.05, 0, k, d],
      [-w / 2 - t / 2 - 0.05, 0, k, d]
    ]) {
      const l = box(ww, 0.3, dd, mats.led)
      l.position.set(sx, y + 0.6 + h - 0.05, sz)
      group.add(l)
    }
  }
}

// ---------------------------------------------------------------- 住宅楼栋

/** 高层 / 洋房 / 联排 */
function residence(b, mats, lit, seedBase) {
  const g = new THREE.Group()
  g.name = b.id
  const floors = b.floors
  const kind = b.kind
  const isVilla = kind === "villa"
  const longCols = Math.max(4, Math.round(b.w / (isVilla ? 3.25 : 3.4)))
  const shortCols = Math.max(3, Math.round(b.d / 3.4))
  // 洋房最上一层（跃层）退进去单独做，主体少一层
  const setback = kind === "terrace"
  const mainFloors = setback ? floors - 1 : floors
  const o = {
    rows: mainFloors,
    litProb: kind === "tower" ? 0.97 : 0.95,
    style: isVilla ? "villa" : "office"
  }
  const long = wallMaterial(
    { ...o, cols: longCols, seed: seedBase + 1, unitCols: isVilla ? 2 : 0 },
    lit
  )
  const longBack = wallMaterial(
    { ...o, cols: longCols, seed: seedBase + 2, unitCols: isVilla ? 2 : 0 },
    lit
  )
  const shortM = wallMaterial(
    { ...o, cols: shortCols, seed: seedBase + 3 },
    lit
  )
  const shortM2 = wallMaterial(
    { ...o, cols: shortCols, seed: seedBase + 4 },
    lit
  )

  const mainH = mainFloors * b.storeyH
  const bodyGeo = new THREE.BoxGeometry(b.w, mainH, b.d)
  // 面顺序：+x 东、-x 西、+y 顶、-y 底、+z 南、-z 北
  const body = new THREE.Mesh(bodyGeo, [
    shortM,
    shortM2,
    mats.roof,
    mats.roof,
    long,
    longBack
  ])
  body.position.y = mainH / 2 + 0.05
  body.castShadow = true
  body.receiveShadow = true
  body.name = `${b.id}_body`
  body.userData.id = b.id
  g.add(body)
  const bodies = [body]

  let topY = mainH + 0.05
  if (setback) {
    // 跃层：略窄，用只有一层的立面
    const pw = b.w - 4
    const pd = b.d - 4
    const m1 = wallMaterial(
      {
        cols: Math.max(3, longCols - 1),
        rows: 1,
        litProb: 0.8,
        seed: seedBase + 5
      },
      lit
    )
    const m2 = wallMaterial(
      {
        cols: Math.max(2, shortCols - 1),
        rows: 1,
        litProb: 0.8,
        seed: seedBase + 6
      },
      lit
    )
    const pent = new THREE.Mesh(new THREE.BoxGeometry(pw, b.storeyH, pd), [
      m2,
      m2,
      mats.roof,
      mats.roof,
      m1,
      m1
    ])
    pent.position.y = topY + b.storeyH / 2
    pent.castShadow = true
    pent.receiveShadow = true
    pent.name = `${b.id}_pent`
    pent.userData.id = b.id
    g.add(pent)
    bodies.push(pent)
    const roofG = new THREE.Group()
    roofG.position.y = topY + b.storeyH
    addRoof(roofG, pw, pd, 0, mats, { led: true, eave: 1.1 })
    g.add(roofG)
    topY += b.storeyH
  } else if (isVilla) {
    // 联排：浅灰坡顶，挑檐出 0.8 m
    const roof = prism(b.w + 1.6, b.d + 1.6, 3.4, mats.slate)
    roof.position.y = topY
    roof.castShadow = true
    roof.receiveShadow = true
    g.add(roof)
    topY += 3.4
  } else {
    const roofG = new THREE.Group()
    roofG.position.y = topY
    addRoof(roofG, b.w, b.d, 0, mats, { led: kind === "tower" })
    g.add(roofG)
  }

  // 屋顶设备间
  if (kind === "tower") {
    // 塔冠：收窄的两层，立面同主体，顶上再是设备间和天线
    const cw = b.w * 0.6
    const cd = b.d * 0.72
    const cm = wallMaterial(
      {
        cols: Math.max(3, Math.round(cw / 3.4)),
        rows: 1,
        litProb: 0.95,
        seed: seedBase + 8
      },
      lit
    )
    const cs = wallMaterial(
      {
        cols: Math.max(2, Math.round(cd / 3.4)),
        rows: 1,
        litProb: 0.95,
        seed: seedBase + 9
      },
      lit
    )
    const crown = new THREE.Mesh(new THREE.BoxGeometry(cw, 4.4, cd), [
      cs,
      cs,
      mats.roof,
      mats.roof,
      cm,
      cm
    ])
    crown.position.y = topY + 0.6 + 2.2
    crown.castShadow = true
    g.add(crown)
    const cap = new THREE.Group()
    cap.position.y = topY + 0.6 + 4.4
    addRoof(cap, cw, cd, 0, mats, { led: true, parapet: 0.6 })
    g.add(cap)
    const eq1 = box(cw * 0.42, 2.4, cd * 0.5, mats.eq)
    eq1.position.set(-cw * 0.2, topY + 0.6 + 4.4 + 0.6 + 1.2, 0)
    eq1.castShadow = true
    g.add(eq1)
    const mast = box(0.4, 5, 0.4, mats.dark)
    mast.position.set(cw * 0.22, topY + 0.6 + 4.4 + 0.6 + 2.5, 0)
    g.add(mast)
    topY += 5
  } else if (kind === "terrace") {
    const eq = box(b.w * 0.2, 1.6, b.d * 0.3, mats.eq)
    eq.position.set(b.w * 0.22, topY + 0.6 + 0.8, 0)
    g.add(eq)
  }

  g.position.set(b.cx, 0, -b.cy)
  return {
    group: g,
    bodies,
    height: topY + 0.6,
    footprint: { cx: b.cx, cy: b.cy, w: b.w, d: b.d }
  }
}

// ---------------------------------------------------------------- 配套与周边

function plain(a, mats, lit, o) {
  const g = new THREE.Group()
  g.name = a.id
  const floors = Math.max(1, a.floors)
  const h = o.height ?? floors * 3.4
  const longCols = o.longCols ?? Math.max(4, Math.round(a.w / 4))
  const shortCols = o.shortCols ?? Math.max(3, Math.round(a.d / 4))
  const base = {
    rows: floors,
    style: o.style ?? "office",
    litProb: o.litProb ?? 0.7,
    wall: o.wall
  }
  const mk = (cols, seed) => wallMaterial({ ...base, cols, seed }, lit)
  const body = new THREE.Mesh(new THREE.BoxGeometry(a.w, h, a.d), [
    mk(shortCols, o.seed + 1),
    mk(shortCols, o.seed + 2),
    mats.roof,
    mats.roof,
    mk(longCols, o.seed + 3),
    mk(longCols, o.seed + 4)
  ])
  body.position.y = h / 2 + 0.05
  body.castShadow = true
  body.receiveShadow = true
  body.name = `${a.id}_body`
  body.userData.id = a.id
  g.add(body)
  const roofG = new THREE.Group()
  roofG.position.y = h + 0.05
  addRoof(roofG, a.w, a.d, 0, mats, { led: o.led ?? false, parapet: 0.7 })
  g.add(roofG)
  g.position.set(a.cx, 0, -a.cy)
  return { group: g, body, height: h, roofY: h + 0.65 }
}

/** 会所：中间高、两翼低的宽体，南面一排立柱托着出挑的屋檐，门厅有雨棚 */
function clubhouse(a, mats, lit) {
  const g = new THREE.Group()
  g.name = a.id
  const cw = a.w * 0.5
  const wing = (a.w - cw) / 2
  const bodies = []
  const part = (w, d, h, ox, seed, cols) => {
    const r = plain({ ...a, w, d, cx: ox, cy: 0 }, mats, lit, {
      style: "glass",
      height: h,
      seed,
      litProb: 0.92,
      led: true,
      longCols: cols,
      shortCols: 4
    })
    g.add(r.group)
    bodies.push(r.body)
  }
  part(cw, a.d, 9.5, 0, 700, 6)
  part(wing, a.d * 0.8, 6.5, -(cw + wing) / 2, 710, 3)
  part(wing, a.d * 0.8, 6.5, (cw + wing) / 2, 720, 3)
  // 中间体量的挑檐
  const eave = box(cw + 5, 0.8, a.d + 5, mats.cap)
  eave.position.set(0, 10, 0)
  eave.castShadow = true
  g.add(eave)
  // 柱廊
  for (let i = 0; i <= 6; i++) {
    const p = box(0.7, 9.6, 0.7, mats.cap)
    p.position.set(-cw / 2 + 1.5 + i * ((cw - 3) / 6), 4.85, a.d / 2 + 2.3)
    p.castShadow = true
    g.add(p)
  }
  const porch = box(12, 0.6, 5, mats.cap)
  porch.position.set(0, 4.6, a.d / 2 + 2.6)
  porch.castShadow = true
  g.add(porch)
  g.position.set(a.cx, 0, -a.cy)
  return {
    group: g,
    bodies,
    height: 10.8,
    footprint: { cx: a.cx, cy: a.cy, w: a.w, d: a.d }
  }
}

/** 底商街：沿东界排开的一串小商铺，每段高度略有错落，东西两侧有彩色雨棚 */
function shopStreet(a, mats, lit) {
  const g = new THREE.Group()
  g.name = a.id
  const bodies = []
  const n = 6
  const gap = 2.4
  const segD = (a.d - gap * (n - 1)) / n
  const heights = [9, 10.5, 8.5, 10, 9, 10.5]
  const awn = [0xb4684b, 0x6f8a54, 0xd1a649, 0x5b86a3]
  const rnd = rng(5)
  for (let i = 0; i < n; i++) {
    const oy = -a.d / 2 + segD / 2 + i * (segD + gap)
    const r = plain({ ...a, d: segD, cx: 0, cy: oy }, mats, lit, {
      style: "shop",
      height: heights[i],
      seed: 800 + i * 10,
      litProb: 0.92,
      longCols: 4,
      shortCols: Math.max(3, Math.round(segD / 3.6)),
      led: true
    })
    g.add(r.group)
    bodies.push(r.body)
    for (const sx of [-1, 1]) {
      const m = new THREE.MeshStandardMaterial({
        color: awn[(rnd() * awn.length) | 0],
        roughness: 0.8
      })
      const aw = box(1.6, 0.35, segD * 0.8, m)
      aw.position.set(sx * (a.w / 2 + 0.8), 4.2, -oy)
      aw.rotation.z = sx * -0.18
      aw.castShadow = true
      g.add(aw)
    }
  }
  g.position.set(a.cx, 0, -a.cy)
  return {
    group: g,
    bodies,
    height: 10.5,
    footprint: { cx: a.cx, cy: a.cy, w: a.w, d: a.d }
  }
}

/** 学校：L 形教学楼 */
function school(a, mats, lit) {
  const g = new THREE.Group()
  g.name = a.id
  const parts = [
    { w: a.w, d: 22, cx: 0, cy: a.d / 2 - 11 },
    { w: 18, d: a.d - 22, cx: -a.w / 2 + 9, cy: -11 }
  ]
  const bodies = []
  parts.forEach((p, i) => {
    const r = plain({ ...a, w: p.w, d: p.d, cx: 0, cy: 0 }, mats, lit, {
      style: "office",
      height: 14,
      seed: 900 + i * 10,
      litProb: 0.6,
      longCols: Math.round(p.w / 4),
      shortCols: Math.round(p.d / 4)
    })
    r.group.position.set(p.cx, 0, -p.cy)
    r.body.userData.id = a.id
    g.add(r.group)
    bodies.push(r.body)
  })
  g.position.set(a.cx, 0, -a.cy)
  return {
    group: g,
    bodies,
    height: 14.6,
    footprint: { cx: a.cx, cy: a.cy, w: a.w, d: a.d }
  }
}

/** 医院：白色体块，屋顶一个红十字 */
function clinic(a, mats, lit) {
  const r = plain(a, mats, lit, {
    style: "office",
    height: 15,
    seed: 1000,
    litProb: 0.55,
    wall: "#f0ece2",
    longCols: 9,
    shortCols: 9
  })
  const red = new THREE.MeshStandardMaterial({
    color: 0xd0402f,
    emissive: 0xd0402f,
    emissiveIntensity: 0.25,
    roughness: 0.6
  })
  const v = box(1.6, 5, 1.2, red)
  const h = box(5, 1.6, 1.2, red)
  for (const m of [v, h]) {
    m.position.set(0, 12, a.d / 2 + 0.7)
    r.group.add(m)
  }
  return {
    group: r.group,
    bodies: [r.body],
    height: 15.6,
    footprint: { cx: a.cx, cy: a.cy, w: a.w, d: a.d }
  }
}

/** 商业综合体：五层玻璃盒子，顶上一块玻璃中庭顶 */
function mall(a, mats, lit) {
  const g = new THREE.Group()
  g.name = a.id
  const bodies = []
  const arm = (w, d, ox, oy, seed) => {
    const r = plain({ ...a, w, d, cx: ox, cy: oy }, mats, lit, {
      style: "glass",
      height: 12,
      seed,
      litProb: 0.88,
      led: true,
      longCols: Math.round(w / 3.4),
      shortCols: Math.round(d / 3.4)
    })
    g.add(r.group)
    bodies.push(r.body)
  }
  // L 形：北面一条横楼 + 西南一翼，沿路（西侧）展开
  arm(a.w, a.d * 0.46, 0, a.d * 0.27, 1100)
  arm(a.w * 0.5, a.d * 0.54, -a.w * 0.25, -a.d * 0.23, 1110)
  // 西面的弧形玻璃幕墙（半圆柱）
  const curve = new THREE.Mesh(
    new THREE.CylinderGeometry(8.5, 8.5, 12, 28, 1, true, Math.PI / 2, Math.PI),
    mats.glassFacade
  )
  curve.position.set(-a.w / 2, 6.1, -a.d * 0.27)
  curve.castShadow = true
  g.add(curve)
  // 椭圆雨棚 + 立柱
  const canopy = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 0.5, 32),
    mats.glassRoof
  )
  canopy.scale.set(10, 1, 5.5)
  canopy.position.set(-a.w * 0.5 - 6, 4.8, a.d * 0.1)
  g.add(canopy)
  for (const [px, pz] of [
    [-7, -3.5],
    [7, -3.5],
    [-7, 3.5],
    [7, 3.5]
  ]) {
    const p = box(0.4, 4.6, 0.4, mats.eq)
    p.position.set(
      canopy.position.x + px * 0.8,
      2.4,
      canopy.position.z + pz * 0.8
    )
    g.add(p)
  }
  // 玻璃扶梯连廊：从地面斜到二层
  const esc = new THREE.Mesh(
    new THREE.BoxGeometry(3, 2.6, 14),
    mats.glassFacade
  )
  esc.position.set(-a.w * 0.5 - 2, 4.2, -a.d * 0.05)
  esc.rotation.x = -0.34
  esc.castShadow = true
  g.add(esc)
  // 屋顶天窗
  const sky = box(a.w * 0.3, 1.4, a.d * 0.14, mats.eq)
  sky.position.set(a.w * 0.05, 12.7, a.d * 0.27)
  g.add(sky)
  g.position.set(a.cx, 0, -a.cy)
  return {
    group: g,
    bodies,
    height: 14,
    footprint: { cx: a.cx, cy: a.cy, w: a.w, d: a.d }
  }
}

/** 小体量配套：物业中心、地铁口 */
function small(a, mats, lit, style, seed, height) {
  const r = plain(a, mats, lit, {
    style,
    height,
    seed,
    litProb: 0.9,
    led: true,
    longCols: Math.max(3, Math.round(a.w / 3.4)),
    shortCols: Math.max(2, Math.round(a.d / 3.4))
  })
  const eave = box(a.w + 3, 0.5, a.d + 3, mats.cap)
  eave.position.set(0, height + 0.9, 0)
  eave.castShadow = true
  r.group.add(eave)
  return {
    group: r.group,
    bodies: [r.body],
    height: height + 1.4,
    footprint: { cx: a.cx, cy: a.cy, w: a.w, d: a.d }
  }
}

/** 门楼：两根立柱 + 横梁；车库入口是一个雨棚 */
function gate(a, mats, kind) {
  const g = new THREE.Group()
  g.name = a.id
  const bodies = []
  if (kind === "gate") {
    const horizontal = a.w >= a.d
    const span = horizontal ? a.w : a.d
    for (const s of [-1, 1]) {
      const p = box(horizontal ? 2.2 : 2.2, 6.4, 2.2, mats.cap)
      p.position.set(
        horizontal ? s * (span / 2 - 1.1) : 0,
        3.25,
        horizontal ? 0 : s * (span / 2 - 1.1)
      )
      p.castShadow = true
      g.add(p)
      bodies.push(p)
    }
    const beam = box(
      horizontal ? span : 2.6,
      1.2,
      horizontal ? 2.6 : span,
      mats.cap
    )
    beam.position.set(0, 6.6, 0)
    beam.castShadow = true
    g.add(beam)
    bodies.push(beam)
    const led = box(
      horizontal ? span - 1 : 0.3,
      0.25,
      horizontal ? 0.3 : span - 1,
      mats.led
    )
    led.position.set(0, 6.0, 0)
    g.add(led)
  } else {
    const canopy = box(a.w, 0.6, a.d + 2, mats.cap)
    canopy.position.set(0, 4.4, 0)
    canopy.castShadow = true
    g.add(canopy)
    bodies.push(canopy)
    for (const s of [-1, 1]) {
      const p = box(0.8, 4.4, 0.8, mats.cap)
      p.position.set(s * (a.w / 2 - 0.6), 2.2, a.d / 2)
      g.add(p)
    }
  }
  bodies.forEach((m) => (m.userData.id = a.id))
  g.position.set(a.cx, 0, -a.cy)
  return {
    group: g,
    bodies,
    height: 7.2,
    footprint: { cx: a.cx, cy: a.cy, w: a.w, d: a.d }
  }
}

// ---------------------------------------------------------------- 总装

/**
 * 建所有楼体
 * @returns {{group: THREE.Group, objects: Map<string, object>, pickables: THREE.Object3D[],
 *   setLit: (v: number) => void}}
 */
/**
 * 周边的普通楼（实例化的盒子）：在着色器里按世界坐标画窗格，不用给每栋单独建模。
 * 竖直面上每 3.4 m 一开间、3.2 m 一层，窗稍暗，亮不亮由坐标哈希决定，夜里亮的更多更亮。
 */
function contextMat(ctxLit) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 })
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLit = ctxLit
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vCW;\nvarying vec3 vCN;"
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        mat4 cm = modelMatrix * instanceMatrix;
        vCW = (cm * vec4(position, 1.0)).xyz;
        vCN = normalize((cm * vec4(normal, 0.0)).xyz);`
      )
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uLit;
        varying vec3 vCW;
        varying vec3 vCN;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        if (abs(vCN.y) < 0.5 && vCW.y > 1.2) {
          float along = abs(vCN.x) > 0.5 ? vCW.z : vCW.x;
          vec2 g = vec2(along / 3.4, vCW.y / 3.2);
          vec2 c = fract(g);
          vec2 id = floor(g);
          float win = step(0.2, c.x) * step(c.x, 0.8) * step(0.3, c.y) * step(c.y, 0.7);
          float on = step(h21(id + vec2(floor(vCW.x * 0.07), floor(vCW.z * 0.07))), 0.25 + 0.6 * uLit);
          totalEmissiveRadiance += win * on * vec3(1.0, 0.76, 0.46) * (0.25 + 1.5 * uLit);
          diffuseColor.rgb *= 1.0 - win * 0.4;
        }`
      )
  }
  return m
}

/** 窗玻璃分档：每档窗在夜色深度 v 过了阈值后才亮（档内占比见 scripts/blender/estate/lib.py 的 GLASS_TIERS） */
const GLASS_THR = { glass_a: -1, glass_b: 0, glass_c: 0.08, glass_d: 0.16 }
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** GLB 楼栋的灯光：窗玻璃按档亮起，店面、LED 灯带随夜色变亮 */
function litGlb(mats, v) {
  const on = 0.7 + 1.7 * v
  for (const [name, thr] of Object.entries(GLASS_THR)) {
    const m = mats.get(name)
    if (m) m.emissiveIntensity = on * smooth(thr, thr + 0.12, v)
  }
  const shop = mats.get("shop_glass")
  if (shop) shop.emissiveIntensity = 0.15 + on * 0.9
  const blue = mats.get("glass_blue")
  if (blue) blue.emissiveIntensity = 0.2 + 0.8 * v
  const gold = mats.get("gold")
  if (gold) gold.emissiveIntensity = 0.8 + 1.8 * v
}

/**
 * 把 Blender 做的楼栋按编号挂进来：节点名 = 楼栋编号，<id>_body 是可见网格，<id>_hull 是不可见外框盒
 * （页面用它拾取、画轮廓线）。返回的对象和程序化楼栋一样：{ group, bodies, height, footprint }
 */
function adoptGlb(glb, layout, reg, glbMats) {
  const info = new Map(
    [...layout.buildings, ...layout.amenities].map((a) => [a.id, a])
  )
  const roots = []
  glb.scene.traverse((o) => {
    if (!o.isMesh && info.has(o.name)) roots.push(o)
  })
  for (const node of roots) {
    const a = info.get(node.name)
    let hull = null
    node.traverse((o) => {
      if (!o.isMesh) return
      if (o.material.name === "hull") {
        hull = o
        o.visible = false
        o.userData.id = node.name
        return
      }
      o.castShadow = true
      o.receiveShadow = true
      for (const m of [o.material].flat()) glbMats.set(m.name, m)
    })
    if (!hull) throw new Error(`楼栋 ${node.name} 缺少 _hull 外框盒`)
    node.updateMatrixWorld(true)
    reg(node.name, {
      group: node,
      bodies: [hull],
      height: new THREE.Box3().setFromObject(hull).max.y,
      footprint: { cx: a.cx, cy: a.cy, w: a.w, d: a.d }
    })
  }
  const missing = [...info.keys()].filter(
    (id) =>
      !roots.some((r) => r.name === id) &&
      (info.get(id).shape === "building" ||
        info.get(id).shape === "gate" ||
        info.get(id).shape === "garage" ||
        id.startsWith("B"))
  )
  if (missing.length) console.warn("[estate] GLB 里没有这些楼栋：", missing)
}

export function buildBuildings(layout, blocks, glb = null) {
  const group = new THREE.Group()
  group.name = "buildings"
  const mats = sharedMaterials()
  const lit = []
  const objects = new Map()
  const pickables = []
  const reg = (id, o) => {
    objects.set(id, o)
    group.add(o.group)
    for (const m of o.bodies ?? [o.body]) pickables.push(m)
  }

  // 有 Blender 做的楼栋模型（estate/buildings.glb）就用它；没有就退回下面程序化的盒子 + 贴图立面
  const glbMats = new Map()
  const ctxLit = { value: 0 } // 周边楼窗灯的夜色深度，setLit 里更新
  if (glb) adoptGlb(glb, layout, reg, glbMats)
  else {
    layout.buildings.forEach((b, i) =>
      reg(b.id, residence(b, mats, lit, 100 + i * 20))
    )

    for (const a of layout.amenities) {
      if (a.shape === "building") {
        if (a.id === "CL01") reg(a.id, clubhouse(a, mats, lit))
        else if (a.id === "SH01") reg(a.id, shopStreet(a, mats, lit))
        else if (a.id === "SC01") reg(a.id, school(a, mats, lit))
        else if (a.id === "HP01") reg(a.id, clinic(a, mats, lit))
        else if (a.id === "ML01") reg(a.id, mall(a, mats, lit))
        else if (a.id === "PM01")
          reg(a.id, small(a, mats, lit, "glass", 1200, 4.2))
        else if (a.id === "MT01")
          reg(a.id, small(a, mats, lit, "glass", 1300, 5))
        else if (a.id === "KG01") {
          const r = plain(a, mats, lit, {
            style: "office",
            height: 10.5,
            seed: 1400,
            litProb: 0.65,
            wall: "#f1e3c9",
            led: true,
            longCols: 6,
            shortCols: 4
          })
          reg(a.id, {
            group: r.group,
            bodies: [r.body],
            height: 11,
            footprint: { cx: a.cx, cy: a.cy, w: a.w, d: a.d }
          })
        }
      } else if (a.shape === "gate") {
        reg(a.id, gate(a, mats, "gate"))
      } else if (a.shape === "garage") {
        reg(a.id, gate(a, mats, "garage"))
      }
    }
  }

  if (!glb) {
    // 楼板外挑带：住宅每层一条薄薄的象牙白楼板，真实几何，在软阴影里投出细线，立面一下有了体积
    let slabCount = 0
    for (const b of layout.buildings) slabCount += Math.max(0, b.floors - 1)
    const slabs = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      mats.cap,
      slabCount
    )
    const sm = new THREE.Matrix4()
    let si = 0
    for (const b of layout.buildings) {
      const out = b.kind === "tower" ? 0.7 : 0.9
      for (let f = 1; f < b.floors; f++) {
        sm.compose(
          new THREE.Vector3(b.cx, f * b.storeyH + 0.05, -b.cy),
          new THREE.Quaternion(),
          new THREE.Vector3(b.w + out * 2, 0.3, b.d + out * 2)
        )
        slabs.setMatrixAt(si++, sm)
      }
    }
    slabs.castShadow = true
    slabs.receiveShadow = true
    group.add(slabs)
  }

  // 远处的普通建筑：淡灰白模，实例化
  const inst = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    contextMat(ctxLit),
    blocks.length
  )
  const m4 = new THREE.Matrix4()
  const col = new THREE.Color()
  const rnd = rng(77)
  blocks.forEach((bk, i) => {
    m4.compose(
      new THREE.Vector3(bk.cx, bk.h / 2 + 0.05, -bk.cy),
      new THREE.Quaternion(),
      new THREE.Vector3(bk.w, bk.h, bk.d)
    )
    inst.setMatrixAt(i, m4)
    inst.setColorAt(i, col.setHSL(0.1, 0.1, 0.6 + rnd() * 0.1))
  })
  inst.castShadow = true
  inst.receiveShadow = true
  inst.name = "context"
  group.add(inst)
  // 上面再收一层小体量（退台），不再是光秃秃的方块
  const tierBlocks = blocks.filter((_, i) => i % 3 !== 2)
  const tier = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    contextMat(ctxLit),
    tierBlocks.length
  )
  tierBlocks.forEach((bk, i) => {
    const th = Math.max(4, bk.h * 0.45)
    m4.compose(
      new THREE.Vector3(bk.cx + bk.w * 0.08, bk.h + th / 2 + 0.05, -bk.cy),
      new THREE.Quaternion(),
      new THREE.Vector3(bk.w * 0.6, th, bk.d * 0.62)
    )
    tier.setMatrixAt(i, m4)
    tier.setColorAt(i, col.setHSL(0.1, 0.1, 0.7 + rnd() * 0.08))
  })
  tier.castShadow = true
  tier.receiveShadow = true
  group.add(tier)

  // 夜里窗灯、LED 灯带亮度：lit 0–1。白天窗里也有一点点暖光，和沙盘里常亮的 LED 一致
  const ledDay = new THREE.Color(0xc9a86a).multiplyScalar(0.5)
  const ledNight = new THREE.Color(0xffd27a).multiplyScalar(2.4)
  const setLit = (v) => {
    for (const m of lit) m.emissiveIntensity = 0.2 + 2.1 * v
    mats.led.color.copy(ledDay).lerp(ledNight, v)
    litGlb(glbMats, v)
    ctxLit.value = v
  }
  setLit(0)
  return { group, objects, pickables, setLit }
}

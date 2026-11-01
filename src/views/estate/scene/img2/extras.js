/*
 * /estate 还原：生成器管不了的大批量实例和贴图
 * ----------------------------------------------------------
 * img2threejs 的生成器只会把部件树、图元和材质生成出来（createEstateModel.ts，自动生成不要手改），
 * 重复系统它只会"环形摆放"。这里手写这些系统，规则和数量来自规格里的 repetitionSystems：
 *   - 地面：设计稿按评审机位反投影到地面平面的贴图（scripts/estate/img2/make_ground.py），一个带透明边的平面盖在地面盘上
 *   - 窗：每栋楼逐窗暖光，亮窗约 75 %，深色窗框在后；高层再加壁柱、洋房加阳台板
 *   - 屋面构件：设备盒、联排屋面的光伏片；会所门厅前的列柱
 *   - 树：位置、大小、颜色都来自反投影地面图（make_ground.py → trees.json）
 *   - 路灯：反投影图里孤立的亮暖点（lamps.json）；车：在路带上随机摆
 * 每个手写决定都写回了规格（repetitionSystems / proceduralStrategy），这里的数字和那边保持一致。
 * 坐标：规格和 footprints.json 是 (东, 北, 高)，three.js 是 (x, y 向上, z = −北)。
 */
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import lite from "./spec-lite.json"
import foot from "./footprints.json"
import layout from "../../data/layout.json"
import { applyFacades, facadeGain } from "./facade.js"
import { buildLattice } from "./lattice.js"

/** 可复现的随机数（mulberry32），同一座沙盘每次摆的窗、树、车都一样 */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FOOT = Object.fromEntries(foot.footprints.map((f) => [f.id, f]))
const LAYOUT_B = Object.fromEntries(layout.buildings.map((b) => [b.id, b]))

const DEEP_GREEN = new THREE.Color("#2f4d26")

/** Blender 楼栋窗玻璃的自发光强度基数（页面再乘昼夜的 facadeGain） */
export const BL_WINDOW_EMIS = 1.8

/** Blender 楼栋墙面 / 屋面的自发光系数（反照率 × 这个数，白天满强度，夜里跟天光压暗） */
const BL_SURFACE_EMIS = 0.2

/** 周边白模材质参数：墙色（受光前）、顶面自发光、圆角半径 */
const CONTEXT = {
  color: "#d9d0c6",
  topGlow: "#332e45",
  eastGlow: "#453b31",
  radius: 1.0,
  // 设计稿里这几块的顶面更亮（离镜头近 / 受展厅顶光多）：顶面自发光 × 2.4
  bright: /^(ctx_05|ctx_07|ctx_14|HP01)/
}

/**
 * 一栋楼某一面上的窗格：返回 [{x, y, z, ry, w, h}]（three.js 世界坐标，已经放在墙面前 eps 处）
 * f：footprints 里的体积（cx, cy=北, w, d, h, ry）；face：S / N / E / W
 */
function faceFrame(f, face) {
  const a = f.ry || 0
  // 本地轴在 (东, 北) 里：ex = (cos a, sin a)；ez（朝南）= (sin a, −cos a)
  const ex = [Math.cos(a), Math.sin(a)]
  const ez = [Math.sin(a), -Math.cos(a)]
  const dir = {
    S: [ez, 1, f.w, f.d],
    N: [ez, -1, f.w, f.d],
    E: [ex, 1, f.d, f.w],
    W: [ex, -1, f.d, f.w]
  }[face]
  const [axis, sign, length, depth] = dir
  const n = [axis[0] * sign, axis[1] * sign] // 外法线（东, 北）
  const t = face === "S" || face === "N" ? ex : ez // 沿墙方向
  const center = [f.cx + n[0] * (depth / 2), f.cy + n[1] * (depth / 2)]
  return { n, t, center, length }
}

/** 沿一条线均匀放置的盒子实例（壁柱、阳台板、列柱、屋面设备盒共用） */
function boxInstances(items, material, name, cast = true) {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    material,
    items.length
  )
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  items.forEach((b, i) => {
    q.setFromAxisAngle(up, b.ry || 0)
    m.compose(
      new THREE.Vector3(b.x, b.y, b.z),
      q,
      new THREE.Vector3(b.sx, b.sy, b.sz)
    )
    mesh.setMatrixAt(i, m)
    if (b.color) mesh.setColorAt(i, b.color)
  })
  mesh.name = name
  mesh.castShadow = cast
  mesh.receiveShadow = true
  return mesh
}

/**
 * 每类楼的立面参数（开间、层距、窗比例、分组、亮窗率、墙色），按设计稿放大对比实测：
 *   - 高层：一面约 8 列窗、约 4 m 一行，两窗一组，组间竖向深槽 + 白色壁柱；墙色偏深的灰褐
 *   - 洋房：一面约 8 个开间，设计稿里是大窗、约每两层一排（后排 8 层约 4 排、前排 9 层约 4–5 排），两窗一组；墙色浅灰白
 *   - 联排：一户（7.5 m）两扇窗，户与户之间一道白色分户墙
 *   - 学校：整条横向窗带（每层一条），几乎不发光
 *   - 幼儿园 / 物业 / 底商街：普通小窗
 * 墙色是"受光之前"的基础色，亮度按设计稿实测墙面亮度校准（塔楼墙约 121、洋房约 146、学校约 146）。
 */
const FACADE = {
  tower: {
    color: "#968d7d",
    depth: 0.45,
    tex: 0.3,
    warmK: 0.35,
    core: [0.58, 0.62],
    beam: 0.4,
    latGain: 1.5,
    bay: 4.25,
    row: 4.6,
    win: [0.84, 0.76],
    group: 2,
    groove: 0.9,
    pilaster: 0.7,
    lit: 0.9,
    emis: 1.65,
    frame: 1.18,
    foot: 18
  },
  terrace: {
    color: "#d9ccb4",
    depth: 0.4,
    tex: 0.3,
    sill: 0.28,
    split: 1,
    warmK: 0.9,
    core: [0.55, 0.6],
    frameDark: 0.15,
    latGain: 1.3,
    beam: 0.4,
    bay: 4.3,
    row: 6,
    win: [0.72, 0.76],
    group: 2,
    groove: 0.5,
    pilaster: 0.5,
    lit: 0.9,
    emis: 1.65,
    frame: 1.15,
    foot: 8
  },
  villa: {
    color: "#d6cab6",
    depth: 0.4,
    tex: 0.3,
    split: 1,
    warmK: 0.8,
    core: [0.55, 0.6],
    frameDark: 0.1,
    latGain: 1.25,
    beam: 0.4,
    bay: 3.75,
    row: 9.5,
    win: [0.74, 0.74],
    group: 2,
    groove: 0.3,
    pilaster: 0.9,
    lit: 0.9,
    emis: 2.1,
    frame: 1.15,
    foot: 12
  },
  school: {
    color: "#bdb4a1",
    depth: 0.35,
    bay: 3.2,
    row: 4.2,
    win: [0.84, 0.46],
    group: 0,
    lit: 0.35,
    emis: 0.9,
    frame: 1.15,
    foot: 6,
    roof: "#e4e2de"
  },
  small: {
    color: "#c3baa6",
    depth: 0.35,
    bay: 3.6,
    row: 3.2,
    win: [0.55, 0.55],
    group: 0,
    lit: 0.5,
    emis: 1.4,
    frame: 1.12,
    foot: 4,
    roof: "#d9d6d0"
  },
  // 会所：大格玻璃幕墙——粗的深灰柱（开间 8.5 m）+ 层间横梁，窗里是整面暖色窗帘
  club: {
    color: "#756e64",
    depth: 0.6,
    warmK: 0.75,
    tex: 0.1,
    fold: 95,
    frameDark: 0.55,
    core: [0.97, 0.95],
    latGain: 1.15,
    bay: 8.5,
    row: 11,
    win: [0.93, 0.8],
    group: 0,
    lit: 1.0,
    emis: 0.85,
    frame: 0.9,
    foot: 5
  },
  shop: {
    color: "#c6b08c",
    depth: 0.35,
    bay: 3.4,
    row: 4.0,
    win: [0.65, 0.52],
    group: 0,
    lit: 0.85,
    emis: 1.9,
    frame: 1.1,
    foot: 3,
    roof: "#e0dfdc"
  }
}

function facadeTargets(runtime) {
  const out = []
  const add = (id, kind, seed) => {
    const f = FOOT[id]
    const mesh = runtime.meshes[id]
    if (!f || !mesh) return
    out.push({
      id,
      mesh,
      size: [f.w, f.h, f.d],
      foot: f,
      params: { ...FACADE[kind], seed, real: 1 }
    })
  }
  let k = 1
  for (const [id, b] of Object.entries(LAYOUT_B)) add(id, b.kind, k++)
  for (const id of ["SC01", "SC01_west"]) add(id, "school", k++)
  for (const id of ["KG01", "PM01"]) add(id, "small", k++)
  for (const id of ["CL01", "CL01_wl", "CL01_wr"]) add(id, "club", k++)
  for (let i = 1; i <= 5; i++) add(`SH01_s${i}`, "shop", k++)
  return out
}

/**
 * Blender 建的住宅楼栋 B01–B16（scripts/blender/estate/restored.py → public/estate/img2/buildings_bl.glb）：
 * 真实几何（凹窗、壁柱、深槽、阳台、屋顶构件）+ 窗格贴图集（自发光）+ 顶点 AO。读不到就返回 null，
 * 页面退回生成器方盒 + 着色器立面（facade.js / lattice.js）。
 * 返回 { scene, ids, windowMats }：ids 是 GLB 里有的楼栋编号，windowMats 是窗玻璃材质（页面按时间调自发光）。
 */
async function loadBlenderBuildings(baseUrl) {
  try {
    const gltf = await new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .loadAsync(`${baseUrl}estate/img2/buildings_bl.glb`)
    const ids = new Set()
    gltf.scene.children.forEach((n) => {
      if (/^(B\d+|CL01)$/.test(n.name)) ids.add(n.name)
    })
    const windowMats = new Set()
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return
      o.castShadow = true
      o.receiveShadow = true
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats)
        if (m.name.startsWith("bl_window")) windowMats.add(m)
    })
    for (const m of windowMats) {
      m.emissiveIntensity = BL_WINDOW_EMIS * facadeGain.value
      // 窗格贴图集是 8 × 8 小格：远处各向异性过滤 + mipmap 会让相邻格串色，限制 mip 层级最多往下 3 级即可
      if (m.emissiveMap) m.emissiveMap.anisotropy = 8
    }
    // 墙面 / 屋面等非窗材质：加一点和反照率同色的自发光（沙盘楼体里有灯，设计稿的墙面被窗光、灯光抬得很亮；
    // 纯受光的墙在这个光照下只有设计稿的 6 成亮）。强度跟着天光走（RestoredScene.applyLight），夜里压暗
    const surfMats = new Set()
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of mats) {
        if (m.name.startsWith("bl_window") || m.name === "bl_shell") continue
        surfMats.add(m)
      }
    })
    for (const m of surfMats) {
      // 墙 / 壁柱 / 深槽 / 阳台板：整量；屋面、台座、设备盒、檐口：只给一点（设计稿里屋面比墙面暗得多）
      const wall = /^bl_(wall|pil|groove|slab|rail)/.test(m.name)
      // 塔楼的墙自发光减半：设计稿塔楼的暗部（p5 ≈ 58）比洋房 / 联排（≈ 33）亮，但亮部（p95 ≈ 210）没那么亮
      const k = /_tower$/.test(m.name) ? 0.8 : 1
      m.emissive = m.color
        .clone()
        .multiplyScalar(wall ? BL_SURFACE_EMIS * k : BL_SURFACE_EMIS * 0.25)
      m.emissiveIntensity = 1
    }
    return {
      scene: gltf.scene,
      ids,
      windowMats: [...windowMats],
      surfMats: [...surfMats]
    }
  } catch (e) {
    console.warn(
      "[estate] buildings_bl.glb 读取失败，退回着色器立面：",
      e?.message ?? e
    )
    return null
  }
}

/** 读 ez-tree 树模型包（public/estate/img2/trees_ez.json）：几何 + 叶片 / 树皮贴图 */
async function loadTreePack(baseUrl) {
  const raw = await (await fetch(`${baseUrl}estate/img2/trees_ez.json`)).json()
  const dec = (b64, Type) => {
    const bin = atob(b64)
    const u8 = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    return new Type(u8.buffer)
  }
  const geo = (g, withNormal = true) => {
    const bg = new THREE.BufferGeometry()
    bg.setAttribute(
      "position",
      new THREE.BufferAttribute(dec(g.pos, Float32Array), 3)
    )
    if (withNormal)
      bg.setAttribute(
        "normal",
        new THREE.BufferAttribute(dec(g.nor, Float32Array), 3)
      )
    bg.setAttribute("uv", new THREE.BufferAttribute(dec(g.uv, Float32Array), 2))
    bg.setIndex(new THREE.BufferAttribute(dec(g.idx, Uint16Array), 1))
    return bg
  }
  const loader = new THREE.TextureLoader()
  const leafTex = {}
  const barkTex = {}
  await Promise.all(
    Object.entries(raw.textures).map(async ([k, rel]) => {
      const tex = await loader.loadAsync(`${baseUrl}estate/img2/${rel}`)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 4
      if (k.startsWith("leaf_")) leafTex[k.slice(5)] = tex
      else {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping
        barkTex[k.slice(5)] = tex
      }
    })
  )
  const variants = raw.trees.map((t) => ({
    ...t,
    barkGeo: geo(t.bark),
    leafGeo: geo(t.leaves)
  }))
  return { variants, leafTex, barkTex }
}

/**
 * 主入口：返回 { group, hidden }。
 *  group  所有手写实例（加到 root 上）
 *  hidden 被地面贴图取代、应当隐藏的生成器部件 id
 */
export async function buildExtras({ baseUrl = "/", runtime } = {}) {
  const group = new THREE.Group()
  group.name = "img2_extras"
  const rand = rng(20261031)
  const info = await (
    await fetch(`${baseUrl}estate/img2/ground_info.json`)
  ).json()
  const trees = await (await fetch(`${baseUrl}estate/img2/trees.json`)).json()
  const lamps = await (await fetch(`${baseUrl}estate/img2/lamps.json`)).json()

  // Blender 建的住宅楼栋（有就用它，没有就退回着色器立面）。它们的立面、阳台、屋顶构件、檐口都在 GLB 里，
  // 下面这些手写的同类部件对这些楼栋一律跳过；生成器给的方盒保留成"看不见但能拾取"的代理（拾取 / 轮廓线要用它）
  const bl = runtime ? await loadBlenderBuildings(baseUrl) : null
  const BL = bl?.ids ?? new Set()
  const inBL = (id) => BL.has(String(id).split("_")[0])
  if (bl && runtime) {
    const proxy = new THREE.MeshBasicMaterial({ visible: false })
    for (const [id, mesh] of Object.entries(runtime.meshes))
      if (inBL(id)) mesh.material = proxy
    group.add(bl.scene)
  }

  // ---------------------------------------------------------------- 地面贴图平面
  const tex = await new THREE.TextureLoader().loadAsync(
    `${baseUrl}estate/img2/ground.webp`
  )
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  tex.minFilter = THREE.LinearMipmapLinearFilter
  const gw = info.x1 - info.x0
  const gd = info.y1 - info.y0
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(gw, gd),
    // 贴图本身带着设计稿里的灯光（灯池、窗光溢出），所以当烘焙光用：不受光、不做色调映射，
    // 光照 pass 里再用 color 乘数和时间联动
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.5,
      toneMapped: false
    })
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.set((info.x0 + info.x1) / 2, info.z, -(info.y0 + info.y1) / 2)
  ground.name = "ground_projection"
  ground.receiveShadow = false
  group.add(ground)

  // ---------------------------------------------------------------- 立面（窗洞 / 窗帘 / 竖槽 / 壁柱 / 墙面渐变，着色器）
  if (runtime) {
    const targets = facadeTargets(runtime).filter((t) => !inBL(t.id))
    applyFacades(targets)
    // 真凹窗：窗洞之间的横梁 / 竖墩 / 壁柱 / 角柱（实例化盒子，lattice.js）
    const lattice = buildLattice(targets)
    if (lattice) group.add(lattice)
  }

  // ---------------------------------------------------------------- 阳台板（洋房）
  // 窗、壁柱、窗帘都在立面着色器里（facade.js）。设计稿里洋房的阳台是每户一个小挑台（窗洞下沿挑出一小块浅色板），
  // 不是整层贯通的一条板：每开间每排窗一块，宽 = 窗宽 × 0.95，挑出 0.9 m、厚 0.28 m；位置和 facade.js / lattice.js 用同一套公式。
  const balcony = []
  const slab = new THREE.Color("#d2cabb")
  for (const [id, b] of Object.entries(LAYOUT_B)) {
    const f = FOOT[id]
    if (!f || b.kind !== "terrace" || inBL(id)) continue
    const T = FACADE.terrace
    const nr = Math.max(1, Math.round(f.h / T.row))
    const rh = f.h / nr
    const nb = Math.max(1, Math.round(f.w / T.bay))
    const bw = f.w / nb
    const fr = faceFrame(f, "S")
    const ry = Math.atan2(fr.n[0], -fr.n[1])
    for (let r = 0; r < nr; r++) {
      // 这一排窗的下沿（离楼脚）：窗中心在 0.46 排处，窗高 T.win[1] 排
      const yb = (r + 0.46 - T.win[1] / 2) * rh
      for (let i = 0; i < nb; i++) {
        const off = -f.w / 2 + bw * (i + 0.5)
        balcony.push({
          x: fr.center[0] + fr.t[0] * off + fr.n[0] * 0.45,
          y: f.top - f.h + yb - 0.05,
          z: -(fr.center[1] + fr.t[1] * off + fr.n[1] * 0.45),
          ry,
          sx: bw * T.win[0] * 0.95,
          sy: 0.28,
          sz: 0.9,
          color: slab
        })
      }
    }
  }
  // 商业体的立面：弧面角是真实几何（build_spec.py：蓝灰玻璃环 + 楼板环 + 暗暖内芯），平直立面（南 / 东 / 西）在这里补
  // 设计稿里的两样东西：① 深灰色的竖墩（南立面每 ≈ 9.5 m 一根，通高）；② 墩与墩之间的亮窗（每层一块暖色灯光，
  // 底层是通高大玻璃；亮窗亮不亮、亮多少随机，夜里整体变亮——和楼栋的窗光共用同一个 facadeGain）。
  // 层高按 build_spec.py 的 FL_FRAC（底层 28 %，上面四层各 18 %）。
  const mallF = FOOT["ML01"]
  const mullions = []
  const mallPanels = []
  const MALL_FL = [0.28, 0.18, 0.18, 0.18, 0.18]
  if (mallF) {
    const cr = mallF.cornerRadius || 0
    const H = mallF.h
    const pierCol = new THREE.Color("#8d8983")
    const gold = ["#ffc066", "#ffb455", "#ffcf80"].map(
      (c) => new THREE.Color(c)
    )
    const warm = ["#ffd9a0", "#ffc980", "#ffe6b8"].map(
      (c) => new THREE.Color(c)
    )
    const mrand = rng(31031)
    for (const face of ["S", "E", "W"]) {
      const fr = faceFrame(mallF, face)
      // 平直段长度：南面两头各让出一个圆角半径，东 / 西面也是
      const len = fr.length - 2 * cr
      if (len < 3) continue
      const nb = Math.max(1, Math.round(len / 9.5))
      const bay = len / nb
      const ry = Math.atan2(fr.n[0], -fr.n[1])
      const at = (off, push) => ({
        x: fr.center[0] + fr.t[0] * off + fr.n[0] * push,
        z: -(fr.center[1] + fr.t[1] * off + fr.n[1] * push)
      })
      // 竖墩
      for (let i = 0; i <= nb; i++) {
        const p = at(-len / 2 + bay * i, 0.45)
        mullions.push({
          x: p.x,
          y: 0.7 + H / 2,
          z: p.z,
          ry,
          sx: 1.1,
          sy: H,
          sz: 0.8,
          color: pierCol
        })
      }
      // 亮窗：每层每开间一块
      let z0 = 0
      for (let f = 0; f < 5; f++) {
        const fh = MALL_FL[f] * H
        const ph = fh * (f === 0 ? 0.74 : 0.56)
        for (let i = 0; i < nb; i++) {
          const p = at(-len / 2 + bay * (i + 0.5), 0.2)
          // 底层通高大玻璃：几乎全亮、金黄（设计稿底层约 (176, 128, 83)）；上面四层偏蓝灰、亮窗收一点（约 (123, 100, 82)）
          const lit =
            f === 0
              ? 0.85 + 0.15 * mrand()
              : (mrand() < 0.9 ? 0.55 + 0.45 * mrand() : 0.08) * 0.72
          mallPanels.push({
            x: p.x,
            y: 0.7 + z0 + fh * (f === 0 ? 0.46 : 0.48),
            z: p.z,
            ry,
            sx: bay - 1.7,
            sy: ph,
            sz: 0.15,
            color: (f === 0 ? gold : warm)[Math.floor(mrand() * 3)]
              .clone()
              .multiplyScalar(lit * (f === 0 ? 1.3 : 1))
          })
        }
        z0 += fh
      }
    }
  }

  // 阳台板（受光）
  const plaster = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.75
  })
  if (balcony.length) group.add(boxInstances(balcony, plaster, "rep_balcony"))

  // ---------------------------------------------------------------- 屋面构件、会所列柱
  // 洋房 / 联排的屋面构件（设计稿放大）：洋房 = 屋面后半部两块浅色长方形台座 + 中间一个设备盒；
  // 联排 = 屋面中央一整块大的浅色光伏 / 天窗矩形（中间一道分隔）+ 两个小通风帽。屋顶面 = 屋面板的顶面。
  const roofUnits = []
  const pv = []
  const platform = new THREE.Color("#cfcbc1")
  const unitWhite = new THREE.Color("#e4e0d6")
  for (const [id, b] of Object.entries(LAYOUT_B)) {
    const r = FOOT[`${id}_roof`]
    if (!r || b.kind === "tower" || inBL(id)) continue
    const top = r.top
    if (b.kind === "terrace") {
      for (const sx of [-1, 1]) {
        pv.push({
          x: r.cx + sx * r.w * 0.25,
          y: top + 0.3,
          z: -(r.cy + r.d * 0.14),
          sx: r.w * 0.34,
          sy: 0.6,
          sz: r.d * 0.5,
          color: platform
        })
      }
      roofUnits.push({
        x: r.cx,
        y: top + 0.9,
        z: -(r.cy + r.d * 0.14),
        sx: r.w * 0.08,
        sy: 1.8,
        sz: r.d * 0.34,
        color: unitWhite
      })
    } else {
      pv.push(
        {
          x: r.cx - r.w * 0.17,
          y: top + 0.25,
          z: -r.cy,
          sx: r.w * 0.31,
          sy: 0.5,
          sz: r.d * 0.52,
          color: platform
        },
        {
          x: r.cx + r.w * 0.17,
          y: top + 0.25,
          z: -r.cy,
          sx: r.w * 0.31,
          sy: 0.5,
          sz: r.d * 0.52,
          color: platform
        }
      )
      roofUnits.push(
        {
          x: r.cx,
          y: top + 0.7,
          z: -(r.cy + r.d * 0.12),
          sx: r.w * 0.06,
          sy: 1.4,
          sz: r.d * 0.2,
          color: unitWhite
        },
        {
          x: r.cx + r.w * 0.4,
          y: top + 0.7,
          z: -(r.cy - r.d * 0.2),
          sx: 1.6,
          sy: 1.4,
          sz: 1.6,
          color: unitWhite
        }
      )
    }
  }
  // 塔楼核心筒顶上的深色凹口（设计稿里核心筒顶是一个敞口的深色凹槽）
  const coreDark = new THREE.Color("#35373b")
  for (const [id, b] of Object.entries(LAYOUT_B)) {
    if (b.kind !== "tower" || inBL(id)) continue
    const c = FOOT[`${id}_core`]
    if (!c) continue
    roofUnits.push({
      x: c.cx,
      y: c.top + 0.08,
      z: -c.cy,
      sx: c.w * 0.74,
      sy: 0.2,
      sz: c.d * 0.62,
      color: coreDark
    })
  }
  // 会所前的独立列柱已去掉：设计稿里柱子是和玻璃面齐平的结构柱（FACADE.club 的深灰竖墩 + 格构），
  // 玻璃前面并没有一排白色圆柱，那一排把整面金黄玻璃遮成一格一格
  const unitMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.8
  })
  if (roofUnits.length)
    group.add(boxInstances(roofUnits, unitMat, "rep_roof_units"))
  if (pv.length) group.add(boxInstances(pv, unitMat, "rep_pv"))

  // 塔楼檐口：每栋塔楼顶部一圈向外出挑的白色檐口；洋房 / 联排屋顶一圈白色女儿墙（设计稿里深色屋面外圈有白边）
  const trim = []
  const parapet = []
  const trimWhite = new THREE.Color("#e9e5dc")
  for (const [id, b] of Object.entries(LAYOUT_B)) {
    const f = FOOT[id]
    if (!f || inBL(id)) continue
    if (b.kind === "tower") {
      trim.push({
        x: f.cx,
        y: f.top - 0.3,
        z: -f.cy,
        ry: 0,
        sx: f.w + 1.4,
        sy: 1.2,
        sz: f.d + 1.4,
        color: trimWhite
      })
    } else {
      // 白色出挑边：落在屋面板的顶面上（不是楼体顶——屋面板在楼体顶之上还有 1.2 m 厚），向外出挑 0.5 m、宽 0.9 m、高 1.2 m
      const r = FOOT[`${id}_roof`]
      const y = (r ? r.top : f.top) + 0.5
      const t = 0.9
      const ow = f.w + 1.0
      const od = f.d + 1.0
      parapet.push(
        {
          x: f.cx,
          y,
          z: -(f.cy + od / 2 - t / 2),
          ry: 0,
          sx: ow,
          sy: 1.2,
          sz: t,
          color: trimWhite
        },
        {
          x: f.cx,
          y,
          z: -(f.cy - od / 2 + t / 2),
          ry: 0,
          sx: ow,
          sy: 1.2,
          sz: t,
          color: trimWhite
        },
        {
          x: f.cx + ow / 2 - t / 2,
          y,
          z: -f.cy,
          ry: 0,
          sx: t,
          sy: 1.2,
          sz: od - 2 * t,
          color: trimWhite
        },
        {
          x: f.cx - ow / 2 + t / 2,
          y,
          z: -f.cy,
          ry: 0,
          sx: t,
          sy: 1.2,
          sz: od - 2 * t,
          color: trimWhite
        }
      )
    }
  }
  if (trim.length) group.add(boxInstances(trim, plaster, "rep_cornice"))
  if (mullions.length)
    group.add(boxInstances(mullions, plaster, "rep_mall_mullions", false))
  if (mallPanels.length) {
    const pm = new THREE.MeshBasicMaterial({ color: 0xffffff })
    pm.onBeforeCompile = (shader) => {
      shader.uniforms.uGain = facadeGain
      // 条纹：每块亮窗按自己的宽度（实例矩阵的 x 缩放）每 ≈ 2.4 m 一道竖向窗框（再细就在 1080p 下摩尔纹成点阵）；底下比上面亮一点（楼层灯光从下往上衰减）
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying float vStripe;"
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          vStripe = (position.x + 0.5) * length(instanceMatrix[0].xyz) / 2.4;`
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform float uGain;\nvarying float vStripe;"
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          float fs = fract(vStripe);
          float frame = smoothstep(0.0, 0.1, fs) * (1.0 - smoothstep(0.9, 1.0, fs));
          diffuseColor.rgb *= uGain * 1.25 * (0.68 + 0.32 * frame);`
        )
    }
    group.add(boxInstances(mallPanels, pm, "rep_mall_panels", false))
  }
  if (parapet.length) group.add(boxInstances(parapet, plaster, "rep_parapet"))

  // ---------------------------------------------------------------- 社区医院：屋顶设备盒 + 红色标识
  // 设计稿里医院是一个奶白色大体块，屋顶偏前有一个浅色设备盒，屋顶、西立面、南立面各有一处红色标识。
  // 位置按设计稿读数（设备盒中心在屋顶偏东 0.1 倍宽、偏南 0.3 倍进深，宽 0.29 倍宽）。
  const hp = FOOT["HP01"]
  if (hp) {
    const hpBoxes = [
      {
        x: hp.cx + hp.w * 0.1,
        y: hp.top + 1.7,
        z: -(hp.cy - hp.d * 0.3),
        sx: hp.w * 0.29,
        sy: 3.4,
        sz: hp.d * 0.3,
        color: new THREE.Color("#e8e0d6")
      },
      // 屋顶偏北的一条浅色长条（设备带）
      {
        x: hp.cx - hp.w * 0.06,
        y: hp.top + 0.45,
        z: -(hp.cy + hp.d * 0.3),
        sx: hp.w * 0.34,
        sy: 0.9,
        sz: hp.d * 0.16,
        color: new THREE.Color("#ded6cc")
      }
    ]
    group.add(boxInstances(hpBoxes, unitMat, "rep_hp_roof"))
    const red = new THREE.MeshStandardMaterial({
      color: "#c8392f",
      roughness: 0.6,
      emissive: "#5a120d"
    })
    const front = -(hp.cy - hp.d / 2) // 南立面所在的 z
    const redParts = [
      // 设备盒顶上的红色圆标（圆 + 横条模拟"十字 / 文字"）
      new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.25, 24), red),
      // 南立面：偏上的一条红色标识
      new THREE.Mesh(new THREE.BoxGeometry(hp.w * 0.2, 2.0, 0.3), red),
      // 西立面：偏上、靠南的竖条
      new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.8, 7), red)
    ]
    redParts[0].position.set(
      hp.cx + hp.w * 0.1,
      hp.top + 3.5,
      -(hp.cy - hp.d * 0.3)
    )
    redParts[1].position.set(hp.cx + hp.w * 0.04, hp.top - 5.5, front + 0.18)
    redParts[2].position.set(
      hp.cx - hp.w / 2 - 0.18,
      hp.top - 6,
      -(hp.cy - hp.d * 0.2)
    )
    redParts.forEach((m, i) => {
      m.name = `rep_hp_logo_${i}`
      group.add(m)
    })
  }

  // ---------------------------------------------------------------- 玻璃扶梯盒和穹顶亭的细节
  const esc = FOOT["ML01_escalator"]
  if (esc) {
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(esc.w, esc.h, esc.d)),
      new THREE.LineBasicMaterial({ color: 0xcfd6dc })
    )
    frame.position.set(esc.cx, 0.7 + esc.h / 2, -esc.cy)
    frame.name = "rep_escalator_frame"
    group.add(frame)
    // 扶梯盒：只留棱线框架（玻璃面本身是半透明的），扶梯条带做出来比没有更难看，去掉
  }
  const dome = FOOT["ML01_dome"]
  if (dome) {
    // 穹顶下的水池发光：一块发暖蓝光的圆盘，贴在地面上
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(Math.min(dome.w, dome.d) * 0.42, 24),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color("#7fd0f0").multiplyScalar(1.4),
        transparent: true,
        opacity: 0.85
      })
    )
    glow.rotation.x = -Math.PI / 2
    glow.position.set(dome.cx, info.z + 0.12, -dome.cy)
    glow.name = "rep_dome_glow"
    group.add(glow)
  }

  // ---------------------------------------------------------------- 树（ez-tree 模型；位置 / 大小 / 颜色来自反投影地面图）
  // 树模型是用 ez-tree（MIT）离线生成的轻量变体（scripts/estate/tree_lab → pack_trees.py → trees_ez.json）：
  // 每种树一份树皮 + 叶片几何，叶片是 ez-tree 自带的叶片贴图（带透明通道）。这里按变体做 InstancedMesh：
  // 叶片贴图只取明暗纹理，颜色由每棵树自己的实例色给（取自设计稿，所以深绿 / 黄绿 / 橙红的分布和设计稿一致）。
  const pack = await loadTreePack(baseUrl)
  const crownEmis = { value: 0.34 } // 树冠的自发光倍数：白天 / 夜里由场景按时间调
  const m4 = new THREE.Matrix4()
  const qq = new THREE.Quaternion()
  const euler = new THREE.Euler()
  const col = new THREE.Color()
  const hsl = { h: 0, s: 0, l: 0 }

  /** 给每棵树选一个变体：深色又不大的有一部分做成松树，小树里一部分做成灌木，其余按 橡 / 白蜡 / 白杨 */
  const byKind = (kind) => pack.variants.filter((v) => v.kind === kind)
  const oaks = pack.variants.filter((v) => v.name.startsWith("oak"))
  const ashes = pack.variants.filter((v) => v.name.startsWith("ash"))
  const aspens = pack.variants.filter((v) => v.name.startsWith("aspen"))
  const pick = (arr) => arr[Math.floor(rand() * arr.length) % arr.length]
  // 楼前判断：树在某栋楼南立面前 20 m 内且 x 落在楼宽（±2 m）内 → 返回离立面的距离，否则 null
  const fronts = Object.values(FOOT).filter(
    (f) => /^(B\d+|CL01|SC01|KG01|PM01)$/.test(f.id) && !f.id.endsWith("_roof")
  )
  const frontOf = (x, y) => {
    let best = null
    for (const f of fronts) {
      if (Math.abs(x - f.cx) > f.w / 2 + 2) continue
      const d = f.cy - f.d / 2 - y
      if (d >= -1 && d < 20 && (best === null || d < best))
        best = Math.max(d, 0)
    }
    return best
  }
  const lists = new Map(pack.variants.map((v) => [v.name, []]))
  const colors = trees.map((t) => {
    col.set(t.c)
    col.getHSL(hsl)
    // 青柠黄（色相 0.12–0.2）往绿偏；橙红（< 0.1）保留作点缀；明度夹在 [0.16, 0.4]
    const hue = hsl.h > 0.11 && hsl.h < 0.22 ? hsl.h + 0.045 : hsl.h
    col.setHSL(
      hue,
      Math.min(0.7, Math.max(0.28, hsl.s)),
      Math.min(0.4, Math.max(0.16, hsl.l - 0.1 + (rand() - 0.5) * 0.06))
    )
    // 设计稿里深绿占大头，黄绿 / 橙 / 红只是点缀：约 70 % 的树往深绿混
    const deep = rand() < 0.7
    if (deep) col.lerp(DEEP_GREEN, 0.55)
    return { c: col.clone(), dark: deep }
  })
  trees.forEach((t, i) => {
    let v
    if (colors[i].dark && t.r > 2.0 && rand() < 0.16)
      v = pick(byKind("conifer"))
    else if (t.r < 1.9 && rand() < 0.4) v = pick(byKind("bush"))
    else {
      const w = rand()
      v = w < 0.5 ? pick(oaks) : w < 0.82 ? pick(ashes) : pick(aspens)
    }
    lists.get(v.name).push(i)
  })
  // 叶片着色：贴图只取明暗（纹理里的叶脉、缺口），颜色由实例色给；冠底压暗，再加一点自发光
  const leafMat = (v, tex) => {
    const m = new THREE.MeshStandardMaterial({
      map: tex,
      alphaTest: v.alphaTest,
      side: THREE.DoubleSide,
      roughness: 0.9,
      color: 0xffffff
    })
    const lo = v.stats.crownBottom
    const hi = v.stats.crownTop
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uEmis = crownEmis
      shader.uniforms.uLo = { value: lo }
      shader.uniforms.uHi = { value: hi }
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying float vLocalY;"
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\n  vLocalY = position.y;"
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying float vLocalY;\nuniform float uEmis, uLo, uHi;"
        )
        .replace(
          "#include <map_fragment>",
          `#ifdef USE_MAP
            vec4 sampledDiffuseColor = texture2D( map, vMapUv );
            float lumaL = dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            diffuseColor.rgb *= clamp(lumaL * 2.3, 0.3, 1.45);
            diffuseColor.a *= sampledDiffuseColor.a;
          #endif`
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
          diffuseColor.rgb *= mix(0.5, 1.12, smoothstep(uLo, uHi, vLocalY));
          totalEmissiveRadiance += diffuseColor.rgb * uEmis;`
        )
    }
    return m
  }
  const barkMat = (v, tex) =>
    new THREE.MeshStandardMaterial({
      map: tex,
      color: 0x8a7866,
      roughness: 1
    })
  const treeMeshes = []
  const leafMats = []
  for (const v of pack.variants) {
    const idxs = lists.get(v.name)
    if (!idxs.length) continue
    const lm = leafMat(v, pack.leafTex[v.leafType])
    leafMats.push(lm)
    const leaves = new THREE.InstancedMesh(v.leafGeo, lm, idxs.length)
    const bark = new THREE.InstancedMesh(
      v.barkGeo,
      barkMat(v, pack.barkTex[v.barkType]),
      idxs.length
    )
    // 缩放：冠径对到设计稿采样的冠径；竖向压到 0.8（设计稿里的树冠更圆）
    idxs.forEach((ti, k) => {
      const t = trees[ti]
      const s = (t.r * 0.95) / v.stats.crownRadius
      euler.set(0, rand() * Math.PI * 2, 0)
      qq.setFromEuler(euler)
      let sy = s * 0.8 * (0.9 + rand() * 0.25)
      // 楼前的树压低：设计稿里贴着楼南立面的树冠顶只到一二层窗，不会把立面挡掉大半；
      // 取树北面最近的楼（树在它南立面前 20 m 内、x 在楼宽内）：树高上限 4.5 m + 距离 × 0.15
      const near = frontOf(t.x, t.y)
      if (near !== null)
        sy = Math.min(sy, (4.5 + near * 0.15) / v.stats.crownTop)
      m4.compose(
        new THREE.Vector3(t.x, info.z, -t.y),
        qq,
        new THREE.Vector3(s, sy, s)
      )
      leaves.setMatrixAt(k, m4)
      bark.setMatrixAt(k, m4)
      leaves.setColorAt(k, colors[ti].c)
    })
    leaves.name = `rep_trees_${v.name}`
    bark.name = `rep_trunks_${v.name}`
    leaves.castShadow = false
    leaves.receiveShadow = false
    bark.castShadow = false
    treeMeshes.push(leaves, bark)
  }
  for (const m of treeMeshes) {
    // 实例的包围球按原点算会被裁掉：树分布在整个底座上，关掉视锥裁剪
    m.frustumCulled = false
    group.add(m)
  }

  // ---------------------------------------------------------------- 路灯（杆 + 发光头）
  const poles = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.1, 0.12, 3.2, 5),
    new THREE.MeshStandardMaterial({ color: 0x2a2724 }),
    lamps.length
  )
  const heads = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.42, 8, 6),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color("#ffd9a0").multiplyScalar(2.2)
    }),
    lamps.length
  )
  lamps.forEach((l, i) => {
    m4.compose(
      new THREE.Vector3(l.x, info.z + 1.6, -l.y),
      new THREE.Quaternion(),
      new THREE.Vector3(1, 1, 1)
    )
    poles.setMatrixAt(i, m4)
    m4.compose(
      new THREE.Vector3(l.x, info.z + 3.3, -l.y),
      new THREE.Quaternion(),
      new THREE.Vector3(1, 1, 1)
    )
    heads.setMatrixAt(i, m4)
  })
  poles.name = "rep_lamp_poles"
  heads.name = "rep_lamp_heads"
  group.add(poles, heads)

  // ---------------------------------------------------------------- 车：在路带上随机摆
  const roads = layout.roads.filter((r) => r.id !== "R03")
  const carColors = [
    "#e8e6e0",
    "#202226",
    "#9aa0a8",
    "#8a2a2a",
    "#2a4a7a",
    "#c9c2b0"
  ].map((c) => new THREE.Color(c))
  const carList = []
  for (let i = 0; i < 70; i++) {
    const r = roads[(rand() * roads.length) | 0]
    const vertical = r.d > r.w
    const lane = (rand() < 0.5 ? -1 : 1) * (Math.min(r.w, r.d) * 0.22)
    const along =
      (rand() - 0.5) * (vertical ? Math.min(r.d, 250) : Math.min(r.w, 380))
    const x = vertical ? r.cx + lane : r.cx + along
    const y = vertical ? r.cy + along : r.cy + lane
    // 椭圆外的丢掉
    const b = foot.base
    if (((x - b.cx) / (b.rx - 12)) ** 2 + ((y - b.cy) / (b.ry - 12)) ** 2 > 1)
      continue
    carList.push({
      x,
      y: info.z + 0.7,
      z: -y,
      ry: vertical ? Math.PI / 2 : 0,
      sx: 4.4,
      sy: 1.3,
      sz: 2.0,
      color: carColors[(rand() * carColors.length) | 0]
    })
  }
  group.add(
    boxInstances(
      carList,
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.5,
        metalness: 0.2
      }),
      "rep_cars",
      false
    )
  )

  // 被地面贴图取代的生成器部件（贴图里已经有道路、草坪、水面、操场）
  const hidden = [
    "ground",
    "roads",
    "R01",
    "R02",
    "R03",
    "R04",
    "pad_towers",
    "pad_terrace_w",
    "pad_terrace_e",
    "pad_villa",
    "RV01",
    "RV01_bank",
    "LK01",
    "TR01",
    "AX01",
    "SW01",
    "SC01_field",
    "SP01",
    "PL01",
    ...Array.from({ length: 7 }, (_, i) => `AX01_b${i + 1}`)
  ]
  // 时间轴要调的句柄：窗光、路灯头、地面（烘焙光）、树冠自发光倍数
  const handles = {
    facadeGain,
    lampHeads: heads.material,
    ground: ground.material,
    crownEmis,
    blWindow: bl?.windowMats ?? [],
    blSurface: bl?.surfMats ?? []
  }
  return {
    group,
    hidden,
    handles,
    stats: {
      trees: trees.length,
      lamps: lamps.length,
      windows: 0,
      cars: carList.length
    }
  }
}

/** 生成器部件按规格里的材质色上色（受光的 lit 模式；材质 pass 再换成手写的） */
export function litMaterials(runtime) {
  const cache = {}
  for (const [id, mesh] of Object.entries(runtime.meshes)) {
    const c = lite.components[id]
    const md = c && lite.materials[c.material]
    if (!md) continue
    // 玻璃体没有环境贴图会渲成黑绿：调成偏蓝灰、半透明（透出里面暖光的内芯）；
    // 金属在没有环境贴图的场景里会渲成黑色，上限压到 0.25
    const mallGlass = c.material === "mat_mall_glass"
    const glass = c.material === "mat_glass" || mallGlass
    cache[c.material] ??= new THREE.MeshStandardMaterial({
      color: mallGlass ? "#6f8fa6" : glass ? "#8fa9b8" : md.color,
      transparent: glass,
      // 商业体玻璃带比玻璃盒更不透：设计稿里是蓝灰色反光面，只隐约透出里面的暖光
      opacity: mallGlass ? 0.7 : glass ? 0.5 : 1,
      depthWrite: !glass,
      roughness: glass ? 0.3 : md.rough,
      metalness: glass ? 0 : Math.min(md.metal, 0.25),
      emissive: glass ? "#7fb4d0" : md.emissive || 0x000000,
      emissiveIntensity: glass ? 0.16 : md.emissive ? md.emissiveIntensity : 0
    })
    mesh.material = cache[c.material]
  }
  // 墙脚压暗：楼体越靠近地面越暗（接地感；设计稿里楼脚有深色接触阴影）。只对墙体 / 白模材质，按世界高度
  for (const id of ["mat_plaster", "mat_roof_white"]) {
    const m = cache[id]
    if (!m) continue
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying float vWY;")
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\n  vWY = (modelMatrix * vec4(transformed, 1.0)).y;"
        )
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vWY;")
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
          float baseAo = smoothstep(0.0, 10.0, vWY);
          diffuseColor.rgb *= mix(0.5, 1.0, baseAo);
          totalEmissiveRadiance *= mix(0.45, 1.0, baseAo);`
        )
    }
  }
  styleContext(runtime)
  return cache
}

/**
 * 周边白模（ctx_*）和社区医院：设计稿里它们是软边的奶白色体块——顶面最亮（偏粉白，受展厅顶光）、立面偏暗、
 * 楼脚更暗；边是圆角的，不是硬的直角盒子。所以把生成器给的方盒换成圆角盒，并用专用材质：
 * 顶面加一点偏粉白的自发光（把顶面亮度和色相提到设计稿的 175–197 / 偏粉），楼脚按世界高度压暗。
 * 体块尺寸 / 位置不变（来自 footprints.json，和生成器的盒子一致）。
 */
function styleContext(runtime) {
  // 材质按"顶面自发光强度"分两档（glow 倍数），其余相同
  const make = (glow) => {
    const mat = new THREE.MeshStandardMaterial({
      color: CONTEXT.color,
      roughness: 0.92
    })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTop = {
        value: new THREE.Color(CONTEXT.topGlow).multiplyScalar(glow)
      }
      shader.uniforms.uEast = { value: new THREE.Color(CONTEXT.eastGlow) }
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying float vWY;\nvarying vec3 vON;"
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\n  vON = normal;\n  vWY = (modelMatrix * vec4(transformed, 1.0)).y;"
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying float vWY;\nvarying vec3 vON;\nuniform vec3 uTop;\nuniform vec3 uEast;"
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
          float cTop = smoothstep(0.55, 0.9, vON.y);
          float cEast = smoothstep(0.5, 0.9, vON.x);
          float cFoot = smoothstep(0.0, 16.0, vWY - 0.7);
          diffuseColor.rgb *= mix(0.62, 1.0, cFoot) * (1.0 - 0.1 * cTop);
          totalEmissiveRadiance += uTop * cTop + uEast * cEast;`
        )
    }
    return mat
  }
  const normal = make(1)
  const bright = make(2.4)
  for (const [id, mesh] of Object.entries(runtime.meshes)) {
    if (!/^ctx_/.test(id) && id !== "HP01") continue
    const f = FOOT[id]
    if (!f) continue
    mesh.geometry.dispose()
    // 圆角半径：不超过最小边的 1/6，最大 1 m（设计稿里的倒角很小，主要是景深虚化出来的软边）
    const r = Math.min(CONTEXT.radius, Math.min(f.w, f.h, f.d) / 6)
    mesh.geometry = new RoundedBoxGeometry(f.w, f.h, f.d, 2, r)
    mesh.material = CONTEXT.bright.test(id) ? bright : normal
  }
}

/**
 * 用 ez-tree（https://github.com/dgreenheck/ez-tree，MIT）造沙盘里的树，导出 GLB 给 Blender 渲染用
 * ----------------------------------------------------------
 * 只在开发服务里跑（scripts/estate/export_trees.mjs 开无头 Chrome 调 window.treeLab），不进生产构建，
 * 因为 ez-tree 的发布包自带 15 MB 的内嵌贴图。
 * 每个变体 = 一个预设 + 一个随机种子；树以根部为原点、y 向上，单位是 ez-tree 的原始单位
 * （橡树约 40，我们在 Blender 里按页面里每棵树的冠径再缩放）。
 */
import * as THREE from "three"
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js"
import { Tree } from "@dgreenheck/ez-tree"

// 阔叶：橡树 / 白蜡 / 白杨（树冠形态和叶色各不相同）；针叶：松；灌木：三种
export const VARIANTS = [
  { name: "oak_a", preset: "Oak Medium", seed: 11, kind: "broad" },
  { name: "oak_b", preset: "Oak Medium", seed: 22, kind: "broad" },
  { name: "oak_c", preset: "Oak Medium", seed: 33, kind: "broad" },
  { name: "ash_a", preset: "Ash Medium", seed: 44, kind: "broad" },
  { name: "ash_b", preset: "Ash Medium", seed: 55, kind: "broad" },
  { name: "aspen_a", preset: "Aspen Medium", seed: 66, kind: "broad" },
  { name: "aspen_b", preset: "Aspen Medium", seed: 77, kind: "broad" },
  { name: "pine_a", preset: "Pine Medium", seed: 88, kind: "conifer" },
  { name: "pine_b", preset: "Pine Medium", seed: 99, kind: "conifer" },
  { name: "bush_1", preset: "Bush 1", seed: 101, kind: "bush" },
  { name: "bush_2", preset: "Bush 2", seed: 102, kind: "bush" },
  { name: "bush_3", preset: "Bush 3", seed: 103, kind: "bush" }
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function make(v) {
  const tree = new Tree()
  tree.loadPreset(v.preset)
  tree.options.seed = v.seed
  tree.generate()
  return tree
}

/** 等材质里的贴图都解码完（ez-tree 用 TextureLoader 异步加载） */
async function textured(tree) {
  for (let i = 0; i < 100; i++) {
    let ok = true
    tree.traverse((o) => {
      for (const m of [o.material].flat()) {
        for (const k of ["map", "normalMap", "roughnessMap", "aoMap"]) {
          const img = m?.[k]?.image
          if (
            m?.[k] &&
            !(img && (img.complete ?? true) && (img.width ?? 1) > 0)
          )
            ok = false
        }
      }
    })
    if (ok) return
    await sleep(100)
  }
}

function stats(tree) {
  const box = new THREE.Box3().setFromObject(tree)
  const size = box.getSize(new THREE.Vector3())
  let tris = 0
  tree.traverse((o) => {
    if (o.isMesh) {
      const g = o.geometry
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3
    }
  })
  // 冠径：叶子网格水平方向的半宽（没有叶子就用整棵树）
  const lb = new THREE.Box3().setFromObject(tree.leavesMesh)
  const ls = lb.isEmpty() ? size : lb.getSize(new THREE.Vector3())
  return {
    height: size.y,
    width: Math.max(size.x, size.z),
    crownRadius: Math.max(ls.x, ls.z) / 2,
    crownBottom: lb.isEmpty() ? 0 : lb.min.y,
    crownTop: lb.isEmpty() ? size.y : lb.max.y,
    tris
  }
}

async function toBase64(tree) {
  const glb = await new GLTFExporter().parseAsync(tree, {
    binary: true,
    onlyVisible: true,
    maxTextureSize: 1024
  })
  let s = ""
  const u8 = new Uint8Array(glb)
  for (let i = 0; i < u8.length; i += 0x8000)
    s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  return btoa(s)
}

window.treeLab = {
  variants: VARIANTS,
  /** 生成并导出全部变体：[{ name, kind, preset, seed, stats, glb(base64) }] */
  async exportAll() {
    const out = []
    for (const v of VARIANTS) {
      const tree = make(v)
      await textured(tree)
      out.push({ ...v, stats: stats(tree), glb: await toBase64(tree) })
    }
    return out
  }
}
window.__treeLabReady = true

// ====================================================================== 页面实时版用的轻量变体
// 实时版里有 1800 多棵树，ez-tree 预设（7000–20000 面）直接用会有几千万面；这里在预设上降低枝条层级、
// 径向段数和叶片数，叶片放大补回体积感，目标每棵 600–1500 面。叶片贴图和树皮贴图缩到很小，另存成文件。
const tuned = (o, k) => {
  const L = o.branch.levels
  const c = (obj, f) =>
    Object.fromEntries(
      Object.entries(obj).map(([i, v]) => [i, f(v, Number(i))])
    )
  o.branch.levels = Math.min(L, k.levels ?? 2)
  o.branch.children = c(o.branch.children, (v, i) =>
    Math.max(1, Math.round(v * (k.children ?? 0.6)))
  )
  o.branch.sections = c(o.branch.sections, (v) =>
    Math.max(2, Math.round(v * (k.sections ?? 0.5)))
  )
  o.branch.segments = c(o.branch.segments, (v) =>
    Math.max(3, Math.round(v * (k.segments ?? 0.55)))
  )
  o.leaves.count = k.leafCount ?? 6
  o.leaves.size *= k.leafSize ?? 1.6
}
export const LITE = [
  {
    name: "oak_a",
    preset: "Oak Medium",
    seed: 11,
    kind: "broad",
    k: { levels: 2, children: 0.7, leafCount: 7, leafSize: 1.7 }
  },
  {
    name: "oak_b",
    preset: "Oak Medium",
    seed: 22,
    kind: "broad",
    k: { levels: 2, children: 0.7, leafCount: 7, leafSize: 1.7 }
  },
  {
    name: "oak_c",
    preset: "Oak Medium",
    seed: 33,
    kind: "broad",
    k: { levels: 2, children: 0.7, leafCount: 7, leafSize: 1.7 }
  },
  {
    name: "ash_a",
    preset: "Ash Medium",
    seed: 44,
    kind: "broad",
    k: { levels: 2, children: 0.7, leafCount: 7, leafSize: 1.6 }
  },
  {
    name: "ash_b",
    preset: "Ash Medium",
    seed: 55,
    kind: "broad",
    k: { levels: 2, children: 0.7, leafCount: 7, leafSize: 1.6 }
  },
  {
    name: "aspen_a",
    preset: "Aspen Medium",
    seed: 66,
    kind: "broad",
    k: { levels: 2, children: 0.8, leafCount: 8, leafSize: 1.5 }
  },
  {
    name: "pine_a",
    preset: "Pine Medium",
    seed: 88,
    kind: "conifer",
    k: { levels: 1, children: 0.55, leafCount: 5, leafSize: 1.5 }
  },
  {
    name: "pine_b",
    preset: "Pine Medium",
    seed: 99,
    kind: "conifer",
    k: { levels: 1, children: 0.55, leafCount: 5, leafSize: 1.5 }
  },
  {
    name: "bush_a",
    preset: "Bush 2",
    seed: 102,
    kind: "bush",
    k: { levels: 2, children: 0.8, leafCount: 6, leafSize: 1.3 }
  },
  {
    name: "bush_b",
    preset: "Bush 3",
    seed: 103,
    kind: "bush",
    k: { levels: 2, children: 0.7, leafCount: 6, leafSize: 1.3 }
  }
]

function makeLite(v) {
  const tree = new Tree()
  tree.loadPreset(v.preset)
  tree.options.seed = v.seed
  tuned(tree.options, v.k)
  tree.generate()
  return tree
}

const triOf = (m) => {
  const g = m.geometry
  return (g.index ? g.index.count : g.attributes.position.count) / 3
}

/** 贴图缩小后转 PNG dataURL（叶片带透明通道） */
function texData(tex, size) {
  const img = tex?.image
  if (!img) return null
  const c = document.createElement("canvas")
  c.width = c.height = size
  const g = c.getContext("2d")
  g.clearRect(0, 0, size, size)
  g.drawImage(img, 0, 0, size, size)
  return c.toDataURL("image/png")
}

const b64 = (typed) => {
  const u8 = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength)
  let s = ""
  for (let i = 0; i < u8.length; i += 0x8000)
    s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  return btoa(s)
}

window.treeLab.probeAll = async () => {
  const out = []
  for (const v of LITE) {
    const tree = makeLite(v)
    const st = stats(tree)
    out.push({
      name: v.name,
      kind: v.kind,
      barkTris: Math.round(triOf(tree.branchesMesh)),
      leafTris: Math.round(triOf(tree.leavesMesh)),
      h: +st.height.toFixed(1),
      crownR: +st.crownRadius.toFixed(1),
      crownBottom: +st.crownBottom.toFixed(1)
    })
  }
  return out
}

/** 导出：每个变体的树皮 / 叶片几何（Float32 / Uint16 的 base64）和变体用到的贴图（缩小的 PNG dataURL） */
window.treeLab.exportLite = async () => {
  const trees = []
  const textures = {}
  for (const v of LITE) {
    const tree = makeLite(v)
    await textured(tree)
    const st = stats(tree)
    const bg = tree.branchesMesh.geometry
    const lg = tree.leavesMesh.geometry
    const leafType = tree.options.leaves.type
    const barkType = tree.options.bark.type
    if (!textures[`leaf_${leafType}`])
      textures[`leaf_${leafType}`] = texData(tree.leavesMesh.material.map, 128)
    if (!textures[`bark_${barkType}`])
      textures[`bark_${barkType}`] = texData(tree.branchesMesh.material.map, 64)
    const idx = (g) =>
      g.index.array instanceof Uint16Array
        ? g.index.array
        : Uint16Array.from(g.index.array)
    trees.push({
      name: v.name,
      kind: v.kind,
      leafType,
      barkType,
      alphaTest: tree.options.leaves.alphaTest,
      stats: {
        height: st.height,
        crownRadius: st.crownRadius,
        crownBottom: st.crownBottom,
        crownTop: st.crownTop,
        barkTris: Math.round(triOf(tree.branchesMesh)),
        leafTris: Math.round(triOf(tree.leavesMesh))
      },
      bark: {
        pos: b64(bg.attributes.position.array),
        nor: b64(bg.attributes.normal.array),
        uv: b64(bg.attributes.uv.array),
        idx: b64(idx(bg))
      },
      leaves: {
        pos: b64(lg.attributes.position.array),
        nor: b64(lg.attributes.normal.array),
        uv: b64(lg.attributes.uv.array),
        idx: b64(idx(lg))
      }
    })
  }
  return { trees, textures }
}

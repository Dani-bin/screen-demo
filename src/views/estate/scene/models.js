/**
 * Blender 做的模型：楼栋（estate/buildings.glb）和树冠（estate/trees.glb）
 * ----------------------------------------------------------
 * 建模脚本在 scripts/blender/estate/（命令见 CLAUDE.md）。任何一个文件读不到都不报错，
 * 对应部分退回程序化的盒子楼和球形树冠，页面照样能开。
 */
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js"

/**
 * @returns {Promise<{buildings: object|null, trees: {broad: THREE.BufferGeometry[], cone: THREE.BufferGeometry}|null}>}
 */
export async function loadModels() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const base = `${import.meta.env.BASE_URL}estate/`
  const get = (f) =>
    loader.loadAsync(base + f).catch((e) => {
      console.warn(`[estate] ${f} 读取失败，退回程序化模型：`, e?.message ?? e)
      return null
    })
  const [buildings, t] = await Promise.all([
    get("buildings.glb"),
    get("trees.glb")
  ])
  let trees = null
  if (t) {
    const g = {}
    t.scene.traverse((o) => {
      if (o.isMesh) g[o.name] = o.geometry
    })
    if (g.tree_a && g.tree_b && g.tree_c && g.cone)
      trees = { broad: [g.tree_a, g.tree_b, g.tree_c], cone: g.cone }
  }
  return { buildings, trees }
}

/** 地面 AO 图（Blender 烘的天空可见度，白 = 空旷，暗 = 楼脚下）；读不到返回 null */
export function loadGroundAo() {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = `${import.meta.env.BASE_URL}estate/ground_ao.webp`
  })
}

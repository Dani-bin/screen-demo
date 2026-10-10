/*
 * 楼宇级 · 烘焙楼层模型
 * ----------------------------------------------------------
 * public/building/tower_S.glb / tower_N.glb 由 scripts/blender/tower/ 生成（Blender 建模 + Cycles 烘焙室内灯光）：
 * 每种楼层一个变体，对象 <变体>（楼板顶面 + 核心筒墙，烘焙贴图）与 <变体>_v（家具、灯盘、天花、板边，烘焙顶点色）。
 * 变体：off_100 / off_85 / off_70 / off_55 / off_40（办公，数字为亮灯比例）、lobby、retail、plant、sky。
 * 光照已经烘在颜色里，这里一律用 MeshBasicMaterial 显示（不参与实时光照），材质色乘模式亮度。
 */
import { Color, MeshBasicMaterial } from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"

/** 办公层变体与亮灯比例 */
const OFFICE = [
  ["off_100", 1.0],
  ["off_85", 0.85],
  ["off_70", 0.7],
  ["off_55", 0.55],
  ["off_40", 0.4]
]

/**
 * 加载一座塔的楼层变体，返回 { 变体名: { parts: [{ geometry, material }] } }
 * 每个变体的两部分各一份材质（同一变体的所有楼层共用），模式切换时改 material.color
 */
export async function loadFloorVariants(url) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const gltf = await loader.loadAsync(url)
  const variants = {}
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return
    const vc = o.name.endsWith("_v")
    const name = vc ? o.name.slice(0, -2) : o.name
    const map = o.material.map || null
    if (map) map.anisotropy = 4
    const material = vc
      ? new MeshBasicMaterial({ vertexColors: true })
      : new MeshBasicMaterial({ map })
    o.material.dispose()
    ;(variants[name] ||= { parts: [] }).parts.push({
      geometry: o.geometry,
      material
    })
  })
  return variants
}

/**
 * 按楼层数据选变体：大堂 / 商业 / 设备层 / 会所按类型；办公层按入驻率选亮灯比例最接近的，
 * 与下一层相同时换次接近的那个（相邻楼层不要一模一样）
 */
export function pickVariant(floor, below) {
  if (floor.kind === "lobby") return floor.index <= 2 ? "lobby" : "retail"
  if (floor.kind === "plant") return "plant"
  if (floor.kind === "sky") return "sky"
  const occ = (floor.occupancy ?? 60) / 100
  const ranked = OFFICE.slice().sort(
    (a, b) => Math.abs(a[1] - occ) - Math.abs(b[1] - occ)
  )
  return ranked[0][0] === below ? ranked[1][0] : ranked[0][0]
}

/** 设备层在「机电系统」模式下的绿色 */
export const PLANT_TINT = new Color(0.35, 1.0, 0.6)

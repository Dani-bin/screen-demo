/*
 * 建筑
 * ----------------------------------------------------------
 * 每栋楼由真实轮廓 ExtrudeGeometry 挤出，按楼高分三档配色写进顶点色：
 *   矮楼 (< lowMax)     暖色盘随机
 *   中楼                灰白 / 浅蓝盘随机
 *   高楼 (>= glassMin)  蓝色玻璃，自底向上渐变
 * 屋顶（法线朝上的面）统一提亮。窗格由片元着色器按世界坐标绘制，不占顶点。
 *
 * 全部楼栋合并为一个 Mesh（一次 draw call）；faceToBuilding 记录每个三角形属于哪栋楼，
 * 供射线拾取把命中的面换算回楼栋索引。
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ExtrudeGeometry,
  Mesh,
  MeshStandardMaterial
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { polygonToShape } from "./terrain.js"
import { hash01 } from "./utils.js"

const WHITE = new Color("#ffffff")

/**
 * 挤出单栋楼；轮廓少于 3 点或楼高无效返回 null。
 * 返回的是只含 position / normal 的非索引几何体，且已去掉底面。
 */
export function extrudeBuilding(building) {
  if (!building.p || building.p.length < 3 || !(building.h > 0)) return null
  const g = new ExtrudeGeometry(polygonToShape(building.p), {
    depth: building.h,
    bevelEnabled: false
  })
  // 挤出沿 +Z，绕 X 轴转 -90° 后变成沿 +Y（向上）
  g.rotateX(-Math.PI / 2)

  // 剔除底面（法线朝下的三角形）：贴地永远看不见，约占全部三角形的 20%。
  // 阴影通道对正面材质画背面，墙体背光面仍会写入深度，去掉底面不影响投影。
  // ExtrudeGeometry 是非索引几何体、每个面法线一致，取三角形首顶点法线判断即可。
  const srcPos = g.attributes.position.array
  const srcNor = g.attributes.normal.array
  const pos = new Float32Array(srcPos.length)
  const nor = new Float32Array(srcNor.length)
  let n = 0 // 已写入的浮点数个数
  for (let k = 0; k < srcPos.length; k += 9) {
    if (srcNor[k + 1] < -0.5) continue
    pos.set(srcPos.subarray(k, k + 9), n)
    nor.set(srcNor.subarray(k, k + 9), n)
    n += 9
  }
  g.dispose()

  const out = new BufferGeometry()
  out.setAttribute("position", new BufferAttribute(pos.slice(0, n), 3))
  out.setAttribute("normal", new BufferAttribute(nor.slice(0, n), 3))
  return out
}

/**
 * 按楼高与索引决定这栋楼的基色与屋顶色。
 * @returns {{ base: Color, roof: Color, glass: boolean }}
 */
export function buildingColors(height, index, theme) {
  const base = new Color()
  let glass = false
  if (height >= theme.glassMin) {
    glass = true
    base.set(theme.glassBottom)
  } else if (height < theme.lowMax) {
    base.set(
      theme.lowPalette[Math.floor(hash01(index) * theme.lowPalette.length)]
    )
  } else {
    base.set(
      theme.midPalette[Math.floor(hash01(index) * theme.midPalette.length)]
    )
  }
  const roof = base
    .clone()
    .lerp(WHITE, glass ? theme.glassRoofLighten : theme.roofLighten)
  return { base, roof, glass }
}

/**
 * 给挤出几何体写入 color / aGlass 顶点属性。
 * 玻璃楼侧面按高度从 glassBottom 渐变到 glassTop。
 * @param {Color} [top] 玻璃顶色；批量调用时由外部传入同一实例，避免每栋楼新建
 */
export function paintBuilding(
  geometry,
  building,
  index,
  theme,
  top = new Color(theme.glassTop)
) {
  const { base, roof, glass } = buildingColors(building.h, index, theme)
  const tmp = new Color()
  const pos = geometry.attributes.position
  const nor = geometry.attributes.normal
  const col = new Float32Array(pos.count * 3)
  const ag = new Float32Array(pos.count)
  const span = Math.max(theme.glassGradientMin, building.h)
  for (let i = 0; i < pos.count; i++) {
    let c = base
    if (nor.getY(i) > 0.5) {
      c = roof
    } else if (glass) {
      // 钳到 0：旋转后底部 y 有 -1e-14 量级误差，负数做分数次幂会得到 NaN
      const t = Math.min(1, Math.max(0, pos.getY(i)) / span)
      c = tmp.copy(base).lerp(top, t)
    }
    col[i * 3] = c.r
    col[i * 3 + 1] = c.g
    col[i * 3 + 2] = c.b
    ag[i] = glass ? 1 : 0
  }
  geometry.setAttribute("color", new BufferAttribute(col, 3))
  geometry.setAttribute("aGlass", new BufferAttribute(ag, 1))
  return geometry
}

/**
 * 在标准材质里注入窗格：
 * 侧面按世界坐标取格子，玻璃楼画明暗玻璃条带，普通楼画淡淡的窗格；屋顶不画。
 */
export function applyWindowShader(material, theme) {
  const w = theme.window
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWinStep = { value: [w.stepX, w.stepY] }
    shader.uniforms.uWinGap = { value: [w.gapX, w.gapY] }
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float aGlass;\nvarying float vGlass;\nvarying vec3 vWPos;\nvarying vec3 vWN;"
      )
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvGlass = aGlass;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);"
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec2 uWinStep;\nuniform vec2 uWinGap;\nvarying float vGlass;\nvarying vec3 vWPos;\nvarying vec3 vWN;"
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        if (vWN.y < 0.5) {
          // 沿墙面切线取横向坐标，斜墙窗格不再被拉宽
          vec2 t = normalize(vec2(-vWN.z, vWN.x));
          float u = dot(vWPos.xz, t);
          vec2 g = vec2(u / uWinStep.x, vWPos.y / uWinStep.y);
          vec2 fw = fwidth(g);
          float win = step(uWinGap.y, fract(g.y)) * step(uWinGap.x, fract(g.x));
          // 远景一个像素已大于半个窗格周期，硬边会混叠闪烁，按屏幕导数把窗格淡出成平均覆盖率
          float mean = (1.0 - uWinGap.x) * (1.0 - uWinGap.y);
          win = mix(win, mean, smoothstep(0.25, 0.5, max(fw.x, fw.y)));
          if (vGlass > 0.5) {
            diffuseColor.rgb = mix(diffuseColor.rgb * 0.62, diffuseColor.rgb * 1.12 + vec3(0.04, 0.08, 0.12), win);
          } else {
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.72, 0.78, 0.88), win * 0.55);
          }
        }`
      )
  }
  return material
}

/**
 * 全部楼栋 → 单个 Mesh。
 * @param {Array} buildings 楼栋数组
 * @param {object} theme THEME
 * @param {Set<number>} [excluded] 不画的楼栋索引（已被景点精细模型替换）；
 *   跳过的楼不参与合并，faceToBuilding 仍记录原始索引，拾取结果与 buildings 下标对应
 * @returns {{ mesh: Mesh, material: MeshStandardMaterial, faceToBuilding: Int32Array, dispose: Function }}
 */
export function createBuildings(buildings, theme, excluded = new Set()) {
  // 材质先建：即使没有有效楼栋，调用方也能统一 dispose
  const material = applyWindowShader(
    new MeshStandardMaterial({
      vertexColors: true,
      roughness: theme.buildingRoughness,
      metalness: 0.05
    }),
    theme
  )

  const top = new Color(theme.glassTop) // 所有玻璃楼共用的顶色
  const geos = []
  const owners = [] // 每个几何体对应的楼栋索引
  buildings.forEach((b, i) => {
    if (excluded.has(i)) return
    const g = extrudeBuilding(b)
    if (!g) return
    paintBuilding(g, b, i, theme, top)
    geos.push(g)
    owners.push(i)
  })

  // 没有任何有效楼栋：mergeGeometries 不接受空数组，返回空几何体占位
  if (geos.length === 0) {
    const empty = new BufferGeometry()
    return {
      mesh: new Mesh(empty, material),
      material,
      faceToBuilding: new Int32Array(0),
      dispose() {
        empty.dispose()
        material.dispose()
      }
    }
  }

  const merged = mergeGeometries(geos)

  // 非索引几何体：三角形 k 由顶点 3k..3k+2 组成；按合并顺序记录每个三角形所属楼栋
  const totalFaces = merged.attributes.position.count / 3
  const faceToBuilding = new Int32Array(totalFaces)
  let cursor = 0
  geos.forEach((g, gi) => {
    const faces = g.attributes.position.count / 3
    faceToBuilding.fill(owners[gi], cursor, cursor + faces)
    cursor += faces
  })
  geos.forEach((g) => g.dispose())

  const mesh = new Mesh(merged, material)
  mesh.castShadow = true
  mesh.receiveShadow = true

  return {
    mesh,
    material,
    faceToBuilding,
    dispose() {
      merged.dispose()
      material.dispose()
    }
  }
}

/**
 * 单栋楼的高亮体：重新挤出一份，套高亮材质，略抬高避免与原楼体共面。
 * 返回的几何体归调用方所有，移除高亮时须调用 mesh.geometry.dispose()（材质为共享材质，不要释放）。
 */
export function createHighlight(building, materials) {
  const g = extrudeBuilding(building)
  if (!g) return null
  g.translate(0, 0.3, 0)
  const mesh = new Mesh(g, materials.highlight)
  mesh.renderOrder = 2
  return mesh
}

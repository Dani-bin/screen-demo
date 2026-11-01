/*
 * /estate 还原：楼体立面的"实体格构"——真凹窗
 * ----------------------------------------------------------
 * facade.js 的着色器只是在平墙上"画"出凹窗，近看是平的。这里在每面墙上补真实几何，让窗洞真的凹进去：
 * 楼体盒子本身的表面 = 窗洞的底面（上面仍是着色器画的窗帘 / 暖光）；窗洞之间的实体——
 *   - 横梁：每层窗之间的楼板带（含最下和最上各一条），贯通整面墙，凸出墙面 depth × beam（默认一半：设计稿里是竖向的白色墩子最醒目，
 *     横向楼板线条是收进去的；梁也浅，相机俯角大时上梁就不会把窗遮成一条缝）；
 *   - 竖墩：每两扇窗之间一根，通高，凸出 depth（比横梁往后缩 2 cm，免得共面闪烁）；
 *   - 成组窗的组间：中间一条深槽（只凸出 GROOVE_D，比两侧壁柱低得多）+ 两侧各一根浅色壁柱（再多凸出 PIL_OUT）；
 *   - 四个楼角各一根通高角柱；
 * 全部做成实例化盒子（整座沙盘一个 InstancedMesh、一次绘制，几千个盒子）。窗洞的位置 / 大小和 facade.js 里
 * 着色器画的窗完全一致（同一个开间数、层数、窗比例、竖向居中 0.46、同一个沿墙方向），所以梁和墩的边就是窗的边。
 * 进深不能大：相机俯角约 54°，进深 0.5 m 时上梁会遮住窗口约 1/3（窗口露出高度 = 窗高 − 进深 × tan54°），所以取 0.35–0.5 m。
 * 颜色用实例色：墙色、壁柱 ×1.16、深槽 ×0.42；楼脚压暗 / 上亮下暗用楼体自己的高度（和 facade.js 完全一致，
 * 每个实例带 aB = (楼脚世界高度, 楼高, 楼脚压暗范围)）。
 */
import * as THREE from "three"

const UP = new THREE.Vector3(0, 1, 0)
/** 深槽凸出墙面多少（m）：比普通墩 / 壁柱低得多，才是"深"槽 */
const GROOVE_D = 0.12
/** 壁柱比普通墩再多凸出多少（m） */
const PIL_OUT = 0.35
/** 窗洞在层距里的竖向中心（和 facade.js 的 wc.y 一致） */
const WIN_CY = 0.46

/**
 * @param {object[]} targets  [{ id, size: [w, h, d], foot: footprints 里的体积（cx, cy=北, top, h, ry）, params: facade 参数（含 depth） }]
 * @returns {THREE.InstancedMesh | null}
 */
export function buildLattice(targets) {
  // 每个实例：矩阵、颜色、aB
  const items = []
  const q = new THREE.Quaternion()
  const base = new THREE.Matrix4()
  const loc = new THREE.Matrix4()
  const ident = new THREE.Quaternion()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const one = new THREE.Vector3(1, 1, 1)
  const center = new THREE.Vector3()

  for (const t of targets) {
    const f = t.foot
    if (!f) continue
    const P = t.params
    const [w, h, d] = t.size
    const p = P.depth ?? 0.45
    const pb = p * (P.beam ?? 0.5) // 横梁的凸出量
    const wall = new THREE.Color(P.color).multiplyScalar(P.latGain ?? 1)
    const pil = wall.clone().multiplyScalar(1.3)
    const groove = wall.clone().multiplyScalar(0.35)
    // 楼体中心的世界坐标（three：x = 东，y = 上，z = −北），和楼体绕 Y 的旋转（和 extras.js 的 boxInstances 一致）
    const baseY = f.top - f.h
    center.set(f.cx, f.top - f.h / 2, -f.cy)
    q.setFromAxisAngle(UP, f.ry || 0)
    base.compose(center, q, one)
    const aB = [baseY, h, P.foot ?? 12]

    /** 在楼体局部坐标放一个盒子：中心 (x, y, z)、尺寸 (sx, sy, sz) */
    const put = (x, y, z, sx, sy, sz, color) => {
      pos.set(x, y, z)
      scl.set(sx, sy, sz)
      loc.compose(pos, ident, scl)
      items.push({
        m: new THREE.Matrix4().multiplyMatrices(base, loc),
        c: color,
        b: aB
      })
    }

    const [ww, wh] = P.win
    // 四个面：dir 是"沿墙坐标 along 增大时，局部坐标轴的方向"，和 facade.js 里
    // along = (ew ? z * sign(nx) : x * -sign(nz)) + fw / 2 对得上：+z 面 −x、−z 面 +x、+x 面 +z、−x 面 −z
    for (const face of [
      { nz: 1, len: w, half: d / 2, ns: true, dir: -1 },
      { nz: -1, len: w, half: d / 2, ns: true, dir: 1 },
      { nx: 1, len: d, half: w / 2, ns: false, dir: 1 },
      { nx: -1, len: d, half: w / 2, ns: false, dir: -1 }
    ]) {
      const fw = face.len
      const nb = Math.max(1, Math.floor(fw / P.bay + 0.5))
      const bw = fw / nb
      const nr = Math.max(1, Math.floor(h / P.row + 0.5))
      const rh = h / nr
      /** 墙面坐标系里的一个盒子：沿墙 [a0, a1]、竖向 [y0, y1]（从楼脚算）、凸出 so */
      const wallBox = (a0, a1, y0, y1, so, color) => {
        const sa = a1 - a0
        const sy = y1 - y0
        if (sa < 0.02 || sy < 0.02) return
        const ac = face.dir * ((a0 + a1) / 2 - fw / 2)
        const yc = (y0 + y1) / 2 - h / 2
        const out = face.half + so / 2
        if (face.ns) put(ac, yc, face.nz * out, sa, sy, so, color)
        else put(face.nx * out, yc, ac, so, sy, sa, color)
      }
      // 横梁：每层窗洞之间一条（含最下、最上各一条），贯通整面
      for (let k = 0; k <= nr; k++) {
        const y0 = k === 0 ? 0 : (k - 1 + WIN_CY + wh / 2) * rh
        const y1 = k === nr ? h : (k + WIN_CY - wh / 2) * rh
        // 成组的楼：横梁在组界深槽处断开（设计稿里深槽是一条贯通整个楼高的深色竖线，楼板线不穿过它）
        let from = 0
        if (P.group > 0) {
          const g = (P.groove ?? 0.6) / 2
          for (let i = P.group; i < nb; i += P.group) {
            wallBox(from, i * bw - g, y0, y1, pb, wall)
            from = i * bw + g
          }
        }
        wallBox(from, fw, y0, y1, pb, wall)
      }
      // 竖墩：窗洞之间；成组的组界上是 壁柱 + 深槽 + 壁柱
      for (let i = 0; i <= nb; i++) {
        const a0 = i === 0 ? 0 : (i - 1 + 0.5 + ww / 2) * bw
        const a1 = i === nb ? fw : (i + 0.5 - ww / 2) * bw
        const boundary = P.group > 0 && i > 0 && i < nb && i % P.group === 0
        if (!boundary) {
          wallBox(a0, a1, 0, h, p - 0.02, wall)
          continue
        }
        const c = i * bw
        const g = (P.groove ?? 0.6) / 2
        const pl = P.pilaster ?? 0.5
        const lo = Math.max(a0, c - g - pl)
        const hi = Math.min(a1, c + g + pl)
        wallBox(a0, lo, 0, h, p - 0.02, wall)
        wallBox(lo, c - g, 0, h, p + PIL_OUT, pil)
        wallBox(c - g, c + g, 0, h, GROOVE_D, groove)
        wallBox(c + g, hi, 0, h, p + PIL_OUT, pil)
        wallBox(hi, a1, 0, h, p - 0.02, wall)
      }
    }
    // 楼角通高角柱（盖住四个楼角，比梁再往外 0 cm，同深）
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        put(sx * (w / 2 + p / 2), 0, sz * (d / 2 + p / 2), p, h, p, wall)
  }
  if (!items.length) return null

  const geo = new THREE.BoxGeometry(1, 1, 1)
  const aBArr = new Float32Array(items.length * 3)
  items.forEach((it, i) => aBArr.set(it.b, i * 3))
  geo.setAttribute("aB", new THREE.InstancedBufferAttribute(aBArr, 3))

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.78
  })
  // 楼脚压暗 / 上亮下暗：和 facade.js 的墙面公式一致（foot = smoothstep(0, 压暗范围, 离楼脚高度)，
  // 上亮 = 0.93 + 0.14 * smoothstep(0.5, 1, 高度占比)）；梁墩各面的朝向 / 受光由法线自然给出
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec3 aB;\nvarying vec3 vB;\nvarying float vWY;"
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vB = aB;
        vec4 lw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          lw = instanceMatrix * lw;
        #endif
        vWY = (modelMatrix * lw).y;`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vB;\nvarying float vWY;"
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        float lUp = max(vWY - vB.x, 0.0);
        float lFoot = smoothstep(0.0, vB.z, lUp);
        float lHh = clamp(lUp / vB.y, 0.0, 1.0);
        diffuseColor.rgb *= mix(0.55, 1.0, lFoot) * (0.93 + 0.14 * smoothstep(0.5, 1.0, lHh));`
      )
  }
  const mesh = new THREE.InstancedMesh(geo, mat, items.length)
  items.forEach((it, i) => {
    mesh.setMatrixAt(i, it.m)
    mesh.setColorAt(i, it.c)
  })
  mesh.name = "rep_lattice"
  mesh.castShadow = false
  mesh.receiveShadow = true
  // 盒子分布在整个底座上，实例的包围球按原点算会被裁掉
  mesh.frustumCulled = false
  return mesh
}

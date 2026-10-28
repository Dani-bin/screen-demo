/*
 * 智慧港口 设备几何（程序化建模）
 * ----------------------------------------------------------
 * 尺寸依据 02-research.md：
 *   岸桥：轨距 30 m，起升高度轨上 49 m，前伸距 70 m、后伸距 20 m，双小车（主小车在主梁上，门架小车在下层梁上），
 *        中转平台在陆侧门框附近；整机高度、仰臂高度没查到，按大梁下缘约 50 m、A 字架顶约 80 m 取（假设）
 *   轨道吊：轨距 31 m，起升 19.75 m，吊具下 41 t
 *   AGV：约 15 × 3 m（影像量测），顶升平台载 1 个 40 尺箱
 *   集装箱：40 尺 12.19 × 2.44 × 2.59 m，层高按 2.6 m
 * 几何都用顶点色拼成一个 BufferGeometry（颜色按主题烘进去），一类设备一份几何、多台共用或实例化。
 *
 * 局部坐标：x 沿岸线（u），y 向上，z = −v（海在 +z）。
 */
import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"

export const TIER_H = 2.6
export const BOX40 = { len: 12.19, wid: 2.44 }

const _c = new THREE.Color()
/** 带顶点色的长方体：中心 (x, y, z)，尺寸 w × h × d */
function box(w, h, d, x, y, z, color) {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return paint(g, color)
}
function paint(g, color) {
  _c.set(color)
  const n = g.attributes.position.count
  const c = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    c[i * 3] = _c.r
    c[i * 3 + 1] = _c.g
    c[i * 3 + 2] = _c.b
  }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3))
  if (g.index) return g.toNonIndexed()
  return g
}
/** 两点之间的方截面杆件 */
function beam(a, b, t, color) {
  const A = new THREE.Vector3(...a)
  const B = new THREE.Vector3(...b)
  const len = A.distanceTo(B)
  const g = new THREE.BoxGeometry(t, len, t)
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    B.clone().sub(A).normalize()
  )
  g.applyQuaternion(q)
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2)
  return paint(g, color)
}
const merge = (list) =>
  mergeGeometries(
    list.map((g) => (g.index ? g.toNonIndexed() : g)),
    false
  )

/* ---------------- 岸桥（双小车） ---------------- */

/** 岸桥各部件的关键尺寸（局部坐标，原点在两轨中点的轨顶） */
export const STS = {
  legX: 11.5, // 门腿离中心（沿岸线）
  seaZ: 15, // 海侧腿（v=6）
  landZ: -15, // 陆侧腿（v=36）
  girderY: 50, // 主梁下缘
  boomTipZ: 85, // 前大梁端（前伸距 70 m）
  backZ: -35, // 后伸距端（20 m）
  apexY: 80,
  platformY: 26, // 中转平台
  lowerY: 30, // 门架小车梁
  backAgvZ: -34 // 门架小车放箱位置（v≈55）
}

/** 岸桥固定结构（门框、主梁陆侧段、A 字架、机房）；前大梁单独一份，可以仰起 */
export function stsFrame(t, { lite = false } = {}) {
  const C = t.crane
  const S = STS
  const parts = []
  // lite：只留主要构件（全息描边用）——台车、下层梁、栏杆、后拉杆、爬梯、电缆卷盘这些细小构件不描边，
  // 总览里它们的线挤在一起，岸桥读起来像格构铁塔，看不清门腿、主梁和 A 字架
  const minor = (g) => !lite && parts.push(g)
  for (const sx of [-1, 1])
    for (const z of [S.seaZ, S.landZ]) {
      // 门腿（下粗上细两段）与大车台车
      parts.push(box(2.4, 22, 2.4, sx * S.legX, 14, z, C.frame))
      parts.push(box(2.0, 26, 2.0, sx * S.legX, 37, z, C.frame))
      minor(box(9, 2.6, 2.6, sx * S.legX, 1.3, z, C.dark))
    }
  for (const sx of [-1, 1]) {
    // 下横撑（沿 z 连海陆侧腿）、门框上横梁（沿 x）
    parts.push(box(1.8, 2.4, S.seaZ - S.landZ, sx * S.legX, 16, 0, C.frame))
    // 斜撑
    parts.push(
      beam([sx * S.legX, 17, S.landZ], [sx * S.legX, 46, S.seaZ], 1.0, C.frame)
    )
  }
  for (const z of [S.seaZ, S.landZ])
    parts.push(box(S.legX * 2 + 2.4, 3, 2.6, 0, 48.5, z, C.frame))
  // 主梁（陆侧段 + 后伸距）：两根箱形梁
  for (const gx of [-3.4, 3.4])
    parts.push(
      box(
        1.7,
        4,
        S.seaZ - S.backZ,
        gx,
        S.girderY + 2,
        (S.seaZ + S.backZ) / 2,
        C.frame
      )
    )
  // 下层梁（门架小车走行）
  for (const gx of [-2.6, 2.6])
    minor(
      box(
        1.0,
        1.6,
        S.seaZ - 6 - S.backZ,
        gx,
        S.lowerY,
        (S.seaZ - 6 + S.backZ) / 2,
        C.frame
      )
    )
  // 中转平台
  parts.push(box(20, 1.2, 9, 0, S.platformY, -8, C.machine))
  minor(box(20.4, 1.2, 0.3, 0, S.platformY + 0.9, -3.4, C.dark))
  // A 字架（门框上方，靠陆侧）
  const apexZ = -9
  for (const sx of [-1, 1]) {
    parts.push(
      beam([sx * S.legX, 50, S.landZ], [sx * 2.8, S.apexY, apexZ], 1.6, C.frame)
    )
    parts.push(
      beam([sx * S.legX, 50, S.seaZ], [sx * 2.8, S.apexY, apexZ], 1.4, C.frame)
    )
    // 后拉杆
    minor(
      beam(
        [sx * 2.8, S.apexY, apexZ],
        [sx * 3.4, S.girderY + 4, S.backZ + 2],
        0.5,
        C.cable
      )
    )
  }
  parts.push(box(7, 2, 2, 0, S.apexY + 0.5, apexZ, C.frame))
  // 机房（后伸距端）与司机室通道
  parts.push(box(11, 7, 13, 0, S.girderY + 7.5, S.backZ + 7, C.machine))
  minor(box(11.2, 1.2, 13.2, 0, S.girderY + 11.6, S.backZ + 7, C.dark))
  minor(box(1.2, 26, 1.2, S.legX + 1.6, 30, S.landZ, C.dark)) // 爬梯 / 电梯井
  // 电缆卷盘（陆侧腿外）
  minor(box(1.2, 5, 5, -S.legX - 1.8, 5, S.landZ, C.dark))
  return merge(parts)
}

/** 前大梁（海侧段）：绕 (z = seaZ, y = girderY + 2) 转动可仰起 */
export function stsBoom(t) {
  const C = t.crane
  const S = STS
  const L = S.boomTipZ - S.seaZ
  const parts = []
  for (const gx of [-3.4, 3.4])
    parts.push(box(1.6, 3.6, L, gx, 0, L / 2, C.frame))
  // 端部横梁与警示色
  parts.push(box(8.4, 3.6, 1.6, 0, 0, L - 0.8, C.accent))
  for (let z = 10; z < L - 4; z += 12)
    parts.push(box(6.8, 0.6, 0.6, 0, 1.6, z, C.frame))
  // 前拉杆（从 A 字架顶到前大梁），转动时跟着前大梁走，近似成固定在前大梁上的斜杆
  for (const gx of [-3.4, 3.4]) {
    parts.push(
      beam(
        [gx * 0.82, S.apexY - S.girderY - 2, -24],
        [gx, 1.8, L * 0.55],
        0.45,
        C.cable
      )
    )
    parts.push(
      beam(
        [gx * 0.82, S.apexY - S.girderY - 2, -24],
        [gx, 1.8, L - 2],
        0.45,
        C.cable
      )
    )
  }
  return merge(parts)
}

/** 主小车（在主梁上）与吊具（双 20 尺 / 40 尺吊具，12.2 m） */
export function stsTrolley(t) {
  const C = t.crane
  return merge([
    box(8.2, 3.2, 7, 0, 1.6, 0, C.machine),
    box(2.4, 2.4, 2.6, 2.6, -1.4, 2.6, C.dark)
  ])
}
export function spreader(t, len = 12.2) {
  const C = t.crane
  return merge([
    box(len, 0.9, 2.5, 0, 0, 0, C.dark),
    box(len * 0.4, 0.6, 1.4, 0, 0.8, 0, C.machine)
  ])
}
/** 门架小车（下层梁上，较小） */
export function stsGantryTrolley(t) {
  const C = t.crane
  return merge([box(6.4, 2.2, 5, 0, 1.1, 0, C.machine)])
}

/* ---------------- 自动化轨道吊 ---------------- */

export const ARMG = { span: 31, height: 24, width: 12, trolleyY: 25.5 }

/** 轨道吊门框（局部：x 跨箱区 = u 方向，z = −v 为行走方向） */
export function armgFrame(t) {
  const C = t.rmg
  const A = ARMG
  const hx = A.span / 2
  const hz = A.width / 2
  const parts = []
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(
        box(1.4, A.height, 1.4, sx * hx, A.height / 2, sz * hz, C.frame)
      )
      parts.push(box(1.8, 1.8, 3.6, sx * hx, 0.9, sz * hz, C.dark))
    }
    // 两侧下纵梁
    parts.push(box(1.2, 1.4, A.width, sx * hx, 3.2, 0, C.frame))
    parts.push(box(1.0, 1.2, A.width, sx * hx, A.height - 1, 0, C.frame))
  }
  // 两根主梁（跨箱区）
  for (const sz of [-1, 1])
    parts.push(box(A.span + 3, 2.4, 1.6, 0, A.height + 0.6, sz * 3.2, C.frame))
  // 电气房
  parts.push(box(4, 3, 4.5, hx - 1, A.height - 3.2, hz + 2.6, C.dark))
  return merge(parts)
}
export function armgTrolley(t) {
  const C = t.rmg
  return merge([box(5.5, 2.6, 8.4, 0, 1.3, 0, C.trolley)])
}

/* ---------------- AGV ---------------- */

/** AGV 车体（局部 x 为车头方向）：低平车身 + 顶升平台 */
export function agvBody(t) {
  const C = t.agv
  return merge([
    box(14.8, 1.2, 3.0, 0, 0.95, 0, C.body),
    box(13.0, 0.3, 2.7, 0, 1.7, 0, C.top),
    box(0.6, 0.6, 3.05, 7.3, 1.1, 0, "#d9dfe1"),
    box(0.6, 0.6, 3.05, -7.3, 1.1, 0, "#d9dfe1")
  ])
}

/* ---------------- 集装箱堆（箱区、船上共用） ---------------- */

/**
 * 箱堆实例化材质：单位长方体（x、z 是箱的长、宽，y 从 0 到 1），每个实例按层数缩放高度。
 * 着色器里按层号 + 实例种子从调色板取色（同一堆每层颜色不同），画出层缝与箱壁波纹；
 * aHi = 1 时用强调色（被跟踪船的装卸箱）。
 */
export function stackMaterial(
  t,
  {
    palette = t.containers,
    accent = t.accent,
    edge = t.holo ? t.holo.stackEdge || t.holo.edge : null,
    edgeGain = t.holo ? t.holo.edgeGain * t.holo.edgeDim : 0,
    // 全息：箱体本身的自发光（底色 × fill），让箱区 / 甲板箱呈发亮的半透明蓝
    fill = t.holo ? t.holo.stackFill ?? 0.35 : 0
  } = {}
) {
  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.8,
    metalness: 0.05
  })
  // 热度开关放在 userData 里（着色器编译前就要能改）
  mat.userData.heat = { value: 0 }
  const pal = palette.map((h) => new THREE.Color(h))
  while (pal.length < 6) pal.push(pal[pal.length % palette.length].clone())
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPal = { value: pal.slice(0, 6) }
    sh.uniforms.uAccent = { value: new THREE.Color(accent) }
    // 全息：箱堆棱线发光（顶面四边 + 竖向棱 + 淡淡的层缝）
    sh.uniforms.uEdge = {
      value: edge
        ? new THREE.Color(edge).multiplyScalar(edgeGain)
        : new THREE.Color(0)
    }
    sh.uniforms.uFill = { value: fill }
    // 箱区热度图层：0 = 正常配色，1 = 按所在箱区堆存率着色（aFill 0–1：青 → 金 → 红）
    sh.uniforms.uHeat = mat.userData.heat
    sh.uniforms.uHeatPal = {
      value: ["#1f6fd1", "#19e3ff", "#ffc53d", "#ff3b5c"].map(
        (h) => new THREE.Color(h)
      )
    }
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aTiers;
        attribute float aSeed;
        attribute float aHi;
        attribute float aFill;
        varying float vTier;
        varying float vSeed;
        varying float vHi;
        varying float vFill;
        varying vec3 vLoc;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vTier = position.y * aTiers;
        vSeed = aSeed;
        vHi = aHi;
        vFill = aFill;
        vLoc = position;`
      )
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform vec3 uPal[6];
        uniform vec3 uAccent;
        uniform vec3 uEdge;
        uniform float uFill;
        uniform float uHeat;
        uniform vec3 uHeatPal[4];
        varying float vTier;
        varying float vSeed;
        varying float vHi;
        varying float vFill;
        varying vec3 vLoc;
        // 堆存率 → 热度色（< 50 % 蓝、70 % 青、85 % 金、≥ 95 % 红）
        vec3 heatColor(float f) {
          vec3 c = mix(uHeatPal[0], uHeatPal[1], smoothstep(0.5, 0.7, f));
          c = mix(c, uHeatPal[2], smoothstep(0.7, 0.85, f));
          return mix(c, uHeatPal[3], smoothstep(0.85, 0.95, f));
        }
        float h1(float n) { return fract(sin(n * 91.345 + 17.13) * 43758.5453); }`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float tier = floor(vTier);
        int k = int(floor(h1(vSeed * 13.0 + tier * 7.0) * 5.999));
        vec3 base = uPal[0];
        for (int i = 1; i < 6; i++) if (i == k) base = uPal[i];
        // 同色箱轻微明暗差，避免整堆一片
        base *= 0.9 + 0.2 * h1(vSeed * 3.1 + tier);
        if (vHi > 0.5) base = uAccent * (0.92 + 0.12 * h1(tier + vSeed));
        if (uHeat > 0.5) base = heatColor(vFill) * (0.45 + 0.1 * h1(vSeed * 3.1 + tier));
        // 缝、条纹、棱线都按屏幕像素宽度画（fwidth）：箱子在屏幕上只有几个像素时，逐箱的细节淡出成均匀的亮度，
        // 远景不再出现摩尔纹噪点；拉近到箱子有十几像素宽时才画出层缝、箱壁波纹和发光棱线
        float f = fract(vTier);
        float fwT = max(fwidth(vTier), 1e-5);
        float seamK = smoothstep(3.0, 7.0, 1.0 / fwT);
        float seam = mix(1.0, smoothstep(0.4, 1.4, min(f, 1.0 - f) / fwT), seamK);
        float fwX = max(fwidth(vLoc.x), 1e-5);
        float ribK = smoothstep(3.0, 6.0, (1.0 / 38.0) / fwX);
        float rib = mix(0.97, 0.94 + 0.06 * step(0.5, fract(vLoc.x * 38.0)), ribK);
        diffuseColor.rgb *= base * mix(0.72, 1.0, seam) * rib;`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          // 到箱体棱的屏幕像素距离：只算这个面上变化的两根轴（面所在的那根轴导数为 0，不算棱）
          vec3 fw = fwidth(vLoc);
          vec3 dpx = vec3(
            fw.x > 1e-6 ? (0.5 - abs(vLoc.x)) / fw.x : 1e4,
            fw.y > 1e-6 ? (1.0 - vLoc.y) / fw.y : 1e4,
            fw.z > 1e-6 ? (0.5 - abs(vLoc.z)) / fw.z : 1e4
          );
          // 箱子沿各轴在屏幕上的长度（像素）。每根轴分开判断：沿这根轴够长（≥ 4–10 像素）才画它两端的棱，
          // 否则换成按覆盖率折算的均匀亮度。这样远景里沿箱长方向（12 m）的贝缝还在，箱宽方向（2.4 m）的列缝淡掉
          vec3 sz = vec3(
            fw.x > 1e-6 ? 1.0 / fw.x : 1e4,
            fw.y > 1e-6 ? 1.0 / fw.y : 1e4,
            fw.z > 1e-6 ? 1.0 / fw.z : 1e4
          );
          vec3 lk = smoothstep(4.0, 10.0, sz) * step(sz, vec3(9e3));
          vec3 ln = 1.0 - smoothstep(0.5, 1.5, dpx);
          float e = max(max(ln.x * lk.x, ln.y * lk.y), ln.z * lk.z);
          vec3 cov = min(vec3(1.0), 2.0 / max(sz, vec3(1.0))) * step(sz, vec3(9e3));
          // 折算的均匀亮度压低：远景箱区靠贝缝和箱组轮廓出结构，箱顶本身保持深蓝
          e = max(e, dot(1.0 - lk, cov) * 0.15);
          float top = step(0.999, vLoc.y);
          float sm = (1.0 - seam) * 0.12 * (1.0 - top);
          vec3 ec = vHi > 0.5 ? uAccent * 2.0 : uHeat > 0.5 ? heatColor(vFill) * 1.6 : uEdge;
          totalEmissiveRadiance += ec * (e + sm) + diffuseColor.rgb * uFill * (0.6 + 0.4 * top);
        }`
      )
  }
  return mat
}

/** 单位箱堆几何：x 方向长 lenX、z 方向宽 widZ，y 0 → 1 */
export function stackGeometry(lenX, widZ) {
  const g = new THREE.BoxGeometry(1, 1, 1)
  g.translate(0, 0.5, 0)
  // 位置保持单位尺寸（着色器里用 position 做层号和条纹），实例矩阵负责缩放
  g.userData.size = [lenX, widZ]
  return g
}

/* ---------------- 船舶 ---------------- */

/**
 * 船体外形（俯视）：船尾平直、船首尖（前 16% 收拢）。返回 Shape（x 沿船长，船中为原点，y 沿船宽）
 */
function hullShape(L, B) {
  const s = new THREE.Shape()
  const n = 18
  const xb = L * 0.34 // 平行中体结束处（往船首）
  s.moveTo(-L / 2, -B / 2 + 1.5)
  s.lineTo(-L / 2 + 2.5, -B / 2)
  s.lineTo(xb, -B / 2)
  for (let i = 1; i <= n; i++) {
    const f = i / n
    const x = xb + (L / 2 - xb) * f
    s.lineTo(x, -(B / 2) * Math.sqrt(Math.max(0, 1 - f * f)))
  }
  for (let i = n - 1; i >= 0; i--) {
    const f = i / n
    const x = xb + (L / 2 - xb) * f
    s.lineTo(x, (B / 2) * Math.sqrt(Math.max(0, 1 - f * f)))
  }
  s.lineTo(-L / 2 + 2.5, B / 2)
  s.lineTo(-L / 2, B / 2 - 1.5)
  s.closePath()
  return s
}

/** 船体（局部 x 为船首方向，y 向上，水线 y=0，z 横向）：船壳 + 水线色带 + 上建 + 烟囱 */
export function shipHull(t, def) {
  const C = t.ship
  const L = def.loa
  const B = def.beam
  // 干舷（甲板到水线，含舱口围）：大船约 14–16 m（假设；第 27 轮比对从 8–14 m 提高，船在总览里太扁）
  const F = clampNum(L * 0.04, 10, 17)
  const shape = hullShape(L, B)
  const side = new THREE.ExtrudeGeometry(shape, {
    depth: F + 2,
    bevelEnabled: false,
    curveSegments: 4
  })
  // Extrude 沿 +z；转成沿 +y，再下移 2 m（水线以下露一点）
  side.rotateX(-Math.PI / 2)
  side.translate(0, -2, 0)
  const band = new THREE.ExtrudeGeometry(shape, {
    depth: 2.4,
    bevelEnabled: false,
    curveSegments: 4
  })
  band.rotateX(-Math.PI / 2)
  band.scale(1.003, 1, 1.006)
  band.translate(0, -1.6, 0)
  // ExtrudeGeometry 的组：0 = 顶 / 底面，1 = 侧面 → 顶面刷甲板色，侧面刷船壳色
  const colorGroups = (g, capColor, sideColor) => {
    const pos = g.attributes.position
    const c = new Float32Array(pos.count * 3)
    for (const grp of g.groups) {
      _c.set(grp.materialIndex === 0 ? capColor : sideColor)
      for (let i = grp.start; i < grp.start + grp.count; i++) {
        const vi = g.index ? g.index.array[i] : i
        c[vi * 3] = _c.r
        c[vi * 3 + 1] = _c.g
        c[vi * 3 + 2] = _c.b
      }
    }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3))
    g.clearGroups()
    return g.index ? g.toNonIndexed() : g
  }
  const parts = [
    colorGroups(side, C.deck, C.hull),
    colorGroups(band, C.band, C.band)
  ]
  // 上层建筑：超大型 / 大型船的驾驶台在船中偏前、烟囱在后；中型 / 支线船都在船尾
  const fwd = def.loa >= 360
  const hx = fwd ? L * 0.12 : -L * 0.38
  const hh = fwd ? 34 : 24
  // 上层建筑沿船长 16 m（第 27 轮从 10 m 加长：总览里 10 m 的船楼只是一片竖薄板）
  parts.push(box(16, hh, B * 0.84, hx, F + hh / 2, 0, C.house))
  parts.push(box(4, 2.2, B + 4, hx + 5, F + hh - 1.1, 0, C.house)) // 驾驶台两翼
  parts.push(box(3.2, 1.2, B * 0.7, hx + 8.1, F + hh - 3, 0, "#2b3940")) // 驾驶台窗带
  const fx = fwd ? -L * 0.34 : hx - 9
  parts.push(box(7, 14, 6, fx, F + 7, 0, C.funnel))
  // 船首楼、系泊甲板
  parts.push(box(L * 0.05, 3, B * 0.5, L * 0.46, F + 1.5, 0, C.deck))
  const geo = merge(parts)
  geo.userData = {
    F,
    house: [hx - 9, hx + 9],
    funnel: [fx - 4, fx + 4],
    // 上层建筑的中心、高度、宽度（全息主题在它外面套一层窗格灯光）
    hx,
    hh,
    hw: B * 0.84
  }
  return geo
}

const clampNum = (x, a, b) => Math.min(b, Math.max(a, x))

/* ---------------- 建筑、灯杆 ---------------- */

/** 高杆灯：35 m 灯杆 + 灯盘（夜景灯盘发光） */
export function mastGeometry(t) {
  return merge([
    box(0.8, 35, 0.8, 0, 17.5, 0, t.crane.dark),
    box(4.2, 0.8, 4.2, 0, 35.2, 0, t.crane.dark)
  ])
}

/**
 * 道路与皮带：贴地的发光带，沿路有按速度流动的光点（运输流向）。
 * 做成一个自定义着色器的条带网格：属性 aS = 沿路弧长（米），aSide = -1..1 横向位置。
 * 浮在地面上方 lift 米，叠加混合，不写深度。
 */
import * as THREE from "three"

import { THEME } from "./theme.js"
import { VS } from "./world.js"

const VERT = /* glsl */ `
  attribute float aS;
  attribute float aSide;
  varying float vS;
  varying float vSide;
  void main() {
    vS = aS;
    vSide = aSide;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uSpeed;   // 光点速度 m/s（负值反向）
  uniform float uDash;    // 光点周期 m
  uniform float uOpacity;
  varying float vS;
  varying float vSide;
  void main() {
    float a = abs(vSide);
    float core = 1.0 - smoothstep(0.0, 0.55, a);
    float edge = smoothstep(0.62, 0.9, a) * (1.0 - smoothstep(0.9, 1.0, a));
    float ph = fract((vS - uTime * uSpeed) / uDash);
    float dash = smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.18, 0.3, ph));
    vec3 col = uColor * (0.12 * core + 0.4 * edge + 1.3 * dash * core);
    gl_FragColor = vec4(col, uOpacity);
  }
`

/**
 * @param {Route} route 折线路线（world.js）
 * @param {Grid} grid 高度场
 * @param {object} o { width 米, lift 米, color, speed, dash, opacity, flat: 固定高度（皮带架空用，米）}
 */
export function buildRibbon(route, grid, o = {}) {
  const width = o.width ?? 46
  const lift = o.lift ?? 7
  const pts = route.pts
  const n = pts.length
  const pos = new Float32Array(n * 2 * 3)
  const aS = new Float32Array(n * 2)
  const aSide = new Float32Array(n * 2)
  const idx = []
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(n - 1, i + 1)]
    let tx = b[0] - a[0]
    let ty = b[1] - a[1]
    const l = Math.hypot(tx, ty) || 1
    tx /= l
    ty /= l
    // 左法线（世界）
    const nx = -ty
    const ny = tx
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1
      const x = pts[i][0] + nx * (width / 2) * side
      const y = pts[i][1] + ny * (width / 2) * side
      const h = o.flat != null ? o.flat : grid.height(x, y) * VS + lift
      const k = i * 2 + s
      pos[k * 3] = x
      pos[k * 3 + 1] = o.flat != null ? h * VS : h
      pos[k * 3 + 2] = -y
      aS[k] = route.cum[i]
      aSide[k] = side
    }
    if (i < n - 1) {
      const k = i * 2
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
  geo.setAttribute("aS", new THREE.BufferAttribute(aS, 1))
  geo.setAttribute("aSide", new THREE.BufferAttribute(aSide, 1))
  geo.setIndex(idx)
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(o.color ?? THEME.cyan) },
      uSpeed: { value: o.speed ?? 14 },
      uDash: { value: o.dash ?? 420 },
      uOpacity: { value: o.opacity ?? 1 }
    }
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  return mesh
}

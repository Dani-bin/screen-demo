/*
 * 智慧牧场 沙盘地形
 * ----------------------------------------------------------
 * 数据来自 scripts/smart-ranch/prepare.py：
 *   terrain_h.png  高程顶点网格（1201 × 801，10 m 间距，行从沙盘西北边到东南边），R 高字节 + G 低字节
 *   imagery.webp   Sentinel-2 真彩色底图；ndvi_a/b.png 逐月 NDVI（a = 4–7 月 RGBA，b = 8–10 月 RGB）
 *
 * 坐标：沙盘坐标 (X 沿河谷指向东北, Y 跨河谷指向西北)，three.js 里 x = X，z = −Y，
 * y = (海拔 − 沙盘基准) × 竖向放大。
 *
 * 地表着色器：影像 →（牧场内）叠长势色带 →（牧场外）降饱和压暗 → 半球光 + 太阳漫反射 →
 * 叠加图层（围栏、斜纹、文字）→ 空气透视雾；羽化主题再按到边缘的距离淡出。
 */
import * as THREE from "three"

import { NDVI_RAMP } from "./theme.js"

/** 高程网格：按沙盘坐标双线性取海拔 */
export class HeightField {
  constructor(data, nx, ny, L, W) {
    Object.assign(this, { data, nx, ny, L, W })
    this.step = L / (nx - 1)
  }
  /** 沙盘坐标处的海拔（米） */
  z(X, Y) {
    const fx = THREE.MathUtils.clamp(
      (X + this.L / 2) / this.step,
      0,
      this.nx - 1.001
    )
    const fy = THREE.MathUtils.clamp(
      (this.W / 2 - Y) / this.step,
      0,
      this.ny - 1.001
    )
    const i = Math.floor(fx)
    const j = Math.floor(fy)
    const u = fx - i
    const v = fy - j
    const d = this.data
    const n = this.nx
    const a = d[j * n + i]
    const b = d[j * n + i + 1]
    const c = d[(j + 1) * n + i]
    const e = d[(j + 1) * n + i + 1]
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v
  }
}

/** 读高程 PNG（不能做颜色空间转换和预乘，否则字节会被改掉） */
export async function loadHeights(url, layout) {
  const blob = await (await fetch(url)).blob()
  const bmp = await createImageBitmap(blob, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none"
  })
  const c = document.createElement("canvas")
  c.width = bmp.width
  c.height = bmp.height
  const g = c.getContext("2d", { willReadFrequently: true })
  g.drawImage(bmp, 0, 0)
  const px = g.getImageData(0, 0, bmp.width, bmp.height).data
  const { hOffset, hScale, size } = layout.sandbox
  const data = new Float32Array(bmp.width * bmp.height)
  for (let i = 0; i < data.length; i++)
    data[i] = (px[i * 4] * 256 + px[i * 4 + 1]) / hScale + hOffset
  return new HeightField(data, bmp.width, bmp.height, size[0], size[1])
}

const hex = (h) => new THREE.Color(h)

/** 太阳方向（世界坐标，指向太阳）：方位角从北顺时针；沙盘北方向是 (sinθ, cosθ) */
export function sunVector(sun, theta) {
  const az = THREE.MathUtils.degToRad(sun.az)
  const el = THREE.MathUtils.degToRad(sun.el)
  // 地理方向（东, 北）→ 沙盘 (X, Y)：X 轴指向方位角 90° − θ
  const east = Math.sin(az) * Math.cos(el)
  const north = Math.cos(az) * Math.cos(el)
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  const X = east * c + north * s
  const Y = -east * s + north * c
  return new THREE.Vector3(X, Math.sin(el), -Y).normalize()
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

const FRAG = /* glsl */ `
  uniform sampler2D uImg;
  uniform sampler2D uNdviA;
  uniform sampler2D uNdviB;
  uniform sampler2D uOverlay;
  uniform sampler2D uMask;
  uniform vec4 uWA;
  uniform vec3 uWB;
  uniform float uNdviMix;
  uniform vec3 uRamp[6];
  uniform float uStops[6];
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSky;
  uniform vec3 uGround;
  uniform float uAmbient;
  uniform float uSunI;
  uniform float uDesat;
  uniform float uDim;
  uniform vec3 uFogColor;
  uniform vec3 uFog;      // near, far, 最大浓度
  uniform float uFeather; // 边缘羽化宽度（uv），0 为不羽化
  uniform float uExposure;
  uniform float uDetail;  // 近景草地细节强度（拉近时为 1）
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorld;

  // 值噪声：给 10 m 影像补一点米级的草地明暗变化，拉近时才不显得糊
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  // NDVI → 色带
  vec3 ramp(float x) {
    vec3 c = uRamp[0];
    for (int i = 1; i < 6; i++) {
      float t = clamp((x - uStops[i - 1]) / (uStops[i] - uStops[i - 1]), 0.0, 1.0);
      c = mix(c, uRamp[i], t);
    }
    return c;
  }

  void main() {
    vec3 col = texture2D(uImg, vUv).rgb;
    float inside = texture2D(uMask, vUv).r;

    // 当前月份的 NDVI（两个月之间按权重插值），像素值 0–1 → NDVI −0.2–1
    float v = dot(texture2D(uNdviA, vUv), uWA) + dot(texture2D(uNdviB, vUv).rgb, uWB);
    float ndvi = v * 1.2 - 0.2;
    col = mix(col, ramp(ndvi), uNdviMix * inside);

    // 牧场外：降饱和、压暗
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(lum), uDesat * (1.0 - inside));
    col *= 1.0 - uDim * (1.0 - inside);

    // 近景草地细节：几种尺度的噪声调明暗和黄绿，离得越近越明显
    if (uDetail > 0.0) {
      float near = uDetail * (1.0 - smoothstep(1200.0, 4500.0, distance(vWorld, cameraPosition)));
      float n = vnoise(vWorld.xz / 3.0) * 0.5 + vnoise(vWorld.xz / 11.0) * 0.3 + vnoise(vWorld.xz / 37.0) * 0.2;
      col *= 1.0 + (n - 0.5) * 0.28 * near;
      col = mix(col, col * vec3(1.06, 1.03, 0.86), (vnoise(vWorld.xz / 90.0) - 0.4) * near * 0.8);
    }

    // 半球光 + 太阳漫反射（法线来自放大后的高程，起伏被拉开）
    vec3 n = normalize(vNormalW);
    vec3 hemi = mix(uGround, uSky, n.y * 0.5 + 0.5) * uAmbient;
    float diff = max(dot(n, uSunDir), 0.0);
    col *= hemi + uSunColor * diff * uSunI;

    // 叠加图层（围栏、斜纹、文字）不受光照影响
    vec4 ov = texture2D(uOverlay, vUv);
    col = mix(col, ov.rgb, ov.a);

    // 空气透视
    float d = distance(vWorld, cameraPosition);
    col = mix(col, uFogColor, smoothstep(uFog.x, uFog.y, d) * uFog.z);
    col *= uExposure;

    float alpha = 1.0;
    if (uFeather > 0.0) {
      vec2 e = min(vUv, 1.0 - vUv);
      alpha = smoothstep(0.0, uFeather, min(e.x * 1.0, e.y * 1.5));
    }
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** 地表网格与材质 */
export function buildSurface(field, tex, theme, layout, step = 2) {
  const { L, W, nx, ny } = field
  // 网格隔 step 个顶点取一个：原始地形是 30 m DSM，20 m 网格已经够用，三角形少四分之三
  const sx = Math.floor((nx - 1) / step)
  const sy = Math.floor((ny - 1) / step)
  const geo = new THREE.PlaneGeometry(L, W, sx, sy)
  geo.rotateX(-Math.PI / 2)
  const base = layout.elevation.min - 10
  const pos = geo.attributes.position
  // PlaneGeometry 的顶点按行从上（沙盘 Y = +W/2）到下排，和高程网格的行序一致
  for (let j = 0; j <= sy; j++)
    for (let i = 0; i <= sx; i++)
      pos.setY(
        j * (sx + 1) + i,
        (field.data[j * step * nx + i * step] - base) * theme.exag
      )
  geo.computeVertexNormals()

  const stops = NDVI_RAMP.map((s) => s[0])
  const ramp = NDVI_RAMP.map((s) => hex(s[1]))
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: theme.edge.kind === "feather",
    uniforms: {
      uImg: { value: tex.imagery },
      uNdviA: { value: tex.ndviA },
      uNdviB: { value: tex.ndviB },
      uOverlay: { value: tex.overlay },
      uMask: { value: tex.mask },
      uWA: { value: new THREE.Vector4(0, 0, 0, 1) },
      uWB: { value: new THREE.Vector3(0, 0, 0) },
      uNdviMix: { value: theme.ndviMix },
      uRamp: { value: ramp },
      uStops: { value: stops },
      uSunDir: { value: sunVector(theme.sun, layout.sandbox.theta) },
      uSunColor: { value: hex(theme.sun.color) },
      uSunI: { value: theme.sun.intensity },
      uSky: { value: hex(theme.ambient.sky) },
      uGround: { value: hex(theme.ambient.ground) },
      uAmbient: { value: theme.ambient.intensity },
      uDesat: { value: theme.outside.desat },
      uDim: { value: theme.outside.dim },
      uFogColor: { value: hex(theme.fog.color) },
      uFog: { value: new THREE.Vector3(1e9, 1e9, 0) },
      uFeather: { value: theme.edge.feather || 0 },
      uExposure: { value: theme.exposure },
      uDetail: { value: 0 }
    }
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = "terrain"
  return { mesh, base }
}

/** 选月份（4–10，可带小数在两个月之间过渡）→ 着色器里的通道权重 */
export function monthWeights(month) {
  const w = new Array(7).fill(0)
  const f = THREE.MathUtils.clamp(month - 4, 0, 6)
  const i = Math.floor(f)
  const t = f - i
  w[i] = 1 - t
  if (i < 6) w[i + 1] = t
  return {
    a: new THREE.Vector4(w[0], w[1], w[2], w[3]),
    b: new THREE.Vector3(w[4], w[5], w[6])
  }
}

const WALL_VERT = /* glsl */ `
  attribute float aBelow;
  varying float vBelow;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vBelow = aBelow;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`
const WALL_FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uSoil;
  uniform vec3 uLoess;
  uniform vec3 uLayers;   // 草皮厚度、黑钙土底界、（备用），单位是场景里的米
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uAmbient;
  uniform vec3 uFogColor;
  uniform vec3 uFog;
  varying float vBelow;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    // 侧壁分层（从地表往下量）：草皮 → 黑钙土 → 黄土，层界带一点起伏
    float wob = sin(vWorld.x * 0.004 + vWorld.z * 0.003) * 8.0;
    vec3 col = uTop;
    col = mix(col, uSoil, smoothstep(uLayers.x - 2.0, uLayers.x + 2.0, vBelow));
    col = mix(col, uLoess, smoothstep(uLayers.y + wob - 6.0, uLayers.y + wob + 6.0, vBelow));
    // 细横纹
    col *= 0.94 + 0.06 * sin(vBelow * 0.35);
    float diff = max(dot(normalize(vNormalW), uSunDir), 0.0);
    col *= uAmbient + uSunColor * diff * 0.8;
    float d = distance(vWorld, cameraPosition);
    col = mix(col, uFogColor, smoothstep(uFog.x, uFog.y, d) * uFog.z);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** 沙盘四周侧壁：从地表边缘垂到底面，按深度画土层 */
export function buildWalls(field, theme, layout, base) {
  const { L, W, nx, ny } = field
  const bottom = -theme.edge.depth
  const top = (i, j) => (field.data[j * nx + i] - base) * theme.exag
  const edges = [
    // [列序列, 行序列]：沿四条边取顶点，顺序保证侧壁法线朝外
    Array.from({ length: nx }, (_, i) => [i, ny - 1]), // 东南边（近处）
    Array.from({ length: ny }, (_, j) => [nx - 1, ny - 1 - j]), // 东北边
    Array.from({ length: nx }, (_, i) => [nx - 1 - i, 0]), // 西北边
    Array.from({ length: ny }, (_, j) => [0, j]) // 西南边
  ]
  const positions = []
  const below = []
  const index = []
  let v = 0
  for (const e of edges) {
    for (const [i, j] of e) {
      const X = -L / 2 + (i / (nx - 1)) * L
      const Y = W / 2 - (j / (ny - 1)) * W
      const t = top(i, j)
      positions.push(X, t, -Y, X, bottom, -Y)
      below.push(0, t - bottom)
    }
    for (let k = 0; k < e.length - 1; k++) {
      const a = v + k * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    v += e.length * 2
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute("aBelow", new THREE.Float32BufferAttribute(below, 1))
  geo.setIndex(index)
  geo.computeVertexNormals()
  const mat = new THREE.ShaderMaterial({
    vertexShader: WALL_VERT,
    fragmentShader: WALL_FRAG,
    side: THREE.DoubleSide,
    uniforms: {
      uTop: { value: hex(theme.edge.top) },
      uSoil: { value: hex(theme.edge.soil) },
      uLoess: { value: hex(theme.edge.loess) },
      // 草皮约 12、黑钙土到约 70（放大后的场景米，示意厚度）
      uLayers: { value: new THREE.Vector3(12, 70, 0) },
      uSunDir: { value: sunVector(theme.sun, layout.sandbox.theta) },
      uSunColor: { value: hex(theme.sun.color) },
      uAmbient: { value: theme.ambient.intensity + 0.15 },
      uFogColor: { value: hex(theme.fog.color) },
      uFog: { value: new THREE.Vector3(1e9, 1e9, 0) }
    }
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = "walls"
  return mesh
}

/** 沙盘下方的柔和投影：按太阳方向往外偏一点 */
export function buildShadow(theme, layout) {
  const [L, W] = layout.sandbox.size
  const c = document.createElement("canvas")
  c.width = 512
  c.height = 384
  const g = c.getContext("2d")
  g.filter = "blur(26px)"
  g.fillStyle = theme.shadow.color
  g.fillRect(70, 62, 372, 260)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const geo = new THREE.PlaneGeometry(L * 1.38, W * 1.48)
  geo.rotateX(-Math.PI / 2)
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: theme.shadow.opacity,
    depthWrite: false
  })
  const mesh = new THREE.Mesh(geo, mat)
  const s = sunVector(theme.sun, layout.sandbox.theta)
  const off = Math.min(1 / Math.max(s.y, 0.15), 4) * 140
  mesh.position.set(-s.x * off, -theme.edge.depth - 2, -s.z * off)
  mesh.name = "shadow"
  return mesh
}

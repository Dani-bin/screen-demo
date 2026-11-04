/**
 * 地形：18 × 13.5 km 的窗口，40 m 网格（高度场本身是 20 m）。
 * 着色（风格 A 全息透视）：影像压暗调蓝；采坑壳按 15 m 台阶画青色等高线 + 明暗带，坑底煤层透琥珀光；
 * 排土场只画等高线；地面淡青网格；边坡预警热区是一块跟着 uWarn 走的红橙光斑；远处淡出到背景色。
 * 不用 three 的光照（自定义着色器），法线只用来做一点浮雕感。
 */
import * as THREE from "three"

import { THEME } from "./theme.js"
import { VS, world } from "./world.js"

const STRIDE = 2 // 每隔一个高度采样点取一个顶点

const VERT = /* glsl */ `
  attribute float aH;
  attribute float aW;
  attribute float aDump;
  varying vec2 vUv;
  varying float vH;
  varying float vW;
  varying float vDump;
  varying vec3 vN;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vH = aH;
    vW = aW;
    vDump = aDump;
    vN = normal;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const FRAG = /* glsl */ `
  uniform sampler2D uImg;
  uniform float uTime;
  uniform vec3 uWarn;     // xy = 预警中心 (x, z)，z = 半径 m
  uniform float uWarnK;   // 0–1 预警强度
  uniform vec3 uBg;
  uniform vec3 uCenter;   // 淡出中心 (x, z) 与半径
  uniform vec2 uPool[3];  // 坑底暖光池中心 (x, z)：坑底几台电铲 / 破碎机附近
  varying vec2 vUv;
  varying float vH;
  varying float vW;
  varying float vDump;
  varying vec3 vN;
  varying vec3 vWorld;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  // 间隔为 1 的细线，宽度以像素计
  float line(float v, float px) {
    float f = abs(fract(v - 0.5) - 0.5) / max(fwidth(v), 1e-5);
    return 1.0 - smoothstep(0.0, px, f);
  }

  void main() {
    vec3 img = texture2D(uImg, vUv).rgb;
    float lum = dot(img, vec3(0.299, 0.587, 0.114));
    // 影像压暗调蓝：保留一点原色，草原不至于糊成一片
    // 先压高光（坑西北角的裸土在影像里很亮，调蓝后成了一片发白的雾），再调蓝压暗
    vec3 im = mix(vec3(lum), img, 0.35);
    im = im / (1.0 + im * 2.2);
    vec3 base = im * vec3(0.085, 0.14, 0.24) * 0.5;
    vec3 N = normalize(vN);
    float d = max(dot(N, normalize(vec3(0.45, 0.85, -0.35))), 0.0);
    float shade = 0.55 + 0.6 * d;
    vec3 col = base * shade;

    float pit = smoothstep(0.0, 0.03, vW);
    float mask = max(pit, vDump);

    // 采坑壳：岩壁偏冷灰蓝，越深越暗
    // 岩壁法线加噪声：壁面有凹凸、有受光面和背光面，不再是一张平的暗色
    vec3 Np = normalize(N + vec3(noise(vWorld.xz * 0.045) - 0.5, 0.0, noise(vWorld.zx * 0.045 + 7.0) - 0.5) * 1.1);
    float dR = max(dot(Np, normalize(vec3(0.45, 0.85, -0.35))), 0.0);
    vec3 rock = mix(vec3(0.07, 0.125, 0.19), vec3(0.014, 0.028, 0.045), vW) * (0.45 + 1.0 * dR) * 0.7 + base * 0.22;
    // 岩壁：沿高度方向的地层明暗变化 + 平面上的起伏
    float strata = 0.78 + 0.5 * noise(vec2(vH * 0.22, 0.0) + vWorld.xz * 0.005);
    col = mix(col, rock * strata, pit);
    // 排土场：比周边地面亮一档的冷灰蓝土堆，按 15 m 一级的台阶明暗带
    vec3 dumpCol = vec3(0.035, 0.07, 0.11) * (0.6 + 0.7 * d) + base * 0.35;
    col = mix(col, dumpCol, vDump * 0.4);

    // 15 m 一级台阶：细等高线 + 每 75 m 一条粗线；台阶面和平台的明暗带
    float c15 = line(vH / 15.0, 1.3);
    float c75 = line(vH / 75.0, 2.2);
    vec3 cyan = vec3(0.13, 0.83, 0.93);
    col += cyan * (c15 * 0.06 + c75 * 0.15) * mask * (0.55 + 0.45 * vW);
    float band = fract(vH / 15.0);
    col *= mix(1.0, 0.7 + 0.3 * smoothstep(0.0, 0.4, band), max(pit, vDump * 0.8));

    // 坑底煤层：暗金光，带一点缓慢起伏
    float coal = smoothstep(0.88, 1.0, vW);
    float n = noise(vWorld.xz * 0.0035 + uTime * 0.03);
    // 线性值很小也会被伽马提亮，所以幅度压得很低，只留一层暗金光
    // 暖光只给坑底中部一小块，不铺满整个坑底（设计稿里是局部光池）
    // 三个光池：坑底电铲 / 破碎机附近，暖光也外溢到旁边的台阶上
    float pool = 0.0;
    for (int i = 0; i < 3; i++) pool += smoothstep(1.0, 0.0, distance(vWorld.xz, uPool[i]) / 1200.0);
    pool = min(pool, 1.0);
    col += vec3(1.0, 0.50, 0.08) * pool * (coal + 0.6 * pit) * (0.085 + 0.15 * n);

    // 边坡预警：红橙热区，随时间脉动
    // 只点亮坑壁上部（w 小的那一圈）：沿边坡的一条红粉色光带，不是平涂的热力图
    float dw = distance(vWorld.xz, uWarn.xy);
    float k = (1.0 - smoothstep(0.0, uWarn.z, dw)) * uWarnK;
    k *= 0.75 + 0.25 * sin(uTime * 3.2);
    float wall = smoothstep(0.0, 0.05, vW) * (1.0 - smoothstep(0.3, 0.65, vW));
    // 强度收一档：第 5 轮评审指出大片粉白过曝，设计稿里只是坑壁上一抹暗红光晕
    col = mix(col, vec3(0.85, 0.14, 0.26), k * 0.42 * wall);
    col += vec3(1.0, 0.30, 0.40) * k * 0.14 * wall * max(c15, 0.2);

    // 远处淡出
    float dist = distance(vWorld.xz, uCenter.xy);
    col = mix(col, uBg, smoothstep(uCenter.z * 0.62, uCenter.z, dist));
    // 大气薄雾：离相机越远越往深蓝里沉，远处的地形和设备有空气感
    float fogK = 1.0 - exp(-distance(cameraPosition, vWorld) * 0.00005);
    col = mix(col, vec3(0.004, 0.012, 0.022), fogK * 0.5);
    gl_FragColor = vec4(col, 1.0);
  }
`

export function buildTerrain(grid) {
  const nx = Math.floor((grid.nx - 1) / STRIDE) + 1
  const ny = Math.floor((grid.ny - 1) / STRIDE) + 1
  const n = nx * ny
  const pos = new Float32Array(n * 3)
  const nor = new Float32Array(n * 3)
  const uv = new Float32Array(n * 2)
  const aH = new Float32Array(n)
  const aW = new Float32Array(n)
  const aDump = new Float32Array(n)
  const W = world.window.halfW
  const Hh = world.window.halfH
  const res = grid.res
  const hAt = (i, j) => {
    i = Math.max(0, Math.min(grid.nx - 1, i))
    j = Math.max(0, Math.min(grid.ny - 1, j))
    return grid.h[j * grid.nx + i]
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const gi = i * STRIDE
      const gj = j * STRIDE
      const k = j * nx + i
      const x = -W + gi * res
      const y = Hh - gj * res
      const h = hAt(gi, gj)
      pos[k * 3] = x
      pos[k * 3 + 1] = h * VS
      pos[k * 3 + 2] = -y
      // 法线：20 m 网格上的中心差分（高度已放大 VS）
      const dhdx = ((hAt(gi + 1, gj) - hAt(gi - 1, gj)) * VS) / (2 * res)
      const dhdy = ((hAt(gi, gj - 1) - hAt(gi, gj + 1)) * VS) / (2 * res) // 世界 y 向北
      // three 的 z = -y：dh/dz = -dh/dy
      const nxv = -dhdx
      const nyv = 1
      const nzv = dhdy
      const l = Math.hypot(nxv, nyv, nzv)
      nor[k * 3] = nxv / l
      nor[k * 3 + 1] = nyv / l
      nor[k * 3 + 2] = nzv / l
      uv[k * 2] = (x + W) / (2 * W)
      uv[k * 2 + 1] = (y + Hh) / (2 * Hh)
      aH[k] = h
      aW[k] = grid.w[gj * grid.nx + gi] / 255
      aDump[k] = grid.dumpWeight(x, y)
    }
  }
  const idx = new Uint32Array((nx - 1) * (ny - 1) * 6)
  let t = 0
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i
      const b = a + 1
      const c = a + nx
      const d = c + 1
      // 绕向要让法线朝上（y 向上）
      idx.set([a, c, b, b, c, d], t)
      t += 6
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3))
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2))
  geo.setAttribute("aH", new THREE.BufferAttribute(aH, 1))
  geo.setAttribute("aW", new THREE.BufferAttribute(aW, 1))
  geo.setAttribute("aDump", new THREE.BufferAttribute(aDump, 1))
  geo.setIndex(new THREE.BufferAttribute(idx, 1))
  geo.computeBoundingSphere()

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uImg: { value: grid.imagery },
      uTime: { value: 0 },
      uWarn: { value: new THREE.Vector3(0, 0, 600) },
      uWarnK: { value: 0 },
      uPool: {
        value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()]
      },
      uBg: { value: new THREE.Color(THEME.bg) },
      uCenter: { value: new THREE.Vector3(1300, 700, 9000) }
    }
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.name = "terrain"
  return mesh
}

/*
 * West Elk 煤矿 设计稿三维画面：真实高程 + 航拍影像沙盘
 * ----------------------------------------------------------
 * drafts-source.html 引用本模块，需经 vite 开发服务器打开（裸模块 "three" 由 vite 解析）。
 * 数据来自 scripts/smart-mine/prepare.py 写到 models/smart-mine/render/ 的文件（git 忽略，只在本机）。
 *
 * 坐标：layout.json 用局部米坐标（x 向东、y 向北、高程为海拔米）；
 * three.js 里 X = x，Z = -y，Y = (海拔 - 沙盘底面) × 竖向放大。
 *
 * 画面组成：
 *   - 地表：高程网格 + 航拍贴图，着色器里按坡向补一点明暗、远处加大气雾；
 *     「透视」模式下地表变成半透明的灰蓝色并叠等高线，露出井下
 *   - 侧壁：按倾斜煤层面算出每个点所在的地层上色（砂岩、页岩、煤层、表土），代替影像拉伸
 *   - 井下：煤层面、工作面（采空区 / 在采 / 待采 / 规划）、巷道、抽采钻孔、传感器
 */
import * as THREE from "three"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js"
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js"
import { Line2 } from "three/examples/jsm/lines/Line2.js"
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js"
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js"

const DATA = "/models/smart-mine/render/"
const VW = 1920
const VH = 1080
// 竖向放大：原始落差约 970 m / 12 km，放大 1.35 倍后山体更有立体感又不失真
export const EXAG = 1.35
// 显示时煤层最少加粗到这么厚（米），否则全景下不到一个像素
const SEAM_MIN = 16

// 航拍影像拍摄时的太阳方向（夏季上午，东南方，高度角约 55°），地表补光与之一致，避免和影像里的阴影打架
const SUN_AZ = 140
const SUN_EL = 55

/** 局部坐标 → three.js 世界坐标 */
function W(L, x, y, elev) {
  return new THREE.Vector3(x, (elev - L.blockBase) * EXAG, -y)
}

/** 太阳方向（世界坐标，指向太阳） */
function sunDir() {
  const az = THREE.MathUtils.degToRad(SUN_AZ)
  const el = THREE.MathUtils.degToRad(SUN_EL)
  // 方位角从北顺时针：北 = -Z，东 = +X
  return new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    -Math.cos(az) * Math.cos(el)
  ).normalize()
}

/** B 煤底板海拔（倾斜平面，与 prepare.py 的 seam_b 一致） */
function seamB(L, x, y) {
  const s = L.seamPlane
  const t = Math.tan(THREE.MathUtils.degToRad(s.dipDeg))
  const az = THREE.MathUtils.degToRad(s.dipAz)
  const d = (x - s.refX) * Math.sin(az) + (y - s.refY) * Math.cos(az)
  return s.z0 - t * d
}

/** 高程网格：行从北到南、列从西到东，含四边顶点 */
class HeightGrid {
  constructor(data, nx, ny, step, cx, cy) {
    Object.assign(this, { data, nx, ny, step, cx, cy })
    this.w = (nx - 1) * step
    this.h = (ny - 1) * step
  }
  /** 局部坐标处的海拔（双线性） */
  z(x, y) {
    const fx = THREE.MathUtils.clamp(
      (x - this.cx + this.w / 2) / this.step,
      0,
      this.nx - 1.001
    )
    const fy = THREE.MathUtils.clamp(
      (this.cy + this.h / 2 - y) / this.step,
      0,
      this.ny - 1.001
    )
    const i = Math.floor(fx)
    const j = Math.floor(fy)
    const u = fx - i
    const v = fy - j
    const d = this.data
    const n = this.nx
    const a = d[j * n + i] * (1 - u) + d[j * n + i + 1] * u
    const b = d[(j + 1) * n + i] * (1 - u) + d[(j + 1) * n + i + 1] * u
    return a * (1 - v) + b * v
  }
}

// ---------------- 着色器公用片段 ----------------

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int k = 0; k < 4; k++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return s;
  }
`

// ---------------- 地表 ----------------

function terrainMaterial(tex, overlay, opts) {
  return new THREE.ShaderMaterial({
    transparent: !!opts.ghost,
    depthWrite: !opts.ghost,
    uniforms: {
      uMap: { value: tex },
      uOverlay: { value: overlay },
      uOverlayK: { value: opts.overlayK ?? 0 },
      uSun: { value: sunDir() },
      uGhost: { value: opts.ghost ? 1 : 0 },
      uAlpha: { value: opts.ghost ? 0.42 : 1 },
      uHaze: { value: new THREE.Color(opts.haze ?? "#7f9cc0") },
      uHazeK: { value: opts.hazeK ?? 0.00004 },
      uHazeNear: { value: 0 },
      uSat: { value: opts.sat ?? 1.12 },
      uGain: { value: opts.gain ?? 1.06 },
      uBase: { value: opts.base },
      uExag: { value: EXAG }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vN = normalize(normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform sampler2D uOverlay;
      uniform float uOverlayK, uGhost, uAlpha, uHazeK, uHazeNear, uSat, uGain, uBase, uExag;
      uniform vec3 uSun, uHaze;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vWorld;
      void main() {
        vec3 c = texture2D(uMap, vUv).rgb;
        // 影像调色：NAIP 偏灰，稍提饱和度与亮度
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = max(mix(vec3(l), c, uSat) * uGain, 0.0);
        c = pow(c, vec3(1.06));
        // 坡向补光：平地保持影像原色，迎光坡稍亮、背光坡稍暗（影像本身已带阴影，只补一点）
        vec3 n = normalize(vN);
        float flat_ = 0.5 + 0.62 * uSun.y;
        float shade = (0.5 + 0.62 * max(dot(n, uSun), 0.0)) / flat_;
        c *= mix(1.0, shade, 0.55);
        float elev = vWorld.y / uExag + uBase;
        if (uGhost > 0.5) {
          // 透视模式：灰蓝半透明 + 50 m 等高线（每 250 m 一条加粗）
          float g = dot(c, vec3(0.3, 0.59, 0.11));
          float relief = 0.35 + 0.9 * max(dot(n, normalize(vec3(-0.5, 0.75, -0.45))), 0.0);
          c = mix(vec3(0.04, 0.09, 0.16), vec3(0.2, 0.36, 0.52), clamp(g * 1.3, 0.0, 1.0)) * relief;
          float fw = fwidth(elev);
          float m50 = 1.0 - smoothstep(0.0, fw * 1.2, abs(fract(elev / 50.0 + 0.5) - 0.5) * 50.0);
          float m250 = 1.0 - smoothstep(0.0, fw * 1.6, abs(fract(elev / 250.0 + 0.5) - 0.5) * 250.0);
          c += vec3(0.25, 0.65, 0.85) * (m50 * 0.1 + m250 * 0.42);
        }
        // 叠加图层（工作面投影、范围线）
        vec4 ov = texture2D(uOverlay, vUv);
        c = mix(c, ov.rgb, ov.a * uOverlayK);
        // 大气雾：比画面中心更远的地方逐渐偏蓝灰（空气透视），近处保持影像原色
        float d = length(vWorld - cameraPosition);
        float fog = 1.0 - exp(-max(d - uHazeNear, 0.0) * uHazeK);
        c = mix(c, uHaze, clamp(fog, 0.0, 0.45));
        gl_FragColor = vec4(c, uAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  })
}

function buildTerrain(L, grid, tex, overlay, opts) {
  const { nx, ny, step, cx, cy, data } = grid
  const pos = new Float32Array(nx * ny * 3)
  const uv = new Float32Array(nx * ny * 2)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      const x = cx - grid.w / 2 + i * step
      const y = cy + grid.h / 2 - j * step
      pos[k * 3] = x
      pos[k * 3 + 1] = (data[k] - L.blockBase) * EXAG
      pos[k * 3 + 2] = -y
      uv[k * 2] = i / (nx - 1)
      uv[k * 2 + 1] = 1 - j / (ny - 1)
    }
  }
  const idx = new Uint32Array((nx - 1) * (ny - 1) * 6)
  let p = 0
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i
      const b = a + 1
      const c = a + nx
      const d = c + 1
      idx[p++] = a
      idx[p++] = c
      idx[p++] = b
      idx[p++] = b
      idx[p++] = c
      idx[p++] = d
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3))
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2))
  g.setIndex(new THREE.BufferAttribute(idx, 1))
  g.computeVertexNormals()
  const m = new THREE.Mesh(
    g,
    terrainMaterial(tex, overlay, { ...opts, base: L.blockBase })
  )
  m.renderOrder = opts.ghost ? 10 : 0
  return m
}

// ---------------- 侧壁地层 ----------------

function wallMaterial(L) {
  const cols = L.strata.map((s) => new THREE.Color(s.color))
  const sp = L.seamPlane
  const seams = L.seams
  return new THREE.ShaderMaterial({
    uniforms: {
      uRef: { value: new THREE.Vector3(sp.refX, sp.refY, sp.z0) },
      uTan: { value: Math.tan(THREE.MathUtils.degToRad(sp.dipDeg)) },
      uDir: {
        value: new THREE.Vector2(
          Math.sin(THREE.MathUtils.degToRad(sp.dipAz)),
          Math.cos(THREE.MathUtils.degToRad(sp.dipAz))
        )
      },
      uTops: { value: L.strata.map((s) => Math.min(s.top, 5000)) },
      uCols: { value: cols },
      uSeamC: { value: seams.map((s) => s.base + s.thick / 2) },
      uSeamH: {
        value: seams.map(
          (s) =>
            Math.max(s.thick * 2.5, s.mined ? SEAM_MIN : SEAM_MIN * 0.45) / 2
        )
      },
      uSun: { value: sunDir() },
      uBase: { value: L.blockBase }
    },
    vertexShader: /* glsl */ `
      attribute vec3 aReal;
      attribute float aSurf;
      varying vec3 vReal;
      varying float vSurf;
      varying vec3 vN;
      void main() {
        vReal = aReal;
        vSurf = aSurf;
        vN = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uRef;
      uniform float uTan, uBase;
      uniform vec2 uDir;
      uniform float uTops[6];
      uniform vec3 uCols[6];
      uniform float uSeamC[5];
      uniform float uSeamH[5];
      uniform vec3 uSun;
      varying vec3 vReal;
      varying float vSurf;
      varying vec3 vN;
      ${NOISE}
      // 条带色调：每个分层一个随机明暗，层与层之间用屏幕空间宽度平滑过渡（远处不闪烁）
      float bandTone(float h, float t, float seed) {
        float x = h / t + seed;
        float i = floor(x);
        float f = fract(x);
        float w = clamp(fwidth(x) * 1.5, 0.0, 0.5);
        float a = hash(vec2(i, seed));
        float b = hash(vec2(i + 1.0, seed));
        return mix(a, b, smoothstep(1.0 - w, 1.0, f));
      }
      void main() {
        float zb = uRef.z - uTan * ((vReal.x - uRef.x) * uDir.x + (vReal.y - uRef.y) * uDir.y);
        float h = vReal.z - zb;
        float s = vReal.x - vReal.y;  // 沿侧壁的位置
        // 层面略有起伏（低频），不是死板的直线
        h += (vnoise(vec2(s * 0.0009, 3.1)) - 0.5) * 10.0;
        vec3 c = uCols[5];
        float top = 0.0;
        float idx = 5.0;
        for (int i = 0; i < 6; i++) { if (h < uTops[i]) { c = uCols[i]; top = uTops[i]; idx = float(i); break; } }
        // 层内砂岩 / 泥岩互层：页岩段条带薄而暗，砂岩条带厚而亮
        float t = mix(9.0, 22.0, hash(vec2(idx, 7.0)));
        float tone = bandTone(h, t, idx * 13.0);
        c *= 0.72 + 0.5 * tone;
        vec2 gp = vec2(s * 0.06, h * 0.25);
        float gk = 1.0 - smoothstep(0.4, 1.2, length(fwidth(gp)));
        c *= 1.0 + (fbm(gp) - 0.5) * 0.35 * gk;
        // 地层界面：一条暗线
        float fw = fwidth(h);
        c *= 1.0 - 0.45 * (1.0 - smoothstep(fw, fw * 2.5 + 1.5, abs(h - top)));
        // 煤层：黑色带
        for (int i = 0; i < 5; i++) {
          float d = abs(h - uSeamC[i]);
          float k = 1.0 - smoothstep(uSeamH[i] - fw, uSeamH[i] + fw, d);
          c = mix(c, vec3(0.018, 0.018, 0.022), k);
        }
        // 表土（地表以下 0–10 m）与地表植被层
        float depth = vSurf - vReal.z;
        c = mix(vec3(0.20, 0.13, 0.075), c, smoothstep(4.0, 11.0, depth));
        c = mix(vec3(0.07, 0.085, 0.04), c, smoothstep(0.0, 2.5, depth));
        // 光照：天空环境光为主，向阳面略亮；越靠底越暗
        float diff = max(dot(normalize(vN), uSun), 0.0);
        c *= 0.78 + 0.45 * diff;
        c *= mix(0.6, 1.0, smoothstep(uBase, uBase + 220.0, vReal.z));
        if (!gl_FrontFacing) c *= 0.38;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  })
}

/** 沙盘四周侧壁：沿边缘每个高程顶点一列，上接地表、下到底面 */
function buildWalls(L, grid, mat) {
  const { nx, ny, step, cx, cy, data } = grid
  const x0 = cx - grid.w / 2
  const y1 = cy + grid.h / 2
  const edges = [
    // [顶点下标序列, 外法线]
    [Array.from({ length: nx }, (_, i) => i), new THREE.Vector3(0, 0, -1)], // 北
    [
      Array.from({ length: nx }, (_, i) => (ny - 1) * nx + (nx - 1 - i)),
      new THREE.Vector3(0, 0, 1)
    ], // 南
    [
      Array.from({ length: ny }, (_, j) => (ny - 1 - j) * nx),
      new THREE.Vector3(-1, 0, 0)
    ], // 西
    [
      Array.from({ length: ny }, (_, j) => j * nx + nx - 1),
      new THREE.Vector3(1, 0, 0)
    ] // 东
  ]
  const group = new THREE.Group()
  for (const [ids, n] of edges) {
    const cnt = ids.length
    const pos = new Float32Array(cnt * 2 * 3)
    const real = new Float32Array(cnt * 2 * 3)
    const surf = new Float32Array(cnt * 2)
    const nor = new Float32Array(cnt * 2 * 3)
    ids.forEach((k, c) => {
      const i = k % nx
      const j = Math.floor(k / nx)
      const x = x0 + i * step
      const y = y1 - j * step
      const z = data[k]
      for (const [r, elev] of [
        [0, z],
        [1, L.blockBase]
      ]) {
        const v = c * 2 + r
        pos.set([x, (elev - L.blockBase) * EXAG, -y], v * 3)
        real.set([x, y, elev], v * 3)
        surf[v] = z
        nor.set([n.x, n.y, n.z], v * 3)
      }
    })
    const idx = []
    for (let c = 0; c < cnt - 1; c++) {
      const a = c * 2
      // 四条边都按俯视顺时针排列顶点，这个绕序让正面朝外
      idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3))
    g.setAttribute("aReal", new THREE.BufferAttribute(real, 3))
    g.setAttribute("aSurf", new THREE.BufferAttribute(surf, 1))
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3))
    g.setIndex(idx)
    const wall = new THREE.Mesh(g, mat)
    wall.material.side = THREE.DoubleSide
    group.add(wall)
  }
  // 底面
  const bottom = new THREE.Mesh(
    new THREE.PlaneGeometry(grid.w, grid.h).rotateX(Math.PI / 2),
    // 双面：透视模式下从上方透过地表看到的是暗色底板，而不是下面地台的光晕
    new THREE.MeshBasicMaterial({ color: "#05080d", side: THREE.DoubleSide })
  )
  bottom.position.set(cx, 0, -cy)
  group.add(bottom)
  return group
}

// ---------------- 底座与背景 ----------------

function backgroundTexture() {
  const c = document.createElement("canvas")
  c.width = 1920
  c.height = 1080
  const g = c.getContext("2d")
  const r = g.createRadialGradient(960, 470, 80, 960, 540, 1150)
  r.addColorStop(0, "#14304f")
  r.addColorStop(0.45, "#0a1a30")
  r.addColorStop(1, "#030912")
  g.fillStyle = r
  g.fillRect(0, 0, 1920, 1080)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** 地台：沙盘下方的暗色地面，带公里网格、沙盘投影和边缘泛光 */
function buildFloor(halfW, halfH) {
  const size = 90000
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uHalf: { value: new THREE.Vector2(halfW, halfH) },
        uCenter: { value: new THREE.Vector2() }
      },
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vP = wp.xz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec2 uHalf;
        uniform vec2 uCenter;
        varying vec2 vP;
        void main() {
          // 到沙盘矩形的距离
          vec2 q = abs(vP - uCenter) - uHalf;
          float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
          float fade = 1.0 - smoothstep(2000.0, 26000.0, d);
          // 1 km 网格
          vec2 gp = abs(fract(vP / 1000.0 + 0.5) - 0.5) * 1000.0;
          float fw = fwidth(vP.x) * 1.2;
          float grid = 1.0 - smoothstep(0.0, fw * 1.4, min(gp.x, gp.y));
          vec3 c = vec3(0.12, 0.45, 0.75) * grid * 0.22 * fade;
          // 沙盘边缘一圈青色泛光 + 正下方的暗影
          float rim = exp(-max(d, 0.0) / 220.0) * step(0.0, d);
          float halo = exp(-max(d, 0.0) / 1800.0) * step(0.0, d);
          c += vec3(0.1, 0.7, 0.95) * (rim * 0.5 + halo * 0.12);
          float shadow = (1.0 - smoothstep(-400.0, 1600.0, d)) * 0.8;
          float a = max(max(grid * 0.22 * fade, rim * 0.55 + halo * 0.15), shadow);
          gl_FragColor = vec4(mix(c, vec3(0.0), shadow * step(d, 0.0)), a);
          #include <colorspace_fragment>
        }
      `
    })
  )
  m.position.y = -6
  m.renderOrder = -1
  return m
}

// ---------------- 叠加图层（投影到地表的工作面范围） ----------------

function overlayTexture(L, grid, mode) {
  const W0 = 4096
  const H0 = Math.round((W0 * grid.h) / grid.w)
  const c = document.createElement("canvas")
  c.width = W0
  c.height = H0
  const g = c.getContext("2d")
  const sx = W0 / grid.w
  const P = (x, y) => [
    (x - grid.cx + grid.w / 2) * sx,
    (grid.cy + grid.h / 2 - y) * sx
  ]
  if (mode === "overview") {
    for (const p of L.panels) {
      const [x0, y0, x1, y1] = p.rect
      const [a, b] = P(x0, y1)
      const [cc, d] = P(x1, y0)
      const style = {
        mined: ["rgba(170,160,220,0.10)", "rgba(210,200,255,0.55)", []],
        active: ["rgba(255,150,40,0.20)", "rgba(255,180,80,0.95)", []],
        ready: ["rgba(40,220,230,0.06)", "rgba(80,235,240,0.75)", []],
        planned: ["rgba(40,220,230,0.0)", "rgba(80,235,240,0.6)", [26, 18]]
      }[p.status]
      g.fillStyle = style[0]
      g.fillRect(a, b, cc - a, d - b)
      g.strokeStyle = style[1]
      g.lineWidth = 3.5
      g.setLineDash(style[2])
      g.strokeRect(a, b, cc - a, d - b)
      if (p.face_x) {
        const [fx] = P(p.face_x, 0)
        g.setLineDash([])
        g.strokeStyle = "rgba(255,90,40,1)"
        g.lineWidth = 10
        g.beginPath()
        g.moveTo(fx, b)
        g.lineTo(fx, d)
        g.stroke()
      }
    }
    // 大巷走向
    g.setLineDash([])
    g.strokeStyle = "rgba(90,220,255,0.75)"
    g.lineWidth = 4
    for (const r of L.roadways) {
      if (!["main", "incline"].includes(r.kind)) continue
      g.beginPath()
      r.pts.forEach((q, k) =>
        k ? g.lineTo(...P(q[0], q[1])) : g.moveTo(...P(q[0], q[1]))
      )
      g.stroke()
    }
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

// ---------------- 井下 ----------------

function glow(color, k = 2.2) {
  return new THREE.Color(color).multiplyScalar(k)
}

/** 煤层面：倾斜平面上的网格，去掉高出地表或低于底面的部分 */
function buildSeamSheet(L, grid, dz, color, opacity) {
  const n = 120
  const m = Math.round((n * grid.h) / grid.w)
  const pos = []
  const ok = []
  for (let j = 0; j <= m; j++) {
    for (let i = 0; i <= n; i++) {
      const x = grid.cx - grid.w / 2 + (i / n) * grid.w
      const y = grid.cy + grid.h / 2 - (j / m) * grid.h
      const z = seamB(L, x, y) + dz
      pos.push(x, (z - L.blockBase) * EXAG, -y)
      ok.push(z < grid.z(x, y) - 25 && z > L.blockBase + 5)
    }
  }
  const idx = []
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i
      const b = a + 1
      const c = a + n + 1
      const d = c + 1
      if (ok[a] && ok[b] && ok[c] && ok[d]) idx.push(a, c, b, b, c, d)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  const mesh = new THREE.Mesh(
    g,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  )
  mesh.renderOrder = 2
  return mesh
}

/** 采空区材质：斜向阴影线 */
function goafMaterial(color, opacity) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uC: { value: new THREE.Color(color) }, uA: { value: opacity } },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vP = wp.xz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uC;
      uniform float uA;
      varying vec2 vP;
      void main() {
        float s = abs(fract((vP.x + vP.y) / 70.0) - 0.5);
        float hatch = smoothstep(0.36, 0.42, s);
        gl_FragColor = vec4(uC * (0.55 + 0.6 * hatch), uA * (0.55 + 0.45 * hatch));
        #include <colorspace_fragment>
      }
    `
  })
}

function quadOnSeam(L, x0, y0, x1, y1, dz, mat) {
  const pts = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1]
  ].map(([x, y]) => W(L, x, y, seamB(L, x, y) + dz))
  const g = new THREE.BufferGeometry().setFromPoints(pts)
  g.setIndex([0, 1, 2, 0, 2, 3])
  const m = new THREE.Mesh(g, mat)
  m.renderOrder = 3
  return m
}

function fatLine(points, color, width, res, opts = {}) {
  const g = new LineGeometry()
  g.setPositions(points.flatMap((p) => [p.x, p.y, p.z]))
  const m = new LineMaterial({
    color,
    linewidth: width,
    transparent: true,
    opacity: opts.opacity ?? 1,
    dashed: !!opts.dash,
    dashSize: opts.dash?.[0] ?? 1,
    gapSize: opts.dash?.[1] ?? 1,
    depthWrite: false,
    depthTest: opts.depthTest ?? true
  })
  m.resolution.copy(res)
  const l = new Line2(g, m)
  if (opts.dash) l.computeLineDistances()
  l.renderOrder = opts.order ?? 5
  return l
}

function rectLine(L, x0, y0, x1, y1, dz, color, width, res, opts) {
  const pts = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0]
  ].map(([x, y]) => W(L, x, y, seamB(L, x, y) + dz + 2))
  return fatLine(pts, color, width, res, opts)
}

function buildUnderground(L, grid, res) {
  const group = new THREE.Group()
  const dzOf = (k) => L.seams.find((s) => s.key === k).base
  // 煤层面：B 煤（在采）明显些，E 煤（老采区）淡些
  group.add(buildSeamSheet(L, grid, 0, "#1a2a3a", 0.42))
  group.add(buildSeamSheet(L, grid, dzOf("E"), "#1e2c3c", 0.16))

  const tags = []
  for (const p of L.panels) {
    const dz = dzOf(p.seam)
    const [x0, y0, x1, y1] = p.rect
    if (p.status === "mined") {
      const old = p.seam === "E"
      group.add(
        quadOnSeam(
          L,
          x0,
          y0,
          x1,
          y1,
          dz + 1,
          goafMaterial(old ? "#6d6a86" : "#8c7fb8", old ? 0.4 : 0.62)
        )
      )
      group.add(
        rectLine(L, x0, y0, x1, y1, dz, old ? "#8f8aa8" : "#b8aef0", 1.6, res, {
          opacity: 0.8
        })
      )
    } else if (p.status === "active") {
      // 已回采段（切眼 → 工作面）为采空区，剩余段是实体煤
      group.add(
        quadOnSeam(
          L,
          p.face_x,
          y0,
          x1,
          y1,
          dz + 1,
          goafMaterial("#e0892e", 0.6)
        )
      )
      group.add(
        quadOnSeam(
          L,
          x0,
          y0,
          p.face_x,
          y1,
          dz + 1,
          new THREE.MeshBasicMaterial({
            color: "#0b0d10",
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
            side: THREE.DoubleSide
          })
        )
      )
      group.add(rectLine(L, x0, y0, x1, y1, dz, "#ffb347", 2.2, res))
      // 综采工作面：一道发光的「墙」
      const zb = seamB(L, p.face_x, (y0 + y1) / 2) + dz
      const face = new THREE.Mesh(
        new THREE.BoxGeometry(14, 30 * EXAG, y1 - y0),
        new THREE.MeshBasicMaterial({ color: glow("#ff7a2a", 3.2) })
      )
      face.position.copy(W(L, p.face_x, (y0 + y1) / 2, zb + 12))
      group.add(face)
      tags.push({ key: "face", pos: W(L, p.face_x, (y0 + y1) / 2, zb + 30) })
    } else if (p.status === "ready") {
      group.add(
        quadOnSeam(
          L,
          x0,
          y0,
          x1,
          y1,
          dz + 1,
          new THREE.MeshBasicMaterial({
            color: "#0b0d10",
            transparent: true,
            opacity: 0.7,
            depthWrite: false,
            side: THREE.DoubleSide
          })
        )
      )
      group.add(rectLine(L, x0, y0, x1, y1, dz, "#53e8f0", 1.8, res))
    } else {
      group.add(
        rectLine(L, x0, y0, x1, y1, dz, "#53e8f0", 1.4, res, {
          dash: [60, 45],
          opacity: 0.75
        })
      )
    }
  }

  // 巷道：进风蓝、回风红、斜井黄
  const roadColor = {
    main: "#38c8ff",
    gate: "#4aa8ff",
    bleeder: "#ff5a4a",
    incline: "#ffd23a",
    shaft: "#ff5a4a",
    old: "#7d8aa0"
  }
  for (const r of L.roadways) {
    let pts = r.pts.map(([x, y, dz]) => {
      const z = dz === null ? grid.z(x, y) + 20 : seamB(L, x, y) + dz + 5
      return W(L, x, y, z)
    })
    // 顺槽：运输顺槽进风（蓝）、回风顺槽回风（红）
    let col = roadColor[r.kind]
    if (r.kind === "gate" && r.name.includes("回风")) col = "#ff7a5a"
    const curve = new THREE.CurvePath()
    for (let k = 0; k < pts.length - 1; k++)
      curve.add(new THREE.LineCurve3(pts[k], pts[k + 1]))
    const radius = {
      main: 22,
      incline: 18,
      shaft: 22,
      bleeder: 14,
      gate: 10,
      old: 9
    }[r.kind]
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(
        curve,
        Math.max(8, pts.length * 8),
        radius,
        8,
        false
      ),
      new THREE.MeshBasicMaterial({
        color: glow(col, r.kind === "old" ? 0.8 : 2.0),
        transparent: r.kind === "old",
        opacity: 0.6
      })
    )
    tube.renderOrder = 6
    group.add(tube)
  }
  return { group, tags }
}

/** 抽采钻孔：从地面钻场到采空区上方的竖线 */
function buildWells(L, res, underground) {
  const group = new THREE.Group()
  for (const w of L.wells) {
    const top = W(L, w.x, w.y, w.z + (underground ? 4 : 30))
    if (underground) {
      const bottom = W(L, w.x, w.y, w.bottom)
      group.add(
        fatLine([top, bottom], "#c6ff5a", 1.1, res, { opacity: 0.5, order: 7 })
      )
    }
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(underground ? 18 : 22, 12, 8),
      new THREE.MeshBasicMaterial({
        color: glow("#c6ff5a", underground ? 1.6 : 2.4)
      })
    )
    dot.position.copy(top)
    dot.renderOrder = 8
    group.add(dot)
  }
  return group
}

/** 传感器：在采工作面周围的瓦斯 / CO / 风速测点，颜色表示状态 */
function buildSensors(L) {
  const p = L.panels.find((q) => q.status === "active")
  const [x0, y0, x1, y1] = p.rect
  const fx = p.face_x
  const list = [
    // 回风隅角（工作面与回风顺槽交点）是瓦斯最容易积聚的地方，设一个预警点
    { x: fx + 30, y: y1 + 20, s: "warn", key: "T1" },
    { x: fx - 60, y: y1 + 20, s: "ok" },
    { x: fx - 600, y: y1 + 20, s: "ok" },
    { x: fx + 20, y: (y0 + y1) / 2, s: "ok" },
    { x: fx - 60, y: y0 - 20, s: "ok" },
    { x: x0 - 40, y: y0 - 20, s: "ok" },
    { x: x0 - 140, y: y1 + 20, s: "ok" },
    { x: 330, y: -400, s: "ok" },
    { x: 330, y: 500, s: "ok" },
    { x: x1 + 40, y: y1 + 20, s: "ok" }
  ]
  const color = { ok: "#3ddc97", warn: "#ffcf3a", alarm: "#ff4d5a" }
  const group = new THREE.Group()
  const tags = []
  for (const q of list) {
    const z = seamB(L, q.x, q.y) + 26
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(q.s === "ok" ? 22 : 34, 16, 10),
      new THREE.MeshBasicMaterial({ color: glow(color[q.s], 2.6) })
    )
    m.position.copy(W(L, q.x, q.y, z))
    m.renderOrder = 9
    group.add(m)
    if (q.key) tags.push({ key: q.key, pos: m.position.clone() })
  }
  return { group, tags }
}

// ---------------- 镜头 ----------------

/** 方位角（镜头相对目标点的方向，从北顺时针）、俯角、距离 → 镜头位置 */
function placeCamera(cam, target, az, pitch, dist) {
  const a = THREE.MathUtils.degToRad(az)
  const p = THREE.MathUtils.degToRad(pitch)
  const dir = new THREE.Vector3(
    Math.sin(a) * Math.cos(p),
    Math.sin(p),
    -Math.cos(a) * Math.cos(p)
  )
  cam.position.copy(target).addScaledVector(dir, dist)
  cam.lookAt(target)
  cam.updateMatrixWorld()
}

// ---------------- 入口 ----------------

const loadTex = (url) =>
  new Promise((resolve, reject) =>
    new THREE.TextureLoader().load(url, resolve, undefined, () =>
      reject(new Error("贴图加载失败 " + url))
    )
  )
const loadBin = async (url) =>
  new Float32Array(await (await fetch(url)).arrayBuffer())

/**
 * 建场景并渲染一帧
 * @param {HTMLCanvasElement} canvas
 * @param {{frame: "overview"|"underground"|"closeup", cam?: object}} opts
 * @returns 世界坐标投影函数与画面上需要标注的点
 */
export async function renderScene(canvas, opts) {
  const frame = opts.frame
  const L = await (await fetch(DATA + "layout.json")).json()
  const close = frame === "closeup"
  const spec = close ? L.closeup : { ...L.overview, center: [0, 0] }
  const [data, tex] = await Promise.all([
    loadBin(DATA + (close ? "closeup_h.bin" : "overview_h.bin")),
    loadTex(DATA + (close ? "closeup_tex.jpg" : "overview_tex.jpg"))
  ])
  const [nx, ny] = spec.grid
  const grid = new HeightGrid(
    data,
    nx,
    ny,
    spec.step,
    spec.center[0],
    spec.center[1]
  )

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    logarithmicDepthBuffer: false
  })
  // 设计稿固定 1920 × 1080（不跟随窗口大小）
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(VW, VH, false)
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 1.0
  // 粗线宽度按 CSS 像素计（与设备像素比无关），辉光按实际像素
  const res = new THREE.Vector2(VW, VH)
  const bufRes = res.clone().multiplyScalar(window.devicePixelRatio)

  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter

  const scene = new THREE.Scene()
  scene.background = backgroundTexture()
  const under = frame === "underground"
  const overlay = overlayTexture(L, grid, close ? "none" : frame)
  scene.add(
    buildTerrain(L, grid, tex, overlay, {
      ghost: under,
      overlayK: frame === "overview" ? 0.85 : 0,
      hazeK: close ? 0.00005 : 0.000018
    })
  )
  scene.add(buildWalls(L, grid, wallMaterial(L)))
  const floor = buildFloor(grid.w / 2, grid.h / 2)
  floor.position.x = grid.cx
  floor.position.z = -grid.cy
  floor.material.uniforms.uCenter.value.set(grid.cx, -grid.cy)
  scene.add(floor)

  const tags = []
  if (!close) {
    scene.add(buildWells(L, res, under))
    if (under) {
      const u = buildUnderground(L, grid, res)
      scene.add(u.group)
      tags.push(...u.tags)
      const s = buildSensors(L)
      scene.add(s.group)
      tags.push(...s.tags)
    }
  }
  // 标注锚点：地面设施贴地表，井下的贴煤层；页面按画面挑选要显示的
  for (const [key, st] of Object.entries(L.sites)) {
    const [x, y] = st.pos
    tags.push({ key, pos: W(L, x, y, grid.z(x, y) + 12) })
  }
  const act = L.panels.find((p) => p.status === "active")
  const fy = (act.rect[1] + act.rect[3]) / 2
  const onSeam = (x, y, dz = 0) => W(L, x, y, seamB(L, x, y) + dz + 20)
  const center = (ids) => {
    const ps = L.panels.filter((p) => ids.includes(p.id))
    const x =
      ps.reduce((a, p) => a + (p.rect[0] + p.rect[2]) / 2, 0) / ps.length
    const y =
      ps.reduce((a, p) => a + (p.rect[1] + p.rect[3]) / 2, 0) / ps.length
    return [x, y]
  }
  if (!close) {
    tags.push({
      key: "wells",
      pos: W(L, 2900, -2150, grid.z(2900, -2150) + 30)
    })
    tags.push({
      key: under ? "faceU" : "face",
      pos: under
        ? onSeam(act.face_x, fy, 10)
        : W(L, act.face_x, fy, grid.z(act.face_x, fy) + 20)
    })
    tags.push({ key: "mains", pos: onSeam(330, -300) })
    tags.push({
      key: "incline",
      pos: W(L, 310, 1175, seamB(L, 310, 1175) + 110)
    })
    tags.push({ key: "goaf", pos: onSeam(...center(["LW-B02", "LW-B03"])) })
    tags.push({ key: "ready", pos: onSeam(...center(["LW-B06"])) })
    tags.push({ key: "planned", pos: onSeam(...center(["LW-B07", "LW-B08"])) })
    tags.push({
      key: "eold",
      pos: onSeam(...center(["LW-E02", "LW-E03"]), 152)
    })
    const bl = L.roadways.find((r) => r.name === "东翼回风联络巷").pts
    tags.push({
      key: "bleeder",
      pos: onSeam(bl[0][0], (bl[0][1] + bl[1][1]) / 2)
    })
  }
  // 指北针：底面上向北 1 km 的两点
  tags.push(
    { key: "n0", pos: W(L, grid.cx, grid.cy, L.blockBase) },
    { key: "n1", pos: W(L, grid.cx, grid.cy + 1000, L.blockBase) }
  )
  // 页面面板用到的几个由地形算出的数
  const faceSurf = grid.z(act.face_x, fy)
  const faceSeam = seamB(L, act.face_x, fy)
  const facts = {
    faceDepth: Math.round(faceSurf - faceSeam),
    faceSurf: Math.round(faceSurf),
    faceSeam: Math.round(faceSeam),
    faceLen: Math.round(act.rect[3] - act.rect[1]),
    panelLen: Math.round(act.rect[2] - act.rect[0]),
    advanced: Math.round(act.rect[2] - act.face_x),
    wells: L.wells.length,
    relief: (() => {
      // 120 万个数不能展开传参，逐个比
      let lo = Infinity
      let hi = -Infinity
      for (const v of data) (lo = Math.min(lo, v)), (hi = Math.max(hi, v))
      return [Math.round(lo), Math.round(hi)]
    })()
  }

  // 镜头：各画面的默认取景，可用 opts.cam 覆盖（调构图用）
  const presets = {
    overview: {
      tx: 350,
      ty: -200,
      az: 50,
      pitch: 34,
      dist: 27500,
      fov: 30,
      lift: 0,
      shiftY: -0.05
    },
    underground: {
      tx: 2300,
      ty: -2700,
      az: 35,
      pitch: 42,
      dist: 13500,
      fov: 30,
      lift: -300
    },
    // 近景俯角超过约 42° 时无头 Chrome 截图会卡住（内置浏览器正常），设计稿取 40°
    closeup: {
      tx: 620,
      ty: 2200,
      az: 12,
      pitch: 40,
      dist: 3500,
      fov: 32,
      lift: 0,
      shiftY: 0.03
    }
  }
  const c = { ...presets[frame], ...(opts.cam || {}) }
  const camera = new THREE.PerspectiveCamera(c.fov, VW / VH, 50, 200000)
  const target = W(L, c.tx, c.ty, grid.z(c.tx, c.ty) + c.lift)
  placeCamera(camera, target, c.az, c.pitch, c.dist)
  scene.traverse(
    (o) =>
      o.material?.uniforms?.uHazeNear &&
      (o.material.uniforms.uHazeNear.value = c.dist * 0.9)
  )
  // 构图平移：把画面中心往下 / 往右挪，给顶栏和两侧面板留位置（单位：画面高度的比例）
  if (c.shiftX || c.shiftY)
    camera.setViewOffset(
      1920,
      1080,
      -(c.shiftX || 0) * 1080,
      -(c.shiftY || 0) * 1080,
      1920,
      1080
    )

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  composer.addPass(new UnrealBloomPass(bufRes, 0.55, 0.5, 0.92))
  composer.addPass(new OutputPass())
  composer.render()

  const project = (v) => {
    const p = v.clone().project(camera)
    return {
      x: ((p.x + 1) / 2) * VW,
      y: ((1 - p.y) / 2) * VH,
      visible: p.z < 1
    }
  }
  const gl = renderer.getContext()
  const dbg = gl.getExtension("WEBGL_debug_renderer_info")
  return {
    tags: tags.map((t) => ({ key: t.key, ...project(t.pos) })),
    info: { gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "?" },
    facts,
    layout: L
  }
}

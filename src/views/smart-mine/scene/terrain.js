/*
 * 地形沙盘：真实高程 + 航拍影像的地表、按地层上色的侧壁 / 剖切面、地台与背景
 * ----------------------------------------------------------
 * 坐标：layout.json 用局部米坐标（x 向东、y 向北、高程为海拔米）；
 * three.js 里 X = x，Z = -y，Y = (海拔 - 沙盘底面) × EXAG。
 * 地表着色器有 uGhost（0 = 实景，1 = 透视）在两种外观间渐变；侧壁按倾斜的 B 煤面算出每点所在地层。
 * 另有「扫描揭示」：一道青色光带沿地面扫过，扫过处为实景、未扫到处为透视（解说视频开场用，页面默认关闭）。
 * 自定义着色器都接了 three.js 的裁剪平面片段，剖切时由渲染器的全局裁剪面切开。
 */
import * as THREE from "three"
import { COLORS, EXAG, SEAM_MIN, SUN } from "./theme"

// ---------------- 坐标与数据 ----------------

/** 局部坐标 → 世界坐标 */
export function W(L, x, y, elev) {
  return new THREE.Vector3(x, (elev - L.blockBase) * EXAG, -y)
}

/** 指向太阳的单位向量（方位角从北顺时针：北 = -Z，东 = +X） */
export function sunDir() {
  const az = THREE.MathUtils.degToRad(SUN.az)
  const el = THREE.MathUtils.degToRad(SUN.el)
  return new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    -Math.cos(az) * Math.cos(el)
  ).normalize()
}

/** B 煤底板海拔：过工业广场的倾斜平面（与 prepare.py 的 seam_b 一致） */
export function seamB(L, x, y) {
  const s = L.seamPlane
  const t = Math.tan(THREE.MathUtils.degToRad(s.dipDeg))
  const az = THREE.MathUtils.degToRad(s.dipAz)
  const d = (x - s.refX) * Math.sin(az) + (y - s.refY) * Math.cos(az)
  return s.z0 - t * d
}

/**
 * 读高程 PNG：16 位整数拆在 R（高字节）、G（低字节）里。
 * 解码时关掉色彩空间转换与预乘，字节才能原样读回
 */
export async function loadHeights(url, code) {
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
  const px = g.getImageData(0, 0, c.width, c.height).data
  // close() 之后 bmp.width / height 会变成 0，后面一律用画布尺寸
  bmp.close()
  const out = new Float32Array(c.width * c.height)
  for (let i = 0; i < out.length; i++)
    out[i] = (px[i * 4] * 256 + px[i * 4 + 1]) / code.scale + code.offset
  return { data: out, nx: c.width, ny: c.height }
}

/** 高程网格：行从北到南、列从西到东，含四边顶点 */
export class HeightGrid {
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

  /** 最低 / 最高海拔 */
  range() {
    let lo = Infinity
    let hi = -Infinity
    for (const v of this.data) {
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    return [lo, hi]
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

function terrainMaterial(L, tex, overlay) {
  return new THREE.ShaderMaterial({
    clipping: true,
    uniforms: {
      uMap: { value: tex },
      uOverlay: { value: overlay },
      uOverlayK: { value: 0 },
      uSun: { value: sunDir() },
      uGhost: { value: 0 },
      // 扫描揭示：uScanOn 开关；扫描坐标 s = dot(局部 xy, uScanDir)，s < uScanPos 的一侧已扫过；uScanW 过渡宽度（米）
      uScanOn: { value: 0 },
      uScanDir: { value: new THREE.Vector2(0, 1) },
      uScanPos: { value: 0 },
      uScanW: { value: 250 },
      uHaze: { value: new THREE.Color(COLORS.haze) },
      uHazeK: { value: 0.00004 },
      uHazeNear: { value: 20000 },
      uSat: { value: 1.12 },
      uGain: { value: 1.06 },
      uBase: { value: L.blockBase },
      uExag: { value: EXAG }
    },
    vertexShader: /* glsl */ `
      #include <clipping_planes_pars_vertex>
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vN = normalize(normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        #include <clipping_planes_vertex>
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      #include <clipping_planes_pars_fragment>
      uniform sampler2D uMap;
      uniform sampler2D uOverlay;
      uniform float uOverlayK, uGhost, uHazeK, uHazeNear, uSat, uGain, uBase, uExag;
      uniform float uScanOn, uScanPos, uScanW;
      uniform vec2 uScanDir;
      uniform vec3 uSun, uHaze;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vWorld;
      void main() {
        #include <clipping_planes_fragment>
        vec3 c = texture2D(uMap, vUv).rgb;
        // 影像调色：NAIP 偏灰，稍提饱和度、亮度与对比
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = pow(max(mix(vec3(l), c, uSat) * uGain, 0.0), vec3(1.06));
        // 坡向补光：平地保持影像原色，迎光坡稍亮、背光坡稍暗（影像自带阴影，只补一点）
        vec3 n = normalize(vN);
        float shade = (0.5 + 0.62 * max(dot(n, uSun), 0.0)) / (0.5 + 0.62 * uSun.y);
        c *= mix(1.0, shade, 0.55);
        // 叠加图层：地下采区投影到地表
        vec4 ov = texture2D(uOverlay, vUv);
        c = mix(c, ov.rgb, ov.a * uOverlayK);
        // 扫描揭示：扫描线前方（还没扫到）保持透视外观，扫过的地方变成实景，扫描线处一道发光带
        float ghost = uGhost;
        float band = 0.0;
        if (uScanOn > 0.5) {
          float sc = dot(vec2(vWorld.x, -vWorld.z), uScanDir);
          ghost = max(ghost, smoothstep(uScanPos - uScanW, uScanPos + uScanW, sc));
          band = exp(-abs(sc - uScanPos) / (uScanW * 0.35));
        }
        // 透视外观：灰蓝 + 山体明暗 + 50 m 等高线（每 250 m 一条加粗）
        if (ghost > 0.001) {
          float elev = vWorld.y / uExag + uBase;
          float g = dot(c, vec3(0.3, 0.59, 0.11));
          float relief = 0.35 + 0.9 * max(dot(n, normalize(vec3(-0.5, 0.75, -0.45))), 0.0);
          vec3 gc = mix(vec3(0.04, 0.09, 0.16), vec3(0.2, 0.36, 0.52), clamp(g * 1.3, 0.0, 1.0)) * relief;
          float fw = fwidth(elev);
          float m50 = 1.0 - smoothstep(0.0, fw * 1.2, abs(fract(elev / 50.0 + 0.5) - 0.5) * 50.0);
          float m250 = 1.0 - smoothstep(0.0, fw * 1.6, abs(fract(elev / 250.0 + 0.5) - 0.5) * 250.0);
          gc += vec3(0.25, 0.65, 0.85) * (m50 * 0.1 + m250 * 0.42);
          c = mix(c, gc, ghost);
        }
        // 空气透视：比画面中心更远处逐渐偏蓝灰
        float d = length(vWorld - cameraPosition);
        float fog = 1.0 - exp(-max(d - uHazeNear, 0.0) * uHazeK);
        c = mix(c, uHaze, clamp(fog, 0.0, 0.45));
        // 扫描光带超过辉光阈值，后处理里会泛光
        c += vec3(0.15, 0.75, 1.0) * band * 1.7;
        gl_FragColor = vec4(c, max(mix(1.0, 0.42, ghost), band));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  })
}

/** 地表网格：每个高程点一个顶点，影像按网格范围铺满 */
export function buildTerrain(L, grid, tex, overlay) {
  const { nx, ny, step, cx, cy, data } = grid
  const pos = new Float32Array(nx * ny * 3)
  const uv = new Float32Array(nx * ny * 2)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      pos[k * 3] = cx - grid.w / 2 + i * step
      pos[k * 3 + 1] = (data[k] - L.blockBase) * EXAG
      pos[k * 3 + 2] = -(cy + grid.h / 2 - j * step)
      uv[k * 2] = i / (nx - 1)
      uv[k * 2 + 1] = 1 - j / (ny - 1)
    }
  }
  const idx = new Uint32Array((nx - 1) * (ny - 1) * 6)
  let p = 0
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i
      const c = a + nx
      idx.set([a, c, a + 1, a + 1, c, c + 1], p)
      p += 6
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3))
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2))
  g.setIndex(new THREE.BufferAttribute(idx, 1))
  g.computeVertexNormals()
  const mesh = new THREE.Mesh(g, terrainMaterial(L, tex, overlay))
  // 透视时地表最后画，叠在井下物体上面
  mesh.renderOrder = 10
  return mesh
}

/** 设置地表外观：ghost 0 = 实景、1 = 透视；overlay = 采区投影强度 */
export function setTerrainLook(mesh, ghost, overlay) {
  const u = mesh.material.uniforms
  u.uGhost.value = ghost
  u.uOverlayK.value = overlay
  // 透视（或扫描进行中、部分区域仍是透视）时半透明且不写深度（山脊前后重叠处按两层叠加），实景时不透明
  const see = ghost > 0.001 || u.uScanOn.value > 0.5
  mesh.material.transparent = see
  mesh.material.depthWrite = !see
}

// ---------------- 侧壁 / 剖切面的地层 ----------------

/**
 * 地层材质。section = 剖切面：额外在 B 煤带上画出工作面、采空区、垮落带与裂隙带、大巷断面
 */
export function strataMaterial(L, section = null) {
  const sp = L.seamPlane
  const az = THREE.MathUtils.degToRad(sp.dipAz)
  return new THREE.ShaderMaterial({
    clipping: true,
    side: THREE.DoubleSide,
    uniforms: {
      uRef: { value: new THREE.Vector3(sp.refX, sp.refY, sp.z0) },
      uTan: { value: Math.tan(THREE.MathUtils.degToRad(sp.dipDeg)) },
      uDir: { value: new THREE.Vector2(Math.sin(az), Math.cos(az)) },
      uTops: { value: L.strata.map((s) => Math.min(s.top, 5000)) },
      uCols: { value: L.strata.map((s) => new THREE.Color(s.color)) },
      uSeamC: { value: L.seams.map((s) => s.base + s.thick / 2) },
      uSeamH: {
        value: L.seams.map(
          (s) =>
            Math.max(s.thick * 2.5, s.mined ? SEAM_MIN : SEAM_MIN * 0.45) / 2
        )
      },
      uSun: { value: sunDir() },
      uBase: { value: L.blockBase },
      uSection: { value: section ? 1 : 0 },
      // 剖切面特征：x0 起采线、face 工作面、x1 切眼、大巷 / 回风联络巷 x
      uPanel: { value: new THREE.Vector3(...(section?.panel || [0, 0, 0])) },
      uRoads: { value: new THREE.Vector2(...(section?.roads || [0, 0])) },
      uTime: { value: 0 },
      uFade: { value: 1 }
    },
    vertexShader: /* glsl */ `
      #include <clipping_planes_pars_vertex>
      attribute vec3 aReal;
      attribute float aSurf;
      varying vec3 vReal;
      varying float vSurf;
      varying vec3 vN;
      void main() {
        vReal = aReal;
        vSurf = aSurf;
        vN = normal;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        #include <clipping_planes_vertex>
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      #include <clipping_planes_pars_fragment>
      uniform vec3 uRef;
      uniform float uTan, uBase, uSection, uTime, uFade;
      uniform vec2 uDir;
      uniform float uTops[6];
      uniform vec3 uCols[6];
      uniform float uSeamC[5];
      uniform float uSeamH[5];
      uniform vec3 uSun;
      uniform vec3 uPanel;
      uniform vec2 uRoads;
      varying vec3 vReal;
      varying float vSurf;
      varying vec3 vN;
      ${NOISE}
      // 条带色调：每个分层一个随机明暗，层与层之间按屏幕尺度平滑过渡（远处不闪烁）
      float bandTone(float h, float t, float seed) {
        float x = h / t + seed;
        float i = floor(x);
        float f = fract(x);
        float w = clamp(fwidth(x) * 1.5, 0.0, 0.5);
        return mix(hash(vec2(i, seed)), hash(vec2(i + 1.0, seed)), smoothstep(1.0 - w, 1.0, f));
      }
      void main() {
        #include <clipping_planes_fragment>
        float zb = uRef.z - uTan * ((vReal.x - uRef.x) * uDir.x + (vReal.y - uRef.y) * uDir.y);
        float h0 = vReal.z - zb;
        float s = vReal.x - vReal.y;
        // 层面略有起伏（低频）
        float h = h0 + (vnoise(vec2(s * 0.0009, 3.1)) - 0.5) * 10.0;
        vec3 c = uCols[5];
        float top = 0.0;
        float idx = 5.0;
        for (int i = 0; i < 6; i++) { if (h < uTops[i]) { c = uCols[i]; top = uTops[i]; idx = float(i); break; } }
        // 层内砂岩 / 泥岩互层
        float t = mix(9.0, 22.0, hash(vec2(idx, 7.0)));
        c *= 0.72 + 0.5 * bandTone(h, t, idx * 13.0);
        // 近处的岩石颗粒（远处按屏幕尺度淡出）
        vec2 gp = vec2(s * 0.06, h * 0.25);
        float gk = 1.0 - smoothstep(0.4, 1.2, length(fwidth(gp)));
        c *= 1.0 + (fbm(gp) - 0.5) * 0.35 * gk;
        // 地层界面暗线
        float fw = fwidth(h);
        c *= 1.0 - 0.45 * (1.0 - smoothstep(fw, fw * 2.5 + 1.5, abs(h - top)));
        // 煤层：黑色带
        for (int i = 0; i < 5; i++) {
          float k = 1.0 - smoothstep(uSeamH[i] - fw, uSeamH[i] + fw, abs(h - uSeamC[i]));
          c = mix(c, vec3(0.018, 0.018, 0.022), k);
        }
        vec3 glow = vec3(0.0);
        if (uSection > 0.5) {
          // 剖切面：B 煤带上的开采状态（不加起伏，和井下物体对齐）
          float bc = uSeamC[0];
          float bh = uSeamH[0];
          float x = vReal.x;
          bool inGoaf = x > uPanel.y && x < uPanel.z;
          float seam = 1.0 - smoothstep(bh - fw, bh + fw, abs(h0 - bc));
          if (inGoaf) {
            // 采空区：煤已采出，顶板垮落——煤带变成暗紫色碎块，其上 50 m 垮落带、150 m 裂隙带
            float up = h0 - (bc + bh);
            float rubble = vnoise(vec2(x * 0.08, h0 * 0.2));
            c = mix(c, vec3(0.22, 0.19, 0.3) * (0.6 + 0.6 * rubble), seam);
            float caved = (1.0 - smoothstep(40.0, 55.0, up)) * step(0.0, up);
            float frac = (1.0 - smoothstep(130.0, 160.0, up)) * step(0.0, up);
            float hatch = step(0.75, fract((x + h0 * 1.4) / 26.0));
            c = mix(c, c * vec3(0.7, 0.66, 0.9), caved * 0.55);
            c = mix(c, vec3(0.75, 0.7, 0.95), frac * hatch * 0.18 * (1.0 - caved));
          } else if (x > uPanel.x && x <= uPanel.y) {
            // 实体煤：略带光泽
            c = mix(c, vec3(0.03, 0.035, 0.045) * (1.0 + 0.6 * vnoise(vec2(x * 0.05, h0))), seam);
          }
          // 综采工作面：一道发光竖条
          float fd = abs(x - uPanel.y);
          float faceK = (1.0 - smoothstep(6.0, 10.0, fd)) * (1.0 - smoothstep(bh + 10.0, bh + 16.0, abs(h0 - bc)));
          glow += vec3(1.0, 0.45, 0.12) * faceK * (2.6 + 0.8 * sin(uTime * 4.0));
          // 大巷（进风蓝）与回风联络巷（红）的断面：煤层里的拱形巷道
          for (int r = 0; r < 2; r++) {
            float rx = r == 0 ? uRoads.x : uRoads.y;
            vec2 q = vec2((x - rx) / 22.0, (h0 - bc) / 14.0);
            float ring = 1.0 - smoothstep(0.0, 0.25, abs(length(q) - 1.0));
            float hole = 1.0 - step(1.0, length(q));
            c = mix(c, vec3(0.01), hole);
            glow += (r == 0 ? vec3(0.22, 0.78, 1.0) : vec3(1.0, 0.42, 0.35)) * ring * 2.2;
          }
        }
        // 表土与地表植被层
        float depth = vSurf - vReal.z;
        c = mix(vec3(0.20, 0.13, 0.075), c, smoothstep(4.0, 11.0, depth));
        c = mix(vec3(0.07, 0.085, 0.04), c, smoothstep(0.0, 2.5, depth));
        // 光照：天空环境光为主，向阳面略亮；越靠底越暗；内侧（透视时看到的远端侧壁）压暗
        float diff = max(dot(normalize(vN), uSun), 0.0);
        c *= 0.78 + 0.45 * diff;
        c *= mix(0.6, 1.0, smoothstep(uBase, uBase + 220.0, vReal.z));
        if (!gl_FrontFacing) c *= 0.38;
        gl_FragColor = vec4(c * uFade + glow, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  })
}

/** 竖直墙面：沿一串 (x, y) 点，上接地表、下到底面；normal 为外法线 */
function wallStrip(L, pts, grid, normal, mat) {
  const cnt = pts.length
  const pos = new Float32Array(cnt * 6)
  const real = new Float32Array(cnt * 6)
  const surf = new Float32Array(cnt * 2)
  const nor = new Float32Array(cnt * 6)
  pts.forEach(([x, y, z], c) => {
    const top = z ?? grid.z(x, y)
    for (const [r, elev] of [
      [0, top],
      [1, L.blockBase]
    ]) {
      const v = c * 2 + r
      pos.set([x, (elev - L.blockBase) * EXAG, -y], v * 3)
      real.set([x, y, elev], v * 3)
      surf[v] = top
      nor.set([normal.x, normal.y, normal.z], v * 3)
    }
  })
  const idx = []
  // 顶点按俯视顺时针排列时，这个绕序让正面朝外
  for (let c = 0; c < cnt - 1; c++) {
    const a = c * 2
    idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3))
  g.setAttribute("aReal", new THREE.BufferAttribute(real, 3))
  g.setAttribute("aSurf", new THREE.BufferAttribute(surf, 1))
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3))
  g.setIndex(idx)
  return new THREE.Mesh(g, mat)
}

/** 沙盘四周侧壁 + 底板 */
export function buildWalls(L, grid) {
  const { nx, ny, step, cx, cy, data } = grid
  const x0 = cx - grid.w / 2
  const y1 = cy + grid.h / 2
  const at = (k) => [
    x0 + (k % nx) * step,
    y1 - Math.floor(k / nx) * step,
    data[k]
  ]
  const edges = [
    [Array.from({ length: nx }, (_, i) => i), [0, 0, -1]], // 北
    [Array.from({ length: ny }, (_, j) => j * nx + nx - 1), [1, 0, 0]], // 东
    [
      Array.from({ length: nx }, (_, i) => (ny - 1) * nx + (nx - 1 - i)),
      [0, 0, 1]
    ], // 南
    [Array.from({ length: ny }, (_, j) => (ny - 1 - j) * nx), [-1, 0, 0]] // 西
  ]
  const mat = strataMaterial(L)
  const group = new THREE.Group()
  for (const [ids, n] of edges)
    group.add(wallStrip(L, ids.map(at), grid, new THREE.Vector3(...n), mat))
  // 底板：双面，透视时从上方透过地表看到的是暗色底板而不是地台的光晕
  const bottom = new THREE.Mesh(
    new THREE.PlaneGeometry(grid.w, grid.h).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: "#05080d", side: THREE.DoubleSide })
  )
  bottom.position.set(cx, 0, -cy)
  group.add(bottom)
  return { group, material: mat }
}

/** 剖切面：沿 y = cutY 的东西向竖直面，朝北（被切掉的一侧） */
export function buildSection(L, grid, cutY, feature) {
  const pts = []
  for (
    let x = grid.cx - grid.w / 2;
    x <= grid.cx + grid.w / 2 + 0.1;
    x += grid.step
  )
    pts.push([x, cutY])
  // 顶点自西向东：按俯视顺时针的约定，北侧墙的外法线朝北
  const mat = strataMaterial(L, feature)
  const mesh = wallStrip(L, pts, grid, new THREE.Vector3(0, 0, -1), mat)
  // 略往保留的一侧挪一点，避免和裁剪面重合被切掉
  mesh.position.z = 0.5
  return mesh
}

// ---------------- 地台与背景 ----------------

/** 背景：径向渐变的深蓝 */
export function backgroundTexture() {
  const c = document.createElement("canvas")
  c.width = 1920
  c.height = 1080
  const g = c.getContext("2d")
  const r = g.createRadialGradient(960, 470, 80, 960, 540, 1150)
  const [a, b, d] = COLORS.background
  r.addColorStop(0, a)
  r.addColorStop(0.45, b)
  r.addColorStop(1, d)
  g.fillStyle = r
  g.fillRect(0, 0, 1920, 1080)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** 地台：沙盘下方的暗色地面，带公里网格、沙盘投影和边缘泛光 */
export function buildFloor(grid) {
  const size = 90000
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uHalf: { value: new THREE.Vector2(grid.w / 2, grid.h / 2) },
        uCenter: { value: new THREE.Vector2(grid.cx, -grid.cy) },
        uGrid: { value: grid.w > 6000 ? 1000 : 250 }
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
        uniform float uGrid;
        varying vec2 vP;
        void main() {
          vec2 q = abs(vP - uCenter) - uHalf;
          float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
          float span = max(uHalf.x, uHalf.y);
          float fade = 1.0 - smoothstep(span * 0.3, span * 4.0, d);
          vec2 gp = abs(fract(vP / uGrid + 0.5) - 0.5) * uGrid;
          float fw = fwidth(vP.x) * 1.2;
          float grid = 1.0 - smoothstep(0.0, fw * 1.4, min(gp.x, gp.y));
          vec3 c = vec3(0.12, 0.45, 0.75) * grid * 0.22 * fade;
          float rim = exp(-max(d, 0.0) / (span * 0.037)) * step(0.0, d);
          float halo = exp(-max(d, 0.0) / (span * 0.3)) * step(0.0, d);
          c += vec3(0.1, 0.7, 0.95) * (rim * 0.5 + halo * 0.12);
          float shadow = (1.0 - smoothstep(-span * 0.07, span * 0.27, d)) * 0.8;
          float a = max(max(grid * 0.22 * fade, rim * 0.55 + halo * 0.15), shadow);
          gl_FragColor = vec4(mix(c, vec3(0.0), shadow * step(d, 0.0)), a);
          #include <colorspace_fragment>
        }
      `
    })
  )
  m.position.set(0, -6, 0)
  m.renderOrder = -1
  return m
}

// ---------------- 叠加图层：投影到地表的工作面范围 ----------------

export function overlayTexture(L, grid) {
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
  const style = {
    mined: ["rgba(170,160,220,0.10)", "rgba(210,200,255,0.55)", []],
    active: ["rgba(255,150,40,0.20)", "rgba(255,180,80,0.95)", []],
    ready: ["rgba(40,220,230,0.06)", "rgba(80,235,240,0.75)", []],
    planned: ["rgba(40,220,230,0.0)", "rgba(80,235,240,0.6)", [26, 18]]
  }
  for (const p of L.panels) {
    const [x0, y0, x1, y1] = p.rect
    const [a, b] = P(x0, y1)
    const [cc, d] = P(x1, y0)
    const [fill, stroke, dash] = style[p.status]
    g.fillStyle = fill
    g.fillRect(a, b, cc - a, d - b)
    g.strokeStyle = stroke
    g.lineWidth = 3.5
    g.setLineDash(dash)
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
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

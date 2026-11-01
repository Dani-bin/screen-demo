/**
 * 沙盘水面：景观湖、锦澜河、泳池、景观轴上的跌水
 * ----------------------------------------------------------
 * 实体沙盘里的水是蓝色亚克力：边缘浅青、中央深蓝，带细碎的纹理和灯光下的高光。
 * 这里用一个着色器统一画，每个形状用 aDepth 属性（0 = 岸边，1 = 最深处）控制渐变。
 * 夜里岸边亮一圈 LED，和沙盘里水岸灯带一样。
 */
import * as THREE from "three"
import { lakeOutline, lakeRadiusK, riverBanks, riverY } from "./shapes.js"

const VERT = /* glsl */ `
  attribute float aDepth;
  varying float vDepth;
  varying vec3 vWorld;
  void main() {
    vDepth = aDepth;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

const FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform vec3 uSkyCol;
  uniform vec3 uCam;
  uniform vec3 uEdge;
  uniform vec3 uDeep;
  uniform vec3 uLed;
  uniform float uLit;
  uniform float uNight;
  uniform float uSun;
  uniform vec4 uBase;
  varying float vDepth;
  varying vec3 vWorld;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }

  void main() {
    if (length((vWorld.xz - uBase.xy) / uBase.zw) > 0.998) discard;
    float d = clamp(vDepth, 0.0, 1.0);
    vec3 col = mix(uEdge, uDeep, smoothstep(0.0, 0.8, d));
    vec2 p = vWorld.xz * 0.22;
    float n1 = noise(p * 2.6 + vec2(uTime * 0.12, 0.0));
    float n2 = noise(p * 6.5 - vec2(0.0, uTime * 0.17));
    // 水底的碎石感：低频明暗
    col *= 0.86 + 0.28 * noise(vWorld.xz * 0.9 + 3.0) * (1.0 - 0.5 * d);
    vec3 nrm = normalize(vec3((n1 - 0.5) * 0.35, 1.0, (n2 - 0.5) * 0.35));
    vec3 V = normalize(uCam - vWorld);
    vec3 H = normalize(V + normalize(uSunDir));
    float spec = pow(max(dot(nrm, H), 0.0), 260.0) * uSun;
    float fres = pow(1.0 - max(dot(nrm, V), 0.0), 4.0);
    col += uSkyCol * fres * 0.5;
    col += uSunCol * spec * 0.9;
    // 岸灯和楼灯在水里拉出的暖色倒影：沿 x 一道道竖条，近岸强、远岸弱，随灯亮起
    float glint = pow(noise(vWorld.xz * 0.42 + vec2(0.0, uTime * 0.08)), 6.0);
    col += uLed * glint * uLit * 0.22 * (1.0 - 0.6 * d);
    // 夜里水面压暗，岸边一圈 LED
    col *= 0.82 * mix(1.0, 0.72, uNight);
    float rim = 1.0 - smoothstep(0.0, 0.14, d);
    col += uLed * rim * uLit * 0.4;
    gl_FragColor = vec4(col, 1.0);
  }
`

function makeMaterial(edge, deep, base) {
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color(0xffffff) },
      uSkyCol: { value: new THREE.Color(0xf4ead8) },
      uCam: { value: new THREE.Vector3() },
      uEdge: { value: new THREE.Color(edge) },
      uDeep: { value: new THREE.Color(deep) },
      uLed: { value: new THREE.Color(0x4fd8ff) },
      uLit: { value: 0 },
      uNight: { value: 0 },
      uSun: { value: 1 },
      uBase: { value: new THREE.Vector4(base.cx, -base.cy, base.rx, base.ry) }
    }
  })
  return m
}

/** 用顶点数组 + 深度属性拼一个网格 */
function meshFrom(positions, depths, index, material) {
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute("aDepth", new THREE.Float32BufferAttribute(depths, 1))
  g.setIndex(index)
  g.computeVertexNormals()
  return new THREE.Mesh(g, material)
}

/** 极坐标网格：湖 */
function lakeMesh(lake, material, y) {
  const rings = 14
  const segs = 80
  const pos = []
  const dep = []
  for (let k = 0; k <= rings; k++) {
    const f = k / rings
    for (let j = 0; j < segs; j++) {
      const t = (j / segs) * Math.PI * 2
      const kk = lakeRadiusK(t)
      pos.push(
        lake.cx + Math.cos(t) * (lake.w / 2) * kk * f,
        y,
        -(lake.cy + Math.sin(t) * (lake.d / 2) * kk * f)
      )
      dep.push(1 - f)
    }
  }
  const idx = []
  for (let k = 0; k < rings; k++) {
    for (let j = 0; j < segs; j++) {
      const a = k * segs + j
      const b = k * segs + ((j + 1) % segs)
      const c = (k + 1) * segs + j
      const d = (k + 1) * segs + ((j + 1) % segs)
      idx.push(a, c, b, b, c, d)
    }
  }
  // 朝上：三角形顺序保证法线向 +y
  const m = meshFrom(pos, dep, idx, material)
  m.geometry.computeVertexNormals()
  return m
}

/** 河：沿 x 的带状网格，两岸深度 0、中线深度 1 */
function riverMesh(river, material, y, x0, x1) {
  const rb = riverBanks(river, x0, x1)
  const pos = []
  const dep = []
  const n = rb.top.length
  for (let i = 0; i < n; i++) {
    const x = rb.top[i][0]
    pos.push(x, y, -rb.top[i][1])
    dep.push(0)
    pos.push(x, y, -riverY(river, x))
    dep.push(1)
    pos.push(x, y, -rb.bottom[i][1])
    dep.push(0)
  }
  const idx = []
  for (let i = 0; i < n - 1; i++) {
    const a = i * 3
    const b = (i + 1) * 3
    // 上半带、下半带，法线向上
    idx.push(a, a + 1, b, b, a + 1, b + 1)
    idx.push(a + 1, a + 2, b + 1, b + 1, a + 2, b + 2)
  }
  const m = meshFrom(pos, dep, idx, material)
  return m
}

/** 矩形水面（泳池、跌水台阶）：中心深、四边浅 */
function rectMesh(cx, cy, w, d, material, y) {
  const nx = 8
  const ny = 6
  const pos = []
  const dep = []
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const u = i / nx
      const v = j / ny
      pos.push(cx + (u - 0.5) * w, y, -(cy + (v - 0.5) * d))
      dep.push(Math.min(1, Math.min(u, 1 - u, v, 1 - v) * 2.6))
    }
  }
  const idx = []
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i
      const b = a + 1
      const c = a + nx + 1
      const e = c + 1
      idx.push(a, b, c, b, e, c)
    }
  }
  return meshFrom(pos, dep, idx, material)
}

/**
 * 建水面
 * @returns {{group: THREE.Group, update: Function, tilt: object}}
 */
export function buildWater(layout) {
  const A = (id) => layout.amenities.find((a) => a.id === id)
  const group = new THREE.Group()
  group.name = "water"
  const mats = []

  const lakeMat = makeMaterial(0x34788f, 0x124a6c, layout.base)
  const riverMat = makeMaterial(0x2f5a66, 0x142c38, layout.base)
  const poolMat = makeMaterial(0x7fd6e4, 0x2a86c4, layout.base)
  const stepMat = makeMaterial(0x8fd3e6, 0x3a8fc6, layout.base)
  mats.push(lakeMat, riverMat, poolMat, stepMat)

  const lake = A("LK01")
  group.add(lakeMesh(lake, lakeMat, 0.4))
  // 河只铺在底座圆内：按河中心线那一行的弦长截断
  const rv = A("RV01")
  group.add(
    riverMesh(
      rv,
      riverMat,
      0.3,
      layout.base.cx - layout.base.rx,
      layout.base.cx + layout.base.rx
    )
  )
  const pool = A("SW01")
  group.add(rectMesh(pool.cx, pool.cy, pool.w, pool.d, poolMat, 0.4))

  // 景观轴上的跌水：6 级，北高南低，每级一块小水面，之间用象牙色小坎分开
  const ax = A("AX01")
  const steps = 6
  const len = ax.d - 8
  const stepLen = len / steps
  const wall = new THREE.MeshStandardMaterial({
    color: 0xe6dfcd,
    roughness: 0.7
  })
  const jetMat = new THREE.MeshBasicMaterial({
    color: 0xe8f6ff,
    transparent: true,
    opacity: 0.7,
    toneMapped: false
  })
  for (let k = 0; k < steps; k++) {
    const cy = ax.cy + ax.d / 2 - 6 - stepLen * (k + 0.5)
    const y = 2.6 - k * 0.38
    group.add(rectMesh(0, cy, 5.2, stepLen - 1.2, stepMat, y))
    const lip = new THREE.Mesh(new THREE.BoxGeometry(6.4, y + 0.4, 0.9), wall)
    lip.position.set(0, (y + 0.4) / 2 - 0.4, -(cy - stepLen / 2 + 0.2))
    lip.receiveShadow = true
    group.add(lip)
    // 两侧扶手 + 台阶前缘一对白色小喷泉
    for (const sx of [-3.35, 3.35]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.9, stepLen),
        wall
      )
      rail.position.set(sx, y + 0.45, -cy)
      group.add(rail)
    }
    for (const sx of [-1.6, 1.6]) {
      const jet = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.34, 2.6, 8),
        jetMat
      )
      jet.position.set(sx, y + 1.5, -(cy - stepLen / 2 + 1.4))
      group.add(jet)
    }
  }

  const update = (t, light, camPos) => {
    for (const m of mats) {
      const u = m.uniforms
      u.uTime.value = t
      u.uSunDir.value.copy(light.dir)
      u.uSunCol.value.copy(light.sunColor)
      u.uSkyCol.value.copy(light.hemiSky)
      u.uCam.value.copy(camPos)
      u.uLit.value = light.lit
      u.uNight.value = light.night
      u.uSun.value = light.sunIntensity > 0.05 ? 1 : 0
    }
  }
  // 顺手导出湖岸线，别处要用（比如图层高亮）
  return { group, update, lakeOutline: () => lakeOutline(lake) }
}

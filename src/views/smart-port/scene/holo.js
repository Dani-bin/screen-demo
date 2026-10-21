/*
 * 智慧港口 全息孪生效果（定稿 A：深蓝实体 + 青色发光描边、AGV 光迹、作业路光带）
 * ----------------------------------------------------------
 * 发光都来自线条：线条颜色乘以亮度系数后超过辉光阈值（theme.bloom.threshold，约 1.15），实体表面不发光。
 *   edgeLines        普通网格的描边（EdgesGeometry）
 *   InstancedEdges   实例化描边：轨道吊、AGV 这类成百台的设备，每台一个 位置 / 朝向 / 颜色
 *   TrailLayer       AGV 光迹：每台车最近几秒的轨迹，往尾部渐隐
 *   RibbonLayer      作业路光带：岸桥 → 目标箱区，沿 AGV 车道走，光点流动
 * 坐标：x = u，z = −v，y 向上（与 PortScene 一致）。
 */
import * as THREE from "three"

/** 线条颜色：主题色 × 亮度系数（超过 1 才会被辉光提取） */
export function glowColor(hex, gain) {
  return new THREE.Color(hex).multiplyScalar(gain)
}

/** 普通网格的描边：阈值角 20°（盒子类几何只留棱线） */
export function edgeLines(geometry, color, threshold = 20) {
  const edges = new THREE.EdgesGeometry(geometry, threshold)
  const mat = new THREE.LineBasicMaterial({
    color,
    fog: true,
    transparent: true,
    opacity: 0.95
  })
  const lines = new THREE.LineSegments(edges, mat)
  lines.raycast = () => {}
  return lines
}

const INST_VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute float iRot;
  attribute vec3 iCol;
  varying vec3 vCol;
  #include <fog_pars_vertex>
  void main() {
    vCol = iCol;
    float c = cos(iRot), s = sin(iRot);
    // 绕 y 轴转：与 Object3D.rotation.y 相同的方向
    vec3 p = vec3(c * position.x + s * position.z, position.y, -s * position.x + c * position.z) + iPos;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`
const INST_FRAG = /* glsl */ `
  varying vec3 vCol;
  #include <fog_pars_fragment>
  void main() {
    gl_FragColor = vec4(vCol, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

/** 实例化描边：一份几何的棱线，画 count 份；setAt(i, x, y, z, rot, color) 摆放，hide(i) 藏起来 */
export class InstancedEdges {
  constructor(geometry, count, threshold = 20) {
    const edges = new THREE.EdgesGeometry(geometry, threshold)
    const g = new THREE.InstancedBufferGeometry()
    g.setAttribute("position", edges.attributes.position)
    g.instanceCount = count
    this.pos = new THREE.InstancedBufferAttribute(
      new Float32Array(count * 3),
      3
    )
    this.rot = new THREE.InstancedBufferAttribute(new Float32Array(count), 1)
    this.col = new THREE.InstancedBufferAttribute(
      new Float32Array(count * 3),
      3
    )
    g.setAttribute("iPos", this.pos)
    g.setAttribute("iRot", this.rot)
    g.setAttribute("iCol", this.col)
    const mat = new THREE.ShaderMaterial({
      vertexShader: INST_VERT,
      fragmentShader: INST_FRAG,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog])
    })
    this.lines = new THREE.LineSegments(g, mat)
    this.lines.frustumCulled = false
    this.lines.raycast = () => {}
  }
  setAt(i, x, y, z, rot, color) {
    this.pos.setXYZ(i, x, y, z)
    this.rot.setX(i, rot)
    this.col.setXYZ(i, color.r, color.g, color.b)
  }
  /** 藏起来：移到很远的地下（线段没有缩放属性） */
  hide(i) {
    this.pos.setXYZ(i, 0, -1e5, 0)
  }
  commit() {
    this.pos.needsUpdate = true
    this.rot.needsUpdate = true
    this.col.needsUpdate = true
  }
}

const TRAIL_VERT = /* glsl */ `
  attribute float aFade;
  varying float vFade;
  #include <fog_pars_vertex>
  void main() {
    vFade = aFade;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`
const TRAIL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vFade;
  #include <fog_pars_fragment>
  void main() {
    gl_FragColor = vec4(uColor * vFade, vFade);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

/**
 * AGV 光迹：每台车保存最近 N 个采样点（每 0.25 s 一个），画成线段，头亮尾暗。
 * push(i, x, z) 在每次采样时调用；停着不动的车不留光迹（相邻点太近就不加）。
 */
export class TrailLayer {
  constructor(count, { color, n = 14, y = 8.2 }) {
    this.count = count
    this.n = n
    this.y = y
    this.hist = Array.from({ length: count }, () => [])
    const segs = count * (n - 1)
    this.posArr = new Float32Array(segs * 2 * 3)
    this.fadeArr = new Float32Array(segs * 2)
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.BufferAttribute(this.posArr, 3))
    g.setAttribute("aFade", new THREE.BufferAttribute(this.fadeArr, 1))
    this.geo = g
    const mat = new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      fog: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uColor: { value: color } }
      ])
    })
    this.lines = new THREE.LineSegments(g, mat)
    this.lines.frustumCulled = false
    this.lines.raycast = () => {}
  }
  push(i, x, z) {
    const h = this.hist[i]
    const last = h[h.length - 1]
    if (last && Math.hypot(last[0] - x, last[1] - z) < 0.6) return
    // 跳变（换任务、平滑前的位置突变）不连线
    if (last && Math.hypot(last[0] - x, last[1] - z) > 40) h.length = 0
    h.push([x, z])
    if (h.length > this.n) h.shift()
  }
  /** 清掉某台车的光迹（故障、换电、定位中断时） */
  clear(i) {
    this.hist[i].length = 0
  }
  update() {
    const P = this.posArr
    const F = this.fadeArr
    let k = 0
    for (let i = 0; i < this.count; i++) {
      const h = this.hist[i]
      for (let j = 0; j < this.n - 1; j++) {
        const a = h[j]
        const b = h[j + 1]
        const o = k * 6
        if (a && b) {
          P[o] = a[0]
          P[o + 1] = this.y
          P[o + 2] = a[1]
          P[o + 3] = b[0]
          P[o + 4] = this.y
          P[o + 5] = b[1]
          // 越靠近车头越亮
          F[k * 2] = ((j + 1) / h.length) ** 1.6
          F[k * 2 + 1] = ((j + 2) / h.length) ** 1.6
        } else {
          P.fill(0, o, o + 6)
          F[k * 2] = F[k * 2 + 1] = 0
        }
        k++
      }
    }
    this.geo.attributes.position.needsUpdate = true
    this.geo.attributes.aFade.needsUpdate = true
  }
}

const RIBBON_VERT = /* glsl */ `
  attribute float aDist;
  varying float vDist;
  varying float vSide;
  #include <fog_pars_vertex>
  void main() {
    vDist = aDist;
    vSide = uv.y;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`
const RIBBON_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  varying float vDist;
  varying float vSide;
  #include <fog_pars_fragment>
  void main() {
    // 横向：中间亮两边淡；纵向：每 70 m 一个光点向箱区流动
    float edge = 1.0 - abs(vSide * 2.0 - 1.0);
    float pulse = pow(fract(vDist / 70.0 - uTime * 0.6), 6.0);
    float a = edge * (0.45 + 1.3 * pulse);
    gl_FragColor = vec4(uColor * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

/**
 * 作业路光带：一条在作业的岸桥对应一条光带，路径 岸桥下（v≈55）→ 车道（v≈110）→ 目标箱区海侧（v≈150）。
 * set(list) 传入 [{ key, u0, u1 }]，key 不变时不重建几何。
 */
export class RibbonLayer {
  constructor({ color, width = 6, y = 7.6 }) {
    this.group = new THREE.Group()
    this.mat = new THREE.ShaderMaterial({
      vertexShader: RIBBON_VERT,
      fragmentShader: RIBBON_FRAG,
      fog: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uColor: { value: color }, uTime: { value: 0 } }
      ])
    })
    this.width = width
    this.y = y
    this.meshes = new Map()
  }
  /** 控制点 → 平滑曲线（Catmull-Rom，向心参数化不打结）→ 贴地的平带（每个采样点两侧各一个顶点） */
  build(pts) {
    const curve = new THREE.CatmullRomCurve3(
      pts.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      false,
      "centripetal"
    )
    const n = Math.max(8, Math.ceil(curve.getLength() / 5))
    const dense = curve.getSpacedPoints(n).map((p) => [p.x, p.z])
    const pos = []
    const uv = []
    const dist = []
    const idx = []
    let d = 0
    for (let i = 0; i < dense.length; i++) {
      const p = dense[i]
      const q = dense[Math.min(dense.length - 1, i + 1)]
      const o = dense[Math.max(0, i - 1)]
      const tx = q[0] - o[0]
      const tz = q[1] - o[1]
      const tl = Math.hypot(tx, tz) || 1
      const nx = -tz / tl
      const nz = tx / tl
      if (i) d += Math.hypot(p[0] - dense[i - 1][0], p[1] - dense[i - 1][1])
      const w = this.width / 2
      pos.push(
        p[0] + nx * w,
        this.y,
        p[1] + nz * w,
        p[0] - nx * w,
        this.y,
        p[1] - nz * w
      )
      uv.push(0, 0, 0, 1)
      dist.push(d, d)
      if (i) {
        const a = (i - 1) * 2
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
    g.setAttribute("aDist", new THREE.Float32BufferAttribute(dist, 1))
    g.setIndex(idx)
    return g
  }
  /** list：[{ key, pts: [[x, z], ...] }]，坐标已是世界 x / z */
  set(list) {
    const keep = new Set(list.map((l) => l.key))
    for (const [k, m] of this.meshes)
      if (!keep.has(k)) {
        this.group.remove(m)
        m.geometry.dispose()
        this.meshes.delete(k)
      }
    for (const l of list) {
      if (this.meshes.has(l.key)) continue
      const m = new THREE.Mesh(this.build(l.pts), this.mat)
      m.renderOrder = 2
      m.raycast = () => {}
      this.meshes.set(l.key, m)
      this.group.add(m)
    }
  }
  tick(time) {
    this.mat.uniforms.uTime.value = time
  }
}

const LANE_VERT = /* glsl */ `
  attribute float aDist;
  attribute float aDir;
  attribute float aSeed;
  varying float vDist;
  varying float vDir;
  varying float vSeed;
  varying float vSide;
  #include <fog_pars_vertex>
  void main() {
    vDist = aDist;
    vDir = aDir;
    vSeed = aSeed;
    vSide = uv.y;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`
const LANE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  varying float vDist;
  varying float vDir;
  varying float vSeed;
  varying float vSide;
  #include <fog_pars_fragment>
  void main() {
    // 横向中间亮；纵向：暗底 + 两组不同间距的光段沿车道方向流动（像长曝光的车流）
    float edge = 1.0 - abs(vSide * 2.0 - 1.0);
    float s = vDist * vDir;
    float p1 = pow(fract(s / 140.0 - uTime * 0.22 + vSeed), 10.0);
    float p2 = pow(fract(s / 61.0 - uTime * 0.35 + vSeed * 2.7), 16.0);
    float a = edge * (0.22 + 1.2 * p1 + 0.6 * p2);
    gl_FragColor = vec4(uColor * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

/**
 * AGV 车道光流：每条车道一条贴地细带，相邻车道方向相反，光段沿车道流动（不对应具体车辆，表示车道在用）。
 * lanes：车道的 v（米），u0 / u1：车道起止 u。坐标换算 x = u、z = −v。
 */
export class LaneFlow {
  constructor(lanes, { u0, u1, color, width = 2.4, y = 7.5 }) {
    const pos = []
    const uv = []
    const dist = []
    const dir = []
    const seed = []
    const idx = []
    let base = 0
    lanes.forEach((v, li) => {
      const d = li % 2 ? -1 : 1
      const sd = (Math.sin(li * 78.233) * 43758.5453) % 1
      for (let u = u0, k = 0; u <= u1; u += 10, k++) {
        pos.push(u, y, -(v - width / 2), u, y, -(v + width / 2))
        uv.push(0, 0, 0, 1)
        dist.push(u, u)
        dir.push(d, d)
        seed.push(sd, sd)
        if (k) {
          const a = base + (k - 1) * 2
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
        }
      }
      base = pos.length / 3
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
    g.setAttribute("aDist", new THREE.Float32BufferAttribute(dist, 1))
    g.setAttribute("aDir", new THREE.Float32BufferAttribute(dir, 1))
    g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1))
    g.setIndex(idx)
    this.mat = new THREE.ShaderMaterial({
      vertexShader: LANE_VERT,
      fragmentShader: LANE_FRAG,
      fog: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uColor: { value: color }, uTime: { value: 0 } }
      ])
    })
    this.mesh = new THREE.Mesh(g, this.mat)
    this.mesh.renderOrder = 1
    this.mesh.raycast = () => {}
  }
  tick(time) {
    this.mat.uniforms.uTime.value = time
  }
}

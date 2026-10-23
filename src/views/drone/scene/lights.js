/*
 * 无人机巡检监控平台 · 灯光点缀（黄昏氛围，对照定稿 final.png）
 * ----------------------------------------------------------
 * 模型里的灯头（M_lamp_unit 装置平台灯、M_lamp_sodium 路灯 / 船灯 / 栈桥灯）在主机位下离相机约 2 km，
 * 实际尺寸不到 1 个像素，画面上几乎看不到；定稿里装置区、罐区、道路上却布满暖橙色小灯和路灯光池，
 * 江面上有一条条灯光倒影（评审意见，比对第 37 轮）。这里在加载后把灯头一个个找出来，叠三样东西：
 *
 *   - 光晕 LampGlow：每盏灯一个暖色光点（Points，一次绘制；颜色高于辉光阈值，经 UnrealBloom 晕开）
 *   - 光池 pools：路灯脚下地面上的一圈暖光（InstancedMesh 的水平圆片，叠加混合）
 *   - 倒影 streaks：靠江的灯在水面上拉一条朝向镜头的光带（InstancedMesh；镜头动了才重摆）
 *
 * 灯头的位置：普通网格按"顶点位置相同即相连"拆连通块，每块（一个灯头小方块）取中心；GPU 实例逐个实例取中心。
 * 只在加载时算一次。所有尺寸单位为米，坐标为 three.js 世界坐标（X 东、Y 上、Z 南）。
 */
import * as THREE from "three"
import SITE from "../data/site.js"

/** 材质名 → 灯的种类 */
const LAMP_KIND = { M_lamp_unit: "unit", M_lamp_sodium: "street" }

// 外观参数（世界尺寸，米）。第 37 轮初值（装置灯 4.5 m / 增益 2.6、路灯 7 m / 3.2、光池半径 11 m）
// 灯太大太亮，像散景光斑，装置区、江面整体发亮（色差 9.8 / 8.3）；第 38 轮缩小调暗
const GLOW = {
  unit: { size: 2.6, color: [1.0, 0.6, 0.28], gain: 1.7 },
  street: { size: 4, color: [1.0, 0.66, 0.34], gain: 2.2 }
}
const POOL_R = 8 // 路灯光池半径
const STREAK_W = 2.6 // 倒影光带宽度
const WATER_Y = -2.45 // 江面高度（GROUND_river 在 z = -2.5，略高一点免得深度冲突）

/** 柔边圆形贴图：中心 1、边缘 0（光晕、光池共用） */
function radialTexture(power = 1.6) {
  const n = 64
  const c = document.createElement("canvas")
  c.width = c.height = n
  const g = c.getContext("2d")
  const img = g.createImageData(n, n)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2)
      const v = Math.round(255 * Math.pow(Math.max(0, 1 - r), power))
      const i = (y * n + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = v
    }
  g.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** 倒影光带贴图：v = 0 为灯脚下的倒影起点最亮，沿长度渐隐；横向高斯 */
function streakTexture() {
  const w = 32
  const h = 128
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  const g = c.getContext("2d")
  const img = g.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1)
    const along = Math.pow(1 - t, 1.4) * (0.4 + 0.6 * Math.exp(-t * 5))
    for (let x = 0; x < w; x++) {
      const s = (x / (w - 1)) * 2 - 1
      const i = (y * w + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = Math.round(255 * along * Math.exp(-s * s * 4))
    }
  }
  g.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** 网格里一个个灯头的中心（世界坐标）：顶点位置相同即相连，按连通块取包围盒中心 */
function lampCenters(mesh) {
  mesh.updateWorldMatrix(true, false)
  const g = mesh.geometry
  const pos = g.attributes.position
  const out = []
  if (mesh.isInstancedMesh) {
    // GPU 实例：每个实例一盏灯，取几何体包围盒中心
    g.computeBoundingBox()
    const c = g.boundingBox.getCenter(new THREE.Vector3())
    const m = new THREE.Matrix4()
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m)
      out.push(c.clone().applyMatrix4(m).applyMatrix4(mesh.matrixWorld))
    }
    return out
  }
  // 并查集：同一位置（1 cm 网格）的顶点合并，同一三角形的顶点合并
  const n = pos.count
  const parent = new Int32Array(n).map((_, i) => i)
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]]
    return i
  }
  const join = (a, b) => {
    a = find(a)
    b = find(b)
    if (a !== b) parent[a] = b
  }
  const seen = new Map()
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 100)},${Math.round(pos.getY(i) * 100)},${Math.round(pos.getZ(i) * 100)}`
    if (seen.has(k)) join(i, seen.get(k))
    else seen.set(k, i)
  }
  const idx = g.index
  const tri = idx ? idx.count : n
  for (let t = 0; t < tri; t += 3) {
    const a = idx ? idx.getX(t) : t
    join(a, idx ? idx.getX(t + 1) : t + 1)
    join(a, idx ? idx.getX(t + 2) : t + 2)
  }
  const boxes = new Map()
  const v = new THREE.Vector3()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    if (!boxes.has(r)) boxes.set(r, new THREE.Box3())
    boxes.get(r).expandByPoint(v.fromBufferAttribute(pos, i))
  }
  for (const b of boxes.values())
    out.push(b.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld))
  return out
}

/** 江面水线（场地坐标 y，按 x 插值）：岸线以南是水 */
function waterLineAt(x) {
  const line = SITE.river.waterLine
  if (x <= line[0][0]) return line[0][1]
  for (let i = 1; i < line.length; i++)
    if (x <= line[i][0]) {
      const [x0, y0] = line[i - 1]
      const [x1, y1] = line[i]
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1)
    }
  return line[line.length - 1][1]
}

const GLOW_VERT = `
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uScale;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // aSize 是世界尺寸（米），换算成像素；上限 48 px，跟随近景时不至于糊成一大片
    gl_PointSize = min(aSize * uScale / -mv.z, 48.0);
    gl_Position = projectionMatrix * mv;
  }`
const GLOW_FRAG = `
  uniform sampler2D map;
  varying vec3 vColor;
  void main() {
    float a = texture2D(map, gl_PointCoord).a;
    gl_FragColor = vec4(vColor * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`

export class LampLights {
  /**
   * root：园区模型（加载、调完材质之后）；scene：加到哪个场景
   * 统计结果在 this.count（{ unit, street, streaks }）
   */
  constructor(scene, root) {
    this.group = new THREE.Group()
    this.group.name = "LAMP_LIGHTS"
    scene.add(this.group)
    this.disposables = []
    const lamps = []
    root.traverse((o) => {
      if (!o.isMesh) return
      const m = [].concat(o.material).find((x) => LAMP_KIND[x.name])
      if (!m) return
      for (const p of lampCenters(o)) lamps.push({ p, kind: LAMP_KIND[m.name] })
    })
    this.count = {
      unit: lamps.filter((l) => l.kind === "unit").length,
      street: lamps.filter((l) => l.kind === "street").length,
      streaks: 0
    }
    if (!lamps.length) return
    this._glow(lamps)
    this._pools(lamps.filter((l) => l.kind === "street"))
    this._streaks(lamps)
  }

  /** 光晕：所有灯一个 Points，大小 / 亮度带一点随机起伏（固定种子，截图可复现） */
  _glow(lamps) {
    const n = lamps.length
    const pos = new Float32Array(n * 3)
    const size = new Float32Array(n)
    const col = new Float32Array(n * 3)
    let seed = 7
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    lamps.forEach((l, i) => {
      const g = GLOW[l.kind]
      pos.set([l.p.x, l.p.y, l.p.z], i * 3)
      size[i] = g.size * (0.75 + rnd() * 0.5)
      const k = g.gain * (0.7 + rnd() * 0.6)
      col.set(
        g.color.map((c) => c * k),
        i * 3
      )
    })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1))
    geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3))
    const tex = radialTexture(2.2)
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uScale: { value: 1 } },
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
    const pts = new THREE.Points(geo, mat)
    const v2 = new THREE.Vector2()
    // 按当前相机（主画面 / 机载画面）和渲染目标高度换算点的像素大小
    pts.onBeforeRender = (renderer, _s, camera) => {
      const rt = renderer.getRenderTarget()
      const h = rt ? rt.height : renderer.getDrawingBufferSize(v2).y
      const fov = camera.isPerspectiveCamera ? camera.fov : 30
      mat.uniforms.uScale.value = h / (2 * Math.tan((fov * Math.PI) / 360))
    }
    this.group.add(pts)
    this.disposables.push(geo, mat, tex)
  }

  /** 路灯光池：灯脚下地面的暖色圆片（叠加混合，略高于地面并用多边形偏移，免得和地面打架） */
  _pools(lamps) {
    if (!lamps.length) return
    const tex = radialTexture(1.8)
    const geo = new THREE.CircleGeometry(POOL_R, 24).rotateX(-Math.PI / 2)
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      color: new THREE.Color(1.0, 0.62, 0.3).multiplyScalar(0.3),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -8
    })
    const im = new THREE.InstancedMesh(geo, mat, lamps.length)
    const m = new THREE.Matrix4()
    lamps.forEach((l, i) => {
      // 灯头离地越高，光池越大越淡（这里只放大）
      const s = THREE.MathUtils.clamp(l.p.y / 10, 0.7, 1.6)
      m.makeScale(s, 1, s).setPosition(l.p.x, 0.35, l.p.z)
      im.setMatrixAt(i, m)
    })
    im.instanceMatrix.needsUpdate = true
    // 光池铺在整个园区，包围球按实例算
    im.computeBoundingSphere()
    this.group.add(im)
    this.disposables.push(geo, mat, tex)
  }

  /**
   * 水面倒影：远处观察者看到的灯影，落在"灯脚下 → 观察者"方向上、离灯约 d·h/(H+h) 处
   * （d 灯到相机的水平距离，h 灯高，H 相机高）；只保留落在江面上的。光带从倒影点朝镜头方向延伸。
   */
  _streaks(lamps) {
    this.streakLamps = []
    for (const l of lamps) {
      const yNorth = -l.p.z // 场地坐标 y
      // 江边 200 m 以内的灯才可能在江面上有倒影
      if (yNorth > waterLineAt(l.p.x) + 200) continue
      this.streakLamps.push(l)
    }
    if (!this.streakLamps.length) return
    const tex = streakTexture()
    // 单位光带：沿局部 +Z 从 0 延伸到 1（起点在倒影点，朝镜头方向）
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
    geo.translate(0, 0, 0.5)
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      color: new THREE.Color(1.0, 0.6, 0.3).multiplyScalar(1.0),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
    this.streaks = new THREE.InstancedMesh(geo, mat, this.streakLamps.length)
    this.streaks.frustumCulled = false
    this.group.add(this.streaks)
    this.disposables.push(geo, mat, tex)
    this._lastCam = new THREE.Vector3(Infinity, 0, 0)
  }

  /** 每帧：镜头移动后重摆倒影光带（主机位静止时不做任何事） */
  update(camera) {
    if (!this.streaks) return
    const cp = camera.position
    if (cp.distanceToSquared(this._lastCam) < 1) return
    this._lastCam.copy(cp)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    let k = 0
    for (const l of this.streakLamps) {
      const dx = cp.x - l.p.x
      const dz = cp.z - l.p.z
      const d = Math.hypot(dx, dz)
      const h = Math.max(1, l.p.y - WATER_Y)
      const H = Math.max(1, cp.y - WATER_Y)
      const off = (d * h) / (H + h)
      const x = l.p.x + (dx / d) * off
      const z = l.p.z + (dz / d) * off
      // 倒影点要落在江面上（水线以南）
      if (-z > waterLineAt(x)) continue
      q.setFromAxisAngle(up, Math.atan2(dx, dz))
      const len = 18 + h * 2.4
      m.compose(
        new THREE.Vector3(x, WATER_Y, z),
        q,
        new THREE.Vector3(STREAK_W * (0.8 + h / 40), 1, len)
      )
      this.streaks.setMatrixAt(k++, m)
    }
    this.streaks.count = k
    this.count.streaks = k
    this.streaks.instanceMatrix.needsUpdate = true
  }

  dispose() {
    for (const d of this.disposables) d.dispose()
    this.streaks?.dispose()
  }
}

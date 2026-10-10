/*
 * 车流：沿真实道路中心线（data/parkData.js 的 PARK_ROADS）行驶的小车
 * ----------------------------------------------------------
 * 设计稿里大道上有成串的车灯，是夜景「活起来」的关键。每辆车 = 深色车身 + 路面上的白色前照灯光束 + 红色尾灯光团，
 * 三者各用一个 InstancedMesh，所有车一次绘制。
 * 车道：单行道（OSM oneway，点序即方向）两条车道同向；双向道路两个方向各占半幅（靠右行驶）。
 */
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  ShaderMaterial,
  Object3D,
  PlaneGeometry,
  DynamicDrawUsage
} from "three"

const BODY_COLORS = [0x1b2028, 0x2a313b, 0x9aa3ad, 0xd5dbe1, 0x3a4250, 0x14181e]
const Y = 0.75 // 车身中心高度

/** 折线 → { pts, cum, len }：每个顶点处的累计里程 */
function measure(pts) {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1]
    const [x1, z1] = pts[i]
    cum.push(cum[i - 1] + Math.hypot(x1 - x0, z1 - z0))
  }
  return { pts, cum, len: cum[cum.length - 1] }
}

/** 里程 s 处的位置与方向（向右偏移 offset 米，模拟车道） */
function sample(path, s, offset, out) {
  const { pts, cum } = path
  let i = 1
  while (i < cum.length - 1 && cum[i] < s) i++
  const [x0, z0] = pts[i - 1]
  const [x1, z1] = pts[i]
  const seg = cum[i] - cum[i - 1] || 1
  const t = (s - cum[i - 1]) / seg
  const dx = (x1 - x0) / seg
  const dz = (z1 - z0) / seg
  // 前进方向 (dx, dz) 的右手侧（俯视、y 向上）为 (-dz, dx)
  out.x = x0 + (x1 - x0) * t - dz * offset
  out.z = z0 + (z1 - z0) * t + dx * offset
  out.heading = Math.atan2(dx, dz)
  return out
}

export class Traffic {
  /**
   * @param {Array} roads PARK_ROADS
   * @param {{ spacing:number, speed:[number, number] }} opts
   */
  constructor(roads, opts) {
    this.cars = []
    const rnd = mulberry32(42)
    for (const r of roads) {
      if (r.points.length < 2) continue
      const fwd = measure(r.points)
      const rev = measure([...r.points].reverse())
      if (fwd.len < 30) continue
      // 车道：[路径, 右偏移]
      const lanes = r.oneway
        ? [
            [fwd, -r.width * 0.2],
            [fwd, r.width * 0.2]
          ]
        : [
            [fwd, r.width * 0.25],
            [rev, r.width * 0.25]
          ]
      for (const [path, offset] of lanes) {
        const n = Math.max(1, Math.floor(path.len / opts.spacing))
        for (let k = 0; k < n; k++) {
          this.cars.push({
            path,
            offset,
            s: (k + rnd() * 0.6) * (path.len / n),
            speed: opts.speed[0] + rnd() * (opts.speed[1] - opts.speed[0]),
            color: BODY_COLORS[Math.floor(rnd() * BODY_COLORS.length)]
          })
        }
      }
    }
    const n = this.cars.length
    const bodyGeo = new BoxGeometry(1.9, 1.5, 4.5)
    // 车灯：远看一辆车只有两三个像素，车头小灯面读不出来；改成贴在路面上的光斑——
    // 车前一条长的白色光束（前照灯照亮路面）、车后一团红色尾灯光，叠加混合，成串时就是设计稿里的车流光带
    const beamGeo = new PlaneGeometry(3.2, 11)
    beamGeo.rotateX(-Math.PI / 2)
    beamGeo.translate(0, -Y + 0.25, 2.25 + 5.5)
    const tailGeo = new PlaneGeometry(3.4, 3.6)
    tailGeo.rotateX(-Math.PI / 2)
    tailGeo.translate(0, -Y + 0.25, -2.6)
    this.body = new InstancedMesh(
      bodyGeo,
      new MeshStandardMaterial({ roughness: 0.35, metalness: 0.6 }),
      n
    )
    this.head = new InstancedMesh(
      beamGeo,
      glowMaterial(new Color(0xfff0d0), 2.4, true),
      n
    )
    this.tail = new InstancedMesh(
      tailGeo,
      glowMaterial(new Color(0xff2a2a), 2.0, false),
      n
    )
    const c = new Color()
    this.cars.forEach((car, i) => this.body.setColorAt(i, c.setHex(car.color)))
    for (const m of [this.body, this.head, this.tail]) {
      m.instanceMatrix.setUsage(DynamicDrawUsage)
      m.frustumCulled = false
    }
    this._o = new Object3D()
    this._p = {}
    this.update(0)
  }

  get meshes() {
    return [this.body, this.head, this.tail]
  }

  update(dt) {
    const o = this._o
    const p = this._p
    const m = new Matrix4()
    this.cars.forEach((car, i) => {
      car.s = (car.s + car.speed * dt) % car.path.len
      sample(car.path, car.s, car.offset, p)
      o.position.set(p.x, Y, p.z)
      o.rotation.set(0, p.heading, 0)
      o.updateMatrix()
      m.copy(o.matrix)
      this.body.setMatrixAt(i, m)
      this.head.setMatrixAt(i, m)
      this.tail.setMatrixAt(i, m)
    })
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true
  }

  dispose() {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose()
      mesh.material.dispose()
      mesh.dispose()
    }
  }
}

/**
 * 路面光斑材质：叠加混合，按 UV 画出柔和的光团。
 * beam=true 时为前照灯光束：靠车头一端最亮、向前逐渐变暗，横向收窄
 */
function glowMaterial(color, strength, beam) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uColor: { value: color }, uStrength: { value: strength } },
    defines: beam ? { BEAM: 1 } : {},
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        #ifdef BEAM
          // 平面绕 x 转了 -90°，uv.y = 1 在车头一侧
          float along = vUv.y;
          float a = pow(along, 1.6) * (1.0 - smoothstep(0.2, 1.0, abs(p.x) / mix(0.35, 1.0, 1.0 - along)));
        #else
          float a = 1.0 - smoothstep(0.0, 1.0, length(p));
          a = a * a;
        #endif
        gl_FragColor = vec4(uColor * uStrength, a);
      }`
  })
}

/** 固定种子的伪随机数：每次进入页面车流分布一致 */
function mulberry32(a) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

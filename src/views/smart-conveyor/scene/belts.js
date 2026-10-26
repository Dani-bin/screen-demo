/*
 * 皮带、巷道、沿线传感器光点
 * ----------------------------------------------------------
 * 皮带：沿剖面路径的带面条带。着色器里
 *   - 沿线煤量（kg/m）做成 1D 纹理（每秒从 sim.profile 更新），亮度 = 装载率：有煤的地方琥珀色发亮，空带是暗褐色
 *   - 煤块光斑按"带面走过的距离"滚动：每帧按当前带速积分（集控覆盖后的带速也一样），带速快光斑跑得快，停车停住
 *   - 状态：停车 / 待机整体变暗，起车预警 / 软启动黄色闪烁，闭锁偏橙，保护停机红色闪烁
 * 巷道：同一路径的半透明管，菲涅尔边缘发青光（AdditiveBlending，不写深度）
 * 传感器：摄像机、环境监测、托辊温速按里程摆成青色小光点
 */
import * as THREE from "three"
import { THEME, TOKENS } from "./theme.js"
import { beltPath, pathAt, sideOf, BELTS, chainageToPoint } from "./section.js"

const DENSITY_N = 256

/**
 * 煤流：沿路径的发光管（定稿里是粗的琥珀色光带；主机位几乎贴着带面看，平铺的带面只剩一条细线，所以做成管）。
 * TubeGeometry 的 uv.x = 沿路径 0…1（着色器里乘真实长度换成里程），uv.y = 绕管一圈 0…1
 */
function coalTubeGeometry(id, radius) {
  const { pts, len } = beltPath(id)
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal", 0)
  return new THREE.TubeGeometry(
    curve,
    Math.max(40, Math.round(len / 12)),
    radius,
    10,
    false
  )
}

function beltMaterial(id) {
  const data = new Uint8Array(DENSITY_N * 4)
  const tex = new THREE.DataTexture(data, DENSITY_N, 1, THREE.RGBAFormat)
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.needsUpdate = true
  const b = THEME.belt
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uDensity: { value: tex },
      uL: { value: BELTS[id].L },
      uTravel: { value: 0 },
      uTime: { value: 0 },
      uOn: { value: 1 }, // 1 运行，0 停车（变暗）
      uFault: { value: 0 }, // 1 保护停机（偏红）
      uWarn: { value: 0 }, // 1 起车预警 / 软启动（黄闪）
      uLock: { value: 0 }, // 1 闭锁（偏橙）
      uCoal: { value: new THREE.Color(b.coal) },
      uHot: { value: new THREE.Color(b.hot) },
      uIdle: { value: new THREE.Color(b.idle) },
      uRed: { value: new THREE.Color(b.fault) },
      uGlow: { value: b.glow }
    },
    side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D uDensity; uniform float uL, uTravel, uTime, uOn, uFault, uWarn, uLock, uGlow;
      uniform vec3 uCoal, uHot, uIdle, uRed; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        float d = texture2D(uDensity, vec2(clamp(vUv.x, 0.0, 1.0), 0.5)).r * 1.25;
        // 煤块：带面坐标（随带面移动）上的随机亮斑
        float u = vUv.x * uL - uTravel;
        vec2 cell = vec2(floor(u / 6.0), floor(vUv.y * 8.0));
        float r = hash(cell);
        float lump = step(0.5, r) * smoothstep(0.0, 0.6, d);
        // 管的上半圈亮、下半圈暗（煤在带面上堆着，光从上面看出来）
        float across = 0.55 + 0.45 * cos((vUv.y - 0.25) * 6.2832);
        float load = clamp(d, 0.0, 1.2);
        vec3 col = mix(uIdle, mix(uCoal, uHot, lump * 0.45), smoothstep(0.03, 0.35, load));
        float glow = (0.18 + uGlow * load * (0.75 + 0.25 * lump)) * across;
        col *= glow;
        col *= mix(0.35, 1.0, uOn);
        col = mix(col, uRed * (0.8 + 0.4 * sin(uTime * 6.0)), uFault * 0.7);
        // 起车预警：沿线黄色闪光（定稿令牌 l3）；闭锁：暗橙
        col = mix(col, vec3(1.6, 1.3, 0.25) * (0.5 + 0.5 * step(0.0, sin(uTime * 9.0))), uWarn * 0.75);
        col = mix(col, vec3(0.55, 0.28, 0.08), uLock * 0.6);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`
  })
  return { mat, tex, data }
}

function tunnelMaterial() {
  const t = THEME.tunnel
  return new THREE.ShaderMaterial({
    uniforms: {
      uRim: { value: new THREE.Color(t.rim) },
      uStrength: { value: t.rimStrength },
      uBase: { value: t.opacity }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uRim; uniform float uStrength, uBase; varying vec3 vN; varying vec3 vV;
      void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float rim = pow(f, 3.0);
        gl_FragColor = vec4(uRim * (uBase + rim * uStrength), 1.0);
        #include <colorspace_fragment>
      }`
  })
}

export class Belts {
  constructor(scene, layout) {
    this.group = new THREE.Group()
    scene.add(this.group)
    this.items = {}
    const tunnelMat = tunnelMaterial()
    for (const b of layout.belts) {
      const { mat, tex, data } = beltMaterial(b.id)
      // 地面栈桥 BC01 在定稿里是一根细桁架，不抢主斜井：管更细、更暗
      const ribbon = new THREE.Mesh(
        coalTubeGeometry(
          b.id,
          THEME.belt.radius * (b.id === "BC01" ? 0.55 : 1)
        ),
        mat
      )
      if (b.id === "BC01") mat.uniforms.uGlow.value *= 0.4
      ribbon.name = b.id
      ribbon.userData.pick = b.id
      this.group.add(ribbon)
      // 巷道：沿路径的管（地面栈桥 BC01 不画管，画桁架，见 props.js）
      let tunnel = null
      if (b.id !== "BC01") {
        const { pts } = beltPath(b.id)
        const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal", 0)
        const seg = Math.max(24, Math.round(beltPath(b.id).len / 30))
        tunnel = new THREE.Mesh(
          new THREE.TubeGeometry(curve, seg, THEME.tunnel.radius, 16, false),
          tunnelMat
        )
        tunnel.renderOrder = 5
        this.group.add(tunnel)
      }
      this.items[b.id] = {
        ribbon,
        mat,
        tex,
        data,
        tunnel,
        qFull: b.Q / (3.6 * b.v),
        v: 0, // 当前显示带速（向目标带速缓动）
        vTarget: 0,
        travel: 0
      }
    }
    // 沿线传感器光点：摄像机、环境监测、托辊温速
    const kinds = new Set(["camera", "env", "idlerSensor"])
    const devs = layout.devices.filter(
      (d) =>
        kinds.has(d.kind) && typeof d.chainage === "number" && BELTS[d.belt]
    )
    const geo = new THREE.SphereGeometry(5.5, 10, 8)
    const pointMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(TOKENS.data).multiplyScalar(2.2),
      toneMapped: false
    })
    this.sensors = new THREE.InstancedMesh(geo, pointMat, devs.length)
    const m = new THREE.Matrix4()
    devs.forEach((d, i) => {
      const { tan } = pathAt(d.belt, d.chainage / BELTS[d.belt].L)
      const p = chainageToPoint(d.belt, d.chainage)
      const side = sideOf(tan)
      // 摄像机、环境监测挂在巷道顶，托辊温速贴在带边
      const up = d.kind === "idlerSensor" ? 4 : 26
      p.addScaledVector(
        side,
        d.kind === "idlerSensor" ? (d.roll === "L" ? -14 : 14) : 0
      ).y += up
      m.makeTranslation(p.x, p.y, p.z)
      this.sensors.setMatrixAt(i, m)
    })
    this.sensors.userData.devices = devs.map((d) => d.id)
    this.group.add(this.sensors)
  }

  /** 每秒：沿线煤量 → 纹理；状态 → 明暗 */
  setState(sim, s, ms) {
    for (const [id, it] of Object.entries(this.items)) {
      const b = s.belts[id]
      const prof = sim.profile(id, ms, Math.max(5, BELTS[id].L / DENSITY_N))
      for (let i = 0; i < DENSITY_N; i++) {
        const k = Math.min(
          prof.length - 1,
          Math.floor((i / (DENSITY_N - 1)) * (prof.length - 1))
        )
        const v = Math.min(1, prof[k] / it.qFull / 1.25)
        it.data[i * 4] = Math.round(v * 255)
      }
      it.tex.needsUpdate = true
      it.vTarget = b.v
      it.mat.uniforms.uOn.value = b.v > 0.05 || b.state === 2 ? 1 : 0
      it.mat.uniforms.uFault.value = b.state === 6 ? 1 : 0
      it.mat.uniforms.uWarn.value = b.state === 1 || b.state === 2 ? 1 : 0
      it.mat.uniforms.uLock.value = b.state === 5 ? 1 : 0
    }
  }

  /** 每帧：带速向目标缓动（约 1 s 到位），带面位移按带速积分（光斑滚动） */
  tick(dt, t) {
    const k = 1 - Math.exp(-dt * 3)
    for (const it of Object.values(this.items)) {
      it.v += (it.vTarget - it.v) * k
      it.travel = (it.travel + it.v * dt) % 100000
      it.mat.uniforms.uTravel.value = it.travel
      it.mat.uniforms.uTime.value = t
    }
  }
}

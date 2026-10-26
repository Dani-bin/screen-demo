/*
 * 告警光柱、涟漪、劣化光晕
 * ----------------------------------------------------------
 * - 未结束的告警：在所在皮带的里程处立一根竖直光柱（底亮顶淡），底部两圈扩散涟漪；颜色按级别（一级红 … 四级蓝），
 *   一级告警光柱闪烁。平台预警（劣化，predictive）不立光柱，改画紫色光晕 + 声波圈（定稿里的紫色光圈）
 * - 没有皮带 / 里程的告警（如基站离线）不在三维里画光柱，由 DOM 标签表示
 */
import * as THREE from "three"
import { LEVEL_COLOR, TOKENS } from "./theme.js"
import { chainageToPoint, BELTS } from "./section.js"

const beamMat = (color) =>
  new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uBlink: { value: 0 }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uTime, uBlink; varying vec2 vUv;
      void main(){ float a = pow(1.0 - vUv.y, 1.6);
        // 定稿里的光柱是一条细亮线：窄亮芯 + 两侧很淡的光，避免底部整片辉光溢到岩块底
        float d = abs(vUv.x - 0.5) * 2.0;
        float core = exp(-d * d * 60.0);
        float halo = (1.0 - d) * 0.22;
        float blink = mix(1.0, 0.55 + 0.45*sin(uTime*7.0), uBlink);
        gl_FragColor = vec4(uColor * (a * (halo + 2.6*core)) * blink, 1.0);
        #include <colorspace_fragment>
      }`
  })

const ringMat = (color) =>
  new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(1.2),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false
  })

export class Beacons {
  constructor(scene) {
    this.group = new THREE.Group()
    scene.add(this.group)
    this.items = new Map() // 告警 id → { group, mats, rings, born }
    // 光柱：面宽 26（亮芯约 3）、高 380（定稿里 904 组的光柱是一条细亮线）
    this.beamGeo = new THREE.PlaneGeometry(26, 380, 1, 1).translate(0, 190, 0)
    this.ringGeo = new THREE.RingGeometry(0.86, 1, 48)
    this.dotGeo = new THREE.SphereGeometry(6, 12, 10)
  }

  /** 按当前未结束的告警增删光柱 */
  setAlarms(alarms) {
    const keep = new Set()
    for (const a of alarms) {
      if (!a.belt || a.chainage == null || !BELTS[a.belt]) continue
      keep.add(a.id)
      if (this.items.has(a.id)) continue
      const p = chainageToPoint(a.belt, a.chainage)
      const g = new THREE.Group()
      g.position.copy(p)
      const color = a.predictive
        ? TOKENS.predict
        : LEVEL_COLOR[a.level] || TOKENS.l3
      const mats = []
      // 光柱：突发告警都立；平台预警只有到二级（已派单）才立，颜色按级别（定稿里第 904 组那根光柱）
      const beamColor = LEVEL_COLOR[a.level] || TOKENS.l3
      // 光柱只给一 / 二级（含二级平台预警）；三 / 四级只在原地画涟漪，不抢一二级的视线
      const hasBeam = a.level <= 1
      if (hasBeam) {
        // 两片交叉的光柱面，从各个角度看都有体积感
        for (const ry of [0, Math.PI / 2]) {
          const m = beamMat(beamColor)
          m.uniforms.uBlink.value = a.level === 0 ? 1 : 0
          const beam = new THREE.Mesh(this.beamGeo, m)
          beam.rotation.y = ry
          g.add(beam)
          mats.push(m)
        }
      }
      const dot = new THREE.Mesh(
        this.dotGeo,
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(color).multiplyScalar(2.5),
          toneMapped: false
        })
      )
      g.add(dot)
      // 涟漪（光柱是水平圆环，光晕是朝向镜头的圆环）
      const rings = []
      // 涟漪只给有光柱的告警和平台预警；三 / 四级突发告警只留中心光点
      for (let i = 0; i < (hasBeam || a.predictive ? 2 : 0); i++) {
        const r = new THREE.Mesh(this.ringGeo, ringMat(color))
        if (!a.predictive) r.rotation.x = -Math.PI / 2
        r.userData.phase = i * 0.5
        r.userData.billboard = !!a.predictive
        g.add(r)
        rings.push(r)
      }
      this.group.add(g)
      this.items.set(a.id, {
        group: g,
        mats,
        rings,
        predictive: !!a.predictive,
        beam: hasBeam,
        sev: a.severity ?? 1
      })
    }
    for (const [id, it] of this.items)
      if (!keep.has(id)) {
        this.group.remove(it.group)
        it.group.traverse((o) => o.material?.dispose?.())
        this.items.delete(id)
      }
  }

  tick(t, camera) {
    for (const it of this.items.values()) {
      for (const m of it.mats) m.uniforms.uTime.value = t
      for (const r of it.rings) {
        const k = (t * 0.5 + r.userData.phase) % 1
        const s = it.predictive ? 14 + 46 * k : 24 + 110 * k
        r.scale.setScalar(s)
        r.material.opacity = (1 - k) * (it.predictive ? 0.9 : 0.7)
        if (r.userData.billboard) r.quaternion.copy(camera.quaternion)
      }
    }
  }

  /** 告警光柱顶部（没有光柱的平台预警取光晕上方）的三维位置，场景标签贴这里 */
  anchor(id) {
    const it = this.items.get(id)
    return it
      ? it.group.position
          .clone()
          .add(new THREE.Vector3(0, it.beam ? 380 : 40, 0))
      : null
  }
}

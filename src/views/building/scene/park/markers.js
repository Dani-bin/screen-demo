/*
 * 园区标注：楼栋标签、状态点、告警波纹、数据飞线、选中高亮
 * ----------------------------------------------------------
 * 对照设计稿 01-ai-park.png：
 *   - 楼栋上方悬浮圆形状态点 + 细竖线（绿色正常、红色告警）
 *   - 告警位置地面一圈圈扩散的红色波纹
 *   - 双子塔向各楼栋发出的细弧线，弧上有光点流动（数据汇聚到园区中枢）
 *   - 楼栋名称标签用 CSS2D（DOM），样式在页面组件里（.pk-label）
 */
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  QuadraticBezierCurve3,
  RingGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  TubeGeometry,
  Vector3
} from "three"
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js"

const STATUS_COLOR = { ok: "#3ddc97", info: "#37e4ff", alarm: "#ff3b47" }

/** 圆形状态点贴图：外圈光晕 + 实心圆 + 白色内点 */
function dotTexture(color) {
  const c = document.createElement("canvas")
  c.width = c.height = 128
  const g = c.getContext("2d")
  const grd = g.createRadialGradient(64, 64, 10, 64, 64, 62)
  grd.addColorStop(0, color)
  grd.addColorStop(0.45, color + "66")
  grd.addColorStop(1, color + "00")
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  g.beginPath()
  g.arc(64, 64, 22, 0, Math.PI * 2)
  g.lineWidth = 6
  g.strokeStyle = "#ffffff"
  g.stroke()
  g.beginPath()
  g.arc(64, 64, 10, 0, Math.PI * 2)
  g.fillStyle = "#ffffff"
  g.fill()
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

export class Markers {
  /**
   * @param {Object} opts
   * @param {Map<string, {box: import("three").Box3, info: Object}>} opts.buildings 楼栋 key → 包围盒与数据
   * @param {Object<string, "ok"|"info"|"alarm">} opts.status 楼栋状态
   * @param {Function} opts.onLabelClick (key) 点击标签
   */
  constructor({ buildings, status, onLabelClick }) {
    this.group = new Group()
    this.labels = new Map()
    this.time = 0
    this.textures = Object.fromEntries(
      Object.entries(STATUS_COLOR).map(([k, c]) => [k, dotTexture(c)])
    )
    // 飞线起点：第一栋塔楼的中心（两塔紧挨着，取一栋即可）
    const towerTop = new Vector3()
    for (const b of buildings.values()) {
      if (b.info.kind === "tower") {
        b.box.getCenter(towerTop)
        break
      }
    }
    this.flyMats = []
    this.ripples = []
    for (const [key, b] of buildings) {
      const center = b.box.getCenter(new Vector3())
      const top = b.box.max.y
      const st = status[key] || "ok"
      // 标签：塔楼标在塔顶，其他楼栋标在状态点上方
      const el = document.createElement("div")
      el.className = `pk-label ${b.info.kind === "tower" ? "gold" : ""} ${st === "alarm" ? "alarm" : ""}`
      el.innerHTML = `<div class="pk-label-box">${b.info.short}${
        b.info.kind === "tower"
          ? `<small>${b.info.height}m · ${b.info.levels}F</small>`
          : `<small>${b.info.levels}F</small>`
      }</div><div class="pk-label-stem"></div>`
      el.addEventListener("click", () => onLabelClick?.(key))
      const label = new CSS2DObject(el)
      // 双子塔两栋紧挨着，标签向两侧错开：南塔往左、北塔往右（从东南偏东看过去北塔在右）
      const ax = key === "tower_S" ? 0.92 : key === "tower_N" ? 0.08 : 0.5
      label.center.set(ax, 1)
      if (ax !== 0.5) el.classList.add(ax > 0.5 ? "to-left" : "to-right")
      label.position.set(
        center.x,
        top + (b.info.kind === "tower" ? 6 : 30),
        center.z
      )
      this.group.add(label)
      this.labels.set(key, el)

      if (b.info.kind === "tower") continue
      // 状态点 + 竖线
      const dot = new Sprite(
        new SpriteMaterial({
          map: this.textures[st],
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending
        })
      )
      dot.scale.set(18, 18, 1)
      dot.position.set(center.x, top + 16, center.z)
      dot.renderOrder = 20
      this.group.add(dot)
      const lineGeo = new BufferGeometry()
      lineGeo.setAttribute(
        "position",
        new Float32BufferAttribute(
          [center.x, top + 1, center.z, center.x, top + 10, center.z],
          3
        )
      )
      this.group.add(
        new Line(
          lineGeo,
          new LineBasicMaterial({
            color: STATUS_COLOR[st],
            transparent: true,
            opacity: 0.8
          })
        )
      )
      if (st === "alarm") this.ripples.push(this._ripple(center.x, center.z))
      // 飞线：塔楼中部 → 楼顶
      this._flyLine(
        new Vector3(towerTop.x, towerTop.y * 1.1, towerTop.z),
        new Vector3(center.x, top + 2, center.z),
        st === "alarm" ? 0xff5a64 : 0x5fd9ff
      )
    }
  }

  /** 地面红色告警波纹：三圈错相扩散 */
  _ripple(x, z) {
    const rings = []
    for (let k = 0; k < 3; k++) {
      const m = new Mesh(
        new RingGeometry(0.9, 1, 64),
        new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
          blending: AdditiveBlending,
          uniforms: {
            uColor: { value: new Color(0xff3b47) },
            uAlpha: { value: 1 }
          },
          vertexShader: `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
          fragmentShader: `uniform vec3 uColor; uniform float uAlpha; void main(){ gl_FragColor = vec4(uColor * 2.0, uAlpha); }`
        })
      )
      m.rotation.x = -Math.PI / 2
      m.position.set(x, 0.4, z)
      m.userData.phase = k / 3
      this.group.add(m)
      rings.push(m)
    }
    return rings
  }

  /** 弧形飞线：细管 + 沿弧长流动的亮段 */
  _flyLine(a, b, color) {
    const mid = a.clone().add(b).multiplyScalar(0.5)
    mid.y = Math.max(a.y, b.y) + a.distanceTo(b) * 0.18
    const geo = new TubeGeometry(
      new QuadraticBezierCurve3(a, mid, b),
      48,
      0.5,
      4,
      false
    )
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: FrontSide,
      uniforms: {
        uColor: { value: new Color(color) },
        uTime: { value: Math.random() }
      },
      vertexShader: /* glsl */ `
        varying float vU;
        void main() {
          vU = uv.x;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uTime;
        varying float vU;
        void main() {
          // 底线淡淡一层，外加一段沿弧长从塔楼流向楼栋的亮段
          float head = fract(uTime * 0.35);
          float d = vU - head;
          float pulse = smoothstep(-0.18, 0.0, d) * (1.0 - smoothstep(0.0, 0.015, d));
          gl_FragColor = vec4(uColor * (0.5 + pulse * 2.0), 0.08 + pulse * 0.7);
        }`
    })
    this.flyMats.push(mat)
    const mesh = new Mesh(geo, mat)
    mesh.renderOrder = 15
    this.group.add(mesh)
  }

  update(dt) {
    this.time += dt
    for (const m of this.flyMats) m.uniforms.uTime.value += dt
    for (const rings of this.ripples) {
      for (const r of rings) {
        const t = (this.time * 0.45 + r.userData.phase) % 1
        const s = 6 + t * 46
        r.scale.set(s, s, s)
        r.material.uniforms.uAlpha.value = (1 - t) * 0.9
      }
    }
  }

  /** 标签激活态（悬浮 / 选中） */
  setActive(key, on) {
    this.labels.get(key)?.classList.toggle("active", on)
  }

  dispose() {
    this.group.traverse((o) => {
      o.geometry?.dispose()
      o.material?.dispose()
      o.element?.remove()
    })
    Object.values(this.textures).forEach((t) => t.dispose())
  }
}

/**
 * 选中高亮外壳：楼体几何的副本，边缘（菲涅尔）发光、正面几乎透明，叠在原楼体上。
 * 楼体材质被多栋楼共享，改材质会全部一起亮，所以用外壳而不是改原材质。
 */
export function createHighlightShell(object, color) {
  const group = new Group()
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uColor: { value: new Color(color) }, uStrength: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float rim = pow(1.0 - abs(dot(vN, vV)), 2.2);
        gl_FragColor = vec4(uColor * 2.2, (0.12 + rim * 0.88) * uStrength);
      }`
  })
  object.updateWorldMatrix(true, true)
  object.traverse((o) => {
    if (!o.isMesh) return
    const m = new Mesh(o.geometry, mat)
    m.matrixAutoUpdate = false
    m.matrix.copy(o.matrixWorld)
    m.renderOrder = 12
    group.add(m)
  })
  group.userData.material = mat
  return group
}

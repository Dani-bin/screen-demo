/*
 * 园内地灯：沿园内步道 / 服务道路（data/parkData.js 的 PARK_PATHS）每隔一段放一个暖色光点
 * ----------------------------------------------------------
 * 设计稿的园区里撒满暖色小灯。灯柱模型与地面光斑在 Blender 里（site.path_lights + 烘焙），这里只补灯头的小光晕与呼吸闪烁；
 * 一个 Points 对象一次绘制，每个点相位不同，不会显得死板。
 */
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Points,
  ShaderMaterial
} from "three"

const STEP = 13 // 灯距（米）
const Y = 1.0 // 灯头高度（与 Blender 地灯灯柱一致）

export function createPathLights(paths) {
  const pos = []
  const phase = []
  for (const pts of paths) {
    let carry = STEP / 2
    for (let i = 1; i < pts.length; i++) {
      const [x0, z0] = pts[i - 1]
      const [x1, z1] = pts[i]
      const len = Math.hypot(x1 - x0, z1 - z0)
      let t = carry
      while (t <= len) {
        pos.push(x0 + ((x1 - x0) * t) / len, Y, z0 + ((z1 - z0) * t) / len)
        phase.push(Math.random() * Math.PI * 2)
        t += STEP
      }
      carry = t - len
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute("position", new Float32BufferAttribute(pos, 3))
  geo.setAttribute("aPhase", new Float32BufferAttribute(phase, 1))
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new Color(0xffc97a) },
      // 点的世界尺寸（米）→ 像素：size * 投影缩放 / 距离
      uSize: { value: 4.0 },
      uScale: { value: 500 }
    },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      uniform float uTime;
      uniform float uSize;
      uniform float uScale;
      varying float vGlow;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * uScale / -mv.z;
        vGlow = 0.75 + 0.25 * sin(uTime * 1.6 + aPhase);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vGlow;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        // 小而亮的灯芯 + 一圈柔和光晕
        float core = 1.0 - smoothstep(0.0, 0.18, d);
        float halo = pow(1.0 - smoothstep(0.0, 1.0, d), 2.0) * 0.22;
        gl_FragColor = vec4(uColor * (core * 1.6 + halo) * vGlow, core + halo);
      }`
  })
  const points = new Points(geo, mat)
  points.renderOrder = 5
  points.frustumCulled = false
  return points
}

/*
 * /estate 镜头通道与展厅背景（从 EstateScene.js 抽出，实时版和还原版共用）
 * ----------------------------------------------------------
 * Lens：真景深（读深度图）+ 画面上下端移轴 + 暗角 + 暖色分色调色 + 胶片颗粒，线性空间里做，色调映射由后面的 OutputPass 统一做一次。
 * backdropTexture：展厅背景（暖黑渐变 + 虚化的灯光光斑）。
 */
import * as THREE from "three"

/**
 * 镜头通道（只做一个通道）：
 *   - 真景深：用 GTAO 渲染的深度图，离对焦面越远越糊（沙盘近端、远端虚化，像微距实拍）
 *   - 少量移轴：画面上下两端再糊一点
 *   - 暗角、对比度和暖色调色、胶片颗粒
 * 在线性空间里做，色调映射仍由后面的 OutputPass 统一做一次。
 */
export const Lens = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    focus: { value: 740 }, // 对焦距离（相机到视线目标）
    near: { value: 40 },
    far: { value: 3200 },
    aperture: { value: 4.5 }, // 景深强度：越大，离对焦面稍远就越糊
    maxBlur: { value: 10 }, // 最大模糊半径（像素）
    tiltBand: { value: 0.3 },
    tiltStart: { value: 0.12 }, // 移轴从画面上缘这么远（相对画面中线的比例）开始虚化；越大，清晰区越大
    tiltAmount: { value: 6.0 }, // 移轴：画面上下两端的额外模糊半径（像素）
    contrast: { value: 1.1 },
    vignette: { value: 0.5 }, // 暗角：画面四角压到这个亮度（越小越暗）
    warm: { value: new THREE.Vector3(1.06, 1.0, 0.9) },
    grain: { value: 0.03 },
    time: { value: 0 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 resolution;
    uniform float focus, near, far, aperture, maxBlur, tiltBand, tiltStart, tiltAmount, contrast, grain, time, vignette;
    uniform vec3 warm;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      float d = texture2D(tDepth, vUv).x;
      float z = d * 2.0 - 1.0;
      float dist = 2.0 * near * far / (far + near - z * (far - near));
      // 背景（深度 = 1）不参与景深
      // 远端虚化为主，近端只轻微虚化（定稿里前景河岸和小径是清晰的）
      float far = max(dist - focus, 0.0) / focus;
      float nearD = max(focus - dist, 0.0) / focus;
      // 对焦面前后各留 20 % 距离的清晰带（楼是主角，不能糊），再往外才虚化
      float coc = d > 0.9999 ? 0.0 : clamp(aperture * (max(far - 0.2, 0.0) + 0.3 * max(nearD - 0.2, 0.0)), 0.0, 1.0) * maxBlur;
      // 移轴：焦平面在中景，画面上下两端各虚化几个像素（像微距实拍的沙盘）
      float ty = vUv.y - 0.5;
      coc += (smoothstep(tiltStart, 0.5, ty) + smoothstep(0.2, 0.5, -ty)) * tiltAmount;
      coc = min(coc, maxBlur * 1.5);
      vec3 sum = texture2D(tDiffuse, vUv).rgb;
      float w = 1.0;
      if (coc > 0.4) {
        for (int i = 0; i < 12; i++) {
          float a = float(i) * 2.399963;
          float rr = sqrt((float(i) + 0.5) / 12.0) * coc;
          sum += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * rr / resolution).rgb;
          w += 1.0;
        }
      }
      vec3 c = sum / w;
      // 边缘平滑：亮度梯度大的地方，沿梯度的垂直方向混合邻点（代替 MSAA）
      if (coc <= 0.4) {
        vec2 px = 1.0 / resolution;
        vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, -px.y)).rgb;
        vec3 sN = texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb;
        vec3 e = texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb;
        vec3 wv = texture2D(tDiffuse, vUv + vec2(-px.x, 0.0)).rgb;
        float lc = dot(c, vec3(0.299, 0.587, 0.114));
        float ln = dot(n, vec3(0.299, 0.587, 0.114));
        float ls = dot(sN, vec3(0.299, 0.587, 0.114));
        float le = dot(e, vec3(0.299, 0.587, 0.114));
        float lw = dot(wv, vec3(0.299, 0.587, 0.114));
        float edge = clamp((abs(ln - ls) + abs(le - lw)) * 2.2, 0.0, 1.0);
        c = mix(c, (c * 2.0 + n + sN + e + wv) / 6.0, edge * 0.85);
      }
      // 暗角
      float vg = 1.0 - smoothstep(0.42, 1.08, length((vUv - 0.5) * vec2(1.3, 1.0)));
      c *= mix(vignette, 1.0, vg);
      // 对比度（绕中灰）；分色调色：暗部偏冷蓝，高光偏暖黄（定稿是冷蓝暗部 + 暖色高光）
      c = max((c - 0.16) * contrast + 0.16, 0.0);
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      vec3 shadowTint = vec3(0.9, 0.97, 1.12);
      c *= mix(shadowTint, warm, smoothstep(0.02, 0.32, lum));
      // 胶片颗粒
      c += (hash(vUv * resolution + time) - 0.5) * grain;
      gl_FragColor = vec4(c, 1.0);
    }
  `
}

/** 展厅背景：暖黑渐变 + 几团虚化的灯光（光斑），整张贴在 scene.background 上 */
export function backdropTexture() {
  const c = document.createElement("canvas")
  c.width = 1920
  c.height = 1080
  const g = c.getContext("2d")
  const bg = g.createRadialGradient(960, 600, 80, 960, 540, 1400)
  bg.addColorStop(0, "#6a4a2c")
  bg.addColorStop(0.45, "#3a2818")
  bg.addColorStop(1, "#170f09")
  g.fillStyle = bg
  g.fillRect(0, 0, 1920, 1080)
  // 光斑：集中在画面上半部，像展厅里远处的筒灯和灯带
  let s = 5
  const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
  // 竖向的玻璃柱 / 灯箱：几条宽而柔的亮带，像展厅里远处的立柱
  for (const x of [90, 330, 620, 1290, 1580, 1830]) {
    const w = 60 + ((x * 7) % 70)
    const gr = g.createLinearGradient(x - w, 0, x + w, 0)
    gr.addColorStop(0, "rgba(255,190,120,0)")
    gr.addColorStop(0.5, "rgba(255,190,120,0.1)")
    gr.addColorStop(1, "rgba(255,190,120,0)")
    g.fillStyle = gr
    g.fillRect(x - w, 0, w * 2, 640)
  }
  for (let i = 0; i < 40; i++) {
    const x = r() * 1920
    const y = r() * 520
    const rad = 24 + r() * 110
    const a = 0.06 + r() * 0.2
    const gr = g.createRadialGradient(x, y, 0, x, y, rad)
    gr.addColorStop(0, `rgba(255,196,120,${a})`)
    gr.addColorStop(1, "rgba(255,196,120,0)")
    g.fillStyle = gr
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
  }
  // 左右两条竖向的灯带
  for (const x of [150, 1780]) {
    const gr = g.createLinearGradient(x - 40, 0, x + 40, 0)
    gr.addColorStop(0, "rgba(255,190,110,0)")
    gr.addColorStop(0.5, "rgba(255,190,110,0.12)")
    gr.addColorStop(1, "rgba(255,190,110,0)")
    g.fillStyle = gr
    g.fillRect(x - 40, 0, 80, 520)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

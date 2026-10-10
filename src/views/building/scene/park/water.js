/*
 * 园区水面：OSM 小水池 + 生成的景观湖（data/parkData.js 的 PARK_WATERS）
 * ----------------------------------------------------------
 * 烘焙地面里的水面只是一块深色（烘焙存不下随视角变化的反射），这里在上面叠一层实时水面：
 *   - 天蓝底色（设计稿里被池底灯照亮的水），越斜着看越亮（菲涅尔），叠两层缓慢流动的波纹明暗与水底焦散光纹
 *   - 灯边的水被照成更亮的蓝，焦散在亮处更明显
 *   - 灯影：湖边庭院灯、路灯、塔楼在水里的倒影。按镜面反射算出倒影在水面上的位置，
 *     沿视线方向拉成一条光带（水面起伏把点光源的倒影拉长），再被波纹切成一段段、随时间晃动
 *   - 湖岸一圈细的青蓝亮边（设计稿水池边缘那圈亮边）+ 岸边暖色柔光
 *   - 随机散布、各自明灭的细碎波光
 * 湖面网格自己三角化：外圈 = 湖岸（aEdge = 1），内缩一圈（aEdge = 0）后扇形收到中心，aEdge 插值出由岸向内的渐变。
 */
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Vector4
} from "three"

const Y = 0.22 // 水面高度：略高于烘焙地面里的水面（Blender Z_WATER 0.12、车道线 0.14）
const INNER = 0.78 // 内圈相对湖心的缩放：岸边渐变带的宽度
const MAX_LIGHTS = 16 // 每片水面最多映出的光源数（取离湖心最近的）
const REACH = 22 // 光源离湖岸多远以内会映进水里（米）

/** 一片水面的网格（ring 为 three 坐标 [x, z]，湖形是星形，可按湖心缩放） */
function lakeGeometry(ring) {
  const n = ring.length
  const cx = ring.reduce((s, p) => s + p[0], 0) / n
  const cz = ring.reduce((s, p) => s + p[1], 0) / n
  const pos = [cx, Y, cz]
  const edge = [0]
  for (const [x, z] of ring) {
    pos.push(x, Y, z)
    edge.push(1)
  }
  for (const [x, z] of ring) {
    pos.push(cx + (x - cx) * INNER, Y, cz + (z - cz) * INNER)
    edge.push(0)
  }
  const idx = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const o0 = 1 + i
    const o1 = 1 + j
    const i0 = 1 + n + i
    const i1 = 1 + n + j
    // 外圈与内圈之间的环带 + 内圈到湖心的扇形（材质双面，不用管绕向）
    idx.push(o0, o1, i1, o0, i1, i0, 0, i0, i1)
  }
  const geo = new BufferGeometry()
  geo.setAttribute("position", new Float32BufferAttribute(pos, 3))
  geo.setAttribute("aEdge", new Float32BufferAttribute(edge, 1))
  geo.setIndex(idx)
  return geo
}

const vertexShader = /* glsl */ `
  attribute float aEdge;
  varying float vEdge;
  varying vec3 vWorld;
  void main() {
    vEdge = aEdge;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`

const fragmentShader = /* glsl */ `
  #define MAX_LIGHTS ${MAX_LIGHTS}
  uniform float uTime;
  uniform float uWaterY;
  // 光源：xyz 为世界坐标，w 为倒影光带的半宽（米）；颜色 rgb × 强度
  uniform vec4 uLights[MAX_LIGHTS];
  uniform vec3 uLightColors[MAX_LIGHTS];
  uniform int uLightCount;
  varying float vEdge;
  varying vec3 vWorld;
  float hash(vec2 c) {
    return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453);
  }
  // 焦散：可平铺的水底光纹（Shadertoy「Tileable Water Caustic」的做法），返回 0..1，亮处是细碎的网状光线
  float caustic(vec2 uv, float t) {
    vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
    vec2 i = p;
    float c = 1.0;
    float inten = 0.005;
    for (int n = 0; n < 4; n++) {
      float tt = t * (1.0 - 3.5 / float(n + 1));
      i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
      c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
    }
    c /= 4.0;
    c = 1.17 - pow(c, 1.4);
    return clamp(pow(abs(c), 8.0), 0.0, 1.0);
  }
  void main() {
    vec3 view = normalize(cameraPosition - vWorld);
    vec2 p = vWorld.xz;
    // 波纹：两组不同方向、不同速度的长波叠加，调制天空反射的明暗（水面在缓慢起伏）
    float wave = sin(p.x * 0.31 + p.y * 0.12 + uTime * 0.55) * 0.6
      + sin(p.y * 0.47 - p.x * 0.21 - uTime * 0.8) * 0.4;
    // 菲涅尔：视线越贴水面，反射的夜空越亮；湖心偏深，靠岸略亮
    float fres = pow(1.0 - clamp(view.y, 0.0, 1.0), 2.5);
    // 底色：设计稿的湖是被池底灯照亮的天蓝色（不是黑水），湖心略深、靠岸与斜视处更亮
    vec3 col = mix(vec3(0.006, 0.045, 0.12), vec3(0.025, 0.15, 0.32), clamp((0.2 + 0.7 * fres + 0.35 * vEdge) * (0.88 + 0.16 * wave), 0.0, 1.0));
    // 水底焦散光纹：两层不同尺度、不同速度叠加，靠岸更明显（浅水）
    float ca = caustic(p / 15.0, uTime * 0.35) * 0.6 + caustic(p / 7.0 + 3.1, uTime * 0.5) * 0.4;
    col += vec3(0.12, 0.42, 0.62) * ca * (0.14 + 0.3 * vEdge);

    // 灯影：光源 L 关于水面的镜像点 R，视线 C→R 与水面的交点 P 就是倒影中心；
    // 光带沿「P → 相机」方向拉长（靠相机一侧更长），横向很窄；波纹把光带切成一段段并随时间晃动
    vec3 refl = vec3(0.0);
    float lit_sum = 0.0; // 各灯照亮水体的累计强度（岸边灯多，要封顶，否则整片湖发白）
    for (int i = 0; i < MAX_LIGHTS; i++) {
      if (i >= uLightCount) break;
      vec4 L = uLights[i];
      vec3 R = vec3(L.x, 2.0 * uWaterY - L.y, L.z);
      float t = (cameraPosition.y - uWaterY) / (cameraPosition.y - R.y);
      vec2 P = mix(cameraPosition.xz, R.xz, t);
      vec2 toCam = normalize(cameraPosition.xz - P);
      vec2 d = p - P;
      float along = dot(d, toCam);
      float across = dot(d, vec2(-toCam.y, toCam.x));
      // 横向随波纹轻轻摆动
      across += sin(along * 1.3 + uTime * 1.7 + float(i) * 2.1) * L.w * 0.35;
      float len = (along > 0.0 ? 16.0 : 4.0) * (0.6 + L.w * 0.4);
      float g = exp(-along * along / (len * len) - across * across / (L.w * L.w));
      float dash = 0.45 + 0.55 * smoothstep(-0.3, 0.6, sin(along * 1.9 - uTime * 2.4 + float(i) * 1.7));
      // 倒影中心偏白（点光源的倒影过曝），边缘保留灯色
      refl += mix(uLightColors[i], vec3(length(uLightColors[i]) * 0.75), g) * g * dash * 2.2;
      // 灯光照亮近处的水：灯下一圈暖色柔光 + 更大范围把水体照成亮蓝（设计稿灯边的水明显更亮），焦散在亮处更显
      float r = length(p - L.xz);
      float near = exp(-r * r / (36.0 * L.w * L.w + 16.0));
      float lit = exp(-r * r / (400.0 * L.w * L.w + 120.0));
      refl += uLightColors[i] * near * 0.3;
      lit_sum += lit * length(uLightColors[i]);
    }
    col += refl;
    float litK = 1.0 - exp(-lit_sum * 0.6);
    col += vec3(0.015, 0.1, 0.2) * litK * (0.5 + 1.6 * ca);

    // 岸边：一圈细的青蓝亮边 + 暖色柔光（岸边庭院灯照亮的浅水）
    col += vec3(0.08, 0.42, 0.58) * pow(vEdge, 10.0) * 0.8;
    col += vec3(0.55, 0.32, 0.12) * pow(vEdge, 4.0) * 0.22;
    // 波光：2.5 m 一格随机挑少数格子放一个光点，各自按随机相位明灭（规则正弦会排成一眼看出的网格）
    vec2 q = p / 2.5;
    vec2 cell = floor(q);
    float h = hash(cell);
    vec2 jitter = vec2(hash(cell + 7.1), hash(cell + 3.7)) - 0.5;
    float dd = length(fract(q) - 0.5 - jitter * 0.6);
    float twinkle = 0.5 + 0.5 * sin(uTime * 1.6 + h * 40.0);
    float glint = step(0.88, h) * smoothstep(0.16, 0.0, dd) * twinkle * (0.35 + 0.65 * vEdge);
    col += mix(vec3(0.6, 0.7, 0.85), vec3(1.0, 0.75, 0.45), step(0.95, h)) * glint * 0.9;
    gl_FragColor = vec4(col, 0.96);
  }`

/**
 * 所有水面合成一个 Group；返回 { group, update(dt) }（网格与材质随场景一起在 ParkScene.dispose 里释放）
 * @param {Array} waters PARK_WATERS：每片水面的轮廓 [[x, z], …]
 * @param {Array} lights 可能映进水里的光源 [{ position: Vector3, width, color: Color }]（ParkScene 从灯具 / 楼体收集）
 */
export function createWater(waters, lights = []) {
  const group = new Group()
  const materials = []
  for (const ring of waters) {
    // 每片水面一个材质：只放离它最近的若干光源，片元着色器里的循环才短
    const n = ring.length
    const cx = ring.reduce((s, p) => s + p[0], 0) / n
    const cz = ring.reduce((s, p) => s + p[1], 0) / n
    const radius = Math.max(...ring.map(([x, z]) => Math.hypot(x - cx, z - cz)))
    const near = lights
      .map((l) => ({ l, d: Math.hypot(l.position.x - cx, l.position.z - cz) }))
      .filter((o) => o.d < radius + REACH)
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_LIGHTS)
    const pos = Array.from(
      { length: MAX_LIGHTS },
      () => new Vector4(0, -1e4, 0, 1)
    )
    const cols = Array.from({ length: MAX_LIGHTS }, () => new Color(0, 0, 0))
    near.forEach(({ l }, i) => {
      pos[i].set(l.position.x, l.position.y, l.position.z, l.width)
      cols[i].copy(l.color)
    })
    const mat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uWaterY: { value: Y },
        uLights: { value: pos },
        uLightColors: { value: cols },
        uLightCount: { value: near.length }
      },
      vertexShader,
      fragmentShader,
      // 普通混合、略透明：烘焙水面上的灯光倒影能隐约透出来；不用加法混合，否则整片湖面发灰
      transparent: true,
      blending: NormalBlending,
      depthWrite: false,
      side: DoubleSide
    })
    materials.push(mat)
    const mesh = new Mesh(lakeGeometry(ring), mat)
    mesh.renderOrder = 1
    group.add(mesh)
  }
  return {
    group,
    update(dt) {
      for (const m of materials) m.uniforms.uTime.value += dt
    }
  }
}

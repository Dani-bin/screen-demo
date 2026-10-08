/*
 * 楼宇级 · 发光件着色器
 * ----------------------------------------------------------
 * 塔楼本体是写实构件（玻璃、楼板、家具，见 floorKit.js），这里只剩几样「光」：
 *   核心筒电梯井光柱（轿厢光点上下跑）、机电立管流动光、抽出楼层的金色玻璃围合。
 * 都是加法混合的 ShaderMaterial，模式切换只改 uniform。
 */
import { AdditiveBlending, DoubleSide, ShaderMaterial } from "three"

/**
 * 核心筒：一道青色光柱，前后两面各 6 条电梯井（竖向亮带），轿厢光点在井道里往返；
 * 用模型局部坐标 vLocal 算井道（盒子尺寸 uSize）
 */
export function coreMaterial(size, yRange) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: {
      uSize: { value: size },
      uY0: { value: yRange[0] },
      uY1: { value: yRange[1] },
      uCore: { value: 1 },
      uTime: { value: 0 }
    },
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vNl;
      void main() {
        vLocal = position;
        vNl = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSize;
      uniform float uY0, uY1, uCore, uTime;
      varying vec3 vLocal;
      varying vec3 vNl;
      float hash11(float p) { return fract(sin(p * 91.7) * 43758.5453); }
      void main() {
        // 前后面沿 x 排井道，两个侧面沿 z
        bool front = abs(vNl.z) > 0.5;
        float span = front ? uSize.x : uSize.z;
        float t = ((front ? vLocal.x : vLocal.z) / span + 0.5) * 6.0;
        float shaft = floor(t);
        float inShaft = 1.0 - smoothstep(0.32, 0.46, abs(fract(t) - 0.5));
        float y = vLocal.y + uSize.y * 0.5;
        float hgt = uSize.y;
        // 轿厢：每条井道一个光点，速度、相位不同，到顶折返
        float id = shaft + (front ? (vNl.z > 0.0 ? 0.0 : 6.0) : (vNl.x > 0.0 ? 12.0 : 18.0));
        float ph = fract(uTime * (0.02 + 0.03 * hash11(id)) + hash11(id + 3.1));
        float yb = abs(ph * 2.0 - 1.0) * hgt;
        float car = exp(-pow((y - yb) / 1.6, 2.0)) * inShaft;
        float base = 0.06 + 0.32 * inShaft;
        // 顶部、底部渐隐
        float fade = smoothstep(0.0, 14.0, y) * (1.0 - smoothstep(hgt - 10.0, hgt, y));
        vec3 col = vec3(0.08, 0.62, 1.0) * base + vec3(0.45, 0.9, 1.0) * car * 0.9;
        gl_FragColor = vec4(col * fade * uCore, 1.0);
      }`
  })
}

/** 机电立管：沿管子向上流动的亮段（颜色区分水 / 电 / 风 / 消防），uAmt 控制显隐 */
export function riserMaterial(color, speed) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uColor: { value: color },
      uSpeed: { value: speed },
      uAmt: { value: 0 },
      uTime: { value: 0 }
    },
    vertexShader: /* glsl */ `
      varying float vY;
      void main() {
        vY = (modelMatrix * vec4(position, 1.0)).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uSpeed, uAmt, uTime;
      varying float vY;
      void main() {
        float dash = smoothstep(0.55, 1.0, fract(vY * 0.08 - uTime * uSpeed));
        gl_FragColor = vec4(uColor * (0.35 + 1.4 * dash) * uAmt, 1.0);
      }`
  })
}

/** 抽出楼层的金色玻璃围合（只有侧面）：菲涅尔 + 竖梃，略带呼吸 */
export function drawerGlassMaterial() {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uAmt: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uAmt;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        float fres = pow(1.0 - abs(dot(normalize(vN), vView)), 2.0);
        float mu = abs(fract(vUv.x / 3.2 + 0.5) - 0.5) * 3.2;
        float mull = 1.0 - smoothstep(0.05, 0.15, mu);
        vec3 gold = vec3(1.0, 0.72, 0.25);
        vec3 col = gold * (0.12 + fres * 0.5 + mull * 0.5) * (0.9 + 0.1 * sin(uTime * 3.0));
        gl_FragColor = vec4(col * uAmt, 1.0);
      }`
  })
}

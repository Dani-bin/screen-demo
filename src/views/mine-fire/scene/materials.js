/*
 * 着色器材质：玻璃走廊 / 玻璃房（棱边发光 + 菲涅尔）、煤层顶面（岩纹 + 坐标网）、煤层侧面（岩层条带）、虚线发光带
 * 颜色传进来的是 sRGB 色值，这里统一转成线性空间再进着色器（输出阶段做一次色调映射）。
 */
import * as THREE from "three"

const lin = (hex) => new THREE.Color(hex)

/**
 * 火点（全局共享）：xyz = 火点位置，w = 强度 0–1。煤层顶面和所有玻璃材质共用同一个对象，
 * 起火时附近的煤层、走廊、硐室一起被映成橙红（MineFireScene.setState 里写）
 */
export const fireUniform = { value: new THREE.Vector4(0, 0, 0, 0) }

// 值噪声 + 分形，用来画岩石纹理
const NOISE = /* glsl */ `
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return v;
  }
`

/**
 * 玻璃材质：沿线走廊（mode 0，uv.y 横向、face 属性区分顶 / 侧 / 端）或盒子（mode 1，BoxGeometry 自带 uv）
 * 棱边亮、面中间淡、掠射角更亮；uIntensity 控制整体亮度（状态切换时调）
 */
export function glassMaterial({
  color = "#2bd9fe",
  opacity = 0.16,
  edge = 1.5,
  ribs = 90,
  box = false
} = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: lin(color) },
      uOpacity: { value: opacity },
      uEdge: { value: edge },
      uRibs: { value: ribs },
      uIntensity: { value: 1 },
      uTime: { value: 0 },
      uFire: fireUniform
    },
    defines: box ? { BOX: 1 } : {},
    vertexShader: /* glsl */ `
      attribute float face;
      varying vec2 vUv; varying float vFace; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        vUv = uv;
        #ifdef BOX
          vFace = 3.0;
        #else
          vFace = face;
        #endif
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity, uEdge, uRibs, uIntensity, uTime; uniform vec4 uFire;
      varying vec2 vUv; varying float vFace; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        float e;
        if (vFace > 2.5) {
          // 盒子：每个面四条边都发光
          vec2 d = min(vUv, 1.0 - vUv);
          e = smoothstep(0.035, 0.0, min(d.x, d.y));
        } else if (vFace > 1.5) {
          // 走廊端盖：只要淡淡的边，否则远端一排白点
          vec2 d = min(vUv, 1.0 - vUv);
          e = smoothstep(0.08, 0.0, min(d.x, d.y)) * 0.3;
        } else {
          // 走廊长面：横向两条棱
          e = smoothstep(0.09, 0.0, min(vUv.y, 1.0 - vUv.y));
        }
        // 走廊上每隔 uRibs 米一道环（玻璃管的分段）
        float rib = vFace < 1.5 ? smoothstep(2.2, 0.0, abs(mod(vUv.x, uRibs) - uRibs * 0.5) - uRibs * 0.5 + 2.2) : 0.0;
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        // 火光映色：离火点越近，玻璃越偏橙红
        float fk = uFire.w * exp(-length(vW.xz - uFire.xz) / 200.0);
        vec3 base = mix(uColor, vec3(1.0, 0.32, 0.1), clamp(fk * 1.4, 0.0, 0.85));
        vec3 col = base * (0.35 + 0.8 * fres) + base * e * uEdge + base * rib * 0.45;
        float a = uOpacity * (0.55 + 1.2 * fres) + e * 0.7 + rib * 0.18;
        gl_FragColor = vec4(col * uIntensity, clamp(a, 0.0, 1.0));
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  })
}

/** 煤层顶面：暗色岩纹 + 500 m 坐标网（同 CAD）+ 远处渐暗 */
export function seamTopMaterial(c) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uRock: { value: lin(c.rock) },
      uHi: { value: lin(c.rockHi) },
      uGrid: { value: lin(c.brand) },
      uFire: fireUniform
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uRock, uHi, uGrid; uniform vec4 uFire;
      varying vec3 vW;
      ${NOISE}
      void main(){
        vec2 p = vW.xz;
        // 煤岩：大块起伏（明暗斑）+ 中尺度岩纹 + 细颗粒，再撒少量亮点（煤的反光）
        float n = fbm(p / 520.0);
        float n2 = fbm(p / 90.0 + 3.0);
        float n3 = vnoise(p / 9.0);
        float ridge = 1.0 - abs(fbm(p / 160.0 + 7.0) * 2.0 - 1.0);
        float k = smoothstep(0.3, 0.8, n) * 0.6 + n2 * 0.35 + ridge * 0.25 + (n3 - 0.5) * 0.35;
        vec3 col = mix(uRock * 0.7, uHi, clamp(k, 0.0, 1.2));
        col += vec3(0.5, 0.55, 0.6) * step(0.985, h21(floor(p / 6.0))) * 0.08;
        // 500 m 坐标网：几乎看不见，只在掠射角留一点
        vec2 g = abs(fract(p / 500.0 + 0.5) - 0.5) * 500.0;
        float grid = smoothstep(3.0, 0.0, min(g.x, g.y));
        col += uGrid * grid * 0.035;
        // 火点把周围的煤层照成橙红
        float fd = length(p - uFire.xz);
        col += vec3(1.0, 0.28, 0.1) * uFire.w * 0.4 * exp(-fd / 200.0);
        gl_FragColor = vec4(col, 1.0);
      }`
  })
}

/** 煤层侧面：上暗下更暗的岩层条带 */
export function seamSideMaterial(c, thick) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uRock: { value: lin(c.rock) },
      uHi: { value: lin(c.rockHi) },
      uThick: { value: thick }
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uRock, uHi; uniform float uThick;
      varying vec3 vW;
      ${NOISE}
      void main(){
        float h = clamp(-vW.y / uThick, 0.0, 1.0);
        float band = fbm(vec2((vW.x + vW.z) / 160.0, vW.y / 9.0));
        vec3 col = mix(uHi * 0.9, uRock * 0.45, h) * (0.7 + 0.6 * band);
        gl_FragColor = vec4(col, 1.0);
      }`
  })
}

/** 发光虚线带（井田边界）：uv.x 是沿线距离 */
export function dashMaterial(color, { dash = 60, gap = 40, glow = 1.4 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: lin(color) },
      uDash: { value: dash },
      uGap: { value: gap },
      uGlow: { value: glow }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uDash, uGap, uGlow;
      varying vec2 vUv;
      void main(){
        float on = step(mod(vUv.x, uDash + uGap), uDash);
        float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
        if (on < 0.5) discard;
        gl_FragColor = vec4(uColor * uGlow, smoothstep(0.0, 0.5, across));
      }`,
    transparent: true,
    depthWrite: false
  })
}

/**
 * 避灾路线箭头带：沿线一串 V 形箭头，按 uTime 向前流动
 * uv.x = 沿线距离（米），uv.y = 横向 0–1
 */
export function chevronMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: lin(color) },
      uTime: { value: 0 },
      uSpacing: { value: 240 },
      uOn: { value: 0 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uTime, uSpacing, uOn;
      varying vec2 vUv;
      void main(){
        // 每个箭头单元里：x 0–1 沿线（向前），y -1–1 横向；V 形 = |y| * 0.45 + x 落在一条窄带里
        float x = fract((vUv.x - uTime * 38.0) / uSpacing);
        float y = (vUv.y - 0.5) * 2.0;
        float v = x + abs(y) * 0.42;
        float shape = smoothstep(0.04, 0.0, abs(v - 0.6) - 0.09) * step(abs(y), 0.94);
        if (shape < 0.02 || uOn < 0.01) discard;
        gl_FragColor = vec4(uColor * 1.25, shape * uOn);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  })
}

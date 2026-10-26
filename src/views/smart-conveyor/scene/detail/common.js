/*
 * 下钻细节模型的公用材质与小件（真实尺度，单位 m）
 * ----------------------------------------------------------
 * 总览是示意尺度的剖面沙盘；第 2 / 3 级是真实尺度的局部模型，放在远离总览的地方（DETAIL_ORIGIN），
 * 进入下钻时隐藏总览、相机近裁剪面改小。
 */
import * as THREE from "three"
import { TOKENS } from "../theme.js"

/** 细节模型放在总览下方很远处，互不遮挡 */
export const DETAIL_ORIGIN = new THREE.Vector3(0, -20000, 0)

export const mats = () => ({
  steel: new THREE.MeshStandardMaterial({
    color: "#5d6670",
    roughness: 0.45,
    metalness: 0.8
  }),
  steelDark: new THREE.MeshStandardMaterial({
    color: "#2e343b",
    roughness: 0.55,
    metalness: 0.7
  }),
  paint: new THREE.MeshStandardMaterial({
    color: "#c8932e",
    roughness: 0.55,
    metalness: 0.35
  }),
  roller: new THREE.MeshStandardMaterial({
    color: "#8c949c",
    roughness: 0.35,
    metalness: 0.85
  }),
  rubber: new THREE.MeshStandardMaterial({
    color: "#16181b",
    roughness: 0.92,
    metalness: 0.02
  }),
  coal: new THREE.MeshStandardMaterial({
    color: "#1a1714",
    roughness: 0.75,
    metalness: 0.15,
    emissive: TOKENS.coal2,
    emissiveIntensity: 0.14
  }),
  yellow: new THREE.MeshStandardMaterial({
    color: "#e8b400",
    roughness: 0.5,
    metalness: 0.1,
    emissive: "#3a2c00",
    emissiveIntensity: 0.4
  }),
  cyan: new THREE.MeshBasicMaterial({
    color: new THREE.Color(TOKENS.data).multiplyScalar(1.8),
    toneMapped: false
  }),
  lamp: new THREE.MeshBasicMaterial({
    color: new THREE.Color("#ffe2b0").multiplyScalar(2.6),
    toneMapped: false
  })
})

/**
 * 巷道岩壁（喷浆面）：竖向明暗 + 细碎颗粒 + 锚杆托盘点阵；离镜头远的地方变暗
 */
export function rockMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBase: { value: new THREE.Color("#3a3d42") },
      uTint: { value: new THREE.Color("#4c4740") }
    },
    side: THREE.DoubleSide,
    vertexShader: `varying vec3 vW; varying vec3 vN;
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uBase, uTint; varying vec3 vW; varying vec3 vN;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
      void main(){
        vec2 p = vec2(vW.x, vW.y + vW.z);
        float n = noise(p*1.7)*0.5 + noise(p*6.0)*0.3 + noise(p*23.0)*0.2;
        vec3 col = mix(uBase, uTint, n) * (0.55 + 0.6*n);
        // 锚杆托盘：每 0.8 m 一个小方块（亮一点）
        vec2 g = fract(p / 0.8) - 0.5;
        col += vec3(0.05) * step(max(abs(g.x), abs(g.y)), 0.05);
        // 朝上的面（底板）偏暗偏褐
        col = mix(col, col*vec3(0.7,0.62,0.52), smoothstep(0.6, 0.9, vN.y));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`
  })
}

/** 托辊（沿 x 轴的圆柱）：直径 159 mm */
export const ROLLER_R = 0.0795
export function rollerGeometry(len) {
  const g = new THREE.CylinderGeometry(ROLLER_R, ROLLER_R, len, 16, 1)
  g.rotateZ(Math.PI / 2)
  return g
}

/** 文字标签锚点（页面按这个投影 DOM 标签） */
export function label(id, pos, kind, extra = {}) {
  return { id, pos, kind, ...extra }
}

/** 温度 → 颜色（深蓝 → 青 → 琥珀，超过 avg + 10 °C 紫） */
export function tempColor(v, lo, avg, out = new THREE.Color()) {
  if (v > avg + 10) return out.set(TOKENS.predict)
  const k = Math.max(0, Math.min(1, (v - lo) / (avg + 10 - lo))) * 2
  const A = [
    new THREE.Color("#0d2a3a"),
    new THREE.Color("#1e8fb0"),
    new THREE.Color(TOKENS.coal)
  ]
  const i = Math.min(1, Math.floor(k))
  return out.copy(A[i]).lerp(A[i + 1], k - i)
}

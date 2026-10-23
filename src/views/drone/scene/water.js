/*
 * 无人机巡检监控平台 · 江面材质补充
 * ----------------------------------------------------------
 * 定稿里江面映着黄昏天光的渐变和金色灯影，原先的江面是一块均匀的哑光平面（评审意见，比对第 39 轮）。
 *   - rippleNormalMap：可平铺的分形噪声波纹 → 切线空间法线贴图（第 39 轮先用正弦波叠加，规整得出现横纹，第 40 轮改噪声）
 *   - killSunSpecular：去掉直射光（夕阳）在水面上的镜面高光，只留环境贴图（天空）的反射。
 *     夕阳在画面左侧低空，水面一光滑，高光就铺开一大片、经辉光放大糊掉半个罐区（第 9–11 轮、第 39 轮都栽在这）
 * 只在加载时生成 / 编译一次。
 */
import * as THREE from "three"

/** 可平铺的分形值噪声（周期 = 网格数，边界按取模衔接），返回 size × size 的高度场 */
function tileableNoise(size, seed = 3) {
  let s = seed
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
  const h = new Float32Array(size * size)
  // 4 个八度：网格 8、16、32、64，振幅逐级减半
  for (const [cells, amp] of [
    [8, 1],
    [16, 0.5],
    [32, 0.25],
    [64, 0.12]
  ]) {
    const grid = Float32Array.from({ length: cells * cells }, rnd)
    const g = (i, j) => grid[(j % cells) * cells + (i % cells)]
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells
        const fy = (y / size) * cells
        const i = Math.floor(fx)
        const j = Math.floor(fy)
        // smoothstep 插值，避免网格方向的折痕
        const u = (fx - i) * (fx - i) * (3 - 2 * (fx - i))
        const v = (fy - j) * (fy - j) * (3 - 2 * (fy - j))
        const a = g(i, j) * (1 - u) + g(i + 1, j) * u
        const b = g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u
        h[y * size + x] += amp * (a * (1 - v) + b * v)
      }
  }
  return h
}

/** 可平铺的波纹法线贴图（size × size）：噪声高度场求中心差分梯度得法线 */
export function rippleNormalMap(size = 256) {
  const h = tileableNoise(size)
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)]
  const c = document.createElement("canvas")
  c.width = c.height = size
  const g = c.getContext("2d")
  const img = g.createImageData(size, size)
  const s = 6 // 法线强度（梯度放大倍数）
  const n = new THREE.Vector3()
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      n.set(
        -(at(x + 1, y) - at(x - 1, y)) * s,
        // 沿江方向（贴图 x）拉长：纵向梯度加强，波纹呈横向的细长条，像江面上的涟漪
        -(at(x, y + 1) - at(x, y - 1)) * s * 1.8,
        1
      ).normalize()
      const i = (y * size + x) * 4
      img.data[i] = Math.round((n.x * 0.5 + 0.5) * 255)
      img.data[i + 1] = Math.round((n.y * 0.5 + 0.5) * 255)
      img.data[i + 2] = Math.round((n.z * 0.5 + 0.5) * 255)
      img.data[i + 3] = 255
    }
  g.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  // 法线贴图是数据，不做 sRGB 解码
  t.colorSpace = THREE.NoColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  return t
}

/**
 * 着色器补丁：
 *   1. 去掉直射光（夕阳）的镜面高光，漫反射不变；
 *   2. 叠一层"假天光反射"：掠射角下水面反射的是仰角十几度的天空，而天空球只为画面里地平线以下那段窄带调过色，
 *      往上就是深夜蓝，环境反射几乎全黑（第 40 轮江面均色 32/15/23）。这里按反射方向的仰角在 low（地平线附近的暖粉）
 *      和 high（高处的灰紫）之间取色，乘菲涅耳系数（受波纹法线扰动，所以是一条条碎光）和 gain 叠到镜面反射上。
 * sky：{ low, high, gain }，颜色为 sRGB 十六进制
 */
export function waterShading(material, sky) {
  const uniforms = {
    uSkyLow: { value: new THREE.Color(sky.low) },
    uSkyHigh: { value: new THREE.Color(sky.high) },
    uSkyGain: { value: sky.gain }
  }
  // 留一份引用，调试时可以直接改（window.__droneScene 里找到江面材质 .userData.sky）
  material.userData.sky = uniforms
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "void main() {",
        "uniform vec3 uSkyLow;\nuniform vec3 uSkyHigh;\nuniform float uSkyGain;\nvoid main() {"
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
  reflectedLight.directSpecular *= 0.0;
  {
    // 视空间里的反射方向和"上"方向，求反射方向的仰角（0 = 水平）
    vec3 rv = reflect(-geometryViewDir, normal);
    vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    float elev = clamp(dot(rv, upV), 0.0, 1.0);
    vec3 skyCol = mix(uSkyLow, uSkyHigh, smoothstep(0.0, 0.45, elev));
    // Schlick 菲涅耳（水的 F0 约 0.02）
    float fr = 0.02 + 0.98 * pow(1.0 - clamp(dot(normal, geometryViewDir), 0.0, 1.0), 5.0);
    reflectedLight.indirectSpecular += skyCol * fr * uSkyGain;
  }`
      )
  }
  // 补丁后的着色器和同类标准材质不同，单独缓存
  material.customProgramCacheKey = () => "drone-water-sky"
}

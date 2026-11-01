/*
 * /estate 还原：光、水面、接触阴影和后处理（material-pass / lighting-pass 的实现）
 * ----------------------------------------------------------
 * extras.js 管"有什么"（地面贴图、窗、树、灯…），这里管"看起来怎样"：
 *   - setupLights      暖色低角度主光 + 暖灰半球光，主光投影只落在楼体上（地面是烘焙贴图，不接收）
 *   - addContactShadows 楼脚的软接触阴影：地面贴图里被遮罩填补的楼脚区域没有阴影，这里补回来
 *   - addWaterSparkle  水面高光碎点：叠在被地面贴图取代的水体（河、湖、跌水、泳池）上，缓慢流动
 *   - createComposer   渲染 → 辉光（半分辨率）→ 镜头（景深 + 移轴 + 暗角 + 调色 + 颗粒）→ 输出（Neutral 色调映射只做一次）
 * 光 / 水 / 后处理的数字对应规格里的 lightingFromPhoto 和 material 局部覆盖。
 */
import * as THREE from "three"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import { Lens } from "../lens.js"
import foot from "./footprints.json"

/** 灯光：规格 lightingFromPhoto 的 key / fill —— 低角度暖色主光（左后方），暖灰半球光，主光投影只给楼体 */
export function setupLights(scene, { shadow = true } = {}) {
  const hemi = new THREE.HemisphereLight(0xfff6ec, 0x3a2f27, 1.0)
  const sun = new THREE.DirectionalLight(0xffe6c8, 1.6)
  sun.position.set(-260, 220, 180)
  sun.target.position.set(0, 0, 0)
  sun.castShadow = shadow
  sun.shadow.mapSize.set(4096, 4096)
  const sc = sun.shadow.camera
  sc.left = -360
  sc.right = 360
  sc.top = 260
  sc.bottom = -260
  sc.near = 10
  sc.far = 900
  sun.shadow.bias = -0.0004
  scene.add(hemi, sun, sun.target)
  return { hemi, sun }
}

/**
 * 楼脚接触阴影：每栋有体积的建筑脚下一块软边的深色矩形，略向东北偏（主光从西南来）。
 * 一张共用的软边贴图 + 一个 InstancedMesh，不需要实时阴影贴图。
 */
export function addContactShadows(info) {
  const c = document.createElement("canvas")
  c.width = c.height = 128
  const g = c.getContext("2d")
  g.filter = "blur(10px)"
  g.fillStyle = "rgba(0,0,0,0.85)"
  g.fillRect(26, 26, 76, 76)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const list = foot.footprints.filter((f) =>
    /^(B\d+|CL01|ML01|SC01|SC01_west|KG01|PM01|HP01|ctx_\d+[a-c]?|SH01_s\d)$/.test(
      f.id
    )
  )
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
      toneMapped: false
    }),
    list.length
  )
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const rotX = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    -Math.PI / 2
  )
  list.forEach((f, i) => {
    // 阴影比楼脚大一圈；越高越长、越往东北偏
    const grow = 6 + Math.min(f.h, 60) * 0.25
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.ry || 0).multiply(rotX)
    m.compose(
      new THREE.Vector3(
        f.cx + Math.min(f.h, 60) * 0.12,
        info.z + 0.08,
        -(f.cy + Math.min(f.h, 60) * 0.12)
      ),
      q,
      new THREE.Vector3(f.w + grow, f.d + grow, 1)
    )
    mesh.setMatrixAt(i, m)
  })
  mesh.name = "contact_shadows"
  mesh.renderOrder = 1
  return mesh
}

/**
 * 水面高光碎点：叠在隐藏的水体网格（RV01 河 / LK01 湖 / AX01 跌水池 / SW01 泳池）正上方，
 * 加色混合的稀疏亮点，缓慢流动；底下的水色和倒影是地面贴图里设计稿自己的像素。
 */
export function addWaterSparkle(runtime) {
  const group = new THREE.Group()
  group.name = "water_sparkle"
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vW;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        vec2 p = vW.xz * 0.30;
        float a = n(p * 3.0 + vec2(uTime * 0.22, uTime * 0.16));
        float b = n(p * 6.5 - vec2(uTime * 0.18, -uTime * 0.27));
        float s = pow(a * b, 6.0) * 10.0;
        float glint = smoothstep(0.7, 1.0, s);
        gl_FragColor = vec4(vec3(0.72, 0.9, 1.0) * glint * 0.65, glint * 0.7);
      }
    `
  })
  for (const id of [
    "RV01",
    "LK01",
    "AX01_b1",
    "AX01_b2",
    "AX01_b3",
    "AX01_b4",
    "AX01_b5",
    "AX01_b6",
    "AX01_b7",
    "SW01"
  ]) {
    const src = runtime.meshes[id]
    if (!src) continue
    src.updateWorldMatrix(true, false)
    const mesh = new THREE.Mesh(src.geometry, mat)
    const p = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    src.matrixWorld.decompose(p, q, s)
    mesh.position.copy(p).add(new THREE.Vector3(0, 0.25, 0))
    mesh.quaternion.copy(q)
    mesh.scale.copy(s)
    mesh.name = `sparkle_${id}`
    group.add(mesh)
  }
  group.userData.material = mat
  return group
}

/**
 * 后处理管线（和实时版 EstateScene 同一套，镜头通道共用 lens.js）：
 * 渲染 → 辉光（半分辨率）→ 镜头 → 输出。focus 取相机到视线目标的距离。
 */
export function createComposer({
  renderer,
  scene,
  camera,
  width,
  height,
  focus
}) {
  const depthTexture = new THREE.DepthTexture(width, height)
  const target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    samples: 0,
    depthTexture
  })
  const composer = new EffectComposer(renderer, target)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    0.32,
    0.6,
    1.0
  )
  const setBloomSize = bloom.setSize.bind(bloom)
  bloom.setSize = (w, h) => setBloomSize(Math.ceil(w / 2), Math.ceil(h / 2))
  composer.addPass(bloom)
  const lens = new ShaderPass(Lens)
  const lensRender = lens.render.bind(lens)
  lens.render = (r, writeBuffer, readBuffer, dt, mask) => {
    lens.uniforms.tDepth.value = readBuffer.depthTexture
    lensRender(r, writeBuffer, readBuffer, dt, mask)
  }
  lens.uniforms.near.value = camera.near
  lens.uniforms.far.value = camera.far
  lens.uniforms.focus.value = focus
  lens.uniforms.vignette.value = 0.5 // 按设计稿四角亮度校准（实测四角 21–55，0.36 时下角只有 10）
  lens.uniforms.aperture.value = 3.6 // 景深：只让上缘的周边街区虚一点，塔楼是清晰的（设计稿）
  lens.uniforms.maxBlur.value = 9
  lens.uniforms.tiltAmount.value = 4
  lens.uniforms.tiltStart.value = 0.31 // 只有最上缘（塔楼顶以上）虚化，塔楼本身清晰
  lens.uniforms.warm.value.set(1.03, 1.0, 0.94) // 比实时版的暖色再收一点：白模要是中性浅灰，不是米黄
  lens.uniforms.resolution.value.set(width, height)
  composer.addPass(lens)
  composer.addPass(new OutputPass())
  composer.setSize(width, height)
  return { composer, bloom, lens }
}

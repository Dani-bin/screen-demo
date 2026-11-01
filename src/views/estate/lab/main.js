/*
 * /estate 还原评审页（开发用，不进生产构建）
 * ----------------------------------------------------------
 * img2threejs 还原的评审通道：用评审机位（camera-ref.json，和 scene-a1.png 同取景）渲染还原模型，
 * 无头 Chrome 截图后和设计稿原图逐区对比。
 * 地址：/estate-lab.html?w=1536&h=864&pass=blockout
 *   w / h   画布尺寸（默认 1536×864，和设计稿原图一致）
 *   cam     相机：ref（评审机位，默认）| top（俯视）
 *   focus   聚焦相机：focus=<东>,<北>,<距离>,<离竖直方向的俯角>（平面米 / 度），例如商业体 focus=215,2,140,48；
 *           和 az 同用时 az 是围绕聚焦点转的方位角（0 = 从正南往北看）
 *   az      绕沙盘目标点水平转多少度（多角度评审用，默认 0 = 评审机位）
 *   mat     flat（默认）= 规格基础色平涂，只看体块；
 *           lit = 受光的规格色 + 手写实例（地面贴图 / 窗 / 壁柱 / 树 / 灯 / 车），form-refinement 之后的评审用它；
 *           gen = 生成器自带的程序化 / 参考贴图材质
 *   look    mat=lit 时默认开（look=0 关）：look.js 的光 / 水面高光 / 接触阴影 / 辉光 + 镜头后处理 + 展厅背景
 * 约定：渲染完成后 window.__lab.ready = true，截图脚本据此等待。
 */
import * as THREE from "three"
import camRef from "../scene/img2/camera-ref.json"
import { createObjectModel } from "../scene/img2/createEstateModel.ts"
import lite from "../scene/img2/spec-lite.json"
import { buildExtras, litMaterials } from "../scene/img2/extras.js"
import {
  setupLights,
  addContactShadows,
  addWaterSparkle,
  createComposer
} from "../scene/img2/look.js"
import { backdropTexture } from "../scene/lens.js"

const q = new URLSearchParams(location.search)
const W = Number(q.get("w")) || 1536
const H = Number(q.get("h")) || 864

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true
})
renderer.setPixelRatio(1)
renderer.setSize(W, H)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = 1.0
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x120c08)

// 机位：评审机位（three.js 坐标，固定竖直视场角 28°）
const cam = new THREE.PerspectiveCamera(camRef.three.fov, W / H, 120, 2600)
const [px, py, pz] = camRef.three.position
const [tx, ty, tz] = camRef.three.target
cam.position.set(px, py, pz)
cam.lookAt(tx, ty, tz)
const az = q.get("focus") ? 0 : (Number(q.get("az")) || 0) * (Math.PI / 180)
if (az) {
  // 绕过目标点的竖直轴旋转机位，俯角和距离不变
  const dx = cam.position.x - tx
  const dz = cam.position.z - tz
  cam.position.x = tx + dx * Math.cos(az) + dz * Math.sin(az)
  cam.position.z = tz - dx * Math.sin(az) + dz * Math.cos(az)
  cam.lookAt(tx, ty, tz)
}
if (q.get("focus")) {
  const [fx, fy, fd, fp] = q.get("focus").split(",").map(Number)
  const a = (Number(q.get("az")) || 0) * (Math.PI / 180)
  const p = (fp * Math.PI) / 180
  cam.position.set(
    fx + Math.sin(a) * Math.sin(p) * fd,
    Math.cos(p) * fd,
    -fy + Math.cos(a) * Math.sin(p) * fd
  )
  cam.lookAt(fx, 0, -fy)
  cam.near = 20
  cam.updateProjectionMatrix()
}
if (q.get("cam") === "top") {
  cam.position.set(0, 900, 1)
  cam.lookAt(0, 0, 0)
}

const mode = q.get("mat") || "flat"
const useLook = mode === "lit" && q.get("look") !== "0"
if (useLook) {
  // 光和后处理由 look.js 负责（OutputPass 统一做 Neutral 色调映射，渲染器本身不做）
  renderer.toneMapping = THREE.NoToneMapping
  // 背景和页面（RestoredScene）一致：设计稿虚化出来的展厅背景，亮度取 18:00 档的 0.8
  try {
    const bg = await new THREE.TextureLoader().loadAsync(
      `${import.meta.env.BASE_URL}estate/showroom.webp`
    )
    bg.colorSpace = THREE.SRGBColorSpace
    scene.background = bg
  } catch {
    scene.background = backdropTexture()
  }
  scene.backgroundIntensity = 0.8
  setupLights(scene)
} else {
  // 光：暖色低角度主光 + 暖灰半球光
  scene.add(new THREE.HemisphereLight(0xfff6ec, 0x3a2f27, 1.0))
  const sun = new THREE.DirectionalLight(0xffe6c8, 1.6)
  sun.position.set(-260, 220, 180)
  sun.castShadow = true
  sun.shadow.mapSize.set(4096, 4096)
  const sc = sun.shadow.camera
  sc.left = -340
  sc.right = 340
  sc.top = 260
  sc.bottom = -260
  sc.near = 10
  sc.far = 900
  sun.shadow.bias = -0.0004
  scene.add(sun, sun.target)
}

const root = createObjectModel({ castShadow: true, receiveShadow: true })
scene.add(root)

// 节点名统一成部件编号（生成器用的是中文显示名；页面按楼号拾取、高亮要靠编号）
const rt = root.userData.sculptRuntime
for (const [id, node] of Object.entries(rt.nodes)) node.name = id
for (const [id, mesh] of Object.entries(rt.meshes)) mesh.name = `${id}_mesh`

// 材质模式
let look = null
if (mode === "flat") {
  // 平涂：blockout 只验体块和机位。每个部件用规格里的反照率色，不受光、不做色调映射——
  // 这样"渲染色 = 规格色"，评审看的是体块 / 位置 / 比例；光和材质留给后面的 pass
  // （生成器自带的材质会把一小块参考裁片平铺到整栋楼上，不能当外观）
  const cache = {}
  for (const [id, mesh] of Object.entries(rt.meshes)) {
    const c = lite.components[id]
    const md = c && lite.materials[c.material]
    if (!md) continue
    cache[c.material] ??= new THREE.MeshBasicMaterial({
      color: md.color,
      toneMapped: false
    })
    mesh.material = cache[c.material]
  }
} else if (mode === "lit") {
  litMaterials(rt)
  const { group, hidden, stats } = await buildExtras({
    baseUrl: import.meta.env.BASE_URL,
    runtime: rt
  })
  // 只隐藏这些部件自己的网格；节点不能隐藏，区块底板是楼栋的父节点，隐藏节点会把楼一起藏掉
  for (const id of hidden) if (rt.meshes[id]) rt.meshes[id].visible = false
  root.add(group)
  window.__labExtras = stats
  if (useLook) {
    const info = await (
      await fetch(`${import.meta.env.BASE_URL}estate/img2/ground_info.json`)
    ).json()
    scene.add(addContactShadows(info))
    const sparkle = addWaterSparkle(rt)
    scene.add(sparkle)
    const focus = cam.position.distanceTo(new THREE.Vector3(tx, ty, tz))
    look = {
      ...createComposer({
        renderer,
        scene,
        camera: cam,
        width: W,
        height: H,
        focus
      }),
      sparkle
    }
    // 评审截图需要稳定的画面：水面高光钉在 t = 3 s，颗粒的时间固定
    look.sparkle.userData.material.uniforms.uTime.value = 3
    look.lens.uniforms.time.value = 1
  }
}

if (look) look.composer.render()
else renderer.render(scene, cam)
window.__lab = { renderer, scene, camera: cam, root, THREE, look, ready: true }
window.__labStats = {
  nodes: Object.keys(root.userData.sculptRuntime?.nodes ?? {}).length,
  triangles: renderer.info.render.triangles,
  calls: renderer.info.render.calls,
  extras: window.__labExtras || null
}

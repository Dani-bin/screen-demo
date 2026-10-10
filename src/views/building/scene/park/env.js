/*
 * 夜景环境反射贴图
 * ----------------------------------------------------------
 * 设计稿里玻璃幕墙、会议中心金属壳、水面都有「天光 + 远处城市灯火」的反光；实时渲染没有全局光照，
 * 用一个程序化的夜空场景生成 PMREM 环境贴图给 PBR 材质做反射：
 *   - 天球：头顶深海军蓝 → 地平线附近带一圈青蓝色辉光（城市天光）
 *   - 地平线下方一圈暖色灯点条带（远处城市），让玻璃侧面映出零星暖光
 */
import {
  BackSide,
  Color,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  CylinderGeometry,
  CanvasTexture,
  SRGBColorSpace,
  RepeatWrapping,
  DoubleSide
} from "three"

/** 远处城市灯火条带贴图：随机暖 / 冷色小亮点 */
function cityLightsTexture() {
  const c = document.createElement("canvas")
  c.width = 1024
  c.height = 64
  const g = c.getContext("2d")
  g.fillStyle = "#000"
  g.fillRect(0, 0, c.width, c.height)
  for (let i = 0; i < 900; i++) {
    const warm = Math.random() < 0.75
    g.fillStyle = warm
      ? `rgba(255,${190 + Math.random() * 50},${120 + Math.random() * 60},${0.4 + Math.random() * 0.6})`
      : `rgba(170,215,255,${0.4 + Math.random() * 0.5})`
    const w = 1 + Math.random() * 2
    g.fillRect(Math.random() * c.width, 10 + Math.random() * 44, w, w)
  }
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.wrapS = RepeatWrapping
  return t
}

export function createNightEnvironment(renderer) {
  const scene = new Scene()
  const sky = new Mesh(
    new SphereGeometry(100, 48, 24),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new Color(0x050d22) },
        uHorizon: { value: new Color(0x1a4f8f) },
        uBottom: { value: new Color(0x02060f) }
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uBottom;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          // 地平线附近一圈亮带，往上迅速过渡到深蓝，往下是暗地面
          vec3 c = h > 0.0
            ? mix(uHorizon, uTop, pow(clamp(h * 2.2, 0.0, 1.0), 0.6))
            : mix(uHorizon * 0.6, uBottom, clamp(-h * 4.0, 0.0, 1.0));
          gl_FragColor = vec4(c, 1.0);
        }`
    })
  )
  scene.add(sky)
  // 城市灯火：贴在地平线略下方的一圈圆筒内壁
  const lights = cityLightsTexture()
  lights.repeat.set(3, 1)
  const ring = new Mesh(
    new CylinderGeometry(90, 90, 10, 64, 1, true),
    new MeshBasicMaterial({
      map: lights,
      side: DoubleSide,
      transparent: true,
      opacity: 0.9
    })
  )
  ring.position.y = -3
  scene.add(ring)

  const pmrem = new PMREMGenerator(renderer)
  const rt = pmrem.fromScene(scene, 0.02)
  pmrem.dispose()
  sky.geometry.dispose()
  sky.material.dispose()
  ring.geometry.dispose()
  ring.material.dispose()
  lights.dispose()
  return rt
}

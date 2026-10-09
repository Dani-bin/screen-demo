/*
 * 楼宇级 · 楼层外沿构件与玻璃材质
 * ----------------------------------------------------------
 * 楼层室内（楼板、家具、灯盘）是 Blender 建模 + Cycles 烘焙的（scripts/blender/tower/，加载见 bakedFloors.js）；
 * 这里只剩贴着玻璃的两样细构件和整栋的玻璃材质：
 *   buildFloorLines  每层楼板外沿一圈冷光线 + 竖梃（顶点色，随塔楼收分按层生成）
 *   glassMaterial    整栋一张物理材质蓝玻璃（环境反射 + 轮廓菲涅尔，抽屉挖空 / 悬浮 / 告警由 shader 注入）
 * 坐标：楼层局部 y = 0 为楼板顶面，平面多边形为 three 的 xz（[[x, z], …]）。
 */
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  FrontSide,
  Matrix4,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  Quaternion,
  Vector3
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { insetPoly } from "./geometry"

const UP = new Vector3(0, 1, 0)
/** 竖梃间距（米）：设计稿的竖向分格很疏，太密在远景里会糊成灰色网格 */
const FIN = 6

/** 给几何体写入统一顶点色（统一转成非索引几何，合并要求全部一致） */
function paint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo
  const n = g.attributes.position.count
  const c = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    c[i * 3] = color.r
    c[i * 3 + 1] = color.g
    c[i * 3 + 2] = color.b
  }
  g.setAttribute("color", new Float32BufferAttribute(c, 3))
  // 合并要求属性一致：只保留 position / normal / color
  g.deleteAttribute("uv")
  return g
}

/** 一个盒子：尺寸、中心、绕 y 旋转、颜色 */
const _m = new Matrix4()
const _q = new Quaternion()
const _s = new Vector3(1, 1, 1)
function box(w, h, d, x, y, z, rotY, color) {
  const g = new BoxGeometry(w, h, d)
  _q.setFromAxisAngle(UP, rotY)
  _m.compose(new Vector3(x, y, z), _q, _s)
  g.applyMatrix4(_m)
  return paint(g, color)
}

const C = {
  slabEdge: new Color(0.6, 0.88, 1.35), // 楼板外沿冷光线（设计稿一圈圈发亮的层线）
  fin: new Color(0.24, 0.52, 0.98), // 铝合金竖梃（被蓝色玻璃染成蓝线）
  finWarm: new Color(1.0, 0.72, 0.36) // 裙楼大堂竖梃（被室内暖光照亮）
}

/**
 * 一层的外沿构件（顶点色合并几何，局部坐标）
 * @param {Object} o
 * @param {Array}  o.poly   该层平面（已收分）
 * @param {number} o.height 层高
 * @param {Object} o.floor  楼层数据（kind）
 * @param {number} o.edgeK  外沿光线亮度（塔身隔层一条亮线）
 */
export function buildFloorLines(o) {
  const { poly, height, floor } = o
  const lights = []
  // ---- 楼板外沿光线：贴着板边一圈细条；edgeK 控制亮度（塔身隔层一条亮线：58 层在画面里每层不到 10 像素，层层都亮会糊成一片）
  const edgeCol = C.slabEdge.clone().multiplyScalar(o.edgeK ?? 1)
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 0.01) continue
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
    lights.push(
      box(
        len + 0.05,
        0.07,
        0.08,
        (a[0] + b[0]) / 2,
        -0.02,
        (a[1] + b[1]) / 2,
        -ang,
        edgeCol
      )
    )
  }

  // ---- 竖梃：沿外轮廓每 FIN 米一根；裙楼大堂用暖金色（被室内暖光照亮的金属框）
  const finCol = floor.kind === "lobby" ? C.finWarm : C.fin // 竖梃略内收贴在玻璃内侧
  const ring = insetPoly(poly, 0.25)
  let acc = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
    let t = (FIN - acc) % FIN
    while (t < len) {
      const x = a[0] + ((b[0] - a[0]) * t) / len
      const z = a[1] + ((b[1] - a[1]) * t) / len
      lights.push(box(0.1, height, 0.16, x, height / 2, z, -ang, finCol))
      t += FIN
    }
    acc = (acc + len) % FIN
  }

  return lights.length ? mergeGeometries(lights, false) : new BufferGeometry()
}

/** 外沿构件材质（顶点色；材质色 = 模式亮度，逐帧插值） */
export function lightsMaterial() {
  return new MeshBasicMaterial({ vertexColors: true, color: 0xffffff })
}

/**
 * 玻璃幕墙：物理材质（夜空环境反射 + 菲涅尔），淡蓝透明。
 * onBeforeCompile 注入按世界高度的效果：抽屉抽出的那层挖空、悬浮层青色、告警层红色呼吸、竖向细分格
 * uniforms 都挂在 material.userData.u 上，场景逐帧改
 */
export function glassMaterial(tint = 0x1f5fd0, glow = [0.016, 0.07, 0.21]) {
  const u = {
    // 玻璃自身的底光（设计稿塔身整体是一块发蓝光的玻璃体；裙楼是暖金色）
    uGlow: { value: new Color(...glow) },
    uGap: { value: new Vector3(0, -1, 0) }, // x 起始高度、y 结束高度、z 开关
    uHover: { value: new Vector3(0, -1, 0) },
    uAlarm: { value: [new Vector3(0, -1, 0), new Vector3(0, -1, 0)] },
    uEdge: { value: new Color(0.35, 0.75, 1.0) },
    uEdgeK: { value: 0.35 },
    uTime: { value: 0 }
  }
  const m = new MeshPhysicalMaterial({
    color: tint,
    metalness: 0.0,
    roughness: 0.06,
    transparent: true,
    opacity: 0.42,
    envMapIntensity: 1.3,
    specularIntensity: 1,
    // 只画朝外的一面：背面那层玻璃叠上来整栋会蒙一层白雾
    side: FrontSide,
    depthWrite: false
  })
  m.userData.u = u
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u)
    sh.vertexShader = sh.vertexShader
      .replace("void main() {", "varying vec3 vWorldP;\nvoid main() {")
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;"
      )
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "void main() {",
        `varying vec3 vWorldP;
        uniform vec3 uGap; uniform vec3 uHover; uniform vec3 uAlarm[2];
        uniform vec3 uEdge; uniform float uEdgeK; uniform float uTime; uniform vec3 uGlow;
        float inBand(vec3 b, float y) { return step(b.x, y) * step(y, b.y); }
        void main() {
          if (uGap.z > 0.5 && inBand(uGap, vWorldP.y) > 0.5) discard;`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        // 轮廓菲涅尔：侧边一圈亮蓝（设计稿玻璃边缘的冷光）
        float fr = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.0);
        totalEmissiveRadiance += uEdge * fr * uEdgeK + uGlow;
        totalEmissiveRadiance += vec3(0.2, 0.7, 1.0) * 0.35 * inBand(uHover, vWorldP.y);
        float al = max(inBand(uAlarm[0], vWorldP.y), inBand(uAlarm[1], vWorldP.y));
        totalEmissiveRadiance += vec3(1.0, 0.15, 0.18) * al * (0.35 + 0.25 * sin(uTime * 4.0));`
      )
      .replace(
        "#include <opaque_fragment>",
        `#include <opaque_fragment>
        gl_FragColor.a = min(1.0, gl_FragColor.a + fr * 0.2 + al * 0.25 + 0.3 * inBand(uHover, vWorldP.y));`
      )
  }
  return m
}

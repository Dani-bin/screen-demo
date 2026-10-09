/*
 * 楼宇级 · 楼层外沿构件与玻璃材质
 * ----------------------------------------------------------
 * 楼层室内（楼板、家具、灯盘）是 Blender 建模 + Cycles 烘焙的（scripts/blender/tower/，加载见 bakedFloors.js）；
 * 这里只剩楼板外沿的光线和整栋的玻璃材质：
 *   buildFloorLines  每层楼板外沿一圈冷光线（顶点色，随塔楼收分按层生成；热力 / 机电模式下变色）
 *   glassMaterial    整栋一张物理材质玻璃：环境反射 + 轮廓菲涅尔 + 竖梃 / 层线网格（设计稿那种清晰的青色分格），
 *                    抽屉挖空 / 悬浮 / 告警由 shader 注入
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

const UP = new Vector3(0, 1, 0)

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
  slabEdge: new Color(0.6, 0.88, 1.35) // 楼板外沿冷光线（设计稿一圈圈发亮的层线）
}

/**
 * 一层的楼板外沿光线（顶点色合并几何，局部坐标）；竖梃画在玻璃着色器里（glassMaterial 的 uMull）
 * @param {Object} o
 * @param {Array}  o.poly   该层平面（已收分）
 * @param {number} o.edgeK  外沿光线亮度（塔身隔层一条亮线）
 */
export function buildFloorLines(o) {
  const { poly } = o
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

  return lights.length ? mergeGeometries(lights, false) : new BufferGeometry()
}

/** 外沿构件材质（顶点色；材质色 = 模式亮度，逐帧插值） */
export function lightsMaterial() {
  return new MeshBasicMaterial({ vertexColors: true, color: 0xffffff })
}

/**
 * 玻璃幕墙：物理材质（夜空环境反射 + 菲涅尔），淡蓝透明。
 * onBeforeCompile 注入：竖梃 / 层线网格（设计稿玻璃上清晰的青色分格，按屏幕像素宽度抗锯齿，远近都是细线）、
 * 轮廓菲涅尔亮边、抽屉抽出的那层挖空、悬浮层青色、告警层红色呼吸。
 * 竖梃按放样几何的 uv.x（底圈周长，米）每 mull 米一根；层线按世界高度 (y - uBaseY) / uFloorH 取整。
 * uniforms 都挂在 material.userData.u 上，场景逐帧改
 * @param {number} tint 玻璃底色
 * @param {Array}  glow 玻璃自身的底光
 * @param {Object} grid { color 网格颜色, mull 竖梃间距（米）, floorK 层线相对竖梃的亮度 }
 */
export function glassMaterial(
  tint = 0x1650c0,
  glow = [0.01, 0.05, 0.15],
  grid = {}
) {
  const u = {
    uGlow: { value: new Color(...glow) },
    uGap: { value: new Vector3(0, -1, 0) }, // x 起始高度、y 结束高度、z 开关
    uHover: { value: new Vector3(0, -1, 0) },
    uAlarm: { value: [new Vector3(0, -1, 0), new Vector3(0, -1, 0)] },
    uEdge: { value: new Color(0.35, 0.8, 1.1) },
    uEdgeK: { value: 0.35 },
    uTime: { value: 0 },
    uGridCol: { value: new Color(...(grid.color || [0.12, 0.48, 0.85])) },
    uGrid: { value: 1 },
    uMull: { value: grid.mull || 4.5 },
    uFloorK: { value: grid.floorK ?? 0.45 },
    uBaseY: { value: 0 },
    uFloorH: { value: 0 } // 0 = 不画层线
  }
  const m = new MeshPhysicalMaterial({
    color: tint,
    metalness: 0.0,
    roughness: 0.06,
    transparent: true,
    opacity: 0.42,
    envMapIntensity: 0.9,
    specularIntensity: 1,
    // 只画朝外的一面：背面那层玻璃叠上来整栋会蒙一层白雾
    side: FrontSide,
    depthWrite: false
  })
  m.userData.u = u
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u)
    sh.vertexShader = sh.vertexShader
      .replace(
        "void main() {",
        "varying vec3 vWorldP;\nvarying float vGridU;\nvoid main() {"
      )
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGridU = uv.x;"
      )
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "void main() {",
        `varying vec3 vWorldP; varying float vGridU;
        uniform vec3 uGap; uniform vec3 uHover; uniform vec3 uAlarm[2];
        uniform vec3 uEdge; uniform float uEdgeK; uniform float uTime; uniform vec3 uGlow;
        uniform vec3 uGridCol; uniform float uGrid; uniform float uMull; uniform float uFloorK;
        uniform float uBaseY; uniform float uFloorH;
        float inBand(vec3 b, float y) { return step(b.x, y) * step(y, b.y); }
        // 细线：t 每过一个整数一条线，宽约 1.5 像素（至少 w 个单位），抗锯齿
        float gridLine(float t, float w) {
          float fw = max(fwidth(t), 1e-4);
          return 1.0 - smoothstep(0.5 * fw, 1.5 * fw + w, abs(fract(t + 0.5) - 0.5));
        }
        void main() {
          if (uGap.z > 0.5 && inBand(uGap, vWorldP.y) > 0.5) discard;`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        // 轮廓菲涅尔：侧边一圈亮青（设计稿塔身两侧发亮的轮廓）
        float fr = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.5);
        totalEmissiveRadiance += uEdge * fr * uEdgeK + uGlow;
        // 竖梃 + 层线网格
        float grid = gridLine(vGridU / uMull, 0.015);
        if (uFloorH > 0.0) grid = max(grid, uFloorK * gridLine((vWorldP.y - uBaseY) / uFloorH, 0.02));
        grid *= uGrid;
        totalEmissiveRadiance += uGridCol * grid;
        totalEmissiveRadiance += vec3(0.2, 0.7, 1.0) * 0.35 * inBand(uHover, vWorldP.y);
        float al = max(inBand(uAlarm[0], vWorldP.y), inBand(uAlarm[1], vWorldP.y));
        totalEmissiveRadiance += vec3(1.0, 0.15, 0.18) * al * (0.35 + 0.25 * sin(uTime * 4.0));`
      )
      .replace(
        "#include <opaque_fragment>",
        `#include <opaque_fragment>
        gl_FragColor.a = min(1.0, gl_FragColor.a + grid * 0.3 + fr * 0.25 + al * 0.25 + 0.3 * inBand(uHover, vWorldP.y));`
      )
  }
  return m
}

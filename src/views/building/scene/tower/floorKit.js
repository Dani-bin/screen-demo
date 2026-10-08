/*
 * 楼宇级 · 写实楼层构件
 * ----------------------------------------------------------
 * 设计稿 02-ai-building.png 的塔楼是「写实剖切模型」：透明蓝玻璃后面能看到每层的混凝土楼板、铝合金竖梃、
 * 吊顶灯盘和一排排办公桌椅，亮灯的楼层暖白、空置区暗。这里每层生成两块合并网格：
 *   solid  楼板 + 竖梃 + 核心筒侧墙 + 家具（顶点色，材质见 solidMaterial：顶点色同时叠一点自发光，模拟室内灯照亮家具）
 *   lights 吊顶灯盘（顶点色，亮灯 / 熄灯各不相同；整层颜色乘材质色，模式切换 / 热力 / 设备层着色都改材质色）
 * 玻璃幕墙是整栋一张（见 glassMaterial），不在这里。
 * 坐标：楼层局部 y = 0 为楼板顶面，平面多边形为 three 的 xz（[[x, z], …]）。
 */
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Matrix4,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  FrontSide,
  Quaternion,
  Vector3
} from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { inPoly, insetPoly, prismGeometry } from "./geometry"

const UP = new Vector3(0, 1, 0)
/** 竖梃间距（米）：设计稿的竖向分格很疏，太密在远景里会糊成灰色网格 */
const FIN = 6

/** 固定种子伪随机 */
function rng(seed) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

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
  // 夜景室内整体偏暗：亮的只有灯盘、楼板外沿的冷光线和亮灯区的桌面（设计稿的明暗关系）
  slab: new Color(0.16, 0.19, 0.25), // 楼板混凝土
  slabUnder: new Color(0.1, 0.12, 0.16),
  slabEdge: new Color(0.6, 0.88, 1.35), // 楼板外沿冷光线（设计稿一圈圈发亮的层线）
  fin: new Color(0.24, 0.52, 0.98), // 铝合金竖梃（被蓝色玻璃染成蓝线）
  finWarm: new Color(1.0, 0.72, 0.36),
  deskLit: new Color(0.42, 0.33, 0.22), // 亮灯区木纹桌面
  deskDark: new Color(0.05, 0.06, 0.08),
  chairLit: new Color(0.2, 0.21, 0.25),
  chairDark: new Color(0.05, 0.06, 0.07),
  cabinet: new Color(0.22, 0.24, 0.28),
  plant: new Color(0.16, 0.36, 0.18),
  lightOn: new Color(1.0, 0.9, 0.74), // 吊顶灯盘：暖白
  lightOnCool: new Color(0.86, 0.92, 1.0),
  lightOff: new Color(0.08, 0.09, 0.11),
  screenWarm: new Color(1.0, 0.82, 0.55),
  screenCool: new Color(0.7, 0.85, 1.0),
  lobby: new Color(1.0, 0.8, 0.5)
}

/**
 * 生成一层的 solid / lights 几何（局部坐标，y = 0 为楼板顶面）
 * @param {Object} o
 * @param {Array}  o.poly      该层平面
 * @param {number} o.height    层高（楼板顶到上一层楼板底）
 * @param {Object} o.core      核心筒 { w, d, axis }
 * @param {Object} o.floor     data/building.js 的楼层数据（kind / occupancy）
 * @param {number} o.seed
 * @param {boolean} o.ceiling  是否带天花板（抽屉层自带一块，塔身里用上一层楼板当天花）
 */
export function buildFloor(o) {
  const { poly, height, core, floor } = o
  const rnd = rng(o.seed || 1)
  const solid = []
  const lights = []
  const axis = core.axis
  const ca = Math.cos(axis)
  const sa = Math.sin(axis)
  // 主轴坐标 (a, b) → 世界 xz
  const toXZ = (a, b) => [a * ca - b * sa, a * sa + b * ca]
  const rotY = -axis

  // ---- 楼板：0.32 m 厚，板边浅灰白（夜景里一圈圈白色层线就是它）
  const slab = prismGeometry(poly, -0.32, 0)
  solid.push(paint(slab, C.slab))
  if (o.ceiling)
    solid.push(paint(prismGeometry(poly, height - 0.3, height), C.slabUnder))

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

  // 核心筒不画墙：由场景里整根发光的电梯井光柱表现（设计稿中间那道青色光柱）
  const { w, d } = core

  const occ = (floor.occupancy ?? 40) / 100
  const isLobby = floor.kind === "lobby" || floor.kind === "sky"
  const isPlant = floor.kind === "plant"
  const inner = insetPoly(poly, 2.0)

  // 亮灯分区：沿主轴把平面切成 6 段，按入驻率决定每段亮不亮（设计稿里一层里有的区域亮、有的暗）
  const zoneLit = Array.from({ length: 6 }, () => rnd() < occ * 1.05)
  const zoneOf = (a) =>
    Math.max(0, Math.min(5, Math.floor(((a + 30) / 60) * 6)))
  const avoidCore = (a, b, pad) =>
    Math.abs(a) < w / 2 + pad && Math.abs(b) < d / 2 + pad

  // ---- 吊顶灯盘：3.0 × 2.4 m 网格
  for (let a = -33; a <= 33; a += 3.0)
    for (let b = -30; b <= 30; b += 2.4) {
      const [x, z] = toXZ(a, b)
      if (!inPoly(x, z, inner) || avoidCore(a, b, 0.8)) continue
      const on = isLobby || isPlant ? true : zoneLit[zoneOf(a)] && rnd() > 0.06
      if (isLobby) {
        lights.push(
          box(
            1.2,
            0.05,
            0.55,
            x,
            height - 0.36,
            z,
            rotY,
            C.lobby.clone().multiplyScalar(1.25)
          )
        )
        continue
      }
      const col = on
        ? (rnd() < 0.15 ? C.lightOnCool : C.lightOn)
            .clone()
            .multiplyScalar(0.75 + 0.25 * rnd())
        : C.lightOff
      lights.push(box(1.2, 0.05, 0.55, x, height - 0.36, z, rotY, col))
    }

  // ---- 家具
  if (isPlant) {
    // 设备层：一排排机组
    for (let a = -24; a <= 24; a += 7)
      for (const b of [-9, 9]) {
        const [x, z] = toXZ(a, b)
        if (!inPoly(x, z, inner)) continue
        solid.push(
          box(
            4.5,
            Math.min(1.6, height * 0.7),
            2.6,
            x,
            Math.min(0.8, height * 0.35),
            z,
            rotY,
            new Color(0.25, 0.42, 0.7)
          )
        )
      }
  } else if (isLobby) {
    // 大堂 / 会所：几组沙发茶几 + 绿植 + 前台
    for (let k = 0; k < 10; k++) {
      const a = (rnd() - 0.5) * 50
      const b = (rnd() - 0.5) * 40
      const [x, z] = toXZ(a, b)
      if (!inPoly(x, z, inner) || avoidCore(a, b, 2)) continue
      solid.push(
        box(2.4, 0.45, 0.9, x, 0.23, z, rotY, new Color(0.55, 0.45, 0.35))
      )
      const [px, pz] = toXZ(a + 1.8, b)
      solid.push(box(0.6, 1.2, 0.6, px, 0.6, pz, rotY, C.plant))
    }
  } else {
    // 办公：两两相对的工位（桌面 + 桌身 + 两把椅子），核心筒周围留走道，少量文件柜
    for (let a = -32; a <= 32; a += 3.6)
      for (let b = -30; b <= 30; b += 3.2) {
        const [x, z] = toXZ(a, b)
        if (!inPoly(x, z, inner) || avoidCore(a, b, 2.4)) continue
        if (rnd() < 0.12) continue // 走道、空位
        const lit = zoneLit[zoneOf(a)]
        if (rnd() < 0.08) {
          solid.push(box(1.6, 1.1, 0.5, x, 0.55, z, rotY, C.cabinet))
          continue
        }
        solid.push(
          box(1.6, 0.06, 1.4, x, 0.74, z, rotY, lit ? C.deskLit : C.deskDark)
        )
        if (lit && rnd() < 0.8) {
          // 桌上两块屏（亮灯区才开），颜色冷暖不一：设计稿窗里一点点暖白 / 冷白的光
          const sc = (rnd() < 0.5 ? C.screenCool : C.screenWarm)
            .clone()
            .multiplyScalar(0.7 + 0.5 * rnd())
          for (const s of [-1, 1]) {
            const [mx, mz] = toXZ(a, b + s * 0.25)
            lights.push(box(0.55, 0.36, 0.04, mx, 1.0, mz, rotY, sc))
          }
        }
        solid.push(
          box(1.5, 0.66, 0.08, x, 0.37, z, rotY, lit ? C.chairLit : C.chairDark)
        )
        for (const s of [-1, 1]) {
          const [cx, cz] = toXZ(a, b + s * 1.05)
          solid.push(
            box(
              0.5,
              0.5,
              0.5,
              cx,
              0.3,
              cz,
              rotY,
              lit ? C.chairLit : C.chairDark
            )
          )
        }
      }
  }

  return {
    solid: mergeGeometries(solid, false),
    lights: lights.length
      ? mergeGeometries(lights, false)
      : new BufferGeometry()
  }
}

/**
 * 楼层实体材质：顶点色 + 顶点色乘 uSelf 的自发光（实时渲染里几十层室内点光源算不起，
 * 直接把「被吊顶灯照亮」画进颜色；亮灯区的桌面顶点色本来就亮，自发光后读成暖光下的家具）
 */
export function solidMaterial() {
  const m = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.75,
    metalness: 0.15
  })
  m.userData.self = { value: 0.25 }
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSelf = m.userData.self
    sh.fragmentShader = sh.fragmentShader
      .replace("void main() {", "uniform float uSelf;\nvoid main() {")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * uSelf;"
      )
  }
  return m
}

/** 灯盘材质：每层一份（材质色 = 模式 / 热力 / 设备层颜色，逐帧插值） */
export function lightsMaterial() {
  return new MeshBasicMaterial({ vertexColors: true, color: 0xffffff })
}

/**
 * 玻璃幕墙：物理材质（夜空环境反射 + 菲涅尔），淡蓝透明。
 * onBeforeCompile 注入按世界高度的效果：抽屉抽出的那层挖空、悬浮层青色、告警层红色呼吸、竖向细分格
 * uniforms 都挂在 material.userData.u 上，场景逐帧改
 */
export function glassMaterial(tint = 0x1f5fd0, glow = [0.02, 0.085, 0.24]) {
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

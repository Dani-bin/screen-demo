/*
 * 火点特效（DS-04）：室内火焰、光晕、短光柱、地面扩散环、烟雾（沿主大巷向下风侧拖尾）、喷放雾化
 * 强度由仿真的 scene 字段驱动：ds04 状态、smoke 0–1、flame、spraying。
 * 概念图里火点是全画面最亮最暖的地方：橙红炽亮的室内 + 短而亮的橙色光柱 + 地面红圈 + 向西南拖出的黑褐色烟团。
 */
import * as THREE from "three"
import { THEME } from "./theme.js"
import { softTexture } from "./geom.js"

const SMOKE_N = 420
const MIST_N = 160
const FLAME_N = 14

/** 点精灵着色器（尺寸按米给，乘 uScale / 深度换算成像素）；颜色按粒子寿命从火光橙过渡到烟褐 */
function puffMaterial(tex, { additive = false, fire = false } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex }, uScale: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float alpha; attribute float size; attribute float life;
      uniform float uScale; varying float vA; varying float vL;
      void main(){ vA = alpha; vL = life; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: fire
      ? /* glsl */ `
      uniform sampler2D uMap; varying float vA; varying float vL;
      void main(){ vec4 t = texture2D(uMap, gl_PointCoord);
        vec3 c = mix(vec3(3.2, 1.3, 0.3), vec3(2.6, 0.45, 0.12), vL);
        gl_FragColor = vec4(c, t.a * vA); }`
      : additive
        ? /* glsl */ `
      uniform sampler2D uMap; varying float vA;
      void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vec3(1.6, 1.7, 1.8), t.a * vA); }`
        : /* glsl */ `
      uniform sampler2D uMap; varying float vA; varying float vL;
      void main(){ vec4 t = texture2D(uMap, gl_PointCoord);
        // 刚冒出来的烟被火光映成暗橙，飘远后变成黑褐
        vec3 c = mix(vec3(0.42, 0.16, 0.06), vec3(0.075, 0.062, 0.055), smoothstep(0.0, 0.3, vL));
        gl_FragColor = vec4(c, t.a * vA); }`,
    transparent: true,
    depthWrite: false,
    blending: additive || fire ? THREE.AdditiveBlending : THREE.NormalBlending
  })
}

/** 建一组点精灵：返回 { points, pos, alpha, size, life, geo } */
function puffs(n, mat) {
  const pos = new Float32Array(n * 3)
  const alpha = new Float32Array(n)
  const size = new Float32Array(n).fill(1)
  const life = new Float32Array(n)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
  geo.setAttribute("alpha", new THREE.BufferAttribute(alpha, 1))
  geo.setAttribute("size", new THREE.BufferAttribute(size, 1))
  geo.setAttribute("life", new THREE.BufferAttribute(life, 1))
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  return { points, pos, alpha, size, life, geo }
}
const dirty = (p) => {
  for (const k of ["position", "alpha", "size", "life"])
    p.geo.attributes[k].needsUpdate = true
}

/**
 * @param {THREE.Vector3} center 硐室中心（地面）
 * @param {number} H 硐室高度（米）
 */
export function buildFireFx(center, H = 200) {
  const group = new THREE.Group()
  group.position.copy(center)
  const tex = softTexture(64)
  const fire = new THREE.Color("#ff5a24")
  const warn = new THREE.Color(THEME.color.warn)

  // ---------- 光晕（加色精灵，压在硐室上方）
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      color: fire,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true
    })
  )
  glow.position.y = H * 0.6
  glow.renderOrder = 9
  group.add(glow)

  // ---------- 光柱：短而亮的橙色光柱，竖直方向渐隐
  const beamMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: fire.clone() },
      uK: { value: 0 },
      uTime: { value: 0 }
    },
    vertexShader: /* glsl */ `varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uK, uTime; varying float vY;
      void main(){
        float a = pow(1.0 - vY, 2.2) * uK * (0.85 + 0.15 * sin(uTime * 7.0 + vY * 18.0));
        gl_FragColor = vec4(uColor * 2.8, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  })
  const beamH = 560
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(8, 18, beamH, 24, 1, true),
    beamMat
  )
  // 从硐室屋顶升起，不挡住房间本身
  beam.position.y = H + beamH / 2
  beam.renderOrder = 9
  group.add(beam)

  // ---------- 地面扩散环：三圈错开，从 120 m 扩到 520 m 后淡出
  const ringMat = []
  const rings = []
  for (let i = 0; i < 3; i++) {
    const m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(THEME.color.fire).multiplyScalar(1.6),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide
    })
    const r = new THREE.Mesh(new THREE.RingGeometry(0.95, 1, 96), m)
    r.rotation.x = -Math.PI / 2
    r.position.y = 3 - center.y
    r.renderOrder = 3
    group.add(r)
    rings.push(r)
    ringMat.push(m)
  }

  // ---------- 室内火焰：一簇加色粒子在柜列附近跳动（喷放后熄灭成余烬）
  const flameMat = puffMaterial(tex, { fire: true })
  const flames = puffs(FLAME_N, flameMat)
  flames.points.renderOrder = 9
  group.add(flames.points)

  // ---------- 烟雾：粒子从硐室顶冒出，沿主大巷向南（下风侧）拖尾，边飘边升、变大、变淡
  const smokeMat = puffMaterial(tex)
  const smoke = puffs(SMOKE_N, smokeMat)
  smoke.points.renderOrder = 8
  group.add(smoke.points)
  // 每个粒子的固定随机量：相位、横向散布、上升速度、摆动相位
  const seeds = Array.from({ length: SMOKE_N }, (_, i) => ({
    ph: i / SMOKE_N,
    side: Math.sin(i * 12.9898) * 0.5,
    up: 0.5 + ((i * 7) % 10) / 18,
    wob: (i * 3.7) % 6.28
  }))

  // ---------- 喷放雾化：白色粒子从柜列向四周涨满玻璃房
  const mistMat = puffMaterial(tex, { additive: true })
  const mist = puffs(MIST_N, mistMat)
  mist.points.renderOrder = 9
  group.add(mist.points)
  const mistDir = Array.from({ length: MIST_N }, (_, i) => {
    const a = i * 2.39996
    return [
      Math.cos(a) * (0.3 + (i % 7) / 10),
      0.4 + (i % 5) / 8,
      Math.sin(a) * (0.5 + (i % 11) / 10)
    ]
  })

  let st = { ds04: "ok", smoke: 0, flame: false, spraying: false }
  let sprayT = -1

  return {
    group,
    setState(s) {
      if (s.spraying && !st.spraying) sprayT = 0
      if (!s.spraying && sprayT > 14) sprayT = -1
      st = s
      const col = s.ds04 === "warn" ? warn : fire
      glow.material.color.copy(col)
      beamMat.uniforms.uColor.value.copy(col)
    },
    /** 每帧：dt 秒，t 总时间，pxScale = 投影焦距（像素），用于把粒子尺寸从米换成像素 */
    tick(dt, t, pxScale) {
      const on = st.ds04 === "fire" ? 1 : st.ds04 === "warn" ? 0.45 : 0
      const burning = st.ds04 === "fire" && st.flame
      const flick = 0.85 + 0.15 * Math.sin(t * 17) * Math.sin(t * 5.3)
      glow.material.opacity = on * (burning ? flick * 0.7 : 0.4)
      glow.scale.setScalar(
        (st.ds04 === "fire" ? 300 : 220) * (burning ? flick : 1)
      )
      beamMat.uniforms.uK.value = on * 0.8
      beamMat.uniforms.uTime.value = t
      beam.visible = on > 0
      // 扩散环：周期 2.6 s
      rings.forEach((r, i) => {
        const k = (((t / 2.6 + i / 3) % 1) + 1) % 1
        r.scale.setScalar(120 + k * 400)
        ringMat[i].opacity = on * (1 - k) * 0.7
      })
      // 火焰：喷放前在柜列上方跳动，之后剩一点余烬
      flameMat.uniforms.uScale.value = pxScale
      const fk = st.ds04 !== "fire" ? 0 : burning ? 1 : 0.25
      for (let i = 0; i < FLAME_N; i++) {
        const life = (t * (0.9 + (i % 4) * 0.2) + i / FLAME_N) % 1
        flames.pos[i * 3] = Math.sin(i * 1.7) * 40
        flames.pos[i * 3 + 1] = 30 + life * 110
        flames.pos[i * 3 + 2] = (i / FLAME_N - 0.5) * 220
        flames.size[i] = 90 * (1 - life * 0.6)
        flames.life[i] = life
        flames.alpha[i] = fk * Math.sin(Math.PI * life) * 0.9
      }
      dirty(flames)
      flames.points.visible = fk > 0
      // 烟：周期 16 s；从硐室顶冒出 → 向南（+z）沿大巷拖尾，略偏西，越飘越高越散
      smokeMat.uniforms.uScale.value = pxScale
      for (let i = 0; i < SMOKE_N; i++) {
        const sd = seeds[i]
        const life = (t / 16 + sd.ph) % 1
        const spread = 30 + life * 160
        smoke.pos[i * 3] =
          60 + sd.side * spread - life * 140 + Math.sin(t * 0.6 + sd.wob) * 20
        smoke.pos[i * 3 + 1] = H * 0.8 + life * 300 * sd.up
        smoke.pos[i * 3 + 2] = 60 + life * 720 + Math.cos(t * 0.5 + sd.wob) * 25
        smoke.size[i] = 50 + life * 170
        smoke.life[i] = life
        smoke.alpha[i] =
          st.smoke *
          0.9 *
          Math.pow(Math.sin(Math.PI * Math.min(1, life * 1.2)), 0.7)
      }
      dirty(smoke)
      smoke.points.visible = st.smoke > 0.01
      // 喷放雾：14 s 内从柜列涨满房间，之后淡掉
      mistMat.uniforms.uScale.value = pxScale
      if (sprayT >= 0) sprayT += dt
      const k = sprayT < 0 ? 0 : Math.min(1, sprayT / 6)
      for (let i = 0; i < MIST_N; i++) {
        const d = mistDir[i]
        mist.pos[i * 3] = d[0] * 55 * k
        mist.pos[i * 3 + 1] = 10 + d[1] * 90 * k
        mist.pos[i * 3 + 2] = d[2] * 130 * k
        mist.size[i] = 28 + 46 * k
        mist.alpha[i] =
          sprayT < 0 ? 0 : 0.35 * (1 - Math.max(0, (sprayT - 8) / 6))
      }
      dirty(mist)
      mist.points.visible = sprayT >= 0 && sprayT < 14
    }
  }
}

/*
 * 人员光点：位置由仿真 sim.peopleAt(s) 给出（平面坐标 + 状态），每帧写进点云
 * 颜色：正常作业 白 / 撤离中 绿 / 未响应 红 / 已到安全点 白（淡）；进了避难硐室的不画
 */
import * as THREE from "three"
import { THEME } from "./theme.js"
import { softTexture } from "./geom.js"

export function buildPeople(count) {
  const S = THEME.size
  const pos = new Float32Array(count * 3)
  const col = new Float32Array(count * 3)
  const alpha = new Float32Array(count)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3))
  geo.setAttribute("alpha", new THREE.BufferAttribute(alpha, 1))
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: softTexture(32, 0.45) },
      uSize: { value: S.person }
    },
    vertexShader: /* glsl */ `
      attribute vec3 color; attribute float alpha; uniform float uSize; varying vec3 vC; varying float vA;
      void main(){ vC = color; vA = alpha; gl_PointSize = uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; varying vec3 vC; varying float vA;
      void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA); }`,
    transparent: true,
    depthWrite: false
  })
  const points = new THREE.Points(geo, mat)
  points.renderOrder = 11
  points.frustumCulled = false

  // 每人固定的小横向偏移（巷道里不站成一条线）
  const jitter = Array.from({ length: count }, (_, i) => [
    Math.sin(i * 91.7) * 12,
    Math.cos(i * 47.3) * 12
  ])
  const buf = new Float32Array(count * 3)
  const C = {
    0: new THREE.Color(1.05, 1.2, 1.35), // 正常作业：亮度压在泛光阈值以下，工作面上几十人才不会叠成白条
    1: new THREE.Color(1.5, 2.3, 1.7), // 撤离中：淡绿白（饱和绿会把整条大巷染绿）
    2: new THREE.Color(3.0, 0.5, 0.35),
    3: new THREE.Color(0.9, 1.0, 1.1)
  }
  const y = -S.sink + S.tubeH * 0.4

  return {
    points,
    buf,
    /** 未响应人员的三维位置（场景标签用） */
    lost: [],
    /** dpr：设备像素比，点的大小按它放大 */
    update(sim, s, dpr) {
      mat.uniforms.uSize.value = S.person * dpr
      const n = sim.peopleAt(s, buf)
      this.lost = []
      for (let i = 0; i < n; i++) {
        const e = buf[i * 3]
        const nn = buf[i * 3 + 1]
        const st = buf[i * 3 + 2]
        pos[i * 3] = e + jitter[i][0]
        pos[i * 3 + 1] = y
        pos[i * 3 + 2] = -nn + jitter[i][1]
        const c = C[st] || C[0]
        col[i * 3] = c.r
        col[i * 3 + 1] = c.g
        col[i * 3 + 2] = c.b
        alpha[i] = st === 4 ? 0 : st === 3 ? 0.6 : 1
        if (st === 2)
          this.lost.push(new THREE.Vector3(pos[i * 3], y, pos[i * 3 + 2]))
      }
      geo.attributes.position.needsUpdate = true
      geo.attributes.color.needsUpdate = true
      geo.attributes.alpha.needsUpdate = true
    }
  }
}

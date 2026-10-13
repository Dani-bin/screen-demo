/*
 * 老家沙盘 背景：画在 Canvas 上的天空、远山、雾（傍晚）与星空（夜晚）
 * ----------------------------------------------------------
 * 和效果图后期（scripts/hometown/compose_effects.py）同一套画法：竖向渐变 + 左侧暖光晕 +
 * 三层正弦叠加的远山剪影 + 山脚雾带；夜晚换成深蓝渐变 + 星点。
 * 两张贴图贴在跟随相机的全屏背景板上，按 uNight 混合（昼夜切换时平滑过渡）。
 */
import * as THREE from "three"

const W = 1920
const H = 1080

/** 伪随机（固定种子），每次画出来的山和星星都一样 */
function rng(seed) {
  let s = seed >>> 0
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296
}

function gradient(g, stops) {
  const lg = g.createLinearGradient(0, 0, 0, H)
  for (const [k, c] of stops) lg.addColorStop(k, c)
  g.fillStyle = lg
  g.fillRect(0, 0, W, H)
}

/** 一层远山：几组正弦叠加成山脊线，下面填色 */
function hills(g, seed, baseY, amp, color, freqs, blur) {
  const r = rng(seed)
  const ph = freqs.map(() => r() * Math.PI * 2)
  const am = freqs.map(() => 0.4 + r() * 0.6)
  g.save()
  g.filter = `blur(${blur}px)`
  g.fillStyle = color
  g.beginPath()
  g.moveTo(0, H)
  for (let x = 0; x <= W; x += 8) {
    let y = baseY
    freqs.forEach((f, i) => {
      y -= amp * am[i] * Math.sin((2 * Math.PI * x * f) / W + ph[i])
    })
    g.lineTo(x, y * H)
  }
  g.lineTo(W, H)
  g.closePath()
  g.fill()
  g.restore()
}

function glow(g, cx, cy, r, color) {
  const rg = g.createRadialGradient(cx, cy, 0, cx, cy, r)
  rg.addColorStop(0, color)
  rg.addColorStop(1, "rgba(0,0,0,0)")
  g.fillStyle = rg
  g.fillRect(0, 0, W, H)
}

function canvasTexture(draw) {
  const c = document.createElement("canvas")
  c.width = W
  c.height = H
  draw(c.getContext("2d"))
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function duskTexture() {
  return canvasTexture((g) => {
    gradient(g, [
      [0, "#5c687a"],
      [0.3, "#968c88"],
      [0.5, "#d6b08c"],
      [0.62, "#e2be98"],
      [0.8, "#b0a8a6"],
      [1, "#7e8088"]
    ])
    glow(g, 0.08 * W, 0.34 * H, 0.55 * W, "rgba(255,205,140,0.75)")
    hills(g, 1, 0.46, 0.05, "rgba(150,140,146,0.75)", [1.3, 3.1, 7], 3)
    hills(g, 2, 0.53, 0.045, "rgba(128,126,134,0.75)", [1.7, 4.3, 9], 2)
    hills(g, 3, 0.6, 0.04, "rgba(112,114,124,0.75)", [2.1, 5.2, 11], 1.5)
    // 山脚雾带
    const fg = g.createLinearGradient(0, 0.52 * H, 0, 0.92 * H)
    fg.addColorStop(0, "rgba(228,214,200,0)")
    fg.addColorStop(0.5, "rgba(228,214,200,0.55)")
    fg.addColorStop(1, "rgba(228,214,200,0)")
    g.fillStyle = fg
    g.fillRect(0, 0, W, H)
  })
}

export function nightTexture() {
  return canvasTexture((g) => {
    gradient(g, [
      [0, "#080e20"],
      [0.45, "#121e3a"],
      [0.62, "#283048"],
      [0.8, "#161c2e"],
      [1, "#0c101c"]
    ])
    glow(g, 0.12 * W, 0.6 * H, 0.5 * W, "rgba(120,96,110,0.35)")
    const r = rng(7)
    for (let i = 0; i < 420; i++) {
      const x = r() * W
      const y = r() * H * 0.5
      const a = 0.3 + r() * 0.7
      g.fillStyle = `rgba(235,240,255,${a})`
      g.beginPath()
      g.arc(x, y, 0.6 + r() * 0.9, 0, Math.PI * 2)
      g.fill()
    }
    hills(g, 1, 0.5, 0.05, "rgba(20,26,44,0.9)", [1.3, 3.1, 7], 3)
    hills(g, 2, 0.57, 0.045, "rgba(14,19,34,0.9)", [1.7, 4.3, 9], 2)
  })
}

/**
 * 背景板：挂在相机下、放在远裁剪面前，尺寸铺满视野；不写深度、最先绘制。
 * 相机视场角变化后调用 fit(camera)
 */
export class Backdrop {
  constructor(camera) {
    this.texDusk = duskTexture()
    this.texNight = nightTexture()
    this.uniforms = {
      tDusk: { value: this.texDusk },
      tNight: { value: this.texNight },
      uNight: { value: 0 }
    }
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      depthWrite: false,
      depthTest: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDusk; uniform sampler2D tNight; uniform float uNight;
        varying vec2 vUv;
        void main() {
          vec4 a = texture2D(tDusk, vUv);
          vec4 b = texture2D(tNight, vUv);
          gl_FragColor = mix(a, b, uNight);
          #include <colorspace_fragment>
        }`
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
    this.mesh.renderOrder = -10
    this.mesh.frustumCulled = false
    camera.add(this.mesh)
    this.fit(camera)
  }

  fit(camera) {
    const d = camera.far * 0.9
    const h = 2 * d * Math.tan((camera.fov * Math.PI) / 360)
    this.mesh.position.set(0, 0, -d)
    // 宽度按 16:9 的贴图铺满（画面更宽时左右裁掉）
    const w = Math.max(h * camera.aspect, (h * W) / H)
    this.mesh.scale.set(w, (w * H) / W, 1)
  }

  setNight(k) {
    this.uniforms.uNight.value = k
  }

  dispose() {
    this.texDusk.dispose()
    this.texNight.dispose()
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}

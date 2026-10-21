/*
 * 智慧港口 地面：海面、周边岛屿（真实地形 + 影像）、四期码头面（canvas 按主题画标线）、夜景光池
 * ----------------------------------------------------------
 * 坐标：岸线坐标 (u, v)（layout.json），three.js 里 x = u，z = −v，y 向上（米，海面 y = 0）。
 * 码头面高出海面 DECK_H；周边陆地的平地也在这个高度（prepare.py 压平），码头面再抬高 0.4 m 盖住它。
 */
import * as THREE from "three"

export const DECK_H = 6.5
/** 码头面比周边陆地平地高出的量（避免与底图共面闪烁） */
export const TERMINAL_LIFT = 0.4
export const TOP = DECK_H + TERMINAL_LIFT

/** 码头面贴图覆盖的范围（u / v，米） */
export const GROUND = { u0: -120, u1: 3000, v0: -24, v1: 696 }

const col = (hex) => new THREE.Color(hex)

/** 读取图片的像素（高程、掩膜要在 CPU 上解码） */
export async function loadPixels(url) {
  const img = new Image()
  img.crossOrigin = "anonymous"
  img.src = url
  await img.decode()
  const c = document.createElement("canvas")
  c.width = img.width
  c.height = img.height
  // 高程是按字节编码的，不能做色彩空间换算
  const ctx = c.getContext("2d", {
    colorSpace: "srgb",
    willReadFrequently: true
  })
  ctx.drawImage(img, 0, 0)
  return {
    w: img.width,
    h: img.height,
    data: ctx.getImageData(0, 0, img.width, img.height).data
  }
}

/* ---------------- 海面 ---------------- */

const SEA_VERT = /* glsl */ `
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`
const SEA_FRAG = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uFar;
  uniform float uRipple;
  uniform float uTime;
  uniform vec3 uCam;
  uniform sampler2D uPool;
  uniform sampler2D uGlint;
  uniform vec4 uPoolRect;
  uniform float uPoolGain;
  uniform float uGrid;
  uniform vec3 uGridColor;
  uniform float uRef;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  // 值噪声：低频波纹（不做深浅渐变：屏上不得表示水深）
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  void main() {
    // 距离按"镜头到注视点的距离"归一化到 4200 m（远近镜头下海面的渐变、网格淡出看起来一样）
    float d = length(vWorld.xz - uCam.xz) * (4200.0 / max(uRef, 1.0));
    vec3 c = mix(uBase, uFar, smoothstep(1500.0, 9000.0, d));
    vec2 p = vWorld.xz * 0.012 + vec2(uTime * 0.02, uTime * 0.013);
    float n = noise(p) * 0.6 + noise(p * 2.7 + 3.1) * 0.4;
    c *= 1.0 + (n - 0.5) * uRipple * (1.0 - smoothstep(2000.0, 8000.0, d));
    // 波纹亮纹：两层不同方向的细波叠出一条条浅色涟漪（定稿的暗水面上有细碎的波光纹理），近处明显、远处淡出
    if (uGrid > 0.0) {
      vec2 w1 = vWorld.xz * vec2(0.055, 0.16) + vec2(uTime * 0.12, -uTime * 0.05);
      vec2 w2 = vWorld.xz * vec2(0.13, 0.07) + vec2(-uTime * 0.07, uTime * 0.1);
      float rip = noise(w1) * noise(w2);
      c += vec3(0.03, 0.1, 0.17) * smoothstep(0.2, 0.55, rip) * (1.0 - smoothstep(2500.0, 9000.0, d));
    }
    // 夜景：岸边灯光在水面上拉出的倒影条。水面上一点映出的是"沿视线再往远处"的灯，
    // 所以从这一点朝远离镜头的方向采样光池贴图（每 40 m 一次，最远约 520 m），越远的灯贡献越弱
    if (uPoolGain > 0.0) {
      vec2 dir = normalize(vWorld.xz - uCam.xz);
      vec3 acc = vec3(0.0);
      for (int k = 1; k <= 20; k++) {
        vec2 q = vWorld.xz + dir * float(k) * 26.0;
        vec2 uv = vec2((q.x - uPoolRect.x) / (uPoolRect.y - uPoolRect.x), (-q.y - uPoolRect.z) / (uPoolRect.w - uPoolRect.z));
        if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) acc += texture2D(uGlint, uv).rgb * exp(-float(k) * 0.45);
      }
      // 波纹把倒影打碎：沿视线方向高频（横向的碎光带）、横向低频
      vec2 side = vec2(-dir.y, dir.x);
      float a = dot(vWorld.xz, dir);
      float b = dot(vWorld.xz, side);
      // 碎光：沿视线方向和横向都是中高频、两层噪声相乘，打成不规则的亮斑（不是一整条扭动的光带）
      float wob = noise(vec2(a * 0.18 - uTime * 0.9, b * 0.12)) * noise(vec2(a * 0.07 + 3.7, b * 0.21 - uTime * 0.4));
      wob = 0.1 + 2.6 * smoothstep(0.12, 0.5, wob);
      c += acc * 1.1 * uPoolGain * wob;
    }
    // 全息：海面扫描网格（160 m 一格，交点更亮，远处淡出）
    if (uGrid > 0.0) {
      vec2 q = vWorld.xz / 160.0;
      vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
      float line = 1.0 - min(min(g.x, g.y), 1.0);
      vec2 g2 = abs(fract(q - 0.5) - 0.5);
      // 交点小光点：半径约 2.5 m（第 29 轮从 0.06 格缩小，原来的光点在总览里约 6 px，显得廉价）
      float dotp = smoothstep(0.016, 0.0, length(g2));
      float fade = 1.0 - smoothstep(1500.0, 9000.0, d);
      c += uGridColor * (line * 0.09 + dotp * 0.9) * uGrid * fade;
    }
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

export function buildSea(theme, pool) {
  const geo = new THREE.PlaneGeometry(80000, 80000, 1, 1)
  geo.rotateX(-Math.PI / 2)
  const mat = new THREE.ShaderMaterial({
    vertexShader: SEA_VERT,
    fragmentShader: SEA_FRAG,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uBase: { value: col(theme.sea.base) },
        uFar: { value: col(theme.sea.far) },
        uRipple: { value: theme.sea.ripple },
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uPool: { value: pool?.texture || null },
        uGlint: { value: pool?.glint || null },
        uPoolRect: {
          value: new THREE.Vector4(GROUND.u0, GROUND.u1, GROUND.v0, GROUND.v1)
        },
        uPoolGain: { value: pool ? 1 : 0 },
        uGrid: { value: theme.sea.grid || 0 },
        uRef: { value: 4200 },
        uGridColor: { value: col(theme.holo?.grid || "#19e3ff") }
      }
    ])
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(1400, 0, 0)
  mesh.renderOrder = -2
  mesh.name = "sea"
  return mesh
}

/* ---------------- 周边岛屿（真实地形 + Sentinel-2 影像） ---------------- */

/**
 * 周边地形：context_h.png 解码成高程网格（每 2 个像素取 1 个顶点），影像按主题调色，
 * 海面部分按掩膜丢弃（海由 buildSea 画）。
 */
export async function buildContext(meta, base, theme) {
  const [hpx, mpx] = await Promise.all([
    loadPixels(base + "smart-port/context_h.png"),
    loadPixels(base + "smart-port/context_mask.png")
  ])
  const tex = await new THREE.TextureLoader().loadAsync(
    base + "smart-port/context.webp"
  )
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  const step = 2
  const nx = Math.floor((meta.width - 1) / step) + 1
  const ny = Math.floor((meta.height - 1) / step) + 1
  const pos = new Float32Array(nx * ny * 3)
  const uv = new Float32Array(nx * ny * 2)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const px = Math.min(meta.width - 1, i * step)
      const py = Math.min(meta.height - 1, j * step)
      const k = (py * meta.width + px) * 4
      const h = (hpx.data[k] * 256 + hpx.data[k + 1]) / 100 - 10
      const u = meta.u[0] + (px + 0.5) * meta.pixel
      const v = meta.v[1] - (py + 0.5) * meta.pixel
      const n = j * nx + i
      pos[n * 3] = u
      pos[n * 3 + 1] = Math.max(h, -1)
      pos[n * 3 + 2] = -v
      uv[n * 2] = (px + 0.5) / meta.width
      uv[n * 2 + 1] = 1 - (py + 0.5) / meta.height
    }
  const idx = []
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i
      // 四个角都是海的格子不建（减少三角形）
      const sea = [a, a + 1, a + nx, a + nx + 1].every((q) => {
        const px = Math.min(meta.width - 1, (q % nx) * step)
        const py = Math.min(meta.height - 1, Math.floor(q / nx) * step)
        return mpx.data[(py * meta.width + px) * 4] < 128
      })
      if (!sea) idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1)
    }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()

  const maskTex = new THREE.CanvasTexture(toCanvas(mpx))
  maskTex.colorSpace = THREE.NoColorSpace
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.95,
    metalness: 0
  })
  const L = theme.land
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uMask = { value: maskTex }
    sh.uniforms.uTint = { value: col(L.tint) }
    sh.uniforms.uMix = { value: L.mix }
    sh.uniforms.uSat = { value: L.sat }
    sh.uniforms.uGain = { value: L.gain }
    sh.uniforms.uNight = { value: theme.lights ? 1 : 0 }
    // 陆域灯点颜色：夜景主题用钠灯暖色；全息主题用冷白蓝（定稿远处陆域是零星蓝白灯，暖色碎点像噪点）
    sh.uniforms.uSodium = {
      value: col(
        theme.holo ? "#7cc8ff" : theme.ground.pool?.sodium || "#000000"
      )
    }
    sh.uniforms.uNightGain = { value: theme.holo ? 0.35 : 1 }
    sh.uniforms.uSpark = { value: theme.holo ? 0.975 : 0.94 }
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D uMask; uniform vec3 uTint; uniform float uMix; uniform float uSat; uniform float uGain;
        uniform float uNight; uniform vec3 uSodium; uniform float uNightGain; uniform float uSpark;`
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        if (texture2D(uMask, vMapUv).r < 0.5) discard;
        // 影像按主题调色：先去饱和，再向主题底色靠拢
        float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        vec3 img = mix(vec3(lum), diffuseColor.rgb, uSat) * uGain;
        float builtLum = lum;
        diffuseColor.rgb = mix(img, uTint * (0.6 + lum), uMix);`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        // 夜景：一至三期码头和小洋山镇区按影像亮度点亮成暖色灯光（亮的地方是水泥地、箱子、屋顶）
        if (uNight > 0.5) {
          // 只点亮影像里最亮的像素（水泥地、屋顶），再用噪声打散成零星灯点，不铺满整片陆地
          float spark = step(uSpark, fract(sin(dot(floor(vMapUv * 2400.0), vec2(12.9898, 78.233))) * 43758.5453));
          totalEmissiveRadiance += uSodium * pow(clamp(builtLum * 3.2 - 0.9, 0.0, 1.0), 2.0) * (0.03 + 1.6 * spark) * uNightGain;
        }`
      )
  }
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = "context"
  mesh.receiveShadow = true
  return mesh
}

function toCanvas(px) {
  const c = document.createElement("canvas")
  c.width = px.w
  c.height = px.h
  const ctx = c.getContext("2d")
  const img = ctx.createImageData(px.w, px.h)
  img.data.set(px.data)
  ctx.putImageData(img, 0, 0)
  return c
}

/* ---------------- 四期码头面 ---------------- */

/** 码头面：OSM 轮廓拉伸成实心台面，顶面贴 canvas 标线贴图，侧面是混凝土护岸 */
export function buildTerminal(site, layout, theme, renderer) {
  const outline = site.terminal
  const shape = new THREE.Shape(
    outline.map(([u, v]) => new THREE.Vector2(u, v))
  )
  const top = new THREE.ShapeGeometry(shape, 1)
  // ShapeGeometry 在 XY 平面：x = u、y = v → 转到 x = u、z = −v
  const p = top.attributes.position
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i)
    const v = p.getY(i)
    p.setXYZ(i, u, TOP, -v)
    uv[i * 2] = (u - GROUND.u0) / (GROUND.u1 - GROUND.u0)
    uv[i * 2 + 1] = (v - GROUND.v0) / (GROUND.v1 - GROUND.v0)
  }
  top.setAttribute("uv", new THREE.BufferAttribute(uv, 2))
  top.computeVertexNormals()
  // 法线朝上（ShapeGeometry 原来朝 +z，转换后朝向取决于绕向）
  const nrm = top.attributes.normal
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0)
  const idx = top.index.array
  for (let i = 0; i < idx.length; i += 3) {
    // 保证正面朝上
    const a = idx[i],
      b = idx[i + 1],
      c = idx[i + 2]
    const ax = p.getX(a),
      az = p.getZ(a)
    const cross =
      (p.getX(b) - ax) * (p.getZ(c) - az) - (p.getZ(b) - az) * (p.getX(c) - ax)
    if (cross > 0) {
      idx[i + 1] = c
      idx[i + 2] = b
    }
  }

  const maxTex = renderer.capabilities.maxTextureSize
  const W = Math.min(8192, maxTex)
  const H = Math.min(2048, maxTex)
  const canvas = document.createElement("canvas")
  canvas.width = W
  canvas.height = H
  drawGround(canvas.getContext("2d"), W, H, site, layout, theme)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  const topMat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.92,
    metalness: 0
  })
  // 全息：标线发光（贴图同时当自发光贴图，亮的标线超过辉光阈值，深色底不发光）
  if (theme.ground.emissive) {
    topMat.emissiveMap = tex
    topMat.emissive = new THREE.Color(1, 1, 1)
    topMat.emissiveIntensity = theme.ground.emissive
  }
  const topMesh = new THREE.Mesh(top, topMat)
  topMesh.receiveShadow = true
  topMesh.name = "terminal_top"

  // 护岸侧墙：从海面下 3 m 到码头面
  const wallPos = []
  const n = outline.length
  for (let i = 0; i < n; i++) {
    const [u0, v0] = outline[i]
    const [u1, v1] = outline[(i + 1) % n]
    wallPos.push(
      u0,
      TOP,
      -v0,
      u1,
      TOP,
      -v1,
      u1,
      -3,
      -v1,
      u0,
      TOP,
      -v0,
      u1,
      -3,
      -v1,
      u0,
      -3,
      -v0
    )
  }
  const wall = new THREE.BufferGeometry()
  wall.setAttribute("position", new THREE.Float32BufferAttribute(wallPos, 3))
  wall.computeVertexNormals()
  const wallMesh = new THREE.Mesh(
    wall,
    new THREE.MeshStandardMaterial({
      color: col(theme.ground.wall),
      roughness: 0.9,
      side: THREE.DoubleSide
    })
  )
  wallMesh.name = "terminal_wall"
  const g = new THREE.Group()
  g.add(topMesh, wallMesh)
  g.userData.texture = tex
  return g
}

/** 在 canvas 上按 u / v 画码头面：底色分带、轨道、车道、箱区垫、交换区、道路 */
function drawGround(ctx, W, H, site, layout, theme) {
  const G = theme.ground
  const sx = W / (GROUND.u1 - GROUND.u0)
  const sy = H / (GROUND.v1 - GROUND.v0)
  const X = (u) => (u - GROUND.u0) * sx
  const Y = (v) => (GROUND.v1 - v) * sy
  const rect = (u0, v0, u1, v1, fill) => {
    ctx.fillStyle = fill
    ctx.fillRect(
      X(Math.min(u0, u1)),
      Y(Math.max(v0, v1)),
      Math.abs(u1 - u0) * sx,
      Math.abs(v1 - v0) * sy
    )
  }
  const line = (pts, color, widthM, dash) => {
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(1, widthM * sx)
    ctx.setLineDash(dash ? dash.map((d) => d * sx) : [])
    ctx.beginPath()
    pts.forEach(([u, v], i) =>
      i ? ctx.lineTo(X(u), Y(v)) : ctx.moveTo(X(u), Y(v))
    )
    ctx.stroke()
    ctx.setLineDash([])
  }

  // 码头面轮廓内铺底色
  ctx.fillStyle = G.concrete
  ctx.beginPath()
  site.terminal.forEach(([u, v], i) =>
    i ? ctx.lineTo(X(u), Y(v)) : ctx.moveTo(X(u), Y(v))
  )
  ctx.closePath()
  ctx.fill()
  ctx.save()
  ctx.clip()

  const B = layout.bands
  const q0 = layout.quay.u0
  const q1 = layout.quay.u1
  const blocks = layout.blocks
  const lastU = blocks[blocks.length - 1].u + 20

  // 前沿与岸桥轨距带
  rect(q0 - 60, B.apron[0], q1 + 40, B.backreach[0], G.apron)
  // AGV 作业区（后伸距、缓冲、车道、海侧交换）
  rect(q0 - 60, B.backreach[0], lastU + 40, B.seaTransfer[1], G.agv)
  // 箱区之间的车道底色（整片陆侧先铺道路色，再画箱区垫）
  rect(q0 - 60, B.seaTransfer[1], lastU + 60, B.road[1], G.road)
  // 前沿边线、系缆桩
  line(
    [
      [q0 - 60, 0.6],
      [q1 + 40, 0.6]
    ],
    G.zebra,
    0.5
  )
  for (let u = q0; u <= q1; u += 24)
    rect(u - 0.6, 1.2, u + 0.6, 2.4, G.lineDark)
  // 岸桥轨道（海侧 v=6、陆侧 v=36，每条两根钢轨）
  for (const v of [layout.qcRail.sea, layout.qcRail.land]) {
    line(
      [
        [q0 - 50, v - 0.5],
        [q1 + 30, v - 0.5]
      ],
      G.rail,
      0.25
    )
    line(
      [
        [q0 - 50, v + 0.5],
        [q1 + 30, v + 0.5]
      ],
      G.rail,
      0.25
    )
  }
  // 陆侧轨后的电缆沟
  rect(q0 - 50, B.qc[1] + 1.5, q1 + 30, B.backreach[0] - 0.5, G.edge)
  // 后伸距交接带：岸桥下 AGV 停靠车道（虚线）
  for (const v of [47, 55, 63])
    line(
      [
        [q0, v],
        [q1, v]
      ],
      G.line,
      0.18,
      [6, 6]
    )
  // 缓冲停车带：垂直车位，间距 4.5 m
  line(
    [
      [q0, B.buffer[0]],
      [lastU, B.buffer[0]]
    ],
    G.line,
    0.2
  )
  line(
    [
      [q0, B.buffer[1]],
      [lastU, B.buffer[1]]
    ],
    G.line,
    0.2
  )
  for (let u = q0 + 10; u < lastU - 10; u += 4.5)
    line(
      [
        [u, B.buffer[0]],
        [u, B.buffer[1]]
      ],
      G.lineDark,
      0.12
    )
  // 行驶车道分隔（虚线）与方向箭头
  const lanes = layout.agvLanes
  const lw = (B.lanes[1] - B.lanes[0]) / lanes.length
  for (let i = 0; i <= lanes.length; i++) {
    const v = B.lanes[0] + i * lw
    line(
      [
        [q0 - 40, v],
        [lastU + 30, v]
      ],
      i === 0 || i === lanes.length ? G.line : G.lineDark,
      0.16,
      i === 0 || i === lanes.length ? null : [4, 8]
    )
  }
  // 箱区：垫面、两侧轨道、海侧交换区支架、陆侧交换区车位
  for (const b of blocks) {
    const half = 14.5
    rect(b.u - half, B.yard[0], b.u + half, b.v1, b.reefer ? G.pad : G.yard)
    // 轨道吊轨道（轨距 31 m）
    for (const s of [-1, 1])
      line(
        [
          [b.u + s * 15.5, B.seaTransfer[0]],
          [b.u + s * 15.5, b.v1 + 22]
        ],
        G.rail,
        0.3
      )
    // 20 尺箱位格线（淡）
    for (let v = B.yard[0] + 6.1; v < b.v1; v += 6.1)
      line(
        [
          [b.u - half, v],
          [b.u + half, v]
        ],
        G.edge,
        0.08
      )
    // 海侧交换区：AGV 支架（每区 5 个）
    for (let k = 0; k < 5; k++) {
      const u = b.u - 11 + k * 5.5
      rect(
        u - 1.4,
        B.seaTransfer[0] + 3,
        u + 1.4,
        B.seaTransfer[1] - 3,
        G.lineDark
      )
      rect(
        u - 1.0,
        B.seaTransfer[0] + 3.5,
        u + 1.0,
        B.seaTransfer[1] - 3.5,
        G.agv
      )
    }
    // 陆侧交换区：外集卡车位（5 道）
    for (let k = 0; k <= 5; k++)
      line(
        [
          [b.u - 13 + k * 5.2, b.v1 + 2],
          [b.u - 13 + k * 5.2, b.v1 + 20]
        ],
        G.line,
        0.14
      )
  }
  // 箱区组间纵向车道中线（AGV 驶入悬臂下方）
  for (let i = 1; i < blocks.length; i++) {
    const a = blocks[i - 1]
    const b = blocks[i]
    if (b.group !== a.group) {
      const u = (a.u + b.u) / 2
      line(
        [
          [u, B.seaTransfer[1]],
          [u, Math.max(a.v1, b.v1) + 20]
        ],
        G.line,
        0.18,
        [5, 7]
      )
    }
  }
  // 陆侧集卡主干道：中线与边线
  line(
    [
      [q0 - 40, B.road[0]],
      [lastU + 60, B.road[0]]
    ],
    G.line,
    0.2
  )
  line(
    [
      [q0 - 40, (B.road[0] + B.road[1]) / 2],
      [lastU + 60, (B.road[0] + B.road[1]) / 2]
    ],
    G.lineDark,
    0.2,
    [8, 10]
  )
  // OSM 道路（港区内的环路、匝道）
  for (const r of site.roads) {
    const inTerm = r.pts.some(
      ([u, v]) =>
        u > GROUND.u0 && u < GROUND.u1 && v > B.road[0] - 20 && v < GROUND.v1
    )
    if (!inTerm) continue
    line(
      r.pts,
      G.road,
      r.kind === "motorway" || r.kind === "secondary" ? 14 : 8
    )
  }
  // 危险品 / 超限箱区：斜纹围合
  for (const s of layout.special) {
    rect(s.u0, s.v0, s.u1, s.v1, G.pad)
    ctx.save()
    ctx.beginPath()
    ctx.rect(X(s.u0), Y(s.v1), (s.u1 - s.u0) * sx, (s.v1 - s.v0) * sy)
    ctx.clip()
    for (let k = -400; k < 400; k += 9)
      line(
        [
          [s.u0 + k, s.v0],
          [s.u0 + k + 240, s.v1]
        ],
        G.zebra,
        0.6
      )
    ctx.restore()
    line(
      [
        [s.u0, s.v0],
        [s.u1, s.v0],
        [s.u1, s.v1],
        [s.u0, s.v1],
        [s.u0, s.v0]
      ],
      G.mark,
      0.5
    )
  }
  // 换电站地坪
  for (const st of layout.swapStations) rect(st.u0, st.v0, st.u1, st.v1, G.pad)
  ctx.restore()
}

/* ---------------- 夜景光池 ---------------- */

/**
 * 俯视光池贴图（u / v 平面）：高杆钠灯（暖）沿 AGV 带、箱区两端、主干道布置，岸桥下 LED（冷白）跟着岸桥位置。
 * 场景里所有材质按世界坐标采样它作为自发光（见 PortScene.addPoolLight），海面用它画倒影条。
 */
export class PoolLight {
  constructor(layout, theme) {
    this.layout = layout
    this.theme = theme
    this.canvas = document.createElement("canvas")
    this.canvas.width = 2048
    this.canvas.height = 512
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    // 海面倒影用的"闪光点"贴图：只有点状灯（前沿灯、岸桥 LED、前排高杆灯头），每个点沿 v 拉长成窄条，
    // 海面沿视线采样它，得到一条条细长的倒影（光池贴图的光斑太大，倒影会糊成一片）
    this.glintCanvas = document.createElement("canvas")
    this.glintCanvas.width = 2048
    this.glintCanvas.height = 256
    this.glint = new THREE.CanvasTexture(this.glintCanvas)
    this.glint.colorSpace = THREE.SRGBColorSpace
    // 高杆灯位置（[u, v, 亮度, 半径]）：AGV 带与箱区海侧之间每 72 m 一根；箱区组间车道里沿 v 每 110 m 一根（覆盖箱区内部）；
    // 陆侧交换区外侧每隔几个箱区一根；主干道每 90 m 一根（路灯较暗）
    const B = layout.bands
    const masts = []
    for (let u = 20; u < layout.quay.u1 + 120; u += 72)
      masts.push([u, B.lanes[0] - 1, 0.9, 50])
    const bl = layout.blocks
    for (let i = 1; i < bl.length; i++)
      if (bl[i].group !== bl[i - 1].group) {
        const u = (bl[i].u + bl[i - 1].u) / 2
        const top = Math.max(bl[i].v1, bl[i - 1].v1)
        for (let v = B.yard[0] + 60; v < top; v += 110)
          masts.push([u, v, 0.75, 78])
      }
    for (const b of bl)
      if (b.id.endsWith("1") || b.id.endsWith("5"))
        masts.push([b.u + 18, b.v1 + 24, 0.7, 55])
    for (let u = 0; u < 2900; u += 90) masts.push([u, B.road[1] + 4, 0.3, 36])
    this.masts = masts
    // 码头前沿的暖色灯带：每 36 m 一盏低位灯（定稿里沿岸线一串橙黄光斑，海面上拉出倒影）
    const front = []
    for (let u = 12; u < layout.quay.u1; u += 36) front.push([u, 3])
    this.front = front
  }

  /** 按岸桥当前位置重画（岸桥移动后调用） */
  draw(craneUs = []) {
    const ctx = this.canvas.getContext("2d")
    const W = this.canvas.width
    const H = this.canvas.height
    const sx = W / (GROUND.u1 - GROUND.u0)
    const sy = H / (GROUND.v1 - GROUND.v0)
    const X = (u) => (u - GROUND.u0) * sx
    const Y = (v) => (GROUND.v1 - v) * sy
    ctx.globalCompositeOperation = "source-over"
    ctx.fillStyle = "#000"
    ctx.fillRect(0, 0, W, H)
    ctx.globalCompositeOperation = "lighter"
    const pool = (u, v, r, color, a) => {
      const g = ctx.createRadialGradient(X(u), Y(v), 0, X(u), Y(v), r * sx)
      const c = new THREE.Color(color)
      const rgba = (k) =>
        `rgba(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0},${k})`
      g.addColorStop(0, rgba(a))
      g.addColorStop(0.45, rgba(a * 0.45))
      g.addColorStop(1, rgba(0))
      ctx.fillStyle = g
      ctx.save()
      // 光池在 v 方向按贴图比例压扁，保证在地面上是圆的
      ctx.translate(X(u), Y(v))
      ctx.scale(1, sy / sx)
      ctx.translate(-X(u), -Y(v))
      ctx.beginPath()
      ctx.arc(X(u), Y(v), r * sx, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    const P = this.theme.ground.pool
    for (const [u, v, k, r] of this.masts) pool(u, v, r, P.sodium, 0.85 * k)
    for (const [u, v] of this.front) pool(u, v, 15, P.sodium, 0.8)
    this.drawGlint(craneUs)
    // 岸桥下 LED：海侧到后伸距一整条，冷白
    for (const u of craneUs) {
      pool(u, 20, 26, P.led, 0.7)
      pool(u, 52, 22, P.led, 0.5)
      pool(u, -30, 30, P.led, 0.35)
    }
    this.texture.needsUpdate = true
  }

  /** 倒影闪光点：前沿暖灯（每三盏一盏）、作业岸桥主梁下冷白 LED（窄、沿 v 拉长 30 m） */
  drawGlint(craneUs) {
    const ctx = this.glintCanvas.getContext("2d")
    const W = this.glintCanvas.width
    const H = this.glintCanvas.height
    const sx = W / (GROUND.u1 - GROUND.u0)
    const sy = H / (GROUND.v1 - GROUND.v0)
    ctx.globalCompositeOperation = "source-over"
    ctx.fillStyle = "#000"
    ctx.fillRect(0, 0, W, H)
    ctx.globalCompositeOperation = "lighter"
    const P = this.theme.ground.pool
    const dot = (u, v, color, a, ru = 7) => {
      const c = new THREE.Color(color)
      ctx.fillStyle = `rgba(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0},${a})`
      ctx.beginPath()
      ctx.ellipse(
        (u - GROUND.u0) * sx,
        (GROUND.v1 - v) * sy,
        Math.max(1, ru * sx),
        Math.max(1, 30 * sy),
        0,
        0,
        Math.PI * 2
      )
      ctx.fill()
    }
    // 前沿灯每三盏取一盏、亮度错落（全取的话倒影排成整齐的栅栏）
    this.front.forEach(([u, v], i) => {
      if (i % 3) return
      const k = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1
      dot(u, v + 8, P.sodium, 0.45 + 0.5 * k)
    })
    for (const u of craneUs) dot(u, 20, P.led, 0.9, 8)
    this.glint.needsUpdate = true
  }
}

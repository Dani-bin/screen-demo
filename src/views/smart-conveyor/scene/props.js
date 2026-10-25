/*
 * 煤仓、综采工作面、地面建筑
 * ----------------------------------------------------------
 * 位置全部来自 data/section.json（定稿概念图反投影），尺寸是示意尺度（竖向放大）。
 * - 煤仓：透明玻璃筒（菲涅尔青边）+ 煤柱（高度 = 煤位）+ 煤面琥珀光盘 + 进煤时的落煤光流
 * - 综采面：一排液压支架（实例化）+ 采煤机（随仿真的割煤位置移动）+ 暖色工作光
 * - 地面：驱动机房、转载点、栈桥桁架、原煤仓（立式钢仓）、低矮建筑、路灯；建筑带青色描边
 */
import * as THREE from "three"
import { THEME, TOKENS } from "./theme.js"
import { SECTION, GALLERY } from "./section.js"

const glass = () =>
  new THREE.ShaderMaterial({
    uniforms: { uRim: { value: new THREE.Color(TOKENS.data) } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uRim; varying vec3 vN; varying vec3 vV;
      void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); vec3 c = uRim * (0.008 + pow(f, 3.0) * 0.18);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`
  })

/**
 * 煤仓半径修正：fit_camera.py 按仓壁两侧像素反投影出的 MC01 半径偏大，主机位下比定稿宽约 40 %
 * （第 11 阶段比对：定稿 62 px、实现 89 px）；按定稿量取的宽度缩小。MC02 吻合，不改
 */
const R_FIX = { MC01: 0.7 }

/** 一个煤仓 */
function bunker({ x, z, top, bottom, r }) {
  const g = new THREE.Group()
  const h = top - bottom
  // 玻璃筒 + 上下圆顶边环
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, h, 40, 1, true),
    glass()
  )
  shell.position.set(x, bottom + h / 2, z)
  shell.renderOrder = 6
  g.add(shell)
  for (const y of [top, bottom]) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r, 2.2, 6, 48),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(TOKENS.data).multiplyScalar(0.35),
        toneMapped: false
      })
    )
    ring.rotation.x = Math.PI / 2
    ring.position.set(x, y, z)
    g.add(ring)
  }
  // 漏斗（仓底）
  const funnel = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.92, r * 0.25, r * 0.6, 32, 1, true),
    new THREE.MeshStandardMaterial({
      color: "#20262f",
      roughness: 0.7,
      metalness: 0.4,
      side: THREE.DoubleSide
    })
  )
  funnel.position.set(x, bottom + r * 0.3, z)
  g.add(funnel)
  // 煤柱：单位高度的圆柱，按煤位缩放
  // 块煤：世界坐标上的蜂窝噪声做出一块块的煤，煤面附近被仓内琥珀光照亮，往下渐暗；个别块煤边缘有高光
  const coalMat = new THREE.ShaderMaterial({
    uniforms: {
      uSurf: { value: bottom + h * 0.4 }, // 煤面高度（setLevel 更新）
      uWarm: { value: new THREE.Color(TOKENS.coal2) },
      uR: { value: r }
    },
    vertexShader: `varying vec3 vW; varying vec3 vN;
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uSurf, uR; uniform vec3 uWarm; varying vec3 vW; varying vec3 vN;
      vec2 hash2(vec2 p){ p = vec2(dot(p, vec2(127.1,311.7)), dot(p, vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }
      // 蜂窝噪声：到最近 / 次近种子点的距离（块煤的轮廓）
      vec2 cell(vec2 p){ vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
        for (int y=-1; y<=1; y++) for (int x=-1; x<=1; x++){ vec2 g = vec2(x,y); vec2 o = hash2(i+g);
          float d = length(g + o - f); if (d < d1){ d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
        return vec2(d1, d2); }
      void main(){
        vec2 p = vec2(vW.x + vW.z, vW.y) / (uR * 0.22);
        vec2 c = cell(p);
        float edge = smoothstep(0.02, 0.2, c.y - c.x);        // 块与块之间的暗缝
        float face = 0.55 + 0.45 * hash2(floor(p)).x;          // 每块的明暗
        // 离煤面越近越亮（仓内暖光从上面照下来）
        float k = exp(-max(0.0, uSurf - vW.y) / (uR * 0.9));
        vec3 base = vec3(0.07, 0.065, 0.06) * face * edge;
        vec3 warm = uWarm * (0.15 + 1.25 * k) * face * edge * (0.6 + 0.4 * max(0.0, vN.y));
        gl_FragColor = vec4(base + warm * 0.3, 1.0);
        #include <colorspace_fragment>
      }`
  })
  const coal = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.9, r * 0.9, 1, 32),
    coalMat
  )
  coal.position.set(x, bottom, z)
  g.add(coal)
  // 煤堆尖顶 + 煤面琥珀光盘
  const heap = new THREE.Mesh(
    new THREE.ConeGeometry(r * 0.9, r * 0.55, 32),
    coalMat
  )
  g.add(heap)
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(r * 0.95, 40),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(TOKENS.coal).multiplyScalar(1.4),
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    })
  )
  disc.rotation.x = -Math.PI / 2
  g.add(disc)
  // 落煤光流（仓顶进煤口 → 煤面）
  const stream = new THREE.Mesh(
    new THREE.CylinderGeometry(4, 6, 1, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(TOKENS.coal).multiplyScalar(2.4),
      toneMapped: false
    })
  )
  g.add(stream)
  // 仓内暖光：挂在煤面上方，照亮煤堆上半部（定稿里煤仓内部是琥珀色辉光）
  const warm = new THREE.PointLight(TOKENS.coal, 6, r * 5, 1.2)
  g.add(warm)
  const setLevel = (level, inflow) => {
    const hl = Math.max(4, h * Math.min(1, level) - r * 0.4)
    coal.scale.y = hl
    coal.position.y = bottom + r * 0.6 + hl / 2 - r * 0.3
    const surf = bottom + r * 0.3 + hl
    heap.position.set(x, surf + r * 0.27, z)
    disc.position.set(x, surf + 1, z)
    coalMat.uniforms.uSurf.value = surf + r * 0.55
    warm.position.set(x, surf + r * 0.9, z)
    const len = Math.max(1, top - surf - r * 0.5)
    stream.visible = inflow > 5
    stream.scale.y = len
    stream.position.set(x, top - len / 2, z)
  }
  setLevel(0.4, 0)
  return { group: g, setLevel, top: new THREE.Vector3(x, top, z) }
}

/** 综采工作面：一排液压支架 + 采煤机 + 暖色工作光 */
function longwall(face) {
  const [a, b0] = face.map((p) => new THREE.Vector3(...p))
  // 第 11 阶段按定稿量取：支架排只占反投影出的工作面线的前 90 %（右端留给 BC05 转载点），整体上移 50
  const b = a.clone().lerp(b0, 0.9)
  a.y += 50
  b.y += 50
  const g = new THREE.Group()
  // 定稿里工作面是岩块里一段被暖光照亮的空腔，十来架支架的暗色剪影排成一排；示意尺度，比真实大很多
  const n = 12
  const H = 150
  const span = b.x - a.x
  // 支架：暗色钢，主要靠背后空腔的暖光衬出剪影
  const dark = new THREE.MeshStandardMaterial({
    color: "#2c3036",
    roughness: 0.55,
    metalness: 0.6
  })
  const legGeo = new THREE.CylinderGeometry(7, 8, H * 0.62, 10)
  const canopyGeo = new THREE.BoxGeometry(66, 10, 130)
  const baseGeo = new THREE.BoxGeometry(60, 18, 110)
  // 掩护梁：从顶梁后端斜向下接到底座后端，支架侧面看是一个"人"字形
  const shieldGeo = new THREE.BoxGeometry(60, 8, H * 0.7)
  const legs = new THREE.InstancedMesh(legGeo, dark, n * 2)
  const canopies = new THREE.InstancedMesh(canopyGeo, dark, n)
  const bases = new THREE.InstancedMesh(baseGeo, dark, n)
  const shields = new THREE.InstancedMesh(shieldGeo, dark, n)
  // 每架顶梁下一盏照明灯（亮点，进辉光）
  const lamps = new THREE.InstancedMesh(
    new THREE.SphereGeometry(6, 10, 8),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color("#ffc27a").multiplyScalar(3.2),
      toneMapped: false
    }),
    n
  )
  // 支架按 K 倍放大（定稿里工作面空腔约占岩块高度的六分之一，第 11 阶段按定稿量取），实例矩阵 = 平移 × 放大
  const K = 1.9
  const m = new THREE.Matrix4()
  const one = new THREE.Quaternion()
  const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.85, 0, 0))
  const scale = new THREE.Vector3(K, K, K)
  const place = (mesh, i, p, dy, dz, q = one) => {
    m.compose(new THREE.Vector3(p.x, p.y + dy * K, p.z + dz * K), q, scale)
    mesh.setMatrixAt(i, m)
  }
  for (let i = 0; i < n; i++) {
    const p = a.clone().lerp(b, (i + 0.5) / n)
    const y0 = -H * 0.45
    place(bases, i, p, y0 + 9, -10)
    place(canopies, i, p, y0 + H * 0.88, 0)
    place(legs, i * 2, p, y0 + H * 0.45, 18)
    place(legs, i * 2 + 1, p, y0 + H * 0.45, -22)
    place(shields, i, p, y0 + H * 0.55, -72, tilt)
    place(lamps, i, p, y0 + H * 0.8, 40)
  }
  g.add(legs, canopies, bases, shields, lamps)
  // 工作面空腔：只画内壁的盒子（BackSide），从镜头看进去是岩块里切开的一段巷道：
  // 底板和后壁被暖光照亮（支架之间亮、支架处暗），顶板偏暗，两端淡出；支架在前面成剪影
  const CH = H * K * 0.95 // 空腔高
  const CD = 150 * K // 空腔进深
  const cavity = new THREE.Mesh(
    new THREE.BoxGeometry(span - 120, CH, CD),
    new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color("#ff9a3c") },
        uSize: { value: new THREE.Vector3(span + 160, CH, CD) },
        uFade: { value: 1 } // 镜头靠近时淡出（近看空腔的内壁是大块橙色平面）
      },
      side: THREE.BackSide,
      // 画在半透明岩块之后、盖在它上面：看起来是岩块被切开露出巷道（不写深度，支架仍挡在它前面）
      transparent: true,
      depthWrite: false,
      vertexShader: `varying vec3 vL; void main(){ vL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uColor, uSize; uniform float uFade; varying vec3 vL;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main(){
          vec3 q = vL / uSize + 0.5; // 0…1
          // 竖向：底部最亮、顶板暗
          float v = mix(1.0, 0.18, smoothstep(0.1, 0.95, q.y));
          // 进深：后壁亮一点
          v *= mix(0.65, 1.0, 1.0 - q.z);
          // 两端淡出
          float h = smoothstep(0.0, 0.1, q.x) * smoothstep(1.0, 0.92, q.x);
          // 支架节奏：12 架
          float bay = 0.55 + 0.45 * cos((q.x - 0.5 / 12.0) * 6.2832 * 12.0);
          // 岩面颗粒
          float n = 0.75 + 0.5 * hash(floor(vL.xy / 9.0) + floor(vL.zz / 9.0));
          gl_FragColor = vec4(uColor * v * h * bay * n * 2.2, uFade);
          #include <colorspace_fragment>
        }`
    })
  )
  // 空腔比支架排略短、略偏机尾（定稿里工作面右端接 BC05，空腔不越过转载点）
  cavity.position.set(
    (a.x + b.x) / 2 - 60,
    a.y - H * 0.45 * K + CH / 2,
    a.z - CD / 2 + 60 * K
  )
  cavity.renderOrder = 2
  g.add(cavity)
  // 煤壁（左端）与采空区碎石：一堆暗色多面体
  const rubbleGeo = new THREE.DodecahedronGeometry(1, 0)
  const rubbleMat = new THREE.MeshStandardMaterial({
    color: "#2a2620",
    roughness: 1,
    emissive: "#3a2410",
    emissiveIntensity: 0.15
  })
  const rubble = new THREE.InstancedMesh(rubbleGeo, rubbleMat, 70)
  for (let i = 0; i < 70; i++) {
    const r = 12 + ((i * 37) % 23)
    const x = a.x - 40 - ((i * 53) % 260)
    const y =
      a.y - H * 0.45 * K + ((i * 29) % 120) * (1 - ((i * 53) % 260) / 300)
    m.compose(
      new THREE.Vector3(x, y, a.z - 20 + ((i * 17) % 60) - 30),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(i, i * 2, i * 3)),
      new THREE.Vector3(r, r * 0.8, r)
    )
    rubble.setMatrixAt(i, m)
  }
  g.add(rubble)
  // 采煤机：机身 + 两个滚筒
  const shearer = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(110, 34, 40), dark)
  shearer.add(body)
  const drumMat = new THREE.MeshStandardMaterial({
    color: "#c79a52",
    roughness: 0.45,
    metalness: 0.7,
    emissive: "#3a2508",
    emissiveIntensity: 0.6
  })
  for (const dx of [-70, 70]) {
    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(26, 26, 26, 18),
      drumMat
    )
    drum.rotation.x = Math.PI / 2
    drum.position.set(dx, 6, 0)
    shearer.add(drum)
  }
  shearer.scale.setScalar(K)
  shearer.position.copy(a).add(new THREE.Vector3(0, -H * 0.3 * K, 40 * K))
  g.add(shearer)
  // 暖色工作光（不投影）
  const lights = []
  for (const k of [0.15, 0.5, 0.85]) {
    const l = new THREE.PointLight("#ffb46b", 0.6, 700, 1.1)
    lights.push(l)
    l.position.copy(a.clone().lerp(b, k)).add(new THREE.Vector3(0, 40, 120))
    g.add(l)
  }
  const center = a.clone().lerp(b, 0.5)
  return {
    group: g,
    /** 按镜头到工作面中心的距离淡出空腔和工作光（2.5 km 外全亮，1.2 km 内全暗） */
    fade(camPos) {
      const d = camPos.distanceTo(center)
      const k = Math.min(1, Math.max(0, (d - 1200) / 1300))
      cavity.material.uniforms.uFade.value = k
      cavity.visible = k > 0.01
      for (const l of lights) l.intensity = 0.6 * k
    },
    /** f = 采煤机在工作面上的位置 0…1（null = 不在割煤，停在端头） */
    setShearer(f) {
      const k = f == null ? 0.04 : f
      shearer.position.x = a.x + (b.x - a.x) * k
    }
  }
}

/** 地面厂房：灰色墙板（竖向压型板的明暗条纹）+ 深色屋面 + 一排小窗暖光；只留很淡的青色轮廓 */
function building(w, h, d, color = THEME.surface.building) {
  const g = new THREE.Group()
  const geo = new THREE.BoxGeometry(w, h, d)
  geo.translate(0, h / 2, 0)
  // 墙板：按世界坐标画竖向压型板的细条纹；顶面（屋面）更暗
  const wall = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) } },
    vertexShader: `varying vec3 vW; varying vec3 vN;
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uColor; varying vec3 vW; varying vec3 vN;
      void main(){
        float rib = 0.85 + 0.15 * step(0.5, fract((vW.x + vW.z) / 6.0));
        float lit = 0.55 + 0.45 * max(0.0, dot(vN, normalize(vec3(-0.3, 0.6, 0.75))));
        vec3 c = uColor * rib * lit;
        c = mix(c, uColor * 0.45, step(0.9, vN.y));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`
  })
  g.add(new THREE.Mesh(geo, wall))
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({
      color: new THREE.Color(TOKENS.data),
      transparent: true,
      opacity: 0.12
    })
  )
  g.add(edges)
  // 一排小窗（暖光），窗数按宽度
  const n = Math.max(2, Math.round(w / 22))
  const winMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color("#ffd9a0").multiplyScalar(1.3),
    toneMapped: false
  })
  for (let i = 0; i < n; i++) {
    const win = new THREE.Mesh(
      new THREE.PlaneGeometry((w / n) * 0.45, h * 0.12),
      winMat
    )
    win.position.set(-w / 2 + (w / n) * (i + 0.5), h * 0.6, d / 2 + 0.5)
    g.add(win)
  }
  return g
}

/** 地面：驱动机房、转载点、栈桥、原煤仓、低矮建筑、路灯 */
function surface(block) {
  const S = SECTION.surface
  const g = new THREE.Group()
  const H = block.H
  // 地面建筑整体放大（定稿里地面设施画得比井下醒目，示意尺度）
  const SURF = 1.8
  // 驱动机房：摆在主斜井斜廊的顶端（斜廊沿主斜井最后一段坡度延长 GALLERY，见 section.js）
  const gal = (() => {
    const P = SECTION.belts.BC02
    const [a, b] = P.slice(-2)
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const len = Math.hypot(...d)
    return d.map((v, i) => b[i] + (v / len) * GALLERY)
  })()
  const dh = [gal[0] - 20, S.driveHouse[1], S.driveHouse[2]]
  const drive = building(110, 70, 70)
  drive.scale.setScalar(SURF)
  drive.position.set(dh[0], H, dh[2])
  g.add(drive)
  // 驱动机房上的转载塔
  const tower = building(40, 120, 40)
  tower.scale.setScalar(SURF)
  tower.position.set(dh[0] + 40 * SURF, H, dh[2])
  g.add(tower)
  // 原煤仓：立式钢仓
  const ms = S.MC03
  const silo = new THREE.Group()
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(58, 58, 170, 40),
    new THREE.MeshStandardMaterial({
      color: "#454c55",
      roughness: 0.35,
      metalness: 0.85
    })
  )
  shell.position.y = 85
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(62, 34, 40),
    new THREE.MeshStandardMaterial({
      color: "#6d747e",
      roughness: 0.4,
      metalness: 0.8
    })
  )
  roof.position.y = 187
  silo.add(shell, roof)
  // 钢仓的竖向加劲肋（细线）
  const ribs = new THREE.LineSegments(
    new THREE.EdgesGeometry(
      new THREE.CylinderGeometry(58.5, 58.5, 170, 20, 4, true)
    ),
    new THREE.LineBasicMaterial({
      color: "#c7ced6",
      transparent: true,
      opacity: 0.25
    })
  )
  ribs.position.y = 85
  silo.add(ribs)
  // 钢仓横向放大、竖向少放大一点（定稿里原煤仓矮胖）
  // 定稿里原煤仓是远处一根细高的筒仓，不抢主斜井井口：横向缩小、竖向保持
  silo.scale.set(SURF * 0.45, SURF * 0.7, SURF * 0.45)
  silo.position.set(ms[0], H, ms[2])
  g.add(silo)
  // 低矮建筑
  const sizes = [
    [70, 32, 46],
    [90, 40, 50],
    [60, 26, 40],
    [50, 22, 36]
  ]
  S.lowBuildings.forEach((p, i) => {
    const [w, h, d] = sizes[i % sizes.length]
    const b = building(w, h, d)
    b.scale.setScalar(SURF)
    b.position.set(p[0], H, p[2] + (i % 2 ? 60 : -40))
    g.add(b)
  })
  // 集控中心（低矮建筑之一，略大）
  const cr = S.controlRoom
  const ctrl = building(100, 38, 60, "#232b36")
  ctrl.scale.setScalar(SURF)
  ctrl.position.set(cr[0], H, cr[2] + 30)
  g.add(ctrl)
  // 栈桥桁架：上下弦 + 斜腹杆 + 立柱
  const bc1 = SECTION.belts.BC01.map((p) => new THREE.Vector3(...p))
  const [p0, p1] = bc1
  const dir = p1.clone().sub(p0)
  const len = dir.length()
  const steelLine = new THREE.LineBasicMaterial({
    color: "#aeb6bf",
    transparent: true,
    opacity: 0.7
  })
  const pts = []
  const n = 10
  for (let i = 0; i <= n; i++) {
    const c = p0.clone().addScaledVector(dir, i / n)
    // 立柱
    if (i % 2 === 0)
      pts.push(
        new THREE.Vector3(c.x, H, c.z),
        new THREE.Vector3(c.x, c.y - 8, c.z)
      )
    if (i < n) {
      const d2 = p0.clone().addScaledVector(dir, (i + 1) / n)
      pts.push(
        new THREE.Vector3(c.x, c.y + 14, c.z),
        new THREE.Vector3(d2.x, d2.y + 14, d2.z)
      )
      pts.push(
        new THREE.Vector3(c.x, c.y - 8, c.z),
        new THREE.Vector3(d2.x, d2.y - 8, d2.z)
      )
      pts.push(
        new THREE.Vector3(c.x, c.y - 8, c.z),
        new THREE.Vector3(d2.x, d2.y + 14, d2.z)
      )
    }
  }
  g.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      steelLine
    )
  )
  // 路灯
  const lampMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(THEME.surface.lamp).multiplyScalar(1.3),
    toneMapped: false
  })
  const poleMat = new THREE.MeshStandardMaterial({
    color: "#3a3f46",
    roughness: 0.6,
    metalness: 0.6
  })
  for (const x of [
    dh[0] - 160,
    dh[0] + 120,
    ms[0] - 110,
    ms[0] + 90,
    cr[0] - 80
  ]) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(2, 2.6, 90, 6),
      poleMat
    )
    pole.position.set(x, H + 45, dh[2] + 90)
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), lampMat)
    bulb.position.set(x, H + 94, dh[2] + 90)
    g.add(pole, bulb)
  }
  void len
  return {
    group: g,
    // 钢仓竖向只放大 0.6 × SURF（见上），仓顶跟着降
    siloTop: new THREE.Vector3(ms[0], H + 200 * SURF * 0.7, ms[2]),
    drive: new THREE.Vector3(dh[0], H + 80 * SURF, dh[2])
  }
}

export class Props {
  constructor(scene) {
    this.group = new THREE.Group()
    scene.add(this.group)
    const block = SECTION.block
    this.bunkers = {}
    for (const [id, b] of Object.entries(SECTION.bunkers)) {
      const k = bunker({ ...b, r: b.r * (R_FIX[id] || 1) })
      k.group.userData.pick = id
      this.bunkers[id] = k
      this.group.add(k.group)
    }
    this.face = longwall(SECTION.face)
    this.group.add(this.face.group)
    this.surface = surface(block)
    this.group.add(this.surface.group)
  }

  setState(s) {
    const inflow = { MC01: s.belts.BC04.flowOut, MC02: s.belts.BC03.flowOut }
    for (const [id, k] of Object.entries(this.bunkers))
      k.setLevel(s.bunkers[id].level, inflow[id])
    this.face.setShearer(s.faces.WF12301.shearer)
  }
}

/*
 * 地层块：定稿里切开的半透明石墨色岩块
 * ----------------------------------------------------------
 * - 正面、右侧面、左端面、底面：自定义着色器，按世界坐标画起伏的岩层带（含一层更暗的煤层）、
 *   岩层分界的细亮线、极淡的等高线，以及块边缘的冷青色高光；半透明，画在巷道和皮带之后（能透过去看到里面）
 * - 顶面：起伏的暗色地表（不透明），地面建筑立在上面
 * 尺寸来自 data/section.json 的 block（W × H × D，示意尺度，竖向已放大）。
 */
import * as THREE from "three"
import { THEME } from "./theme.js"

const GLSL_NOISE = `
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a*noise(p); p *= 2.03; a *= 0.5; } return s; }
`

/** 岩层面的起伏：按 x、z 的平滑起伏把 y 推一推，所有岩层分界线一起起伏 */
const GLSL_WARP = `
  float warpY(vec3 w){
    return w.y + 38.0*sin(w.x/820.0 + w.z/260.0) + 22.0*sin(w.x/310.0 + 1.7) + 30.0*(fbm(w.xz/900.0) - 0.5);
  }
`

export function buildStrata(block, seamY) {
  const { W, H, D } = block
  const group = new THREE.Group()
  const s = THEME.strata
  const uniforms = {
    uBase: { value: new THREE.Color(s.base) },
    uBand: { value: new THREE.Color(s.band) },
    uSeam: { value: new THREE.Color(s.seam) },
    uLine: { value: new THREE.Color(s.line) },
    uEdge: { value: new THREE.Color(s.edge) },
    uSize: { value: new THREE.Vector3(W, H, D) },
    uSeamY: { value: seamY },
    uOpacity: { value: s.opacity }
  }
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    vertexShader: `
      varying vec3 vW; varying vec3 vN;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform vec3 uBase, uBand, uSeam, uLine, uEdge, uSize; uniform float uSeamY, uOpacity;
      varying vec3 vW; varying vec3 vN;
      ${GLSL_NOISE}
      ${GLSL_WARP}
      void main(){
        float y = warpY(vW);
        // 岩层带：每层 90–170 m 厚，颜色在底色和浅带之间交替，加一点纹理
        float layer = y / 128.0;
        float idx = floor(layer);
        float k = hash(vec2(idx, 3.0));
        vec3 col = mix(uBase, uBand, 0.35 + 0.5*k);
        // 岩石纹理：大尺度明暗 + 细碎颗粒（定稿里的岩面是粗糙的深灰岩石，不是平的玻璃）
        // 面内坐标：正面 / 背面用 (x, y)，两个端面用 (z, y)
        vec2 pl = abs(vN.x) > 0.5 ? vec2(vW.z, vW.y) : vW.xy;
        float rock = fbm(pl/140.0) * 0.55 + fbm(pl/45.0) * 0.3 + fbm(pl/14.0) * 0.15;
        // 假凹凸：对纹理求差分当法线，左上方来光，岩面才有起伏的明暗
        float dx = fbm((pl + vec2(6.0, 0.0))/45.0) - fbm(pl/45.0);
        float dy = fbm((pl + vec2(0.0, 6.0))/45.0) - fbm(pl/45.0);
        float bump = clamp(0.8 + (-dx*0.7 + dy*1.0) * 6.0, 0.45, 1.35);
        col *= (0.72 + 0.45*rock) * mix(1.0, bump, 0.5);
        // 竖向明暗：越往深处越暗（定稿里块底沉进黑里，上部岩面亮）
        col *= 0.45 + 0.7 * clamp(vW.y / uSize.y, 0.0, 1.0);
        // 煤层：工作面所在的那一层更暗
        float seam = smoothstep(30.0, 18.0, abs(y - uSeamY));
        col = mix(col, uSeam, seam*0.45);
        // 岩层分界线：细亮线（带抖动），等高线：更细更淡
        float f = fract(layer);
        float line = smoothstep(0.035, 0.0, min(f, 1.0 - f)) * (0.55 + 0.45*hash(vec2(idx, 9.0)));
        float c = fract(y / 32.0);
        float contour = smoothstep(0.06, 0.0, min(c, 1.0 - c)) * 0.18;
        // 块边缘高光：离任意两条边都近的地方（棱）
        vec3 q = vec3(vW.x / uSize.x, vW.y / uSize.y, -vW.z / uSize.z);
        vec3 e = min(q, 1.0 - q) * uSize;
        float m1 = min(e.x, min(e.y, e.z));
        float m2 = e.x + e.y + e.z - m1 - max(e.x, max(e.y, e.z));
        float edge = smoothstep(10.0, 0.0, m2);
        vec3 rgb = col + uLine * (line*0.1 + contour*0.12) + uEdge * edge * 0.1;
        // 侧面朝向：正面亮一点，侧面暗一点
        float facing = 0.8 + 0.2*abs(vN.z);
        // 定稿里岩体底部和左端沉进黑暗、没有硬边：按高度和左端距离淡出
        float fade = smoothstep(0.0, 0.35, vW.y / uSize.y) * smoothstep(0.0, 0.12, vW.x / uSize.x);
        gl_FragColor = vec4(rgb * facing * (0.55 + 0.45 * fade), uOpacity * (0.45 + 0.55 * fade));
        #include <colorspace_fragment>
      }`
  })
  // 块体：x 0…W，y 0…H，z −D…0；顶面单独做成起伏地表，盒子去掉顶面
  const box = new THREE.BoxGeometry(W, H, D, 1, 1, 1)
  box.translate(W / 2, H / 2, -D / 2)
  // BoxGeometry 的面顺序：+x、−x、+y（顶）、−y、+z（正面）、−z；去掉顶面（第 3 组）
  const groups = box.groups.filter((g, i) => i !== 2)
  const idx = []
  const index = box.index.array
  for (const g of groups)
    for (let i = g.start; i < g.start + g.count; i++) idx.push(index[i])
  box.setIndex(idx)
  box.clearGroups()
  const blockMesh = new THREE.Mesh(box, mat)
  // 先画块（半透明、不写深度），巷道、皮带、煤仓画在它上面：发光的煤流不被玻璃压暗，和定稿一致
  blockMesh.renderOrder = -10
  group.add(blockMesh)

  // 顶面地表：砾石岩质高台（定稿里厂房坐落在一整块向后延伸的碎石台面上）。
  // 前沿和左右两端贴平（和块的切面对齐）；后半部整体抬高成台地，台面上叠多层碎石起伏；
  // 平面着色出棱面，顶点色加砾石斑点，避免平滑的"塑料山丘"
  const nx = 300
  const nz = 44
  const top = new THREE.PlaneGeometry(W, D, nx, nz)
  top.rotateX(-Math.PI / 2)
  top.translate(W / 2, H, -D / 2)
  const pos = top.attributes.position
  // 固定种子的值噪声（碎石的细节起伏）
  const hash = (a, b) => {
    const t = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
    return t - Math.floor(t)
  }
  const vnoise = (x, z) => {
    const ix = Math.floor(x)
    const iz = Math.floor(z)
    const fx = x - ix
    const fz = z - iz
    const ux = fx * fx * (3 - 2 * fx)
    const uz = fz * fz * (3 - 2 * fz)
    const a = hash(ix, iz)
    const b = hash(ix + 1, iz)
    const c = hash(ix, iz + 1)
    const d = hash(ix + 1, iz + 1)
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz
  }
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const edge = Math.min(x, W - x, -z) / 120
    const k = Math.min(1, Math.max(0, edge))
    // 台地：离前沿 25 % 进深以后抬高 45，边缘有一道缓坡
    // 工业广场（x > 0.83 W，主斜井井口、厂房、原煤仓所在）是平整场地：台地和大起伏在这里淡出
    const yard = Math.min(1, Math.max(0, (x - 0.8 * W) / (0.05 * W)))
    const plateau =
      Math.min(1, Math.max(0, (-z / D - 0.25) / 0.25)) * (1 - yard)
    const rough =
      28 * (vnoise(x / 180, z / 120) - 0.5) +
      14 * (vnoise(x / 60, z / 45) - 0.5) +
      7 * (vnoise(x / 22, z / 18) - 0.5)
    const h =
      (plateau * (45 + 25 * Math.sin(x / 520 + 0.4)) +
        (18 * Math.sin(x / 640 + 1.3) + rough) * (1 - 0.8 * yard)) *
      k
    pos.setY(i, H + Math.max(-6, h))
  }
  top.computeVertexNormals()
  // 地表颜色：大块明暗 + 砾石斑点（少量偏亮的碎石、少量偏暗的坑）
  const colors = []
  const base = new THREE.Color(THEME.surface.ground)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const big = 0.75 + 0.35 * (vnoise(x / 260, z / 160) - 0.5)
    const n = hash(Math.round(x / 9), Math.round(z / 9))
    const speck = n > 0.92 ? 1.35 : n < 0.08 ? 0.6 : 1
    const c = base.clone().multiplyScalar(Math.max(0.4, big * speck))
    colors.push(c.r, c.g, c.b)
  }
  top.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3))
  const topMat = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.05,
    flatShading: true
  })
  const topMesh = new THREE.Mesh(top, topMat)
  group.add(topMesh)

  // 块的棱线：细线（正面四条、右侧面四条、顶面前沿）
  const edges = new THREE.EdgesGeometry(
    new THREE.BoxGeometry(W, H, D).translate(W / 2, H / 2, -D / 2)
  )
  const edgeMat = new THREE.LineBasicMaterial({
    color: THEME.strata.edge,
    transparent: true,
    opacity: 0.05
  })
  const edgeLines = new THREE.LineSegments(edges, edgeMat)
  edgeLines.renderOrder = 11
  group.add(edgeLines)

  return { group, block: blockMesh, top: topMesh, uniforms }
}

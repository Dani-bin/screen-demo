/*
 * /estate 还原：楼体立面着色器
 * ----------------------------------------------------------
 * 之前每栋楼是"实心长方体 + 贴在墙上的几千个发光小方块"，表现不了设计稿里的建筑模型质感：
 * 窗洞是凹进去的、窗里是有深浅的窗帘、成组的窗之间有竖向深槽和白色壁柱、墙面上亮下暗。
 * 这里改成在墙面上按"墙面坐标"程序化画出这些（一种材质一栋楼，窗格数按这栋楼的面宽和高度取整，
 * 所以窗和窗之间永远是整数个开间，不会在墙角被切一半）：
 *   - 开间 bay × 层距 row：窗是开间内居中的一块（winW × winH），窗洞上缘和左缘有内壁阴影，下缘有窗台亮线；
 *   - 窗里：亮窗 = 暖色窗帘（上亮下暗 + 竖向褶皱，三种色调随机），暗窗 = 深暖褐色；每扇窗亮不亮由 hash(列, 行, 种子) 定；
 *   - group：每 group 个开间为一组，组与组之间是一条深槽 + 两侧各一条浅色壁柱（高层是两窗一组，联排是一户一组）；
 *   - 墙面：上亮下暗的渐变（楼脚压暗），不带自发光——设计稿里只有窗在发光。
 * 只作用在侧面（法线水平的面），屋顶面保持材质原色。窗光亮度由共享的 gain 控制（昼夜在 RestoredScene.applyLight 里调）。
 * 坐标：几何是以楼体中心为原点、尺寸已烘进顶点的盒子，所以顶点局部坐标 + 半尺寸 = 离墙角 / 楼脚的距离（米）。
 */
import * as THREE from "three"

/** 全楼共享的窗光增益（时间轴调它）；每个材质的 uGain 都指向这个对象 */
export const facadeGain = { value: 1 }

/**
 * 立面材质
 * @param {object} o
 *   color      墙色
 *   size       [w, h, d] 盒子尺寸（米，和几何一致）
 *   bay, row   开间宽、层距（米）
 *   win        [窗宽占开间、窗高占层距]
 *   group      每组几个开间（0 = 不分组）
 *   groove     组间深槽宽度（米）
 *   pilaster   深槽两侧浅色壁柱宽度（米）
 *   lit        亮窗概率
 *   seed       随机种子（每栋不同）
 *   emis       窗光自发光强度
 *   frame      窗框的亮度倍数（>1 比墙亮，<1 比墙暗）
 *   foot       楼脚压暗的高度范围（米）
 *   roof       屋顶面的颜色（不给就沿用材质色）
 *   core       亮芯占窗格的宽 / 高比例（设计稿里窗格是深色凹框里一块亮芯，亮芯只占窗格 5–6 成）
 *   warmK      窗光再橙一点的程度（0 = 原样，1 = 蓝通道 ×0.5、绿通道 ×0.85；设计稿的窗是橙黄不是奶白）
 *   split      1 = 亮芯中间一道窗框，左右两半各自的亮度不同（设计稿联排 / 洋房每格是两扇小窗并排）
 *   sill       窗格底部一条暗带的高度占比（洋房的阳台栏板在亮窗下面投出的暗带，设计稿每格下沿 ≈ 25 % 是暗的）
 *   tex        亮芯里窗帘 / 家具的细碎明暗强度（0 = 平滑渐变；设计稿窗格里起伏很大）
 *   fold       窗帘竖向褶皱的频率（窗格越宽越大；会所整面大玻璃里是细密的竖条）
 *   frameDark  窗洞边缘一圈相对亮芯的亮度（0.3 = 压到 3 成，窗格像"深色窗框里一块亮芯"；1 = 整个窗格一样亮）
 *   real       1 = 窗洞是真凹的（lattice.js 补了梁 / 墩几何）：着色器里假的窗楣阴影减弱，免得和真几何的阴影叠加
 */
export function createFacadeMaterial(o) {
  const {
    color,
    size,
    bay,
    row,
    win = [0.5, 0.56],
    group = 0,
    groove = 0.6,
    pilaster = 0.5,
    lit = 0.88,
    seed = 1,
    emis = 1.15,
    frame = 1.12,
    foot = 14,
    roof = null,
    real = 0,
    frameDark = 0.3,
    split = 0,
    sill = 0,
    tex = 0.25,
    fold = 22,
    warmK = 0,
    core = [0.7, 0.72],
    roughness = 0.78
  } = o
  const mat = new THREE.MeshStandardMaterial({ color, roughness })
  mat.userData.facade = true
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSize = { value: new THREE.Vector3(...size) }
    shader.uniforms.uGrid = {
      value: new THREE.Vector4(bay, row, win[0], win[1])
    }
    shader.uniforms.uGroup = {
      value: new THREE.Vector4(group, groove, pilaster, seed)
    }
    shader.uniforms.uLook = { value: new THREE.Vector4(lit, emis, frame, foot) }
    shader.uniforms.uGain = facadeGain
    shader.uniforms.uLook2 = { value: frameDark }
    shader.uniforms.uPane = { value: new THREE.Vector4(split, sill, tex, fold) }
    shader.uniforms.uWarmK = { value: warmK }
    shader.uniforms.uCore = { value: new THREE.Vector2(core[0], core[1]) }
    shader.uniforms.uReal = { value: real }
    shader.uniforms.uRoof = {
      value: new THREE.Vector4(
        ...(roof ? new THREE.Color(roof).toArray() : [0, 0, 0]),
        roof ? 1 : 0
      )
    }
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vFp;\nvarying vec3 vFn;"
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n  vFp = position;\n  vFn = normal;"
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vFp;
        varying vec3 vFn;
        uniform vec3 uSize;
        uniform vec4 uGrid;
        uniform vec4 uGroup;
        uniform vec4 uLook;
        uniform float uLook2;
        uniform vec2 uCore;
        uniform vec4 uPane;
        uniform float uWarmK;
        uniform float uGain;
        uniform float uReal;
        uniform vec4 uRoof;
        float fh21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        if (abs(vFn.y) < 0.5) {
          bool ew = abs(vFn.x) > 0.5;
          float fw = ew ? uSize.z : uSize.x;
          float along = (ew ? vFp.z * sign(vFn.x) : vFp.x * -sign(vFn.z)) + fw * 0.5;
          float up = vFp.y + uSize.y * 0.5;
          // 整数开间 / 整数层：窗格永远整数个，不在墙角被切一半
          float nb = max(1.0, floor(fw / uGrid.x + 0.5));
          float bw = fw / nb;
          float nr = max(1.0, floor(uSize.y / uGrid.y + 0.5));
          float rh = uSize.y / nr;
          float ci = floor(along / bw);
          float ri = floor(up / rh);
          vec2 c = vec2(fract(along / bw), fract(up / rh));
          float aaX = max(fwidth(along) / bw, 0.001);
          float aaY = max(fwidth(up) / rh, 0.001);
          // 窗洞：开间内居中，竖向略偏下（上面留给楼板）
          vec2 hw = vec2(uGrid.z, uGrid.w) * 0.5;
          vec2 wc = vec2(0.5, 0.46);
          vec2 d = abs(c - wc);
          float inX = 1.0 - smoothstep(hw.x - aaX, hw.x + aaX, d.x);
          float inY = 1.0 - smoothstep(hw.y - aaY, hw.y + aaY, d.y);
          float inWin = inX * inY;
          // 窗洞内的局部坐标 0..1（竖向 0 = 窗台，1 = 窗楣）
          vec2 wu = (c - (wc - hw)) / (hw * 2.0);
          // 墙面：上亮下暗；高层楼脚压暗得多
          float hh = up / uSize.y;
          float foot = smoothstep(0.0, uLook.w, up);
          vec3 wall = diffuseColor.rgb * mix(0.55, 1.0, foot) * (0.93 + 0.14 * smoothstep(0.5, 1.0, hh));
          // 窗框：窗洞外一圈
          float fr = (1.0 - smoothstep(hw.x + 0.06 - aaX, hw.x + 0.06 + aaX, d.x)) * (1.0 - smoothstep(hw.y + 0.05 - aaY, hw.y + 0.05 + aaY, d.y));
          wall = mix(wall, wall * uLook.z, fr * (1.0 - inWin));
          // 成组：组间深槽 + 两侧浅色壁柱
          if (uGroup.x > 0.5) {
            float gw = bw * uGroup.x;
            float ag = mod(along, gw);
            float dm = min(ag, gw - ag);
            float aam = max(fwidth(along), 0.01);
            float gr = 1.0 - smoothstep(uGroup.y * 0.5 - aam, uGroup.y * 0.5 + aam, dm);
            float pl = smoothstep(uGroup.y * 0.5 - aam, uGroup.y * 0.5 + aam, dm) * (1.0 - smoothstep(uGroup.y * 0.5 + uGroup.z - aam, uGroup.y * 0.5 + uGroup.z + aam, dm));
            wall = mix(wall, wall * 1.14 + 0.02, pl);
            wall = mix(wall, wall * 0.42, gr);
            inWin *= 1.0 - gr;
          }
          // 窗里：暖色窗帘（上亮下暗 + 褶皱）/ 暗窗
          float rnd = fh21(vec2(ci, ri) + uGroup.w * 17.0);
          float isLit = step(rnd, uLook.x);
          float tint = fh21(vec2(ci * 1.7, ri * 2.3) + uGroup.w);
          vec3 warm = tint < 0.34 ? vec3(1.0, 0.72, 0.36) : (tint < 0.67 ? vec3(1.0, 0.82, 0.52) : vec3(1.0, 0.64, 0.30));
          float bright = (0.45 + 0.55 * wu.y) * (0.82 + 0.18 * sin(wu.x * uPane.w + rnd * 6.0)) * (0.7 + 0.5 * fh21(vec2(ri, ci) * 3.1 + uGroup.w));
          // 内壁阴影：窗楣和左缘暗一条；窗台一条亮线
          float inner = 1.0 - (0.45 * smoothstep(0.82, 1.0, wu.y) + 0.35 * (1.0 - smoothstep(0.0, 0.14, wu.x))) * (1.0 - 0.6 * uReal);
          // 窗框：设计稿里每个窗格是"深色窗框里一块橙黄亮芯"（放大看亮芯只占窗格的 6–7 成，四周一圈深色），
          // 所以窗洞边缘一圈压暗，亮芯在中间
          vec2 ce = (1.0 - uCore) * 0.5;
          float core = smoothstep(ce.x - 0.05, ce.x + 0.07, min(wu.x, 1.0 - wu.x)) * smoothstep(ce.y - 0.05, ce.y + 0.07, min(wu.y, 1.0 - wu.y));
          warm *= vec3(1.0, 1.0 - 0.15 * uWarmK, 1.0 - 0.5 * uWarmK);
          vec3 winCol = isLit > 0.5 ? warm * bright * inner * mix(uLook2, 1.0, core) : vec3(0.09, 0.07, 0.06);
          // 分窗：中间一道窗框，两半各自的亮度（一半常常更暗，像拉了窗帘 / 灯没全开）
          float halfId = step(0.5, wu.x);
          float hr = fh21(vec2(ci * 3.7 + halfId * 5.1, ri * 1.9) + uGroup.w * 7.0);
          float mull = uPane.x * (1.0 - smoothstep(0.0, 0.045, abs(wu.x - 0.5)));
          winCol *= mix(1.0, 0.4 + 0.9 * hr, uPane.x) * (1.0 - 0.85 * mull);
          // 窗格底部暗带（阳台栏板 / 窗台下的墙）
          winCol *= 1.0 - 0.8 * uPane.y * (1.0 - smoothstep(uPane.y * 0.7, uPane.y, wu.y));
          // 细碎明暗：窗帘 / 家具 / 灯，按窗格内 7 × 5 的小格随机
          float cell = fh21(floor(wu * vec2(7.0, 5.0)) + vec2(ci, ri) * 1.3 + uGroup.w * 3.0);
          winCol *= 1.0 - uPane.z + 2.0 * uPane.z * cell;
          float sill = (1.0 - smoothstep(0.0, 0.07, wu.y)) * inWin;
          diffuseColor.rgb = mix(wall, vec3(0.12, 0.10, 0.09), inWin);
          diffuseColor.rgb = mix(diffuseColor.rgb, wall * 1.2, sill * 0.5);
          totalEmissiveRadiance += winCol * inWin * isLit * uLook.y * uGain;
        }
        else if (vFn.y > 0.5 && uRoof.w > 0.5) {
          // 屋顶面：亮白灰（顶面受光最亮），不沿用墙色
          diffuseColor.rgb = uRoof.rgb;
        }`
      )
  }
  return mat
}

/**
 * 给楼体网格上立面材质。targets：[{ id, mesh, size, params }]。返回材质数组（需要统一调时再用）。
 * 几何要求：以中心为原点、尺寸已烘进顶点的盒子（生成器的 box 就是这样）。
 */
export function applyFacades(targets) {
  const mats = []
  for (const t of targets) {
    if (!t.mesh) continue
    const m = createFacadeMaterial({ ...t.params, size: t.size })
    t.mesh.material = m
    mats.push(m)
  }
  return mats
}

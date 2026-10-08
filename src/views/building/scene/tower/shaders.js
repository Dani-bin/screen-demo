/*
 * 楼宇级 · 全息塔楼着色器
 * ----------------------------------------------------------
 * 设计稿 02-ai-building.png 的「X 光」塔楼：透明蓝玻璃外壳能看穿到背面，竖梃与层线发青光，
 * 窗里的灯按各层入驻率亮；中央核心筒一道青色光柱，电梯轿厢的光点在井道里上下跑。
 * 全部是加法混合的 ShaderMaterial（越叠越亮，背景是深色夜空），模式切换只改 uniform。
 *
 * 楼层数据贴图 uFloors（宽 = 楼层数 + 偏移，高 1，RGBA8）：
 *   r 入驻率 0..1、g 告警、b 设备层、a 热力（在岗密度 0..1）；下标 = 楼层号 + FLOOR_TEX_OFFSET（地下层为负号）
 */
import { AdditiveBlending, DoubleSide, ShaderMaterial } from "three"

/** 楼层贴图下标偏移：B3 = -3 → 下标 0 */
export const FLOOR_TEX_OFFSET = 3

const FLOOR_COMMON = /* glsl */ `
  uniform sampler2D uFloors;
  uniform float uFloorTexW;
  vec4 floorData(float fi) {
    return texture2D(uFloors, vec2((fi + ${FLOOR_TEX_OFFSET.toFixed(1)} + 0.5) / uFloorTexW, 0.5));
  }
  // 热力色带：蓝 → 青 → 黄 → 红
  vec3 heatColor(float t) {
    vec3 a = mix(vec3(0.1, 0.35, 1.0), vec3(0.1, 0.9, 0.95), smoothstep(0.0, 0.4, t));
    vec3 b = mix(a, vec3(1.0, 0.85, 0.25), smoothstep(0.4, 0.75, t));
    return mix(b, vec3(1.0, 0.25, 0.2), smoothstep(0.75, 1.0, t));
  }
  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
`

/**
 * 玻璃外壳（塔身 / 裙楼共用，参数不同）：
 *   uBaseY / uFloorH / uFloorBase：本段外壳的楼层换算（世界高度 → 楼层号）
 *   uGlass 玻璃底色、uWinColor 窗灯色、uAlpha 整体透明度、uMullion 竖梃与层线亮度、uWindow 窗灯亮度
 *   uHover / uGap：悬浮层（加亮）、抽出层（挖空，uGapAmt > 0 时）
 */
export function shellMaterial(o) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: {
      uFloors: { value: o.floorTex },
      uFloorTexW: { value: o.floorTex.image.width },
      uBaseY: { value: o.baseY },
      uFloorH: { value: o.floorH },
      uFloorBase: { value: o.floorBase },
      uMaxFloor: { value: o.maxFloor },
      uGlass: { value: o.glass },
      uWinColor: { value: o.winColor },
      uEdge: { value: o.edge },
      uAlpha: { value: o.alpha ?? 0.16 },
      uMullion: { value: o.mullion ?? 0.5 },
      uWindow: { value: o.window ?? 0.9 },
      uHeat: { value: 0 },
      uPlant: { value: 0 },
      uHover: { value: -99 },
      uGap: { value: -99 },
      uGapAmt: { value: 0 },
      uTime: { value: 0 }
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${FLOOR_COMMON}
      uniform float uBaseY, uFloorH, uFloorBase, uMaxFloor;
      uniform vec3 uGlass, uWinColor, uEdge;
      uniform float uAlpha, uMullion, uWindow, uHeat, uPlant;
      uniform float uHover, uGap, uGapAmt, uTime;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        float u = vUv.x;
        float y = vUv.y;
        float fl = (y - uBaseY) / uFloorH;
        float fi = min(uFloorBase + floor(fl), uMaxFloor);
        float fy = fract(fl);
        // 抽出的楼层：外壳在这一层挖空，像抽屉被拉走后留下的空格
        if (uGapAmt > 0.02 && abs(fi - uGap) < 0.5) discard;
        vec4 fd = floorData(fi);

        // 菲涅尔：轮廓边缘亮（全息感），正对视线处几乎透明
        float fres = pow(1.0 - abs(dot(normalize(vN), vView)), 2.2);
        vec3 col = uGlass * uAlpha * 0.6 + uEdge * fres * (0.12 + uAlpha * 0.8);

        // 竖梃（3.2 m 一道）与层线
        float mu = abs(fract(u / 3.2 + 0.5) - 0.5) * 3.2;
        float mull = 1.0 - smoothstep(0.05, 0.16, mu);
        float my = abs(fract(fl + 0.5) - 0.5) * uFloorH;
        float line = 1.0 - smoothstep(0.03, 0.12, my);
        col += uEdge * (mull * 0.1 + line * 0.38) * uMullion;

        // 窗灯：1.6 m 一格，按本层入驻率决定亮灯比例，亮度各不相同
        // 一格 3.2 m（与竖梃对齐），亮的格子连成一段段灯带；吊顶处最亮、往下渐暗（室内灯从天花往下照）
        float cell = floor(u / 3.2);
        float h = hash21(vec2(floor(cell / 3.0), fi));
        float lit = step(h, fd.r * 0.85);
        float cx = fract(u / 3.2);
        float win = step(0.06, cx) * step(cx, 0.94) * smoothstep(0.15, 0.8, fy) * step(fy, 0.86);
        float bright = 0.5 + 0.5 * hash21(vec2(fi, cell * 1.7));
        vec3 wc = mix(uWinColor, heatColor(fd.a), uHeat);
        col += wc * lit * win * bright * uWindow * 0.16;

        // 设备层（机电模式）绿色、告警层红色呼吸、悬浮层青色加亮
        col += vec3(0.1, 0.95, 0.5) * fd.b * uPlant * (0.25 + 0.5 * line);
        col += vec3(1.0, 0.15, 0.18) * fd.g * (0.35 + 0.25 * sin(uTime * 4.0));
        if (abs(fi - uHover) < 0.5) col += vec3(0.2, 0.75, 1.0) * 0.45;
        gl_FragColor = vec4(col, 1.0);
      }`
  })
}

/**
 * 楼板（所有楼层合成一个网格，顶点属性 aFloor = 楼层号）：
 * 平时是一圈圈淡青色的层板；热力模式按在岗密度上色；悬浮 / 告警 / 抽出同外壳
 */
export function slabMaterial(floorTex) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: {
      uFloors: { value: floorTex },
      uFloorTexW: { value: floorTex.image.width },
      uSlab: { value: 0.1 },
      uHeat: { value: 0 },
      uHover: { value: -99 },
      uGap: { value: -99 },
      uGapAmt: { value: 0 },
      uTime: { value: 0 }
    },
    vertexShader: /* glsl */ `
      attribute float aFloor;
      varying float vFloor;
      varying vec3 vW;
      void main() {
        vFloor = aFloor;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${FLOOR_COMMON}
      uniform float uSlab, uHeat, uHover, uGap, uGapAmt, uTime;
      varying float vFloor;
      varying vec3 vW;
      void main() {
        if (uGapAmt > 0.02 && abs(vFloor - uGap) < 0.5) discard;
        vec4 fd = floorData(vFloor);
        vec3 col = vec3(0.08, 0.4, 0.85) * uSlab;
        // 热力：楼板几乎是侧着看的，几十层叠在一起（加法混合）很容易过曝，单层只给很淡的颜色
        col = mix(col, heatColor(fd.a) * 0.09, uHeat * step(0.001, fd.a + fd.r));
        col += vec3(1.0, 0.15, 0.18) * fd.g * (0.25 + 0.2 * sin(uTime * 4.0));
        if (abs(vFloor - uHover) < 0.5) col += vec3(0.15, 0.6, 1.0) * 0.35;
        gl_FragColor = vec4(col, 1.0);
      }`
  })
}

/** 楼板边线（LineSegments，同样带 aFloor）：选中 / 悬浮层更亮 */
export function slabEdgeMaterial(floorTex) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uFloors: { value: floorTex },
      uFloorTexW: { value: floorTex.image.width },
      uEdge: { value: 0.55 },
      uHeat: { value: 0 },
      uHover: { value: -99 },
      uGap: { value: -99 },
      uGapAmt: { value: 0 }
    },
    vertexShader: /* glsl */ `
      attribute float aFloor;
      varying float vFloor;
      void main() {
        vFloor = aFloor;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${FLOOR_COMMON}
      uniform float uEdge, uHeat, uHover, uGap, uGapAmt;
      varying float vFloor;
      void main() {
        if (uGapAmt > 0.02 && abs(vFloor - uGap) < 0.5) discard;
        vec4 fd = floorData(vFloor);
        vec3 col = mix(vec3(0.25, 0.75, 1.0), heatColor(fd.a), uHeat * step(0.001, fd.a + fd.r));
        float k = uEdge;
        if (fd.g > 0.5) col = vec3(1.0, 0.3, 0.32);
        if (abs(vFloor - uHover) < 0.5) k = 1.4;
        gl_FragColor = vec4(col * k, 1.0);
      }`
  })
}

/**
 * 核心筒：一道青色光柱，前后两面各 6 条电梯井（竖向亮带），轿厢光点在井道里往返；
 * 用模型局部坐标 vLocal 算井道（盒子尺寸 uSize）
 */
export function coreMaterial(size, yRange) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: {
      uSize: { value: size },
      uY0: { value: yRange[0] },
      uY1: { value: yRange[1] },
      uCore: { value: 1 },
      uTime: { value: 0 }
    },
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vNl;
      void main() {
        vLocal = position;
        vNl = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSize;
      uniform float uY0, uY1, uCore, uTime;
      varying vec3 vLocal;
      varying vec3 vNl;
      float hash11(float p) { return fract(sin(p * 91.7) * 43758.5453); }
      void main() {
        // 前后面沿 x 排井道，两个侧面沿 z
        bool front = abs(vNl.z) > 0.5;
        float span = front ? uSize.x : uSize.z;
        float t = ((front ? vLocal.x : vLocal.z) / span + 0.5) * 6.0;
        float shaft = floor(t);
        float inShaft = 1.0 - smoothstep(0.32, 0.46, abs(fract(t) - 0.5));
        float y = vLocal.y + uSize.y * 0.5;
        float hgt = uSize.y;
        // 轿厢：每条井道一个光点，速度、相位不同，到顶折返
        float id = shaft + (front ? (vNl.z > 0.0 ? 0.0 : 6.0) : (vNl.x > 0.0 ? 12.0 : 18.0));
        float ph = fract(uTime * (0.02 + 0.03 * hash11(id)) + hash11(id + 3.1));
        float yb = abs(ph * 2.0 - 1.0) * hgt;
        float car = exp(-pow((y - yb) / 1.6, 2.0)) * inShaft;
        float base = 0.05 + 0.2 * inShaft;
        // 顶部、底部渐隐
        float fade = smoothstep(0.0, 14.0, y) * (1.0 - smoothstep(hgt - 10.0, hgt, y));
        vec3 col = vec3(0.12, 0.7, 1.0) * base + vec3(0.7, 0.95, 1.0) * car * 1.1;
        gl_FragColor = vec4(col * fade * uCore, 1.0);
      }`
  })
}

/** 机电立管：沿管子向上流动的亮段（颜色区分水 / 电 / 风 / 消防），uAmt 控制显隐 */
export function riserMaterial(color, speed) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uColor: { value: color },
      uSpeed: { value: speed },
      uAmt: { value: 0 },
      uTime: { value: 0 }
    },
    vertexShader: /* glsl */ `
      varying float vY;
      void main() {
        vY = (modelMatrix * vec4(position, 1.0)).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uSpeed, uAmt, uTime;
      varying float vY;
      void main() {
        float dash = smoothstep(0.55, 1.0, fract(vY * 0.08 - uTime * uSpeed));
        gl_FragColor = vec4(uColor * (0.35 + 1.4 * dash) * uAmt, 1.0);
      }`
  })
}

/** 抽出楼层的金色玻璃围合（只有侧面）：菲涅尔 + 竖梃，略带呼吸 */
export function drawerGlassMaterial() {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uAmt: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uAmt;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        float fres = pow(1.0 - abs(dot(normalize(vN), vView)), 2.0);
        float mu = abs(fract(vUv.x / 3.2 + 0.5) - 0.5) * 3.2;
        float mull = 1.0 - smoothstep(0.05, 0.15, mu);
        vec3 gold = vec3(1.0, 0.72, 0.25);
        vec3 col = gold * (0.12 + fres * 0.5 + mull * 0.5) * (0.9 + 0.1 * sin(uTime * 3.0));
        gl_FragColor = vec4(col * uAmt, 1.0);
      }`
  })
}

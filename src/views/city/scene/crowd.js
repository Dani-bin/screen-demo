/*
 * 景点人流
 * ----------------------------------------------------------
 * 全城共用一套 InstancedMesh 人群：巡览飞抵某站时，在该站景点给出的
 * 步行路径（walkways）上生成一群低多边形小人沿路走动，离站 / 回总览时淡出回收。
 *
 * 造型（局部 y = 0 为脚底，身高 h，+Z 为正面）：
 *   身体 8 边圆台（底 0.36h～顶 0.72h）、头球（中心 0.86h）、发片（头球上半部，
 *   略大一圈、与头同心）、左右两条 6 边圆柱腿（原点在髋部 0.38h，绕 X 轴前后摆）。
 * 共 5 个 InstancedMesh：body、head、hair、legL、legR。
 *   - body / head / hair 的实例矩阵完全相同，三者共用同一个 instanceMatrix 属性，每帧只写一份；
 *   - 左右腿共用一份 instanceColor（裤子颜色）。
 * 淡入淡出用实例整体缩放（0 → 1），不用透明度，避免透明排序问题。
 * 小人互不避让：远景下看不出，横向偏移与速度随机即可避免排成一队。
 *
 * 路径格式（景点模块 build 结果的 walkways 字段）：
 *   { points: [[x, z], ...], y, width, closed = false, density = 1 }
 *   points 为世界坐标折线（closed 时首尾相连成环）；y 为路面高度；
 *   小人在中线两侧 ±width/2 内随机偏移；开放路径走到端点原地转身折返，闭合路径循环走。
 */
import {
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardMaterial,
  SphereGeometry
} from "three"
import { mulberry32 } from "./utils.js"

const TAU = Math.PI * 2

/* ---- 比例（均为身高 h 的倍数） ---- */
const BODY = { rBottom: 0.2, rTop: 0.16, h: 0.36, y0: 0.36 }
const HEAD = { r: 0.11, y: 0.86 }
// 发片半径比头大约 9%：两者经纬分段一致且同心，发片每个面都在头球对应面之外，头顶不会穿出。
// 设计要求「稍压扁」，但压扁后发片顶面会低于头球顶点，因此改为不压扁、只盖到赤道略下
const HAIR = { r: 0.12, cover: 0.55 } // cover：从头顶往下覆盖的极角（× π）
const LEG = { r: 0.06, len: 0.38, x: 0.085 } // x：腿中心离身体中线的距离
const HIP = 0.38 // 髋部高度（腿顶端）

/* ---- 步态 ---- */
const SWING = 0.5 // 腿前后摆幅（弧度）
// 身体起伏幅度（× h）。起伏相位取「两腿并拢时最高、前后分开时最低」：
// 腿摆到最大（0.5 rad）时脚底会抬起约 0.047h，身体同时下沉 0.03h，脚基本贴地
const BOB = 0.03
const STRIDE = 0.9 // 一个步态周期（左右各迈一步）前进的距离（× h）
// 路径拐角处朝向的平滑速率（1/秒）：约 0.15 s 转过去，不会一帧跳变
const YAW_RATE = 8
// 个体身高差异（相对 theme.crowd.height 的倍数范围）
const SIZE_MIN = 0.92
const SIZE_VAR = 0.16

/**
 * 只保留几何体指定分组（groups）的三角形，其余丢弃，返回同一个几何体。
 * CylinderGeometry 的分组依次为：侧面、顶盖、底盖。
 */
function keepGroups(geo, ids) {
  const src = geo.index.array
  const out = []
  for (const id of ids) {
    const g = geo.groups[id]
    for (let k = g.start; k < g.start + g.count; k++) out.push(src[k])
  }
  geo.setIndex(out)
  geo.clearGroups()
  return geo
}

/** 按身高 h 生成 5 种构件几何体（已平移到局部坐标位置） */
function createGeometries(h) {
  // 身体：侧面 + 顶盖（底盖被腿和身体自身挡住，从上往下看不到，省掉）
  const body = keepGroups(
    new CylinderGeometry(
      BODY.rTop * h,
      BODY.rBottom * h,
      BODY.h * h,
      8,
      1
    ).translate(0, (BODY.y0 + BODY.h / 2) * h, 0),
    [0, 1]
  )
  const head = new SphereGeometry(HEAD.r * h, 6, 4).translate(0, HEAD.y * h, 0)
  // 发片：与头球同样 6 段经线、同一起始经度，面与面对齐
  const hair = new SphereGeometry(
    HAIR.r * h,
    6,
    2,
    0,
    TAU,
    0,
    HAIR.cover * Math.PI
  ).translate(0, HEAD.y * h, 0)
  // 腿：两端都不封口（顶端藏在身体里，底端朝下看不到）；原点平移到顶端（髋部）
  const leg = new CylinderGeometry(
    LEG.r * h,
    LEG.r * h,
    LEG.len * h,
    6,
    1,
    true
  ).translate(0, (-LEG.len / 2) * h, 0)
  return { body, head, hair, leg }
}

/** 三角形数（有索引按索引计） */
function triangleCount(geo) {
  return (geo.index ? geo.index.count : geo.attributes.position.count) / 3
}

/**
 * 路径预处理：累积弧长与每段单位切线。
 * 点数不足、总长过短（< 1 m）或字段非法的路径返回 null（不分配人）。
 */
function preparePath(w) {
  if (!w || !Array.isArray(w.points) || w.points.length < 2) return null
  const pts = w.points.filter(
    (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
  )
  const closed = Boolean(w.closed) && pts.length >= 3
  if (closed) pts.push(pts[0])
  if (pts.length < 2) return null
  const n = pts.length
  const xs = new Float64Array(n)
  const zs = new Float64Array(n)
  const cum = new Float64Array(n)
  const tx = new Float64Array(n - 1)
  const tz = new Float64Array(n - 1)
  for (let i = 0; i < n; i++) {
    xs[i] = pts[i][0]
    zs[i] = pts[i][1]
    if (i === 0) continue
    const dx = xs[i] - xs[i - 1]
    const dz = zs[i] - zs[i - 1]
    const len = Math.hypot(dx, dz)
    cum[i] = cum[i - 1] + len
    // 零长度段（重复点）切线沿用上一段，避免除零
    tx[i - 1] = len > 1e-9 ? dx / len : i > 1 ? tx[i - 2] : 1
    tz[i - 1] = len > 1e-9 ? dz / len : i > 1 ? tz[i - 2] : 0
  }
  const length = cum[n - 1]
  if (!(length >= 1)) return null
  return {
    xs,
    zs,
    cum,
    tx,
    tz,
    length,
    closed,
    y: Number.isFinite(w.y) ? w.y : 0,
    width: Number.isFinite(w.width) && w.width > 0 ? w.width : 0,
    density: Number.isFinite(w.density) && w.density >= 0 ? w.density : 1
  }
}

/**
 * 在路径弧长 s 处取点：写入 out.x / out.z（中线位置）与 out.tx / out.tz（单位切线）。
 * s 需已在 [0, length] 内；二分查找所在段。
 */
function samplePath(p, s, out) {
  const cum = p.cum
  let lo = 0
  let hi = cum.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (cum[mid] <= s) lo = mid
    else hi = mid - 1
  }
  const t = s - cum[lo]
  out.tx = p.tx[lo]
  out.tz = p.tz[lo]
  out.x = p.xs[lo] + out.tx * t
  out.z = p.zs[lo] + out.tz * t
}

/** 角度差归一化到 [-π, π] */
function wrapAngle(a) {
  return a - TAU * Math.round(a / TAU)
}

/**
 * 按路径长度 × 每米人数 × 相对密度分配人数；总数超过上限时按比例缩减。
 * @returns {number[]} 每条路径的人数
 */
function allocate(paths, perMeter, max) {
  const want = paths.map((p) => p.length * perMeter * p.density)
  const counts = want.map((w) => Math.round(w))
  const total = counts.reduce((a, b) => a + b, 0)
  if (total <= max) return counts
  // 按比例缩减后向下取整，总数一定不超过上限
  const k = max / want.reduce((a, b) => a + b, 0)
  return want.map((w) => Math.floor(w * k))
}

/**
 * 创建人群。
 * @param {object} theme THEME（用到 theme.crowd）
 * @param {object} [options]
 * @param {number} [options.max] 同时活跃人数上限，缺省取 theme.crowd.max
 * @param {boolean} [options.reduceMotion=false] 减少动态：小人原地站立、不摆腿
 * @returns {{
 *   group: Group,
 *   show: (walkways: Array, seed: number) => void,
 *   hide: () => void,
 *   update: (dt: number) => void,
 *   dispose: () => void,
 *   count: number,
 *   trianglesPerPerson: number,
 *   inspect: () => Array
 * }}
 */
export function createCrowd(theme, { max, reduceMotion = false } = {}) {
  const C = theme.crowd
  const cap = Math.max(0, Math.floor(max ?? C.max))
  const h = C.height

  /* ---- 几何、材质、实例网格 ---- */
  const geos = createGeometries(h)
  // 基色白，颜色全靠 instanceColor；平面着色让低多边形的面感更明显
  const material = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.8,
    flatShading: true
  })
  const group = new Group()
  group.name = "crowd"
  const makeMesh = (geo, name) => {
    const m = new InstancedMesh(geo, material, Math.max(1, cap))
    m.name = name
    m.count = 0
    m.castShadow = false // 阴影贴图是静态的，会动的东西一律不投影
    m.receiveShadow = true
    m.frustumCulled = false // 实例分散，默认包围球只包住原点处的一个人，会被误裁
    m.userData.animated = true
    group.add(m)
    return m
  }
  const body = makeMesh(geos.body, "crowd-body")
  const head = makeMesh(geos.head, "crowd-head")
  const hair = makeMesh(geos.hair, "crowd-hair")
  const legL = makeMesh(geos.leg, "crowd-leg-l")
  const legR = makeMesh(geos.leg, "crowd-leg-r")

  // 身体、头、发片实例矩阵完全相同：共用一个属性，每帧只写一份、只上传一次
  const bodyMatrix = body.instanceMatrix
  bodyMatrix.setUsage(DynamicDrawUsage)
  head.instanceMatrix = bodyMatrix
  hair.instanceMatrix = bodyMatrix
  legL.instanceMatrix.setUsage(DynamicDrawUsage)
  legR.instanceMatrix.setUsage(DynamicDrawUsage)
  // 颜色属性在首帧渲染前就要存在，着色器才会编进实例颜色；两条腿共用裤子颜色
  const colorAttr = () =>
    new InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3)
  body.instanceColor = colorAttr()
  head.instanceColor = colorAttr()
  hair.instanceColor = colorAttr()
  legL.instanceColor = colorAttr()
  legR.instanceColor = legL.instanceColor
  const colorAttrs = [
    body.instanceColor,
    head.instanceColor,
    hair.instanceColor,
    legL.instanceColor
  ]
  const meshes = [body, head, hair, legL, legR]
  const trianglesPerPerson =
    triangleCount(geos.body) +
    triangleCount(geos.head) +
    triangleCount(geos.hair) +
    triangleCount(geos.leg) * 2

  /* ---- 每人状态（结构化数组，避免每帧产生对象） ---- */
  const W = new Int16Array(cap) // 所在路径索引
  const S = new Float32Array(cap) // 沿路径弧长位置
  const D = new Int8Array(cap) // 行进方向 ±1
  const V = new Float32Array(cap) // 速度（米/秒）
  const O = new Float32Array(cap) // 横向偏移（米，中线左侧为正）
  const P = new Float32Array(cap) // 步态相位（弧度）
  const K = new Float32Array(cap) // 个体身高倍数
  const Y = new Float32Array(cap) // 当前朝向（弧度，局部 +Z 转到行进方向）
  const T = new Float32Array(cap) // 折返转身剩余时间（秒），0 表示不在转身
  const YF = new Float32Array(cap) // 转身起始朝向
  const TS = new Int8Array(cap) // 转身方向（±1，各人随机，免得整齐划一）
  const PX = new Float32Array(cap) // 最近一次更新的脚底位置（供 inspect）
  const PZ = new Float32Array(cap)

  let paths = []
  let n = 0 // 当前人数
  let fade = 0 // 淡入淡出进度 0～1
  let fadeDir = 0 // 1 淡入中、-1 淡出中、0 稳定
  let dirty = false // 减少动态模式下，静止后只需写一次矩阵
  const smp = { x: 0, z: 0, tx: 1, tz: 0 }
  const tmpColor = new Color()
  const pick = (list, rand) => list[Math.floor(rand() * list.length)]

  /** 立即清空（不淡出） */
  function clear() {
    n = 0
    paths = []
    fade = 0
    fadeDir = 0
    for (const m of meshes) m.count = 0
  }

  /**
   * 推进一个人并写入其实例矩阵。
   * 矩阵手工展开：person = 平移(x, y, z) · 绕 Y 旋转(yaw) · 缩放(k)；
   * 身体 = person · 平移(0, bob, 0)；腿 = person · 平移(±lx, 髋 + bob, 0) · 绕 X 旋转(±swing)
   */
  function step(i, dt, scale) {
    const p = paths[W[i]]
    let turning = T[i] > 0
    if (!reduceMotion && dt > 0) {
      const rate = (TAU * V[i]) / (STRIDE * h * K[i])
      if (turning) {
        // 原地转身：步子放慢一半，像在原地踏步转过来
        T[i] = Math.max(0, T[i] - dt)
        P[i] += rate * 0.5 * dt
        if (T[i] === 0) turning = false
      } else {
        let s = S[i] + D[i] * V[i] * dt
        const L = p.length
        if (p.closed) {
          s = ((s % L) + L) % L
        } else if (s > L || s < 0) {
          // 越过端点：按超出量反射回路径内，方向取反并开始转身
          s = s > L ? 2 * L - s : -s
          s = Math.min(L, Math.max(0, s))
          D[i] = -D[i]
          YF[i] = Y[i]
          T[i] = C.turn
          turning = C.turn > 0
        }
        S[i] = s
        P[i] += rate * dt
      }
      if (P[i] > TAU) P[i] -= TAU
    }

    samplePath(p, S[i], smp)
    // 横向偏移沿切线的左法向 (tz, -tx)
    const x = smp.x + O[i] * smp.tz
    const z = smp.z - O[i] * smp.tx
    PX[i] = x
    PZ[i] = z
    const target = Math.atan2(D[i] * smp.tx, D[i] * smp.tz)
    if (turning) {
      // 转身期间朝向从起始朝向匀速转过 π
      Y[i] = YF[i] + TS[i] * Math.PI * (1 - T[i] / C.turn)
    } else if (reduceMotion || dt <= 0) {
      Y[i] = target
    } else {
      // 顺带把朝向归一化到 [-π, π]，多次折返后不会越积越大
      Y[i] = wrapAngle(
        Y[i] + wrapAngle(target - Y[i]) * Math.min(1, YAW_RATE * dt)
      )
    }

    const k = K[i] * scale
    const c = Math.cos(Y[i])
    const sn = Math.sin(Y[i])
    const moving = !reduceMotion
    const swing = moving ? SWING * Math.sin(P[i]) : 0
    const bob = moving ? BOB * h * (Math.abs(Math.cos(P[i])) - 1) : 0
    const y = p.y

    // 身体 / 头 / 发片（共用矩阵）
    const mb = bodyMatrix.array
    let o = i * 16
    mb[o] = k * c
    mb[o + 1] = 0
    mb[o + 2] = -k * sn
    mb[o + 3] = 0
    mb[o + 4] = 0
    mb[o + 5] = k
    mb[o + 6] = 0
    mb[o + 7] = 0
    mb[o + 8] = k * sn
    mb[o + 9] = 0
    mb[o + 10] = k * c
    mb[o + 11] = 0
    mb[o + 12] = x
    mb[o + 13] = y + k * bob
    mb[o + 14] = z
    mb[o + 15] = 1

    // 左右腿：相位相差 π（摆角互为相反数）
    const hipY = y + k * (HIP * h + bob)
    for (let side = 0; side < 2; side++) {
      const th = side ? -swing : swing
      const lx = (side ? -LEG.x : LEG.x) * h
      const ct = Math.cos(th)
      const st = Math.sin(th)
      const m = (side ? legR : legL).instanceMatrix.array
      o = i * 16
      m[o] = k * c
      m[o + 1] = 0
      m[o + 2] = -k * sn
      m[o + 3] = 0
      m[o + 4] = k * sn * st
      m[o + 5] = k * ct
      m[o + 6] = k * c * st
      m[o + 7] = 0
      m[o + 8] = k * sn * ct
      m[o + 9] = -k * st
      m[o + 10] = k * c * ct
      m[o + 11] = 0
      m[o + 12] = x + k * c * lx
      m[o + 13] = hipY
      m[o + 14] = z - k * sn * lx
      m[o + 15] = 1
    }
  }

  /** 推进全部人并标记矩阵需上传 */
  function stepAll(dt) {
    // 淡入淡出用 smoothstep 缓动，起止都柔和
    const e = fade * fade * (3 - 2 * fade)
    for (let i = 0; i < n; i++) step(i, dt, e)
    bodyMatrix.needsUpdate = true
    legL.instanceMatrix.needsUpdate = true
    legR.instanceMatrix.needsUpdate = true
  }

  return {
    group,
    trianglesPerPerson,

    /** 当前人数 */
    get count() {
      return n
    },

    /**
     * 在给定路径上生成人群并淡入；已有人群直接替换（不等上一批淡出）。
     * @param {Array} walkways 步行路径（格式见文件头）
     * @param {number} seed 随机种子：同一站每次到站画面一致
     */
    show(walkways, seed) {
      clear()
      if (!cap) return
      const list = (Array.isArray(walkways) ? walkways : [])
        .map(preparePath)
        .filter(Boolean)
      if (!list.length) return
      const rand = mulberry32(seed)
      const counts = allocate(list, C.perMeter, cap)
      paths = list
      const [vMin, vMax] = C.speed
      list.forEach((p, wi) => {
        for (let k = 0; k < counts[wi] && n < cap; k++) {
          const i = n++
          W[i] = wi
          S[i] = rand() * p.length
          D[i] = rand() < 0.5 ? 1 : -1
          V[i] = vMin + (vMax - vMin) * rand()
          O[i] = (rand() - 0.5) * p.width
          P[i] = rand() * TAU
          K[i] = SIZE_MIN + SIZE_VAR * rand()
          T[i] = 0
          TS[i] = rand() < 0.5 ? 1 : -1
          // 初始朝向直接对准行进方向（不做平滑）
          samplePath(p, S[i], smp)
          Y[i] = Math.atan2(D[i] * smp.tx, D[i] * smp.tz)
          // 配色：衣服、肤色、发色、裤子各自随机
          body.setColorAt(i, tmpColor.set(pick(C.shirts, rand)))
          head.setColorAt(i, tmpColor.set(pick(C.skin, rand)))
          hair.setColorAt(i, tmpColor.set(pick(C.hair, rand)))
          legL.setColorAt(i, tmpColor.set(pick(C.pants, rand)))
        }
      })
      for (const m of meshes) m.count = n
      for (const a of colorAttrs) a.needsUpdate = true
      fade = C.fade > 0 ? 0 : 1
      fadeDir = C.fade > 0 ? 1 : 0
      dirty = true
      stepAll(0)
    },

    /** 淡出后回收；没有人时不做事 */
    hide() {
      if (!n) return
      if (!(C.fade > 0)) return clear()
      fadeDir = -1
    },

    /** 每帧推进（dt 秒）：沿路前进、折返、摆腿、起伏、淡入淡出 */
    update(dt) {
      if (!n) return
      const d = Number.isFinite(dt) && dt > 0 ? dt : 0
      // 只在时间确实前进时推进淡入淡出：dt = 0 时进度停在 0 / 1 端点，
      // 会被误判为「淡出完成」（刚 show 就清空）或「淡入完成」（取消 hide）
      if (fadeDir !== 0 && C.fade > 0 && d > 0) {
        fade += (fadeDir * d) / C.fade
        if (fade >= 1) {
          fade = 1
          fadeDir = 0
        } else if (fade <= 0) {
          clear()
          return
        }
        dirty = true
      }
      // 减少动态且淡入已完成：画面静止，不再重写矩阵
      if (reduceMotion && !dirty) return
      stepAll(d)
      dirty = false
    },

    /** 调试 / 测试用：每人当前脚底位置、朝向、所在路径与弧长 */
    inspect() {
      const out = []
      for (let i = 0; i < n; i++) {
        out.push({
          x: PX[i],
          y: paths[W[i]].y,
          z: PZ[i],
          yaw: Y[i],
          walkway: W[i],
          s: S[i],
          dir: D[i],
          offset: O[i],
          turning: T[i] > 0,
          scale: fade
        })
      }
      return out
    },

    dispose() {
      clear()
      for (const m of meshes) m.dispose()
      geos.body.dispose()
      geos.head.dispose()
      geos.hair.dispose()
      geos.leg.dispose()
      material.dispose()
      group.removeFromParent()
      group.clear()
    }
  }
}

/*
 * 小件：低多边形熊猫、游船、太阳神鸟金盘、图腾柱、低多边形树
 * ----------------------------------------------------------
 * 与 parts.js 相同：addXxx(b, parent, opts) 直接加进 ColorBuilder，parent 为 frame。
 * 熊猫要配 flatMaterial()（棱面分明的折纸感），应单独放进一个 ColorBuilder；
 * 其余小件配 landmarkMaterial()。
 */
import { Euler, IcosahedronGeometry, Matrix4, Quaternion, Vector3 } from "three"
import { THEME } from "../../theme.js"
import { local } from "./builder.js"
import { box, cylinder, fromTriangles, sphere } from "./shapes.js"
import { gableRoof } from "./roofs.js"

const L = THEME.landmark
const DEG = Math.PI / 180
const Y_UP = new Vector3(0, 1, 0)

/* ---------------- 熊猫 ---------------- */

/*
 * 熊猫各部件（单位为 PANDA_SPAN 分之一的总高）。坐标原点在女儿墙顶外沿：
 * y = 0 为墙顶，z = 0 为墙外立面，墙体在 z < 0 一侧；+Z 朝街（熊猫背部），
 * -Z 朝屋顶花园（头的朝向）。身体前倾 35°，肚皮压在墙顶外沿上，
 * 前爪搭到墙内屋面上，后腿垂在墙外立面前。
 */
const TILT = 35 * DEG
// 身体轴线（自臀部指向肩部）与肚皮方向（垂直于轴线、朝墙内偏下）
const AXIS = new Vector3(0, Math.cos(TILT), -Math.sin(TILT))
const BELLY = new Vector3(0, -Math.sin(TILT), -Math.cos(TILT))
// 脸的朝向：朝墙内并略低头；头顶方向与之垂直
const FACE = new Vector3(0, -0.35, -1).normalize()
const HEAD_UP = new Vector3(0, 1, -0.35).normalize()
// 各部件的竖向总跨度（脚底到耳尖），用于把 height 换算成部件单位
const PANDA_SPAN = 1.4

const v3 = (x, y, z) => new Vector3(x, y, z)
const at = (base, ...terms) => {
  const p = base.clone()
  for (const [dir, k] of terms) p.addScaledVector(dir, k)
  return p
}

/** 熊猫部件表：{ c 中心, r 三轴半径, q 朝向, black 是否黑色 } */
function pandaParts() {
  const X = v3(1, 0, 0)
  const bodyQ = new Quaternion().setFromEuler(new Euler(-TILT, 0, 0))
  // 胸口压在墙顶外沿上：身体沿轴线下移，臀部落到墙顶以下、贴着外立面
  const body = at(v3(0, 0, 0), [BELLY, -0.25], [AXIS, -0.14])
  const head = at(body, [AXIS, 0.47], [BELLY, 0.05])
  const faceQ = new Quaternion().setFromUnitVectors(v3(0, 0, 1), FACE)
  const parts = [
    // 身体（白）与肩带（黑）：肩带是略大一圈的扁椭球，只在胸口一段露出身体
    { c: body, r: [0.3, 0.4, 0.26], q: bodyQ, black: false },
    {
      c: at(body, [AXIS, 0.2]),
      r: [0.315, 0.15, 0.285],
      q: bodyQ,
      black: true
    },
    { c: head, r: [0.215, 0.19, 0.2], q: faceQ, black: false },
    // 尾巴（白）
    {
      c: at(body, [AXIS, -0.37], [BELLY, -0.13]),
      r: [0.07, 0.06, 0.06],
      q: bodyQ,
      black: false
    },
    // 鼻头
    {
      c: at(head, [FACE, 0.19], [HEAD_UP, -0.05]),
      r: [0.04, 0.03, 0.03],
      q: faceQ,
      black: true
    }
  ]
  for (const sx of [-1, 1]) {
    // 耳朵
    parts.push({
      c: at(head, [HEAD_UP, 0.165], [X, sx * 0.14], [FACE, -0.03]),
      r: [0.075, 0.075, 0.05],
      q: faceQ,
      black: true
    })
    // 眼圈：贴在脸上的扁椭球，外眼角下垂（绕脸轴转 ±25°）
    const eyeQ = faceQ
      .clone()
      .multiply(new Quaternion().setFromAxisAngle(v3(0, 0, 1), sx * 25 * DEG))
    parts.push({
      c: at(head, [FACE, 0.165], [X, sx * 0.078], [HEAD_UP, 0.02]),
      r: [0.05, 0.07, 0.045],
      q: eyeQ,
      black: true
    })
    // 前肢：肩部 → 搭在墙内屋面上的前爪
    parts.push(
      limb(
        at(body, [AXIS, 0.24], [X, sx * 0.21]),
        v3(sx * 0.27, 0.06, -0.44),
        0.1
      )
    )
    // 后腿：臀部 → 垂在墙外立面前的后脚
    parts.push(
      limb(
        at(body, [AXIS, -0.26], [X, sx * 0.17]),
        v3(sx * 0.2, -0.72, 0.1),
        0.12
      )
    )
  }
  return parts
}

/** 四肢：从关节 a 到末端 b 的长椭球，粗 r（两端各探出 r 的圆头） */
function limb(a, b, r) {
  const dir = b.clone().sub(a)
  const len = dir.length()
  return {
    c: a.clone().add(b).multiplyScalar(0.5),
    r: [r, len / 2 + r * 0.6, r],
    q: new Quaternion().setFromUnitVectors(Y_UP, dir.normalize()),
    black: true
  }
}

/**
 * 低多边形熊猫（配合 flatMaterial 使用）：二十面体（细分 1 次）拉伸成
 * 头、身体、四肢、耳朵；耳朵、眼圈、鼻头、四肢、肩带黑色，其余白色。
 * parent 可为 null（即世界坐标）。pose "climb"（目前唯一姿态）：身体前倾约 35°，前爪搭在墙顶内侧，后腿悬在墙外。
 * 局部原点为女儿墙顶外沿中点（y = 0 墙顶、z = 0 外立面，墙在 z < 0 一侧）；
 * +Z 为背部朝向（朝街），-Z 为头部朝向（朝屋顶花园）。
 * 竖向总高约 height：脚底约在 -0.56·height，耳尖约在 +0.44·height；
 * 前爪、鼻尖伸进墙内约 0.36·height，臀部离外立面约 0.47·height。
 * @param {object} [opts] { height = 15, pose = "climb" }
 */
export function addPanda(b, parent, { height = 15 } = {}) {
  // parent 可传 null，表示直接用世界坐标
  const base = parent ?? new Matrix4()
  const k = height / PANDA_SPAN
  const m = new Matrix4()
  const s = new Vector3()
  for (const p of pandaParts()) {
    const g = new IcosahedronGeometry(1, 1)
    m.compose(
      p.c.clone().multiplyScalar(k),
      p.q,
      s.set(...p.r).multiplyScalar(k)
    )
    b.add(g, p.black ? L.pandaBlack : L.pandaWhite, base.clone().multiply(m))
  }
}

/* ---------------- 游船 ---------------- */

/** 船体平面半宽（u ∈ [-0.5, 0.5] 为沿船长的位置，+0.5 为船头） */
function hullHalfWidth(u) {
  if (u >= 0.15) return 0.14 * Math.pow(Math.max(0, (0.5 - u) / 0.35), 0.7)
  const k = (0.15 - u) / 0.65
  return 0.14 * (1 - 0.4 * k * k)
}

/**
 * 游船：红色船身（船舷外张、船头尖）+ 金色舷边 + 4 根细柱 + 黄色悬山顶棚。
 * 船底在 y = 0，船长沿局部 X，船头朝 +X。
 * @param {object} [opts] { length = 14 }
 */
export function addBoat(b, parent, { length = 14 } = {}) {
  const Lh = length
  const hh = 0.1 * Lh // 船舷高
  const n = 16
  const top = []
  const bot = []
  for (let i = 0; i <= n; i++) {
    const u = -0.5 + i / n
    const hw = hullHalfWidth(u) * Lh
    top.push([u * Lh, hw])
    // 船底比船舷窄、比船身短，侧面外张
    bot.push([u * Lh * 0.9, hw * 0.65])
  }
  const pos = []
  // 四边形 → 两个三角形，写进 out
  const quad = (out, a, bb, c, d) =>
    out.push(...a, ...bb, ...c, ...a, ...c, ...d)
  for (const side of [1, -1]) {
    for (let i = 0; i < n; i++) {
      const t0 = [top[i][0], hh, side * top[i][1]]
      const t1 = [top[i + 1][0], hh, side * top[i + 1][1]]
      const b0 = [bot[i][0], 0, side * bot[i][1]]
      const b1 = [bot[i + 1][0], 0, side * bot[i + 1][1]]
      quad(pos, t0, t1, b1, b0)
      // 甲板（略低于船舷）
      const d0 = [top[i][0], hh * 0.85, side * top[i][1]]
      const d1 = [top[i + 1][0], hh * 0.85, side * top[i + 1][1]]
      quad(
        pos,
        d0,
        d1,
        [top[i + 1][0], hh * 0.85, 0],
        [top[i][0], hh * 0.85, 0]
      )
    }
  }
  // 船尾封板
  const sw = top[0][1]
  quad(
    pos,
    [top[0][0], hh, sw],
    [bot[0][0], 0, bot[0][1]],
    [bot[0][0], 0, -bot[0][1]],
    [top[0][0], hh, -sw]
  )
  b.add(fromTriangles(pos), L.lantern, parent)

  // 舷边金色压条
  const rail = []
  for (const side of [1, -1]) {
    for (let i = 0; i < n; i++) {
      const [x0, z0] = top[i]
      const [x1, z1] = top[i + 1]
      const y0 = hh * 0.8
      quad(
        rail,
        [x0, y0, side * z0],
        [x1, y0, side * z1],
        [x1, hh + 0.08, side * z1],
        [x0, hh + 0.08, side * z0]
      )
    }
  }
  b.add(fromTriangles(rail), L.gold, parent)

  // 顶棚：4 根细柱 + 黄色悬山小顶
  const postH = 0.13 * Lh
  const cw = 0.5 * Lh
  const cd = 0.17 * Lh
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.add(
        cylinder(0.012 * Lh, 0.012 * Lh, postH, { segments: 6 }),
        L.column,
        local(parent, (sx * cw) / 2 - 0.03 * Lh, hh * 0.85, (sz * cd) / 2)
      )
    }
  }
  b.add(
    gableRoof(cw, cd, 0.05 * Lh, { overhang: 0.025 * Lh, thick: 0.02 * Lh }),
    L.glaze,
    local(parent, -0.03 * Lh, hh * 0.85 + postH, 0)
  )
}

/* ---------------- 太阳神鸟金盘 ---------------- */

const LIGHT_GOLD = "#F3DA8C"
// 纹样离盘面的高度：城市总览距离下 24 位深度精度约 0.1 m，至少抬 0.15 m
const PATTERN_LIFT = 0.15

/**
 * 太阳神鸟金盘：金色薄圆盘 + 12 道旋转的镰刀形浅金光芒 + 中心小圆 + 外圈细环。
 * 盘底在 y = 0，盘厚 0.3 m，纹样浮在盘面上 0.15 m（远景深度精度下也不会与盘面闪烁）。
 * @param {object} [opts] { radius = 27 }
 */
export function addSunbirdDisc(b, parent, { radius = 27 } = {}) {
  const R = radius
  const th = 0.3
  b.add(cylinder(R, R, th, { segments: 48, caps: true }), L.gold, parent)
  const y = th + PATTERN_LIFT
  const pos = []
  const segs = 10
  for (let k = 0; k < 12; k++) {
    const a0 = (k / 12) * Math.PI * 2
    for (let i = 0; i < segs; i++) {
      // 光芒沿半径向外时顺时针扫过 40°，宽度由根部向尖端收窄
      const ray = (v) => {
        const r = R * (0.2 + 0.44 * v)
        const a = a0 + 40 * DEG * v
        const hw = 0.11 * Math.pow(1 - v, 0.8)
        return [
          [Math.cos(a - hw) * r, y, Math.sin(a - hw) * r],
          [Math.cos(a + hw) * r, y, Math.sin(a + hw) * r]
        ]
      }
      const [l0, r0] = ray(i / segs)
      const [l1, r1] = ray((i + 1) / segs)
      pos.push(...l0, ...r0, ...r1, ...l0, ...r1, ...l1)
    }
  }
  // 外圈细环（0.9R～0.95R）
  const ringN = 48
  for (let i = 0; i < ringN; i++) {
    const a0 = (i / ringN) * Math.PI * 2
    const a1 = ((i + 1) / ringN) * Math.PI * 2
    const p = (a, r) => [Math.cos(a) * r, y, Math.sin(a) * r]
    const i0 = p(a0, 0.9 * R)
    const o0 = p(a0, 0.95 * R)
    const i1 = p(a1, 0.9 * R)
    const o1 = p(a1, 0.95 * R)
    pos.push(...i0, ...o0, ...o1, ...i0, ...o1, ...i1)
  }
  b.add(fromTriangles(pos), LIGHT_GOLD, parent)
  b.add(
    cylinder(0.13 * R, 0.13 * R, PATTERN_LIFT + 0.05, {
      segments: 24,
      caps: true
    }),
    LIGHT_GOLD,
    local(parent, 0, th - 0.05, 0) // 顶面与光芒同高
  )
}

/* ---------------- 图腾柱 ---------------- */

const TOTEM_GREEN = "#2F5A48"

/**
 * 图腾柱：方形柱座 + 外方（下段方形套筒）内圆（圆柱身）+ 两道金箍 + 方形柱头 + 顶部金球。
 * 底在 y = 0，总高 h（含金球）。
 * @param {object} [opts] { h = 12, r = 0.6 }
 */
export function addTotem(b, parent, { h = 12, r = 0.6 } = {}) {
  const ball = 1.1 * r
  const capTop = h - 2 * ball
  const capH = 0.04 * h
  b.add(box(2.6 * r, 0.06 * h, 2.6 * r), TOTEM_GREEN, parent)
  b.add(
    box(2.1 * r, 0.44 * h, 2.1 * r),
    TOTEM_GREEN,
    local(parent, 0, 0.06 * h, 0)
  )
  b.add(
    cylinder(r, r * 0.92, capTop - capH - 0.06 * h, { segments: 12 }),
    TOTEM_GREEN,
    local(parent, 0, 0.06 * h, 0)
  )
  for (const f of [0.6, 0.72]) {
    b.add(
      cylinder(r * 1.08, r * 1.08, 0.02 * h, { segments: 12, caps: true }),
      L.gold,
      local(parent, 0, f * h, 0)
    )
  }
  b.add(
    box(2.2 * r, capH, 2.2 * r),
    TOTEM_GREEN,
    local(parent, 0, capTop - capH, 0)
  )
  b.add(sphere(ball, 14, 10), L.gold, local(parent, 0, capTop - 0.05 * r, 0))
}

/* ---------------- 低多边形树 ---------------- */

// 树冠模板（按细分级别缓存）：单位二十面体、去掉平滑法线，合批器按面重算，
// 得到与城市通用树一致的棱面。ColorBuilder.add 会复制一份再变换，模板可反复传入
const CROWNS = new Map()
function crownTemplate(detail) {
  let g = CROWNS.get(detail)
  if (!g) {
    g = new IcosahedronGeometry(1, detail)
    g.deleteAttribute("normal")
    CROWNS.set(detail, g)
  }
  return g
}

/**
 * 低多边形树：六棱柱树干 + 二十面体树冠（竖向拉长 1.15 倍，平面着色，与城市通用树一致），
 * 直接加进 ColorBuilder（配 landmarkMaterial）。
 * (x, y, z) 为世界坐标的树根，y 为树干底高度（地面、铺装或台基顶）。
 * 树冠中心在树根以上 trunkH + 0.95 r，树冠下沿离树根 trunkH − 0.2 r；
 * 树干高 trunkH + 0.4 r，顶端伸进树冠，树冠下沿不露缝。
 * @param {ColorBuilder} b
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {object} opts
 * @param {number} opts.r 树冠半径（米）
 * @param {string|Color} opts.color 树冠颜色
 * @param {number} [opts.trunkH=0.75·r] 见上
 * @param {string|Color} [opts.trunkColor=THEME.tree.trunk]
 * @param {number} [opts.trunkR=0.12·r] 树干底半径（顶端收为 0.75 倍）
 * @param {number} [opts.yaw=0] 树冠绕竖轴转角（弧度），多棵树时打散棱面朝向
 * @param {number} [opts.detail=1] 二十面体细分级别：1 为 80 面，0 为 20 面（远处小树省三角形）
 * @returns {number} 树冠顶高度
 */
export function addTree(b, x, y, z, opts) {
  const {
    r,
    color,
    trunkH = 0.75 * r,
    trunkColor = THEME.tree.trunk,
    trunkR = 0.12 * r,
    yaw = 0,
    detail = 1
  } = opts
  b.add(
    cylinder(trunkR, trunkR * 0.75, trunkH + 0.4 * r, { segments: 6 }),
    trunkColor,
    local(null, x, y, z)
  )
  const cy = y + trunkH + 0.95 * r
  b.add(
    crownTemplate(detail),
    color,
    local(null, x, cy, z, yaw, r, 1.15 * r, r)
  )
  return cy + 1.15 * r
}

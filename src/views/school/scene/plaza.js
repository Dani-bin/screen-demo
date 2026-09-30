/*
 * 中轴景观广场建模
 * ----------------------------------------------------------
 * 矩形景观水池 + 中央古典叠盘喷泉 + 两端圆池。
 *
 * 喷泉按实景照片里的三层叠盘式样做（基座 → 环绕雕像 → 大盘 → 中盘 → 小盘 → 顶饰）。
 * 三个要点：
 *  1. 盘、柱、基座全部用 LatheGeometry 车出轮廓 —— 古典喷泉本就是石材车削件，
 *     用圆柱体堆叠永远做不出那种外张的曲线，这是形体像不像的关键。
 *  2. 盘口的扇贝边（gadroon）靠在车削后按角度调制半径实现，见 scallop()，
 *     一个几何体就能出来，不必在盘沿上摆一圈小块。
 *  3. 水做三层：池底马赛克（不透明）→ 水面（半透明）→ 落水水幕。
 *     池水的蓝来自池底而不是水本身，这样才有通透感。
 */
import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3
} from "three"
import { PLAZA } from "./layout"
import { rectGround } from "./geometry"

/* 喷泉按「设计单位」建模，最后整体缩放到实际尺寸。
   这样轮廓表里的数字保持易读的比例，改大小只动这一个常数。 */
const FOUNTAIN_SCALE = 0.85

/* 水位：矩形池与圆池共用 */
const POOL_WATER_Y = 0.62
const POOL_FLOOR_Y = 0.06

/* 一张池底马赛克贴图覆盖的实际边长（米）。贴图是 8×8 块砖，
   即每块约 11cm。方池与圆池按各自尺寸缩放 UV，砖块大小才一致 */
const POOL_TILE_SPAN = 0.9

/** 由 [半径, 高度] 轮廓表车出回转体 */
function lathe(profile, material, segments = 48) {
  const pts = profile.map(([r, y]) => new Vector2(r, y))
  const mesh = new Mesh(new LatheGeometry(pts, segments), material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/**
 * 给车削件的外缘加扇贝边：半径按角度做 cos 调制。
 * 幅度从 fromR 处的 0 平滑增大到最外缘，
 * 否则调制区与未调制区之间会留下一道硬接缝。
 */
function scallop(geo, lobes, amp, fromR, toR) {
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const r = Math.hypot(x, z)
    if (r <= fromR) continue
    const t = Math.min(1, (r - fromR) / (toR - fromR))
    const k = 1 + amp * t * Math.cos(lobes * Math.atan2(z, x))
    pos.setX(i, x * k)
    pos.setZ(i, z * k)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

/**
 * 按实际米数缩放 UV。
 * 池底贴图的重复次数不能写死在材质上 —— 方池 6×19、圆池 7×7，
 * 同一个 repeat 会把砖块在方池里拉成长条，只能按各自尺寸逐几何体缩放。
 */
function tileUV(geo, w, d) {
  const uv = geo.attributes.uv
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(
      i,
      uv.getX(i) * (w / POOL_TILE_SPAN),
      uv.getY(i) * (d / POOL_TILE_SPAN)
    )
  }
  uv.needsUpdate = true
  return geo
}

/** 水平放置的圆面，用于水面与池底 */
function disc(radius, material, y, segments = 40) {
  const geo = new CircleGeometry(radius, segments)
  geo.rotateX(-Math.PI / 2)
  const mesh = new Mesh(geo, material)
  mesh.position.y = y
  mesh.receiveShadow = true
  return mesh
}

/**
 * 一股自由落水。
 * 几何原点移到水柱顶端，渲染循环里改 scale.y 时水柱只向下伸缩，
 * 顶端始终咬住盘沿；若原点留在中心，水柱会随起伏脱离盘口。
 */
function fallingStream(topR, len, material) {
  const geo = new CylinderGeometry(topR, topR * 1.25, len, 5, 1, true)
  geo.translate(0, -len / 2, 0)
  return new Mesh(geo, material)
}

/**
 * 盘口的连续水幕：一圈略微外张的薄锥面。
 * 没有它的话，水柱会凭空出现在盘沿下方，看不出水是从盘口漫出来的。
 */
function rimCurtain(radius, topY, height, material) {
  const geo = new CylinderGeometry(radius, radius + 0.05, height, 48, 1, true)
  const mesh = new Mesh(geo, material)
  mesh.position.y = topY - height / 2
  return mesh
}

/**
 * 沿盘沿排一圈落水，水柱同时收进 jets 交给渲染循环做起伏。
 * 水是从扇贝边的凸出点淌下来的，所以股数取扇贝瓣数的整除数，
 * 这样每股都正对一个瓣尖，而不是横穿在瓣与瓣之间。
 */
function rimStreams(group, jets, { count, radius, topY, length, r, material }) {
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count
    const s = fallingStream(r, length, material)
    s.position.set(Math.cos(a) * radius, topY, Math.sin(a) * radius)
    group.add(s)
    jets.push(s)
  }
}

/**
 * 环绕柱身的四尊石雕。按部位各建一个 InstancedMesh，
 * 四尊共用同一批几何体，避免为几块小构件多出十几个 draw call。
 *
 * 躯干用 Lathe 车出袍服的垂坠轮廓 —— 圆锥体在这个尺度下只会是一个土堆，
 * 有收腰和肩线才看得出是人形。
 */
function createFigures(material, radius, baseY) {
  const COUNT = 4
  /** 第 i 尊的方位角。错开 45°，朝向水池四角而不是正对短边 */
  const angleAt = (i) => (Math.PI * 2 * i) / COUNT + Math.PI / 4

  const robe = new LatheGeometry(
    [
      [0, 0],
      [0.25, 0],
      [0.23, 0.08],
      [0.19, 0.2],
      [0.155, 0.32],
      [0.14, 0.4], // 收腰
      [0.16, 0.5], // 胸
      [0.135, 0.58], // 肩
      [0.08, 0.62],
      [0, 0.63]
    ].map(([r, y]) => new Vector2(r, y)),
    14
  )

  const m = new Matrix4()
  const q = new Quaternion()
  const qYaw = new Quaternion()
  const qRoll = new Quaternion()
  const axisY = new Vector3(0, 1, 0)
  const axisX = new Vector3(1, 0, 0)
  const one = new Vector3(1, 1, 1)
  const pos = new Vector3()

  const bodies = new InstancedMesh(robe, material, COUNT)
  const heads = new InstancedMesh(
    new SphereGeometry(0.075, 12, 10),
    material,
    COUNT
  )
  /* 每尊两片翼，所以实例数翻倍。
     翼用压扁拉长的椭球而不是方盒 —— 方盒在这个尺度下只是一块插在背后的板，
     椭球才有羽翼那种收梢的轮廓 */
  const wingGeo = new SphereGeometry(0.16, 8, 6)
  wingGeo.scale(0.22, 1.5, 0.85)
  const wings = new InstancedMesh(wingGeo, material, COUNT * 2)

  for (let i = 0; i < COUNT; i++) {
    const a = angleAt(i)
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    q.setFromAxisAngle(axisY, -a)

    pos.set(cos * radius, baseY, sin * radius)
    bodies.setMatrixAt(i, m.compose(pos, q, one))
    pos.set(cos * radius, baseY + 0.7, sin * radius)
    heads.setMatrixAt(i, m.compose(pos, q, one))

    // 双翼在肩两侧向外张开。先在本地绕 X 倾斜再转到方位角，
    // 这样张开方向是沿切向的「左右展开」，而不是前后仰俯
    ;[-1, 1].forEach((side, k) => {
      qYaw.setFromAxisAngle(axisY, -a)
      qRoll.setFromAxisAngle(axisX, side * 0.42)
      pos.set(
        cos * (radius - 0.14) - sin * side * 0.12,
        baseY + 0.46,
        sin * (radius - 0.14) + cos * side * 0.12
      )
      wings.setMatrixAt(i * 2 + k, m.compose(pos, qYaw.multiply(qRoll), one))
    })
  }

  return [bodies, heads, wings].map((inst) => {
    inst.instanceMatrix.needsUpdate = true
    inst.castShadow = true
    return inst
  })
}

/** 中央三层叠盘喷泉 */
function createFountain(materials) {
  const group = new Group()
  const jets = []
  const stone = materials.fountainStone
  const jetMat = materials.waterJet

  /* ---- 基座 + 下柱身：一根连续轮廓，从池底一路收到大盘底 ---- */
  group.add(
    lathe(
      [
        [0, 0.3],
        [1.75, 0.3],
        [1.75, 0.66],
        [1.66, 0.74],
        [1.5, 0.78],
        [1.5, 1.02],
        [1.34, 1.1],
        [1.22, 1.15],
        [1.22, 1.4],
        [1.34, 1.46], // 出挑檐口，雕像立于其上
        [1.3, 1.54],
        [0.72, 1.58],
        [0.64, 1.7],
        [0.6, 2.05],
        [0.66, 2.18]
      ],
      stone,
      40
    )
  )

  /* ---- 环绕柱身的四尊石雕 ---- */
  createFigures(stone, 0.92, 1.46).forEach((part) => group.add(part))

  /* ---- 一层大盘 ---- */
  const bowl1 = lathe(
    [
      [0.66, 2.18],
      [0.95, 2.26],
      [1.32, 2.42],
      [1.66, 2.62],
      [1.88, 2.84],
      [1.98, 3.04],
      [2.06, 3.2], // 外缘
      [2.06, 3.28],
      [1.96, 3.32], // 口沿内翻
      [1.8, 3.24],
      [1.4, 3.08],
      [0.9, 2.98],
      [0.5, 2.96],
      [0, 2.96] // 盘底封口
    ],
    stone,
    96
  )
  scallop(bowl1.geometry, 20, 0.035, 1.2, 2.06)
  group.add(bowl1)
  group.add(disc(1.72, materials.bowlWater, 3.22))

  /* ---- 中柱 + 二层中盘 ---- */
  const bowl2 = lathe(
    [
      [0.3, 3.32],
      [0.34, 3.4],
      [0.3, 3.62],
      [0.26, 3.86],
      [0.34, 3.96],
      [0.6, 4.04],
      [0.92, 4.18],
      [1.14, 4.34],
      [1.26, 4.5],
      [1.32, 4.62], // 外缘
      [1.32, 4.68],
      [1.24, 4.71],
      [1.1, 4.64],
      [0.76, 4.52],
      [0.42, 4.46],
      [0, 4.46]
    ],
    stone,
    80
  )
  scallop(bowl2.geometry, 16, 0.04, 0.8, 1.32)
  group.add(bowl2)
  group.add(disc(1.02, materials.bowlWater, 4.62, 32))

  /* ---- 上柱 + 三层小盘 ---- */
  const bowl3 = lathe(
    [
      [0.22, 4.71],
      [0.24, 4.8],
      [0.2, 5.0],
      [0.18, 5.16],
      [0.24, 5.24],
      [0.42, 5.32],
      [0.6, 5.44],
      [0.7, 5.56],
      [0.74, 5.66], // 外缘
      [0.74, 5.71],
      [0.68, 5.73],
      [0.58, 5.66],
      [0.36, 5.58],
      [0.18, 5.55],
      [0, 5.55]
    ],
    stone,
    64
  )
  scallop(bowl3.geometry, 12, 0.045, 0.45, 0.74)
  group.add(bowl3)
  group.add(disc(0.52, materials.bowlWater, 5.64, 24))

  /* ---- 顶饰 ---- */
  group.add(
    lathe(
      [
        [0, 5.55],
        [0.12, 5.58],
        [0.15, 5.66],
        [0.1, 5.78],
        [0.17, 5.86],
        [0.1, 5.96],
        [0.05, 6.02],
        [0, 6.04]
      ],
      stone,
      20
    )
  )

  /* ---- 落水：每层盘口一圈水幕 + 若干股跌落 ---- */
  const poolWaterY = POOL_WATER_Y / FOUNTAIN_SCALE // 池面高度换算回设计单位
  group.add(rimCurtain(2.06, 3.28, 0.16, jetMat))
  rimStreams(group, jets, {
    count: 20, // 与 20 瓣扇贝边一一对应
    radius: 2.11,
    topY: 3.16,
    length: 3.16 - poolWaterY, // 落到矩形池水面
    r: 0.026,
    material: jetMat
  })
  group.add(rimCurtain(1.32, 4.68, 0.14, jetMat))
  rimStreams(group, jets, {
    count: 16, // 与 16 瓣扇贝边一一对应
    radius: 1.36,
    topY: 4.57,
    length: 4.57 - 3.22, // 落进一层大盘
    r: 0.023,
    material: jetMat
  })
  group.add(rimCurtain(0.74, 5.71, 0.11, jetMat))
  rimStreams(group, jets, {
    count: 12, // 与 12 瓣扇贝边一一对应
    radius: 0.77,
    topY: 5.62,
    length: 5.62 - 4.62, // 落进二层中盘
    r: 0.02,
    material: jetMat
  })

  /* 顶端涌泉：原点留在底端，起伏时向上窜 */
  const plumeLen = 0.6
  const plumeGeo = new CylinderGeometry(0.03, 0.09, plumeLen, 8, 1, true)
  plumeGeo.translate(0, plumeLen / 2, 0)
  const plume = new Mesh(plumeGeo, jetMat)
  plume.position.y = 6.02
  group.add(plume)
  jets.push(plume)

  const crown = new Mesh(new SphereGeometry(0.1, 12, 10), materials.foam)
  crown.position.y = 6.42
  crown.scale.set(1, 0.7, 1)
  group.add(crown)

  /* 入池水花：落在每股水柱脚下。
     早先用一整圈圆环，看着像给喷泉箍了道铁箍，反而更假 */
  const SPLASH = 20
  const splash = new InstancedMesh(
    new SphereGeometry(0.14, 10, 8),
    materials.foam,
    SPLASH
  )
  const sm = new Matrix4()
  const sq = new Quaternion()
  const sScale = new Vector3(1, 0.34, 1)
  const sPos = new Vector3()
  for (let i = 0; i < SPLASH; i++) {
    const a = (Math.PI * 2 * i) / SPLASH
    sPos.set(Math.cos(a) * 2.11, poolWaterY + 0.01, Math.sin(a) * 2.11)
    splash.setMatrixAt(i, sm.compose(sPos, sq, sScale))
  }
  splash.instanceMatrix.needsUpdate = true
  group.add(splash)

  group.scale.setScalar(FOUNTAIN_SCALE)
  return { group, jets }
}

/** 两端圆池：池壁压顶 + 马赛克池底 + 水面 + 中央涌泉 */
function createRoundPool(materials) {
  const group = new Group()
  const jets = []

  // 池壁做成一圈剖面（内壁 → 压顶 → 外壁）。
  // 用实心圆柱的话，水面会浮在一块石饼的顶上，看不出是个池子
  group.add(
    lathe(
      [
        [3.6, 0],
        [3.6, 0.78],
        [3.68, 0.86],
        [4.16, 0.86],
        [4.25, 0.78],
        [4.25, 0]
      ],
      materials.stone,
      36
    )
  )
  const floor = disc(3.6, materials.poolTile, POOL_FLOOR_Y, 36)
  tileUV(floor.geometry, 7.2, 7.2)
  group.add(floor)
  group.add(disc(3.58, materials.water, POOL_WATER_Y, 36))

  // 中央涌泉：矮石座 + 一束上窜的水
  const nozzle = new Mesh(
    new CylinderGeometry(0.3, 0.46, 0.7, 14),
    materials.fountainStone
  )
  nozzle.position.y = 0.35
  nozzle.castShadow = true
  group.add(nozzle)

  const len = 1.5
  const geo = new CylinderGeometry(0.05, 0.13, len, 8, 1, true)
  geo.translate(0, len / 2, 0)
  const plume = new Mesh(geo, materials.waterJet)
  plume.position.y = 0.7
  group.add(plume)
  jets.push(plume)

  const foamRing = new Mesh(
    new TorusGeometry(0.62, 0.08, 6, 24),
    materials.foam
  )
  foamRing.rotation.x = Math.PI / 2
  foamRing.position.y = POOL_WATER_Y + 0.02
  group.add(foamRing)

  return { group, jets }
}

export function createPlaza(materials) {
  const group = new Group()
  const jets = []
  const { x, z, poolW, poolD, roundPoolOffset } = PLAZA

  // 池沿：必须做成中空的四条边框，若用一个实心 Box，
  // 水面平面会整个埋在体块内部，画面上只剩一块石板
  const RIM = 0.6
  const RIM_H = 0.85
  const rimSpecs = [
    [poolW / 2 - RIM / 2, 0, RIM, poolD],
    [-(poolW / 2 - RIM / 2), 0, RIM, poolD],
    [0, poolD / 2 - RIM / 2, poolW, RIM],
    [0, -(poolD / 2 - RIM / 2), poolW, RIM]
  ]
  rimSpecs.forEach(([rx, rz, rw, rd]) => {
    const rim = new Mesh(new BoxGeometry(rw, RIM_H, rd), materials.stone)
    rim.position.set(rx, RIM_H / 2, rz)
    rim.castShadow = true
    rim.receiveShadow = true
    group.add(rim)
  })

  // 池底马赛克 + 略低于池沿的水面
  const innerW = poolW - RIM * 2
  const innerD = poolD - RIM * 2
  const floor = rectGround(
    innerW,
    innerD,
    materials.poolTile,
    0,
    POOL_FLOOR_Y,
    0
  )
  tileUV(floor.geometry, innerW, innerD)
  group.add(floor)
  group.add(rectGround(innerW, innerD, materials.water, 0, POOL_WATER_Y, 0))

  // 两端圆池
  ;[-roundPoolOffset, roundPoolOffset].forEach((dz) => {
    const pool = createRoundPool(materials)
    pool.group.position.z = dz
    group.add(pool.group)
    jets.push(...pool.jets)
  })

  // 中央叠盘喷泉
  const fountain = createFountain(materials)
  group.add(fountain.group)
  jets.push(...fountain.jets)

  group.position.set(x, 0, z)
  group.userData.stop = 1
  return { group, jets }
}

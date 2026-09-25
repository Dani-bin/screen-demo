/*
 * 常规楼栋建模
 * ----------------------------------------------------------
 * 每栋楼 = 石材基座 + 红砖墙身 + 白色檐口 + 四坡屋顶。
 * 墙身用 BoxGeometry 的材质数组，X 向与 Z 向两面各用一份按自身
 * 宽度换算重复次数的立面贴图 —— 否则短边会被拉伸变形。
 */
import { BoxGeometry, Group, Mesh } from "three"
import { createFence } from "./fence"
import { hipRoofGeometry } from "./geometry"
import { BUILDINGS, WALLS } from "./layout"

/** 层高（米），实拍照片中为普通小学教学楼层高 */
const FLOOR_HEIGHT = 3.6
/** 石材基座高度 */
const BASE_HEIGHT = 1.1

/**
 * 建一栋常规楼。
 * @param {object} opts 来自 layout.BUILDINGS 的一项
 * @param {object} materials 共享材质
 */
export function createBuilding(opts, materials) {
  const { w, d, floors = 4 } = opts
  const bodyHeight = floors * FLOOR_HEIGHT
  const group = new Group()

  // 石材基座：比墙身略外扩，形成实拍照片里的勒脚
  const base = new Mesh(
    new BoxGeometry(w + 0.7, BASE_HEIGHT, d + 0.7),
    materials.stone
  )
  base.position.y = BASE_HEIGHT / 2
  base.castShadow = true
  base.receiveShadow = true
  group.add(base)

  /* 墙身拆成两段：首层是连续拱廊（过道），以上才是拱窗。
     实拍照片里教学楼底层为通透的连廊，整栋从上到下都开窗是不对的。
     +X/-X 两面按进深取开间数，+Z/-Z 两面按面宽取开间数，
     否则短边会被横向拉伸。 */
  const groundHeight = FLOOR_HEIGHT
  const upperFloors = Math.max(0, floors - 1)
  const upperHeight = upperFloors * FLOOR_HEIGHT

  /* 首层拱廊的拱数要和上层立柱对齐：
     该面上层若是外廊，按「教室数 × 每间开间数」取；否则按常规开间。 */
  const corridorFaces = opts.corridor || []
  const arcadeBays = (face, faceWidth) =>
    corridorFaces.includes(face)
      ? materials.corridorArcadeBays(faceWidth)
      : undefined

  const arcadeX = materials.getArcade(d, arcadeBays("+x", d))
  const arcadeXNeg = materials.getArcade(d, arcadeBays("-x", d))
  const arcadeZ = materials.getArcade(w, arcadeBays("+z", w))
  const arcadeZNeg = materials.getArcade(w, arcadeBays("-z", w))
  const ground = new Mesh(new BoxGeometry(w, groundHeight, d), [
    arcadeX,
    arcadeXNeg,
    materials.stone,
    materials.stone,
    arcadeZ,
    arcadeZNeg
  ])
  ground.position.y = BASE_HEIGHT + groundHeight / 2
  ground.castShadow = true
  ground.receiveShadow = true
  group.add(ground)

  if (upperFloors > 0) {
    /* 上层并非每一面都是窗墙：临院一侧常做开敞外廊（砖柱 + 白栏杆 +
       教室门与窗），其余面才开拱窗。opts.corridor 列出走外廊的面，
       取值对应 BoxGeometry 的材质数组顺序 +X, -X, +Y, -Y, +Z, -Z。 */
    const faceMaterial = (face, faceWidth) =>
      corridorFaces.includes(face)
        ? materials.getCorridor(faceWidth, upperFloors)
        : materials.getFacade(faceWidth, upperFloors)

    const upper = new Mesh(new BoxGeometry(w, upperHeight, d), [
      faceMaterial("+x", d),
      faceMaterial("-x", d),
      materials.stone,
      materials.stone,
      faceMaterial("+z", w),
      faceMaterial("-z", w)
    ])
    upper.position.y = BASE_HEIGHT + groundHeight + upperHeight / 2
    upper.castShadow = true
    upper.receiveShadow = true
    group.add(upper)
  }

  // 白色檐口
  const cornice = new Mesh(
    new BoxGeometry(w + 1.1, 0.75, d + 1.1),
    materials.trim
  )
  cornice.position.y = BASE_HEIGHT + bodyHeight + 0.37
  cornice.castShadow = true
  group.add(cornice)

  // 四坡屋顶：坡高随进深变化，出檐 0.55m
  const roofHeight = Math.min(w, d) * 0.24 + 1.1
  const roof = new Mesh(
    hipRoofGeometry(w + 1.1, d + 1.1, roofHeight),
    materials.roof
  )
  roof.position.y = BASE_HEIGHT + bodyHeight + 0.75
  roof.castShadow = true
  group.add(roof)

  group.position.set(opts.x, 0, opts.z)
  // 供射线拾取用：点击本楼跳转到哪个地标
  group.userData.stop = opts.stop
  group.userData.name = opts.name
  return group
}

/** 建全部常规楼栋 */
export function createBuildings(materials) {
  const group = new Group()
  BUILDINGS.forEach((b) => group.add(createBuilding(b, materials)))
  return group
}

/**
 * 校园周界：除正大门外全部是铁艺围栏（砖基座 + 砖柱 + 黑色栅栏），
 * 依据校门实拍照片 —— 并非整圈实心砖墙。南侧分两段，中间缺口留给校门。
 */
export function createWalls(materials) {
  const segments = WALLS.map(([x, z, w, d]) => {
    // 长边方向即该段走向：w > d 为东西向，否则为南北向
    const isEastWest = w > d
    return {
      x,
      z,
      length: isEastWest ? w : d,
      rotY: isEastWest ? 0 : Math.PI / 2
    }
  })
  return createFence(materials, segments)
}

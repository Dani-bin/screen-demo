/*
 * 共享材质
 * ----------------------------------------------------------
 * 全场景复用同一批材质实例，避免每栋楼各建一份导致 draw call 膨胀
 * —— 大屏需要长时间常驻运行，这一点直接影响帧率与显存。
 *
 * 立面材质按「楼宽 + 层数」缓存：贴图重复次数取决于这两个值，
 * 相同规格的墙面复用同一个材质。
 */
import { DoubleSide, LineBasicMaterial, MeshStandardMaterial } from "three"
import {
  createArcadeTexture,
  createClockFaceTexture,
  createCorridorTexture,
  createFacadeTexture,
  createGrassTexture,
  createPavingTexture,
  createPoolTileTexture,
  createSignTexture,
  createTurfTexture
} from "./textures"

/**
 * 一个开间的宽度（米），窗墙面与其下方的拱廊共用。
 * 取 4.2m —— 早先取 3m 时每层窗户过密，整面墙像幕墙。
 */
const BAY_WIDTH = 4.2

/** 一间教室的开间宽度（米）：一扇门 + 若干窗为一个单元 */
const CLASSROOM_WIDTH = 11

/** 每层楼的教室数上限。一层排出十来间教室是不合理的 */
const MAX_CLASSROOMS = 4

/** 一间教室占三个开间（对应外廊贴图里画的三根立柱间距） */
const BAYS_PER_CLASSROOM = 3

export function createMaterials() {
  const materials = {
    // 屋顶：DoubleSide 让自定义四坡屋顶几何无论朝向都能正确受光
    roof: new MeshStandardMaterial({
      color: "#3B434F",
      roughness: 0.93,
      metalness: 0,
      side: DoubleSide,
      flatShading: true
    }),
    trim: new MeshStandardMaterial({ color: "#F7F3EC", roughness: 0.72 }),
    stone: new MeshStandardMaterial({ color: "#8C8880", roughness: 0.9 }),
    brick: new MeshStandardMaterial({ color: "#A6503C", roughness: 0.88 }),
    brickDeep: new MeshStandardMaterial({ color: "#8C3F2E", roughness: 0.88 }),
    paving: new MeshStandardMaterial({
      map: createPavingTexture(26),
      roughness: 0.94
    }),
    // 入口梯形广场铺装。ShapeGeometry 的 UV 直接等于米制坐标，
    // 因此重复次数按「每米几块」给，而非像矩形平面那样按整块面给。
    forecourt: new MeshStandardMaterial({
      map: createPavingTexture(0.6),
      // 叠一层暖色，对应实景中偏红褐的砖铺地
      color: "#C98D71",
      roughness: 0.95
    }),
    grass: new MeshStandardMaterial({
      map: createGrassTexture(40),
      roughness: 1
    }),
    // 内场草皮用 ShapeGeometry 铺设，其 UV 直接等于米制坐标，
    // 因此重复次数按「每米几块」给：0.25 即 4 米一块、割草条纹宽 2 米。
    turf: new MeshStandardMaterial({
      map: createTurfTexture(0.25, 0.25),
      roughness: 1
    }),
    track: new MeshStandardMaterial({ color: "#BE5238", roughness: 0.96 }),
    court: new MeshStandardMaterial({ color: "#3F6B96", roughness: 0.9 }),
    // 池底马赛克。水面是半透明的，池水呈现的蓝主要来自这一层，
    // 因此池底单独建一片，不能只把水染成蓝色
    // 重复次数固定为 1，实际砖块大小由各水池自己按米数缩放 UV 决定，
    // 否则方池被拉长、圆池被压扁，同一张贴图会出现两种砖形
    poolTile: new MeshStandardMaterial({
      map: createPoolTileTexture(1),
      roughness: 0.55
    }),
    // 水面：清透的浅青，靠透出池底马赛克成色
    water: new MeshStandardMaterial({
      color: "#78C6DC",
      roughness: 0.06,
      metalness: 0.4,
      transparent: true,
      opacity: 0.68
    }),
    // 盘内的水只是薄薄一层，不能沿用池水那种厚重的蓝，
    // 否则每个盘子里都像扣了一块蓝色塑料板
    bowlWater: new MeshStandardMaterial({
      color: "#D6EFF6",
      roughness: 0.04,
      metalness: 0.55,
      transparent: true,
      opacity: 0.55
    }),
    // 喷泉石雕：暖米黄洞石。盘状构件用 Lathe 车出，
    // 内外壁同属一张曲面，必须 DoubleSide 否则盘内会漏成黑色
    fountainStone: new MeshStandardMaterial({
      color: "#E8DCC2",
      roughness: 0.78,
      side: DoubleSide
    }),
    // 落水水幕：白亮且很薄。透明度压得低，水柱才像水而不像白棍
    waterJet: new MeshStandardMaterial({
      color: "#F4FBFD",
      transparent: true,
      opacity: 0.34,
      roughness: 0.08,
      metalness: 0.2,
      depthWrite: false
    }),
    // 落水入池处的白色水花
    foam: new MeshStandardMaterial({
      color: "#FFFFFF",
      transparent: true,
      opacity: 0.55,
      roughness: 0.35
    }),
    line: new LineBasicMaterial({ color: "#F2F2EE" }),
    trunk: new MeshStandardMaterial({ color: "#6B5340", roughness: 0.95 }),
    /* 树冠：基色必须是白色 —— 实际绿色由 InstancedMesh 的 instanceColor
       逐棵给出（两者相乘），这样每棵树的深浅才能不同。
       flatShading 让不规则球面呈现成团的叶簇，比光滑球面更像树。 */
    leaf: new MeshStandardMaterial({
      color: "#ffffff",
      roughness: 0.95,
      flatShading: true
    }),
    ground: new MeshStandardMaterial({ color: "#9AA093", roughness: 1 }),
    flag: new MeshStandardMaterial({
      color: "#C0392B",
      side: DoubleSide,
      roughness: 0.85
    }),
    rock: new MeshStandardMaterial({
      color: "#A8A093",
      roughness: 0.98,
      flatShading: true
    }),
    // 钟楼表盘：刻度与 1~12 数字已画进贴图
    clockFace: new MeshStandardMaterial({
      map: createClockFaceTexture(),
      roughness: 0.5
    }),
    // 时针分针：比屋顶色更深一点，在米白盘面上对比更清楚
    clockHand: new MeshStandardMaterial({
      color: "#23282F",
      roughness: 0.45,
      metalness: 0.35
    }),
    // 铁艺门扇与栅栏
    iron: new MeshStandardMaterial({
      color: "#22262B",
      roughness: 0.45,
      metalness: 0.55
    }),
    // 校名牌面板：文字已画进贴图
    sign: new MeshStandardMaterial({
      map: createSignTexture(),
      roughness: 0.6
    })
  }

  /* 墙面材质缓存：key 为「类型_开间数_层数」，相同规格的墙面复用同一份 */
  const facadeCache = new Map()

  /** 按墙面实际宽度换算开间数 */
  const bayCount = (widthMeters) =>
    Math.max(1, Math.round(widthMeters / BAY_WIDTH))

  /**
   * 按墙面宽度换算该层的教室数（外廊贴图的重复次数）。
   * 上限 MAX_CLASSROOMS —— 再长的楼也不会一层排出十几间教室，
   * 超长时是把每间教室摊宽，而不是增加间数。
   */
  materials.classroomUnits = (widthMeters) =>
    Math.min(
      MAX_CLASSROOMS,
      Math.max(1, Math.round(widthMeters / CLASSROOM_WIDTH))
    )

  /** 外廊面下方的首层拱廊要与上层立柱对齐：拱数 = 教室数 × 每间开间数 */
  materials.corridorArcadeBays = (widthMeters) =>
    materials.classroomUnits(widthMeters) * BAYS_PER_CLASSROOM

  /**
   * 取一面墙的立面材质（拱窗）。
   *
   * 注意 widthMeters 要传「这张贴图实际铺开的宽度」：
   * BoxGeometry 每个面的 UV 各自是 0..1，传该面宽度即可；
   * 而 CylinderGeometry 的侧面 UV 是绕整圈走 0..1，必须传整个周长，
   * 否则开间会被摊到整圈上、横向拉伸成变形的大窗。
   *
   * @param {number} widthMeters 这张贴图铺开的宽度（米）
   * @param {number} floors 竖向重复的层数
   */
  materials.getFacade = (widthMeters, floors, baysOverride) => {
    const bays = baysOverride || bayCount(widthMeters)
    const key = `facade_${bays}_${floors}`
    if (!facadeCache.has(key)) {
      facadeCache.set(
        key,
        new MeshStandardMaterial({
          map: createFacadeTexture(bays, floors),
          roughness: 0.88
        })
      )
    }
    return facadeCache.get(key)
  }

  /**
   * 取上层外廊材质。翼楼临院一侧是开敞连廊：
   * 砖砌立柱 + 白色栏杆 + 凹进去的教室门与门边小窗，并非整面窗墙。
   * @param {number} widthMeters 这张贴图铺开的宽度（米）
   * @param {number} floors 竖向重复的层数
   */
  materials.getCorridor = (widthMeters, floors) => {
    const units = materials.classroomUnits(widthMeters)
    const key = `corridor_${units}_${floors}`
    if (!facadeCache.has(key)) {
      facadeCache.set(
        key,
        new MeshStandardMaterial({
          map: createCorridorTexture(units, floors),
          roughness: 0.88
        })
      )
    }
    return facadeCache.get(key)
  }

  /**
   * 取首层拱廊材质。教学楼底层是灰色石材砌的连续拱廊（过道），不开窗。
   * @param {number} widthMeters 这张贴图铺开的宽度（米）
   */
  materials.getArcade = (widthMeters, baysOverride) => {
    const bays = baysOverride || bayCount(widthMeters)
    const key = `arcade_${bays}`
    if (!facadeCache.has(key)) {
      facadeCache.set(
        key,
        new MeshStandardMaterial({
          map: createArcadeTexture(bays, 1),
          roughness: 0.88
        })
      )
    }
    return facadeCache.get(key)
  }

  /** 释放全部材质与贴图，页面卸载时调用 */
  materials.dispose = () => {
    const all = [...Object.values(materials), ...facadeCache.values()]
    all.forEach((m) => {
      if (!m || typeof m.dispose !== "function") return
      if (m.map) m.map.dispose()
      m.dispose()
    })
    facadeCache.clear()
  }

  return materials
}

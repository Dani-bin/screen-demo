/*
 * 太阳阴影范围：整城 / 按站点收紧
 * ----------------------------------------------------------
 * 整城一张 4096 阴影贴图覆盖约 7.8 km，每个 texel 约 1.9 m，
 * 景点的柱子、檐下、栏杆阴影会全部糊掉。巡览停靠某站时，
 * 把阴影正交相机收紧到站点周围 ±R 米（R = 1000 时约 0.5 m/texel），
 * 回总览 / 离站时恢复整城范围。
 * 代价：停靠期间离站点 R 以外的楼没有阴影（站点机位视野基本落在 R 以内）。
 *
 * 两个函数只改太阳与阴影相机参数，调用方负责置 renderer.shadowMap.needsUpdate = true。
 * CityScene 与 lab 预览页共用，保证预览截图与线上停靠时一致。
 */
import { Vector3 } from "three"

/** 停靠站点时的阴影半径（米） */
export const STOP_SHADOW_RADIUS = 1000

// 太阳到收紧中心的距离（米）：远大于 1.5R，保证光源在全部投影物之上
const SUN_DISTANCE = 2000

/**
 * 整城阴影：太阳在 light.sunPosition、朝向原点，范围与偏移取 theme.light。
 * @param {THREE.DirectionalLight} sun
 * @param {object} light THEME.light
 */
export function applyCityShadow(sun, light) {
  sun.position.set(...light.sunPosition)
  sun.target.position.set(0, 0, 0)
  // 阴影正交范围要覆盖整个城区，小了会出现阴影被截断的硬边
  Object.assign(sun.shadow.camera, light.shadowBox)
  sun.shadow.camera.updateProjectionMatrix()
  // 偏移量见 theme.light.shadowBias / shadowNormalBias 的注释
  sun.shadow.bias = light.shadowBias
  sun.shadow.normalBias = light.shadowNormalBias
}

/**
 * 按站点收紧阴影：光照方向不变，太阳沿该方向放在 center 上方 SUN_DISTANCE 米处，
 * 正交范围 ±radius，深度范围 SUN_DISTANCE ± 1.5·radius（覆盖高楼与其投影落点）。
 * @param {THREE.DirectionalLight} sun
 * @param {object} light THEME.light（取 sunPosition 作为光照方向）
 * @param {number[]} center 收紧中心 [x, y, z]
 * @param {number} [radius=STOP_SHADOW_RADIUS]
 */
export function applyStopShadow(
  sun,
  light,
  center,
  radius = STOP_SHADOW_RADIUS
) {
  const dir = new Vector3(...light.sunPosition).normalize()
  const c = new Vector3(...center)
  sun.position.copy(c).addScaledVector(dir, SUN_DISTANCE)
  sun.target.position.copy(c)
  Object.assign(sun.shadow.camera, {
    left: -radius,
    right: radius,
    top: radius,
    bottom: -radius,
    near: SUN_DISTANCE - radius * 1.5,
    far: SUN_DISTANCE + radius * 1.5
  })
  sun.shadow.camera.updateProjectionMatrix()
  // 正交深度线性：深度范围 3R 米，bias × 3R ≈ 0.15 m 沿光线的偏移；
  // texel 约 2R/4096 米（R = 1000 时约 0.5 m），法线偏移取 0.15 m 足以消除条纹又不漏光
  sun.shadow.bias = -0.15 / (radius * 3)
  sun.shadow.normalBias = 0.15
}

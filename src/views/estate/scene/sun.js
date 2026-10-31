/**
 * 太阳位置与一天的光照
 * ----------------------------------------------------------
 * 按成都经纬度和日期算太阳方位 / 高度（NOAA 简化公式），再给出主光、半球光、窗灯点亮程度。
 * 只有一个太阳：实时平行光、窗灯曲线、背景色调都用这里的同一组数。
 */
import * as THREE from "three"
import { THEME } from "./theme.js"

const rad = (d) => (d * Math.PI) / 180
const deg = (r) => (r * 180) / Math.PI
const clamp01 = (x) => Math.min(1, Math.max(0, x))
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** 一年中的第几天 */
function dayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0)
  return Math.floor((date.getTime() - start) / 86400000)
}

/**
 * 太阳方位（从正北顺时针，度）和高度角（度）
 * @param {number} month 月（1–12） @param {number} day 日
 * @param {number} hour 北京时间的小时（可带小数）
 */
export function sunPosition(month, day, hour) {
  const { lat, lon, tz } = THEME.site
  const n = dayOfYear(new Date(Date.UTC(2026, month - 1, day)))
  // 年角（弧度）、时差（分钟）、赤纬（弧度）
  const g = ((2 * Math.PI) / 365) * (n - 1 + (hour - 12) / 24)
  const eqt =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g))
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g)
  // 真太阳时（分钟）→ 时角
  const tst = hour * 60 + eqt + 4 * lon - 60 * tz
  const ha = rad(tst / 4 - 180)
  const la = rad(lat)
  const cosZ =
    Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha)
  const zen = Math.acos(Math.min(1, Math.max(-1, cosZ)))
  const el = 90 - deg(zen)
  // 方位：从正北顺时针
  const sinAz = (-Math.cos(decl) * Math.sin(ha)) / Math.sin(zen || 1e-6)
  const cosAz =
    (Math.sin(decl) - Math.sin(la) * cosZ) /
    (Math.cos(la) * Math.sin(zen || 1e-6))
  let az = deg(Math.atan2(sinAz, cosAz))
  if (az < 0) az += 360
  return { az, el }
}

const SUN_LOW = new THREE.Color(0xffbb80) // 日出日落的橙
const SUN_MID = new THREE.Color(0xffd9a3)
const SUN_HIGH = new THREE.Color(0xfff3de)
const SKY_DAY = new THREE.Color(0xf4ead8)
const SKY_DUSK = new THREE.Color(0xd9a77a)
const SKY_NIGHT = new THREE.Color(0x27355c)
const GROUND_DAY = new THREE.Color(0xa89270)
const GROUND_NIGHT = new THREE.Color(0x1a1410)

/**
 * 某一时刻的光照参数
 * @returns {{dir: THREE.Vector3, el: number, az: number, sunColor: THREE.Color,
 *   sunIntensity: number, hemiSky: THREE.Color, hemiGround: THREE.Color,
 *   hemiIntensity: number, lit: number, night: number}}
 *   dir：从场景指向太阳的单位向量（three.js 坐标）；lit：窗灯 / 路灯点亮程度 0–1
 */
export function lightAt(month, day, hour) {
  const { az, el } = sunPosition(month, day, hour)
  const a = rad(az)
  const e = rad(Math.max(el, -6))
  // three.js：x 向东、z 向南（= -北），y 向上
  const dir = new THREE.Vector3(
    Math.sin(a) * Math.cos(e),
    Math.sin(e),
    -Math.cos(a) * Math.cos(e)
  ).normalize()

  const day01 = smooth(-1, 10, el) // 太阳升起后的白天程度
  const high = smooth(6, 40, el)
  const sunColor = SUN_LOW.clone()
    .lerp(SUN_MID, smooth(0, 12, el))
    .lerp(SUN_HIGH, high)
  // 展厅里的"太阳"更柔：强度不到户外的一半，夜里关掉
  const sunIntensity = 2.6 * smooth(-1.5, 10, el)

  const hemiSky = SKY_NIGHT.clone()
    .lerp(SKY_DUSK, smooth(-6, 2, el))
    .lerp(SKY_DAY, smooth(2, 20, el))
  const hemiGround = GROUND_NIGHT.clone().lerp(GROUND_DAY, day01)
  const hemiIntensity = 0.8 + 0.5 * day01

  const { onFrom, onFull } = THEME.lights
  const lit = clamp01((onFrom - el) / (onFrom - onFull))
  return {
    dir,
    el,
    az,
    sunColor,
    sunIntensity,
    hemiSky,
    hemiGround,
    hemiIntensity,
    lit,
    night: 1 - day01
  }
}

/** 小时数 → "HH:MM" */
export function hhmm(hour) {
  const h = Math.floor(hour)
  const m = Math.round((hour - h) * 60)
  const hh = m === 60 ? h + 1 : h
  return `${String(hh).padStart(2, "0")}:${String(m === 60 ? 0 : m).padStart(2, "0")}`
}

/** 时间段名称（切换条和顶部时钟显示） */
export function periodName(hour, el) {
  if (el < -2) return hour < 12 ? "凌晨" : "夜晚"
  if (hour < 9) return "清晨"
  if (hour < 12) return "上午"
  if (hour < 14) return "正午"
  if (hour < 17) return "午后"
  if (el > 0 && el < 14) return "黄昏"
  return el > 0 ? "傍晚" : "夜晚"
}

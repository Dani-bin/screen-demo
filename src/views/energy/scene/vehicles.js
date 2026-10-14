/*
 * 综合能源补给站 车辆：克隆、沿路径行驶、牵引车 + 挂车铰接
 * ----------------------------------------------------------
 * 车辆预制来自 public/energy/vehicles.glb（scripts/blender/energy/vehicles.py + vendor.py）：
 *   car_sedan / car_suv、truck_tractor / truck_tractor_b（两款牵引车）、trailer_box / trailer_tank，
 *   车头朝 +x，原点在地面上；车轴位置在 userData.rig_*（glTF extras）。
 *
 * 行驶模型（够用的运动学近似）：
 *   - 路线是一条 Catmull-Rom 曲线，s 为「前轴」沿曲线的弧长位置；
 *   - 车身由前轴点 P(s) 与后轴点 P(s - 轴距) 决定位置与朝向，转弯时车身自然切线跟随；
 *   - 挂车：牵引销挂在牵引车鞍座上，挂车后轴组取曲线上更靠后的点，于是转弯时挂车会「内切」；
 *   - 速度：按下一个停车点的剩余距离计算刹车上限 √(2·a·d)，加减速平滑；门前国道限速高、站内限速低；
 *   - 倒车：reverse 段里后轴点在前方（P(s + 轴距)），车头朝向与行驶方向相反；
 *     带挂车倒车时挂车后轴组也取曲线上更前方的点——挂车领先沿曲线拐进车位，牵引车跟着推。
 */
import * as THREE from "three"

import { THEME } from "./theme"

/**
 * 车辆几何尺寸的默认值（米，与 vehicles.py 的自建车型一致）：前轴、后轴、鞍座 / 牵引销、挂车后轴组的局部 x 坐标。
 * 外部模型的实测值写在 vehicles.glb 的 extras 里（userData.rig_*），见 rigOf()
 */
export const RIG = {
  car: { front: 1.45, rear: -1.45 },
  tractor: { front: 2.0, rear: -1.7, fifth: -1.5 },
  trailer: { kingpin: 5.8, rear: -5.3 }
}

/** 从预制的 userData（glTF extras）读车轴，缺省时用 RIG 的默认值 */
export function rigOf(obj, kind) {
  const u = obj.userData || {}
  const d = RIG[kind]
  if (kind === "trailer")
    return { kingpin: u.rig_kingpin ?? d.kingpin, rear: u.rig_rear ?? d.rear }
  if (kind === "tractor")
    return {
      front: u.rig_front ?? d.front,
      rear: u.rig_rear ?? d.rear,
      fifth: u.rig_fifth ?? d.fifth
    }
  return d
}

const Y = 0.05 // 车辆贴地高度
const FADE = 0.6 // 出现 / 消失的缩放时长（秒）
const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()

/** [x, z] 点列 → Catmull-Rom 曲线（向心参数化，转角不过冲）；arcLength 精度 0.5 m */
export function makeCurve(pts) {
  const v = pts.map(([x, z]) => new THREE.Vector3(x, Y, z))
  const c = new THREE.CatmullRomCurve3(v, false, "centripetal", 0.5)
  c.arcLengthDivisions = Math.max(200, Math.ceil(c.getLength() * 2))
  c.updateArcLengths()
  c.len = c.getLength()
  return c
}

/** 曲线上弧长 s 处的点；超出两端时沿端点切线外推（车尾还没进入曲线时用到） */
function pointAt(c, s, out) {
  if (s <= 0) {
    c.getPointAt(0, out)
    return out.addScaledVector(c.getTangentAt(0, tmpB), s)
  }
  if (s >= c.len) {
    c.getPointAt(1, out)
    return out.addScaledVector(c.getTangentAt(1, tmpB), s - c.len)
  }
  return c.getPointAt(s / c.len, out)
}

/** 曲线上离某点最近的弧长位置（用于把停车关键点换算成 s） */
export function nearestS(c, p) {
  const n = Math.ceil(c.len / 0.5)
  let best = 0
  let bd = Infinity
  for (let i = 0; i <= n; i++) {
    c.getPointAt(i / n, tmpA)
    const d = (tmpA.x - p[0]) ** 2 + (tmpA.z - p[1]) ** 2
    if (d < bd) {
      bd = d
      best = (i / n) * c.len
    }
  }
  return best
}

/** 朝向向量 (x, z) → 绕 y 轴的旋转角（模型车头朝 +x） */
const yaw = (dx, dz) => Math.atan2(-dz, dx)

/**
 * 一辆车：parts 为可见对象（牵引车、挂车分开摆放）；kind：car / tractor / semi
 */
export class Vehicle {
  /**
   * rigs：各部件的车轴尺寸（[牵引车或小车, 挂车]），由 rigOf() 从预制读取
   */
  constructor(kind, parts, rigs = []) {
    this.kind = kind
    this.parts = parts
    this.rigs = rigs
    this.speed = 0
    this.scale = 0
  }

  /** 按前轴所在弧长 s 摆放车身；reverse 时后轴在前方 */
  place(curve, s, reverse = false) {
    const F = pointAt(curve, s, new THREE.Vector3())
    const r = this.rigs[0] || (this.kind === "car" ? RIG.car : RIG.tractor)
    const wb = r.front - r.rear
    const R = pointAt(curve, reverse ? s + wb : s - wb, new THREE.Vector3())
    const h = F.clone().sub(R).normalize()
    const c = F.clone().addScaledVector(h, -r.front)
    this.parts[0].position.copy(c)
    this.parts[0].rotation.set(0, yaw(h.x, h.z), 0)
    if (this.kind === "semi") {
      // 鞍座 → 挂车后轴组：后轴组取曲线上更靠后的点，挂车绕牵引销转动
      const t = this.rigs[1] || RIG.trailer
      const K = c.clone().addScaledVector(h, r.fifth)
      const back = r.front - r.fifth + t.kingpin - t.rear
      const T = pointAt(
        curve,
        reverse ? s + back : s - back,
        new THREE.Vector3()
      )
      const g = K.clone().sub(T).normalize()
      const tc = K.clone().addScaledVector(g, -t.kingpin)
      this.parts[1].position.copy(tc)
      this.parts[1].rotation.set(0, yaw(g.x, g.z), 0)
    }
  }

  setScale(k) {
    this.scale = k
    const v = Math.max(0.001, k)
    for (const p of this.parts) p.scale.setScalar(v)
  }
}

/**
 * 行程：按段行驶。leg = { curve, stops: [{ s, wait, hold }], hold, reverse }
 *   stops：中途停车点；wait 秒后继续，hold 为 true 时停住直到 release()（挂车不断开曲线，转弯姿态连续）
 *   hold（段级）：段末停住，release() 后进入下一段（电动牵引车停进车位 → 倒车段）
 * 完成全部段后调用 onDone；fadeIn / fadeOut 表示在道路尽头出现 / 消失
 */
export class Trip {
  constructor(
    vehicle,
    legs,
    {
      onDone,
      onStop,
      fadeIn = true,
      fadeOut = true,
      startS = 0,
      startLeg = 0
    } = {}
  ) {
    this.v = vehicle
    this.legs = legs
    this.li = startLeg // 从第几段开始（开局已停在车位里的车直接从倒车段末尾开始）
    this.s = startS
    this.wait = 0
    this.held = false
    this.heldAtEnd = false
    this.onDone = onDone
    this.onStop = onStop
    this.fadeIn = fadeIn
    this.fadeOut = fadeOut
    const leg = legs[startLeg]
    this.stopIdx = leg.stops.filter((st) => st.s < startS - 0.01).length
    this.done = false
    vehicle.setScale(fadeIn ? 0 : 1)
    vehicle.place(leg.curve, this.s, leg.reverse)
  }

  /** 放行：停在 hold 点的车继续行驶；还没到 hold 点时先记下，到点后不停直接走 */
  release() {
    if (!this.held) {
      this.releasePending = true
      return
    }
    this.held = false
    if (this.heldAtEnd) {
      this.heldAtEnd = false
      this._nextLeg()
    }
  }

  _nextLeg() {
    this.li++
    this.s = 0
    this.stopIdx = 0
    this.v.speed = 0
    if (this.li >= this.legs.length) this._finish()
  }

  _finish() {
    if (this.fadeOut) {
      this.fading = true
      this.li = this.legs.length - 1
    } else {
      this.done = true
      this.onDone?.(this)
    }
  }

  /** 到达 hold 点：有待处理的放行就直接走，否则停住 */
  _hold(atEnd) {
    this.v.speed = 0
    if (this.releasePending) {
      this.releasePending = false
      if (atEnd) this._nextLeg()
      return
    }
    this.held = true
    this.heldAtEnd = atEnd
    this.onStop?.(this)
  }

  update(dt) {
    if (this.done) return true
    const v = this.v
    // 出现 / 消失：缩放补间
    if (this.fadeIn && v.scale < 1 && !this.fading)
      v.setScale(Math.min(1, v.scale + dt / FADE))
    if (this.fading) {
      v.setScale(v.scale - dt / FADE)
      const leg = this.legs[this.li]
      this.s += Math.max(v.speed, 4) * dt
      v.place(leg.curve, this.s, leg.reverse)
      if (v.scale <= 0) {
        this.done = true
        this.onDone?.(this)
      }
      return this.done
    }
    if (this.held) return false
    if (this.wait > 0) {
      this.wait -= dt
      return false
    }
    const leg = this.legs[this.li]
    // 下一个停车点：中途停车点 / 段末（hold 或还有下一段）/ 最后一段末尾（不停，直接驶出消失）
    const stop = leg.stops[this.stopIdx]
    const endStops = leg.hold || this.li < this.legs.length - 1
    const target = stop ? stop.s : leg.curve.len
    const brakeTo = stop || endStops ? target : Infinity
    const d = brakeTo - this.s
    const { acc, dec, road, site } = THEME.drive
    // 限速：在门前国道上（z 大于道路内侧边线 v = -4）快，站内慢；倒车更慢
    const onRoad = v.parts[0].position.z > 44
    const vmax = leg.reverse ? 2.2 : onRoad ? road : site
    const brake = Math.sqrt(Math.max(0, 2 * dec * Math.max(0, d - 0.05)))
    let sp = Math.min(v.speed + acc * dt, vmax, brake)
    if (v.speed > vmax) sp = Math.max(Math.min(vmax, brake), v.speed - dec * dt)
    v.speed = Math.max(0, sp)
    // 刹停前保底爬行速度，避免无限逼近停车点
    if (d < 0.6 && v.speed < 0.3) v.speed = 0.3
    this.s = Math.min(this.s + v.speed * dt, target)
    v.place(leg.curve, this.s, leg.reverse)
    if (this.s >= target - 0.02) {
      if (stop) {
        this.stopIdx++
        if (stop.hold) this._hold(false)
        else {
          v.speed = 0
          this.wait = stop.wait
          this.onStop?.(this, stop)
        }
      } else if (leg.hold) {
        this._hold(true)
      } else if (endStops) {
        this._nextLeg()
      } else {
        this._finish()
      }
    }
    return false
  }
}

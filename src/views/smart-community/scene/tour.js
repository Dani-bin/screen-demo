/**
 * 剧情的镜头脚本：每个剧情播放到某个仿真时刻，镜头飞到哪里（同一时刻只触发一次）。
 * ----------------------------------------------------------
 * "home" = 回到定稿机位；[x, y, {dist, polar, azimuth}] = 飞到平面某点（flyToPlan）。
 * 时刻是仿真分钟，换算在 Director 里。
 */
import { hm } from "../sim/simulator.js"

const CAMS = {
  // 走失搜寻：18:02:30 飞到 BS-04（湖东林荫带）一带
  SR: [
    ["17:55", "home"],
    ["18:02:30", [50, 12, { dist: 300, polar: 50, azimuth: -8, h: 10 }]],
    ["18:10", "home"]
  ],
  // 周界入侵：飞到西人行门，从东边往西看
  PT: [
    ["02:10", "home"],
    ["02:12:30", [-150, 14, { dist: 300, polar: 52, azimuth: 60, h: 10 }]],
    ["02:26", "home"]
  ],
  // 热源异常：飞到 CH-01
  TH: [
    ["11:28", "home"],
    ["11:29", [-52, -36, { dist: 220, polar: 50, azimuth: -18, h: 4 }]],
    ["11:44", "home"]
  ],
  // 消防通道占用：北段在塔楼后面，镜头绕到北边往南看
  FP: [
    ["06:28", "home"],
    ["06:31", [0, 96, { dist: 420, polar: 55, azimuth: 165, h: 10 }]],
    ["06:44", "home"]
  ],
  // 外立面隐患：B03 南立面
  FC: [
    ["09:08", "home"],
    ["09:12", [43, 55, { dist: 250, polar: 58, azimuth: -10, h: 40 }]],
    ["09:30", "home"]
  ]
}

/** 镜头导演：按剧情时刻触发镜头动作 */
export class Director {
  constructor(scene) {
    this.scene = scene
    this.key = null
    this.done = new Set()
  }

  /** 开始 / 结束一个剧情的镜头脚本 */
  start(key) {
    this.key = key
    this.done = new Set()
  }

  stop() {
    this.key = null
  }

  /** 每次时刻变化时调用；跨过某个关键帧就触发 */
  update(t) {
    if (!this.key) return
    for (const [ts, act] of CAMS[this.key] ?? []) {
      const at = hm(ts)
      if (t >= at && !this.done.has(ts)) {
        this.done.add(ts)
        if (act === "home") this.scene.goHome(1.8)
        else this.scene.flyToPlan(act[0], act[1], act[2])
      }
    }
  }
}

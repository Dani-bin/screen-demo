/*
 * /open-pit 场景预览页（开发用，不进生产构建）
 * ----------------------------------------------------------
 * 不带面板，只看三维场景：用页面同一份仿真器，时间钉在设计时刻，每秒喂一次状态。
 * 地址：/open-pit-lab.html?view=overview&at=2026-10-30T20:30&select=TK-037&tour=0
 *   view   视角键：overview | fleet | swap | shovel | slope | yard（默认 overview）
 *   at     北京时间，不带则用设计时刻
 *   select 选中的卡车 / 设备编号
 *   tour   1 开自动导览
 *   live   1 时间跟随真实时钟并前进（默认钉死）
 * 约定：场景加载完成后 window.__lab.ready = true，截图脚本据此等待。
 */
import layout from "../data/layout.json"
import { createPitSim, DESIGN_T, msForBeijing } from "../sim/simulator.js"
import PitScene from "../scene/PitScene.js"

const q = new URLSearchParams(location.search)
const canvas = document.getElementById("c")
const sim = createPitSim(layout)
let t0 = DESIGN_T
if (q.get("at")) {
  const [d, hm = "00:00"] = q.get("at").split("T")
  const [h, m] = hm.split(":").map(Number)
  t0 = msForBeijing(d, h + (m || 0) / 60)
}
const live = q.get("live") === "1"
const wall0 = Date.now()
const now = () => (live ? t0 + (Date.now() - wall0) : t0)

window.__lab = { ready: false }
const scene = new PitScene(canvas, {
  stageBox: () => ({ x: 0, y: 0, w: innerWidth, h: innerHeight }),
  onSelect: (id) => scene.select(id)
})
window.__pitScene = scene
window.__sim = sim
scene.ready.then(() => {
  scene.setState(sim.at(now()), sim.monitors(now()))
  const view = q.get("view") || "overview"
  scene.focus(view, { duration: 0.01 })
  if (q.get("select")) scene.select(q.get("select"))
  if (q.get("tour") === "1") scene.setTour(true)
  setInterval(() => scene.setState(sim.at(now()), sim.monitors(now())), 1000)
  window.__lab.ready = true
})
addEventListener("resize", () => scene.resize())

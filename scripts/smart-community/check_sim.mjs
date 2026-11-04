/**
 * 校验仿真器：设计时刻（?at=18:06）的读数必须等于定稿用的数字（docs/design/smart-community/mock/design.json），
 * 并检查事件计数的口径（总数 = 各状态之和 = 各类型之和）、架次和飞行分钟都是数出来的。
 * 用法：node scripts/smart-community/check_sim.mjs   有不一致就退出 1
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  createSim,
  DESIGN_T
} from "../../src/views/smart-community/sim/simulator.js"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const layout = JSON.parse(
  readFileSync(join(ROOT, "src/views/smart-community/data/layout.json"), "utf8")
)
const design = JSON.parse(
  readFileSync(
    join(ROOT, "docs/design/smart-community/mock/design.json"),
    "utf8"
  )
)
const sim = createSim(layout)
const s = sim.at(DESIGN_T)

let bad = 0
const eq = (name, got, want, tol = 0.05) => {
  const ok =
    typeof want === "number" ? Math.abs(got - want) <= tol : got === want
  if (!ok) {
    bad++
    console.log(`✗ ${name}：仿真 ${got}，定稿 ${want}`)
  }
}
for (const d of design.drones) {
  const g = s.drones.find((x) => x.id === d.id)
  eq(`${d.id} 电量`, g.batt, d.batt)
  eq(`${d.id} 高度`, g.alt, d.alt)
  eq(`${d.id} 地速`, g.spd, d.spd)
  eq(`${d.id} 5.8G`, g.rssi58, d.rssi58, 0.5)
  eq(`${d.id} 2.4G`, g.rssi24, d.rssi24, 0.5)
  eq(`${d.id} 延迟`, g.lat, d.lat, 0.5)
  eq(`${d.id} 任务`, g.taskText, d.taskText)
  eq(`${d.id} 链路`, g.linkText, d.link)
}
for (const k of [
  "total",
  "pending",
  "dispatched",
  "processing",
  "review",
  "closed",
  "false",
  "done",
  "PT",
  "TH",
  "FP",
  "FC",
  "SR"
])
  eq(`事件 ${k}`, s.counts[k], design.counts[k])
eq("处置率", s.doneRate, design.doneRate, 1e-9)
eq("盲区已核验", s.blind.checked, design.blind.checked)
eq("目标状态", s.target.status, design.target.status)
eq("目标置信度", s.target.conf, design.target.conf, 0.005)
eq("融合误差", s.target.err, design.target.err, 0.05)
eq("覆盖率", s.coverage, design.coverage, 0.05)
eq("架次", s.sorties, design.sorties)
eq("累计飞行", Math.floor(s.flightMin), design.flightMin)
eq("CH-01", s.thermal["CH-01"].temp, design.thermal["CH-01"].temp)
eq("CH-02", s.thermal["CH-02"].temp, design.thermal["CH-02"].temp)
eq("CH-03 质量", s.thermal["CH-03"].q, design.thermal["CH-03"].q)
eq(
  "CH-03 验证时刻",
  s.thermal["CH-03"].verifiedAt,
  design.thermal["CH-03"].verifiedAt
)
eq("风速", s.env.wind, design.env.wind)
eq("气温", s.env.temp, design.env.temp)
// 口径：总数 = 各状态之和 = 各类型之和
const c = s.counts
eq(
  "总数 = 各状态之和",
  c.total,
  c.pending + c.dispatched + c.processing + c.review + c.closed + c.false
)
eq("总数 = 各类型之和", c.total, c.PT + c.TH + c.FP + c.FC + c.SR)
// 全天扫一遍：没有 NaN、电量在 0–100、高度不为负
for (let t = 0; t < 1440; t += 1.5) {
  const x = sim.at(t)
  for (const d of x.drones) {
    for (const k of [
      "x",
      "y",
      "z",
      "batt",
      "alt",
      "spd",
      "rssi58",
      "rssi24",
      "lat"
    ])
      if (!Number.isFinite(d[k])) {
        bad++
        console.log(`✗ ${x.clock} ${d.id}.${k} 不是数`)
      }
    if (d.batt < 0 || d.batt > 100.0001) {
      bad++
      console.log(`✗ ${x.clock} ${d.id} 电量 ${d.batt}`)
    }
  }
}
console.log(
  bad
    ? `共 ${bad} 处不一致`
    : "仿真器与定稿一致（设计时刻 18:06 的全部读数相符，全天无 NaN）"
)
process.exit(bad ? 1 : 0)

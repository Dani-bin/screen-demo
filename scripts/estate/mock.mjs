/**
 * 楼盘沙盘「澜岸云境」：销售状态模拟数据
 * ----------------------------------------------------------
 * 从 src/views/estate/data/layout.json 的楼栋表派生，写成
 * build-3d-visual-dashboard 的数据格式（docs/design/estate/mock/）：
 *   points.json 测点定义、snapshots.json 逐日快照（7 天）、rules.json 口径规则
 * 数据全部是设定值，固定种子可复现；汇总值从各栋明细算出，不手写。
 *
 * 用法：node scripts/estate/mock.mjs   之后跑
 *       node ~/src/build-3d-visual-dashboard/scripts/data-check.mjs docs/design/estate/mock
 *       （要用真实路径跑，~/.claude/skills 软链接路径会让主入口检查静默跳过并退出 0）
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const OUT = join(ROOT, "docs", "design", "estate", "mock")
const layout = JSON.parse(
  readFileSync(
    join(ROOT, "src", "views", "estate", "data", "layout.json"),
    "utf8"
  )
)

/** 固定种子的小随机数（mulberry32），保证数据可复现 */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = rng(20261030)

// 设计时刻：2026-10-30 18:00（北京时间）；快照往前推 6 天，每天 18:00 一份
const DAYS = 7
const END = Date.parse("2026-10-30T18:00:00+08:00")
const times = Array.from({ length: DAYS }, (_, i) =>
  new Date(END - (DAYS - 1 - i) * 86400000).toISOString()
)

// 各类产品的目标去化率区间：洋房和联排更好卖，高层偏慢
const TARGET = {
  terrace: [0.38, 0.58],
  villa: [0.5, 0.75],
  tower: [0.16, 0.3]
}

const B = layout.buildings
/** 每栋：总户数、最终已售、认购未签；逐日已售按"先慢后快"累加，只增不减 */
const plan = B.map((b) => {
  const [lo, hi] = TARGET[b.kind]
  const sold = Math.round(b.units * (lo + rand() * (hi - lo)))
  const reserved = Math.max(0, Math.round(b.units * (0.03 + rand() * 0.04)))
  // 逐日增量权重，周末（10-24、10-25 是周六日）更多
  const w = times.map((_, i) => (i < 2 ? 1.6 : 1) * (0.5 + rand()))
  const sum = w.reduce((s, x) => s + x, 0)
  let acc = 0
  const daily = w.map((x) => {
    acc += x
    return Math.min(sold, Math.round((acc / sum) * sold))
  })
  daily[DAYS - 1] = sold
  // 起点从第 0 天已售的一小部分开始，让第一天不是 0
  return { id: b.id, units: b.units, reserved, daily }
})

const points = []
const addPoint = (id, device, name, unit, kind, min, max) =>
  points.push({
    id,
    device,
    name,
    unit,
    kind,
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {})
  })
addPoint("ALL.units", "ALL", "总户数", "户", "analog", 0)
addPoint("ALL.sold", "ALL", "已售", "户", "counter", 0)
addPoint("ALL.reserved", "ALL", "认购未签", "户", "analog", 0)
addPoint("ALL.rate", "ALL", "去化率（已售 ÷ 总户数）", "", "analog", 0, 1)
for (const p of plan) {
  addPoint(`${p.id}.units`, p.id, "总户数", "户", "analog", 0)
  addPoint(`${p.id}.sold`, p.id, "已售", "户", "counter", 0, p.units)
  addPoint(`${p.id}.reserved`, p.id, "认购未签", "户", "analog", 0, p.units)
}

const snapshots = times.map((t, d) => {
  const values = {}
  // changedAt：数值最后一次变化的时间；verifiedAt：销售系统最后一次核对，每天 18:00 都核对
  const changed = (series, key) => {
    let k = d
    while (k > 0 && series[k - 1] === series[d]) k--
    return times[k] ?? t
  }
  let sumSold = 0
  let sumReserved = 0
  for (const p of plan) {
    const sold = p.daily[d]
    // 认购未签：基数 + 一点随天数的波动，保证 已售 + 认购 ≤ 总户数
    const reserved = Math.min(
      p.units - sold,
      p.reserved + (d % 3 === 0 ? 1 : 0)
    )
    sumSold += sold
    sumReserved += reserved
    const soldSeries = p.daily
    values[`${p.id}.units`] = {
      v: p.units,
      q: "good",
      changedAt: times[0],
      verifiedAt: t
    }
    values[`${p.id}.sold`] = {
      v: sold,
      q: "good",
      changedAt: changed(soldSeries, "sold"),
      verifiedAt: t
    }
    values[`${p.id}.reserved`] = {
      v: reserved,
      q: "good",
      changedAt: t,
      verifiedAt: t
    }
  }
  const units = plan.reduce((s, p) => s + p.units, 0)
  values["ALL.units"] = {
    v: units,
    q: "good",
    changedAt: times[0],
    verifiedAt: t
  }
  values["ALL.sold"] = { v: sumSold, q: "good", changedAt: t, verifiedAt: t }
  values["ALL.reserved"] = {
    v: sumReserved,
    q: "good",
    changedAt: t,
    verifiedAt: t
  }
  values["ALL.rate"] = {
    v: sumSold / units,
    q: "good",
    changedAt: t,
    verifiedAt: t
  }
  return { t, values }
})

const ids = (suffix) => plan.map((p) => `${p.id}.${suffix}`)
const rules = [
  { type: "sum", target: "ALL.units", of: ids("units") },
  { type: "sum", target: "ALL.sold", of: ids("sold") },
  { type: "sum", target: "ALL.reserved", of: ids("reserved") },
  { type: "ratio", target: "ALL.rate", num: "ALL.sold", den: "ALL.units" },
  // 销售状态每天核对一次，超过 36 小时没核对就不能算 good
  { type: "stale", maxAgeSec: 36 * 3600 }
]

mkdirSync(OUT, { recursive: true })
const write = (name, data) =>
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 1) + "\n")
write("points.json", points)
write("snapshots.json", snapshots)
write("rules.json", rules)

// 页面用的销售数据：逐栋逐日的已售 / 认购，汇总值页面里从明细算（和 rules.json 同一口径）
const sales = {
  at: times[DAYS - 1],
  days: times,
  buildings: Object.fromEntries(
    plan.map((p) => [
      p.id,
      {
        units: p.units,
        sold: snapshots.map((s) => s.values[`${p.id}.sold`].v),
        reserved: snapshots.map((s) => s.values[`${p.id}.reserved`].v)
      }
    ])
  )
}
const salesOut = join(ROOT, "src", "views", "estate", "data", "sales.json")
mkdirSync(dirname(salesOut), { recursive: true })
writeFileSync(salesOut, JSON.stringify(sales) + "\n")

const last = snapshots[snapshots.length - 1].values
console.log(
  `测点 ${points.length}，快照 ${snapshots.length} 份；` +
    `${times[DAYS - 1]} 总户数 ${last["ALL.units"].v}，已售 ${last["ALL.sold"].v}，` +
    `认购 ${last["ALL.reserved"].v}，去化率 ${(last["ALL.rate"].v * 100).toFixed(1)}%`
)

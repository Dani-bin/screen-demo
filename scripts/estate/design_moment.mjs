/**
 * 楼盘沙盘设计稿：设计时刻数据
 * ----------------------------------------------------------
 * 把 layout.json 和 mock 的最后一份快照合成设计稿要用的数据，写成
 * docs/design/estate/design/src/design-moment.js（window.__DESIGN_MOMENT），
 * 设计稿 HTML 面板上的数字全部从这里来，不手写。
 * 用法：node scripts/estate/design_moment.mjs（先跑 layout.mjs 和 mock.mjs）
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (...p) => JSON.parse(readFileSync(join(ROOT, ...p), "utf8"))
const layout = read("src", "views", "estate", "data", "layout.json")
const snaps = read("docs", "design", "estate", "mock", "snapshots.json")
const last = snaps[snaps.length - 1].values

/** 销售状态分档：去化 ≥ 50% 热销，≥ 95% 售罄，其余可售 */
const stateOf = (rate) => (rate >= 0.95 ? "out" : rate >= 0.5 ? "hot" : "open")

const buildings = layout.buildings.map((b) => {
  const sold = last[`${b.id}.sold`].v
  const reserved = last[`${b.id}.reserved`].v
  const rate = sold / b.units
  return {
    id: b.id,
    no: b.no,
    name: b.name,
    kindName: b.kindName,
    floors: b.floors,
    height: b.height,
    units: b.units,
    unitTypes: b.unitTypes,
    tags: b.tags,
    facing: b.facing,
    sold,
    reserved,
    open: b.units - sold - reserved,
    rate,
    state: stateOf(rate)
  }
})

const t = layout.totals
const moment = {
  at: "2026-10-30T18:00:00+08:00",
  name: layout.name,
  slogan: layout.slogan,
  note: layout.note,
  selected: "B08",
  totals: {
    units: last["ALL.units"].v,
    sold: last["ALL.sold"].v,
    reserved: last["ALL.reserved"].v,
    rate: last["ALL.rate"].v,
    gfa: t.gfa,
    far: t.far,
    density: t.density,
    greenRate: t.greenRate,
    buildings: t.buildings
  },
  // 自动导览的 8 个停靠点（和 05-requirement.md 一致）
  tour: [
    "总览",
    "区位交通",
    "北排高层",
    "景观轴与湖",
    "洋房组团",
    "滨河联排",
    "会所与配套",
    "一天光影"
  ],
  buildings
}

writeFileSync(
  join(ROOT, "docs", "design", "estate", "design", "src", "design-moment.js"),
  "window.__DESIGN_MOMENT = " + JSON.stringify(moment, null, 1) + "\n"
)
const b8 = buildings.find((b) => b.id === moment.selected)
console.log(
  `设计时刻 ${moment.at}；选中 ${b8.id}：${b8.units} 户，已售 ${b8.sold}，认购 ${b8.reserved}，在售 ${b8.open}，去化 ${(b8.rate * 100).toFixed(0)}%（${b8.state}）`
)
console.log(
  "各状态栋数：" +
    ["open", "hot", "out"]
      .map((s) => `${s} ${buildings.filter((b) => b.state === s).length}`)
      .join("，")
)

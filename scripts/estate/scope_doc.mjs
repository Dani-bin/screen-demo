/**
 * 生成 docs/design/estate/03-scope.md（场景范围与设备清单）
 * ----------------------------------------------------------
 * 指标和设备表全部从 src/views/estate/data/layout.json 派生，布局一改就重跑：
 *   node scripts/estate/layout.mjs && node scripts/estate/scope_doc.mjs
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const l = JSON.parse(
  readFileSync(
    join(ROOT, "src", "views", "estate", "data", "layout.json"),
    "utf8"
  )
)
const t = l.totals

const rows = l.buildings.map(
  (b) =>
    `| ${b.id} | ${b.name}（${b.kindName}） | ${b.kind} | ${b.floors}F · ${b.height} m · ${b.units} 户 | ${b.id} | 中心 (${b.cx}, ${b.cy})，${b.w}×${b.d} m；${b.tags.join("、")} |`
)
const arows = l.amenities.map(
  (a) =>
    `| ${a.id} | ${a.name} | ${a.shape} | ${a.floors ? a.floors + "F" : "—"} | ${a.id} | ${a.outside ? "地块外；" : ""}${a.desc} |`
)

const md = `# 03 场景收敛与设备编号

> 阶段 3 产出。编号以 \`scripts/estate/layout.mjs\` 为唯一来源，设备清单同步写进 \`devices.json\`（生成文件，不要手改）。
> 本文件由 \`scripts/estate/scope_doc.mjs\` 从 \`layout.json\` 生成。楼栋位置、面宽和底座形状已按定稿反投影校正过（见 README 冲突清单 10–12）。

## 范围

一句话：成都锦江滨水新城一块虚构的 ${t.siteArea / 10000} 万 ㎡（约 ${t.siteMu} 亩）改善型住宅用地，建一个 ${t.buildings} 栋、${t.units} 户的小区「澜岸云境」，用实体沙盘质感的三维场景给客户看建成后的样子。沙盘底座是东西约 ${l.base.rx * 2} m、南北约 ${l.base.ry * 2} m 的椭圆。

## 指标（从明细算出，绿地率为设定值）

| 项 | 值 |
|---|---|
| 地块 | ${l.site.w} × ${l.site.d} m = ${t.siteArea} ㎡ |
| 计容建面 | 约 ${t.gfa} ㎡ |
| 容积率 | ${t.far} |
| 建筑密度 | ${(t.density * 100).toFixed(1)}% |
| 绿地率 | ${t.greenRate * 100}%（设定） |
| 楼栋 | ${t.buildings} 栋：高层 ${t.byKind.tower.buildings}（${t.byKind.tower.units} 户）/ 洋房 ${t.byKind.terrace.buildings}（${t.byKind.terrace.units} 户）/ 联排 ${t.byKind.villa.buildings}（${t.byKind.villa.units} 户） |
| 总户数 | ${t.units} |
| 地下车位 | 约 ${t.parking}（1 : 1.3） |
| 最高层数 | ${t.maxFloors} 层 |

## 空间连接（北 → 南，坐标 x 向东、y 向北，原点在地块中心）

\`\`\`
                锦澜大道（北，主干道）
   ┌── G01 ───── E01 主入口 ───── G02 ──┐
   │ B01 32F    B02 26F ║ B03 26F    B04 32F │  北排高层，朝南
   │ B05  B06   ║景观轴 AX01║   B09  B10       │  洋房第一排 7F
 云│ B07  B08   ╚═景观湖 LK01═╝   B11  B12      │  洋房第二排，湖景
 岸│ PL01       环湖步道 TR01       SP01        │ SH01 底商街 · 岸南路
 路│ KG01 B13 B14    CL01 会所    B15 B16  E02  │  南排联排 3F
   │              SW01 泳池                     │
   └────────────────────────────────────────────┘
        滨河路 → 河岸公园 PK01 → 锦澜河 RV01（南）
 西：学校 SC01   东：地铁站 MT01 · 商业综合体 ML01 · 社区医院 HP01
\`\`\`

## 设备清单

### 楼栋

| 编号 | 名称 | 类型 | 层数 · 高度 · 户数 | 模型节点名 | 位置与标签 |
|---|---|---|---|---|---|
${rows.join("\n")}

### 配套、景观、出入口与周边

| 编号 | 名称 | 形态 | 层数 | 模型节点名 | 说明 |
|---|---|---|---|---|---|
${arows.join("\n")}

## 每个环节看什么

| 环节 | 需要查看的内容 | 帮客户判断什么 |
|---|---|---|
| 区位交通 | 锦澜大道、地铁站 MT01、商业综合体 ML01、出入口 | 通勤方便不方便、进出是否人车分流 |
| 北排高层 | B01–B04 的高度、朝向、临主路提示 | 天际线、噪音、是否遮挡 |
| 景观轴与湖 | AX01、LK01、TR01 | 小区的景观格局和湖景楼栋有哪些 |
| 洋房组团 | B05–B12 与湖的关系、楼间距 | 湖景和中庭景观分别是哪几栋 |
| 滨河联排 | B13–B16、河岸公园 PK01、锦澜河 RV01 | 低密产品的位置与景观 |
| 会所与配套 | CL01、SW01、KG01、SH01、PL01、SP01 | 日常生活配套 |
| 一天光影 | 阴影随时间变化、夜景灯光 | 日照是否充足、夜景氛围 |
`
writeFileSync(join(ROOT, "docs", "design", "estate", "03-scope.md"), md)
console.log("03-scope.md 已生成，", md.split("\n").length, "行")

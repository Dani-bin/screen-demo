# 04 数据定义

> 格式与口径规则见 skill 的 `references/data-consistency.md`。模拟数据放 `mock/`，由 `node scripts/smart-ranch/mock.mjs` 从页面同一份仿真器（`src/views/smart-ranch/sim/simulator.js`）生成，生成后跑 `node ~/src/build-3d-visual-dashboard/scripts/data-check.mjs docs/design/smart-ranch/mock`，必须通过。

注意：要用 skill 的真实路径跑。从 `~/.claude/skills/...` 软链接路径运行时，脚本的入口判断对不上，主函数不执行，会不报任何错就退出 0。

## 真实数据与示意数据

| 真实（公开数据） | 示意（仿真 / 假设） |
|---|---|
| 地形：Copernicus GLO-30（30 m DSM，重采样到 10 m） | 牧场边界、10 个轮牧单元 / 40 个分区（围栏按河谷走向排成方格） |
| 影像：Sentinel-2 L2A 2026 年 7–8 月晴空中值合成（10 m） | 营地、饮水点、场部、基站、摄像头的位置 |
| 逐月 NDVI：Sentinel-2 2026 年与 2025 年 4–10 月，按分区面积均值 | 存栏、畜群位置与轨迹、项圈、饮水点读数、告警 |
| 河道、湿地：WorldCover 2021 + 夏季水体指数 | 产草量 = K ×（NDVI − 0.15），K 按全场草畜平衡指数 +5% 标定 |

## 测点

编号 = `<对象编号>.<量>`，对象编号见 `03-scope.md`。快照只收汇总值、单元、分区、畜群、饮水点和 21 个头羊项圈。380 头牛的单头位置由仿真器在页面里实时算，不进快照。

| 测点编号 | 对象 | 名称 | 单位 | 类型 | 范围 |
|---|---|---|---|---|---|
| RANCH.head / sheepHead / cattleHead | 全场 | 存栏总数 / 羊 / 牛 | 头只 | analog | ≥ 0 |
| RANCH.su | 全场 | 实际载畜量 | 羊单位 | analog | ≥ 0 |
| RANCH.capacity | 全场 | 合理载畜量 | 羊单位 | analog | ≥ 0 |
| RANCH.loadRatio | 全场 | 载畜比（实际 ÷ 合理） | — | analog | 0–3 |
| RANCH.balance | 全场 | 草畜平衡指数 | % | analog | −100–200 |
| RANCH.ndvi | 全场 | 草场 NDVI（面积加权，真实） | — | analog | −0.2–1 |
| RANCH.collarsTotal / collarsOnline | 全场 | 项圈总数 / 在线 | 个 | analog | ≥ 0 |
| RANCH.onlineRate | 全场 | 项圈在线率 | — | analog | 0–1 |
| RANCH.supplied | 全场 | 今日供水 | m³ | counter | ≥ 0 |
| RANCH.alarmsActive | 全场 | 未结束告警 | 条 | analog | ≥ 0 |
| Uxx.su / capacity / balance | 轮牧单元 | 实际 / 合理载畜量、草畜平衡指数 | 羊单位 / % | analog | |
| Uxx.grazing | 轮牧单元 | 当前放牧分区 | — | state | Uxx-1…4 |
| Uxx-n.status | 分区 | 分区状态 | — | state | grazing / resting / ready |
| Uxx-n.ndvi | 分区 | 当月 NDVI（真实） | — | analog | −0.2–1 |
| Uxx-n.forage | 分区 | 可食草量（示意） | kg/亩 | analog | 0–400 |
| Uxx-n.restDays | 分区 | 休牧天数 | 天 | analog | 0–200 |
| SF-xx / CH-xx.head | 畜群 | 头数 | 只 / 头 | analog | ≥ 0 |
| SF-xx / CH-xx.x / y | 畜群 | 群中心（局部米坐标） | m | analog | 沙盘范围 |
| SF-xx / CH-xx.walkKm | 畜群 | 今日行走 | km | counter | 0–30 |
| SF-xx / CH-xx.collarsOnline | 畜群 | 在线项圈 | 个 | analog | ≥ 0 |
| WP-xx.level | 饮水点 | 水罐液位 | % | analog | 0–100 |
| WP-xx.supplied | 饮水点 | 今日供水 | m³ | counter | ≥ 0 |
| WP-xx.pump | 饮水点 | 提水泵 | — | state | run / stop / fault |
| CL-0001…0021.online | 头羊项圈 | 在线 | — | state | online / offline |

## 汇总口径

| 汇总值 | 算法 | 规则（rules.json） |
|---|---|---|
| 羊 / 牛存栏 | 各羊群 / 牛群头数之和 | sum |
| 存栏总数 | 羊存栏 + 牛存栏（头只，不折算） | sum |
| 实际载畜量 | 各单元羊单位之和（羊 1、牛 5） | sum |
| 合理载畜量 | 各单元合理载畜量之和（每单元 = Σ 分区面积 × 产草量 × 利用率 50% ÷ (1.8 kg × 183 天)） | sum |
| 载畜比 | 实际载畜量 ÷ 合理载畜量；草畜平衡指数 = (载畜比 − 1) × 100%，不是各单元指数的平均 | ratio |
| 在线项圈 | 各畜群在线项圈之和 | sum |
| 项圈在线率 | 在线项圈 ÷ 项圈总数 | ratio |
| 今日供水 | 各饮水点今日供水之和 | sum |
| 草场 NDVI | 各分区 NDVI 按面积加权，不是简单平均 | （页面算，快照只核对来源一致） |
| 过期 | 1 小时没被验证的值质量不能是 good；项圈 2 小时没上报算离线 | stale |

## 模拟数据

- 快照数量与间隔：61 份，每分钟 1 份（1 小时）。时段由 `mock.mjs` 自动挑选，要求这一小时里同时出现下面几种异常态，结果写在 `mock/window.json`。
- 随机种子：按日期字符串播种（`simulator.js` 的 `rng`），同一时刻算出的数据都一样。
- 预置的异常：
  - 告警：牛越过电子围栏进入河岸保护带（越界）、饮水点水位低（提水泵故障）。
  - 过期：头羊项圈 2 小时没上报（离线）。
  - 不确定：饮水点流量计读数质量不确定。
  - 出现的时刻：见下方"本次快照时段"。

## 本次快照时段

2026-07-25 13:00–14:00（大屏设定日期，北京时间）。测点 332 个，快照 61 份，`data-check` 通过（2026-10-20）。

| 事件 | 级别 | 对象 | 时间 | 派给 |
|---|---|---|---|---|
| 项圈离线（数据过期） | 一般 | CL-0010（SF-04 头羊） | 12:42–13:06 | HD-04 |
| 饮水点水位低（提水泵故障） | 重要 | WP-04 | 12:53–13:19 | HD-04 |
| 饮水点水位低（提水泵故障） | 重要 | WP-09 | 13:22–14:04 | HD-08 |
| 电子围栏越界 | 紧急 | CH-03-095（牛） | 13:53–14:16 | HD-10 |

另有饮水点流量计偶发"质量不确定"读数。离线项圈的最后上报时间在 2 小时以前，质量为 bad。设计稿的异常态取这一小时里的时刻。

注：牧场轮牧分区合计约 8.5 万亩，加河岸保护带约 0.74 万亩，牧场约 9.3 万亩（`prepare.py` 按真实河道排出来的结果，比 03 里预估的 10.2 万亩略小）。

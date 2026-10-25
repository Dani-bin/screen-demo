/*
 * 运维中心的台账类演示数据（虚构，和仿真器无关的静态信息）：
 *   - 输送带台账：投运日期、上次整带更换、设计寿命（运行小时）
 *   - 备件库存：每类劣化消缺要用的备件、当前库存、安全库存
 * 运行时长、接头数、预测需求等会变的数字在页面里从仿真器派生，不写在这里。
 */

/** 输送带台账（日期为北京时间日期） */
export const BELT_LEDGER = {
  BC01: { since: "2023-03-18", lastReplace: "2025-06-02", lifeH: 60000 },
  BC02: { since: "2023-03-18", lastReplace: "2024-11-20", lifeH: 70000 },
  BC03: { since: "2023-03-18", lastReplace: "2025-03-11", lifeH: 70000 },
  BC04: { since: "2023-08-05", lastReplace: "2025-09-27", lifeH: 60000 },
  BC05: { since: "2026-04-12", lastReplace: "2026-04-12", lifeH: 40000 },
  BC06: { since: "2026-07-01", lastReplace: "2026-07-01", lifeH: 30000 }
}

/**
 * 备件：每类劣化消缺消耗哪些备件、每次用量；库存 / 安全库存（件）
 * kind 对应仿真器劣化过程的 kind
 */
export const SPARES = [
  {
    id: "SP-ID159",
    name: "托辊 Φ159",
    spec: "GB/T 990",
    stock: 46,
    safe: 30,
    kind: "idlerBearing",
    per: 1
  },
  {
    id: "SP-BR6305",
    name: "托辊轴承 6305",
    spec: "深沟球",
    stock: 120,
    safe: 60,
    kind: "idlerBearing",
    per: 2
  },
  {
    id: "SP-BR6330",
    name: "电机轴承 6330",
    spec: "C3 游隙",
    stock: 6,
    safe: 4,
    kind: "motorBearing",
    per: 1
  },
  {
    id: "SP-LAG",
    name: "滚筒包胶",
    spec: "陶瓷 12 mm",
    stock: 3,
    safe: 2,
    kind: "pulleyLagging",
    per: 1
  },
  {
    id: "SP-GEAR",
    name: "减速机齿轮组",
    spec: "B3SH 二级",
    stock: 1,
    safe: 1,
    kind: "reducerGear",
    per: 1
  },
  {
    id: "SP-OIL",
    name: "齿轮油 L-CKD 320",
    spec: "200 L / 桶",
    stock: 9,
    safe: 6,
    kind: "reducerOil",
    per: 2
  }
]

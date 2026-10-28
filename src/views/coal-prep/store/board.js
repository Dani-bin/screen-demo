/*
 * 面板数据派生：从仿真快照 s = sim.at(t) 算出屏上所有汇总数字
 * ----------------------------------------------------------
 * 与设计稿 docs/design/coal-prep/design/src/data.js 的 derive() 同一套口径：
 * 功率合计、吨煤电耗、两机不平衡、ISO 10816 分区、光纤测温参考均值 / 峰值 / 差温、
 * 托辊各级计数、103 健康指数、告警计数、八大保护统计、平台预警提前天数。
 */

const LEVEL_PENALTY = { 2: 10, 3: 4, 4: 1 }

export function deriveBoard(s) {
  const F = s.focus
  const z = s.isoZones

  // 驱动部：功率合计、吨煤电耗、两机功率平衡、振动按 ISO 分区给状态（C 区报三级、D 区报二级）
  const motors = s.drive.filter((d) => d.kw != null)
  const kwTotal = motors.reduce((a, d) => a + d.kw, 0)
  const kwh_t = F.flow > 0 ? kwTotal / F.flow : 0
  const balance =
    kwTotal > 0 ? Math.abs(motors[0].kw - motors[1].kw) / (kwTotal / 2) : 0
  const zone = (v) => (v < z[0] ? "A" : v < z[1] ? "B" : v < z[2] ? "C" : "D")
  const drive = s.drive.map((d) => {
    const zn = zone(d.vib)
    return { ...d, zone: zn, level: zn === "C" ? 3 : zn === "D" ? 2 : 0 }
  })

  // 光纤测温：参考均值排除热点 ±10 m
  const hotAt = Math.round(s.idler35.group * F.idlerPitch)
  const ref = s.dts.filter((_, x) => Math.abs(x - hotAt) > 10)
  const refMean = ref.reduce((a, v) => a + v, 0) / ref.length
  const peak = Math.max(...s.dts)
  const peakAt = s.dts.indexOf(peak)

  // 托辊：总组数、各级计数；异常组补上里程和温度（温度取该里程的光纤读数）
  const groups = Math.floor(F.len / F.idlerPitch)
  const issues = s.issues.map((i) => {
    const at = Math.round(i.group * F.idlerPitch)
    return { ...i, at, temp: s.dts[at] }
  })
  const idlerCount = [2, 3, 4].map((l) => ({
    level: l,
    n: issues.filter((i) => i.level === l).length
  }))
  const rpmNominal = (F.vRated / ((Math.PI * F.idlerDia) / 1000)) * 60

  // 103 健康指数：100 − 托辊扣分 − 驱动部扣分
  const health = Math.round(
    100 -
      issues.reduce((a, i) => a + LEVEL_PENALTY[i.level], 0) -
      drive.reduce((a, d) => a + (d.level ? LEVEL_PENALTY[d.level] : 0), 0)
  )
  const belts = s.belts.map((b) => ({
    ...b,
    health: b.id === F.id ? health : b.health,
    load: b.flow / b.cap
  }))

  // 告警
  const open = s.alarms.filter((a) => a.status !== "已处理")
  const dims = ["人", "机", "料", "环"].map((d) => ({
    dim: d,
    open: open.filter((a) => a.dim === d).length,
    today: s.alarmsToday[d]
  }))
  const byLevel = [1, 2, 3, 4].map((l) => ({
    level: l,
    n:
      open.filter((a) => !a.offline && a.level === l).length +
      (l === 4 ? open.filter((a) => a.offline).length : 0)
  }))

  // 八大保护（8 条皮带 × 8 项）
  const protTotal = s.belts.length * s.protections.length
  const protOk = protTotal - s.protectionMarks.length

  // 平台预警：首次异响到外推跳闸的天数；时间线进度
  const id35 = s.idler35
  const leadDays = (id35.protectTrip - id35.firstWarn) / 86400e3

  return {
    s,
    F,
    load: F.flow / F.cap,
    kwTotal,
    kwRated: F.motorRated * motors.length,
    kwh_t,
    balance,
    drive,
    dts: {
      refMean,
      peak,
      peakAt,
      diff: peak - refMean,
      group: Math.round(peakAt / F.idlerPitch),
      hotAt
    },
    groups,
    issues,
    idlerCount,
    idlerOk: groups - issues.length,
    rpmNominal,
    health,
    belts,
    dims,
    byLevel,
    openCount: open.length,
    protTotal,
    protOk,
    leadDays
  }
}

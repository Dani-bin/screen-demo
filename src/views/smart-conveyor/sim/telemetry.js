/*
 * 带式输送机孪生：测点层（演示数据）
 * ----------------------------------------------------------
 * 把仿真器（simulator.js）的状态换算成"测点"：每个测点有值 v、质量 q（good / uncertain / bad）、
 * 最后变化时间 changedAt、最后验证时间 verifiedAt。页面的详情面板和 docs/design/smart-conveyor/mock/ 共用这一层。
 *
 * 刷新类别（来源与阈值见 docs/design/smart-conveyor/04-data-spec.md）：
 *   plc      集控 PLC / 平台计算量，1 s 刷新，10 s 没验证算过期
 *   wireless 无线温振、托辊温速，约 10 min 上报一次，读数停在上次上报时刻；25 min 没上报算过期；低电量时 uncertain
 *   dts/das  光纤主机，5 s 刷新；主机通讯中断时读数冻结，30 s 内 uncertain，之后 bad
 *   env      环境监测分站，2 s
 *   cam/uwb/robot 1 s；镜头脏污时识别置信度 uncertain；UWB 基站离线时在线人数冻结，30 s 后 bad
 *   xray     X 光检测装置，心跳 60 s，结果按每班一次的扫描更新（changedAt = 最近扫描时刻）
 *
 * 汇总值一律从四舍五入后的明细重新算，保证 rules.json 的 sum / ratio 规则逐快照成立。
 */
import { ST_NAME } from "./simulator.js"

const MIN = 60000

/** 稳定的伪随机相位（ms），让各传感器的上报时刻错开 */
function phaseOf(id, period) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % period
}
const r1 = (v) => Math.round(v * 10) / 10
const r2 = (v) => Math.round(v * 100) / 100
const r0 = (v) => Math.round(v)

const PROT_NAME = {
  PX: "跑偏",
  DM: "堆煤",
  ES: "急停",
  SL: "打滑",
  SM: "烟雾",
  TS: "超温",
  TN: "张力",
  TR: "撕裂"
}

/** 测点定义：[{id, device, name, unit, kind, min, max, cls}] */
export function definePoints(layout) {
  const P = []
  const add = (id, device, name, unit, kind, min, max, cls = "plc") =>
    P.push({ id, device, name, unit, kind, min, max, cls })
  const devs = (kind) => layout.devices.filter((d) => d.kind === kind)

  // 全矿汇总
  add(
    "MINE.outputToday",
    "MINE",
    "今日原煤产量（主斜井皮带秤）",
    "t",
    "counter",
    0,
    60000
  )
  add(
    "MINE.flowNow",
    "MINE",
    "当前运量（主斜井皮带秤）",
    "t/h",
    "analog",
    0,
    3600
  )
  add("MINE.beltsRunning", "MINE", "运行皮带", "条", "analog", 0, 6)
  add(
    "MINE.powerTotal",
    "MINE",
    "主煤流总功率（下运回馈为负）",
    "kW",
    "analog",
    -3000,
    12000
  )
  add("MINE.energyToday", "MINE", "今日耗电", "kWh", "counter", 0, 200000)
  add("MINE.regenToday", "MINE", "今日下运回馈电量", "kWh", "counter", 0, 40000)
  add("MINE.kwhPerTon", "MINE", "吨煤电耗", "kWh/t", "analog", 0, 20)
  add("MINE.inventory", "MINE", "煤仓存煤合计", "t", "analog", 0, 16000)
  add(
    "MINE.peopleUnderground",
    "MINE",
    "皮带区域及工作面人数",
    "人",
    "analog",
    0,
    80
  )
  add("MINE.safeDays", "MINE", "安全生产天数", "天", "counter", 0, 10000)
  for (const k of [
    "total",
    "person",
    "machine",
    "material",
    "env",
    "l1",
    "l2",
    "l3",
    "l4"
  ])
    add(
      `MINE.alarm.${k}`,
      "MINE",
      {
        total: "未结束告警",
        person: "人员告警",
        machine: "设备告警",
        material: "物料告警",
        env: "环境告警",
        l1: "一级告警",
        l2: "二级告警",
        l3: "三级告警",
        l4: "四级告警"
      }[k],
      "条",
      "analog",
      0,
      100
    )
  for (const k of ["total", "normal", "attention", "warning", "fault"])
    add(
      `MINE.dev.${k}`,
      "MINE",
      {
        total: "监测设备",
        normal: "健康",
        attention: "注意",
        warning: "预警",
        fault: "故障停机"
      }[k],
      "台",
      "analog",
      0,
      60
    )

  for (const b of layout.belts) {
    const id = b.id
    add(`${id}.state`, id, `${b.short} 运行状态`, "", "state")
    add(`${id}.running`, id, `${b.short} 是否在运行`, "", "analog", 0, 1)
    add(`${id}.v`, id, `${b.short} 带速`, "m/s", "analog", 0, b.v * 1.05)
    add(
      `${id}.load`,
      id,
      `${b.short} 带上存煤`,
      "t",
      "analog",
      0,
      ((b.Q / (3.6 * b.vMin)) * b.L) / 1000
    )
    add(
      `${id}.flowOut`,
      id,
      `${b.short} 机头卸载量（提速时带上存煤集中卸出，可短时超过额定）`,
      "t/h",
      "analog",
      0,
      b.Q * 2
    )
    add(
      `${id}.power`,
      id,
      `${b.short} 驱动总功率`,
      "kW",
      "analog",
      -b.power,
      b.power * 1.2
    )
    add(
      `${id}.energyToday`,
      id,
      `${b.short} 今日耗电`,
      "kWh",
      "counter",
      0,
      b.power * 24
    )
    if (b.downhill)
      add(
        `${id}.regenToday`,
        id,
        `${b.short} 今日回馈电量`,
        "kWh",
        "counter",
        0,
        b.power * 24
      )
    add(`${id}.runHours`, id, `${b.short} 今日运行时长`, "h", "counter", 0, 24)
    add(`${id}.tension`, id, `${b.short} 拉紧装置张力`, "kN", "analog", 0, 800)
    add(`${id}.slip`, id, `${b.short} 打滑率`, "%", "analog", 0, 10)
    add(`${id}.deviation`, id, `${b.short} 最大跑偏量`, "mm", "analog", 0, 150)
    add(`${id}.prot`, id, `${b.short} 综合保护`, "", "state")
    if (b.area !== "surface")
      add(`${id}.people`, id, `${b.short} 区域人数`, "人", "analog", 0, 30)
  }
  for (const d of devs("beltScale")) {
    add(`${d.id}.flow`, d.id, `${d.name} 瞬时流量`, "t/h", "analog", 0, 4000)
    add(
      `${d.id}.tonsToday`,
      d.id,
      `${d.name} 今日累计`,
      "t",
      "counter",
      0,
      60000
    )
  }
  for (const d of devs("motor")) {
    add(`${d.id}.current`, d.id, `${d.name} 电流`, "A", "analog", 0, 400)
    add(
      `${d.id}.power`,
      d.id,
      `${d.name} 功率`,
      "kW",
      "analog",
      -d.kW,
      d.kW * 1.2
    )
    add(
      `${d.id}.tWinding`,
      d.id,
      `${d.name} 绕组温度`,
      "°C",
      "analog",
      -20,
      160
    )
    add(
      `${d.id}.tDE`,
      d.id,
      `${d.name} 驱动端轴承温度`,
      "°C",
      "analog",
      -20,
      120,
      "wireless"
    )
    add(
      `${d.id}.tNDE`,
      d.id,
      `${d.name} 非驱动端轴承温度`,
      "°C",
      "analog",
      -20,
      120,
      "wireless"
    )
    add(
      `${d.id}.vibDE`,
      d.id,
      `${d.name} 驱动端振动`,
      "mm/s",
      "analog",
      0,
      20,
      "wireless"
    )
    add(
      `${d.id}.vibNDE`,
      d.id,
      `${d.name} 非驱动端振动`,
      "mm/s",
      "analog",
      0,
      20,
      "wireless"
    )
    add(
      `${d.id}.env`,
      d.id,
      `${d.name} 包络值`,
      "gE",
      "analog",
      0,
      12,
      "wireless"
    )
  }
  for (const d of devs("reducer")) {
    add(`${d.id}.tOil`, d.id, `${d.name} 润滑油温`, "°C", "analog", -20, 110)
    add(
      `${d.id}.tIn`,
      d.id,
      `${d.name} 输入轴承温度`,
      "°C",
      "analog",
      -20,
      120,
      "wireless"
    )
    add(
      `${d.id}.tOut`,
      d.id,
      `${d.name} 输出轴承温度`,
      "°C",
      "analog",
      -20,
      120,
      "wireless"
    )
    add(
      `${d.id}.vib`,
      d.id,
      `${d.name} 振动`,
      "mm/s",
      "analog",
      0,
      20,
      "wireless"
    )
  }
  for (const d of devs("drivePulley")) {
    add(
      `${d.id}.tBearing`,
      d.id,
      `${d.name} 轴承温度`,
      "°C",
      "analog",
      -20,
      120,
      "wireless"
    )
    add(
      `${d.id}.vib`,
      d.id,
      `${d.name} 振动`,
      "mm/s",
      "analog",
      0,
      20,
      "wireless"
    )
  }
  for (const d of devs("idlerSensor")) {
    add(
      `${d.id}.temp`,
      d.id,
      `${d.name} 温度`,
      "°C",
      "analog",
      -20,
      120,
      "wireless"
    )
    add(
      `${d.id}.rpm`,
      d.id,
      `${d.name} 转速`,
      "r/min",
      "analog",
      0,
      700,
      "wireless"
    )
  }
  for (const d of devs("dts")) {
    add(
      `${d.id}.max`,
      d.id,
      `${d.name} 全线最高温度`,
      "°C",
      "analog",
      -20,
      200,
      "dts"
    )
    add(
      `${d.id}.maxAt`,
      d.id,
      `${d.name} 最高温度位置`,
      "m",
      "analog",
      0,
      3000,
      "dts"
    )
  }
  for (const d of devs("das")) {
    add(
      `${d.id}.alarms`,
      d.id,
      `${d.name} 异响点数`,
      "处",
      "analog",
      0,
      50,
      "das"
    )
    add(
      `${d.id}.maxScore`,
      d.id,
      `${d.name} 最大异响评分`,
      "",
      "analog",
      0,
      1,
      "das"
    )
  }
  for (const d of devs("xray")) {
    add(
      `${d.id}.breaks`,
      d.id,
      `${d.name} 断丝处数`,
      "处",
      "analog",
      0,
      50,
      "xray"
    )
    add(
      `${d.id}.maxElong`,
      d.id,
      `${d.name} 接头最大伸长`,
      "mm",
      "analog",
      0,
      60,
      "xray"
    )
  }
  for (const d of devs("env")) {
    add(`${d.id}.co`, d.id, `${d.name} CO`, "ppm", "analog", 0, 200, "env")
    add(`${d.id}.ch4`, d.id, `${d.name} 甲烷`, "%", "analog", 0, 4, "env")
    add(
      `${d.id}.dust`,
      d.id,
      `${d.name} 粉尘`,
      "mg/m³",
      "analog",
      0,
      100,
      "env"
    )
    add(`${d.id}.temp`, d.id, `${d.name} 温度`, "°C", "analog", -30, 50, "env")
    add(`${d.id}.rh`, d.id, `${d.name} 湿度`, "%", "analog", 0, 100, "env")
  }
  for (const d of devs("camera")) {
    add(
      `${d.id}.state`,
      d.id,
      `${d.name} 状态`,
      "",
      "state",
      undefined,
      undefined,
      "cam"
    )
    add(
      `${d.id}.conf`,
      d.id,
      `${d.name} 识别置信度`,
      "%",
      "analog",
      0,
      100,
      "cam"
    )
  }
  for (const d of devs("uwb")) {
    add(
      `${d.id}.online`,
      d.id,
      `${d.id} 在线`,
      "",
      "state",
      undefined,
      undefined,
      "uwb"
    )
    add(
      `${d.id}.tags`,
      d.id,
      `${d.id} 覆盖范围内人数`,
      "人",
      "analog",
      0,
      30,
      "uwb"
    )
  }
  for (const m of layout.bunkers) {
    add(`${m.id}.level`, m.id, `${m.name} 煤位`, "%", "analog", 0, 100)
    add(`${m.id}.tons`, m.id, `${m.name} 存煤`, "t", "analog", 0, m.cap)
  }
  for (const f of layout.feeders)
    add(
      `${f.id}.rate`,
      f.id,
      `${f.name} 给煤量`,
      "t/h",
      "analog",
      0,
      f.qMax * 1.05
    )
  for (const f of layout.faces) {
    add(`${f.id}.state`, f.id, `${f.name} 状态`, "", "state")
    add(`${f.id}.output`, f.id, `${f.name} 出煤量`, "t/h", "analog", 0, 3000)
    add(`${f.id}.people`, f.id, `${f.name} 人数`, "人", "analog", 0, 40)
  }
  add(
    "WF12301.cuts",
    "WF12301",
    "12301 综采工作面 今日刀数",
    "刀",
    "counter",
    0,
    30
  )
  for (const id of ["RB01", "RB02", "DOG01"]) {
    add(`${id}.pos`, id, `${id} 位置（里程）`, "m", "analog", 0, 3000, "robot")
    add(
      `${id}.state`,
      id,
      `${id} 状态`,
      "",
      "state",
      undefined,
      undefined,
      "robot"
    )
    add(`${id}.battery`, id, `${id} 电量`, "%", "analog", 0, 100, "robot")
  }
  return P
}

const FACE_PHASE = {
  sump: "斜切进刀",
  cut: "割煤",
  end: "端头作业",
  stop: "停机",
  idle: "未生产",
  support: "支护"
}
const STALE = {
  plc: 10,
  wireless: 1500,
  dts: 30,
  das: 30,
  env: 10,
  cam: 10,
  uwb: 30,
  robot: 10,
  xray: 120
}

/**
 * 读出 t 时刻全部测点：{ id: { v, q, changedAt, verifiedAt } }（时间为毫秒）
 * points 由 definePoints 给出；s 可传入已算好的 sim.at(ms) 以免重复计算
 */
export function readPoints(sim, points, ms, s = sim.at(ms)) {
  const layout = sim.layout
  const out = {}
  const lag = (id, period) => ms - (phaseOf(id, period) % period)
  const alarms = s.alarms

  // 皮带状态最后一次变化的时刻（停车时各量保持不变，changedAt 取这个时刻）
  const stChanged = {}
  for (const b of layout.belts) {
    let t = ms
    const cur = sim.chAt(`st:${b.id}`, ms, true)
    for (let k = 1; k < 720; k++) {
      const tt = ms - k * 10000
      if (sim.chAt(`st:${b.id}`, tt, true) !== cur) break
      t = tt
    }
    stChanged[b.id] = t
  }
  const devBelt = Object.fromEntries(layout.devices.map((d) => [d.id, d.belt]))

  /** 按类别写一个测点 */
  function put(p, v, opt = {}) {
    let verifiedAt = opt.verifiedAt ?? lag(p.id, 1000)
    let changedAt = opt.changedAt ?? verifiedAt
    let q = opt.q || "good"
    if (opt.frozenAt !== undefined) {
      verifiedAt = opt.frozenAt
      changedAt = Math.min(changedAt, verifiedAt)
      q = (ms - verifiedAt) / 1000 > STALE[p.cls] ? "bad" : "uncertain"
    }
    changedAt = Math.min(changedAt, verifiedAt)
    out[p.id] = { v, q, changedAt, verifiedAt }
  }

  // 预先算汇总要用的明细（四舍五入后再汇总）
  const motorPow = {}
  const beltPow = {}
  for (const b of layout.belts) {
    beltPow[b.id] = 0
    for (const m of s.belts[b.id].motors) {
      motorPow[m.id] = r1(m.power)
      beltPow[b.id] += motorPow[m.id]
    }
    beltPow[b.id] = r1(beltPow[b.id])
  }
  const energy = Object.fromEntries(
    layout.belts.map((b) => [b.id, r1(s.belts[b.id].energyToday)])
  )
  const sc = {
    BC02: r1(s.belts.BC02.scaleToday),
    BC01: r1(s.belts.BC01.scaleToday)
  }
  const people = {}
  for (const p of s.people) people[p.area] = (people[p.area] || 0) + 1
  const areaPeople = (id) => people[id] || 0
  const alarmCount = {
    total: alarms.length,
    person: 0,
    machine: 0,
    material: 0,
    env: 0,
    l1: 0,
    l2: 0,
    l3: 0,
    l4: 0
  }
  for (const a of alarms) {
    alarmCount[a.dim]++
    alarmCount[`l${a.level + 1}`]++
  }
  // 设备健康：皮带、电机、减速机、传动滚筒共 52 台
  const health = { normal: 0, attention: 0, warning: 0, fault: 0 }
  const monitored = layout.devices.filter((d) =>
    ["belt", "motor", "reducer", "drivePulley"].includes(d.kind)
  )
  for (const d of monitored) {
    let sev = 0
    for (const tr of s.tracks)
      if (
        tr.device === d.id ||
        (d.kind === "belt" && tr.belt === d.id && tr.kind === "idlerBearing")
      )
        sev = Math.max(sev, tr.s)
    const fault = d.kind === "belt" && s.belts[d.id].state === 6
    health[
      fault
        ? "fault"
        : sev >= 0.7
          ? "warning"
          : sev >= 0.35
            ? "attention"
            : "normal"
    ]++
  }

  const wirelessCache = new Map()
  /** 无线测点：取上次上报时刻的读数 */
  function wireless(devId, fn) {
    const rt =
      ms - ((((ms - phaseOf(devId, 600000)) % 600000) + 600000) % 600000)
    if (!wirelessCache.has(devId)) wirelessCache.set(devId, { rt, r: fn(rt) })
    return wirelessCache.get(devId)
  }
  const lowBattery = (devId) =>
    alarms.some((a) => a.kind === "battery" && a.device === devId)

  const motorDev = {}
  for (const b of layout.belts)
    for (const m of s.belts[b.id].motors) motorDev[m.id] = m
  const reducerDev = {}
  for (const b of layout.belts)
    for (const r of s.belts[b.id].reducers) reducerDev[r.id] = r

  for (const p of points) {
    const [dev, key] = [p.device, p.id.slice(p.device.length + 1)]
    const belt = devBelt[dev]
    const stopAt =
      belt && s.belts[belt] && s.belts[belt].v <= 0.05
        ? stChanged[belt]
        : undefined
    if (dev === "MINE") {
      const v = {
        outputToday: sc.BC02,
        flowNow: r1(s.kpi.flowNow),
        beltsRunning: layout.belts.reduce(
          (a, b) => a + (s.belts[b.id].v > 0.05 ? 1 : 0),
          0
        ),
        powerTotal: r1(Object.values(motorPow).reduce((a, x) => a + x, 0)),
        energyToday: r1(Object.values(energy).reduce((a, x) => a + x, 0)),
        regenToday: r1(s.belts.BC04.regenToday),
        kwhPerTon: 0,
        inventory: r1(
          layout.bunkers.reduce((a, m) => a + r1(s.bunkers[m.id].tons), 0)
        ),
        peopleUnderground: [
          "BC02",
          "BC03",
          "BC04",
          "BC05",
          "BC06",
          "WF12301",
          "WF12305"
        ].reduce((a, k) => a + areaPeople(k), 0),
        safeDays: s.kpi.safeDays
      }
      if (key === "kwhPerTon") {
        const e = Object.values(energy).reduce((a, x) => a + x, 0)
        put(p, sc.BC02 > 0 ? r1(e) / sc.BC02 : 0)
      } else if (key.startsWith("alarm.")) put(p, alarmCount[key.slice(6)])
      else if (key.startsWith("dev.")) {
        const k = key.slice(4)
        put(p, k === "total" ? monitored.length : health[k])
      } else put(p, v[key])
      continue
    }
    const b = s.belts[dev]
    if (b) {
      const v = {
        state: ST_NAME[b.state],
        running: b.v > 0.05 ? 1 : 0,
        v: r2(b.v),
        load: r1(b.load),
        flowOut: r1(b.flowOut),
        power: beltPow[dev],
        energyToday: energy[dev],
        regenToday: r1(b.regenToday),
        runHours: r2(b.runHoursToday),
        tension: r1(b.tension),
        slip: r2(b.slip),
        deviation: r0(b.deviation),
        prot: b.protection
          ? `${PROT_NAME[b.protection] || b.protection}保护动作`
          : "正常",
        people: areaPeople(dev)
      }[key]
      const stateLike = key === "state" || key === "prot" || key === "running"
      put(p, v, { changedAt: stateLike ? stChanged[dev] : stopAt })
      continue
    }
    if (dev.endsWith("-SC")) {
      put(p, key === "flow" ? r1(s.belts[belt].scaleFlow) : sc[belt], {
        changedAt: stopAt
      })
      continue
    }
    if (motorDev[dev]) {
      if (p.cls === "wireless") {
        const w = wireless(dev, (rt) => sim.motorReading(dev, rt))
        const v = {
          tDE: r1(w.r.tDE),
          tNDE: r1(w.r.tNDE),
          vibDE: r2(w.r.vibDE),
          vibNDE: r2(w.r.vibNDE),
          env: r2(w.r.envelope)
        }[key]
        put(p, v, { verifiedAt: w.rt, changedAt: w.rt })
      } else {
        const m = motorDev[dev]
        const v = {
          current: r1(m.current),
          power: motorPow[dev],
          tWinding: r1(m.tWinding)
        }[key]
        put(p, v, { changedAt: key === "tWinding" ? undefined : stopAt })
      }
      continue
    }
    if (reducerDev[dev]) {
      if (p.cls === "wireless") {
        const w = wireless(dev, (rt) => sim.reducerReading(dev, rt))
        put(
          p,
          { tIn: r1(w.r.tIn), tOut: r1(w.r.tOut), vib: r2(w.r.vib) }[key],
          { verifiedAt: w.rt, changedAt: w.rt }
        )
      } else put(p, r1(reducerDev[dev].tOil))
      continue
    }
    const d = layout.devices.find((x) => x.id === dev)
    switch (d?.kind) {
      case "drivePulley": {
        const w = wireless(dev, (rt) => sim.pulleyReading(dev, rt))
        put(p, key === "tBearing" ? r1(w.r.tBearing) : r2(w.r.vib), {
          verifiedAt: w.rt,
          changedAt: w.rt
        })
        break
      }
      case "idlerSensor": {
        const w = wireless(dev, (rt) => sim.idlerReading(dev, rt))
        put(p, key === "temp" ? r1(w.r.temp) : r0(w.r.rpm), {
          verifiedAt: w.rt,
          changedAt: w.rt,
          q: lowBattery(dev) ? "uncertain" : "good"
        })
        break
      }
      case "dts": {
        const comm = alarms.find((a) => a.kind === "comm" && a.device === dev)
        const tt = comm ? comm.at : ms
        const T = sim.dts(belt, tt)
        let mx = -1e9
        let at = 0
        for (let x = 0; x < T.length; x++) if (T[x] > mx) [mx, at] = [T[x], x]
        put(
          p,
          key === "max" ? r1(mx) : at,
          comm ? { frozenAt: comm.at } : { verifiedAt: lag(dev, 5000) }
        )
        break
      }
      case "das": {
        const a = sim.das(belt, ms)
        let mx = 0
        for (const x of a.score) mx = Math.max(mx, x)
        put(p, key === "alarms" ? a.found.length : r2(mx), {
          verifiedAt: lag(dev, 5000)
        })
        break
      }
      case "xray": {
        const x = sim.xray(belt, ms)
        const v =
          key === "breaks"
            ? x.damages.filter((k) => k.type === "断丝").length
            : Math.max(...x.splices.map((k) => k.elong))
        put(p, v, {
          verifiedAt: lag(dev, 60000),
          changedAt: Math.min(x.lastScan, lag(dev, 60000))
        })
        break
      }
      case "env": {
        const e = sim.envReading(dev, ms)
        put(
          p,
          {
            co: r1(e.co),
            ch4: r2(e.ch4),
            dust: r1(e.dust),
            temp: r1(e.temp),
            rh: r0(e.rh)
          }[key],
          { verifiedAt: lag(dev, 2000) }
        )
        break
      }
      case "camera": {
        const c = sim.cameraReading(dev, ms)
        if (key === "state") put(p, c.state === "dirty" ? "镜头脏污" : "在线")
        else
          put(p, r0(c.conf), { q: c.state === "dirty" ? "uncertain" : "good" })
        break
      }
      case "uwb": {
        const u = sim.uwbReading(dev, ms, s.people)
        if (key === "online") put(p, u.online ? "在线" : "离线")
        else put(p, u.tags, u.online ? {} : { frozenAt: u.offSince })
        break
      }
      case "bunker": {
        const m = s.bunkers[dev]
        put(p, key === "level" ? r1(m.level * 100) : r1(m.tons))
        break
      }
      case "feeder":
        put(p, r1(s.feeders[dev].rate))
        break
      case "longwall":
      case "devFace": {
        const f = s.faces[dev]
        const v = {
          state: FACE_PHASE[f.phase] || f.phase,
          output: r1(f.output),
          people: areaPeople(dev),
          cuts: f.cutsToday
        }[key]
        put(p, v)
        break
      }
      case "robotRail":
      case "robotDog": {
        const r = s.robots[dev]
        put(p, { pos: r.pos, state: r.stateName, battery: r0(r.battery) }[key])
        break
      }
      default:
        throw new Error("未处理的测点 " + p.id)
    }
  }
  return out
}

export { MIN }

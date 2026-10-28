/*
 * /mine-fire 火情演练仿真
 * ----------------------------------------------------------
 * 一个 16 分钟的演练剧本，剧本时刻 s（秒）从 14:00:00 起算，到 s = CYCLE 回到起点循环。
 * 所有输出都只由 s 决定（同一 s 结果固定），方便钉住定稿时刻（s = 378，14:06:18）和拖动回放。
 *
 * 剧本（定稿的时间线，联动逻辑按霄云规格书第六章）：
 *   0      一盘区变电所高防开关区某柜电缆接头开始过热，光纤温度缓慢上升
 *   107    光纤 63.5 ℃ ≥ 60 ℃ → 一级预警（单一类型：只声光报警、上传调度、派巡检，不断电不喷放）
 *   192    SM-04-01 烟雾报警（仍是单一类型）；205 SM-04-02 也报警
 *   214    CO 过 20 ppm 预警
 *   238    CO 26 ppm ≥ 24 + 烟雾报警 → 组合三火灾确认，进入 30 s 延时
 *   239    断电闭锁（切本分区高压馈电，保留照明、监控）  240 应急广播、人员开始撤离  242 关进回风防火阀
 *   268    延时结束无急停 → 高防开关区 6 台柜内全氟己酮装置喷放      276 喷放反馈 6/6，系统锁定
 *   276–900 复燃监测：光纤、CO 回落；两组人员分别向副井井底车场（上风侧）、南永久避难硐室（下风侧）撤离
 *   900    现场手动复位（已喷放装置待充装），之后回到正常监测，960 循环
 *
 * 数据口径见 ../data/site.js；人员定位、读数波动用固定种子的伪随机数。
 */
import {
  CHAMBERS,
  TH,
  SENSOR_TYPES,
  FAULT_UNIT,
  OFFLINE_SENSOR,
  REFUGE_ENV,
  WARN_HISTORY,
  TODAY_BEFORE,
  DATE,
  UNDERGROUND
} from "../data/site.js"
import { polyLength, pointAt, rng, interp } from "./path.js"

export const CYCLE = 960
export const DESIGN_S = 378 // 定稿那一刻：14:06:18
export const FIRE_DS = "DS-04"
export const FIRE_ZONE = "高防开关区"

// 剧本关键时刻（秒）
export const KEY = {
  warn: 107,
  smoke: 192,
  smoke2: 205,
  coWarn: 214,
  confirm: 238,
  cut: 239,
  broadcast: 240,
  damper: 242,
  spray: 268,
  feedback: 276,
  found: 520, // 救护队联系上两名未响应人员，他们开始撤离
  reset: 900
}

// DS-04 光纤最高温（℃）、CO（ppm）、环境温度的关键点；0–378 段与定稿趋势图一致。
// CO 在 236 s 还是 23.2 ppm、238 s 跳到 26 ppm：保证组合三（烟雾 + CO ≥ 24）正好在确认那一秒才成立
const DTS_KEYS = [
  [0, 41],
  [60, 52],
  [107, 63.5],
  [150, 78],
  [180, 92],
  [210, 103],
  [238, 109],
  [255, 121],
  [268, 128],
  [285, 112],
  [300, 98],
  [330, 85],
  [360, 77],
  [378, 74],
  [420, 69],
  [480, 63],
  [600, 55],
  [750, 48],
  [900, 44],
  [960, 41]
]
const CO_KEYS = [
  [0, 2],
  [60, 3],
  [120, 6],
  [150, 9],
  [180, 14],
  [214, 20],
  [236, 23.2],
  [238, 26],
  [268, 31],
  [300, 29],
  [330, 26],
  [360, 24],
  [378, 23],
  [420, 21],
  [480, 19],
  [600, 14],
  [750, 8],
  [900, 4],
  [960, 2]
]
const TEMP_KEYS = [
  [0, 26],
  [107, 26.8],
  [238, 29.5],
  [268, 33.2],
  [378, 31.8],
  [600, 29],
  [900, 27],
  [960, 26]
]

/** 剧本秒 → "14:06:18" */
export function hms(s) {
  const t = 14 * 3600 + Math.floor(s)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const ss = t % 60
  const p = (x) => String(x).padStart(2, "0")
  return `${p(h)}:${p(m)}:${p(ss)}`
}

const sum = (a) => a.reduce((x, y) => x + y, 0)
// 平时读数的小幅波动（确定性）：几个不同周期的正弦叠加
// 以定稿时刻为零点：s = 378 时波动为 0，定稿那一刻的读数正好等于设计值
const wobble = (s, seed, amp) => {
  const x = s - 378
  return (
    amp *
    (0.6 * Math.sin(x / (37 + seed)) +
      0.3 * Math.sin(x / (11 + seed * 0.7)) +
      0.1 * Math.sin(x / (3.7 + seed * 0.3)))
  )
}

/* ================================================================ 人员 */

/*
 * 受影响区域 37 人：R1 上风侧 24 人向北撤到副井井底车场，R2 下风侧 13 人向南撤进 RC-01 避难硐室。
 * 到达时刻按定稿那一刻（378 s）的统计反推：R1 已安全 19 / 撤离中 5；R2 已安全 2 / 撤离中 9 / 未响应 2。
 * 其余 149 人在各工作面、大巷正常作业。
 */
const R1_ARRIVE = [
  262, 268, 275, 281, 288, 294, 300, 307, 313, 320, 326, 333, 339, 345, 352,
  358, 364, 370, 376, 405, 448, 497, 552, 610
]
const R2_ARRIVE = [330, 366, 402, 431, 459, 488, 517, 546, 575, 604, 633]
// 两名未响应人员：离 R2 起点的距离（米）、定位卡开始静止的剧本秒（静止满 60 s 才判为未响应，
// 到定稿时刻 378 s 分别静止 96 s、74 s），一直不动到 KEY.found 救护队联系上
const R2_LOST = [
  { card: "#1047", d0: 260, stillSince: 282, off: [-150, 10] },
  { card: "#1121", d0: 430, stillSince: 304, off: [-115, -25] }
]

// 非受影响人员的分布：作业地点 → 人数（合计 149）
const HOMES = [
  ["WF-202", 40],
  ["WF-201", 25],
  ["WF-101", 10],
  ["C-E", 20],
  ["C-W", 22],
  ["C-2N", 8],
  ["hub", 24]
]

function buildPeople(plan) {
  const R = rng(20261027)
  const route = Object.fromEntries(
    plan.routes.map((r) => [r.id, { pts: r.pts, L: polyLength(r.pts) }])
  )
  // R1 的"安全点"= 井底车场交叉口（路线第 2 个点），之后继续走到副井
  const r1 = route.R1
  const r1Safe = polyLength(r1.pts.slice(0, 2))
  const r2 = route.R2
  const list = []
  let card = 1001
  const next = () => `#${card++}`

  R1_ARRIVE.forEach((arr) => {
    const react = 8 + R() * 16
    const v = 1.3 + R() * 0.6
    const d0 = Math.max(0, r1Safe - v * (arr - KEY.broadcast - react))
    list.push({ card: next(), route: "R1", d0, react, v, arr, safeD: r1Safe })
  })
  R2_ARRIVE.forEach((arr) => {
    const react = 8 + R() * 16
    const v = 1.2 + R() * 0.5
    const d0 = Math.max(0, r2.L - v * (arr - KEY.broadcast - react))
    list.push({ card: next(), route: "R2", d0, react, v, arr, safeD: r2.L })
  })
  R2_LOST.forEach(({ card, d0, stillSince, off }) => {
    const v = 1.9
    // 联系上之后才开始走
    const arr = KEY.found + (r2.L - d0) / v
    list.push({
      card,
      route: "R2",
      d0,
      react: KEY.found - KEY.broadcast,
      v,
      arr,
      safeD: r2.L,
      lost: true,
      stillSince,
      off
    })
  })

  // 作业地点的折线（平面坐标）
  const corridor = Object.fromEntries(plan.corridors.map((c) => [c.id, c.pts]))
  const panelFace = (id) => {
    const p = plan.panels.find((x) => x.id === id)
    const [[e0, n0], [e1, n1]] = p.rect
    // 工作面切眼在远离大巷的一端：南翼 101 沿东西向，远端在东；二盘区沿南北向，远端在北
    return Math.abs(e1 - e0) > Math.abs(n1 - n0)
      ? [
          [e1, n0],
          [e1, n1]
        ]
      : [
          [e0, n1],
          [e1, n1]
        ]
  }
  const homes = {
    "WF-202": panelFace("WF-202"),
    "WF-201": panelFace("WF-201"),
    "WF-101": panelFace("WF-101"),
    "C-E": corridor["C-E"],
    "C-W": corridor["C-W"],
    "C-2N": corridor["C-2N"],
    hub: corridor["C-N"].slice(0, 2)
  }
  for (const [k, n] of HOMES) {
    const pts = homes[k]
    const L = polyLength(pts)
    for (let i = 0; i < n; i++) {
      list.push({
        card: next(),
        home: pts,
        // 每人在自己作业点附近来回走动：中心位置、摆幅、周期、相位
        c: L * (0.05 + 0.9 * R()),
        amp: 6 + R() * 30,
        per: 120 + R() * 300,
        ph: R() * Math.PI * 2,
        L
      })
    }
  }
  return { list, route }
}

/* ================================================================ 仿真器 */

export function createMineFireSim(plan) {
  const { list: people, route } = buildPeople(plan)
  const affected = people.filter((p) => p.route)

  /** 单人在 s 时的状态：0 正常作业 / 1 撤离中 / 2 未响应 / 3 已到安全点（R1 在车场，R2 进了避难硐室） */
  function personState(p, s) {
    if (!p.route || s < KEY.broadcast) return 0
    if (s >= p.arr) return 3
    // 定位卡静止满 60 s 才判为未响应，之前按撤离中算
    if (p.lost && s < KEY.found) return s >= p.stillSince + 60 ? 2 : 1
    return 1
  }
  /** 单人沿路线已走的距离 */
  function personD(p, s) {
    if (s < KEY.broadcast + p.react) return p.d0
    return Math.min(
      route[p.route].L,
      p.d0 + p.v * (s - KEY.broadcast - p.react)
    )
  }

  /** DS-04 当前读数 */
  function fireRead(s) {
    return {
      dts: interp(DTS_KEYS, s),
      co: interp(CO_KEYS, s),
      temp: interp(TEMP_KEYS, s)
    }
  }

  /** 剧本阶段 */
  function phaseOf(s) {
    if (s < KEY.warn) return "normal"
    if (s < KEY.confirm) return "warn"
    if (s < KEY.spray) return "countdown"
    if (s < KEY.reset) return "sprayed"
    return "reset"
  }

  /** 探测器异常清单（报警 / 预警 / 离线） */
  function sensorEvents(s, r) {
    const ev = []
    const on = (a, b) => s >= a && s < b
    if (on(KEY.smoke, KEY.reset))
      ev.push({
        id: "SM-04-01",
        ds: FIRE_DS,
        type: "smoke",
        level: "alarm",
        text: "报警（锁存）"
      })
    if (on(KEY.smoke2, KEY.reset))
      ev.push({
        id: "SM-04-02",
        ds: FIRE_DS,
        type: "smoke",
        level: "alarm",
        text: "报警（锁存）"
      })
    if (on(246, 270))
      ev.push({
        id: "FL-04-01",
        ds: FIRE_DS,
        type: "flame",
        level: "alarm",
        text: "明火"
      })
    if (r.dts >= TH.dts.warn)
      ev.push({
        id: "DTS-04",
        ds: FIRE_DS,
        type: "dts",
        level: r.dts >= TH.dts.alarm ? "alarm" : "warn",
        text: `${r.dts.toFixed(1)} ℃ · 12 m 处`
      })
    if (r.co >= TH.co.warn)
      ev.push({
        id: "CO-04-01",
        ds: FIRE_DS,
        type: "co",
        level: r.co >= TH.co.alarm ? "alarm" : "warn",
        text: `${Math.round(r.co)} ppm`
      })
    ev.push({
      ...OFFLINE_SENSOR,
      level: "off",
      text: `最后上报 ${OFFLINE_SENSOR.last}`
    })
    return ev
  }

  /** 联动流程 9 步（规格书第六章顺序） */
  function steps(s, phase) {
    const left = Math.max(0, Math.ceil(KEY.spray - s))
    const list = [
      {
        t: KEY.warn,
        k: "一级预警",
        d: "光纤 12 m 处 63.5 ℃ ≥ 60 ℃，派巡检",
        pre: true
      },
      {
        t: KEY.smoke,
        k: "二次信号",
        d: "SM-04-01 烟雾报警，单类型仍为预警",
        pre: true
      },
      {
        t: KEY.confirm,
        k: "火灾确认",
        d: "烟雾报警 + CO 26 ppm ≥ 24（组合三）",
        hot: true
      },
      { t: KEY.cut, k: "断电闭锁", d: "切断本区高压馈电，保留照明、监控" },
      { t: KEY.broadcast, k: "应急广播", d: "一盘区、主运输大巷南段播报撤离" },
      { t: KEY.damper, k: "关防火阀", d: "FD-04-1 进风 / FD-04-2 回风 已关" },
      {
        t: KEY.spray,
        k: "延时喷放",
        d:
          phase === "countdown"
            ? `30 s 延时 · 剩余 ${left} s，可急停`
            : "30 s 内无急停，6 台装置启动"
      },
      { t: KEY.feedback, k: "喷放反馈", d: "反馈 6/6，锁定待现场复位" },
      phase === "reset"
        ? { t: KEY.reset, k: "现场复位", d: "复燃监测结束，待充装 6 台" }
        : { t: null, k: "复燃监测", d: "光纤、CO 回落中，禁止自动复电" }
    ]
    return list.map((x) => {
      let status = "pending"
      if (x.k === "延时喷放" && phase === "countdown") status = "active"
      else if (x.k === "复燃监测")
        status = s >= KEY.feedback ? "active" : "pending"
      else if (s >= x.t) status = "done"
      return {
        ...x,
        time:
          x.k === "复燃监测"
            ? s >= KEY.feedback
              ? "进行中"
              : "—"
            : s >= x.t || status === "active"
              ? hms(x.t)
              : "—",
        status
      }
    })
  }

  /** 面板状态（每次刷新调用，开销很小） */
  function at(sIn) {
    const s = ((sIn % CYCLE) + CYCLE) % CYCLE
    const phase = phaseOf(s)
    const r = fireRead(s)
    const fireActive = phase === "countdown" || phase === "sprayed"
    const sprayed = s >= KEY.spray ? 6 : 0

    // ---------- 硐室
    const events = sensorEvents(s, r)
    const chambers = CHAMBERS.map((c, i) => {
      const units = sum(c.zones.map((z) => z.units))
      const sensorCount = sum(Object.values(c.sensors))
      const off = events.filter(
        (e) => e.ds === c.id && e.level === "off"
      ).length
      const fault = FAULT_UNIT.ds === c.id ? 1 : 0
      const read =
        c.id === FIRE_DS
          ? r
          : {
              dts: c.base.dts + wobble(s, i + 1, 0.4),
              co: Math.max(0, Math.round(c.base.co + wobble(s, i + 7, 0.6))),
              temp: c.base.temp + wobble(s, i + 3, 0.2)
            }
      let state = fault ? "fault" : off ? "off" : "ok"
      if (c.id === FIRE_DS) {
        if (phase === "warn") state = "warn"
        else if (fireActive) state = "fire"
        else if (phase === "reset") state = "reset"
      }
      return {
        ...c,
        units,
        sensorCount,
        online: sensorCount - off,
        fault,
        off,
        read,
        state
      }
    })

    // ---------- 探测器分类统计
    const sensorsByType = SENSOR_TYPES.map((t) => {
      const total = sum(CHAMBERS.map((c) => c.sensors[t.key]))
      const ev = events.filter((e) => e.type === t.key)
      const n = (lv) => ev.filter((e) => e.level === lv).length
      const alarm = n("alarm")
      const warn = n("warn")
      const off = n("off")
      return { ...t, total, alarm, warn, off, ok: total - alarm - warn - off }
    })
    const sensors = sum(sensorsByType.map((t) => t.total))
    const sensorsOff = sum(sensorsByType.map((t) => t.off))
    const units = sum(chambers.map((c) => c.units))

    // ---------- 今日预警（剧本里每类首次越限记一次）
    const today = { ...TODAY_BEFORE }
    if (s >= KEY.warn) today.heat++
    if (s >= KEY.smoke) today.smoke++
    if (s >= KEY.coWarn) today.co++
    if (s >= KEY.confirm) today.fire++
    const warn7d = [...WARN_HISTORY, today]

    // ---------- 人员
    const routes = Object.keys(route).map((id) => {
      const g = affected.filter((p) => p.route === id)
      const st = g.map((p) => personState(p, s))
      return {
        id,
        side: id === "R1" ? "上风侧" : "下风侧",
        to:
          id === "R1" ? "副井井底车场（安全出口）" : "RC-01 永久避难硐室（南）",
        note: id === "R1" ? "沿辅助运输大巷向北" : "佩戴自救器向南",
        total: g.length,
        safe: st.filter((x) => x === 3).length,
        moving: st.filter((x) => x === 1).length,
        lost: st.filter((x) => x === 2).length,
        active: s >= KEY.broadcast && s < KEY.reset
      }
    })
    const evac = s >= KEY.broadcast
    const ppl = evac
      ? routes.reduce(
          (a, x) => ({
            total: a.total + x.total,
            safe: a.safe + x.safe,
            moving: a.moving + x.moving,
            lost: a.lost + x.lost
          }),
          { total: 0, safe: 0, moving: 0, lost: 0 }
        )
      : { total: 0, safe: 0, moving: 0, lost: 0 }
    // 未响应人员名单（定位卡静止）
    const lostList = affected
      .filter((p) => personState(p, s) === 2)
      .map((p) => ({ card: p.card, still: Math.round(s - p.stillSince) }))
    const r2 = routes.find((x) => x.id === "R2")
    const refuges = plan.refuges.map((rf) => ({
      ...rf,
      inside: rf.id === "RC-01" ? r2.safe : 0,
      coming: rf.id === "RC-01" && evac && s < KEY.reset ? r2.moving : 0,
      ...REFUGE_ENV[rf.id]
    }))

    // ---------- 当前火警 / 复合判定
    const confirmed = s >= KEY.confirm
    const at0 = confirmed
      ? { dts: 109, smoke: true, co: 26 }
      : { dts: r.dts, smoke: s >= KEY.smoke, co: r.co }
    const hit = {
      dts: at0.dts >= TH.dts.alarm,
      smoke: at0.smoke,
      co: at0.co >= TH.co.alarm
    }
    const judge = {
      at: confirmed ? hms(KEY.confirm) : hms(s),
      frozen: confirmed,
      values: at0,
      hit,
      combos: [
        { k: "①", n: "光纤+烟雾", hit: hit.dts && hit.smoke },
        { k: "②", n: "光纤+CO", hit: hit.dts && hit.co },
        { k: "③", n: "烟雾+CO", hit: hit.smoke && hit.co }
      ]
    }
    const dur = Math.max(0, Math.floor(s - KEY.confirm))
    const fire = {
      ds: FIRE_DS,
      zone: FIRE_ZONE,
      phase,
      warnAt: hms(KEY.warn),
      confirmAt: hms(KEY.confirm),
      combo: "组合三",
      countdown: Math.max(0, Math.ceil(KEY.spray - s)),
      dur: `${String(Math.floor(dur / 60)).padStart(2, "0")}:${String(dur % 60).padStart(2, "0")}`,
      sprayed,
      zoneUnits: CHAMBERS.find((c) => c.id === FIRE_DS).zones.find(
        (z) => z.name === FIRE_ZONE
      ).units,
      powerCut: s >= KEY.cut && s < KEY.reset,
      dampers: s >= KEY.damper && s < KEY.reset
    }

    return {
      s,
      hms: hms(s),
      date: DATE,
      phase,
      fire,
      judge,
      steps: steps(s, phase),
      chambers,
      events,
      sensorsByType,
      kpi: {
        chambers: CHAMBERS.length,
        zones: sum(CHAMBERS.map((c) => c.zones.length)),
        units,
        sensors,
        warnToday: today.heat + today.co + today.smoke,
        fireToday: today.fire,
        onlineRate: ((sensors - sensorsOff) / sensors) * 100,
        online: sensors - sensorsOff
      },
      units: {
        total: units,
        standby: units - sprayed - 1,
        sprayed,
        fault: 1,
        faultUnit: FAULT_UNIT
      },
      warn7d,
      warn7dTotal: sum(warn7d.map((d) => d.heat + d.co + d.smoke)),
      people: { underground: UNDERGROUND, ...ppl, routes, lostList },
      refuges,
      // 三维场景要的
      scene: {
        ds04: chambers.find((c) => c.id === FIRE_DS).state,
        spraying: s >= KEY.spray && s < KEY.spray + 14,
        // 烟量：确认前后最大，喷放后衰减
        smoke:
          Math.max(0, Math.min(1, (s - KEY.smoke) / 60)) *
          (s < KEY.spray ? 1 : Math.max(0.15, 1 - (s - KEY.spray) / 400)) *
          (s < KEY.reset ? 1 : 0),
        flame: s >= 230 && s < KEY.spray + 6,
        routes: evac && s < KEY.reset,
        dampers: fire.dampers
      }
    }
  }

  /**
   * 人员位置（每帧调用）：写进 out（每人 [e, n, 状态]），返回人数
   * 状态：0 正常作业 / 1 撤离中 / 2 未响应 / 3 已安全（R2 进了避难硐室的不画）
   */
  function peopleAt(sIn, out) {
    const s = ((sIn % CYCLE) + CYCLE) % CYCLE
    let k = 0
    for (const p of people) {
      let e, n, st
      if (p.route) {
        st = personState(p, s)
        let d = personD(p, s)
        // 报警前在原地小范围走动
        if (s < KEY.broadcast) d = Math.max(0, d + 6 * Math.sin(s / 23 + p.d0))
        const q = pointAt(route[p.route].pts, d)
        ;[e, n] = q.p
        // 未响应人员在主大巷西侧的联络巷里（下风侧烟团下），联系上之后 60 s 内走回大巷
        if (p.off) {
          const k = s < KEY.found ? 1 : Math.max(0, 1 - (s - KEY.found) / 60)
          e += p.off[0] * k
          n += p.off[1] * k
        }
        if (st === 3 && p.route === "R2") st = 4
      } else {
        st = 0
        const d = p.c + p.amp * Math.sin((s / p.per) * Math.PI * 2 + p.ph)
        ;[e, n] = pointAt(p.home, Math.min(p.L, Math.max(0, d))).p
      }
      out[k * 3] = e
      out[k * 3 + 1] = n
      out[k * 3 + 2] = st
      k++
    }
    return k
  }

  /** 趋势：窗口 6 分 18 秒（同定稿），s < 378 时固定 0–378，之后跟着滑动；每 6 s 一点 */
  function trend(sIn) {
    const s = ((sIn % CYCLE) + CYCLE) % CYCLE
    const x1 = Math.max(DESIGN_S, s)
    const x0 = x1 - DESIGN_S
    // 每 6 s 一点，再并上关键点（峰值等），末点对齐当前时刻
    const ts = new Set()
    for (let t = x0; t <= s + 1e-6; t += 6) ts.add(t)
    for (const [t] of [...DTS_KEYS, ...CO_KEYS])
      if (t >= x0 && t <= s) ts.add(t)
    ts.add(s)
    const times = [...ts].sort((a, b) => a - b)
    const dts = times.map((t) => [t, interp(DTS_KEYS, t)])
    const co = times.map((t) => [t, interp(CO_KEYS, t)])
    const marks = [
      { s: KEY.warn, k: "预警" },
      { s: KEY.confirm, k: "确认" },
      { s: KEY.spray, k: "喷放" }
    ].filter((m) => m.s >= x0 && m.s <= s)
    return { x0, x1, dts, co, marks, hms0: hms(x0) }
  }

  return { at, peopleAt, trend, count: people.length, CYCLE }
}

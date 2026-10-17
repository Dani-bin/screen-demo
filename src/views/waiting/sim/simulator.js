/*
 * 内科候诊区 · 排队叫号仿真
 * ----------------------------------------------------------
 * 纯 JS，不依赖 Vue / DOM。8 间诊室各自一条队列：
 *   待诊 waiting  已签到、按签到先后排队（初诊）
 *   复诊 recheck  做完检查拿结果回来找同一位医生，保留原号码，优先插叫
 *   过诊 missed   连呼 2 次未到，进过号名单；重新签到后插到队列第 3 位
 * 另计「已诊」人数。
 *
 * 时间不压缩：页面显示真实时钟，仿真也按真实毫秒推进；只是每人就诊很短
 * （初诊 90–240 秒、复诊 60–150 秒），8 间诊室合起来十几二十秒就叫一次号。
 * 开屏时用「热启动」直接造出一个门诊进行中的状态，所以任何时刻打开都很热闹。
 *
 * 实现：离散事件仿真。所有将来要发生的事（签到、叫号、二次呼叫、入室、
 * 就诊结束、过号、重新签到、复诊回来、趋势采样）都放进一条按时间排序的
 * 事件队列；tick(now) 把队列里 at <= now 的事件逐个按时间顺序处理掉。
 * 所有随机数都在事件处理里按固定顺序抽取，所以结果只取决于种子和事件时间，
 * 与页面多久调用一次 tick 无关。
 *
 * 用法：
 *   const sim = createSimulator({ seed, now: Date.now() })
 *   sim.on((evt) => { ... })          // 叫号 / 入室 / 过号等事件
 *   setInterval(() => sim.tick(Date.now()), 250)
 *   state.value = sim.snapshot()      // 每次返回全新的纯对象，可直接放进 ref
 *
 * 注意：标签页挂起后再 tick，会一口气补算最多 10 分钟的事件（更长的空档整体
 * 平移跳过），这些事件的 at 都早于当前时刻。页面播报语音 / 提示音时应按
 * evt.at 过滤掉过时的叫号，避免回到页面时连播几十条。
 */

import { AVG_WAIT_SEED, ROOMS } from "../data/rooms.js"

// ---------------------------------------------------------------- 常量

const SEC = 1000
const MIN = 60 * SEC

/** 叫号后多久第二次呼叫 */
const RECALL_AFTER = 25 * SEC
/** 叫号后多久仍未到 → 过号 */
const MISS_AFTER = 50 * SEC
/** 过号后隔多久叫下一位 */
const NEXT_AFTER_MISS = 3 * SEC
/** 叫号后不来的概率 */
const NO_SHOW_P = 0.1
/** 初诊看完后去做检查、稍后以复诊身份回来的概率 */
const TEST_P = 0.2
/** 过号后重新签到的概率（其余的 30 分钟后从过号名单里消失） */
const REREG_P = 0.6
/** 过号名单保留时长 */
const MISSED_KEEP = 30 * MIN
/** 每叫几位待诊插叫 1 位复诊 */
const RECHECK_EVERY = 2
/** 重新签到的过号患者插到队列的第几位（下标，2 = 第 3 位） */
const REINSERT_AT = 2

/** 每间诊室的签到平均间隔（秒），按当前待诊人数做反馈，见 arrivalInterval */
const ARRIVAL_BASE = 200
/** 稀疏化（thinning）用的最快到达间隔 = 最小的反馈间隔 */
const ARRIVAL_FAST = ARRIVAL_BASE * 0.5

/** tick 一次最多「细算」的时长；更大的空档整体平移跳过 */
const CATCH_UP_MAX = 10 * MIN
/** 趋势图采样间隔 / 回看时长 / 预测时长与间隔 */
const TREND_STEP = 5 * MIN
const TREND_SPAN = 2 * 60 * MIN
const FORECAST_SPAN = 60 * MIN
const FORECAST_STEP = 10 * MIN

/** 列表长度上限 */
const CALLS_MAX = 12
const MISSED_BOARD_MAX = 8
/** 平均等候的滚动窗口（最近几次待诊叫号） */
const WAIT_WINDOW = 10
/** 平均就诊时长的滚动窗口与初值（秒） */
const CONSULT_WINDOW = 20
const CONSULT_SEED = 400

/** 热启动时的号码：最后一位已签到患者拿到 A175，下一位新签到的是 A176 */
const WARM_COUNTER = 175

const SURNAMES =
  "王李张刘陈杨黄赵吴周徐孙马朱胡郭何林罗高郑梁谢宋唐许韩冯邓曹彭曾肖田董袁" +
  "潘蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱" +
  "江尹薛段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤"
const GIVEN =
  "明华芳军敏静丽强磊洋艳勇杰娟涛超秀霞平刚桂英兰文斌宇浩凯红玉梅琳鹏辉建国志" +
  "海波晨欣怡婷丹雪峰亮成"

// ---------------------------------------------------------------- 对外的小工具

/**
 * 出诊时段文字。演示要求任何时刻都是「门诊进行中」，
 * 所以凌晨也归到上午时段，18 点以后算夜间门诊
 */
export function sessionLabel(date) {
  const h = date.getHours()
  if (h < 12) return "上午 08:00–12:00"
  if (h < 18) return "下午 13:30–17:30"
  return "夜间 18:00–22:00"
}

/** 姓名脱敏：三个字及以上保留首尾（张*明），两个字只留姓（李*） */
export function maskName(full) {
  const chars = Array.from(full || "")
  if (chars.length >= 3) return chars[0] + "*" + chars[chars.length - 1]
  if (chars.length === 2) return chars[0] + "*"
  return chars.join("")
}

// ------------------------------------------------ 随机数（带种子，结果可复现）

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function smoothstep(x) {
  const k = Math.min(1, Math.max(0, x))
  return k * k * (3 - 2 * k)
}

function mean(list) {
  return list.reduce((s, v) => s + v, 0) / list.length
}

// ---------------------------------------------------------------- 仿真本体

export function createSimulator({ seed = 20261017, now = Date.now() } = {}) {
  const rng = mulberry32(seed)
  /** 区间 [a, b) 的均匀随机数 */
  const uni = (a, b) => a + (b - a) * rng()
  /** 闭区间 [a, b] 的随机整数 */
  const int = (a, b) => Math.floor(uni(a, b + 1))
  const pick = (s) => s[Math.floor(rng() * s.length)]

  /** 仿真时钟：已经处理到的时刻 */
  let simNow = now
  /** 全区统一发号的计数器（分诊台按签到顺序发号，所以单间诊室的号码不连续） */
  let counter = 0
  /** 最近叫号卡片的自增 id（给页面做 v-for 的 key） */
  let callId = 0
  /** 事件序号：同一时刻的事件按加入先后处理，保证结果确定 */
  let seq = 0

  /** 待处理事件，按 (at, seq) 升序 */
  const queue = []
  const listeners = new Set()
  /** 最近叫号（最新在前），每人一条；二次呼叫 / 入室 / 过号时原地更新 */
  const calls = []
  /** 最近若干次就诊时长（秒），算平均就诊时长 */
  const consultHist = Array(CONSULT_WINDOW).fill(CONSULT_SEED)
  /** 趋势图样本 [时刻, 待诊 + 复诊人数]，热启动前的部分是合成的 */
  const samples = []

  const rooms = ROOMS.map((r) => ({
    info: r,
    done: 0,
    state: "idle",
    /** 室内就诊的患者，或正在被叫的患者 */
    current: null,
    startAt: null,
    calledAt: null,
    callCount: 0,
    waiting: [],
    recheck: [],
    missed: [],
    /** 上次叫复诊以来叫了几位待诊（每叫 2 位待诊插叫 1 位复诊） */
    sinceRecheck: 0,
    /** 最近若干次待诊叫号的等候分钟数，开屏用种子值填满 */
    waitHist: Array(WAIT_WINDOW).fill(AVG_WAIT_SEED[r.no] ?? 20),
    /** 已经排了「叫下一位」事件（防止重复排） */
    callPending: false
  }))

  // ------------------------------------------------------------ 患者与事件

  /** 随机姓名，只保存脱敏后的结果 */
  function randomName() {
    const given = rng() < 0.7 ? pick(GIVEN) + pick(GIVEN) : pick(GIVEN)
    return maskName(pick(SURNAMES) + given)
  }

  function nextNo() {
    counter += 1
    return "A" + String(counter).padStart(3, "0")
  }

  /** 新患者（号码在热启动时统一补发，运行中签到时立即发号） */
  function makePatient(checkinAt, kind = "初诊") {
    return {
      no: "",
      name: randomName(),
      kind,
      checkinAt,
      returnAt: null,
      missedAt: null,
      /** 本次被叫时的表现：是否会来、叫号后几毫秒入室 */
      willShow: true,
      enterAfter: 0,
      /** 对应「最近叫号」里的那一条（入室 / 过号时更新状态） */
      entry: null
    }
  }

  /** 把事件按时间插入队列（二分查找插入位置） */
  function schedule(at, type, room, patient = null) {
    // 时间戳统一取整毫秒，页面拿到的都是整数
    const ev = { at: Math.round(at), seq: seq++, type, room, patient }
    let lo = 0
    let hi = queue.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const q = queue[mid]
      if (q.at < at || (q.at === at && q.seq < ev.seq)) lo = mid + 1
      else hi = mid
    }
    queue.splice(lo, 0, ev)
  }

  /** 通知页面。监听函数出错不能打断仿真，否则状态会停在半路 */
  function emit(type, at, room, p, extra) {
    const evt = {
      type,
      at,
      room: room.info.no,
      no: p.no,
      name: p.name,
      kind: p.kind,
      ...extra
    }
    for (const fn of listeners) {
      try {
        fn(evt)
      } catch (err) {
        console.error("[waiting sim] 事件监听出错", err)
      }
    }
  }

  /**
   * 签到间隔（秒）的反馈：队列太短就来得快一点，太长就来得慢一点，
   * 让每间诊室一直有人排队，又不会无限变长。
   *   待诊 < 3 人：间隔 × 0.5；待诊 > 11 人：间隔 × 3；
   *   3–11 人之间按指数平滑过渡（3 人 × 0.5 → 7 人 × 1 → 11 人 × 2）。
   * 中间这段不做成恒定 × 1 是因为：复诊回诊、过号重签都会额外占用叫号，
   * 按 200 秒一位签到时诊室负荷略大于 1，队列会一路涨到 11 人的上限并贴着走；
   * 平滑过渡给出一个「回复力」，让队列稳定在 7 人上下
   */
  function arrivalInterval(waitingLen) {
    if (waitingLen < 3) return ARRIVAL_BASE * 0.5
    if (waitingLen > 11) return ARRIVAL_BASE * 3
    return ARRIVAL_BASE * 0.5 * Math.pow(4, (waitingLen - 3) / 8)
  }

  /**
   * 签到用「稀疏化」生成非齐次泊松过程：先按最快速率排候选签到，
   * 候选到点时再按当时的队列长度以 最快间隔 / 当前间隔 的概率接受。
   * 这样速率随队列长度实时变化，不会因为排下一次时队列很长而一直等很久
   */
  function scheduleArrival(room, from) {
    const gap = -Math.log(1 - rng()) * ARRIVAL_FAST * SEC
    schedule(from + gap, "arrive", room)
  }

  /** 安排「叫下一位」 */
  function scheduleCall(room, at) {
    room.callPending = true
    schedule(at, "call", room)
  }

  /** 诊室空着、没排叫号，而队列里来了人 → 2 秒后叫号 */
  function wakeIfIdle(room, t) {
    if (room.state === "idle" && !room.callPending)
      scheduleCall(room, t + 2 * SEC)
  }

  /** 新的「最近叫号」条目，最新在前，超出上限的丢掉 */
  function addCall(room, p, at, n, state) {
    const entry = {
      id: ++callId,
      at,
      no: p.no,
      name: p.name,
      room: room.info.no,
      short: room.info.short,
      kind: p.kind,
      n,
      state
    }
    calls.unshift(entry)
    if (calls.length > CALLS_MAX) calls.length = CALLS_MAX
    p.entry = entry
    return entry
  }

  /** 预先抽好被叫患者的表现，并排好二次呼叫 / 入室 / 过号事件 */
  function planCallOutcome(room, p, calledAt) {
    p.willShow = rng() >= NO_SHOW_P
    p.enterAfter = uni(6, 40) * SEC
    if (!p.willShow || p.enterAfter > RECALL_AFTER) {
      schedule(calledAt + RECALL_AFTER, "call2", room, p)
    }
    if (p.willShow) schedule(calledAt + p.enterAfter, "enter", room, p)
    else schedule(calledAt + MISS_AFTER, "missed", room, p)
  }

  /** 就诊时长（毫秒）：初诊 90–240 秒，复诊 60–150 秒 */
  function consultDuration(kind) {
    return (kind === "复诊" ? uni(60, 150) : uni(90, 240)) * SEC
  }

  // ------------------------------------------------------------ 叫号规则

  /**
   * 选下一位：已连叫 2 位待诊且有复诊 → 复诊；否则待诊优先；
   * 没有待诊再叫复诊；都没有就空闲，等有人签到再叫
   */
  function takeNext(room) {
    if (room.recheck.length && room.sinceRecheck >= RECHECK_EVERY) {
      room.sinceRecheck = 0
      return { p: room.recheck.shift(), fromWaiting: false }
    }
    if (room.waiting.length) {
      room.sinceRecheck += 1
      return { p: room.waiting.shift(), fromWaiting: true }
    }
    if (room.recheck.length) {
      room.sinceRecheck = 0
      return { p: room.recheck.shift(), fromWaiting: false }
    }
    return null
  }

  function callNext(room, t) {
    room.callPending = false
    const next = takeNext(room)
    if (!next) {
      room.state = "idle"
      room.current = null
      return
    }
    const { p, fromWaiting } = next
    // 平均等候只统计待诊叫号：从签到到第一次被叫的分钟数
    if (fromWaiting) {
      room.waitHist.push((t - p.checkinAt) / MIN)
      if (room.waitHist.length > WAIT_WINDOW) room.waitHist.shift()
    }
    room.state = "calling"
    room.current = p
    room.startAt = null
    room.calledAt = t
    room.callCount = 1
    addCall(room, p, t, 1, "calling")
    planCallOutcome(room, p, t)
    emit("call", t, room, p, { n: 1 })
  }

  // ------------------------------------------------------------ 事件处理

  const handlers = {
    /** 候选签到：按当前队列长度决定是否真的来人，然后排下一个候选 */
    arrive(room, _p, t) {
      const accept = ARRIVAL_FAST / arrivalInterval(room.waiting.length)
      if (rng() < accept) {
        const p = makePatient(t)
        p.no = nextNo()
        room.waiting.push(p)
        emit("checkin", t, room, p)
        wakeIfIdle(room, t)
      }
      scheduleArrival(room, t)
    },

    /** 叫下一位 */
    call(room, _p, t) {
      callNext(room, t)
    },

    /** 25 秒还没进门 → 第二次呼叫 */
    call2(room, p, t) {
      if (room.current !== p || room.state !== "calling") return
      room.callCount = 2
      if (p.entry) p.entry.n = 2
      emit("call", t, room, p, { n: 2 })
    },

    /** 患者进门，开始就诊 */
    enter(room, p, t) {
      if (room.current !== p || room.state !== "calling") return
      room.state = "consulting"
      room.startAt = t
      room.calledAt = null
      room.callCount = 0
      if (p.entry) p.entry.state = "entered"
      emit("enter", t, room, p)
      schedule(t + consultDuration(p.kind), "end", room, p)
    },

    /** 就诊结束：已诊 +1；部分初诊患者去做检查，稍后复诊；医生歇几秒叫下一位 */
    end(room, p, t) {
      if (room.current !== p || room.state !== "consulting") return
      consultHist.push((t - room.startAt) / SEC)
      if (consultHist.length > CONSULT_WINDOW) consultHist.shift()
      room.done += 1
      emit("finish", t, room, p)
      if (p.kind === "初诊" && rng() < TEST_P) {
        schedule(t + uni(3, 8) * MIN, "back", room, p)
      }
      room.state = "idle"
      room.current = null
      room.startAt = null
      scheduleCall(room, t + uni(3, 8) * SEC)
    },

    /** 连呼 2 次仍未到 → 进过号名单，3 秒后叫下一位 */
    missed(room, p, t) {
      if (room.current !== p || room.state !== "calling") return
      p.missedAt = t
      room.missed.unshift(p)
      if (p.entry) p.entry.state = "missed"
      emit("missed", t, room, p)
      if (rng() < REREG_P) {
        schedule(t + uni(1.5, 5) * MIN, "rereg", room, p)
      } else {
        schedule(t + MISSED_KEEP, "expire", room, p)
      }
      room.state = "idle"
      room.current = null
      room.calledAt = null
      room.callCount = 0
      scheduleCall(room, t + NEXT_AFTER_MISS)
    },

    /** 过号患者重新签到：移出过号名单，插到待诊队列第 3 位 */
    rereg(room, p, t) {
      const i = room.missed.indexOf(p)
      if (i < 0) return
      room.missed.splice(i, 1)
      p.missedAt = null
      p.checkinAt = t
      room.waiting.splice(Math.min(REINSERT_AT, room.waiting.length), 0, p)
      emit("checkin", t, room, p, { reinsert: true })
      wakeIfIdle(room, t)
    },

    /** 过号 30 分钟仍未重新签到 → 从过号名单里拿掉 */
    expire(room, p) {
      const i = room.missed.indexOf(p)
      if (i >= 0) room.missed.splice(i, 1)
    },

    /** 做完检查回来 → 进复诊名单（保留原号码） */
    back(room, p, t) {
      p.kind = "复诊"
      p.returnAt = t
      room.recheck.push(p)
      emit("recheck", t, room, p)
      wakeIfIdle(room, t)
    },

    /** 趋势图采样：每 5 分钟整点记一次待诊 + 复诊总人数 */
    sample(_room, _p, t) {
      samples.push([t, queueCount()])
      while (samples.length && samples[0][0] < t - TREND_SPAN - TREND_STEP) {
        samples.shift()
      }
      schedule(t + TREND_STEP, "sample", null)
    }
  }

  function queueCount() {
    return rooms.reduce((s, r) => s + r.waiting.length + r.recheck.length, 0)
  }

  // ------------------------------------------------------------ 热启动

  /**
   * 造出「门诊进行中」的初始状态：各诊室已诊若干、有人在就诊、
   * 有人排队 / 等复诊 / 过号。号码按签到时刻统一补发，最后签到的是 A175
   */
  function warmStart() {
    simNow = Math.round(simNow)
    const t0 = simNow
    /** 所有需要号码的患者，最后按签到时刻排序发号 */
    const numbered = []
    /** 需要写进「最近叫号」的过号记录 */
    const missedCalls = []

    rooms.forEach((room) => {
      const no = room.info.no
      const seedWait = AVG_WAIT_SEED[no] ?? 20
      room.done = int(10, 17)
      room.sinceRecheck = int(0, RECHECK_EVERY)

      // 待诊：最早一位大约等了「平均等候」那么久，最新一位几分钟前刚签到
      const nWait = int(4, 11)
      const oldest = Math.min(40, Math.max(8, seedWait + uni(-5, 5))) * MIN
      const newest = uni(0.5, 5) * MIN
      const times = []
      for (let i = 0; i < nWait; i++) {
        times.push(Math.round(t0 - uni(newest, oldest)))
      }
      times.sort((a, b) => a - b)
      for (const at of times) {
        const p = makePatient(at)
        room.waiting.push(p)
        numbered.push(p)
      }

      // 复诊：2–20 分钟前回来的，原号码是更早签到时发的
      const nRe = int(0, 2)
      const returns = []
      for (let i = 0; i < nRe; i++) {
        returns.push(Math.round(t0 - uni(2, 20) * MIN))
      }
      returns.sort((a, b) => a - b)
      for (const at of returns) {
        const p = makePatient(Math.round(at - uni(30, 90) * MIN), "复诊")
        p.returnAt = at
        room.recheck.push(p)
        numbered.push(p)
      }

      // 过号：只保留还在名单里（未重新签到、未满 30 分钟）的
      if (rng() < 0.5) addWarmMissed(room, t0, numbered, missedCalls)

      // 当前患者：大多在就诊，217 是一个快要结束的超时病例，216 刚被叫号
      const kind =
        no === "216" || no === "217" || rng() >= 0.2 ? "初诊" : "复诊"
      const p = makePatient(0, kind)
      numbered.push(p)
      if (no === "216") {
        const calledAt = t0 - 8 * SEC
        p.checkinAt = calledAt - Math.round(seedWait * MIN)
        room.state = "calling"
        room.current = p
        room.calledAt = calledAt
        room.callCount = 1
        // 开屏 17 秒后第二次呼叫，再过一会儿入室
        p.willShow = true
        p.enterAfter = uni(30, 38) * SEC
        schedule(calledAt + RECALL_AFTER, "call2", room, p)
        schedule(calledAt + p.enterAfter, "enter", room, p)
        p.warmCall = { at: calledAt, state: "calling" }
      } else {
        const elapsed = no === "217" ? 16.5 * MIN : uni(0.5, 11) * MIN
        const total = no === "217" ? 17.5 * MIN : elapsed + uni(20, 180) * SEC
        room.state = "consulting"
        room.current = p
        room.startAt = Math.round(t0 - elapsed)
        const calledAt = Math.round(room.startAt - uni(15, 25) * SEC)
        p.checkinAt = Math.round(
          calledAt - Math.max(3, seedWait + uni(-6, 6)) * MIN
        )
        schedule(room.startAt + total, "end", room, p)
        p.warmCall = { at: calledAt, state: "entered" }
      }

      scheduleArrival(room, t0)
    })

    // 至少要有 1 条过号记录，开屏时过号名单和最近叫号里都有内容
    if (!missedCalls.length) {
      const room = pick(rooms)
      addWarmMissed(room, t0, numbered, missedCalls)
    }

    // 按签到先后统一补发号码
    numbered.sort((a, b) => a.checkinAt - b.checkinAt)
    counter = WARM_COUNTER - numbered.length
    for (const p of numbered) p.no = nextNo()

    // 最近叫号：各诊室当前患者 + 最近 1–2 条过号；从旧到新依次加入，最新在前
    missedCalls.sort((a, b) => b.at - a.at)
    const entries = rooms.map((room) => ({
      room,
      p: room.current,
      at: room.current.warmCall.at,
      n: 1,
      state: room.current.warmCall.state
    }))
    entries.push(...missedCalls.slice(0, int(1, 2)))
    entries.sort((a, b) => a.at - b.at)
    for (const e of entries) {
      addCall(e.room, e.p, e.at, e.n, e.state)
      delete e.p.warmCall
    }

    // 趋势图：合成过去 2 小时的曲线（先爬升、到峰值后缓降到当前值）
    const cur = queueCount()
    const last = Math.floor(t0 / TREND_STEP) * TREND_STEP
    const n = TREND_SPAN / TREND_STEP
    const startV = cur * uni(0.55, 0.7)
    const peakK = uni(0.5, 0.75)
    const peakV = cur * uni(1.08, 1.18)
    for (let k = 0; k <= n; k++) {
      const x = k / n
      let v =
        x <= peakK
          ? startV + (peakV - startV) * smoothstep(x / peakK)
          : peakV + (cur - peakV) * smoothstep((x - peakK) / (1 - peakK))
      // 最后一个点贴住当前值，之前的点加一点抖动
      if (k < n) v *= 1 + uni(-0.04, 0.04)
      samples.push([last - (n - k) * TREND_STEP, Math.round(v)])
    }
    schedule(last + TREND_STEP, "sample", null)
  }

  /** 热启动用：给诊室加一位 5–28 分钟前过号、尚未重新签到的患者 */
  function addWarmMissed(room, t0, numbered, missedCalls) {
    const missedAt = Math.round(t0 - uni(5, 28) * MIN)
    const p = makePatient(Math.round(missedAt - uni(10, 30) * MIN))
    p.missedAt = missedAt
    room.missed.push(p)
    numbered.push(p)
    schedule(missedAt + MISSED_KEEP, "expire", room, p)
    missedCalls.push({
      room,
      p,
      at: missedAt - MISS_AFTER,
      n: 2,
      state: "missed"
    })
  }

  // -------------------------------------------------------- 大空档：整体平移

  /**
   * 标签页挂起后再回来，空档可能有几十分钟甚至几小时。只细算最后 10 分钟：
   * 把待处理事件和状态里的所有时间戳一起往后平移（按 5 分钟的整数倍，
   * 趋势采样点仍落在整点上），相当于这段时间「暂停」了，状态始终自洽
   */
  function shiftAll(dt) {
    simNow += dt
    for (const ev of queue) ev.at += dt
    for (const s of samples) s[0] += dt
    for (const c of calls) c.at += dt

    // 同一位患者可能同时出现在名单和事件里，只平移一次
    const patients = new Set()
    for (const ev of queue) if (ev.patient) patients.add(ev.patient)
    for (const room of rooms) {
      if (room.current) patients.add(room.current)
      for (const list of [room.waiting, room.recheck, room.missed]) {
        for (const p of list) patients.add(p)
      }
      if (room.startAt !== null) room.startAt += dt
      if (room.calledAt !== null) room.calledAt += dt
    }
    for (const p of patients) {
      for (const key of ["checkinAt", "returnAt", "missedAt"]) {
        if (p[key] !== null) p[key] += dt
      }
    }
  }

  // ------------------------------------------------------------ 对外接口

  /** 把仿真推进到 now（毫秒时间戳），按时间顺序处理所有到期事件 */
  function tick(nowMs) {
    if (!(nowMs > simNow)) return
    const gap = nowMs - simNow
    if (gap > CATCH_UP_MAX) {
      shiftAll(Math.ceil((gap - CATCH_UP_MAX) / TREND_STEP) * TREND_STEP)
    }
    while (queue.length && queue[0].at <= nowMs) {
      const ev = queue.shift()
      simNow = ev.at
      handlers[ev.type](ev.room, ev.patient, ev.at)
    }
    simNow = nowMs
  }

  function snapshot() {
    const t = simNow
    const roomsOut = rooms.map((room) => {
      const c = room.current
      const calling = room.state === "calling"
      return {
        ...room.info,
        done: room.done,
        state: room.state,
        current: c ? { no: c.no, name: c.name, kind: c.kind } : null,
        startAt: room.state === "consulting" ? room.startAt : null,
        calledAt: calling ? room.calledAt : null,
        callCount: calling ? room.callCount : 0,
        waiting: room.waiting.map((p) => ({
          no: p.no,
          name: p.name,
          checkinAt: p.checkinAt
        })),
        recheck: room.recheck.map((p) => ({
          no: p.no,
          name: p.name,
          returnAt: p.returnAt
        })),
        missed: room.missed.map((p) => ({
          no: p.no,
          name: p.name,
          missedAt: p.missedAt
        })),
        avgWait: Math.round(mean(room.waitHist))
      }
    })

    const totals = { waiting: 0, recheck: 0, missed: 0, done: 0 }
    for (const r of roomsOut) {
      totals.waiting += r.waiting.length
      totals.recheck += r.recheck.length
      totals.missed += r.missed.length
      totals.done += r.done
    }

    // 过号名单 = 各诊室过号名单合并，最新在前
    const missedBoard = roomsOut
      .flatMap((r) =>
        r.missed.map((p) => ({
          no: p.no,
          name: p.name,
          room: r.no,
          at: p.missedAt
        }))
      )
      .sort((a, b) => b.at - a.at)
      .slice(0, MISSED_BOARD_MAX)

    // 趋势：过去 2 小时的样本 + 当前时刻一个点；预测未来 1 小时平缓回落
    const cur = totals.waiting + totals.recheck
    const actual = samples
      .filter(([at]) => at >= t - TREND_SPAN && at < t)
      .map(([at, v]) => [at, v])
    actual.push([t, cur])
    const forecast = []
    for (let i = 0; i <= FORECAST_SPAN / FORECAST_STEP; i++) {
      const k = (i * FORECAST_STEP) / FORECAST_SPAN
      forecast.push([
        t + i * FORECAST_STEP,
        Math.round(cur * (1 - 0.15 * smoothstep(k)))
      ])
    }

    return {
      now: t,
      session: sessionLabel(new Date(t)),
      rooms: roomsOut,
      totals,
      avgWaitAll: Math.round(mean(roomsOut.map((r) => r.avgWait))),
      avgConsult: Math.round(mean(consultHist)),
      calls: calls.map((c) => ({ ...c })),
      missedBoard,
      trend: { actual, forecast }
    }
  }

  function on(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  function off(fn) {
    listeners.delete(fn)
  }

  /**
   * 队列里下一个 type 类事件的时刻（毫秒；没有返回 null）。
   * 录屏用：快进到「叫下一位」前一刻再开录，开头第一帧就能拍到新叫号
   */
  function nextAt(type) {
    const ev = queue.find((q) => q.type === type)
    return ev ? ev.at : null
  }

  warmStart()

  return { tick, snapshot, on, off, nextAt }
}

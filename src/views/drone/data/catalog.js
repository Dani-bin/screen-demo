/*
 * 无人机巡检 · 业务字典
 * ----------------------------------------------------------
 * 事件类型、等级、处置状态、机场 / 无人机 / 计划状态的名称，以及仿真用的
 * 发生率、误报率和时限。依据见 docs/design/drone/02-research.md（"业务调研"
 * 一节）；没有公开口径的数值都是假设，取值理由写在旁边。
 */

// ---------------------------------------------------------------- 事件等级

/** 三级：重大红 / 较大橙 / 一般黄，颜色语义沿用园区风险预警的四色体系 */
export const LEVELS = {
  major: { label: "重大", rank: 3 },
  serious: { label: "较大", rank: 2 },
  general: { label: "一般", rank: 1 }
}

/**
 * 处置时限（秒）：确认 = 告警 → 值班员确认或判误报；办结 = 派单 → 已办结。
 * 没有官方时限表，按 02-research.md 的建议取值（假设）。
 */
export const LIMITS = {
  major: { confirm: 120, close: 2 * 3600 },
  serious: { confirm: 300, close: 8 * 3600 },
  general: { confirm: 900, close: 24 * 3600 }
}

// ---------------------------------------------------------------- 事件类型

/**
 * 事件类型。cam：抓拍 / 复核时用的相机（visible 可见光，ir 红外）；
 * reading：读数的名称与单位（没有读数的类型为 null）；
 * fa：误报概率（02-research.md 3.3 节，分类型数值为假设）；
 * need：识别所需载荷（ch4 = 激光甲烷遥测）。
 */
export const EVENT_TYPES = {
  fire: {
    label: "烟火",
    cam: "ir",
    reading: { name: "最高温度", unit: "℃" },
    fa: 0.05
  },
  gas: {
    label: "可燃气体泄漏",
    cam: "ir",
    reading: { name: "甲烷浓度", unit: "ppm·m" },
    fa: 0.15,
    need: "ch4"
  },
  temp: {
    label: "温度异常",
    cam: "ir",
    reading: { name: "温差", unit: "℃" },
    fa: 0.08
  },
  insulation: {
    label: "保温层破损",
    cam: "ir",
    reading: { name: "表面温度", unit: "℃" },
    fa: 0.1
  },
  leak: { label: "跑冒滴漏", cam: "visible", reading: null, fa: 0.12 },
  hotwork: { label: "未报备动火", cam: "visible", reading: null, fa: 0.15 },
  intrusion: { label: "人员闯入禁区", cam: "visible", reading: null, fa: 0.15 },
  perimeter: { label: "周界入侵", cam: "ir", reading: null, fa: 0.15 },
  helmet: { label: "未戴安全帽", cam: "visible", reading: null, fa: 0.2 },
  parking: {
    label: "危化品车违停",
    cam: "visible",
    reading: { name: "静止时长", unit: "min" },
    fa: 0.08
  },
  debris: { label: "管廊异物", cam: "visible", reading: null, fa: 0.1 }
}

/**
 * 每次在某类对象上悬停拍照时，各类事件被 AI 报出的概率（含误报）。
 * 全园一天约 280 次悬停，按这些概率一天约 15–30 条事件，和 02-research.md
 * 的量级一致（假设）。
 */
export const RATES = {
  tank: {
    temp: 0.0225,
    insulation: 0.015,
    leak: 0.015,
    gas: 0.0188,
    fire: 0.0015
  },
  sphere: { temp: 0.0263, gas: 0.0263, leak: 0.0075 },
  unit: {
    gas: 0.0225,
    temp: 0.0225,
    hotwork: 0.0188,
    helmet: 0.0263,
    insulation: 0.015,
    fire: 0.0023
  },
  piperack: { debris: 0.0263, leak: 0.0225, insulation: 0.0188 },
  loading: { parking: 0.0375, helmet: 0.0263, leak: 0.0188 },
  jetty: { leak: 0.0225, intrusion: 0.0188 },
  utility: { temp: 0.0263, intrusion: 0.009, fire: 0.0015 },
  warehouse: { temp: 0.015, intrusion: 0.015, leak: 0.0112 },
  parking: { parking: 0.0675 },
  gate: { parking: 0.0225, intrusion: 0.015 },
  perimeter: { perimeter: 0.0375 }
}

/** 夜间（19:00–06:00）周界入侵的概率倍数：夜里翻越围网的更多（假设） */
export const NIGHT_PERIMETER_FACTOR = 2

// ---------------------------------------------------------------- 处置状态

/**
 * 处置闭环：待确认 → 已派单 → 处置中 → 待复核 → 已办结；待确认也可直接判误报；
 * 复核不通过退回处置中。超时不是单独的状态，而是"督办"标记。
 */
export const EVENT_STATUS = {
  pending: "待确认",
  dispatched: "已派单",
  handling: "处置中",
  reviewing: "待复核",
  closed: "已办结",
  false: "误报"
}

// ---------------------------------------------------------------- 设备状态

/** 机场状态（"不可起飞"是叠加在空闲上的标记，不是独立状态） */
export const DOCK_STATE = {
  idle: "空闲",
  prep: "作业准备",
  working: "作业中",
  landing: "返航降落",
  cooling: "散热",
  charging: "充电中",
  maintenance: "维护",
  fault: "故障"
}

/** 无人机状态 */
export const DRONE_STATE = {
  docked: "舱内待命",
  takeoff: "起飞",
  transit: "转场",
  inspect: "巡检",
  hover: "悬停拍照",
  monitor: "悬停监视",
  divert: "前往复核",
  return: "返航",
  landing: "降落"
}

/** 航线计划的每趟状态 */
export const PLAN_STATUS = {
  pending: "待执行",
  running: "执行中",
  done: "已完成",
  partial: "部分完成",
  postponed: "顺延",
  missed: "漏巡"
}

/** 雨量等级（机场雨量计按等级上报，不是 mm/h） */
export const RAIN_LEVEL = ["无雨", "小雨", "中雨", "大雨"]

/** 合规信息（全部虚构）：化工园区属于管制空域，常态飞行按长期飞行活动报批 */
export const COMPLIANCE = {
  airspace: "管制空域 · 长期飞行活动已批准",
  approval: "临空批〔2026〕037 号",
  validTo: "2026-12-31",
  // 每日计划在前一日 12:00 前报备（条例第 26 条），这里固定为前一日 11:20
  reportedAt: "11:20"
}

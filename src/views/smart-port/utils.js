/*
 * 智慧港口 页面公用：格式化、图标、中文名（定稿 docs/design/smart-port/design/src/v1.js 同一套）
 */

const H = 3600000

/** 千分位数字 */
export const fmt = (n, d = 0) =>
  Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  })
/** 时间戳 → 北京时间 HH:MM */
export const hm = (ms) => new Date(ms + 8 * H).toISOString().slice(11, 16)
export const pct = (x) => `${Math.round((x || 0) * 100)}%`

const DIRS = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"]
export const dirName = (deg) =>
  DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]

export const EV_STATUS = {
  pending: "待处置",
  handling: "处置中",
  resolved: "已恢复"
}
export const LEVEL_CN = { major: "重要", minor: "一般" }
export const KIND_CN = {
  qcFault: "岸桥故障",
  rmgFault: "轨道吊故障",
  agvFault: "AGV 故障",
  agvSignal: "定位中断",
  reefer: "冷箱温度",
  wind: "阵风",
  dg: "危险品",
  sensor: "传感器",
  delay: "船舶延误"
}
export const STAGE_CN = {
  anchor: "锚地待泊",
  berthing: "靠泊中",
  moored: "系泊",
  working: "作业中",
  finishing: "完工绑扎",
  departing: "离泊",
  planned: "计划"
}
export const STATE_CN = {
  work: "作业",
  idle: "待机",
  fault: "故障",
  maint: "检修"
}
export const AGV_CN = {
  laden: "重载",
  empty: "空驶",
  queue: "排队",
  idle: "空闲",
  swap: "换电",
  fault: "故障"
}

/** 细线 SVG 图标（不用 emoji） */
export const ICON = {
  ship: '<svg viewBox="0 0 24 24"><path d="M3 15h18l-2.5 4h-13zM6 15V9h12v6M9 9V5h4v4" /></svg>',
  crane:
    '<svg viewBox="0 0 24 24"><path d="M5 21V8M10 21V8M3 8h19M5 8l5-5 9 5M18 8v5M16 13h4" /></svg>',
  agv: '<svg viewBox="0 0 24 24"><rect x="3" y="10" width="18" height="6" /><path d="M7 16v2M17 16v2M6 10V7h12v3" /></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M13 3L5 13h6l-1 8 8-10h-6z" /></svg>',
  alert:
    '<svg viewBox="0 0 24 24"><path d="M12 3l10 18H2zM12 10v5M12 18v.5" /></svg>',
  wind: '<svg viewBox="0 0 24 24"><path d="M3 9h12a3 3 0 1 0-3-3M3 15h16a3 3 0 1 1-3 3" /></svg>',
  tide: '<svg viewBox="0 0 24 24"><path d="M2 14c3 0 3-2 6-2s3 2 6 2 3-2 6-2M2 19c3 0 3-2 6-2s3 2 6 2 3-2 6-2M12 3v6" /></svg>',
  search:
    '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l6 6" /></svg>',
  layers:
    '<svg viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" /></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="2.5" /></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z" /></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" /></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></svg>',
  logo: '<svg viewBox="0 0 40 40"><path d="M6 28h28l-4 6H10zM10 28V16h20v12M16 16V8h8v8" /></svg>'
}

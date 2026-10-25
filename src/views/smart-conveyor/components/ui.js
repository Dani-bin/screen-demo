/*
 * 面板共用：数字格式、时间格式、等级 / 四维 / 状态的颜色变量、细线图标
 * ----------------------------------------------------------
 * 颜色只给 CSS 变量名（定义在 styles/board.scss 的设计令牌里），组件用 style="--c: var(...)" 引用。
 */
import { ST, ST_NAME } from "../sim/simulator.js"

const HOUR = 3600000

/** 千分位数字 */
export const fmt = (n, d = 0) =>
  Number(n).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  })
/** 北京时间 时:分 */
export const hm = (ms) => new Date(ms + 8 * HOUR).toISOString().slice(11, 16)
/** 北京时间 时:分:秒 */
export const hms = (ms) => new Date(ms + 8 * HOUR).toISOString().slice(11, 19)
/** 北京时间 月/日 */
export const md = (ms) =>
  new Date(ms + 8 * HOUR).toISOString().slice(5, 10).replace("-", "/")
export const pct = (x, d = 0) => `${fmt(x * 100, d)}%`

/** 设计稿 px → rem（行内样式不经过 postcss-pxtorem，要自己换算；1920 px = 10 rem） */
export const rem = (px) => `${(px / 192).toFixed(5)}rem`

export const LV = ["一级", "二级", "三级", "四级"]
export const LV_VAR = ["--l1", "--l2", "--l3", "--l4"]
export const DIM = {
  person: ["人", "--dim-person"],
  machine: ["机", "--dim-machine"],
  material: ["料", "--dim-material"],
  env: ["环", "--dim-env"]
}
export const ST_VAR = {
  [ST.RUN]: "--ok",
  [ST.STANDBY]: "--data",
  [ST.STOP]: "--off",
  [ST.WARN]: "--l3",
  [ST.START]: "--l3",
  [ST.LOCK]: "--l2",
  [ST.FAULT]: "--l1",
  [ST.MAINT]: "--l4"
}
export { ST, ST_NAME }
/** 六感（感知方式）→ 图标 */
export const SENSE_ICON = {
  温度: "temp",
  振动: "wave",
  速度: "gauge",
  图像: "image",
  视频: "cam",
  位置: "pin"
}

/* 细线图标（SVG 字符串，和定稿一致；描边色跟随 currentColor） */
export const ICON = {
  logo: '<svg viewBox="0 0 32 32"><path d="M3 22h26M6 22l5-8h10l5 8M9 14V9h14v5" /><circle cx="9" cy="25" r="2" /><circle cx="23" cy="25" r="2" /><path d="M13 9V5h6v4" /></svg>',
  temp: '<svg viewBox="0 0 24 24"><path d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0z" /><path d="M12 10v6" /></svg>',
  wave: '<svg viewBox="0 0 24 24"><path d="M2 12h3l2-6 3 12 3-9 2 5 2-2h5" /></svg>',
  gauge:
    '<svg viewBox="0 0 24 24"><path d="M4 17a8 8 0 1 1 16 0" /><path d="M12 17l4-6" /></svg>',
  image:
    '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" /><path d="M3 16l5-5 4 4 3-3 6 5" /></svg>',
  cam: '<svg viewBox="0 0 24 24"><rect x="2" y="7" width="14" height="10" /><path d="M16 11l6-3v8l-6-3" /></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.5-7-12a7 7 0 1 1 14 0c0 5.5-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></svg>',
  robot:
    '<svg viewBox="0 0 24 24"><path d="M3 4h18M8 4v3M16 4v3" /><rect x="5" y="7" width="14" height="9" /><circle cx="10" cy="11.5" r="1.5" /><circle cx="14" cy="11.5" r="1.5" /><path d="M9 19h6" /></svg>',
  dog: '<svg viewBox="0 0 24 24"><path d="M4 11h12l3-3h2v4l-3 2v5M7 11v8M12 11v8M16 14v5" /></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M13 3L5 13h6l-1 8 8-10h-6z" /></svg>',
  leaf: '<svg viewBox="0 0 24 24"><path d="M5 19c0-9 6-14 15-14 0 9-5 15-14 15M5 19l7-7" /></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z" /></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" /></svg>',
  layers:
    '<svg viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" /></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10" /></svg>',
  live: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M6 6a8.5 8.5 0 0 0 0 12M18 6a8.5 8.5 0 0 1 0 12" /></svg>',
  wrench:
    '<svg viewBox="0 0 24 24"><path d="M14 6a4 4 0 0 0 5 5l-9 9-4-4 9-9a4 4 0 0 0-1-1z" /></svg>',
  ear: '<svg viewBox="0 0 24 24"><path d="M7 9a5 5 0 1 1 10 0c0 3-3 4-3 7a3 3 0 0 1-6 0" /><path d="M10 9a2 2 0 1 1 4 0" /></svg>',
  xray: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" /><path d="M6 6v12M9 6v12M12 6v12M15 6v12M18 6v12" /></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>'
}

/** 八大保护：[代码, 名称, 设备类型]（代码和仿真器 / 设备编号一致：BC03-PX01、BC03-TS…） */
export const PROTS = [
  ["PX", "跑偏", "protDeviation"],
  ["ES", "急停", "protEstop"],
  ["SM", "烟雾", "protSmoke"],
  ["TS", "超温", "protTemp"],
  ["TN", "张力", "protTension"],
  ["SL", "打滑", "protSlip"],
  ["DM", "堆煤", "protPile"],
  ["TR", "撕裂", "protTear"]
]

/** 皮带短名 */
export const beltShort = (layout, id) =>
  layout.belts.find((b) => b.id === id)?.short || id

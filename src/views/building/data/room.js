/*
 * 数字楼宇 房间级（会议室）面板与资产数据
 * ----------------------------------------------------------
 * 三维模型 public/building/room.glb（scripts/blender/tower/room.py）：设备对象名 = "dev_" + 资产模板编号（3205 为模板房号），
 * 换到别的楼层 / 塔楼时编号里的房号按实际房间替换（如 3505 大会议室的空调是 AC-3505-01）。
 * 资产型号、日期、责任人、读数、预约与运维记录全部是演示数据（按「塔楼 + 房间」固定种子生成，同一房间每次打开一致）；
 * 品牌一律写「演示品牌」，不对应真实厂商。
 */
import { floorDetail } from "./floor"

function seeded(seed) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

/** 资产分类（视图切换：全部资产 / 暖通 / 安防 / 消防 / 照明） */
export const ASSET_CATS = [
  { key: "all", name: "全部资产" },
  { key: "hvac", name: "暖通" },
  { key: "security", name: "安防" },
  { key: "fire", name: "消防" },
  { key: "light", name: "照明" }
]

/**
 * 资产模板（3205 大会议室）：model 为三维对象名后缀，icon 为图标（RoomScene 的 ICONS），
 * metrics 为资产卡片下方三格读数，curve 为实时曲线（名称、单位、基准值、波动、取值范围）
 */
const TEMPLATE = [
  {
    model: "AC-3205-01",
    name: "空调内机",
    short: "空调内机 AC-01",
    cat: "hvac",
    icon: "snow",
    type: "暖通空调 / 四面出风嵌入机",
    brand: "演示品牌 FXZP-71",
    place: "吊顶",
    power: "2.2 kW（制冷 7.1 kW）",
    status: "运行",
    reading: (r) => `${r.ret}°C`,
    metrics: (r) => [
      { name: "设定温度", value: r.set, unit: "°C" },
      { name: "回风温度", value: r.ret, unit: "°C" },
      { name: "运行时长", value: r.hours.toLocaleString("en-US"), unit: "h" }
    ],
    curve: { name: "回风温度", unit: "°C", base: 24.6, amp: 1.2 }
  },
  {
    model: "AC-3205-02",
    name: "空调内机",
    short: "空调内机 AC-02",
    cat: "hvac",
    icon: "snow",
    type: "暖通空调 / 四面出风嵌入机",
    brand: "演示品牌 FXZP-71",
    place: "吊顶",
    power: "2.2 kW（制冷 7.1 kW）",
    status: "运行",
    reading: (r) => `${r.ret2}°C`,
    metrics: (r) => [
      { name: "设定温度", value: r.set, unit: "°C" },
      { name: "回风温度", value: r.ret2, unit: "°C" },
      {
        name: "运行时长",
        value: (r.hours - 312).toLocaleString("en-US"),
        unit: "h"
      }
    ],
    curve: { name: "回风温度", unit: "°C", base: 24.9, amp: 1.1 }
  },
  {
    model: "CAM-3205-01",
    name: "半球摄像机",
    short: "半球摄像机",
    cat: "security",
    icon: "camera",
    type: "安防 / 400 万像素半球",
    brand: "演示品牌 DS-2CD",
    place: "吊顶东北角",
    power: "PoE 6 W",
    status: "在线",
    reading: () => "录像中",
    metrics: () => [
      { name: "码率", value: 4.0, unit: "Mbps" },
      { name: "存储天数", value: 30, unit: "天" },
      { name: "在线率", value: 99.8, unit: "%" }
    ],
    curve: { name: "码率", unit: "Mbps", base: 4.0, amp: 0.6 }
  },
  {
    model: "SD-3205-01",
    name: "感烟探测器",
    short: "感烟探测器",
    cat: "fire",
    icon: "flame",
    type: "消防 / 无线光电感烟",
    brand: "演示品牌 JTY-GD",
    place: "吊顶",
    power: "锂电池 3 V",
    status: "电量低",
    warn: true,
    reading: () => "电量低",
    metrics: () => [
      { name: "电池电量", value: 12, unit: "%" },
      { name: "烟雾浓度", value: 0.02, unit: "dB/m" },
      { name: "信号强度", value: -71, unit: "dBm" }
    ],
    curve: { name: "电池电量", unit: "%", base: 14, amp: 0.5, trend: -0.15 }
  },
  {
    model: "SP-3205-01",
    name: "喷淋头",
    short: "喷淋头",
    cat: "fire",
    icon: "drop",
    code: "SP-{R}-01~04",
    type: "消防 / 68°C 下垂型玻璃泡喷头 × 4",
    brand: "演示品牌 ZSTX-15",
    place: "吊顶",
    power: "—",
    status: "正常",
    hideLabel: true,
    reading: () => "0.32 MPa",
    metrics: () => [
      { name: "数量", value: 4, unit: "个" },
      { name: "末端压力", value: 0.32, unit: "MPa" },
      { name: "动作温度", value: 68, unit: "°C" }
    ],
    curve: { name: "管网压力", unit: "MPa", base: 0.32, amp: 0.01 }
  },
  {
    model: "TH-3205-01",
    name: "温湿度传感器",
    short: "温湿度",
    cat: "hvac",
    icon: "thermo",
    type: "暖通 / 墙装温湿度变送器",
    brand: "演示品牌 TH-20",
    place: "后墙",
    power: "DC 24 V",
    status: "在线",
    reading: (r) => `${r.temp}°C ${r.hum}%`,
    metrics: (r) => [
      { name: "温度", value: r.temp, unit: "°C" },
      { name: "湿度", value: r.hum, unit: "%RH" },
      { name: "上报间隔", value: 30, unit: "s" }
    ],
    curve: { name: "室内温度", unit: "°C", base: 24.4, amp: 0.9 }
  },
  {
    model: "ACR-3205",
    name: "门禁读卡器",
    short: "门禁读卡器",
    cat: "security",
    icon: "card",
    code: "AC-R-{R}",
    type: "安防 / IC 卡 + 人脸",
    brand: "演示品牌 K1T",
    place: "门侧墙面",
    power: "DC 12 V",
    status: "在线",
    reading: () => "今日刷卡 46 次",
    metrics: () => [
      { name: "今日通行", value: 46, unit: "次" },
      { name: "门磁状态", value: "关", unit: "" },
      { name: "离线次数", value: 0, unit: "次" }
    ],
    curve: { name: "通行次数", unit: "次/h", base: 3, amp: 2.5, work: true }
  },
  {
    model: "DS-3205-01",
    name: "会议大屏",
    short: "会议大屏",
    cat: "other",
    icon: "screen",
    type: "会议 / 86 寸交互平板",
    brand: "演示品牌 MAXHUB",
    place: "后墙",
    power: "350 W",
    status: "使用中",
    busy: true,
    reading: () => "使用中",
    metrics: () => [
      { name: "功率", value: 286, unit: "W" },
      { name: "今日使用", value: 3.6, unit: "h" },
      { name: "投屏", value: 2, unit: "路" }
    ],
    curve: { name: "功率", unit: "W", base: 180, amp: 120, work: true }
  },
  {
    model: "AP-3205-01",
    name: "无线 AP",
    short: "无线 AP",
    cat: "other",
    icon: "wifi",
    type: "网络 / Wi-Fi 6 吸顶 AP",
    brand: "演示品牌 AX3600",
    place: "吊顶",
    power: "PoE 18 W",
    status: "在线",
    reading: () => "接入 14 台",
    metrics: () => [
      { name: "接入终端", value: 14, unit: "台" },
      { name: "信道利用率", value: 36, unit: "%" },
      { name: "下行速率", value: 412, unit: "Mbps" }
    ],
    curve: { name: "接入终端", unit: "台", base: 8, amp: 6, work: true }
  },
  ...[1, 2, 3, 4].map((i) => ({
    model: `LT-3205-0${i}`,
    name: "照明灯盘",
    short: `灯盘 LT-0${i}`,
    cat: "light",
    icon: "bulb",
    type: "照明 / 600 × 600 LED 平板灯",
    brand: "演示品牌 LP-36",
    place: "吊顶",
    power: "36 W",
    status: "开启",
    reading: () => "亮度 80%",
    metrics: () => [
      { name: "亮度", value: 80, unit: "%" },
      { name: "色温", value: 4000, unit: "K" },
      { name: "功率", value: 29, unit: "W" }
    ],
    curve: { name: "功率", unit: "W", base: 24, amp: 8, work: true },
    hideLabel: true
  })),
  {
    model: "LC-3205-01",
    name: "灯光控制面板",
    short: "灯控面板",
    cat: "light",
    icon: "switch",
    type: "照明 / 场景控制面板",
    brand: "演示品牌 KNX-6",
    place: "后墙",
    power: "总线供电",
    status: "在线",
    reading: () => "会议模式",
    metrics: () => [
      { name: "当前场景", value: "会议", unit: "" },
      { name: "回路", value: 4, unit: "路" },
      { name: "今日切换", value: 7, unit: "次" }
    ],
    curve: { name: "照明功率", unit: "W", base: 90, amp: 30, work: true },
    hideLabel: true
  },
  {
    model: "PS-3205-01",
    name: "智能插座",
    short: "智能插座",
    cat: "other",
    icon: "plug",
    type: "电气 / 计量插座面板",
    brand: "演示品牌 ZS-16",
    place: "后墙",
    power: "最大 3.5 kW",
    status: "在线",
    hideLabel: true,
    reading: () => "86 W",
    metrics: () => [
      { name: "当前功率", value: 86, unit: "W" },
      { name: "今日用电", value: 0.62, unit: "kWh" },
      { name: "漏电流", value: 0, unit: "mA" }
    ],
    curve: { name: "功率", unit: "W", base: 60, amp: 40, work: true }
  }
]

const OWNERS = ["张工", "李工", "王工", "刘工", "陈工"]

/**
 * 某座塔某层大会议室的完整数据
 * @param {string} towerKey tower_S | tower_N
 * @param {string} floorKey 如 "32F"
 */
export function roomDetail(towerKey, floorKey) {
  const fd = floorDetail(towerKey, floorKey)
  const room = fd.rooms.find((r) => r.type === "conference")
  const rid = room.id
  const tag = towerKey === "tower_N" ? "N" : "S"
  const fl = fd.floor.index
  const rnd = seeded(fl * 131 + (tag === "N" ? 7001 : 17))
  const people = room.level === "busy" ? room.people : 0
  const r = {
    set: 24.0,
    ret: +(24.4 + rnd() * 0.6).toFixed(1),
    ret2: +(24.6 + rnd() * 0.6).toFixed(1),
    temp: room.temp,
    hum: Math.round(44 + rnd() * 8),
    hours: Math.round(1100 + rnd() * 400)
  }
  const hour = new Date().getHours()

  const assets = TEMPLATE.map((t, i) => {
    const code = (t.code || t.model).replace("{R}", rid).replace("3205", rid)
    const start = `20${22 + Math.floor(rnd() * 2)}-${String(1 + Math.floor(rnd() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rnd() * 27)).padStart(2, "0")}`
    // 实时曲线：24 点，工作时段型（work）按 9～18 点抬高，趋势型（trend）逐时下降
    const c = t.curve
    const curve = Array.from({ length: 24 }, (_, h) => {
      const w = c.work ? (h >= 9 && h < 18 ? 1 : 0.15) : 1
      const wave = Math.sin((h / 24) * Math.PI * 2 - 1.2) * 0.5
      const v =
        c.base * (c.work ? w : 1) +
        c.amp * (c.work ? w * rnd() : wave + (rnd() - 0.5) * 0.4) +
        (c.trend || 0) * h
      return +Math.max(0, v).toFixed(2)
    })
    return {
      id: code,
      model: t.model,
      name: t.name,
      short: t.short,
      cat: t.cat,
      icon: t.icon,
      status: t.status,
      level: t.warn ? "warn" : t.busy ? "busy" : "ok",
      reading: t.reading(r),
      hideLabel: !!t.hideLabel,
      fields: [
        { k: "资产类别", v: t.type },
        { k: "品牌型号", v: t.brand },
        {
          k: "安装位置",
          v: `${tag === "N" ? "北塔" : "南塔"} ${floorKey} · ${rid} ${t.place}`
        },
        { k: "额定功率", v: t.power },
        { k: "启用日期", v: start },
        {
          k: "维保到期",
          v: start.replace(/^20(\d\d)/, (m, y) => `20${+y + 4}`)
        },
        {
          k: "资产编号",
          v: `GX-JRC-${tag}-${String(fl).padStart(2, "0")}-${String(510 + i * 7).padStart(4, "0")}`
        },
        { k: "责任人", v: `物业工程部 · ${OWNERS[i % OWNERS.length]}` }
      ],
      metrics: t.metrics(r),
      curve,
      curveName: `${c.name} ${c.unit}`,
      records: [
        {
          date: "2026-09-12",
          text:
            t.cat === "hvac"
              ? "季度保养：清洗滤网、检查冷凝水排水"
              : "季度巡检：外观、功能测试",
          state: "完成"
        },
        {
          date: "2026-06-03",
          text:
            t.cat === "hvac"
              ? "更换出风口导风板电机"
              : t.cat === "fire"
                ? "年度消防联动测试"
                : "固件升级",
          state: "完成"
        },
        {
          date: t.warn ? "2026-10-10" : "2026-10-20",
          text: t.warn ? "更换电池（工单已派发）" : "下次保养计划",
          state: "待办"
        }
      ]
    }
  })

  // 今日预约（08:00～19:00）：设计稿的三场会议，按楼层种子微调时间
  const shift = Math.floor(rnd() * 3) * 0.5
  const bookings = [
    { title: "晨会", from: 9 + shift, to: 10 + shift },
    { title: "季度复盘", from: 13.5, to: 15 },
    { title: "客户路演", from: 15.5, to: 16.5 + shift }
  ]

  return {
    tower: towerKey,
    floor: fd.floor,
    room,
    hour,
    info: { area: 86, capacity: 12, people },
    bookings,
    env: {
      temp: room.temp,
      humidity: r.hum,
      co2: Math.round(520 + people * 22 + rnd() * 40),
      pm25: Math.round(6 + rnd() * 5),
      lux: Math.round(480 + rnd() * 80),
      noise: Math.round(36 + people * 0.6 + rnd() * 4)
    },
    assets
  }
}

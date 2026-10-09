/*
 * 数字楼宇 楼层级（标准办公层）面板与三维数据
 * ----------------------------------------------------------
 * 平面几何（房间多边形、工位、设备点位）来自 ./floorPlan.js（scripts/blender/tower/plan.py 生成，与 floor_S|N.glb 对齐）；
 * 房间状态、环境监测、设备数量、告警、工位占用全部是演示数据，按「塔楼 + 楼层」固定种子生成（同一层每次打开一致）。
 * 只有办公层有精细楼层模型；设备层、会所、大堂、地下层在楼层条里置灰。
 */
import { FLOOR_PLANS } from "./floorPlan"
import { towerFloors } from "./building"

function seeded(seed) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

/** 房间类型 → 列表里的类型名、三维着色（房间视图） */
export const ROOM_TYPES = {
  office: { name: "办公", color: "#2f7dff" },
  conference: { name: "会议", color: "#ffc65a" },
  meeting: { name: "会议", color: "#a66bff" },
  manager: { name: "办公", color: "#5fb4ff" },
  pantry: { name: "配套", color: "#3ddc97" },
  machine: { name: "机房", color: "#ff9f43" },
  lobby: { name: "核心筒", color: "#8aa0bd" },
  stair: { name: "核心筒", color: "#8aa0bd" },
  wc: { name: "配套", color: "#6fc3d6" },
  power: { name: "机房", color: "#ff9f43" },
  service: { name: "配套", color: "#8aa0bd" }
}

/** 设备点位类型（三维设备视图图标与图例） */
export const DEVICE_TYPES = {
  ac: { name: "空调内机", color: "#3a8cff", glyph: "❄" },
  camera: { name: "摄像头", color: "#2de2e6", glyph: "◉" },
  smoke: { name: "烟感", color: "#e8eef8", glyph: "◎" },
  access: { name: "门禁", color: "#3ddc97", glyph: "⊡" },
  ap: { name: "无线 AP", color: "#b27bff", glyph: "≋" }
}

/** 是否有精细楼层模型（只有办公层） */
export function hasFloorModel(floor) {
  return !!floor && floor.kind === "office"
}

/**
 * 某座塔某一层的完整数据
 * @param {string} towerKey tower_S | tower_N
 * @param {string} floorKey 如 "32F"
 */
export function floorDetail(towerKey, floorKey) {
  const plan = FLOOR_PLANS[towerKey] || FLOOR_PLANS.tower_S
  const floors = towerFloors(towerKey)
  const floor = floors.find((f) => f.key === floorKey) || floors[0]
  const n = floor.index
  const rnd = seeded(n * 97 + (towerKey === "tower_N" ? 5003 : 11))
  const pre = String(n).padStart(2, "0")
  const occ = (floor.occupancy ?? 70) / 100
  // 设计稿 32F 弱电机房告警；其它楼层按种子约 1/4 概率有机房告警
  const machineAlarm = n === 32 || rnd() < 0.25

  // ---- 工位：按入驻率决定在岗 / 预约 / 空闲
  const desks = plan.desks.map((d) => {
    const r = rnd()
    const status = r < occ * 0.9 ? "busy" : r < occ ? "booked" : "free"
    return { id: d.id, room: d.room, p: d.p, status }
  })

  // ---- 房间
  const rooms = plan.rooms.map((r) => {
    const id = pre + r.id.slice(2)
    const t = ROOM_TYPES[r.type]
    const room = {
      id,
      planId: r.id,
      name: r.name,
      type: r.type,
      typeName: t.name,
      color: t.color,
      area: r.area,
      poly: r.poly,
      center: r.center,
      temp: +(23.4 + rnd() * 1.8).toFixed(1),
      people: 0,
      status: "—",
      level: "idle" // ok 正常 / busy 使用中 / idle 空闲 / alarm 告警 / none 无状态
    }
    if (r.type === "office") {
      const ds = desks.filter((d) => d.room === r.id)
      const used = ds.filter((d) => d.status === "busy").length
      room.people = used
      room.status = `${used}/${ds.length}`
      room.level = "ok"
      room.desks = ds.length
    } else if (r.type === "conference" || r.type === "meeting") {
      const busy =
        r.type === "conference" ? n === 32 || rnd() < 0.6 : rnd() < 0.4
      room.people = busy
        ? Math.round(4 + rnd() * (r.type === "conference" ? 10 : 4))
        : 0
      room.status = busy ? "使用中" : "空闲"
      room.level = busy ? "busy" : "idle"
    } else if (r.type === "manager") {
      room.people = rnd() < 0.7 ? 1 : 0
      room.status = `${room.people}/1`
      room.level = "ok"
    } else if (r.type === "machine") {
      room.temp = machineAlarm ? 27.9 : +(22 + rnd() * 1.5).toFixed(1)
      room.status = machineAlarm ? "告警" : "正常"
      room.level = machineAlarm ? "alarm" : "ok"
    } else if (r.type === "pantry") {
      room.people = Math.round(rnd() * 5)
      room.status = "—"
      room.level = "none"
    } else {
      room.level = "none"
    }
    return room
  })
  const byPlan = Object.fromEntries(rooms.map((r) => [r.planId, r]))

  // ---- 设备点位：机房告警时，机房里的一个烟感 / 温感标红
  const devices = plan.devices.map((d, i) => ({
    ...d,
    id: `${d.type}-${i}`,
    alarm: false
  }))
  if (machineAlarm) {
    const dv = devices.find(
      (d) => byPlan[d.room]?.type === "machine" && d.type === "smoke"
    )
    if (dv) dv.alarm = true
  }
  // 门禁离线（一般告警）：洽谈室
  const offline = devices.find(
    (d) => d.type === "access" && byPlan[d.room]?.type === "meeting"
  )
  if (offline) offline.offline = true

  const deskTotal = desks.length
  const busy = desks.filter((d) => d.status === "busy").length
  const staff = rooms.reduce((s, r) => s + r.people, 0)
  const area = Math.round(plan.rooms.reduce((s, r) => s + r.area, 0) / 10) * 10
  const avgTemp =
    rooms.filter((r) => r.type === "office").reduce((s, r) => s + r.temp, 0) /
    Math.max(1, rooms.filter((r) => r.type === "office").length)
  const cnt = (t) => plan.devices.filter((d) => d.type === t).length

  // ---- 告警
  const machine = rooms.find((r) => r.type === "machine")
  const meeting = rooms.find((r) => r.type === "meeting")
  const officeB = rooms.find((r) => r.planId === "3202")
  const alarms = []
  if (machineAlarm)
    alarms.push({
      level: 1,
      title: "机柜 R03 进风温度 31.2°C",
      place: `${machine.id} ${machine.name}`,
      time: "16:18",
      room: machine.id
    })
  alarms.push({
    level: 3,
    title: "门禁读卡器离线",
    place: `${meeting.id} ${meeting.name}`,
    time: "15:02",
    room: meeting.id
  })
  alarms.push({
    level: 3,
    title: "照明回路 L-07 电流偏高",
    place: `${officeB.id} ${officeB.name}`,
    time: "14:41",
    room: officeB.id
  })

  // ---- 24 小时工位占用曲线（工作日：9 点上升、12 点午休略降、18 点后回落）
  const deskCurve = Array.from({ length: 24 }, (_, h) => {
    const work =
      h < 8
        ? 0.02
        : h < 9
          ? 0.35
          : h < 12
            ? 0.88
            : h < 14
              ? 0.72
              : h < 18
                ? 0.92
                : h < 20
                  ? 0.4
                  : 0.06
    return Math.round(busy * work * (0.94 + rnd() * 0.1))
  })

  return {
    tower: towerKey,
    floor,
    plan,
    rooms,
    desks,
    devices,
    alarms,
    deskCurve,
    machineRack: machineAlarm ? "R03" : null,
    stats: {
      area,
      rooms: rooms.length,
      desks: deskTotal,
      staff,
      deskRate: +((busy / Math.max(1, deskTotal)) * 100).toFixed(1),
      avgTemp: +avgTemp.toFixed(1)
    },
    env: {
      temp: +avgTemp.toFixed(1),
      humidity: Math.round(42 + rnd() * 12),
      co2: Math.round(480 + occ * 180 + rnd() * 60),
      pm25: Math.round(6 + rnd() * 8),
      tvoc: +(0.12 + rnd() * 0.14).toFixed(2),
      lux: Math.round(420 + rnd() * 120),
      zones: [
        { name: "办公 A", temp: byPlan["3201"].temp },
        { name: "办公 B", temp: byPlan["3202"].temp },
        { name: "机房", temp: machine.temp, warn: machineAlarm }
      ]
    },
    deviceCounts: [
      { name: "空调内机", value: cnt("ac"), color: "#3a8cff" },
      { name: "摄像头", value: cnt("camera"), color: "#2de2e6" },
      { name: "烟感", value: cnt("smoke"), color: "#ff6b81" },
      { name: "喷淋", value: Math.round(area / 7.2), color: "#ff9f43" },
      {
        name: "温湿度",
        value: Math.round(rooms.length * 1.6),
        color: "#3ddc97"
      },
      { name: "门禁", value: cnt("access") + 4, color: "#ffc65a" },
      { name: "照明回路", value: Math.round(area / 40), color: "#b27bff" },
      { name: "AP", value: cnt("ap"), color: "#59d6ff" }
    ]
  }
}

/** 楼层条：当前层上下各几层（只有办公层可进入） */
export function floorStrip(towerKey, floorKey, span = 4) {
  const floors = towerFloors(towerKey).filter((f) => f.index >= 1)
  const i = floors.findIndex((f) => f.key === floorKey)
  const lo = Math.max(0, Math.min(i - span + 1, floors.length - span * 2))
  return floors
    .slice(lo, lo + span * 2)
    .reverse()
    .map((f) => ({
      key: f.key,
      name: f.name,
      ok: hasFloorModel(f),
      alarm: !!f.alarm
    }))
}

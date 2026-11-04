<!--
  画面上的标签层：无人机标签、设施标签（充电区温度、盲区状态、消防通道占用、机库、大门）、楼栋序号圆牌、疑似目标说明卡。
  内容由仿真快照决定（Vue 渲染，几 Hz），位置每帧由 update(scene, toStage) 按三维投影摆放，不经过 Vue。
  点楼栋圆牌 = 选中该楼栋；标签本身不拦截点击（pointer-events: none），免得挡住拾取。
-->
<template>
  <div class="taglayer no-pointer">
    <div
      v-for="t in tags"
      :key="t.key"
      :ref="(el) => setRef(t.key, el)"
      class="tag"
      :class="t.cls"
      v-html="t.html"
    ></div>
    <div
      v-for="b in buildings"
      :key="b.id"
      :ref="(el) => setRef('pin-' + b.id, el)"
      class="pin"
      :class="{ on: selected === b.id }"
      @click.stop="$emit('pick', b.id)"
    >
      {{ b.no }}
    </div>
    <div
      v-if="callout"
      :ref="(el) => setRef('callout', el)"
      class="callout"
      :class="{ ok: callout.ok }"
    >
      <h4>
        <Icon name="person" style="stroke: var(--warn)" />
        {{ callout.title }}
      </h4>
      <div class="rows" v-html="callout.rows"></div>
    </div>
  </div>
</template>

<script setup>
  import { computed } from "vue"
  import layout from "../data/layout.json"
  import Icon from "./Icon.vue"
  import { V } from "../scene/theme.js"

  const props = defineProps({
    snap: { type: Object, required: true },
    selected: { type: String, default: null }
  })
  defineEmits(["pick"])

  const buildings = layout.buildings
    .filter((b) => b.id.startsWith("B"))
    .map((b) => ({ id: b.id, no: Number(b.id.slice(1)) }))
  const P = Object.fromEntries(layout.points.map((p) => [p.id, p]))
  const B = Object.fromEntries(layout.buildings.map((b) => [b.id, b]))
  const els = new Map()
  const setRef = (k, el) => (el ? els.set(k, el) : els.delete(k))

  const LV = { warn: "预警", alarm: "告警" }
  const SHORT = { PT: "周界入侵", FC: "外立面隐患" }

  /** 标签清单：{key, cls, html, plan: [x, y, h]（h 是离地高度，m）| drone: id, dy（像素偏移）} */
  const tags = computed(() => {
    const s = props.snap
    const out = []
    const tag = (key, html, plan, o = {}) =>
      out.push({
        key,
        html,
        plan,
        cls: o.cls ?? "",
        drone: o.drone,
        dy: o.dy ?? 0,
        dx: o.dx ?? 0
      })
    // 无人机（在飞的才标）
    for (const d of s.drones) {
      if (!d.airborne) continue
      tag(
        d.id,
        `${d.id} · ${d.id === "UAV-03" && d.task === 3 ? "抵近" : d.taskText} <b>${d.alt.toFixed(1)} m</b>`,
        null,
        {
          cls: "u" + d.id.slice(-1),
          drone: d,
          dy: -16
        }
      )
    }
    // 机库和大门
    tag(
      "HG",
      "HG-01 机库 · PM-01",
      [B["PM-01"].cx, B["PM-01"].cy, B["PM-01"].h * V + 12],
      {
        cls: "mini"
      }
    )
    // 东次入口、西人行门（北主入口在塔楼后面，从主机位看不到，不标）
    for (const id of ["GT-02", "GT-03"])
      tag(id, `${id} ${P[id].name}`, [P[id].x, P[id].y, 9], { cls: "mini" })
    // 充电区温度
    for (const id of ["CH-01", "CH-02", "CH-03"]) {
      const th = s.thermal[id]
      const t = th.temp.toFixed(th.q === "good" ? 1 : 0)
      const lv = th.level
      const html =
        lv === "stale"
          ? `${id} · <b>${t} ℃</b> 过期 ${th.verifiedAt}`
          : `${id} · <b>${t} ℃</b>${LV[lv] ? " " + LV[lv] : ""}`
      tag(id, html, [P[id].x, P[id].y, 4.2 * V + 10], {
        cls:
          lv === "warn"
            ? "warn"
            : lv === "alarm"
              ? "alarm"
              : lv === "stale"
                ? "stale mini"
                : "mini"
      })
    }
    // 盲区：只有搜寻在进行（或刚结束）时才标
    if (s.search.active) {
      for (const z of s.blind.zones) {
        tag(
          z.id,
          z.checked ? `${z.id} 已核验` : `${z.id} 待补扫`,
          [P[z.id].x, P[z.id].y, 10],
          { cls: z.checked ? "mini done" : "warn mini" }
        )
      }
    }
    // 消防通道占用、周界、外立面：未办结的事件
    for (const e of s.events) {
      if (!["pending", "dispatched", "processing", "review"].includes(e.status))
        continue
      if (e.type === "FP")
        tag(
          e.id,
          `${e.zone}${e.focus[1] < -60 ? " 南段" : e.focus[1] > 60 ? " 北段" : e.focus[0] > 100 ? " 东段" : ""} · ${e.title.includes("登高面") ? "登高面占用" : "车辆占用"}`,
          [e.focus[0], e.focus[1], 14],
          { cls: "warn mini" }
        )
      else if (e.type === "PT")
        tag(e.id, `${e.id} · ${SHORT.PT}`, [e.focus[0], e.focus[1], 14], {
          cls: "warn mini"
        })
      else if (e.type === "FC")
        tag(
          e.id,
          `${e.zone} · ${e.title.replace(e.zone + " ", "")}`,
          [B[e.zone].cx, B[e.zone].cy - B[e.zone].d / 2, B[e.zone].h * V * 0.5],
          { cls: "warn mini" }
        )
    }
    // 禁拍区：幼儿园 + B07 / B08 南立面
    tag(
      "PRIV",
      "禁拍区",
      [B["B07"].cx, B["B07"].cy - B["B07"].d / 2, B["B07"].h * V * 0.4 + 10],
      { cls: "mini" }
    )
    tag(
      "KG",
      "KG-01 幼儿园 · 禁拍区",
      [B["KG-01"].cx, B["KG-01"].cy, B["KG-01"].h * V + 10],
      { cls: "mini" }
    )
    return out
  })

  /** 疑似 / 确认目标的说明卡 */
  const callout = computed(() => {
    const t = props.snap.target
    if (t.status === 0) return null
    if (t.status === 1)
      return {
        ok: false,
        title: "疑似目标 · BS-04",
        rows: `树冠遮挡 + 红外异常热源<br>置信度 <b>${t.conf.toFixed(2)}</b> · 误差 <b>±${t.err.toFixed(1)} m</b><br>三号机核验中，预计 18:09 确认`
      }
    return {
      ok: true,
      title: "目标已确认 · BS-04",
      rows: `融合定位误差 <b>±${t.err.toFixed(1)} m</b>（≤ 1.5）<br>置信度 <b>${t.conf.toFixed(2)}</b><br>已推送给保安与家属`
    }
  })

  /** 标签宽度缓存（内容变了才重新量，避免每帧触发排版） */
  const widths = new Map()
  const widthOf = (key, el) => {
    const k = key + "|" + el.textContent
    if (!widths.has(k)) widths.set(k, el.offsetWidth || 90)
    return widths.get(k)
  }
  const overlap = (a, b) =>
    a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0

  /** 每帧：按三维投影摆位置，并按优先级避让（无人机标签 > 预警 / 告警 > 其他小标签） */
  function update(scene, toStage) {
    const items = []
    for (const t of tags.value) {
      const el = els.get(t.key)
      if (!el) continue
      const p = toStage(
        t.drone
          ? scene.projectDrone(t.drone)
          : scene.projectPlan(t.plan[0], t.plan[1], t.plan[2])
      )
      const x = p.x + t.dx
      const y = p.y + t.dy
      const prio = t.drone
        ? 0
        : /warn|alarm/.test(t.cls) || t.key === "KG" || t.key === "PRIV"
          ? 1
          : 2
      items.push({ t, el, x, y, prio, visible: p.visible })
    }
    // 疑似目标说明卡先占位
    const placed = []
    const c = els.get("callout")
    if (c) {
      const tg = props.snap.target
      const p = toStage(scene.projectPlan(tg.x, tg.y, 0))
      c.style.display = p.visible ? "" : "none"
      // 说明卡宽约 216 px：目标偏右（舞台 x > 1100）时放到目标左边（落在湖面上，不压别的标签，也不被右栏盖住）
      const left = p.x > 1100 ? p.x - 30 - 216 : p.x + 30
      c.style.left = `${left.toFixed(1)}px`
      // 纵向比目标略高：让出目标下方的充电区标签（CH-02 就在它正下方）
      const top = p.x > 1100 ? p.y - 24 : p.y + 34
      c.style.top = `${top.toFixed(1)}px`
      if (p.visible)
        placed.push({
          x0: left,
          x1: left + 216,
          y0: top,
          y1: top + 96
        })
    }
    items.sort((a, b) => a.prio - b.prio)
    for (const it of items) {
      const w = widthOf(it.t.key, it.el)
      const box = {
        x0: it.x - w / 2,
        x1: it.x + w / 2,
        y0: it.y - 22,
        y1: it.y
      }
      const clash = it.prio > 0 && placed.some((q) => overlap(box, q))
      const show = it.visible && !clash
      it.el.style.display = show ? "" : "none"
      if (!show) continue
      it.el.style.left = `${it.x.toFixed(1)}px`
      it.el.style.top = `${it.y.toFixed(1)}px`
      placed.push(box)
    }
    for (const b of buildings) {
      const el = els.get("pin-" + b.id)
      if (!el) continue
      const bb = B[b.id]
      const p = toStage(scene.projectPlan(bb.cx, bb.cy, bb.h * V + 8))
      el.style.display = p.visible ? "" : "none"
      el.style.left = `${p.x.toFixed(1)}px`
      el.style.top = `${p.y.toFixed(1)}px`
    }
  }
  defineExpose({ update })
</script>

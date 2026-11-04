<!--
  场景设备标签层：叠在三维上的编号标签（设计稿 .tags 的移植）
  清单：电铲 ES-01…07、破碎站 CR-01、皮带 BC-02、电厂 PP-01、煤场 CY-01、换电站 SW-02、内排土场 DP-I、轮斗 BW-01、
        有预警的边坡雷达（SR-02 北帮预警等）、故障卡车和当前选中的卡车 / 设备。
  位置每帧向场景要：project(编号) 返回舞台设计像素（返回 null 就不显示），不写死像素；
  标签相对锚点的偏移（引线方向）照设计稿。点标签 = 选中该设备（布局里有的编号才选）。
-->
<template>
  <div class="tags">
    <div
      v-for="t in tags"
      :key="t.id"
      :ref="(el) => setRef(t.id, el)"
      class="tg"
      style="display: none"
    >
      <div class="leader"></div>
      <div
        v-if="t.pin !== false"
        class="pin"
        :class="[t.cls, { sel: t.sel }]"
      ></div>
      <div
        class="tag"
        :class="[t.cls, { sel: t.sel }]"
        @click.stop="selectIfKnown(t.id)"
      >
        <b>{{ t.id }}</b
        >{{ t.text
        }}<span v-if="t.hi" :style="{ color: t.hiColor }">{{ t.hi }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
  import {
    LEVEL_COLOR,
    LEVEL_NAME,
    SECTOR_NAME,
    f1,
    f2,
    truckRow
  } from "../store/derive.js"

  import { PHASE } from "../sim/simulator.js"

  const props = defineProps({
    // (编号) => {x, y}（舞台设计像素）或 null
    project: { type: Function, required: true }
  })
  const { fast, selection, selectIfKnown, layout } = inject("board")

  // 电铲标签的偏移（设计稿里按概念图里 7 台电铲的位置排的）
  const SHOVEL_OFF = {
    "ES-04": [12, -34],
    "ES-03": [-146, -30],
    "ES-05": [14, -34],
    "ES-06": [20, 26],
    "ES-07": [22, 26],
    "ES-01": [16, 24],
    "ES-02": [16, 22]
  }
  const nameOf = (id) => layout.devices.find((d) => d.id === id)?.name || id

  /** 一个标签：id、类名（fault / warn / coal）、文字、相对锚点的偏移；len / ang 是引线长度和角度 */
  const mk = (id, cls, text, dx, dy, extra = {}) => ({
    id,
    cls,
    text,
    dx,
    dy,
    len: Math.hypot(dx, dy),
    ang: (Math.atan2(dy, dx) * 180) / Math.PI,
    ...extra
  })

  const tags = computed(() => {
    const f = fast.value
    const sel = selection.value
    const out = []
    // 电铲
    f.shovels.forEach((s) => {
      const [dx, dy] = SHOVEL_OFF[s.id] || [16, 24]
      out.push(
        mk(s.id, s.state === "故障" ? "fault" : "", `电铲 · ${s.state}`, dx, dy)
      )
    })
    const sink = (id) => f.sinks.find((s) => s.id === id)
    out.push(
      mk(
        "CR-01",
        "coal",
        `半移动破碎站 · 排队 ${sink("CR-01").queue}`,
        -30,
        44
      ),
      mk("BC-02", "", `输煤走廊 · ${f1(f.yard.beltTph / 1000)}k t/h`, -30, 34, {
        pin: false
      }),
      mk("PP-01", "", `坑口电厂 · 耗煤 ${f.yard.burnTph} t/h`, -150, -54),
      mk("CY-01", "coal", `封闭煤场 · ${f.yard.ratio}%`, -90, 44),
      mk(
        "SW-02",
        "",
        `换电站 · 在换 ${f.stations.find((s) => s.id === "SW-02")?.busy ?? 0}`,
        -10,
        30
      ),
      mk("DP-I", "", "内排土场", -110, -14),
      mk("BW-01", "", "轮斗挖掘机", 18, 30)
    )
    // 有预警的边坡雷达（正常的不挂标签）
    f.slope.radar
      .filter((r) => r.level >= 1)
      .forEach((r) =>
        out.push(
          mk(
            r.id,
            r.level >= 3 ? "fault" : "warn",
            `${SECTOR_NAME[r.id]} · ${f2(r.velMmH)} mm/h · `,
            26,
            26,
            { hi: LEVEL_NAME[r.level], hiColor: LEVEL_COLOR[r.level] }
          )
        )
      )
    // 故障卡车（始终有标签）
    f.s.trucks
      .filter((t) => t.phase === PHASE.FAULT)
      .slice(0, 1)
      .forEach((t) => {
        const ev = f.events.find(
          (e) => e.target === t.id && e.kind === "truckFault"
        )
        out.push(
          mk(
            t.id,
            "fault",
            `故障停运 · ${ev ? ev.desc : "自检未通过"}`,
            18,
            -34
          )
        )
      })
    // 选中的对象：已有标签的加亮，没有的（卡车、基站、水位井……）补一个
    const hit = out.find((t) => t.id === sel)
    if (hit) hit.sel = true
    else if (sel) {
      const t = f.byId.get(sel)
      out.push(
        mk(
          sel,
          "",
          t ? `${truckRow(t).state} · 电量 ${Math.round(t.soc)}%` : nameOf(sel),
          18,
          -34,
          { sel: true }
        )
      )
    }
    return out
  })

  // 每帧按场景的投影更新位置（直接改 transform，不走 Vue 响应式）
  const els = {}
  function setRef(id, el) {
    if (el) els[id] = el
    else delete els[id]
  }
  // 标签可以落的区域：两侧栏之间、指标条之下、底部面板之上（舞台设计像素）
  // x0 = 452：设计稿里 ES-03 的标签左缘在 461，左栏右缘约 443
  const BOX = { x0: 452, x1: 1456, y0: 190, y1: 926 }
  const TAG_H = 26
  const widths = new Map()
  let frameNo = 0
  // 优先级：选中 > 故障 > 预警 > 其余（数字小的先摆，位置最稳）
  const prio = (t) =>
    t.sel ? 0 : t.cls === "fault" ? 1 : t.cls === "warn" ? 2 : 3
  const hit = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

  /** 给一个标签找位置：先试设计稿的偏移，碰到已摆好的标签或出了区域就上下挪、必要时翻到锚点另一侧 */
  function place(p, t, w, placed) {
    const flips = [t.dx, -w - 14]
    const steps = [0, -1, 1, -2, 2, -3, 3, -4, 4]
    for (const dxx of flips) {
      for (const k of steps) {
        const dy = t.dy + k * (TAG_H + 4)
        const r = { x: p.x + dxx, y: p.y + dy - 12, w, h: TAG_H }
        if (
          r.x < BOX.x0 ||
          r.x + w > BOX.x1 ||
          r.y < BOX.y0 ||
          r.y + TAG_H > BOX.y1
        )
          continue
        if (placed.some((q) => hit(r, q))) continue
        return { dx: dxx, dy, r }
      }
    }
    // 实在放不下：选中 / 故障的标签夹进安全区硬摆（宁可压住别的标签），其余的隐藏，不让它漏到侧栏上
    if (prio(t) > 1) return null
    const x = Math.min(Math.max(p.x + t.dx, BOX.x0), BOX.x1 - w)
    const y = Math.min(Math.max(p.y + t.dy - 12, BOX.y0), BOX.y1 - TAG_H)
    return { dx: x - p.x, dy: y + 12 - p.y, r: { x, y, w, h: TAG_H } }
  }

  let raf = 0
  function frame() {
    raf = requestAnimationFrame(frame)
    frameNo++
    const vis = []
    for (const t of tags.value) {
      const el = els[t.id]
      if (!el) continue
      const p = props.project(t.id)
      if (!p) {
        if (el.style.display !== "none") el.style.display = "none"
        continue
      }
      // 锚点本身已经跑到侧栏 / 指标条 / 底栏后面去了：不挂标签（引线会拉得很长）
      if (
        p.x < BOX.x0 - 30 ||
        p.x > BOX.x1 + 30 ||
        p.y < BOX.y0 - 30 ||
        p.y > BOX.y1 + 30
      ) {
        if (el.style.display !== "none") el.style.display = "none"
        continue
      }
      vis.push({ t, el, p })
    }
    vis.sort((a, b) => prio(a.t) - prio(b.t))
    // 选中详情卡（舞台里固定位置）占着的区域：标签避开它，卡片是半透明的，下面的标签会透出来
    const placed = selection.value ? [{ x: 1214, y: 260, w: 238, h: 148 }] : []
    for (const { t, el, p } of vis) {
      const tagEl = el.children[el.children.length - 1]
      // 宽度每 60 帧重量一次（文字里的数会变）
      if (!widths.has(t.id) || frameNo % 60 === 0)
        widths.set(t.id, tagEl.offsetWidth || 160)
      const w = widths.get(t.id)
      const pos = place(p, t, w, placed)
      if (!pos) {
        el.style.display = "none"
        continue
      }
      placed.push(pos.r)
      const len = Math.hypot(pos.dx, pos.dy)
      const ang = (Math.atan2(pos.dy, pos.dx) * 180) / Math.PI
      const leader = el.children[0]
      leader.style.width = `${len.toFixed(1)}px`
      leader.style.transform = `rotate(${ang.toFixed(1)}deg)`
      tagEl.style.left = `${pos.dx}px`
      tagEl.style.top = `${pos.dy - 12}px`
      el.style.display = ""
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`
    }
  }
  onMounted(frame)
  onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

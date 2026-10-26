<!--
  A8 动态阈值：光纤测温的三种报警规则在当前最热点上的读数与阈值
    定温（绝对温度 ≥ 60 °C）、差温（10 分钟温升速率 ≥ 1.0 °C/min）、温差（比全线均温高 ≥ 10 °C）
  三条都按"读数 / 阈值"画进度条；定温报警往往最晚，温差最早 —— 这正是平台比定温保护提前的原因
-->
<template>
  <Panel no="A8" title="动态阈值 · 光纤测温" en="DTS RULES">
    <div class="dt-h">
      <span><Ic name="temp" />{{ beltName }} 最热点</span
      ><b>{{ fmt(hot.v, 1) }} °C</b
      ><em>@ {{ fmt(hot.at) }} m · 全线均温 {{ fmt(hot.avg, 1) }} °C</em>
    </div>
    <div
      v-for="r in rules"
      :key="r.k"
      class="dt-r"
      :class="{ hit: r.v >= r.lim }"
    >
      <span>{{ r.k }}</span>
      <div class="dt-bar">
        <i
          :style="{
            width: `${Math.min(100, (r.v / r.lim) * 100).toFixed(0)}%`
          }"
        ></i>
        <u></u>
      </div>
      <b
        >{{ fmt(r.v, r.d) }}<i>/ {{ r.lim }} {{ r.u }}</i></b
      >
    </div>
    <p class="dt-note">
      {{ hitText }}
    </p>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import Ic from "../Ic.vue"
  import { beltShort, fmt } from "../ui.js"
  import layout from "../../data/layout.json"

  const props = defineProps({
    f: { type: Object, required: true },
    w: { type: Object, required: true }
  })
  const sim = inject("sim")
  const MIN = 60000

  // 看哪条皮带：最严重的托辊劣化所在皮带，默认主运输大巷
  const belt = computed(() => {
    const tr = [...props.f.s.tracks]
      .filter((t) => t.kind === "idlerBearing")
      .sort((a, b) => b.s - a.s)[0]
    return tr && props.w.dts[tr.belt] ? tr.belt : "BC03"
  })
  const beltName = computed(() => beltShort(layout, belt.value))
  const hot = computed(() => {
    const T = props.w.dts[belt.value]
    // 10 分钟前同一处的温度（差温规则）
    const T0 = sim.dts(belt.value, props.w.ms - 10 * MIN)
    let v = -Infinity
    let at = 0
    T.forEach((x, i) => {
      if (x > v) [v, at] = [x, i]
    })
    const avg = T.reduce((a, x) => a + x, 0) / T.length
    return { v, at, avg, rate: (v - T0[at]) / 10 }
  })
  const rules = computed(() => [
    { k: "定温", v: hot.value.v, lim: 60, u: "°C", d: 1 },
    { k: "差温", v: Math.max(0, hot.value.rate), lim: 1, u: "°C/min", d: 2 },
    { k: "温差", v: hot.value.v - hot.value.avg, lim: 10, u: "°C", d: 1 }
  ])
  const hitText = computed(() => {
    const hits = rules.value.filter((r) => r.v >= r.lim).map((r) => r.k)
    return hits.length
      ? `已触发：${hits.join("、")} · 定温保护尚未动作，平台已提前预警`
      : "三条规则均未触发"
  })
</script>

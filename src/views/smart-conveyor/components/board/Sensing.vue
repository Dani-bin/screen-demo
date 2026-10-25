<!--
  09 光纤测温 · 听诊 · X 光：BC03 全线温度曲线（1 m 分辨率，按 140 段取最大值），听诊异响处用紫色竖线标出；
  下面是听诊处数、主斜井 X 光断丝 / 接头、托辊温速传感器（电量低时读数存疑）
-->
<template>
  <Panel no="09" title="光纤测温 · 听诊 · X 光" en="DTS · DAS · X-RAY">
    <div class="dts">
      <div class="dts-h">
        <span><Ic name="temp" />BC03 主运输大巷 全线温度（1 m 分辨率）</span
        ><b>最高 {{ fmt(chart.max, 1) }} °C</b><em>@ {{ fmt(chart.at) }} m</em>
      </div>
      <svg
        :style="{ width: rem(W), height: rem(H + 14) }"
        :viewBox="`0 0 ${W} ${H + 14}`"
      >
        <line
          x1="0"
          :x2="W"
          :y1="chart.base"
          :y2="chart.base"
          stroke="var(--hair-soft)"
        />
        <path
          :d="`${chart.path}L${W},${H}L0,${H}Z`"
          fill="var(--coal)"
          opacity="0.1"
          stroke="none"
        />
        <path :d="chart.path" stroke="var(--coal)" stroke-width="1.6" />
        <g v-for="p in chart.hot" :key="p.x">
          <line
            :x1="p.x"
            :x2="p.x"
            y1="0"
            :y2="H"
            stroke="var(--predict)"
            stroke-dasharray="2 2"
          />
          <circle :cx="p.x" :cy="p.y" r="3.5" fill="var(--predict)" />
        </g>
        <text x="0" :y="H + 12" class="ax">0</text>
        <text :x="W" :y="H + 12" class="ax" text-anchor="end">
          {{ fmt(chart.len - 1) }} m
        </text>
      </svg>
    </div>
    <div class="sense-l">
      <span
        ><Ic name="ear" />听诊异响 <b>{{ w.das.found.length }}</b> 处</span
      >
      <span
        ><Ic name="xray" />主斜井 X 光断丝 <b>{{ broken }}</b> 处 · 接头
        {{ w.xr.splices.length }} 个</span
      >
    </div>
    <div class="sense-l" :class="{ 'q-uncertain': battery }">
      <span
        ><Ic name="wave" />托辊温速 <b>{{ f.idlerSensors.length }}</b> 只</span
      >
      <em>{{ battery ? `${battery.device} 电量低 · 读数存疑` : "全部在线" }}</em
      ><u v-if="battery">?</u>
    </div>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import Ic from "../Ic.vue"
  import { fmt, rem } from "../ui.js"

  const props = defineProps({
    f: { type: Object, required: true },
    w: { type: Object, required: true }
  })
  // 曲线区 372 × 40（设计稿 px），140 段
  const W = 372
  const H = 40
  const N = 140

  const chart = computed(() => {
    const T = props.w.dts.BC03
    const vals = Array.from({ length: N }, (_, i) => {
      let m = -Infinity
      const a = Math.floor((i * T.length) / N)
      const b = Math.max(a + 1, Math.floor(((i + 1) * T.length) / N))
      for (let x = a; x < b; x++) m = Math.max(m, T[x])
      return m
    })
    let max = -Infinity
    let at = 0
    T.forEach((v, i) => {
      if (v > max) [max, at] = [v, i]
    })
    const lo = Math.min(...vals) - 1
    const hi = Math.max(...vals) + 2
    const y = (v) => H - ((v - lo) / (hi - lo)) * (H - 4) - 2
    const path = vals
      .map(
        (v, i) =>
          `${i ? "L" : "M"}${((i / (N - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`
      )
      .join("")
    // 听诊异响位置：竖线 + 该处曲线上的点
    const hot = props.w.das.found.map((f) => {
      const x = (f.chainage / T.length) * W
      const k = Math.round((x / W) * (N - 1))
      const v = Math.max(...vals.slice(Math.max(0, k - 1), k + 2))
      return { x, y: y(v) }
    })
    return { path, hot, max, at, base: y(lo + 1), len: T.length }
  })
  const broken = computed(
    () => props.w.xr.damages.filter((x) => x.type === "断丝").length
  )
  const battery = computed(() =>
    props.f.s.alarms.find((a) => a.kind === "battery")
  )
</script>

<!-- 链路与信号：5.8G 主链路和 2.4G 备用的信号强度（取当前在飞、信号最吃紧的一架），带自动切换标注 -->
<template>
  <div class="card" style="left: 36px; top: 408px; width: 450px; height: 294px">
    <div class="hd">
      <Icon name="wifi" /><span class="t">链路与信号 · {{ chart.id }}</span>
      <span class="s">经二号机中继转发</span>
    </div>
    <div class="legend">
      <span><i style="border-color: #e8dfcc"></i>5.8G 主链路</span>
      <span><i class="dash" style="border-color: #e8b04a"></i>2.4G 备用</span>
      <span style="margin-left: auto; color: var(--ink-3)">信号强度 dBm</span>
    </div>
    <LineChart
      :w="420"
      :h="182"
      :t0="chart.t0"
      :now-idx="30"
      :y-min="-100"
      :y-max="-50"
      :y-ticks="[-100, -80, -60]"
      :series="[
        {
          color: '#e8dfcc',
          data: chart.r58,
          label: String(Math.round(chart.r58[30]))
        },
        {
          color: '#e8b04a',
          data: chart.r24,
          label: String(Math.round(chart.r24[30])),
          dash: true
        }
      ]"
      :notes="notes"
    />
    <div class="foot">
      <span class="chip" :class="d.link ? 'warn' : ''"
        >当前 {{ d.link ? "2.4G 备用" : "5.8G 主链路" }}</span
      >
      <span
        >延迟
        <b class="num" style="color: var(--ink); font-weight: normal">{{
          Math.round(d.lat)
        }}</b>
        ms（指标 ≤ 50）</span
      >
      <span style="margin-left: auto">{{ hint }}</span>
    </div>
  </div>
</template>

<script setup>
  import { computed } from "vue"
  import Icon from "./Icon.vue"
  import LineChart from "./LineChart.vue"

  const props = defineProps({
    snap: { type: Object, required: true },
    chart: { type: Object, required: true }
  })
  const d = computed(() =>
    props.snap.drones.find((x) => x.id === props.chart.id)
  )
  /** 图上的标注：最近一次链路切换（取系统日志里的切换条） */
  const notes = computed(() => {
    const sw = props.snap.sysLog.find((l) => l.text.includes("自动切换"))
    if (!sw) return []
    const i = Math.round(hmOf(sw.clock) - props.chart.t0)
    return i >= 0 && i <= 30
      ? [
          {
            i,
            y: 24,
            color: "#e8b04a",
            text: `${sw.clock} 自动切 2.4G`,
            anchor: "end"
          }
        ]
      : []
  })
  const hmOf = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))
  const hint = computed(() =>
    d.value.link
      ? "预计 18:10 切回 5.8G"
      : d.value.airborne
        ? "主链路稳定"
        : "待命，链路自检通过"
  )
</script>

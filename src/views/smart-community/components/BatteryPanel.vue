<!-- 电量与补位：三机电量曲线（虚线为预测）+ 25 % 补位线 + 补位预告 -->
<template>
  <div class="card" style="left: 36px; top: 714px; width: 450px; height: 238px">
    <div class="hd">
      <Icon name="battery" /><span class="t">电量与补位</span
      ><span class="s">虚线为预测</span>
    </div>
    <div class="legend">
      <span v-for="id in IDS" :key="id"
        ><i :style="{ borderColor: HEX[id] }"></i>{{ id }}</span
      >
    </div>
    <LineChart
      :w="420"
      :h="134"
      :t0="chart.t0"
      :now-idx="30"
      :y-min="0"
      :y-max="100"
      :y-ticks="[0, 50, 100]"
      :refs="[{ y: 25, color: '#e8b04a', label: '低电量补位线 25%' }]"
      :series="
        IDS.map((id) => ({
          color: HEX[id],
          data: chart.batt[id],
          future: true,
          label: String(Math.round(chart.batt[id][30]))
        }))
      "
    />
    <div class="foot" style="margin-top: 0">
      <Icon name="flow" :size="14" style="stroke: var(--warn)" />
      <span v-html="forecast"></span>
    </div>
  </div>
</template>

<script setup>
  import { computed } from "vue"
  import Icon from "./Icon.vue"
  import LineChart from "./LineChart.vue"
  import { clock } from "../sim/simulator.js"

  const props = defineProps({
    snap: { type: Object, required: true },
    chart: { type: Object, required: true }
  })
  const IDS = ["UAV-01", "UAV-02", "UAV-03"]
  const HEX = { "UAV-01": "#3987e5", "UAV-02": "#199e70", "UAV-03": "#9085e9" }

  /** 补位预告：从预测曲线里找最先降到 25 % 以下的那架 */
  const forecast = computed(() => {
    const c = props.chart
    let best = null
    for (const id of IDS) {
      if (!props.snap.drones.find((d) => d.id === id).airborne) continue
      const k = c.batt[id].findIndex((v, i) => i >= 30 && v <= 25)
      if (k > 0 && (!best || k < best.k)) best = { id, k, v: c.batt[id][k] }
    }
    const warn = (t) =>
      `<b style="color:var(--warn);font-weight:normal">${t}</b>`
    const NAME = { "UAV-01": "一号机", "UAV-02": "二号机", "UAV-03": "三号机" }
    // 低电量的是补盲机时，由主侦查机补位；反之由补盲机补位
    if (best)
      return `预计 ${warn(clock(c.t0 + best.k))} ${NAME[best.id]}降至 ${Math.round(best.v)}%，自动返航，${best.id === "UAV-03" ? NAME["UAV-01"] : NAME["UAV-03"]}补位`
    return "三机电量充足，机库自动换电（落地后 10 %/min）"
  })
</script>

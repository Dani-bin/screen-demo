<!-- 换电 · 光伏：今日换电次数、平均时长、满电电池仓、光伏装机 / 当前出力 / 今日发电、箱变负载 -->
<template>
  <section class="panel">
    <div class="ptitle">
      <BatteryCharging />
      <h3>换电 · 光伏</h3>
      <span class="unit">乘用车换电站 / 罩棚光伏</span>
    </div>
    <KpiGrid :items="items" />
  </section>
</template>

<script setup>
  import { BatteryCharging } from "lucide-vue-next"
  import KpiGrid from "./KpiGrid.vue"
  import { fmt } from "../utils"

  const props = defineProps({
    swap: { type: Object, required: true },
    pv: { type: Object, required: true },
    load: { type: Number, required: true }
  })
  const items = computed(() => {
    const { swap, pv } = props
    return [
      { label: "今日换电", value: swap.today, unit: "次", color: "#2de2e6" },
      { label: "平均时长", value: swap.avgMin.toFixed(1), unit: "min" },
      {
        label: "满电电池",
        value: swap.full,
        unit: `/${swap.slots} 仓`,
        color: "#3ddc97"
      },
      { label: "光伏出力", value: fmt(pv.kw), unit: `/${pv.kwp} kWp` },
      { label: "今日发电", value: fmt(pv.kwh), unit: "kWh", color: "#ffd45a" },
      {
        label: "箱变负载",
        value: Math.round(props.load * 100),
        unit: "%",
        color: props.load > 0.85 ? "#ff4d5a" : ""
      }
    ]
  })
</script>

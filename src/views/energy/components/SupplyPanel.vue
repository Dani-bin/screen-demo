<!-- 今日补给概览：服务车次、重卡车次、营收、加油量、加气量、充换电量 -->
<template>
  <section class="panel">
    <div class="ptitle">
      <Gauge />
      <h3>今日补给概览</h3>
      <span class="unit">截至 {{ hhmm }}</span>
    </div>
    <KpiGrid :items="items" />
  </section>
</template>

<script setup>
  import { Gauge } from "lucide-vue-next"
  import KpiGrid from "./KpiGrid.vue"
  import { KINDS } from "../data/station"
  import { fmt } from "../utils"

  const props = defineProps({
    today: { type: Object, required: true },
    now: { type: Date, required: true }
  })
  const hhmm = computed(() => props.now.toTimeString().slice(0, 5))
  const items = computed(() => {
    const t = props.today
    return [
      { label: "服务车次", value: fmt(t.vehicles), unit: "辆" },
      { label: "其中重卡", value: fmt(t.trucks), unit: "辆", color: "#ff9a3d" },
      {
        label: "今日营收",
        value: (t.revenue / 1e4).toFixed(1),
        unit: "万元",
        color: "#2de2e6"
      },
      { label: "加油", value: fmt(t.fuelL), unit: "L", dot: KINDS.fuel.color },
      {
        label: "加气",
        value: t.gasT.toFixed(1),
        unit: "t",
        dot: KINDS.gas.color
      },
      {
        label: "充电 / 换电",
        value: fmt(t.chargeKwh + t.swapKwh),
        unit: "kWh",
        dot: KINDS.charge.color
      }
    ]
  })
</script>

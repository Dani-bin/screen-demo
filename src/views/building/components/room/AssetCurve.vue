<!-- 实时曲线：选中资产今日 24 小时读数 -->
<template>
  <section>
    <PanelTitle title="实时曲线">
      <template #extra>{{ name }}</template>
    </PanelTitle>
    <div class="body">
      <AreaChart
        :values="values"
        :cursor="hour"
        color="#ffc65a"
        :zero="false"
        :ticks="['00:00', '08:00', '16:00', '24:00']"
      />
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"
  import AreaChart from "../park/AreaChart.vue"

  defineProps({
    values: { type: Array, required: true },
    name: { type: String, default: "" },
    hour: { type: Number, default: 0 }
  })
</script>

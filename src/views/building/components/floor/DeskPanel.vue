<!-- 工位占用：在岗 / 预约 / 空闲 三格 + 24 小时占用曲线 -->
<template>
  <section>
    <PanelTitle title="工位占用">
      <template #extra>今日占用曲线</template>
    </PanelTitle>
    <div class="body">
      <div class="cells">
        <div class="cell green">
          <b class="num">{{ count.busy }}</b
          ><small>个</small>
          <span>在岗</span>
        </div>
        <div class="cell gold">
          <b class="num">{{ count.booked }}</b
          ><small>个</small>
          <span>已预约</span>
        </div>
        <div class="cell">
          <b class="num">{{ count.free }}</b
          ><small>个</small>
          <span>空闲</span>
        </div>
      </div>
      <div class="chart">
        <AreaChart :values="curve" :cursor="hour" color="#3ddc97" />
      </div>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"
  import AreaChart from "../park/AreaChart.vue"

  const props = defineProps({
    desks: { type: Array, required: true },
    curve: { type: Array, required: true }
  })

  const hour = new Date().getHours()
  const count = computed(() => {
    const c = { busy: 0, booked: 0, free: 0 }
    for (const d of props.desks) c[d.status]++
    return c
  })
</script>

<style lang="scss" scoped>
  .chart {
    margin-top: 10px;
  }
</style>

<!--
  入驻与人员：入驻率 / 入驻企业 / 在岗人数 + 今日逐时在岗曲线（演示数据）
-->
<template>
  <section>
    <PanelTitle title="入驻与人员">
      <template #extra>实时在岗曲线</template>
    </PanelTitle>
    <div class="body">
      <div class="cells">
        <div class="cell cyan">
          <b class="num">{{ profile.occupancy }}</b
          ><small>%</small>
          <span>入驻率</span>
        </div>
        <div class="cell">
          <b class="num">{{ profile.tenants }}</b
          ><small>家</small>
          <span>入驻企业</span>
        </div>
        <div class="cell">
          <b class="num">{{ now.toLocaleString("en-US") }}</b
          ><small>人</small>
          <span>在岗人数</span>
        </div>
      </div>
      <div class="chart">
        <AreaChart :values="curve" :cursor="hour" />
      </div>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"
  import AreaChart from "../park/AreaChart.vue"

  const props = defineProps({
    profile: { type: Object, required: true },
    /** 24 点在岗人数 */
    curve: { type: Array, required: true }
  })

  const hour = new Date().getHours()
  const now = computed(() => props.curve[hour])
</script>

<style lang="scss" scoped>
  .chart {
    height: 112px;
    margin-top: 12px;
  }
</style>

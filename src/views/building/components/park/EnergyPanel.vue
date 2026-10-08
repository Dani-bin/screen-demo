<!--
  今日能耗（演示数据）：累计值 + 同比 + 逐时曲线，游标在当前小时
-->
<template>
  <section>
    <PanelTitle title="今日能耗">
      <template #extra>kWh / 时</template>
    </PanelTitle>
    <div class="body">
      <div class="sum">
        <span
          >累计 <b class="num">{{ total }}</b> MWh</span
        >
        <span>同比 <b class="num green">-6.8%</b></span>
      </div>
      <div class="chart">
        <AreaChart :values="ENERGY_TODAY" :cursor="hour" />
      </div>
    </div>
  </section>
</template>

<script setup>
  import PanelTitle from "../PanelTitle.vue"
  import AreaChart from "./AreaChart.vue"
  import { ENERGY_TODAY } from "../../data/park"

  const hour = new Date().getHours()
  // 截至当前小时的累计
  const total = (
    ENERGY_TODAY.slice(0, hour + 1).reduce((a, b) => a + b, 0) / 1000
  ).toFixed(1)
</script>

<style lang="scss" scoped>
  .sum {
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px;
    color: #8aa0bd;

    b {
      font-size: 20px;
      font-weight: normal;
      color: #fff;

      &.green {
        font-size: 16px;
        color: #3ddc97;
      }
    }
  }

  .chart {
    height: 118px;
  }
</style>

<!-- 生产统计：昨日 / 本月累计 / 月计划完成率 + 近 7 日原煤产量 -->
<template>
  <section class="panel" :class="{ grow }">
    <h3>生产统计<small>单位：吨</small></h3>
    <div class="kpis">
      <div class="kpi">
        <span>昨日原煤</span><b class="num">{{ fmt(p.yesterday) }}</b
        ><i>t</i>
      </div>
      <div class="kpi">
        <span>本月累计</span><b class="num">{{ (p.month / 1e4).toFixed(1) }}</b
        ><i>万 t</i>
        <em :class="{ down: p.vsLastMonth < 0 }"
          >{{ p.vsLastMonth >= 0 ? "▲" : "▼" }}
          {{ Math.abs(p.vsLastMonth * 100).toFixed(1) }}%</em
        >
      </div>
      <div class="kpi">
        <span>月计划完成</span
        ><b class="num ok">{{ (p.planDone * 100).toFixed(1) }}</b
        ><i>%</i>
      </div>
    </div>
    <div class="cap">近 7 日原煤产量（今日截至 {{ hm }}）</div>
    <BarChart :items="p.week" />
  </section>
</template>

<script setup>
  import BarChart from "./BarChart.vue"
  import { fmt } from "../utils"

  defineProps({
    p: { type: Object, required: true },
    hm: { type: String, default: "" },
    grow: { type: Boolean, default: false }
  })
</script>

<style lang="scss" scoped>
  em {
    margin-left: 4px;
    font-size: 12px;
    font-style: normal;
    color: #3ddc97;

    &.down {
      color: #ff4d5a;
    }
  }

  .ok {
    color: #3ddc97;
  }
</style>

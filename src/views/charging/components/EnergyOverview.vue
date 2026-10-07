<!-- 能源概览：供能构成环图（光伏 / 储能 / 电网）+ 充电负荷 + 今日累计 -->
<template>
  <section class="panel energy">
    <div class="ptitle">
      <LayoutGrid />
      <h3>能源概览</h3>
      <span class="more">···</span>
    </div>
    <div class="row2">
      <RingChart
        :segs="segs"
        :value="fmt(p.pv + Math.max(0, p.ess) + p.grid)"
        unit="kW"
        label="总供能"
      />
      <div class="rows">
        <div class="r p4">
          <SolarPanel :style="{ color: 'var(--pv)' }" /><span>光伏发电</span
          ><span class="v">{{ fmt(p.pv) }}<small>kW</small></span
          ><span class="p" style="color: var(--pv)"
            >{{ pct(snap.mix.pv) }}%</span
          >
        </div>
        <div class="r p4">
          <BatteryCharging :style="{ color: 'var(--ess)' }" /><span
            >储能{{ p.ess >= 0 ? "放电" : "充电" }}</span
          ><span class="v">{{ fmt(Math.abs(p.ess)) }}<small>kW</small></span
          ><span class="p" style="color: var(--ess)"
            >{{ pct(snap.mix.ess) }}%</span
          >
        </div>
        <div class="r p4">
          <UtilityPole :style="{ color: 'var(--grid)' }" /><span>电网购电</span
          ><span class="v">{{ fmt(p.grid) }}<small>kW</small></span
          ><span class="p" style="color: var(--grid)"
            >{{ pct(snap.mix.grid) }}%</span
          >
        </div>
        <div class="r p4">
          <PlugZap :style="{ color: 'var(--load)' }" /><span>充电负荷</span
          ><span class="v">{{ fmt(p.load) }}<small>kW</small></span
          ><span class="p" style="color: var(--load)"
            >{{ pct(p.load / p.total) }}%</span
          >
        </div>
      </div>
    </div>
    <div class="stats">
      <div>
        <span>今日充电量</span
        ><b>{{ fmt(snap.today.energy) }}<small>kWh</small></b>
      </div>
      <div>
        <span>今日收益</span><b>¥{{ fmt(snap.today.revenue) }}</b>
      </div>
      <div>
        <span>光伏减碳</span
        ><b>{{ snap.today.carbon.toFixed(2) }}<small>t</small></b>
      </div>
    </div>
  </section>
</template>

<script setup>
  import {
    BatteryCharging,
    LayoutGrid,
    PlugZap,
    SolarPanel,
    UtilityPole
  } from "lucide-vue-next"
  import RingChart from "./RingChart.vue"
  import { fmt, pct } from "../utils"

  const props = defineProps({ snap: { type: Object, required: true } })
  const p = computed(() => props.snap.power)
  const segs = computed(() => [
    { v: props.snap.mix.pv, color: "#f5c242" },
    { v: props.snap.mix.ess, color: "#34e07a" },
    { v: props.snap.mix.grid, color: "#ff9f43" }
  ])
</script>

<style lang="scss" scoped>
  .energy {
    height: 262px;
  }
</style>

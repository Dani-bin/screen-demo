<!-- 24 小时补给车次：加油 / 加气 / 充电 / 换电四条折线，当前时刻之后为预测（虚线） -->
<template>
  <section class="panel">
    <div class="ptitle">
      <ChartLine />
      <h3>24 小时补给车次</h3>
      <div class="legend">
        <span v-for="(k, key) in KINDS" :key="key"
          ><i :style="{ background: k.color }"></i>{{ k.name }}</span
        >
      </div>
      <span class="unit">单位：辆 / 小时</span>
    </div>
    <svg class="chart" :viewBox="`0 0 ${W} ${H}`">
      <g v-for="v in ticks" :key="v">
        <line :x1="L" :x2="W - R" :y1="ys(v)" :y2="ys(v)" class="grid" />
        <text :x="L - 8" :y="ys(v) + 4" class="ax" text-anchor="end">
          {{ v }}
        </text>
      </g>
      <text
        v-for="h in 9"
        :key="'h' + h"
        :x="xs((h - 1) * 3)"
        :y="H - 2"
        class="ax"
        text-anchor="middle"
      >
        {{ String((h - 1) * 3).padStart(2, "0") }}:00
      </text>
      <line :x1="xs(now)" :x2="xs(now)" :y1="T" :y2="H - B" class="now" />
      <g v-for="(k, key) in KINDS" :key="key">
        <path
          :d="path(trend.series[key], 0, cut)"
          fill="none"
          :stroke="k.color"
          stroke-width="2"
        />
        <path
          :d="path(trend.series[key], cut, 23)"
          fill="none"
          :stroke="k.color"
          stroke-width="1.5"
          stroke-dasharray="4 4"
          opacity=".55"
        />
      </g>
    </svg>
  </section>
</template>

<script setup>
  import { ChartLine } from "lucide-vue-next"
  import { KINDS } from "../data/station"
  import { linePath } from "../utils"

  const props = defineProps({
    trend: { type: Object, required: true },
    now: { type: Number, required: true }
  })
  const W = 1010
  const H = 150
  const L = 40
  const R = 12
  const T = 8
  const B = 22
  const max = computed(() => {
    const m = Math.max(...Object.values(props.trend.series).flat())
    return Math.ceil(m / 25) * 25
  })
  const ticks = computed(() =>
    [0, 0.25, 0.5, 0.75, 1].map((k) => Math.round(max.value * k))
  )
  const xs = (h) => L + (h * (W - L - R)) / 23
  const ys = (v) => T + (1 - v / max.value) * (H - T - B)
  const cut = computed(() => Math.min(23, Math.floor(props.now)))
  const path = (vals, a, b) => linePath(vals, xs, ys, a, b)
</script>

<style lang="scss" scoped>
  .legend {
    display: flex;
    gap: 14px;
    margin-left: auto;
    font-size: 13px;
    color: var(--muted);

    i {
      display: inline-block;
      width: 8px;
      height: 8px;
      margin-right: 5px;
      border-radius: 50%;
    }
  }

  .ptitle .unit {
    margin-left: 18px;
  }

  .chart {
    display: block;
    width: 100%;
    height: 150px;
  }

  .grid {
    stroke: rgba(60, 100, 160, 0.25);
    stroke-dasharray: 3 4;
  }

  .ax {
    font-family: "DIN", sans-serif;
    font-size: 11px;
    fill: var(--muted);
  }

  .now {
    stroke: var(--cyan);
  }
</style>

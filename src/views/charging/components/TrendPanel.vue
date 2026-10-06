<!-- 能量流动趋势（24 小时）：充电负荷、电网、储能、光伏四线；当前时刻之后为预测（虚线） -->
<template>
  <section class="panel trend">
    <div class="ptitle">
      <ChartLine />
      <h3>能量流动趋势（24 小时）</h3>
      <div class="legend">
        <span v-for="s in SERIES" :key="s.key"
          ><i :style="{ background: s.color }"></i>{{ s.name }}</span
        >
      </div>
      <span class="unit">单位：kW</span>
    </div>
    <svg v-if="trend" class="chart" :viewBox="`0 0 ${W} ${H}`">
      <!-- 电价时段底色 -->
      <rect
        v-for="(p, i) in PERIODS"
        :key="'p' + i"
        :x="xs(p[0] * 4)"
        :y="T"
        :width="xs(p[1] * 4) - xs(p[0] * 4)"
        :height="H - T - B"
        :fill="PRICE[p[2]].color"
        :opacity="p[2] === 'flat' ? 0.03 : 0.07"
      />
      <line
        v-for="v in ticks"
        :key="v"
        :x1="L"
        :x2="W - R"
        :y1="ys(v)"
        :y2="ys(v)"
        :class="v === 0 ? 'zero' : 'gridline'"
      />
      <text
        v-for="v in ticks"
        :key="'t' + v"
        :x="L - 6"
        :y="ys(v) + 4"
        class="ax"
        text-anchor="end"
      >
        {{ fmt(v) }}
      </text>
      <text
        v-for="h in 13"
        :key="'h' + h"
        :x="xs((h - 1) * 8)"
        :y="H - 2"
        class="ax"
        text-anchor="middle"
      >
        {{ String((h - 1) * 2).padStart(2, "0") }}:00
      </text>
      <defs>
        <linearGradient id="loadArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2f9bff" stop-opacity=".35" />
          <stop offset="1" stop-color="#2f9bff" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path :d="area" fill="url(#loadArea)" />
      <template v-for="s in SERIES" :key="s.key">
        <path
          :d="linePath(trend[s.key], xs, ys, nowIdx, 96)"
          fill="none"
          :stroke="s.color"
          stroke-width="1.2"
          stroke-dasharray="3 3"
          opacity=".35"
        />
        <path
          :d="linePath(trend[s.key], xs, ys, 0, nowIdx)"
          fill="none"
          :stroke="s.color"
          :stroke-width="s.key === 'load' ? 2 : 1.5"
          :style="{ filter: `drop-shadow(0 0 3px ${s.color})` }"
        />
      </template>
      <line
        :x1="xs(nowIdx)"
        :x2="xs(nowIdx)"
        :y1="T"
        :y2="H - B"
        stroke="#2de2e6"
        stroke-dasharray="2 3"
      />
      <rect
        :x="xs(nowIdx) - 20"
        :y="T - 14"
        width="40"
        height="15"
        rx="2"
        fill="#1360c4"
      />
      <text :x="xs(nowIdx)" :y="T - 3" class="now" text-anchor="middle">
        {{ nowText }}
      </text>
    </svg>
  </section>
</template>

<script setup>
  import { ChartLine } from "lucide-vue-next"
  import { PERIODS, PRICE } from "../data/station"
  import { fmt, linePath } from "../utils"

  const props = defineProps({
    trend: { type: Object, default: null },
    hour: { type: Number, required: true }
  })

  const SERIES = [
    { key: "load", name: "充电负荷", color: "#2f9bff" },
    { key: "grid", name: "电网功率", color: "#ff9f43" },
    { key: "ess", name: "储能充放电", color: "#34e07a" },
    { key: "pv", name: "光伏发电", color: "#f5c242" }
  ]
  const ticks = [-1500, 0, 2000, 4000, 6000]
  const W = 868
  const H = 108
  const L = 44
  const R = 22
  const T = 16
  const B = 16
  const MIN = -1500
  const MAX = 6800
  const xs = (i) => L + (i / 96) * (W - L - R)
  const ys = (v) => T + (1 - (v - MIN) / (MAX - MIN)) * (H - T - B)
  const nowIdx = computed(() => Math.min(96, Math.round(props.hour * 4)))
  const nowText = computed(() => {
    const h = Math.floor(props.hour)
    return `${String(h).padStart(2, "0")}:${String(Math.floor((props.hour - h) * 60)).padStart(2, "0")}`
  })
  const area = computed(
    () =>
      `${linePath(props.trend.load, xs, ys, 0, nowIdx.value)}L${xs(nowIdx.value)},${ys(0)}L${xs(0)},${ys(0)}Z`
  )
</script>

<style lang="scss" scoped>
  .trend {
    flex: 0 0 900px;
    padding-bottom: 8px;

    .ptitle {
      margin-bottom: 4px;
    }
  }

  .legend {
    display: flex;
    gap: 16px;
    margin-left: 22px;
    font-size: 12px;
    color: var(--muted);

    i {
      display: inline-block;
      width: 8px;
      height: 8px;
      margin-right: 5px;
      border-radius: 50%;
    }
  }

  .chart {
    display: block;
    width: 868px;
    height: 108px;
  }

  .gridline {
    stroke: rgba(138, 160, 189, 0.12);
    stroke-dasharray: 3 3;
  }

  .zero {
    stroke: rgba(226, 236, 248, 0.22);
  }

  .ax {
    fill: var(--muted);
    font-size: 10px;
    font-family: "DIN", sans-serif;
  }

  .now {
    fill: #fff;
    font-size: 10px;
    font-family: "DIN", sans-serif;
  }
</style>

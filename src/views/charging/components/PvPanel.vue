<!-- 光伏发电：发电功率率环图 + 指标 + 今日 / 昨日功率曲线 -->
<template>
  <section class="panel pv">
    <div class="ptitle" style="color: var(--pv)">
      <SolarPanel />
      <h3>光伏发电</h3>
      <span class="more">···</span>
    </div>
    <div class="row2">
      <RingChart
        :size="118"
        :width="10"
        :segs="[{ v: pv.ratio, color: '#f5c242' }]"
        :value="pct(pv.ratio)"
        unit="%"
        label="发电功率率"
      />
      <div class="rows">
        <div class="r">
          <Sun style="color: var(--pv)" /><span>当前功率</span
          ><span class="v">{{ fmt(pv.power) }}<small>kW</small></span>
        </div>
        <div class="r">
          <SolarPanel style="color: var(--load)" /><span>装机容量</span
          ><span class="v">{{ fmt(pv.kwp) }}<small>kWp</small></span>
        </div>
        <div class="r">
          <Activity style="color: var(--pv)" /><span>今日发电</span
          ><span class="v">{{ fmt(pv.today) }}<small>kWh</small></span>
        </div>
        <div class="r">
          <Gauge style="color: var(--cyan)" /><span>当日峰值</span
          ><span class="v"
            >{{ fmt(pv.peak) }}<small>kW ({{ pv.peakAt }})</small></span
          >
        </div>
      </div>
    </div>
    <div class="cap">
      <span>功率趋势（kW）</span>
      <span
        ><i style="background: var(--pv)"></i>今日
        <i style="background: var(--load)"></i>昨日</span
      >
    </div>
    <svg v-if="trend" class="curve" :viewBox="`0 0 ${W} ${H}`">
      <line
        v-for="v in [0, 300, 600]"
        :key="v"
        :x1="L"
        :x2="W - R"
        :y1="ys(v)"
        :y2="ys(v)"
        class="gridline"
      />
      <text
        v-for="v in [0, 300, 600]"
        :key="'t' + v"
        :x="L - 6"
        :y="ys(v) + 4"
        class="ax"
        text-anchor="end"
      >
        {{ v }}
      </text>
      <text
        v-for="h in [0, 6, 12, 18, 24]"
        :key="'h' + h"
        :x="xs(h * 4)"
        :y="H - 2"
        class="ax"
        text-anchor="middle"
      >
        {{ String(h).padStart(2, "0") }}:00
      </text>
      <defs>
        <linearGradient id="pvArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f5c242" stop-opacity=".35" />
          <stop offset="1" stop-color="#f5c242" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path
        :d="linePath(trend.yesterday, xs, ys)"
        fill="none"
        stroke="#2f9bff"
        stroke-width="1.2"
        opacity=".8"
      />
      <path :d="area" fill="url(#pvArea)" />
      <path
        :d="linePath(trend.today, xs, ys, nowIdx, 96)"
        fill="none"
        stroke="#f5c242"
        stroke-width="1.2"
        stroke-dasharray="3 3"
        opacity=".4"
      />
      <path
        :d="linePath(trend.today, xs, ys, 0, nowIdx)"
        fill="none"
        stroke="#f5c242"
        stroke-width="2"
        class="glow"
      />
      <circle
        :cx="xs(nowIdx)"
        :cy="ys(trend.today[nowIdx])"
        r="3.5"
        fill="#fff"
        stroke="#f5c242"
        stroke-width="2"
      />
      <text :x="xs(nowIdx) + 6" :y="ys(trend.today[nowIdx]) - 5" class="nowv">
        {{ pv.power }} kW
      </text>
    </svg>
  </section>
</template>

<script setup>
  import { Activity, Gauge, SolarPanel, Sun } from "lucide-vue-next"
  import RingChart from "./RingChart.vue"
  import { fmt, linePath, pct } from "../utils"

  const props = defineProps({
    pv: { type: Object, required: true },
    trend: { type: Object, default: null },
    hour: { type: Number, required: true }
  })

  // 曲线画布（viewBox 单位即设计稿 px）
  const W = 390
  const H = 74
  const L = 30
  const R = 14
  const T = 6
  const B = 16
  const xs = (i) => L + (i / 96) * (W - L - R)
  const ys = (v) => T + (1 - v / 600) * (H - T - B)
  const nowIdx = computed(() => Math.min(96, Math.round(props.hour * 4)))
  const area = computed(
    () =>
      `${linePath(props.trend.today, xs, ys, 0, nowIdx.value)}L${xs(nowIdx.value)},${ys(0)}L${xs(0)},${ys(0)}Z`
  )
</script>

<style lang="scss" scoped>
  .pv {
    height: 272px;
  }

  .cap {
    display: flex;
    justify-content: space-between;
    margin-top: 8px;
    font-size: 12px;
    color: var(--muted);

    i {
      display: inline-block;
      width: 10px;
      height: 2px;
      margin: 0 3px 0 8px;
      vertical-align: middle;
    }
  }

  .curve {
    display: block;
    width: 390px;
    height: 74px;
  }

  .gridline {
    stroke: rgba(138, 160, 189, 0.14);
    stroke-dasharray: 3 3;
  }

  .ax {
    fill: var(--muted);
    font-size: 10px;
    font-family: "DIN", sans-serif;
  }

  .nowv {
    fill: var(--pv);
    font-size: 11px;
    font-family: "DIN", sans-serif;
  }

  .glow {
    filter: drop-shadow(0 0 3px #f5c242);
  }
</style>

<!-- 今日 24 h 作业量（单系列柱；当前小时用强调色，未到的小时只画底线） -->
<template>
  <Panel title="今日作业量 · 逐小时" en="HOURLY MOVES">
    <svg class="bars" :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`">
      <g v-for="f in [0.5, 1]" :key="f">
        <line
          x1="26"
          :x2="W"
          :y1="H - 16 - f * (H - 30)"
          :y2="H - 16 - f * (H - 30)"
          class="grid"
        />
        <text x="0" :y="H - 12 - f * (H - 30)" class="ax">
          {{ fmt(max * f) }}
        </text>
      </g>
      <g v-for="i in 24" :key="i">
        <path
          v-if="hourly[i - 1] !== undefined"
          :d="bar(i - 1)"
          :class="i === hourly.length ? 'b-now' : 'b-bar'"
        />
        <rect
          v-else
          :x="x(i - 1) + 1"
          :y="H - 18"
          :width="bw - 2"
          height="2"
          class="b-fut"
        />
        <text
          v-if="(i - 1) % 4 === 0"
          :x="x(i - 1) + bw / 2"
          :y="H - 3"
          class="ax"
          text-anchor="middle"
        >
          {{ String(i - 1).padStart(2, "0") }}
        </text>
      </g>
    </svg>
  </Panel>
</template>

<script setup>
  import Panel from "../Panel.vue"
  import { fmt } from "../../utils.js"

  const props = defineProps({ hourly: { type: Array, default: () => [] } })
  const W = 412
  const H = 80
  const bw = (W - 30) / 24
  const max = computed(() => Math.max(...props.hourly, 1))
  const x = (i) => 28 + i * bw
  /** 顶部 2 px 圆角、贴底的柱 */
  function bar(i) {
    const bh = Math.max(2, (props.hourly[i] / max.value) * (H - 30))
    const x0 = x(i) + 1
    return `M${x0},${H - 16} v${-(bh - 2)} q0,-2 2,-2 h${bw - 6} q2,0 2,2 v${bh - 2} z`
  }
</script>

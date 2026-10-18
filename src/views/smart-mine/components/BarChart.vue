<!-- 柱状图（近 7 日产量）：最后一根可标为「截至目前」，半透明显示 -->
<template>
  <svg class="bar-chart" :viewBox="`0 0 ${W} ${H}`">
    <defs>
      <linearGradient :id="gid" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" :stop-color="color" stop-opacity=".85" />
        <stop offset="1" :stop-color="color" stop-opacity=".08" />
      </linearGradient>
    </defs>
    <line
      v-for="k in 4"
      :key="k"
      x1="0"
      :x2="W"
      :y1="TOP + ((BASE - TOP) * (k - 1)) / 3"
      :y2="TOP + ((BASE - TOP) * (k - 1)) / 3"
      stroke="rgba(120,170,230,.14)"
      stroke-dasharray="3 4"
    />
    <g v-for="(b, i) in bars" :key="b.label" :opacity="b.partial ? 0.45 : 1">
      <rect
        :x="b.x"
        :y="BASE - b.h"
        :width="b.w"
        :height="b.h"
        :fill="`url(#${gid})`"
      />
      <rect :x="b.x" :y="BASE - b.h" :width="b.w" height="2" :fill="color" />
      <text :x="b.x + b.w / 2" :y="BASE - b.h - 4" class="v" font-size="11">
        {{ fmt(b.value) }}
      </text>
      <text :x="b.x + b.w / 2" :y="H - 4" class="l" font-size="11">
        {{ items[i].label }}
      </text>
    </g>
  </svg>
</template>

<script setup>
  import { fmt } from "../utils"

  const props = defineProps({
    /** [{ label, value, partial }] */
    items: { type: Array, required: true },
    color: { type: String, default: "#36e0ff" }
  })
  const W = 370
  const H = 118
  const TOP = 14
  const BASE = H - 20
  const gid = `bar-${Math.random().toString(36).slice(2, 8)}`

  const bars = computed(() => {
    const max = Math.max(...props.items.map((b) => b.value), 1) * 1.18
    const bw = (W - 20) / props.items.length
    return props.items.map((b, i) => ({
      ...b,
      x: 10 + i * bw + bw * 0.28,
      w: bw * 0.44,
      h: ((BASE - TOP) * b.value) / max
    }))
  })
</script>

<style lang="scss" scoped>
  .bar-chart {
    display: block;
    width: 100%;
    height: auto;
  }

  /* 字号写在 SVG 属性里：CSS 里的 px 会被转成 rem，再叠加 viewBox 缩放就放大两次 */
  text {
    font-family: "DIN", sans-serif;
    text-anchor: middle;
  }

  .v {
    fill: #cfe3ff;
  }

  .l {
    fill: #6f87a8;
  }
</style>
